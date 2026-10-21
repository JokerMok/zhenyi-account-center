import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { testAdministrator } from "./helpers";
import { pool } from "../src/server/db";
const base = "http://localhost:5310";
let nativeCookie = "",
  businessCookie = "",
  uid = "";
before(async () => {
  const cred = await testAdministrator();
  const r = await fetch(base + "/auth/login?mode=admin", {
    redirect: "manual",
  });
  const auth = new URL(r.headers.get("location")!);
  assert.equal(auth.origin, base);
  assert.equal(auth.pathname, "/admin/login/oauth/authorize");
  const attempt = r.headers
    .getSetCookie()
    .map((x) => x.split(";")[0])
    .join("; ");
  const p = auth.searchParams;
  const query = new URLSearchParams({
    clientId: p.get("client_id")!,
    responseType: "code",
    redirectUri: p.get("redirect_uri")!,
    type: "code",
    scope: p.get("scope")!,
    state: p.get("state")!,
    nonce: p.get("nonce")!,
    code_challenge_method: "S256",
    code_challenge: p.get("code_challenge")!,
  });
  const login = await fetch(base + "/admin/api/login?" + query, {
    method: "POST",
    headers: { Origin: base, "Content-Type": "application/json" },
    body: JSON.stringify({
      application: "zhenyi-admin",
      organization: "built-in",
      username: cred.username,
      password: cred.password,
      type: "code",
      autoSignin: true,
      signinMethod: "Password",
      loginMethod: "password",
    }),
  });
  const b = (await login.json()) as any;
  assert.equal(b.status, "ok", b.msg);
  const cookies = login.headers.getSetCookie();
  assert(
    cookies.some(
      (x) =>
        x.startsWith("zy_identity_admin=") &&
        x.includes("Path=/admin") &&
        x.includes("HttpOnly"),
    ),
  );
  nativeCookie = cookies
    .filter((x) => x.startsWith("zy_identity_admin="))
    .at(-1)!
    .split(";")[0];
  const cb = new URL(p.get("redirect_uri")!);
  cb.searchParams.set("code", b.data);
  cb.searchParams.set("state", p.get("state")!);
  const callback = await fetch(cb, {
    headers: { Cookie: attempt },
    redirect: "manual",
  });
  assert.equal(callback.status, 302);
  assert.equal(callback.headers.get("location"), "/admin");
  businessCookie = callback.headers
    .getSetCookie()
    .filter((x) => x.startsWith("zy_admin="))
    .map((x) => x.split(";")[0])
    .join("; ");
  assert(businessCookie);
  const me = (await (
    await fetch(base + "/api/admin/me", { headers: { Cookie: businessCookie } })
  ).json()) as any;
  uid = me.user.uid;
});
after(async () => {
  if (businessCookie)
    await pool.query("DELETE FROM sessions WHERE token_hash=$1", [
      createHash("sha256").update(businessCookie.split("=")[1]).digest("hex"),
    ]);
  await pool.end();
});
test("同源OIDC管理登录保留官方身份与独立业务权限", async () => {
  const r = (await (
    await fetch(base + "/admin/api/get-account", {
      headers: { Cookie: nativeCookie },
    })
  ).json()) as any;
  assert.equal(r.status, "ok");
  assert.equal(r.data.owner, "built-in");
  const row = (
    await pool.query("SELECT subject FROM identities WHERE uid=$1", [uid])
  ).rows[0];
  assert.equal(row.subject, r.data.id);
});
test("管理身份Cookie不借用消费者身份Cookie，代理不开放跨源写入", async () => {
  const root = nativeCookie.replace(
    "zy_identity_admin=",
    "casdoor_session_id=",
  );
  const r = (await (
    await fetch(base + "/admin/api/get-account", { headers: { Cookie: root } })
  ).json()) as any;
  assert.equal(r.status, "error");
  const no = await fetch(base + "/admin/api/add-organization", {
    method: "POST",
    headers: {
      Origin: "https://evil.example",
      Cookie: nativeCookie,
      "Content-Type": "application/json",
    },
    body: "{}",
  });
  assert.equal(no.status, 403);
});
test("原生CRUD通过统一网关真实操作，自建读接口仍要求业务会话", async () => {
  const name = "qa_unified_" + randomBytes(5).toString("hex"),
    body = {
      owner: "consumers",
      name,
      displayName: "统一网关验证",
      category: "Email",
      type: "Default",
      host: "",
      port: 0,
      createdTime: new Date().toISOString(),
    };
  const call = async (path: string, value?: any) => {
    const r = await fetch(base + "/admin/api/" + path, {
      method: value ? "POST" : "GET",
      headers: {
        Cookie: nativeCookie,
        Origin: base,
        "Content-Type": "application/json",
      },
      body: value ? JSON.stringify(value) : undefined,
    });
    const b = (await r.json()) as any;
    assert.equal(b.status, "ok", b.msg);
    return b.data;
  };
  await call("add-provider", body);
  const read = await call("get-provider?id=consumers/" + name);
  assert.equal(read.displayName, body.displayName);
  await call("update-provider?id=consumers/" + name, {
    ...read,
    displayName: "统一页面保存通过",
  });
  assert.equal(
    (await call("get-provider?id=consumers/" + name)).displayName,
    "统一页面保存通过",
  );
  const denied = await fetch(base + "/api/admin/catalog", {
    headers: { Cookie: nativeCookie },
  });
  assert.equal(denied.status, 401);
});
