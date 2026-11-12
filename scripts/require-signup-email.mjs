import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import dotenv from "dotenv";

const env = dotenv.parse(await readFile(".env"));
const port = Number(env.CASDOOR_BACKEND_PORT || 5305);
if (!Number.isInteger(port) || port < 1 || port > 65535)
  throw Error("Casdoor 内部端口无效");
if (!env.CASDOOR_ADMIN_CLIENT_ID || !env.CASDOOR_ADMIN_CLIENT_SECRET)
  throw Error("缺少 Casdoor 管理应用凭据");
const authorization =
  "Basic " +
  Buffer.from(
    env.CASDOOR_ADMIN_CLIENT_ID + ":" + env.CASDOOR_ADMIN_CLIENT_SECRET,
  ).toString("base64");

async function api(endpoint, query, body) {
  const url = new URL("http://127.0.0.1:" + port + "/api/" + endpoint);
  url.search = new URLSearchParams(query).toString();
  const response = await fetch(url, {
    method: body ? "POST" : "GET",
    headers: {
      Authorization: authorization,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(10000),
  });
  const result = await response.json();
  if (!response.ok || result.status !== "ok")
    throw Error(endpoint + " 失败，HTTP " + response.status);
  return result.data;
}

async function configure() {
  const apps = await api("get-applications", { owner: "admin" });
  const names = process.argv
    .filter((arg) => arg.startsWith("--application="))
    .map((arg) => arg.slice("--application=".length));
  const candidates = apps.filter(
    (app) =>
      app.organization === "consumers" &&
      app.enableSignUp &&
      (names.length === 0 || names.includes(app.name)),
  );
  if (names.some((name) => !candidates.some((app) => app.name === name)))
    throw Error("所选应用不存在，或未开启消费者注册");
  const changes = [];
  for (const candidate of candidates) {
    const id = "admin/" + candidate.name;
    const app = await api("get-application", { id });
    if (app.organization !== "consumers" || !app.enableSignUp) continue;
    const items = app.signupItems || [];
    const email = items.find((item) => item.name === "Email");
    if (email?.visible && email.required) continue;
    const requiredEmail = {
      ...email,
      name: "Email",
      visible: true,
      required: true,
      rule: email?.visible ? email.rule : "No verification",
    };
    const signupItems = email
      ? items.map((item) => (item.name === "Email" ? requiredEmail : item))
      : [...items, requiredEmail];
    changes.push({ id, app, signupItems });
  }
  console.log(
    "待设为邮箱必填的注册应用",
    changes.map(({ id }) => id),
  );
  if (!process.argv.includes("--apply") || changes.length === 0) return;

  const snapshot = resolve(
    ".local",
    "signup-email-before-" + Date.now() + ".json",
  );
  await writeFile(
    snapshot,
    JSON.stringify(
      changes.map(({ id, app }) => ({ id, signupItems: app.signupItems })),
      null,
      2,
    ) + "\n",
    { mode: 0o600, flag: "wx" },
  );
  console.log("注册字段变更前快照", snapshot);
  const attempted = [];
  try {
    for (const change of changes) {
      attempted.push(change);
      await api(
        "update-application",
        { id: change.id },
        {
          ...change.app,
          signupItems: change.signupItems,
        },
      );
      const saved = await api("get-application", { id: change.id });
      const email = saved.signupItems.find((item) => item.name === "Email");
      if (!email?.required || !email.visible)
        throw Error(change.id + " 邮箱字段写入后核对失败");
      console.log(change.id + " 邮箱已设为必填");
    }
  } catch (error) {
    for (const change of attempted.reverse()) {
      try {
        const current = await api("get-application", { id: change.id });
        await api(
          "update-application",
          { id: change.id },
          {
            ...current,
            signupItems: change.app.signupItems,
          },
        );
      } catch {
        console.error(change.id + " 自动回滚失败，请从注册字段快照恢复");
      }
    }
    throw error;
  }
}

if (env.NODE_ENV === "production" && process.argv.includes("--apply")) {
  const ops = JSON.parse(
    await readFile("/srv/apps/zhenyi-accounts/shared/config/ops.json", "utf8"),
  );
  const { withOperationLock } = await import(
    pathToFileURL(resolve("scripts/ops-runtime.mjs"))
  );
  await withOperationLock(ops.lockDir, configure);
} else {
  await configure();
}
