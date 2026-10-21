import ts from "typescript";
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
const root = ".upstream/source-v4.22.0/web/src";
const manifest = JSON.parse(readFileSync("upstream/assets/manifest.json"));
const known = manifest.files.map((f) => "/" + f.path);
writeFileSync(
  root + "/zhenyi/assets.ts",
  `import {BasePath} from '@/lib/base-path';const known=new Set(${JSON.stringify(known)});export function localAssetUrl(value:any){if(typeof value!=='string')return value;try{const u=new URL(value,location.origin);if(u.hostname==='cdn.casbin.org'&&known.has(u.pathname))return (BasePath||'')+'/static'+u.pathname;}catch{}return value;}`,
);
function files(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() && !["zhenyi"].includes(e.name)
      ? files(join(dir, e.name))
      : e.isFile() && e.name.endsWith(".tsx")
        ? [join(dir, e.name)]
        : [],
  );
}
let count = 0;
for (const file of files(root)) {
  let text = readFileSync(file, "utf8");
  if (text.includes("import {localAssetUrl}")) continue;
  const sf = ts.createSourceFile(
      file,
      text,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX,
    ),
    edits = [];
  function visit(node) {
    if (
      ts.isJsxAttribute(node) &&
      node.name.getText(sf) === "src" &&
      node.initializer
    ) {
      const init = node.initializer;
      if (ts.isJsxExpression(init) && init.expression)
        edits.push([
          init.expression.getStart(sf),
          init.expression.getEnd(),
          `localAssetUrl(${init.expression.getText(sf)})`,
        ]);
      else if (ts.isStringLiteral(init))
        edits.push([
          init.getStart(sf),
          init.getEnd(),
          `{localAssetUrl(${JSON.stringify(init.text)})}`,
        ]);
    }
    ts.forEachChild(node, visit);
  }
  visit(sf);
  if (!edits.length) continue;
  for (const [start, end, replacement] of edits.sort((a, b) => b[0] - a[0]))
    text = text.slice(0, start) + replacement + text.slice(end);
  writeFileSync(
    file,
    'import {localAssetUrl} from "@/zhenyi/assets";\n' + text,
  );
  count++;
}
console.log(
  "已按资源清单本地化",
  count,
  "个原生React图片使用文件；未下载或修改用户私人头像。",
);
