/* ================================================================== */
/* [land] the mountains (2 of 2): the shape of the faces, the crags,   */
/* the land map, and keeping the camera out of the rock                */
/* ================================================================== */
// The mountains are the ring round the frontier, the ridges between the realms and the outer wall of the map
// (rawHeight, 01_world.js). Up close they need shape at the scale a player sees, so:
//  1. the ground no one can reach (unwalkable mountain texels, and walkable pockets no road joins) is reshaped
//     (mtnShape): jagged teeth along the crests, gullies down the fall line, ledges along the bedding planes. Every
//     texel next to ground anyone can reach keeps its height, so where people walk, the passes, roads, rivers, lakes and
//     sites, the walk mask and every collider stay exactly as they were; any hollow the reshaping leaves is filled, so no
//     pond and no dry pond bed comes of it.
//  2. crags (mtnPlaceCrags): cliff bands, buttresses leaning into the slope, pinnacles and tors on the crests, placed on
//     that same unreachable ground, clear of anything walkable by 2.5 m, of the water and of the trees. Each is unique:
//     one ring-and-layer mesh shaped per instance in the vertex shader (strata, ledges, lobes, joints, lean, dip) and lit
//     like the terrain's rock (02e_land.js), with weather, the seasons' snow and the high snow by altitude and realm.
//     A near and a far model, dithered across each other and out at the far end, by quality (MTN_D).
//  3. the land map (mtnBakeMap): mountain, scree at the foot of the faces, gullies and heather for the terrain shader.
//  4. the camera is pulled in before it would pass into a crag (mtnCamRoom, asked by cameraRoom in 09_player.js), and
//     no blade of grass grows up through one (mtnCoverAll, from buildCoverMask).
const MTN = {
  mount: null, free: null, dfree: null, shaped: null, gully: null, top: null, map: null, tex: null,
  crags: [], nShaped: 0, reverted: 0, filled: 0, meshN: null, meshF: null, shadowGeo: null, lx: 1e9, lz: 1e9, lastQ: '',
  stats: { near: 0, far: 0, shadow: 0 }, eye: { value: new THREE.Vector3(0, 0, 0) },
};
// draw reach by quality (m from the camera to a crag's centre): the near model, dithered over to the far one across
// near[0..1], the far one dithered out across far[0..1]; crags within shadow cast shadows (high and medium)
const MTN_D = {
  high: { near: [100, 122], far: [290, 330], shadow: 70 },
  medium: { near: [68, 84], far: [200, 236], shadow: 52 },
  low: { near: [40, 52], far: [130, 158], shadow: 0 },
};
const mtnK = (x, z) => clamp(Math.round((z + HALF) / HS), 0, HN - 1) * HN + clamp(Math.round((x + HALF) / HS), 0, HN - 1);
// how much (x, z) is mountain: the factor rawHeight raises the ground by (01_world.js), 0..1
function mtnMountAt(x, z) {
  const r = Math.hypot(x, z), b = Math.atan2(x, -z);
  const ring = sstep(32, 3, Math.abs(r - R_RING));
  let pass = 0;
  for (const R of REALMS) { const ad = Math.abs(angDiff(b, R.bearing)) * r; pass = Math.max(pass, sstep(34, 13, ad)); }
  let mount = ring * (1 - pass);
  if (r > R_RING - 40) {
    for (const db of DIVIDERS) {
      const ad = angDiff(b, db);
      if (Math.abs(ad) < 1.2) { const lat = Math.abs(Math.sin(ad)) * r; mount = Math.max(mount, sstep(40, 6, lat) * sstep(R_RING - 34, R_RING + 6, r)); }
    }
  }
  const outer = Math.max(sstep(452, 506, r), sstep(470, 511, Math.max(Math.abs(x), Math.abs(z))));
  return Math.max(mount, outer);
}
// a priority flood from the map's edge and the lakes: the height each texel would spill over at
function mtnFlood(H) {
  const N = HN, N2 = N * N, F = new Float32Array(N2), done = new Uint8Array(N2), heap = new Int32Array(N2);
  let hn = 0;
  const less = (a, b) => F[heap[a]] < F[heap[b]];
  const push = (k) => { let i = hn++; heap[i] = k; while (i > 0) { const p = (i - 1) >> 1; if (!less(i, p)) break; const t = heap[i]; heap[i] = heap[p]; heap[p] = t; i = p; } };
  const pop = () => { const top = heap[0]; heap[0] = heap[--hn]; let i = 0; for (;;) { const l = i * 2 + 1, r = l + 1; let m = i; if (l < hn && less(l, m)) m = l; if (r < hn && less(r, m)) m = r; if (m === i) break; const t = heap[i]; heap[i] = heap[m]; heap[m] = t; i = m; } return top; };
  for (let k = 0; k < N2; k++) {
    const i = k % N, j = (k / N) | 0;
    F[k] = H[k];
    if (i === 0 || j === 0 || i === N - 1 || j === N - 1 || H[k] < WATER_Y) { done[k] = 1; push(k); }
  }
  while (hn) {
    const k = pop(), i = k % N, j = (k / N) | 0;
    for (let q = 0; q < 4; q++) {
      const ii = i + (q === 0 ? 1 : q === 1 ? -1 : 0), jj = j + (q === 2 ? 1 : q === 3 ? -1 : 0);
      if (ii < 0 || jj < 0 || ii >= N || jj >= N) continue;
      const n = jj * N + ii;
      if (done[n]) continue;
      done[n] = 1; F[n] = Math.max(H[n], F[k]); push(n);
    }
  }
  return F;
}
/* ------------------------------------------------------------------ */
/* 1. the faces: reshaping the ground no one can reach                 */
/* ------------------------------------------------------------------ */
// called by buildWorld (01_world.js) once the walk mask is made and before anything is placed on the land
function mtnShape(H, walk) {
  const N = HN, N2 = N * N;
  const mount = new Float32Array(N2);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) mount[j * N + i] = mtnMountAt(-HALF + i * HS, -HALF + j * HS);
  MTN.mount = mount;
  // ground any body could stand on: anything walkable (the roads' ground, and the pockets up on the heights no road
  // joins: later placements still look there), and water a swimmer might cross
  const free = new Uint8Array(N2);
  for (let k = 0; k < N2; k++) free[k] = walk[k] === 0 || H[k] < WATER_Y + 0.6 ? 1 : 0;
  MTN.free = free;
  // how far each texel lies from it (m, chamfer)
  const D = new Float32Array(N2);
  for (let k = 0; k < N2; k++) D[k] = free[k] ? 0 : 1e4;
  const d1 = HS, d2 = HS * Math.SQRT2;
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const k = j * N + i; let v = D[k];
    if (i > 0) v = Math.min(v, D[k - 1] + d1);
    if (j > 0) { v = Math.min(v, D[k - N] + d1); if (i > 0) v = Math.min(v, D[k - N - 1] + d2); if (i < N - 1) v = Math.min(v, D[k - N + 1] + d2); }
    D[k] = v;
  }
  for (let j = N - 1; j >= 0; j--) for (let i = N - 1; i >= 0; i--) {
    const k = j * N + i; let v = D[k];
    if (i < N - 1) v = Math.min(v, D[k + 1] + d1);
    if (j < N - 1) { v = Math.min(v, D[k + N] + d1); if (i < N - 1) v = Math.min(v, D[k + N + 1] + d2); if (i > 0) v = Math.min(v, D[k + N - 1] + d2); }
    D[k] = v;
  }
  MTN.dfree = D;
  // which texels may change: mountain with nothing walkable within two texels (so every height, slope and normal read
  // anywhere a body can stand is as it was), high and dry, off the rivers, and clear of the hollows (the mountain ponds
  // and their brims stay as they were)
  const H0 = H.slice(), F0 = mtnFlood(H0), hollow = new Uint8Array(N2);
  for (let k = 0; k < N2; k++) if (F0[k] - H0[k] > 0.02) { const i = k % N, j = (k / N) | 0; for (let dj = -3; dj <= 3; dj++) for (let di = -3; di <= 3; di++) { const ii = i + di, jj = j + dj; if (ii >= 0 && jj >= 0 && ii < N && jj < N) hollow[jj * N + ii] = 1; } }
  const ok = new Uint8Array(N2), w = new Float32Array(N2), slope = new Float32Array(N2);
  for (let j = 1; j < N - 1; j++) for (let i = 1; i < N - 1; i++) {
    const k = j * N + i;
    slope[k] = Math.hypot(H[k + 1] - H[k - 1], H[k + N] - H[k - N]) / (2 * HS);
    if (mount[k] < 0.12 || D[k] < 5.7 || H[k] < WATER_Y + 3 || hollow[k]) continue;
    const x = -HALF + i * HS, z = -HALF + j * HS;
    if (LAKES.some((L) => dist2(x, z, L.x, L.z) < (L.r + 24) ** 2) || nearRiver(x, z, 12)) continue;
    ok[k] = 1;
    w[k] = sstep(5.7, 12, D[k]) * sstep(0.12, 0.45, mount[k]);
  }
  const gully = new Float32Array(N2);
  // gradients of the broad shape (over 3 texels), for the fall line
  for (let j = 3; j < N - 3; j++) for (let i = 3; i < N - 3; i++) {
    const k = j * N + i;
    if (!ok[k] || w[k] <= 0) continue;
    const x = -HALF + i * HS, z = -HALF + j * HS, h = H0[k], wk = w[k], sl = slope[k];
    // crests: teeth and notches along the high ground, so the skyline is broken and not rounded
    const hi = sstep(12, 32, h) * mount[k];
    const r1 = 1 - Math.abs(2 * vnoise(x * 0.043 + 1.7, z * 0.043 - 3.1) - 1), r2 = 1 - Math.abs(2 * vnoise(x * 0.11 - 6.3, z * 0.11 + 2.9) - 1);
    let add = wk * hi * (6.5 * r1 * r1 * r1 + 2.2 * r2 * r2 - 1.6);
    // gullies and chutes cut down the fall line of the steep faces
    const gx = (H0[k + 3] - H0[k - 3]) / (6 * HS), gz = (H0[k + 3 * N] - H0[k - 3 * N]) / (6 * HS), gl = Math.hypot(gx, gz);
    if (gl > 0.2) {
      const ux = -gz / gl, uz = gx / gl, u = x * ux + z * uz, v = (x * gx + z * gz) / gl;
      const g = 1 - Math.abs(2 * vnoise(u * 0.085 + 13.1, v * 0.016 - 2.2) - 1), g4 = g * g * g * g;
      const steep = sstep(0.6, 1.3, sl) * (1 - 0.6 * hi);
      add -= wk * steep * 3.0 * g4;
      gully[k] = clamp(wk * steep * g4 * 1.4, 0, 1);
    }
    let h1 = h + add;
    // ledges along the bedding planes: a remap of height that only ever rises with it (no hollows), dipping slowly
    const P = 6.4, dip = (vnoise(x * 0.011 + 4.4, z * 0.011 - 1.9) - 0.5) * 7, t = (h1 + dip) / P;
    const T = P * (Math.floor(t) + sstep(0.28, 0.72, t - Math.floor(t))) - dip;
    h1 += wk * 0.55 * sstep(0.55, 1.15, sl) * (T - h1);
    H[k] = h1;
  }
  // fill what the reshaping hollowed out, on the reshaped ground only; where it deepened a hollow that reaches
  // ground anyone can stand on, the reshaping round it is taken back
  let reverted = 0, filled = 0;
  for (let pass2 = 0; pass2 < 3; pass2++) {
    const F = mtnFlood(H);
    let bad = 0;
    for (let k = 0; k < N2; k++) {
      if (F[k] - H[k] < 0.004 && F0[k] - H0[k] < 0.004) continue;
      if (ok[k]) { if (F[k] - H[k] > 0.004 && H[k] !== H0[k]) { H[k] = F[k]; filled++; } continue; }
      if (Math.abs(F[k] - F0[k]) > 0.004) {
        bad++;
        const i = k % N, j = (k / N) | 0;
        for (let dj = -14; dj <= 14; dj++) for (let di = -14; di <= 14; di++) {
          const ii = i + di, jj = j + dj;
          if (ii < 0 || jj < 0 || ii >= N || jj >= N) continue;
          const q = jj * N + ii;
          if (H[q] !== H0[q]) { H[q] = H0[q]; gully[q] = 0; reverted++; }
        }
      }
    }
    if (!bad) break;
  }
  // a last pass: a hollow left on the reshaped ground after the take-backs is filled
  { const F = mtnFlood(H); for (let k = 0; k < N2; k++) if (ok[k] && F[k] - H[k] > 0.004) { H[k] = F[k]; filled++; } }
  let n = 0;
  const shaped = new Uint8Array(N2);
  for (let k = 0; k < N2; k++) if (H[k] !== H0[k]) { shaped[k] = 1; n++; }
  MTN.shaped = shaped; MTN.gully = gully; MTN.nShaped = n; MTN.reverted = reverted; MTN.filled = filled;
}

