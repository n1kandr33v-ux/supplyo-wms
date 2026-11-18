import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { createApp } from "./app.ts";
import { readSupplySnapshot,beginSupplyMutation,endSupplyMutation } from "./supply-sync.ts";
import { WbError,parseWbJson,type WbOrder, type marketplace } from "./wb.ts";

const created=new Date().toISOString();
const order=(id:number,warehouseId=47):WbOrder=>({id,warehouseId,createdAt:created,article:"Товар "+id,skus:["barcode-"+id],requiredMeta:[]});
const header=(id:string,done=false)=>({id,name:"WB "+id,done,createdAt:created,closedAt:done?created:null});

test("WB int64 page cursors retain exact digits from HTTP JSON through the next request",async()=>{
 const cursor='1794477399709200101';
 const raw=`{"next":${cursor},"supplies":[{"id":"external","name":"WB","done":false,"createdAt":"2026-11-12T09:00:00Z"}]}`;
 assert.equal((parseWbJson(raw) as any).next,cursor);
 const paths:string[]=[];
 await readSupplySnapshot('fixture',[order(1)],async(_t,path,_m,body)=>{
  paths.push(path);
  if(path=== '/api/v3/supplies?limit=1000&next=0')return parseWbJson(raw);
  if(path=== '/api/v3/supplies?limit=1000&next='+cursor)return {next:0,supplies:[]};
  if(path.endsWith('/order-ids'))return {orderIds:[1]};
  if(path.endsWith('/status'))return {orders:[{id:1,supplierStatus:'confirm',wbStatus:'waiting'}]};
  throw Error('Unexpected '+path);
 });
 assert.ok(paths.includes('/api/v3/supplies?limit=1000&next='+cursor));
 const orderCursor='1794477399709200199';let readNext=false;
 const result=await readSupplySnapshot('fixture',[],async(_t,path)=>{
  if(path.startsWith('/api/v3/supplies?'))return {next:0,supplies:[header('a')]};
  if(path.endsWith('/order-ids'))return {orderIds:[2]};
  if(path.endsWith('/status'))return {orders:[{id:2,supplierStatus:'confirm',wbStatus:'waiting'}]};
  if(path.startsWith('/api/v3/orders?')){
   if(path.includes('next='+orderCursor+'&')){readNext=true;return {next:0,orders:[order(2)]};}
   return parseWbJson(`{"next":${orderCursor},"orders":[${JSON.stringify(order(999))}]}`);
  }
  throw Error('Unexpected '+path);
 });
 assert.equal(readNext,true);assert.equal(result.orders.size,1);
});

