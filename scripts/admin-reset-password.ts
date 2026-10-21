import { createInterface } from "node:readline";
import { Writable } from "node:stream";
import {
  resetAdminPassword,
  assertLocalAcceptance,
} from "../src/server/admin-account";
import { pool } from "../src/server/db";
if (!process.stdin.isTTY || !process.stdout.isTTY)
  throw Error("请在本机交互式终端运行；不接受命令行密码或管道输入。");
const silent = new Writable({
  write(_chunk, _enc, done) {
    done();
  },
});
const rl = createInterface({
  input: process.stdin,
  output: silent,
  terminal: true,
});
const ask = (prompt: string) =>
  new Promise<string>((resolve) => {
    process.stdout.write(prompt);
    rl.question("", (answer) => {
      process.stdout.write("\n");
      resolve(answer);
    });
  });
try {
  const options = process.argv.slice(2);
  if (options.some((x) => x !== "--local-acceptance"))
    throw Error("不支持的选项；密码只能隐藏交互输入");
  const localAcceptance = options.includes("--local-acceptance");
  if (localAcceptance) assertLocalAcceptance();
  const first = await ask(
      localAcceptance
        ? "新管理员密码（隐藏输入，仅本机临时验收）："
        : "新管理员密码（隐藏输入，至少8位）：",
    ),
    second = await ask("再次输入新密码（隐藏输入）：");
  if (first !== second) throw Error("两次密码不一致，未修改");
  const result = await resetAdminPassword(first, { localAcceptance });
  console.log(
    `管理员 ${result.username} 的密码已更新，subject 保持不变，旧会话已清除。请重新登录。`,
  );
} catch (e: any) {
  const unavailable = ["ECONNREFUSED", "ENOTFOUND", "ETIMEDOUT"].includes(
    e.cause?.code,
  );
  console.error(
    unavailable
      ? `无法连接身份服务（${e.cause.code}）；请先运行 npm start，再重试。未确认密码重置成功。`
      : e.message,
  );
  process.exitCode = 1;
} finally {
  rl.close();
  await pool.end();
}
