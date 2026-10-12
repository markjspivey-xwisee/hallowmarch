/* ================================================================== */
/* [water2] under the water: diving, breath, the bed, fish and finds    */
/* ================================================================== */
// A swimmer in deep water can dive (U, or the pad's Dive) and swim in three dimensions: the look decides the way,
// Space (or the pad's Up) rises, and a body that stops swimming drifts up as the air in it carries it. Breath runs
// down under the water (the breath bar), then the water harms you. The current carries a diver as it carries a
// swimmer, the bed is solid (you rise along it as it shelves), and nobody comes up through winter ice except at a
// hole cut in it. Under the water the world is seen through it: fog by depth and murk, red light lost first, the
// surface from below with the sky in its window and silver elsewhere, shafts of light, motes, muffled sound. Fish
// school in every water and scatter from a diver; a lost arrow, an old blade, a purse or now and then a sunken chest
// lies on the bed of the lakes, the deep pools and the rivers' lower reaches.
const DIVE = { built: false, holes: [], finds: [], schools: [], fish: null, shafts: null, under: { on: false, y: -1000, d: 0, k: 0 }, au: null, bubT: 0, moteT: 0, pad: '', hudOn: false, iceNoted: 0, lastSurf: -99, stats: { dives: 0, deepest: 0, finds: 0, drowned: 0 } };
const DIVE_BREATH = 32; // seconds of breath held at rest
const DIVE_SPEED = 2.5; // m/s through the water
const DIVE_MIN = 1.9; // water this deep before you can go under
const DIVE_PIVOT = 1.3; // the body lies at this height over its root when it swims flat (the actor shader's pivot)
const DIVE_WATER = { id: null, name: 'drowning', faction: FACTION_NEUTRAL, role: 'water' };
const _dvW = { y: 0, depth: 0, fx: 0, fz: 0 };

/* ------------------------------------------------------------------ */
/* holes in the winter ice                                              */
/* ------------------------------------------------------------------ */
function diveHoleAt(x, z, pad = 0) {
  for (const h of DIVE.holes) if ((x - h.x) * (x - h.x) + (z - h.z) * (z - h.z) < (h.r + pad) * (h.r + pad)) return h;
  return null;
}
function diveCutHole(x, z, r = 0.62, life = 480) {
  let h = diveHoleAt(x, z, 0.3);
  if (h) { h.until = Math.max(h.until, GAME.t + life); return h; }
  h = { x, z, r, until: GAME.t + life, mesh: null };
  if (typeof SEAS !== 'undefined' && SEAS.hole) {
    h.mesh = new THREE.Mesh(SEAS.hole.geometry, SEAS.hole.material);
    h.mesh.renderOrder = 4;
    const w = waterAt(x, z);
    h.mesh.position.set(x, (w ? w.y : heightAt(x, z)) + 0.06, z);
    h.mesh.scale.setScalar(r / 0.55);
    scene.add(h.mesh);
  }
  DIVE.holes.push(h);
  if (DIVE.holes.length > 8) diveHoleDrop(DIVE.holes[0]);
  diveHoleUniforms();
  return h;
}
function diveHoleDrop(h) {
  const i = DIVE.holes.indexOf(h);
  if (i >= 0) DIVE.holes.splice(i, 1);
  if (h.mesh) h.mesh.removeFromParent();
  diveHoleUniforms();
}
// the water shader opens the ice at the holes (03b_water.js uIceHoles)
function diveHoleUniforms() {
  const A = waterMat.uniforms.uIceHoles.value, P = GAME.player;
  const L = DIVE.holes.slice().sort((a, b) => (P ? dist2(a.x, a.z, P.x, P.z) - dist2(b.x, b.z, P.x, P.z) : 0));
  for (let i = 0; i < A.length; i++) { const h = L[i]; if (h) A[i].set(h.x, h.z, h.r * Math.min(1, (h.until - GAME.t) / 20 + 0.15), 1); else A[i].set(0, 0, 0, 0); }
}
function diveHolesStep(dt) {
  if (!DIVE.holes.length && !(typeof SURV !== 'undefined' && SURV.fish)) return;
  // fishing through the ice cuts a hole that stays open a while after (05k_seasons.js draws it while the line is out)
  const F = typeof SURV !== 'undefined' ? SURV.fish : null;
  if (F && SICE.on && seasonIceAt(F.bx, F.bz) > 0.12 && !diveHoleAt(F.bx, F.bz, 0.2)) diveCutHole(F.bx, F.bz, 0.55, 240);
  let ch = false;
  for (const h of DIVE.holes.slice()) {
    if (GAME.t > h.until || !SICE.on || seasonIceAt(h.x, h.z) < 0.05) { diveHoleDrop(h); ch = true; continue; }
    const left = h.until - GAME.t;
    if (h.mesh) {
      h.mesh.scale.setScalar(h.r / 0.55 * Math.min(1, left / 20 + 0.15));
      h.mesh.visible = !(F && SEAS.hole && SEAS.hole.visible && dist2(F.bx, F.bz, h.x, h.z) < 0.3);
    }
    if (left < 20) ch = true;
  }
  if (ch || (DIVE.holeT = (DIVE.holeT || 0) - dt) < 0) { DIVE.holeT = 1; diveHoleUniforms(); }
}

/* ------------------------------------------------------------------ */
/* going under, coming up                                               */
/* ------------------------------------------------------------------ */
function diveWhyNot(P) {
  if (!P || !P.alive) return 'dead';
  if (P.dive) return null;
  if (P.boat) return 'Step out of the boat into the water first';
  if (inDungeon(P) || !P.swim) return 'You can only dive while swimming in deep water';
  const w = waterAt(P.x, P.z, _dvW);
  if (!w || w.depth < DIVE_MIN) return 'The water is too shallow to dive here';
  if (P.carrying != null) return 'Not while you carry a hallow';
  return null;
}
function diveStart(P) {
  const why = diveWhyNot(P);
  if (why) { if (why !== 'dead') uiError(why); return false; }
  if (P.dive) return true;
  P.dive = { t: 0, up: false, drown: 0, pitch: 0.9, low: P.y, noted: false };
  if (BUILD.mode) buildToggle(false); // no building under the water (and the breath bar has the top of the screen)
  P.dvy = -1.6;
  P.casting = null;
  if (P.fishing && typeof fishStop === 'function') fishStop(null);
  const w = waterAt(P.x, P.z, _dvW);
  splashAt(P.x + Math.sin(P.yaw) * 0.6, P.z + Math.cos(P.yaw) * 0.6, 0.9, { up: 0.9 });
  diveSfx('dive');
  DIVE.stats.dives++;
  if (w) P.dive.surf = w.y;
  if (typeof loreNote === 'function') loreNote('dive');
  return true;
}
function diveEnd(P, how = 'surface') {
  if (!P || !P.dive) return;
  const D = P.dive;
  P.dive = null; P.dvy = 0;
  if (how === 'surface') {
    splashAt(P.x, P.z, 0.75, { up: 1.1 });
    if ((P.breath ?? 1) < 0.6) diveSfx('gasp');
    DIVE.lastSurf = GAME.t;
  }
  if (D.t > 2 && P.alive && how === 'surface' && (P.breath ?? 1) < 0.25) uiLog('You break the surface gasping for air.', 'sys');
}
// U, or the pad's Dive / Up
function diveToggle() {
  const P = GAME.player;
  if (!P || !P.alive || UI.modal) return;
  if (P.dive) { P.dive.up = !P.dive.up; return; }
  // in a boat: over the side, and under if it is deep enough (07e_boats.js)
  if (P.boat) { boatLeave(P, null); updateWater(0.001); if (!diveWhyNot(P)) diveStart(P); return; }
  diveStart(P);
}

