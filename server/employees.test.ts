import {test} from "node:test";
import assert from "node:assert/strict";
import {randomBytes} from "node:crypto";
import {createApp} from "./app.ts";
import {seal} from "./security.ts";

test("employee inherits employer access only within assigned warehouse; rights, revocation and expiry are live",async()=>{
 const key=randomBytes(32),calls:string[]=[];
 const orders=[{id:101,warehouseId:47,article:"Казань",skus:["111"],createdAt:new Date().toISOString()},{id:102,warehouseId:49,article:"Москва",skus:["222"],createdAt:new Date().toISOString()}];
 const {app,db}=await createApp({key,worker:false,testPurchases:true,wb:{seller:async()=>({sid:"test",name:"Test"}),orders:async()=>orders,marketplace:async(_token,path,method="GET")=>{calls.push(method+" "+path);if(path==="/api/v3/warehouses")return [{id:47,name:"Казань"},{id:49,name:"Москва"}];if(path.endsWith("/orders/new"))return {orders};return {}}}});
 const base={origin:"http://127.0.0.1:8095","x-supplyo-client":"web"};
 const post=(h:any,url:string,payload:any={})=>app.inject({method:"POST",url,headers:h,payload});
 const get=(h:any,url:string)=>app.inject({url,headers:h});
 async function user(email:string,paid=false){const r=await post(base,"/api/auth/register",{email,password:"Password-12345",name:email,phone:"+79991234567",consent:true});assert.equal(r.statusCode,200,r.body);const h={...base,cookie:String(r.headers["set-cookie"]).split(";")[0]};if(paid)assert.equal((await post(h,"/api/subscription/test-purchase",{plan:"start"})).statusCode,200);return h}
 try{
  const owner=await user("boss@example.test",true);
  const ownerId=(await db.query<any>("SELECT id FROM users WHERE email='boss@example.test'")).rows[0].id;
  await db.query("INSERT INTO stores(id,user_id,credential,fingerprint,name,status) VALUES('source',$1,$2,'source','Магазин','ready')",[ownerId,seal("synthetic-token",key)]);
  for(const o of orders)await db.query("INSERT INTO orders(store_id,id,article,skus,warehouse_id,created_at) VALUES('source',$1,$2,$3,$4,$5)",[String(o.id),o.article,JSON.stringify(o.skus),String(o.warehouseId),o.createdAt]);
  const beforeDashboard=calls.length;
  const ownDashboard=await get(owner,"/api/dashboard");assert.equal(ownDashboard.statusCode,200,ownDashboard.body);
  assert.deepEqual(ownDashboard.json().warehouses.map((w:any)=>[w.warehouse_id,w.new_orders]),[["47",1],["49",1]],"paid owner sees all cached store warehouses");
  assert.equal(calls.length,beforeDashboard,"dashboard never calls WB");
  await db.query("INSERT INTO store_warehouses(store_id,id,name) VALUES('source','50','Пустой склад')");
  assert.equal((await get(owner,"/api/dashboard")).json().warehouses.find((w:any)=>w.warehouse_id==='50').new_orders,0,"known warehouse is visible without orders");
  const warehouse={id:"physical",name:"ОптимумПак",city:"Казань",address:"Адрес",staff:["staff@example.test"],staffNames:{"staff@example.test":"Сотрудник"},staffRights:{"staff@example.test":["view","assembly","manage"]},wmsScopes:[{storeId:"source",warehouseId:"47"}]};
  const second={id:"second",name:"Другой склад",city:"Москва",address:"Адрес",staff:[]};
  assert.equal((await post(owner,"/api/workspace/warehouses",{version:0,data:[warehouse,second]})).statusCode,200);
  // Invite created before registration; membership is discovered without copying the owner's subscription.
  const staff=await user("staff@example.test"),outsider=await user("other@example.test");
  const me=(await get(staff,"/api/me")).json();assert.equal(me.subscription.active,false);assert.equal(me.employeeAccess.length,1);
  assert.deepEqual((await get(staff,"/api/dashboard")).json().warehouses.map((w:any)=>[w.warehouse_id,w.new_orders]),[["47",1]]);
  assert.deepEqual((await get(outsider,"/api/dashboard")).json(),{warehouses:[]});
  const stores=(await get(staff,"/api/stores")).json().stores;assert.equal(stores.length,1);assert.ok(!JSON.stringify(stores).includes("credential"));const id=stores[0].id;
  const scoped=await get(staff,`/api/stores/${id}/orders?warehouse=49`);assert.equal(scoped.statusCode,200,scoped.body);assert.deepEqual(scoped.json().orders.map((o:any)=>o.id),["101"]);
  assert.equal((await get(staff,"/api/stores/source/orders")).statusCode,404);
  assert.equal((await get(outsider,`/api/stores/${id}/orders`)).statusCode,403);
  const before=calls.length;assert.equal((await post(staff,`/api/stores/${id}/supplies/create`,{orders:["101"],name:"Нет прав"})).statusCode,403);assert.equal(calls.length,before);
  const team=me.employeeAccess[0].id;
  const ws=(await get(staff,"/api/workspace?team="+team)).json();assert.equal(ws.warehouses.data.length,1);assert.equal(ws.accounting.data.length,0);
  const edited={...warehouse,address:"Новый адрес"};
  const save=await post(staff,"/api/workspace/warehouses?team="+team,{version:ws.warehouses.version,data:[edited]});assert.equal(save.statusCode,200,save.body);
  assert.equal((await get(owner,"/api/workspace")).json().warehouses.data.length,2,"other warehouses are preserved");
  assert.equal((await post(staff,"/api/workspace/warehouses?team="+team,{version:save.json().version,data:[{...edited,staffRights:{"staff@example.test":["view","assembly","supplies","manage"]}}]})).statusCode,403);
  assert.equal((await post(staff,"/api/workspace/accounting?team="+team,{version:0,data:[]})).statusCode,403);
  // Remove assembly permission. Read remains available, mutations do not.
  const snapshot=(await get(owner,"/api/workspace")).json();
  const updated={...edited,staffRights:{"staff@example.test":["view"]}};
  assert.equal((await post(owner,"/api/workspace/warehouses",{version:snapshot.warehouses.version,data:[updated,second]})).statusCode,200);
  assert.equal((await post(staff,`/api/stores/${id}/items/101/scan`,{})).statusCode,403);
  assert.equal((await get(staff,"/api/workspace?team="+team)).statusCode,403);
  assert.equal((await get(staff,`/api/stores/${id}/orders`)).statusCode,200);
  await db.query("UPDATE subscriptions SET expires=0 WHERE user_id=$1",[ownerId]);
  assert.equal((await get(staff,"/api/stores")).json().stores.length,0);assert.equal((await get(staff,`/api/stores/${id}/orders`)).statusCode,403);
  await post(owner,"/api/subscription/test-purchase",{plan:"start"});
  await db.query("UPDATE workspace_documents SET data=$2::jsonb WHERE user_id=$1 AND kind='warehouses'",[ownerId,JSON.stringify([{...updated,staff:[],staffRights:{}},second])]);
  assert.equal((await get(staff,"/api/me")).json().employeeAccess.length,0);assert.equal((await get(staff,"/api/stores")).json().stores.length,0);
 }finally{await app.close()}
});


