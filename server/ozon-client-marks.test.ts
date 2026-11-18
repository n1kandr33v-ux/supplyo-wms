import {test} from 'node:test';import assert from 'node:assert/strict';import {randomBytes,randomUUID} from 'node:crypto';
import {createApp} from './app.ts';import {OZON_MARK_RETENTION_MS} from './ozon-mark-retention.ts';import {ozonMarksXlsx} from '../src/lib/ozon-marks-xlsx.ts';import {unzipSync,strFromU8} from 'fflate';
test('unpaid Ozon owner reads own completed FF codes: isolation, no subscription/grant dependency, expiry, filters and pagination',async()=>{
 const {app,db}=await createApp({key:randomBytes(32),worker:false,testPurchases:true});const base={origin:'http://127.0.0.1:8095','x-supplyo-client':'web'};
 const post=(h:any,url:string,payload:any)=>app.inject({method:'POST',url,headers:h,payload});
 async function user(email:string){const r=await post(base,'/api/auth/register',{email,name:'Тест',password:'Password-12345',phone:'+79991234567',consent:true});return {...base,cookie:String(r.headers['set-cookie']).split(';')[0]};}
 try{
  const owner=await user('unpaid-ozon@example.test'),other=await user('other-marks@example.test'),ff=await user('ff-marks@example.test');
  const store=(await post(owner,'/api/stores',{marketplace:'ozon',clientId:'123',token:'synthetic-api-key-123456789'})).json().id;
  const uid=(await db.query<any>("SELECT id FROM users WHERE email='unpaid-ozon@example.test'")).rows[0].id,ffid=(await db.query<any>("SELECT id FROM users WHERE email='ff-marks@example.test'")).rows[0].id;
  await db.query("UPDATE stores SET status='ready' WHERE id=$1",[store]);
  const now=Date.now(),product=JSON.stringify([{sku:'111',name:'Блузка',offer_id:'blouse',quantity:101}]);
  for(const [number,assembled,purged] of [['finished',now-3600000,null],['expired',now-OZON_MARK_RETENTION_MS-1,null],['open',null,null],['purged',now-3600000,now]] as const){
   await db.query('INSERT INTO ozon_postings(store_id,posting_number,order_number,status,products,warehouse_id,created_at,updated_at,assembled_at,marks_purged_at) VALUES($1,$2,$2,$3,$4,\'47\',$5,$6,$7,$8)',[store,number,number==='open'?'awaiting_packaging':'awaiting_deliver',product,new Date(now).toISOString(),now,assembled,purged]);
   for(let n=0;n<(number==='finished'?101:1);n++)await db.query("INSERT INTO ozon_pick_units(id,store_id,posting_number,sku,ordinal,state,kiz,request_id,owner_id,route_id,updated_at) VALUES($1,$2,$3,'111',$4,'ready',$5,$6,$7,'ff-route',$8)",[randomUUID(),store,number,n,'010001234567890021CODE'+n,randomUUID(),ffid,now]);
  }
  const url='/api/stores/'+store+'/ozon/marks',read=(h=owner,query='')=>app.inject({url:url+query,headers:h});
  let r=await read();assert.equal(r.statusCode,200,r.body);assert.equal(r.headers['cache-control'],'no-store');assert.equal(r.json().total,101);assert.equal(r.json().rows.length,100);assert.equal(r.json().rows[0].posting_number,'finished');assert.equal(r.json().rows[0].name,'Блузка');assert.ok(r.json().rows[0].expires_at>now);
  assert.equal((await read(owner,'?page=2')).json().rows.length,1);assert.equal((await read(owner,'?search=blouse')).json().total,101);assert.equal((await read(owner,'?search=missing')).json().total,0);
  assert.equal((await read(owner,'?from=2020-01-01&to=2020-01-02')).json().total,0);assert.equal((await read(owner,'?from=2026-11-31')).statusCode,400);assert.equal((await read(owner,'?from=2026-11-20&to=2026-11-01')).statusCode,400);
  assert.equal((await read(other)).statusCode,404);assert.equal((await read(ff)).statusCode,404);assert.equal((await app.inject({url})).statusCode,401);
  const postingUrl='/api/stores/'+store+'/ozon/postings/finished/marks';let codes=await app.inject({url:postingUrl,headers:owner});assert.equal(codes.statusCode,200,codes.body);assert.equal(codes.json().total,101);assert.equal(codes.json().rows.length,100);assert.equal(codes.headers['cache-control'],'no-store');assert.equal((await app.inject({url:postingUrl+'?page=2',headers:owner})).json().rows.length,1);assert.equal((await app.inject({url:postingUrl,headers:other})).statusCode,404);assert.equal((await app.inject({url:postingUrl})).statusCode,401);
  for(const name of ['expired','open','purged'])assert.equal((await app.inject({url:postingUrl.replace('finished',name),headers:owner})).json().total,0);
  await post(ff,'/api/subscription/test-purchase',{plan:'start'});const grant=randomUUID();await db.query("INSERT INTO client_access(id,store_id,owner_id,warehouse_id,warehouse_name,code_hash,expires,created,fulfillment_id,accepted) VALUES($1,$2,$3,'47','Казань',$4,$5,$6,$7,$6)",[grant,store,uid,randomUUID(),now+86400000,now,ffid]);assert.equal((await app.inject({url:postingUrl.replace(store,grant),headers:ff})).json().total,101);await db.query("UPDATE ozon_postings SET warehouse_id='49' WHERE store_id=$1 AND posting_number='finished'",[store]);assert.equal((await app.inject({url:postingUrl.replace(store,grant),headers:ff})).statusCode,404);await db.query("UPDATE ozon_postings SET warehouse_id='47' WHERE store_id=$1 AND posting_number='finished'",[store]);await db.query('UPDATE client_access SET revoked=$2 WHERE id=$1',[grant,now]);assert.equal((await app.inject({url:postingUrl.replace(store,grant),headers:ff})).statusCode,404);
  const wb=(await post(owner,'/api/stores',{token:'synthetic-wb-token-123456789'})).json().id;assert.equal((await app.inject({url:'/api/stores/'+wb+'/ozon/marks',headers:owner})).statusCode,404);
  assert.equal((await app.inject({url:'/api/stores/'+store+'/ozon/assembly',headers:owner})).statusCode,403,'free archive does not unlock assembly');
  await db.query('UPDATE ozon_postings SET assembled_at=$2 WHERE store_id=$1 AND posting_number=\'finished\'',[store,now-OZON_MARK_RETENTION_MS]);assert.equal((await read()).json().total,0,'expired codes cannot be read even before the cleanup worker runs');
  await db.query("UPDATE stores SET status='removed' WHERE id=$1",[store]);assert.equal((await read()).statusCode,404);
 }finally{await app.close()}
});
test('Ozon marks XLSX preserves text identifiers and GS using OOXML escapes without formulas',()=>{
 const row={id:'1',posting_number:'001-002-1',sku:'000111',name:'=HYPERLINK("bad")',article:'<блузка>&',barcodes:['0001234567890'],kiz:'010001234567890021abc\u001d91AB_x001D_',assembled_at:Date.now(),expires_at:Date.now()+1000};
 const files=unzipSync(ozonMarksXlsx([row])),sheet=strFromU8(files['xl/worksheets/sheet1.xml']);assert.ok(files['xl/styles.xml']);assert.ok(sheet.includes('0001234567890'));assert.ok(sheet.includes('_x001D_91AB_x005F_x001D_'));assert.ok(sheet.includes('=HYPERLINK'));assert.ok(!sheet.includes('<f>'));assert.ok(sheet.includes('&lt;блузка&gt;&amp;'));
});
