# 模型 API 与 AI 产品接入

账号中心新增的业务扩展，不是 Casdoor 原生 Agent 或 Casbin 模型功能。入口：
`https://accounts.shizibandu.icu/admin/business/ai`（AI与MCP → 模型 API）。消费者个人中心不显示此配置。

## 管理员

1. 保存 OpenAI 兼容 API 地址、模型 ID、Key、输出上限。当前允许 `https://api-relay.shizibandu.icu/v1`，模型 `gpt-6.1-terra`。
2. 点击“测试已保存配置”，从账号中心服务器分别发起普通请求与 SSE。保存、启用和验证通过是不同状态；测试会产生小额上游调用费用。
3. 勾选对应产品并填写变更原因，保存产品授权。只有业务产品启用且已在私密产品登记中配置后端凭据，才可授权；新产品默认无权。没有自动授权现有拼豆、录屏或其他产品。
4. 产品使用自己的后端凭据请求中心。中转主 Key 不提供读取、复制或下载接口；浏览器与产品接口只看到配置状态及获授权的模型。

Key在业务数据库中使用AES-256-GCM加密；加密材料由既有REDEMPTION_PEPPER经HKDF独立用途派生。数据库与原私密配置须一起备份。不要单独轮换该材料；现有备份会包含新增表，无需新增写权限或公网监听。
如要允许其他模型域名，运维设置 `AI_ALLOWED_HOSTS`（逗号分隔精确主机名）后重启。仅允许HTTPS、443、/v1，禁止携带用户名、密码、查询参数或片段，不跟随重定向。更换域名必须同时提供该服务的新Key。

## 产品后端

沿用已有产品登记和OIDC。所需变量：

- `ACCOUNTS_URL=https://accounts.shizibandu.icu`
- `PRODUCT_ID=已登记的业务产品标识`
- `PRODUCT_SERVICE_KEY=该产品独立后端调用凭据`，从私密登记安全取得，不能使用中转主Key。

每次请求携带当前用户该产品OIDC的 `X-User-Token`，中心验证签名、issuer、audience、时效、身份与封禁状态。调用凭据绑定产品，修改URL中的product不能访问其他产品。

```ts
// 仅在产品服务端运行；userAccessToken来自当前产品服务端会话。
const product = process.env.PRODUCT_ID!;
const root = `${process.env.ACCOUNTS_URL}/api/v1/products/${product}/ai`;
const headers = {
  Authorization: `Bearer ${process.env.PRODUCT_SERVICE_KEY}`,
  "X-User-Token": userAccessToken,
  "Content-Type": "application/json",
};
const cfgResponse = await fetch(`${root}/config`, { headers });
if (!cfgResponse.ok) throw new Error(`模型不可用：${cfgResponse.status}`);
const cfg = await cfgResponse.json(); // model、中心base_url、max_output_tokens；没有上游Key

// requestId持久化到产品任务中，重试或查询不换号。
const response = await fetch(`${root}/chat/completions`, {
  method: "POST",
  headers: { ...headers, "X-Request-ID": requestId },
  body: JSON.stringify({
    model: cfg.model,
    messages: [{ role: "user", content: prompt }],
    stream: false,
    max_completion_tokens: Math.min(1024, cfg.max_output_tokens),
  }),
});
if (!response.ok) {
  // 超时、断流、409、504不能当成未执行，也不自动另起请求。
  const state = await fetch(`${root}/requests/${encodeURIComponent(requestId)}`, { headers });
  // 持久化状态、保留待恢复任务；按真实业务结果处理既有额度预占。
  throw new Error(`请求未完成，需要核对：${response.status}/${state.status}`);
}
const result = await response.json();
// 产品先持久化结果和任务状态，再交付用户。中心不保存提示词和生成正文。
```

`stream:true`使用同一路径，读取标准SSE；中心透传数据并处理背压和连接中断。当前支持纯文本messages（system/developer/user/assistant）、temperature、max_completion_tokens。不声称支持完整OpenAI API：工具调用、多模态、Responses、Embeddings等本轮未实现。

请求号8–128位，使用字母数字或 `_.:-`。同产品同请求号最多受理一次，重复返回409，不自动重放推理，也不缓存生成正文。状态查询限定当前产品与当前用户：

- `processing`：仍在处理；超过2分钟未结束的进程遗留记录按unknown显示。
- `completed`：已收到上游完整响应／SSE结束标记，**不表示产品已持久化或交付**。
- `failed`：上游明确HTTP失败；敏感错误正文不会转给产品。
- `unknown`：超时、断流或进程中断，禁止据此判定模型没执行。

返回 `delivery_status:unknown`，中心无法推断产品交付。模型请求90秒超时，产品每分钟最多20次、同产品最多2个并行请求，中心进程最多8个并行请求。无自动推理重试。

## 会员与次数

模型授权不新建会员、不赠送或扣减次数。产品继续按既有接入协议做权益查询、预占、确认与恢复，避免重复计费。已有额度请求号与模型请求号应绑定同一产品业务任务；结果未知时先查两边状态，保留待恢复，不换号重复执行。中心现有恢复接口可在用户退出后由可信产品后端恢复既有预占；模型推理本身不能撤回，额度返还也不等于供应商退费。

## 运维与回退

迁移 `006_ai_gateway.sql`仅新增业务表，旧版本可继续运行而不删除新增数据。回退源码时保留表和私密机器配置，重新升级仍可读取模型配置。
服务器可信操作者可通过标准输入执行 `npm run ai:configure -- --from-stdin --test`：只设置本次正式中转，保留产品授权，记录管理员审计，打印脱敏测试状态。不要把Key放在命令参数或Git里。此命令不会出现在每次启动／初始化流程中。
