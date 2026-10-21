import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, randomBytes } from "node:crypto";
import { pool } from "../src/server/db";
import { casdoorApi, reconcile } from "../src/server/casdoor";
import {
  overview,
  reserve,
  transition,
  grant,
} from "../src/server/entitlements";
import { checkProduct, taskTrace, setTestFlag } from "../src/server/management";
import { config } from "../src/server/config";
import { login, request, testAdministrator } from "./helpers";
let admin: any, user: any, uid: string;
const suffix = randomBytes(6).toString("hex"),
  product = "qa_view_" + suffix;
before(async () => {
  const cred = await testAdministrator();
  admin = await login("admin", cred.username, cred.password);
  const username = "test_complete_" + suffix;
  await casdoorApi(
    "add-user",
    {},
    {
      owner: "consumers",
      name: username,
      id: randomUUID(),
      password: "Local7-" + suffix,
      displayName: "本轮定向验收",
      type: "normal-user",
      isAdmin: false,
      createdTime: new Date().toISOString(),
    },
  );
  user = await login("center", username, "Local7-" + suffix);
  uid = user.me.user.uid;
  await setTestFlag(uid, true, "本轮完整接入专项测试", admin.me.user.uid);
  await pool.query(
    "INSERT INTO products(id,name,application,callback_url,origin) VALUES($1,'只读测试产品',$2,'http://localhost:5488/callback','http://localhost:5488')",
    [product, product],
  );
  await pool.query(
    "INSERT INTO features(product_id,id,name,kind,free_quota,period) VALUES($1,'export','每日次数','quota',3,'daily')",
    [product],
  );
});
after(async () => {
  await pool.query("UPDATE identities SET blocked=false WHERE uid=$1", [uid]);
  await pool.query("UPDATE products SET status='disabled' WHERE id=$1", [
    product,
  ]);
  await pool.end();
});
test("管理员只读查看封禁与停用产品，不产生免费发放", async () => {
  await pool.query("UPDATE identities SET blocked=true WHERE uid=$1", [uid]);
  await pool.query("UPDATE products SET status='disabled' WHERE id=$1", [
    product,
  ]);
  const before = (
    await pool.query(
      "SELECT count(*) FROM quota_buckets WHERE uid=$1 AND product_id=$2",
      [uid, product],
    )
  ).rows[0].count;
  const read = await overview(uid, product, { readOnly: true });
  assert.equal(read.features[0].remaining, 0);
  assert.equal(read.features[0].allowed, false);
  assert.equal(
    (
      await pool.query(
        "SELECT count(*) FROM quota_buckets WHERE uid=$1 AND product_id=$2",
        [uid, product],
      )
    ).rows[0].count,
    before,
  );
  await assert.rejects(overview(uid, product));
  await pool.query("UPDATE identities SET blocked=false WHERE uid=$1", [uid]);
  await pool.query("UPDATE products SET status='active' WHERE id=$1", [
    product,
  ]);
});
test("额度来源、预占与过期明细和余额守恒", async () => {
  await overview(uid, product);
  await grant(admin.me.user.uid, {
    uid,
    product_id: product,
    kind: "quota",
    feature_id: "export",
    amount: 4,
    reason: "验证赠送明细",
  } as any);
  await grant(admin.me.user.uid, {
    uid,
    product_id: product,
    kind: "quota",
    feature_id: "export",
    amount: 7,
    expires_at: new Date(Date.now() - 60000).toISOString(),
    reason: "验证过期明细",
  } as any);
  const r = await reserve(uid, product, {
    feature_id: "export",
    request_id: "quota_" + suffix,
    amount: 2,
  });
  const o = await overview(uid, product, { readOnly: true });
  const f = o.features[0];
  assert.equal(f.remaining, 5);
  assert.equal(f.held, 2);
  assert.equal(
    f.buckets
      .filter((b: any) => !b.expired)
      .reduce((s: number, b: any) => s + b.remaining, 0),
    f.remaining,
  );
  assert(f.buckets.some((b: any) => b.expired));
  await transition(uid, product, r.id, "cancel");
});
test("配置检查不会冒充真实产品验收，未登记产品具体提示缺项", async () => {
  const p = await checkProduct(product, admin.me.user.uid);
  assert.equal(p.passed, false);
  assert(p.missing.some((x) => x.includes("鉴权")));
  const row = (
    await pool.query("SELECT verified_at FROM products WHERE id=$1", [product])
  ).rows[0];
  assert.equal(row.verified_at, null);
});
test("确认扣次但无业务事实时，运营追踪明确返回未知", async () => {
  const r = await reserve(uid, product, {
    feature_id: "export",
    request_id: "unknown_" + suffix,
    amount: 1,
  });
  await transition(uid, product, r.id, "confirm");
  const found = await taskTrace(r.request_id);
  assert.equal(found[0].status, "confirmed");
  assert.equal(found[0].delivery.stage, "unknown");
  assert(found[0].ledger.some((x: any) => x.action === "confirmed"));
  await transition(uid, product, r.id, "refund");
});
test("测试账号按明确字段过滤，普通消费者不能访问完整管理接口", async () => {
  const rows = await request(
    admin,
    "/api/admin/users?paginated=1&q=" +
      user.me.user.username +
      "&data_kind=test",
  );
  assert.equal(rows.status, 200);
  assert(rows.body.items.some((i: any) => i.uid === uid && i.is_test));
  assert.equal((await request(user, "/api/admin/management")).status, 401);
  assert.equal(
    (await request(user, "/api/admin/tasks?q=unknown_" + suffix)).status,
    401,
  );
});
test("上游查询失败记录失败状态且不撤销既有权益", async () => {
  await reconcile(admin.me.user.uid);
  const before = (
    await pool.query(
      "SELECT source_id,active,expires_at FROM subscription_projections ORDER BY source_id",
    )
  ).rows;
  const original = config.CASDOOR_URL;
  try {
    config.CASDOOR_URL = "http://127.0.0.1:5499";
    await assert.rejects(reconcile(admin.me.user.uid));
  } finally {
    config.CASDOOR_URL = original;
  }
  assert.deepEqual(
    (
      await pool.query(
        "SELECT source_id,active,expires_at FROM subscription_projections ORDER BY source_id",
      )
    ).rows,
    before,
  );
  assert.equal(
    (
      await pool.query(
        "SELECT status FROM sync_attempts ORDER BY id DESC LIMIT 1",
      )
    ).rows[0].status,
    "failed",
  );
});
test("消费者的原生OIDC令牌不能进入Casdoor全局管理操作", async () => {
  const session = (
    await pool.query(
      "SELECT access_token FROM sessions WHERE uid=$1 AND app_id='center' ORDER BY created_at DESC LIMIT 1",
      [uid],
    )
  ).rows[0];
  const response = await fetch(config.CASDOOR_URL + "/api/add-organization", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + session.access_token,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      owner: "admin",
      name: "qa_denied_" + suffix,
      displayName: "禁止消费者创建",
    }),
  });
  const result = (await response.json()) as any;
  assert(
    response.status === 403 || result.status === "error",
    "消费者不得执行原生组织创建",
  );
});
