// The upstream LDAP/RADIUS listeners bind 0.0.0.0. Test them only inside a container,
// publishing loopback ports. The running identity database is never reused.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import dgram from "node:dgram";
import tls from "node:tls";
import { config } from "../src/server/config";
import { pool } from "../src/server/db";
assert(!config.production && config.host === "127.0.0.1", "只允许回环本机验收");
const root = resolve(".local/protocol-isolation"),
  suffix = randomBytes(4).toString("hex"),
  db = "qa_listener_" + suffix,
  container = "zhenyi-accounts-protocol-fixture";
const image =
  "postgres:17-alpine@sha256:0b2882c46a2b8d8e148431b333394348cf4d7f15aec6df7f17d51dc641e56cfa";
const expected =
  "9039df7a25b9bfb867977dd1792551dd2c6f42baa051cc6753f902f3a33d0ffb";
const archive = resolve(".upstream/casdoor_Linux_arm64.tar.gz");
try {
  await readFile(archive);
} catch {
  execFileSync("curl", [
    "-fL",
    "--max-time",
    "120",
    "https://github.com/casdoor/casdoor/releases/download/v4.22.0/casdoor_Linux_arm64.tar.gz",
    "-o",
    archive,
  ]);
}
assert.equal(
  createHash("sha256")
    .update(await readFile(archive))
    .digest("hex"),
  expected,
  "Linux发布包校验失败",
);
await mkdir(root, { recursive: true, mode: 0o700 });
execFileSync("tar", ["-xzf", archive, "-C", root, "--exclude", "conf"]);
await mkdir(root + "/conf", { recursive: true });
const dc = ["compose", "--env-file", ".env", "-f", "infra/compose.yml"];
execFileSync(
  "docker",
  [
    ...dc,
    "exec",
    "-T",
    "postgres",
    "createdb",
    "-U",
    "postgres",
    "-O",
    "casdoor",
    db,
  ],
  { stdio: "ignore" },
);
const username = "listener_user",
  password = "Local-" + randomBytes(16).toString("hex"),
  radiusSecret = randomBytes(24).toString("hex");
const template = JSON.parse(
  await readFile("infra/casdoor-init.template.json", "utf8"),
);
const org = (name: string) => ({
  ...template.organizations[0],
  owner: "admin",
  name,
  displayName: name,
  passwordType: "bcrypt",
  passwordOptions: ["AtLeast8"],
  enableRadius: true,
  defaultApplication: name === "built-in" ? "app-built-in" : "app-protocol",
});
const clientId = randomBytes(16).toString("hex"),
  clientSecret = randomBytes(32).toString("hex");
