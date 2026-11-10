// Casdoor's credential-free quick sign-in is valid only while its server session exists.
// A stale AccountProvider value must never surface the upstream AuthForm dump.
export function isSessionSigninFailure(values: any, result: any): boolean {
  return (
    result?.status !== "ok" &&
    !values?.signinMethod &&
    !values?.provider &&
    !values?.providerBack
  );
}
