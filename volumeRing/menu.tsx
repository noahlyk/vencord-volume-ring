/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { findGroupChildrenByChildId, NavContextMenuPatchCallback } from "@api/ContextMenu";
import { Menu, React } from "@webpack/common";
import type { ReactElement } from "react";

import { inMyVoiceChannel, isSelf, localVolume } from "./discord";
import { clamp01, colorForLevel, FLOOR_DB, GOLD, GREEN, meterFor, scale } from "./levels";
import { soloed, toggleIn, vips } from "./mix";

export const VIP_COLOR = "var(--brand-500)";

// ---- Solo / Attenuate rows ----
// Drawn by us (Discord's own checkbox item only re-renders with the menu, which would lag a click),
// but laid out like a native menu row.

function Check() {
    return (
        <svg width="12" height="12" viewBox="0 0 24 24" aria-hidden>
            <path d="M4 12.5 9.5 18 20 6.5" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
    );
}

function ToggleRow({ label, color, set, userId }: { label: string; color: string; set: Set<string>; userId: string; }) {
    const [on, setOn] = React.useState(set.has(userId));
    return (
        <div
            className="vr-row"
            role="menuitemcheckbox"
            aria-checked={on}
            onClick={() => {
                toggleIn(set, userId);
                setOn(set.has(userId));
            }}
        >
            <span style={{ color }}>{label}</span>
            <span className="vr-box" style={on ? { background: color, borderColor: color } : undefined}>{on && <Check />}</span>
        </div>
    );
}

// ---- Live level meter ----

function LevelMeter({ userId }: { userId: string; }) {
    const [, tick] = React.useReducer((n: number) => n + 1, 0);
    React.useEffect(() => {
        const t = setInterval(tick, 50);
        return () => clearInterval(t);
    }, []);

    const m = meterFor(userId);
    const db = m?.db ?? FLOOR_DB;
    const earrape = m?.earrape ?? 0;
    const { silent, normal, loud, hot } = scale();
    const lo = silent - 10, hi = hot + 10;
    const pos = (x: number) => `${(clamp01((x - lo) / (hi - lo)) * 100).toFixed(1)}%`;
    const volume = localVolume(userId);
    const heard = volume > 0 ? db + 20 * Math.log10(volume / 100) : -Infinity;
    const live = db > FLOOR_DB + 1;
    const color = colorForLevel(db, earrape);

    return (
        <div className="vr-meter">
            <div className="vr-meter-head">
                <span>Level</span>
                <span>
                    {earrape >= 0.5 && <span className="vr-meter-bad">earrape </span>}
                    <span className="vr-meter-db" style={live && db > silent ? { color } : undefined}>{live ? `${db.toFixed(0)} dB` : "–"}</span>
                </span>
            </div>
            <div
                className="vr-meter-track"
                style={{
                    background: `linear-gradient(90deg, hsl(130 70% 45% / .15) ${pos(silent)}, ${GREEN} ${pos(normal)}, `
                        + `hsl(55 85% 50%) ${pos(loud)}, hsl(25 85% 50%) ${pos(hot)}, hsl(0 85% 50%) 100%)`
                }}
            >
                {live && <div className="vr-meter-needle" style={{ left: pos(db) }} />}
                {live && volume !== 100 && Number.isFinite(heard) && <div className="vr-meter-needle vr-meter-heard" style={{ left: pos(heard) }} />}
            </div>
        </div>
    );
}

// ---- Volume slider: right-click or double-click resets to 100% ----
// Discord's slider keeps its own state and only reads its value when it mounts, so after a reset we
// remount it (new key); by then the store already holds 100 and the slider picks it up.

let resetSerial = 0;

function withVolumeReset(item: ReactElement<any>): ReactElement<any> {
    const { control } = item.props;
    if (typeof control !== "function") return item;
    return React.cloneElement(item, {
        control: (props: any, ref: any) => {
            const slider = control(props, ref);
            const reset = (e: React.SyntheticEvent) => {
                e.preventDefault();
                e.stopPropagation();
                if (!React.isValidElement<any>(slider)) return;
                resetSerial++;
                slider.props.onChange?.(100); // exactly what dragging the knob to 100% does
            };
            return (
                <div
                    style={{ display: "contents" }}
                    onMouseDownCapture={e => { if (e.button === 2) reset(e); }}
                    onContextMenuCapture={e => { e.preventDefault(); e.stopPropagation(); }}
                    onDoubleClickCapture={reset}
                >
                    {React.isValidElement(slider) ? React.cloneElement(slider, { key: `vr-${resetSerial}` }) : slider}
                </div>
            );
        }
    });
}

// ---- The patch ----

interface UserMenuProps {
    user?: { id: string; };
    /** Set by Discord on menus opened from a call (voice channel list, call tiles, DM calls). */
    showMediaItems?: boolean;
    /** "default" (voice) or "stream"; the two menu variants name it differently. */
    mediaEngineContext?: string;
    context?: string;
}

export const userContext: NavContextMenuPatchCallback = (children, props: UserMenuProps) => {
    const userId = props?.user?.id;
    if (!userId || !props.showMediaItems || isSelf(userId)) return;

    const volumeGroup = findGroupChildrenByChildId("user-volume", children);
    if (volumeGroup) {
        const i = volumeGroup.findIndex(c => c?.props?.id === "user-volume");
        volumeGroup[i] = withVolumeReset(volumeGroup[i]!);
    }

    if ((props.mediaEngineContext ?? props.context) === "stream" || !inMyVoiceChannel(userId)) return;

    const muteGroup = findGroupChildrenByChildId("mute", children);
    if (muteGroup) {
        const at = muteGroup.findIndex(c => c?.props?.id === "mute");
        muteGroup.splice(at + 1, 0,
            <Menu.MenuControlItem key="vr-solo" id="vc-volume-ring-solo" control={() => <ToggleRow label="Solo" color={GOLD} set={soloed} userId={userId} />} />,
            <Menu.MenuControlItem key="vr-attenuate" id="vc-volume-ring-attenuate" control={() => <ToggleRow label="Attenuate" color={VIP_COLOR} set={vips} userId={userId} />} />
        );
    }
    if (volumeGroup) {
        volumeGroup.push(<Menu.MenuControlItem key="vr-level" id="vc-volume-ring-level" interactive={false} control={() => <LevelMeter userId={userId} />} />);
    }
};
