import type { Express, Response } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { appConfigs, config, productApps } from "./config";
import { pool, tx, lock, assert, Fault } from "./db";
import { sessionAuth, csrf, serviceAuth, type Authenticated } from "./auth";
import { audit, reasonSchema } from "./entitlements";
import { encryptModelKey, decryptModelKey } from "./ai-crypto";

const defaults = {
  base_url: "https://api-relay.shizibandu.icu/v1",
  model: "gpt-6.1-terra",
  enabled: false,
  max_output_tokens: 2048,
  encrypted_key: null,
  revision: 0,
  last_check: null,
};
export const aiConfigSchema = z
  .object({
    base_url: z.url().refine((value) => {
      const u = new URL(value);
      const hosts = (process.env.AI_ALLOWED_HOSTS || "api-relay.shizibandu.icu")
        .split(",")
        .map((x) => x.trim());
      return (
        u.protocol === "https:" &&
        hosts.includes(u.hostname) &&
        !u.username &&
        !u.password &&
        !u.search &&
        !u.hash &&
        (!u.port || u.port === "443") &&
        u.pathname.replace(/\/$/, "") === "/v1"
      );
    }, "仅允许服务器登记的HTTPS模型地址，路径须为/v1"),
    model: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,127}$/),
    enabled: z.boolean(),
    max_output_tokens: z.number().int().min(1).max(32768),
    api_key: z.string().trim().min(16).max(3000).optional(),
    products: z
      .array(
        z.object({ product_id: z.string(), enabled: z.boolean() }).strict(),
      )
      .max(100),
    reason: reasonSchema,
  })
  .strict();
export const aiChatSchema = z
  .object({
    model: z.string().optional(),
    messages: z
      .array(
        z
          .object({
            role: z.enum(["system", "developer", "user", "assistant"]),
            content: z.string().min(1).max(12000),
          })
          .strict(),
      )
      .min(1)
      .max(32),
    stream: z.boolean().default(false),
    temperature: z.number().min(0).max(2).optional(),
    max_completion_tokens: z.number().int().min(1).max(32768).optional(),
  })
  .strict();
