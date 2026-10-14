#!/usr/bin/env bash
# Linux Cloud Agent bootstrap for the Grok Bot 0.18 reconstruction.
# macOS hdiutil/ditto/plutil are not available here. The pinned renderer is
# hydrated from the Git LFS DMG with 7-Zip, then checked by the repo's own
# app.asar SHA-256 gate (scripts/lib/runtime.mjs).
set -euo pipefail

NODE_VERSION=26.5.0
PREFIX="${HOME}/.local/node-v${NODE_VERSION}"
if [[ ! -x "${PREFIX}/bin/node" ]] || [[ "$("${PREFIX}/bin/node" -v 2>/dev/null || true)" != "v${NODE_VERSION}" ]]; then
  tmp="$(mktemp -d)"
  curl -fsSL "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-x64.tar.xz" -o "${tmp}/node.tar.xz"
  mkdir -p "${PREFIX}"
  tar -xJf "${tmp}/node.tar.xz" -C "${PREFIX}" --strip-components=1
  rm -rf "${tmp}"
fi

mkdir -p /usr/local/cargo/bin
for bin in node npm npx corepack; do
  ln -sfn "${PREFIX}/bin/${bin}" "/usr/local/cargo/bin/${bin}"
done
export PATH="/usr/local/cargo/bin:${PATH}"
hash -r

if ! command -v 7z >/dev/null 2>&1; then
  sudo DEBIAN_FRONTEND=noninteractive apt-get update -qq
  sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq p7zip-full
fi

ROOT="$(git rev-parse --show-toplevel)"
cd "${ROOT}"

# Cursor already owns the git hooks. --skip-repo installs the LFS filters
# without rewriting those hooks (plain `git lfs install` exits 2 here).
git lfs install --skip-repo
git lfs pull

npm ci --no-audit --no-fund

DMG="${ROOT}/research-archives/original/0.18.0/macos-arm64/Grok_Bot_0.18.0.dmg"
extract="$(mktemp -d)"
trap 'rm -rf "${extract}"' EXIT
7z x -y -o"${extract}" "${DMG}" \
  "Grok Bot.app/Contents/Resources/app.asar" \
  "Grok Bot.app/Contents/Resources/app.asar.unpacked" >/dev/null
ASAR_PATH="${extract}/Grok Bot.app/Contents/Resources/app.asar" \
  node --input-type=module -e '
    import { hydrateSourcePayloadFromAsar } from "./scripts/lib/runtime.mjs";
    const asar = process.env.ASAR_PATH;
    if (!asar) throw new Error("ASAR_PATH is required");
    const result = await hydrateSourcePayloadFromAsar(asar);
    console.log(`Hydrated ${result.destination} sha256=${result.sha256}`);
  '

test -f "${ROOT}/src/app/dist/renderer/index.html"
echo "Cloud agent install complete: node $(node -v)"
