/* ================================================================== */
/* [look3] the world looked at again (version 14)                      */
/* ================================================================== */
// What version 13's look left and what version 13 added, each fixed at its cause; the shaders' and the scaffolds' shared
// pieces are in 04d_look3.js, small changes where a fault was carry [look3] marks in their own modules.
//
// The keeps' halls' footpaths. Version 13 drew the towns' footpaths (13t_look.js, 13u_look2.js), but a keep's hall stood
// on its courtyard with no way worn to its door: its people go in and out by the gate every day. Now a footpath of bare
// earth runs from each hall's door across the courtyard to the inside of the keep's gate, drawn as the towns' are: into
// the 1 m path map the terrain reads (uGroundAO.g: look3PathMap, from buildGroundAO), as bare ground in the cover map
// (no blade on it, a trodden fringe beside it: look3CoverAll, from buildCoverMask) and as a trodden verge in the road
// channel. Nothing placed moves and nothing saved changes.
const LOOK3 = { halls: null, painted: false };
function look3HallPlan() {
  if (LOOK3.halls) return LOOK3.halls;
  if (typeof HALL === 'undefined' || !HALL.list.length) return [];
  const out = [];
  for (const H of HALL.list) {
    const S = H.S, D = H.door;
    if (!S || !D || !D.c || !S.gateLocal) continue;
    // to just inside the gate: the courtyard's side of the gateway (the wall's thickness and a step beyond)
    const R = REALMS[H.realm] || REALMS[0], round = R.style === 'round';
    const gz = S.gateLocal.z - (round ? KEEP_T + 1.2 : KEEP_T + 1.4), g = siteToWorld(S, S.gateLocal.x, gz);
    out.push({ ax: D.c.x, az: D.c.z, bx: g.x, bz: g.z, w: 1.9, S, H });
  }
  return (LOOK3.halls = out);
}
// into the 1 m path map (the second channel of the contact-shade map, as the towns' paths: look2PathMap)
function look3PathMap(rg, R) {
  for (const P of look3HallPlan()) {
    const hw = P.w / 2, pad = hw + 1.2;
    const x0 = Math.min(P.ax, P.bx) - pad, x1 = Math.max(P.ax, P.bx) + pad, z0 = Math.min(P.az, P.bz) - pad, z1 = Math.max(P.az, P.bz) + pad;
    for (let j = Math.max(0, Math.floor(z0 + 512)); j <= Math.min(R - 1, Math.ceil(z1 + 512)); j++) {
      for (let i = Math.max(0, Math.floor(x0 + 512)); i <= Math.min(R - 1, Math.ceil(x1 + 512)); i++) {
        const x = i - 512 + 0.5, z = j - 512 + 0.5, pd = lookSegD(x, z, P);
        const v = Math.round(255 * sstep(hw + 0.9, hw - 0.35, pd));
        const q = (j * R + i) * 2 + 1;
        if (v > rg[q]) rg[q] = v;
      }
    }
  }
}
// into the cover map (bare along the path, short turf beside it; only ever raised) and, once, the road channel's verge
function look3CoverAll() {
  const R = COVER.res, data = COVER.data, paths = look3HallPlan();
  for (const P of paths) {
    const hw = P.w / 2, pad = hw + 1.0;
    const x0 = Math.min(P.ax, P.bx) - pad, x1 = Math.max(P.ax, P.bx) + pad, z0 = Math.min(P.az, P.bz) - pad, z1 = Math.max(P.az, P.bz) + pad;
    for (let j = Math.max(0, Math.floor(z0 + 512)); j <= Math.min(R - 1, Math.ceil(z1 + 512)); j++) {
      for (let i = Math.max(0, Math.floor(x0 + 512)); i <= Math.min(R - 1, Math.ceil(x1 + 512)); i++) {
        const x = i - 512 + 0.5, z = j - 512 + 0.5, k = j * R + i, pd = lookSegD(x, z, P);
        const v = pd < hw ? LOOK_PATH : pd < hw + 0.8 ? LOOK_GREEN : 0;
        if (v > data[k]) data[k] = v;
      }
    }
  }
  const A = U.uWorldA.value && U.uWorldA.value.image && U.uWorldA.value.image.data;
  if (A && paths.length && !LOOK3.painted) {
    LOOK3.painted = true;
    for (const P of paths) {
      const x0 = Math.min(P.ax, P.bx) - 3, x1 = Math.max(P.ax, P.bx) + 3, z0 = Math.min(P.az, P.bz) - 3, z1 = Math.max(P.az, P.bz) + 3;
      for (let j = Math.max(0, Math.floor((z0 + HALF) / HS)); j <= Math.min(HN - 1, Math.ceil((z1 + HALF) / HS)); j++) {
        for (let i = Math.max(0, Math.floor((x0 + HALF) / HS)); i <= Math.min(HN - 1, Math.ceil((x1 + HALF) / HS)); i++) {
          const x = -HALF + i * HS, z = -HALF + j * HS, k = j * HN + i, v = Math.round(255 * 0.2 * sstep(P.w / 2 + 1.6, P.w / 2 - 0.2, lookSegD(x, z, P)));
          if (v > A[k * 4]) A[k * 4] = v;
        }
      }
    }
    U.uWorldA.value.needsUpdate = true;
  }
}