/* ------------------------------------------------------------------ */
/* the diver's step (09_player.js hands the player over while under)    */
/* ------------------------------------------------------------------ */
function diveSteer(P, dt, f, s, mag) {
  const D = P.dive, sc = P.scale || 1;
  const w = waterAt(P.x, P.z, _dvW);
  if (!w || inDungeon(P) || w.depth < 1.15 * sc) { diveEnd(P, 'shallow'); return; }
  D.t += dt;
  D.surf = w.y;
  if (P.casting) P.casting = null;
  const sprint = (keyDown('ShiftLeft', 'ShiftRight') || (INPUT.joy && Math.hypot(INPUT.joy.dx, INPUT.joy.dy) > 0.97)) && P.endurance > 1 && mag > 0.1;
  const rise = !UI.modal && (keyDown('Space') || D.up);
  // the look decides the way: looking down from above dives, looking up from below rises
  const look = clamp((CAM.pitch - 0.32) * 1.5, -1.2, 1.35);
  const fx = Math.sin(CAM.yaw), fz = Math.cos(CAM.yaw), rx = -Math.cos(CAM.yaw), rz = Math.sin(CAM.yaw);
  let hx = 0, hz = 0, vy = 0;
  if (mag > 0.08 && !isRooted(P) && !isStunned(P)) {
    const l = Math.max(Math.hypot(f, s), 1e-3), fm = f / l, sm = s / l;
    const sp = DIVE_SPEED * (sprint ? 1.4 : 1) * mag * (effectiveSpeed(P) / Math.max(P.speed * waterSpeedMult(P), 0.1)) * 0.92 + 0.08 * DIVE_SPEED * mag;
    const ch = Math.cos(look * Math.abs(fm));
    hx = (fx * fm * ch + rx * sm) * sp; hz = (fz * fm * ch + rz * sm) * sp;
    vy = -Math.sin(look) * fm * sp;
    if (sprint) P.endurance = Math.max(0, P.endurance - dt * 9);
  }
  if (!sprint) P.endurance = Math.min(100, P.endurance + dt * 6);
  if (rise) vy = Math.max(vy, D.up ? 2.1 : 1.8);
  else if (mag <= 0.08) vy = 0.4; // still: the air in the body carries it up
  P.dvy = lerp(P.dvy || 0, vy, 1 - Math.exp(-dt * 3.2));
  // the bed shelving up ahead lifts you along it rather than stopping you dead
  let pivot = P.y + DIVE_PIVOT * sc;
  const hs = Math.hypot(hx, hz);
  if (hs > 0.01) {
    const ax = P.x + hx * dt, az = P.z + hz * dt, ahead = heightAt(P.x + hx / hs * 0.9, P.z + hz / hs * 0.9);
    let k = 1;
    if (ahead + 0.5 > pivot) { P.dvy = Math.max(P.dvy, 1.3); k = 0.35; }
    if (!stepTo(P, P.x + (ax - P.x) * k, P.z + (az - P.z) * k)) P.dvy = Math.max(P.dvy, 0.6);
    P.yaw += clamp(angDiff(P.yaw, Math.atan2(hx, hz)), -dt * 7, dt * 7);
  }
  pivot += P.dvy * dt;
  const bed = heightAt(P.x, P.z);
  if (pivot < bed + 0.45) { pivot = bed + 0.45; if (P.dvy < 0) P.dvy *= 0.3; }
  // the ceiling: the surface, or winter ice with no hole in it
  const iced = SICE.on && seasonIceAt(P.x, P.z) > 0.12 && !diveHoleAt(P.x, P.z, 0.15);
  const w2 = waterAt(P.x, P.z, _dvW) || w;
  const keel = boatKeelOver(P.x, P.z, 0.35); // a hull overhead is a ceiling too (07e_boats.js)
  if (iced || keel !== null) {
    const top = Math.min(iced ? w2.y - 0.42 : Infinity, keel !== null ? keel - 0.5 : Infinity);
    if (pivot > top) {
      pivot = top; if (P.dvy > 0) P.dvy = 0;
      if (iced && GAME.t - DIVE.iceNoted > 6) { DIVE.iceNoted = GAME.t; uiLog('Ice above you. Find the hole you came down through.', 'warn'); diveSfx('bump'); }
      else if (!iced && GAME.t - DIVE.iceNoted > 4) { DIVE.iceNoted = GAME.t; diveSfx('bump'); }
    }
  } else if (pivot > w2.y - 0.26) {
    // at the surface: up into the air (unless the dive has only just begun)
    if (D.t > 0.7 && P.dvy > -0.05) { P.y = Math.min(pivot, w2.y - 0.2) - DIVE_PIVOT * sc; diveEnd(P, 'surface'); return; }
    pivot = w2.y - 0.26;
  }
  P.y = pivot - DIVE_PIVOT * sc;
  P.onGround = true; P.vy = 0;
  D.low = Math.min(D.low, P.y);
  DIVE.stats.deepest = Math.max(DIVE.stats.deepest, w2.y - pivot);
  // the body's own lean for the shader: along the way it goes, upright-ish when it hangs still
  const sp3 = Math.hypot(hs, P.dvy);
  const want = sp3 > 0.25 ? clamp(Math.atan2(-P.dvy, Math.max(hs, 0.05)), -1.15, 1.2) : -0.75;
  D.pitch = lerp(D.pitch, want, 1 - Math.exp(-dt * 3));
  P.swimAmt = lerp(P.swimAmt || 0, clamp(sp3 / 2.4, 0, 1.4), 1 - Math.exp(-dt * 5));
  P.swimPh = ((P.swimPh || 0) + dt * (0.6 + 2.86 * sp3)) % (TAU * 64); // [motion5] a stroke carries a diver about 2.2 m, as a swimmer at the surface (07b_swim.js): it was 4.2 m at 2.5 m/s, the arms in slow motion
  // breath
  const rate = (sprint ? 1.6 : 1) * (P.swimAmt > 0.3 ? 1.1 : 0.9);
  P.breath = Math.max(0, (P.breath ?? 1) - dt * rate / DIVE_BREATH);
  if (P.breath <= 0) {
    D.drown += dt;
    if (D.drown >= 1) { D.drown -= 1; diveDrown(P); }
  } else D.drown = 0;
  if (P.breath < 0.25 && !D.noted) { D.noted = true; uiLog('Your lungs burn. Get to the air!', 'warn'); }
  // zone changes and a target that is gone, as on land
  const z = zoneAt(P.x, P.z);
  if (z.name !== lastZone) { lastZone = z.name; uiZone(z); }
}
function diveDrown(P) {
  const dmg = P.maxHp * 0.085;
  P.anim.flash = 1;
  diveSfx('gulp');
  flashScreen([0.1, 0.2, 0.45], 0.45);
  P.combatUntil = GAME.t + 6;
  if (P.hp - dmg <= 0) { DIVE.stats.drowned++; P.hp = 0; P.dive = null; killEnt(P, DIVE_WATER); return; }
  P.hp -= dmg;
  uiFloatAt(P.x, P.y + DIVE_PIVOT + 0.6, P.z, `-${Math.round(dmg)}`, 'dmg');
}
// for the actor shader: the underwater stroke (action 15), its fraction the body's lean (-1.2 .. 1.2 rad)
function water2ActValue(e) {
  if (e.dive && e.alive) return 15 + clamp((e.dive.pitch + 1.2) / 2.4, 0, 0.998);
  if (e.boat && e.alive && e.rowK !== undefined) return 16 + clamp(e.rowPh || 0, 0, 0.998); // [water2] at the oars (07e_boats.js)
  return 0;
}
// 09_player.js asks before moving the player: at the oars or under the water, the player is ours this step
function water2Steer(P, dt, f, s, mag) {
  if (P.boat) { boatSteer(P, dt, f, s, mag); return true; }
  if (!P.dive) return false;
  diveSteer(P, dt, f, s, mag);
  return true;
}
// the camera follows a diver under the surface, and stays out of the band where it would cut the surface
function diveCamY(cx, cz, cy) {
  const P = GAME.player;
  if (!P || !P.dive) return null;
  const w = waterAt(cx, cz, _dvW);
  if (!w) return cy;
  const g = heightAt(cx, cz);
  return Math.max(Math.min(cy, w.y - 0.32), Math.min(g + 0.45, w.y - 0.32));
}

