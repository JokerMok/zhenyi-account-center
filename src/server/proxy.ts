import http from "node:http";
import https from "node:https";
import type { Request, Response, RequestHandler } from "express";
// Streaming reverse proxy: forwards the browser's own identity cookie; no administrative credential is added.
export function proxyTo(target: string, strip = ""): RequestHandler {
  return (req: Request, res: Response) => {
    const path = req.originalUrl.slice(strip.length) || "/";
    const url = new URL(path, target);
    if (
      !path.startsWith("/") ||
      path.includes("\\") ||
      url.origin !== new URL(target).origin
    ) {
      res.status(400).json({ error: "代理路径无效" });
      return;
    }
    const headers = { ...req.headers, host: url.host };
    if (strip) {
      const parts = String(req.headers.cookie || "")
        .split(";")
        .map((x) => x.trim());
      const native = parts
        .find((x) => x.startsWith("zy_identity_admin="))
        ?.slice("zy_identity_admin=".length);
      headers.cookie = native ? "casdoor_session_id=" + native : "";
    }
    delete headers["content-length"];
    if (req.headers["content-length"])
      headers["content-length"] = req.headers["content-length"];
    const client = url.protocol === "https:" ? https : http;
    const upstream = client.request(
      url,
      { method: req.method, headers },
      (incoming) => {
        res.status(incoming.statusCode || 502);
        for (const [key, value] of Object.entries(incoming.headers)) {
          if (
            value !== undefined &&
            ![
              "connection",
              "transfer-encoding",
              "content-security-policy",
              "cross-origin-resource-policy",
            ].includes(key)
          )
            res.setHeader(
              key,
              key === "set-cookie" && strip
                ? (Array.isArray(value) ? value : [value]).map(
                    (v) =>
                      v
                        .replace(/^casdoor_session_id=/, "zy_identity_admin=")
                        .replace(/;\s*Path=\/[^;]*/i, "; Path=/admin") +
                      (v.startsWith("casdoor_session_id=")
                        ? "; SameSite=Lax" +
                          (process.env.NODE_ENV === "production"
                            ? "; Secure"
                            : "")
                        : ""),
                  )
                : value,
            );
        }
        incoming.pipe(res);
      },
    );
    upstream.on("error", () => {
      if (!res.headersSent)
        res
          .status(502)
          .json({ error: "身份服务暂不可用", code: "IDENTITY_UNAVAILABLE" });
      else res.end();
    });
    req.pipe(upstream);
  };
}
