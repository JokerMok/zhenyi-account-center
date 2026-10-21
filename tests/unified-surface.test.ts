import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const center = "http://localhost:5310",
  identity = "http://localhost:5300";
test("管理深链接共用固定原生构建与BasePath，旧入口迁移", async () => {
  for (const path of [
    "/admin",
    "/admin/users",
    "/admin/applications",
    "/admin/business/products",
    "/admin/business/tasks",
  ]) {
    const r = await fetch(center + path);
    assert.equal(r.status, 200);
    const html = await r.text();
    assert(html.includes('name="casdoor-base-path" content="/admin"'));
    assert(html.includes("/admin/assets/"));
    assert(!html.includes("<iframe"));
  }
  const old = await fetch(center + "/admin?tab=products", {
    redirect: "manual",
  });
  assert.equal(old.headers.get("location"), "/admin/business/products");
});
test("本地内置资源真实存在且MIME正确，缺失资源严格404", async () => {
  const manifest = JSON.parse(
    await readFile("upstream/assets/manifest.json", "utf8"),
  );
  for (const file of manifest.files) {
    const r = await fetch(center + "/admin/static/" + file.path);
    assert.equal(r.status, 200, file.path);
    assert.match(r.headers.get("content-type") || "", /^image\//, file.path);
    assert(!(await r.text()).trimStart().startsWith("<!doctype"), file.path);
  }
  for (const base of [
    center + "/admin/static",
    identity + "/static",
    identity,
  ]) {
    for (const path of ["/img/does-not-exist.png", "/flag-icons/ZZZZ.svg"]) {
      const r = await fetch(base + path);
      assert.equal(r.status, 404, base + path);
      assert(!String(r.headers.get("content-type")).includes("html"));
    }
  }
  for (const path of ["/files/uploads/missing.png", "/files/uploads/missing.txt"]) {
    const r = await fetch(identity + path);
    assert.equal(r.status, 404, path);
    assert(!String(r.headers.get("content-type")).includes("html"));
  }
  for (const code of ["CN", "US", "GB"]) {
    const r = await fetch(identity + "/flag-icons/" + code + ".svg");
    assert.equal(r.status, 200);
    assert.match(r.headers.get("content-type") || "", /image\/svg/);
  }
});
test("产品上下文只来自登记配置，不能构成开放重定向或授权", async () => {
  for (const product of [
    "https://evil.example",
    "//evil.example",
    "admin",
    "not-registered",
  ]) {
    const c = (await (
      await fetch(center + "/api/config?product=" + encodeURIComponent(product))
    ).json()) as any;
    assert.equal(c.contextProduct, null);
  }
  const c = (await (
    await fetch(center + "/api/config?product=beadgrid")
  ).json()) as any;
  assert.equal(c.contextProduct.url, "http://localhost:5311");
  assert(!JSON.stringify(c).match(/clientSecret|serviceKey/));
  const a = await fetch(center + "/api/admin/users?product=beadgrid");
  assert.equal(a.status, 401);
});
test("原生API代理不添加管理凭据，消费者入口不含运营导航", async () => {
  const r = await fetch(center + "/admin/api/get-account");
  const body = (await r.json()) as any;
  assert.equal(body.status, "error");
  const index = await (await fetch(center + "/")).text();
  assert(!index.includes("/admin/assets/"));
  const missing = await fetch(center + "/not-existing.png");
  assert.equal(missing.status, 404);
});

test("锁定版本的全部原生前端路由仍保留，统计页另有实际入口", async () => {
  const { execFileSync } = await import("node:child_process");
  const original = execFileSync(
    "tar",
    [
      "-xOf",
      ".upstream/source-v4.22.0.tar.gz",
      "casdoor-4.22.0/web/src/App.tsx",
    ],
    { encoding: "utf8" },
  );
  const integrated = await readFile(
    ".upstream/source-v4.22.0/web/src/App.tsx",
    "utf8",
  );
  const paths = [...original.matchAll(/<Route\s+path="([^"]+)"/g)].map(
    (x) => x[1],
  );
  assert(paths.length > 100);
  for (const path of paths)
    assert(integrated.includes('path="' + path + '"'), path);
  assert(
    integrated.includes('path="/system/dashboard" element={<Dashboard />}'),
  );
  assert(integrated.includes('path="/business/:page"'));
});