/* ------------------------------------------------------------------ */
/* things on the bed                                                    */
/* ------------------------------------------------------------------ */
const FIND_KINDS = {
  arrow: { label: 'Pull the lost arrows out of the silt', back: [900, 1500] },
  blade: { label: 'Lift the old blade from the bed', back: [1200, 2000] },
  purse: { label: 'Take the rotted purse', back: [1000, 1700] },
  chest: { label: 'Open the sunken chest', back: [1800, 2700] },
};
// a deep, still spot of the bed in a body of water: near (x, z) within r
function findSpot(rnd, x, z, r, minD, avoid) {
  for (let k = 0; k < 60; k++) {
    const a = rnd() * TAU, d = Math.sqrt(rnd()) * r, px = x + Math.cos(a) * d, pz = z + Math.sin(a) * d;
    const w = waterAt(px, pz, _dvW);
    if (!w || w.depth < minD || Math.hypot(w.fx, w.fz) > 0.9) continue;
    if (avoid.some((q) => dist2(q.x, q.z, px, pz) < 36)) continue;
    // not on a steep slope of the bed
    const g = heightAt(px, pz), sl = Math.abs(heightAt(px + 1, pz) - g) + Math.abs(heightAt(px, pz + 1) - g);
    if (sl > 0.6) continue;
    return { x: px, z: pz };
  }
  return null;
}
function findGeo(kind, rnd) {
  const B = new Batch(), I = new THREE.Matrix4();
  const wood = [0.27, 0.19, 0.12], dark = [0.14, 0.11, 0.08], iron = [0.2, 0.17, 0.14], rust = [0.33, 0.2, 0.12], gold = [0.78, 0.6, 0.25], weed = [0.12, 0.22, 0.08];
  if (kind === 'chest') {
    B.add(G.box, lm(I, 0, 0.21, 0, 0, 0.84, 0.46, 0.54), MAT.wood, wood, 0, 0.5);
    B.add(G.cyl12, lm(I, 0, 0.44, 0, 0, 0.27, 0.84, 0.27, 0, Math.PI / 2), MAT.wood, darker(wood, 0.9), 0, 0.6);
    for (const bx of [-0.3, 0, 0.3]) { B.add(G.box, lm(I, bx, 0.22, 0, 0, 0.06, 0.48, 0.565), MAT.metal, iron, 0, 0.5); B.add(G.cyl12, lm(I, bx, 0.44, 0, 0, 0.285, 0.065, 0.285, 0, Math.PI / 2), MAT.metal, iron, 0, 0.6); }
    B.add(G.box, lm(I, 0, 0.36, 0.285, 0, 0.12, 0.14, 0.03), MAT.gold, gold);
    for (let i = 0; i < 4; i++) B.add(G.box, lm(I, (rnd() - 0.5) * 0.7, 0.62 + rnd() * 0.1, (rnd() - 0.5) * 0.3, rnd() * 3, 0.02, 0.28 + rnd() * 0.3, 0.05, (rnd() - 0.5) * 0.6, (rnd() - 0.5) * 0.6), MAT.cloth, weed);
  } else if (kind === 'blade') {
    B.add(G.box, lm(I, 0, 0.035, 0.36, 0, 0.055, 0.014, 0.82), MAT.metal, rust);
    B.add(G.box, lm(I, 0, 0.035, -0.06, 0, 0.24, 0.035, 0.035), MAT.metal, iron);
    B.add(G.cyl8, lm(I, 0, 0.035, -0.17, 0, 0.022, 0.18, 0.022, Math.PI / 2), MAT.wood, dark);
    B.add(G.ico, lm(I, 0, 0.035, -0.27, 0, 0.034, 0.034, 0.034), MAT.metal, iron);
  } else if (kind === 'arrow') {
    for (let i = 0; i < 3; i++) {
      const x = (rnd() - 0.5) * 0.5, z = (rnd() - 0.5) * 0.4, yaw = rnd() * TAU, tilt = 0.35 + rnd() * 0.5;
      const M = lm(I, x, 0, z, yaw, 1, 1, 1, tilt);
      B.add(G.cyl8, M.clone().multiply(lm(I, 0, 0.3, 0, 0, 0.0065, 0.72, 0.0065)), MAT.wood, [0.42, 0.33, 0.2]);
      for (const fy of [0, 1, 2]) B.add(G.box, M.clone().multiply(lm(I, 0, 0.6, 0, fy * 2.09, 0.003, 0.11, 0.035)), MAT.cloth, [0.55, 0.52, 0.46]);
    }
  } else {
    B.add(G.ico, lm(I, 0, 0.08, 0, 0, 0.15, 0.1, 0.13), MAT.cloth, [0.3, 0.22, 0.14]);
    for (let i = 0; i < 6; i++) B.add(G.cyl8, lm(I, 0.12 + rnd() * 0.25, 0.012, (rnd() - 0.5) * 0.3, 0, 0.035, 0.008, 0.035, (rnd() - 0.5) * 0.4), MAT.gold, gold);
  }
  return B.build();
}
function findPlace(F) {
  const w = waterAt(F.x, F.z, _dvW);
  const g = heightAt(F.x, F.z), gx = heightAt(F.x + 0.6, F.z) - heightAt(F.x - 0.6, F.z), gz = heightAt(F.x, F.z + 0.6) - heightAt(F.x, F.z - 0.6);
  F.y = g;
  F.surf = w ? w.y : g + 2;
  if (F.mesh) {
    F.mesh.position.set(F.x, g - (F.kind === 'chest' ? 0.12 : F.kind === 'blade' ? 0.012 : 0), F.z);
    F.mesh.rotation.set(Math.atan2(gz, 1.2) + (F.kind === 'chest' ? 0.12 : 0), F.yaw, -Math.atan2(gx, 1.2) + (F.kind === 'chest' ? 0.1 : 0), 'YXZ');
    F.mesh.updateMatrixWorld(true);
  }
}
function buildDive() {
  if (DIVE.built) return;
  DIVE.built = true;
  const rnd = mulberry(4711), avoid = [];
  const add = (id, kind, s, extra = {}) => {
    if (!s) return;
    avoid.push(s);
    const F = { id, kind, x: s.x, z: s.z, yaw: rnd() * TAU, taken: false, back: 0, area: extra.area, mesh: null, ...extra };
    F.mesh = new THREE.Mesh(findGeo(kind, rnd), buildingMat);
    F.mesh.renderOrder = 1;
    F.mesh.matrixAutoUpdate = false;
    scene.add(F.mesh);
    findPlace(F);
    F.mesh.matrixAutoUpdate = true;
    DIVE.finds.push(F);
  };
  // the lakes: arrows, a blade, a purse, and a chest in two of the three
  LAKES.forEach((L, i) => {
    const area = { x: L.x, z: L.z, r: L.r * 0.85, min: 2.1 };
    add(`L${i}a`, 'arrow', findSpot(rnd, L.x, L.z, area.r, 2.1, avoid), { area });
    add(`L${i}b`, 'arrow', findSpot(rnd, L.x, L.z, area.r, 2.1, avoid), { area });
    add(`L${i}c`, 'blade', findSpot(rnd, L.x, L.z, area.r, 2.2, avoid), { area });
    add(`L${i}d`, 'purse', findSpot(rnd, L.x, L.z, area.r, 2.4, avoid), { area });
    if (i !== 1) add(`L${i}e`, 'chest', findSpot(rnd, L.x, L.z, area.r, 2.8, avoid), { area: { ...area, min: 2.8 } });
  });
  // the deep pools of the rivers' lower reaches
  RIVERS.forEach((Rv, i) => {
    const p = Rv.pts[Math.floor(Rv.pts.length * 0.8)];
    if (p) add(`R${i}`, i === 1 ? 'purse' : 'blade', findSpot(rnd, p.x, p.z, 10, 2.0, avoid), { area: { x: p.x, z: p.z, r: 10, min: 2.0 } });
  });
  // the deepest ponds
  PONDS.slice().sort((a, b) => b.depth - a.depth).slice(0, 4).forEach((Pn, i) => {
    if (Pn.depth > 2.3) add(`P${i}`, i % 2 ? 'arrow' : 'blade', findSpot(rnd, Pn.x, Pn.z, 6, 2.05, avoid), { area: { x: Pn.x, z: Pn.z, r: 6, min: 2.05 } });
  });
  buildDvFish();
  buildShafts();
}
// the bed's finds within reach of a diver
function diveOffers(P, offer) {
  if (!P.dive) return;
  const hy = P.y + DIVE_PIVOT * (P.scale || 1);
  for (const F of DIVE.finds) {
    if (F.taken) continue;
    const d = Math.hypot(F.x - P.x, F.z - P.z, (F.y + 0.2 - hy) * 0.8);
    if (d < 2.4) offer(d, 2.4, FIND_KINDS[F.kind].label, () => diveTake(F), 0.25);
  }
}
function diveTake(F) {
  const P = GAME.player;
  if (!P || F.taken) return;
  const R = mulberry((GAME.t * 1000) | 0);
  if (F.kind === 'arrow') {
    const id = GOODS.arrows_bodkin ? 'arrows_bodkin' : GOODS.arrows_broadhead ? 'arrows_broadhead' : null;
    const n = 3 + Math.floor(R() * 4);
    if (id) { goodsAdd(id, n, true); uiLog(`You pull ${n} ${goodName(id, n).toLowerCase()} out of the silt. Someone shot wide here.`, 'loot'); }
    else { addGold(6 + Math.floor(R() * 8), P.x, P.y + 2, P.z); uiLog('You pull a few old arrows out of the silt; the heads are worth a little.', 'loot'); }
  } else if (F.kind === 'blade') {
    const it = makeItem({ cls: P.cls, realm: P.faction, lvl: Math.max(1, P.level - 1), q: rollQuality([20, 45, 26, 8, 1, 0]), slot: 'weapon' });
    if (!bagAdd(it)) { uiError('Your bags are full'); return; }
    uiLog(`From the bed you lift ${esc(it.name)}, black with silt but whole.`, 'loot');
    sfx(it.q >= 3 ? 'lootRare' : 'loot');
  } else if (F.kind === 'purse') {
    addGold(18 + P.level * 3 + Math.floor(R() * 40), P.x, P.y + 2, P.z);
    uiLog('The purse falls apart in your hand; the coins do not.', 'loot');
  } else {
    const items = [];
    for (let i = 0; i < 1 + (R() < 0.55 ? 1 : 0); i++) items.push(makeItem({ cls: P.cls, realm: P.faction, lvl: P.level, q: rollQuality(DROP_WEIGHTS.chest) }));
    if (INV.bag.length + items.length > (typeof BAG_SIZE !== 'undefined' ? BAG_SIZE : 99)) { uiError('Your bags are full'); return; }
    for (const it of items) if (!bagAdd(it)) dropItem(it, P.x, P.z, P.y + 2);
    addGold(50 + P.level * 4 + Math.floor(R() * 90), P.x, P.y + 2, P.z);
    uiLog(`The lid gives. Inside: ${items.map((it) => esc(it.name)).join(' and ')}, and coin.`, 'loot');
    sfx(items.some((it) => it.q >= 4) ? 'lootEpic' : 'lootRare');
    for (let i = 0; i < 14; i++) diveBubble(F.x + (Math.random() - 0.5) * 0.6, F.y + 0.4, F.z + (Math.random() - 0.5) * 0.4, F.surf);
    if (typeof loreNote === 'function') loreNote('divechest');
  }
  F.taken = true;
  const K = FIND_KINDS[F.kind];
  F.back = GAME.t + K.back[0] + Math.random() * (K.back[1] - K.back[0]);
  if (F.mesh) F.mesh.visible = false;
  DIVE.stats.finds++;
  setAct(P, 5, 0.6);
  saveSoon();
}
// finds come back in time: something else washes in or is lost, somewhere else on the same bed
function diveFindsStep() {
  for (const F of DIVE.finds) {
    if (!F.taken || GAME.t < F.back) continue;
    const a = F.area, s = a ? findSpot(mulberry((GAME.t * 97 + F.x) | 0), a.x, a.z, a.r, a.min, DIVE.finds.filter((q) => q !== F && !q.taken)) : null;
    if (s) { F.x = s.x; F.z = s.z; }
    F.taken = false;
    findPlace(F);
  }
}
registerSavePart('world', 'dive', {
  save: () => { const t = DIVE.finds.filter((F) => F.taken).map((F) => [F.id, Math.max(1, Math.round(F.back - GAME.t))]); return t.length ? { t } : null; },
  load: (d) => {
    for (const F of DIVE.finds) { F.taken = false; if (F.mesh) F.mesh.visible = true; }
    const t = d && Array.isArray(d.t) ? d.t : [];
    for (const r of t) {
      if (!Array.isArray(r)) continue;
      const F = DIVE.finds.find((q) => q.id === r[0]);
      if (!F || !isFiniteNum(r[1])) continue;
      F.taken = true; F.back = GAME.t + clamp(r[1], 1, 4000);
      if (F.mesh) F.mesh.visible = false;
    }
  },
  key: (d) => (d && d.t ? d.t.map((r) => r[0]).join() : ''),
});

