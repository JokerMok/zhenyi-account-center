import { readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import dotenv from "dotenv";
let content = readFileSync(".env", "utf8");
const env = dotenv.parse(content);
for (const id of ["beadgrid", "focustake"]) {
  const key = id.toUpperCase() + "_DB_PASSWORD";
  if (!env[key]) {
    env[key] = randomBytes(32).toString("hex");
    content += "\n" + key + "=" + env[key] + "\n";
  }
}
writeFileSync(".env", content, { mode: 0o600 });
// Executed as local database bootstrap administrator, never used by business request handlers.
const sql = [];
for (const id of ["beadgrid", "focustake"]) {
  const role = id + "_backend",
    password = env[id.toUpperCase() + "_DB_PASSWORD"];
  if (!/^[0-9a-f]{64}$/.test(password))
    throw new Error("产品数据库密码必须为生成的随机 hex");
  sql.push(
    `SELECT 'CREATE ROLE ${role} LOGIN PASSWORD ''${password}''' WHERE NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='${role}')\n\\gexec\nGRANT CONNECT ON DATABASE entitlements TO ${role};`,
  );
}
const r = spawnSync(
  "docker",
  [
    "compose",
    "--env-file",
    ".env",
    "-f",
    "infra/compose.yml",
    "exec",
    "-T",
    "postgres",
    "psql",
    "-U",
    "postgres",
    "-v",
    "ON_ERROR_STOP=1",
    "-d",
    "postgres",
  ],
  { input: sql.join("\n"), encoding: "utf8" },
);
if (r.status !== 0) throw new Error("产品数据库角色初始化失败：" + r.stderr);
for (const id of ["beadgrid", "focustake"]) {
  const keys = [
    "NODE_ENV",
    "HOST",
    "CENTER_PORT",
    "PRODUCTS_CONFIG",
    "CASDOOR_URL",
    "CENTER_URL",
    "BEADGRID_URL",
    "FOCUSTAKE_URL",
    `CASDOOR_${id.toUpperCase()}_CLIENT_ID`,
    `CASDOOR_${id.toUpperCase()}_CLIENT_SECRET`,
    id.toUpperCase() + "_SERVICE_KEY",
  ];
  const data = Object.fromEntries(keys.map((k) => [k, env[k]]));
  data.PORT = String(id === "beadgrid" ? 5311 : 5312);
  data.DATABASE_URL = `postgresql://${id}_backend:${env[id.toUpperCase() + "_DB_PASSWORD"]}@127.0.0.1:5342/entitlements`;
  writeFileSync(
    ".local/" + id + ".env",
    Object.entries(data)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => `${k}=${v}`)
      .join("\n") + "\n",
    { mode: 0o600 },
  );
}
console.log("已准备独立产品角色与最小配置。");
