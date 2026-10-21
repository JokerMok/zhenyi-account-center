import modules from "../../config/casdoor-modules.json";
import capabilities from "../../config/casdoor-capabilities.json";
import { casdoorApi } from "./casdoor";
import { pool, tx, assert } from "./db";
import { config, appConfigs, productApps } from "./config";
import { audit } from "./entitlements";

export { modules };
export async function serviceReadiness() {
  const all = (await casdoorApi("get-providers", { owner: "admin" })).concat(
    await casdoorApi("get-providers", { owner: "consumers" }),
  );
  const providers = [
    ...new Map(all.map((p: any) => [p.owner + "/" + p.name, p])).values(),
  ] as any[];
  const categories: Record<string, string[]> = {
    sms: ["SMS"],
    email: ["Email"],
    wechat: ["OAuth"],
    payments: ["Payment"],
  };
  const result: any = {};
  for (const [key, cats] of Object.entries(categories)) {
    const found = providers.filter(
      (p: any) =>
        cats.includes(p.category) &&
        (key !== "wechat" || /WeChat/i.test(p.type)) &&
        !["Dummy", "Balance"].includes(p.type),
    );
    const incomplete = found.flatMap((p: any) =>
      p.category === "Email" && p.type === "Default"
        ? [
            !p.host ? "SMTP主机" : "",
            !p.port ? "SMTP端口" : "",
            !p.clientId ? "SMTP账号／发信地址" : "",
            !p.clientSecret ? "SMTP授权信息" : "",
          ].filter(Boolean)
        : !p.clientId || !p.clientSecret
          ? ["服务商应用ID与密钥需要检查"]
          : [],
    );
    result[key] = {
      status: !found.length
        ? "未配置"
        : incomplete.length
          ? "配置不完整"
          : "已保存配置，尚未验证",
      count: found.length,
      missing: found.length
        ? incomplete
        : [
            key === "email"
              ? "邮件服务、发信地址与授权信息"
              : key === "sms"
                ? "短信服务、签名及模板"
                : key === "wechat"
                  ? "微信应用ID、密钥及回调白名单"
                  : "真实商户及通知配置",
          ],
      providers: found.map((p: any) => ({ name: p.name, type: p.type })),
    };
  }
  return result;
}
export async function managementState(accessToken: string) {
  const checks = (await pool.query("SELECT * FROM capability_checks")).rows;
  const trusted = await casdoorApi("get-user", {
    owner: "built-in",
    userId: config.ADMIN_SUB,
  });
  const out = [];
  for (const m of modules) {
    if (!m.endpoint) {
      out.push({
        ...m,
        ...checks.find((c) => c.id === m.id),
        configuration: "原生页面保留；参见操作验收记录",
      });
      continue;
    }
    try {
      const data = await casdoorApi(
        m.endpoint,
        {
          owner:
            m.endpoint === "get-organizations" ||
            m.endpoint === "get-applications" ||
            m.endpoint === "get-providers"
              ? "admin"
              : "consumers",
          userName: trusted.name,
          ...(m.id === "cart" ? { id: "built-in/" + trusted.name } : {}),
        },
        undefined,
        accessToken,
      );
      const check = checks.find((c) => c.id === m.id);
      const wait =
        !!m.dependencies &&
        ![
          "applications",
          "enforcers",
          "adapters",
          "cart",
          "product-store",
          "marketplace",
        ].includes(m.id);
      out.push({
        ...m,
        api_status: "ok",
        count: Array.isArray(data) ? data.length : undefined,
        ...check,
        ...(wait ? { status: "已集成，等待外部配置" } : {}),
      });
    } catch (e: any) {
      out.push({
        ...m,
        api_status: "error",
        status: "验证失败",
        verification:
          "原生读取失败，请检查管理员会话与身份服务；可进入原生页面查看具体原因",
      });
    }
  }
  return {
    version: await casdoorApi("get-version-info"),
    modules: out,
    capabilities: capabilities.map((m: any) => ({
      ...m,
      ...checks.find((c) => c.id === m.id),
      ...(m.pending ? { status: m.pending } : {}),
    })),
    services: await serviceReadiness(),
    dataOwnership: {
      identity: "Casdoor",
      commerce: "Casdoor",
      entitlements: "公共权益服务",
    },
  };
}
export async function checkProduct(id: string, actor: string) {
  const p = (await pool.query("SELECT * FROM products WHERE id=$1", [id]))
    .rows[0];
  assert(p, 404, "PRODUCT_NOT_FOUND", "产品不存在");
  const a = productApps.find((x) => x.id === id);
  const missing: string[] = [];
  if (!a) missing.push("尚未登记产品后端鉴权配置");
  else {
    if (!a.enabled) missing.push("产品后端鉴权已停用");
    if (!a.serviceKey) missing.push("缺少独立调用凭据");
    if (a.application !== p.application)
      missing.push("应用名称与鉴权登记不一致");
    if (a.url + "/auth/callback/" + id !== p.callback_url)
      missing.push("登录回调与鉴权登记不一致");
  }
  const native = await casdoorApi("get-application", {
    id: "admin/" + p.application,
  });
  if (!native) missing.push("Casdoor应用不存在");
  else {
    if (a && native.clientId !== a.clientId)
      missing.push("Casdoor client ID 不一致");
    if (!(native.redirectUris || []).includes(p.callback_url))
      missing.push("Casdoor回调白名单缺少当前地址");
  }
  const result = {
    passed: missing.length === 0,
    missing,
    checked_at: new Date().toISOString(),
    environment: config.production ? "部署环境" : "本机",
    note: "只检查配置一致性；不等于真实产品登录、消费和恢复验收通过",
  };
  await pool.query(
    "INSERT INTO integration_checks(product_id,actor_uid,result) VALUES($1,$2,$3)",
    [id, actor, result],
  );
  return result;
}
export async function taskTrace(q: string) {
  assert(
    q.length >= 8 && q.length <= 128,
    400,
    "INVALID_TASK_QUERY",
    "请输入完整业务请求号或预占ID",
  );
  const tasks = (
    await pool.query(
      "SELECT r.*,i.username,i.display_name,p.name AS product_name FROM reservations r JOIN identities i ON i.uid=r.uid JOIN products p ON p.id=r.product_id WHERE r.request_id=$1 OR r.id::text=$1 OR EXISTS(SELECT 1 FROM demo_jobs j WHERE j.reservation_id=r.id AND j.request_id=$1) ORDER BY r.created_at DESC",
      [q],
    )
  ).rows;
  for (const t of tasks) {
    t.ledger = (
      await pool.query("SELECT * FROM ledger WHERE reference=$1 ORDER BY id", [
        t.id,
      ])
    ).rows;
    t.recovery = (
      await pool.query(
        "SELECT * FROM task_recovery_audit WHERE reservation_id=$1 ORDER BY id",
        [t.id],
      )
    ).rows;
    const jobs = (
      await pool.query(
        "SELECT stage,result,updated_at FROM demo_jobs WHERE app_id=$1 AND uid=$2 AND (reservation_id=$3::uuid OR request_id=$4)",
        [t.product_id, t.uid, t.id, t.request_id],
      )
    ).rows;
    t.delivery = jobs.length
      ? {
          ...jobs[0],
          stage:
            jobs[0].stage === "complete"
              ? jobs[0].result?.ok === true
                ? "delivered"
                : jobs[0].result?.status &&
                    ["cancelled", "expired", "refunded"].includes(
                      jobs[0].result.status,
                    )
                  ? "not_delivered"
                  : "unknown"
              : "pending_recovery",
        }
      : {
          stage: "unknown",
          description: "中心只有扣次记录，未收到产品业务交付结果",
        };
  }
  return tasks;
}
export async function setTestFlag(
  uid: string,
  isTest: boolean,
  note: string,
  actor: string,
) {
  return tx(async (db) => {
    const before = (
      await db.query(
        "SELECT uid,is_test,test_note FROM identities WHERE uid=$1 FOR UPDATE",
        [uid],
      )
    ).rows[0];
    assert(before, 404, "USER_NOT_FOUND", "用户不存在");
    const after = (
      await db.query(
        "UPDATE identities SET is_test=$2,test_note=$3 WHERE uid=$1 RETURNING uid,is_test,test_note",
        [uid, isTest, note],
      )
    ).rows[0];
    await audit(db, actor, "test_flag", uid, note, before, after);
    return after;
  });
}
