/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { findByPropsLazy, findStoreLazy } from "@webpack";
import { SelectedChannelStore, UserStore } from "@webpack/common";

export const SpeakingStore = findStoreLazy("SpeakingStore");
export const MediaEngineStore = findStoreLazy("MediaEngineStore");
export const VoiceStateStore = findStoreLazy("VoiceStateStore");
export const MediaEngineActions = findByPropsLazy("toggleLocalMute", "setLocalVolume", "setDisableLocalVideo");

/** Discord's media context for voice (as opposed to "stream" audio). */
export const DEFAULT_CONTEXT = "default";

/** One remote user's audio in Discord's web voice engine (its `Output` class). */
export interface Output {
    id: string;
    audioContext: AudioContext;
    audioElement: HTMLAudioElement | null;
    streamSourceNode: MediaStreamAudioSourceNode | null;
    /** Added by the VolumeBooster plugin when it is enabled. */
    gainNode?: GainNode;
    /** Added by us: media context this output belongs to ("default" voice or "stream"). */
    vrContext?: string;
    updateAudioElement(): void;
}

/** Our own microphone (Discord's `AudioInput` class). */
export interface AudioInput {
    context: AudioContext;
    stream?: MediaStream;
    destroyed: boolean;
}

export const selfId = (): string | undefined => UserStore.getCurrentUser()?.id;
export const isSelf = (userId: string) => userId === selfId();

/** True when `userId` is in the voice channel we are in right now. */
export function inMyVoiceChannel(userId: string): boolean {
    const channelId = SelectedChannelStore.getVoiceChannelId();
    return !!channelId && VoiceStateStore.getVoiceStateForUser(userId)?.channelId === channelId;
}

/** The volume (%) Discord plays this user at; 0 when locally muted. */
export function localVolume(userId: string): number {
    if (MediaEngineStore.isLocalMute(userId, DEFAULT_CONTEXT)) return 0;
    return MediaEngineStore.getLocalVolume(userId, DEFAULT_CONTEXT) ?? 100;
}
