/* ================================================================== */
/* [siege2] stones that strike a house break it                        */
/* ================================================================== */
// A siege stone that meets a house in its flight (wallsStoneStep: the house's wall or its roof) or a meteor that falls
// on or beside one (houseBlowAt) batters it: its walls crack more with each blow (the house shader's uHD.w: long jagged
// cracks, grit and dust in the stone, plaster or daub), a blow from above knocks a hole in its roof where it lands
// (uHD.xyz: the covering and its timbers gone round the strike, their broken ends dark; the rain falls in through it,
// GLSL_ROOFS, and wets the floor under it), and enough of them bring it down: the roof falls into the shell and it lies
// a ruin of broken timber and rubble (not burnt), which the townsfolk clear and build back behind scaffolding as after a
// fire (houseRuinStep, houseScaffoldStep). The keeps' halls are houses and take it too, more slowly. Saved with the
// world (save part world.x.batter). The shared files only call in, each line marked [siege2]:
//   04e_houses.js  the house shader (uHD: houseBatter, the hole), houseRoofsForRain and GLSL_ROOFS (uRoofD), houseRoofOver,
//                  houseScaffoldStep, houseRestore
//   04h_siege.js   siegeImpact -> houseStoneHit · 07_entities.js meteor -> houseBlowAt

const BATTER = { stats: { hits: 0, holes: 0, fell: 0, meteors: 0 } };
// how much a blow of one unit of an engine's might (a mangonel's stone is 2.6, a trebuchet's 4.4) batters a house
const BATTER_K = 0.085;

