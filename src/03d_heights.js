/* ================================================================== */
/* [heights] the mountains from everywhere: the walkable slopes and    */
/* the skyline shaped too, hardy trees on the lower slopes              */
/* ================================================================== */
// Version 10 reshaped only the mountain ground no one could reach (03c_land.js mtnShape): every texel within two of
// walkable ground kept its height, and much of what is seen of the mountains from the lowlands (the gentle foot, the
// rounded crests, which are walkable) is walkable, so the mountains still stood as smooth cones. Here the whole
// mountain is shaped once everything in the world has been placed (mtnHeights, a boot step after the farming: every
// tree, rock, camp, plant, herb, workstation and boat is placed on version 10's ground, so every list and every saved
// index comes out exactly as before):
//  - along each crest, peaks and saddles, false summits and notches; knobs whichever way a ridge runs; ribs down the
//    faces and gullies cut by a few rounds of stream-power erosion (htsErode); the relief grows with the slope, so a
//    cliff gets buttresses and couloirs; the peaks rise a little (the south's stay under its summer snow line);
//  - the roads and their verges, the sites, camps, water and ponds' hollows, standing stones and every collider keep
//    their ground exactly (htsKeep; a wall rising well above a road or a site is shaped above its foot); trees, rocks,
//    plants and herbs keep their footing (the ground round each moves as one with it) and settle onto it;
//  - ground anyone can reach stays walkable (the slope there is held under the walkable limit) and nothing new
//    becomes reachable; texels no one could reach that turn too steep are blocked in the walk mask (recorded);
//  - no new closed hollow (no dry pond bed): what the shaping hollows out is filled, and where it would deepen a
//    hollow left as it was, it is taken back round it;
//  - the map's corners beyond the outer wall are left as they were;
//  - the rock, grass and flower masks follow the new slopes; the crags are placed on the final ground, with outcrops on
//    the walkable lower slopes (htsOutcrops); hardy pines and birches are added after every tree there was (htsTrees).
// The noise for each part of the range is read in its own frame (along its crest and across it, the across
// direction squeezed so the patterns run down the fall line): the ring round the frontier, the ridges between the
// realms and the outer wall (rawHeight, 01_world.js).
const HTS = {
  done: false, changed: null, nChanged: 0, walkLost: 0, reachSteep: 0, reachKept: 0, limited: 0, filled: 0, reverted: 0,
  trees0: 0, hardy: 0, outcrops: 0, treeMeshes: 0, settled: { rocks: 0, trees: 0 }, ms: 0, keep: null, H0: null, walk0: null, reach: null,
};
const HTS_SQ = 0.22; // how much slower the noise runs across a range than along it
// the parts of the range at (x, z): each one's weight (as rawHeight raises it, 0 at the foot, 1 on the crest) and a
// point in its own frame for the noise; returns how many
function htsParts(x, z, P) {
  const r = Math.hypot(x, z) || 1e-3, b = Math.atan2(x, -z), ux = x / r, uz = z / r;
  let n = 0;
  const put = (w, px, pz) => { if (w > 0.002) { P.w[n] = w; P.px[n] = px; P.pz[n] = pz; n++; } };
  // the ring round the frontier, open at the three passes
  let pass = 0;
  for (const R of REALMS) pass = Math.max(pass, sstep(34, 13, Math.abs(angDiff(b, R.bearing)) * r));
  const ring = sstep(32, 3, Math.abs(r - R_RING)) * (1 - pass);
  if (ring > 0.002) { const rr = R_RING + HTS_SQ * (r - R_RING); put(ring, ux * rr, uz * rr); }
  // the ridges between the realms, out from the ring
  if (r > R_RING - 40) {
    for (let k = 0; k < DIVIDERS.length; k++) {
      const db = DIVIDERS[k], ad = angDiff(b, db);
      if (Math.abs(ad) >= 1.2) continue;
      const lat = Math.sin(ad) * r, w = sstep(40, 6, Math.abs(lat)) * sstep(R_RING - 34, R_RING + 6, r);
      if (w <= 0.002) continue;
      const dx = Math.sin(db), dz = -Math.cos(db), along = x * dx + z * dz;
      put(w, dx * along - dz * HTS_SQ * lat + 311 * (k + 1), dz * along + dx * HTS_SQ * lat - 173 * (k + 1));
    }
  }
  // the outer wall, round and square
  const oc = sstep(452, 506, r);
  if (oc > 0.002) { const rr = 480 + HTS_SQ * (r - 480); put(oc, ux * rr + 913, uz * rr - 577); }
  const m = Math.max(Math.abs(x), Math.abs(z)), os = sstep(470, 511, m);
  if (os > 0.002) { const mm = 490 + HTS_SQ * (m - 490); put(os, (x / m) * mm + 913, (z / m) * mm - 577); }
  return n;
}
// the shape added to one part of the range, from its noise point (px, pz) and how far up it the texel is (e)
function htsPart(px, pz, e, out) {
  // peaks and saddles along the crest (about 50 m apart), with false summits and shoulders between them
  const n1 = vnoise(px * 0.02 + 7.3, pz * 0.02 - 1.9), n2 = vnoise(px * 0.043 - 2.2, pz * 0.043 + 5.4);
  let pk = 1 - Math.abs(2 * n1 - 1); pk *= pk;
  const p2 = 1 - Math.abs(2 * n2 - 1);
  const crestK = sstep(0.2, 0.92, e);
  let d = crestK * (20 * pk + 4 * p2 * p2 - 9);
  // spurs and gullies down the faces (about 18 m apart, wandering as they go down), and smaller ribs on them
  const wq = (vnoise(px * 0.013 + 1.1, pz * 0.013 - 4.2) - 0.5) * 1.6;
  const q1 = vnoise(px * 0.055 + 3.1 + wq, pz * 0.055 + 8.8 - wq), q2 = vnoise(px * 0.12 - 6.6, pz * 0.12 + 2.4);
  const t1 = 2 * q1 - 1, t2 = 2 * q2 - 1;
  const sharp = sstep(0.55, 1.0, e); // arêtes up high, rounded spurs lower down
  const s1 = lerp(t1 * (1.5 - 0.5 * t1 * t1), 1 - 2 * Math.abs(t1), sharp * 0.6);
  const spK = sstep(0.04, 0.38, e) * (1 - 0.4 * sstep(0.8, 1.0, e));
  out.rib = spK * (4.5 * s1 + 2.0 * t2);
  out.gully = Math.max(0, -s1) * spK;
  // the peaks rise a little
  d += 5 * sstep(0.45, 1.0, e);
  return d;
}
// knobs, notches and false summits whichever way a ridge runs (the ends of the ring at the passes, the junctions)
function htsKnobs(x, z, e) {
  const r = ridged(x * 0.028 + 3.7, z * 0.028 - 8.1, 3), r2 = ridged(x * 0.075 - 1.3, z * 0.075 + 4.4, 2);
  return ((r - 0.42) * 24 + (r2 - 0.42) * 5.5) * sstep(0.22, 0.7, e);
}
// the shape over every texel (heights in H are not touched): returns the change
// eslint-disable-next-line no-unused-vars -- Retain the synchronous API used by CPU tools and direct callers.
function htsField(H) { return worldBuildDrain(htsFieldChunks(H)); }
function* htsFieldChunks(H) {
  let chunkWork = 0;
  const N = HN, N2 = N * N, D = new Float32Array(N2), G = new Float32Array(N2), E = new Float32Array(N2);
  const P = { w: [0, 0, 0, 0, 0, 0], px: [0, 0, 0, 0, 0, 0], pz: [0, 0, 0, 0, 0, 0] }, o = { gully: 0 };
  // on a steep face a change of height moves the face itself only by the height over the slope: the ribs and roughness
  // grow with the slope (to 2.6 times on the sheerest), so buttresses and couloirs stand out of a cliff as they do from
  // a gentler face (the knobs less, to 1.7 times: more made a comb of spires along every crest)
  const SL = new Float32Array(N2);
  for (let j = 2; j < N - 2; j++) { if (++chunkWork % WORLD_CHUNK_WORK === 0) yield 'htsField'; for (let i = 2; i < N - 2; i++) { if (++chunkWork % WORLD_CHUNK_WORK === 0) yield 'htsField';  const k = j * N + i; SL[k] = Math.hypot(H[k + 2] - H[k - 2], H[k + 2 * N] - H[k - 2 * N]) / (4 * HS); } }
  for (let j = 0; j < N; j++) { if (++chunkWork % WORLD_CHUNK_WORK === 0) yield 'htsField'; for (let i = 0; i < N; i++) { if (++chunkWork % WORLD_CHUNK_WORK === 0) yield 'htsField';
    const x = -HALF + i * HS, z = -HALF + j * HS, k = j * N + i;
    const n = htsParts(x, z, P);
    if (!n) continue;
    // blended by weight, the strongest part's shape winning where two meet
    let sw = 0, sd = 0, sr = 0, sg = 0, wmax = 0;
    for (let c = 0; c < n; c++) { if (++chunkWork % WORLD_CHUNK_WORK === 0) yield 'htsField';
      const w = P.w[c], w4 = w * w * w * w + 1e-6;
      sd += w4 * htsPart(P.px[c], P.pz[c], w, o); sr += w4 * o.rib; sg += w4 * o.gully; sw += w4;
      wmax = Math.max(wmax, w);
    }
    // fine roughness, so no face is smooth at middle distance
    const rough = (vnoise(x * 0.17 + 5.5, z * 0.17 - 3.3) - 0.5) * 2.2 + (vnoise(x * 0.41 - 1.7, z * 0.41 + 9.1) - 0.5) * 0.9;
    const gain = clamp(SL[k] / 1.1, 1, 2.6);
    // beyond the outer wall's crest, in the map's corners, the high ground is a maze of ridges round shallow cells: the
    // shaping fades out there, or the cells would close into basins and be filled flat
    const corner = sstep(522, 498, Math.hypot(x, z));
    D[k] = corner * ((sd / sw) * sstep(0.02, 0.16, wmax) + gain * (sr / sw) * sstep(0.02, 0.16, wmax) + Math.min(gain, 1.7) * htsKnobs(x, z, wmax)) + gain * rough * sstep(0.12, 0.5, wmax) * corner;
    G[k] = sg / sw; E[k] = wmax;
  } }
  return { D, G, E };
}
// the south's peaks stay under its summer snow line (landSnowLine, 02e_land.js), Thule's may rise higher
function htsCap(h, k) {
  const th = W.realmW ? W.realmW[k * 3 + 2] : 0, cap = lerp(57, 66, sstep(0.3, 0.7, th));
  return h > cap ? cap + (h - cap) * 0.5 : h;
}
const htsSlope = (H, k) => Math.hypot(H[k + 1] - H[k - 1], H[k + HN] - H[k - HN]) / (2 * HS);
// the ground anyone can reach: flooded from the roads over ground that is not blocked (as the land's checks have it)
// eslint-disable-next-line no-unused-vars -- Retain the synchronous API used by CPU tools and direct callers.
function htsReach(walk) { return worldBuildDrain(htsReachChunks(walk)); }
function* htsReachChunks(walk) {
  let chunkWork = 0;
  const N = HN, N2 = N * N, reach = new Uint8Array(N2), st = [];
  const seed = (x, z) => { const k = Math.round((z + HALF) / HS) * N + Math.round((x + HALF) / HS); if (walk[k] !== 1 && !reach[k]) { reach[k] = 1; st.push(k); } };
  for (const S of W.roads) { if (++chunkWork % WORLD_CHUNK_WORK === 0) yield 'htsReach';  seed(S.ax, S.az); seed(S.bx, S.bz); }
  while (st.length) { if (++chunkWork % WORLD_CHUNK_WORK === 0) yield 'htsReach';
    const k = st.pop(), i = k % N, j = (k / N) | 0;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      const ii = i + di, jj = j + dj;
      if (ii < 0 || jj < 0 || ii >= N || jj >= N) continue;
      const q = jj * N + ii;
      if (!reach[q] && walk[q] !== 1) { reach[q] = 1; st.push(q); }
    }
  }
  return reach;
}
// apply the field: ctx = { H, walk, reach, keep (0 free .. 1 untouched), objs ([x, z, r0, r1]: the ground within r0 of
// each moves by the change at its centre, so what stands there keeps its footing and only settles) }; H is changed
// in place
// eslint-disable-next-line no-unused-vars -- Retain the synchronous API used by CPU tools and direct callers.
function htsApply(ctx) { return worldBuildDrain(htsApplyChunks(ctx)); }
function* htsApplyChunks(ctx) {
  let chunkWork = 0;
  const N = HN, N2 = N * N, { H, walk, reach, keep } = ctx;
  const T = ctx.T = {}, tk = (n) => { const t = performance.now(); T[n] = Math.round(t - (T._ || t)); T._ = t; };
  tk('start');
  const H0 = H.slice(), { D, G, E } = (yield* htsFieldChunks(H0));
  tk('field');
  // water's work on the shaped faces (htsErode): the ground kept as it was is the base level they drain to
  if (ctx.erode !== 0) {
    const Hw = new Float32Array(N2), Ae = new Float32Array(N2);
    for (let k = 0; k < N2; k++) { if (++chunkWork % WORLD_CHUNK_WORK === 0) yield 'htsApply';  Hw[k] = D[k] ? htsCap(H0[k] + D[k], k) : H0[k]; Ae[k] = D[k] ? (1 - keep[k]) * sstep(522, 498, Math.hypot(-HALF + (k % N) * HS, -HALF + ((k / N) | 0) * HS)) : 0; }
    const pre = Hw.slice();
    (yield* htsErodeChunks(Hw, Ae, E, ctx.erode || 16));
    for (let k = 0; k < N2; k++) { if (++chunkWork % WORLD_CHUNK_WORK === 0) yield 'htsApply'; if (D[k]) { const cut = pre[k] - Hw[k]; D[k] = Hw[k] - H0[k]; G[k] = Math.max(G[k], clamp(cut / 4, 0, 1)); } }
  }
  tk('erode');
  if (ctx.objs) {
    const Wm = new Float32Array(N2), Ws = new Float32Array(N2), WD = new Float32Array(N2);
    const at = (x, z) => sampleGrid(D, x, z);
    for (const [x, z, r0, r1] of ctx.objs) { if (++chunkWork % WORLD_CHUNK_WORK === 0) yield 'htsApply';
      const dc = at(x, z);
      const i0 = Math.max(0, Math.floor((x - r1 + HALF) / HS)), i1 = Math.min(N - 1, Math.ceil((x + r1 + HALF) / HS));
      const j0 = Math.max(0, Math.floor((z - r1 + HALF) / HS)), j1 = Math.min(N - 1, Math.ceil((z + r1 + HALF) / HS));
      for (let j = j0; j <= j1; j++) { if (++chunkWork % WORLD_CHUNK_WORK === 0) yield 'htsApply'; for (let i = i0; i <= i1; i++) { if (++chunkWork % WORLD_CHUNK_WORK === 0) yield 'htsApply';
        const q = j * N + i, d = Math.hypot(-HALF + i * HS - x, -HALF + j * HS - z);
        if (d >= r1) continue;
        const w = 1 - sstep(r0, r1, d);
        if (w > Wm[q]) Wm[q] = w;
        Ws[q] += w; WD[q] += w * dc;
      } }
    }
    for (let k = 0; k < N2; k++) { if (++chunkWork % WORLD_CHUNK_WORK === 0) yield 'htsApply'; if (Wm[k] > 0) D[k] = D[k] * (1 - Wm[k]) + (WD[k] / Ws[k]) * Wm[k]; }
  }
  const S0 = new Float32Array(N2);
  for (let j = 1; j < N - 1; j++) { if (++chunkWork % WORLD_CHUNK_WORK === 0) yield 'htsApply'; for (let i = 1; i < N - 1; i++) { if (++chunkWork % WORLD_CHUNK_WORK === 0) yield 'htsApply'; S0[j * N + i] = htsSlope(H0, j * N + i); } }
  // the share of the change each texel takes: none where something is built or anyone needs the ground as it was;
  // on ground anyone can reach, only as much as keeps it walkable (the ribs across the slope may be steeper where the
  // slope down it is gentle); the faces and crests no one can reach take all of it
  const A = new Float32Array(N2), low = new Uint8Array(N2);
  for (let k = 0; k < N2; k++) { if (++chunkWork % WORLD_CHUNK_WORK === 0) yield 'htsApply';
    if (reach[k] && walk[k] === 0) low[k] = 1;
    if (!D[k]) continue;
    const up = sstep(0.42, 0.62, E[k]);
    let f = 1;
    if (reach[k] && walk[k] === 0) {
      const room = Math.sqrt(Math.max(0, 0.8 * 0.8 - S0[k] * S0[k]));
      f = clamp(room / 2.2, 0.12, 1) * lerp(1, 1.6, up);
    }
    A[k] = (1 - keep[k]) * f;
  }
  // smoothed, so the share never steps from one texel to the next
  for (let pass = 0; pass < 2; pass++) { if (++chunkWork % WORLD_CHUNK_WORK === 0) yield 'htsApply';
    const B = A.slice();
    for (let j = 1; j < N - 1; j++) { if (++chunkWork % WORLD_CHUNK_WORK === 0) yield 'htsApply'; for (let i = 1; i < N - 1; i++) { if (++chunkWork % WORLD_CHUNK_WORK === 0) yield 'htsApply';
      const k = j * N + i;
      if (!D[k] || keep[k] >= 1) continue;
      B[k] = (A[k] * 4 + A[k - 1] + A[k + 1] + A[k - N] + A[k + N]) / 8;
    } }
    A.set(B);
  }
  const FL = new Float32Array(N2).fill(-1e9); // the level a texel is filled to (a hollow the shaping made)
  const set = (k) => { const h = A[k] > 0 ? htsCap(H0[k] + D[k] * A[k], k) : H0[k]; H[k] = h > FL[k] ? h : FL[k]; };
  const act = [];
  for (let k = 0; k < N2; k++) { if (++chunkWork % WORLD_CHUNK_WORK === 0) yield 'htsApply';  if (D[k]) act.push(k); set(k); }
  const lows = [];
  for (let j = 3; j < N - 3; j++) { if (++chunkWork % WORLD_CHUNK_WORK === 0) yield 'htsApply'; for (let i = 3; i < N - 3; i++) { if (++chunkWork % WORLD_CHUNK_WORK === 0) yield 'htsApply'; if (low[j * N + i]) lows.push(j * N + i); } }
  // ground anyone can reach stays walkable: where a slope there passes the limit, the change round it (the slope at a
  // texel is set by its four neighbours) is eased off over a few metres, never at one texel
  let limited = 0;
  const DK = [];
  for (let dj = -3; dj <= 3; dj++) { if (++chunkWork % WORLD_CHUNK_WORK === 0) yield 'htsApply'; for (let di = -3; di <= 3; di++) { const w = 1 - Math.hypot(di, dj) / 4.3; if (w > 0) DK.push([dj * N + di, 1 - 0.18 * w]); } }
  const touched = new Uint8Array(N2), tl = [];
  function* limitChunks() {
  let chunkWork = 0;
    for (let it = 0; it < 90; it++) { if (++chunkWork % WORLD_CHUNK_WORK === 0) yield 'limit';
      let bad = 0;
      for (const k of lows) { if (++chunkWork % WORLD_CHUNK_WORK === 0) yield 'limit';
        if (htsSlope(H, k) <= Math.max(0.92, S0[k] + 0.002)) continue;
        bad++;
        for (const [o, f] of DK) { if (++chunkWork % WORLD_CHUNK_WORK === 0) yield 'limit';  const q = k + o; if (A[q] > 0) { A[q] *= f; if (!touched[q]) { touched[q] = 1; tl.push(q); } } }
      }
      if (!bad) return 0;
      limited += bad;
      for (const q of tl) { if (++chunkWork % WORLD_CHUNK_WORK === 0) yield 'limit';  set(q); touched[q] = 0; }
      tl.length = 0;
    }
    return 1;
  }
  // what the shaping hollowed out is filled (no dry pond beds); where a hollow would reach ground left as it was
  // (by a pond, a road, a camp), the shaping round it is taken back
  const F0 = (yield* mtnFloodChunks(H0)), hol = ctx.hollow || new Uint8Array(N2);
  let filled = 0, reverted = 0;
  function* fillChunks() {
  let chunkWork = 0;
    let any = 0;
    for (let pass = 0; pass < 6; pass++) { if (++chunkWork % WORLD_CHUNK_WORK === 0) yield 'fill';
      const F = (yield* mtnFloodChunks(H)), trig = [];
      for (let k = 0; k < N2; k++) { if (++chunkWork % WORLD_CHUNK_WORK === 0) yield 'fill';
        const deep = F[k] - H[k], deep0 = F0[k] - H0[k];
        if (deep < 0.004 && deep0 < 0.004) continue;
        if (H[k] !== H0[k]) { if (deep > 0.004) { FL[k] = H[k] = F[k]; filled++; any = 1; } continue; }
        // ground left as it was that the shaping turns into a deeper hollow (a dry pond bed), or that drains another way
        // by a pond (its water would stand over the new outlet)
        if (Math.abs(F[k] - F0[k]) > 0.004 && (hol[k] || deep > Math.max(0.2, deep0 + 0.05))) trig.push(k);
      }
      // (the take-backs after the whole map is looked at: a stale flood must not start a cascade of them)
      for (const k of trig) { if (++chunkWork % WORLD_CHUNK_WORK === 0) yield 'fill';
        if (ctx.trigAt) { const x = -HALF + (k % N) * HS, z = -HALF + ((k / N) | 0) * HS, r = Math.hypot(x, z), key = (r < 300 ? 'ring' : r < 500 ? 'mid' : 'corner') + (hol[k] ? 'H' : ''); ctx.trigAt[key] = (ctx.trigAt[key] || 0) + 1; }
        const i = k % N, j = (k / N) | 0, R = Math.hypot(-HALF + i * HS, -HALF + j * HS) > 495 ? 14 : 8; // (wider by the map's corners, where the outer wall's crest dams the shallow cells behind it)
        for (let dj = -R; dj <= R; dj++) { if (++chunkWork % WORLD_CHUNK_WORK === 0) yield 'fill'; for (let di = -R; di <= R; di++) { if (++chunkWork % WORLD_CHUNK_WORK === 0) yield 'fill';
          const ii = i + di, jj = j + dj;
          if (ii < 0 || jj < 0 || ii >= N || jj >= N) continue;
          const q = jj * N + ii;
          if (H[q] !== H0[q]) { H[q] = H0[q]; A[q] = 0; FL[q] = -1e9; reverted++; any = 1; }
        } }
      }
      ctx.trigN = (ctx.trigN || 0) + trig.length;
      if (!trig.length) break;
    }
    return any;
  }
  tk('prep');
  // (the fill has the last word: a texel or two by a filled hollow may end a little steeper than the limit, and stays
  // walkable as it was: mtnHeights never blocks ground anyone could reach; easing the slopes again after it would
  // open new hollows, and filling those would steepen more)
  (yield* limitChunks()); (yield* fillChunks());
  { const F = (yield* mtnFloodChunks(H)); for (let k = 0; k < N2; k++) { if (++chunkWork % WORLD_CHUNK_WORK === 0) yield 'htsApply'; if (H[k] !== H0[k] && F[k] - H[k] > 0.004) { FL[k] = H[k] = F[k]; filled++; } } } // (the last word)
  tk('rounds');
  ctx.H0 = H0; ctx.S0 = S0; ctx.G = G; ctx.A = A; ctx.E = E; ctx.low = low; ctx.Dd = D; ctx.FL = FL; ctx.limited = limited; ctx.filled = filled; ctx.reverted = reverted;
  return ctx;
}
// how much each texel is kept from the shaping (1: exactly as it was), from everything built and every way anyone
// goes: o = { sites, roads, camps, rivers (courses: [x, z, surf, hw]), wet (texels with water), hollow, stones,
// circles ([x, z, r]), boxes ([x, z, hx, hz]), plots ([x, z, r]), spots ([x, z, r0, r1]) }. (Trees, rocks, plants and
// herbs are not kept: the ground round each moves as one with it, and it settles: htsApply's objs.)
// eslint-disable-next-line no-unused-vars -- Retain the synchronous API used by CPU tools and direct callers.
function htsKeep(o) { return worldBuildDrain(htsKeepChunks(o)); }
function* htsKeepChunks(o) {
  let chunkWork = 0;
  const N = HN, N2 = N * N, K = new Float32Array(N2), H = o.H;
  // (y: the height of what is kept there; ground rising well above it, a wall over a road or a site, is not kept)
  const up = (q, y) => (y === undefined ? 1 : 1 - sstep(5, 13, H[q] - y));
  function* discChunks(x, z, r0, r1, y) {
  let chunkWork = 0;
    const i0 = Math.max(0, Math.floor((x - r1 + HALF) / HS)), i1 = Math.min(N - 1, Math.ceil((x + r1 + HALF) / HS));
    const j0 = Math.max(0, Math.floor((z - r1 + HALF) / HS)), j1 = Math.min(N - 1, Math.ceil((z + r1 + HALF) / HS));
    for (let j = j0; j <= j1; j++) { if (++chunkWork % WORLD_CHUNK_WORK === 0) yield 'disc'; for (let i = i0; i <= i1; i++) { if (++chunkWork % WORLD_CHUNK_WORK === 0) yield 'disc';
      const q = j * N + i, d = Math.hypot(-HALF + i * HS - x, -HALF + j * HS - z);
      if (d >= r1) continue;
      const v = (1 - sstep(r0, r1, d)) * up(q, y);
      if (v > K[q]) K[q] = v;
    } }
  }
  function* segChunks(ax, az, bx, bz, r0, r1, rel) {
  let chunkWork = 0;
    const i0 = Math.max(0, Math.floor((Math.min(ax, bx) - r1 + HALF) / HS)), i1 = Math.min(N - 1, Math.ceil((Math.max(ax, bx) + r1 + HALF) / HS));
    const j0 = Math.max(0, Math.floor((Math.min(az, bz) - r1 + HALF) / HS)), j1 = Math.min(N - 1, Math.ceil((Math.max(az, bz) + r1 + HALF) / HS));
    for (let j = j0; j <= j1; j++) { if (++chunkWork % WORLD_CHUNK_WORK === 0) yield 'seg'; for (let i = i0; i <= i1; i++) { if (++chunkWork % WORLD_CHUNK_WORK === 0) yield 'seg';
      const x = -HALF + i * HS, z = -HALF + j * HS, q = j * N + i, d = Math.sqrt(segDist2(x, z, ax, az, bx, bz));
      if (d >= r1) continue;
      let v = 1 - sstep(r0, r1, d);
      if (rel) { const ex = bx - ax, ez = bz - az, t = clamp(((x - ax) * ex + (z - az) * ez) / (ex * ex + ez * ez || 1), 0, 1); v *= up(q, sampleGrid(H, ax + ex * t, az + ez * t)); }
      if (v > K[q]) K[q] = v;
    } }
  }
  for (const S of o.sites) { if (++chunkWork % WORLD_CHUNK_WORK === 0) yield 'htsKeep';  (yield* discChunks(S.x, S.z, S.r + S.f, S.r + S.f + 4)); (yield* discChunks(S.x, S.z, S.r + S.f, S.r + S.f + 9, S.y)); }
  for (const R of o.roads) { if (++chunkWork % WORLD_CHUNK_WORK === 0) yield 'htsKeep'; (yield* segChunks(R.ax, R.az, R.bx, R.bz, R.w + 4, R.w + 12, true)); }
  for (const c of o.camps) { if (++chunkWork % WORLD_CHUNK_WORK === 0) yield 'htsKeep';  (yield* discChunks(c.x, c.z, c.r + 4, c.r + 8)); (yield* discChunks(c.x, c.z, c.r + 8, c.r + 19, sampleGrid(H, c.x, c.z))); }
  for (const C of o.rivers) { if (++chunkWork % WORLD_CHUNK_WORK === 0) yield 'htsKeep'; for (let n = 0; n + 1 < C.length; n++) { if (++chunkWork % WORLD_CHUNK_WORK === 0) yield 'htsKeep'; (yield* segChunks(C[n][0], C[n][1], C[n + 1][0], C[n + 1][1], C[n][3] + 7, C[n][3] + 16, true)); } }
  // water and the hollows that hold it, and their brims
  { // (a distance from every texel to the nearest wet or hollow one, in two sweeps, rather than a disc round each)
    const Dw = new Float32Array(N2), d1 = HS, d2 = HS * Math.SQRT2;
    for (let k = 0; k < N2; k++) { if (++chunkWork % WORLD_CHUNK_WORK === 0) yield 'htsKeep'; Dw[k] = o.wet[k] || o.hollow[k] ? 0 : 1e4; }
    for (let j = 0; j < N; j++) { if (++chunkWork % WORLD_CHUNK_WORK === 0) yield 'htsKeep'; for (let i = 0; i < N; i++) { if (++chunkWork % WORLD_CHUNK_WORK === 0) yield 'htsKeep';
      const k = j * N + i; let v = Dw[k];
      if (i > 0) v = Math.min(v, Dw[k - 1] + d1);
      if (j > 0) { v = Math.min(v, Dw[k - N] + d1); if (i > 0) v = Math.min(v, Dw[k - N - 1] + d2); if (i < N - 1) v = Math.min(v, Dw[k - N + 1] + d2); }
      Dw[k] = v;
    } }
    for (let j = N - 1; j >= 0; j--) { if (++chunkWork % WORLD_CHUNK_WORK === 0) yield 'htsKeep'; for (let i = N - 1; i >= 0; i--) { if (++chunkWork % WORLD_CHUNK_WORK === 0) yield 'htsKeep';
      const k = j * N + i; let v = Dw[k];
      if (i < N - 1) v = Math.min(v, Dw[k + 1] + d1);
      if (j < N - 1) { v = Math.min(v, Dw[k + N] + d1); if (i < N - 1) v = Math.min(v, Dw[k + N + 1] + d2); if (i > 0) v = Math.min(v, Dw[k + N - 1] + d2); }
      Dw[k] = v;
      const w = 1 - sstep(4, 11, v);
      if (w > K[k]) K[k] = w;
    } }
  }
  for (const s of o.stones) { if (++chunkWork % WORLD_CHUNK_WORK === 0) yield 'htsKeep'; (yield* discChunks(s[0], s[1], 2.5, 6)); }
  for (const c of o.circles) { if (++chunkWork % WORLD_CHUNK_WORK === 0) yield 'htsKeep'; (yield* discChunks(c[0], c[1], c[2] + 1.5, c[2] + 5)); }
  for (const b of o.boxes) { if (++chunkWork % WORLD_CHUNK_WORK === 0) yield 'htsKeep';  const r = Math.hypot(b[2], b[3]); (yield* discChunks(b[0], b[1], r + 1.5, r + 5)); }
  for (const p of o.plots) { if (++chunkWork % WORLD_CHUNK_WORK === 0) yield 'htsKeep'; (yield* discChunks(p[0], p[1], p[2] + 3, p[2] + 9)); }
  for (const s of o.spots) { if (++chunkWork % WORLD_CHUNK_WORK === 0) yield 'htsKeep'; (yield* discChunks(s[0], s[1], s[2], s[3])); }
  return K;
}
// texels in or next to a closed hollow deeper than a hand (the ponds' basins, and the hollows left dry because
// something stands in them), and their brims
// eslint-disable-next-line no-unused-vars -- Retain the synchronous API used by CPU tools and direct callers.
function htsHollows(H) { return worldBuildDrain(htsHollowsChunks(H)); }
function* htsHollowsChunks(H) {
  let chunkWork = 0;
  const N = HN, N2 = N * N, F = (yield* mtnFloodChunks(H)), out = new Uint8Array(N2);
  for (let k = 0; k < N2; k++) { if (++chunkWork % WORLD_CHUNK_WORK === 0) yield 'htsHollows'; if (F[k] - H[k] > 0.12) {
    const i = k % N, j = (k / N) | 0;
    for (let dj = -3; dj <= 3; dj++) for (let di = -3; di <= 3; di++) { const ii = i + di, jj = j + dj; if (ii >= 0 && jj >= 0 && ii < N && jj < N) out[jj * N + ii] = 1; }
  } }
  return out;
}

