# 真实产品接入正式环境

正式个人中心 `https://accounts.shizibandu.icu/`，唯一后台 `/admin`，可信 OIDC issuer 固定为 `https://identity.accounts.shizibandu.icu`。本轮没有修改真实拼豆、录屏仓库，也没有导入其用户、作品或会员。生产没有启动两个本地示例后端；验收产品 acceptance 不是正式拼豆产品，不具备产品调用凭据。

## 为拼豆登记独立应用与产品

1. 在唯一后台“身份认证→应用接入”新增消费者应用，例如 `zhenyi-beadgrid`，组织选 `consumers`，使用服务端授权码、PKCE S256、RS256、JWT-Standard。开启登录会话；精确填写真实拼豆后端 HTTPS 回调，如 `https://真实拼豆域名/auth/callback/beadgrid`。这是占位说明，不能原样保存；实际域名／路径由真实项目确定。禁止通配回调，不复用 center/admin 的 client ID 或 secret。
2. 取得此应用的独立 client ID／secret，密钥只交给真实产品后端。邮件／短信／微信未配置时不勾选；原生本地存储提供者可用于账号头像，不代表已配置验证或支付。
3. 中心生产机器登记位于 `/srv/apps/zhenyi-accounts/shared/config/products.json`（root管理，未纳入Git）。新增下列结构，URL和应用与官方配置保持一致：

```json
{"id":"beadgrid","name":"拼豆","url":"https://真实拼豆域名","application":"zhenyi-beadgrid","clientIdEnv":"CASDOOR_BEADGRID_CLIENT_ID","clientSecretEnv":"CASDOOR_BEADGRID_CLIENT_SECRET","serviceKeyEnv":"BEADGRID_SERVICE_KEY","enabled":true}
```

4. 对应机器凭据存放 `shared/config/app.env`。client ID/secret来自官方应用；独立 service key 使用至少32字节加密随机数生成，不由人手输密码，不复用其他产品。操作前运行项目backup；通过SSH受限编辑或部署秘密管理注入，文件root:zyaccounts、0640。禁止把内容放Git、工单、浏览器或普通日志。设置后重启本项目 center，核对启动验证；生产**禁止运行本机 setup/npm start**，它们会创建本地示例和测试配置。
5. 在“产品与权益→业务产品”保存同名业务产品 `beadgrid`、应用名称、来源和精确回调，再创建功能／权益套餐。`access`只校验功能权限；`quota`计次。免费额度一次性／UTC每日／UTC每月；会员续期取当前时间与原到期较晚者。人工开通填写真实原因并保留审计，不生成虚假支付记录。
6. 后台产品“检查配置”只证明登记匹配；完成真实产品登录、任务、隔离与恢复后，才记录实际环境、时间和验收结果。产品业务启用和鉴权登记独立，元数据保存不等于接入完成。

本轮无需提供拼豆生产数据库，不允许真实产品读取账号中心数据库。当前机器登记为空，等待真实产品确定回调再开放。

## 产品后端环境变量与最小代码

建议真实项目安全配置名称：

```dotenv
ACCOUNTS_URL=https://accounts.shizibandu.icu
OIDC_ISSUER=https://identity.accounts.shizibandu.icu
OIDC_APPLICATION=zhenyi-beadgrid
OIDC_CLIENT_ID=安全获取的独立应用ID
OIDC_CLIENT_SECRET=仅服务端安全注入
OIDC_REDIRECT_URI=https://真实拼豆域名/auth/callback/beadgrid
PRODUCT_ID=beadgrid
PRODUCT_SERVICE_KEY=仅服务端安全注入
```

中心端变量名为登记中的CASDOOR_BEADGRID_CLIENT_ID／CASDOOR_BEADGRID_CLIENT_SECRET／BEADGRID_SERVICE_KEY；产品后端可用上述自己的变量名，值严格对应。运维员通过SSH读取指定产品的必要值并以受控秘密通道注入产品服务，不分发整个app.env，也不授予产品Casdoor管理员凭据。

