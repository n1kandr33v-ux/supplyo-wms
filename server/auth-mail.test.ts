import test from 'node:test';
import assert from 'node:assert/strict';
import {createApp} from './app.ts';
test('email registration is gated; codes single use, resend limited; reset revokes sessions',async()=>{
 let code='';const {app,db}=await createApp({key:Buffer.alloc(32,7),worker:false,emailVerification:true,sendAuthCode:async(_email,value)=>{code=value}});
 const post=(url:string,payload:unknown)=>app.inject({method:'POST',url,headers:{origin:'http://localhost:8095','x-supplyo-client':'web'},payload:payload as Record<string,unknown>});
 try{
 const data={email:'code@example.test',password:'Password-123',name:'Test User',phone:'+79991234567',consent:true,purpose:'register'};
 assert.equal((await post('/api/auth/register',data)).statusCode,400);
 const first=await post('/api/auth/code/request',data);assert.equal(first.statusCode,200);const id=first.json().id;
 assert.equal((await post('/api/auth/code/request',data)).statusCode,429);
 assert.equal((await post('/api/auth/code/verify',{id,code:code==='000000'?'111111':'000000'})).statusCode,400);
 const verified=await post('/api/auth/code/verify',{id,code});assert.equal(verified.statusCode,200);
 assert.equal((await post('/api/auth/code/verify',{id,code})).statusCode,400);
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
