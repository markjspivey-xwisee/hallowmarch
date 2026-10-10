/* ================================================================== */
/* music: an original procedural score, synthesised in Web Audio       */
/* ================================================================== */
// No samples and no borrowed tunes: every note is made here, as the game runs. Each mood is a small generative
// piece. Its chords walk weighted progressions in the mood's mode and are voice-led (each voice moves to the
// nearest tone of the next chord, avoiding parallel fifths and octaves); its melodies grow from short motifs that
// are stated, sequenced onto the next chord, varied and brought to a cadence; and every section of eight bars
// picks a new texture and asks or answers a musical question, so the score keeps changing instead of looping.
// The engine works on any AudioContext: the game plays it live under the effects, and tools/tests/music.py
// renders moods offline to check the levels.
//
// Moods: title, the three homelands (logres, eriu, thule), frontier, battle (layers follow the fighting near the
// player), barrow, night. Stingers: levelup, keepWon, keepLost, hallowWon, hallowLost, victory, defeat.
// Hooks elsewhere (all marked [music]): updateAudio and sfx in 11_audio.js, the settings menu in 10_ui.js, the
// settings in 12_save.js and campaignVictory in 08g_campaign.js.

const MUSIC_LEVELS = [['off', 'Off', 0], ['low', 'Low', 0.3], ['medium', 'Medium', 0.55], ['high', 'High', 0.9]];
const MUSIC_BASE = 0.62; // the music bus at volume 1 (quiet by default: Medium sits well under the effects)
const MUSIC = {
  vol: 0.55, E: null, bus: null, duck: null, an: null, anBuf: null, duckDb: 0,
  mood: '', moodKey: '', want: '', wantT: 0, heat: 0, heatRaw: 0, heatAt: 0, night: false, flavour: -1,
  seen: null, log: [], stingers: [], lite: false, frameAvg: 1 / 60, debug: false, forced: null,
};
const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

/* ------------------------------------------------------------------ */
/* the engine: output, a synthesised hall, voice bookkeeping           */
/* ------------------------------------------------------------------ */
function musicEngine(ctx, dest, lite, rnd = Math.random) {
  const E = { ctx, lite, rnd, live: 0, nodes: 0, made: 0, peak: 0, pieces: [] };
  E.out = ctx.createGain();
  E.out.connect(dest);
  // the hall: a stereo impulse of early reflections and a dense tail that darkens as it dies
  E.rev = ctx.createConvolver();
  E.rev.buffer = musicImpulse(ctx, lite ? 2.4 : 3.4);
  E.revIn = ctx.createGain();
  const revHp = ctx.createBiquadFilter();
  revHp.type = 'highpass'; revHp.frequency.value = 170; revHp.Q.value = 0.5;
  E.revOut = ctx.createGain(); E.revOut.gain.value = 0.8;
  E.revIn.connect(revHp).connect(E.rev).connect(E.revOut).connect(E.out);
  // the bed (the moods) and the stingers: the bed bows out while a stinger plays
  E.bed = ctx.createGain(); E.bed.connect(E.out);
  E.bedWet = ctx.createGain(); E.bedWet.connect(E.revIn);
  E.sting = ctx.createGain(); E.sting.gain.value = 0.9; E.sting.connect(E.out);
  E.stingWet = ctx.createGain(); E.stingWet.gain.value = 0.45; E.sting.connect(E.stingWet).connect(E.revIn);
  // two seconds of noise for breath, skins and swells
  const len = ctx.sampleRate * 2, nb = ctx.createBuffer(1, len, ctx.sampleRate), d = nb.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  E.noise = nb;
  // plucked strings (Karplus-Strong), one per octave, re-pitched within half an octave
  E.ks = [[36, 3.6, 0.5, 0.9985], [48, 3.2, 0.42, 0.998], [60, 2.8, 0.38, 0.9972], [72, 2.2, 0.36, 0.996], [84, 1.6, 0.34, 0.994]].map(([m, sec, soft, dec]) => musicPluckBuffer(ctx, m, sec, soft, dec));
  return E;
}
function musicImpulse(ctx, sec) {
  const sr = ctx.sampleRate, n = Math.floor(sr * sec), buf = ctx.createBuffer(2, n, sr);
  const pre = Math.floor(sr * 0.014), decay = 6.9 / sec;
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    for (let k = 0; k < 10; k++) {
      const at = pre + Math.floor(sr * (0.003 + Math.random() * 0.07));
      if (at < n) d[at] += (Math.random() < 0.5 ? -1 : 1) * (0.7 - k * 0.05);
    }
    let lp = 0;
    for (let i = pre; i < n; i++) {
      const tt = (i - pre) / sr;
      const env = Math.exp(-decay * tt) * Math.min(1, tt / 0.04);
      const k = 0.62 * Math.exp(-tt * 1.6) + 0.035; // bright at first, darker as it fades
      lp += (Math.random() * 2 - 1 - lp) * k;
      d[i] += lp * env * 0.7;
    }
  }
  return buf;
}
function musicPluckBuffer(ctx, m, sec, soft, decay) {
  const sr = ctx.sampleRate, f = mtof(m), N = Math.max(4, Math.round(sr / f - 0.5));
  const n = Math.floor(sr * sec), buf = ctx.createBuffer(1, n, sr), d = buf.getChannelData(0);
  let lp = 0, mean = 0;
  for (let i = 0; i < N; i++) { lp += (Math.random() * 2 - 1 - lp) * soft; d[i] = lp; mean += lp; }
  mean /= N;
  for (let i = 0; i < N; i++) d[i] -= mean;
  d[N] = decay * d[0];
  for (let i = N + 1; i < n; i++) d[i] = decay * 0.5 * (d[i - N] + d[i - N - 1]);
  let pk = 1e-6;
  for (let i = 0; i < n; i++) pk = Math.max(pk, Math.abs(d[i]));
  for (let i = 0; i < n; i++) d[i] *= 0.9 / pk;
  return { m, buf, f: sr / (N + 0.5) };
}
// every voice is counted while it sounds and lets go of its nodes when it ends
function musTrack(E, src, nodes, links) {
  E.live++; E.nodes += nodes.length; E.made++;
  if (E.live > E.peak) E.peak = E.live;
  src.onended = () => {
    E.live--; E.nodes -= nodes.length;
    for (const nd of nodes) { try { nd.disconnect(); } catch (e) { /* already gone */ } }
    if (links) for (const [a, p] of links) { try { a.disconnect(p); } catch (e) { /* already gone */ } }
  };
}
// attack to the peak, ease to a sustain, release from the end of the note; returns when it is silent
function musEnv(p, t, a, peak, hold, r, sus = 0.85) {
  const h = Math.max(a + 0.01, hold);
  p.setValueAtTime(0, t);
  p.linearRampToValueAtTime(peak, t + a);
  p.setTargetAtTime(peak * sus, t + a, Math.max(0.05, (h - a) * 0.45));
  p.setTargetAtTime(0, t + h, r / 5);
  return t + h + r;
}

