import assert from "node:assert/strict";
import ts from "typescript";
import vm from "node:vm";
import { readFile, writeFile } from "node:fs/promises";
import { randomBytes, randomUUID, createHmac } from "node:crypto";
import { casdoorApi } from "../src/server/casdoor";
import { config, appConfigs } from "../src/server/config";
import { pool } from "../src/server/db";
import { login, testAdministrator } from "../tests/helpers";
import { hash } from "../src/server/auth";
import { modules } from "../src/server/management";
assert(
  !config.production &&
    ["localhost", "127.0.0.1"].includes(new URL(config.CASDOOR_URL).hostname),
  "只允许本机验收",
);
const credentials = await testAdministrator();
const adminSession = await login(
  "admin",
  credentials.username,
  credentials.password,
);
const accessToken = (
  await pool.query("SELECT access_token FROM sessions WHERE token_hash=$1", [
    hash(adminSession.cookie.slice(adminSession.cookie.indexOf("=") + 1)),
  ])
).rows[0].access_token;
const native = (path: string, params: any = {}, body?: any) =>
  casdoorApi(path, params, body, accessToken);
const suffix = randomBytes(5).toString("hex"),
  org = "qa_full_" + suffix;
const results: any[] = [];
const only = process.argv[2];
const basic = "Bearer " + accessToken;
async function run(id: string, fn: () => Promise<any>) {
  if (only && id !== only) return;
  try {
    await fn();
    results.push({
      id,
      status: "已集成并验证",
      detail: "本轮实际操作通过",
      checked_at: new Date().toISOString(),
    });
    console.log("PASS", id);
  } catch (e: any) {
    results.push({
      id,
      status: "验证失败",
      detail: String(e.message).slice(0, 200),
      checked_at: new Date().toISOString(),
    });
    console.log("FAIL", id, String(e.message).slice(0, 200));
  }
}
async function form(path: string, body: any) {
  const r = await fetch(config.CASDOOR_URL + "/api/" + path, {
    method: "POST",
    headers: { Authorization: basic },
    body: new URLSearchParams(body),
  });
  const b = (await r.json()) as any;
  assert.equal(b.status, "ok", b.msg);
  return b.data;
}
const text = await readFile(
  ".upstream/source-v4.22.0/web/src/pages/defaults.ts",
  "utf8",
);
const sf = ts.createSourceFile(
  "defaults.ts",
  text,
  ts.ScriptTarget.Latest,
  true,
);
const nodes = sf.statements.filter((n) => !ts.isImportDeclaration(n));
const output = ts.transpileModule(nodes.map((n) => n.getText(sf)).join("\n"), {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2023,
  },
}).outputText;
const exports: any = {};
const date = (x?: any) => ({
  format: () => new Date(x || Date.now()).toISOString(),
  add: (days: number) => date(Date.now() + days * 86400000),
});
vm.runInNewContext(output, {
  exports,
  dayjs: date,
  Conf: { DefaultApplication: "zhenyi-center" },
  SignupTableDefaultCssMap: {},
  Setting: new Proxy(
    {
      getRandomName: () => suffix,
      getRequestOrganization: () => org,
      isDefaultOrganizationSelected: () => false,
      isLocalAdminUser: () => true,
      StaticBaseUrl: "",
    },
    { get: (o: any, k: any) => o[k] || (() => suffix) },
  ),
});
const account = { owner: org, name: "qa_user", isAdmin: true };
const objects: any = {};
const baseOrg = await native("get-organization", { id: "admin/consumers" });
await native(
  "add-organization",
  {},
  {
    ...baseOrg,
    name: org,
    displayName: "本机完整集成验收",
    createdTime: new Date().toISOString(),
    isProfilePublic: false,
  },
);
if (only === "scim") {
  const app = await native("get-application", { id: "admin/zhenyi-center" });
  await native(
    "add-application",
    {},
    {
      ...app,
      name: "qa_scim_app_" + suffix,
      organization: org,
      clientId: randomBytes(16).toString("hex"),
      clientSecret: randomBytes(32).toString("hex"),
    },
  );
}
const types = [
  "Group",
  "Role",
  "Model",
  "Adapter",
  "Enforcer",
  "Application",
  "Provider",
  "Cert",
  "Key",
  "Permission",
  "Product",
  "Plan",
  "Pricing",
  "Coupon",
  "Subscription",
  "Order",
  "Payment",
  "Transaction",
  "Agent",
  "Server",
  "Entry",
  "Site",
  "Rule",
  "Form",
  "Syncer",
  "Webhook",
  "Ticket",
];
const ids: Record<string, string> = {
  Application: "applications",
  Provider: "providers",
  Cert: "certs",
  Key: "keys",
  Group: "groups",
  Role: "roles",
  Model: "models",
  Adapter: "adapters",
  Enforcer: "enforcers",
  Permission: "permissions",
  Product: "products",
  Plan: "plans",
  Pricing: "pricings",
  Coupon: "coupons",
  Subscription: "subscriptions",
  Order: "orders",
  Payment: "payments",
  Transaction: "transactions",
  Agent: "agents",
  Server: "servers",
  Entry: "entries",
  Site: "sites",
  Rule: "rules",
  Form: "forms",
  Syncer: "syncers",
  Webhook: "webhooks",
  Ticket: "tickets",
};
await run("organizations", async () => {
  assert.equal(
    (await native("get-organization", { id: "admin/" + org })).name,
    org,
  );
  await native(
    "update-organization",
    { id: "admin/" + org },
    { ...baseOrg, name: org, displayName: "本机完整集成验收-更新" },
  );
  assert.equal(
    (await native("get-organization", { id: "admin/" + org })).displayName,
    "本机完整集成验收-更新",
  );
});
for (const type of types)
  await run(ids[type], async () => {
    const body = exports["new" + type](account);
    if (type === "Adapter") body.table = "qa_policy_" + suffix;
    if (type === "Enforcer") {
      body.model = objects.Model.owner + "/" + objects.Model.name;
      body.adapter = objects.Adapter.owner + "/" + objects.Adapter.name;
    }
    if (type === "Provider") {
      body.category = "Email";
      body.type = "Default";
      body.clientId = "";
      body.clientSecret = "";
    }
    if (type === "Cert") body.bitSize = 2048;
    if (type === "Syncer") {
      body.password = "";
      body.isEnabled = false;
    }
    if (type === "Transaction") body.type = "Deposit";
    if (type === "Application") {
      body.providers = [];
      body.organization = org;
      body.redirectUris = ["http://127.0.0.1:5488/callback"];
    }
    if (type === "Plan") body.isEnabled = false;
    if (type === "Permission") {
      body.users = [org + "/qa_user"];
      body.resources = ["zhenyi-center"];
    }
    if (type === "Server") body.url = "http://127.0.0.1:5488/mcp";
    const entity = type.replace(
      /[A-Z]/g,
      (c, i) => (i ? "-" : "") + c.toLowerCase(),
    );
    objects[type] = body;
    const added = await native("add-" + entity, {}, body);
    if (type === "Transaction") {
      body.name = String(added).split("/").pop();
    }
    const saved = await native("get-" + entity, {
      id: body.owner + "/" + body.name,
    });
    assert(saved && saved.name === body.name, "新增后读取不一致");
    const field =
      type === "Adapter"
        ? "user"
        : type === "Rule"
          ? "reason"
          : type === "Syncer"
            ? "affiliationTable"
            : type === "Webhook"
              ? "contentType"
              : "displayName";
    const expected =
      type === "Webhook"
        ? "application/json"
        : type === "Syncer"
          ? "qa_affiliation_" + suffix
          : "本轮已更新 " + type;
    await native(
      "update-" + entity,
      { id: body.owner + "/" + body.name },
      { ...saved, [field]: expected },
    );
    const updated = await native("get-" + entity, {
      id: body.owner + "/" + body.name,
    });
    assert.equal(updated[field], expected);
    if ("isEnabled" in saved) {
      await native(
        "update-" + entity,
        { id: body.owner + "/" + body.name },
        { ...updated, isEnabled: false },
      );
      assert.equal(
        (await native("get-" + entity, { id: body.owner + "/" + body.name }))
          .isEnabled,
        false,
      );
    }
  });
