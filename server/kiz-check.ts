import type { Database } from "./database.ts";
import { WbError } from "./wb.ts";
import { kizAllowsDelivery } from "../src/lib/order-marking.ts";
import { z } from "zod";

const pending = ["pending", "deadlineExceeded", "optional"];
const response = z.object({ orders: z.array(z.object({
  id: z.number().int().nonnegative(),
  metaDetails: z.array(z.object({ key: z.string(), decision: z.string().optional() })).optional(),
})) });
export function createKizChecker(db: Database, fetchMeta: (store: any, ids: number[]) => Promise<unknown>) {
  const running = new Map<string, Promise<void>>();
  return function check(store: any): Promise<void> {
    const previous = running.get(store.id);
    if (previous) return previous;
    const task = (async () => {
      let failure: unknown;
      // A database row lock serializes the same cabinet even across server
      // instances. The cooldown survives restarts; no account/grant IDs here.
      await db.transaction(async tx => {
        const bucket = "kiz-check:" + store.id;
        await tx.query("INSERT INTO api_cooldowns(bucket,next_at) VALUES($1,0) ON CONFLICT DO NOTHING", [bucket]);
        const state = (await tx.query<{next_at: number}>("SELECT next_at FROM api_cooldowns WHERE bucket=$1 FOR UPDATE", [bucket])).rows[0];
        if (Number(state.next_at) > Date.now()) return;
        let delay = 15000;
        try {
          const items = (await tx.query<any>(`SELECT i.id,i.kiz,i.kiz_revision,i.decision FROM fulfillment_items i
            JOIN fulfillment_supplies s ON s.store_id=i.store_id AND s.id=i.supply_id
            WHERE i.store_id=$1 AND s.closed=false AND i.kiz IS NOT NULL
            AND (i.decision IS NULL OR i.decision=ANY($2::text[])) ORDER BY i.id`, [store.id, pending])).rows;
          for (let offset = 0; offset < items.length; offset += 100) {
            const batch = items.slice(offset, offset + 100);
            const data = response.parse(await fetchMeta(store, batch.map(i => Number(i.id))));
            for (const order of data.orders) {
              const item = batch.find(i => i.id === String(order.id));
              const decision = order.metaDetails?.find(m => m.key === "sgtin")?.decision;
              if (!item || !decision) continue;
              const status = kizAllowsDelivery(decision) ? "approved" : pending.includes(decision) ? "Проверяется" : "Ошибка КИЗ";
              // Use current printing state; never overwrite a re-scanned code,
              // another decision, or a supply already handed over to delivery.
              await tx.query(`UPDATE fulfillment_items i SET decision=$3,status=CASE
                WHEN $7='approved' THEN CASE WHEN printed THEN 'Готов' ELSE 'Ожидает' END ELSE $7 END
                WHERE store_id=$1 AND id=$2 AND kiz=$4 AND kiz_revision=$5 AND decision IS NOT DISTINCT FROM $6
                AND EXISTS(SELECT 1 FROM fulfillment_supplies s WHERE s.store_id=i.store_id AND s.id=i.supply_id AND s.closed=false)`,
                [store.id, item.id, decision, item.kiz, item.kiz_revision, item.decision, status]);
            }
          }
        } catch (error) {
          failure = error;
          delay = error instanceof WbError ? Math.max(60, error.retrySeconds) * 1000 : 15000;
        }
        await tx.query("UPDATE api_cooldowns SET next_at=$2 WHERE bucket=$1", [bucket, Date.now() + delay]);
      });
      if (failure) throw failure;
    })();
    running.set(store.id, task);
    void task.finally(() => { if (running.get(store.id) === task) running.delete(store.id); }).catch(() => {});
    return task;
  };
}
