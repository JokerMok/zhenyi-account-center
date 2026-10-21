import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";
import { config, appConfigs, runtimeApp, type AppId } from "./config";
import { assert, Fault, pool, tx, lock } from "./db";
import { projectSubscription, audit } from "./entitlements";

export async function casdoorApi(
  path: string,
  params: Record<string, string> = {},
  body?: unknown,
  accessToken?: string,
) {
  const url = new URL(`/api/${path}`, config.CASDOOR_URL);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const response = await fetch(url, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      Authorization: accessToken
        ? `Bearer ${accessToken}`
        : `Basic ${Buffer.from(appConfigs.admin.clientId + ":" + appConfigs.admin.secret).toString("base64")}`,
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(8000),
  });
  assert(response.ok, 502, "IDENTITY_UNAVAILABLE", "身份服务请求失败");
  const data = (await response.json()) as any;
  assert(
    data.status === "ok",
    502,
    "CASDOOR_ERROR",
    `Casdoor: ${String(data.msg || "请求失败").slice(0, 200)}`,
  );
  return data.data;
}
const keysets = new Map<string, ReturnType<typeof createRemoteJWKSet>>();
export async function discovery(appId: AppId) {
  const url = `${config.CASDOOR_URL}/.well-known/${appConfigs[appId].application}/openid-configuration`;
  const res = await fetch(url, { signal: AbortSignal.timeout(6000) });
  assert(res.ok, 502, "DISCOVERY_FAILED", "身份配置加载失败");
  const d = (await res.json()) as any;
  assert(
    d.issuer === config.CASDOOR_URL,
    502,
    "ISSUER_MISMATCH",
    "身份提供者 issuer 与可信配置不一致",
  );
  for (const k of ["authorization_endpoint", "token_endpoint", "jwks_uri"])
    assert(
      typeof d[k] === "string" &&
        new URL(d[k]).origin === new URL(config.CASDOOR_URL).origin,
      502,
      "UNTRUSTED_ENDPOINT",
      "身份服务返回了未授权的地址",
    );
  return d;
}
export async function verifyToken(token: string, appId: AppId, nonce?: string) {
  const app = appConfigs[appId];
  let keys = keysets.get(appId);
  if (!keys) {
    const d = await discovery(appId);
    keys = createRemoteJWKSet(new URL(d.jwks_uri));
    keysets.set(appId, keys);
  }
  try {
    const { payload } = await jwtVerify(token, keys, {
      issuer: config.CASDOOR_URL,
      audience: app.clientId,
      algorithms: ["RS256"],
      requiredClaims: ["sub", "iat", "exp"],
      clockTolerance: 5,
    });
    assert(
      typeof payload.sub === "string" && payload.sub.length > 0,
      401,
      "INVALID_SUBJECT",
      "身份缺少稳定 subject",
    );
    if (nonce !== undefined)
      assert(
        payload.nonce === nonce,
        401,
        "INVALID_NONCE",
        "登录 nonce 校验失败",
      );
    return payload;
  } catch (e) {
    if (e instanceof Fault) throw e;
    throw new Fault(401, "INVALID_TOKEN", "身份令牌无效或已到期");
  }
}
export async function identityFromToken(
  token: string,
  appId: AppId,
  known?: JWTPayload,
) {
  if (runtimeApp !== "center") {
    assert(
      appId === runtimeApp && appId !== "center" && appId !== "admin",
      403,
      "WRONG_APP",
      "产品应用配置不一致",
    );
    const r = await fetch(
      `${config.CENTER_URL}/api/v1/products/${appId}/identity`,
      {
        headers: {
          Authorization: `Bearer ${appConfigs[appId].serviceKey}`,
          "X-User-Token": token,
        },
        signal: AbortSignal.timeout(10000),
      },
    );
    const body = (await r.json()) as any;
    assert(
      r.ok,
      r.status,
      body.code || "IDENTITY_UNAVAILABLE",
      body.error || "身份验证失败",
    );
    return body.user;
  }
  const payload = known || (await verifyToken(token, appId));
  // UserInfo validates the live token (including upstream revocation), then we read authoritative user status.
  const response = await fetch(`${config.CASDOOR_URL}/api/userinfo`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(6000),
  });
  assert(response.ok, 401, "TOKEN_REVOKED", "登录已失效，请重新登录");
  const info = (await response.json()) as any;
  assert(
    info.sub === payload.sub,
    401,
    "SUBJECT_MISMATCH",
    "身份令牌与用户信息不一致",
  );
  const org = appId === "admin" ? "built-in" : "consumers";
  let user: any;
  const existing = (
    await pool.query(
      "SELECT * FROM identities WHERE issuer=$1 AND subject=$2",
      [config.CASDOOR_URL, payload.sub],
    )
  ).rows[0];
  if (existing) {
    user = await casdoorApi("get-user", {
      id: `${existing.organization}/${existing.username}`,
    });
  } else if (info.preferred_username) {
    user = await casdoorApi("get-user", {
      id: `${org}/${info.preferred_username}`,
    });
  } else {
    const users = await casdoorApi("get-users", { owner: org });
    assert(Array.isArray(users), 502, "INVALID_USERS", "身份服务返回格式错误");
    user = users.find((u: any) => u.id === payload.sub);
  }
  assert(
    user && user.id === payload.sub && user.owner === org,
    403,
    "WRONG_ORGANIZATION",
    "账号不属于当前应用允许的组织",
  );
  assert(
    !user.isForbidden && !user.isDeleted,
    403,
    "USER_BLOCKED",
    "账号已封禁或停用",
  );
  if (appId === "admin")
    assert(
      payload.sub === config.ADMIN_SUB && user.isAdmin === true,
      403,
      "ADMIN_REQUIRED",
      "该账号没有权益运营权限",
    );
  const row = (
    await pool.query(
      `INSERT INTO identities(issuer,subject,organization,username,display_name) VALUES($1,$2,$3,$4,$5)
 ON CONFLICT(issuer,subject) DO UPDATE SET username=EXCLUDED.username,display_name=EXCLUDED.display_name RETURNING *`,
      [
        config.CASDOOR_URL,
        payload.sub,
        org,
        user.name,
        user.displayName || user.name,
      ],
    )
  ).rows[0];
  assert(!row.blocked, 403, "USER_BLOCKED", "账号已被权益平台停用");
  return row;
}
export async function upstreamLogout(accessToken: string) {
  const res = await fetch(
    `${config.CASDOOR_URL}/api/sso-logout?logoutAll=true`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(8000),
    },
  );
  const body = (await res.json()) as any;
  assert(
    res.ok && body.status === "ok",
    502,
    "GLOBAL_LOGOUT_FAILED",
    "统一身份退出失败，请重试",
  );
}
async function reconcileCore(actor?: string) {
  // Only server-to-server reads are trusted. No browser return page or unverified webhook grants rights.
  const [subscriptions, payments] = await Promise.all([
    casdoorApi("get-subscriptions", { owner: "consumers" }),
    casdoorApi("get-payments", { owner: "consumers" }),
  ]);
  assert(
    Array.isArray(subscriptions) && Array.isArray(payments),
    502,
    "INVALID_SUBSCRIPTIONS",
    "订阅查询未返回完整列表",
  );
  const plans = (
    await pool.query(
      "SELECT * FROM plans WHERE active AND casdoor_plan IS NOT NULL",
    )
  ).rows;
  const users = await casdoorApi("get-users", { owner: "consumers" });
  assert(Array.isArray(users), 502, "INVALID_USERS", "身份查询失败");
  const result: any = {
    seen: subscriptions.length,
    projected: 0,
    skipped: 0,
    errors: [],
  };
  await tx(async (db) => {
    await lock(db, "subscription-reconcile");
    const seen: string[] = [];
    for (const s of subscriptions) {
      const source = `${s.owner}/${s.name}`;
      seen.push(source);
      const plan = plans.find(
        (p) =>
          p.casdoor_plan ===
          (s.plan.includes("/") ? s.plan : `${s.owner}/${s.plan}`),
      );
      if (!plan) {
        const old = (
          await db.query(
            "SELECT * FROM subscription_projections WHERE source_id=$1 AND active",
            [source],
          )
        ).rows[0];
        if (old) {
          await lock(db, `quota:${old.uid}:${old.product_id}`);
          await db.query(
            "UPDATE subscription_projections SET active=false,updated_at=now() WHERE source_id=$1",
            [source],
          );
          await db.query(
            "UPDATE quota_buckets SET expires_at=now() WHERE source='subscription' AND source_key=$1",
            [source],
          );
        }
        result.skipped++;
        continue;
      }
      const user = users.find(
        (u: any) => s.user === `${u.owner}/${u.name}` || s.user === u.name,
      );
      if (
        !user ||
        user.isDeleted ||
        !Number.isFinite(Date.parse(s.endTime)) ||
        !Number.isFinite(Date.parse(s.startTime))
      ) {
        result.errors.push({ source, error: "invalid user or dates" });
        continue;
      }
      if (s.payment) {
        const payment = payments.find(
          (p: any) =>
            p.name === s.payment || `${p.owner}/${p.name}` === s.payment,
        );
        if (!payment || payment.state !== "Paid") {
          s.state = "Suspended";
        }
      }
      const identity = (
        await db.query(
          `INSERT INTO identities(issuer,subject,organization,username,display_name) VALUES($1,$2,$3,$4,$5)
    ON CONFLICT(issuer,subject) DO UPDATE SET username=EXCLUDED.username,display_name=EXCLUDED.display_name RETURNING uid`,
          [
            config.CASDOOR_URL,
            user.id,
            user.owner,
            user.name,
            user.displayName || user.name,
          ],
        )
      ).rows[0];
      await lock(db, `quota:${identity.uid}:${plan.product_id}`);
      await projectSubscription(db, s, plan, identity.uid);
      result.projected++;
    }
    // Full successful upstream snapshot allows missing subscriptions to be revoked.
    const missing = (
      await db.query(
        "SELECT * FROM subscription_projections WHERE NOT(source_id=ANY($1::text[])) AND active FOR UPDATE",
        [seen],
      )
    ).rows;
    for (const s of missing) {
      await lock(db, `quota:${s.uid}:${s.product_id}`);
      await db.query(
        "UPDATE subscription_projections SET active=false,updated_at=now() WHERE source_id=$1",
        [s.source_id],
      );
      await db.query(
        "UPDATE quota_buckets SET expires_at=now() WHERE source='subscription' AND source_key=$1",
        [s.source_id],
      );
    }
    await db.query(
      "INSERT INTO reconcile_runs(actor_uid,result) VALUES($1,$2)",
      [actor || null, result],
    );
    if (actor)
      await audit(
        db,
        actor,
        "subscription_reconcile",
        "consumers",
        "服务端查询 Casdoor 重新核对",
        null,
        result,
      );
  });
  return result;
}