const init = {
  organizations: [org("built-in"), org("consumers")],
  users: [
    {
      owner: "built-in",
      name: "admin",
      id: randomUUID(),
      password: randomBytes(32).toString("hex"),
      isAdmin: true,
      type: "normal-user",
      createdTime: new Date().toISOString(),
    },
    {
      owner: "consumers",
      name: username,
      id: randomUUID(),
      password,
      displayName: "本机协议监听验收",
      type: "normal-user",
      createdTime: new Date().toISOString(),
    },
  ],
  applications: [
    {
      ...template.applications[0],
      owner: "admin",
      name: "app-built-in",
      organization: "built-in",
      clientId,
      clientSecret,
      enablePassword: true,
      grantTypes: ["authorization_code", "password", "client_credentials"],
      redirectUris: ["http://localhost:5356/callback"],
    },
  ],
};
init.applications.push({
  ...init.applications[0],
  name: "app-protocol",
  organization: "consumers",
  clientId: randomBytes(16).toString("hex"),
  clientSecret: randomBytes(32).toString("hex"),
});
await writeFile(root + "/init_data.json", JSON.stringify(init), {
  mode: 0o600,
});
await writeFile(
  root + "/conf/app.conf",
  `appname = casdoor\nhttpport = 8000\nhttpaddr = 0.0.0.0\nrunmode = prod\ncopyrequestbody = true\ndriverName = postgres\ndataSourceName = "user=casdoor password=${process.env.CASDOOR_DB_PASSWORD} host=postgres port=5432 sslmode=disable dbname=${db}"\ndbName = ${db}\nshowSql = false\norigin = http://localhost:5356\ninitDataFile = ./init_data.json\ninitDataNewOnly = false\ninitAdminPassword = ${randomBytes(24).toString("hex")}\nldapServerPort = 1389\nldapsServerPort = 1636\nldapsCertId = admin/qa-local-tls\nradiusServerPort = 1812\nradiusSecret = ${radiusSecret}\nradiusDefaultOrganization = consumers\n`,
  { mode: 0o600 },
);
execFileSync(
  "openssl",
  [
    "req",
    "-x509",
    "-newkey",
    "rsa:2048",
    "-nodes",
    "-keyout",
    root + "/tls.key",
    "-out",
    root + "/tls.pem",
    "-days",
    "1",
    "-subj",
    "/CN=localhost",
    "-addext",
    "subjectAltName=DNS:localhost,IP:127.0.0.1",
  ],
  { stdio: "ignore" },
);
// Import the trusted test TLS certificate through official initialization, not by modifying Casdoor tables.
(init as any).certs = [
  {
    owner: "admin",
    name: "qa-local-tls",
    scope: "SSL",
    type: "x509",
    cryptoAlgorithm: "RS256",
    certificate: await readFile(root + "/tls.pem", "utf8"),
    privateKey: await readFile(root + "/tls.key", "utf8"),
  },
];
await writeFile(root + "/init_data.json", JSON.stringify(init), {
  mode: 0o600,
});
await writeFile(root + "/ldap-password", password, { mode: 0o600 });
const requireCa = await readFile(root + "/tls.pem");
const results: any[] = [];
const only = process.argv[2];
try {
  execFileSync(
    "docker",
    [
      "run",
      "-d",
      "--name",
      container,
      "--network",
      "zhenyi-accounts_default",
      "-p",
      "127.0.0.1:5356:8000",
      "-p",
      "127.0.0.1:5357:1389",
      "-p",
      "127.0.0.1:5359:1636",
      "-p",
      "127.0.0.1:5358:1812/udp",
      "-v",
      root + ":/workspace",
      "-w",
      "/workspace",
      "--entrypoint",
      "/workspace/casdoor",
      image,
    ],
    { stdio: "ignore" },
  );
  for (let i = 0; i < 40; i++) {
    try {
      if ((await fetch("http://127.0.0.1:5356/api/health")).ok) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 300));
  }
  assert(
    (await fetch("http://127.0.0.1:5356/api/health")).ok,
    "隔离身份服务未启动",
  );
  for (const [label, url] of [
    ["LDAP", "ldap://127.0.0.1:5357"],
    ["LDAPS", "ldaps://127.0.0.1:5359"],
  ]) {
    if (only && only !== label) continue;
    if (label === "LDAPS") {
      try {
        const ber = (tag: number, data: Buffer) =>
          Buffer.concat([
            Buffer.from([
              tag,
              ...(data.length < 128 ? [data.length] : [0x81, data.length]),
            ]),
            data,
          ]);
        const oct = (s: string) => ber(4, Buffer.from(s));
        const integer = (n: number) => ber(2, Buffer.from([n]));
        const msg = (id: number, op: Buffer) =>
          ber(0x30, Buffer.concat([integer(id), op]));
        await new Promise<void>((resolve, reject) => {
          const socket = tls.connect({
            host: "127.0.0.1",
            port: 5359,
            servername: "localhost",
            ca: requireCa,
            rejectUnauthorized: true,
          });
          const timer = setTimeout(() => {
            socket.destroy();
            reject(Error("LDAPS绑定／搜索超时"));
          }, 8000);
          let buffer = Buffer.alloc(0),
            found = false;
          const fail = (e: any) => {
            clearTimeout(timer);
            socket.destroy();
            reject(e);
          };
          socket.on("error", fail);
          socket.on("secureConnect", () => {
            if (!socket.authorized) return fail(Error("TLS证书未验证"));
            socket.write(
              msg(
                1,
                ber(
                  0x60,
                  Buffer.concat([
                    integer(3),
                    oct(`cn=${username},ou=consumers,dc=example,dc=com`),
                    ber(0x80, Buffer.from(password)),
                  ]),
                ),
              ),
            );
          });
          socket.on("data", (chunk) => {
            buffer = Buffer.concat([buffer, chunk]);
            while (buffer.length >= 2) {
              const lb = buffer[1],
                count = lb & 127;
              if (lb >= 128 && buffer.length < 2 + count) return;
              const len = lb < 128 ? lb : buffer.readUIntBE(2, count),
                header = lb < 128 ? 2 : 2 + count;
              if (buffer.length < header + len) return;
              const frame = buffer.subarray(header, header + len);
              buffer = buffer.subarray(header + len);
              const opOffset = 2 + frame[1],
                tag = frame[opOffset];
              const opLengthByte = frame[opOffset + 1];
              const opHeader =
                opLengthByte < 128 ? 2 : 2 + (opLengthByte & 127);
              const content = frame.subarray(opOffset + opHeader);
              if (tag === 0x61) {
                if (content[2] !== 0) return fail(Error("LDAPS绑定被拒绝"));
                const filter = ber(
                  0xa3,
                  Buffer.concat([oct("cn"), oct(username)]),
                );
                socket.write(
                  msg(
                    2,
                    ber(
                      0x63,
                      Buffer.concat([
                        oct("ou=consumers,dc=example,dc=com"),
                        ber(10, Buffer.from([2])),
                        ber(10, Buffer.from([0])),
                        integer(10),
                        integer(5),
                        ber(1, Buffer.from([0])),
                        filter,
                        ber(
                          0x30,
                          Buffer.concat([oct("cn"), oct("displayName")]),
                        ),
                      ]),
                    ),
                  ),
                );
              }
              if (
                tag === 0x64 &&
                frame.includes(Buffer.from("本机协议监听验收"))
              )
                found = true;
              if (tag === 0x65) {
                clearTimeout(timer);
                socket.end();
                if (content[2] === 0 && found) resolve();
                else reject(Error("LDAPS搜索未返回测试用户"));
              }
            }
          });
        });
        results.push({
          id: label,
          status: "已集成并验证",
          detail: "Node TLS客户端验证专用CA与主机名，真实LDAPS绑定、搜索通过",
        });
      } catch (e: any) {
        results.push({ id: label, status: "验证失败", detail: e.message });
      }
      continue;
    }
    const args = [
      "-x",
      "-H",
      url,
      "-D",
      `cn=${username},ou=consumers,dc=example,dc=com`,
      "-y",
      root + "/ldap-password",
      "-b",
      "ou=consumers,dc=example,dc=com",
      `(cn=${username})`,
      "cn",
      "displayName",
    ];
    const result = spawnSync("ldapsearch", args, {
      encoding: "utf8",
      env: {
        ...process.env,
        LDAPTLS_CACERT: root + "/tls.pem",
        LDAPTLS_REQCERT: "demand",
      },
      timeout: 10000,
    });
    const pass =
      (result.status === 0 && result.stdout.includes("本机协议监听验收")) ||
      (result.status === 0 && result.stdout.includes("displayName::"));
    results.push({
      id: label,
      status: pass ? "已集成并验证" : "验证失败",
      detail: pass
        ? "独立容器、独立身份库：真实绑定与搜索通过"
        : String(result.stderr || result.stdout).slice(0, 200),
    });
  }
  if (!only || only === "RADIUS") {
    const client = dgram.createSocket("udp4");
    async function radius(pw: string) {
      const auth = randomBytes(16),
        id = 5,
        padded = Buffer.alloc(Math.ceil(Math.max(1, pw.length) / 16) * 16);
      padded.write(pw);
      const encrypted = Buffer.alloc(padded.length);
      for (let i = 0; i < padded.length; i += 16) {
        const digest = createHash("md5")
          .update(
            Buffer.concat([
              Buffer.from(radiusSecret),
              i === 0 ? auth : encrypted.subarray(i - 16, i),
            ]),
          )
          .digest();
        for (let j = 0; j < 16; j++)
          encrypted[i + j] = padded[i + j] ^ digest[j];
      }
      const name = Buffer.from(username),
        attrs = Buffer.concat([
          Buffer.from([1, name.length + 2]),
          name,
          Buffer.from([2, encrypted.length + 2]),
          encrypted,
        ]);
      const packet = Buffer.alloc(20 + attrs.length);
      packet[0] = 1;
      packet[1] = id;
      packet.writeUInt16BE(packet.length, 2);
      auth.copy(packet, 4);
      attrs.copy(packet, 20);
      const response: Buffer = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          client.removeAllListeners("message");
          reject(Error("RADIUS响应超时"));
        }, 5000);
        client.once("message", (b) => {
          clearTimeout(timer);
          resolve(b);
        });
        client.send(packet, 5358, "127.0.0.1");
      });
      const expected = createHash("md5")
        .update(
          Buffer.concat([
            response.subarray(0, 4),
            auth,
            response.subarray(20),
            Buffer.from(radiusSecret),
          ]),
        )
        .digest();
      assert(response.subarray(4, 20).equals(expected), "RADIUS响应签名不正确");
      return response[0];
    }
    try {
      assert.equal(await radius(password), 2);
      assert.equal(await radius("incorrect-password"), 3);
      results.push({
        id: "RADIUS",
        status: "已集成并验证",
        detail:
          "隔离UDP监听：接受正确密码、拒绝错误密码，响应Authenticator验证通过",
      });
    } catch (e: any) {
      results.push({ id: "RADIUS", status: "验证失败", detail: e.message });
    } finally {
      client.close();
    }
  }
} finally {
  try {
    await writeFile(
      root + "/runtime.log",
      execFileSync("docker", ["logs", container], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      }),
      { mode: 0o600 },
    );
  } catch {}
  spawnSync("docker", ["stop", container], { stdio: "ignore" });
  spawnSync("docker", ["rm", container], { stdio: "ignore" });
}
const previous = only
  ? JSON.parse(await readFile(".local/listener-verification.json", "utf8"))
  : { results: [] };
const combined = [
  ...previous.results.filter((r: any) => !results.some((x) => x.id === r.id)),
  ...results,
];
await writeFile(
  ".local/listener-verification.json",
  JSON.stringify(
    { date: new Date().toISOString(), results: combined },
    null,
    2,
  ),
  { mode: 0o600 },
);
for (const r of results) {
  console.log(r.status, r.id, r.detail);
  await pool.query(
    "INSERT INTO capability_checks(id,status,detail) VALUES($1,$2,$3) ON CONFLICT(id) DO UPDATE SET status=EXCLUDED.status,detail=EXCLUDED.detail,checked_at=now()",
    [r.id, r.status, r.detail],
  );
}
await pool.end();

if (results.some((r) => r.status === "验证失败")) process.exitCode = 1;
