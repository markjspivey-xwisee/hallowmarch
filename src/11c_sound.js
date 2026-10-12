/* ================================================================== */
/* [audio2] the March heard as it is seen: sounds placed in the world,  */
/* faded by distance, panned by bearing, muffled by walls and water,    */
/* capped by loudness; the places' own air; what matters heard first    */
/* ================================================================== */
// sfxAt(name, x, y, z, o) asks for a sound at a place. Requests wait for the frame's end (sndFlush, from updateAudio):
// then each is weighed at the listener (the player's head, or the camera when it is far from the player): its distance
// (full within the sound's ref metres, an inverse fall beyond and a fade to nothing at max), the air (the far ones lose
// their highs), a wall, a closed door or a hill between (shotHit: a third as loud and dull) and the water (a sound
// under it heard from above, dull). The loudest and nearest are played, up to a cap of voices (the quietest give way);
// a far one starts a little late (sound is slower than light). A voice is the sound's own synth (11_audio.js sfxSynth,
// or SND_SYNTH here) written into its own gain, filter and stereo panner, let go when it falls silent.
// Continuous sources (fires, a forge) hold a few looping voices, given each quarter second to the loudest near the
// listener (sndLoops). The air (sndAir) follows the place: wind (stronger high up, on a keep's walls and in the
// mountains, a howl in a storm), leaves in the woods, insects in a summer meadow, crickets on warm nights, rain on the
// ground or drumming on the roof over you, a lake's lapping, a town's murmur, a hall's or the Barrow's echo (a reverb
// send); and the world's own voices placed where they are (birds in the trees, hens, sheep, cattle, a dog, the town's
// chatter and its forge, an owl and the wolves at night, a battle heard from afar before it is seen).
// What matters is heard over what does not: a foe's shot loosed at you, a priest's flare, a ward breaking, a keep's
// alarm are cues (never capped; the rest dips under them). The Volume, Effects, Ambience and Music settings.
// Tests: window.__hm.snd (tools/tests/audio2.py).

const SOUND_LEVELS = [['off', 'Off', 0], ['low', 'Low', 0.5], ['medium', 'Medium', 1], ['high', 'High', 1.4]];
const SND = {
  ready: false, on: true, q: [], qMax: 96, voices: [], cap: 22, loops: [], air: null, rev: null, fxIn: null, cueBus: null,
  L: { x: 0, y: 0, z: 0, rx: 1, rz: 0, fx: 0, fz: -1, ok: false, under: false },
  occ: new Map(), place: new Map(), bufs: {}, clock: { loops: 0, air: 0, life: 0, battle: 0, occ: 0 },
  stats: { asked: 0, played: 0, far: 0, quiet: 0, stale: 0, capped: 0, stolen: 0, occluded: 0, occTests: 0, cues: 0, flushes: 0, perName: 0, gap: 0 },
  count: {}, played: {}, log: [], battle: [], duckUntil: 0, alarmAt: {}, newsCueAt: -99, incomingAt: -99, lastLife: {},
};
// each sound's reach: ref (full within), max (nothing beyond), lvl (how loud it is at its source, for the cap), per
// (at most this many of it in one frame), gap (seconds between two at the same place), cue (heard over the rest), roll
const SND_DEF = {
  _: { ref: 4, max: 60, lvl: 0.4, per: 3, gap: 0.05 },
  hit: { ref: 3, max: 55, lvl: 0.6, per: 4 }, swing: { ref: 2.5, max: 32, lvl: 0.35, per: 3 }, thud: { ref: 4, max: 70, lvl: 0.6 },
  bow: { ref: 3, max: 50, lvl: 0.35, per: 3 }, zap: { ref: 3, max: 50, lvl: 0.3 }, cast: { ref: 3, max: 40, lvl: 0.22, per: 2 },
  fire: { ref: 4, max: 75, lvl: 0.6 }, frost: { ref: 4, max: 60, lvl: 0.35 }, holy: { ref: 4, max: 60, lvl: 0.3 }, heal: { ref: 4, max: 40, lvl: 0.3 },
  blink: { ref: 3, max: 50, lvl: 0.35 }, boom: { ref: 14, max: 300, lvl: 1, roll: 0.8 }, crash: { ref: 12, max: 240, lvl: 1, roll: 0.8 },
  horn: { ref: 25, max: 500, lvl: 0.5, roll: 0.6 }, death: { ref: 4, max: 50, lvl: 0.45 }, fizzle: { ref: 3, max: 30, lvl: 0.2 },
  hoof: { ref: 3, max: 50, lvl: 0.3, per: 4, gap: 0.03 }, hoofFast: { ref: 3, max: 55, lvl: 0.32, per: 4, gap: 0.03 }, whinny: { ref: 5, max: 100, lvl: 0.4 },
  roar: { ref: 30, max: 520, lvl: 1, roll: 0.6 }, wingbeat: { ref: 16, max: 180, lvl: 0.7 }, breath: { ref: 16, max: 180, lvl: 0.9 },
  thunder: { ref: 600, max: 6000, lvl: 0.8 }, thunderNear: { ref: 400, max: 3000, lvl: 1 },
  chain: { ref: 8, max: 100, lvl: 0.6 }, grind: { ref: 8, max: 100, lvl: 0.6 }, roarSmall: { ref: 6, max: 80, lvl: 0.5 }, ventRoar: { ref: 6, max: 70, lvl: 0.6 },
  kingRoar: { ref: 16, max: 140, lvl: 1 }, raise: { ref: 5, max: 55, lvl: 0.4 }, lance: { ref: 6, max: 70, lvl: 0.6 }, kingDeath: { ref: 16, max: 160, lvl: 1 },
  whirl: { ref: 4, max: 50, lvl: 0.45 }, slam: { ref: 6, max: 90, lvl: 0.8 }, shock: { ref: 5, max: 65, lvl: 0.6 }, blizzard: { ref: 8, max: 90, lvl: 0.6 },
  pillar: { ref: 6, max: 80, lvl: 0.6 }, renew: { ref: 4, max: 40, lvl: 0.3 }, deadeye: { ref: 3, max: 60, lvl: 0.45 }, ignite: { ref: 4, max: 65, lvl: 0.4 },
  hiss: { ref: 4, max: 50, lvl: 0.3 }, drip: { ref: 3, max: 30, lvl: 0.12, per: 2 }, wade: { ref: 3, max: 35, lvl: 0.2 }, swim: { ref: 3, max: 35, lvl: 0.2 },
  splash: { ref: 4, max: 50, lvl: 0.35 }, splashBig: { ref: 5, max: 70, lvl: 0.55 },
  // [audio2] the sounds of version 16
  chisel: { ref: 4, max: 65, lvl: 0.32, per: 2 }, mallet: { ref: 4, max: 75, lvl: 0.38, per: 3 }, creak: { ref: 3, max: 35, lvl: 0.18, per: 2, gap: 0.4 },
  saw: { ref: 4, max: 55, lvl: 0.25, per: 1, gap: 0.8 }, crack: { ref: 8, max: 150, lvl: 0.7 }, tiles: { ref: 8, max: 130, lvl: 0.6 },
  collapse: { ref: 14, max: 340, lvl: 1, roll: 0.7 }, timberfall: { ref: 10, max: 230, lvl: 0.85, roll: 0.8 }, beat: { ref: 3, max: 50, lvl: 0.35, per: 4, gap: 0.12 },
  shout: { ref: 6, max: 130, lvl: 0.45, per: 2, gap: 0.5 }, warcry: { ref: 10, max: 260, lvl: 0.7, per: 1, gap: 2 }, march: { ref: 6, max: 100, lvl: 0.4, per: 2, gap: 0.3 },
  rubble: { ref: 3, max: 40, lvl: 0.25, per: 3, gap: 0.2 }, oar: { ref: 3, max: 60, lvl: 0.3, per: 3, gap: 0.3 }, plop: { ref: 3, max: 45, lvl: 0.22, per: 2 },
  bell: { ref: 40, max: 950, lvl: 0.7, roll: 0.5, per: 1, gap: 0.6 }, clash: { ref: 4, max: 70, lvl: 0.5, per: 3 },
  chirp: { ref: 5, max: 70, lvl: 0.15, per: 1 }, bark: { ref: 6, max: 110, lvl: 0.35, per: 1, gap: 1 }, cluck: { ref: 3, max: 40, lvl: 0.18, per: 1, gap: 1 },
  bleat: { ref: 4, max: 70, lvl: 0.25, per: 1, gap: 1 }, moo: { ref: 6, max: 130, lvl: 0.35, per: 1, gap: 1.5 }, howl: { ref: 40, max: 700, lvl: 0.4, per: 1, gap: 3, roll: 0.5 },
  owl: { ref: 12, max: 220, lvl: 0.22, per: 1, gap: 3 }, caw: { ref: 10, max: 220, lvl: 0.3, per: 1, gap: 1 }, woodpecker: { ref: 8, max: 160, lvl: 0.25, per: 1, gap: 3 },
  anvil: { ref: 6, max: 120, lvl: 0.4, per: 1, gap: 0.25 }, chatter: { ref: 3, max: 30, lvl: 0.14, per: 2, gap: 0.9 }, cartwheel: { ref: 4, max: 60, lvl: 0.2, per: 1, gap: 1.5 },
  // cues: heard over the rest, never capped
  loose: { ref: 4, max: 90, lvl: 0.5, cue: true, per: 1, gap: 0.25 }, incoming: { ref: 400, max: 4000, lvl: 0.6, cue: true, per: 1, gap: 0.35 },
  flare: { ref: 5, max: 80, lvl: 0.6, cue: true, per: 1 }, wardbreak: { ref: 5, max: 70, lvl: 0.6, cue: true, per: 1 },
  alarmBell: { ref: 60, max: 1600, lvl: 0.7, roll: 0.5, cue: true, per: 1, gap: 1.2 },
};
const SND_SYNTH = {};
const _snd = { r: (a, b) => a + Math.random() * (b - a) };

/* ------------------------------------------------------------------ */
/* the levels: Volume, Effects, Ambience (the Music has its own)        */
/* ------------------------------------------------------------------ */
function soundLevelKey(v) {
  let best = SOUND_LEVELS[0];
  for (const L of SOUND_LEVELS) if (Math.abs(L[2] - v) < Math.abs(best[2] - v)) best = L;
  return best[0];
}
// kind: 'master' (Volume: Off is the old Sound Off), 'sfx' (Effects), 'amb' (Ambience)
function setSoundLevel(kind, v) {
  v = clamp(Number.isFinite(+v) ? +v : 1, 0, 1.4);
  if (kind === 'master') {
    if (v <= 0) { setSound(false); return; }
    AUDIO.lvl.master = v;
    setSound(true);
    return;
  }
  if (kind !== 'sfx' && kind !== 'amb') return;
  AUDIO.lvl[kind] = v;
  if (!AUDIO.ctx) return;
  const now = AUDIO.ctx.currentTime;
  if (kind === 'sfx' && AUDIO.fx) AUDIO.fx.gain.setTargetAtTime(AUDIO_BASE.sfx * v, now, 0.05);
  if (kind === 'amb' && AUDIO.amb) AUDIO.amb.bus.gain.setTargetAtTime(AUDIO_BASE.amb * v, now, 0.05);
}
const soundVolumeKey = () => (AUDIO.on ? soundLevelKey(AUDIO.lvl.master) : 'off');
// the settings menu's rows (10_ui.js): Volume (Off is the old Sound Off), Effects, Ambience
const SOUND_ROWS = [['set-s', 'Volume', 'master'], ['set-fx', 'Effects', 'sfx'], ['set-amb', 'Ambience', 'amb']];
function soundSettingsHTML() {
  return SOUND_ROWS.map(([id, label, kind]) => {
    const cur = kind === 'master' ? soundVolumeKey() : soundLevelKey(AUDIO.lvl[kind]);
    return `<div class="setrow"><span>${label}</span><div class="seg" id="${id}">${SOUND_LEVELS.map(([k, l]) => `<button type="button" data-v="${k}" aria-checked="${cur === k}">${l}</button>`).join('')}</div></div>`;
  }).join('');
}
function soundSettingsWire() {
  for (const [id, , kind] of SOUND_ROWS) {
    const el = document.getElementById(id);
    if (!el) continue;
    el.onclick = (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      const L = SOUND_LEVELS.find((x) => x[0] === b.dataset.v);
      if (!L) return;
      setSoundLevel(kind, L[2]);
      renderMenu('settings');
      saveSoon();
      if (kind !== 'master' || L[2] > 0) sfx('click');
    };
  }
}
// a save's settings: numbers 0 to 1.4 (junk is left alone); an old save's Sound On or Off is kept as it was
function soundApplySettings(st) {
  if (!st) return;
  const ok = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1.4;
  if (ok(st.master) && st.master > 0) AUDIO.lvl.master = st.master;
  if (ok(st.effects)) setSoundLevel('sfx', st.effects);
  if (ok(st.ambience)) setSoundLevel('amb', st.ambience);
  if (AUDIO.master && AUDIO.ctx) AUDIO.master.gain.setTargetAtTime(AUDIO.on ? AUDIO_BASE.master * AUDIO.lvl.master : 0, AUDIO.ctx.currentTime, 0.05);
}