直接复制 `examples/product-client.ts` 到产品**后端**（仅依赖Node原生fetch），使用：

```ts
const rights = createEntitlementClient({
  centerUrl: process.env.ACCOUNTS_URL!,
  productId: process.env.PRODUCT_ID!,
  serviceKey: process.env.PRODUCT_SERVICE_KEY!,
});
const current = await rights.get(serverSession.accessToken);
const held = await rights.reserve(serverSession.accessToken, 'export', persistentJob.id);
await persistentJobs.saveReservation(persistentJob.id, held.id);
const state = await rights.confirmKnown(serverSession.accessToken, held.id);
// confirmed只代表中心账目已确认；产品必须幂等执行、记录实际交付。
```

完整失败／结果未知恢复代码见 [接入指南](integration.md#服务端接入代码)。重试必须保持原业务请求号；确认超时先查权威状态，已确认但真实任务失败按规则refund，未确认失败cancel；无法核实保留pending_recovery。恢复仅需产品后端凭据及可信原任务ID，不依赖用户仍登录，不接受浏览器可信UID。

OIDC发现地址：`https://identity.accounts.shizibandu.icu/.well-known/zhenyi-beadgrid/openid-configuration`，应用创建后才存在。产品应使用自己技术栈的标准OIDC服务端库；现有可运行授权码／PKCE处理参考 `src/server/auth.ts`、签名与活跃身份校验参考 `src/server/casdoor.ts`。不要复制其中数据库访问到真实产品；登录尝试和会话存到产品自己的存储。必须验证一次性state、nonce、S256、签名、issuer、audience、有效期和精确redirect_uri；使用可信issuer+sub向中心 `/api/v1/products/beadgrid/identity` 取得统一UID。

产品会话使用自己的主机、HttpOnly／Secure／SameSite=Lax Cookie（推荐__Host-前缀，不设Domain），令牌与client secret保留后端。每次敏感业务通过中心核对活跃身份，不能永久依赖一次离线JWT验证。

## 登录、退出与数据隔离

- 登录后回到精确登记的产品回调。账号与安全进入 `ACCOUNTS_URL/?product=beadgrid&tab=security`；返回产品地址只从中心可信登记取得。product仅为展示上下文。
- “退出当前产品”销毁该产品服务端会话及Cookie；需要切换账号时发起prompt=login并清掉旧用户缓存。中心和其他产品会话仍独立。
- “退出全部产品”由当前产品后端携自己的服务密钥和当前access token POST `/api/v1/products/beadgrid/logout-all`，body为`{}`。成功后删除本地会话；其他产品在下次敏感校验时失效。本版没有实时back-channel推送，不声称所有已打开页面立即关闭。
- 权益查询、预占、确认、返还、恢复都只允许产品后端；浏览器调用产品自己的受认证接口。所有用户定位来自可信服务端会话，不能转发浏览器user_id或任意product_id。
- 完全在浏览器运行的算法与导出无法仅靠服务端扣次绝对防绕过。要强制保护，实际处理或交付必须受服务端控制。

## 旧用户、作品和旧会员关联

本轮没有执行迁移。接入真实项目前先备份原系统，建立 `旧产品用户ID ↔ 中心UID ↔ issuer+sub` 显式映射；旧作品继续保留原归属，通过已验证登录后的绑定或双方账号确认关联。不能按昵称／手机号／邮箱自动合并，不能因issuer改动静默创建重复身份。

旧会员按来源、原到期、剩余额度和审计批次迁入业务权益；以旧记录ID为幂等键，先预览核对再明确批准迁移。禁止把历史人工会员伪造成Casdoor已付款订阅。原生商业套餐→订阅→权益投影继续以官方服务端Paid／Active事实核对，真实支付当前关闭。

接入真实拼豆仍需：确认正式回调路径与会话方案；创建独立应用和机器登记；定义export等真实功能、免费次数、会员与额度规则；在拼豆仓库实现上述后端OIDC/API及业务幂等，再执行该产品的跨用户／跨产品、到期、并发、响应丢失和失败返还验收。