/* ------------------------------------------------------------------ */
/* instruments: each schedules one note and returns when it is over    */
/* ------------------------------------------------------------------ */
const MUS_BELL = [[0.5, 0.45, 1], [1, 1, 0.8], [1.19, 0.6, 0.6], [1.5, 0.35, 0.45], [2, 0.5, 0.4], [2.52, 0.25, 0.28], [2.66, 0.2, 0.24], [3.01, 0.16, 0.2], [4.16, 0.1, 0.14]];
const MUS_VOWEL = { ah: [[730, 1], [1090, 0.5], [2440, 0.18]], oo: [[310, 1], [870, 0.32], [2250, 0.06]], eh: [[530, 1], [1840, 0.4], [2480, 0.2]] };
const MUS_INS = {
  // bowed strings: two detuned saws through a filter that opens with the bow, on the piece's shared vibrato
  strings(E, dst, t, m, dur, v, o = {}) {
    const ctx = E.ctx, f = mtof(m), a = o.a ?? 0.32, r = o.r ?? 0.7;
    const lp = ctx.createBiquadFilter(), g = ctx.createGain();
    lp.type = 'lowpass'; lp.Q.value = 0.5;
    const fc = Math.min(8000, (420 + f * 2.4 + 1500 * v) * (o.bright ?? 1));
    lp.frequency.setValueAtTime(fc * 0.5, t);
    lp.frequency.linearRampToValueAtTime(fc, t + a * 1.5 + 0.02);
    const end = musEnv(g.gain, t, a, v * 0.07 * (o.gain ?? 1), dur, r, o.sus ?? 0.85);
    lp.connect(g).connect(dst);
    const nodes = [lp, g], links = [];
    const n = E.lite ? 1 : 2;
    let src = null;
    for (let i = 0; i < n; i++) {
      const os = ctx.createOscillator();
      os.type = 'sawtooth'; os.frequency.value = f;
      os.detune.value = n > 1 ? (i ? 6 : -6) + (E.rnd() - 0.5) * 3 : 0;
      if (o.vib) { o.vib.connect(os.detune); links.push([o.vib, os.detune]); }
      os.connect(lp); os.start(t); os.stop(end + 0.02);
      nodes.push(os); src = src || os;
    }
    musTrack(E, src, nodes, links);
    return end;
  },
  // brass: the filter blares open on the attack and the pitch scoops up into the note
  brass(E, dst, t, m, dur, v, o = {}) {
    const ctx = E.ctx, f = mtof(m), a = o.a ?? 0.06, r = o.r ?? 0.3, dark = o.dark ?? 1;
    const lp = ctx.createBiquadFilter(), g = ctx.createGain();
    lp.type = 'lowpass'; lp.Q.value = 1.1;
    const top = Math.min(9000, (500 + f * 3.2 + 2600 * v) * dark), body = Math.min(6000, (300 + f * 2 + 900 * v) * dark);
    const h = Math.max(a + 0.01, dur);
    lp.frequency.setValueAtTime(140, t);
    lp.frequency.linearRampToValueAtTime(top, t + a + 0.05);
    lp.frequency.setTargetAtTime(body, t + a + 0.05, 0.25);
    lp.frequency.setTargetAtTime(180, t + h, r / 4);
    const end = musEnv(g.gain, t, a, v * 0.075 * (o.gain ?? 1), dur, r, 0.78);
    lp.connect(g).connect(dst);
    const nodes = [lp, g], links = [];
    const n = E.lite ? 1 : 2;
    let src = null;
    for (let i = 0; i < n; i++) {
      const os = ctx.createOscillator(), det = n > 1 ? (i ? 5 : -5) : 0;
      os.type = 'sawtooth'; os.frequency.value = f;
      os.detune.setValueAtTime(det - 24, t);
      os.detune.linearRampToValueAtTime(det, t + 0.07);
      os.connect(lp); os.start(t); os.stop(end + 0.02);
      nodes.push(os); src = src || os;
    }
    musTrack(E, src, nodes, links);
    return end;
  },
  // a plucked string: harp, or pizzicato low down
  pluck(E, dst, t, m, dur, v, o = {}) {
    const ctx = E.ctx;
    let k = 0;
    for (let i = 1; i < E.ks.length; i++) if (Math.abs(E.ks[i].m - m) < Math.abs(E.ks[k].m - m)) k = i;
    const K = E.ks[k], s = ctx.createBufferSource(), lp = ctx.createBiquadFilter(), g = ctx.createGain();
    s.buffer = K.buf;
    s.playbackRate.value = mtof(m) / K.f;
    lp.type = 'lowpass'; lp.Q.value = 0.3;
    lp.frequency.value = Math.min(12000, (900 + 5200 * v) * (o.bright ?? 1));
    const len = Math.min(dur, K.buf.duration / s.playbackRate.value);
    g.gain.setValueAtTime(v * 0.36 * (o.gain ?? 1), t);
    g.gain.setTargetAtTime(0, t + len, 0.07);
    s.connect(lp).connect(g).connect(dst);
    s.start(t); s.stop(t + len + 0.45);
    musTrack(E, s, [s, lp, g]);
    return t + len;
  },
  // a wooden pipe: a pure tone with a little reed, breath, vibrato that grows into long notes, and cuts
  pipe(E, dst, t, m, dur, v, o = {}) {
    const ctx = E.ctx, f = mtof(m);
    const os = ctx.createOscillator(), o2 = ctx.createOscillator(), g2 = ctx.createGain(), g = ctx.createGain();
    os.type = 'sine'; o2.type = 'triangle';
    if (o.cut) {
      const fc = mtof(o.cut);
      os.frequency.setValueAtTime(fc, t); os.frequency.setValueAtTime(f, t + 0.05);
      o2.frequency.setValueAtTime(fc * 2, t); o2.frequency.setValueAtTime(f * 2, t + 0.05);
    } else { os.frequency.value = f; o2.frequency.value = f * 2; }
    g2.gain.value = 0.14;
    const lfo = ctx.createOscillator(), lg = ctx.createGain();
    lfo.frequency.value = 5.1 + E.rnd() * 0.8;
    lg.gain.setValueAtTime(0, t);
    lg.gain.setValueAtTime(0, t + Math.min(0.3, dur * 0.5));
    lg.gain.linearRampToValueAtTime(dur > 0.45 ? 13 : 3, t + Math.max(dur, 0.36));
    lfo.connect(lg); lg.connect(os.detune); lg.connect(o2.detune);
    const ns = ctx.createBufferSource(), bp = ctx.createBiquadFilter(), ng = ctx.createGain();
    ns.buffer = E.noise; ns.loop = true;
    bp.type = 'bandpass'; bp.frequency.value = Math.min(9000, f * 2.2); bp.Q.value = 1.4;
    ng.gain.value = 0.2;
    ns.connect(bp).connect(ng).connect(g);
    os.connect(g); o2.connect(g2).connect(g); g.connect(dst);
    const end = musEnv(g.gain, t, o.a ?? 0.035, v * 0.12 * (o.gain ?? 1), dur, o.r ?? 0.09, 0.9);
    for (const s of [os, o2, lfo]) { s.start(t); s.stop(end + 0.02); }
    ns.start(t, E.rnd() * 1.5); ns.stop(end + 0.02);
    musTrack(E, os, [os, o2, g2, g, lfo, lg, ns, bp, ng]);
    return end;
  },
  // drums: a pitched body that drops, and the slap of the skin
  drum(E, dst, t, kind, v, o = {}) {
    const ctx = E.ctx, nodes = [];
    const g = ctx.createGain(); g.gain.value = 1; g.connect(dst); nodes.push(g);
    let src = null, end = t + 0.3;
    const body = (f0, f1, drop, dec, amp, type = 'sine') => {
      const os = ctx.createOscillator(), og = ctx.createGain();
      os.type = type;
      os.frequency.setValueAtTime(f0, t);
      os.frequency.exponentialRampToValueAtTime(f1, t + drop);
      og.gain.setValueAtTime(0, t);
      og.gain.linearRampToValueAtTime(amp * v, t + 0.004);
      og.gain.setTargetAtTime(0, t + 0.004, dec / 5);
      os.connect(og).connect(g);
      os.start(t); os.stop(t + dec + 0.05);
      nodes.push(os, og); src = src || os;
      end = Math.max(end, t + dec + 0.05);
    };
    const skin = (type, f, q, dec, amp) => {
      const ns = ctx.createBufferSource(), fl = ctx.createBiquadFilter(), ng = ctx.createGain();
      ns.buffer = E.noise;
      fl.type = type; fl.frequency.value = f; fl.Q.value = q;
      ng.gain.setValueAtTime(amp * v, t);
      ng.gain.setTargetAtTime(0, t, dec / 4);
      ns.connect(fl).connect(ng).connect(g);
      ns.start(t, E.rnd() * 1.6); ns.stop(t + dec + 0.05);
      nodes.push(ns, fl, ng); src = src || ns;
      end = Math.max(end, t + dec + 0.05);
    };
    switch (kind) {
      case 'deep': body(70, 41, 0.45, 1.3, 0.55); body(112, 66, 0.3, 0.5, 0.12); skin('lowpass', 320, 0.7, 0.14, 0.35); break;
      case 'frame': body(158, 96, 0.1, 0.32, 0.32); skin('bandpass', 1050, 0.8, 0.07, 0.16); break;
      case 'tip': body(230, 170, 0.05, 0.12, 0.14); skin('bandpass', 2400, 1.2, 0.04, 0.1); break;
      case 'timp': { const f = mtof(o.m ?? 38); body(f * 1.015, f, 0.25, 1.9, 0.42); body(f * 1.52, f * 1.5, 0.2, 0.9, 0.13); skin('lowpass', 700, 0.6, 0.06, 0.18); } break;
      case 'tom': body(126, 74, 0.22, 0.5, 0.42); skin('bandpass', 520, 0.9, 0.09, 0.2); break;
      case 'snare': body(205, 180, 0.05, 0.09, 0.12, 'triangle'); skin('highpass', 1300, 0.7, 0.17, 0.3); skin('bandpass', 3200, 0.9, 0.1, 0.12); break;
      case 'hat': skin('highpass', 7200, 0.7, 0.045, 0.1); break;
      default: break;
    }
    musTrack(E, src, nodes);
    return end;
  },
  // a sung drone with a whistle above it: the pressed voice, a growl an octave down, and an overtone walking
  // over the harmonics of the drone
  throat(E, dst, t, m, dur, v, o = {}) {
    const ctx = E.ctx, f = mtof(m);
    const os = ctx.createOscillator(), sub = ctx.createOscillator();
    os.type = 'sawtooth'; os.frequency.value = f;
    sub.type = 'sawtooth'; sub.frequency.value = f / 2;
    const body = ctx.createBiquadFilter(); body.type = 'lowpass'; body.frequency.value = 560; body.Q.value = 2.2;
    const subLp = ctx.createBiquadFilter(); subLp.type = 'lowpass'; subLp.frequency.value = 170;
    const sg = ctx.createGain(); sg.gain.value = o.growl ?? 0.4;
    const ot = ctx.createBiquadFilter(); ot.type = 'bandpass'; ot.Q.value = 24;
    const og = ctx.createGain(); og.gain.value = o.whistle ?? 3.4;
    const g = ctx.createGain();
    os.connect(body).connect(g); os.connect(ot).connect(og).connect(g); sub.connect(subLp).connect(sg).connect(g);
    g.connect(dst);
    let tt = t, h = pick(E.rnd, [8, 9, 10]);
    ot.frequency.setValueAtTime(f * h, t);
    while (tt < t + dur) {
      tt += 0.6 + E.rnd() * 1.7;
      const steps = [6, 7, 8, 9, 10, 12].filter((x) => Math.abs(x - h) <= 3 && x !== h);
      h = pick(E.rnd, steps.length ? steps : [8]);
      ot.frequency.setTargetAtTime(f * h, tt, 0.08);
    }
    const end = musEnv(g.gain, t, o.a ?? 1.4, v * 0.1, dur, o.r ?? 2.2, 0.92);
    for (const s of [os, sub]) { s.start(t); s.stop(end + 0.02); }
    musTrack(E, os, [os, sub, body, subLp, sg, ot, og, g]);
    return end;
  },
  // a bell: inharmonic partials, the high ones dying first
  bell(E, dst, t, m, dur, v, o = {}) {
    const ctx = E.ctx, f = mtof(m), len = dur;
    const P = E.lite ? MUS_BELL.slice(0, 5) : MUS_BELL;
    const g = ctx.createGain(); g.gain.value = v * 0.055 * (o.gain ?? 1); g.connect(dst);
    const nodes = [g];
    let src = null;
    for (const [ra, am, dc] of P) {
      const os = ctx.createOscillator(), pg = ctx.createGain();
      os.frequency.value = f * ra * (1 + (E.rnd() - 0.5) * 0.003);
      pg.gain.setValueAtTime(0, t);
      pg.gain.linearRampToValueAtTime(am, t + 0.006);
      pg.gain.setTargetAtTime(0, t + 0.006, (dc * len) / 4);
      os.connect(pg).connect(g);
      os.start(t); os.stop(t + len + 0.1);
      nodes.push(os, pg); src = src || os;
    }
    musTrack(E, src, nodes);
    return t + len;
  },
  // voices: saws through the formants of a vowel
  choir(E, dst, t, m, dur, v, o = {}) {
    const ctx = E.ctx, f = mtof(m), vw = MUS_VOWEL[o.vowel || 'ah'];
    const mix = ctx.createGain(), g = ctx.createGain();
    const nodes = [mix, g], links = [];
    for (const [F, A] of vw) {
      const bp = ctx.createBiquadFilter(), fg = ctx.createGain();
      bp.type = 'bandpass'; bp.frequency.value = F; bp.Q.value = F / 110;
      fg.gain.value = A * 3.2;
      mix.connect(bp).connect(fg).connect(g);
      nodes.push(bp, fg);
    }
    g.connect(dst);
    const end = musEnv(g.gain, t, o.a ?? 0.9, v * 0.11 * (o.gain ?? 1), dur, o.r ?? 1.3, 0.92);
    const n = E.lite ? 1 : 2;
    let src = null;
    for (let i = 0; i < n; i++) {
      const os = ctx.createOscillator();
      os.type = 'sawtooth'; os.frequency.value = f;
      os.detune.value = n > 1 ? (i ? 8 : -8) : 0;
      if (o.vib) { o.vib.connect(os.detune); links.push([o.vib, os.detune]); }
      os.connect(mix); os.start(t); os.stop(end + 0.02);
      nodes.push(os); src = src || os;
    }
    musTrack(E, src, nodes, links);
    return end;
  },
  // a soft pad for the night
  pad(E, dst, t, m, dur, v, o = {}) {
    const ctx = E.ctx, f = mtof(m);
    const lp = ctx.createBiquadFilter(), g = ctx.createGain();
    lp.type = 'lowpass'; lp.frequency.value = 700 + 700 * v; lp.Q.value = 0.4;
    const end = musEnv(g.gain, t, o.a ?? 1.6, v * 0.12, dur, o.r ?? 2.2, 0.9);
    lp.connect(g).connect(dst);
    const nodes = [lp, g];
    const n = E.lite ? 1 : 2;
    let src = null;
    for (let i = 0; i < n; i++) {
      const os = ctx.createOscillator();
      os.type = 'triangle'; os.frequency.value = f; os.detune.value = n > 1 ? (i ? 7 : -7) : 0;
      os.connect(lp); os.start(t); os.stop(end + 0.02);
      nodes.push(os); src = src || os;
    }
    musTrack(E, src, nodes);
    return end;
  },
  // a glassy chime
  celesta(E, dst, t, m, dur, v, o = {}) {
    const ctx = E.ctx, f = mtof(m);
    const g = ctx.createGain(); g.gain.value = v * 0.09 * (o.gain ?? 1); g.connect(dst);
    const nodes = [g];
    let src = null;
    for (const [ra, am, dc] of [[1, 1, 1], [2, 0.22, 0.45], [4.01, 0.16, 0.16]]) {
      const os = ctx.createOscillator(), pg = ctx.createGain();
      os.frequency.value = f * ra;
      pg.gain.setValueAtTime(0, t);
      pg.gain.linearRampToValueAtTime(am, t + 0.004);
      pg.gain.setTargetAtTime(0, t + 0.004, (dc * dur) / 4);
      os.connect(pg).connect(g); os.start(t); os.stop(t + dur + 0.05);
      nodes.push(os, pg); src = src || os;
    }
    musTrack(E, src, nodes);
    return t + dur;
  },
  // bowed bass
  bass(E, dst, t, m, dur, v, o = {}) {
    const ctx = E.ctx, f = mtof(m);
    const os = ctx.createOscillator(), lp = ctx.createBiquadFilter(), g = ctx.createGain();
    os.type = 'sawtooth'; os.frequency.value = f;
    lp.type = 'lowpass'; lp.frequency.value = 170 + f * 2.2 + 300 * v; lp.Q.value = 0.8;
    const end = musEnv(g.gain, t, o.a ?? 0.07, v * 0.15 * (o.gain ?? 1), dur, o.r ?? 0.35, o.sus ?? 0.8);
    os.connect(lp).connect(g).connect(dst);
    os.start(t); os.stop(end + 0.02);
    musTrack(E, os, [os, lp, g]);
    return end;
  },
  // a low drone through a slowly breathing filter
  drone(E, dst, t, m, dur, v, o = {}) {
    const ctx = E.ctx, f = mtof(m);
    const os = ctx.createOscillator(), o2 = ctx.createOscillator(), lp = ctx.createBiquadFilter(), g = ctx.createGain();
    os.type = 'sawtooth'; os.frequency.value = f; os.detune.value = -4;
    o2.type = o.reed ? 'square' : 'sawtooth'; o2.frequency.value = f; o2.detune.value = 5;
    lp.type = 'lowpass'; lp.Q.value = o.reed ? 3 : 1.2;
    const c0 = o.cut ?? 320;
    lp.frequency.setValueAtTime(c0 * 0.7, t);
    let tt = t;
    while (tt < t + dur) { tt += 1.5 + E.rnd() * 2; lp.frequency.setTargetAtTime(c0 * (0.6 + E.rnd() * 0.8), tt, 0.9); }
    const end = musEnv(g.gain, t, o.a ?? 2.2, v * 0.08, dur, o.r ?? 2.5, 0.95);
    os.connect(lp); o2.connect(lp); lp.connect(g).connect(dst);
    for (const s of [os, o2]) { s.start(t); s.stop(end + 0.02); }
    musTrack(E, os, [os, o2, lp, g]);
    return end;
  },
  // filtered noise rising (a cymbal swell or a gust)
  swell(E, dst, t, dur, v, f0, f1, q = 0.8, type = 'bandpass') {
    const ctx = E.ctx, ns = ctx.createBufferSource(), fl = ctx.createBiquadFilter(), g = ctx.createGain();
    ns.buffer = E.noise; ns.loop = true;
    fl.type = type; fl.Q.value = q;
    fl.frequency.setValueAtTime(f0, t);
    fl.frequency.exponentialRampToValueAtTime(f1, t + dur);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(v * 0.1, t + dur * 0.85);
    g.gain.setTargetAtTime(0, t + dur * 0.85, 0.12);
    ns.connect(fl).connect(g).connect(dst);
    ns.start(t, E.rnd()); ns.stop(t + dur + 0.7);
    musTrack(E, ns, [ns, fl, g]);
    return t + dur + 0.6;
  },
};

