import React, { useEffect, useState } from "react";
type Row = Record<string, any>;
export function AiModels({
  request,
}: {
  request: (path: string, body?: unknown, method?: string) => Promise<any>;
}) {
  const [data, setData] = useState<Row | null>(null),
    [draft, setDraft] = useState<Row | null>(null),
    [key, setKey] = useState(""),
    [showKey, setShowKey] = useState(false),
    [reason, setReason] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  async function reload() {
    const value = await request("/api/admin/ai");
    setData(value);
    setDraft({
      ...value,
      products: value.products.map((p: Row) => ({ ...p })),
    });
  }
  useEffect(() => {
    let live = true;
    request("/api/admin/ai")
      .then((value) => {
        if (live) {
          setData(value);
          setDraft({
            ...value,
            products: value.products.map((p: Row) => ({ ...p })),
          });
        }
      })
      .catch((e) => live && setError(e.message));
    return () => {
      live = false;
      setKey("");
    };
  }, []);
  async function run(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await action();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  const set = (field: string, value: any) =>
    setDraft((old) => ({ ...old, [field]: value }));
  return (
    <>
      <div className="page-title">
        <h1>模型 API</h1>
        <button disabled={busy} onClick={() => run(reload)}>
          刷新
        </button>
      </div>
      {error && (
        <div role="alert" className="message error">
          {error}
          <button disabled={busy} onClick={() => run(reload)}>
            重试
          </button>
        </div>
      )}
      {notice && (
        <div role="status" className="message success">
          {notice}
        </div>
      )}
      {!draft || !data ? (
        <p role="status">正在加载模型配置…</p>
      ) : (
        <>
          <form
            className="panel"
            onSubmit={(e) => {
              e.preventDefault();
              run(async () => {
                await request(
                  "/api/admin/ai",
                  {
                    base_url: draft.base_url,
                    model: draft.model,
                    enabled: draft.enabled,
                    max_output_tokens: Number(draft.max_output_tokens),
                    ...(key ? { api_key: key } : {}),
                    products: draft.products.map((p: Row) => ({
                      product_id: p.id,
                      enabled: p.enabled,
                    })),
                    reason,
                  },
                  "PUT",
                );
                setKey("");
                setReason("");
                await reload();
                setNotice("模型配置与产品授权已保存");
              });
            }}
          >
            <h2>OpenAI 兼容服务</h2>
            <div className="form-grid">
              <label>
                API 地址
                <input
                  type="url"
                  required
                  value={draft.base_url}
                  onChange={(e) => set("base_url", e.target.value)}
                />
              </label>
              <label>
                模型 ID
                <input
                  required
                  value={draft.model}
                  onChange={(e) => set("model", e.target.value)}
                />
              </label>
              <label>
                API Key
                <div className="ai-inline">
                  <input
                    aria-label="模型API Key"
                    type={showKey ? "text" : "password"}
                    autoComplete="new-password"
                    value={key}
                    placeholder={
                      data.has_key ? "已保存；留空保留现有密钥" : "尚未配置"
                    }
                    onChange={(e) => setKey(e.target.value)}
                  />
                  <button
                    type="button"
                    aria-label={showKey ? "隐藏API Key" : "显示API Key"}
                    onClick={() => setShowKey((v) => !v)}
                  >
                    {showKey ? "隐藏" : "显示"}
                  </button>
                </div>
              </label>
              <label>
                单次输出上限
                <input
                  required
                  type="number"
                  min={1}
                  max={32768}
                  value={draft.max_output_tokens}
                  onChange={(e) => set("max_output_tokens", e.target.value)}
                />
              </label>
            </div>
            <label className="ai-inline">
              <input
                type="checkbox"
                checked={draft.enabled}
                onChange={(e) => set("enabled", e.target.checked)}
              />
              启用模型 API
            </label>
            <h2>产品授权</h2>
            {draft.products.length === 0 ? (
              <p>暂无业务产品，先登记产品及后端接入凭据。</p>
            ) : (
              <div className="table-wrap">
                <table className="ops-table">
                  <thead>
                    <tr>
                      <th>产品</th>
                      <th>接入状态</th>
                      <th>允许调用</th>
                    </tr>
                  </thead>
                  <tbody>
                    {draft.products.map((p: Row) => (
                      <tr key={p.id}>
                        <td>
                          {p.name}
                          <small>{p.id}</small>
                        </td>
                        <td>
                          {p.status !== "active"
                            ? "产品已停用"
                            : p.registered
                              ? "已登记后端凭据"
                              : "后端尚未登记"}
                        </td>
                        <td>
                          <input
                            type="checkbox"
                            aria-label={"授权" + p.name}
                            disabled={!p.ready && !p.enabled}
                            checked={p.enabled}
                            onChange={(e) =>
                              set(
                                "products",
                                draft.products.map((x: Row) =>
                                  x.id === p.id
                                    ? { ...x, enabled: e.target.checked }
                                    : x,
                                ),
                              )
                            }
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <label>
              变更原因
              <input
                required
                minLength={2}
                maxLength={500}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </label>
            <div className="actions">
              <button type="submit" disabled={busy}>
                {busy ? "处理中…" : "保存配置"}
              </button>
            </div>
          </form>
          <section className="panel">
            <div className="section-heading">
              <h2>连接测试</h2>
              <button
                disabled={busy || !data.has_key}
                onClick={() =>
                  run(async () => {
                    const result = await request("/api/admin/ai/test", {});
                    await reload();
                    if (result.status !== "success")
                      setError("连接测试未通过，请查看下方原因");
                    else setNotice("普通请求与流式请求均通过");
                  })
                }
              >
                {busy ? "处理中…" : "测试已保存配置"}
              </button>
            </div>
            <p>
              测试会从账号中心服务器发起两次小额模型请求。产品授权只允许调用模型，不会自动开通会员或扣减次数。
            </p>
            {!data.last_check ? (
              <p className="muted">尚未测试当前配置</p>
            ) : (
              <>
                <p>
                  {data.last_check.status === "success"
                    ? "连接正常"
                    : "连接异常"}{" "}
                  ·{" "}
                  {new Date(data.last_check.checked_at).toLocaleString("zh-CN")}
                </p>
                {data.last_check.checks.map((c: Row) => (
                  <p key={String(c.stream)}>
                    {c.stream ? "流式请求" : "普通请求"}：
                    {c.status === "success" ? "通过" : c.detail}
                    {c.http_status ? "（HTTP " + c.http_status + "）" : ""}
                  </p>
                ))}
              </>
            )}
          </section>
          <section className="panel">
            <h2>最近调用</h2>
            {data.recent.length === 0 ? (
              <p>暂无产品调用记录</p>
            ) : (
              <div className="table-wrap">
                <table className="ops-table">
                  <thead>
                    <tr>
                      <th>产品／请求号</th>
                      <th>模型</th>
                      <th>上游结果</th>
                      <th>时间</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.recent.map((r: Row) => (
                      <tr key={r.id}>
                        <td>
                          {r.product_id}
                          <small>{r.request_id}</small>
                        </td>
                        <td>
                          {r.model}
                          {r.stream ? " · 流式" : ""}
                        </td>
                        <td>
                          {
                            (
                              {
                                processing: "处理中",
                                completed: "生成完成",
                                failed: "明确失败",
                                unknown: "结果未知",
                              } as Row
                            )[r.status]
                          }
                          {r.error_code && <small>{r.error_code}</small>}
                        </td>
                        <td>
                          {new Date(r.created_at).toLocaleString("zh-CN")}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </>
  );
}
