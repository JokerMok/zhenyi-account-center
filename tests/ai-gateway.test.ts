import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import dotenv from "dotenv";
import pg from "pg";
import express from "express";
import cookieParser from "cookie-parser";
import { encryptModelKey, decryptModelKey } from "../src/server/ai-crypto";

test("模型Key加密使用隔离用途，错误材料与篡改不能解密", () => {
  const material = "machine-material-".repeat(4),
    secret = "gateway-secret-".repeat(4),
    encrypted = encryptModelKey(secret, material);
  assert(!encrypted.includes(secret));
  assert.equal(decryptModelKey(encrypted, material), secret);
  assert.throws(() => decryptModelKey(encrypted, "wrong-material-".repeat(4)));
  const parts = encrypted.split(".");
  parts[2] = "A" + parts[2].slice(1);
  assert.throws(() => decryptModelKey(parts.join("."), material));
});

test("模型配置、产品授权、幂等与未知结果，使用独立PostgreSQL schema", async () => {
  dotenv.config({ quiet: true });
  assert.notEqual(process.env.NODE_ENV, "production");
  const url = new URL(process.env.DATABASE_URL!),
    schema = "qa_ai_" + randomUUID().replaceAll("-", "");
  const owner = new pg.Pool({ connectionString: url.toString() });
  await owner.query("CREATE SCHEMA " + schema);
  url.searchParams.set("options", "-c search_path=" + schema);
  process.env.DATABASE_URL = url.toString();
  const { pool } = await import("../src/server/db"),
    { productApps } = await import("../src/server/config");
  const ai = await import("../src/server/ai-gateway");
  const originalFetch = globalThis.fetch;
  let server: any;
  try {
    await pool.query(
      "CREATE TABLE identities(uid uuid PRIMARY KEY);CREATE TABLE products(id text PRIMARY KEY,name text,status text);CREATE TABLE audit(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,actor_uid uuid,action text,target text,reason text,before_value jsonb,after_value jsonb,created_at timestamptz DEFAULT now())",
    );
    await pool.query(await readFile("migrations/006_ai_gateway.sql", "utf8"));
    const actor = randomUUID(),
      other = randomUUID(),
      product = productApps.find((p) => p.enabled)!.id;
    await pool.query("INSERT INTO identities VALUES($1),($2)", [actor, other]);
    await pool.query(
      "INSERT INTO products VALUES($1,'验收产品','active'),('unregistered_ai','未登记产品','active')",
      [product],
    );
    const secret = "test-model-key-" + randomUUID();
    const body = {
      base_url: "https://api-relay.shizibandu.icu/v1",
      model: "gpt-6.1-terra",
      enabled: true,
      max_output_tokens: 512,
      api_key: secret,
      products: [{ product_id: product, enabled: true }],
      reason: "隔离测试配置",
    };
    assert.throws(() =>
      ai.aiConfigSchema.parse({ ...body, base_url: "http://127.0.0.1/v1" }),
    );
    assert.throws(() =>
      ai.aiConfigSchema.parse({
        ...body,
        base_url: "https://api-relay.shizibandu.icu.evil.test/v1",
      }),
    );
    await assert.rejects(
      () =>
        ai.saveModelSettings(
          {
            ...body,
            products: [{ product_id: "unregistered_ai", enabled: true }],
          },
          actor,
        ),
      /登记/,
    );
    await ai.saveModelSettings(body, actor);
    const read = await ai.modelSettings();
    assert.equal(read.has_key, true);
    assert(!JSON.stringify(read).includes(secret));
    assert(!("encrypted_key" in read));
    const saved = (await pool.query("SELECT * FROM ai_configuration")).rows[0];
    assert(!saved.encrypted_key.includes(secret));
    assert(
      !JSON.stringify((await pool.query("SELECT * FROM audit")).rows).includes(
        secret,
      ),
    );
    const { api_key, ...keep } = body;
    await ai.saveModelSettings(keep, actor);
    assert.equal(
      (await pool.query("SELECT encrypted_key FROM ai_configuration")).rows[0]
        .encrypted_key,
      saved.encrypted_key,
    );
    let calls = 0;
    globalThis.fetch = (async (input: any, init: any) => {
      calls++;
      assert.equal(
        String(input),
        "https://api-relay.shizibandu.icu/v1/chat/completions",
      );
      assert.equal(init.headers.Authorization, "Bearer " + secret);
      const b = JSON.parse(init.body);
      return b.stream
        ? new Response(
            'data: {"choices":[{"delta":{"content":"OK"}}]}\n\ndata: [DONE]\n\n',
            { headers: { "Content-Type": "text/event-stream" } },
          )
        : new Response(
            JSON.stringify({ choices: [{ message: { content: "OK" } }] }),
            { headers: { "Content-Type": "application/json" } },
          );
    }) as any;
    assert.equal((await ai.testModelSettings(actor)).status, "success");
    assert.equal(calls, 2);
    globalThis.fetch = originalFetch;
    const app = express();
    app.use(express.json(), cookieParser());
    ai.installAiGateway(app);
    // Only this isolated test fixture supplies a previously verified identity.
    app.post("/fixture/chat", async (req: any, res, next) => {
      req.serviceProduct = product;
      req.identity = { uid: actor };
      try {
        await ai.handleModelChat(req, res);
      } catch (e) {
        next(e);
      }
    });
    app.use((e: any, _req: any, res: any, _next: any) =>
      res.status(e.status || 500).json({ code: e.code, error: e.message }),
    );
    server = await new Promise<any>((resolve) => {
      const s = app.listen(0, "127.0.0.1", () => resolve(s));
    });
    const base = "http://127.0.0.1:" + server.address().port;
    assert.equal((await originalFetch(base + "/api/admin/ai")).status, 401);
    assert.equal(
      (await originalFetch(base + "/api/v1/products/" + product + "/ai/config"))
        .status,
      401,
    );
    assert.equal(
      (
        await originalFetch(
          base + "/api/v1/products/unregistered_ai/ai/config",
          {
            headers: {
              Authorization:
                "Bearer " +
                productApps.find((p) => p.id === product)!.serviceKey,
            },
          },
        )
      ).status,
      403,
    );
    const send = (id: string, stream = false, model = "gpt-6.1-terra") =>
      originalFetch(base + "/fixture/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Request-ID": id },
        body: JSON.stringify({
          model,
          messages: [{ role: "user", content: "OK" }],
          stream,
        }),
      });
    globalThis.fetch = (async (_u: any, init: any) => {
      calls++;
      const b = JSON.parse(init.body);
      return b.stream
        ? new Response(
            'data: {"choices":[{"delta":{"content":"OK"}}]}\n\ndata: [DONE]\n\n',
            { headers: { "Content-Type": "text/event-stream" } },
          )
        : new Response('{"choices":[{"message":{"content":"OK"}}]}', {
            headers: { "Content-Type": "application/json" },
          });
    }) as any;
    assert.equal(
      (await send("model-denied-01", false, "not-allowed")).status,
      403,
    );
    const before = calls;
    const same = await Promise.all([
      send("same-request-01"),
      send("same-request-01"),
    ]);
    assert.deepEqual(same.map((r) => r.status).sort(), [200, 409]);
    assert.equal(calls, before + 1);
    const stream = await send("stream-test-01", true);
    assert.equal(stream.status, 200);
    assert((await stream.text()).includes("[DONE]"));
    globalThis.fetch = (async () => {
      throw Error("network timeout");
    }) as any;
    assert.equal((await send("unknown-test-01")).status, 504);
    assert.equal((await send("unknown-test-01")).status, 409);
    assert.equal(
      (
        await pool.query(
          "SELECT status FROM ai_requests WHERE request_id='unknown-test-01'",
        )
      ).rows[0].status,
      "unknown",
    );
    await pool.query("UPDATE products SET status='disabled' WHERE id=$1", [
      product,
    ]);
    assert.equal((await send("disabled-test-01")).status, 403);
    assert(
      !JSON.stringify(
        (await pool.query("SELECT * FROM ai_requests")).rows,
      ).includes(secret),
    );
  } finally {
    globalThis.fetch = originalFetch;
    if (server) await new Promise<void>((r) => server.close(() => r()));
    await pool.end();
    await owner.query("DROP SCHEMA " + schema + " CASCADE");
    await owner.end();
  }
});
