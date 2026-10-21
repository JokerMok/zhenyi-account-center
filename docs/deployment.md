# Linux 与域名部署

本项目现已部署到既有 tencent-main。当前操作入口、目录、systemd、独立数据库、域名、正式密码恢复、一致备份和回退，以 [生产运维](production.md) 为准；实际验证范围见 [公网验收](production-acceptance.md)。

实际部署使用 `/srv/apps/zhenyi-accounts`，Casdoor 官方 Linux x86_64 v4.22.0 发布包及项目独立 Node.js 运行时，哈希固定于 `deploy/production-lock.json`。不复制 Mac 二进制，不调用本机 `npm start`、`setup` 或 PID 控制器。`deploy/*.service.example`、`deploy/Caddyfile.example` 和 `infra/compose.yml` 是旧的通用／本地模板，不能替代 `deploy/production/` 的实际发布流程。

正式公开地址：`https://accounts.shizibandu.icu`，唯一后台 `/admin`；身份 issuer：`https://identity.accounts.shizibandu.icu`。公开URL不参与监听端口推导。内部5300／5305／5310／5342均绑定127.0.0.1，不发布5313首次设置端口或演示端口。

统一管理前端与消费者前端分工保持不变，Caddy只新增本站配置，静态资源由正式隔离构建发布；上传与原生会话留在shared，缺失文件返回真实404。第三方邮件、短信、微信及商户保持未配置，真实收费关闭。

后续迁移或更换服务器必须保留正式issuer、签名材料、数据库与稳定subject。迁移到不同issuer不能自动按邮箱合并或静默新建身份，需按 [产品接入](production-integration.md) 的关联规则单独处理。
