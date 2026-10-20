import express, {
  type Request,
  type Response,
  type NextFunction,
} from "express";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { resolve } from "node:path";
import { z, ZodError } from "zod";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { config, appConfigs } from "./config";
import { pool, tx, assert, Fault, lock } from "./db";
import {
  installAuth,
  sessionAuth,
  csrf,
  serviceAuth,
  type Authenticated,
} from "./auth";
import { casdoorApi, reconcile, upstreamLogout } from "./casdoor";
import { catalog, saveCatalog, seedCatalog } from "./catalog";
import {
  overview,
  checkAccess,
  reserve,
  transition,
  releaseExpired,
  reserveSchema,
  grant,
  grantSchema,
  createCode,
  codeSchema,
  redeem,
  audit,
  reasonSchema,
  ident,
} from "./entitlements";

const serverId = (process.env.APP_ID || "center") as
  | "center"
  | "beadgrid"
  | "focustake";
assert(
  ["center", "beadgrid", "focustake"].includes(serverId),
  500,
  "APP_CONFIG",
  "APP_ID 配置错误",
);
const app = express();
app.disable("x-powered-by");
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:"],
        scriptSrc: ["'self'"],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        upgradeInsecureRequests: config.production ? [] : null,
      },
    },
    hsts: config.production ? undefined : false,
  }),
);
app.use(express.json({ limit: "32kb" }));
app.use(cookieParser());
app.use((req, res, next) => {
  if (req.path.startsWith("/api") || req.path.startsWith("/auth"))
    res.set("Cache-Control", "no-store");
  next();
});
app.use(
  "/auth",
  rateLimit({
    windowMs: 60000,
    limit: 60,
    standardHeaders: "draft-8",
    legacyHeaders: false,
  }),
);
app.get("/api/health", async (_req, res) => {
  await pool.query("SELECT 1");
  res.json({ ok: true, app: serverId });
});
app.get("/api/config", (_req, res) =>
  res.json({
    id: serverId,
    name: appConfigs[serverId].name,
    casdoor: config.CASDOOR_URL,
    center: config.CENTER_URL,
    beadgrid: config.BEADGRID_URL,
    focustake: config.FOCUSTAKE_URL,
    login: "/auth/login",
    signup: `${config.CASDOOR_URL}/signup/${appConfigs[serverId].application}`,
    services: {
      sms: "未配置",
      email: "未配置",
      wechat: "未配置",
      payments: "未配置真实商户；未启用收费",
    },
  }),
);
installAuth(app, serverId);