// [heights] water's work on the faces: a few rounds of stream-power erosion over the shaped mountain (each texel
// drains to its steepest neighbour, gathers the water from above, and is cut down by the water running over it and
// the slope it runs down), so gullies branch down the fall line wherever it runs (round the ends of the ring at the
// passes, the junctions with the ridges, the corners of the outer wall) and spurs stand between them; then the
// steepest faces slump (a talus slope). Only texels with a share (A > 0) move; the rest are the base level.
// eslint-disable-next-line no-unused-vars -- Retain the synchronous API used by CPU tools and direct callers.
function htsErode(H, A, E, iters) { return worldBuildDrain(htsErodeChunks(H, A, E, iters)); }
function* htsErodeChunks(H, A, E, iters) {
  let chunkWork = 0;
  const N = HN, N2 = N * N, ord = [], rec = new Int8Array(N2), acc = new Float32Array(N2), pre = H.slice();
  for (let j = 2; j < N - 2; j++) { if (++chunkWork % WORLD_CHUNK_WORK === 0) yield 'htsErode'; for (let i = 2; i < N - 2; i++) { if (++chunkWork % WORLD_CHUNK_WORK === 0) yield 'htsErode';  const k = j * N + i; if (A[k] > 0.02 && E[k] > 0.03) ord.push(k); } }
  const nb = [1, -1, N, -N, N + 1, N - 1, -N + 1, -N - 1], nd = [HS, HS, HS, HS, HS * Math.SQRT2, HS * Math.SQRT2, HS * Math.SQRT2, HS * Math.SQRT2];
  const lap = new Float32Array(ord.length);
  for (let it = 0; it < iters; it++) { if (++chunkWork % WORLD_CHUNK_WORK === 0) yield 'htsErode';
    if (it % 4 === 0) ord.sort((a, b) => H[b] - H[a]);
    // each texel drains to its steepest neighbour and passes on the water gathered above it
    for (const k of ord) { if (++chunkWork % WORLD_CHUNK_WORK === 0) yield 'htsErode';
      let bs = 0, bq = -1;
      for (let q = 0; q < 8; q++) { const s = (H[k] - H[k + nb[q]]) / nd[q]; if (s > bs) { bs = s; bq = q; } }
      rec[k] = bq; acc[k] = 1;
    }
    for (const k of ord) { if (++chunkWork % WORLD_CHUNK_WORK === 0) yield 'htsErode';  const q = rec[k]; if (q >= 0) acc[k + nb[q]] += acc[k]; }
    // the water cuts the ground by how much of it there is and how steeply it falls (never below the next texel
    // down, never more than 10 m in all)
    for (let o = ord.length - 1; o >= 0; o--) { if (++chunkWork % WORLD_CHUNK_WORK === 0) yield 'htsErode';
      const k = ord[o], q = rec[k];
      if (q < 0) continue;
      const n = k + nb[q], s = (H[k] - H[n]) / nd[q];
      const cut = Math.min(0.11 * Math.sqrt(acc[k]) * s * A[k] * sstep(0.03, 0.3, E[k]), (H[k] - H[n]) * 0.5);
      H[k] = Math.max(H[k] - cut, pre[k] - 10);
    }
    // the hillsides creep a little and the steepest faces slump (no slope over about 62 degrees between neighbours)
    for (let o = 0; o < ord.length; o++) { if (++chunkWork % WORLD_CHUNK_WORK === 0) yield 'htsErode';  const k = ord[o]; lap[o] = H[k - 1] + H[k + 1] + H[k - N] + H[k + N] - 4 * H[k]; }
    for (let o = 0; o < ord.length; o++) { if (++chunkWork % WORLD_CHUNK_WORK === 0) yield 'htsErode';  const k = ord[o]; H[k] += 0.02 * lap[o] * A[k] * (1 - sstep(0.7, 0.9, E[k])); }
    for (const k of ord) { if (++chunkWork % WORLD_CHUNK_WORK === 0) yield 'htsErode'; for (let q = 0; q < 4; q++) {
      const n = k + nb[q], d = H[k] - H[n] - Math.max(2.6, pre[k] - pre[n] + 0.4) * HS;
      if (d > 0 && A[n] > 0.02) { H[k] -= d * 0.25; H[n] += d * 0.25; }
    } }
  }
  return acc;
}

