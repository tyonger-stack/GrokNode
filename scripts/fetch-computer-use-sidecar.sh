#!/bin/zsh
# 下载官方 Computer Use sidecar（干净签名字节），供 stageComputerUseSidecar0721 使用。
# 本机 /Applications/Grok Bot.app 签名已损坏（codesign internal error），不能作为提取源。
# 输出目录：/tmp/grok-cua-sidecar/Grok Bot Computer Use.app
set -euo pipefail
OUT=/tmp/grok-cua-sidecar
MANIFEST_URL="${1:-https://downloads.cursor.com/computer-use-sidecar/releases/explicit/3.24.0-pre.14/56911b9a22ab4f4ea4d93df109f8d6580a948d15.json}"
rm -rf "$OUT" && mkdir -p "$OUT"
echo "== manifest =="
curl -sS "$MANIFEST_URL" -o "$OUT/manifest.json"
cat "$OUT/manifest.json"
echo
URL=$(python3 -c 'import json,sys;m=json.load(open(sys.argv[1]));print(m.get("url") or m.get("downloadUrl") or m.get("artifact",{}).get("url") or "")' "$OUT/manifest.json" 2>/dev/null || true)
SHA=$(python3 -c 'import json,sys;m=json.load(open(sys.argv[1]));print(m.get("sha256") or m.get("checksum") or m.get("artifact",{}).get("sha256") or "")' "$OUT/manifest.json" 2>/dev/null || true)
if [[ -n "$URL" ]]; then
  echo "== downloading $URL =="
  curl -sSL "$URL" -o "$OUT/sidecar.bin"
  if [[ -n "$SHA" ]]; then
    ACTUAL=$(shasum -a 256 "$OUT/sidecar.bin" | cut -d' ' -f1)
    [[ "$ACTUAL" == "$SHA" ]] || { echo "sha256 mismatch: $ACTUAL != $SHA" >&2; exit 1; }
    echo "sha256 verified: $SHA"
  fi
  file "$OUT/sidecar.bin"
  case "$(file -b "$OUT/sidecar.bin")" in
    *Zip*) unzip -q "$OUT/sidecar.bin" -d "$OUT/unzipped" ;;
    *gzip*|*tar*) mkdir -p "$OUT/unzipped" && tar -xf "$OUT/sidecar.bin" -C "$OUT/unzipped" ;;
    *Disk*|*zlib*) hdiutil attach "$OUT/sidecar.bin" -nobrowse -mountpoint "$OUT/mnt" && /usr/bin/ditto "$OUT/mnt/Grok Bot.app/Contents/Helpers/Grok Bot Computer Use.app" "$OUT/Grok Bot Computer Use.app" && hdiutil detach "$OUT/mnt" ;;
    *) echo "unknown artifact format; send /tmp/grok-cua-sidecar/manifest.json back" >&2; exit 2 ;;
  esac
  FOUND=$(find "$OUT/unzipped" -maxdepth 3 -name 'Grok Bot Computer Use.app' 2>/dev/null | head -n 1)
  [[ -n "$FOUND" ]] && /usr/bin/ditto "$FOUND" "$OUT/Grok Bot Computer Use.app"
else
  echo "manifest url field not recognized; trying official DMG fallback"
  curl -sSL "https://downloads.cursor.com/grokbot/stable/darwin-arm64/0.72.1/Grok_Bot_0.72.1.dmg" -o "$OUT/grokbot.dmg"
  file "$OUT/grokbot.dmg"
  hdiutil attach "$OUT/grokbot.dmg" -nobrowse -mountpoint "$OUT/mnt"
  /usr/bin/ditto "$OUT/mnt/Grok Bot.app/Contents/Helpers/Grok Bot Computer Use.app" "$OUT/Grok Bot Computer Use.app"
  hdiutil detach "$OUT/mnt"
fi
if [[ -d "$OUT/Grok Bot Computer Use.app" ]]; then
  codesign --verify --strict "$OUT/Grok Bot Computer Use.app" && echo "SIDECAR READY: $OUT/Grok Bot Computer Use.app"
  codesign -dv "$OUT/Grok Bot Computer Use.app" 2>&1 | grep -E 'Identifier|TeamIdentifier'
else
  echo "helper app not found in artifact; send manifest.json and the file output back" >&2
  exit 3
fi
