import { readFileSync } from "node:fs";
const x = JSON.parse(readFileSync(".local/credentials.json", "utf8"));
console.log(
  "仅本机使用；切勿提交或对外分享。\nCasdoor 管理组织：" +
    x.administrator.organization +
    "\n用户名：" +
    x.administrator.username +
    "\n密码：" +
    x.administrator.password,
);
