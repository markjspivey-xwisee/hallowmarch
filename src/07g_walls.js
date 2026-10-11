/* ================================================================== */
/* [walls] what flies stops at what it hits                            */
/* ================================================================== */
// Arrows, bolts and spells in flight, the archers' drawn arrows and the engines' stones meet what stands in their
// way: the walls of keeps and temples, the towers, palisades, parapets and gates, houses and halls (their walls and
// roofs), what has been built, doors and shutters, rocks, the floors of walks, rooms and stairs, and the ground. One
// swept test (shotHit) takes a step of a flight, a segment from where the shot was to where it is now, and finds the
// first thing it crosses: every collider near it (COLL) between its own heights (baseY, h; y0 for those up on a wall,
// `vert`), every floor (FLOOR: walks, stairs, the rooms and tops of the towers, a shut hatch), each house's walls up to
// its eaves and gables and its roof as a shell, and the ground. Openings let a shot through: a crenel above the
// breastwork, an arrow slit, a window with its shutters open, an open door (its collider stands down). A body up on a
// wall shoots out through the crenel or slit before it (the shooter's own embrasure), and one that stands at the
// parapet shows itself at its crenel, where a foe below can strike it (aimed at its head: wallsAimY).
// What a shot does there: an arrow sticks in wood, thatch, daub and earth (it stays for a while, drawn with the
// arrows in flight) and glances off stone, slate and iron (sparks, a ricochet, and it lies where it falls); a spell
// bursts on the wall it meets, and a fire spell or a burning arrow sets thatch and timber alight through fireLandsAt
// with its caster (so the garrison's own fire spares its own roofs, as before). A stone from an engine cracks what it
// hits first (castleSiegeHit at that point: a stretch of curtain, a tower: towerSiegeHit). NPCs do not loose a shot
// that would only strike a wall (wallsShotClear in autoAttack and npcAbilities); they close in instead (fightTarget),
// so the March's fights go on as before where nothing stands between. Trees and bushes are left out: their crowns let
// a shot through, and fights in the woods keep their pace. Test hooks: __hm.walls.

const WALLS = { on: true, stuck: [], fall: [], houseOf: null, stats: { tests: 0, hits: 0, stuck: 0, glanced: 0, burst: 0, slits: 0, crenels: 0, windows: 0, embrasure: 0, shows: 0, held: 0, stones: 0, ground: 0, roofs: 0, floors: 0, fired: 0 } };
const WALL_STUCK_MAX = 96, WALL_STUCK_LIFE = 150;
// tags a shot passes: the trunks and crowns of trees, bushes, fire pits
const WALL_SOFT = { tree: 1, bush: 1, fire: 1 };
// what an arrow glances off
const WALL_GLANCE = { stone: 1, slate: 1, metal: 1 };
const WALL_PROJ_SKIP = { meteor: 1 }; // falls from the sky onto its mark (its blow is struck there, castleSiegeHit)

/* ------------------------------------------------------------------ */
/* what a thing is made of                                             */
/* ------------------------------------------------------------------ */
function wallCastleNear(x, z) {
  for (const C of CASTLES) if (dist2(x, z, C.S.x, C.S.z) < 27 * 27) return C;
  return null;
}
function wallMatOf(c, y) {
  if (c.tower) { const T = c.tower; return T.look === 'timber' && y > T.S.y + 1.8 ? 'logs' : 'stone'; } // a timber shaft stands on a stone footing
  if (c.build) { const t = c.build.t; return t === 'wallStone' || t === 'found' || t === 'well' ? 'stone' : 'wood'; }
  if (c.wm) return c.wm;
  let m = 'wood';
  switch (c.tag) {
    case 'rock': case 'stone': case 'pillar': case 'altar': case 'well': m = 'stone'; break;
    case 'brazier': m = 'metal'; break;
    case 'tent': m = 'cloth'; break;
    case 'palisade': m = 'logs'; break;
    case 'wall': case 'parapet': case 'tower': {
      if (c.x > DUN_X0) { m = 'stone'; break; }
      const C = wallCastleNear(c.x, c.z);
      m = C && C.kind === 'timber' ? 'logs' : 'stone';
      break;
    }
    case 'scaffold': case 'post': case 'rail': case 'fence': case 'gate': case 'hdoor': case 'door': case 'furn': case 'prop': case 'engine': m = 'wood'; break;
  }
  c.wm = m;
  return m;
}
// the house a wall collider belongs to (houseColliders, 04e_houses.js)
function wallHouseOf(c) {
  if (!WALLS.houseOf) { WALLS.houseOf = new Map(); for (const H of HOUSES) for (const q of H.coll) WALLS.houseOf.set(q, H); }
  return WALLS.houseOf.get(c) || null;
}
const wallHouseMat = (H) => (H.style === 'timber' ? 'logs' : H.style === 'round' ? 'daub' : H.keepHall ? 'stone' : 'plaster');
const wallRoofMat = (H) => (H.style === 'timber' ? 'wood' : H.style === 'round' ? 'thatch' : 'slate');

