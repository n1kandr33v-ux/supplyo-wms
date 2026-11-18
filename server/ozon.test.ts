import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {createApp} from './app.ts';
import {createOzonClient,OzonError,parseOzonJson} from './ozon.ts';
import {unseal} from './security.ts';
const created=new Date().toISOString();
const posting=(number:string,warehouse='47',status='awaiting_packaging')=>({posting_number:number,order_number:'order-'+number,status,in_process_at:created,shipment_date:created,scanit:'ii123',delivery_schema:'fbs',delivery_method:{warehouse_id:warehouse,warehouse:'Склад'},products:[{sku:'1904686181',offer_id:'art-1',name:'Товар 1',quantity:2},{sku:'1904686182',offer_id:'art-2',name:'Товар 2',quantity:1}],customer:{name:'PRIVATE CUSTOMER',phone:'PRIVATE PHONE'},financial_data:{private:'NO STORE'}});

test('Ozon v2/v4 cursors, int64 IDs, FBS filtering and incomplete response protection',async()=>{
 const calls:any[]=[];
 const client=createOzonClient(async(c,path,body:any)=>{calls.push({path,body});
  if(path==='/v1/seller/info')return {company:{name:'ИП Ozon',inn:'DO NOT STORE'}};
  if(path==='/v2/warehouse/list')return body.cursor?{warehouses:[{warehouse_id:'49',name:'Москва',is_rfbs:false}],has_next:false,cursor:''}:{warehouses:[{warehouse_id:'47',name:'Казань',is_rfbs:false},{warehouse_id:'99',name:'rFBS',is_rfbs:true}],has_next:true,cursor:'warehouse-next'};
  if(path==='/v4/posting/fbs/list')return body.cursor?{postings:[posting('two','49'),{...posting('rfbs','99'),delivery_schema:'rfbs'}],has_next:false,cursor:''}:{postings:[posting('one')],has_next:true,cursor:'posting-next'};
  throw Error('Unexpected '+path);
 });
 const credentials={clientId:'123',apiKey:'synthetic-ozon-key-123456789'};
 assert.equal((await client.seller(credentials)).name,'ИП Ozon');assert.deepEqual(await client.warehouses(credentials),[{id:'47',name:'Казань'},{id:'49',name:'Москва'}]);
 const data=await client.postings(credentials,{since:created,to:created,changedSince:created});assert.equal(data.length,2);assert.equal(data[0].products.reduce((n,p)=>n+p.quantity,0),3);assert.ok(!JSON.stringify(data).includes('PRIVATE'));assert.ok(!JSON.stringify(data).includes('financial_data'));
 const request=calls.find(c=>c.path==='/v4/posting/fbs/list');assert.equal(request.body.limit,100);assert.ok(!('offset' in request.body));assert.equal(request.body.filter.last_changed_status_date.from,created);assert.equal(request.body.with.financial_data,false);
 assert.equal((parseOzonJson('{"warehouse_id":9007199254740993}') as any).warehouse_id,'9007199254740993');
 await assert.rejects(createOzonClient(async()=>({})).warehouses(credentials));await assert.rejects(createOzonClient(async()=>({postings:[],has_next:true,cursor:'same'})).postings(credentials,{since:created,to:created}));
});

