import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { createApp } from "./app.ts";

test("subscribed workspace persists warehouses, staff, accounting and receipts with tenant isolation and stale-write protection",async()=>{
 const {app,db}=await createApp({key:randomBytes(32),worker:false,testPurchases:true});
 const base={origin:"http://127.0.0.1:8095","x-supplyo-client":"web"};
 async function account(email:string){
  const result=await app.inject({method:"POST",url:"/api/auth/register",headers:base,payload:{name:"Тестовый владелец",email,phone:"+79991234567",password:"Test-password-123",consent:true}});
  assert.equal(result.statusCode,200,result.body);
  return {...base,cookie:String(result.headers["set-cookie"]).split(";")[0]};
 }
 try{
 const owner=await account("workspace-owner@example.test"),other=await account("workspace-other@example.test");
 assert.equal((await app.inject({url:"/api/workspace"})).statusCode,401);
 assert.equal((await app.inject({url:"/api/workspace",headers:owner})).statusCode,403);
 for(const headers of [owner,other])assert.equal((await app.inject({method:"POST",url:"/api/subscription/test-purchase",headers,payload:{plan:"start"}})).statusCode,200);
 async function read(headers=owner){const r=await app.inject({url:"/api/workspace",headers});assert.equal(r.statusCode,200,r.body);return r.json()}
 async function save(kind:string,version:number,data:unknown,headers=owner){return app.inject({method:"POST",url:"/api/workspace/"+kind,headers,payload:{version,data}})}
 assert.deepEqual((await read()).warehouses.data,[]);
 const warehouse={id:"warehouse-test",name:"Тестовый склад",city:"Казань",address:"Складская 1",staff:["employee@example.test"],staffNames:{"employee@example.test":"Сотрудник Тестовый"},staffRights:{"employee@example.test":["view","assembly"]}};
 assert.equal((await save("warehouses",0,[warehouse])).statusCode,200);
 assert.deepEqual((await read()).warehouses.data,[warehouse]);
 assert.deepEqual((await read(other)).warehouses.data,[]);
 assert.equal((await save("warehouses",0,[])).statusCode,409);
 const blank={id:"income-1",kind:"income",warehouseId:warehouse.id,date:"2026-11-10",title:"Услуги",person:"Клиент",amount:5000,quantity:1,rate:0,paid:false,number:"",due:""};
 assert.equal((await save("accounting",0,[{...blank,warehouseId:"foreign"}])).statusCode,409);
 assert.equal((await save("accounting",0,[blank])).statusCode,200);
 assert.equal((await save("warehouses",1,[])).statusCode,409);
 assert.equal((await read()).accounting.data[0].amount,5000);
 const fileId=randomUUID();
 const receipt=await app.inject({method:"POST",url:"/api/workspace/files",headers:{...owner,"content-type":"application/octet-stream","x-file-name":encodeURIComponent("Чек.pdf"),"x-file-id":fileId},payload:Buffer.from("%PDF-test-receipt")});
 assert.equal(receipt.statusCode,200,receipt.body);assert.equal(receipt.json().id,fileId);
 assert.equal((await app.inject({url:"/api/workspace/files/"+fileId,headers:other})).statusCode,404);
 const fetched=await app.inject({url:"/api/workspace/files/"+fileId,headers:owner});assert.equal(fetched.statusCode,200);assert.equal(fetched.body,"%PDF-test-receipt");
 const docs=[{id:fileId,name:"Чек.pdf"}],invoice={...blank,id:"invoice-1",kind:"invoice",amount:2500,number:"СЧ-01",paid:true,documents:docs};
 const payment={...invoice,id:"invoice-payment-invoice-1",kind:"income",title:"Оплата счёта СЧ-01"};
 const work={...blank,id:"work-1",kind:"work",employeeEmail:"employee@example.test",person:"Сотрудник Тестовый",amount:600,quantity:100,rate:6,workItems:[{title:"Упаковка",quantity:100,rate:6}]};
 assert.equal((await save("accounting",1,[blank,invoice,payment,work])).statusCode,200);
 const persisted=await read();assert.equal(persisted.accounting.data.length,4);assert.equal(persisted.accounting.version,2);
 assert.deepEqual((await read(other)).accounting.data,[]);
 assert.equal((await save("accounting",2,[{...blank,id:"bad-work",kind:"work",employeeEmail:"stranger@example.test"}])).statusCode,400);
 const uid=(await db.query<{id:string}>("SELECT id FROM users WHERE email=$1",["workspace-owner@example.test"])).rows[0].id;
 await db.query("UPDATE subscriptions SET expires=0 WHERE user_id=$1",[uid]);
 assert.equal((await save("warehouses",1,[warehouse])).statusCode,403);
 assert.equal((await app.inject({url:"/api/workspace/files/"+fileId,headers:owner})).statusCode,403);
 }finally{await app.close()}
});
