import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import dotenv from "dotenv";
import pg from "pg";

test("超管用普通产品登录保留 UID，同名消费者保留独立身份", async () => {
  dotenv.config({ quiet: true });
  assert.notEqual(process.env.NODE_ENV, "production");
  assert(
    ["localhost", "127.0.0.1", "[::1]"].includes(
      new URL(process.env.CASDOOR_URL!).hostname,
    ),
  );
  const schema = "qa_owner_" + randomUUID().replaceAll("-", "");
  const connection = new URL(process.env.DATABASE_URL!);
  const bootstrap = new pg.Pool({ connectionString: connection.toString() });
  await bootstrap.query("CREATE SCHEMA " + schema);
  connection.searchParams.set("options", "-c search_path=" + schema);
  process.env.DATABASE_URL = connection.toString();
  const { config, appConfigs } = await import("../src/server/config");
  const { pool } = await import("../src/server/db");
  const { casdoorApi, identityFromToken } = await import(
    "../src/server/casdoor"
  );
  const savedSubject = config.ADMIN_SUB;
  const users: any[] = [];
  const suffix = randomBytes(5).toString("hex");
  const password = "Aa1!" + randomBytes(18).toString("hex");
  assert(
    process.env.TEST_ADMIN_PASSWORD,
    "通过私密 TEST_ADMIN_PASSWORD 提供本机管理员凭据",
  );
  const existingAdmin = await casdoorApi("get-user", {
    owner: "built-in",
    userId: config.ADMIN_SUB,
  });
  const first = { ...existingAdmin, password: process.env.TEST_ADMIN_PASSWORD };
  const second = {
    owner: "consumers",
    name: "qa_other_" + suffix,
    id: randomUUID(),
    displayName: "QA other",
    password,
    isAdmin: false,
    createdTime: new Date().toISOString(),
  };
  const { default: express } = await import("express");
  const { default: cookieParser } = await import("cookie-parser");
  const { installConsumerEntry, hash } = await import("../src/server/auth");
  const { consumerSignin } = await import("../src/server/consumer-signin");
  const gateway = express();
  gateway.use(
    consumerSignin(
      `http://127.0.0.1:${process.env.CASDOOR_BACKEND_PORT || 5305}`,
    ),
  );
  gateway.use(express.json(), cookieParser());
  installConsumerEntry(gateway);
  gateway.use((error: any, _req: any, res: any, _next: any) =>
    res.status(error.status || 500).json({ code: error.code }),
  );
  const listener = gateway.listen(0, "127.0.0.1");
  await once(listener, "listening");
  const base = `http://127.0.0.1:${(listener.address() as AddressInfo).port}`;

  async function accessToken(appId: string, user: any) {
    const app = appConfigs[appId];
    const verifier = randomBytes(32).toString("base64url");
    const redirect = app.url + "/auth/callback/" + appId;
    const params = new URLSearchParams({
      clientId: app.clientId,
      responseType: "code",
      type: "code",
      redirectUri: redirect,
      scope: "openid profile email",
      state: randomUUID(),
      nonce: randomUUID(),
      code_challenge_method: "S256",
      code_challenge: createHash("sha256").update(verifier).digest("base64url"),
    });
    const login = await fetch(
      (appId === "admin" ? config.CASDOOR_URL : base) + "/api/login?" + params,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          application: app.application,
          organization: appId === "admin" ? "built-in" : "consumers",
          username: user.name,
          password: user.password,
          type: "code",
          signinMethod: "Password",
          loginMethod: "password",
        }),
      },
    );
    const result = (await login.json()) as any;
    assert.equal(result.status, "ok", `Casdoor ${appId} 登录失败`);
    const response = await fetch(
      config.CASDOOR_URL + "/api/login/oauth/access_token",
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          client_id: app.clientId,
          client_secret: app.secret,
          code: result.data,
          redirect_uri: redirect,
          code_verifier: verifier,
        }),
      },
    );
    const tokens = (await response.json()) as any;
    assert.equal(
      typeof tokens.access_token,
      "string",
      "授权码兑换应返回访问令牌",
    );
    return tokens.access_token as string;
  }
  try {
    const initial = await readFile("migrations/001_initial.sql", "utf8");
    await pool.query(initial);
    const stableUid = randomUUID();
    await pool.query(
      "INSERT INTO identities(uid,issuer,subject,organization,username,display_name) VALUES($1,$2,$3,'built-in',$4,$5)",
      [stableUid, config.CASDOOR_URL, first.id, first.name, first.displayName],
    );
    await pool.query(
      "INSERT INTO audit(actor_uid,action,target,reason) VALUES($1,'qa_history','identity','既有身份历史验证')",
      [stableUid],
    );
    for (const user of [second]) {
      await casdoorApi("add-user", {}, user);
      users.push(user);
    }
    const identities = [];
    let centerToken = "";
    for (const appId of ["admin", "center", "beadgrid", "focustake"]) {
      const token = await accessToken(appId, first);
      if (appId === "center") centerToken = token;
      const identity = await identityFromToken(token, appId);
      assert.equal(identity.subject, first.id);
      assert.equal(identity.uid, stableUid);
      assert.equal(identity.organization, "built-in");
      assert.equal(identity.platform_owner, true);
      identities.push(identity.uid);
      if (appId === "beadgrid")
        await assert.rejects(() => identityFromToken(token, "focustake"));
    }
    assert.equal(new Set(identities).size, 1);
    await pool.query(
      await readFile("migrations/007_platform_owner.sql", "utf8"),
    );
    const { overview, checkAccess, reserve, transition, releaseExpired } =
      await import("../src/server/entitlements");
    for (const product of ["beadgrid", "focustake", "future-product"]) {
      await pool.query(
        "INSERT INTO products(id,name,application,callback_url,origin) VALUES($1,$1,$1,'http://localhost/callback','http://localhost')",
        [product],
      );
      await pool.query(
        "INSERT INTO features(product_id,id,name,kind,member_only,free_quota) VALUES($1,'premium','高级功能','access',true,0),($1,'render','生成','quota',true,5)",
        [product],
      );
      const rights = await overview(stableUid, product);
      assert.equal(rights.membership.permanent, true);
      assert.equal(
        rights.features.find((f) => f.id === "render").unlimited,
        true,
      );
      assert.equal(
        (await checkAccess(stableUid, product, "premium")).allowed,
        true,
      );
      const input = {
        feature_id: "render",
        request_id: "owner-request-" + product,
        amount: 1000000,
      };
      const [r, repeat] = await Promise.all([
        reserve(stableUid, product, input),
        reserve(stableUid, product, input),
      ]);
      assert.equal(r.id, repeat.id);
      assert.equal(r.quota_exempt, true);
      await assert.rejects(() =>
        transition(stableUid, "not-this-product", r.id, "cancel"),
      );
      await transition(stableUid, product, r.id, "confirm");
      await transition(stableUid, product, r.id, "confirm");
      // Existing exempt tasks cannot credit quota even if the global grant is later revoked.
      config.ADMIN_SUB = randomUUID();
      await transition(stableUid, product, r.id, "refund");
      await transition(stableUid, product, r.id, "refund");
      config.ADMIN_SUB = savedSubject;
      const hold = await reserve(stableUid, product, {
        ...input,
        request_id: input.request_id + "-expire",
      });
      await pool.query(
        "UPDATE reservations SET expires_at=now()-interval '1 second' WHERE id=$1",
        [hold.id],
      );
      await releaseExpired();
      assert.equal(
        (
          await pool.query("SELECT status FROM reservations WHERE id=$1", [
            hold.id,
          ])
        ).rows[0].status,
        "expired",
      );
    }
    assert.equal(
      (
        await pool.query(
          "SELECT count(*)::int n FROM quota_buckets WHERE uid=$1",
          [stableUid],
        )
      ).rows[0].n,
      0,
    );
    assert.equal(
      (
        await pool.query(
          "SELECT count(*)::int n FROM ledger WHERE uid=$1 AND amount<>0",
          [stableUid],
        )
      ).rows[0].n,
      0,
    );
    await pool.query("UPDATE identities SET blocked=true WHERE uid=$1", [
      stableUid,
    ]);
    await assert.rejects(() => checkAccess(stableUid, "beadgrid", "premium"));
    await pool.query("UPDATE identities SET blocked=false WHERE uid=$1", [
      stableUid,
    ]);
    await pool.query(
      "UPDATE products SET status='disabled' WHERE id='beadgrid'",
    );
    await assert.rejects(() => checkAccess(stableUid, "beadgrid", "premium"));
    await pool.query("UPDATE products SET status='active' WHERE id='beadgrid'");
    const sessionKey = randomUUID();
    await pool.query(
      "INSERT INTO sessions(token_hash,app_id,uid,access_token,id_token,csrf,expires_at) VALUES($1,'center',$2,$3,'','',now()+interval '1 hour')",
      [hash(sessionKey), stableUid, centerToken],
    );
    const savedPath = appConfigs.beadgrid.ssoLoginPath;
    appConfigs.beadgrid.ssoLoginPath = "/api/account/sso";
    await pool.query(
      "UPDATE products SET origin=$1,application=$2 WHERE id='beadgrid'",
      [appConfigs.beadgrid.url, appConfigs.beadgrid.application],
    );
    try {
      assert.equal(
        (
          await fetch(base + "/auth/products/beadgrid/launch", {
            redirect: "manual",
          })
        ).status,
        401,
      );
      const response = await fetch(base + "/auth/products/beadgrid/launch", {
        headers: { Cookie: "zy_center=" + sessionKey },
        redirect: "manual",
      });
      assert.equal(response.status, 302);
      const target = new URL(response.headers.get("location")!);
      assert.equal(target.origin, new URL(appConfigs.beadgrid.url).origin);
      assert.equal(target.pathname, "/api/account/sso");
      const context = target.searchParams.get("launch");
      assert(context);
      async function resolve(product: string, key: string) {
        return fetch(base + "/api/v1/products/" + product + "/login-context", {
          method: "POST",
          headers: {
            Authorization: "Bearer " + key,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ context }),
        });
      }
      assert.equal(
        (await resolve("beadgrid", appConfigs.focustake.serviceKey)).status,
        403,
      );
      assert.equal(
        (await resolve("focustake", appConfigs.focustake.serviceKey)).status,
        410,
      );
      assert.equal((await resolve("beadgrid", "fake-key")).status, 401);
      const resolved = await resolve(
        "beadgrid",
        appConfigs.beadgrid.serviceKey,
      );
      assert.equal(resolved.status, 200);
      assert.deepEqual(await resolved.json(), {
        uid: stableUid,
        platform_owner: true,
      });
      assert.equal(
        (await resolve("beadgrid", appConfigs.beadgrid.serviceKey)).status,
        410,
      );
    } finally {
      appConfigs.beadgrid.ssoLoginPath = savedPath;
    }
    const otherToken = await accessToken("beadgrid", second);
    assert.equal(
      (await identityFromToken(otherToken, "beadgrid")).platform_owner,
      false,
    );
    const otherIdentity = await identityFromToken(otherToken, "beadgrid");
    assert.equal(
      (await overview(otherIdentity.uid, "beadgrid")).membership.active,
      false,
    );
    await assert.rejects(() =>
      checkAccess(otherIdentity.uid, "beadgrid", "premium"),
    );
    await assert.rejects(() =>
      reserve(otherIdentity.uid, "beadgrid", {
        feature_id: "render",
        request_id: "ordinary-request",
        amount: 1,
      }),
    );
    const ownerToken = await accessToken("beadgrid", first);
    const sameName = { ...second, name: first.name, id: randomUUID() };
    assert.equal(
      await casdoorApi("get-user", { id: `consumers/${first.name}` }),
      null,
    );
    await casdoorApi("add-user", {}, sameName);
    users.push(sameName);
    const sameNameToken = await accessToken("beadgrid", sameName);
    const sameNameIdentity = await identityFromToken(sameNameToken, "beadgrid");
    assert.equal(sameNameIdentity.subject, sameName.id);
    assert.equal(sameNameIdentity.platform_owner, false);
    assert.notEqual(sameNameIdentity.uid, stableUid);
    config.ADMIN_SUB = randomUUID();
    await assert.rejects(() => identityFromToken(ownerToken, "beadgrid"));
    assert.equal(
      (
        await pool.query(
          "SELECT actor_uid FROM audit WHERE action='qa_history'",
        )
      ).rows[0].actor_uid,
      stableUid,
    );
  } finally {
    await new Promise<void>((r) => listener.close(() => r()));
    config.ADMIN_SUB = savedSubject;
    for (const user of users.reverse())
      await casdoorApi(
        "delete-user",
        {},
        { owner: user.owner, name: user.name },
      );
    await pool.end();
    await bootstrap.query("DROP SCHEMA " + schema + " CASCADE");
    await bootstrap.end();
  }
});
