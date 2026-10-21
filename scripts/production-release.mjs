import {
  readFile,
  writeFile,
  mkdir,
  symlink,
  cp,
  access,
  readdir,
} from "node:fs/promises";
import { resolve, join } from "node:path";
import { execFileSync } from "node:child_process";
import { run } from "./ops-runtime.mjs";
import { sha, files } from "./backup-core.mjs";
const root = resolve(import.meta.dirname, "..");
process.chdir(root);
// macOS metadata must never become files in the Linux release.
process.env.COPYFILE_DISABLE = "1";
const shaCommit = (
  process.argv[2] ||
  execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" })
).trim();
if (!/^[a-f0-9]{40}$/.test(shaCommit)) throw Error("需要完整已提交Git SHA");
const target = resolve(".local/production-release", shaCommit);
await mkdir(target, { recursive: true });
const archive = target + ".source.tar";
execFileSync("git", [
  "archive",
  "--format=tar",
  "--output",
  archive,
  shaCommit,
]);
await run("tar", ["-xf", archive, "-C", target]);
await writeFile(
  join(target, ".env"),
  "NODE_ENV=production\nCENTER_URL=https://accounts.shizibandu.icu\nCASDOOR_URL=https://identity.accounts.shizibandu.icu\n",
  { mode: 0o600 },
);
await run("npm", ["ci", "--ignore-scripts"], { cwd: target });
await run("npm", ["run", "build"], { cwd: target });
const source = join(target, ".upstream/source-v4.22.0");
await mkdir(source, { recursive: true });
await cp(
  ".upstream/source-v4.22.0.tar.gz",
  join(target, ".upstream/source-v4.22.0.tar.gz"),
);
await run("tar", [
  "-xzf",
  join(target, ".upstream/source-v4.22.0.tar.gz"),
  "-C",
  source,
  "--strip-components=1",
]);
// Reuse the locked dependency cache only; source and all patches come from the selected Git archive.
await symlink(
  resolve(".upstream/source-v4.22.0/web/node_modules"),
  join(source, "web/node_modules"),
);
await run(process.execPath, ["scripts/build-native.mjs"], { cwd: target });
await cp(join(target, ".local/casdoor/web/build"), join(target, "native-web"), {
  recursive: true,
});
await cp(join(target, ".local/native-static"), join(target, "native-static"), {
  recursive: true,
});
await cp(join(target, ".local/casdoor/swagger"), join(target, "swagger"), {
  recursive: true,
});
await cp(
  join(target, ".local/native-build.json"),
  join(target, "NATIVE_BUILD.json"),
);
const lock = JSON.parse(
  await readFile(join(target, "deploy/production-lock.json"), "utf8"),
);
const binaryArchive = resolve(".upstream/casdoor_Linux_x86_64.verified.tar.gz");
if ((await sha(binaryArchive)) !== lock.casdoor.sha256)
  throw Error("Linux Casdoor官方归档校验失败");
await mkdir(join(target, "bin"), { recursive: true });
await run("tar", ["-xOf", binaryArchive, "casdoor"], {
  output: join(target, "bin/casdoor"),
});
await (
  await import("node:fs/promises")
).chmod(join(target, "bin/casdoor"), 0o755);
const tracked = execFileSync(
  "git",
  ["ls-tree", "-r", "--name-only", shaCommit],
  { encoding: "utf8" },
)
  .trim()
  .split("\n");
const entries = [
  ...tracked,
  "dist",
  "native-web",
  "native-static",
  "swagger",
  "NATIVE_BUILD.json",
  "bin",
];
const digests = {};
for (const path of entries) {
  const full = join(target, path),
    info = await (await import("node:fs/promises")).stat(full);
  if (info.isDirectory()) {
    for (const p of await files(full))
      digests[path + "/" + p] = await sha(join(full, p));
  } else digests[path] = await sha(full);
}
const manifest = {
  commit: shaCommit,
  built_at: new Date().toISOString(),
  casdoor: "v4.22.0",
  node: "v22.23.3",
  center: "https://accounts.shizibandu.icu",
  issuer: "https://identity.accounts.shizibandu.icu",
  compatibleMigrations: (await readdir(join(target, "migrations")))
    .filter((x) => /^\d{3,}_[a-zA-Z0-9_-]+\.sql$/.test(x))
    .sort(),
  sha256: digests,
};
await writeFile(
  join(target, "RELEASE.json"),
  JSON.stringify(manifest, null, 2) + "\n",
);
const list = target + ".list";
await writeFile(list, [...entries, "RELEASE.json"].join("\n") + "\n");
const bundle = target + ".tar.gz";
await run("tar", ["-czf", bundle, "-C", target, "-T", list]);
await writeFile(
  bundle + ".sha256",
  (await sha(bundle)) + "  " + bundle.split("/").at(-1) + "\n",
  { mode: 0o600 },
);
console.log("正式地址隔离构建完成：" + bundle);
