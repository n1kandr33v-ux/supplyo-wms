import { beginSupplyMutation, endSupplyMutation } from "./supply-sync.ts";
import { requiresKiz, canPrintWithoutMarking, kizAllowsDelivery, readyForDelivery } from "../src/lib/order-marking.ts";
import type { FastifyInstance } from "fastify";
import type { Database } from "./database.ts";
import { z } from "zod";
import { unseal } from "./security.ts";
import { validateMarking } from "../src/lib/marking.ts";
import { marketplace } from "./wb.ts";
import type { Access } from "./access.ts";
import { createHash, randomUUID } from "node:crypto";
import { placementJoin } from "./placement.ts";
import { createKizChecker } from "./kiz-check.ts";
export async function repairOpenKizStatuses(db: Database) {
  // Repair only open supplies: old versions ignored optionalMeta.sgtin.
  // Keep the label and print receipt; a missing KIZ still needs to be scanned.
  await db.query(`UPDATE fulfillment_items i SET status=CASE WHEN i.kiz IS NULL THEN 'Ожидает' ELSE 'Проверяется' END
    FROM fulfillment_supplies s WHERE s.store_id=i.store_id AND s.id=i.supply_id AND s.closed=false
    AND i.status='Готов' AND (i.snapshot->'requiredMeta' ? 'sgtin' OR i.snapshot->'optionalMeta' ? 'sgtin')
    AND (i.kiz IS NULL OR COALESCE(i.decision,'') NOT IN ('sgtinIntroduced','sgtinSoldB2B','filled'))`);
  await db.query(`UPDATE fulfillment_items i SET status=CASE WHEN i.printed THEN 'Готов' ELSE 'Ожидает' END
    FROM fulfillment_supplies s WHERE s.store_id=i.store_id AND s.id=i.supply_id AND s.closed=false
    AND i.kiz IS NOT NULL AND i.decision='filled'
    AND (i.snapshot->'requiredMeta' ? 'sgtin' OR i.snapshot->'optionalMeta' ? 'sgtin')
    AND i.status IS DISTINCT FROM CASE WHEN i.printed THEN 'Готов' ELSE 'Ожидает' END`);
}
export async function registerFulfillment(
  app: FastifyInstance,
  db: Database,
  key: Buffer,
  userId: (r: { headers: { cookie?: string } }) => Promise<string | null>,
  transport: typeof marketplace = marketplace,
  access?: Access,
) {
  await db.exec(
    `CREATE TABLE IF NOT EXISTS fulfillment_supplies(store_id text REFERENCES stores(id),id text,name text,closed boolean DEFAULT false,created text,PRIMARY KEY(store_id,id)); CREATE TABLE IF NOT EXISTS fulfillment_items(store_id text, id text,supply_id text,snapshot jsonb,printed boolean DEFAULT false,kiz text,decision text,status text DEFAULT 'Ожидает',label text,PRIMARY KEY(store_id,id));`,
  );
  await db.exec("ALTER TABLE fulfillment_supplies ADD COLUMN IF NOT EXISTS warehouse_id text");
  await db.exec("ALTER TABLE fulfillment_supplies ADD COLUMN IF NOT EXISTS destination text; ALTER TABLE fulfillment_supplies ADD COLUMN IF NOT EXISTS boxes integer; ALTER TABLE fulfillment_supplies ADD COLUMN IF NOT EXISTS delivered_at text");
  await db.exec("ALTER TABLE fulfillment_supplies ADD COLUMN IF NOT EXISTS shipping_printed_at text; CREATE TABLE IF NOT EXISTS fulfillment_shipping_labels(store_id text,supply_id text,stickers jsonb NOT NULL,PRIMARY KEY(store_id,supply_id))");
  await db.exec(`CREATE TABLE IF NOT EXISTS fulfillment_print_batches(
    id text PRIMARY KEY,store_id text NOT NULL,supply_id text NOT NULL,barcode text NOT NULL,
    jobs jsonb NOT NULL,completed boolean NOT NULL DEFAULT false);
    CREATE UNIQUE INDEX IF NOT EXISTS fulfillment_print_batch_pending
    ON fulfillment_print_batches(store_id,supply_id,barcode) WHERE completed=false`);
  await db.exec("ALTER TABLE fulfillment_supplies ADD COLUMN IF NOT EXISTS wb_removed boolean NOT NULL DEFAULT false; ALTER TABLE fulfillment_print_batches ADD COLUMN IF NOT EXISTS cancelled boolean NOT NULL DEFAULT false");
  await db.exec(`CREATE TABLE IF NOT EXISTS fulfillment_item_history(
    id bigserial PRIMARY KEY,store_id text NOT NULL,order_id text NOT NULL,old_supply_id text,new_supply_id text,
    previous jsonb NOT NULL,changed_at timestamptz NOT NULL DEFAULT now())`);
  await db.exec(`CREATE TABLE IF NOT EXISTS fulfillment_transfers(
    id text PRIMARY KEY,store_id text NOT NULL,source_id text NOT NULL,target_id text,request_hash text NOT NULL,
    state text NOT NULL,saved jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now())`);
  await repairOpenKizStatuses(db);
  await db.exec("ALTER TABLE fulfillment_items ADD COLUMN IF NOT EXISTS kiz_revision integer NOT NULL DEFAULT 0");
  await db.exec("ALTER TABLE fulfillment_items ADD COLUMN IF NOT EXISTS sticker_text text");
  await db.exec(`CREATE TABLE IF NOT EXISTS mobile_pick_notes(
    id text PRIMARY KEY,store_id text NOT NULL,supply_id text NOT NULL,item_id text NOT NULL,
    user_id text NOT NULL,author_name text NOT NULL,text text NOT NULL,created_at bigint NOT NULL);
    CREATE INDEX IF NOT EXISTS mobile_pick_notes_supply ON mobile_pick_notes(store_id,supply_id,created_at)`);
  await db.exec("ALTER TABLE mobile_pick_notes ADD COLUMN IF NOT EXISTS deleted_at bigint");
  const mutations = new Set<string>();
  const held = new WeakMap<object, string>();
  app.addHook("preHandler", async (req, reply) => {
    if (
      req.method !== "POST" ||
      !/^\/api\/stores\/[^/]+\/(supplies|items)\//.test(req.url)
    )
      return;
    if (/\/supplies\/[^/]+\/(check|sticker-numbers|mobile-notes)(?:\?|$)/.test(req.url)) return;
    const routeId = (req.params as { id: string }).id;
    const resolved = await access?.resolve(await userId(req), routeId);
    if(access&&!resolved)return;
    const id = resolved?.id ?? routeId;
    if (mutations.has(id))
      return reply
        .code(409)
        .send({
          error:
            "Другое действие с магазином ещё выполняется. Дождитесь результата.",
        });
    mutations.add(id);
    held.set(req, id);
    beginSupplyMutation(id);
  });
  app.addHook("onResponse", async (req) => {
    const id = held.get(req);
    if (id) {
      endSupplyMutation(id);
      mutations.delete(id);
      held.delete(req);
    }
  });
  async function store(req: any, reply: any) {
    const uid = await userId(req);
    const employee = access && String(req.params.id).startsWith("staff.") ? await access.resolve(uid,req.params.id) : undefined;
    const sub = await db.query(
      "SELECT 1 FROM subscriptions WHERE user_id=$1 AND expires>$2",
      [uid, Date.now()],
    );
    if (!sub.rows.length && !employee) {
      reply.code(403).send({ error: "Для работы подключите подписку" });
      return null;
    }
    const row = employee ?? (access ? await access.resolve(uid, req.params.id) : (
      await db.query<any>("SELECT * FROM stores WHERE id=$1 AND user_id=$2", [
        req.params.id,
        uid,
      ])
    ).rows[0]);
    if (!row) {
      reply.code(404).send({ error: "Магазин не найден" });
      return null;
    }
    if(row.marketplace==='ozon'){reply.code(501).send({error:'Сборка и печать Ozon будут подключены следующим этапом. Сейчас доступен список FBS-отправлений.'});return null;}
    const permission=req.method==="GET"||req.url.endsWith("/sticker-numbers")?"view":/\/supplies\/[^/]+\/(check|mobile-notes|scan-auto|print-batches\/[^/]+\/printed)$/.test(req.url)||/\/items\//.test(req.url)?"assembly":"supplies";
    if(row.permissions&&!row.permissions.includes(permission)){reply.code(403).send({error:"Владелец склада не выдал право на это действие."});return null}
    return row;
  }
  async function supplyAllowed(s: any, id: string, reply: any) {
    const row=(await db.query<any>("SELECT warehouse_id FROM fulfillment_supplies WHERE store_id=$1 AND id=$2 AND wb_removed=false",[s.id,id])).rows[0];
    if (!row) { reply.code(404).send({error:"Поставка не найдена"}); return false; }
    if (!s.scope || row.warehouse_id===s.scope) return true;
    // Legacy supplies are accessible only if every saved order belongs to this warehouse.
    const check=(await db.query<any>("SELECT count(*)::int total,count(*) FILTER (WHERE snapshot->>'warehouseId'=$3)::int allowed FROM fulfillment_items WHERE store_id=$1 AND supply_id=$2",[s.id,id,s.scope])).rows[0];
    if (!row.warehouse_id && check.total>0 && check.total===check.allowed) return true;
    reply.code(404).send({error:"Поставка не найдена"}); return false;
  }
  const call = (s: any, path: string, method = "GET", body?: unknown) =>
    transport(unseal(s.credential, key), path, method, body);
  const checkKiz = createKizChecker(db, (s, orders) => call(s, "/api/marketplace/v3/orders/meta", "POST", {orders}));
  async function reservedForBatch(storeId: string, orderId: string) {
    return (await db.query(`SELECT 1 FROM fulfillment_print_batches b,
      jsonb_array_elements(b.jobs) j WHERE b.store_id=$1 AND b.completed=false AND j->>'orderId'=$2`,
      [storeId, orderId])).rows.length > 0;
  }
  app.get("/api/stores/:id/fulfillment", async (req, reply) => {
    const s = await store(req, reply);
    if (!s) return;
    return {
      supplies: (
        await db.query(
          `SELECT s.* FROM fulfillment_supplies s WHERE store_id=$1 AND wb_removed=false AND ($2='' OR warehouse_id=$2 OR (warehouse_id IS NULL
            AND EXISTS(SELECT 1 FROM fulfillment_items i WHERE i.store_id=s.store_id AND i.supply_id=s.id)
            AND NOT EXISTS(SELECT 1 FROM fulfillment_items i WHERE i.store_id=s.store_id AND i.supply_id=s.id AND (i.snapshot->>'warehouseId') IS DISTINCT FROM $2))) ORDER BY created DESC`,
          [s.id,s.scope ?? ""],
        )
      ).rows,
      items: (
        await db.query(
          `SELECT f.id,f.supply_id,f.snapshot,f.printed,f.decision,f.status,f.sticker_text,placement.cell,placement.address
           FROM fulfillment_items f ${placementJoin('f.store_id', "f.snapshot->>'warehouseId'", "f.snapshot->'skus'")}
           WHERE f.store_id=$1 AND f.supply_id IS NOT NULL AND ($2='' OR f.snapshot->>'warehouseId'=$2)`,
          [s.id,s.scope ?? ""],
        )
      ).rows,
    };
  });
  app.get('/api/stores/:id/supplies/:supply/mobile-notes',async(req,reply)=>{
    const s=await store(req,reply);if(!s)return;
    const supply=(req.params as any).supply;if(!await supplyAllowed(s,supply,reply))return;
    const notes=(await db.query(`SELECT n.id,n.item_id,n.author_name,n.text,n.created_at,((n.user_id=$4 OR $4=$5) AND $6::boolean) AS can_delete FROM mobile_pick_notes n
      JOIN fulfillment_items i ON i.store_id=n.store_id AND i.supply_id=n.supply_id AND i.id=n.item_id
      WHERE n.store_id=$1 AND n.supply_id=$2 AND n.deleted_at IS NULL AND ($3='' OR i.snapshot->>'warehouseId'=$3)
      ORDER BY n.created_at,n.id`,[s.id,supply,s.scope??'',await userId(req),s.user_id,!s.permissions||s.permissions.includes('assembly')])).rows;
    return {notes};
  });
  app.post('/api/stores/:id/supplies/:supply/mobile-notes',async(req,reply)=>{
    const s=await store(req,reply);if(!s)return;
    const supply=(req.params as any).supply;if(!await supplyAllowed(s,supply,reply))return;
    if((req.body as any)?.action==='delete'){
      const input=z.object({action:z.literal('delete'),id:z.string().uuid(),confirm:z.literal(true)}).parse(req.body);
      const uid=await userId(req);
      const note=(await db.query<{user_id:string}>(`SELECT n.user_id FROM mobile_pick_notes n
        JOIN fulfillment_items i ON i.store_id=n.store_id AND i.supply_id=n.supply_id AND i.id=n.item_id
        WHERE n.store_id=$1 AND n.supply_id=$2 AND n.id=$3 AND ($4='' OR i.snapshot->>'warehouseId'=$4)`,[s.id,supply,input.id,s.scope??''])).rows[0];
      if(!note)return reply.code(404).send({error:'Заметка не найдена.'});
      if(note.user_id!==uid&&s.user_id!==uid)return reply.code(403).send({error:'Можно удалить только свою заметку.'});
      await db.query('UPDATE mobile_pick_notes SET deleted_at=COALESCE(deleted_at,$4) WHERE store_id=$1 AND supply_id=$2 AND id=$3',[s.id,supply,input.id,Date.now()]);
      return {ok:true};
    }
    const input=z.object({id:z.string().uuid(),itemId:z.string().regex(/^\d+$/),text:z.string().trim().min(1).max(1500)}).parse(req.body);
    const item=(await db.query(`SELECT i.id FROM fulfillment_items i JOIN fulfillment_supplies p ON p.store_id=i.store_id AND p.id=i.supply_id
      WHERE i.store_id=$1 AND i.supply_id=$2 AND i.id=$3 AND p.closed=false AND ($4='' OR i.snapshot->>'warehouseId'=$4)`,[s.id,supply,input.itemId,s.scope??''])).rows[0];
    if(!item)return reply.code(404).send({error:'Товар не найден в открытой поставке.'});
    const uid=await userId(req);const author=(await db.query<{name:string}>('SELECT name FROM users WHERE id=$1',[uid])).rows[0];
    await db.query(`INSERT INTO mobile_pick_notes(id,store_id,supply_id,item_id,user_id,author_name,text,created_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(id) DO NOTHING`,[input.id,s.id,supply,input.itemId,uid,author?.name||'Сотрудник',input.text,Date.now()]);
    const note=(await db.query(`SELECT id,item_id,author_name,text,created_at,true AS can_delete FROM mobile_pick_notes
      WHERE id=$1 AND store_id=$2 AND supply_id=$3 AND user_id=$4 AND item_id=$5 AND text=$6 AND deleted_at IS NULL`,[input.id,s.id,supply,uid,input.itemId,input.text])).rows[0];
    if(!note)return reply.code(409).send({error:'Это сообщение уже изменилось. Повторите отправку.'});
    return {note};
  });
  function stickerText(sticker: any): string | null {
    const parts = [sticker?.partA, sticker?.partB].filter(p => typeof p === 'string' && p.length);
    return parts.length === 2 ? parts.join(' ') : typeof sticker?.barcode === 'string' && sticker.barcode.length ? sticker.barcode : null;
  }
  const stickerLoads = new Map<string, Promise<void>>();
  app.post('/api/stores/:id/supplies/:supply/sticker-numbers', async (req, reply) => {
    const s = await store(req, reply); if (!s) return;
    const id = (req.params as any).supply;
    if (!await supplyAllowed(s,id,reply)) return;
    const cacheKey = s.id + ':' + id;
    let running = stickerLoads.get(cacheKey);
    if (!running) {
      running = (async () => {
        const missing = (await db.query<{id:string}>("SELECT id FROM fulfillment_items WHERE store_id=$1 AND supply_id=$2 AND sticker_text IS NULL ORDER BY id",[s.id,id])).rows;
        for (let offset=0; offset<missing.length; offset+=100) {
          const batch=missing.slice(offset,offset+100), requested=new Set(batch.map(i=>i.id));
          const data:any=await call(s,'/api/v3/orders/stickers?type=png&width=58&height=40','POST',{orders:batch.map(i=>Number(i.id))});
          for (const sticker of data.stickers ?? []) {
            if (!requested.has(String(sticker.orderId))) continue;
            const text=stickerText(sticker); if (!text) continue;
            await db.query("UPDATE fulfillment_items SET sticker_text=$3 WHERE store_id=$1 AND id=$2",[s.id,String(sticker.orderId),text]);
          }
        }
      })().finally(()=>stickerLoads.delete(cacheKey));
      stickerLoads.set(cacheKey,running);
    }
    await running;
    return {ok:true};
  });
  app.post("/api/stores/:id/supplies/create", async (req, reply) => {
    const s = await store(req, reply);
    if (!s) return;
    const input = z
      .object({
        orders: z.array(z.string().regex(/^\d+$/)).min(1).max(100),
        name: z.string().trim().min(1).max(100),
      })
      .parse(req.body);
    const existing = await db.query(
      "SELECT id FROM fulfillment_items WHERE store_id=$1 AND id=ANY($2::text[]) AND supply_id IS NOT NULL",
      [s.id, input.orders],
    );
    if (existing.rows.length)
      return reply
        .code(409)
        .send({ error: "Заказ уже добавлен в поставку. Обновите список." });
    const fresh: any = await call(s, "/api/v3/orders/new");
    const orders = fresh.orders.filter((o: any) =>
      input.orders.includes(String(o.id)),
    );
    if (orders.length !== input.orders.length)
      return reply
        .code(409)
        .send({ error: "Список заказов изменился. Обновите страницу." });
    if (s.scope && orders.some((o:any)=>String(o.warehouseId)!==s.scope))
      return reply.code(403).send({error:"Доступ выдан только к выбранному складу."});
    if (new Set(orders.map((o: any) => o.warehouseId)).size !== 1)
      return reply
        .code(400)
        .send({ error: "В поставке могут быть заказы только одного склада." });
    if (
      new Set(
        orders.map((o: any) =>
          JSON.stringify([o.cargoType, o.crossBorderType, o.options?.isB2B]),
        ),
      ).size !== 1
    )
      return reply
        .code(400)
        .send({
          error:
            "Заказы имеют несовместимые типы доставки. Создайте отдельные поставки.",
        });
    const supply: any = await call(s, "/api/v3/supplies", "POST", {
      name: input.name,
    });
    // Persist the WB identifier before attaching: an interrupted request must not lose the supply.
    await db.query(
      "INSERT INTO fulfillment_supplies(store_id,id,name,created,warehouse_id) VALUES($1,$2,$3,$4,$5)",
      [s.id, supply.id, input.name, new Date().toISOString(),String(orders[0].warehouseId)],
    );
    await call(
      s,
      `/api/marketplace/v3/supplies/${encodeURIComponent(supply.id)}/orders`,
      "PATCH",
      { orders: orders.map((o: any) => o.id) },
    );
    await db.transaction(async (tx) => {
      for (const o of orders) {
        await tx.query(
          "INSERT INTO fulfillment_items(store_id,id,supply_id,snapshot) VALUES($1,$2,$3,$4) ON CONFLICT(store_id,id) DO UPDATE SET supply_id=$3,snapshot=$4,printed=false,kiz=NULL,decision=NULL,status='Ожидает',label=NULL,sticker_text=NULL,kiz_revision=fulfillment_items.kiz_revision+1",
          [s.id, String(o.id), supply.id, JSON.stringify(o)],
        );
        await tx.query("DELETE FROM orders WHERE store_id=$1 AND id=$2", [
          s.id,
          String(o.id),
        ]);
      }
    });
    return { id: supply.id };
  });
  app.post("/api/stores/:id/supplies/:supply/add",async(req,reply)=>{
    const s=await store(req,reply);if(!s)return;
    const id=(req.params as {supply:string}).supply;
    if(!await supplyAllowed(s,id,reply))return;
    const supply=(await db.query<any>("SELECT * FROM fulfillment_supplies WHERE store_id=$1 AND id=$2",[s.id,id])).rows[0];
    if(supply.closed)return reply.code(409).send({error:"Поставка уже передана в доставку."});
    const {orders:ids}=z.object({orders:z.array(z.string().regex(/^\d+$/)).min(1).max(100).refine(ids=>new Set(ids).size===ids.length)}).parse(req.body);
    if((await db.query("SELECT 1 FROM fulfillment_items WHERE store_id=$1 AND id=ANY($2::text[]) AND supply_id IS NOT NULL",[s.id,ids])).rows.length)return reply.code(409).send({error:"Заказ уже добавлен в поставку. Обновите список."});
    const fresh:any=await call(s,"/api/v3/orders/new"),orders=fresh.orders.filter((o:any)=>ids.includes(String(o.id)));
    if(orders.length!==ids.length)return reply.code(409).send({error:"Список заказов изменился. Обновите страницу."});
    const old=(await db.query<{snapshot:any}>("SELECT snapshot FROM fulfillment_items WHERE store_id=$1 AND supply_id=$2",[s.id,id])).rows.map(o=>o.snapshot);
    const warehouse=supply.warehouse_id||String(old[0]?.warehouseId||"");
    if(s.scope&&orders.some((o:any)=>String(o.warehouseId)!==s.scope))return reply.code(403).send({error:"Доступ выдан только к выбранному складу."});
    if(!warehouse||orders.some((o:any)=>String(o.warehouseId)!==warehouse))return reply.code(400).send({error:"Выберите поставку того же склада."});
    if(new Set([...old,...orders].map((o:any)=>JSON.stringify([o.cargoType,o.crossBorderType,o.options?.isB2B]))).size!==1)return reply.code(400).send({error:"Заказы имеют несовместимые типы доставки. Создайте отдельную поставку."});
    await call(s,`/api/marketplace/v3/supplies/${encodeURIComponent(id)}/orders`,"PATCH",{orders:orders.map((o:any)=>o.id)});
    await db.transaction(async tx=>{
      for(const o of orders){
        await tx.query("INSERT INTO fulfillment_items(store_id,id,supply_id,snapshot) VALUES($1,$2,$3,$4) ON CONFLICT(store_id,id) DO UPDATE SET supply_id=$3,snapshot=$4,printed=false,kiz=NULL,decision=NULL,status='Ожидает',label=NULL,sticker_text=NULL,kiz_revision=fulfillment_items.kiz_revision+1",[s.id,String(o.id),id,JSON.stringify(o)]);
        await tx.query("DELETE FROM orders WHERE store_id=$1 AND id=$2",[s.id,String(o.id)]);
      }
    });
    return {id};
  });
  app.post("/api/stores/:id/supplies/:supply/move",async(req,reply)=>{
    const s=await store(req,reply);if(!s)return;
    const source=(req.params as any).supply;
    const input=z.object({operationId:z.string().uuid(),orders:z.array(z.string().regex(/^\d+$/)).min(1).max(100).refine(ids=>new Set(ids).size===ids.length),targetSupply:z.string().min(1).optional(),newName:z.string().trim().min(1).max(128).optional()})
      .refine(v=>!!v.targetSupply!==!!v.newName).parse(req.body);
    const ids=[...input.orders].sort(),fingerprint=createHash('sha256').update(JSON.stringify({source,ids,target:input.targetSupply||null,name:input.newName||null})).digest('hex');
    const operation=(await db.query<any>("SELECT * FROM fulfillment_transfers WHERE id=$1",[input.operationId])).rows[0];
    if(operation&&(operation.store_id!==s.id||operation.request_hash!==fingerprint))return reply.code(409).send({error:"Этот запрос переноса уже использован. Откройте окно заново."});
    if(!await supplyAllowed(s,source,reply))return;
    if(operation?.state==='done')return {id:operation.target_id,moved:ids.length};
    if(operation&& !operation.target_id)return reply.code(409).send({error:"Создание поставки не подтверждено. Обновите данные и проверьте поставки WB перед новой попыткой."});
    const from=(await db.query<any>("SELECT * FROM fulfillment_supplies WHERE store_id=$1 AND id=$2",[s.id,source])).rows[0];
    if(from.closed)return reply.code(409).send({error:"Перенос доступен только из открытой поставки."});
    const rows=(await db.query<any>("SELECT * FROM fulfillment_items WHERE store_id=$1 AND id=ANY($2::text[])",[s.id,ids])).rows;
    let targetId:string|undefined=operation?.target_id||input.targetSupply;
    if(targetId===source)return reply.code(400).send({error:"Выберите другую поставку."});
    if(rows.length!==ids.length||rows.some(i=>i.supply_id!==source&&(!operation||i.supply_id!==targetId)))return reply.code(409).send({error:"Состав поставки изменился. Обновите список и выберите заказы заново."});
    const warehouse=String(rows[0].snapshot.warehouseId||'');
    if(!warehouse||rows.some(i=>String(i.snapshot.warehouseId)!==warehouse)||(s.scope&&s.scope!==warehouse))return reply.code(403).send({error:"Заказы должны принадлежать одному доступному складу."});
    for(const row of rows)if(await reservedForBatch(s.id,row.id))return reply.code(409).send({error:"Сначала завершите подготовленную пакетную печать выбранных заказов."});
    if(targetId){
      if(!await supplyAllowed(s,targetId,reply))return;
      const to=(await db.query<any>("SELECT * FROM fulfillment_supplies WHERE store_id=$1 AND id=$2",[s.id,targetId])).rows[0];
      const old=(await db.query<any>("SELECT snapshot FROM fulfillment_items WHERE store_id=$1 AND supply_id=$2",[s.id,targetId])).rows;
      const targetWarehouse=to.warehouse_id||String(old[0]?.snapshot.warehouseId||(!old.length?warehouse:''));
      if(to.closed)return reply.code(409).send({error:"Нельзя перенести заказы в отгруженную поставку."});
      if(targetWarehouse!==warehouse)return reply.code(400).send({error:"Выберите поставку того же склада."});
      if(new Set([...old.map(i=>i.snapshot),...rows.map(i=>i.snapshot)].map(o=>JSON.stringify([o.cargoType,o.crossBorderType,o.options?.isB2B]))).size!==1)return reply.code(400).send({error:"Заказы имеют несовместимые типы доставки."});
    }else if(new Set(rows.map(i=>JSON.stringify([i.snapshot.cargoType,i.snapshot.crossBorderType,i.snapshot.options?.isB2B]))).size!==1)return reply.code(400).send({error:"Заказы имеют несовместимые типы доставки."});
    const wbSource=z.object({done:z.boolean()}).parse(await call(s,`/api/v3/supplies/${encodeURIComponent(source)}`));
    if(wbSource.done)return reply.code(409).send({error:"Исходная поставка уже отгружена в WB. Обновите данные."});
    if(!operation)await db.query("INSERT INTO fulfillment_transfers(id,store_id,source_id,target_id,request_hash,state,saved) VALUES($1,$2,$3,$4,$5,$6,$7)",[input.operationId,s.id,source,targetId||null,fingerprint,targetId?'prepared':'creating',JSON.stringify(rows)]);
    if(!targetId){
      const created=z.object({id:z.string().min(1)}).parse(await call(s,"/api/v3/supplies","POST",{name:input.newName}));targetId=created.id;
      await db.transaction(async tx=>{
        await tx.query("INSERT INTO fulfillment_supplies(store_id,id,name,created,warehouse_id) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING",[s.id,targetId,input.newName,new Date().toISOString(),warehouse]);
        await tx.query("UPDATE fulfillment_transfers SET target_id=$2,state='prepared' WHERE id=$1",[input.operationId,targetId]);
      });
    }
    const wbTarget=z.object({done:z.boolean()}).parse(await call(s,`/api/v3/supplies/${encodeURIComponent(targetId)}`));
    if(wbTarget.done)return reply.code(409).send({error:"Поставка назначения уже отгружена в WB. Выберите другую."});
    // Reconcile an interrupted PATCH before retrying; never create a second target.
    const attached=z.object({orderIds:z.array(z.number().int().nonnegative())}).parse(await call(s,`/api/marketplace/v3/supplies/${encodeURIComponent(targetId)}/order-ids`));
    const present=new Set(attached.orderIds.map(String)),missing=ids.filter(id=>!present.has(id));
    if(missing.length)await call(s,`/api/marketplace/v3/supplies/${encodeURIComponent(targetId)}/orders`,"PATCH",{orders:missing.map(Number)});
    await db.transaction(async tx=>{
      await tx.query(`INSERT INTO fulfillment_item_history(store_id,order_id,old_supply_id,new_supply_id,previous)
        SELECT store_id,id,supply_id,$4,to_jsonb(i) FROM fulfillment_items i WHERE store_id=$1 AND supply_id=$2 AND id=ANY($3::text[])`,[s.id,source,ids,targetId]);
      const moved=await tx.query(`UPDATE fulfillment_items SET supply_id=$4 WHERE store_id=$1 AND (supply_id=$2 OR supply_id=$4) AND id=ANY($3::text[]) RETURNING id`,[s.id,source,ids,targetId]);
      if(moved.rows.length!==ids.length)throw Error("Состав поставки изменился. Повторите этот же перенос после обновления.");
      await tx.query("UPDATE mobile_pick_notes SET supply_id=$4 WHERE store_id=$1 AND supply_id=$2 AND item_id=ANY($3::text[])",[s.id,source,ids,targetId]);
      await tx.query("UPDATE fulfillment_supplies SET warehouse_id=COALESCE(warehouse_id,$3) WHERE store_id=$1 AND id=$2",[s.id,targetId,warehouse]);
      await tx.query("UPDATE fulfillment_transfers SET state='done' WHERE id=$1",[input.operationId]);
    });
    return {id:targetId,moved:ids.length};
  });
  app.post("/api/stores/:id/supplies/:supply/scan-auto", async (req, reply) => {
    const s = await store(req, reply);
    if (!s) return;
    const id = (req.params as { supply: string }).supply;
    if (!await supplyAllowed(s, id, reply)) return;
    const supply = (await db.query<any>("SELECT closed FROM fulfillment_supplies WHERE store_id=$1 AND id=$2", [s.id, id])).rows[0];
    if (supply.closed) return reply.code(409).send({ error: "Поставка уже передана в доставку." });
    const { barcode } = z.object({ barcode: z.string().trim().min(1).max(200) }).parse(req.body);
    // Persist the exact manifest before printing. A lost agent response or DB acknowledgement
    // must retry the same job, even if more orders have since been added to the supply.
    const pending = (await db.query<any>(
      "SELECT id,jobs FROM fulfillment_print_batches WHERE store_id=$1 AND supply_id=$2 AND barcode=$3 AND completed=false",
      [s.id, id, barcode],
    )).rows[0];
    if (pending) {
      const savedItems = (await db.query<any>("SELECT id,snapshot FROM fulfillment_items WHERE store_id=$1 AND supply_id=$2 AND id=ANY($3::text[])",
        [s.id, id, pending.jobs.map((j: {orderId:string}) => j.orderId)])).rows;
      if (savedItems.length !== pending.jobs.length || savedItems.some(i => !canPrintWithoutMarking(i.snapshot))) {
        await db.query("DELETE FROM fulfillment_print_batches WHERE id=$1 AND completed=false", [pending.id]);
        return reply.code(409).send({error:"Требования маркировки изменились. Обновите поставку: заказы с КИЗ собираются по одному."});
      }
      return { printJob: pending.id, jobs: pending.jobs };
    }
    const items = (await db.query<any>(
      "SELECT * FROM fulfillment_items WHERE store_id=$1 AND supply_id=$2 AND printed=false AND status='Ожидает' ORDER BY id",
      [s.id, id],
    )).rows.filter(i => i.snapshot.skus?.includes(barcode)
      && canPrintWithoutMarking(i.snapshot));
    if (!items.length) return reply.code(409).send({ error: "Нет ожидающих заказов без КИЗ с таким баркодом в этой поставке." });
    if (items.length > 1000) return reply.code(409).send({ error: "За один пакет можно напечатать до 1000 стикеров. Разделите заказы на поставки." });
    // Alternative barcodes must not create overlapping batches for the same orders.
    const reserved = await db.query(`SELECT 1 FROM fulfillment_print_batches b,
      jsonb_array_elements(b.jobs) j WHERE b.store_id=$1 AND b.completed=false AND j->>'orderId'=ANY($2::text[]) LIMIT 1`,
      [s.id, items.map(i => i.id)]);
    if (reserved.rows.length) return reply.code(409).send({ error: "Для этого товара уже подготовлен пакет печати. Повторите скан исходного баркода, чтобы завершить его." });
    // WB allows up to 100 labels per request. Cache by order ID, never by response order.
    const missing = items.filter(i => !i.label);
    for (let offset = 0; offset < missing.length; offset += 100) {
      const batch = missing.slice(offset, offset + 100);
      const data: any = await call(s, "/api/v3/orders/stickers?type=png&width=58&height=40", "POST", {
        orders: batch.map(i => Number(i.id)),
      });
      const labels = new Map<string, string>();
      for (const sticker of data.stickers ?? []) {
        if (typeof sticker.file === "string" && sticker.file.length) labels.set(String(sticker.orderId), sticker.file);
        if (batch.some(i=>i.id===String(sticker.orderId)) && stickerText(sticker))
          await db.query("UPDATE fulfillment_items SET sticker_text=$3 WHERE store_id=$1 AND id=$2",[s.id,String(sticker.orderId),stickerText(sticker)]);
      }
      if (batch.some(i => !labels.has(i.id))) return reply.code(502).send({ error: "WB вернул не все стикеры. Повторите сканирование." });
      await db.transaction(async tx => {
        for (const item of batch) {
          item.label = labels.get(item.id)!;
          await tx.query("UPDATE fulfillment_items SET label=$3 WHERE store_id=$1 AND id=$2", [s.id, item.id, item.label]);
        }
      });
    }
    const jobs = items.map(i => ({ orderId: i.id, label: i.label }));
    if (Buffer.byteLength(JSON.stringify(jobs)) > 60 * 1024 * 1024) return reply.code(409).send({ error: "Пакет стикеров превышает допустимый размер агента. Разделите заказы на поставки." });
    const printJob = "supplyo-auto-" + randomUUID();
    await db.query("INSERT INTO fulfillment_print_batches(id,store_id,supply_id,barcode,jobs) VALUES($1,$2,$3,$4,$5)",
      [printJob, s.id, id, barcode, JSON.stringify(jobs)]);
    return { printJob, jobs };
  });
  app.post("/api/stores/:id/supplies/:supply/print-batches/:batch/printed", async (req, reply) => {
    const s = await store(req, reply);
    if (!s) return;
    const { supply, batch } = req.params as { supply: string; batch: string };
    if (!await supplyAllowed(s, supply, reply)) return;
    const saved = (await db.query<any>("SELECT jobs,completed,cancelled FROM fulfillment_print_batches WHERE id=$1 AND store_id=$2 AND supply_id=$3", [batch, s.id, supply])).rows[0];
    if (!saved) return reply.code(404).send({ error: "Пакет печати не найден" });
    if (saved.cancelled) return reply.code(409).send({error:"Состав поставки изменился в WB. Обновите список перед печатью."});
    if (saved.completed) return { ok: true, count: saved.jobs.length };
    const ids = saved.jobs.map((job: { orderId: string }) => job.orderId);
    await db.transaction(async tx => {
      const updated = await tx.query(`UPDATE fulfillment_items SET printed=true,status='Готов'
        WHERE store_id=$1 AND supply_id=$2 AND id=ANY($3::text[]) AND label IS NOT NULL
        AND jsonb_typeof(snapshot->'requiredMeta')='array' AND snapshot->'requiredMeta'='[]'::jsonb
        AND NOT COALESCE(snapshot->'optionalMeta' ? 'sgtin',false)
        RETURNING id`, [s.id, supply, ids]);
      if (updated.rows.length !== ids.length) throw Error("Состав пакета изменился. Обновите поставку перед продолжением.");
      await tx.query("UPDATE fulfillment_print_batches SET completed=true WHERE id=$1", [batch]);
    });
    return { ok: true, count: ids.length };
  });
  app.post("/api/stores/:id/items/:order/scan", async (req, reply) => {
    const s = await store(req, reply);
    if (!s) return;
    const item = (
      await db.query<any>(
        "SELECT * FROM fulfillment_items WHERE store_id=$1 AND id=$2 AND supply_id IS NOT NULL",
        [s.id, (req.params as any).order],
      )
    ).rows[0];
    if (!item || (s.scope && String(item.snapshot.warehouseId)!==s.scope)) return reply.code(404).send({ error: "Заказ не найден" });
    if (await reservedForBatch(s.id, item.id)) return reply.code(409).send({ error: "Стикер входит в подготовленный пакет «Авто». Завершите печать повторным сканированием исходного баркода." });
    const { kiz } = z
      .object({ kiz: z.string().max(300).optional() })
      .parse(req.body);
    if (requiresKiz(item.snapshot)) {
      const marking = validateMarking(kiz || "");
      if (!marking.valid)
        return reply.code(400).send({ error: "Отсканируйте КИЗ товара" });
      await call(s, `/api/v3/orders/${item.id}/meta/sgtin`, "PUT", {
        sgtins: [marking.code],
      });
      await db.query(
        "UPDATE fulfillment_items SET kiz=$3,kiz_revision=kiz_revision+1,decision=NULL,status='Проверяется' WHERE store_id=$1 AND id=$2",
        [s.id, item.id, marking.code],
      );
    } else if (!Array.isArray(item.snapshot.requiredMeta)) {
      return reply.code(409).send({ error: "Требования к маркировке ещё не получены. Обновите данные заказа." });
    } else if (item.snapshot.requiredMeta.length)
      return reply
        .code(409)
        .send({
          error:
            "Для заказа требуются дополнительные идентификаторы WB. Этот вид маркировки пока не поддержан.",
        });
    let label = item.label;
    if (!label) {
      const data: any = await call(
        s,
        "/api/v3/orders/stickers?type=png&width=58&height=40",
        "POST",
        { orders: [Number(item.id)] },
      );
      const sticker = data.stickers?.find((sticker:any)=>String(sticker.orderId)===String(item.id));
      label = sticker?.file;
      if (!label) return reply.code(502).send({ error: "WB не вернул стикер" });
      await db.query(
        "UPDATE fulfillment_items SET label=$3,sticker_text=COALESCE($4,sticker_text) WHERE store_id=$1 AND id=$2",
        [s.id, item.id, label, stickerText(sticker)],
      );
    }
    return {
      label,
      orderId: item.id,
      printJob: "supplyo-single-" + randomUUID(),
    };
  });
  app.post("/api/stores/:id/items/:order/printed", async (req, reply) => {
    const s = await store(req, reply);
    if (!s) return;
    const saved = (
      await db.query<any>(
        "SELECT label,snapshot,kiz,decision,status FROM fulfillment_items WHERE store_id=$1 AND id=$2 AND supply_id IS NOT NULL",
        [s.id, (req.params as any).order],
      )
    ).rows[0];
    if (!saved || (s.scope && String(saved.snapshot.warehouseId)!==s.scope)) return reply.code(404).send({error:"Заказ не найден"});
    if (await reservedForBatch(s.id, (req.params as any).order)) return reply.code(409).send({error:"Подтвердите печать всего пакета «Авто»."});
    if (!saved?.label)
      return reply.code(409).send({ error: "Сначала получите стикер" });
    if (!requiresKiz(saved.snapshot) && !canPrintWithoutMarking(saved.snapshot))
      return reply.code(409).send({ error: "Требования к маркировке не подтверждены. Обновите данные заказа." });
    const status = requiresKiz(saved.snapshot)
      ? !saved.kiz ? "Ожидает" : kizAllowsDelivery(saved.decision) ? "Готов" : saved.status === "Ошибка КИЗ" ? "Ошибка КИЗ" : "Проверяется"
      : "Готов";
    await db.query("UPDATE fulfillment_items SET printed=true,status=$3 WHERE store_id=$1 AND id=$2",
      [s.id, (req.params as any).order, status]);
    return { ok: true };
  });
  app.post("/api/stores/:id/supplies/:supply/check", async (req, reply) => {
    const s = await store(req, reply);
    if (!s) return;
    if (!await supplyAllowed(s,(req.params as any).supply,reply)) return;
    await checkKiz(s);
    return { ok: true };
  });
  // Printing is separate from delivery: retrying a label must never hand over a supply twice.
  app.post("/api/stores/:id/supplies/:supply/labels", async (req, reply) => {
    const s = await store(req, reply);
    if (!s) return;
    const id = (req.params as any).supply;
    if (!await supplyAllowed(s, id, reply)) return;
    const saved = (await db.query<any>("SELECT closed,destination,boxes FROM fulfillment_supplies WHERE store_id=$1 AND id=$2", [s.id,id])).rows[0];
    if (!saved.closed) return reply.code(409).send({error:"Стикер доступен после передачи поставки в доставку"});
    let stickers = (await db.query<any>("SELECT stickers FROM fulfillment_shipping_labels WHERE store_id=$1 AND supply_id=$2", [s.id,id])).rows[0]?.stickers;
    if (!stickers) {
      const path = `/api/v3/supplies/${encodeURIComponent(id)}`;
      const units: any = saved.destination === "SC" ? {trbxes:[]} : await call(s,path + "/trbx");
      if (!Array.isArray(units.trbxes)) throw Error("WB не вернул список коробов. Повторите получение стикеров.");
      if (saved.destination === "PVZ" && units.trbxes.length !== saved.boxes)
        throw Error("Количество коробов WB не совпадает с поставкой. Стикеры не отправлены на печать.");
      if (units.trbxes.length) {
        const ids = units.trbxes.map((b: any) => b.id);
        if (ids.some((id: unknown) => typeof id !== "string" || !id) || new Set(ids).size !== ids.length)
          throw Error("WB вернул некорректный список коробов");
        const data: any = await call(s,path + "/trbx/stickers?type=png","POST",{trbxIds:ids});
        if (!Array.isArray(data.stickers) || data.stickers.length !== ids.length)
          throw Error("WB ещё не вернул стикеры всех коробов. Повторите печать из списка поставок.");
        stickers = data.stickers.map((label: any) => ({file:label.file}));
      } else {
        const data: any = await call(s,path + "/barcode?type=png");
        stickers = [{file:data.file}];
      }
      // Never cache an empty/error response or send arbitrary content to the local agent.
      if (stickers.some((label: any) => typeof label.file !== "string" || !/^[A-Za-z0-9+/]+={0,2}$/.test(label.file) || !Buffer.from(label.file,"base64").subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))))
        throw Error("WB не вернул PNG-стикер. Повторите печать из списка поставок.");
      await db.query("INSERT INTO fulfillment_shipping_labels(store_id,supply_id,stickers) VALUES($1,$2,$3)",[s.id,id,JSON.stringify(stickers)]);
    }
    return {stickers, printJob:"supplyo-shipping-" + createHash("sha256").update(s.id + "\0" + id).digest("hex").slice(0,40)};
  });
  app.post("/api/stores/:id/supplies/:supply/labels-printed", async (req, reply) => {
    const s = await store(req, reply);
    if (!s) return;
    const id = (req.params as any).supply;
    if (!await supplyAllowed(s,id,reply)) return;
    const labels = await db.query("SELECT 1 FROM fulfillment_shipping_labels WHERE store_id=$1 AND supply_id=$2",[s.id,id]);
    if (!labels.rows.length) return reply.code(409).send({error:"Сначала получите стикеры поставки"});
    await db.query("UPDATE fulfillment_supplies SET shipping_printed_at=$3 WHERE store_id=$1 AND id=$2",[s.id,id,new Date().toISOString()]);
    return {ok:true};
  });
  app.post("/api/stores/:id/supplies/:supply/deliver", async (req, reply) => {
    const s = await store(req, reply);
    if (!s) return;
    const id = (req.params as any).supply;
    if (!await supplyAllowed(s,id,reply)) return;
    const items = (
      await db.query<any>(
        "SELECT status,snapshot,printed,kiz,decision FROM fulfillment_items WHERE store_id=$1 AND supply_id=$2",
        [s.id, id],
      )
    ).rows;
    if (!items.length || items.some((i) => !readyForDelivery(i)))
      return reply.code(409).send({ error: "Все заказы должны быть готовы" });
    const input = z.object({destination: z.enum(["SC", "PVZ"]), boxes: z.number().int().min(1).max(1000).optional()}).strict().safeParse(req.body);
    if (!input.success || (input.data.destination === "PVZ" && !input.data.boxes) || (input.data.destination === "SC" && input.data.boxes !== undefined))
      return reply.code(400).send({error: "Выберите СЦ или ПВЗ. Для ПВЗ укажите целое количество коробов от 1 до 1000."});
    const saved = (await db.query<any>("SELECT closed FROM fulfillment_supplies WHERE store_id=$1 AND id=$2", [s.id, id])).rows[0];
    if (saved.closed) return reply.code(409).send({error: "Поставка уже передана в доставку"});
    const path = `/api/v3/supplies/${encodeURIComponent(id)}`;
    // Reconcile WB boxes on every attempt: a timeout must not create duplicates.
    const existing: any = await call(s, path + "/trbx");
    if (!Array.isArray(existing.trbxes)) throw new Error("WB не вернул список коробов. Повторите передачу.");
    const count = existing.trbxes.length;
    if (input.data.destination === "SC" && count > 0)
      return reply.code(409).send({error: "В WB уже созданы короба для ПВЗ. Выберите ПВЗ."});
    if (input.data.destination === "PVZ") {
      const wanted = input.data.boxes!;
      if (count > wanted) return reply.code(409).send({error: `В WB уже создано коробов: ${count}. Укажите не меньше этого количества.`});
      if (count < wanted) await call(s, path + "/trbx", "POST", {amount: wanted - count});
      const verified: any = await call(s, path + "/trbx");
      if (!Array.isArray(verified.trbxes) || verified.trbxes.length !== wanted)
        throw new Error("WB не подтвердил количество коробов. Поставка не передана, повторите попытку.");
    }
    await call(
      s,
      `/api/v3/supplies/${encodeURIComponent(id)}/deliver`,
      "PATCH",
    );
    await db.query(
      "UPDATE fulfillment_supplies SET closed=true,destination=$3,boxes=$4,delivered_at=$5 WHERE store_id=$1 AND id=$2",
      [s.id, id, input.data.destination, input.data.boxes ?? null, new Date().toISOString()],
    );
    return { ok: true };
  });
}
