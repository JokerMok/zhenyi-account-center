#!/bin/bash
# Run on the Mac with a Git-archived, checksum-verified release. Never copies .env or local data.
set -euo pipefail
cd "$(dirname "$0")/../.."
sha=${1:-$(git rev-parse HEAD)}
[[ "$sha" =~ ^[0-9a-f]{40}$ ]] || { echo 'Need a full committed SHA'; exit 2; }
base=.local/production-release/$sha
[[ -f "$base.tar.gz" && -f "$base.tar.gz.sha256" ]] || { echo 'Run npm run production:build first'; exit 2; }
node_archive=.upstream/node-v22.23.3-linux-x64.tar.xz
expected=df450af89261115ef9f9e3830c3eeb2cc9213b63c720b1af623cb5dcbe2e02de
actual=$(shasum -a 256 "$node_archive" | cut -d' ' -f1)
[[ "$actual" == "$expected" ]] || { echo 'Node official checksum mismatch'; exit 1; }
remote=/tmp/zhenyi-accounts-$sha
ssh tencent-main "mkdir -p '$remote'"
scp "$base.tar.gz" "$base.tar.gz.sha256" "$node_archive" "tencent-main:$remote/"
ssh tencent-main bash -s -- "$sha" "$remote" <<'REMOTE'
set -euo pipefail
sha=$1
stage=$2
cd "$stage"
sha256sum -c "$sha.tar.gz.sha256"
printf '%s  %s\n' df450af89261115ef9f9e3830c3eeb2cc9213b63c720b1af623cb5dcbe2e02de node-v22.23.3-linux-x64.tar.xz | sha256sum -c -
root=/srv/apps/zhenyi-accounts
sudo install -d -m 0755 "$root" "$root/releases"
sudo install -d -m 0750 "$root/shared"
sudo install -d -m 0755 "$root/shared/runtime"
# No project exists before the first extraction; subsequent updates use the installed immutable runtime.
if ! sudo test -x "$root/shared/runtime/node-v22.23.3-linux-x64/bin/node"; then
 sudo tar -xJf node-v22.23.3-linux-x64.tar.xz -C "$root/shared/runtime"
fi
# Stage through the same operation lock as backup and restore. Existing releases remain immutable.
tar -xzf "$sha.tar.gz" -C "$stage" ./scripts/production-stage.mjs ./scripts/ops-runtime.mjs ./scripts/backup-core.mjs 2>/dev/null || tar -xzf "$sha.tar.gz" -C "$stage" scripts/production-stage.mjs scripts/ops-runtime.mjs scripts/backup-core.mjs
sudo "$root/shared/runtime/node-v22.23.3-linux-x64/bin/node" "$stage/scripts/production-stage.mjs" "$sha" "$stage/$sha.tar.gz"
REMOTE