test('Ozon shares cabinet queue/capacity and warehouse rights, encrypts keys, keeps WB isolated and retries safely',async()=>{
 const key=randomBytes(32),calls:any[]=[];let wbReads=0,fail=0,attributeFail=false,hold:Promise<void>|undefined,onRead:(()=>void)|undefined;
 let rows=[posting('0001-1','47'),posting('0002-1','49')];
 const ozon=createOzonClient(async(c,path,body:any)=>{
  calls.push({client:c.clientId,key:c.apiKey,path,body});
  if(c.apiKey.startsWith('invalid'))throw new OzonError(403);
  if(path==='/v4/product/info/attributes'&&attributeFail)throw new OzonError(403);
  if(path==='/v4/product/info/attributes')return {result:body.filter.sku.map((sku:string,i:number)=>({sku,attributes:[{id:23536,values:[{value:i===0?'true':'false'}]}]})),total:body.filter.sku.length,last_id:''};
  if(path==='/v1/seller/info'){if(c.clientId==='456')throw new OzonError(403);return {company:{name:'ИП Ozon '+c.clientId}};}
  if(path==='/v2/warehouse/list')return {warehouses:[{warehouse_id:'47',name:'Казань',is_rfbs:false},{warehouse_id:'49',name:'Москва',is_rfbs:false},{warehouse_id:'99',name:'rFBS',is_rfbs:true}],has_next:false,cursor:''};
  if(path==='/v4/posting/fbs/list'){onRead?.();if(hold)await hold;if(fail)throw new OzonError(fail,120);return {postings:rows,has_next:false,cursor:''};}
  throw Error('Unexpected '+path);
 });
 const {app,db,tick}=await createApp({worker:false,testPurchases:true,key,ozon,wb:{seller:async()=>({sid:'wb-seller',name:'WB Shop'}),orders:async()=>{wbReads++;return []},marketplace:async()=>[{id:47,name:'WB Казань'}]}});
 const base={origin:'http://127.0.0.1:8095','x-supplyo-client':'web'};
 async function user(email:string,paid=false){const r=await app.inject({method:'POST',url:'/api/auth/register',headers:base,payload:{email,password:'Password-12345',name:email,phone:'+79991234567',consent:true}});assert.equal(r.statusCode,200,r.body);const h={...base,cookie:r.headers['set-cookie']!.toString().split(';')[0]};if(paid)await app.inject({method:'POST',url:'/api/subscription/test-purchase',headers:h,payload:{plan:'start'}});return h;}
 const post=(h:any,url:string,payload:any={})=>app.inject({method:'POST',url,headers:h,payload});const get=(h:any,url:string)=>app.inject({url,headers:h});
 try{
  const owner=await user('ozon-owner@example.test',true),staff=await user('ozon-staff@example.test',true),other=await user('ozon-other@example.test',true),unpaid=await user('ozon-unpaid@example.test');
  const wbStore=(await post(owner,'/api/stores',{token:'synthetic-wb-token-123456789'})).json().id;await tick();const baselineWb=wbReads;
  const token='synthetic-ozon-key-123456789',connect=await post(owner,'/api/stores',{marketplace:'ozon',clientId:'000123',token});assert.equal(connect.statusCode,202,connect.body);const id=connect.json().id;
  const encrypted=(await db.query<any>('SELECT credential,marketplace FROM stores WHERE id=$1',[id])).rows[0];assert.equal(encrypted.marketplace,'ozon');assert.ok(!encrypted.credential.includes(token));assert.equal(JSON.parse(unseal(encrypted.credential,key)).clientId,'123');
  assert.equal((await post(other,'/api/stores',{marketplace:'ozon',clientId:'123',token:'another-key-synthetic-12345'})).statusCode,409,'same client cannot bypass cabinet identity with another key');
  await tick();assert.equal(wbReads,baselineWb,'Ozon key never enters WB client');
  const list=(await get(owner,'/api/stores')).json().stores;assert.equal(list.find((s:any)=>s.id===id).marketplace,'ozon');assert.ok(!JSON.stringify(list).includes(token));assert.equal(list.length,2,'shared subscription counts both providers');
  assert.equal((await get(owner,`/api/stores/${id}/warehouses`)).json().warehouses.length,2);
  const loaded=(await get(owner,`/api/stores/${id}/ozon/postings`)).json();assert.equal(loaded.total,2);assert.equal(loaded.postings[0].products[0].quantity,2);assert.equal(loaded.postings[0].products[0].marking.required,true);assert.equal(loaded.postings[0].products[1].marking.required,false);assert.equal(loaded.postings[0].products[0].marking.stale,false);assert.ok(!JSON.stringify(loaded).includes('PRIVATE'));
  assert.equal((await get(other,`/api/stores/${id}/ozon/postings`)).statusCode,404);
  assert.equal((await post(owner,`/api/stores/${id}/supplies/create`,{orders:['1'],name:'Wrong provider'})).statusCode,501);
  assert.equal((await get(owner,`/api/stores/${id}/stocks?warehouse=47`)).statusCode,501);
  const code=(await post(owner,'/api/access/codes',{storeId:id,warehouseId:'47'})).json().code;assert.equal((await post(staff,'/api/access/redeem',{code})).statusCode,200);const route=(await get(staff,'/api/stores')).json().stores[0].id;
  assert.equal((await post(staff,`/api/stores/${route}/display-name`,{name:'ИП Клиент Ozon'})).statusCode,200);
  assert.equal((await get(staff,'/api/stores')).json().stores[0].name,'ИП Клиент Ozon');
  assert.equal((await get(owner,'/api/stores')).json().stores.find((s:any)=>s.id===id).name,'ИП Ozon 123','FF label cannot rename the client own cabinet');
  assert.equal((await get(staff,'/api/access/incoming')).json().clients[0].name,'ИП Клиент Ozon');
  assert.equal((await post(other,`/api/stores/${id}/display-name`,{name:'wrong'})).statusCode,404);
  assert.equal((await post(owner,`/api/stores/${wbStore}/display-name`,{name:'wrong'})).statusCode,404);
  assert.equal((await post(staff,`/api/stores/${route}/display-name`,{name:'x'.repeat(151)})).statusCode,400);
  assert.equal((await post(staff,`/api/stores/${route}/display-name`,{name:''})).statusCode,200);
  assert.equal((await get(staff,'/api/stores')).json().stores[0].name,'ИП Ozon 123');

  const scoped=(await get(staff,`/api/stores/${route}/ozon/postings?warehouse=49`)).json();assert.deepEqual(scoped.postings.map((p:any)=>p.posting_number),['0001-1']);assert.equal((await get(staff,`/api/stores/${route}/warehouses`)).json().warehouses[0].id,'47');
  const dashboard=(await get(staff,'/api/dashboard')).json();assert.equal(dashboard.warehouses[0].marketplace,'ozon');assert.equal(dashboard.warehouses[0].new_orders,1);
  const employee=await user('ozon-employee@example.test');
  const physical={id:'ozon-physical',name:'ФФ Казань',city:'Казань',address:'Адрес',staff:['ozon-employee@example.test'],staffNames:{'ozon-employee@example.test':'Сотрудник'},staffRights:{'ozon-employee@example.test':['view']},wmsScopes:[{storeId:id,warehouseId:'47'}]};
  const assigned=await post(owner,'/api/workspace/warehouses',{version:0,data:[physical]});assert.equal(assigned.statusCode,200,assigned.body);
  const employeeStores=(await get(employee,'/api/stores')).json().stores;assert.equal(employeeStores.length,1);assert.equal(employeeStores[0].marketplace,'ozon');assert.ok(employeeStores[0].id.startsWith('staff.'));
  const employeePage=await get(employee,`/api/stores/${employeeStores[0].id}/ozon/postings?warehouse=49`);assert.equal(employeePage.statusCode,200,employeePage.body);assert.deepEqual(employeePage.json().postings.map((p:any)=>p.posting_number),['0001-1']);
  const sync=async()=>{await post(owner,`/api/stores/${id}/sync`);await tick();};
  rows=[{...posting('0001-1','47','cancelled'),products:[{sku:'1904686181',offer_id:'art-1',name:'Товар 1',quantity:1}]}];await sync();assert.equal((await get(owner,`/api/stores/${id}/ozon/postings?status=cancelled&search=art-1`)).json().total,1);assert.equal((await db.query<any>('SELECT count(*)::int n FROM ozon_postings WHERE store_id=$1',[id])).rows[0].n,2,'upsert retains history outside changed page');
  const oldKey=(await db.query<any>('SELECT credential FROM stores WHERE id=$1',[id])).rows[0].credential;
  assert.equal((await post(owner,`/api/stores/${id}/credential`,{token:'invalid-key-synthetic-123456'})).statusCode,400);assert.equal((await db.query<any>('SELECT credential FROM stores WHERE id=$1',[id])).rows[0].credential,oldKey);
  assert.equal((await post(owner,`/api/stores/${id}/credential`,{token:'replacement-ozon-key-123456'})).statusCode,200);await tick();assert.ok(calls.some(c=>c.key==='replacement-ozon-key-123456'));
  const attributesBefore=calls.filter(c=>c.path==='/v4/product/info/attributes').length;
  await db.query("UPDATE stores SET next_sync=0 WHERE id=$1",[id]);await tick();assert.equal(calls.filter(c=>c.path==='/v4/product/info/attributes').length,attributesBefore,'background cache avoids reads for every order or employee');
  attributeFail=true;await db.query('UPDATE ozon_product_marking SET checked_at=0 WHERE store_id=$1',[id]);await sync();
  const retained=(await get(owner,`/api/stores/${id}/ozon/postings`)).json();assert.equal(retained.postings[0].products[0].marking.required,true);assert.equal(retained.postings[0].products[0].marking.stale,true);assert.equal(retained.total,2);attributeFail=false;
  fail=500;await sync();assert.equal((await get(owner,`/api/stores/${id}/ozon/postings`)).json().total,2,'upstream failures retain saved pages');
  fail=429;await sync();const before=calls.length;await post(owner,`/api/stores/${id}/sync`);await tick();assert.equal(calls.length,before,'manual refresh never bypasses Ozon 429');assert.equal((await get(owner,`/api/stores/${id}/ozon/postings`)).json().total,2,'saved data survive 429');
  fail=0;await db.query("UPDATE stores SET next_sync=0,api_retry_after=0 WHERE id=$1",[id]);await db.query("UPDATE jobs SET run_at=0 WHERE store_id=$1 AND status='queued'",[id]);await tick();
  // Unpaid connection verifies identity/warehouses, but does not fetch orders.
  const prior=calls.filter(c=>c.path.endsWith('/fbs/list')).length;const connectedUnpaid=await post(unpaid,'/api/stores',{marketplace:'ozon',clientId:'456',token});assert.equal(connectedUnpaid.statusCode,202,connectedUnpaid.body);await tick();assert.equal(calls.filter(c=>c.path.endsWith('/fbs/list')).length,prior);assert.equal((await get(unpaid,`/api/stores/${connectedUnpaid.json().id}/ozon/postings`)).statusCode,403);const limitedStore=(await db.query<any>('SELECT status,name,seller_id FROM stores WHERE id=$1',[connectedUnpaid.json().id])).rows[0];assert.equal(limitedStore.status,'ready');assert.equal(limitedStore.name,'Ozon · 456');assert.equal(limitedStore.seller_id,'456');assert.equal((await post(unpaid,`/api/stores/${connectedUnpaid.json().id}/display-name`,{name:'Клиент без подписки'})).statusCode,200);
  let release!:()=>void,started!:()=>void;hold=new Promise(r=>release=r);const wait=new Promise<void>(r=>started=r);onRead=started;await post(owner,`/api/stores/${id}/sync`);const running=tick();await wait;
  const inFlightCount=calls.length;await post(staff,`/api/stores/${route}/sync`);await tick();assert.equal(calls.length,inFlightCount,'staff shares the same cabinet job');
  assert.equal((await post(owner,`/api/stores/${id}/remove`,{confirm:true})).statusCode,200);release();await running;hold=undefined;onRead=undefined;
  assert.equal((await db.query<any>('SELECT status,credential FROM stores WHERE id=$1',[id])).rows[0].status,'removed');assert.equal((await get(staff,`/api/stores/${route}/ozon/postings`)).statusCode,404,'revoked access cannot read retained history');assert.equal(wbReads,baselineWb);
  const invalid=await post(other,'/api/stores',{marketplace:'ozon',clientId:'999',token:'invalid-ozon-key-123456789'});assert.equal(invalid.statusCode,202,invalid.body);await tick();
  const invalidWarehouses=await get(other,`/api/stores/${invalid.json().id}/warehouses`);assert.equal(invalidWarehouses.statusCode,502);assert.ok(invalidWarehouses.json().error.startsWith('Ozon'));
  const repaired=await post(other,`/api/stores/${invalid.json().id}/credential`,{token:'repaired-ozon-key-123456789'});assert.equal(repaired.statusCode,200,repaired.body);await tick();assert.equal((await db.query<any>('SELECT status FROM stores WHERE id=$1',[invalid.json().id])).rows[0].status,'ready','bad initial key can be corrected without recreating the cabinet');
 }finally{await app.close();}
});

