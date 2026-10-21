import React, {
  useEffect,
  useState,
  useRef,
  useId,
  type FormEvent,
} from "react";
import {
  LayoutGrid,
  UserRound,
  Ticket,
  History,
  ShieldCheck,
  ArrowUpRight,
  LogOut,
  RefreshCw,
  Search,
  Plus,
  ChevronRight,
  Settings2,
  Blocks,
  ScrollText,
  CreditCard,
  Menu,
  Check,
  Download,
  AlertCircle,
  X,
  Copy,
} from "lucide-react";
import "./style.css";
import {
  CompleteManagement,
  TaskTrace,
  QuotaSources,
  Offers,
} from "./management";

type Any = Record<string, any>;
let csrf = "";
async function api(path: string, body?: unknown, method?: string) {
  const r = await fetch(path, {
    method: method || (body === undefined ? "GET" : "POST"),
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
  });
  const x = await r.json();
  if (x?.csrf) csrf = x.csrf;
  if (!r.ok)
    throw Object.assign(new Error(x.error || "请求失败"), {
      status: r.status,
      code: x.code,
    });
  return x;
}
const date = (x: any) =>
  x ? new Date(x).toLocaleString("zh-CN", { hour12: false }) : "无到期限制";
const day = (x: any) =>
  x ? new Date(x).toLocaleDateString("zh-CN") : "未开通";
const periods: Any = {
  once: "一次性",
  daily: "每日重置（UTC）",
  monthly: "每月重置（UTC）",
};
const actions: Any = {
  free_grant: "免费额度发放",
  quota_grant: "额度赠送",
  membership_extend: "会员开通 / 续期",
  membership_revoke: "会员撤销",
  quota_revoke: "额度撤销",
  reserve: "预占额度",
  confirmed: "确认消费",
  cancelled: "取消预占",
  refunded: "消费返还",
  expired: "超时释放",
  redeem: "兑换成功",
  subscription_reconcile: "订阅核对",
  code_create: "创建兑换码",
  code_status: "兑换码状态",
  user_status: "用户状态",
  configure_products: "产品配置",
  configure_features: "功能配置",
  configure_plans: "套餐配置",
  membership: "开通会员",
  quota: "赠送额度",
  revoke_membership: "撤销会员",
  revoke_quota: "撤销额度",
};
function Tag({
  children,
  tone = "neutral",
}: {
  children: React.ReactNode;
  tone?: string;
}) {
  return <span className={"tag " + tone}>{children}</span>;
}
function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: React.ReactNode;
  hint?: string;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}