// how much a house stands: a hall of stone most, then stone and plaster, timber, a roundhouse of wattle and daub
function houseToughness(H) { return H.keepHall ? (H.style === 'stone' ? 2.0 : 1.6) : H.style === 'round' ? 0.85 : H.style === 'timber' ? 1.0 : 1.15; }
// is (x, z) under the house's roof, and where is the nearest point of the roof to it?
function houseRoofPoint(H, x, z) {
  const l = houseL(H, x, z);
  if (H.round) {
    const r = Math.hypot(l.x, l.z), lim = Math.max(0.2, H.Rr - 0.9);
    if (r > lim) { l.x *= lim / r; l.z *= lim / r; }
  } else {
    l.x = clamp(l.x, -H.w / 2 + 0.7, H.w / 2 - 0.7); l.z = clamp(l.z, -H.d / 2 + 0.7, H.d / 2 - 0.7);
  }
  return houseW(H, l.x, l.z);
}
// a heavy blow lands on a house at (x, y, z): mult is the might of the blow; from above it holes the roof
function houseStoneHit(H, x, y, z, mult = 1, src = null, fromAbove = null) {
  if (!H || (H.state !== 'whole' && H.state !== 'burning')) return false;
  const b = H.bat || (H.bat = { k: 0, hx: 0, hz: 0, hr: 0, fell: false });
  BATTER.stats.hits++;
  b.k = clamp(b.k + (BATTER_K * mult) / houseToughness(H), 0, 1);
  const top = fromAbove ?? y > H.y + H.wallH - 0.3;
  const near = dist2(H.x, H.z, camera.position.x, camera.position.z) < 90 * 90;
  if (top && houseIntact(H)) {
    // a hole in the roof where it struck (a second blow nearby makes it bigger)
    const p = houseRoofPoint(H, x, z);
    if (b.hr > 0 && dist(p.x, p.z, b.hx, b.hz) < b.hr + 1.6) { b.hr = Math.min(H.round ? H.Rr * 0.55 : 1.9, b.hr + 0.3 + 0.05 * mult); }
    else if (b.hr < 0.01 || Math.random() < 0.5) { b.hx = p.x; b.hz = p.z; b.hr = Math.min(1.4, 0.55 + 0.08 * mult); BATTER.stats.holes++; }
    if (near) {
      const roofCol = H.style === 'round' ? [0.62, 0.52, 0.3] : H.style === 'timber' ? [0.32, 0.24, 0.17] : [0.34, 0.36, 0.42];
      siegeDebris(b.hx, H.y + H.wallH + 0.8, b.hz, 26, wallLit(roofCol), 6, 5);
      siegeDebris(b.hx, H.y + H.wallH + 0.5, b.hz, 10, wallLit([0.38, 0.27, 0.17]), 4, 3);
      FX.dust(b.hx, H.y + H.wallH + 0.5, b.hz, 20, wallLit(H.style === 'round' ? [0.55, 0.47, 0.3] : [0.46, 0.43, 0.39]));
      FX.dust(b.hx, H.y + 0.6, b.hz, 12, wallLit([0.42, 0.38, 0.33])); // and inside, down onto the floor
    }
  } else if (near) {
    FX.dust(x, y, z, 22, wallLit(H.style === 'round' ? [0.55, 0.48, 0.36] : H.style === 'timber' ? [0.4, 0.32, 0.22] : [0.58, 0.55, 0.5]));
    siegeDebris(x, y, z, 16, wallLit(H.style === 'round' ? [0.5, 0.42, 0.3] : [0.55, 0.52, 0.47]), 4, 4);
  }
  if (b.k >= 1) houseBreak(H, src);
  return true;
}
// a meteor (or anything that falls from the sky with its own might) lands at (x, z) with reach r
function houseBlowAt(src, x, z, r, mult) {
  let n = 0;
  for (const H of HOUSES) {
    if (H.state !== 'whole' && H.state !== 'burning') continue;
    if (dist2(x, z, H.x, H.z) > (H.foot + r) ** 2) continue;
    const d = dist(x, z, H.x, H.z), k = clamp(1 - Math.max(0, d - H.foot * 0.5) / (r + H.foot * 0.5), 0.2, 1);
    if (houseStoneHit(H, x, H.y + H.top, z, mult * k, src, d < H.foot)) { n++; BATTER.stats.meteors++; }
  }
  return n;
}
// enough blows: the roof falls into the shell and the house lies a ruin of broken timber and rubble, not burnt
function houseBreak(H, src = null) {
  if (H.state === 'burning') { houseCollapse(H); if (H.bat) H.bat.k = 1; BATTER.stats.fell++; return; } // already afire: it falls in burning
  if (H.state !== 'whole') return;
  const b = H.bat || (H.bat = { k: 1, hx: 0, hz: 0, hr: 0, fell: false });
  b.fell = true; b.k = 1; b.hr = 0;
  H.state = 'ruin'; H.stT = 0; H.fall = 0; H.char = 0.1; H.ember = 0;
  H.burn = { x: H.x, z: H.z, R: 0, maxR: 0, dur: 1, speed: 0, fallAt: 0, pts: [], smoulder: [] };
  houseHearthOut(H);
  for (const L of houseLeavesOf(H)) { L.open = 0; L.target = 0; }
  for (const win of H.wins) win.target = 0;
  BATTER.stats.fell++;
  // whoever is inside is struck by the falling roof
  forNear(H.x, H.z, H.foot, (e) => {
    if (!e.alive || e.kind === 'door' || e.flying || !houseHas(H, e.x, e.z, -0.2)) return;
    const d = e.maxHp * (e.role === 'player' ? 0.18 : 0.3);
    dealDamage(src && src.alive ? src : e, e, d, { kind: 'aoe', siege: true });
  });
  const cy = H.y + H.wallH * 0.6;
  if (dist2(H.x, H.z, camera.position.x, camera.position.z) < 120 * 120) {
    FX.dust(H.x, H.y + 0.5, H.z, 40, wallLit([0.5, 0.46, 0.4]));
    for (let k = 0; k < 6; k++) later(k * 0.1, () => FX.dust(H.x + (Math.random() - 0.5) * H.foot, cy + Math.random() * 2, H.z + (Math.random() - 0.5) * H.foot, 16, wallLit([0.46, 0.42, 0.37])));
    siegeDebris(H.x, cy, H.z, 40, wallLit(H.style === 'round' ? [0.6, 0.5, 0.32] : [0.4, 0.38, 0.38]), 6, H.foot);
    cameraShake(0.35, H.x, H.z);
  }
  houseSfx('collapse', H.x, cy, H.z);
  const P = GAME.player;
  if (P && dist2(P.x, P.z, H.x, H.z) < 90 * 90) uiLog(H.keepHall ? `The great hall of ${H.S.name} falls in under the stones!` : `A house in ${H.S.name} falls in under the stones!`, 'warn');
}
// the house shader's view of the battering (drawHouses): x, z, radius of the hole in the roof, and how battered
// (+2 once it fell to stones: a ruin of rubble, not soot)
function houseBatterUniform(H, v) {
  const b = H.bat;
  if (!b) { v.set(0, 0, 0, 0); return; }
  v.set(b.hx, b.hz, houseIntact(H) ? b.hr : 0, clamp(b.k, 0, 0.999) + (b.fell ? 2 : 0));
}
// is (x, z) under the hole in this house's roof? (the rain falls in there)
const houseHoled = (H, x, z) => !!(H && H.bat && H.bat.hr > 0.01 && houseIntact(H) && dist2(x, z, H.bat.hx, H.bat.hz) < H.bat.hr * H.bat.hr);

