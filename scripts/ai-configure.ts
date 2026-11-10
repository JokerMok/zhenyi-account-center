import { config } from "../src/server/config";
import { pool } from "../src/server/db";
import {
  modelSettings,
  saveModelSettings,
  testModelSettings,
} from "../src/server/ai-gateway";
// Trusted server operator command. Never accepts a key in argv or prints it.
try {
  if (!process.argv.includes("--from-stdin") || process.stdin.isTTY)
    throw Error("请通过标准输入安全提供网关Key；不要在命令参数中填写密钥");
  let value = "";
  for await (const chunk of process.stdin) {
    value += chunk.toString();
    if (value.length > 4096) throw Error("密钥长度异常");
  }
  const api_key = value.trim();
  if (api_key.length < 16) throw Error("未收到有效网关Key");
  const actor = (
    await pool.query(
      "SELECT uid FROM identities WHERE issuer=$1 AND subject=$2 AND organization='built-in'",
      [config.CASDOOR_URL, config.ADMIN_SUB],
    )
  ).rows[0];
  if (!actor) throw Error("未找到当前受信任管理员的稳定身份绑定");
  const current = await modelSettings();
  await saveModelSettings(
    {
      base_url: "https://api-relay.shizibandu.icu/v1",
      model: "gpt-6.1-terra",
      enabled: true,
      max_output_tokens: current.max_output_tokens,
      api_key,
      products: current.products.map((p: any) => ({
        product_id: p.id,
        enabled: p.enabled,
      })),
      reason: "按管理员授权配置正式模型中转，保留既有产品授权",
    },
    actor.uid,
  );
  console.log("模型API已配置；Key加密保存，产品授权保持原状态。");
  if (process.argv.includes("--test"))
    console.log(JSON.stringify(await testModelSettings(actor.uid)));
} catch (e: any) {
  console.error(e.name === "ZodError" ? "模型配置输入不符合规则" : e.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
