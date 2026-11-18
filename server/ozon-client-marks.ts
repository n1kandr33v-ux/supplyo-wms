import type {Access} from './access.ts';
import type {FastifyInstance} from 'fastify';
import type {Database} from './database.ts';
import {z} from 'zod';
import {OZON_MARK_RETENTION_MS} from './ozon-mark-retention.ts';
const day=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v=>{const n=Date.parse(v+'T00:00:00+03:00');return Number.isFinite(n)&&new Date(n+10800000).toISOString().slice(0,10)===v;});
/** Owner-only read access deliberately does not require a subscription or a live FF grant. */
export function registerOzonClientMarks(app:FastifyInstance,db:Database,userId:(r:any)=>Promise<string|null>,access:Access){
 app.get('/api/stores/:id/ozon/postings/:posting/marks',async(req:any,reply)=>{
 const uid=await userId(req);if(!uid)return reply.code(401).send({error:'Войдите в аккаунт.'});const s=await access.resolve(uid,req.params.id);if(!s||s.marketplace!=='ozon'||s.permissions&&!s.permissions.includes('view'))return reply.code(404).send({error:'Отправление не найдено.'});
 const p=(await db.query<any>("SELECT posting_number,assembled_at,marks_purged_at FROM ozon_postings WHERE store_id=$1 AND posting_number=$2 AND ($3='' OR warehouse_id=$3)",[s.id,req.params.posting,s.scope||''])).rows[0];if(!p)return reply.code(404).send({error:'Отправление не найдено.'});const q=z.object({page:z.coerce.number().int().min(1).max(100000).default(1)}).parse(req.query);reply.header('Cache-Control','no-store');
 if(!p.assembled_at||p.marks_purged_at||Number(p.assembled_at)<=Date.now()-OZON_MARK_RETENTION_MS)return {rows:[],total:0,page:q.page,pageSize:100,expired:!!p.assembled_at};
 const args=[s.id,p.posting_number];const total=(await db.query<any>('SELECT count(*)::int n FROM ozon_pick_units WHERE store_id=$1 AND posting_number=$2 AND kiz IS NOT NULL',args)).rows[0].n;
 const rows=(await db.query<any>(`SELECT u.id,u.posting_number,u.sku,u.kiz,u.ordinal,product.item->>'name' name,product.item->>'offer_id' article,coalesce(m.barcodes,'[]'::jsonb) barcodes FROM ozon_pick_units u LEFT JOIN LATERAL(SELECT item FROM ozon_postings p CROSS JOIN jsonb_array_elements(p.products) item WHERE p.store_id=u.store_id AND p.posting_number=u.posting_number AND item->>'sku'=u.sku LIMIT 1) product ON true LEFT JOIN ozon_product_marking m ON m.store_id=u.store_id AND m.sku=u.sku WHERE u.store_id=$1 AND u.posting_number=$2 AND u.kiz IS NOT NULL ORDER BY u.sku,u.ordinal LIMIT 100 OFFSET $3`,[...args,(q.page-1)*100])).rows.map(r=>({...r,assembled_at:Number(p.assembled_at),expires_at:Number(p.assembled_at)+OZON_MARK_RETENTION_MS}));return {rows,total,page:q.page,pageSize:100,expired:false};
 });
 app.get('/api/stores/:id/ozon/marks',async(req,reply)=>{
  const uid=await userId(req),id=(req.params as {id:string}).id;
  if(!uid)return reply.code(401).send({error:'Войдите в аккаунт.'});
  const own=(await db.query("SELECT id FROM stores WHERE id=$1 AND user_id=$2 AND marketplace='ozon' AND status<>'removed'",[id,uid])).rows[0];
  if(!own)return reply.code(404).send({error:'Магазин Ozon не найден.'});
  const q=z.object({search:z.string().trim().max(200).default(''),from:day.optional(),to:day.optional(),page:z.coerce.number().int().min(1).max(100000).default(1)}).parse(req.query);
  if(q.from&&q.to&&q.from>q.to)return reply.code(400).send({error:'Начало периода позже окончания.'});
  const now=Date.now(),args=[id,now-OZON_MARK_RETENTION_MS,now,q.from?Date.parse(q.from+'T00:00:00+03:00'):0,q.to?Date.parse(q.to+'T00:00:00+03:00')+86400000:0,'%'+q.search+'%'];
  const from=`FROM ozon_pick_units u JOIN ozon_postings p ON p.store_id=u.store_id AND p.posting_number=u.posting_number
   LEFT JOIN LATERAL (SELECT item FROM jsonb_array_elements(p.products) item WHERE item->>'sku'=u.sku LIMIT 1) product ON true
   LEFT JOIN ozon_product_marking m ON m.store_id=u.store_id AND m.sku=u.sku`;
  const where=`u.store_id=$1 AND u.kiz IS NOT NULL AND p.marks_purged_at IS NULL AND p.assembled_at>$2 AND p.assembled_at<=$3
   AND ($4::bigint=0 OR p.assembled_at>=$4) AND ($5::bigint=0 OR p.assembled_at<$5)
   AND (p.posting_number ILIKE $6 OR u.sku ILIKE $6 OR product.item->>'name' ILIKE $6 OR product.item->>'offer_id' ILIKE $6 OR m.barcodes::text ILIKE $6 OR u.kiz ILIKE $6)`;
  const total=Number((await db.query<{n:number}>(`SELECT count(*)::int n ${from} WHERE ${where}`,args)).rows[0].n);
  const rows=(await db.query<any>(`SELECT u.id,u.posting_number,u.sku,u.kiz,p.assembled_at,product.item->>'name' name,product.item->>'offer_id' article,coalesce(m.barcodes,'[]'::jsonb) barcodes ${from} WHERE ${where} ORDER BY p.assembled_at DESC,p.posting_number,u.sku,u.ordinal LIMIT 100 OFFSET $7`,[...args,(q.page-1)*100])).rows.map(r=>({...r,assembled_at:Number(r.assembled_at),expires_at:Number(r.assembled_at)+OZON_MARK_RETENTION_MS}));
  reply.header('Cache-Control','no-store');return {rows,total,page:q.page,pageSize:100,retentionDays:14};
 });
}
