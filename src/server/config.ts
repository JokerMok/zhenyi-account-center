import dotenv from "dotenv";
import { z } from "zod";
export const runtimeApp = process.env.APP_ID || "center";
dotenv.config({
  path:
    process.env.DOTENV_CONFIG_PATH ||
    (runtimeApp === "center" ? ".env" : `.local/${runtimeApp}.env`),
  quiet: true,
});
const credential = z.string().min(16).default("");
const env = z
  .object({
    DATABASE_URL: z.string().min(10),
    CASDOOR_URL: z.url(),
    CENTER_URL: z.url(),
    BEADGRID_URL: z.url(),
    FOCUSTAKE_URL: z.url(),
    CASDOOR_CENTER_CLIENT_ID: z.string().default(""),
    CASDOOR_CENTER_CLIENT_SECRET: credential,
    CASDOOR_ADMIN_CLIENT_ID: z.string().default(""),
    CASDOOR_ADMIN_CLIENT_SECRET: credential,
    CASDOOR_BEADGRID_CLIENT_ID: z.string().default(""),
    CASDOOR_BEADGRID_CLIENT_SECRET: credential,
    CASDOOR_FOCUSTAKE_CLIENT_ID: z.string().default(""),
    CASDOOR_FOCUSTAKE_CLIENT_SECRET: credential,
    BEADGRID_SERVICE_KEY: z.string().default(""),
    FOCUSTAKE_SERVICE_KEY: z.string().default(""),
    ADMIN_SUB: z.string().default(""),
    REDEMPTION_PEPPER: z.string().default(""),
  })
  .parse(process.env);
for (const id of runtimeApp === "center"
  ? ["CENTER", "ADMIN", "BEADGRID", "FOCUSTAKE"]
  : [runtimeApp.toUpperCase()]) {
  z.string().min(8).parse(process.env[`CASDOOR_${id}_CLIENT_ID`]);
  z.string().min(32).parse(process.env[`CASDOOR_${id}_CLIENT_SECRET`]);
}
if (runtimeApp === "center") {
  z.string().min(32).parse(env.REDEMPTION_PEPPER);
  z.string().min(1).parse(env.ADMIN_SUB);
}
export const config = {
  ...env,
  host: process.env.HOST || "127.0.0.1",
  production: process.env.NODE_ENV === "production",
};
export const appConfigs = {
  center: {
    id: "center",
    name: "臻一账号中心",
    url: env.CENTER_URL,
    application: "zhenyi-center",
    clientId: env.CASDOOR_CENTER_CLIENT_ID,
    secret: env.CASDOOR_CENTER_CLIENT_SECRET,
  },
  admin: {
    id: "admin",
    name: "权益运营",
    url: env.CENTER_URL,
    application: "zhenyi-admin",
    clientId: env.CASDOOR_ADMIN_CLIENT_ID,
    secret: env.CASDOOR_ADMIN_CLIENT_SECRET,
  },
  beadgrid: {
    id: "beadgrid",
    name: "拼豆工坊",
    url: env.BEADGRID_URL,
    application: "zhenyi-beadgrid",
    clientId: env.CASDOOR_BEADGRID_CLIENT_ID,
    secret: env.CASDOOR_BEADGRID_CLIENT_SECRET,
    serviceKey: env.BEADGRID_SERVICE_KEY,
  },
  focustake: {
    id: "focustake",
    name: "专注录屏",
    url: env.FOCUSTAKE_URL,
    application: "zhenyi-focustake",
    clientId: env.CASDOOR_FOCUSTAKE_CLIENT_ID,
    secret: env.CASDOOR_FOCUSTAKE_CLIENT_SECRET,
    serviceKey: env.FOCUSTAKE_SERVICE_KEY,
  },
} as const;
export type AppId = keyof typeof appConfigs;