/* ------------------------------------------------------------------ */
/* harmony: modes, chords, progressions, voice-leading                 */
/* ------------------------------------------------------------------ */
const MUS_MODES = { major: [0, 2, 4, 5, 7, 9, 11], dorian: [0, 2, 3, 5, 7, 9, 10], mixo: [0, 2, 4, 5, 7, 9, 10], aeolian: [0, 2, 3, 5, 7, 8, 10], phrygian: [0, 1, 3, 5, 7, 8, 10] };
const MUS_Q = { maj: [0, 4, 7], min: [0, 3, 7], sus2: [0, 2, 7], sus4: [0, 5, 7], five: [0, 7], maj7: [0, 4, 7, 11], min7: [0, 3, 7, 10], add9: [0, 4, 7, 2], madd9: [0, 3, 7, 2] };
const MUS_CH = {
  I: [0, 'maj'], Iadd: [0, 'add9'], Isus: [0, 'sus4'], ii: [2, 'min'], ii7: [2, 'min7'], iii: [4, 'min'], IV: [5, 'maj'], IVmaj7: [5, 'maj7'],
  V: [7, 'maj'], Vsus: [7, 'sus4'], vi: [9, 'min'], vi7: [9, 'min7'], bVII: [10, 'maj'], bVI: [8, 'maj'],
  i: [0, 'min'], iadd: [0, 'madd9'], i5: [0, 'five'], isus2: [0, 'sus2'], i7: [0, 'min7'], iv: [5, 'min'], iv7: [5, 'min7'], v: [7, 'min'], v5: [7, 'five'],
  VI: [8, 'maj'], VImaj7: [8, 'maj7'], VII: [10, 'maj'], III: [3, 'maj'], bII: [1, 'maj'], II: [2, 'maj'],
};
function musChord(key, name) {
  const [r, q] = MUS_CH[name] || MUS_CH.I, root = (key + r) % 12;
  return { name, root, pcs: MUS_Q[q].map((x) => (root + x) % 12), q };
}
function musWPick(rnd, opts) {
  let s = 0;
  for (const o of opts) s += o[1];
  let x = rnd() * s;
  for (const o of opts) { x -= o[1]; if (x <= 0) return o[0]; }
  return opts[0][0];
}
// a walk through the mood's chord graph, closed by a cadence (or a half cadence that asks for an answer)
function musProg(rnd, G, len, half, fromHome) {
  const keys = Object.keys(G.graph);
  const seq = [fromHome || rnd() < 0.7 ? G.home : pick(rnd, keys)];
  while (seq.length < len - 2) seq.push(musWPick(rnd, G.graph[seq[seq.length - 1]] || G.graph[G.home]));
  return seq.concat(pick(rnd, half ? G.half : G.cad));
}
const musPc = (m) => ((m % 12) + 12) % 12;
// voices move to the nearest tones of the next chord; the chord stays complete and the voices keep apart
function musVoice(prev, ch, lo, hi, n, rnd) {
  const cand = [];
  for (let m = lo; m <= hi; m++) if (ch.pcs.includes(musPc(m))) cand.push(m);
  if (!cand.length) return [];
  if (!prev || prev.length !== n) {
    const s = Math.max(0, cand.findIndex((m) => m >= lo + 3));
    const out = [];
    for (let i = 0; i < n; i++) out.push(cand[Math.min(cand.length - 1, s + i)]);
    return out;
  }
  const opts = prev.map((p) => cand.filter((c) => Math.abs(c - p) <= 7));
  const cur = new Array(n);
  let best = null, bestS = 1e9;
  const third = ch.pcs.length > 2 ? ch.pcs[1] : -1;
  const rec = (i, last) => {
    if (i === n) {
      let s = 0;
      for (let k = 0; k < n; k++) s += Math.abs(cur[k] - prev[k]);
      const have = cur.map(musPc);
      for (let j = 0; j < Math.min(3, ch.pcs.length); j++) if (!have.includes(ch.pcs[j])) s += j === 2 ? 3 : 7;
      if (third >= 0 && have.filter((x) => x === third).length > 1) s += 3;
      for (let k = 1; k < n; k++) if (cur[k] - cur[k - 1] > 12) s += 4;
      for (let a = 0; a < n; a++) {
        for (let b = a + 1; b < n; b++) {
          const i0 = musPc(prev[b] - prev[a]), i1 = musPc(cur[b] - cur[a]);
          if (cur[a] !== prev[a] && i0 === i1 && (i1 === 7 || i1 === 0)) s += 2.5; // parallel fifths and octaves
        }
      }
      s += rnd() * 0.6;
      if (s < bestS) { bestS = s; best = cur.slice(); }
      return;
    }
    for (const c of opts[i]) { if (c <= last) continue; cur[i] = c; rec(i + 1, c); }
  };
  rec(0, -1);
  return best || musVoice(null, ch, lo, hi, n, rnd);
}
// the mode's scale over a chord, with any chord tone that clashes put in its place
function musScale(key, mode, ch) {
  const pcs = MUS_MODES[mode].map((x) => (key + x) % 12);
  for (const c of ch.pcs) {
    if (pcs.includes(c)) continue;
    let bi = 0, bd = 99;
    pcs.forEach((p, i) => { const d = Math.min(musPc(p - c), musPc(c - p)); if (d < bd) { bd = d; bi = i; } });
    pcs[bi] = c;
  }
  return pcs;
}
function musLadder(pcs, lo, hi) { const L = []; for (let m = lo; m <= hi; m++) if (pcs.includes(musPc(m))) L.push(m); return L; }
function musNearest(list, m) { let b = list[0]; for (const x of list) if (Math.abs(x - m) < Math.abs(b - m)) b = x; return b; }

/* ------------------------------------------------------------------ */
/* melody: motifs, variation, cadence                                  */
/* ------------------------------------------------------------------ */
const MUS_RH44 = [
  [[0, 1.5], [1.5, 0.5], [2, 2]], [[0, 1], [1, 1], [2, 1.5], [3.5, 0.5]], [[0, 2], [2, 1], [3, 1]], [[0, 0.5], [0.5, 0.5], [1, 1], [2, 2]],
  [[0, 1], [1, 0.5], [1.5, 0.5], [2, 2]], [[0, 3], [3, 1]], [[0, 1.5], [1.5, 0.5], [2, 1], [3, 1]], [[1, 1], [2, 1], [3, 1]],
];
const MUS_CAD44 = [[[0, 1], [1, 1], [2, 2]], [[0, 2], [2, 2]], [[0, 0.5], [0.5, 0.5], [1, 3]], [[0, 1.5], [1.5, 0.5], [2, 2]]];
const MUS_RH68 = [[[0, 2], [2, 1], [3, 2], [5, 1]], [[0, 1], [1, 1], [2, 1], [3, 3]], [[0, 3], [3, 1], [4, 1], [5, 1]], [[0, 1], [1, 2], [3, 1], [4, 2]], [[0, 2], [2, 1], [3, 1], [4, 1], [5, 1]], [[0, 1], [1, 1], [2, 1], [3, 2], [5, 1]]];
const MUS_CAD68 = [[[0, 1], [1, 1], [2, 1], [3, 3]], [[0, 3], [3, 3]], [[0, 2], [2, 1], [3, 3]]];
function musMotif(rnd, M) {
  const rh = pick(rnd, M.rhythms), steps = [0];
  let s = 0, lastLeap = 0;
  for (let i = 1; i < rh.length; i++) {
    let d;
    if (lastLeap) d = -Math.sign(lastLeap) * pick(rnd, [1, 1, 2]); // after a leap, step back
    else if (rnd() < 0.22) d = pick(rnd, [-4, -3, 3, 4, 5]);
    else d = pick(rnd, [-2, -1, -1, 1, 1, 2]);
    lastLeap = Math.abs(d) >= 3 ? d : 0;
    s = clamp(s + d, -5, 6);
    steps.push(s);
  }
  return { rh, steps };
}
function musVary(rnd, mo) {
  const k = Math.floor(rnd() * 4);
  if (k === 0) return { rh: mo.rh, steps: mo.steps.map((x) => -x) }; // inverted
  if (k === 1) { const st = mo.steps.slice().reverse(); return { rh: mo.rh, steps: st.map((x) => x - st[0]) }; } // backwards
  if (k === 2) { // a long note split in two, a neighbour tone between
    let li = 0;
    mo.rh.forEach((r, i) => { if (r[1] > mo.rh[li][1]) li = i; });
    const [b, d] = mo.rh[li];
    if (d < 1) return mo;
    const rh = mo.rh.slice(0, li).concat([[b, d / 2], [b + d / 2, d / 2]], mo.rh.slice(li + 1));
    const steps = mo.steps.slice(0, li + 1).concat([mo.steps[li] + pick(rnd, [-1, 1])], mo.steps.slice(li + 1));
    return { rh, steps };
  }
  return { rh: mo.rh, steps: mo.steps.map((x, i) => (i >= mo.steps.length / 2 ? x + pick(rnd, [-1, 1]) : x)) }; // second half shifted
}
// one bar of a four-bar phrase: the motif, the motif sequenced onto the new chord, a variation, a cadence
function musMelodyBar(E, p, t, c, ins, v, o = {}) {
  const S = p.S, M = p.M || S.mel, rnd = E.rnd, pb = c.i % 4;
  if (pb === 0 && (!p.motif || rnd() < 0.4)) p.motif = musMotif(rnd, M);
  if (!p.motif) p.motif = musMotif(rnd, M);
  const ch = c.ch, L = musLadder(musScale(p.key, p.mode, ch), M.lo - 4, M.hi + 4);
  const tones = L.filter((m) => ch.pcs.includes(musPc(m)) && m >= M.lo && m <= M.hi);
  if (!L.length || !tones.length) return;
  let from = p.melLast ?? M.center;
  if (from > M.hi - 3) from -= 5;
  if (from < M.lo + 3) from += 5;
  const notes = [];
  if (pb === 3) {
    // the cadence: walk by step to the goal (the root at a close, the third or fifth at a half close)
    const rh = pick(rnd, M.cad);
    const goalPc = c.end ? ch.root : ch.pcs[1 + Math.floor(rnd() * Math.min(2, ch.pcs.length - 1))];
    const goals = tones.filter((m) => musPc(m) === goalPc);
    const goal = musNearest(goals.length ? goals : tones, from);
    const gi = L.indexOf(goal), dir = from > goal ? 1 : -1;
    rh.forEach((r, k) => { const back = rh.length - 1 - k; notes.push([r[0], r[1], L[clamp(gi + dir * back, 0, L.length - 1)]]); });
  } else {
    const mo = pb === 2 ? musVary(rnd, p.motif) : p.motif;
    const a0 = musNearest(tones, from + (pb === 1 ? pick(rnd, [-2, 2]) : 0));
    const ai = L.indexOf(a0);
    mo.rh.forEach((r, k) => {
      let m = L[clamp(ai + mo.steps[k], 0, L.length - 1)];
      if (r[0] % (M.strong || 2) === 0 && !ch.pcs.includes(musPc(m))) m = musNearest(tones, m); // strong beats on chord tones
      if (k > 0 && k < mo.rh.length - 1 && rnd() < (M.rest || 0)) return;
      notes.push([r[0], r[1], m]);
    });
  }
  for (let k = 0; k < notes.length; k++) {
    const [b, d, m] = notes[k];
    const oo = { ...o };
    if (M.cuts && d >= 1.5 && rnd() < M.cuts) { const up = L[Math.min(L.length - 1, L.indexOf(m) + 1)]; if (up > m) oo.cut = up; }
    const acc = b === 0 ? 1 : b % 2 === 0 ? 0.9 : 0.8;
    MUS_INS[ins](E, p.dst || p.in, t + b * c.beat + (k ? (rnd() - 0.5) * 0.012 : 0), m, d * c.beat * (M.legato || 0.95), v * acc * (0.92 + rnd() * 0.08), oo);
    p.melLast = m;
  }
}

