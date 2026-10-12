/* ================================================================== */
/* water: bodies in the water                                          */
/* ================================================================== */
// Anything that walks into water wades: it slows as the water deepens, its feet splash and ring the surface, its
// gear soaks up to the waterline and fire on it goes out. Past chest height it swims: the body floats with head and
// shoulders out (beasts with their backs awash), strokes or paddles (treading water when still), and a river carries it
// downstream. A swimmer cannot cast or shoot, a rider's horse will not go deep, and the camera stays above the surface.
// The player always may swim; people and beasts swim when they chase something into the water, or to get out of it;
// townsfolk keep out. At any water the player can drink, fill a waterskin and wash their gear (E).
const SWIM = { inited: false, drinkAt: -99, enterAt: -99, rainT: 0, aoeSeen: new WeakSet(), sound: null, soundK: 0, notes: false, skinGiven: false };
// heights in the body's own size (scale 1): swim from chest-deep water, and the body floats this far down
const SWIM_HUMAN = { start: 1.24, stop: 1.1, float: 1.3 };
function beastBackH(kind) {
  const B = BEASTS[kind === 'stag' ? 'deer' : kind];
  if (!B || !B.body) return 0.9;
  let top = 0;
  for (const r of B.body) top = Math.max(top, r[1]);
  return top;
}
const BEAST_BACK = {};
// how deep water must be for this body to swim, and how far below the surface its feet then hang
function swimDims(e) {
  const sc = e.scale || 1;
  if (e._sd !== undefined && e._sdS === sc) return e._sd;
  e._sdS = sc;
  return (e._sd = swimDimsOf(e, sc));
}
function swimDimsOf(e, sc) {
  if (e.kind === 'humanoid') return { start: SWIM_HUMAN.start * sc, stop: SWIM_HUMAN.stop * sc, float: SWIM_HUMAN.float * sc, wade: SWIM_HUMAN.start * sc };
  if (crowdBeast[e.kind] || BEASTS[e.kind === 'stag' ? 'deer' : e.kind]) {
    const b = BEAST_BACK[e.kind] ?? (BEAST_BACK[e.kind] = beastBackH(e.kind));
    return { start: b * 0.82 * sc, stop: b * 0.7 * sc, float: b * 0.95 * sc, wade: b * 0.82 * sc };
  }
  return null; // wisps hover, doors and the dragon do not swim
}
// a body's floor in water: a swimmer floats at its own depth, anyone else stands on the bed (groundY, the player)
function waterFloorY(e, g) {
  if (e && e.boat) return boatSeatY(e, g); // [water2] in a boat: on its seat (07e_boats.js)
  if (!e || e.kind === 'door' || e.hover || e.fixedY !== null) return g;
  const w = waterAt(e.x, e.z);
  if (!w || onIce(e, w)) return g;
  const D = swimDims(e);
  if (!D) return g;
  if (w.depth > D.start || (e.swim && w.depth > D.stop)) {
    const fy = w.y - D.float;
    return fy > g ? fy : g;
  }
  return g;
}
// standing on a mage's ice over the water (07b_classes.js): the ice is a floor, and nobody on it wades or swims
function onIce(e, w) { return e.y > w.y - 0.25 && ((CLS.ice.length > 0 && !!iceAt(e.x, e.z)) || (SICE.on && seasonIceY(e.x, e.z) !== null)); } // [seasons] and a frozen lake (05k_seasons.js)
// walking speed in water: knee-deep slows a little, waist-deep a lot; swimming is slow and sprinting it costs breath
function waterSpeedMult(e) {
  if (e.swim) return e.kind === 'humanoid' ? 0.42 : 0.5;
  const k = e.wadeK || 0;
  return k > 0 ? 1 - 0.55 * k * k : 1;
}
// may this body go into deep water now (stepTo asks): the player always; others when chasing, fleeing or getting out
function swimAllowed(e) {
  if (e.role === 'player') return true;
  if (!swimDims(e) || e.fixedY !== null) return false;
  if (e.swim || deepWaterAt(e.x, e.z)) return true; // already in: let them out
  if (e.role === 'villager' || e.role === 'merchant' || e.role === 'herald' || e.role === 'guard' || e.role === 'lord' || e.role === 'guardian' || e.role === 'muster' || e.role === 'dungeonBoss' || e.role === 'boss') return false;
  if (e.role === 'critter') return !!(e.ai && e.ai.flee);
  if (e.role === 'animal' && e.tame && e.tame.owner === 'player' && e.tame.cmd !== 'pen' && e.tame.cmd !== 'stay') return true; // [animals] companions swim after you
  const t = e.target != null ? getEnt(e.target) : null;
  return !!(t && t.alive);
}
// the camera stays above the water
function waterCamY(cx, cz, cy) {
  const dy = diveCamY(cx, cz, cy); // [water2] a diver's camera goes under with them (07d_dive.js)
  if (dy !== null) return dy;
  const w = waterAt(cx, cz);
  return w && cy < w.y + 0.45 ? w.y + 0.45 : cy;
}
// for the actor shaders: a swimmer's stroke phase and effort, and how far over to swimming it is (iAnim.w < 0)
function waterAnimPack(e, a4) {
  if (!e.alive || !(e.swimK > 0.01) || e.role === 'bird') return; // [motion] a game bird's flight is packed by 09v_birds.js (a mallard rose from the water with its wings shut)
  a4[0] = e.swimPh || 0; a4[1] = e.swimAmt || 0; a4[3] = -Math.min(1, e.swimK);
}
// the waterline packed with the wetness for the actor shader (iWear.x: whole 5 cm steps of soaked height + wetness)
function waterlinePack(e) {
  const wl = clamp((e.wl || 0) / (e.scale || 1), 0, 2);
  return Math.round(wl / 0.05) + Math.min(clamp(e.wet || 0, 0, 1), 0.999);
}