/* ------------------------------------------------------------------ */
/* the swept test                                                      */
/* ------------------------------------------------------------------ */
const _wcs = [], _wfs = new Set(), _whs = new Set();
const WHIT = { t: 2, x: 0, y: 0, z: 0, nx: 0, ny: 1, nz: 0, mat: 'earth', c: null, H: null, f: null, what: '' };
const _wDef = {};
function wallSet(R, t, nx, ny, nz, mat, c, H, f, what, pc = null) {
  R.t = t; R.nx = nx; R.ny = ny; R.nz = nz; R.mat = mat; R.c = c; R.H = H; R.f = f; R.what = what; R.pc = pc || (c && c.build) || null;
}
// The first thing the segment a -> b strikes, or null. o: ox, oy, oz (where the shot was loosed: the shooter's own
// crenel, slit or window lets it out), tgt (the body aimed at: it shows itself at its crenel; a gate or an engine aimed
// at is struck as itself), ground (false: the caller minds the ground), r (a stone's radius: it meets things sooner).
function shotHit(ax, ay, az, bx, by, bz, o = _wDef) {
  if (!WALLS.on) return null;
  WALLS.stats.tests++;
  const dx = bx - ax, dy = by - ay, dz = bz - az, L = Math.hypot(dx, dz);
  const R = WHIT;
  R.t = 2;
  const ox = o.ox ?? ax, oy = o.oy ?? ay, oz = o.oz ?? az, tgt = o.tgt || null, pad = o.r || 0;
  const mx = (ax + bx) / 2, mz = (az + bz) / 2, reach = L / 2 + pad + 0.05;
  collidersNear(mx, mz, L / 2 + 0.8 + pad, _wcs);
  _whs.clear();
  for (const c of _wcs) {
    if (!c.active || WALL_SOFT[c.tag]) continue;
    // a quick look first: is it near the step at all? (most of a keep's colliders in the cell are not)
    const cr = c.type === 'circle' ? c.r : (c.br || (c.br = Math.hypot(c.hx, c.hz))), qx = c.x - mx, qz = c.z - mz;
    if (qx * qx + qz * qz > (cr + reach) * (cr + reach) && c.tag !== 'house') continue;
    if (c.tag === 'house') { const H = wallHouseOf(c); if (H && !_whs.has(H)) { _whs.add(H); wallHouse(H, ax, ay, az, dx, dy, dz, R, ox, oy, oz); } continue; }
    if (tgt && tgt.kind === 'door' && dist2(c.x, c.z, tgt.x, tgt.z) < (tgt.radius + 2.6) ** 2) continue; // the gate or engine aimed at
    if (o.skip && o.skip(c)) continue;
    wallColl(c, ax, ay, az, dx, dy, dz, R, ox, oy, oz, tgt, pad);
  }
  wallFloors(ax, ay, az, dx, dy, dz, R, ox, oy, oz);
  if (BUILD.roofs.length) wallBuiltRoofs(ax, ay, az, dx, dy, dz, R);
  if (o.ground !== false) wallGround(ax, ay, az, dx, dy, dz, R);
  if (R.t > 1) return null;
  R.x = ax + dx * R.t; R.y = ay + dy * R.t; R.z = az + dz * R.t;
  WALLS.stats.hits++;
  return R;
}
// a collider: an upright box or circle between its heights
function wallColl(c, ax, ay, az, dx, dy, dz, R, ox, oy, oz, tgt, pad) {
  const b0 = c.y0 != null ? c.y0 : c.baseY;
  // a prop's or a piece of furniture's collider is a box round all of it: a shot is stopped by its body, not by the air
  // over a workbench's corner where a forge's chimney stands at the other end
  const y0 = c.vert ? b0 : c.baseY - 2.5, y1 = b0 + ((c.tag === 'prop' || c.tag === 'furn') && !c.vert ? Math.min(c.h, 1.25) : c.h);
  let t0 = 0, t1 = Math.min(1, R.t), ax0 = 0, sgn = 0;
  if (c.type === 'circle') {
    const fx = ax - c.x, fz = az - c.z, A = dx * dx + dz * dz, rr = c.r + pad, C = fx * fx + fz * fz - rr * rr;
    if (A < 1e-12) { if (C > 0) return; }
    else {
      const B = 2 * (fx * dx + fz * dz), D = B * B - 4 * A * C;
      if (D < 0) return;
      const s = Math.sqrt(D), ta = (-B - s) / (2 * A), tb = (-B + s) / (2 * A);
      if (ta > t0) { t0 = ta; ax0 = 4; }
      if (tb < t1) t1 = tb;
      if (t0 > t1) return;
    }
  } else {
    const ex = c.hx + pad, ez = c.hz + pad;
    const lx = (ax - c.x) * c.cos - (az - c.z) * c.sin, lz = (ax - c.x) * c.sin + (az - c.z) * c.cos;
    const vx = dx * c.cos - dz * c.sin, vz = dx * c.sin + dz * c.cos;
    if (Math.abs(vx) < 1e-9) { if (lx < -ex || lx > ex) return; }
    else {
      let ta = (-ex - lx) / vx, tb = (ex - lx) / vx;
      if (ta > tb) { const q = ta; ta = tb; tb = q; }
      if (ta > t0) { t0 = ta; ax0 = 1; sgn = vx > 0 ? -1 : 1; }
      if (tb < t1) t1 = tb;
      if (t0 > t1) return;
    }
    if (Math.abs(vz) < 1e-9) { if (lz < -ez || lz > ez) return; }
    else {
      let ta = (-ez - lz) / vz, tb = (ez - lz) / vz;
      if (ta > tb) { const q = ta; ta = tb; tb = q; }
      if (ta > t0) { t0 = ta; ax0 = 2; sgn = vz > 0 ? -1 : 1; }
      if (tb < t1) t1 = tb;
      if (t0 > t1) return;
    }
  }
  if (Math.abs(dy) < 1e-9) { if (ay < y0 || ay > y1) return; }
  else {
    let ta = (y0 - ay) / dy, tb = (y1 - ay) / dy;
    if (ta > tb) { const q = ta; ta = tb; tb = q; }
    if (ta > t0) { t0 = ta; ax0 = 3; sgn = dy > 0 ? -1 : 1; }
    if (tb < t1) t1 = tb;
    if (t0 > t1) return;
  }
  if (t0 >= R.t) return;
  const px = ax + dx * t0, py = ay + dy * t0, pz = az + dz * t0;
  let tt = t0;
  // the ledge the shooter stands on or at (a wall's top under its walk, a drum's rim under the fighting top): shot
  // out over it
  if (oy - y1 > 0.15 && oy - y1 < 2.8 && dist2(ox, oz, px, pz) < 1.6 * 1.6) return;
  // openings
  if (c.tag === 'parapet') {
    tt = wallParapet(c, t0, t1, ax, ay, az, dx, dy, dz, px, py, pz, ox, oy, oz, tgt);
    if (tt < 0) return;
  } else if (c.tower) {
    if (wallSlit(c.tower, px, py, pz, ox, oy, oz)) return;
  } else if (c.build && c.build.t === 'window') {
    if (wallBuiltWindow(c.build, px, py, pz)) return;
  } else if (c.tag === 'fence' && !c.vert) {
    // a post-and-rail fence: the rails stop a shot, the gaps between them do not
    const h = py - c.baseY;
    if (!(h < 0.18 || (h > 0.38 && h < 0.56) || (h > 0.86 && h < 1.08) || h > c.h - 0.12)) return;
  }
  if (tt >= R.t) return;
  // the face it came in by
  let nx = 0, ny = 0, nz = 0;
  if (ax0 === 1) { nx = sgn * c.cos; nz = -sgn * c.sin; }
  else if (ax0 === 2) { nx = sgn * c.sin; nz = sgn * c.cos; }
  else if (ax0 === 3) ny = sgn;
  else if (ax0 === 4) { const qx = px - c.x, qz = pz - c.z, d = Math.hypot(qx, qz) || 1; nx = qx / d; nz = qz / d; }
  else { nx = -dx; nz = -dz; const d = Math.hypot(nx, nz) || 1; nx /= d; nz /= d; }
  wallSet(R, tt, nx, ny, nz, wallMatOf(c, py), c, null, null, c.tag);
}
// a breastwork with merlons (castleParapet, 04g_castles.js): returns the parameter it stops the shot at, or -1
function wallParapet(c, t0, t1, ax, ay, az, dx, dy, dz, px, py, pz, ox, oy, oz, tgt) {
  const base = c.y0 != null ? c.y0 : c.baseY;
  // the shooter's own embrasure: a body up behind it shoots out through the crenel or the slit before it
  if (oy > base + 0.6 && py < oy + 0.3 && dist2(ox, oz, px, pz) < 1.4 * 1.4) { WALLS.stats.embrasure++; return -1; }
  const cr = c.cren;
  if (!cr) return t0; // solid to its top: a stair's parapet, the gatehouse, a gallery's breastwork, a post
  const sill = cr.sill;
  // a foe standing at it shows itself at its crenel, above the breastwork
  if (tgt && py > sill - 0.05 && tgt.y > base - 0.6 && dist2(tgt.x, tgt.z, px, pz) < 1.5 * 1.5) { WALLS.stats.shows++; return -1; }
  if (py < sill) return t0;
  // above the breastwork: a merlon stops it, a crenel lets it by unless it drops onto the breastwork's top in passing
  const al = (px - cr.x0) * cr.ux + (pz - cr.z0) * cr.uz, sp = cr.len / cr.n;
  const k = clamp(Math.floor(al / sp), 0, cr.n - 1), mc = (k + 0.5) * sp;
  if (Math.abs(al - mc) < cr.mw / 2 && py < sill + cr.mh) return t0;
  if (dy < 0) { const ts = (sill - ay) / dy; if (ts >= t0 && ts <= t1) return ts; }
  WALLS.stats.crenels++;
  return -1;
}
// an arrow slit in a tower's wall: the archer at it shoots out through it; from outside only a shot into the slit
// itself goes in
function wallSlit(T, px, py, pz, ox, oy, oz) {
  if (!T.slitsAt) return false;
  const l = twLocal(T, px, pz), ly = py - T.S.y;
  const near = dist2(ox, oz, px, pz) < 1.8 * 1.8 && Math.abs(oy - py) < 1.5;
  for (const s of T.slitsAt) {
    if (ly < s.y0 - (near ? 0.55 : 0) || ly > s.y1 + (near ? 0.5 : 0)) continue;
    let along;
    if (T.kind === 'drum') along = angDiff(Math.atan2(l.x, l.z), s.a) * ((T.RI + T.RO) / 2);
    else {
      const ca = Math.cos(s.a), sa = Math.sin(s.a), out = l.x * sa + l.z * ca;
      if (out < T.HI - 0.3) continue;
      along = l.x * ca - l.z * sa - (s.off || 0);
    }
    if (Math.abs(along) < (near ? 0.42 : 0.06)) { WALLS.stats.slits++; return true; }
  }
  return false;
}
// a built window (06k_build.js, B_MODEL.window in 09u_depth.js): its glazed opening
function wallBuiltWindow(pc, px, py, pz) {
  const c = Math.cos(pc.yaw), s = Math.sin(pc.yaw), lx = (px - pc.x) * c - (pz - pc.z) * s, ly = py - pc.y;
  if (Math.abs(lx) < 0.46 && ly > 0.95 && ly < 1.85) { WALLS.stats.windows++; return true; }
  return false;
}
// a house: its walls to the eaves (the gable ends to the roof's line), its windows, its roof as a shell
function wallHouse(H, ax, ay, az, dx, dy, dz, R, ox, oy, oz) {
  if (ay > H.y + H.top + 1 && ay + dy > H.y + H.top + 1) return;
  { const qx = H.x - (ax + dx / 2), qz = H.z - (az + dz / 2), rr = H.foot + Math.hypot(dx, dz) / 2 + 0.2; if (qx * qx + qz * qz > rr * rr) return; }
  const yb = H.y - 1;
  for (const c of H.coll) {
    if (c.tag !== 'house' || !c.active) continue;
    // the wall box in x and z
    let t0 = 0, t1 = Math.min(1, R.t), ax0 = 0, sgn = 0;
    const lx = (ax - c.x) * c.cos - (az - c.z) * c.sin, lz = (ax - c.x) * c.sin + (az - c.z) * c.cos;
    const vx = dx * c.cos - dz * c.sin, vz = dx * c.sin + dz * c.cos;
    if (Math.abs(vx) < 1e-9) { if (lx < -c.hx || lx > c.hx) continue; }
    else { let ta = (-c.hx - lx) / vx, tb = (c.hx - lx) / vx; if (ta > tb) { const q = ta; ta = tb; tb = q; } if (ta > t0) { t0 = ta; ax0 = 1; sgn = vx > 0 ? -1 : 1; } if (tb < t1) t1 = tb; if (t0 > t1) continue; }
    if (Math.abs(vz) < 1e-9) { if (lz < -c.hz || lz > c.hz) continue; }
    else { let ta = (-c.hz - lz) / vz, tb = (c.hz - lz) / vz; if (ta > tb) { const q = ta; ta = tb; tb = q; } if (ta > t0) { t0 = ta; ax0 = 2; sgn = vz > 0 ? -1 : 1; } if (tb < t1) t1 = tb; if (t0 > t1) continue; }
    if (t0 >= R.t) continue;
    // its top where the shot is: the eaves, or a gable end's slope
    const gable = !H.round && Math.abs(Math.sin(c.yaw - H.yaw)) < 0.5;
    const top = (tq) => { if (H.round || !gable) return H.y + H.wallH; const p = houseL(H, ax + dx * tq, az + dz * tq); return H.y + H.wallH + Math.max(0, H.rh - Math.abs(p.x) * H.tn); };
    // first point of [t0, t1] between the foot and the top (the top is straight over each half of a gable)
    let th = -1;
    for (let k = 0; k <= 6; k++) {
      const tq = t0 + ((t1 - t0) * k) / 6, yq = ay + dy * tq;
      if (yq >= yb && yq <= top(tq)) { th = tq; break; }
    }
    if (th < 0) continue;
    if (th > t0) { let lo = th - (t1 - t0) / 6, hi = th; for (let q = 0; q < 6; q++) { const m = (lo + hi) / 2, ym = ay + dy * m; if (ym >= yb && ym <= top(m)) hi = m; else lo = m; } th = hi; ax0 = 3; sgn = 1; }
    if (th >= R.t) continue;
    const px = ax + dx * th, py = ay + dy * th, pz = az + dz * th;
    // a window: through it while its shutters stand open (or it has none)
    let through = false;
    const lp = houseL(H, px, pz), ly = py - H.y;
    for (const win of H.wins) {
      if (Math.abs(ly - win.y) > win.h / 2) continue;
      const F = win.F, u = (lp.x - F.ox) * F.ux + (lp.z - F.oz) * F.uz, n = (lp.x - F.ox) * F.nx + (lp.z - F.oz) * F.nz;
      if (Math.abs(u - win.u) > win.w / 2 || n > 0.3 || n < -H.t - 0.3) continue;
      if (!win.shutters || win.target === 1 || (win.leaves[0] && win.leaves[0].open > 0.6)) { through = true; break; }
    }
    if (through) { WALLS.stats.windows++; continue; }
    let nx, nz;
    if (ax0 === 1) { nx = sgn * c.cos; nz = -sgn * c.sin; } else if (ax0 === 2) { nx = sgn * c.sin; nz = sgn * c.cos; } else { nx = -dx; nz = -dz; const d = Math.hypot(nx, nz) || 1; nx /= d; nz /= d; }
    wallSet(R, th, nx, 0, nz, wallHouseMat(H), c, H, null, 'house');
  }
  // the roof: a shell from its underside to its top, over the walls and the overhangs
  if (!houseIntact(H)) return;
  const L3 = Math.hypot(dx, dy, dz), n = Math.min(80, Math.max(2, Math.ceil(L3 / 0.12)));
  if (wallInRoof(H, ax, ay, az)) return; // shot from within the thatch: let it out
  let prev = 0;
  for (let k = 1; k <= n; k++) {
    const t = k / n;
    if (t >= R.t + 1 / n) break;
    if (!wallInRoof(H, ax + dx * t, ay + dy * t, az + dz * t)) { prev = t; continue; }
    let lo = prev, hi = t;
    for (let q = 0; q < 7; q++) { const m = (lo + hi) / 2; if (wallInRoof(H, ax + dx * m, ay + dy * m, az + dz * m)) hi = m; else lo = m; }
    if (hi >= R.t) return;
    const px = ax + dx * hi, pz = az + dz * hi, l = houseL(H, px, pz);
    let nx, ny, nz;
    if (H.round) { const rad = Math.hypot(l.x, l.z) || 1, kk = H.hc / H.Rr; nx = (l.x / rad) * kk; nz = (l.z / rad) * kk; ny = 1; }
    else { nx = Math.sign(l.x) * H.sn; ny = H.cs; nz = 0; }
    const up = ay + dy * hi > H.y + H.wallH ? 1 : -1; // from above or from the room under it
    const wx = nx * H.c + nz * H.s, wz = -nx * H.s + nz * H.c, d = Math.hypot(wx, ny, wz) || 1;
    wallSet(R, hi, (up * wx) / d, (up * ny) / d, (up * wz) / d, wallRoofMat(H), null, H, null, 'roof');
    WALLS.stats.roofs++;
    return;
  }
}
function wallInRoof(H, x, y, z) {
  const l = houseL(H, x, z), ly = y - H.y;
  if (H.round) {
    const rad = Math.hypot(l.x, l.z);
    if (rad > H.Rr) return false;
    const top = H.roofAt(rad) + 0.08;
    return ly <= top && ly >= top - 0.5;
  }
  const ax = Math.abs(l.x);
  if (ax > H.w / 2 + H.ohSide || Math.abs(l.z) > H.d / 2 + H.ohGable) return false;
  const top = H.wallH + H.rh - ax * H.tn + 0.1;
  return ly <= top && ly >= top - H.roofTh / H.cs - 0.16;
}
// the roofs of what has been built (06k_build.js: a piece's roof rises from its eaves at pc.y to its ridge along its
// local x, as buildCamSolid has it): thatch or shingles
function wallBuiltRoofs(ax, ay, az, dx, dy, dz, R) {
  const mx = ax + dx / 2, mz = az + dz / 2, reach = Math.hypot(dx, dz) / 2 + B_C;
  for (const pc of BUILD.roofs) {
    if (dist2(mx, mz, pc.x, pc.z) > reach * reach) continue;
    if (Math.min(ay, ay + dy) > pc.y + 1.8 || Math.max(ay, ay + dy) < pc.y - 0.4) continue;
    const c = Math.cos(pc.yaw), sn = Math.sin(pc.yaw);
    const inside = (t) => {
      const x = ax + dx * t - pc.x, z = az + dz * t - pc.z, lx = x * c - z * sn, lz = x * sn + z * c;
      if (Math.abs(lx) > B_C / 2 + 0.4 || Math.abs(lz) > B_C / 2 + 0.4) return false;
      const ys = pc.y + 1.55 * (1 - Math.min(1, Math.abs(lz) / (B_C / 2))), y = ay + dy * t;
      return y > ys - 0.3 && y < ys + 0.15;
    };
    if (inside(0)) continue;
    const n = Math.min(60, Math.max(2, Math.ceil(Math.hypot(dx, dy, dz) / 0.12)));
    let prev = 0;
    for (let k = 1; k <= n; k++) {
      const t = k / n;
      if (t >= R.t + 1 / n) break;
      if (!inside(t)) { prev = t; continue; }
      let lo = prev, hi = t;
      for (let q = 0; q < 6; q++) { const m = (lo + hi) / 2; if (inside(m)) hi = m; else lo = m; }
      if (hi < R.t) { wallSet(R, hi, 0, 1, 0, pc.t === 'roofThatch' || pc.t === 'roofHip' ? 'thatch' : 'wood', null, null, null, 'roof', pc); WALLS.stats.roofs++; }
      break;
    }
  }
}
// the floors: walks, stairs, the rooms and tops of the towers, a shut hatch, a jetty's deck
function wallFloors(ax, ay, az, dx, dy, dz, R, ox, oy, oz) {
  if (!FLOOR.list.length) return;
  _wfs.clear();
  const s = FLOOR.cell, bx = ax + dx, bz = az + dz;
  const i0 = Math.floor((Math.min(ax, bx) - 0.5) / s), i1 = Math.floor((Math.max(ax, bx) + 0.5) / s);
  const j0 = Math.floor((Math.min(az, bz) - 0.5) / s), j1 = Math.floor((Math.max(az, bz) + 0.5) / s);
  for (let ci = i0; ci <= i1; ci++) for (let cj = j0; cj <= j1; cj++) {
    const list = FLOOR.grid.get(collKey(ci, cj));
    if (!list) continue;
    for (const f of list) {
      if (!f.active || _wfs.has(f)) continue;
      _wfs.add(f);
      const fr = f.type === 'disc' ? f.r : (f.br || (f.br = Math.hypot(f.hx, f.hz))), qx = f.x - (ax + dx / 2), qz = f.z - (az + dz / 2), rr = fr + Math.hypot(dx, dz) / 2 + 0.05;
      if (qx * qx + qz * qz > rr * rr) continue;
      if (Math.min(ay, ay + dy) > Math.max(f.ya, f.yb) + 0.05) continue; // the whole step above its top
      wallFloor(f, ax, ay, az, dx, dy, dz, R, ox, oy, oz);
    }
  }
}
function wallFloor(f, ax, ay, az, dx, dy, dz, R, ox, oy, oz) {
  let t0 = 0, t1 = Math.min(1, R.t), side = 0, nx = 0, nz = 0;
  // top(t) = ta + tb t, the floor's surface over the shot (sloped along a stair's length)
  let ta, tb;
  if (f.type === 'disc') {
    const fx = ax - f.x, fz = az - f.z, A = dx * dx + dz * dz, C = fx * fx + fz * fz - f.r * f.r;
    if (A < 1e-12) { if (C > 0) return; }
    else { const B = 2 * (fx * dx + fz * dz), D = B * B - 4 * A * C; if (D < 0) return; const q = Math.sqrt(D), a0 = (-B - q) / (2 * A), a1 = (-B + q) / (2 * A); if (a0 > t0) { t0 = a0; side = 1; } if (a1 < t1) t1 = a1; if (t0 > t1) return; }
    ta = f.ya; tb = 0;
  } else {
    const lx = (ax - f.x) * f.cos - (az - f.z) * f.sin, lz = (ax - f.x) * f.sin + (az - f.z) * f.cos;
    const vx = dx * f.cos - dz * f.sin, vz = dx * f.sin + dz * f.cos;
    if (Math.abs(vx) < 1e-9) { if (lx < -f.hx || lx > f.hx) return; }
    else { let a0 = (-f.hx - lx) / vx, a1 = (f.hx - lx) / vx; if (a0 > a1) { const q = a0; a0 = a1; a1 = q; } if (a0 > t0) { t0 = a0; side = 1; nx = (vx > 0 ? -1 : 1) * f.cos; nz = -(vx > 0 ? -1 : 1) * f.sin; } if (a1 < t1) t1 = a1; if (t0 > t1) return; }
    if (Math.abs(vz) < 1e-9) { if (lz < -f.hz || lz > f.hz) return; }
    else { let a0 = (-f.hz - lz) / vz, a1 = (f.hz - lz) / vz; if (a0 > a1) { const q = a0; a0 = a1; a1 = q; } if (a0 > t0) { t0 = a0; side = 1; nx = (vz > 0 ? -1 : 1) * f.sin; nz = (vz > 0 ? -1 : 1) * f.cos; } if (a1 < t1) t1 = a1; if (t0 > t1) return; }
    const k = (f.yb - f.ya) / (2 * f.hz);
    ta = f.ya + k * (lz + f.hz); tb = k * vz;
  }
  // between its underside and its top: g1 = top - y >= 0, g2 = y - bottom >= 0, both straight in t
  const th = f.th || 0;
  const g1a = ta - ay, g1b = tb - dy;
  const g2a = th ? ay - (ta - th) : ay - f.y0, g2b = th ? dy - tb : dy;
  let s0 = t0, s1 = t1, how = side;
  const clip = (a, b, kind) => {
    if (Math.abs(b) < 1e-12) { if (a < 0) s1 = -1; return; }
    const r = -a / b;
    if (b > 0) { if (r > s0) { s0 = r; how = kind; } } else if (r < s1) s1 = r;
  };
  clip(g1a, g1b, 2); clip(g2a, g2b, 3);
  if (s0 > s1 || s0 >= R.t) return;
  const px = ax + dx * s0, pz = az + dz * s0;
  // the floor the shooter stands on, at its edge: shot out over it, not into it
  const topHere = ta + tb * s0;
  if (oy > topHere - 0.2 && oy - topHere < 2.7 && dist2(ox, oz, px, pz) < 2.2 * 2.2) return;
  let ny = 0;
  if (how === 2) { nx = 0; nz = 0; ny = 1; } else if (how === 3) { nx = 0; nz = 0; ny = -1; }
  else if (f.type === 'disc') { const qx = px - f.x, qz = pz - f.z, d = Math.hypot(qx, qz) || 1; nx = qx / d; nz = qz / d; }
  const mat = f.tag === 'hatch' || f.th > 0.2 && f.th < 0.5 && f.tag !== 'top' ? 'wood' : f.tag === 'build' ? (f.th ? 'wood' : 'stone') : (wallCastleNear(f.x, f.z) || {}).kind === 'timber' ? 'wood' : 'stone';
  wallSet(R, s0, nx, ny, nz, mat, null, null, f, 'floor');
  WALLS.stats.floors++;
}
// the ground under the flight
function wallGround(ax, ay, az, dx, dy, dz, R) {
  const L = Math.hypot(dx, dz), n = Math.max(1, Math.ceil(L / 0.6));
  let prev = 0;
  for (let k = 1; k <= n; k++) {
    const t = k / n;
    if (t >= R.t) return;
    if (ay + dy * t >= heightAt(ax + dx * t, az + dz * t) - 0.02) { prev = t; continue; }
    let lo = prev, hi = t;
    for (let q = 0; q < 6; q++) { const m = (lo + hi) / 2; if (ay + dy * m < heightAt(ax + dx * m, az + dz * m) - 0.02) hi = m; else lo = m; }
    if (hi >= R.t) return;
    wallSet(R, hi, 0, 1, 0, 'earth', null, null, null, 'ground');
    WALLS.stats.ground++;
    return;
  }
}

