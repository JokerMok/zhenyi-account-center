# 真实产品接入

本仓库中的 beadgrid、focustake 是演示产品，本轮没有更改真实拼豆或录屏仓库。下一轮在真实产品仓库内接入时，可复用 `examples/product-client.ts` 和 `src/server/auth.ts` 的授权码处理方式，不需要复制整个管理后台。

## 产品内账号模块与个人中心

产品自己呈现账号菜单、当前产品会员和剩余次数。登录后用产品后端会话查询本产品权益；不要把中心整页复制或iframe嵌入。两个不同布局的实现见 `src/web/product-apps.tsx`，协议封装仍用 `examples/product-client.ts`。

“账号与安全”跳转 `CENTER_URL/?product=已登记产品标识&tab=security`，兑换入口可用 `tab=redeem`。中心只从启用的服务端登记返回可信产品URL；product参数不参与授权，不接受任意return_to。新产品应先在 `config/products.json`登记并重启。不要让浏览器持有产品密钥、数据库密码或管理员凭据。个人中心、各产品、管理后台使用各自会话；管理Cookie不与根消费者身份Cookie混用。

## 接入步骤

1. 为真实产品确定唯一产品标识、后端地址、精确登录回调地址。在 Casdoor 创建 `consumers` 组织下的独立应用，启用授权码、RS256、`JWT-Standard`、登录会话，配置单个精确回调白名单；禁止通配回调。消费者应用启用用户名密码，未配置的短信、邮件、微信提供者保持关闭。
2. 在权益运营登记产品，并配置功能。需要扣次的设为 `quota`；只检查会员资格的设为 `access`。选择免费额度周期，记录日期边界采用 UTC。
3. **以下 setup／start 仅用于本机；生产使用 [正式产品接入](production-integration.md)，禁止在服务器运行本机初始化。** 为产品生成至少 32 字节随机调用密钥，只交给该产品后端。中心端在 `config/products.json` 维护产品标识、应用名、client ID／secret 的环境变量名、调用密钥的环境变量名和 enabled 状态。运行 `npm run setup` 自动为新增的启用登记生成缺少的机器凭据，`npm start` 重启后通过官方接口创建尚不存在的 Casdoor 应用；已有应用 client ID 不一致时拒绝覆盖。无需修改鉴权分支。后台“新增产品”只保存业务元数据，会单独显示鉴权登记状态，不表示实际接入验收完成。
4. 产品后端持有自己的 OIDC client secret 和产品调用密钥。浏览器只拿产品自己的 HttpOnly、SameSite Cookie；生产使用 Secure、无 Domain 的 `__Host-` Cookie。每个真实产品使用独立主机名和自己的会话存储，不复制账号中心数据库密码或管理员凭据。
5. 完成授权码交换，校验 state / nonce / PKCE、ID Token 签名、issuer、audience 和有效期。当前示例的 access token 保存在产品服务端会话中，令牌到期后重新登录，不在浏览器长期保存令牌。
6. 后端将当前会话的 access token 放入 `X-User-Token`，用独立产品密钥调用权益服务。中心从令牌解析用户并返回统一 UID，不能由浏览器提交 `user_id`、`uid` 或切换 `product_id`。已有任务恢复使用下述独立后端凭据入口，不依赖当前用户令牌。
7. 先完成关键验收：同用户跨产品、不同用户切换、到期、重复任务、并发、失败返还和全局退出。然后再开放真实产品入口。

## 服务端接入代码

