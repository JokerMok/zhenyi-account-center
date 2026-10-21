import { readFileSync, writeFileSync } from "node:fs";
const m = JSON.parse(readFileSync("upstream/assets/manifest.json"));
writeFileSync(
  ".local/native-static/resource-check.html",
  '<!doctype html><meta charset="UTF-8"><title>本机资源验收</title><h1>固定清单图片实际解码</h1>' +
    m.files
      .map(
        (f) =>
          `<figure style="display:inline-block;width:170px;vertical-align:top"><img src="/admin/static/${f.path}" width="64" height="64" alt="${f.path}"><figcaption>${f.path}</figcaption></figure>`,
      )
      .join("") +
    ["CN", "US", "GB"]
      .map(
        (c) =>
          `<img src="/admin/static/flag-icons/${c}.svg" width="64" alt="${c}">`,
      )
      .join(""),
);
console.log("仅生成本机验收页，不纳入Git、不部署。");
