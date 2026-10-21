"""Extract the locked source, never online HEAD. Re-run after applying a version upgrade."""
import re,json,pathlib,hashlib
root=pathlib.Path('.upstream/source-v4.22.0')
base='https://github.com/casdoor/casdoor/blob/v4.22.0/'
app=(root/'web/src/App.tsx').read_text()
front=[{'path':m.group(1),'component':m.group(2),'source':base+'web/src/App.tsx#L'+str(app[:m.start()].count('\n')+1)} for m in re.finditer(r'<Route path="([^"]+)" element=\{<([\w]+)',app)]
back=[]
for file in sorted((root/'routers').glob('*.go')):
 s=file.read_text()
 for m in re.finditer(r'web\.Router\("([^"]+)"[^\n]*?"([^"\n]+:[^"\n]+)"\)',s):
  back.append({'path':m.group(1),'handler':m.group(2),'source':base+str(file.relative_to(root))+'#L'+str(s[:m.start()].count('\n')+1)})
rows=[
('总览','仪表盘','/','get-dashboard',''),('总览','快捷操作','/shortcuts','',''),('总览','应用门户','/apps','get-applications',''),('总览','系统信息','/sysinfo','get-version-info',''),
('用户与组织','用户资料','/users','get-users',''),('用户与组织','组织与密码规则','/organizations','get-organizations',''),('用户与组织','分组与组织树','/groups','get-groups',''),('用户与组织','注册邀请','/invitations','get-invitations','邮件发送需要邮件提供者'),('用户与组织','个人资料与账号安全','/account','',''),
('身份与接入','应用与协议','/applications','get-applications','OIDC/SAML/CAS应用配置及精确回调'),('身份与接入','身份及服务提供者','/providers','get-providers','第三方账号、邮件、短信、存储、支付、验证码等服务需要各自凭据'),('身份与接入','应用市场','/marketplace','get-marketplace-index','需要访问官方应用市场网络'),('身份与接入','已安装集成','/integrations','get-integrations','具体集成的外部应用'),('身份与接入','资源与存储','/resources','get-resources','上传需要可用存储提供者'),('身份与接入','证书','/certs','get-certs',''),('身份与接入','密钥','/keys','get-keys',''),
('角色与策略','角色','/roles','get-roles',''),('角色与策略','权限与策略','/permissions','get-permissions',''),('角色与策略','Casbin模型','/models','get-models',''),('角色与策略','策略适配器','/adapters','get-adapters','独立存储时需要目标数据库'),('角色与策略','策略执行器','/enforcers','get-enforcers','需要模型和适配器'),
('AI与MCP','智能体','/agents','get-agents','外部智能体地址与凭据'),('AI与MCP','MCP服务器','/servers','get-servers','MCP服务地址；远程服务需其授权'),('AI与MCP','MCP市场','/server-store','get-servers','访问市场网络'),('AI与MCP','接入入口','/entries','get-entries','关联智能体或MCP服务器'),('AI与MCP','站点与访问代理','/sites','get-sites','站点域名与上游服务配置'),('AI与MCP','转发规则','/rules','get-rules','关联站点和提供者'),
('会话与审计','登录会话','/sessions','get-sessions',''),('会话与审计','身份审计日志','/records','get-records',''),('会话与审计','访问令牌','/tokens','get-tokens',''),('会话与审计','验证记录','/verifications','get-verifications','发送验证依赖邮件或短信'),
('商业管理','商品商店','/product-store','get-products','可售商品与支付配置'),('商业管理','商业商品','/products','get-products',''),('商业管理','支付优惠券','/coupons','get-coupons',''),('商业管理','购物车','/cart','get-user',''),('商业管理','订单','/orders','get-orders',''),('商业管理','支付记录','/payments','get-payments','真实交易需要商户凭据'),('商业管理','商业套餐','/plans','get-plans',''),('商业管理','定价页','/pricings','get-pricings',''),('商业管理','订阅','/subscriptions','get-subscriptions',''),('商业管理','资金交易','/transactions','get-transactions',''),
('集成与工具','表单','/forms','get-forms',''),('集成与工具','目录与数据同步','/syncers','get-syncers','同步目标地址、数据库或外部目录凭据'),('集成与工具','Webhook配置','/webhooks','get-webhooks','通知目标URL'),('集成与工具','Webhook投递记录','/webhook-events','get-webhook-events',''),('集成与工具','工单','/tickets','get-tickets',''),('集成与工具','API浏览器','/swagger','',''),
]
mods=[]
for group,label,path,endpoint,dep in rows:
 sources=[x['source'] for x in front if x['path']==path]
 mods.append(dict(id=path.strip('/') or 'dashboard',group=group,label=label,path=path,endpoint=endpoint,dependencies=dep,source=sources[0] if sources else base+'routers/router.go',owner='Casdoor',status='已配置，尚未验证',verification='待本轮真实接口和操作检查'))
for m in mods:
 for r in front+back:
  r.setdefault('integration','原生实现保留；操作验证按所属模块记录，不代表逐接口全部通过')
provider_text=(root/'web/src/lib/setting.tsx').read_text().split('export function getProviderTypeOptions(category) {',1)[1].split('export function getCryptoAlgorithmOptions',1)[0]
provider_types=sorted(set(re.findall(r'id:\s*[\"\']([^\"\']+)[\"\']',provider_text)))
inv=dict(version='v4.22.0',source=base,source_archive_sha256=hashlib.sha256(pathlib.Path('.upstream/source-v4.22.0.tar.gz').read_bytes()).hexdigest(),frontend_routes=front,backend_routes=back,modules=mods,notes=['路由清单不是操作验收结果；运行结果见实际验收记录。','README提及A2A，但固定源码未发现独立A2A路由或实现，不把智能体页面等同A2A协议。','LDAP、MFA、WebAuthn、CAS、SAML、SCIM、OAuth设备流等配置在组织、用户或应用详情中；接口见完整后端清单。'])
inv['provider_type_options']=provider_types
inv['capabilities']=json.loads(pathlib.Path('config/casdoor-capabilities.json').read_text())
pathlib.Path('docs/generated/casdoor-v4.22.0-inventory.json').write_text(json.dumps(inv,ensure_ascii=False,indent=2)+'\n')
pathlib.Path('config/casdoor-modules.json').write_text(json.dumps(mods,ensure_ascii=False,indent=2)+'\n')
print(f'{len(front)} frontend routes, {len(back)} backend routes, {len(mods)} management entries')