if (objects.Site) await native("delete-site", {}, objects.Site);
await run("casbin-enforce", async () => {
  const id = objects.Enforcer.owner + "/" + objects.Enforcer.name;
  await native(
    "add-policy",
    { id },
    { ptype: "p", v0: "alice", v1: "export", v2: "read" },
  );
  const params = {
    enforcerId: objects.Enforcer.owner + "/" + objects.Enforcer.name,
  };
  assert.deepEqual(
    await native("enforce", params, ["alice", "export", "read"]),
    [true],
  );
  assert.deepEqual(await native("enforce", params, ["bob", "export", "read"]), [
    false,
  ]);
});
const username = "qa_complete_" + suffix,
  password = "Local-" + randomBytes(12).toString("hex"),
  user = {
    owner: "consumers",
    name: username,
    id: randomUUID(),
    displayName: "完整接入测试用户",
    type: "normal-user",
    password,
    isAdmin: false,
    createdTime: new Date().toISOString(),
  };
await native("add-user", {}, user);
await run("users", async () => {
  const saved = await native("get-user", { id: "consumers/" + username });
  await native(
    "update-user",
    { id: "consumers/" + username },
    { ...saved, displayName: "完整接入测试用户-更新" },
  );
  assert.equal(
    (await native("get-user", { id: "consumers/" + username })).id,
    user.id,
  );
});
function totp(secret: string) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const c of secret)
    bits += alphabet.indexOf(c).toString(2).padStart(5, "0");
  const b = Buffer.from(bits.match(/.{8}/g)!.map((x) => parseInt(x, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)));
  const h = createHmac("sha1", b).update(counter).digest();
  const offset = h[19] & 15;
  return String((h.readUInt32BE(offset) & 0x7fffffff) % 1000000).padStart(
    6,
    "0",
  );
}
await run("totp", async () => {
  const body = { owner: "consumers", name: username, mfaType: "app" };
  const init = await form("mfa/setup/initiate", body);
  assert(init.secret);
  await form("mfa/setup/verify", {
    ...body,
    secret: init.secret,
    passcode: totp(init.secret),
  });
  await form("mfa/setup/enable", {
    ...body,
    secret: init.secret,
    recoveryCodes: init.recoveryCodes.join(","),
  });
  assert.equal(
    (await native("get-user", { id: "consumers/" + username }))
      .preferredMfaType,
    "app",
  );
  const loginBody = {
    application: "zhenyi-center",
    organization: "consumers",
    username,
    password,
    autoSignin: true,
    type: "login",
    signinMethod: "Password",
    loginMethod: "password",
  };
  const first = await fetch(config.CASDOOR_URL + "/api/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(loginBody),
  });
  const d = (await first.json()) as any;
  assert.equal(d.status, "ok");
  assert(
    d.data === "mfa" || JSON.stringify(d).includes("app"),
    "未进入真实MFA挑战",
  );
  const cookie = first.headers
    .getSetCookie()
    .map((x) => x.split(";")[0])
    .join("; ");
  const bad = await fetch(config.CASDOOR_URL + "/api/login", {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({
      ...loginBody,
      password: "",
      username: "",
      mfaType: "app",
      passcode: "000000",
    }),
  });
  assert.notEqual(((await bad.json()) as any).status, "ok");
  const good = await fetch(config.CASDOOR_URL + "/api/login", {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({
      ...loginBody,
      password: "",
      username: "",
      mfaType: "app",
      passcode: totp(init.secret),
    }),
  });
  assert.equal(((await good.json()) as any).status, "ok");
  await form("delete-mfa", body);
  assert.equal(
    (await native("get-user", { id: "consumers/" + username })).totpSecret,
    "",
  );
});
await run("scim", async () => {
  const call = async (path: string, body?: any, method?: string) => {
    const r = await fetch(config.CASDOOR_URL + "/scim" + path, {
      method: method || (body ? "POST" : "GET"),
      headers: {
        Authorization: basic,
        "Content-Type": "application/scim+json",
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const b = (await r.json()) as any;
    assert(r.ok, JSON.stringify(b));
    return b;
  };
  const u = await call("/Users", {
    schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"],
    userName: "qa_scim_" + suffix,
    displayName: "SCIM本机验收",
    active: true,
    "urn:ietf:params:scim:schemas:extension:enterprise:2.0:User": {
      organization: org,
    },
  });
  assert(u.id, JSON.stringify(u));
  assert.equal((await call("/Users/" + u.id)).userName, "qa_scim_" + suffix);
  await call(
    "/Users/" + u.id,
    {
      schemas: ["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
      Operations: [
        { op: "replace", path: "displayName", value: "SCIM更新完成" },
      ],
    },
    "PATCH",
  );
  assert.equal((await call("/Users/" + u.id)).displayName, "SCIM更新完成");
  const g = await call("/Groups", {
    schemas: ["urn:ietf:params:scim:schemas:core:2.0:Group"],
    displayName: "qa_scim_group_" + suffix,
    "urn:ietf:params:scim:schemas:extension:enterprise:2.0:Group": {
      organization: org,
    },
  });
  assert(g.id);
  assert.equal(
    (await call("/Groups/" + g.id)).displayName,
    "qa_scim_group_" + suffix,
  );
  await call(
    "/Groups/" + g.id,
    {
      schemas: ["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
      Operations: [
        { op: "replace", path: "displayName", value: "SCIM分组更新" },
      ],
    },
    "PATCH",
  );
  assert.equal((await call("/Groups/" + g.id)).displayName, "SCIM分组更新");
});
// Read checks only: these do not stand in for successful writes or external provider verification.
for (const m of modules.filter((x) => x.endpoint))
  if (!results.some((x) => x.id === m.id))
    await run(m.id, async () => {
      const data = await native(m.endpoint, {
        owner: "consumers",
        userName: username,
        ...(m.id === "cart" ? { id: "built-in/" + credentials.username } : {}),
      });
      assert(data !== undefined);
    });
const previous = only
  ? JSON.parse(await readFile(".local/native-verification.json", "utf8"))
  : { results: [] };
const combined = [
  ...previous.results.filter((r: any) => !results.some((x) => x.id === r.id)),
  ...results,
];
await writeFile(
  ".local/native-verification.json",
  JSON.stringify(
    { date: new Date().toISOString(), org, results: combined },
    null,
    2,
  ),
  { mode: 0o600 },
);
await writeFile(
  ".local/complete-qa-user.json",
  JSON.stringify({ username, password, subject: user.id, objects, org }),
  { mode: 0o600 },
);
for (const r of results)
  await pool.query(
    "INSERT INTO capability_checks(id,status,detail) VALUES($1,$2,$3) ON CONFLICT(id) DO UPDATE SET status=EXCLUDED.status,detail=EXCLUDED.detail,checked_at=now()",
    [
      r.id,
      modules.find((m) => m.id === r.id)?.dependencies &&
      ![
        "marketplace",
        "applications",
        "enforcers",
        "cart",
        "product-store",
      ].includes(r.id)
        ? "已集成，等待外部配置"
        : r.status,
      r.status === "已集成并验证"
        ? "本轮脚本限定的操作通过；具体范围见 docs/full-coverage.md，不代表全部操作通过"
        : r.detail,
    ],
  );
console.log(
  "RESULT",
  results.filter((x) => x.status === "已集成并验证").length,
  "passed",
  results.filter((x) => x.status === "验证失败").length,
  "failed",
);
await pool.end();

if (results.some((r) => r.status === "验证失败")) process.exitCode = 1;
