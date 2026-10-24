#!/usr/bin/env bash
# Runs the pure-logic tests (auto-mute timing, level encoding) without Discord.
# Needs a Vencord checkout for esbuild: ./tests/run.sh [path/to/Vencord]
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
vencord="${1:-$HOME/Vencord}"
esb="$vencord/node_modules/.bin/esbuild"
[ -x "$esb" ] || { echo "esbuild not found at $esb. Run 'pnpm install' in your Vencord checkout first." >&2; exit 1; }

build="$here/.build"
rm -rf "$build" && mkdir -p "$build"
opts=(--bundle --format=esm --log-level=error
  --alias:@webpack=./stubs.js --alias:@webpack/common=./stubs.js
  --alias:@api/Settings=./stubs.js --alias:@utils/types=./stubs.js)
(cd "$here" && "$esb" ../volumeRing/autoMute.ts --outfile=.build/autoMute.mjs "${opts[@]}" && "$esb" ../volumeRing/levels.ts --outfile=.build/levels.mjs "${opts[@]}")
node "$here/logic.test.mjs"
rm -rf "$build"
