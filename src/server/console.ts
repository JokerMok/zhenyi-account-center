import type { Express } from "express";
import express from "express";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { proxyTo } from "./proxy";
import { config } from "./config";
const old: Record<string, string> = {
  console: "diagnostics",
  security: "account",
};
export function installConsole(app: Express) {
  app.use(
    "/admin/api",
    (req, res, next) => {
      if (
        !["GET", "HEAD"].includes(req.method) &&
        req.headers.origin !== new URL(config.CENTER_URL).origin
      )
        return res
          .status(403)
          .json({ error: "请求来源无效", code: "ORIGIN_REJECTED" });
      next();
    },
    async (req, res, next) => {
      // Native auth/bootstrap stays reachable before login. All management APIs require
      // the actual dedicated native administrator session, never a consumer cookie.
      const publicAuth = new Set([
        "/login",
        "/get-account",
        "/get-global-providers",
        "/get-application-login",
        "/get-application",
        "/get-organization",
        "/get-web-config",
        "/get-captcha",
        "/get-captcha-status",
        "/get-human-check",
        "/get-client-ip",
      ]);
      if (publicAuth.has(req.path)) return next();
      const value = String(req.headers.cookie || "")
        .split(";")
        .map((x) => x.trim())
        .find((x) => x.startsWith("zy_identity_admin="))
        ?.slice("zy_identity_admin=".length);
      if (!value)
        return res
          .status(401)
          .json({
            error: "请从 /admin 登录管理员",
            code: "ADMIN_LOGIN_REQUIRED",
          });
      try {
        const response = await fetch(
          "http://127.0.0.1:" +
            (process.env.CASDOOR_BACKEND_PORT || 5305) +
            "/api/get-account",
          {
            headers: { Cookie: "casdoor_session_id=" + value },
            signal: AbortSignal.timeout(8000),
          },
        );
        const body = (await response.json()) as any;
        if (!response.ok || body.status !== "ok" || !body.data)
          return res
            .status(401)
            .json({ error: "管理员登录已失效", code: "ADMIN_LOGIN_REQUIRED" });
        if (
          body.data.owner !== "built-in" ||
          !body.data.isAdmin ||
          body.data.id !== config.ADMIN_SUB
        )
          return res
            .status(403)
            .json({ error: "此身份没有管理员权限", code: "ADMIN_REQUIRED" });
        next();
      } catch {
        res
          .status(503)
          .json({ error: "身份服务暂不可用", code: "IDENTITY_UNAVAILABLE" });
      }
    },
    proxyTo(config.CASDOOR_URL, "/admin"),
  );
  for (const path of ["files", "swagger", ".well-known", "scim", "cas"])
    app.use("/admin/" + path, proxyTo(config.CASDOOR_URL, "/admin"));
  app.use(
    "/admin/assets",
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
  app.use(
    // Existing native objects retain /static URLs; this is an asset-only alias.
    ["/admin/static", "/static"],
    express.static(resolve(".local/native-static"), { fallthrough: true }),
    (_req, res) => res.status(404).type("text/plain").send("资源不存在"),
  );
  app.use("/admin", (req, res, next) => {
    if (req.method !== "GET") return next();
    if (req.path === "/" && typeof req.query.tab === "string") {
      const tab = req.query.tab;
      const q = new URLSearchParams(req.query as Record<string, string>);
      q.delete("tab");
      return res.redirect(
        "/admin/" +
          (old[tab] === "account"
            ? "account"
            : "business/" + (old[tab] || tab)) +
          (q.size ? "?" + q : ""),
      );
    }
    if (/\.(png|jpe?g|svg|gif|webp|ico|woff2?|ttf|css|js|map)$/i.test(req.path))
      return res.status(404).type("text/plain").send("资源不存在");
    readFile(resolve(".local/casdoor/web/build/index.html"), "utf8")
      .then((html) => {
        const escaped = JSON.stringify({
          staticBaseUrl: "/admin/static",
          forceLanguage: "zh",
          defaultLanguage: "zh",
          defaultApplication: "app-built-in",
          showGithubCorner: false,
        }).replaceAll('"', "&quot;");
        res.type("html").send(
          html
            .replace(
              "<head>",
              '<head><meta name="casdoor-base-path" content="/admin"><meta name="casdoor-web-config" content="' +
                escaped +
                '">',
            )
            .replaceAll('="/assets/', '="/admin/assets/')
            .replaceAll(
              "https://cdn.casbin.org/img/favicon.png",
              "/admin/static/img/favicon.png",
            )
            .replace(/<link rel="manifest"[^>]+>/, ""),
        );
      })
      .catch(next);
  });
}
