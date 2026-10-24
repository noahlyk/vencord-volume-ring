/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Devs } from "@utils/constants";
import definePlugin from "@utils/types";
import type { CSSProperties } from "react";

import { resetAutoMute, updateAutoMute } from "./autoMute";
import { AudioInput, DEFAULT_CONTEXT, isSelf, localVolume, MediaEngineStore, Output } from "./discord";
import {
    attachInput, attachOutput, colorForLevel, decode, encode, GOLD, heardColor, Mark, MARK_NAMES, meterFor, meters, OFF_DB,
    scale, selfLevel, setTickHandler, stopMetering
} from "./levels";
import { userContext, VIP_COLOR } from "./menu";
import { applyGain, clearMix, gainFor, markFor, pruneMix, registerOutput } from "./mix";
import { settings } from "./settings";

// Discord draws the speaking ring as a box-shadow in one shared hook. The left half keeps Discord's
// border (our colour); the right half is a clipped ::before copy of it in the "as heard" colour.
const CSS = `
[style*="--vr-sr"]::before{content:"";position:absolute;inset:0;border-radius:inherit;pointer-events:none;box-shadow:var(--vr-sr);clip-path:polygon(50% -100%,300% -100%,300% 300%,50% 300%)}
[data-vr="gray"] :is(img,foreignObject,[style*="background-image"]):not(video){filter:grayscale(1) brightness(.7)}
[data-vr="gray"] :is(span,div,a):not(:has(*)){color:var(--text-muted)!important}
[data-vr="dim"] :is(span,div,a):not(:has(*)){opacity:.55}
[data-vr="solo"] :is(span,div,a):not(:has(*)){color:${GOLD}!important;font-weight:600}
[data-vr="vip"] :is(span,div,a):not(:has(*)){color:${VIP_COLOR}!important;font-weight:600}
.vr-row{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:6px 8px;border-radius:2px;cursor:pointer;user-select:none;font-weight:500}
.vr-row:hover{background:var(--background-modifier-hover)}
.vr-box{width:18px;height:18px;box-sizing:border-box;border-radius:4px;border:2px solid var(--interactive-normal);display:grid;place-items:center;color:#fff;flex:none}
.vr-meter{padding:4px 8px 8px;font-size:12px;color:var(--text-muted)}
.vr-meter-head{display:flex;justify-content:space-between;margin-bottom:6px}
.vr-meter-db{font-variant-numeric:tabular-nums;color:var(--text-normal)}
.vr-meter-bad{color:hsl(0 85% 60%);font-weight:600}
.vr-meter-track{position:relative;height:6px;border-radius:3px;background:var(--background-modifier-accent)}
.vr-meter-needle{position:absolute;top:-3px;bottom:-3px;width:2px;margin-left:-1px;border-radius:1px;background:var(--text-normal);box-shadow:0 0 0 1px var(--background-base-lower);transition:left 50ms linear}
.vr-meter-heard{opacity:.45}
`;

let styleEl: HTMLStyleElement | undefined;
let markTimer: number | undefined;
let hadMarks = false;

// Tag each marked person's list row / call tile (the nearest ancestor of their avatar that shows
// text) so the stylesheet can grey, dim or gild their name.
function markRows() {
    const marked = document.querySelectorAll<HTMLElement>('[style*="--vr-mark"]');
    if (!marked.length && !hadMarks) return;
    for (const el of document.querySelectorAll("[data-vr]")) el.removeAttribute("data-vr");
    hadMarks = marked.length > 0;
    for (const avatar of marked) {
        const mark = avatar.style.getPropertyValue("--vr-mark").trim();
        let row = avatar.parentElement;
        for (let i = 0; row && i < 6 && !row.textContent?.trim(); i++) row = row.parentElement;
        if (mark && row?.textContent?.trim()) row.setAttribute("data-vr", mark);
    }
}

// Ctrl+A clears Solo / Attenuate (unless you are typing, where it keeps meaning "select all")
function onKey(e: KeyboardEvent) {
    if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey || e.key.toLowerCase() !== "a") return;
    const t = e.target as HTMLElement | null;
    if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
    e.preventDefault();
    clearMix(true);
}