// The masons. A breach was built back behind its scaffold by nobody: the stone rose with no one on the boards. Now two of
// the keep's people come out of its hall when the scaffold goes up (look3Masons, each step from look3Scaffolds): they walk
// out of the hall's door, through the gate (it opens for its own) and round the walls to the scaffold (localPath, the
// townsfolk's way round what stands in the way); one dresses stone at its foot, the other climbs its ladder to the first
// lift (the towers' ladder motion) and works at the wall from the boards. A little before the work is done, or as soon as
// a foe comes near the keep or strikes one of them, the one above climbs down and both go home to the hall and in. They
// are the keep's own (its realm: the gate opens for them; its foes may strike them). Not saved: the masons come out again
// for a scaffold that stands after a load.
const MASON = { list: [], stats: { spawned: 0, climbed: 0, worked: 0, home: 0, fled: 0, stuck: 0 } };
function look3Masons(C, dt) {
  const S = C.S, K = S.keepRef;
  if (!K || C.kind === 'temple' || typeof HALL === 'undefined') return;
  const jobs = [];
  for (const W of C.sections || []) if (W.l3) jobs.push(W);
  if (C.pal) for (const W of C.pal.gaps) if (W.l3) jobs.push(W);
  if (C.gate && C.gate.w4 && C.gate.w4.l3) jobs.push(C.gate.w4); // [war4] a new gate hung behind a scaffold in the gateway (08l_war4.js)
  for (const W of jobs) {
    if (!W.l3.on) { W.masonsFor = null; continue; }
    if (look5MasonsAgain(C, W)) continue; // [look5] gone home from a foe, they come out again once the keep is quiet; a save's masons back at their work (13z_look5.js)
    if (W.masonsFor || GAME.t - (K.lastEnemyNear ?? -1e9) < 25 || (W.t || 0) > 0.8) continue;
    // (the outer run's ladder, where there are two: a curtain's scaffold stands on both its faces)
    const H = HALL.list.find((q) => q.S === S), L = W.l3.ladders.filter((q) => q.k === 0).sort((a, b) => dist2(b.fx, b.fz, S.x, S.z) - dist2(a.fx, a.fz, S.x, S.z))[0];
    if (!H || !L || !houseIntact(H)) { W.masonsFor = []; continue; }
    W.masonsFor = [0, 1].map((i) => look3MasonSpawn(C, W, H, L, i)).filter(Boolean).map((e) => e.id);
  }
}
function look3MasonSpawn(C, W, H, L, i) {
  const S = C.S, K = S.keepRef, D = H.door;
  const e = makeEnt({ kind: 'humanoid', faction: K.realm, role: 'mason', level: 1, name: 'Mason', x: D.out.x + (i ? 0.5 : -0.5) * Math.cos(S.yaw), z: D.out.z - (i ? 0.5 : -0.5) * Math.sin(S.yaw), y: H.y, look: villagerLook(K.realm), home: { x: D.out2.x, z: D.out2.z, r: 2 }, speed: 2.4 });
  if (typeof worldActorDevelop === 'function') worldActorDevelop(e);
  e.maxHp = e.hp = 420;
  e.y = floorAt(e.x, e.z, H.y + 0.3);
  e.yaw = Math.atan2(D.out2.x - D.out.x, D.out2.z - D.out.z);
  const up = i === 1;
  // the work: at the foot (a step out from the scaffold beside its ladder) or on the first lift's boards by the ladder
  const ux = L.ox - L.lx, uz = L.oz - L.lz, ul = Math.hypot(ux, uz) || 1, inx = Math.sin(L.yawW), inz = Math.cos(L.yawW);
  const foot = { x: L.fx + (ux / ul) * 2.2 - inx * 0.6, z: L.fz + (uz / ul) * 2.2 - inz * 0.6 };
  e.ai.mason = { C, W, H, L, up, st: 'out', foot, at: up ? { x: L.fx, z: L.fz } : foot, face: { x: inx, z: inz }, path: null, t: 0, last: { x: e.x, z: e.z, t: GAME.t }, hp: e.hp };
  setHouseDoor(H, true, e, true);
  for (let k = MASON.list.length - 1; k >= 0; k--) if (MASON.list[k].removed || !MASON.list[k].alive) MASON.list.splice(k, 1);
  MASON.list.push(e); MASON.stats.spawned++;
  return e;
}
// the gate's way through: a point inside the courtyard before it and one out on the field beyond it
function look3GateWay(S, round) {
  const gz = S.gateLocal.z;
  return [siteToWorld(S, S.gateLocal.x, gz - (round ? KEEP_T + 1.2 : KEEP_T + 1.4)), siteToWorld(S, S.gateLocal.x, gz + 3.6)];
}
// the way out to the scaffold (or home from it): out of the hall's door, across the courtyard to the gate, out through
// it, then round the keep outside its walls and towers (a square of the keep's size and a margin, or a circle round a
// rath), from corner to corner, to the work. (localPath leaves the walls out: they block only below their tops, so a
// way it found ran through them.) Each leg is walked straight; a leg that makes no headway is found round what stands
// in it (localPath over the colliders, short legs out on the field)
function look3MasonRoute(e, tx, tz, out) {
  const m = e.ai.mason, C = m.C, S = C.S, round = C.kind === 'round', [gin, gout] = look3GateWay(S, round);
  if (m.W && m.W.w4gate) { m.path = (out ? [m.H.door.out2, { x: tx, z: tz }] : [m.H.door.out2, m.H.door.out]).map((p) => ({ x: p.x, z: p.z })); return; } // [war4] the gate's scaffold stands in the court: across it, not out by the gate (08l_war4.js)
  const lt = siteLocal(S, out ? tx : e.x, out ? tz : e.z), mg = round ? RATH_R + 6.5 : KEEP_HS + 6.5;
  const ring = [];
  if (round) {
    // round the rath from the gate's side to the work's, a point every quarter of a right angle
    const a0 = Math.atan2(S.gateLocal.x, S.gateLocal.z), a1 = Math.atan2(lt.x, lt.z), da = angDiff(a0, a1), n = Math.max(1, Math.ceil(Math.abs(da) / 0.4));
    for (let i = 1; i < n; i++) { const a = a0 + (da * i) / n; ring.push(siteToWorld(S, Math.sin(a) * mg, Math.cos(a) * mg)); }
  } else {
    // round the square from the front: out to the corner on the work's side, then down that side (and along the back)
    const sx = lt.x >= 0 ? 1 : -1;
    if (lt.z < KEEP_HS - 2) {
      ring.push(siteToWorld(S, sx * mg, mg));
      if (lt.z < -(KEEP_HS - 2)) ring.push(siteToWorld(S, sx * mg, -mg));
    }
  }
  const pts = out ? [m.H.door.out2, gin, gout, ...ring, { x: tx, z: tz }] : [...ring.reverse(), gout, gin, m.H.door.out2, m.H.door.out];
  m.path = pts.map((p) => ({ x: p.x, z: p.z }));
}
function look3MasonThink(e, dt) {
  const m = e.ai.mason;
  if (!m) { removeEnt(e); return; }
  const W = m.W, K = m.C.S.keepRef, L = m.L;
  m.t += dt;
  // home: the work is about done, the scaffold is down, a foe is near the keep, or one of them was struck
  const threat = GAME.t - (K.lastEnemyNear ?? -1e9) < 3 || e.hp < m.hp - 1;
  if (m.st !== 'home' && m.st !== 'down' && (!W.l3 || !W.l3.on || (W.t || 0) > 0.9 || threat)) {
    if (threat) MASON.stats.fled++;
    m.st = e.y > L.wyb + 1 ? 'down' : 'home'; m.path = null;
  }
  if (e.motion) return; // on the ladder (updateNPCs hands the motion to updateMotion first)
  if (m.st === 'down') {
    // to the top of the ladder on the boards, then down it; [look4] each ladder climbed, the highest first (m.lad)
    const Ld = m.lad && m.lad.length ? m.lad[m.lad.length - 1] : L;
    if (m.lad && m.lad.length && e.y < Ld.wyt - 1) m.lad.pop();
    if (e.y < L.wyb + 1) { m.st = 'home'; m.path = null; return; }
    const Lc = m.lad && m.lad.length ? m.lad[m.lad.length - 1] : L;
    if (m.ws) { m.wsT = (m.wsT || 0) + dt; if (moveToward(e, m.ws.x, m.ws.z, dt, 0.8, 0.08) || m.wsT > 4) { m.ws = null; m.wsT = 0; } return; } // [motion5] (back out from the wall first)
    if (moveToward(e, Lc.ox, Lc.oz, dt, 0.8, 0.12) && !towerClimb(e, Lc, -1)) { m.st = 'home'; m.path = null; }
    return;
  }
  if (m.st === 'up') {
    // on the boards: a step along from the ladder's top, facing the wall, and to work
    m.st = 'work'; m.wallD = undefined; m.ws = { x: e.x, z: e.z }; // [motion5] (in to the wall again from here, and back out to here before going on)
    m.lad = m.lad || [L]; m.workT = m.t; // [look4] the ladders climbed so far, and when the work there began
    return;
  }
  // [look4] up to the next lift as the work comes up to it (look4LiftStep, 04d_look4.js): along the boards to its ladder
  // and up (version 14's masons kept to the first lift)
  if (m.st === 'climb') {
    const Ln = m.nextL;
    if (!Ln || Ln.gone) { m.st = 'work'; return; }
    // [motion5] first back out from the wall to where the work began on these boards (stepped in to the mallet's reach, a
    // way straight on to the next ladder could run into a tower's curved wall), then on along the boards
    if (m.ws) { m.wsT = (m.wsT || 0) + dt; if (moveToward(e, m.ws.x, m.ws.z, dt, 0.8, 0.08) || m.wsT > 4) { m.ws = null; m.wsT = 0; } return; }
    if (moveToward(e, Ln.fx, Ln.fz, dt, 0.8, 0.15)) { if (towerClimb(e, Ln, 1)) { m.lad.push(Ln); m.st = 'up'; MASON.stats.climbed++; sfxAtE('creak', e, null, 0.3); /* [audio2] */ } else m.st = 'work'; }
    return;
  }
  if (m.st === 'work' && m.up && m.lad && m.t - (m.workT ?? m.t) > 10) {
    const top = m.lad[m.lad.length - 1], Ln = W.l3 && W.l3.ladders.filter((q) => q.k === top.k + 1 && !q.gone).sort((a, b) => dist2(a.fx, a.fz, e.x, e.z) - dist2(b.fx, b.fz, e.x, e.z))[0];
    if (Ln && dist(e.x, e.z, Ln.fx, Ln.fz) < 30) { m.nextL = Ln; m.st = 'climb'; return; } // (m.next is the next blow's time)
    m.workT = m.t;
  }
  if (m.st === 'work') {
    turnToward(e, e.x + m.face.x, e.z + m.face.z, dt * 4);
    // [motion5] first in to where the mallet meets the wall (HAMMER_REACH, 13y_motion5.js): along the boards or under them,
    // a step at a time, until the wall is that far or the way in is blocked
    if (m.wallD === undefined) { const R = shotHit(e.x, e.y + 1.2, e.z, e.x + m.face.x * 3, e.y + 1.2, e.z + m.face.z * 3, { ground: false }); m.wallD = R ? R.t * 3 : -1; }
    if (m.wallD > HAMMER_REACH + 0.04) { const s0 = Math.min(m.wallD - HAMMER_REACH, dt * 1.2), x0 = e.x, z0 = e.z; stepTo(e, e.x + m.face.x * s0, e.z + m.face.z * s0); const mv = Math.hypot(e.x - x0, e.z - z0); m.wallD = mv > 1e-4 ? m.wallD - mv : -1; return; }
    m.next = m.next ?? m.t + 0.5;
    e._hamUntil = GAME.t + 0.4; // [motion5] a mallet in the hand, and a hammer's blow onto the wall (action 23, 05a_rig.js)
    if (m.t >= m.next) {
      m.next = m.t + 1.05 + Math.random() * 0.5; MASON.stats.worked++;
      setAct(e, 23, 1.05);
      m.sndN = (m.sndN || 0) + 1;
      later(0.68, () => { if (e.alive && !e.removed) { sfxAtE(m.up ? 'mallet' : 'chisel', e, null, 1.3); if (m.up && m.sndN % 2 === 0) sfxAtE('creak', e, { at: 0.3 }, 0.05); } }); // [audio2] the one at the foot dresses the stone, the one above sets it on creaking boards (11c_sound.js); [motion5] as the mallet meets the wall
    }
    return;
  }
  // on the way out or home: along the route, a point at a time; no headway for a while, the way is found again
  if (!m.path) look3MasonRoute(e, m.at.x, m.at.z, m.st === 'out');
  const p = m.path[0];
  if (!p) {
    if (m.st === 'out') {
      if (m.up) { if (towerClimb(e, L, 1)) { m.st = 'up'; MASON.stats.climbed++; sfxAtE('creak', e, null, 0.3); /* [audio2] */ } else { m.at = { x: L.fx, z: L.fz }; m.path = [m.at]; } }
      else m.st = 'work';
    } else { setHouseDoor(m.H, true, e, true); MASON.stats.home++; removeEnt(e); }
    return;
  }
  const near = m.path.length > 1 ? 0.6 : m.st === 'out' && m.up ? 0.15 : 0.3;
  if (moveToward(e, p.x, p.z, dt, 0.95, near)) m.path.shift();
  // headway: 4 s without getting a metre on, this leg is found round what stands in it; ten times and the mason gives
  // up the work (or, on the way home, goes in where it is: out of the way)
  if (Math.hypot(e.x - m.last.x, e.z - m.last.z) > 1) m.last = { x: e.x, z: e.z, t: GAME.t };
  else if (GAME.t - m.last.t > 4) {
    m.last.t = GAME.t; m.tries = (m.tries || 0) + 1;
    const lp = localPath(e.x, e.z, p.x, p.z, 0.45, 60);
    if (lp && lp.length) m.path.splice(0, 1, ...lp);
    if (m.tries > 10) { MASON.stats.stuck++; if (m.st === 'out') { m.st = 'home'; m.path = null; } else removeEnt(e); }
  }
}

// test hooks (tools/tests/look3.py)
queueMicrotask(() => {
  if (!window.__hm) return;
  window.__hm.look3 = {
    LOOK3, look3HallPlan, MASON, LOOK3S, look3Masons,
    // what each scaffold laid (standards, bays, boards, ladders), by kind
    scaffolds: (lay) => {
      const out = [];
      for (const C of CASTLES) for (const W of C.sections || []) {
        if (lay && !W.scafInfo && W.scaffold) look3Lay(C, W); // (laid out now, as when first put up)
        if (W.scafInfo) out.push({ kind: W.kind, k: W.k, keep: C.S.name, info: W.scafInfo });
      }
      return out;
    },
    look3Lay,
    look3Clear,
  };
});
