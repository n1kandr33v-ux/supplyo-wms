import test from 'node:test';
import assert from 'node:assert/strict';
import {createApp} from './app.ts';
test('email registration is gated; codes single use, resend limited; reset revokes sessions',async()=>{
 let code='';const {app,db}=await createApp({key:Buffer.alloc(32,7),worker:false,emailVerification:true,sendAuthCode:async(_email,value)=>{code=value}});
 const post=(url:string,payload:unknown)=>app.inject({method:'POST',url,headers:{origin:'http://localhost:8095','x-supplyo-client':'web'},payload:payload as Record<string,unknown>});
 try{
 const data={email:'code@example.test',password:'Password-123',name:'Test User Patronymic',phone:'+79991234567',consent:true,purpose:'register'};
 assert.equal((await post('/api/auth/register',data)).statusCode,400);
 const first=await post('/api/auth/code/request',data);assert.equal(first.statusCode,200);const id=first.json().id;
 assert.equal((await post('/api/auth/code/request',data)).statusCode,429);
 assert.equal((await post('/api/auth/code/verify',{id,code:code==='000000'?'111111':'000000'})).statusCode,400);
 const verified=await post('/api/auth/code/verify',{id,code});assert.equal(verified.statusCode,200);
 assert.equal((await post('/api/auth/code/verify',{id,code})).statusCode,400);
 await db.query('UPDATE email_send_limits SET expires=0');
 const duplicate=await post('/api/auth/code/request',data);assert.equal(duplicate.statusCode,409);assert.match(duplicate.json().error,/уже существует/);
 for(let i=0;i<3;i++){const again=await post('/api/auth/code/request',data);assert.equal(again.statusCode,409);assert.match(again.json().error,/уже существует/);}
 const login=await post('/api/auth/login',{email:data.email,password:data.password});assert.equal(login.statusCode,200);
 await db.query('UPDATE email_send_limits SET expires=0');
 const reset=await post('/api/auth/code/request',{email:data.email,purpose:'reset'});assert.equal(reset.statusCode,200);
 assert.equal((await post('/api/auth/code/verify',{id:reset.json().id,code,password:'NewPassword123'})).statusCode,200);
 assert.equal((await post('/api/auth/login',{email:data.email,password:data.password})).statusCode,401);
 assert.equal((await post('/api/auth/login',{email:data.email,password:'NewPassword123'})).statusCode,200);
 assert.equal(Number((await db.query<{n:number}>('SELECT count(*) AS n FROM sessions')).rows[0].n),2);
 // A second email can request a reset without disclosing whether it exists.
 const unknown=await post('/api/auth/code/request',{email:'missing@example.test',purpose:'reset'});assert.equal(unknown.statusCode,200);
 assert.equal((await post('/api/auth/code/verify',{id:unknown.json().id,code,password:'NewPassword123'})).statusCode,400);
 }finally{await app.close()}
});

test('expiry, lockout, resend, SMTP failure and repeated login behave consistently',async()=>{
 let code='',sent=0,fail=false;
 const {app,db}=await createApp({key:Buffer.alloc(32,9),worker:false,emailVerification:true,sendAuthCode:async(_email,value)=>{if(fail)throw Error('SMTP offline');code=value;sent++}});
 const headers={origin:'http://localhost:8095','x-supplyo-client':'web'};
 const post=(url:string,payload:unknown)=>app.inject({method:'POST',url,headers,payload:payload as Record<string,unknown>});
 const data={email:'flow@example.test',password:'Password-123',name:'Test User Patronymic',phone:'+79991234567',consent:true,purpose:'register'};
 const unlock=()=>db.query('UPDATE email_send_limits SET expires=0');
 const request=()=>post('/api/auth/code/request',data);
 const verify=(id:string,value=code)=>post('/api/auth/code/verify',{id,code:value});
 try{
  fail=true;assert.equal((await request()).statusCode,503);fail=false;
  const first=await request();assert.equal(first.statusCode,200);const original=code;
  for(let i=0;i<22;i++)assert.equal((await request()).statusCode,429);
  assert.equal(sent,1); // Cooldown clicks neither send mail nor exhaust the hourly quota.
  await unlock();const second=await request();assert.equal(second.statusCode,200);
  assert.equal((await verify(first.json().id,original)).json().code,'CODE_EXPIRED');
  await db.query('UPDATE email_challenges SET expires=0 WHERE id=$1',[second.json().id]);
  assert.equal((await verify(second.json().id)).json().code,'CODE_EXPIRED');
  await unlock();const third=await request();const wrong=code==='000000'?'111111':'000000';
  for(let i=0;i<5;i++)assert.equal((await verify(third.json().id,wrong)).json().code,'CODE_INVALID');
  assert.equal((await verify(third.json().id)).json().code,'CODE_EXPIRED');
  await unlock();const fourth=await request();
  const concurrent=await Promise.all([verify(fourth.json().id),verify(fourth.json().id)]);
  assert.deepEqual(concurrent.map(r=>r.statusCode).sort(),[200,400]);
  const registered=concurrent.find(r=>r.statusCode===200)!;
  const cookie=String(registered.headers['set-cookie']).split(';')[0];
  assert.match(String(registered.headers['set-cookie']),/HttpOnly; SameSite=Strict/);
  const countBefore=sent;
  for(let i=0;i<3;i++)assert.equal((await request()).statusCode,409);
  assert.equal(sent,countBefore);
  for(let i=0;i<12;i++)assert.equal((await post('/api/auth/login',{email:' FLOW@EXAMPLE.TEST ',password:data.password})).statusCode,200);
  await unlock();const reset=await post('/api/auth/code/request',{email:data.email,purpose:'reset'});
  const resetCode=code;
  assert.equal((await post('/api/auth/code/verify',{id:reset.json().id,code:resetCode,password:'short'})).statusCode,400);
  assert.equal((await post('/api/auth/code/verify',{id:reset.json().id,code:resetCode,password:'Changed-password-123'})).statusCode,200);
  assert.equal((await app.inject({url:'/api/me',headers:{cookie}})).statusCode,401);
  assert.equal((await post('/api/auth/login',{email:data.email,password:data.password})).statusCode,401);
  const login=await post('/api/auth/login',{email:data.email,password:'Changed-password-123'});assert.equal(login.statusCode,200);
  const current=String(login.headers['set-cookie']).split(';')[0];
  assert.equal((await app.inject({method:'POST',url:'/api/auth/logout',headers:{...headers,cookie:current}})).statusCode,200);
  assert.equal((await app.inject({url:'/api/me',headers:{cookie:current}})).statusCode,401);
  await unlock();const beforeUnknown=sent;assert.equal((await post('/api/auth/code/request',{email:'unknown@example.test',purpose:'reset'})).statusCode,200);assert.equal(sent,beforeUnknown);
  for(let i=0;i<10;i++)assert.equal((await post('/api/auth/login',{email:data.email,password:'Wrong-password-123'})).statusCode,401);
  assert.equal((await post('/api/auth/login',{email:data.email,password:'Changed-password-123'})).statusCode,429);
 }finally{await app.close()}
});