```ts
import { createEntitlementClient, CenterRequestError } from './product-client';
const rights = createEntitlementClient({
  centerUrl: process.env.ACCOUNTS_URL!,
  productId: 'beadgrid',
  serviceKey: process.env.PRODUCT_SERVICE_KEY!,
});
// token 只能从已认证的服务端会话读取；业务请求号在重试中保持不变。
// job.id 必须是后端持久化的全局唯一业务请求号；重试始终复用它。
// 先持久化 job，再发网络请求，保存预占ID和任务阶段。
let record;
try {
  record = await rights.reserve(session.accessToken, 'export', job.id, 1);
  await jobs.attachReservation(job.id, record.id);
  const confirmed = await rights.confirmKnown(session.accessToken, record.id);
  if (confirmed.status !== 'confirmed') {
    await jobs.recordCenterState(job.id, confirmed.status);
    return { status: 'not_delivered' };
  }
  // 必须从持久化任务幂等执行／交付，不在每次HTTP重试重新运行。
  return await executeAndDeliverOnce(job.id);
} catch (error) {
  if (error instanceof CenterRequestError && error.outcome === 'rejected') {
    await jobs.recordRejection(job.id, error.code); // 本次请求已明确拒绝。
  }
  // 网络超时、连接中断、5xx或不完整响应都可能是“已提交但响应丢失”。
  // 即使本次已明确拒绝，已有任务的历史提交仍需按下面的恢复流程核实。
  await jobs.markPendingRecovery(job.id);
  return { status: 'pending_recovery' };
}

// 后台恢复任务：从可信任务表读取 job.id / reservationId 和真实执行状态。
// 这里不读取浏览器uid，也不要求用户仍然登录。
const saved = await jobs.get(job.id);
try {
  const current = await rights.status(saved.reservationId
    ? { reservation_id: saved.reservationId } : { request_id: saved.id });
  if (current.status === 'confirmed') {
    if (saved.definitelyFailed)
      await rights.recover({ reservation_id: current.id }, 'refund', '后端已核实交付失败');
    else
      await executeAndDeliverOnce(saved.id);
  } else if (current.status === 'reserved' && saved.definitelyFailed) {
    await rights.recover({ reservation_id: current.id }, 'cancel', '后端已核实任务未执行');
  } else {
    await jobs.recordCenterState(saved.id, current.status);
  }
} catch {
  await jobs.markPendingRecovery(saved.id); // 稍后继续，不新开任务或换请求号。
}
```

业务阶段必须明确：权威记录尚未确认且后端已核实失败，用 `cancel`；权威记录已确认且实际交付失败，用 `refund`。客户端 `CenterRequestError.outcome` 区分明确拒绝（rejected）与结果未知（unknown）；超时后先查询或幂等重试，不能直接推断未扣次。不要把任意浏览器“失败”回报直接当作退款依据。网络超时时，使用原请求号查询 / 重试，不能换请求号重新扣次。业务本身也必须幂等；额度幂等不能替代业务任务幂等。

预占有效期为 5 分钟。中心每 30 秒执行释放，服务恢复后继续处理积压，也可执行 `npm run release-holds`。长任务应先选择适当执行方式；本版没有续租接口，不要让长任务依赖永久冻结的额度。进程中断后没有确认的额度会释放；已经确认但没有交付的任务需要后端按任务状态重试或返还。

## 单点登录与退出

登录共享 Casdoor 身份会话，每个产品建立自己的会话。退出当前产品只删除该产品会话，仍可能通过 Casdoor 快速登录。全局退出会删除该 UID 的全部中心 / 示例会话，并调用 Casdoor `/api/sso-logout?logoutAll=true` 撤销上游会话与令牌；其他产品的下一次服务端请求会得到未登录。

真实产品必须在每次敏感操作验证活跃令牌 / 会话，不能永久信任一次 JWT 离线校验结果。独立部署的产品会话可通过每次中心校验和 Casdoor 令牌撤销实现失效；若希望前端立即跳转，可在未来接入经验证的 back-channel logout，本版本没有实现该推送通道。

## 前端生成内容的限制

如果拼豆算法、录屏或导出完全在浏览器执行，用户可能跳过按钮与扣次请求。服务端扣次数只能约束受服务端控制的能力，无法绝对保护浏览器已有的代码和内容。强制执行额度需要将有价值的处理、签名授权资源或交付放在服务端；本地能力的限制应作为产品体验规则，不能宣传为防绕过安全保证。

## 本地与生产差异

本机使用不同端口与不同 Cookie 名，`localhost` Cookie 本身不按端口隔离；产品进程只接受自己的 Cookie，数据库权限另外隔离。生产必须使用不同主机名、HTTPS、Secure / HttpOnly / SameSite Cookie，避免本地同主机的限制。所有示例配置和测试账号都应留在本地。

## 配置第三个产品

在 `config/products.json` 新增一项，例如：