function Empty({ children = "暂无记录" }: { children?: React.ReactNode }) {
  return (
    <div className="empty">
      <ScrollText size={26} />
      <p>{children}</p>
    </div>
  );
}
export function App() {
  const [cfg, setCfg] = useState<Any | null>(null),
    [me, setMe] = useState<Any | null>(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [tab, setTab] = useState("overview"),
    [version, setVersion] = useState(0);
  const prefix = "/api";
  const refresh = () => setVersion((v) => v + 1);
  useEffect(() => {
    let current = true;
    setLoading(true);
    setMe(null);
    csrf = "";
    Promise.all([
      api("/api/config" + location.search),
      api(prefix + "/me").catch((e: any) => {
        if (e.status === 401 || e.status === 403) return null;
        throw e;
      }),
    ])
      .then(([c, u]) => {
        if (current) {
          const previous = sessionStorage.getItem("zy-last-identity");
          const currentId = u?.user?.uid;
          if (currentId && previous && previous !== currentId)
            for (const k of Object.keys(sessionStorage))
              if (k.startsWith("zy-ops:")) sessionStorage.removeItem(k);
          if (currentId) sessionStorage.setItem("zy-last-identity", currentId);
          setCfg(c);
          document.title = "个人中心 · 臻一";
          setMe(u);
          csrf = u?.csrf || "";
        }
      })
      .catch((e) => {
        if (current) setError(e.message);
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [version]);
  async function perform(fn: () => Promise<unknown>, success = "操作已完成") {
    if (busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await fn();
      setNotice(success);
    } catch (e: any) {
      setError(e.message);
      if (e.status === 401) {
        setMe(null);
        csrf = "";
      }
    } finally {
      setBusy(false);
    }
  }
  const logout = (all = false) =>
    perform(
      async () => {
        await api(prefix + (all ? "/logout-all" : "/logout"), {});
        setMe(null);
        csrf = "";
        location.replace("/");
      },
      all ? "已退出全部产品" : "已退出当前产品",
    );
  const nav = [
    ["overview", "我的产品", LayoutGrid],
    ["redeem", "兑换权益", Ticket],
    ["records", "权益记录", History],
    ["security", "账号与安全", ShieldCheck],
  ];
  useEffect(() => {
    const requested = new URLSearchParams(location.search).get("tab");
    setTab(
      requested && nav.some((x) => x[0] === requested) ? requested : "overview",
    );
  }, []);
  useEffect(() => {
    const back = () => location.reload();
    window.addEventListener("popstate", back);
    return () => window.removeEventListener("popstate", back);
  }, []);
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "instant" });
  }, [tab]);
  const context = {
    cfg: cfg!,
    me: me!,
    busy,
    perform,
    version,
    refresh,
    error,
    notice,
  };
  return (
    <div className="shell">
      <a className="skip-link" href="#main-content">
        跳至主要内容
      </a>
      <aside className="sidebar">
        <a className="brand" href="/">
          <span className="brand-mark">臻</span>
          <span>
            个人中心
            <small>臻一 · 账号与安全</small>
          </span>
        </a>
        <div className="workspace">个人空间</div>
        <nav>
          {nav.map(([id, label, Icon]) => {
            const I = Icon as typeof LayoutGrid;
            return (
              <button
                key={id as string}
                aria-current={tab === id ? "page" : undefined}
                className={tab === id ? "selected" : ""}
                onClick={() => {
                  const next = new URL(location.href);
                  next.searchParams.set("tab", String(id));
                  history.pushState(null, "", next);
                  setTab(id as string);
                  setError("");
                  setNotice("");
                }}
              >
                <I size={18} />
                {label as string}
                {tab === id && <ChevronRight size={15} />}
              </button>
            );
          })}
        </nav>
        <div className="sidebar-bottom">
          <p>账号与各产品权益独立管理</p>
        </div>
      </aside>
      <main>
        <header className="topbar">
          <span>
            个人中心 <ChevronRight size={14} />{" "}
            {nav.find((x) => x[0] === tab)?.[1] as string}
          </span>
          <div className="top-actions">
            {me ? (
              <>
                <span className="avatar">
                  {me.user.display_name.slice(0, 1)}
                </span>
                <span>{me.user.display_name}</span>
                <button
                  className="icon-button"
                  aria-label="退出当前产品"
                  title="退出当前产品"
                  onClick={() => logout()}
                  disabled={busy}
                >
                  <LogOut size={18} />
                </button>
              </>
            ) : (
              <a href="/auth/login">登录</a>
            )}
          </div>
        </header>
        <div className="content" id="main-content" tabIndex={-1}>
          {cfg?.contextProduct && (
            <div className="return-product">
              <span>来自{cfg.contextProduct.name}</span>
              <a className="button secondary" href={cfg.contextProduct.url}>
                返回{cfg.contextProduct.name}
              </a>
            </div>
          )}
          {error && (
            <div role="alert" className="message error">
              <AlertCircle size={18} />
              {error}
              <button onClick={() => setError("")} aria-label="关闭提示">
                关闭
              </button>
            </div>
          )}
          {notice && (
            <div role="status" className="message success">
              <Check size={18} />
              {notice}
            </div>
          )}
          {loading ? (
            <div className="loading" role="status">
              正在加载账号信息…
            </div>
          ) : !cfg ? (
            <Empty>
              暂时无法连接服务。<button onClick={refresh}>重试</button>
            </Empty>
          ) : !me ? (
            <Welcome cfg={cfg} admin={false} />
          ) : (
            <Consumer {...context} tab={tab} />
          )}
        </div>
        <footer>
          臻一账号中心 <span>账号与各产品权益独立管理</span>
        </footer>
      </main>
    </div>
  );
}
type Context = {
  cfg: Any;
  me: Any;
  busy: boolean;
  perform: (fn: () => Promise<unknown>, success?: string) => Promise<void>;
  version: number;
  refresh: () => void;
  error?: string;
  notice?: string;
};
function Welcome({ cfg, admin }: { cfg: Any; admin: boolean }) {
  return (
    <section className="welcome">
      <div className="welcome-symbol">
        <ShieldCheck size={38} />
      </div>
      <h1>
        {admin
          ? "登录运营后台"
          : cfg.id === "center"
            ? "欢迎来到臻一"
            : `欢迎来到${cfg.name}`}
      </h1>
      <p>
        {admin
          ? "使用独立管理组织中的授权账号登录，查看用户与产品，管理会员和使用额度。"
          : cfg.id === "center"
            ? "在一个地方管理你的账号、会员和使用次数。去创作，去记录，让工具回归简单。"
            : "这是独立接入统一账号中心的演示产品。登录后，体验真实权益查询、消费与返还。"}
      </p>
      <div className="button-row">
        <a
          className="button primary"
          href={"/auth/login" + (admin ? "?mode=admin" : "")}
        >
          {admin ? "管理员登录" : "登录账号"}
          <ArrowUpRight size={17} />
        </a>
        {!admin && (
          <a className="button secondary" href={cfg.signup}>
            注册新账号
          </a>
        )}
      </div>
      <div className="welcome-products">
        {!admin && (
          <>
            <a href={cfg.beadgrid}>
              <Blocks size={20} />
              拼豆工坊 <small>示例产品</small>
              <ArrowUpRight size={16} />
            </a>
            <a href={cfg.focustake}>
              <LayoutGrid size={20} />
              专注录屏 <small>示例产品</small>
              <ArrowUpRight size={16} />
            </a>
          </>
        )}
      </div>
      <div className="fineprint">
        可用登录方式以统一登录页为准。第三方服务的配置状态可在账号与安全中查看。
        {admin && " 使用已设置的管理员账号密码；本机忘记密码可按 README 恢复。"}
      </div>
    </section>
  );
}
function useData(path: string, version = 0) {
  const [retryVersion, retry] = useState(0);
  const [data, setData] = useState<any>(null),
    [error, setError] = useState("");
  useEffect(() => {
    let alive = true;
    setData(null);
    setError("");
    api(path)
      .then((d) => {
        if (alive) setData(d);
      })
      .catch((e) => {
        if (alive) setError(e.message);
      });
    return () => {
      alive = false;
    };
  }, [path, version, retryVersion]);
  return { data, error, onRetry: () => retry((v) => v + 1) };
}
function DataState({
  data,
  error,
  children,
  onRetry,
}: {
  onRetry?: () => void;
  data: any;
  error: string;
  children: React.ReactNode;
}) {
  return error ? (
    <div role="alert" className="message error">
      {error}{" "}
      <button onClick={onRetry || (() => location.reload())}>重试</button>{" "}
      <a
        href={
          "/auth/login" +
          (location.pathname.startsWith("/admin") ? "?mode=admin" : "")
        }
      >
        重新登录
      </a>
    </div>
  ) : data === null ? (
    <div className="loading" role="status">
      正在加载…
    </div>
  ) : (
    <>{children}</>
  );
}
function EntitlementList({ items }: { items: Any[] }) {
  return (
    <div className="product-list">
      {items.map((e) => (
        <article className="product-row" key={e.product.id}>
          <div className={"product-icon " + e.product.id}>
            <Blocks size={26} />
          </div>
          <div className="product-detail">
            <div className="product-heading">
              <h2>{e.product.name}</h2>
              <Tag tone={e.membership.active ? "green" : "neutral"}>
                {e.membership.active
                  ? "会员生效中"
                  : e.membership.expires_at
                    ? "会员已到期"
                    : "未开通会员"}
              </Tag>
            </div>
            <p>
              {e.membership.expires_at
                ? `会员到期：${date(e.membership.expires_at)}`
                : "尚未开通会员，免费功能可正常使用"}
            </p>
            <div className="feature-lines">
              {e.features.map((f: Any) => (
                <div key={f.id}>
                  <span>{f.name}</span>
                  <strong>
                    {f.kind === "quota"
                      ? `${f.remaining} 次`
                      : f.allowed
                        ? "可使用"
                        : "需有效会员"}
                  </strong>
                  {f.kind === "quota" && !f.allowed && (
                    <small>当前不可使用，请查看会员与产品状态。</small>
                  )}
                  {f.kind === "quota" && <QuotaSources feature={f} />}
                  {f.kind === "quota" && (
                    <small>
                      {f.held > 0 ? `${f.held} 次预占中 · ` : ""}
                      {periods[f.period]}
                    </small>
                  )}
                </div>
              ))}
            </div>
          </div>
          {e.product.integration_ready ? (
            <a className="button secondary" href={e.product.origin}>
              打开产品
              <ArrowUpRight size={15} />
            </a>
          ) : (
            <span className="muted">产品接入配置待完成</span>
          )}
        </article>
      ))}
      {!items.length && <Empty>尚无可用产品</Empty>}
    </div>
  );
}
function Consumer(c: Context & { tab: string }) {
  const [code, setCode] = useState(""),
    [localVersion, setLocalVersion] = useState(0);
  const { data, error } = useData(
    c.me.isAdmin
      ? "/api/admin/me"
      : c.tab === "records"
        ? "/api/records"
        : "/api/entitlements",
    c.version + localVersion,
  );
  const records = useData(
    c.me.isAdmin ? "/api/admin/me" : "/api/records",
    localVersion,
  );
  useEffect(() => {
    if (
      new URLSearchParams(location.search).get("purchase") !== "return" ||
      c.me.isAdmin
    )
      return;
    const u = new URL(location.href);
    u.searchParams.delete("purchase");
    history.replaceState(null, "", u);
    c.perform(async () => {
      await api("/api/subscriptions/refresh", {});
      setLocalVersion((v) => v + 1);
    }, "已从身份服务核实订阅并同步权益");
  }, []);
  if (c.tab === "security")
    return (
      <>
        <PageTitle
          title="账号与安全"
          description="各产品使用同一个账号，会员权益与登录状态分别管理。"
        />
        <section className="panel">
          <h2>{c.me.user.display_name}</h2>
          <dl className="details">
            <dt>用户名</dt>
            <dd>{c.me.user.username}</dd>
            <dt>账号 ID</dt>
            <dd className="uid">{c.me.user.uid}</dd>
            <dt>账号状态</dt>
            <dd>
              <Tag tone="green">正常</Tag>
            </dd>
          </dl>
          <div className="setting-line">
            <div>
              <h3>个人资料与密码</h3>
              <p>
                在新窗口验证身份后修改资料或密码。完成后返回此页；密码变更后请重新登录。
              </p>
            </div>
            <a
              className="button secondary"
              href={c.me.profileUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              修改密码与个人资料（新窗口）
              <ArrowUpRight size={16} />
            </a>
          </div>
          <div className="setting-line">
            <div>
              <h3>切换账号</h3>
              <p>重新进行身份验证，当前页面不会保留上一账号的数据。</p>
            </div>
            <a
              className="button secondary"
              href={
                c.me.isAdmin
                  ? "/auth/login?mode=admin&switch=1"
                  : "/auth/login?switch=1"
              }
            >
              切换账号
            </a>
          </div>
          <div className="setting-line">
            <div>
              <h3>退出全部产品</h3>
              <p>
                退出账号中心、已适配的示例产品及统一身份服务。其他产品的独立会话按其接入实现撤销。
              </p>
            </div>
            <button
              className="danger"
              disabled={c.busy}
              onClick={() =>
                c.perform(async () => {
                  await api("/api/logout-all", {});
                  location.replace("/");
                })
              }
            >
              全部退出
            </button>
          </div>
        </section>
        <section className="panel">
          <h2>登录方式</h2>
          {Object.entries(c.cfg.services)
            .filter(([k]) => k !== "payments")
            .map(([k, v]) => (
              <div className="setting-line" key={k}>
                <span>
                  {
                    { sms: "短信验证", email: "邮件验证", wechat: "微信登录" }[
                      k
                    ]
                  }
                </span>
                <Tag>{v as string}</Tag>
              </div>
            ))}
        </section>
      </>
    );
  if (c.tab === "redeem")
    return (
      <>
        <PageTitle
          title="兑换会员或次数"
          description="兑换码用于领取产品会员或次数，不可用于登录。每个账号对同一码仅可领取一次。"
        />
        <section className="panel redeem-panel">
          <Ticket size={30} />
          <h2>输入兑换码</h2>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              c.perform(async () => {
                const r = await api("/api/redeem", { code });
                setCode("");
                setLocalVersion((v) => v + 1);
                return r;
              }, "兑换成功，权益已到账");
            }}
          >
            <Field label="兑换码">
              <input
                autoComplete="off"
                required
                minLength={10}
                maxLength={100}
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="粘贴完整兑换码"
              />
            </Field>
            <button className="primary" disabled={c.busy || !code.trim()}>
              {c.busy ? "正在兑换…" : "确认兑换"}
            </button>
          </form>
        </section>
        <h2 className="section-title">最近兑换</h2>
        <DataState {...records}>
          {records.data?.redemptions?.length ? (
            <RecordTable rows={records.data.redemptions} />
          ) : (
            <Empty>还没有兑换记录</Empty>
          )}
        </DataState>
      </>
    );
  if (c.tab === "records")
    return (
      <>
        <PageTitle
          title="权益记录"
          description="每一次获得、使用与返还，都有迹可循。展示最近 100 条记录。"
        />
        <DataState data={data} error={error}>
          <RecordTable rows={data?.ledger || []} />
        </DataState>
      </>
    );
  return (
    <>
      <PageTitle
        title={`${c.me.user.display_name}，你好`}
        description="你的创作与记录，从这里继续。"
      />
      <div className="section-heading">
        <h2>我的产品</h2>
        <span>演示产品 · 独立权益</span>
      </div>
      <DataState data={data} error={error}>
        <EntitlementList items={data || []} />
        <Offers request={api} />
      </DataState>
      <div className="account-note">
        <ShieldCheck size={24} />
        <div>
          <h3>一个账号，各自精彩</h3>
          <p>
            拼豆与录屏的会员和次数独立计算。会员到期后，仍能登录并查看账号与已有数据。
          </p>
        </div>
      </div>
    </>
  );
}
function PageTitle({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="page-title">
      <div>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {children}
    </div>
  );
}
function RecordTable({ rows }: { rows: Any[] }) {
  if (!rows.length) return <Empty />;
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>时间</th>
            <th>产品 / 对象</th>
            <th>操作</th>
            <th>数量</th>
            <th>详情</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.id || i}>
              <td>{date(r.created_at)}</td>
              <td>
                {r.product_id || r.target || "—"}
                {r.feature_id && <small>{r.feature_id}</small>}
              </td>
              <td>
                {actions[r.action] ||
                  r.action ||
                  (r.code_id
                    ? "兑换成功"
                    : (
                        {
                          success: "任务完成",
                          fail_before: "预占后取消",
                          fail_after: "消费后返还",
                        } as Any
                      )[r.mode] ||
                      r.mode ||
                      "核对")}
              </td>
              <td>{r.amount ?? "—"}</td>
              <td>
                <details>
                  <summary>查看</summary>
                  <pre>{JSON.stringify(r, null, 2)}</pre>
                </details>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
