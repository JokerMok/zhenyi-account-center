# 内置界面资源

manifest.json记录固定Casdoor v4.22.0源码引用所需的图片子集、官方CDN来源、SHA-256与大小，不是完整CDN抓取。文件纳入Git，正常启动不再依赖这些CDN。项目保留Casdoor Apache-2.0许可；品牌标志各属对应权利人，仅用于标明提供者，不表示合作或授权。

OsonSMS原生引用的SVG在上游不存在，本项目提供明确名称的文字标签图（项目自制，不冒充官方Logo），在清单中单独标注。自定义OAuth提供者按上游规则使用Custom图标或用户配置的customLogo，不抓取私人头像。

旗帜来自锁定npm依赖flag-icons@7.5.0（MIT，许可证在node_modules/flag-icons/LICENSE），构建按原生大写国家码及小写文件名同步。Inter字体来自上游锁定的@fontsource-variable/inter，原生Vite输出字体文件；其SIL OFL许可随包保留。scripts/sync-native-assets.mjs校验图片并同步到.local/native-static，字体留在原生assets中。scripts/vendor-assets.mjs用于按固定源码更新明确资源清单；正常构建只校验和复制，不重新联网抓图。