/* ------------------------------------------------------------------ */
/* shared parts                                                         */
/* ------------------------------------------------------------------ */
function musPad(E, p, key, t, c, ins, lo, hi, n, v, o = {}, dst = p.in) {
  const vo = (p.vo[key] = musVoice(p.vo[key], c.ch, lo, hi, n, E.rnd));
  for (const m of vo) MUS_INS[ins](E, dst, t + E.rnd() * 0.02, m, o.dur ?? c.bar + 0.05, v, o);
  return vo;
}
function musRoot(p, c, lo, hi, key = 'bass') {
  const last = p.vo[key + 'Last'] ?? (lo + hi) / 2;
  let best = null;
  for (let m = lo; m <= hi; m++) if (musPc(m) === c.ch.root && (best === null || Math.abs(m - last) < Math.abs(best - last))) best = m;
  p.vo[key + 'Last'] = best;
  return best;
}
function musArp(E, p, t, c, pat, lo, hi, v, o = {}, dst = p.in) {
  const L = [];
  for (let m = lo; m <= hi; m++) if (c.ch.pcs.includes(musPc(m))) L.push(m);
  if (!L.length) return;
  pat.forEach(([b, idx, ring], k) => MUS_INS.pluck(E, dst, t + b * c.beat + (k ? (E.rnd() - 0.5) * 0.01 : 0), L[Math.min(L.length - 1, idx)], ring ?? 2.4, v * (k === 0 ? 1 : 0.78 + E.rnd() * 0.2), o));
}
function musDrums(E, p, t, c, pat, v, dst = p.in) {
  for (const [b, kind, vel, m] of pat) if (vel > 0) MUS_INS.drum(E, dst, t + b * c.beat + (b ? (E.rnd() - 0.5) * 0.01 : 0), kind, vel * v * (0.88 + E.rnd() * 0.2), { m });
}
// a horn call: a few notes leaping between the chord's tones, the last one held
function musCall(E, p, t, c, lo, hi, v, o, dst = p.in) {
  const L = [];
  for (let m = lo; m <= hi; m++) if (c.ch.pcs.includes(musPc(m))) L.push(m);
  if (L.length < 2) return;
  let i = Math.floor(E.rnd() * Math.min(2, L.length));
  const n = 2 + Math.floor(E.rnd() * 3), rh = pick(E.rnd, [[0, 0.75, 1.5, 2.25], [0, 0.5, 1, 2], [0, 1, 1.5, 2]]);
  for (let k = 0; k < n; k++) {
    const last = k === n - 1;
    MUS_INS.brass(E, dst, t + rh[k] * c.beat, L[i], last ? c.beat * 2.2 : c.beat * 0.6, v * (last ? 0.9 : 0.75), o);
    i = clamp(i + pick(E.rnd, [1, 1, 2, -1]), 0, L.length - 1);
  }
}
const MUS_ARP44 = [
  [[0, 0], [0.5, 2], [1, 4], [1.5, 5], [2, 6], [2.5, 5], [3, 4], [3.5, 2]],
  [[0, 1], [0.5, 3], [1, 5], [1.5, 7], [2, 6], [2.5, 4], [3, 3], [3.5, 5]],
  [[0, 0, 3.5], [1, 3], [1.5, 4], [2, 5], [3, 4], [3.5, 3]],
];
const MUS_ARP68 = [[[0, 0, 2.6], [1, 2], [2, 4], [3, 5], [4, 4], [5, 2]], [[0, 1, 2.6], [1, 3], [2, 5], [3, 6], [4, 5], [5, 3]], [[0, 0, 2.6], [1, 4], [2, 3], [3, 5], [4, 3], [5, 4]]];

