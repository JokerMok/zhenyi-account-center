import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { z } from "zod";
import { pool, tx, lock, assert, type DB } from "./db";
import { config } from "./config";

export const ident = z.uuid();
export const reasonSchema = z.string().trim().min(2).max(500);
export const keySchema = z.string().regex(/^[a-z][a-z0-9_-]{1,39}$/);
export const reserveSchema = z
  .object({
    feature_id: keySchema,
    request_id: z.string().min(8).max(128),
    amount: z.number().int().min(1).max(1000).default(1),
  })
  .strict();
export async function audit(
  db: DB,
  actor: string,
  action: string,
  target: string,
  reason: string,
  before: unknown,
  after: unknown,
) {
  await db.query(
    "INSERT INTO audit(actor_uid,action,target,reason,before_value,after_value) VALUES($1,$2,$3,$4,$5,$6)",
    [
      actor,
      action,
      target,
      reason,
      JSON.stringify(before),
      JSON.stringify(after),
    ],
  );
}
async function ledger(
  db: DB,
  uid: string,
  product: string,
  feature: string | null,
  action: string,
  amount: number | null,
  reference: string,
  detail: unknown = {},
) {
  await db.query(
    "INSERT INTO ledger(uid,product_id,feature_id,action,amount,reference,detail) VALUES($1,$2,$3,$4,$5,$6,$7)",
    [uid, product, feature, action, amount, reference, detail],
  );
}
export async function activeContext(db: DB, uid: string, product: string) {
  const u = (await db.query("SELECT * FROM identities WHERE uid=$1", [uid]))
    .rows[0];
  const p = (await db.query("SELECT * FROM products WHERE id=$1", [product]))
    .rows[0];
  assert(u && !u.blocked, 403, "USER_BLOCKED", "账号不可用，请联系管理员");
  assert(
    p && p.status === "active",
    403,
    "PRODUCT_DISABLED",
    "该产品当前不可用",
  );
  return { u, p };
}
async function memberUntil(
  db: DB,
  uid: string,
  product: string,
): Promise<string | null> {
  return (
    await db.query(
      `SELECT max(expires_at) AS expires_at FROM (
 SELECT expires_at FROM memberships WHERE uid=$1 AND product_id=$2
 UNION ALL SELECT expires_at FROM subscription_projections WHERE uid=$1 AND product_id=$2 AND active) m`,
      [uid, product],
    )
  ).rows[0].expires_at;
}
function periodInfo(period: string) {
  const now = new Date();
  if (period === "once") return { key: "once", expires: null };
  const y = now.getUTCFullYear(),
    m = now.getUTCMonth(),
    d = now.getUTCDate();
  return period === "daily"
    ? {
        key: now.toISOString().slice(0, 10),
        expires: new Date(Date.UTC(y, m, d + 1)),
      }
    : {
        key: now.toISOString().slice(0, 7),
        expires: new Date(Date.UTC(y, m + 1, 1)),
      };
}
async function ensureFree(db: DB, uid: string, product: string, f: any) {
  if (f.kind !== "quota" || f.free_quota <= 0) return;
  const p = periodInfo(f.period);
  const inserted = await db.query(
    `INSERT INTO quota_buckets(uid,product_id,feature_id,source,source_key,remaining,expires_at)
 VALUES($1,$2,$3,'free',$4,$5,$6) ON CONFLICT DO NOTHING RETURNING id`,
    [uid, product, f.id, p.key, f.free_quota, p.expires],
  );
  if (inserted.rowCount)
    await ledger(
      db,
      uid,
      product,
      f.id,
      "free_grant",
      f.free_quota,
      inserted.rows[0].id,
      { period: f.period, key: p.key },
    );
}
async function featureContext(
  db: DB,
  uid: string,
  product: string,
  feature: string,
) {
  await activeContext(db, uid, product);
  const f = (
    await db.query(
      "SELECT * FROM features WHERE product_id=$1 AND id=$2 AND active",
      [product, feature],
    )
  ).rows[0];
  assert(f, 404, "FEATURE_NOT_FOUND", "功能不存在或已停用");
  const until = await memberUntil(db, uid, product);
  assert(
    !f.member_only || (until && new Date(until) > new Date()),
    403,
    "MEMBERSHIP_REQUIRED",
    "该功能需要有效会员，账号及已有数据仍可正常访问",
  );
  await ensureFree(db, uid, product, f);
  return f;
}
export async function overview(uid: string, product: string) {
  return tx(async (db) => {
    const { p } = await activeContext(db, uid, product);
    await lock(db, `quota:${uid}:${product}`);
    const fs = (
      await db.query(
        "SELECT * FROM features WHERE product_id=$1 AND active ORDER BY id",
        [product],
      )
    ).rows;
    for (const f of fs) if (f.active) await ensureFree(db, uid, product, f);
    const until = await memberUntil(db, uid, product);
    const member = !!until && new Date(until) > new Date();
    const qs = (
      await db.query(
        `SELECT feature_id,sum(remaining)::int AS remaining,sum(held)::int AS held FROM quota_buckets
   WHERE uid=$1 AND product_id=$2 AND (expires_at IS NULL OR expires_at>now()) GROUP BY feature_id`,
        [uid, product],
      )
    ).rows;
    return {
      product: p,
      membership: { active: member, expires_at: until },
      features: fs.map((f) => ({
        ...f,
        ...(qs.find((q) => q.feature_id === f.id) || { remaining: 0, held: 0 }),
        allowed: f.active && (!f.member_only || member),
      })),
    };
  });
}
export async function checkAccess(
  uid: string,
  product: string,
  feature: string,
) {
  return tx(async (db) => {
    await featureContext(db, uid, product, feature);
    return { allowed: true };
  });
}
export async function reserve(
  uid: string,
  product: string,
  input: z.infer<typeof reserveSchema>,
) {
  return tx(async (db) => {
    await lock(db, `quota:${uid}:${product}`);
    const f = await featureContext(db, uid, product, input.feature_id);
    assert(
      f.kind === "quota",
      400,
      "NOT_METERED",
      "该功能无需扣次，请使用权限检查接口",
    );
    const existing = (
      await db.query(
        "SELECT * FROM reservations WHERE uid=$1 AND product_id=$2 AND request_id=$3 FOR UPDATE",
        [uid, product, input.request_id],
      )
    ).rows[0];
    if (existing) {
      assert(
        existing.feature_id === input.feature_id &&
          existing.amount === input.amount,
        409,
        "IDEMPOTENCY_CONFLICT",
        "同一业务请求的功能或次数不一致",
      );
      return existing;
    }
    const buckets = (
      await db.query(
        `SELECT * FROM quota_buckets WHERE uid=$1 AND product_id=$2 AND feature_id=$3 AND remaining>0
   AND (expires_at IS NULL OR expires_at>now()) ORDER BY expires_at NULLS LAST,created_at,id FOR UPDATE`,
        [uid, product, input.feature_id],
      )
    ).rows;
    assert(
      buckets.reduce((n, b) => n + b.remaining, 0) >= input.amount,
      409,
      "INSUFFICIENT_QUOTA",
      "可用次数不足",
    );
    const r = (
      await db.query(
        `INSERT INTO reservations(uid,product_id,feature_id,request_id,amount,status,expires_at)
   VALUES($1,$2,$3,$4,$5,'reserved',now()+interval '5 minutes') RETURNING *`,
        [uid, product, input.feature_id, input.request_id, input.amount],
      )
    ).rows[0];
    let left = input.amount;
    for (const b of buckets) {
      const take = Math.min(b.remaining, left);
      if (!take) break;
      await db.query(
        "UPDATE quota_buckets SET remaining=remaining-$1,held=held+$1 WHERE id=$2",
        [take, b.id],
      );
      await db.query("INSERT INTO reservation_parts VALUES($1,$2,$3)", [
        r.id,
        b.id,
        take,
      ]);
      left -= take;
    }
    await ledger(
      db,
      uid,
      product,
      input.feature_id,
      "reserve",
      -input.amount,
      r.id,
      { request_id: input.request_id },
    );
    return r;
  });
}
export async function transition(
  uid: string,
  product: string,
  reservationId: string,
  action: "confirm" | "cancel" | "refund" | "expire",
  recovery?: { product: string; reason: string },
) {
  return tx(async (db) => {
    await lock(db, `quota:${uid}:${product}`);
    // Refund/cancel remain available for disabled users/products: failure recovery must not strand holds.
    const r = (
      await db.query(
        "SELECT * FROM reservations WHERE id=$1 AND uid=$2 AND product_id=$3 FOR UPDATE",
        [reservationId, uid, product],
      )
    ).rows[0];
    assert(r, 404, "RESERVATION_NOT_FOUND", "未找到当前用户在本产品的预占记录");
    let target = (
      {
        confirm: "confirmed",
        cancel: "cancelled",
        refund: "refunded",
        expire: "expired",
      } as const
    )[action];
    if (r.status === target) return r;
    if (r.status === "reserved" && new Date(r.expires_at) <= new Date())
      target = "expired";
    if (action === "expire" && new Date(r.expires_at) > new Date()) return r;
    if (r.status === "expired" && action === "confirm") return r;
    assert(
      (r.status === "reserved" &&
        ["confirmed", "cancelled", "expired"].includes(target)) ||
        (r.status === "confirmed" && target === "refunded"),
      409,
      "INVALID_TRANSITION",
      "当前记录不允许执行该操作",
    );
    if (target === "confirmed")
      await featureContext(db, uid, product, r.feature_id);
    const parts = (
      await db.query(
        "SELECT * FROM reservation_parts WHERE reservation_id=$1",
        [r.id],
      )
    ).rows;
    for (const part of parts) {
      if (r.status === "reserved")
        await db.query(
          "UPDATE quota_buckets SET held=held-$1,remaining=remaining+$2 WHERE id=$3",
          [
            part.amount,
            target === "confirmed" ? 0 : part.amount,
            part.bucket_id,
          ],
        );
      else
        await db.query(
          "UPDATE quota_buckets SET remaining=remaining+$1 WHERE id=$2",
          [part.amount, part.bucket_id],
        );
    }
    const changed = (
      await db.query(
        "UPDATE reservations SET status=$1,updated_at=now() WHERE id=$2 RETURNING *",
        [target, r.id],
      )
    ).rows[0];
    await ledger(
      db,
      uid,
      product,
      r.feature_id,
      target,
      target === "confirmed" ? 0 : r.amount,
      r.id,
      {
        request_id: r.request_id,
        ...(recovery
          ? { recovery: { product: recovery.product, reason: recovery.reason } }
          : {}),
      },
    );
    if (recovery) {
      assert(
        recovery.product === product && ["cancel", "refund"].includes(action),
        403,
        "RECOVERY_FORBIDDEN",
        "恢复只允许释放或返还本产品已有任务",
      );
      await db.query(
        "INSERT INTO task_recovery_audit(product_id,reservation_id,uid,action,reason,before_status,after_status) VALUES($1,$2,$3,$4,$5,$6,$7)",
        [product, r.id, uid, action, recovery.reason, r.status, target],
      );
    }
    return changed;
  });
}
export async function releaseExpired() {
  const rs = (
    await pool.query(
      "SELECT id,uid,product_id FROM reservations WHERE status='reserved' AND expires_at<=now() ORDER BY expires_at LIMIT 500",
    )
  ).rows;
  for (const r of rs) {
    try {
      await transition(r.uid, r.product_id, r.id, "expire");
    } catch (e: any) {
      if (e.code !== "INVALID_TRANSITION") throw e;
    }
  }
  return { released: rs.length };
}
export const grantSchema = z
  .object({
    uid: ident,
    product_id: keySchema,
    kind: z.enum(["membership", "quota", "revoke_membership", "revoke_quota"]),
    days: z.number().int().min(1).max(36500).optional(),
    feature_id: keySchema.optional(),
    amount: z.number().int().min(1).max(1000000).optional(),
    expires_at: z.iso.datetime().nullable().optional(),
    reason: reasonSchema,
  })
  .strict();
