import {z} from 'zod';
import {WbError} from './wb-model.ts';
import type {Database,Queries} from './database.ts';
export const ozonCredentials=z.object({clientId:z.string().trim().regex(/^\d{1,30}$/).transform(v=>BigInt(v).toString()).refine(v=>BigInt(v)>0n),apiKey:z.string().trim().min(20).max(2000).refine(v=>!/[\r\n]/.test(v))});
export type OzonCredentials=z.infer<typeof ozonCredentials>;
export type OzonWarehouse={id:string;name:string};
const identifier=z.union([z.string().regex(/^\d+$/),z.number().int().nonnegative().transform(String)]);
const product=z.object({sku:identifier,offer_id:z.string().optional().default(''),name:z.string().optional().default(''),quantity:z.number().int().nonnegative()});
const posting=z.object({posting_number:z.string().min(1),order_number:z.string().optional().default(''),status:z.string().min(1),substatus:z.string().optional(),is_multibox:z.boolean().optional(),multi_box_qty:z.number().optional(),products:z.array(product),requirements:z.object({products_requiring_mandatory_mark:z.array(identifier).optional()}).nullish(),optional:z.object({products_with_possible_mandatory_mark:z.array(identifier).optional()}).nullish(),delivery_method:z.object({warehouse_id:identifier,warehouse:z.string().optional()}),in_process_at:z.string().refine(v=>Number.isFinite(Date.parse(v))),shipment_date:z.string().nullable().optional(),scanit:z.string().nullable().optional(),delivery_schema:z.string().optional()});
export type OzonPosting=z.infer<typeof posting>;
export type OzonMarking={sku:string;required:boolean|null;tnved:string|null;barcodes:string[];checkedAt:number};
const ozonMark=z.object({mark:z.string(),mark_type:z.string()});
const ozonExemplar=z.object({exemplar_id:identifier,is_mandatory_mark_needed:z.boolean().optional(),gtd:z.string().nullable().optional(),is_gtd_absent:z.boolean().optional(),is_rnpt_absent:z.boolean().optional(),marks:z.array(ozonMark),rnpt:z.string().nullable().optional(),weight:z.number().optional()});
export const ozonExemplars=z.object({posting_number:z.string(),multi_box_qty:z.number().int().nonnegative().optional(),products:z.array(z.object({product_id:identifier,quantity:z.number().int().nonnegative(),is_mandatory_mark_needed:z.boolean(),is_mandatory_mark_possible:z.boolean(),exemplars:z.array(ozonExemplar)}))});
export type OzonExemplars=z.infer<typeof ozonExemplars>;
const ozonStatus=z.object({posting_number:z.string(),status:z.string(),products:z.array(z.object({product_id:identifier,exemplars:z.array(z.object({exemplar_id:identifier,marks:z.array(ozonMark.extend({check_status:z.string(),error_codes:z.array(z.string())}))}))}))});
export type OzonStatus=z.infer<typeof ozonStatus>;
export type OzonLabelTask={task_id:string;task_type:string};
export type OzonLabelFile={file_url?:string;error?:{code:string;message:string}|null;status:{code:string;postings_count:number;printed_postings_count:number;unprinted_postings:{message:string;posting_number:string}[]}};
export type OzonCatalogProduct={productId:string;sku:string;skus:string[];title:string;article:string;barcodes:string[]};
export type OzonStockLevel={productId:string;sku:string;warehouse:string;present:number;reserved:number;available:number};
export type OzonClient={stockWriteAllowed?:(c:OzonCredentials)=>Promise<boolean>;writeStocks?:(c:OzonCredentials,warehouse:string,items:{productId:string;amount:number}[])=>Promise<{productId:string;warehouse:string;updated:boolean;errors:{code:string;message:string}[]}[]>;catalog?:(c:OzonCredentials)=>Promise<OzonCatalogProduct[]>;stockLevels?:(c:OzonCredentials,products:OzonCatalogProduct[])=>Promise<OzonStockLevel[]>;labelTasks:(c:OzonCredentials,number:string)=>Promise<OzonLabelTask[]>;labelFile:(c:OzonCredentials,taskId:string)=>Promise<OzonLabelFile>;downloadLabel:(url:string)=>Promise<Buffer>;ship:(c:OzonCredentials,p:OzonPosting)=>Promise<string[]>;posting:(c:OzonCredentials,number:string)=>Promise<OzonPosting>;exemplars:(c:OzonCredentials,number:string)=>Promise<OzonExemplars>;setExemplars:(c:OzonCredentials,data:OzonExemplars)=>Promise<void>;exemplarStatus:(c:OzonCredentials,number:string)=>Promise<OzonStatus>;marking:(c:OzonCredentials,skus:string[])=>Promise<OzonMarking[]>;seller:(c:OzonCredentials)=>Promise<{sid:string;name:string}>;warehouses:(c:OzonCredentials)=>Promise<OzonWarehouse[]>;postings:(c:OzonCredentials,range:{since:string;to:string;changedSince?:string})=>Promise<OzonPosting[]>};
export class OzonError extends WbError{constructor(status:number,retry=60){super(status,retry);this.name='OzonError';this.message='Ozon HTTP '+status;}}
export function parseOzonJson(text:string):unknown{
 const parse=JSON.parse as (t:string,r:(k:string,v:any,c?:{source?:string})=>any)=>unknown;
 return parse(text,(_k,v,c)=>{if(typeof v==='number'&&Number.isInteger(v)&&!Number.isSafeInteger(v)){if(!c?.source||!/^\d+$/.test(c.source))throw Error('Invalid Ozon integer');return c.source;}return v;});
}
export type OzonTransport=(c:OzonCredentials,path:string,body:unknown)=>Promise<unknown>;
const tails=new Map<string,Promise<unknown>>();
const transport:OzonTransport=(credentials,path,body)=>{
 const previous=tails.get(credentials.clientId)||Promise.resolve();let pause=1000;
 const task=previous.catch(()=>{}).then(async()=>{
  const r=await fetch('https://api-seller.ozon.ru'+path,{method:'POST',headers:{'Client-Id':credentials.clientId,'Api-Key':credentials.apiKey,'Content-Type':'application/json'},body:JSON.stringify(body),redirect:'error',signal:AbortSignal.timeout(20000)});
  if(!r.ok){const value=Number(r.headers.get('Retry-After')||60),retry=Number.isFinite(value)?Math.max(1,value):60;if(r.status===429)pause=retry*1000;throw new OzonError(r.status,retry);}
  return parseOzonJson(await r.text());
 });
 const settled=task.catch(()=>{}).then(()=>new Promise(r=>setTimeout(r,pause)));tails.set(credentials.clientId,settled);void settled.then(()=>{if(tails.get(credentials.clientId)===settled)tails.delete(credentials.clientId);});return task;
};
export class OzonLabelSourceError extends Error{}
export async function downloadOzonLabel(url:string){
 const u=new URL(url);if(u.protocol!=='https:'||u.username||u.password||u.port&&u.port!=='443'||!['ozone.ru','ozon.ru'].some(host=>u.hostname===host||u.hostname.endsWith('.'+host)))throw new OzonLabelSourceError('Untrusted Ozon label URL');
 const r=await fetch(u,{redirect:'error',signal:AbortSignal.timeout(20000)});if(!r.ok)throw Error('Ozon label download failed');
 const max=16*1024*1024;if(Number(r.headers.get('content-length')||0)>max)throw new OzonLabelSourceError('Ozon PDF too large');
 const reader=r.body?.getReader();if(!reader)throw new OzonLabelSourceError('Missing label PDF');const parts:Uint8Array[]=[];let bytes=0;
 try{for(;;){const part=await reader.read();if(part.done)break;bytes+=part.value.length;if(bytes>max)throw new OzonLabelSourceError('Ozon PDF too large');parts.push(part.value);}}finally{await reader.cancel().catch(()=>{});}
 const file=Buffer.concat(parts);if(file.subarray(0,5).toString()!=='%PDF-')throw new OzonLabelSourceError('Invalid label PDF');return file;
}
export function createOzonClient(call:OzonTransport=transport,download:(url:string)=>Promise<Buffer>=downloadOzonLabel):OzonClient{return {
 downloadLabel:download,
 async stockWriteAllowed(c){const d=z.object({roles:z.array(z.object({methods:z.array(z.string())}))}).parse(await call(c,'/v1/roles',{}));return d.roles.some(r=>r.methods.includes('/v2/products/stocks'));},
 async writeStocks(c,warehouse,items){const integer=(v:string)=>Number.isSafeInteger(Number(v))?Number(v):(JSON as any).rawJSON(v);const d=z.object({result:z.array(z.object({product_id:identifier,warehouse_id:identifier,updated:z.boolean(),errors:z.array(z.object({code:z.string(),message:z.string()}))}))}).parse(await call(c,'/v2/products/stocks',{stocks:items.map(i=>({product_id:integer(i.productId),warehouse_id:integer(warehouse),stock:i.amount}))}));if(d.result.length!==items.length||new Set(d.result.map(r=>r.product_id)).size!==items.length||d.result.some(r=>r.warehouse_id!==warehouse||!items.some(i=>i.productId===r.product_id)))throw Error('Incomplete Ozon stock update response');return d.result.map(r=>({productId:r.product_id,warehouse:r.warehouse_id,updated:r.updated,errors:r.errors}));},
 async catalog(c){
  const ids:string[]=[],seen=new Set<string>(),cursors=new Set<string>();let last='',expected:number|undefined;
  for(let page=0;page<10000;page++){
   const data=z.object({result:z.object({items:z.array(z.object({product_id:identifier})),total:z.number().int().nonnegative(),last_id:z.string().default('')})}).parse(await call(c,'/v3/product/list',{filter:{visibility:'ALL'},last_id:last,limit:1000})).result;
   if(expected!==undefined&&expected!==data.total)throw Error('Ozon catalog changed during pagination');expected=data.total;
   for(const p of data.items){if(seen.has(p.product_id))throw Error('Duplicate Ozon catalog product');seen.add(p.product_id);ids.push(p.product_id);}
   if(ids.length===expected)break;
   if(ids.length>expected||!data.items.length||!data.last_id||cursors.has(data.last_id)||page===9999)throw Error('Incomplete Ozon catalog');cursors.add(data.last_id);last=data.last_id;
  }
  const rows:OzonCatalogProduct[]=[],aliases=new Map<string,string>();const integer=(v:string)=>Number.isSafeInteger(Number(v))?Number(v):(JSON as any).rawJSON(v);
  for(let start=0;start<ids.length;start+=1000){const batch=ids.slice(start,start+1000),returned=new Set<string>();
   const data=z.object({items:z.array(z.object({id:identifier,sku:identifier,name:z.string(),offer_id:z.string(),barcodes:z.array(z.string()).default([]),sources:z.array(z.object({sku:identifier})).default([])}))}).parse(await call(c,'/v3/product/info/list',{product_id:batch.map(integer)}));
   for(const p of data.items){if(!batch.includes(p.id)||returned.has(p.id))throw Error('Unexpected Ozon catalog details');returned.add(p.id);const skus=[...new Set([p.sku,...p.sources.map(x=>x.sku)])].filter(s=>s!=='0');if(!skus.length)throw Error('Missing Ozon SKU');for(const sku of skus){if(aliases.has(sku)&&aliases.get(sku)!==p.id)throw Error('Ambiguous Ozon SKU');aliases.set(sku,p.id);}rows.push({productId:p.id,sku:p.sku,skus,title:p.name||p.offer_id,article:p.offer_id,barcodes:[...new Set(p.barcodes)]});}
   if(returned.size!==batch.length)throw Error('Incomplete Ozon product details');
  }return rows;
 },
 async stockLevels(c,products){
  const rows:OzonStockLevel[]=[],seen=new Set<string>();const integer=(v:string)=>Number.isSafeInteger(Number(v))?Number(v):(JSON as any).rawJSON(v);
  for(let start=0;start<products.length;start+=100){const batch=products.slice(start,start+100),skus=[...new Set(batch.flatMap(p=>p.skus))];let cursor='';const cursors=new Set<string>();
   for(let page=0;page<10000;page++){
    const data=z.object({products:z.array(z.object({product_id:identifier,sku:identifier,warehouse_id:identifier,present:z.number().int().nonnegative(),reserved:z.number().int().nonnegative(),free_stock:z.number().int().nonnegative()})),has_next:z.boolean(),cursor:z.string().default('')}).parse(await call(c,'/v2/product/info/stocks-by-warehouse/fbs',{sku:skus.map(integer),limit:1000,cursor}));
    for(const p of data.products){if(!batch.some(b=>b.productId===p.product_id&&b.skus.includes(p.sku)))throw Error('Unexpected Ozon warehouse product');const key=p.product_id+':'+p.warehouse_id;if(seen.has(key))throw Error('Duplicate Ozon warehouse stock');seen.add(key);rows.push({productId:p.product_id,sku:p.sku,warehouse:p.warehouse_id,present:p.present,reserved:p.reserved,available:p.free_stock});}
    if(!data.has_next)break;if(!data.products.length||!data.cursor||cursors.has(data.cursor)||page===9999)throw Error('Incomplete Ozon warehouse stocks');cursors.add(data.cursor);cursor=data.cursor;
   }
  }return rows;
 },
 async labelTasks(c,number){const d=z.object({tasks:z.array(z.object({task_id:identifier,task_type:z.string()})).min(1)}).parse(await call(c,'/v3/posting/fbs/package-label/create',{posting_numbers:[number]}));if(new Set(d.tasks.map(t=>t.task_id)).size!==d.tasks.length)throw Error('Duplicate Ozon label task');return d.tasks;},
 async labelFile(c,taskId){const value=Number.isSafeInteger(Number(taskId))?Number(taskId):(JSON as any).rawJSON(taskId);return z.object({file_url:z.string().nullish().transform(v=>v||undefined),error:z.object({code:z.string().optional().default(''),message:z.string().optional().default('')}).nullable().optional(),status:z.object({code:z.string(),postings_count:z.number().int().nonnegative().optional().default(0),printed_postings_count:z.number().int().nonnegative().optional().default(0),unprinted_postings:z.array(z.object({message:z.string(),posting_number:z.string()})).optional().default([])})}).parse(await call(c,'/v2/posting/fbs/package-label/get',{task_id:value}));},
 async ship(c,p){const integer=(v:string)=>Number.isSafeInteger(Number(v))?Number(v):(JSON as any).rawJSON(v);const data=z.object({result:z.array(z.string().min(1)).min(1)}).parse(await call(c,'/v4/posting/fbs/ship',{posting_number:p.posting_number,packages:[{products:p.products.map(item=>({product_id:integer(item.sku),quantity:item.quantity}))}]}));return data.result;},
 async posting(c,number){const data=z.object({result:posting}).parse(await call(c,'/v3/posting/fbs/get',{posting_number:number,with:{analytics_data:false,financial_data:false,legal_info:false,barcodes:false,product_exemplars:false}}));if(data.result.posting_number!==number)throw Error('Ozon posting mismatch');return data.result;},
 async exemplars(c,number){const data=ozonExemplars.parse(await call(c,'/v6/fbs/posting/product/exemplar/create-or-get',{posting_number:number}));if(data.posting_number!==number)throw Error('Ozon exemplar mismatch');return data;},
 async setExemplars(c,data){const integer=(v:string)=>Number.isSafeInteger(Number(v))?Number(v):(JSON as any).rawJSON(v);
  const products=data.products.map(p=>({product_id:integer(p.product_id),exemplars:p.exemplars.map(e=>({...e,exemplar_id:integer(e.exemplar_id),...(e.gtd===null?{gtd:undefined}:{}),...(e.rnpt===null?{rnpt:undefined}:{})}))}));
  await call(c,'/v6/fbs/posting/product/exemplar/set',{posting_number:data.posting_number,...(data.multi_box_qty===undefined?{}:{multi_box_qty:data.multi_box_qty}),products});
 },
 async exemplarStatus(c,number){const data=ozonStatus.parse(await call(c,'/v5/fbs/posting/product/exemplar/status',{posting_number:number}));if(data.posting_number!==number)throw Error('Ozon status mismatch');const products=new Set<string>(),ids=new Set<string>();for(const p of data.products){if(products.has(p.product_id))throw Error('Duplicate Ozon status product');products.add(p.product_id);for(const e of p.exemplars){if(ids.has(e.exemplar_id)||new Set(e.marks.map(m=>m.mark)).size!==e.marks.length)throw Error('Duplicate Ozon status exemplar or mark');ids.add(e.exemplar_id);}}return data;},
 async marking(c,skus){
  const rows:OzonMarking[]=[];
  for(let offset=0;offset<skus.length;offset+=100){
   const batch=skus.slice(offset,offset+100),seen=new Set<string>(),cursors=new Set<string>();let last='';let total:number|undefined;
   for(let page=0;page<1000;page++){
    const data=z.object({result:z.array(z.object({sku:identifier,barcode:z.string().optional(),barcodes:z.array(z.string()).optional(),attributes:z.array(z.object({id:identifier,values:z.array(z.object({value:z.union([z.string(),z.boolean()])}))}))})),total:identifier,last_id:z.string().optional().default('')}).parse(await call(c,'/v4/product/info/attributes',{filter:{sku:batch,visibility:'ALL'},limit:100,last_id:last,sort_dir:'ASC'}));
    const count=Number(data.total);if(!Number.isSafeInteger(count)||count<0||count>batch.length||(total!==undefined&&total!==count))throw Error('Invalid Ozon attribute total');total=count;
    for(const item of data.result){if(!batch.includes(item.sku)||seen.has(item.sku))throw Error('Unexpected Ozon attribute SKU');seen.add(item.sku);
     const values=item.attributes.filter(a=>a.id==='23536').flatMap(a=>a.values.map(v=>typeof v.value==='boolean'?String(v.value):v.value.trim().toLowerCase()));
     const required=values.length>0&&values.every(v=>v==='true')?true:values.length>0&&values.every(v=>v==='false')?false:null;
     const codes=[...new Set(item.attributes.filter(a=>a.id==='22232').flatMap(a=>a.values.map(v=>String(v.value).trim().match(/^\d{10}(?=\D|$)/)?.[0]||'')).filter(Boolean))];
     rows.push({sku:item.sku,required,tnved:codes.length===1?codes[0]:null,barcodes:[...new Set([...(item.barcodes||[]),...(item.barcode?[item.barcode]:[])])],checkedAt:Date.now()});
    }
    if(seen.size===total){for(const sku of batch)if(!seen.has(sku))rows.push({sku,required:null,tnved:null,barcodes:[],checkedAt:Date.now()});break;}
    if(!data.result.length||!data.last_id||cursors.has(data.last_id)||page===999)throw Error('Incomplete Ozon attributes');cursors.add(data.last_id);last=data.last_id;
   }
  }return rows;
 },
 async seller(c){try{const data=z.object({company:z.object({name:z.string().optional(),legal_name:z.string().optional()})}).parse(await call(c,'/v1/seller/info',{}));return {sid:c.clientId,name:data.company.name||data.company.legal_name||'Ozon · '+c.clientId};}catch(error){if(error instanceof OzonError&&error.status===403)return {sid:c.clientId,name:'Ozon · '+c.clientId};throw error;}},
 async warehouses(c){const rows:OzonWarehouse[]=[];let cursor='';const seen=new Set<string>(),cursors=new Set<string>();
  for(let page=0;page<1000;page++){
   const data=z.object({warehouses:z.array(z.object({warehouse_id:identifier,name:z.string(),is_rfbs:z.boolean()})),cursor:z.string().optional().default(''),has_next:z.boolean()}).parse(await call(c,'/v2/warehouse/list',{limit:200,cursor}));
   for(const w of data.warehouses)if(!w.is_rfbs){if(seen.has(w.warehouse_id))throw Error('Duplicate Ozon warehouse');seen.add(w.warehouse_id);rows.push({id:w.warehouse_id,name:w.name||w.warehouse_id});}
   if(!data.has_next)return rows;if(!data.cursor||cursors.has(data.cursor))throw Error('Ozon warehouse cursor did not advance');cursors.add(data.cursor);cursor=data.cursor;
  }throw Error('Ozon warehouse pagination limit');
 },
 async postings(c,range){const rows:OzonPosting[]=[];let cursor='';const seen=new Set<string>(),cursors=new Set<string>();
  for(let page=0;page<10000;page++){
   const data=z.object({postings:z.array(posting),cursor:z.string().optional().default(''),has_next:z.boolean()}).parse(await call(c,'/v4/posting/fbs/list',{limit:100,cursor,sort_dir:'DESC',filter:{since:range.since,to:range.to,...(range.changedSince?{last_changed_status_date:{from:range.changedSince,to:range.to}}:{})},with:{barcodes:false,analytics_data:false,financial_data:false,legal_info:false}}));
   for(const row of data.postings){if(row.delivery_schema&&row.delivery_schema.toLowerCase()!=='fbs')continue;if(seen.has(row.posting_number))throw Error('Duplicate Ozon posting');seen.add(row.posting_number);rows.push(row);}
   if(!data.has_next)return rows;if(!data.cursor||cursors.has(data.cursor))throw Error('Ozon posting cursor did not advance');cursors.add(data.cursor);cursor=data.cursor;
  }throw Error('Ozon posting pagination limit');
 }
};}
export const ozonClient=createOzonClient();
export async function initOzon(db:Database){await db.exec(`CREATE TABLE IF NOT EXISTS ozon_postings(
 store_id text NOT NULL REFERENCES stores(id),posting_number text NOT NULL,order_number text NOT NULL,status text NOT NULL,
 products jsonb NOT NULL,warehouse_id text NOT NULL,created_at text NOT NULL,shipment_date text,scanit text,updated_at bigint NOT NULL,
 PRIMARY KEY(store_id,posting_number));CREATE TABLE IF NOT EXISTS ozon_product_marking(store_id text NOT NULL REFERENCES stores(id),sku text NOT NULL,required boolean,tnved text,checked_at bigint NOT NULL,PRIMARY KEY(store_id,sku));ALTER TABLE ozon_product_marking ADD COLUMN IF NOT EXISTS tnved text;ALTER TABLE ozon_product_marking ADD COLUMN IF NOT EXISTS barcodes jsonb NOT NULL DEFAULT '[]'::jsonb;ALTER TABLE ozon_postings ADD COLUMN IF NOT EXISTS stock_shipped_at timestamptz;ALTER TABLE ozon_postings ADD COLUMN IF NOT EXISTS assembled_at bigint;ALTER TABLE ozon_postings ADD COLUMN IF NOT EXISTS marks_purged_at bigint;CREATE INDEX IF NOT EXISTS ozon_postings_mark_retention ON ozon_postings(assembled_at) WHERE marks_purged_at IS NULL;CREATE INDEX IF NOT EXISTS ozon_postings_warehouse ON ozon_postings(store_id,warehouse_id,created_at);`);}