/* ------------------------------------------------------------------ */
/* splashes                                                             */
/* ------------------------------------------------------------------ */
// spray, a ring of foam and a ripple at a point of the water; size 0.3 (a step) .. 1 (a body) .. 2 (a meteor)
function splashAt(x, z, size = 1, opts = {}) {
  const w = waterAt(x, z);
  if (!w) return false;
  if (SICE.on && seasonIceAt(x, z) > 0.15) return false; // [seasons] no splash on the ice (05k_seasons.js)
  const y = w.y + 0.02, A = U.uAmbient.value, L = U.uLightColor.value;
  const c = [A.x * 0.85 + L.x * 0.45, A.y * 0.85 + L.y * 0.45, A.z * 0.85 + L.z * 0.5];
  const near = dist2(x, z, camera.position.x, camera.position.z) < 70 * 70;
  if (near) {
    const n = Math.round(6 + 14 * size);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU, s = (0.3 + Math.random() * 0.9) * (0.5 + 0.5 * size);
      fxAlpha.emit(x + Math.cos(a) * 0.15 * size, y, z + Math.sin(a) * 0.15 * size, Math.cos(a) * s * 0.7 + (opts.vx || 0), (0.8 + Math.random() * 1.6) * Math.sqrt(size + 0.2) * (opts.up || 1), Math.sin(a) * s * 0.7 + (opts.vz || 0), 0.45 + 0.25 * size, c[0], c[1], c[2], 0.07 + 0.05 * size, 9, 0);
    }
    if (size >= 0.3) FX.ring(x, y + 0.03, z, 0.12 * size, [c[0] * 0.45, c[1] * 0.45, c[2] * 0.45], Math.round(8 + 12 * size), 0.5 + 0.7 * size);
  }
  rippleDrop(x, z, 0.35 + 0.45 * size, 0.02 * size + 0.006);
  return true;
}
// steam where fire meets water
function waterSteam(x, y, z, n = 10) {
  for (let i = 0; i < n; i++) fxAlpha.emit(x + (Math.random() - 0.5) * 0.5, y + Math.random() * 0.3, z + (Math.random() - 0.5) * 0.5, (Math.random() - 0.5) * 0.5, 0.8 + Math.random() * 0.8, (Math.random() - 0.5) * 0.5, 1.4, 0.75, 0.77, 0.8, 0.3, -0.25, 1.2);
}

