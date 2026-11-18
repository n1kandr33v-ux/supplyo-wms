import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, basename } from "node:path";
import { createApp } from "./app.ts";
import { WbError, type WbClient } from "./wb.ts";

test("real auth, tenant isolation, encrypted credentials, durable jobs and safe WB retry", async () => {
  let calls = 0,
    limited = false;
  const wb: WbClient = {
    seller: async () => ({ sid: "seller-test", name: "Тестовый продавец" }),
    orders: async () => {
      calls++;
      if (limited) throw new WbError(429, 120);
      return [
        {
          id: 123456,
          article: "рубашка",
          skus: ["1234567890123"],
          createdAt: "2026-11-09T08:00:00Z",
          warehouseId: 47,
        },
      ];
    },
  };
  const { app, db, tick } = await createApp({
    key: randomBytes(32),
    wb,
    worker: false,
  });
  const headers = {
    origin: "http://127.0.0.1:8095",
    "x-supplyo-client": "web",
  };
  try {
    assert.equal((await app.inject("/api/stores")).statusCode, 401);
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: "/api/subscription/test-purchase",
          headers,
          payload: { plan: "solo" },
        })
      ).statusCode,
      401,
    );
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: "/api/auth/register",
          payload: {},
        })
      ).statusCode,
      403,
    );
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: "/api/auth/register",
          headers,
          payload: { email: "bad" },
        })
      ).statusCode,
      400,
    );
    async function register(email: string) {
      const r = await app.inject({
        method: "POST",
        url: "/api/auth/register",
        headers,
        payload: {
          email,
          password: "Test-password-123",
          name: "Тестовый пользователь",
          phone: "+79991234567",
          consent: true,
        },
      });
      assert.equal(r.statusCode, 200, r.body);
      return r.headers["set-cookie"]!.toString().split(";")[0];
    }
    const first = await register("first@example.test"),
      second = await register("second@example.test");
    const owner = { ...headers, cookie: first },
      other = { ...headers, cookie: second };
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: "/api/subscription/test-purchase",
          headers: owner,
          payload: { plan: "solo" },
        })
      ).statusCode,
      404,
      "test purchases disabled by default",
    );
    assert.equal(
      (await app.inject({ url: "/api/me", headers: owner })).json().email,
      "first@example.test",
    );
    assert.equal(
      (
        await app.inject({
          method: "GET",
          url: "/api/stores/absent/orders",
          headers: owner,
        })
      ).statusCode,
      403,
    );
    assert.equal(
      (await app.inject({ url: "/api/me", headers: owner })).json().subscription
        .active,
      false,
    );
    await db.query(
      "INSERT INTO subscriptions(user_id,expires,cabinet_limit) SELECT id,$1,5 FROM users WHERE email=$2",
      [Date.now() + 86400000, "first@example.test"],
    );
    await db.query(
      "INSERT INTO subscriptions(user_id,expires,cabinet_limit) SELECT id,$1,5 FROM users WHERE email=$2",
      [Date.now() + 86400000, "second@example.test"],
    );
    const token = "synthetic-test-token-never-real-secret";
    const connected = await app.inject({
      method: "POST",
      url: "/api/stores",
      headers: owner,
      payload: { token },
    });
    assert.equal(connected.statusCode, 202, connected.body);
    const { id } = connected.json();
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: "/api/stores",
          headers: owner,
          payload: { token },
        })
      ).statusCode,
      409,
    );
    assert.equal(
      (await app.inject({ url: `/api/stores/${id}/orders`, headers: other }))
        .statusCode,
      404,
    );
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: `/api/stores/${id}/sync`,
          headers: other,
          payload: {},
        })
      ).statusCode,
      404,
    );
    const credential = (
      await db.query<{ credential: string }>("SELECT credential FROM stores")
    ).rows[0].credential;
    assert.ok(!credential.includes(token));
    await tick();
    assert.equal(calls, 1);
    const stores = (
      await app.inject({ url: "/api/stores", headers: owner })
    ).json().stores;
    assert.equal(stores[0].status, "ready");
    assert.equal(stores[0].name, "Тестовый продавец");
    assert.ok(!JSON.stringify(stores).includes(credential));
    const orders = (
      await app.inject({
        url: `/api/stores/${id}/orders?search=${encodeURIComponent("рубашка")}`,
        headers: owner,
      })
    ).json();
    assert.equal(orders.total, 1);
    assert.equal(orders.orders[0].warehouse_id, "47");
    assert.equal(
      (
        await app.inject({
          url: `/api/stores/${id}/orders?search=missing`,
          headers: owner,
        })
      ).json().total,
      0,
    );
    for (let i = 0; i < 3; i++)
      await app.inject({
        method: "POST",
        url: `/api/stores/${id}/sync`,
        headers: owner,
        payload: {},
      });
    assert.equal(
      (
        await db.query<{ count: number }>(
          "SELECT count(*)::int count FROM jobs WHERE status='queued'",
        )
      ).rows[0].count,
      1,
    );
    await tick();
    assert.equal(calls, 2, "manual refresh bypasses the one-minute background interval");
    await tick();
    assert.equal(calls, 2, "background refresh still waits a minute");
    limited = true;
    await db.query("UPDATE stores SET next_sync=0");
    await db.query("UPDATE api_cooldowns SET next_at=0");
    await tick();
    assert.equal(calls, 3);
    await app.inject({method:'POST',url:`/api/stores/${id}/sync`,headers:owner,payload:{}});
    await tick();
    assert.equal(calls, 3, "manual refresh cannot bypass a real WB 429 pause");
    assert.equal(
      (
        await app.inject({ url: `/api/stores/${id}/orders`, headers: owner })
      ).json().total,
      1,
      "cached orders survive upstream failure",
    );
    assert.equal(
      (await app.inject({ url: "/api/stores", headers: other })).json().stores
        .length,
      0,
    );
    await db.query(
      "UPDATE subscriptions SET expires=0 WHERE user_id=(SELECT id FROM users WHERE email=$1)",
      ["first@example.test"],
    );
    assert.equal(
      (await app.inject({ url: `/api/stores/${id}/orders`, headers: owner }))
        .statusCode,
      403,
    );
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: `/api/stores/${id}/sync`,
          headers: owner,
          payload: {},
        })
      ).statusCode,
      403,
    );
    assert.equal(
      (
        await app.inject({
          method: "GET",
          url: `/api/stores/${id}/orders?bypass=1`,
          headers: owner,
        })
      ).statusCode,
      403,
    );
    const requestsBeforeExpiryTick = calls;
    await tick();
    assert.equal(calls, requestsBeforeExpiryTick);
    const bad = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      headers,
      payload: { email: "first@example.test", password: "wrong-password" },
    });
    assert.equal(bad.statusCode, 401);
    const login = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      headers,
      payload: { email: "first@example.test", password: "Test-password-123" },
    });
    assert.equal(login.statusCode, 200);
    await app.inject({
      method: "POST",
      url: "/api/auth/logout",
      headers: owner,
      payload: {},
    });
    assert.equal(
      (await app.inject({ url: "/api/me", headers: owner })).statusCode,
      401,
    );
  } finally {
    await app.close();
  }
});

