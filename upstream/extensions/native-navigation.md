# v4.22.0 统一管理前端扩展

构建入口 `npm run native:build`。官方固定tag归档和SHA-256见 `docs/generated/casdoor-v4.22.0-inventory.json`，后端二进制与认证／密码实现不改。

独立维护的编译期React差异：

1. 使用上游BasePath=/admin。原生AppLayout内保留全部原生路由；增加业务子路由与管理首页，原始Dashboard移至/system/dashboard。不是互相跳转的第二套前端。
2. 同一侧栏增加产品权益和系统诊断分组，区分商业商品／套餐和业务产品／权益套餐。消费者账号安全页采用消费者布局，不显示管理导航。
3. 业务内容来自受版本管理的 `src/web/views.tsx`／management.tsx，CSS作用域限定在.business-surface；原生用户详情按稳定subject跳转业务权益。业务内部链接使用React路由。
4. 管理授权页走同源代理，OIDC issuer保持公开身份地址；继续校验state、nonce、PKCE、签名与可信管理员。代理只转发该浏览器隔离的管理员原生Cookie，业务API独立鉴权与CSRF。退出清除两类管理会话。
5. 已知内置图像编译期转本地路径、绿色品牌、文本上游署名、消费者购买返回个人中心。保留自定义品牌、上传与私人头像。来源与许可见upstream/assets及docs/resources.md。

补丁目标每次从已校验归档恢复后应用；受版本管理输入、公开URL与issuer进入构建戳。保留官方原包build-official-v4.22.0和上一构建build-previous。新克隆可重建相同扩展，不依赖被忽略目录手工修改。保留Apache-2.0与Powered by Casdoor。升级需重新核对补丁目标及路由，不自动升级上游。

回退必须先用当前控制脚本停止身份网关、原始后端和业务服务，再切旧代码与端口配置；详见docs/operations.md。此轮无数据库迁移，不删除新旧业务记录。
