import type {FastifyInstance,FastifyRequest,FastifyReply} from 'fastify';
import type {Database} from './database.ts';
import {randomUUID} from 'node:crypto';
import {z} from 'zod';
export const adminPermissions=['users.read','stores.read','orders.read','fulfillments.read','subscriptions.manage','admins.manage','audit.read'] as const;
type Permission=typeof adminPermissions[number];
export async function registerAdmin(app:FastifyInstance,db:Database,userId:(req:FastifyRequest)=>Promise<string|null>,rootEmail:string){
 await db.exec(`CREATE TABLE IF NOT EXISTS platform_admins(user_id text PRIMARY KEY REFERENCES users(id),permissions jsonb NOT NULL,updated_by text REFERENCES users(id),updated_at bigint NOT NULL);CREATE TABLE IF NOT EXISTS platform_admin_audit(id text PRIMARY KEY,actor_id text NOT NULL REFERENCES users(id),action text NOT NULL,target_id text NOT NULL,details jsonb NOT NULL,created_at bigint NOT NULL);CREATE INDEX IF NOT EXISTS admin_audit_time ON platform_admin_audit(created_at DESC);`);
 const root=rootEmail.trim().toLowerCase();
 async function context(uid:string|null){
  if(!uid)return {root:false,permissions:[] as string[]};
  const user=(await db.query<{email:string}>('SELECT email FROM users WHERE id=$1',[uid])).rows[0];
  if(root&&user?.email.toLowerCase()===root)return {root:true,permissions:[...adminPermissions] as string[]};
  const row=(await db.query<{permissions:string[]}>('SELECT permissions FROM platform_admins WHERE user_id=$1',[uid])).rows[0];return {root:false,permissions:row?.permissions??[]};
 }
 async function authorize(req:FastifyRequest,reply:FastifyReply,permission:Permission){const uid=await userId(req),ctx=await context(uid);if(!uid){reply.code(401).send({error:'Войдите в аккаунт.'});return null}if(!ctx.permissions.includes(permission)){reply.code(403).send({error:'Нет доступа к этому разделу админ-панели.'});return null}return {uid,...ctx}}
 const paging=z.object({q:z.string().max(200).default(''),page:z.coerce.number().int().min(1).max(100000).default(1),fulfillmentId:z.string().max(150).default(''),storeId:z.string().max(150).default(''),marketplace:z.enum(['','wb','ozon']).default('')});
 app.get('/api/admin/me',async req=>context(await userId(req)));
 app.get('/api/admin/users',async(req,reply)=>{
  if(!await authorize(req,reply,'users.read'))return;
  const {q,page}=paging.parse(req.query),params=['%'+q+'%',(page-1)*50];
  const where="WHERE u.email ILIKE $1 OR u.name ILIKE $1 OR u.phone ILIKE $1";
  const rows=await db.query(`SELECT u.id,u.name,u.email,u.phone,coalesce(s.expires,0) expires,coalesce(s.cabinet_limit,0) cabinet_limit,coalesce(s.is_test,false) is_test,(SELECT count(*)::int FROM stores c WHERE c.user_id=u.id AND c.status<>'removed') cabinets FROM users u LEFT JOIN subscriptions s ON s.user_id=u.id ${where} ORDER BY u.email LIMIT 50 OFFSET $2`,params);
  const total=(await db.query<{total:number}>(`SELECT count(*)::int total FROM users u ${where}`,[params[0]])).rows[0].total;return {rows:rows.rows,total};
 });
 app.get('/api/admin/fulfillments',async(req,reply)=>{
  if(!await authorize(req,reply,'fulfillments.read'))return;
  const {q,page}=paging.parse(req.query);
  const condition=`WHERE (u.email ILIKE $1 OR u.name ILIKE $1 OR coalesce(d.data::text,'') ILIKE $1) AND (d.user_id IS NOT NULL OR s.cabinet_limit>0 OR EXISTS(SELECT 1 FROM client_access a WHERE a.fulfillment_id=u.id))`;
  const select=`FROM users u LEFT JOIN subscriptions s ON s.user_id=u.id LEFT JOIN workspace_documents d ON d.user_id=u.id AND d.kind='warehouses'`;
  return {rows:(await db.query(`SELECT u.id,u.email,u.name,coalesce(d.data,'[]'::jsonb) warehouses,coalesce(s.expires,0) expires,coalesce(s.cabinet_limit,0) cabinet_limit ${select} ${condition} ORDER BY u.email LIMIT 50 OFFSET $2`,['%'+q+'%',(page-1)*50])).rows,total:(await db.query<{total:number}>(`SELECT count(*)::int total ${select} ${condition}`,['%'+q+'%'])).rows[0].total};
 });
 app.get('/api/admin/stores',async(req,reply)=>{
  if(!await authorize(req,reply,'stores.read'))return;
  const {q,page,fulfillmentId}=paging.parse(req.query),params=['%'+q+'%',fulfillmentId];
  const where=`WHERE (s.name ILIKE $1 OR u.email ILIKE $1 OR s.id ILIKE $1) AND ($2='' OR s.user_id=$2 OR EXISTS(SELECT 1 FROM client_access a WHERE a.store_id=s.id AND a.fulfillment_id=$2 AND a.revoked IS NULL))`;
  const from='FROM stores s JOIN users u ON u.id=s.user_id';
  return {rows:(await db.query(`SELECT s.id,s.name,s.marketplace,s.status,s.last_synced,s.error,u.email owner_email,u.name owner_name ${from} ${where} ORDER BY s.name,s.id LIMIT 50 OFFSET $3`,[...params,(page-1)*50])).rows,total:(await db.query<{total:number}>(`SELECT count(*)::int total ${from} ${where}`,params)).rows[0].total};
 });
 app.get('/api/admin/orders',async(req,reply)=>{
  if(!await authorize(req,reply,'orders.read'))return;
  const {q,page,fulfillmentId,storeId,marketplace}=paging.parse(req.query);
  const cte=`WITH all_orders AS (
   SELECT o.store_id,o.id,o.article product,o.warehouse_id,o.created_at,'wb' marketplace,'Новый' status FROM orders o
   UNION ALL SELECT i.store_id,i.id,coalesce(i.snapshot->>'article',i.snapshot->>'name','') product,coalesce(i.snapshot->>'warehouseId',sp.warehouse_id,'') warehouse_id,coalesce(i.snapshot->>'createdAt',sp.created,'') created_at,'wb',CASE WHEN sp.delivered_at IS NOT NULL THEN 'Отгружен' ELSE i.status END FROM fulfillment_items i LEFT JOIN fulfillment_supplies sp ON sp.store_id=i.store_id AND sp.id=i.supply_id WHERE NOT EXISTS(SELECT 1 FROM orders n WHERE n.store_id=i.store_id AND n.id=i.id)
   UNION ALL SELECT store_id,posting_number,coalesce((SELECT string_agg(p->>'name',', ') FROM jsonb_array_elements(products) p),''),warehouse_id,created_at,'ozon',status FROM ozon_postings
  ), filtered AS (SELECT o.*,s.name store_name,u.email owner_email FROM all_orders o JOIN stores s ON s.id=o.store_id JOIN users u ON u.id=s.user_id WHERE ($1='' OR o.id ILIKE '%'||$1||'%' OR o.product ILIKE '%'||$1||'%') AND ($2='' OR s.user_id=$2 OR EXISTS(SELECT 1 FROM client_access a WHERE a.store_id=s.id AND a.fulfillment_id=$2 AND a.warehouse_id=o.warehouse_id AND a.revoked IS NULL)) AND ($3='' OR o.store_id=$3) AND ($4='' OR o.marketplace=$4))`;
  const params=[q,fulfillmentId,storeId,marketplace];
  return {rows:(await db.query(`${cte} SELECT * FROM filtered ORDER BY created_at DESC,id LIMIT 50 OFFSET $5`,[...params,(page-1)*50])).rows,total:(await db.query<{total:number}>(`${cte} SELECT count(*)::int total FROM filtered`,params)).rows[0].total};
 });
 app.post('/api/admin/subscription',async(req,reply)=>{
  const ctx=await authorize(req,reply,'subscriptions.manage');if(!ctx)return;
  const input=z.object({userId:z.string().uuid(),expires:z.number().int().min(0).max(4102444800000),limit:z.number().int().min(0).max(10000),reason:z.string().trim().min(3).max(500)}).parse(req.body);
  const changed=await db.transaction(async tx=>{
   if(!(await tx.query('SELECT id FROM users WHERE id=$1',[input.userId])).rows.length)return false;
   const before=(await tx.query('SELECT expires,cabinet_limit,is_test FROM subscriptions WHERE user_id=$1 FOR UPDATE',[input.userId])).rows[0]??null;
   await tx.query('INSERT INTO subscriptions(user_id,expires,cabinet_limit,is_test) VALUES($1,$2,$3,false) ON CONFLICT(user_id) DO UPDATE SET expires=$2,cabinet_limit=$3,is_test=false',[input.userId,input.expires,input.limit]);
   await tx.query('INSERT INTO platform_admin_audit VALUES($1,$2,$3,$4,$5::jsonb,$6)',[randomUUID(),ctx.uid,'subscription.set',input.userId,JSON.stringify({before,after:{expires:input.expires,limit:input.limit},reason:input.reason}),Date.now()]);return true;
  });return changed?{ok:true}:reply.code(404).send({error:'Пользователь не найден.'});
 });
 app.get('/api/admin/admins',async(req,reply)=>{
  if(!await authorize(req,reply,'admins.manage'))return;
  return {rootEmail:root,rows:(await db.query('SELECT u.id,u.email,u.name,a.permissions,a.updated_at FROM platform_admins a JOIN users u ON u.id=a.user_id ORDER BY u.email')).rows};
 });
 app.post('/api/admin/admins',async(req,reply)=>{
  const ctx=await authorize(req,reply,'admins.manage');if(!ctx)return;
  const input=z.object({email:z.string().trim().toLowerCase().email(),permissions:z.array(z.enum(adminPermissions)).max(7),reason:z.string().trim().min(3).max(500)}).parse(req.body);
  if(input.permissions.includes('subscriptions.manage')&&!input.permissions.includes('users.read'))return reply.code(400).send({error:'Для управления подписками добавьте доступ к пользователям.'});
  if(input.permissions.some(p=>!ctx.permissions.includes(p)))return reply.code(403).send({error:'Нельзя выдавать права, которых у вас нет.'});
  const target=(await db.query<{id:string}>('SELECT id FROM users WHERE lower(email)=$1',[input.email])).rows[0];
  if(!target)return reply.code(404).send({error:'Сначала пользователь должен зарегистрироваться с этой почтой.'});
  if(input.email===root||target.id===ctx.uid)return reply.code(403).send({error:'Нельзя изменять главного администратора или собственные права.'});
  const saved=await db.transaction(async tx=>{
   const before=(await tx.query('SELECT permissions FROM platform_admins WHERE user_id=$1 FOR UPDATE',[target.id])).rows[0]??null;
   if(!ctx.root&&before){const old=(before as {permissions:string[]}).permissions;if(old.some(p=>!ctx.permissions.includes(p)))return false;}
   if(input.permissions.length)await tx.query('INSERT INTO platform_admins VALUES($1,$2::jsonb,$3,$4) ON CONFLICT(user_id) DO UPDATE SET permissions=$2::jsonb,updated_by=$3,updated_at=$4',[target.id,JSON.stringify([...new Set(input.permissions)]),ctx.uid,Date.now()]);else await tx.query('DELETE FROM platform_admins WHERE user_id=$1',[target.id]);
   await tx.query('INSERT INTO platform_admin_audit VALUES($1,$2,$3,$4,$5::jsonb,$6)',[randomUUID(),ctx.uid,'admin.permissions',target.id,JSON.stringify({before,permissions:input.permissions,reason:input.reason}),Date.now()]);return true;
  });return saved?{ok:true}:reply.code(403).send({error:'Нельзя изменять администратора с более широкими правами.'});
 });
 app.get('/api/admin/audit',async(req,reply)=>{
  if(!await authorize(req,reply,'audit.read'))return;
  const {page}=paging.parse(req.query);return {rows:(await db.query('SELECT a.id,a.action,a.target_id,a.details,a.created_at,u.email actor_email FROM platform_admin_audit a JOIN users u ON u.id=a.actor_id ORDER BY a.created_at DESC LIMIT 50 OFFSET $1',[(page-1)*50])).rows,total:(await db.query<{total:number}>('SELECT count(*)::int total FROM platform_admin_audit')).rows[0].total};
 });
 return {context};
}