/* ------------------------------------------------------------------ */
/* fish                                                                 */
/* ------------------------------------------------------------------ */
// one small fish model: a body laterally flattened, a forked tail and a dorsal fin; aF.x runs head (0) to tail (1)
function dvFishGeometry() {
  const pos = [], nrm = [], al = [], idx = [];
  const NS = 10, NR = 8;
  const rad = (u) => Math.pow(Math.sin(Math.PI * Math.min(1, u * 1.05 + 0.04)), 0.8) * (u < 0.85 ? 1 : 1 - (u - 0.85) * 4.5);
  for (let i = 0; i <= NS; i++) {
    const u = i / NS, z = 0.5 - u, r = Math.max(0.006, rad(u) * 0.11);
    for (let j = 0; j < NR; j++) {
      const a = (j / NR) * TAU, cx = Math.cos(a), cy = Math.sin(a);
      pos.push(cx * r * 0.55, cy * r * (1 + 0.15 * (cy > 0 ? 1 : 0)), z);
      nrm.push(cx * 0.8, cy, (u - 0.5) * 0.4);
      al.push(u, 0);
    }
  }
  for (let i = 0; i < NS; i++) for (let j = 0; j < NR; j++) {
    const a = i * NR + j, b = i * NR + (j + 1) % NR, c = a + NR, d = b + NR;
    idx.push(a, c, b, b, c, d);
  }
  const fin = (pts, nx) => { const b = pos.length / 3; for (const p of pts) { pos.push(p[0], p[1], p[2]); nrm.push(nx, 0.2, 0); al.push(p[3], 1); } idx.push(b, b + 1, b + 2, b, b + 2, b + 1); };
  fin([[0, 0, -0.43, 0.93], [0, 0.11, -0.6, 1.1], [0, 0.0, -0.54, 1.05]], 1);
  fin([[0, 0, -0.43, 0.93], [0, -0.1, -0.6, 1.1], [0, 0.0, -0.54, 1.05]], 1);
  fin([[0, 0.085, 0.12, 0.38], [0, 0.15, -0.02, 0.52], [0, 0.07, -0.16, 0.66]], 1);
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('aF', new THREE.Float32BufferAttribute(al, 2));
  g.setIndex(idx);
  return g;
}
const DV_FISH_MAX = 40;
const dvFishMat = mat({
  side: THREE.DoubleSide,
  vertexShader: /* glsl */`
    attribute vec2 aF; attribute vec4 iP; attribute vec4 iF;
    varying vec3 vW; varying vec3 vN; varying vec2 vF; varying vec3 vO; varying float vK;
    uniform float uTime;
    void main(){
      vec3 p = position * iF.z;
      float u = aF.x;
      // the tail beats, the body bends after it
      float wag = sin(iF.y - u * 4.2) * (0.05 + 0.2 * u * u) * iF.z;
      p.x += wag;
      vec3 n = normal; n.x -= cos(iF.y - u * 4.2) * u * 0.6;
      float cp = cos(iF.x), sp = sin(iF.x);
      p = vec3(p.x, p.y * cp + p.z * sp, -p.y * sp + p.z * cp);
      n = vec3(n.x, n.y * cp + n.z * sp, -n.y * sp + n.z * cp);
      float c = cos(iP.w), s = sin(iP.w);
      vec3 w = iP.xyz + vec3(p.x * c + p.z * s, p.y, -p.x * s + p.z * c);
      vW = w; vN = vec3(n.x * c + n.z * s, n.y, -n.x * s + n.z * c); vF = aF; vO = position; vK = iF.w;
      gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
    }`,
  fragmentShader: /* glsl */`
    ${GLSL_COMMON}
    ${GLSL_ATMOS}
    ${GLSL_WATER_MAP}
    varying vec3 vW; varying vec3 vN; varying vec2 vF; varying vec3 vO; varying float vK;
    void main(){
      vec3 n = safeNormalize(vN);
      int k = int(vK + 0.5);
      float up = smoothstep(-0.03, 0.05, vO.y), u = vF.x;
      // perch: green-gold barred; trout: olive, spotted; carp: bronze; char: grey-green, red belly; pike: long and green
      vec3 back = k == 0 ? vec3(0.22, 0.27, 0.1) : k == 1 ? vec3(0.26, 0.26, 0.15) : k == 2 ? vec3(0.32, 0.24, 0.1) : k == 3 ? vec3(0.2, 0.25, 0.25) : vec3(0.16, 0.22, 0.1);
      vec3 belly = k == 3 ? vec3(0.72, 0.32, 0.18) : k == 2 ? vec3(0.7, 0.58, 0.32) : vec3(0.74, 0.72, 0.62);
      vec3 alb = mix(belly, back, up);
      if (k == 0) alb *= 1.0 - 0.45 * smoothstep(0.5, 0.8, sin(u * 34.0)) * up;
      if (k == 1 || k == 4) alb *= 1.0 - 0.5 * step(0.84, hash12(floor(vec2(u * 40.0, vO.y * 120.0 + vO.x * 60.0))));
      alb = mix(alb, vec3(0.6, 0.62, 0.6), 0.3 * (1.0 - abs(vO.y) * 10.0) * (1.0 - up));
      if (vF.y > 0.5) alb = mix(back, vec3(0.5, 0.4, 0.3), 0.3);
      if (u < 0.12 && abs(vO.y) < 0.03 && abs(abs(vO.x) - 0.045) < 0.02) alb = vec3(0.02);
      // the light that reaches it through the water above it, and a silver sheen on the flanks
      vec4 wm = waterMapAt(vW.xz);
      float deep = wm.r > -500.0 ? max(wm.r - vW.y, 0.0) : 0.0;
      vec3 light = (uAmbient * 0.7 + uLightColor * 0.75 * clamp(dot(n, uLightDir) * 0.6 + 0.4, 0.0, 1.0)) * exp(-deep * vec3(0.32, 0.12, 0.1));
      vec3 V = safeNormalize(cameraPosition - vW);
      float sheen = spow(1.0 - abs(dot(n, V)), 2.5) * 0.35 + spow(max(dot(reflect(-uLightDir, n), V), 0.0), 30.0) * 0.6;
      vec3 col = alb * light + (uLightColor * 0.5 + uAmbient * 0.3) * sheen * exp(-deep * 0.2) * (vF.y > 0.5 ? 0.2 : 1.0);
      gl_FragColor = vec4(safeColor(applyFog(col, vW)), 1.0);
    }`,
});
function buildDvFish() {
  const g = dvFishGeometry();
  const iP = new THREE.InstancedBufferAttribute(new Float32Array(DV_FISH_MAX * 4), 4), iF = new THREE.InstancedBufferAttribute(new Float32Array(DV_FISH_MAX * 4), 4);
  iP.setUsage(THREE.DynamicDrawUsage); iF.setUsage(THREE.DynamicDrawUsage);
  g.setAttribute('iP', iP); g.setAttribute('iF', iF);
  g.instanceCount = 0;
  const m = new THREE.Mesh(g, dvFishMat);
  m.frustumCulled = false; m.renderOrder = 2;
  scene.add(m);
  DIVE.fish = m;
}
const DV_FISH_REALM = [[0, 2, 0, 4], [1, 0, 1, 4], [3, 1, 3, 4]];
function dvFishSpawn(cx, cz, rnd) {
  for (let k = 0; k < 14; k++) {
    const a = rnd() * TAU, d = 6 + rnd() * 26, x = cx + Math.cos(a) * d, z = cz + Math.sin(a) * d;
    const w = waterAt(x, z, _dvW);
    if (!w || w.depth < 1.1 || (SICE.on && seasonIceAt(x, z) > 0.12 && rnd() < 0.5)) continue;
    const realm = realmAt(x, z), kinds = DV_FISH_REALM[clamp(realm, 0, 2)] || DV_FISH_REALM[0];
    const kind = kinds[Math.floor(rnd() * kinds.length)], solo = kind === 4;
    const S = { x, z, y: heightAt(x, z) + Math.min(w.depth * 0.5, 1.2), yaw: rnd() * TAU, sp: 0.5, tx: x, tz: z, ty: 0, kind, t: 0, flee: 0, fish: [] };
    const n = solo ? 1 : quality.level === 'low' ? 4 : quality.level === 'medium' ? 6 : 8;
    for (let i = 0; i < n; i++) S.fish.push({ ox: (rnd() - 0.5) * 1.6, oy: (rnd() - 0.5) * 0.5, oz: (rnd() - 0.5) * 2.2, ph: rnd() * TAU, sz: (solo ? 0.75 : kind === 2 ? 0.42 : 0.3) * (0.8 + rnd() * 0.45), yaw: S.yaw, pitch: 0, x, y: S.y, z });
    dvFishTarget(S, rnd);
    return S;
  }
  return null;
}
function dvFishTarget(S, rnd, away = null) {
  for (let k = 0; k < 10; k++) {
    let a = rnd() * TAU, d = 3 + rnd() * 9;
    if (away) { a = Math.atan2(S.x - away.x, S.z - away.z) + (rnd() - 0.5) * 1.2; d = 7 + rnd() * 6; }
    const x = S.x + Math.sin(a) * d, z = S.z + Math.cos(a) * d, w = waterAt(x, z, _dvW);
    if (!w || w.depth < 0.9) continue;
    const mx = (S.x + x) / 2, mz = (S.z + z) / 2, wm = waterAt(mx, mz, _dvW);
    if (!wm || wm.depth < 0.7) continue;
    S.tx = x; S.tz = z;
    const g = heightAt(x, z);
    S.ty = g + 0.3 + rnd() * Math.max(0.1, w.depth - 0.8);
    S.t = 0;
    return;
  }
}
const _dvFishR = mulberry(99);
function dvFishStep(dt) {
  const M = DIVE.fish;
  if (!M) return;
  const cam = camera.position, P = GAME.player;
  const max = quality.level === 'low' ? 2 : quality.level === 'medium' ? 3 : 4;
  // schools near the camera only: far ones go, new ones come where there is water
  for (let i = DIVE.schools.length - 1; i >= 0; i--) if (dist2(DIVE.schools[i].x, DIVE.schools[i].z, cam.x, cam.z) > 55 * 55) DIVE.schools.splice(i, 1);
  if (DIVE.schools.length < max && !INDOOR.on && (DIVE.spawnT = (DIVE.spawnT || 0) - dt) < 0) {
    DIVE.spawnT = 0.7;
    if (waterAt(cam.x, cam.z, _dvW) || DIVE.under.on || [0, 1, 2, 3, 4, 5].some((k) => waterAt(cam.x + Math.cos(k) * 20, cam.z + Math.sin(k) * 20, _dvW))) {
      const S = dvFishSpawn(cam.x, cam.z, _dvFishR);
      if (S) DIVE.schools.push(S);
    }
  }
  const iP = M.geometry.attributes.iP.array, iF = M.geometry.attributes.iF.array;
  let n = 0;
  for (const S of DIVE.schools) {
    S.t += dt;
    // a body in the water close by sends them off
    let threat = null;
    if (P && P.alive && (P.swim || P.dive || P.boat) && Math.hypot(P.x - S.x, P.z - S.z, (P.y + (P.dive ? DIVE_PIVOT : 1.0)) - S.y) < (P.dive ? 5 : 3.5)) threat = P;
    if (threat && S.flee <= 0) { dvFishTarget(S, _dvFishR, threat); S.flee = 2.2; }
    S.flee -= dt;
    const want = S.flee > 0 ? 2.6 : S.kind === 4 ? 0.35 : 0.55;
    S.sp = lerp(S.sp, want, 1 - Math.exp(-dt * (S.flee > 0 ? 6 : 1.5)));
    const dx = S.tx - S.x, dz = S.tz - S.z, d = Math.hypot(dx, dz);
    if (d < 1 || S.t > 14) dvFishTarget(S, _dvFishR);
    S.yaw += clamp(angDiff(S.yaw, Math.atan2(dx, dz)), -dt * 2.2, dt * 2.2);
    const nx = S.x + Math.sin(S.yaw) * S.sp * dt, nz = S.z + Math.cos(S.yaw) * S.sp * dt, w = waterAt(nx, nz, _dvW);
    if (w && w.depth > 0.6) { S.x = nx; S.z = nz; } else dvFishTarget(S, _dvFishR);
    const wh = waterAt(S.x, S.z, _dvW), g = heightAt(S.x, S.z);
    const top = wh ? wh.y - (SICE.on && seasonIceAt(S.x, S.z) > 0.12 ? 0.5 : 0.25) : g + 0.3;
    S.y = clamp(lerp(S.y, S.ty, 1 - Math.exp(-dt * 0.6)), g + 0.22, Math.max(g + 0.22, top));
    // each fish keeps its place in the school, wandering a little; they turn together
    const c = Math.cos(S.yaw), s = Math.sin(S.yaw);
    for (const f of S.fish) {
      if (n >= DV_FISH_MAX) break;
      f.ph += dt * (5 + S.sp * 9);
      const wob = Math.sin(GAME.t * 0.7 + f.ox * 5) * 0.3;
      const tx = S.x + f.ox * c + (f.oz + wob) * s, tz = S.z - f.ox * s + (f.oz + wob) * c;
      const ty = clamp(S.y + f.oy + Math.sin(GAME.t * 0.9 + f.oz * 3) * 0.08, g + 0.15, Math.max(g + 0.15, top));
      const ox = f.x, oy = f.y, oz = f.z;
      const k = 1 - Math.exp(-dt * (S.flee > 0 ? 5 : 2.2));
      f.x = lerp(f.x, tx, k); f.y = lerp(f.y, ty, k); f.z = lerp(f.z, tz, k);
      const vx = f.x - ox, vz = f.z - oz, vh = Math.hypot(vx, vz);
      if (vh > 1e-4) f.yaw += clamp(angDiff(f.yaw, Math.atan2(vx, vz)), -dt * 6, dt * 6);
      f.pitch = lerp(f.pitch, clamp(Math.atan2(-(f.y - oy), Math.max(vh, 1e-3)), -0.6, 0.6), 1 - Math.exp(-dt * 4));
      if (dist2(f.x, f.z, cam.x, cam.z) > 50 * 50) continue;
      const o = n * 4;
      iP[o] = f.x; iP[o + 1] = f.y; iP[o + 2] = f.z; iP[o + 3] = f.yaw;
      iF[o] = f.pitch; iF[o + 1] = f.ph; iF[o + 2] = f.sz; iF[o + 3] = S.kind;
      n++;
    }
  }
  M.geometry.instanceCount = n;
  if (n) { M.geometry.attributes.iP.needsUpdate = true; M.geometry.attributes.iF.needsUpdate = true; }
}

