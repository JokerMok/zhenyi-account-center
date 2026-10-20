import { execFileSync, spawnSync } from "node:child_process";
import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  existsSync,
  chmodSync,
  readdirSync,
} from "node:fs";
import { resolve, join } from "node:path";
import { createHash } from "node:crypto";
import dotenv from "dotenv";
process.chdir(resolve(import.meta.dirname, ".."));
const env = { ...process.env, ...dotenv.parse(readFileSync(".env")) };
const dc = ["compose", "--env-file", ".env", "-f", "infra/compose.yml"];
const run = (cmd, args, options = {}) =>
  execFileSync(cmd, args, { env, stdio: "inherit", ...options });
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
if (process.argv[2] === "restore") {
  const archive = process.argv[3];
  if (!archive)
    throw new Error(
      "用法：npm run restore -- backups/文件.tar.gz；仅恢复到新的独立数据库，不覆盖当前数据库。",
    );
  const source = resolve(archive);
  const dir = resolve(".local", "restore-" + stamp);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const entries = execFileSync("tar", ["-tzf", source], { encoding: "utf8" })
    .trim()
    .split("\n");
  if (entries.some((x) => x.startsWith("/") || x.split("/").includes("..")))
    throw new Error("不安全的备份路径");
  run("tar", ["-xzf", source, "-C", dir]);
  const manifest = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8"));
  for (const [file, expected] of Object.entries(manifest.sha256)) {
    const p = resolve(dir, file);
    if (!p.startsWith(dir + "/")) throw new Error("备份清单路径无效");
    if (createHash("sha256").update(readFileSync(p)).digest("hex") !== expected)
      throw new Error("备份校验失败：" + file);
  }
  const suffix = Date.now().toString(36);
  const restored = {};
  for (const [db, role] of [
    ["casdoor", "casdoor"],
    ["entitlements", "entitlements"],
  ]) {
    const target = `restore_${suffix}_${db}`;
    run("docker", [
      ...dc,
      "exec",
      "-T",
      "postgres",
      "createdb",
      "-U",
      "postgres",
      "-O",
      role,
      target,
    ]);
    const r = spawnSync(
      "docker",
      [
        ...dc,
        "exec",
        "-T",
        "postgres",
        "pg_restore",
        "-U",
        "postgres",
        "--exit-on-error",
        "--no-owner",
        "--role",
        role,
        "-d",
        target,
      ],
      {
        env,
        input: readFileSync(join(dir, db + ".dump")),
        maxBuffer: 8 * 1024 * 1024,
      },
    );
    if (r.status !== 0) throw new Error("恢复失败：" + r.stderr.toString());
    restored[db] = target;
  }
  writeFileSync(
    join(dir, "restored-databases.json"),
    JSON.stringify(restored, null, 2),
    { mode: 0o600 },
  );
  console.log("已恢复到新的隔离数据库，未覆盖运行数据：", restored);
  console.log("私密配置保存在 " + dir + "，切换步骤见 docs/operations.md");
} else {
  mkdirSync("backups", { recursive: true, mode: 0o700 });
  chmodSync("backups", 0o700);
  const dir = resolve(".local", "backup-" + stamp);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  // Stop identity and business writers for a coherent two-database backup. Never stop other projects.
  run(process.execPath, ["scripts/control.mjs", "stop"]);
  try {
    run("docker", [...dc, "up", "-d", "--wait", "postgres"]);
    for (const db of ["casdoor", "entitlements"]) {
      const bytes = execFileSync(
        "docker",
        [
          ...dc,
          "exec",
          "-T",
          "postgres",
          "pg_dump",
          "-U",
          "postgres",
          "-Fc",
          "--no-owner",
          db,
        ],
        { env, maxBuffer: 256 * 1024 * 1024 },
      );
      writeFileSync(join(dir, db + ".dump"), bytes, { mode: 0o600 });
    }
    const privateFiles = [
      ".env",
      ".local/credentials.json",
      ".local/admin-subject.confirmed",
      ".local/casdoor/conf/app.conf",
      ".local/casdoor/cert.pem",
      ".local/casdoor/key.pem",
    ];
    const hashes = {};
    for (const file of privateFiles) {
      if (!existsSync(file)) continue;
      const target = join(dir, file);
      mkdirSync(resolve(target, ".."), { recursive: true, mode: 0o700 });
      const bytes = readFileSync(file);
      writeFileSync(target, bytes, { mode: 0o600 });
      hashes[file] = createHash("sha256").update(bytes).digest("hex");
    }
    for (const db of ["casdoor", "entitlements"])
      hashes[db + ".dump"] = createHash("sha256")
        .update(readFileSync(join(dir, db + ".dump")))
        .digest("hex");
    writeFileSync(
      join(dir, "manifest.json"),
      JSON.stringify(
        {
          version: 1,
          casdoor: "v4.22.0",
          created_at: new Date().toISOString(),
          consistent: true,
          sha256: hashes,
        },
        null,
        2,
      ),
      { mode: 0o600 },
    );
    const archive = resolve("backups", "accounts-" + stamp + ".tar.gz");
    run("tar", ["-czf", archive, "-C", dir, "."]);
    chmodSync(archive, 0o600);
    console.log("备份完成：" + archive);
  } finally {
    run(process.execPath, ["scripts/control.mjs", "start"]);
  }
}
