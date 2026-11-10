import { test } from "node:test";
import assert from "node:assert/strict";
import { isSessionSigninFailure } from "../upstream/extensions/session-signin";
test("失效的原生快捷会话退回登录，成功与显式密码/MFA登录不被误判", () => {
  const quick = {
    type: "code",
    application: "zhenyi-admin",
    organization: "built-in",
  };
  assert.equal(
    isSessionSigninFailure(quick, {
      status: "error",
      msg: "Unknown authentication type, form = sensitive",
    }),
    true,
  );
  assert.equal(
    isSessionSigninFailure(quick, { status: "ok", data: "code" }),
    false,
  );
  assert.equal(
    isSessionSigninFailure(quick, { status: "ok", data: "MfaRequired" }),
    false,
  );
  assert.equal(
    isSessionSigninFailure(
      { ...quick, signinMethod: "Password" },
      { status: "error" },
    ),
    false,
  );
  assert.equal(
    isSessionSigninFailure(
      { ...quick, provider: "github" },
      { status: "error" },
    ),
    false,
  );
});
