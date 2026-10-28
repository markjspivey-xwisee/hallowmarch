/* Local physical clearance for canonical realm plots. This never moves a plot,
 * edits terrain/nature, grants authority or spends a realm's stores. */
const REALM_RTS_SITE_HALF = 6;
const REALM_RTS_CROWN_RADIUS = Object.freeze({ oak: 3.72, birch: 2.18, pine: 3.03 });
const REALM_RTS_SITE_CACHE = new Map();
const REALM_RTS_GROUND_CACHE = new Map();
let realmRtsTerrainBins = new WeakMap();
function realmRtsSitesClear() { REALM_RTS_SITE_CACHE.clear(); REALM_RTS_GROUND_CACHE.clear(); realmRtsTerrainBins = new WeakMap(); }
function realmRtsSiteFrame(row) {
  let home = Number.isInteger(row?.home) && row.home >= 0 && row.home < 3 ? row.home : -1;
  const match = /^(town|keep):(\d+):\d+$/.exec(String(row?.plotId || row?.id || ''));
  if (home < 0 && match) home = match[1] === 'town' ? Number(match[2]) : Math.floor(Number(match[2]) / 2);
  if (home >= 0 && home < 3) return { yaw: REALMS[home].yaw };
  return { yaw: Number.isFinite(row?.yaw) && Math.abs(row.yaw) <= Math.PI * 2 ? row.yaw : 0 };
}
function realmRtsSiteSurface(row, half, yaw, include) {
  if (typeof LOD === 'undefined' || !LOD.terrain?.length) return;
  const c = Math.cos(yaw), s = Math.sin(yaw), extent = half * (Math.abs(c) + Math.abs(s));
  const i0 = Math.max(0, Math.floor((row.x - extent + HALF) / 128)), i1 = Math.min(7, Math.floor((row.x + extent + HALF) / 128));
  const j0 = Math.max(0, Math.floor((row.z - extent + HALF) / 128)), j1 = Math.min(7, Math.floor((row.z + extent + HALF) / 128));
  const geometries = new Set();
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
    const tile = LOD.terrain[j * 8 + i];
    for (const geo of tile?.gs || (tile?.m?.geometry ? [tile.m.geometry] : [])) if (geo?.index && geo.attributes?.position) geometries.add(geo);
  }
  const clip = (polygon, axis, sign) => {
    const out = [];
    for (let i = 0; i < polygon.length; i++) {
      const a = polygon[i], b = polygon[(i + 1) % polygon.length], da = sign * a[axis] - half, db = sign * b[axis] - half;
      const insideA = da <= 1e-8, insideB = db <= 1e-8;
      if (insideA) out.push(a);
      if (insideA !== insideB) { const t = da / (da - db); out.push(a.map((v, k) => v + (b[k] - v) * t)); }
    }
    return out;
  };
  const collisionHeight = point => heightAt(row.x + point[0] * c + point[1] * s, row.z - point[0] * s + point[1] * c);
  for (const geo of geometries) {
    const positions = geo.attributes.position.array, index = geo.index.array;
    let bins = realmRtsTerrainBins.get(geo);
    if (!bins) {
      // Triangle x/z do not change when a crater updates heights. Compact bins
      // avoid rescanning whole terrain chunks on every ground revision.
      const lists = new Map();
      for (let offset = 0; offset < index.length; offset += 3) {
        const a = index[offset] * 3, b = index[offset + 1] * 3, d = index[offset + 2] * 3;
        const x0 = Math.floor(Math.min(positions[a], positions[b], positions[d]) / 16), x1 = Math.floor(Math.max(positions[a], positions[b], positions[d]) / 16);
        const z0 = Math.floor(Math.min(positions[a + 2], positions[b + 2], positions[d + 2]) / 16), z1 = Math.floor(Math.max(positions[a + 2], positions[b + 2], positions[d + 2]) / 16);
        for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) {
          const key = x + ':' + z; if (!lists.has(key)) lists.set(key, []); lists.get(key).push(offset);
        }
      }
      bins = new Map([...lists].map(([key, values]) => [key, new Uint32Array(values)])); realmRtsTerrainBins.set(geo, bins);
    }
    const offsets = new Set();
    for (let x = Math.floor((row.x - extent) / 16); x <= Math.floor((row.x + extent) / 16); x++)
      for (let z = Math.floor((row.z - extent) / 16); z <= Math.floor((row.z + extent) / 16); z++)
        for (const offset of bins.get(x + ':' + z) || []) offsets.add(offset);
    for (const offset of offsets) {
      let polygon = [0, 1, 2].map(k => {
        const at = index[offset + k] * 3, dx = positions[at] - row.x, dz = positions[at + 2] - row.z;
        return [dx * c - dz * s, dx * s + dz * c, positions[at + 1]];
      });
      for (const [axis, sign] of [[0, 1], [0, -1], [1, 1], [1, -1]]) { polygon = clip(polygon, axis, sign); if (!polygon.length) break; }
      for (let k = 0; k < polygon.length; k++) {
        const a = polygon[k], b = polygon[(k + 1) % polygon.length]; include(a[2]);
        const ha = collisionHeight(a), hb = collisionHeight(b), mid = a.map((v, i) => (v + b[i]) / 2), hm = collisionHeight(mid);
        include(ha); include(hb); include(hm);
        // The collision heightfield is bilinear. Along an oblique clipped edge
        // it is quadratic, so include any extremum between its endpoints.
        const qa = 2 * (ha + hb - 2 * hm), qb = hb - ha - qa, t = Math.abs(qa) > 1e-10 ? -qb / (2 * qa) : -1;
        if (t > 0 && t < 1) include(collisionHeight(a.map((v, i) => v + (b[i] - v) * t)));
      }
    }
  }
}
function realmRtsSiteGround(row, { half = REALM_RTS_SITE_HALF, step = 1 } = {}) {
  const x = row?.x, z = row?.z, yaw = realmRtsSiteFrame(row).yaw;
  if (!Number.isFinite(x) || !Number.isFinite(z) || !Number.isFinite(half) || half <= 0 || half > 12)
    return { min: NaN, max: NaN, top: NaN, bottom: NaN };
  const identity = row.plotId || row.id, revision = typeof A2FL === 'undefined' ? 0 : A2FL.ground;
  const detail = typeof LOD !== 'undefined' && LOD.built ? 1 : 0;
  const key = [x, z, yaw, half, step, revision, detail].join(':'), saved = identity && REALM_RTS_GROUND_CACHE.get(identity);
  if (saved?.key === key) return saved.value;
  const n = Math.max(2, Math.min(48, Math.ceil(2 * half / (Number.isFinite(step) && step > 0 ? step : 1))));
  const c = Math.cos(yaw), s = Math.sin(yaw);
  let min = Infinity, max = -Infinity;
  for (let i = 0; i <= n; i++) for (let j = 0; j <= n; j++) {
    const u = -half + 2 * half * i / n, v = -half + 2 * half * j / n;
    const y = heightAt(x + u * c + v * s, z - u * s + v * c);
    if (!Number.isFinite(y)) return { min: NaN, max: NaN, top: NaN, bottom: NaN };
    min = Math.min(min, y); max = Math.max(max, y);
  }
  realmRtsSiteSurface(row, half, yaw, y => { if (Number.isFinite(y)) { min = Math.min(min, y); max = Math.max(max, y); } });
  const value = { min, max, top: max + 0.06, bottom: min - 0.12 };
  if (identity) {
    if (REALM_RTS_GROUND_CACHE.size >= 144 && !REALM_RTS_GROUND_CACHE.has(identity)) REALM_RTS_GROUND_CACHE.clear();
    REALM_RTS_GROUND_CACHE.set(identity, { key, value });
  }
  return value;
}
function realmRtsSiteStatus(plot) {
  const no = reason => ({ eligible: false, reason });
  if (!plot || typeof plot.id !== 'string' || !Number.isFinite(plot.x) || !Number.isFinite(plot.z)
    || Math.abs(plot.x) > HALF - 12 || Math.abs(plot.z) > HALF - 12) return no('This building site is unavailable.');
  if (plot.placementAvailable === false) return no('This site has no verified construction location.');
  if (plot.buildingId) return no('This plot already has a building.');
  const yaw = realmRtsSiteFrame(plot).yaw, ground = typeof A2FL === 'undefined' ? 0 : A2FL.ground;
  const stamp = Math.floor(performance.now() / 500), key = [plot.x, plot.z, yaw, ground, COLL.boxes.length, COLL.circles.length, stamp].join(':');
  const saved = REALM_RTS_SITE_CACHE.get(plot.id);
  if (saved?.key === key) return saved.value;
  const finish = value => {
    if (REALM_RTS_SITE_CACHE.size >= 72 && !REALM_RTS_SITE_CACHE.has(plot.id)) REALM_RTS_SITE_CACHE.clear();
    REALM_RTS_SITE_CACHE.set(plot.id, { key, value }); return value;
  };
  const half = REALM_RTS_SITE_HALF, radius = Math.SQRT2 * half + 1.5, c = Math.cos(yaw), s = Math.sin(yaw);
  const colliders = collidersNear(plot.x, plot.z, radius, []);
  const roads = (W.roads || []).filter(r => segDist2(plot.x, plot.z, r.ax, r.az, r.bx, r.bz) <= (radius + r.w + 1) ** 2);
  const rocks = (W.rocks || []).filter(r => Math.hypot(r.x - plot.x, r.z - plot.z) <= radius + r.s * 1.15);
  // Measured from the actual near/far tree geometry, including wind allowance.
  const crownRadius = t => (REALM_RTS_CROWN_RADIUS[t.kind] || 3.72) * t.s;
  const trees = (W.trees || []).filter(t => !t.felled && Math.hypot(t.x - plot.x, t.z - plot.z) <= radius + crownRadius(t));
  const n = 2 * half, previous = new Float64Array(n + 1);
  let min = Infinity, max = -Infinity;
  for (let i = 0; i <= n; i++) {
    let last = NaN;
    for (let j = 0; j <= n; j++) {
      const u = -half + i, v = -half + j, x = plot.x + u * c + v * s, z = plot.z - u * s + v * c;
      const y = heightAt(x, z);
      if (!Number.isFinite(y) || y < WATER_Y + 0.35 || waterAt(x, z)) return finish(no('This site needs dry ground.'));
      if (!isWalkable(x, z) || i > 0 && Math.abs(y - previous[j]) > 0.35 || j > 0 && Math.abs(y - last) > 0.35)
        return finish(no('The ground at this site is too steep.'));
      previous[j] = y; last = y; min = Math.min(min, y); max = Math.max(max, y);
      if (max - min > 1.2) return finish(no('The ground at this site is too uneven.'));
      if (colliders.some(b => b.active && collCovers(b, x, z, 0.75))
        || rocks.some(r => Math.hypot(r.x - x, r.z - z) < r.s * 1.15 + 0.75)
        || trees.some(t => Math.hypot(t.x - x, t.z - z) < crownRadius(t) + 0.75)
        || typeof plotAt === 'function' && plotAt(x, z, 0.75))
        return finish(no('An obstacle or garden occupies this site.'));
      if (roads.some(r => segDist2(x, z, r.ax, r.az, r.bx, r.bz) < (r.w + 0.75) ** 2))
        return finish(no('This site would block a road.'));
    }
  }
  return finish({ eligible: true, reason: '' });
}
