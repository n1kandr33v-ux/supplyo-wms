import {test} from 'node:test';import assert from 'node:assert/strict';import {randomBytes} from 'node:crypto';import {createApp} from './app.ts';import {seal,unseal,digest} from './security.ts';import {WbError} from './wb.ts';
test('replace own WB key verifies seller/FBS, preserves all history/access and rejects races safely',async()=>{
 const key=randomBytes(32),old='old-key-synthetic-1234567890',fresh='new-key-synthetic-1234567890';let sellerCalls=0,orderCalls=0,hold:Promise<void>|null=null,release=()=>{};
 const {app,db,tick}=await createApp({key,worker:false,testPurchases:true,wb:{seller:async token=>{sellerCalls++;if(hold)await hold;if(token.startsWith('invalid'))throw new WbError(401);if(token.startsWith('limited'))throw new WbError(429,120);return {sid:token.startsWith('other')?'another-seller':'same-seller',name:'ИП Тест'};},orders:async token=>{orderCalls++;if(token.startsWith('no-fbs'))throw new WbError(403);return [];},marketplace:async()=>[]}});
 const base={origin:'http://127.0.0.1:8095','x-supplyo-client':'web'};const post=(h:any,url:string,payload:any={})=>app.inject({method:'POST',url,headers:h,payload});
 async function user(email:string,paid=false){const r=await post(base,'/api/auth/register',{email,password:'Password-12345',name:email,phone:'+79991234567',consent:true});const h={...base,cookie:String(r.headers['set-cookie']).split(';')[0]};if(paid)await post(h,'/api/subscription/test-purchase',{plan:'solo'});return h;}
 try{
 const owner=await user('key-owner@example.test',true),other=await user('key-other@example.test',true);
 const uid=(await db.query<any>("SELECT id FROM users WHERE email='key-owner@example.test'")).rows[0].id;
 await db.query("INSERT INTO stores(id,user_id,credential,fingerprint,seller_id,name,status) VALUES('key-store',$1,$2,$3,'same-seller','ИП Тест','ready')",[uid,seal(old,key),digest(old)]);
 await db.query("INSERT INTO fulfillment_supplies(store_id,id,warehouse_id,closed) VALUES('key-store','history','47',true)");
 await db.query("INSERT INTO fulfillment_items(store_id,id,supply_id,snapshot,status,printed,label,kiz,decision) VALUES('key-store','1','history','{}','Готов',true,'label','kiz','filled')");
 await db.query("INSERT INTO inventory_items(store_id,warehouse_id,chrt_id,nm_id,title,article,size,barcodes,amount,cell,address) VALUES('key-store','47','1','1','Товар','art','42','[]',7,'Код','А-1-1')");
 await db.query("INSERT INTO workspace_documents(user_id,kind,data,version) VALUES($1,'warehouses',$2,1)",[uid,JSON.stringify([{id:'w',name:'Казань',wmsScopes:[{storeId:'key-store',warehouseId:'47'}]}])]);
 await db.query("INSERT INTO client_access(id,store_id,owner_id,warehouse_id,warehouse_name,code_hash,expires,created) VALUES('grant','key-store',$1,'47','Казань','key-grant',9999999999999,1)",[uid]);
 const snapshots=async()=>JSON.stringify(await Promise.all(['fulfillment_supplies','fulfillment_items','inventory_items','workspace_documents','client_access'].map(t=>db.query('SELECT * FROM '+t).then(r=>r.rows))));const before=await snapshots();
 const change=async(token=fresh,h:any=owner)=>{await db.query("DELETE FROM api_cooldowns WHERE bucket='seller-info'");return post(h,'/api/stores/key-store/credential',{token});};
 const secret=async()=>(await db.query<any>("SELECT credential FROM stores WHERE id='key-store'")).rows[0].credential;
 assert.equal((await change(fresh,base)).statusCode,401);assert.equal((await change(fresh,other)).statusCode,404);assert.equal(sellerCalls,0);
 assert.equal((await change(old)).json().unchanged,true);assert.equal(sellerCalls,0);
 for(const token of ['other-seller-key-synthetic','invalid-key-synthetic-123','no-fbs-key-synthetic-123']){assert.equal((await change(token)).statusCode,400);assert.equal(unseal(await secret(),key),old);}
 assert.equal((await change('limited-key-synthetic-123')).statusCode,429);assert.equal(unseal(await secret(),key),old);
 await db.query("INSERT INTO stores(id,user_id,credential,fingerprint,seller_id,name,status) VALUES('duplicate',$1,'encrypted',$2,'same-seller','Other','ready')",[uid,digest(fresh)]);
 assert.equal((await change()).statusCode,409);await db.query("DELETE FROM stores WHERE id='duplicate'");
 await db.query("INSERT INTO jobs(id,store_id,kind,status) VALUES('held','key-store','sync','running')");assert.equal((await change()).statusCode,409);await db.query("UPDATE jobs SET status='done' WHERE id='held'");
 const changed=await change();assert.equal(changed.statusCode,200,changed.body);assert.equal(unseal(await secret(),key),fresh);assert.equal((await snapshots()),before,'history, inventory, binding and grants unchanged');
 assert.ok(!JSON.stringify(changed.json()).includes(fresh));assert.ok(!(await app.inject({url:'/api/stores',headers:owner})).body.includes(fresh));
 await tick();assert.equal((await db.query<any>("SELECT status FROM stores WHERE id='key-store'")).rows[0].status,'ready');
 hold=new Promise<void>(r=>release=r);const calls=sellerCalls;const pending=change('racing-new-key-synthetic-123');while(sellerCalls===calls)await new Promise(r=>setTimeout(r,5));assert.equal((await change('second-key-synthetic-123')).statusCode,409);
 assert.equal((await post(owner,'/api/stores/key-store/remove',{confirm:true})).statusCode,200);release();const race=await pending;assert.equal(race.statusCode,409);assert.equal(await secret(),'','removal cannot be undone by key replacement');
 assert.ok(orderCalls>=2);
 }finally{release();await app.close();}
});
