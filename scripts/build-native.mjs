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
import { nativeBuildKey } from "./native-inputs.mjs";
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
// Always start patch targets from the verified archive: no dependence on ignored manual edits.
for (const path of [
  "App.tsx",
  "Conf.ts",
  "lib/nav.ts",
  "lib/setting.tsx",
  "components/layout/Sidebar.tsx",
  "components/layout/AppLayout.tsx",
  "components/layout/BreadcrumbBar.tsx",
  "components/layout/PoweredBy.tsx",
  "pages/PaymentResultPage.tsx",
  "pages/UserEditPage.tsx",
  "hooks/use-logout.ts",
  "pages/auth/ForgetPage.tsx",
])
  run("tar", [
    "-xzf",
    archive,
    "-C",
    source,
    "--strip-components=1",
    `casdoor-4.22.0/web/src/${path}`,
  ]);
const ext = source + "/web/src/zhenyi";
mkdirSync(ext, { recursive: true });
cpSync("upstream/console/BusinessPage.tsx", ext + "/BusinessPage.tsx");
writeFileSync(
  ext + "/shared.tsx",
  readFileSync("src/web/views.tsx", "utf8").replace(
    'import "./style.css";',
    'import "./business.css";',
  ),
);
writeFileSync(
  ext + "/management.tsx",
  readFileSync("src/web/management.tsx", "utf8").replace(
    "../../config/casdoor-modules.json",
    "./modules.json",
  ),
);
cpSync("config/casdoor-modules.json", ext + "/modules.json");
const { createRequire } = await import("node:module");
const require = createRequire(resolve(source + "/web/package.json"));
const postcss = require("postcss");
const css = postcss.parse(readFileSync("src/web/style.css", "utf8"));
css.walkRules((rule) => {
  if (rule.parent?.type === "atrule" && /keyframes/.test(rule.parent.name))
    return;
  rule.selectors = rule.selectors.map((selector) =>
    selector === ":root"
      ? ".business-surface"
      : ".business-surface " + selector,
  );
});
writeFileSync(
  ext + "/business.css",
  css.toString() +
    `\n.business-surface{font-family:inherit;color:hsl(var(--foreground));background:transparent;--green:hsl(var(--primary));--paper:hsl(var(--card));--line:hsl(var(--border));--soft:hsl(var(--accent));--muted:hsl(var(--muted-foreground))}.business-surface .page-title h1{font-size:24px}.business-surface .panel{border-color:hsl(var(--border));box-shadow:none}.business-surface .ops-table th{background:var(--soft)}.business-surface .drawer{color:hsl(var(--foreground));background:hsl(var(--background))}.business-surface .eyebrow{display:none}`,
);
let app = readFileSync(source + "/web/src/App.tsx", "utf8");
app = app.replace(
  "Setting.initServerUrl();",
  'const BusinessPage = React.lazy(() => import("@/zhenyi/BusinessPage").then(m=>({default:m.BusinessPage})));\nimport {ManagementGuard,ManagementHome} from "@/zhenyi/BusinessPage";\nSetting.initServerUrl();',
);
app = app.replace(
  "<AppLayout />",
  "<ManagementGuard><AppLayout /></ManagementGuard>",
);
app = app.replace(
  '<Route path="/" element={<Dashboard />} />',
  '<Route path="/" element={Setting.BasePath ? <ManagementHome /> : <Navigate to="/account" replace />} /><Route path="/business/:page" element={<BusinessPage />} /><Route path="/system/dashboard" element={<Dashboard />} />',
);
app = app.replace(
  'const lastOrg = localStorage.getItem("lastLoginOrg");',
  'if (Setting.BasePath === "/admin") { window.location.replace("/auth/login?mode=admin&next="+encodeURIComponent("/admin"+location.pathname+location.search)); return null; }\n    const lastOrg = localStorage.getItem("lastLoginOrg");',
);
writeFileSync(source + "/web/src/App.tsx", app);
let nav = readFileSync(source + "/web/src/lib/nav.ts", "utf8");
const entries = [
  ["users", "用户权益查询"],
  ["products", "业务产品"],
  ["features", "功能规则"],
  ["plans", "权益套餐"],
  ["codes", "权益兑换码"],
  ["tasks", "消费与任务恢复"],
  ["ledger", "权益流水"],
  ["audit", "业务审计"],
  ["subscriptions", "订阅权益同步"],
];
const code = `\n  if (Setting.isLocalAdminUser(account)) { groups.unshift({key:'/business',label:'产品与权益',icon:LayoutGrid,to:'/business/products',items:${JSON.stringify(entries.filter(([id]) => id !== "users").map(([id, label]) => ({ key: "/business/" + id, label })))} }); groups.push({key:'/system',label:'系统设置',icon:LayoutGrid,to:'/sysinfo',items:[{key:'/business/diagnostics',label:'配置与诊断'},{key:'/system/dashboard',label:'身份统计'}]}); }\n`;
nav = nav
  .replace(
    "  return applyNavItems(groups, account);",
    code + "  return applyNavItems(groups, account);",
  )
  .replace('label: i18next.t("general:LLM AI")', 'label: "AI与MCP"')
  .replace('label: i18next.t("general:Applications")', 'label: "应用接入"')
  .replace('label: i18next.t("general:Products")', 'label: "商业商品"')
  .replace('label: i18next.t("general:Plans")', 'label: "商业套餐"')
  .replace('label: i18next.t("general:Dashboard")', 'label: "管理首页"');
