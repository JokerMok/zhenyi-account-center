import express, {
  type Request,
  type Response,
  type NextFunction,
} from "express";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { resolve } from "node:path";
import { installConsole } from "./console";
import { z, ZodError } from "zod";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { config, appConfigs, productApps } from "./config";
import { pool, tx, assert, Fault, lock } from "./db";
import {
  installAuth,
  sessionAuth,
  csrf,
  serviceAuth,
  productBackendAuth,
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

import {
  lookupSchema,
  recoverySchema,
  locateReservation,
  reservationStatus,
  recoverReservation,
} from "./recovery";
import { runDemoJob, recoverDemoJobs } from "./demo-runner";
import {
  managementState,
  serviceReadiness,
  checkProduct,
  taskTrace,
  setTestFlag,
} from "./management";
const serverId = process.env.APP_ID || "center";
assert(
  serverId !== "admin" && appConfigs[serverId]?.enabled,
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
        imgSrc: [
          "'self'",
          "data:",
          "https:",
          ...(config.production ? [] : ["http:"]),
        ],
        scriptSrc: ["'self'"],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        upgradeInsecureRequests: config.production ? [] : null,
      },
    },
    hsts: config.production ? undefined : false,
  }),
);
if (serverId === "center") installConsole(app);
app.get("/brand.svg", (_req, res) => {
  res.set("Cross-Origin-Resource-Policy", "cross-origin");
  res.sendFile(resolve("dist/web/brand.svg"));
});
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
app.get("/api/config", async (_req, res) => {
  const state =
    serverId === "center" ? await serviceReadiness().catch(() => null) : null;
  res.json({
    id: serverId,
    name: appConfigs[serverId].name,
    casdoor: config.CASDOOR_URL,
    center: config.CENTER_URL,
    beadgrid: config.BEADGRID_URL,
    focustake: config.FOCUSTAKE_URL,
    login: "/auth/login",
    contextProduct: (() => {
      const id = String(
        _req.query.product || _req.cookies.zy_product_context || "",
      );
      const p = appConfigs[id];
      return serverId === "center" &&
        p?.enabled &&
        !["center", "admin"].includes(id)
        ? { id, name: p.name, url: p.url }
        : null;
    })(),
    products: productApps
      .filter((p) => p.enabled)
      .map((p) => ({ id: p.id, name: p.name, url: p.url })),
    signup: `${config.CASDOOR_URL}/signup/${appConfigs[serverId].application}`,
    services: state
      ? Object.fromEntries(
          Object.entries(state).map(([k, v]: any) => [k, v.status]),
        )
      : {
          sms: "配置状态暂不可用",
          email: "配置状态暂不可用",
          wechat: "配置状态暂不可用",
          payments: "配置状态暂不可用",
        },
  });
});
installAuth(app, serverId);
app.get("/login", (_req, res) => res.redirect("/auth/login"));

