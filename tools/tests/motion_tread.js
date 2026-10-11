(() => {
  // the player up a keep's stair: for each frame where a foot stands still (moves under a fifth of the body's pace and is
  // within 12 cm of the floor under it), how high it is over that floor (a foot on its tread: about 0; a foot set on the
  // flight's slope line: up to half a riser off, above or below)
  const H = __hm, K = H.WAR.keeps.find((K) => K.orig === 0 && K.site === H.REALMS[0].keepSites[0]), S = K.site, P = H.GAME.player, w = (lx, lz) => H.fn.siteToWorld(S, lx, lz);
  const a = w(10.6, -7.6); P.x = P.prevX = a.x; P.z = P.prevZ = a.z; P.y = S.y; P.faction = 0; P.onGround = true; P.vy = 0; H.simulate(0.3, 1 / 60);
  const pts = [w(13.0, -6.6), w(13.0, 3.4), w(13.0, 4.1)];
  H.UI.modal = null; H.INPUT.keys.clear(); H.INPUT.keys.add('KeyW');
  let k = 0;
  const E = { e: P, kind: 'human', which: ['feet'], drive(e) { while (k < pts.length - 1 && Math.hypot(pts[k].x - e.x, pts[k].z - e.z) < 0.45) k++; H.CAM.yaw = Math.atan2(pts[k].x - e.x, pts[k].z - e.z); } };
  const rec = MO.M.motionRun([E], 4.5, 1 / 60, { cam: () => { H.UI.modal = null; MO.chase(P); } })[0];
  H.INPUT.keys.clear();
  // the tread over a point (the flight's floor is one ramp joining the treads' back edges, castleFlight): worked out here
  // from the flights themselves, so the measure is the same for a build that sets its feet on the ramp
  const flights = [];
  for (const C of H.fn.castles()) for (const f of C.floors || []) if (f.flight && f.type === 'box' && f.yb !== f.ya) flights.push(f);
  const treadFloor = (x, z, y) => {
    const g = MO.M.motionFloor(x, z, y);
    for (const f of flights) {
      const dx = x - f.x, dz = z - f.z, lx = dx * f.cos - dz * f.sin, lz = dx * f.sin + dz * f.cos;
      if (lx < -f.hx || lx > f.hx || lz < -f.hz || lz > f.hz) continue;
      const frac = (lz + f.hz) / (2 * f.hz), t = f.ya + (f.yb - f.ya) * frac;
      if (g < t - 0.02 || g > t + 0.3) continue; // (something else stands highest here)
      const n = Math.max(2, Math.round((f.flight.y1 - f.flight.y0) / 0.27));
      return f.ya + (f.yb - f.ya) * Math.min(n, Math.floor(frac * n + 1e-6) + 1) / n;
    }
    return g;
  };
  const Sm = rec.filter((s) => s.t > 0.5 && s.L && s.L.feet);
  const dt = Sm[1].t - Sm[0].t, hs = [], ys = [];
  for (let i = 1; i < Sm.length; i++) {
    const vb = Math.hypot(Sm[i].x - Sm[i - 1].x, Sm[i].z - Sm[i - 1].z) / dt;
    if (vb < 1) continue;
    for (let f = 0; f < 2; f++) {
      const p = Sm[i].L.feet[f], q = Sm[i - 1].L.feet[f];
      if (!p || !q) continue;
      const vf = Math.hypot(p[0] - q[0], p[2] - q[2]) / dt, fl = treadFloor(p[0], p[2], Sm[i].y), h = p[3] - fl;
      if (vf < 0.2 * vb && h < 0.12) hs.push(h);
    }
    ys.push(Sm[i].y);
  }
  hs.sort((a, b) => a - b);
  const q = (k) => hs.length ? +(hs[Math.min(hs.length - 1, Math.round(k * (hs.length - 1)))] * 100).toFixed(1) : null;
  const absS = hs.map(Math.abs).sort((a, b) => a - b), qa = (k) => absS.length ? +(absS[Math.min(absS.length - 1, Math.round(k * (absS.length - 1)))] * 100).toFixed(1) : null;
  return ({ n: hs.length, rise: +(ys[ys.length - 1] - ys[0]).toFixed(2), p10: q(0.1), median: q(0.5), p90: q(0.9), absMedian: qa(0.5), absP90: qa(0.9), off3: +(absS.filter((x) => x > 0.03).length / Math.max(1, absS.length)).toFixed(2) });
})()