writeFileSync(source + "/web/src/lib/nav.ts", nav);
const sidebarFile = source + "/web/src/components/layout/Sidebar.tsx";
let sidebarSource = readFileSync(sidebarFile, "utf8");
const sidebarStart = sidebarSource.indexOf("export function AppSidebar");
sidebarSource =
  sidebarSource.slice(0, sidebarStart) +
  sidebarSource
    .slice(sidebarStart)
    .replace(
      "const {state, isMobile} = useSidebar();",
      "const {state, isMobile, setOpenMobile} = useSidebar();\n  const finishNavigate = () => {setOpenMobile(false);onNavigate?.();};",
    )
    .replaceAll("onNavigate={onNavigate}", "onNavigate={finishNavigate}")
    .replace("onClick={onNavigate}", "onClick={finishNavigate}");
writeFileSync(sidebarFile, sidebarSource);
const breadcrumb = source + "/web/src/components/layout/BreadcrumbBar.tsx";
let bc = readFileSync(breadcrumb, "utf8");
bc = bc.replace(
  "const listLabelKey = RESOURCE_LABELS[rootSegment];",
  `if(rootSegment==='business'){const labels=${JSON.stringify(Object.fromEntries([...entries, ["diagnostics", "配置与诊断"]]))};return [{label:'管理首页',to:'/'},{label:labels[pathSegments[1]]||'业务管理'}];} if(rootSegment==='system')return [{label:'管理首页',to:'/'},{label:'身份统计'}];\n  const listLabelKey = RESOURCE_LABELS[rootSegment];`,
);
writeFileSync(breadcrumb, bc);
const userFile = source + "/web/src/pages/UserEditPage.tsx";
let userSource = readFileSync(userFile, "utf8");
userSource = userSource.replace(
  "<AccountItemsProvider\n",
  `{user.owner==='consumers'&&Setting.isLocalAdminUser(account)?<div className="mb-4 flex gap-2"><Button variant="outline" asChild><Link to={'/business/users?subject='+encodeURIComponent(user.id)}>产品权益</Link></Button><Button variant="outline" asChild><Link to={'/business/ledger?subject='+encodeURIComponent(user.id)}>权益相关记录</Link></Button></div>:null}\n      <AccountItemsProvider\n`,
);
writeFileSync(userFile, userSource);
const layout = source + "/web/src/components/layout/AppLayout.tsx";
let lo = readFileSync(layout, "utf8");
lo = lo.replace(
  '  return (\n    <div className="flex h-screen',
  `  if (account && !Setting.isLocalAdminUser(account)) return <div className="min-h-screen bg-background"><header className="border-b p-4"><a href={${JSON.stringify(target)}+"/?"+new URLSearchParams({tab:"security",...(new URLSearchParams(location.search).get("product")?{product:new URLSearchParams(location.search).get("product")!}:{})})}>返回个人中心</a><span className="ml-4">账号与安全</span></header><main className="mx-auto max-w-4xl p-4"><Outlet/></main><footer className="p-4 text-center text-xs"><PoweredBy/></footer></div>;\n  return (\n    <div className="flex h-screen`,
);
writeFileSync(layout, lo);
const setting = source + "/web/src/lib/setting.tsx";
let st = readFileSync(setting, "utf8").replace(
  "export const StaticBaseUrl = Conf.StaticBaseUrl;",
  'export const StaticBaseUrl = BasePath ? BasePath+"/static" : "/static";',
);
st = st.replace(
  "return getFullServerUrl();\n}",
  "return " + JSON.stringify(env.CASDOOR_URL) + ";\n}",
);
// Each auth page carries its OAuth parameters; sessionStorage is only a legacy fallback.
st = st.replace(
  "return `/forget/${application.name}`;",
  "return `/forget/${application.name}` + window.location.search;",
);
st = st.replace(
  'return "/forget";',
  'return "/forget" + window.location.search;',
);
writeFileSync(setting, st);
const forgetFile = source + "/web/src/pages/auth/ForgetPage.tsx";
let forget = readFileSync(forgetFile, "utf8");
forget = forget.replaceAll(
  "Setting.getStoredSigninUrl() || Setting.getLoginLink(application)",
  '((new URLSearchParams(location.search).has("client_id") ? "/login/oauth/authorize" + location.search : "") || Setting.getStoredSigninUrl()) || Setting.getLoginLink(application)',
);
writeFileSync(forgetFile, forget);
const logoutFile = source + "/web/src/hooks/use-logout.ts";
let logoutSource = readFileSync(logoutFile, "utf8");
logoutSource = logoutSource.replace(
  "  return () => {",
  '  return async() => {\n    if(Setting.BasePath==="/admin"){try{const me=await (await fetch("/api/admin/me")).json();if(me.csrf)await fetch("/api/admin/logout",{method:"POST",headers:{"Content-Type":"application/json","X-CSRF-Token":me.csrf},body:"{}"});}catch{Setting.showMessage("error","管理会话退出失败，请重试");return;}}',
);
writeFileSync(logoutFile, logoutSource);
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
  readFileSync(conf, "utf8")
    .replace(
      'export let DefaultApplication = "app-built-in";',
      'export let DefaultApplication = "zhenyi-center";',
    )
    .replace(
      'curCookie["jsonWebConfig"] ?? document.querySelector<HTMLMetaElement>("meta[name=\'casdoor-web-config\']")?.content',
      'document.querySelector<HTMLMetaElement>("meta[name=\'casdoor-web-config\']")?.content ?? curCookie["jsonWebConfig"]',
    )
    .replace('colorPrimary: "#262626"', 'colorPrimary: "#35644f"'),
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
run(process.execPath, ["scripts/sync-native-assets.mjs"]);
run(process.execPath, ["scripts/localize-native-images.mjs"]);
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
    extension_sha256: nativeBuildKey(),
    center: target,
    issuer: env.CASDOOR_URL,
    built_at: new Date().toISOString(),
    patch: "upstream/extensions/native-navigation.md",
  }),
);
console.log("完整原生前端与臻一导航扩展已安装，原生包和上一版本均可回退。");