export function Demo(c: Context & { tab: string }) {
  const [v, setV] = useState(0),
    [result, setResult] = useState<Any | null>(null);
  const { data, error } = useData("/api/entitlements", v);
  const records = useData("/api/records", v);
  const [request, setRequest] = useState<string>(() => crypto.randomUUID());
  const [activeMode, setActiveMode] = useState("success");
  const pending = result?.status === "pending_recovery";
  useEffect(() => {
    const jobs = records.data?.jobs || [],
      waiting = jobs.find((j: Any) => j.stage !== "complete");
    if (waiting) {
      setRequest(waiting.request_id);
      setActiveMode(waiting.mode);
      setResult(waiting.result);
    } else if (result?.status === "pending_recovery") {
      const done = jobs.find((j: Any) => j.request_id === request);
      if (done) setResult(done.result);
    }
  }, [records.data]);
  useEffect(() => {
    if (!pending) return;
    const timer = setInterval(() => setV((n) => n + 1), 3000);
    return () => clearInterval(timer);
  }, [pending]);

  async function run(mode: string) {
    setActiveMode(mode);
    await c.perform(async () => {
      try {
        const r = await api("/api/demo", { mode, request_id: request });
        setResult(r);
      } catch (e: any) {
        if (!e.status || e.status >= 500)
          setResult({
            status: "pending_recovery",
            request_id: request,
            message: "响应结果未知，保留原任务核实；重试沿用此请求号",
          });
        throw e;
      } finally {
        setV((v) => v + 1);
      }
    }, "任务结果已更新");
  }
  function download() {
    if (!result?.artifact) return;
    const a = document.createElement("a"),
      u = URL.createObjectURL(
        new Blob([result.artifact.content], { type: result.artifact.mime }),
      );
    a.href = u;
    a.download = result.artifact.name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(u), 5000);
  }
  if (c.tab === "records")
    return (
      <>
        <PageTitle
          title="任务记录"
          description="仅展示当前用户在本产品的演示任务。"
        />
        <DataState {...records}>
          <RecordTable rows={records.data?.jobs || []} />
        </DataState>
      </>
    );
  return (
    <>
      <PageTitle
        title={c.cfg.name}
        description="独立接入示例：本产品有自己的登录会话与后端，通过授权接口使用公共权益。"
      >
        <a href={c.cfg.center} className="button secondary">
          账号中心
          <ArrowUpRight size={16} />
        </a>
      </PageTitle>
      <DataState data={data} error={error}>
        <EntitlementList items={data || []} />
      </DataState>
      <section className="panel">
        <div className="section-heading">
          <h2>
            {c.cfg.id === "beadgrid"
              ? "生成一份拼豆图纸"
              : "执行一项录屏演示任务"}
          </h2>
          <Tag>服务端执行 · 每次 1 次额度</Tag>
        </div>
        <p className="muted">
          {c.cfg.id === "beadgrid"
            ? "图纸导出接入演示，生成可下载的任务结果文件。"
            : "录屏接入演示，生成任务文件，不采集屏幕或麦克风。"}
        </p>
        <Field
          label="业务请求号"
          hint="重复点击沿用同一请求号，最多扣一次；创建新任务后才产生新消费。"
        >
          <input
            value={request}
            disabled={pending || !records.data}
            onChange={(e) => setRequest(e.target.value)}
            minLength={8}
            maxLength={128}
          />
        </Field>
        <div className="button-row">
          <button
            className="primary"
            disabled={
              c.busy || !records.data || (pending && activeMode !== "success")
            }
            onClick={() => run("success")}
          >
            执行演示功能
          </button>
          <button
            disabled={
              c.busy ||
              !records.data ||
              (pending && activeMode !== "fail_before")
            }
            onClick={() => run("fail_before")}
          >
            模拟预占后失败
          </button>
          <button
            disabled={
              c.busy ||
              !records.data ||
              (pending && activeMode !== "fail_after")
            }
            onClick={() => run("fail_after")}
          >
            模拟消费后返还
          </button>
          <button
            disabled={c.busy || pending || !records.data}
            onClick={() => {
              setRequest(crypto.randomUUID());
              setResult(null);
            }}
          >
            新建任务
          </button>
        </div>
        {result && (
          <div className="result" role="status">
            <Tag tone={result.ok ? "green" : "amber"}>
              {(
                {
                  confirmed: "已完成",
                  cancelled: "已释放",
                  refunded: "已返还",
                  pending_recovery: "等待恢复",
                  reserved: "已预占",
                  expired: "已释放",
                } as Any
              )[result.status] || result.status}
            </Tag>
            <p>
              {result.message}
              {result.repeated ? "（重复请求，返回原结果）" : ""}
            </p>
            {result.artifact && (
              <button onClick={download}>
                <Download size={16} />
                下载结果
              </button>
            )}
          </div>
        )}
        <div className="setting-line">
          <div>
            <h3>会员功能检查</h3>
            <p>会员到期后，此功能被服务端拒绝；免费功能与登录不受影响。</p>
          </div>
          <button
            disabled={c.busy}
            onClick={() =>
              c.perform(
                () => api("/api/studio", {}),
                "会员有效，可使用高级功能",
              )
            }
          >
            使用高级功能
          </button>
        </div>
      </section>
      <section className="panel">
        <h2>当前用户任务</h2>
        <DataState {...records}>
          <RecordTable rows={records.data?.jobs || []} />
        </DataState>
      </section>
      <a
        href={
          c.me.isAdmin
            ? "/auth/login?mode=admin&switch=1"
            : "/auth/login?switch=1"
        }
        className="text-link"
      >
        切换账号
      </a>
      <span className="muted"> · </span>
      <button
        className="text-link"
        onClick={() =>
          c.perform(async () => {
            await api("/api/logout-all", {});
            location.replace("/");
          })
        }
      >
        退出全部产品
      </button>
    </>
  );
}