/* ------------------------------------------------------------------ */
/* the engine                                                          */
/* ------------------------------------------------------------------ */
function sndCount(name) { SND.count[name] = (SND.count[name] || 0) + 1; }
function sndInit(ctx) {
  if (SND.ready) return;
  try {
    // the placed sounds' own group (they dip under a cue), the cues straight to the effects bus
    SND.fxIn = ctx.createGain(); SND.fxIn.connect(AUDIO.fx);
    SND.cueBus = AUDIO.fx;
    // the space: a hall's or the Barrow's echo, sent from the effects and the air
    const rev = ctx.createConvolver();
    rev.buffer = sndImpulse(ctx, IS_TOUCH || quality.level === 'low' ? 1.1 : 1.7);
    const send = ctx.createGain(); send.gain.value = 0;
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 220;
    AUDIO.fx.connect(send); AUDIO.amb.bus.connect(send);
    send.connect(hp).connect(rev).connect(AUDIO.master);
    SND.rev = { send, rev };
    // a phone's speaker has no bass: the low thumps are given their harmonics there (the ear hears the fundamental
    // they imply), and nothing below 90 Hz is sent to a speaker that cannot move it
    if (IS_TOUCH) {
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 150;
      const ws = ctx.createWaveShaper(); ws.curve = sndHarmCurve(); ws.oversample = '2x';
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 330; bp.Q.value = 0.6;
      const g = ctx.createGain(); g.gain.value = 0.55;
      AUDIO.fx.connect(lp).connect(ws).connect(bp).connect(g).connect(AUDIO.master);
      const cut = ctx.createBiquadFilter(); cut.type = 'highpass'; cut.frequency.value = 90; cut.Q.value = 0.6;
      AUDIO.comp.disconnect(); AUDIO.comp.connect(cut).connect(AUDIO.lim);
      SND.phone = { lp, ws, bp, g, cut };
    }
    sndAirInit(ctx);
    sndLoopsInit(ctx);
    SND.ready = true;
  } catch (e) { SND.ready = false; if (AUDIO.debug) throw e; }
}
// the harmonics of a low thump: an even and an odd curve, so both the second and the third partial are heard
function sndHarmCurve() {
  const n = 1024, c = new Float32Array(n);
  for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; c[i] = Math.tanh(2.6 * x) * 0.7 + 0.45 * x * x - 0.15; }
  return c;
}
function sndImpulse(ctx, sec) {
  const sr = ctx.sampleRate, n = Math.floor(sr * sec), buf = ctx.createBuffer(2, n, sr);
  const pre = Math.floor(sr * 0.008), decay = 6.9 / sec;
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    for (let k = 0; k < 8; k++) { const at = pre + Math.floor(sr * (0.004 + Math.random() * 0.05)); if (at < n) d[at] += (Math.random() < 0.5 ? -1 : 1) * (0.6 - k * 0.06); }
    let lp = 0;
    for (let i = pre; i < n; i++) {
      const tt = (i - pre) / sr, env = Math.exp(-decay * tt) * Math.min(1, tt / 0.02);
      lp += (Math.random() * 2 - 1 - lp) * (0.55 * Math.exp(-tt * 2.2) + 0.05);
      d[i] += lp * env * 0.6;
    }
  }
  return buf;
}
// where the ears are: the player's head while the play camera follows it, else the camera; facing the camera's way
function sndListener() {
  const L = SND.L, cp = camera.position, m = camera.matrixWorld.elements;
  let fx = -m[8], fz = -m[10];
  const fl = Math.hypot(fx, fz);
  if (fl > 1e-4) { fx /= fl; fz /= fl; } else { fx = 0; fz = -1; }
  L.fx = fx; L.fz = fz; L.rx = -fz; L.rz = fx;
  const P = GAME.player;
  if (P && GAME.started && CAM.mode === 'play' && dist2(P.x, P.z, cp.x, cp.z) < 30 * 30) { L.x = P.x; L.y = P.y + 1.6 * (P.scale || 1); L.z = P.z; }
  else { L.x = cp.x; L.y = cp.y; L.z = cp.z; }
  L.under = !!(typeof DIVE !== 'undefined' && DIVE.under && DIVE.under.on);
  L.ok = isFiniteNum(L.x + L.y + L.z);
}
// how loud a sound of def is d metres off (0..1)
function sndDistGain(def, d, o) {
  const ref = (o && o.ref) || def.ref, max = (o && o.max) || def.max;
  if (d >= max) return 0;
  let g = d <= ref ? 1 : ref / (ref + (d - ref) * (def.roll || 1));
  const f0 = max * 0.55;
  if (d > f0) g *= 1 - sstep(f0, max, d);
  return g;
}
// the mix for a place: out.g (gain), out.pan, out.fc (the low-pass: the air, a wall, the back of the head), out.d
function sndMixAt(def, x, y, z, o, out) {
  const L = SND.L;
  const dx = x - L.x, dz = z - L.z, dy = y == null ? 0 : y - L.y, d = Math.hypot(dx, dy, dz);
  out.d = d;
  out.g = sndDistGain(def, d, o);
  const hd = Math.hypot(dx, dz);
  let pan = 0, back = 0;
  if (hd > 0.05) {
    const s = (dx * L.rx + dz * L.rz) / hd, f = (dx * L.fx + dz * L.fz) / hd;
    // a sound close by surrounds you; one off to the side is heard on that side, not hard in one ear
    pan = s * 0.82 * sstep(0.4, Math.max(1.5, ((o && o.ref) || def.ref) * 1.2), hd);
    back = Math.max(0, -f);
  }
  out.pan = clamp(pan, -1, 1);
  // the air takes the highs of a far sound; a sound behind you is a little duller
  out.fc = clamp(20000 / (1 + d / 45), 900, 20000) * (1 - 0.3 * back);
  out.g *= 1 - 0.12 * back;
  return out;
}
const _sndMix = { g: 0, pan: 0, fc: 20000, d: 0 };
// a wall, a closed door, a roof or a hill between the listener and the place (cached a moment)
const SND_WSTATS = { tests: 0, hits: 0, floors: 0, ground: 0, roofs: 0, windows: 0, crenels: 0, slits: 0, embrasure: 0, shows: 0 };
function sndOcc(x, y, z) {
  const L = SND.L;
  if (y == null) y = heightAt(x, z) + 1.2;
  const key = ((x / 3) | 0) + ':' + ((z / 3) | 0) + ':' + ((y / 2) | 0) + '|' + ((L.x / 1.5) | 0) + ':' + ((L.z / 1.5) | 0) + ':' + ((L.y / 1.5) | 0);
  const now = GAME.t, c = SND.occ.get(key);
  if (c && now - c.t < 0.5 && now >= c.t) return c.k;
  let k = 0;
  if (typeof shotHit === 'function' && WALLS.on) {
    SND.stats.occTests++;
    const keep = WALLS.stats; WALLS.stats = SND_WSTATS; // the walls' own counts are the tests' (walls.py): not ours
    try {
      // from just short of each end, so the wall a sound is made against or the floor under the listener do not count
      const dx = x - L.x, dy = y - L.y, dz = z - L.z, d = Math.hypot(dx, dy, dz) || 1, a = Math.min(0.6, d * 0.1);
      const R = shotHit(L.x + (dx / d) * a, L.y + (dy / d) * a, L.z + (dz / d) * a, x - (dx / d) * a, y - (dy / d) * a, z - (dz / d) * a, { ground: false });
      if (R) k = 1;
    } catch (e) { k = 0; } finally { WALLS.stats = keep; }
  }
  // a hill: the ground between rises over the line (every 6 m, the far ones only)
  if (!k) {
    const dx = x - L.x, dz = z - L.z, hd = Math.hypot(dx, dz);
    if (hd > 25 && !inDungeonX(x)) {
      const n = Math.min(24, Math.floor(hd / 6));
      for (let i = 1; i < n; i++) {
        const t = i / n, gy = heightAt(L.x + dx * t, L.z + dz * t);
        if (gy > L.y + (y - L.y) * t + 1.5) { k = 0.7; break; }
      }
    }
  }
  if (SND.occ.size > 400) SND.occ.clear();
  SND.occ.set(key, { t: now, k });
  return k;
}
// is a place under the water (a diver's bubbles, a fish under the surface)
function sndUnderWater(x, y, z) {
  if (y == null) return false;
  const w = waterAt(x, z);
  return !!w && y < w.y - 0.25;
}
// ask for a sound at a place; o: { vol, ref, max, cue, at (a delay in seconds), ...what its synth wants }
function sfxAt(name, x, y, z, o = null) {
  sndCount(name);
  SND.stats.asked++;
  if (!AUDIO.ctx || !AUDIO.on || !SND.ready || !SND.on || AUDIO.ctx.state !== 'running') return;
  if (!isFiniteNum(x + z) || (y != null && !isFiniteNum(y))) return;
  const def = SND_DEF[name] || SND_DEF._, L = SND.L;
  const max = (o && o.max) || def.max, dx = x - L.x, dz = z - L.z;
  if (dx * dx + dz * dz > max * max) { SND.stats.far++; return; }
  const q = SND.q;
  if (q.length >= SND.qMax) { // the queue is full: the newest replaces the oldest
    q.shift(); SND.stats.stale++;
  }
  q.push({ name, x, y, z, o, t: GAME.t, def });
}
// a sound at a body (its middle, or its head)
function sfxAtE(name, e, o = null, h = 1.1) { if (e) sfxAt(name, e.x, (e.y || 0) + h * (e.scale || 1), e.z, o); }
// the frame's requests: weighed, the loudest played up to the cap
const _sndPer = {};
function sndFlush() {
  const q = SND.q;
  if (!q.length) return;
  SND.stats.flushes++;
  const ctx = AUDIO.ctx, now = ctx.currentTime, gt = GAME.t;
  const mix = _sndMix;
  for (const r of q) {
    if (gt - r.t > 0.35 || r.t > gt + 0.01) { r.loud = -1; SND.stats.stale++; continue; }
    sndMixAt(r.def, r.x, r.y, r.z, r.o, mix);
    r.g = mix.g * ((r.o && r.o.vol) ?? 1); r.pan = mix.pan; r.fc = mix.fc; r.d = mix.d;
    r.loud = r.def.lvl * r.g * (r.def.cue || (r.o && r.o.cue) ? 6 : 1);
  }
  q.sort((a, b) => b.loud - a.loud);
  for (const k in _sndPer) _sndPer[k] = 0;
  let live = 0;
  for (const v of SND.voices) if (v.end > now) live++;
  const cap = SND.cap;
  for (const r of q) {
    if (r.loud < 0) continue;
    const def = r.def, cue = def.cue || (r.o && r.o.cue);
    if (r.loud < 0.0025) { SND.stats.quiet++; continue; }
    const pn = (_sndPer[r.name] || 0);
    if (pn >= (def.per || 3)) { SND.stats.perName++; continue; }
    // two of a sound at one place within its gap: the second is the first's echo
    const pk = r.name + ':' + Math.round(r.x / 4) + ':' + Math.round(r.z / 4), pl = SND.place.get(pk);
    if (pl !== undefined && now - pl < (def.gap ?? 0.05)) { SND.stats.gap++; continue; }
    if (live >= cap && !cue) {
      // the quietest voice still sounding gives way to a louder one
      let qv = null, ql = Infinity;
      for (const v of SND.voices) {
        if (v.end <= now || v.cue || v.stolen) continue;
        const left = clamp((v.end - now) / Math.max(0.05, v.end - v.t0), 0, 1), l = v.loud * (0.3 + 0.7 * left);
        if (l < ql) { ql = l; qv = v; }
      }
      if (!qv || r.loud < ql * 1.5) { SND.stats.capped++; continue; }
      qv.stolen = true; qv.vg.gain.setTargetAtTime(0, now, 0.02); qv.end = now + 0.12;
      SND.stats.stolen++; live--;
    }
    _sndPer[r.name] = pn + 1;
    SND.place.set(pk, now);
    // a wall or a hill between; the water
    let g = r.g, fc = r.fc, occ = 0;
    if (r.d > 1.6 && r.d < 110 && !(r.o && r.o.noOcc)) {
      occ = sndOcc(r.x, r.y, r.z);
      if (occ) { g *= 1 - 0.68 * occ; fc = Math.min(fc, 650 + 900 * (1 - occ)); SND.stats.occluded++; }
    }
    if (!SND.L.under && sndUnderWater(r.x, r.y, r.z)) { g *= 0.4; fc = Math.min(fc, 500); }
    // sound is slower than light: a far one is heard a moment after it is seen
    const delay = (r.o && r.o.at || 0) + (r.d > 25 && !(r.o && r.o.now) ? Math.min(0.55, (r.d / 343) * 0.8) : 0);
    sndPlay(r.name, now + 0.006 + delay, g, r.pan, fc, r.loud, cue, r.o);
    live++;
    if (SND.place.size > 300) SND.place.clear();
    SND.played[r.name] = (SND.played[r.name] || 0) + 1;
    SND.log.push([r.name, Math.round(r.d * 10) / 10, Math.round(g * 1000) / 1000, Math.round(r.pan * 100) / 100, Math.round(fc), occ]);
    if (SND.log.length > 60) SND.log.shift();
  }
  q.length = 0;
}
// a voice: the synth written into its own gain, low-pass and panner
function sndPlay(name, t, g, pan, fc, loud, cue, o) {
  const ctx = AUDIO.ctx;
  const vg = ctx.createGain(); vg.gain.value = g;
  let out = vg, f = null, p = null;
  if (fc < 15000) { f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = fc; f.Q.value = 0.6; out.connect(f); out = f; }
  if (Math.abs(pan) > 0.02 && ctx.createStereoPanner) { p = ctx.createStereoPanner(); p.pan.value = pan; out.connect(p); out = p; }
  out.connect(cue ? SND.cueBus : SND.fxIn);
  const keep = AUDIO.sfxBus;
  AUDIO.sfxBus = vg; AUDIO.voiceEnd = 0;
  try { sfxSynth(name, t, 1, o); } finally { AUDIO.sfxBus = keep; }
  const v = { vg, f, p, t0: t, end: Math.max(AUDIO.voiceEnd, t + 0.1), loud, name, cue: !!cue, stolen: false };
  SND.voices.push(v);
  SND.stats.played++;
  if (cue) { SND.stats.cues++; sndDuck(now0(), 0.9); }
  return v;
}
const now0 = () => AUDIO.ctx.currentTime;
// the rest dips under a cue for a moment
function sndDuck(now, sec) {
  if (!SND.fxIn) return;
  SND.duckUntil = now + sec;
  SND.fxIn.gain.cancelScheduledValues(now);
  SND.fxIn.gain.setTargetAtTime(0.55, now, 0.02);
  SND.fxIn.gain.setTargetAtTime(1, now + sec, 0.25);
  if (SND.air && SND.air.duck) { SND.air.duck.gain.cancelScheduledValues(now); SND.air.duck.gain.setTargetAtTime(0.6, now, 0.03); SND.air.duck.gain.setTargetAtTime(1, now + sec, 0.4); }
}
// voices that have fallen silent let go of their nodes
function sndReap(now) {
  const V = SND.voices;
  let j = 0;
  for (let i = 0; i < V.length; i++) {
    const v = V[i];
    if (v.end + 0.08 < now) { try { v.vg.disconnect(); if (v.f) v.f.disconnect(); if (v.p) v.p.disconnect(); } catch (e) { /* gone */ } continue; }
    V[j++] = v;
  }
  V.length = j;
}
function sndCapNow() { return IS_TOUCH ? 12 : quality.level === 'low' ? 14 : quality.level === 'medium' ? 20 : 26; }

