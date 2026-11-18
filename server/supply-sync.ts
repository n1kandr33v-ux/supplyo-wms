import { z } from "zod";
import { marketplace } from "./wb.ts";
import {orderSchema,WbError,type WbOrder} from "./wb-model.ts";
import type { Queries } from "./database.ts";

const supplySchema=z.object({id:z.string().min(1),name:z.string().default(""),done:z.boolean(),createdAt:z.string(),closedAt:z.string().nullable().optional()});
const cursorSchema=z.union([z.number().int().nonnegative().transform(String),z.string().regex(/^\d+$/).max(40)]);
const listSchema=z.object({next:cursorSchema,supplies:z.array(supplySchema)});
const detailSchema=orderSchema.passthrough();
export type SupplySnapshot={supplies:z.infer<typeof supplySchema>[];members:Map<string,string[]>;orders:Map<string,WbOrder>};
export type SavedItem={id:string;supply_id:string|null;snapshot:WbOrder};
const epochs=new Map<string,number>(),busy=new Set<string>();
export const supplyEpoch=(id:string)=>epochs.get(id)||0;
export const supplyBusy=(id:string)=>busy.has(id);
export function beginSupplyMutation(id:string){epochs.set(id,supplyEpoch(id)+1);busy.add(id);}
export function endSupplyMutation(id:string){epochs.set(id,supplyEpoch(id)+1);busy.delete(id);}