async function extendMembership(
  db: DB,
  uid: string,
  product: string,
  days: number,
  source: string,
) {
  const before =
    (
      await db.query(
        "SELECT * FROM memberships WHERE uid=$1 AND product_id=$2 FOR UPDATE",
        [uid, product],
      )
    ).rows[0] || null;
  const until = await memberUntil(db, uid, product);
  const after = (
    await db.query(
      `INSERT INTO memberships(uid,product_id,expires_at) VALUES($1,$2,GREATEST(now(),$3::timestamptz)+$4*interval '1 day')
 ON CONFLICT(uid,product_id) DO UPDATE SET expires_at=EXCLUDED.expires_at RETURNING *`,
      [uid, product, until, days],
    )
  ).rows[0];
  await ledger(db, uid, product, null, "membership_extend", days, source, {
    before,
    after,
  });
  return { before, after };
}
async function addQuota(
  db: DB,
  uid: string,
  product: string,
  feature: string,
  amount: number,
  source: string,
  key: string,
  expires: string | null,
) {
  const f = (
    await db.query(
      "SELECT 1 FROM features WHERE product_id=$1 AND id=$2 AND kind='quota'",
      [product, feature],
    )
  ).rowCount;
  assert(f, 400, "INVALID_FEATURE", "次数额度必须对应本产品的计次功能");
  const r = await db.query(
    `INSERT INTO quota_buckets(uid,product_id,feature_id,source,source_key,remaining,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7)
 ON CONFLICT DO NOTHING RETURNING *`,
    [uid, product, feature, source, key, amount, expires],
  );
  if (r.rowCount)
    await ledger(db, uid, product, feature, "quota_grant", amount, key, {
      source,
      expires_at: expires,
    });
  return r.rows[0] || null;
}
export async function grant(actor: string, input: z.infer<typeof grantSchema>) {
  return tx(async (db) => {
    await lock(db, `quota:${input.uid}:${input.product_id}`);
    await activeContext(db, input.uid, input.product_id);
    const ref = randomUUID();
    let change: any;
    if (input.kind === "membership") {
      assert(input.days, 400, "DAYS_REQUIRED", "请填写会员天数");
      change = await extendMembership(
        db,
        input.uid,
        input.product_id,
        input.days,
        ref,
      );
    } else if (input.kind === "quota") {
      assert(
        input.feature_id && input.amount,
        400,
        "QUOTA_REQUIRED",
        "请填写功能与次数",
      );
      const after = await addQuota(
        db,
        input.uid,
        input.product_id,
        input.feature_id,
        input.amount,
        "admin",
        ref,
        input.expires_at || null,
      );
      change = { before: null, after };
    } else if (input.kind === "revoke_membership") {
      const before = (
        await db.query(
          "SELECT * FROM memberships WHERE uid=$1 AND product_id=$2",
          [input.uid, input.product_id],
        )
      ).rows;
      const subscriptions = (
        await db.query(
          "SELECT source_id FROM subscription_projections WHERE uid=$1 AND product_id=$2 AND active",
          [input.uid, input.product_id],
        )
      ).rows;
      assert(
        !subscriptions.length,
        409,
        "SOURCE_SUBSCRIPTION_ACTIVE",
        "存在 Casdoor 有效订阅，请先在 Casdoor 暂停订阅并重新核对",
      );
      await db.query("DELETE FROM memberships WHERE uid=$1 AND product_id=$2", [
        input.uid,
        input.product_id,
      ]);
      change = { before, after: null };
      await ledger(
        db,
        input.uid,
        input.product_id,
        null,
        "membership_revoke",
        null,
        ref,
      );
    } else {
      assert(input.feature_id, 400, "FEATURE_REQUIRED", "请选择功能");
      const before = (
        await db.query(
          "SELECT * FROM quota_buckets WHERE uid=$1 AND product_id=$2 AND feature_id=$3 FOR UPDATE",
          [input.uid, input.product_id, input.feature_id],
        )
      ).rows;
      assert(
        !before.some((b) => b.held > 0),
        409,
        "HAS_HOLDS",
        "尚有预占，请释放后再撤销额度",
      );
      await db.query(
        "UPDATE quota_buckets SET remaining=0 WHERE uid=$1 AND product_id=$2 AND feature_id=$3",
        [input.uid, input.product_id, input.feature_id],
      );
      change = { before, after: { remaining: 0 } };
      await ledger(
        db,
        input.uid,
        input.product_id,
        input.feature_id,
        "quota_revoke",
        -before.reduce((s, b) => s + b.remaining, 0),
        ref,
      );
    }
    await audit(
      db,
      actor,
      input.kind,
      `${input.uid}/${input.product_id}`,
      input.reason,
      change.before,
      change.after,
    );
    return change.after;
  });
}
export const codeSchema = z
  .object({
    product_id: keySchema,
    days: z.number().int().min(0).max(36500).default(0),
    feature_id: keySchema.nullable().default(null),
    amount: z.number().int().min(0).max(1000000).default(0),
    max_uses: z.number().int().min(1).max(100000),
    expires_at: z.iso.datetime(),
    quota_expires_at: z.iso.datetime().nullable().default(null),
    reason: reasonSchema,
  })
  .strict();