/* ------------------------------------------------------------------ */
/* the simulation step                                                  */
/* ------------------------------------------------------------------ */
function waterInit() {
  if (SWIM.inited) return;
  SWIM.inited = true;
  // field notes (10c_lore.js) for the first swim and the first current
  if (typeof FIELD_NOTES === 'object') {
    FIELD_NOTES.swim = { t: 'Swimming', x: () => `In deep water you swim. You cannot cast or shoot while swimming, and a fire on you goes out. ${IS_TOUCH ? 'Use' : 'E'} at any water to drink, fill a waterskin or wash your gear.` };
    FIELD_NOTES.current = { t: 'The current', x: () => 'Rivers run down into the lakes, fastest where they fall and run white. The current carries a swimmer downstream: swim across it, or let it take you.' };
    // [water2] diving and boats (07d_dive.js, 07e_boats.js)
    FIELD_NOTES.dive = { t: 'Under the water', x: () => `Look where you want to go and swim: down, along the bed, up again. ${IS_TOUCH ? 'Tap Up' : 'Space'} rises; stop swimming and you drift up. Watch your breath: when it is gone the water takes your health. Lost things lie on the beds of the lakes and the deep pools: ${IS_TOUCH ? 'tap Use' : 'press E'} beside them.` };
    FIELD_NOTES.divechest = { t: 'A sunken chest', x: () => 'Chests go down with boats and careless carters now and then, mostly in the deep middles of the lakes. Others will wash in, in time.' };
    FIELD_NOTES.tracks = { t: 'Tracks', x: () => 'Feet leave prints in lying snow, in the mud after rain and on the wet sand at the water\'s edge: boots, hooves, paws, the arrows of birds\' feet. Fresh snow fills them and fine weather dries them away, so a clear track is a fresh one.' };
    FIELD_NOTES.boat = { t: 'At the oars', x: () => `${IS_TOUCH ? 'Push the stick forward' : 'W'} to pull on the oars, ${IS_TOUCH ? 'back' : 'S'} to back water, ${IS_TOUCH ? 'left and right' : 'A and D'} to turn. The current takes a boat as it takes a swimmer, and a boat cannot cross land or ice: run it up on a shore to step out, or tie it up at a jetty. You can fish from it, and step out into deep water to dive.` };
  }
}
const _wUpd = { y: 0, depth: 0, fx: 0, fz: 0 };
function updateWater(dt) {
  waterInit();
  const P = GAME.player, camX = camera.position.x, camZ = camera.position.z;
  for (const e of ENT) {
    if (e.removed || e.kind === 'door' || e.kind === 'wisp' || e.kind === 'dragon') continue;
    if (e.boat) { if (e.swim || e.wd) { e.swim = false; e.wd = 0; e.wadeK = 0; } e.swimK = Math.max(0, (e.swimK || 0) - dt * 3); e.swimOK = false; continue; } // [water2] in a boat (07e_boats.js)
    const near = e === P || dist2(e.x, e.z, camX, camZ) < 160 * 160 || (P && dist2(e.x, e.z, P.x, P.z) < 160 * 160);
    if (!near) { e.swimOK = false; continue; }
    const D = swimDims(e);
    let w = D && !inDungeon(e) ? waterAt(e.x, e.z, _wUpd) : null;
    if (w && onIce(e, w)) w = null; // on the ice: dry feet
    if (w && e.y > w.y + 0.1) w = null; // [water2] above it: on a jetty's deck, or in the air
    const was = !!e.swim;
    if (!w || !D) {
      if (e.swim || e.wd) { e.swim = false; e.wd = 0; e.wadeK = 0; }
      e.swimK = Math.max(0, (e.swimK || 0) - dt * 3);
      if (e.wl) e.wl = Math.max(0, e.wl - dt * 0.006);
      e.swimOK = e.alive ? swimAllowed(e) : false;
      e._wAir = e.y; // [water2] a body in the air over the water splashes in below
      continue;
    }
    const sc = e.scale || 1;
    // how deep the water is where the body stands, and how much of the body is in it
    const bodyDepth = Math.max(0, w.y - e.y);
    e.wd = w.depth;
    e.wsurf = w.y;
    e.swim = e.alive && (w.depth > D.start || (was && w.depth > D.stop));
    e.wadeK = e.swim ? 1 : clamp((Math.min(w.depth, bodyDepth + 0.05) - 0.18 * sc) / (D.wade - 0.18 * sc), 0, 1);
    e.wl = Math.max(Math.max(0, (e.wl || 0) - dt * 0.006), Math.min(bodyDepth, 2 * sc));
    // wading splashes the rest of the body a little
    if (!e.swim && e.wadeK > 0 && e.anim) e.wet = Math.max(e.wet || 0, Math.min(0.45, (e.wet || 0) + dt * 0.03 * e.wadeK * Math.min(1, e.anim.amt)));
    e.swimK = clamp((e.swimK || 0) + (e.swim ? dt * 2.5 : -dt * 3), 0, 1);
    e.swimOK = e.alive ? swimAllowed(e) : false;
    if (!e.alive) continue;
    // in from the air: a big splash
    if (e._wAir !== undefined && e._wAir > w.y + 0.25 && e.y <= w.y + 0.05) {
      splashAt(e.x, e.z, clamp(0.8 + (e._wAir - w.y) * 0.25, 0.8, 2), { up: 1.3 });
      sfxAt('splashBig', e.x, w.y, e.z); if (e === P) SWIM.enterAt = GAME.t; // [audio2] placed (11c_sound.js)
    }
    e._wAir = e.y;
    // a critter in deep water keeps its head up too (critters do not use groundY)
    if (e.role === 'critter') e.y = waterFloorY(e, heightAt(e.x, e.z));
    // the current carries swimmers and leans on waders
    const fl = Math.hypot(w.fx, w.fz);
    if (fl > 0.02 && !(e.motion && e.motion.kind === 'leap')) {
      const k = e.swim ? 0.88 : 0.22 * e.wadeK;
      if (k > 0.01) stepTo(e, e.x + w.fx * k * dt, e.z + w.fz * k * dt);
      if (e === P && e.swim && fl > 0.4 && typeof loreNote === 'function') loreNote('current');
    }
    // effort: how fast the body moves through the water (not with it), for the strokes
    if (e._wpx === undefined) { e._wpx = e.x; e._wpz = e.z; }
    const rx = e.x - e._wpx - w.fx * (e.swim ? 0.88 : 0) * dt, rz = e.z - e._wpz - w.fz * (e.swim ? 0.88 : 0) * dt;
    e._wpx = e.x; e._wpz = e.z;
    const rel = Math.hypot(rx, rz) / Math.max(dt, 1e-4);
    const want = e.swim ? clamp(rel / 2.6, 0, 1.4) : 0;
    if (!e.dive) e.swimAmt = lerp(e.swimAmt || 0, want, 1 - Math.exp(-dt * 5)); // [water2] a diver's strokes are its own (07d_dive.js)
    // strokes: [motion] each carries the body about 2.2 m through the water, so the arms keep pace with the swim (treading
    // water keeps its own clock in the shader); paddling beasts beat faster
    const rate = e.kind === 'humanoid' ? (0.4 + 7.2 * e.swimAmt) : (5.5 + 4 * e.swimAmt); // [motion] a stroke carries a swimmer about 2.2 m (it was 4 m: slow-motion arms)
    const ph0 = e.swimPh || 0;
    if (!e.dive) e.swimPh = (ph0 + dt * rate) % (TAU * 64);
    if (e.swim) {
      // into the water: no saddle, no casting a horse, no burning
      if (e.mount) { dismount(e, e === P ? 'Your horse will not go so deep. You slide from the saddle and swim.' : null); splashAt(e.x, e.z, 1.2); }
      if (e.casting && e.casting.id === 'summon') { e.casting = null; if (e === P) uiError('You cannot call your horse in deep water'); }
      if (e.brand && e === P && typeof putOutBrand === 'function') putOutBrand(P, 'The water puts out your brand.', true);
      if (e === P && typeof loreNote === 'function') loreNote('swim');
    }
    if (e.swim || w.depth > 0.62 * sc) {
      let burnt = false;
      for (let i = e.buffs.length - 1; i >= 0; i--) if (e.buffs[i].kind === 'burn') { e.buffs.splice(i, 1); burnt = true; }
      if (burnt) { waterSteam(e.x, w.y, e.z, 14); sfxAt('hiss', e.x, w.y + 0.5, e.z); if (e === P) uiLog('The water puts out the flames on you.', 'sys'); }
    }
    // splashes and ripples: a wader's every footfall, a swimmer's strokes and wake
    const vis = dist2(e.x, e.z, camX, camZ) < 45 * 45 && !e.dive; // [water2] a diver leaves no splashes on the surface
    if (vis) {
      if (e.swim) {
        const strokes = Math.floor(e.swimPh / Math.PI) !== Math.floor(ph0 / Math.PI);
        if (strokes && (e.swimAmt > 0.15 || e.kind !== 'humanoid')) {
          const fx = Math.sin(e.yaw), fz = Math.cos(e.yaw);
          splashAt(e.x + fx * 0.55 * sc, e.z + fz * 0.55 * sc, e.kind === 'humanoid' ? 0.45 : 0.3, { up: 0.7 });
          sfxAt('swim', e.x, w.y, e.z); // [audio2] placed (11c_sound.js)
        }
        e._wakeT = (e._wakeT || 0) - dt;
        if (e._wakeT <= 0) { e._wakeT = 0.12; rippleDrop(e.x, e.z, 0.55 * sc, 0.005 + 0.018 * Math.min(1, rel / 2.5)); }
      } else if (w.depth > 0.08 && e.wadeK >= 0 && e.y < w.y) {
        const step = Math.floor(e.anim.phase / Math.PI);
        if (e._wStep !== undefined && step !== e._wStep && e.anim.amt > 0.08) {
          const side = step & 1 ? 1 : -1, cx = Math.cos(e.yaw) * 0.14 * side * sc, fx = Math.sin(e.yaw) * 0.3 * sc, fz = Math.cos(e.yaw) * 0.3 * sc;
          splashAt(e.x + fx + cx, e.z + fz - Math.sin(e.yaw) * 0.14 * side * sc, clamp(0.25 + w.depth * 0.6 + e.anim.amt * 0.2, 0.25, 0.9), { up: 0.6 + e.anim.amt * 0.4 });
          sfxAt('wade', e.x, w.y, e.z, e === P ? null : { vol: 0.7 }); // [audio2] placed (11c_sound.js)
        }
        e._wStep = step;
        if (e.anim.amt > 0.05) { e._wakeT = (e._wakeT || 0) - dt; if (e._wakeT <= 0) { e._wakeT = 0.16; rippleDrop(e.x, e.z, 0.4 * sc, 0.006 + 0.012 * Math.min(1, w.depth)); } }
      }
    }
    if (!e.swim && was && e === P) SWIM.leftAt = GAME.t;
  }
  diveUpdate(dt); // [water2] breath, ice holes, the bed's finds (07d_dive.js)
  boatsUpdate(dt); // [water2] boats on the water, rowers, fishers (07e_boats.js)
  tracksUpdate(dt); // [water2] footprints and ruts (07f_tracks.js)
}

