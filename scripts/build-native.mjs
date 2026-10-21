import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  cpSync,
  renameSync,
  rmSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import dotenv from "dotenv";
const root = resolve(import.meta.dirname, "..");
process.chdir(root);
const source = resolve(".upstream/source-v4.22.0"),
  archive = ".upstream/source-v4.22.0.tar.gz";
const run = (cmd, args, cwd = root) =>
  execFileSync(cmd, args, {
    cwd,
    stdio: "inherit",
    env: { ...process.env, CYPRESS_INSTALL_BINARY: "0" },
  });
if (!existsSync(source + "/web/src/App.tsx")) {
  mkdirSync(source, { recursive: true });
  run("curl", [
    "-fL",
    "--max-time",
    "120",
    "https://codeload.github.com/casdoor/casdoor/tar.gz/refs/tags/v4.22.0",
    "-o",
    archive,
  ]);
  run("tar", ["-xzf", archive, "-C", source, "--strip-components=1"]);
}
const inventory = JSON.parse(
  readFileSync("docs/generated/casdoor-v4.22.0-inventory.json"),
);
if (
  createHash("sha256").update(readFileSync(archive)).digest("hex") !==
  inventory.source_archive_sha256
)
  throw Error("锁定源码归档校验失败");
const env = { ...dotenv.parse(readFileSync(".env")), ...process.env };
const target = env.CENTER_URL.replace(/\/$/, "");
const navFile = source + "/web/src/lib/nav.ts";
let nav = readFileSync(navFile, "utf8");
nav = nav.replace(
  /\n  \/\/ ZHENYI EXTENSION BEGIN[\s\S]*?\n  \/\/ ZHENYI EXTENSION END\n/,
  "\n",
);
const entries = [
  ["console", "完整管理与配置状态"],
  ["users", "用户与产品权益"],
  ["products", "业务产品与接入"],
  ["features", "业务功能规则"],
  ["plans", "套餐权益映射"],
  ["codes", "权益兑换码"],
  ["tasks", "消费与任务恢复"],
  ["ledger", "权益流水"],
  ["audit", "业务操作记录"],
  ["subscriptions", "订阅权益同步"],
];
const code = `\n  // ZHENYI EXTENSION BEGIN\n  if (Setting.isLocalAdminUser(account)) {\n    groups.unshift({key:'/zhenyi',label:'臻一业务扩展',icon:LayoutGrid,to:'/zhenyi',items:${JSON.stringify(entries.map(([tab, label]) => ({ key: "/zhenyi/" + tab, label, href: target + "/admin?tab=" + tab })))} });\n  }\n  // ZHENYI EXTENSION END\n`;
if (!nav.includes("return applyNavItems(groups, account);"))
  throw Error("上游导航变更，拒绝自动套用补丁");
nav = nav.replace('label: i18next.t("general:LLM AI")', 'label: "AI与MCP"');
nav = nav.replace(
  "  return applyNavItems(groups, account);",
  code + "  return applyNavItems(groups, account);",
);
writeFileSync(navFile, nav);
// This is a compile-time React extension; no iframe, injected HTML, copied credential or replaced upstream route.
const sidebar = source + "/web/src/components/layout/Sidebar.tsx";
let s = readFileSync(sidebar, "utf8");
s = s.replace(
  'target="_blank" rel="noreferrer"',
  'target={item.key.startsWith("/zhenyi/") ? "_self" : "_blank"} rel="noreferrer"',
);
writeFileSync(sidebar, s);
const registry = process.env.NATIVE_NPM_REGISTRY;
if (registry) {
  const lock = source + "/web/yarn.lock";
  let l = readFileSync(lock, "utf8");
  l = l.replace(
    /https:\/\/registry\.(?:yarnpkg\.com|npmjs\.org)\//g,
    registry.replace(/\/$/, "") + "/",
  );
  writeFileSync(lock, l);
}
if (!existsSync(source + "/web/node_modules/.bin/vite"))
  run(
    "npx",
    [
      "--yes",
      "yarn@1.22.22",
      "install",
      "--frozen-lockfile",
      "--ignore-scripts",
      ...(registry ? ["--registry", registry] : []),
    ],
    source + "/web",
  );
const conf = source + "/web/src/Conf.ts";
writeFileSync(
  conf,
  readFileSync(conf, "utf8").replace(
    'colorPrimary: "#262626"',
    'colorPrimary: "#35644f"',
  ),
);
const footer = source + "/web/src/components/layout/PoweredBy.tsx";
let f = readFileSync(footer, "utf8");
f = f.replace(
  /<img[\s\S]*?\/>/,
  '<span className="font-semibold">Casdoor</span>',
);
writeFileSync(footer, f);
const paymentResult = source + "/web/src/pages/PaymentResultPage.tsx";
let pr = readFileSync(paymentResult, "utf8");
pr = pr.replace(
  /\s*\{\/\* ZHENYI RETURN \*\/\}[\s\S]*?\{\/\* ZHENYI RETURN END \*\/\}/,
  "",
);
pr = pr.replace(
  "<Button onClick={goToViewOrder}>",
  `{/* ZHENYI RETURN */}<Button variant="outline" onClick={() => window.location.assign(${JSON.stringify(target + "/?tab=overview&purchase=return")})}>返回个人中心查看权益</Button>{/* ZHENYI RETURN END */}<Button onClick={goToViewOrder}>`,
);
writeFileSync(paymentResult, pr);
run("npx", ["--offline", "yarn@1.22.22", "build"], source + "/web");
const live = resolve(".local/casdoor/web/build"),
  next = live + "-next",
  original = live + "-official-v4.22.0";
if (existsSync(live) && !existsSync(original))
  cpSync(live, original, { recursive: true });
rmSync(next, { recursive: true, force: true });
cpSync(source + "/web/build", next, { recursive: true });
const previous = live + "-previous";
rmSync(previous, { recursive: true, force: true });
if (existsSync(live)) renameSync(live, previous);
renameSync(next, live);
cpSync(source + "/swagger", resolve(".local/casdoor/swagger"), {
  recursive: true,
});
writeFileSync(
  ".local/native-build.json",
  JSON.stringify({
    upstream: "v4.22.0",
    source_sha256: inventory.source_archive_sha256,
    extension_sha256: createHash("sha256")
      .update(readFileSync(import.meta.filename))
      .digest("hex"),
    center: target,
    built_at: new Date().toISOString(),
    patch: "upstream/extensions/native-navigation.md",
  }),
);
console.log("完整原生前端与臻一导航扩展已安装，原生包和上一版本均可回退。");
