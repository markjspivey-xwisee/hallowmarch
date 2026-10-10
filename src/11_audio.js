/* ================================================================== */
/* audio: small synthesised effects and an ambient bed (Web Audio)     */
/* ================================================================== */
const AUDIO = { ctx: null, master: null, sfxBus: null, amb: null, on: true, last: {}, noise: null, chirpAt: 4, cricket: null };

function audioUnlock() {
  if (!AUDIO.on && AUDIO.ctx) return;
  try {
    if (!AUDIO.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      const ctx = new AC();
      AUDIO.ctx = ctx;
      AUDIO.master = ctx.createGain();
      AUDIO.master.gain.value = AUDIO.on ? 0.5 : 0;
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -16; comp.knee.value = 12; comp.ratio.value = 4;
      AUDIO.master.connect(comp).connect(ctx.destination);
      AUDIO.comp = comp; // [water2] the muffled world under the water goes in before it (07d_dive.js)
      AUDIO.sfxBus = ctx.createGain();
      AUDIO.sfxBus.gain.value = 0.9;
      AUDIO.sfxBus.connect(AUDIO.master);
      // two seconds of white noise, reused by every noisy sound
      const len = ctx.sampleRate * 2;
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      AUDIO.noise = buf;
      startAmbience();
    }
    if (AUDIO.ctx.state === 'suspended') AUDIO.ctx.resume();
  } catch (e) { /* audio is optional */ }
}
function setSound(on) {
  AUDIO.on = on;
  if (on) audioUnlock();
  if (AUDIO.master) AUDIO.master.gain.setTargetAtTime(on ? 0.5 : 0, AUDIO.ctx.currentTime, 0.05);
}

/* building blocks */
function env(g, t, a, peak, d, end = 0.0001) {
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + a);
  g.gain.exponentialRampToValueAtTime(end, t + a + d);
}
function tone(type, f0, f1, t, dur, vol, a = 0.005, dest = AUDIO.sfxBus) {
  const ctx = AUDIO.ctx;
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f0, t);
  if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
  env(g, t, a, vol, dur);
  o.connect(g).connect(dest);
  o.start(t); o.stop(t + a + dur + 0.05);
  return o;
}
function noiseBurst(t, dur, vol, ftype, f0, f1, q = 1, a = 0.004, dest = AUDIO.sfxBus) {
  const ctx = AUDIO.ctx;
  const s = ctx.createBufferSource();
  s.buffer = AUDIO.noise;
  s.playbackRate.value = 0.8 + Math.random() * 0.4;
  const f = ctx.createBiquadFilter();
  f.type = ftype; f.Q.value = q;
  f.frequency.setValueAtTime(f0, t);
  if (f1 !== f0) f.frequency.exponentialRampToValueAtTime(Math.max(30, f1), t + dur);
  const g = ctx.createGain();
  env(g, t, a, vol, dur);
  s.connect(f).connect(g).connect(dest);
  s.start(t, Math.random() * 1.5);
  s.stop(t + a + dur + 0.05);
}
function brass(t, freqs, step, len, vol) {
  // a soft horn: detuned saws through a closing low-pass
  const ctx = AUDIO.ctx;
  freqs.forEach((fq, i) => {
    const t0 = t + i * step;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass'; f.Q.value = 2;
    f.frequency.setValueAtTime(300, t0);
    f.frequency.linearRampToValueAtTime(1500, t0 + 0.08);
    f.frequency.exponentialRampToValueAtTime(500, t0 + len);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + 0.06);
    g.gain.setValueAtTime(vol, t0 + len * 0.6);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + len);
    f.connect(g).connect(AUDIO.sfxBus);
    for (const det of [-6, 5]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth'; o.frequency.value = fq; o.detune.value = det;
      o.connect(f); o.start(t0); o.stop(t0 + len + 0.05);
    }
  });
}

