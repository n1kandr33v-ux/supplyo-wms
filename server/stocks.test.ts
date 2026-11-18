import {test} from "node:test";
import assert from "node:assert/strict";
import {randomBytes} from "node:crypto";
import {createApp} from "./app.ts";
import {seal} from "./security.ts";
import {WbError} from "./wb.ts";

test("inventory uses WB catalog + chrtId batches, preserves placement, enforces warehouse grants and employee rights",async()=>{
  const key=randomBytes(32),batches:number[]=[],writes:any[]=[],contentCalls:any[]=[];
  let failure=false,mismatch=false;
  const quantities=new Map<number,number>([[1,24],[2,0],[1002,8]]);
  const {app,db,stockTick}=await createApp({key,worker:false,testPurchases:true,wb:{seller:async()=>({sid:"seller",name:"Shop"}),orders:async()=>[],
    content:async(_token,_path,_method,body:any)=>{contentCalls.push(body);if(failure)throw new WbError(429,60);return body.settings.cursor.nmID?{cards:[{nmID:2,title:"Другой товар",vendorCode:"b",sizes:[{chrtID:1002,techSize:"46",skus:["second"]}]}],cursor:{total:1}}:{cards:[{nmID:1,title:"Блузка",vendorCode:"a",sizes:Array.from({length:1001},(_,i)=>({chrtID:i+1,techSize:"42",skus:["2049000000100",...(i===0?["4649000000100"]:[])]}))}],cursor:{total:100,nmID:1,updatedAt:"2026-11-10T00:00:00Z"}}},
    marketplace:async(_token,path,method="GET",body:any)=>{if(path==="/api/v3/warehouses")return [{id:47,name:"Казань"},{id:49,name:"Москва"}];assert.match(path,/\/api\/v3\/stocks\/(47|49)$/);if(method==="PUT"){writes.push(body);if(!mismatch)for(const s of body.stocks)quantities.set(s.chrtId,s.amount);return {}}assert.equal(method,"POST");assert.ok(!body.skus);assert.ok(body.chrtIds.length<=1000);batches.push(body.chrtIds.length);return {stocks:body.chrtIds.filter((id:number)=>quantities.has(id)).map((id:number)=>({chrtId:id,amount:quantities.get(id)}))}}
  }});
  const base={origin:"http://127.0.0.1:8095","x-supplyo-client":"web"};
  const get=(h:any,path:string)=>app.inject({url:path,headers:h});
  const post=(h:any,path:string,payload:any={})=>app.inject({method:"POST",url:path,headers:h,payload});
  async function user(email:string,paid=false){const signup=await post(base,"/api/auth/register",{email,name:email,password:"Password-12345",phone:"+79991234567",consent:true});assert.equal(signup.statusCode,200,signup.body);const headers={...base,cookie:String(signup.headers["set-cookie"]).split(";")[0]};if(paid)await post(headers,"/api/subscription/test-purchase",{plan:"start"});return {headers,id:(await db.query<any>("SELECT id FROM users WHERE email=$1",[email])).rows[0].id}}
  try{
    const owner=await user("stock-owner@example.test",true),client=await user("stock-client@example.test"),staff=await user("stock-staff@example.test"),other=await user("stock-other@example.test",true);
    await db.query("INSERT INTO stores(id,user_id,credential,fingerprint,name,status) VALUES('inventory',$1,$2,'inventory','Клиент WB','ready')",[client.id,seal("synthetic-token",key)]);
    await db.query(`INSERT INTO client_access(id,store_id,owner_id,warehouse_id,warehouse_name,code_hash,expires,created,fulfillment_id,accepted) VALUES('grant','inventory',$1,'47','Казань','hash',$2,$3,$4,$3)`,[client.id,Date.now()+86400000,Date.now(),owner.id]);
    const url="/api/stores/grant/stocks?warehouse=47&availability=all";
    assert.equal((await get(client.headers,"/api/stores/inventory/stocks?warehouse=47")).statusCode,403);
    assert.equal((await get(other.headers,url)).statusCode,404);
    assert.equal((await get(owner.headers,url.replace("47","49"))).statusCode,403);
    const initial=await get(owner.headers,url);assert.equal(initial.statusCode,200,initial.body);assert.equal(initial.json().sync.status,"queued");assert.equal(contentCalls.length,0,"HTTP view reads only the database");
    await stockTick();
    const loaded=(await get(owner.headers,url)).json();assert.equal(loaded.total,1002);assert.equal(loaded.summary.quantity,32);assert.equal(loaded.summary.positions,2);assert.equal(loaded.summary.unknown,999);assert.deepEqual(batches,[1000,2]);assert.equal(contentCalls[1].settings.cursor.nmID,1);
    const available=(await get(owner.headers,url.replace("all","available"))).json();assert.equal(available.items.length,2);assert.deepEqual(available.items.find((r:any)=>r.chrt_id==='1').barcodes,["2049000000100","4649000000100"]);
    const filtered=(await get(owner.headers,url+"&search=4649000000100")).json();assert.equal(filtered.total,1);
    const item=filtered.items[0],edit="/api/stores/grant/stocks/1?warehouse=47";
    assert.equal((await post(owner.headers,edit,{version:item.version,cell:"Г0-42",address:"A-1-1"})).statusCode,200);assert.equal(writes.length,0,"placement does not change WB stocks");
    assert.equal((await post(owner.headers,edit,{version:item.version,amount:12})).statusCode,409,"stale edit is rejected");
    const current=(await get(owner.headers,url+"&search=4649000000100")).json().items[0];
    assert.equal((await post(owner.headers,edit,{version:current.version,amount:12})).statusCode,200);assert.deepEqual(writes[0],{stocks:[{chrtId:1,amount:12}]});
    const after=(await get(owner.headers,url+"&search=4649000000100")).json().items[0];assert.equal(after.amount,12);assert.equal(after.cell,"Г0-42");assert.equal(after.address,"A-1-1");
    // Placement in operational lists resolves the real cabinet behind a grant and
    // all barcodes, but never a different warehouse or an ambiguous variant.
    await db.query(`INSERT INTO orders(store_id,id,article,skus,created_at,warehouse_id)
      VALUES('inventory','910','Блузка','["4649000000100"]','2026-11-10','47'),
      ('inventory','911','Другой склад','["4649000000100"]','2026-11-10','49')`);
    await db.query(`INSERT INTO fulfillment_items(store_id,id,supply_id,snapshot)
      VALUES('inventory','920','supply','{"warehouseId":47,"skus":["4649000000100"]}'),
      ('inventory','921','other','{"warehouseId":49,"skus":["4649000000100"]}')`);
    const unchangedOrders=(await get(owner.headers,"/api/stores/grant/orders")).json().orders;
    assert.equal(unchangedOrders[0].cell,undefined,"new orders keep their existing response");
    const assemblyPlacement=(await get(owner.headers,"/api/stores/grant/fulfillment")).json().items;
    assert.equal(assemblyPlacement.length,1);assert.equal(assemblyPlacement[0].address,'A-1-1');
    await db.query(`INSERT INTO inventory_items(store_id,warehouse_id,chrt_id,nm_id,title,article,size,barcodes,cell,address)
      VALUES('inventory','49','1','1','Другой склад','a','42','["4649000000100"]','Чужая','Чужой адрес')`);
    assert.equal((await get(owner.headers,"/api/stores/grant/fulfillment")).json().items[0].cell,'Г0-42');
    await db.query(`INSERT INTO inventory_items(store_id,warehouse_id,chrt_id,nm_id,title,article,size,barcodes)
      VALUES('inventory','47','duplicate','1','Неоднозначно','a','42','["4649000000100"]')`);
    assert.equal((await get(owner.headers,"/api/stores/grant/fulfillment")).json().items[0].cell,null);
    await db.query("DELETE FROM inventory_items WHERE chrt_id='duplicate' OR warehouse_id='49'");
    mismatch=true;assert.equal((await post(owner.headers,edit,{version:after.version,amount:9})).statusCode,409);assert.equal((await get(owner.headers,url+"&search=4649000000100")).json().items[0].amount,12,"unconfirmed quantity is not published");mismatch=false;
    const warehouse={id:"physical",name:"Склад ФФ",city:"Казань",address:"Адрес",staff:["stock-staff@example.test"],staffNames:{"stock-staff@example.test":"Сотрудник"},staffRights:{"stock-staff@example.test":["view"]},wmsScopes:[{storeId:"grant",warehouseId:"47"}]};
    assert.equal((await post(owner.headers,"/api/workspace/warehouses",{version:0,data:[warehouse]})).statusCode,200);
    const staffStores=(await get(staff.headers,"/api/stores")).json().stores;assert.equal(staffStores.length,1);const sid=staffStores[0].id;
    assert.equal((await get(staff.headers,`/api/stores/${sid}/stocks?warehouse=47`)).statusCode,200);assert.equal((await get(staff.headers,`/api/stores/${sid}/stocks?warehouse=49`)).statusCode,403);
    assert.equal((await post(staff.headers,`/api/stores/${sid}/stocks/1?warehouse=47`,{version:after.version,amount:3})).statusCode,403);
    warehouse.staffRights["stock-staff@example.test"]=["view","stocks"];
    await post(owner.headers,"/api/workspace/warehouses",{version:1,data:[warehouse]});
    assert.equal((await post(staff.headers,`/api/stores/${sid}/stocks/1?warehouse=47`,{version:after.version,cell:"Г1-42"})).statusCode,200);
    const csv=await get(owner.headers,"/api/stores/grant/stocks-export?warehouse=47&availability=all&search=4649000000100");assert.equal(csv.statusCode,200);assert.ok(csv.body.includes("4649000000100"));assert.ok(csv.body.includes("Г1-42"));
    await db.query("UPDATE inventory_sync SET run_at=0");failure=true;
    await post(owner.headers,"/api/stores/grant/stocks/sync?warehouse=47");await stockTick();
    const preserved=(await get(owner.headers,url)).json();assert.equal(preserved.sync.status,"queued");assert.ok(preserved.sync.error.includes("Лимит"));assert.equal(preserved.summary.quantity,20,"429 never clears previous successful snapshot");
    await db.query("UPDATE client_access SET revoked=$1 WHERE id='grant'",[Date.now()]);
    assert.equal((await get(owner.headers,url)).statusCode,404);assert.equal((await get(staff.headers,`/api/stores/${sid}/stocks?warehouse=47`)).statusCode,404);
  }finally{await app.close()}
});


