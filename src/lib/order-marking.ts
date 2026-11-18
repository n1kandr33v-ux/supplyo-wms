/** WB may advertise mandatory product marking in either metadata list. */
export type OrderMarking = { requiredMeta?: string[]; optionalMeta?: string[] };

export function requiresKiz(order: OrderMarking): boolean {
  return order.requiredMeta?.includes("sgtin") === true || order.optionalMeta?.includes("sgtin") === true;
}

export function canPrintWithoutMarking(order: OrderMarking): boolean {
  return Array.isArray(order.requiredMeta) && order.requiredMeta.length === 0 && !requiresKiz(order);
}

// A positive validation result is distinct from WB's explicit no-check decision.
export function kizApproved(decision: string | null | undefined): boolean {
  return decision === "sgtinIntroduced" || decision === "sgtinSoldB2B";
}
// Product rule: WB "Без проверки" (filled) permits shipment, but does not
// represent successful validation. Printing and a saved KIZ are still required.
export function kizAllowsDelivery(decision: string | null | undefined): boolean {
  return kizApproved(decision) || decision === "filled";
}

export function readyForDelivery(item: { snapshot: OrderMarking; printed: boolean; kiz?: string | null; decision?: string | null; status: string }): boolean {
  return item.status === "Готов" && item.printed && (requiresKiz(item.snapshot)
    ? !!item.kiz && kizAllowsDelivery(item.decision)
    : canPrintWithoutMarking(item.snapshot));
}
