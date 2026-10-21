import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";
const root = ".upstream/source-v4.22.0/web/src",
  out = "upstream/assets";
async function files(dir) {
  return (
    await Promise.all(
      (await readdir(dir, { withFileTypes: true })).map((e) =>
        e.isDirectory() ? files(join(dir, e.name)) : join(dir, e.name),
      ),
    )
  ).flat();
}
const sources = (await files(root)).filter((p) => /\.(tsx?|css)$/.test(p));
let paths = new Set([
  "img/favicon.png",
  "img/casdoor-logo_1185x256.png",
  "img/casdoor-logo_1185x256_dark.png",
]);
for (const file of sources) {
  const s = await readFile(file, "utf8");
  for (const m of s.matchAll(
    /(?:StaticBaseUrl\}\/|https:\/\/cdn\.casbin\.org\/)(img\/[\w.-]+\.(?:png|svg|jpg|jpeg|ico|gif|webp))/g,
  ))
    paths.add(m[1]);
}
const setting = await readFile(root + "/lib/setting.tsx", "utf8");
const oauth = setting
  .split("export function getProviderTypeOptions(category) {")[1]
  .split('if (category === "Email")')[0]
  .split('if (category === "SMS")')[0];
for (const m of oauth.matchAll(/id: "([^"]+)"/g))
  paths.add(
    "img/social_" +
      (/^(Custom|OIDC)/.test(m[1]) ? "custom" : m[1].toLowerCase()) +
      ".png",
  );
let previous;
try {
  previous = JSON.parse(await readFile(out + "/manifest.json", "utf8"));
} catch {}
const entries = [],
  failures = [];
await mkdir(out + "/img", { recursive: true });
let queue = [...paths];
await Promise.all(
  Array.from({ length: 6 }, async () => {
    while (queue.length) {
      const path = queue.shift(),
        url = "https://cdn.casbin.org/" + path;
      let data;
      try {
        data = await readFile(out + "/" + path);
        if (
          !previous?.files.some(
            (x) =>
              x.path === path &&
              x.sha256 === createHash("sha256").update(data).digest("hex"),
          )
        )
          data = null;
      } catch {}
      if (!data) {
        try {
          const r = await fetch(url, { signal: AbortSignal.timeout(20000) });
          if (
            !r.ok ||
            !(r.headers.get("content-type") || "").startsWith("image/")
          )
            throw Error(
              "HTTP " + r.status + " " + r.headers.get("content-type"),
            );
          data = Buffer.from(await r.arrayBuffer());
          await writeFile(out + "/" + path, data);
        } catch (e) {
          failures.push({ path, error: e.message });
          continue;
        }
      }
      entries.push({
        path,
        source: previous?.files.find((x) => x.path === path)?.source || url,
        sha256: createHash("sha256").update(data).digest("hex"),
        bytes: data.length,
      });
    }
  }),
);
entries.sort((a, b) => a.path.localeCompare(b.path));
await writeFile(
  out + "/manifest.json",
  JSON.stringify(
    {
      upstream: "Casdoor v4.22.0",
      scope: "仅固定源码显式图片与OAuth提供者图标，非完整CDN",
      files: entries,
      unavailable: failures,
    },
    null,
    2,
  ) + "\n",
);
console.log("本地资源", entries.length, "上游缺失", failures.length);
if (failures.length) console.log(failures);
