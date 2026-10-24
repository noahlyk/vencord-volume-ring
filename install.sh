#!/usr/bin/env bash
# Installs VolumeRing into Vesktop: copies the plugin into a Vencord checkout, builds it,
# and puts the build where Vesktop loads Vencord from.
#
#   ./install.sh [path/to/Vencord]
#
# Defaults: the checkout is ~/Vencord (cloned if missing), Vesktop's folder is
# ~/.config/vesktop/sessionData/vencordFiles (override with VESKTOP_VENCORD_DIR).
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
vencord="${1:-$HOME/Vencord}"
vesktop="${VESKTOP_VENCORD_DIR:-$HOME/.config/vesktop/sessionData/vencordFiles}"

need() { command -v "$1" >/dev/null 2>&1 || { echo "Missing '$1'. $2" >&2; exit 1; }; }
need git "Install git first."
need pnpm "Install pnpm first (npm i -g pnpm, or corepack enable)."
need node "Install Node.js first."

# Version stamp from git: v1.2.0 -> 1.2.0, 3 commits past it -> 1.2.0+3.g<hash>,
# uncommitted changes -> ...+dirty. With no tags yet it is 0.0.0+g<hash>.
version() {
    git -C "$here" rev-parse --git-dir >/dev/null 2>&1 || { echo "unknown"; return; }
    local hash dirty="" desc ver
    hash="$(git -C "$here" rev-parse --short HEAD)"
    [ -n "$(git -C "$here" status --porcelain --untracked-files=no)" ] && dirty=".dirty"
    if desc="$(git -C "$here" describe --tags --long --match 'v[0-9]*' 2>/dev/null)"; then
        ver="${desc%-*-*}"; ver="${ver#v}"
        local n="${desc%-g*}"; n="${n##*-}"
        [ "$n" = 0 ] || ver="$ver+$n.g$hash"
    else
        ver="0.0.0+g$hash"
    fi
    echo "$ver$dirty"
}
VERSION="$(version)"

if [ ! -d "$vencord/.git" ]; then
    echo "Cloning Vencord into $vencord"
    git clone --depth 1 https://github.com/Vendicated/Vencord.git "$vencord"
fi

echo "Copying VolumeRing into $vencord/src/userplugins/volumeRing"
mkdir -p "$vencord/src/userplugins"
rm -rf "$vencord/src/userplugins/volumeRing"
cp -r "$here/volumeRing" "$vencord/src/userplugins/volumeRing"

cd "$vencord"
echo "Installing dependencies and building (this takes a minute)"
pnpm install --frozen-lockfile >/dev/null 2>&1 || pnpm install
pnpm build

if [ ! -d "$vesktop" ]; then
    echo "Vesktop folder not found at $vesktop. Start Vesktop once, or set VESKTOP_VENCORD_DIR." >&2
    exit 1
fi
cp -f dist/vencordDesktop* "$vesktop/"
echo "Installed VolumeRing $VERSION into Vesktop: $vesktop"

cat <<MSG

Done. Next:
  1. Fully quit Vesktop (right-click the tray icon, Quit), then start it again.
  2. In Vesktop settings, open Vencord > Plugins and turn on VolumeRing.
  3. Open DevTools (Ctrl+Shift+I) and look for [VolumeRing] in the console if something looks off.

Run ./install.sh again after changing the plugin, and restart Vesktop.
MSG