/* ------------------------------------------------------------------ */
/* aiming, and whether a shot would get there                          */
/* ------------------------------------------------------------------ */
// the height a shot is aimed at on a body: its chest; a body up on a wall or a tower, seen from below, where it
// shows over the breastwork (its head and shoulders)
function wallsAimY(t, fromY) {
  const sc = t.scale || 1;
  if (t.kind === 'door') return t.y + 2.5;
  if (t.kind === 'dragon') return t.y + 2.8;
  if (fromY < t.y + 0.5 && t.kind === 'humanoid' && elevatedEnt(t)) return t.y + 1.48 * sc;
  return t.y + 1.15 * sc;
}
// would a shot from e reach t, or strike something in between? (arrows fly a little arc: tested in three pieces)
// count: a shot about to be loosed (autoAttack, npcAbilities); false: a foe weighed as a target (pickTarget)
function wallsShotClear(e, t, arc = true, count = true) {
  if (!WALLS.on || !t) return true;
  if (count) WALLS.stats.checks = (WALLS.stats.checks || 0) + 1;
  else WALLS.stats.picks = (WALLS.stats.picks || 0) + 1;
  const yaw = Math.atan2(t.x - e.x, t.z - e.z), sc = e.scale || 1;
  const sx = e.x + Math.sin(yaw) * 0.4, sz = e.z + Math.cos(yaw) * 0.4, sy = e.y + 1.45 * sc;
  const tx = t.x, tz = t.z, ty = wallsAimY(t, sy);
  const tot = Math.hypot(tx - sx, tz - sz) || 1, o = { ox: sx, oy: sy, oz: sz, tgt: t };
  const n = arc ? 3 : 1;
  let px = sx, py = sy, pz = sz;
  for (let k = 1; k <= n; k++) {
    const u = k / n, x = lerp(sx, tx, u), z = lerp(sz, tz, u), y = lerp(sy, ty, u) + (arc ? Math.sin(u * Math.PI) * tot * 0.06 : 0);
    if (shotHit(px, py, pz, x, y, z, o)) { if (count) WALLS.stats.held++; else WALLS.stats.picksWalled = (WALLS.stats.picksWalled || 0) + 1; return false; }
    px = x; py = y; pz = z;
  }
  return true;
}

