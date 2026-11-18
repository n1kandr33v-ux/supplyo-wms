import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import type { Database } from "./database.ts";
import type { Employees, Membership } from "./employees.ts";
import {invoiceTotal} from '../src/lib/invoice.ts';

const text = z.string().max(500);
const id = z.string().min(1).max(150);
const permissions = z.array(z.enum(["view", "assembly", "supplies", "stocks", "manage"])).max(5);
const warehouse = z.object({
  id, name: text.trim().min(1), city: text.trim().min(1), address: text.trim().min(1),
  staff: z.array(z.string().email().max(254)).max(300),
  staffNames: z.record(z.string(), text).optional(),
  staffRights: z.record(z.string(), permissions).optional(),
  wmsScopes: z.array(z.object({storeId:id,warehouseId:id})).max(100).optional(),
});
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const parsed = new Date(value + "T12:00:00Z");
  return Number.isFinite(+parsed) && parsed.toISOString().slice(0,10) === value;
});
const workItem = z.object({title: text.trim().min(1), quantity: z.number().positive().max(1e9), rate: z.number().positive().max(1e9)});
const priceService=z.object({id,title:text.trim().min(1),unit:z.string().trim().min(1).max(30),rate:z.number().min(0).max(1e9).refine(n=>Math.abs(n*100-Math.round(n*100))<0.00001)});
const invoiceItem=z.object({serviceId:id,title:text.trim().min(1),unit:z.string().trim().min(1).max(30),quantity:z.number().positive().max(1e9).refine(n=>Math.abs(n*1000-Math.round(n*1000))<0.0001),rate:priceService.shape.rate});
const pricesSchema=z.array(priceService).max(500).refine(rows=>new Set(rows.map(r=>r.id)).size===rows.length);
const entry = z.object({
  id, kind: z.enum(["income", "expense", "work", "invoice"]), warehouseId: id,
  date, title: text.trim().min(1), person: text, amount: z.number().positive().max(1e12),
  quantity: z.number().finite().nonnegative(), rate: z.number().finite().nonnegative(),
  paid: z.boolean(), number: text, due: z.union([date, z.literal("")]),
  employeeEmail: z.string().email().optional(), category: text.optional(),
  recordedAt: z.string().datetime().optional(), workItems: z.array(workItem).min(1).max(100).optional(),
  invoiceItems:z.array(invoiceItem).min(1).max(500).refine(rows=>new Set(rows.map(r=>r.serviceId)).size===rows.length).optional(),
  documents: z.array(z.object({id: z.string().uuid(), name: text})).max(30).optional(),
}).refine(row=>row.kind!=='invoice'||!row.invoiceItems||row.amount===invoiceTotal(row.invoiceItems),{message:'Сумма счёта не совпадает с расчётом услуг.'});
const unique = (rows: {id:string}[]) => new Set(rows.map(row=>row.id)).size === rows.length;
const warehousesSchema = z.array(warehouse).max(100).refine(unique).refine(rows => rows.every(row =>
  new Set(row.staff).size === row.staff.length && row.staff.every(email => !!row.staffNames?.[email]?.trim() && !!row.staffRights?.[email]?.length)
));
const entriesSchema = z.array(entry).max(10000).refine(unique);

