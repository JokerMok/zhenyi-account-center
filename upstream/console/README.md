# 统一管理前端扩展

Casdoor v4.22.0完整React前端是唯一后台外壳；使用上游内置BasePath机制部署在中心`/admin`。业务页面作为`/business/:page`子路由进入同一个AppLayout。共享业务内容来自src/web/views.tsx，构建时复制到原生工程，不复制密码体系和账目核心。业务CSS编译期限定在.business-surface内，避免污染原生布局。所有补丁由build-native.mjs从校验归档重置后应用，可从新克隆重建，不依赖.local或.upstream的手工改动。

`/admin/api/*`仅流式代理浏览器原有身份Cookie到Casdoor；不添加服务器管理员Basic凭据。`/api/admin/*`继续使用独立业务管理员会话、可信subject和CSRF。管理员OIDC授权页面走同源/admin/login，原issuer/client ID/回调不变。
