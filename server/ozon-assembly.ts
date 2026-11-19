import {confirmOzonAssembly,purgeExpiredOzonMarks} from './ozon-mark-retention.ts';
import type {FastifyInstance} from 'fastify';
import type {Database} from './database.ts';
import type {Access,ScopedStore} from './access.ts';
import {ozonCredentials,OzonError,type OzonClient,type OzonPosting,type OzonExemplars} from './ozon.ts';
import {unseal} from './security.ts';
import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {validateMarking} from '../src/lib/marking.ts';

export class OzonAssemblyError extends Error{constructor(message:string,public status=409){super(message);}}

type Unit={id:string;store_id:string;posting_number:string;sku:string;ordinal:number;state:string;kiz:string|null;identity:string|null;previous_code:string|null;exemplar_id:string|null;request_id:string;owner_id:string;route_id:string;reserved_until:number;attempted:boolean;updated_at:number;error:string|null};
const editable=(p:OzonPosting)=>p.status==='awaiting_packaging';
const composition=(p:OzonPosting)=>JSON.stringify(p.products.map(i=>[i.sku,i.quantity]).sort());
export function mergeOzonMarks(remote:OzonExemplars,units:Unit[],reservedIds:string[]=[]){
 const data=structuredClone(remote),ids=new Set<string>(),exemplarIds=new Set<string>();
 for(const p of data.products){if(ids.has(p.product_id)||p.quantity!==p.exemplars.length)throw new OzonAssemblyError('Неполные данные экземпляров Ozon. Обновите отправление.');ids.add(p.product_id);for(const e of p.exemplars){if(exemplarIds.has(e.exemplar_id))throw new OzonAssemblyError('Ozon вернул повторяющиеся экземпляры.');exemplarIds.add(e.exemplar_id);}}
 for(const u of units){
  const p=data.products.find(p=>p.product_id===u.sku);if(!p)throw new OzonAssemblyError('Ozon не вернул экземпляры товара.');
  const used=new Set([...reservedIds,...units.filter(other=>other.id!==u.id&&other.exemplar_id).map(other=>other.exemplar_id!)]);
  const e=p.exemplars.find(e=>e.exemplar_id===u.exemplar_id&&!used.has(e.exemplar_id))||p.exemplars.find(e=>!used.has(e.exemplar_id)&&e.marks.some(m=>m.mark===u.kiz))||p.exemplars.find(e=>!used.has(e.exemplar_id)&&!e.marks.some(m=>['mandatory_mark','KIZ','DATA_MATRIX','CIS'].includes(m.mark_type)));
  if(!e)throw new OzonAssemblyError('В Ozon у всех экземпляров уже сохранены другие КИЗ. Проверьте отправление.');
  const current=e.marks.filter(m=>['mandatory_mark','KIZ','DATA_MATRIX','CIS'].includes(m.mark_type));
  if(current.some(m=>m.mark!==u.kiz&&m.mark!==u.previous_code))throw new OzonAssemblyError('КИЗ экземпляра изменён в Ozon. Обновите отправление.');
  e.marks=e.marks.filter(m=>!['mandatory_mark','KIZ','DATA_MATRIX','CIS'].includes(m.mark_type));
  e.marks.push({mark:u.kiz!,mark_type:'mandatory_mark'});u.exemplar_id=e.exemplar_id;
 }
 return data;
}
/** Our assembly requires KIZ for a marked catalog item even when Ozon allows optional transmission. */
export function ozonRequiresKiz(posting:OzonPosting,data:OzonExemplars,sku:string,catalogMarked=false){
 if(catalogMarked||posting.requirements?.products_requiring_mandatory_mark?.includes(sku))return true;
 const product=data.products.find(p=>p.product_id===sku);
 if(!product)throw new OzonAssemblyError('Ozon не вернул требования к экземплярам товара. Обновите отправление.');
 return product.is_mandatory_mark_needed||product.exemplars.some(e=>e.is_mandatory_mark_needed===true);
}
export async function registerOzonAssembly(app:FastifyInstance,db:Database,key:Buffer,userId:(r:any)=>Promise<string|null>,access:Access,ozon:OzonClient){
 await db.exec(`CREATE TABLE IF NOT EXISTS ozon_pick_units(
 id text PRIMARY KEY,store_id text NOT NULL REFERENCES stores(id),posting_number text NOT NULL,sku text NOT NULL,ordinal integer NOT NULL,
 state text NOT NULL,kiz text,identity text,previous_code text,exemplar_id text,request_id text NOT NULL,owner_id text NOT NULL,route_id text NOT NULL,
 reserved_until bigint NOT NULL DEFAULT 0,attempted boolean NOT NULL DEFAULT false,updated_at bigint NOT NULL,error text,
 UNIQUE(store_id,posting_number,sku,ordinal),UNIQUE(store_id,request_id));
 CREATE UNIQUE INDEX IF NOT EXISTS ozon_pick_mark_identity ON ozon_pick_units(store_id,identity) WHERE identity IS NOT NULL;
 CREATE TABLE IF NOT EXISTS ozon_pick_checks(store_id text NOT NULL,posting_number text NOT NULL,next_at bigint NOT NULL,PRIMARY KEY(store_id,posting_number));
 CREATE TABLE IF NOT EXISTS ozon_ship_tasks(store_id text NOT NULL,posting_number text NOT NULL,state text NOT NULL,updated_at bigint NOT NULL,error text,PRIMARY KEY(store_id,posting_number));
 CREATE INDEX IF NOT EXISTS ozon_ship_tasks_pending ON ozon_ship_tasks(updated_at) WHERE state='checking';
 CREATE INDEX IF NOT EXISTS ozon_pick_checks_due ON ozon_pick_checks(next_at);
 CREATE TABLE IF NOT EXISTS ozon_auto_scan_receipts(store_id text NOT NULL,request_id text NOT NULL,actor text NOT NULL,scope text NOT NULL,result jsonb NOT NULL,PRIMARY KEY(store_id,request_id));
 CREATE TABLE IF NOT EXISTS ozon_pick_history(id text PRIMARY KEY,unit_id text NOT NULL,previous jsonb NOT NULL,changed_at bigint NOT NULL);`);
 const active=new Set<string>();let running=false,closing=false,lastRetention=0;
 const credentials=(s:ScopedStore)=>ozonCredentials.parse(JSON.parse(unseal(s.credential,key)));
 async function allowed(req:any,reply:any,permission='view'){
  const uid=await userId(req),s=await access.resolve(uid,req.params.id);if(!s||s.marketplace!=='ozon'){reply.code(404).send({error:'Магазин Ozon не найден.'});return;}
  if(!s.employee&&!(await db.query('SELECT 1 FROM subscriptions WHERE user_id=$1 AND expires>$2 AND cabinet_limit>0',[uid,Date.now()])).rows.length){reply.code(403).send({error:'Для сборки подключите подписку.'});return;}
  if(s.permissions&&!s.permissions.includes(permission)){reply.code(403).send({error:'Нет права на сборку заказов.'});return;}
  return {...s,actor:uid!};
 }
 async function cooldown(s:ScopedStore){const row=(await db.query<{api_retry_after:number}>('SELECT api_retry_after FROM stores WHERE id=$1',[s.id])).rows[0];if(Number(row?.api_retry_after)>Date.now())throw new OzonAssemblyError('Ozon ограничил запросы. Повторите после завершения паузы.');}
 async function limited(s:ScopedStore,action:()=>Promise<any>){await cooldown(s);try{return await action();}catch(e){if(e instanceof OzonError&&e.status===429)await db.query('UPDATE stores SET api_retry_after=GREATEST(api_retry_after,$2),next_sync=GREATEST(next_sync,$2) WHERE id=$1',[s.id,Date.now()+e.retrySeconds*1000]);throw e;}}
 async function locked<T>(id:string,action:()=>Promise<T>):Promise<T>{if(active.has(id))throw new OzonAssemblyError('Другое действие с кабинетом выполняется. Повторите через несколько секунд.');active.add(id);try{return await action();}finally{active.delete(id);}}
 async function fresh(s:ScopedStore,number:string){
  const local=(await db.query<any>('SELECT * FROM ozon_postings WHERE store_id=$1 AND posting_number=$2 AND ($3=\'\' OR warehouse_id=$3)',[s.id,number,s.scope||''])).rows[0];if(!local)throw new OzonAssemblyError('Отправление не найдено.');
  const remote=await limited(s,()=>ozon.posting(credentials(s),number)) as OzonPosting;
  if(!editable(remote)||remote.delivery_method.warehouse_id!==local.warehouse_id||(remote.delivery_schema&&remote.delivery_schema.toLowerCase()!=='fbs'))throw new OzonAssemblyError('Сборка отправления сейчас недоступна в Ozon. Обновите заказы.');
  if(composition(remote)!==JSON.stringify(local.products.map((i:any)=>[i.sku,i.quantity]).sort()))throw new OzonAssemblyError('Состав заказа изменился в Ozon. Обновите заказы.');return remote;
 }
 async function permittedStill(s:ScopedStore,actor:string,route:string){const current=await access.resolve(actor,route);if(!current||current.id!==s.id||current.credential!==s.credential||current.permissions&&!current.permissions.includes('assembly'))throw new OzonAssemblyError('Доступ к сборке изменился.');if(!current.employee&&!(await db.query('SELECT 1 FROM subscriptions WHERE user_id=$1 AND expires>$2 AND cabinet_limit>0',[actor,Date.now()])).rows.length)throw new OzonAssemblyError('Подписка завершилась.');return current;}
 app.get('/api/stores/:id/ozon/assembly',async(req,reply)=>{
  const s=await allowed(req,reply);if(!s)return;
  const q=z.object({warehouse:z.string().max(100).default(''),posting:z.string().max(100).default(''),search:z.string().max(150).default(''),page:z.coerce.number().int().min(1).max(100000).default(1)}).parse(req.query);
  const args=[s.id,s.scope||q.warehouse,q.posting,'%'+q.search+'%'];
  const visible="(p.status='awaiting_packaging' OR p.status='awaiting_deliver' AND EXISTS(SELECT 1 FROM ozon_pick_units z WHERE z.store_id=p.store_id AND z.posting_number=p.posting_number))";
  const where=`p.store_id=$1 AND ${visible} AND ($2='' OR p.warehouse_id=$2) AND ($3='' OR p.posting_number=$3) AND (p.posting_number ILIKE $4 OR p.products::text ILIKE $4 OR EXISTS(SELECT 1 FROM jsonb_array_elements(p.products) item JOIN ozon_product_marking m ON m.store_id=p.store_id AND m.sku=item->>'sku' WHERE m.barcodes::text ILIKE $4))`;
  const total=(await db.query<{n:number}>(`SELECT count(*)::int n FROM ozon_postings p WHERE ${where}`,args)).rows[0].n;
  const postings=(await db.query<any>(`SELECT p.*,EXISTS(SELECT 1 FROM ozon_print_jobs j WHERE j.store_id=p.store_id AND j.posting_number=p.posting_number AND j.completed_at IS NOT NULL) AS printed FROM ozon_postings p WHERE ${where} ORDER BY p.created_at,p.posting_number LIMIT 50 OFFSET $5`,[...args,(q.page-1)*50])).rows;
  const numbers=postings.map(p=>p.posting_number);
  const units=(await db.query<Unit>('SELECT * FROM ozon_pick_units WHERE store_id=$1 AND posting_number=ANY($2::text[])',[s.id,numbers])).rows;
  const marks=(await db.query<any>('SELECT sku,barcodes,required FROM ozon_product_marking WHERE store_id=$1',[s.id])).rows;
  const placement=(await db.query<any>('SELECT c.skus,p.* FROM ozon_catalog c JOIN ozon_stock_placement p ON p.store_id=c.store_id AND p.product_id=c.product_id WHERE c.store_id=$1',[s.id])).rows;
  const rows=postings.flatMap(p=>p.products.map((item:any)=>{const picked=units.filter(u=>u.posting_number===p.posting_number&&u.sku===item.sku&&u.ordinal<item.quantity),m=marks.find(m=>m.sku===item.sku);const loc=placement.find(l=>l.warehouse_id===p.warehouse_id&&l.skus.includes(item.sku));return {printed:p.printed,postingStatus:p.status,cell:loc?.cell||'',address:loc?.address||'',posting:p.posting_number,sku:item.sku,name:item.name,offer_id:item.offer_id,quantity:item.quantity,barcodes:m?.barcodes||[],scanit:p.scanit,units:picked.map(u=>({id:u.id,ordinal:u.ordinal,state:u.state==='ready'&&m?.required===true&&!u.kiz?'waiting':u.state,error:u.error,hasKiz:!!u.kiz})),ready:picked.filter(u=>u.state==='ready'&&(m?.required!==true||!!u.kiz)).length,hasKiz:m?.required===true};}));
  const totals=(await db.query<any>(`SELECT COALESCE(sum((item->>'quantity')::int),0)::int quantity FROM ozon_postings p CROSS JOIN LATERAL jsonb_array_elements(p.products) item WHERE p.store_id=$1 AND ${visible} AND ($2='' OR p.warehouse_id=$2) AND ($3='' OR p.posting_number=$3)`,args.slice(0,3))).rows[0];
  const picked=(await db.query<any>(`SELECT count(*)::int n FROM ozon_pick_units u JOIN ozon_postings p ON p.store_id=u.store_id AND p.posting_number=u.posting_number WHERE p.store_id=$1 AND ${visible} AND ($2='' OR p.warehouse_id=$2) AND ($3='' OR p.posting_number=$3) AND u.state='ready' AND (u.kiz IS NOT NULL OR NOT EXISTS(SELECT 1 FROM ozon_product_marking m WHERE m.store_id=u.store_id AND m.sku=u.sku AND m.required=true)) AND EXISTS(SELECT 1 FROM jsonb_array_elements(p.products) item WHERE item->>'sku'=u.sku AND (item->>'quantity')::int>u.ordinal)`,args.slice(0,3))).rows[0];
  const finish=q.posting?(await db.query<any>("SELECT state,error FROM ozon_ship_tasks WHERE store_id=$1 AND posting_number=$2 AND EXISTS(SELECT 1 FROM ozon_postings p WHERE p.store_id=$1 AND p.posting_number=$2 AND ($3='' OR p.warehouse_id=$3))",[s.id,q.posting,s.scope||q.warehouse])).rows[0]||null:null;
  return {rows,total,page:q.page,quantity:totals.quantity,ready:picked.n,finish};
 });
 app.get('/api/stores/:id/ozon/assembly/auto-candidates',async(req:any,reply)=>{
 const s=await allowed(req,reply,'supplies');if(!s)return;if(s.permissions&&!s.permissions.includes('assembly'))return reply.code(403).send({error:'Нет права на сборку.'});const q=z.object({warehouse:z.string().max(100).default('')}).parse(req.query);
 const rows=(await db.query<any>(`SELECT p.posting_number,p.status,t.state AS finish,t.error,counts.quantity,counts.ready FROM ozon_postings p LEFT JOIN ozon_ship_tasks t ON t.store_id=p.store_id AND t.posting_number=p.posting_number CROSS JOIN LATERAL(SELECT coalesce(sum((item->>'quantity')::int),0)::int quantity,(SELECT count(*)::int FROM ozon_pick_units u WHERE u.store_id=p.store_id AND u.posting_number=p.posting_number AND u.state='ready' AND EXISTS(SELECT 1 FROM jsonb_array_elements(p.products) i WHERE i->>'sku'=u.sku AND (i->>'quantity')::int>u.ordinal) AND (u.kiz IS NOT NULL OR NOT EXISTS(SELECT 1 FROM ozon_product_marking m WHERE m.store_id=u.store_id AND m.sku=u.sku AND m.required=true))) ready FROM jsonb_array_elements(p.products) item) counts WHERE p.store_id=$1 AND ($2='' OR p.warehouse_id=$2) AND p.status IN ('awaiting_packaging','awaiting_deliver') AND EXISTS(SELECT 1 FROM ozon_pick_units u WHERE u.store_id=p.store_id AND u.posting_number=p.posting_number AND u.owner_id=$3) AND NOT EXISTS(SELECT 1 FROM ozon_print_jobs j WHERE j.store_id=p.store_id AND j.posting_number=p.posting_number AND j.completed_at IS NOT NULL) ORDER BY (p.status='awaiting_deliver' OR counts.quantity>0 AND counts.quantity=counts.ready) DESC,p.created_at,p.posting_number LIMIT 50`,[s.id,s.scope||q.warehouse,s.actor])).rows;reply.header('Cache-Control','no-store');return {rows};
 });
 app.post('/api/stores/:id/ozon/assembly/scan',async(req,reply)=>{
  const s=await allowed(req,reply,'assembly');if(!s)return;
  const body=z.object({barcode:z.string().trim().min(1).max(200),warehouse:z.string().max(100).default(''),posting:z.string().max(100).default(''),requestId:z.string().uuid(),ordinal:z.number().int().nonnegative().optional(),auto:z.boolean().default(false)}).parse(req.body);
  return locked(s.id,async()=>{
   const batchScope=JSON.stringify([s.scope||body.warehouse,body.posting,body.barcode]);
   if(body.auto){if(!s.scope&&!body.warehouse)throw new OzonAssemblyError('Для режима Авто выберите конкретный склад.');if(body.ordinal!==undefined)throw new OzonAssemblyError('Авто недоступно для отдельного экземпляра.');const receipt=(await db.query<any>('SELECT * FROM ozon_auto_scan_receipts WHERE store_id=$1 AND request_id=$2',[s.id,body.requestId])).rows[0];if(receipt){if(receipt.actor!==s.actor||receipt.scope!==batchScope)throw new OzonAssemblyError('Действие недоступно.');return receipt.result;}}
   const old=(await db.query<Unit>('SELECT * FROM ozon_pick_units WHERE store_id=$1 AND request_id=$2',[s.id,body.requestId])).rows[0];
   if(old){const p=(await db.query<any>('SELECT warehouse_id FROM ozon_postings WHERE store_id=$1 AND posting_number=$2',[s.id,old.posting_number])).rows[0];if(!p||s.scope&&p.warehouse_id!==s.scope||body.warehouse&&p.warehouse_id!==body.warehouse||body.posting&&old.posting_number!==body.posting||old.owner_id!==s.actor)throw new OzonAssemblyError('Действие недоступно.');return {unit:old.id,needsKiz:old.state==='reserved',posting:old.posting_number,sku:old.sku,reservation:old.request_id};}
   const candidates=(await db.query<any>(`SELECT p.*,item,m.required,m.checked_at FROM ozon_postings p CROSS JOIN LATERAL jsonb_array_elements(p.products) item LEFT JOIN ozon_product_marking m ON m.store_id=p.store_id AND m.sku=item->>'sku' WHERE p.store_id=$1 AND p.status='awaiting_packaging' AND ($2='' OR p.warehouse_id=$2) AND ($3='' OR p.posting_number=$3) AND (m.barcodes ? $4 OR item->>'sku'=$4 OR item->>'offer_id'=$4) ORDER BY p.created_at,p.posting_number,item->>'sku'`,[s.id,s.scope||body.warehouse,body.posting,body.barcode])).rows;
   if(body.auto){
    if(new Set(candidates.map(p=>p.posting_number)).size>100)throw new OzonAssemblyError('Слишком много отправлений. Укажите номер отправления.');
    const plans:any[]=[],remotes=new Map<string,{remote:OzonPosting;data:OzonExemplars}>();
    for(const p of candidates){
     if(p.required===true)continue;
     const units=(await db.query<Unit>('SELECT * FROM ozon_pick_units WHERE store_id=$1 AND posting_number=$2 AND sku=$3',[s.id,p.posting_number,p.item.sku])).rows;
     if(!Array.from({length:p.item.quantity},(_,i)=>units.find(u=>u.ordinal===i)).some(u=>!u||u.state==='released'||u.state==='reserved'&&Number(u.reserved_until)<Date.now()))continue;
     let checked=remotes.get(p.posting_number);if(!checked){checked={remote:await fresh(s,p.posting_number),data:await limited(s,()=>ozon.exemplars(credentials(s),p.posting_number)) as OzonExemplars};remotes.set(p.posting_number,checked);}
     if(!ozonRequiresKiz(checked.remote,checked.data,p.item.sku,p.required===true))plans.push(p);
    }
    if(plans.length){await permittedStill(s,s.actor,(req.params as any).id);return db.transaction(async tx=>{
     let count=0;const postings=new Set<string>();
     for(const p of plans){const current=(await tx.query<any>('SELECT status FROM ozon_postings WHERE store_id=$1 AND posting_number=$2 FOR UPDATE',[s.id,p.posting_number])).rows[0];if(current?.status!=='awaiting_packaging')throw new OzonAssemblyError('Статус отправления изменился. Обновите список.');
      const units=(await tx.query<Unit>('SELECT * FROM ozon_pick_units WHERE store_id=$1 AND posting_number=$2 AND sku=$3 FOR UPDATE',[s.id,p.posting_number,p.item.sku])).rows;
      for(let ordinal=0;ordinal<p.item.quantity;ordinal++){const u=units.find(u=>u.ordinal===ordinal);if(u&&u.state!=='released'&&!(u.state==='reserved'&&Number(u.reserved_until)<Date.now()))continue;if(++count>1000)throw new OzonAssemblyError('Слишком много экземпляров. Укажите номер отправления.');
       await tx.query(`INSERT INTO ozon_pick_units(id,store_id,posting_number,sku,ordinal,state,request_id,owner_id,reserved_until,updated_at,route_id) VALUES($1,$2,$3,$4,$5,'ready',$6,$7,0,$8,$9) ON CONFLICT(store_id,posting_number,sku,ordinal) DO UPDATE SET state='ready',request_id=EXCLUDED.request_id,owner_id=EXCLUDED.owner_id,route_id=EXCLUDED.route_id,reserved_until=0,updated_at=EXCLUDED.updated_at,error=NULL`,[randomUUID(),s.id,p.posting_number,p.item.sku,ordinal,randomUUID(),s.actor,Date.now(),(req.params as any).id]);postings.add(p.posting_number);
      }
     }
     const result={needsKiz:false,count,postings:[...postings]};await tx.query('INSERT INTO ozon_auto_scan_receipts VALUES($1,$2,$3,$4,$5)',[s.id,body.requestId,s.actor,batchScope,JSON.stringify(result)]);return result;
    });}
   }
   for(const p of candidates){
    const existing=(await db.query<Unit>('SELECT * FROM ozon_pick_units WHERE store_id=$1 AND posting_number=$2 AND sku=$3 ORDER BY ordinal',[s.id,p.posting_number,p.item.sku])).rows;
    let ordinal=-1;for(let i=0;i<p.item.quantity;i++){if(body.ordinal!==undefined&&body.ordinal!==i)continue;const u=existing.find(u=>u.ordinal===i);if(!u||u.state==='released'||u.state==='ready'&&!u.kiz&&p.required===true||u.state==='reserved'&&u.reserved_until<Date.now()){ordinal=i;break;}}
    if(ordinal<0)continue;
    const remote=await fresh(s,p.posting_number),sku=p.item.sku;
    const data=await limited(s,()=>ozon.exemplars(credentials(s),p.posting_number)) as OzonExemplars;
    const need=ozonRequiresKiz(remote,data,sku,p.required===true);
    await permittedStill(s,s.actor,(req.params as any).id);
    const id=randomUUID(),now=Date.now();
    const unit=(await db.query<Unit>(`INSERT INTO ozon_pick_units(id,store_id,posting_number,sku,ordinal,state,request_id,owner_id,reserved_until,updated_at,route_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT(store_id,posting_number,sku,ordinal) DO UPDATE SET state=EXCLUDED.state,request_id=EXCLUDED.request_id,owner_id=EXCLUDED.owner_id,route_id=EXCLUDED.route_id,reserved_until=EXCLUDED.reserved_until,updated_at=EXCLUDED.updated_at,error=NULL RETURNING *`,[id,s.id,p.posting_number,sku,ordinal,need?'reserved':'ready',body.requestId,s.actor,now+120000,now,(req.params as any).id])).rows[0];
    return {unit:unit.id,reservation:unit.request_id,needsKiz:need,posting:p.posting_number,sku,name:p.item.name};
   }
   throw new OzonAssemblyError(candidates.length?'Все экземпляры этого товара уже отсканированы или ожидают проверки.':'Нет такого баркода');
  });
 });
 app.post('/api/stores/:id/ozon/assembly/:unit/release',async(req,reply)=>{
  const s=await allowed(req,reply,'assembly');if(!s)return;
  const body=z.object({reservation:z.string().uuid().optional()}).parse(req.body);
  await db.query("UPDATE ozon_pick_units u SET state='released' FROM ozon_postings p WHERE u.id=$1 AND u.store_id=$2 AND u.owner_id=$3 AND u.state='reserved' AND u.request_id=$5 AND p.store_id=u.store_id AND p.posting_number=u.posting_number AND ($4='' OR p.warehouse_id=$4)",[(req.params as any).unit,s.id,s.actor,s.scope||'',body.reservation||'']);return {ok:true};
 });
 app.post('/api/stores/:id/ozon/assembly/:unit/kiz',async(req,reply)=>{
  const s=await allowed(req,reply,'assembly');if(!s)return;
  const body=z.object({kiz:z.string().max(2000),reservation:z.string().uuid().optional()}).parse(req.body),mark=validateMarking(body.kiz);if(!mark.valid)return reply.code(400).send({error:mark.message});
  return locked(s.id,async()=>{
   const u=(await db.query<Unit>(`SELECT u.* FROM ozon_pick_units u JOIN ozon_postings p ON p.store_id=u.store_id AND p.posting_number=u.posting_number WHERE u.store_id=$1 AND u.id=$2 AND ($3='' OR p.warehouse_id=$3)`,[s.id,(req.params as any).unit,s.scope||''])).rows[0];if(!u)throw new OzonAssemblyError('Экземпляр не найден.');
   if(['queued','checking','ready'].includes(u.state)&&u.kiz===mark.code)return {ok:true};
   if(!(u.state==='ready'&&!u.kiz)&&u.state!=='error'&&(u.state!=='reserved'||u.owner_id!==s.actor||u.request_id!==body.reservation))throw new OzonAssemblyError('Экземпляр уже обрабатывается другим сотрудником.');
   const p=await fresh(s,u.posting_number);if(!p.products.some(item=>item.sku===u.sku&&item.quantity>u.ordinal))throw new OzonAssemblyError('Состав заказа изменился.');
   if((await db.query('SELECT id FROM ozon_pick_units WHERE store_id=$1 AND identity=$2 AND id<>$3',[s.id,mark.identity,u.id])).rows.length)return reply.code(409).send({error:'Этот КИЗ уже используется для другого экземпляра.'});
   await permittedStill(s,s.actor,(req.params as any).id);
   await db.transaction(async tx=>{
    await tx.query('INSERT INTO ozon_pick_history(id,unit_id,previous,changed_at) VALUES($1,$2,$3,$4)',[randomUUID(),u.id,JSON.stringify(u),Date.now()]);
    await tx.query("UPDATE ozon_pick_units SET previous_code=kiz,kiz=$2,identity=$3,state='queued',attempted=false,updated_at=$4,error=NULL,owner_id=$5,route_id=$6 WHERE id=$1",[u.id,mark.code,mark.identity,Date.now(),s.actor,(req.params as any).id]);
    await tx.query('INSERT INTO ozon_pick_checks(store_id,posting_number,next_at) VALUES($1,$2,0) ON CONFLICT(store_id,posting_number) DO UPDATE SET next_at=0',[s.id,u.posting_number]);
   });return {ok:true};
  });
 });
 app.post('/api/stores/:id/ozon/assembly/finish',async(req,reply)=>{
  const s=await allowed(req,reply,'supplies');if(!s)return;
  const body=z.object({posting:z.string().min(1).max(100)}).parse(req.body);
  return locked(s.id,async()=>{
   const local=(await db.query<any>("SELECT warehouse_id FROM ozon_postings WHERE store_id=$1 AND posting_number=$2 AND ($3='' OR warehouse_id=$3)",[s.id,body.posting,s.scope||''])).rows[0];if(!local)throw new OzonAssemblyError('Отправление не найдено.');
   const remote=await limited(s,()=>ozon.posting(credentials(s),body.posting)) as OzonPosting;
   if(remote.delivery_method.warehouse_id!==local.warehouse_id)throw new OzonAssemblyError('Склад отправления изменился.');
   if(remote.status==='awaiting_deliver'){await db.query("UPDATE ozon_postings SET status=$3 WHERE store_id=$1 AND posting_number=$2",[s.id,body.posting,remote.status]);await confirmOzonAssembly(db,s.id,body.posting);return {ok:true};}
   const p=await fresh(s,body.posting);if(p.is_multibox||(p.multi_box_qty||0)>1)throw new OzonAssemblyError('Многокоробочную сборку завершите в Ozon.');
   const units=(await db.query<Unit>('SELECT * FROM ozon_pick_units WHERE store_id=$1 AND posting_number=$2',[s.id,body.posting])).rows;
   if(p.products.some(item=>units.filter(u=>u.sku===item.sku&&u.ordinal<item.quantity&&u.state==='ready').length!==item.quantity))throw new OzonAssemblyError('Сначала отсканируйте все товары и дождитесь проверки КИЗ.');
   if(!p.products.length||p.products.some(item=>item.quantity<1))throw new OzonAssemblyError('Некорректный состав отправления Ozon.');
   const exemplars=await limited(s,()=>ozon.exemplars(credentials(s),body.posting)) as OzonExemplars;
   const catalogMarks=(await db.query<any>('SELECT sku,required FROM ozon_product_marking WHERE store_id=$1',[s.id])).rows;
   for(const item of p.products){if(ozonRequiresKiz(p,exemplars,item.sku,catalogMarks.some(m=>m.sku===item.sku&&m.required===true))&&units.filter(u=>u.sku===item.sku&&u.ordinal<item.quantity&&u.kiz).length!==item.quantity)throw new OzonAssemblyError('Для маркированного товара нужно отсканировать КИЗ перед завершением сборки.');}
   const marked=units.filter(u=>u.kiz&&p.products.some(item=>item.sku===u.sku&&item.quantity>u.ordinal));
   if(marked.length){const state=await limited(s,()=>ozon.exemplarStatus(credentials(s),body.posting));for(const u of marked){const m=state.products.find((p:any)=>p.product_id===u.sku)?.exemplars.find((e:any)=>e.exemplar_id===u.exemplar_id)?.marks.find((m:any)=>m.mark===u.kiz);if(!m||m.error_codes.length||!['passed','success'].includes(m.check_status.toLowerCase()))throw new OzonAssemblyError('Ozon пока не подтвердил КИЗ.');}}
   const old=(await db.query<any>('SELECT * FROM ozon_ship_tasks WHERE store_id=$1 AND posting_number=$2',[s.id,body.posting])).rows[0];
   if(old&&old.state!=='error'&&p.substatus!=='ship_failed')throw new OzonAssemblyError('Ozon ещё обрабатывает предыдущую сборку. Обновите отправления перед повтором.');
   const current=await access.resolve(s.actor,(req.params as any).id);if(!current||current.credential!==s.credential||current.permissions&&!current.permissions.includes('supplies'))throw new OzonAssemblyError('Доступ к отправлению изменился.');
   if(!current.employee&&!(await db.query('SELECT 1 FROM subscriptions WHERE user_id=$1 AND expires>$2 AND cabinet_limit>0',[s.actor,Date.now()])).rows.length)throw new OzonAssemblyError('Подписка завершилась.');
   await db.query("INSERT INTO ozon_ship_tasks(store_id,posting_number,state,updated_at) VALUES($1,$2,'checking',$3) ON CONFLICT(store_id,posting_number) DO UPDATE SET state='checking',updated_at=EXCLUDED.updated_at,error=NULL",[s.id,body.posting,Date.now()]);
   try{const numbers=await limited(s,()=>ozon.ship(credentials(s),p));if(numbers.length!==1||numbers[0]!==body.posting)throw new OzonAssemblyError('Ozon изменил номера отправлений. Обновите заказы.');}catch(e){if(e instanceof OzonError&&e.status>=400&&e.status<500)await db.query("UPDATE ozon_ship_tasks SET state='error',error=$3 WHERE store_id=$1 AND posting_number=$2",[s.id,body.posting,'Ozon отклонил завершение сборки.']);throw e;}
   return {ok:true};
  });
 });
 async function process(s:ScopedStore,number:string){
  const units=(await db.query<Unit>("SELECT * FROM ozon_pick_units WHERE store_id=$1 AND posting_number=$2 AND state IN ('queued','checking') ORDER BY ordinal",[s.id,number])).rows;if(!units.length){await db.query('DELETE FROM ozon_pick_checks WHERE store_id=$1 AND posting_number=$2',[s.id,number]);return;}
  try{
   const p=await fresh(s,number);
   for(const u of units.filter(u=>u.state==='queued')){try{await permittedStill(s,u.owner_id,u.route_id);}catch{await db.query("UPDATE ozon_pick_units SET state='error',error=$2 WHERE id=$1",[u.id,'Доступ сотрудника изменился. Повторите сохранение КИЗ с действующим доступом.']);u.state='error';}}
   if(units.some(u=>!p.products.some(i=>i.sku===u.sku&&i.quantity>u.ordinal)))throw new OzonAssemblyError('Состав отправления изменился. Проверьте заказы.');
   // Status exists only after a set task. The first submission must not depend on it.
   const status=units.some(u=>u.state==='checking')?await limited(s,()=>ozon.exemplarStatus(credentials(s),number)):{status:'update_available',products:[]};
   for(const u of units.filter(u=>u.state==='checking')){
    const e=status.products.find((p:any)=>p.product_id===u.sku)?.exemplars.find((e:any)=>e.exemplar_id===u.exemplar_id),m=e?.marks.find((m:any)=>m.mark===u.kiz);
    if(m?.error_codes.length||m&&['failed','error'].includes(m.check_status.toLowerCase())){await db.query("UPDATE ozon_pick_units SET state='error',error=$2 WHERE id=$1",[u.id,'Ошибка КИЗ Ozon: '+(m.error_codes.join(', ')||m.check_status)]);u.state='error';}
    else if(m&&['passed','success'].includes(m.check_status.toLowerCase())&&m.error_codes.length===0){await db.query("UPDATE ozon_pick_units SET state='ready',error=NULL WHERE id=$1",[u.id]);u.state='ready';}
    else if(!m&&u.attempted&&Date.now()-u.updated_at>60000){await db.query("UPDATE ozon_pick_units SET state='error',error=$2 WHERE id=$1",[u.id,'Ozon не подтвердил сохранение КИЗ. Проверьте код и повторите сохранение.']);u.state='error';}
   }
   const queued=units.filter(u=>u.state==='queued');
   if(queued.length&&!['validation_in_process','update_not_available'].includes(status.status)){
    const remote=await limited(s,()=>ozon.exemplars(credentials(s),number));
    if(JSON.stringify(remote.products.map((item:any)=>[item.product_id,item.quantity]).sort())!==composition(p))throw new OzonAssemblyError('Ozon вернул неполный состав экземпляров. Обновите заказы.');
    const claimed=(await db.query<Unit>("SELECT * FROM ozon_pick_units WHERE store_id=$1 AND posting_number=$2 AND exemplar_id IS NOT NULL AND state<>'released'",[s.id,number])).rows;
    // Change only this submission. Other units keep exactly their freshly read remote data.
    const reserved=claimed.filter(u=>!queued.some(q=>q.id===u.id)).map(u=>u.exemplar_id!);
    const merged=mergeOzonMarks(remote,queued,reserved);
    // Recheck shop removal/key changes before any upstream write.
    if(!(await db.query("SELECT 1 FROM stores WHERE id=$1 AND credential=$2 AND status<>'removed'",[s.id,s.credential])).rows.length)return;
    await db.transaction(async tx=>{for(const u of queued)await tx.query("UPDATE ozon_pick_units SET exemplar_id=$2,state='checking',attempted=true,updated_at=$3 WHERE id=$1",[u.id,u.exemplar_id,Date.now()]);});
    try{await limited(s,()=>ozon.setExemplars(credentials(s),merged));}catch(e){if(e instanceof OzonError&&e.status>=400&&e.status<500)for(const u of queued)await db.query("UPDATE ozon_pick_units SET state=$2,attempted=false,error=$3 WHERE id=$1",[u.id,e.status===429?'queued':'error',e.status===429?null:'Ozon отклонил сохранение КИЗ. Проверьте код и повторите.']);throw e;}
   }
  }catch(e){
   if(e instanceof OzonError&&e.status===429)return;
   if(e instanceof OzonAssemblyError)await db.query("UPDATE ozon_pick_units SET state='error',error=$3 WHERE store_id=$1 AND posting_number=$2 AND state='checking'",[s.id,number,e.message]);
   // An uncertain set response stays in checking; never blindly replay the old full payload.
   await db.query("UPDATE ozon_pick_units SET state='error',error=$3 WHERE store_id=$1 AND posting_number=$2 AND state='queued'",[s.id,number,e instanceof OzonError?'Ozon не принял запрос. Повторите сохранение КИЗ.':e instanceof OzonAssemblyError?e.message:'Не удалось проверить КИЗ Ozon. Повторите сохранение.']);
  }
 }
 async function tick(){if(running||closing)return;running=true;try{
  if(Date.now()-lastRetention>=60000){await purgeExpiredOzonMarks(db);lastRetention=Date.now();}
  const task=(await db.query<any>(`SELECT c.*,s.credential,s.user_id,s.marketplace FROM ozon_pick_checks c JOIN stores s ON s.id=c.store_id WHERE c.next_at<=$1 AND s.marketplace='ozon' AND s.status<>'removed' AND s.api_retry_after<=$1 AND EXISTS(SELECT 1 FROM subscriptions sub WHERE sub.expires>$1 AND sub.cabinet_limit>0 AND (sub.user_id=s.user_id OR EXISTS(SELECT 1 FROM client_access a WHERE a.store_id=s.id AND a.fulfillment_id=sub.user_id AND a.revoked IS NULL))) ORDER BY c.next_at LIMIT 1`,[Date.now()])).rows[0];
  if(task&&!active.has(task.store_id))await locked(task.store_id,async()=>{await db.query('UPDATE ozon_pick_checks SET next_at=$3 WHERE store_id=$1 AND posting_number=$2',[task.store_id,task.posting_number,Date.now()+15000]);await process({...task,id:task.store_id},task.posting_number);});
  const shipping=(await db.query<any>("SELECT t.*,s.credential FROM ozon_ship_tasks t JOIN stores s ON s.id=t.store_id WHERE t.state='checking' AND t.updated_at<$1 AND s.status<>'removed' AND s.api_retry_after<=$2 ORDER BY t.updated_at LIMIT 1",[Date.now()-15000,Date.now()])).rows[0];
  if(shipping&&!active.has(shipping.store_id))await locked(shipping.store_id,async()=>{
   await db.query('UPDATE ozon_ship_tasks SET updated_at=$3 WHERE store_id=$1 AND posting_number=$2',[shipping.store_id,shipping.posting_number,Date.now()]);
   try{const s={...shipping,id:shipping.store_id} as ScopedStore,p=await limited(s,()=>ozon.posting(credentials(s),shipping.posting_number));if(p.status==='awaiting_deliver'){await db.transaction(async tx=>{await tx.query("UPDATE ozon_postings SET status=$3 WHERE store_id=$1 AND posting_number=$2",[shipping.store_id,shipping.posting_number,p.status]);await tx.query("UPDATE ozon_ship_tasks SET state='done' WHERE store_id=$1 AND posting_number=$2",[shipping.store_id,shipping.posting_number]);await tx.query('UPDATE ozon_postings SET assembled_at=COALESCE(assembled_at,$3) WHERE store_id=$1 AND posting_number=$2',[shipping.store_id,shipping.posting_number,Date.now()]);});}else if(p.substatus==='ship_failed'||!['awaiting_packaging','awaiting_registration'].includes(p.status))await db.query("UPDATE ozon_ship_tasks SET state='error',error=$3 WHERE store_id=$1 AND posting_number=$2",[shipping.store_id,shipping.posting_number,'Ozon не подтвердил сборку: '+p.status]);}catch{/* A failed read cannot authorize another ship request. */}
  });
 }finally{running=false;}}
 return {tick,async close(){closing=true;while(running||active.size)await new Promise(r=>setTimeout(r,20));}};
}