// a wall archer whose shots strike its own breastwork (its foe is off to the side, or close under the wall) steps up
// to the crenel facing that foe: along the floor it stands on, no more than 2.4 m from its post, never where that floor
// ends (a hatch, the walk's edge, a step); back at its post once the fight is over (thinkPosted). True if it moved
function wallsStepToCrenel(e, t, post, dt) {
  const dx = t.x - post.x, dz = t.z - post.z, d = Math.hypot(dx, dz);
  if (d < 1) return false;
  for (const reach of [2.4, 1.8, 1.2, 0.7]) {
    let ok = true;
    for (const f of [0.5, 1]) {
      const px = post.x + (dx / d) * reach * f, pz = post.z + (dz / d) * reach * f;
      if (Math.abs(floorAt(px, pz, e.y + 0.3) - e.y) > 0.25) { ok = false; break; }
    }
    if (!ok) continue;
    const gx = post.x + (dx / d) * reach, gz = post.z + (dz / d) * reach;
    if (dist2(e.x, e.z, gx, gz) < 0.2 * 0.2) return false;
    moveToward(e, gx, gz, dt, 0.7, 0.15);
    WALLS.stats.stepped = (WALLS.stats.stepped || 0) + 1;
    return true;
  }
  return false;
}

/* ------------------------------------------------------------------ */
/* the projectiles of 07_entities.js (arrows, bolts, spells)           */
/* ------------------------------------------------------------------ */
// asked by updateProjectiles each step, before it moves p toward (tx, ty, tz): does this step's flight strike
// something? Then the shot stops there (true: the caller drops it)
function wallsProj(p, tx, ty, tz, d, step) {
  if (!WALLS.on || WALL_PROJ_SKIP[p.kind]) return false;
  const arrive = d <= step + 0.3 || p.age > p.life;
  // one look covers two steps of the flight: found clear, the next step needs none (half the tests for a shot in the
  // open; a homing shot's next step lies within a few centimetres of the stretch looked at)
  if (!arrive && p.wallClear !== undefined && GAME.t < p.wallClear) return false;
  let nx, ny, nz, vis = 0, k = 1;
  if (arrive) { nx = tx; ny = ty; nz = tz; }
  else {
    const s2 = Math.min(step * 2, d); k = s2 / step;
    nx = p.x + ((tx - p.x) / d) * s2; ny = p.y + ((ty - p.y) / d) * s2; nz = p.z + ((tz - p.z) / d) * s2;
    if (p.kind === 'arrow' || p.kind === 'firearrow') { const tot = Math.hypot(tx - p.ox, tz - p.oz) || 1, done = Math.hypot(nx - p.ox, nz - p.oz); vis = Math.sin(clamp(done / tot, 0, 1) * Math.PI) * tot * 0.06; }
  }
  const t = getEnt(p.tgt);
  const R = shotHit(p.x, p.y + (p.vis || 0), p.z, nx, ny + vis, nz, { ox: p.ox, oy: p.oy, oz: p.oz, tgt: t });
  if (!R) { if (!arrive) p.wallClear = GAME.t + (1.5 * step) / Math.max(p.speed, 1e-3); return false; }
  if (!arrive && R.t * k > 1.001) return false; // it strikes in the second step: then, when it gets there
  // a shot aimed at a point on the ground (a volley's arrows) that lands on the ground there has got where it went
  if (R.what === 'ground' && p.point && dist2(R.x, R.z, p.point.x, p.point.z) < 1.2 * 1.2) return false;
  const src = getEnt(p.src) || { faction: p.srcFaction, id: p.src };
  const L = Math.hypot(nx - p.x, ny + vis - p.y - (p.vis || 0), nz - p.z) || 1;
  wallStrike(p.kind, R, (nx - p.x) / L, (ny + vis - p.y - (p.vis || 0)) / L, (nz - p.z) / L, src, p.speed, p.payload && p.payload.arrow);
  // the shooter (an NPC) learns its shot struck a wall
  if (src && src.ai && !p.visualOnly) src.ai.wallShot = GAME.t;
  return true;
}
const WALL_ARROWLIKE = { arrow: 1, firearrow: 1, deadeye: 1 };
// a shot meets something: an arrow sticks or glances, a spell bursts
function wallStrike(kind, R, dx, dy, dz, src, speed = 40, head = null) {
  const x = R.x, y = R.y, z = R.z, near = dist2(x, z, camera.position.x, camera.position.z) < 70 * 70;
  if (WALL_ARROWLIKE[kind]) {
    const fire = kind === 'firearrow' || head === 'fire';
    wallArrow(R, dx, dy, dz, speed, fire ? 'fire' : head || 'plain', src);
    if (fire) wallFire(x, y, z, R, src);
    return;
  }
  // a spell bursts on the face it meets
  WALLS.stats.burst++;
  const bx = x + R.nx * 0.08, by = y + R.ny * 0.08, bz = z + R.nz * 0.08;
  if (near) {
    spellImpact(kind, bx, by, bz);
    const c = PROJ_COL[kind];
    if (c) FX.burst(bx, by, bz, 14, c, 3.2, 0.45, 0.16, 2);
    if (R.what !== 'ground') FX.dust(bx, by - 0.3, bz, 5, wallLit(WALL_GLANCE[R.mat] ? [0.5, 0.48, 0.44] : [0.42, 0.34, 0.24]));
  }
  if (kind === 'fire') wallFire(bx, by, bz, R, src);
  else if (kind === 'frost' || kind === 'ice') { if (near) FX.burst(bx, by, bz, 10, [0.8, 1.2, 1.6], 2, 0.7, 0.12, 1); }
}
// fire meets thatch or timber: it catches (the houses' roofs, the timber towers, what is built, boats, the grass at
// the foot of a wall); a burning arrow in stone only scorches
function wallFire(x, y, z, R, src) {
  WALLS.stats.fired++;
  const r = WALL_GLANCE[R.mat] ? 0.5 : 1;
  fireLandsAt(x, y, z, r, src && src.faction !== undefined ? src : null);
}