/* ------------------------------------------------------------------ */
/* in the world: called by boot once everything is placed (13_main.js)  */
/* ------------------------------------------------------------------ */
// eslint-disable-next-line no-unused-vars -- Retain the synchronous API used by CPU tools and direct callers.
function mtnHeights() { return worldBuildDrain(mtnHeightsChunks()); }
function* mtnHeightsChunks() {
  let chunkWork = 0;
  if (HTS.done || !W.H || !W.walk) return;
  HTS.done = true;
  const t0 = performance.now(), N = HN, N2 = N * N, H = W.H;
  try {
    const wet = new Uint8Array(N2);
    if (WATERGRID.surf) for (let k = 0; k < N2; k++) { if (++chunkWork % WORLD_CHUNK_WORK === 0) yield 'mtnHeights'; if (!isNaN(WATERGRID.surf[k])) wet[k] = 1; }
    const walk0 = W.walk.slice(), reach = (yield* htsReachChunks(walk0)), hollow = (yield* htsHollowsChunks(H));
    const circles = [], boxes = [], spots = [[0, 0, 42, 64]];
    for (const c of COLL.circles) { if (++chunkWork % WORLD_CHUNK_WORK === 0) yield 'mtnHeights'; if (c.x < DUN_X0 && c.tag !== 'tree' && c.tag !== 'rock' && c.tag !== 'bush') circles.push([c.x, c.z, c.r]); }
    for (const c of COLL.boxes) { if (++chunkWork % WORLD_CHUNK_WORK === 0) yield 'mtnHeights'; if (c.x < DUN_X0 && c.tag !== 'tree') boxes.push([c.x, c.z, c.hx, c.hz]); }
    if (BARROW && BARROW.door) spots.push([BARROW.door.x, BARROW.door.z, 30, 46]);
    for (const J of BOATS.jetties || []) { if (++chunkWork % WORLD_CHUNK_WORK === 0) yield 'mtnHeights'; spots.push([J.x0 + J.dx * J.len * 0.5, J.z0 + J.dz * J.len * 0.5, J.len * 0.5 + 6, J.len * 0.5 + 14]); }
    const TT = HTS.TT = {}, tt = (n) => { const t = performance.now(); TT[n] = Math.round(t - (TT._ || t0)); TT._ = t; };
    tt('reach');
    const keep = (yield* htsKeepChunks({ H, sites: SITES, roads: W.roads, camps: W.camps, rivers: RIVERS.map((Rv) => Rv.pts.map((p) => [p.x, p.z, p.surf, p.hw])), wet, hollow,
      stones: (W.stones || []).map((t) => [t.x, t.z]), circles, boxes, plots: (FARM.plots || []).map((P) => [P.x, P.z, P.rad || 10]), spots }));
    // trees, rocks, plants and herbs: the ground round each moves with it, and it settles
    const objs = [];
    for (const t of W.trees) { if (++chunkWork % WORLD_CHUNK_WORK === 0) yield 'mtnHeights'; objs.push([t.x, t.z, 1.2 * t.s + 0.8, 1.2 * t.s + 4.8]); }
    for (const r of W.rocks) { if (++chunkWork % WORLD_CHUNK_WORK === 0) yield 'mtnHeights'; objs.push([r.x, r.z, 0.8 * r.s + 0.6, 0.8 * r.s + 3.6]); }
    for (const p of FORAGE.list || []) { if (++chunkWork % WORLD_CHUNK_WORK === 0) yield 'mtnHeights'; objs.push([p.x, p.z, 1.6, 5]); }
    for (const h of FARM.herbs || []) { if (++chunkWork % WORLD_CHUNK_WORK === 0) yield 'mtnHeights'; objs.push([h.x, h.z, 1.6, 5]); }
    tt('keep');
    const ctx = (yield* htsApplyChunks({ H, walk: walk0, reach, keep, objs, wet, hollow }));
    tt('apply');
    const H0 = ctx.H0;
    // [look] no shaped texel stands up out of all eight round it by more than 0.6 m: one such 2 m spike was a smooth,
    // sharp-faced pyramid seen from the slopes below (by the Logres muster). Brought down to 0.6 m over the highest of
    // them it is still the top (no hollow forms) and its slopes only ease (walkable ground stays walkable)
    HTS.despiked = 0;
    for (let pass = 0; pass < 2; pass++) { if (++chunkWork % WORLD_CHUNK_WORK === 0) yield 'mtnHeights'; for (let j = 1; j < N - 1; j++) { if (++chunkWork % WORLD_CHUNK_WORK === 0) yield 'mtnHeights'; for (let i = 1; i < N - 1; i++) { if (++chunkWork % WORLD_CHUNK_WORK === 0) yield 'mtnHeights';
      const k = j * N + i;
      if (H[k] === H0[k]) continue;
      let mx = -1e9;
      for (const d of [-1, 1, -N, N, -N - 1, -N + 1, N - 1, N + 1]) if (H[k + d] > mx) mx = H[k + d];
      if (H[k] - mx > 0.6) { H[k] = mx + 0.6; HTS.despiked++; }
    } } }
    HTS.H0 = H0; HTS.walk0 = walk0; HTS.reach = reach; HTS.keep = keep;
    HTS.limited = ctx.limited; HTS.filled = ctx.filled; HTS.reverted = ctx.reverted; HTS.T = ctx.T;
    // the walk mask: ground anyone could reach stays walkable as it was (htsApply held its slope; reachSteep counts the
    // few texels by a filled hollow left a little steeper than the limit); ground no one could reach that the shaping
    // made too steep is blocked now (walkLost); nothing new opens
    const changed = new Uint8Array(N2);
    let nCh = 0;
    for (let k = 0; k < N2; k++) { if (++chunkWork % WORLD_CHUNK_WORK === 0) yield 'mtnHeights'; if (H[k] !== H0[k]) { changed[k] = 1; nCh++; } }
    HTS.changed = changed; HTS.nChanged = nCh;
    let lostU = 0, lostR = 0, keptR = 0;
    for (let j = 1; j < N - 1; j++) { if (++chunkWork % WORLD_CHUNK_WORK === 0) yield 'mtnHeights'; for (let i = 1; i < N - 1; i++) { if (++chunkWork % WORLD_CHUNK_WORK === 0) yield 'mtnHeights';
      const k = j * N + i;
      if (W.walk[k] !== 0) continue;
      if (!(changed[k] || changed[k - 1] || changed[k + 1] || changed[k - N] || changed[k + N])) continue;
      if (reach[k]) { keptR++; if (htsSlope(H, k) > Math.max(0.95, ctx.S0[k] + 0.002)) lostR++; continue; } // (stays walkable)
      if (htsSlope(H, k) <= Math.max(0.95, ctx.S0[k] + 0.002)) continue;
      W.walk[k] = 1; lostU++;
    } }
    HTS.walkLost = lostU; HTS.reachSteep = lostR; HTS.reachKept = keptR;
    // the rock, grass and flower masks follow the new slopes
    for (let j = 1; j < N - 1; j++) { if (++chunkWork % WORLD_CHUNK_WORK === 0) yield 'mtnHeights'; for (let i = 1; i < N - 1; i++) { if (++chunkWork % WORLD_CHUNK_WORK === 0) yield 'mtnHeights';
      const k = j * N + i;
      if (!(changed[k] || changed[k - 1] || changed[k + 1] || changed[k - N] || changed[k + N])) continue;
      const x = -HALF + i * HS, z = -HALF + j * HS, h = H[k], sl = htsSlope(H, k);
      const rk = clamp(sstep(0.42, 0.85, sl) + sstep(18, 34, h) * 0.5 + (h > 12 ? 0.25 * vnoise(x * 0.1, z * 0.1) : 0), 0, 1);
      const was = 1 - W.rock[k] * 0.95, now = 1 - rk * 0.95;
      const g = clamp(W.grass[k] * now / Math.max(0.05, was), 0, 1);
      W.flower[k] = W.grass[k] > 0.01 ? clamp(W.flower[k] * g / W.grass[k], 0, 1) : 0;
      W.grass[k] = g; W.rock[k] = rk;
    } }
    // what stands on the mountains settles onto the new ground
    const dy = (x, z) => sampleGrid(H, x, z) - sampleGrid(H0, x, z);
    let nT = 0, nR = 0;
    for (const t of W.trees) { if (++chunkWork % WORLD_CHUNK_WORK === 0) yield 'mtnHeights';
      const d = dy(t.x, t.z);
      if (Math.abs(d) < 1e-4) continue;
      t.y += d; nT++;
      if (t.chunk) { const a = t.chunk.geometry.attributes.iPos; a.array[t.ci * 4 + 1] = t.y - 0.15; a.needsUpdate = true; }
    }
    const rockMeshes = [];
    scene.traverse((o) => { if (o.isMesh && o.material === rockMat && o.geometry.attributes.iPos && o.geometry.attributes.iPos.itemSize === 4) rockMeshes.push(o); });
    const seen = [0, 0, 0];
    W.rocks.forEach((r, i) => {
      const v = i % 3, n = seen[v]++, d = dy(r.x, r.z);
      if (Math.abs(d) < 1e-4) return;
      r.y += d; nR++;
      const m = rockMeshes[v];
      if (m && n < m.geometry.instanceCount) { const a = m.geometry.attributes.iPos; a.array[n * 4 + 1] = r.y - r.s * 0.2; a.needsUpdate = true; }
    });
    for (const c of COLL.circles) { if (++chunkWork % WORLD_CHUNK_WORK === 0) yield 'mtnHeights'; if (c.tag === 'rock' || c.tag === 'bush' || c.tag === 'tree') { const d = dy(c.x, c.z); if (d) c.baseY += d; } }
    for (const p of FORAGE.list || []) { if (++chunkWork % WORLD_CHUNK_WORK === 0) yield 'mtnHeights';  const d = dy(p.x, p.z); if (d) p.y += d; }
    if (typeof FORAGE !== 'undefined') FORAGE.dirty = true;
    for (const h of FARM.herbs || []) { if (++chunkWork % WORLD_CHUNK_WORK === 0) yield 'mtnHeights';  const d = dy(h.x, h.z); if (d) h.y += d; }
    if (typeof FARM !== 'undefined') FARM.drawDirty = true;
    HTS.settled = { trees: nT, rocks: nR };
    // the gullies the water cut, for the land map (damp, and the snow lies longest in them)
    for (let k = 0; k < N2; k++) { if (++chunkWork % WORLD_CHUNK_WORK === 0) yield 'mtnHeights'; if (changed[k]) MTN.gully[k] = Math.max(MTN.gully[k] || 0, clamp(ctx.G[k] * Math.max(0, ctx.A[k]), 0, 1)), MTN.shaped[k] = 1; }
    MTN.nShaped = MTN.shaped.reduce((a, v) => a + v, 0);
    tt('settle');
    (yield* htsTreesChunks()); // hardy trees on the lower slopes, after every tree there was
    tt('trees');
    (yield* htsRefreshChunks(changed));
    tt('refresh');
  } catch (err) {
    reportError(err);
  }
  // the crags on the final ground (whatever happened above), and outcrops on the walkable lower slopes
  (yield* mtnFreeAgainChunks());
  (yield* mtnPlaceCragsChunks());
  try { (yield* htsOutcropsChunks()); } catch (err) { reportError(err); }
  buildCrags();
  buildCoverMask();
  HTS.ms = Math.round(performance.now() - t0);
  if (HTS.TT) HTS.TT.crags = Math.round(performance.now() - HTS.TT._);
  if (window.__hm) window.__hm.heights = htsHooks();
}
// test hooks (__hm.heights): the numbers, and the ground as it was at a texel
function htsHooks() {
  return {
    HTS, stats: () => ({ ms: HTS.ms, changed: HTS.nChanged, limited: HTS.limited, filled: HTS.filled, reverted: HTS.reverted, walkLost: HTS.walkLost, reachSteep: HTS.reachSteep, reachKept: HTS.reachKept, T: HTS.T, TT: HTS.TT, settled: HTS.settled, trees0: HTS.trees0, hardy: HTS.hardy, outcrops: HTS.outcrops, treeMeshes: HTS.treeMeshes, treeWhy: HTS.treeWhy, crags: MTN.crags.length }),
    was: (x, z) => (HTS.H0 ? sampleGrid(HTS.H0, x, z) : null),
    changedAt: (x, z) => (HTS.changed ? HTS.changed[mtnK(x, z)] : 0),
  };
}
// ground anyone could stand on and how far each texel is from it (as mtnShape has it), from the walk mask as it is now
// eslint-disable-next-line no-unused-vars -- Retain the synchronous API used by CPU tools and direct callers.
function mtnFreeAgain() { return worldBuildDrain(mtnFreeAgainChunks()); }
function* mtnFreeAgainChunks() {
  let chunkWork = 0;
  const N = HN, N2 = N * N, H = W.H, walk = W.walk, free = new Uint8Array(N2), D = new Float32Array(N2);
  for (let k = 0; k < N2; k++) { if (++chunkWork % WORLD_CHUNK_WORK === 0) yield 'mtnFreeAgain';  free[k] = walk[k] === 0 || H[k] < WATER_Y + 0.6 ? 1 : 0; D[k] = free[k] ? 0 : 1e4; }
  const d1 = HS, d2 = HS * Math.SQRT2;
  for (let j = 0; j < N; j++) { if (++chunkWork % WORLD_CHUNK_WORK === 0) yield 'mtnFreeAgain'; for (let i = 0; i < N; i++) { if (++chunkWork % WORLD_CHUNK_WORK === 0) yield 'mtnFreeAgain';
    const k = j * N + i; let v = D[k];
    if (i > 0) v = Math.min(v, D[k - 1] + d1);
    if (j > 0) { v = Math.min(v, D[k - N] + d1); if (i > 0) v = Math.min(v, D[k - N - 1] + d2); if (i < N - 1) v = Math.min(v, D[k - N + 1] + d2); }
    D[k] = v;
  } }
  for (let j = N - 1; j >= 0; j--) { if (++chunkWork % WORLD_CHUNK_WORK === 0) yield 'mtnFreeAgain'; for (let i = N - 1; i >= 0; i--) { if (++chunkWork % WORLD_CHUNK_WORK === 0) yield 'mtnFreeAgain';
    const k = j * N + i; let v = D[k];
    if (i < N - 1) v = Math.min(v, D[k + 1] + d1);
    if (j < N - 1) { v = Math.min(v, D[k + N] + d1); if (i < N - 1) v = Math.min(v, D[k + N + 1] + d2); if (i > 0) v = Math.min(v, D[k + N - 1] + d2); }
    D[k] = v;
  } }
  MTN.free = free; MTN.dfree = D;
}
// the terrain's vertices and normals, its bounds, the height texture and the masks' texture, where the land changed
// eslint-disable-next-line no-unused-vars -- Retain the synchronous API used by CPU tools and direct callers.
function htsRefresh(changed) { return worldBuildDrain(htsRefreshChunks(changed)); }
function* htsRefreshChunks(changed) {
  let chunkWork = 0;
  const CELLS = 64, n = CELLS + 1, H = W.H;
  for (let cj = 0; cj < 8; cj++) { if (++chunkWork % WORLD_CHUNK_WORK === 0) yield 'htsRefresh'; for (let ci = 0; ci < 8; ci++) {
    const m = terrainChunks[cj * 8 + ci];
    if (!m) continue;
    let any = false;
    for (let gj = cj * CELLS; gj <= cj * CELLS + CELLS && !any; gj++) { if (++chunkWork % WORLD_CHUNK_WORK === 0) yield 'htsRefresh'; for (let gi = ci * CELLS; gi <= ci * CELLS + CELLS; gi++) { if (++chunkWork % WORLD_CHUNK_WORK === 0) yield 'htsRefresh'; if (changed[gj * HN + gi]) { any = true; break; } } }
    if (!any) continue;
    const pos = m.geometry.attributes.position, nrm = m.geometry.attributes.normal;
    let minY = 1e9, maxY = -1e9;
    for (let gj = cj * CELLS; gj <= cj * CELLS + CELLS; gj++) { if (++chunkWork % WORLD_CHUNK_WORK === 0) yield 'htsRefresh'; for (let gi = ci * CELLS; gi <= ci * CELLS + CELLS; gi++) { if (++chunkWork % WORLD_CHUNK_WORK === 0) yield 'htsRefresh';
      const k = ((gj - cj * CELLS) * n + (gi - ci * CELLS)) * 3, y = H[gj * HN + gi];
      pos.array[k + 1] = y;
      const hl = H[gj * HN + Math.max(0, gi - 1)], hr = H[gj * HN + Math.min(HN - 1, gi + 1)];
      const hd = H[Math.max(0, gj - 1) * HN + gi], hu = H[Math.min(HN - 1, gj + 1) * HN + gi];
      const nx = (hl - hr) / (2 * HS), nz = (hd - hu) / (2 * HS), l = Math.hypot(nx, 1, nz);
      nrm.array[k] = nx / l; nrm.array[k + 1] = 1 / l; nrm.array[k + 2] = nz / l;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    } }
    pos.needsUpdate = true; nrm.needsUpdate = true;
    const bs = m.geometry.boundingSphere;
    if (bs) { bs.center.y = (minY + maxY) / 2; bs.radius = Math.hypot(CELLS, CELLS, (maxY - minY) / 2); }
  } }
  if (U.uHeightTex.value) U.uHeightTex.value.needsUpdate = true;
  const T = U.uWorldA.value;
  if (T && T.image && T.image.data) {
    const A = T.image.data;
    for (let k = 0; k < HN * HN; k++) { if (++chunkWork % WORLD_CHUNK_WORK === 0) yield 'htsRefresh';  A[k * 4 + 1] = W.grass[k] * 255; A[k * 4 + 2] = W.flower[k] * 255; A[k * 4 + 3] = W.rock[k] * 255; }
    T.needsUpdate = true;
  }
}
// Hardy trees on the gentler lower slopes of the mountains: pines, and birches lower down (more of them in Ériu, the
// fewest in Thule's cold), sparse, thinning with height and stunted as they climb, none above the snow line (52 m in
// the south, about 30 m in Thule) or on steep, rocky, wet or kept ground, never within a few metres of another tree,
// a rock, a plant or a herb. They are added after every tree there was (the saved land names trees by number), each
// with its collider, its place in the near-tree grid and the felling and burning state the nature module gives every
// tree (05h_nature.js buildNature), drawn by chunk meshes of their own as buildTrees draws the forest (04_props.js),
// so the levels of detail, the canopy map, the seasons and regrowth take them as any other tree.
// eslint-disable-next-line no-unused-vars -- Retain the synchronous API used by CPU tools and direct callers.
function htsTrees() { return worldBuildDrain(htsTreesChunks()); }
function* htsTreesChunks() {
  let chunkWork = 0;
  const rnd = mulberry(7717), list = [], start = W.trees.length;
  HTS.trees0 = start;
  const G = 6, grid = new Map(), gk = (x, z) => Math.floor(x / G) * 4096 + Math.floor(z / G);
  const add = (x, z, r) => { const k = gk(x, z); let L = grid.get(k); if (!L) grid.set(k, L = []); L.push([x, z, r]); };
  const clear = (x, z, r) => {
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
      const L = grid.get((Math.floor(x / G) + a) * 4096 + Math.floor(z / G) + b);
      if (L) for (const o of L) if (dist2(x, z, o[0], o[1]) < (r + o[2]) ** 2) return false;
    }
    return true;
  };
  for (const t of W.trees) { if (++chunkWork % WORLD_CHUNK_WORK === 0) yield 'htsTrees'; add(t.x, t.z, 1.6 * t.s + 1.2); }
  for (const r of W.rocks) { if (++chunkWork % WORLD_CHUNK_WORK === 0) yield 'htsTrees'; add(r.x, r.z, r.s + 1.2); }
  for (const p of FORAGE.list || []) { if (++chunkWork % WORLD_CHUNK_WORK === 0) yield 'htsTrees'; add(p.x, p.z, 1.8); }
  for (const h of FARM.herbs || []) { if (++chunkWork % WORLD_CHUNK_WORK === 0) yield 'htsTrees'; add(h.x, h.z, 1.4); }
  const why = HTS.treeWhy = {};
  const no = (r) => { why[r] = (why[r] || 0) + 1; };
  for (let gz = -HALF + 6; gz < HALF - 6; gz += 4.5) { if (++chunkWork % WORLD_CHUNK_WORK === 0) yield 'htsTrees'; for (let gx = -HALF + 6; gx < HALF - 6; gx += 4.5) { if (++chunkWork % WORLD_CHUNK_WORK === 0) yield 'htsTrees';
    const x = gx + (rnd() - 0.5) * 4, z = gz + (rnd() - 0.5) * 4, u = rnd(), u2 = rnd(), u3 = rnd(), u4 = rnd();
    const k = mtnK(x, z), e = MTN.mount ? MTN.mount[k] : 0;
    if (e < 0.03 || e > 0.8) continue;
    if (W.walk[k] !== 0) { no('walk'); continue; }
    const h = heightAt(x, z), rw = realmWeightsAt(x, z), th = rw[2];
    const top = lerp(46, 30, sstep(0.3, 0.7, th)); // under the snow line, with room
    if (h < WATER_Y + 1.5 || h > top) { no('height'); continue; }
    const nx = heightAt(x + 1.5, z) - heightAt(x - 1.5, z), nz = heightAt(x, z + 1.5) - heightAt(x, z - 1.5), sl = Math.hypot(nx, nz) / 3;
    if (sl > 0.78) { no('steep'); continue; }
    // sparse: most on the foot of the slopes, fewer as they climb, in clumps where the ground shelters them
    const clump = vnoise(x * 0.045 + 2.7, z * 0.045 - 6.1);
    let p = 0.62 * sstep(0.03, 0.1, e) * (1 - sstep(top * 0.5, top, h)) * (1 - sstep(0.45, 0.78, sl)) * sstep(0.22, 0.5, clump);
    p *= th > 0.5 ? 0.8 : rw[1] > 0.5 ? 1.15 : 1;
    if (u > p) { no('chance'); continue; }
    if (W.rock[k] > 0.85 || W.road[k] > 0.01 || (W.field && W.field[k] > 0.05)) { no('ground'); continue; }
    if (waterAt(x, z) || nearRiver(x, z, 5) || LAKES.some((L) => dist2(x, z, L.x, L.z) < (L.r * 1.1 + 10) ** 2)) { no('water'); continue; }
    if (SITES.some((S) => dist2(x, z, S.x, S.z) < (S.r + 10) ** 2) || (W.camps || []).some((c) => dist2(x, z, c.x, c.z) < (c.r + 8) ** 2) || Math.hypot(x, z) < 34) { no('site'); continue; }
    if (W.roads.some((R) => segDist2(x, z, R.ax, R.az, R.bx, R.bz) < (R.w + 6) ** 2)) { no('road'); continue; }
    if (Math.hypot(x, z) > 500) continue;
    // stunted as they climb
    const hk = sstep(4, top, h), s = (0.95 - 0.35 * hk) * (0.8 + 0.4 * u2);
    if (!clear(x, z, 1.6 * s + 1.4)) { no('near'); continue; }
    let tr = null;
    collidersNear(x, z, 4, _cn);
    for (const c of _cn) { if (++chunkWork % WORLD_CHUNK_WORK === 0) yield 'htsTrees'; if (c.active && collCovers(c, x, z, 1.2)) { tr = c; break; } }
    if (tr) { no('coll'); continue; }
    const kind = th > 0.5 ? (u3 < 0.82 ? 'pine' : 'birch') : (h > 18 || u3 < (rw[1] > 0.5 ? 0.45 : 0.62)) ? 'pine' : 'birch';
    const t = { kind, x, z, y: heightAt(x, z), s, rot: u4 * TAU, tint: rnd(), hardy: true };
    list.push(t); add(x, z, 1.6 * s + 1.2);
  } }
  // a tree only where its chunk already draws pines or birches (else it would cost a draw of its own)
  { const size = WSIZE / 8, ok = (t) => { const ci = clamp(Math.floor((t.x + HALF) / size), 0, 7), cj = clamp(Math.floor((t.z + HALF) / size), 0, 7), cx = -HALF + (ci + 0.5) * size, cz = -HALF + (cj + 0.5) * size;
      return treeChunks.some((m) => (m.userData.kind === 'pine' || m.userData.kind === 'birch') && Math.abs(m.userData.center.x - cx) < 1 && Math.abs(m.userData.center.y - cz) < 1); };
    for (let n = list.length - 1; n >= 0; n--) { if (++chunkWork % WORLD_CHUNK_WORK === 0) yield 'htsTrees'; if (!ok(list[n])) { list.splice(n, 1); why.chunk = (why.chunk || 0) + 1; } } }
  if (!list.length) return;
  // into the world as every other tree is
  for (const t of list) { if (++chunkWork % WORLD_CHUNK_WORK === 0) yield 'htsTrees';
    t.i = W.trees.length; W.trees.push(t);
    t.coll = addCircle(t.x, t.z, 0.45 * t.s + 0.15, 'tree', 8); t.collR = t.coll.r;
    t.s0 = t.s; t.state = 'stand'; t.hp = TREE_DIM[t.kind].hp * t.s0; t.fire = 0; t.char = 0; t.leaf = 1; t.shake = 0; t.notch = 0; t.grow = 1;
    if (NEAR_TREES.grid) { const key = Math.floor(t.x / NEAR_TREES.cell) + ',' + Math.floor(t.z / NEAR_TREES.cell); let L = NEAR_TREES.grid.get(key); if (!L) NEAR_TREES.grid.set(key, L = []); L.push(t.i); }
  }
  // drawn with the forest: each joins its kind's chunk mesh (128 m a side, as buildTrees makes them) at the end of its
  // instances, so no draw is added; a chunk with none of its kind yet gets a mesh of its own
  const CH = 8, size = WSIZE / CH, buckets = new Map(), bases = {};
  const has = (kind, ci, cj) => treeChunks.some((m) => m.userData.kind === kind && Math.abs(m.userData.center.x - (-HALF + (ci + 0.5) * size)) < 1 && Math.abs(m.userData.center.y - (-HALF + (cj + 0.5) * size)) < 1);
  for (const t of list) { if (++chunkWork % WORLD_CHUNK_WORK === 0) yield 'htsTrees';
    const ci = clamp(Math.floor((t.x + HALF) / size), 0, CH - 1), cj = clamp(Math.floor((t.z + HALF) / size), 0, CH - 1);
    // (a chunk with no mesh of its kind takes the other hardy kind if it has one, so no draw is added; a chunk with
    // neither grows none: those trees were dropped before they joined the world, below)
    if (!has(t.kind, ci, cj)) { const other = t.kind === 'pine' ? 'birch' : 'pine'; if (has(other, ci, cj)) { t.kind = other; t.hp = TREE_DIM[other].hp * t.s0; } }
    const key = t.kind + ':' + ci + ':' + cj;
    if (!buckets.has(key)) buckets.set(key, { kind: t.kind, ci, cj, list: [] });
    buckets.get(key).list.push(t);
  }
  let added = 0;
  for (const B of buckets.values()) { if (++chunkWork % WORLD_CHUNK_WORK === 0) yield 'htsTrees';
    const cx = -HALF + (B.ci + 0.5) * size, cz = -HALF + (B.cj + 0.5) * size;
    const m0 = treeChunks.find((m) => m.userData.kind === B.kind && Math.abs(m.userData.center.x - cx) < 1 && Math.abs(m.userData.center.y - cz) < 1);
    if (m0) {
      const g = m0.geometry, n0 = g.instanceCount, n = n0 + B.list.length, oP = g.attributes.iPos.array, oR = g.attributes.iRot.array;
      const ip = new Float32Array(n * 4), ir = new Float32Array(n * 2);
      ip.set(oP.subarray(0, n0 * 4)); ir.set(oR.subarray(0, n0 * 2));
      let maxY = -1e9;
      B.list.forEach((t, i) => { ip.set([t.x, t.y - 0.15, t.z, t.s], (n0 + i) * 4); ir.set([t.rot, t.tint], (n0 + i) * 2); t.ci = n0 + i; t.chunk = m0; maxY = Math.max(maxY, t.y); });
      g.setAttribute('iPos', new THREE.InstancedBufferAttribute(ip, 4));
      g.setAttribute('iRot', new THREE.InstancedBufferAttribute(ir, 2));
      g.instanceCount = n;
      const bs = g.boundingSphere;
      if (bs && maxY + 10 > bs.center.y + bs.radius * 0.5) bs.radius = Math.max(bs.radius, Math.hypot(size * 0.75, maxY + 10 - bs.center.y));
      continue;
    }
    const base = bases[B.kind] || (bases[B.kind] = treeGeometry(B.kind)), g = new THREE.InstancedBufferGeometry();
    for (const name of ['position', 'normal', 'aPart', 'aAO']) g.setAttribute(name, base.attributes[name]);
    g.setIndex(base.index);
    const n = B.list.length, ip = new Float32Array(n * 4), ir = new Float32Array(n * 2);
    let minY = 1e9, maxY = -1e9;
    B.list.forEach((t, i) => { ip.set([t.x, t.y - 0.15, t.z, t.s], i * 4); ir.set([t.rot, t.tint], i * 2); minY = Math.min(minY, t.y); maxY = Math.max(maxY, t.y); t.ci = i; });
    g.setAttribute('iPos', new THREE.InstancedBufferAttribute(ip, 4));
    g.setAttribute('iRot', new THREE.InstancedBufferAttribute(ir, 2));
    g.instanceCount = n;
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(cx, (minY + maxY) / 2 + 4, cz), size * 0.75 + 10 + (maxY - minY) / 2);
    const K = TREE_KINDS[B.kind];
    const m = new THREE.Mesh(g, shareMat(treeMat, { uKindTint: { value: new THREE.Vector3(...K.tint) }, uBarkTint: { value: new THREE.Vector3(...K.bark) }, uBirch: { value: K.birch }, uDecid: { value: B.kind === 'pine' ? 0 : 1 } }));
    m.userData.center = new THREE.Vector2(cx, cz);
    m.userData.kind = B.kind;
    m.renderOrder = 2;
    scene.add(m);
    treeChunks.push(m);
    m.userData.proxy = shadowCaster(m, B.kind === 'pine' ? TREE_DEPTH : TREE_DEPTH_DECID);
    for (const t of B.list) { if (++chunkWork % WORLD_CHUNK_WORK === 0) yield 'htsTrees'; t.chunk = m; }
    added++;
  }
  HTS.treeMeshes = added;
  HTS.hardy = list.length;
}