```json
{"id":"third","name":"第三个产品","url":"https://third.example.com","application":"zhenyi-third","clientIdEnv":"CASDOOR_THIRD_CLIENT_ID","clientSecretEnv":"CASDOOR_THIRD_CLIENT_SECRET","serviceKeyEnv":"THIRD_SERVICE_KEY","enabled":true}
```

停止中心后运行 `npm run setup`、`npm start`，缺少的机器密钥自动写入私密 `.env`。将相应 client ID、client secret、产品调用密钥以私密方式交给该产品后端，再在后台登记相同产品标识／应用／精确回调和来源，配置功能。中心会为尚不存在的官方应用设置 `https://third.example.com/auth/callback/third`；真实产品可按实际授权码回调实现调整白名单和业务登记。已有应用的回调变化需在 Casdoor 官方管理中同步，不静默覆盖已有配置。

配置可通过 `PRODUCTS_CONFIG` 指向私密部署文件，启用状态或凭据变更重启生效。每个产品必须有独立调用密钥和 client ID，重复值启动即拒绝。产品普通前端接口不返回服务密钥或 client secret。该产品自行管理会话和任务存储，**不连接账号中心数据库**；`scripts/roles.mjs` 的数据库角色只服务本仓库两个本地示例，不是第三个真实产品的前置要求。

## 可信任务查询与恢复

- `GET /api/v1/products/:product/recovery/reservations?reservation_id=...`，或 `?request_id=...`：仅要求产品后端 Bearer 凭据。返回预占ID、原请求号、产品、功能、数量、状态和时间，不接受用户ID。
- `POST /api/v1/products/:product/recovery`：`{reservation_id, action:"cancel"|"refund", reason}`；也可用原 `request_id` 定位，二者只能选一个。只释放未确认预占或返还已确认消费，不新增额度桶或重新开权益。
- 查询和恢复都严格核对凭据所属产品；普通确认／预占接口仍要求有效用户令牌。恢复重复调用只改变一次账目，变更写入不可变流水和 `task_recovery_audit`。
- 同一产品内业务请求号应由后端生成并保持全局唯一。历史数据若同请求号对应多个用户，查询返回 `AMBIGUOUS_REQUEST`，必须使用可信任务中已保存的预占ID，不能让浏览器补一个用户ID。
- 本仓库两个示例把用户作用域的外部请求号转换为稳定的服务端业务号，并持久化任务、预占ID和恢复状态；每30秒尝试恢复，也可执行 `APP_ID=beadgrid npm run demo:recover`。真实长任务需自己的持久化任务／交付幂等机制。

## 统一管理与商业衔接（2026-10-21）

唯一管理入口5310/admin保留用户、组织、提供者、角色策略、同步、协议及商业模块，并在同一布局内管理业务产品规则和权益；5300仅为统一身份网关。真实产品仍只接OIDC和服务端API，不连接账号中心数据库。应用登记与业务产品元数据分别管理；后台配置检查通过不代表真实产品验收。

Casdoor商业套餐 → 业务套餐的 `casdoor_plan=consumers/原生套餐名` → 活跃订阅（需要付款时还须官方Paid记录）→ 服务端权益投影。消费者中心提供原生定价选购与支付结果后的返回入口；返回只触发可信查询，不携带可修改的会员或次数。失败同步不清空已有效权益，运行状态可在订阅页追溯。真实收费尚未开放，正式接商户需专门验证签名、退款、异常恢复。

`/api/admin/tasks?q=原请求号或预占ID` 是管理员只读运营追踪；产品后端继续使用本文已有任务查询／恢复API，消费者令牌失效后可恢复已有预占。只有中心账目事实、没有产品交付事实时必须显示未知。各产品自行保存业务事实、原请求号与恢复任务，不能把confirmed当成delivered。

额度响应新增 `buckets`（来源、剩余、预占、到期／已过期）及 `next_free_reset_at`。`remaining` 只汇总未过期桶；免费周期按UTC，界面以北京时间说明。管理员只读查看停用或封禁历史不发放免费额度。身份切换后必须丢弃旧用户的缓存和未完成页面状态，后端恢复继续按可信原任务归属执行。