/* ------------------------------------------------------------------ */
/* arrows stuck in what they hit, and those that glance off            */
/* ------------------------------------------------------------------ */
function wallArrow(R, dx, dy, dz, speed, type, src) {
  const near = dist2(R.x, R.z, camera.position.x, camera.position.z) < 70 * 70;
  if (WALL_GLANCE[R.mat]) {
    // off stone it glances: sparks and grit; it keeps some of its pace along the face and springs back off it only
    // weakly, so a shot straight at a wall drops near its foot and a glancing one skids on along the face
    WALLS.stats.glanced++;
    const dn = dx * R.nx + dy * R.ny + dz * R.nz, kt = (0.3 + Math.random() * 0.15) * speed, kn = (0.06 + Math.random() * 0.08) * speed;
    const vx = (dx - dn * R.nx) * kt - dn * R.nx * kn + (Math.random() - 0.5) * 2.4;
    const vy = (dy - dn * R.ny) * kt - dn * R.ny * kn + Math.random() * 1.5;
    const vz = (dz - dn * R.nz) * kt - dn * R.nz * kn + (Math.random() - 0.5) * 2.4;
    if (WALLS.fall.length > 40) WALLS.fall.shift();
    WALLS.fall.push({ x: R.x + R.nx * 0.06, y: R.y + R.ny * 0.06, z: R.z + R.nz * 0.06, vx, vy, vz, t: 0, type, spin: (Math.random() - 0.5) * 20, src: src ? src.id : null });
    if (near) { FX.sparks(R.x, R.y, R.z); FX.dust(R.x, R.y - 0.2, R.z, 3, wallLit([0.55, 0.52, 0.48])); wallSfx('glance', R.x, R.z); }
    return;
  }
  // into wood, thatch, daub or earth it sticks, the head buried, the shaft standing out along its flight
  WALLS.stats.stuck++;
  const tilt = 0.08;
  let sx = dx + (Math.random() - 0.5) * tilt, sy = dy + (Math.random() - 0.5) * tilt, sz = dz + (Math.random() - 0.5) * tilt;
  const L = Math.hypot(sx, sy, sz) || 1; sx /= L; sy /= L; sz /= L;
  const depth = R.mat === 'earth' ? 0.16 : R.mat === 'thatch' ? 0.2 : 0.09 + Math.random() * 0.05;
  wallStick(R.x + sx * depth, R.y + sy * depth, R.z + sz * depth, sx, sy, sz, type, R, src);
  if (near) {
    const col = wallLit(R.mat === 'thatch' ? [0.62, 0.52, 0.3] : R.mat === 'daub' || R.mat === 'plaster' ? [0.62, 0.58, 0.5] : R.mat === 'earth' ? [0.4, 0.34, 0.26] : [0.42, 0.31, 0.19]);
    FX.dust(R.x, R.y - 0.15, R.z, 3, col);
    for (let i = 0; i < 5; i++) fxAlpha.emit(R.x, R.y, R.z, R.nx * 1.4 + (Math.random() - 0.5) * 1.6, R.ny * 1.4 + Math.random() * 1.2, R.nz * 1.4 + (Math.random() - 0.5) * 1.6, 0.7, col[0], col[1], col[2], 0.06, 9, 0.4);
    wallSfx(R.mat === 'earth' || R.mat === 'thatch' ? 'thunkSoft' : 'thunk', R.x, R.z);
  }
}
// x, y, z: where the head is (the arrow drawn back along its flight from there)
function wallStick(x, y, z, dx, dy, dz, type, R, src) {
  if (WALLS.stuck.length >= WALL_STUCK_MAX) WALLS.stuck.shift();
  WALLS.stuck.push({ x, y, z, dx, dy, dz, type, until: GAME.t + WALL_STUCK_LIFE, c: R ? R.c : null, f: R ? R.f : null, H: R ? R.H : null, pc: R ? R.pc : null, roof: !!(R && R.what === 'roof'), fire: type === 'fire' ? GAME.t + 9 : 0, src: src ? src.id : null });
}
// grit and dust in the light there is now (a particle keeps the colour it is given: pale puffs at night otherwise);
// by day about as given
function wallLit(c) {
  const A = U.uAmbient.value, Lc = U.uLightColor.value;
  return [c[0] * clamp(A.x * 1.05 + Lc.x * 0.3, 0.12, 1.1), c[1] * clamp(A.y * 1.05 + Lc.y * 0.3, 0.12, 1.1), c[2] * clamp(A.z * 1.05 + Lc.z * 0.3, 0.12, 1.1)];
}
// the sounds: a thunk into timber, a dull one into thatch and earth, a ringing glance off stone
function wallSfx(kind, x, z) {
  if (!AUDIO.ctx || !AUDIO.on || AUDIO.ctx.state !== 'running') return;
  const P = GAME.player, d = P ? dist(P.x, P.z, x, z) : 0;
  if (d > 45) return;
  const ctx = AUDIO.ctx, t = ctx.currentTime + 0.005, v = clamp(1 - d / 45, 0.15, 1);
  if (t - (AUDIO.last['wall_' + kind] || -1) < 0.05) return;
  AUDIO.last['wall_' + kind] = t;
  try {
    if (kind === 'glance') { tone('triangle', 2400, 1700, t, 0.09, 0.05 * v); tone('sine', 3300, 2900, t + 0.01, 0.12, 0.03 * v); noiseBurst(t, 0.06, 0.06 * v, 'highpass', 3500, 2500, 1); }
    else if (kind === 'thunk') { tone('sine', 210, 120, t, 0.09, 0.16 * v); noiseBurst(t, 0.05, 0.1 * v, 'bandpass', 900, 500, 2); tone('triangle', 160, 150, t + 0.02, 0.18, 0.04 * v); }
    else if (kind === 'thunkSoft') noiseBurst(t, 0.07, 0.1 * v, 'lowpass', 700, 300, 1);
    else if (kind === 'stone') { noiseBurst(t, 0.5, 0.35 * v, 'lowpass', 1600, 180, 0.8, 0.005); tone('sine', 90, 40, t, 0.45, 0.3 * v); }
  } catch (err) { /* the audio graph is not ready */ }
}

