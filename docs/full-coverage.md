# Casdoor v4.22.0 完整功能覆盖与实际验收

核对日期：2026-10-21。运行二进制版本 v4.22.0，commit `f11d6aca9ef065b468992de5bb4c3f315710d9f2`。固定源码提取 119 条前端路由、331 条后端路由、47 个导航入口及 164 个显式提供者选项ID。

完整原生前后端与配置页面均保留；本轮改为同一React Router／AppLayout中的原生和业务页面，所有表中管理入口统一加 `/admin` 前缀；没有iframe或DOM注入。下面“已集成并验证”仅指写明的操作，不代表所有提供者、参数组合、硬件及外部系统均验收。逐模块操作证据主要来自前轮完整接入，不能理解为本轮逐项重验；本轮结构、权限与资源定向回归见acceptance.md。全部逐路由来源见 [机器清单](generated/casdoor-v4.22.0-inventory.json)。

| 分类 / 功能 | 统一后台相对入口（5310/admin） | 后端读取接口 | 依赖配置 | 接入状态 / 验证范围 / 剩余 | 官方来源 |
| --- | --- | --- | --- | --- | --- |
| 总览 / 仪表盘 | `/system/dashboard` | `/api/get-dashboard` | 无需外部凭据 | 已集成并验证；原生读取接口通过；不等同该模块所有操作验证。 | [固定源码](https://github.com/casdoor/casdoor/blob/v4.22.0/web/src/App.tsx#L265) |
| 总览 / 快捷操作 | `/shortcuts` | 原生页面组合接口 | 无需外部凭据 | 已配置，尚未验证；页面与原生实现保留；本轮未单独操作验证。 | [固定源码](https://github.com/casdoor/casdoor/blob/v4.22.0/web/src/App.tsx#L267) |
| 总览 / 应用门户 | `/apps` | `/api/get-applications` | 无需外部凭据 | 已集成并验证；原生读取接口通过；不等同该模块所有操作验证。 | [固定源码](https://github.com/casdoor/casdoor/blob/v4.22.0/web/src/App.tsx#L266) |
| 总览 / 系统信息 | `/sysinfo` | `/api/get-version-info` | 无需外部凭据 | 已集成并验证；原生读取接口通过；不等同该模块所有操作验证。 | [固定源码](https://github.com/casdoor/casdoor/blob/v4.22.0/web/src/App.tsx#L270) |
| 用户与组织 / 用户资料 | `/users` | `/api/get-users` | 无需外部凭据 | 已集成并验证；专用用户资料修改，稳定subject保留。 | [固定源码](https://github.com/casdoor/casdoor/blob/v4.22.0/web/src/App.tsx#L275) |
| 用户与组织 / 组织与密码规则 | `/organizations` | `/api/get-organizations` | 无需外部凭据 | 已集成并验证；官方API新增、读取与字段修改通过；具有isEnabled字段的对象验证了停用。未覆盖所有字段组合或外部执行。 | [固定源码](https://github.com/casdoor/casdoor/blob/v4.22.0/web/src/App.tsx#L272) |
| 用户与组织 / 分组与组织树 | `/groups` | `/api/get-groups` | 无需外部凭据 | 已集成并验证；官方API新增、读取与字段修改通过；具有isEnabled字段的对象验证了停用。未覆盖所有字段组合或外部执行。 | [固定源码](https://github.com/casdoor/casdoor/blob/v4.22.0/web/src/App.tsx#L277) |
| 用户与组织 / 注册邀请 | `/invitations` | `/api/get-invitations` | 邮件发送需要邮件提供者 | 已集成并验证；官方注册邀请码新增、读取和停用；邀请码注册领取未另行验证。 | [固定源码](https://github.com/casdoor/casdoor/blob/v4.22.0/web/src/App.tsx#L281) |
| 用户与组织 / 个人资料与账号安全 | `/account` | 原生页面组合接口 | 无需外部凭据 | 已配置，尚未验证；页面与原生实现保留；本轮未单独操作验证。 | [固定源码](https://github.com/casdoor/casdoor/blob/v4.22.0/web/src/App.tsx#L268) |
| 身份与接入 / 应用与协议 | `/applications` | `/api/get-applications` | OIDC/SAML/CAS应用配置及精确回调 | 已集成并验证；官方API新增、读取与字段修改通过；具有isEnabled字段的对象验证了停用。未覆盖所有字段组合或外部执行。 | [固定源码](https://github.com/casdoor/casdoor/blob/v4.22.0/web/src/App.tsx#L284) |
| 身份与接入 / 身份及服务提供者 | `/providers` | `/api/get-providers` | 第三方账号、邮件、短信、存储、支付、验证码等服务需要各自凭据 | 已集成，等待外部配置；官方API新增、读取与字段修改通过；具有isEnabled字段的对象验证了停用。未覆盖所有字段组合或外部执行。 | [固定源码](https://github.com/casdoor/casdoor/blob/v4.22.0/web/src/App.tsx#L286) |
| 身份与接入 / 应用市场 | `/marketplace` | `/api/get-marketplace-index` | 需要访问官方应用市场网络 | 已集成并验证；原生读取接口通过；不等同该模块所有操作验证。 | [固定源码](https://github.com/casdoor/casdoor/blob/v4.22.0/web/src/App.tsx#L288) |
| 身份与接入 / 已安装集成 | `/integrations` | `/api/get-integrations` | 具体集成的外部应用 | 已集成并验证；官方市场真实模板安装、配置读取和卸载；目标外部应用未连接。 | [固定源码](https://github.com/casdoor/casdoor/blob/v4.22.0/web/src/App.tsx#L289) |
| 身份与接入 / 资源与存储 | `/resources` | `/api/get-resources` | 上传需要可用存储提供者 | 已集成并验证；原生本地存储提供者配置、真实上传、下载内容一致、资源记录读取。 | [固定源码](https://github.com/casdoor/casdoor/blob/v4.22.0/web/src/App.tsx#L291) |
| 身份与接入 / 证书 | `/certs` | `/api/get-certs` | 无需外部凭据 | 已集成并验证；官方API新增、读取与字段修改通过；具有isEnabled字段的对象验证了停用。未覆盖所有字段组合或外部执行。 | [固定源码](https://github.com/casdoor/casdoor/blob/v4.22.0/web/src/App.tsx#L292) |
| 身份与接入 / 密钥 | `/keys` | `/api/get-keys` | 无需外部凭据 | 已集成并验证；官方API新增、读取与字段修改通过；具有isEnabled字段的对象验证了停用。未覆盖所有字段组合或外部执行。 | [固定源码](https://github.com/casdoor/casdoor/blob/v4.22.0/web/src/App.tsx#L294) |
| 角色与策略 / 角色 | `/roles` | `/api/get-roles` | 无需外部凭据 | 已集成并验证；官方API新增、读取与字段修改通过；具有isEnabled字段的对象验证了停用。未覆盖所有字段组合或外部执行。 | [固定源码](https://github.com/casdoor/casdoor/blob/v4.22.0/web/src/App.tsx#L297) |
| 角色与策略 / 权限与策略 | `/permissions` | `/api/get-permissions` | 无需外部凭据 | 已集成并验证；官方API新增、读取与字段修改通过；具有isEnabled字段的对象验证了停用。未覆盖所有字段组合或外部执行。 | [固定源码](https://github.com/casdoor/casdoor/blob/v4.22.0/web/src/App.tsx#L299) |
| 角色与策略 / Casbin模型 | `/models` | `/api/get-models` | 无需外部凭据 | 已集成并验证；官方API新增、读取与字段修改通过；具有isEnabled字段的对象验证了停用。未覆盖所有字段组合或外部执行。 | [固定源码](https://github.com/casdoor/casdoor/blob/v4.22.0/web/src/App.tsx#L301) |
| 角色与策略 / 策略适配器 | `/adapters` | `/api/get-adapters` | 独立存储时需要目标数据库 | 已集成并验证；官方API新增、读取与字段修改通过；具有isEnabled字段的对象验证了停用。未覆盖所有字段组合或外部执行。 | [固定源码](https://github.com/casdoor/casdoor/blob/v4.22.0/web/src/App.tsx#L303) |
| 角色与策略 / 策略执行器 | `/enforcers` | `/api/get-enforcers` | 需要模型和适配器 | 已集成并验证；官方API新增、读取与字段修改通过；具有isEnabled字段的对象验证了停用。未覆盖所有字段组合或外部执行。 | [固定源码](https://github.com/casdoor/casdoor/blob/v4.22.0/web/src/App.tsx#L305) |
| AI与MCP / 智能体 | `/agents` | `/api/get-agents` | 外部智能体地址与凭据 | 已集成，等待外部配置；官方API新增、读取与字段修改通过；具有isEnabled字段的对象验证了停用。未覆盖所有字段组合或外部执行。 | [固定源码](https://github.com/casdoor/casdoor/blob/v4.22.0/web/src/App.tsx#L308) |
| AI与MCP / MCP服务器 | `/servers` | `/api/get-servers` | MCP服务地址；远程服务需其授权 | 已集成，等待外部配置；官方API新增、读取与字段修改通过；具有isEnabled字段的对象验证了停用。未覆盖所有字段组合或外部执行。 | [固定源码](https://github.com/casdoor/casdoor/blob/v4.22.0/web/src/App.tsx#L310) |
| AI与MCP / MCP市场 | `/server-store` | `/api/get-servers` | 访问市场网络 | 已集成，等待外部配置；原生读取接口通过；不等同该模块所有操作验证。 | [固定源码](https://github.com/casdoor/casdoor/blob/v4.22.0/web/src/App.tsx#L312) |
| AI与MCP / 接入入口 | `/entries` | `/api/get-entries` | 关联智能体或MCP服务器 | 已集成，等待外部配置；官方API新增、读取与字段修改通过；具有isEnabled字段的对象验证了停用。未覆盖所有字段组合或外部执行。 | [固定源码](https://github.com/casdoor/casdoor/blob/v4.22.0/web/src/App.tsx#L313) |
| AI与MCP / 站点与访问代理 | `/sites` | `/api/get-sites` | 站点域名与上游服务配置 | 已集成，等待外部配置；官方API新增、读取与字段修改通过；具有isEnabled字段的对象验证了停用。未覆盖所有字段组合或外部执行。 | [固定源码](https://github.com/casdoor/casdoor/blob/v4.22.0/web/src/App.tsx#L316) |
| AI与MCP / 转发规则 | `/rules` | `/api/get-rules` | 关联站点和提供者 | 已集成，等待外部配置；官方API新增、读取与字段修改通过；具有isEnabled字段的对象验证了停用。未覆盖所有字段组合或外部执行。 | [固定源码](https://github.com/casdoor/casdoor/blob/v4.22.0/web/src/App.tsx#L318) |
| 会话与审计 / 登录会话 | `/sessions` | `/api/get-sessions` | 无需外部凭据 | 已集成并验证；原生读取接口通过；不等同该模块所有操作验证。 | [固定源码](https://github.com/casdoor/casdoor/blob/v4.22.0/web/src/App.tsx#L321) |
| 会话与审计 / 身份审计日志 | `/records` | `/api/get-records` | 无需外部凭据 | 已集成并验证；原生读取接口通过；不等同该模块所有操作验证。 | [固定源码](https://github.com/casdoor/casdoor/blob/v4.22.0/web/src/App.tsx#L322) |
| 会话与审计 / 访问令牌 | `/tokens` | `/api/get-tokens` | 无需外部凭据 | 已集成并验证；原生读取接口通过；不等同该模块所有操作验证。 | [固定源码](https://github.com/casdoor/casdoor/blob/v4.22.0/web/src/App.tsx#L323) |
| 会话与审计 / 验证记录 | `/verifications` | `/api/get-verifications` | 发送验证依赖邮件或短信 | 已集成，等待外部配置；原生读取接口通过；不等同该模块所有操作验证。 | [固定源码](https://github.com/casdoor/casdoor/blob/v4.22.0/web/src/App.tsx#L325) |
| 商业管理 / 商品商店 | `/product-store` | `/api/get-products` | 可售商品与支付配置 | 已集成并验证；原生读取接口通过；不等同该模块所有操作验证。 | [固定源码](https://github.com/casdoor/casdoor/blob/v4.22.0/web/src/App.tsx#L327) |
| 商业管理 / 商业商品 | `/products` | `/api/get-products` | 无需外部凭据 | 已集成并验证；官方API新增、读取与字段修改通过；具有isEnabled字段的对象验证了停用。未覆盖所有字段组合或外部执行。 | [固定源码](https://github.com/casdoor/casdoor/blob/v4.22.0/web/src/App.tsx#L328) |
| 商业管理 / 支付优惠券 | `/coupons` | `/api/get-coupons` | 无需外部凭据 | 已集成并验证；官方API新增、读取与字段修改通过；具有isEnabled字段的对象验证了停用。未覆盖所有字段组合或外部执行。 | [固定源码](https://github.com/casdoor/casdoor/blob/v4.22.0/web/src/App.tsx#L332) |
| 商业管理 / 购物车 | `/cart` | `/api/get-user` | 无需外部凭据 | 已集成并验证；浏览器加入购物车、创建订单和结算通过。 | [固定源码](https://github.com/casdoor/casdoor/blob/v4.22.0/web/src/App.tsx#L331) |
| 商业管理 / 订单 | `/orders` | `/api/get-orders` | 无需外部凭据 | 已集成并验证；原生CRUD；浏览器真实创建本机模拟购买订单。 | [固定源码](https://github.com/casdoor/casdoor/blob/v4.22.0/web/src/App.tsx#L334) |
| 商业管理 / 支付记录 | `/payments` | `/api/get-payments` | 真实交易需要商户凭据 | 已集成并验证；官方Dummy Paid状态与重复通知幂等通过；真实商户、真实退款未验证。 | [固定源码](https://github.com/casdoor/casdoor/blob/v4.22.0/web/src/App.tsx#L337) |
| 商业管理 / 商业套餐 | `/plans` | `/api/get-plans` | 无需外部凭据 | 已集成并验证；原生套餐CRUD；浏览器Dummy订阅购买和权益映射验证通过。 | [固定源码](https://github.com/casdoor/casdoor/blob/v4.22.0/web/src/App.tsx#L340) |
| 商业管理 / 定价页 | `/pricings` | `/api/get-pricings` | 无需外部凭据 | 已集成并验证；原生定价CRUD与浏览器选购通过。 | [固定源码](https://github.com/casdoor/casdoor/blob/v4.22.0/web/src/App.tsx#L342) |
| 商业管理 / 订阅 | `/subscriptions` | `/api/get-subscriptions` | 无需外部凭据 | 已集成并验证；Active订阅→有效期和次数投影；暂停撤销；重复同步不重复发放。 | [固定源码](https://github.com/casdoor/casdoor/blob/v4.22.0/web/src/App.tsx#L344) |
| 商业管理 / 资金交易 | `/transactions` | `/api/get-transactions` | 无需外部凭据 | 已集成并验证；专用QA组织原生交易记录新增、读取、修改；无真实资金流转。 | [固定源码](https://github.com/casdoor/casdoor/blob/v4.22.0/web/src/App.tsx#L346) |
| 集成与工具 / 表单 | `/forms` | `/api/get-forms` | 无需外部凭据 | 已集成并验证；官方API新增、读取与字段修改通过；具有isEnabled字段的对象验证了停用。未覆盖所有字段组合或外部执行。 | [固定源码](https://github.com/casdoor/casdoor/blob/v4.22.0/web/src/App.tsx#L349) |
| 集成与工具 / 目录与数据同步 | `/syncers` | `/api/get-syncers` | 同步目标地址、数据库或外部目录凭据 | 已集成，等待外部配置；官方API新增、读取与字段修改通过；具有isEnabled字段的对象验证了停用。未覆盖所有字段组合或外部执行。 | [固定源码](https://github.com/casdoor/casdoor/blob/v4.22.0/web/src/App.tsx#L351) |
| 集成与工具 / Webhook配置 | `/webhooks` | `/api/get-webhooks` | 通知目标URL | 已集成并验证；真实本地目标首次503、自动重试200，投递记录Success且attemptCount>=2。 | [固定源码](https://github.com/casdoor/casdoor/blob/v4.22.0/web/src/App.tsx#L353) |
| 集成与工具 / Webhook投递记录 | `/webhook-events` | `/api/get-webhook-events` | 无需外部凭据 | 已集成并验证；原生读取接口通过；不等同该模块所有操作验证。 | [固定源码](https://github.com/casdoor/casdoor/blob/v4.22.0/web/src/App.tsx#L355) |
| 集成与工具 / 工单 | `/tickets` | `/api/get-tickets` | 无需外部凭据 | 已集成并验证；官方API新增、读取与字段修改通过；具有isEnabled字段的对象验证了停用。未覆盖所有字段组合或外部执行。 | [固定源码](https://github.com/casdoor/casdoor/blob/v4.22.0/web/src/App.tsx#L356) |
| 集成与工具 / API浏览器 | `/swagger` | 原生页面组合接口 | 无需外部凭据 | 已配置，尚未验证；页面与原生实现保留；本轮未单独操作验证。 | [固定源码](https://github.com/casdoor/casdoor/blob/v4.22.0/routers/router.go) |

## 协议、认证及版本边界

| 能力 | 入口与接口 | 状态 | 本轮实际验证与缺项 | 官方来源 |
| --- | --- | --- | --- | --- |
| OAuth / OIDC、SSO与退出 | `/applications`；`/api/login`, `/api/login/oauth/access_token`, `/api/userinfo`, `/api/sso-logout` | 已集成并验证 | 整合回归：授权码PKCE、nonce、签名与到期、跨组织拒绝、跨应用同UID、当前与全局退出。；应用、回调、签名证书与会话策略 | [固定源码](https://github.com/casdoor/casdoor/blob/v4.22.0/routers/router.go) |
| OAuth设备授权 | `/applications`；`/api/device-auth`, `/api/login` | 已集成并验证 | 设备授权pending→真实密码批准→令牌交换通过。；应用启用Device login及设备授权类型 | [固定源码](https://github.com/casdoor/casdoor/blob/v4.22.0/controllers/auth.go) |
| TOTP及恢复码 | `/account`；`/api/mfa/setup/initiate`, `/api/mfa/setup/verify`, `/api/mfa/setup/enable`, `/api/delete-mfa` | 已集成并验证 | 专用消费者启用TOTP；错误验证码拒绝、正确验证码通过，随后解除；未改变当前超管MFA。；验证器；本机已用专用测试账号验证 | [固定源码](https://github.com/casdoor/casdoor/blob/v4.22.0/object/mfa_totp.go) |
| WebAuthn / 通行密钥 | `/account`；`/api/webauthn/signup/begin`, `/api/webauthn/signup/finish`, `/api/webauthn/signin/begin`, `/api/webauthn/signin/finish` | 已集成，等待外部配置 | 注册及登录接口与原生交互保留；未进行真实安全密钥／生物识别确认。；受信任来源、浏览器和系统认证器交互 | [固定源码](https://github.com/casdoor/casdoor/blob/v4.22.0/routers/router.go) |
| Face ID、Web3及扫码认证 | `/applications`；`/api/login`, `/api/get-qrcode` | 已集成，等待外部配置 | 不自动启动摄像头，不代替用户确认钱包或硬件认证。；摄像头、钱包、扫码应用或对应提供者凭据 | [固定源码](https://github.com/casdoor/casdoor/blob/v4.22.0/web/src/pages/ProviderEditPage.tsx) |
| 邮件、短信、RADIUS及推送MFA | `/providers`；`/api/mfa/setup/initiate`, `/api/mfa/setup/verify` | 已集成，等待外部配置 | 配置、绑定、验证入口完整保留；真实外部发送未验证。；对应邮件、短信、RADIUS或推送服务 | [固定源码](https://github.com/casdoor/casdoor/blob/v4.22.0/object/mfa.go) |
| CAS服务票据 | `/applications`；`/cas/:organization/:application/serviceValidate`, `/cas/:organization/:application/p3/serviceValidate` | 已集成并验证 | 真实服务票据校验、重放拒绝、错误service拒绝。；独立应用、服务地址与票据校验客户端 | [固定源码](https://github.com/casdoor/casdoor/blob/v4.22.0/controllers/cas.go) |
| SAML IdP / SP与元数据 | `/applications`；`/api/saml/metadata`, `/api/saml/redirect/:owner/:application`, `/api/acs` | 已集成并验证 | 本地SP请求、可信证书签名及Audience/Destination验证、篡改拒绝；使用应用c14n10兼容选项；外部IdP/SP未验证。；SP实体ID、ACS、证书；本机验收覆盖IdP签名响应，外部IdP联合仍需配置 | [固定源码](https://github.com/casdoor/casdoor/blob/v4.22.0/object/saml_idp.go) |
| SCIM用户与分组配置 | `/syncers`；`/scim/Users`, `/scim/Groups` | 已集成并验证 | 独立组织SCIM用户创建、读取、PATCH通过；SCIM分组创建、读取、PATCH也通过。；具有目标组织权限的访问令牌 | [固定源码](https://github.com/casdoor/casdoor/blob/v4.22.0/scim/user_handler.go) |
| LDAP绑定与目录同步 | `/organizations`；`/api/get-ldaps`, `/api/sync-ldap-users` | 已集成并验证 | 隔离容器LDAP真实绑定与搜索；主服务未开放监听。；独立LDAP监听开关；外部目录同步另需服务器、Base DN及绑定信息 | [固定源码](https://github.com/casdoor/casdoor/blob/v4.22.0/ldap/server.go) |
| LDAPS加密目录 | `/certs`；`/api/add-cert`, `/api/get-ldaps` | 已集成并验证 | 隔离容器，客户端验证CA及主机名后完成加密绑定和搜索。；专用TLS证书、受信任CA和隔离监听端口 | [固定源码](https://github.com/casdoor/casdoor/blob/v4.22.0/ldap/server.go) |
| RADIUS认证监听 | `/organizations`； | 已集成并验证 | 隔离UDP PAP正确接受、错误拒绝，验证Response Authenticator。；组织启用开关、共享密钥与隔离UDP监听端口 | [固定源码](https://github.com/casdoor/casdoor/blob/v4.22.0/radius/server.go) |
| 数据库同步执行 | `/syncers`；`/api/test-syncer-db`, `/api/run-syncer` | 已集成并验证 | 独立源PostgreSQL连接、用户同步、重复同步无重复用户；源实例随后停止。；独立源数据库与明确的受信任主机 | [固定源码](https://github.com/casdoor/casdoor/blob/v4.22.0/object/syncer_database.go) |
| AD、Google Workspace及企业目录联合 | `/syncers`；`/api/add-syncer`, `/api/run-syncer` | 已集成，等待外部配置 | 未连接真实企业工作台或员工账号。；各外部目录的地址、租户／域、账号、凭据及授权 | [固定源码](https://github.com/casdoor/casdoor/blob/v4.22.0/object/syncer.go) |
| Kerberos / SPNEGO | `/applications`；`/api/kerberos-login` | 已集成，等待外部配置 | 未单独验证；Kerberos域、SPN、keytab与客户端票据 | [固定源码](https://github.com/casdoor/casdoor/blob/v4.22.0/controllers/auth.go) |
| MCP管理协议与作用域 | `/servers`；`/api/mcp`, `/api/sync-mcp-tool`, `/api/get-mcp-access-token` | 已集成并验证 | OIDC授权码+PKCE和user:read作用域：initialize、tools/list、get_users；远程代理与真实工具未验证。；作用域、应用和目标MCP服务；已验证本地原生MCP管理API | [固定源码](https://github.com/casdoor/casdoor/blob/v4.22.0/mcpself/base.go) |
| 智能体、MCP代理与OpenClaw记录 | `/agents`；`/api/get-agents`, `/api/get-servers`, `/api/get-entries` | 已集成，等待外部配置 | 未单独验证；外部智能体／MCP服务器地址、授权和实际工具服务 | [固定源码](https://github.com/casdoor/casdoor/blob/v4.22.0/object/agent.go) |
| 独立A2A协议 | `/agents`； | 该固定版本不包含 | README提及A2A；固定Go源码、前端与路由未发现独立实现，不把智能体登记视为A2A验证。； | [固定源码](https://github.com/casdoor/casdoor/blob/v4.22.0/routers/router.go) |
| 独立LLM模型管理与推理 | `/agents`； | 该固定版本不包含 | Models是Casbin策略模型；Site是站点访问代理。未发现独立LLM模型管理／推理模块，不能混称。； | [固定源码](https://github.com/casdoor/casdoor/blob/v4.22.0/object/site.go) |

## 尚未完成的验证

- WebAuthn／通行密钥、Face ID、钱包、扫码：保留官方入口与协议逻辑，未进行硬件或用户确认。
- Kerberos、外部AD／LDAP／SAML联合、远程MCP工具／智能体／站点代理：配置CRUD保留，本轮未连接真实服务执行。
- 注册邀请领取、优惠券实际抵扣、工单完整处理、每种规则／表单执行及全部331条API的逐操作矩阵未穷举。
- 第三方邮件／短信／OAuth、存储、通知、日志、支付提供者未逐一接通；需按 [外部清单](external-services.md) 提供实际服务。
- 独立A2A协议、独立LLM模型管理／推理未在固定版本中发现；不新增冒充上游能力。
- 窄屏和原生翻译仍有上游英文标签；本轮没有重写原生UI。

## 自建扩展与数据归属

身份、组织、密码、策略、证书及商业原始记录归Casdoor；产品业务会员、额度、兑换码、恢复和业务审计归权益库。商业套餐→`plans.casdoor_plan`→服务端可信订阅核对→权益投影，浏览器返回页不证明付款。管理员赠送、兑换、订阅和免费次数分别列来源。

整合回归36项首次35通过，1项产品编辑回传只读字段失败；修复后该项定向重跑通过。其他已通过项未重复全量执行。完整构建与TypeScript通过。详细过程见 [验收记录](acceptance.md)。
