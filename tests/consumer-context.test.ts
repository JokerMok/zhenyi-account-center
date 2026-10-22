import { test } from "node:test";
import assert from "node:assert/strict";
import {
  consumerTarget,
  flowCookieSuffix,
  escapeHtml,
} from "../src/server/consumer-context";
const apps = {
  beadgrid: { enabled: true, url: "https://pindou.shizibandu.icu" },
  disabled: { enabled: false, url: "https://example.com" },
  admin: { enabled: true, url: "https://accounts.shizibandu.icu" },
};
test("消费者目标仅接受启用产品及真实页签，返回地址不能被外部输入替换", () => {
  const q = {
    product: "beadgrid",
    tab: "security",
    account: "bdd576b5-2602-405f-8eba-1e7be9e114f1",
    returnUrl: "https://evil.example",
  };
  assert.equal(
    consumerTarget(q, apps).path,
    "/?product=beadgrid&tab=security&account=" + q.account,
  );
  for (const query of [
    { product: "admin" },
    { product: "disabled" },
    { product: "unknown" },
    { product: "beadgrid", tab: "admin" },
    { account: "<script>" },
  ])
    assert.throws(() => consumerTarget(query, apps));
});
test("同一消费者两次授权使用独立浏览器绑定，不能共享覆盖事务", () => {
  assert.notEqual(
    flowCookieSuffix("center", "state1"),
    flowCookieSuffix("center", "state2"),
  );
  assert.notEqual(
    flowCookieSuffix("center", "state1"),
    flowCookieSuffix("admin", "state1"),
  );
  assert.equal(
    flowCookieSuffix("center", "state1"),
    flowCookieSuffix("center", "state1"),
  );
  assert.equal(escapeHtml('/?a=1&b="x"'), "/?a=1&amp;b=&quot;x&quot;");
});
