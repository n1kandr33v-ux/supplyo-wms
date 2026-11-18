// Expressions are fixed SQL identifiers supplied by our routes, never request input.
// A barcode must identify exactly one variant in the same cabinet and warehouse.
export function placementJoin(store: string, warehouse: string, barcodes: string) {
  return `LEFT JOIN LATERAL (
    SELECT CASE WHEN count(*)=1 THEN max(i.cell) END AS cell,
           CASE WHEN count(*)=1 THEN max(i.address) END AS address
    FROM inventory_items i WHERE i.store_id=${store} AND i.warehouse_id=${warehouse}
    AND i.barcodes ?| ARRAY(SELECT jsonb_array_elements_text(COALESCE(${barcodes},'[]'::jsonb)))
  ) placement ON true`;
}
