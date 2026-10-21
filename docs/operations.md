# 初始化、运行与恢复

## 版本与来源

2026-10-20 检查官方仓库、发布页和文档，固定 Casdoor `v4.22.0`，官方发布提交短号 `f11d6ac`。完整发布包哈希见 `upstream-lock.json`。本机为 macOS ARM64，官方 Darwin ARM64 包的 SHA-256 已验证。后端发布包未修改；前端通过受版本管理的编译期扩展整合。

- [官方仓库](https://github.com/casdoor/casdoor/tree/v4.22.0)
- [发布与校验值](https://github.com/casdoor/casdoor/releases/tag/v4.22.0)
- [OIDC 配置与标准 subject 映射](https://casdoor.ai/docs/how-to-connect/oidc-client/)
- [数据初始化](https://casdoor.ai/docs/deployment/data-initialization/)
- [订阅](https://casdoor.ai/docs/pricing/subscription/)
- [支付提供者](https://casdoor.ai/docs/provider/payment/overview/)
- [公共 API 与全局退出](https://casdoor.ai/docs/basic/public-api/)

`infra/casdoor-init.template.json` 为该版本官方 `init_data.json.template` 的配置子集，不含凭据。Casdoor 采用 Apache-2.0，相关许可见官方仓库。当前 Docker 镜像没有在本机成功拉取，架构 manifest 也未获取，不能宣称容器方式已验证；原生发布包和 PostgreSQL Compose 的混合运行已实际验证。

官方 Dummy 支付不需要商户凭据。本轮已用 `npm run test:payment` 实际创建 Casdoor 订单，执行官方测试通知并读取 Paid 支付与 Active 订阅，再核对权益及重复通知幂等。测试结束会暂停合成订阅、解除提供者绑定、停用套餐与定价；不会默认开放测试购买入口。真实商户通知、退款与网关沙箱不在这项模拟支付的证明范围内。

## 首次设置与密码恢复

`npm start` 自动生成机器凭据、签名证书及私钥（私密文件0600、目录0700），提供本机一次性设置地址。临时设置服务只有回环监听、随机授权、Host／Origin 检查和排他写入；普通中心服务不安装初始化路由。先选择用户名和至少8位密码，经官方初始化 JSON 导入 Casdoor，不引入另一套密码存储或校验系统。

Casdoor 先使用随机机器引导密码保护内置管理员，避免公网抢先设置。自定义首个用户名通过初始化用户对象完成；上游不允许重命名 `built-in/admin`，因此既有管理员不走改名或删除重建。首次自定义用户名导入时按官方要求临时启用 built-in 的新增管理员许可，导入后立即关闭；内置机器管理员仍由随机机器密码保护。导入完成后移走初始化文件，清除临时用户密码，固定实际 subject；重启不重新导入。只有 `built-in` 组织改为 `AtLeast8`、密码不过期；`consumers` 原有规则不变。

已登录管理员从右上角账号菜单→“我的账户”进入同一后台 `/admin/account`，使用官方密码表单；修改后重新登录。原生改密通过 Casdoor `/api/set-password`，由其完成哈希、历史策略与令牌撤销。

本地忘记密码执行 `npm run admin:reset-password`，两次隐藏输入新密码；不接受命令行密码或管道输入。命令使用本机私密应用凭据调用同一官方接口，先按已固定 subject 查找管理员，不能按浏览器输入选择账号；修改后核对 subject，删除本地旧会话，追加不含密码的审计。重置后通过官方登录接口核实新密码，撤销旧会话并清除旧 credentials / 初始化 JSON 中的明文密码与遗留 bootstrap 输入，不再保存新密码。接口拒绝、网络异常及后续清理失败会分别报告，不把仅修改文件视为成功。用户名、UID、权益与原审计保持不变。恢复需要本机文件访问权限，不对普通消费者提供恢复接口。

不要删除 `.local`、管理员或数据库卷来恢复登录。本机机器密钥与测试数据均被 Git 忽略。

## 持久化与任务

- 数据卷：`zhenyi-accounts_accounts-postgres`。不同数据库与角色隔离身份和权益。两个示例仅有自己的会话、登录尝试和任务行权限，无权读取或更新权益表。
- Casdoor：`.local/casdoor`。前端构建随官方发布包提供，原始后端绑定 `127.0.0.1:5305`，公开身份网关为5300。
- 该版本上游 RADIUS 启动逻辑无独立关闭开关，留空端口会绑定随机 UDP 端口。本项目配置 `radiusServerPort = -1` 让该非业务监听器拒绝启动，使用随机 secret，并保持组织的 RADIUS 关闭；日志中的对应 invalid port 提示是这一配置的预期结果。运行时已核对没有 UDP 监听，不修改上游代码。
- 应用日志与 PID：`.local/*.log`、`.local/*.pid.json`。停止脚本只处理本项目进程和数据库服务，不操作其他项目。
- 两个示例产品每30秒恢复自己的未完成任务，也可 `APP_ID=beadgrid npm run demo:recover`。从持久化任务读取预占ID／原请求号，凭产品后端密钥恢复，无需浏览器会话。中心仍不可用时保留 `pending_recovery`。
- 权益预占 5 分钟到期，中心每 30 秒释放；每 5 分钟通过 Casdoor 官方 API 核对订阅。后台核对失败不会清空既有投影，也不会把未验证状态当付款成功。
- 业务令牌保存在服务端数据库会话中，8 小时或上游 token 到期（较早者）后重新登录。部署时需保护数据库访问和备份；当前未对数据库内的 token 额外做应用层加密。

## 备份与恢复

```sh
npm run backup
npm run restore -- backups/accounts-日期.tar.gz
```

备份脚本先停止本项目的 Casdoor 和三个应用、保留数据库，得到一致的两个数据库转储，然后打包私密配置、签名证书与 SHA-256 清单，最后恢复本地服务。备份会造成短暂本地停机。备份包含密码与个人数据，虽然权限限制为 0600，归档本身没有加密；只保存在本机受保护位置，异地保存时应另行加密。

恢复脚本校验清单，默认只创建新的 `restore_时间标识_casdoor` / `restore_时间标识_entitlements` 数据库，不覆盖当前数据库。私密配置提取到 `.local/restore-时间`。本轮已进行隔离恢复和记录数量对照，运行中的数据库不切换。

如需正式切换恢复库：先停止应用与 Casdoor，备份现有 `.env` 和 Casdoor conf；将中心 DATABASE_URL、两个产品环境文件的数据库名切到新的权益库，将 Casdoor `dbName` / `dataSourceName` 切到新身份库，恢复相应签名密钥和管理员 subject。`scripts/roles.mjs` 默认生成数据库名为 `entitlements` 的示例配置，实际切换时需同步该脚本或使用独立部署环境文件，避免下次启动覆盖产品数据库目标。确认后先独立启动并定向检查再切换入口。当前恢复命令不自动执行这些切换。

跨机器恢复还需先使用备份中的私密配置建立数据库角色；角色不存在时迁移中的 RLS 策略无法恢复。不要向已有生产环境导入这批本地测试数据。

## 升级

1. 阅读目标版本发布说明、迁移和安全变化，更新 `upstream-lock.json` 中的固定版本与官方校验值。
2. 备份身份 / 权益数据库及签名材料，恢复到隔离库试升。不要让新旧 Casdoor 同时对同一身份库执行 schema 变更。
3. 验证授权码与 PKCE、state / nonce、issuer / audience、注册、安全设置、token 撤销和全局退出。再验证服务端订阅字段、状态、付款记录和权益核对。
4. 切换服务并保留旧发布包和旧数据库备份。上游数据库迁移未证明可逆时，回滚采用备份恢复，不仅替换二进制。

本轮没有执行跨版本升级，不能把上述流程当作已通过的升级测试。

## 本轮官方接口核对

核对锁定版本源代码：[初始化与首次密码](https://github.com/casdoor/casdoor/blob/v4.22.0/object/init.go)、[用户改密及稳定身份查询](https://github.com/casdoor/casdoor/blob/v4.22.0/controllers/user.go)、[原生密码表单](https://github.com/casdoor/casdoor/blob/v4.22.0/web-old/src/common/modal/PasswordModal.js)。官方欢迎页初始化接口仅在内置管理员没有密码且从未登录时可用，不能覆盖本项目已有管理员；本项目使用受本机一次性授权保护的初始化导入。官方 `update-organization` 要求完整组织对象，因此先读取原对象，再只改变管理组织密码选项，保留其他配置。

涉及管理员的旧关键测试与模拟支付测试可通过私密环境变量 `TEST_ADMIN_PASSWORD` 提供测试账号密码，用户名按稳定 subject 查询；兼容旧本机初始化凭据。不要在命令行参数、提交文件或截图中放密码。这不是日常使用流程。

## 单次本机临时验收

常规恢复维持至少8位规则。用户明确要求本机临时短密码时，可在隐藏交互命令后使用 `-- --local-acceptance`；此选项仅允许非生产、回环 HOST、HTTP 回环身份服务与账号中心。只有官方改密写入期间临时调整管理组织密码选项，结束即恢复常规策略；消费者组织不变。密码由交互输入，不含固定测试密码或生产默认值，不由启动脚本反复写入。

## v4.22.0完整前端与可回退扩展

`npm start` 首次构建完整原生前端；需联网访问固定GitHub归档及npm依赖仓库，额外使用锁定的yarn1.22.22。源码归档哈希、二进制版本／完整commit见upstream-lock；后端不修改。`npm run native:build` 重新应用独立编译期React扩展，所有原生路由保留。CENTER_URL、CASDOOR_URL或受版本管理的扩展输入变化时启动脚本检测构建戳并重新构建，避免扩展跳转旧地址。可用`NATIVE_NPM_REGISTRY`指定依赖下载镜像，版本和integrity仍由原生yarn.lock约束。

原生前端原包保留在 `.local/casdoor/web/build-official-v4.22.0`，上一构建保留`build-previous`。停止本项目后替换build目录即可回退前端；数据库迁移004只增列、表和索引，不清库。回退旧服务前先备份，保留新增表和历史记录，不执行破坏性down迁移。扩展差异和Apache许可证见`upstream/`。

v4.22.0 Webhook投递worker仅在启动时已经存在配置才运行。bootstrap通过官方API创建禁用的 `zhenyi-worker-bootstrap` 占位配置（空events，不投递），首次创建后启动脚本只重启本项目Casdoor一次；之后不会重复重启。这样原生新增并启用的Webhook可实际投递和重试，仍由Casdoor保存投递记录。

主机默认只开放回环5300／5305／5310／5311／5312／5342。LDAP、LDAPS、RADIUS主监听保持关闭；该版本LDAP和RADIUS监听在进程内绑定0.0.0.0，不在日常主机无隔离启用。本轮使用独立身份库和临时容器，回环映射5356 HTTP、5357 LDAP、5359 LDAPS、5358 UDP RADIUS；测试结束即停止移除。RADIUS关闭值是-1，不能用0代替（0会请求随机端口）。

实际验证脚本：`npm run test:native`、`test:protocols`、`test:listeners`、`test:auxiliary`。使用TEST_ADMIN_PASSWORD在本机交互环境授权当前管理员登录；不要把密码放入命令历史、Git或报告。可通过本机shell隐藏读取环境变量。脚本会创建合成测试记录；其结果在被忽略的.local内。native与protocol脚本需已下载锁定源码；listeners需Docker及官方Linux ARM64包，创建独立身份库，不能当作生产环境巡检。

## 本次统一管理迁移与回退

本轮没有数据库结构迁移，不重新初始化、不改管理员凭据。启动脚本仅把本机原始Casdoor内部监听调整到CASDOOR_BACKEND_PORT（5305），staticBaseUrl调整为/static；公开issuer仍是5300。旧/admin?tab=入口兼容映射到新React路由。首次旧种子应用名称“臻一权益运营”可升级为“臻一管理后台”；自定义名称／Logo不覆盖。

修改前已执行保留数据的备份，归档在本机backups目录，包含敏感材料不得提交。回退步骤：

1. 先用当前代码 `npm stop`，确保新身份网关也停止，再切换上一已知提交（本轮基线53767f3）。
2. 恢复修改前Casdoor conf（本机 `.local/casdoor/conf/app.pre-unified.conf`，或私密备份），原始监听恢复5300。保留现有.env、管理员subject、数据库和签名文件。不要再次导入初始化JSON。
3. 将被忽略的源码生成目录改名保存，清除构建戳后由旧构建脚本从固定归档重新生成旧前端；也可还原保留的原包／旧构建。不要让旧构建脚本复用新扩展过的源码目录。
4. 启动旧版本，定向核对登录及历史记录。此次无down迁移，不能通过清库回退。

回退方案已记录，未对当前工作数据执行代码降级。新结构的完整停止／启动与身份、历史记录保留已实际验证；备份恢复库隔离验证沿用历史记录。
