# 真实产品接入

本仓库中的 beadgrid、focustake 是演示产品，本轮没有更改真实拼豆或录屏仓库。下一轮在真实产品仓库内接入时，可复用 `examples/product-client.ts` 和 `src/server/auth.ts` 的授权码处理方式，不需要复制整个管理后台。

## 接入步骤

1. 为真实产品确定唯一产品标识、后端地址、精确登录回调地址。在 Casdoor 创建 `consumers` 组织下的独立应用，启用授权码、RS256、`JWT-Standard`、登录会话，配置单个精确回调白名单；禁止通配回调。消费者应用启用用户名密码，未配置的短信、邮件、微信提供者保持关闭。
2. 在权益运营登记产品，并配置功能。需要扣次的设为 `quota`；只检查会员资格的设为 `access`。选择免费额度周期，记录日期边界采用 UTC。
3. 为产品生成至少 32 字节随机调用密钥，只交给该产品后端。中心端登记这个密钥与产品的固定绑定及 OIDC client ID；当前实现的两项登记在 `src/server/config.ts` 与 `serviceAuth` 白名单。新增第三个产品时需要扩充该显式登记，并为它建立独立会话库或角色；后台“新增产品”仅登记业务元数据，不自动授权。
4. 产品后端持有自己的 OIDC client secret 和产品调用密钥。浏览器只拿产品自己的 HttpOnly、SameSite Cookie；生产使用 Secure、无 Domain 的 `__Host-` Cookie。每个真实产品使用独立主机名和自己的会话存储，不复制账号中心数据库密码或管理员凭据。
5. 完成授权码交换，校验 state / nonce / PKCE、ID Token 签名、issuer、audience 和有效期。当前示例的 access token 保存在产品服务端会话中，令牌到期后重新登录，不在浏览器长期保存令牌。
6. 后端将当前会话的 access token 放入 `X-User-Token`，用独立产品密钥调用权益服务。中心从令牌解析用户并返回统一 UID，不能由浏览器提交 `user_id`、`uid` 或切换 `product_id`。
7. 先完成关键验收：同用户跨产品、不同用户切换、到期、重复任务、并发、失败返还和全局退出。然后再开放真实产品入口。

## 服务端接入代码

```ts
import { createEntitlementClient } from './product-client';
const rights = createEntitlementClient({
  centerUrl: process.env.ACCOUNTS_URL!,
  productId: 'beadgrid',
  serviceKey: process.env.PRODUCT_SERVICE_KEY!,
});
// token 只能从已认证的服务端会话读取；业务请求号在重试中保持不变。
const hold = await rights.reserve(session.accessToken, 'export', job.id, 1);
if (hold.status !== 'reserved' && hold.status !== 'confirmed') throw new Error('任务已终止');
let consumed = false;
try {
  const artifact = await generateOnServer(job);
  const confirmed = await rights.confirm(session.accessToken, hold.id);
  if (confirmed.status !== 'confirmed') throw new Error('预占已超时');
  consumed = true;
  return await deliver(artifact);
} catch (error) {
  // 根据已知业务阶段选择一次 cancel 或 refund；重试相同动作不会重复增加次数。
  if (consumed) await rights.refund(session.accessToken, hold.id);
  else await rights.cancel(session.accessToken, hold.id);
  throw error;
}
```

业务阶段必须明确：确认前失败用 `cancel`，确认后确实需要退次用 `refund`。不要把任意浏览器“失败”回报直接当作退款依据。网络超时时，使用原请求号查询 / 重试，不能换请求号重新扣次。业务本身也必须幂等；额度幂等不能替代业务任务幂等。

预占有效期为 5 分钟。中心每 30 秒执行释放，服务恢复后继续处理积压，也可执行 `npm run release-holds`。长任务应先选择适当执行方式；本版没有续租接口，不要让长任务依赖永久冻结的额度。进程中断后没有确认的额度会释放；已经确认但没有交付的任务需要后端按任务状态重试或返还。

## 单点登录与退出

登录共享 Casdoor 身份会话，每个产品建立自己的会话。退出当前产品只删除该产品会话，仍可能通过 Casdoor 快速登录。全局退出会删除该 UID 的全部中心 / 示例会话，并调用 Casdoor `/api/sso-logout?logoutAll=true` 撤销上游会话与令牌；其他产品的下一次服务端请求会得到未登录。

真实产品必须在每次敏感操作验证活跃令牌 / 会话，不能永久信任一次 JWT 离线校验结果。独立部署的产品会话可通过每次中心校验和 Casdoor 令牌撤销实现失效；若希望前端立即跳转，可在未来接入经验证的 back-channel logout，本版本没有实现该推送通道。

## 前端生成内容的限制

如果拼豆算法、录屏或导出完全在浏览器执行，用户可能跳过按钮与扣次请求。服务端扣次数只能约束受服务端控制的能力，无法绝对保护浏览器已有的代码和内容。强制执行额度需要将有价值的处理、签名授权资源或交付放在服务端；本地能力的限制应作为产品体验规则，不能宣传为防绕过安全保证。

## 本地与生产差异

本机使用不同端口与不同 Cookie 名，`localhost` Cookie 本身不按端口隔离；产品进程只接受自己的 Cookie，数据库权限另外隔离。生产必须使用不同主机名、HTTPS、Secure / HttpOnly / SameSite Cookie，避免本地同主机的限制。所有示例配置和测试账号都应留在本地。