test('Ozon marking attributes batch unique SKUs, paginate, retain unknown and reject incomplete evidence',async()=>{
 const c={clientId:'123',apiKey:'synthetic-key-1234567890'},calls:any[]=[];
 const skus=Array.from({length:150},(_,i)=>String(i+1));
 const client=createOzonClient(async(_c,path,body:any)=>{
  calls.push({path,body});const batch=body.filter.sku;
  const part=body.last_id?batch.slice(50):batch.slice(0,50);
  return {result:part.map((sku:string)=>({sku,attributes:sku==='1'?[]:[{id:22232,values:[{value:'6206400000'}]},{id:23536,values:[{value:sku==='2'?'false':sku==='3'?'yes':sku==='4'?false:'true'}]}]})),total:batch.length,last_id:'next'};
 });
 const rows=await client.marking(c,skus);assert.equal(rows.length,150);assert.deepEqual(calls.map(c=>c.body.filter.sku.length),[100,100,50]);assert.ok(calls.every(c=>c.path==='/v4/product/info/attributes'&&c.body.filter.visibility==='ALL'));
 assert.equal(rows[0].required,null);assert.equal(rows[1].required,false);assert.equal(rows[2].required,null);assert.equal(rows[3].required,false);assert.equal(rows[4].required,true);assert.equal(rows[4].tnved,"6206400000");
 assert.equal((await createOzonClient(async()=>({result:[],total:'0',last_id:''})).marking(c,['77']))[0].required,null);
 await assert.rejects(createOzonClient(async()=>({result:[],total:1,last_id:'same'})).marking(c,['77']));
 await assert.rejects(createOzonClient(async()=>({result:[{sku:'other',attributes:[]}],total:1,last_id:''})).marking(c,['77']));
 const conflict=await createOzonClient(async()=>({result:[{sku:'77',attributes:[{id:23536,values:[{value:'true'},{value:'false'}]}]}],total:1})).marking(c,['77']);assert.equal(conflict[0].required,null);
});

test('Ozon seller info is optional on role denial, while credential and transient errors remain errors',async()=>{
 const credentials={clientId:'123',apiKey:'synthetic-api-key-123456789'};
 const missingRole=createOzonClient(async()=>{throw new OzonError(403)});assert.deepEqual(await missingRole.seller(credentials),{sid:'123',name:'Ozon · 123'});
 for(const code of [401,429,500])await assert.rejects(createOzonClient(async()=>{throw new OzonError(code)}).seller(credentials),(e:any)=>e.status===code);
});
