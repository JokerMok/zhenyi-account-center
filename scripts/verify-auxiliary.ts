import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, writeFile } from "node:fs/promises";
import { randomBytes, randomUUID } from "node:crypto";
import { config } from "../src/server/config";
import { casdoorApi } from "../src/server/casdoor";
import { pool } from "../src/server/db";
import { hash } from "../src/server/auth";
import { login, testAdministrator } from "../tests/helpers";
assert(!config.production && config.host === "127.0.0.1");
const cred = await testAdministrator(),
  a = await login("admin", cred.username, cred.password),
  token = (
    await pool.query("SELECT access_token FROM sessions WHERE token_hash=$1", [
      hash(a.cookie.split("=")[1]),
    ])
  ).rows[0].access_token;
const api = (p: string, q: any = {}, b?: any) => casdoorApi(p, q, b, token),
  suffix = randomBytes(5).toString("hex"),
  results: any[] = [];
const only = process.argv[2]?.split(",");
async function run(id: string, fn: () => Promise<any>) {
  if (only && !only.includes(id)) return;
  try {
    await fn();
    results.push({
      id,
      status: "已集成并验证",
      detail: "本轮实际原生操作通过",
    });
    console.log("PASS", id);
  } catch (e: any) {
    results.push({ id, status: "验证失败", detail: e.message.slice(0, 200) });
    console.log("FAIL", id, e.message.slice(0, 200));
  }
}
await run("resources", async () => {
  const provider = {
    owner: "admin",
    name: "qa_local_storage_" + suffix,
    displayName: "本地文件存储验证",
    category: "Storage",
    type: "Local File System",
    domain: config.CASDOOR_URL,
    pathPrefix: "qa-acceptance",
    createdTime: new Date().toISOString(),
  };
  await api("add-provider", {}, provider);
  const f = new FormData();
  f.set(
    "file",
    new Blob(["complete-console-resource-" + suffix], { type: "text/plain" }),
    "qa.txt",
  );
  const q = new URLSearchParams({
    owner: "built-in",
    user: cred.username,
    application: "app-built-in",
    fullFilePath: "qa-" + suffix + ".txt",
    provider: provider.name,
  });
  const r = await fetch(config.CASDOOR_URL + "/api/upload-resource?" + q, {
    method: "POST",
    headers: { Authorization: "Bearer " + token },
    body: f,
  });
  const b = (await r.json()) as any;
  assert.equal(b.status, "ok", b.msg);
  const text = await (
    await fetch(b.data, { headers: { Authorization: "Bearer " + token } })
  ).text();
  assert.equal(text, "complete-console-resource-" + suffix);
  const resources = await api("get-resources", {
    owner: "built-in",
    user: cred.username,
  });
  assert(resources.some((x: any) => x.provider === provider.name));
});
await run("invitations", async () => {
  const name = "qa_invite_" + suffix,
    body = {
      owner: "consumers",
      name,
      createdTime: new Date().toISOString(),
      displayName: "注册邀请码验证",
      code: suffix,
      defaultCode: suffix,
      quota: 2,
      usedCount: 0,
      application: "zhenyi-center",
      state: "Active",
    };
  await api("add-invitation", {}, body);
  const r = await api("get-invitation", { id: "consumers/" + name });
  assert.equal(r.quota, 2);
  await api(
    "update-invitation",
    { id: "consumers/" + name },
    { ...r, state: "Inactive" },
  );
  assert.equal(
    (await api("get-invitation", { id: "consumers/" + name })).state,
    "Inactive",
  );
});
await run("device-code", async () => {
  const base = await api("get-application", { id: "admin/zhenyi-center" }),
    name = "qa_device_" + suffix;
  const app = {
    ...base,
    name,
    clientId: randomBytes(16).toString("hex"),
    clientSecret: randomBytes(32).toString("hex"),
    grantTypes: [
      ...base.grantTypes,
      "urn:ietf:params:oauth:grant-type:device_code",
    ],
    signinMethods: [
      ...base.signinMethods,
      { name: "Device login", rule: "All" },
    ],
  };
  await api("add-application", {}, app);
  const u = "qa_device_user_" + suffix,
    pw = "Local-" + suffix;
  await api(
    "add-user",
    {},
    {
      owner: "consumers",
      name: u,
      id: randomUUID(),
      password: pw,
      type: "normal-user",
      displayName: "设备授权测试",
      createdTime: new Date().toISOString(),
    },
  );
  const device = (await (
    await fetch(
      config.CASDOOR_URL +
        "/api/device-auth?" +
        new URLSearchParams({
          client_id: app.clientId,
          scope: "openid profile",
        }),
      { method: "POST" },
    )
  ).json()) as any;
  assert(device.device_code && device.user_code, JSON.stringify(device));
  const poll = async () =>
    (await (
      await fetch(config.CASDOOR_URL + "/api/login/oauth/access_token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "urn:ietf:params:oauth:grant-type:device_code",
          client_id: app.clientId,
          client_secret: app.clientSecret,
          device_code: device.device_code,
        }),
      })
    ).json()) as any;
  assert.equal((await poll()).error, "authorization_pending");
  const logged = (await (
    await fetch(config.CASDOOR_URL + "/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        application: name,
        organization: "consumers",
        username: u,
        password: pw,
        type: "device",
        userCode: device.user_code,
        signinMethod: "Password",
        loginMethod: "password",
        autoSignin: true,
      }),
    })
  ).json()) as any;
  assert.equal(logged.status, "ok", logged.msg);
  const issued = await poll();
  assert(issued.access_token, JSON.stringify(issued));
});
await run("integrations", async () => {
  const index = await api("get-marketplace-index"),
    item = index.integrations.find((x: any) => x.type === "app");
  assert(item);
  const version = item.versions[0]?.version || item.latest;
  assert(version);
  const bundle = await api("get-marketplace-bundle", {
    integrationId: item.id,
    version,
  });
  const variables = Object.fromEntries(
    bundle.manifest.variables.map((v: any) => [
      v.name,
      v.type === "url"
        ? "http://127.0.0.1:5488"
        : v.name.toLowerCase().includes("url")
          ? "http://127.0.0.1:5488"
          : "qa_" + suffix,
    ]),
  );
  const installed = await api(
    "install-integration",
    {},
    {
      owner: "consumers",
      name: "qa_integration_" + suffix,
      integrationId: item.id,
      version,
      variables,
    },
  );
  assert(installed.name);
  const saved = await api("get-integration", {
    id: installed.owner + "/" + installed.name,
  });
  assert(saved);
  await api("delete-integration", {}, saved);
  assert.equal(
    await api("get-integration", {
      id: installed.owner + "/" + installed.name,
    }),
    null,
  );
});
await run("webhooks", async () => {
  let delivered = 0;
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      delivered++;
      res.statusCode = delivered === 1 ? 503 : 200;
      res.end(delivered === 1 ? "temporary local test failure" : "ok");
    });
  });
  await new Promise<void>((r) => server.listen(5489, "127.0.0.1", r));
  const hook = {
    owner: "built-in",
    organization: "built-in",
    name: "qa_hook_" + suffix,
    url: "http://127.0.0.1:5489/events",
    method: "POST",
    contentType: "application/json",
    events: ["update-user"],
    singleOrgOnly: false,
    isEnabled: true,
    maxRetries: 3,
    retryInterval: 1,
    useExponentialBackoff: false,
    createdTime: new Date().toISOString(),
  };
  try {
    await api("add-webhook", {}, hook);
    const username = "qa_hook_user_" + suffix;
    await api(
      "add-user",
      {},
      {
        owner: "consumers",
        name: username,
        id: randomUUID(),
        password: "Local-" + suffix,
        displayName: "Webhook验证",
        type: "normal-user",
        createdTime: new Date().toISOString(),
      },
    );
    const user = await api("get-user", { id: "consumers/" + username });
    await api(
      "update-user",
      { id: "consumers/" + username },
      { ...user, displayName: "Webhook验证已更新" },
    );
    for (let i = 0; i < 75 && delivered < 2; i++)
      await new Promise((r) => setTimeout(r, 1000));
    assert(delivered >= 2, "未收到失败后重试的真实Webhook");
    let success = false;
    for (let i = 0; i < 10; i++) {
      const events = await api("get-webhook-events", {
        owner: "built-in",
        webhook: "built-in/" + hook.name,
      });
      success = events.some(
        (e: any) => e.state === "Success" && e.attemptCount >= 2,
      );
      if (success) break;
      await new Promise((r) => setTimeout(r, 500));
    }
    assert(success, "投递记录未标为成功或未记录重试");
  } finally {
    await api(
      "update-webhook",
      { id: "built-in/" + hook.name },
      { ...hook, isEnabled: false },
    );
    await new Promise<void>((r) => server.close(() => r()));
  }
});
const previous = only
  ? await readFile(".local/auxiliary-verification.json", "utf8")
      .then(JSON.parse)
      .catch(() => ({ results: [] }))
  : { results: [] };
const merged = [
  ...previous.results.filter((r: any) => !results.some((x) => x.id === r.id)),
  ...results,
];
await writeFile(
  ".local/auxiliary-verification.json",
  JSON.stringify({ date: new Date().toISOString(), results: merged }, null, 2),
  { mode: 0o600 },
);
for (const r of results)
  await pool.query(
    "INSERT INTO capability_checks(id,status,detail) VALUES($1,$2,$3) ON CONFLICT(id) DO UPDATE SET status=EXCLUDED.status,detail=EXCLUDED.detail,checked_at=now()",
    [r.id, r.status, r.detail],
  );
await pool.end();

if (results.some((r) => r.status === "验证失败")) process.exitCode = 1;
