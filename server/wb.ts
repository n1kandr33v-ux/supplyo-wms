import { readSupplySnapshot, type SupplySnapshot } from "./supply-sync.ts";
import { z } from "zod";
// WB int64 pagination cursors can exceed JS safe integers. Keep their raw JSON
// digits; converting an already parsed Number back to text loses page positions.
export function parseWbJson(text:string):unknown {
  const parse=JSON.parse as (text:string,reviver:(key:string,value:any,context?:{source?:string})=>any)=>unknown;
  return parse(text,(key,value,context)=>{
    if(key==='next'&&typeof value==='number'&&!Number.isSafeInteger(value)){
      if(!context?.source||!/^\d+$/.test(context.source))throw Error('WB returned an invalid pagination cursor');
      return context.source;
    }
    return value;
  });
}
import {orderSchema,WbError,type WbOrder} from "./wb-model.ts";
export {orderSchema,WbError,type WbOrder} from "./wb-model.ts";
export interface WbClient {
  seller(token: string): Promise<{ sid: string; name: string }>;
  orders(token: string): Promise<WbOrder[]>;
  supplies?: (token:string, known:WbOrder[]) => Promise<SupplySnapshot>;
  marketplace?: typeof marketplace;
  content?: typeof marketplace;
}
async function request(url: string, token: string) {
  const response = await fetch(url, {
    headers: { Authorization: token },
    signal: AbortSignal.timeout(20_000),
    redirect: "error",
  });
  if (!response.ok) {
    const seconds = Math.max(
      1,
      Number(
        response.headers.get("X-Ratelimit-Retry") ||
          response.headers.get("Retry-After") ||
          60,
      ),
    );
    throw new WbError(response.status, Number.isFinite(seconds) ? seconds : 60);
  }
  return parseWbJson(await response.text());
}
export const wbClient: WbClient = {
  supplies: (token, known) => readSupplySnapshot(token, known),
  async seller(token) {
    const seller = z
      .object({ sid: z.string(), name: z.string().min(1) })
      .parse(
        await request(
          "https://common-api.wildberries.ru/api/v1/seller-info",
          token,
        ),
      );
    return seller;
  },
  async orders(token) {
    return z
      .object({ orders: z.array(orderSchema) })
      .parse(await marketplace(token, "/api/v3/orders/new")).orders;
  },
};

const tails = new Map<string, Promise<unknown>>();
export function marketplace(
  token: string,
  path: string,
  method = "GET",
  body?: unknown,
): Promise<unknown> {
  return queuedRequest("https://marketplace-api.wildberries.ru", token, path, method, body);
}
export function content(token: string, path: string, method = "POST", body?: unknown): Promise<unknown> {
  return queuedRequest("https://content-api.wildberries.ru", token, path, method, body);
}
function queuedRequest(host: string, token: string, path: string, method: string, body?: unknown): Promise<unknown> {
  const previous = tails.get(token) ?? Promise.resolve();
  let pause = 1000;
  const next = previous
    .catch(() => {})
    .then(async () => {
      const response = await fetch(
        host + path,
        {
          method,
          headers: { Authorization: token, "Content-Type": "application/json" },
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: AbortSignal.timeout(20000),
          redirect: "error",
        },
      );
      if (!response.ok) {
        const retry = Number(response.headers.get("X-Ratelimit-Retry") || response.headers.get("Retry-After") || 60);
        if (response.status === 429) pause = Math.max(1000, (Number.isFinite(retry) ? retry : 60) * 1000);
        throw new WbError(
          response.status,
          Math.max(
            1,
            Number(
              response.headers.get("X-Ratelimit-Retry") ||
                response.headers.get("Retry-After") ||
                60,
            ),
          ),
        );
      }
      return response.status === 204 ? {} : parseWbJson(await response.text());
    });
  const settled = next
    .catch(() => {})
    .then(() => new Promise((resolve) => setTimeout(resolve, pause)));
  tails.set(token, settled);
  void settled.then(() => {
    if (tails.get(token) === settled) tails.delete(token);
  });
  return next;
}
