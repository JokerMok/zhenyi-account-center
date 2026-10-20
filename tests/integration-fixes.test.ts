import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, randomBytes } from "node:crypto";
import { pool } from "../src/server/db";
import { casdoorApi, upstreamLogout } from "../src/server/casdoor";
import { appConfigs, config } from "../src/server/config";
import { login } from "./helpers";
import {
  createEntitlementClient,
  CenterRequestError,
} from "../examples/product-client";
import { runDemoJob } from "../src/server/demo-runner";
let uid: string, token: string, focusToken: string, username: string;
const call = async (
  product: string,
  path: string,
  body?: unknown,
  userToken?: string,
  key = appConfigs[product].serviceKey,
) => {
  const r = await fetch(
    `${config.CENTER_URL}/api/v1/products/${product}${path}`,
    {
      method: body === undefined ? "GET" : "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "X-User-Token": userToken || "",
        "Content-Type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    },
  );
  return { status: r.status, body: (await r.json()) as any };
};
const rights = createEntitlementClient({
  centerUrl: config.CENTER_URL,
  productId: "beadgrid",
  serviceKey: appConfigs.beadgrid.serviceKey,
});
const hold = async () => {
  const h = await rights.reserve(token, "export", randomUUID());
  return h;
};
before(async () => {
  username = "test_integration_" + randomBytes(5).toString("hex");
  const password = "testing-" + randomBytes(12).toString("hex");
  await casdoorApi(
    "add-user",
    {},
    {
      owner: "consumers",
      name: username,
      id: randomUUID(),
      displayName: username,
      type: "normal-user",
      password,
      isAdmin: false,
      createdTime: new Date().toISOString(),
    },
  );
  const s = await login("beadgrid", username, password);
  uid = s.me.user.uid;
  const f = await login("focustake", username, password);
  token = (
    await pool.query(
      "SELECT access_token FROM sessions WHERE uid=$1 AND app_id='beadgrid'",
      [uid],
    )
  ).rows[0].access_token;
  focusToken = (
    await pool.query(
      "SELECT access_token FROM sessions WHERE uid=$1 AND app_id='focustake'",
      [f.me.user.uid],
    )
  ).rows[0].access_token;
  await rights.get(token);
  await pool.query(
    "INSERT INTO quota_buckets(uid,product_id,feature_id,source,source_key,remaining) VALUES($1,'beadgrid','export','qa',$2,50)",
    [uid, randomUUID()],
  );
});
after(async () => {
  await pool.end();
});
test("恢复入口不需要用户令牌，不能新开消费或注入用户身份", async () => {
  const h = await hold();
  assert.equal(
    (
      await call(
        "beadgrid",
        `/reservations/${h.id}/cancel`,
        {},
        "invalid-expired",
      )
    ).status,
    401,
  );
  assert.equal(
    (
      await call("beadgrid", "/recovery", {
        reservation_id: h.id,
        action: "confirm",
        reason: "非法新消费",
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await call("beadgrid", "/recovery", {
        reservation_id: h.id,
        action: "cancel",
        reason: "失败恢复",
        uid,
      })
    ).status,
    400,
  );
  const r = await call("beadgrid", "/recovery", {
    reservation_id: h.id,
    action: "cancel",
    reason: "用户令牌已失效，任务未执行",
  });
  assert.equal(r.body.status, "cancelled");
  assert.equal(
    (
      await call("beadgrid", "/recovery", {
        reservation_id: h.id,
        action: "cancel",
        reason: "重复恢复",
      })
    ).body.status,
    "cancelled",
  );
  assert.equal(
    Number(
      (
        await pool.query(
          "SELECT count(*) n FROM task_recovery_audit WHERE reservation_id=$1",
          [h.id],
        )
      ).rows[0].n,
    ),
    1,
  );
});
test("恢复与查询严格核对产品凭据，错误产品不能定位预占", async () => {
  const h = await hold();
  assert.equal(
    (await call("focustake", `/recovery/reservations?reservation_id=${h.id}`))
      .status,
    404,
  );
  assert.equal(
    (
      await call("focustake", "/recovery", {
        reservation_id: h.id,
        action: "cancel",
        reason: "跨产品尝试",
      })
    ).status,
    404,
  );
  assert.equal(
    (
      await call(
        "beadgrid",
        "/recovery",
        { reservation_id: h.id, action: "cancel", reason: "跨产品尝试" },
        undefined,
        appConfigs.focustake.serviceKey,
      )
    ).status,
    403,
  );
  const byRequest = await rights.status({ request_id: h.request_id });
  assert.equal(byRequest.id, h.id);
  await rights.recover({ reservation_id: h.id }, "cancel", "结束本地测试");
});
test("确认响应丢失后查询确认事实，重试不重复扣次", async () => {
  const h = await hold();
  let dropped = false;
  const client = createEntitlementClient({
    centerUrl: config.CENTER_URL,
    productId: "beadgrid",
    serviceKey: appConfigs.beadgrid.serviceKey,
    fetch: async (input, init) => {
      const r = await fetch(input, init);
      if (String(input).endsWith("/confirm") && !dropped) {
        dropped = true;
        throw Error("response lost");
      }
      return r;
    },
  });
  assert.equal((await client.confirmKnown(token, h.id)).status, "confirmed");
  assert.equal((await client.confirmKnown(token, h.id)).status, "confirmed");
  const n = await pool.query(
    "SELECT count(*) n FROM ledger WHERE reference=$1 AND action='confirmed'",
    [h.id],
  );
  assert.equal(Number(n.rows[0].n), 1);
  await rights.recover(
    { reservation_id: h.id },
    "refund",
    "测试确认响应丢失后返还",
  );
});
test("示例任务保留未知状态，无用户令牌恢复交付且只消费一次", async () => {
  const input = { request_id: randomUUID(), mode: "success" };
  let lost = false;
  const client = createEntitlementClient({
    centerUrl: config.CENTER_URL,
    productId: "beadgrid",
    serviceKey: appConfigs.beadgrid.serviceKey,
    fetch: async (input, init) => {
      if (lost && String(input).includes("/recovery/reservations"))
        throw Error("status unavailable");
      const r = await fetch(input, init);
      if (String(input).endsWith("/confirm")) {
        lost = true;
        throw Error("confirmation response lost");
      }
      return r;
    },
  });
  const pending = await runDemoJob("beadgrid", uid, input, token, client);
  assert.equal(pending.status, "pending_recovery");
  const job = (
    await pool.query("SELECT * FROM demo_jobs WHERE uid=$1 AND request_id=$2", [
      uid,
      input.request_id,
    ])
  ).rows[0];
  assert.equal(
    (await rights.status({ reservation_id: job.reservation_id })).status,
    "confirmed",
  );
  // Recovery reads only the durable product job; it has no browser user id or token.
  const done = await runDemoJob("beadgrid", uid, input);
  assert.equal(done.ok, true);
  const again = await runDemoJob("beadgrid", uid, input);
  assert.equal(again.artifact.sha256, done.artifact.sha256);
  assert.equal(again.repeated, true);
  assert.equal(
    Number(
      (
        await pool.query(
          "SELECT count(*) n FROM ledger WHERE reference=$1 AND action='confirmed'",
          [job.reservation_id],
        )
      ).rows[0].n,
    ),
    1,
  );
});
test("用户封禁与全局退出后，后端仍可释放和幂等返还", async () => {
  const a = await hold(),
    b = await hold();
  await rights.confirm(token, b.id);
  await pool.query("UPDATE identities SET blocked=true WHERE uid=$1", [uid]);
  assert.equal(
    (await call("beadgrid", `/reservations/${a.id}/cancel`, {}, token)).status,
    403,
  );
  assert.equal(
    (
      await rights.recover(
        { reservation_id: a.id },
        "cancel",
        "封禁用户失败任务释放",
      )
    ).status,
    "cancelled",
  );
  assert.equal(
    (
      await rights.recover(
        { reservation_id: b.id },
        "refund",
        "封禁用户已消费任务交付失败",
      )
    ).status,
    "refunded",
  );
  assert.equal(
    (await rights.recover({ reservation_id: b.id }, "refund", "重复返还"))
      .status,
    "refunded",
  );
  await pool.query("UPDATE identities SET blocked=false WHERE uid=$1", [uid]);
  const c = await hold();
  await upstreamLogout(token);
  assert.equal(
    (await call("beadgrid", `/reservations/${c.id}/cancel`, {}, token)).status,
    401,
  );
  assert.equal(
    (
      await rights.recover(
        { reservation_id: c.id },
        "cancel",
        "用户退出后的任务恢复",
      )
    ).status,
    "cancelled",
  );
  assert.equal(
    Number(
      (
        await pool.query(
          "SELECT count(*) n FROM ledger WHERE reference=$1 AND action='refunded'",
          [b.id],
        )
      ).rows[0].n,
    ),
    1,
  );
});

test("明确拒绝且从未预占的任务不会伪装成结果未知", async () => {
  const client = createEntitlementClient({
    centerUrl: config.CENTER_URL,
    productId: "beadgrid",
    serviceKey: appConfigs.beadgrid.serviceKey,
    fetch: async (input) =>
      new Response(
        JSON.stringify(
          String(input).includes("/recovery/")
            ? { error: "没有记录", code: "RESERVATION_NOT_FOUND" }
            : { error: "额度不足", code: "QUOTA_EXHAUSTED" },
        ),
        {
          status: String(input).includes("/recovery/") ? 404 : 403,
          headers: { "Content-Type": "application/json" },
        },
      ),
  });
  const result = await runDemoJob(
    "beadgrid",
    uid,
    { request_id: randomUUID(), mode: "success" },
    "test-only-rejected-token",
    client,
  );
  assert.equal(result.status, "rejected");
  assert.equal(result.code, "QUOTA_EXHAUSTED");
});
