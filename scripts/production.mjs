import {
  readFile,
  writeFile,
  mkdir,
  access,
  symlink,
  rename,
  cp,
  chmod,
  readlink,
  rm,
  lstat,
} from "node:fs/promises";
import { resolve, join, dirname, basename } from "node:path";
import { spawnSync } from "node:child_process";
import dotenv from "dotenv";
import { run, withOperationLock } from "./ops-runtime.mjs";
import { createBackup, restoreIsolated, sha } from "./backup-core.mjs";
import { systemdManager, loadBackupConfig } from "./backup.mjs";
import { initializeProduction } from "./production-init.mjs";
const root = "/srv/apps/zhenyi-accounts",
  shared = join(root, "shared"),
  command = process.argv[2] || "status";
const units = [
  "zhenyi-accounts-center.service",
  "zhenyi-accounts-identity.service",
  "zhenyi-accounts-casdoor.service",
];
const runtime = join(shared, "runtime/node-v22.23.3-linux-x64/bin/node");
const exists = (p) =>
  access(p).then(
    () => true,
    () => false,
  );
async function link(target, path) {
  await mkdir(dirname(path), { recursive: true });
  if (
    await lstat(path).then(
      () => true,
      () => false,
    )
  ) {
    if ((await readlink(path).catch(() => null)) === target) return;
    throw Error("保留已有路径，拒绝覆盖非预期链接：" + path);
  }
  await symlink(target, path);
}
async function pointer(target, name) {
  const temp = join(root, name + ".next-" + process.pid);
  await symlink(target, temp);
  await rename(temp, join(root, name));
}
async function health(port) {
  for (let i = 0; i < 60; i++) {
    try {
      if (
        (
          await fetch("http://127.0.0.1:" + port + "/api/health", {
            signal: AbortSignal.timeout(700),
          })
        ).ok
      )
        return;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  throw Error("服务健康检查失败：" + port);
}
async function settings() {
  await mkdir(join(shared, "config"), { recursive: true, mode: 0o750 });
  const c = {
    mode: "production",
    project: "zhenyi-accounts",
    root,
    timezone: "Asia/Shanghai",
    workDir: join(shared, "backup-work"),
    backupDir: "/srv/backups/zhenyi-accounts",
    restoreDir: join(shared, "restores"),
    statusFile: join(shared, "backup-last.json"),
    lockDir: join(shared, "operation.lock"),
    units,
    writerPorts: [5310, 5300, 5305],
    compose: [
      "compose",
      "-p",
      "zhenyi-accounts",
      "--env-file",
      join(shared, "config/app.env"),
      "-f",
      join(root, "deploy/compose.yaml"),
    ],
    databases: [
      { key: "casdoor", name: "casdoor", role: "casdoor" },
      { key: "entitlements", name: "entitlements", role: "entitlements" },
    ],
    uploadDir: join(shared, "uploads"),
    privateFiles: {
      env: join(shared, "config/app.env"),
      products: join(shared, "config/products.json"),
      ops: join(shared, "config/ops.json"),
      admin_subject: join(shared, "state/admin-subject.confirmed"),
      casdoor_conf: join(shared, "config/casdoor.conf"),
      certificate: join(shared, "config/cert.pem"),
      private_key: join(shared, "config/key.pem"),
    },
    requiredPrivate: [
      "env",
      "products",
      "ops",
      "admin_subject",
      "casdoor_conf",
      "certificate",
      "private_key",
    ],
  };
  if (await exists(join(shared, "config/ops.json"))) {
    const old = await loadBackupConfig("production");
    if (JSON.stringify(old.units) !== JSON.stringify(units))
      throw Error("已有服务配置不同，请先核查");
    return old;
  }
  await writeFile(join(shared, "config/ops.json"), JSON.stringify(c, null, 2), {
    mode: 0o640,
    flag: "wx",
  });
  return c;
}
async function finalize() {
  const envPath = join(shared, "config/app.env");
  let content = await readFile(envPath, "utf8");
  const e = dotenv.parse(content);
  const call = async (path, params = {}, body) => {
    const u = new URL("http://127.0.0.1:5305/api/" + path);
    for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
    const r = await fetch(u, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        Authorization:
          "Basic " +
          Buffer.from(
            e.CASDOOR_ADMIN_CLIENT_ID + ":" + e.CASDOOR_ADMIN_CLIENT_SECRET,
          ).toString("base64"),
        "Content-Type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const x = await r.json();
    if (!r.ok || x.status !== "ok")
      throw Error("初始化官方API失败：" + path + " " + x.msg);
    return x.data;
  };
  const admin = await call("get-user", { id: "built-in/admin" });
  if (!admin?.isAdmin || admin.isDeleted) throw Error("生产管理员身份无效");
  const confirmed = join(shared, "state/admin-subject.confirmed");
  if (await exists(confirmed)) {
    if (admin.id !== (await readFile(confirmed, "utf8")).trim())
      throw Error("生产管理员subject改变，拒绝合并身份");
  } else {
    content = content.replace(/^ADMIN_SUB=.*$/m, "ADMIN_SUB=" + admin.id);
    await writeFile(envPath, content, { mode: 0o640 });
    await writeFile(confirmed, admin.id, { mode: 0o640 });
  }
  const provider = await call("get-provider", {
    id: "admin/zhenyi-local-storage",
  });
  if (!provider)
    await call(
      "add-provider",
      {},
      {
        owner: "admin",
        name: "zhenyi-local-storage",
        displayName: "本地持久化上传",
        category: "Storage",
        type: "Local File System",
        domain: e.CASDOOR_URL,
        pathPrefix: "uploads",
        createdTime: new Date().toISOString(),
      },
    );
  const worker = await call("get-webhook", {
    id: "built-in/zhenyi-worker-bootstrap",
  });
  if (!worker)
    await call(
      "add-webhook",
      {},
      {
        owner: "built-in",
        organization: "built-in",
        name: "zhenyi-worker-bootstrap",
        url: "http://127.0.0.1/disabled",
        method: "POST",
        contentType: "application/json",
        events: [],
        singleOrgOnly: true,
        isEnabled: false,
        createdTime: new Date().toISOString(),
      },
    );
  const init = join(shared, "state/casdoor/init_data.json");
  if (await exists(init)) {
    const d = JSON.parse(await readFile(init, "utf8"));
    for (const u of d.users || []) {
      delete u.password;
      delete u.passwordSalt;
    }
    await writeFile(init, JSON.stringify(d), { mode: 0o640 });
    await rename(init, init + ".applied");
  }
  await writeFile(
    join(shared, "state/casdoor/initialized"),
    new Date().toISOString(),
    { mode: 0o640 },
  );
}
async function installUnits() {
  const base = `[Unit]\nAfter=network-online.target docker.service\nWants=network-online.target\n[Service]\nType=simple\nUser=zyaccounts\nGroup=zyaccounts\nRestart=on-failure\nRestartSec=3\nUMask=0027\nNoNewPrivileges=true\nPrivateTmp=true\nProtectSystem=strict\nProtectHome=true\nKillMode=control-group\nTimeoutStopSec=45\n`;
  for (const [id, extra] of Object.entries({
    casdoor: `WorkingDirectory=${shared}/state/casdoor\nExecStart=${root}/current/bin/casdoor\nReadWritePaths=${shared}/uploads ${shared}/logs/casdoor\nMemoryMax=512M\n`,
    identity: `WorkingDirectory=${root}/current\nEnvironmentFile=${shared}/config/app.env\nExecStart=${runtime} --import tsx scripts/identity-gateway.ts\nMemoryMax=256M\n`,
    center: `WorkingDirectory=${root}/current\nEnvironmentFile=${shared}/config/app.env\nExecStart=${runtime} --import tsx src/server/main.ts\nMemoryMax=512M\n`,
  })) {
    await writeFile(
      "/etc/systemd/system/zhenyi-accounts-" + id + ".service",
      base + extra + "[Install]\nWantedBy=multi-user.target\n",
      { mode: 0o644 },
    );
  }
  await writeFile(
    "/etc/systemd/system/zhenyi-accounts-backup.service",
    `[Unit]\nDescription=Zhenyi consistent daily backup\nAfter=docker.service\n[Service]\nType=oneshot\nUser=root\nWorkingDirectory=${root}/current\nEnvironment=ACCOUNTS_OPS_CONFIG=${shared}/config/ops.json\nExecStart=${runtime} scripts/backup.mjs --mode production --daily\nUMask=0077\nTimeoutStartSec=30min\n`,
    { mode: 0o644 },
  );
  await writeFile(
    "/etc/systemd/system/zhenyi-accounts-backup.timer",
    "[Unit]\nDescription=Zhenyi daily backup Asia/Shanghai 03:50\n[Timer]\nOnCalendar=*-*-* 03:50:00 Asia/Shanghai\nPersistent=true\nUnit=zhenyi-accounts-backup.service\n[Install]\nWantedBy=timers.target\n",
    { mode: 0o644 },
  );
  await run("systemctl", ["daemon-reload"]);
  await run("systemctl", ["enable", ...units, "zhenyi-accounts-backup.timer"]);
}
async function verifyRelease(release) {
  if (!resolve(release).startsWith(join(root, "releases") + "/"))
    throw Error("发布目录必须在本项目releases内");
  const m = JSON.parse(await readFile(join(release, "RELEASE.json"), "utf8"));
  if (!/^[a-f0-9]{40}$/.test(m.commit) || m.casdoor !== "v4.22.0")
    throw Error("发布来源无效");
  for (const [p, digest] of Object.entries(m.sha256)) {
    if (!resolve(release, p).startsWith(release + "/"))
      throw Error("发布路径无效");
    if ((await sha(join(release, p))) !== digest)
      throw Error("发布文件校验失败：" + p);
  }
  return m;
}
async function activate(release, c, fresh) {
  const manager = systemdManager(c),
    before = await manager.snapshot();
  const old = await readlink(join(root, "current")).catch(() => null);
  if (!fresh && old) await createBackup(c, manager);
  await manager.stop();
  await manager.assertStopped();
  try {
    await pointer(release, "current");
    await run(runtime, ["--import", "tsx", "scripts/migrate.ts"], {
      cwd: release,
      env: {
        ...process.env,
        ...dotenv.parse(await readFile(join(shared, "config/app.env"), "utf8")),
      },
    });
    await run("systemctl", ["start", "zhenyi-accounts-casdoor.service"]);
    await health(5305);
    await finalize();
    if (fresh) {
      await run("systemctl", ["restart", "zhenyi-accounts-casdoor.service"]);
      await health(5305);
    }
    await run("systemctl", ["start", "zhenyi-accounts-identity.service"]);
    await health(5300);
    await run("systemctl", ["start", "zhenyi-accounts-center.service"]);
    await health(5310);
    if (old && old !== release) await pointer(old, "previous");
  } catch (e) {
    await manager.stop();
    if (old) {
      await pointer(old, "current");
      await manager.restore(before);
    }
    throw e;
  }
}
if (process.getuid?.() !== 0) throw Error("生产运维命令需要sudo，仅管理本项目");
if (command === "status") {
  for (const u of units)
    console.log(
      u +
        ": " +
        (await run("systemctl", ["is-active", u]).catch(() => "inactive")),
    );
  console.log(
    "release: " +
      (await readlink(join(root, "current")).catch(() => "not-installed")),
  );
  process.exit(0);
}
if (command === "logs") {
  console.log(
    await run("journalctl", [
      "-u",
      "zhenyi-accounts-center",
      "-u",
      "zhenyi-accounts-identity",
      "-u",
      "zhenyi-accounts-casdoor",
      "-n",
      String(Number(process.argv[3]) || 60),
      "--no-pager",
    ]),
  );
  process.exit(0);
}
await mkdir(shared, { recursive: true, mode: 0o750 });
await withOperationLock(join(shared, "operation.lock"), async () => {
  if (command === "install" || command === "update") {
    const release = resolve(process.argv[3] || "");
    await verifyRelease(release);
    const had = await exists(join(shared, "config/app.env"));
    if (!had && (await exists(join(shared, "state/admin-subject.confirmed"))))
      throw Error("已有身份材料但缺少环境文件；拒绝重新初始化");
    if (!(await run("id", ["-u", "zyaccounts"]).catch(() => "")))
      await run("useradd", [
        "--system",
        "--home",
        root,
        "--shell",
        "/usr/sbin/nologin",
        "zyaccounts",
      ]);
    for (const p of [
      "config",
      "state",
      "state/casdoor",
      "state/casdoor/conf",
      "state/casdoor/web",
      "uploads",
      "logs/casdoor",
      "runtime",
      "backup-work",
      "restores",
    ])
      await mkdir(join(shared, p), { recursive: true, mode: 0o750 });
    await mkdir(join(root, "deploy"), { recursive: true, mode: 0o755 });
    await cp(
      join(release, "deploy/production/compose.yaml"),
      join(root, "deploy/compose.yaml"),
    );
    await cp(
      join(release, "deploy/production/init-databases.sh"),
      join(root, "deploy/init-databases.sh"),
    );
    await chmod(join(root, "deploy/init-databases.sh"), 0o755);
    await initializeProduction(root, release);
    const c = await settings();
    await link(join(shared, "state"), join(release, ".local"));
    await link(join(shared, "config/app.env"), join(release, ".env"));
    for (const [target, path] of [
      [join(shared, "config/casdoor.conf"), "conf/app.conf"],
      [join(shared, "uploads"), "files"],
      [join(shared, "logs/casdoor"), "logs"],
      [join(root, "current/native-web"), "web/build"],
      [join(root, "current/swagger"), "swagger"],
      [join(shared, "config/cert.pem"), "cert.pem"],
      [join(shared, "config/key.pem"), "key.pem"],
    ])
      await link(target, join(shared, "state/casdoor", path));
    await link(
      join(root, "current/native-static"),
      join(shared, "state/native-static"),
    );
    // Programs/configuration remain root-owned and read-only in each sandbox. Only logs/uploads are writable by Casdoor.
    await run("chown", ["root:zyaccounts", shared]);
    await run("chown", [
      "-R",
      "root:zyaccounts",
      join(shared, "config"),
      join(shared, "state"),
    ]);
    await run("chmod", [
      "-R",
      "g+rX",
      join(shared, "config"),
      join(shared, "state"),
    ]);
    await run("chown", [
      "-R",
      "zyaccounts:zyaccounts",
      join(shared, "uploads"),
      join(shared, "logs"),
    ]);
    await installUnits();
    await run("docker", [...c.compose, "up", "-d", "--wait", "postgres"]);
    await activate(release, c, !had);
    await run("systemctl", ["start", "zhenyi-accounts-backup.timer"]);
    await writeFile(
      join(root, "deploy/manage.sh"),
      `#!/bin/sh\nset -eu\ncd '${root}/current'\nexec '${runtime}' scripts/production.mjs "$@"\n`,
      { mode: 0o750 },
    );
    console.log(
      "生产三项服务已启动，数据独立；首次正式密码须通过隐藏交互设置，未发布演示服务。",
    );
  } else {
    const c = await loadBackupConfig("production"),
      manager = systemdManager(c);
    if (command === "backup")
      console.log(
        await createBackup(c, manager, {
          daily: process.argv.includes("--daily"),
        }),
      );
    else if (command === "restore")
      console.log(
        JSON.stringify(await restoreIsolated(c, process.argv[3]), null, 2),
      );
    else if (command === "restart") {
      const before = await manager.snapshot();
      await manager.stop();
      await manager.restore(before);
      await health(5310);
      console.log("本项目服务已按原运行状态重启");
    } else if (command === "admin:reset-password") {
      const result = spawnSync(
        runtime,
        ["--import", "tsx", "scripts/admin-reset-password.ts"],
        {
          cwd: join(root, "current"),
          stdio: "inherit",
          env: {
            ...process.env,
            ...dotenv.parse(
              await readFile(join(shared, "config/app.env"), "utf8"),
            ),
          },
        },
      );
      if (result.status !== 0) throw Error("官方管理员密码恢复未成功");
      await writeFile(
        join(shared, "config/admin-ready"),
        new Date().toISOString(),
        { mode: 0o640 },
      );
    } else if (command === "rollback") {
      const target = resolve(root, "releases", process.argv[3] || "");
      const m = await verifyRelease(target);
      const applied = await run("docker", [
        ...c.compose,
        "exec",
        "-T",
        "postgres",
        "psql",
        "-U",
        "postgres",
        "-d",
        "entitlements",
        "-Atc",
        "SELECT name FROM schema_migrations ORDER BY name",
      ]);
      if (applied.split("\n").some((n) => !m.compatibleMigrations.includes(n)))
        throw Error("目标版本未声明兼容当前数据库，拒绝自动回退");
      await activate(target, c, false);
      console.log("应用已回退，数据库和上传保留");
    } else
      throw Error(
        "支持 install/update/status/logs/restart/backup/restore/rollback/admin:reset-password",
      );
  }
});
