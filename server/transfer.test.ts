import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes,randomUUID } from 'node:crypto';
import { createApp } from './app.ts';
import {applySupplySnapshot} from './supply-sync.ts';

test('move selected orders to existing/new WB supply, keep receipts/notes and reconcile retries without duplicate creation',async()=>{
 let creates=0,patches=0,failPatch=false,failCreate=false;
 const remote:Record<string,string[]>={source:['1','2','3','4'],target:[],foreign:[]};
 const {app,db,tick}=await createApp({key:randomBytes(32),worker:false,testPurchases:true,wb:{seller:async()=>({sid:'seller',name:'Магазин'}),orders:async()=>[],marketplace:async(_t,path,method='GET',body:any)=>{
  if(path==='/api/v3/warehouses')return [{id:47,name:'Казань'},{id:49,name:'Москва'}];
  if(path==='/api/v3/supplies'&&method==='POST'){creates++;const id='created-'+creates;remote[id]=[];if(failCreate)throw Error('Uncertain creation');return {id};}
  if(method==='GET'&&/^\/api\/v3\/supplies\/[^/]+$/.test(path))return {done:false};
  const target=decodeURIComponent(path.split('/')[5]);
  if(path.endsWith('/order-ids'))return {orderIds:(remote[target]||[]).map(Number)};
  if(path.endsWith('/orders')&&method==='PATCH'){
   patches++;const ids=body.orders.map(String);for(const key of Object.keys(remote))remote[key]=remote[key].filter(id=>!ids.includes(id));remote[target].push(...ids);if(failPatch)throw Error('Response lost after WB moved orders');return {};
  }
  throw Error('Unexpected WB request '+path);
 }}});
 const base={origin:'http://127.0.0.1:8095','x-supplyo-client':'web'};
 const user=async(email:string)=>{const r=await app.inject({method:'POST',url:'/api/auth/register',headers:base,payload:{email,password:'Password-12345',name:email,phone:'+79991234567',consent:true}});assert.equal(r.statusCode,200,r.body);const h={...base,cookie:r.headers['set-cookie']!.toString().split(';')[0]};await app.inject({method:'POST',url:'/api/subscription/test-purchase',headers:h,payload:{plan:'solo'}});return h;};
 const post=(headers:any,url:string,payload:any={})=>app.inject({method:'POST',url,headers,payload});
 try{
  const owner=await user('move-owner@example.test'),staff=await user('move-staff@example.test'),other=await user('move-other@example.test');
  const connected=await post(owner,'/api/stores',{token:'fixture-move-token-long-enough'});assert.equal(connected.statusCode,202,connected.body);const id=connected.json().id;await tick();
  for(const [s,w,closed]of [['source','47',false],['target','47',false],['foreign','49',false],['closed','47',true]] as const)await db.query('INSERT INTO fulfillment_supplies(store_id,id,name,created,warehouse_id,closed) VALUES($1,$2,$2,$3,$4,$5)',[id,s,new Date().toISOString(),w,closed]);
  for(const n of ['1','2','3','4'])await db.query("INSERT INTO fulfillment_items(store_id,id,supply_id,snapshot,printed,kiz,decision,status,label,sticker_text) VALUES($1,$2,'source',$3,true,'saved-kiz','filled','Готов','saved-label','saved-number')",[id,n,JSON.stringify({id:Number(n),warehouseId:47,article:'Товар',skus:['barcode'],requiredMeta:['sgtin'],cargoType:1})]);
  const uid=(await db.query<any>("SELECT id FROM users WHERE email='move-owner@example.test'")).rows[0].id;
  const note=randomUUID();await db.query("INSERT INTO mobile_pick_notes(id,store_id,supply_id,item_id,user_id,author_name,text,created_at) VALUES($1,$2,'source','1',$3,'Автор','Заметка',1)",[note,id,uid]);
  const move=(h:any,payload:any)=>post(h,`/api/stores/${id}/supplies/source/move`,payload);
  const payload={operationId:randomUUID(),orders:['1'],targetSupply:'target'};
  assert.equal((await move(other,payload)).statusCode,404);assert.equal(patches,0);
  assert.equal((await move(owner,{...payload,operationId:randomUUID(),targetSupply:'foreign'})).statusCode,400);
  assert.equal((await move(owner,{...payload,operationId:randomUUID(),targetSupply:'source'})).statusCode,400);
  assert.equal((await move(owner,{...payload,operationId:randomUUID(),targetSupply:'closed'})).statusCode,409);
  assert.equal((await move(owner,{...payload,operationId:randomUUID(),orders:Array.from({length:101},(_,i)=>String(i+1))})).statusCode,400);
  const code=(await post(owner,'/api/access/codes',{storeId:id,warehouseId:'47'})).json().code;await post(staff,'/api/access/redeem',{code});const stores=await app.inject({url:'/api/stores',headers:staff});const route=stores.json().stores[0].id;
  assert.equal((await post(staff,`/api/stores/${route}/supplies/source/move`,{...payload,operationId:randomUUID(),targetSupply:'foreign'})).statusCode,404);
  const before=(await db.query<any>("SELECT printed,kiz,decision,status,label,sticker_text FROM fulfillment_items WHERE store_id=$1 AND id='1'",[id])).rows[0];
  const first=await move(owner,payload);assert.equal(first.statusCode,200,first.body);assert.equal(first.json().id,'target');assert.equal(patches,1);
  assert.deepEqual((await db.query<any>("SELECT printed,kiz,decision,status,label,sticker_text FROM fulfillment_items WHERE store_id=$1 AND id='1'",[id])).rows[0],before);
  assert.equal((await db.query<any>('SELECT supply_id FROM mobile_pick_notes WHERE id=$1',[note])).rows[0].supply_id,'target');
  assert.equal((await move(owner,payload)).statusCode,200);assert.equal(patches,1,'successful retry is a no-op');assert.equal((await move(owner,{...payload,orders:['2']})).statusCode,409);
  // WB attached the order but its response was lost: retry reuses the target and reads membership.
  const newTarget={operationId:randomUUID(),orders:['2'],newName:'Новая поставка'};failPatch=true;assert.equal((await move(owner,newTarget)).statusCode,500);assert.equal(creates,1);assert.equal(patches,2);
  // The background import may reconcile the transfer before the user retries it.
  const baseline=(await db.query<any>('SELECT id,supply_id,snapshot FROM fulfillment_items WHERE store_id=$1',[id])).rows;
  const plan:any={supplies:Object.keys(remote).map(id=>({id,name:id,done:false,createdAt:new Date().toISOString()})),members:new Map(Object.entries(remote)),orders:new Map(baseline.map(i=>[i.id,i.snapshot]))};
  await db.transaction(tx=>applySupplySnapshot(tx,id,plan,baseline,['source','target','foreign','created-1']));
  assert.equal((await db.query<any>("SELECT printed FROM fulfillment_items WHERE store_id=$1 AND id='2'",[id])).rows[0].printed,true,'background sync retains receipts of an interrupted local transfer');
  failPatch=false;const retry=await move(owner,newTarget);assert.equal(retry.statusCode,200,retry.body);assert.equal(retry.json().id,'created-1');assert.equal(creates,1);assert.equal(patches,2);
  const untouched=(await db.query<any>("SELECT supply_id,printed FROM fulfillment_items WHERE store_id=$1 AND id='3'",[id])).rows[0];assert.deepEqual(untouched,{supply_id:'source',printed:true});
  await db.query("INSERT INTO fulfillment_print_batches(id,store_id,supply_id,barcode,jobs) VALUES('pending',$1,'source','barcode','[{\"orderId\":\"3\"}]')",[id]);
  assert.equal((await move(owner,{operationId:randomUUID(),orders:['3'],targetSupply:'target'})).statusCode,409);assert.equal(patches,2);
  // Unknown create result is never blindly retried, so it cannot spawn another supply.
  failCreate=true;const uncertain={operationId:randomUUID(),orders:['4'],newName:'Проверить создание'};assert.equal((await move(owner,uncertain)).statusCode,500);assert.equal(creates,2);
  const blocked=await move(owner,uncertain);assert.equal(blocked.statusCode,409,blocked.body);assert.equal(creates,2);
  assert.equal((await db.query<any>("SELECT count(*)::int n FROM fulfillment_item_history WHERE store_id=$1",[id])).rows[0].n,2);
 }finally{await app.close();}
});
