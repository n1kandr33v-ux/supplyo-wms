import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { createApp } from "./app.ts";
import { digest } from "./security.ts";

test("one-time warehouse delegation, paid recipient, isolated reads/mutations and revocation",async()=>{
  let orderCalls=0;
  const calls:string[]=[];
  const orders=[{id:101,article:"Казань",skus:["111"],createdAt:"2026-11-10T08:00:00Z",warehouseId:47},{id:102,article:"Москва",skus:["222"],createdAt:"2026-11-10T09:00:00Z",warehouseId:49}];
  const {app,db,tick}=await createApp({key:randomBytes(32),worker:false,testPurchases:true,wb:{
    seller:async()=>({sid:"seller",name:"Магазин клиента"}),orders:async()=>{orderCalls++;return orders},
    marketplace:async(_token,path)=>{calls.push(path);if(path==="/api/v3/warehouses")return [{id:47,name:"Казань"},{id:49,name:"Москва"}];if(path==="/api/v3/orders/new")return {orders};if(path==="/api/v3/supplies")return {id:"SUPPLY-47"};return {};}
  }});
  const headers={origin:"http://127.0.0.1:8095","x-supplyo-client":"web"};
  async function user(email:string,paid=false){
    const r=await app.inject({method:"POST",url:"/api/auth/register",headers,payload:{email,password:"Password-12345",name:email,phone:"+79991234567",consent:true}});
    assert.equal(r.statusCode,200,r.body);
    const auth={...headers,cookie:r.headers["set-cookie"]!.toString().split(";")[0]};
    if(paid)assert.equal((await app.inject({method:"POST",url:"/api/subscription/test-purchase",headers:auth,payload:{plan:"solo"}})).statusCode,200);
    return auth;
  }
  const post=(auth:any,url:string,payload:any={})=>app.inject({method:"POST",url,headers:auth,payload});
  const get=(auth:any,url:string)=>app.inject({url,headers:auth});
  try{
    const owner=await user("owner@example.test"),ff=await user("ff@example.test",true),ff2=await user("ff2@example.test",true),unpaid=await user("unpaid@example.test");
    assert.equal((await app.inject({url:"/api/dashboard"})).statusCode,401);
    assert.deepEqual((await get(owner,"/api/dashboard")).json(),{warehouses:[]});
    const connected=await post(owner,"/api/stores",{token:"real-format-but-synthetic-token-12345"});assert.equal(connected.statusCode,202,connected.body);
    const storeId=connected.json().id;
    await tick();assert.equal(orderCalls,0,"unsubscribed owner only verifies credentials");
    const generate=()=>post(owner,"/api/access/codes",{storeId,warehouseId:"47"});
    assert.equal((await post(ff,"/api/access/codes",{storeId,warehouseId:"47"})).statusCode,404);
    assert.equal((await post(owner,"/api/access/codes",{storeId,warehouseId:"999"})).statusCode,400);
    const generated=await generate();assert.equal(generated.statusCode,200,generated.body);
    const {code,id}=generated.json();
    assert.deepEqual((await get(owner,"/api/dashboard")).json(),{warehouses:[]},"pending code is not a connected warehouse");
    const stored=(await db.query<any>("SELECT * FROM client_access WHERE id=$1",[id])).rows[0];assert.equal(stored.code_hash,digest(code));assert.ok(!JSON.stringify(stored).includes(code));
    assert.ok(!(await get(owner,"/api/access/outgoing")).body.includes(code));
    assert.equal((await post(unpaid,"/api/access/redeem",{code})).statusCode,403);
    const attempts=await Promise.all([post(ff,"/api/access/redeem",{code}),post(ff2,"/api/access/redeem",{code})]);
    assert.deepEqual(attempts.map(a=>a.statusCode).sort(),[200,400]);
    const recipient=attempts[0].statusCode===200?ff:ff2,other=recipient===ff?ff2:ff;
    const dashboard=(await get(owner,"/api/dashboard")).json();
    assert.equal(dashboard.warehouses.length,1,"unpaid owner can view accepted warehouses");
    assert.equal(dashboard.warehouses[0].warehouse_name,"Казань");
    assert.equal(dashboard.warehouses[0].warehouse_id,"47");
    assert.deepEqual(dashboard.warehouses[0].fulfillments,[],"never substitute registered user's name for an unconfigured warehouse");
    const fulfillmentDashboard=(await get(recipient,"/api/dashboard")).json();
    assert.deepEqual(fulfillmentDashboard.warehouses.map((w:any)=>w.warehouse_id),["47"],"fulfillment sees incoming client warehouse only");
    assert.deepEqual(fulfillmentDashboard.warehouses[0].fulfillments,[],"do not label fulfillment as its own contractor");
    assert.ok(!JSON.stringify(dashboard).includes("credential"));
    assert.ok(!JSON.stringify(dashboard).includes("code_hash"));
    assert.deepEqual((await get(other,"/api/dashboard")).json(),{warehouses:[]},"another user cannot see the owner's dashboard");
    const clients=(await get(recipient,"/api/access/incoming")).json().clients;assert.equal(clients.length,1);assert.equal(clients[0].warehouse_name,"Казань");
    const stores=(await get(recipient,"/api/stores")).json().stores;assert.equal(stores.length,1);assert.equal(stores[0].id,id);assert.equal(stores[0].delegated,true);assert.ok(!JSON.stringify(stores).includes("credential"));
    assert.equal((await get(recipient,`/api/stores/${storeId}/warehouses`)).statusCode,404);
    assert.deepEqual((await get(recipient,`/api/stores/${id}/warehouses`)).json(),{scoped:true,warehouses:[{id:"47",name:"Казань"}]});
    await tick();assert.equal(orderCalls,1,"paid fulfillment syncs the unpaid owner's store");
    assert.equal((await get(owner,"/api/dashboard")).json().warehouses[0].new_orders,1,"new-order count excludes Moscow");
    const scoped=await get(recipient,`/api/stores/${id}/orders?warehouse=49`);assert.equal(scoped.statusCode,200,scoped.body);assert.deepEqual(scoped.json().orders.map((o:any)=>o.id),["101"]);
    assert.equal((await get(owner,`/api/stores/${storeId}/orders`)).statusCode,403);
    assert.equal((await get(other,`/api/stores/${id}/orders`)).statusCode,404);
    const start=calls.length;
    const wrong=await post(recipient,`/api/stores/${id}/supplies/create`,{orders:["102"],name:"Чужой склад"});assert.equal(wrong.statusCode,403,wrong.body);assert.ok(!calls.slice(start).includes("/api/v3/supplies"));
    const right=await post(recipient,`/api/stores/${id}/supplies/create`,{orders:["101"],name:"Казань"});assert.equal(right.statusCode,200,right.body);
    await db.query("INSERT INTO fulfillment_supplies(store_id,id,name,created,warehouse_id) VALUES($1,'FOREIGN','Москва','2026-11-10','49')",[storeId]);
    await db.query("INSERT INTO fulfillment_items(store_id,id,supply_id,snapshot,label,status) VALUES($1,'102','FOREIGN',$2,'label','Готов')",[storeId,JSON.stringify(orders[1])]);
    const summary=(await get(owner,"/api/dashboard")).json().warehouses[0];
    assert.equal(summary.assembly_orders,1,"assembly count excludes other warehouses");
    assert.equal(summary.ready_orders,0,"other warehouse's ready items are excluded");
    assert.equal(summary.supplies_count,1,"count supplies, not orders, within the allowed warehouse");
    await db.query("INSERT INTO fulfillment_supplies(store_id,id,warehouse_id,closed) VALUES($1,'CLOSED-COUNT','47',true)",[storeId]);
    assert.equal((await get(owner,"/api/dashboard")).json().warehouses[0].supplies_count,2,"both open and delivered supplies are counted, including empty supplies with a known warehouse");
    await db.query("DELETE FROM fulfillment_supplies WHERE store_id=$1 AND id='CLOSED-COUNT'",[storeId]);
    assert.equal((await get(recipient,"/api/dashboard")).json().warehouses[0].assembly_orders,1);
    const recipientId=(await db.query<any>("SELECT fulfillment_id FROM client_access WHERE id=$1",[id])).rows[0].fulfillment_id;
    const subscription=(await db.query<any>("SELECT expires FROM subscriptions WHERE user_id=$1",[recipientId])).rows[0];
    await db.query("UPDATE subscriptions SET expires=0 WHERE user_id=$1",[recipientId]);
    assert.deepEqual((await get(owner,"/api/dashboard")).json(),{warehouses:[]},"expired fulfillment no longer has a connected warehouse");
    await db.query("UPDATE subscriptions SET expires=$2 WHERE user_id=$1",[recipientId,subscription.expires]);
    const view=await get(recipient,`/api/stores/${id}/fulfillment`);assert.equal(view.statusCode,200,view.body);assert.deepEqual(view.json().supplies.map((s:any)=>s.id),["SUPPLY-47"]);assert.deepEqual(view.json().items.map((i:any)=>i.id),["101"]);
    const before=calls.length;
    for(const path of ["items/102/scan","items/102/printed","supplies/FOREIGN/check","supplies/FOREIGN/deliver","supplies/FOREIGN/labels","supplies/FOREIGN/labels-printed"]){const r=await post(recipient,`/api/stores/${id}/${path}`,{});assert.equal(r.statusCode,404,r.body)}
    assert.equal(calls.length,before,"out-of-scope requests never reach WB");
    // Legacy single-warehouse fulfillment employee inherits the existing delegated scope.
    const employee=await user("employee@example.test");
    const saved=await post(recipient,"/api/workspace/warehouses",{version:0,data:[{id:"physical",name:"Склад фулфилмента",city:"Казань",address:"Адрес",staff:["employee@example.test"],staffNames:{"employee@example.test":"Сотрудник"},staffRights:{"employee@example.test":["view","assembly"]}}]});assert.equal(saved.statusCode,200,saved.body);
    const employeeStores=(await get(employee,"/api/stores")).json().stores;assert.equal(employeeStores.length,1);const employeeId=employeeStores[0].id;
    assert.deepEqual((await get(employee,"/api/dashboard")).json().warehouses.map((w:any)=>[w.warehouse_id,w.assembly_orders]),[["47",1]],"employee sees assigned warehouse only");
    assert.deepEqual((await get(employee,`/api/stores/${employeeId}/orders?warehouse=49`)).json().orders.map((o:any)=>o.id),[]);
    assert.deepEqual((await get(employee,`/api/stores/${employeeId}/fulfillment`)).json().items.map((i:any)=>i.id),["101"]);
    assert.deepEqual((await get(owner,"/api/dashboard")).json().warehouses[0].fulfillments,["Склад фулфилмента"],"client sees physical fulfillment warehouse name");
    assert.deepEqual((await get(recipient,"/api/dashboard")).json().warehouses[0].fulfillments,[],"fulfillment never sees its own contractor label");
    // Multiple physical warehouses require an exact cabinet/warehouse binding.
    const physicalWarehouses=[
      {id:"physical",name:"ОптимумПак",city:"Казань",address:"Адрес",staff:[],wmsScopes:[{storeId:id,warehouseId:"47"}]},
      {id:"other-physical",name:"Другой склад",city:"Москва",address:"Адрес",staff:[],wmsScopes:[]}
    ];
    assert.equal((await post(recipient,"/api/workspace/warehouses",{version:1,data:physicalWarehouses})).statusCode,200);
    assert.deepEqual((await get(owner,"/api/dashboard")).json().warehouses[0].fulfillments,["ОптимумПак"]);
    assert.deepEqual((await get(recipient,"/api/dashboard")).json().warehouses[0].fulfillments,[]);
    assert.equal((await post(recipient,"/api/workspace/warehouses",{version:2,data:physicalWarehouses.map(({wmsScopes,...w})=>w)})).statusCode,200);
    assert.deepEqual((await get(owner,"/api/dashboard")).json().warehouses[0].fulfillments,[],"ambiguous warehouse names are not guessed");
    const second=await generate();assert.equal((await post(recipient,"/api/access/redeem",{code:second.json().code})).statusCode,409,"same cabinet/warehouse cannot be duplicated");
    assert.equal((await post(other,`/api/access/${id}/revoke`)).statusCode,404);
    assert.equal((await post(owner,`/api/access/${id}/revoke`)).statusCode,200);
    assert.deepEqual((await get(owner,"/api/dashboard")).json(),{warehouses:[]},"revoked warehouse disappears from owner dashboard");
    assert.equal((await get(recipient,"/api/stores")).json().stores.length,0);
    assert.deepEqual((await get(recipient,"/api/dashboard")).json(),{warehouses:[]},"revocation removes fulfillment dashboard scope immediately");
    assert.deepEqual((await get(employee,"/api/dashboard")).json(),{warehouses:[]},"revocation removes employee dashboard scope immediately");
    assert.equal((await get(employee,"/api/stores")).json().stores.length,0);assert.equal((await get(employee,`/api/stores/${employeeId}/fulfillment`)).statusCode,403);
    for(const path of ["orders","warehouses","fulfillment"]){assert.equal((await get(recipient,`/api/stores/${id}/${path}`)).statusCode,404)}
    assert.equal((await post(recipient,`/api/stores/${id}/items/101/scan`,{})).statusCode,404);
    assert.equal((await post(recipient,"/api/access/redeem",{code})).statusCode,400);
    const expired=await generate();await db.query("UPDATE client_access SET expires=0 WHERE id=$1",[expired.json().id]);assert.equal((await post(other,"/api/access/redeem",{code:expired.json().code})).statusCode,400);
    const fresh=await generate();
    const another=await post(other,"/api/stores",{token:"synthetic-key-own-second-store-12345"});assert.equal(another.statusCode,202);
    assert.equal((await post(other,"/api/access/redeem",{code:fresh.json().code})).statusCode,403,"own stores and client cabinets share subscription capacity");
  }finally{await app.close()}
});

