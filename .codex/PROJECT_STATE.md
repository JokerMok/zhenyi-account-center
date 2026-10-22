# 项目状态
核对日期：2026-10-22；范围：公共账号中心消费者衔接修复；依据：docs/production-integration.md、拼豆verification/consumer-sso-20261022、服务器current/RELEASE.json。

## 项目目标
保持固定Casdoor v4.22.0、稳定issuer和唯一/admin后台，修复正式拼豆到消费者个人中心的完整往返，不改变其他真实产品。

## 当前状态
正式个人中心https://accounts.shizibandu.icu；身份服务https://identity.accounts.shizibandu.icu；拼豆https://pindou.shizibandu.icu。本轮实现已Git提交推送、按现有不可变release部署；准确提交见current/RELEASE.json，部署后复核。原PostgreSQL、账号、统一UID、权益、配置和上传保留，无业务迁移或清库。

## 已完成
- 产品后端consumer-entry核实产品及消费者UID，生成仅用于导航的短期上下文；中心无会话发起自己的OIDC，有同UID会话直接进入；不通过URL传递令牌。不同账号409明确停止并可重新验证。
- product/tab/预期UID与回调绑定单次授权记录，按state区分HttpOnly登录尝试Cookie，逆序多标签不串跳。不依赖zy_product_context；普通授权不强制prompt=login，明确切换才强制。错误/取消保留重试目标；裸根退出不自动登录。
- 原生消费者资料默认zhenyi-center/consumers，显式管理页面仍/admin独立配置。注册、登录、找回携带原OIDC参数；资料往返带可信预期UID。个人中心写操作重新核实同一UID并刷新CSRF，拒绝旧标签身份变更。
- 原生管理代理敏感API在服务端验证独立原生管理员Cookie、built-in、固定subject及isAdmin；匿名/消费者401或403。消费者产品不再显示后台入口。管理员实际登录并访问业务产品、原生用户列表通过。
- 沿现有三项systemd/回环端口/Caddy/独立数据库和一致备份发布；没有运行生产setup、示例后端，未改issuer、应用凭据或权益规则。既有03:50备份与回退沿用。

## 当前进行中
本轮收尾记录与最终版本复核；没有新增业务开发安排。

## 关键决策
账号中心、产品、管理员保持独立主机会话，不共享父域Cookie。短期导航引用不是登录凭据，始终要求中心OIDC或其有效会话。消费者只拥有本人的产品权益与作品，不复制到管理员组织。

## 已知问题/阻塞
无阻塞本轮SSO的已知问题。邮件/短信/微信/支付仍待外部配置；本轮未声称邮件找回发送成功。未等待十分钟真实授权过期，取消失败重试已实测。手机为视口模拟；未测实体机/Safari/Firefox。异机备份、整机灾备和真实支付仍未验。

## 下一步
无自动扩展。后续按docs/production.md部署准确提交并保留shared；本次没有清理任何账号数据的授权。

## 验收状态
全新无中心/管理员会话浏览器：拼豆真实注册→产品显示UID→中心security自动OIDC同UID→返回→redeem。刷新/多标签逆序/取消重试、两账号隔离、显式不一致处理及产品/中心/全局退出通过。消费者真实管理接口401；管理员由用户登录后CUA实际核验。三项定向测试、TypeScript/业务及原生构建通过。制图/实际下载与产品重启保留见拼豆同轮证据；没有把旧手工中心登录冒充本轮自动SSO。
