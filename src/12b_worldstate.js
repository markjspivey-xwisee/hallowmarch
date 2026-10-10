/* ================================================================== */
/* the world remembers: felled trees, stumps, logs and saplings, cut   */
/* and burnt ground, craters, burning and rebuilt houses and breached  */
/* walls are kept in the world save (12_save.js: buildSave puts        */
/* landSave() in world.land, applyWorldSave hands it to landApply).    */
/* The record is compact: times in whole seconds, fractions in         */
/* percent, the nature map in 4-bit run-length tiles, every list       */
/* capped. Also here: loot settling when the ground moves under it,    */
/* and the woodcutter's axe in the player's hand while chopping.       */
/* ================================================================== */
const LAND_CAP = { felled: 360, grow: 240, dyn: 140, piles: 40, tiles: 150, mapBytes: 60000, fire: 240, craters: 40, houses: 80 };
const LAND_HOUSE = { burning: 1, ruin: 2, scaffold: 3 };
const LAND_WALL = { whole: 0, breach: 1, repair: 2 };
const LAND = { restored: null, axe: { on: false, keep: 0 }, lootT: 0 };

/* ---- small encoders ---- */
const landNum = (v, lo, hi, def = 0) => (Number.isFinite(+v) ? clamp(+v, lo, hi) : def);
const landInt = (v, lo, hi) => (Number.isFinite(+v) && +v >= lo && +v <= hi ? Math.round(+v) : null);
function landB64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x4000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x4000));
  return btoa(s);
}
function landUnB64(str) {
  const s = atob(str), out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}
// runs of 4-bit values: one byte (value << 4 | length - 1) for runs up to 15, else (value << 4 | 15) and a byte of length - 16
function landRle(vals, n, out) {
  let i = 0;
  while (i < n) {
    const v = vals[i];
    let r = 1;
    while (i + r < n && vals[i + r] === v && r < 271) r++;
    if (r <= 15) out.push((v << 4) | (r - 1));
    else out.push((v << 4) | 15, r - 16);
    i += r;
  }
}
function landUnRle(bytes, at, n, vals) {
  let i = 0, p = at;
  while (i < n && p < bytes.length) {
    const b = bytes[p++], v = b >> 4;
    let r = (b & 15) + 1;
    if ((b & 15) === 15) r = 16 + (bytes[p++] || 0);
    for (let k = 0; k < r && i < n; k++) vals[i++] = v;
  }
  return p;
}

