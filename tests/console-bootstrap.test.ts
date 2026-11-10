import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import express from "express";

test("全新管理登录可加载固定版本真实引导路径，管理数据仍需会话和写入来源校验", async () => {
  const seen: string[] = [];
  const upstream = http.createServer((req, res) => {
    seen.push(req.url!);
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ status: "ok", data: { name: "zhenyi-admin" } }));
  });
  await new Promise<void>((r) => upstream.listen(0, "127.0.0.1", r));
  process.env.CASDOOR_URL =
    "http://127.0.0.1:" + (upstream.address() as any).port;
  const { installConsole } = await import("../src/server/console");
  const { config } = await import("../src/server/config");
  const app = express();
  installConsole(app);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.once("listening", r));
  const base = "http://127.0.0.1:" + (server.address() as any).port;
  try {
    const r = await fetch(base + "/admin/api/get-app-login?clientId=example");
    assert.equal(r.status, 200);
    assert.equal((await r.json()).status, "ok");
    assert.equal(r.headers.get("cache-control"), "no-store");
    assert(seen.some((p) => p.startsWith("/api/get-app-login?")));
    for (const path of ["get-users", "get-providers", "get-sessions"])
      assert.equal((await fetch(base + "/admin/api/" + path)).status, 401);
    assert.equal(
      (
        await fetch(base + "/admin/api/set-password", {
          method: "POST",
          headers: { Origin: "https://untrusted.invalid" },
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await fetch(base + "/admin/api/verify-code", {
          method: "POST",
          headers: { Origin: new URL(config.CENTER_URL).origin },
        })
      ).status,
      200,
    );
  } finally {
    server.closeAllConnections();
    upstream.closeAllConnections();
    await Promise.all([
      new Promise<void>((r) => server.close(() => r())),
      new Promise<void>((r) => upstream.close(() => r())),
    ]);
  }
});