/* ------------------------------------------------------------------ */
/* every frame: the ripple window, rain and spells on the water, the sound of rivers */
/* ------------------------------------------------------------------ */
function drawWater(dt) {
  const P = GAME.player;
  const cx = P ? P.x : camera.position.x, cz = P ? P.z : camera.position.z;
  // rain dimples the water near the player
  if (RIPPLE.on && WEATHER.raining > 0.05 && !INDOOR.on) {
    SWIM.rainT -= dt * (10 + 40 * WEATHER.raining);
    while (SWIM.rainT < 0) {
      SWIM.rainT += 1;
      const x = cx + (Math.random() - 0.5) * RIPPLE.size * 0.8, z = cz + (Math.random() - 0.5) * RIPPLE.size * 0.8;
      if (waterAt(x, z)) rippleDrop(x, z, 0.16, 0.012 * (0.5 + WEATHER.raining));
    }
  }
  // spells that land on water throw it up (meteors, frost, holy ground ...)
  for (const m of AOE_MARKS) {
    if (SWIM.aoeSeen.has(m)) continue;
    SWIM.aoeSeen.add(m);
    if (m.r > 0 && waterAt(m.x, m.z)) {
      splashAt(m.x, m.z, clamp(m.r / 3, 0.7, 2.2), { up: 1.4 });
      for (let i = 0; i < 4; i++) { const a = Math.random() * TAU, r = m.r * (0.3 + Math.random() * 0.6); splashAt(m.x + Math.cos(a) * r, m.z + Math.sin(a) * r, 0.6); }
    }
  }
  stepRipples(dt, cx, cz);
  waterSound(dt, cx, cz);
  diveDraw(dt); // [water2] the view under the water, fish, the breath bar (07d_dive.js)
  boatsDraw(dt); // [water2] boats, oars, wakes (07e_boats.js)
  tracksDraw(dt); // [water2] footprints, ruts, drifts (07f_tracks.js)
}
// the sound of running water near a river, louder where it runs fast
function waterSound(dt, x, z) {
  if (!AUDIO.ctx || !AUDIO.amb || AUDIO.ctx.state !== 'running') return;
  if (!SWIM.sound) {
    try {
      const ctx = AUDIO.ctx, src = ctx.createBufferSource();
      src.buffer = AUDIO.noise; src.loop = true; src.playbackRate.value = 0.7;
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 700; bp.Q.value = 0.55;
      const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 260;
      const g = ctx.createGain(); g.gain.value = 0;
      const lfo = ctx.createOscillator(); lfo.frequency.value = 0.37;
      const lg = ctx.createGain(); lg.gain.value = 180;
      lfo.connect(lg).connect(bp.frequency); lfo.start();
      src.connect(bp).connect(hp).connect(g).connect(AUDIO.amb.bus);
      src.start();
      SWIM.sound = { g, bp };
    } catch (e) { SWIM.sound = { g: null }; }
  }
  if (!SWIM.sound.g) return;
  const r = riverAt(x, z, 30);
  let k = 0;
  if (r) k = clamp(1 - Math.max(0, r.n.d - r.n.hw) / 30, 0, 1) * clamp(0.35 + r.n.speed * 0.35, 0, 1);
  if (INDOOR.on) k = 0;
  SWIM.soundK = lerp(SWIM.soundK, k, 1 - Math.exp(-dt * 2));
  SWIM.sound.g.gain.setTargetAtTime(0.16 * SWIM.soundK * SWIM.soundK, AUDIO.ctx.currentTime, 0.3);
}

