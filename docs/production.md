# Linux生产运维

目标为既有tencent-main，项目独立目录 `/srv/apps/zhenyi-accounts`。沿用服务器releases／shared／current约定，不迁移其他项目。生产只运行Casdoor、身份网关、账号中心和独立PostgreSQL；不调用本机control.mjs，不启动两个演示后端。

正式地址为 `https://accounts.shizibandu.icu`，唯一后台 `/admin`；issuer为 `https://identity.accounts.shizibandu.icu`。公开URL与回环端口5310／5300／5305／5342独立。生产首次使用新空数据库、独立机器凭据和签名材料，不导入Mac测试库；已有环境文件及稳定subject不会重新生成。

## 发布与管理

`deploy/production-lock.json`固定Linux amd64的Node、Casdoor和PostgreSQL来源／摘要。构建与发布：

```sh
npm run production:build -- 完整Git提交SHA
bash deploy/production/publish.sh 完整Git提交SHA
ssh tencent-main
sudo /srv/apps/zhenyi-accounts/deploy/manage.sh status
sudo /srv/apps/zhenyi-accounts/deploy/manage.sh logs 80
sudo /srv/apps/zhenyi-accounts/deploy/manage.sh restart
```

构建在Mac隔离Git归档中使用正式URL，不修改开发.env；服务器使用npm锁文件安装运行依赖，包括实际需要的tsx。程序、配置与构建目录由root管理；Casdoor仅能写 `shared/uploads` 、`shared/logs/casdoor` 和 `shared/sessions`。三个长驻服务为 `zhenyi-accounts-casdoor`、`zhenyi-accounts-identity`、`zhenyi-accounts-center`，配置开机自启及失败重启。数据库Compose固定项目名zhenyi-accounts、独立卷、回环5342，不操作其他项目数据库。

新发布先校验文件清单，完整操作持有 `shared/operation.lock`；已有release不执行npm ci或覆盖。更新前自动备份，切换current，迁移、启动与健康检查；失败恢复前一指针和原服务状态。迁移是前向操作，不自动倒退数据库。`rollback <releases下完整SHA>`校验目标声明兼容当前已应用迁移后退应用，保留数据并先备份。跨上游或不兼容数据库版本需另做隔离恢复，脚本拒绝冒险回退。

Caddy仅新增 `zhenyi-accounts.caddy`，通过现有caddy-site-install校验并reload；不替换主配置，不重启其他网站。

## 正式管理员

首次机器引导密码随机且不输出，只用于保护尚未完成设置的管理员；不会作为正式交付密码。默认用户名admin。正式密码用隐藏交互设置：

```sh
npm run production:admin
# 或服务器：
sudo /srv/apps/zhenyi-accounts/deploy/manage.sh admin:reset-password
```

通过官方改密、验证及会话撤销，保留稳定subject／UID和业务审计。以后启动不覆盖密码；忘记密码使用同一命令。账号组织built-in；修改密码入口为统一后台右上角“我的账户”。生产禁止短密码验收豁免。不要把密码放命令参数、Git或运维日志。

## 一致备份与隔离恢复

```sh
sudo /srv/apps/zhenyi-accounts/deploy/manage.sh backup
sudo /srv/apps/zhenyi-accounts/deploy/manage.sh restore /srv/backups/zhenyi-accounts/manual-时间.tar.gz
# 直接CLI须显式生产模式：
node scripts/backup.mjs --mode production
node scripts/backup.mjs restore /绝对路径/备份.tar.gz --mode production
```

生产按systemd记录每项原状态，停止并核对本项目所有写入服务／端口，保留数据库运行，然后转储身份库、权益库并复制上传内容和必要配置。前后两次停写核对通过才标consistent=true；任何失败都会尝试恢复原来应运行的服务。恢复服务失败、归档中断均不会发布成功备份文件。不会用本机PID文件管理生产进程、另起脱管进程或启动演示服务。

备份目录 `/srv/backups/zhenyi-accounts`，仅root读取；内容含数据库、签名证书／私钥、机器环境、稳定管理员subject、私密产品登记、运维配置、上传文件与身份会话文件。可重建前端不重复打包。逐文件SHA-256和外部归档SHA-256均验证。备份含隐私和密钥但当前不加密；同机备份不抵御整机丢失，异机副本未配置。

每日 `03:50 Asia/Shanghai`执行 `zhenyi-accounts-backup.timer`，错过后补跑；仅新备份成功后保留最近7份日备份，人工manual备份不轮转。查看 `journalctl -u zhenyi-accounts-backup.service`、`systemctl status zhenyi-accounts-backup.timer`及 `shared/backup-last.json`。备份、恢复与部署共用同一个排他操作锁；异常遗留锁必须先核对owner进程，不按时间强删。

恢复默认创建独立 `restore_随机标识_casdoor`／`restore_随机标识_entitlements` 数据库，以及 `shared/restores/restore-*` 中的上传和私密配置；逐项验证文件内容，不切换生产。正式切换须明确选中的恢复目标、先做当前生产备份，再停写修改数据库目标、上传目录和对应签名材料，保留切换前配置及回退路径。禁止直接把归档覆盖运行目录。旧v1备份保留，不被轮转；它们没有完整上传快照，不能作为本版v2完整恢复证明。

## 真实上传路径

固定版本本地存储实际写工作目录下files/。生产Casdoor工作目录是 `shared/state/casdoor`，files链接到 `shared/uploads`；web/build和swagger链接到current发布资源，日志单独链接到shared/logs/casdoor，原生文件会话tmp链接到shared/sessions。发布和重启不会移动上传内容。默认创建并关联“本地持久化上传”原生存储提供者（保留管理员已选的存储），域名为正式issuer；本轮上传、下载和恢复的实际结果另见验收记录。