function codeHash(code: string) {
  return createHmac("sha256", config.REDEMPTION_PEPPER)
    .update(code.trim().toUpperCase())
    .digest("hex");
}
export async function createCode(
  actor: string,
  input: z.infer<typeof codeSchema>,
) {
  assert(
    input.days > 0 || input.amount > 0,
    400,
    "EMPTY_CODE",
    "至少配置会员天数或次数",
  );
  assert(
    new Date(input.expires_at) > new Date(),
    400,
    "INVALID_EXPIRY",
    "兑换码有效期必须晚于当前时间",
  );
  const code = randomBytes(15)
    .toString("hex")
    .toUpperCase()
    .match(/.{6}/g)!
    .join("-");
  const row = await tx(async (db) => {
    if (input.amount > 0) {
      assert(
        input.feature_id,
        400,
        "FEATURE_REQUIRED",
        "次数兑换码必须选择功能",
      );
      const f = (
        await db.query(
          "SELECT 1 FROM features WHERE product_id=$1 AND id=$2 AND kind='quota'",
          [input.product_id, input.feature_id],
        )
      ).rowCount;
      assert(f, 400, "INVALID_FEATURE", "功能必须是本产品的计次功能");
    }
    const r = (
      await db.query(
        `INSERT INTO redemption_codes(hash,hint,product_id,days,feature_id,amount,max_uses,expires_at,quota_expires_at)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id,hint,product_id,days,amount,max_uses,expires_at`,
        [
          codeHash(code),
          code.slice(-6),
          input.product_id,
          input.days,
          input.feature_id,
          input.amount,
          input.max_uses,
          input.expires_at,
          input.quota_expires_at,
        ],
      )
    ).rows[0];
    await audit(db, actor, "code_create", r.id, input.reason, null, r);
    return r;
  });
  return { ...row, code };
}
export async function redeem(uid: string, code: string) {
  return tx(async (db) => {
    const c = (
      await db.query(
        "SELECT * FROM redemption_codes WHERE hash=$1 FOR UPDATE",
        [codeHash(code)],
      )
    ).rows[0];
    assert(c, 404, "CODE_NOT_FOUND", "兑换码无效");
    await lock(db, `quota:${uid}:${c.product_id}`);
    await activeContext(db, uid, c.product_id);
    const old = (
      await db.query("SELECT * FROM redemptions WHERE code_id=$1 AND uid=$2", [
        c.id,
        uid,
      ])
    ).rows[0];
    if (old) return { ...old, repeated: true };
    assert(
      c.active && new Date(c.expires_at) > new Date() && c.uses < c.max_uses,
      409,
      "CODE_UNAVAILABLE",
      "兑换码已停用、过期或领完",
    );
    const r = (
      await db.query(
        "INSERT INTO redemptions(code_id,uid,product_id) VALUES($1,$2,$3) RETURNING *",
        [c.id, uid, c.product_id],
      )
    ).rows[0];
    await db.query("UPDATE redemption_codes SET uses=uses+1 WHERE id=$1", [
      c.id,
    ]);
    if (c.days) await extendMembership(db, uid, c.product_id, c.days, r.id);
    if (c.amount)
      await addQuota(
        db,
        uid,
        c.product_id,
        c.feature_id,
        c.amount,
        "redemption",
        r.id,
        c.quota_expires_at,
      );
    await ledger(
      db,
      uid,
      c.product_id,
      c.feature_id,
      "redeem",
      c.amount || c.days,
      r.id,
      { code_hint: c.hint, days: c.days },
    );
    return r;
  });
}

