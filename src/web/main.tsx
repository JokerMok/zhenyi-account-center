import React, { useEffect, useState, type FormEvent } from "react";
import { createRoot } from "react-dom/client";
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
} from "lucide-react";
import "./style.css";

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
function App() {
  const [cfg, setCfg] = useState<Any | null>(null),
    [me, setMe] = useState<Any | null>(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [tab, setTab] = useState("overview"),
    [version, setVersion] = useState(0);
  const admin = location.pathname.startsWith("/admin");
  const prefix = admin ? "/api/admin" : "/api";
  const refresh = () => setVersion((v) => v + 1);
  useEffect(() => {
    let current = true;
    setLoading(true);
    setMe(null);
    csrf = "";
    Promise.all([
      api("/api/config"),
      api(prefix + "/me").catch((e: any) => {
        if (e.status === 401 || e.status === 403) return null;
        throw e;
      }),
    ])
      .then(([c, u]) => {
        if (current) {
          setCfg(c);
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
  }, [admin, version]);
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
        location.replace(admin ? "/admin" : "/");
      },
      all ? "已退出全部产品" : "已退出当前产品",
    );
  const isDemo = cfg?.id && cfg.id !== "center";
  const nav = admin
    ? [
        ["users", "用户与权益", UserRound],
        ["products", "产品管理", Blocks],
        ["features", "功能配置", Settings2],
        ["plans", "套餐权益", LayoutGrid],
        ["codes", "兑换码", Ticket],
        ["ledger", "权益流水", History],
        ["audit", "操作记录", ShieldCheck],
        ["subscriptions", "订阅与支付", CreditCard],
      ]
    : isDemo
      ? [
          ["overview", "当前产品", LayoutGrid],
          ["records", "任务记录", History],
          ["security", "账号与安全", ShieldCheck],
        ]
      : [
          ["overview", "我的产品", LayoutGrid],
          ["redeem", "兑换权益", Ticket],
          ["records", "权益记录", History],
          ["security", "账号与安全", ShieldCheck],
        ];
  useEffect(() => setTab(admin ? "users" : "overview"), [admin]);
  const context = { cfg: cfg!, me: me!, busy, perform, version, refresh };
  return (
    <div className="shell">
      <aside className="sidebar">
        <a className="brand" href={isDemo ? cfg?.center : "/"}>
          <span className="brand-mark">臻</span>
          <span>
            臻一账号中心
            <small>{admin ? "权益运营" : "一个账号，连接所爱"}</small>
          </span>
        </a>
        <div className="workspace">{admin ? "运营工作区" : "个人空间"}</div>
        <nav>
          {nav.map(([id, label, Icon]) => {
            const I = Icon as typeof LayoutGrid;
            return (
              <button
                key={id as string}
                className={tab === id ? "selected" : ""}
                onClick={() => {
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
          <a href={admin ? "/" : (cfg?.center || "") + "/admin"}>
            <ShieldCheck size={17} />
            {admin ? "返回个人中心" : "运营管理"}
            <ArrowUpRight size={14} />
          </a>
          <p>臻一产品 · 统一身份与权益</p>
        </div>
      </aside>
      <main>
        <header className="topbar">
          <span>
            {admin ? "权益运营" : "个人中心"} <ChevronRight size={14} />{" "}
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
              <a href={"/auth/login" + (admin ? "?mode=admin" : "")}>登录</a>
            )}
          </div>
        </header>
        <div className="content">
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
            <Welcome cfg={cfg} admin={admin} />
          ) : admin ? (
            <Admin {...context} tab={tab} />
          ) : cfg.id === "center" || tab === "security" ? (
            <Consumer {...context} tab={tab} />
          ) : (
            <Demo {...context} tab={tab} />
          )}
        </div>
        <footer>
          臻一账号中心{" "}
          <span>
            本地运行 ·{" "}
            {admin ? "仅授权管理员可操作" : "账号与各产品权益独立管理"}
          </span>
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
};
function Welcome({ cfg, admin }: { cfg: Any; admin: boolean }) {
  return (
    <section className="welcome">
      <div className="welcome-symbol">
        <ShieldCheck size={38} />
      </div>
      <h1>
        {admin
          ? "管理每一份权益"
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
        短信、邮件、微信登录暂未配置。当前可使用用户名和密码。
        {admin && " 初始化凭据保存在本机私密目录，请按 README 获取。"}
      </div>
    </section>
  );
}
function useData(path: string, version = 0) {
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
  }, [path, version]);
  return { data, error };
}
function DataState({
  data,
  error,
  children,
}: {
  data: any;
  error: string;
  children: React.ReactNode;
}) {
  return error ? (
    <div role="alert" className="message error">
      {error}
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
                {e.membership.active ? "会员生效中" : "免费账号"}
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
          <a className="button secondary" href={e.product.origin}>
            打开产品
            <ArrowUpRight size={15} />
          </a>
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
    c.tab === "records" ? "/api/records" : "/api/entitlements",
    c.version + localVersion,
  );
  const records = useData("/api/records", localVersion);
  if (c.tab === "security")
    return (
      <>
        <PageTitle
          title="账号与安全"
          description="你的账号由 Casdoor 统一管理，各产品共享身份，分别保留自己的会话。"
        />
        <section className="panel">
          <h2>{c.me.user.display_name}</h2>
          <dl className="details">
            <dt>用户名</dt>
            <dd>{c.me.user.username}</dd>
            <dt>统一 UID</dt>
            <dd className="uid">{c.me.user.uid}</dd>
            <dt>账号状态</dt>
            <dd>
              <Tag tone="green">正常</Tag>
            </dd>
          </dl>
          <div className="setting-line">
            <div>
              <h3>个人资料与密码</h3>
              <p>重新验证身份后前往统一账号页面，修改资料、密码及安全设置。</p>
            </div>
            <a className="button secondary" href={c.me.profileUrl}>
              管理账号
              <ArrowUpRight size={16} />
            </a>
          </div>
          <div className="setting-line">
            <div>
              <h3>切换账号</h3>
              <p>重新进行身份验证，当前页面不会保留上一账号的数据。</p>
            </div>
            <a className="button secondary" href="/auth/login?switch=1">
              切换账号
            </a>
          </div>
          <div className="setting-line">
            <div>
              <h3>退出全部产品</h3>
              <p>终止账号中心、两个示例产品与统一身份服务的全部会话。</p>
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
          title="兑换一份新可能"
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
                  (r.code_id ? "兑换成功" : r.mode || "核对")}
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
function Demo(c: Context & { tab: string }) {
  const [v, setV] = useState(0),
    [result, setResult] = useState<Any | null>(null);
  const { data, error } = useData("/api/entitlements", v);
  const records = useData("/api/records", v);
  const [request, setRequest] = useState<string>(() => crypto.randomUUID());
  async function run(mode: string) {
    await c.perform(async () => {
      const r = await api("/api/demo", { mode, request_id: request });
      setResult(r);
      setV((v) => v + 1);
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
          这是最小接入演示。录屏示例生成任务文件，不采集屏幕或麦克风。
        </p>
        <Field
          label="业务请求号"
          hint="重复点击沿用同一请求号，最多扣一次；创建新任务后才产生新消费。"
        >
          <input
            value={request}
            onChange={(e) => setRequest(e.target.value)}
            minLength={8}
            maxLength={128}
          />
        </Field>
        <div className="button-row">
          <button
            className="primary"
            disabled={c.busy}
            onClick={() => run("success")}
          >
            执行演示功能
          </button>
          <button disabled={c.busy} onClick={() => run("fail_before")}>
            模拟预占后失败
          </button>
          <button disabled={c.busy} onClick={() => run("fail_after")}>
            模拟消费后返还
          </button>
          <button
            disabled={c.busy}
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
            <Tag tone={result.ok ? "green" : "amber"}>{result.status}</Tag>
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
      <a href="/auth/login?switch=1" className="text-link">
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

function Admin(c: Context & { tab: string }) {
  const [v, setV] = useState(0);
  const cat = useData("/api/admin/catalog", v);
  const [q, setQ] = useState(""),
    [search, setSearch] = useState(""),
    [selected, setSelected] = useState<Any | null>(null),
    [editor, setEditor] = useState<Any | null>(null),
    [revealed, setRevealed] = useState("");
  const users = useData("/api/admin/users?q=" + encodeURIComponent(search), v);
  const records = useData(
    "/api/admin/records/" +
      (["ledger", "audit"].includes(c.tab) ? c.tab : "ledger"),
    v,
  );
  const codes = useData("/api/admin/codes", v),
    subs = useData("/api/admin/subscriptions", v);
  useEffect(() => {
    setEditor(null);
    setRevealed("");
  }, [c.tab]);
  const done = () => {
    setV((v) => v + 1);
    setEditor(null);
  };
  const cx = { ...c, done, cat: cat.data };
  if (c.tab === "users")
    return (
      <>
        <PageTitle
          title="用户与权益"
          description="查询消费者账号，按产品开通会员、赠送或撤销额度。身份资料在 Casdoor 中管理。"
        >
          <a className="button secondary" href={c.cfg.casdoor + "/users"}>
            身份管理
            <ArrowUpRight size={16} />
          </a>
        </PageTitle>
        <form
          className="searchbar"
          onSubmit={(e) => {
            e.preventDefault();
            setSearch(q);
          }}
        >
          <Search size={18} />
          <input
            aria-label="搜索用户"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="用户名、昵称或统一 UID"
          />
          <button>查询</button>
        </form>
        <DataState {...users}>
          {users.data?.length ? (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>用户</th>
                    <th>统一 UID</th>
                    <th>账号状态</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {users.data.map((u: Any) => (
                    <tr key={u.uid}>
                      <td>
                        <strong>{u.display_name}</strong>
                        <small>{u.username}</small>
                      </td>
                      <td className="uid">{u.uid}</td>
                      <td>
                        <Tag
                          tone={
                            u.blocked || u.casdoor_blocked ? "amber" : "green"
                          }
                        >
                          {u.blocked
                            ? "权益停用"
                            : u.casdoor_blocked
                              ? "身份封禁"
                              : "正常"}
                        </Tag>
                      </td>
                      <td>
                        <button onClick={() => setSelected(u)}>
                          管理权益
                          <ChevronRight size={14} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty>尚无消费者账号，可前往注册后查询。</Empty>
          )}
        </DataState>
        {selected && (
          <UserEditor
            {...cx}
            user={selected}
            onClose={() => setSelected(null)}
          />
        )}
      </>
    );
  if (["products", "features", "plans"].includes(c.tab)) {
    const type = c.tab;
    const labels: Any = {
      products: "产品",
      features: "功能",
      plans: "套餐权益",
    };
    return (
      <>
        <PageTitle
          title={labels[type] + "管理"}
          description={
            type === "plans"
              ? "配置会员天数和赠送次数；商业订阅与支付记录由 Casdoor 管理。"
              : "产品、应用与回调需对应实际后端配置；新增产品不会自动获得调用凭据。"
          }
        >
          <button className="primary" onClick={() => setEditor({})}>
            <Plus size={17} />
            新增{labels[type]}
          </button>
        </PageTitle>
        <DataState {...cat}>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>名称</th>
                  <th>产品 / 标识</th>
                  <th>配置</th>
                  <th>状态</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {cat.data?.[type]?.map((r: Any) => (
                  <tr key={(r.product_id || "") + r.id}>
                    <td>
                      <strong>{r.name}</strong>
                    </td>
                    <td>
                      {r.product_id || r.application}
                      <small>{r.id}</small>
                    </td>
                    <td>
                      {type === "products"
                        ? r.callback_url
                        : type === "features"
                          ? `${r.kind === "quota" ? "计次" : "访问权限"} · ${periods[r.period]} · 免费 ${r.free_quota} 次`
                          : `${r.days} 天 · ${Object.entries(r.quotas)
                              .map(([k, n]) => `${k} ${n} 次`)
                              .join("、")}`}
                    </td>
                    <td>
                      <Tag
                        tone={
                          r.status === "disabled" || r.active === false
                            ? "amber"
                            : "green"
                        }
                      >
                        {r.status === "disabled" || r.active === false
                          ? "停用"
                          : "启用"}
                      </Tag>
                    </td>
                    <td>
                      <button onClick={() => setEditor(r)}>编辑</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </DataState>
        {editor && cat.data && (
          <CatalogEditor
            {...cx}
            type={type}
            value={editor}
            onClose={() => setEditor(null)}
          />
        )}
      </>
    );
  }
  if (c.tab === "codes")
    return (
      <>
        <PageTitle
          title="兑换码"
          description="按产品发放会员或次数。明文仅在创建后展示一次，系统保存不可逆摘要。"
        >
          <button className="primary" onClick={() => setEditor({})}>
            <Plus size={17} />
            创建兑换码
          </button>
        </PageTitle>
        {revealed && (
          <div className="panel code-reveal">
            <h2>请现在保存兑换码</h2>
            <p>关闭页面后无法再次查看完整代码。</p>
            <code>{revealed}</code>
            <button
              onClick={() =>
                c.perform(
                  () => navigator.clipboard.writeText(revealed),
                  "兑换码已复制",
                )
              }
            >
              复制兑换码
            </button>
          </div>
        )}
        <DataState {...codes}>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>尾号 / 产品</th>
                  <th>权益</th>
                  <th>领取次数</th>
                  <th>有效期</th>
                  <th>状态</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {codes.data?.map((r: Any) => (
                  <tr key={r.id}>
                    <td>
                      …{r.hint}
                      <small>{r.product_id}</small>
                    </td>
                    <td>
                      {r.days > 0 && `${r.days} 天会员 `}
                      {r.amount > 0 && `${r.feature_id} ${r.amount} 次`}
                    </td>
                    <td>
                      {r.uses} / {r.max_uses}
                    </td>
                    <td>{date(r.expires_at)}</td>
                    <td>
                      <Tag>{r.active ? "启用" : "停用"}</Tag>
                    </td>
                    <td>
                      <button onClick={() => setEditor({ statusCode: r })}>
                        {r.active ? "停用" : "启用"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!codes.data?.length && <Empty />}
        </DataState>
        {editor &&
          cat.data &&
          (editor.statusCode ? (
            <ReasonAction
              title="变更兑换码状态"
              onClose={() => setEditor(null)}
              onSubmit={(reason) =>
                c.perform(async () => {
                  await api(`/api/admin/codes/${editor.statusCode.id}/status`, {
                    active: !editor.statusCode.active,
                    reason,
                  });
                  done();
                })
              }
              busy={c.busy}
            />
          ) : (
            <CodeEditor
              {...cx}
              onClose={() => setEditor(null)}
              onCreated={(s) => {
                setRevealed(s);
                done();
              }}
            />
          ))}
      </>
    );
  if (["ledger", "audit"].includes(c.tab))
    return (
      <>
        <PageTitle
          title={c.tab === "ledger" ? "权益流水" : "管理操作记录"}
          description="按时间倒序展示最近 100 条，详情包含关联请求及变更信息。记录只追加，不支持修改。"
        />
        <DataState {...records}>
          <RecordTable rows={records.data || []} />
        </DataState>
      </>
    );
  return (
    <>
      <PageTitle
        title="订阅与支付"
        description="订阅和交易以 Casdoor 为事实来源。权益服务通过受信任的服务端查询进行投影与核对。"
      >
        <button
          disabled={c.busy}
          onClick={() =>
            c.perform(async () => {
              await api("/api/admin/reconcile", {});
              setV((v) => v + 1);
            }, "订阅核对完成")
          }
        >
          <RefreshCw size={16} />
          重新核对
        </button>
      </PageTitle>
      <section className="panel">
        <Tag tone="amber">未配置真实商户 · 未启用收费</Tag>
        <p>
          官方 Dummy
          仅用于本地支付测试，不产生真实交易。当前可通过管理员开通、兑换码和
          Casdoor 订阅投影生效。
        </p>
        <div className="button-row">
          {[
            ["plans", "套餐"],
            ["subscriptions", "订阅"],
            ["payments", "支付记录"],
            ["providers", "服务商配置"],
          ].map(([p, l]) => (
            <a
              key={p}
              className="button secondary"
              href={c.cfg.casdoor + "/" + p}
            >
              {l}
              <ArrowUpRight size={15} />
            </a>
          ))}
        </div>
      </section>
      <DataState {...subs}>
        <section className="panel">
          <h2>同步状态</h2>
          {subs.data?.testPayment && (
            <p>
              本地 Dummy 测试：已验证于{" "}
              {date(subs.data.testPayment.verified_at)}
              ，无真实收费，测试购买入口已关闭。
            </p>
          )}
          <p>
            最近核对：
            {subs.data?.lastRun
              ? date(subs.data.lastRun.created_at)
              : "尚未执行"}
          </p>
          <p>
            Casdoor 订阅 {subs.data?.subscriptions.length || 0} 条，支付{" "}
            {subs.data?.payments.length || 0} 条，权益投影{" "}
            {subs.data?.projections.length || 0} 条。
          </p>
          <p className="muted">
            自动核对间隔 5 分钟。需要付款的订阅必须对应 Casdoor Paid
            记录；浏览器返回页不作为支付依据。
          </p>
        </section>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>订阅</th>
                <th>用户</th>
                <th>套餐</th>
                <th>状态</th>
                <th>到期</th>
              </tr>
            </thead>
            <tbody>
              {subs.data?.subscriptions.map((s: Any) => (
                <tr key={s.owner + "/" + s.name}>
                  <td>{s.displayName || s.name}</td>
                  <td>{s.user}</td>
                  <td>{s.plan}</td>
                  <td>{s.state}</td>
                  <td>{date(s.endTime)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
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
        <button className="primary" disabled={busy}>
          确认变更
        </button>
      </form>
    </section>
  );
}
function UserEditor(c: EditorContext & { user: Any; onClose: () => void }) {
  const [v, setV] = useState(0),
    [status, setStatus] = useState(false);
  const rights = useData(`/api/admin/users/${c.user.uid}/entitlements`, v);
  const [product, setProduct] = useState("beadgrid"),
    [kind, setKind] = useState("membership");
  const fs =
    c.cat?.features.filter(
      (f: Any) => f.product_id === product && f.kind === "quota",
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
            {rights.data.map((e: Any) => (
              <div key={e.product.id}>
                <strong>{e.product.name}</strong>
                <span>
                  会员：{day(e.membership.expires_at)}{" "}
                  {e.membership.active ? "（有效）" : "（未生效 / 已到期）"}
                </span>
                <span>
                  {e.features
                    .filter((f: Any) => f.kind === "quota")
                    .map((f: Any) => `${f.name} ${f.remaining} 次`)
                    .join(" · ")}
                </span>
              </div>
            ))}
          </div>
        )}
      </DataState>
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
            await api("/api/admin/grants", body);
            setV((v) => v + 1);
            c.done();
          }, "权益已更新");
        }}
      >
        <div className="form-grid">
          <Field label="产品">
            <select
              value={product}
              onChange={(e) => setProduct(e.target.value)}
            >
              {c.cat?.products.map((p: Any) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </Field>
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
                defaultValue={30}
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
                  defaultValue={10}
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
        <Field label="操作原因">
          <input
            name="reason"
            required
            minLength={2}
            maxLength={500}
            placeholder="填写本次开通、赠送或撤销的原因"
          />
        </Field>
        <button className="primary" disabled={c.busy}>
          保存权益变更
        </button>
      </form>
      <div className="setting-line">
        <div>
          <h3>{c.user.blocked ? "恢复权益平台访问" : "停用权益平台访问"}</h3>
          <p>
            停用立即终止当前用户的平台会话。Casdoor
            身份封禁在原生身份管理页操作。
          </p>
        </div>
        <button onClick={() => setStatus(true)}>
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
  const [p, setP] = useState(r.product_id || c.cat.products[0]?.id || "");
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
                kind: f.get("kind"),
                member_only: f.get("member_only") === "on",
                free_quota: Number(f.get("free_quota")),
                period: f.get("period"),
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
                <select name="kind" defaultValue={r.kind || "quota"}>
                  <option value="quota">次数额度</option>
                  <option value="access">访问权限（不扣次）</option>
                </select>
              </Field>
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
                hint="格式 consumers/套餐名；商业订阅在 Casdoor 中创建，留空则不投影该套餐"
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
        <button className="primary" disabled={c.busy}>
          保存配置
        </button>
      </form>
    </section>
  );
}
function CodeEditor(
  c: EditorContext & { onClose: () => void; onCreated: (s: string) => void },
) {
  const [p, setP] = useState(c.cat.products[0]?.id || "");
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
          const amount = Number(f.get("amount"));
          c.perform(async () => {
            const result = await api("/api/admin/codes", {
              product_id: p,
              days: Number(f.get("days")),
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
          <Field label="会员天数（0 表示不发会员）">
            <input
              type="number"
              name="days"
              required
              min={0}
              max={36500}
              defaultValue={30}
            />
          </Field>
          <Field label="次数功能">
            <select name="feature_id">
              {c.cat.features
                .filter((f: Any) => f.product_id === p && f.kind === "quota")
                .map((f: Any) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
            </select>
          </Field>
          <Field label="赠送次数（0 表示不发次数）">
            <input
              type="number"
              name="amount"
              min={0}
              max={1000000}
              required
              defaultValue={0}
            />
          </Field>
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
          <Field label="赠送次数的到期时间" hint="留空表示赠送次数不过期">
            <input type="datetime-local" name="quota_expires_at" />
          </Field>
        </div>
        <Field label="发放原因">
          <input name="reason" minLength={2} maxLength={500} required />
        </Field>
        <button className="primary" disabled={c.busy}>
          创建并显示完整代码
        </button>
      </form>
    </section>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
