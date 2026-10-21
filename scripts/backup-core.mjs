import {
  mkdir,
  readFile,
  writeFile,
  readdir,
  lstat,
  copyFile,
  rename,
  rm,
  chmod,
  statfs,
} from "node:fs/promises";
import { createReadStream } from "node:fs";
import { createHash, randomBytes } from "node:crypto";
import { resolve, join, relative, dirname } from "node:path";
import { run } from "./ops-runtime.mjs";
export async function sha(file) {
  const h = createHash("sha256");
  for await (const chunk of createReadStream(file)) h.update(chunk);
  return h.digest("hex");
}
export async function files(dir, prefix = "") {
  const all = [];
  for (const e of await readdir(join(dir, prefix), { withFileTypes: true })) {
    const p = join(prefix, e.name);
    if (e.isSymbolicLink()) throw Error("备份不接受上传目录中的符号链接：" + p);
    if (e.isDirectory()) all.push(...(await files(dir, p)));
    else if (e.isFile()) all.push(p);
    else throw Error("备份不接受特殊文件：" + p);
  }
  return all;
}
async function copyTree(source, target) {
  await mkdir(target, { recursive: true, mode: 0o700 });
  for (const p of await files(source)) {
    await mkdir(dirname(join(target, p)), { recursive: true, mode: 0o700 });
    await copyFile(join(source, p), join(target, p));
    await chmod(join(target, p), 0o600);
  }
}
async function json(path, data) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeFile(path, JSON.stringify(data, null, 2) + "\n", { mode: 0o600 });
}
export async function createBackup(
  c,
  manager,
  { daily = false, exec = run, signal } = {},
) {
  const stamp =
    new Date().toISOString().replace(/[:.]/g, "-") +
    "-" +
    randomBytes(3).toString("hex");
  const kind = daily ? "daily" : "manual",
    stage = join(c.workDir, "backup-" + stamp),
    archive = join(c.backupDir, kind + "-" + stamp + ".tar.gz");
  await mkdir(stage, { recursive: true, mode: 0o700 });
  await mkdir(c.backupDir, { recursive: true, mode: 0o700 });
  const space = await statfs(c.backupDir);
  if (Number(space.bavail) * Number(space.bsize) < 2 * 1024 ** 3)
    throw Error("备份目录空闲不足2GiB");
  const state = await manager.snapshot();
  await json(join(stage, "services-before.json"), state);
  let failure = null,
    completed = false;
  await json(c.statusFile, {
    status: "running",
    phase: "stopping-writers",
    at: new Date().toISOString(),
    mode: c.mode,
    kind,
    consistent: false,
  });
  try {
    await manager.stop(state);
    await manager.assertStopped(state);
    if (signal?.aborted) throw Error("备份已中断");
    for (const db of c.databases)
      await exec(
        "docker",
        [
          ...c.compose,
          "exec",
          "-T",
          "postgres",
          "pg_dump",
          "-U",
          "postgres",
          "-Fc",
          "--no-owner",
          db.name,
        ],
        { output: join(stage, db.key + ".dump"), signal },
      );
    await mkdir(join(stage, "private"), { mode: 0o700 });
    for (const [key, path] of Object.entries(c.privateFiles)) {
      if (!/^[a-zA-Z0-9_.-]+$/.test(key)) throw Error("私密配置备份键无效");
      const info = await lstat(path).catch((e) => {
        if (e.code === "ENOENT") return null;
        throw e;
      });
      if (!info) {
        if (c.requiredPrivate?.includes(key))
          throw Error("必要私密配置缺失：" + key);
        continue;
      }
      await copyFile(path, join(stage, "private", key));
      await chmod(join(stage, "private", key), 0o600);
    }
    await copyTree(c.uploadDir, join(stage, "uploads"));
    if (c.sessionDir) await copyTree(c.sessionDir, join(stage, "sessions"));
    // Prove quiescence still holds after both dumps and the file snapshot.
    await manager.assertStopped(state);
    if (signal?.aborted) throw Error("备份已中断");
    const hashes = {};
    for (const p of await files(stage)) hashes[p] = await sha(join(stage, p));
    await json(join(stage, "manifest.json"), {
      version: 2,
      mode: c.mode,
      kind,
      created_at: new Date().toISOString(),
      timezone: c.timezone,
      consistent: true,
      consistency:
        "All project writers stopped and verified before and after database/file snapshot",
      databases: c.databases,
      sha256: hashes,
    });
    await exec("tar", ["-czf", archive + ".partial", "-C", stage, "."], {
      signal,
    });
    await exec("tar", ["-tzf", archive + ".partial"], { signal });
    completed = true;
  } catch (e) {
    failure = e;
  } finally {
    try {
      await manager.restore(state);
    } catch (e) {
      failure = new AggregateError(
        [...(failure ? [failure] : []), e],
        "备份服务状态恢复失败；请查services-before记录并恢复原服务",
      );
    }
  }
  if (failure || !completed) {
    await json(c.statusFile, {
      status: "failed",
      at: new Date().toISOString(),
      error: String(failure?.message || "未完成"),
      stage,
      consistent: false,
    });
    throw failure || Error("备份未完成");
  }
  await rename(archive + ".partial", archive);
  await chmod(archive, 0o600);
  await writeFile(
    archive + ".sha256",
    (await sha(archive)) + "  " + archive.split("/").at(-1) + "\n",
    { mode: 0o600 },
  );
  await json(c.statusFile, {
    status: "success",
    at: new Date().toISOString(),
    archive,
    kind,
    consistent: true,
    timezone: c.timezone,
    services_restored: true,
  });
  await rm(stage, { recursive: true });
  if (daily) {
    const old = (await readdir(c.backupDir))
      .filter((x) => /^daily-.*\.tar\.gz$/.test(x))
      .sort()
      .reverse()
      .slice(7);
    for (const p of old) {
      await rm(join(c.backupDir, p));
      await rm(join(c.backupDir, p + ".sha256"), { force: true });
    }
  }
  return archive;
}
export async function restoreIsolated(c, archive, { exec = run, signal } = {}) {
  archive = resolve(archive);
  const check = (await readFile(archive + ".sha256", "utf8")).split(/\s+/)[0];
  if (check !== (await sha(archive))) throw Error("归档SHA-256不匹配");
  const entries = (await exec("tar", ["-tzf", archive], { signal })).split(
    "\n",
  );
  if (
    entries.some(
      (p) =>
        p.startsWith("/") || p.split("/").includes("..") || p.includes("\\"),
    )
  )
    throw Error("归档路径不安全");
  const types = (await exec("tar", ["-tvzf", archive], { signal })).split("\n");
  if (types.some((x) => x && !["-", "d"].includes(x[0])))
    throw Error("归档包含链接或特殊文件");
  const stamp = Date.now().toString(36) + "_" + randomBytes(3).toString("hex"),
    dir = join(c.restoreDir, "restore-" + stamp);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await exec("tar", ["-xzf", archive, "-C", dir], { signal });
  const manifest = JSON.parse(
    await readFile(join(dir, "manifest.json"), "utf8"),
  );
  if (manifest.version !== 2 || manifest.consistent !== true)
    throw Error("不是已验证一致性的v2备份");
  const actual = (await files(dir)).filter((p) => p !== "manifest.json").sort();
  if (
    JSON.stringify(actual) !==
    JSON.stringify(Object.keys(manifest.sha256).sort())
  )
    throw Error("备份内容与清单不一致");
  for (const [p, h] of Object.entries(manifest.sha256)) {
    if (
      resolve(dir, p) !== join(dir, p) ||
      !resolve(dir, p).startsWith(dir + "/")
    )
      throw Error("清单路径不安全");
    if ((await sha(join(dir, p))) !== h) throw Error("内容校验失败：" + p);
  }
  const databases = {};
  for (const db of c.databases) {
    const name = "restore_" + stamp + "_" + db.key;
    if (!/^[a-z0-9_]+$/.test(name) || !/^[a-z0-9_]+$/.test(db.role))
      throw Error("恢复目标名称无效");
    await exec(
      "docker",
      [
        ...c.compose,
        "exec",
        "-T",
        "postgres",
        "createdb",
        "-U",
        "postgres",
        "-O",
        db.role,
        name,
      ],
      { signal },
    );
    await exec(
      "docker",
      [
        ...c.compose,
        "exec",
        "-T",
        "postgres",
        "psql",
        "-U",
        "postgres",
        "-d",
        "postgres",
        "-v",
        "ON_ERROR_STOP=1",
        "-c",
        `REVOKE CONNECT ON DATABASE ${name} FROM PUBLIC; GRANT CONNECT ON DATABASE ${name} TO ${db.role};`,
      ],
      { signal },
    );
    // pg_restore streams the verified dump to avoid loading database archives in memory.
    await exec(
      "docker",
      [
        ...c.compose,
        "cp",
        join(dir, db.key + ".dump"),
        "postgres:/tmp/" + name + ".dump",
      ],
      { signal },
    );
    try {
      await exec(
        "docker",
        [
          ...c.compose,
          "exec",
          "-T",
          "postgres",
          "pg_restore",
          "-U",
          "postgres",
          "--exit-on-error",
          "--no-owner",
          "--role",
          db.role,
          "-d",
          name,
          "/tmp/" + name + ".dump",
        ],
        { signal },
      );
    } finally {
      await exec("docker", [
        ...c.compose,
        "exec",
        "-T",
        "postgres",
        "rm",
        "/tmp/" + name + ".dump",
      ]);
    }
    databases[db.key] = name;
  }
  const result = {
    status: "isolated-restored",
    databases,
    directory: dir,
    uploads: join(dir, "uploads"),
    sessions:
      manifest.sha256 &&
      Object.keys(manifest.sha256).some((p) => p.startsWith("sessions/"))
        ? join(dir, "sessions")
        : null,
    checksums_verified: true,
    production_switched: false,
  };
  await json(join(dir, "restored.json"), result);
  return result;
}
