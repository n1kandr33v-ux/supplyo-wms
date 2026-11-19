import type {FastifyInstance} from 'fastify';
import type {Database} from './database.ts';
import type {Access} from './access.ts';
import {ozonCredentials,OzonError,OzonLabelSourceError,type OzonClient} from './ozon.ts';
import {OzonAssemblyError} from './ozon-assembly.ts';
import {renderOzonPdf,type PrintSticker} from './ozon-pdf.ts';
import {unseal} from './security.ts';
import {randomUUID} from 'node:crypto';
import {z} from 'zod';
export async function registerOzonLabels(app:FastifyInstance,db:Database,key:Buffer,userId:(r:any)=>Promise<string|null>,access:Access,ozon:OzonClient,render:(pdf:Buffer)=>Promise<PrintSticker[]>=renderOzonPdf){
 await db.exec(`CREATE TABLE IF NOT EXISTS ozon_label_files(store_id text NOT NULL REFERENCES stores(id),posting_number text NOT NULL,state text NOT NULL,task_id text,task_type text,stickers jsonb,next_at bigint NOT NULL,updated_at bigint NOT NULL,error text,PRIMARY KEY(store_id,posting_number));
 CREATE INDEX IF NOT EXISTS ozon_label_files_pending ON ozon_label_files(next_at) WHERE state NOT IN ('ready','error');
 CREATE TABLE IF NOT EXISTS ozon_print_jobs(id text PRIMARY KEY,store_id text NOT NULL REFERENCES stores(id),posting_number text NOT NULL,request_id text NOT NULL,device_id text NOT NULL,printer text NOT NULL,completed_at bigint,created_at bigint NOT NULL,UNIQUE(store_id,request_id));
 CREATE UNIQUE INDEX IF NOT EXISTS ozon_print_jobs_pending ON ozon_print_jobs(store_id,posting_number) WHERE completed_at IS NULL;`);
 const active=new Set<string>();const preparations=new Map<string,Promise<void>>();let running=false,closing=false;
 async function prepareLock(id:string){const previous=preparations.get(id)||Promise.resolve();let release!:()=>void;const current=new Promise<void>(resolve=>{release=resolve});preparations.set(id,current);await previous;return ()=>{release();if(preparations.get(id)===current)preparations.delete(id)};}
 async function allowed(req:any,reply:any){const uid=await userId(req),s=await access.resolve(uid,req.params.id);if(!s||s.marketplace!=='ozon'){reply.code(404).send({error:'Магазин Ozon не найден.'});return;}
 if(!s.employee&&!(await db.query('SELECT 1 FROM subscriptions WHERE user_id=$1 AND expires>$2 AND cabinet_limit>0',[uid,Date.now()])).rows.length){reply.code(403).send({error:'Для печати подключите подписку.'});return;}
 if(s.permissions&&!s.permissions.includes('assembly')){reply.code(403).send({error:'Нет права печати этикеток.'});return;}return {...s,actor:uid!};}
 async function validPosting(s:any,number:string){const row=(await db.query<any>("SELECT * FROM ozon_postings WHERE store_id=$1 AND posting_number=$2 AND ($3='' OR warehouse_id=$3)",[s.id,number,s.scope||''])).rows[0];if(!row)throw new OzonAssemblyError('Отправление не найдено.');return row;}
 const credentials=(s:any)=>ozonCredentials.parse(JSON.parse(unseal(s.credential,key)));
 async function limited(s:any,fn:()=>Promise<any>){const pause=(await db.query<any>('SELECT api_retry_after FROM stores WHERE id=$1',[s.id])).rows[0];if(pause?.api_retry_after>Date.now())throw new OzonAssemblyError('Ozon ограничил запросы. Повторите после завершения паузы.');try{return await fn();}catch(e){if(e instanceof OzonError&&e.status===429)await db.query('UPDATE stores SET api_retry_after=GREATEST(api_retry_after,$2),next_sync=GREATEST(next_sync,$2) WHERE id=$1',[s.id,Date.now()+e.retrySeconds*1000]);throw e;}}
 app.post('/api/stores/:id/ozon/labels/prepare',async(req,reply)=>{
  const s=await allowed(req,reply);if(!s)return;
  const b=z.object({posting:z.string().min(1).max(100),requestId:z.string().uuid(),deviceId:z.string().uuid(),printer:z.string().trim().min(1).max(300),reprint:z.boolean().default(false)}).parse(req.body);
  const unlock=await prepareLock(s.id);
  try{
   const local=await validPosting(s,b.posting);if(['cancelled','canceled','returned'].includes(local.status))throw new OzonAssemblyError('Отправление отменено или возвращено. Печать недоступна.');const old=(await db.query<any>('SELECT * FROM ozon_print_jobs WHERE store_id=$1 AND request_id=$2',[s.id,b.requestId])).rows[0];
   if(old){if(old.device_id!==b.deviceId||old.posting_number!==b.posting||old.printer!==b.printer)throw new OzonAssemblyError('Это задание связано с другим принтером или компьютером.');if(!old.completed_at)await db.query("UPDATE ozon_label_files SET state='queued',task_id=NULL,task_type=NULL,next_at=$3,error=NULL WHERE store_id=$1 AND posting_number=$2 AND state='error'",[s.id,b.posting,Date.now()]);return {jobId:old.id};}
   const pending=(await db.query<any>('SELECT * FROM ozon_print_jobs WHERE store_id=$1 AND posting_number=$2 AND completed_at IS NULL',[s.id,b.posting])).rows[0];
   if(pending){if(pending.device_id!==b.deviceId||pending.printer!==b.printer)throw new OzonAssemblyError('Незавершённая печать этого отправления закреплена за другим компьютером или принтером. Завершите её там.');await db.query("UPDATE ozon_label_files SET state='queued',task_id=NULL,task_type=NULL,next_at=$3,error=NULL WHERE store_id=$1 AND posting_number=$2 AND state='error'",[s.id,b.posting,Date.now()]);return {jobId:pending.id};}
   if(!b.reprint&&(await db.query('SELECT id FROM ozon_print_jobs WHERE store_id=$1 AND posting_number=$2 AND completed_at IS NOT NULL',[s.id,b.posting])).rows.length)return {alreadyPrinted:true};
   const file=(await db.query<any>('SELECT * FROM ozon_label_files WHERE store_id=$1 AND posting_number=$2',[s.id,b.posting])).rows[0];
   const remote=await limited(s,()=>ozon.posting(credentials(s),b.posting));
   if(remote.delivery_method.warehouse_id!==local.warehouse_id)throw new OzonAssemblyError('Склад отправления изменился.');
   if(remote.status!=='awaiting_deliver'&&!(file?.state==='ready'&&b.reprint&&['delivering','delivered'].includes(remote.status)))throw new OzonAssemblyError('Этикетка доступна после завершения сборки в Ozon.');
   await db.query('UPDATE ozon_postings SET status=$3 WHERE store_id=$1 AND posting_number=$2',[s.id,b.posting,remote.status]);
   const again=await access.resolve(s.actor,(req.params as any).id);if(!again||again.credential!==s.credential||again.permissions&&!again.permissions.includes('assembly'))throw new OzonAssemblyError('Доступ к печати изменился.');
   const next=Date.now(),id=randomUUID();
   await db.transaction(async tx=>{
    await tx.query("INSERT INTO ozon_label_files(store_id,posting_number,state,next_at,updated_at) VALUES($1,$2,'queued',$3,$4) ON CONFLICT(store_id,posting_number) DO UPDATE SET state=CASE WHEN ozon_label_files.state='error' THEN CASE WHEN ozon_label_files.task_id IS NULL THEN 'queued' ELSE 'polling' END ELSE ozon_label_files.state END,error=NULL",[s.id,b.posting,next,Date.now()]);
    await tx.query('INSERT INTO ozon_print_jobs(id,store_id,posting_number,request_id,device_id,printer,created_at) VALUES($1,$2,$3,$4,$5,$6,$7)',[id,s.id,b.posting,b.requestId,b.deviceId,b.printer,Date.now()]);
   });return {jobId:id};
  }finally{unlock();}
 });
 async function getJob(req:any,reply:any){const s=await allowed(req,reply);if(!s)return;
  const device=z.string().uuid().parse((req.query as any).deviceId??(req.body as any)?.deviceId);
  const job=(await db.query<any>('SELECT * FROM ozon_print_jobs WHERE store_id=$1 AND id=$2 AND device_id=$3',[s.id,req.params.job,device])).rows[0];if(!job){reply.code(404).send({error:'Задание печати не найдено на этом компьютере.'});return;}await validPosting(s,job.posting_number);return {s,job};
 }
 app.get('/api/stores/:id/ozon/labels/:job',async(req,reply)=>{const context=await getJob(req,reply);if(!context)return;const {s,job}=context;const posting=await validPosting(s,job.posting_number);if(['cancelled','canceled','returned'].includes(posting.status))throw new OzonAssemblyError('Отправление отменено или возвращено. Печать недоступна.');const file=(await db.query<any>('SELECT * FROM ozon_label_files WHERE store_id=$1 AND posting_number=$2',[s.id,job.posting_number])).rows[0];return {jobId:job.id,printer:job.printer,completed:!!job.completed_at,state:file?.state||'queued',error:file?.error||null,...(file?.state==='ready'?{stickers:file.stickers}:{})};});
 app.post('/api/stores/:id/ozon/labels/:job/printed',async(req,reply)=>{const context=await getJob(req,reply);if(!context)return;const {s,job}=context;
  if(!(await db.query("SELECT 1 FROM ozon_label_files WHERE store_id=$1 AND posting_number=$2 AND state='ready'",[s.id,job.posting_number])).rows.length)throw new OzonAssemblyError('Этикетка ещё не подготовлена.');
  await db.query('UPDATE ozon_print_jobs SET completed_at=COALESCE(completed_at,$2) WHERE id=$1',[job.id,Date.now()]);return {ok:true};
 });
 app.get('/api/stores/:id/ozon/label-receipts',async(req,reply)=>{const s=await allowed(req,reply);if(!s)return;const rows=(await db.query<any>("SELECT p.posting_number,COALESCE(max(j.completed_at),0) AS printed_at FROM ozon_postings p LEFT JOIN ozon_print_jobs j ON j.store_id=p.store_id AND j.posting_number=p.posting_number WHERE p.store_id=$1 AND ($2='' OR p.warehouse_id=$2) AND p.status IN ('awaiting_deliver','delivering','delivered') GROUP BY p.posting_number",[s.id,s.scope||''])).rows;return {receipts:rows};});
 async function tick(){if(running||closing)return;running=true;try{
  const task=(await db.query<any>(`SELECT f.*,s.credential FROM ozon_label_files f JOIN stores s ON s.id=f.store_id WHERE f.state NOT IN ('ready','error') AND f.next_at<=$1 AND s.status<>'removed' AND s.marketplace='ozon' AND s.api_retry_after<=$1 AND EXISTS(SELECT 1 FROM subscriptions sub WHERE sub.expires>$1 AND sub.cabinet_limit>0 AND (sub.user_id=s.user_id OR EXISTS(SELECT 1 FROM client_access a WHERE a.store_id=s.id AND a.fulfillment_id=sub.user_id AND a.revoked IS NULL))) ORDER BY f.next_at LIMIT 1`,[Date.now()])).rows[0];
  if(!task||active.has(task.store_id))return;active.add(task.store_id);
  try{
   const s={...task,id:task.store_id},now=Date.now();await db.query('UPDATE ozon_label_files SET next_at=$3 WHERE store_id=$1 AND posting_number=$2',[s.id,task.posting_number,now+2000]);
   if(!task.task_id){const tasks=await limited(s,()=>ozon.labelTasks(credentials(s),task.posting_number)),chosen=tasks.find((t:any)=>t.task_type==='small_label')||tasks.find((t:any)=>t.task_type==='big_label');if(!chosen)throw new OzonAssemblyError('Ozon не вернул задание этикетки поддерживаемого типа.');await db.query("UPDATE ozon_label_files SET task_id=$3,task_type=$4,state='polling',updated_at=$5 WHERE store_id=$1 AND posting_number=$2",[s.id,task.posting_number,chosen.task_id,chosen.task_type,now]);return;}
   const result=await limited(s,()=>ozon.labelFile(credentials(s),task.task_id));
   if(result.status.code==='error'||result.error?.code)throw new OzonAssemblyError('Ozon не сформировал этикетку. Повторите подготовку.');
   if(['pending','in_progress'].includes(result.status.code))return;
   if(result.status.code!=='completed'||result.status.postings_count!==1||result.status.printed_postings_count!==1||result.status.unprinted_postings.length||!result.file_url)throw new OzonAssemblyError('Ozon не подтвердил полный файл этикетки.');
   const pdf=await ozon.downloadLabel(result.file_url);let stickers:PrintSticker[];try{stickers=await render(pdf);}catch{throw new OzonAssemblyError('Не удалось преобразовать PDF этикетки Ozon для принтера. Повторите подготовку.');}
   if(!stickers.length)throw new OzonAssemblyError('Не удалось прочитать страницы этикетки.');
   await db.query("UPDATE ozon_label_files SET state='ready',stickers=$3,error=NULL,updated_at=$4 WHERE store_id=$1 AND posting_number=$2 AND EXISTS(SELECT 1 FROM stores s WHERE s.id=$1 AND s.status<>'removed' AND s.credential=$5)",[s.id,task.posting_number,JSON.stringify(stickers),Date.now(),task.credential]);
  }catch(e){const recentlyConfirmed=e instanceof OzonError&&e.status===400&&!task.task_id&&Date.now()-Number(task.updated_at)<60000;const pause=e instanceof OzonError&&e.status===429?e.retrySeconds*1000:recentlyConfirmed?2000:60000;
   const fatal=!recentlyConfirmed&&(e instanceof OzonAssemblyError||e instanceof OzonLabelSourceError||(e instanceof OzonError&&[400,403,404].includes(e.status)));
   await db.query("UPDATE ozon_label_files SET state=CASE WHEN $3 THEN 'error' ELSE state END,error=$4,next_at=$5 WHERE store_id=$1 AND posting_number=$2",[task.store_id,task.posting_number,fatal,e instanceof OzonAssemblyError?e.message:'Не удалось получить этикетку Ozon. Повторим автоматически.',Date.now()+pause]);
  }finally{active.delete(task.store_id);}
 }finally{running=false;}}
 return {tick,async close(){closing=true;while(running||active.size||preparations.size)await new Promise(r=>setTimeout(r,20));}};
}
