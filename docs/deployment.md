# 后续 Linux 与域名部署

本轮只提供配置模板，没有连接服务器、变更 DNS、申请线上证书或部署线上服务。生产域名入口暂按 `accounts.shizibandu.icu` 规划。

## 主机准备

使用独立非 root 服务账号，例如 `zhenyi`；安装 Node.js 22+、Docker Compose、OpenSSL 和反向代理。部署目录示例为 `/opt/zhenyi-accounts`。业务监听回环地址，数据库不要开放公网端口。

`infra/compose.yml` 固定 PostgreSQL 镜像摘要并仅绑定 `127.0.0.1:5342`。本机镜像已验证 ARM64，Linux 上应先检查摘要的目标架构支持；不支持时选择官方同版本对应架构镜像并记录新摘要，禁止回退 latest。现有网络不兼容 `10.236.0.0/24` 时，选用不冲突的独立网段。

## Casdoor

优先使用官方 `casbin/casdoor:v4.22.0`，拉取后确认目标架构和 RepoDigest，将摘要写入部署配置。本机由于 registry EOF 未完成镜像验收，`docker-casdoor` profile 仅为模板：需生成 `.local/casdoor-docker/app.conf`（容器内监听 8000、数据库主机 postgres / 5432）和初始化文件。首次导入后应移除初始化挂载，以保留后续管理修改。不要直接启用无初始化凭据的默认配置。

若镜像渠道仍不可用，可使用已锁定的官方 Linux 发布包，流程与本机原生运行一致。根据主机选择 `casdoor_Linux_arm64.tar.gz` 或 `casdoor_Linux_x86_64.tar.gz`，从固定 release 下载并按 `upstream-lock.json` 核对哈希，再解压二进制和 `web/build`。本轮未执行 Linux 发布包或 systemd 启动验证。

`deploy/casdoor.service.example` 为原生运行的 systemd 模板；`deploy/accounts-center.service.example` 为业务服务模板。真实产品后端单独管理，不部署本地测试示例或测试账号。

## 域名与回调

`deploy/Caddyfile.example` 规划：

- `accounts.shizibandu.icu` → 账号中心 5310。
- `identity.accounts.shizibandu.icu` → Casdoor 5300。该额外身份主机名只是建议模板，使用前需确认 DNS、证书与备案条件。
- 真实拼豆、录屏保留各自域名和会话。两个演示产品默认只在本机运行。

获准部署后，将 CENTER_URL、CASDOOR_URL 和产品地址改为精确 HTTPS 地址，更新 Casdoor origin / originFrontend 和应用 redirectUris，更新后台接入登记。issuer 改变会改变身份映射键，正式环境应使用全新空库；若未来迁移已有用户，必须专门处理 issuer + subject 映射，不能自动按邮箱合并。

中心设置 `NODE_ENV=production`、`HOST=127.0.0.1`、`PORT=5310`。`CENTER_URL=https://accounts.shizibandu.icu` 仅用于公开访问地址、回调和来源校验，不参与监听端口计算。启动脚本健康检查访问内部回环端口；systemd 模板同样固定内部5310，非 root 服务账号即可运行。每个独立产品后端自行设置内部 HOST/PORT，启用 Secure / HttpOnly / SameSite Cookie，不设置父域 Domain。只在受信任反向代理后服务；当前应用不依据转发头决定身份或权限，外部 origin 校验直接来自固定配置。

## 上线前必须配置和验证

- 为生产重新生成数据库密码、证书私钥、应用 secret、产品密钥和兑换摘要 pepper。禁止复用本机测试凭据或测试数据库。
- 配置邮件 / 短信提供者才开放验证与找回密码；微信登录需要真实开放平台配置和回调。
- 选择 Casdoor 实际支持的支付提供者、商户及沙箱，验证异步付款与退款路径。需要支付记录、订阅状态、幂等和重新核对一致，不能依赖付款返回页。
- 当前没有已实现的 webhook 接收器；本版采用服务端轮询。若要求即时权益、退款审计或事件重放，需在商业上线前补充并验证通知接收、验签、事件幂等与退款规则。
- 按 Linux 目标环境验证备份恢复、服务启动与域名回调，再允许真实用户。这里的模板存在不表示已完成生产验收。

## 首次管理员设置的本机边界

先在目标主机本地完成初始化，再开放反向代理。临时设置服务仅监听 `127.0.0.1:5313`，要求随机一次性授权和精确的 localhost Host／Origin；反向代理只转发5310，禁止转发5313。远程主机需要经受控本机隧道访问设置页；本轮未验证 Linux 或 SSH 隧道。Casdoor 初始化期间已使用随机机器引导密码，不开放无密码的原生管理员注册。设置成功后删除一次性授权和临时管理员明文输入，后续启动不能覆盖既有账号。