/* ------------------------------------------------------------------ */
/* the moods                                                            */
/* ------------------------------------------------------------------ */
const MUS_G_MINOR = {
  home: 'i',
  graph: { i: [['VI', 3], ['iv', 2], ['VII', 2], ['III', 1.5]], VI: [['VII', 3], ['iv', 2], ['III', 1.5], ['i', 1]], VII: [['i', 2], ['III', 3], ['VI', 1]], III: [['VI', 2], ['iv', 2], ['VII', 2]], iv: [['i', 2], ['VII', 2], ['VI', 1], ['v', 1]], v: [['VI', 2], ['i', 2]] },
  cad: [['VII', 'i'], ['iv', 'i'], ['V', 'i']], half: [['iv', 'V'], ['VI', 'VII'], ['i', 'V']],
};
const MUS_MOODS = {
  title: {
    key: 2, mode: 'aeolian', bpm: 60, beats: 4, wet: 0.55, gain: 1.0, ...MUS_G_MINOR,
    mel: { lo: 62, hi: 81, center: 70, rhythms: MUS_RH44, cad: MUS_CAD44, rest: 0.08 },
    tex: [{ pad: 1, bass: 1 }, { pad: 1, bass: 1, harp: 1 }, { pad: 1, bass: 1, harp: 1, mel: 1 }, { choir: 1, bass: 1, mel: 1, timp: 1 }, { choir: 1, pad: 1, harp: 1 }],
    bar(E, p, t, c) {
      const T = c.tex;
      if (T.pad) musPad(E, p, 'pad', t, c, 'strings', 57, 76, 4, 0.5 * c.v, { a: 1.1, r: 1.8, vib: p.vib, bright: 0.8 });
      if (T.choir) musPad(E, p, 'choir', t, c, 'choir', 57, 74, 3, 0.6 * c.v, { a: 1.4, r: 2.0, vib: p.vib, vowel: c.i % 4 < 2 ? 'ah' : 'oo' });
      if (T.bass) MUS_INS.strings(E, p.in, t, musRoot(p, c, 38, 50), c.bar + 0.05, 0.6 * c.v, { a: 0.9, r: 1.5, bright: 0.55, vib: p.vib });
      if (T.harp) musArp(E, p, t, c, MUS_ARP44[c.i % 3], 50, 81, 0.4 * c.v);
      if (T.mel) musMelodyBar(E, p, t, c, 'brass', 0.55 * c.v, { dark: 0.65, a: 0.14, r: 0.7 });
      if (T.timp && (c.i === 0 || c.i === c.n - 1)) { const r = musRoot(p, c, 38, 45, 'timp'); for (let k = 0; k < 8; k++) MUS_INS.drum(E, p.in, t + k * 0.12 * c.beat * 2, 'timp', (0.15 + k * 0.05) * c.v, { m: r }); }
    },
  },
  // Logres: stately, bowed strings and brass, timpani
  logres: {
    key: 2, mode: 'major', bpm: 74, beats: 4, wet: 0.42, gain: 1.0, home: 'I',
    graph: { I: [['IV', 3], ['vi', 2], ['V', 2], ['ii', 1], ['bVII', 1], ['iii', 0.5]], ii: [['V', 3], ['IV', 1], ['vi', 0.5]], iii: [['vi', 2], ['IV', 2]], IV: [['I', 2], ['V', 2.5], ['ii', 1.5], ['vi', 1]], V: [['I', 3], ['vi', 2], ['IV', 0.7]], vi: [['IV', 2.5], ['ii', 2], ['V', 1], ['iii', 0.6]], bVII: [['IV', 2], ['I', 2]] },
    cad: [['V', 'I'], ['IV', 'I'], ['bVII', 'I'], ['Vsus', 'I']], half: [['ii', 'V'], ['IV', 'V'], ['vi', 'V']],
    mel: { lo: 62, hi: 79, center: 69, rhythms: MUS_RH44, cad: MUS_CAD44, rest: 0.06 },
    tex: [{ strings: 1, bass: 1 }, { strings: 1, bass: 1, mel: 1 }, { strings: 1, bass: 1, horns: 1, timp: 1 }, { strings: 1, bass: 1, mel: 1, timp: 1, ost: 1 }, { horns: 1, bass: 1, mel: 1, timp: 1 }, { strings: 1, ost: 1, mel: 1 }],
    bar(E, p, t, c) {
      const T = c.tex, b = c.beat;
      if (T.strings) musPad(E, p, 'str', t, c, 'strings', 57, 76, 4, 0.5 * c.v, { a: 0.45, r: 0.9, vib: p.vib });
      if (T.bass) { const r = musRoot(p, c, 38, 50); MUS_INS.strings(E, p.in, t, r, b * 2, 0.62 * c.v, { a: 0.12, r: 0.5, bright: 0.6, vib: p.vib }); MUS_INS.strings(E, p.in, t + b * 2, E.rnd() < 0.6 ? r : r + 7 - (r + 7 > 52 ? 12 : 0), b * 2, 0.55 * c.v, { a: 0.12, r: 0.5, bright: 0.6, vib: p.vib }); }
      if (T.horns) musPad(E, p, 'hn', t, c, 'brass', 50, 64, 3, 0.42 * c.v, { a: 0.2, r: 0.6, dark: 0.55, dur: c.bar * 0.96 });
      if (T.ost) { const vo = p.vo.str || musVoice(null, c.ch, 57, 76, 4, E.rnd); for (let k = 0; k < 8; k++) MUS_INS.strings(E, p.in, t + k * b * 0.5, vo[(k * 3) % vo.length] + 12 * (k % 4 === 3 ? 0 : 0), b * 0.32, (k % 2 ? 0.3 : 0.4) * c.v, { a: 0.02, r: 0.12, bright: 1.1 }); }
      if (T.mel) musMelodyBar(E, p, t, c, 'brass', 0.62 * c.v, { a: 0.07, r: 0.35 });
      if (T.timp) { const r = musRoot(p, c, 38, 45, 'timp'); MUS_INS.drum(E, p.in, t, 'timp', 0.55 * c.v, { m: r }); MUS_INS.drum(E, p.in, t + b * 2, 'timp', 0.32 * c.v, { m: r }); if (c.i === c.n - 1) for (let k = 0; k < 4; k++) MUS_INS.drum(E, p.in, t + b * (3 + k * 0.25), 'timp', (0.25 + k * 0.08) * c.v, { m: r }); }
    },
  },
  // Ériu: lilting six-eight, harp, pipes with cuts, a reedy drone and the frame drum
  eriu: {
    key: 9, mode: 'dorian', beatSec: 0.21, beats: 6, wet: 0.4, gain: 1.0, home: 'i',
    graph: { i: [['VII', 3], ['IV', 3], ['III', 1.5], ['v', 1]], VII: [['i', 2], ['IV', 2], ['III', 1.5]], IV: [['i', 3], ['VII', 2], ['v', 1]], III: [['VII', 2], ['IV', 2], ['i', 1]], v: [['i', 2], ['IV', 1.5], ['VII', 1]] },
    cad: [['VII', 'i'], ['IV', 'i'], ['v', 'i']], half: [['i', 'VII'], ['IV', 'v'], ['III', 'VII']],
    mel: { lo: 69, hi: 88, center: 78, rhythms: MUS_RH68, cad: MUS_CAD68, strong: 3, cuts: 0.45, legato: 0.9, rest: 0.05 },
    tex: [{ harp: 1, drone: 1 }, { harp: 1, mel: 1 }, { harp: 1, mel: 1, drum: 1 }, { harp: 1, mel: 1, drum: 1, pad: 1 }, { mel: 1, drone: 1, drum: 1 }, { harp: 1, pad: 1 }],
    bar(E, p, t, c) {
      const T = c.tex;
      if (T.harp) musArp(E, p, t, c, MUS_ARP68[(c.i + p.sec) % 3], 52, 79, 0.45 * c.v);
      if (T.mel) musMelodyBar(E, p, t, c, 'pipe', 0.62 * c.v);
      if (T.drone && c.i % 2 === 0) { MUS_INS.drone(E, p.in, t, p.key + 36, c.bar * 2 + 0.3, 0.55 * c.v, { reed: 1, cut: 900, a: 0.8, r: 1.2 }); MUS_INS.drone(E, p.in, t, p.key + 43, c.bar * 2 + 0.3, 0.35 * c.v, { reed: 1, cut: 1100, a: 0.8, r: 1.2 }); }
      if (T.pad) musPad(E, p, 'pad', t, c, 'strings', 57, 74, 3, 0.32 * c.v, { a: 0.6, r: 1.0, vib: p.vib, bright: 0.7 });
      if (T.drum) {
        const pat = pick(E.rnd, [
          [[0, 'frame', 1], [1, 'tip', 0.5], [2, 'frame', 0.45], [3, 'frame', 0.85], [4, 'tip', 0.45], [5, 'frame', 0.5]],
          [[0, 'frame', 1], [2, 'frame', 0.5], [3, 'frame', 0.8], [5, 'tip', 0.6]],
          [[0, 'frame', 1], [1, 'frame', 0.35], [2, 'tip', 0.5], [3, 'frame', 0.9], [4, 'frame', 0.35], [5, 'tip', 0.55]],
        ]);
        musDrums(E, p, t, c, pat, 0.7 * c.v);
      }
    },
  },
  // Thule: deep drums, low horns and a sung drone with its whistle
  thule: {
    key: 4, mode: 'aeolian', bpm: 56, beats: 4, wet: 0.5, gain: 1.0, home: 'i',
    graph: { i: [['VI', 2.5], ['VII', 2.5], ['bII', 1], ['iv', 1.5], ['v', 1]], VI: [['VII', 3], ['i', 2], ['iv', 1]], VII: [['i', 3], ['VI', 1.5], ['v', 1]], bII: [['i', 3]], iv: [['i', 2], ['VII', 2], ['VI', 1]], v: [['VI', 2], ['i', 2]] },
    cad: [['VII', 'i'], ['bII', 'i'], ['iv', 'i'], ['v', 'i']], half: [['VI', 'VII'], ['i', 'v'], ['iv', 'VII']],
    mel: { lo: 52, hi: 67, center: 59, rhythms: MUS_RH44, cad: MUS_CAD44, rest: 0.15 },
    tex: [{ throat: 1 }, { throat: 1, drums: 1 }, { throat: 1, horns: 1 }, { throat: 1, horns: 1, drums: 1 }, { horns: 1, drums: 1, calls: 1 }, { throat: 1, calls: 1, pad: 1 }, { drums: 1, horns: 1, pad: 1, calls: 1 }],
    bar(E, p, t, c) {
      const T = c.tex, b = c.beat;
      if (T.throat && c.i % 2 === 0) MUS_INS.throat(E, p.in, t, p.key + 36, c.bar * 2 + 0.5, 0.75 * c.v, {});
      if (T.drums) {
        const pat = pick(E.rnd, [[[0, 'deep', 1], [2, 'deep', 0.55]], [[0, 'deep', 1], [1.5, 'deep', 0.45], [2, 'deep', 0.7], [3.5, 'deep', 0.35]], [[0, 'deep', 1], [1.5, 'deep', 0.6], [3, 'deep', 0.75]], [[0, 'deep', 1], [0.5, 'frame', 0.25], [2, 'deep', 0.6], [3, 'frame', 0.3], [3.5, 'deep', 0.45]]]);
        musDrums(E, p, t, c, pat, 0.85 * c.v);
      }
      if (T.horns) {
        const vo = (p.vo.hn = musVoice(p.vo.hn, c.ch, 40, 59, 3, E.rnd));
        for (const m of vo) MUS_INS.brass(E, p.in, t, m, c.bar * 0.97, 0.45 * c.v, { a: 0.5, r: 1.1, dark: 0.45 });
      }
      if (T.calls && (c.i % 4 === 1 || c.i % 4 === 3) && E.rnd() < 0.8) musCall(E, p, t + b, c, 52, 66, 0.55 * c.v, { a: 0.12, r: 0.9, dark: 0.55 });
      if (T.pad) musPad(E, p, 'pad', t, c, 'choir', 52, 67, 3, 0.4 * c.v, { a: 1.6, r: 2.0, vib: p.vib, vowel: 'oo' });
    },
  },
  // the frontier: uneasy, open fifths, low strings pulsing, horn calls from far off
  frontier: {
    key: 0, mode: 'dorian', bpm: 84, beats: 4, wet: 0.45, gain: 1.0, home: 'i',
    graph: { i: [['VII', 2.5], ['IV', 1.5], ['VI', 2], ['v', 1], ['III', 1]], VII: [['i', 2], ['VI', 1.5], ['IV', 1.5]], VI: [['VII', 2.5], ['iv', 1.5], ['i', 1]], IV: [['i', 2], ['VII', 2]], iv: [['i', 2], ['v', 1], ['VII', 1]], v: [['VI', 2], ['i', 1.5]], III: [['VII', 2], ['VI', 1.5]] },
    cad: [['VII', 'i'], ['iv', 'i'], ['v', 'i']], half: [['VI', 'VII'], ['iv', 'v'], ['i', 'VII']],
    mel: { lo: 50, hi: 67, center: 57, rhythms: MUS_RH44, cad: MUS_CAD44, rest: 0.12 },
    tex: [{ ost: 1, pad: 1 }, { ost: 1, pad: 1, calls: 1 }, { ost: 1, bass: 1, timp: 1 }, { pad: 1, cello: 1 }, { ost: 1, bass: 1, calls: 1, timp: 1 }, { ost: 1, pad: 1, cello: 1 }],
    bar(E, p, t, c) {
      const T = c.tex, b = c.beat;
      if (T.ost) {
        const r = musRoot(p, c, 40, 51, 'ost'), seq = [0, 0, 7, 0, 0, 7, 12, 7];
        for (let k = 0; k < 8; k++) MUS_INS.strings(E, p.in, t + k * b * 0.5, r + seq[k], b * 0.3, (k % 4 === 0 ? 0.55 : 0.36) * c.v, { a: 0.015, r: 0.1, bright: 0.75 });
      }
      if (T.pad) { const ch5 = { ...c.ch, pcs: [c.ch.root, (c.ch.root + 7) % 12, (c.ch.root + 2) % 12] }; musPad(E, p, 'pad', t, { ...c, ch: ch5 }, 'strings', 60, 76, 3, 0.36 * c.v, { a: 1.2, r: 1.5, vib: p.vib, bright: 0.7 }); }
      if (T.bass) MUS_INS.bass(E, p.in, t, musRoot(p, c, 31, 43), c.bar, 0.6 * c.v, { a: 0.3, r: 0.8 });
      if (T.calls && c.i % 4 === 2) musCall(E, p, t, c, 55, 70, 0.45 * c.v, { a: 0.1, r: 1.2, dark: 0.6 });
      if (T.timp) { const r = musRoot(p, c, 36, 43, 'timp'); MUS_INS.drum(E, p.in, t, 'timp', 0.45 * c.v, { m: r }); MUS_INS.drum(E, p.in, t + b * 2.5, 'timp', 0.3 * c.v, { m: r }); }
      if (T.cello) musMelodyBar(E, p, t, c, 'strings', 0.6 * c.v, { a: 0.18, r: 0.5, vib: p.vib, bright: 0.85 });
    },
  },
  // battle: a driving base, then drums, then brass, then a heroic line on top as the fighting grows
  battle: {
    key: 0, mode: 'aeolian', bpm: 112, beats: 4, wet: 0.3, gain: 1.0, home: 'i', layers: ['base', 'drums', 'brass', 'top'],
    graph: { i: [['VI', 2.5], ['VII', 2], ['iv', 2], ['bII', 0.6], ['v', 1]], VI: [['VII', 3], ['iv', 1.5], ['i', 1]], VII: [['i', 3], ['III', 1], ['VI', 1]], iv: [['VII', 2], ['i', 2], ['v', 1], ['VI', 1]], v: [['i', 2], ['VI', 2]], III: [['VI', 2], ['VII', 2]], bII: [['i', 2], ['VII', 1]] },
    cad: [['VII', 'i'], ['iv', 'i'], ['V', 'i'], ['bII', 'i']], half: [['VI', 'V'], ['iv', 'V'], ['VI', 'VII']],
    mel: { lo: 60, hi: 79, center: 69, rhythms: MUS_RH44, cad: MUS_CAD44, rest: 0.04 },
    tex: [{ a: 0 }, { a: 1 }, { a: 2 }],
    bar(E, p, t, c) {
      const b = c.beat, L = p.layer, on = (k) => (p.layerOn ? p.layerOn[k] : 1) > 0.01;
      // base: the string ostinato and a low pulse
      const r = musRoot(p, c, 36, 47), vo = (p.vo.str = musVoice(p.vo.str, c.ch, 55, 70, 3, E.rnd));
      const sixteen = (p.heat || 0) > 0.55;
      const n = sixteen ? 16 : 8, step = 4 / n;
      for (let k = 0; k < n; k++) MUS_INS.strings(E, L.base, t + k * b * step, vo[[0, 1, 2, 1][k % 4]], b * step * 0.62, (k % 4 === 0 ? 0.5 : 0.34) * c.v, { a: 0.012, r: 0.08, bright: 1.1 });
      for (let k = 0; k < 8; k++) if (k !== 3 && k !== 7) MUS_INS.bass(E, L.base, t + k * b * 0.5, r, b * 0.4, (k === 0 ? 0.75 : 0.5) * c.v, { a: 0.01, r: 0.08, sus: 0.6 });
      if (on('drums')) {
        const fill = c.i === c.n - 1;
        const pat = fill ? [[0, 'tom', 1], [1, 'snare', 0.7], [2, 'tom', 0.8], [2.5, 'tom', 0.7], [3, 'snare', 0.8], [3.25, 'snare', 0.6], [3.5, 'snare', 0.75], [3.75, 'snare', 0.9]]
          : pick(E.rnd, [[[0, 'tom', 1], [1, 'snare', 0.7], [1.5, 'tom', 0.5], [2, 'tom', 0.85], [3, 'snare', 0.75], [3.5, 'hat', 0.6]], [[0, 'tom', 1], [0.75, 'tom', 0.5], [1, 'snare', 0.7], [2, 'tom', 0.9], [2.5, 'tom', 0.55], [3, 'snare', 0.8]]]);
        musDrums(E, p, t, c, pat, 0.8 * c.v, L.drums);
      }
      if (on('brass')) {
        const hv = (p.vo.br = musVoice(p.vo.br, c.ch, 50, 67, 3, E.rnd));
        for (const [bb, d, vv] of [[0, 1.2, 0.6], [1.5, 0.4, 0.45], [2, 1.6, 0.55]]) for (const m of hv) MUS_INS.brass(E, L.brass, t + bb * b, m, d * b, vv * c.v, { a: 0.03, r: 0.2, dark: 0.75 });
        MUS_INS.drum(E, L.brass, t, 'timp', 0.6 * c.v, { m: musRoot(p, c, 36, 43, 'timp') });
      }
      if (on('top')) {
        p.dst = L.top;
        musMelodyBar(E, p, t, c, 'brass', 0.62 * c.v, { a: 0.05, r: 0.3 });
        p.dst = null;
        if (c.i % 2 === 0) musPad(E, p, 'ch', t, c, 'choir', 60, 76, 3, 0.4 * c.v, { a: 0.6, r: 1.0, vib: p.vib, vowel: 'ah', dur: c.bar * 2 }, L.top);
      }
    },
  },
  // the Barrow: dark drones, bells tolling far off, ghostly voices, drips of glass
  barrow: {
    key: 1, mode: 'phrygian', bpm: 54, beats: 4, wet: 0.78, gain: 1.0, home: 'i', layers: ['still', 'fight'],
    graph: { i: [['bII', 3], ['i', 1], ['iv', 1.5], ['VI', 1]], bII: [['i', 3], ['VII', 1]], iv: [['i', 2], ['bII', 1.5]], VI: [['bII', 2], ['i', 1]], VII: [['i', 2]] },
    cad: [['bII', 'i'], ['iv', 'i']], half: [['i', 'bII'], ['VI', 'bII']],
    tex: [{ drone: 1, bells: 1 }, { drone: 1, choir: 1 }, { drone: 1, bells: 1, drips: 1 }, { drone: 1, choir: 1, bells: 1 }, { drone: 1, drips: 1 }],
    bar(E, p, t, c) {
      const T = c.tex, b = c.beat, L = p.layer, k0 = p.key;
      if (T.drone && c.i % 2 === 0) { MUS_INS.drone(E, L.still, t, k0 + 24, c.bar * 2 + 2, 0.8 * c.v, { cut: 260 }); MUS_INS.drone(E, L.still, t + 0.3, k0 + 31, c.bar * 2 + 2, 0.45 * c.v, { cut: 300 }); MUS_INS.drone(E, L.still, t + 0.6, k0 + 37, c.bar * 2 + 1.7, 0.18 * c.v, { cut: 420 }); }
      if (T.bells && E.rnd() < 0.6) MUS_INS.bell(E, L.still, t + b * Math.floor(E.rnd() * 4), k0 + pick(E.rnd, [36, 43, 39, 42, 31]), 7, 0.6 * c.v, {});
      if (T.choir && c.i % 2 === 0) musPad(E, p, 'ch', t, c, 'choir', 49, 64, 3, 0.4 * c.v, { a: 2.6, r: 2.6, vib: p.vib, vowel: 'oo', dur: c.bar * 1.6 }, L.still);
      if (T.drips) { const n = Math.floor(E.rnd() * 3); const sc = musLadder(musScale(k0, 'phrygian', c.ch), 73, 92); for (let k = 0; k < n; k++) MUS_INS.celesta(E, L.still, t + E.rnd() * c.bar, pick(E.rnd, sc), 2.6, 0.35 * c.v, {}); }
      if ((p.layerOn ? p.layerOn.fight : 0) > 0.01) {
        musDrums(E, p, t, c, [[0, 'deep', 1], [0.4, 'deep', 0.6], [2, 'deep', 0.8], [2.4, 'deep', 0.5]], 0.75 * c.v, L.fight);
        const r = musRoot(p, c, 37, 49, 'trem');
        for (let k = 0; k < 16; k++) MUS_INS.strings(E, L.fight, t + k * b * 0.25, r + (k % 8 < 4 ? 0 : 1), b * 0.2, 0.32 * c.v, { a: 0.01, r: 0.06, bright: 0.8 });
      }
    },
  },
  // night: sparse and quiet; the instruments follow the land you stand in
  night: {
    key: 2, mode: 'major', bpm: 50, beats: 4, wet: 0.62, gain: 0.85, home: 'I',
    graph: { I: [['IV', 3], ['vi', 2], ['ii', 1], ['Iadd', 1]], Iadd: [['IV', 2], ['vi', 2]], IV: [['I', 3], ['ii', 1], ['vi', 1]], vi: [['IV', 3], ['ii', 1], ['I', 1]], ii: [['IV', 2], ['I', 1]] },
    cad: [['IV', 'I'], ['ii', 'I'], ['vi', 'I']], half: [['I', 'IV'], ['vi', 'IV']],
    tex: [{ pad: 1 }, { pad: 1, notes: 1 }, { notes: 1 }, { pad: 1, notes: 1, low: 1 }, {}, { notes: 1, low: 1 }],
    bar(E, p, t, c) {
      const T = c.tex, fl = p.flavour;
      if (T.pad) musPad(E, p, 'pad', t, c, 'pad', 55, 72, 3, 0.4 * c.v, { a: 2.2, r: 2.6, dur: c.bar + 0.4 });
      if (T.low && c.i % 2 === 0) {
        if (fl === 2) MUS_INS.throat(E, p.in, t, p.key + 36, c.bar * 2, 0.32 * c.v, { growl: 0.2, whistle: 2.2, a: 2.5, r: 2.5 });
        else MUS_INS.pad(E, p.in, t, musRoot(p, c, 38, 50), c.bar * 2, 0.45 * c.v, { a: 2.5, r: 2.5 });
      }
      if (T.notes) {
        // a few notes from the gentle five-note heart of the mode, often none
        const sc = musScale(p.key, p.mode, c.ch), pent = sc.filter((pc) => { const iv = musPc(pc - p.key); return iv !== 1 && iv !== 5 && iv !== 6 && iv !== 11 && iv !== 10 && iv !== 8; });
        const L = musLadder(pent.length >= 3 ? pent : sc, 67, 86);
        const n = pick(E.rnd, [0, 1, 1, 2, 2, 3]);
        for (let k = 0; k < n; k++) {
          const at = t + c.beat * pick(E.rnd, [0, 1, 1.5, 2, 3, 3.5]), m = pick(E.rnd, L);
          if (fl === 1) MUS_INS.pluck(E, p.in, at, m - 12, 2.8, 0.42 * c.v, { bright: 0.8 });
          else MUS_INS.celesta(E, p.in, at, m, 3, 0.5 * c.v, {});
        }
        if (fl === 1 && E.rnd() < 0.25) { p.M = { lo: 69, hi: 84, center: 76, rhythms: MUS_RH44, cad: MUS_CAD44, rest: 0.3, cuts: 0.3 }; musMelodyBar(E, p, t, c, 'pipe', 0.32 * c.v); p.M = null; }
      }
    },
  },
};
const MUS_NIGHT_MINOR = {
  home: 'i',
  graph: { i: [['VI', 3], ['iv', 2], ['III', 1.5], ['isus2', 1]], isus2: [['VI', 2], ['iv', 2]], VI: [['III', 2], ['iv', 2], ['i', 1.5]], III: [['VI', 2], ['iv', 1.5]], iv: [['i', 3], ['VI', 1]] },
  cad: [['iv', 'i'], ['VI', 'i']], half: [['i', 'VI'], ['iv', 'VI']],
};
// night keys by land: Logres, Ériu, Thule, the frontier
const MUS_NIGHT_KEYS = [[2, 'major'], [9, 'dorian'], [4, 'aeolian'], [0, 'dorian']];

