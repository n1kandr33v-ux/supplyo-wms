import {ozonRequiresKiz} from './ozon-assembly.ts';
import {purgeExpiredOzonMarks,OZON_MARK_RETENTION_MS} from './ozon-mark-retention.ts';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {createApp} from './app.ts';
import {createOzonClient,OzonError,parseOzonJson,type OzonExemplars} from './ozon.ts';
import {validateMarking} from '../src/lib/marking.ts';
const code=(n:number)=>'010467046973694721'+String(n).padStart(13,'A');

test('Ozon assembly scans each unit, prompts KIZ, preserves remote exemplars, verifies status and completes posting safely',async()=>{
 const calls:any[]=[];let markStatus='processing',uncertain=false,deny=false,shipCalls=0,holdPosting:Promise<void>|undefined;let started:(()=>void)|undefined;
 const created=new Date().toISOString();
 const posting={posting_number:'123-1-1',order_number:'123-1',status:'awaiting_packaging',substatus:'posting_created',in_process_at:created,delivery_method:{warehouse_id:'47'},products:[{sku:'111',offer_id:'blouse',name:'Блузка',quantity:2},{sku:'222',offer_id:'comb',name:'Расчёска',quantity:1}]};
 let remote:OzonExemplars={posting_number:posting.posting_number,multi_box_qty:1,products:[{product_id:'111',quantity:2,is_mandatory_mark_needed:false,is_mandatory_mark_possible:true,exemplars:[{exemplar_id:'9007199254740993',marks:[{mark:'imei-old',mark_type:'imei'}],gtd:'preserve-gtd',is_gtd_absent:false},{exemplar_id:'9007199254740994',marks:[],rnpt:'preserve-rnpt',is_rnpt_absent:false}]},{product_id:'222',quantity:1,is_mandatory_mark_needed:false,is_mandatory_mark_possible:true,exemplars:[{exemplar_id:'9007199254740995',marks:[]}]}]};
 const ozon=createOzonClient(async(_c,path,body:any)=>{calls.push({path,body});
  if(deny)throw new OzonError(429,120);
  if(path==='/v1/seller/info')return {company:{name:'ИП Тест'}};
  if(path==='/v2/warehouse/list')return {warehouses:[{warehouse_id:'47',name:'Казань',is_rfbs:false}],has_next:false};
  if(path==='/v4/posting/fbs/list')return {postings:[posting],has_next:false};
  if(path==='/v4/product/info/attributes')return {result:body.filter.sku.map((sku:string)=>({sku,barcodes:[sku==='111'?'4670469736947':'comb-barcode'],attributes:[{id:23536,values:[{value:sku==='111'?'true':'false'}]}]})),total:body.filter.sku.length};
  if(path==='/v3/posting/fbs/get'){started?.();if(holdPosting)await holdPosting;return {result:posting};}
  if(path==='/v6/fbs/posting/product/exemplar/create-or-get')return structuredClone(remote);
  if(path==='/v5/fbs/posting/product/exemplar/status'&&!remote.products.some(p=>p.exemplars.some(e=>e.marks.some(m=>m.mark_type==='mandatory_mark'))))throw new OzonError(404);
  if(path==='/v5/fbs/posting/product/exemplar/status')return {posting_number:posting.posting_number,status:markStatus==='processing'?'validation_in_process':'ship_available',products:remote.products.map(p=>({product_id:p.product_id,exemplars:p.exemplars.map(e=>({exemplar_id:e.exemplar_id,marks:e.marks.map(m=>({...m,check_status:markStatus,error_codes:markStatus==='failed'?['MARK_INVALID']:[]}))}))}))};
  if(path==='/v6/fbs/posting/product/exemplar/set'){
   // Raw JSON integer serialization must preserve the exact exemplar digits.
   const sent=parseOzonJson(JSON.stringify(body)) as any;
   assert.equal(sent.products[0].exemplars[0].exemplar_id,'9007199254740993');
   remote={...remote,products:remote.products.map(p=>({...p,exemplars:sent.products.find((q:any)=>String(q.product_id)===p.product_id).exemplars.map((e:any)=>({...e,exemplar_id:String(e.exemplar_id)}))}))};
   if(uncertain)throw Error('synthetic lost response');return {};
  }
  if(path==='/v4/posting/fbs/ship'){shipCalls++;assert.equal(body.packages.length,1);posting.status='awaiting_deliver';return {result:[posting.posting_number]};}
  throw Error('Unexpected '+path);
 });
 const {app,db,tick,ozonAssemblyTick}=await createApp({key:randomBytes(32),worker:false,testPurchases:true,ozon});
 const base={origin:'http://127.0.0.1:8095','x-supplyo-client':'web'};
 const register=async(email:string,paid=true)=>{const r=await app.inject({method:'POST',url:'/api/auth/register',headers:base,payload:{email,name:'Тестовый сотрудник',password:'Password-12345',phone:'+79991234567',consent:true}});const h={...base,cookie:r.headers['set-cookie']!.toString().split(';')[0]};if(paid)await app.inject({method:'POST',url:'/api/subscription/test-purchase',headers:h,payload:{plan:'start'}});return h;};
 const post=(h:any,url:string,payload:any={})=>app.inject({method:'POST',url,headers:h,payload});
 try{
  const owner=await register('assembly@example.test'),other=await register('other@example.test');
  const id=(await post(owner,'/api/stores',{marketplace:'ozon',clientId:'123',token:'synthetic-key-1234567890'})).json().id;await tick();
  const url='/api/stores/'+id+'/ozon/assembly',get=()=>app.inject({url,headers:owner});
  assert.equal((await get()).json().quantity,3);assert.equal((await app.inject({url:url+'?search=4670469736947',headers:owner})).json().total,1);assert.ok(!JSON.stringify((await get()).json()).includes('tnved'));
  assert.equal((await app.inject({url,headers:other})).statusCode,404);
  const employee=await register('viewer@example.test',false);
  const physical={id:'test-warehouse',name:'Казань',city:'Казань',address:'Тест',staff:['viewer@example.test'],staffNames:{'viewer@example.test':'Сотрудник'},staffRights:{'viewer@example.test':['view']},wmsScopes:[{storeId:id,warehouseId:'47'}]};
  assert.equal((await post(owner,'/api/workspace/warehouses',{version:0,data:[physical]})).statusCode,200);
  const employeeId=(await app.inject({url:'/api/stores',headers:employee})).json().stores[0].id;
  assert.equal((await app.inject({url:'/api/stores/'+employeeId+'/ozon/assembly',headers:employee})).statusCode,200);
  assert.equal((await post(employee,'/api/stores/'+employeeId+'/ozon/assembly/scan',{barcode:'comb-barcode',requestId:randomUUID()})).statusCode,403);

  const scan=async(barcode:string,requestId=randomUUID())=>post(owner,url+'/scan',{barcode,requestId});
  const beforeAuto=await app.inject({url:url+'/auto-candidates',headers:owner});assert.equal(beforeAuto.statusCode,200,beforeAuto.body);assert.equal(beforeAuto.json().rows.length,0);
  const op=randomUUID(),one=await scan('4670469736947',op);assert.equal(one.statusCode,200,one.body);assert.equal(one.json().needsKiz,true);assert.equal((await scan('4670469736947',op)).json().unit,one.json().unit);
  assert.equal((await post(owner,url+'/'+one.json().unit+'/kiz',{kiz:'not-a-kiz',reservation:one.json().reservation})).statusCode,400);
  assert.equal(validateMarking(code(1)).valid,true);
  let save=await post(owner,url+'/'+one.json().unit+'/kiz',{kiz:code(1),reservation:one.json().reservation});assert.equal(save.statusCode,200,save.body);assert.equal((await post(owner,url+'/'+one.json().unit+'/kiz',{kiz:code(1),reservation:one.json().reservation})).statusCode,200,'lost queued response retries safely');
  // First task needs an editable response, not the initial checking fixture.
  markStatus='passed';await ozonAssemblyTick();assert.equal(remote.products[0].exemplars[0].marks.find(m=>m.mark_type==='mandatory_mark')?.mark,code(1));assert.equal(remote.products[0].exemplars[0].gtd,'preserve-gtd');assert.ok(remote.products[0].exemplars[0].marks.some(m=>m.mark==='imei-old'));
  const partialAuto=(await app.inject({url:url+'/auto-candidates',headers:owner})).json().rows[0];assert.equal(partialAuto.quantity,3);assert.notEqual(partialAuto.ready,3);
  const sets=()=>calls.filter(c=>c.path.endsWith('/exemplar/set')).length;
  await post(owner,url+'/'+one.json().unit+'/kiz',{kiz:code(1),reservation:one.json().reservation});assert.equal(sets(),1,'retry never submits a second set');
  physical.staffRights['viewer@example.test']=['view','assembly'];await post(owner,'/api/workspace/warehouses',{version:1,data:[physical]});
  const employeeUrl='/api/stores/'+employeeId+'/ozon/assembly';
  const two=await post(employee,employeeUrl+'/scan',{barcode:'4670469736947',requestId:randomUUID()});assert.notEqual(two.json().unit,one.json().unit,'second identical product selects next unit');assert.equal((await post(owner,url+'/'+two.json().unit+'/kiz',{kiz:code(1),reservation:two.json().reservation})).statusCode,409,'same physical mark cannot be reused');
  await post(employee,employeeUrl+'/'+two.json().unit+'/kiz',{kiz:code(2),reservation:two.json().reservation});
  physical.staffRights['viewer@example.test']=['view'];await post(owner,'/api/workspace/warehouses',{version:2,data:[physical]});
  await db.query('UPDATE ozon_pick_checks SET next_at=0');await ozonAssemblyTick();assert.equal((await db.query<any>('SELECT state FROM ozon_pick_units WHERE id=$1',[two.json().unit])).rows[0].state,'error','revoked employee cannot submit queued data');
  await post(owner,url+'/'+two.json().unit+'/kiz',{kiz:code(2)});
  const finish=await post(owner,url+'/finish',{posting:posting.posting_number});assert.notEqual(finish.statusCode,200,'unverified and unscanned units block finish');
  await db.query('UPDATE ozon_pick_checks SET next_at=0');await ozonAssemblyTick();assert.equal(remote.products[0].exemplars[0].marks.find(m=>m.mark_type==='mandatory_mark')?.mark,code(1));assert.equal(remote.products[0].exemplars[1].marks.find(m=>m.mark_type==='mandatory_mark')?.mark,code(2));assert.equal(remote.products[0].exemplars[1].rnpt,'preserve-rnpt');
  markStatus='failed';await db.query('UPDATE ozon_pick_checks SET next_at=0');await ozonAssemblyTick();
  assert.equal((await db.query<any>('SELECT state FROM ozon_pick_units WHERE id=$1',[two.json().unit])).rows[0].state,'error');
  await post(owner,url+'/'+two.json().unit+'/kiz',{kiz:code(3)});uncertain=true;markStatus='passed';await db.query('UPDATE ozon_pick_checks SET next_at=0');await ozonAssemblyTick();
  const countAfterUncertain=sets();assert.equal((await db.query<any>('SELECT state FROM ozon_pick_units WHERE id=$1',[two.json().unit])).rows[0].state,'checking');uncertain=false;
  deny=true;await db.query('UPDATE ozon_pick_checks SET next_at=0');await ozonAssemblyTick();const countBeforePause=calls.length;await ozonAssemblyTick();assert.equal(calls.length,countBeforePause,'persisted 429 stops staff/background retries');deny=false;await db.query('UPDATE stores SET api_retry_after=0 WHERE id=$1',[id]);
  await db.query('UPDATE ozon_pick_checks SET next_at=0');await ozonAssemblyTick();assert.equal(sets(),countAfterUncertain,'lost set response is reconciled without replay');
  let release!:()=>void;holdPosting=new Promise(r=>release=r);const entered=new Promise<void>(r=>started=r);const scanning=scan('comb-barcode');await entered;
  assert.equal((await scan('comb-barcode')).statusCode,409,'simultaneous scans cannot claim one unit twice');release();const plain=await scanning;holdPosting=undefined;started=undefined;assert.equal(plain.json().needsKiz,false);
  assert.equal((await get()).json().ready,3);
  assert.equal((await post(owner,url+'/'+plain.json().unit+'/kiz',{kiz:code(4)})).statusCode,200,'optional marking can be supplied voluntarily after a plain scan');
  await db.query('UPDATE ozon_pick_checks SET next_at=0');await ozonAssemblyTick();await db.query('UPDATE ozon_pick_checks SET next_at=0');await ozonAssemblyTick();assert.equal((await get()).json().ready,3);

  const complete=await post(owner,url+'/finish',{posting:posting.posting_number});assert.equal(complete.statusCode,200,complete.body);assert.equal(shipCalls,1);
  assert.equal((await post(owner,url+'/finish',{posting:posting.posting_number})).statusCode,200);assert.equal(shipCalls,1);
  assert.equal((await get()).json().quantity,0,'confirmed Ozon completion leaves active assembly');
  const assembled=Number((await db.query<any>('SELECT assembled_at FROM ozon_postings WHERE store_id=$1 AND posting_number=$2',[id,posting.posting_number])).rows[0].assembled_at);assert.ok(assembled>0);
  await post(owner,url+'/finish',{posting:posting.posting_number});assert.equal(Number((await db.query<any>('SELECT assembled_at FROM ozon_postings WHERE store_id=$1 AND posting_number=$2',[id,posting.posting_number])).rows[0].assembled_at),assembled,'retries never extend retention');
  await db.query("INSERT INTO fulfillment_items(store_id,id,snapshot,kiz) VALUES($1,'wb-retention-control','{}','wb-code-preserved')",[id]);
  await purgeExpiredOzonMarks(db,assembled+OZON_MARK_RETENTION_MS-1);
  assert.equal((await db.query<any>('SELECT kiz FROM ozon_pick_units WHERE id=$1',[one.json().unit])).rows[0].kiz,code(1),'code survives until the full 14 days');
  const callsBeforePurge=calls.length;
  assert.equal(await purgeExpiredOzonMarks(db,assembled+OZON_MARK_RETENTION_MS),1);
  const purged=(await db.query<any>('SELECT kiz,identity,previous_code,state FROM ozon_pick_units WHERE id=$1',[two.json().unit])).rows[0];assert.equal(purged.kiz,null);assert.equal(purged.identity,null);assert.equal(purged.previous_code,null);assert.equal(purged.state,'ready');
  const history=(await db.query<any>('SELECT previous FROM ozon_pick_history h JOIN ozon_pick_units u ON u.id=h.unit_id WHERE u.store_id=$1',[id])).rows;assert.ok(history.length);for(const h of history)for(const k of ['kiz','identity','previous_code'])assert.equal(k in h.previous,false);
  assert.equal(await purgeExpiredOzonMarks(db,assembled+OZON_MARK_RETENTION_MS+1),0,'cleanup is idempotent');assert.equal(calls.length,callsBeforePurge,'retention never sends a request to Ozon');
  assert.equal((await db.query<any>("SELECT kiz FROM fulfillment_items WHERE id='wb-retention-control'")).rows[0].kiz,'wb-code-preserved','WB data stays untouched');


  posting.status='awaiting_packaging';posting.products[1].quantity=3;remote.products[1].quantity=3;remote.products[1].exemplars=[0,1,2].map(i=>({exemplar_id:String(80000+i),marks:[]}));
  const cached=(await db.query<any>('SELECT products FROM ozon_postings WHERE store_id=$1',[id])).rows[0].products;cached.find((p:any)=>p.sku==='222').quantity=3;
  await db.query("UPDATE ozon_postings SET status='awaiting_packaging',products=$2 WHERE store_id=$1",[id,JSON.stringify(cached)]);await db.query("DELETE FROM ozon_pick_units WHERE store_id=$1 AND sku='222'",[id]);
  const autoId=randomUUID(),autoBody={barcode:'comb-barcode',warehouse:'47',auto:true,requestId:autoId};
  assert.equal((await post(owner,url+'/scan',{...autoBody,warehouse:''})).statusCode,409,'auto requires a specific warehouse');
  const batch=await post(owner,url+'/scan',autoBody);assert.equal(batch.statusCode,200,batch.body);assert.equal(batch.json().count,3);assert.equal((await post(owner,url+'/scan',autoBody)).json().count,3);
  assert.equal((await db.query<any>("SELECT count(*)::int n FROM ozon_pick_units WHERE store_id=$1 AND sku='222' AND state='ready'",[id])).rows[0].n,3);
  assert.equal((await post(owner,url+'/scan',{...autoBody,warehouse:'49'})).statusCode,409,'replay cannot change scope');
  const markedAuto=await post(owner,url+'/scan',{barcode:'4670469736947',warehouse:'47',auto:true,requestId:randomUUID()});assert.equal(markedAuto.statusCode,200,markedAuto.body);assert.equal(markedAuto.json().needsKiz,true,'marked units still need individual codes');
 }finally{await app.close();}
});

 test('Ozon distinguishes mandatory transmission from optional marking, including per-exemplar requirements',()=>{
 const posting={requirements:{products_requiring_mandatory_mark:[]},optional:{products_with_possible_mandatory_mark:['111']}} as any;
 const data={products:[{product_id:'111',is_mandatory_mark_needed:false,is_mandatory_mark_possible:true,exemplars:[{is_mandatory_mark_needed:false}]}]} as any;
 assert.equal(ozonRequiresKiz(posting,data,'111'),false);assert.equal(ozonRequiresKiz(posting,data,'111',true),true,'catalog marking requires a code even when transmission is optional');
 posting.requirements.products_requiring_mandatory_mark=['111'];assert.equal(ozonRequiresKiz(posting,data,'111'),true);
 posting.requirements.products_requiring_mandatory_mark=[];data.products[0].is_mandatory_mark_needed=true;assert.equal(ozonRequiresKiz(posting,data,'111'),true);
 data.products[0].is_mandatory_mark_needed=false;data.products[0].exemplars[0].is_mandatory_mark_needed=true;assert.equal(ozonRequiresKiz(posting,data,'111'),true);
 assert.throws(()=>ozonRequiresKiz(posting,data,'missing'),/не вернул требования/);
 });
