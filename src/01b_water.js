/* ================================================================== */
/* water: rivers, and where the water stands                           */
/* ================================================================== */
// Each realm has a river. It rises at the foot of the outer mountains beyond the realm's lake and runs down the low
// ground into the lake. Its surface only ever falls (where a rise is in the way it cuts a channel through) and it meets
// the lake at the lake's own level. The channel is carved into the heightfield: a rounded bed, deeper and wider toward
// the mouth (wade the upper river, swim the lower), and banks that slope down to the water.
// WATERGRID then holds, for every 2 m texel, the height of the water standing there (lakes, ponds and rivers) and how
// it flows; waterAt(x, z) reads it for swimming, wading, the shaders and anything else that needs to know.
const RIVERS = [];
const WATERGRID = { surf: null, fx: null, fz: null, tex: null };
const RIVER_STEP = 3;

// lay out a river's course from a source to its lake, following the low ground
function riverCourse(L, sx, sz, seed) {
  const pts = [];
  let x = sx, z = sz, a = Math.atan2(L.x - x, L.z - z);
  for (let n = 0; n < 160; n++) {
    pts.push({ x, z });
    const td = dist(x, z, L.x, L.z);
    if (td < L.r * 0.7) break;
    const want = Math.atan2(L.x - x, L.z - z);
    // among the ways within half a right angle of the lake, the one with the lowest ground ahead, keeping its line
    let best = want, bs = Infinity;
    for (let k = -6; k <= 6; k++) {
      const b = want + k * 0.13;
      let h = 0;
      for (const d of [4, 9, 15]) h += heightAt(x + Math.sin(b) * d, z + Math.cos(b) * d);
      const s = h / 3 + Math.abs(angDiff(b, a)) * 3.2 + Math.abs(angDiff(b, want)) * 1.6 + (vnoise(x * 0.02 + seed, z * 0.02 - seed) - 0.5) * 1.2 * Math.abs(k) * 0.15;
      if (s < bs) { bs = s; best = b; }
    }
    a = best;
    x += Math.sin(a) * RIVER_STEP; z += Math.cos(a) * RIVER_STEP;
  }
  // end in the lake itself
  const last = pts[pts.length - 1], ea = Math.atan2(L.x - last.x, L.z - last.z);
  for (let d = RIVER_STEP; d < L.r * 0.35; d += RIVER_STEP) pts.push({ x: last.x + Math.sin(ea) * d, z: last.z + Math.cos(ea) * d });
  return pts;
}
// smooth the course a little so the banks do not zig-zag
function riverSmooth(pts, n = 2) {
  for (let k = 0; k < n; k++) for (let i = 1; i < pts.length - 1; i++) {
    pts[i].x = (pts[i - 1].x + pts[i].x * 2 + pts[i + 1].x) / 4; pts[i].z = (pts[i - 1].z + pts[i].z * 2 + pts[i + 1].z) / 4;
  }
}
// the river's surface, width and depth along its course: the surface never rises downstream and reaches the lake level
function riverProfile(pts) {
  let s = 0, surf = Infinity;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    if (i) s += dist(p.x, p.z, pts[i - 1].x, pts[i - 1].z);
    p.s = s;
    const g = heightAt(p.x, p.z);
    surf = Math.min(surf - 0.012 * (i ? dist(p.x, p.z, pts[i - 1].x, pts[i - 1].z) : 0), g - 0.4);
    p.surf = Math.max(WATER_Y, surf);
  }
  const len = s || 1, s75 = len * 0.72;
  let at75 = pts[0].surf;
  for (const p of pts) if (p.s <= s75) at75 = p.surf;
  for (const p of pts) {
    const f = p.s / len;
    if (p.s > s75) p.surf = Math.max(WATER_Y, Math.min(p.surf, lerp(at75, WATER_Y, (p.s - s75) / (len - s75))));
    // the spring: a narrow, shallow runnel that widens into the river over its first stretch
    const spring = sstep(0, 22, p.s);
    p.hw = lerp(2.2, 4.3, sstep(0, 1, f)) * lerp(0.78, 1, spring); // never narrower than the 2 m grid can hold
    p.depth = lerp(0.75, 2.0, sstep(0.1, 0.85, f)) * lerp(0.55, 1, spring);
  }
  // direction and pace at each point (faster where it falls steeply)
  for (let i = 0; i < pts.length; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
    const dx = b.x - a.x, dz = b.z - a.z, l = Math.hypot(dx, dz) || 1, fall = (a.surf - b.surf) / l;
    pts[i].ux = dx / l; pts[i].uz = dz / l;
    pts[i].speed = clamp(0.55 + fall * 26, 0.45, 3.2) * (pts[i].surf <= WATER_Y + 0.02 ? 0.3 : 1);
  }
  return len;
}
// the nearest point of a river's course to (x, z): distance, and the course interpolated there
function riverNearest(Rv, x, z) {
  let best = null, bd = Infinity;
  const P = Rv.pts;
  for (let i = 0; i < P.length - 1; i++) {
    const a = P[i], b = P[i + 1], ex = b.x - a.x, ez = b.z - a.z, l2 = ex * ex + ez * ez || 1;
    const t = clamp(((x - a.x) * ex + (z - a.z) * ez) / l2, 0, 1), px = a.x + ex * t, pz = a.z + ez * t;
    const d = Math.hypot(x - px, z - pz);
    if (d < bd) { bd = d; best = { d, i, t }; }
  }
  if (!best) return null;
  const a = P[best.i], b = P[best.i + 1], t = best.t;
  return { d: best.d, surf: lerp(a.surf, b.surf, t), hw: lerp(a.hw, b.hw, t), depth: lerp(a.depth, b.depth, t), ux: lerp(a.ux, b.ux, t), uz: lerp(a.uz, b.uz, t), speed: lerp(a.speed, b.speed, t), s: lerp(a.s, b.s, t) };
}
// called from buildWorld once the lakes are dug: lay out the rivers and cut their channels into H
function carveRivers(H, forTexels) {
  RIVERS.length = 0;
  for (const L of LAKES) {
    const R = REALMS[L.realm];
    const rad = Math.hypot(L.x, L.z), ux = L.x / rad, uz = L.z / rad;
    // the source: at the foot of the outer mountains beyond the lake, a little to one side of straight out
    const side = L.realm === 1 ? -1 : 1, off = 28 * side;
    const sx = ux * 446 + uz * off, sz = uz * 446 - ux * off;
    const pts = riverCourse(L, sx, sz, R.id * 17.3);
    riverSmooth(pts, 3);
    const Rv = { realm: R.id, lake: L, pts, len: 0, name: R.riverName || `the ${R.name} water` };
    Rv.len = riverProfile(pts);
    let minx = Infinity, maxx = -Infinity, minz = Infinity, maxz = -Infinity;
    for (const p of pts) { minx = Math.min(minx, p.x); maxx = Math.max(maxx, p.x); minz = Math.min(minz, p.z); maxz = Math.max(maxz, p.z); }
    Rv.box = [minx - 12, minz - 12, maxx + 12, maxz + 12];
    forTexels((minx + maxx) / 2, (minz + maxz) / 2, Math.max(maxx - minx, maxz - minz) / 2 + 12, (k, x, z) => {
      if (x < Rv.box[0] || x > Rv.box[2] || z < Rv.box[1] || z > Rv.box[3]) return;
      const n = riverNearest(Rv, x, z);
      if (!n || n.d > n.hw + 9) return;
      if (n.d < n.hw) {
        const q = n.d / n.hw;
        H[k] = Math.min(H[k], n.surf - n.depth * (1 - q * q) - 0.12);
      } else {
        // the banks slope down to the water's edge
        H[k] = Math.min(H[k], n.surf + 0.22 + (n.d - n.hw) * 0.42 + Math.pow(Math.max(0, n.d - n.hw - 3), 2) * 0.08);
      }
    });
    RIVERS.push(Rv);
  }
}
// is (x, z) on or by a river (for keeping trees, rocks and camps off the water)
function nearRiver(x, z, pad = 0) {
  for (const Rv of RIVERS) {
    const b = Rv.box;
    if (x < b[0] - pad || x > b[2] + pad || z < b[1] - pad || z > b[3] + pad) continue;
    const n = riverNearest(Rv, x, z);
    if (n && n.d < n.hw + pad) return true;
  }
  return false;
}
// once the land is final: the height of the water over every texel, and its flow
// Deep water (over a grown man's chest) is marked 2 in W.walk: still unwalkable for anything that does not swim
// (isWalkable is walk === 0), passable for a swimmer (swimPassable). Slopes under water do not stop a swimmer either.
const WATER_DEEP = 1.15;
const PONDS = [];
// Closed hollows in the land fill with rain: a priority flood from the edge of the map and from the lakes and rivers
// finds every hollow and the height it would spill over at. A hollow deep and wide enough, with nothing standing in it
// (a tree, a rock, a road, a camp, a house), becomes a pond with its surface a little under the spill; any other
// hollow deeper than a hand is filled in, so there are no dry pond beds anywhere.
function findPonds(H, surf) {
  const N = HN, N2 = N * N, F = new Float32Array(N2), done = new Uint8Array(N2);
  const heap = new Int32Array(N2); let hn = 0;
  const less = (a, b) => F[heap[a]] < F[heap[b]];
  const push = (k) => { let i = hn++; heap[i] = k; while (i > 0) { const p = (i - 1) >> 1; if (!less(i, p)) break; const t = heap[i]; heap[i] = heap[p]; heap[p] = t; i = p; } };
  const pop = () => { const top = heap[0]; heap[0] = heap[--hn]; let i = 0; for (;;) { const l = i * 2 + 1, r = l + 1; let m = i; if (l < hn && less(l, m)) m = l; if (r < hn && less(r, m)) m = r; if (m === i) break; const t = heap[i]; heap[i] = heap[m]; heap[m] = t; i = m; } return top; };
  for (let k = 0; k < N2; k++) {
    const i = k % N, j = (k / N) | 0;
    F[k] = H[k];
    if (i === 0 || j === 0 || i === N - 1 || j === N - 1 || !isNaN(surf[k])) { done[k] = 1; push(k); }
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
  // the hollows, each with its texels, depth and spill height
  const lab = new Int32Array(N2).fill(-1), comps = [];
  for (let k = 0; k < N2; k++) {
    if (lab[k] >= 0 || F[k] - H[k] < 0.02) continue;
    const C = { ks: [], spill: F[k], max: 0, x: 0, z: 0 }, st = [k];
    lab[k] = comps.length;
    while (st.length) {
      const q = st.pop(), i = q % N, j = (q / N) | 0;
      C.ks.push(q); C.max = Math.max(C.max, F[q] - H[q]); C.spill = Math.max(C.spill, F[q]);
      C.x += -HALF + i * HS; C.z += -HALF + j * HS;
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const ii = i + di, jj = j + dj;
        if (ii < 0 || jj < 0 || ii >= N || jj >= N) continue;
        const n = jj * N + ii;
        if (lab[n] < 0 && F[n] - H[n] >= 0.02) { lab[n] = comps.length; st.push(n); }
      }
    }
    C.x /= C.ks.length; C.z /= C.ks.length;
    comps.push(C);
  }
  // what stands in each hollow: trees and rocks keep a pond out (2), anything built keeps the ground as it is (1|2)
  const taken = new Uint8Array(comps.length);
  const mark = (x, z, pad, bit) => {
    const i0 = Math.max(0, Math.floor((x - pad + HALF) / HS)), i1 = Math.min(N - 1, Math.ceil((x + pad + HALF) / HS));
    const j0 = Math.max(0, Math.floor((z - pad + HALF) / HS)), j1 = Math.min(N - 1, Math.ceil((z + pad + HALF) / HS));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) { const c = lab[j * N + i]; if (c >= 0) taken[c] |= bit; }
  };
  for (const t of W.trees) mark(t.x, t.z, 1.5, 2);
  for (const r of W.rocks) mark(r.x, r.z, 0.8 + r.s, 2);
  for (const s of W.stones || []) mark(s.x, s.z, 1.5, 2);
  for (const c of W.camps || []) mark(c.x, c.z, 18, 1);
  for (const S of SITES) mark(S.x, S.z, S.r + S.f + (S.kind === 'town' ? 34 : 8), 1);
  for (const c of COLL.boxes) if (c.tag !== 'tree' && c.tag !== 'rock' && c.tag !== 'stone') mark(c.x, c.z, Math.max(c.hx, c.hz) + 2, 1);
  mark(0, 0, 60, 1); // the Lone Tree's hill and the barrow
  let filled = 0;
  for (let c = 0; c < comps.length; c++) {
    const C = comps[c];
    let road = 0;
    for (const k of C.ks) road = Math.max(road, W.road[k]);
    if (road > 0.05) taken[c] |= 1;
    const r = Math.hypot(C.x, C.z);
    if (!taken[c] && C.max > 0.55 && C.ks.length >= 6 && r < 462) {
      // a pond
      const y = C.spill - 0.14;
      let n = 0;
      for (const k of C.ks) if (y > H[k] + 0.02) { surf[k] = y; n++; }
      if (n >= 4) { PONDS.push({ x: C.x, z: C.z, y, n, depth: C.max - 0.14 }); continue; }
    }
    // anything else deeper than a hand is filled in (but never under what is built): no dry pond beds
    if (C.max > 0.12 && !(taken[c] & 1)) { for (const k of C.ks) H[k] = Math.max(H[k], F[k] - 0.03 - 0.02 * Math.random()); filled++; }
  }
  // trees and rocks stay on the ground that was filled under them
  if (filled) {
    for (const t of W.trees) t.y = heightAt(t.x, t.z);
    for (const r of W.rocks) r.y = heightAt(r.x, r.z);
  }
  PONDS.filled = filled;
}
function buildWaterGrid() {
  const N2 = HN * HN, surf = new Float32Array(N2).fill(NaN), fx = new Float32Array(N2), fz = new Float32Array(N2), white = new Float32Array(N2);
  const H = W.H;
  for (let k = 0; k < N2; k++) if (H[k] < WATER_Y) surf[k] = WATER_Y;
  for (const Rv of RIVERS) {
    const b = Rv.box;
    const i0 = Math.max(0, Math.floor((b[0] + HALF) / HS)), i1 = Math.min(HN - 1, Math.ceil((b[2] + HALF) / HS));
    const j0 = Math.max(0, Math.floor((b[1] + HALF) / HS)), j1 = Math.min(HN - 1, Math.ceil((b[3] + HALF) / HS));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const x = -HALF + i * HS, z = -HALF + j * HS, n = riverNearest(Rv, x, z);
      if (!n || n.d > n.hw + 2.2) continue;
      const k = j * HN + i;
      if (n.surf <= H[k] - 0.02 && n.d > n.hw) continue;
      surf[k] = isNaN(surf[k]) ? n.surf : Math.max(surf[k], n.surf);
      const edge = 1 - sstep(n.hw * 0.6, n.hw + 1, n.d);
      fx[k] = n.ux * n.speed * edge; fz[k] = n.uz * n.speed * edge;
      // white water where the river falls steeply (it runs fastest there)
      white[k] = Math.max(white[k], sstep(1.8, 3.1, n.speed) * (1 - sstep(n.hw * 0.55, n.hw + 1.0, n.d)));
    }
  }
  // ponds in the closed hollows, and no dry pond beds
  findPonds(H, surf);
  for (let k = 0; k < N2; k++) if (!isNaN(surf[k]) && surf[k] > H[k] - 0.15) { W.grass[k] = 0; W.flower[k] = 0; }
  // the walk mask learns about deep water
  const walk = W.walk;
  for (let j = 0; j < HN; j++) for (let i = 0; i < HN; i++) {
    const k = j * HN + i, x = -HALF + i * HS, z = -HALF + j * HS;
    if (Math.abs(x) > HALF - 6 || Math.abs(z) > HALF - 6 || isNaN(surf[k])) continue;
    const d = surf[k] - H[k];
    if (d > WATER_DEEP) walk[k] = 2;
    else if (walk[k] === 1 && d > 0.4) walk[k] = 2; // a steep bank under the water: a swimmer gets past it
    else if (walk[k] === 1 && H[k] < WATER_Y - 1.0 && d > 0) walk[k] = 2;
  }
  // the surface carried a little way onto the shore (the water mesh is drawn over it and cut at the ground per pixel)
  const ext = new Float32Array(N2).fill(NaN);
  for (let k = 0; k < N2; k++) ext[k] = surf[k];
  for (let pass = 0; pass < 2; pass++) {
    const src = ext.slice();
    for (let j = 1; j < HN - 1; j++) for (let i = 1; i < HN - 1; i++) {
      const k = j * HN + i;
      if (!isNaN(src[k])) continue;
      let m = -Infinity;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) { const s = src[k + dj * HN + di]; if (!isNaN(s) && s > m) m = s; }
      if (m > -Infinity) ext[k] = m;
    }
  }
  WATERGRID.surf = surf; WATERGRID.fx = fx; WATERGRID.fz = fz; WATERGRID.white = white; WATERGRID.ext = ext;
}
// can a swimmer pass here (deep water, or anything walkable)
function swimPassable(x, z) {
  if (x > DUN_X0) return dunWalkable(x, z);
  if (Math.abs(x) > HALF - 4 || Math.abs(z) > HALF - 4) return false;
  const i = Math.round((x + HALF) / HS), j = Math.round((z + HALF) / HS);
  return W.walk[j * HN + i] !== 1;
}
// is there deep (swimming) water here, by the walk mask
function deepWaterAt(x, z) {
  if (x > DUN_X0 || Math.abs(x) > HALF - 4 || Math.abs(z) > HALF - 4) return false;
  const i = Math.round((x + HALF) / HS), j = Math.round((z + HALF) / HS);
  return W.walk[j * HN + i] === 2;
}
// the nearest river to a point (for its sound, the fish and the tests): { Rv, n } or null
function riverAt(x, z, pad = 6) {
  let best = null;
  for (const Rv of RIVERS) {
    const b = Rv.box;
    if (x < b[0] - pad || x > b[2] + pad || z < b[1] - pad || z > b[3] + pad) continue;
    const n = riverNearest(Rv, x, z);
    if (n && n.d < n.hw + pad && (!best || n.d < best.n.d)) best = { Rv, n };
  }
  return best;
}
// the water at (x, z): its surface height, how deep it is over the ground, and how it flows; null where it is dry
const _wa = { y: 0, depth: 0, fx: 0, fz: 0 };
function waterAt(x, z, out = _wa) {
  const S = WATERGRID.surf;
  if (!S || x > DUN_X0 || Math.abs(x) > HALF - 2 || Math.abs(z) > HALF - 2) return null;
  const gx = (x + HALF) / HS, gz = (z + HALF) / HS, i = Math.floor(gx), j = Math.floor(gz), u = gx - i, v = gz - j;
  // the surface of the water from the four texels around the point that have water
  let y = 0, w = 0, fx = 0, fz = 0;
  for (let q = 0; q < 4; q++) {
    const ii = i + (q & 1), jj = j + (q >> 1), k = jj * HN + ii, s = S[k];
    if (isNaN(s)) continue;
    const ww = ((q & 1) ? u : 1 - u) * ((q >> 1) ? v : 1 - v) + 1e-4;
    y += s * ww; fx += WATERGRID.fx[k] * ww; fz += WATERGRID.fz[k] * ww; w += ww;
  }
  if (!w) return null;
  y /= w;
  const g = heightAt(x, z);
  if (y <= g + 0.01) return null;
  out.y = y; out.depth = y - g; out.fx = fx / w; out.fz = fz / w;
  return out;
}