/* ------------------------------------------------------------------ */
/* save                                                                */
/* ------------------------------------------------------------------ */
function landSave() {
  if (!NATURE.built) return null;
  const now = GAME.t, L = { v: 1 };
  const pc = (v) => Math.round(clamp(v || 0, 0, 1) * 100);
  const sec = (v) => Math.max(0, Math.round(v));
  // felled trees: stumps, logs (or split), their fall and their clocks (the newest first, if there are too many)
  const fel = [];
  for (let n = NATURE.felled.length - 1; n >= 0 && fel.length < LAND_CAP.felled; n--) {
    const t = NATURE.felled[n], F = t.fall;
    if (!F) continue;
    const log = t.log || !F.done; // a tree still falling will lie as a log
    fel.push([t.i, (t.chopped ? 1 : 0) | (log ? 2 : 0), Math.round(Math.atan2(F.ux, F.uz) * 100), Math.round((F.done ? F.ang : F.stop) * 100), pc(t.grow), pc(t.char), pc(t.leaf),
      sec(t.regrowAt ? t.regrowAt - now : NAT_REGROW.felled), sec(now - (t.felledAt ?? now)), pc(t.rot2)]);
  }
  if (fel.length) L.fel = fel;
  // saplings growing back
  const gr = [];
  for (const t of NATURE.growing || []) { if (gr.length >= LAND_CAP.grow) break; if (!t.felled && t.state === 'stand' && t.grow < 1) gr.push([t.i, Math.round(t.grow * 1000)]); }
  if (gr.length) L.grow = gr;
  // standing trees that are charred, burning or notched by the axe
  const dyn = [];
  for (const t of NATURE.dyn) {
    if (dyn.length >= LAND_CAP.dyn) break;
    if (t.felled || !(t.char > 0.01 || t.fire > 0.01 || t.notch > 0.01)) continue;
    dyn.push([t.i, pc(t.char), pc(t.leaf), pc(t.fire), t.fire > 0 ? Math.round(Math.max(0, (t.burnDur || 20) - (t.burnT || 0)) * 10) : 0, pc(t.notch), Math.round((t.notchYaw || 0) * 100), t.collapseAt ? sec(t.collapseAt - now) : -1, pc(t.heat ?? 1)]);
  }
  if (dyn.length) L.dyn = dyn;
  // firewood piles, lit or not
  const pl = [];
  for (const p of NATURE.piles) {
    if (pl.length >= LAND_CAP.piles) break;
    pl.push([Math.round(p.x * 10), Math.round(p.z * 10), Math.round(p.yaw * 100), p.kind, p.lit ? 1 : 0, p.lit ? sec(p.until - now) : 0, sec(now - p.born), p.lit ? sec(now - p.litAt) : 0]);
  }
  if (pl.length) L.piles = pl;
  // the nature map: every tile still marked (cut grass, burnt ground, thrown earth), 4 bits a channel, run-length coded
  const keys = NATURE.tileKeys, D = NAT.data, q = new Uint8Array(3072), bytes = [], tk = [];
  for (const key of keys) {
    if (tk.length >= LAND_CAP.tiles || bytes.length > LAND_CAP.mapBytes) break;
    const ti = (key % 32) * 32, tj = Math.floor(key / 32) * 32;
    let any = false;
    for (let j = 0; j < 32; j++) {
      let o = natIdx(ti, tj + j) * 4;
      for (let i = 0; i < 32; i++, o += 4) {
        const k = j * 32 + i;
        // a cell burning now is kept as burnt ground (the fire itself is kept below)
        const g = D[o + 2] ? Math.max(D[o + 1], 200) : D[o + 1];
        q[k] = Math.min(15, (D[o] + 8) >> 4); q[1024 + k] = Math.min(15, (g + 8) >> 4); q[2048 + k] = Math.min(15, (D[o + 3] + 8) >> 4);
        if (q[k] | q[1024 + k] | q[2048 + k]) any = true;
      }
    }
    if (!any) continue;
    tk.push(key);
    landRle(q, 3072, bytes);
  }
  if (tk.length) L.map = { t: tk, d: landB64(Uint8Array.from(bytes)) };
  // grass burning now: the cells, how far along they are and how much heat they carry on
  const fire = [];
  for (const c of NATURE.fire.values()) {
    if (fire.length >= LAND_CAP.fire * 6) break;
    fire.push(c.i, c.j, Math.round(c.t * 10), Math.round(c.life * 10), pc(c.f), pc(c.heat));
  }
  if (fire.length) L.fire = fire;
  // craters: where, how big, how old, and the height they took from each grid point (cm)
  const cr = [];
  for (let n = NATURE.craters.length - 1; n >= 0 && cr.length < LAND_CAP.craters; n--) {
    const K = NATURE.craters[n], h = K.j1 - K.j0 + 1;
    const a = [Math.round(K.x * 10), Math.round(K.z * 10), Math.round(K.r * 10), K.i0, K.j0, K.w, h, sec(now - K.born)];
    for (let k = 0; k < K.d.length; k++) a.push(Math.round(K.d[k] * 100));
    cr.push(a);
  }
  if (cr.length) L.cr = cr;
  // houses on fire, in ruins or under scaffolding
  const hs = [];
  for (const H of HOUSES) {
    const code = LAND_HOUSE[H.state];
    if (!code || hs.length >= LAND_CAP.houses) continue;
    const B = H.burn;
    let pt = 0;
    if (code === 1 && B) { let bd = Infinity; H.roofPts.forEach((p, k) => { const d = dist2(p.x, p.z, B.x, B.z); if (d < bd) { bd = d; pt = k; } }); }
    hs.push([H.num, code, Math.round(H.stT * 10), pt, code === 1 && B ? Math.round(B.R * 10) : 0, code === 1 && B ? Math.round(B.dur * 10) : 0, code === 1 && B && B.fallAt ? Math.round(B.fallAt * 10) : 0, Math.round((H.fall || 0) * 100)]);
  }
  if (hs.length) L.hs = hs;
  // wall sections that are worn, breached or being rebuilt
  const ws = [];
  CASTLES.forEach((C, ci) => (C.sections || []).forEach((W, k) => {
    const code = LAND_WALL[W.state] ?? 0;
    if (code === 0 && !(W.wear > 0.005)) return;
    ws.push([ci, k, code, Math.round((W.t || 0) * 1000), Math.round((W.wear || 0) * 1000)]);
  }));
  if (ws.length) L.ws = ws;
  return L;
}
// what changes in the land is worth a write on its own (not the clocks ticking down)
function landKey(L) {
  if (!L) return 0;
  return [(L.fel || []).length, (L.fel || []).filter((f) => f[1] & 2).length, (L.cr || []).length, (L.map ? L.map.t.length : 0), (L.piles || []).length,
    (L.hs || []).map((h) => h[0] + ':' + h[1]).join(','), (L.ws || []).filter((w) => w[2]).map((w) => w[0] + '.' + w[1] + ':' + w[2]).join(',')].join('|');
}

