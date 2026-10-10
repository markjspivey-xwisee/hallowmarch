/* ================================================================== */
/* [motion] how bodies move, measured: a probe that reads back where    */
/* chosen vertices of the animated crowds land in the world            */
/* ================================================================== */
// Every body is animated in its vertex shader, so the probe draws the crowd once more as points with the same vertex
// shader (its main() renamed and wrapped) under a camera whose view and projection are the identity: what the shader
// writes to gl_Position is then the world position itself. Each chosen vertex of each chosen instance lands on its own
// texel of a small float target, which is read back. Test hooks only (window.__hm.motion); nothing here runs in play.
const MPROBE = { rt: null, cam: null, scene: null, mats: new Map(), geos: new Map(), W: 64, H: 8, buf: null };
function mprobeMat(src) {
  let m = MPROBE.mats.get(src);
  if (m) return m;
  const vs0 = src.vertexShader;
  if (!vs0.includes('void main(){')) throw new Error('[motion] probe: the shader has no main');
  // (gl_VertexID and gl_InstanceID count as attributes on some drivers, and the people already use 15 of 16: the
  // chosen vertices are found by their rest position, the chosen instances by their place)
  const vs = vs0.replace('void main(){', 'void mprobeMain(){') + `
  uniform vec3 uPrSel[${MPROBE.W}]; uniform vec2 uPrInst[${MPROBE.H}];
  varying vec4 vPrW;
  void main(){
    gl_Position = vec4(0.0, 0.0, -2.0, 1.0);
    mprobeMain();
    bool hidden = gl_Position.z < -1.99 && gl_Position.x == 0.0 && gl_Position.y == 0.0;
    vPrW = vec4(gl_Position.xyz / gl_Position.w, hidden ? 0.5 : 1.0);
    int slot = -1, inst = -1;
    for (int i = 0; i < ${MPROBE.W}; i++) if (uPrSel[i] == position) slot = i;
    for (int j = 0; j < ${MPROBE.H}; j++) if (uPrInst[j] == iPos.xz) inst = j;
    gl_PointSize = 1.0;
    if (slot < 0 || inst < 0) { gl_Position = vec4(3.0, 3.0, 3.0, 1.0); return; }
    gl_Position = vec4((float(slot) + 0.5) / ${MPROBE.W}.0 * 2.0 - 1.0, (float(inst) + 0.5) / ${MPROBE.H}.0 * 2.0 - 1.0, 0.0, 1.0);
  }`;
  m = new THREE.ShaderMaterial({
    uniforms: { ...src.uniforms, uPrSel: { value: Array.from({ length: MPROBE.W }, () => new THREE.Vector3(1e9, 1e9, 1e9)) }, uPrInst: { value: Array.from({ length: MPROBE.H }, () => new THREE.Vector2(1e9, 1e9)) } },
    vertexShader: vs, fragmentShader: 'varying vec4 vPrW; void main(){ gl_FragColor = vPrW; }',
    depthTest: false, depthWrite: false, blending: THREE.NoBlending,
  });
  MPROBE.mats.set(src, m);
  return m;
}
// the probe's own geometry for a crowd: the crowd's attributes (shared, never disposed) with an index of chosen vertices
function mprobeGeo(crowd, vids) {
  let G = MPROBE.geos.get(crowd);
  if (!G) {
    const g = new THREE.InstancedBufferGeometry();
    for (const k in crowd.geo.attributes) g.setAttribute(k, crowd.geo.attributes[k]);
    G = { g, key: '', pts: null };
    MPROBE.geos.set(crowd, G);
  }
  const key = vids.join(',');
  if (G.key !== key) { G.g.setIndex(new THREE.BufferAttribute(new Uint32Array(vids), 1)); G.key = key; }
  G.g.instanceCount = crowd.geo.instanceCount;
  return G;
}
// world positions of vertices vids (up to 64) of instances insts (up to 8) of a crowd: [inst][vid] -> [x, y, z] or null
function mprobeRun(crowd, vids, insts) {
  if (!MPROBE.rt) {
    MPROBE.rt = new THREE.WebGLRenderTarget(MPROBE.W, MPROBE.H, { type: THREE.FloatType, format: THREE.RGBAFormat, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: false, stencilBuffer: false });
    MPROBE.cam = new THREE.Camera(); MPROBE.scene = new THREE.Scene();
    MPROBE.buf = new Float32Array(MPROBE.W * MPROBE.H * 4);
  }
  const m = mprobeMat(crowd.mesh.material), G = mprobeGeo(crowd, vids);
  const pos = crowd.geo.attributes.position.array, ip = crowd.attrs[0].array;
  m.uniforms.uPrSel.value.forEach((u, i) => { const v = vids[i]; if (v === undefined) u.set(1e9, 1e9, 1e9); else u.set(pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]); });
  m.uniforms.uPrInst.value.forEach((u, j) => { const k = insts[j]; if (k === undefined) u.set(1e9, 1e9); else u.set(ip[k * 4], ip[k * 4 + 2]); });
  if (!G.pts) { G.pts = new THREE.Points(G.g, m); G.pts.frustumCulled = false; }
  MPROBE.scene.add(G.pts);
  const rtWas = renderer.getRenderTarget(), ac = renderer.autoClear, cc = new THREE.Color(), ca = renderer.getClearAlpha();
  renderer.getClearColor(cc);
  renderer.autoClear = false;
  renderer.setRenderTarget(MPROBE.rt);
  renderer.setClearColor(0x000000, 0);
  renderer.clear(true, false, false);
  renderer.render(MPROBE.scene, MPROBE.cam);
  renderer.readRenderTargetPixels(MPROBE.rt, 0, 0, MPROBE.W, MPROBE.H, MPROBE.buf);
  renderer.setRenderTarget(rtWas); renderer.setClearColor(cc, ca); renderer.autoClear = ac;
  MPROBE.scene.remove(G.pts);
  const out = [];
  for (let j = 0; j < insts.length; j++) {
    const row = [];
    for (let i = 0; i < vids.length; i++) {
      const k = (j * MPROBE.W + i) * 4, b = MPROBE.buf;
      row.push(b[k + 3] > 0.75 ? [b[k], b[k + 1], b[k + 2]] : null);
    }
    out.push(row);
  }
  return out;
}

