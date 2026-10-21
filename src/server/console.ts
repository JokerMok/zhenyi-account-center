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
    "/admin/static",
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