/* ------------------------------------------------------------------ */
/* restore (at boot, from applyWorldSave; old saves have no land)      */
/* ------------------------------------------------------------------ */
function landApply(L) {
  LAND.restored = null;
  if (!L || typeof L !== 'object' || L.v !== 1 || !NATURE.built) return;
  const got = { t: GAME.t, craters: 0, felled: 0, grow: 0, dyn: 0, piles: 0, tiles: 0, fire: 0, houses: 0, walls: 0 };
  const part = (name, fn) => { try { fn(); } catch (e) { reportError(e); } };
  part('craters', () => landCraters(L.cr, got));
  part('map', () => landMap(L.map, L.fire, got));
  part('trees', () => landTrees(L, got));
  part('piles', () => landPiles(L.piles, got));
  part('houses', () => landHouses(L.hs, got));
  part('walls', () => landWalls(L.ws, got));
  LAND.restored = got;
}
function landCraters(list, got) {
  if (!Array.isArray(list)) return;
  for (const a of list.slice(0, LAND_CAP.craters).reverse()) {
    if (!Array.isArray(a) || a.length < 9) continue;
    const i0 = landInt(a[3], 1, HN - 2), j0 = landInt(a[4], 1, HN - 2), w = landInt(a[5], 1, 64), h = landInt(a[6], 1, 64), age = landNum(a[7], 0, 1e7);
    if (i0 === null || j0 === null || w === null || h === null || i0 + w > HN - 1 || j0 + h > HN - 1 || a.length < 8 + w * h) continue;
    const k = Math.exp(-age * NATURE.speed / 1500);
    if (k < 0.03) continue;
    const d = new Float32Array(w * h);
    for (let n = 0; n < w * h; n++) d[n] = landNum(a[8 + n], -800, 800) / 100;
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) { const v = d[j * w + i]; if (v) W.H[(j0 + j) * HN + i0 + i] += v * k; }
    const K = { i0, j0, i1: i0 + w - 1, j1: j0 + h - 1, w, d, k, born: GAME.t - age, x: landNum(a[0], -5120, 5120) / 10, z: landNum(a[1], -5120, 5120) / 10, r: landNum(a[2], 1, 400) / 10 };
    NATURE.craters.push(K);
    natTerrainUpdate(K.i0, K.j0, K.i1, K.j1);
    // trees and bodies in the bowl stand on the new ground
    const R = K.r * 1.75;
    natTreesNear(K.x, K.z, R, (t) => { if (!t.felled) { t.y = heightAt(t.x, t.z); if (t.state !== 'dyn') natShowRegular(t, t.s); } });
    forNear(K.x, K.z, R + 1, (o) => { if (!o.flying && o.kind !== 'dragon' && o.kind !== 'door' && Math.abs(o.y - heightAt(o.x, o.z)) < 3) o.y = heightAt(o.x, o.z); });
    got.craters++;
  }
}
function landMap(map, fire, got) {
  if (map && Array.isArray(map.t) && typeof map.d === 'string') {
    let bytes;
    try { bytes = landUnB64(map.d); } catch (e) { bytes = new Uint8Array(0); } // a damaged map is ignored
    const q = new Uint8Array(3072), D = NAT.data;
    let p = 0;
    for (const key of map.t.slice(0, LAND_CAP.tiles)) {
      if (!(key >= 0 && key < 1024) || p >= bytes.length) break;
      p = landUnRle(bytes, p, 3072, q);
      const ti = (key % 32) * 32, tj = Math.floor(key / 32) * 32;
      for (let j = 0; j < 32; j++) {
        let o = natIdx(ti, tj + j) * 4;
        for (let i = 0; i < 32; i++, o += 4) { const k = j * 32 + i; D[o] = q[k] * 17; D[o + 1] = q[1024 + k] * 17; D[o + 3] = q[2048 + k] * 17; }
      }
      natMark(ti, tj, ti + 31, tj + 31);
      natTouch(ti, tj);
      got.tiles++;
    }
  }
  if (Array.isArray(fire)) {
    for (let n = 0; n + 5 < fire.length && n < LAND_CAP.fire * 6; n += 6) {
      const i = landInt(fire[n], 1, NAT.res - 2), j = landInt(fire[n + 1], 1, NAT.res - 2);
      if (i === null || j === null) continue;
      const k = natIdx(i, j);
      const c = { i, j, t: landNum(fire[n + 2], 0, 600) / 10, life: landNum(fire[n + 3], 10, 600) / 10, f: landNum(fire[n + 4], 0, 100) / 100, heat: landNum(fire[n + 5], 0, 200) / 100 };
      NATURE.fire.set(k, c);
      NAT.data[k * 4 + 2] = 90;
      NAT.data[k * 4 + 1] = Math.round(255 * Math.min(1, c.t / c.life) * 0.85); // as charred as the fire had left it
      natMark(i, j, i, j);
      natTouch(i, j);
      got.fire++;
    }
  }
}
function landTree(i) { const n = landInt(i, 0, W.trees.length - 1); return n === null ? null : W.trees[n]; }
function landTrees(L, got) {
  const now = GAME.t;
  const seen = new Set();
  // felled: the trunk lies where it fell (or was split), the stump keeps its collider, the clocks run on
  for (const a of (Array.isArray(L.fel) ? L.fel : []).slice(0, LAND_CAP.felled).reverse()) {
    const t = Array.isArray(a) && landTree(a[0]);
    if (!t || seen.has(t) || t.felled) continue;
    seen.add(t);
    const yaw = landNum(a[2], -700, 700) / 100, stop = landNum(a[3], 10, 180, 157) / 100;
    t.grow = landNum(a[4], 10, 100, 100) / 100;
    natTake(t);
    const D = TREE_DIM[t.kind], s = natS(t);
    t.felled = true; t.chopped = !!(a[1] & 1); t.felledAt = now - landNum(a[8], 0, 1e7);
    t.char = landNum(a[5], 0, 100) / 100; t.leaf = landNum(a[6], 0, 100) / 100; t.fire = 0; t.shake = 0; t.notch = 0;
    t.fall = { ang: stop, vel: 0, ux: Math.sin(yaw), uz: Math.cos(yaw), stop, L: D.top * s, bounces: 2, done: true, slide: 0, drop: 1 };
    if (t.coll) { t.coll.r = D.r * s * 1.15 + 0.08; t.coll.h = D.cut * s + 0.2; t.coll.stump = true; t.coll.active = true; }
    if (!NATURE.felled.includes(t)) NATURE.felled.push(t);
    const left = landNum(a[7], 0, 1e6, NAT_REGROW.felled);
    if (a[1] & 2) {
      natSettle(t); // the log's collider
      t.regrowAt = now + left; t.rotAt = t.regrowAt; t.rot2 = landNum(a[9], 0, 99) / 100;
    } else {
      t.log = false; t.regrowAt = now + left;
      const k = NATURE.dyn.indexOf(t);
      if (k >= 0) NATURE.dyn.splice(k, 1);
    }
    got.felled++;
  }
  // saplings where stumps were
  for (const a of (Array.isArray(L.grow) ? L.grow : []).slice(0, LAND_CAP.grow)) {
    const t = Array.isArray(a) && landTree(a[0]);
    if (!t || seen.has(t) || t.felled) continue;
    seen.add(t);
    t.grow = landNum(a[1], 50, 999, 120) / 1000;
    t.y = heightAt(t.x, t.z); t.hp = TREE_DIM[t.kind].hp * t.s0;
    if (t.coll) { t.coll.stump = false; t.coll.r = (t.collR || 0.5) * (0.4 + 0.6 * t.grow); t.coll.h = 8; t.coll.active = true; }
    natShowRegular(t, t.s0 * t.grow);
    NATURE.growing = NATURE.growing || [];
    if (!NATURE.growing.includes(t)) NATURE.growing.push(t);
    got.grow++;
  }
  // standing trees with char, fire or the axe's notch
  for (const a of (Array.isArray(L.dyn) ? L.dyn : []).slice(0, LAND_CAP.dyn)) {
    const t = Array.isArray(a) && landTree(a[0]);
    if (!t || seen.has(t) || t.felled) continue;
    seen.add(t);
    natTake(t);
    t.char = landNum(a[1], 0, 100) / 100; t.leaf = landNum(a[2], 0, 100) / 100;
    const fire = landNum(a[3], 0, 100) / 100;
    if (fire > 0.01) { t.fire = fire; t.burnT = 0; t.burnDur = Math.max(0.5, landNum(a[4], 0, 600) / 10); t.heat = landNum(a[8], 0, 200, 100) / 100; }
    t.notch = landNum(a[5], 0, 100) / 100; t.notchYaw = landNum(a[6], -700, 700) / 100;
    const col = landNum(a[7], -1, 1e6, -1);
    if (col >= 0) t.collapseAt = now + col;
    got.dyn++;
  }
}
function landPiles(list, got) {
  if (!Array.isArray(list)) return;
  for (const a of list.slice(0, LAND_CAP.piles)) {
    if (!Array.isArray(a) || a.length < 7) continue;
    const x = landNum(a[0], -5100, 5100) / 10, z = landNum(a[1], -5100, 5100) / 10;
    const p = natAddPile(x, z, landNum(a[2], -700, 700) / 100, ['oak', 'birch', 'pine'][landInt(a[3], 0, 2) ?? 0]);
    p.born = GAME.t - landNum(a[6], 0, 1e7);
    if (a[4]) {
      const left = landNum(a[5], 0, 240);
      if (left < 1) { if (p.coll) p.coll.active = false; NATURE.piles.splice(NATURE.piles.indexOf(p), 1); continue; }
      p.lit = true; p.litAt = GAME.t - landNum(a[7], 0, 240); p.until = GAME.t + left;
      addFire(p.x, p.y + 0.35, p.z, 0.85, false, p.until, { r: 9, k: 1 });
    }
    got.piles++;
  }
}
function landHouses(list, got) {
  if (!Array.isArray(list)) return;
  for (const a of list.slice(0, LAND_CAP.houses)) {
    const H = Array.isArray(a) && HOUSES[landInt(a[0], 0, HOUSES.length - 1) ?? -1];
    if (!H || H.state !== 'whole') continue;
    const code = landInt(a[1], 1, 3), stT = landNum(a[2], 0, 1e5) / 10;
    if (code === 1) {
      const p = H.roofPts[landInt(a[3], 0, H.roofPts.length - 1) ?? 0];
      if (!igniteHouse(H, p.x, p.z)) continue;
      const B = H.burn;
      B.dur = landNum(a[5], 10, 600, B.dur * 10) / 10; B.speed = B.maxR / B.dur;
      B.R = clamp(landNum(a[4], 4, 1e4) / 10, 0.4, B.maxR);
      H.stT = stT;
      B.fallAt = a[6] > 0 ? landNum(a[6], 1, 1e5) / 10 : 0;
      H.fall = landNum(a[7], 0, 99) / 100;
      H.char = clamp((H.stT - 2) / (B.dur + 3), 0, 1);
      // the roof fires already burning come back at their size
      for (const q of B.pts) if (dist(q.x, q.z, B.x, B.z) <= B.R) { q.fire = houseFireAdd(q.x, q.y, q.z, 0.3); q.t0 = Math.max(0, stT - dist(q.x, q.z, B.x, B.z) / Math.max(B.speed, 0.01)); }
    } else if (code === 2 || code === 3) {
      houseHearthOut(H);
      for (const Lf of houseLeavesOf(H)) { Lf.open = 0; Lf.target = 0; }
      for (const win of H.wins) win.target = 0;
      H.burn = { x: H.x, z: H.z, R: 0, maxR: 0, dur: 1, speed: 0, fallAt: 0, pts: [], smoulder: [] };
      H.fall = 0; H.stT = stT;
      if (code === 2) {
        H.state = 'ruin'; H.char = 1; H.ember = clamp(1 - stT / 60, 0, 1);
        // the fallen roof still smoulders in the shell for a while
        if (stT < HOUSE_TIME.smoulder) {
          const n = H.big ? 7 : 5;
          for (let k = 0; k < n; k++) {
            let lx, lz;
            if (H.round) { const g = Math.random() * TAU, rr = Math.sqrt(Math.random()) * H.ri * 0.75; lx = Math.sin(g) * rr; lz = Math.cos(g) * rr; }
            else { lx = (Math.random() * 2 - 1) * H.iw * 0.75; lz = (Math.random() * 2 - 1) * H.id * 0.75; }
            const w = houseW(H, lx, lz), s0 = 0.6 + Math.random() * 0.45;
            H.burn.smoulder.push({ f: houseFireAdd(w.x, H.y + 0.12, w.z, s0 * clamp(1 - stT / HOUSE_TIME.smoulder, 0.1, 1)), s0 });
          }
        }
      } else {
        H.state = 'scaffold'; H.ember = 0;
        H.char = 1 - smooth(clamp(stT / (HOUSE_TIME.scaffold * 0.8), 0, 1));
      }
    } else continue;
    got.houses++;
  }
}
function landWalls(list, got) {
  if (!Array.isArray(list)) return;
  const dirty = new Set();
  for (const a of list) {
    if (!Array.isArray(a)) continue;
    const C = CASTLES[landInt(a[0], 0, CASTLES.length - 1) ?? -1];
    const Wl = C && C.sections && C.sections[landInt(a[1], 0, C.sections.length - 1) ?? -1];
    if (!Wl || Wl.state !== 'whole') continue;
    const code = landInt(a[2], 0, 2), t = landNum(a[3], 0, 1000) / 1000, wear = landNum(a[4], 0, 1000) / 1000;
    if (code === 0) {
      Wl.maxHp = sectionMaxHp(); Wl.wear = wear; Wl.hp = Wl.maxHp * (1 - wear);
    } else {
      // down: the walk and its parapets go with it, the rubble can be climbed
      Wl.state = 'breach'; Wl.hp = 0; Wl.quiet = 0; Wl.t = 0; Wl.wear = 1;
      for (const f of Wl.floors) f.active = false;
      for (const q of Wl.colls) q.active = false;
      if (Wl.coll) Wl.coll.active = false;
      for (const f of Wl.rubbleFloors) f.active = true;
      Wl.wreck.visible = true;
      if (code === 2) {
        // rebuilding behind its scaffold, as far along as it was
        Wl.state = 'repair'; Wl.t = t; Wl.scaffold.visible = true;
        for (const f of Wl.rubbleFloors) f.active = false;
        if (Wl.coll) { Wl.coll.fullH = Wl.coll.fullH || Wl.coll.h; Wl.coll.active = true; Wl.coll.h = Math.max(0.3, (Wl.coll.fullH || 7) * t); }
        if (t > 0.12) Wl.wreck.visible = false;
        Wl.fresh = Math.min(1, t * 3);
      }
    }
    dirty.add(C);
    got.walls++;
  }
  for (const C of dirty) castleCutUpload(C);
}