/* ------------------------------------------------------------------ */
/* 2. the crags                                                         */
/* ------------------------------------------------------------------ */
// called at the end of buildWorld, once the water, the trees, the rocks and the camps are in place
function mtnPlaceCrags() {
  const D = MTN.dfree, M = MTN.mount, rnd = mulberry(9157);
  const crags = [], grid = new Map(), G = 16;
  const gkey = (x, z) => Math.floor(x / G) * 4096 + Math.floor(z / G);
  const nearCrag = (x, z, r) => {
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
      const L = grid.get((Math.floor(x / G) + a) * 4096 + Math.floor(z / G) + b);
      if (L) for (const c of L) if (dist2(x, z, c.x, c.z) < ((r + c.r) * 0.62) ** 2) return true;
    }
    return false;
  };
  const treeGrid = new Map();
  for (const t of W.trees) { const k = gkey(t.x, t.z); let L = treeGrid.get(k); if (!L) treeGrid.set(k, L = []); L.push(t); }
  const nearTree = (x, z, r) => {
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
      const L = treeGrid.get((Math.floor(x / G) + a) * 4096 + Math.floor(z / G) + b);
      if (L) for (const t of L) if (dist2(x, z, t.x, t.z) < (r + 2.5) ** 2) return true;
    }
    return false;
  };
  const step = 6.5;
  for (let gz = -HALF + 4; gz < HALF - 4; gz += step) for (let gx = -HALF + 4; gx < HALF - 4; gx += step) {
    const x = gx + (rnd() - 0.5) * step * 0.9, z = gz + (rnd() - 0.5) * step * 0.9, u1 = rnd(), u2 = rnd(), u3 = rnd(), u4 = rnd();
    const k = mtnK(x, z);
    if (M[k] < 0.18 || D[k] < 7.5) continue;
    const h0 = heightAt(x, z);
    if (h0 < WATER_Y + 4) continue;
    const hx = (heightAt(x + 3, z) - heightAt(x - 3, z)) / 6, hz = (heightAt(x, z + 3) - heightAt(x, z - 3)) / 6, sl = Math.hypot(hx, hz);
    let ring = -Infinity;
    for (let a = 0; a < 8; a++) ring = Math.max(ring, heightAt(x + Math.sin(a * 0.785) * 7, z + Math.cos(a * 0.785) * 7));
    const crest = h0 > ring - 0.6 && h0 > 14;
    const out = vnoise(x * 0.031 + 5.1, z * 0.031 - 2.7);
    let p = sstep(0.45, 1.3, sl) * 0.72 + (crest ? 0.75 : 0);
    p *= (0.3 + 0.95 * sstep(0.32, 0.68, out)) * sstep(0.18, 0.5, M[k]);
    if (u1 > p) continue;
    // 0 a cliff band, 1 a buttress, 2 a pinnacle on a crest, 3 a tor of stacked blocks
    let kind, wd, dp, above;
    if (crest && sl < 1.1) { kind = u2 < 0.62 ? 2 : 3; }
    else if (sl > 1.2) kind = u2 < 0.55 ? 1 : 0;
    else kind = u2 < 0.2 ? 3 : 0;
    const sc = 0.75 + 0.35 * sstep(0.3, 0.9, M[k]);
    if (kind === 0) { wd = 9 + u3 * 9; dp = 4.5 + u4 * 3; above = 2.6 + u3 * 3.2; }
    else if (kind === 1) { wd = 4.5 + u3 * 3.5; dp = 4 + u4 * 3; above = 4 + u4 * 5; }
    else if (kind === 2) { wd = 3.2 + u3 * 3; dp = 3 + u4 * 2.6; above = 5 + u3 * 7; }
    else { wd = 5 + u3 * 4; dp = 5 + u4 * 3.5; above = 2.6 + u4 * 3; }
    wd *= sc; dp *= sc; above *= sc;
    // its reach: the widest the shader can make it (lobes, ledges, facets: 1.4 of the half-width) and its lean
    const r = Math.max(wd, dp) * 0.5 * 1.4 + (kind === 1 ? 0.14 : 0.07) * (above + 8);
    // clear of anything walkable by a metre: no walkable texel's square (1.42 m from its centre) within r + 1
    if (D[k] < r + 1) continue;
    let near = false;
    { const rr = r + 4, i0 = Math.max(0, Math.floor((x - rr + HALF) / HS)), i1 = Math.min(HN - 1, Math.ceil((x + rr + HALF) / HS)), j0 = Math.max(0, Math.floor((z - rr + HALF) / HS)), j1 = Math.min(HN - 1, Math.ceil((z + rr + HALF) / HS));
      for (let j = j0; j <= j1 && !near; j++) for (let i = i0; i <= i1; i++) { const q = j * HN + i; if ((MTN.free[q] || W.walk[q] !== 1) && dist2(-HALF + i * HS, -HALF + j * HS, x, z) < (r + 2.42) ** 2) { near = true; break; } } }
    if (near) continue;
    if (Math.hypot(x, z) < 72 || SITES.some((S) => dist2(x, z, S.x, S.z) < (S.r + S.f + 14 + r) ** 2)) continue;
    if (nearCrag(x, z, r) || nearTree(x, z, r)) continue;
    // never in the water, and buried below the lowest ground under its foot
    let lo = h0, wet = false;
    for (let a = 0; a < 24 && !wet; a++) for (const f of [0.35, 0.7, 1]) {
      const px = x + Math.sin(a * 0.2618) * r * f, pz = z + Math.cos(a * 0.2618) * r * f;
      if (waterAt(px, pz)) { wet = true; break; }
      lo = Math.min(lo, heightAt(px, pz));
    }
    if (wet || nearRiver(x, z, r + 6)) continue;
    const y0 = lo - 1.5, top = (crest ? Math.max(h0, ring) : h0) + above;
    const yaw = sl > 0.05 ? Math.atan2(-hx, -hz) : rnd() * TAU; // local +z faces down the slope
    const c = { x, z, y0, h: top - y0, w: wd, d: dp, yaw, sl: Math.min(2.4, sl), kind, seed: Math.min(0.999, u4 * 0.5 + rnd() * 0.5), r };
    crags.push(c);
    const gk = gkey(x, z); let L = grid.get(gk); if (!L) grid.set(gk, L = []); L.push(c);
  }
  // boulders shed from the crags lie in the scree below them (kind 4)
  const nMain = crags.length;
  for (let n = 0; n < nMain; n++) {
    const c0 = crags[n], want = rnd() < 0.7 ? 1 + (rnd() < 0.4 ? 1 : 0) : 0;
    for (let b = 0, tries = 0; b < want && tries < 8; tries++) {
      const a = c0.yaw + (rnd() - 0.5) * 1.8, dd = c0.r * (0.75 + rnd() * 0.8), x = c0.x + Math.sin(a) * dd, z = c0.z + Math.cos(a) * dd;
      const wd = 1.3 + rnd() * 1.6, dp = 1.1 + rnd() * 1.3, r = Math.max(wd, dp) * 0.7 + 0.25, k = mtnK(x, z);
      if (D[k] < r + 1 || nearTree(x, z, r)) continue;
      let near = false;
      { const rr = r + 4, i0 = Math.max(0, Math.floor((x - rr + HALF) / HS)), i1 = Math.min(HN - 1, Math.ceil((x + rr + HALF) / HS)), j0 = Math.max(0, Math.floor((z - rr + HALF) / HS)), j1 = Math.min(HN - 1, Math.ceil((z + rr + HALF) / HS));
        for (let j = j0; j <= j1 && !near; j++) for (let i = i0; i <= i1; i++) { const q = j * HN + i; if ((MTN.free[q] || W.walk[q] !== 1) && dist2(-HALF + i * HS, -HALF + j * HS, x, z) < (r + 2.42) ** 2) { near = true; break; } } }
      if (near) continue;
      let lo = Infinity, wet = false;
      for (let q = 0; q < 12; q++) for (const f of [0.5, 1]) { const px = x + Math.sin(q * 0.5236) * r * f, pz = z + Math.cos(q * 0.5236) * r * f; if (waterAt(px, pz)) wet = true; lo = Math.min(lo, heightAt(px, pz)); }
      if (wet) continue;
      const h0 = heightAt(x, z), hx = (heightAt(x + 2, z) - heightAt(x - 2, z)) / 4, hz = (heightAt(x, z + 2) - heightAt(x, z - 2)) / 4;
      const y0 = lo - 0.6, c = { x, z, y0, h: h0 + 0.5 + rnd() * 1.1 - y0, w: wd, d: dp, yaw: rnd() * TAU, sl: Math.min(2.4, Math.hypot(hx, hz)) * 0.5, kind: 4, seed: Math.min(0.999, rnd()), r };
      crags.push(c); b++;
    }
  }
  MTN.crags = crags;
  // the highest rock over every texel: the camera keeps out of it
  const top = new Float32Array(HN * HN).fill(-1e9);
  for (const c of crags) {
    const rr = c.r + 1.5, i0 = Math.max(0, Math.floor((c.x - rr + HALF) / HS)), i1 = Math.min(HN - 1, Math.ceil((c.x + rr + HALF) / HS));
    const j0 = Math.max(0, Math.floor((c.z - rr + HALF) / HS)), j1 = Math.min(HN - 1, Math.ceil((c.z + rr + HALF) / HS));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      if (dist2(-HALF + i * HS, -HALF + j * HS, c.x, c.z) > (rr + 1.42) ** 2) continue;
      const q = j * HN + i;
      top[q] = Math.max(top[q], c.y0 + c.h * 1.12 + 0.3 * c.sl * c.d + 0.5); // its top rises with the slope behind it
    }
  }
  MTN.top = top;
  // round each crag the ground is bare rock with scree shed below it, and no grass or flowers grow (on ground no one
  // can reach: what people walk on keeps its masks); a few boulders lie in the scree
  const halo = new Float32Array(HN * HN), scree = new Float32Array(HN * HN);
  for (const c of crags) {
    const rr = c.r * 2.4 + 4, i0 = Math.max(0, Math.floor((c.x - rr + HALF) / HS)), i1 = Math.min(HN - 1, Math.ceil((c.x + rr + HALF) / HS));
    const j0 = Math.max(0, Math.floor((c.z - rr + HALF) / HS)), j1 = Math.min(HN - 1, Math.ceil((c.z + rr + HALF) / HS));
    const dx = Math.sin(c.yaw), dz = Math.cos(c.yaw), hc = c.y0 + 1.5;
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const x = -HALF + i * HS, z = -HALF + j * HS, q = j * HN + i, d = Math.hypot(x - c.x, z - c.z);
      const down = ((x - c.x) * dx + (z - c.z) * dz) / Math.max(d, 1e-3);
      if (D[q] > 5.7) {
        const k = sstep(c.r + 3.5, c.r * 0.6, d);
        if (k > halo[q]) halo[q] = k;
        W.grass[q] *= 1 - 0.9 * k; W.flower[q] *= 1 - k;
      }
      // the scree fan: below the crag, widening down the slope
      if (W.H[q] < hc + c.h * 0.3) scree[q] = Math.max(scree[q], sstep(c.r * 2.4 + 3, c.r * 0.9, d) * sstep(-0.3, 0.5, down) * 0.85);
    }
  }
  MTN.halo = halo; MTN.scree = scree;
  mtnBakeMap();
}
// the highest crag over (x, z), or -1e9
function mtnTopAt(x, z) {
  if (!MTN.top || x > DUN_X0) return -1e9;
  const gx = (x + HALF) / HS, gz = (z + HALF) / HS, i = Math.floor(gx), j = Math.floor(gz);
  if (i < 0 || j < 0 || i >= HN - 1 || j >= HN - 1) return -1e9;
  const T = MTN.top, k = j * HN + i;
  return Math.max(T[k], T[k + 1], T[k + HN], T[k + HN + 1]);
}
// cameraRoom (09_player.js): how far the camera may stand back along its ray before it would pass into a crag
function mtnCamRoom(px, py, pz, sx, sy, sz, dist) {
  if (!MTN.top || INDOOR.on) return dist;
  for (let t = 0.8; t <= dist; t += 0.4) if (py + sy * t < mtnTopAt(px + sx * t, pz + sz * t)) return Math.max(1.4, t - 0.6);
  return dist;
}
// no blade comes up through a crag (buildCoverMask, 03_terrain.js)
function mtnCoverAll() { for (const c of MTN.crags) coverCircle(c.x, c.z, c.r * 0.9); }