/* ------------------------------------------------------------------ */
/* the view from under the water                                        */
/* ------------------------------------------------------------------ */
// shafts of sunlight slanting down through the water near the eye
const SHAFT_MAX = 22;
const shaftMat = mat({
  transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  uniforms: { uShaftDir: { value: new THREE.Vector3(0, -1, 0) }, uShaftCol: { value: new THREE.Vector3() } },
  vertexShader: /* glsl */`
    attribute vec4 iS; attribute vec4 iL;
    uniform vec3 uShaftDir; uniform vec4 uUnder;
    varying vec2 vUv; varying vec3 vW; varying vec4 vL;
    void main(){
      vec3 top = vec3(iS.x, uUnder.y - 0.05, iS.y);
      vec3 side = cross(uShaftDir, top - cameraPosition);
      side = side / max(length(side), 1e-4);
      float along = 0.5 - position.y;
      vec3 w = top + uShaftDir * along * iL.x + side * position.x * iS.z * (0.8 + 0.5 * along);
      vUv = vec2(position.x * 2.0, along); vW = w; vL = iL;
      gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
    }`,
  fragmentShader: /* glsl */`
    ${GLSL_COMMON}
    ${GLSL_ATMOS}
    uniform vec3 uShaftCol;
    varying vec2 vUv; varying vec3 vW; varying vec4 vL;
    void main(){
      float across = 1.0 - abs(vUv.x);
      float a = across * across * smoothstep(0.0, 0.12, vUv.y) * pow(max(1.0 - vUv.y, 0.0), 1.6);
      a *= 0.55 + 0.45 * sin(uTime * (0.5 + vL.w * 0.4) + vL.y);
      a *= 0.7 + 0.3 * vnoise(vec2(vUv.x * 3.0 + vL.y, vUv.y * 6.0 - uTime * 0.3));
      float d = length(vW - cameraPosition);
      a *= smoothstep(0.8, 3.0, d) * exp(-d * uUnder.z * 1.4) * vL.z;
      gl_FragColor = vec4(uShaftCol, a); // (additive: the blend weighs the colour by a once)
    }`,
});
function buildShafts() {
  const g = new THREE.InstancedBufferGeometry();
  const q = new THREE.PlaneGeometry(1, 1, 1, 4);
  g.setAttribute('position', q.attributes.position);
  g.setIndex(q.index);
  g.setAttribute('iS', new THREE.InstancedBufferAttribute(new Float32Array(SHAFT_MAX * 4), 4).setUsage(THREE.DynamicDrawUsage));
  g.setAttribute('iL', new THREE.InstancedBufferAttribute(new Float32Array(SHAFT_MAX * 4), 4).setUsage(THREE.DynamicDrawUsage));
  g.instanceCount = 0;
  const m = new THREE.Mesh(g, shaftMat);
  m.frustumCulled = false; m.renderOrder = 7; m.visible = false;
  scene.add(m);
  DIVE.shafts = m;
}
const _shD = new THREE.Vector3();
function shaftsFrame(on, surfY) {
  const M = DIVE.shafts;
  if (!M) return;
  const L = U.uLightDir.value, sunUp = (1 - U.uNight.value) * clamp(L.y * 3, 0, 1);
  M.visible = on && sunUp > 0.05 && quality.level !== 'low';
  if (!M.visible) return;
  // the sun's light bent down into the water (it enters steeper than it falls)
  _shD.set(-L.x / 1.33, -Math.sqrt(Math.max(0.05, 1 - (L.x * L.x + L.z * L.z) / (1.33 * 1.33))), -L.z / 1.33).normalize();
  shaftMat.uniforms.uShaftDir.value.copy(_shD);
  const lc = U.uLightColor.value, cov = 1 - 0.8 * (WEATHER.overcast || 0);
  shaftMat.uniforms.uShaftCol.value.set(lc.x * 0.3, lc.y * 0.42, lc.z * 0.4).multiplyScalar(sunUp * cov);
  const iS = M.geometry.attributes.iS.array, iL = M.geometry.attributes.iL.array, cam = camera.position;
  const cell = 2.6, ci = Math.floor(cam.x / cell), cj = Math.floor(cam.z / cell), list = [];
  for (let j = -6; j <= 6; j++) for (let i = -6; i <= 6; i++) {
    const h = hash2(ci + i, cj + j);
    if (h > 0.34) continue;
    const x = (ci + i + hash2(cj + j, ci + i + 7)) * cell, z = (cj + j + hash2(ci + i + 3, cj + j + 11)) * cell;
    const w = waterAt(x, z, _dvW);
    if (!w || w.depth < 1 || Math.abs(w.y - surfY) > 1.5 || (SICE.on && seasonIceAt(x, z) > 0.1 && !diveHoleAt(x, z, 0.4))) continue;
    list.push([dist2(x, z, cam.x, cam.z), x, z, h, Math.min(w.depth + 2, 14)]);
  }
  list.sort((a, b) => a[0] - b[0]);
  const n = Math.min(SHAFT_MAX, list.length);
  for (let k = 0; k < n; k++) {
    const [, x, z, h, len] = list[k], o = k * 4;
    iS[o] = x; iS[o + 1] = z; iS[o + 2] = 0.5 + h * 4.5; iS[o + 3] = 0;
    iL[o] = len; iL[o + 1] = h * 40; iL[o + 2] = 0.5 + h * 1.4; iL[o + 3] = h * 3;
  }
  M.geometry.instanceCount = n;
  M.geometry.attributes.iS.needsUpdate = true; M.geometry.attributes.iL.needsUpdate = true;
}
// the screen under the water: a slow wobble and a deeper vignette (the composite is patched at its own lines)
(function divePatchComposite() {
  const C = composite;
  const a1 = 'uniform sampler2D tScene, tBloom, tRays;', a2 = 'vec3 col = clamp(finite3(texture2D(tScene, vUv).rgb), 0.0, 8.0);';
  if (!C.fragmentShader.includes(a1) || !C.fragmentShader.includes(a2)) { reportErrorLater('water2: the composite shader no longer has its anchors'); return; }
  C.fragmentShader = C.fragmentShader.replace(a1, 'uniform float uUnderW; ' + a1).replace(a2, /* glsl */`
      vec2 uvW = vUv;
      if (uUnderW > 0.001) uvW += vec2(sin(vUv.y * 41.0 + uTime * 2.2) + 0.5 * sin(vUv.y * 13.0 - uTime * 1.3), cos(vUv.x * 33.0 + uTime * 1.8)) * 0.0016 * uUnderW;
      vec3 col = clamp(finite3(texture2D(tScene, uvW).rgb), 0.0, 8.0);`);
  C.uniforms.uUnderW = { value: 0 };
})();
function reportErrorLater(msg) { setTimeout(() => { if (typeof reportError === 'function') reportError(new Error(msg)); }, 0); }
// every frame: is the eye under the water, and how it looks from there
function diveFrame(dt) {
  const cam = camera.position, U4 = U.uUnder.value, D = DIVE.under;
  const w = !INDOOR.on && WATERGRID.surf ? waterAt(cam.x, cam.z, _dvW) : null;
  const under = !!(w && cam.y < w.y - 0.05);
  D.on = under;
  D.k = lerp(D.k, under ? 1 : 0, 1 - Math.exp(-dt * 8));
  if (under) {
    D.y = w.y; D.d = w.y - cam.y;
    // still, deep water is darker and greener; a river runs clearer and greyer; Thule's water is clear and cold
    const fl = Math.hypot(w.fx, w.fz), realm = realmAt(cam.x, cam.z), pond = !LAKES.some((L) => dist2(cam.x, cam.z, L.x, L.z) < (L.r * 1.3) ** 2) && fl < 0.05;
    const murk = (pond ? 0.17 : realm === 2 ? 0.075 : 0.1) + (WEATHER.raining || 0) * 0.04 + (fl > 0.4 ? 0.02 : 0);
    const A = U.uAmbient.value, L = U.uLightColor.value, day = 1 - U.uNight.value * 0.8;
    const lit = Math.exp(-D.d * 0.09);
    const iced = SICE.on && seasonIceAt(cam.x, cam.z) > 0.12 ? 0.45 : 1;
    const base = pond ? [0.05, 0.085, 0.06] : realm === 2 ? [0.03, 0.08, 0.1] : [0.035, 0.09, 0.085];
    U.uUnderCol.value.set(base[0] * (A.x * 0.9 + L.x * 0.7 * day), base[1] * (A.y * 0.9 + L.y * 0.7 * day), base[2] * (A.z * 0.9 + L.z * 0.7 * day)).multiplyScalar(lit * iced * 3.0);
    U4.set(1, w.y, murk, D.d);
  } else U4.set(0, -1000, U4.z, 0);
  // the holes' own rims are drawn for the eye above the ice; from under it the open water shows the sky
  if (under) { for (const h of DIVE.holes) if (h.mesh) h.mesh.visible = false; if (typeof SEAS !== 'undefined' && SEAS.hole) SEAS.hole.visible = false; }
  composite.uniforms.uUnderW.value = D.k * (REDUCE_MOTION ? 0.3 : 1);
  composite.uniforms.uVignette.value = 0.34 + 0.28 * D.k;
  shaftsFrame(under, under ? w.y : 0);
  diveAudio(dt, under);
  // motes drifting in the water round the eye, and the diver's breath going up
  if (under) {
    DIVE.moteT -= dt * (quality.level === 'low' ? 3 : 8);
    while (DIVE.moteT < 0) {
      DIVE.moteT += 1;
      const a = Math.random() * TAU, r = 0.6 + Math.random() * 4.5, x = cam.x + Math.cos(a) * r, z = cam.z + Math.sin(a) * r, y = cam.y + (Math.random() - 0.5) * 3;
      const c = U.uUnderCol.value;
      if (y < D.y - 0.1) fxAlpha.emit(x, y, z, (Math.random() - 0.5) * 0.06 + w.fx * 0.3, (Math.random() - 0.4) * 0.04, (Math.random() - 0.5) * 0.06 + w.fz * 0.3, 2.5 + Math.random() * 2, c.x * 5 + 0.08, c.y * 4 + 0.08, c.z * 4 + 0.08, 0.018 + Math.random() * 0.02, 0, 0.2);
    }
  }
  const P = GAME.player;
  if (P && P.dive && P.alive) {
    DIVE.bubT -= dt;
    if (DIVE.bubT < 0) {
      DIVE.bubT = 0.5 + Math.random() * 1.1 * (P.breath ?? 1);
      const sc = P.scale || 1, hx = P.x + Math.sin(P.yaw) * 0.55 * sc, hz = P.z + Math.cos(P.yaw) * 0.55 * sc, hy = P.y + DIVE_PIVOT * sc + 0.1;
      const ws = waterAt(hx, hz, _dvW);
      for (let i = 0; i < 2 + Math.floor(Math.random() * 4); i++) diveBubble(hx, hy, hz, ws ? ws.y : hy + 1);
    }
  }
}
function diveBubble(x, y, z, surf) {
  const vy = 0.7 + Math.random() * 0.5, life = clamp((surf - y - 0.05) / (vy + 0.6), 0.2, 6);
  fxAlpha.emit(x + (Math.random() - 0.5) * 0.12, y, z + (Math.random() - 0.5) * 0.12, (Math.random() - 0.5) * 0.08, vy, (Math.random() - 0.5) * 0.08, life, 0.75, 0.85, 0.9, 0.02 + Math.random() * 0.03, -0.25, 0.4);
}

