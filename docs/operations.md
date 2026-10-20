# 初始化、运行与恢复

## 版本与来源

2026-10-20 检查官方仓库、发布页和文档，固定 Casdoor `v4.22.0`，官方发布提交短号 `f11d6ac`。完整发布包哈希见 `upstream-lock.json`。本机为 macOS ARM64，官方 Darwin ARM64 包的 SHA-256 已验证。未改动上游源码。

- [官方仓库](https://github.com/casdoor/casdoor/tree/v4.22.0)
- [发布与校验值](https://github.com/casdoor/casdoor/releases/tag/v4.22.0)
- [OIDC 配置与标准 subject 映射](https://casdoor.ai/docs/how-to-connect/oidc-client/)
- [数据初始化](https://casdoor.ai/docs/deployment/data-initialization/)
- [订阅](https://casdoor.ai/docs/pricing/subscription/)
- [支付提供者](https://casdoor.ai/docs/provider/payment/overview/)
- [公共 API 与全局退出](https://casdoor.ai/docs/basic/public-api/)

`infra/casdoor-init.template.json` 为该版本官方 `init_data.json.template` 的配置子集，不含凭据。Casdoor 采用 Apache-2.0，相关许可见官方仓库。当前 Docker 镜像没有在本机成功拉取，架构 manifest 也未获取，不能宣称容器方式已验证；原生发布包和 PostgreSQL Compose 的混合运行已实际验证。

官方 Dummy 支付不需要商户凭据。本轮已用 `npm run test:payment` 实际创建 Casdoor 订单，执行官方测试通知并读取 Paid 支付与 Active 订阅，再核对权益及重复通知幂等。测试结束会暂停合成订阅、解除提供者绑定、停用套餐与定价；不会默认开放测试购买入口。真实商户通知、退款与网关沙箱不在这项模拟支付的证明范围内。

## 首次初始化

`npm start` 调用 setup 生成 `.env`、`.local/credentials.json`、本地签名证书及私钥、Casdoor 原生配置和初始化数据。文件权限使用 0600，私密目录 0700。随机管理员密码包含大写、小写、数字；不使用默认密码。Casdoor 导入时会编码密码，因此初始化 JSON 使用随机明文，仅保存在被忽略的私密目录。

首次健康检查成功后，初始化数据移动为 `init_data.applied.json`，写入 initialized 标记，不在重启时重复导入，以免覆盖运营配置。通过 Casdoor 官方 API 查询实际管理员 subject 并首次固定到 `.env`，不使用昵称、邮箱或用户名作为稳定主键。之后 subject 不一致会停止启动要求核查。

消费者组织为 `consumers`。中心、拼豆、录屏是三个独立应用；`zhenyi-admin` 仅允许 `built-in` 管理身份。管理员初始凭据通过 `npm run credentials` 本机查看。首次使用后可在 Casdoor 原生页面更改密码；修改后 `.local/credentials.json` 中初始密码不再有效，自动化测试需要同步专用测试配置或凭据。

不要删除 `.local` 或 Docker 数据卷来“重置登录”。这些文件包含签名私钥和本地初始化材料，丢失会影响恢复。仓库已忽略所有环境文件、密钥、日志、数据、备份和测试凭据，尚未建立远程仓库或推送。

## 持久化与任务

- 数据卷：`zhenyi-accounts_accounts-postgres`。不同数据库与角色隔离身份和权益。两个示例仅有自己的会话、登录尝试和任务行权限，无权读取或更新权益表。
- Casdoor：`.local/casdoor`。前端构建随官方发布包提供，服务绑定 `127.0.0.1:5300`。
- 该版本上游 RADIUS 启动逻辑无独立关闭开关，留空端口会绑定随机 UDP 端口。本项目配置 `radiusServerPort = -1` 让该非业务监听器拒绝启动，使用随机 secret，并保持组织的 RADIUS 关闭；日志中的对应 invalid port 提示是这一配置的预期结果。运行时已核对没有 UDP 监听，不修改上游代码。
- 应用日志与 PID：`.local/*.log`、`.local/*.pid.json`。停止脚本只处理本项目进程和数据库服务，不操作其他项目。
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
