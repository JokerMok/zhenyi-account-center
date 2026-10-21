import { spawnSync } from "node:child_process";
if (!process.stdin.isTTY)
  throw Error("请在本机交互式终端运行；正式密码只接受隐藏输入。");
const result = spawnSync(
  "ssh",
  [
    "-t",
    "tencent-main",
    "sudo /srv/apps/zhenyi-accounts/deploy/manage.sh admin:reset-password",
  ],
  { stdio: "inherit" },
);
process.exitCode = result.status || 0;