/* ------------------------------------------------------------------ */
/* every step: loot settles on moving ground; the woodcutter's axe      */
/* ------------------------------------------------------------------ */
function updateLand(dt) {
  LAND.lootT -= dt;
  if (LAND.lootT <= 0) {
    LAND.lootT = 0.2;
    // a crater opening (or softening) under dropped loot: it drops onto the new ground, or rides up as the bowl fills
    for (const Lt of LOOT) {
      if (!Lt.landed) continue;
      const g = heightAt(Lt.x, Lt.z);
      if (Lt.y > g + 0.03) { Lt.landed = false; Lt.vy = 0; Lt.vx = 0; Lt.vz = 0; Lt.bounce = 1; }
      else if (Lt.y < g - 0.005) Lt.y = g;
    }
  }
  landAxe();
}
// while the player chops or splits wood the class weapon is put away and the woodcutter's axe is in hand
function landAxe() {
  const P = GAME.player, A = LAND.axe;
  if (!P || !P.look) { A.on = false; return; }
  const Lk = P.look, want = !!(NATURE.job && P.alive);
  if (want) {
    if (!A.on || (Lk.mask & WEAPON_BITS) !== WB.axe || A.look !== Lk) {
      if (!A.on || A.look !== Lk) A.keep = Lk.mask & WEAPON_BITS;
      Lk.mask = (Lk.mask & ~WEAPON_BITS) | WB.axe;
      A.on = true; A.look = Lk;
    }
  } else if (A.on) {
    if (A.look === Lk && (Lk.mask & WEAPON_BITS) === WB.axe) Lk.mask = (Lk.mask & ~WEAPON_BITS) | A.keep;
    A.on = false; A.look = null;
  }
}
