import type {Database} from './database.ts';
export const OZON_MARK_RETENTION_MS=14*24*60*60*1000;
/** A confirmed packing completion starts the clock once; reads/retries do not extend it. */
export async function confirmOzonAssembly(db:Database,store:string,posting:string,now=Date.now()){
 await db.query('UPDATE ozon_postings SET assembled_at=COALESCE(assembled_at,$3) WHERE store_id=$1 AND posting_number=$2',[store,posting,now]);
}
export async function purgeExpiredOzonMarks(db:Database,now=Date.now()){
 // Legacy packed postings have no exact completion timestamp: start from their last known observation.
 await db.query("UPDATE ozon_postings SET assembled_at=updated_at WHERE assembled_at IS NULL AND status IN ('awaiting_deliver','delivering','delivered')");
 return db.transaction(async tx=>{
  const due=(await tx.query<{store_id:string;posting_number:string}>("SELECT store_id,posting_number FROM ozon_postings WHERE assembled_at<=$1 AND marks_purged_at IS NULL ORDER BY assembled_at LIMIT 100 FOR UPDATE",[now-OZON_MARK_RETENTION_MS])).rows;
  for(const p of due){
   await tx.query(`UPDATE ozon_pick_history h SET previous=previous-'kiz'-'previous_code'-'identity' FROM ozon_pick_units u WHERE h.unit_id=u.id AND u.store_id=$1 AND u.posting_number=$2`,[p.store_id,p.posting_number]);
   await tx.query('UPDATE ozon_pick_units SET kiz=NULL,previous_code=NULL,identity=NULL WHERE store_id=$1 AND posting_number=$2',[p.store_id,p.posting_number]);
   await tx.query('UPDATE ozon_postings SET marks_purged_at=$3 WHERE store_id=$1 AND posting_number=$2',[p.store_id,p.posting_number,now]);
  }
  return due.length;
 });
}
