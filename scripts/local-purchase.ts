import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { randomBytes, randomUUID } from "node:crypto";
import { config } from "../src/server/config";
import { casdoorApi, reconcile } from "../src/server/casdoor";
import { pool } from "../src/server/db";
import { saveCatalog } from "../src/server/catalog";
import { overview } from "../src/server/entitlements";
import { setTestFlag } from "../src/server/management";
import { login, testAdministrator } from "../tests/helpers";
assert(
  !config.production &&
    config.host === "127.0.0.1" &&
    new URL(config.CASDOOR_URL).hostname === "localhost",
  "测试购买仅限本机回环环境",
);
const mode = process.argv[2] || "prepare",
  cred = await testAdministrator(),
  admin = await login("admin", cred.username, cred.password);
const file = ".local/purchase-fixture.json";
let fixture: any = await readFile(file, "utf8")
  .then(JSON.parse)
  .catch(() => null);
if (mode === "prepare") {
  assert(
    !fixture || fixture.closed,
    "已有未关闭测试购买，请先 verify / close，避免重复创建",
  );
  const suffix = randomBytes(4).toString("hex"),
    name = "qa_purchase_" + suffix,
    password = "Local-" + randomBytes(12).toString("hex"),
    plan = "qa_purchase_plan_" + suffix,
    pricing = "qa_purchase_pricing_" + suffix,
    provider = "local-dummy";
  if (!(await casdoorApi("get-provider", { id: "consumers/" + provider })))
    await casdoorApi(
      "add-provider",
      {},
      {
        owner: "consumers",
        name: provider,
        category: "Payment",
        type: "Dummy",
        displayName: "仅本机模拟支付",
        createdTime: new Date().toISOString(),
      },
    );
  await casdoorApi(
    "add-user",
    {},
    {
      owner: "consumers",
      name,
      id: randomUUID(),
      password,
      displayName: "本机购买验收用户",
      type: "normal-user",
      isAdmin: false,
      createdTime: new Date().toISOString(),
    },
  );
  await casdoorApi(
    "add-plan",
    {},
    {
      owner: "consumers",
      name: plan,
      displayName: "本机模拟月度会员（无真实资金）",
      price: 1,
      currency: "CNY",
      period: "Monthly",
      isEnabled: true,
      isExclusive: true,
      paymentProviders: [provider],
      createdTime: new Date().toISOString(),
    },
  );
  const nativePlan = await casdoorApi("get-plan", { id: "consumers/" + plan });
  const product = await casdoorApi("get-product", {
    id: "consumers/" + nativePlan.product,
  });
  await casdoorApi(
    "update-product",
    { id: "consumers/" + product.name },
    { ...product, quantity: 100 },
  );
  await casdoorApi(
    "add-pricing",
    {},
    {
      owner: "consumers",
      name: pricing,
      displayName: "本机购买测试 · 不产生真实资金",
      description: "官方 Dummy 提供者；本页仅在本次验收期间开放。",
      plans: [plan],
      application: "zhenyi-center",
      isEnabled: true,
      isPublic: false,
      isInviteOnly: false,
      createdTime: new Date().toISOString(),
    },
  );
  await saveCatalog(admin.me.user.uid, "plans", {
    product_id: "beadgrid",
    id: "local_purchase",
    name: "本机模拟购买权益",
    days: 30,
    quotas: { export: 5 },
    active: true,
    casdoor_plan: "consumers/" + plan,
    reason: "本轮浏览器购买闭环验收",
  });
  const u = await login("center", name, password);
  await setTestFlag(
    u.me.user.uid,
    true,
    "本轮浏览器购买测试专用账号",
    admin.me.user.uid,
  );
  fixture = {
    username: name,
    password,
    uid: u.me.user.uid,
    plan,
    pricing,
    product: product.name,
    closed: false,
    created_at: new Date().toISOString(),
  };
  await writeFile(file, JSON.stringify(fixture), { mode: 0o600 });
  console.log(
    "本机 Dummy 购买已准备；消费者测试账号保存在 .local/purchase-fixture.json。真实收费未启用。",
  );
} else if (mode === "verify") {
  assert(fixture && !fixture.closed);
  const payments = await casdoorApi("get-payments", { owner: "consumers" }),
    list = await casdoorApi("get-subscriptions", { owner: "consumers" });
  const sub = list.find(
    (s: any) =>
      (s.user === fixture.username && s.plan === fixture.plan) ||
      (s.user === "consumers/" + fixture.username && s.plan === fixture.plan),
  );
  assert(sub, "浏览器尚未完成购买");
  const payment = payments.find((p: any) => p.name === sub.payment);
  assert(payment?.type === "Dummy" && payment.state === "Paid");
  assert.equal(sub.state, "Active");
  await reconcile(admin.me.user.uid);
  const rights = await overview(fixture.uid, "beadgrid");
  assert(rights.membership.active);
  assert.equal(rights.features.find((f) => f.id === "export").remaining, 8);
  await casdoorApi("notify-payment/consumers/" + payment.name, {}, {});
  await casdoorApi("notify-payment/consumers/" + payment.name, {}, {});
  await reconcile(admin.me.user.uid);
  assert.equal(
    (await overview(fixture.uid, "beadgrid")).features.find(
      (f) => f.id === "export",
    ).remaining,
    8,
  );
  assert.equal(
    (
      await pool.query(
        "SELECT count(*) FROM quota_buckets WHERE uid=$1 AND source='subscription'",
        [fixture.uid],
      )
    ).rows[0].count,
    "1",
  );
  const report = {
    date: new Date().toISOString(),
    provider: "Dummy",
    real_money: false,
    browser_checkout: true,
    payment_state: payment.state,
    subscription_state: sub.state,
    remaining: 8,
    duplicate_notify: "no duplicate grant",
  };
  await writeFile(
    ".local/browser-purchase-result.json",
    JSON.stringify(report, null, 2),
    { mode: 0o600 },
  );
  console.log(
    "浏览器订单 → Dummy已支付 → Active订阅 → 会员与5次权益到账；重复通知未重复发放。",
  );
} else if (mode === "close") {
  assert(fixture);
  const p = await casdoorApi("get-plan", { id: "consumers/" + fixture.plan }),
    pricing = await casdoorApi("get-pricing", {
      id: "consumers/" + fixture.pricing,
    });
  if (p)
    await casdoorApi(
      "update-plan",
      { id: "consumers/" + p.name },
      { ...p, isEnabled: false, paymentProviders: [] },
    );
  if (pricing)
    await casdoorApi(
      "update-pricing",
      { id: "consumers/" + pricing.name },
      { ...pricing, isEnabled: false },
    );
  const subs = await casdoorApi("get-subscriptions", { owner: "consumers" });
  for (const sub of subs.filter((s: any) => s.plan === fixture.plan))
    await casdoorApi(
      "update-subscription",
      { id: "consumers/" + sub.name },
      { ...sub, state: "Suspended" },
    );
  await reconcile(admin.me.user.uid);
  fixture.closed = true;
  await writeFile(file, JSON.stringify(fixture), { mode: 0o600 });
  console.log("测试购买入口已关闭，测试订阅已暂停；交易和验收记录保留。");
} else throw Error("prepare / verify / close");
await pool.end();