export default definePlugin({
    name: "VolumeRing",
    description: "Colours the speaking ring by loudness (faint green → green → yellow → orange, red for earrape), adds Solo / Attenuate / a live level meter to the voice context menu, and auto-mutes earrape. Vesktop/web only.",
    authors: [Devs.Ven],
    settings,
    contextMenus: { "user-context": userContext },

    patches: [
        // Meter each remote user's incoming audio (the web client never reports voiceDb itself)
        {
            find: "streamSourceNode",
            predicate: () => !IS_DISCORD_DESKTOP,
            replacement: {
                match: /(this\.streamSourceNode=this\.audioContext\.createMediaStreamSource\(this\.stream\);)/,
                replace: "$1$self.attach(this);"
            }
        },
        // Solo / Attenuate: scale the volume Discord just applied in Output.updateAudioElement()
        {
            find: "streamSourceNode",
            predicate: () => !IS_DISCORD_DESKTOP,
            replacement: {
                match: /(let (\i)=this\.sinkId;null!=\2&&\i&&\i\.setSinkId\(\2\))(?=\}\})/,
                replace: "$1,$self.applyGain(this)"
            }
        },
        // Remember which media context (voice vs stream) each Output belongs to, so they get separate meters
        {
            find: "streamSourceNode",
            predicate: () => !IS_DISCORD_DESKTOP,
            replacement: {
                match: /\((\i)=new (\i)\((\i),this\.audioContext\)\)\.mute=/,
                replace: "($1=$self.tagContext(new $2($3,this.audioContext),this.context)).mute="
            }
        },
        // Report our measured level when Discord has none
        {
            find: 'location:"SpeakingStore"',
            replacement: {
                match: /(getVoiceVolume\((\i)\)\{let (\i)=.+?return )(\i\.enabled&&!\i\.disableUI\?(.+?\?\.voiceDb)\?\?-1\/0:-1\/0)/,
                replace: "$1$self.level($2,$5,$3)??($4)"
            }
        },
        // Meter our own microphone so our ring is coloured too
        {
            find: "AudioInput: No MediaStream",
            replacement: {
                match: /this\.emit\("stream",this\.stream\)/,
                replace: "$self.attachInput(this),$&"
            }
        },
        // The shared ring hook: hand us the final style so we can split it and tag the row
        {
            find: "var(--status-speaking)",
            replacement: [
                {
                    match: /(?<=\{isSpeaking:\i,voiceDb:(\i),.{0,1200}?)return (\i)&&\((\i)\.transition="box-shadow 50ms ease-out"\),\3\}/,
                    replace: 'return $2&&($3.transition="box-shadow 50ms ease-out"),$self.hookStyle($3,$1)}'
                },
                {
                    match: /(?<=voiceDb:(\i),.{0,800}?)"var\(--status-speaking\)"/,
                    replace: "$self.color($1)"
                }
            ]
        }
    ],

    attach(output: Output) {
        try {
            registerOutput(output);
            attachOutput(output);
        } catch (e) {
            console.error("[VolumeRing] attach failed", e);
        }
    },

    attachInput(input: AudioInput) {
        attachInput(input);
    },

    applyGain(output: Output) {
        try {
            applyGain(output);
        } catch (e) {
            console.error("[VolumeRing] applyGain failed", e);
        }
    },

    tagContext(output: Output, context: string) {
        output.vrContext = context;
        return output;
    },

    /** What SpeakingStore.getVoiceVolume returns: our encoded level, or undefined to use Discord's. */
    level(userId: string, nativeDb: number | undefined, context = DEFAULT_CONTEXT): number | undefined {
        if (context === DEFAULT_CONTEXT && isSelf(userId)) {
            // nothing reaches Discord while muted / deafened, so the ring is off
            if (MediaEngineStore.isSelfMute() || MediaEngineStore.isSelfDeaf()) return OFF_DB;
            const self = selfLevel();
            if (!self) return nativeDb;
            // our own mic always has a noise floor; below "silent" we are not really sending anything
            if (self.db <= scale().silent) return OFF_DB;
            return encode(self.db, self.earrape, 100, Mark.Self);
        }
        const m = meterFor(userId, context);
        if (!m) return nativeDb;
        return encode(m.db, m.earrape, localVolume(userId) * gainFor(userId), markFor(userId));
    },

    color(value: number): string {
        if (typeof value !== "number" || !Number.isFinite(value)) return `hsl(130 70% 45% / ${settings.store.minOpacity})`;
        const { db, earrape } = decode(value);
        return colorForLevel(db, earrape);
    },

    hookStyle(style: CSSProperties, value: number): CSSProperties {
        try {
            if (typeof value !== "number" || !Number.isFinite(value) || value <= OFF_DB + 1) return style;
            const { db, earrape, heardVolume, mark } = decode(value);
            let out: any = style;

            // Others' rings: left half = at 100%, right half = as heard at their volume. One ring at exactly 100%.
            if (typeof style.boxShadow === "string" && mark !== Mark.Self && heardVolume !== 100) {
                const left = colorForLevel(db, earrape);
                const right = heardColor(db, earrape, heardVolume);
                if (style.boxShadow.includes(left)) {
                    out = { ...out, contain: "layout", "--vr-sr": style.boxShadow.split(left).join(right) };
                }
            }
            const name = MARK_NAMES[mark];
            if (name) out = { ...out, "--vr-mark": name };
            return out;
        } catch (e) {
            console.error("[VolumeRing] hookStyle failed", e);
            return style;
        }
    },

    start() {
        styleEl = document.createElement("style");
        styleEl.textContent = CSS;
        document.head.append(styleEl);
        setTickHandler(now => updateAutoMute(meters, now));
        markTimer = window.setInterval(() => { pruneMix(); markRows(); }, 300);
        document.addEventListener("keydown", onKey, true);
    },

    stop() {
        clearInterval(markTimer);
        document.removeEventListener("keydown", onKey, true);
        clearMix();
        hadMarks = false;
        for (const el of document.querySelectorAll("[data-vr]")) el.removeAttribute("data-vr");
        styleEl?.remove();
        styleEl = undefined;
        setTickHandler(undefined);
        stopMetering();
        resetAutoMute();
    }
});