export async function projectSubscription(
  db: DB,
  s: any,
  plan: any,
  uid: string,
) {
  const source = `${s.owner}/${s.name}`;
  const active =
    s.state === "Active" &&
    new Date(s.startTime) <= new Date() &&
    new Date(s.endTime) > new Date();
  const before =
    (
      await db.query(
        "SELECT * FROM subscription_projections WHERE source_id=$1",
        [source],
      )
    ).rows[0] || null;
  assert(
    !before || (before.uid === uid && before.product_id === plan.product_id),
    409,
    "SOURCE_MUTATION",
    "订阅用户或产品发生变更，需人工核对，不能重复迁移额度",
  );
  await db.query(
    `INSERT INTO subscription_projections(source_id,uid,product_id,plan_id,expires_at,active,snapshot) VALUES($1,$2,$3,$4,$5,$6,$7)
 ON CONFLICT(source_id) DO UPDATE SET expires_at=EXCLUDED.expires_at,active=EXCLUDED.active,snapshot=EXCLUDED.snapshot,updated_at=now()`,
    [source, uid, plan.product_id, plan.id, s.endTime, active, s],
  );
  // A subscription grants its included quota once; renewals require a new upstream subscription record.
  if (active)
    for (const [feature, amount] of Object.entries(plan.quotas))
      await addQuota(
        db,
        uid,
        plan.product_id,
        feature,
        Number(amount),
        "subscription",
        source,
        s.endTime,
      );
  await db.query(
    "UPDATE quota_buckets SET expires_at=$1 WHERE source='subscription' AND source_key=$2",
    [active ? s.endTime : new Date().toISOString(), source],
  );
  if (!before || JSON.stringify(before.snapshot) !== JSON.stringify(s))
    await ledger(
      db,
      uid,
      plan.product_id,
      null,
      "subscription_reconcile",
      null,
      source,
      { state: s.state, active, end: s.endTime },
    );
}
