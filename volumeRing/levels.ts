/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { AudioInput, DEFAULT_CONTEXT, Output, SpeakingStore } from "./discord";
import { settings } from "./settings";

// Measures how loud each voice is (Discord's web client never reports levels itself) and turns a
// level into a ring colour. Everything here is per-frame and allocation free.

export const FLOOR_DB = -100; // a meter with no signal
export const OFF_DB = -120; // sentinel: not transmitting at all, ring fully transparent

const GATE_DB = -55; // quieter than this is not speech: never trains the reference
const CLIP_SAMPLE = 0.97; // |sample| at/above this counts as clipped
const CLIP_FRACTION = 0.015; // share of clipped samples that counts as fully clipping
const CREST_NATURAL_DB = 9; // natural voices keep >= ~10 dB between peak and average
const CREST_RANGE_DB = 5; // fully "squashed" at crest = 9 - 5 = 4 dB

export const clamp01 = (n: number) => Math.min(1, Math.max(0, n));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

export interface Meter {
    analyser: AnalyserNode;
    buf: Float32Array<ArrayBuffer>;
    db: number; // smoothed RMS dBFS
    earrape: number; // 0..1, smoothed
    /** The Discord output feeding this meter (remote users only), so we can notice when it dies. */
    owner?: Output;
}

function createMeter(ctx: AudioContext, source: AudioNode, owner?: Output): Meter {
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    source.connect(analyser);
    return { analyser, buf: new Float32Array(analyser.fftSize), db: FLOOR_DB, earrape: 0, owner };
}

// ---- Auto-calibration: what "typical speech" sounds like in this call ----

const REFERENCE_MIN = -45, REFERENCE_MAX = -20;
let reference = -30;

function learn(db: number) {
    if (db < GATE_DB) return;
    // slow: ~15-20 s of speech to settle, so one shout barely moves it
    reference = clamp(reference + (db - reference) * 0.003, REFERENCE_MIN, REFERENCE_MAX);
}

export interface Scale { silent: number; normal: number; loud: number; hot: number; }

/** The dB landmarks the colours are based on: faintest, green, yellow, orange. */
export function scale(): Scale {
    const { autoLevel, normalDb, headroomDb } = settings.store;
    const normal = autoLevel ? reference : normalDb;
    const h = Math.max(2, headroomDb);
    return { silent: normal - 20, normal, loud: normal + h, hot: normal + 2 * h };
}

// ---- Measurement ----

function measure(m: Meter, trainsReference: boolean) {
    m.analyser.getFloatTimeDomainData(m.buf);
    const n = m.buf.length;
    let sum = 0, peak = 0, clipped = 0;
    for (let i = 0; i < n; i++) {
        const v = Math.abs(m.buf[i]);
        sum += v * v;
        if (v > peak) peak = v;
        if (v >= CLIP_SAMPLE) clipped++;
    }
    const rms = Math.sqrt(sum / n);
    const rmsDb = rms > 0 ? Math.max(FLOOR_DB, 20 * Math.log10(rms)) : FLOOR_DB;
    const peakDb = peak > 0 ? 20 * Math.log10(peak) : FLOOR_DB;

    // fast attack, slower release so the ring doesn't flicker
    m.db = rmsDb > m.db ? rmsDb : m.db + (rmsDb - m.db) * 0.25;
    if (trainsReference) learn(rmsDb);

    // Earrape = pinned at the ceiling (clipping), a squashed waveform that is also very loud
    // (a loud natural voice keeps its peaks), or simply absurdly loud.
    const { hot } = scale();
    const clipScore = clamp01(clipped / n / CLIP_FRACTION);
    const flatScore = clamp01((CREST_NATURAL_DB - (peakDb - rmsDb)) / CREST_RANGE_DB) * clamp01((rmsDb - hot) / 6);
    const blastScore = clamp01((rmsDb - hot - 6) / 6);
    const inst = clamp01(Math.max(clipScore, flatScore, blastScore) * settings.store.earrapeSensitivity);

    // must be sustained: climbs over a few hundred ms, lingers briefly after
    m.earrape += (inst - m.earrape) * (inst > m.earrape ? 0.25 : 0.08);
}

// ---- Registry of everything we meter ----

/** "<context>:<userId>" -> meter, for every remote user with audio. */
export const meters = new Map<string, Meter>();
/** Every AudioInput Discord creates for our mic (real call, voice-activity probe, loopback test). */
const selfInputs = new Map<AudioInput, { stream?: MediaStream; meter?: Meter; }>();

export const meterKey = (userId: string, context = DEFAULT_CONTEXT) => `${context}:${userId}`;
export const meterFor = (userId: string, context = DEFAULT_CONTEXT) => meters.get(meterKey(userId, context));

export function attachOutput(output: Output) {
    if (!output.streamSourceNode) return;
    const key = meterKey(output.id, output.vrContext);
    meters.get(key)?.analyser.disconnect();
    meters.set(key, createMeter(output.audioContext, output.streamSourceNode, output));
    ensureTicking();
}

export function attachInput(input: AudioInput) {
    if (!selfInputs.has(input)) selfInputs.set(input, {});
    ensureTicking();
}

export function selfMeters(): Meter[] {
    const out: Meter[] = [];
    for (const { meter } of selfInputs.values()) if (meter) out.push(meter);
    return out;
}

/** Highest level and earrape score across our mic inputs, or undefined when we have none. */
export function selfLevel() {
    let db = -Infinity, earrape = 0, any = false;
    for (const m of selfMeters()) {
        any = true;
        if (m.db > db) db = m.db;
        if (m.earrape > earrape) earrape = m.earrape;
    }
    return any ? { db, earrape } : undefined;
}

