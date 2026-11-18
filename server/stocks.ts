import type { FastifyInstance } from "fastify";
import type { Database } from "./database.ts";
import type { Access, ScopedStore } from "./access.ts";
import { content, marketplace, WbError, type WbClient } from "./wb.ts";
import { unseal } from "./security.ts";
import { z } from "zod";
import {stockLocation,InternalStockError} from './internal-stock.ts';
import {randomUUID} from 'node:crypto';

const cardPage = z.object({ cards: z.array(z.object({
  nmID: z.number().int().positive(), title: z.string().optional().default(""),
  vendorCode: z.string().optional().default(""), sizes: z.array(z.object({
    chrtID: z.number().int().positive(), techSize: z.string().optional().default(""),
    skus: z.array(z.string()),
  })),
})), cursor: z.object({ updatedAt: z.string().optional(), nmID: z.number().optional(), total: z.number() }) });
const stockResponse = z.object({ stocks: z.array(z.object({ chrtId: z.number().int().positive(), amount: z.number().int().nonnegative() })) });
type Job = { store_id: string; warehouse_id: string; user_id: string; route_id: string; status: string };

export async function registerStocks(app: FastifyInstance, db: Database, key: Buffer,
  userId: (req: any) => Promise<string | null>, access: Access, wb: WbClient,
  warehouses: (store: ScopedStore) => Promise<{id: string; name: string}[]>,beforePublish:()=>Promise<void>=async()=>{}) {
  await db.exec(`CREATE TABLE IF NOT EXISTS inventory_items (
    store_id text NOT NULL REFERENCES stores(id), warehouse_id text NOT NULL, chrt_id text NOT NULL,
    nm_id text NOT NULL,title text NOT NULL,article text NOT NULL,size text NOT NULL,barcodes jsonb NOT NULL,
    amount integer,cell text NOT NULL DEFAULT '',address text NOT NULL DEFAULT '',version integer NOT NULL DEFAULT 1,
    PRIMARY KEY(store_id,warehouse_id,chrt_id));
    CREATE TABLE IF NOT EXISTS inventory_sync (
    store_id text NOT NULL REFERENCES stores(id),warehouse_id text NOT NULL,user_id text NOT NULL,route_id text NOT NULL,
    status text NOT NULL DEFAULT 'queued',synced_at text,error text,run_at bigint NOT NULL DEFAULT 0,
    PRIMARY KEY(store_id,warehouse_id));
    UPDATE inventory_sync SET status='queued' WHERE status='syncing';
    CREATE TABLE IF NOT EXISTS internal_stock_publish(id text PRIMARY KEY,store_id text NOT NULL,warehouse_id text NOT NULL,actor text NOT NULL,items jsonb NOT NULL,completed integer NOT NULL DEFAULT 0,created_at bigint NOT NULL);`);
  const locks = new Set<string>();
  let running: Promise<void> | undefined, stopping = false;
  async function authorize(uid: string | null, route: string, edit = false) {
    const store = await access.resolve(uid, route);
    if (!store) throw Object.assign(new Error("Магазин не найден или доступ отозван."), { statusCode: 404 });
    if(store.marketplace==='ozon')throw Object.assign(new Error('Остатки Ozon пока не подключены.'),{statusCode:501});
    const paid = (await db.query("SELECT 1 FROM subscriptions WHERE user_id=$1 AND expires>$2 AND cabinet_limit>0", [uid, Date.now()])).rows.length;
    if ((!paid && !store.employee) || (store.permissions && !store.permissions.includes(edit ? "stocks" : "view")))
      throw Object.assign(new Error(edit ? "Нет права изменять остатки." : "Для просмотра остатков нужна подписка или доступ сотрудника."), { statusCode: 403 });
    return store;
  }
  async function context(req: any, reply: any, edit = false) {
    try {
      const uid = await userId(req), store = await authorize(uid, req.params.id, edit);
      const warehouse = z.string().min(1).max(100).parse(req.query.warehouse);
      if (store.scope ? warehouse !== store.scope : !(await warehouses(store)).some(w => w.id === warehouse))
        throw Object.assign(new Error("Нет доступа к этому складу."), { statusCode: 403 });
      return { uid: uid!, store, warehouse };
    } catch (e: any) { reply.code(e.statusCode || 400).send({ error: e instanceof z.ZodError ? "Выберите склад." : e.message }); return null; }
  }
  async function enqueue(store: ScopedStore, warehouse: string, uid: string, route: string, force = false) {
    await db.query(`INSERT INTO inventory_sync(store_id,warehouse_id,user_id,route_id) VALUES($1,$2,$3,$4)
      ON CONFLICT(store_id,warehouse_id) DO UPDATE SET status='queued',error=NULL,user_id=$3,route_id=$4
      WHERE inventory_sync.status NOT IN ('queued','syncing') AND inventory_sync.run_at<=$5
      AND ($6 OR inventory_sync.synced_at IS NULL OR inventory_sync.synced_at<$7)`,
      [store.id, warehouse, uid, route, Date.now(), force, new Date(Date.now() - 300000).toISOString()]);
  }
  const filters = z.object({ search: z.string().max(200).default(""), availability: z.enum(["all", "available"]).default("available"), page: z.coerce.number().int().min(1).max(100000).default(1) });
  app.get("/api/stores/:id/stocks", async (req: any, reply) => {
    const ctx = await context(req, reply); if (!ctx) return;
    const f = filters.safeParse(req.query); if (!f.success) return reply.code(400).send({error:"Некорректный фильтр."});
    await enqueue(ctx.store, ctx.warehouse, ctx.uid, req.params.id);
    const params = [ctx.store.id, ctx.warehouse, f.data.search, f.data.availability,stockLocation(ctx.store.id,ctx.warehouse)];
    const where = `store_id=$1 AND warehouse_id=$2 AND ($3='' OR strpos(lower(concat_ws(' ',title,article,size,barcodes::text,cell,address)),lower($3))>0) AND ($4='all' OR amount>0 OR EXISTS(SELECT 1 FROM internal_stock_items n WHERE n.location=$5 AND n.source_id='wb:'||inventory_items.chrt_id AND n.quantity<>0))`;
    const rows = (await db.query(`SELECT chrt_id,nm_id,title,article,size,barcodes,amount,cell,address,version FROM inventory_items WHERE ${where} ORDER BY title,chrt_id LIMIT 100 OFFSET $6`, [...params, (f.data.page-1)*100])).rows;
    const internal=(await db.query<any>('SELECT id,source_id,quantity,version FROM internal_stock_items WHERE location=$1 AND source_id=ANY($2::text[])',[stockLocation(ctx.store.id,ctx.warehouse),rows.map(r=>'wb:'+r.chrt_id)])).rows;
    const enriched=rows.map(r=>({...r,internal:internal.find(i=>i.source_id==='wb:'+r.chrt_id)||null}));
    const total = (await db.query<{count:number}>(`SELECT count(*)::int count FROM inventory_items WHERE ${where}`, params)).rows[0].count;
    const summary = (await db.query(`SELECT COALESCE(sum(amount),0)::bigint quantity,count(*) FILTER(WHERE amount>0)::int positions,count(*) FILTER(WHERE amount IS NULL)::int unknown FROM inventory_items WHERE store_id=$1 AND warehouse_id=$2`, [ctx.store.id,ctx.warehouse])).rows[0];
    const sync = (await db.query("SELECT status,synced_at,error,run_at FROM inventory_sync WHERE store_id=$1 AND warehouse_id=$2",[ctx.store.id,ctx.warehouse])).rows[0];
    return { items: enriched, total, summary, sync, canEdit: !ctx.store.permissions || ctx.store.permissions.includes("stocks") };
  });
  app.post("/api/stores/:id/stocks/sync", async (req: any, reply) => {
    const ctx = await context(req, reply); if (!ctx) return;
    const current=(await db.query<{status:string;run_at:number}>("SELECT status,run_at FROM inventory_sync WHERE store_id=$1 AND warehouse_id=$2",[ctx.store.id,ctx.warehouse])).rows[0];
    if(current && !['queued','syncing'].includes(current.status) && Number(current.run_at)>Date.now()) return reply.code(429).send({error:"Подождите несколько секунд перед повторным обновлением."});
    await enqueue(ctx.store,ctx.warehouse,ctx.uid,req.params.id,true);
    return reply.code(202).send({ok:true});
  });
  app.post('/api/stores/:id/stocks/publish-preview',async(req:any,reply)=>{
    const c=await context(req,reply,true);if(!c)return;
    await beforePublish();
    const items=(await db.query<any>(`SELECT n.id,n.version,n.quantity AS amount,i.chrt_id FROM internal_stock_items n JOIN inventory_items i ON n.source_id='wb:'||i.chrt_id WHERE n.location=$1 AND i.store_id=$2 AND i.warehouse_id=$3 ORDER BY i.chrt_id`,[stockLocation(c.store.id,c.warehouse),c.store.id,c.warehouse])).rows;
    if(!items.length)return reply.code(409).send({error:'Сначала задайте внутренние остатки товаров этого склада.'});
    if(items.some(i=>i.amount<0||i.amount>100000))return reply.code(409).send({error:'Исправьте внутренние остатки вне диапазона WB: от 0 до 100000. Передача не начата.'});
    const id=randomUUID();await db.query('INSERT INTO internal_stock_publish(id,store_id,warehouse_id,actor,items,created_at) VALUES($1,$2,$3,$4,$5,$6)',[id,c.store.id,c.warehouse,c.uid,JSON.stringify(items),Date.now()]);
    const total=(await db.query<any>('SELECT count(*)::int n FROM inventory_items WHERE store_id=$1 AND warehouse_id=$2',[c.store.id,c.warehouse])).rows[0].n;
    return {id,count:items.length,quantity:items.reduce((sum,i)=>sum+i.amount,0),skipped:total-items.length};
  });
  app.post('/api/stores/:id/stocks/publish',async(req:any,reply)=>{
    const c=await context(req,reply,true);if(!c)return;
    await beforePublish();
    const body=z.object({id:z.string().uuid()}).parse(req.body);
    if(locks.has(c.store.id))return reply.code(409).send({error:'Дождитесь завершения обновления остатков.'});
    locks.add(c.store.id);
    try{
      const job=(await db.query<any>('SELECT * FROM internal_stock_publish WHERE id=$1 AND store_id=$2 AND warehouse_id=$3 AND actor=$4',[body.id,c.store.id,c.warehouse,c.uid])).rows[0];
      if(!job)throw new InternalStockError('Подтверждение не найдено.',404);
      if(job.completed===job.items.length)return {ok:true,count:job.completed};
      if(Date.now()-Number(job.created_at)>600000)throw new InternalStockError('Подтверждение устарело. Откройте передачу остатков заново.');
      for(let offset=job.completed;offset<job.items.length;offset+=1000){
        if(offset>job.completed)await new Promise(r=>setTimeout(r,250));
        const current=await authorize(c.uid,req.params.id,true);if(current.id!==c.store.id||current.scope&&current.scope!==c.warehouse)throw new InternalStockError('Доступ к складу изменился.',403);
        const cooldown=(await db.query<any>('SELECT api_retry_after FROM stores WHERE id=$1',[c.store.id])).rows[0];if(Number(cooldown?.api_retry_after)>Date.now())throw new InternalStockError('WB ограничил запросы. Повторите передачу позже.',429);
        const batch=job.items.slice(offset,offset+1000);
        await db.transaction(async tx=>{
          await tx.query('SELECT id FROM internal_stock_settings WHERE id=1 FOR UPDATE');
          const quantities=(await tx.query<any>('SELECT id,quantity,version FROM internal_stock_items WHERE location=$1 AND id=ANY($2::text[]) FOR UPDATE',[stockLocation(c.store.id,c.warehouse),job.items.map((i:any)=>i.id)])).rows;
          if(job.items.some((i:any)=>!quantities.some(n=>n.id===i.id&&n.version===i.version&&n.quantity===i.amount)))throw new InternalStockError('Внутренние остатки изменились. Закройте окно и подтвердите новые значения.');
          const transport=wb.marketplace??marketplace,token=unseal(current.credential,key),path='/api/v3/stocks/'+c.warehouse;
          await transport(token,path,'PUT',{stocks:batch.map((i:any)=>({chrtId:Number(i.chrt_id),amount:i.amount}))});
          await new Promise(r=>setTimeout(r,250));
          const verified=stockResponse.parse(await transport(token,path,'POST',{chrtIds:batch.map((i:any)=>Number(i.chrt_id))}));
          if(batch.some((i:any)=>verified.stocks.find(n=>String(n.chrtId)===i.chrt_id)?.amount!==i.amount))throw new InternalStockError('WB ещё не подтвердил все значения. Повторите передачу этим же подтверждением.');
          await tx.query(`UPDATE inventory_items i SET amount=b.amount,version=i.version+1 FROM jsonb_to_recordset($3::jsonb) b(chrt_id text,amount integer) WHERE i.store_id=$1 AND i.warehouse_id=$2 AND i.chrt_id=b.chrt_id`,[c.store.id,c.warehouse,JSON.stringify(batch)]);
          await tx.query('UPDATE internal_stock_publish SET completed=$2 WHERE id=$1',[job.id,offset+batch.length]);
        });
      }
      return {ok:true,count:job.items.length};
    }catch(e){if(e instanceof InternalStockError)throw e;if(e instanceof WbError&&e.status===429)await db.query('UPDATE stores SET api_retry_after=$2 WHERE id=$1',[c.store.id,Date.now()+Math.max(60,e.retrySeconds)*1000]);return reply.code(502).send({error:wbMessage(e)+' Подтверждённые партии сохранены; повтор продолжит передачу.'});}
    finally{locks.delete(c.store.id);}
  });
  app.post("/api/stores/:id/stocks/:chrtId", async (req: any, reply) => {
    const ctx = await context(req, reply, true); if (!ctx) return;
    const parsed = z.object({ version: z.number().int().positive(), cell: z.string().trim().max(80).optional(), address: z.string().trim().max(160).optional(), amount: z.number().int().min(0).max(100000).optional() }).refine(v => v.cell !== undefined || v.address !== undefined || v.amount !== undefined).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({error:"Проверьте значение поля. Количество — целое число от 0 до 100000."});
    const lock = ctx.store.id;
    if (locks.has(lock)) return reply.code(409).send({error:"Остатки обновляются. Дождитесь завершения."});
    locks.add(lock);
    try {
      const item = (await db.query<any>("SELECT * FROM inventory_items WHERE store_id=$1 AND warehouse_id=$2 AND chrt_id=$3",[ctx.store.id,ctx.warehouse,req.params.chrtId])).rows[0];
      if (!item) return reply.code(404).send({error:"Товар не найден."});
      if (item.version !== parsed.data.version) return reply.code(409).send({error:"Остатки уже изменились. Обновите таблицу и повторите."});
      const {amount,cell,address} = parsed.data;
      if (amount !== undefined && amount !== item.amount) {
        const token = unseal(ctx.store.credential,key), chrtId = Number(item.chrt_id), transport = wb.marketplace ?? marketplace;
        await transport(token,`/api/v3/stocks/${ctx.warehouse}`,"PUT",{stocks:[{chrtId,amount}]});
        const checked = stockResponse.parse(await transport(token,`/api/v3/stocks/${ctx.warehouse}`,"POST",{chrtIds:[chrtId]}));
        if (checked.stocks.find(s=>s.chrtId===chrtId)?.amount !== amount) {
          await db.query("UPDATE inventory_sync SET status='queued',run_at=0 WHERE store_id=$1 AND warehouse_id=$2",[ctx.store.id,ctx.warehouse]);
          return reply.code(409).send({error:"WB ещё не подтвердил новый остаток. Обновите таблицу перед повторным изменением."});
        }
      }
      await db.query(`UPDATE inventory_items SET amount=COALESCE($4,amount),cell=COALESCE($5,cell),address=COALESCE($6,address),version=version+1 WHERE store_id=$1 AND warehouse_id=$2 AND chrt_id=$3`,[ctx.store.id,ctx.warehouse,req.params.chrtId,amount??null,cell??null,address??null]);
      return {ok:true};
    } catch (e) { return reply.code(502).send({error: wbMessage(e)}); }
    finally {locks.delete(lock);}
  });
  app.get("/api/stores/:id/stocks-export",async(req:any,reply)=>{
    const ctx=await context(req,reply);if(!ctx)return;
    const f=filters.safeParse(req.query);if(!f.success)return reply.code(400).send({error:"Некорректный фильтр."});
    const rows=(await db.query<any>(`SELECT title,article,size,barcodes,cell,address,amount,(SELECT n.quantity FROM internal_stock_items n WHERE n.location=$5 AND n.source_id='wb:'||inventory_items.chrt_id) AS on_hand FROM inventory_items WHERE store_id=$1 AND warehouse_id=$2 AND ($3='' OR strpos(lower(concat_ws(' ',title,article,size,barcodes::text,cell,address)),lower($3))>0) AND ($4='all' OR amount>0 OR EXISTS(SELECT 1 FROM internal_stock_items n WHERE n.location=$5 AND n.source_id='wb:'||inventory_items.chrt_id AND n.quantity<>0)) ORDER BY title,chrt_id`,[ctx.store.id,ctx.warehouse,f.data.search,f.data.availability,stockLocation(ctx.store.id,ctx.warehouse)])).rows;
    const csv=(v:unknown)=>'"'+String(v??"").replace(/^[=+@\-\t\r]/,"'$&").replaceAll('"','""')+'"';
    return reply.header("Content-Type","text/csv; charset=utf-8").header("Content-Disposition",'attachment; filename="stocks.csv"').send("\ufeff"+[["Товар","Артикул","Размер","Баркоды","Код","Адрес","Остаток на WB","На складе"],...rows.map(r=>[r.title,r.article,r.size,r.barcodes.join(" / "),r.cell,r.address,r.amount,r.on_hand])].map(r=>r.map(csv).join(";")).join("\r\n"));
  });
  async function execute() {
    const job = (await db.query<Job>("SELECT * FROM inventory_sync WHERE status='queued' AND run_at<=$1 ORDER BY run_at LIMIT 1",[Date.now()])).rows[0];
    if (!job || locks.has(job.store_id)) return;
    locks.add(job.store_id);
    try {
      const store=await authorize(job.user_id,job.route_id);
      if(store.id!==job.store_id || (store.scope && store.scope!==job.warehouse_id) || !(await warehouses(store)).some(w=>w.id===job.warehouse_id)) throw new Error("Доступ к складу отозван.");
      await db.query("UPDATE inventory_sync SET status='syncing',error=NULL WHERE store_id=$1 AND warehouse_id=$2",[job.store_id,job.warehouse_id]);
      const token=unseal(store.credential,key), items=new Map<string,{chrtId:number;nmId:number;title:string;article:string;size:string;barcodes:string[]}>();
      let cursor: Record<string,unknown>={limit:100}, previous="";
      for(let page=0;;page++) {
        if(page>=1000)throw new Error("Слишком большой каталог. Загрузка остановлена без изменения остатков.");
        const data=cardPage.parse(await (wb.content??content)(token,"/content/v2/get/cards/list","POST",{settings:{cursor,filter:{withPhoto:-1}}}));
        for(const card of data.cards) for(const size of card.sizes) items.set(String(size.chrtID),{chrtId:size.chrtID,nmId:card.nmID,title:card.title||card.vendorCode,article:card.vendorCode,size:size.techSize,barcodes:[...new Set(size.skus)]});
        if(data.cursor.total<100)break;
        const next=JSON.stringify([data.cursor.updatedAt,data.cursor.nmID]);
        if(!data.cursor.updatedAt || !data.cursor.nmID || next===previous)throw new Error("WB не вернул следующий участок каталога.");
        previous=next;cursor={limit:100,updatedAt:data.cursor.updatedAt,nmID:data.cursor.nmID};
      }
      const values=[...items.values()], quantities=new Map<number,number>();
      for(let i=0;i<values.length;i+=1000) {
        const ids=values.slice(i,i+1000).map(v=>v.chrtId);
        const data=stockResponse.parse(await (wb.marketplace??marketplace)(token,`/api/v3/stocks/${job.warehouse_id}`,"POST",{chrtIds:ids}));
        for(const stock of data.stocks) if(ids.includes(stock.chrtId)) quantities.set(stock.chrtId,stock.amount);
      }
      await authorize(job.user_id,job.route_id);
      // Publish only a complete successful snapshot. A missing WB value is unknown, never an invented zero.
      await db.transaction(async tx=>{
        for(let i=0;i<values.length;i+=1000) {
          const batch=values.slice(i,i+1000).map(item=>({chrt_id:String(item.chrtId),nm_id:String(item.nmId),title:item.title,article:item.article,size:item.size,barcodes:item.barcodes,amount:quantities.get(item.chrtId)??null}));
          await tx.query(`INSERT INTO inventory_items(store_id,warehouse_id,chrt_id,nm_id,title,article,size,barcodes,amount)
            SELECT $1,$2,x.chrt_id,x.nm_id,x.title,x.article,x.size,x.barcodes,x.amount
            FROM jsonb_to_recordset($3::jsonb) AS x(chrt_id text,nm_id text,title text,article text,size text,barcodes jsonb,amount integer)
            ON CONFLICT(store_id,warehouse_id,chrt_id) DO UPDATE SET nm_id=EXCLUDED.nm_id,title=EXCLUDED.title,article=EXCLUDED.article,size=EXCLUDED.size,barcodes=EXCLUDED.barcodes,amount=EXCLUDED.amount,version=inventory_items.version+1`,[job.store_id,job.warehouse_id,JSON.stringify(batch)]);
        }
        await tx.query("DELETE FROM inventory_items WHERE store_id=$1 AND warehouse_id=$2 AND NOT(chrt_id=ANY($3::text[]))",[job.store_id,job.warehouse_id,[...items.keys()]]);
        await tx.query("UPDATE inventory_sync SET status='ready',synced_at=$3,error=NULL,run_at=$4 WHERE store_id=$1 AND warehouse_id=$2",[job.store_id,job.warehouse_id,new Date().toISOString(),Date.now()+10000]);
      });
    }catch(e){await db.query("UPDATE inventory_sync SET status=$3,error=$4,run_at=$5 WHERE store_id=$1 AND warehouse_id=$2",[job.store_id,job.warehouse_id,e instanceof WbError&&e.status===429?"queued":"error",wbMessage(e),Date.now()+ (e instanceof WbError?Math.max(e.retrySeconds,60):60)*1000]);}
    finally{locks.delete(job.store_id);}
  }
  function tick() { if(stopping || running)return running??Promise.resolve(); running=execute().finally(()=>{running=undefined});return running; }
  return {tick,async close(){stopping=true;await running;}};
}
function wbMessage(e:unknown) {
  if(e instanceof WbError) return e.status===401||e.status===403?"WB отклонил доступ. Проверьте API-ключ и права «Контент» и «Маркетплейс».":e.status===429?"Лимит WB: обновление продолжится автоматически.":"WB не подтвердил запрос. Предыдущие остатки сохранены.";
  return e instanceof z.ZodError?"Не удалось прочитать ответ WB. Предыдущие остатки сохранены.":e instanceof Error && !/fetch|token|credential/i.test(e.message)?e.message:"Нет связи с WB. Попробуйте обновить позже.";
}