/* ------------------------------------------------------------------ */
/* drinking, filling a waterskin, washing                               */
/* ------------------------------------------------------------------ */
registerGood('waterskin_empty', { name: 'Empty waterskin', plural: 'Empty waterskins', kind: 'misc', icon: 'drop', value: 2, desc: 'Fill it at any lake, pond or river (E by the water).' });
GOODS.water.empty = 'waterskin_empty'; // drinking from a skin leaves it empty (eatGood in 09s_survival.js)
// every recruit is issued an empty waterskin (once per character; old characters get theirs on their next visit)
registerSavePart('char', 'water', {
  save: () => (SWIM.skinGiven ? { skin: 1 } : null),
  load: (d) => {
    SWIM.skinGiven = !!(d && typeof d === 'object' && d.skin);
    if (!SWIM.skinGiven) { SWIM.skinGiven = true; if (!goodsHave('waterskin_empty') && !goodsHave('water')) goodsAdd('waterskin_empty', 1, true); }
  },
});
// the nearest water within arm's reach of the player: the spot and what kind of water it is
function waterNear(P) {
  let best = null;
  const tryAt = (x, z, d) => {
    const w = waterAt(x, z);
    if (!w || w.depth < 0.08 || w.y > P.y + 1.4 || w.y < P.y - 1.6) return;
    if (!best || d < best.d) best = { x, z, y: w.y, d, flow: Math.hypot(w.fx, w.fz) };
  };
  tryAt(P.x, P.z, 0);
  if (!best) for (let a = 0; a < 8; a++) for (const r of [0.9, 1.7]) tryAt(P.x + Math.sin(P.yaw + a * TAU / 8) * r, P.z + Math.cos(P.yaw + a * TAU / 8) * r, r + (a ? 0.2 : 0));
  if (!best) return null;
  best.kind = best.flow > 0.05 || riverAt(best.x, best.z, 1) ? 'river' : LAKES.some((L) => dist2(best.x, best.z, L.x, L.z) < (L.r * 1.4) ** 2) ? 'lake' : 'pond';
  return best;
}
function waterOffers(P, offer) {
  if (inDungeon(P)) return;
  dive2Offers(P, offer); boatOffers(P, offer); // [water2] the bed's finds, holes in the ice, boats (07d_dive.js, 07e_boats.js)
  if (P.mount || P.dive || P.boat) return;
  const s = waterNear(P);
  if (!s) return;
  // [survival] drinking is the survival module's (drink your fill, fill the empty waterskins); washing is ours
  const thirsty = SURV.thirst < 0.97, fill = goodsHave('waterskin_empty'), dirty = kitDirt() >= 0.02;
  if (dirty) offer(s.d * 0.5 + (SURV.thirst < 0.5 ? 0.6 : 0), 2.6, `Wash your gear in the ${s.kind}`, () => { washGear(null); splashAt(s.x, s.z, 0.6); }, 0.05);
  if (SURV.job) return;
  const label = thirsty && fill ? `Drink from the ${s.kind} and fill your waterskins` : thirsty ? `Drink from the ${s.kind}` : fill ? `Fill your waterskins at the ${s.kind}` : `Drink from the ${s.kind}`;
  offer(s.d * 0.5 + (thirsty ? 0.3 : 0.9), 2.6, label, () => { // not thirsty, a rod in hand fishes first (09s_survival.js)
    if (GAME.t - SWIM.drinkAt < 1.2) return;
    SWIM.drinkAt = GAME.t;
    drinkAt({ x: s.x, z: s.z }, s.kind);
  }, thirsty ? 0.06 : -0.1);
}

