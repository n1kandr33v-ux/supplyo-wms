import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {createApp} from './app.ts';
import {createOzonClient,downloadOzonLabel,OzonError} from './ozon.ts';
import {renderOzonPdf} from './ozon-pdf.ts';
const fixture=new URL('./fixtures/ozon-label.pdf',import.meta.url);
test('Ozon labels retain PDF dimensions and reject invalid source/file data',async()=>{
 const pages=await renderOzonPdf(await readFile(fixture));assert.equal(pages.length,1);assert.equal(pages[0].width_mm,58);assert.equal(pages[0].height_mm,40);assert.equal(Buffer.from(pages[0].file,'base64').subarray(0,8).toString('hex'),'89504e470d0a1a0a');
 await assert.rejects(renderOzonPdf(Buffer.from('not a PDF')));
 for(const url of ['http://127.0.0.1/private','https://api.ozon.ru.evil.example/file.pdf','https://user:secret@cdn1.ozone.ru/file.pdf','https://cdn1.ozone.ru:8443/file.pdf'])await assert.rejects(downloadOzonLabel(url));
});
test('Ozon label generation coalesces tasks, enforces device/printer/warehouse access and only acknowledges a ready immutable job',async()=>{
 const calls:any[]=[];let partial=false,pending=true,fail=0;
 const created=new Date().toISOString(),rows=[{posting_number:'one-1',order_number:'one',status:'awaiting_deliver',in_process_at:created,delivery_method:{warehouse_id:'47'},products:[{sku:'111',name:'Товар',offer_id:'item',quantity:1}]},{posting_number:'two-1',order_number:'two',status:'awaiting_packaging',in_process_at:created,delivery_method:{warehouse_id:'49'},products:[{sku:'111',name:'Товар',offer_id:'item',quantity:1}]}];
 const ozon=createOzonClient(async(_c,path,body:any)=>{calls.push({path,body});
  if(path==='/v1/seller/info')return {company:{name:'ИП Тест'}};
  if(path==='/v2/warehouse/list')return {warehouses:[{warehouse_id:'47',name:'Казань',is_rfbs:false},{warehouse_id:'49',name:'Москва',is_rfbs:false}],has_next:false};
  if(path==='/v4/posting/fbs/list')return {postings:rows,has_next:false};
  if(path==='/v4/product/info/attributes')return {result:[{sku:'111',attributes:[{id:23536,values:[{value:'false'}]}]}],total:1};
  if(path==='/v3/posting/fbs/get')return {result:rows.find(p=>p.posting_number===body.posting_number)};
  if(path==='/v3/posting/fbs/package-label/create'){if(fail)throw new OzonError(fail,120);assert.equal(body.posting_numbers.length,1);return {tasks:[{task_id:'123',task_type:'big_label'},{task_id:'9007199254740993',task_type:'small_label'}]};}
  if(path==='/v2/posting/fbs/package-label/get'){assert.equal(JSON.stringify(body),'{"task_id":9007199254740993}');if(pending)return {status:{code:'pending'}};return {file_url:'https://cdn1.ozone.ru/synthetic.pdf',status:{code:pending?'pending':'completed',postings_count:1,printed_postings_count:partial?0:pending?0:1,unprinted_postings:partial?[{posting_number:'one-1',message:'error'}]:[]}};}
  throw Error('Unexpected '+path);
 },async()=>readFile(fixture));
 const {app,db,tick,ozonLabelTick}=await createApp({key:randomBytes(32),worker:false,testPurchases:true,ozon});const base={origin:'http://127.0.0.1:8095','x-supplyo-client':'web'};
 const register=async(email:string,paid=true)=>{const r=await app.inject({method:'POST',url:'/api/auth/register',headers:base,payload:{email,name:'Тестовый сотрудник',password:'Password-12345',phone:'+79991234567',consent:true}});const h={...base,cookie:r.headers['set-cookie']!.toString().split(';')[0]};if(paid)await app.inject({method:'POST',url:'/api/subscription/test-purchase',headers:h,payload:{plan:'start'}});return h;};
 const post=(h:any,url:string,payload:any={})=>app.inject({method:'POST',url,headers:h,payload});
 try{
 const owner=await register('print-owner@example.test'),other=await register('print-other@example.test'),staff=await register('print-staff@example.test');const id=(await post(owner,'/api/stores',{marketplace:'ozon',clientId:'123',token:'synthetic-key-1234567890'})).json().id;await tick();
 const url='/api/stores/'+id+'/ozon/labels',deviceId=randomUUID(),requestId=randomUUID(),body={posting:'one-1',deviceId,requestId,printer:'Fixture printer'};
 assert.equal((await post(other,url+'/prepare',body)).statusCode,404);
 assert.equal((await post(owner,url+'/prepare',{...body,posting:'two-1'})).statusCode,409,'unassembled posting cannot obtain a label');
 const code=(await post(owner,'/api/access/codes',{storeId:id,warehouseId:'47'})).json().code;await post(staff,'/api/access/redeem',{code});const grant=(await app.inject({url:'/api/stores',headers:staff})).json().stores[0].id;
 assert.equal((await post(staff,'/api/stores/'+grant+'/ozon/labels/prepare',{...body,posting:'two-1'})).statusCode,409);
 await db.query("INSERT INTO ozon_ship_tasks VALUES($1,'one-1','done',$2,NULL)",[id,Date.now()]);const both=await Promise.all([post(owner,url+'/prepare',body),post(owner,url+'/prepare',body)]);const prepared=both[0];assert.equal(prepared.statusCode,200,prepared.body);assert.equal(both[1].statusCode,200,both[1].body);const job=prepared.json().jobId;assert.equal(both[1].json().jobId,job);assert.ok(Number((await db.query<any>("SELECT next_at FROM ozon_label_files WHERE store_id=$1 AND posting_number='one-1'",[id])).rows[0].next_at)<=Date.now(),'no fixed delay after assembly confirmation');
 assert.equal((await post(owner,url+'/prepare',body)).json().jobId,job);
 assert.equal((await post(owner,url+'/prepare',{...body,requestId:randomUUID()})).json().jobId,job,'staff/browser retries share one pending print');
 assert.equal((await post(owner,url+'/prepare',{...body,requestId:randomUUID(),deviceId:randomUUID()})).statusCode,409,'another physical agent cannot duplicate pending output');
 assert.equal((await post(owner,url+'/'+job+'/printed',{deviceId})).statusCode,409);
 const get=()=>app.inject({url:url+'/'+job+'?deviceId='+deviceId,headers:owner});
 assert.equal((await app.inject({url:url+'/'+job+'?deviceId='+randomUUID(),headers:owner})).statusCode,404);
 const advance=async()=>{await db.query('UPDATE ozon_label_files SET next_at=0');await ozonLabelTick();};
 fail=400;await advance();assert.equal((await get()).json().state,'queued','temporary label-not-ready response retries automatically');fail=0;
 fail=429;await advance();const count=calls.length;await ozonLabelTick();assert.equal(calls.length,count);fail=0;await db.query('UPDATE stores SET api_retry_after=0 WHERE id=$1',[id]);await advance();
 assert.equal((await get()).json().state,'polling');await advance();assert.ok(!(await get()).json().stickers,'pending is never printable');
 pending=false;partial=true;await advance();assert.equal((await get()).json().state,'error');assert.ok(!(await get()).json().stickers);
 partial=false;await post(owner,url+'/prepare',body);await advance();await advance();
 const ready=(await get()).json();assert.equal(ready.state,'ready');assert.equal(ready.stickers[0].width_mm,58);assert.equal(ready.printer,'Fixture printer');
 assert.equal((await post(owner,url+'/'+job+'/printed',{deviceId})).statusCode,200);assert.equal((await post(owner,url+'/'+job+'/printed',{deviceId})).statusCode,200);assert.equal((await get()).json().completed,true);
 assert.equal((await post(owner,url+'/prepare',{...body,requestId:randomUUID()})).json().alreadyPrinted,true);
 const reprint=await post(owner,url+'/prepare',{...body,requestId:randomUUID(),reprint:true});assert.equal(reprint.statusCode,200,reprint.body);assert.notEqual(reprint.json().jobId,job);const again=(await app.inject({url:url+'/'+reprint.json().jobId+'?deviceId='+deviceId,headers:owner})).json();assert.deepEqual(again.stickers,ready.stickers,'intentional reprint uses immutable cached label');
 await post(owner,'/api/stores/'+id+'/remove',{confirm:true});assert.equal((await get()).statusCode,404);
 }finally{await app.close();}
});