export async function reconcile(actor?: string) {
  // A failed upstream read never runs the projection transaction or removes existing rights.
  await pool.query(
    "UPDATE sync_attempts SET status='failed',finished_at=now(),result='{\"error\":\"上次同步进程中断\"}'::jsonb WHERE status='processing' AND started_at<now()-interval '10 minutes'",
  );
  let attempt: any;
  try {
    attempt = (
      await pool.query(
        "INSERT INTO sync_attempts(actor_uid,status) VALUES($1,'processing') RETURNING id",
        [actor || null],
      )
    ).rows[0];
  } catch (e: any) {
    if (e.code === "23505")
      throw new Fault(409, "SYNC_BUSY", "订阅权益正在同步，请稍后查看结果");
    throw e;
  }
  try {
    const result = await reconcileCore(actor);
    await pool.query(
      "UPDATE sync_attempts SET status=$2,result=$3,finished_at=now() WHERE id=$1",
      [attempt.id, result.errors.length ? "partial" : "success", result],
    );
    return result;
  } catch (e: any) {
    await pool.query(
      "UPDATE sync_attempts SET status='failed',result=$2,finished_at=now() WHERE id=$1",
      [
        attempt.id,
        {
          error: e.code || "UPSTREAM_UNAVAILABLE",
          message: "同步失败，原有权益已保留。请检查身份服务连接和套餐映射。",
        },
      ],
    );
    throw e;
  }
}