test("WB supplies reader paginates, batches metadata by 100 and rejects incomplete/inconsistent snapshots",async()=>{
 const calls:{path:string;method:string;body:any}[]=[];
 const all=Array.from({length:150},(_,i)=>({...order(i+1),requiredMeta:undefined}));
 const transport:typeof marketplace=async(_token,path,method="GET",body)=>{
  calls.push({path,method,body});const u=new URL(path,"https://fixture");
  if(u.pathname==="/api/v3/supplies")return u.searchParams.get("next")==="0"?{next:1,supplies:[header("external")]}:{next:0,supplies:[header("history",true)]};
  if(path.endsWith("/order-ids"))return {orderIds:all.map(o=>o.id)};
  if(u.pathname==="/api/v3/orders")return u.searchParams.get("next")==="0"?{next:2,orders:all.slice(0,100)}:{next:0,orders:all.slice(100)};
  if(path.endsWith('/status'))return {orders:(body as any).orders.map((id:number)=>({id,supplierStatus:'confirm',wbStatus:'waiting'}))};
  if(path.endsWith("/meta"))return {orders:(body as any).orders.map((id:number)=>({id,metaDetails:id===1?[{key:"sgtin",decision:"optional"}]:id===2?[{key:"customsDeclaration",decision:"optional"}]:id===3?[{key:"customsDeclaration",decision:"required"}]:[]}))};
  throw Error("Unexpected request "+path);
 };
 const data=await readSupplySnapshot("fixture",[],transport);
 assert.equal(data.supplies.length,2);assert.equal(data.members.get("external")!.length,150);assert.deepEqual(data.orders.get("1")!.requiredMeta,[]);assert.deepEqual(data.orders.get("1")!.optionalMeta,['sgtin']);
 assert.deepEqual(data.orders.get('2')!.requiredMeta,[]);assert.deepEqual(data.orders.get('2')!.optionalMeta,['customs_declaration']);
 assert.deepEqual(data.orders.get('3')!.requiredMeta,['customs_declaration']);
 const legacy=[...data.orders.values()].map(o=>o.id===2?{...o,requiredMeta:['customsDeclaration'],optionalMeta:undefined,wbMetaVersion:undefined}:o);
 const repaired=await readSupplySnapshot('fixture',legacy,transport);assert.deepEqual(repaired.orders.get('2')!.requiredMeta,[]);assert.deepEqual(repaired.orders.get('2')!.optionalMeta,['customs_declaration']);assert.equal(repaired.orders.get('2')!.wbMetaVersion,1);
 assert.deepEqual(calls.filter(c=>c.path.endsWith("/meta")).map(c=>c.body.orders.length),[100,50,1]);
 assert.ok(calls.every(c=>c.method==="GET"||(c.method==="POST"&&(c.path.endsWith("/orders/meta")||c.path.endsWith("/orders/status")))),"sync never modifies WB");
 let remaining=0;
 const cached=await readSupplySnapshot("fixture",[...data.orders.values()],async(t,p,m,b)=>{if(p.startsWith('/api/v3/orders?')||p.endsWith('/meta'))remaining++;return transport(t,p,m,b)});
 const canceled=await readSupplySnapshot("fixture",[...data.orders.values()],async(t,p,m,b)=>p.endsWith('/status')?{orders:(b as any).orders.map((id:number)=>({id,supplierStatus:id===150?'cancel':'confirm',wbStatus:'waiting'}))}:transport(t,p,m,b));
 assert.equal(canceled.orders.size,149);assert.ok(!canceled.members.get('external')!.includes('150'));
 assert.equal(cached.orders.size,150);assert.equal(remaining,0,"known order snapshots avoid repeated details and metadata reads");
 await assert.rejects(readSupplySnapshot("fixture",[],async()=>({next:0})),"missing supply array cannot clear local state");
 await assert.rejects(readSupplySnapshot("fixture",[],async(_t,p)=>p.startsWith('/api/v3/supplies?')?{next:0,supplies:[header('a'),header('b')]}:{orderIds:[1]}));
 await assert.rejects(readSupplySnapshot("fixture",[],async(_t,p)=>p.startsWith('/api/v3/supplies?')?{next:0,supplies:[header('a')]}:p.endsWith('/order-ids')?{orderIds:[1]}:{next:0,orders:[]}));
 await assert.rejects(readSupplySnapshot("fixture",[],async(t,p,m,b)=>p.endsWith('/meta')?{orders:[]}:transport(t,p,m,b)));
});

