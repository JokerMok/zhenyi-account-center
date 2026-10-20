import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { config } from "../src/server/config";
import { pool } from "../src/server/db";
import { casdoorApi, reconcile } from "../src/server/casdoor";
import { overview } from "../src/server/entitlements";
import { saveCatalog } from "../src/server/catalog";
import { login } from "../tests/helpers";

assert(!config.production, "禁止在生产环境启用测试支付");
for (const address of [config.CASDOOR_URL, config.CENTER_URL])
  assert(
    ["localhost", "127.0.0.1", "[::1]"].includes(new URL(address).hostname),
    "测试支付只允许本机回环地址",
  );
const credentials = JSON.parse(
  await readFile(".local/credentials.json", "utf8"),
);
const admin = await login("admin", "admin", credentials.administrator.password);
const suffix = randomBytes(4).toString("hex"),
  planName = "local-dummy-" + suffix,
  pricingName = "local-dummy-pricing-" + suffix,
  providerName = "local-dummy",
  username = "dummy_test_" + suffix,
  password = "Aa7!" + randomBytes(16).toString("hex");
let nativePlan: any, sub: any;
try {
  if (!(await casdoorApi("get-provider", { id: "consumers/" + providerName })))
    await casdoorApi(
      "add-provider",
      {},
      {
        owner: "consumers",
        name: providerName,
        displayName: "仅本地验收：Dummy 模拟支付",
        createdTime: new Date().toISOString(),
        category: "Payment",
        type: "Dummy",
        clientId: "",
        clientSecret: "",
      },
    );
  await casdoorApi(
    "add-user",
    {},
    {
      owner: "consumers",
      name: username,
      id: randomUUID(),
      displayName: "Dummy 本地测试 " + suffix,
      type: "normal-user",
      password,
      isAdmin: false,
      createdTime: new Date().toISOString(),
    },
  );
  await casdoorApi(
    "add-plan",
    {},
    {
      owner: "consumers",
      name: planName,
      displayName: "仅本地测试会员（不收费）",
      createdTime: new Date().toISOString(),
      description: "官方 Dummy 提供者自动化验收，无真实交易",
      price: 1,
      currency: "CNY",
      period: "Monthly",
      role: "",
      paymentProviders: [providerName],
      isEnabled: true,
      isExclusive: true,
    },
  );
  nativePlan = await casdoorApi("get-plan", { id: "consumers/" + planName });
  const product = await casdoorApi("get-product", {
    id: "consumers/" + nativePlan.product,
  });
  if (product.quantity <= 0)
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
      name: pricingName,
      displayName: "仅本地测试定价",
      createdTime: new Date().toISOString(),
      plans: [planName],
      application: "zhenyi-beadgrid",
      isEnabled: true,
      isPublic: false,
      isInviteOnly: false,
    },
  );
  await saveCatalog(admin.me.user.uid, "plans", {
    product_id: "beadgrid",
    id: "local_dummy",
    name: "仅本地 Dummy 支付验收",
    days: 30,
    quotas: { export: 5 },
    active: true,
    casdoor_plan: "consumers/" + planName,
    reason: "本机官方测试支付链路验收",
  });
  const user = await login("beadgrid", username, password);
  const order = await casdoorApi(
    "place-order",
    { owner: "consumers", userName: username },
    {
      productInfos: [
        { name: product.name, quantity: 1, pricingName, planName },
      ],
    },
  );
  const payment = await casdoorApi(
    "pay-order",
    { id: "consumers/" + order.name, providerName, paymentEnv: "Sandbox" },
    {},
  );
  assert.equal(payment.type, "Dummy");
  assert.equal(payment.state, "Created");
  await reconcile(admin.me.user.uid);
  const before = await overview(user.me.user.uid, "beadgrid");
  assert.equal(before.membership.active, false);
  assert.equal(before.features.find((f) => f.id === "export").remaining, 3);
  // This is the official mock provider's notify endpoint. No real payment status is fabricated locally.
  await casdoorApi(
    `notify-payment/consumers/${encodeURIComponent(payment.name)}`,
    {},
    {},
  );
  const paid = await casdoorApi("get-payment", {
    id: "consumers/" + payment.name,
  });
  assert.equal(paid.type, "Dummy");
  assert.equal(paid.state, "Paid");
  const list = await casdoorApi("get-subscriptions", { owner: "consumers" });
  sub = list.find((s: any) => s.payment === payment.name);
  assert(sub);
  assert.equal(sub.state, "Active");
  await reconcile(admin.me.user.uid);
  const active = await overview(user.me.user.uid, "beadgrid");
  assert.equal(active.membership.active, true);
  assert.equal(active.features.find((f) => f.id === "export").remaining, 8);
  const sources = (
    await pool.query(
      "SELECT id FROM quota_buckets WHERE uid=$1 AND source='subscription'",
      [user.me.user.uid],
    )
  ).rowCount;
  assert.equal(sources, 1);
  await casdoorApi(
    `notify-payment/consumers/${encodeURIComponent(payment.name)}`,
    {},
    {},
  );
  await reconcile(admin.me.user.uid);
  const repeated = await overview(user.me.user.uid, "beadgrid");
  assert.equal(repeated.features.find((f) => f.id === "export").remaining, 8);
  const report = {
    verified_at: new Date().toISOString(),
    provider: "Dummy",
    real_money: false,
    order: order.name,
    payment: payment.name,
    payment_state: paid.state,
    subscription: sub.name,
    subscription_state: sub.state,
    rights_active: true,
    quota_before: 3,
    quota_after: 8,
    duplicate_notification: "no duplicate grant",
    test_entry_disabled_after_run: true,
  };
  await writeFile(
    ".local/dummy-payment-result.json",
    JSON.stringify(report, null, 2),
    { mode: 0o600 },
  );
  console.log(JSON.stringify(report, null, 2));
} finally {
  // Detach the test provider from purchasable plans, pause the synthetic subscription, and withdraw the projection.
  if (sub)
    await casdoorApi(
      "update-subscription",
      { id: `consumers/${sub.name}` },
      { ...sub, state: "Suspended" },
    );
  if (nativePlan)
    await casdoorApi(
      "update-plan",
      { id: `consumers/${nativePlan.name}` },
      { ...nativePlan, isEnabled: false, paymentProviders: [] },
    );
  const pricing = await casdoorApi("get-pricing", {
    id: "consumers/" + pricingName,
  });
  if (pricing)
    await casdoorApi(
      "update-pricing",
      { id: "consumers/" + pricingName },
      { ...pricing, isEnabled: false, plans: [] },
    );
  if (nativePlan)
    await saveCatalog(admin.me.user.uid, "plans", {
      product_id: "beadgrid",
      id: "local_dummy",
      name: "仅本地 Dummy 支付验收",
      days: 30,
      quotas: { export: 5 },
      active: false,
      casdoor_plan: "consumers/" + planName,
      reason: "验收结束，关闭本地测试支付入口",
    });
  await reconcile(admin.me.user.uid);
  await pool.end();
}
