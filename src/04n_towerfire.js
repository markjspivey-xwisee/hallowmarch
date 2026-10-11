/* ================================================================== */
/* [keeps] a timber tower burns, falls in and is built again           */
/* ================================================================== */
// The shafts of logs of the Thule burhs (towerTimber, 04l_towers.js) catch fire like a house: from a fire spell or a
// burning arrow landing on them (fireLandsAt asks towerFireAt), the dragon's breath (fireConeAt asks towerFireCone)
// or a burning brand held to their logs (E: towerFireOffers). The fire climbs the shaft as it takes hold (TFIRE.climb)
// with real flames and smoke, chars the logs (the castle shader: uTA/uTB, castleTowerUpload), harms whoever is in its
// rooms or its gallery, and rain damps it (a young fire in a downpour goes out). After TFIRE.burn seconds the gallery
// and the roof fall in: they are gone from the castle's mesh (cut above the walk room's ceiling), the gallery's floor,
// breastwork and posts and its ladder stand down, a heap of charred timber lies in the room below, and anyone up there
// falls. Once the keep has been quiet for TFIRE.quiet seconds its owners build it back over TFIRE.rebuild seconds, the
// new timber rising course by course and pale for a while. The garrison's own fire never lights its own towers. Saved
// with the world (save part world.x.towerfire). Stone towers do not burn.

const TFIRE = { burn: 70, climb: 22, quiet: 20, rebuild: 150, harm: 0.03, stats: { lit: 0, out: 0, fell: 0, rebuilt: 0 }, dirty: new Set() };

