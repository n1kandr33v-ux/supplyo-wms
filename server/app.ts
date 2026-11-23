import {registerAuthMail} from './auth-mail.ts';
import {registerOzonInventory} from './ozon-inventory.ts';
import {registerOzonClientMarks} from './ozon-client-marks.ts';
import {registerOzonLabels} from './ozon-labels.ts';
import type {PrintSticker} from './ozon-pdf.ts';
import {registerOzonAssembly,OzonAssemblyError} from './ozon-assembly.ts';
import { ozonClient,ozonCredentials,initOzon,saveOzon,saveOzonMarking,type OzonClient } from "./ozon.ts";
import { applySupplySnapshot, supplyEpoch, supplyBusy, type SavedItem } from "./supply-sync.ts";
import { createAccess } from "./access.ts";
import { createEmployees } from "./employees.ts";
import { registerWorkspace } from "./workspace.ts";
import Fastify from "fastify";
import { registerFulfillment } from "./fulfillment.ts";
import { registerStocks } from "./stocks.ts";
import { registerInternalStock,InternalStockError } from "./internal-stock.ts";
import { openDatabase } from "./database.ts";
import { randomBytes, randomUUID } from "node:crypto";
import { z } from "zod";
import {
  digest,
  hashPassword,
  verifyPassword,
  seal,
  unseal,
} from "./security.ts";
import { wbClient, WbError, marketplace, type WbClient } from "./wb.ts";