/* ------------------------------------------------------------------ */
/* sound: the world muffled under the water, and the diver's own        */
/* ------------------------------------------------------------------ */
function diveAudio(dt, under) {
  const ctx = AUDIO.ctx;
  if (!ctx || !AUDIO.master || !AUDIO.comp || ctx.state !== 'running') return;
  if (!DIVE.au) {
    try {
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 20000; lp.Q.value = 0.6;
      AUDIO.master.disconnect(); AUDIO.master.connect(lp).connect(AUDIO.comp);
      const src = ctx.createBufferSource(); src.buffer = AUDIO.noise; src.loop = true; src.playbackRate.value = 0.35;
      const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 260;
      const g = ctx.createGain(); g.gain.value = 0;
      src.connect(f).connect(g).connect(AUDIO.comp); src.start();
      DIVE.au = { lp, g };
    } catch (e) { DIVE.au = { lp: null, g: null }; }
  }
  const A = DIVE.au;
  if (!A.lp) return;
  const want = under ? 520 : 20000;
  if (A.want !== want) { A.want = want; A.lp.frequency.setTargetAtTime(want, ctx.currentTime, under ? 0.05 : 0.12); A.g.gain.setTargetAtTime(under && AUDIO.on ? 0.22 : 0, ctx.currentTime, 0.2); }
}
function diveSfx(name) {
  if (!AUDIO.ctx || !AUDIO.on || AUDIO.ctx.state !== 'running') return;
  const t = AUDIO.ctx.currentTime + 0.005;
  try {
    if (name === 'dive') { noiseBurst(t, 0.5, 0.2, 'lowpass', 2200, 260, 0.8, 0.004); tone('sine', 220, 70, t + 0.05, 0.3, 0.12); }
    else if (name === 'gasp') { noiseBurst(t, 0.45, 0.12, 'bandpass', 900, 2600, 1.2, 0.03); noiseBurst(t + 0.5, 0.35, 0.06, 'bandpass', 1400, 700, 1.2, 0.05); }
    else if (name === 'gulp') { tone('sine', 140, 60, t, 0.25, 0.2); for (let i = 0; i < 3; i++) { const f = 300 + Math.random() * 300; tone('sine', f, f * 1.8, t + 0.08 + i * 0.07, 0.05, 0.05, 0.002); } }
    else if (name === 'bump') { tone('sine', 90, 55, t, 0.2, 0.25); noiseBurst(t, 0.12, 0.08, 'lowpass', 600, 200, 0.7); }
    else if (name === 'chip') noiseBurst(t, 0.07, 0.12, 'highpass', 3000, 5000, 0.8, 0.002);
  } catch (e) { /* audio is optional */ }
}

