import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { Express, Request, Response, NextFunction } from "express";
import { pool, assert, Fault } from "./db";
import {
  consumerTarget,
  consumerTabs,
  flowCookieSuffix,
  escapeHtml,
} from "./consumer-context";
import { config, appConfigs, productApps, type AppId } from "./config";
import {
  discovery,
  verifyToken,
  identityFromToken,
  upstreamLogout,
} from "./casdoor";

const random = () => randomBytes(32).toString("base64url");
export const hash = (s: string) => createHash("sha256").update(s).digest("hex");
export type Authenticated = Request & {
  identity?: any;
  session?: any;
  serviceProduct?: string;
};
const cookie = (name: string) =>
  `${config.production ? "__Host-" : ""}zy_${name}`;
const cookieOptions = {
  httpOnly: true,
  secure: config.production,
  sameSite: "lax" as const,
  path: "/",
};
export function equal(a: string, b: string) {
  const aa = Buffer.from(a),
    bb = Buffer.from(b);
  return aa.length === bb.length && timingSafeEqual(aa, bb);
}
export function csrf(appId: AppId) {
  return (req: Authenticated, _res: Response, next: NextFunction) => {
    if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
    try {
      assert(
        req.headers.origin === new URL(appConfigs[appId].url).origin,
        403,
        "ORIGIN_REJECTED",
        "请求来源无效，请从当前产品页面操作",
      );
      assert(
        req.session &&
          equal(String(req.headers["x-csrf-token"] || ""), req.session.csrf),
        403,
        "CSRF_REJECTED",
        "安全校验失败，请刷新后重试",
      );
      next();
    } catch (e) {
      next(e);
    }
  };
}
export function sessionAuth(appId: AppId) {
  return async (req: Authenticated, _res: Response, next: NextFunction) => {
    try {
      const token = req.cookies[cookie(appId)];
      assert(token, 401, "LOGIN_REQUIRED", "请先登录");
      const session = (
        await pool.query(
          "SELECT * FROM sessions WHERE token_hash=$1 AND app_id=$2 AND expires_at>now()",
          [hash(token), appId],
        )
      ).rows[0];
      assert(session, 401, "LOGIN_REQUIRED", "登录已失效，请重新登录");
      const identity = await identityFromToken(session.access_token, appId);
      assert(
        identity.uid === session.uid,
        401,
        "SESSION_MISMATCH",
        "登录身份发生变化，请重新登录",
      );
      req.identity = identity;
      req.session = session;
      next();
    } catch (e) {
      next(e);
    }
  };
}
// Optional session lookup: invalid sessions do not trigger silent retries.
async function consumerSession(req: Request) {
  const token = req.cookies[cookie("center")];
  if (!token) return null;
  const row = (
    await pool.query(
      "SELECT * FROM sessions WHERE token_hash=$1 AND app_id='center' AND expires_at>now()",
      [hash(token)],
    )
  ).rows[0];
  if (!row) return null;
  try {
    const identity = await identityFromToken(row.access_token, "center");
    return identity.uid === row.uid ? identity : null;
  } catch (e) {
    if (e instanceof Fault && e.status === 401) return null;
    throw e;
  }
}
async function entryContext(value: unknown) {
  assert(
    typeof value === "string" && /^[A-Za-z0-9_-]{43}$/.test(value),
    400,
    "INVALID_ENTRY",
    "进入链接无效，请从产品重新打开",
  );
  const row = (
    await pool.query(
      "SELECT mode FROM login_attempts WHERE token_hash=$1 AND app_id='consumer-entry' AND expires_at>now()",
      [hash(value)],
    )
  ).rows[0];
  assert(row, 410, "ENTRY_EXPIRED", "进入链接已过期，请返回产品重新打开");
  return JSON.parse(row.mode);
}
function mismatch(res: Response, retry: string, back: string) {
  res
    .status(409)
    .type("html")
    .send(
      `<!doctype html><html lang="zh"><meta charset="utf-8"><title>账号不一致</title><body><h1>产品与个人中心的账号不一致</h1><p>为防止将权益或操作归到另一账号，本次已停止。原有作品和会话未被合并。</p><a href="${escapeHtml(retry)}">使用产品账号重新验证</a> · <a href="${escapeHtml(back)}">返回产品</a></body></html>`,
    );
}
export function installConsumerEntry(app: Express) {
  app.post(
    "/api/v1/products/:product/consumer-entry",
    serviceAuth,
    async (req: Authenticated, res) => {
      const tab = req.body?.tab;
      assert(
        Object.keys(req.body || {}).length === 1 && consumerTabs.includes(tab),
        400,
        "INVALID_TARGET",
        "个人中心目标无效",
      );
      const target = consumerTarget(
        { product: req.serviceProduct, tab, account: req.identity.uid },
        appConfigs,
      );
      const context = random();
      // An opaque navigation reference cannot create a session: a normal center OIDC exchange is still required.
      await pool.query(
        "INSERT INTO login_attempts VALUES($1,'consumer-entry','','','',$2,now()+interval '10 minutes')",
        [hash(context), JSON.stringify(target)],
      );
      res.json({
        url: config.CENTER_URL + "/auth/consumer?context=" + context,
      });
    },
  );
  app.get("/auth/consumer", async (req, res) => {
    const target = await entryContext(req.query.context);
    res.locals.loginRetry =
      "/auth/consumer?context=" + encodeURIComponent(String(req.query.context));
    const current = await consumerSession(req);
    if (!current)
      return res.redirect(
        "/auth/login?context=" + encodeURIComponent(String(req.query.context)),
      );
    if (current.uid !== target.account)
      return mismatch(
        res,
        "/auth/login?switch=1&context=" +
          encodeURIComponent(String(req.query.context)),
        appConfigs[target.product].url,
      );
    res.redirect(target.path);
  });
  // Explicit consumer deep links authorize once. A logout goes to bare /, which stays logged out.
  app.get("/", async (req, res, next) => {
    if (!req.query.product && !req.query.tab && !req.query.account)
      return next();
    let target;
    try {
      target = consumerTarget(req.query, appConfigs);
    } catch {
      throw new Fault(
        400,
        "INVALID_TARGET",
        "个人中心目标无效，请从产品重新进入",
      );
    }
    const current = await consumerSession(req);
    const query = new URLSearchParams({
      product: target.product,
      tab: target.tab,
      ...(target.account ? { account: target.account } : {}),
    });
    if (!current) return res.redirect("/auth/login?" + query);
    if (target.account && current.uid !== target.account)
      return mismatch(
        res,
        "/auth/login?switch=1&" + query,
        appConfigs[target.product]?.url || "/",
      );
    next();
  });
}
export function installAuth(app: Express, serverId: string) {
  app.get("/auth/login", async (req, res) => {
    const appId: AppId =
      serverId === "center" && req.query.mode === "admin" ? "admin" : serverId;
    const a = appConfigs[appId],
      d = await discovery(appId);
    let target =
      appId === "admin"
        ? null
        : req.query.context
          ? await entryContext(req.query.context)
          : consumerTarget(
              {
                ...req.query,
                account:
                  req.query.account === "1"
                    ? req.query.expected
                    : req.query.account,
              },
              appConfigs,
            );
    const current =
      appId === "center" && req.query.account === "1"
        ? await consumerSession(req)
        : null;
    if (current && target && !target.account)
      target = consumerTarget({ ...target, account: current.uid }, appConfigs);
    const retry = new URLSearchParams();
    if (target) {
      if (target.product) retry.set("product", target.product);
      retry.set("tab", target.tab);
      if (target.account) retry.set("account", target.account);
    }
    if (appId === "admin") retry.set("mode", "admin");
    res.locals.loginRetry = "/auth/login?" + retry;
    const attempt = random(),
      state = random(),
      nonce = random(),
      verifier = random();
    await pool.query(
      "DELETE FROM login_attempts WHERE expires_at<now()-interval '1 day'",
    );
    await pool.query(
      "INSERT INTO login_attempts VALUES($1,$2,$3,$4,$5,$6,now()+interval '10 minutes')",
      [
        hash(attempt),
        appId,
        state,
        nonce,
        verifier,
        JSON.stringify({
          kind:
            req.query.account === "1"
              ? "account"
              : appId === "admin"
                ? "admin"
                : "user",
          target,
          expectedUid: target?.account || current?.uid || null,
          retry: res.locals.loginRetry,
          next:
            appId === "admin" &&
            typeof req.query.next === "string" &&
            /^\/admin(?:\/|\?|$)/.test(req.query.next) &&
            !/[\\\r\n]/.test(req.query.next)
              ? req.query.next
              : null,
        }),
      ],
    );
    res.cookie(cookie(flowCookieSuffix(appId, state)), attempt, {
      ...cookieOptions,
      maxAge: 600000,
    });
    const u = new URL(
      appId === "admin"
        ? appConfigs.admin.url + "/admin/login/oauth/authorize"
        : d.authorization_endpoint,
    );
    const callback = a.url + `/auth/callback/${appId}`;
    const params = {
      client_id: a.clientId,
      redirect_uri: callback,
      response_type: "code",
      scope: "openid profile email",
      state,
      nonce,
      code_challenge: createHash("sha256").update(verifier).digest("base64url"),
      code_challenge_method: "S256",
    };
    Object.entries(params).forEach(([k, v]) => u.searchParams.set(k, v));
    if (req.query.switch === "1") u.searchParams.set("prompt", "login");
    res.redirect(u.href);
  });
  app.get("/auth/callback/:id", async (req, res) => {
    const appId = req.params.id as AppId;
    assert(
      appId === serverId || (serverId === "center" && appId === "admin"),
      400,
      "INVALID_APP",
      "回调应用无效",
    );
    const a = appConfigs[appId];
    const callbackState =
      typeof req.query.state === "string" ? req.query.state : "";
    const loginCookie = cookie(flowCookieSuffix(appId, callbackState));
    const attempt = req.cookies[loginCookie];
    if (!attempt && callbackState) {
      const old = (
        await pool.query(
          "SELECT mode FROM login_attempts WHERE app_id=$1 AND state=$2",
          [appId, callbackState],
        )
      ).rows[0];
      try {
        res.locals.loginRetry = JSON.parse(old?.mode || "{}").retry;
      } catch {}
    }
    assert(attempt, 401, "MISSING_LOGIN", "登录会话缺失，请重新开始");
    const row = (
      await pool.query(
        "DELETE FROM login_attempts WHERE token_hash=$1 AND app_id=$2 RETURNING *",
        [hash(attempt), appId],
      )
    ).rows[0];
    res.clearCookie(loginCookie, cookieOptions);
    const savedMode = row?.mode.startsWith("{")
      ? JSON.parse(row.mode)
      : { kind: row?.mode };
    res.locals.loginRetry =
      savedMode.retry ||
      (appId === "admin" ? "/auth/login?mode=admin" : "/auth/login");
    assert(
      row &&
        new Date(row.expires_at).getTime() > Date.now() &&
        typeof req.query.state === "string" &&
        equal(req.query.state, row.state),
      401,
      "INVALID_STATE",
      "登录 state 校验失败，请重新登录",
    );
    assert(
      !req.query.error && typeof req.query.code === "string",
      401,
      "LOGIN_DENIED",
      "登录未完成，请重试",
    );
    if (req.query.iss)
      assert(
        req.query.iss === config.CASDOOR_URL,
        401,
        "INVALID_ISSUER",
        "回调 issuer 校验失败",
      );
    const d = await discovery(appId);
    const resp = await fetch(d.token_endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: a.clientId,
        client_secret: a.secret,
        code: req.query.code,
        redirect_uri: a.url + `/auth/callback/${appId}`,
        code_verifier: row.verifier,
      }),
      signal: AbortSignal.timeout(8000),
    });
    const t = (await resp.json()) as any;
    assert(
      resp.ok &&
        typeof t.id_token === "string" &&
        typeof t.access_token === "string",
      401,
      "TOKEN_EXCHANGE_FAILED",
      "授权码兑换失败，请重新登录",
    );
    const payload = await verifyToken(t.id_token, appId, row.nonce);
    const access = await verifyToken(t.access_token, appId);
    assert(
      payload.sub === access.sub,
      401,
      "TOKEN_SUBJECT_MISMATCH",
      "两种令牌的身份不一致",
    );
    const identity = await identityFromToken(t.access_token, appId, access);
    if (savedMode.expectedUid && identity.uid !== savedMode.expectedUid)
      return mismatch(
        res,
        res.locals.loginRetry + "&switch=1",
        appConfigs[savedMode.target?.product]?.url || "/",
      );
    // Rotate rather than reuse a pre-login session, and never merge data from another identity.
    const previous = req.cookies[cookie(appId)];
    if (previous)
      await pool.query(
        "DELETE FROM sessions WHERE token_hash=$1 AND app_id=$2",
        [hash(previous), appId],
      );
    const token = random(),
      csrfToken = random();
    const expiry = new Date(
      Math.min(Number(access.exp) * 1000, Date.now() + 8 * 3600000),
    );
    await pool.query(
      "INSERT INTO sessions(token_hash,app_id,uid,access_token,id_token,csrf,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7)",
      [
        hash(token),
        appId,
        identity.uid,
        t.access_token,
        t.id_token,
        csrfToken,
        expiry,
      ],
    );
    res.cookie(cookie(appId), token, { ...cookieOptions, expires: expiry });
    res.redirect(
      savedMode.kind === "account"
        ? config.CASDOOR_URL +
            "/account" +
            (savedMode.target?.path?.startsWith("/?")
              ? savedMode.target.path.slice(1)
              : "")
        : appId === "admin"
          ? savedMode.next || "/admin"
          : savedMode.target?.path || "/",
    );
  });
  for (const appId of (serverId === "center"
    ? ["center", "admin"]
    : [serverId]) as AppId[]) {
    const prefix = appId === "admin" ? "/api/admin" : "/api";
    app.post(
      prefix + "/logout",
      sessionAuth(appId),
      csrf(appId),
      async (req: Authenticated, res) => {
        await pool.query("DELETE FROM sessions WHERE token_hash=$1", [
          req.session.token_hash,
        ]);
        res.clearCookie(cookie(appId), cookieOptions);
        res.json({ ok: true });
      },
    );
    app.post(
      prefix + "/logout-all",
      sessionAuth(appId),
      csrf(appId),
      async (req: Authenticated, res) => {
        if (appId !== "center" && appId !== "admin") {
          const r = await fetch(
            `${config.CENTER_URL}/api/v1/products/${appId}/logout-all`,
            {
              method: "POST",
              headers: {
                Authorization: `Bearer ${appConfigs[appId].serviceKey}`,
                "X-User-Token": req.session.access_token,
                "Content-Type": "application/json",
              },
              body: "{}",
              signal: AbortSignal.timeout(15000),
            },
          );
          const result = (await r.json()) as any;
          res.clearCookie(cookie(appId), cookieOptions);
          assert(
            r.ok,
            r.status,
            result.code || "GLOBAL_LOGOUT_FAILED",
            result.error || "全局退出失败",
          );
          res.json(result);
          return;
        }
        // Delete local sessions even if the upstream call fails; report upstream failure accurately.
        await pool.query("DELETE FROM sessions WHERE uid=$1", [
          req.identity.uid,
        ]);
        res.clearCookie(cookie(appId), cookieOptions);
        await upstreamLogout(req.session.access_token);
        res.json({ ok: true, scope: "all-products-and-casdoor" });
      },
    );
  }
}
export async function productBackendAuth(
  req: Authenticated,
  _res: Response,
  next: NextFunction,
) {
  try {
    const auth = req.headers.authorization || "";
    assert(
      auth.startsWith("Bearer "),
      401,
      "PRODUCT_AUTH_REQUIRED",
      "需要产品后端凭据",
    );
    const key = auth.slice(7);
    const appId = productApps.find(
      (a) => a.enabled && a.serviceKey.length >= 32 && equal(key, a.serviceKey),
    )?.id;
    assert(appId, 401, "INVALID_PRODUCT_CREDENTIAL", "产品凭据无效");
    assert(
      !req.body?.uid &&
        !req.body?.user_id &&
        !req.query.user_id &&
        !req.query.uid,
      400,
      "USER_ID_NOT_ALLOWED",
      "用户身份必须来自当前产品的可信令牌",
    );
    assert(
      !req.body?.product_id || req.body.product_id === appId,
      403,
      "CROSS_PRODUCT",
      "产品凭据不能操作其他产品",
    );
    if (req.params.product)
      assert(
        req.params.product === appId,
        403,
        "CROSS_PRODUCT",
        "产品凭据不能操作其他产品",
      );
    req.serviceProduct = appId;
    next();
  } catch (e) {
    next(e);
  }
}
export async function serviceAuth(
  req: Authenticated,
  res: Response,
  next: NextFunction,
) {
  await productBackendAuth(req, res, async (error?: any) => {
    if (error) return next(error);
    try {
      const token = String(req.headers["x-user-token"] || "");
      assert(token, 401, "USER_TOKEN_REQUIRED", "需要当前用户的访问令牌");
      req.identity = await identityFromToken(token, req.serviceProduct!);
      next();
    } catch (e) {
      next(e);
    }
  });
}