/* ------------------------------------------------------------------ */
/* each frame (from updateAudio)                                       */
/* ------------------------------------------------------------------ */
function sndUpdate(dt) {
  if (!SND.ready) return false;
  const now = AUDIO.ctx.currentTime;
  sndListener();
  SND.cap = sndCapNow();
  if (SND.L.ok) sndFlush(); else SND.q.length = 0;
  sndReap(now);
  const C = SND.clock;
  C.loops -= dt; C.air -= dt; C.life -= dt; C.battle -= dt;
  if (C.loops <= 0) { C.loops = 0.25; sndLoopsStep(now); }
  if (C.air <= 0) { C.air = 0.25; sndAirStep(now, 0.25); }
  if (C.life <= 0) { C.life = 0.5; if (GAME.started && GAME.player) sndLifeStep(now); }
  if (C.battle <= 0) { C.battle = 0.5; sndBattleStep(now); }
  return true;
}

/* ------------------------------------------------------------------ */
/* small synth parts (into AUDIO.sfxBus, so into the voice being made)  */
/* ------------------------------------------------------------------ */
// a tone through a filter: f [type, from, to, q]
function sndToneF(type, f0, f1, t, dur, vol, a, F) {
  const ctx = AUDIO.ctx, o = ctx.createOscillator(), g = ctx.createGain(), fl = ctx.createBiquadFilter();
  o.type = type; o.frequency.setValueAtTime(f0, t);
  if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
  fl.type = F[0]; fl.Q.value = F[3] ?? 1; fl.frequency.setValueAtTime(F[1], t);
  if (F[2] !== F[1]) fl.frequency.exponentialRampToValueAtTime(Math.max(30, F[2]), t + dur);
  env(g, t, a, vol, dur);
  o.connect(fl).connect(g).connect(AUDIO.sfxBus);
  o.start(t); o.stop(t + a + dur + 0.05);
  if (t + a + dur + 0.06 > AUDIO.voiceEnd) AUDIO.voiceEnd = t + a + dur + 0.06;
  return o;
}
// a voice: a buzz at f0 (rising to fPeak, falling to f1) through the vowel's formants, with breath
const SND_VOWEL = { ah: [[750, 1], [1150, 0.55], [2500, 0.2]], eh: [[530, 1], [1850, 0.45], [2500, 0.2]], oh: [[500, 1], [850, 0.5], [2400, 0.12]], oo: [[330, 1], [870, 0.3], [2250, 0.08]], ay: [[650, 1], [1700, 0.5], [2600, 0.2]], ee: [[300, 1], [2250, 0.4], [2950, 0.2]] };
function sndVoiceSyn(t, f0, fPeak, f1, dur, vol, vowel, o = {}) {
  const ctx = AUDIO.ctx, V = SND_VOWEL[vowel] || SND_VOWEL.ah, sc = o.formK || 1;
  const os = ctx.createOscillator(); os.type = 'sawtooth';
  const pk = t + dur * (o.peakAt ?? 0.3);
  os.frequency.setValueAtTime(f0, t);
  os.frequency.linearRampToValueAtTime(fPeak, pk);
  os.frequency.exponentialRampToValueAtTime(Math.max(40, f1), t + dur);
  if (o.vib) { const l = ctx.createOscillator(), lg = ctx.createGain(); l.frequency.value = o.vib[0]; lg.gain.value = o.vib[1]; l.connect(lg).connect(os.detune); l.start(t); l.stop(t + dur + 0.1); }
  const g = ctx.createGain();
  const a = o.a ?? 0.04;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + a);
  g.gain.setValueAtTime(vol * 0.85, t + dur * 0.7);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  const sum = ctx.createGain(); sum.gain.value = 1;
  for (const [ff, k] of V) {
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = ff * sc; bp.Q.value = o.q ?? 5;
    const bg = ctx.createGain(); bg.gain.value = k * 2.2;
    os.connect(bp).connect(bg).connect(sum);
  }
  sum.connect(g).connect(AUDIO.sfxBus);
  os.start(t); os.stop(t + dur + 0.05);
  if (o.breath) noiseBurst(t, dur * 0.8, vol * o.breath, 'bandpass', V[1][0] * sc, V[0][0] * sc, 1.2, a);
  if (t + dur + 0.06 > AUDIO.voiceEnd) AUDIO.voiceEnd = t + dur + 0.06;
}
// a struck metal or stone: inharmonic partials that ring and die
function sndRing(t, f, parts, dur, vol, a = 0.001) {
  for (const [k, amp, dk] of parts) tone(k > 3 ? 'sine' : 'triangle', f * k, f * k * 0.998, t, dur * dk, vol * amp, a);
}

