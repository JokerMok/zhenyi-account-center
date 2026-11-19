import { config } from "./config";
export const ownerQuotaCompatibilityBalance = 2147483647;
// Only identities registered from the existing trusted issuer and stable subject qualify.
export function isPlatformOwner(identity: {
  issuer: string;
  subject: string;
  organization: string;
}) {
  return (
    identity.issuer === config.CASDOOR_URL &&
    identity.subject === config.ADMIN_SUB &&
    identity.organization === "built-in"
  );
}
