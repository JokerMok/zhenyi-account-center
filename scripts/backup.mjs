import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve, join } from "node:path";
import net from "node:net";
import dotenv from "dotenv";
import { run, withOperationLock } from "./ops-runtime.mjs";
import { createBackup, restoreIsolated } from "./backup-core.mjs";
process.chdir(resolve(import.meta.dirname, ".."));
const argv = process.argv.slice(2),
  restore = argv[0] === "restore";
if (restore) argv.shift();
const i = argv.indexOf("--mode");
const mode = i >= 0 ? argv.splice(i, 2)[1] : "local";
if (!["local", "production"].includes(mode))
  throw Error("--mode 必须是local或production");
const daily = argv.includes("--daily");
const ac = new AbortController();
for (const s of ["SIGINT", "SIGTERM"]) process.on(s, () => ac.abort());
export async function portOpen(port) {
  return await new Promise((r) => {
    const s = net.connect({ host: "127.0.0.1", port });
    s.setTimeout(500);
    s.once("connect", () => {
      s.destroy();
      r(true);
    });
    s.once("error", () => r(false));
    s.once("timeout", () => {
      s.destroy();
      r(false);
    });
  });
}
export function systemdManager(c) {
  const state = async (unit) => ({
    active: await run("systemctl", [
      "show",
      unit,
      "-p",
      "ActiveState",
      "--value",
    ]),
    pid: await run("systemctl", ["show", unit, "-p", "MainPID", "--value"]),
  });
  return {
    async snapshot() {
      const result = {};
      for (const unit of c.units) {
        if (!unit.startsWith("zhenyi-accounts-"))
          throw Error("拒绝操作非本项目systemd服务");
        result[unit] = await state(unit);
      }
      return result;
    },
    async stop() {
      for (const unit of c.units) await run("systemctl", ["stop", unit]);
    },
    async assertStopped() {
      for (const unit of c.units) {
        const s = await state(unit);
        if (!["inactive", "failed"].includes(s.active) || s.pid !== "0")
          throw Error("写入服务未停止：" + unit);
      }
      for (const port of c.writerPorts)
        if (await portOpen(port))
          throw Error("写入端口仍存在进程，拒绝一致备份：" + port);
    },
    async restore(before) {
      const errors = [];
      for (const unit of [...c.units].reverse()) {
        if (["active", "activating", "reloading"].includes(before[unit].active))
          try {
            await run("systemctl", ["start", unit]);
            const after = await state(unit);
            if (after.active !== "active") throw Error("服务尚未恢复：" + unit);
          } catch (e) {
            errors.push(e);
          }
      }
      if (errors.length)
        throw new AggregateError(
          errors,
          "未能恢复原运行服务：" + errors.map((x) => x.message).join("; "),
        );
    },
  };
}
export async function loadBackupConfig(selected = mode) {
  if (selected === "production") {
    const path =
      process.env.ACCOUNTS_OPS_CONFIG ||
      "/srv/apps/zhenyi-accounts/shared/config/ops.json";
    const c = JSON.parse(await readFile(path, "utf8"));
    if (
      c.mode !== "production" ||
      c.project !== "zhenyi-accounts" ||
      !c.root.startsWith("/srv/apps/")
    )
      throw Error("生产运维配置不符合本项目边界");
    return c;
  }
  const env = dotenv.parse(await readFile(".env"));
  if (env.NODE_ENV === "production")
    throw Error("生产环境必须显式使用 --mode production；不能使用本地PID控制");
  return {
    mode: "local",
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    root: process.cwd(),
    workDir: resolve(".local/backup-work"),
    backupDir: resolve("backups"),
    restoreDir: resolve(".local/restores"),
    statusFile: resolve(".local/backup-last.json"),
    lockDir: resolve(".local/operation.lock"),
    compose: [
      "compose",
      "--env-file",
      resolve(".env"),
      "-f",
      resolve("infra/compose.yml"),
    ],
    databases: [
      { key: "casdoor", name: "casdoor", role: "casdoor" },
      { key: "entitlements", name: "entitlements", role: "entitlements" },
    ],
    uploadDir: resolve(".local/casdoor/files"),
    privateFiles: {
      env: resolve(".env"),
      credentials: resolve(".local/credentials.json"),
      admin_subject: resolve(".local/admin-subject.confirmed"),
      casdoor_conf: resolve(".local/casdoor/conf/app.conf"),
      certificate: resolve(".local/casdoor/cert.pem"),
      private_key: resolve(".local/casdoor/key.pem"),
      products: resolve(env.PRODUCTS_CONFIG || "config/products.json"),
    },
    requiredPrivate: [
      "env",
      "admin_subject",
      "casdoor_conf",
      "certificate",
      "private_key",
      "products",
    ],
  };
}
async function localManager(c) {
  const stateFile = join(c.workDir, "local-services.json");
  await mkdir(c.workDir, { recursive: true, mode: 0o700 });
  return {
    snapshot: async () =>
      JSON.parse(
        await run(process.execPath, ["scripts/control.mjs", "writers-status"]),
      ),
    stop: async (state) => {
      await writeFile(stateFile, JSON.stringify(state), { mode: 0o600 });
      await run(process.execPath, [
        "scripts/control.mjs",
        "writers-stop",
        stateFile,
      ]);
    },
    assertStopped: async () => {
      const now = JSON.parse(
        await run(process.execPath, ["scripts/control.mjs", "writers-status"]),
      );
      if (Object.values(now.services).some(Boolean))
        throw Error("本机写入进程仍在运行");
    },
    restore: async () => {
      await run(process.execPath, [
        "scripts/control.mjs",
        "writers-resume",
        stateFile,
      ]);
    },
  };
}
if (process.argv[1]?.endsWith("/backup.mjs")) {
  let c;
  try {
    c = await loadBackupConfig();
    const result = await withOperationLock(c.lockDir, async () =>
      restore
        ? restoreIsolated(
            c,
            argv.find((x) => !x.startsWith("--")),
            { signal: ac.signal },
          )
        : createBackup(
            c,
            mode === "production" ? systemdManager(c) : await localManager(c),
            { daily, signal: ac.signal },
          ),
    );
    console.log(
      restore ? JSON.stringify(result, null, 2) : "一致备份完成：" + result,
    );
  } catch (e) {
    if (c)
      await writeFile(
        c.statusFile,
        JSON.stringify({
          status: "failed",
          at: new Date().toISOString(),
          error: e.message,
          consistent: false,
        }),
        { mode: 0o600 },
      ).catch(() => {});
    console.error("备份／恢复失败：" + e.message);
    process.exitCode = 1;
  }
}
