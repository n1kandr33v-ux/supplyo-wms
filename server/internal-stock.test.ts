import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {createApp} from './app.ts';
import {seal} from './security.ts';
import {saveOzon,ozonClient} from './ozon.ts';

test('internal inventory: isolated warehouse quantities, confirmed shipments once, corrections, own goods and WB publication',async()=>{
 const key=randomBytes(32),writes:any[]=[],amounts=new Map([[1,50],[2,12]]);let loseResponse=false;
 const {app,db,stockTick,internalStockTick}=await createApp({key,worker:false,testPurchases:true,ozon:{...ozonClient,warehouses:async()=>[{id:"47",name:"Казань"}]},wb:{seller:async()=>({sid:'s',name:'WB'}),orders:async()=>[],marketplace:async(_token,path,method='GET',body:any)=>{
  if(path==='/api/v3/warehouses')return [{id:47,name:'Казань'},{id:49,name:'Москва'}];
  if(path.includes('/stocks/')){if(method==='PUT'){writes.push(body);for(const i of body.stocks)amounts.set(i.chrtId,i.amount);if(loseResponse){loseResponse=false;throw Error('timeout')}return {}}return {stocks:body.chrtIds.map((chrtId:number)=>({chrtId,amount:amounts.get(chrtId)||0}))};}throw Error('unexpected WB request '+path);
 },content:async()=>({cards:[{nmID:1,title:'Блузка',vendorCode:'a',sizes:[{chrtID:1,techSize:'42',skus:['first','alternate']},{chrtID:2,techSize:'46',skus:['second']}]}],cursor:{total:1}})}});
 const base={origin:'http://127.0.0.1:8095','x-supplyo-client':'web'};
 const post=(headers:any,url:string,payload:any={})=>app.inject({method:'POST',url,headers,payload});
 const get=(headers:any,url:string)=>app.inject({url,headers});
 async function user(email:string,paid=true){const r=await post(base,'/api/auth/register',{email,name:email,password:'Password-12345',phone:'+79991234567',consent:true});assert.equal(r.statusCode,200,r.body);const h={...base,cookie:String(r.headers['set-cookie']).split(';')[0]};if(paid)assert.equal((await post(h,'/api/subscription/test-purchase',{plan:'start'})).statusCode,200);return {h,id:(await db.query<any>('SELECT id FROM users WHERE email=$1',[email])).rows[0].id};}
 try{
  const owner=await user('internal-owner@example.test'),other=await user('internal-other@example.test'),staff=await user('internal-staff@example.test',false);
  await db.query("INSERT INTO stores(id,user_id,credential,fingerprint,name,status) VALUES('s',$1,$2,'s','WB','ready')",[owner.id,seal('synthetic',key)]);
  const scope='?store=s&warehouse=47',stocks='/api/stores/s/stocks?warehouse=47&availability=all';
  await get(owner.h,stocks);await stockTick();
  const create=await post(owner.h,'/api/internal-stock'+scope,{source:'wb:1',title:'ignored',quantity:8});assert.equal(create.statusCode,200,create.body);const item=create.json().id;
  assert.equal(writes.length,0,'internal initialization never writes WB');
  assert.equal((await get(owner.h,stocks)).json().items[0].internal.quantity,8);
  assert.equal((await post(owner.h,'/api/internal-stock'+scope,{source:'wb:1',title:'x',quantity:4})).statusCode,409);
  assert.equal((await get(other.h,'/api/internal-stock'+scope)).statusCode,404);
  const warehouse:any={id:'physical',name:'Казань',city:'Казань',address:'Адрес',staff:['internal-staff@example.test'],staffNames:{'internal-staff@example.test':'Сотрудник'},staffRights:{'internal-staff@example.test':['view']},wmsScopes:[{storeId:'s',warehouseId:'47'}]};
  assert.equal((await post(owner.h,'/api/workspace/warehouses',{version:0,data:[warehouse]})).statusCode,200);
  const sid=(await get(staff.h,'/api/stores')).json().stores[0].id,staffScope='?store='+encodeURIComponent(sid)+'&warehouse=47';
  assert.equal((await get(staff.h,'/api/internal-stock'+staffScope)).statusCode,200);
  assert.equal((await post(staff.h,'/api/internal-stock/'+item+staffScope,{version:1,quantity:9,reason:'x'})).statusCode,403);
  assert.equal((await get(staff.h,'/api/internal-stock'+staffScope.replace('47','49'))).statusCode,403);
  // Printing/Ready is not shipment. Exactly two units are deducted only when supply closes.
  await db.query("INSERT INTO fulfillment_supplies(store_id,id,closed) VALUES('s','delivery',false),('s','historical',true)");
  await db.query("UPDATE fulfillment_supplies SET delivered_at='2020-01-01T00:00:00Z' WHERE id='historical'");
  for(const [id,supply] of [['one','delivery'],['two','delivery'],['old','historical']])await db.query("INSERT INTO fulfillment_items(store_id,id,supply_id,snapshot,printed,status) VALUES('s',$1,$2,$3,true,'Готов')",[id,supply,JSON.stringify({warehouseId:47,skus:['alternate']})]);
  await internalStockTick();assert.equal((await get(owner.h,stocks)).json().items[0].internal.quantity,8);
  await db.query("UPDATE fulfillment_supplies SET closed=true,delivered_at=$1 WHERE id='delivery'",[new Date().toISOString()]);
  await Promise.all([internalStockTick(),internalStockTick()]);await internalStockTick();
  let current=(await get(owner.h,stocks)).json().items[0].internal;assert.equal(current.quantity,6);assert.equal(current.version,3);assert.equal(amounts.get(1),50,'shipment does not implicitly publish WB quantities');
  assert.equal((await post(owner.h,'/api/internal-stock/'+item+scope,{version:1,quantity:20,reason:'Пересчёт'})).statusCode,409);
  assert.equal((await post(owner.h,'/api/internal-stock/'+item+scope,{version:current.version,quantity:10,reason:'Приёмка'})).statusCode,200);
  const history=(await get(owner.h,'/api/internal-stock/'+item+'/history'+scope)).json().movements;assert.equal(history.length,4);assert.equal(history.filter((m:any)=>m.kind==='shipment').length,2);
  // Preview covers all tracked variants, not just the current search/page; unknown stock is skipped.
  const preview=await post(owner.h,'/api/stores/s/stocks/publish-preview?warehouse=47');assert.equal(preview.statusCode,200,preview.body);assert.equal(preview.json().count,1);assert.equal(preview.json().skipped,1);
  loseResponse=true;const route='/api/stores/s/stocks/publish?warehouse=47';assert.equal((await post(owner.h,route,{id:preview.json().id})).statusCode,502);assert.equal(amounts.get(1),10);
  assert.equal((await post(owner.h,route,{id:preview.json().id})).statusCode,200);const count=writes.length;assert.equal((await post(owner.h,route,{id:preview.json().id})).statusCode,200);assert.equal(writes.length,count,'repeated completed publish is read-only');assert.equal(amounts.get(2),12,'untracked variant stays untouched');
  const stale=(await post(owner.h,'/api/stores/s/stocks/publish-preview?warehouse=47')).json();current=(await get(owner.h,stocks)).json().items[0].internal;
  await post(owner.h,'/api/internal-stock/'+item+scope,{version:current.version,quantity:11,reason:'Пересчёт'});
  assert.equal((await post(owner.h,route,{id:stale.id})).statusCode,409);assert.equal(writes.length,count,'stale preview never sends old quantities');
  // WB catalog refresh cannot overwrite the independent physical ledger.
  await db.query("UPDATE inventory_sync SET run_at=0,status='queued'");await stockTick();assert.equal((await get(owner.h,stocks)).json().items[0].internal.quantity,11);
  const ownScope='?physical=physical',own=await post(owner.h,'/api/internal-stock'+ownScope,{title:'Упаковка',article:'pack',barcodes:['own'],cell:'П-1',quantity:100});assert.equal(own.statusCode,200,own.body);
  assert.equal((await get(owner.h,'/api/internal-stock'+ownScope)).json().items[0].quantity,100);
  assert.equal((await get(other.h,'/api/internal-stock'+ownScope)).statusCode,403);
  assert.equal((await post(owner.h,'/api/workspace/warehouses',{version:1,data:[]})).statusCode,409,'cannot orphan physical stock');
  // Revoked membership is checked afresh for history and stock mutations.
  warehouse.staff=[];warehouse.staffNames={};warehouse.staffRights={};await post(owner.h,'/api/workspace/warehouses',{version:1,data:[warehouse]});
  assert.equal((await get(staff.h,'/api/internal-stock'+staffScope)).statusCode,404);
  // Ozon packaging completion is not dispatch. Only marketplace-confirmed delivery debits quantity.
  await db.query("INSERT INTO stores(id,user_id,credential,fingerprint,name,status,marketplace) VALUES('oz',$1,$2,'oz','Ozon','ready','ozon')",[owner.id,seal(JSON.stringify({clientId:'123',apiKey:'synthetic-ozon-key-123456789'}),key)]);
  const posting:any={posting_number:'001-1',order_number:'001',status:'awaiting_packaging',products:[{sku:'123',name:'Ozon товар',offer_id:'offer',quantity:3}],delivery_method:{warehouse_id:'47'},in_process_at:new Date().toISOString()};
  await saveOzon(db,'oz',[{id:'47',name:'Казань'}],[posting]);
  const ozScope='?store=oz&warehouse=47';const oz=await post(owner.h,'/api/internal-stock'+ozScope,{source:'ozon:123',title:'x',quantity:5});assert.equal(oz.statusCode,200,oz.body);
  posting.status='awaiting_deliver';await saveOzon(db,'oz',[{id:'47',name:'Казань'}],[posting]);await internalStockTick();assert.equal((await get(owner.h,'/api/internal-stock'+ozScope)).json().items[0].quantity,5);
  posting.status='delivering';await saveOzon(db,'oz',[{id:'47',name:'Казань'}],[posting]);await internalStockTick();assert.equal((await get(owner.h,'/api/internal-stock'+ozScope)).json().items[0].quantity,2);
  posting.status='delivered';await saveOzon(db,'oz',[{id:'47',name:'Казань'}],[posting]);await internalStockTick();assert.equal((await get(owner.h,'/api/internal-stock'+ozScope)).json().items[0].quantity,2,'delivery completion does not debit twice');
  // Publishing over 1000 variants splits requests and includes explicit zeroes.
  await db.query(`INSERT INTO inventory_items(store_id,warehouse_id,chrt_id,nm_id,title,article,size,barcodes) SELECT 's','49',n::text,'2','Массовый товар','','','[]'::jsonb FROM generate_series(10000,11000) n`);
  await db.query(`INSERT INTO internal_stock_items(id,location,source_id,title,article,barcodes,cell,address,quantity) SELECT 'bulk-'||n,$1,'wb:'||n,'Массовый товар','','[]'::jsonb,'','',CASE WHEN n=10000 THEN 0 ELSE 2 END FROM generate_series(10000,11000) n`,[JSON.stringify(['store','s','49'])]);
  const bulk=(await post(owner.h,'/api/stores/s/stocks/publish-preview?warehouse=49')).json();assert.equal(bulk.count,1001);const previousWrites=writes.length;
  assert.equal((await post(owner.h,'/api/stores/s/stocks/publish?warehouse=49',{id:bulk.id})).statusCode,200);
  assert.deepEqual(writes.slice(previousWrites).map(w=>w.stocks.length),[1000,1]);assert.equal(amounts.get(10000),0);
  // A shortage is visible, never silently clamped to zero or sent as negative stock to WB.
  await db.query("INSERT INTO fulfillment_supplies(store_id,id,closed,delivered_at) VALUES('s','shortage',true,$1)",[new Date().toISOString()]);
  for(let n=0;n<12;n++)await db.query("INSERT INTO fulfillment_items(store_id,id,supply_id,snapshot) VALUES('s',$1,'shortage',$2)",['short-'+n,JSON.stringify({warehouseId:47,skus:['first']})]);
  await internalStockTick();assert.equal((await get(owner.h,stocks)).json().items[0].internal.quantity,-1);
  assert.equal((await post(owner.h,'/api/stores/s/stocks/publish-preview?warehouse=47')).statusCode,409);
 }finally{await app.close();}
});