/* ------------------------------------------------------------------ */
/* arrows stuck in a door swing with it                                */
/* ------------------------------------------------------------------ */
// (wallStick, 07g_walls.js) the door a collider is the leaf of: a house's (its closed door or its open leaf), a tower's;
// the arrow is kept in the leaf's own frame and drawn where the leaf now is (wallDoorPose)
const _wdM = new THREE.Matrix4(), _wdV = new THREE.Vector3();
function wallDoorRec(c, x, y, z, dx, dy, dz) {
  if (c.tag === 'build' && c.build && c === c.build.leafColl) return buildDoorRec(c.build, x, y, z, dx, dy, dz); // [siege3] a built door's or gate's leaf (04j_rafters.js)
  if (c.tag === 'hdoor' || c.tag === 'prop') {
    const H = c.tag === 'hdoor' ? wallHouseOf(c) : null;
    if (H && (c === H.door.coll || c === H.door.collLeaf)) {
      const L = H.door.leaf, a = -smooth(L.open) * L.swing, ca = Math.cos(a), sa = Math.sin(a), ox = x - L.hx, oz = z - L.hz;
      return { L, H, lx: ox * ca + oz * sa, lz: -ox * sa + oz * ca, y, ldx: dx * ca + dz * sa, ldz: -dx * sa + dz * ca, dy, gone: () => !houseIntact(H) };
    }
    const D = TOWER.doors.find((q) => q.coll === c || q.leafColl === c);
    if (D) {
      _wdM.copy(D.part.frame()).invert();
      const p = _wdV.set(x, y, z).applyMatrix4(_wdM), lp = [p.x, p.y, p.z];
      const q = _wdV.set(dx, dy, dz).transformDirection(_wdM), ld = [q.x, q.y, q.z];
      return { D, lp, ld, gone: () => !!D.gone };
    }
  }
  return null;
}
const _wdOut = { x: 0, y: 0, z: 0, dx: 0, dy: 0, dz: 0 };
function wallDoorPose(r) {
  const o = _wdOut;
  if (r.L) {
    const L = r.L, a = smooth(L.open) * L.swing, ca = Math.cos(a), sa = Math.sin(a);
    o.x = L.hx + r.lx * ca + r.lz * sa; o.z = L.hz - r.lx * sa + r.lz * ca; o.y = r.y;
    o.dx = r.ldx * ca + r.ldz * sa; o.dz = -r.ldx * sa + r.ldz * ca; o.dy = r.dy;
    return o;
  }
  const M = r.D.part.frame();
  const p = _wdV.set(r.lp[0], r.lp[1], r.lp[2]).applyMatrix4(M); o.x = p.x; o.y = p.y; o.z = p.z;
  const q = _wdV.set(r.ld[0], r.ld[1], r.ld[2]).transformDirection(M); o.dx = q.x; o.dy = q.y; o.dz = q.z;
  return o;
}

// save part world.x.batter: each battered house, how far, its hole, and whether it fell to stones
queueMicrotask(() => registerSavePart('world', 'batter', {
  save() {
    const out = [];
    for (const H of HOUSES) { const b = H.bat; if (b && (b.k > 0.005 || b.fell)) out.push([H.num, Math.round(b.k * 100), +b.hx.toFixed(1), +b.hz.toFixed(1), Math.round(b.hr * 100), b.fell ? 1 : 0]); }
    return out.length ? out : undefined;
  },
  load(d) {
    if (!Array.isArray(d)) return;
    for (const q of d.slice(0, 200)) {
      if (!Array.isArray(q)) continue;
      const H = HOUSES[q[0] | 0];
      if (!H || !isFinite(+q[1])) continue;
      const fell = q[5] === 1, hx = +q[2], hz = +q[3], hr = +q[4] / 100;
      H.bat = { k: clamp(+q[1] / 100, 0, 1), hx: isFinite(hx) ? hx : H.x, hz: isFinite(hz) ? hz : H.z, hr: isFinite(hr) && dist(hx, hz, H.x, H.z) < H.foot + 1 ? clamp(hr, 0, 2.5) : 0, fell };
      // a house brought down by stones was put back as a ruin of a fire (world.land): it does not smoulder
      if (fell && (H.state === 'ruin' || H.state === 'scaffold') && H.burn) {
        for (const s of H.burn.smoulder || []) houseFireOut(s.f);
        H.burn.smoulder = [];
        H.ember = 0;
        if (H.state === 'ruin') H.char = 0.1;
      }
      if (H.state === 'whole' && fell) H.bat.fell = false;
    }
  },
  key(d) { return d ? d.map((q) => q[0] * 1000 + (q[1] >> 3) + q[5] * 500).join(',') : ''; },
}));
queueMicrotask(() => { if (window.__hm) window.__hm.batter = { BATTER, houseStoneHit, houseBlowAt, houseBreak, houseHoled, houseRoofPoint, doorPose: wallDoorPose, doorRec: wallDoorRec }; });
