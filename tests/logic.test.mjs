import { createAutoMute, TTL_MS } from "./.build/autoMute.mjs";
import { encode, decode, scale } from "./.build/levels.mjs";
let ok = true; const check = (n, c) => { console.log(c ? "PASS" : "FAIL", n); ok &&= c; };

// ---- auto-mute: 5 s hold, 85 % of samples hot ----
function mk(pre = []) {
    const muted = new Set(pre); const calls = [];
    const am = createAutoMute({ isEnabled: () => true, holdMs: () => 5000, getSelfId: () => "me", isLocalMute: id => muted.has(id),
        mute: id => { calls.push(id); muted.has(id) ? muted.delete(id) : muted.add(id); }, getUsername: id => "u" + id });
    return { am, muted, calls };
}
// feed `v` from t=from..to every 50 ms; `fn(t)` may override per sample
const run = (am, key, v, from, to, fn) => { for (let t = from; t <= to; t += 50) am.update(new Map([[key, { earrape: fn ? fn(t) : v }]]), t); };

let s = mk();
run(s.am, "default:a", 1, 0, 2000); run(s.am, "default:a", 0.1, 2050, 3000);
check("a: 2 s of earrape then stop -> no mute", s.calls.length === 0);
s = mk(); run(s.am, "default:a", 1, 0, 4900);
check("b: 4.9 s -> not yet", s.calls.length === 0);
run(s.am, "default:a", 1, 4950, 5100);
check("b2: 5 s+ -> one mute", s.calls.length === 1 && s.muted.has("a"));
run(s.am, "default:a", 1, 5150, 20000);
check("c: keeps going -> no second mute", s.calls.length === 1);
s = mk(); run(s.am, "default:a", 0, 0, 8000, t => (t % 1000) < 500 ? 1 : 0.2);
check("d: clipping half the time -> no mute", s.calls.length === 0);
s = mk(); run(s.am, "default:a", 0, 0, 8000, t => (t % 2000) < 1850 ? 1 : 0.2);
check("e: brief dips (92 % hot) -> still mutes", s.calls.length === 1);
s = mk(); run(s.am, "default:a", 1, 0, 6000);
s.muted.delete("a"); s.am.update(new Map(), 6100);               // manual unmute
run(s.am, "default:a", 1, 7000, 20000);
check("f: after manual unmute -> whitelisted, no re-mute", s.calls.length === 1 && s.am.cache.get("a").state === "whitelisted");
run(s.am, "default:a", 0.1, 6100 + TTL_MS, 6100 + TTL_MS + 50);
run(s.am, "default:a", 1, 6100 + TTL_MS + 100, 6100 + TTL_MS + 6000);
check("g: eligible again after 1 h", s.calls.length === 2);
s = mk(["b"]); run(s.am, "default:b", 1, 0, 8000);
check("h: already muted by user -> untouched, unrecorded", s.calls.length === 0 && s.am.cache.size === 0);
s = mk(); run(s.am, "default:me", 1, 0, 8000); run(s.am, "stream:x", 1, 0, 8000);
check("i: self and stream audio ignored", s.calls.length === 0);

// ---- level encoding round-trips ----
let bad = 0;
for (let mark = 0; mark <= 5; mark++) for (let e = 0; e <= 10; e++) for (let vol = 0; vol <= 990; vol += 10) for (const db of [-120, -99, -57, -30, -12, -1, 0]) {
    const d = decode(encode(db, e / 10, vol, mark));
    if (d.db !== db || Math.abs(d.earrape - e / 10) > 1e-9 || d.heardVolume !== vol || d.mark !== mark) { bad++; if (bad < 3) console.log("  mismatch", { db, e, vol, mark, d }); }
}
check("j: encode/decode round-trips (" + (6 * 11 * 100 * 7) + " cases)", bad === 0);
check("k: foreign value decodes as plain 100 %, no mark", (() => { const d = decode(-23.7); return d.db === -24 && d.heardVolume === 100 && d.mark === 0 && d.earrape === 0; })());
check("l: default scale is sane", (() => { const s = scale(); return s.silent === -50 && s.normal === -30 && s.loud === -20 && s.hot === -10; })());
console.log(ok ? "ALL OK" : "FAILURES"); process.exit(ok ? 0 : 1);
