/* ================================================================== */
/* [anim2] bodies that never break: no leg left in the air, weapons    */
/* held and used as weapons are, Cinderwing's fall and every death     */
/* ================================================================== */
// The measures (tests; window.__hm.anim2): a probe that reads, for every body the crowds draw near the camera, where
// chosen points of it land in the world (13r_motion.js's probe reads eight bodies at a time, found by their place; this
// one reads up to 128 a pass), and a search over a running war, the duels and the player's
// own doings for a foot well off the floor while the body stands or walks (A2.finds, grouped by what the body was doing).
const A2 = { W: 64, H: 128, rt: null, buf: null, cam: null, scene: null, mats: new Map(), geos: new Map(), stats: { scans: 0, frames: 0, bodies: 0, looked: 0, nullFeet: 0 }, hist: {}, finds: [], sig: new Map(), dead: [], keep: 6 };
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
  const Q = { feet: P.feet.map((g) => g.slice(0, kind === 'human' ? 5 : 4)), body: [] };
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
        if (!Q.body.includes(best)) Q.body.push(best);
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
  return Math.max(lerp(0.1, 0.3, runK) * Math.min(1, stepS / 0.42) * _flSS(0, 0.04, amt), 0.075 * turnK) * sc;
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
        let lo = Infinity, hi = -Infinity;
        for (let q = fv.length; q < vids.length; q++) { const p = row[q]; if (!p) continue; const h = p[1] - a2Floor(p[0], p[2], e.y); lo = Math.min(lo, h); }
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
      const bad = hiF > lim ? 'high' : stand && loF > 0.06 && loF < 9 ? 'hover' : null;
      A2.stats.bodies++;
      if (hiF < 0) A2.stats.nullFeet++;
      { const hk = (kind === 'human' ? 'h' : 'b') + (stand ? 's' : 'm') + Math.min(10, Math.max(-3, Math.floor(hiF / 0.05))); A2.hist[hk] = (A2.hist[hk] || 0) + 1; }
      if (!bad) continue;
      const w = a2What(e), sig = `${kind}|${bad}|act${w.act}|av${w.av}${w.stun ? '|stun' : ''}${w.cast ? '|cast' : ''}${stand ? '|still' : ''}`;
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
function a2Report() {
  const sigs = [...A2.sig.values()].sort((a, b) => b.n - a.n);
  return { stats: { ...A2.stats }, hist: A2.hist, sigs: sigs.map((s) => ({ sig: s.sig, n: s.n, ex: s.ex })) };
}
function a2Reset() { A2.hist = {}; A2.sig.clear(); A2.finds.length = 0; A2.dead.length = 0; for (const k in A2.stats) A2.stats[k] = 0; }
window.__hm.anim2 = { A2, a2Probe, a2Parts, a2Scan, a2Step, a2Report, a2Reset, a2Floor, a2OnFeet, a2LiftOf, a2What };
