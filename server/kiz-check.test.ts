import {test} from "node:test";
import assert from "node:assert/strict";
import {randomBytes} from "node:crypto";
import {createApp} from "./app.ts";
import {seal} from "./security.ts";
import {WbError} from "./wb.ts";
import {createKizChecker} from "./kiz-check.ts";
test("KIZ batches pending orders across supplies, coalesces staff and persists cooldown/backoff",async()=>{
 const key=randomBytes(32),calls:number[][]=[];
 let fail=false,hold:Promise<void>|undefined,release:()=>void=()=>{};
 const {app,db}=await createApp({key,worker:false,testPurchases:true,wb:{
  seller:async()=>({sid:"seller",name:"Shop"}),orders:async()=>[],
  marketplace:async(_token,path,_method,body:any)=>{
   if(path==='/api/v3/warehouses')return [{id:47,name:'Казань'},{id:49,name:'Москва'}];
   assert.equal(path,"/api/marketplace/v3/orders/meta");calls.push(body.orders);
   if(hold)await hold;if(fail)throw new WbError(429,120);
   return {orders:body.orders.map((id:number)=>({id,metaDetails:[{key:"sgtin",decision:id===1000?"sgtinNotFound":id===1001?"pending":id===1003?"filled":"sgtinIntroduced"}]}))};
  }}});
 const base={origin:"http://127.0.0.1:8095","x-supplyo-client":"web"};
 const post=(headers:any,url:string,payload:any={})=>app.inject({method:"POST",url,headers,payload});
 async function user(email:string,paid=false){const r=await post(base,"/api/auth/register",{email,password:"Password-12345",name:email,phone:"+79991234567",consent:true});assert.equal(r.statusCode,200,r.body);const h={...base,cookie:String(r.headers["set-cookie"]).split(";")[0]};if(paid)await post(h,"/api/subscription/test-purchase",{plan:"start"});return h;}
 try{
  const owner=await user("kiz-boss@example.test",true),staff1=await user("kiz-staff1@example.test"),staff2=await user("kiz-staff2@example.test"),stranger=await user("kiz-other@example.test");
  const uid=(await db.query<any>("SELECT id FROM users WHERE email='kiz-boss@example.test'")).rows[0].id;
  await db.query("INSERT INTO stores(id,user_id,credential,fingerprint,name,status) VALUES('kiz-store',$1,$2,'kiz','WB','ready')",[uid,seal("synthetic-token",key)]);
  await post(owner,"/api/workspace/warehouses",{version:0,data:[{id:"physical",name:"Склад",city:"Казань",address:"Адрес",staff:["kiz-staff1@example.test","kiz-staff2@example.test"],staffNames:{"kiz-staff1@example.test":"Сотрудник 1","kiz-staff2@example.test":"Сотрудник 2"},staffRights:{"kiz-staff1@example.test":["view","assembly"],"kiz-staff2@example.test":["view","assembly"]},wmsScopes:[{storeId:"kiz-store",warehouseId:"47"}]}]});
  const route1=(await app.inject({url:"/api/stores",headers:staff1})).json().stores[0].id;
  const route2=(await app.inject({url:"/api/stores",headers:staff2})).json().stores[0].id;
  await db.query("INSERT INTO fulfillment_supplies(store_id,id,warehouse_id,closed) VALUES('kiz-store','a','47',false),('kiz-store','b','47',false),('kiz-store','closed','47',true),('kiz-store','hidden','49',false)");
  const snapshot=JSON.stringify({warehouseId:47,requiredMeta:["sgtin"],skus:["barcode"]});
  await db.query("INSERT INTO fulfillment_items(store_id,id,supply_id,snapshot,kiz,status,printed) SELECT 'kiz-store',n::text,CASE WHEN n<1100 THEN 'a' ELSE 'b' END,$1::jsonb,'test-kiz','Проверяется',n<>1002 FROM generate_series(1000,1149) n",[snapshot]);
  await db.query("INSERT INTO fulfillment_items(store_id,id,supply_id,snapshot,kiz,decision,status,printed) VALUES ('kiz-store','2000','a',$1,'test','sgtinIntroduced','Готов',true),('kiz-store','2001','a',$1,'test','sgtinNotFound','Ошибка КИЗ',true),('kiz-store','2002','closed',$1,'test',NULL,'Проверяется',true),('kiz-store','2003','a',$1,NULL,NULL,'Ожидает',false)",[snapshot]);
  const check=(h=owner,route="kiz-store",supply="a")=>post(h,"/api/stores/"+route+"/supplies/"+supply+"/check");
  assert.equal((await check(stranger,route1)).statusCode,403);
  assert.equal((await check(staff1,route1,"hidden")).statusCode,404);
  assert.equal(calls.length,0);
  hold=new Promise<void>(r=>release=r);
  const first=check(staff1,route1);
  while(!calls.length)await new Promise(r=>setTimeout(r,5));
  const second=check(staff2,route2,"b"),third=check(owner);
  await new Promise(r=>setTimeout(r,25));release();
  const results=await Promise.all([first,second,third]);assert.ok(results.every(r=>r.statusCode===200),results.map(r=>r.body).join("\n"));
  assert.deepEqual(calls.map(x=>x.length),[100,50]);assert.equal(new Set(calls.flat()).size,150);
  assert.ok(calls.flat().every(id=>id>=1000&&id<1150));
  const states=(await db.query<any>("SELECT id,status FROM fulfillment_items WHERE id IN ('1000','1001','1002','1003') ORDER BY id")).rows;
  assert.deepEqual(states.map(i=>i.status),["Ошибка КИЗ","Проверяется","Ожидает","Готов"]);
  await check();assert.equal(calls.length,2,"sequential polls share the cooldown too");
  const restarted=createKizChecker(db,async()=>{throw Error("unexpected WB request");});
  await restarted({id:"kiz-store"});
  await db.query("UPDATE api_cooldowns SET next_at=0 WHERE bucket='kiz-check:kiz-store'");
  fail=true;assert.equal((await check()).statusCode,502);
  assert.deepEqual(calls.at(-1),[1001]);
  const until=Number((await db.query<any>("SELECT next_at FROM api_cooldowns WHERE bucket='kiz-check:kiz-store'")).rows[0].next_at);
  assert.ok(until>=Date.now()+119000);
  await check(staff2,route2);assert.equal(calls.length,3);
  assert.equal((await db.query<any>("SELECT status FROM fulfillment_items WHERE id='1001'")).rows[0].status,"Проверяется","429 is not a KIZ rejection");
  await db.query("UPDATE api_cooldowns SET next_at=0 WHERE bucket='kiz-check:kiz-store'");
  const absent=createKizChecker(db,async()=>({orders:[]}));
  await absent({id:'kiz-store'});
  assert.equal((await db.query<any>("SELECT status FROM fulfillment_items WHERE id='1001'")).rows[0].status,'Проверяется','missing WB result preserves pending state');
  await db.query("UPDATE api_cooldowns SET next_at=0 WHERE bucket='kiz-check:kiz-store'");
  // Interleave a same-code rescan exactly before applying the old response.
  const guardedDb:typeof db={...db,transaction:action=>db.transaction(tx=>action({query:async<R>(sql:string,args?:unknown[])=>{
    if(sql.startsWith('UPDATE fulfillment_items i SET'))await tx.query("UPDATE fulfillment_items SET kiz_revision=kiz_revision+1,decision=NULL,status='Проверяется' WHERE id='1001'");
    return tx.query<R>(sql,args);
  }}))};
  const late=createKizChecker(guardedDb,async()=>({orders:[{id:1001,metaDetails:[{key:'sgtin',decision:'sgtinIntroduced'}]}]}));
  await late({id:'kiz-store'});
  assert.equal((await db.query<any>("SELECT status FROM fulfillment_items WHERE id='1001'")).rows[0].status,'Проверяется','old response cannot approve a re-scanned KIZ');
 }finally{release();await app.close();}
});
