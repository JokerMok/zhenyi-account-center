import dotenv from "dotenv";
import { z } from "zod";
import { readProductRegistry } from "./product-registry";
export const runtimeApp = process.env.APP_ID || "center";
dotenv.config({
  path:
    process.env.DOTENV_CONFIG_PATH ||
    (runtimeApp === "center" ? ".env" : `.local/${runtimeApp}.env`),
  quiet: true,
});
const port = z.coerce.number().int().min(1024).max(65535);
const url = z
  .url()
  .refine((s) => ["http:", "https:"].includes(new URL(s).protocol))
  .transform((s) => s.replace(/\/$/, ""));
const env = z
  .object({
    DATABASE_URL: z.string().min(10),
    CASDOOR_URL: url,
    CENTER_URL: url,
    CASDOOR_CENTER_CLIENT_ID: z.string().default(""),
    CASDOOR_CENTER_CLIENT_SECRET: z.string().default(""),
    CASDOOR_ADMIN_CLIENT_ID: z.string().default(""),
    CASDOOR_ADMIN_CLIENT_SECRET: z.string().default(""),
    ADMIN_SUB: z.string().default(""),
    REDEMPTION_PEPPER: z.string().default(""),
  })
  .parse(process.env);
export type AppId = string;
export type AppConfig = {
  id: string;
  name: string;
  url: string;
  application: string;
  clientId: string;
  secret: string;
  serviceKey: string;
  enabled: boolean;
  port: number;
};
export const productRegistrations = readProductRegistry();
export const appConfigs: Record<string, AppConfig> = {
  center: {
    id: "center",
    name: "臻一账号中心",
    url: env.CENTER_URL,
    application: "zhenyi-center",
    clientId: env.CASDOOR_CENTER_CLIENT_ID,
    secret: env.CASDOOR_CENTER_CLIENT_SECRET,
    serviceKey: "",
    enabled: true,
    port: port.parse(process.env.CENTER_PORT || 5310),
  },
  admin: {
    id: "admin",
    name: "权益运营",
    url: env.CENTER_URL,
    application: "zhenyi-admin",
    clientId: env.CASDOOR_ADMIN_CLIENT_ID,
    secret: env.CASDOOR_ADMIN_CLIENT_SECRET,
    serviceKey: "",
    enabled: true,
    port: port.parse(process.env.CENTER_PORT || 5310),
  },
};
for (const p of productRegistrations) {
  appConfigs[p.id] = {
    ...p,
    url: url.parse((p.urlEnv && process.env[p.urlEnv]) || p.url),
    clientId: process.env[p.clientIdEnv] || "",
    secret: process.env[p.clientSecretEnv] || "",
    serviceKey: process.env[p.serviceKeyEnv] || "",
    port: port.parse(p.port || 5313),
  };
}
export const productApps = Object.values(appConfigs).filter(
  (a) => !["center", "admin"].includes(a.id),
);
for (const a of runtimeApp === "center"
  ? Object.values(appConfigs)
  : [appConfigs[runtimeApp]]) {
  if (!a) throw Error("APP_ID 未登记");
  if (!a.enabled) continue;
  z.string().min(8).parse(a.clientId);
  z.string().min(32).parse(a.secret);
  if (!["center", "admin"].includes(a.id))
    z.string().min(32).parse(a.serviceKey);
}
if (runtimeApp === "center") {
  z.string().min(32).parse(env.REDEMPTION_PEPPER);
  z.string().min(1).parse(env.ADMIN_SUB);
  const keys = productApps.filter((a) => a.enabled).map((a) => a.serviceKey);
  if (new Set(keys).size !== keys.length)
    throw Error("产品调用凭据必须彼此独立");
  const clients = Object.values(appConfigs)
    .filter((a) => a.enabled)
    .map((a) => a.clientId);
  if (new Set(clients).size !== clients.length)
    throw Error("OIDC client ID 必须彼此独立");
}
export const config = {
  ...env,
  BEADGRID_URL: appConfigs.beadgrid?.url || "",
  FOCUSTAKE_URL: appConfigs.focustake?.url || "",
  host: process.env.HOST || "127.0.0.1",
  port: port.parse(process.env.PORT || appConfigs[runtimeApp]?.port || 5310),
  production: process.env.NODE_ENV === "production",
};