// All network reads finish before the caller opens the publishing transaction.
export async function readSupplySnapshot(token:string,known:WbOrder[],transport:typeof marketplace=marketplace,now=Date.now()):Promise<SupplySnapshot>{
 const supplies:SupplySnapshot['supplies']=[],seen=new Set<string>();let next="0";
 for(let page=0;;page++){
  if(page>=1000)throw Error("Слишком много страниц поставок WB");
  const data=listSchema.parse(await transport(token,`/api/v3/supplies?limit=1000&next=${next}`));
  for(const s of data.supplies){if(seen.has(s.id))throw Error("WB повторил поставку в списке");seen.add(s.id);supplies.push(s);}
  if(!data.supplies.length||data.next==="0")break;
  if(BigInt(data.next)<=BigInt(next))throw Error("WB не продвинул страницу поставок");next=data.next;
 }
 const members=new Map<string,string[]>(),assigned=new Set<string>();
 for(const s of supplies.filter(s=>!s.done)){
  let raw:unknown;
  try{raw=await transport(token,`/api/marketplace/v3/supplies/${encodeURIComponent(s.id)}/order-ids`);}
  catch(e){if(e instanceof WbError&&e.status===404)throw Error("Поставка изменилась в WB. Повторим синхронизацию.");throw e;}
  const data=z.object({orderIds:z.array(z.number().int().nonnegative())}).parse(raw);
  const ids=[...new Set(data.orderIds.map(String))];
  for(const id of ids){if(assigned.has(id))throw Error("WB вернул заказ в нескольких поставках. Повторим синхронизацию.");assigned.add(id);}
  members.set(s.id,ids);
 }
 // Canceled/already handed-over orders must never reappear as work to pick.
 const completed=new Set<string>();
 const allIds=[...assigned];
 for(let offset=0;offset<allIds.length;offset+=1000){
  const ids=allIds.slice(offset,offset+1000),expected=new Set(ids);
  const data=z.object({orders:z.array(z.object({id:z.number().int().nonnegative(),supplierStatus:z.string(),wbStatus:z.string()}))}).parse(await transport(token,"/api/v3/orders/status","POST",{orders:ids.map(Number)}));
  const returned=new Set<string>();
  for(const order of data.orders){const id=String(order.id);if(!expected.has(id))continue;returned.add(id);
   if(!['new','confirm','complete','cancel','cancel_carrier'].includes(order.supplierStatus))throw Error("WB вернул неизвестный статус заказа");
   if(order.supplierStatus==='complete')completed.add(id);
   if(['complete','cancel','cancel_carrier'].includes(order.supplierStatus)||['canceled','canceled_by_client','declined_by_client','canceled_by_carrier'].includes(order.wbStatus))assigned.delete(id);
  }
  if(returned.size!==expected.size)throw Error("WB ещё не вернул статусы всех заказов");
 }
 for(const [supply,ids] of members){
  if(ids.length&&ids.every(id=>completed.has(id))){supplies.find(s=>s.id===supply)!.done=true;members.delete(supply);}
  else members.set(supply,ids.filter(id=>assigned.has(id)));
 }
 const orders=new Map<string,WbOrder>();for(const order of known)if(assigned.has(String(order.id)))orders.set(String(order.id),order);
 const missing=()=>[...assigned].filter(id=>!orders.has(id)||!orders.get(id)!.warehouseId||!orders.get(id)!.skus.length);
 // Details endpoint provides at most 30 days per request, covering the last 3 months.
 for(let window=0;window<3&&missing().length;window++){
  const to=Math.floor(now/1000)-window*30*86400,from=to-30*86400;next="0";
  for(let page=0;;page++){
   if(page>=1000)throw Error("Слишком много страниц заказов WB");
   const data=z.object({next:cursorSchema,orders:z.array(detailSchema)}).parse(await transport(token,`/api/v3/orders?limit=1000&next=${next}&dateFrom=${from}&dateTo=${to}`));
   for(const order of data.orders)if(assigned.has(String(order.id)))orders.set(String(order.id),order);
   if(!missing().length||!data.orders.length||data.next==="0")break;
   if(BigInt(data.next)<=BigInt(next))throw Error("WB не продвинул страницу заказов");next=data.next;
  }
 }
 if(missing().length)throw Error("WB ещё не вернул данные всех заказов поставки. Повторим синхронизацию.");
 // Historical orders omit requiredMeta/optionalMeta. Query available metadata in batches.
 // Old imports incorrectly treated every available key as mandatory. A camel-case
 // customsDeclaration with no optional list identifies that legacy inferred shape.
 const withoutMeta=[...orders.values()].filter(o=>!Array.isArray(o.requiredMeta)||(o.wbMetaVersion!==1&&!Array.isArray(o.optionalMeta)&&o.requiredMeta.includes('customsDeclaration')));
 for(let offset=0;offset<withoutMeta.length;offset+=100){
  const batch=withoutMeta.slice(offset,offset+100),ids=new Set(batch.map(o=>String(o.id)));
  const data=z.object({orders:z.array(z.object({id:z.number().int().nonnegative(),metaDetails:z.array(z.object({key:z.string(),decision:z.string().optional()}))}))}).parse(await transport(token,"/api/marketplace/v3/orders/meta","POST",{orders:batch.map(o=>o.id)}));
  const returned=new Set<string>();for(const entry of data.orders)if(ids.has(String(entry.id))){const o=orders.get(String(entry.id))!;const normalize=(key:string)=>key==='customsDeclaration'?'customs_declaration':key;orders.set(String(entry.id),{...o,wbMetaVersion:1,requiredMeta:[...new Set(entry.metaDetails.filter(m=>m.decision!=='optional').map(m=>normalize(m.key)))],optionalMeta:[...new Set([...(o.optionalMeta||[]),...entry.metaDetails.filter(m=>m.decision==='optional').map(m=>normalize(m.key))])]});returned.add(String(entry.id));}
  if(returned.size!==ids.size)throw Error("WB ещё не вернул требования к маркировке всех заказов");
 }
 return {supplies,members,orders};
}

