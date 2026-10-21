import { casdoorApi } from "../src/server/casdoor";
import { pool } from "../src/server/db";
import { seedCatalog } from "../src/server/catalog";
import { readFile, writeFile, access } from "node:fs/promises";
import { config, productApps } from "../src/server/config";
import { applyAdminPasswordPolicy } from "../src/server/admin-account";
const chosen = await readFile(".local/admin-bootstrap.json", "utf8")
  .then(JSON.parse)
  .catch(() => null);
const admin = await casdoorApi(
  "get-user",
  chosen
    ? { id: "built-in/" + chosen.username }
    : { owner: "built-in", userId: config.ADMIN_SUB },
);
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
if (!confirmed || chosen) await applyAdminPasswordPolicy();
if (chosen) {
  const org = await casdoorApi("get-organization", { id: "admin/built-in" });
  await casdoorApi(
    "update-organization",
    { id: "admin/built-in" },
    { ...org, hasPrivilegeConsent: false },
  );
}
for (const name of ["built-in", "consumers"]) {
  const org = await casdoorApi("get-organization", { id: "admin/" + name });
  if (!org.logo)
    await casdoorApi(
      "update-organization",
      { id: "admin/" + name },
      {
        ...org,
        logo: config.CENTER_URL + "/brand.svg",
        logoDark: config.CENTER_URL + "/brand.svg",
      },
    );
}
const workerConfig = {
  owner: "built-in",
  organization: "built-in",
  name: "zhenyi-worker-bootstrap",
  url: "http://127.0.0.1/disabled",
  method: "POST",
  contentType: "application/json",
  events: [],
  singleOrgOnly: true,
  isEnabled: false,
  createdTime: new Date().toISOString(),
};
if (
  !(await casdoorApi("get-webhook", { id: "built-in/" + workerConfig.name }))
) {
  await casdoorApi("add-webhook", {}, workerConfig);
  await writeFile(".local/restart-native-worker", "首次初始化Webhook投递任务", {
    mode: 0o600,
  });
}
const template = await casdoorApi("get-application", {
  id: "admin/zhenyi-center",
});
for (const p of productApps.filter((p) => p.enabled)) {
  const existing = await casdoorApi("get-application", {
    id: "admin/" + p.application,
  });
  if (existing) {
    if (existing.clientId !== p.clientId)
      throw Error(
        `产品 ${p.id} 的 Casdoor client ID 与配置不一致，未覆盖既有应用`,
      );
    continue;
  }
  await casdoorApi(
    "add-application",
    {},
    {
      ...template,
      name: p.application,
      displayName: p.name,
      homepageUrl: p.url,
      clientId: p.clientId,
      clientSecret: p.secret,
      redirectUris: [p.url + "/auth/callback/" + p.id],
      organization: "consumers",
      createdTime: new Date().toISOString(),
    },
  );
}
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
