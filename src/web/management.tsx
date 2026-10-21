import React, { useEffect, useState } from "react";
import modules from "../../config/casdoor-modules.json";
type Any = Record<string, any>;
export function NativeNavigation({ url }: { url: string }) {
  return (
    <div className="native-navigation">
      <p>Casdoor 完整管理</p>
      {[...new Set(modules.map((m) => m.group))].map((group) => (
        <details key={group}>
          <summary>{group}</summary>
          {modules
            .filter((m) => m.group === group)
            .map((m) => (
              <a key={m.id} href={url + m.path}>
                {m.label}
              </a>
            ))}
        </details>
      ))}
    </div>
  );
}
export function CompleteManagement({
  request,
  casdoor,
}: {
  request: (p: string) => Promise<any>;
  casdoor: string;
}) {
  const [data, setData] = useState<Any | null>(null),
    [error, setError] = useState(""),
    [version, setVersion] = useState(0);
  useEffect(() => {
    let active = true;
    setData(null);
    setError("");
    request("/api/admin/management")
      .then((x) => {
        if (active) setData(x);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [version]);
  return (
    <>
      <h1>完整管理与配置状态</h1>
      <p>
        身份、组织、认证协议和商业记录由 Casdoor
        管理；产品权益、次数与任务恢复由公共权益服务管理。
      </p>
      <section className="panel">
        <h2>Casdoor v4.22.0</h2>
        <p>
          全部原生页面与操作保留。配置已保存、接口可读和实际业务验证是不同的状态。
        </p>
        <a className="button primary" href={casdoor + "/"}>
          进入原生管理工作区
        </a>{" "}
        <button onClick={() => setVersion((v) => v + 1)}>刷新配置状态</button>
        {data && (
          <p className="muted">
            当前运行版本：
            {data.version?.version || JSON.stringify(data.version)}
          </p>
        )}
      </section>
      {error && (
        <div role="alert" className="message error">
          {error}
          <button onClick={() => setVersion((v) => v + 1)}>重试</button>
        </div>
      )}
      {!data && !error && <p role="status">正在检查原生接口与服务配置…</p>}
      {data && (
        <>
          <section className="panel">
            <h2>外部服务</h2>
            {Object.entries(data.services).map(([k, v]: any) => (
              <div className="setting-line" key={k}>
                <div>
                  <strong>
                    {
                      (
                        {
                          sms: "短信",
                          email: "邮件",
                          wechat: "微信登录",
                          payments: "真实支付",
                        } as Any
                      )[k]
                    }
                  </strong>
                  <p>
                    {v.status}。{v.missing.join("；")}
                  </p>
                  {v.providers.map((p: any) => (
                    <small key={p.name}>
                      {p.name}（{p.type}）{" "}
                    </small>
                  ))}
                </div>
                <a href={casdoor + "/providers"}>配置与验证</a>
              </div>
            ))}
          </section>
          {[...new Set(modules.map((m) => m.group))].map((group) => (
            <section className="panel" key={group}>
              <h2>{group}</h2>
              {data.modules
                .filter((m: any) => m.group === group)
                .map((m: any) => (
                  <div className="setting-line" key={m.id}>
                    <div>
                      <a href={casdoor + m.path}>
                        <strong>{m.label}</strong>
                      </a>
                      <p>
                        {m.status}{" "}
                        {m.api_status === "ok" ? "· 原生读取接口已响应" : ""}
                      </p>
                      <small>
                        {m.detail || m.verification}{" "}
                        {m.dependencies && "；依赖：" + m.dependencies}
                      </small>
                      {m.checked_at && (
                        <small>
                          验证时间：
                          {new Date(m.checked_at).toLocaleString("zh-CN")}
                        </small>
                      )}
                    </div>
                    <a className="button" href={casdoor + m.path}>
                      进入配置
                    </a>
                  </div>
                ))}
            </section>
          ))}
          <section className="panel">
            <h2>认证、协议与其他能力</h2>
            {data.capabilities.map((m: any) => (
              <div className="setting-line" key={m.id}>
                <div>
                  <strong>{m.label}</strong>
                  <p>{m.status || "已配置，尚未验证"}</p>
                  <small>
                    {m.detail || m.note || "参见本轮专项验收"}{" "}
                    {m.dependencies && "；依赖：" + m.dependencies}
                  </small>
                </div>
                {m.status !== "该固定版本不包含" && (
                  <a className="button" href={casdoor + m.path}>
                    配置入口
                  </a>
                )}
              </div>
            ))}
          </section>
        </>
      )}
    </>
  );
}
export function TaskTrace({
  request,
}: {
  request: (p: string) => Promise<any>;
}) {
  const [q, setQ] = useState(
      new URLSearchParams(location.search).get("request") || "",
    ),
    [data, setData] = useState<any[] | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function load() {
    setBusy(true);
    setError("");
    try {
      setData(await request("/api/admin/tasks?q=" + encodeURIComponent(q)));
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  const status: Any = {
    reserved: "额度预占中",
    confirmed: "消费已确认",
    cancelled: "预占已释放",
    refunded: "消费已返还",
    expired: "预占超时释放",
    complete: "任务已完成",
    delivered: "已交付",
    unknown: "业务交付结果未知",
    not_delivered: "任务已结束，未交付",
    pending_recovery: "待核实或恢复",
    pending: "待恢复",
    awaiting_confirmation: "等待确认结果",
  };
  return (
    <>
      <h1>消费与任务恢复</h1>
      <p>
        按原业务请求号或预占ID追溯扣次与恢复。消费已确认不代表业务已经交付。
      </p>
      <form
        className="panel"
        onSubmit={(e) => {
          e.preventDefault();
          load();
        }}
      >
        <label className="field">
          <span>业务请求号 / 预占ID</span>
          <input
            required
            minLength={8}
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </label>
        <button disabled={busy}>{busy ? "正在查询…" : "查询完整过程"}</button>
      </form>
      {error && (
        <p role="alert">
          {error}
          <button onClick={load}>重试</button>
        </p>
      )}
      {data?.length === 0 && (
        <div className="empty">未找到记录，请核对完整请求号或预占ID。</div>
      )}
      {data?.map((t) => (
        <section className="panel" key={t.id}>
          <h2>
            {t.product_name} · {t.display_name}
          </h2>
          <p>请求号：{t.request_id}</p>
          <p>预占ID：{t.id}</p>
          <p>
            账目状态：<strong>{status[t.status] || t.status}</strong> ·{" "}
            {t.amount} 次
          </p>
          <p>
            业务状态：
            <strong>{status[t.delivery.stage] || "业务交付结果未知"}</strong>
          </p>
          <p className="muted">
            中心不代替产品判断任务是否成功；未知结果需由产品后端查询实际任务后决定交付或返还。
          </p>
          <h3>额度过程</h3>
          {t.ledger.map((l: any) => (
            <p key={l.id}>
              {new Date(l.created_at).toLocaleString("zh-CN")} ·{" "}
              {(
                {
                  reserve: "预占额度",
                  confirmed: "确认消费",
                  cancelled: "释放预占",
                  refunded: "返还消费",
                  expired: "超时释放",
                } as Any
              )[l.action] || l.action}{" "}
              · {l.amount} 次余额变动
            </p>
          ))}
          <h3>产品后端恢复审计</h3>
          {t.recovery.length ? (
            t.recovery.map((r: any) => (
              <p key={r.id}>
                {new Date(r.created_at).toLocaleString("zh-CN")} ·{" "}
                {r.action === "refund" ? "返还" : "释放"} · {r.reason}
              </p>
            ))
          ) : (
            <p>暂无恢复操作。</p>
          )}
        </section>
      ))}
    </>
  );
}
export function QuotaSources({ feature }: { feature: Any }) {
  const names: Any = {
    free: "免费",
    admin: "管理员赠送",
    redeem: "兑换",
    redemption: "兑换",
    subscription: "订阅",
  };
  return (
    <details className="quota-sources">
      <summary>
        次数明细：可用 {feature.remaining} 次 · 预占 {feature.held} 次
      </summary>
      {feature.next_free_reset_at && (
        <p>
          免费次数下次重置：
          {new Date(feature.next_free_reset_at).toLocaleString("zh-CN", {
            timeZone: "Asia/Shanghai",
            hour12: false,
          })}
          （北京时间；按UTC周期计算）
        </p>
      )}
      {feature.buckets?.length ? (
        feature.buckets.map((b: any) => (
          <p key={b.id}>
            {names[b.source] || b.source}：剩余 {b.remaining}，预占 {b.held}；
            {b.expired
              ? "已过期，不计入可用余额"
              : b.expires_at
                ? "到期 " +
                  new Date(b.expires_at).toLocaleString("zh-CN", {
                    timeZone: "Asia/Shanghai",
                  })
                : "不过期"}
          </p>
        ))
      ) : (
        <p>暂无已发放次数。</p>
      )}
    </details>
  );
}
export function Offers({ request }: { request: (p: string) => Promise<any> }) {
  const [data, setData] = useState<Any[] | null>(null),
    [err, setErr] = useState("");
  useEffect(() => {
    let alive = true;
    request("/api/offers")
      .then((x) => {
        if (alive) setData(x);
      })
      .catch((e) => {
        if (alive) setErr(e.message);
      });
    return () => {
      alive = false;
    };
  }, []);
  return (
    <section className="panel">
      <h2>会员套餐与购买</h2>
      {err ? (
        <p role="alert">套餐加载失败，请刷新重试。</p>
      ) : !data ? (
        <p>正在加载套餐…</p>
      ) : !data.length ? (
        <p>尚无开放购买的套餐。可使用权益兑换码；真实支付尚未启用。</p>
      ) : (
        data.map((p: any) => (
          <div className="setting-line" key={p.pricing + p.name}>
            <div>
              <strong>{p.name}</strong>
              <p>
                {p.price} {p.currency} · {p.status}
              </p>
            </div>
            {p.available ? (
              <a className="button primary" href={p.url}>
                进入本机测试购买
              </a>
            ) : (
              <span>尚未开放购买</span>
            )}
          </div>
        ))
      )}
    </section>
  );
}
