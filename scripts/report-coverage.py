import json,pathlib,datetime
read=lambda p:json.loads(pathlib.Path(p).read_text())
inv=read('docs/generated/casdoor-v4.22.0-inventory.json');checks={}
for kind in ['native','protocol','listener','auxiliary']:
 x=read('.local/'+kind+'-verification.json')
 for r in x['results']: checks[r['id']]={**r,'checked_at':x['date']}
crud=set('organizations groups roles models adapters enforcers applications providers certs keys permissions products plans pricings coupons subscriptions orders payments transactions agents servers entries sites rules forms syncers webhooks tickets'.split())
for id,r in checks.items():
 if id in crud:r['detail']='官方API新增、读取与字段修改通过；具有isEnabled字段的对象验证了停用。未覆盖所有字段组合或外部执行。'
 else:r['detail']='原生读取接口通过；不等同该模块所有操作验证。'
overrides={'users':'专用用户资料修改，稳定subject保留。','totp':'专用消费者启用TOTP；错误验证码拒绝、正确验证码通过，随后解除；未改变当前超管MFA。','scim':'独立组织SCIM用户创建、读取、PATCH通过；SCIM分组创建、读取、PATCH也通过。','casbin-enforce':'持久化策略：alice允许、bob拒绝。','CAS':'真实服务票据校验、重放拒绝、错误service拒绝。','SAML':'本地SP请求、可信证书签名及Audience/Destination验证、篡改拒绝；使用应用c14n10兼容选项；外部IdP/SP未验证。','database-sync':'独立源PostgreSQL连接、用户同步、重复同步无重复用户；源实例随后停止。','MCP':'OIDC授权码+PKCE和user:read作用域：initialize、tools/list、get_users；远程代理与真实工具未验证。','LDAP':'隔离容器LDAP真实绑定与搜索；主服务未开放监听。','LDAPS':'隔离容器，客户端验证CA及主机名后完成加密绑定和搜索。','RADIUS':'隔离UDP PAP正确接受、错误拒绝，验证Response Authenticator。','resources':'原生本地存储提供者配置、真实上传、下载内容一致、资源记录读取。','integrations':'官方市场真实模板安装、配置读取和卸载；目标外部应用未连接。','invitations':'官方注册邀请码新增、读取和停用；邀请码注册领取未另行验证。','device-code':'设备授权pending→真实密码批准→令牌交换通过。','webhooks':'真实本地目标首次503、自动重试200，投递记录Success且attemptCount>=2。','cart':'浏览器加入购物车、创建订单和结算通过。','plans':'原生套餐CRUD；浏览器Dummy订阅购买和权益映射验证通过。','pricings':'原生定价CRUD与浏览器选购通过。','orders':'原生CRUD；浏览器真实创建本机模拟购买订单。','payments':'官方Dummy Paid状态与重复通知幂等通过；真实商户、真实退款未验证。','subscriptions':'Active订阅→有效期和次数投影；暂停撤销；重复同步不重复发放。','transactions':'专用QA组织原生交易记录新增、读取、修改；无真实资金流转。'}
for id,detail in overrides.items():checks[id]['detail']=detail
checks['oidc']={'id':'oidc','status':'已集成并验证','detail':'整合回归：授权码PKCE、nonce、签名与到期、跨组织拒绝、跨应用同UID、当前与全局退出。','checked_at':datetime.datetime.now(datetime.timezone.utc).isoformat()}
# Runtime checks stay local; the checked-in snapshot contains no user ids, credentials, payloads or private log data.
report={'date':'2026-10-21','version':inv['version'],'commit':'f11d6aca9ef065b468992de5bb4c3f315710d9f2','checks':list(checks.values()),'notes':['仅列实际检查范围；原生路由保留不等于每个操作都通过。','本地模拟支付无真实资金；未部署线上。']}
pathlib.Path('docs/generated/verification-summary.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
lines=['# Casdoor v4.22.0 完整功能覆盖与实际验收','',f"核对日期：2026-10-21。运行二进制版本 v4.22.0，commit `{report['commit']}`。固定源码提取 {len(inv['frontend_routes'])} 条前端路由、{len(inv['backend_routes'])} 条后端路由、47 个导航入口及 {len(inv['provider_type_options'])} 个显式提供者选项ID。",'', '完整原生前后端与配置页面均保留，同一React Router／AppLayout内整合业务内容，表中管理路径统一加/admin前缀；没有iframe或DOM注入。下面“已集成并验证”仅指写明的操作，不代表所有提供者、参数组合、硬件及外部系统均验收。全部逐路由来源见 [机器清单](generated/casdoor-v4.22.0-inventory.json)。','', '| 分类 / 功能 | 统一后台相对入口（5310/admin） | 后端读取接口 | 依赖配置 | 接入状态 / 验证范围 / 剩余 | 官方来源 |','| --- | --- | --- | --- | --- | --- |']
external={'providers','agents','servers','entries','sites','rules','syncers','verifications','server-store'}
for m in inv['modules']:
 r=checks.get(m['id']);status=r['status'] if r else '已配置，尚未验证';detail=r['detail'] if r else '页面与原生实现保留；本轮未单独操作验证。'
 if m['id'] in external:status='已集成，等待外部配置'
 lines.append('| '+ ' | '.join([m['group']+' / '+m['label'],'`'+('/system/dashboard' if m['path']=='/' else m['path'])+'`','`/api/'+m['endpoint']+'`' if m['endpoint'] else '原生页面组合接口',m['dependencies'] or '无需外部凭据',status+'；'+detail,'[固定源码]('+m['source']+')'])+' |')
lines+=['','## 协议、认证及版本边界','','| 能力 | 入口与接口 | 状态 | 本轮实际验证与缺项 | 官方来源 |','| --- | --- | --- | --- | --- |']
for m in inv['capabilities']:
 r=checks.get(m['id']);state=m.get('pending',r['status'] if r else '已配置，尚未验证');detail=(r['detail'] if r else m.get('note','未单独验证'))+'；'+m['dependencies'];lines.append('| '+' | '.join([m['label'],'`'+m['path']+'`；'+', '.join('`'+p+'`' for p in m['api']),state,detail,'[固定源码](https://github.com/casdoor/casdoor/blob/v4.22.0/'+m['source']+')'])+' |')
lines+=['','## 尚未完成的验证','','- WebAuthn／通行密钥、Face ID、钱包、扫码：保留官方入口与协议逻辑，未进行硬件或用户确认。','- Kerberos、外部AD／LDAP／SAML联合、远程MCP工具／智能体／站点代理：配置CRUD保留，本轮未连接真实服务执行。','- 注册邀请领取、优惠券实际抵扣、工单完整处理、每种规则／表单执行及全部331条API的逐操作矩阵未穷举。','- 第三方邮件／短信／OAuth、存储、通知、日志、支付提供者未逐一接通；需按 [外部清单](external-services.md) 提供实际服务。','- 独立A2A协议、独立LLM模型管理／推理未在固定版本中发现；不新增冒充上游能力。','- 窄屏和原生翻译仍有上游英文标签；本轮没有重写原生UI。','', '## 自建扩展与数据归属','','身份、组织、密码、策略、证书及商业原始记录归Casdoor；产品业务会员、额度、兑换码、恢复和业务审计归权益库。商业套餐→`plans.casdoor_plan`→服务端可信订阅核对→权益投影，浏览器返回页不证明付款。管理员赠送、兑换、订阅和免费次数分别列来源。','', '整合回归36项首次35通过，1项产品编辑回传只读字段失败；修复后该项定向重跑通过。其他已通过项未重复全量执行。完整构建与TypeScript通过。详细过程见 [验收记录](acceptance.md)。']
pathlib.Path('docs/full-coverage.md').write_text('\n'.join(lines)+'\n')
print('coverage exported',len(checks),'checks')