if (serverId === "center") {
  app.get(
    "/api/v1/products/:product/identity",
    serviceAuth,
    productBackendAuth,
    (req: Authenticated, res) => res.json({ user: req.identity }),
  );
  app.post(
    "/api/v1/products/:product/logout-all",
    serviceAuth,
    productBackendAuth,
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
    productBackendAuth,
    async (req: Authenticated, res) =>
      res.json(await overview(req.identity.uid, req.serviceProduct!)),
  );
  app.post(
    "/api/v1/products/:product/check",
    serviceAuth,
    productBackendAuth,
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
    productBackendAuth,
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
    productBackendAuth,
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
  app.get(
    "/api/v1/products/:product/recovery/reservations",
    productBackendAuth,
    async (req: Authenticated, res) => {
      res.json(
        reservationStatus(
          await locateReservation(
            req.serviceProduct!,
            lookupSchema.parse(req.query),
          ),
        ),
      );
    },
  );
  app.post(
    "/api/v1/products/:product/recovery",
    productBackendAuth,
    async (req: Authenticated, res) => {
      res.json(
        await recoverReservation(
          req.serviceProduct!,
          recoverySchema.parse(req.body),
        ),
      );
    },
  );
  app.use("/api/admin", sessionAuth("admin"), csrf("admin"));
  app.get("/api/admin/me", (req: Authenticated, res) =>
    res.json({
      user: req.identity,
      csrf: req.session.csrf,
      isAdmin: true,
      profileUrl: "/auth/login?mode=admin&account=1",
    }),
  );
  app.get("/api/admin/management", async (req: Authenticated, res) =>
    res.json(await managementState(req.session.access_token)),
  );
  app.post("/api/admin/products/:id/check", async (req: Authenticated, res) =>
    res.json(await checkProduct(String(req.params.id), req.identity.uid)),
  );
  app.get("/api/admin/tasks", async (req, res) =>
    res.json(await taskTrace(String(req.query.q || ""))),
  );
  app.post(
    "/api/admin/users/:uid/test-flag",
    async (req: Authenticated, res) => {
      const b = z
        .object({ is_test: z.boolean(), reason: reasonSchema })
        .strict()
        .parse(req.body);
      res.json(
        await setTestFlag(
          ident.parse(req.params.uid),
          b.is_test,
          b.reason,
          req.identity.uid,
        ),
      );
    },
  );
  app.get("/api/admin/identities/by-subject", async (req, res) => {
    const subject = ident.parse(req.query.subject);
    const u = await casdoorApi("get-user", {
      owner: "consumers",
      userId: subject,
    });
    assert(
      u && u.id === subject && u.owner === "consumers",
      404,
      "IDENTITY_NOT_FOUND",
      "消费者身份不存在",
    );
    const row = (
      await pool.query(
        "INSERT INTO identities(issuer,subject,organization,username,display_name) VALUES($1,$2,'consumers',$3,$4) ON CONFLICT(issuer,subject) DO UPDATE SET username=EXCLUDED.username,display_name=EXCLUDED.display_name RETURNING uid",
        [config.CASDOOR_URL, subject, u.name, u.displayName || u.name],
      )
    ).rows[0];
    res.json({ uid: row.uid });
  });
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
          i.username ~ '^(test_|dummy_test_|probe_|qa_)' AS legacy_test_hint,
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
    const p = (await pool.query("SELECT id FROM products")).rows;
    res.json(
      await Promise.all(p.map((p) => overview(uid, p.id, { readOnly: true }))),
    );
  });
  app.post("/api/admin/grants", async (req: Authenticated, res) => {
    const body = grantSchema.parse(req.body);
    const result = await grant(req.identity.uid, body);
    res.json({
      result,
      entitlement: await overview(body.uid, body.product_id, {
        readOnly: true,
      }),
    });
  });
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
      if (req.query.data_kind === "test") clauses.push("i.is_test");
      if (req.query.data_kind === "business") clauses.push("NOT i.is_test");
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
    const testAccounts = (
      await pool.query(
        "SELECT organization,username FROM identities WHERE is_test",
      )
    ).rows;
    const testNames = new Set(
      testAccounts.flatMap((r) => [
        r.organization + "/" + r.username,
        r.username,
      ]),
    );
    res.json({
      subscriptions: subscriptions.map((s: any) => ({
        ...s,
        is_test: testNames.has(s.user),
      })),
      payments: payments.map((p: any) => ({
        ...p,
        is_test: testNames.has(p.user),
      })),
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
      lastAttempt:
        (
          await pool.query(
            "SELECT * FROM sync_attempts ORDER BY id DESC LIMIT 1",
          )
        ).rows[0] || null,
      lastSuccess:
        (
          await pool.query(
            "SELECT * FROM sync_attempts WHERE status='success' ORDER BY id DESC LIMIT 1",
          )
        ).rows[0] || null,
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
  app.post(
    "/api/subscriptions/refresh",
    rateLimit({
      windowMs: 60000,
      limit: 5,
      standardHeaders: "draft-8",
      legacyHeaders: false,
    }),
    async (req: Authenticated, res) => {
      z.object({}).strict().parse(req.body);
      await reconcile(req.identity.uid);
      res.json({ ok: true });
    },
  );
  app.get("/api/offers", async (req: Authenticated, res) => {
    const [pricings, plans, providers] = await Promise.all([
      casdoorApi("get-pricings", { owner: "consumers" }),
      casdoorApi("get-plans", { owner: "consumers" }),
      casdoorApi("get-providers", { owner: "consumers" }),
    ]);
    const local =
      !config.production &&
      ["localhost", "127.0.0.1"].includes(new URL(config.CASDOOR_URL).hostname);
    res.json(
      pricings
        .filter((p: any) => p.isEnabled)
        .flatMap((pricing: any) =>
          (pricing.plans || []).flatMap((name: string) => {
            const p = plans.find((x: any) => x.name === name && x.isEnabled);
            if (!p) return [];
            const ps = (p.paymentProviders || [])
              .map((n: string) =>
                providers.find(
                  (x: any) => x.name === n || x.owner + "/" + x.name === n,
                ),
              )
              .filter(Boolean);
            const dummy =
              ps.length > 0 && ps.every((x: any) => x.type === "Dummy");
            return [
              {
                name: p.displayName || p.name,
                pricing: pricing.displayName || pricing.name,
                price: p.price,
                currency: p.currency,
                local_test: dummy,
                available: dummy && local && req.identity.is_test === true,
                url:
                  dummy && local && req.identity.is_test === true
                    ? config.CASDOOR_URL +
                      "/select-plan/consumers/" +
                      encodeURIComponent(pricing.name)
                    : null,
                status:
                  dummy && local
                    ? "本机模拟支付，不产生真实资金"
                    : "真实收费尚未启用",
              },
            ];
          }),
        ),
    );
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
          "SELECT request_id,mode,result,stage,created_at FROM demo_jobs WHERE app_id=$1 AND uid=$2 ORDER BY created_at DESC LIMIT 50",
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
    const output = await runDemoJob(
      serverId,
      req.identity.uid,
      b,
      req.session.access_token,
    );

    res.status(output.status === "pending_recovery" ? 202 : 200).json(output);
  });
  let recovering = false;
  const recoveryWorker = setInterval(async () => {
    if (recovering) return;
    recovering = true;
    try {
      await recoverDemoJobs(serverId);
    } catch (e: any) {
      console.error("示例任务待恢复", e.message);
    } finally {
      recovering = false;
    }
  }, 30000);
  recoveryWorker.unref();
}
app.use("/api", (_req, res) =>
  res.status(404).json({ error: "接口不存在", code: "NOT_FOUND" }),
);
app.get("/", (req, res, next) => {
  const id = String(req.query.product || "");
  if (
    serverId === "center" &&
    appConfigs[id]?.enabled &&
    !["center", "admin"].includes(id)
  )
    res.cookie("zy_product_context", id, {
      httpOnly: true,
      secure: config.production,
      sameSite: "lax",
      maxAge: 3600000,
      path: "/",
    });
  next();
});
app.use(express.static(resolve("dist/web"), { index: false }));
app.use((req, res, next) => {
  if (/\.(png|jpe?g|svg|gif|webp|ico|woff2?|ttf|css|js|map)$/i.test(req.path))
    return res.status(404).type("text/plain").send("资源不存在");
  next();
});
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
        `<!doctype html><html lang="zh"><meta charset="UTF-8"><title>登录未完成</title><body><h1>登录未完成</h1><p>${message.replace(/[<>&"']/g, "")}</p><a href="/auth/login?${req.originalUrl.startsWith("/auth/callback/admin") ? "mode=admin&" : ""}switch=1">重新登录 / 切换账号</a></body></html>`,
      );
  else res.status(status).json({ error: message, code });
});
const port = config.port;
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
