import express from "express";
import { appConfigs, config, productApps } from "./config";
import { proxyTo } from "./proxy";

// Choose the organization for a password submission. Casdoor still verifies
// the password and the authorization code stays bound to the original client.
export function consumerSignin(backend: string) {
  const router = express.Router();
  const apps = new Map(
    [appConfigs.center, ...productApps]
      .filter((app) => app.enabled)
      .map((app) => [app.clientId, app.application]),
  );
  const { clientId, secret } = appConfigs.admin;
  const authorization = `Basic ${Buffer.from(`${clientId}:${secret}`).toString("base64")}`;
  async function getUser(query: Record<string, string>) {
    const url = new URL("/api/get-user", backend);
    url.search = new URLSearchParams(query).toString();
    const response = await fetch(url, {
      headers: { Authorization: authorization },
      redirect: "error",
      signal: AbortSignal.timeout(2000),
    });
    const result = await response.json();
    if (!response.ok || result.status !== "ok") throw Error("身份查询失败");
    return result.data;
  }

  let ownerName: Promise<string | null> | undefined;
  let refreshAt = 0;
  function loadOwnerName() {
    if (ownerName && Date.now() < refreshAt) return ownerName;
    refreshAt = Date.now() + 30_000;
    ownerName = getUser({ owner: "built-in", userId: config.ADMIN_SUB })
      .then((user) =>
        user?.id === config.ADMIN_SUB &&
        user.owner === "built-in" &&
        typeof user.name === "string" &&
        user.isAdmin === true &&
        !user.isForbidden &&
        !user.isDeleted
          ? user.name
          : null,
      )
      .catch(() => {
        // A lookup outage must not prevent ordinary consumers from signing in.
        refreshAt = Date.now() + 5_000;
        return null;
      });
    return ownerName;
  }

  // Other protocols, credential methods and large requests (e.g. Face ID)
  // keep the original streaming proxy behavior.
  router.post(
    "/api/login",
    (req, _res, next) => {
      const length = Number(req.get("Content-Length"));
      if (
        req.query.responseType !== "code" ||
        typeof req.query.clientId !== "string" ||
        !apps.has(req.query.clientId) ||
        !req.is("application/json") ||
        (req.get("Content-Encoding") ?? "identity") !== "identity" ||
        !(length > 0 && length <= 32 * 1024)
      )
        return next("route");
      next();
    },
    express.raw({ type: "application/json", limit: "32kb", inflate: false }),
    proxyTo(backend, "", async (req) => {
      const body = req.body as Buffer;
      try {
        const form = JSON.parse(body.toString("utf8"));
        if (
          form?.type !== "code" ||
          form.organization !== "consumers" ||
          form.signinMethod !== "Password" ||
          form.application !== apps.get(String(req.query.clientId)) ||
          typeof form.password !== "string" ||
          !form.password ||
          typeof form.username !== "string"
        )
          return body;
        const name = form.username.trim();
        if (
          !/^[a-zA-Z][a-zA-Z0-9_-]{1,39}$/.test(name) ||
          name !== (await loadOwnerName())
        )
          return body;
        // An existing consumer of the same name keeps their normal login.
        if (await getUser({ id: `consumers/${name}` })) return body;
        return Buffer.from(
          JSON.stringify({ ...form, username: name, organization: "built-in" }),
        );
      } catch {
        return body;
      }
    }),
  );
  return router;
}
