import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
export function nativeBuildKey() {
  return createHash("sha256")
    .update(
      [
        "scripts/native-inputs.mjs",
        "scripts/build-native.mjs",
        "scripts/sync-native-assets.mjs",
        "scripts/localize-native-images.mjs",
        "src/web/views.tsx",
        "src/web/management.tsx",
        "src/web/style.css",
        "upstream/console/BusinessPage.tsx",
        "upstream/assets/manifest.json",
        "public/brand.svg",
        "config/casdoor-modules.json",
        "package-lock.json",
      ]
        .map((p) => p + "\n" + readFileSync(p, "utf8"))
        .join("\n"),
    )
    .digest("hex");
}