/* ------------------------------------------------------------------ */
/* the sounds of version 16, each made here (no samples), each a little */
/* different every time                                                 */
/* ------------------------------------------------------------------ */
const R_ = _snd.r;
Object.assign(SND_SYNTH, {
  // a chisel struck to dress a stone: a bright tick, the stone's short ring and a spray of grit
  chisel(t) {
    const n = Math.random() < 0.45 ? 2 : 1;
    for (let i = 0; i < n; i++) {
      const t0 = t + i * R_(0.13, 0.19), f = R_(2200, 3100);
      noiseBurst(t0, 0.025, 0.2, 'highpass', 3200, 5000, 0.9, 0.001);
      tone('triangle', f, f * 0.97, t0, 0.08, 0.06, 0.001);
      tone('sine', f * 1.53, f * 1.5, t0, 0.05, 0.03, 0.001);
      noiseBurst(t0 + 0.006, 0.07, 0.06, 'bandpass', R_(1100, 1500), 800, 2, 0.002);
    }
  },
  // a mallet or a hammer on timber: a woody knock with its body
  mallet(t) {
    const f = R_(170, 250);
    tone('sine', f * 2.2, f, t, 0.09, 0.22, 0.001);
    noiseBurst(t, 0.05, 0.16, 'bandpass', R_(850, 1300), 600, 1.6, 0.001);
    tone('triangle', f * 3.1, f * 2.9, t, 0.05, 0.05, 0.001);
  },
  // timber under strain: the wood sticks and slips, a rough rub through its resonances
  creak(t) {
    const d = R_(0.22, 0.5), r0 = R_(16, 30), r1 = r0 * R_(0.7, 1.6);
    sndToneF('sawtooth', r0, r1, t, d, 0.18, 0.06, ['bandpass', R_(480, 780), R_(520, 900), 9]);
    sndToneF('sawtooth', r0 * 1.01, r1, t, d, 0.1, 0.06, ['bandpass', R_(1200, 1700), R_(1100, 1800), 8]);
  },
  // a hand saw: push and pull
  saw(t) {
    const n = 3 + Math.floor(Math.random() * 2);
    for (let i = 0; i < n; i++) { const t0 = t + i * 0.36; noiseBurst(t0, 0.2, 0.09, 'bandpass', 2600, 3400, 2.2, 0.05); noiseBurst(t0 + 0.2, 0.14, 0.05, 'bandpass', 1900, 2300, 2, 0.04); }
  },
  // masonry cracking: a snap, a dull thump, then crumbs falling
  crack(t) {
    noiseBurst(t, 0.05, 0.42, 'highpass', 1800, 900, 0.8, 0.001);
    tone('sine', R_(110, 140), 55, t, 0.2, 0.3, 0.002);
    noiseBurst(t, 0.18, 0.14, 'bandpass', 700, 300, 1.2, 0.003);
    for (let i = 0; i < 7; i++) { const t0 = t + 0.08 + Math.random() * 0.7; noiseBurst(t0, 0.02, R_(0.03, 0.08), 'bandpass', R_(1800, 3800), 1500, 2.5, 0.001); }
    noiseBurst(t + 0.15, 0.9, 0.035, 'bandpass', 3200, 2400, 1.5, 0.2);
  },
  // slates, tiles or shingles knocked off a roof: a clatter thinning out
  tiles(t) {
    noiseBurst(t, 0.12, 0.2, 'bandpass', 1400, 700, 1, 0.002);
    for (let i = 0; i < 14; i++) {
      const t0 = t + Math.pow(Math.random(), 1.6) * 0.95, f = R_(1300, 3400);
      tone('triangle', f, f * 0.94, t0, R_(0.025, 0.06), R_(0.02, 0.06), 0.001);
      noiseBurst(t0, 0.02, 0.04, 'bandpass', f * 0.8, f * 0.6, 2, 0.001);
    }
  },
  // a house or a wall coming down: a long rumble, stones tumbling, dust settling
  collapse(t) {
    noiseBurst(t, 2.2, 0.5, 'lowpass', 1400, 90, 0.8, 0.01);
    tone('sine', R_(64, 78), 30, t, 1.8, 0.45, 0.02);
    for (let i = 0; i < 18; i++) {
      const t0 = t + 0.1 + Math.pow(Math.random(), 1.4) * 1.9, f = R_(90, 280);
      tone('sine', f * 1.6, f, t0, R_(0.06, 0.14), R_(0.05, 0.16), 0.002);
      noiseBurst(t0, 0.06, R_(0.04, 0.12), 'bandpass', R_(500, 1600), 400, 1.6, 0.002);
    }
    noiseBurst(t + 1.4, 1.6, 0.04, 'bandpass', 2600, 1800, 1, 0.4);
  },
  // burning timbers falling: the wood gives with a crack, a heavy thud, sparks
  timberfall(t) {
    noiseBurst(t, 0.06, 0.32, 'highpass', 1500, 800, 0.9, 0.001);
    sndToneF('sawtooth', R_(300, 420), 180, t, 0.12, 0.08, 0.002, ['bandpass', 900, 600, 3]);
    tone('sine', 95, 42, t + 0.18, 0.5, 0.42, 0.003);
    noiseBurst(t + 0.18, 0.5, 0.28, 'lowpass', 1100, 200, 0.8, 0.004);
    for (let i = 0; i < 5; i++) { const t0 = t + 0.3 + Math.random() * 0.6; tone('sine', R_(160, 260), 90, t0, 0.08, 0.08, 0.002); }
    noiseBurst(t + 0.25, 0.9, 0.08, 'bandpass', 900, 2600, 0.8, 0.15);
  },
  // a fire beater brought down on the flames: a wet slap, the hiss of what it beat out
  beat(t) {
    noiseBurst(t, 0.12, 0.3, 'lowpass', 1300, 320, 0.8, 0.003);
    tone('sine', R_(130, 160), 70, t, 0.1, 0.18, 0.002);
    noiseBurst(t + 0.03, 0.32, 0.06, 'highpass', 3000, 4500, 0.7, 0.03);
  },
  // a call: someone shouts (a word that is no word: a voice in the formants of a vowel)
  shout(t, v, o) {
    const male = Math.random() < 0.7, f = male ? R_(150, 230) : R_(270, 380), vw = ['ah', 'oh', 'ay', 'eh'][Math.floor(Math.random() * 4)];
    const d = R_(0.32, 0.55);
    sndVoiceSyn(t, f * 0.92, f * 1.18, f * 0.8, d, 0.11, vw, { breath: 0.25, formK: male ? 1 : 1.17, q: 6 });
    if (Math.random() < 0.55) sndVoiceSyn(t + d + R_(0.05, 0.12), f * 1.05, f * 1.12, f * 0.75, d * 0.8, 0.09, vw === 'ah' ? 'oh' : 'ah', { breath: 0.25, formK: male ? 1 : 1.17, q: 6 });
  },
  // a band's war cry: many voices together, long and falling
  warcry(t) {
    const n = 5 + Math.floor(Math.random() * 3);
    for (let i = 0; i < n; i++) {
      const f = R_(130, 260), d = R_(0.7, 1.15), t0 = t + Math.random() * 0.25;
      sndVoiceSyn(t0, f * 0.9, f * 1.2, f * 0.7, d, 0.05, ['ah', 'oh', 'ay'][i % 3], { breath: 0.4, q: 4, peakAt: 0.35 });
    }
    noiseBurst(t, 1.1, 0.05, 'bandpass', 900, 600, 0.8, 0.15);
  },
  // a column on the march: a tramp of feet together and a jingle of mail
  march(t) {
    const n = 3 + Math.floor(Math.random() * 3);
    for (let i = 0; i < n; i++) { const t0 = t + Math.random() * 0.14; noiseBurst(t0, 0.07, R_(0.06, 0.11), 'bandpass', R_(280, 520), 220, 1.2, 0.004); tone('sine', R_(80, 100), 55, t0, 0.07, 0.07, 0.003); }
    for (let i = 0; i < 4; i++) { const f = R_(3200, 6200), t0 = t + Math.random() * 0.2; tone('triangle', f, f * 0.98, t0, 0.05, 0.012, 0.001); }
  },
  // stones shifting underfoot on a fallen tower's rubble
  rubble(t) {
    const n = 3 + Math.floor(Math.random() * 3);
    for (let i = 0; i < n; i++) { const t0 = t + Math.random() * 0.25, f = R_(1100, 2600); tone('triangle', f, f * 0.9, t0, R_(0.02, 0.045), 0.05, 0.001); noiseBurst(t0, 0.03, 0.06, 'bandpass', f * 0.7, f * 0.5, 2, 0.001); }
    noiseBurst(t, 0.18, 0.05, 'bandpass', 2400, 1600, 1.2, 0.02);
  },
  // an oar's stroke: the blade dips, the thole pin creaks, the water runs off
  oar(t) {
    noiseBurst(t, 0.26, 0.12, 'lowpass', 1700, 420, 0.8, 0.01);
    tone('sine', R_(380, 460), R_(800, 1000), t + 0.02, 0.05, 0.03, 0.002);
    sndToneF('sawtooth', R_(22, 30), R_(30, 40), t + 0.05, 0.2, 0.06, 0.03, ['bandpass', R_(600, 800), 700, 8]);
    for (let i = 0; i < 2; i++) { const f = R_(1400, 2400); tone('sine', f, f * 0.55, t + 0.35 + i * R_(0.08, 0.16), 0.05, 0.015, 0.002); }
  },
  // a fish breaking the water: a pop, a little splash, drops falling back
  plop(t) {
    tone('sine', R_(280, 360), R_(900, 1300), t, 0.05, 0.08, 0.002);
    noiseBurst(t, 0.16, 0.08, 'lowpass', 2200, 600, 0.8, 0.003);
    for (let i = 0; i < 2 + Math.floor(Math.random() * 2); i++) { const f = R_(1500, 2600); tone('sine', f, f * 0.5, t + 0.18 + Math.random() * 0.3, 0.04, 0.012, 0.002); }
  },
  // a bronze bell: hum, prime, the minor third, fifth and octave, struck
  bell(t, v, o) {
    const f = (o && o.f) || R_(330, 400);
    sndRing(t, f, [[0.5, 0.4, 1], [1, 0.9, 0.8], [1.19, 0.5, 0.55], [1.5, 0.32, 0.45], [2, 0.42, 0.4], [2.52, 0.2, 0.25], [3.01, 0.12, 0.18]], 3.2, 0.1, 0.002);
    noiseBurst(t, 0.03, 0.08, 'bandpass', f * 4, f * 3, 2, 0.001);
  },
  alarmBell(t, v, o) { SND_SYNTH.bell(t, v, o); },
  // metal on metal: two blades meeting
  clash(t) {
    const f = R_(1400, 2400);
    sndRing(t, f, [[1, 0.8, 1], [2.76, 0.4, 0.6], [5.4, 0.2, 0.4]], 0.32, 0.07);
    noiseBurst(t, 0.04, 0.16, 'highpass', 3500, 2500, 1, 0.001);
  },
  // a bird among the trees: a short run of notes
  chirp(t) {
    const base = R_(2600, 4200), n = 2 + Math.floor(Math.random() * 3);
    for (let i = 0; i < n; i++) tone('sine', base * (1 + Math.random() * 0.15), base * (0.8 + Math.random() * 0.5), t + i * 0.11, 0.07, 0.05, 0.01);
  },
  // a dog's barks
  bark(t) {
    const n = 1 + Math.floor(Math.random() * 3), f = R_(380, 520);
    for (let i = 0; i < n; i++) { const t0 = t + i * R_(0.22, 0.34); sndVoiceSyn(t0, f, f * 1.15, f * 0.8, R_(0.08, 0.12), 0.12, 'ah', { a: 0.008, q: 3, breath: 0.6, formK: 1.3 }); }
  },
  cluck(t) {
    const n = 2 + Math.floor(Math.random() * 3);
    for (let i = 0; i < n; i++) { const f = R_(520, 760), t0 = t + i * R_(0.11, 0.2); sndToneF('triangle', f, f * 0.7, t0, 0.05, 0.08, 0.003, ['bandpass', 1200, 900, 2]); noiseBurst(t0, 0.04, 0.03, 'bandpass', 1800, 1200, 2, 0.002); }
  },
  bleat(t) { const f = R_(330, 440); sndVoiceSyn(t, f, f * 1.05, f * 0.92, R_(0.5, 0.8), 0.09, 'eh', { vib: [R_(24, 34), 70], q: 4, breath: 0.2, formK: 1.15 }); },
  moo(t) { const f = R_(105, 135); sndVoiceSyn(t, f, f * 1.25, f * 0.85, R_(1.0, 1.4), 0.13, 'oo', { q: 4, peakAt: 0.4, breath: 0.15 }); },
  // a wolf howling far off: rising, held with a waver, falling away; often answered
  howl(t) {
    const n = Math.random() < 0.5 ? 2 : 1;
    for (let i = 0; i < n; i++) { const f = R_(360, 440), t0 = t + i * R_(0.8, 1.6); sndVoiceSyn(t0, f, f * R_(1.55, 1.75), f * 1.05, R_(2.2, 3.0), 0.07, 'oo', { vib: [5.5, 18], q: 7, peakAt: 0.3, a: 0.25 }); }
  },
  owl(t) {
    const f = R_(390, 430);
    tone('sine', f, f * 0.97, t, 0.32, 0.07, 0.04);
    for (let i = 0; i < 3; i++) tone('sine', f * 0.94, f * 0.9, t + 0.75 + i * 0.16, 0.13, 0.05, 0.02);
  },
  caw(t) {
    const n = 1 + Math.floor(Math.random() * 3), f = R_(480, 640);
    for (let i = 0; i < n; i++) { const t0 = t + i * R_(0.32, 0.45); sndVoiceSyn(t0, f, f * 1.1, f * 0.85, R_(0.2, 0.28), 0.1, 'ah', { q: 2.5, breath: 0.7, formK: 1.4, a: 0.01 }); }
  },
  woodpecker(t) {
    const n = 12 + Math.floor(Math.random() * 8), rate = R_(15, 20), f = R_(650, 900);
    for (let i = 0; i < n; i++) { const t0 = t + i / rate; tone('sine', f, f * 0.8, t0, 0.018, 0.05 * (1 - i / n * 0.6), 0.001); noiseBurst(t0, 0.012, 0.04, 'bandpass', 1600, 1200, 2, 0.001); }
  },
  // a smith's hammer on the anvil: the ring and a lighter rebound
  anvil(t) {
    const f = R_(620, 820);
    sndRing(t, f, [[1, 0.9, 1], [2.76, 0.45, 0.7], [5.4, 0.25, 0.4], [8.93, 0.1, 0.25]], 0.7, 0.07);
    noiseBurst(t, 0.03, 0.1, 'highpass', 2500, 2000, 1, 0.001);
    if (Math.random() < 0.7) sndRing(t + R_(0.16, 0.22), f, [[1, 0.6, 1], [2.76, 0.3, 0.6]], 0.3, 0.025);
  },
  // townsfolk talking: a few syllables of a voice too far to make out
  chatter(t) {
    const n = 2 + Math.floor(Math.random() * 4), f = Math.random() < 0.55 ? R_(110, 170) : R_(190, 260), V = ['ah', 'eh', 'oh', 'ee', 'ay', 'oo'];
    let t0 = t;
    for (let i = 0; i < n; i++) { const d = R_(0.08, 0.17); sndVoiceSyn(t0, f * R_(0.95, 1.1), f * R_(1.0, 1.2), f * R_(0.85, 1.0), d, 0.05, V[Math.floor(Math.random() * V.length)], { a: 0.015, q: 5, breath: 0.2, formK: f > 180 ? 1.15 : 1 }); t0 += d + R_(0.01, 0.06); }
  },
  cartwheel(t) { for (let i = 0; i < 3; i++) sndToneF('sawtooth', R_(20, 28), R_(26, 34), t + i * 0.4, 0.3, 0.05, 0.05, ['bandpass', R_(500, 700), 600, 7]); },
  // cues: a bow or a staff loosed at you (where it came from), the whistle of what flies at you
  loose(t, v, o) {
    if (o && o.kind === 'bolt') { tone('sawtooth', 480, 1100, t, 0.1, 0.05); noiseBurst(t, 0.1, 0.1, 'bandpass', 2600, 4200, 3); }
    else { tone('triangle', 230, 130, t, 0.13, 0.22); noiseBurst(t, 0.07, 0.14, 'highpass', 2600, 1800, 0.7, 0.001); }
  },
  incoming(t, v, o) {
    const dur = clamp((o && o.dur) || 0.45, 0.2, 1.2);
    noiseBurst(t, dur, 0.13, 'bandpass', 3200, 1700, 7, dur * 0.85);
    tone('sine', 2100, 1400, t + dur * 0.5, dur * 0.5, 0.02, dur * 0.4);
  },
  // a priest's holy fire flaring a spell away: a bright sizzle, the spell cracking
  flare(t) {
    noiseBurst(t, 0.32, 0.22, 'highpass', 2000, 6500, 0.8, 0.004);
    tone('sine', 1760, 880, t, 0.25, 0.06, 0.003);
    for (let i = 0; i < 4; i++) { const f = R_(2600, 4800); tone('triangle', f, f * 0.7, t + 0.05 + i * 0.035, 0.05, 0.035, 0.001); }
  },
  // a mage's ward breaking: glass shattering and the air rushing in
  wardbreak(t) {
    for (let i = 0; i < 8; i++) { const f = R_(2400, 5600); tone('triangle', f, f * 0.96, t + Math.random() * 0.25, R_(0.08, 0.22), 0.045, 0.001); }
    noiseBurst(t, 0.16, 0.22, 'highpass', 3500, 6000, 0.9, 0.001);
    tone('sine', 230, 80, t, 0.28, 0.16, 0.003);
  },
});