/* ------------------------------------------------------------------ */
/* each step and each frame                                            */
/* ------------------------------------------------------------------ */
function updateWalls(dt) {
  // arrows glancing off stone fly on a moment and fall; they lie where they land
  for (let i = WALLS.fall.length - 1; i >= 0; i--) {
    const A = WALLS.fall[i];
    A.t += dt;
    const px = A.x, py = A.y, pz = A.z;
    A.vy -= 9.8 * dt;
    A.x += A.vx * dt; A.y += A.vy * dt; A.z += A.vz * dt;
    const R = shotHit(px, py, pz, A.x, A.y, A.z, _wDef);
    if (R || A.t > 3) {
      WALLS.fall.splice(i, 1);
      if (!R) continue;
      if (R.ny > 0.5) {
        // it lies on the floor or the ground, flat, the way it slid
        const h = Math.hypot(A.vx, A.vz) || 1, yaw = Math.atan2(A.vx / h, A.vz / h) + (Math.random() - 0.5) * 0.6;
        wallStick(R.x + Math.sin(yaw) * 0.38, R.y + 0.012, R.z + Math.cos(yaw) * 0.38, Math.sin(yaw), -0.02, Math.cos(yaw), A.type, R, null);
      } else { const dn = A.vx * R.nx + A.vz * R.nz; A.vx -= 1.6 * dn * R.nx; A.vz -= 1.6 * dn * R.nz; A.vx *= 0.4; A.vz *= 0.4; A.x = R.x + R.nx * 0.05; A.y = R.y; A.z = R.z + R.nz * 0.05; A.t = Math.max(A.t, 2.5); WALLS.fall.push(A); }
    }
  }
  // stuck arrows go with what holds them: a door that opens, a wall that falls, a roof that burns
  for (let i = WALLS.stuck.length - 1; i >= 0; i--) {
    const S = WALLS.stuck[i];
    let gone = GAME.t > S.until;
    if (!gone && S.c && !S.c.active && S.c.tag !== 'hdoor') gone = true; // (a door's swings with it: hidden while it stands open)
    if (!gone && S.c && S.y - S.dy * 0.1 > (S.c.y0 != null ? S.c.y0 : S.c.baseY) + S.c.h + 0.15) gone = true; // what held it was cut down below it (a breached tower)
    if (!gone && S.f && !S.f.active) gone = true;
    if (!gone && S.pc && S.pc.st !== 'built' && S.pc.st !== 'burning') gone = true; // a built piece burnt down or pulled down
    if (!gone && S.H && (S.roof ? !houseIntact(S.H) : S.H.state === 'ruin' && S.H.char >= 1 && S.H.stT > 3)) gone = true;
    if (!gone) continue;
    WALLS.stuck.splice(i, 1);
    if (GAME.t <= S.until) WALLS.fall.push({ x: S.x - S.dx * 0.3, y: S.y - S.dy * 0.3, z: S.z - S.dz * 0.3, vx: (Math.random() - 0.5), vy: 0.5, vz: (Math.random() - 0.5), t: 0, type: S.type, spin: 0, src: null });
  }
}
function drawWalls() {
  const cx = camera.position.x, cz = camera.position.z;
  for (const S of WALLS.stuck) {
    if (dist2(S.x, S.z, cx, cz) > 65 * 65 || (S.c && !S.c.active)) continue;
    arrowPush(S.x - S.dx * 0.43, S.y - S.dy * 0.43, S.z - S.dz * 0.43, S.dx, S.dy, S.dz);
    if (S.fire > GAME.t) glowPush(S.x - S.dx * 0.1, S.y - S.dy * 0.1, S.z - S.dz * 0.1, 1.6, 0.6, 0.15, 0.32 * clamp((S.fire - GAME.t) / 3, 0.2, 1));
  }
  for (const A of WALLS.fall) {
    const sp = Math.hypot(A.vx, A.vy, A.vz) || 1, s = Math.sin(A.t * A.spin) * 0.5;
    arrowPush(A.x, A.y, A.z, A.vx / sp + s, A.vy / sp, A.vz / sp - s);
  }
}

