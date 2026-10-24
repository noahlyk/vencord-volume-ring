# VolumeRing

A Vencord userplugin for **Vesktop on Linux** that makes voice chat easier to read.

- **Speaking rings** change colour with loudness: faint green (quiet), green (normal speech), yellow (loud), orange (very loud), and red only for earrape or clipping.
- **Auto-calibrated**: it learns what normal speech sounds like in the call, so the colours fit your friends' mics without hand-tuning.
- **Split rings**: for other people, the left half of the ring is their level at 100% volume and the right half is how loud they are at your volume setting.
- **Solo**: in a call's user menu, tick *Solo* to hear only the people you solo. Everyone else is silenced locally. Their names grey out.
- **Attenuate**: tick *Attenuate* on people you want to keep at full volume. Everyone else drops to a set percentage (50% by default).
- **Level meter**: the user menu shows a live meter with their current level in dB.
- **Volume reset**: right-click or double-click the user volume slider to set it back to 100%.
- **Auto-mute**: if someone stays at full earrape for a few seconds, they are muted locally and their video is turned off. Once per hour. Unmuting them yourself stops it from happening again for an hour.
- **Ctrl+A** clears Solo and Attenuate.

Solo and Attenuate reset when you join or leave a call.

## Requirements

- Vesktop on Linux (the Vesktop build of Vencord; regular Discord is not supported)
- git, Node.js, and pnpm

## Install

```sh
git clone https://github.com/noahlyk/vencord-volume-ring.git
cd vencord-volume-ring
./install.sh
```

The script:

1. Clones Vencord into `~/Vencord` if you don't already have a checkout. Pass a path to use an existing one: `./install.sh ~/code/Vencord`.
2. Copies the plugin into `src/userplugins/volumeRing`.
3. Builds Vencord.
4. Copies the build into Vesktop's Vencord folder, `~/.config/vesktop/sessionData/vencordFiles`. Set `VESKTOP_VENCORD_DIR` if yours is elsewhere.

Then fully quit Vesktop from the tray (closing the window only hides it), start it again, and turn on **VolumeRing** under Vencord > Plugins.

To update, pull the repo and run `./install.sh` again, then restart Vesktop.

## Uninstall

```sh
./uninstall.sh
```

This deletes the VolumeRing build from Vesktop's folder and removes the plugin from your Vencord checkout. Vesktop then downloads stock Vencord the next time it starts. The Vencord checkout itself is kept.

## Settings

Under Vencord > Plugins > VolumeRing:

| Setting | Default | What it does |
| --- | --- | --- |
| Auto-calibrate | on | Learn the call's normal speech level and colour everyone relative to it |
| Normal level (dB) | -30 | Used only with auto-calibrate off: the middle of green |
| Headroom (dB) | 10 | How far above normal the ring turns fully yellow (orange at twice this) |
| Faintest opacity | 0.1 | Opacity of the quietest green |
| Earrape sensitivity | 1 | How easily rings turn red (0 never turns red) |
| Attenuate volume (%) | 50 | Volume of everyone not marked with Attenuate, while anyone is marked |
| Auto-mute | on | Mute and hide the video of people stuck at full earrape |
| Auto-mute seconds | 5 | How long earrape has to last before auto-mute |

## Tests

The logic that does not need Discord (auto-mute timing and colour encoding) has tests:

```sh
./tests/run.sh ~/Vencord
```

## Caveats

- Discord can change its internals at any time, and this plugin patches them. If a Discord update breaks it, the rings and menus will stop changing rather than crashing Vesktop.
- Vesktop can overwrite its Vencord folder when it updates. If VolumeRing disappears after an update, run `./install.sh` again.
- Only tested on Vesktop on Linux.
- Client mods are against Discord's terms of service. Use this at your own risk.

## License

GPL-3.0-or-later, the same as Vencord. See [LICENSE](LICENSE).