test("sessions, encrypted store and queued sync survive database restart", async () => {
  const folder = await mkdtemp(join(tmpdir(), "supplyo-test-")),
    key = randomBytes(32);
  const wb: WbClient = {
    seller: async () => ({
      sid: "persisted-seller",
      name: "Сохранённый магазин",
    }),
    orders: async () => [],
  };
  let instance = await createApp({ dataDir: folder, key, wb, worker: false });
  const headers = {
    origin: "http://127.0.0.1:8095",
    "x-supplyo-client": "web",
  };
  try {
    const signup = await instance.app.inject({
      method: "POST",
      url: "/api/auth/register",
      headers,
      payload: {
        name: "Проверка сохранения",
        email: "persistent@example.test",
        password: "Test-password-123",
        phone: "+79991234567",
        consent: true,
      },
    });
    const owner = {
      ...headers,
      cookie: signup.headers["set-cookie"]!.toString().split(";")[0],
    };
    await instance.db.query(
      "INSERT INTO subscriptions(user_id,expires,cabinet_limit) SELECT id,$1,5 FROM users",
      [Date.now() + 86400000],
    );
    await instance.app.inject({
      method: "POST",
      url: "/api/stores",
      headers: owner,
      payload: { token: "synthetic-persistence-test-token" },
    });
    await instance.app.close();
    instance = await createApp({ dataDir: folder, key, wb, worker: false });
    assert.equal(
      (await instance.app.inject({ url: "/api/me", headers: owner })).json()
        .email,
      "persistent@example.test",
    );
    await instance.tick();
    assert.equal(
      (await instance.app.inject({ url: "/api/stores", headers: owner })).json()
        .stores[0].name,
      "Сохранённый магазин",
    );
  } finally {
    await instance.app.close();
    assert.equal(resolve(folder), join(resolve(tmpdir()), basename(folder)));
    assert.ok(basename(folder).startsWith("supplyo-test-"));
    await rm(folder, { recursive: true, force: true });
  }
});
