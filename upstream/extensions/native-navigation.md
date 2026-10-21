# v4.22.0 原生前端扩展

唯一构建入口 `npm run native:build`。源码来自官方固定 tag，归档 SHA-256 记录于 `docs/generated/casdoor-v4.22.0-inventory.json`。不升级 Go 二进制、不修改认证、密码或原生后端。

单独维护的编译期差异：
1. 在 `web/src/lib/nav.ts` 的 `getNavGroups` 中，追加受 `isLocalAdminUser` 限制的臻一业务扩展导航组。
2. `Sidebar.tsx` 中，仅业务扩展链接在当前窗口跳转。保留原生全部路由与 CRUD 页面。
3. 业务页面同步提供完整原生模块导航与实际配置状态；原生会话与业务 OIDC 会话各自验证，绝不共享高权限 Cookie 或复制管理员密码。

`npm start` 检查扩展构建已存在；首次需要构建。修改公开地址后重新构建。构建安装先备份官方前端为 `.local/casdoor/web/build-official-v4.22.0`，前一构建保存在 `build-previous`。还原对应目录并重启 Casdoor 即可回退；不需要回滚数据库。所有生成文件不入 Git。

保留官方 Apache-2.0 许可证及 Powered by Casdoor。完整来源与路由清单由 `scripts/inventory-casdoor.py` 提取。上游不提供独立的 A2A Go 实现或路由；README 提及不构成此能力的本机验收证据。

另外两项展示差异：将默认主色设为既有绿色；页脚使用本地文本 Casdoor 保留上游声明，避免未配置 CDN 时出现破图。组织图标为空时，通过官方组织 API 设置本地品牌资源；不覆盖已有组织 Logo、密码规则或管理员凭据。镜像下载仅替换锁文件的下载地址，保留版本与 integrity；可选 `NATIVE_NPM_REGISTRY`，无需修改全局 npm 配置。

原生LLM AI导航组中文改为“AI与MCP”，对应实际智能体／MCP／站点／规则模块，避免误导为独立模型推理管理。保留原有分组项。