test("connecting another client preserves legacy single-warehouse employee access and scoped isolation",async()=>{
 const key=randomBytes(32),calls:string[]=[];
 const {app,db}=await createApp({key,worker:false,testPurchases:true,wb:{seller:async()=>({sid:"test",name:"Test"}),orders:async()=>[],marketplace:async(_token,path)=>{calls.push(path);return []}}});
 const base={origin:"http://127.0.0.1:8095","x-supplyo-client":"web"};
 const post=(h:any,url:string,payload:any={})=>app.inject({method:"POST",url,headers:h,payload});
 const get=(h:any,url:string)=>app.inject({url,headers:h});
 async function user(email:string,paid=false){const r=await post(base,"/api/auth/register",{email,password:"Password-12345",name:email,phone:"+79991234567",consent:true});assert.equal(r.statusCode,200,r.body);const headers={...base,cookie:String(r.headers["set-cookie"]).split(";")[0]};if(paid)assert.equal((await post(headers,"/api/subscription/test-purchase",{plan:"start"})).statusCode,200);return {headers,id:(await db.query<any>("SELECT id FROM users WHERE email=$1",[email])).rows[0].id}}
 try{
  const owner=await user("legacy-boss@example.test",true),client=await user("legacy-client@example.test"),staff=await user("legacy-staff@example.test");
  const warehouse={id:"physical",name:"ОптимумПак",city:"Казань",address:"Адрес",staff:["legacy-staff@example.test"],staffRights:{"legacy-staff@example.test":["view","assembly"]}};
  await db.query("INSERT INTO workspace_documents(user_id,kind,data,version) VALUES($1,'warehouses',$2::jsonb,1)",[owner.id,JSON.stringify([warehouse])]);
  for(const store of ["client-one","client-two","own-unassigned"]){
   await db.query("INSERT INTO stores(id,user_id,credential,fingerprint,name,status) VALUES($1,$2,$3,$1,$1,'ready')",[store,store==="own-unassigned"?owner.id:client.id,seal("synthetic-token",key)]);
   for(const wid of ["47","49"])await db.query("INSERT INTO orders(store_id,id,article,skus,warehouse_id,created_at) VALUES($1,$2,'Test','[\"111\"]'::jsonb,$3,$4)",[store,wid,wid,new Date().toISOString()]);
  }
  async function grant(id:string,store:string,wid:string){await db.query(`INSERT INTO client_access(id,store_id,owner_id,warehouse_id,warehouse_name,code_hash,expires,created,fulfillment_id,accepted) VALUES($1,$2,$3,$4,'Казань',$1,$5,$6,$7,$6)`,[id,store,client.id,wid,Date.now()+86400000,Date.now(),owner.id])}
  await grant("grant-one","client-one","47");
  const initial=(await get(staff.headers,"/api/stores")).json().stores;assert.equal(initial.length,1);const originalId=initial[0].id;
  await grant("grant-two","client-two","49");
  const after=(await get(staff.headers,"/api/stores")).json().stores;
  assert.equal(after.length,2,"second client does not erase existing access");assert.ok(after.some((s:any)=>s.id===originalId));
  assert.ok(after.every((s:any)=>s.employee&&!s.credential));
  for(const s of after){const r=await get(staff.headers,`/api/stores/${s.id}/orders?warehouse=${s.cabinet_id==="client-one"?"49":"47"}`);assert.equal(r.statusCode,200,r.body);assert.deepEqual(r.json().orders.map((o:any)=>o.id),[s.cabinet_id==="client-one"?"47":"49"])}
  assert.equal((await get(staff.headers,"/api/stores/own-unassigned/orders")).statusCode,404,"own stores require assignment");
  const dashboard=(await get(staff.headers,"/api/dashboard")).json().warehouses;assert.equal(dashboard.length,2);assert.ok(dashboard.every((w:any)=>w.new_orders===1));
  const clientDashboard=(await get(client.headers,"/api/dashboard")).json().warehouses;assert.ok(clientDashboard.every((w:any)=>w.fulfillments.includes("ОптимумПак")),"physical warehouse name survives second grant");
  const options=(await get(owner.headers,"/api/workspace/bindings")).json().options;assert.equal(options.filter((o:any)=>o.defaultAssigned).length,2);
  assert.equal(calls.filter(p=>p!=="/api/v3/warehouses").length,0,"reads do not mutate WB");
  await db.query("UPDATE client_access SET revoked=$1 WHERE id='grant-two'",[Date.now()]);
  assert.deepEqual((await get(staff.headers,"/api/stores")).json().stores.map((s:any)=>s.id),[originalId],"revocation affects only the revoked cabinet");
  assert.equal((await get(staff.headers,`/api/stores/${after.find((s:any)=>s.id!==originalId).id}/orders`)).statusCode,404);
  await db.query("UPDATE workspace_documents SET data=$2::jsonb WHERE user_id=$1 AND kind='warehouses'",[owner.id,JSON.stringify([{...warehouse,wmsScopes:[]}])]);
  assert.equal((await get(staff.headers,"/api/stores")).json().stores.length,0,"explicit empty binding overrides legacy inheritance");
  await db.query("UPDATE workspace_documents SET data=$2::jsonb WHERE user_id=$1 AND kind='warehouses'",[owner.id,JSON.stringify([warehouse,{...warehouse,id:"second",staff:[]}])]);
  assert.equal((await get(staff.headers,"/api/stores")).json().stores.length,0,"multiple physical warehouses require explicit assignment");
 }finally{await app.close()}
});
