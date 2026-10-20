# 臻一账号中心

面向消费者产品的公共账号与权益平台。Casdoor 管理身份和商业订阅，公共权益服务管理产品会员投影、功能权限、次数、兑换码和流水。React + TypeScript / Node.js + TypeScript / PostgreSQL。未改动其他产品仓库，未接入员工账号，未迁移用户或部署线上。

## 本地使用

需要 Node.js 22+、Docker Compose、OpenSSL。当前在 macOS ARM64 验证；首次启动需要下载官方 Casdoor 发布包。

```sh
git clone https://github.com/JokerMok/zhenyi-account-center.git
cd zhenyi-account-center
npm ci
npm start
# 停止，保留数据库
npm stop
# 查看状态 / 获取初始化管理员凭据
npm run status
npm run credentials
```

`npm start` 自动生成随机密钥、启动数据库、应用迁移、初始化 Casdoor、构建页面并启动三个应用。再次运行会保留账号、配置和数据。新改动后执行 `npm run build`，再停止并启动服务。所有服务监听回环地址。

| 页面 | 地址 |
| --- | --- |
| 消费者中心 | http://localhost:5310 |
| 权益运营 | http://localhost:5310/admin |
| Casdoor 原生管理 / 账号安全 | http://localhost:5300 |
| 拼豆接入示例 | http://localhost:5311 |
| 录屏接入示例 | http://localhost:5312 |
| PostgreSQL（仅本机） | 127.0.0.1:5342 |

管理员组织为 `built-in`，消费者组织为 `consumers`。随机初始密码存放在 `.local/credentials.json`，也可通过上面的命令查看。消费者从页面自行注册。测试账号仅存在本地私密配置与数据库中，不纳入 Git。请勿将本机测试数据库直接用作生产库。

## 运营后台

访问 `/admin`，使用独立管理员账号。用户列表支持产品、账号 / 会员状态筛选和分页，可直接查看会员到期与已入账额度；权益编辑在右侧抽屉完成。产品配置关联功能与套餐，兑换码区分可用、过期、用尽、停用。流水支持按用户 / 业务请求、产品、操作类型、日期追溯，审计以结构化前后值展示。窄屏列表采用卡片与全屏编辑。

测试命名标签仅为展示筛选，不承担权限隔离。所有会员、额度、状态变更仍由服务端校验；真实支付商户未配置时不启用收费。

## 运行方式

Casdoor 固定 `v4.22.0`。本机 Docker 可用，但官方镜像仓库请求失败，因此使用官方 Darwin ARM64 发布包，已核对官方 SHA-256；PostgreSQL 仍由 Compose 运行。源码不作修改。[版本锁定与来源](docs/upstream-lock.json)、[初始化与运维](docs/operations.md)包含详情。`infra/compose.yml` 另有可选 Casdoor 容器配置；该镜像在本机未运行验收。

身份库 `casdoor` 和业务库 `entitlements` 使用不同数据库、不同登录角色；业务代码不访问 Casdoor 表。示例产品有独立的环境文件和受行权限约束的数据库角色，只能存取各自会话与任务，不能读权益表或其他产品会话。

```sh
npm run dev             # 账号中心后端
npm run dev:beadgrid    # 拼豆示例后端
npm run dev:focustake   # 录屏示例后端
npm run dev:web         # 前端开发服务（默认代理账号中心）
npm run build
npm test                # 本地关键业务测试，会创建合成测试账号与流水
npm run test:payment    # 官方 Dummy 测试：订单、通知、订阅和权益；只允许本机
npm run release-holds   # 手动释放超时预占
npm run reconcile       # 主动查询 Casdoor 核对订阅
npm run backup          # 短暂停止本项目写入，备份后恢复服务
npm run restore -- backups/备份文件.tar.gz  # 恢复到新的独立数据库
```

## 已提供的能力

- Casdoor 注册、登录、资料与密码管理入口；独立管理员应用；标准 OIDC 授权码 + PKCE，服务端校验 state、nonce、签名、issuer、audience 和到期时间。
- 每个产品独立会话；统一 UID 来自可信 issuer + 稳定 subject。退出当前产品与全局退出分开。
- 消费者权益、兑换与流水；运营用户查询、产品 / 功能 / 套餐配置、会员续期与撤销、额度赠送与撤销、兑换码及审计记录。
- 一次性 / UTC 每日 / UTC 每月免费额度，独立赠送桶和到期时间；事务预占、确认、释放、返还与超时回收。
- 通过 Casdoor 服务端查询投影订阅，每 5 分钟核对一次，也可手动执行。需要付款的订阅必须查到 `Paid` 支付记录。管理员开通与兑换码不伪造订阅或交易。
- 两个独立示例后端，提供真实登录、额度查询、演示任务、重复请求处理及两种失败恢复。录屏示例生成任务文件，不进行屏幕采集。

## 接入与验收

[真实产品接入指南](docs/integration.md) · [接口及额度规则](docs/api.md) · [Linux 与域名配置](docs/deployment.md) · [实际验收结果](docs/acceptance.md)

未配置短信、邮件、微信登录或任何真实支付商户；没有启用真实收费。已使用 Casdoor 官方 Dummy 测试提供者完成订单 → 测试支付通知 → Paid 记录 → Active 订阅 → 权益生效，并验证重复通知不重复发放，随后关闭测试购买入口。这是本地模拟支付，不等于支付宝、微信或 Stripe 商户沙箱验收。中心没有自建 webhook 接收器，采用经过验证的 Casdoor 服务端查询与周期核对；商业化前仍需验证真实提供者通知、退款和恢复规则。
