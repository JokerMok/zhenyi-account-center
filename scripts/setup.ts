import { mkdir, readFile, writeFile, access, chmod } from "node:fs/promises";
import { randomBytes, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import dotenv from "dotenv";
const exists = async (p: string) =>
  access(p).then(
    () => true,
    () => false,
  );
const secret = () => randomBytes(32).toString("hex");
await mkdir(".local", { recursive: true, mode: 0o700 });
await chmod(".local", 0o700);
let env: Record<string, string>;
if (await exists(".env")) {
  env = dotenv.parse(await readFile(".env"));
  console.log("保留已有 .env 与凭据");
} else {
  env = {
    NODE_ENV: "development",
    HOST: "127.0.0.1",
    CASDOOR_URL: "http://localhost:5300",
    CENTER_URL: "http://localhost:5310",
    BEADGRID_URL: "http://localhost:5311",
    FOCUSTAKE_URL: "http://localhost:5312",
    POSTGRES_PASSWORD: secret(),
    CASDOOR_DB_PASSWORD: secret(),
    ENTITLEMENTS_DB_PASSWORD: secret(),
    ADMIN_SUB: randomUUID(),
    REDEMPTION_PEPPER: secret(),
  };
  for (const id of ["CENTER", "ADMIN", "BEADGRID", "FOCUSTAKE"]) {
    env[`CASDOOR_${id}_CLIENT_ID`] = randomBytes(12).toString("hex");
    env[`CASDOOR_${id}_CLIENT_SECRET`] = secret();
  }
  env.BEADGRID_SERVICE_KEY = secret();
  env.FOCUSTAKE_SERVICE_KEY = secret();
  env.DATABASE_URL = `postgresql://entitlements:${env.ENTITLEMENTS_DB_PASSWORD}@127.0.0.1:5342/entitlements`;
  await writeFile(
    ".env",
    Object.entries(env)
      .map(([k, v]) => `${k}=${v}`)
      .join("\n") + "\n",
    { mode: 0o600, flag: "wx" },
  );
  const credentials = {
    administrator: {
      organization: "built-in",
      username: "admin",
      password: "Aa7!" + secret().slice(0, 24),
    },
    created_at: new Date().toISOString(),
  };
  await writeFile(
    ".local/credentials.json",
    JSON.stringify(credentials, null, 2),
    { mode: 0o600, flag: "wx" },
  );
  console.log("已随机生成私密凭据：.local/credentials.json（不纳入 Git）");
}
await mkdir(".local/casdoor/conf", { recursive: true });
await mkdir(".local/casdoor/logs", { recursive: true });
if (!(await exists(".local/casdoor/cert.pem"))) {
  execFileSync(
    "openssl",
    [
      "req",
      "-x509",
      "-newkey",
      "rsa:3072",
      "-keyout",
      ".local/casdoor/key.pem",
      "-out",
      ".local/casdoor/cert.pem",
      "-days",
      "3650",
      "-nodes",
      "-subj",
      "/CN=Zhenyi Accounts Local",
    ],
    { stdio: "ignore" },
  );
  await chmod(".local/casdoor/key.pem", 0o600);
}
const credentials = JSON.parse(
  await readFile(".local/credentials.json", "utf8"),
);
const baseConf = `appname = casdoor
httpport = 5300
httpaddr = 127.0.0.1
runmode = prod
copyrequestbody = true
driverName = postgres
dataSourceName = "user=casdoor password=${env.CASDOOR_DB_PASSWORD} host=127.0.0.1 port=5342 sslmode=disable dbname=casdoor"
dbName = casdoor
tableNamePrefix =
showSql = false
origin = ${env.CASDOOR_URL}
originFrontend = ${env.CASDOOR_URL}
isDemoMode = false
radiusServerPort = -1
radiusSecret = ${secret()}
radiusDefaultOrganization = disabled
initAdminPassword = ${credentials.administrator.password}
initDataFile = ./init_data.json
initDataNewOnly = false
defaultApplication = app-built-in
defaultLanguage = zh
forceLanguage = zh
frontendBaseDir = ./web/build
staticBaseUrl = ${env.CASDOOR_URL}
showGithubCorner = false
enableGzip = true
logPostOnly = true
logConfig = {"adapter":"file","filename":"logs/casdoor.log","maxdays":7,"perm":"0600"}
`;
if (!(await exists(".local/casdoor/conf/app.conf")))
  await writeFile(".local/casdoor/conf/app.conf", baseConf, { mode: 0o600 });
if (!(await exists(".local/casdoor/initialized"))) {
  const template = JSON.parse(
    await readFile("infra/casdoor-init.template.json", "utf8"),
  );
  const now = new Date().toISOString();
  const org = (name: string, displayName: string) => ({
    ...template.organizations[0],
    owner: "admin",
    name,
    displayName,
    createdTime: now,
    passwordOptions: ["AtLeast8", "Aa123"],
    languages: ["zh", "en"],
    countryCodes: ["CN"],
    isProfilePublic: false,
    defaultApplication: name === "built-in" ? "app-built-in" : "zhenyi-center",
    defaultTokenFormat: "JWT-Standard",
    accountItems: template.organizations[0].accountItems.map((a: any) => ({
      ...a,
      viewRule: a.viewRule === "Public" ? "Self" : a.viewRule,
      visible: [
        "ID",
        "Name",
        "Display name",
        "Password",
        "Email",
        "Language",
        "Is admin",
        "Is forbidden",
        "Multi-factor authentication",
      ].includes(a.name),
      modifyRule: [
        "Is admin",
        "Is forbidden",
        "Name",
        "User type",
        "Organization",
        "Balance",
        "Balance credit",
        "Balance currency",
        "Score",
        "Karma",
        "Ranking",
      ].includes(a.name)
        ? "Admin"
        : a.modifyRule,
    })),
  });
  const apps: any[] = [];
  for (const [id, url, name, organization] of [
    ["CENTER", env.CENTER_URL, "zhenyi-center", "consumers"],
    ["ADMIN", env.CENTER_URL, "zhenyi-admin", "built-in"],
    ["BEADGRID", env.BEADGRID_URL, "zhenyi-beadgrid", "consumers"],
    ["FOCUSTAKE", env.FOCUSTAKE_URL, "zhenyi-focustake", "consumers"],
  ]) {
    const appId = id.toLowerCase();
    apps.push({
      ...template.applications[0],
      owner: "admin",
      name,
      displayName: {
        CENTER: "臻一账号中心",
        ADMIN: "臻一权益运营",
        BEADGRID: "拼豆工坊",
        FOCUSTAKE: "专注录屏",
      }[id],
      createdTime: now,
      organization,
      cert: "cert-built-in",
      homepageUrl: url,
      logo: "",
      providers: [],
      enableSignUp: id !== "ADMIN",
      enableSigninSession: true,
      enableAutoSignin: true,
      clientId: env[`CASDOOR_${id}_CLIENT_ID`],
      clientSecret: env[`CASDOOR_${id}_CLIENT_SECRET`],
      grantTypes: ["authorization_code"],
      redirectUris: [`${url}/auth/callback/${appId}`],
      tokenFormat: "JWT-Standard",
      tokenSigningMethod: "RS256",
      expireInHours: 8,
      refreshExpireInHours: 0,
      signinMethods: [{ name: "Password", displayName: "密码", rule: "All" }],
      signupItems: template.applications[0].signupItems.map((i: any) => ({
        ...i,
        visible: [
          "Username",
          "Display name",
          "Password",
          "Confirm password",
        ].includes(i.name),
        required: [
          "ID",
          "Username",
          "Display name",
          "Password",
          "Confirm password",
        ].includes(i.name),
      })),
    });
  }
  apps.push({
    ...apps[1],
    name: "app-built-in",
    displayName: "臻一身份管理",
    clientId: randomBytes(12).toString("hex"),
    clientSecret: secret(),
    homepageUrl: env.CASDOOR_URL,
    redirectUris: [env.CASDOOR_URL + "/callback"],
    grantTypes: ["authorization_code"],
  });
  const admin = {
    ...template.users[0],
    owner: "built-in",
    name: "admin",
    id: env.ADMIN_SUB,
    displayName: "臻一管理员",
    password: credentials.administrator.password,
    isAdmin: true,
    createdTime: now,
    signupApplication: "app-built-in",
  };
  const cert = {
    ...template.certs[0],
    owner: "admin",
    name: "cert-built-in",
    displayName: "臻一本地签名证书",
    createdTime: now,
    scope: "JWT",
    type: "x509",
    cryptoAlgorithm: "RS256",
    bitSize: 3072,
    expireInYears: 10,
    certificate: await readFile(".local/casdoor/cert.pem", "utf8"),
    privateKey: await readFile(".local/casdoor/key.pem", "utf8"),
  };
  await writeFile(
    ".local/casdoor/init_data.json",
    JSON.stringify(
      {
        organizations: [
          org("built-in", "臻一管理组织"),
          org("consumers", "臻一用户"),
        ],
        users: [admin],
        applications: apps,
        certs: [cert],
      },
      null,
      2,
    ),
    { mode: 0o600 },
  );
}
await chmod("infra/init-databases.sh", 0o755);
console.log("初始化准备完成。运行 npm start。");