/* ------------------------------------------------------------------ */
/* cutting a hole in the ice; the offers                                */
/* ------------------------------------------------------------------ */
function diveIceOffers(P, offer) {
  if (P.dive || P.boat || P.mount || !SICE.on) return;
  if (seasonIceY(P.x, P.z) === null) return;
  const x = P.x + Math.sin(P.yaw) * 1.1, z = P.z + Math.cos(P.yaw) * 1.1;
  if (diveHoleAt(x, z, 0.6) || seasonIceAt(x, z) < 0.3) return;
  const w = waterAt(x, z, _dvW);
  if (!w || w.depth < 1.2) return;
  offer(1.4, 2.5, 'Cut a hole in the ice', () => {
    if (typeof survStartJob !== 'function') { diveCutHole(x, z); return; }
    survStartJob({ label: 'Cutting a hole in the ice', dur: 2.6, yaw: Math.atan2(x - P.x, z - P.z), tick: (J) => {
      J.chip = (J.chip || 0) - GAME.dt;
      if (J.chip < 0) { J.chip = 0.55; setAct(P, 1, 0.5); diveSfx('chip'); for (let i = 0; i < 6; i++) fxAlpha.emit(x, w.y + 0.08, z, (Math.random() - 0.5) * 1.6, 1 + Math.random() * 1.5, (Math.random() - 0.5) * 1.6, 0.5, 0.85, 0.9, 0.95, 0.03, 9, 0.5); }
    }, done: () => { diveCutHole(x, z); uiLog('You break through the ice. Dark water wells up in the hole.', 'sys'); splashAt(x, z, 0.5); return false; } });
  }, 0.02);
}
function dive2Offers(P, offer) { diveOffers(P, offer); diveIceOffers(P, offer); }