/* ------------------------------------------------------------------ */
/* pieces: start, crossfade, schedule bar by bar, stop                  */
/* ------------------------------------------------------------------ */
function musPieceStart(E, name, t0, flavour = -1) {
  const S = MUS_MOODS[name], ctx = E.ctx;
  const p = { name, S, key: S.key, mode: S.mode, G: S, flavour, bar: 0, sec: -1, i: 0, n: 8, next: t0 + 0.05, vo: {}, tex: null, texI: -1, prog: [], motif: null, melLast: null, v: 0.85, half: false, target: 0, fadeEnd: t0, done: false, heat: 0 };
  if (name === 'night') {
    const [k, md] = MUS_NIGHT_KEYS[flavour >= 0 && flavour <= 2 ? flavour : 3];
    p.key = k; p.mode = md;
    if (md !== 'major') p.G = MUS_NIGHT_MINOR;
  }
  const beat = S.beatSec || 60 / S.bpm;
  p.beat = beat; p.barDur = beat * S.beats;
  p.fade = ctx.createGain(); p.fade.gain.value = 0;
  p.in = ctx.createGain(); p.in.gain.value = S.gain;
  p.send = ctx.createGain(); p.send.gain.value = S.wet;
  p.in.connect(p.fade); p.fade.connect(E.bed); p.fade.connect(p.send).connect(E.bedWet);
  // a slow shared vibrato for the bowed and sung parts (in cents)
  p.lfo = ctx.createOscillator(); p.lfo.frequency.value = 4.4 + E.rnd() * 0.8;
  p.vib = ctx.createGain(); p.vib.gain.value = 5;
  p.lfo.connect(p.vib); p.lfo.start(t0);
  p.layer = {}; p.layerOn = {};
  for (const k of S.layers || []) { const g = ctx.createGain(); g.gain.value = k === 'base' || k === 'still' ? 1 : 0; g.connect(p.in); p.layer[k] = g; p.layerOn[k] = g.gain.value; }
  E.pieces.push(p);
  return p;
}
function musPieceFade(E, p, to, sec) {
  const g = p.fade.gain, now = E.ctx.currentTime;
  const from = p.done ? 0 : g.value;
  g.cancelScheduledValues(now);
  g.setValueAtTime(from, now);
  g.linearRampToValueAtTime(to, now + Math.max(0.05, sec));
  p.target = to; p.fadeEnd = now + sec;
}
function musPieceStop(E, p) {
  p.done = true;
  try { p.lfo.stop(); } catch (e) { /* already stopped */ }
  for (const nd of [p.lfo, p.vib, p.in, p.fade, p.send, ...Object.values(p.layer)]) { try { nd.disconnect(); } catch (e) { /* gone */ } }
  const i = E.pieces.indexOf(p);
  if (i >= 0) E.pieces.splice(i, 1);
}
function musSection(E, p) {
  const S = p.S, rnd = E.rnd;
  p.sec++;
  p.half = p.sec % 2 === 0 && rnd() < 0.7; // a question, then its answer
  p.n = S.sectionLen || 8;
  p.prog = musProg(rnd, p.G, p.n, p.half, p.sec === 0).map((nm) => musChord(p.key, nm));
  let k = p.sec === 0 ? 0 : Math.floor(rnd() * S.tex.length);
  if (k === p.texI && S.tex.length > 1) k = (k + 1 + Math.floor(rnd() * (S.tex.length - 1))) % S.tex.length;
  p.texI = k; p.tex = S.tex[k];
  p.v = 0.78 + rnd() * 0.22;
  if (rnd() < 0.5) p.motif = null;
}
function musBar(E, p, t) {
  if (p.i === 0 || !p.prog.length) musSection(E, p);
  const c = {
    i: p.i, n: p.n, ch: p.prog[p.i], next: p.prog[(p.i + 1) % p.n], beat: p.beat, bar: p.barDur,
    v: p.v * (0.9 + 0.1 * Math.sin((p.i / p.n) * Math.PI)), tex: p.tex, end: p.i === p.n - 1 && !p.half,
  };
  try { p.S.bar(E, p, t, c); } catch (e) { if (MUSIC.debug) throw e; else reportError(e); }
  p.i = (p.i + 1) % p.n;
  p.bar++;
}
// schedules every piece up to the given time; stops the ones that have faded out
function musPump(E, until, maxBars = 6) {
  for (const p of E.pieces.slice()) {
    if (p.target === 0 && E.ctx.currentTime > p.fadeEnd + 0.1) { musPieceStop(E, p); continue; }
    let guard = 0;
    while (p.next < until && guard++ < maxBars) { musBar(E, p, p.next); p.next += p.barDur; }
  }
}

