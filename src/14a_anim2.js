/* ================================================================== */
/* [anim2] bodies that never break: no leg left in the air, weapons    */
/* held and used as weapons are, Cinderwing's fall and every death     */
/* ================================================================== */
// The measures (tests; window.__hm.anim2): a probe that reads, for every body the crowds draw near the camera, where
// chosen points of it land in the world (13r_motion.js's probe reads eight bodies at a time, found by their place; this
// one reads up to 128 a pass), and a search over a running war, the duels and the player's
// own doings for a foot well off the floor while the body stands or walks (A2.finds, grouped by what the body was doing).
const A2 = { W: 64, H: 128, rt: null, buf: null, cam: null, scene: null, mats: new Map(), geos: new Map(), stats: { scans: 0, frames: 0, bodies: 0, looked: 0, nullFeet: 0 }, hist: {}, ep: {}, finds: [], sig: new Map(), dead: [], keep: 6 };
function a2ProbeMat(src) {
  let m = A2.mats.get(src);
  if (m) return m;
  const vs0 = src.vertexShader;
  if (!vs0.includes('void main(){')) throw new Error('[anim2] probe: the shader has no main');
  // (the chosen vertices found by their rest position and the instances by their place, as 13r_motion.js's probe does:
  // gl_InstanceID counts as an attribute under SwiftShader, and the people use 15 of the 16; up to 128 a pass)
  const vs = vs0.replace('void main(){', 'void a2Main(){') + `
  uniform vec3 uA2Sel[${A2.W}]; uniform vec2 uA2Inst[${A2.H}];
  varying vec4 vA2W;
  void main(){
    gl_Position = vec4(0.0, 0.0, -2.0, 1.0);
    a2Main();
    bool hidden = gl_Position.z < -1.99 && gl_Position.x == 0.0 && gl_Position.y == 0.0;
    vA2W = vec4(gl_Position.xyz / gl_Position.w, hidden ? 0.5 : 1.0);
    int slot = -1, inst = -1;
    for (int i = 0; i < ${A2.W}; i++) if (uA2Sel[i] == position) slot = i;
    gl_PointSize = 1.0;
    if (slot >= 0) for (int j = 0; j < ${A2.H}; j++) if (uA2Inst[j] == iPos.xz) inst = j;
    if (slot < 0 || inst < 0) { gl_Position = vec4(3.0, 3.0, 3.0, 1.0); return; }
    gl_Position = vec4((float(slot) + 0.5) / ${A2.W}.0 * 2.0 - 1.0, (float(inst) + 0.5) / ${A2.H}.0 * 2.0 - 1.0, 0.0, 1.0);
  }`;
  m = new THREE.ShaderMaterial({
    uniforms: { ...src.uniforms, uA2Sel: { value: Array.from({ length: A2.W }, () => new THREE.Vector3(1e9, 1e9, 1e9)) }, uA2Inst: { value: Array.from({ length: A2.H }, () => new THREE.Vector2(1e9, 1e9)) } },
    vertexShader: vs, fragmentShader: 'varying vec4 vA2W; void main(){ gl_FragColor = vA2W; }',
    depthTest: false, depthWrite: false, blending: THREE.NoBlending,
  });
  A2.mats.set(src, m);
  return m;
}
// world places of vertices vids (up to 64) of every instance a crowd drew this frame: out[inst][slot] = [x, y, z] or null
function a2Probe(crowd, vids) {
  if (!A2.rt) {
    A2.rt = new THREE.WebGLRenderTarget(A2.W, A2.H, { type: THREE.FloatType, format: THREE.RGBAFormat, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: false, stencilBuffer: false });
    A2.cam = new THREE.Camera(); A2.scene = new THREE.Scene(); A2.buf = new Float32Array(A2.W * A2.H * 4);
  }
  const m = a2ProbeMat(crowd.mesh.material), n = crowd.n, pos = crowd.geo.attributes.position.array, ip = crowd.attrs[0].array;
  let G = A2.geos.get(crowd);
  if (!G) {
    const g = new THREE.InstancedBufferGeometry();
    for (const k in crowd.geo.attributes) g.setAttribute(k, crowd.geo.attributes[k]);
    G = { g, key: '', pts: null };
    A2.geos.set(crowd, G);
  }
  const key = vids.join(',');
  if (G.key !== key) { G.g.setIndex(new THREE.BufferAttribute(new Uint32Array(vids), 1)); G.key = key; }
  G.g.instanceCount = n;
  m.uniforms.uA2Sel.value.forEach((u, i) => { const v = vids[i]; if (v === undefined) u.set(1e9, 1e9, 1e9); else u.set(pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]); });
  if (!G.pts) { G.pts = new THREE.Points(G.g, m); G.pts.frustumCulled = false; }
  A2.scene.add(G.pts);
  const rtWas = renderer.getRenderTarget(), ac = renderer.autoClear, cc = new THREE.Color(), ca = renderer.getClearAlpha();
  renderer.getClearColor(cc);
  renderer.autoClear = false;
  const out = [];
  for (let i0 = 0; i0 < n; i0 += A2.H) {
    m.uniforms.uA2Inst.value.forEach((u, j) => { const k = i0 + j; if (k >= n) u.set(1e9, 1e9); else u.set(ip[k * 4], ip[k * 4 + 2]); });
    renderer.setRenderTarget(A2.rt);
    renderer.setClearColor(0x000000, 0);
    renderer.clear(true, false, false);
    renderer.render(A2.scene, A2.cam);
    renderer.readRenderTargetPixels(A2.rt, 0, 0, A2.W, A2.H, A2.buf);
    for (let j = 0; j < A2.H && i0 + j < n; j++) {
      const row = [];
      for (let i = 0; i < vids.length; i++) { const k = (j * A2.W + i) * 4, b = A2.buf; row.push(b[k + 3] > 0.75 ? [b[k], b[k + 1], b[k + 2]] : null); }
      out.push(row);
    }
  }
  renderer.setRenderTarget(rtWas); renderer.setClearColor(cc, ca); renderer.autoClear = ac;
  A2.scene.remove(G.pts);
  return out;
}
// the points of a person looked at: each foot's sole (heel to toe), and for a body lying dead points over the whole of it
// (the extremes of each bone's own skin, no gear)
function a2Parts(crowd, kind) {
  crowd._a2Parts = crowd._a2Parts || {};
  if (crowd._a2Parts[kind]) return crowd._a2Parts[kind];
  const P = motionParts(crowd, kind), A = crowd.geo.attributes, pos = A.position.array, bone = A.aBone.array, bit = A.aBit ? A.aBit.array : null, n = A.position.count;
  // (one vertex for each rest place: the probe finds a vertex by its place, and two sharing one wrote to one slot)
  const seen = new Set(), uniq = (ids) => ids.filter((i) => { const k = pos[i * 3].toFixed(5) + ',' + pos[i * 3 + 1].toFixed(5) + ',' + pos[i * 3 + 2].toFixed(5); if (seen.has(k)) return false; seen.add(k); return true; });
  const Q = { feet: P.feet.map((g) => uniq(g).slice(0, kind === 'human' ? 5 : 4)), body: [] };
  if (kind === 'human') {
    // the skin's extremes bone by bone (up, down, ahead, behind, out to each side): where a body lying dead meets the floor
    const skin = (i) => (!bit || bit[i] < -0.5);
    for (const b of [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) {
      const ids = [];
      for (let i = 0; i < n; i++) if (Math.round(bone[i]) === b && skin(i)) ids.push(i);
      if (!ids.length) continue;
      for (const [ax, sg] of [[1, -1], [1, 1], [2, -1], [2, 1], [0, -1], [0, 1]]) {
        let best = ids[0];
        for (const i of ids) if (sg * pos[i * 3 + ax] > sg * pos[best * 3 + ax]) best = i;
        if (!Q.body.includes(best) && uniq([best]).length) Q.body.push(best);
      }
    }
    Q.body = Q.body.slice(0, A2.W - 10);
  }
  crowd._a2Parts[kind] = Q;
  return Q;
}
// the floor under a point of a body standing at y (a drop of more than 0.6 m beyond a wall walk's edge or a deck's is no
// floor for its foot: the body's own, as the foot lock reads it)
function a2Floor(x, z, y) { const h = motionFloor(x, z, y); return y - h > 0.6 ? y : h; }
// how high a person's swinging foot goes at its pace (HUMAN_GAIT's liftH), in metres: what a foot in the air may be
function a2LiftOf(e) {
  const sc = e.scale || 1, amt = clamp(e.anim.amt, 0, 2.2), vel = amt * 4.3 / Math.max(sc, 0.3), runK = _flSS(2.4, 4.4, vel), stepS = Math.min(humanStep(vel), humanStepCap(humanSlopeQ(e)));
  const turnK = e.anim.turn > 0.05 && e.anim.amt < 0.15 ? clamp(e.anim.turn, 0, 1) : 0;
  // (a runner's heel kicks up close to its seat: the lowest of its sole 0.55 m up at 6 m/s is its stride, not a leg left up)
  return (Math.max(lerp(0.1, 0.3, runK) * Math.min(1, stepS / 0.42) * _flSS(0, 0.04, amt), 0.075 * turnK) + 0.22 * runK) * sc;
}
// a body on its feet: alive, standing or walking on a floor (not in the air, a leap, on a ladder, falling, in the water,
// in a saddle, a seat or a boat)
function a2OnFeet(e) {
  return e.alive && !e.mount && !e.seat && !e.boat && !(e.swimK > 0.05) && !e.swim && !e.dive && e.onGround !== false && !e.motion && !e.flying && !e.l3fall && e.role !== 'bird' && e.kind !== 'hen';
}
// what a body is doing, for grouping what is found
function a2What(e) {
  const a = e.anim || {}, act = a.actDur > 0 ? a.act : 0, av = Math.floor(animActValue(e) + 1e-4);
  const sp = Math.hypot(e.x - (e.prevX ?? e.x), e.z - (e.prevZ ?? e.z));
  return { act, av, amt: +clamp(a.amt, 0, 9).toFixed(2), turn: +(a.turn || 0).toFixed(2), stun: typeof isStunned === 'function' && isStunned(e) ? 1 : 0, cast: e.casting ? e.casting.id : null, role: e.role, kind: e.kind, cls: e.cls || null, fixed: e.fixedY != null ? 1 : 0, sp: +sp.toFixed(3) };
}
// one look at every body drawn this frame near the camera (within r m): living bodies on their feet with a foot well off
// the floor are written down (A2.finds, A2.sig: grouped by the body's kind and action), and bodies lying dead are
// measured (A2.dead: the lowest point of the body over the floor under it, and the highest of its feet and knees)
function a2Scan(opt = {}) {
  const r = opt.r ?? 60, camX = camera.position.x, camZ = camera.position.z;
  A2.stats.scans++;
  // the bodies by their place (as the crowds hold it)
  const at = new Map();
  for (const e of ENT) {
    if (e.removed || e.kind === 'door' || e.kind === 'dragon' || e.kind === 'wisp') continue;
    if (dist2(e.x, e.z, camX, camZ) > r * r) continue;
    at.set(Math.fround(e.x) + ',' + Math.fround(e.z), e);
  }
  const res = [];
  for (const [kind, c] of motionCrowds()) {
    if (!c.n) continue;
    if (kind !== 'human' && !(BEASTS[kind] && BEASTS[kind].front)) continue;
    const Q = a2Parts(c, kind), feet = Q.feet, fv = feet.flat(), vids = kind === 'human' ? fv.concat(Q.body) : fv;
    const ip = c.attrs[0].array;
    let rows = null;
    for (let i = 0; i < c.n; i++) {
      const e = at.get(ip[i * 4] + ',' + ip[i * 4 + 2]);
      if (!e) continue;
      if (!rows) rows = a2Probe(c, vids);
      const row = rows[i];
      A2.stats.looked++;
      // each foot's lowest point over the floor under it
      const fh = [];
      let k = 0;
      for (const g of feet) {
        let lo = null;
        for (let q = 0; q < g.length; q++, k++) { const p = row[k]; if (!p) continue; const h = p[1] - a2Floor(p[0], p[2], e.y); if (lo === null || h < lo) lo = h; }
        fh.push(lo);
      }
      const R = { e, kind, fh };
      if (kind === 'human' && !e.alive && e.anim.death >= 1 && !(e.removeAt < Infinity && GAME.t > e.removeAt - 2.5)) {
        let lo = Infinity, hi = -Infinity, top = -Infinity;
        const bone = c.geo.attributes.aBone.array, byB = {};
        for (let q = fv.length; q < vids.length; q++) { const p = row[q]; if (!p) continue; const h = p[1] - motionFloor(p[0], p[2], e.y); lo = Math.min(lo, h); top = Math.max(top, h); const b = Math.round(bone[vids[q]]); byB[b] = Math.min(byB[b] ?? 9, +h.toFixed(3)); }
        R.deadTop = top; R.deadBones = byB;
        for (const h of fh) if (h !== null) hi = Math.max(hi, h);
        R.deadLo = lo; R.deadHi = hi;
        if (A2.dead.length < 400) A2.dead.push({ id: e.id, role: e.role, lo: +lo.toFixed(3), feetHi: +hi.toFixed(3), x: +e.x.toFixed(1), z: +e.z.toFixed(1) });
      }
      res.push(R);
      if (!a2OnFeet(e)) continue;
      // too high: a foot over what its swing reaches at this pace (a fifth more, and 8 cm), and at least 20 cm; or a body
      // standing still with both feet off the floor
      const lift = kind === 'human' ? a2LiftOf(e) : 0.12 * (e.scale || 1) * (1 + clamp(e.anim.amt, 0, 2));
      const lim = Math.max(opt.lim ?? 0.2, 1.25 * lift + 0.08);
      const hiF = Math.max(...fh.map((h) => h ?? -1)), loF = Math.min(...fh.map((h) => h ?? 9));
      const stand = e.anim.amt < 0.03 && !(e.anim.turn > 0.05);
      const bad = hiF > lim ? 'high' : stand && loF > (opt.hover ?? 0.1) && loF < 9 ? 'hover' : null; // (hover: a flat sole on a hillside stands on its highest point, as the foot lock reads its floor, and its lowest point is a few centimetres over the ground under it)
      A2.stats.bodies++;
      // (episodes: how long a body stays so, by what it was doing: a foot carried up for a frame or two as a stride stops
      // is not one left in the air)
      const t = GAME.t;
      if (hiF < 0) A2.stats.nullFeet++;
      { const hk = (kind === 'human' ? 'h' : 'b') + (stand ? 's' : 'm') + Math.min(10, Math.max(-3, Math.floor(hiF / 0.05))); A2.hist[hk] = (A2.hist[hk] || 0) + 1; }
      if (!bad) { if (e._a2ep) { a2EpEnd(e, t); } continue; }
      const w = a2What(e), sig = `${kind}|${bad}|act${w.act}|av${w.av}${w.stun ? '|stun' : ''}${w.cast ? '|cast' : ''}${stand ? '|still' : ''}`;
      if (!e._a2ep) e._a2ep = { t0: t, sig, hi: 0 };
      e._a2ep.t1 = t; e._a2ep.hi = Math.max(e._a2ep.hi, hiF);
      const S = A2.sig.get(sig) || { sig, n: 0, ex: [] };
      S.n++;
      if (S.ex.length < A2.keep) {
        const L = e._fl ? e._fl.map((o) => o ? { down: o.down ? 1 : 0, hop: +(o.hop || 0).toFixed(2), air: o.air ? 1 : 0, frozen: o.frozen ? 1 : 0, w: +(o.w ?? 0).toFixed(2), dy: +(o.dy ?? 0).toFixed(2) } : null) : null;
        S.ex.push({ t: +GAME.t.toFixed(2), id: e.id, fh: fh.map((h) => (h === null ? null : +h.toFixed(3))), lim: +lim.toFixed(2), ...w, actT: +(e.anim.actT || 0).toFixed(2), actDur: +(e.anim.actDur || 0).toFixed(2), ph: +(e.anim.phase % TAU).toFixed(2), y: +e.y.toFixed(2), fl: L, tag: opt.tag || '' });
      }
      A2.sig.set(sig, S);
    }
  }
  A2.stats.frames++;
  return res;
}
// a frame of the search: the world stepped, the crowds filled as a frame would (without drawing the world), every body
// near the camera looked at
function a2Step(dt, opt = {}) {
  try { simStep(dt); } catch (err) { reportError(err); }
  U.uTime.value += dt;
  motionDraw();
  return a2Scan(opt);
}
// an episode over: how long the body stood with a foot in the air (A2.ep: by kind and action, the longest and how many
// lasted more than 0.3 s and more than 1 s)
function a2EpEnd(e, t) {
  const E = e._a2ep; e._a2ep = null;
  const d = (E.t1 ?? t) - E.t0, k = E.sig.replace(/\|cast|\|still/g, ''), R = A2.ep[k] || (A2.ep[k] = { n: 0, max: 0, over03: 0, over1: 0, hi: 0, id: null, at: 0 });
  R.n++; if (d > R.max) { R.max = +d.toFixed(2); R.id = e.id; R.at = +E.t0.toFixed(1); } if (d > 0.3) R.over03++; if (d > 1) R.over1++; R.hi = Math.max(R.hi, +E.hi.toFixed(2));
}
function a2Report() {
  for (const e of ENT) if (e._a2ep) a2EpEnd(e, GAME.t);
  const sigs = [...A2.sig.values()].sort((a, b) => b.n - a.n);
  return { stats: { ...A2.stats }, hist: A2.hist, ep: A2.ep, sigs: sigs.map((s) => ({ sig: s.sig, n: s.n, ex: s.ex })) };
}
function a2Reset() { A2.hist = {}; A2.ep = {}; for (const e of ENT) e._a2ep = null; A2.sig.clear(); A2.finds.length = 0; A2.dead.length = 0; for (const k in A2.stats) A2.stats[k] = 0; }
window.__hm.anim2 = { A2, a2Probe, a2Parts, a2Scan, a2Step, a2Report, a2Reset, a2Floor, a2OnFeet, a2LiftOf, a2What };

/* ------------------------------------------------------------------ */
/* [anim2] Cinderwing fallen: lying as a great beast lies               */
/* ------------------------------------------------------------------ */
// Its dead pose was a set of angles for a dragon rolled on its side 72 degrees: its neck and tail bent and turned in the
// body's own frame, so on its side they curled up into the air (the neck reared with the jaws open, the tail stood up in
// rings over the back), the upper wing stood up like a sail, the lower legs went into the ground and the body lay where
// it fell whatever the slope. Now it lies on its belly, slumped a little to one side, along the ground's own slope, and
// each part of it is settled onto the ground under it by the bones that carry it (it is skinned on the CPU, so its
// vertices are known): the body let down until its belly rests, the neck and the tail bone by bone along the ground, the
// head on it, each leg folded until it rests clear of the ground, the wings let down and spread over it. Solved once
// where it comes to rest (and again if the ground moves under it), eased into as it lands.
const A2D = { key: '', pose: null, groups: null, stats: { solves: 0, ms: 0, under: 0, low: 0, iters: 0 } };
const _a2dRoot = new THREE.Matrix4(), _a2dRy = new THREE.Matrix4();
// the vertices each bone carries most (one vertex in three of the big groups: enough for the lowest point)
function a2DragonGroups() {
  if (A2D.groups) return A2D.groups;
  const D = DRAGON, n = D.kit.n, bi = D.bi, bw = D.bw, G = [];
  for (let v = 0; v < n; v++) {
    let b = bi[v * 4], w = bw[v * 4];
    for (let k = 1; k < 4; k++) if (bw[v * 4 + k] > w) { w = bw[v * 4 + k]; b = bi[v * 4 + k]; }
    (G[b] = G[b] || []).push(v);
  }
  return (A2D.groups = G.map((g) => (g && g.length > 900 ? g.filter((_, i) => i % 3 === 0) : g || [])));
}
// a vertex skinned with the bones as they are posed now: its height over the ground under it
function a2DragonH(v) {
  const D = DRAGON, bp = D.bindP, bi = D.bi, bw = D.bw, x = bp[v * 3], y = bp[v * 3 + 1], z = bp[v * 3 + 2];
  let px = 0, py = 0, pz = 0;
  for (let k = 0; k < 4; k++) {
    const w = bw[v * 4 + k];
    if (w <= 0) continue;
    const e = D.world[bi[v * 4 + k]].elements;
    px += w * (e[0] * x + e[4] * y + e[8] * z + e[12]); py += w * (e[1] * x + e[5] * y + e[9] * z + e[13]); pz += w * (e[2] * x + e[6] * y + e[10] * z + e[14]);
  }
  return py - heightAt(px, pz);
}
function a2DragonPoseAt(P, e) {
  const D = DRAGON, was = D.pose;
  D.pose = P;
  _a2dRoot.makeTranslation(e.x, e.y + P.bodyY, e.z); _a2dRy.makeRotationY(e.yaw); _a2dRoot.multiply(_a2dRy);
  poseDragonBones(_a2dRoot);
  D.pose = was;
}
function a2DragonSolve(e) {
  const t0 = performance.now(), D = DRAGON, B = DBI, G = a2DragonGroups(), P = dragonPoseZero();
  const g = (...bs) => bs.flatMap((b) => G[B[b]] || []);
  // the ground's own slope under it, along and across, and a slump onto its left side (the wing on that side under it)
  const c = Math.cos(e.yaw), s = Math.sin(e.yaw), at = (a, l) => heightAt(e.x + s * a + c * l, e.z + c * a - s * l);
  const along = (at(4, 0) - at(-4, 0)) / 8, across = (at(0, 1.6) - at(0, -1.6)) / 3.2;
  P.bodyPitch = -Math.atan(along); P.bodyRoll = 0.14 - Math.atan(across);
  P.chest = 0.04;
  // the neck stretched out ahead and turned a little to the right, the head down; the tail lying in a long curve
  P.neck = [0.35, 0.3, 0.2]; P.neckYaw = [-0.22, -0.26, -0.2]; P.head = 0.25; P.headYaw = -0.25; P.jaw = 0.08;
  P.tail = [0.12, 0.12, 0.08, 0.05]; P.tailYaw = [0.18, 0.24, 0.26, 0.22];
  // the legs folded at the sides, the forelegs reaching ahead, the hind legs drawn up along the flanks
  P.spread = 0.35; P.fl = [-0.95, -0.35, 0.45]; P.fr = [-0.75, -0.55, 0.45]; P.bl = [-0.7, 1.35, -0.5]; P.br = [-0.85, 1.25, -0.4];
  // the wings let down over the ground, half folded
  P.wl = [-0.6, 0.35, 0.0, 0.5, 0.2, 0.35]; P.wr = [-0.5, 0.55, 0.0, 0.4, 0.3, 0.55];
  // settled in turn: [dof getter/setter, how far the thing it moves is above where it is wanted (metres), rest | clear,
  // its range, linear]. 'rest': brought to where it is wanted; 'clear': only lifted, and only if under it
  const dof = (k, i) => (i === undefined ? [() => P[k], (v) => { P[k] = v; }] : [() => P[k][i], (v) => { P[k][i] = v; }]);
  const lowOf = (vs, tgt) => () => { let lo = Infinity; for (const v of vs) { const h = a2DragonH(v); if (h < lo) lo = h; } return lo - tgt; };
  const _j = new THREE.Vector3();
  const jointH = (b) => { const pv = DRAGON_BONES[B[b]][2]; _j.set(pv[0], pv[1], pv[2]).applyMatrix4(D.world[B[b]]); return _j.y - heightAt(_j.x, _j.z); };
  // the neck and the tail by their joints: the next joint's middle as high as the neck or the tail is thick there (lying
  // on the ground), or on a slope of 40 degrees down from where they leave the body (a neck lies down from the shoulders
  // over a metre or two; asked to lie flat at once it dived into the ground from them)
  let hb = 0;
  const chain = (b0, b, d, r, first) => () => { if (first) hb = jointH(b0); return jointH(b) - Math.max(r + 0.03, hb - 0.84 * d); };
  const NJ = [['neck2', 0.97, 0.5], ['neck3', 1.87, 0.42], ['head', 2.65, 0.34]], TJ = [['tail2', 1.53, 0.4], ['tail3', 3.08, 0.31], ['tail4', 4.65, 0.22]];
  const S = [
    // the body let down onto its belly (its belly's own vertices: a wing's root or a leg's top carried by the body would
    // stop it a metre and more up, standing on its legs)
    [dof('bodyY'), lowOf(g('hips', 'chest').filter((v) => D.kit.mat[v] === DM.belly), 0), 'rest', [-3, 0.5], true],
  ];
  NJ.forEach(([b, d, r], i) => {
    S.push([dof('neck', i), chain('neck1', b, d, r, i === 0), 'rest', [-0.7, 1.2]]);
    S.push([dof('neck', i), lowOf(g('neck' + (i + 1)), -0.02), 'clear', [-0.7, 1.2]]);
  });
  S.push([dof('head'), lowOf(g('head', 'jaw'), 0), 'rest', [-0.9, 1.2]]);
  TJ.forEach(([b, d, r], i) => {
    S.push([dof('tail', i), chain('tail1', b, d, r, i === 0), 'rest', [-0.8, 0.9]]);
    S.push([dof('tail', i), lowOf(g('tail' + (i + 1)), -0.02), 'clear', [-0.8, 0.9]]);
  });
  S.push([dof('tail', 3), lowOf(g('tail4'), 0), 'rest', [-0.8, 0.9]]);
  for (const L of ['fl', 'fr', 'bl', 'br']) {
    S.push([dof(L, 0), lowOf(g(L + 'Up'), 0), 'clear', [-1.6, 1.0]]);
    S.push([dof(L, 1), lowOf(g(L + 'Lo'), 0), 'rest', [-2.0, 2.3]]);
    S.push([dof(L, 2), lowOf(g(L + 'Ft'), 0), 'rest', [-1.6, 1.6]]);
  }
  // each in turn, root to tip (a bone's vertices and joints hang only on it and its parents, so one pass settles a chain):
  // from where it starts, step its angle (or the body's height) both ways until what it moves crosses where it is wanted,
  // then halve the step to the crossing
  let iters = 0;
  for (const [[get, set], fn, mode, rng, lin] of S) {
    const off = () => { a2DragonPoseAt(P, e); iters++; return fn(); };
    const th0 = get(), f0 = off(), st = lin ? 0.05 : 0.04;
    if (!isFinite(f0) || (mode === 'clear' ? f0 >= 0 : Math.abs(f0) < 0.01)) continue;
    let best = th0, bf = Math.abs(f0), done = false;
    for (let k = 1; !done && k * st <= rng[1] - rng[0]; k++) {
      for (const sg of [1, -1]) {
        const th = th0 + sg * k * st;
        if (th < rng[0] || th > rng[1]) continue;
        set(th);
        const f = off();
        if (Math.abs(f) < bf) { bf = Math.abs(f); best = th; }
        if (Math.sign(f) !== Math.sign(f0)) {
          let a = th - sg * st, c = th;
          for (let j = 0; j < 9; j++) { const m = (a + c) / 2; set(m); if (Math.sign(off()) === Math.sign(f0)) a = m; else c = m; }
          best = c; done = true; break;
        }
      }
    }
    set(best);
  }
  // the wings spread out over the ground: arm, twist, hand, sweep and fold together, each step kept if it brings the wing
  // nearer lying on the ground (the hand and fingers 5 cm over it, none of it under: a wing settled by its lowest point
  // alone came to rest on one finger with the rest of it standing up like a sail)
  for (const L of ['wl', 'wr']) {
    const W = P[L], vs = g(L + 'Hand', L + 'F1', L + 'F2', L + 'F3', L + 'F4').filter((_, i) => i % 4 === 0), va = g(L + 'Arm').filter((_, i) => i % 6 === 0);
    const cost = () => {
      a2DragonPoseAt(P, e); iters++;
      let c = 0;
      for (const v of vs) { const h = a2DragonH(v); c += h < 0 ? 40 * h * h : (h - 0.05) * (h - 0.05); }
      for (const v of va) { const h = a2DragonH(v); if (h < 0) c += 40 * h * h; }
      return c / vs.length;
    };
    const R = [[-1.2, 0.8], [-0.4, 1.1], [-0.8, 0.8], [-1.5, 1.6], [-0.6, 0.9], [0, 1]];
    let c0 = cost();
    for (let st = 0.24; st > 0.02; st *= 0.5) {
      for (let pass = 0, moved = true; moved && pass < 8; pass++) {
        moved = false;
        for (let i = 0; i < 6; i++) {
          for (const sg of [1, -1]) {
            const was = W[i], to = clamp(was + sg * st, R[i][0], R[i][1]);
            if (to === was) continue;
            W[i] = to;
            const c1 = cost();
            if (c1 < c0 - 1e-6) { c0 = c1; moved = true; break; }
            W[i] = was;
          }
        }
      }
    }
  }
  // what is left: how far its lowest point is under the ground, and how many of its vertices are more than 15 cm under it
  a2DragonPoseAt(P, e);
  let under = 0, low = Infinity;
  for (let v = 0; v < D.kit.n; v += 2) { const h = a2DragonH(v); if (h < low) low = h; if (h < -0.15) under++; }
  A2D.stats.solves++; A2D.stats.ms = +(performance.now() - t0).toFixed(1); A2D.stats.under = under * 2; A2D.stats.low = +low.toFixed(3); A2D.stats.iters = iters;
  return P;
}
// the meadow flattened where it fell: the grass under its body, neck, tail and wings pounded flat (its blades stood up
// through the wings lying on them), grown back in time as any cut grass is
function a2DragonFlatten(e, P) {
  if (typeof natureCut !== 'function') return;
  a2DragonPoseAt(P, e);
  const D = DRAGON, seen = new Set();
  let n = 0;
  for (let v = 0; v < D.kit.n; v += 3) {
    const bp = D.bindP, bi = D.bi, bw = D.bw;
    let px = 0, py = 0, pz = 0;
    for (let k = 0; k < 4; k++) {
      const w = bw[v * 4 + k];
      if (w <= 0) continue;
      const m = D.world[bi[v * 4 + k]].elements, x = bp[v * 3], y = bp[v * 3 + 1], z = bp[v * 3 + 2];
      px += w * (m[0] * x + m[4] * y + m[8] * z + m[12]); py += w * (m[1] * x + m[5] * y + m[9] * z + m[13]); pz += w * (m[2] * x + m[6] * y + m[10] * z + m[14]);
    }
    if (py - heightAt(px, pz) > 0.9) continue;
    const k = Math.round(px) + ',' + Math.round(pz);
    if (seen.has(k)) continue;
    seen.add(k); natureCut(Math.round(px), Math.round(pz), 0.75, 0.9, false); n++;
  }
  A2D.stats.flat = n;
}
// the pose Cinderwing takes dead (dragonTargetPose asks): falling, its wings up and its neck and tail trailing; at rest on
// the ground, the pose solved where it lies
function a2DragonDead(D, e, P) {
  if (e.fixedY != null) {
    P.bodyPitch = 0.1; P.wl = [0.95, 0.55, 0.25, -0.5, 0.35, 0.35]; P.wr = P.wl.slice();
    P.neck = [-0.15, -0.1, 0.05]; P.head = 0.1; P.jaw = 0.1; P.tail = [-0.1, -0.08, -0.05, 0]; P.fl = [-0.2, 0.3, 0.2]; P.fr = [-0.2, 0.3, 0.2]; P.bl = [0.1, 0.3, 0]; P.br = [0.1, 0.3, 0];
    return P;
  }
  const key = e.x.toFixed(1) + ',' + e.z.toFixed(1) + ',' + e.yaw.toFixed(2) + ',' + A2FL.ground;
  if (A2D.key !== key || !A2D.pose) { A2D.pose = a2DragonSolve(e); A2D.key = key; a2DragonFlatten(e, A2D.pose); }
  const S = A2D.pose;
  for (const k in S) P[k] = Array.isArray(S[k]) ? S[k].slice() : S[k];
  return P;
}
window.__hm.anim2.dragon = { A2D, DBI, a2DragonSolve, a2DragonDead, a2DragonGroups, a2DragonH, a2DragonPoseAt };