/* ------------------------------------------------------------------ */
/* 3. the land map: mountain, scree, gullies, heather                  */
/* ------------------------------------------------------------------ */
function mtnBakeMap() {
  const N = HN, N2 = N * N, H = W.H, M = MTN.mount, b = new Uint8Array(N2 * 4);
  const slope = new Float32Array(N2), steep = new Float32Array(N2);
  for (let j = 1; j < N - 1; j++) for (let i = 1; i < N - 1; i++) {
    const k = j * N + i;
    slope[k] = Math.hypot(H[k + 1] - H[k - 1], H[k + N] - H[k - N]) / (2 * HS);
    steep[k] = sstep(0.95, 1.6, slope[k]);
  }
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const k = j * N + i, m = M[k], x = -HALF + i * HS, z = -HALF + j * HS;
    b[k * 4] = Math.round(clamp(MTN.halo ? MTN.halo[k] : 0, 0, 1) * 255);
    b[k * 4 + 2] = Math.round(clamp(MTN.gully[k] || 0, 0, 1) * 255);
    // scree: broken stone shed from the faces above, lying where the ground eases off below them
    let s = 0;
    if (m > 0.02 && i > 4 && j > 4 && i < N - 5 && j < N - 5 && steep[k] < 0.9) {
      const h = H[k];
      for (let dj = -4; dj <= 4; dj++) for (let di = -4; di <= 4; di++) {
        const q = k + dj * N + di, rise = H[q] - h;
        if (rise < 1.5 || steep[q] < 0.05) continue;
        s += steep[q] * (1 - Math.hypot(di, dj) / 6.2) * sstep(1.5, 5, rise);
      }
      s = clamp(s / 9, 0, 1) * (1 - steep[k]) * sstep(0.1, 0.45, slope[k] + 0.2);
    }
    if (MTN.scree) s = Math.max(s, MTN.scree[k]);
    b[k * 4 + 1] = Math.round(s * 255);
    // heather on the gentler lower slopes of the mountains (most in Eriu, least in Thule)
    let ht = 0;
    if (m > 0.03 && slope[k] < 1.0 && H[k] > WATER_Y + 1.5) {
      const rw = W.realmW, rk = rw[k * 3] * 0.85 + rw[k * 3 + 1] * 1.0 + rw[k * 3 + 2] * 0.55;
      ht = sstep(0.03, 0.25, m) * (1 - sstep(0.55, 0.95, slope[k])) * (1 - sstep(26, 40, H[k])) * rk * (1 - W.road[k]) * sstep(0.15, 0.5, W.grass[k]);
      ht *= sstep(0.35, 0.62, vnoise(x * 0.035 + 2.2, z * 0.035 - 7.1));
    }
    b[k * 4 + 3] = Math.round(clamp(ht, 0, 1) * 255);
  }
  MTN.map = b;
}
function mtnUploadMap() {
  if (!MTN.map) return;
  const t = new THREE.DataTexture(MTN.map, HN, HN, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.minFilter = THREE.LinearFilter; t.magFilter = THREE.LinearFilter; t.generateMipmaps = false;
  t.needsUpdate = true;
  MTN.tex = t; U.uLandMap.value = t;
}

/* ------------------------------------------------------------------ */
/* the crags drawn                                                      */
/* ------------------------------------------------------------------ */
// one ring-and-layer mesh: S sides, L layers and a cap; the vertex shader shapes it for each crag
function mtnCragGeo(S, L) {
  const pos = [], idx = [];
  for (let l = 0; l <= L; l++) for (let s = 0; s < S; s++) pos.push(s, l, 0);
  pos.push(0, L, 1);
  const v = (s, l) => l * S + (s % S);
  for (let l = 0; l < L; l++) for (let s = 0; s < S; s++) {
    idx.push(v(s, l), v(s, l + 1), v(s + 1, l));
    idx.push(v(s + 1, l), v(s, l + 1), v(s + 1, l + 1));
  }
  const cap = (L + 1) * S;
  for (let s = 0; s < S; s++) idx.push(v(s, L), cap, v(s + 1, L));
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  return g;
}
const CRAG_VS = /* glsl */`
  ${GLSL_COMMON}
  attribute vec4 iA; // x, the buried foot's height, z, and the slope and yaw: round(slope * 16) * 8 + yaw (0..2pi; local +z faces down the slope)
  attribute vec4 iB; // width, depth, height from the foot, kind + seed
  uniform vec4 uCragLod; // sides, layers, the near model's fade out (start, end)
  uniform vec4 uCragFar; // the far model's fade out (start, end), 1 for the far model
  uniform vec3 uCragEye; // the main camera (the shadow pass draws from the sun's camera)
  varying vec3 vW; varying vec2 vFade; varying vec4 vInfo;
  float cn1(float x, float sd){ float i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f); return mix(hash12(vec2(i, sd)), hash12(vec2(i + 1.0, sd)), f); }
  float cnStep(float x, float sd){ float i = floor(x), f = smoothstep(0.3, 0.7, fract(x)); return mix(hash12(vec2(i, sd)), hash12(vec2(i + 1.0, sd)), f); }
  float cnRing(float a, float cells, float sd){ float x = a * cells, i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f); return mix(hash12(vec2(mod(i, cells), sd)), hash12(vec2(mod(i + 1.0, cells), sd)), f); }
  void main(){
    float S = uCragLod.x, L = uCragLod.y, far = uCragFar.z;
    float s = position.x, l = position.y, cap = position.z;
    float sd = fract(iB.w) * 97.0 + 1.0, kind = floor(iB.w + 0.001);
    float dI = length(iA.xz - uCragEye.xz);
    float keepN = 1.0 - smoothstep(uCragLod.z, uCragLod.w, dI);
    vFade = far > 0.5 ? vec2(keepN, 1.0 - smoothstep(uCragFar.x, uCragFar.y, dI)) : vec2(-1.0, keepN);
    vW = vec3(0.0); vInfo = vec4(0.0);
    if (vFade.y <= 0.0 || vFade.x >= 1.0) { gl_Position = vec4(0.0, 0.0, -2.0, 1.0); return; }
    float t = l / L;
    float W2 = iB.x * 0.5, D2 = iB.y * 0.5, Hh = iB.z;
    float s16 = floor(iA.w / 8.0), yaw = iA.w - s16 * 8.0, slope = s16 / 16.0;
    // the strata: uneven layers (the foot and the top stay put)
    float ty = (t > 0.001 && t < 0.999) ? clamp(t + (cn1(t * 6.0, sd) - 0.5) * 0.09, 0.0, 1.0) : t;
    // the profile by kind: 0 a cliff band, 1 a buttress, 2 a pinnacle on a crest, 3 a tor of stacked blocks
    float prof = kind < 0.5 ? 1.0 - 0.24 * ty : kind < 1.5 ? 1.0 - 0.52 * pow(ty, 1.3) : kind < 2.5 ? 1.0 - 0.8 * pow(ty, 1.05) : kind < 3.5 ? 1.0 - 0.32 * ty * ty : 1.0 - 0.62 * ty * ty;
    // ledges and small overhangs at the bedding planes (stepped, so the treads stay level)
    float ledge = kind > 3.5 ? 0.06 : kind > 2.5 ? 0.24 : kind > 1.5 ? 0.12 : 0.17; // 4: a boulder
    prof *= 1.0 + ledge * (cnStep(ty * 5.0 + 0.5, sd + 3.0) - 0.5);
    // round the crag: broad lobes, vertical joints, small facets
    float sm = mod(s, S);
    float a01 = (s + (hash12(vec2(sm, sd + 11.0)) - 0.5) * 0.45) / S;
    float lobes = 4.0 + floor(fract(sd * 0.37) * 4.0);
    float r = prof * (0.84 + 0.32 * cnRing(a01, lobes, sd + 5.0));
    r *= 1.0 - 0.17 * smoothstep(0.72, 0.95, cnRing(a01, 11.0, sd + 7.0));
    r *= 1.0 + (hash12(vec2(sm + l * 17.0, sd)) - 0.5) * 0.13 * (1.0 - far);
    float ang = a01 * 6.2831853, ca = cos(ang), sa = sin(ang);
    // a cliff band is a lens along the contour: its ends dive into the slope
    float lens = kind < 0.5 ? 1.0 - 0.5 * pow(abs(ca), 2.5) : 1.0;
    // a broken top edge
    float brk = (cnRing(a01, 5.0, sd + 13.0) - 0.5) * 0.16 * step(0.999, t);
    vec3 p = vec3(ca * r * W2, Hh * (ty * lens + brk), sa * r * D2);
    if (cap > 0.5) p = vec3(0.0, Hh * (kind > 1.5 && kind < 2.5 ? 1.08 : 1.0) * (kind < 0.5 ? 0.97 : 1.0), 0.0);
    // the top follows the hillside (lower on the downhill side, local +z) and the bedding dips across it
    p.y -= slope * 0.5 * p.z * ty;
    p.y += (fract(sd * 0.71) - 0.5) * 0.3 * p.x * ty * ty * (kind < 0.5 ? 1.0 : 0.5);
    // buttresses lean into the slope (local -z is up it)
    p.z -= (kind > 0.5 && kind < 1.5 ? 0.14 : kind > 1.5 && kind < 2.5 ? 0.05 : 0.07) * Hh * ty * ty;
    float c = cos(yaw), sn = sin(yaw);
    vec3 wp = vec3(iA.x + p.x * c + p.z * sn, iA.y + p.y, iA.z - p.x * sn + p.z * c);
    vW = wp;
    vInfo = vec4(ty, fract(sd * 0.137), kind, fract(sd));
    gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
  }`;
const cragMatBase = {
  vertexShader: CRAG_VS,
  fragmentShader: /* glsl */`
    ${GLSL_COMMON}
    ${GLSL_ATMOS}
    ${GLSL_WORLD}
    ${GLSL_SHADOW}
    ${GLSL_PLIGHT}
    ${GLSL_LIGHT}
    ${GLSL_WEATHER}
    ${GLSL_SEASON}
    ${GLSL_LAND}
    uniform float uWet, uSnowCover;
    varying vec3 vW; varying vec2 vFade; varying vec4 vInfo;
    float cragRidged(vec2 p){ return 1.0 - abs(vnoise(p) * 2.0 - 1.0); }
    // the terrain's rock relief (03_terrain.js rockRelief): broad slabs, cracks, grit
    float cragRelief(vec2 p, float fine){
      float h = cragRidged(p * 0.32) * 0.46 + vnoise(p * 0.9 + 3.1) * 0.22;
      h += cragRidged(p * 2.3 + 7.7) * 0.2 * fine;
      h += vnoise(p * 8.0) * 0.12 * fine;
      return h;
    }
    vec3 cragBump(vec3 n, vec3 p, float h, float k){
      vec3 dpx = dFdx(p), dpy = dFdy(p);
      float dhx = dFdx(h), dhy = dFdy(h);
      vec3 r1 = cross(dpy, n), r2 = cross(n, dpx);
      float det = dot(dpx, r1);
      return safeNormalize(abs(det) * n - k * sign(det) * (dhx * r1 + dhy * r2));
    }
    // lit as the terrain's rock is (lightRock): the sun more directly than turf, sky above and shade below
    vec3 cragLight(vec3 alb, vec3 n, float ao){
      float dif = clamp(dot(n, uLightDir) * 0.85 + 0.15, 0.0, 1.0);
      vec3 amb = uAmbient * (0.42 + 0.3 * clamp(n.y * 0.5 + 0.5, 0.0, 1.0)) * ao;
      return alb * (amb + uLightColor * 0.82 * dif * mix(0.2, 1.0, gSh) * mix(0.6, 1.0, ao) + gPL * mix(0.6, 1.0, ao));
    }
    void main(){
      float bd = bayer4(gl_FragCoord.xy);
      if (bd < vFade.x || bd > vFade.y) discard;
      vec3 n = safeNormalize(cross(dFdx(vW), dFdy(vW))); // the facet, turned to the camera
      gSh = shadowAt(vW, n);
      gPL = pointLights(vW, n);
      vec4 B = texture(uWorldB, worldUV(vW.xz));
      vec3 tint = realmTint(B.rgb);
      float d = distance(vW, cameraPosition);
      float fine = 1.0 - smoothstep(30.0, 100.0, d);
      vec3 w3 = n * n; w3 *= w3; w3 /= (w3.x + w3.y + w3.z);
      float hR = cragRelief(vW.zy, fine) * w3.x + cragRelief(vW.xz, fine) * w3.y + cragRelief(vW.xy, fine) * w3.z;
      float steep = 1.0 - smoothstep(0.55, 0.85, n.y);
      hR = mix(hR, hR * 0.68 + landStrata(vW) * 0.32, steep * (0.35 + 0.65 * fine));
      vec3 nr = cragBump(n, vW, hR, 0.6 * (0.35 + 0.65 * fine));
      float lEdge, lTone;
      vec3 lTilt = landFacets(vW, n, lEdge, lTone) * 0.6;
      nr = safeNormalize(nr + lTilt); // the same slabs as the faces round it
      vec3 rc = landRockTone(vW, tint) * mix(0.9, 1.1, vInfo.y) * (0.88 + 0.24 * lTone * steep);
      rc *= 1.0 - 0.28 * (1.0 - smoothstep(0.0, 0.12 + 0.002 * d, lEdge)) * steep * (1.0 - smoothstep(40.0, 140.0, d));
      rc *= mix(0.78, 1.1, mix(0.5, smoothstep(0.2, 0.75, hR), 0.45 + 0.55 * fine));
      float crack = 1.0 - smoothstep(0.08, 0.3, hR);
      rc *= 1.0 - 0.45 * crack * (0.25 + 0.75 * fine);
      rc *= 1.0 - 0.22 * landStreaks(vW, n) * steep;
      // the foot sits in the scree and in its own shade
      float above = vW.y - terrainHeight(vW.xz);
      float ao = mix(0.62, 1.0, smoothstep(0.0, 2.2, above)) * mix(0.7, 1.0, smoothstep(0.05, 0.4, hR));
      // moss and turf on the ledges, through the year; lichen freckles
      float moss = smoothstep(0.55, 0.9, nr.y) * smoothstep(0.35, 0.7, vnoise(vW.xz * 0.45 + 2.0)) * (0.5 + 0.5 * B.g) * (1.0 - smoothstep(28.0, 44.0, vW.y));
      rc = mix(rc, seasonGrass(vec3(0.22, 0.3, 0.12) * tint, 0.5, 0.3, 0.3, vW.xz), moss * (0.45 + 0.35 * fine));
      float lich = smoothstep(0.7, 0.78, vnoise(vW.zy * 3.1) * w3.x + vnoise(vW.xz * 3.1) * w3.y + vnoise(vW.xy * 3.1) * w3.z) * fine * (1.0 - moss);
      rc = mix(rc, mix(vec3(0.62, 0.58, 0.36), vec3(0.62, 0.42, 0.22), B.r), lich * 0.5);
      // rain darkens the stone and runs down the faces; snow on the ledges: the high snow by altitude and realm, and
      // the season's snow lying here
      float wWet = uWet * mix(0.3, 1.0, smoothstep(-0.6, 0.2, nr.y));
      rc = wetAlbedo(rc, wWet, 0.55);
      float riv = rivulets(vW, nr, wWet);
      float snowL = landSnowLine(vW, B.b, vnoise(vW.xz * 0.35)) * landSnowHold(safeNormalize(n + lTilt), vW);
      float sn = clamp(max(snowL, snowAmount(vW, nr, uSnowCover * snowHere(vW), gPL)), 0.0, 1.0);
      rc = mix(rc, snowAlbedo(vW), sn);
      vec3 col = cragLight(rc, nr, ao);
      col += rc * uAmbient * (0.12 * nr.y + 0.1); // the sky's light all round, as the smooth faces round it get
      vec3 V = safeNormalize(cameraPosition - vW);
      col += wetSheen(vW, nr, V, clamp(wWet * (1.0 - sn) + riv * 0.6, 0.0, 1.0), 0.45, gSh);
      col += uLightColor * snowSparkle(vW, V, gSh) * sn * fine;
      gl_FragColor = vec4(safeColor(applyFog(col, vW)), 1.0);
    }`,
};
function mtnCragMat(S, L, far) {
  return mat({ ...cragMatBase, uniforms: { uCragLod: { value: new THREE.Vector4(S, L, 100, 120) }, uCragFar: { value: new THREE.Vector4(290, 330, far ? 1 : 0, 0) }, uCragEye: MTN.eye } });
}
// the near and the far model, each with room for every crag; the near one's nearest crags also cast shadows
function buildCrags() {
  const n = MTN.crags.length;
  window.__hm.mtn = { MTN, MTN_D, mtnMountAt, mtnTopAt, mtnCamRoom, mtnCheck, updateMountains, check: mtnCheck, cragAt: (i) => MTN.crags[i] };
    mtnUploadMap();
  if (!n) return;
  const mk = (S, L, far) => {
    const base = mtnCragGeo(S, L), g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', base.attributes.position);
    g.setIndex(base.index);
    g.setAttribute('iA', new THREE.InstancedBufferAttribute(new Float32Array(n * 4), 4).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('iB', new THREE.InstancedBufferAttribute(new Float32Array(n * 4), 4).setUsage(THREE.DynamicDrawUsage));
    g.instanceCount = 0;
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
    const m = new THREE.Mesh(g, mtnCragMat(S, L, far));
    m.frustumCulled = false; m.renderOrder = 2;
    m.userData.mtn = far ? 'far' : 'near';
    scene.add(m);
    return m;
  };
  MTN.meshN = mk(12, 7, false);
  MTN.meshF = mk(9, 4, true);
  const gN = MTN.meshN.geometry, gs = new THREE.InstancedBufferGeometry();
  gs.setAttribute('position', gN.attributes.position); gs.setIndex(gN.index);
  gs.setAttribute('iA', gN.attributes.iA); gs.setAttribute('iB', gN.attributes.iB);
  gs.instanceCount = 0; gs.boundingSphere = gN.boundingSphere;
  MTN.shadowGeo = gs;
  const px = shadowCaster(MTN.meshN, depthFrom(MTN.meshN.material));
  px.geometry = gs;
}
// each frame: which crags each model draws (refreshed when the camera has moved 3 m or the quality changed)
function updateMountains() {
  if (!MTN.meshN || INDOOR.on) return;
  const q = quality.level, D = MTN_D[q] || MTN_D.high, cx = camera.position.x, cz = camera.position.z;
  MTN.eye.value.copy(camera.position);
  if (MTN.lastQ === q && Math.hypot(cx - MTN.lx, cz - MTN.lz) < 3) return; // the lists reach 4 m past each band
  MTN.lastQ = q; MTN.lx = cx; MTN.lz = cz;
  const N = MTN.meshN, F = MTN.meshF;
  for (const m of [N, F]) { const u = m.material.uniforms; u.uCragLod.value.z = D.near[0]; u.uCragLod.value.w = D.near[1]; u.uCragFar.value.x = D.far[0]; u.uCragFar.value.y = D.far[1]; }
  const aN = N.geometry.attributes.iA.array, bN = N.geometry.attributes.iB.array, aF = F.geometry.attributes.iA.array, bF = F.geometry.attributes.iB.array;
  let nn = 0, nf = 0, ns = 0;
  const put = (A, Bv, i, c) => { A[i * 4] = c.x; A[i * 4 + 1] = c.y0; A[i * 4 + 2] = c.z; A[i * 4 + 3] = Math.round(c.sl * 16) * 8 + ((c.yaw % TAU) + TAU) % TAU; Bv[i * 4] = c.w; Bv[i * 4 + 1] = c.d; Bv[i * 4 + 2] = c.h; Bv[i * 4 + 3] = c.kind + c.seed; };
  // the near model: those within shadow reach first (the shadow pass draws only them)
  for (let pass = 0; pass < 2; pass++) {
    for (const c of MTN.crags) {
      const d = Math.hypot(c.x - cx, c.z - cz), inS = d < D.shadow + c.r;
      if (d >= D.near[1] + 4 || inS !== (pass === 0)) continue;
      put(aN, bN, nn++, c);
      if (inS) ns++;
    }
  }
  for (const c of MTN.crags) {
    const d = Math.hypot(c.x - cx, c.z - cz);
    if (d > D.near[0] - 4 && d < D.far[1] + 4) put(aF, bF, nf++, c);
  }
  N.geometry.instanceCount = nn; F.geometry.instanceCount = nf; MTN.shadowGeo.instanceCount = ns;
  for (const g of [N.geometry, F.geometry]) { g.attributes.iA.needsUpdate = true; g.attributes.iB.needsUpdate = true; }
  N.visible = nn > 0; F.visible = nf > 0;
  MTN.stats.near = nn; MTN.stats.far = nf; MTN.stats.shadow = ns;
}

/* ------------------------------------------------------------------ */
/* test hooks                                                           */
/* ------------------------------------------------------------------ */
function mtnCheck() {
  const out = { crags: MTN.crags.length, kinds: [0, 0, 0, 0, 0], shaped: MTN.nShaped, reverted: MTN.reverted, filled: MTN.filled, cragOnWalk: 0, cragWet: 0, cragFloat: 0, newHollows: 0, camInside: 0 };
  const free = MTN.free;
  for (const c of MTN.crags) {
    out.kinds[c.kind]++;
    const rr = c.r + 2.5, i0 = Math.floor((c.x - rr + HALF) / HS), i1 = Math.ceil((c.x + rr + HALF) / HS), j0 = Math.floor((c.z - rr + HALF) / HS), j1 = Math.ceil((c.z + rr + HALF) / HS);
    let bad = false;
    for (let j = j0; j <= j1 && !bad; j++) for (let i = i0; i <= i1; i++) {
      if (i < 0 || j < 0 || i >= HN || j >= HN) continue;
      const x = -HALF + i * HS, z = -HALF + j * HS;
      // a texel anyone can reach, whose 1 m square comes within 2.5 m of the crag's reach
      if ((free[j * HN + i] || W.walk[j * HN + i] !== 1) && Math.hypot(x - c.x, z - c.z) - 1.42 < c.r + 1) { bad = true; break; }
    }
    if (bad) out.cragOnWalk++;
    let wet = false, flo = false;
    for (let a = 0; a < 24; a++) for (const f of [0.35, 0.7, 1]) {
      const px = c.x + Math.sin(a * 0.2618) * c.r * f, pz = c.z + Math.cos(a * 0.2618) * c.r * f;
      if (waterAt(px, pz)) wet = true;
      if (heightAt(px, pz) < c.y0 + 0.3) flo = true;
    }
    if (wet) out.cragWet++;
    if (flo) out.cragFloat++;
  }
  // hollows on the reshaped ground (an independent flood, as the water test makes it)
  const F = mtnFlood(W.H);
  for (let k = 0; k < HN * HN; k++) if (MTN.shaped[k] && F[k] - W.H[k] > 0.02) out.newHollows++;
  // the camera: stood behind the player at every reachable spot near a crag, from every side, never inside rock
  const P = GAME.player;
  if (P) {
    const keep = { x: P.x, z: P.z, y: P.y, mode: CAM.mode, yaw: CAM.yaw, pitch: CAM.pitch, dist: CAM.dist, td: CAM.targetDist, modal: UI.modal };
    CAM.mode = 'follow'; UI.modal = null;
    let tried = 0;
    const R = mulberry(77);
    for (let n = 0; n < 4000 && tried < 160; n++) {
      const c = MTN.crags[Math.floor(R() * MTN.crags.length)];
      const a = R() * TAU, dd = c.r + 1.1 + R() * 6, x = c.x + Math.sin(a) * dd, z = c.z + Math.cos(a) * dd;
      if (!isWalkable(x, z) || !free[mtnK(x, z)]) continue;
      tried++;
      P.x = P.prevX = x; P.z = P.prevZ = z; P.y = heightAt(x, z);
      for (let yy = 0; yy < 8; yy++) {
        CAM.yaw = Math.atan2(x - c.x, z - c.z) + Math.PI + (yy - 3.5) * 0.35; CAM.pitch = 0.12 + (yy % 3) * 0.12; CAM.dist = CAM.targetDist = 9; CAM.near = 9;
        updateCamera(1 / 30); updateCamera(1 / 30);
        const p = camera.position;
        for (const k of MTN.crags) {
          if (Math.abs(k.x - p.x) > k.r + 1 || Math.abs(k.z - p.z) > k.r + 1) continue;
          // well inside the crag's body (its profile is at least 0.45 of its half-width all the way up)
          const lx = (p.x - k.x) * Math.cos(k.yaw) - (p.z - k.z) * Math.sin(k.yaw), lz = (p.x - k.x) * Math.sin(k.yaw) + (p.z - k.z) * Math.cos(k.yaw);
          const e = Math.hypot(lx / (k.w * 0.5), lz / (k.d * 0.5));
          const ty = (p.y - k.y0) / k.h;
          if (ty > 0 && ty < 0.85 && e < 0.4 * (1 - 0.5 * ty)) out.camInside++;
        }
      }
    }
    out.camTried = tried;
    P.x = P.prevX = keep.x; P.z = P.prevZ = keep.z; P.y = keep.y;
    CAM.mode = keep.mode; CAM.yaw = keep.yaw; CAM.pitch = keep.pitch; CAM.dist = keep.dist; CAM.targetDist = keep.td; UI.modal = keep.modal;
  }
  return out;
}
