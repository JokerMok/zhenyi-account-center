# 权益 API 与账目规则

中心业务 API 使用 JSON。失败返回 HTTP 状态码与 `{ "error": "说明", "code": "稳定错误码" }`。日期使用 ISO 8601；计数均为整数。

## 产品后端 API

前缀：`/api/v1/products/{固定产品标识}`。

每个请求必须包含：

```http
Authorization: Bearer <该产品独立调用密钥>
X-User-Token: <当前用户属于该产品应用的 Casdoor access_token>
Content-Type: application/json
```

| 方法与路径 | 输入 | 结果 |
| --- | --- | --- |
| GET `/identity` | 无 | `user.uid`、用户名、组织与展示名 |
| POST `/logout-all` | `{}` | 委托中心删除该用户各应用会话并撤销 Casdoor 令牌 |
| GET `/entitlements` | 无 | 当前产品、会员有效期、功能、剩余次数和预占数 |
| POST `/check` | `{feature_id}` | `allowed:true`；用于不扣次功能 |
| POST `/reservations` | `{feature_id,request_id,amount}` | 预占 ID、状态、到期时间 |
| POST `/reservations/{id}/confirm` | `{}` | `confirmed` 或已超时的 `expired` |
| POST `/reservations/{id}/cancel` | `{}` | `cancelled` 或 `expired` |
| POST `/reservations/{id}/refund` | `{}` | `refunded` |

`uid` / `user_id` 输入会被拒绝。密钥决定产品，用户令牌必须由该产品的应用签发。伪造另一产品路径、令牌 audience 或预占记录均不可越权。

## 状态与幂等

- 同一个 `(product, uid, request_id)` 只有一条预占。重复请求返回原记录；修改功能或数量返回 409。请求号长度 8–128。
- `reserved → confirmed / cancelled / expired`；`confirmed → refunded`。重复同一终态返回原结果；非法反向转换返回 409。确认前再次检查封禁、产品、功能与会员。
- 扣次和桶分摊在 PostgreSQL 事务内完成，使用用户产品级事务锁、行锁、唯一约束和非负检查。预占从可用次数移至 held；确认清除 held；取消返还；确认后退款只返一次。
- `confirmed` 流水的 amount 为 0，实际可用额度在 `reserve` 已减少；追踪一次业务需按 reservation ID / request_id 关联全部事件，不能只合计确认行。
- 到期桶的未用次数失效；返还仍回原桶，原桶已到期时不会变为可用，避免跨周期洗额度。

## 会员与周期

用户、产品、功能共同定义权益。`access` 不扣次数，`quota` 必须经过预占。会员资格和计次数量分开，会员功能可设置 `member_only`。

管理员 / 兑换会员续期从 `max(现在, 当前有效期)` 累计天数。普通会员来自本地开通记录；订阅会员来自 Casdoor 投影，取两者较晚的到期时间。某产品会员不影响其他产品。存在有效上游订阅时，本地撤销会员会返回冲突，需先暂停 Casdoor 订阅再核对，避免两边互相覆盖。

免费额度按功能选择：

| 周期 | 发放与到期 |
| --- | --- |
| once | 首次查询或使用发放一次，免费桶不过期 |
| daily | UTC 每日一个桶，次日 00:00 UTC 到期，不结转 |
| monthly | UTC 每月一个桶，下月 1 日 00:00 UTC 到期，不结转 |

发放按需进行，同一用户产品功能周期唯一。修改免费额度只影响尚未创建的周期桶，不重发当前桶；已有流水后不允许更改功能种类或周期，需新建功能标识。管理员 / 兑换赠送可另设有效期，与免费周期独立。预占按最早到期桶优先使用。

## 消费者与运营 API

消费者 Cookie 会话：`GET /api/me`、`GET /api/entitlements`、`POST /api/redeem {code}`、`GET /api/records`、`POST /api/logout`、`POST /api/logout-all`。不能指定其他用户。