function useDebounced(value: string) {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const id = window.setTimeout(() => setSettled(value), 250);
    return () => window.clearTimeout(id);
  }, [value]);
  return settled;
}
function Pager({
  total,
  page,
  onPage,
  size = 20,
}: {
  total: number;
  page: number;
  onPage: (p: number) => void;
  size?: number;
}) {
  const pages = Math.max(1, Math.ceil(total / size));
  return (
    <div className="pagination">
      <span>
        共 <strong>{total}</strong> 条 · 每页 {size} 条
      </span>
      <div>
        <button
          disabled={page <= 1}
          onClick={() => {
            onPage(page - 1);
            window.scrollTo({ top: 0, behavior: "instant" });
          }}
        >
          上一页
        </button>
        <span>
          {page} / {pages}
        </span>
        <button
          disabled={page >= pages}
          onClick={() => {
            onPage(page + 1);
            window.scrollTo({ top: 0, behavior: "instant" });
          }}
        >
          下一页
        </button>
      </div>
    </div>
  );
}
function Drawer({
  title,
  subtitle,
  children,
  onClose,
  busy,
  error,
  notice,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  onClose: () => void;
  busy?: boolean;
  error?: string;
  notice?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null),
    titleId = useId();
  useEffect(() => {
    const previous = document.activeElement as HTMLElement;
    const d = ref.current!;
    d.showModal();
    const old = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      d.close();
      document.body.style.overflow = old;
      previous?.focus();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className="drawer"
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onClose();
      }}
    >
      <header className="drawer-heading">
        <div>
          <h2 id={titleId}>{title}</h2>
          {subtitle && <p>{subtitle}</p>}
        </div>
        <button aria-label="关闭详情" disabled={busy} onClick={onClose}>
          <X size={20} />
        </button>
      </header>
      <div className="drawer-body">
        {error && (
          <div role="alert" className="message error">
            {error}
          </div>
        )}
        {notice && (
          <div role="status" className="message success">
            {notice}
          </div>
        )}
        {children}
      </div>
    </dialog>
  );
}
function CopyUid({ value }: { value: string }) {
  const [copied, setCopied] = useState(false),
    [failed, setFailed] = useState(false);
  return (
    <button
      className="copy-uid"
      title={value}
      aria-label="复制完整账号 ID"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setFailed(false);
        } catch {
          setFailed(true);
        }
      }}
    >
      {failed
        ? "复制失败，请在详情中选取"
        : copied
          ? "已复制"
          : `${value.slice(0, 8)}…`}{" "}
      {copied ? <Check size={13} /> : <Copy size={13} />}
    </button>
  );
}
const testUser = (s: string) => /^(test_|dummy_test_|probe_|qa_)/.test(s || "");
const fieldNames: Any = {
  uid: "用户 UID",
  product_id: "产品",
  feature_id: "功能",
  days: "会员天数",
  amount: "次数",
  expires_at: "到期时间",
  active: "启用",
  status: "状态",
  blocked: "停用权益访问",
  remaining: "可用次数",
  held: "预占次数",
  id: "标识",
  name: "名称",
  kind: "类型",
  member_only: "仅会员可用",
  free_quota: "免费次数",
  period: "重置周期",
  application: "身份应用",
  callback_url: "登录回调",
  origin: "产品地址",
  reason: "原因",
  casdoor_plan: "订阅套餐映射",
  quotas: "套餐次数",
  reference: "关联请求",
  source_id: "来源订阅",
  max_uses: "最多领取次数",
  uses: "已领取次数",
  hint: "兑换码尾号",
  key: "业务标识",
};
function ReadableValue({ value }: { value: any }): React.ReactNode {
  if (value === null || value === undefined)
    return <span className="muted">无</span>;
  if (typeof value === "boolean") return value ? "是" : "否";
  if (Array.isArray(value))
    return (
      <div>
        {value.map((v, i) => (
          <div key={i}>
            <ReadableValue value={v} />
          </div>
        ))}
      </div>
    );
  if (typeof value === "object")
    return (
      <dl className="value-list">
        {Object.entries(value).map(([k, v]) => (
          <React.Fragment key={k}>
            <dt>{fieldNames[k] || k}</dt>
            <dd>
              <ReadableValue value={v} />
            </dd>
          </React.Fragment>
        ))}
      </dl>
    );
  return (
    <span className="break-text">
      {periods[String(value)] ||
        (
          {
            active: "启用",
            disabled: "停用",
            quota: "次数额度",
            access: "访问权限",
          } as Any
        )[String(value)] ||
        String(value)}
    </span>
  );
}
function OpsRecords(c: Context & { tab: string; cat: Any }) {
  const recordsKey = "zy-ops:" + c.me.user.uid + ":" + c.tab;
  const saved = (() => {
    try {
      return JSON.parse(sessionStorage.getItem(recordsKey) || "null");
    } catch {
      return null;
    }
  })();
  const [filters, setFilters] = useState({
      ...(saved?.filters || {
        q: new URLSearchParams(location.search).get("q") || "",
        product: "",
        action: "",
        from: "",
        to: "",
        data_kind: "all",
        reconcile: "hide",
      }),
      ...(new URLSearchParams(location.search).has("q")
        ? { q: new URLSearchParams(location.search).get("q") || "" }
        : {}),
    }),
    [page, setPage] = useState(
      new URLSearchParams(location.search).has("q")
        ? Number(new URLSearchParams(location.search).get("page")) || 1
        : saved?.page || 1,
    ),
    [selected, setSelected] = useState<Any | null>(null);
  const searchText = useDebounced(filters.q);
  const records = useData(
    "/api/admin/records/" +
      c.tab +
      "?" +
      new URLSearchParams({
        ...filters,
        q: searchText,
        paginated: "1",
        page: String(page),
      }),
    c.version,
  );
  const change = (key: string, value: string) => {
    setFilters((f: Any) => ({ ...f, [key]: value }));
    setPage(1);
  };
  useEffect(() => {
    sessionStorage.setItem(recordsKey, JSON.stringify({ filters, page }));
  }, [filters, page, recordsKey]);
  const auditMode = c.tab === "audit";
  const choices = auditMode
    ? [
        "configure_products",
        "configure_features",
        "configure_plans",
        "membership",
        "quota",
        "revoke_membership",
        "revoke_quota",
        "code_create",
        "code_status",
        "user_status",
        "subscription_reconcile",
      ]
    : [
        "free_grant",
        "quota_grant",
        "membership_extend",
        "membership_revoke",
        "quota_revoke",
        "reserve",
        "confirmed",
        "cancelled",
        "refunded",
        "expired",
        "redeem",
        "subscription_reconcile",
      ];
  return (
    <>
      <PageTitle
        title={auditMode ? "操作记录" : "权益流水"}
        description={
          auditMode
            ? "查看每次管理操作的人员、原因和变更前后值。"
            : "追踪权益发放、预占、消费与返还；所有记录只追加。"
        }
      />
      <div className="ops-toolbar">
        <Field label={auditMode ? "操作者 / 对象 / 原因" : "用户 / 业务请求"}>
          <input
            value={filters.q}
            onChange={(e) => change("q", e.target.value)}
            placeholder="输入关键词筛选"
          />
        </Field>
        <Field label="产品">
          <select
            value={filters.product}
            onChange={(e) => change("product", e.target.value)}
          >
            <option value="">全部产品</option>
            {c.cat?.products.map((p: Any) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="操作类型">
          <select
            value={filters.action}
            onChange={(e) => {
              change("action", e.target.value);
              if (e.target.value === "subscription_reconcile")
                setFilters((f: Any) => ({ ...f, reconcile: "show" }));
            }}
          >
            <option value="">全部类型</option>
            {choices.map((x) => (
              <option key={x} value={x}>
                {actions[x]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="起始日期（UTC）">
          <input
            type="date"
            value={filters.from}
            onChange={(e) => change("from", e.target.value)}
          />
        </Field>
        <Field label="截止日期（UTC）">
          <input
            type="date"
            value={filters.to}
            min={filters.from}
            onChange={(e) => change("to", e.target.value)}
          />
        </Field>
        <Field label={auditMode ? "操作者范围" : "数据范围"}>
          <select
            value={filters.data_kind}
            onChange={(e) => change("data_kind", e.target.value)}
          >
            <option value="all">{auditMode ? "全部操作者" : "全部账号"}</option>
            <option value="business">
              {auditMode ? "非测试命名操作者" : "非测试账号"}
            </option>
            <option value="test">
              {auditMode ? "测试命名操作者" : "已标记测试账号"}
            </option>
          </select>
        </Field>
        <button
          onClick={() => {
            setFilters({
              q: new URLSearchParams(location.search).get("q") || "",
              product: "",
              action: "",
              from: "",
              to: "",
              data_kind: "all",
              reconcile: "hide",
            });
            setPage(1);
          }}
        >
          重置
        </button>
      </div>
      {!auditMode && (
        <label className="checkbox reconcile-filter">
          <input
            type="checkbox"
            checked={filters.reconcile === "show"}
            onChange={(e) => {
              change("reconcile", e.target.checked ? "show" : "hide");
              if (
                !e.target.checked &&
                filters.action === "subscription_reconcile"
              )
                change("action", "");
            }}
          />
          包含订阅核对记录 <span className="muted">默认聚焦实际权益变更</span>
        </label>
      )}
      <DataState {...records}>
        {records.data?.items.length ? (
          <div className="table-wrap ops-table">
            <table>
              <thead>
                <tr>
                  <th>时间</th>
                  <th>{auditMode ? "操作者" : "用户"}</th>
                  <th>{auditMode ? "操作 / 对象" : "产品 / 功能"}</th>
                  <th>{auditMode ? "变更原因" : "权益变更"}</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {records.data?.items.map((r: Any) => (
                  <tr key={r.id}>
                    <td data-label="时间">{date(r.created_at)}</td>
                    <td data-label={auditMode ? "操作者" : "用户"}>
                      <strong>{r.display_name || "未知账号"}</strong>
                      <small>{r.username}</small>
                    </td>
                    <td data-label={auditMode ? "操作 / 对象" : "产品 / 功能"}>
                      {auditMode ? (
                        <>
                          {actions[r.action] || r.action}
                          <small>
                            {r.target_name
                              ? `${r.target_name}${r.target.includes("/") ? " · " + (c.cat?.products.find((p: Any) => p.id === r.target.split("/")[1])?.name || r.target.split("/")[1]) : ""}`
                              : r.code_hint
                                ? "兑换码 …" + r.code_hint
                                : c.cat?.products.find(
                                    (p: Any) => p.id === r.target,
                                  )?.name || r.target}
                          </small>
                        </>
                      ) : (
                        <>
                          {r.product_name || r.product_id}
                          <small>{r.feature_name || "会员 / 产品权益"}</small>
                        </>
                      )}
                    </td>
                    <td data-label={auditMode ? "原因" : "变更"}>
                      {auditMode ? (
                        r.reason
                      ) : (
                        <>
                          <span
                            className={
                              "change-amount " +
                              (r.amount > 0
                                ? "positive"
                                : r.amount < 0
                                  ? "negative"
                                  : "")
                            }
                          >
                            {r.action === "redeem"
                              ? "兑换完成"
                              : r.amount == null
                                ? "—"
                                : `${r.amount > 0 ? "+" : ""}${r.amount}${r.action === "membership_extend" ? " 天" : " 次"}`}
                          </span>
                          <small>
                            {actions[r.action] || r.action}
                            {r.action === "confirmed"
                              ? "（预占时已扣除）"
                              : r.action === "redeem"
                                ? "（权益见关联发放记录）"
                                : ""}
                          </small>
                        </>
                      )}
                    </td>
                    <td data-label="操作">
                      <button
                        className="row-action"
                        onClick={() => setSelected(r)}
                      >
                        查看详情 <ChevronRight size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty>没有符合条件的记录，请调整筛选。</Empty>
        )}
        {records.data && (
          <Pager total={records.data.total} page={page} onPage={setPage} />
        )}
      </DataState>
      {selected && (
        <Drawer
          title={actions[selected.action] || "记录详情"}
          subtitle={date(selected.created_at)}
          onClose={() => setSelected(null)}
        >
          <dl className="details">
            <dt>{auditMode ? "操作者" : "用户"}</dt>
            <dd>
              {selected.display_name} · {selected.username}
            </dd>
            <dt>{auditMode ? "操作对象" : "产品 / 功能"}</dt>
            <dd>
              {auditMode
                ? selected.target
                : `${selected.product_name || selected.product_id} · ${selected.feature_name || "会员权益"}`}
            </dd>
            <dt>{auditMode ? "操作原因" : "关联请求"}</dt>
            <dd>
              {auditMode
                ? selected.reason
                : selected.business_request || selected.reference}
            </dd>
          </dl>
          {auditMode ? (
            <div className="before-after">
              <section>
                <h3>变更前</h3>
                <ReadableValue value={selected.before_value} />
              </section>
              <section>
                <h3>变更后</h3>
                <ReadableValue value={selected.after_value} />
              </section>
            </div>
          ) : (
            <>
              <h3>关联信息</h3>
              <ReadableValue value={selected.detail} />
              <p className="muted">
                同一业务请求的预占、确认、返还可使用上方请求标识筛选追溯。
              </p>
            </>
          )}
        </Drawer>
      )}
    </>
  );
}
function Admin(c: Context & { tab: string }) {
  if (c.tab === "diagnostics")
    return <CompleteManagement request={api} casdoor={c.cfg.casdoor} />;
  if (c.tab === "tasks") return <TaskTrace request={api} />;
  return <BusinessAdmin {...c} />;
}
function BusinessAdmin(c: Context & { tab: string }) {
  const storageKey = "zy-ops:" + c.me.user.uid + ":" + c.tab;
  const stored = (() => {
    try {
      return JSON.parse(sessionStorage.getItem(storageKey) || "null");
    } catch {
      return null;
    }
  })();
  const [v, setV] = useState(0),
    [page, setPage] = useState(
      new URLSearchParams(location.search).has("page")
        ? Number(new URLSearchParams(location.search).get("page")) || 1
        : stored?.page || 1,
    ),
    [editor, setEditor] = useState<Any | null>(null),
    [selected, setSelected] = useState<Any | null>(null),
    [revealed, setRevealed] = useState("");
  const [filters, setFilters] = useState({
    ...(stored?.filters || {
      q: new URLSearchParams(location.search).get("q") || "",
      product: "",
      status: "",
      membership: "",
      data_kind: "all",
    }),
    ...Object.fromEntries(
      ["q", "product", "status", "membership", "data_kind"]
        .filter((k) => new URLSearchParams(location.search).has(k))
        .map((k) => [k, new URLSearchParams(location.search).get(k) || ""]),
    ),
  });
  const cat = useData("/api/admin/catalog", v);
  const searchText = useDebounced(filters.q);
  const query = new URLSearchParams({
    ...filters,
    q: searchText,
    paginated: "1",
    page: String(page),
  }).toString();
  const users = useData("/api/admin/users?" + query, v),
    codes = useData("/api/admin/codes?" + query, v);
  const subject = new URLSearchParams(location.search).get("subject");
  const [targetUid, setTargetUid] = useState("");
  useEffect(() => {
    if (!subject) return;
    let live = true;
    api(
      "/api/admin/identities/by-subject?subject=" + encodeURIComponent(subject),
    )
      .then((x) => {
        if (live) {
          setTargetUid(x.uid);
          setFilters((f: Any) => ({ ...f, q: x.uid }));
          setPage(1);
        }
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [subject]);
  useEffect(() => {
    if (c.tab === "users" && targetUid && users.data?.items) {
      const u = users.data.items.find((u: Any) => u.uid === targetUid);
      if (u) setSelected(u);
    }
  }, [targetUid, users.data]);

  useEffect(() => {
    sessionStorage.setItem(storageKey, JSON.stringify({ filters, page }));
    const u = new URL(location.href);
    Object.entries(filters).forEach(([k, v]) => {
      if (v) u.searchParams.set(k, String(v));
      else u.searchParams.delete(k);
    });
    u.searchParams.set("page", String(page));
    history.replaceState(null, "", u);
  }, [filters, page, storageKey]);
  const done = () => {
    setV((v) => v + 1);
    setEditor(null);
  };
  const cx = { ...c, cat: cat.data, done };
  const productName = (id: string) =>
    cat.data?.products.find((p: Any) => p.id === id)?.name || id;
  const featureName = (p: string, f: string) =>
    cat.data?.features.find((x: Any) => x.product_id === p && x.id === f)
      ?.name || f;
  const change = (key: string, value: string) => {
    setFilters((f: Any) => ({ ...f, [key]: value }));
    setPage(1);
  };
  const productFilter = (
    <Field label="产品">
      <select
        value={filters.product}
        onChange={(e) => change("product", e.target.value)}
      >
        <option value="">全部产品</option>
        {cat.data?.products.map((p: Any) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
    </Field>
  );
  const reset = (
    <button
      onClick={() => {
        setFilters({
          q: new URLSearchParams(location.search).get("q") || "",
          product: "",
          status: "",
          membership: "",
          data_kind: "all",
        });
        setPage(1);
      }}
    >
      重置
    </button>
  );
  if (c.tab === "users")
    return (
      <>
        <PageTitle
          title="用户与权益"
          description="查找账号，查看各产品会员与额度，处理开通、续期和赠送。"
        >
          <a className="button secondary" href={"/admin/users"}>
            身份管理 <ArrowUpRight size={16} />
          </a>
        </PageTitle>
        <div className="ops-toolbar">
          <Field label="查找用户">
            <div className="input-icon">
              <Search size={17} />
              <input
                value={filters.q}
                onChange={(e) => change("q", e.target.value)}
                placeholder="用户名、昵称或完整 UID"
              />
            </div>
          </Field>
          {productFilter}
          <Field label="账号状态">
            <select
              value={filters.status}
              onChange={(e) => change("status", e.target.value)}
            >
              <option value="">全部状态</option>
              <option value="normal">正常</option>
              <option value="blocked">已停用 / 封禁</option>
            </select>
          </Field>
          <Field label="会员状态">
            <select
              value={filters.membership}
              onChange={(e) => change("membership", e.target.value)}
            >
              <option value="">全部会员</option>
              <option value="active">有效会员</option>
              <option value="expired">会员已到期</option>
              <option value="none">未开通会员</option>
            </select>
          </Field>
          <Field label="数据范围">
            <select
              value={filters.data_kind}
              onChange={(e) => change("data_kind", e.target.value)}
            >
              <option value="all">全部账号</option>
              <option value="business">非测试账号</option>
              <option value="test">已标记测试账号</option>
            </select>
          </Field>
          {reset}
        </div>
        <div className="list-caption">
          <span>
            用户列表 <strong>{users.data?.total ?? "—"}</strong>
          </span>
          <span>
            额度为已入账可用次数；测试标签使用明确标记；名称前缀仅供参考
          </span>
        </div>
        <DataState {...users}>
          {users.data?.items.length ? (
            <div className="table-wrap ops-table user-table">
              <table>
                <thead>
                  <tr>
                    <th>用户</th>
                    <th>产品权益</th>
                    <th>账号状态</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {users.data.items.map((u: Any) => (
                    <tr key={u.uid}>
                      <td data-label="用户">
                        <div className="user-cell">
                          <span className="user-avatar">
                            {u.display_name.slice(0, 1)}
                          </span>
                          <div>
                            <strong>{u.display_name}</strong>
                            <small>
                              {u.username} {u.is_test && <Tag>测试</Tag>}
                            </small>
                            <CopyUid value={u.uid} />
                          </div>
                        </div>
                      </td>
                      <td data-label="产品权益">
                        <div className="rights-summary">
                          {u.rights.map((r: Any) => (
                            <div key={r.product_id}>
                              <span className="rights-product">
                                {r.product_name}
                              </span>
                              <Tag
                                tone={
                                  r.active
                                    ? "green"
                                    : r.expires_at
                                      ? "amber"
                                      : "neutral"
                                }
                              >
                                {r.status === "disabled"
                                  ? "产品已停用"
                                  : r.active
                                    ? "会员有效"
                                    : r.expires_at
                                      ? "会员已到期"
                                      : "未开通会员"}
                              </Tag>
                              {r.expires_at && (
                                <small>到期 {day(r.expires_at)}</small>
                              )}
                              {r.quotas.length > 0 && (
                                <small>
                                  {r.quotas
                                    .map(
                                      (q: Any) => `${q.name} ${q.remaining} 次`,
                                    )
                                    .join(" · ")}
                                </small>
                              )}
                            </div>
                          ))}
                        </div>
                      </td>
                      <td data-label="账号状态">
                        <Tag
                          tone={
                            u.blocked || u.casdoor_blocked ? "red" : "green"
                          }
                        >
                          {u.blocked
                            ? "权益停用"
                            : u.casdoor_blocked
                              ? "身份封禁"
                              : "正常"}
                        </Tag>
                      </td>
                      <td data-label="操作">
                        <button
                          className="row-action"
                          onClick={() => setSelected(u)}
                        >
                          管理权益 <ChevronRight size={14} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty>没有符合条件的用户，请调整搜索或筛选。</Empty>
          )}
          {users.data && (
            <Pager total={users.data.total} page={page} onPage={setPage} />
          )}
        </DataState>
        {selected && cat.data && (
          <Drawer
            title={selected.display_name + "的权益"}
            subtitle={selected.username + " · " + selected.uid}
            busy={c.busy}
            error={c.error}
            notice={c.notice}
            onClose={() => setSelected(null)}
          >
            <UserEditor
              key={selected.uid}
              {...cx}
              user={selected}
              onClose={() => setSelected(null)}
            />
          </Drawer>
        )}
      </>
    );
  if (["products", "features", "plans"].includes(c.tab)) {
    const labels: Any = {
        products: "产品",
        features: "功能",
        plans: "套餐权益",
      },
      type = c.tab;
    const rows = (cat.data?.[type] || []).filter(
      (r: Any) =>
        (!filters.product ||
          (type === "products" ? r.id : r.product_id) === filters.product) &&
        (!filters.q ||
          [r.name, r.id]
            .join(" ")
            .toLowerCase()
            .includes(filters.q.toLowerCase())) &&
        (!filters.status ||
          (filters.status === "active") ===
            (r.status !== "disabled" && r.active !== false)),
    );
    return (
      <>
        <PageTitle
          title={labels[type] + "管理"}
          description="按产品配置功能和套餐，让每一份权益规则清晰可查。"
        >
          <button
            className="primary"
            onClick={() =>
              setEditor({ product_id: filters.product || undefined })
            }
          >
            <Plus size={17} />
            新增{labels[type]}
          </button>
        </PageTitle>
        <div className="catalog-tabs" aria-label="产品配置分类">
          {[
            ["products", "产品与接入"],
            ["features", "功能规则"],
            ["plans", "套餐权益"],
          ].map(([id, label]) => (
            <a
              key={id}
              className={type === id ? "selected" : ""}
              href={
                "/admin?tab=" +
                id +
                (filters.product
                  ? "&product=" + encodeURIComponent(filters.product)
                  : "")
              }
            >
              {label}
            </a>
          ))}
        </div>
        <div className="ops-toolbar">
          <Field label="名称 / 标识">
            <input
              placeholder="搜索配置"
              value={filters.q}
              onChange={(e) => change("q", e.target.value)}
            />
          </Field>
          {productFilter}
          <Field label="状态">
            <select
              value={filters.status}
              onChange={(e) => change("status", e.target.value)}
            >
              <option value="">全部状态</option>
              <option value="active">启用</option>
              <option value="disabled">停用</option>
            </select>
          </Field>
          {reset}
        </div>
        <DataState {...cat}>
          {rows.length ? (
            <div className="table-wrap ops-table">
              <table>
                <thead>
                  <tr>
                    <th>名称 / 标识</th>
                    <th>{type === "products" ? "应用映射" : "所属产品"}</th>
                    <th>{type === "products" ? "接入配置" : "权益规则"}</th>
                    <th>状态</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.slice((page - 1) * 20, page * 20).map((r: Any) => (
                    <tr key={(r.product_id || "") + r.id}>
                      <td data-label="名称">
                        <strong>{r.name}</strong>
                        <small className="mono">{r.id}</small>
                      </td>
                      <td data-label={type === "products" ? "应用" : "产品"}>
                        {type === "products"
                          ? r.application
                          : productName(r.product_id)}
                      </td>
                      <td data-label="配置">
                        {type === "products" ? (
                          <>
                            <span className="break-text">{r.origin}</span>
                            <small className="truncate" title={r.callback_url}>
                              回调：{r.callback_url}
                            </small>
                            <small>接入：{r.integration_status}</small>
                            <small>
                              产品验证：
                              {r.verified_at
                                ? `${r.verified_environment} · ${date(r.verified_at)}`
                                : "尚无运行验证记录"}
                            </small>
                            {r.last_check && (
                              <small>
                                配置检查：
                                {r.last_check.passed
                                  ? "一致"
                                  : "存在缺项"} ·{" "}
                                {date(r.last_check.checked_at)} ·{" "}
                                {r.last_check.environment}
                                <br />
                                {r.last_check.missing.join("；")}
                              </small>
                            )}
                            <button
                              onClick={() =>
                                c.perform(async () => {
                                  await api(
                                    "/api/admin/products/" + r.id + "/check",
                                    {},
                                  );
                                  setV((v) => v + 1);
                                }, "配置检查已完成；不等于产品验收通过")
                              }
                            >
                              检查配置
                            </button>
                            <div className="inline-links">
                              <a href={"/admin?tab=features&product=" + r.id}>
                                功能
                              </a>
                              <a href={"/admin?tab=plans&product=" + r.id}>
                                套餐
                              </a>
                            </div>
                          </>
                        ) : type === "features" ? (
                          <>
                            <span>
                              {r.kind === "quota"
                                ? `免费 ${r.free_quota} 次 · ${periods[r.period]}`
                                : "访问权限 · 不扣次数"}
                            </span>
                            <small>
                              {r.member_only
                                ? "仅有效会员可用"
                                : "免费用户可用"}
                            </small>
                          </>
                        ) : (
                          <>
                            <span>会员 {r.days} 天</span>
                            <small>
                              {Object.entries(r.quotas)
                                .map(
                                  ([f, n]) =>
                                    `${featureName(r.product_id, f)} ${n} 次`,
                                )
                                .join(" · ") || "不包含次数额度"}
                            </small>
                          </>
                        )}
                      </td>
                      <td data-label="状态">
                        <Tag
                          tone={
                            r.status === "disabled" || r.active === false
                              ? "neutral"
                              : "green"
                          }
                        >
                          {r.status === "disabled" || r.active === false
                            ? "停用"
                            : "启用"}
                        </Tag>
                      </td>
                      <td data-label="操作">
                        <button onClick={() => setEditor(r)}>
                          编辑 <ChevronRight size={14} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty>没有符合条件的配置。</Empty>
          )}
          <Pager total={rows.length} page={page} onPage={setPage} />
        </DataState>
        {editor && cat.data && (
          <Drawer
            title={(editor.id ? "编辑" : "新增") + labels[type]}
            onClose={() => setEditor(null)}
            busy={c.busy}
            error={c.error}
          >
            <CatalogEditor
              key={type + JSON.stringify(editor)}
              {...cx}
              type={type}
              value={editor}
              onClose={() => setEditor(null)}
            />
          </Drawer>
        )}
      </>
    );
  }
  if (c.tab === "codes")
    return (
      <>
        <PageTitle
          title="兑换码"
          description="按产品发放会员、次数或组合权益。完整兑换码仅在创建后显示一次。"
        >
          <button
            className="primary"
            onClick={() => {
              setRevealed("");
              setEditor({});
            }}
          >
            <Plus size={17} />
            创建兑换码
          </button>
        </PageTitle>
        {revealed && (
          <div className="panel code-reveal">
            <Tag tone="green">创建成功</Tag>
            <h2>请保存完整兑换码</h2>
            <p>离开此页面后无法再次查看，请妥善保管。</p>
            <code>{revealed}</code>
            <button
              onClick={() =>
                c.perform(
                  () => navigator.clipboard.writeText(revealed),
                  "兑换码已复制",
                )
              }
            >
              <Copy size={16} />
              复制兑换码
            </button>
            <button onClick={() => setRevealed("")}>已保存，收起</button>
          </div>
        )}
        <div className="ops-toolbar">
          <Field label="兑换码尾号">
            <input
              value={filters.q}
              onChange={(e) => change("q", e.target.value)}
              placeholder="输入尾号"
            />
          </Field>
          {productFilter}
          <Field label="可用状态">
            <select
              value={filters.status}
              onChange={(e) => change("status", e.target.value)}
            >
              <option value="">全部状态</option>
              <option value="available">可用</option>
              <option value="expired">已过期</option>
              <option value="exhausted">已用尽</option>
              <option value="disabled">已停用</option>
            </select>
          </Field>
          {reset}
        </div>
        <DataState {...codes}>
          {codes.data?.items.length ? (
            <div className="table-wrap ops-table">
              <table>
                <thead>
                  <tr>
                    <th>兑换码 / 产品</th>
                    <th>兑换权益</th>
                    <th>领取进度</th>
                    <th>截止时间</th>
                    <th>状态</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {codes.data.items.map((r: Any) => {
                    const state = !r.active
                      ? "已停用"
                      : new Date(r.expires_at) <= new Date()
                        ? "已过期"
                        : r.uses >= r.max_uses
                          ? "已用尽"
                          : "可用";
                    return (
                      <tr key={r.id}>
                        <td data-label="兑换码">
                          <strong className="mono">…{r.hint}</strong>
                          <small>{productName(r.product_id)}</small>
                        </td>
                        <td data-label="权益">
                          {r.days > 0 && <div>会员 {r.days} 天</div>}
                          {r.amount > 0 && (
                            <div>
                              {featureName(r.product_id, r.feature_id)}{" "}
                              {r.amount} 次
                            </div>
                          )}
                        </td>
                        <td data-label="领取进度">
                          {r.uses} / {r.max_uses}
                          <progress
                            value={r.uses}
                            max={r.max_uses}
                            aria-label="兑换领取进度"
                          />
                        </td>
                        <td data-label="截止时间">{date(r.expires_at)}</td>
                        <td data-label="状态">
                          <Tag
                            tone={
                              state === "可用"
                                ? "green"
                                : state === "已过期"
                                  ? "amber"
                                  : "neutral"
                            }
                          >
                            {state}
                          </Tag>
                        </td>
                        <td data-label="操作">
                          <button
                            className={r.active ? "danger" : ""}
                            onClick={() => setEditor({ statusCode: r })}
                          >
                            {r.active ? "停用" : "启用"}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty>没有符合条件的兑换码。</Empty>
          )}
          {codes.data && (
            <Pager total={codes.data.total} page={page} onPage={setPage} />
          )}
        </DataState>
        {editor && cat.data && (
          <Drawer
            title={editor.statusCode ? "变更兑换码状态" : "创建兑换码"}
            onClose={() => setEditor(null)}
            busy={c.busy}
            error={c.error}
          >
            {editor.statusCode ? (
              <>
                <div className="operation-preview">
                  兑换码尾号 …{editor.statusCode.hint} ·{" "}
                  {productName(editor.statusCode.product_id)}
                  <p>
                    {editor.statusCode.active
                      ? "停用后将立即停止新的兑换，已领取权益不变。"
                      : "启用后仍需满足有效期和剩余领取次数。"}
                  </p>
                </div>
                <ReasonAction
                  title="变更兑换码状态"
                  onClose={() => setEditor(null)}
                  busy={c.busy}
                  onSubmit={(reason) =>
                    c.perform(async () => {
                      await api(
                        `/api/admin/codes/${editor.statusCode.id}/status`,
                        { active: !editor.statusCode.active, reason },
                      );
                      done();
                    })
                  }
                />
              </>
            ) : (
              <CodeEditor
                {...cx}
                onClose={() => setEditor(null)}
                onCreated={(s) => {
                  setRevealed(s);
                  done();
                }}
              />
            )}
          </Drawer>
        )}
      </>
    );
  if (["ledger", "audit"].includes(c.tab))
    return <OpsRecords key={c.tab} {...c} version={v} cat={cat.data} />;
  return <Subscriptions {...c} />;
}
function Subscriptions(c: Context) {
  const [v, setV] = useState(0),
    [scope, setScope] = useState("all"),
    [tab, setTab] = useState("subscriptions"),
    [page, setPage] = useState(1);
  const [syncing, setSyncing] = useState(false);
  const subs = useData("/api/admin/subscriptions", v);
  const states: Any = {
    Active: "生效中",
    Suspended: "已暂停",
    Expired: "已到期",
    Pending: "待处理",
    Paid: "已支付",
    Created: "已创建",
    Canceled: "已取消",
    Cancelled: "已取消",
    Error: "异常",
    Timeout: "已超时",
  };
  const isTest = (r: Any) => r.is_test === true || r.type === "Dummy";
  const rows = (subs.data?.[tab] || []).filter(
    (r: Any) => scope === "all" || (scope === "test") === isTest(r),
  );
  return (
    <>
      <PageTitle
        title="订阅与支付"
        description="查看商户配置、权益同步及 Casdoor 业务记录。"
      >
        <button
          disabled={c.busy}
          onClick={() =>
            c.perform(async () => {
              setSyncing(true);
              try {
                await api("/api/admin/reconcile", {});
              } finally {
                setSyncing(false);
                setV((v) => v + 1);
              }
            }, "同步已完成，请查看本次结果及异常记录")
          }
        >
          <RefreshCw size={16} />
          同步订阅权益
        </button>
      </PageTitle>
      <section className="payment-banner">
        <div className="status-symbol">
          <CreditCard size={22} />
        </div>
        <div>
          <h2>
            真实收费尚未启用 <Tag tone="amber">待配置商户</Tag>
          </h2>
          <p>当前可使用管理员开通和兑换码发放权益。本地测试不产生真实交易。</p>
        </div>
        <a className="button" href={"/admin/providers"}>
          服务商配置 <ArrowUpRight size={15} />
        </a>
      </section>
      <DataState {...subs}>
        <div className="stat-grid">
          {[
            ["Casdoor 订阅数", subs.data?.subscriptions.length],
            ["支付记录", subs.data?.payments.length],
            ["已同步的产品权益", subs.data?.projections.length],
          ].map(([label, value]) => (
            <div className="stat-card" key={label}>
              <span>{label}</span>
              <strong>{value ?? "—"}</strong>
            </div>
          ))}
        </div>
        <section className="panel sync-panel">
          <div>
            <h2>权益同步</h2>
            <p>
              最近核对：
              {subs.data?.lastAttempt
                ? date(subs.data.lastAttempt.started_at)
                : "尚未执行"}
            </p>
          </div>
          <Tag
            tone={
              subs.data?.lastAttempt?.status === "success" ? "green" : "amber"
            }
          >
            {syncing
              ? "正在同步"
              : (
                  {
                    processing: "正在同步",
                    success: "同步成功",
                    partial: "部分异常",
                    failed: "同步失败",
                  } as Any
                )[subs.data?.lastAttempt?.status as string] || "尚未同步"}
          </Tag>
          <p>
            最近成功：
            {subs.data?.lastSuccess
              ? date(subs.data.lastSuccess.finished_at)
              : "尚无成功记录"}
          </p>
          {subs.data?.lastAttempt?.result && (
            <div>
              <p>
                处理 {subs.data.lastAttempt.result.seen || 0} 条；同步{" "}
                {subs.data.lastAttempt.result.projected || 0} 条；跳过{" "}
                {subs.data.lastAttempt.result.skipped || 0} 条。
              </p>
              {subs.data.lastAttempt.result.message && (
                <p role="alert">{subs.data.lastAttempt.result.message}</p>
              )}
              {subs.data.lastAttempt.result.errors?.map((e: Any, i: number) => (
                <p key={i} role="alert">
                  {e.source}：用户或有效期数据不完整，请在 Casdoor 检查订阅。
                </p>
              ))}
            </div>
          )}
          <details>
            <summary>查看同步规则与本地测试状态</summary>
            <p>
              每 5 分钟自动核对。需要付款的订阅以 Casdoor
              已支付记录为依据，浏览器返回页不作为支付依据。
            </p>
            {subs.data?.testPayment && (
              <p>
                官方 Dummy 本地测试于 {date(subs.data.testPayment.verified_at)}{" "}
                验证，测试购买入口已关闭。
              </p>
            )}
          </details>
        </section>
        <div className="section-heading">
          <h2>业务记录</h2>
          <div className="inline-links">
            <a href={"/admin/plans"}>
              管理原生套餐 <ArrowUpRight size={14} />
            </a>
            <a href={"/admin/" + tab}>
              在 Casdoor 查看 <ArrowUpRight size={14} />
            </a>
          </div>
        </div>
        <div className="ops-toolbar">
          <Field label="数据范围">
            <select
              value={scope}
              onChange={(e) => {
                setScope(e.target.value);
                setPage(1);
              }}
            >
              <option value="all">全部记录</option>
              <option value="business">非测试账号记录</option>
              <option value="test">测试相关记录</option>
            </select>
          </Field>
          <p className="muted">按账号测试标记与支付提供者类型区分测试记录</p>
        </div>
        {rows.length ? (
          <div className="table-wrap ops-table">
            <table>
              <thead>
                <tr>
                  <th>{tab === "payments" ? "交易" : "订阅"}</th>
                  <th>用户</th>
                  <th>套餐 / 产品</th>
                  <th>状态</th>
                  <th>{tab === "payments" ? "金额" : "到期时间"}</th>
                </tr>
              </thead>
              <tbody>
                {rows.slice((page - 1) * 20, page * 20).map((s: Any) => (
                  <tr key={s.owner + "/" + s.name}>
                    <td data-label="记录">
                      <strong>{s.displayName || s.name}</strong>
                      {isTest(s) && (
                        <small>
                          <Tag>本地测试</Tag>
                        </small>
                      )}
                    </td>
                    <td data-label="用户">{s.user || "—"}</td>
                    <td data-label="套餐">
                      {s.plan || s.productName || s.product || "—"}
                    </td>
                    <td data-label="状态">
                      <Tag
                        tone={
                          ["Active", "Paid"].includes(s.state)
                            ? "green"
                            : "neutral"
                        }
                      >
                        {states[s.state] || s.state || "—"}
                      </Tag>
                    </td>
                    <td data-label={tab === "payments" ? "金额" : "到期"}>
                      {tab === "payments"
                        ? `${s.price ?? "—"} ${s.currency || ""}`
                        : date(s.endTime)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty>
            没有符合条件的{tab === "payments" ? "支付" : "订阅"}记录。
          </Empty>
        )}
        <Pager total={rows.length} page={page} onPage={setPage} />
      </DataState>
    </>
  );
}

type EditorContext = Context & { cat: Any; done: () => void };
function ReasonAction({
  title,
  onClose,
  onSubmit,
  busy,
}: {
  title: string;
  onClose: () => void;
  onSubmit: (reason: string) => void;
  busy: boolean;
}) {
  return (
    <section className="panel editor">
      <div className="section-heading">
        <h2>{title}</h2>
        <button onClick={onClose}>关闭</button>
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit(String(new FormData(e.currentTarget).get("reason")));
        }}
      >
        <Field label="变更原因">
          <input name="reason" required minLength={2} maxLength={500} />
        </Field>
        <div className="form-actions">
          <button type="button" onClick={onClose} disabled={busy}>
            取消
          </button>
          <button className="danger-solid" disabled={busy}>
            {busy ? "正在提交…" : "确认变更"}
          </button>
        </div>
      </form>
    </section>
  );
}
function UserEditor(c: EditorContext & { user: Any; onClose: () => void }) {
  const [v, setV] = useState(0),
    [status, setStatus] = useState(false);
  const rights = useData(`/api/admin/users/${c.user.uid}/entitlements`, v);
  const [product, setProduct] = useState(c.cat?.products[0]?.id || ""),
    [kind, setKind] = useState("membership"),
    [days, setDays] = useState(30),
    [amount, setAmount] = useState(10);
  const [actual, setActual] = useState<Any | null>(null);
  const currentRights = rights.data?.find((r: Any) => r.product.id === product);
  const currentEnd = currentRights?.membership.expires_at
    ? new Date(currentRights.membership.expires_at).getTime()
    : 0;
  const estimate = new Date(Math.max(Date.now(), currentEnd) + days * 86400000);
  const fs =
    c.cat?.features.filter(
      (f: Any) => f.product_id === product && f.kind === "quota" && f.active,
    ) || [];
  return (
    <section className="panel editor">
      <div className="section-heading">
        <div>
          <h2>{c.user.display_name} 的权益</h2>
          <small className="uid">{c.user.uid}</small>
        </div>
        <button onClick={c.onClose}>关闭</button>
      </div>
      <DataState {...rights}>
        {rights.data && (
          <div className="compact-rights">
            <div className="product-switch" aria-label="选择产品">
              {rights.data.map((e: Any) => (
                <button
                  type="button"
                  key={e.product.id}
                  aria-pressed={product === e.product.id}
                  className={product === e.product.id ? "selected" : ""}
                  onClick={() => setProduct(e.product.id)}
                >
                  {e.product.name}
                </button>
              ))}
            </div>
            {rights.data
              .filter((e: Any) => e.product.id === product)
              .map((e: Any) => (
                <div key={e.product.id}>
                  <strong>{e.product.name}</strong>
                  <span>
                    <Tag tone={e.membership.active ? "green" : "neutral"}>
                      {e.membership.active
                        ? "有效会员"
                        : e.membership.expires_at
                          ? "会员已到期"
                          : "未开通会员"}
                    </Tag>
                    {e.membership.expires_at &&
                      ` 到期 ${date(e.membership.expires_at)}`}
                  </span>
                  <span>
                    {e.features
                      .filter((f: Any) => f.kind === "quota")
                      .map((f: Any) => `${f.name} ${f.remaining} 次`)
                      .join(" · ")}
                  </span>
                  {e.features
                    .filter((f: Any) => f.kind === "quota")
                    .map((f: Any) => (
                      <QuotaSources key={f.id} feature={f} />
                    ))}
                </div>
              ))}
          </div>
        )}
      </DataState>
      {actual && (
        <div className="operation-preview" role="status">
          已保存。服务端实际结果：{actual.product.name}，会员
          {actual.membership.active
            ? "有效，到期 " + date(actual.membership.expires_at)
            : "未生效"}
          ；
          {actual.features
            .filter((f: Any) => f.kind === "quota")
            .map((f: Any) => f.name + " " + f.remaining + " 次")
            .join("；")}
        </div>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget),
            body: Any = {
              uid: c.user.uid,
              product_id: product,
              kind,
              reason: f.get("reason"),
            };
          if (kind === "membership") body.days = Number(f.get("days"));
          if (kind === "quota" || kind === "revoke_quota")
            body.feature_id = f.get("feature_id");
          if (kind === "quota") {
            body.amount = Number(f.get("amount"));
            body.expires_at = f.get("expires_at")
              ? new Date(String(f.get("expires_at"))).toISOString()
              : null;
          }
          c.perform(async () => {
            const saved = await api("/api/admin/grants", body);
            setActual(saved.entitlement);
            setV((v) => v + 1);
            c.done();
          }, "权益已更新");
        }}
      >
        <div className="form-grid">
          <Field label="操作">
            <select value={kind} onChange={(e) => setKind(e.target.value)}>
              <option value="membership">开通 / 续期会员</option>
              <option value="quota">赠送次数</option>
              <option value="revoke_membership">撤销会员</option>
              <option value="revoke_quota">撤销可用次数</option>
            </select>
          </Field>
          {kind === "membership" && (
            <Field
              label="会员天数"
              hint="从当前时间与原到期时间中较晚者继续计算"
            >
              <input
                name="days"
                type="number"
                min={1}
                max={36500}
                required
                value={days}
                onChange={(e) => setDays(Number(e.target.value))}
              />
            </Field>
          )}
          {["quota", "revoke_quota"].includes(kind) && (
            <Field label="计次功能">
              <select name="feature_id">
                {fs.map((f: Any) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </select>
            </Field>
          )}
          {kind === "quota" && (
            <>
              <Field label="赠送次数">
                <input
                  name="amount"
                  type="number"
                  required
                  min={1}
                  max={1000000}
                  value={amount}
                  onChange={(e) => setAmount(Number(e.target.value))}
                />
              </Field>
              <Field
                label="次数到期时间"
                hint="留空表示不过期；与免费额度的重置周期独立"
              >
                <input name="expires_at" type="datetime-local" />
              </Field>
            </>
          )}
        </div>
        <div
          className={
            "operation-preview " +
            (kind.startsWith("revoke") ? "danger-preview" : "")
          }
          role="status"
        >
          <strong>本次操作预览</strong>
          <p>
            {kind === "membership"
              ? `增加 ${days || 0} 天会员，预计到期 ${date(estimate)}`
              : kind === "quota"
                ? `向当前产品赠送 ${amount || 0} 次额度，其他产品不受影响。`
                : kind === "revoke_membership"
                  ? "撤销当前产品由管理员开通的会员。存在有效订阅时，需先在 Casdoor 暂停订阅并核对。"
                  : "撤销所选功能的当前可用次数；其他功能与产品不受影响。"}
          </p>
        </div>
        <Field label="操作原因">
          <input
            name="reason"
            required
            minLength={2}
            maxLength={500}
            placeholder="填写本次开通、赠送或撤销的原因"
          />
        </Field>
        <div className="form-actions">
          <button type="button" onClick={c.onClose} disabled={c.busy}>
            取消
          </button>
          <button
            className={kind.startsWith("revoke") ? "danger-solid" : "primary"}
            disabled={c.busy}
          >
            {c.busy
              ? "正在保存…"
              : kind.startsWith("revoke")
                ? "确认撤销"
                : "保存权益变更"}
          </button>
        </div>
      </form>
      <div className="setting-line">
        <div>
          <h3>测试账号标记</h3>
          <p>
            {c.user.is_test
              ? "已明确标记为测试账号"
              : "未标记；历史名称前缀仅供参考"}
          </p>
        </div>
        <button
          onClick={() => {
            const reason = prompt("填写标记变更原因");
            if (reason)
              c.perform(async () => {
                await api("/api/admin/users/" + c.user.uid + "/test-flag", {
                  is_test: !c.user.is_test,
                  reason,
                });
                c.user.is_test = !c.user.is_test;
                setV((v) => v + 1);
                c.done();
              }, "测试标记已更新");
          }}
        >
          {c.user.is_test ? "取消测试标记" : "标记为测试账号"}
        </button>
      </div>
      <div className="setting-line">
        <div>
          <h3>{c.user.blocked ? "恢复权益平台访问" : "停用权益平台访问"}</h3>
          <p>
            停用立即终止当前用户的平台会话。Casdoor
            身份封禁在原生身份管理页操作。
          </p>
        </div>
        <button
          className={c.user.blocked ? "" : "danger"}
          onClick={() => setStatus(true)}
        >
          {c.user.blocked ? "恢复" : "停用"}
        </button>
      </div>
      {status && (
        <ReasonAction
          title="变更用户状态"
          busy={c.busy}
          onClose={() => setStatus(false)}
          onSubmit={(reason) =>
            c.perform(async () => {
              await api(`/api/admin/users/${c.user.uid}/status`, {
                blocked: !c.user.blocked,
                reason,
              });
              c.done();
              c.onClose();
            }, "用户状态已变更")
          }
        />
      )}
    </section>
  );
}
function CatalogEditor(
  c: EditorContext & { type: string; value: Any; onClose: () => void },
) {
  const r = c.value;
  const [p, setP] = useState(r.product_id || c.cat.products[0]?.id || ""),
    [featureKind, setFeatureKind] = useState(r.kind || "quota");
  return (
    <section className="panel editor">
      <div className="section-heading">
        <h2>{r.id ? "编辑配置" : "新增配置"}</h2>
        <button onClick={c.onClose}>关闭</button>
      </div>
      <form
        key={c.type + JSON.stringify(r)}
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget),
            b: Any = {
              id: f.get("id"),
              name: f.get("name"),
              reason: f.get("reason"),
            };
          if (c.type === "products") {
            Object.assign(b, {
              status: f.get("status"),
              application: f.get("application"),
              callback_url: f.get("callback_url"),
              origin: f.get("origin"),
            });
          } else {
            b.product_id = p;
            b.active = f.get("active") === "on";
            if (c.type === "features")
              Object.assign(b, {
                kind: featureKind,
                member_only: f.get("member_only") === "on",
                free_quota:
                  featureKind === "quota" ? Number(f.get("free_quota")) : 0,
                period: featureKind === "quota" ? f.get("period") : "once",
              });
            else {
              b.days = Number(f.get("days"));
              b.casdoor_plan = f.get("casdoor_plan") || null;
              b.quotas = {};
              for (const feature of c.cat.features.filter(
                (x: Any) => x.product_id === p && x.kind === "quota",
              )) {
                const amount = Number(f.get("quota_" + feature.id));
                if (amount > 0) b.quotas[feature.id] = amount;
              }
            }
          }
          c.perform(async () => {
            await api("/api/admin/catalog/" + c.type, b, "PUT");
            c.done();
          }, "配置已保存");
        }}
      >
        <div className="form-grid">
          {c.type !== "products" && (
            <Field label="所属产品">
              <select
                disabled={!!r.id}
                value={p}
                onChange={(e) => setP(e.target.value)}
              >
                {c.cat.products.map((x: Any) => (
                  <option key={x.id} value={x.id}>
                    {x.name}
                  </option>
                ))}
              </select>
            </Field>
          )}
          <Field
            label="标识"
            hint="小写英文、数字、下划线或连字符；创建后不可更改"
          >
            <input
              name="id"
              readOnly={!!r.id}
              required
              pattern="[a-z][a-z0-9_-]{1,39}"
              defaultValue={r.id}
            />
          </Field>
          <Field label="显示名称">
            <input name="name" required maxLength={80} defaultValue={r.name} />
          </Field>
          {c.type === "products" ? (
            <>
              <Field label="Casdoor 应用名称">
                <input
                  name="application"
                  required
                  defaultValue={r.application}
                />
              </Field>
              <Field label="产品访问地址">
                <input
                  type="url"
                  name="origin"
                  required
                  defaultValue={r.origin}
                />
              </Field>
              <Field label="登录回调地址">
                <input
                  type="url"
                  name="callback_url"
                  required
                  defaultValue={r.callback_url}
                />
              </Field>
              <Field label="产品状态">
                <select name="status" defaultValue={r.status || "active"}>
                  <option value="active">启用</option>
                  <option value="disabled">停用</option>
                </select>
              </Field>
            </>
          ) : c.type === "features" ? (
            <>
              <Field label="功能类型">
                <select
                  name="kind"
                  value={featureKind}
                  onChange={(e) => setFeatureKind(e.target.value)}
                >
                  <option value="quota">次数额度</option>
                  <option value="access">访问权限（不扣次）</option>
                </select>
              </Field>
              {featureKind === "quota" && (
                <>
                  <Field label="免费次数">
                    <input
                      type="number"
                      name="free_quota"
                      min={0}
                      max={1000000}
                      defaultValue={r.free_quota || 0}
                    />
                  </Field>
                  <Field label="免费额度周期">
                    <select name="period" defaultValue={r.period || "once"}>
                      {Object.entries(periods).map(([k, v]) => (
                        <option value={k} key={k}>
                          {v}
                        </option>
                      ))}
                    </select>
                  </Field>
                </>
              )}
              <label className="checkbox">
                <input
                  type="checkbox"
                  name="member_only"
                  defaultChecked={r.member_only}
                />
                仅有效会员可使用
              </label>
            </>
          ) : (
            <>
              <Field label="会员天数">
                <input
                  name="days"
                  type="number"
                  required
                  min={1}
                  max={36500}
                  defaultValue={r.days || 30}
                />
              </Field>
              <Field
                label="Casdoor 套餐映射"
                hint="填写 consumers/商业套餐标识；购买与订阅在 Casdoor 管理，留空则不自动同步此套餐权益"
              >
                <input
                  name="casdoor_plan"
                  defaultValue={r.casdoor_plan || ""}
                />
              </Field>
              {c.cat.features
                .filter((x: Any) => x.product_id === p && x.kind === "quota")
                .map((f: Any) => (
                  <Field key={f.id} label={f.name + " · 套餐次数"}>
                    <input
                      name={"quota_" + f.id}
                      type="number"
                      min={0}
                      max={1000000}
                      defaultValue={r.quotas?.[f.id] || 0}
                    />
                  </Field>
                ))}
            </>
          )}
          {c.type !== "products" && (
            <label className="checkbox">
              <input
                type="checkbox"
                name="active"
                defaultChecked={r.active !== false}
              />
              启用配置
            </label>
          )}
        </div>
        <Field label="变更原因">
          <input name="reason" required minLength={2} maxLength={500} />
        </Field>
        {c.type === "products" && (
          <p className="muted">
            这里保存接入登记。回调变化还需同步 Casdoor
            白名单与产品后端配置；不会向未登记的地址发送令牌。
          </p>
        )}
        <div className="form-actions">
          <button type="button" onClick={c.onClose} disabled={c.busy}>
            取消
          </button>
          <button className="primary" disabled={c.busy}>
            {c.busy ? "正在保存…" : "保存配置"}
          </button>
        </div>
      </form>
    </section>
  );
}
function CodeEditor(
  c: EditorContext & { onClose: () => void; onCreated: (s: string) => void },
) {
  const [p, setP] = useState(c.cat.products[0]?.id || ""),
    [mode, setMode] = useState("membership"),
    [days, setDays] = useState(30),
    [count, setCount] = useState(10);
  return (
    <section className="panel editor">
      <div className="section-heading">
        <h2>创建兑换码</h2>
        <button onClick={c.onClose}>关闭</button>
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          const amount = mode === "membership" ? 0 : Number(f.get("amount"));
          c.perform(async () => {
            const result = await api("/api/admin/codes", {
              product_id: p,
              days: mode === "quota" ? 0 : Number(f.get("days")),
              feature_id: amount > 0 ? f.get("feature_id") : null,
              amount,
              max_uses: Number(f.get("max_uses")),
              expires_at: new Date(String(f.get("expires_at"))).toISOString(),
              quota_expires_at: f.get("quota_expires_at")
                ? new Date(String(f.get("quota_expires_at"))).toISOString()
                : null,
              reason: f.get("reason"),
            });
            c.onCreated(result.code);
          }, "兑换码已创建，请保存完整代码");
        }}
      >
        <div className="form-grid">
          <Field label="产品">
            <select value={p} onChange={(e) => setP(e.target.value)}>
              {c.cat.products.map((p: Any) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="发放内容">
            <select value={mode} onChange={(e) => setMode(e.target.value)}>
              <option value="membership">会员</option>
              <option value="quota">次数额度</option>
              <option value="combined">会员 + 次数额度</option>
            </select>
          </Field>
          {mode !== "quota" && (
            <Field label="会员天数">
              <input
                type="number"
                name="days"
                required
                min={1}
                max={36500}
                value={days}
                onChange={(e) => setDays(Number(e.target.value))}
              />
            </Field>
          )}
          {mode !== "membership" && (
            <>
              <Field label="次数功能">
                <select name="feature_id">
                  {c.cat.features
                    .filter(
                      (f: Any) =>
                        f.product_id === p && f.kind === "quota" && f.active,
                    )
                    .map((f: Any) => (
                      <option key={f.id} value={f.id}>
                        {f.name}
                      </option>
                    ))}
                </select>
              </Field>
              <Field label="赠送次数">
                <input
                  type="number"
                  name="amount"
                  min={1}
                  max={1000000}
                  required
                  value={count}
                  onChange={(e) => setCount(Number(e.target.value))}
                />
              </Field>
            </>
          )}
          <Field label="最多领取人数">
            <input
              type="number"
              name="max_uses"
              required
              min={1}
              max={100000}
              defaultValue={1}
            />
          </Field>
          <Field label="兑换截止时间">
            <input
              type="datetime-local"
              name="expires_at"
              required
              defaultValue={new Date(
                Date.now() +
                  30 * 86400000 -
                  new Date().getTimezoneOffset() * 60000,
              )
                .toISOString()
                .slice(0, 16)}
            />
          </Field>
          {mode !== "membership" && (
            <Field label="赠送次数的到期时间" hint="留空表示赠送次数不过期">
              <input type="datetime-local" name="quota_expires_at" />
            </Field>
          )}
        </div>
        <div className="operation-preview">
          <strong>
            {c.cat.products.find((x: Any) => x.id === p)?.name} · 兑换权益
          </strong>
          <p>
            {mode !== "quota" && `会员 ${days || 0} 天`}
            {mode === "combined" && " + "}
            {mode !== "membership" && `${count || 0} 次额度`}
          </p>
        </div>
        <Field label="发放原因">
          <input name="reason" minLength={2} maxLength={500} required />
        </Field>
        <div className="form-actions">
          <button type="button" onClick={c.onClose} disabled={c.busy}>
            取消
          </button>
          <button className="primary" disabled={c.busy}>
            {c.busy ? "正在创建…" : "创建并显示兑换码"}
          </button>
        </div>
      </form>
    </section>
  );
}

export { api, BusinessAdmin };
export function BusinessView({
  tab,
  onNavigate,
}: {
  tab: string;
  onNavigate?: (href: string) => void;
}) {
  const [me, setMe] = useState<Any | null>(null),
    [cfg, setCfg] = useState<Any | null>(null),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [version, setVersion] = useState(0);
  useEffect(() => {
    let live = true;
    setMe(null);
    setError("");
    Promise.all([api("/api/admin/me"), api("/api/config")])
      .then(([m, c]) => {
        if (live) {
          csrf = m.csrf;
          setMe(m);
          setCfg(c);
        }
      })
      .catch((e) => live && setError(e.message));
    return () => {
      live = false;
      csrf = "";
    };
  }, [version]);
  const c = {
    me: me!,
    cfg: cfg!,
    busy,
    error,
    notice,
    version,
    refresh: () => setVersion((v) => v + 1),
    perform: async (fn: () => Promise<unknown>, message = "操作已完成") => {
      if (busy) return;
      setBusy(true);
      setError("");
      setNotice("");
      try {
        await fn();
        setNotice(message);
      } catch (e: any) {
        setError(e.message);
      } finally {
        setBusy(false);
      }
    },
  };
  return (
    <section
      className="business-surface"
      onClickCapture={(e) => {
        const a = (e.target as HTMLElement).closest("a");
        if (
          !onNavigate ||
          !a ||
          e.ctrlKey ||
          e.metaKey ||
          e.shiftKey ||
          a.target === "_blank"
        )
          return;
        const u = new URL(a.href, location.href);
        if (
          u.origin !== location.origin ||
          !/^\/admin(?:\/|$)/.test(u.pathname)
        )
          return;
        const old = u.searchParams.get("tab");
        if (old) {
          u.pathname =
            "/admin/business/" + (old === "console" ? "diagnostics" : old);
          u.searchParams.delete("tab");
        }
        e.preventDefault();
        onNavigate(u.pathname + u.search + u.hash);
      }}
    >
      <div className="ops-shell">
        {error && (
          <div className="message error" role="alert">
            {error}{" "}
            <button onClick={() => setVersion((v) => v + 1)}>重试</button>{" "}
            <a href="/auth/login?mode=admin">重新登录</a>
          </div>
        )}
        {notice && (
          <div className="message success" role="status">
            {notice}
          </div>
        )}
        {!me || !cfg ? (
          <p role="status">正在加载管理数据…</p>
        ) : tab === "diagnostics" ? (
          <CompleteManagement request={api} casdoor="/admin" />
        ) : tab === "tasks" ? (
          <TaskTrace request={api} />
        ) : (
          <BusinessAdmin key={me.user.uid + ":" + tab} {...c} tab={tab} />
        )}
      </div>
    </section>
  );
}