type Store = {
  id: string;
  marketplace?: "wb"|"ozon";
  user_id: string;
  credential: string;
  seller_id: string | null;
  name: string;
  status: string;
  next_sync: number;
  last_synced: string | null;
  error: string | null;
};
type Job = { id: string; store_id: string; kind: string; attempts: number };
const email = z.string().trim().toLowerCase().email().max(254);
const credentials = z.object({ email, password: z.string().min(8).max(128) });
const registration = credentials.extend({
  name: z.string().trim().min(2).max(150),
  phone: z.string().regex(/^\+?[\d\s()\-]{10,25}$/),
  consent: z.literal(true),
});
const safeStore = "id,name,status,last_synced,error,next_sync,marketplace";
export async function createApp(options: {
  dataDir?: string;
  databaseUrl?: string;
  key: Buffer;
  wb?: WbClient;
  ozon?: OzonClient;
  ozonLabelRenderer?:(pdf:Buffer)=>Promise<PrintSticker[]>;
  origins?: string[];
  worker?: boolean;
  testPurchases?: boolean;
  emailVerification?: boolean;
  sendAuthCode?:(email:string,code:string,purpose:string)=>Promise<void>;
}) {
  const db = await openDatabase(options.dataDir, options.databaseUrl),
    wb = options.wb ?? wbClient,ozon=options.ozon??ozonClient;
  await db.exec(`
    CREATE TABLE IF NOT EXISTS users(id text PRIMARY KEY,email text UNIQUE NOT NULL,password text NOT NULL,name text NOT NULL,phone text NOT NULL);
    CREATE TABLE IF NOT EXISTS subscriptions(user_id text PRIMARY KEY REFERENCES users(id),expires bigint NOT NULL DEFAULT 0,cabinet_limit integer NOT NULL DEFAULT 0);
    ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS is_test boolean NOT NULL DEFAULT false;
    CREATE TABLE IF NOT EXISTS sessions(token text PRIMARY KEY,user_id text REFERENCES users(id),expires bigint NOT NULL);
    CREATE TABLE IF NOT EXISTS stores(id text PRIMARY KEY,user_id text REFERENCES users(id),credential text NOT NULL,fingerprint text UNIQUE NOT NULL,seller_id text,name text NOT NULL DEFAULT 'Новый магазин WB',status text NOT NULL DEFAULT 'pending',next_sync bigint NOT NULL DEFAULT 0,last_synced text,error text);
    CREATE TABLE IF NOT EXISTS store_labels(user_id text NOT NULL REFERENCES users(id),store_id text NOT NULL REFERENCES stores(id),name text NOT NULL,PRIMARY KEY(user_id,store_id));
    CREATE TABLE IF NOT EXISTS jobs(id text PRIMARY KEY,store_id text REFERENCES stores(id),kind text NOT NULL,status text NOT NULL DEFAULT 'queued',attempts integer NOT NULL DEFAULT 0,run_at bigint NOT NULL DEFAULT 0);
    CREATE UNIQUE INDEX IF NOT EXISTS one_active_job ON jobs(store_id) WHERE status IN ('queued','running');
    CREATE TABLE IF NOT EXISTS orders(store_id text REFERENCES stores(id),id text,article text,skus jsonb,created_at text,warehouse_id text,PRIMARY KEY(store_id,id));
    CREATE INDEX IF NOT EXISTS orders_store_date ON orders(store_id,created_at DESC);
    CREATE TABLE IF NOT EXISTS auth_attempts(ip text PRIMARY KEY,count integer NOT NULL,reset_at bigint NOT NULL);
    CREATE TABLE IF NOT EXISTS api_cooldowns(bucket text PRIMARY KEY,next_at bigint NOT NULL);
    UPDATE jobs SET status='queued' WHERE status='running';
  `);
  await db.exec("ALTER TABLE stores ADD COLUMN IF NOT EXISTS api_retry_after bigint NOT NULL DEFAULT 0; UPDATE stores SET api_retry_after=GREATEST(api_retry_after,next_sync) WHERE error='WB ограничил запросы. Повторим автоматически.'");
  await db.exec("ALTER TABLE stores ADD COLUMN IF NOT EXISTS removed_at bigint");
  await db.exec("ALTER TABLE stores ADD COLUMN IF NOT EXISTS marketplace text NOT NULL DEFAULT 'wb'");
  await initOzon(db);
  const access = await createAccess(db);
  const employees = createEmployees(db,access,getWarehouses);
  const app = Fastify({ logger: false, routerOptions: { maxParamLength: 512 }, bodyLimit: 32768, trustProxy: "127.0.0.1" });
  const allowed = options.origins ?? [
    "http://127.0.0.1:8095",
    "http://localhost:8095",
  ];
  app.addHook("onRequest", async (req, reply) => {
    reply
      .header("Cache-Control", "no-store")
      .header("X-Content-Type-Options", "nosniff");
    if (
      !["GET", "HEAD"].includes(req.method) &&
      (!allowed.includes(req.headers.origin ?? "") ||
        req.headers["x-supplyo-client"] !== "web")
    ) {
      return reply
        .code(403)
        .send({ error: "Запрос отклонён. Обновите страницу." });
    }
  });
  app.setErrorHandler((error, _req, reply) => {
    reply.code(error instanceof InternalStockError?error.statusCode:error instanceof OzonAssemblyError?error.status:error instanceof z.ZodError ? 400 : error instanceof WbError ? 502 : 500).send({
      error:
        error instanceof InternalStockError?error.message:error instanceof OzonAssemblyError?error.message:error instanceof z.ZodError
          ? "Проверьте заполненные поля."
          : error instanceof WbError ? `${error.name==='OzonError'?'Ozon':'WB'} отклонил запрос (HTTP ${error.status}). Проверьте права ключа и состояние заказа. При ограничении запросов повторите позже.` : "Не удалось выполнить запрос.",
    });
  });
  async function userId(req: { headers: { cookie?: string } }) {
    const raw = req.headers.cookie
      ?.split(";")
      .map((s) => s.trim())
      .find((s) => s.startsWith("supplyo_session="))
      ?.slice(16);
    if (!raw) return null;
    return (
      (
        await db.query<{ user_id: string }>(
          "SELECT user_id FROM sessions WHERE token=$1 AND expires>$2",
          [digest(raw), Date.now()],
        )
      ).rows[0]?.user_id ?? null
    );
  }
  async function session(
    uid: string,
    reply: { header: (name: string, value: string) => unknown },
  ) {
    const token = randomBytes(32).toString("hex");
    await db.query("INSERT INTO sessions VALUES($1,$2,$3)", [
      digest(token),
      uid,
      Date.now() + 7 * 86400000,
    ]);
    reply.header(
      "Set-Cookie",
      `supplyo_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=604800${allowed.some(origin => origin.startsWith("https://")) ? "; Secure" : ""}`,
    );
  }
  async function enqueue(storeId: string, kind = "sync", manual = false) {
    if (manual) await db.transaction(async tx => {
      await tx.query("UPDATE stores SET next_sync=GREATEST(api_retry_after,$2::bigint) WHERE id=$1 AND status NOT IN ('syncing','removed')",[storeId,Date.now()]);
      await tx.query("UPDATE jobs SET run_at=GREATEST(s.api_retry_after,$2::bigint) FROM stores s WHERE jobs.store_id=s.id AND s.id=$1 AND jobs.status='queued'",[storeId,Date.now()]);
    });
    await db.query(
      "WITH added AS (INSERT INTO jobs(id,store_id,kind) SELECT $1,id,$3 FROM stores WHERE id=$2 AND status<>'removed' ON CONFLICT DO NOTHING RETURNING store_id) UPDATE stores SET status='queued' WHERE id IN (SELECT store_id FROM added) AND status<>'removed'",
      [randomUUID(), storeId, kind],
    );
  }
  if(options.emailVerification)await registerAuthMail(app,db,options.key,session,options.sendAuthCode);
  app.post("/api/auth/:action", async (req, reply) => {
    const { action } = req.params as { action: string };
    if(action==='register'&&options.emailVerification)return reply.code(400).send({error:'Подтвердите почту с помощью кода.',verificationRequired:true});
    if (action === "logout") {
      const raw = req.headers.cookie?.match(
        /(?:^|;\s*)supplyo_session=([^;]+)/,
      )?.[1];
      if (raw)
        await db.query("DELETE FROM sessions WHERE token=$1", [digest(raw)]);
      reply.header(
        "Set-Cookie",
        "supplyo_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0",
      );
      return { ok: true };
    }
    if (!["register", "login"].includes(action))
      return reply.code(404).send({ error: "Не найдено" });
    const attempt = (
      await db.query<{ count: number; reset_at: number }>(
        "SELECT * FROM auth_attempts WHERE ip=$1",
        [req.ip],
      )
    ).rows[0];
    if (attempt && Number(attempt.reset_at) > Date.now() && attempt.count >= 10)
      return reply
        .code(429)
        .send({ error: "Слишком много попыток. Повторите через 15 минут." });
    await db.query(
      "INSERT INTO auth_attempts VALUES($1,1,$2) ON CONFLICT(ip) DO UPDATE SET count=CASE WHEN auth_attempts.reset_at<$3 THEN 1 ELSE auth_attempts.count+1 END,reset_at=CASE WHEN auth_attempts.reset_at<$3 THEN $2 ELSE auth_attempts.reset_at END",
      [req.ip, Date.now() + 900000, Date.now()],
    );
    const input = (action === "register" ? registration : credentials).parse(
      req.body,
    );
    if (action === "register") {
      const data = registration.parse(input),
        uid = randomUUID(),
        password = await hashPassword(data.password);
      const result = await db.query(
        "INSERT INTO users VALUES($1,$2,$3,$4,$5) ON CONFLICT(email) DO NOTHING RETURNING id",
        [uid, data.email, password, data.name, data.phone],
      );
      if (!result.rows.length)
        return reply.code(409).send({
          error: "Не удалось создать аккаунт с этой почтой. Попробуйте войти.",
        });
      await session(uid, reply);
    } else {
      const user = (
        await db.query<{ id: string; password: string }>(
          "SELECT id,password FROM users WHERE email=$1",
          [input.email],
        )
      ).rows[0];
      // Equal-cost password check also for unknown accounts.
      if (
        !(await verifyPassword(
          input.password,
          user?.password ?? (await dummyPassword),
        ))
      )
        return reply.code(401).send({ error: "Неверная почта или пароль." });
      if (!user)
        return reply.code(401).send({ error: "Неверная почта или пароль." });
      await session(user.id, reply);
    }
    return { ok: true };
  });
  const dummyPassword = hashPassword(randomBytes(32).toString("hex"));
  async function reserveApi(bucket: string, spacing: number) {
    const existing = (
      await db.query<{ next_at: number }>(
        "SELECT next_at FROM api_cooldowns WHERE bucket=$1",
        [bucket],
      )
    ).rows[0];
    if (existing && Number(existing.next_at) > Date.now())
      throw new WbError(
        429,
        Math.ceil((Number(existing.next_at) - Date.now()) / 1000),
      );
    await db.query(
      "INSERT INTO api_cooldowns VALUES($1,$2) ON CONFLICT(bucket) DO UPDATE SET next_at=$2",
      [bucket, Date.now() + spacing],
    );
  }
  app.get("/api/health", async () => ({ ok: true }));
  app.addHook("preHandler", async (req, reply) => {
    if (!req.url.startsWith("/api/")) return;
    if (req.url.startsWith("/api/auth/") || req.url === "/api/health") return;
    if (!(await userId(req)))
      return reply.code(401).send({ error: "Войдите в аккаунт." });
  });
  async function entitlement(uid: string | null) {
    const row = (
      await db.query<{ expires: number; cabinet_limit: number; is_test: boolean }>(
        "SELECT expires,cabinet_limit,is_test FROM subscriptions WHERE user_id=$1",
        [uid],
      )
    ).rows[0];
    return {
      active:
        !!row && Number(row.expires) > Date.now() && row.cabinet_limit > 0,
      expires: row ? Number(row.expires) : 0,
      limit: row?.cabinet_limit ?? 0,
      isTest: row?.is_test ?? false,
    };
  }
  app.addHook("preHandler", async (req, reply) => {
    const isProtected =
      req.url.startsWith("/api/workspace") ||
      /^\/api\/stores\/[^/]+\/(sync|orders)(?:\?|$)/.test(req.url);
    if (
      isProtected &&
      (await userId(req)) &&
      !(await entitlement(await userId(req))).active &&
      !(await employees.memberships(await userId(req))).length
    )
      return reply.code(403).send({
        error:
          "Для работы с заказами нужна активная подписка. Подключить магазин можно без подписки.",
        code: "SUBSCRIPTION_REQUIRED",
      });
  });
  app.post("/api/subscription/test-purchase", async (req, reply) => {
    if (!options.testPurchases)
      return reply.code(404).send({ error: "Тестовая покупка недоступна." });
    const { plan } = z
      .object({ plan: z.enum(["solo", "start", "business", "pro"]) })
      .parse(req.body);
    const limits = { solo: 1, start: 5, business: 25, pro: 50 };
    const uid = await userId(req),
      limit = limits[plan];
    const count = await access.count(uid);
    if (count > limit)
      return reply
        .code(409)
        .send({
          error:
            "Уже подключено больше магазинов, чем позволяет выбранный тариф.",
        });
    await db.query(
      "INSERT INTO subscriptions(user_id,expires,cabinet_limit,is_test) VALUES($1,$2,$3,true) ON CONFLICT(user_id) DO UPDATE SET expires=CASE WHEN subscriptions.expires>$4 AND subscriptions.cabinet_limit=$3 THEN subscriptions.expires ELSE $2 END,cabinet_limit=$3,is_test=true",
      [uid, Date.now() + 30 * 86400000, limit, Date.now()],
    );
    return { ok: true, subscription: await entitlement(uid) };
  });
  app.get("/api/me", async (req) => ({
    testPurchasesEnabled: !!options.testPurchases,
    ...(
      await db.query<{ name: string; email: string; phone: string }>(
        "SELECT name,email,phone FROM users WHERE id=$1",
        [await userId(req)],
      )
    ).rows[0],
    subscription: await entitlement(await userId(req)),
    employeeAccess: (await employees.memberships(await userId(req))).map(m=>({id:m.id,name:m.warehouse.name,ownerName:m.ownerName,permissions:m.permissions})),
  }));
  app.get("/api/stores", async req => {
    const uid=await userId(req);
    const own=(await db.query(`SELECT ${safeStore},id AS cabinet_id,false AS delegated FROM stores WHERE user_id=$1 AND status<>'removed' ORDER BY id`,[uid])).rows;
    const shared=(await db.query(`SELECT a.id,s.id AS cabinet_id,s.name,s.status,s.last_synced,s.error,s.next_sync,s.marketplace,true AS delegated,a.warehouse_name
      FROM client_access a JOIN stores s ON s.id=a.store_id JOIN subscriptions sub ON sub.user_id=a.fulfillment_id
      WHERE a.fulfillment_id=$1 AND a.revoked IS NULL AND sub.expires>$2 AND sub.cabinet_limit>0 ORDER BY a.accepted DESC`,[uid,Date.now()])).rows;
    const labels=(await db.query<{store_id:string;name:string}>('SELECT store_id,name FROM store_labels WHERE user_id=$1',[uid])).rows;
    return {stores:[...own,...shared,...await employees.list(uid)].map((store:any)=>{const label=labels.find(l=>l.store_id===(store.cabinet_id||store.id));return {...store,original_name:store.name,custom_name:label?.name||null,name:label?.name||store.name}})};
  });
  app.post('/api/stores/:id/display-name',async(req,reply)=>{
    const uid=await userId(req),store=await access.resolve(uid,(req.params as {id:string}).id);
    if(!store||store.marketplace!=='ozon')return reply.code(404).send({error:'Магазин Ozon не найден.'});
    if(store.employee)return reply.code(403).send({error:'Название клиента задаёт владелец аккаунта.'});
    const {name}=z.object({name:z.string().trim().max(150).refine(v=>!/[\u0000-\u001f]/.test(v))}).parse(req.body);
    if(name)await db.query('INSERT INTO store_labels(user_id,store_id,name) VALUES($1,$2,$3) ON CONFLICT(user_id,store_id) DO UPDATE SET name=EXCLUDED.name',[uid,store.id,name]);
    else await db.query('DELETE FROM store_labels WHERE user_id=$1 AND store_id=$2',[uid,store.id]);
    return {ok:true};
  });
  app.post("/api/stores", async (req, reply) => {
    const input=z.object({token:z.string().trim().min(20).max(16000),marketplace:z.enum(['wb','ozon']).default('wb'),clientId:z.string().optional()}).parse(req.body);
    const c=input.marketplace==='ozon'?ozonCredentials.parse({clientId:input.clientId,apiKey:input.token}):null;
    const token=c?JSON.stringify(c):input.token,fingerprint=c?digest('ozon:'+c.clientId):digest(token);
    const uid = await userId(req),
      id = randomUUID();
    const result = await db.transaction(async tx=>{
      // The same lock is used when redeeming client access: capacity cannot be oversubscribed.
      await tx.query("SELECT id FROM users WHERE id=$1 FOR UPDATE",[uid]);
      const subscription=(await tx.query<{expires:number;cabinet_limit:number}>("SELECT expires,cabinet_limit FROM subscriptions WHERE user_id=$1",[uid])).rows[0];
      const count=await access.count(uid,tx);
      if (subscription?.expires>Date.now() && count>=subscription.cabinet_limit)
        return {error:"Достигнут лимит кабинетов по подписке."};
      if (count>=50) return {error:"Достигнут лимит подключённых магазинов: 50."};
      const inserted=await tx.query<{id:string}>("INSERT INTO stores(id,user_id,credential,fingerprint,marketplace,name) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(fingerprint) DO UPDATE SET credential=EXCLUDED.credential,status='pending',removed_at=NULL,error=NULL,next_sync=0 WHERE stores.user_id=EXCLUDED.user_id AND stores.status='removed' RETURNING id",[id,uid,seal(token,options.key),fingerprint,input.marketplace,c?'Новый магазин Ozon':'Новый магазин WB']);
      return {inserted:inserted.rows.length,id:inserted.rows[0]?.id};
    });
    if (result.error) return reply.code(403).send({error:result.error});
    if (!result.inserted)
      return reply.code(409).send({ error: "Этот ключ уже добавлен." });
    await enqueue(result.id!, "connect");
    return reply.code(202).send({ id:result.id });
  });
  const keyUpdates=new Set<string>();
  app.post('/api/stores/:id/credential',async(req,reply)=>{
    const uid=await userId(req),id=(req.params as {id:string}).id;
    const saved=(await db.query<{seller_id:string|null;fingerprint:string;credential:string;marketplace:string}>("SELECT seller_id,fingerprint,credential,marketplace FROM stores WHERE id=$1 AND user_id=$2 AND status<>'removed'",[id,uid])).rows[0];
    if(!saved)return reply.code(404).send({error:'Магазин не найден.'});
    const {token:submitted}=z.object({token:z.string().trim().min(20).max(16000)}).parse(req.body);
    const oldOzon=saved.marketplace==='ozon'?ozonCredentials.parse(JSON.parse(unseal(saved.credential,options.key))):null;
    const nextOzon=oldOzon?ozonCredentials.parse({...oldOzon,apiKey:submitted}):null;
    const token=nextOzon?JSON.stringify(nextOzon):submitted,newFingerprint=nextOzon?saved.fingerprint:digest(token);
    if((nextOzon&&oldOzon?.apiKey===nextOzon.apiKey)||(!nextOzon&&digest(token)===saved.fingerprint))return {ok:true,unchanged:true};
    if(!saved.seller_id&&!nextOzon)return reply.code(409).send({error:'Магазин ещё не определён. Дождитесь проверки текущего подключения.'});
    if(keyUpdates.has(id))return reply.code(409).send({error:'Новый ключ уже проверяется. Дождитесь результата.'});
    keyUpdates.add(id);
    try{
      if((await db.query("SELECT 1 FROM jobs WHERE store_id=$1 AND status='running'",[id])).rows.length)return reply.code(409).send({error:'Дождитесь завершения обновления магазина и повторите замену ключа.'});
      if((await db.query('SELECT 1 FROM stores WHERE fingerprint=$1 AND id<>$2',[newFingerprint,id])).rows.length)return reply.code(409).send({error:'Этот ключ уже используется другим подключением.'});
      if(!nextOzon)await reserveApi('seller-info',60000);
      const seller=nextOzon?await ozon.seller(nextOzon):await wb.seller(token);
      if(seller.sid!==(saved.seller_id??oldOzon?.clientId))return reply.code(400).send({error:'Ключ относится к другому продавцу. Текущий ключ сохранён.'});
      // A read verifies FBS permissions before replacing any credential or history.
      if(nextOzon){await ozon.warehouses(nextOzon);await ozon.postings(nextOzon,{since:new Date(Date.now()-86400000).toISOString(),to:new Date().toISOString()});}else await wb.orders(token);
      const changed=await db.transaction(async tx=>{
        await tx.query('SELECT id FROM users WHERE id=$1 FOR UPDATE',[uid]);
        const row=(await tx.query("SELECT id,fingerprint,credential FROM stores WHERE id=$1 AND user_id=$2 AND status<>'removed' FOR UPDATE",[id,uid])).rows[0] as {fingerprint:string;credential:string}|undefined;
        if(!row||row.fingerprint!==saved.fingerprint||row.credential!==saved.credential)return false;
        if((await tx.query("SELECT 1 FROM jobs WHERE store_id=$1 AND status='running'",[id])).rows.length)return false;
        await tx.query("UPDATE jobs SET status='cancelled' WHERE store_id=$1 AND status='queued'",[id]);
        await tx.query("UPDATE stores SET credential=$3,fingerprint=$4,error=NULL,status='queued',next_sync=GREATEST(api_retry_after,$5::bigint) WHERE id=$1 AND user_id=$2",[id,uid,seal(token,options.key),newFingerprint,Date.now()]);
        await tx.query("INSERT INTO jobs(id,store_id,kind) VALUES($1,$2,'connect')",[randomUUID(),id]);
        return true;
      });
      if(!changed)return reply.code(409).send({error:'Подключение изменилось или обновляется. Повторите замену ключа.'});
      return {ok:true};
    }catch(e){
      if(e instanceof WbError){
        if(e.status===429&&!nextOzon)await db.query("INSERT INTO api_cooldowns VALUES('seller-info',$1) ON CONFLICT(bucket) DO UPDATE SET next_at=GREATEST(api_cooldowns.next_at,$1::bigint)",[Date.now()+Math.max(60,e.retrySeconds)*1000]);
        return reply.code(e.status===429?429:400).send({error:e.status===429?'Маркетплейс ограничил проверку ключей. Повторите позже; текущий ключ сохранён.':'Маркетплейс не подтвердил новый ключ или доступ к заказам FBS. Текущий ключ сохранён.'});
      }
      if((e as {code?:string}).code==='23505')return reply.code(409).send({error:'Подключение уже обновляется или ключ занят. Текущий ключ сохранён.'});
      throw e;
    }finally{keyUpdates.delete(id);}
  });
  app.post("/api/stores/:id/remove", async (req,reply) => {
    const uid=await userId(req),id=(req.params as {id:string}).id;
    if (!z.object({confirm:z.literal(true)}).safeParse(req.body).success) return reply.code(400).send({error:"Подтвердите удаление магазина."});
    const removed=await db.transaction(async tx=>{
      await tx.query("SELECT id FROM users WHERE id=$1 FOR UPDATE",[uid]);
      const row=await tx.query("UPDATE stores SET status='removed',removed_at=COALESCE(removed_at,$3),credential='',error=NULL,next_sync=0 WHERE id=$1 AND user_id=$2 RETURNING id",[id,uid,Date.now()]);
      if (!row.rows.length) return false;
      await tx.query("UPDATE client_access SET revoked=$2 WHERE store_id=$1 AND revoked IS NULL",[id,Date.now()]);
      await tx.query(`UPDATE workspace_documents d SET version=version+1,data=(
        SELECT jsonb_agg(CASE WHEN w.value ? 'wmsScopes' THEN w.value || jsonb_build_object('wmsScopes',
          COALESCE((SELECT jsonb_agg(b) FROM jsonb_array_elements(w.value->'wmsScopes') b WHERE b->>'storeId'<>$1),'[]'::jsonb))
          ELSE w.value END ORDER BY w.ord) FROM jsonb_array_elements(d.data) WITH ORDINALITY w(value,ord))
        WHERE d.user_id=$2 AND d.kind='warehouses' AND EXISTS(
          SELECT 1 FROM jsonb_array_elements(d.data) w,jsonb_array_elements(COALESCE(w->'wmsScopes','[]'::jsonb)) b WHERE b->>'storeId'=$1)`,[id,uid]);
      await tx.query("UPDATE jobs SET status='cancelled' WHERE store_id=$1 AND status IN ('queued','running')",[id]);
      await tx.query("DELETE FROM inventory_sync WHERE store_id=$1",[id]);
      return true;
    });
    if (!removed) return reply.code(404).send({error:"Магазин не найден."});
    return {ok:true};
  });
  app.post("/api/stores/:id/sync", async (req, reply) => {
    const { id } = req.params as { id: string };
    const store = await access.resolve(await userId(req), id);
    if (!store) return reply.code(404).send({ error: "Магазин не найден." });
    if(!store.employee && !(await entitlement(await userId(req))).active)return reply.code(403).send({error:"Для работы с заказами подключите подписку."});
    if(store.permissions && !store.permissions.includes("view"))return reply.code(403).send({error:"Нет права просмотра заказов этого склада."});
    await enqueue(store.id, store.seller_id ? store.marketplace==='ozon'?"ozon-full":"sync" : "connect", true);
    return reply.code(202).send({ ok: true });
  });
  const warehouseCache = new Map<string, {until: number; rows: {id: string; name: string}[]}>();
  async function getWarehouses(store: Store) {
    const cached=warehouseCache.get(store.id);
    if (cached && cached.until>Date.now()) return cached.rows;
    const rows=store.marketplace==='ozon'?await ozon.warehouses(ozonCredentials.parse(JSON.parse(unseal(store.credential,options.key)))):z.array(z.object({id:z.number(),name:z.string()})).parse(await (wb.marketplace ?? marketplace)(unseal(store.credential,options.key),"/api/v3/warehouses")).map(w=>({id:String(w.id),name:w.name}));
    await db.transaction(async tx=>{
      await tx.query("DELETE FROM store_warehouses WHERE store_id=$1",[store.id]);
      for(const w of rows)await tx.query("INSERT INTO store_warehouses(store_id,id,name) VALUES($1,$2,$3)",[store.id,w.id,w.name]);
    });
    warehouseCache.set(store.id,{until:Date.now()+600000,rows});
    return rows;
  }
  await access.register(app,userId,getWarehouses,employees.dashboardScopes);
  app.get("/api/workspace/bindings",async(req,reply)=>{
    const uid=await userId(req);
    if(!(await entitlement(uid)).active)return reply.code(403).send({error:"Настройка кабинетов склада доступна владельцу с подпиской."});
    return {options:await employees.options(uid!)};
  });
  app.get("/api/stores/:id/warehouses",async(req,reply)=>{
    const store=await access.resolve(await userId(req),(req.params as {id:string}).id);
    if (!store) return reply.code(404).send({error:"Магазин не найден."});
    if (store.scope) return {warehouses:[{id:store.scope,name:store.warehouse_name}],scoped:true};
    return {warehouses:await getWarehouses(store),scoped:false};
  });
  app.get("/api/stores/:id/orders", async (req, reply) => {
    const store=await access.resolve(await userId(req),(req.params as {id:string}).id);
    if (!store) return reply.code(404).send({error:"Магазин не найден."});
    if(!store.employee && !(await entitlement(await userId(req))).active)return reply.code(403).send({error:"Для работы с заказами подключите подписку."});
    if(store.permissions && !store.permissions.includes("view"))return reply.code(403).send({error:"Нет права просмотра заказов этого склада."});
    if(store.marketplace==='ozon')return reply.code(400).send({error:'Используйте список FBS-отправлений Ozon.'});
    const id=store.id;
    const { search = "", page = "1", warehouse: requestedWarehouse = "" } = req.query as {
      warehouse?: string;
      search?: string;
      page?: string;
    };
    const warehouse = store.scope ?? requestedWarehouse;
    const current = Math.max(1, Math.min(100000, Number(page) || 1)),
      term = `%${search.slice(0, 150)}%`;
    const where =
      "store_id=$1 AND (article ILIKE $2 OR id ILIKE $2 OR skus::text ILIKE $2) AND ($3 = '' OR warehouse_id=$3)";
    const total = (
      await db.query<{ count: number }>(
        `SELECT count(*)::int AS count FROM orders WHERE ${where}`,
        [id, term, warehouse],
      )
    ).rows[0].count;
    const rows = (
      await db.query(
        `SELECT id,article,skus,created_at,warehouse_id FROM orders WHERE ${where} ORDER BY created_at DESC,id LIMIT 50 OFFSET $4`,
        [id, term, warehouse, (current - 1) * 50],
      )
    ).rows;
    return { orders: rows, total, page: current };
  });
  app.get('/api/stores/:id/ozon/postings',async(req,reply)=>{
    const store=await access.resolve(await userId(req),(req.params as any).id);if(!store)return reply.code(404).send({error:'Магазин не найден.'});
    if(store.marketplace!=='ozon')return reply.code(400).send({error:'Выберите магазин Ozon.'});
    if(!store.employee&&!(await entitlement(await userId(req))).active)return reply.code(403).send({error:'Для работы с заказами подключите подписку.'});
    if(store.permissions&&!store.permissions.includes('view'))return reply.code(403).send({error:'Нет права просмотра заказов.'});
    const q=z.object({section:z.enum(['all','new','deliveries']).default('all'),warehouse:z.string().max(100).default(''),status:z.string().max(100).default(''),search:z.string().max(150).default(''),page:z.coerce.number().int().min(1).max(100000).default(1)}).parse(req.query);
    const where="store_id=$1 AND ($2='' OR warehouse_id=$2) AND ($3='' OR status=$3) AND ($5='all' OR $5='new' AND status='awaiting_packaging' OR $5='deliveries' AND status<>'awaiting_packaging') AND (posting_number ILIKE $4 OR order_number ILIKE $4 OR products::text ILIKE $4)";
    const args=[store.id,store.scope||q.warehouse,q.status,'%'+q.search+'%',q.section];
    const total=(await db.query<{n:number}>(`SELECT count(*)::int n FROM ozon_postings WHERE ${where}`,args)).rows[0].n;
    const postings=(await db.query(`SELECT posting_number,order_number,status,products,warehouse_id,created_at,shipment_date,scanit FROM ozon_postings WHERE ${where} ORDER BY CASE status WHEN 'awaiting_packaging' THEN 0 WHEN 'awaiting_deliver' THEN 1 ELSE 2 END,created_at DESC,posting_number LIMIT 50 OFFSET $6`,[...args,(q.page-1)*50])).rows;
    const marks=(await db.query<{sku:string;required:boolean|null;tnved:string|null;checked_at:number}>('SELECT sku,required,tnved,checked_at FROM ozon_product_marking WHERE store_id=$1 AND sku=ANY($2::text[])',[store.id,[...new Set(postings.flatMap((p:any)=>p.products.map((item:any)=>item.sku)))]] )).rows;
    const bySku=new Map(marks.map(m=>[m.sku,m]));
    return {postings:postings.map((p:any)=>({...p,products:p.products.map((item:any)=>{const m=bySku.get(item.sku);return {...item,marking:{required:m?.required??null,tnved:m?.tnved??null,checkedAt:m?.checked_at??null,stale:!m||Number(m.checked_at)<Date.now()-86400000}};})})),total,page:q.page};
  });
  let running = false,
    stopping = false;
  async function tick() {
    if (running || stopping) return;
    running = true;
    try {
      // One process owns the queue. At most one pending sync per store.
      await db.query(
        "INSERT INTO jobs(id,store_id,kind) SELECT 'auto-'||id||'-'||$1::text,id,'sync' FROM stores WHERE status='ready' AND next_sync<=$1::bigint AND EXISTS(SELECT 1 FROM subscriptions sub WHERE sub.expires>$1::bigint AND sub.cabinet_limit>0 AND (sub.user_id=stores.user_id OR EXISTS(SELECT 1 FROM client_access a WHERE a.store_id=stores.id AND a.fulfillment_id=sub.user_id AND a.revoked IS NULL))) ON CONFLICT DO NOTHING",
        [Date.now()],
      );
      const job = (
        await db.query<Job>(
          "SELECT j.* FROM jobs j JOIN stores s ON s.id=j.store_id WHERE s.status<>'removed' AND (j.kind='connect' OR EXISTS(SELECT 1 FROM subscriptions sub WHERE sub.expires>$1 AND sub.cabinet_limit>0 AND (sub.user_id=s.user_id OR EXISTS(SELECT 1 FROM client_access a WHERE a.store_id=s.id AND a.fulfillment_id=sub.user_id AND a.revoked IS NULL)))) AND j.status='queued' AND j.run_at<=$1 AND s.next_sync<=$1 ORDER BY j.run_at LIMIT 1",
          [Date.now()],
        )
      ).rows[0];
      if (!job) return;
      const store = (
        await db.query<Store>("SELECT * FROM stores WHERE id=$1", [
          job.store_id,
        ])
      ).rows[0];
      if(supplyBusy(store.id))return;
      const syncEpoch=supplyEpoch(store.id);
      const claimed=await db.query(
        "UPDATE jobs SET status='running',attempts=attempts+1 WHERE id=$1 AND status='queued' RETURNING id",
        [job.id],
      );
      if (!claimed.rows.length) return;
      const started=await db.query(
        "UPDATE stores SET status='syncing',error=NULL,next_sync=$2 WHERE id=$1 AND status<>'removed' AND credential=$4 AND EXISTS(SELECT 1 FROM jobs WHERE id=$3 AND status='running') RETURNING id",
        [store.id, Date.now() + 60000,job.id,store.credential],
      );
      if (!started.rows.length) {await db.query("UPDATE jobs SET status='cancelled' WHERE id=$1 AND status='running'",[job.id]);return;}
      let activeBucket = "seller-info";
      try {
        const token = unseal(store.credential, options.key);
        if(store.marketplace==='ozon'){
          activeBucket='ozon:'+store.id;
          const c=ozonCredentials.parse(JSON.parse(token)),seller=(!store.seller_id||job.kind==='ozon-full')?await ozon.seller(c):null;
          const warehouses=await ozon.warehouses(c);
          const paid=(await db.query("SELECT 1 FROM subscriptions sub WHERE sub.expires>$2 AND sub.cabinet_limit>0 AND (sub.user_id=$1 OR EXISTS(SELECT 1 FROM client_access a WHERE a.store_id=$3 AND a.fulfillment_id=sub.user_id AND a.revoked IS NULL))",[store.user_id,Date.now(),store.id])).rows.length>0;
          const now=Date.now(),oldest=(await db.query<{oldest:string|null}>("SELECT min(created_at) oldest FROM ozon_postings WHERE store_id=$1 AND status NOT IN ('delivered','cancelled','canceled','returned')",[store.id])).rows[0]?.oldest;
          const since=new Date(Math.max(now-364*86400000,Math.min(now-30*86400000,oldest?Date.parse(oldest):now))).toISOString();
          const loadedPostings=paid?await ozon.postings(c,{since,to:new Date(now).toISOString(),...(store.last_synced&&job.kind==='sync'?{changedSince:new Date(Date.parse(store.last_synced)-10*60000).toISOString()}:{})}):[];
          const allowedWarehouses=new Set(warehouses.map(w=>w.id));
          const postings=loadedPostings.filter(p=>allowedWarehouses.has(p.delivery_method.warehouse_id));
          const skus=[...new Set(postings.flatMap(p=>p.products.map(item=>item.sku)))];
          // Include saved postings: status-delta reads may not contain unchanged active orders.
          if(paid)for(const row of (await db.query<{sku:string}>("SELECT DISTINCT product->>'sku' sku FROM ozon_postings CROSS JOIN LATERAL jsonb_array_elements(products) product WHERE store_id=$1 AND status NOT IN ('delivered','cancelled','canceled','returned')",[store.id])).rows)if(row.sku&&!skus.includes(row.sku))skus.push(row.sku);
          const cached=(await db.query<{sku:string;checked_at:number}>('SELECT sku,checked_at FROM ozon_product_marking WHERE store_id=$1',[store.id])).rows;
          const due=skus.filter(sku=>job.kind!=='sync'||!cached.some(m=>m.sku===sku&&Number(m.checked_at)>now-86400000));
          let marking:Awaited<ReturnType<OzonClient['marking']>>=[];
          try{if(due.length){const catalog=(await db.query<any>('SELECT sku,skus,barcodes FROM ozon_catalog WHERE store_id=$1 AND active',[store.id])).rows;const canonical=[...new Set(due.map(sku=>catalog.find(p=>p.skus.includes(sku))?.sku||sku))];const evidence=await ozon.marking(c,canonical);marking=evidence.flatMap(m=>{const p=catalog.find(p=>p.sku===m.sku);return (p?.skus||[m.sku]).map((sku:string)=>({...m,sku,barcodes:[...new Set([...m.barcodes,...(p?.barcodes||[])])]}));});}}catch(error){if(error instanceof Error&&error.name==='OzonError'&&(error as any).status===429)throw error;/* Preserve orders and old evidence when catalog access fails. */}
          await db.transaction(async tx=>{
            if(!(await tx.query("SELECT id FROM stores WHERE id=$1 AND status<>'removed' AND credential=$3 AND EXISTS(SELECT 1 FROM jobs WHERE id=$2 AND status='running') FOR UPDATE",[store.id,job.id,store.credential])).rows.length)return;
            await saveOzon(tx,store.id,warehouses,postings);
            await saveOzonMarking(tx,store.id,marking);
            await tx.query("UPDATE stores SET seller_id=COALESCE(seller_id,$2),name=COALESCE($3,name),status='ready',last_synced=$4,error=NULL,api_retry_after=0,next_sync=$5 WHERE id=$1",[store.id,c.clientId,seller?.name||null,paid?new Date(now).toISOString():null,now+60000]);
            await tx.query("UPDATE jobs SET status='done' WHERE id=$1",[job.id]);
          });warehouseCache.set(store.id,{until:Date.now()+600000,rows:warehouses});if(paid)await ozonInventory.schedule(store.id,job.kind==='ozon-full');return;
        }

        if (!store.seller_id) {
          await reserveApi("seller-info", 60000);
          const seller = await wb.seller(token);
          await db.query("UPDATE stores SET seller_id=$2,name=$3 WHERE id=$1", [
            store.id,
            seller.sid,
            seller.name,
          ]);
        }
        // Connecting verifies credentials and the seller name even without WMS access.
        // Never fetch orders on the connection job for an unsubscribed account.
        if (!(await db.query("SELECT 1 FROM subscriptions sub WHERE sub.expires>$2 AND sub.cabinet_limit>0 AND (sub.user_id=$1 OR EXISTS(SELECT 1 FROM client_access a WHERE a.store_id=$3 AND a.fulfillment_id=sub.user_id AND a.revoked IS NULL))",[store.user_id,Date.now(),store.id])).rows.length) {
          await db.transaction(async tx => {
            if (!(await tx.query("SELECT id FROM stores WHERE id=$1 AND status<>'removed' AND EXISTS(SELECT 1 FROM jobs WHERE id=$2 AND status='running') FOR UPDATE",[store.id,job.id])).rows.length) return;
            await tx.query("UPDATE stores SET status='ready',error=NULL,next_sync=0 WHERE id=$1", [store.id]);
            await tx.query("UPDATE jobs SET status='done' WHERE id=$1", [job.id]);
          });
          return;
        }
        activeBucket = "new-orders:" + store.id;
        // The per-token WB scheduler spaces requests. Manual refresh bypasses
        // only the periodic interval, never a persisted upstream 429 pause.
        const before=(await db.query<SavedItem>("SELECT id,supply_id,snapshot FROM fulfillment_items WHERE store_id=$1",[store.id])).rows;
        const beforeSupplies=(await db.query<{id:string}>("SELECT id FROM fulfillment_supplies WHERE store_id=$1",[store.id])).rows.map(s=>s.id);
        const orders = await wb.orders(token);
        const external=wb.supplies?await wb.supplies(token,[...before.map(i=>i.snapshot),...orders]):null;
        await db.transaction(async (tx) => {
          if (!(await tx.query("SELECT id FROM stores WHERE id=$1 AND status<>'removed' AND EXISTS(SELECT 1 FROM jobs WHERE id=$2 AND status='running') FOR UPDATE",[store.id,job.id])).rows.length) return;
          if(external){
            if(supplyBusy(store.id)||supplyEpoch(store.id)!==syncEpoch)throw Error("Состав поставок изменился во время синхронизации");
            await applySupplySnapshot(tx,store.id,external,before,beforeSupplies);
          }
          await tx.query("DELETE FROM orders WHERE store_id=$1", [store.id]);
          for (const order of orders)
            await tx.query(
              "INSERT INTO orders SELECT $1,$2,$3,$4::jsonb,$5,$6 WHERE NOT EXISTS(SELECT 1 FROM fulfillment_items WHERE store_id=$1 AND id=$2 AND supply_id IS NOT NULL) ON CONFLICT DO NOTHING",
              [
                store.id,
                String(order.id),
                order.article,
                JSON.stringify(order.skus),
                order.createdAt,
                String(order.warehouseId ?? ""),
              ],
            );
          if(external&&(supplyBusy(store.id)||supplyEpoch(store.id)!==syncEpoch))throw Error("Состав поставок изменился во время синхронизации");
          await tx.query(
            "UPDATE stores SET status='ready',last_synced=$2,error=NULL,api_retry_after=0,next_sync=$3 WHERE id=$1",
            [store.id, new Date().toISOString(),Date.now()+60000],
          );
          await tx.query("UPDATE jobs SET status='done' WHERE id=$1", [job.id]);
        });
      } catch (error) {
        const brand=store.marketplace==='ozon'?'Ozon':'WB';
        const retry =
          (error instanceof WbError &&
            (error.status === 429 || error.status >= 500)) ||
          !(error instanceof WbError);
        const delay =
          error instanceof WbError
            ? Math.max(60, error.retrySeconds)
            : Math.min(900, 60 * 2 ** job.attempts);
        if (error instanceof WbError && error.status === 429)
          await db.query(
            "INSERT INTO api_cooldowns VALUES($1,$2) ON CONFLICT(bucket) DO UPDATE SET next_at=GREATEST(api_cooldowns.next_at,$2)",
            [activeBucket, Date.now() + delay * 1000],
          );
        const again = retry && job.attempts < 4;
        const message =
          error instanceof WbError && [401, 403].includes(error.status)
            ? `${brand} отклонил ключ. Проверьте срок действия и права доступа.`
            : error instanceof WbError && error.status === 429
              ? `${brand} ограничил запросы. Повторим автоматически.`
              : `Не удалось получить данные ${brand}. Сохранённые заказы доступны.`;
        await db.query(
          "UPDATE stores SET status=$2,error=$3,next_sync=$4,api_retry_after=$5 WHERE id=$1 AND status<>'removed' AND EXISTS(SELECT 1 FROM jobs WHERE id=$6 AND status='running')",
          [
            store.id,
            again ? "queued" : "error",
            message,
            Date.now() + delay * 1000,
            error instanceof WbError && error.status===429 ? Date.now()+delay*1000 : 0,
            job.id,
          ],
        );
        await db.query("UPDATE jobs SET status=$2,run_at=$3 WHERE id=$1 AND status='running'", [
          job.id,
          again ? "queued" : "failed",
          Date.now() + delay * 1000,
        ]);
      }
    } finally {
      running = false;
    }
  }
  const stocks = await registerStocks(app, db, options.key, userId, access, wb, getWarehouses,()=>internalStock.tick());
  const ozonInventory=await registerOzonInventory(app,db,options.key,userId,access,ozon,getWarehouses,()=>internalStock.tick());
  const ozonInventoryTimer=options.worker===false?null:setInterval(()=>{void ozonInventory.tick().catch(()=>{});},1000);
  const ozonLabels=await registerOzonLabels(app,db,options.key,userId,access,ozon,options.ozonLabelRenderer);
  const ozonLabelsTimer=options.worker===false?null:setInterval(()=>{void ozonLabels.tick().catch(()=>{});},1000);
  const ozonAssembly=await registerOzonAssembly(app,db,options.key,userId,access,ozon);
  registerOzonClientMarks(app,db,userId,access);
  const ozonAssemblyTimer=options.worker===false?null:setInterval(()=>{void ozonAssembly.tick().catch(()=>{});},1000);
  const timer =
    options.worker === false
      ? null
      : setInterval(() => {
          void tick().catch(() => {
            /* Next tick retries persisted jobs. */
          });
        }, 1000);
  const stockTimer = options.worker === false ? null : setInterval(() => { void stocks.tick().catch(() => {}); }, 1000);
  app.addHook("onClose", async () => {
    stopping = true;
    if (timer) clearInterval(timer);
    if (stockTimer) clearInterval(stockTimer);
    if(ozonAssemblyTimer)clearInterval(ozonAssemblyTimer);
    if(ozonLabelsTimer)clearInterval(ozonLabelsTimer);
    if(ozonInventoryTimer)clearInterval(ozonInventoryTimer);
    await ozonInventory.close();
    await ozonLabels.close();
    await ozonAssembly.close();
    await stocks.close();
    while (running) await new Promise((r) => setTimeout(r, 20));
    await db.close();
  });
  await registerWorkspace(app, db, userId,employees,entitlement);
  await registerFulfillment(app, db, options.key, userId, wb.marketplace, access);
  const internalStock=await registerInternalStock(app,db,userId,access,employees,getWarehouses);
  const internalTimer=options.worker===false?null:setInterval(()=>{void internalStock.tick().catch(()=>{});},1000);
  app.addHook('onClose',async()=>{if(internalTimer)clearInterval(internalTimer);await internalStock.close();});
  return { app, db, tick, ozonInventoryTick:ozonInventory.tick,stockTick: stocks.tick,internalStockTick:internalStock.tick,ozonAssemblyTick:ozonAssembly.tick,ozonLabelTick:ozonLabels.tick };
}
