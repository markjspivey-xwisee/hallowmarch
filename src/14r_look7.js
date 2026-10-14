/* ================================================================== */
/* [look7] the world looked at again with version 19's additions       */
/* ================================================================== */
// (version 20) What is new code rather than a small change where the fault was (those carry [look7] marks in their own
// modules).
//
// The realm's stores yard (08m_loops.js loopsYardInit) stood on a rectangle of bare, bright turf (its collider's cover
// map, with no blade in it), a carpet in the meadow, and no way led to it. A stores yard is trodden: its ground is bare
// earth, worn ragged at its edge and short round it, and a footpath leads from it past the quartermaster to the plaza's
// edge, as the houses' paths do (13t_look.js, 13u_look2.js): the 1 m path map (uGroundAO.g, the terrain draws it as
// trodden earth) and the cover map (no blade on the yard's ground or its path, short turf beside them).
const LOOK7 = { yards: [], stats: { yardTexels: 0, pathTexels: 0 } };
// the yard's ground and its path, in the world: segments [ax, az, bx, bz, w] and the yard's box
function look7YardPlan(Y) {
  const R = REALMS[Y.r], S = R.town, Q = R.quartermaster;
  const c = Math.cos(Y.yaw), sn = Math.sin(Y.yaw);
  const bx = Y.x + YARD_BOX.x * c + YARD_BOX.z * sn, bz = Y.z - YARD_BOX.x * sn + YARD_BOX.z * c;
  const P = { Y, box: { x: bx, z: bz, hx: YARD_BOX.hx + 0.7, hz: YARD_BOX.hz + 0.7, c, s: sn }, segs: [] };
  if (Q) {
    // from the yard's edge nearest the quartermaster to where he stands, then on toward the plaza's edge (12.5 m out)
    const l = { x: (Q.x - bx) * c - (Q.z - bz) * sn, z: (Q.x - bx) * sn + (Q.z - bz) * c };
    const ex = clamp(l.x, -P.box.hx, P.box.hx), ez = clamp(l.z, -P.box.hz, P.box.hz);
    const e = { x: bx + ex * c + ez * sn, z: bz - ex * sn + ez * c };
    P.segs.push({ ax: e.x, az: e.z, bx: Q.x, bz: Q.z, w: 1.6 });
    const dx = S.x - Q.x, dz = S.z - Q.z, d = Math.hypot(dx, dz) || 1, end = Math.max(0, d - 12.5);
    if (end > 0.5) P.segs.push({ ax: Q.x, az: Q.z, bx: Q.x + (dx / d) * end, bz: Q.z + (dz / d) * end, w: 1.6 });
  }
  return P;
}
// how far (x, z) lies out from the yard's trodden ground (< 0 inside), its edge ragged
function look7YardOut(P, x, z) {
  const B = P.box, dx = x - B.x, dz = z - B.z, lx = dx * B.c - dz * B.s, lz = dx * B.s + dz * B.c;
  const o = Math.max(Math.abs(lx) - B.hx, Math.abs(lz) - B.hz);
  return o + (vnoise(x * 0.9 + 17.3, z * 0.9 - 4.1) - 0.5) * 0.9;
}
// into the path map (the terrain's trodden earth: groundPath, 02_render.js), once the yards stand
function look7YardGround(Y) {
  const T = U.uGroundAO.value, rg = T && T.image && T.image.data;
  if (!rg || rg.length < 1024 * 1024 * 2) return;
  const P = look7YardPlan(Y);
  LOOK7.yards.push(P);
  const R = 1024, B = P.box, rad = Math.hypot(B.hx, B.hz) + 2;
  const put = (i, j, v) => { const q = (j * R + i) * 2 + 1; if (v > rg[q]) { rg[q] = v; return 1; } return 0; };
  for (let j = Math.max(0, Math.floor(B.z - rad + 512)); j <= Math.min(R - 1, Math.ceil(B.z + rad + 512)); j++) {
    for (let i = Math.max(0, Math.floor(B.x - rad + 512)); i <= Math.min(R - 1, Math.ceil(B.x + rad + 512)); i++) {
      const x = i - 512 + 0.5, z = j - 512 + 0.5, o = look7YardOut(P, x, z);
      LOOK7.stats.yardTexels += put(i, j, Math.round(255 * sstep(0.9, -0.4, o)));
    }
  }
  for (const S of P.segs) {
    const hw = S.w / 2, pad = hw + 1.2;
    for (let j = Math.max(0, Math.floor(Math.min(S.az, S.bz) - pad + 512)); j <= Math.min(R - 1, Math.ceil(Math.max(S.az, S.bz) + pad + 512)); j++) {
      for (let i = Math.max(0, Math.floor(Math.min(S.ax, S.bx) - pad + 512)); i <= Math.min(R - 1, Math.ceil(Math.max(S.ax, S.bx) + pad + 512)); i++) {
        const x = i - 512 + 0.5, z = j - 512 + 0.5, pd = lookSegD(x, z, S);
        LOOK7.stats.pathTexels += put(i, j, Math.round(255 * sstep(hw + 0.9, hw - 0.35, pd)));
      }
    }
  }
  T.needsUpdate = true;
  if (COVER.tex) { look7CoverYard(P); COVER.tex.needsUpdate = true; }
}
// the cover map's share: no blade on the yard's trodden ground or its path, short turf round them (buildCoverMask's last
// word, after lookCoverAll; it only ever raises a texel)
function look7CoverYard(P) {
  const R = COVER.res, data = COVER.data, B = P.box, rad = Math.hypot(B.hx, B.hz) + 2.5;
  const raise = (i, j, v) => { const k = j * R + i; if (v > data[k]) data[k] = v; };
  for (let j = Math.max(0, Math.floor(B.z - rad + 512)); j <= Math.min(R - 1, Math.ceil(B.z + rad + 512)); j++) {
    for (let i = Math.max(0, Math.floor(B.x - rad + 512)); i <= Math.min(R - 1, Math.ceil(B.x + rad + 512)); i++) {
      const o = look7YardOut(P, i - 512 + 0.5, j - 512 + 0.5);
      if (o < 0.25) raise(i, j, LOOK_PATH); else if (o < 1.6) raise(i, j, Math.round(LOOK_GREEN * (0.8 + 0.2 * sstep(1.6, 0.4, o))));
    }
  }
  for (const S of P.segs) {
    const hw = S.w / 2, pad = hw + 1.0;
    for (let j = Math.max(0, Math.floor(Math.min(S.az, S.bz) - pad + 512)); j <= Math.min(R - 1, Math.ceil(Math.max(S.az, S.bz) + pad + 512)); j++) {
      for (let i = Math.max(0, Math.floor(Math.min(S.ax, S.bx) - pad + 512)); i <= Math.min(R - 1, Math.ceil(Math.max(S.ax, S.bx) + pad + 512)); i++) {
        const pd = lookSegD(i - 512 + 0.5, j - 512 + 0.5, S);
        if (pd < hw) raise(i, j, LOOK_PATH); else if (pd < hw + 0.8) raise(i, j, LOOK_GREEN);
      }
    }
  }
}
function look7CoverAll() { for (const P of LOOK7.yards) look7CoverYard(P); }