const requestId = z.string().regex(/^[a-zA-Z0-9_.:-]{8,128}$/);
async function configuration() {
  return (
    (await pool.query("SELECT * FROM ai_configuration WHERE id=true"))
      .rows[0] || defaults
  );
}
function safe(row: any) {
  const { encrypted_key, ...rest } = row;
  return { ...rest, has_key: !!encrypted_key };
}
export async function modelSettings() {
  const row = await configuration();
  const products = (
    await pool.query(
      "SELECT p.id,p.name,p.status,COALESCE(a.enabled,false) AS enabled FROM products p LEFT JOIN ai_product_access a ON a.product_id=p.id ORDER BY p.id",
    )
  ).rows;
  return {
    ...safe(row),
    products: products.map((p) => ({
      ...p,
      registered: !!appConfigs[p.id]?.enabled,
      ready: p.status === "active" && !!appConfigs[p.id]?.enabled,
    })),
    recent: (
      await pool.query(
        "SELECT id,product_id,request_id,model,CASE WHEN status='processing' AND created_at<now()-interval '2 minutes' THEN 'unknown' ELSE status END AS status,stream,http_status,error_code,created_at,finished_at FROM ai_requests ORDER BY created_at DESC LIMIT 20",
      )
    ).rows,
  };
}
export async function saveModelSettings(input: unknown, actor: string) {
  const b = aiConfigSchema.parse(input);
  assert(
    new Set(b.products.map((p) => p.product_id)).size === b.products.length,
    400,
    "DUPLICATE_PRODUCT",
    "产品授权重复",
  );
  return tx(async (db) => {
    await lock(db, "ai-configuration");
    const old =
      (
        await db.query(
          "SELECT * FROM ai_configuration WHERE id=true FOR UPDATE",
        )
      ).rows[0] || defaults;
    assert(
      !b.enabled || b.api_key || old.encrypted_key,
      400,
      "AI_KEY_REQUIRED",
      "请先配置API Key",
    );
    if (new URL(old.base_url).origin !== new URL(b.base_url).origin)
      assert(
        b.api_key,
        400,
        "AI_KEY_REQUIRED",
        "更换模型服务域名时须重新填写该服务的API Key",
      );
    for (const p of b.products) {
      const exists = (
        await db.query("SELECT status FROM products WHERE id=$1", [
          p.product_id,
        ])
      ).rows[0];
      assert(exists, 400, "PRODUCT_NOT_FOUND", "业务产品不存在");
      if (p.enabled)
        assert(
          exists.status === "active" && appConfigs[p.product_id]?.enabled,
          400,
          "PRODUCT_NOT_READY",
          "产品须启用并完成后端登记后才能授权",
        );
    }
    const encrypted = b.api_key
      ? encryptModelKey(b.api_key, config.REDEMPTION_PEPPER)
      : old.encrypted_key;
    const row = (
      await db.query(
        `INSERT INTO ai_configuration(id,base_url,model,enabled,max_output_tokens,encrypted_key,key_updated_at,updated_by)
      VALUES(true,$1,$2,$3,$4,$5,CASE WHEN $6 THEN now() ELSE $7::timestamptz END,$8)
      ON CONFLICT(id) DO UPDATE SET base_url=EXCLUDED.base_url,model=EXCLUDED.model,enabled=EXCLUDED.enabled,max_output_tokens=EXCLUDED.max_output_tokens,encrypted_key=EXCLUDED.encrypted_key,key_updated_at=EXCLUDED.key_updated_at,updated_by=EXCLUDED.updated_by,updated_at=now(),revision=ai_configuration.revision+1,last_check=null RETURNING *`,
        [
          b.base_url.replace(/\/$/, ""),
          b.model,
          b.enabled,
          b.max_output_tokens,
          encrypted,
          !!b.api_key,
          old.key_updated_at || null,
          actor,
        ],
      )
    ).rows[0];
    const beforeProducts = (
      await db.query(
        "SELECT product_id,enabled FROM ai_product_access ORDER BY product_id",
      )
    ).rows;
    await db.query(
      "UPDATE ai_product_access SET enabled=false,updated_at=now(),updated_by=$1",
      [actor],
    );
    for (const p of b.products)
      await db.query(
        "INSERT INTO ai_product_access(product_id,enabled,updated_by) VALUES($1,$2,$3) ON CONFLICT(product_id) DO UPDATE SET enabled=EXCLUDED.enabled,updated_by=EXCLUDED.updated_by,updated_at=now()",
        [p.product_id, p.enabled, actor],
      );
    await audit(
      db,
      actor,
      "ai.configuration",
      "model-api",
      b.reason,
      { ...safe(old), products: beforeProducts },
      { ...safe(row), products: b.products },
    );
    return safe(row);
  });
}
async function upstream(row: any, body: any, signal: AbortSignal) {
  assert(row.encrypted_key, 503, "AI_KEY_REQUIRED", "模型API尚未配置密钥");
  const secret = decryptModelKey(row.encrypted_key, config.REDEMPTION_PEPPER);
  return fetch(row.base_url + "/chat/completions", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + secret,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal,
    redirect: "error",
  });
}
export async function testModelSettings(actor: string) {
  const row = await configuration();
  assert(row.encrypted_key, 400, "AI_KEY_REQUIRED", "请先保存API Key");
  const checks: any[] = [];
  for (const stream of [false, true]) {
    try {
      const r = await upstream(
        row,
        {
          model: row.model,
          messages: [{ role: "user", content: "仅回复 OK" }],
          stream,
          max_completion_tokens: Math.min(row.max_output_tokens, 512),
        },
        AbortSignal.timeout(30000),
      );
      if (!r.ok) {
        checks.push({
          stream,
          status: "failed",
          http_status: r.status,
          detail:
            r.status === 401
              ? "密钥无效或已失效"
              : r.status === 429
                ? "上游限流，请稍后重试"
                : "上游拒绝请求，请检查模型与中转服务",
        });
        await r.body?.cancel();
        continue;
      }
      if (!stream) {
        const b = (await r.json()) as any;
        assert(
          b.choices?.some((x: any) => x.message?.content),
          502,
          "AI_EMPTY",
          "模型没有返回内容",
        );
      } else {
        assert(
          r.headers.get("content-type")?.includes("text/event-stream"),
          502,
          "AI_STREAM_TYPE",
          "上游未返回SSE",
        );
        const text = await r.text();
        assert(
          text.includes("[DONE]") && /"content"\s*:\s*"[^"\s]/.test(text),
          502,
          "AI_STREAM_EMPTY",
          "SSE未收到内容或结束标记",
        );
      }
      checks.push({ stream, status: "success", http_status: r.status });
    } catch (e) {
      checks.push({
        stream,
        status: "failed",
        detail:
          e instanceof Fault
            ? e.message
            : "连接超时或网络错误，请检查服务器到模型服务的连接",
      });
    }
  }
  const result = {
    status: checks.every((c) => c.status === "success") ? "success" : "failed",
    checked_at: new Date().toISOString(),
    revision: row.revision,
    checks,
  };
  await tx(async (db) => {
    await db.query(
      "UPDATE ai_configuration SET last_check=$1 WHERE id=true AND revision=$2",
      [result, row.revision],
    );
    await audit(
      db,
      actor,
      "ai.test",
      "model-api",
      "管理员验证模型服务",
      null,
      result,
    );
  });
  return result;
}
async function authorizedProduct(product: string) {
  const p = (
    await pool.query(
      "SELECT p.status,a.enabled FROM products p LEFT JOIN ai_product_access a ON a.product_id=p.id WHERE p.id=$1",
      [product],
    )
  ).rows[0];
  assert(
    p?.status === "active" && p.enabled,
    403,
    "AI_PRODUCT_DENIED",
    "当前产品未获模型调用授权或已停用",
  );
  const row = await configuration();
  assert(
    row.enabled && row.encrypted_key,
    503,
    "AI_DISABLED",
    "模型API尚未启用",
  );
  return row;
}
const active = new Map<string, number>();
export async function handleModelChat(req: Authenticated, res: Response) {
  const product = req.serviceProduct!,
    row = await authorizedProduct(product),
    b = aiChatSchema.parse(req.body),
    id = requestId.parse(req.headers["x-request-id"]);
  assert(
    !b.model || b.model === row.model,
    403,
    "AI_MODEL_DENIED",
    "当前模型未获授权",
  );
  assert(
    !b.max_completion_tokens ||
      b.max_completion_tokens <= row.max_output_tokens,
    400,
    "AI_TOKEN_LIMIT",
    "输出上限超过产品允许范围",
  );
  assert(
    (active.get(product) || 0) < 2 &&
      [...active.values()].reduce((a, b) => a + b, 0) < 8,
    429,
    "AI_BUSY",
    "模型请求较多，请稍后重试",
  );
  active.set(product, (active.get(product) || 0) + 1);
  let created;
  try {
    created = await pool.query(
      "INSERT INTO ai_requests(product_id,uid,request_id,model,config_revision,status,stream) VALUES($1,$2,$3,$4,$5,'processing',$6) ON CONFLICT(product_id,request_id) DO NOTHING RETURNING id",
      [product, req.identity.uid, id, row.model, row.revision, b.stream],
    );
    assert(
      created.rowCount,
      409,
      "AI_DUPLICATE_REQUEST",
      "此请求号已受理，请查询状态，不要更换请求号重试",
    );
  } catch (e) {
    active.set(product, Math.max(0, (active.get(product) || 1) - 1));
    throw e;
  }
  const abort = new AbortController(),
    timeout = setTimeout(() => abort.abort(), 90000);
  const closed = () => {
    if (!res.writableEnded) abort.abort();
  };
  res.on("close", closed);
  let status = "unknown",
    httpStatus: number | null = null,
    errorCode: string | null = null;
  try {
    const r = await upstream(
      row,
      {
        ...b,
        model: row.model,
        max_completion_tokens: b.max_completion_tokens || row.max_output_tokens,
      },
      abort.signal,
    );
    httpStatus = r.status;
    if (!r.ok) {
      await r.body?.cancel();
      status = "failed";
      errorCode = "AI_UPSTREAM_" + r.status;
      throw new Fault(
        502,
        errorCode,
        r.status === 429
          ? "模型服务限流，请稍后查询任务状态"
          : "模型服务拒绝请求，请联系管理员检查配置",
      );
    }
    if (!b.stream) {
      const output = (await r.json()) as any;
      assert(
        Array.isArray(output.choices),
        502,
        "AI_INVALID_RESPONSE",
        "模型服务响应格式不正确",
      );
      status = "completed";
      res.json(output);
    } else {
      assert(
        r.headers.get("content-type")?.includes("text/event-stream") && r.body,
        502,
        "AI_INVALID_STREAM",
        "模型服务未返回SSE",
      );
      res.status(200).set({
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-store, no-transform",
        "X-Accel-Buffering": "no",
      });
      res.flushHeaders();
      const reader = r.body.getReader(),
        decoder = new TextDecoder();
      let tail = "",
        done = false;
      try {
        while (true) {
          const next = await reader.read();
          if (next.done) break;
          tail = (tail + decoder.decode(next.value, { stream: true })).slice(
            -256,
          );
          if (tail.includes("[DONE]")) done = true;
          if (!res.write(Buffer.from(next.value)))
            await new Promise<void>((resolve, reject) => {
              const cleanup = () => {
                res.off("drain", ready);
                abort.signal.removeEventListener("abort", stop);
              };
              const ready = () => {
                cleanup();
                resolve();
              };
              const stop = () => {
                cleanup();
                reject(Error("aborted"));
              };
              res.once("drain", ready);
              abort.signal.addEventListener("abort", stop, { once: true });
              if (abort.signal.aborted) stop();
            });
        }
      } finally {
        reader.releaseLock();
      }
      status = done ? "completed" : "unknown";
      res.end();
    }
  } catch (e) {
    errorCode ||= e instanceof Fault ? e.code : "AI_RESULT_UNKNOWN";
    if (res.headersSent) {
      res.destroy();
    } else if (!res.destroyed) {
      if (e instanceof Fault) throw e;
      throw new Fault(
        504,
        "AI_RESULT_UNKNOWN",
        "模型调用结果未知，请查询原请求号；不要自动重试或重复扣次",
      );
    }
  } finally {
    clearTimeout(timeout);
    res.off("close", closed);
    active.set(product, Math.max(0, (active.get(product) || 1) - 1));
    await pool.query(
      "UPDATE ai_requests SET status=$1,http_status=$2,error_code=$3,finished_at=now() WHERE id=$4",
      [status, httpStatus, errorCode, created.rows[0].id],
    );
  }
}
export function installAiGateway(app: Express) {
  // These middleware are local to this router; do not depend on route order in main.ts.
  const admin = [sessionAuth("admin"), csrf("admin")];
  app.get("/api/admin/ai", ...admin, async (_req, res) =>
    res.json(await modelSettings()),
  );
  app.put("/api/admin/ai", ...admin, async (req: Authenticated, res) =>
    res.json(await saveModelSettings(req.body, req.identity.uid)),
  );
  app.post(
    "/api/admin/ai/test",
    ...admin,
    rateLimit({ windowMs: 60000, limit: 3 }),
    async (req: Authenticated, res) => {
      z.object({}).strict().parse(req.body);
      res.json(await testModelSettings(req.identity.uid));
    },
  );
  const product = [serviceAuth];
  app.get(
    "/api/v1/products/:product/ai/config",
    ...product,
    async (req: Authenticated, res) => {
      const row = await authorizedProduct(req.serviceProduct!);
      res.json({
        model: row.model,
        base_url:
          config.CENTER_URL + "/api/v1/products/" + req.serviceProduct + "/ai",
        max_output_tokens: row.max_output_tokens,
      });
    },
  );
  app.get(
    "/api/v1/products/:product/ai/requests/:requestId",
    ...product,
    async (req: Authenticated, res) => {
      const id = requestId.parse(req.params.requestId);
      const record = (
        await pool.query(
          "SELECT request_id,model,CASE WHEN status='processing' AND created_at<now()-interval '2 minutes' THEN 'unknown' ELSE status END AS status,stream,http_status,error_code,created_at,finished_at FROM ai_requests WHERE product_id=$1 AND uid=$2 AND request_id=$3",
          [req.serviceProduct, req.identity.uid, id],
        )
      ).rows[0];
      assert(
        record,
        404,
        "AI_REQUEST_NOT_FOUND",
        "没有此账号和产品的模型请求记录",
      );
      res.json({ ...record, delivery_status: "unknown" });
    },
  );
  app.post(
    "/api/v1/products/:product/ai/chat/completions",
    ...product,
    rateLimit({
      windowMs: 60000,
      limit: 20,
      keyGenerator: (req: Authenticated) => req.serviceProduct!,
    }),
    handleModelChat,
  );
}
