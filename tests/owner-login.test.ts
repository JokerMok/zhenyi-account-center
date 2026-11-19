import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import dotenv from "dotenv";
import pg from "pg";

test("可信超管跨产品保持同一 UID，普通用户和未登记管理员不能继承", async () => {
  dotenv.config({ quiet: true });
  assert.notEqual(process.env.NODE_ENV, "production");
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
    const login = await fetch(config.CASDOOR_URL + "/api/login?" + params, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        application: app.application,
        organization: user.owner,
        username: user.name,
        password: user.password,
        type: "code",
        signinMethod: "Password",
        loginMethod: "password",
      }),
    });
    const result = (await login.json()) as any;
    assert.equal(result.status, "ok", result.msg);
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
    for (const appId of ["admin", "center", "beadgrid", "focustake"]) {
      const token = await accessToken(appId, first);
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
    const otherToken = await accessToken("beadgrid", second);
    assert.equal(
      (await identityFromToken(otherToken, "beadgrid")).platform_owner,
      false,
    );
    const ownerToken = await accessToken("beadgrid", first);
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