test("external supplies join the shared sync queue, preserve assembly and isolate warehouses, with safe moves/deletion/backoff",async()=>{
 let headersRemote=[header('wb-kazan'),header('wb-moscow')],members:Record<string,number[]>={'wb-kazan':[101,102],'wb-moscow':[103]};
 let newOrders=[{...order(101),requiredMeta:undefined},order(102),order(103,49),order(104)],failure=false,hold:Promise<void>|undefined,onRead:(()=>void)|undefined;
 const calls:string[]=[];let listReads=0;
 const transport:typeof marketplace=async(_t,path,_m,body)=>{
  calls.push(path);
  if(path.endsWith('/meta'))return {orders:(body as any).orders.map((id:number)=>({id,metaDetails:[{key:'customsDeclaration',decision:'optional'}]}))};
  if(path.startsWith('/api/v3/supplies?')){listReads++;onRead?.();if(hold)await hold;if(failure)throw new WbError(429,120);return {next:0,supplies:headersRemote};}
  if(path.endsWith('/order-ids'))return {orderIds:members[decodeURIComponent(path.split('/')[5])]||[]};
  if(path.endsWith('/status'))return {orders:(body as any).orders.map((id:number)=>({id,supplierStatus:'confirm',wbStatus:'waiting'}))};
  if(path==='/api/v3/warehouses')return [{id:47,name:'Казань'},{id:49,name:'Москва'}];
  if(path.startsWith('/api/v3/orders/stickers'))return {stickers:(body as any).orders.map((id:number)=>({orderId:id,file:'fixture-label-'+id,partA:'part',partB:String(id)}))};
  throw Error('Unexpected path '+path);
 };
 const {app,db,tick}=await createApp({worker:false,key:randomBytes(32),testPurchases:true,wb:{seller:async()=>({sid:'seller',name:'Магазин'}),orders:async()=>newOrders,supplies:(token,known)=>readSupplySnapshot(token,known,transport),marketplace:transport}});
 const baseHeaders={origin:'http://127.0.0.1:8095','x-supplyo-client':'web'};
 const user=async(email:string)=>{const r=await app.inject({method:'POST',url:'/api/auth/register',headers:baseHeaders,payload:{email,password:'Password-12345',name:email,phone:'+79991234567',consent:true}});assert.equal(r.statusCode,200,r.body);return {...baseHeaders,cookie:r.headers['set-cookie']!.toString().split(';')[0]};};
 const post=(h:any,url:string,payload:any={})=>app.inject({method:'POST',url,headers:h,payload});
 const get=(h:any,url:string)=>app.inject({url,headers:h});
 try{
  const owner=await user('supply-owner@example.test'),staff=await user('supply-staff@example.test'),stranger=await user('supply-other@example.test');
  await post(owner,'/api/subscription/test-purchase',{plan:'solo'});await post(staff,'/api/subscription/test-purchase',{plan:'solo'});
  const connected=await post(owner,'/api/stores',{token:'synthetic-test-supply-token'});assert.equal(connected.statusCode,202,connected.body);const id=connected.json().id;
  await tick();assert.equal((await db.query<any>('SELECT status FROM stores WHERE id=$1',[id])).rows[0].status,'ready');
  const view=(await get(owner,`/api/stores/${id}/fulfillment`)).json();assert.equal(view.supplies.length,2);assert.equal(view.items.length,3);assert.equal(view.supplies.find((s:any)=>s.id==='wb-kazan').warehouse_id,'47');
  assert.deepEqual((await get(owner,`/api/stores/${id}/orders?warehouse=47`)).json().orders.map((o:any)=>o.id),['104']);
  assert.equal((await get(stranger,`/api/stores/${id}/fulfillment`)).statusCode,403);
  const code=(await post(owner,'/api/access/codes',{storeId:id,warehouseId:'47'})).json().code;assert.equal((await post(staff,'/api/access/redeem',{code})).statusCode,200);
  const route=(await get(staff,'/api/stores')).json().stores[0].id;
  assert.deepEqual((await get(staff,`/api/stores/${route}/fulfillment`)).json().items.map((i:any)=>i.id).sort(),['101','102']);
  assert.equal((await post(staff,`/api/stores/${route}/supplies/wb-moscow/check`)).statusCode,404);
  await db.query("INSERT INTO inventory_items(store_id,warehouse_id,chrt_id,nm_id,title,article,size,barcodes,amount,cell,address) VALUES($1,'47','1','1','Товар','Товар','','[\"barcode-101\"]',9,'Г25-46','А-1-1')",[id]);
  const placed=(await get(staff,`/api/stores/${route}/fulfillment`)).json().items.find((i:any)=>i.id==='101');assert.equal(placed.cell,'Г25-46');assert.equal(placed.address,'А-1-1');
  assert.deepEqual(placed.snapshot.requiredMeta,[]);assert.deepEqual(placed.snapshot.optionalMeta,['customs_declaration']);
  const scan=await post(staff,`/api/stores/${route}/items/101/scan`,{});assert.equal(scan.statusCode,200,scan.body);
  assert.equal((await post(staff,`/api/stores/${route}/items/101/printed`)).statusCode,200);
  await db.query("UPDATE fulfillment_items SET kiz='saved-kiz',decision='filled',sticker_text='part 101' WHERE store_id=$1 AND id='101'",[id]);
  const preserved=(await db.query<any>("SELECT printed,kiz,decision,status,label,sticker_text FROM fulfillment_items WHERE store_id=$1 AND id='101'",[id])).rows[0];
  const sync=async()=>{const r=await post(owner,`/api/stores/${id}/sync`);assert.equal(r.statusCode,202,r.body);await tick();};
  await sync();assert.deepEqual((await db.query<any>("SELECT printed,kiz,decision,status,label,sticker_text FROM fulfillment_items WHERE store_id=$1 AND id='101'",[id])).rows[0],preserved);
  // Two people refreshing while the same cabinet is running share one durable job.
  let release!:()=>void,started!:()=>void;hold=new Promise(r=>release=r);const waiting=new Promise<void>(r=>started=r);onRead=started;
  await post(owner,`/api/stores/${id}/sync`);const running=tick();await waiting;const count=listReads;
  await post(staff,`/api/stores/${route}/sync`);await post(owner,`/api/stores/${id}/sync`);await tick();release();await running;hold=undefined;onRead=undefined;assert.equal(listReads,count);
  assert.equal((await db.query<any>("SELECT count(*)::int n FROM jobs WHERE store_id=$1 AND status IN ('queued','running')",[id])).rows[0].n,0);
  // Local supply/print mutations during the WB read invalidate the whole publication.
  let releaseRace!:()=>void,startedRace!:()=>void;hold=new Promise(r=>releaseRace=r);const waitRace=new Promise<void>(r=>startedRace=r);onRead=startedRace;
  await post(owner,`/api/stores/${id}/sync`);const racing=tick();await waitRace;beginSupplyMutation(id);endSupplyMutation(id);releaseRace();await racing;hold=undefined;onRead=undefined;
  assert.equal((await db.query<any>('SELECT status FROM stores WHERE id=$1',[id])).rows[0].status,'queued');
  await db.query("UPDATE jobs SET status='done' WHERE store_id=$1 AND status='queued'",[id]);await db.query("UPDATE stores SET status='ready',next_sync=0 WHERE id=$1",[id]);
  // Move one order in WB: prepare it again, leaving the untouched sibling's print state intact.
  await db.query("INSERT INTO fulfillment_print_batches(id,store_id,supply_id,barcode,jobs) VALUES('fixture-batch',$1,'wb-kazan','barcode-101','[{\"orderId\":\"101\",\"file\":\"label\"}]')",[id]);
  headersRemote=[header('wb-kazan'),header('wb-moscow'),header('wb-next')];members={'wb-kazan':[102],'wb-moscow':[103],'wb-next':[101]};newOrders=[order(101),order(102),order(103,49),order(104)];await sync();
  const moved=(await db.query<any>("SELECT supply_id,printed,kiz,label,status FROM fulfillment_items WHERE store_id=$1 AND id='101'",[id])).rows[0];assert.deepEqual(moved,{supply_id:'wb-next',printed:false,kiz:null,label:null,status:'Ожидает'});
  assert.equal((await post(owner,`/api/stores/${id}/supplies/wb-kazan/print-batches/fixture-batch/printed`)).statusCode,409,'old print acknowledgement cannot mark moved orders ready');
  assert.equal((await db.query<any>("SELECT amount FROM inventory_items WHERE store_id=$1",[id])).rows[0].amount,9);
  headersRemote=[header('wb-kazan',true),header('wb-moscow')];members={'wb-moscow':[103]};await sync();
  const final=(await get(owner,`/api/stores/${id}/fulfillment`)).json();assert.equal(final.supplies.find((s:any)=>s.id==='wb-kazan').closed,true);assert.ok(!final.supplies.some((s:any)=>s.id==='wb-next'));assert.ok(!final.items.some((i:any)=>i.id==='101'));
  assert.equal((await post(owner,`/api/stores/${id}/items/101/scan`)).statusCode,404);assert.equal((await db.query<any>("SELECT count(*)::int n FROM fulfillment_items WHERE store_id=$1 AND id='101'",[id])).rows[0].n,1,'removed rows retained');
  const history=(await db.query<any>("SELECT old_supply_id,new_supply_id,previous FROM fulfillment_item_history WHERE store_id=$1 AND order_id='101' ORDER BY id",[id])).rows;assert.equal(history.length,2);assert.equal(history[0].previous.kiz,'saved-kiz');assert.equal(history[0].previous.label,'fixture-label-101');assert.equal(history[1].new_supply_id,null);
  failure=true;const unchanged=JSON.stringify((await db.query('SELECT * FROM fulfillment_supplies WHERE store_id=$1 ORDER BY id',[id])).rows);await sync();
  assert.equal(JSON.stringify((await db.query('SELECT * FROM fulfillment_supplies WHERE store_id=$1 ORDER BY id',[id])).rows),unchanged);
  const before429=listReads;await post(owner,`/api/stores/${id}/sync`);await tick();assert.equal(listReads,before429,'manual refresh respects WB 429');
  assert.ok(calls.every(p=>!p.endsWith('/deliver')&&!p.endsWith('/supplies')),'import never creates or delivers WB supplies');
 }finally{await app.close();}
});
