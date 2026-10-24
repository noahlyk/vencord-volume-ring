#!/usr/bin/env bash
# Removes VolumeRing: deletes the Vencord build that install.sh put into Vesktop, so Vesktop
# downloads its own stock Vencord the next time it starts, and removes the plugin from the checkout.
#
#   ./uninstall.sh [path/to/Vencord]
#
# Defaults match install.sh. The Vencord checkout itself is kept; delete it yourself if you want it gone.
set -euo pipefail

vencord="${1:-$HOME/Vencord}"
vesktop="${VESKTOP_VENCORD_DIR:-$HOME/.config/vesktop/sessionData/vencordFiles}"

if [ -d "$vesktop" ]; then
    shopt -s nullglob
    removed=("$vesktop"/vencordDesktop*)
    rm -f "${removed[@]}"
    echo "Removed ${#removed[@]} Vencord file(s) from $vesktop"
else
    echo "No Vesktop folder at $vesktop, nothing to remove there"
fi

if [ -d "$vencord/src/userplugins/volumeRing" ]; then
    rm -rf "$vencord/src/userplugins/volumeRing"
    echo "Removed the plugin from $vencord"
else
    echo "No plugin copy in $vencord"
fi

cat <<MSG

Done. Fully quit Vesktop from the tray and start it again. It will download stock Vencord
on launch, so it needs an internet connection that one time.
MSG