const SFX_GAP = { error: 0.25, click: 0.04, hit: 0.05, swing: 0.06, bow: 0.06, thud: 0.08, hoof: 0.06, hoofFast: 0.05, wade: 0.12, swim: 0.3, splashBig: 0.4 }; // [water] wade, swim, splashBig
function sfx(name) {
  if (!AUDIO.ctx || !AUDIO.on || AUDIO.ctx.state !== 'running') return;
  const ctx = AUDIO.ctx, t = ctx.currentTime + 0.005;
  const gap = SFX_GAP[name] ?? 0.05;
  if (t - (AUDIO.last[name] || -1) < gap) return;
  AUDIO.last[name] = t;
  if (name === 'levelup') musicStinger('levelup'); // [music] a level or realm rank gained
  try {
    switch (name) {
      case 'click': tone('sine', 1250, 820, t, 0.05, 0.08); break;
      case 'error': tone('square', 210, 190, t, 0.07, 0.035); tone('square', 180, 160, t + 0.09, 0.08, 0.035); break;
      case 'swing': noiseBurst(t, 0.16, 0.16, 'bandpass', 700, 2600, 1.4, 0.02); break;
      case 'hit': noiseBurst(t, 0.09, 0.22, 'lowpass', 2600, 700, 0.8); tone('sine', 140, 55, t, 0.12, 0.25); break;
      case 'thud': tone('sine', 95, 38, t, 0.28, 0.4); noiseBurst(t, 0.18, 0.14, 'lowpass', 900, 200, 0.7); break;
      case 'bow': tone('triangle', 190, 120, t, 0.14, 0.16); noiseBurst(t, 0.09, 0.08, 'highpass', 3000, 2000, 0.7); break;
      case 'zap': tone('sawtooth', 520, 1300, t, 0.12, 0.05); noiseBurst(t, 0.1, 0.05, 'bandpass', 2400, 4200, 3); break;
      case 'cast': tone('sine', 380, 720, t, 0.32, 0.06, 0.06); tone('sine', 570, 1080, t + 0.03, 0.3, 0.04, 0.06); break;
      case 'fire': noiseBurst(t, 0.38, 0.28, 'lowpass', 350, 2400, 1.2, 0.03); tone('sine', 190, 80, t, 0.32, 0.15); break;
      case 'frost': [1560, 2090, 2640].forEach((f, i) => tone('sine', f, f * 1.02, t + i * 0.045, 0.22, 0.05)); noiseBurst(t, 0.2, 0.06, 'highpass', 5000, 6000, 1); break;
      case 'holy': [523, 659, 784].forEach((f) => tone('sine', f, f, t, 0.6, 0.05, 0.05)); break;
      case 'heal': [523, 659, 784, 1046].forEach((f, i) => tone('sine', f, f, t + i * 0.07, 0.4, 0.05, 0.02)); break;
      case 'blink': tone('sine', 2100, 280, t, 0.22, 0.09); noiseBurst(t, 0.2, 0.07, 'bandpass', 3000, 600, 2); break;
      case 'boom': noiseBurst(t, 0.9, 0.5, 'lowpass', 900, 90, 0.9, 0.01); tone('sine', 70, 34, t, 0.8, 0.5); break;
      case 'crash': noiseBurst(t, 1.1, 0.5, 'lowpass', 2600, 160, 0.8, 0.005); tone('sine', 85, 30, t, 0.9, 0.5); noiseBurst(t + 0.12, 0.5, 0.2, 'bandpass', 1200, 400, 2); break;
      case 'horn': brass(t, [146.8, 220], 0.42, 0.9, 0.06); break;
      case 'fanfare': brass(t, [261.6, 329.6, 392, 523.2], 0.14, 0.7, 0.05); break;
      case 'levelup': [523, 659, 784, 1046, 1318].forEach((f, i) => { tone('sine', f, f, t + i * 0.08, 0.5, 0.06, 0.01); tone('triangle', f * 2, f * 2, t + i * 0.08, 0.25, 0.015); }); break;
      case 'portal': noiseBurst(t, 0.7, 0.18, 'bandpass', 300, 2600, 4, 0.12); tone('sine', 220, 660, t, 0.6, 0.06, 0.1); break;
      case 'death': tone('sine', 220, 70, t, 1.2, 0.18, 0.02); tone('triangle', 110, 40, t + 0.1, 1.2, 0.1, 0.02); break;
      case 'fizzle': noiseBurst(t, 0.2, 0.08, 'bandpass', 2400, 500, 2); break;
      case 'hoof': tone('sine', 190, 110, t, 0.05, 0.12); noiseBurst(t, 0.035, 0.07, 'bandpass', 1700, 900, 2); break;
      case 'hoofFast': tone('sine', 170, 100, t, 0.04, 0.14); noiseBurst(t, 0.03, 0.09, 'bandpass', 1500, 800, 2); break;
      case 'whistle': tone('sine', 1400, 2300, t, 0.16, 0.06, 0.02); tone('sine', 1700, 2900, t + 0.2, 0.22, 0.06, 0.02); break;
      case 'whinny': [960, 1250, 900, 1180, 820, 1050, 700].forEach((f, i) => { const o = tone('sawtooth', f, f * 0.94, t + i * 0.07, 0.09, 0.025, 0.01); o.detune.setValueAtTime(-20, t); }); noiseBurst(t + 0.5, 0.35, 0.05, 'lowpass', 900, 300, 0.7, 0.05); break;
      case 'roar': noiseBurst(t, 1.6, 0.45, 'lowpass', 700, 140, 1.2, 0.08); { const o = tone('sawtooth', 120, 62, t, 1.5, 0.12, 0.1); o.detune.setValueAtTime(30, t); } tone('sawtooth', 180, 90, t + 0.05, 1.3, 0.06, 0.1); noiseBurst(t, 1.2, 0.2, 'bandpass', 1400, 500, 2, 0.15); break;
      case 'wingbeat': noiseBurst(t, 0.45, 0.22, 'lowpass', 500, 120, 0.8, 0.12); break;
      case 'breath': noiseBurst(t + 0.6, 1.6, 0.4, 'bandpass', 900, 500, 0.7, 0.15); noiseBurst(t + 0.6, 1.6, 0.25, 'lowpass', 400, 200, 0.8, 0.2); tone('sawtooth', 90, 70, t, 0.6, 0.06, 0.2); break;
      case 'thunder': noiseBurst(t, 3.2, 0.42, 'lowpass', 420, 60, 0.7, 0.25); noiseBurst(t + 0.4, 2.4, 0.3, 'lowpass', 260, 50, 0.6, 0.3); break;
      case 'thunderNear': noiseBurst(t, 0.25, 0.5, 'highpass', 1800, 900, 0.7, 0.002); noiseBurst(t + 0.05, 3.4, 0.6, 'lowpass', 900, 55, 0.7, 0.04); tone('sine', 62, 32, t, 2.2, 0.35, 0.05); break;
      case 'coins': for (let i = 0; i < 4; i++) { const f = 2300 + Math.random() * 900; tone('triangle', f, f * 0.985, t + i * 0.045 + Math.random() * 0.02, 0.16, 0.03, 0.002); } noiseBurst(t, 0.05, 0.04, 'highpass', 5000, 6000, 1); break;
      case 'loot': noiseBurst(t, 0.16, 0.1, 'bandpass', 1300, 700, 1.2, 0.02); tone('sine', 660, 640, t + 0.05, 0.18, 0.025, 0.01); break;
      case 'lootRare': [880, 1320, 1760].forEach((f, i) => tone('sine', f, f, t + i * 0.06, 0.9, 0.04, 0.004)); noiseBurst(t, 0.12, 0.06, 'bandpass', 1300, 700, 1.2, 0.02); break;
      case 'lootEpic': [523.3, 784, 1046.5, 1568, 2093].forEach((f, i) => { tone('sine', f, f, t + i * 0.07, 1.4, 0.045, 0.004); tone('triangle', f * 2.01, f * 2.01, t + i * 0.07, 0.5, 0.008, 0.004); }); break;
      case 'lootLegend': brass(t, [196, 293.7, 392], 0.0, 2.2, 0.035); [784, 987.8, 1174.7, 1568, 1975.5, 2349].forEach((f, i) => tone('sine', f, f, t + 0.15 + i * 0.09, 1.8, 0.04, 0.004)); noiseBurst(t, 1.6, 0.06, 'highpass', 6000, 9000, 0.8, 0.4); break;
      case 'equip': noiseBurst(t, 0.1, 0.12, 'lowpass', 2400, 600, 1, 0.004); tone('sine', 320, 190, t, 0.1, 0.08); noiseBurst(t + 0.07, 0.06, 0.06, 'bandpass', 3000, 2400, 3, 0.002); break;
      case 'equipWeapon': noiseBurst(t, 0.42, 0.12, 'highpass', 3500, 7500, 2, 0.01); tone('sine', 2650, 2600, t + 0.02, 0.7, 0.03, 0.002); tone('sine', 3970, 3950, t + 0.02, 0.5, 0.012, 0.002); break;
      case 'potion': for (let i = 0; i < 3; i++) tone('sine', 260 + i * 70, 420 + i * 90, t + i * 0.11, 0.09, 0.07, 0.01); tone('sine', 2900, 2900, t + 0.42, 0.25, 0.02, 0.002); [523, 784].forEach((f, i) => tone('sine', f, f, t + 0.45 + i * 0.08, 0.5, 0.03, 0.01)); break;
      case 'bagOpen': noiseBurst(t, 0.2, 0.09, 'bandpass', 1100, 600, 1.1, 0.03); tone('triangle', 1900, 1700, t + 0.12, 0.05, 0.02, 0.002); break;
      case 'chain': for (let i = 0; i < 5; i++) { const f = 700 + Math.random() * 900; tone('triangle', f, f * 0.9, t + i * 0.07 + Math.random() * 0.03, 0.12, 0.035, 0.002); } noiseBurst(t, 0.4, 0.06, 'bandpass', 2600, 1800, 2, 0.01); break;
      case 'grind': noiseBurst(t, 1.1, 0.28, 'lowpass', 420, 160, 1.6, 0.08); tone('sine', 52, 44, t, 1.1, 0.14, 0.1); noiseBurst(t + 0.2, 0.6, 0.08, 'bandpass', 900, 500, 3, 0.05); break;
      case 'roarSmall': noiseBurst(t, 0.8, 0.22, 'bandpass', 700, 280, 1.4, 0.06); { const o = tone('sawtooth', 115, 78, t, 0.75, 0.05, 0.06); o.detune.setValueAtTime(-25, t); } break;
      case 'ventRoar': noiseBurst(t, 1.1, 0.32, 'lowpass', 260, 1900, 0.9, 0.08); noiseBurst(t + 0.05, 0.9, 0.12, 'bandpass', 1200, 500, 1, 0.1); break;
      case 'chestOpen': { const o = tone('sawtooth', 170, 245, t, 0.45, 0.025, 0.05); o.detune.setValueAtTime(15, t); } noiseBurst(t, 0.45, 0.05, 'bandpass', 900, 1300, 6, 0.05); tone('triangle', 1300, 1250, t + 0.42, 0.05, 0.04, 0.002); break;
      case 'kingRoar': noiseBurst(t, 2.2, 0.5, 'lowpass', 520, 110, 1.2, 0.12); { const o = tone('sawtooth', 76, 46, t, 2.0, 0.13, 0.15); o.detune.setValueAtTime(20, t); } tone('sawtooth', 112, 66, t + 0.08, 1.8, 0.07, 0.15); noiseBurst(t, 1.6, 0.18, 'bandpass', 1500, 600, 2.5, 0.2); break;
      case 'raise': tone('sine', 180, 620, t, 1.2, 0.06, 0.2); tone('sine', 240, 830, t + 0.1, 1.1, 0.04, 0.2); noiseBurst(t, 1.2, 0.1, 'highpass', 2000, 5000, 0.8, 0.3); break;
      case 'lance': noiseBurst(t, 0.35, 0.22, 'highpass', 2500, 4500, 0.9, 0.004); [1180, 1770, 2360].forEach((f, i) => tone('sine', f, f * 0.97, t + i * 0.02, 0.7, 0.035, 0.003)); tone('sine', 140, 60, t, 0.3, 0.2); break;
      case 'kingDeath': { const o = tone('sawtooth', 150, 38, t, 2.8, 0.1, 0.1); o.detune.setValueAtTime(30, t); } noiseBurst(t, 2.8, 0.3, 'lowpass', 700, 80, 1.1, 0.2); [523, 659, 784].forEach((f, i) => tone('sine', f * 0.5, f * 0.5, t + 1.6 + i * 0.25, 2.0, 0.03, 0.4)); break;
      case 'descend': for (let i = 0; i < 5; i++) { tone('sine', 120 - i * 8, 60, t + i * 0.16, 0.09, 0.12, 0.003); noiseBurst(t + i * 0.16, 0.05, 0.06, 'bandpass', 900, 500, 1.5, 0.002); } noiseBurst(t + 0.1, 1.4, 0.14, 'lowpass', 700, 160, 0.8, 0.3); break;
      case 'ascend': for (let i = 0; i < 5; i++) { tone('sine', 90 + i * 8, 55, t + i * 0.15, 0.09, 0.11, 0.003); noiseBurst(t + i * 0.15, 0.05, 0.06, 'bandpass', 1000, 600, 1.5, 0.002); } noiseBurst(t + 0.2, 1.2, 0.12, 'bandpass', 600, 2400, 0.7, 0.4); break;
      case 'whirl': for (let i = 0; i < 3; i++) noiseBurst(t + i * 0.2, 0.22, 0.16, 'bandpass', 600 + i * 300, 2800, 1.2, 0.04); tone('sine', 160, 110, t, 0.7, 0.05, 0.1); break;
      case 'slam': noiseBurst(t, 0.6, 0.5, 'lowpass', 1400, 90, 0.9, 0.003); tone('sine', 92, 30, t, 0.6, 0.55); noiseBurst(t + 0.03, 0.4, 0.16, 'bandpass', 700, 300, 1.5, 0.01); break;
      case 'shock': noiseBurst(t, 0.22, 0.28, 'highpass', 2200, 5200, 0.8, 0.002); tone('sawtooth', 140, 90, t, 0.18, 0.06, 0.004); noiseBurst(t + 0.04, 0.3, 0.12, 'bandpass', 3800, 1600, 2, 0.01); break;
      case 'blizzard': noiseBurst(t, 2.6, 0.22, 'bandpass', 1800, 3600, 0.6, 0.4); noiseBurst(t, 2.4, 0.16, 'lowpass', 500, 300, 0.7, 0.5); [1760, 2349, 2794].forEach((f, i) => tone('sine', f, f * 1.01, t + 0.1 + i * 0.07, 0.6, 0.025, 0.01)); break;
      case 'pillar': [392, 523.3, 659.3, 784, 1046.5].forEach((f, i) => tone('sine', f, f, t + i * 0.03, 1.5, 0.045, 0.08)); noiseBurst(t, 1.2, 0.12, 'highpass', 4000, 8000, 0.7, 0.2); tone('sine', 110, 55, t, 0.8, 0.2, 0.01); break;
      case 'renew': [392, 494, 587, 784].forEach((f, i) => tone('sine', f, f, t + i * 0.09, 1.1, 0.04, 0.05)); noiseBurst(t, 1.0, 0.05, 'highpass', 5000, 7000, 0.7, 0.3); break;
      case 'deadeye': tone('triangle', 240, 120, t, 0.2, 0.22); noiseBurst(t, 0.16, 0.18, 'highpass', 2800, 1600, 0.7, 0.002); tone('sine', 1900, 1500, t + 0.02, 0.35, 0.03, 0.002); break;
      case 'ignite': noiseBurst(t, 0.45, 0.12, 'bandpass', 900, 2600, 1, 0.02); break;
      case 'hiss': noiseBurst(t, 0.85, 0.09, 'highpass', 3200, 5600, 0.7, 0.02); noiseBurst(t, 0.3, 0.05, 'bandpass', 1800, 900, 1.5); break;
      case 'drip': { const f = 1500 + Math.random() * 900; tone('sine', f, f * 0.55, t, 0.07, 0.03, 0.002); tone('sine', f * 0.9, f * 0.5, t + 0.16, 0.08, 0.012, 0.002); } break;
      // [water] (07b_swim.js): a foot in the water, a stroke, a body going in, a mouthful
      case 'wade': noiseBurst(t, 0.16, 0.07, 'bandpass', 900 + Math.random() * 500, 420, 1.3, 0.008); tone('sine', 300 + Math.random() * 120, 140, t, 0.07, 0.03, 0.004); break;
      case 'swim': noiseBurst(t, 0.34, 0.06, 'bandpass', 700, 1500, 0.9, 0.05); noiseBurst(t + 0.05, 0.22, 0.035, 'highpass', 2600, 3400, 0.7, 0.03); break;
      case 'splash': noiseBurst(t, 0.45, 0.16, 'lowpass', 2400, 500, 0.8, 0.005); { const f = 500 + Math.random() * 300; tone('sine', f, f * 0.4, t, 0.12, 0.05, 0.003); } break;
      case 'splashBig': noiseBurst(t, 0.9, 0.32, 'lowpass', 3000, 300, 0.7, 0.004); tone('sine', 160, 55, t, 0.35, 0.22, 0.004); noiseBurst(t + 0.15, 0.8, 0.1, 'highpass', 2500, 4200, 0.6, 0.05); for (let i = 0; i < 4; i++) { const f = 900 + Math.random() * 1200; tone('sine', f, f * 0.5, t + 0.35 + i * 0.11 + Math.random() * 0.05, 0.06, 0.02, 0.002); } break;
      case 'gulp': for (let i = 0; i < 3; i++) { tone('sine', 260 - i * 15, 150, t + i * 0.22, 0.09, 0.08, 0.01); noiseBurst(t + i * 0.22, 0.08, 0.03, 'lowpass', 600, 300, 1, 0.01); } break;
      default: break;
    }
  } catch (e) { if (AUDIO.debug) throw e; }
}

