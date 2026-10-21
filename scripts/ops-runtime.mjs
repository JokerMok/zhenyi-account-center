import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import { join } from "node:path";
export async function run(
  cmd,
  args = [],
  { cwd = process.cwd(), env = process.env, input, output, signal } = {},
) {
  const fs = await import("node:fs");
  const fd = output ? fs.openSync(output, "w", 0o600) : null;
  try {
    return await new Promise((resolve, reject) => {
      const p = spawn(cmd, args, {
        cwd,
        env,
        signal,
        stdio: ["pipe", fd ?? "pipe", "pipe"],
      });
      let out = "",
        err = "";
      p.stdout?.on("data", (x) => (out += x));
      p.stderr.on("data", (x) => (err = (err + x).slice(-8192)));
      p.on("error", reject);
      p.on("close", (code) =>
        code === 0
          ? resolve(out.trim())
          : reject(new Error(cmd + " failed (" + code + "): " + err.trim())),
      );
      p.stdin.end(input);
    });
  } finally {
    if (fd !== null) fs.closeSync(fd);
  }
}
export async function withOperationLock(dir, fn) {
  await mkdir(join(dir, ".."), { recursive: true, mode: 0o700 });
  const inherited = process.env.ACCOUNTS_OPERATION_TOKEN;
  if (inherited) {
    const owner = await readFile(join(dir, "owner.json"), "utf8")
      .then(JSON.parse)
      .catch(() => null);
    if (owner?.token === inherited && owner.pid === process.ppid) return fn();
  }
  const token = randomUUID();
  try {
    await mkdir(dir, { mode: 0o700 });
  } catch (e) {
    if (e.code === "EEXIST")
      throw Error(
        "已有备份、部署或恢复持有操作锁：" +
          dir +
          "；请核对owner与进程，不要强制删除。",
      );
    throw e;
  }
  await writeFile(
    join(dir, "owner.json"),
    JSON.stringify({
      token,
      pid: process.pid,
      host: hostname(),
      started_at: new Date().toISOString(),
    }),
    { mode: 0o600 },
  );
  const priorToken = process.env.ACCOUNTS_OPERATION_TOKEN;
  process.env.ACCOUNTS_OPERATION_TOKEN = token;
  try {
    return await fn();
  } finally {
    if (priorToken) process.env.ACCOUNTS_OPERATION_TOKEN = priorToken;
    else delete process.env.ACCOUNTS_OPERATION_TOKEN;
    const owner = JSON.parse(await readFile(join(dir, "owner.json"), "utf8"));
    if (owner.token === token) await rm(dir, { recursive: true });
  }
}