/** Owner-scoped documents. Versions prevent a stale tab from overwriting saved changes. */
export async function registerWorkspace(app: FastifyInstance, db: Database, userId: (req: FastifyRequest)=>Promise<string|null>, employees:Employees, entitlement:(uid:string|null)=>Promise<{active:boolean}>) {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS workspace_documents(
      user_id text NOT NULL REFERENCES users(id), kind text NOT NULL,
      data jsonb NOT NULL, version integer NOT NULL DEFAULT 0, PRIMARY KEY(user_id,kind));
    CREATE TABLE IF NOT EXISTS workspace_files(
      id text PRIMARY KEY, user_id text NOT NULL REFERENCES users(id), name text NOT NULL,
      mime text NOT NULL, content bytea NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
    CREATE INDEX IF NOT EXISTS workspace_files_owner ON workspace_files(user_id);
  `);
  async function context(req:FastifyRequest,reply:any):Promise<{uid:string;member?:Membership}|null>{
    const uid=await userId(req),team=(req.query as {team?:string}).team;
    if(team){
      const member=(await employees.memberships(uid)).find(m=>m.id===team);
      if(!member||!member.permissions.includes("manage")){reply.code(403).send({error:"Нет права управления этим складом."});return null}
      return {uid:member.ownerId,member};
    }
    if(!uid||!(await entitlement(uid)).active){reply.code(403).send({error:"Выберите доступный склад сотрудника."});return null}
    return {uid};
  }
  app.get("/api/workspace", async (req,reply) => {
    const ctx=await context(req,reply);if(!ctx)return;
    const rows=(await db.query<{kind:string;data:any[];version:number}>("SELECT kind,data,version FROM workspace_documents WHERE user_id=$1",[ctx.uid])).rows;
    const doc=(kind:string)=>rows.find(row=>row.kind===kind) || {data:[],version:0};
    const warehouses=doc("warehouses");
    return {warehouses:ctx.member?{...warehouses,data:warehouses.data.filter(w=>w.id===ctx.member!.warehouse.id)}:warehouses,accounting:ctx.member?{data:[],version:0}:doc("accounting"),prices:ctx.member?{data:[],version:0}:doc('prices'),clientServices:ctx.member?{data:[],version:0}:doc('clientServices')};
  });
  app.post('/api/workspace/prices',async(req,reply)=>{
    const ctx=await context(req,reply);if(!ctx)return;if(ctx.member)return reply.code(403).send({error:'Прайс изменяет владелец фулфилмента.'});
    const body=z.object({version:z.number().int().nonnegative(),data:pricesSchema}).parse(req.body);
    const result=await db.transaction(async tx=>{
      await tx.query("INSERT INTO workspace_documents(user_id,kind,data) VALUES($1,'prices','[]') ON CONFLICT DO NOTHING",[ctx.uid]);
      const current=(await tx.query<any>("SELECT version FROM workspace_documents WHERE user_id=$1 AND kind='prices' FOR UPDATE",[ctx.uid])).rows[0];
      if(current.version!==body.version)return null;
      await tx.query("UPDATE workspace_documents SET data=$2::jsonb,version=version+1 WHERE user_id=$1 AND kind='prices'",[ctx.uid,JSON.stringify(body.data)]);return {version:current.version+1};
    });
    return result||reply.code(409).send({error:'Прайс изменился в другом окне. Обновите страницу.'});
  });
  app.post('/api/workspace/clientServices',async(req,reply)=>{
    const ctx=await context(req,reply);if(!ctx)return;if(ctx.member)return reply.code(403).send({error:'Постоянные услуги изменяет владелец фулфилмента.'});
    const body=z.object({version:z.number().int().nonnegative(),data:z.array(z.object({client:text.trim().min(1),serviceIds:z.array(id).max(500).refine(ids=>new Set(ids).size===ids.length)})).max(2000).refine(rows=>new Set(rows.map(r=>r.client.toLocaleLowerCase('ru-RU').replace(/\s+/g,' '))).size===rows.length)}).parse(req.body);
    const result=await db.transaction(async tx=>{
      await tx.query("INSERT INTO workspace_documents(user_id,kind,data) VALUES($1,'clientServices','[]') ON CONFLICT DO NOTHING",[ctx.uid]);
      const current=(await tx.query<any>("SELECT version FROM workspace_documents WHERE user_id=$1 AND kind='clientServices' FOR UPDATE",[ctx.uid])).rows[0];
      if(current.version!==body.version)return null;
      await tx.query("UPDATE workspace_documents SET data=$2::jsonb,version=version+1 WHERE user_id=$1 AND kind='clientServices'",[ctx.uid,JSON.stringify(body.data)]);return {version:current.version+1};
    });
    return result||reply.code(409).send({error:'Постоянные услуги изменились в другом окне. Обновите страницу.'});
  });
  app.post("/api/workspace/:kind", {bodyLimit: 6*1024*1024}, async (req, reply) => {
    const kind=z.enum(["warehouses","accounting"]).parse((req.params as {kind:string}).kind);
    const body=z.object({version:z.number().int().nonnegative(),data:kind==="warehouses"?warehousesSchema:entriesSchema}).parse(req.body);
    const ctx=await context(req,reply);if(!ctx)return;
    const uid=ctx.uid;
    if(ctx.member&&(kind!=="warehouses"||body.data.length!==1||body.data[0].id!==ctx.member.warehouse.id))return reply.code(403).send({error:"Можно изменять только назначенный склад."});
    if(ctx.member){
      const next=body.data[0] as z.infer<typeof warehouse>,old=ctx.member.warehouse;
      const ownEmail=(await db.query<{email:string}>("SELECT email FROM users WHERE id=$1",[await userId(req)])).rows[0].email;
      const beforeEmail=old.staff.find(e=>e.toLowerCase()===ownEmail.toLowerCase())!;
      if(JSON.stringify(next.wmsScopes)!==JSON.stringify(old.wmsScopes)||!next.staff.includes(beforeEmail)||JSON.stringify(next.staffRights?.[beforeEmail])!==JSON.stringify(old.staffRights?.[beforeEmail])||Object.values(next.staffRights||{}).some(ps=>ps.some(p=>!ctx.member!.permissions.includes(p))))
        return reply.code(403).send({error:"Нельзя изменять привязку кабинетов или собственные права. Обратитесь к владельцу склада."});
    }else if(kind==="warehouses" && (body.data as z.infer<typeof warehouse>[]).some(w=>w.wmsScopes?.length)){
      const available=await employees.options(uid);
      if((body.data as z.infer<typeof warehouse>[]).some(w=>w.wmsScopes?.some(b=>!available.some(a=>a.storeId===b.storeId&&a.warehouseId===b.warehouseId))))return reply.code(400).send({error:"Выберите доступные кабинеты и склады WB."});
    }
    const result=await db.transaction(async tx=>{
      await tx.query("INSERT INTO workspace_documents(user_id,kind,data) VALUES($1,'warehouses','[]'),($1,'accounting','[]') ON CONFLICT DO NOTHING",[uid]);
      // Lock both documents in the same order, including for warehouse deletions.
      const docs=(await tx.query<{kind:string;version:number;data:unknown[]}>("SELECT kind,version,data FROM workspace_documents WHERE user_id=$1 ORDER BY kind FOR UPDATE",[uid])).rows;
      const current=docs.find(doc=>doc.kind===kind)!;
      if(current.version!==body.version) return {status:409,error:"Данные изменились в другом окне. Обновите раздел перед сохранением."};
      if(ctx.member)body.data=(current.data as {id:string}[]).map(w=>w.id===ctx.member!.warehouse.id?body.data[0]:w) as typeof body.data;
      const warehouses=(kind==="warehouses"?body.data:docs.find(doc=>doc.kind==="warehouses")!.data) as z.infer<typeof warehouse>[];
      if(kind==='warehouses')for(const old of current.data as {id:string}[]){
        if(!warehouses.some(w=>w.id===old.id)&&(await tx.query('SELECT 1 FROM internal_stock_items WHERE location=$1 LIMIT 1',[JSON.stringify(['physical',uid,old.id])])).rows.length)
          return {status:409,error:'Нельзя удалить склад с товарами внутреннего учёта.'};
      }
      const accounting=(kind==="accounting"?body.data:docs.find(doc=>doc.kind==="accounting")!.data) as z.infer<typeof entry>[];
      if(kind==='accounting'){
        const prices=(await tx.query<any>("SELECT data FROM workspace_documents WHERE user_id=$1 AND kind='prices' FOR SHARE",[uid])).rows[0]?.data||[];
        for(const invoice of accounting.filter(r=>r.kind==='invoice'&&r.invoiceItems)){
          const old=(current.data as z.infer<typeof entry>[]).find(r=>r.id===invoice.id&&r.kind==='invoice');
          for(const item of invoice.invoiceItems!){
            const prior=old?.invoiceItems?.find(i=>i.serviceId===item.serviceId);
            if(prior&&prior.title===item.title&&prior.unit===item.unit&&prior.rate===item.rate)continue;
            if(!prices.some((p:any)=>p.id===item.serviceId&&p.title===item.title&&p.unit===item.unit&&p.rate===item.rate))return {status:409,error:'Прайс изменился. Обновите услуги счёта перед сохранением.'};
          }
        }
      }
      if(accounting.some(row=>!warehouses.some(store=>store.id===row.warehouseId))) return {status:409,error:kind==="warehouses"?"Нельзя удалить склад, пока с ним связаны записи учёта.":"Сначала добавьте склад в разделе «Склады»."};
      for(const row of accounting){
        if(kind==="accounting" && row.kind==="work" && !current.data.some(old=>(old as {id:string}).id===row.id)) {
          const store=warehouses.find(store=>store.id===row.warehouseId)!;
          if(!store.staff.includes(row.employeeEmail||"")) return {status:400,error:"Выберите сотрудника выбранного склада."};
        }
      }
      const documentIds=[...new Set(accounting.flatMap(row=>(row.documents||[]).map(file=>file.id)))];
      if(documentIds.length){
        const owned=(await tx.query<{id:string}>("SELECT id FROM workspace_files WHERE user_id=$1 AND id=ANY($2::text[])",[uid,documentIds])).rows;
        if(owned.length!==documentIds.length)return {status:400,error:"Прикреплённый документ не найден."};
      }
      await tx.query("UPDATE workspace_documents SET data=$3::jsonb,version=version+1 WHERE user_id=$1 AND kind=$2",[uid,kind,JSON.stringify(body.data)]);
      return {version:current.version+1};
    });
    if("error" in result) return reply.code(result.status!).send({error:result.error});
    return result;
  });
  app.addContentTypeParser("application/octet-stream",{parseAs:"buffer",bodyLimit:5*1024*1024},(_req,body,done)=>done(null,body));
  app.post("/api/workspace/files", {bodyLimit:5*1024*1024}, async (req,reply)=>{
    if((req.query as {team?:string}).team || !(await entitlement(await userId(req))).active)return reply.code(403).send({error:"Нет доступа к документам учёта."});
    const content=req.body;
    if(!Buffer.isBuffer(content)||!content.length) return reply.code(400).send({error:"Выберите непустой файл до 5 МБ."});
    let name:string;
    try{name=decodeURIComponent(String(req.headers["x-file-name"]||""))}catch{return reply.code(400).send({error:"Некорректное имя файла."})}
    if(!name || name.length>250) return reply.code(400).send({error:"Некорректное имя файла."});
    const uid=await userId(req), fileId=req.headers["x-file-id"]?z.string().uuid().parse(req.headers["x-file-id"]):randomUUID();
    const mime=String(req.headers["x-file-type"]||"application/octet-stream").slice(0,150);
    const size=(await db.query<{bytes:number}>("SELECT COALESCE(sum(octet_length(content)),0)::bigint bytes FROM workspace_files WHERE user_id=$1",[uid])).rows[0].bytes;
    if(Number(size)+content.length>100*1024*1024) return reply.code(413).send({error:"Достигнут лимит документов 100 МБ."});
    await db.query("INSERT INTO workspace_files(id,user_id,name,mime,content) VALUES($1,$2,$3,$4,$5)",[fileId,uid,name,mime,content]);
    return {id:fileId,name};
  });
  app.get("/api/workspace/files/:id",async(req,reply)=>{
    if((req.query as {team?:string}).team || !(await entitlement(await userId(req))).active)return reply.code(403).send({error:"Нет доступа к документам учёта."});
    const file=(await db.query<{name:string;mime:string;content:Uint8Array}>("SELECT name,mime,content FROM workspace_files WHERE id=$1 AND user_id=$2",[(req.params as {id:string}).id,await userId(req)])).rows[0];
    if(!file) return reply.code(404).send({error:"Документ не найден."});
    return reply.type("application/octet-stream").header("Content-Disposition",`attachment; filename*=UTF-8''${encodeURIComponent(file.name)}`).send(Buffer.from(file.content));
  });
}
