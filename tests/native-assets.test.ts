import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
// @ts-expect-error Build helpers are executable JavaScript.
import { shortcutImagePaths } from "../scripts/native-dynamic-assets.mjs";

test("动态快捷图标纳入本地发布清单，内容和摘要一致", () => {
  const source =
    'const items = [{link: "/organizations"}, {link: "/users"}, {link: "/providers"}, {link: "/applications"}].map(item => ({logo: `${Setting.StaticBaseUrl}/img${item.link}.png`}))';
  const paths = shortcutImagePaths(source);
  assert.equal(paths.length, 4);
  const manifest = JSON.parse(
    readFileSync("upstream/assets/manifest.json", "utf8"),
  );
  for (const path of paths) {
    const entry = manifest.files.find(
      (file: { path: string }) => file.path === path,
    );
    assert.ok(entry, path);
    const data = readFileSync("upstream/assets/" + path);
    assert.equal(data.subarray(0, 8).toString("hex"), "89504e470d0a1a0a", path);
    assert.equal(data.length, entry.bytes);
    assert.equal(createHash("sha256").update(data).digest("hex"), entry.sha256);
  }
  assert.throws(() => shortcutImagePaths("const items = []"), /规则已变化/);
});