/* ------------------------------------------------------------------ */
/* stingers                                                             */
/* ------------------------------------------------------------------ */
// each returns how long it lasts; keys match the effects they ride on (the level-up chime and the victory fanfare
// in C, the keep and hallow horns in D, the lament under the defeat fanfare in A minor)
function musStinger(E, kind, t, dst = E.sting) {
  const I = MUS_INS, vib = null;
  switch (kind) {
    case 'levelup': {
      [60, 64, 67, 72, 76, 79, 84, 88].forEach((m, k) => I.pluck(E, dst, t + k * 0.05, m, 2.4, 0.42, {}));
      [48, 55, 64, 67, 72].forEach((m) => I.strings(E, dst, t + 0.08, m, 1.5, 0.55, { a: 0.3, r: 1.2, vib }));
      [67, 72, 76].forEach((m) => I.brass(E, dst, t + 0.42, m, 0.95, 0.5, { a: 0.07, r: 0.9 }));
      I.drum(E, dst, t + 0.42, 'timp', 0.55, { m: 36 });
      return 2.6;
    }
    case 'keepWon': {
      [[0, 62, 0.22], [0.2, 69, 0.22], [0.4, 74, 1.4]].forEach(([d, m, l]) => I.brass(E, dst, t + d, m, l, 0.62, { a: 0.05, r: 0.5 }));
      [50, 57, 62, 66].forEach((m) => I.strings(E, dst, t + 0.4, m, 1.8, 0.5, { a: 0.25, r: 1.2 }));
      for (let k = 0; k < 6; k++) I.drum(E, dst, t + k * 0.07, 'timp', 0.2 + k * 0.07, { m: 38 });
      I.drum(E, dst, t + 0.4, 'timp', 0.65, { m: 38 });
      return 2.8;
    }
    case 'keepLost': {
      [[0, 57, 0.6], [0.6, 53, 0.6], [1.2, 50, 1.8]].forEach(([d, m, l]) => I.brass(E, dst, t + d, m, l, 0.52, { a: 0.1, r: 0.9, dark: 0.5 }));
      [38, 45, 50, 53].forEach((m) => I.strings(E, dst, t + 0.1, m, 2.8, 0.45, { a: 0.6, r: 1.4, bright: 0.6 }));
      I.drum(E, dst, t, 'deep', 0.8); I.drum(E, dst, t + 1.2, 'deep', 0.6);
      return 3.4;
    }
    case 'hallowLost': {
      for (let k = 0; k < 20; k++) for (const m of [62, 65, 68]) I.strings(E, dst, t + k * 0.075, m, 0.06, 0.18 + k * 0.012, { a: 0.008, r: 0.05, bright: 1.1 });
      [50, 57, 62, 65].forEach((m) => I.strings(E, dst, t + 1.5, m, 1.6, 0.5, { a: 0.1, r: 1.2 }));
      I.brass(E, dst, t + 1.5, 38, 1.8, 0.55, { a: 0.2, r: 1.0, dark: 0.5 });
      for (let k = 0; k < 10; k++) I.drum(E, dst, t + k * 0.15, 'tom', 0.25 + k * 0.05);
      I.drum(E, dst, t + 1.5, 'deep', 0.9);
      return 3.5;
    }
    case 'hallowWon': {
      [[0, 62, 0.16], [0.15, 66, 0.16], [0.3, 69, 0.16], [0.45, 74, 1.6]].forEach(([d, m, l]) => I.brass(E, dst, t + d, m, l, 0.6, { a: 0.04, r: 0.6 }));
      [62, 66, 69, 74].forEach((m) => I.choir(E, dst, t + 0.45, m, 1.8, 0.55, { a: 0.4, r: 1.4, vowel: 'ah' }));
      I.swell(E, dst, t - 0.2, 0.75, 0.6, 2500, 9000, 0.6, 'highpass');
      I.drum(E, dst, t + 0.45, 'timp', 0.6, { m: 38 });
      return 2.9;
    }
    case 'victory': {
      for (let k = 0; k < 14; k++) I.drum(E, dst, t + k * 0.09, 'timp', 0.15 + k * 0.035, { m: 36 });
      I.drum(E, dst, t + 1.3, 'timp', 0.75, { m: 36 });
      [48, 55, 60, 64, 67, 72].forEach((m) => I.strings(E, dst, t + 0.6, m, 4.2, 0.5, { a: 0.7, r: 2.0 }));
      [60, 64, 67, 72].forEach((m) => I.choir(E, dst, t + 0.6, m, 4.4, 0.6, { a: 1.0, r: 2.2, vowel: 'ah' }));
      [60, 64, 67, 72, 76, 79, 84, 88, 91].forEach((m, k) => I.pluck(E, dst, t + 1.3 + k * 0.045, m, 2.6, 0.4, {}));
      I.swell(E, dst, t + 0.2, 1.1, 0.5, 3000, 9000, 0.5, 'highpass');
      return 6.5;
    }
    case 'defeat': {
      [45, 52, 57, 60].forEach((m) => I.strings(E, dst, t + 0.3, m, 4.6, 0.45, { a: 1.2, r: 2.2, bright: 0.6 }));
      [57, 60, 64].forEach((m) => I.choir(E, dst, t + 0.8, m, 4.0, 0.42, { a: 1.6, r: 2.4, vowel: 'oo' }));
      [[1.2, 64, 0.9], [2.1, 62, 0.9], [3.0, 60, 0.9], [3.9, 59, 0.6], [4.5, 57, 2.0]].forEach(([d, m, l]) => I.brass(E, dst, t + d, m, l, 0.4, { a: 0.15, r: 0.8, dark: 0.5 }));
      I.drum(E, dst, t + 0.3, 'deep', 0.7); I.drum(E, dst, t + 4.5, 'deep', 0.55);
      return 7.0;
    }
    default: return 0;
  }
}

