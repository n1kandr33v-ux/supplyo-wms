import type { FastifyInstance } from "fastify";
import type { Database, Queries } from "./database.ts";
import { randomBytes, randomUUID } from "node:crypto";
import { z } from "zod";
import { digest } from "./security.ts";

export type ScopedStore = {
  id: string; marketplace?: "wb"|"ozon"; user_id: string; credential: string; seller_id: string | null;
  name: string; status: string; next_sync: number; last_synced: string | null; error: string | null;
  scope?: string; warehouse_name?: string;
  permissions?: string[];
  employee?: boolean;
};
export async function createAccess(db: Database) {
  let employeeResolver: ((uid:string,id:string)=>Promise<ScopedStore|undefined>) | undefined;
  await db.exec(`CREATE TABLE IF NOT EXISTS client_access(
    id text PRIMARY KEY,store_id text NOT NULL REFERENCES stores(id),owner_id text NOT NULL REFERENCES users(id),
    warehouse_id text NOT NULL,warehouse_name text NOT NULL,code_hash text UNIQUE NOT NULL,
    expires bigint NOT NULL,created bigint NOT NULL,fulfillment_id text REFERENCES users(id),accepted bigint,revoked bigint);
    CREATE INDEX IF NOT EXISTS client_access_recipient ON client_access(fulfillment_id,store_id) WHERE revoked IS NULL;
    CREATE TABLE IF NOT EXISTS store_warehouses(store_id text NOT NULL REFERENCES stores(id),id text NOT NULL,name text NOT NULL,PRIMARY KEY(store_id,id));`);
  async function resolve(uid: string | null, id: string): Promise<ScopedStore | undefined> {
    if (!uid) return;
    if (id.startsWith("staff.")) return employeeResolver?.(uid,id);
    const own = (await db.query<ScopedStore>("SELECT * FROM stores WHERE id=$1 AND user_id=$2 AND status<>'removed'", [id,uid])).rows[0];
    if (own) return own;
    return (await db.query<ScopedStore>(`SELECT s.*,a.warehouse_id AS scope,a.warehouse_name FROM client_access a
      JOIN stores s ON s.id=a.store_id JOIN subscriptions sub ON sub.user_id=a.fulfillment_id
      WHERE a.id=$1 AND a.fulfillment_id=$2 AND a.revoked IS NULL AND s.status<>'removed' AND sub.expires>$3 AND sub.cabinet_limit>0`,[id,uid,Date.now()])).rows[0];
  }
  async function count(uid: string | null, tx: Queries = db) {
    return (await tx.query<{count:number}>(`SELECT count(DISTINCT id)::int count FROM (
      SELECT id FROM stores WHERE user_id=$1 AND status<>'removed' UNION ALL SELECT store_id AS id FROM client_access WHERE fulfillment_id=$1 AND revoked IS NULL) c`,[uid])).rows[0].count;
  }
  async function register(app: FastifyInstance, userId: (r:any)=>Promise<string|null>, warehouses:(store:ScopedStore)=>Promise<{id:string;name:string}[]>, employeeScopes:(uid:string|null)=>Promise<{store_id:string;warehouse_id:string;warehouse_name:string}[]>=async()=>[]) {
    // Authorize owners, fulfillment recipients and employees independently; every counter is warehouse-scoped.
    // Cached records only: opening the dashboard never calls the marketplace.
    app.get("/api/dashboard", async req => {
      const uid=await userId(req);
      return {warehouses:(await db.query(`
      WITH paid AS (
        SELECT 1 FROM subscriptions WHERE user_id=$1 AND expires>$2 AND cabinet_limit>0
      ), active_grants AS (
        SELECT a.*,physical.name AS fulfillment_name FROM client_access a
        JOIN subscriptions sub ON sub.user_id=a.fulfillment_id
        LEFT JOIN LATERAL (
          SELECT nullif(btrim(w->>'name'),'') AS name
          FROM workspace_documents d CROSS JOIN LATERAL jsonb_array_elements(d.data) w
          WHERE d.user_id=a.fulfillment_id AND d.kind='warehouses' AND (
            EXISTS(SELECT 1 FROM jsonb_array_elements(coalesce(w->'wmsScopes','[]'::jsonb)) binding
              WHERE binding->>'storeId'=a.id AND binding->>'warehouseId'=a.warehouse_id)
            OR (NOT (w ? 'wmsScopes') AND jsonb_array_length(d.data)=1)
          )
        ) physical ON true
        WHERE a.accepted IS NOT NULL AND a.revoked IS NULL AND sub.expires>$2 AND sub.cabinet_limit>0
      ), known_warehouses AS (
        SELECT store_id,id AS warehouse_id,name AS warehouse_name FROM store_warehouses
        UNION ALL SELECT store_id,warehouse_id,warehouse_name FROM client_access
        UNION ALL SELECT store_id,warehouse_id,NULL::text FROM orders
        UNION ALL SELECT store_id,warehouse_id,NULL::text FROM fulfillment_supplies
        UNION ALL SELECT store_id,snapshot->>'warehouseId',NULL::text FROM fulfillment_items
      ), sources AS (
        SELECT a.store_id,a.warehouse_id,a.warehouse_name,a.fulfillment_name
        FROM active_grants a WHERE a.owner_id=$1 AND a.fulfillment_id<>$1
        UNION ALL
        SELECT a.store_id,a.warehouse_id,a.warehouse_name,NULL::text
        FROM active_grants a WHERE a.fulfillment_id=$1
        UNION ALL
        SELECT w.store_id,w.warehouse_id,w.warehouse_name,NULL::text
        FROM known_warehouses w JOIN stores s ON s.id=w.store_id
        WHERE s.user_id=$1 AND EXISTS(SELECT 1 FROM paid)
        UNION ALL
        SELECT e.store_id,e.warehouse_id,e.warehouse_name,NULL::text
        FROM jsonb_to_recordset($3::jsonb) AS e(store_id text,warehouse_id text,warehouse_name text)
      ), connected AS (
        SELECT store_id,warehouse_id,coalesce(max(nullif(warehouse_name,'')),'Склад № '||warehouse_id) AS warehouse_name,
          coalesce(array_agg(DISTINCT fulfillment_name ORDER BY fulfillment_name) FILTER(WHERE fulfillment_name IS NOT NULL),ARRAY[]::text[]) AS fulfillments
        FROM sources WHERE warehouse_id IS NOT NULL AND warehouse_id<>'' GROUP BY store_id,warehouse_id
      )
      SELECT c.store_id,c.warehouse_id,c.warehouse_name,c.fulfillments,s.name AS store_name,s.last_synced,s.marketplace,
        CASE WHEN s.marketplace='ozon' THEN (SELECT count(*)::int FROM ozon_postings o WHERE o.store_id=c.store_id AND o.warehouse_id=c.warehouse_id AND status='awaiting_packaging') ELSE (SELECT count(*)::int FROM orders o WHERE o.store_id=c.store_id AND o.warehouse_id=c.warehouse_id) END AS new_orders,
        (SELECT count(*)::int FROM ozon_postings o WHERE o.store_id=c.store_id AND o.warehouse_id=c.warehouse_id AND status='awaiting_deliver') AS ozon_ready,
        (SELECT count(*)::int FROM ozon_postings o WHERE o.store_id=c.store_id AND o.warehouse_id=c.warehouse_id) AS ozon_total,
        (SELECT count(*)::int FROM fulfillment_items i JOIN fulfillment_supplies p ON p.store_id=i.store_id AND p.id=i.supply_id
          WHERE i.store_id=c.store_id AND i.snapshot->>'warehouseId'=c.warehouse_id AND NOT p.closed AND NOT p.wb_removed) AS assembly_orders,
        (SELECT count(*)::int FROM fulfillment_items i JOIN fulfillment_supplies p ON p.store_id=i.store_id AND p.id=i.supply_id
          WHERE i.store_id=c.store_id AND i.snapshot->>'warehouseId'=c.warehouse_id AND NOT p.closed AND NOT p.wb_removed AND i.status='Готов') AS ready_orders,
        (SELECT count(*)::int FROM fulfillment_supplies p WHERE p.store_id=c.store_id AND NOT p.wb_removed
          AND (p.warehouse_id=c.warehouse_id OR (p.warehouse_id IS NULL
            AND EXISTS(SELECT 1 FROM fulfillment_items i WHERE i.store_id=p.store_id AND i.supply_id=p.id)
            AND NOT EXISTS(SELECT 1 FROM fulfillment_items i WHERE i.store_id=p.store_id AND i.supply_id=p.id
              AND (i.snapshot->>'warehouseId') IS DISTINCT FROM c.warehouse_id)))) AS supplies_count
      FROM connected c JOIN stores s ON s.id=c.store_id WHERE s.status<>'removed'
      ORDER BY c.warehouse_name,s.name,c.store_id,c.warehouse_id`,[uid,Date.now(),JSON.stringify(await employeeScopes(uid))])).rows};
    });
    app.get("/api/access/outgoing", async req => ({grants:(await db.query(`SELECT a.id,a.store_id,s.name,a.warehouse_name,a.expires,a.accepted,a.revoked,u.name AS fulfillment_name
      FROM client_access a JOIN stores s ON s.id=a.store_id LEFT JOIN users u ON u.id=a.fulfillment_id
      WHERE a.owner_id=$1 ORDER BY a.created DESC`,[await userId(req)])).rows}));
    app.get("/api/access/incoming", async (req,reply) => {
      const uid=await userId(req);
      if (!(await db.query("SELECT 1 FROM subscriptions WHERE user_id=$1 AND expires>$2 AND cabinet_limit>0",[uid,Date.now()])).rows.length)
        return reply.code(403).send({error:"Для подключения клиентов нужна активная подписка."});
      return {clients:(await db.query(`SELECT a.id,a.store_id,COALESCE(l.name,s.name) AS name,a.warehouse_name,a.accepted FROM client_access a JOIN stores s ON s.id=a.store_id LEFT JOIN store_labels l ON l.store_id=s.id AND l.user_id=$1
        WHERE a.fulfillment_id=$1 AND a.revoked IS NULL ORDER BY a.accepted DESC`,[uid])).rows};
    });
    app.post("/api/access/codes", async (req,reply) => {
      const input=z.object({storeId:z.string().min(1),warehouseId:z.string().min(1)}).parse(req.body), uid=await userId(req);
      const store=(await db.query<ScopedStore>("SELECT * FROM stores WHERE id=$1 AND user_id=$2 AND status<>'removed'",[input.storeId,uid])).rows[0];
      if (!store) return reply.code(404).send({error:"Магазин не найден."});
      if (!store.seller_id) return reply.code(409).send({error:"Дождитесь проверки API-ключа магазина."});
      const warehouse=(await warehouses(store)).find(w=>w.id===input.warehouseId);
      if (!warehouse) return reply.code(400).send({error:"Выберите склад подключённого магазина."});
      const code="FF-"+randomBytes(16).toString("hex").toUpperCase(),id=randomUUID(),now=Date.now(),expires=now+86400000;
      await db.transaction(async tx=>{
        if (!(await tx.query("SELECT id FROM stores WHERE id=$1 AND status<>'removed' FOR UPDATE",[store.id])).rows.length) return {status:404,error:"Магазин удалён."};
        await tx.query("UPDATE client_access SET revoked=$3 WHERE store_id=$1 AND warehouse_id=$2 AND fulfillment_id IS NULL AND revoked IS NULL",[store.id,warehouse.id,now]);
        await tx.query("INSERT INTO client_access(id,store_id,owner_id,warehouse_id,warehouse_name,code_hash,expires,created) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",[id,store.id,uid,warehouse.id,warehouse.name,digest(code),expires,now]);
      });
      return {id,code,expires};
    });
    app.post("/api/access/redeem", async (req,reply)=>{
      const {code}=z.object({code:z.string().trim().toUpperCase().min(5).max(100)}).parse(req.body),uid=await userId(req);
      const result=await db.transaction(async tx=>{
        // Serialize plan capacity and concurrent redemption for this recipient.
        await tx.query("SELECT id FROM users WHERE id=$1 FOR UPDATE",[uid]);
        const sub=(await tx.query<{cabinet_limit:number}>("SELECT cabinet_limit FROM subscriptions WHERE user_id=$1 AND expires>$2",[uid,Date.now()])).rows[0];
        if (!sub?.cabinet_limit) return {status:403,error:"Для подключения клиентов нужна активная подписка."};
        const grant=(await tx.query<any>("SELECT * FROM client_access WHERE code_hash=$1 FOR UPDATE",[digest(code)])).rows[0];
        if (!grant || grant.revoked || grant.fulfillment_id || Number(grant.expires)<=Date.now()) return {status:400,error:"Код недействителен, уже использован или истёк. Попросите клиента создать новый."};
        if (grant.owner_id===uid) return {status:400,error:"Этот магазин уже принадлежит вашему аккаунту."};
        const duplicate=(await tx.query("SELECT 1 FROM client_access WHERE store_id=$1 AND warehouse_id=$2 AND fulfillment_id=$3 AND revoked IS NULL",[grant.store_id,grant.warehouse_id,uid])).rows.length;
        if (duplicate) return {status:409,error:"Доступ к этому кабинету и складу уже подключён."};
        const counted=(await tx.query("SELECT 1 FROM client_access WHERE store_id=$1 AND fulfillment_id=$2 AND revoked IS NULL",[grant.store_id,uid])).rows.length;
        if (!counted && await count(uid,tx)>=sub.cabinet_limit) return {status:403,error:"Достигнут лимит кабинетов по подписке."};
        await tx.query("UPDATE client_access SET fulfillment_id=$2,accepted=$3 WHERE id=$1",[grant.id,uid,Date.now()]);
        if (!(await tx.query("UPDATE stores SET next_sync=0 WHERE id=$1 AND status<>'removed' RETURNING id",[grant.store_id])).rows.length) {
          await tx.query("UPDATE client_access SET revoked=$2 WHERE id=$1",[grant.id,Date.now()]);
          return {status:400,error:"Магазин удалён. Попросите клиента создать новый доступ после подключения."};
        }
        return {status:200,id:grant.id};
      });
      if (result.status!==200) return reply.code(result.status).send({error:result.error});
      return {id:result.id};
    });
    app.post("/api/access/:id/revoke",async(req,reply)=>{
      const uid=await userId(req),id=(req.params as {id:string}).id;
      const rows=(await db.query("UPDATE client_access SET revoked=$3 WHERE id=$1 AND (owner_id=$2 OR fulfillment_id=$2) AND revoked IS NULL RETURNING id",[id,uid,Date.now()])).rows;
      if (!rows.length) return reply.code(404).send({error:"Доступ не найден или уже отозван."});
      return {ok:true};
    });
  }
  return {resolve,count,register,setEmployeeResolver:(resolver:typeof employeeResolver)=>{employeeResolver=resolver}};
}
export type Access = Awaited<ReturnType<typeof createAccess>>;