export async function applySupplySnapshot(tx:Queries,storeId:string,data:SupplySnapshot,before:SavedItem[],beforeSupplies:string[]){
 const changed:string[]=[];
 const saved=new Map(before.map(i=>[i.id,i])),remoteIds=new Set(data.supplies.map(s=>s.id));
 for(const s of data.supplies){
  const ids=data.members.get(s.id)||[],warehouses=[...new Set(ids.map(id=>String(data.orders.get(id)!.warehouseId)))];
  if(warehouses.length>1)throw Error("В поставке WB заказы разных складов");
  // Import active supplies; existing delivery history still receives external closure updates.
  if(s.done){await tx.query("UPDATE fulfillment_supplies SET wb_removed=false,closed=true,delivered_at=COALESCE(delivered_at,$3) WHERE store_id=$1 AND id=$2",[storeId,s.id,s.closedAt||null]);continue;}
  await tx.query(`INSERT INTO fulfillment_supplies(store_id,id,name,created,warehouse_id) VALUES($1,$2,$3,$4,$5)
   ON CONFLICT(store_id,id) DO UPDATE SET wb_removed=false,name=EXCLUDED.name,created=COALESCE(fulfillment_supplies.created,EXCLUDED.created),warehouse_id=COALESCE(EXCLUDED.warehouse_id,fulfillment_supplies.warehouse_id)`,[storeId,s.id,s.name||s.id,s.createdAt,warehouses[0]||null]);
  for(const id of ids){
   const previous=saved.get(id),snapshot=JSON.stringify(data.orders.get(id));
   if(previous){
    const moved=previous.supply_id!==s.id;
    const ownMove=moved&&(await tx.query(`SELECT 1 FROM fulfillment_transfers t WHERE store_id=$1 AND source_id=$2 AND target_id=$3 AND state='prepared'
      AND EXISTS(SELECT 1 FROM jsonb_array_elements(t.saved) j WHERE j->>'id'=$4)`,[storeId,previous.supply_id,s.id,id])).rows.length>0;
    const reset=moved&&!ownMove;if(moved)changed.push(id);
    if(ownMove)await tx.query("UPDATE mobile_pick_notes SET supply_id=$4 WHERE store_id=$1 AND supply_id=$2 AND item_id=$3",[storeId,previous.supply_id,id,s.id]);
    if(moved)await tx.query(`INSERT INTO fulfillment_item_history(store_id,order_id,old_supply_id,new_supply_id,previous)
      SELECT store_id,id,supply_id,$3,to_jsonb(i) FROM fulfillment_items i WHERE store_id=$1 AND id=$2 AND supply_id IS NOT DISTINCT FROM $4`,[storeId,id,s.id,previous.supply_id]);
    await tx.query(`UPDATE fulfillment_items SET supply_id=$3,snapshot=$4,
      printed=CASE WHEN $6 THEN false ELSE printed END,label=CASE WHEN $6 THEN NULL ELSE label END,
      sticker_text=CASE WHEN $6 THEN NULL ELSE sticker_text END,kiz=CASE WHEN $6 THEN NULL ELSE kiz END,
      decision=CASE WHEN $6 THEN NULL ELSE decision END,status=CASE WHEN $6 THEN 'Ожидает' ELSE status END,
      kiz_revision=kiz_revision+CASE WHEN $6 THEN 1 ELSE 0 END
      WHERE store_id=$1 AND id=$2 AND supply_id IS NOT DISTINCT FROM $5`,[storeId,id,s.id,snapshot,previous.supply_id,reset]);
   }else await tx.query("INSERT INTO fulfillment_items(store_id,id,supply_id,snapshot) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING",[storeId,id,s.id,snapshot]);
   await tx.query("DELETE FROM orders WHERE store_id=$1 AND id=$2",[storeId,id]);
  }
 }
 // Detach removed orders without deleting print receipts, KIZ or notes. Ignore newly created local rows.
 const assigned=new Set([...data.members.values()].flat());
 for(const previous of before){
  if(!previous.supply_id||assigned.has(previous.id))continue;
  const header=data.supplies.find(s=>s.id===previous.supply_id);
  if(header?.done)continue;
  if(!header&&!remoteIds.has(previous.supply_id)){
   // Absence is not evidence that historical delivery was deleted.
   const closed=(await tx.query<{closed:boolean}>("SELECT closed FROM fulfillment_supplies WHERE store_id=$1 AND id=$2",[storeId,previous.supply_id])).rows[0]?.closed;
   if(closed)continue;
  }
  await tx.query(`INSERT INTO fulfillment_item_history(store_id,order_id,old_supply_id,new_supply_id,previous)
    SELECT store_id,id,supply_id,NULL,to_jsonb(i) FROM fulfillment_items i WHERE store_id=$1 AND id=$2 AND supply_id=$3`,[storeId,previous.id,previous.supply_id]);
  changed.push(previous.id);
  await tx.query("UPDATE fulfillment_items SET supply_id=NULL WHERE store_id=$1 AND id=$2 AND supply_id=$3",[storeId,previous.id,previous.supply_id]);
 }
 // Hide deleted active supplies without misreporting them as delivered or deleting history.
 await tx.query("UPDATE fulfillment_supplies SET wb_removed=true WHERE store_id=$1 AND closed=false AND id=ANY($3::text[]) AND NOT(id=ANY($2::text[]))",[storeId,[...remoteIds],beforeSupplies]);
 if(changed.length)await tx.query(`UPDATE fulfillment_print_batches b SET completed=true,cancelled=true
   WHERE store_id=$1 AND completed=false AND EXISTS(SELECT 1 FROM jsonb_array_elements(b.jobs) j WHERE j->>'orderId'=ANY($2::text[]))`,[storeId,changed]);
}