/* ---- which vertices are the feet, knees, wing tips ---- */
function motionCrowds() {
  const out = [];
  for (const c of [crowdHuman, crowdHumanLo, crowdHumanFar]) if (c) out.push(['human', c]);
  for (const k in crowdBeast) for (const c of crowdBeast[k]) out.push([k, c]);
  return out;
}
// the instance of an entity in the crowds just filled (by its place): [{ crowd, kind, idx }]
function motionFind(e, yHint) {
  const fx = Math.fround(e.x), fz = Math.fround(e.z), out = [];
  for (const [kind, c] of motionCrowds()) {
    const a = c.attrs[0].array;
    for (let i = 0; i < c.n; i++) if (a[i * 4] === fx && a[i * 4 + 2] === fz && (yHint === undefined || Math.abs(a[i * 4 + 1] - yHint) < 0.05)) out.push({ crowd: c, kind, idx: i });
  }
  return out;
}
// groups of vertex ids: the lowest points of each foot (people: the soles; beasts: the hooves and paws; birds: the toes),
// a person's knees (the front of the kneecap), and a bird's wing tips
function motionParts(crowd, kind) {
  crowd._moParts = crowd._moParts || {};
  if (crowd._moParts[kind]) return crowd._moParts[kind];
  const A = crowd.geo.attributes, pos = A.position.array, bone = A.aBone.array, bit = A.aBit ? A.aBit.array : null, n = A.position.count;
  const lowest = (pred, k, band = 0.012) => {
    let minY = Infinity;
    for (let i = 0; i < n; i++) if (pred(i)) minY = Math.min(minY, pos[i * 3 + 1]);
    const ids = [];
    for (let i = 0; i < n; i++) if (pred(i) && pos[i * 3 + 1] < minY + band) ids.push(i);
    // spread over the sole: keep k of them, from heel to toe
    ids.sort((a, b) => pos[a * 3 + 2] - pos[b * 3 + 2]);
    const pick = [];
    for (let j = 0; j < k && ids.length; j++) pick.push(ids[Math.round((j / Math.max(1, k - 1)) * (ids.length - 1))]);
    return [...new Set(pick)];
  };
  const P = {};
  if (kind === 'human') {
    const vis = (i) => !bit || bit[i] < -0.5;
    P.feet = [lowest((i) => Math.round(bone[i]) === 8 && vis(i), 5), lowest((i) => Math.round(bone[i]) === 10 && vis(i), 5)];
    // the knees: the foremost points of the leg about knee height
    const knee = (b) => { let best = -1, bz = -1; for (let i = 0; i < n; i++) { const y = pos[i * 3 + 1]; if ((Math.round(bone[i]) === b || Math.round(bone[i]) === b - 1) && vis(i) && Math.abs(y - SK.knee[1]) < 0.05 && pos[i * 3 + 2] > bz) { bz = pos[i * 3 + 2]; best = i; } } return best >= 0 ? [best] : []; };
    P.knees = [knee(8), knee(10)];
    // the top of the head and the pelvis, for leaning
    let top = -1, ty = -1;
    for (let i = 0; i < n; i++) if (Math.round(bone[i]) === 2 && vis(i) && pos[i * 3 + 1] > ty) { ty = pos[i * 3 + 1]; top = i; }
    P.head = top >= 0 ? [top] : [];
  } else if (kind === 'hen' || kind === 'pheasant' || kind === 'duck') {
    P.feet = [lowest((i) => Math.round(bone[i]) === 9, 4, 0.006), lowest((i) => Math.round(bone[i]) === 12, 4, 0.006)];
    // the wing tips: the wing points farthest out (or back, folded)
    const tip = (b) => { let best = -1, bd = -1; for (let i = 0; i < n; i++) if (Math.round(bone[i]) === b) { const d = Math.abs(pos[i * 3]) * 2 + Math.max(0, -pos[i * 3 + 2]); if (d > bd) { bd = d; best = i; } } return best >= 0 ? [best] : []; };
    P.wings = [tip(3), tip(6)];
  } else {
    P.feet = [5, 8, 11, 14].map((b) => lowest((i) => Math.round(bone[i]) === b, 4, 0.01));
  }
  crowd._moParts[kind] = P;
  return P;
}
// fill the crowds as a frame would (the camera's frustum first), without drawing the world
function motionDraw() {
  camera.updateMatrixWorld();
  projView.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
  frustum.setFromProjectionMatrix(projView);
  const P = GAME.player;
  drawActors(P ? P.x : 0, P ? P.z : 0);
}
// one look at a body: every part's points in the world (averaged per group, and the lowest y)
function motionLook(e, which = ['feet'], opt = {}) {
  const hits = motionFind(e, opt.yHint).filter((h) => !opt.kind || (opt.kind === 'human' ? h.kind === 'human' : h.kind !== 'human'));
  if (!hits.length) return null;
  const h = hits[0], P = motionParts(h.crowd, h.kind), groups = [];
  const vids = [];
  for (const w of which) for (const g of P[w] || []) { groups.push([w, g]); for (const v of g) vids.push(v); }
  if (!vids.length) return null;
  const uniq = [...new Set(vids)].slice(0, MPROBE.W);
  const res = mprobeRun(h.crowd, uniq, [h.idx])[0];
  const at = new Map(uniq.map((v, i) => [v, res[i]]));
  const out = { kind: h.kind };
  for (const [w, g] of groups) {
    let sx = 0, sy = 0, sz = 0, n = 0, minY = Infinity;
    for (const v of g) { const p = at.get(v); if (!p) continue; sx += p[0]; sy += p[1]; sz += p[2]; n++; minY = Math.min(minY, p[1]); }
    (out[w] = out[w] || []).push(n ? [sx / n, sy / n, sz / n, minY] : null);
  }
  return out;
}
// the floor under a point (stairs, wall walks, decks, the ground; a lake's ice)
const motionFloor = (x, z, y) => (typeof floorAt === 'function' ? floorAt(x, z, y + 0.25) : heightAt(x, z));

