import React, { useEffect, useState } from "react";
import { Demo, api } from "./views";
import {
  UserRound,
  LogOut,
  ShieldCheck,
  Grid3X3,
  Video,
  ArrowUpRight,
} from "lucide-react";
import "./product.css";
type Any = Record<string, any>;
function useProduct() {
  const [cfg, setCfg] = useState<Any | null>(null),
    [me, setMe] = useState<Any | null>(null),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [version, setVersion] = useState(0);
  useEffect(() => {
    let live = true;
    setMe(null);
    Promise.all([
      api("/api/config"),
      api("/api/me").catch((e) => {
        if (e.status === 401) return null;
        throw e;
      }),
    ])
      .then(([c, m]) => {
        if (live) {
          setCfg(c);
          setMe(m);
          document.title = c.name;
        }
      })
      .catch((e) => live && setError(e.message));
    return () => {
      live = false;
    };
  }, []);
  return {
    cfg: cfg!,
    me: me!,
    error,
    notice,
    busy,
    version,
    refresh: () => setVersion((v) => v + 1),
    perform: async (fn: () => Promise<unknown>, message = "操作已完成") => {
      if (busy) return;
      setBusy(true);
      setError("");
      try {
        await fn();
        setNotice(message);
      } catch (e: any) {
        setError(e.message);
      } finally {
        setBusy(false);
        setVersion((v) => v + 1);
      }
    },
  };
}
function AccountModule({ c }: { c: ReturnType<typeof useProduct> }) {
  const [rights, setRights] = useState<Any | null>(null),
    [error, setError] = useState("");
  useEffect(() => {
    setRights(null);
    setError("");
    if (c.me)
      api("/api/entitlements")
        .then((x) => setRights(x[0]))
        .catch((e) => setError(e.message));
  }, [c.me?.user?.uid, c.version, c.notice]);
  if (!c.me)
    return (
      <a className="button primary" href="/auth/login">
        登录账号
      </a>
    );
  const center = c.cfg.center + "/?product=" + encodeURIComponent(c.cfg.id);
  return (
    <details className="product-account">
      <summary>
        <UserRound size={18} />
        {c.me.user.display_name}
      </summary>
      <div className="product-account-menu">
        <strong>{c.me.user.display_name}</strong>
        {error ? (
          <p role="alert">{error}</p>
        ) : !rights ? (
          <p>正在加载权益…</p>
        ) : (
          <>
            <p>
              {rights.membership.active ? "本产品会员生效中" : "免费账号"}
              {rights.membership.expires_at &&
                " · " +
                  new Date(rights.membership.expires_at).toLocaleDateString(
                    "zh-CN",
                  )}
            </p>
            <p>
              剩余导出次数：
              {rights.features.find((x: Any) => x.id === "export")?.remaining ??
                0}
            </p>
          </>
        )}
        <a href={center + "&tab=redeem"}>
          兑换／开通权益 <ArrowUpRight size={14} />
        </a>
        <a href={center + "&tab=security"}>
          <ShieldCheck size={16} />
          账号与安全
        </a>
        <button
          onClick={() =>
            c.perform(async () => {
              await api("/api/logout", {});
              location.replace("/");
            })
          }
        >
          <LogOut size={16} />
          退出当前产品
        </button>
        <a href="/auth/login?switch=1">切换账号</a>
      </div>
    </details>
  );
}
function Workspace({
  c,
  children,
}: {
  c: ReturnType<typeof useProduct>;
  children: React.ReactNode;
}) {
  if (!c.cfg) return <p role="status">正在加载产品…</p>;
  return (
    <>
      {children}
      {c.error && (
        <p role="alert" className="message error">
          {c.error}
        </p>
      )}
      {c.notice && (
        <p role="status" className="message success">
          {c.notice}
        </p>
      )}
      {c.me ? (
        <Demo {...c} tab="overview" />
      ) : (
        <section className="product-signin">
          <h2>登录后开始使用</h2>
          <p>使用统一账号登录，会员与使用次数由本产品独立管理。</p>
          <a className="button primary" href="/auth/login">
            登录
          </a>
          <a className="button" href={c.cfg.signup}>
            注册账号
          </a>
        </section>
      )}
    </>
  );
}
export function BeadgridApp() {
  const c = useProduct();
  return (
    <div className="product-app beadgrid-app">
      <header className="beadgrid-header">
        <a className="product-brand" href="/">
          <Grid3X3 />
          拼豆工坊
        </a>
        <span>图纸与配色</span>
        {c.cfg && <AccountModule c={c} />}
      </header>
      <main className="beadgrid-workspace">
        <Workspace c={c}>
          <div className="tool-intro">
            <h1>让灵感落在每一颗豆上</h1>
            <p>图纸导出接入示例。账号菜单只展示拼豆工坊的会员与次数。</p>
          </div>
        </Workspace>
      </main>
      <footer>拼豆工坊 · 独立产品接入示例</footer>
    </div>
  );
}
export function FocusTakeApp() {
  const c = useProduct();
  return (
    <div className="product-app focustake-app">
      <header className="focustake-header">
        <a className="product-brand" href="/">
          <Video />
          FocusTake <small>专注录屏</small>
        </a>
        {c.cfg && <AccountModule c={c} />}
      </header>
      <div className="focustake-frame">
        <aside>
          <strong>工作空间</strong>
          <span aria-current="page">任务导出</span>
          <p>本示例生成任务文件，不采集屏幕或麦克风。</p>
        </aside>
        <main>
          <Workspace c={c}>
            <div className="tool-intro">
              <h1>专注此刻，留下重点</h1>
              <p>查看本产品权益并导出演示任务。录屏会员与拼豆会员分别计算。</p>
            </div>
          </Workspace>
        </main>
      </div>
    </div>
  );
}
