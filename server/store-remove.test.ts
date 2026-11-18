import {test} from "node:test";
import assert from "node:assert/strict";
import {randomBytes} from "node:crypto";
import {createApp} from "./app.ts";
test("store removal is owner-only, revokes access, preserves history and cannot be undone by in-flight sync",async()=>{
 let calls=0,hold:Promise<void>|undefined,release:()=>void=()=>{};
 const key=randomBytes(32),token="synthetic-store-token-for-removal";
 const {app,db,tick}=await createApp({key,worker:false,testPurchases:true,wb:{
  seller:async()=>({sid:"seller",name:"ИП Тестовый"}),orders:async()=>{calls++;if(hold)await hold;return [{id:calls,article:"Товар",skus:["barcode"],warehouseId:47,createdAt:"2026-11-11T00:00:00Z"}]},
  marketplace:async()=>[{id:47,name:"Казань"}],
 }});
 const base={origin:"http://127.0.0.1:8095","x-supplyo-client":"web"};
 const post=(h:any,url:string,payload:any={})=>app.inject({method:"POST",url,headers:h,payload});
 const get=(h:any,url:string)=>app.inject({url,headers:h});
 async function user(email:string,paid=false){const r=await post(base,"/api/auth/register",{email,password:"Password-12345",name:email,phone:"+79991234567",consent:true});assert.equal(r.statusCode,200,r.body);const h={...base,cookie:String(r.headers["set-cookie"]).split(";")[0]};if(paid)await post(h,"/api/subscription/test-purchase",{plan:"start"});return h;}
 try{
  const owner=await user("remove-owner@example.test",true),other=await user("remove-other@example.test",true),employee=await user("remove-staff@example.test");
  const added=await post(owner,"/api/stores",{token});assert.equal(added.statusCode,202,added.body);const id=added.json().id;
  await tick();assert.equal(calls,1);
  const uid=(await db.query<any>("SELECT user_id FROM stores WHERE id=$1",[id])).rows[0].user_id;
  const otherId=(await db.query<any>("SELECT id FROM users WHERE email='remove-other@example.test'")).rows[0].id;
  const warehouse={id:"physical",name:"Склад",city:"Казань",address:"Адрес",staff:["remove-staff@example.test"],staffNames:{"remove-staff@example.test":"Сотрудник"},staffRights:{"remove-staff@example.test":["view","assembly","manage"]},wmsScopes:[{storeId:id,warehouseId:"47"}]};
  const saved=await post(owner,"/api/workspace/warehouses",{version:0,data:[warehouse]});assert.equal(saved.statusCode,200,saved.body);
  const staffRoute=(await get(employee,"/api/stores")).json().stores[0].id;
  await db.query("INSERT INTO client_access(id,store_id,owner_id,warehouse_id,warehouse_name,code_hash,expires,created,fulfillment_id,accepted) VALUES('remove-grant',$1,$2,'47','Казань','hash',$3,$4,$5,$4)",[id,uid,Date.now()+86400000,Date.now(),otherId]);
  await db.query("INSERT INTO fulfillment_supplies(store_id,id,warehouse_id,closed) VALUES($1,'history','47',true)",[id]);
  await db.query("INSERT INTO fulfillment_items(store_id,id,supply_id,snapshot,status,printed) VALUES($1,'99','history',$2,'Готов',true)",[id,JSON.stringify({warehouseId:47,skus:["barcode"],requiredMeta:[]})]);
  await db.query("INSERT INTO inventory_items(store_id,warehouse_id,chrt_id,nm_id,title,article,size,barcodes,cell,address) VALUES($1,'47','1','1','Товар','a','42','[\"barcode\"]','Код','A-1-1')",[id]);
  const remove=(h:any=owner,route=id,payload:any={confirm:true})=>post(h,"/api/stores/"+route+"/remove",payload);
  assert.equal((await remove(owner,id,{})).statusCode,400);
  assert.equal((await remove(other)).statusCode,404);
  assert.equal((await remove(employee,staffRoute)).statusCode,404);
  assert.equal((await remove(base)).statusCode,401);
  assert.equal((await get(owner,"/api/stores")).json().stores.length,1);
  // Let a successful WB read finish only after removal has committed.
  hold=new Promise<void>(r=>release=r);
  await post(owner,"/api/stores/"+id+"/sync");
  const syncing=tick();
  while(calls<2)await new Promise(r=>setTimeout(r,5));
  const removed=await remove();assert.equal(removed.statusCode,200,removed.body);
  release();await syncing;
  const state=(await db.query<any>("SELECT status,credential,removed_at FROM stores WHERE id=$1",[id])).rows[0];
  assert.equal(state.status,"removed");assert.equal(state.credential,"");assert.ok(Number(state.removed_at)>0);
  assert.deepEqual((await get(owner,"/api/stores")).json().stores,[]);
  assert.deepEqual((await get(other,"/api/stores")).json().stores,[]);
  assert.deepEqual((await get(employee,"/api/stores")).json().stores,[]);
  assert.deepEqual((await get(owner,"/api/dashboard")).json().warehouses,[]);
  assert.equal((await get(other,"/api/stores/remove-grant/fulfillment")).statusCode,404);
  assert.equal((await get(employee,"/api/stores/"+staffRoute+"/orders")).statusCode,404);
  assert.equal((await post(owner,"/api/stores/"+id+"/sync")).statusCode,404);
  assert.equal((await db.query("SELECT 1 FROM fulfillment_items WHERE store_id=$1",[id])).rows.length,1);
  assert.equal((await db.query("SELECT 1 FROM inventory_items WHERE store_id=$1",[id])).rows.length,1);
  assert.equal((await db.query<any>("SELECT id FROM orders WHERE store_id=$1",[id])).rows[0].id,"1","late refresh cannot replace history after removal");
  assert.equal((await db.query("SELECT 1 FROM jobs WHERE store_id=$1 AND status IN ('queued','running')",[id])).rows.length,0);
  assert.ok((await db.query<any>("SELECT revoked FROM client_access WHERE id='remove-grant'")).rows[0].revoked);
  const doc=(await db.query<any>("SELECT data,version FROM workspace_documents WHERE user_id=$1 AND kind='warehouses'",[uid])).rows[0];
  assert.deepEqual(doc.data[0].wmsScopes,[]);assert.equal(doc.data[0].staff.length,1);
  assert.equal((await remove()).statusCode,200,"repeat removal is idempotent");
  await tick();assert.equal(calls,2);
  assert.equal((await post(other,"/api/stores",{token})).statusCode,409,"another account cannot claim preserved history");
  const reconnect=await post(owner,"/api/stores",{token});assert.equal(reconnect.statusCode,202,reconnect.body);assert.equal(reconnect.json().id,id);
  assert.deepEqual((await get(employee,"/api/stores")).json().stores,[],"reconnect does not re-grant removed bindings");
  assert.deepEqual((await get(other,"/api/stores")).json().stores,[],"reconnect does not revive grants");
 }finally{release();await app.close();}
});
