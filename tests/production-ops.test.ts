import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { identityCookie } from "../src/server/proxy";
// @ts-ignore operational ES module
import { createBackup } from "../scripts/backup-core.mjs";
// @ts-ignore operational ES module
import { withOperationLock, run } from "../scripts/ops-runtime.mjs";
async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), "zy-backup-"));
  for (const p of ["uploads", "private", "work", "backups"])
    await mkdir(join(dir, p));
  await writeFile(join(dir, "uploads/file.txt"), "uploaded-content");
  await writeFile(join(dir, "private/env"), "PRIVATE");
  return {
    dir,
    c: {
      mode: "production",
      timezone: "Asia/Shanghai",
      workDir: join(dir, "work"),
      backupDir: join(dir, "backups"),
      statusFile: join(dir, "last.json"),
      uploadDir: join(dir, "uploads"),
      databases: [
        { key: "casdoor", name: "casdoor" },
        { key: "entitlements", name: "entitlements" },
      ],
      compose: [],
      privateFiles: { env: join(dir, "private/env") },
      requiredPrivate: ["env"],
    },
  };
}
test("生产身份Cookie为Secure／HttpOnly／host-only，管理会话保持路径隔离", () => {
  const raw = "casdoor_session_id=abc; Path=/; Domain=.example.com";
  assert.equal(
    identityCookie(raw, false, true),
    "casdoor_session_id=abc; Path=/; HttpOnly; Secure; SameSite=Lax",
  );
  assert.match(
    identityCookie(raw, true, true),
    /^zy_identity_admin=abc; Path=\/admin;/,
  );
  assert(!identityCookie(raw, true, true).includes("Domain="));
});
test("备份故障仍恢复之前运行服务，不发布成功归档", async () => {
  const { c } = await fixture();
  let restored = false;
  const before = { center: "active", casdoor: "active", demo: "inactive" };
  const manager = {
    snapshot: async () => before,
    stop: async () => {},
    assertStopped: async () => {},
    restore: async (s: any) => {
      assert.deepEqual(s, before);
      restored = true;
    },
  };
  await assert.rejects(
    createBackup(c, manager, {
      exec: async () => {
        throw Error("simulated dump failure");
      },
    }),
    /dump failure/,
  );
  assert(restored);
  assert.equal(
    JSON.parse(await readFile(c.statusFile, "utf8")).consistent,
    false,
  );
  assert.equal((await readdir(c.backupDir)).length, 0);
});
test("不能确认停写时拒绝备份，恢复失败也不发布成功结果", async () => {
  for (const fail of ["quiescence", "restore"]) {
    const { c } = await fixture();
    let restored = false;
    const manager = {
      snapshot: async () => ({ center: "active" }),
      stop: async () => {},
      assertStopped: async () => {
        if (fail === "quiescence") throw Error("writer still active");
      },
      restore: async () => {
        restored = true;
        if (fail === "restore") throw Error("restart failed");
      },
    };
    const exec = async (cmd: string, args: string[], opts: any) => {
      if (cmd === "docker") {
        await writeFile(opts.output, "dump");
        return "";
      }
      return run(cmd, args, opts);
    };
    await assert.rejects(createBackup(c, manager, { exec }));
    assert(restored);
    assert(
      !(await readdir(c.backupDir)).some((p: string) => p.endsWith(".tar.gz")),
    );
  }
});
test("成功备份包含上传实际内容，日轮转只清理成功日备份并保留人工备份", async () => {
  const { c } = await fixture();
  for (let i = 0; i < 8; i++)
    await writeFile(join(c.backupDir, "daily-2000-" + i + ".tar.gz"), "old");
  await writeFile(join(c.backupDir, "manual-2000.tar.gz"), "keep");
  let stopped = false;
  const manager = {
    snapshot: async () => ({ center: "active" }),
    stop: async () => {
      stopped = true;
    },
    assertStopped: async () => assert(stopped),
    restore: async () => {
      stopped = false;
    },
  };
  const exec = async (cmd: string, args: string[], opts: any) => {
    if (cmd === "docker") {
      assert(stopped);
      await writeFile(opts.output, "dump");
      return "";
    }
    return run(cmd, args, opts);
  };
  const archive = await createBackup(c, manager, { daily: true, exec });
  assert(!stopped);
  const content = await run("tar", ["-xOf", archive, "./uploads/file.txt"]);
  assert.equal(content, "uploaded-content");
  const entries = await readdir(c.backupDir);
  assert.equal(
    entries.filter(
      (p: string) => p.startsWith("daily-") && p.endsWith(".tar.gz"),
    ).length,
    7,
  );
  assert(entries.includes("manual-2000.tar.gz"));
});
test("同一操作锁排斥并发部署、备份或恢复", async () => {
  const { dir } = await fixture();
  const path = join(dir, "lock");
  await withOperationLock(path, async () => {
    await assert.rejects(
      withOperationLock(path, async () => {}),
      /操作锁/,
    );
  });
  await withOperationLock(path, async () => {});
});
