import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { randomBytes, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { DOMParser } from "@xmldom/xmldom";
import { SignedXml } from "xml-crypto";
import pg from "pg";
import { config, appConfigs } from "../src/server/config";
import { casdoorApi } from "../src/server/casdoor";
import { pool } from "../src/server/db";
import { login, testAdministrator } from "../tests/helpers";
import { hash } from "../src/server/auth";
assert(
  !config.production && new URL(config.CASDOOR_URL).hostname === "localhost",
);
const credentials = await testAdministrator(),
  admin = await login("admin", credentials.username, credentials.password);
const token = (
  await pool.query("SELECT access_token FROM sessions WHERE token_hash=$1", [
    hash(admin.cookie.split("=")[1]),
  ])
).rows[0].access_token;
const native = (path: string, p: any = {}, b?: any) =>
  casdoorApi(path, p, b, token);
const suffix = randomBytes(4).toString("hex"),
  name = "qa_protocol_" + suffix;
const userName = "qa_protocol_user_" + suffix,
  password = "Local-" + randomBytes(12).toString("hex");
const existing = await native("get-application", { id: "admin/zhenyi-center" });
const service = "http://127.0.0.1:5488/callback",
  entity = "http://127.0.0.1:5488/sp";
const application = {
  ...existing,
  name,
  displayName: "仅本机协议验收",
  clientId: randomBytes(16).toString("hex"),
  clientSecret: randomBytes(32).toString("hex"),
  redirectUris: [service, entity],
  samlReplyUrl: service,
  enableSamlCompress: false,
  enableSamlC14n10: true,
  enableSamlAssertionSignature: true,
  enableSigninSession: true,
};
await native("add-application", {}, application);
await native(
  "add-user",
  {},
  {
    owner: "consumers",
    name: userName,
    id: randomUUID(),
    password,
    displayName: "协议验收用户",
    type: "normal-user",
    createdTime: new Date().toISOString(),
  },
);
const results: any[] = [];
const only = process.argv[2]?.split(",");
async function run(id: string, fn: () => Promise<any>) {
  if (only && !only.includes(id)) return;
  try {
    await fn();
    results.push({
      id,
      status: "已集成并验证",
      detail: "本轮独立本地客户端操作通过",
    });
    console.log("PASS", id);
  } catch (e: any) {
    results.push({ id, status: "验证失败", detail: e.message.slice(0, 200) });
    console.log("FAIL", id, e.message.slice(0, 200));
  }
}
const loginBody = {
  application: name,
  organization: "consumers",
  username: userName,
  password,
  type: "cas",
  autoSignin: true,
  signinMethod: "Password",
  loginMethod: "password",
};
async function sign(body: any, query = "") {
  const r = await fetch(config.CASDOOR_URL + "/api/login" + query, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const b = (await r.json()) as any;
  assert.equal(b.status, "ok", b.msg);
  return b;
}
await run("CAS", async () => {
  const b = await sign(loginBody, "?service=" + encodeURIComponent(service));
  assert(String(b.data).startsWith("ST"));
  const u =
    config.CASDOOR_URL +
    "/cas/consumers/" +
    name +
    "/serviceValidate?" +
    new URLSearchParams({ service, ticket: b.data });
  const xml = await (await fetch(u)).text();
  assert(xml.includes("authenticationSuccess") && xml.includes(userName));
  const replay = await (await fetch(u)).text();
  assert(
    !replay.includes("authenticationSuccess"),
    "CAS ticket replay accepted",
  );
  const denied = await sign(
    loginBody,
    "?service=" + encodeURIComponent(service),
  );
  const invalid = await (
    await fetch(
      config.CASDOOR_URL +
        "/cas/consumers/" +
        name +
        "/serviceValidate?" +
        new URLSearchParams({
          service: "http://127.0.0.1:5488/wrong",
          ticket: denied.data,
        }),
    )
  ).text();
  assert(!invalid.includes("authenticationSuccess"));
});
await run("SAML", async () => {
  const requestId = "_" + randomUUID();
  const xml = `<samlp:AuthnRequest xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ID="${requestId}" Version="2.0" IssueInstant="${new Date().toISOString()}" AssertionConsumerServiceURL="${service}" ProtocolBinding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST"><saml:Issuer>${entity}</saml:Issuer></samlp:AuthnRequest>`;
  const b = await sign({
    ...loginBody,
    type: "saml",
    samlRequest: Buffer.from(xml).toString("base64"),
  });
  const response = Buffer.from(b.data, "base64").toString();
  const doc = new DOMParser().parseFromString(response, "text/xml");
  assert.equal(doc.documentElement.getAttribute("InResponseTo"), requestId);
  assert.equal(doc.documentElement.getAttribute("Destination"), service);
  const audiences = Array.from(
    doc.getElementsByTagNameNS(
      "urn:oasis:names:tc:SAML:2.0:assertion",
      "Audience",
    ),
  ).map((x) => x.textContent);
  assert(audiences.includes(entity));
  assert(response.includes(userName));
  const cert = await native("get-cert", {
    id: existing.cert.includes("/") ? existing.cert : "admin/" + existing.cert,
  });
  const verifier = new SignedXml({
    publicCert: cert.certificate,
    getCertFromKeyInfo: () => null,
  });
  verifier.loadSignature(
    doc.getElementsByTagNameNS(
      "http://www.w3.org/2000/09/xmldsig#",
      "Signature",
    )[0],
  );
  assert(verifier.checkSignature(response), "签名验证未通过");
  let rejected = false;
  try {
    rejected = !verifier.checkSignature(
      response.replace(userName, userName + "_tampered"),
    );
  } catch {
    rejected = true;
  }
  assert(rejected, "修改SAML响应后仍通过签名");
});
await run("MCP", async () => {
  const mcpApp = {
    ...(await native("get-application", { id: "admin/zhenyi-admin" })),
    name: name + "_mcp",
    clientId: randomBytes(16).toString("hex"),
    clientSecret: randomBytes(32).toString("hex"),
    redirectUris: [service],
    scopes: [
      { name: "openid" },
      { name: "profile" },
      {
        name: "user:read",
        displayName: "仅读取用户",
        description: "本机MCP协议验收",
      },
    ],
  };
  await native("add-application", {}, mcpApp);
  const verifier = randomBytes(32).toString("base64url");
  const query = new URLSearchParams({
    clientId: mcpApp.clientId,
    responseType: "code",
    redirectUri: service,
    type: "code",
    scope: "openid profile user:read",
    state: randomUUID(),
    nonce: randomUUID(),
    code_challenge_method: "S256",
    code_challenge: createHash("sha256").update(verifier).digest("base64url"),
  });
  const code = await sign(
    {
      application: mcpApp.name,
      organization: "built-in",
      username: credentials.username,
      password: credentials.password,
      type: "code",
      autoSignin: true,
      signinMethod: "Password",
      loginMethod: "password",
    },
    "?" + query,
  );
  const exchange = await fetch(
    config.CASDOOR_URL + "/api/login/oauth/access_token",
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: mcpApp.clientId,
        client_secret: mcpApp.clientSecret,
        code: code.data,
        redirect_uri: service,
        code_verifier: verifier,
      }),
    },
  );
  const tokens = (await exchange.json()) as any;
  assert(tokens.access_token, JSON.stringify(tokens));
  const rpc = async (method: string, params: any = {}) => {
    const r = await fetch(config.CASDOOR_URL + "/api/mcp", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + tokens.access_token,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: randomUUID(),
        method,
        params,
      }),
    });
    const b = (await r.json()) as any;
    assert(!b.error, JSON.stringify(b.error));
    return b.result;
  };
  assert(
    (
      await rpc("initialize", {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "本机验证客户端", version: "1" },
      })
    ).serverInfo,
  );
  const tools = await rpc("tools/list");
  assert(tools.tools.length > 0);
  const getUsers = tools.tools.find((x: any) => /get.?users/i.test(x.name));
  assert(getUsers);
  const result = await rpc("tools/call", {
    name: getUsers.name,
    arguments: { owner: "consumers" },
  });
  assert(result.content.length);
});
await run("database-sync", async () => {
  const dbName = "postgres",
    fixturePassword = randomBytes(24).toString("hex"),
    container = "zhenyi-accounts-sync-fixture";
  await writeFile(
    ".local/sync-fixture.env",
    "POSTGRES_PASSWORD=" + fixturePassword + "\n",
    { mode: 0o600 },
  );
  execFileSync(
    "docker",
    [
      "run",
      "-d",
      "--rm",
      "--name",
      container,
      "-p",
      "127.0.0.1:5355:5432",
      "--env-file",
      ".local/sync-fixture.env",
      "--tmpfs",
      "/var/lib/postgresql/data",
      "postgres:17-alpine@sha256:0b2882c46a2b8d8e148431b333394348cf4d7f15aec6df7f17d51dc641e56cfa",
    ],
    { stdio: "ignore" },
  );
  let source: any;
  for (let i = 0; i < 25; i++) {
    source = new pg.Client({
      host: "127.0.0.1",
      port: 5355,
      user: "postgres",
      password: fixturePassword,
      database: dbName,
    });
    try {
      await source.connect();
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 300));
    }
  }
  await source.query(
    "CREATE TABLE qa_users(id text PRIMARY KEY, username text, display_name text)",
  );
  await source.query("INSERT INTO qa_users VALUES($1,$2,$3)", [
    randomUUID(),
    "sync_" + suffix,
    "本机目录同步",
  ]);
  await source.end();
  const org = "qa_syncorg_" + suffix,
    template = await native("get-organization", { id: "admin/consumers" });
  await native(
    "add-organization",
    {},
    {
      ...template,
      name: org,
      displayName: "独立同步验收组织",
      trustedDbHosts: "127.0.0.1:5355",
    },
  );
  const syncer = {
    owner: "admin",
    name: "qa_syncer_" + suffix,
    organization: org,
    type: "Database",
    databaseType: "postgres",
    sslMode: "disable",
    host: "127.0.0.1",
    port: 5355,
    user: "postgres",
    password: fixturePassword,
    database: dbName,
    table: "qa_users",
    tableColumns: [
      { name: "id", type: "varchar", casdoorName: "Id", isKey: true },
      { name: "username", type: "varchar", casdoorName: "Name" },
      { name: "display_name", type: "varchar", casdoorName: "DisplayName" },
    ],
    isReadOnly: true,
    isEnabled: false,
  };
  try {
    await native("test-syncer-db", {}, syncer);
    await native("add-syncer", {}, syncer);
    await native("run-syncer", { id: "admin/" + syncer.name }, {});
    const user = await native("get-user", { id: org + "/sync_" + suffix });
    assert.equal(user.displayName, "本机目录同步");
    await native("run-syncer", { id: "admin/" + syncer.name }, {});
    assert.equal(
      (await native("get-users", { owner: org })).filter(
        (u: any) => u.name === "sync_" + suffix,
      ).length,
      1,
    );
  } finally {
    execFileSync("docker", ["stop", container], { stdio: "ignore" });
  }
});
const previous = only
  ? JSON.parse(await readFile(".local/protocol-verification.json", "utf8"))
  : { results: [] };
const combined = [
  ...previous.results.filter((r: any) => !results.some((x) => x.id === r.id)),
  ...results,
];
await writeFile(
  ".local/protocol-verification.json",
  JSON.stringify(
    { date: new Date().toISOString(), results: combined },
    null,
    2,
  ),
  { mode: 0o600 },
);
for (const r of results)
  await pool.query(
    "INSERT INTO capability_checks(id,status,detail) VALUES($1,$2,$3) ON CONFLICT(id) DO UPDATE SET status=EXCLUDED.status,detail=EXCLUDED.detail,checked_at=now()",
    [r.id, r.status, r.detail],
  );
await pool.end();

if (results.some((r) => r.status === "验证失败")) process.exitCode = 1;