/* ------------------------------------------------------------------ */
/* the breath bar and the pad's dive button                             */
/* ------------------------------------------------------------------ */
function diveHUD() {
  const P = GAME.player;
  if (!P) return;
  diveBindPad();
  const el = $('breath');
  if (el) {
    const b = P.breath ?? 1, show = !!(P.dive || b < 0.995) && P.alive;
    if (show !== DIVE.hudOn) { DIVE.hudOn = show; el.classList.toggle('on', show); }
    if (show) {
      setW($('breath-b'), b);
      setT($('breath-t'), P.dive ? (b > 0 ? `${Math.ceil(b * DIVE_BREATH)} s` : 'Drowning') : 'Catching your breath');
      el.classList.toggle('low', b < 0.25);
    }
  }
  const tb = $('t-jump');
  if (tb) {
    const lab = P.dive ? (P.dive.up ? 'Rise…' : 'Up') : P.boat ? 'Dive in' : P.swim && !diveWhyNot(P) ? 'Dive' : 'Jump';
    if (lab !== DIVE.pad) { DIVE.pad = lab; tb.textContent = lab; tb.classList.toggle('w2-dive', lab !== 'Jump'); }
  }
}
// the pad's Jump button dives while you swim (before the jump's own handler sees the tap)
function diveBindPad() {
  if (DIVE.bound) return;
  DIVE.bound = true;
  $('tpad').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b || b.id !== 't-jump') return;
    const P = GAME.player;
    if (!P || UI.modal || !P.alive) return;
    if (P.dive || P.swim || P.boat) { e.stopImmediatePropagation(); e.preventDefault(); diveToggle(); }
  }, true);
}
window.addEventListener('keydown', (e) => {
  if (e.code !== 'KeyU' || e.repeat || !GAME.started || UI.modal || typing()) return;
  diveToggle();
});

/* ------------------------------------------------------------------ */
/* the step and the frame (07b_swim.js calls these)                     */
/* ------------------------------------------------------------------ */
function diveUpdate(dt) {
  const P = GAME.player;
  if (P) {
    if (P.dive && (!P.alive || inDungeon(P))) P.dive = null;
    if (!P.dive) {
      // the head out of the water: the breath comes back
      if ((P.breath ?? 1) < 1) P.breath = Math.min(1, P.breath + dt / 3.2);
    }
  }
  diveHolesStep(dt);
  if ((DIVE.findT = (DIVE.findT || 0) - dt) < 0) { DIVE.findT = 2; diveFindsStep(); }
}
function diveDraw(dt) {
  if (!DIVE.built) return;
  diveFrame(dt);
  dvFishStep(dt);
  // the finds show near the camera only
  if ((DIVE.visT = (DIVE.visT || 0) - dt) < 0) {
    DIVE.visT = 0.4;
    const cam = camera.position, r = quality.level === 'low' ? 40 : quality.level === 'medium' ? 55 : 70;
    for (const F of DIVE.finds) if (F.mesh) F.mesh.visible = !F.taken && dist2(F.x, F.z, cam.x, cam.z) < r * r;
  }
  if (GAME.started && GAME.player) diveHUD();
}

/* test hooks (window.__hm.dive) */
const DIVE_DEBUG = {
  DIVE, start: () => diveStart(GAME.player), end: () => diveEnd(GAME.player), toggle: diveToggle, cutHole: diveCutHole, holeAt: diveHoleAt, take: diveTake, whyNot: () => diveWhyNot(GAME.player),
  state: () => { const P = GAME.player; if (!P) return null; const w = waterAt(P.x, P.z, {}); return { dive: !!P.dive, up: P.dive ? P.dive.up : false, t: P.dive ? P.dive.t : 0, x: P.x, y: P.y, z: P.z, pivot: P.y + DIVE_PIVOT * (P.scale || 1), surf: w ? w.y : null, bed: heightAt(P.x, P.z), breath: P.breath ?? 1, hp: P.hp, maxHp: P.maxHp, alive: P.alive, swim: !!P.swim, pitch: P.dive ? P.dive.pitch : null, act: animActValue(P) }; },
  finds: () => DIVE.finds.map((F) => ({ id: F.id, kind: F.kind, x: F.x, y: F.y, z: F.z, taken: F.taken, depth: F.surf - F.y })),
  under: () => ({ ...DIVE.under, uUnder: U.uUnder.value.toArray(), col: U.uUnderCol.value.toArray(), shafts: DIVE.shafts ? DIVE.shafts.geometry.instanceCount : 0, fish: DIVE.fish ? DIVE.fish.geometry.instanceCount : 0, schools: DIVE.schools.length }),
  dvFishStep, diveFrame,
};
WATER_DEBUG.dive = DIVE_DEBUG; // window.__hm.water.dive
