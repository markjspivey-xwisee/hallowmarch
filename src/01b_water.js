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
    p.hw = lerp(2.2, 4.3, sstep(0, 1, f));
    p.depth = lerp(0.75, 2.0, sstep(0.1, 0.85, f));
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
function buildWaterGrid() {
  const N2 = HN * HN, surf = new Float32Array(N2).fill(NaN), fx = new Float32Array(N2), fz = new Float32Array(N2);
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
    }
  }
  WATERGRID.surf = surf; WATERGRID.fx = fx; WATERGRID.fz = fz;
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