test('auth limits use the client IP only through explicitly trusted proxies',async()=>{
 const {app,db}=await createApp({key:Buffer.alloc(32,3),worker:false,emailVerification:true,trustedProxies:['127.0.0.1','198.51.100.1'],sendAuthCode:async()=>{throw Error('Unknown reset must not send')}});
 try{
  const request=(remoteAddress:string,forwarded:string,email:string)=>app.inject({method:'POST',url:'/api/auth/code/request',remoteAddress,headers:{origin:'http://localhost:8095','x-supplyo-client':'web','x-forwarded-for':forwarded},payload:{purpose:'reset',email}});
  assert.equal((await request('127.0.0.1','203.0.113.10, 198.51.100.1','proxy@example.test')).statusCode,200);
  assert.equal((await request('203.0.113.20','192.0.2.99','direct@example.test')).statusCode,200);
  const ips=(await db.query<{ip:string}>("SELECT ip FROM email_send_limits WHERE ip NOT LIKE 'email:%' ORDER BY ip")).rows.map(row=>row.ip);
  assert.deepEqual(ips,['203.0.113.10','203.0.113.20']);
 }finally{await app.close()}
});

test('registration validates full name, email and complete phone before sending',async()=>{
 let sent=0,code='';const {app,db}=await createApp({key:Buffer.alloc(32,6),worker:false,emailVerification:true,sendAuthCode:async(_email,value)=>{sent++;code=value}});
 const data={email:'fields@example.test',name:'ивАНОВ иВАН иВАНОВИЧ',phone:'8 (999) 123-45-67',password:'Password-123',consent:true,purpose:'register'};
 const post=(payload:unknown)=>app.inject({method:'POST',url:'/api/auth/code/request',headers:{origin:'http://localhost:8095','x-supplyo-client':'web'},payload:payload as Record<string,unknown>});
 try{
  for(const patch of [{name:'Иван'},{name:'Иван Иванов'},{phone:'8999123'},{phone:'899912345678'},{email:'wrong@'},{email:'.wrong@example.test'}])assert.equal((await post({...data,...patch})).statusCode,400);
  assert.equal(sent,0);
  const response=await post(data);assert.equal(response.statusCode,200);
  assert.equal((await app.inject({method:'POST',url:'/api/auth/code/verify',headers:{origin:'http://localhost:8095','x-supplyo-client':'web'},payload:{id:response.json().id,code}})).statusCode,200);
  const row=(await db.query<{name:string;phone:string}>('SELECT name,phone FROM users WHERE email=$1',[data.email])).rows[0];
  assert.equal(row.name,'Иванов Иван Иванович');assert.equal(row.phone,'+7 (999) 123-45-67');
 }finally{await app.close()}
});
import {formatPhone,formatFullName,fullNameError,emailError} from '../src/auth-fields.ts';
test('pasted phones normalize, excess digits stop and full names require three parts',()=>{
 for(const value of ['89991234567','+7 (999) 123-45-67','9991234567','8 999 123 45 67'])assert.equal(formatPhone(value),'+7 (999) 123-45-67');
 assert.equal(formatPhone('8001234567'),'+7 (800) 123-45-67');
 assert.equal(formatPhone('+799912345671234'),'+7 (999) 123-45-67');
 assert.equal(formatFullName('ИВАНОВ ивАН иВАНОВИЧ'),'Иванов Иван Иванович');
 assert.ok(fullNameError('Иван'));assert.ok(fullNameError('Иван Иванов'));assert.equal(fullNameError('Иванов Иван Иванович'),'');
 for(const value of ['bad','bad@','bad @example.ru','.bad@example.ru','bad..name@example.ru'])assert.ok(emailError(value));
 assert.equal(emailError('name@example.ru'),'');
});
