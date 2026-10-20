import { casdoorApi } from "../src/server/casdoor";
import { pool } from "../src/server/db";
import { seedCatalog } from "../src/server/catalog";
import { readFile, writeFile, access } from "node:fs/promises";
import { config } from "../src/server/config";
const admin = await casdoorApi("get-user", { id: "built-in/admin" });
if (!admin?.id || !admin.isAdmin) throw new Error("初始化管理员身份不符合要求");
const confirmed = await access(".local/admin-subject.confirmed").then(
  () => true,
  () => false,
);
if (!confirmed) {
  const env = await readFile(".env", "utf8");
  await writeFile(
    ".env",
    env.replace(/^ADMIN_SUB=.*$/m, "ADMIN_SUB=" + admin.id),
    { mode: 0o600 },
  );
  await writeFile(".local/admin-subject.confirmed", admin.id, { mode: 0o600 });
} else if (admin.id !== config.ADMIN_SUB)
  throw new Error("管理员 subject 与已确认配置不一致，请核查身份初始化");
await seedCatalog();
for (const id of ["beadgrid", "focustake"]) {
  const exists = await casdoorApi("get-plan", {
    id: `consumers/${id}-monthly`,
  });
  if (!exists)
    await casdoorApi(
      "add-plan",
      {},
      {
        owner: "consumers",
        name: `${id}-monthly`,
        displayName: id === "beadgrid" ? "拼豆月度权益" : "录屏月度权益",
        createdTime: new Date().toISOString(),
        description: "本地接入配置。未启用收费，无支付服务商。",
        price: 0,
        currency: "CNY",
        period: "Monthly",
        role: "",
        paymentProviders: [],
        isEnabled: false,
        isExclusive: true,
      },
    );
}
console.log("Casdoor 套餐映射已准备；未启用收费。");
await pool.end();