/* ---- a run: drive bodies, step the world, look at them every step ---- */
// ents: [{ e, drive(e, t, dt), which, yHint(e) }]; returns per entity a list of samples
function motionRun(ents, sec, dt = 1 / 60, opt = {}) {
  const n = Math.round(sec / dt), rec = ents.map(() => []);
  for (let s = 0; s < n; s++) {
    const t = s * dt;
    for (const E of ents) if (E.drive) E.drive(E.e, t, dt);
    try { simStep(dt); } catch (err) { reportError(err); }
    U.uTime.value += dt;
    if (opt.after) opt.after(t, dt);
    if (opt.cam) opt.cam(t);
    motionDraw();
    ents.forEach((E, j) => {
      const e = E.e;
      const L = motionLook(e, E.which || ['feet'], { kind: E.kind, yHint: E.yHint ? E.yHint(e) : undefined });
      rec[j].push({ t, x: e.x, y: e.y, z: e.z, yaw: e.yaw, amt: e.anim.amt, ph: e.anim.phase, L });
    });
  }
  return rec;
}
// the measures of a run for one body
function motionMeasure(samples, opt = {}) {
  const contact = opt.contact ?? 0.03, skip = opt.skip ?? 0.4;
  const S = samples.filter((s) => s.t >= skip && s.L && s.L.feet);
  if (S.length < 4) return { err: 'not seen', n: S.length };
  const nf = S[0].L.feet.length, dt = S.length > 1 ? S[1].t - S[0].t : 1 / 60;
  let slideMax = 0, slideSum = 0, runs = 0, stanceN = 0, slipV = 0, slipVn = 0;
  const heights = [], lows = [];
  let starts = 0;
  for (let f = 0; f < nf; f++) {
    let run = [];
    const close = () => {
      if (run.length >= 3) {
        const a = run[0], b = run[run.length - 1];
        const span = Math.hypot(b[0] - a[0], b[2] - a[2]);
        slideMax = Math.max(slideMax, span); slideSum += span; runs++;
      }
      run = [];
    };
    for (let i = 0; i < S.length; i++) {
      const p = S[i].L.feet[f];
      if (!p) { close(); continue; }
      const g = motionFloor(p[0], p[2], S[i].y);
      const h = p[3] - g;
      heights.push(h);
      if (h < contact) {
        if (!run.length) starts++;
        run.push(p); stanceN++;
        if (i > 0 && S[i - 1].L.feet[f]) { const q = S[i - 1].L.feet[f]; const qh = q[3] - motionFloor(q[0], q[2], S[i - 1].y); if (qh < contact) { slipV += Math.hypot(p[0] - q[0], p[2] - q[2]) / dt; slipVn++; } }
      } else close();
    }
    close();
  }
  // per moment, the lowest foot: a body that floats never touches; one that sinks goes through
  for (let i = 0; i < S.length; i++) { let lo = Infinity; for (const p of S[i].L.feet) if (p) lo = Math.min(lo, p[3] - motionFloor(p[0], p[2], S[i].y)); if (lo < Infinity) lows.push(lo); }
  lows.sort((a, b) => a - b); heights.sort((a, b) => a - b);
  const q = (a, k) => a.length ? a[Math.min(a.length - 1, Math.max(0, Math.round(k * (a.length - 1))))] : 0;
  let dist = 0;
  for (let i = 1; i < S.length; i++) dist += Math.hypot(S[i].x - S[i - 1].x, S[i].z - S[i - 1].z);
  const T = S[S.length - 1].t - S[0].t || 1, v = dist / T;
  const cm = (x) => Math.round(x * 1000) / 10;
  return {
    v: Math.round(v * 100) / 100,
    slideMax: cm(slideMax), slideMean: cm(runs ? slideSum / runs : 0),
    slipV: Math.round((slipVn ? slipV / slipVn : 0) * 100) / 100, // how fast a planted foot moves, m/s
    slipK: v > 0.05 ? Math.round((slipVn ? slipV / slipVn : 0) / v * 100) / 100 : null, // as a share of the body's speed
    lowMedian: cm(q(lows, 0.5)), lowMin: cm(lows[0] ?? 0), lowMax: cm(q(lows, 1)), // the lowest foot over the ground
    stanceShare: Math.round(stanceN / Math.max(1, S.length * nf) * 100) / 100,
    steps: Math.round(starts / T * 100) / 100, // feet coming down per second
  };
}
window.__hm.motion = { MPROBE, mprobeRun, motionFind, motionParts, motionDraw, motionLook, motionRun, motionMeasure, motionFloor };