/* ------------------------------------------------------------------ */
/* stones from the engines                                             */
/* ------------------------------------------------------------------ */
// asked by siegeStonesStep after a stone has moved from (px, py, pz): it strikes the first thing in its way
function wallsStoneStep(s, px, py, pz) {
  if (!WALLS.on) return false;
  // clear of the engine that threw it, and of what it was aimed at (that is struck as before, at the end of its flight)
  if (dist2(px, pz, s.x0, s.z0) < 5 * 5) return false;
  const a = s.aim;
  const R = shotHit(px, py, pz, s.x, s.y, s.z, { ox: s.x0, oy: s.y0, oz: s.z0, tgt: a.kind === 'gate' ? a.D : null, r: s.r * 0.6 });
  if (!R) return false;
  if (dist2(R.x, R.z, a.x, a.z) < 1.6 * 1.6 && Math.abs(R.y - a.y) < 2.5) return false;
  WALLS.stats.stones++;
  // struck early: crack what it met there (a stretch of wall, a tower), else a burst of earth or splinters
  let kind = R.what === 'ground' ? 'ground' : R.c && (R.c.tag === 'wall' || R.c.tag === 'parapet' || R.c.tower) || R.f ? 'wall' : 'struck', D = null;
  if (R.c && R.c.tag === 'door') { const C = wallCastleNear(R.x, R.z); D = C ? siegeDoorOf(C.S) : null; if (D) kind = 'gate'; } // a castle's gate in the way: battered
  s.aim = { kind, x: R.x, y: R.y, z: R.z, mat: R.mat, H: R.H, D };
  return true;
}

queueMicrotask(() => { if (window.__hm) window.__hm.walls = { WALLS, shotHit, wallsShotClear, wallsAimY, wallsStepToCrenel, wallsProj, wallStrike, wallArrow, wallsStoneStep, wallMatOf, wallHouseOf, wallInRoof, updateWalls, fx: { FX, get fxAlpha() { return fxAlpha; }, get fxAdd() { return fxAdd; } } }; });
