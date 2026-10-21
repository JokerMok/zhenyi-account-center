// Only prepares a NEW empty deployment. It never writes existing accounts or credentials.
import { readFile, writeFile, mkdir, access, chmod } from "node:fs/promises";
import { randomBytes, randomUUID } from "node:crypto";
import { join } from "node:path";
import { run } from "./ops-runtime.mjs";
const secret = () => randomBytes(32).toString("hex");
export async function initializeProduction(root, release) {
  const shared = join(root, "shared"),
    envFile = join(shared, "config/app.env"),
    state = join(shared, "state");
  if (
    await access(envFile).then(
      () => true,
      () => false,
    )
  )
    return { fresh: false };
  await mkdir(join(state, "casdoor"), { recursive: true, mode: 0o750 });
  const env = {
    NODE_ENV: "production",
    APP_ID: "center",
    HOST: "127.0.0.1",
    PORT: "5310",
    CENTER_PORT: "5310",
    CASDOOR_PORT: "5300",
    CASDOOR_BACKEND_PORT: "5305",
    CENTER_URL: "https://accounts.shizibandu.icu",
    CASDOOR_URL: "https://identity.accounts.shizibandu.icu",
    PRODUCTS_CONFIG: join(shared, "config/products.json"),
    POSTGRES_PASSWORD: secret(),
    CASDOOR_DB_PASSWORD: secret(),
    ENTITLEMENTS_DB_PASSWORD: secret(),
    ADMIN_SUB: randomUUID(),
    REDEMPTION_PEPPER: secret(),
  };
  for (const id of ["CENTER", "ADMIN"]) {
    env["CASDOOR_" + id + "_CLIENT_ID"] = randomBytes(12).toString("hex");
    env["CASDOOR_" + id + "_CLIENT_SECRET"] = secret();
  }
  env.DATABASE_URL =
    "postgresql://entitlements:" +
    env.ENTITLEMENTS_DB_PASSWORD +
    "@127.0.0.1:5342/entitlements";
  await writeFile(
    envFile,
    Object.entries(env)
      .map(([k, v]) => k + "=" + v)
      .join("\n") + "\n",
    { mode: 0o640, flag: "wx" },
  );
  await writeFile(env.PRODUCTS_CONFIG, "[]\n", { mode: 0o640, flag: "wx" });
  const cert = join(shared, "config/cert.pem"),
    key = join(shared, "config/key.pem");
  await run("openssl", [
    "req",
    "-x509",
    "-newkey",
    "rsa:3072",
    "-keyout",
    key,
    "-out",
    cert,
    "-days",
    "3650",
    "-nodes",
    "-subj",
    "/CN=Zhenyi Accounts Production",
  ]);
  await chmod(key, 0o640);
  await chmod(cert, 0o640);
  const base = JSON.parse(
      await readFile(join(release, "infra/casdoor-init.template.json"), "utf8"),
    ),
    now = new Date().toISOString(),
    bootstrap = secret();
  const org = (name, title) => ({
    ...base.organizations[0],
    owner: "admin",
    name,
    displayName: title,
    createdTime: now,
    passwordOptions: name === "built-in" ? ["AtLeast8"] : ["AtLeast8", "Aa123"],
    hasPrivilegeConsent: false,
    languages: ["zh", "en"],
    countryCodes: ["CN"],
    isProfilePublic: false,
    defaultApplication: name === "built-in" ? "app-built-in" : "zhenyi-center",
    defaultTokenFormat: "JWT-Standard",
    logo: env.CENTER_URL + "/brand.svg",
    logoDark: env.CENTER_URL + "/brand.svg",
    accountItems: base.organizations[0].accountItems.map((a) => ({
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
  const app = (id, organization, name) => ({
    ...base.applications[0],
    owner: "admin",
    name,
    displayName: id === "ADMIN" ? "臻一管理后台" : "臻一账号中心",
    createdTime: now,
    organization,
    cert: "cert-built-in",
    homepageUrl: env.CENTER_URL,
    logo: env.CENTER_URL + "/brand.svg",
    providers: [],
    enableSignUp: id !== "ADMIN",
    enableSigninSession: true,
    enableAutoSignin: true,
    clientId: env["CASDOOR_" + id + "_CLIENT_ID"],
    clientSecret: env["CASDOOR_" + id + "_CLIENT_SECRET"],
    grantTypes: ["authorization_code"],
    redirectUris: [env.CENTER_URL + "/auth/callback/" + id.toLowerCase()],
    tokenFormat: "JWT-Standard",
    tokenSigningMethod: "RS256",
    expireInHours: 8,
    refreshExpireInHours: 0,
    signinMethods: [{ name: "Password", displayName: "密码", rule: "All" }],
    signupItems: base.applications[0].signupItems.map((i) => ({
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
  const builtin = {
    ...app("ADMIN", "built-in", "app-built-in"),
    displayName: "臻一身份管理",
    clientId: randomBytes(12).toString("hex"),
    clientSecret: secret(),
    homepageUrl: env.CASDOOR_URL,
    redirectUris: [env.CASDOOR_URL + "/callback"],
  };
  const data = {
    organizations: [
      org("built-in", "臻一管理组织"),
      org("consumers", "臻一用户"),
    ],
    users: [
      {
        ...base.users[0],
        owner: "built-in",
        name: "admin",
        id: env.ADMIN_SUB,
        displayName: "臻一管理员",
        password: bootstrap,
        isAdmin: true,
        createdTime: now,
        signupApplication: "app-built-in",
      },
    ],
    applications: [
      app("CENTER", "consumers", "zhenyi-center"),
      app("ADMIN", "built-in", "zhenyi-admin"),
      builtin,
    ],
    certs: [
      {
        ...base.certs[0],
        owner: "admin",
        name: "cert-built-in",
        displayName: "臻一签名证书",
        createdTime: now,
        scope: "JWT",
        type: "x509",
        cryptoAlgorithm: "RS256",
        bitSize: 3072,
        expireInYears: 10,
        certificate: await readFile(cert, "utf8"),
        privateKey: await readFile(key, "utf8"),
      },
    ],
  };
  await writeFile(join(state, "casdoor/init_data.json"), JSON.stringify(data), {
    mode: 0o640,
    flag: "wx",
  });
  await writeFile(
    join(shared, "config/casdoor.conf"),
    `appname = casdoor\nhttpport = 5305\nhttpaddr = 127.0.0.1\nrunmode = prod\ncopyrequestbody = true\ndriverName = postgres\ndataSourceName = "user=casdoor password=${env.CASDOOR_DB_PASSWORD} host=127.0.0.1 port=5342 sslmode=disable dbname=casdoor"\ndbName = casdoor\ntableNamePrefix =\nshowSql = false\norigin = ${env.CASDOOR_URL}\noriginFrontend = ${env.CASDOOR_URL}\nisDemoMode = false\nradiusServerPort = -1\nradiusSecret = ${secret()}\nradiusDefaultOrganization = disabled\ninitAdminPassword = ${secret()}\ninitDataFile = ./init_data.json\ninitDataNewOnly = true\ndefaultApplication = app-built-in\ndefaultLanguage = zh\nforceLanguage = zh\nfrontendBaseDir = ./web/build\nstaticBaseUrl = /static\nshowGithubCorner = false\nenableGzip = true\nlogPostOnly = true\nlogConfig = {"adapter":"file","filename":"logs/casdoor.log","maxdays":7,"perm":"0640"}\n`,
    { mode: 0o640, flag: "wx" },
  );
  return { fresh: true };
}