/* ---- test hooks ---- */
queueMicrotask(() => {
  if (!window.__hm) return;
  window.__hm.look7 = { LOOK7, look7YardPlan, look7YardOut };
});

// A cart lost on the road (08m_loops.js loopsCarLost) was drawn rolled half a radian about the ground under its axle and
// sunk a quarter metre: its low wheel and the bed's side went into the road, the other wheel stood off it, its shafts
// stood out level in the air with no horse between them, and its load was gone. A cart with no horse rests on its
// shafts' tips; one wrecked has lost a wheel: it lies on the stub of its axle, its other wheel and its shafts, the wheel
// that came off lying flat in the road beside it, and what it carried left in its bed to burn. Every pose is set down on
// the ground under the points it rests on (each point's own height of the ground), never sunk into it.
const L7CART = { s: [], stats: { wrecks: 0, rests: 0 } };
const _l7E = new THREE.Euler(0, 0, 0, 'YXZ'), _l7M = new THREE.Matrix4(), _l7V = new THREE.Vector3();
// the points a cart rests on, in its own frame (x across, y up from the ground under the axle, z forward)
function look7CartPts(s) {
  const C = LOOPS_CART, out = [[0.5, 0.91, 0.9 + C.shaftL], [-0.5, 0.91, 0.9 + C.shaftL]];
  if (s) out.push([-s * C.track, 0, 0.12], [-s * C.track, 0, -0.12], [s * 0.9, C.wheelR - 0.06, 0], [s * 0.71, 0.63, 1.15], [s * 0.71, 0.63, -1.15], [s * 0.72, 0.73, 1.0], [s * 0.72, 0.73, -1.0]);
  else out.push([C.track, 0, 0], [-C.track, 0, 0]);
  return out;
}
// the root's height for a turn (pitch, yaw, roll) so that the lowest of its points just touches the ground under it
function look7CartSettle(K, ax, az, pitch, yaw, roll, s) {
  _l7E.set(pitch, yaw, roll, 'YXZ'); _l7M.makeRotationFromEuler(_l7E);
  let y = -1e9;
  for (const p of look7CartPts(s)) {
    _l7V.set(p[0], p[1], p[2]).applyMatrix4(_l7M);
    y = Math.max(y, heightAt(ax + _l7V.x, az + _l7V.z) - _l7V.y);
  }
  return y;
}
// from loopsDraw, once the cart's pose and load are set as before: a horseless or wrecked cart posed again
function look7CartPose(c, K, dt, horse) {
  const C = LOOPS_CART, wreck = c.state === 'wreck';
  // what it carried most of, kept for its wreck (loopsCarLost empties the load)
  if (!wreck) { let top = null, tq = 0; for (const g of LOOPS_K) if ((c.load[g] || 0) > tq) { tq = c.load[g]; top = g; } if (top) K.l7top = top; }
  if (!wreck && horse && horse.alive) { if (K.l7k) K.l7k = 0; return false; }
  // on its shafts' tips (no horse): nose down until they reach the ground; wrecked: rolled onto the side it lost a wheel
  const s = wreck ? (c.id % 2 ? 1 : -1) : 0;
  K.l7k = Math.min(1, (K.l7k || 0) + dt * (wreck ? 1.6 : 2.5));
  const k = smooth(K.l7k), pitch = (wreck ? 0.2 : 0.28) * k, roll = (wreck ? -s * 0.29 : Math.atan2(heightAt(c.ax + Math.cos(c.yaw) * C.track, c.az - Math.sin(c.yaw) * C.track) - heightAt(c.ax - Math.cos(c.yaw) * C.track, c.az + Math.sin(c.yaw) * C.track), C.track * 2)) * (wreck ? k : 1);
  K.root.rotation.set(pitch, c.yaw, roll);
  K.root.position.set(c.ax, look7CartSettle(K, c.ax, c.az, pitch, c.yaw, roll, s), c.az);
  if (wreck) {
    if (!K.l7wreck) {
      K.l7wreck = true; L7CART.stats.wrecks++;
      // the wheel that came off, lying flat in the road beside the cart
      const w = K.wheels[s > 0 ? 1 : 0];
      w.removeFromParent();
      const cs = Math.cos(c.yaw), sn = Math.sin(c.yaw), ox = s * 1.45, oz = -0.55;
      const wx = c.ax + ox * cs + oz * sn, wz = c.az - ox * sn + oz * cs;
      w.position.set(wx, heightAt(wx, wz) + 0.11, wz); w.rotation.set(0, c.yaw + 0.7, Math.PI / 2);
      scene.add(w); K.l7loose = w;
    }
    for (const g of LOOPS_K) K.loads[g].visible = g === K.l7top;
  } else L7CART.stats.rests++;
  return true;
}
function look7CartFree(K) { if (K && K.l7loose) { K.l7loose.removeFromParent(); K.l7loose = null; } }
