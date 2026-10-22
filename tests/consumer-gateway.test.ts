import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { installConsole } from "../src/server/console";
import { config } from "../src/server/config";
test("原生管理代理拒绝匿名、消费者 Cookie 和客户端自行声称的管理员", async () => {
  const app = express();
  installConsole(app);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.once("listening", r));
  const address = server.address() as { port: number };
  const base = "http://127.0.0.1:" + address.port;
  try {
    for (const cookie of [
      "",
      "__Host-zy_center=consumer-session; casdoor_session_id=consumer-native-session",
    ]) {
      for (const [path, method] of [
        ["get-users?owner=consumers", "GET"],
        ["update-application?id=admin/zhenyi-beadgrid", "POST"],
      ]) {
        const r = await fetch(base + "/admin/api/" + path, {
          method,
          headers: {
            Cookie: cookie,
            Origin: new URL(config.CENTER_URL).origin,
            Authorization: "Bearer browser-is-not-an-admin",
          },
          redirect: "manual",
        });
        assert.equal(r.status, 401);
        assert.equal((await r.json()).code, "ADMIN_LOGIN_REQUIRED");
      }
    }
    const cross = await fetch(base + "/admin/api/update-application", {
      method: "POST",
      headers: { Origin: "https://evil.example" },
    });
    assert.equal(cross.status, 403);
  } finally {
    await new Promise<void>((r, j) => server.close((e) => (e ? j(e) : r())));
  }
});
