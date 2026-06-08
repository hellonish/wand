#!/usr/bin/env bash
# Regenerate favicons from public/logo.svg (knight-tour mark).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PUB="$ROOT/public"
SVG="$PUB/logo.svg"

if [[ ! -f "$SVG" ]]; then
  echo "Missing $SVG" >&2
  exit 1
fi

sharp() {
  npx --yes sharp-cli -i "$SVG" -o "$1" resize "$2" "$2" >/dev/null
}

sharp "$PUB/favicon-16x16.png" 16
sharp "$PUB/favicon-32x32.png" 32
sharp "$PUB/apple-touch-icon.png" 180
sharp "$PUB/android-chrome-192x192.png" 192
sharp "$PUB/android-chrome-512x512.png" 512

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
cd "$TMP"
npm init -y >/dev/null 2>&1
npm install png-to-ico --silent >/dev/null 2>&1
node --input-type=module -e "
import pngToIco from 'png-to-ico';
import { writeFileSync } from 'fs';
const buf = await pngToIco(['$PUB/favicon-16x16.png', '$PUB/favicon-32x32.png']);
writeFileSync('$PUB/favicon.ico', buf);
"
echo "Favicons written to $PUB"
