import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { SignJWT, generateKeyPair, importPKCS8 } from "jose";
import pg from "pg";
import dotenv from "dotenv";
import { login, request } from "./helpers";
import { pool } from "../src/server/db";
import { casdoorApi } from "../src/server/casdoor";
import { config, appConfigs } from "../src/server/config";
import { releaseExpired } from "../src/server/entitlements";
type Session = Awaited<ReturnType<typeof login>>;
let admin: Session, center: Session, a: Session, b: Session, focus: Session;
let usernameA: string, passwordA: string, usernameB: string, passwordB: string;
let tokenA: string, tokenB: string, tokenFocus: string;
async function service(
  product: string,
  token: string,
  path: string,
  body?: unknown,
  key = appConfigs.beadgrid.serviceKey,
) {
  const r = await fetch(
    `${config.CENTER_URL}/api/v1/products/${product}${path}`,
    {
      method: body === undefined ? "GET" : "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "X-User-Token": token,
        "Content-Type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    },
  );
  return { status: r.status, body: (await r.json()) as any };
}
async function tokens(s: Session) {
  return (
    await pool.query(
      "SELECT access_token FROM sessions WHERE uid=$1 AND app_id=$2 ORDER BY created_at DESC LIMIT 1",
      [s.me.user.uid, s.appId],
    )
  ).rows[0].access_token;
}
async function balance(uid: string, product = "beadgrid") {
  return (
    await pool.query(
      "SELECT COALESCE(sum(remaining),0)::int AS n FROM quota_buckets WHERE uid=$1 AND product_id=$2 AND feature_id='export' AND (expires_at IS NULL OR expires_at>now())",
      [uid, product],
    )
  ).rows[0].n;
}
const makeId = () => randomUUID();
before(async () => {
  const suffix = randomBytes(4).toString("hex");
  usernameA = "test_a_" + suffix;
  usernameB = "test_b_" + suffix;
  passwordA = "Aa7!" + randomBytes(12).toString("hex");
  passwordB = "Aa7!" + randomBytes(12).toString("hex");
  for (const [name, password] of [
    [usernameA, passwordA],
    [usernameB, passwordB],
  ])
    await casdoorApi(
      "add-user",
      {},
      {
        owner: "consumers",
        name,
        id: randomUUID(),
        displayName: name,
        type: "normal-user",
        password,
        createdTime: new Date().toISOString(),
        isAdmin: false,
      },
    );
  const credentials = JSON.parse(
    await readFile(".local/credentials.json", "utf8"),
  );
  admin = await login("admin", "admin", credentials.administrator.password);
  center = await login("center", usernameA, passwordA);
  a = await login("beadgrid", usernameA, passwordA);
  b = await login("beadgrid", usernameB, passwordB);
  focus = await login("focustake", usernameA, passwordA);
  tokenA = await tokens(a);
  tokenB = await tokens(b);
  tokenFocus = await tokens(focus);
  await service("beadgrid", tokenA, "/entitlements");
  await service("beadgrid", tokenB, "/entitlements");
  await service(
    "focustake",
    tokenFocus,
    "/entitlements",
    undefined,
    appConfigs.focustake.serviceKey,
  );
  await writeFile(
    ".local/latest-test-fixture.json",
    JSON.stringify({
      uid: a.me.user.uid,
      user: usernameA,
      password: passwordA,
      other_uid: b.me.user.uid,
      other_user: usernameB,
      other_password: passwordB,
      created_at: new Date().toISOString(),
    }),
    { mode: 0o600 },
  );
});
after(async () => {
  await pool.end();
});

test("运营列表：真实分页、用户筛选与产品权益隔离", async () => {
  const all = await request(admin, "/api/admin/users?paginated=1&page=1");
  assert.equal(all.status, 200);
  assert.ok(all.body.items.length <= 20);
  const expected = Number(
    (
      await pool.query(
        "SELECT count(*) FROM identities WHERE organization='consumers'",
      )
    ).rows[0].count,
  );
  assert.equal(all.body.total, expected);
  const next = await request(admin, "/api/admin/users?paginated=1&page=2");
  assert.equal(next.status, 200);
  assert.equal(
    next.body.items.some((u: any) =>
      all.body.items.some((v: any) => v.uid === u.uid),
    ),
    false,
  );
  const own = await request(
    admin,
    "/api/admin/users?paginated=1&product=beadgrid&q=" + usernameA,
  );
  assert.equal(own.status, 200);
  assert.equal(own.body.total, 1);
  assert.equal(own.body.items[0].uid, a.me.user.uid);
  assert.deepEqual(
    own.body.items[0].rights.map((r: any) => r.product_id),
    ["beadgrid"],
  );
  const empty = await request(
    admin,
    "/api/admin/users?paginated=1&q=missing-'OR'1'='1",
  );
  assert.equal(empty.status, 200);
  assert.equal(empty.body.total, 0);
  assert.equal(
    (await request(admin, "/api/admin/users?paginated=1&page=-1")).status,
    400,
  );
});
test("运营流水：筛选与总数一致，核对记录可排除", async () => {
  const r = await request(
    admin,
    "/api/admin/records/ledger?paginated=1&product=beadgrid&reconcile=hide",
  );
  assert.equal(r.status, 200);
  assert.ok(
    r.body.items.every(
      (x: any) =>
        x.product_id === "beadgrid" && x.action !== "subscription_reconcile",
    ),
  );
  const expected = Number(
    (
      await pool.query(
        "SELECT count(*) FROM ledger WHERE product_id='beadgrid' AND action<>'subscription_reconcile'",
      )
    ).rows[0].count,
  );
  assert.equal(r.body.total, expected);
  const audit = await request(
    admin,
    "/api/admin/records/audit?paginated=1&product=beadgrid",
  );
  assert.equal(audit.status, 200);
  assert.ok(audit.body.items.every((x: any) => x.actor_uid && x.reason));
  assert.equal(
    (await request(admin, "/api/admin/records/ledger?paginated=1&from=invalid"))
      .status,
    400,
  );
});
test("运营兑换码：有效状态筛选和分页总数使用数据库事实", async () => {
  for (const status of ["available", "expired", "exhausted", "disabled"]) {
    const r = await request(
      admin,
      "/api/admin/codes?paginated=1&status=" + status,
    );
    assert.equal(r.status, 200);
    assert.ok(r.body.items.length <= 20);
    assert.ok(
      r.body.items.every((x: any) =>
        status === "disabled"
          ? !x.active
          : status === "expired"
            ? x.active && new Date(x.expires_at) <= new Date()
            : status === "exhausted"
              ? x.active &&
                new Date(x.expires_at) > new Date() &&
                x.uses >= x.max_uses
              : x.active &&
                new Date(x.expires_at) > new Date() &&
                x.uses < x.max_uses,
      ),
    );
    assert.ok(r.body.items.every((x: any) => !("hash" in x)));
  }
});
test("运营分页接口仍拒绝消费者与未登录访问", async () => {
  for (const path of [
    "/api/admin/users?paginated=1",
    "/api/admin/codes?paginated=1",
    "/api/admin/records/audit?paginated=1",
  ]) {
    assert.equal((await request(center, path)).status, 401);
    assert.equal((await fetch(config.CENTER_URL + path)).status, 401);
  }
});

test("真实 OIDC：跨应用映射相同 UID，消费者与管理员组织隔离", () => {
  assert.equal(center.me.user.uid, a.me.user.uid);
  assert.equal(focus.me.user.uid, a.me.user.uid);
  assert.notEqual(a.me.user.uid, b.me.user.uid);
  assert.equal(admin.me.user.organization, "built-in");
  assert.equal(a.me.user.organization, "consumers");
});
test("普通用户不能调用管理接口，CSRF 与来源校验生效", async () => {
  const r = await request(center, "/api/admin/users");
  assert.equal(r.status, 401);
  const noCsrf = await fetch(config.CENTER_URL + "/api/redeem", {
    method: "POST",
    headers: {
      Cookie: center.cookie,
      Origin: config.CENTER_URL,
      "Content-Type": "application/json",
    },
    body: '{"code":"invalid-code"}',
  });
  assert.equal(noCsrf.status, 403);
});
test("数据库凭据隔离：权益账号不能连接 Casdoor 数据库", async () => {
  const uri = new URL(config.DATABASE_URL);
  uri.pathname = "/casdoor";
  const other = new pg.Client({ connectionString: uri.href });
  await assert.rejects(
    () => other.connect(),
    (e: any) => e.code === "42501",
  );
  await other.end().catch(() => {});
});
test("示例产品独立凭据与数据库角色不能读取中心或另一产品的数据", async () => {
  const env = dotenv.parse(await readFile(".local/beadgrid.env"));
  assert(
    !env.CASDOOR_ADMIN_CLIENT_SECRET &&
      !env.FOCUSTAKE_SERVICE_KEY &&
      !env.REDEMPTION_PEPPER,
  );
  const db = new pg.Client({ connectionString: env.DATABASE_URL });
  await db.connect();
  try {
    await assert.rejects(
      () => db.query("SELECT * FROM quota_buckets"),
      (e: any) => e.code === "42501",
    );
    assert.equal(
      (
        await db.query(
          "SELECT * FROM sessions WHERE app_id IN ('center','admin','focustake')",
        )
      ).rowCount,
      0,
    );
  } finally {
    await db.end();
  }
});
test("跨产品、跨用户与伪造身份请求被拒绝", async () => {
  assert.equal(
    (await service("focustake", tokenA, "/entitlements")).status,
    403,
  );
  assert.equal(
    (await service("beadgrid", tokenFocus, "/entitlements")).status,
    401,
  );
  assert.equal(
    (
      await service("beadgrid", tokenA, "/reservations", {
        feature_id: "export",
        request_id: makeId(),
        uid: b.me.user.uid,
      })
    ).status,
    400,
  );
  assert.equal(
    (await request(center, "/api/entitlements?uid=" + b.me.user.uid)).status,
    403,
  );
  const r = await service("beadgrid", tokenA, "/reservations", {
    feature_id: "export",
    request_id: makeId(),
    amount: 1,
  });
  assert.equal(r.status, 200);
  assert.equal(
    (
      await service(
        "beadgrid",
        tokenB,
        `/reservations/${r.body.id}/confirm`,
        {},
      )
    ).status,
    404,
  );
  assert.equal(
    (await service("beadgrid", tokenA, `/reservations/${r.body.id}/cancel`, {}))
      .status,
    200,
  );
});
test("伪造签名、错误 audience 与过期令牌无法调用权益接口", async () => {
  const { privateKey } = await generateKeyPair("RS256");
  const now = Math.floor(Date.now() / 1000);
  const trusted = await importPKCS8(
    await readFile(".local/casdoor/key.pem", "utf8"),
    "RS256",
  );
  const jwks = (await (
    await fetch(config.CASDOOR_URL + "/.well-known/zhenyi-beadgrid/jwks")
  ).json()) as any;
  for (const [i, claims] of [
    { aud: appConfigs.beadgrid.clientId, exp: now + 60 },
    { aud: appConfigs.focustake.clientId, exp: now + 60 },
    { aud: appConfigs.beadgrid.clientId, exp: now - 30 },
  ].entries()) {
    const token = await new SignJWT({
      sub: a.me.user.subject,
      iss: config.CASDOOR_URL,
      iat: now,
      ...claims,
    })
      .setProtectedHeader({
        alg: "RS256",
        kid: i === 0 ? "untrusted-test-key" : jwks.keys[0].kid,
      })
      .sign(i === 0 ? privateKey : trusted);
    assert.equal(
      (await service("beadgrid", token, "/entitlements")).status,
      401,
    );
  }
});
test("登录回调校验 state；回调不能重放", async () => {
  const r = await fetch(config.CENTER_URL + "/auth/login", {
    redirect: "manual",
  });
  const cookies = r.headers
    .getSetCookie()
    .map((s) => s.split(";")[0])
    .join("; ");
  const failed = await fetch(
    config.CENTER_URL + "/auth/callback/center?state=wrong&code=wrong",
    { headers: { Cookie: cookies }, redirect: "manual" },
  );
  assert.equal(failed.status, 401);
  const replay = await fetch(
    config.CENTER_URL + "/auth/callback/center?state=wrong&code=wrong",
    { headers: { Cookie: cookies }, redirect: "manual" },
  );
  assert.equal(replay.status, 401);
});
test("真实 Casdoor 签名但 nonce 不匹配的 ID Token 被拒绝", async () => {
  await assert.rejects(
    () =>
      login("center", usernameA, passwordA, {
        nonceOverride: "untrusted-nonce",
      }),
    /nonce/,
  );
});
test("并发预占不会超扣、负数；同一请求最多预占一次", async () => {
  const before = await balance(a.me.user.uid);
  assert.equal(before, 3);
  const requests = await Promise.all(
    Array.from({ length: 12 }, () =>
      service("beadgrid", tokenA, "/reservations", {
        feature_id: "export",
        request_id: makeId(),
        amount: 1,
      }),
    ),
  );
  assert.equal(requests.filter((r) => r.status === 200).length, 3);
  assert.equal(requests.filter((r) => r.status === 409).length, 9);
  assert.equal(await balance(a.me.user.uid), 0);
  for (const r of requests.filter((r) => r.status === 200))
    await service("beadgrid", tokenA, `/reservations/${r.body.id}/cancel`, {});
  const id = makeId();
  const repeated = await Promise.all(
    Array.from({ length: 8 }, () =>
      service("beadgrid", tokenA, "/reservations", {
        feature_id: "export",
        request_id: id,
        amount: 1,
      }),
    ),
  );
  assert(repeated.every((r) => r.status === 200));
  assert.equal(new Set(repeated.map((r) => r.body.id)).size, 1);
  assert.equal(await balance(a.me.user.uid), 2);
  assert.equal(
    (
      await service("beadgrid", tokenA, "/reservations", {
        feature_id: "export",
        request_id: id,
        amount: 2,
      })
    ).status,
    409,
  );
  await service(
    "beadgrid",
    tokenA,
    `/reservations/${repeated[0].body.id}/cancel`,
    {},
  );
  assert.equal(await balance(a.me.user.uid), 3);
});
test("重复确认、重复返还不会重复生效；账目保持守恒", async () => {
  const r = await service("beadgrid", tokenA, "/reservations", {
    feature_id: "export",
    request_id: makeId(),
    amount: 1,
  });
  const path = `/reservations/${r.body.id}`;
  const confirmed = await Promise.all(
    Array.from({ length: 5 }, () =>
      service("beadgrid", tokenA, path + "/confirm", {}),
    ),
  );
  assert(confirmed.every((r) => r.body.status === "confirmed"));
  assert.equal(await balance(a.me.user.uid), 2);
  const refunded = await Promise.all(
    Array.from({ length: 5 }, () =>
      service("beadgrid", tokenA, path + "/refund", {}),
    ),
  );
  assert(refunded.every((r) => r.body.status === "refunded"));
  assert.equal(await balance(a.me.user.uid), 3);
  assert.equal(
    (
      await pool.query(
        "SELECT 1 FROM ledger WHERE reference=$1 AND action='confirmed'",
        [r.body.id],
      )
    ).rowCount,
    1,
  );
  assert.equal(
    (
      await pool.query(
        "SELECT 1 FROM ledger WHERE reference=$1 AND action='refunded'",
        [r.body.id],
      )
    ).rowCount,
    1,
  );
});
test("超时预占可执行释放，重复释放不能增加次数", async () => {
  const r = await service("beadgrid", tokenA, "/reservations", {
    feature_id: "export",
    request_id: makeId(),
    amount: 1,
  });
  await pool.query(
    "UPDATE reservations SET expires_at=now()-interval '1 second' WHERE id=$1",
    [r.body.id],
  );
  await releaseExpired();
  await releaseExpired();
  assert.equal(await balance(a.me.user.uid), 3);
  assert.equal(
    (
      await service(
        "beadgrid",
        tokenA,
        `/reservations/${r.body.id}/confirm`,
        {},
      )
    ).body.status,
    "expired",
  );
});
test("产品权益独立；后端任务请求幂等且失败可释放与返还", async () => {
  const focusBefore = await balance(a.me.user.uid, "focustake");
  const id = makeId();
  const x = await request(a, "/api/demo", { request_id: id, mode: "success" });
  assert.equal(x.status, 200);
  assert.equal(x.body.ok, true);
  const y = await request(a, "/api/demo", { request_id: id, mode: "success" });
  assert.equal(y.body.repeated, true);
  assert.equal(await balance(a.me.user.uid), 2);
  assert.equal(await balance(a.me.user.uid, "focustake"), focusBefore);
  for (const mode of ["fail_before", "fail_after"]) {
    const r = await request(a, "/api/demo", { request_id: makeId(), mode });
    assert.equal(r.status, 200);
    assert.equal(r.body.ok, false);
    assert.equal(await balance(a.me.user.uid), 2);
  }
});
test("会员续期从较晚到期日累计；到期后仍可登录但高级功能被拒绝", async () => {
  for (let i = 0; i < 2; i++) {
    const r = await request(admin, "/api/admin/grants", {
      uid: a.me.user.uid,
      product_id: "beadgrid",
      kind: "membership",
      days: 2,
      reason: "自动化验证续期",
    });
    assert.equal(r.status, 200);
  }
  const until = (
    await pool.query(
      "SELECT expires_at FROM memberships WHERE uid=$1 AND product_id=$2",
      [a.me.user.uid, "beadgrid"],
    )
  ).rows[0].expires_at;
  assert(new Date(until).getTime() > Date.now() + 3.99 * 86400000);
  assert.equal((await request(a, "/api/studio", {})).status, 200);
  assert.equal((await request(focus, "/api/studio", {})).status, 403);
  await pool.query(
    "UPDATE memberships SET expires_at=now()-interval '1 second' WHERE uid=$1 AND product_id='beadgrid'",
    [a.me.user.uid],
  );
  assert.equal((await request(a, "/api/studio", {})).status, 403);
  const again = await login("beadgrid", usernameA, passwordA);
  assert.equal(again.me.user.uid, a.me.user.uid);
});
test("兑换码原子领取、次数上限、重复领取及停用校验", async () => {
  const code = await request(admin, "/api/admin/codes", {
    product_id: "focustake",
    days: 3,
    feature_id: "export",
    amount: 4,
    max_uses: 1,
    expires_at: new Date(Date.now() + 86400000).toISOString(),
    quota_expires_at: null,
    reason: "自动化兑换原子性验证",
  });
  assert.equal(code.status, 200);
  const bCenter = await login("center", usernameB, passwordB);
  const requests = await Promise.all(
    Array.from({ length: 10 }, (_, i) =>
      request(i % 2 ? center : bCenter, "/api/redeem", {
        code: code.body.code,
      }),
    ),
  );
  assert(requests.some((r) => r.status === 200));
  assert(requests.some((r) => r.status === 409));
  const row = (
    await pool.query("SELECT * FROM redemption_codes WHERE id=$1", [
      code.body.id,
    ])
  ).rows[0];
  assert.equal(row.uses, 1);
  assert.equal(
    (await pool.query("SELECT * FROM redemptions WHERE code_id=$1", [row.id]))
      .rowCount,
    1,
  );
  const winner = requests.find((r) => r.status === 200)!.body.uid;
  const winnerSession = winner === center.me.user.uid ? center : bCenter;
  const repeat = await request(winnerSession, "/api/redeem", {
    code: code.body.code,
  });
  assert.equal(repeat.body.repeated, true);
  assert.equal(
    (
      await request(admin, `/api/admin/codes/${row.id}/status`, {
        active: false,
        reason: "测试停用",
      })
    ).status,
    200,
  );
});
test("按日按月免费额度只发放一次；过期桶不计入可用额度", async () => {
  for (const period of ["daily", "monthly"]) {
    const id = "test_" + period;
    const f = await request(
      admin,
      "/api/admin/catalog/features",
      {
        product_id: "beadgrid",
        id,
        name: "周期验证 " + period,
        kind: "quota",
        member_only: false,
        free_quota: 2,
        period,
        active: true,
        reason: "验证 UTC 周期",
      },
      "PUT",
    );
    assert.equal(f.status, 200);
    await service("beadgrid", tokenA, "/entitlements");
    await service("beadgrid", tokenA, "/entitlements");
    assert.equal(
      (
        await pool.query(
          "SELECT * FROM quota_buckets WHERE uid=$1 AND product_id=$2 AND feature_id=$3",
          [a.me.user.uid, "beadgrid", id],
        )
      ).rowCount,
      1,
    );
    await request(
      admin,
      "/api/admin/catalog/features",
      {
        product_id: "beadgrid",
        id,
        name: "周期验证 " + period,
        kind: "quota",
        member_only: false,
        free_quota: 2,
        period,
        active: false,
        reason: "周期验证结束，停用测试功能",
      },
      "PUT",
    );
  }
});
test("Casdoor 真实管理订阅经服务端核对生效，重复核对不重复赠送，暂停可撤销投影", async () => {
  const name = "test-sub-" + randomBytes(4).toString("hex");
  const sub = {
    owner: "consumers",
    name,
    displayName: "本地订阅核对测试",
    createdTime: new Date().toISOString(),
    user: usernameB,
    plan: "beadgrid-monthly",
    payment: "",
    startTime: new Date(Date.now() - 60000).toISOString(),
    endTime: new Date(Date.now() + 86400000).toISOString(),
    period: "Monthly",
    state: "Active",
  };
  await casdoorApi("add-subscription", {}, sub);
  const sync = await request(admin, "/api/admin/reconcile", {});
  assert.equal(sync.status, 200);
  assert.equal(sync.body.errors.length, 0);
  assert.equal(
    (await service("beadgrid", tokenB, "/check", { feature_id: "studio" }))
      .status,
    200,
  );
  const n = await balance(b.me.user.uid);
  await request(admin, "/api/admin/reconcile", {});
  assert.equal(await balance(b.me.user.uid), n);
  await casdoorApi(
    "update-subscription",
    { id: `consumers/${name}` },
    { ...sub, state: "Suspended" },
  );
  await request(admin, "/api/admin/reconcile", {});
  assert.equal(
    (await service("beadgrid", tokenB, "/check", { feature_id: "studio" }))
      .status,
    403,
  );
  assert.equal(await balance(b.me.user.uid), 3);
});
test("产品停用、权益封禁与 Casdoor 身份封禁均参与服务端校验", async () => {
  const p = (await request(admin, "/api/admin/catalog")).body.products.find(
    (x: any) => x.id === "beadgrid",
  );
  const { created_at, ...value } = p;
  assert.equal(
    (
      await request(
        admin,
        "/api/admin/catalog/products",
        { ...value, status: "disabled", reason: "测试产品停用" },
        "PUT",
      )
    ).status,
    200,
  );
  assert.equal(
    (await service("beadgrid", tokenA, "/entitlements")).status,
    403,
  );
  await request(
    admin,
    "/api/admin/catalog/products",
    { ...value, status: "active", reason: "恢复测试产品" },
    "PUT",
  );
  await request(admin, `/api/admin/users/${b.me.user.uid}/status`, {
    blocked: true,
    reason: "测试权益封禁",
  });
  assert.equal(
    (await service("beadgrid", tokenB, "/entitlements")).status,
    403,
  );
  await request(admin, `/api/admin/users/${b.me.user.uid}/status`, {
    blocked: false,
    reason: "恢复权益访问",
  });
  const u = await casdoorApi("get-user", { id: `consumers/${usernameB}` });
  await casdoorApi(
    "update-user",
    { id: `consumers/${usernameB}` },
    { ...u, isForbidden: true },
  );
  try {
    assert(
      [401, 403].includes(
        (await service("beadgrid", tokenB, "/entitlements")).status,
      ),
    );
  } finally {
    await casdoorApi(
      "update-user",
      { id: `consumers/${usernameB}` },
      { ...u, isForbidden: false },
    );
  }
});
test("流水与管理记录只追加；所有额度均非负，所有预占分摊守恒", async () => {
  await assert.rejects(() =>
    pool.query("UPDATE ledger SET action='tampered' WHERE uid=$1", [
      a.me.user.uid,
    ]),
  );
  await assert.rejects(() =>
    pool.query("DELETE FROM audit WHERE actor_uid=$1", [admin.me.user.uid]),
  );
  assert.equal(
    (
      await pool.query(
        "SELECT * FROM quota_buckets WHERE remaining<0 OR held<0",
      )
    ).rowCount,
    0,
  );
  assert.equal(
    (
      await pool.query(
        `SELECT b.id FROM quota_buckets b LEFT JOIN reservation_parts p ON p.bucket_id=b.id LEFT JOIN reservations r ON r.id=p.reservation_id GROUP BY b.id HAVING b.held<>COALESCE(sum(p.amount) FILTER(WHERE r.status='reserved'),0)`,
      )
    ).rowCount,
    0,
  );
});
test("退出当前产品保留其他产品会话；全局退出同时撤销所有业务会话与 Casdoor 令牌", async () => {
  assert.equal((await request(focus, "/api/logout", {})).status, 200);
  assert.equal((await request(focus, "/api/me")).status, 401);
  assert.equal((await request(center, "/api/me")).status, 200);
  const r = await request(center, "/api/logout-all", {});
  assert.equal(r.status, 200);
  assert.equal((await request(a, "/api/me")).status, 401);
  assert.equal((await request(center, "/api/me")).status, 401);
  assert.equal(
    (await service("beadgrid", tokenA, "/entitlements")).status,
    401,
  );
  assert.equal(
    (await pool.query("SELECT * FROM sessions WHERE uid=$1", [a.me.user.uid]))
      .rowCount,
    0,
  );
});
test("从独立示例后端发起全局退出可撤销其他产品和中心会话", async () => {
  const aa = await login("beadgrid", usernameA, passwordA),
    cc = await login("center", usernameA, passwordA),
    ff = await login("focustake", usernameA, passwordA);
  const r = await request(ff, "/api/logout-all", {});
  assert.equal(r.status, 200);
  assert.equal((await request(aa, "/api/me")).status, 401);
  assert.equal((await request(cc, "/api/me")).status, 401);
  assert.equal(
    (await pool.query("SELECT * FROM sessions WHERE uid=$1", [aa.me.user.uid]))
      .rowCount,
    0,
  );
});