// Discord replaces the mic stream whenever it re-acquires the device, so follow it.
function syncSelf() {
    for (const [input, state] of selfInputs) {
        if (input.destroyed) {
            state.meter?.analyser.disconnect();
            selfInputs.delete(input);
            continue;
        }
        if (input.stream === state.stream) continue;
        state.meter?.analyser.disconnect();
        state.meter = undefined;
        state.stream = input.stream;
        if (!state.stream) continue;
        try {
            state.meter = createMeter(input.context, input.context.createMediaStreamSource(state.stream));
        } catch (e) {
            console.error("[VolumeRing] self meter failed", e);
        }
    }
}

// ---- The 20 Hz loop ----

const TICK_MS = 50;
let raf = 0;
let lastTick = 0;
let onTick: ((now: number) => void) | undefined;

/** Called every tick after the meters are updated (auto-mute hooks in here). */
export function setTickHandler(fn: typeof onTick) { onTick = fn; }

function tick(now: number) {
    raf = 0;
    if (!meters.size && !selfInputs.size) return; // nothing to do: stop until something attaches
    raf = requestAnimationFrame(tick);
    if (now - lastTick < TICK_MS) return;
    lastTick = now;
    syncSelf();

    let active = false;
    for (const [key, m] of meters) {
        if (m.owner && !m.owner.streamSourceNode) { // output destroyed: drop its meter
            m.analyser.disconnect();
            meters.delete(key);
            continue;
        }
        measure(m, key.startsWith(DEFAULT_CONTEXT + ":"));
        if (m.db > FLOOR_DB + 1) active = true;
    }
    for (const m of selfMeters()) {
        measure(m, false);
        if (m.db > FLOOR_DB + 1) active = true;
    }
    if (active) SpeakingStore.emitChange();
    onTick?.(now);
}

function ensureTicking() {
    if (!raf) raf = requestAnimationFrame(tick);
}

export function stopMetering() {
    cancelAnimationFrame(raf);
    raf = 0;
    for (const m of meters.values()) m.analyser.disconnect();
    meters.clear();
    for (const { meter } of selfInputs.values()) meter?.analyser.disconnect();
    selfInputs.clear();
}

// ---- Colours ----

export const GOLD = "#f5c542";
export const GREEN = "hsl(130 70% 45%)";

/** Ring colour for a level: faint green -> green -> yellow -> orange; red only with earrape. */
export function colorForLevel(db: number, earrape: number): string {
    if (!Number.isFinite(db) || db <= OFF_DB + 5) return "transparent";
    const { silent, normal, loud, hot } = scale();
    const { minOpacity } = settings.store;
    if (db <= silent) return `hsl(130 70% 45% / ${minOpacity})`;
    if (db < normal && earrape <= 0) return `hsl(130 70% 45% / ${lerp(minOpacity, 1, (db - silent) / (normal - silent))})`;

    // clean voice: green -> yellow -> orange as the level rises, never red on its own
    const hue = db < loud
        ? lerp(130, 55, clamp01((db - normal) / (loud - normal)))
        : lerp(55, 25, clamp01((db - loud) / (hot - loud)));
    // earrape pulls it all the way to red
    return `hsl(${lerp(hue, 0, earrape)} 85% 50%)`;
}

/** The same audio as heard at `volume` % (gain also makes clipping more likely). */
export function heardColor(db: number, earrape: number, volume: number): string {
    if (volume <= 0) return "transparent";
    const gainDb = 20 * Math.log10(volume / 100);
    return colorForLevel(db + gainDb, clamp01(earrape + Math.max(0, gainDb) / 12));
}

// ---- Smuggling extra data through Discord's single `voiceDb` number ----
//
// The ring only receives one number from SpeakingStore, so the whole dB goes in the integer part
// and a small payload (earrape tenths, heard volume in 10% steps, a display mark) in the fraction.

export const enum Mark { None, Silenced, Soloed, Lowered, Vip, Self }
export const MARK_NAMES = ["", "gray", "solo", "dim", "vip", ""] as const;

const VOLUME_STEPS = 100, EARRAPE_STEPS = 11, MARK_STEPS = 6;
const PAYLOAD_SCALE = 100_000; // payload < 6600, so the fraction stays well under 0.5
const PAYLOAD_MAX = MARK_STEPS * EARRAPE_STEPS * VOLUME_STEPS;

export function encode(db: number, earrape: number, heardVolume: number, mark: Mark): number {
    const v = clamp(Math.round(heardVolume / 10), 0, VOLUME_STEPS - 1);
    const e = clamp(Math.round(earrape * 10), 0, EARRAPE_STEPS - 1);
    const payload = (mark * EARRAPE_STEPS + e) * VOLUME_STEPS + v;
    return Math.round(db) - payload / PAYLOAD_SCALE;
}

export interface Level { db: number; earrape: number; heardVolume: number; mark: Mark; }

export function decode(value: number): Level {
    const db = Math.round(value);
    let payload = Math.round((db - value) * PAYLOAD_SCALE);
    if (payload < 0 || payload >= PAYLOAD_MAX) payload = VOLUME_STEPS / 10; // not one of ours: plain dB at 100 %, no mark
    const v = payload % VOLUME_STEPS;
    const q = Math.floor(payload / VOLUME_STEPS);
    return { db, heardVolume: v * 10, earrape: (q % EARRAPE_STEPS) / 10, mark: Math.floor(q / EARRAPE_STEPS) as Mark };
}