/* ------------------------------------------------------------------ */
/* the Chronicle and the help                                           */
/* ------------------------------------------------------------------ */
function chronWater() {
  const names = RIVERS.map((Rv) => `<li><b style="color:${REALMS[Rv.realm].light}">${REALMS[Rv.realm].name}</b>: a river runs down from the mountains behind ${REALMS[Rv.realm].townName} into the realm's lake.</li>`).join('');
  return `<p class="lead">Water in the March is real water. Each realm has a lake near its town, fed by a river that runs down from the mountains, and rain has filled the hollows of the land with ponds, from reedy pools in the meadows to cold tarns high among the rocks.</p>
    <ul>${names}</ul>
    <h3>Wading and swimming</h3>
    <p>Water slows you as it deepens: a little at the knee, a lot at the waist. Once it reaches your chest you swim, with your head and shoulders out. Swimming is slow, and running in the water tires you. You cannot cast spells or shoot while you swim, and no horse will carry you into deep water.</p>
    <p>A river carries you downstream, fastest where it falls steeply and runs white. Swim across the current rather than against it, or let it take you down to the lake.</p>
    <p>Foes and beasts follow you into the water when they are chasing you, and swim as slowly as you do; townsfolk keep to the dry land.</p>
    <h3>What water does</h3>
    <p>Water puts out fire: a burning brand goes out when you wade deep, and if you are alight, jump in. Your gear soaks up to the waterline and dries again in the sun, and wading washes off mud and blood.</p>
    <p>Stand at the water's edge and ${IS_TOUCH ? 'tap Use' : 'press E'} to drink, to fill an empty waterskin to carry, or to wash your gear clean.</p>
    <h3>Diving</h3>
    <p>Out of your depth, ${IS_TOUCH ? 'tap Dive' : 'press U'} to go under. You swim the way you look, ${IS_TOUCH ? 'Up' : 'Space'} takes you up, and if you stop swimming you drift slowly to the surface. Your breath lasts about half a minute (the bar under your feet); after that the water harms you until you reach the air. Fish scatter from you, and the beds of the lakes, the rivers' deep pools and the deepest ponds hold lost arrows, old blades, purses and now and then a sunken chest. In deep winter nobody comes up through the ice except at a hole: cut one (${IS_TOUCH ? 'tap Use' : 'press E'} on thick ice) or fish through one, and remember where it is.</p>
    <h3>Boats</h3>
    <p>Each town keeps rowing boats at a jetty on its lake, and others lie drawn up on the shores and the river banks. Step in (${IS_TOUCH ? 'tap Use' : 'press E'}) and row: forward and back pull and back the oars, left and right turn her. A river carries a boat downstream. A boat runs aground on a shore and will not cross ice; step out where she grounds, or tie her up again at a jetty. You can fish from a boat, a hound can sit in the bow, and you can step out into deep water to dive. Boats burn like anything else of wood; a burnt one can be rebuilt with planks and a hammer. The fishers of the towns row out in the mornings.</p>`;
}
function waterHelp() {
  return `<h3>Water</h3><p>Wade into lakes, ponds and rivers; past chest height you swim, slowly, and cannot cast or shoot. Rivers carry you downstream. Water puts out fire, soaks your gear and washes it. At the water's edge ${IS_TOUCH ? 'tap Use' : 'press E'} to drink, fill a waterskin or wash your gear.</p>
    <p>${IS_TOUCH ? 'Tap Dive' : 'U'} goes under while you swim (from a boat: over the side and down) (${IS_TOUCH ? 'Up' : 'Space'} rises; mind your breath). ${IS_TOUCH ? 'Use' : 'E'} by a boat steps in; ${IS_TOUCH ? 'the stick rows' : 'W and S row, A and D turn'}.</p>`; // [water2]
}