if (serverId === "center") {
  app.get(
    "/api/v1/products/:product/identity",
    serviceAuth,
    (req: Authenticated, res) => res.json({ user: req.identity }),
  );
  app.post(
    "/api/v1/products/:product/logout-all",
    serviceAuth,
    async (req: Authenticated, res) => {
      z.object({}).strict().parse(req.body);
      await pool.query("DELETE FROM sessions WHERE uid=$1", [req.identity.uid]);
      await upstreamLogout(String(req.headers["x-user-token"]));
      res.json({ ok: true, scope: "all-products-and-casdoor" });
    },
  );
  app.get(
    "/api/v1/products/:product/entitlements",
    serviceAuth,
    async (req: Authenticated, res) =>
      res.json(await overview(req.identity.uid, req.serviceProduct!)),
  );
  app.post(
    "/api/v1/products/:product/check",
    serviceAuth,
    async (req: Authenticated, res) => {
      const b = z.object({ feature_id: z.string() }).strict().parse(req.body);
      res.json(
        await checkAccess(req.identity.uid, req.serviceProduct!, b.feature_id),
      );
    },
  );
  app.post(
    "/api/v1/products/:product/reservations",
    serviceAuth,
    async (req: Authenticated, res) =>
      res.json(
        await reserve(
          req.identity.uid,
          req.serviceProduct!,
          reserveSchema.parse(req.body),
        ),
      ),
  );
  app.post(
    "/api/v1/products/:product/reservations/:id/:action",
    serviceAuth,
    async (req: Authenticated, res) => {
      z.object({}).strict().parse(req.body);
      const id = ident.parse(req.params.id),
        action = z
          .enum(["confirm", "cancel", "refund"])
          .parse(req.params.action);
      res.json(
        await transition(req.identity.uid, req.serviceProduct!, id, action),
      );
    },
  );
  app.use("/api/admin", sessionAuth("admin"), csrf("admin"));
  app.get("/api/admin/me", (req: Authenticated, res) =>
    res.json({ user: req.identity, csrf: req.session.csrf, isAdmin: true }),
  );
  app.get("/api/admin/catalog", async (_req, res) => res.json(await catalog()));
  app.put("/api/admin/catalog/:type", async (req: Authenticated, res) =>
    res.json(
      await saveCatalog(
        req.identity.uid,
        z.enum(["products", "features", "plans"]).parse(req.params.type),
        req.body,
      ),
    ),
  );
  app.get("/api/admin/users", async (req, res) => {
    const q = String(req.query.q || "").slice(0, 100);
    // Refresh identity status for Casdoor users, including consumers who have never visited the center.
    const users = await casdoorApi("get-users", { owner: "consumers" });
    for (const u of users)
      await pool.query(
        `INSERT INTO identities(issuer,subject,organization,username,display_name) VALUES($1,$2,$3,$4,$5)
    ON CONFLICT(issuer,subject) DO UPDATE SET username=EXCLUDED.username,display_name=EXCLUDED.display_name`,
        [config.CASDOOR_URL, u.id, u.owner, u.name, u.displayName || u.name],
      );
    if (req.query.paginated === "1") {
      const page = z.coerce
        .number()
        .int()
        .min(1)
        .default(1)
        .parse(req.query.page);
      const size = 20;
      const product = String(req.query.product || "");
      const status = z
        .enum(["", "normal", "blocked"])
        .default("")
        .parse(req.query.status);
      const membership = z
        .enum(["", "active", "expired", "none"])
        .default("")
        .parse(req.query.membership);
      const dataKind = z
        .enum(["all", "test", "business"])
        .default("all")
        .parse(req.query.data_kind);
      const forbidden = users
        .filter((u: any) => u.isForbidden)
        .map((u: any) => u.id);
      const values: unknown[] = [
        `%${q}%`,
        q,
        product,
        forbidden,
        status,
        membership,
        dataKind,
      ];
      const base = `WITH member_dates AS (
        SELECT uid,product_id,max(expires_at) AS expires_at FROM (
          SELECT uid,product_id,expires_at FROM memberships UNION ALL
          SELECT uid,product_id,expires_at FROM subscription_projections WHERE active
        ) m GROUP BY uid,product_id
      ), source AS (
        SELECT i.*, i.subject = ANY($4::text[]) AS casdoor_blocked,
          i.username ~ '^(test_|dummy_test_|probe_|qa_)' AS is_test,
          COALESCE((SELECT jsonb_agg(jsonb_build_object('product_id',p.id,'product_name',p.name,'status',p.status,
            'expires_at',m.expires_at,'active',COALESCE(m.expires_at>now(),false),
            'quotas',COALESCE((SELECT jsonb_agg(jsonb_build_object('name',f.name,'remaining',b.remaining))
              FROM (SELECT feature_id,sum(remaining)::int AS remaining FROM quota_buckets
                WHERE uid=i.uid AND product_id=p.id AND (expires_at IS NULL OR expires_at>now()) GROUP BY feature_id) b
              JOIN features f ON f.product_id=p.id AND f.id=b.feature_id AND f.active),'[]'::jsonb)))
            FROM products p LEFT JOIN member_dates m ON m.uid=i.uid AND m.product_id=p.id
            WHERE ($3='' OR p.id=$3)), '[]'::jsonb) AS rights
        FROM identities i WHERE organization='consumers'
          AND (username ILIKE $1 OR display_name ILIKE $1 OR uid::text=$2)
      ), filtered AS (SELECT * FROM source WHERE
        ($5='' OR ($5='blocked' AND (blocked OR casdoor_blocked)) OR ($5='normal' AND NOT blocked AND NOT casdoor_blocked))
        AND ($7='all' OR ($7='test' AND is_test) OR ($7='business' AND NOT is_test))
        AND ($6='' OR EXISTS(SELECT 1 FROM jsonb_array_elements(rights) r WHERE
          ($6='active' AND (r->>'active')::boolean) OR ($6='expired' AND r->>'expires_at' IS NOT NULL AND NOT (r->>'active')::boolean)
          OR ($6='none' AND r->>'expires_at' IS NULL))))`;
      const total = Number(
        (await pool.query(base + " SELECT count(*) FROM filtered", values))
          .rows[0].count,
      );
      const items = (
        await pool.query(
          base +
            " SELECT * FROM filtered ORDER BY created_at DESC,uid LIMIT $8 OFFSET $9",
          [...values, size, (page - 1) * size],
        )
      ).rows;
      res.json({ items, total, page, page_size: size });
      return;
    }
    const rows = (
      await pool.query(
        "SELECT * FROM identities WHERE organization='consumers' AND (username ILIKE $1 OR display_name ILIKE $1 OR uid::text=$2) ORDER BY created_at DESC LIMIT 100",
        [`%${q}%`, q],
      )
    ).rows;
    res.json(
      rows.map((r) => ({
        ...r,
        casdoor_blocked: !!users.find((u: any) => u.id === r.subject)
          ?.isForbidden,
      })),
    );
  });
  app.get("/api/admin/users/:uid/entitlements", async (req, res) => {
    const uid = ident.parse(req.params.uid);
    const p = (
      await pool.query("SELECT id FROM products WHERE status='active'")
    ).rows;
    res.json(await Promise.all(p.map((p) => overview(uid, p.id))));
  });
  app.post("/api/admin/grants", async (req: Authenticated, res) =>
    res.json({
      result: await grant(req.identity.uid, grantSchema.parse(req.body)),
    }),
  );
  app.post("/api/admin/users/:uid/status", async (req: Authenticated, res) => {
    const uid = ident.parse(req.params.uid);
    const b = z
      .object({ blocked: z.boolean(), reason: reasonSchema })
      .strict()
      .parse(req.body);
    assert(
      uid !== req.identity.uid,
      400,
      "SELF_BLOCK",
      "不能在此停用当前管理员",
    );
    const result = await tx(async (db) => {
      const before = (
        await db.query("SELECT * FROM identities WHERE uid=$1 FOR UPDATE", [
          uid,
        ])
      ).rows[0];
      assert(before, 404, "USER_NOT_FOUND", "用户不存在");
      const after = (
        await db.query(
          "UPDATE identities SET blocked=$1 WHERE uid=$2 RETURNING *",
          [b.blocked, uid],
        )
      ).rows[0];
      if (b.blocked) await db.query("DELETE FROM sessions WHERE uid=$1", [uid]);
      await audit(
        db,
        req.identity.uid,
        "user_status",
        uid,
        b.reason,
        before,
        after,
      );
      return after;
    });
    res.json(result);
  });
  app.get("/api/admin/codes", async (req, res) => {
    const fields =
      "id,hint,product_id,days,feature_id,amount,max_uses,uses,active,expires_at,quota_expires_at,created_at";
    if (req.query.paginated !== "1") {
      res.json(
        (
          await pool.query(
            `SELECT ${fields} FROM redemption_codes ORDER BY created_at DESC LIMIT 200`,
          )
        ).rows,
      );
      return;
    }
    const page = z.coerce
      .number()
      .int()
      .min(1)
      .default(1)
      .parse(req.query.page);
    const status = z
      .enum(["", "available", "expired", "exhausted", "disabled"])
      .default("")
      .parse(req.query.status);
    const args = [
      String(req.query.product || ""),
      "%" + String(req.query.q || "").slice(0, 50) + "%",
      status,
    ];
    const where = ` WHERE ($1='' OR product_id=$1) AND hint ILIKE $2 AND ($3='' OR
      ($3='disabled' AND NOT active) OR ($3='expired' AND active AND expires_at<=now()) OR
      ($3='exhausted' AND active AND expires_at>now() AND uses>=max_uses) OR
      ($3='available' AND active AND expires_at>now() AND uses<max_uses))`;
    const total = Number(
      (await pool.query("SELECT count(*) FROM redemption_codes" + where, args))
        .rows[0].count,
    );
    const items = (
      await pool.query(
        `SELECT ${fields} FROM redemption_codes` +
          where +
          " ORDER BY created_at DESC,id LIMIT 20 OFFSET $4",
        [...args, (page - 1) * 20],
      )
    ).rows;
    res.json({ items, total, page, page_size: 20 });
  });
  app.post("/api/admin/codes", async (req: Authenticated, res) =>
    res.json(await createCode(req.identity.uid, codeSchema.parse(req.body))),
  );
  app.post("/api/admin/codes/:id/status", async (req: Authenticated, res) => {
    const id = ident.parse(req.params.id),
      b = z
        .object({ active: z.boolean(), reason: reasonSchema })
        .strict()
        .parse(req.body);
    const r = await tx(async (db) => {
      const before = (
        await db.query(
          "SELECT id,hint,active FROM redemption_codes WHERE id=$1 FOR UPDATE",
          [id],
        )
      ).rows[0];
      assert(before, 404, "CODE_NOT_FOUND", "兑换码不存在");
      const after = (
        await db.query(
          "UPDATE redemption_codes SET active=$1 WHERE id=$2 RETURNING id,hint,active",
          [b.active, id],
        )
      ).rows[0];
      await audit(
        db,
        req.identity.uid,
        "code_status",
        id,
        b.reason,
        before,
        after,
      );
      return after;
    });
    res.json(r);
  });
  app.get("/api/admin/records/:type", async (req, res) => {
    const type = z
      .enum([
        "ledger",
        "audit",
        "redemptions",
        "reservations",
        "reconcile_runs",
      ])
      .parse(req.params.type);
    if (req.query.paginated === "1" && ["ledger", "audit"].includes(type)) {
      const page = z.coerce
        .number()
        .int()
        .min(1)
        .default(1)
        .parse(req.query.page);
      const values: unknown[] = [];
      const clauses: string[] = [];
      const bind = (v: unknown) => {
        values.push(v);
        return "$" + values.length;
      };
      const product = String(req.query.product || "");
      if (product)
        clauses.push(
          type === "ledger"
            ? `r.product_id=${bind(product)}`
            : (() => {
                const v = bind(product);
                return `(r.target=${v} OR split_part(r.target,'/',1)=${v} OR split_part(r.target,'/',2)=${v} OR r.after_value->>'product_id'=${v} OR r.before_value->>'product_id'=${v} OR EXISTS(SELECT 1 FROM redemption_codes rc WHERE rc.id::text=r.target AND rc.product_id=${v}))`;
              })(),
        );
      if (req.query.action)
        clauses.push(`r.action=${bind(String(req.query.action))}`);
      if (req.query.q) {
        const v = bind("%" + String(req.query.q).slice(0, 100) + "%");
        clauses.push(
          `(i.display_name ILIKE ${v} OR i.username ILIKE ${v} OR i.uid::text ILIKE ${v}${type === "ledger" ? ` OR r.reference ILIKE ${v} OR rs.request_id ILIKE ${v}` : ` OR r.target ILIKE ${v} OR r.reason ILIKE ${v} OR subject_identity.display_name ILIKE ${v} OR subject_identity.username ILIKE ${v}`})`,
        );
      }
      for (const [key, operator] of [
        ["from", ">="],
        ["to", "<"],
      ] as const)
        if (req.query[key]) {
          const d = z.coerce.date().parse(req.query[key]);
          if (key === "to") d.setUTCDate(d.getUTCDate() + 1);
          clauses.push(`r.created_at${operator}${bind(d.toISOString())}`);
        }
      if (type === "ledger" && req.query.reconcile === "hide")
        clauses.push("r.action<>'subscription_reconcile'");
      if (req.query.data_kind === "test")
        clauses.push("i.username ~ '^(test_|dummy_test_|probe_|qa_)'");
      if (req.query.data_kind === "business")
        clauses.push("i.username !~ '^(test_|dummy_test_|probe_|qa_)'");
      const join = ` FROM ${type} r LEFT JOIN identities i ON i.uid=r.${type === "audit" ? "actor_uid" : "uid"} ${type === "audit" ? "LEFT JOIN identities subject_identity ON subject_identity.uid::text=split_part(r.target,'/',1) LEFT JOIN redemption_codes rc ON rc.id::text=r.target" : "LEFT JOIN products p ON p.id=r.product_id LEFT JOIN features f ON f.product_id=r.product_id AND f.id=r.feature_id LEFT JOIN reservations rs ON rs.id::text=r.reference"} ${clauses.length ? "WHERE " + clauses.join(" AND ") : ""}`;
      const total = Number(
        (await pool.query("SELECT count(*)" + join, values)).rows[0].count,
      );
      const items = (
        await pool.query(
          `SELECT r.*,i.display_name,i.username${type === "audit" ? ",subject_identity.display_name AS target_name,rc.hint AS code_hint" : ",p.name AS product_name,f.name AS feature_name,rs.request_id AS business_request"}` +
            join +
            ` ORDER BY r.created_at DESC,r.id DESC LIMIT 20 OFFSET ${bind((page - 1) * 20)}`,
          values,
        )
      ).rows;
      res.json({ items, total, page, page_size: 20 });
      return;
    }
    const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 100)),
      offset = Math.max(0, Number(req.query.offset) || 0);
    const uid = req.query.uid ? ident.parse(req.query.uid) : null;
    const condition =
      uid && ["ledger", "redemptions", "reservations"].includes(type)
        ? " WHERE uid=$3"
        : "";
    res.json(
      (
        await pool.query(
          `SELECT * FROM ${type}${condition} ORDER BY created_at DESC LIMIT $1 OFFSET $2`,
          condition ? [limit, offset, uid] : [limit, offset],
        )
      ).rows,
    );
  });
  app.get("/api/admin/subscriptions", async (_req, res) => {
    const [subscriptions, payments, plans, providers, consumerProviders] =
      await Promise.all([
        casdoorApi("get-subscriptions", { owner: "consumers" }),
        casdoorApi("get-payments", { owner: "consumers" }),
        casdoorApi("get-plans", { owner: "consumers" }),
        casdoorApi("get-providers", { owner: "admin" }),
        casdoorApi("get-providers", { owner: "consumers" }),
      ]);
    const testPayment = await readFile(
      ".local/dummy-payment-result.json",
      "utf8",
    )
      .then((s) => JSON.parse(s))
      .catch(() => null);
    res.json({
      subscriptions,
      payments,
      plans,
      testPayment,
      paymentProviders: [...providers, ...consumerProviders]
        .filter((p: any) => p.category === "Payment")
        .map((p: any) => ({ name: p.name, type: p.type })),
      projections: (
        await pool.query(
          "SELECT * FROM subscription_projections ORDER BY updated_at DESC LIMIT 100",
        )
      ).rows,
      lastRun:
        (
          await pool.query(
            "SELECT * FROM reconcile_runs ORDER BY id DESC LIMIT 1",
          )
        ).rows[0] || null,
      chargingEnabled: false,
    });
  });
  app.post("/api/admin/reconcile", async (req: Authenticated, res) =>
    res.json(await reconcile(req.identity.uid)),
  );
  app.use("/api", sessionAuth("center"), csrf("center"), (req, _res, next) => {
    if (req.query.uid || req.query.user_id)
      throw new Fault(403, "CROSS_USER", "不能指定其他用户的身份");
    next();
  });
  app.get("/api/me", (req: Authenticated, res) =>
    res.json({
      user: req.identity,
      csrf: req.session.csrf,
      isAdmin: false,
      profileUrl: "/auth/login?account=1",
    }),
  );
  app.get("/api/entitlements", async (req: Authenticated, res) => {
    const products = (
      await pool.query(
        "SELECT * FROM products WHERE status='active' ORDER BY id",
      )
    ).rows;
    res.json(
      await Promise.all(products.map((p) => overview(req.identity.uid, p.id))),
    );
  });
  app.post(
    "/api/redeem",
    rateLimit({ windowMs: 60000, limit: 12, legacyHeaders: false }),
    async (req: Authenticated, res) => {
      const b = z
        .object({ code: z.string().trim().min(10).max(100) })
        .strict()
        .parse(req.body);
      res.json(await redeem(req.identity.uid, b.code));
    },
  );
  app.get("/api/records", async (req: Authenticated, res) =>
    res.json({
      ledger: (
        await pool.query(
          "SELECT * FROM ledger WHERE uid=$1 ORDER BY id DESC LIMIT 100",
          [req.identity.uid],
        )
      ).rows,
      redemptions: (
        await pool.query(
          "SELECT r.*,c.hint FROM redemptions r JOIN redemption_codes c ON c.id=r.code_id WHERE r.uid=$1 ORDER BY r.created_at DESC LIMIT 100",
          [req.identity.uid],
        )
      ).rows,
    }),
  );
  await seedCatalog();
  const worker = setInterval(
    () =>
      releaseExpired().catch((e) => console.error("释放任务失败", e.message)),
    30000,
  );
  worker.unref();
  const sync = setInterval(
    () => reconcile().catch((e) => console.error("订阅核对失败", e.message)),
    300000,
  );
  sync.unref();
} else {
  const a = appConfigs[serverId];
  app.use("/api", sessionAuth(serverId), csrf(serverId), (req, _res, next) => {
    if (req.query.uid || req.query.user_id)
      throw new Fault(403, "CROSS_USER", "不能指定其他用户的身份");
    next();
  });
  app.get("/api/me", (req: Authenticated, res) =>
    res.json({
      user: req.identity,
      csrf: req.session.csrf,
      profileUrl: "/auth/login?account=1",
    }),
  );
  const center = async (req: Authenticated, path: string, body?: unknown) => {
    const r = await fetch(
      `${config.CENTER_URL}/api/v1/products/${serverId}${path}`,
      {
        method: body === undefined ? "GET" : "POST",
        headers: {
          Authorization: `Bearer ${a.serviceKey}`,
          "X-User-Token": req.session.access_token,
          "Content-Type": "application/json",
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(15000),
      },
    );
    const result = (await r.json()) as any;
    if (!r.ok)
      throw new Fault(
        r.status,
        result.code || "CENTER_ERROR",
        result.error || "权益服务暂时不可用",
      );
    return result;
  };
  app.get("/api/entitlements", async (req: Authenticated, res) =>
    res.json([await center(req, "/entitlements")]),
  );
  app.get("/api/records", async (req: Authenticated, res) =>
    res.json({
      jobs: (
        await pool.query(
          "SELECT request_id,mode,result,created_at FROM demo_jobs WHERE app_id=$1 AND uid=$2 ORDER BY created_at DESC LIMIT 50",
          [serverId, req.identity.uid],
        )
      ).rows,
    }),
  );
  app.post("/api/studio", async (req: Authenticated, res) =>
    res.json(await center(req, "/check", { feature_id: "studio" })),
  );
  app.post("/api/demo", async (req: Authenticated, res) => {
    const b = z
      .object({
        request_id: z.string().min(8).max(128),
        mode: z.enum(["success", "fail_before", "fail_after"]),
      })
      .strict()
      .parse(req.body);
    const output = await tx(async (db) => {
      await lock(db, `demo:${serverId}:${req.identity.uid}:${b.request_id}`);
      const old = (
        await db.query(
          "SELECT * FROM demo_jobs WHERE app_id=$1 AND uid=$2 AND request_id=$3",
          [serverId, req.identity.uid, b.request_id],
        )
      ).rows[0];
      if (old) {
        assert(
          old.mode === b.mode,
          409,
          "IDEMPOTENCY_CONFLICT",
          "同一任务不能更换执行方式",
        );
        return { ...old.result, repeated: true };
      }
      const hold = await center(req, "/reservations", {
        request_id: b.request_id,
        feature_id: "export",
        amount: 1,
      });
      assert(
        ["reserved", "confirmed"].includes(hold.status),
        409,
        "TERMINAL_REQUEST",
        "此任务已终止，请使用新的请求号",
      );
      let result: any;
      if (b.mode === "fail_before") {
        await center(req, `/reservations/${hold.id}/cancel`, {});
        result = {
          ok: false,
          status: "cancelled",
          message: "模拟生成失败，已取消预占，次数完整释放",
          request_id: b.request_id,
        };
      } else {
        const confirmed = await center(
          req,
          `/reservations/${hold.id}/confirm`,
          {},
        );
        assert(
          confirmed.status === "confirmed",
          409,
          "HOLD_EXPIRED",
          "预占超时，任务未执行",
        );
        if (b.mode === "fail_after") {
          await center(req, `/reservations/${hold.id}/refund`, {});
          result = {
            ok: false,
            status: "refunded",
            message: "模拟交付失败，已返还消费次数",
            request_id: b.request_id,
          };
        } else {
          result = {
            ok: true,
            status: "confirmed",
            request_id: b.request_id,
            message:
              serverId === "beadgrid"
                ? "图纸已在后端生成，消耗 1 次"
                : "演示任务已在后端完成，消耗 1 次",
            artifact:
              serverId === "beadgrid"
                ? {
                    name: "beadgrid-pattern.svg",
                    mime: "image/svg+xml",
                    content:
                      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200"><rect width="200" height="200" fill="#f6f5f1"/><path d="M40 40h40v40H40zM80 80h40v40H80zM120 40h40v40h-40zM40 120h40v40H40zM120 120h40v40h-40z" fill="#236650"/></svg>',
                  }
                : {
                    name: "focustake-demo.json",
                    mime: "application/json",
                    content: JSON.stringify(
                      {
                        kind: "server-generated-demo",
                        duration_seconds: 10,
                        created_at: new Date().toISOString(),
                        request_id: b.request_id,
                      },
                      null,
                      2,
                    ),
                  },
          };
        }
      }
      await db.query(
        "INSERT INTO demo_jobs(app_id,uid,request_id,mode,result) VALUES($1,$2,$3,$4,$5)",
        [serverId, req.identity.uid, b.request_id, b.mode, result],
      );
      return result;
    });
    res.json(output);
  });
}
app.use("/api", (_req, res) =>
  res.status(404).json({ error: "接口不存在", code: "NOT_FOUND" }),
);
app.use(express.static(resolve("dist/web"), { index: false }));
app.get("/{*path}", (_req, res) =>
  res.sendFile(resolve("dist/web/index.html")),
);
app.use((e: any, req: Request, res: Response, _next: NextFunction) => {
  const status =
    e instanceof Fault ? e.status : e instanceof ZodError ? 400 : 500;
  const code =
    e instanceof Fault
      ? e.code
      : e instanceof ZodError
        ? "INVALID_INPUT"
        : "INTERNAL_ERROR";
  if (status === 500)
    console.error("请求失败", req.method, req.path, e.message);
  const message =
    e instanceof Fault
      ? e.message
      : e instanceof ZodError
        ? `输入不符合要求：${e.issues
            .map((i) => i.path.join(".") + " " + i.message)
            .join("；")
            .slice(0, 300)}`
        : "服务暂时不可用，请重试";
  if (req.path.startsWith("/auth/"))
    res
      .status(status)
      .type("html")
      .send(
        `<!doctype html><html lang="zh"><meta charset="UTF-8"><title>登录未完成</title><body><h1>登录未完成</h1><p>${message.replace(/[<>&"']/g, "")}</p><a href="/auth/login">重新登录</a></body></html>`,
      );
  else res.status(status).json({ error: message, code });
});
const port = Number(new URL(appConfigs[serverId].url).port) || 80;
const server = app.listen(port, config.host, () =>
  console.log(`${appConfigs[serverId].name} ${appConfigs[serverId].url}`),
);
async function shutdown() {
  server.close();
  await pool.end();
  process.exit(0);
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
