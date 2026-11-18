import { repairOpenKizStatuses } from "./fulfillment.ts";
import { orderSchema } from "./wb.ts";
import { requiresKiz, canPrintWithoutMarking, kizApproved, readyForDelivery } from "../src/lib/order-marking.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { createApp } from "./app.ts";
import { seal } from "./security.ts";
test("Auto prepares one durable print batch; WB label requests stay within 100 orders", async () => {
  const key = randomBytes(32);
  const requests: number[][] = [];
  let incomplete = false;
  const wb = {
    seller: async () => ({ sid: "auto", name: "Auto" }),
    orders: async () => [],
    marketplace: async (_token: string, path: string, _method = "GET", body?: any) => {
      assert.ok(path.includes("/orders/stickers"), "Auto must not submit KIZ or mutate WB supplies");
      requests.push(body.orders);
      return { stickers: [...body.orders].reverse().slice(incomplete ? 1 : 0).map(orderId => ({ orderId, file: "label-" + orderId, partA:"00123",partB:String(orderId) })) };
    },
  };
  const { app, db } = await createApp({ key, wb, worker: false, testPurchases: true });
  const headers: Record<string, string> = { origin: "http://127.0.0.1:8095", "x-supplyo-client": "web" };
  try {
    const registration = await app.inject({ method: "POST", url: "/api/auth/register", headers, payload: {
      email: "auto@example.com", password: "test-password-123", name: "Тест Автопечати", phone: "+79991234567", consent: true,
    } });
    assert.equal(registration.statusCode, 200, registration.body);
    headers.cookie = String(registration.headers["set-cookie"]).split(";")[0];
    await app.inject({ method: "POST", url: "/api/subscription/test-purchase", headers, payload: { plan: "solo" } });
    const uid = (await db.query<any>("SELECT id FROM users")).rows[0].id;
    await db.query("INSERT INTO stores(id,user_id,credential,fingerprint,name,status) VALUES('auto-store',$1,$2,'auto','Auto','ready')", [uid, seal("auto-token", key)]);
    await db.query("INSERT INTO fulfillment_supplies(store_id,id,warehouse_id,closed) VALUES('auto-store','selected','47',false),('auto-store','other','47',false),('auto-store','closed','47',true)");
    const snapshot = { article: "Блузка", skus: ["4601234567890", "additional-barcode"], warehouseId: 47, requiredMeta: [] as string[] };
    await db.transaction(async tx => {
      for (let id = 1000; id < 1101; id++) await tx.query(
        "INSERT INTO fulfillment_items(store_id,id,supply_id,snapshot) VALUES('auto-store',$1,'selected',$2)", [String(id), JSON.stringify(snapshot)],
      );
      for (const [id, supply, meta, status, printed] of [
        ["2000", "selected", ["sgtin"], "Ожидает", false],
        ["2001", "selected", ["uin"], "Ожидает", false],
        ["2002", "selected", undefined, "Ожидает", false],
        ["2003", "selected", [], "Готов", true],
        ["2004", "other", [], "Ожидает", false],
        ["2005", "selected", [], "Проверяется", false],
      ] as const) await tx.query(
        "INSERT INTO fulfillment_items(store_id,id,supply_id,snapshot,status,printed) VALUES('auto-store',$1,$2,$3,$4,$5)",
        [id, supply, JSON.stringify({ ...snapshot, requiredMeta: meta }), status, printed],
      );
    });
    await db.query("INSERT INTO fulfillment_items(store_id,id,supply_id,snapshot) VALUES('auto-store','2006','selected',$1)",
      [JSON.stringify({...snapshot, optionalMeta:["sgtin","customs_declaration"]})]);
    assert.equal((await app.inject({method:"POST",url:"/api/stores/auto-store/items/2002/scan",headers,payload:{}})).statusCode,409,"manual scan also rejects unknown marking requirements");
    const scan = (supply = "selected", barcode = "additional-barcode") => app.inject({ method: "POST", url: `/api/stores/auto-store/supplies/${supply}/scan-auto`, headers, payload: { barcode } });
    assert.equal((await scan("closed")).statusCode, 409);
    assert.equal((await scan("missing")).statusCode, 404);
    assert.equal((await scan("selected", "unknown-barcode")).statusCode, 409);
    assert.equal(requests.length, 0);
    const response = await scan();
    assert.equal(response.statusCode, 200, response.body);
    const storedNumbers=(await db.query<any>("SELECT id,sticker_text FROM fulfillment_items WHERE id IN ('1000','1100') ORDER BY id")).rows;
    assert.deepEqual(storedNumbers.map(i=>i.sticker_text),["00123 1000","00123 1100"],"Auto stores text mapped by WB order ID");
    const jobs = response.json().jobs;
    assert.equal(jobs.length, 101);
    assert.deepEqual(requests.map(r => r.length), [100, 1]);
    assert.ok(jobs.every((j: any) => j.label === "label-" + j.orderId), "labels follow order IDs even when WB reverses its response");
    assert.equal((await db.query<any>("SELECT count(*)::int n FROM fulfillment_items WHERE printed=true")).rows[0].n, 1, "fetching labels is not successful printing");
    const retry = await scan();
    assert.deepEqual(retry.json(), response.json(), "retries reuse the immutable manifest and single deduplication ID");
    assert.match(response.json().printJob, /^supplyo-auto-[a-f0-9-]{36}$/);
    assert.equal(requests.length, 2);
    await db.query("INSERT INTO fulfillment_items(store_id,id,supply_id,snapshot) VALUES('auto-store','1111','selected',$1)", [JSON.stringify(snapshot)]);
    assert.deepEqual((await scan()).json(), response.json(), "new arrivals cannot change an in-flight print job after an agent timeout");
    assert.equal((await scan("selected", snapshot.skus[0])).statusCode, 409, "alternate barcodes cannot create overlapping jobs");
    assert.equal((await app.inject({ method: "POST", url: "/api/stores/auto-store/items/1000/scan", headers, payload: {} })).statusCode, 409, "individual print cannot duplicate a reserved sticker");
    assert.equal((await app.inject({ method: "POST", url: "/api/stores/auto-store/items/1000/printed", headers, payload: {} })).statusCode, 409);
    const acknowledge = (supply = "selected", batch = response.json().printJob) => app.inject({ method: "POST", url: `/api/stores/auto-store/supplies/${supply}/print-batches/${batch}/printed`, headers, payload: {} });
    assert.equal((await acknowledge("other")).statusCode, 404, "batch is scoped to its supply");
    assert.equal((await acknowledge("selected", "unknown")).statusCode, 404);
    const ack = await acknowledge();
    assert.equal(ack.statusCode, 200, ack.body);
    assert.equal(ack.json().count, 101);
    assert.deepEqual((await acknowledge()).json(), ack.json(), "bulk acknowledgement is idempotent after a lost response");
    assert.equal((await db.query<any>("SELECT count(*)::int n FROM fulfillment_items WHERE printed=true")).rows[0].n, 102, "one acknowledgement records the entire batch");
    assert.equal((await db.query<any>("SELECT status FROM fulfillment_items WHERE id='1000'")).rows[0].status, "Готов");
    assert.equal((await db.query<any>("SELECT status FROM fulfillment_items WHERE id='2000'")).rows[0].status, "Ожидает", "KIZ orders stay individual");
    incomplete = true;
    assert.equal((await scan()).statusCode, 502, "incomplete WB data must never be sent for printing");
    assert.equal((await db.query("SELECT 1 FROM fulfillment_print_batches WHERE completed=false")).rows.length, 0, "no partial manifest is committed");
    incomplete = false;
    const next = await scan();
    assert.equal(next.statusCode, 200);
    assert.deepEqual(next.json().jobs, [{orderId:"1111",label:"label-1111"}], "completed stickers are never included in a later job");
    assert.notEqual(next.json().printJob, response.json().printJob);
    assert.equal((await acknowledge("selected", next.json().printJob)).statusCode, 200);
    assert.equal((await scan()).statusCode, 409);
    await db.query(`INSERT INTO fulfillment_items(store_id,id,supply_id,snapshot)
      SELECT 'auto-store',n::text,'other',$1::jsonb FROM generate_series(3000,4000) n`, [JSON.stringify(snapshot)]);
    const callsBeforeLimit = requests.length;
    assert.equal((await scan("other")).statusCode, 409, "oversized jobs fail before label fetch or printing");
    assert.equal(requests.length, callsBeforeLimit);
    assert.equal((await app.inject({ method: "POST", url: "/api/stores/auto-store/supplies/selected/scan-auto", headers: { origin: headers.origin, "x-supplyo-client": "web" }, payload: { barcode: "additional-barcode" } })).statusCode, 401);
    await db.query("UPDATE subscriptions SET expires=0 WHERE user_id=$1", [uid]);
    assert.equal((await scan()).statusCode, 403);
  } finally { await app.close(); }
});
test("WB assembly persists, waits for KIZ approval and blocks premature delivery", async () => {
  const key = randomBytes(32);
  let decision = "pending";
  const submittedKiz: string[] = [];
  let boxes = 0, failDelivery = false, boxCreates = 0;
  let failLabels = false;
  const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aJXcAAAAASUVORK5CYII=";
  const calls: string[] = [];
  const order = {
    id: 7001,
    article: "Блузка",
    skus: ["4601234567890"],
    createdAt: new Date().toISOString(),
    warehouseId: 47,
    requiredMeta: [] as string[],
    optionalMeta: ["sgtin", "customs_declaration"],
  };
  const added={...order,id:7002,requiredMeta:[],optionalMeta:[]};
  const foreign={...order,id:7003,warehouseId:49};
  const wb = {
    seller: async () => ({ sid: "test", name: "Test" }),
    orders: async () => [order],
    marketplace: async (_token: string, path: string, method = "GET", body?: any) => {
      calls.push(method + " " + path);
      if(path.endsWith("/meta/sgtin") && method === "PUT") submittedKiz.push(...body.sgtins);
      if(path.endsWith("/trbx")) {
        if(method === "POST") {boxes += body.amount; boxCreates++; return {trbxIds: ["box-1", "box-2"]};}
        return {trbxes: Array.from({length:boxes}, (_,i) => ({id: `box-${i}`}))};
      }
      if(path.endsWith("/deliver") && failDelivery) throw Error("WB temporarily unavailable");
      if(path.endsWith("/barcode?type=png")) return failLabels ? {} : {barcode:"WB-GI-TEST",file:png};
      if(path.includes("/trbx/stickers")) {
        assert.equal(method,"POST");
        assert.deepEqual(body,{trbxIds:["box-0"]});
        return {stickers: failLabels ? [] : [{barcode:"box-0",file:png}]};
      }
      if (path.endsWith("/orders/new")) return { orders: [order,added,foreign] };
      if (path === "/api/v3/supplies") return { id: "WB-GI-TEST" };
      if (path.includes("stickers"))
        return { stickers: [{ orderId: 7001, file: "png-test",partA:"00012",partB:"3456" }] };
      if (path === "/api/marketplace/v3/orders/meta")
        return {
          orders: [{ id: 7001, metaDetails: [{ key: "sgtin", decision }] }],
        };
      return {};
    },
  };
  const { app, db } = await createApp({
    key,
    wb,
    worker: false,
    testPurchases: true,
  });
  const headers: any = {
    origin: "http://127.0.0.1:8095",
    "x-supplyo-client": "web",
  };
  try {
    const registration = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      headers,
      payload: {
        email: "assembly@example.com",
        password: "test-password-123",
        name: "Тестовый Пользователь",
        phone: "+79991234567",
        consent: true,
      },
    });
    assert.equal(registration.statusCode, 200, registration.body);
    headers.cookie = String(registration.headers["set-cookie"]).split(";")[0];
    await app.inject({
      method: "POST",
      url: "/api/subscription/test-purchase",
      headers,
      payload: { plan: "solo" },
    });
    const uid = (await db.query<any>("SELECT id FROM users")).rows[0].id;
    await db.query(
      "INSERT INTO stores(id,user_id,credential,fingerprint,name,status) VALUES('test-store',$1,$2,'unique','Магазин','ready')",
      [uid, seal("test-token", key)],
    );
    const post = (suffix: string, payload: Record<string, unknown> = {}) =>
      app.inject({
        method: "POST",
        url: "/api/stores/test-store" + suffix,
        headers,
        payload,
      });
    const created = await post("/supplies/create", {
      orders: ["7001"],
      name: "Тестовая поставка",
    });
    assert.equal(created.statusCode, 200, created.body);
    assert.equal((await post("/supplies/WB-GI-TEST/labels")).statusCode,409,"open supplies cannot get shipping stickers");
    assert.equal((await post("/supplies/WB-GI-TEST/labels-printed")).statusCode,409,"cannot acknowledge an unfetched label");
    assert.equal((await post("/supplies/WB-GI-TEST/deliver")).statusCode, 409);
    assert.equal(
      (await post("/items/7001/scan", { kiz: "4601234567890" })).statusCode,
      400,
    );
    // Regression: this is the shape of order 6240319070 returned by WB.
    assert.equal(requiresKiz(orderSchema.parse(order)),true,"worker schema must preserve optionalMeta");
    assert.equal(canPrintWithoutMarking(order),false);
    await db.query("UPDATE fulfillment_items SET printed=true,status='Готов',label='png-test' WHERE id='7001'");
    await repairOpenKizStatuses(db);
    const repaired=(await db.query<any>("SELECT * FROM fulfillment_items WHERE id='7001'")).rows[0];
    assert.equal(repaired.status,"Ожидает");
    assert.equal(repaired.printed,true,"repair preserves successful printing");
    assert.equal((await post("/items/7001/printed")).statusCode,200);
    assert.equal((await db.query<any>("SELECT status FROM fulfillment_items WHERE id='7001'")).rows[0].status,"Ожидает","printing without a KIZ must never set ready");
    assert.equal((await post("/items/7001/scan")).statusCode,400,"optionalMeta.sgtin requires scanning KIZ");
    const numbers=()=>post("/supplies/WB-GI-TEST/sticker-numbers");
    assert.equal((await numbers()).statusCode,200);
    const afterNumbers=calls.length;
    assert.equal((await numbers()).statusCode,200);
    assert.equal(calls.length,afterNumbers,"cached sticker numbers do not request WB again");
    const withSticker=(await app.inject({url:"/api/stores/test-store/fulfillment",headers})).json();
    assert.equal(withSticker.items[0].sticker_text,"00012 3456","text preserves leading zeros");
    assert.equal(withSticker.items[0].printed,true,"loading numbers preserves print receipt");
    const code = "010460123456789321ABCDEFGHIJKLM";
    const scan = await post("/items/7001/scan", { kiz: code });
    assert.equal(scan.statusCode, 200, scan.body);
    assert.equal(scan.json().label, "png-test");
    const longCode='01046704697319662153"WhLG*!pW3&91EE1292T+xqUty4+a+6HsVRiREjfAVCU3vE6hfRnSbtdB1nNWA=';
    const repeat=await post("/items/7001/scan",{kiz:longCode});
    assert.equal(repeat.statusCode,200,repeat.body);
    assert.notEqual(repeat.json().printJob,scan.json().printJob,"intentional reprint needs a fresh agent job ID");
    assert.equal(submittedKiz.at(-1),longCode.slice(0,31)+'\x1d'+longCode.slice(31,37)+'\x1d'+longCode.slice(37),"WB receives the canonical KIZ with GS separators");
    await post("/items/7001/printed");
    await post("/supplies/WB-GI-TEST/check");
    let item = (await db.query<any>("SELECT * FROM fulfillment_items")).rows[0];
    assert.equal(item.status, "Проверяется");
    assert.equal((await post("/supplies/WB-GI-TEST/deliver")).statusCode, 409);
    for (const unverified of ["pending","optional","deadlineExceeded"]) {
      decision=unverified;
      await db.query("UPDATE api_cooldowns SET next_at=0 WHERE bucket='kiz-check:test-store'");
      await post("/supplies/WB-GI-TEST/check");
      assert.equal((await db.query<any>("SELECT status FROM fulfillment_items WHERE id='7001'")).rows[0].status,"Проверяется",unverified+" is not positive WB validation");
    }
    decision="filled";
    await db.query("UPDATE api_cooldowns SET next_at=0 WHERE bucket='kiz-check:test-store'");
    await post("/supplies/WB-GI-TEST/check");
    item=(await db.query<any>("SELECT * FROM fulfillment_items WHERE id='7001'")).rows[0];
    assert.equal(item.status,"Готов","WB no-check result permits shipment after printing");
    assert.equal(kizApproved(item.decision),false,"no-check is not successful validation");
    assert.equal(readyForDelivery(item),true);
    assert.equal(readyForDelivery({...item,printed:false}),false);
    assert.equal(readyForDelivery({...item,kiz:null}),false);
    for(const blocked of ["pending","optional","deadlineExceeded","sgtinNotFound",null]) assert.equal(readyForDelivery({...item,decision:blocked}),false);
    await db.query("UPDATE fulfillment_items SET printed=false,status='Проверяется' WHERE id='7001'");
    await repairOpenKizStatuses(db);
    assert.equal((await db.query<any>("SELECT status FROM fulfillment_items WHERE id='7001'")).rows[0].status,"Ожидает");
    await post("/items/7001/printed");
    assert.equal((await db.query<any>("SELECT status FROM fulfillment_items WHERE id='7001'")).rows[0].status,"Готов","print acknowledgement accepts filled");
    await db.query("UPDATE fulfillment_items SET status='Проверяется' WHERE id='7001'");
    await repairOpenKizStatuses(db);
    assert.equal((await db.query<any>("SELECT status FROM fulfillment_items WHERE id='7001'")).rows[0].status,"Готов","repair updates existing printed no-check orders");
    await db.query("UPDATE fulfillment_supplies SET closed=true WHERE id='WB-GI-TEST'");
    await db.query("UPDATE fulfillment_items SET status='Проверяется' WHERE id='7001'");
    await repairOpenKizStatuses(db);
    assert.equal((await db.query<any>("SELECT status FROM fulfillment_items WHERE id='7001'")).rows[0].status,"Проверяется","repair preserves closed history");
    await db.query("UPDATE fulfillment_supplies SET closed=false WHERE id='WB-GI-TEST'");
    await post("/items/7001/scan",{kiz:code});
    decision = "sgtinNotFound";
    await db.query("UPDATE api_cooldowns SET next_at=0 WHERE bucket='kiz-check:test-store'");
    await post("/supplies/WB-GI-TEST/check");
    item = (await db.query<any>("SELECT * FROM fulfillment_items")).rows[0];
    assert.equal(item.status, "Ошибка КИЗ");
    decision = "sgtinIntroduced";
    assert.equal((await post("/items/7001/scan", {kiz:code})).statusCode,200);
    await db.query("UPDATE api_cooldowns SET next_at=0 WHERE bucket='kiz-check:test-store'");
    await post("/supplies/WB-GI-TEST/check");
    item = (await db.query<any>("SELECT * FROM fulfillment_items")).rows[0];
    assert.equal(item.status, "Готов");
    await post("/items/7001/printed");
    assert.equal((await db.query<any>("SELECT status FROM fulfillment_items WHERE id='7001'")).rows[0].status,"Готов","print acknowledgement retry preserves WB approval");
    const append=(orders:string[])=>post("/supplies/WB-GI-TEST/add",{orders});
    assert.equal((await append(["7003"])).statusCode,400,"cannot add a different warehouse");
    assert.equal((await append(["9999"])).statusCode,409,"stale selections are rejected");
    const addition=await append(["7002"]);assert.equal(addition.statusCode,200,addition.body);
    assert.ok(calls.includes("PATCH /api/marketplace/v3/supplies/WB-GI-TEST/orders"));
    const items=(await db.query<any>("SELECT id,status FROM fulfillment_items ORDER BY id")).rows;
    assert.deepEqual(items.map(i=>[i.id,i.status]),[["7001","Готов"],["7002","Ожидает"]],"adding preserves previous assembly results");
    assert.equal((await append(["7002"])).statusCode,409,"cannot duplicate an order");
    assert.equal((await post("/supplies/WB-GI-TEST/deliver")).statusCode,409,"new order must also be assembled");
    await db.query("UPDATE fulfillment_items SET printed=true,status='Готов' WHERE id='7002'");
    assert.equal((await post("/supplies/WB-GI-TEST/deliver")).statusCode, 400, "explicit destination required");
    assert.equal((await post("/supplies/WB-GI-TEST/deliver", {destination:"PVZ",boxes:0})).statusCode,400);
    assert.equal((await post("/supplies/WB-GI-TEST/deliver", {destination:"PVZ",boxes:1.5})).statusCode,400);
    assert.equal((await post("/supplies/WB-GI-TEST/deliver", {destination:"SC",boxes:1})).statusCode,400);
    await db.query("UPDATE fulfillment_items SET decision='filled' WHERE id='7001'");
    assert.equal((await post("/supplies/WB-GI-TEST/deliver", {destination:"SC"})).statusCode, 200,"filled permits actual delivery route");
    assert.equal(boxCreates,0,"SC does not create PVZ boxes");
    assert.equal((await post("/supplies/WB-GI-TEST/deliver", {destination:"SC"})).statusCode,409,"cannot hand over twice");
    failLabels=true;
    assert.equal((await post("/supplies/WB-GI-TEST/labels")).statusCode,500,"empty WB response cannot be printed or cached");
    assert.equal((await db.query("SELECT 1 FROM fulfillment_shipping_labels")).rows.length,0);
    failLabels=false;
    const shipping=await post("/supplies/WB-GI-TEST/labels");
    assert.equal(shipping.statusCode,200,shipping.body);
    assert.deepEqual(shipping.json().stickers,[{file:png}]);
    assert.match(shipping.json().printJob,/^[a-zA-Z0-9-]{16,80}$/);
    const beforeCache=calls.length;
    assert.deepEqual((await post("/supplies/WB-GI-TEST/labels")).json(),shipping.json(),"label retries use identical cached data and print job");
    assert.equal(calls.length,beforeCache,"retry does not request WB or deliver again");
    assert.equal((await post("/supplies/WB-GI-TEST/labels-printed")).statusCode,200);
    assert.ok((await db.query<any>("SELECT shipping_printed_at FROM fulfillment_supplies WHERE id='WB-GI-TEST'")).rows[0].shipping_printed_at);
    const fulfillment=(await app.inject({url:"/api/stores/test-store/fulfillment",headers})).json();
    assert.ok(!JSON.stringify(fulfillment).includes(png),"bulk list does not contain label images");
    await db.query("INSERT INTO fulfillment_supplies(store_id,id,name,warehouse_id) VALUES('test-store','PVZ-TEST','ПВЗ','47')");
    await db.query("UPDATE fulfillment_items SET supply_id='PVZ-TEST'");
    failDelivery = true;
    assert.equal((await post("/supplies/PVZ-TEST/deliver",{destination:"PVZ",boxes:1})).statusCode,500);
    assert.equal(boxes,1);
    assert.equal((await post("/supplies/PVZ-TEST/deliver",{destination:"SC"})).statusCode,409,"cannot silently switch existing PVZ boxes to SC");
    failDelivery = false;
    assert.equal((await post("/supplies/PVZ-TEST/deliver",{destination:"PVZ",boxes:1})).statusCode,200);
    assert.equal(boxCreates,1,"retry reuses existing WB boxes");
    const delivered=(await db.query<any>("SELECT destination,boxes,closed,delivered_at FROM fulfillment_supplies WHERE id='PVZ-TEST'")).rows[0];
    assert.equal(delivered.destination,"PVZ");assert.equal(delivered.boxes,1);assert.ok(delivered.closed && delivered.delivered_at);
    failLabels=true;
    assert.equal((await post("/supplies/PVZ-TEST/labels")).statusCode,500,"all PVZ boxes must have stickers");
    failLabels=false;
    const pvzLabels=await post("/supplies/PVZ-TEST/labels");
    assert.equal(pvzLabels.statusCode,200,pvzLabels.body);
    assert.deepEqual(pvzLabels.json().stickers,[{file:png}]);
    assert.notEqual(pvzLabels.json().printJob,shipping.json().printJob,"supplies have distinct print jobs");
    assert.equal(boxCreates,1,"label retry never creates transport boxes");
    assert.equal((await append(["7003"])).statusCode,409,"closed supply cannot receive orders");
    assert.ok(calls.includes("PATCH /api/v3/supplies/WB-GI-TEST/deliver"));
    const unauthorized = await app.inject("/api/stores/test-store/fulfillment");
    assert.equal(unauthorized.statusCode, 401);
    assert.equal((await app.inject({method:"POST",url:"/api/stores/test-store/supplies/WB-GI-TEST/labels",headers:{origin:headers.origin,"x-supplyo-client":"web"},payload:{}})).statusCode,401);
  } finally {
    await app.close();
  }
});
