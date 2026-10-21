// Dependency-free staging entry point. Keeps backups/restores/deployments mutually exclusive.
import { readFile, mkdir, access, rename } from "node:fs/promises";
import { join, resolve } from "node:path";
import { run, withOperationLock } from "./ops-runtime.mjs";
import { sha } from "./backup-core.mjs";
const root = "/srv/apps/zhenyi-accounts",
  commit = process.argv[2],
  bundle = resolve(process.argv[3] || "");
if (process.getuid?.() !== 0 || !/^[a-f0-9]{40}$/.test(commit || ""))
  throw Error("Need sudo and a full committed SHA");
if (
  (await readFile(bundle + ".sha256", "utf8")).split(/\s+/)[0] !==
  (await sha(bundle))
)
  throw Error("发布归档校验失败");
await withOperationLock(join(root, "shared/operation.lock"), async () => {
  const release = join(root, "releases", commit),
    node = join(root, "shared/runtime/node-v22.23.3-linux-x64/bin/node");
  if (
    !(await access(join(release, "RELEASE.json")).then(
      () => true,
      () => false,
    ))
  ) {
    const staging = release + ".staging-" + process.pid;
    await mkdir(staging, { recursive: true, mode: 0o755 });
    await run("tar", ["-xzf", bundle, "-C", staging]);
    await run(
      node,
      [
        join(
          root,
          "shared/runtime/node-v22.23.3-linux-x64/lib/node_modules/npm/bin/npm-cli.js",
        ),
        "ci",
        "--omit=dev",
        "--no-audit",
        "--no-fund",
      ],
      {
        cwd: staging,
        env: {
          ...process.env,
          PATH:
            join(root, "shared/runtime/node-v22.23.3-linux-x64/bin") +
            ":/usr/bin:/bin",
        },
      },
    );
    await rename(staging, release);
  }
  console.log(
    await run(node, [
      join(release, "scripts/production.mjs"),
      "install",
      release,
    ]),
  );
});