export async function saveOzon(tx:Queries,id:string,warehouses:OzonWarehouse[],postings:OzonPosting[]){
 await tx.query('DELETE FROM store_warehouses WHERE store_id=$1',[id]);
 for(const w of warehouses)await tx.query('INSERT INTO store_warehouses(store_id,id,name) VALUES($1,$2,$3)',[id,w.id,w.name]);
 for(const p of postings)await tx.query(`INSERT INTO ozon_postings(store_id,posting_number,order_number,status,products,warehouse_id,created_at,shipment_date,scanit,updated_at,assembled_at,stock_shipped_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,CASE WHEN $4 IN ('awaiting_deliver','delivering','delivered') THEN $10::bigint ELSE NULL END,CASE WHEN $4 IN ('delivering','delivered') THEN now() ELSE NULL END)
 ON CONFLICT(store_id,posting_number) DO UPDATE SET order_number=EXCLUDED.order_number,status=EXCLUDED.status,products=EXCLUDED.products,warehouse_id=EXCLUDED.warehouse_id,created_at=EXCLUDED.created_at,shipment_date=EXCLUDED.shipment_date,scanit=EXCLUDED.scanit,updated_at=EXCLUDED.updated_at,assembled_at=COALESCE(ozon_postings.assembled_at,EXCLUDED.assembled_at),stock_shipped_at=CASE WHEN EXCLUDED.status IN ('delivering','delivered') THEN COALESCE(ozon_postings.stock_shipped_at,now()) ELSE ozon_postings.stock_shipped_at END`,[id,p.posting_number,p.order_number,p.status,JSON.stringify(p.products),p.delivery_method.warehouse_id,p.in_process_at,p.shipment_date||null,p.scanit||null,Date.now()]);
}

export async function saveOzonMarking(tx:Queries,id:string,rows:OzonMarking[]){for(const row of rows)await tx.query(`INSERT INTO ozon_product_marking(store_id,sku,required,checked_at,tnved,barcodes) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(store_id,sku) DO UPDATE SET required=EXCLUDED.required,checked_at=EXCLUDED.checked_at,tnved=EXCLUDED.tnved,barcodes=EXCLUDED.barcodes`,[id,row.sku,row.required,row.checkedAt,row.tnved,JSON.stringify(row.barcodes)]);}
