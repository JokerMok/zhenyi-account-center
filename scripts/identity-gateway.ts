import express from "express";
import dotenv from "dotenv";
import { resolve } from "node:path";
import { proxyTo } from "../src/server/proxy";
dotenv.config({ quiet: true });
const app = express();
app.disable("x-powered-by");
const staticRoot = resolve(".local/native-static");
app.use(["/static", "/img", "/flag-icons"], (req, res, next) => {
  res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
  next();
});
app.use(
  "/assets",
  express.static(resolve(".local/casdoor/web/build/assets"), {
    fallthrough: true,
    immutable: true,
    maxAge: "1y",
  }),
  express.static(resolve(".local/casdoor/web/build-previous/assets"), {
    fallthrough: true,
    immutable: true,
    maxAge: "1y",
  }),
  (_req, res) => res.status(404).type("text/plain").send("资源不存在"),
);
app.use("/static", express.static(staticRoot, { fallthrough: false }));
app.use("/img", express.static(staticRoot + "/img", { fallthrough: false }));
app.use(
  "/flag-icons",
  express.static(staticRoot + "/flag-icons", { fallthrough: false }),
);
// Casdoor falls back to its SPA for missing uploaded files. Serve the same
// persistent public files here so missing resources retain a real 404 status.
app.use(
  "/files",
  (_req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    next();
  },
  express.static(resolve(".local/casdoor/files"), {
    fallthrough: false,
    index: false,
    redirect: false,
    dotfiles: "deny",
  }),
);
const modules = [
  "users",
  "groups",
  "trees",
  "organizations",
  "applications",
  "providers",
  "marketplace",
  "integrations",
  "resources",
  "certs",
  "keys",
  "roles",
  "permissions",
  "models",
  "adapters",
  "enforcers",
  "agents",
  "servers",
  "server-store",
  "entries",
  "sites",
  "rules",
  "sessions",
  "records",
  "tokens",
  "verifications",
  "product-store",
  "products",
  "coupons",
  "cart",
  "orders",
  "payments",
  "plans",
  "pricings",
  "subscriptions",
  "transactions",
  "forms",
  "syncers",
  "webhooks",
  "webhook-events",
  "tickets",
  "sysinfo",
  "shortcuts",
  "apps",
];
app.use(async (req, res, next) => {
  if (
    req.method === "GET" &&
    (req.path === "/" ||
      modules.some(
        (p) => req.path === "/" + p || req.path.startsWith("/" + p + "/"),
      ))
  ) {
    try {
      const r = await fetch(
        "http://127.0.0.1:" +
          (process.env.CASDOOR_BACKEND_PORT || 5305) +
          "/api/get-account",
        { headers: { Cookie: req.headers.cookie || "" } },
      );
      const body = (await r.json()) as any;
      if (body.status === "ok" && body.data?.owner !== "built-in")
        return next();
    } catch {}
    return res.redirect(
      302,
      (process.env.CENTER_URL || "http://localhost:5310") +
        "/admin" +
        (req.path === "/" ? "" : req.originalUrl),
    );
  }
  next();
});
app.use((req, res, next) => {
  if (
    req.method === "GET" &&
    /\.(png|jpe?g|svg|gif|webp|ico|woff2?|ttf|css|js|map)$/i.test(req.path) &&
    !req.path.startsWith("/assets/") &&
    !req.path.startsWith("/files/") &&
    !req.path.startsWith("/swagger/")
  )
    return res.status(404).type("text/plain").send("资源不存在");
  next();
});
app.use(
  proxyTo("http://127.0.0.1:" + (process.env.CASDOOR_BACKEND_PORT || 5305)),
);
app.use((e: any, _req: any, res: any, _next: any) =>
  res
    .status(e.status || 500)
    .type("text/plain")
    .send(e.status === 404 ? "资源不存在" : "资源服务暂不可用"),
);
const server = app.listen(
  Number(process.env.CASDOOR_PORT || 5300),
  "127.0.0.1",
  () => console.log("身份网关已就绪"),
);
process.on("SIGTERM", () => server.close(() => process.exit(0)));
