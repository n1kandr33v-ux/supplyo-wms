import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createApp} from './app.ts';
test('platform administration is permission scoped, audited, secret free and fulfillment warehouse scoped',async()=>{
 const {app,db}=await createApp({key:Buffer.alloc(32,1),worker:false,adminEmail:'root@example.test'});
 const headers={origin:'http://localhost:8095','x-supplyo-client':'web'};
 const post=(path:string,payload:unknown,cookie='')=>app.inject({method:'POST',url:path,headers:{...headers,cookie},payload:payload as Record<string,unknown>});
 const get=(path:string,cookie='')=>app.inject({url:path,headers:{cookie}});
 async function register(email:string){const r=await post('/api/auth/register',{email,password:'Password123',name:'Test User',phone:'+79991234567',consent:true});assert.equal(r.statusCode,200);const id=(await db.query<{id:string}>('SELECT id FROM users WHERE email=$1',[email])).rows[0].id;return {id,cookie:String(r.headers['set-cookie']).split(';')[0]}}
 try{
  const root=await register('root@example.test'),reader=await register('reader@example.test'),seller=await register('seller@example.test'),ff=await register('ff@example.test');
  assert.equal((await get('/api/admin/users')).statusCode,401);
  for(const path of ['users','stores','orders','fulfillments','admins','audit'])assert.equal((await get('/api/admin/'+path,reader.cookie)).statusCode,403);
  assert.equal((await post('/api/admin/subscription',{userId:seller.id,expires:Date.now()+86400000,limit:3,reason:'Test grant'},reader.cookie)).statusCode,403);
  const store=randomUUID();await db.query("INSERT INTO stores(id,user_id,credential,fingerprint,name,status) VALUES($1,$2,'SECRET_API_KEY','unique','Test shop','ready')",[store,seller.id]);
  await db.query("INSERT INTO orders VALUES($1,'first','Product A','[]','2026-11-23','one'),($1,'second','Product B','[]','2026-11-23','two')",[store]);
  await db.query("INSERT INTO fulfillment_supplies(store_id,id,name,created,warehouse_id) VALUES($1,'supply','Supply','2026-11-22','one')",[store]);
  await db.query("INSERT INTO fulfillment_items(store_id,id,supply_id,snapshot) VALUES($1,'historic','supply',$2::jsonb)",[store,JSON.stringify({article:'Historic product',warehouseId:'one'})]);
  await db.query("INSERT INTO ozon_postings(store_id,posting_number,order_number,status,products,warehouse_id,created_at,updated_at) VALUES($1,'ozon-posting','ozon-order','delivering','[{\"name\":\"Ozon item\"}]','one','2026-11-23',0)",[store]);
  await db.query('INSERT INTO client_access(id,store_id,owner_id,warehouse_id,warehouse_name,code_hash,expires,created,fulfillment_id,accepted) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$8)',[randomUUID(),store,seller.id,'one','Kazan','codehash',Date.now()+86400000,Date.now(),ff.id]);
  await db.query("INSERT INTO workspace_documents(user_id,kind,data) VALUES($1,'warehouses',$2::jsonb)",[ff.id,JSON.stringify([{id:'warehouse',name:'Kazan',city:'Kazan',staff:[]}])]);
  const users=await get('/api/admin/users',root.cookie);assert.equal(users.statusCode,200);assert.equal(users.json().total,4);assert.ok(!users.body.includes('password'));assert.ok(!users.body.includes('SECRET_API_KEY'));
  const stores=await get('/api/admin/stores?fulfillmentId='+ff.id,root.cookie);assert.equal(stores.statusCode,200);assert.equal(stores.json().total,1);assert.ok(!stores.body.includes('SECRET_API_KEY'));assert.ok(!stores.body.includes('credential'));
  const orders=await get('/api/admin/orders?fulfillmentId='+ff.id,root.cookie);assert.equal(orders.statusCode,200,orders.body);assert.equal(orders.json().total,3);assert.ok(!orders.json().rows.some((r:any)=>r.id==='second'));
  assert.equal((await get('/api/admin/orders',root.cookie)).json().total,4);
  assert.equal((await get('/api/admin/fulfillments',root.cookie)).json().rows[0].id,ff.id);
  assert.equal((await post('/api/admin/admins',{email:'reader@example.test',permissions:['orders.read'],reason:'Read orders only'},root.cookie)).statusCode,200);
  assert.equal((await get('/api/admin/orders',reader.cookie)).statusCode,200);
  assert.equal((await get('/api/admin/users',reader.cookie)).statusCode,403);
  assert.equal((await post('/api/admin/admins',{email:'seller@example.test',permissions:['admins.manage'],reason:'Escalation'},reader.cookie)).statusCode,403);
  assert.equal((await post('/api/admin/admins',{email:'root@example.test',permissions:[],reason:'Try removing root'},root.cookie)).statusCode,403);
  assert.equal((await post('/api/admin/subscription',{userId:ff.id,expires:Date.now()+86400000,limit:5,reason:'Manual subscription'},root.cookie)).statusCode,200);
  assert.equal((await get('/api/me',ff.cookie)).json().subscription.active,true);
  assert.equal((await post('/api/admin/subscription',{userId:ff.id,expires:0,limit:0,reason:'Revoked subscription'},root.cookie)).statusCode,200);
  assert.equal((await get('/api/me',ff.cookie)).json().subscription.active,false);
  assert.equal((await post('/api/admin/admins',{email:'reader@example.test',permissions:[],reason:'Revoke admin'},root.cookie)).statusCode,200);
  assert.equal((await get('/api/admin/orders',reader.cookie)).statusCode,403);
  assert.equal((await get('/api/admin/audit',root.cookie)).json().total,4);
 }finally{await app.close()}
});
