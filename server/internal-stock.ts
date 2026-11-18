import {registerInventoryCount} from './inventory-count.ts';
import type {FastifyInstance} from 'fastify';
import type {Database,Queries} from './database.ts';
import type {Access} from './access.ts';
import type {Employees} from './employees.ts';
import {randomUUID} from 'node:crypto';
import {z} from 'zod';

export const stockLocation=(store:string,warehouse:string)=>JSON.stringify(['store',store,warehouse]);
export class InternalStockError extends Error {constructor(message:string,public statusCode=409){super(message)}}
const fail=(message:string,statusCode=409)=>new InternalStockError(message,statusCode);
const product=z.object({title:z.string().trim().min(1).max(500),article:z.string().trim().max(200).default(''),barcodes:z.array(z.string().trim().min(1).max(100)).max(30).default([]),cell:z.string().trim().max(80).default(''),address:z.string().trim().max(160).default('')});
/** Separate from marketplace snapshots: catalog refresh must never replace physical quantities. */
export async function registerInternalStock(app:FastifyInstance,db:Database,userId:(req:any)=>Promise<string|null>,access:Access,employees:Employees,warehouses:(s:any)=>Promise<{id:string;name:string}[]>){
 await db.exec(`CREATE TABLE IF NOT EXISTS internal_stock_items(
  id text PRIMARY KEY,location text NOT NULL,source_id text NOT NULL,title text NOT NULL,article text NOT NULL,barcodes jsonb NOT NULL,cell text NOT NULL,address text NOT NULL,
  quantity integer NOT NULL,version integer NOT NULL DEFAULT 1,created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(location,source_id));
 CREATE TABLE IF NOT EXISTS internal_stock_movements(id text PRIMARY KEY,item_id text NOT NULL REFERENCES internal_stock_items(id),delta integer NOT NULL,balance integer NOT NULL,kind text NOT NULL,reference text NOT NULL,actor text,created_at timestamptz NOT NULL DEFAULT now());
 CREATE INDEX IF NOT EXISTS internal_stock_movements_item ON internal_stock_movements(item_id,created_at);
 CREATE TABLE IF NOT EXISTS internal_stock_shipments(marketplace text NOT NULL,store_id text NOT NULL,shipment text NOT NULL,PRIMARY KEY(marketplace,store_id,shipment));
 CREATE TABLE IF NOT EXISTS internal_stock_settings(id integer PRIMARY KEY);
 `);
 // One-time baseline: deploying inventory must not charge historical shipments.
 await db.transaction(async tx=>{
  const fresh=(await tx.query('INSERT INTO internal_stock_settings(id) VALUES(1) ON CONFLICT DO NOTHING RETURNING id')).rows.length;
  if(fresh){
   await tx.query("INSERT INTO internal_stock_shipments SELECT 'wb',store_id,id FROM fulfillment_supplies WHERE closed=true ON CONFLICT DO NOTHING");
   await tx.query("INSERT INTO internal_stock_shipments SELECT 'ozon',store_id,posting_number FROM ozon_postings WHERE status IN ('delivering','delivered') ON CONFLICT DO NOTHING");
  }
 });
 async function context(req:any,edit=false){
  const uid=await userId(req);if(!uid)throw fail('Войдите в аккаунт.',401);
  const q=z.object({store:z.string().max(1000).optional(),warehouse:z.string().min(1).max(150).optional(),physical:z.string().max(150).optional(),team:z.string().max(1000).optional()}).parse(req.query);
  const paid=(await db.query('SELECT 1 FROM subscriptions WHERE user_id=$1 AND expires>$2 AND cabinet_limit>0',[uid,Date.now()])).rows.length;
  if(q.store){
   const s=await access.resolve(uid,q.store);if(!s)throw fail('Магазин не найден или доступ отозван.',404);
   if((!paid&&!s.employee)||(s.permissions&&!s.permissions.includes(edit?'stocks':'view')))throw fail('Нет доступа к остаткам.',403);
   if(!q.warehouse||(s.scope?s.scope!==q.warehouse:!(await warehouses(s)).some(w=>w.id===q.warehouse)))throw fail('Нет доступа к этому складу.',403);
   return {uid,location:stockLocation(s.id,q.warehouse),store:s,warehouse:q.warehouse,canEdit:!s.permissions||s.permissions.includes('stocks')};
  }
  let owner=uid,allowed:any[]=[];
  if(q.team){const member=(await employees.memberships(uid)).find(m=>m.id===q.team);if(!member||!member.permissions.includes(edit?'stocks':'view'))throw fail('Нет доступа к складу.',403);owner=member.ownerId;allowed=[member.warehouse];}
  else {if(!paid)throw fail('Нужна подписка или доступ сотрудника.',403);allowed=(await db.query<any>("SELECT data FROM workspace_documents WHERE user_id=$1 AND kind='warehouses'",[uid])).rows[0]?.data||[];}
  if(!q.physical||!allowed.some(w=>w.id===q.physical))throw fail('Выберите доступный склад.',403);
  return {uid,location:JSON.stringify(['physical',owner,q.physical]),canEdit:!q.team||(await employees.memberships(uid)).find(m=>m.id===q.team)!.permissions.includes('stocks')};
 }
 await registerInventoryCount(app,db,context,()=>running??=(reconcile().finally(()=>{running=undefined})));
 async function debit(tx:Queries,store:string,warehouse:string,source:string,barcodes:string[],quantity:number,reference:string,at:string|null){
  const location=stockLocation(store,warehouse);
  let rows=(await tx.query<any>('SELECT * FROM internal_stock_items WHERE location=$1 AND source_id=$2 FOR UPDATE',[location,source])).rows;
  if(!rows.length&&barcodes.length){
   const candidates=(await tx.query<any>('SELECT chrt_id FROM inventory_items WHERE store_id=$1 AND warehouse_id=$2 AND barcodes ?| $3::text[]',[store,warehouse,barcodes])).rows;
   if(candidates.length===1)rows=(await tx.query<any>('SELECT * FROM internal_stock_items WHERE location=$1 AND source_id=$2 FOR UPDATE',[location,'wb:'+candidates[0].chrt_id])).rows;
  }
  // An ambiguous barcode must never debit an arbitrary size. Exact source IDs take priority.
  if(rows.length!==1)return;
  const item=rows[0];if(at&&new Date(at).getTime()<new Date(item.created_at).getTime())return;
  const balance=item.quantity-quantity;
  await tx.query('UPDATE internal_stock_items SET quantity=$2,version=version+1 WHERE id=$1',[item.id,balance]);
  await tx.query("INSERT INTO internal_stock_movements(id,item_id,delta,balance,kind,reference) VALUES($1,$2,$3,$4,'shipment',$5)",[randomUUID(),item.id,-quantity,balance,reference]);
 }
 async function reconcile(){
  await db.transaction(async tx=>{
   // Serialize reconciliation and manual corrections, also across processes.
   await tx.query('SELECT id FROM internal_stock_settings WHERE id=1 FOR UPDATE');
   const wb=(await tx.query<any>(`SELECT s.store_id,s.id,s.delivered_at FROM fulfillment_supplies s WHERE s.closed=true AND NOT EXISTS(SELECT 1 FROM internal_stock_shipments e WHERE e.marketplace='wb' AND e.store_id=s.store_id AND e.shipment=s.id) ORDER BY s.store_id,s.id LIMIT 100`)).rows;
   for(const s of wb){
    const items=(await tx.query<any>('SELECT id,snapshot FROM fulfillment_items WHERE store_id=$1 AND supply_id=$2 ORDER BY id',[s.store_id,s.id])).rows;
    for(const i of items){const snap=i.snapshot;await debit(tx,s.store_id,String(snap.warehouseId),'wb:'+String(snap.chrtId||''),snap.skus||[],1,'WB · '+s.id+' · '+i.id,s.delivered_at);}
    await tx.query("INSERT INTO internal_stock_shipments VALUES('wb',$1,$2)",[s.store_id,s.id]);
   }
   const oz=(await tx.query<any>(`SELECT p.store_id,p.posting_number,p.warehouse_id,p.products,p.stock_shipped_at FROM ozon_postings p WHERE (p.stock_shipped_at IS NOT NULL OR p.status IN ('delivering','delivered')) AND NOT EXISTS(SELECT 1 FROM internal_stock_shipments e WHERE e.marketplace='ozon' AND e.store_id=p.store_id AND e.shipment=p.posting_number) ORDER BY p.store_id,p.posting_number LIMIT 100`)).rows;
   for(const p of oz){for(const i of p.products){const canonical=(await tx.query<any>('SELECT sku FROM ozon_catalog WHERE store_id=$1 AND skus ? $2',[p.store_id,i.sku])).rows[0]?.sku||i.sku;const exact=(await tx.query('SELECT 1 FROM internal_stock_items WHERE location=$1 AND source_id=$2',[stockLocation(p.store_id,p.warehouse_id),'ozon:'+i.sku])).rows.length;await debit(tx,p.store_id,p.warehouse_id,'ozon:'+(exact?i.sku:canonical),[],i.quantity,'Ozon · '+p.posting_number,p.stock_shipped_at||new Date().toISOString());}await tx.query("INSERT INTO internal_stock_shipments VALUES('ozon',$1,$2)",[p.store_id,p.posting_number]);}
  });
 }
 app.get('/api/internal-stock/warehouses',async req=>{
  const uid=await userId(req),paid=(await db.query('SELECT 1 FROM subscriptions WHERE user_id=$1 AND expires>$2 AND cabinet_limit>0',[uid,Date.now()])).rows.length;
  const own=paid?(await db.query<any>("SELECT data FROM workspace_documents WHERE user_id=$1 AND kind='warehouses'",[uid])).rows[0]?.data||[]:[];
  return {warehouses:[...own.map((w:any)=>({id:w.id,name:w.name,team:''})),...(await employees.memberships(uid)).filter(m=>m.permissions.includes('view')).map(m=>({id:m.warehouse.id,name:m.warehouse.name+' · '+m.ownerName,team:m.id}))]};
 });
 app.get('/api/internal-stock',async req=>{
  const c=await context(req);const q=z.object({search:z.string().max(200).default(''),page:z.coerce.number().int().min(1).max(100000).default(1)}).parse(req.query);
  const where="location=$1 AND ($2='' OR strpos(lower(concat_ws(' ',title,article,cell,address,barcodes::text)),lower($2))>0)";
  const items=(await db.query<any>(`SELECT * FROM internal_stock_items WHERE ${where} ORDER BY title,id LIMIT 100 OFFSET $3`,[c.location,q.search,(q.page-1)*100])).rows;
  const summary=(await db.query<any>(`SELECT count(*)::int total,coalesce(sum(quantity),0)::bigint quantity,count(*) FILTER(WHERE quantity<0)::int deficits FROM internal_stock_items WHERE ${where}`,[c.location,q.search])).rows[0];
  return {items,...summary,canEdit:c.canEdit};
 });
 app.get('/api/internal-stock/ozon-catalog',async req=>{
  const c=await context(req);if(!c.store||c.store.marketplace!=='ozon')throw fail('Выберите кабинет Ozon.',400);
  const q=z.object({search:z.string().max(200).default(''),page:z.coerce.number().int().min(1).max(100000).default(1)}).parse(req.query);
  const products=(await db.query<any>(`SELECT DISTINCT ON (product->>'sku') product FROM ozon_postings p CROSS JOIN LATERAL jsonb_array_elements(p.products) product WHERE store_id=$1 AND warehouse_id=$2 AND ($3='' OR strpos(lower(product::text),lower($3))>0) ORDER BY product->>'sku',p.created_at DESC`,[c.store.id,c.warehouse,q.search])).rows.map(r=>r.product);
  const known=(await db.query<any>('SELECT * FROM internal_stock_items WHERE location=$1',[c.location])).rows;
  return {items:products.slice((q.page-1)*100,q.page*100).map(p=>({...p,internal:known.find(i=>i.source_id==='ozon:'+p.sku)||null})),total:products.length,canEdit:c.canEdit};
 });
 app.post('/api/internal-stock',async req=>{
  const c=await context(req,true);const b=product.extend({quantity:z.number().int().min(0).max(1000000),source:z.string().max(150).optional()}).parse(req.body);
  let details=b,source='manual:'+randomUUID();
  if(b.source){
   if(!c.store)throw fail('Выберите кабинет.');source=b.source;
   if(c.store.marketplace==='ozon'){
    const p=(await db.query<any>("SELECT product FROM ozon_postings p CROSS JOIN LATERAL jsonb_array_elements(p.products) product WHERE store_id=$1 AND warehouse_id=$2 AND product->>'sku'=$3 LIMIT 1",[c.store.id,c.warehouse,source.replace(/^ozon:/,'')])).rows[0]?.product;
    const catalog=(await db.query<any>('SELECT c.*,p.cell,p.address FROM ozon_catalog c LEFT JOIN ozon_stock_placement p ON p.store_id=c.store_id AND p.product_id=c.product_id AND p.warehouse_id=$3 WHERE c.store_id=$1 AND c.sku=$2 AND c.active',[c.store.id,source.replace(/^ozon:/,''),c.warehouse])).rows[0];
    if(catalog)details={...b,title:catalog.title,article:catalog.article,barcodes:catalog.barcodes,cell:catalog.cell||'',address:catalog.address||''};else{if(!p||source!=='ozon:'+p.sku)throw fail('Товар не найден.',404);details={...b,title:p.name||p.offer_id,article:p.offer_id,barcodes:[]};}
   }else{const p=(await db.query<any>('SELECT * FROM inventory_items WHERE store_id=$1 AND warehouse_id=$2 AND chrt_id=$3',[c.store.id,c.warehouse,source.replace(/^wb:/,'')])).rows[0];if(!p||source!=='wb:'+p.chrt_id)throw fail('Товар не найден.',404);details={...b,title:p.title,article:[p.article,p.size].filter(Boolean).join(' · '),barcodes:p.barcodes,cell:p.cell,address:p.address};}
  }
  return db.transaction(async tx=>{
   await tx.query('SELECT id FROM internal_stock_settings WHERE id=1 FOR UPDATE');
   if((await tx.query('SELECT 1 FROM internal_stock_items WHERE location=$1 AND source_id=$2',[c.location,source])).rows.length)throw fail('Остаток уже задан. Обновите таблицу.');
   const id=randomUUID();await tx.query('INSERT INTO internal_stock_items(id,location,source_id,title,article,barcodes,cell,address,quantity) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',[id,c.location,source,details.title,details.article,JSON.stringify(details.barcodes),details.cell,details.address,b.quantity]);
   await tx.query("INSERT INTO internal_stock_movements(id,item_id,delta,balance,kind,reference,actor) VALUES($1,$2,$3,$3,'manual','Начальный остаток',$4)",[randomUUID(),id,b.quantity,c.uid]);return {id};
  });
 });
 app.post('/api/internal-stock/:id',async req=>{
  const c=await context(req,true),b=z.object({version:z.number().int().positive(),quantity:z.number().int().min(0).max(1000000),reason:z.string().trim().min(1).max(300)}).parse(req.body);
  return db.transaction(async tx=>{
   await tx.query('SELECT id FROM internal_stock_settings WHERE id=1 FOR UPDATE');
   const i=(await tx.query<any>('SELECT * FROM internal_stock_items WHERE id=$1 AND location=$2 FOR UPDATE',[(req.params as any).id,c.location])).rows[0];if(!i)throw fail('Товар не найден.',404);if(i.version!==b.version)throw fail('Остаток изменился. Обновите таблицу.');
   await tx.query('UPDATE internal_stock_items SET quantity=$2,version=version+1 WHERE id=$1',[i.id,b.quantity]);
   await tx.query("INSERT INTO internal_stock_movements(id,item_id,delta,balance,kind,reference,actor) VALUES($1,$2,$3,$4,'manual',$5,$6)",[randomUUID(),i.id,b.quantity-i.quantity,b.quantity,b.reason,c.uid]);return {ok:true};
  });
 });
 app.get('/api/internal-stock/:id/history',async req=>{const c=await context(req);return {movements:(await db.query(`SELECT m.delta,m.balance,m.kind,m.reference,m.created_at FROM internal_stock_movements m JOIN internal_stock_items i ON i.id=m.item_id WHERE i.id=$1 AND i.location=$2 ORDER BY m.created_at DESC,m.id LIMIT 100`,[(req.params as any).id,c.location])).rows};});
 let running:Promise<void>|undefined,stopped=false;
 return {tick:()=>{if(stopped)return Promise.resolve();return running??=(reconcile().finally(()=>{running=undefined}));},close:async()=>{stopped=true;await running;}};
}
