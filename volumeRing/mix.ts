/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { SelectedChannelStore, showToast } from "@webpack/common";

import { Output, SpeakingStore, VoiceStateStore } from "./discord";
import { Mark } from "./levels";
import { settings } from "./settings";

// Solo and Attenuate: a local mix on top of Discord's own volumes. Nothing here touches Discord's
// real mutes or volume settings; it only scales what reaches our speakers.
//
//   Solo       while anyone is soloed, only soloed people are audible.
//   Attenuate  while anyone is marked, everyone who is not marked plays at `attenuation` %.

export const soloed = new Set<string>();
export const vips = new Set<string>();

/** Live outputs, so a mix change can be pushed to the audio elements immediately. */
const outputs = new Set<Output>();
export const registerOutput = (o: Output) => void outputs.add(o);

/** Multiplier applied on top of Discord's own volume for this user. */
export function gainFor(userId: string): number {
    if (soloed.size) return soloed.has(userId) ? 1 : 0;
    if (vips.size) return vips.has(userId) ? 1 : settings.store.attenuation / 100;
    return 1;
}

/** How this user should be drawn (gold name, greyed out, ...). */
export function markFor(userId: string): Mark {
    if (soloed.size) return soloed.has(userId) ? Mark.Soloed : Mark.Silenced;
    if (vips.size) return vips.has(userId) ? Mark.Vip : Mark.Lowered;
    return Mark.None;
}

/** Runs at the end of Discord's Output.updateAudioElement(), after it set the real volume. */
export function applyGain(output: Output) {
    const g = gainFor(output.id);
    if (g === 1) return;
    if (output.gainNode) output.gainNode.gain.value *= g; // VolumeBooster routes audio through a gain node
    else if (output.audioElement) output.audioElement.volume = Math.min(1, output.audioElement.volume * g);
}

/** Push the current mix to every live output and redraw rings and names. */
export function refreshMix() {
    for (const o of outputs) {
        if (!o.streamSourceNode) { outputs.delete(o); continue; }
        o.updateAudioElement();
    }
    SpeakingStore.emitChange();
}

export function toggleIn(set: Set<string>, userId: string) {
    if (!set.delete(userId)) set.add(userId);
    refreshMix();
}

export function clearMix(toast = false) {
    if (!soloed.size && !vips.size) return;
    soloed.clear();
    vips.clear();
    refreshMix();
    if (toast) showToast({ text: "Solo / Attenuate cleared" });
}

let lastVoiceChannel: string | null | undefined;

/** Joining or leaving a call clears everything; a set whose members have all left is dropped. */
export function pruneMix() {
    const channelId = SelectedChannelStore.getVoiceChannelId();
    if (channelId !== lastVoiceChannel) {
        lastVoiceChannel = channelId;
        clearMix();
        return;
    }
    if (!channelId) return;
    for (const set of [soloed, vips]) {
        if (!set.size) continue;
        const anyPresent = [...set].some(id => VoiceStateStore.getVoiceStateForUser(id)?.channelId === channelId);
        if (!anyPresent) {
            set.clear();
            refreshMix();
        }
    }
}