/* test hooks (window.__hm.water) */
const WATER_DEBUG = {
  waterAt: (x, z) => { const w = waterAt(x, z, {}); return w ? { y: w.y, depth: w.depth, fx: w.fx, fz: w.fz } : null; },
  swimDims: (id) => { const e = getEnt(id); return e ? swimDims(e) : null; },
  state: (id) => { const e = getEnt(id); return e ? { x: e.x, y: e.y, z: e.z, swim: !!e.swim, wd: e.wd || 0, wadeK: e.wadeK || 0, swimK: e.swimK || 0, swimAmt: e.swimAmt || 0, wl: e.wl || 0, wet: e.wet || 0, swimOK: !!e.swimOK, speed: effectiveSpeed(e), burning: e.buffs.some((b) => b.kind === 'burn') } : null; },
  rivers: () => RIVERS.map((Rv) => ({ realm: Rv.realm, len: Rv.len, pts: Rv.pts.length, src: [Rv.pts[0].x, Rv.pts[0].z], mouth: [Rv.pts[Rv.pts.length - 1].x, Rv.pts[Rv.pts.length - 1].z], course: Rv.pts.filter((p, i) => i % 4 === 0).map((p) => [Math.round(p.x * 10) / 10, Math.round(p.z * 10) / 10, Math.round(p.surf * 100) / 100, Math.round(p.hw * 10) / 10, Math.round(p.speed * 100) / 100]) })),
  ripple: () => ({ on: RIPPLE.on, res: RIPPLE.res, steps: RIPPLE.steps, drops: RIPPLE.drops.length, B: U.uRippleB.value.toArray() }),
  tickWater: (dt) => drawWater(dt), // the ripple window without drawing the world (tests)
  splashAt, rippleDrop, swimAllowed, waterNear, waterOffers, deepWaterAt, swimPassable, riverAt, chronWater,
  meshes: () => ({ n: WATER_MESHES.length, cells: WATERGRID.cells }),
  SWIM, RIVERS, WATERGRID, RIPPLE, PONDS,
};