运营使用独立管理员 Cookie：`GET /api/admin/me`、`GET /api/admin/users?q=`、`GET /api/admin/users/{uid}/entitlements`、`POST /api/admin/grants`、`PUT /api/admin/catalog/{products|features|plans}`、`GET/POST /api/admin/codes`、`POST /api/admin/codes/{id}/status`、`GET /api/admin/records/{ledger|audit|redemptions|reservations|reconcile_runs}?limit=&offset=`、`GET /api/admin/subscriptions`、`POST /api/admin/reconcile`。

写操作校验当前应用的 Origin 和 `X-CSRF-Token`（从 me 获取），配置 / 赠送 / 撤销 / 状态修改要求填写原因。管理员身份要求 `built-in` 组织、受信任固定 subject 与 Casdoor isAdmin，不接受消费者自称管理员。

兑换码只存 HMAC 摘要和尾号；明文创建时仅返回一次。每个账号对同一码仅可领取一次，受总使用次数、停用和到期约束，领取与发放在同一事务。重复已完成领取返回原兑换结果，不再次发权益。

权益流水和管理审计通过数据库触发器禁止更新 / 删除。运营记录含操作者、时间、原因、变更前后值；用户查询和敏感凭据不写入公开日志。当前页面展示最近记录，历史流水可用带 limit/offset 的运营 API 查询。

## 运营筛选与分页

兼容原数组接口；运营新版传 `paginated=1&page=1`，返回 `{items,total,page,page_size}`，每页20条。用户支持 `q`、`product`、`status=normal|blocked`、`membership=active|expired|none`、`data_kind=all|test|business`；产品筛选限定权益摘要及会员条件作用范围。摘要额度仅统计已经入账、未过期的桶，不会为查看列表发放免费额度。

兑换码支持 `q`（尾号）、`product`、`status=available|expired|exhausted|disabled`；状态优先级是停用、过期、用尽、可用。流水与审计支持 `q`、`product`、`action`、`from`、`to`（UTC 日期，含截止日）、`data_kind`；流水另支持 `reconcile=hide` 排除核对记录。流水可按实际业务 request_id 或预占 reference 追溯；审计搜索包含操作者、目标用户和原因。审计数据范围筛选针对操作者。

测试账号标签按 `test_`、`dummy_test_`、`probe_`、`qa_` 命名前缀识别，仅用于本地展示与筛选，不参与授权或安全隔离。所有新版查询仍要求独立管理员会话。

## 产品后端任务恢复（本次新增）

正常预占、确认和用户查询继续要求 Bearer 产品凭据及 `X-User-Token`。以下独立入口只允许可信产品后端查询和恢复本产品已有任务，不要求已过期／退出／封禁用户重新登录：

|方法|地址|参数|
|---|---|---|
|GET|`/api/v1/products/:product/recovery/reservations`|`reservation_id` 或 `request_id`，只能选一个|
|POST|`/api/v1/products/:product/recovery`|定位参数加 `action: cancel/refund`、`reason`|

恢复不支持 confirm、reserve、grant；不接受 uid/user_id。跨产品URI拒绝403，其他产品预占ID返回404，歧义请求号返回409 `AMBIGUOUS_REQUEST`。重复恢复返回既有终态，不增加第二笔流水／恢复审计。已超时的 reserved 可转 expired 并释放；已确认消费只能按原预占部件返还，不创建新额度。

网络断开、响应丢失或5xx必须视为 unknown；先按原请求号／预占ID查询，或使用原请求号幂等重试。示例客户端提供 `status`、`recover` 和 `confirmKnown`。确认已入账时依真实业务任务交付或返还；无法核实则保留 `pending_recovery`。示例HTTP接口对此返回202，不返回“确定失败”。详见接入文档中的持久化任务例子。

### 消费者导航入口

`POST /api/v1/products/{product}/consumer-entry {tab}` 沿用产品后端双重鉴权，不接受 UID 或任意 returnUrl；tab 为 overview/security/redeem/records。返回 `{url}` 只能用于启动中心自己的 OIDC 会话或校验现有同一 UID 的会话，不能替代登录。多标签授权及重试的目标绑定各自事务。
