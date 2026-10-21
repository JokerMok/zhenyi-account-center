import { spawn, execFileSync } from "node:child_process";
import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  openSync,
  renameSync,
  unlinkSync,
} from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import dotenv from "dotenv";
const root = resolve(import.meta.dirname, "..");
process.chdir(root);
const command = process.argv[2] || "start";
const compose = ["compose", "--env-file", ".env", "-f", "infra/compose.yml"];
const run = (cmd, args, opts = {}) =>
  execFileSync(cmd, args, { cwd: root, stdio: "inherit", ...opts });
const local = resolve(".local");
mkdirSync(local, { recursive: true, mode: 0o700 });
function pidFile(name) {
  return resolve(".local", name + ".pid.json");
}
function alive(name) {
  if (!existsSync(pidFile(name))) return false;
  try {
    const { pid } = JSON.parse(readFileSync(pidFile(name)));
    process.kill(pid, 0);
    const comm = execFileSync("ps", ["-p", String(pid), "-o", "command="], {
      encoding: "utf8",
    });
    return name === "setup"
      ? comm.includes("scripts/admin-setup.ts")
      : name === "casdoor"
        ? comm.includes("./casdoor")
        : comm.includes("src/server/main.ts");
  } catch {
    return false;
  }
}
function launch(name, cmd, args, cwd, env = {}) {
  if (alive(name)) {
    console.log(name + " 已在运行");
    return;
  }
  const log = openSync(resolve(".local", name + ".log"), "a", 0o600);
  let childEnv = { ...process.env, ...env };
  if (["beadgrid", "focustake"].includes(name)) {
    for (const key of Object.keys(childEnv))
      if (
        key.startsWith("CASDOOR_") ||
        key.endsWith("_PASSWORD") ||
        key.endsWith("_SERVICE_KEY") ||
        ["DATABASE_URL", "ADMIN_SUB", "REDEMPTION_PEPPER"].includes(key)
      )
        delete childEnv[key];
    childEnv = {
      ...childEnv,
      ...dotenv.parse(readFileSync(".local/" + name + ".env")),
    };
  }
  const child = spawn(cmd, args, {
    cwd,
    env: childEnv,
    stdio: ["ignore", log, log],
    detached: true,
  });
  child.unref();
  writeFileSync(pidFile(name), JSON.stringify({ pid: child.pid, name, root }), {
    mode: 0o600,
  });
}
async function ready(url, name) {
  for (let i = 0; i < 45; i++) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(1000) });
      if (r.ok) return;
    } catch {}
    if (!alive(name))
      throw new Error(name + " 启动失败，查看 .local/" + name + ".log");
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(name + " 启动超时，查看本机日志");
}
async function downloadCasdoor() {
  const target = resolve(".local/casdoor/casdoor");
  if (existsSync(target)) return;
  if (process.platform !== "darwin" || process.arch !== "arm64")
    throw new Error(
      "本地自动安装当前锁定 Darwin ARM64；Linux 请使用 deploy/ 中的说明和锁定镜像。",
    );
  mkdirSync(".upstream", { recursive: true });
  const archive = resolve(".upstream/casdoor_Darwin_arm64.tar.gz");
  if (!existsSync(archive))
    run("curl", [
      "-fL",
      "--retry",
      "2",
      "--retry-all-errors",
      "--max-time",
      "180",
      "https://github.com/casdoor/casdoor/releases/download/v4.22.0/casdoor_Darwin_arm64.tar.gz",
      "-o",
      archive,
    ]);
  const digest = createHash("sha256")
    .update(readFileSync(archive))
    .digest("hex");
  if (
    digest !==
    "2f867132329ab1ef82026fbcaa9ecefd8c6d28e68f7d44396acbd78c4270623a"
  )
    throw new Error("Casdoor 校验失败，请检查下载包；未执行该文件");
  mkdirSync(".local/casdoor", { recursive: true });
  run("tar", ["-xzf", archive, "-C", ".local/casdoor", "--exclude", "conf"]);
}
if (command === "start") {
  run(process.execPath, ["--import", "tsx", "scripts/setup.ts"]);
  if (existsSync(".local/admin-setup.json")) {
    const setup = JSON.parse(readFileSync(".local/admin-setup.json"));
    if (setup.status === "pending") {
      if (
        existsSync(".local/casdoor/initialized") ||
        existsSync(".local/admin-subject.confirmed")
      )
        throw Error(
          "管理员已初始化，拒绝重新开放设置。请使用 admin:reset-password 恢复。",
        );
      const child = spawn(
        process.execPath,
        ["--import", "tsx", "scripts/admin-setup.ts"],
        { cwd: root, stdio: "inherit" },
      );
      child.unref();
      while (!existsSync(".local/admin-bootstrap.json")) {
        if (child.exitCode !== null)
          throw Error("本机设置服务已退出，请重新运行 npm start");
        await new Promise((r) => setTimeout(r, 500));
      }
      run(process.execPath, ["--import", "tsx", "scripts/setup.ts"]);
    }
  }
  Object.assign(process.env, dotenv.parse(readFileSync(".env")));
  await downloadCasdoor();
  const nativeStamp = existsSync(".local/native-build.json")
    ? JSON.parse(readFileSync(".local/native-build.json", "utf8"))
    : null;
  if (
    !nativeStamp ||
    nativeStamp.center !== process.env.CENTER_URL ||
    nativeStamp.extension_sha256 !==
      createHash("sha256")
        .update(readFileSync("scripts/build-native.mjs"))
        .digest("hex")
  )
    run(process.execPath, ["scripts/build-native.mjs"]);
  run("docker", [...compose, "up", "-d", "--wait", "postgres"]);
  run(process.execPath, ["scripts/roles.mjs"]);
  run(process.execPath, ["--import", "tsx", "scripts/migrate.ts"]);
  launch("casdoor", "./casdoor", [], resolve(".local/casdoor"));
  await ready(
    "http://127.0.0.1:" + (process.env.CASDOOR_PORT || 5300) + "/api/health",
    "casdoor",
  );
  if (!existsSync(".local/casdoor/initialized")) {
    // The initializer must never run again after successful first import: preserve admin edits across restarts.
    if (existsSync(".local/casdoor/init_data.json"))
      renameSync(
        ".local/casdoor/init_data.json",
        ".local/casdoor/init_data.applied.json",
      );
    writeFileSync(".local/casdoor/initialized", new Date().toISOString(), {
      mode: 0o600,
    });
  }
  run(process.execPath, ["--import", "tsx", "scripts/bootstrap.ts"]);
  if (existsSync(".local/restart-native-worker")) {
    if (alive("casdoor")) {
      const { pid } = JSON.parse(readFileSync(pidFile("casdoor")));
      process.kill(pid, "SIGTERM");
      for (let i = 0; i < 30 && alive("casdoor"); i++)
        await new Promise((r) => setTimeout(r, 100));
    }
    launch("casdoor", "./casdoor", [], resolve(".local/casdoor"));
    await ready(
      "http://127.0.0.1:" + (process.env.CASDOOR_PORT || 5300) + "/api/health",
      "casdoor",
    );
    unlinkSync(".local/restart-native-worker");
  }
  Object.assign(process.env, dotenv.parse(readFileSync(".env")));
  if (!existsSync("dist/web/index.html")) run("npm", ["run", "build"]);
  for (const name of ["center", "beadgrid", "focustake"]) {
    launch(
      name,
      process.execPath,
      ["--import", "tsx", "src/server/main.ts"],
      root,
      { APP_ID: name },
    );
    await ready(
      "http://127.0.0.1:" +
        {
          center: process.env.PORT || process.env.CENTER_PORT || 5310,
          beadgrid: 5311,
          focustake: 5312,
        }[name] +
        "/api/health",
      name,
    );
  }
  if (existsSync(".local/admin-setup.json")) {
    writeFileSync(
      ".local/admin-setup.json",
      JSON.stringify({ status: "complete" }),
      { mode: 0o600 },
    );
    if (existsSync(".local/admin-bootstrap.json"))
      unlinkSync(".local/admin-bootstrap.json");
    const applied = ".local/casdoor/init_data.applied.json";
    if (existsSync(applied)) {
      const d = JSON.parse(readFileSync(applied));
      for (const user of d.users || []) delete user.password;
      writeFileSync(applied, JSON.stringify(d), { mode: 0o600 });
    }
  }

  console.log(
    "本地服务可访问：\n" +
      process.env.CENTER_URL +
      "\n" +
      process.env.BEADGRID_URL +
      "\n" +
      process.env.FOCUSTAKE_URL +
      "\n" +
      process.env.CASDOOR_URL +
      "\n管理员：使用首次设置的账号密码登录 /admin；忘记密码运行 npm run admin:reset-password",
  );
} else if (command === "stop") {
  for (const name of ["beadgrid", "focustake", "center", "casdoor"]) {
    if (alive(name)) {
      const { pid } = JSON.parse(readFileSync(pidFile(name)));
      process.kill(pid, "SIGTERM");
    }
    if (existsSync(pidFile(name))) unlinkSync(pidFile(name));
  }
  run("docker", [...compose, "stop", "postgres"]);
  console.log("本项目服务已停止，数据保留。");
} else if (command === "status") {
  for (const name of ["casdoor", "center", "beadgrid", "focustake"])
    console.log(
      name + ": " + (alive(name) ? "运行中" : "未运行（或由外部手动启动）"),
    );
  run("docker", [...compose, "ps"]);
} else throw new Error("支持 start / stop / status");
