import { runtimeApp } from "../src/server/config";
import { recoverDemoJobs } from "../src/server/demo-runner";
import { pool } from "../src/server/db";
try {
  if (runtimeApp === "center" || runtimeApp === "admin")
    throw Error("请指定示例产品：APP_ID=beadgrid npm run demo:recover");
  const results = await recoverDemoJobs(runtimeApp);
  console.log(
    JSON.stringify({
      processed: results.length,
      states: results.map((r) => r.status),
    }),
  );
} finally {
  await pool.end();
}
