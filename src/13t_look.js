/* ================================================================== */
/* [look] the whole world as a player sees it (version 12)             */
/* ================================================================== */
// Fixes found by looking at every kind of place at once (tools/tests/look.py), each at its cause; this module holds
// the ones that are new code rather than a small change where the fault was.
//
// The towns' own ground. The houses stood in knee-high meadow right up to their doors, with no way to them, and the
// meadow ended in a wall of blades round the plaza. Now the green between the plaza and the houses is kept short
// (trodden and grazed, a little longer in patches), each house stands in its worn toft, and a footpath of bare earth
// runs from each door to the plaza. It is drawn through two maps the grass and the ground already read, so nothing
// placed moves and nothing saved changes (W.road and W.grass are as they were):
//   - the cover map (1 m, 03_terrain.js): a value under the solid threshold (0.3) now shortens the blades and the
//     flowers' stems (0.25 a lawn, about a third of the meadow's height); a path's 0.38 grows none. Under 100 of 255,
//     so a path can still be tilled; the foot of every wall gets the same short fringe from the map's own ramp;
//   - the road channel of the world texture (2 m): the terrain shader's dirt, ruts and trodden verge along each path.
const LOOK = { towns: [], painted: false };
const LOOK_GREEN = 64, LOOK_PATH = 96;
// each town's plan: its green, the tofts round its houses and the paths from the doors to the plaza
function lookTownPlan() {
  if (LOOK.towns.length) return LOOK.towns;
  for (const R of REALMS) {
    const S = R.town, T = { S, realm: R.id, r0: 35, r1: 44, paths: [], houses: [] };
    for (const H of HOUSES) {
      if (H.keepHall || H.S !== S) continue;
      T.houses.push(H);
      const D = H.door, o = D.out, dx = S.x - o.x, dz = S.z - o.z, d = Math.hypot(dx, dz) || 1;
      // from the doorstep straight out to the plaza's edge (the doors face the plaza)
      const end = Math.max(0, d - 12.5);
      T.paths.push({ ax: D.c.x, az: D.c.z, bx: o.x + dx / d * end, bz: o.z + dz / d * end, w: H.big ? 1.9 : 1.5, house: H.num });
    }
    LOOK.towns.push(T);
  }
  return LOOK.towns;
}
const lookSegD = (x, z, P) => Math.sqrt(segDist2(x, z, P.ax, P.az, P.bx, P.bz));
// the cover map's share (buildCoverMask calls this last; it only ever raises a texel, so walls and floors stay solid)
function lookCoverAll() {
  // The meadow grows round a bush as round a trunk: its collider cleared a bald disc of turf wider than the bush, a
  // flat pale patch in the grass (and with the bush itself missing for a moment after a jump, a patch of nothing). The
  // wild herbs were placed off the cover map with the bushes in it (08h_farming.js farmPlaceHerbs, saved by number),
  // so the bushes leave it only once the herbs stand: the first cover map after that is drawn again without them
  if (!COVER_SKIP.has('bush') && typeof FARM !== 'undefined' && FARM.herbs && FARM.herbs.length) { COVER_SKIP.add('bush'); buildCoverMask(); return; }
  const R = COVER.res, data = COVER.data;
  for (const T of lookTownPlan()) {
    const S = T.S, rad = T.r1 + 2;
    const i0 = Math.max(0, Math.floor(S.x - rad + 512)), i1 = Math.min(R - 1, Math.ceil(S.x + rad + 512));
    const j0 = Math.max(0, Math.floor(S.z - rad + 512)), j1 = Math.min(R - 1, Math.ceil(S.z + rad + 512));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const x = i - 512 + 0.5, z = j - 512 + 0.5, k = j * R + i;
      if (data[k] >= LOOK_PATH) continue;
      // the green: short turf, longer in patches and toward its ragged edge; never over the fields or the water
      const d = Math.hypot(x - S.x, z - S.z) + (vnoise(x * 0.11 + 3.1, z * 0.11 - 7.7) - 0.5) * 7;
      let v = 0;
      if (d < T.r1 && sampleGrid(W.field, x, z) < 0.05 && !waterAt(x, z)) {
        const patch = 0.72 + 0.28 * sstep(0.35, 0.7, vnoise(x * 0.23 - 11.0, z * 0.23 + 5.0));
        v = LOOK_GREEN * patch * sstep(T.r1, T.r0, d);
      }
      // each house's toft: worn turf close round it
      for (const H of T.houses) {
        const l = houseL(H, x, z);
        const out = H.round ? Math.hypot(l.x, l.z) - H.r : Math.max(Math.abs(l.x) - H.w / 2, Math.abs(l.z) - H.d / 2);
        if (out < 2.6) v = Math.max(v, LOOK_GREEN * (0.85 + 0.15 * sstep(2.6, 0.8, out)));
      }
      // the paths: bare earth
      for (const P of T.paths) { const pd = lookSegD(x, z, P); if (pd < P.w / 2) v = Math.max(v, LOOK_PATH); else if (pd < P.w / 2 + 0.8) v = Math.max(v, LOOK_GREEN); }
      if (v > data[k]) data[k] = Math.round(v);
    }
  }
  // the gardens fenced behind some houses: their beds of soil are a thin box on the ground with no collider, and the
  // meadow grew up through them (and through the rows of greens)
  for (const R of REALMS) for (const p of R.town.props || []) {
    if (p.type !== 'garden') continue;
    coverBox(p.x, p.z, p.w / 2, p.d / 2, Math.cos(p.yaw), Math.sin(p.yaw), 0.15);
  }
  // the road channel of the world texture: dirt along the paths (2 m texels; only ever raised)
  const A = U.uWorldA.value && U.uWorldA.value.image && U.uWorldA.value.image.data;
  if (A && !LOOK.painted) {
    LOOK.painted = true;
    for (const T of LOOK.towns) for (const P of T.paths) {
      const x0 = Math.min(P.ax, P.bx) - 3, x1 = Math.max(P.ax, P.bx) + 3, z0 = Math.min(P.az, P.bz) - 3, z1 = Math.max(P.az, P.bz) + 3;
      for (let j = Math.max(0, Math.floor((z0 + HALF) / HS)); j <= Math.min(HN - 1, Math.ceil((z1 + HALF) / HS)); j++) {
        for (let i = Math.max(0, Math.floor((x0 + HALF) / HS)); i <= Math.min(HN - 1, Math.ceil((x1 + HALF) / HS)); i++) {
          const x = -HALF + i * HS, z = -HALF + j * HS, k = j * HN + i, pd = lookSegD(x, z, P);
          const v = Math.round(255 * 0.5 * sstep(P.w / 2 + 1.3, P.w / 2 - 0.2, pd));
          if (v > A[k * 4]) A[k * 4] = v;
        }
      }
    }
    U.uWorldA.value.needsUpdate = true;
  }
}
// The camera under a tower's roof. On the fighting gallery of a Thule tower (shingles) or an Ériu platform (thatch),
// the play camera rose out past the eaves and looked down on the roof: the player and the fight were hidden under it.
// While the player stands on a roofed top, the camera keeps under its eaves (returns the height to keep it below, or
// null), as the Barrow's roof keeps it under the stones (asked by updateCamera, 09_player.js)
function lookTowerCamCap(P) {
  if (typeof TOWER === 'undefined' || !TOWER.list.length || !P || P.x > DUN_X0) return null;
  for (const T of TOWER.list) {
    if (T.eave == null || Math.abs(P.x - T.wx) > T.RO + 1 || Math.abs(P.z - T.wz) > T.RO + 1) continue;
    const l = twLocal(T, P.x, P.z);
    if (!twInside(T, l.x, l.z, (T.RO - (T.RI || T.HI || 0)) + 0.4)) continue;
    const y = P.y - T.S.y;
    if (y < T.TT - 0.5 || y > T.eave) continue;
    return T.S.y + T.eave - 0.35;
  }
  return null;
}
// test hooks (tools/tests/look.py)
queueMicrotask(() => { if (window.__hm) window.__hm.lookx = { LOOK, lookTownPlan, lookCoverAll, cover: (x, z) => { const i = Math.floor(x + 512), j = Math.floor(z + 512); return COVER.data[j * COVER.res + i] / 255; } }; });
