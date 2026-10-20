import { randomBytes, createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { config, appConfigs, type AppId } from "../src/server/config";
import { casdoorApi } from "../src/server/casdoor";
import { assert } from "../src/server/db";
export async function login(
  appId: AppId,
  username: string,
  password: string,
  options?: { nonceOverride?: string },
) {
  const app = appConfigs[appId];
  const response = await fetch(
    app.url + `/auth/login${appId === "admin" ? "?mode=admin" : ""}`,
    { redirect: "manual" },
  );
  const location = response.headers.get("location");
  assert(location, 500, "TEST_LOGIN", "没有授权重定向");
  const cookies = response.headers
    .getSetCookie()
    .map((x) => x.split(";")[0])
    .join("; ");
  const auth = new URL(location),
    p = auth.searchParams;
  const query = new URLSearchParams({
    clientId: app.clientId,
    responseType: "code",
    redirectUri: p.get("redirect_uri")!,
    type: "code",
    scope: p.get("scope")!,
    state: p.get("state")!,
    nonce: options?.nonceOverride || p.get("nonce")!,
    code_challenge_method: "S256",
    code_challenge: p.get("code_challenge")!,
  });
  const r = await fetch(config.CASDOOR_URL + "/api/login?" + query, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      application: app.application,
      organization: appId === "admin" ? "built-in" : "consumers",
      username,
      password,
      type: "code",
      autoSignin: true,
      signinMethod: "Password",
      loginMethod: "password",
    }),
  });
  const d = (await r.json()) as any;
  assert(
    d.status === "ok" && d.data,
    500,
    "TEST_LOGIN",
    `Casdoor 登录失败：${JSON.stringify(d).slice(0, 500)}`,
  );
  const cb = new URL(p.get("redirect_uri")!);
  cb.searchParams.set("code", d.data);
  cb.searchParams.set("state", p.get("state")!);
  const callback = await fetch(cb, {
    headers: { Cookie: cookies },
    redirect: "manual",
  });
  assert(
    callback.status === 302,
    500,
    "TEST_CALLBACK",
    "登录回调失败：" + (await callback.text()).slice(0, 400),
  );
  const cookie = callback.headers
    .getSetCookie()
    .filter((x) => x.startsWith("zy_" + appId + "="))
    .map((x) => x.split(";")[0])
    .join("; ");
  assert(cookie, 500, "TEST_COOKIE", "未建立产品会话");
  const prefix = appId === "admin" ? "/api/admin" : "/api";
  const me = (await (
    await fetch(app.url + prefix + "/me", { headers: { Cookie: cookie } })
  ).json()) as any;
  assert(
    me.user && me.csrf,
    500,
    "TEST_ME",
    "会话查询失败：" + JSON.stringify(me),
  );
  return { appId, cookie, me, url: app.url, prefix };
}
export async function request(
  session: Awaited<ReturnType<typeof login>>,
  path: string,
  body?: unknown,
  method?: string,
) {
  const r = await fetch(session.url + path, {
    method: method || (body === undefined ? "GET" : "POST"),
    headers: {
      Cookie: session.cookie,
      Origin: session.url,
      "Content-Type": "application/json",
      "X-CSRF-Token": session.me.csrf,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: r.status, body: (await r.json()) as any };
}