/* ------------------------------------------------------------------ */
/* loops: a few voices held on the loudest continuous sources nearby    */
/* ------------------------------------------------------------------ */
// buffers made once, here, from noise and arithmetic (no samples): seconds of sound that loop without a seam
function sndBuf(name) {
  if (SND.bufs[name]) return SND.bufs[name];
  const ctx = AUDIO.ctx, sr = 22050, sec = name === 'murmur' || name === 'battle' ? 6 : 4, n = sr * sec;
  const buf = ctx.createBuffer(1, n, sr), d = buf.getChannelData(0);
  let s = 12345 + name.length * 977;
  const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  const noise = () => rnd() * 2 - 1;
  if (name === 'crackle' || name === 'roar') {
    // a body of low roar with a slow flutter, and pops: the wood bursting
    const big = name === 'roar';
    let lp = 0, lp2 = 0, flut = 0.5;
    for (let i = 0; i < n; i++) {
      if (i % 220 === 0) flut += (rnd() - 0.5) * 0.25; flut = clamp(flut, 0.25, 1);
      lp += (noise() - lp) * (big ? 0.035 : 0.06); lp2 += (lp - lp2) * 0.2;
      d[i] = lp2 * (big ? 2.2 : 1.1) * flut + noise() * 0.012;
    }
    const pops = Math.floor(sec * (big ? 34 : 22));
    for (let k = 0; k < pops; k++) {
      const at = Math.floor(rnd() * (n - 400)), amp = Math.pow(rnd(), 2.4) * (big ? 0.55 : 0.75), len = 20 + Math.floor(rnd() * 140);
      let hp = 0, prev = 0;
      for (let j = 0; j < len; j++) { const x = noise(); hp = 0.75 * (hp + x - prev); prev = x; d[at + j] += hp * amp * Math.exp(-j / (len * 0.3)); }
    }
  } else if (name === 'lap') {
    // a lake against its shore: slow sloshes and the trickle back
    let lp = 0, ph = 0, nxt = 0;
    const env = new Float32Array(n);
    while (nxt < n) { const len = Math.floor(sr * (0.5 + rnd() * 0.9)); for (let j = 0; j < len && nxt + j < n; j++) { const x = j / len; env[nxt + j] += Math.sin(Math.PI * x) ** 2 * (0.4 + rnd() * 0.02 + 0.6 * (1 - x) * x * 4 * 0.25); } nxt += Math.floor(len * (0.55 + rnd() * 0.6)); }
    for (let i = 0; i < n; i++) { lp += (noise() - lp) * 0.09; ph += (noise() * 0.5 - ph) * 0.4; d[i] = lp * env[i] * 1.6 + ph * env[i] * 0.08; }
  } else if (name === 'roofrain') {
    // rain drumming on a roof over you: dense small knocks on timber and slate, and their hush
    let lp = 0;
    for (let i = 0; i < n; i++) { lp += (noise() - lp) * 0.25; d[i] = lp * 0.18; }
    const drops = sec * 260;
    for (let k = 0; k < drops; k++) {
      const at = Math.floor(rnd() * (n - 200)), f = 300 + rnd() * 900, amp = 0.05 + rnd() * 0.22, len = 40 + Math.floor(rnd() * 120);
      for (let j = 0; j < len; j++) d[at + j] += Math.sin((2 * Math.PI * f * j) / sr) * amp * Math.exp(-j / (len * 0.25));
    }
  } else if (name === 'murmur') {
    // a town's voices, too many and too far to make out: syllables in vowels' formants, overlapping
    const F = [[750, 1150], [530, 1850], [500, 850], [300, 2250], [650, 1700]];
    for (let v = 0; v < 9; v++) {
      const f0 = 100 + rnd() * 160;
      let tt = Math.floor(rnd() * sr * 0.6);
      while (tt < n - sr * 0.3) {
        const syl = Math.floor(sr * (0.08 + rnd() * 0.14)), fm = F[Math.floor(rnd() * F.length)];
        const bq = (fc) => { const w = (2 * Math.PI * fc) / sr, al = Math.sin(w) / (2 * 4); return [al / (1 + al), 0, -al / (1 + al), (-2 * Math.cos(w)) / (1 + al), (1 - al) / (1 + al)]; };
        const A = bq(fm[0]), B = bq(fm[1]);
        let x1 = 0, x2 = 0, y1 = 0, y2 = 0, u1 = 0, u2 = 0, ph = 0;
        const amp = 0.06 + rnd() * 0.05, fv = f0 * (0.9 + rnd() * 0.25);
        for (let j = 0; j < syl && tt + j < n; j++) {
          ph += fv / sr; if (ph > 1) ph -= 1;
          const x = ph * 2 - 1 + noise() * 0.15, e = Math.sin((Math.PI * j) / syl);
          const y = A[0] * x + A[1] * x1 + A[2] * x2 - A[3] * y1 - A[4] * y2;
          const u = B[0] * x + B[1] * x1 + B[2] * x2 - B[3] * u1 - B[4] * u2;
          x2 = x1; x1 = x; y2 = y1; y1 = y; u2 = u1; u1 = u;
          d[tt + j] += (y + 0.5 * u) * e * amp;
        }
        tt += syl + Math.floor(sr * (rnd() < 0.25 ? 0.25 + rnd() * 0.6 : 0.02 + rnd() * 0.08));
      }
    }
    let lp = 0;
    for (let i = 0; i < n; i++) { lp += (d[i] - lp) * 0.35; d[i] = lp; }
  } else if (name === 'battle') {
    // a fight too far off to see: blades clashing, blows, cries, all softened by the distance
    for (let k = 0; k < sec * 26; k++) {
      const at = Math.floor(rnd() * (n - sr)), kind = rnd();
      if (kind < 0.45) { // a clash of blades
        const f = 1300 + rnd() * 1400, amp = 0.05 + rnd() * 0.12, len = Math.floor(sr * (0.1 + rnd() * 0.2));
        for (let j = 0; j < len; j++) { const tt = j / sr; d[at + j] += (Math.sin(2 * Math.PI * f * tt) + 0.5 * Math.sin(2 * Math.PI * f * 2.76 * tt)) * amp * Math.exp(-j / (len * 0.2)); }
      } else if (kind < 0.8) { // a blow
        const f = 70 + rnd() * 60, amp = 0.12 + rnd() * 0.15, len = Math.floor(sr * 0.12);
        let lp = 0;
        for (let j = 0; j < len; j++) { lp += (noise() - lp) * 0.2; d[at + j] += (Math.sin((2 * Math.PI * f * j) / sr) * 0.6 + lp) * amp * Math.exp(-j / (len * 0.25)); }
      } else { // a cry
        const f = 140 + rnd() * 140, len = Math.floor(sr * (0.3 + rnd() * 0.5)), amp = 0.04 + rnd() * 0.05;
        let ph = 0, lp = 0;
        for (let j = 0; j < len; j++) { const fq = f * (1 + 0.2 * Math.sin((Math.PI * j) / len)); ph += fq / sr; if (ph > 1) ph -= 1; lp += (ph * 2 - 1 - lp) * 0.12; d[at + j] += lp * amp * Math.sin((Math.PI * j) / len); }
      }
    }
    let lp = 0;
    for (let i = 0; i < n; i++) { lp += (d[i] - lp) * 0.3; d[i] = lp * 1.3; }
  }
  // no seam: the last fifth of a second fades into the first
  const xf = Math.floor(sr * 0.2);
  for (let j = 0; j < xf; j++) { const a = j / xf; d[j] = d[j] * a + d[n - xf + j] * (1 - a); }
  const out = ctx.createBuffer(1, n - xf, sr);
  out.getChannelData(0).set(d.subarray(0, n - xf));
  SND.bufs[name] = out;
  return out;
}
const SND_LOOP_N = () => (IS_TOUCH || quality.level === 'low' ? 3 : 5);
function sndLoopVoice(ctx, dest) {
  const g = ctx.createGain(); g.gain.value = 0;
  const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 9000; f.Q.value = 0.5;
  const p = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
  g.connect(f);
  if (p) f.connect(p).connect(dest); else f.connect(dest);
  return { g, f, p, src: null, buf: '', key: '', x: 0, y: 0, z: 0, k: 0, want: null, on: 0 };
}
function sndLoopsInit(ctx) {
  SND.loops = [];
  for (let i = 0; i < 5; i++) SND.loops.push(sndLoopVoice(ctx, AUDIO.amb.bus));
}
// what loops near the listener: fires (a torch, a hearth, a campfire, a burning roof, a wall walk alight), the forge
const SND_LOOP_DEF = { crackle: { ref: 3, max: 55, lvl: 0.5 }, roar: { ref: 9, max: 160, lvl: 1, roll: 0.7 } };
const _sndCand = [];
function sndLoopsStep(now) {
  const L = SND.L, C = _sndCand;
  C.length = 0;
  if (!L.ok) return;
  // fires: near ones by their size; a burning house's or wall's flames are one big fire (merged in cells of 7 m)
  const cells = new Map();
  for (const f of FIRES) {
    if (f.until < GAME.t || f.ghost) continue;
    const dx = f.x - L.x, dz = f.z - L.z, d2 = dx * dx + dz * dz;
    if (d2 > 170 * 170) continue;
    const s = f.nature ? 1.6 : f.wall ? 0.25 : f.size;
    const key = Math.round(f.x / 7) + ':' + Math.round(f.z / 7);
    const c = cells.get(key);
    if (c) { c.s += s * 0.5; if (s > c.top) { c.top = s; c.x = f.x; c.y = f.y; c.z = f.z; } }
    else cells.set(key, { x: f.x, y: f.y, z: f.z, s, top: s });
  }
  for (const c of cells.values()) {
    const big = c.s > 1.6, def = big ? SND_LOOP_DEF.roar : SND_LOOP_DEF.crackle;
    const d = Math.hypot(c.x - L.x, (c.y + 0.5) - L.y, c.z - L.z), g = sndDistGain(def, d) * clamp(big ? c.s / 3 : 0.3 + c.s * 0.5, 0.15, 1.4);
    if (g < 0.01) continue;
    C.push({ buf: big ? 'roar' : 'crackle', x: c.x, y: c.y + 0.6, z: c.z, g, d, loud: g * def.lvl });
  }
  C.sort((a, b) => b.loud - a.loud);
  const n = Math.min(SND_LOOP_N(), SND.loops.length), want = C.slice(0, n);
  // keep a voice on the source it already has (the nearest wanted source to it), give the rest to the free voices
  const used = new Set();
  for (const V of SND.loops) {
    V.want = null;
    if (!V.on) continue;
    let best = -1, bd = 36;
    want.forEach((w, i) => { if (used.has(i) || w.buf !== V.buf) return; const dd = dist2(w.x, w.z, V.x, V.z); if (dd < bd) { bd = dd; best = i; } });
    if (best >= 0) { used.add(best); V.want = want[best]; }
  }
  for (let i = 0; i < want.length; i++) {
    if (used.has(i)) continue;
    const V = SND.loops.find((v, k) => k < n && !v.want && v.on < 0.02);
    if (!V) continue;
    used.add(i); V.want = want[i];
  }
  const mix = _sndMix;
  for (let k = 0; k < SND.loops.length; k++) {
    const V = SND.loops[k], w = V.want;
    if (!w) { if (V.on > 0) { V.g.gain.setTargetAtTime(0, now, 0.25); V.on *= 0.25; if (V.on < 0.02) V.on = 0; } continue; }
    // a new source: start it (or move a silent voice onto it)
    if (!V.src || V.buf !== w.buf) {
      try { if (V.src) V.src.stop(); } catch (e) { /* done */ }
      const s = AUDIO.ctx.createBufferSource(); s.buffer = sndBuf(w.buf); s.loop = true; s.playbackRate.value = R_(0.9, 1.1);
      s.connect(V.g); s.start(now, Math.random() * 2);
      V.src = s; V.buf = w.buf;
    }
    V.x = w.x; V.y = w.y; V.z = w.z;
    sndMixAt(SND_LOOP_DEF[w.buf], w.x, w.y, w.z, null, mix);
    let g = w.g * 0.5, fc = mix.fc;
    const occ = w.d < 90 ? sndOcc(w.x, w.y, w.z) : 0;
    if (occ) { g *= 1 - 0.65 * occ; fc = Math.min(fc, 700); }
    V.g.gain.setTargetAtTime(g, now, 0.2);
    V.f.frequency.setTargetAtTime(fc, now, 0.2);
    if (V.p) V.p.pan.setTargetAtTime(mix.pan, now, 0.2);
    V.on = g;
  }
}

