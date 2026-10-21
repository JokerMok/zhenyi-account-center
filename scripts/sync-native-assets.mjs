import {
  readFileSync,
  existsSync,
  mkdirSync,
  cpSync,
  readdirSync,
  copyFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
const out = ".local/native-static",
  manifest = JSON.parse(readFileSync("upstream/assets/manifest.json"));
mkdirSync(out, { recursive: true });
for (const file of manifest.files) {
  const path = "upstream/assets/" + file.path;
  if (
    createHash("sha256").update(readFileSync(path)).digest("hex") !==
    file.sha256
  )
    throw Error("资源校验失败: " + file.path);
  mkdirSync(out + "/" + file.path.split("/").slice(0, -1).join("/"), {
    recursive: true,
  });
  copyFileSync(path, out + "/" + file.path);
}
mkdirSync(out + "/flag-icons", { recursive: true });
for (const name of readdirSync("node_modules/flag-icons/flags/4x3").filter(
  (n) => n.endsWith(".svg"),
)) {
  copyFileSync(
    "node_modules/flag-icons/flags/4x3/" + name,
    out + "/flag-icons/" + name,
  );
  copyFileSync(
    "node_modules/flag-icons/flags/4x3/" + name,
    out + "/flag-icons/" + name.toUpperCase().replace(".SVG", ".svg"),
  );
}
cpSync("public/brand.svg", out + "/brand.svg");
console.log("本地图片与旗帜已按锁定来源同步；字体由原生构建随assets打包。");