/* ambient bed: wind in the day, crickets at night, the odd bird */
function startAmbience() {
  const ctx = AUDIO.ctx;
  const bus = ctx.createGain();
  bus.gain.value = 0.55;
  bus.connect(AUDIO.master);
  const src = ctx.createBufferSource();
  src.buffer = AUDIO.noise; src.loop = true; src.playbackRate.value = 0.5;
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass'; lp.frequency.value = 420; lp.Q.value = 0.4;
  const wind = ctx.createGain();
  wind.gain.value = 0.0;
  src.connect(lp).connect(wind).connect(bus);
  src.start();
  // crickets: an amplitude-pulsed high sine
  const cr = ctx.createOscillator(); cr.type = 'sine'; cr.frequency.value = 4400;
  const crAmp = ctx.createGain(); crAmp.gain.value = 0;
  const lfo = ctx.createOscillator(); lfo.type = 'square'; lfo.frequency.value = 26;
  const lfoGain = ctx.createGain(); lfoGain.gain.value = 0.5;
  const crGain = ctx.createGain(); crGain.gain.value = 0;
  lfo.connect(lfoGain).connect(crAmp.gain);
  cr.connect(crAmp).connect(crGain).connect(bus);
  cr.start(); lfo.start();
  // rain: a bright hiss and a low patter
  const rs = ctx.createBufferSource();
  rs.buffer = AUDIO.noise; rs.loop = true; rs.playbackRate.value = 1.0;
  const rbp = ctx.createBiquadFilter(); rbp.type = 'bandpass'; rbp.frequency.value = 2600; rbp.Q.value = 0.5;
  const rain = ctx.createGain(); rain.gain.value = 0;
  rs.connect(rbp).connect(rain).connect(bus);
  rs.start();
  AUDIO.amb = { bus, wind, lp, crGain, rain };
}
function chirp(t) {
  const ctx = AUDIO.ctx;
  const base = 2600 + Math.random() * 1600;
  const n = 2 + Math.floor(Math.random() * 3);
  const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
  const dest = ctx.createGain();
  dest.gain.value = 0.5;
  if (pan) { pan.pan.value = Math.random() * 1.6 - 0.8; dest.connect(pan).connect(AUDIO.amb.bus); } else dest.connect(AUDIO.amb.bus);
  for (let i = 0; i < n; i++) tone('sine', base * (1 + Math.random() * 0.15), base * (0.8 + Math.random() * 0.5), t + i * 0.11, 0.07, 0.025, 0.01, dest);
}
function updateAudio(dt) {
  updateMusic(dt); // [music] the score: moods, battle layers, stingers, ducking (11b_music.js)
  if (!AUDIO.ctx || !AUDIO.amb || AUDIO.ctx.state !== 'running') return;
  const t = AUDIO.ctx.currentTime;
  const night = U.uNight.value;
  const camY = camera.position.y;
  const exposure = clamp((camY - 4) / 30, 0, 1);
  const gust = 1 + 1.2 * WEATHER.storm + 0.5 * WEATHER.overcast;
  const out = INDOOR.on ? 0 : 1;
  // under the barrow the wind becomes a low moan through the passages
  const windGain = INDOOR.on ? 0.07 * (0.6 + 0.4 * Math.sin(t * 0.17) * Math.sin(t * 0.05 + 1)) : (0.05 + 0.08 * exposure) * (1 - night * 0.4) * gust * (0.8 + 0.4 * Math.sin(t * 0.13) * Math.sin(t * 0.07));
  AUDIO.amb.wind.gain.setTargetAtTime(windGain, t, 0.6);
  AUDIO.amb.rain.gain.setTargetAtTime(out * 0.11 * WEATHER.raining * (1 - clamp(WEATHER.snowing / Math.max(WEATHER.raining, 0.01), 0, 1)), t, 1.2);
  AUDIO.amb.lp.frequency.setTargetAtTime(INDOOR.on ? 170 + 50 * Math.sin(t * 0.3) : 380 + 260 * exposure + 120 * Math.sin(t * 0.21), t, 0.8);
  AUDIO.amb.crGain.gain.setTargetAtTime(out * 0.012 * smooth(clamp((night - 0.45) / 0.4, 0, 1)), t, 1.5);
  AUDIO.chirpAt -= dt;
  if (AUDIO.chirpAt <= 0) {
    AUDIO.chirpAt = 3 + Math.random() * 9;
    if (night < 0.35 && WEATHER.raining < 0.3 && !INDOOR.on) chirp(t + 0.05);
  }
}
document.addEventListener('visibilitychange', () => {
  if (!AUDIO.ctx) return;
  if (document.hidden) AUDIO.ctx.suspend?.();
  else if (AUDIO.on) AUDIO.ctx.resume?.();
});