/* ------------------------------------------------------------------ */
/* the places' air                                                     */
/* ------------------------------------------------------------------ */
function sndLoopLayer(ctx, buf, dest, fType, fFreq, q = 0.7, rate = 1) {
  const s = ctx.createBufferSource(); s.buffer = buf; s.loop = true; s.playbackRate.value = rate;
  const f = ctx.createBiquadFilter(); f.type = fType; f.frequency.value = fFreq; f.Q.value = q;
  const g = ctx.createGain(); g.gain.value = 0;
  s.connect(f).connect(g).connect(dest); s.start(ctx.currentTime, Math.random() * 1.5);
  return { s, f, g };
}
function sndAirInit(ctx) {
  const A = AUDIO.amb;
  // the air dips under a cue: everything of the air goes through one gain before the ambience bus
  const duck = ctx.createGain(); duck.gain.value = 1; duck.connect(A.bus);
  const air = { duck, k: {}, crickets: 0 };
  // the howl of a storm or a high place: noise through a resonance that wanders
  air.howl = sndLoopLayer(ctx, AUDIO.noise, duck, 'bandpass', 520, 6, 0.6);
  // leaves in the wind
  air.leaves = sndLoopLayer(ctx, AUDIO.noise, duck, 'bandpass', 3200, 0.8, 1);
  // insects in a summer meadow: a high hum that trembles
  air.insects = sndLoopLayer(ctx, AUDIO.noise, duck, 'bandpass', 5600, 3, 1);
  { const l = ctx.createOscillator(), lg = ctx.createGain(); l.frequency.value = 31; lg.gain.value = 0; l.connect(lg).connect(air.insects.g.gain); l.start(); air.insectsLfo = lg; }
  // rain drumming on the roof over you, a lake against the shore, a town's voices
  air.roof = sndLoopLayer(ctx, sndBuf('roofrain'), duck, 'lowpass', 2600, 0.5, 1);
  air.lap = sndLoopLayer(ctx, sndBuf('lap'), duck, 'lowpass', 1800, 0.5, 1);
  air.town = sndLoopLayer(ctx, sndBuf('murmur'), duck, 'lowpass', 2400, 0.5, 1);
  // flags and banners flapping up on a keep's walls
  air.flap = sndLoopLayer(ctx, AUDIO.noise, duck, 'bandpass', 900, 1.2, 1);
  { const l = ctx.createOscillator(), lg = ctx.createGain(); l.type = 'square'; l.frequency.value = 9; lg.gain.value = 0; l.connect(lg).connect(air.flap.g.gain); l.start(); air.flapLfo = lg; air.flapOsc = l; }
  // a battle heard from afar: two voices, each on one of the biggest fights out of sight
  air.battle = [0, 1].map(() => {
    const V = sndLoopVoice(ctx, duck);
    const s = ctx.createBufferSource(); s.buffer = sndBuf('battle'); s.loop = true; s.playbackRate.value = R_(0.92, 1.08); s.connect(V.g); s.start(ctx.currentTime, Math.random() * 4);
    V.src = s;
    return V;
  });
  // the existing wind, rain and crickets (11_audio.js) go through the duck too
  for (const g of [A.wind, A.rain, A.crGain]) { try { g.disconnect(); g.connect(duck); } catch (e) { /* as it was */ } }
  SND.air = air;
}
// what is round the listener: sampled a few times a second
const SND_PLACE = { town: 0, keep: 0, walls: 0, forest: 0, meadow: 0, mountain: 0, shore: 0, river: 0, roof: 0, room: 0, barrow: 0, height: 0 };
function sndPlaceAt() {
  const L = SND.L, P = SND_PLACE, x = L.x, z = L.z;
  for (const k in P) P[k] = 0;
  if (INDOOR.on || inDungeonX(x)) { P.barrow = 1; return P; }
  const gy = heightAt(x, z);
  P.height = L.y - gy;
  // a town: near its plaza and houses
  for (const R of REALMS) { const S = R.town; if (!S) continue; const d = dist(x, z, S.x, S.z); P.town = Math.max(P.town, 1 - sstep(45, 110, d)); }
  // a keep: in its court or up on its walls
  const C = typeof castleAt === 'function' ? castleAt(x, z) : null;
  if (C) { P.keep = 1; P.walls = sstep(2.5, 6, L.y - 1.6 - heightAt(C.S.x, C.S.z)); }
  // the woods: standing trees round you
  P.forest = clamp((sndTreesNear(x, z, 24) - 2) / 14, 0, 1);
  // the mountains: high ground
  P.mountain = sstep(30, 60, gy) * (1 - P.town);
  // water near: a river's run (07b_swim.js plays it), a lake or a pond's shore
  let wn = 0;
  for (const [ox, oz] of [[0, 0], [10, 0], [-10, 0], [0, 10], [0, -10], [18, 18], [-18, -18], [18, -18], [-18, 18]]) { const w = waterAt(x + ox, z + oz); if (w && w.depth > 0.3) wn++; }
  P.shore = clamp(wn / 4, 0, 1) * (riverAt(x, z, 20) ? 0.4 : 1) * (SICE.on && typeof seasonIceY === 'function' && seasonIceY(x, z) !== null ? 0.1 : 1);
  P.meadow = clamp(1 - P.forest - P.town - P.keep - P.mountain * 0.7, 0, 1);
  // under a roof: a house's, a built one's, a tower room's
  const P0 = GAME.player;
  const roofed = (P0 && typeof skyOver === 'function' && CAM.mode === 'play') ? skyOver(P0) === 0 : (typeof houseRoofOver === 'function' && houseRoofOver(x, z));
  P.roof = roofed ? 1 : 0;
  P.room = roofed && (typeof houseInside === 'function' && houseInside(x, z) || (P0 && typeof towerRoomOf === 'function' && towerRoomOf(P0))) ? 1 : 0;
  return P;
}
// the standing trees within r of a point (the near trees' grid: 05h_wear.js underCrown reads it the same way)
function sndTreesNear(x, z, r) {
  const G = typeof NEAR_TREES !== 'undefined' ? NEAR_TREES.grid : null;
  if (!G) return 0;
  const c = NEAR_TREES.cell, n = Math.ceil(r / c), ci = Math.floor(x / c), cj = Math.floor(z / c);
  let k = 0;
  for (let j = cj - n; j <= cj + n; j++) for (let i = ci - n; i <= ci + n; i++) {
    const l = G.get(i + ',' + j);
    if (!l) continue;
    for (const ti of l) { const t = W.trees[ti]; if (!t || t.gone || t.fallen) continue; if (dist2(x, z, t.x, t.z) < r * r) k++; }
  }
  return k;
}
function sndAirStep(now, dt) {
  const air = SND.air;
  if (!air) return;
  const A = AUDIO.amb, P = sndPlaceAt(), K = air.k, W = WEATHER;
  const lerpK = (k, v, s = 1.5) => { K[k] = (K[k] ?? v) + (v - (K[k] ?? v)) * Math.min(1, dt * s); return K[k]; };
  const night = U.uNight.value, day = 1 - sstep(0.35, 0.7, night);
  const sea = typeof seasonCur === 'function' ? seasonCur().A : [0.25, 0.25, 0.25, 0.25]; // spring, summer, autumn, winter
  const temp = typeof farmTempAt === 'function' && GAME.player ? farmTempAt(SND.L.x, SND.L.z) : 12;
  const warm = sstep(4, 12, temp);
  const rain = Math.max(0, W.raining - W.snowing), storm = W.storm || 0, wind = clamp(((U.uWind && U.uWind.value) || 1) / 2, 0, 1.5);
  const indoorBarrow = P.barrow > 0;
  const out = indoorBarrow ? 0 : 1, roof = lerpK('roof', P.roof, 3), room = lerpK('room', P.room, 3);
  const t = now;
  // wind: the open and the high, a keep's walls, the mountains; a storm; less under a roof, through the trees
  const exposure = clamp(P.height / 18 + P.mountain * 0.8 + P.walls * 0.6, 0, 1.3);
  const gust = 0.8 + 0.4 * Math.sin(t * 0.13) * Math.sin(t * 0.07 + 1);
  const windG = indoorBarrow ? 0.07 * (0.6 + 0.4 * Math.sin(t * 0.17) * Math.sin(t * 0.05 + 1))
    : (0.04 + 0.09 * exposure) * (1 - night * 0.3) * (1 + 1.4 * storm + 0.5 * W.overcast) * gust * (1 - 0.55 * roof) * (1 - 0.35 * P.forest);
  A.wind.gain.setTargetAtTime(lerpK('wind', windG, 2), now, 0.5);
  A.lp.frequency.setTargetAtTime(indoorBarrow ? 170 + 50 * Math.sin(t * 0.3) : (360 + 300 * exposure + 120 * Math.sin(t * 0.21)) * (1 - 0.4 * roof), now, 0.8);
  const howl = out * (0.012 * P.mountain + 0.018 * storm + 0.008 * P.walls) * (0.6 + 0.4 * gust) * (1 - 0.7 * roof);
  air.howl.g.gain.setTargetAtTime(lerpK('howl', howl), now, 0.6);
  air.howl.f.frequency.setTargetAtTime(380 + 260 * Math.sin(t * 0.23) + 160 * Math.sin(t * 0.61 + 2) + 200 * exposure, now, 0.4);
  // leaves: the woods in the wind (bare in winter: a dry rattle of twigs, pines hiss)
  const leafy = 1 - 0.65 * sea[3] + 0.15 * sea[2];
  const leaves = out * P.forest * (0.02 + 0.035 * wind + 0.03 * storm) * leafy * (0.55 + 0.45 * gust) * (1 - 0.7 * roof);
  air.leaves.g.gain.setTargetAtTime(lerpK('leaves', leaves), now, 0.5);
  air.leaves.f.frequency.setTargetAtTime(2400 + 1600 * sea[2] + 600 * gust, now, 0.5);
  // insects: summer days in the meadows (and the woods' edge)
  const ins = out * day * warm * (sea[1] + 0.5 * sea[0] + 0.3 * sea[2]) * (P.meadow * 0.8 + P.forest * 0.3) * (1 - rain) * (1 - 0.8 * roof) * 0.006;
  air.insects.g.gain.setTargetAtTime(lerpK('ins', ins) * 0.5, now, 0.8);
  air.insectsLfo.gain.setTargetAtTime(K.ins * 0.5, now, 0.8);
  // crickets: warm nights out of doors (11_audio.js's)
  const cr = out * 0.012 * sstep(0.45, 0.85, night) * warm * (1 - sea[3]) * (1 - rain * 0.8) * (1 - 0.8 * roof) * (0.4 + 0.6 * (P.meadow + P.forest * 0.6));
  A.crGain.gain.setTargetAtTime(lerpK('cr', cr), now, 1.5);
  // rain: its hiss on the ground out of doors; drumming on the roof over you
  const hiss = out * 0.11 * rain * (1 - 0.75 * roof);
  A.rain.gain.setTargetAtTime(lerpK('rain', hiss, 2), now, 0.6);
  air.roof.g.gain.setTargetAtTime(lerpK('roofrain', out * roof * rain * 0.5, 2), now, 0.6);
  // the lake's lapping at its shore
  air.lap.g.gain.setTargetAtTime(lerpK('lap', out * P.shore * (0.25 + 0.4 * wind + 0.4 * storm) * (1 - 0.6 * roof) * 0.35), now, 0.8);
  // a town's voices by day (fewer in the rain, none at night), through the walls when you are inside
  const town = out * P.town * (0.25 + 0.75 * day) * (1 - 0.6 * rain) * (1 - 0.6 * room) * 0.11 * (1 - sstep(0.6, 0.95, night));
  air.town.g.gain.setTargetAtTime(lerpK('town', town), now, 0.8);
  air.town.f.frequency.setTargetAtTime(room ? 900 : 2400, now, 0.5);
  // flags up on the walls
  const flap = out * P.walls * (0.25 + wind * 0.75 + storm) * 0.03 * (1 - roof);
  air.flapLfo.gain.setTargetAtTime(lerpK('flap', flap) * 0.6, now, 0.5);
  air.flap.g.gain.setTargetAtTime(K.flap * 0.4, now, 0.5);
  air.flapOsc.frequency.setTargetAtTime(7 + 5 * wind + 4 * storm + 2 * Math.sin(t * 0.7), now, 0.3);
  // the echo: the Barrow's halls, a room or a hall, a keep's court between its walls
  const wet = indoorBarrow ? 0.45 : room ? 0.2 : roof ? 0.1 : P.keep * (1 - P.walls) * 0.06;
  SND.rev.send.gain.setTargetAtTime(lerpK('wet', wet, 2), now, 0.3);
  // birds by day (fewer in winter and in the rain), placed among the trees round you
  air.chirpAt = (air.chirpAt ?? 3) - dt;
  if (air.chirpAt <= 0) {
    const bk = typeof seasonBirdK === 'function' ? seasonBirdK() : 1;
    const rate = day * bk * (1 - rain) * out * (0.25 + 0.75 * (P.forest + P.meadow * 0.4)) * (1 - 0.8 * roof);
    air.chirpAt = 2 + Math.random() * 7 / Math.max(0.15, rate);
    if (rate > 0.05 && GAME.started) sndAround('chirp', 8, 30, 3 + Math.random() * 6);
  }
  // the woods' other voices: a woodpecker by day, an owl at night; ravens over the heights; wolves far off at night
  air.wildAt = (air.wildAt ?? 6) - dt;
  if (air.wildAt <= 0 && GAME.started && out && !roof) {
    air.wildAt = 6 + Math.random() * 14;
    const r = Math.random();
    if (P.forest > 0.4 && day > 0.5 && r < 0.35) sndAround('woodpecker', 30, 90, 6);
    else if (P.forest > 0.25 && night > 0.6 && r < 0.5) sndAround('owl', 25, 90, 8);
    else if ((P.mountain > 0.3 || zoneAt(SND.L.x, SND.L.z).realm === 2) && day > 0.4 && r < 0.6) sndAround('caw', 30, 120, 18);
    else if (night > 0.6 && r < 0.75) sndWolfHowl();
  }
  sndDiveFish(dt);
}
// a sound at a random place round the listener: between r0 and r1 metres off, h metres up
function sndAround(name, r0, r1, h) {
  const L = SND.L, a = Math.random() * TAU, r = r0 + Math.random() * (r1 - r0);
  const x = L.x + Math.cos(a) * r, z = L.z + Math.sin(a) * r;
  sfxAt(name, x, heightAt(x, z) + h, z);
}
// wolves howl at night from where they are: the camps with wolves (or any wolf) within reach
function sndWolfHowl() {
  const L = SND.L;
  let best = null, bd = 650 * 650;
  for (const e of ENT) {
    if (!e.alive || e.kind !== 'wolf' || e.tame) continue;
    const d2 = dist2(e.x, e.z, L.x, L.z);
    if (d2 < bd && d2 > 40 * 40) { bd = d2; best = e; }
  }
  if (best) sfxAt('howl', best.x, best.y + 1, best.z);
}