/* ------------------------------------------------------------------ */
/* the game side: choosing the mood, the heat of battle, events        */
/* ------------------------------------------------------------------ */
function musicInit() {
  if (MUSIC.E || !AUDIO.ctx || !AUDIO.master) return;
  const ctx = AUDIO.ctx;
  MUSIC.lite = IS_TOUCH || quality.level === 'low';
  MUSIC.bus = ctx.createGain(); MUSIC.bus.gain.value = MUSIC.vol * MUSIC_BASE;
  MUSIC.duck = ctx.createGain();
  MUSIC.bus.connect(MUSIC.duck).connect(AUDIO.master);
  MUSIC.E = musicEngine(ctx, MUSIC.bus, MUSIC.lite);
  // a side-chain: the score dips under loud effects
  MUSIC.an = ctx.createAnalyser(); MUSIC.an.fftSize = 512;
  MUSIC.anBuf = new Float32Array(MUSIC.an.fftSize);
  AUDIO.sfxBus.connect(MUSIC.an);
}
// how hard the fighting is around the player (0 calm .. 1 a melee)
function musicHeat() {
  const P = GAME.player;
  if (!P || !P.alive) return 0;
  const t = GAME.t, R2 = 44 * 44;
  let h = P.combatUntil > t ? 0.38 : 0, n = 0;
  for (const e of ENT) {
    if (e === P || !e.alive || e.kind === 'door' || e.combatUntil <= t) continue;
    if (dist2(e.x, e.z, P.x, P.z) > R2) continue;
    n += isEnemy(e, P) ? 1 : 0.5;
  }
  h += Math.min(0.62, n * 0.045);
  return clamp(h, 0, 1);
}
function musicWantMood() {
  if (MUSIC.forced) return MUSIC.forced;
  if (!GAME.started || !GAME.player) return 'title';
  const P = GAME.player;
  if (INDOOR.on || inDungeon(P)) return 'barrow';
  if (MUSIC.heat > 0.24 || (MUSIC.mood === 'battle' && MUSIC.heat > 0.07)) return 'battle';
  const nt = U.uNight.value;
  MUSIC.night = MUSIC.night ? nt > 0.5 : nt > 0.7;
  const z = zoneAt(P.x, P.z);
  MUSIC.flavour = z.frontier ? -1 : z.realm;
  if (MUSIC.night) return 'night';
  if (z.frontier) return 'frontier';
  return ['logres', 'eriu', 'thule'][z.realm] || 'frontier';
}
function musicSetMood(m) {
  const E = MUSIC.E, now = E.ctx.currentTime;
  const fadeIn = m === 'battle' ? 1.6 : m === 'night' ? 6 : m === 'barrow' ? 2.5 : m === 'title' ? 2.5 : 4;
  const fadeOut = m === 'battle' ? 2.5 : m === '' ? 2 : 5;
  let keep = null;
  for (const p of E.pieces) {
    if (!keep && m && p.name === m && !p.done && (m !== 'night' || p.flavour === MUSIC.flavour)) keep = p; // still fading out: bring it back
    else if (p.target !== 0) musPieceFade(E, p, 0, fadeOut);
  }
  if (m) {
    const p = keep || musPieceStart(E, m, now + 0.05, MUSIC.flavour);
    musPieceFade(E, p, 1, fadeIn);
  }
  MUSIC.log.push([m, Math.round(now * 10) / 10]);
  while (MUSIC.log.length > 40) MUSIC.log.shift();
  MUSIC.mood = m;
}
function musicStinger(kind) {
  const ok = MUSIC.E && AUDIO.on && MUSIC.vol > 0 && AUDIO.ctx && AUDIO.ctx.state === 'running';
  MUSIC.stingers.push([kind, ok ? Math.round(AUDIO.ctx.currentTime * 10) / 10 : -1]);
  while (MUSIC.stingers.length > 30) MUSIC.stingers.shift();
  if (!ok) return;
  const E = MUSIC.E, t = E.ctx.currentTime + 0.04;
  let len = 0;
  try { len = musStinger(E, kind, t); } catch (e) { reportError(e); }
  if (!len) return;
  // the bed bows out under the stinger and comes back after it
  for (const g of [E.bed.gain, E.bedWet.gain]) {
    g.cancelScheduledValues(t);
    g.setTargetAtTime(0.28, t, 0.08);
    g.setTargetAtTime(1, t + len * 0.75, 1.2);
  }
}
// keeps taken and hallows seized, seen from the player's side
function musicWatchWar() {
  const P = GAME.player;
  if (!P || !WAR.keeps || !WAR.relics) { MUSIC.seen = null; return; }
  const keeps = WAR.keeps.map((K) => K.realm), rel = WAR.relics.map((r) => (r.state === 'carried' ? r.carrierRealm : -1));
  const cn = typeof CAMPAIGN !== 'undefined' ? CAMPAIGN.n + ':' + CAMPAIGN.state : '';
  const S = MUSIC.seen;
  MUSIC.seen = { pid: P.id, cn, keeps, rel };
  if (!S || S.pid !== P.id || S.cn !== cn || cn.endsWith('peace')) return;
  const me = P.faction;
  let kind = '';
  keeps.forEach((r, i) => { if (r !== S.keeps[i]) { if (r === me) kind = kind || 'keepWon'; else if (S.keeps[i] === me) kind = 'keepLost'; } });
  rel.forEach((c, i) => {
    const R = WAR.relics[i];
    if (c >= 0 && S.rel[i] < 0 && c !== R.realm) { if (R.realm === me) kind = 'hallowLost'; else if (c === me && !kind) kind = 'hallowWon'; }
  });
  if (kind) musicStinger(kind);
}
// called every frame from updateAudio
function updateMusic(dt) {
  if (!AUDIO.ctx || AUDIO.ctx.state !== 'running') return;
  if (!MUSIC.E) musicInit();
  const E = MUSIC.E;
  if (!E) return;
  const now = AUDIO.ctx.currentTime;
  MUSIC.frameAvg += (Math.min(dt, 1) - MUSIC.frameAvg) * 0.1;
  // the heat of battle rises fast and cools slowly
  if (now - MUSIC.heatAt > 0.25) { MUSIC.heatAt = now; MUSIC.heatRaw = GAME.started ? musicHeat() : 0; }
  const k = MUSIC.heatRaw > MUSIC.heat ? 1 - Math.exp(-dt / 0.9) : 1 - Math.exp(-dt / 5.5);
  MUSIC.heat += (MUSIC.heatRaw - MUSIC.heat) * k;
  const want = AUDIO.on && MUSIC.vol > 0 ? musicWantMood() : '';
  const key = want === 'night' ? 'night' + MUSIC.flavour : want; // walking into another land at night changes the night's voice
  if (key !== MUSIC.want) { MUSIC.want = key; MUSIC.wantT = now; }
  const hold = want === 'battle' ? 0.8 : want === 'barrow' || want === '' || MUSIC.mood === 'title' || MUSIC.mood === '' || MUSIC.forced ? 0.15 : want === 'night' && MUSIC.mood === 'night' ? 6 : 3;
  if (key !== MUSIC.moodKey && now - MUSIC.wantT >= hold) { musicSetMood(want); MUSIC.moodKey = key; }
  // the battle's layers follow the heat
  for (const p of E.pieces) {
    p.heat = MUSIC.heat;
    if (!p.S.layers) continue;
    const h = MUSIC.forcedHeat ?? MUSIC.heat;
    const lv = p.name === 'battle'
      ? { base: 0.75 + 0.25 * h, drums: sstep(0.12, 0.4, h), brass: sstep(0.32, 0.62, h), top: sstep(0.55, 0.85, h) }
      : { still: 1 - 0.35 * sstep(0.2, 0.6, h), fight: sstep(0.18, 0.45, h) };
    for (const key in lv) { p.layerOn[key] = lv[key]; p.layer[key].gain.setTargetAtTime(lv[key], now, 0.5); }
  }
  // the side-chain: the score dips under loud effects and comes back gently
  if (MUSIC.an) {
    MUSIC.an.getFloatTimeDomainData(MUSIC.anBuf);
    let s = 0;
    for (let i = 0; i < MUSIC.anBuf.length; i++) s += MUSIC.anBuf[i] * MUSIC.anBuf[i];
    const db = 10 * Math.log10(s / MUSIC.anBuf.length + 1e-12);
    const target = clamp((db + 26) * 0.6, 0, 8);
    MUSIC.duckDb = target > MUSIC.duckDb ? target : MUSIC.duckDb + (target - MUSIC.duckDb) * Math.min(1, dt * 1.4);
    MUSIC.duck.gain.setTargetAtTime(Math.pow(10, -MUSIC.duckDb / 20), now, target > MUSIC.duckDb - 0.01 ? 0.03 : 0.25);
  }
  if (GAME.started) musicWatchWar();
  // schedule ahead far enough to ride out slow frames
  musPump(E, now + clamp(MUSIC.frameAvg * 3, 0.6, 2.5));
}
function setMusicVolume(v) {
  MUSIC.vol = clamp(Number.isFinite(+v) ? +v : 0.55, 0, 1);
  if (MUSIC.bus) MUSIC.bus.gain.setTargetAtTime(MUSIC.vol * MUSIC_BASE, AUDIO.ctx.currentTime, 0.15);
}
function musicLevelKey() {
  let best = MUSIC_LEVELS[0];
  for (const L of MUSIC_LEVELS) if (Math.abs(L[2] - MUSIC.vol) < Math.abs(best[2] - MUSIC.vol)) best = L;
  return best[0];
}
// the score starts with the first touch, click or key anywhere, like the effects
for (const ev of ['pointerdown', 'keydown', 'touchend']) {
  window.addEventListener(ev, () => { if (!AUDIO.ctx || AUDIO.ctx.state !== 'running') audioUnlock(); }, { capture: true, passive: true });
}

/* ------------------------------------------------------------------ */
/* offline rendering (tests): a mood or a stinger into a buffer        */
/* ------------------------------------------------------------------ */
async function musicRenderOffline(what, secs = 12, o = {}) {
  const sr = o.sr || 44100, AC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  const octx = new AC(2, Math.ceil(sr * secs), sr);
  const g = octx.createGain(); g.gain.value = (o.vol ?? 0.9) * MUSIC_BASE;
  g.connect(octx.destination);
  const E = musicEngine(octx, g, !!o.lite);
  if (MUS_MOODS[what]) {
    const p = musPieceStart(E, what, 0, o.flavour ?? -1);
    p.fade.gain.value = 1; p.target = 1; p.fadeEnd = 0;
    for (const key in p.layer) { const v = o.heat === undefined ? 1 : key === 'base' || key === 'still' ? 1 : o.heat; p.layer[key].gain.value = v; p.layerOn[key] = v; }
    p.heat = o.heat ?? 1;
    musPump(E, secs, 100000);
  } else musStinger(E, what, 0.05);
  const scheduled = E.made;
  const buf = await octx.startRendering();
  const L = buf.getChannelData(0), R = buf.getChannelData(1), n = L.length;
  let peak = 0, sum = 0, clip = 0, maxWin = 0, ws = 0;
  const win = Math.floor(sr * 0.4);
  for (let i = 0; i < n; i++) {
    const a = Math.max(Math.abs(L[i]), Math.abs(R[i]));
    if (a > peak) peak = a;
    if (a >= 0.999) clip++;
    const s2 = (L[i] * L[i] + R[i] * R[i]) / 2;
    sum += s2; ws += s2;
    if (i % win === win - 1) { maxWin = Math.max(maxWin, ws / win); ws = 0; }
  }
  const db = (x) => Math.round(10 * Math.log10(x + 1e-12) * 10) / 10;
  const out = { what, secs, peakDb: Math.round(20 * Math.log10(peak + 1e-12) * 10) / 10, rmsDb: db(sum / n), maxShortDb: db(maxWin), clip, voices: scheduled, finite: Number.isFinite(sum) };
  if (o.wav) out.wav = musicWav(buf);
  return out;
}
function musicWav(buf) {
  const n = buf.length, ch = buf.numberOfChannels, sr = buf.sampleRate, bytes = 44 + n * ch * 2;
  const dv = new DataView(new ArrayBuffer(bytes));
  const str = (o, s) => { for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); dv.setUint32(4, bytes - 8, true); str(8, 'WAVE'); str(12, 'fmt ');
  dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, ch, true); dv.setUint32(24, sr, true);
  dv.setUint32(28, sr * ch * 2, true); dv.setUint16(32, ch * 2, true); dv.setUint16(34, 16, true); str(36, 'data'); dv.setUint32(40, n * ch * 2, true);
  const chans = [];
  for (let c = 0; c < ch; c++) chans.push(buf.getChannelData(c));
  let o = 44;
  for (let i = 0; i < n; i++) for (let c = 0; c < ch; c++) { dv.setInt16(o, Math.max(-1, Math.min(1, chans[c][i])) * 32767, true); o += 2; }
  const u8 = new Uint8Array(dv.buffer);
  let bin = '';
  for (let i = 0; i < u8.length; i += 0x8000) bin += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  return btoa(bin);
}
// a long run in chunks: mood changes and stingers on an offline clock, counting the voices still alive
async function musicSoak(secs = 240, chunk = 2, o = {}) {
  const sr = 22050, AC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  const octx = new AC(2, Math.ceil(sr * secs), sr);
  const g = octx.createGain(); g.gain.value = 0.5; g.connect(octx.destination);
  const E = musicEngine(octx, g, !!o.lite);
  const moods = ['title', 'logres', 'battle', 'eriu', 'night', 'thule', 'barrow', 'frontier', 'battle', 'night'];
  const stings = ['levelup', 'keepWon', 'hallowLost', 'victory', 'keepLost', 'hallowWon', 'defeat'];
  const samples = [];
  let mi = 0, si = 0, cur = null;
  const step = (t) => {
    if (t % 20 < chunk) { // a new mood every twenty seconds, crossfaded
      for (const p of E.pieces) if (p.target !== 0) musPieceFade(E, p, 0, 4);
      cur = musPieceStart(E, moods[mi % moods.length], t, mi % 3); mi++;
      musPieceFade(E, cur, 1, 3);
      for (const key in cur.layer) cur.layer[key].gain.value = 1;
    }
    if (t % 30 < chunk && t > 0) musStinger(E, stings[si++ % stings.length], t + 0.1);
    musPump(E, t + chunk + 0.5);
    samples.push([Math.round(t), E.live, E.nodes, E.pieces.length]);
  };
  for (let t = chunk; t < secs; t += chunk) octx.suspend(t).then(() => { step(octx.currentTime); octx.resume(); });
  step(0);
  await octx.startRendering();
  await new Promise((r) => setTimeout(r, 300));
  return { samples, end: [E.live, E.nodes, E.pieces.length], made: E.made, peak: E.peak };
}

/* test hooks: window.__hm.music */
queueMicrotask(() => {
  if (!window.__hm) return;
  window.__hm.music = {
    M: MUSIC, MOODS: Object.keys(MUS_MOODS), setMusicVolume, musicStinger, musicSetMood, musicWantMood, musicHeat, updateMusic, musicLevelKey,
    render: musicRenderOffline, soak: musicSoak,
    force(m) { MUSIC.forced = m || null; },
    forceHeat(h) { MUSIC.forcedHeat = h == null ? undefined : h; },
    state() {
      const E = MUSIC.E;
      return {
        ctx: AUDIO.ctx ? AUDIO.ctx.state : 'none', on: AUDIO.on, vol: MUSIC.vol, level: musicLevelKey(), mood: MUSIC.mood, want: MUSIC.want,
        heat: Math.round(MUSIC.heat * 100) / 100, duckDb: Math.round(MUSIC.duckDb * 10) / 10, night: MUSIC.night, flavour: MUSIC.flavour,
        pieces: E ? E.pieces.map((p) => ({ name: p.name, target: p.target, gain: Math.round(p.fade.gain.value * 100) / 100, fading: AUDIO.ctx.currentTime < p.fadeEnd, bar: p.bar, sec: p.sec, layers: Object.fromEntries(Object.entries(p.layerOn).map(([k, v]) => [k, Math.round(v * 100) / 100])) })) : [],
        live: E ? E.live : 0, nodes: E ? E.nodes : 0, made: E ? E.made : 0, peak: E ? E.peak : 0, log: MUSIC.log.slice(-12), stingers: MUSIC.stingers.slice(-10),
      };
    },
  };
});
