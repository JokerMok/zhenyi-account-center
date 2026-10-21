import { config, appConfigs } from "./config";
import { casdoorApi } from "./casdoor";
import { assert, tx } from "./db";
import { audit } from "./entitlements";
import { readFile, writeFile, rename, unlink } from "node:fs/promises";
import { randomBytes, createHash } from "node:crypto";

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

export function assertLocalAcceptance() {
  const local = (url: string) => {
    const parsed = new URL(url);
    return (
      parsed.protocol === "http:" &&
      ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname)
    );
  };
  assert(
    !config.production &&
      ["127.0.0.1", "::1"].includes(config.host) &&
      local(config.CASDOOR_URL) &&
      local(config.CENTER_URL),
    403,
    "LOCAL_ACCEPTANCE_ONLY",
    "临时密码豁免仅允许非生产、回环监听的本机身份服务和账号中心",
  );
}

async function verifyPassword(username: string, password: string) {
  const verifier = randomBytes(32).toString("base64url");
  const query = new URLSearchParams({
    clientId: appConfigs.admin.clientId,
    responseType: "code",
    type: "code",
    scope: "openid profile email",
    redirectUri: appConfigs.admin.url + "/auth/callback/admin",
    state: randomBytes(24).toString("hex"),
    nonce: randomBytes(24).toString("hex"),
    code_challenge_method: "S256",
    code_challenge: createHash("sha256").update(verifier).digest("base64url"),
  });
  const response = await fetch(
    new URL("/api/login?" + query, config.CASDOOR_URL),
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        application: appConfigs.admin.application,
        organization: "built-in",
        username,
        password,
        type: "code",
        autoSignin: false,
        signinMethod: "Password",
        loginMethod: "password",
      }),
      signal: AbortSignal.timeout(8000),
    },
  );
  const result = (await response.json()) as any;
  assert(
    response.ok &&
      result.status === "ok" &&
      typeof result.data === "string" &&
      result.data.length > 0,
    502,
    "PASSWORD_LOGIN_FAILED",
    "身份服务接受了改密，但新密码登录验证未通过；请检查管理员禁用、MFA或应用登录配置",
  );
}

// Passwords are not retained as a second source of truth after changing Casdoor.
async function clearBootstrapPasswords() {
  for (const name of [
    ".local/credentials.json",
    ".local/casdoor/init_data.json",
    ".local/casdoor/init_data.applied.json",
  ]) {
    let data: any;
    try {
      data = JSON.parse(await readFile(name, "utf8"));
    } catch (e: any) {
      if (e.code === "ENOENT") continue;
      throw e;
    }
    if (data.administrator) delete data.administrator.password;
    for (const user of data.users || []) {
      delete user.password;
      delete user.passwordSalt;
    }
    const tmp = name + ".redacting-" + randomBytes(8).toString("hex");
    await writeFile(tmp, JSON.stringify(data, null, 2), {
      mode: 0o600,
      flag: "wx",
    });
    await rename(tmp, name);
  }
  await unlink(".local/admin-bootstrap.json").catch((e) => {
    if (e.code !== "ENOENT") throw e;
  });
}

export async function resetAdminPassword(
  password: string,
  options: { localAcceptance?: boolean } = {},
) {
  const acceptance = options.localAcceptance === true;
  if (acceptance) assertLocalAcceptance();
  assert(
    password.length >= (acceptance ? 1 : 8) &&
      Buffer.byteLength(password) <= 72 &&
      !password.includes(" "),
    400,
    "PASSWORD_INVALID",
    acceptance
      ? "密码不能为空、最多72字节且不含空格"
      : "密码至少8位、最多72字节且不含空格",
  );
  const user = await administrator();
  await applyAdminPasswordPolicy();
  let changed = false;
  try {
    if (acceptance) {
      const org = await casdoorApi("get-organization", {
        id: "admin/built-in",
      });
      await casdoorApi(
        "update-organization",
        { id: "admin/built-in" },
        { ...org, passwordOptions: [] },
      );
    }
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
    const reason = String(result.msg || "身份服务未确认")
      .replaceAll(password, "[隐藏]")
      .slice(0, 180);
    assert(
      response.ok && result.status === "ok",
      502,
      "PASSWORD_RESET_FAILED",
      "Casdoor 拒绝改密：" + reason,
    );
    changed = true;
    const after = await administrator();
    assert(
      after.id === user.id && after.name === user.name,
      500,
      "SUBJECT_CHANGED",
      "管理员身份不一致",
    );
    // set-password expires OAuth tokens in v4.22.0 but does not delete native browser sessions.
    const nativeSessions = await casdoorApi("get-sessions", {
      owner: "built-in",
    });
    for (const session of nativeSessions.filter(
      (s: any) => s.name === user.name,
    ))
      await casdoorApi("delete-session", {}, session);
    await tx(async (db) => {
      const identity = (
        await db.query(
          `INSERT INTO identities(issuer,subject,organization,username,display_name) VALUES($1,$2,'built-in',$3,$4)
         ON CONFLICT(issuer,subject) DO UPDATE SET username=EXCLUDED.username RETURNING uid`,
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
    await clearBootstrapPasswords();
    await verifyPassword(user.name, password);
    return { username: user.name, subject: user.id };
  } catch (e: any) {
    if (e.code === "PASSWORD_RESET_FAILED" || e.code === "SUBJECT_CHANGED")
      throw e;
    throw new Error(
      changed
        ? "Casdoor 密码已更新，但后续会话清理、材料清理或登录验证未全部完成：" +
          e.message
        : "未确认密码重置成功（网络中断时结果可能未知）；请确认 Casdoor 与数据库已启动后重试：" +
          e.message,
    );
  } finally {
    // Only the temporary write is exempt. Login never requires downgrading the normal policy.
    if (acceptance) await applyAdminPasswordPolicy();
  }
}
