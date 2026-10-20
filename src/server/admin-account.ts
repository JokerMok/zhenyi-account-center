import { config, appConfigs } from "./config";
import { casdoorApi } from "./casdoor";
import { assert, pool, tx } from "./db";
import { audit } from "./entitlements";
export async function administrator() {
  const user = await casdoorApi("get-user", {
    owner: "built-in",
    userId: config.ADMIN_SUB,
  });
  assert(
    user?.id === config.ADMIN_SUB && user.isAdmin && !user.isDeleted,
    403,
    "ADMIN_IDENTITY_MISMATCH",
    "管理员稳定身份不匹配，未修改密码",
  );
  return user;
}
export async function applyAdminPasswordPolicy() {
  const org = await casdoorApi("get-organization", { id: "admin/built-in" });
  assert(org, 502, "ADMIN_ORG_MISSING", "管理员组织不存在");
  if (
    JSON.stringify(org.passwordOptions) !== '["AtLeast8"]' ||
    org.passwordExpireDays
  ) {
    await casdoorApi(
      "update-organization",
      { id: "admin/built-in" },
      { ...org, passwordOptions: ["AtLeast8"], passwordExpireDays: 0 },
    );
  }
}
export async function resetAdminPassword(password: string) {
  assert(
    password.length >= 8 &&
      Buffer.byteLength(password) <= 72 &&
      !password.includes(" "),
    400,
    "PASSWORD_INVALID",
    "密码至少8位、最多72字节且不含空格",
  );
  const user = await administrator();
  await applyAdminPasswordPolicy();
  const response = await fetch(
    new URL("/api/set-password", config.CASDOOR_URL),
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(appConfigs.admin.clientId + ":" + appConfigs.admin.secret).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        userOwner: "built-in",
        userName: user.name,
        oldPassword: "",
        newPassword: password,
      }),
      signal: AbortSignal.timeout(8000),
    },
  );
  const result = (await response.json()) as any;
  assert(
    response.ok && result.status === "ok",
    502,
    "PASSWORD_RESET_FAILED",
    "Casdoor 未确认密码重置，请核查服务后重试",
  );
  const after = await administrator();
  assert(after.id === user.id, 500, "SUBJECT_CHANGED", "管理员身份不一致");
  await tx(async (db) => {
    const identity = (
      await db.query(
        `INSERT INTO identities(issuer,subject,organization,username,display_name) VALUES($1,$2,'built-in',$3,$4) ON CONFLICT(issuer,subject) DO UPDATE SET username=EXCLUDED.username RETURNING uid`,
        [config.CASDOOR_URL, user.id, user.name, user.displayName],
      )
    ).rows[0];
    await db.query("DELETE FROM sessions WHERE uid=$1", [identity.uid]);
    await audit(
      db,
      identity.uid,
      "admin_password_reset",
      user.id,
      "本机交互式恢复命令",
      { subject: user.id },
      { subject: after.id, password_changed: true },
    );
  });
  return { username: user.name, subject: user.id };
}
