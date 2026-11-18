import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { createApp } from "./app.ts";

test("unpaid client can connect WB securely, but order access and synchronization require subscription", async () => {
  let sellerCalls = 0;
  let orderCalls = 0;
  const { app, db, tick } = await createApp({
    key: randomBytes(32), worker: false, testPurchases: true,
    wb: {
      seller: async () => { sellerCalls++; return { sid: "unpaid-seller", name: "Магазин без подписки" }; },
      orders: async () => { orderCalls++; return []; },
    },
  });
  const headers = { origin: "http://127.0.0.1:8095", "x-supplyo-client": "web" };
  try {
    const signup = await app.inject({ method: "POST", url: "/api/auth/register", headers,
      payload: { name: "Клиент без подписки", email: "unpaid@example.test", phone: "+79991234567", password: "Test-password-123", consent: true } });
    assert.equal(signup.statusCode, 200, signup.body);
    const owner = { ...headers, cookie: signup.headers["set-cookie"]!.toString().split(";")[0] };
    const token = "synthetic-unpaid-store-token";
    const connection = await app.inject({ method: "POST", url: "/api/stores", headers: owner, payload: { token } });
    assert.equal(connection.statusCode, 202, connection.body);
    const id = connection.json().id;
    const credential = (await db.query<{ credential: string }>("SELECT credential FROM stores WHERE id=$1", [id])).rows[0].credential;
    assert.notEqual(credential, token);
    await tick();
    await tick();
    assert.equal(sellerCalls, 1);
    assert.equal(orderCalls, 0, "unpaid connection must not fetch orders");
    const list = await app.inject({ url: "/api/stores", headers: owner });
    assert.equal(list.json().stores[0].name, "Магазин без подписки");
    assert.equal(list.json().stores[0].status, "ready");
    assert.equal(list.json().stores[0].last_synced, null);
    assert.ok(!list.body.includes(token));
    assert.equal((await app.inject({ url: `/api/stores/${id}/orders`, headers: owner })).statusCode, 403);
    assert.equal((await app.inject({ method: "POST", url: `/api/stores/${id}/sync`, headers: owner, payload: {} })).statusCode, 403);
    const purchase = await app.inject({ method: "POST", url: "/api/subscription/test-purchase", headers: owner, payload: { plan: "solo" } });
    assert.equal(purchase.statusCode, 200, purchase.body);
    await tick();
    assert.equal(sellerCalls, 1, "verified key does not need re-verification after purchase");
    assert.equal(orderCalls, 1, "subscription starts synchronization for the connected store");
    assert.equal((await app.inject({ url: `/api/stores/${id}/orders`, headers: owner })).statusCode, 200);
  } finally { await app.close(); }
});

test("local test purchase activates only current account, keeps expiry on retry and enables WB connection", async () => {
  const { app, db, tick } = await createApp({
    key: randomBytes(32),
    worker: false,
    testPurchases: true,
    wb: {
      seller: async () => ({ sid: "test-seller", name: "Тест WB" }),
      orders: async () => [],
    },
  });
  const headers = {
    origin: "http://127.0.0.1:8095",
    "x-supplyo-client": "web",
  };
  try {
    const signup = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      headers,
      payload: {
        name: "Тест подписки",
        email: "purchase@example.test",
        phone: "+79991234567",
        password: "Test-password-123",
        consent: true,
      },
    });
    const owner = {
      ...headers,
      cookie: signup.headers["set-cookie"]!.toString().split(";")[0],
    };
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: "/api/subscription/test-purchase",
          headers: owner,
          payload: { plan: "unknown" },
        })
      ).statusCode,
      400,
    );
    const purchase = await app.inject({
      method: "POST",
      url: "/api/subscription/test-purchase",
      headers: owner,
      payload: { plan: "start", userId: "another-account" },
    });
    assert.equal(purchase.statusCode, 200, purchase.body);
    assert.equal(purchase.json().subscription.limit, 5);
    assert.equal(purchase.json().subscription.active, true);
    assert.equal(purchase.json().subscription.isTest, true);
    assert.equal((await app.inject({url:"/api/me",headers:owner})).json().subscription.isTest,true);
    const repeat = await app.inject({
      method: "POST",
      url: "/api/subscription/test-purchase",
      headers: owner,
      payload: { plan: "start" },
    });
    assert.equal(
      repeat.json().subscription.expires,
      purchase.json().subscription.expires,
    );
    const record = (
      await db.query<{ is_test: boolean }>("SELECT is_test FROM subscriptions")
    ).rows[0];
    assert.equal(record.is_test, true);
    const store = await app.inject({
      method: "POST",
      url: "/api/stores",
      headers: owner,
      payload: { token: "synthetic-purchase-wb-token" },
    });
    assert.equal(store.statusCode, 202);
    await tick();
    assert.equal(
      (await app.inject({ url: "/api/stores", headers: owner })).json()
        .stores[0].status,
      "ready",
    );
  } finally {
    await app.close();
  }
});
