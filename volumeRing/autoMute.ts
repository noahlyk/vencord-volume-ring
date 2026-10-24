/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { showToast, UserStore } from "@webpack/common";

import { DEFAULT_CONTEXT, MediaEngineActions, MediaEngineStore } from "./discord";
import { settings } from "./settings";

// Auto-mute (locally) remote users who stay at maximum earrape for too long.
// The decision logic (createAutoMute) is pure and injectable; the Discord glue is at the bottom.

export const EARRAPE_THRESHOLD = 0.9; // meter.earrape at/above this counts as "max"
export const HOT_FRACTION = 0.85; // share of samples in the window that must be at max
export const SLACK_MS = 1000; // the window is hold + slack, so a short dip doesn't restart the clock
export const TTL_MS = 3_600_000; // how long a user stays in the cache (muted or whitelisted)

export interface AutoMuteEntry {
    username: string;
    mutedAt: number;
    state: "muted" | "whitelisted";
    expiresAt: number;
}

export interface AutoMuteDeps {
    isEnabled(): boolean;
    /** How long (ms) the earrape has to be near-constant before we act. */
    holdMs(): number;
    getSelfId(): string | undefined;
    isLocalMute(userId: string): boolean;
    /** Performs the local mute (a toggle in Discord; only called when not muted). */
    mute(userId: string): void;
    /** Turns off the user's camera/stream video locally. */
    disableVideo?(userId: string): void;
    getUsername(userId: string): string;
    onMuted?(userId: string, username: string): void;
}

export function createAutoMute(deps: AutoMuteDeps) {
    const cache = new Map<string, AutoMuteEntry>();
    const samples = new Map<string, { t: number; hot: boolean; }[]>(); // meter key -> recent samples

    function live(userId: string, now: number) {
        const e = cache.get(userId);
        if (e && now >= e.expiresAt) {
            cache.delete(userId);
            return undefined;
        }
        return e;
    }

    function update(meters: Map<string, { earrape: number; }>, now: number) {
        // expire old entries, and notice manual unmutes of users we muted
        for (const [userId, e] of cache) {
            if (now >= e.expiresAt) {
                cache.delete(userId);
                continue;
            }
            if (e.state === "muted" && !deps.isLocalMute(userId)) {
                e.state = "whitelisted";
                e.expiresAt = now + TTL_MS;
            }
        }

        for (const key of samples.keys()) if (!meters.has(key)) samples.delete(key);

        if (!deps.isEnabled()) {
            samples.clear();
            return;
        }

        const holdMs = deps.holdMs();
        const windowMs = holdMs + SLACK_MS;
        const selfId = deps.getSelfId();
        const prefix = DEFAULT_CONTEXT + ":";

        for (const [key, meter] of meters) {
            if (!key.startsWith(prefix)) continue;
            const userId = key.slice(prefix.length);
            if (!userId || userId === selfId) continue;

            let list = samples.get(key);
            if (!list) samples.set(key, list = []);
            list.push({ t: now, hot: meter.earrape >= EARRAPE_THRESHOLD });
            while (list.length && now - list[0].t > windowMs) list.shift();

            if (now - list[0].t < holdMs) continue;
            let hot = 0;
            for (const s of list) if (s.hot) hot++;
            if (hot / list.length < HOT_FRACTION) continue;

            // sustained: act at most once, then require a fresh window if we bail out
            samples.delete(key);
            if (live(userId, now)) continue;
            if (deps.isLocalMute(userId)) continue; // already muted by the user: don't touch or record

            deps.mute(userId);
            if (!deps.isLocalMute(userId)) continue; // toggle didn't take effect; try again after another hold

            deps.disableVideo?.(userId);
            const username = deps.getUsername(userId);
            cache.set(userId, { username, mutedAt: now, state: "muted", expiresAt: now + TTL_MS });
            deps.onMuted?.(userId, username);
        }
    }

    function reset() {
        cache.clear();
        samples.clear();
    }

    return { update, reset, cache };
}

// ---- Discord glue ----

const autoMute = createAutoMute({
    isEnabled: () => settings.store.autoMuteEnabled,
    holdMs: () => settings.store.autoMuteSeconds * 1000,
    getSelfId: () => UserStore.getCurrentUser()?.id,
    isLocalMute: id => !!MediaEngineStore.isLocalMute(id, DEFAULT_CONTEXT),
    mute: id => MediaEngineActions.toggleLocalMute(id, DEFAULT_CONTEXT),
    // setDisableLocalVideo(userId, videoToggleState, context): "DISABLED" turns their video off
    disableVideo: id => MediaEngineActions.setDisableLocalVideo(id, "DISABLED", DEFAULT_CONTEXT),
    getUsername: id => UserStore.getUser(id)?.username ?? id,
    onMuted: (_id, username) => {
        console.log(`[VolumeRing] auto-muted ${username} for sustained earrape`);
        showToast({ text: `VolumeRing muted ${username} for earrape` });
    },
});

export function updateAutoMute(meters: Map<string, { earrape: number; }>, now: number) {
    try {
        autoMute.update(meters, now);
    } catch (e) {
        console.error("[VolumeRing] auto-mute failed", e);
    }
}

export function resetAutoMute() {
    autoMute.reset();
}