/* ------------------------------------------------------------------ */
/* the world's own voices: beasts, townsfolk, a forge, a column marching */
/* ------------------------------------------------------------------ */
const SND_BEAST_VOICE = { sheep: 'bleat', cattle: 'moo', hen: 'cluck', hound: 'bark' };
function sndLifeStep(now) {
  const L = SND.L, P = GAME.player, gt = GAME.t, LL = SND.lastLife;
  if (!L.ok || INDOOR.on) return;
  const night = U.uNight.value;
  // one voice in a while: of the bodies near, the first whose own wait has run out
  let tries = 0;
  for (let i = 0; i < 6 && tries < 40; i++) {
    const e = ENT[Math.floor(Math.random() * ENT.length)];
    tries++;
    if (!e || !e.alive || e === P || e.tame) continue; // the kept beasts have their own voices (08h_animals.js anVoice)
    const d2 = dist2(e.x, e.z, L.x, L.z);
    if (d2 > 60 * 60) { i--; continue; }
    if ((LL[e.id] || 0) > gt) continue;
    const k = e.kind === 'humanoid' ? null : (e.crowd || e.kind);
    let v = SND_BEAST_VOICE[k] || SND_BEAST_VOICE[e.tame && e.tame.k];
    if (e.kind === 'wolf' && night > 0.6 && Math.random() < 0.05) v = 'howl';
    if (!v && e.role === 'villager' && night < 0.6 && d2 < 30 * 30 && !e.removed) v = 'chatter';
    if (!v) continue;
    LL[e.id] = gt + (v === 'chatter' ? 3 + Math.random() * 7 : 8 + Math.random() * 20);
    sfxAtE(v, e, null, v === 'chatter' ? 1.55 : 0.8);
    break;
  }
  // a band storming a fallen tower: the stones of its rubble shift under their feet
  for (const e of ENT) {
    const s = e.ai && e.ai.storm;
    if (!s || s.done || !(s.i >= 1) || !e.alive || !(e.anim && e.anim.amt > 0.2)) continue;
    if (dist2(e.x, e.z, L.x, L.z) > 45 * 45) continue;
    sfxAtE('rubble', e, { at: Math.random() * 0.3 }, 0.05);
  }
  // the town's forge rings by day while its fire burns
  if (night < 0.55 && typeof CRAFT !== 'undefined' && CRAFT.stations) {
    for (const S of CRAFT.stations) {
      if (S.kind !== 'forge' || dist2(S.x, S.z, L.x, L.z) > 110 * 110) continue;
      if ((S.sndAt || 0) > gt) continue;
      S.sndAt = gt + 1.2 + Math.random() * 3.5;
      const n = 1 + Math.floor(Math.random() * 3);
      for (let j = 0; j < n; j++) sfxAt('anvil', S.x, (S.y || heightAt(S.x, S.z)) + 1, S.z, { at: j * 0.42 });
      break;
    }
  }
  // warbands near: a column on the march tramps along; one storming a keep cries out
  if (WAR.warbands) {
    for (const wb of WAR.warbands) {
      const ld = typeof wbLeader === 'function' ? wbLeader(wb) : null;
      if (!ld || !ld.alive) continue;
      const d2 = dist2(ld.x, ld.z, L.x, L.z);
      if (d2 > 110 * 110) continue;
      const moving = ld.anim && ld.anim.amt > 0.3 && !ld.mount;
      const ph = wb.order ? wb.order.phase : '';
      if (moving && (!ld.combatUntil || ld.combatUntil < gt)) { const k = clamp(wbMembers(wb).length / 8, 0.5, 1.3); sfxAtE('march', ld, { vol: k }, 0.1); sfxAtE('march', ld, { at: 0.27, vol: 0.8 * k }, 0.1); }
      if ((ph === 'assault' || ph === 'breach') && (wb.cryAt || 0) < gt && d2 < 200 * 200) { wb.cryAt = gt + 9 + Math.random() * 12; sfxAtE('warcry', ld, null, 1.6); }
    }
  }
}
// a battle too far off to see: the biggest fights between 40 and 450 m, heard as a din toward them
const _sndBand = [];
function sndBattleStep(now) {
  const air = SND.air;
  if (!air || !air.battle) return;
  const L = SND.L, gt = GAME.t, cells = new Map();
  if (L.ok && GAME.started && !INDOOR.on) {
    for (const e of ENT) {
      if (!e.alive || e.kind === 'door' || !(e.combatUntil > gt) || e.faction > 3) continue;
      const dx = e.x - L.x, dz = e.z - L.z, d2 = dx * dx + dz * dz;
      if (d2 < 30 * 30 || d2 > 470 * 470) continue;
      const key = Math.round(e.x / 50) + ':' + Math.round(e.z / 50);
      const c = cells.get(key);
      if (c) { c.n++; c.x += e.x; c.z += e.z; c.y += e.y; } else cells.set(key, { n: 1, x: e.x, z: e.z, y: e.y });
    }
  }
  _sndBand.length = 0;
  for (const c of cells.values()) { c.x /= c.n; c.z /= c.n; c.y /= c.n; c.d = Math.hypot(c.x - L.x, c.z - L.z); c.w = Math.min(1.6, c.n / 10) * sndDistGain({ ref: 45, max: 470, roll: 0.8 }, c.d); _sndBand.push(c); }
  _sndBand.sort((a, b) => b.w - a.w);
  SND.battle = _sndBand.slice(0, 2).map((c) => ({ n: c.n, d: Math.round(c.d), w: Math.round(c.w * 100) / 100 }));
  const mix = _sndMix;
  air.battle.forEach((V, i) => {
    const c = _sndBand[i];
    if (!c || c.w < 0.02) { V.g.gain.setTargetAtTime(0, now, 0.8); V.on = 0; return; }
    sndMixAt({ ref: 45, max: 470 }, c.x, c.y + 1.5, c.z, null, mix);
    let g = 0.55 * c.w, fc = Math.min(mix.fc, 3200);
    if (sndOcc(c.x, c.y + 1.5, c.z)) { g *= 0.5; fc = Math.min(fc, 900); }
    V.g.gain.setTargetAtTime(g, now, 0.6);
    V.f.frequency.setTargetAtTime(fc, now, 0.5);
    if (V.p) V.p.pan.setTargetAtTime(mix.pan, now, 0.5);
    V.on = g;
    // now and then a cry or a clash carries clear of the din
    if (Math.random() < 0.18 * c.w) sfxAt(Math.random() < 0.5 ? 'warcry' : 'clash', c.x, c.y + 1.5, c.z, { vol: 0.8 });
  });
}
// fish under the surface near a swimmer or a boat break the water now and then
function sndDiveFish(dt) {
  if (typeof FISH === 'undefined' || !FISH || !FISH.list) return;
}

/* ------------------------------------------------------------------ */
/* cues: what matters heard over what does not                          */
/* ------------------------------------------------------------------ */
// a foe's shot loosed at you: the bow's twang where it came from, the whistle of the shaft coming
function sndOnLoose(src, target, kind, speed) {
  const P = GAME.player;
  if (!P || target !== P || !src || src === P || !isEnemy(src, P)) return;
  const d = dist(src.x, src.z, P.x, P.z);
  if (d < 2) return;
  const bolt = !(kind === 'arrow' || kind === 'firearrow' || kind === 'deadeye');
  sfxAtE('loose', src, { kind: bolt ? 'bolt' : 'arrow' }, 1.4);
  if (GAME.t - SND.incomingAt < 0.35 || d < 5) return;
  SND.incomingAt = GAME.t;
  const fly = d / Math.max(8, speed || 24), dur = Math.min(0.9, Math.max(0.25, fly * 0.8));
  // it comes from the shooter's side and arrives as the shaft does
  const ux = (src.x - P.x) / d, uz = (src.z - P.z) / d;
  sfxAt('incoming', P.x + ux * 3, P.y + 1.5, P.z + uz * 3, { dur, at: Math.max(0, fly - dur), noOcc: true });
}
// the keep's bell rings when it is attacked (a keep of yours: its bell carries far, and the news has its own cue)
function sndKeepAlarm(K) {
  const S = K && K.site;
  if (!S) return;
  const gt = GAME.t;
  if ((SND.alarmAt[S.name] || -99) > gt) return;
  SND.alarmAt[S.name] = gt + 40;
  for (let i = 0; i < 6; i++) sfxAt('alarmBell', S.x, (S.y || 0) + 14, S.z, { at: i * 1.15, f: 360 });
}
// the war's news: a keep of your realm attacked, a breach, a gate broken: a low call of two horns
function sndNewsCue(kind, realm) {
  const P = GAME.player;
  if (!P || kind !== 'alarm' || realm !== P.faction) return;
  if (GAME.t - SND.newsCueAt < 8) return;
  SND.newsCueAt = GAME.t;
  sfx('alarmCue');
}
SND_SYNTH.alarmCue = (t) => { brass(t, [110, 110 * 1.335], 0.38, 0.6, 0.045); };
// a fire beater's two blows in its action (21: the arms brought down twice in 1.1 s)
function sndBeat(e) { sfxAtE('beat', e, { at: 0.34 }, 0.5); sfxAtE('beat', e, { at: 0.88 }, 0.5); }
// a shield worn through: a mage's Arcane Ward breaking
function sndShieldBroke(dst, b) {
  if (!dst || b.src !== dst.id || dst.cls !== 'mage' || !hasBuff(dst, 'eward')) return;
  sfxAtE('wardbreak', dst, null, 1.3);
}

