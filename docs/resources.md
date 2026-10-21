# 原生界面资源构建

固定来源：Casdoor v4.22.0源码中的图片引用。`upstream/assets/manifest.json`逐项记录来源、SHA-256与字节数；138项受控图片随Git保存。旗帜来自精确锁定的 `flag-icons@7.5.0`（MIT），字体为原生构建内Inter（OFL），相关许可随资源目录保留。

```sh
npm ci
npm run native:build
```

构建先运行 `scripts/sync-native-assets.mjs` 校验图片哈希，复制至 `.local/native-static`，并生成旗帜大小写路径别名。`scripts/localize-native-images.mjs`在编译期把已知官方CDN内置图片路径转换为本地路径；不下载私人头像、不覆盖用户配置的品牌URL。上游Custom1至Custom10等使用同一个实际存在的custom图标。上游OsonSMS原地址已404，使用项目自制文字标识SVG，清单明确说明来源。

`node scripts/vendor-assets.mjs`仅用于维护者显式刷新清单中受控来源，不抓取整个CDN，不是日常启动步骤。正常启动不依赖公共CDN下载关键图标；首次源码和npm依赖仍需要网络。

身份网关 `/static/img/`、`/static/flag-icons/` 与后台 `/admin/static/`指向同一生成目录；兼容旧 `/img/`、`/flag-icons/`引用。原生Vite字体／脚本从相应assets路径提供。缺失资源返回404纯文本，不能被SPA fallback吞掉。公开品牌SVG允许跨本项目端口加载；仍保留自定义Logo、上传文件与个人头像配置，不批量替换为默认图片。

验收脚本 `node scripts/resource-browser-fixture.mjs`可生成临时图像检查页；浏览器检查后删除 `.local/native-static/resource-check.html`。HTTP测试核对状态、MIME与非HTML，浏览器额外检查 `complete && naturalWidth > 0`。这两项都通过才能证明实际解码。可选第三方头像或外部品牌资源的可用性仍由其地址与网络决定。

后续反代须将5310与5300整体代理到各自公开主机，禁止把5305裸露到公网。无需额外CDN路径规则；公开地址变化后重新构建，启动脚本根据配置和源码哈希检测过期构建。
