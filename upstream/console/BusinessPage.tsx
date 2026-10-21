import React from "react";
import {
  Navigate,
  useLocation,
  useNavigate,
  useParams,
  Link,
} from "react-router-dom";
import { useAccount } from "@/hooks/use-account";
import * as Setting from "@/lib/setting";
import { Button } from "@/components/ui/button";
import { BusinessView } from "./shared";
const labels: Record<string, string> = {
  users: "用户与权益",
  products: "业务产品",
  features: "功能规则",
  plans: "权益套餐",
  codes: "权益兑换码",
  tasks: "消费与任务恢复",
  ledger: "权益流水",
  audit: "业务审计",
  subscriptions: "订阅权益同步",
  diagnostics: "系统诊断",
};
export function ManagementGuard({ children }: { children: React.ReactNode }) {
  const { account, loading } = useAccount();
  const location = useLocation();
  const [state, setState] = React.useState("loading");
  React.useEffect(() => {
    let live = true;
    fetch("/api/admin/me", { credentials: "same-origin" })
      .then((r) => {
        if (live) setState(r.ok ? "ok" : "login");
      })
      .catch(() => live && setState("error"));
    return () => {
      live = false;
    };
  }, [account?.id]);
  if (!Setting.BasePath) return <>{children}</>;
  if (loading || state === "loading")
    return <p role="status">正在验证管理员身份…</p>;
  if (state === "login" || !account) {
    window.location.replace(
      "/auth/login?mode=admin&next=" +
        encodeURIComponent("/admin" + location.pathname + location.search),
    );
    return null;
  }
  if (state === "error")
    return <p role="alert">无法验证管理员会话，请刷新重试。</p>;
  if (!Setting.isLocalAdminUser(account))
    return (
      <p role="alert">
        当前账号没有管理权限。
        <a href="/auth/login?mode=admin&switch=1">切换管理员账号</a>
      </p>
    );
  return <>{children}</>;
}
export function BusinessPage() {
  const { page = "home" } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const { account } = useAccount();
  const [resolved, setResolved] = React.useState("");
  const subject = new URLSearchParams(location.search).get("subject");
  React.useEffect(() => {
    if (!subject) return;
    let live = true;
    fetch(
      "/api/admin/identities/by-subject?subject=" + encodeURIComponent(subject),
    )
      .then((r) => {
        if (!r.ok) throw Error("身份关联不可用");
        return r.json();
      })
      .then((x) => {
        if (live) {
          const q = new URLSearchParams(location.search);
          q.set("q", x.uid);
          navigate(location.pathname + "?" + q, { replace: true });
          setResolved(x.uid);
        }
      })
      .catch(() => live && setResolved("error"));
    return () => {
      live = false;
    };
  }, [subject]);
  React.useEffect(() => {
    const old = new URLSearchParams(location.search).get("tab");
    if (old)
      navigate("/business/" + (old === "console" ? "diagnostics" : old), {
        replace: true,
      });
  }, []);
  if (!account || !Setting.isLocalAdminUser(account))
    return <p role="alert">没有管理权限</p>;
  if (subject && !resolved) return <p role="status">正在关联产品权益…</p>;
  if (resolved === "error")
    return <p role="alert">无法关联该消费者身份，请返回用户列表重试。</p>;
  if (page === "home") return <ManagementHome />;
  if (!labels[page]) return <Navigate to="/" replace />;
  return (
    <BusinessView
      key={account.id + page + location.key}
      tab={page}
      onNavigate={(href) => navigate(href.slice("/admin".length) || "/")}
    />
  );
}
export function ManagementHome() {
  const { account } = useAccount();
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">管理首页</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {account?.displayName || account?.name}，选择今天要处理的事务。
        </p>
      </div>
      <section className="rounded-xl border bg-card p-5">
        <h2 className="font-semibold">用户服务</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          查看身份资料、安全设置和产品权益。
        </p>
        <div className="mt-4 flex flex-wrap gap-3">
          <Button asChild>
            <Link to="/users">查询用户</Link>
          </Button>
          <Button variant="outline" asChild>
            <Link to="/business/codes">管理兑换码</Link>
          </Button>
          <Button variant="outline" asChild>
            <Link to="/business/tasks">查询消费与恢复</Link>
          </Button>
        </div>
      </section>
      <section className="rounded-xl border bg-card p-5">
        <h2 className="font-semibold">产品与商业</h2>
        <div className="mt-4 flex flex-wrap gap-3">
          <Button variant="outline" asChild>
            <Link to="/business/products">业务产品</Link>
          </Button>
          <Button variant="outline" asChild>
            <Link to="/applications">应用接入</Link>
          </Button>
          <Button variant="outline" asChild>
            <Link to="/plans">商业套餐</Link>
          </Button>
          <Button variant="outline" asChild>
            <Link to="/business/subscriptions">核对订阅权益</Link>
          </Button>
        </div>
      </section>
    </div>
  );
}
export const businessLabels = labels;
