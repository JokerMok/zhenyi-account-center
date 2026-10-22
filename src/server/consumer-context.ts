import { createHash } from "node:crypto";

export const consumerTabs = ["overview", "security", "redeem", "records"];
// This is navigation context, never authentication or an arbitrary return URL.
export function consumerTarget(
  query: Record<string, unknown>,
  apps: Record<string, { enabled: boolean; url: string }>,
) {
  const product = query.product === undefined ? "" : String(query.product);
  const tab = query.tab === undefined ? "overview" : String(query.tab);
  const account = query.account === undefined ? "" : String(query.account);
  if (
    (product &&
      (!apps[product]?.enabled || ["center", "admin"].includes(product))) ||
    !consumerTabs.includes(tab) ||
    (account &&
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        account,
      ))
  )
    throw Error("个人中心目标无效，请从产品重新进入");
  const params = new URLSearchParams();
  if (product) params.set("product", product);
  if (tab !== "overview") params.set("tab", tab);
  if (account) params.set("account", account);
  return { product, tab, account, path: params.size ? "/?" + params : "/" };
}
export const flowCookieSuffix = (app: string, state: string) =>
  "login_" +
  app +
  "_" +
  createHash("sha256").update(state).digest("hex").slice(0, 24);
export const escapeHtml = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