// Outcrops: tors and boulders on the walkable lower slopes, mostly on the spurs (where the ground stands over its
// surroundings), sparse and in belts, clear of everything kept, every tree, rock, plant, herb and collider, the roads
// and each other. They are crags (03c_land.js: the same mesh, look and levels of detail, MTN.crags with c.outcrop) with
// a collider of their own (tag 'rock', as the rocks on the slopes have), stamped into the camera's map (MTN.top) and
// the cover map; the walk mask is left as it was (bodies go round the collider, as round any rock).
// eslint-disable-next-line no-unused-vars -- Retain the synchronous API used by CPU tools and direct callers.
function htsOutcrops() { return worldBuildDrain(htsOutcropsChunks()); }
function* htsOutcropsChunks() {
  let chunkWork = 0;
  if (!HTS.keep || !MTN.crags) return;
  const rnd = mulberry(6151), out = [], N = HN;
  const G = 8, grid = new Map(), gk = (x, z) => Math.floor(x / G) * 4096 + Math.floor(z / G);
  const add = (x, z, r) => { const k = gk(x, z); let L = grid.get(k); if (!L) grid.set(k, L = []); L.push([x, z, r]); };
  const clear = (x, z, r) => {
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
      const L = grid.get((Math.floor(x / G) + a) * 4096 + Math.floor(z / G) + b);
      if (L) for (const o of L) if (dist2(x, z, o[0], o[1]) < (r + o[2]) ** 2) return false;
    }
    return true;
  };
  for (const t of W.trees) { if (++chunkWork % WORLD_CHUNK_WORK === 0) yield 'htsOutcrops'; add(t.x, t.z, 1.4 * t.s + 1.5); }
  for (const r of W.rocks) { if (++chunkWork % WORLD_CHUNK_WORK === 0) yield 'htsOutcrops'; add(r.x, r.z, r.s + 1); }
  for (const p of FORAGE.list || []) { if (++chunkWork % WORLD_CHUNK_WORK === 0) yield 'htsOutcrops'; add(p.x, p.z, 2); }
  for (const h of FARM.herbs || []) { if (++chunkWork % WORLD_CHUNK_WORK === 0) yield 'htsOutcrops'; add(h.x, h.z, 1.8); }
  for (const c of MTN.crags) { if (++chunkWork % WORLD_CHUNK_WORK === 0) yield 'htsOutcrops'; add(c.x, c.z, c.r); }
  for (let gz = -HALF + 8; gz < HALF - 8; gz += 6) { if (++chunkWork % WORLD_CHUNK_WORK === 0) yield 'htsOutcrops'; for (let gx = -HALF + 8; gx < HALF - 8; gx += 6) { if (++chunkWork % WORLD_CHUNK_WORK === 0) yield 'htsOutcrops';
    const x = gx + (rnd() - 0.5) * 5, z = gz + (rnd() - 0.5) * 5, u = rnd(), u2 = rnd(), u3 = rnd(), u4 = rnd();
    const k = mtnK(x, z), e = MTN.mount[k];
    if (e < 0.08 || e > 0.8 || W.walk[k] !== 0 || Math.hypot(x, z) > 500) continue;
    const h = heightAt(x, z), hx = (heightAt(x + 2, z) - heightAt(x - 2, z)) / 4, hz = (heightAt(x, z + 2) - heightAt(x, z - 2)) / 4, sl = Math.hypot(hx, hz);
    if (sl < 0.2 || sl > 0.92 || h < WATER_Y + 2) continue;
    // on a spur: the ground here stands over the mean round it
    let ring = 0;
    for (let a = 0; a < 8; a++) ring += heightAt(x + Math.sin(a * 0.785) * 7, z + Math.cos(a * 0.785) * 7);
    const convex = h - ring / 8, belt = vnoise(x * 0.03 + 8.3, z * 0.03 - 2.6);
    const p = 0.8 * (0.3 + 0.7 * sstep(0, 1.1, convex)) * sstep(0.3, 0.6, belt) * sstep(0.08, 0.2, e);
    if (u > p) continue;
    const kind = u2 < 0.55 ? 3 : 4;
    const wd = kind === 3 ? 3 + u3 * 2.6 : 1.7 + u3 * 1.5, dp = kind === 3 ? 2.8 + u4 * 2.2 : 1.5 + u4 * 1.2, above = kind === 3 ? 1.5 + u4 * 1.8 : 0.8 + u3 * 0.9;
    const r = Math.max(wd, dp) * 0.7 + 0.3;
    if (sampleGrid(HTS.keep, x, z) > 0.01 || waterAt(x, z) || nearRiver(x, z, r + 6)) continue;
    if (W.roads.some((R) => segDist2(x, z, R.ax, R.az, R.bx, R.bz) < (R.w + 8 + r) ** 2)) continue;
    if (SITES.some((S) => dist2(x, z, S.x, S.z) < (S.r + S.f + 10 + r) ** 2) || (W.camps || []).some((c) => dist2(x, z, c.x, c.z) < (c.r + 10 + r) ** 2)) continue;
    if (!clear(x, z, r + 1.5)) continue;
    collidersNear(x, z, r + 4, _cn);
    if (_cn.some((c) => c.active && collCovers(c, x, z, r + 1))) continue;
    let lo = Infinity;
    for (let a = 0; a < 16; a++) for (const f of [0.4, 0.8, 1]) lo = Math.min(lo, heightAt(x + Math.sin(a * 0.3927) * r * f, z + Math.cos(a * 0.3927) * r * f));
    const y0 = lo - 0.6, c = { x, z, y0, h: h + above - y0, w: wd, d: dp, yaw: Math.atan2(-hx, -hz), sl: Math.min(2.4, sl), kind, seed: Math.min(0.999, rnd()), r, outcrop: true };
    out.push(c); add(x, z, r);
  } }
  for (const c of out) { if (++chunkWork % WORLD_CHUNK_WORK === 0) yield 'htsOutcrops';
    c.coll = addCircle(c.x, c.z, Math.max(c.w, c.d) * 0.48, 'rock', c.h); c.coll.outcrop = true;
    MTN.crags.push(c);
    // the camera keeps out of them (as of every crag: mtnPlaceCrags)
    const rr = c.r + 1.5, i0 = Math.max(0, Math.floor((c.x - rr + HALF) / HS)), i1 = Math.min(N - 1, Math.ceil((c.x + rr + HALF) / HS));
    const j0 = Math.max(0, Math.floor((c.z - rr + HALF) / HS)), j1 = Math.min(N - 1, Math.ceil((c.z + rr + HALF) / HS));
    for (let j = j0; j <= j1; j++) { if (++chunkWork % WORLD_CHUNK_WORK === 0) yield 'htsOutcrops'; for (let i = i0; i <= i1; i++) { if (++chunkWork % WORLD_CHUNK_WORK === 0) yield 'htsOutcrops';
      if (dist2(-HALF + i * HS, -HALF + j * HS, c.x, c.z) > (rr + 1.42) ** 2) continue;
      const q = j * N + i;
      MTN.top[q] = Math.max(MTN.top[q], c.y0 + c.h * 1.12 + 0.3 * c.sl * c.d + 0.5);
    } }
  }
  HTS.outcrops = out.length;
}