/* ------------------------------------------------------------------ */
/* the modules' own placed sounds: each still sounds as it did, now      */
/* placed, panned and muffled like the rest                              */
/* ------------------------------------------------------------------ */
// each module's sound function is wrapped: the wrapper asks for '<prefix>:<kind>' at the place; the voice plays the
// module's own synth as if it were at the listener (full volume), into the placed voice
function sndAdopt(prefix, fn, place, def) {
  return (kind, ...args) => {
    const at = place(kind, ...args);
    if (!at) { fn(kind, ...args); return; } // no place: as it was
    const name = prefix + ':' + kind;
    if (!SND_SYNTH[name]) SND_SYNTH[name] = (t, v, o) => { const r = SND_ADOPT_NEAR(); fn(kind, ...(o && o.args ? o.args(r) : [r.x, r.z])); };
    if (!SND_DEF[name]) SND_DEF[name] = { ...SND_DEF._, ...(def[kind] || def._ || {}) };
    sfxAt(name, at[0], at[1], at[2], at[3] || null);
  };
}
// where the listener's ears are, for a module's synth that measures its own distance
const _sndNear = { x: 0, y: 0, z: 0 };
function SND_ADOPT_NEAR() { const cp = camera.position, P = GAME.player; _sndNear.x = cp.x; _sndNear.y = cp.y; _sndNear.z = cp.z; _sndNear.px = P ? P.x : cp.x; _sndNear.pz = P ? P.z : cp.z; return _sndNear; }
queueMicrotask(() => {
  // the houses: hinges, latches, the roof coming down, a hammer (04e_houses.js)
  if (typeof houseSfx === 'function') {
    const orig = houseSfx;
    houseSfx = sndAdopt('house', orig, (kind, x, y, z) => [x, y, z, { args: (r) => [r.x, r.y, r.z] }],
      { _: { ref: 3, max: 40, lvl: 0.3 }, collapse: { ref: 12, max: 260, lvl: 1, roll: 0.7 }, groan: { ref: 8, max: 120, lvl: 0.5 }, ignite: { ref: 5, max: 80, lvl: 0.5 }, hammer: { ref: 4, max: 75, lvl: 0.38, per: 3 }, doorShut: { ref: 4, max: 55, lvl: 0.45 } });
  }
  // a burning house's roar is one of the fires now (sndLoopsStep): placed, panned and behind its walls
  if (typeof houseSound === 'function') { const orig = houseSound; houseSound = (dt) => { if (!SND.ready) orig(dt); }; }
  // the walls: a thunk into timber, a glance off stone (07g_walls.js)
  if (typeof wallSfx === 'function') {
    const orig = wallSfx;
    wallSfx = sndAdopt('wall', orig, (kind, x, z) => [x, null, z, { args: (r) => [r.px, r.pz] }], { _: { ref: 3, max: 50, lvl: 0.35, per: 3 }, stone: { ref: 6, max: 110, lvl: 0.7 } });
  }
  // the callings: parries, blocks, frost, runes, snares (05j_classfx.js)
  if (typeof classSfx === 'function') {
    const orig = classSfx;
    classSfx = sndAdopt('cls', orig, (kind, x, z) => [x, null, z], { _: { ref: 3, max: 60, lvl: 0.4, per: 3 }, overload: { ref: 6, max: 90, lvl: 0.7 } });
  }
  // the land: chopping, a tree's creak and fall, crackle, a log split (05h_nature.js)
  if (typeof natSfx === 'function') {
    const orig = natSfx;
    natSfx = sndAdopt('nat', orig, (kind, x, z) => [x, null, z], { _: { ref: 3, max: 60, lvl: 0.4 }, crash: { ref: 10, max: 160, lvl: 0.9 }, creak: { ref: 6, max: 80, lvl: 0.35 } });
  }
  // the realms' gifts: the standard planted, the hunt's howl, the gale (06c_gifts.js)
  if (typeof giftSfx === 'function') {
    const orig = giftSfx;
    giftSfx = sndAdopt('gift', orig, (kind, x, z) => [x, null, z], { _: { ref: 8, max: 120, lvl: 0.6 } });
  }
  // the beasts' own voices (08h_animals.js)
  if (typeof anVoice === 'function') {
    const orig = anVoice;
    anVoice = (k, e) => {
      if (!e) { orig(k, e); return; }
      const name = 'an:' + k;
      if (!SND_SYNTH[name]) SND_SYNTH[name] = () => { const r = SND_ADOPT_NEAR(); orig(k, { x: r.x, z: r.z }); };
      if (!SND_DEF[name]) SND_DEF[name] = { ref: 4, max: 70, lvl: 0.3, per: 1, gap: 1 };
      sfxAtE(name, e, null, 0.8);
    };
  }
  // the boats: a hull knocking, grounding (07e_boats.js): at the boat when it is given
  if (typeof boatSfx === 'function') {
    const orig = boatSfx;
    boatSfx = sndAdopt('boat', orig, (kind, B) => (B && B.x !== undefined ? [B.x, B.y ?? null, B.z] : null), { _: { ref: 3, max: 45, lvl: 0.3 } });
  }
  // survival: the line cast, the float's plop, a bite (09s_survival.js): placed where they are, when a place is given
  if (typeof survSfx === 'function') {
    const orig = survSfx;
    survSfx = sndAdopt('surv', orig, (kind, x, z) => (x === undefined ? null : [x, null, z]), { _: { ref: 3, max: 45, lvl: 0.25 } });
  }
});

/* ------------------------------------------------------------------ */
/* offline rendering (tests): a sound placed, through its voice chain   */
/* ------------------------------------------------------------------ */
// o: { secs, at: [x, y, z] (from a listener at the origin facing -z), occ (0..1 forced), phone, hp (a high-pass:
// what is left of it on a phone's speaker), seed }
async function sndRenderOffline(name, o = {}) {
  const sr = o.sr || 44100, secs = o.secs || 2.5, AC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  const octx = new AC(2, Math.ceil(sr * secs), sr);
  const keep = { ctx: AUDIO.ctx, bus: AUDIO.sfxBus, noise: AUDIO.noise, end: AUDIO.voiceEnd, L: { ...SND.L }, rnd: Math.random };
  // a seeded noise and Math.random, so a sound renders the same each time
  let s = (o.seed ?? 7) >>> 0 || 7;
  const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  const nb = octx.createBuffer(1, sr * 2, sr), nd = nb.getChannelData(0);
  for (let i = 0; i < nd.length; i++) nd[i] = rnd() * 2 - 1;
  const top = octx.createGain(); top.gain.value = AUDIO_BASE.sfx * AUDIO_BASE.master; // the effects at Medium through the master at Medium
  let tail = top;
  if (o.hp) { const f = octx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = o.hp; f.Q.value = 0.707; const f2 = octx.createBiquadFilter(); f2.type = 'highpass'; f2.frequency.value = o.hp; f2.Q.value = 0.707; tail.connect(f).connect(f2); tail = f2; }
  tail.connect(octx.destination);
  const bus = octx.createGain(); bus.connect(top);
  if (o.phone) { // the phone's harmonics, as sndInit has them
    const lp = octx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 150;
    const ws = octx.createWaveShaper(); ws.curve = sndHarmCurve();
    const bp = octx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 330; bp.Q.value = 0.6;
    const g = octx.createGain(); g.gain.value = 0.55;
    bus.connect(lp).connect(ws).connect(bp).connect(g).connect(top);
  }
  let res;
  try {
    AUDIO.ctx = octx; AUDIO.noise = nb; Math.random = rnd;
    // a listener at the origin facing -z, the source where asked
    Object.assign(SND.L, { x: 0, y: 0, z: 0, fx: 0, fz: -1, rx: 1, rz: 0, ok: true });
    const at = o.at || [0, 0, -1], def = SND_DEF[name] || SND_DEF._, mix = { ...sndMixAt(def, at[0], at[1], at[2], o, { g: 0, pan: 0, fc: 0, d: 0 }) };
    let g = mix.g * (o.vol ?? 1), fc = mix.fc;
    if (o.occ) { g *= 1 - 0.68 * o.occ; fc = Math.min(fc, 650 + 900 * (1 - o.occ)); }
    const vg = octx.createGain(); vg.gain.value = g;
    let out = vg;
    if (fc < 15000) { const f = octx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = fc; f.Q.value = 0.6; out.connect(f); out = f; }
    if (Math.abs(mix.pan) > 0.02) { const p = octx.createStereoPanner(); p.pan.value = mix.pan; out.connect(p); out = p; }
    out.connect(bus);
    AUDIO.sfxBus = vg; AUDIO.voiceEnd = 0;
    sfxSynth(name, 0.02, 1, o.args || null);
    res = { mix: { g: Math.round(g * 1e4) / 1e4, pan: Math.round(mix.pan * 100) / 100, fc: Math.round(fc), d: Math.round(mix.d * 10) / 10 }, end: Math.round(AUDIO.voiceEnd * 100) / 100 };
  } finally {
    AUDIO.ctx = keep.ctx; AUDIO.sfxBus = keep.bus; AUDIO.noise = keep.noise; AUDIO.voiceEnd = keep.end; Object.assign(SND.L, keep.L); Math.random = keep.rnd;
  }
  const buf = await octx.startRendering();
  const Lc = buf.getChannelData(0), Rc = buf.getChannelData(1), n = Lc.length;
  let pk = 0, sl = 0, sr2 = 0, clip = 0, mw = 0, ws = 0, last = 0, hi = 0, prev = 0;
  const win = Math.floor(sr * 0.05);
  for (let i = 0; i < n; i++) {
    const a = Math.max(Math.abs(Lc[i]), Math.abs(Rc[i]));
    if (a > pk) pk = a;
    if (a >= 0.999) clip++;
    if (a > 1e-4) last = i;
    sl += Lc[i] * Lc[i]; sr2 += Rc[i] * Rc[i];
    const m = (Lc[i] + Rc[i]) / 2, dm = m - prev; prev = m; hi += dm * dm; // the first difference: how much lives in the highs
    ws += m * m;
    if (i % win === win - 1) { mw = Math.max(mw, ws / win); ws = 0; }
  }
  const db = (x) => Math.round(10 * Math.log10(x + 1e-12) * 10) / 10;
  return { name, ...res, peakDb: Math.round(20 * Math.log10(pk + 1e-12) * 10) / 10, rmsL: db(sl / n), rmsR: db(sr2 / n), rmsDb: db((sl + sr2) / 2 / n), loud50Db: db(mw), clip, len: Math.round((last / sr) * 100) / 100, finite: Number.isFinite(sl + sr2), bright: Math.round((hi / Math.max(1e-12, (sl + sr2) / 2)) * 1000) / 1000 };
}

/* test hooks: window.__hm.snd */
queueMicrotask(() => {
  if (!window.__hm) return;
  window.__hm.snd = {
    SND, SND_DEF, SND_SYNTH, SND_PLACE, SOUND_LEVELS, sfxAt, sfxAtE, sndFlush, sndMixAt, sndDistGain, sndOcc, sndListener, sndPlaceAt, sndUpdate,
    setSoundLevel, soundLevelKey, soundVolumeKey, sndOnLoose, sndKeepAlarm, sndNewsCue, sndShieldBroke, render: sndRenderOffline, sndBuf,
    names: () => [...new Set([...Object.keys(SND_SYNTH).filter((k) => !k.includes(':')), ...Object.keys(SND_DEF).filter((k) => k !== '_')])],
    mix(name, x, y, z) { sndListener(); const def = SND_DEF[name] || SND_DEF._, m = sndMixAt(def, x, y, z, null, { g: 0, pan: 0, fc: 0, d: 0 }); return { g: Math.round(m.g * 1e4) / 1e4, pan: Math.round(m.pan * 100) / 100, fc: Math.round(m.fc), d: Math.round(m.d * 10) / 10, occ: sndOcc(x, y, z) }; },
    state() {
      const now = AUDIO.ctx ? AUDIO.ctx.currentTime : 0;
      return {
        ctx: AUDIO.ctx ? AUDIO.ctx.state : 'none', ready: SND.ready, on: AUDIO.on, lvl: { ...AUDIO.lvl }, cap: SND.cap, queue: SND.q.length,
        live: SND.voices.filter((v) => v.end > now).length, voices: SND.voices.length, stats: { ...SND.stats }, played: { ...SND.played }, log: SND.log.slice(-20),
        loops: SND.loops.map((V) => ({ buf: V.buf, on: Math.round(V.on * 1000) / 1000, x: Math.round(V.x), z: Math.round(V.z) })), battle: SND.battle, place: { ...SND_PLACE },
        air: SND.air ? Object.fromEntries(Object.entries(SND.air.k).map(([k, v]) => [k, Math.round(v * 10000) / 10000])) : null, wet: SND.rev ? Math.round(SND.rev.send.gain.value * 1000) / 1000 : 0,
      };
    },
    resetCounts() { SND.count = {}; SND.played = {}; for (const k in SND.stats) SND.stats[k] = 0; SND.log.length = 0; },
  };
});
