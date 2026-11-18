import type {FastifyInstance} from 'fastify';import type {Database} from './database.ts';import type {ScopedStore} from './access.ts';import {randomUUID} from 'node:crypto';import {z} from 'zod';import {ozonCredentials,OzonError,type OzonClient} from './ozon.ts';import {unseal} from './security.ts';import {stockLocation,InternalStockError} from './internal-stock.ts';
const fail=(m:string,s=409)=>new InternalStockError(m,s);
export async function registerOzonStockPublish(app:FastifyInstance,db:Database,key:Buffer,ozon:OzonClient,context:(req:any,edit?:boolean)=>Promise<{uid:string|null;s:ScopedStore;warehouse:string}>,reconcile:()=>Promise<void>,schedule:(id:string,force?:boolean)=>Promise<void>){
 await db.exec(`CREATE TABLE IF NOT EXISTS ozon_stock_publish(id text PRIMARY KEY,store_id text NOT NULL,warehouse_id text NOT NULL,actor text NOT NULL,credential text NOT NULL,items jsonb NOT NULL,completed integer NOT NULL DEFAULT 0,created_at bigint NOT NULL,attempted_at bigint NOT NULL DEFAULT 0);`);
 const credentials=(s:ScopedStore)=>ozonCredentials.parse(JSON.parse(unseal(s.credential,key)));
 async function allowed(s:ScopedStore){if(!ozon.stockWriteAllowed||!ozon.writeStocks||!ozon.stockLevels)throw fail('Передача остатков Ozon недоступна.');if(!await ozon.stockWriteAllowed(credentials(s)))throw fail('У ключа Ozon нет права /v2/products/stocks. Для передачи остатков нужен доступ к изменению товаров (Product). Полный доступ не требуется.',403);}
 async function cooldown(s:ScopedStore){const r=(await db.query<any>('SELECT api_retry_after FROM stores WHERE id=$1',[s.id])).rows[0];if(Number(r?.api_retry_after)>Date.now())throw fail('Ozon ограничил запросы. Повторите после паузы.',429);}
 app.post('/api/stores/:id/ozon/stocks/publish-preview',async(req:any)=>{
 const c=await context(req,true);await cooldown(c.s);await allowed(c.s);await reconcile();
 const items=(await db.query<any>(`SELECT n.id,n.version,n.quantity AS amount,c.product_id,c.sku,c.skus,c.title,c.article,c.barcodes FROM internal_stock_items n JOIN ozon_catalog c ON n.source_id='ozon:'||c.sku WHERE n.location=$1 AND c.store_id=$2 AND c.active ORDER BY c.product_id`,[stockLocation(c.s.id,c.warehouse),c.s.id])).rows;
 if(!items.length)throw fail('Сначала задайте внутренние остатки товаров этого склада.');if(items.some(i=>i.amount<0||i.amount>1000000))throw fail('Количество должно быть от 0 до 1000000. Исправьте внутренние остатки.');
 const total=(await db.query<any>('SELECT count(*)::int n FROM ozon_catalog WHERE store_id=$1 AND active',[c.s.id])).rows[0].n;
 const id=randomUUID();await db.query('INSERT INTO ozon_stock_publish(id,store_id,warehouse_id,actor,credential,items,created_at) VALUES($1,$2,$3,$4,$5,$6,$7)',[id,c.s.id,c.warehouse,c.uid,c.s.credential,JSON.stringify(items),Date.now()]);return {id,count:items.length,quantity:items.reduce((n,i)=>n+i.amount,0),skipped:total-items.length};
 });
 app.post('/api/stores/:id/ozon/stocks/publish',async(req:any)=>{
 const c=await context(req,true),body=z.object({id:z.string().uuid()}).parse(req.body);await reconcile();const current=await context(req,true);await cooldown(current.s);await allowed(current.s);
 // Database lock serializes simultaneous confirmations, including separate server processes.
 return db.transaction(async tx=>{
 await tx.query('SELECT id FROM stores WHERE id=$1 FOR UPDATE',[c.s.id]);
 const live=(await tx.query<any>("SELECT credential,status FROM stores WHERE id=$1",[c.s.id])).rows[0];if(!live||live.status==='removed'||live.credential!==c.s.credential)throw fail('Подключение изменилось. Подтвердите передачу заново.');
 const job=(await tx.query<any>('SELECT * FROM ozon_stock_publish WHERE id=$1 AND store_id=$2 AND warehouse_id=$3 AND actor=$4 FOR UPDATE',[body.id,c.s.id,c.warehouse,c.uid])).rows[0];if(!job)throw fail('Подтверждение не найдено.',404);if(job.completed===job.items.length)return {ok:true,count:job.completed};if(job.credential!==current.s.credential||Date.now()-Number(job.created_at)>600000)throw fail('Подтверждение устарело. Подготовьте передачу заново.');

 await tx.query('SELECT id FROM internal_stock_settings WHERE id=1 FOR UPDATE');const quantities=(await tx.query<any>('SELECT id,quantity,version FROM internal_stock_items WHERE location=$1 AND id=ANY($2::text[]) FOR UPDATE',[stockLocation(c.s.id,c.warehouse),job.items.map((i:any)=>i.id)])).rows;if(job.items.some((i:any)=>!quantities.some(n=>n.id===i.id&&n.version===i.version&&n.quantity===i.amount)))throw fail('Внутренние остатки изменились. Закройте окно и подтвердите новые значения.');
 let completed=job.completed,error='';
 try{for(let offset=completed;offset<job.items.length;offset+=100){const batch=job.items.slice(offset,offset+100),products=batch.map((i:any)=>({productId:i.product_id,sku:i.sku,skus:i.skus,title:i.title,article:i.article,barcodes:i.barcodes}));
 // Always read first: a lost response must not cause an immediate duplicate write.
 let levels=await ozon.stockLevels!(credentials(current.s),products);let pending=batch.filter((i:any)=>levels.find(l=>l.productId===i.product_id&&l.warehouse===c.warehouse)?.available!==i.amount);
 if(pending.length){if(Number(job.attempted_at)>Date.now()-65000){error='Ozon ещё обрабатывает передачу. Подождите минуту и повторите с тем же подтверждением.';break;}
 job.attempted_at=Date.now();await tx.query('UPDATE ozon_stock_publish SET attempted_at=$2 WHERE id=$1',[job.id,job.attempted_at]);const result=await ozon.writeStocks!(credentials(current.s),c.warehouse,pending.map((i:any)=>({productId:i.product_id,amount:i.amount})));const rejected=result.find(r=>!r.updated||r.errors.length);if(rejected){error='Ozon отклонил товар '+rejected.productId+': '+rejected.errors.map(e=>e.code).join(', ');break;}levels=await ozon.stockLevels!(credentials(current.s),products);if(batch.some((i:any)=>levels.find(l=>l.productId===i.product_id&&l.warehouse===c.warehouse)?.available!==i.amount)){error='Ozon принял запрос, но ещё не подтвердил количества. Повторите проверку этим же подтверждением.';break;}}
 for(const l of levels.filter(l=>l.warehouse===c.warehouse))await tx.query('INSERT INTO ozon_stock_levels VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(store_id,product_id,warehouse_id) DO UPDATE SET present=EXCLUDED.present,reserved=EXCLUDED.reserved,available=EXCLUDED.available',[c.s.id,l.productId,l.warehouse,l.present,l.reserved,l.available]);
 completed=offset+batch.length;job.attempted_at=0;await tx.query('UPDATE ozon_stock_publish SET completed=$2,attempted_at=0 WHERE id=$1',[job.id,completed]);}
 }catch(e){if(e instanceof OzonError&&e.status===429){await tx.query('UPDATE stores SET api_retry_after=GREATEST(api_retry_after,$2) WHERE id=$1',[c.s.id,Date.now()+Math.max(60,e.retrySeconds)*1000]);error='Ozon ограничил запросы. Подтверждённые партии сохранены; повторите позже.';}else error=e instanceof OzonError&&e.status===403?'Ozon отклонил доступ к изменению остатков. Проверьте права ключа.':'Не удалось подтвердить результат Ozon. Повторите проверку этим же подтверждением.';}
 return {ok:!error,count:completed,total:job.items.length,error:error||undefined};
 });
 });
}
