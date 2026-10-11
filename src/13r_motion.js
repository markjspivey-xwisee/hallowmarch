/* ================================================================== */
/* [motion] how bodies move, measured: a probe that reads back where    */
/* chosen vertices of the animated crowds land in the world            */
/* ================================================================== */
// Every body is animated in its vertex shader, so the probe draws the crowd once more as points with the same vertex
// shader (its main() renamed and wrapped) under a camera whose view and projection are the identity: what the shader
// writes to gl_Position is then the world position itself. Each chosen vertex of each chosen instance lands on its own
// texel of a small float target, which is read back. Test hooks (window.__hm.motion); only humanSlopeYaw (the floor's
// slope for the walk shader, from drawActors) runs in play.
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
    P.head = top >= 0 ? [[top]] : []; // (a group, as the feet and knees)
  } else if (kind === 'hen' || kind === 'pheasant' || kind === 'duck') {
    P.feet = [lowest((i) => Math.round(bone[i]) === 9, 4, 0.006), lowest((i) => Math.round(bone[i]) === 12, 4, 0.006)];
    // the wing tips: the wing points farthest out (or back, folded)
    // (a game bird's wing tips are on its hands, bones 4 and 7; a hen's folded wings are bones 3 and 6)
    const tip = (bs) => { let best = -1, bd = -1; for (let i = 0; i < n; i++) if (bs.includes(Math.round(bone[i]))) { const d = Math.abs(pos[i * 3]) * 2 + Math.max(0, -pos[i * 3 + 2]); if (d > bd) { bd = d; best = i; } } return best >= 0 ? [best] : []; };
    P.wings = kind === 'hen' ? [tip([3]), tip([6])] : [tip([4]), tip([7])];
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
    let sx = 0, sy = 0, sz = 0, n = 0, minY = Infinity, maxY = -Infinity;
    for (const v of g) { const p = at.get(v); if (!p) continue; sx += p[0]; sy += p[1]; sz += p[2]; n++; minY = Math.min(minY, p[1]); maxY = Math.max(maxY, p[1]); }
    (out[w] = out[w] || []).push(n ? [sx / n, sy / n, sz / n, minY, maxY] : null);
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
// the measures of a run for one body. A foot bears weight while it is down (within 4 cm of the floor) and not moving
// faster than the body: then it should stay where it is. slipK is how fast it moves then, as a share of the body's
// speed (0: planted; 1: the legs stand still and the body glides). lift: how high a swinging foot rises (a foot that
// never leaves the ground shuffles). The lowest foot over the floor: its 5th percentile (> 3 cm: the body floats)
// and its lowest (< -4 cm: it sinks into the floor).
function motionMeasure(samples, opt = {}) {
  const contact = opt.contact ?? 0.04, skip = opt.skip ?? 0.4;
  let S = samples.filter((s) => s.t >= skip && s.L && s.L.feet);
  // steady: only the stretch at an even pace and heading (the player's runs end where something stops, turns or
  // shoves them aside: a body pushed sideways by a wall drags its planted foot with it)
  if (opt.steady && S.length > 8) {
    const dtS = S[1].t - S[0].t, v = S.map((s, i) => (i ? Math.hypot(s.x - S[i - 1].x, s.z - S[i - 1].z) / dtS : 0)), m = v.slice(1).sort((a, b) => a - b)[Math.floor((v.length - 1) / 2)];
    // (the stretch round the middle of the run: it can start or end against something)
    const dir = S.map((s, i) => (i ? Math.atan2(s.x - S[i - 1].x, s.z - S[i - 1].z) : 0)), mid = Math.floor(S.length / 2), d0 = dir[mid];
    const ok = (i) => i > 0 && v[i] >= 0.85 * m && Math.abs(Math.atan2(Math.sin(dir[i] - d0), Math.cos(dir[i] - d0))) <= 0.12;
    let a = mid, b = mid;
    while (a > 1 && ok(a - 1)) a--;
    while (b < S.length - 1 && ok(b + 1)) b++;
    if (b - a > 8) S = S.slice(a - 1, b + 1);
  }
  if (S.length < 4) return { err: 'not seen', n: S.length };
  const nf = S[0].L.feet.length, dt = S.length > 1 ? S[1].t - S[0].t : 1 / 60;
  let slideMax = 0, slideSum = 0, runs = 0, stanceN = 0, slipV = 0, slipVn = 0, starts = 0, pivot = 0, pivotN = 0;
  const lows = [], swingH = [];
  const vb = S.map((s, i) => (i ? Math.hypot(s.x - S[i - 1].x, s.z - S[i - 1].z) / dt : 0));
  const H = S.map((s) => s.L.feet.map((p) => (p ? p[3] - motionFloor(p[0], p[2], s.y) : null)));
  for (let f = 0; f < nf; f++) {
    let run = [];
    const close = () => {
      if (run.length >= 3) { const a = run[0], b = run[run.length - 1], span = Math.hypot(b[0] - a[0], b[2] - a[2]); slideMax = Math.max(slideMax, span); slideSum += span; runs++; }
      run = [];
    };
    for (let i = 1; i < S.length; i++) {
      const p = S[i].L.feet[f], q = S[i - 1].L.feet[f], h = H[i][f];
      if (!p || !q || h === null) { close(); continue; }
      const vf = Math.hypot(p[0] - q[0], p[2] - q[2]) / dt;
      if (h < 0.02) { pivot += vf; pivotN++; }
      if (h < contact && vf <= 1.05 * vb[i] + 0.05) {
        if (!run.length) starts++;
        run.push(p); stanceN++; slipV += vf; slipVn++;
      } else { close(); if (h >= contact) swingH.push(h); }
    }
    close();
  }
  for (let i = 0; i < S.length; i++) { let lo = Infinity; for (const h of H[i]) if (h !== null) lo = Math.min(lo, h); if (lo < Infinity) lows.push(lo); }
  lows.sort((a, b) => a - b); swingH.sort((a, b) => a - b);
  const q = (a, k) => (a.length ? a[Math.min(a.length - 1, Math.max(0, Math.round(k * (a.length - 1))))] : 0);
  let dist = 0;
  for (let i = 1; i < S.length; i++) dist += Math.hypot(S[i].x - S[i - 1].x, S[i].z - S[i - 1].z);
  const T = S[S.length - 1].t - S[0].t || 1, v = dist / T;
  const cm = (x) => Math.round(x * 1000) / 10;
  const sv = slipVn ? slipV / slipVn : 0;
  return {
    v: Math.round(v * 100) / 100,
    slideMax: cm(slideMax), slideMean: cm(runs ? slideSum / runs : 0),
    slipV: Math.round(sv * 100) / 100, slipK: v > 0.05 ? Math.round(sv / v * 100) / 100 : null,
    pivot: Math.round((pivotN ? pivot / pivotN : 0) * 100) / 100, // how fast feet on the ground move, m/s (turning in place)
    lift: cm(q(swingH, 0.9)), low5: cm(q(lows, 0.05)), lowMin: cm(lows[0] ?? 0), lowMedian: cm(q(lows, 0.5)),
    stanceShare: Math.round(stanceN / Math.max(1, S.length * nf) * 100) / 100,
    steps: Math.round(starts / T * 100) / 100, // feet coming down per second
  };
}
// [motion] the slope of the floor along a person (stairs, ramps, hillsides), for the walk shader, which sets each foot
// on it, and how far the body leans into a turn (e.anim.lean, updateAnim): whole turns added to the yaw (the shader
// takes only its sine and cosine): n = slope steps (0.05 of rise per metre, -20..20) + 41 x lean steps (0.04 rad).
// The slope only for people near the camera, standing on their feet (not riding, sitting, swimming, in the air or
// dead); eased, so a step onto a stair does not jerk the legs.
function humanSlopeYaw(e, y, near) {
  const yaw = clamp(Math.atan2(Math.sin(e.yaw), Math.cos(e.yaw)), -3.1414, 3.1414); // (never half a turn: the shader rounds the turns)
  let s = 0;
  if (near && e.alive && !e.mount && !e.seat && e.onGround !== false && !(e.swimK > 0.05) && !inDungeon(e)) {
    const sc = e.scale || 1, r = 0.35 * sc, fx = Math.sin(yaw) * r, fz = Math.cos(yaw) * r;
    // (a drop beyond a step, off the edge of a wall walk or a deck, is no slope: the foot stays on what it stands on)
    const at = (x, z) => { const h = floorAt(x, z, y + 0.05); return Math.abs(h - y) > 0.65 ? y : h; };
    s = clamp((at(e.x + fx, e.z + fz) - at(e.x - fx, e.z - fz)) / (2 * r), -1, 1);
  }
  e._slope = (e._slope ?? s) + (s - (e._slope ?? s)) * 0.3;
  if (e.mount && e.alive) e._slope = e._bslope ?? 0; // [polish] a rider tilts with the horse on a slope (beastLeanYaw, called first)
  const k = clamp(Math.round(e._slope * 20), -20, 20) + 41 * clamp(Math.round((e.alive ? e.anim.lean || 0 : 0) / 0.04), -7, 7);
  return k ? yaw + TAU * k : yaw;
}
// [motion] a beast's lean into a turn (or a ridden horse's, from its rider) as whole turns on its yaw: n lean steps of
// 0.04 rad (beastVS takes them off before its sine and cosine)
// [polish] and the slope of the ground along its body, from its hind feet to its fore feet: it stands tilted with the
// slope (beastVS), its feet on the ground under them, not sunk into the rise ahead or hanging over the fall behind:
// n = lean steps + 11 x slope steps (0.05 of rise per metre, -20..20). A horse under a rider: e is the rider (its
// e._bslope also tilts the rider with the horse: humanSlopeYaw)
function beastLeanYaw(e) {
  const yaw = clamp(Math.atan2(Math.sin(e.yaw), Math.cos(e.yaw)), -3.141, 3.141); // (never near half a turn: the shader rounds the turns)
  if (!e.alive) return yaw;
  const S = BEASTS[e.mount ? 'horse' : e.crowd || e.kind];
  let sl = 0;
  if (S && S.front && e.onGround !== false && !e.swim && !(e.swimK > 0.05) && !e.boat && !e.flying && !e.seat && dist2(e.x, e.z, camera.position.x, camera.position.z) < 70 * 70) {
    const sc = e.mount ? 1 : e.scale || 1, half = Math.max(0.1, (S.front.foot[2] - S.back.foot[2]) / 2 * sc), fx = Math.sin(yaw) * half, fz = Math.cos(yaw) * half, y = e.y;
    const at = (x, z) => { const h = floorAt(x, z, y + 0.3); return Math.abs(h - y) > 1.2 ? y : h; };
    sl = clamp((at(e.x + fx, e.z + fz) - at(e.x - fx, e.z - fz)) / (2 * half), -1, 1);
  }
  e._bslope = (e._bslope ?? sl) + (sl - (e._bslope ?? sl)) * 0.3;
  const k = clamp(Math.round((e.anim.lean || 0) / 0.04), -5, 5) + 11 * clamp(Math.round(e._bslope * 20), -20, 20);
  return k ? yaw + TAU * k : yaw;
}
// Cinderwing through a stretch of its flight (it is skinned on the CPU: its bones are read directly). how: 'fly' (on its
// circuit), 'takeoff' (from a perch, then away), 'land' (coming in to a perch from 60 m out). Gives the wingbeats a
// second, how far a wing tip travels up and down in a beat (m), the share of the time it glides, its greatest bank
// (degrees), how far its head and tail tip move about the body (m), its airspeed and the hardest change of it (m/s
// each second: a jump from hovering to full flight shows here), and its feet over the ground while it stands.
const _moRoot = new THREE.Matrix4(), _moRy = new THREE.Matrix4();
function motionDragon(how, sec, dt = 1 / 30) {
  const D = DRAGON;
  if (!D.e || D.e.removed || !D.e.alive) spawnDragon();
  const e = D.e;
  if (!D.perches.length) D.perches = findPerches();
  const P0 = D.perches[0];
  if (how === 'takeoff') {
    e.x = P0.x; e.z = P0.z; e.y = heightAt(e.x, e.z); D.perch = P0; setDragonState('perch'); D.act = null;
    for (let i = 0; i < 20; i++) { dragonAnimate(dt); }
    D.halfDone = false; D.strafeNext = false; D.liftFrom = e.y; setDragonState('takeoff');
  } else if (how === 'land') {
    D.perch = P0; e.x = P0.x - 60; e.z = P0.z; e.yaw = Math.PI / 2; D.alt = e.y = e.fixedY = P0.y + 30; D.spd = 17; setDragonState('approach');
  } else { setDragonState('fly'); D.spd = 15; }
  const n = Math.round(sec / dt), S = [];
  let prevSpd = null, maxAcc = 0, beats = 0, cyc0 = null;
  for (let i = 0; i < n; i++) {
    const x0 = e.x, z0 = e.z;
    D.lastFoe = GAME.t; // nothing breaks off the test
    try { simStep(dt); } catch (err) { reportError(err); }
    dragonAnimate(dt);
    _moRoot.makeTranslation(e.x, e.y + D.pose.bodyY, e.z); _moRy.makeRotationY(e.yaw); _moRoot.multiply(_moRy);
    poseDragonBones(_moRoot);
    const spd = Math.hypot(e.x - x0, e.z - z0) / dt;
    if (prevSpd !== null && i > 2) maxAcc = Math.max(maxAcc, Math.abs(spd - prevSpd) / dt);
    prevSpd = spd;
    if (D.fl) { if (cyc0 === null) cyc0 = D.fl.cyc; beats = D.fl.cyc - cyc0; }
    const inv = new THREE.Matrix4().copy(_moRoot).invert();
    const loc = (b, p) => dragonPoint(b, p).clone().applyMatrix4(inv);
    const tl = loc(DBI.wlF1, DRAGON_FINGERS[0]), tr = loc(DBI.wrF1, [-DRAGON_FINGERS[0][0], DRAGON_FINGERS[0][1], DRAGON_FINGERS[0][2]]);
    const hd = loc(DBI.head, [0, 4.6, 4.6]), tt = loc(DBI.tail4, [0, 1.2, -8.2]);
    const feet = [[DBI.flFt, [1.15, 0.02, 1.23]], [DBI.frFt, [-1.15, 0.02, 1.23]], [DBI.blFt, [1.25, -0.04, -1.25]], [DBI.brFt, [-1.25, -0.04, -1.25]]].map(([b, p]) => { const w = dragonPoint(b, p); return +(w.y - heightAt(w.x, w.z)).toFixed(3); });
    S.push({ t: i * dt, st: D.state, y: e.y, spd, cyc: D.fl ? D.fl.cyc : 0, glide: D.glide, roll: D.pose.bodyRoll, tl: tl.y, tr: tr.y, hd: [hd.x, hd.y, hd.z], tt: [tt.x, tt.y, tt.z], feet, fly: e.flying });
  }
  // a beat's travel: the range of the left wing tip within each whole beat while it beats
  const per = new Map();
  for (const q of S) { if (q.glide > 0.5) continue; const k = Math.floor(q.cyc); const r = per.get(k) || [1e9, -1e9]; r[0] = Math.min(r[0], q.tl); r[1] = Math.max(r[1], q.tl); per.set(k, r); }
  const ranges = [...per.values()].map((r) => r[1] - r[0]).sort((a, b) => a - b);
  const rng = (f) => { let lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9]; for (const q of S) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], f(q)[k]); hi[k] = Math.max(hi[k], f(q)[k]); } return +Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]).toFixed(2); };
  const stand = S.filter((q) => q.st === 'perch').slice(8); // (from a quarter of a second after touching down: the crater opens under it)
  const feetLow = stand.length ? Math.min(...stand.flatMap((q) => q.feet)) : null, feetHigh = stand.length ? Math.max(...stand.map((q) => Math.min(...q.feet))) : null;
  const T = sec;
  return {
    how, states: [...new Set(S.map((q) => q.st))], beatsPerS: +(beats / T).toFixed(2), tipTravel: ranges.length ? +ranges[Math.floor(ranges.length / 2)].toFixed(2) : 0,
    glide: +(S.reduce((a, q) => a + q.glide, 0) / S.length).toFixed(2), bankDeg: +(Math.max(...S.map((q) => Math.abs(q.roll))) * 180 / Math.PI).toFixed(1),
    head: rng((q) => q.hd), tail: rng((q) => q.tt), speed: [+Math.min(...S.map((q) => q.spd)).toFixed(1), +Math.max(...S.map((q) => q.spd)).toFixed(1)], maxAcc: +maxAcc.toFixed(1),
    rise: +(S[S.length - 1].y - S[0].y).toFixed(1), feetLow, feetHigh,
    trace: S.filter((q, i) => i % Math.round(0.25 / dt) === 0).map((q) => [+q.t.toFixed(2), q.st, +q.y.toFixed(1), +q.spd.toFixed(1), +q.tl.toFixed(2)]),
  };
}
window.__hm.motion = { MPROBE, mprobeRun, motionFind, motionParts, motionDraw, motionLook, motionRun, motionMeasure, motionFloor, motionDragon, humanSlopeYaw, beastLeanYaw };