// can the fire of `by` light this tower? (the garrison's and the realm's own fire never does; the player's always)
function towerFireSpared(T, by) {
  if (!by || by === GAME.player || by.role === 'player') return false;
  const K = T.S.keepRef;
  return !!(K && by.faction === K.realm);
}
function towerFireAt(x, y, z, r, by) {
  let n = 0;
  for (const T of TOWER.list) {
    if (T.look === 'rath') { if (!T.burn && !T.fallen && towerConeHit(T, x, y, z, r) && !towerFireSpared(T, by) && towerIgnite(T, y - T.S.y)) n++; continue; } // [siege2] an Eriu tower's thatched cone
    if (T.look !== 'timber' || T.burn || T.fallen) continue;
    if (Math.abs(x - T.wx) > T.HO + r + 3 || Math.abs(z - T.wz) > T.HO + r + 3) continue;
    if (y > T.S.y + T.apex + 1 || y < T.S.y + 1.5) continue; // the stone footing does not burn
    const l = twLocal(T, x, z), pad = Math.max(0.8, r * 0.6) + 0.5;
    if (Math.abs(l.x) > T.HO + pad || Math.abs(l.z) > T.HO + pad) continue;
    if (towerFireSpared(T, by)) continue;
    if (towerIgnite(T, y - T.S.y)) n++;
  }
  return n;
}
function towerFireCone(x, z, dx, dz, range, half) {
  let n = 0;
  for (const T of TOWER.list) {
    if ((T.look !== 'timber' && T.look !== 'rath') || T.burn || T.fallen) continue; // [siege2] and Eriu's thatched cones
    const ox = T.wx - x, oz = T.wz - z, d = Math.hypot(ox, oz);
    if (d > range + T.HO || (d > 1.5 && (ox * dx + oz * dz) / d < Math.cos(half + 0.25))) continue;
    if (towerIgnite(T, T.TT)) n++;
  }
  return n;
}
// set a timber tower alight at height y (above its site)
function towerIgnite(T, y = 3) {
  if ((T.look !== 'timber' && T.look !== 'rath') || T.burn || T.fallen) return false; // [siege2] a rath's cone too
  T.burn = { t: 0, heat: 0.12, y0: T.look === 'rath' ? clamp(y, T.TT + 0.6, T.apex - 0.5) : clamp(y, 1.8, T.TT), fires: [], tick: 0, told: false };
  T.char = T.char || 0;
  TFIRE.stats.lit++;
  TFIRE.dirty.add(T.C);
  const P = GAME.player;
  if (P && dist2(P.x, P.z, T.wx, T.wz) < 60 * 60) { sfx('ignite'); uiLog(T.look === 'rath' ? `The thatch of a tower of ${T.S.name} has caught fire!` : `A tower of ${T.S.name} has caught fire!`, 'warn'); } // [siege2]
  return true;
}
// spots on the tower where flames show, up to the height the fire has climbed to: the walls' faces, the gallery, the roof
function towerFireSpots(T) {
  if (T.fireSpots) return T.fireSpots;
  const out = [];
  if (T.look === 'rath') { // [siege2] the posts under the cone, then the thatch in rings up to its point
    for (let k = 0; k < 2; k++) { const p = twW(T, (k + 0.5) * Math.PI, T.RO - 0.3); out.push({ x: p.x, z: p.z, y: T.TT + 1.3, s: 0.6 }); }
    for (const [h, n] of [[0.5, 4], [1.5, 3], [2.5, 2]]) for (let k = 0; k < n; k++) { const rr = (T.RO + 0.55) * (1 - h / 3.6) + 0.05, p = twW(T, (k / n) * TAU + h, rr); out.push({ x: p.x, z: p.z, y: T.eave + h, s: 0.8 + 0.2 * (h < 1) }); }
    out.push({ x: T.wx, z: T.wz, y: T.apex - 0.3, s: 1.1, roof: true });
    T.fireSpots = out;
    return out;
  }
  for (let k = 0; k < 4; k++) {
    const a = (k * Math.PI) / 2;
    for (const off of [-T.HO * 0.5, T.HO * 0.5]) for (const y of [2.6, T.H + 1.2, T.TT - 0.6]) { const p = twW(T, a, T.HO + 0.05, off); out.push({ x: p.x, z: p.z, y, s: 0.75 }); }
  }
  for (const [ux, uz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) { const p = siteToWorld(T.S, T.cx + ux * (T.HO - 0.2), T.cz + uz * (T.HO - 0.2)); out.push({ x: p.x, z: p.z, y: T.TT + 0.8, s: 0.9 }); }
  for (const y of [T.eave + 0.6, T.eave + 1.6]) out.push({ x: T.wx, z: T.wz, y, s: 1.3, roof: true });
  T.fireSpots = out;
  return out;
}
// the castle mesh's view of its towers: where each is, how charred, how much stands (the castle shader's uTA/uTB)
function castleTowerUpload(C) {
  const U3 = C.towerU;
  if (!U3) return;
  const Ts = TOWER.list.filter((T) => T.C === C && (T.look === 'timber' || T.look === 'rath')); // [siege2] and Eriu's thatched cones
  for (let i = 0; i < TW_FIRE_MAX; i++) {
    const T = Ts[i];
    if (!T) { U3.uTA.value[i].set(0, 0, 0, 0); U3.uTB.value[i].set(1e5, 0, 0, 0); continue; }
    const B = T.burn, Fl = T.fallen;
    // cut: nothing above the walk room's ceiling once fallen; while it is built again the cut rises to the roof's peak
    const rath = T.look === 'rath', base = rath ? T.TT + 2.15 : T.TT - 0.2; // [siege2] a cone burns down to its posts' stumps over the breastwork
    const cut = Fl ? T.S.y + (Fl.r > 0 ? lerp(base, T.apex + 0.3, Fl.r) : base) : 1e5;
    U3.uTA.value[i].set(T.wx, T.wz, rath ? -(T.RO + 0.62) : T.HO + 0.65, clamp(T.char || 0, 0, 1)); // [siege2] a drum's: a circle (minus its radius)
    U3.uTB.value[i].set(cut, B ? clamp(B.heat, 0, 1) : Fl ? clamp(Fl.ember || 0, 0, 1) * 0.85 : 0, T.S.y + (rath ? T.TT + 2.15 : 1.8), Fl ? clamp(Fl.fresh || 0, 0, 1) : clamp(T.fresh || 0, 0, 1)); // [walls] a fallen tower's embers smoulder on
  }
  U3.uTR.value.set(Math.cos(C.S.yaw), Math.sin(C.S.yaw));
  // every tower of the castle (any look): its rooms keep the snow off their floors (the castle shader's uTS)
  if (U3.uTS) {
    const All = TOWER.list.filter((T) => T.C === C);
    for (let i = 0; i < TW_FIRE_MAX; i++) {
      const T = All[i];
      if (!T || T.breached) U3.uTS.value[i].set(0, 0, 0, 0); // [walls] a breached tower keeps no snow off
      else U3.uTS.value[i].set(T.wx, T.wz, T.kind === 'drum' ? T.RO : -T.HO, T.S.y + T.shelterY - 0.05); // to the outer face: a gallery's floor runs over the walls
    }
  }
}

// the gallery and the roof fall in
function towerFallIn(T) {
  const B = T.burn;
  T.burn = null;
  for (const f of B.fires) f.until = GAME.t;
  T.fallen = { t: 0, r: 0, quiet: 0, fresh: 0, ember: 1 }; // [walls] ember: the char glows on, fading
  T.char = 1;
  TFIRE.stats.fell++;
  const top = T.look === 'rath' ? null : T.ladders.find((L) => Math.abs(L.yt - T.TT) < 0.01); // [siege2] a rath's platform stands: only its cone falls
  for (const f of T.topFloors || []) f.active = false;
  for (const c of T.topColls || []) c.active = false;
  if (top) { top.gone = true; if (top.hatch) { top.hatch.gone = true; top.hatch.floor.active = false; /* [walls] gone: updateTowers keeps it down */ top.hatch.held = false; top.hatch.until = 0; top.hatch.lidColl.active = false; } }
  if (T.heap) T.heap.visible = true;
  // whoever stood up there falls into the room below
  if (T.look !== 'rath') forNear(T.wx, T.wz, T.HO + 1.5, (o) => { // [siege2] (a rath's platform stays under its people)
    if (!o.alive || o.kind === 'door' || Math.abs(o.y - (T.S.y + T.TT)) > 0.6) return;
    const l = twLocal(T, o.x, o.z);
    if (Math.abs(l.x) > T.HO + 0.2 || Math.abs(l.z) > T.HO + 0.2) return;
    if (o.motion && o.motion.kind === 'ladder') { ladderKnockOff(o, null); return; }
    o.motion = { kind: 'ladder', L: T.ladders[0], st: 3, t: 0, vy: 0.4, y0: o.y, by: null, dx: 0, dz: 0, dir: 1 };
  });
  for (let i = 0; i < 8; i++) later(i * 0.1, () => FX.dust(T.wx + (Math.random() - 0.5) * T.RO * 2, T.S.y + T.H + Math.random() * 4, T.wz + (Math.random() - 0.5) * T.RO * 2, 16, wallLit([0.22, 0.19, 0.17]))); // [siege2] RO: a drum's too
  const P = GAME.player;
  if (P && dist2(P.x, P.z, T.wx, T.wz) < 80 * 80) { sfx('crash'); cameraShake(0.35, T.wx, T.wz); uiLog(T.look === 'rath' ? `The burning thatch of a tower of ${T.S.name} falls in!` : `The burning tower of ${T.S.name} falls in!`, 'warn'); } // [siege2]
  TFIRE.dirty.add(T.C);
}
// built back: the gallery, the roof and the ladder stand again
function towerRebuilt(T) {
  T.fallen = null; T.char = 0; T.fresh = 1;
  for (const f of T.topFloors || []) f.active = true;
  for (const c of T.topColls || []) c.active = true;
  const top = T.look === 'rath' ? null : T.ladders.find((L) => L.gone); // [siege2] a rath's ladder never went with its cone
  if (top) { top.gone = false; if (top.hatch) { top.hatch.gone = false; top.hatch.floor.active = top.hatch.k < 0.25; } } // [walls]
  if (T.heap) T.heap.visible = false;
  TFIRE.stats.rebuilt++;
  const K = T.S.keepRef;
  if (K) news(T.look === 'rath' ? `${T.S.name} has thatched a burnt tower again.` : `${T.S.name} has rebuilt a burnt tower.`, K.realm, 'normal'); // [siege2]
  TFIRE.dirty.add(T.C);
}

// each step (updateTowers asks)
function updateTowerFires(dt) {
  for (const T of TOWER.list) {
    if (T.look !== 'timber' && T.look !== 'rath') continue; // [siege2] and Eriu's thatched cones
    if (T.fresh > 0) { T.fresh = Math.max(0, T.fresh - dt / 140); if (Math.floor(T.fresh * 40) !== Math.floor((T.fresh + dt / 140) * 40)) TFIRE.dirty.add(T.C); }
    const B = T.burn;
    if (B) {
      B.t += dt;
      // rain damps a fire: a young one goes out in a downpour, a grown one only burns slower
      const wet = clamp(U.uWet.value, 0, 1) * (0.4 + 0.6 * clamp(WEATHER.raining || 0, 0, 1));
      B.heat = clamp(B.heat + dt * (1 / TFIRE.climb) * (1 - 1.4 * wet), 0, 1);
      T.char = Math.max(T.char || 0, clamp(B.t / TFIRE.burn, 0, 1) * 0.9 + B.heat * 0.1);
      if (B.heat <= 0) { for (const f of B.fires) f.until = GAME.t; T.burn = null; TFIRE.stats.out++; TFIRE.dirty.add(T.C); continue; }
      // flames up to the height the fire has climbed to, more of them as it takes hold
      const spots = towerFireSpots(T), top = B.y0 + (T.apex - B.y0) * B.heat, want = Math.round(2 + B.heat * (spots.length - 2));
      if (GAME.t > B.tick) {
        B.tick = GAME.t + 1.0;
        B.fires = B.fires.filter((f) => f.until > GAME.t);
        let lit = B.fires.length;
        for (const s of spots) {
          if (lit >= want) break;
          if (s.y > top + 0.5 || s.lit > GAME.t) continue;
          s.lit = GAME.t + 4;
          addFire(s.x, T.S.y + s.y, s.z, s.s * (0.7 + 0.5 * B.heat), false, GAME.t + 4.2, { r: 9, k: 1.3 });
          B.fires.push(FIRES[FIRES.length - 1]);
          lit++;
        }
        // whoever is in its rooms or its gallery is burnt
        forNear(T.wx, T.wz, T.RO + 1, (o) => {
          if (!o.alive || o.kind === 'door' || o.y - T.S.y > top + 1) return;
          if (T.look === 'rath' && o.y - T.S.y < T.TT - 0.5) return; // [siege2] under a burning cone: its platform
          const l = twLocal(T, o.x, o.z);
          if (Math.abs(l.x) > T.RO || Math.abs(l.z) > T.RO) return;
          addBuff(o, 'burn', o.maxHp * TFIRE.harm * B.heat, 2, null);
          if (o === GAME.player && !B.told) { B.told = true; uiLog('The tower is burning around you. Get out!', 'hurt'); }
        });
        if (Math.random() < 0.5 * B.heat) fireLandsAt(T.wx + (Math.random() - 0.5) * 6, T.S.y + 0.5, T.wz + (Math.random() - 0.5) * 6, 1.2, null); // embers set the grass and what stands near alight
        TFIRE.dirty.add(T.C);
      }
      if (B.t >= TFIRE.burn) towerFallIn(T);
      continue;
    }
    const Fl = T.fallen;
    if (Fl) {
      Fl.t += dt;
      // [walls] the embers in the char fade over a couple of minutes (faster in rain), smoke rising from the shell
      if (Fl.ember > 0) {
        const was = Fl.ember;
        Fl.ember = Math.max(0, Fl.ember - dt / 130 * (1 + 2 * clamp(WEATHER.raining || 0, 0, 1)));
        if (Math.floor(was * 40) !== Math.floor(Fl.ember * 40)) TFIRE.dirty.add(T.C);
        if (fxAlpha && T.smokeAt !== renderTime && Math.random() < 0.15 * Fl.ember && dist2(T.wx, T.wz, camera.position.x, camera.position.z) < 120 * 120) { // at most a puff a frame drawn (the puffs age with the frames)
          T.smokeAt = renderTime;
          const g = 0.16 + Math.random() * 0.1;
          fxAlpha.emit(T.wx + (Math.random() - 0.5) * T.RO * 1.6, T.S.y + T.TT - 0.8 + (T.look === 'rath' ? 1.6 : 0), T.wz + (Math.random() - 0.5) * T.RO * 1.6, (Math.random() - 0.5) * 0.4, 1.2 + Math.random(), (Math.random() - 0.5) * 0.4, 4 + Math.random() * 3, g, g * 0.95, g * 0.9, -(0.9 + Math.random() * 0.8), -0.15, 0.5);
        }
      }
      const K = T.S.keepRef;
      if (K && GAME.t - K.lastEnemyNear < TFIRE.quiet) { Fl.quiet = 0; continue; }
      Fl.quiet += dt;
      if (Fl.quiet < 2) continue;
      const was = Fl.r;
      Fl.r = Math.min(1, Fl.r + dt / TFIRE.rebuild);
      Fl.fresh = Math.min(1, Fl.r * 3);
      T.char = Math.max(0, 1 - Fl.r * 1.5);
      if (Math.floor(was * 60) !== Math.floor(Fl.r * 60)) TFIRE.dirty.add(T.C);
      if (Fl.r >= 1) towerRebuilt(T);
    }
  }
  if (TFIRE.dirty.size) { for (const C of TFIRE.dirty) castleTowerUpload(C); TFIRE.dirty.clear(); }
}

// E with a burning brand by the logs of a timber tower
function towerFireOffers(P, offer) {
  if (!P.brand || P.motion) return;
  palisadeFireOffers(P, offer); // [siege2] a burh's palisade (04g_burn.js)
  for (const T of TOWER.list) {
    if (T.look === 'rath') { if (!T.burn && !T.fallen && dist2(P.x, P.z, T.wx, T.wz) < (T.RO + 0.4) ** 2 && Math.abs(P.y - (T.S.y + T.TT)) < 0.8) offer(0.2, 1.8, 'Set the thatch alight', () => { towerIgnite(T, T.TT + 2); }, 0.12); continue; } // [siege2] on an Eriu tower's platform, under its cone
    if (T.look !== 'timber' || T.burn || T.fallen) continue;
    if (Math.abs(P.x - T.wx) > T.HO + 3 || Math.abs(P.z - T.wz) > T.HO + 3) continue;
    const l = twLocal(T, P.x, P.z), d = Math.max(Math.abs(l.x), Math.abs(l.z)) - T.HO;
    if (P.y - T.S.y > T.TT + 2) continue;
    const inside = d < -(T.HO - T.HI);
    offer(Math.max(0.05, Math.abs(d)), 1.6, 'Set the tower alight', () => { towerIgnite(T, P.y - T.S.y + 1.2); }, inside ? 0.1 : 0.15);
  }
}

// the charred timbers heaped in the room below a fallen gallery (hidden until then)
function towerHeaps() {
  for (const T of TOWER.list) {
    if (T.look === 'rath') { towerConeHeap(T); continue; } // [siege2] a fallen cone's thatch and poles on the platform
    if (T.look !== 'timber') continue;
    const b = new Batch(), M = T.C.M, r = mulberry(Math.round(Math.abs(T.wx * 13 + T.wz * 7)) + 5);
    for (let i = 0; i < 22; i++) {
      const x = T.cx + (r() - 0.5) * T.HI * 1.6, z = T.cz + (r() - 0.5) * T.HI * 1.6, L = 0.8 + r() * 2.2;
      b.add(i % 3 ? G.box : G.cyl8, lm(M, x, T.H + 0.08 + r() * 0.35, z, r() * TAU, i % 3 ? 0.18 : 0.13, i % 3 ? 0.12 : L, i % 3 ? L : 0.13, (r() - 0.5) * 0.5, i % 3 ? 0 : Math.PI / 2 + (r() - 0.5) * 0.4), MAT.logH, [0.07 + r() * 0.05, 0.06 + r() * 0.04, 0.05 + r() * 0.03]);
    }
    for (let i = 0; i < 9; i++) { const x = T.cx + (r() - 0.5) * T.HI * 1.5, z = T.cz + (r() - 0.5) * T.HI * 1.5; b.add(G.box, lm(M, x, T.H + 0.04, z, r() * TAU, 0.5 + r() * 0.6, 0.04, 0.3 + r() * 0.4), MAT.shingle, [0.09, 0.08, 0.07]); }
    const m = new THREE.Mesh(b.build(), buildingMat);
    m.visible = false; m.renderOrder = 1;
    scene.add(m);
    shadowCaster(m, BUILDING_DEPTH);
    T.heap = m;
  }
}

// [siege2] does fire landing at (x, y, z) with reach r touch an Eriu tower's thatched cone or the posts under it?
function towerConeHit(T, x, y, z, r) {
  if (!T.eave || y < T.S.y + T.TT + 0.3 || y > T.S.y + T.apex + 1) return false;
  const d = dist(x, z, T.wx, T.wz), h = y - T.S.y - T.eave, rr = h > 0 ? (T.RO + 0.55) * (1 - Math.min(1, h / 3.6)) : T.RO;
  return d < rr + Math.max(0.6, r * 0.6) + 0.3;
}
// [siege2] the charred thatch and poles of a fallen cone, heaped on its platform (hidden until then)
function towerConeHeap(T) {
  const b = new Batch(), M = T.C.M, r = mulberry(Math.round(Math.abs(T.wx * 11 + T.wz * 5)) + 9);
  for (let i = 0; i < 14; i++) {
    const a = r() * TAU, rr = Math.sqrt(r()) * (T.RO - 0.6), p = twP(T, a, rr), L = 0.8 + r() * 1.8;
    b.add(G.cyl8, lm(M, p.x, T.TT + 0.1 + r() * 0.25, p.z, r() * TAU, 0.07, L, 0.07, Math.PI / 2 + (r() - 0.5) * 0.5), MAT.logH, [0.06 + r() * 0.04, 0.05 + r() * 0.03, 0.045 + r() * 0.03]);
  }
  for (let i = 0; i < 12; i++) { const a = r() * TAU, rr = Math.sqrt(r()) * (T.RO - 0.5), p = twP(T, a, rr); b.add(G.ico, lm(M, p.x, T.TT + 0.04, p.z, r() * 3, 0.5 + r() * 0.5, 0.08 + r() * 0.1, 0.4 + r() * 0.5), MAT.thatch, [0.11 + r() * 0.05, 0.1 + r() * 0.04, 0.08 + r() * 0.03]); }
  const m = new THREE.Mesh(b.build(), buildingMat);
  m.visible = false; m.renderOrder = 1;
  scene.add(m);
  shadowCaster(m, BUILDING_DEPTH);
  T.heap = m;
}

// save part world.x.towerfire: which towers burn or lie fallen, how far their rebuilding has come
queueMicrotask(() => registerSavePart('world', 'towerfire', {
  save() {
    const out = [];
    TOWER.list.forEach((T, i) => { if ((T.look === 'timber' || T.look === 'rath') && (T.burn || T.fallen)) out.push([i, T.burn ? 1 : 2, +(T.burn ? T.burn.t : T.fallen.r).toFixed(2)]); }); // [siege2] a rath's cone too
    return out.length ? out : undefined;
  },
  load(d) {
    if (!Array.isArray(d)) return;
    for (const q of d.slice(0, 64)) {
      if (!Array.isArray(q)) continue;
      const T = TOWER.list[q[0] | 0], v = +q[2];
      if (!T || (T.look !== 'timber' && T.look !== 'rath') || !isFinite(v)) continue; // [siege2]
      if (q[1] === 1) { towerIgnite(T, T.look === 'rath' ? T.TT + 2 : 3); T.burn.t = clamp(v, 0, TFIRE.burn - 1); T.burn.heat = clamp(v / TFIRE.climb, 0.1, 1); }
      else if (q[1] === 2) { T.burn = { t: 0, heat: 0, fires: [] }; towerFallIn(T); T.fallen.r = clamp(v, 0, 0.99); T.fallen.ember = 0; } // [walls] gone cold
    }
  },
  key(d) { return d ? d.map((q) => q[0] * 10 + q[1]).join(',') : ''; },
}));
queueMicrotask(() => { if (window.__hm) window.__hm.towerfire = { TFIRE, towerIgnite, towerFireAt, towerFireCone, towerFallIn, towerRebuilt, updateTowerFires, castleTowerUpload, towerFireOffers, list: () => TOWER.list.filter((T) => T.look === 'timber') }; });
