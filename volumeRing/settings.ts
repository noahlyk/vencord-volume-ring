/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { makeRange, OptionType } from "@utils/types";

export const settings = definePluginSettings({
    autoLevel: {
        type: OptionType.BOOLEAN,
        description: "Auto-calibrate: learn the typical speech level of the call and colour everyone relative to it (green = typical, yellow = louder than most). Turn off to set the level by hand below.",
        default: true,
    },
    normalDb: {
        type: OptionType.SLIDER,
        description: "Manual only: level (dBFS) of typical speech, the middle of green",
        markers: makeRange(-50, -15, 5),
        default: -30,
        stickToMarkers: false,
    },
    headroomDb: {
        type: OptionType.SLIDER,
        description: "dB above typical speech where the ring is fully yellow (orange at twice that). Smaller = touchier",
        markers: makeRange(4, 20, 2),
        default: 10,
        stickToMarkers: false,
    },
    minOpacity: {
        type: OptionType.SLIDER,
        description: "Opacity of the faintest green ring (mic open, nothing heard)",
        markers: [0, 0.02, 0.04, 0.08, 0.1, 0.15, 0.25, 0.4],
        default: 0.1,
        stickToMarkers: false,
    },
    earrapeSensitivity: {
        type: OptionType.SLIDER,
        description: "How easily the ring turns red for earrape / clipping / mic spam (higher = easier, 0 = never red)",
        markers: [0, 0.5, 0.75, 1, 1.25, 1.5, 2],
        default: 1,
        stickToMarkers: false,
    },
    attenuation: {
        type: OptionType.SLIDER,
        description: "Attenuate: volume (%) of everyone who is NOT marked, while at least one person is marked",
        markers: makeRange(0, 100, 10),
        default: 50,
        stickToMarkers: false,
    },
    autoMuteEnabled: {
        type: OptionType.BOOLEAN,
        description: "Locally mute (and hide the camera of) anyone who stays at full earrape for the time below. Once per hour; unmuting them yourself whitelists them for an hour.",
        default: true,
    },
    autoMuteSeconds: {
        type: OptionType.SLIDER,
        description: "Seconds of near-constant earrape before auto-mute kicks in",
        markers: makeRange(1, 15, 1),
        default: 5,
        stickToMarkers: false,
    },
});
