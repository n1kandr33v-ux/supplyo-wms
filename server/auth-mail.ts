import nodemailer from 'nodemailer';
import {randomInt,randomUUID,createHmac} from 'node:crypto';
import type {FastifyInstance,FastifyReply} from 'fastify';
import type {Database} from './database.ts';
import {hashPassword,seal,unseal} from './security.ts';
import {z} from 'zod';
export async function registerAuthMail(app:FastifyInstance,db:Database,key:Buffer,session:(id:string,reply:FastifyReply)=>Promise<void>,send?:(email:string,code:string,purpose:string)=>Promise<void>){
 await db.exec(`CREATE TABLE IF NOT EXISTS email_challenges(id text PRIMARY KEY,email text NOT NULL,purpose text NOT NULL,hash text NOT NULL,payload text NOT NULL,expires bigint NOT NULL,attempts integer NOT NULL DEFAULT 0,created bigint NOT NULL); CREATE INDEX IF NOT EXISTS email_challenges_address ON email_challenges(email,created); CREATE TABLE IF NOT EXISTS email_send_limits(ip text PRIMARY KEY,count integer NOT NULL,expires bigint NOT NULL);`);
 const mail=nodemailer.createTransport({host:process.env.SMTP_HOST,port:Number(process.env.SMTP_PORT??465),secure:process.env.SMTP_SECURE!=='false',auth:{user:process.env.SMTP_USER,pass:process.env.SMTP_PASSWORD},connectionTimeout:15000,socketTimeout:20000});
 const sign=(id:string,code:string)=>createHmac('sha256',key).update(id+':'+code).digest('hex');
 const email=z.string().trim().toLowerCase().email().max(254);
 app.post('/api/auth/code/request',async(req,reply)=>{
  const data=z.object({email,purpose:z.enum(['register','reset']),name:z.string().trim().min(2).max(150).optional(),phone:z.string().regex(/^\+?[\d\s()\-]{10,25}$/).optional(),password:z.string().min(8).max(128).optional(),consent:z.literal(true).optional()}).parse(req.body);
  if(data.purpose==='register'&&(!data.name||!data.phone||!data.password||!data.consent))return reply.code(400).send({error:'Заполните данные регистрации.'});
  const existing=(await db.query<{id:string}>('SELECT id FROM users WHERE email=$1',[data.email])).rows[0];
  if(data.purpose==='register'&&existing)return reply.code(409).send({error:'Аккаунт с этой почтой уже существует. Войдите или восстановите пароль.'});
  const now=Date.now(),id=randomUUID(),code=String(randomInt(0,1000000)).padStart(6,'0');
  const permit=await db.transaction(async tx=>{
   await tx.query('INSERT INTO email_send_limits VALUES($1,0,$2) ON CONFLICT DO NOTHING',[req.ip,now+3600000]);
   const limit=await tx.query('UPDATE email_send_limits SET count=CASE WHEN expires<$2 THEN 1 ELSE count+1 END,expires=CASE WHEN expires<$2 THEN $2+3600000 ELSE expires END WHERE ip=$1 AND (expires<$2 OR count<20) RETURNING ip',[req.ip,now]);
   if(!limit.rows.length){const row=(await tx.query<{expires:number}>('SELECT expires FROM email_send_limits WHERE ip=$1',[req.ip])).rows[0];return Math.max(1,Math.ceil((Number(row.expires)-now)/1000));}
   // Serialize requests per address, including requests from different IPs.
   await tx.query('INSERT INTO email_send_limits VALUES($1,0,$2) ON CONFLICT DO NOTHING',['email:'+data.email,now]);
   const address=await tx.query('UPDATE email_send_limits SET expires=$2+60000 WHERE ip=$1 AND expires<=$2 RETURNING ip',['email:'+data.email,now]);
   if(address.rows.length)return 0;
   await tx.query('UPDATE email_send_limits SET count=GREATEST(0,count-1) WHERE ip=$1',[req.ip]);
   const row=(await tx.query<{expires:number}>('SELECT expires FROM email_send_limits WHERE ip=$1',['email:'+data.email])).rows[0];
   return Math.max(1,Math.ceil((Number(row.expires)-now)/1000));
  });
  if(permit)return reply.header('Retry-After',String(permit)).code(429).send({error:'Подождите перед повторной отправкой кода.',retryAfter:permit});
  const payload=data.purpose==='register'?{name:data.name,phone:data.phone,password:await hashPassword(data.password!)}:{userId:existing?.id??null};
  await db.query('DELETE FROM email_challenges WHERE expires<$1',[now]);
  await db.query('DELETE FROM email_challenges WHERE email=$1 AND purpose=$2',[data.email,data.purpose]);
  await db.query('INSERT INTO email_challenges(id,email,purpose,hash,payload,expires,created) VALUES($1,$2,$3,$4,$5,$6,$7)',[id,data.email,data.purpose,sign(id,code),seal(JSON.stringify(payload),key),now+600000,now]);
  if(data.purpose==='reset'&&!existing)return {id,expiresIn:600,retryAfter:60};
  try{
   if(send)await send(data.email,code,data.purpose);
   else{
    const title=data.purpose==='register'?'Подтвердите адрес почты':'Восстановление пароля';
    const digits=code.split('').map(d=>`<td style="padding:0 4px"><div style="background:#242325;border:1px solid #38373d;border-radius:10px;padding:16px 12px;font-size:30px;font-weight:600;color:#fafafa">${d}</div></td>`).join('');
    await mail.sendMail({from:`supply <${process.env.SMTP_FROM??process.env.SMTP_USER}>`,to:data.email,attachments:[{filename:'supply-logo.png',path:'dist/email-logo.png',cid:'supply-logo'}],subject:`${title} — supply`,text:`${title}. Ваш код: ${code}. Код действует 10 минут. Никому не сообщайте его. Если вы не отправляли запрос, проигнорируйте письмо.`,html:`<html lang="ru"><body style="margin:0;background:#000;color:#fafafa;font-family:Geist,Arial,sans-serif"><table role="presentation" width="100%"><tr><td align="center" style="padding:40px 16px"><table role="presentation" style="width:100%;max-width:560px"><tr><td style="font-size:30px;font-weight:700;padding-bottom:24px"><img src="cid:supply-logo" alt="supply" width="150" style="display:block;width:150px;height:auto;border:0"></td></tr><tr><td style="background:#161616;border:1px solid #1f2023;border-top:3px solid #272df5;border-radius:16px;padding:32px"><h1 style="font-size:26px">${title}</h1><p style="color:#cfcfcf;line-height:1.6">Введите код на странице supply.</p><table role="presentation"><tr>${digits}</tr></table><p style="color:#cfcfcf">Код действует 10 минут.</p><p style="color:#cfcfcf;font-size:13px;line-height:1.6">Никому не сообщайте код. Если вы не отправляли запрос, проигнорируйте письмо.</p></td></tr></table></td></tr></table></body></html>`});
   }
  }catch{await db.query('DELETE FROM email_challenges WHERE id=$1',[id]);await db.query('UPDATE email_send_limits SET expires=0 WHERE ip=$1 AND expires=$2',['email:'+data.email,now+60000]);return reply.code(503).send({error:'Не удалось отправить письмо. Попробуйте отправить код ещё раз.'});}
  return {id,expiresIn:600,retryAfter:60};
 });
 app.post('/api/auth/code/verify',async(req,reply)=>{
  const input=z.object({id:z.string().uuid(),code:z.string().regex(/^\d{6}$/),password:z.string().min(8).max(128).optional()}).parse(req.body);
  const newPassword=input.password?await hashPassword(input.password):null;
  const result=await db.transaction(async tx=>{
   const row=(await tx.query<{id:string;email:string;purpose:string;hash:string;payload:string}>('UPDATE email_challenges SET attempts=attempts+1 WHERE id=$1 AND expires>$2 AND attempts<5 RETURNING *',[input.id,Date.now()])).rows[0];
   if(!row)return {error:'Код истёк, уже использован или исчерпан лимит попыток. Запросите новый код.',code:'CODE_EXPIRED'};
   if(row.hash!==sign(input.id,input.code))return {error:'Неверный код. Проверьте цифры в последнем письме.',code:'CODE_INVALID'};
   const payload=JSON.parse(unseal(row.payload,key));
   if(row.purpose==='reset'&&(!newPassword||!payload.userId))return null;
   await tx.query('DELETE FROM email_challenges WHERE id=$1',[row.id]);
   if(row.purpose==='register'){
    const id=randomUUID();const created=await tx.query('INSERT INTO users(id,email,password,name,phone) VALUES($1,$2,$3,$4,$5) ON CONFLICT(email) DO NOTHING RETURNING id',[id,row.email,payload.password,payload.name,payload.phone]);
    return created.rows.length?{id,reset:false}:{existing:true as const};
   }
   await tx.query('UPDATE users SET password=$1 WHERE id=$2',[newPassword,payload.userId]);
   await tx.query('DELETE FROM sessions WHERE user_id=$1',[payload.userId]);
   return {id:payload.userId as string,reset:true};
  });
  if(!result)return reply.code(400).send({error:'Не удалось восстановить доступ. Запросите новый код.',code:'CODE_EXPIRED'});
  if('error' in result)return reply.code(400).send(result);
  if('existing' in result)return reply.code(409).send({error:'Аккаунт с этой почтой уже существует. Войдите или восстановите пароль.'});
  await session(result.id,reply);return {ok:true};
 });
}
