// [look] The gallery's views (tools/tests/look.py): every kind of place and thing, each from a fixed camera or the play
// camera behind the player. LK.set(view, variant) sets the scene and returns what it shows (or { skip }).
window.LK = {
  H: __hm, F: __hm.fn,
  made: [],
  boot() {
    const H = this.H, P = H.GAME.player;
    document.getElementById('hud').hidden = true;
    P.hp = P.maxHp = 1e7;
    H.simulate(30);
    window.__rafHold = true;
    this.park();
    return 0;
  },
  // ---- the scene ----
  dry() {
    const Wt = this.H.dbg.WEATHER;
    Wt.mode = 'fixed'; Wt.kind = 'clear'; Wt.raining = 0; Wt.wet = 0; Wt.snowing = 0; Wt.snow = 0; Wt.overcast = 0; Wt.fog = 0; Wt.storm = 0; Wt.mist = 0; Wt.target = 0; Wt.w = 0; Wt.next = 1e9;
    this.H.dbg.U.uWet.value = 0;
  },
  rain(storm) {
    const Wt = this.H.dbg.WEATHER;
    Wt.mode = 'fixed'; Wt.kind = storm ? 'storm' : 'rain'; Wt.raining = 1; Wt.wet = 1; Wt.overcast = 1; Wt.fog = storm ? 1 : 0.7; Wt.storm = storm ? 1 : 0; Wt.next = 1e9;
  },
  snow() {
    // a winter's snow: the season's lying snow, and snow falling where it is cold enough (else a grey sky)
    const H = this.H, Wt = H.dbg.WEATHER;
    this.season(0.875);
    const c = H.camera.position, cold = H.farm.farmTempAt(c.x, c.z) < 1.5;
    Wt.mode = 'fixed'; Wt.kind = cold ? 'rain' : 'cloudy'; Wt.raining = cold ? 1 : 0; Wt.snow = 1; Wt.wet = 0; Wt.overcast = 0.9; Wt.fog = cold ? 0.7 : 0.25; Wt.next = 1e9;
  },
  mist() { const Wt = this.H.dbg.WEATHER; Wt.mode = 'fixed'; Wt.kind = 'mist'; Wt.overcast = 0.45; Wt.fog = 1; Wt.mist = 1; Wt.next = 1e9; },
  season(k) { this.H.farm.setSeason(k); this.H.seasons.seasonSettle(); },
  TOD: { day: 0.42, noon: 0.1, after: 0.62, golden: 1.0, dusk: 1.6, night: 2.1, dawn: 2.72 },
  tod(p) { const H = this.H; if (typeof p === 'string') p = this.TOD[p]; H.setTod(p); this.F.applyTimeOfDay(p); },
  cam(x, y, z, tx, ty, tz) {
    const H = this.H;
    H.UI.modal = null; H.CAM.mode = 'fixed';
    H.camera.position.set(x, y, z); H.camera.lookAt(tx, ty, tz); H.camera.updateMatrixWorld();
    return { cam: [+x.toFixed(1), +y.toFixed(1), +z.toFixed(1)], at: [+tx.toFixed(1), +ty.toFixed(1), +tz.toFixed(1)] };
  },
  // a camera at eye height on the ground at (x, z) looking at (tx, ty, tz)
  eye(x, z, tx, ty, tz, up = 1.7) { const y = this.floor(x, z) + up; return this.cam(x, y, z, tx, ty ?? y, tz); },
  floor(x, z, y) { const F = this.F; return F.floorAt ? F.floorAt(x, z, y ?? F.heightAt(x, z) + 30) : F.heightAt(x, z); },
  // the player standing at (x, z) facing yaw, seen by the play camera from behind (as a player sees the game)
  play(x, z, yaw, pitch = 0.22, dist = 7, y) {
    const H = this.H, F = this.F, P = H.GAME.player;
    if (P.mount) { try { F.dismount(P); } catch (e) { /* not mounted */ } }
    P.x = P.prevX = x; P.z = P.prevZ = z; P.y = y ?? (F.floorAt ? F.floorAt(x, z, F.heightAt(x, z) + 0.3) : F.heightAt(x, z));
    P.yaw = yaw; P.hp = P.maxHp; P.buffs.length = 0; P.casting = null; P.vy = 0; P.motion = null;
    H.CAM.mode = 'play'; H.UI.modal = null; H.look(yaw, pitch, dist); H.CAM.near = dist;
    return { player: [+x.toFixed(1), +z.toFixed(1)], yaw: +yaw.toFixed(2) };
  },
  // the player waits at home, out of every view
  park() { const H = this.H, F = this.F, P = H.GAME.player, S = H.REALMS[0].town; P.motion = null; if (P.mount) { try { F.dismount(P); } catch (e) { /* */ } } P.x = P.prevX = S.x + 3; P.z = P.prevZ = S.z + 3; P.y = F.heightAt(P.x, P.z); P.hp = P.maxHp; },
  hush(x, z, r = 40) { for (const e of this.H.ENT.slice()) if (e.alive && e.kind !== 'door' && e.role !== 'player' && !e.siegeEngine && Math.hypot(e.x - x, e.z - z) < r) this.F.removeEnt(e); },
  clear() { for (const e of this.made) if (e.alive || this.H.ENT.includes(e)) this.F.removeEnt(e); this.made = []; },
  rp(R, along, lat) { const Q = this.H.REALMS[R]; return { x: Q.dx * along + Q.px * lat, z: Q.dz * along + Q.pz * lat }; },
  sw(S, lx, lz) { return this.F.siteToWorld(S, lx, lz); },
  ahead(x, z, yaw, d) { return { x: x + Math.sin(yaw) * d, z: z + Math.cos(yaw) * d }; },
  yawTo(x, z, tx, tz) { return Math.atan2(tx - x, tz - z); },
  houses(r) { return this.H.HOUSES.filter((h) => h.realm === r && !h.keepHall && h.state === 'whole'); },
  // the town's houses nearest its middle, the n-th of them
  house(r, n = 0, big) { const S = this.H.REALMS[r].town; return this.houses(r).filter((h) => big === undefined || !!h.big === big).sort((a, b) => Math.hypot(a.x - S.x, a.z - S.z) - Math.hypot(b.x - S.x, b.z - S.z))[n]; },
  // a spot on open, level, walkable ground near (cx, cz), clear of trees, colliders and water by `clear` m
  open(cx, cz, clear = 4, maxR = 80, flat = 0.8) {
    const F = this.F, W = F.W, C = this.H.build.COLL;
    for (let k = 0; k < 3000; k++) {
      const a = k * 2.39996, r = Math.sqrt(k) * 1.5, x = cx + Math.sin(a) * r, z = cz + Math.cos(a) * r;
      if (r > maxR) break;
      if (!F.isWalkable(x, z) || this.H.water.waterAt(x, z)) continue;
      const hh = F.heightAt;
      if (Math.abs(hh(x + 3, z) - hh(x - 3, z)) + Math.abs(hh(x, z + 3) - hh(x, z - 3)) > flat) continue;
      if (W.trees.some((t) => Math.abs(t.x - x) < clear && Math.abs(t.z - z) < clear)) continue;
      if (C.boxes.some((c) => c.active !== false && Math.abs(c.x - x) < clear + (c.hx || 1) + 1 && Math.abs(c.z - z) < clear + (c.hz || 1) + 1)) continue;
      if (C.circles.some((c) => c.active !== false && Math.hypot(c.x - x, c.z - z) < clear + c.r)) continue;
      return { x, z };
    }
    return null;
  },
  // people in a line facing the camera, for a look at bodies up close
  lineUp(list, x, z, face, gap = 1.4) {
    const F = this.F, lx = Math.cos(face), lz = -Math.sin(face);
    list.forEach(([realm, cls, extra], i) => {
      const off = (i - (list.length - 1) / 2) * gap, px = x + lx * off, pz = z + lz * off;
      const e = F.spawnRealmUnit(realm, cls, 30, 'guard', px, pz, { yaw: face });
      e.ai.post = { x: px, z: pz, leash: 1 }; e.yaw = face; e.testLook = true;
      if (extra) extra(e);
      this.made.push(e);
    });
  },
  beast(kind, x, z, yaw, o = {}) {
    const F = this.F;
    const cols = o.cols || { sheep: [[0.86, 0.84, 0.78], [0.3, 0.28, 0.26]], hen: [[0.62, 0.42, 0.2], [0.4, 0.25, 0.12]], pheasant: [[0.62, 0.28, 0.09], [0.05, 0.19, 0.12]], duck: [[0.52, 0.5, 0.46], [0.03, 0.22, 0.09]], cattle: [[0.42, 0.3, 0.2], [0.9, 0.88, 0.84]], pig: [[0.86, 0.66, 0.6], [0.5, 0.36, 0.32]], horse: [[0.36, 0.22, 0.12], [0.1, 0.08, 0.06]] }[kind] || [[0.45, 0.43, 0.4], [0.3, 0.28, 0.26]];
    const e = F.makeEnt({ kind, faction: 4, role: 'test', name: 'look ' + kind, level: 5, x, z, y: F.heightAt(x, z), radius: 0.4, look: { colA: cols[0], colB: cols[1] }, scale: o.scale || 1 });
    e.yaw = yaw; e.prevX = e.x; e.prevZ = e.z; e.testMo = true; e.testLook = true;
    this.made.push(e);
    return e;
  },
  // let the world run a moment (bodies take their poses), then hold it
  settle(sec = 0.6) { const H = this.H, m = H.UI.modal; H.UI.modal = null; H.simulate(sec); H.UI.modal = m || null; },
  keepSite(r, k = 0) { return this.H.REALMS[r].keepSites[k]; },
  castle(S) { return this.F.castles().find((C) => C.S === S); },
  // ---- the checks: what clips, floats or sinks, anywhere in the world (requirement 10, in general) ----
  check() {
    const H = this.H, F = this.F, W = F.W, out = { counts: {}, examples: {}, n: {} };
    const add = (k, ex) => { out.counts[k] = (out.counts[k] || 0) + 1; const L = out.examples[k] = out.examples[k] || []; if (L.length < 8) L.push(ex); };
    const zero = (...ks) => { for (const k of ks) out.counts[k] = out.counts[k] || 0; };
    const near = [], r1 = (v) => Math.round(v * 10) / 10;
    // how far (x, z) lies inside a collider (> 0 inside), and which
    const inside = (c, x, z, r) => {
      if (c.type === 'circle') return c.r + r - Math.hypot(x - c.x, z - c.z);
      const dx = x - c.x, dz = z - c.z, lx = dx * c.cos - dz * c.sin, lz = dx * c.sin + dz * c.cos;
      return Math.min(c.hx + r - Math.abs(lx), c.hz + r - Math.abs(lz));
    };
    const solid = (x, z, r, skip, tags) => {
      F.collidersNear(x, z, r + 8, near);
      let best = null, bd = 0.02;
      for (const c of near) {
        if (c === skip || c.active === false || c.hollow || (tags && !tags(c))) continue;
        const d = inside(c, x, z, r); if (d > bd) { bd = d; best = c; }
      }
      return best ? { tag: best.tag, by: r1(bd) } : null;
    };
    const roadAt = (x, z) => F.sampleGrid(W.road, x, z);
    const deep = (x, z, d) => { const q = H.water.waterAt(x, z); return q && q.depth > d; };
    const built = (c) => c.tag !== 'tree' && c.tag !== 'rock' && c.tag !== 'bush' && c.tag !== 'plant' && !c.outcrop;
    // trees: the trunk clear of walls, houses, fences, props and stones; the crown clear of the houses' roofs; not on a road or in deep water
    let nt = 0;
    W.trees.forEach((t, i) => {
      if (t.gone || t.dead) return; nt++;
      const s = solid(t.x, t.z, 0.25 * (t.s || 1), t.coll, (c) => c.tag !== 'tree' && c.tag !== 'rock' && c.tag !== 'stone');
      if (s) add('tree trunk in something built', { i, x: r1(t.x), z: r1(t.z), kind: t.kind, ...s });
      // (against a boulder or a standing stone: a tree grows by a rock; counted, not failed)
      const sr = solid(t.x, t.z, 0.25 * (t.s || 1), t.coll, (c) => c.tag === 'rock' || c.tag === 'stone');
      if (sr && sr.by > 0.3) out.n.treeByRock = (out.n.treeByRock || 0) + 1;
      if (roadAt(t.x, t.z) > 0.35) add('tree on a road', { i, x: r1(t.x), z: r1(t.z), road: r1(roadAt(t.x, t.z)) });
      if (deep(t.x, t.z, 0.4)) add('tree in deep water', { i, x: r1(t.x), z: r1(t.z) });
      const hs = F.houseAt(t.x, t.z, 1.2 + 1.4 * (t.s || 1));
      if (hs) add('tree crown in a house', { i, x: r1(t.x), z: r1(t.z), kind: t.kind, s: r1(t.s || 1), house: hs.num });
    });
    out.n.trees = nt;
    // what stands on the ground stands on it: trees, rocks, plants and herbs neither float nor sink (their y against the
    // ground under them, after the mountains were shaped and everything settled)
    const gy = (x, z) => F.heightAt(x, z);
    W.trees.forEach((t, i) => { const d = t.y - gy(t.x, t.z); if (Math.abs(d) > 0.35) add(d > 0 ? 'tree floating' : 'tree sunk', { i, x: r1(t.x), z: r1(t.z), d: r1(d) }); });
    (W.rocks || []).forEach((q, i) => { const d = q.y - gy(q.x, q.z); if (Math.abs(d) > 0.35) add(d > 0 ? 'rock floating' : 'rock sunk', { i, x: r1(q.x), z: r1(q.z), d: r1(d) }); });
    H.surv.FORAGE.list.forEach((q, i) => { const d = q.y - gy(q.x, q.z); if (Math.abs(d) > 0.25) add(d > 0 ? 'plant floating' : 'plant sunk', { i, k: q.k, x: r1(q.x), z: r1(q.z), d: r1(d) }); });
    (H.farm.FARM.herbs || []).forEach((q, i) => { if (q.y == null) return; const d = q.y - gy(q.x, q.z); if (Math.abs(d) > 0.25) add(d > 0 ? 'herb floating' : 'herb sunk', { i, k: q.k, x: r1(q.x), z: r1(q.z), d: r1(d) }); });
    zero('tree floating', 'tree sunk', 'rock floating', 'rock sunk', 'plant floating', 'plant sunk', 'herb floating', 'herb sunk');
    // rocks and stones
    for (const [i, q] of (W.rocks || []).entries()) {
      const s = solid(q.x, q.z, 0.4 * (q.s || q.r || 1), q.coll, (c) => built(c));
      if (s) add('rock in something built', { i, x: r1(q.x), z: r1(q.z), ...s });
      if (roadAt(q.x, q.z) > 0.4) add('rock on a road', { i, x: r1(q.x), z: r1(q.z) });
    }
    // forage plants, wild herbs, the workstations, the towns' props
    for (const [i, q] of H.surv.FORAGE.list.entries()) {
      if (q.gone || q.cut) continue;
      const s = solid(q.x, q.z, q.k === 'apple' ? 0.25 : 0.15, q.coll, (c) => built(c));
      if (s) add('plant in something built', { i, k: q.k, x: r1(q.x), z: r1(q.z), ...s });
    }
    for (const [i, q] of (H.farm.FARM.herbs || []).entries()) {
      const s = solid(q.x, q.z, 0.1, null, (c) => built(c));
      if (s) add('herb in something built', { i, k: q.k, x: r1(q.x), z: r1(q.z), ...s });
    }
    for (const T of H.surv.CRAFT.stations) {
      const s = solid(T.x, T.z, 0.3, T.coll, (c) => built(c) && !(T.colls || []).includes(c) && c.station !== T);
      if (s) add('workstation in something built', { kind: T.kind, x: r1(T.x), z: r1(T.z), ...s });
    }
    for (const R of H.REALMS) for (const p of (R.town.props || [])) {
      const hs = F.houseAt(p.x, p.z, p.type === 'fence' || p.type === 'garden' ? -0.2 : 0.1);
      if (hs) add('town prop in a house', { type: p.type, x: r1(p.x), z: r1(p.z), house: hs.num });
    }
    // grass through a floor near the ground (castle walks, stairs, tower rooms, the halls): the grass mask there, under no cover
    const COV = H.dbg.COVER, covAt = (x, z) => { const i = Math.floor(x + 512), j = Math.floor(z + 512); return (i < 0 || j < 0 || i >= COV.res || j >= COV.res) ? 1 : COV.data[j * COV.res + i] / 255; };
    let nf = 0;
    for (const C of F.castles()) for (const f of (C.floors || [])) {
      const y = f.type === 'disc' ? f.y : Math.min(f.ya ?? f.y, f.yb ?? f.y);
      if (y == null || y - F.heightAt(f.x, f.z) > 0.5) continue;
      const pts = f.type === 'disc' ? [[0, 0], [0.6, 0], [-0.6, 0], [0, 0.6], [0, -0.6]].map(([a, b]) => [f.x + a * f.r, f.z + b * f.r])
        : [[0, 0], [0.7, 0.7], [-0.7, 0.7], [0.7, -0.7], [-0.7, -0.7]].map(([a, b]) => { const lx = a * f.hx, lz = b * f.hz; return [f.x + lx * f.cos + lz * f.sin, f.z - lx * f.sin + lz * f.cos]; });
      for (const [x, z] of pts) { nf++; if (F.sampleGrid(W.grass, x, z) > 0.05 && covAt(x, z) < 0.3) { add('grass through a floor', { x: r1(x), z: r1(z), y: r1(y) }); break; } }
    }
    out.n.floorPts = nf;
    // grass in the water: a point a body would see under 5 cm of water or more, where the grass mask (bilinear) still
    // grows blades and the cover map does not stop them
    const WG = H.water.WATERGRID.surf, HN = 513;
    let nw = 0;
    for (let j = 1; j < HN - 1; j++) for (let i = 1; i < HN - 1; i++) {
      const k = j * HN + i;
      if (isNaN(WG[k])) continue;
      for (let q = 0; q < 4; q++) {
        const x = -512 + i * 2 - 0.5 + (q & 1), z = -512 + j * 2 - 0.5 + (q >> 1), w = H.water.waterAt(x, z);
        if (!w || w.y < F.heightAt(x, z) + 0.05) continue;
        nw++;
        if (F.sampleGrid(W.grass, x, z) > 0.05 && covAt(x, z) < 0.3) add('grass in the water', { x: r1(x), z: r1(z), depth: r1(w.y - F.heightAt(x, z)), grass: r1(F.sampleGrid(W.grass, x, z)) });
      }
    }
    out.n.waterPts = nw;
    zero('grass in the water');
    // people where they stand: on their floor, not sunk into it and not floating over it
    let np = 0;
    for (const e of H.ENT) {
      if (!e.alive || e.kind !== 'humanoid' || e.motion || e.mount || e.swim || e.boat || e.seat || e.fixedY || e.role === 'player' || e.testLook) continue;
      if (Math.abs(e.x) > 512 || Math.abs(e.z) > 512) continue;
      const fl = F.floorAt(e.x, e.z, e.y + 0.3); np++;
      if (e.y < fl - 0.06) add('a body sunk into its floor', { role: e.role, x: r1(e.x), z: r1(e.z), y: r1(e.y), floor: r1(fl) });
      else if (e.y > fl + 0.12 && !(e.vy > 0.01)) add('a body floating', { role: e.role, x: r1(e.x), z: r1(e.z), y: r1(e.y), floor: r1(fl) });
    }
    out.n.people = np;
    // bodies inside something solid (a wall, a prop, a stone): the colliders push the living out, so one inside was
    // put there (a spawn, a post) or slipped through
    let nb = 0;
    for (const e of H.ENT) {
      if (!e.alive || e.kind === 'door' || e.kind === 'dragon' || e.kind === 'wisp' || e.role === 'bird' || e.fixedY || e.boat || e.motion || e.testLook || Math.abs(e.x) > 512) continue;
      if (e.y - F.heightAt(e.x, e.z) > 1.5) continue; // up on a wall or a tower: the colliders there are a level below
      nb++;
      const s = solid(e.x, e.z, Math.min(0.25, (e.radius || 0.4) * 0.5), null, (c) => built(c) && c.tag !== 'door' && !c.vert && c.tag !== 'fire');
      if (s && s.by > 0.15) add('a body inside something solid', { kind: e.kind, role: e.role, name: e.name, x: r1(e.x), z: r1(e.z), seatY: e.seat?.y ?? null, activity: e.ai?.plan?.steps?.[e.ai.plan.i]?.k ?? null, ...s });
    }
    out.n.bodies = nb;
    zero('a body inside something solid');
    zero('tree trunk in something built', 'tree on a road', 'tree in deep water', 'tree crown in a house', 'rock in something built', 'rock on a road', 'plant in something built',
      'herb in something built', 'workstation in something built', 'town prop in a house', 'grass through a floor', 'a body sunk into its floor', 'a body floating');
    return out;
  },
  views: {},
  group: {},
  def(group, name, fn) { this.views[name] = fn; (this.group[group] = this.group[group] || []).push(name); },
  groups() { return this.group; },
  // the variant on top of the view: time of day, weather, season
  set(name, variant = 'day') {
    const H = this.H;
    this.clear(); this.dry(); this.park();
    const seasons = { spring: 0.125, summer: 0.375, autumn: 0.625, winter: 0.875 };
    this.season(seasons[variant] ?? (variant === 'snow' ? 0.875 : 0.375));
    this.tod('day');
    document.getElementById('hud').hidden = true;
    const fn = this.views[name];
    if (!fn) return { skip: 'no such view' };
    const info = fn.call(this, this, variant) || {};
    if (info.skip) return info;
    if (this.TOD[variant] !== undefined && !(info.keepTod && variant === 'day')) this.tod(variant); // [look7] a view that sets its own hour keeps it (the sky's views), unless a variant asks for another
    if (variant === 'rain') this.rain(false);
    if (variant === 'storm') this.rain(true);
    if (variant === 'mist') this.mist();
    if (variant === 'snow') this.snow();
    // the weather's look eases in: run its update until it is there
    for (let i = 0; i < 3; i++) H.frame(1 / 30);
    return info;
  },
};
(function () {
  const LK = window.LK, D = (g, n, f) => LK.def(g, n, f);
  /* ---- towns ---- */
  for (const r of [0, 1, 2]) {
    // the street: the player in the town's middle, looking along it at the houses (the play camera)
    D('towns', `t${r}_street`, (L) => {
      const S = L.H.REALMS[r].town, h = L.house(r, 2);
      const sp = L.open(S.x, S.z, 2.5, 30) || S;
      return L.play(sp.x, sp.z, L.yawTo(sp.x, sp.z, h.x, h.z), 0.18, 7);
    });
    // a house's front from across the lane, at eye height
    D('towns', `t${r}_house`, (L) => {
      const h = L.house(r, 1, false), o = h.door.out2;
      const e = L.ahead(o.x, o.z, Math.atan2(o.x - h.x, o.z - h.z), 4);
      return { ...L.eye(e.x, e.z, h.x, h.y + 2.2, h.z), house: h.num };
    });
    // inside a house, from its door (the player stands just inside; the camera stays in the room)
    D('towns', `t${r}_inside`, (L) => {
      const h = L.house(r, 1, false), D0 = h.door, i = D0.in;
      L.F.setHouseDoor && L.F.setHouseDoor(h, true);
      return { ...L.play(i.x, i.z, Math.atan2(h.x - D0.out.x, h.z - D0.out.z), 0.32, 3.2), house: h.num };
    });
    // the town from a rise outside it: houses, roofs, chimneys, the fields, the people
    D('towns', `t${r}_over`, (L) => {
      const S = L.H.REALMS[r].town, R = L.H.REALMS[r], p = { x: S.x - R.dx * 58 + R.px * 20, z: S.z - R.dz * 58 + R.pz * 20 };
      return L.cam(p.x, L.F.heightAt(p.x, p.z) + 16, p.z, S.x, L.F.heightAt(S.x, S.z) + 2, S.z);
    });
    // the fields and gardens, from their edge toward the town
    D('towns', `t${r}_fields`, (L) => {
      const S = L.H.REALMS[r].town, fr = (L.F.W.fieldRects || []).filter((f) => (f.realm ?? 0) === r).sort((a, b) => Math.hypot(a.x - S.x, a.z - S.z) - Math.hypot(b.x - S.x, b.z - S.z))[0];
      if (!fr) return { skip: 'no field' };
      const dx = S.x - fr.x, dz = S.z - fr.z, d = Math.hypot(dx, dz) || 1, sx = fr.x - dx / d * 12, sz = fr.z - dz / d * 12;
      return L.play(sx, sz, Math.atan2(dx, dz), 0.2, 7);
    });
    // the jetty and its boats, from the shore
    D('towns', `t${r}_jetty`, (L) => {
      const J = L.H.water.boats.jetties().find((j) => j.realm === r);
      if (!J) return { skip: 'no jetty' };
      const lx = -J.dz, lz = J.dx, sx = J.x0 - J.dx * 6 + lx * 9, sz = J.z0 - J.dz * 6 + lz * 9, e = { x: J.x0 + J.dx * J.len * 0.7, z: J.z0 + J.dz * J.len * 0.7 };
      return L.eye(sx, sz, e.x, L.F.heightAt(sx, sz) + 0.6, e.z, 2.0);
    });
  }
  /* ---- close up: the faults that only show near ---- */
  // a house's front from 3.5 m: plaster, timbers, the door and the windows, the shutters, the step
  D('close', 'wall0', (L) => {
    const h = L.house(0, 1, false), o = h.door.out, n = Math.atan2(o.x - h.x, o.z - h.z), e = L.ahead(o.x, o.z, n, 2.6), s = L.ahead(e.x, e.z, n + Math.PI / 2, 0.9);
    return { ...L.cam(s.x, h.y + 1.7, s.z, o.x, h.y + 1.9, o.z), house: h.num };
  });
  // a round house's thatch from under its eave, and its lining from within
  D('close', 'thatch1', (L) => {
    const h = L.house(1, 1, false), o = h.door.out2, n = Math.atan2(o.x - h.x, o.z - h.z), s = L.ahead(o.x, o.z, n + 0.9, 1.5);
    return { ...L.cam(s.x, h.y + 1.8, s.z, h.x, h.y + h.H0 + 1.4, h.z), house: h.num };
  });
  // a broadleaf's crown over a low camera against the sky (a rider's or a child's eye)
  D('close', 'crown', (L) => {
    const T = L.F.W.trees; let best = null;
    for (const t of T) { if (t.kind !== 'oak' || Math.hypot(t.x, t.z) > 220 || t.s < 1.0) continue; if (L.F.isWalkable(t.x + 3, t.z) && !L.H.water.waterAt(t.x + 3, t.z)) { best = t; break; } }
    if (!best) return { skip: 'no oak' };
    return { ...L.cam(best.x + 3.2, L.F.heightAt(best.x + 3.2, best.z) + 1.1, best.z + 0.6, best.x - 1, best.y + 7.5, best.z - 0.3), tree: best.kind };
  });
  // two people at 2 m: faces, hair, cloth and mail
  D('close', 'faces', (L) => {
    const sp = L.open(L.H.REALMS[0].musterSite.x + 30, L.H.REALMS[0].musterSite.z - 12, 4, 80);
    if (!sp) return { skip: 'no room' };
    L.hush(sp.x, sp.z, 14);
    L.lineUp([[0, 'priest'], [0, 'archer']], sp.x, sp.z, 0.3, 0.9);
    L.settle(0.6); for (const e of L.made) e.yaw = 0.3;
    const c = L.ahead(sp.x, sp.z, 0.3, 2.3);
    return L.eye(c.x, c.z, sp.x, L.F.heightAt(sp.x, sp.z) + 1.45, sp.z, 1.6);
  });
  // a priest and a warrior walking toward the camera, caught mid-stride (cloth over the legs, the tabard over the robe)
  D('close', 'walkers', (L) => {
    const sp = L.open(L.H.REALMS[0].musterSite.x + 30, L.H.REALMS[0].musterSite.z - 12, 6, 80);
    if (!sp) return { skip: 'no room' };
    L.hush(sp.x, sp.z, 20);
    const F = L.F, face = 0.3, lx = Math.cos(face), lz = -Math.sin(face);
    const mk = (cls, off) => { const x = sp.x + lx * off - Math.sin(face) * 6, z = sp.z + lz * off - Math.cos(face) * 6; const e = F.spawnRealmUnit(0, cls, 30, 'guard', x, z, { yaw: face }); e.ai.post = { x: sp.x + lx * off + Math.sin(face) * 30, z: sp.z + lz * off + Math.cos(face) * 30, leash: 1 }; e.testLook = true; L.made.push(e); return e; };
    mk('priest', -0.8); mk('warrior', 0.8);
    L.settle(1.6);
    // the camera ahead of them (where they are now) and a little to the side, looking back at their middle
    const e0 = L.made[0], e1 = L.made[1], mx = (e0.x + e1.x) / 2, mz = (e0.z + e1.z) / 2, hd = Math.atan2(Math.sin(e0.yaw) + Math.sin(e1.yaw), Math.cos(e0.yaw) + Math.cos(e1.yaw));
    const c = L.ahead(mx, mz, hd + 0.35, 4.2);
    return { ...L.eye(c.x, c.z, mx, L.F.heightAt(mx, mz) + 0.95, mz, 1.45), at: [+mx.toFixed(1), +mz.toFixed(1)], moving: [+(e0.speedNow || 0).toFixed(2)] };
  });
  /* ---- keeps ---- */
  for (const r of [0, 1, 2]) {
    D('keeps', `k${r}_gate`, (L) => {
      const S = L.keepSite(r, 0), a = L.sw(S, 0, 34), g = L.sw(S, 0, 0);
      return L.play(a.x, a.z, L.yawTo(a.x, a.z, g.x, g.z), 0.12, 7);
    });
    D('keeps', `k${r}_court`, (L) => {
      const S = L.keepSite(r, 0), a = L.sw(S, 4, 6), g = L.sw(S, -6, -12);
      return L.play(a.x, a.z, L.yawTo(a.x, a.z, g.x, g.z), 0.2, 7);
    });
    D('keeps', `k${r}_far`, (L) => {
      const S = L.keepSite(r, 0), a = L.sw(S, 30, 62);
      return L.cam(a.x, L.F.heightAt(a.x, a.z) + 9, a.z, S.x, (S.y ?? L.F.heightAt(S.x, S.z)) + 5, S.z);
    });
    // on a wall walk: the longest walk, the player in its middle looking along it
    D('keeps', `k${r}_walk`, (L) => {
      const S = L.keepSite(r, 0), C = L.castle(S);
      const fw = (C.floors || []).filter((f) => f.tag === 'walk' && f.type === 'box').sort((a, b) => Math.max(b.hx, b.hz) - Math.max(a.hx, a.hz))[0];
      if (!fw) return { skip: 'no walk' };
      const along = fw.hx > fw.hz ? Math.atan2(fw.cos, -fw.sin) : Math.atan2(fw.sin, fw.cos);
      return L.play(fw.x, fw.z, along, 0.22, 6, fw.ya);
    });
    // inside a corner tower's rooms: the store at the foot, the room at the walks, the top
    const tower = (L, lv, dist, pitch) => {
      const S = L.keepSite(r, 0), T = L.H.towers.list().filter((t) => t.S === S && t.role === 'corner')[0] || L.H.towers.list().filter((t) => t.S === S)[0];
      if (!T) return { skip: 'no tower' };
      const c = L.sw(S, T.cx, T.cz), y = S.y + T.levels[Math.min(lv, T.levels.length - 1)] + 0.02, toC = L.yawTo(c.x, c.z, S.x, S.z);
      const p = L.ahead(c.x, c.z, toC + Math.PI, Math.min(0.6, (T.RI || 2) * 0.3));
      return { ...L.play(p.x, p.z, toC, pitch, dist, y), tower: T.kind + ' ' + T.role };
    };
    D('keeps', `k${r}_tower`, (L) => tower(L, 0, 2.2, 0.35));
    D('keeps', `k${r}_room`, (L) => tower(L, 1, 2.2, 0.3));
    D('keeps', `k${r}_top`, (L) => tower(L, 2, 4.5, 0.3));
    D('keeps', `k${r}_hall`, (L) => {
      const h = L.F.halls().find((q) => q.realm === r);
      if (!h) return { skip: 'no hall' };
      const sp = h.hallSpots.table;
      const p = L.play(sp.x + (h.x - sp.x) * 0.3, sp.z + (h.z - sp.z) * 0.3, Math.atan2(sp.x - h.x, sp.z - h.z) + Math.PI, 0.3, 5);
      L.H.GAME.player.y = L.F.floorAt(L.H.GAME.player.x, L.H.GAME.player.z, L.H.GAME.player.y + 0.3);
      return p;
    });
  }
  /* ---- the temples, the musters, the hill in the middle ---- */
  for (const r of [0, 1, 2]) {
    D('sites', `temple${r}`, (L) => { const S = L.H.REALMS[r].templeSite, a = L.sw(S, 6, 30); return L.play(a.x, a.z, L.yawTo(a.x, a.z, S.x, S.z), 0.15, 7); });
    D('sites', `muster${r}`, (L) => { const S = L.H.REALMS[r].musterSite, a = L.sw(S, 10, 22); return L.play(a.x, a.z, L.yawTo(a.x, a.z, S.x, S.z), 0.18, 7); });
  }
  D('sites', 'hill', (L) => { const T = L.F.W.heroTree, a = { x: T.x + 22, z: T.z + 14 }; return L.cam(a.x, L.F.heightAt(a.x, a.z) + 3, a.z, T.x, T.y + 5, T.z); });
  /* ---- the frontier ---- */
  D('frontier', 'camp', (L) => {
    const c = L.H.CAMPS.filter((q) => q.elite).sort((a, b) => a.id - b.id)[0] || L.H.CAMPS[0], sp = L.open(c.x + 14, c.z, 2, 30) || { x: c.x + 14, z: c.z };
    return { ...L.play(sp.x, sp.z, L.yawTo(sp.x, sp.z, c.x, c.z), 0.2, 7), camp: c.type };
  });
  D('frontier', 'camp2', (L) => {
    const c = L.H.CAMPS.filter((q) => !q.elite && (q.type === 'outlaw' || q.type === 'bandit')).sort((a, b) => a.id - b.id)[0] || L.H.CAMPS[1], sp = L.open(c.x - 12, c.z + 6, 2, 30) || { x: c.x - 12, z: c.z };
    return { ...L.play(sp.x, sp.z, L.yawTo(sp.x, sp.z, c.x, c.z), 0.2, 7), camp: c.type };
  });
  // the bandit camp whose tents stood round a tree's trunk (until [look] turned them off it: 05d_fire.js)
  D('frontier', 'tents', (L) => {
    const c = L.H.CAMPS.filter((q) => q.type === 'bandit').sort((a, b) => Math.hypot(a.x + 15.5, a.z - 422) - Math.hypot(b.x + 15.5, b.z - 422))[0];
    if (!c) return { skip: 'no bandit camp' };
    const a = 2.2, sp = { x: c.x + Math.sin(a) * 11, z: c.z + Math.cos(a) * 11 };
    L.hush(c.x, c.z, 25);
    return { ...L.cam(sp.x, L.F.heightAt(sp.x, sp.z) + 4.5, sp.z, c.x, L.F.heightAt(c.x, c.z) + 0.6, c.z), camp: [+c.x.toFixed(1), +c.z.toFixed(1)] };
  });
  D('frontier', 'road', (L) => { const p = L.rp(0, 194, 20), t = L.rp(0, 150, 26); return L.play(p.x, p.z, L.yawTo(p.x, p.z, t.x, t.z), 0.16, 7); });
  D('frontier', 'pass', (L) => { const p = L.rp(1, 270, 0), t = L.rp(1, 230, 0); return L.play(p.x, p.z, L.yawTo(p.x, p.z, t.x, t.z), 0.14, 7); });
  D('frontier', 'battle', (L) => {
    const H = L.H; let best = null, bn = -1;
    for (const e of H.ENT) {
      if (!e.alive || (e.role !== 'soldier' && e.role !== 'guard') || !(e.combatUntil > H.GAME.t)) continue;
      let n = 0; for (const o of H.ENT) if (o.alive && o.kind !== 'door' && Math.abs(o.x - e.x) < 25 && Math.abs(o.z - e.z) < 25) n++;
      if (n > bn) { bn = n; best = e; }
    }
    if (!best) return { skip: 'no fight' };
    const a = Math.atan2(best.x, best.z), sp = { x: best.x + Math.sin(a) * 12, z: best.z + Math.cos(a) * 12 };
    return { ...L.cam(sp.x, L.F.heightAt(sp.x, sp.z) + 4, sp.z, best.x, best.y + 1, best.z), n: bn };
  });
  /* ---- the land ---- */
  D('nature', 'forest', (L) => {
    const H = L.H, F = L.F; let best = null, bv = -1;
    for (let x = -440; x <= 440; x += 16) for (let z = -440; z <= 440; z += 16) {
      if (!F.isWalkable(x, z) || H.perf.SITES.some((s) => Math.hypot(s.x - x, s.z - z) < (s.r || 20) + 30)) continue;
      let v = 0; for (let k = 0; k < 9; k++) v += H.visual.canopy(x + (k % 3 - 1) * 8, z + (Math.floor(k / 3) - 1) * 8);
      if (v > bv) { bv = v; best = { x, z }; }
    }
    const sp = L.open(best.x, best.z, 1.5, 20) || best;
    return L.play(sp.x, sp.z, 0.7, 0.2, 7);
  });
  D('nature', 'forest_edge', (L) => {
    const T = L.F.W.trees; let best = null, bn = -1;
    for (let i = 0; i < T.length; i += 7) { const t = T[i]; if (Math.hypot(t.x, t.z) > 230) continue; let n = 0; for (const u of T) if (Math.abs(u.x - t.x) < 16 && Math.abs(u.z - t.z) < 16) n++; if (n > bn) { bn = n; best = t; } }
    const sp = L.open(best.x + 26, best.z, 6, 60) || { x: best.x + 26, z: best.z };
    return L.eye(sp.x, sp.z, best.x, best.y + 4, best.z, 1.8);
  });
  D('nature', 'meadow', (L) => {
    const F = L.F, W = F.W, R = L.H.REALMS[1];
    for (let k = 0; k < 4000; k++) {
      const a = k * 2.4, rr = 6 + k * 0.05, x = R.musterSite.x + Math.sin(a) * rr * 2, z = R.musterSite.z + Math.cos(a) * rr * 2;
      if (!F.isWalkable(x, z) || F.sampleGrid(W.grass, x, z) < 0.8 || F.sampleGrid(W.road, x, z) > 0.02) continue;
      if (W.trees.some((t) => Math.abs(t.x - x) < 10 && Math.abs(t.z - z) < 10)) continue;
      return L.eye(x, z, x + 10, F.heightAt(x + 10, z + 4) + 0.4, z + 4, 1.4);
    }
    return { skip: 'no meadow' };
  });
  D('water', 'river', (L) => {
    const Rv = L.H.water.RIVERS.find((q) => q.realm === 0) || L.H.water.RIVERS[0], pts = Rv.pts, i = Math.floor(pts.length * 0.55), a = pts[i], b = pts[i + 1];
    const tx = b.x - a.x, tz = b.z - a.z, l = Math.hypot(tx, tz) || 1, nx = -tz / l, nz = tx / l, hw = (a.hw || a.w || 4);
    return L.play(a.x + nx * (hw + 5), a.z + nz * (hw + 5), Math.atan2(-nx * 0.6 + tx / l, -nz * 0.6 + tz / l), 0.18, 7);
  });
  D('water', 'lake', (L) => {
    const Lk = L.H.dbg.LAKES[2], F = L.F; let p = null;
    for (let k = 0; k < 24 && !p; k++) { const a = k * Math.PI / 12, x = Lk.x + Math.sin(a) * (Lk.r + 10), z = Lk.z + Math.cos(a) * (Lk.r + 10); if (F.isWalkable(x, z) && !L.H.water.waterAt(x, z)) p = { x, z }; }
    if (!p) return { skip: 'no shore' };
    return L.play(p.x, p.z, L.yawTo(p.x, p.z, Lk.x, Lk.z), 0.2, 7);
  });
  D('water', 'pond', (L) => {
    const P = L.H.water.PONDS.slice().sort((a, b) => (b.area || b.n || 0) - (a.area || a.n || 0))[0];
    if (!P) return { skip: 'no pond' };
    const cx = P.x ?? P.cx, cz = P.z ?? P.cz, sp = L.open(cx + 16, cz, 1.5, 40) || { x: cx + 16, z: cz };
    return L.play(sp.x, sp.z, L.yawTo(sp.x, sp.z, cx, cz), 0.25, 7);
  });
  D('water', 'under', (L) => {
    const Lk = L.H.dbg.LAKES[0], F = L.F, H = L.H;
    const wy = H.water.waterAt(Lk.x, Lk.z); if (!wy) return { skip: 'no water' };
    // the camera a metre and a half under the surface, looking across the bed toward the shore
    return L.cam(Lk.x, wy.y - 1.6, Lk.z, Lk.x + 14, wy.y - 2.6, Lk.z + 6);
  });
  D('water', 'swim', (L) => {
    const Lk = L.H.dbg.LAKES[1], H = L.H, P = H.GAME.player, x = Lk.x + Lk.r * 0.4, z = Lk.z;
    const w = H.water.waterAt(x, z); if (!w) return { skip: 'no water' };
    const r = L.play(x, z, 0.4, 0.2, 6, w.y - 1.3); L.settle(0.8); H.look(0.4, 0.2, 6); return r;
  });
  /* ---- the mountains ---- */
  D('mountains', 'orchard', (L) => { const o = L.H.surv.FORAGE.orchard, R = L.H.REALMS[0]; return L.play(o.x, o.z, R.bearing + Math.PI - 0.55 + Math.PI, 0.02, 6); });
  D('mountains', 'crag', (L) => {
    const C = L.H.mtn.MTN.crags, F = L.F; let best = null, bs = 0;
    for (const c of C) { if (c.kind > 3) continue; for (let a = -0.8; a <= 0.8; a += 0.2) for (let d = c.r + 4; d < c.r + 26; d += 2) {
      const x = c.x + Math.sin(c.yaw + a) * d, z = c.z + Math.cos(c.yaw + a) * d; if (!F.isWalkable(x, z)) continue;
      if (F.W.trees.some((t) => Math.abs(t.x - x) < 6 && Math.abs(t.z - z) < 6)) continue;
      const sc = c.h * c.w / d; if (sc > bs) { bs = sc; best = { x, z, c }; } break; } }
    const b = best; return L.eye(b.x, b.z, b.c.x, b.c.y0 + b.c.h * 0.6, b.c.z);
  });
  D('mountains', 'range', (L) => { const p = L.rp(0, 88, 64), y = L.F.heightAt(p.x, p.z) + 3.5, t = L.rp(2, 250, -60); return L.cam(p.x, y, p.z, t.x, 22, t.z); });
  /* ---- bodies ---- */
  for (const r of [0, 1, 2]) {
    D('bodies', `people${r}`, (L) => {
      const sp = L.open(L.H.REALMS[r].musterSite.x + 30, L.H.REALMS[r].musterSite.z, 6, 80);
      if (!sp) return { skip: 'no room' };
      L.hush(sp.x, sp.z, 20);
      const face = 0.3;
      L.lineUp([[r, 'warrior'], [r, 'archer'], [r, 'mage'], [r, 'priest']], sp.x, sp.z, face, 1.3);
      L.settle(0.8);
      for (const e of L.made) e.yaw = face;
      const c = L.ahead(sp.x, sp.z, face, 4.6);
      return L.eye(c.x, c.z, sp.x, L.F.heightAt(sp.x, sp.z) + 1.0, sp.z, 1.6);
    });
  }
  D('bodies', 'beasts', (L) => {
    const sp = L.open(L.H.REALMS[2].musterSite.x + 34, L.H.REALMS[2].musterSite.z, 8, 90);
    if (!sp) return { skip: 'no room' };
    L.hush(sp.x, sp.z, 24);
    const face = 0.3, lx = Math.cos(face), lz = -Math.sin(face);
    // the camps' own beasts, as the camps make them (their looks and sizes), held still
    ['wolf', 'boar', 'bear'].forEach((k, i) => {
      const off = (i - 1.5) * 2.6, x = sp.x + lx * off, z = sp.z + lz * off;
      const e = L.F.spawnMob({ id: -1, type: k, x, z, r: 0.01, lmin: 12, lmax: 12, members: new Set() });
      e.x = e.prevX = x; e.z = e.prevZ = z; e.yaw = face + Math.PI / 2; e.role = 'test'; e.testLook = true; L.made.push(e);
    });
    L.beast('deer', sp.x + lx * 4.2, sp.z + lz * 4.2, face + Math.PI / 2, { cols: [[0.5, 0.36, 0.22], [0.3, 0.2, 0.12]] });
    L.settle(0.5);
    const c = L.ahead(sp.x, sp.z, face, 7);
    return L.eye(c.x, c.z, sp.x, L.F.heightAt(sp.x, sp.z) + 0.8, sp.z, 1.7);
  });
  D('bodies', 'farmbeasts', (L) => {
    const T0 = L.H.REALMS[0].town, sp = L.open(T0.x - 30, T0.z - 50, 8, 90);
    if (!sp) return { skip: 'no room' };
    L.hush(sp.x, sp.z, 24);
    const face = 0.3, lx = Math.cos(face), lz = -Math.sin(face);
    ['horse', 'cattle', 'sheep', 'pig', 'hen', 'hound'].forEach((k, i) => { const off = (i - 2.5) * 2.0; L.beast(k, sp.x + lx * off, sp.z + lz * off, face + Math.PI / 2); });
    L.settle(0.5);
    const c = L.ahead(sp.x, sp.z, face, 7.5);
    return L.eye(c.x, c.z, sp.x, L.F.heightAt(sp.x, sp.z) + 0.7, sp.z, 1.7);
  });
  D('bodies', 'mounted', (L) => {
    const H = L.H, P = H.GAME.player, sp = L.open(L.rp(0, 194, -40).x, L.rp(0, 194, -40).z, 5, 60);
    const r = L.play(sp.x, sp.z, 1.0, 0.18, 7);
    L.F.mountUp(P, true);
    P.x = P.prevX = sp.x; P.z = P.prevZ = sp.z; L.settle(0.3); H.UI.modal = null; H.CAM.mode = 'play'; H.look(1.0, 0.18, 7);
    return { ...r, mounted: !!P.mount };
  });
  D('bodies', 'fight', (L) => {
    const sp = L.open(L.H.REALMS[1].musterSite.x + 30, L.H.REALMS[1].musterSite.z - 20, 7, 90);
    if (!sp) return { skip: 'no room' };
    L.hush(sp.x, sp.z, 30);
    const F = L.F, mk = (realm, cls, dx, dz, yaw) => { const e = F.spawnRealmUnit(realm, cls, 30, 'guard', sp.x + dx, sp.z + dz, { yaw }); e.ai.post = { x: e.x, z: e.z, leash: 8 }; L.made.push(e); return e; };
    mk(0, 'warrior', -1.2, 0, Math.PI / 2); mk(1, 'warrior', 1.2, 0, -Math.PI / 2); mk(0, 'mage', -6, 2, Math.PI / 2); mk(1, 'archer', 7, -2, -Math.PI / 2); mk(2, 'priest', 0, 5, Math.PI);
    L.settle(2.4);
    for (const e of L.made) e.hp = e.maxHp;
    return L.eye(sp.x, sp.z - 7.5, sp.x, L.F.heightAt(sp.x, sp.z) + 1.0, sp.z, 2.2);
  });
  D('bodies', 'townsfolk', (L) => {
    const S = L.H.REALMS[1].town, H = L.H;
    const folk = H.ENT.filter((e) => e.alive && (e.role === 'villager' || e.role === 'townsman' || e.role === 'farmer') && Math.hypot(e.x - S.x, e.z - S.z) < 60);
    if (!folk.length) return { skip: 'no townsfolk' };
    const e = folk[0], c = L.ahead(e.x, e.z, (e.yaw || 0), 4.5);
    return { ...L.eye(c.x, c.z, e.x, e.y + 1.1, e.z, 1.7), n: folk.length };
  });
  // the player half way up a corner tower's ladder (hand over hand, body action 14), the camera inside the drum
  D('bodies', 'climb', (L) => {
    const H = L.H, P = H.GAME.player, S = L.keepSite(0, 0), T = H.towers.list().find((t) => t.S === S && t.role === 'corner');
    const Ld = T && T.ladders[0];
    if (!Ld) return { skip: 'no ladder' };
    L.play(Ld.fx, Ld.fz, P.yaw, 0.15, 3.2, Ld.wyb);
    H.towers.towerClimb(P, Ld, 1);
    const m = P.motion; H.UI.modal = null; H.simulate(Math.min(1.6, m.dur * 0.5)); H.UI.modal = null;
    H.CAM.mode = 'play'; H.look(P.yaw + Math.PI * 0.8, 0.1, 3.2);
    return { climbing: !!P.motion, y: +(P.y - S.y).toFixed(2) };
  });
  /* ---- the barrow and the dragon ---- */
  D('barrow', 'barrow', (L) => {
    const H = L.H, F = L.F, P = H.GAME.player, p = H.DUN.spots.arrive;
    P.x = P.prevX = p.x; P.z = P.prevZ = p.z; P.y = F.dunFloorAt(p.x, p.z); P.yaw = Math.PI / 2;
    F.setIndoor(true); H.CAM.mode = 'play'; H.UI.modal = null; H.look(Math.PI / 2, 0.3, 6);
    L.afterIndoor = true;
    return { at: [p.x, p.z] };
  });
  D('dragon', 'dragon', (L) => {
    const H = L.H, Dg = H.dbg.DRAGON, e = Dg.e;
    if (!e || !e.alive) return { skip: 'no dragon' };
    return { ...L.cam(e.x + 26, e.y + 6, e.z + 18, e.x, e.y + 2, e.z), state: Dg.state };
  });
  // leaving the Barrow after its view
  const set0 = LK.set;
  LK.set = function (name, variant) {
    if (this.afterIndoor && name !== 'barrow') { this.F.setIndoor(false); this.afterIndoor = false; }
    return set0.call(this, name, variant);
  };
})();
// [look2] (version 13) what version 12's look left, and what version 12 added (arrows in the walls, breached and mended
// towers, the burnt log tower, the Charge's rush), each from a fixed camera
(function () {
  const LK = window.LK, D = (g, n, f) => LK.def(g, n, f);
  // a narrower lens for a view that looks at one thing far off (put back before the next view)
  LK.fov = function (deg) { const c = this.H.camera; if (this.fov0 == null) this.fov0 = c.fov; c.fov = deg; c.updateProjectionMatrix(); };
  const set1 = LK.set;
  LK.set = function (name, variant) {
    if (this.fov0 != null) { this.H.camera.fov = this.fov0; this.H.camera.updateProjectionMatrix(); this.fov0 = null; }
    const r = set1.call(this, name, variant);
    this.unborn();
    return r;
  };
  // __hm.simulate runs the particles' clock (uTime) on ahead of the frames' (see CLAUDE.md, Gotchas): what a view's
  // simulation emitted (the dust of a siege stone, smoke) would show later, frozen in the air. Let it go, as walls.py does
  LK.unborn = function () {
    const H = this.H; H.frame(1 / 30);
    const now = H.dbg.U.uTime.value, fx = H.walls && H.walls.fx;
    if (!fx) return 0;
    for (const P of [fx.fxAlpha, fx.fxAdd]) {
      if (!P || !P.a0) continue;
      const a0 = P.a0.array, a1 = P.a1.array; let k = 0;
      for (let i = 0; i < P.max; i++) if (a0[i * 4 + 3] > now + 1e-3 && a1[i * 4 + 3] > 0) { a1[i * 4 + 3] = -1; k++; }
      if (k) { P.dirty0 = 0; P.dirty1 = P.max - 1; }
    }
    return 0;
  };
  // the player stands at (x, z) out of the way, a frame drawn so what is drawn by distance knows the camera
  LK.away = function (x, z) { const P = this.H.GAME.player; P.x = P.prevX = x; P.z = P.prevZ = z; P.y = this.F.heightAt(x, z); P.motion = null; P.hp = P.maxHp; };
  // a hound and a priest by the hearth inside a Logres house: beasts lit by the room as people are
  D('look2', 'hound_in', (L) => {
    const H = L.H, F = L.F, h = L.house(0, 1, false), D0 = h.door;
    F.setHouseDoor && F.setHouseDoor(h, true);
    const dx = h.x - D0.out.x, dz = h.z - D0.out.z, dl = Math.hypot(dx, dz) || 1, ux = dx / dl, uz = dz / dl;
    const p = { x: D0.in.x + ux * 1.7, z: D0.in.z + uz * 1.7 }, y = F.floorAt(p.x, p.z, h.y + 0.6);
    L.hush(h.x, h.z, 9);
    const hd = L.beast('hound', p.x + uz * 0.55, p.z - ux * 0.55, Math.atan2(-uz, ux));
    const pr = F.spawnRealmUnit(0, 'priest', 30, 'guard', p.x - uz * 0.55, p.z + ux * 0.55, { yaw: Math.atan2(-ux, -uz) });
    pr.ai.post = { x: pr.x, z: pr.z, leash: 0.3 }; pr.testLook = true; L.made.push(pr);
    L.settle(0.4);
    for (const e of [hd, pr]) { e.y = F.floorAt(e.x, e.z, y + 0.3); e.prevY = e.y; }
    pr.yaw = Math.atan2(-ux, -uz);
    const c = { x: D0.in.x - ux * 0.2, z: D0.in.z - uz * 0.2 };
    L.away(h.x + 30, h.z + 30);
    return { ...L.cam(c.x, y + 1.55, c.z, p.x, y + 0.55, p.z), house: h.num };
  });
  // a lone oak whose crown stands in the band where the near trees take over from the far ones (42 m at high, 28 at
  // medium): the hand-over
  D('look2', 'handover', (L) => {
    const H = L.H, F = L.F, R = H.quality.nearTrees || 28, T = F.W.trees;
    for (const t of T) {
      if (t.kind !== 'oak' || t.gone || t.felled || (t.s || 1) < 1.0 || Math.hypot(t.x, t.z) > 330) continue;
      if (T.some((u) => u !== t && Math.abs(u.x - t.x) < 10 && Math.abs(u.z - t.z) < 10)) continue;
      for (let a = 0; a < 6.28; a += 0.4) {
        const d = R - 1.7, x = t.x + Math.sin(a) * d, z = t.z + Math.cos(a) * d;
        if (!F.isWalkable(x, z) || H.water.waterAt(x, z)) continue;
        if (T.some((u) => u !== t && Math.hypot(u.x - (x + t.x) / 2, u.z - (z + t.z) / 2) < d * 0.55)) continue;
        L.fov(24); L.away(x + Math.sin(a) * 40, z + Math.cos(a) * 40);
        return { ...L.eye(x, z, t.x, t.y + 4.4 * (t.s || 1), t.z, 1.7), tree: [+t.x.toFixed(1), +t.z.toFixed(1)], R };
      }
    }
    return { skip: 'no lone oak' };
  });
  // the apple trees of the Logres orchard and their shade on the grass (bare in winter: a thin shade)
  D('look2', 'apples', (L) => {
    const H = L.H, o = H.surv.FORAGE.orchard, ap = H.surv.FORAGE.list.filter((q) => q.k === 'apple' && !q.gone && !q.cut);
    if (!ap.length) return { skip: 'no apple trees' };
    ap.sort((a, b) => Math.hypot(a.x - o.x, a.z - o.z) - Math.hypot(b.x - o.x, b.z - o.z));
    const a = ap[0], c = { x: a.x + 6.5, z: a.z - 5.0 };
    L.hush(a.x, a.z, 20); L.away(a.x + 40, a.z + 40);
    return { ...L.cam(c.x, L.F.heightAt(c.x, c.z) + 5.2, c.z, a.x - 1.0, L.F.heightAt(a.x, a.z) + 0.6, a.z + 1.5), tree: [+a.x.toFixed(1), +a.z.toFixed(1)] };
  });
  // the climber from the side: he climbs between the ladder and the wall, facing the room, so what he carried hangs on
  // his back between him and the wall (0.8 to 0.9 m of room there), seen in profile from the side
  D('look2', 'climb_back', (L) => {
    const r = L.views.climb.call(L, L); if (r && r.skip) return r;
    const H = L.H, P = H.GAME.player, S = L.keepSite(0, 0), T = H.towers.list().find((t) => t.S === S && t.role === 'corner');
    const dx = T.wx - P.x, dz = T.wz - P.z, d = Math.hypot(dx, dz) || 1, ux = dx / d, uz = dz / d;
    return { ...r, ...L.cam(P.x + uz * 1.45 + ux * 0.55, P.y + 1.45, P.z - ux * 1.45 + uz * 0.55, P.x - ux * 0.15, P.y + 1.1, P.z - uz * 0.15) };
  });
  // the town from far off: the footpaths from the doors to the plaza
  for (const r of [0, 1, 2]) {
    D('look2', `t${r}_paths`, (L) => {
      const S = L.H.REALMS[r].town, R = L.H.REALMS[r], p = { x: S.x - R.dx * 70 - R.px * 36, z: S.z - R.dz * 70 - R.pz * 36 };
      L.away(S.x + R.dx * 80, S.z + R.dz * 80);
      return L.cam(p.x, L.F.heightAt(p.x, p.z) + 24, p.z, S.x, L.F.heightAt(S.x, S.z), S.z);
    });
  }
  /* ---- what version 12 added ---- */
  const arrowsAt = (L, at, n, spread, from) => {
    const H = L.H, P = H.GAME.player;
    L.away(from.x, from.z); H.UI.modal = null;
    for (let i = 0; i < n; i++) {
      const tg = at(i);
      P.yaw = Math.atan2(tg.x - P.x, tg.z - P.z); H.CAM.yaw = P.yaw;
      H.CAM.pitch = 0.3 - Math.atan2(tg.y - (P.y + 1.5), Math.hypot(tg.x - P.x, tg.z - P.z));
      H.cls.looseArrow(P, 1, null, 0); H.simulate(0.3);
    }
    H.simulate(1.5); H.UI.modal = null;
  };
  // arrows stuck in a Logres house's plaster and timbers
  D('look2', 'stuck_house', (L) => {
    const H = L.H, all = H.HOUSES.filter((q) => !q.keepHall && q.style === 'stone' && q.state === 'whole' && !q.round);
    const Hs = all.find((q) => q.d > 6.5) || all[0];
    if (!Hs) return { skip: 'no house' };
    const at = (lx, lz, ly) => ({ x: Hs.x + lx * Hs.c + lz * Hs.s, y: Hs.y + ly, z: Hs.z - lx * Hs.s + lz * Hs.c });
    if (!L.stuckHouse) {
      L.hush(Hs.x, Hs.z, 25);
      arrowsAt(L, (i) => at(Hs.w / 2, -1.6 + (i % 4) * 1.05 + Math.sin(i * 2.3) * 0.25, 0.9 + (i / 4 | 0) * 0.55 + Math.cos(i * 1.7) * 0.15), 12, 0, at(Hs.w / 2 + 9, 0, 0));
      L.stuckHouse = true;
    }
    L.away(Hs.x + 30, Hs.z + 30);
    const c = at(Hs.w / 2 + 2.8, 3.2, 1.7), t = at(Hs.w / 2, -0.2, 1.4);
    return { ...L.cam(c.x, c.y, c.z, t.x, t.y, t.z), stuck: H.walls.WALLS.stuck.length };
  });
  // arrows in a Thule keep's palisade of logs, and those that glanced off a Logres curtain lying at its foot
  D('look2', 'stuck_logs', (L) => {
    const H = L.H, S = L.keepSite(2, 0), a = L.sw(S, 4, 30), wl = (lx, ly) => { const p = L.sw(S, lx, 14.2); return { x: p.x, y: S.y + ly, z: p.z }; };
    if (!L.stuckLogs) { L.hush(S.x, S.z, 45); arrowsAt(L, (i) => wl(-3 + (i % 5) * 1.3, 1.2 + (i / 5 | 0) * 0.7), 10, 0, a); L.stuckLogs = true; }
    L.away(S.x + 60, S.z + 60);
    const c = L.sw(S, 3.5, 19.5), t = wl(0, 1.5);
    return { ...L.cam(c.x, S.y + 2.1, c.z, t.x, t.y, t.z), stuck: H.walls.WALLS.stuck.length };
  });
  D('look2', 'glance', (L) => {
    const H = L.H, S = L.keepSite(0, 1), a = L.sp ? null : null, sp = (lx, lz, ly) => { const p = L.sw(S, lx, lz); return { x: p.x, y: S.y + ly, z: p.z }; };
    if (!L.glanced) { L.hush(S.x, S.z, 50); arrowsAt(L, (i) => sp(-6 + (i % 5) * 1.1, -14.4, 1.2 + (i / 5 | 0) * 0.6), 10, 0, sp(-3, -24, 0)); H.simulate(2); L.glanced = true; }
    L.away(S.x + 60, S.z - 60);
    const c = sp(1.8, -21.0, 1.6), t = sp(-3.6, -15.6, 0.2);
    return { ...L.cam(c.x, c.y, c.z, t.x, t.y, t.z), glanced: H.walls.WALLS.stats.glanced };
  });
  // a Logres corner tower brought down into a breach by the stones, from the field and from the courtyard
  const breached = (L) => {
    const H = L.H, F = L.F, S = L.keepSite(0, 0), C = F.castles().find((q) => q.S === S);
    const W = C.sections.find((q) => q.kind === 'tower' && q.T.role === 'corner' && q.T.sx === -1 && q.T.sz === -1), T = W.T;
    S.keepRef.lastEnemyNear = H.GAME.t + 1e6;
    if (W.state === 'whole') {
      const src = F.spawnRealmUnit(2, 'warrior', S.x + W.ox * 60, S.z + W.oz * 60, {}); src.hp = src.maxHp = 1e9;
      const p = { x: T.wx + W.ox * (T.RO + 0.2), z: T.wz + W.oz * (T.RO + 0.2) };
      for (let n = 0; W.state === 'whole' && n < 80; n++) F.castleSiegeHit(src, p.x, p.z, 2.0, 4.4);
      F.removeEnt(src); L.settle(3);
    }
    return { S, C, W, T, tp: (a, r, y) => { const q = F.siteToWorld(S, T.cx + Math.sin(a) * r, T.cz + Math.cos(a) * r); return { x: q.x, y: S.y + y, z: q.z }; } };
  };
  D('look2', 'breach', (L) => {
    const B = breached(L), c = B.tp(B.W.aOut + 0.55, B.T.RO + 15, 5.2), t = B.tp(B.W.aOut, 0, 4.0);
    L.away(c.x + 40, c.z + 40);
    return { ...L.cam(c.x, c.y, c.z, t.x, t.y, t.z), state: B.W.state };
  });
  D('look2', 'breach_in', (L) => {
    // from the courtyard: the first open spot on the way from the tower to the keep's middle, out of the hall
    const B = breached(L), F = L.F, S = B.S, T = B.T;
    let c = null;
    for (let d = T.RO + 5; d < T.RO + 16 && !c; d += 0.5) for (const da of [0, 0.25, -0.25, 0.5, -0.5]) {
      const a = Math.atan2(S.x - T.wx, S.z - T.wz) + da, x = T.wx + Math.sin(a) * d, z = T.wz + Math.cos(a) * d;
      if (F.houseAt(x, z, 0.8) || !F.isWalkable(x, z) || Math.abs(F.floorAt(x, z, F.heightAt(x, z) + 0.3) - F.heightAt(x, z)) > 0.2) continue;
      c = { x, y: F.heightAt(x, z) + 2.0, z }; break;
    }
    if (!c) return { skip: 'no open court' };
    const t = B.tp(B.W.aOut, 0.5, 1.6);
    L.away(c.x + 40, c.z + 40);
    return { ...L.cam(c.x, c.y, c.z, t.x, t.y, t.z), state: B.W.state };
  });
  D('look2', 'mend', (L) => {
    const H = L.H, B = breached(L), S = B.S, W = B.W;
    S.keepRef.lastEnemyNear = -1e9;
    for (let i = 0; i < 12 && W.state !== 'whole' && !(W.state === 'repair' && W.t > 0.45); i++) { L.settle(10); S.keepRef.lastEnemyNear = -1e9; }
    const c = B.tp(W.aOut - 0.5, B.T.RO + 14, 6.0), t = B.tp(W.aOut, 0, 4.5);
    L.away(c.x + 40, c.z + 40);
    return { ...L.cam(c.x, c.y, c.z, t.x, t.y, t.z), state: W.state, t: +(W.t || 0).toFixed(2) };
  });
  // the Thule keep's log tower burnt and fallen in, its char smouldering
  D('look2', 'charred', (L) => {
    const H = L.H, TF = H.towerfire, T = TF.list().find((q) => q.role === 'corner' && q.sx === 1 && q.sz === 1) || TF.list()[0];
    if (!T) return { skip: 'no log tower' };
    const S = T.S;
    S.keepRef.lastEnemyNear = H.GAME.t + 1e6; // (not built again while the views look at it)
    if (!T.fallen) { L.hush(S.x, S.z, 45); TF.towerIgnite(T, 3); H.UI.modal = null; H.simulate(TF.TFIRE.burn + 1); S.keepRef.lastEnemyNear = H.GAME.t + 1e6; H.simulate(4); H.UI.modal = null; }
    const tp = (a, r, y) => { const q = L.F.siteToWorld(S, T.cx + Math.sin(a) * r, T.cz + Math.cos(a) * r); return { x: q.x, y: S.y + y, z: q.z }; };
    // from the field outside the corner (inside the court the camera stood under the palisade's sharpened tips, and their
    // undersides read as a twisted column rising out of the shaft)
    const aO = Math.atan2(T.cx, T.cz), c = tp(aO + 0.45, T.RO + 14, 3.6), t = tp(aO, 0, 6.5);
    L.away(S.x + 60, S.z + 60);
    return { ...L.cam(c.x, c.y, c.z, t.x, t.y, t.z), fallen: !!T.fallen, ember: T.fallen ? +T.fallen.ember.toFixed(2) : null };
  });
  // bodies near the camera on the move (13r_motion.js drives them as motion.py does): a horse at a gallop, a wolf at a
  // trot, a soldier running, caught mid-stride from abreast
  D('look2', 'gaits', (L) => {
    const H = L.H, F = L.F, M = H.motion, sp = L.open(H.REALMS[2].musterSite.x + 34, H.REALMS[2].musterSite.z + 10, 10, 90);
    if (!sp) return { skip: 'no room' };
    L.hush(sp.x, sp.z, 45);
    const hr = L.beast('horse', sp.x - 18, sp.z - 3, Math.PI / 2), wf = L.beast('wolf', sp.x - 10, sp.z + 0.5, Math.PI / 2);
    const so = F.spawnRealmUnit(2, 'warrior', 30, 'guard', sp.x - 9, sp.z + 3.5, { yaw: Math.PI / 2 }); so.ai.post = null; so.testLook = true; so.role = 'test'; L.made.push(so);
    const drive = (v) => (e, t, dt) => { e.x += v * Math.min(1, t / 0.4) * dt; e.yaw = Math.PI / 2; };
    H.UI.modal = null;
    M.motionRun([{ e: hr, kind: 'beast', drive: drive(11) }, { e: wf, kind: 'beast', drive: drive(3.2) }, { e: so, kind: 'human', drive: drive(5.0) }], 1.45, 1 / 60);
    H.UI.modal = null;
    const mx = (hr.x + wf.x + so.x) / 3;
    L.away(sp.x + 60, sp.z + 60);
    return { ...L.eye(mx - 1.5, sp.z - 8.5, mx, F.heightAt(mx, sp.z) + 0.8, sp.z, 1.4), at: [+hr.x.toFixed(1), +wf.x.toFixed(1), +so.x.toFixed(1)] };
  });
  // a warrior's Charge: the rush across the turf at a mage, shield forward, dust kicked up
  D('look2', 'rush', (L) => {
    const H = L.H, F = L.F, sp = L.open(H.REALMS[1].musterSite.x + 30, H.REALMS[1].musterSite.z - 20, 9, 90);
    if (!sp) return { skip: 'no room' };
    L.hush(sp.x, sp.z, 40);
    const w = F.spawnRealmUnit(0, 'warrior', 30, 'guard', sp.x - 8, sp.z, { yaw: Math.PI / 2 }), m = F.spawnRealmUnit(1, 'mage', 30, 'guard', sp.x + 8, sp.z, { yaw: -Math.PI / 2 });
    for (const e of [w, m]) { e.ai.post = { x: e.x, z: e.z, leash: 0.5 }; e.hp = e.maxHp = 1e6; L.made.push(e); }
    H.bal4.chargeRush(w, H.ABILITIES.charge, m, 1);
    H.UI.modal = null; H.simulate(0.35); H.UI.modal = null;
    L.away(sp.x + 50, sp.z + 50);
    return { ...L.eye(sp.x - 2, sp.z - 7.5, w.x + 1.0, F.heightAt(w.x, w.z) + 0.9, w.z, 1.6), rushing: !!(w.motion && w.motion.rush), x: +(w.x - sp.x).toFixed(1) };
  });
})();
// [look3] (version 14) what version 13's look left and what version 13 added, each from a fixed camera
(function () {
  const LK = window.LK, D = (g, n, f) => LK.def(g, n, f);
  const castleOf = (L, r, k) => { const S = L.keepSite(r, k); return { S, C: L.F.castles().find((q) => q.S === S) }; };
  // wear a section with light stones until it is worn to k (not breached), its keep kept from building it back
  LK.wear = function (C, W, k) {
    const F = this.F, H = this.H, S = C.S, K = S.keepRef;
    if (K) K.lastEnemyNear = H.GAME.t + 1e6;
    if (W.state !== 'whole' || W.wear >= k) return W.wear;
    const src = F.spawnRealmUnit(((K ? K.realm : 0) + 1) % 3, 'warrior', 30, 'guard', S.x + 90, S.z + 90, {}); src.hp = src.maxHp = 1e9;
    const p = W.kind === 'tower' ? { x: W.T.wx + W.ox * (W.T.RO + 0.2), z: W.T.wz + W.oz * (W.T.RO + 0.2) } : { x: W.wx, z: W.wz };
    for (let n = 0; W.state === 'whole' && W.wear < k && n < 400; n++) F.castleSiegeHit(src, p.x, p.z, 0.4, 0.15);
    F.removeEnt(src);
    return W.wear;
  };
  // the side of a curtain section away from its keep's middle: a point `out` m from its face, `up` m high
  const outside = (L, C, W, out, along, up) => {
    const S = C.S; let ox = -W.waz, oz = W.wax;
    if ((W.wx + ox - S.x) ** 2 + (W.wz + oz - S.z) ** 2 < (W.wx - S.x) ** 2 + (W.wz - S.z) ** 2) { ox = -ox; oz = -oz; }
    return { x: W.wx + ox * (W.across + out) + W.wax * along, y: S.y + up, z: W.wz + oz * (W.across + out) + W.waz * along };
  };
  // a Logres curtain worn by stones: its cracks up close and from the field
  D('look3', 'crack_curtain', (L) => {
    const { C } = castleOf(L, 0, 1), W = C.sections.find((q) => q.kind === 'stone');
    const k = L.wear(C, W, 0.8);
    L.hush(W.wx, W.wz, 30);
    const c = outside(L, C, W, 4.2, 1.2, 1.9), t = outside(L, C, W, 0, -0.6, 2.6);
    L.away(C.S.x + 60, C.S.z + 60);
    return { ...L.cam(c.x, c.y, c.z, t.x, t.y, t.z), wear: +k.toFixed(2) };
  });
  D('look3', 'crack_curtain_far', (L) => {
    const { C } = castleOf(L, 0, 1), W = C.sections.find((q) => q.kind === 'stone');
    L.wear(C, W, 0.8);
    const c = outside(L, C, W, 15, 7, 3.0), t = outside(L, C, W, 0, 0, 3.0);
    L.away(C.S.x + 60, C.S.z + 60);
    return L.cam(c.x, c.y, c.z, t.x, t.y, t.z);
  });
  // a Logres corner tower worn by stones (not yet breached), from the field
  D('look3', 'crack_tower', (L) => {
    const { S, C } = castleOf(L, 0, 1), W = C.sections.find((q) => q.kind === 'tower' && q.T.role === 'corner' && q.T.sx === 1 && q.T.sz === 1), T = W.T;
    const k = L.wear(C, W, 0.85);
    const tp = (a, r, y) => { const q = L.F.siteToWorld(S, T.cx + Math.sin(a) * r, T.cz + Math.cos(a) * r); return { x: q.x, y: S.y + y, z: q.z }; };
    L.hush(T.wx, T.wz, 25);
    const c = tp(W.aOut + 0.35, T.RO + 6.5, 2.4), t = tp(W.aOut, T.RO * 0.5, 3.4);
    L.away(S.x + 60, S.z + 60);
    return { ...L.cam(c.x, c.y, c.z, t.x, t.y, t.z), wear: +k.toFixed(2) };
  });
  // the mended tower's scaffold up close (look2's mend from 14 m: from 7)
  D('look3', 'scaffold_tower', (L) => {
    const r = L.views.mend.call(L, L); if (r && r.skip) return r;
    const S = L.keepSite(0, 0), C = L.F.castles().find((q) => q.S === S), W = C.sections.find((q) => q.kind === 'tower' && q.T.role === 'corner' && q.T.sx === -1 && q.T.sz === -1), T = W.T;
    const tp = (a, rr, y) => { const q = L.F.siteToWorld(S, T.cx + Math.sin(a) * rr, T.cz + Math.cos(a) * rr); return { x: q.x, y: S.y + y, z: q.z }; };
    const c = tp(W.aOut - 0.45, T.RO + 8.5, 3.2), t = tp(W.aOut + 0.15, T.RO, 4.2);
    return { ...L.cam(c.x, c.y, c.z, t.x, t.y, t.z), state: W.state, t: +(W.t || 0).toFixed(2), info: W.scafInfo };
  });
  // a Thule burh's palisade burnt through and built back: behind its scaffold, then whole with its pale new logs
  const palGap = (L, stage) => {
    const H = L.H, PLm = H.palisade, S = L.keepSite(2, 1), C = L.F.castles().find((q) => q.S === S), K = S.keepRef;
    PLm.palisadeInit();
    const P = C.pal;
    if (!L.palW) {
      L.hush(S.x, S.z, 45);
      const c1 = P.cells.find((c) => c.side === 1 && Math.abs(c.a) < 1);
      PLm.palisadeIgnite(c1, 1); c1.t = PLm.PAL_T.burn - 0.5; H.UI.modal = null; H.simulate(1.5);
      for (const c of P.cells) if (c.st === 1) { for (const f of c.fires || []) f.until = 0; c.st = 2; c.heat = 0; }
      PLm.PAL.dirty && PLm.PAL.dirty.add(P);
      L.palW = P.gaps[0]; L.palC = c1; H.UI.modal = null;
    }
    const W = L.palW;
    if (!W) return null;
    if (stage === 'repair' && W.state === 'breach') { K.lastEnemyNear = -1e9; H.UI.modal = null; for (let i = 0; i < 40 && W.state === 'breach'; i++) { H.simulate(1); K.lastEnemyNear = -1e9; } H.UI.modal = null; }
    if (stage === 'repair' && W.state === 'repair' && W.t < 0.3) { W.t = 0.35; H.UI.modal = null; H.simulate(0.5); H.UI.modal = null; }
    if (stage === 'fresh' && W.state !== 'whole') { K.lastEnemyNear = -1e9; if (W.state === 'repair') W.t = 0.995; H.UI.modal = null; for (let i = 0; i < 40 && W.state !== 'whole'; i++) { H.simulate(1); K.lastEnemyNear = -1e9; if (W.state === 'repair') W.t = Math.max(W.t, 0.995); } H.UI.modal = null; }
    K.lastEnemyNear = stage === 'fresh' ? -1e9 : H.GAME.t + 1e6;
    return { S, C, W, c: L.palC };
  };
  // a point `out` m out from a palisade cell's wall, `along` m along it (04g_burn.js's palisadeLocal)
  const palAt = (S, c, out, along) => { const a = c.a + along, o = 14.9 + out, l = c.side === 0 ? { x: a, z: -o } : c.side === 3 ? { x: a, z: o } : c.side === 1 ? { x: -o, z: a } : { x: o, z: a }; return LK.F.siteToWorld(S, l.x, l.z); };
  D('look3', 'pal_scaffold', (L) => {
    const g = palGap(L, 'repair'); if (!g) return { skip: 'no gap' };
    const { S, W, c } = g, o = palAt(S, c, 11, -5), t = palAt(S, c, 0, 0);
    L.away(S.x + 60, S.z + 60);
    return { ...L.cam(o.x, S.y + 4.2, o.z, t.x, S.y + 3.0, t.z), state: W.state, t: +(W.t || 0).toFixed(2), info: W.scafInfo };
  });
  D('look3', 'pal_fresh', (L) => {
    const g = palGap(L, 'fresh'); if (!g) return { skip: 'no gap' };
    const { S, W, c } = g, o = palAt(S, c, 11, -5), t = palAt(S, c, 0, 0);
    L.away(S.x + 60, S.z + 60);
    return { ...L.cam(o.x, S.y + 4.2, o.z, t.x, S.y + 3.0, t.z), state: W.state };
  });
  // an Eriu lookout's thatched cone burnt and fallen in on its platform, by day
  D('look3', 'cone_fallen', (L) => {
    const H = L.H, T = H.towers.TOWER.list.find((q) => q.look === 'rath' && q.role === 'lookout');
    if (!T) return { skip: 'no lookout' };
    const S = T.S; S.keepRef.lastEnemyNear = H.GAME.t + 1e6;
    if (!T.fallen) { H.towerfire.towerIgnite(T, T.TT + 2); T.burn.t = 69.5; H.UI.modal = null; H.simulate(1); H.simulate(20); H.UI.modal = null; S.keepRef.lastEnemyNear = H.GAME.t + 1e6; }
    const aO = Math.atan2(T.cx, T.cz), q = (a, r, y) => { const w = L.F.siteToWorld(S, T.cx + Math.sin(a) * r, T.cz + Math.cos(a) * r); return { x: w.x, y: S.y + y, z: w.z }; };
    const c = q(aO + 0.5, T.RO + 13, 8.5), t = q(aO, 0, 6.5);
    L.away(S.x + 60, S.z + 60);
    return { ...L.cam(c.x, c.y, c.z, t.x, t.y, t.z), fallen: !!T.fallen };
  });
  // a Logres town house cracked by a stone at its wall (and one holed from above, in the rain)
  const battered = (L) => {
    const H = L.H, F = L.F, B = H.batter, S = H.REALMS[0].town;
    if (!L.batA) {
      const hs = S.houses.map((h) => h.rec).filter((h) => h && !h.keepHall && h.state === 'whole' && !h.round);
      const A = hs[3] || hs[0], src = F.spawnRealmUnit(1, 'warrior', 30, 'guard', S.x + 70, S.z, {}); src.hp = src.maxHp = 1e9;
      B.houseStoneHit(A, A.x + 1.5, A.y + 1.4, A.z, 3.2, src, false); B.houseStoneHit(A, A.x - 1.2, A.y + 1.8, A.z + 0.4, 3.2, src, false);
      B.houseStoneHit(A, A.x + 0.4, A.y + A.wallH + 1, A.z + 0.5, 4.4, src, true);
      F.removeEnt(src); L.batA = A;
    }
    return L.batA;
  };
  D('look3', 'house_cracked', (L) => {
    const A = battered(L), d = A.door.out2, dx = d.x - A.x, dz = d.z - A.z, l = Math.hypot(dx, dz) || 1;
    L.hush(A.x, A.z, 14); L.away(A.x + 40, A.z + 40);
    return { ...L.cam(A.x + dx / l * 6.5 + dz / l * 1.5, A.y + 2.0, A.z + dz / l * 6.5 - dx / l * 1.5, A.x + dx / l * 2, A.y + 1.7, A.z + dz / l * 2), bat: A.bat ? +A.bat.k.toFixed(2) : 0 };
  });
  // the keeps' halls' footpaths: from the inside of the gate across the courtyard to the hall's door
  for (const r of [0, 1, 2]) {
    D('look3', `hall_path${r}`, (L) => {
      const S = L.keepSite(r, 0), g = L.F.siteToWorld(S, 0, S.gateLocal.z - 3.2), h = L.F.siteToWorld(S, 0, -4);
      L.hush(S.x, S.z, 20); L.away(S.x + 60, S.z + 60);
      return L.cam(g.x, S.y + 6.5, g.z, h.x, S.y, h.z);
    });
  }
})();
// [look3] the masons at work on a breached tower's scaffold: one dressing stone at its foot, one up on the first lift
(function () {
  const LK = window.LK, D = (g, n, f) => LK.def(g, n, f);
  D('look3', 'masons', (L) => {
    const H = L.H, F = L.F, L3 = H.look3, S = L.keepSite(0, 0), C = F.castles().find((q) => q.S === S), K = S.keepRef;
    const W = C.sections.find((q) => q.kind === 'tower' && q.T.role === 'corner' && q.T.sx === -1 && q.T.sz === -1), T = W.T;
    if (W.state === 'whole') { const r = L.views.breach.call(L, L); if (r && r.skip) return r; }
    H.UI.modal = null; K.lastEnemyNear = -1e9;
    if (W.state === 'repair' && W.t > 0.6) W.t = 0.4;
    if (!L3.MASON.list.some((e) => !e.removed && e.ai.mason.W === W)) W.masonsFor = null;
    for (let t = 0; t < 140 && !(L3.MASON.list.filter((e) => !e.removed && e.ai.mason.W === W).length >= 2 && L3.MASON.list.filter((e) => !e.removed && e.ai.mason.W === W).every((e) => e.ai.mason.st === 'work')); t++) { H.simulate(1); K.lastEnemyNear = -1e9; if (W.state === 'repair' && W.t > 0.6) W.t = 0.4; }
    H.simulate(0.4); K.lastEnemyNear = H.GAME.t + 1e6; H.UI.modal = null;
    const ms = L3.MASON.list.filter((e) => !e.removed && e.ai.mason.W === W);
    const Ld = W.l3 && W.l3.ladders.find((q) => q.k === 0); // [look5] (no scaffold laid out yet: the war's foes kept the keep from mending in 140 s)
    if (!Ld) return { skip: 'no scaffold up (' + W.state + ')' };
    const c = { x: Ld.fx + (Ld.fx - T.wx) * 1.4 + 2, y: Ld.wyb + 3.2, z: Ld.fz + (Ld.fz - T.wz) * 1.4 + 2 };
    L.away(S.x + 60, S.z + 60);
    return { ...L.cam(c.x, c.y, c.z, Ld.lx, Ld.wyb + 1.6, Ld.lz), sts: ms.map((e) => e.ai.mason.st), ys: ms.map((e) => +(e.y - Ld.wyb).toFixed(2)) };
  });
})();
// [look3] a curtain built back behind its scaffold (a Logres side wall, a Thule palisade's timber stretch), from the field
(function () {
  const LK = window.LK, D = (g, n, f) => LK.def(g, n, f);
  const mended = (L, r, kind) => {
    const H = L.H, F = L.F, S = L.keepSite(r, 1), C = F.castles().find((q) => q.S === S), K = S.keepRef, W = C.sections.find((q) => q.kind === kind);
    if (!W) return null;
    if (W.state === 'whole') {
      const src = F.spawnRealmUnit((K.realm + 1) % 3, 'warrior', 30, 'guard', S.x + 90, S.z + 90, {}); src.hp = src.maxHp = 1e9;
      for (let n = 0; W.state === 'whole' && n < 120; n++) F.castleSiegeHit(src, W.wx, W.wz, 1.0, 4.4);
      F.removeEnt(src);
    }
    H.UI.modal = null; K.lastEnemyNear = -1e9;
    for (let t = 0; t < 80 && !(W.state === 'repair' && W.t > 0.3); t++) { H.simulate(1); K.lastEnemyNear = -1e9; }
    if (W.state === 'repair' && W.t > 0.6) W.t = 0.45;
    K.lastEnemyNear = H.GAME.t + 1e6; H.UI.modal = null;
    let ox = -W.waz, oz = W.wax; if ((W.wx + ox - S.x) ** 2 + (W.wz + oz - S.z) ** 2 < (W.wx - S.x) ** 2 + (W.wz - S.z) ** 2) { ox = -ox; oz = -oz; }
    return { S, W, ox, oz };
  };
  for (const [name, r, kind] of [['scaffold_curtain', 0, 'stone'], ['scaffold_timber', 2, 'timber']]) {
    D('look3', name, (L) => {
      const m = mended(L, r, kind); if (!m) return { skip: 'no section' };
      const { S, W, ox, oz } = m, c = { x: W.wx + ox * 11 + W.wax * 6, z: W.wz + oz * 11 + W.waz * 6 };
      L.away(S.x + 60, S.z + 60);
      return { ...L.cam(c.x, S.y + 4.0, c.z, W.wx + ox * 1.5, S.y + 3.0, W.wz + oz * 1.5), state: W.state, t: +(W.t || 0).toFixed(2), info: W.scafInfo };
    });
  }
})();
// [look4] (version 15) what version 14's look left and what version 14 added, as a player meets them
(function () {
  const LK = window.LK, D = (g, n, f) => LK.def(g, n, f);
  const keepOf = (r, k) => LK.H.WAR.keeps.find((K) => K.orig === r && K.site === LK.H.REALMS[r].keepSites[k]);
  const castleOfK = (K) => LK.F.castleOf(K.site);
  const holdKeep = (K) => { K.lastEnemyNear = LK.H.GAME.t + 1e6; };
  const noGarrison = (K) => { for (const id of [...K.guards]) { const g = LK.F.getEnt(id); if (g) LK.F.removeEnt(g); } K.guards.clear(); K.nextGuardAt = 1e9; };
  const sim = (L, s) => { const H = L.H, m = H.UI.modal; H.UI.modal = null; H.simulate(s, Math.min(0.05, s)); H.UI.modal = m || null; }; // (simulate's own step is 0.05 s: a shorter stretch needs its own)
  // a town's house brought down by stones (04j_batter.js houseBreak), from its street: r realm, n the n-th nearest the plaza
  LK.felled = function (r, n) {
    const L = this, key = 'l4f' + r + '_' + n;
    if (!L[key]) {
      const S = L.H.REALMS[r].town, hs = S.houses.map((h) => h.rec).filter((h) => h && !h.keepHall && h.state === 'whole');
      hs.sort((a, b) => Math.hypot(a.x - S.x, a.z - S.z) - Math.hypot(b.x - S.x, b.z - S.z));
      const A = hs[n] || hs[0];
      L.H.batter.houseBreak(A, null);
      sim(L, 2.5);
      L[key] = A;
    }
    return L[key];
  };
  const front = (L, A, d, side, up, look = 1.2) => {
    const o = A.door.out2, dx = o.x - A.x, dz = o.z - A.z, l = Math.hypot(dx, dz) || 1, ux = dx / l, uz = dz / l;
    const cx = A.x + ux * d + uz * side, cz = A.z + uz * d - ux * side;
    return L.cam(cx, L.floor(cx, cz) + up, cz, A.x + ux * 0.5, A.y + look, A.z + uz * 0.5);
  };
  for (const [r, n, sd] of [[0, 2, 1], [1, 1, 1], [2, 1, -1]]) { // (sd: the side of the house's door the camera stands: Skarvik's market stall stood in the way of the other)
    D('look4', 'ruin' + r, (L) => { const A = L.felled(r, n); L.hush(A.x, A.z, 16); L.away(A.x + 40, A.z + 40); return { ...front(L, A, A.foot + 6.5, 2.5 * sd, 2.1), st: A.state, fell: !!(A.bat && A.bat.fell) }; });
    D('look4', 'ruin_top' + r, (L) => { const A = L.felled(r, n); L.hush(A.x, A.z, 16); L.away(A.x + 40, A.z + 40); return { ...front(L, A, A.foot + 3.5, -3.5, 6.5, 0.2), st: A.state }; });
    // built back behind its scaffold, a third of the way through the work
    D('look4', 'house_scaf' + r, (L) => {
      const A = L.felled(r, n);
      if (A.state === 'ruin') { A.stT = 1e4; sim(L, 0.3); }
      if (A.state === 'scaffold') A.stT = Math.max(A.stT, 22);
      sim(L, 0.3);
      L.hush(A.x, A.z, 16); L.away(A.x + 40, A.z + 40);
      return { ...front(L, A, A.foot + 7.5, 3.5 * sd, 2.6, 1.8), st: A.state, t: +A.stT.toFixed(1) };
    });
  }
  // a burh's gate of planks burning, up close (its embers), and fallen
  const burhGate = (L, k) => { const K = keepOf(2, k), C = castleOfK(K); return { K, C, G0: C.gate }; };
  D('look4', 'gate_burn', (L) => {
    const { K, C, G0 } = burhGate(L, 1), F = L.F, Z = L.H.blaze;
    holdKeep(K); noGarrison(K); L.hush(K.site.x, K.site.z, 40);
    if (!K.door.alive) { K.door.alive = true; K.door.hp = K.door.maxHp; K.site.door.active = true; }
    if (!G0.bz || !G0.bz.burn) { sim(L, 0.3); Z.gateIgnite(G0, 0.7); G0.bz.burn.t = 22; }
    sim(L, 3);
    const c = F.siteToWorld(K.site, 1.6, G0.gz + 3.4), t = F.siteToWorld(K.site, -0.3, G0.gz);
    L.away(K.site.x + 60, K.site.z + 60);
    return { ...L.cam(c.x, K.site.y + 1.9, c.z, t.x, K.site.y + 1.6, t.z), char: G0.bz ? +G0.bz.char.toFixed(2) : null };
  });
  D('look4', 'gate_fallen', (L) => {
    const { K, C, G0 } = burhGate(L, 0), F = L.F, Z = L.H.blaze;
    holdKeep(K); noGarrison(K); L.hush(K.site.x, K.site.z, 40);
    if (!(G0.bz && G0.bz.down)) {
      if (!K.door.alive) { K.door.alive = true; K.door.hp = K.door.maxHp; K.site.door.active = true; }
      sim(L, 0.3); if (!G0.bz || !G0.bz.burn) Z.gateIgnite(G0, 1);
      for (let i = 0; i < 120 && !(G0.bz && G0.bz.down); i++) { sim(L, 1); holdKeep(K); }
      sim(L, 2);
    }
    const c = F.siteToWorld(K.site, 2.2, G0.gz + 5.5), t = F.siteToWorld(K.site, 0, G0.gz - 0.5);
    L.away(K.site.x + 60, K.site.z + 60);
    return { ...L.cam(c.x, K.site.y + 2.6, c.z, t.x, K.site.y + 0.6, t.z), down: !!(G0.bz && G0.bz.down) };
  });
  // a Thule log tower burning, its roof from close above (the embers in the char)
  D('look4', 'tower_roof', (L) => {
    const H = L.H, TF = H.towerfire, T = TF.list().find((q) => q.role === 'corner' && q.sx === -1 && q.sz === 1) || TF.list()[0];
    if (!T) return { skip: 'no log tower' };
    const S = T.S; holdKeep(S.keepRef);
    if (!T.burn && !T.fallen) { L.hush(S.x, S.z, 45); TF.towerIgnite(T, 3); }
    if (T.burn && !L.l4roof) { sim(L, Math.min(TF.TFIRE.burn - 6, TF.TFIRE.climb + 12)); L.l4roof = true; }
    holdKeep(S.keepRef);
    const q = (a, r, y) => { const w = L.F.siteToWorld(S, T.cx + Math.sin(a) * r, T.cz + Math.cos(a) * r); return { x: w.x, y: S.y + y, z: w.z }; };
    const aO = Math.atan2(T.cx, T.cz), c = q(aO + 0.6, 4.2, 14.5), t = q(aO, 0, 10.5);
    L.away(S.x + 60, S.z + 60);
    return { ...L.cam(c.x, c.y, c.z, t.x, t.y, t.z), burning: !!T.burn, fallen: !!T.fallen };
  });
  // a priest's holy ground under a warrior it dazzles (cls_hallow's scene from a fixed camera)
  D('look4', 'hallow', (L) => {
    const H = L.H, F = L.F, sp = L.open(H.REALMS[0].musterSite.x - 30, H.REALMS[0].musterSite.z + 20, 6, 90);
    if (!sp) return { skip: 'no room' };
    L.hush(sp.x, sp.z, 30);
    const p = F.spawnRealmUnit(0, 'priest', 30, 'guard', sp.x, sp.z, { yaw: Math.PI / 2 }), w = F.spawnRealmUnit(2, 'warrior', 30, 'guard', sp.x + 3.2, sp.z, { yaw: -Math.PI / 2 });
    for (const e of [p, w]) { e.ai.post = { x: e.x, z: e.z, leash: 0.2 }; e.hp = e.maxHp = 1e7; e.ai.nextAbility = 1e9; e.swingAt = 1e9; L.made.push(e); }
    const C = H.cls; try { C.csOf(p).dev = 60; } catch (e) { /* */ }
    const r = C.consecrate(p);
    for (let i = 0; i < 24; i++) { w.x = sp.x + 3.2; w.z = sp.z; sim(L, 0.05); }
    H.frame(1.6); // (the frames' clock past the column of light laid with the ground: it lasts a second)
    L.away(sp.x + 50, sp.z + 50);
    return { ...L.eye(sp.x + 1.0, sp.z - 4.6, sp.x + 1.6, F.heightAt(sp.x, sp.z) + 1.1, sp.z, 1.5), r: !!r, dazzle: w.buffs.filter((b) => b.kind === 'dazzle').map((b) => b.src) };
  });
  // the garrison beating out a fire on a burh's palisade (siege3_crew's scene)
  // a soldier beating out flames on open ground, close: the fire beater in its hands (05a_rig.js WB.beater)
  D('look4', 'beater_close', (L) => {
    const H = L.H, F = L.F, m = L.rp(0, 214, 18), p = L.open(m.x, m.z, 3) || m;
    L.clear(); L.hush(p.x, p.z, 14);
    const yaw = 0.6, e = F.spawnRealmUnit(0, 'warrior', 30, 'guard', p.x, p.z, { yaw });
    e.ai.post = { x: p.x, z: p.z, leash: 1 }; e.yaw = yaw; e.testLook = true; L.made.push(e);
    const act = () => { e.anim.act = 21; e.anim.actT = 0; e.anim.actDur = 30; e.yaw = yaw; };
    act(); sim(L, 0.4); act(); sim(L, 0.35);
    const s = Math.sin(yaw), c = Math.cos(yaw), cx = p.x + c * 2.6 + s * 1.2, cz = p.z - s * 2.6 + c * 1.2;
    return { ...L.eye(cx, cz, p.x + s * 0.6, L.floor(p.x, p.z) + 1.0, p.z + c * 0.6, 1.5), act: e.anim.act, dur: e.anim.actDur };
  });
  D('look4', 'beaters', (L) => {
    // [look6] the firefighters against the burning palisade they beat: a stretch in the middle of a side (the corner's
    // stretch put the camera in the gap by a tower, against its dark wall), the camera in the court, the beater between it
    // and the flames, the frames run so the flames show (a still after a simulation lost them: CLAUDE.md, Gotchas)
    const H = L.H, F = L.F, K = keepOf(2, 0), C = castleOfK(K), S = K.site;
    K.lastEnemyNear = H.GAME.t;
    if (!L.l4beat) {
      noGarrison(K); K.nextGuardAt = 0; F.fillGarrison(K, true); sim(L, 2);
      H.palisade.palisadeInit();
      // the stretch with the most open court before it: in the middle of a side, a clear line from 7 m in
      // (a side wall's: the hall stands by the back wall and the gate in the front)
      const mid = C.pal.cells.filter((q) => (q.side === 1 || q.side === 2) && Math.abs(q.a) < 5).map((q) => {
        const inn = { x: S.x + (q.x - S.x) * 0.55, z: S.z + (q.z - S.z) * 0.55 };
        const clear = !H.walls.shotHit(inn.x, S.y + 1.8, inn.z, q.x, S.y + 1.6, q.z, {}) ? 1 : 0;
        return { q, clear, d: Math.abs(q.a) };
      }).sort((a, b) => b.clear - a.clear || a.d - b.d);
      const c = (mid[0] || {}).q || C.pal.cells.find((q) => q.side === 0 && Math.abs(q.a - 3) < 1);
      H.palisade.palisadeIgnite(c, 0.7);
      L.l4beat = c;
    }
    const c = L.l4beat, gs = () => [...K.guards].map(F.getEnt).filter((g) => g && g.alive && g.ai.fire && g.anim.act === 21);
    for (let t = 0; t < 30 && gs().length < 2; t += 0.5) { c.heat = Math.max(c.heat, 0.6); sim(L, 0.5); }
    c.heat = Math.max(c.heat, 0.7);
    const g = gs()[0] || [...K.guards].map(F.getEnt).find((q) => q && q.alive && q.ai.fire);
    if (!g) return { skip: 'no beater' };
    L.away(S.x + 60, S.z + 60);
    // from the court: back from the beater toward the keep's middle and to one side, looking past it at the fire
    let ux = S.x - c.x, uz = S.z - c.z; const ul = Math.hypot(ux, uz) || 1; ux /= ul; uz /= ul;
    const tx = c.x * 0.7 + g.x * 0.3, ty = g.y + 1.3, tz = c.z * 0.7 + g.z * 0.3;
    let pick = null;
    for (const rr of [4.5, 3.6, 5.5, 2.8]) for (const lat of [1.8, -1.8, 2.8, -2.8, 1.0, -1.0]) {
      if (pick) break; const cx = g.x + ux * rr - uz * lat, cz = g.z + uz * rr + ux * lat, cy = Math.max(g.y, F.heightAt(cx, cz)) + 1.75;
      if (!F.isWalkable(cx, cz) || F.houseAt(cx, cz, 0.6) || H.walls.shotHit(cx, cy, cz, g.x, g.y + 1.2, g.z, {}) || H.walls.shotHit(cx, cy, cz, tx, ty, tz, {})) continue;
      pick = [cx, cy, cz];
    }
    if (!pick) pick = [g.x + ux * 4.5 - uz * 1.8, g.y + 1.75, g.z + uz * 4.5 + ux * 1.8];
    const r = L.cam(pick[0], pick[1], pick[2], tx, ty, tz);
    // the frames run (the world with them) so the flames and the beating show as in play, the camera held
    for (let i = 0; i < 8; i++) { const m = H.UI.modal; H.UI.modal = null; c.heat = Math.max(c.heat, 0.7); H.frame(1 / 15); H.UI.modal = m || null; H.camera.position.set(pick[0], pick[1], pick[2]); H.camera.lookAt(tx, ty, tz); }
    return { ...r, beating: gs().length, heat: +c.heat.toFixed(2), side: c.side, a: +c.a.toFixed(1) };
  });
  // a climber half way up a scaffold's ladder, from beside it (the hands and feet on its rungs)
  D('look4', 'scaf_climb', (L) => {
    const H = L.H, F = L.F, S = L.keepSite(0, 0), C = F.castles().find((q) => q.S === S), K = S.keepRef;
    const W = C.sections.find((q) => q.kind === 'tower' && q.T.role === 'corner' && q.T.sx === -1 && q.T.sz === -1);
    if (W.state === 'whole' || !(W.l3 && W.l3.on)) { const r = L.views.mend.call(L, L); if (r && r.skip) return r; }
    K.lastEnemyNear = H.GAME.t + 1e6;
    const Ld = W.l3 && W.l3.ladders.find((q) => q.k === 0);
    if (!Ld) return { skip: 'no ladder' };
    L.hush(Ld.fx, Ld.fz, 12);
    const P = F.spawnRealmUnit(0, 'warrior', 30, 'guard', Ld.fx, Ld.fz, { yaw: Ld.yawW }); P.ai.post = null; P.hp = P.maxHp = 1e7; P.testLook = true; L.made.push(P);
    P.y = Ld.wyb; H.towers.towerClimb(P, Ld, 1);
    for (let i = 0; i < 400 && P.y < Ld.wyb + 1.25 && P.motion; i++) sim(L, 1 / 60);
    const hold = { x: P.x, y: P.y, z: P.z };
    const sx = Math.cos(Ld.yawW), sz = -Math.sin(Ld.yawW), fx = Math.sin(Ld.yawW), fz = Math.cos(Ld.yawW);
    const c = { x: hold.x + sx * 2.2 - fx * 1.4, y: hold.y + 1.3, z: hold.z + sz * 2.2 - fz * 1.4 };
    return { ...L.cam(c.x, c.y, c.z, hold.x + fx * 0.2, hold.y + 1.0, hold.z + fz * 0.2), y: +(P.y - Ld.wyb).toFixed(2), motion: P.motion ? P.motion.kind : null, st: W.state, t: +(W.t || 0).toFixed(2), gone: !!Ld.gone, vis: !!(W.scaffold && W.scaffold.visible), lifts: W.l4n };
  });
  // version 14's timber: a burh's walk burning at night, burnt through by day (the charred boards below), the hallow's ring
  D('look4', 'deck_gap', (L) => {
    const H = L.H, F = L.F, K = keepOf(2, 1), C = castleOfK(K), B = C.blaze, Z = H.blaze;
    holdKeep(K); noGarrison(K);
    const side = B.cells.filter((c) => c.di === 0), c = side[Math.floor(side.length / 2)], d = side[Math.floor(side.length / 2) + 1];
    if (c.st !== 3) { c.char = 1; Z.deckThrough(c); d.char = 0.8; d.st = 2; Z.blazeUpload(B); sim(L, 2); }
    const cam = F.siteToWorld(K.site, c.lx + 0.2, c.lz + 6.0), t = F.siteToWorld(K.site, c.lx, c.lz);
    L.away(K.site.x + 60, K.site.z + 60);
    return L.cam(cam.x, c.y + 1.8, cam.z, t.x, c.y - 0.8, t.z);
  });
  D('look4', 'deck_fire', (L) => {
    const H = L.H, F = L.F, K = keepOf(2, 1), C = castleOfK(K), B = C.blaze, Z = H.blaze;
    holdKeep(K); noGarrison(K);
    const side = B.cells.filter((c) => c.di === 1), c = side[5];
    if (c.st === 0) { Z.deckIgnite(c, 0.9, 9); c.t = 25; Z.deckIgnite(side[6], 0.7, 9); sim(L, 4); }
    const cam = F.siteToWorld(K.site, c.lx - 7, c.lz + 4), t = F.siteToWorld(K.site, c.lx, c.lz);
    L.away(K.site.x + 60, K.site.z + 60);
    return { ...L.cam(cam.x, K.site.y + 3.0, cam.z, t.x, K.site.y + 5.0, t.z), heat: +c.heat.toFixed(2) };
  });
  // a burh's walk built back: the new boards pale beside the old, seen from the court
  D('look4', 'deck_fresh', (L) => {
    const H = L.H, F = L.F, K = keepOf(2, 0), C = castleOfK(K), B = C.blaze, Z = H.blaze;
    holdKeep(K); noGarrison(K);
    const side = B.cells.filter((c) => c.di === 0), c = side[Math.floor(side.length / 2)];
    if (!L.l4fresh) { c.char = 1; Z.deckThrough(c); sim(L, 0.5); Z.deckMended(c); Z.blazeUpload(B); sim(L, 0.5); L.l4fresh = true; }
    const cam = F.siteToWorld(K.site, c.lx + 2.2, c.lz + 6.5), t = F.siteToWorld(K.site, c.lx, c.lz);
    L.away(K.site.x + 60, K.site.z + 60);
    return { ...L.cam(cam.x, c.y + 1.2, cam.z, t.x, c.y - 0.2, t.z), fresh: +c.fresh.toFixed(2) };
  });
  D('look4', 'ring', (L) => {
    const H = L.H, F = L.F, T = H.WAR.temples[2], C = F.castleOf(T.site), B = C.blaze, Z = H.blaze;
    T.lastEnemyNear = H.GAME.t + 1e6;
    const c = B.cells[7], d = B.cells[8];
    if (c.st !== 3) { c.char = 1; Z.deckThrough(c); Z.deckIgnite(d, 0.8, 9); d.t = 30; sim(L, 4); }
    const p = F.siteToWorld(T.site, Math.sin(c.am) * 27, Math.cos(c.am) * 27), t = F.siteToWorld(T.site, Math.sin(c.am) * 16, Math.cos(c.am) * 16);
    L.away(T.site.x + 70, T.site.z + 70);
    return L.cam(p.x, T.site.y + 4.5, p.z, t.x, T.site.y + 1.5, t.z);
  });
  // a holed roof from inside by day (the sun through it, the broken rafters) and from above
  const holed = (L) => {
    if (!L.l4hole) {
      const hs = L.H.REALMS[0].town.houses.map((h) => h.rec).filter((h) => h && !h.keepHall && h.state === 'whole' && !h.round);
      const A = hs[Math.min(5, hs.length - 1)];
      L.H.batter.houseStoneHit(A, A.x + 0.6, A.y + A.top, A.z + 0.4, 4.4, null, true);
      L.H.rafters.houseRafterSync(2); L.l4hole = A;
    }
    return L.l4hole;
  };
  D('look4', 'roof_in', (L) => { const A = holed(L), b = A.bat, dx = b.hx - A.x, dz = b.hz - A.z, dl = Math.hypot(dx, dz) || 1; L.away(A.x + 40, A.z + 40); return L.cam(b.hx - dx / dl * 1.6, A.y + 1.4, b.hz - dz / dl * 1.6, b.hx, A.y + A.wallH + 0.6, b.hz); });
  D('look4', 'roof_out', (L) => { const A = holed(L), b = A.bat; L.away(A.x + 40, A.z + 40); return L.cam(b.hx + 4.5, A.y + A.top + 5.5, b.hz + 4.5, b.hx, A.y + A.wallH, b.hz); });
})();
// [look5] (version 17) what version 16 added, as a player meets it: the risen camps and their champions, the wrath's ring
// as it glows and as it breaks the ground, the standard of a veteran's name planted on the frontier and in a keep's
// court, hens, pheasants and mallards walking on their new legs, horses at a gathered gallop, a mason with its mallet at a
// tower's scaffold, a fallen tower's mound of broken stone with stormers on it, builders up on a house's scaffold
(function () {
  const LK = window.LK, D = (g, n, f) => LK.def(g, n, f);
  const sim = (L, s) => { const H = L.H, m = H.UI.modal; H.UI.modal = null; H.simulate(s, Math.min(0.05, s)); H.UI.modal = m || null; };
  // step the world at 60 Hz, `drive` moving the bodies a test holds (13r_motion.js motionRun with nothing to measure)
  const run = (L, sec, drive) => { const H = L.H, m = H.UI.modal; H.UI.modal = null; const n = Math.round(sec * 60); for (let k = 0; k < n; k++) { if (drive) drive(k / 60, 1 / 60); H.motion.motionRun([], 1 / 60, 1 / 60); } H.UI.modal = m || null; };
  // a camera round a point: the first of a few places at `d` m with nothing solid between it and the point
  LK.around = function (x, y, z, d, up, a0 = 0, look = null) {
    const H = this.H, F = this.F, Tr = F.W.trees;
    for (const dd of [d, d * 0.8, d * 1.25]) for (let k = 0; k < 16; k++) {
      const a = a0 + (k % 2 ? -1 : 1) * Math.ceil(k / 2) * 0.39, cx = x + Math.sin(a) * dd, cz = z + Math.cos(a) * dd;
      if (!F.isWalkable(cx, cz) && !(H.water.waterAt(cx, cz))) continue;
      const cy = Math.max(F.heightAt(cx, cz) + 0.5, y + up);
      if (H.walls.shotHit(cx, cy, cz, x, y + 0.6, z, {})) continue;
      if (Tr.some((t) => !t.gone && !t.felled && Math.hypot(t.x - (cx + x) / 2, t.z - (cz + z) / 2) < dd * 0.45 + 0.6)) continue;
      return this.cam(cx, cy, cz, look ? look.x : x, look ? look.y : y + 0.9, look ? look.z : z);
    }
    return this.cam(x + Math.sin(a0) * d, y + up, z + Math.cos(a0) * d, x, y + 0.9, z);
  };
  // the risen of the borderlands: the player past 40 (level 45), the nine farthest camps taken over
  LK.rise = function () {
    const H = this.H, F = this.F;
    if (H.GAME.prog.level < 45) { H.GAME.prog.level = 45; F.rescaleWar(); }
    return H.CAMPS.filter((c) => H.late.late2Risen(c));
  };
  const champOf = (L, id) => {
    const H = L.H, F = L.F, camp = L.rise().find((c) => c.id === id) || L.rise()[0];
    let C = F.getEnt(camp.eliteId); if (!C || !C.alive) { F.spawnMob(camp, true); C = F.getEnt(camp.eliteId); }
    return { camp, C };
  };
  // a risen champion in its camp, out of a fight, turned to the camera
  for (const [name, id] of [['risen_bandit', 43], ['risen_wisp', 50], ['risen_troll', 59], ['risen_bear', 51], ['risen_dead', 42]]) {
    D('look5', name, (L) => {
      const { camp, C } = champOf(L, id); if (!C) return { skip: 'no champion' };
      C.target = null; C.threat && C.threat.clear && C.threat.clear(); sim(L, 0.3);
      const v = L.around(C.x, C.y, C.z, 5.5 + 1.6 * (C.scale || 1), 1.0 + 0.4 * (C.scale || 1), Math.atan2(camp.x - C.x, camp.z - C.z) + Math.PI, { x: C.x, y: C.y + 1.0 * (C.scale || 1), z: C.z });
      C.yaw = Math.atan2(L.H.camera.position.x - C.x, L.H.camera.position.z - C.z); sim(L, 0.05);
      return { ...v, champ: C.name, lvl: C.level, kind: C.kind, type: camp.type, scale: +(C.scale || 1).toFixed(2), n: camp.members.size };
    });
  }
  // the wrath: a risen champion's ring glowing under its foe (a soldier of Logres held in it), and the ground broken after
  const wrath = (L, at) => {
    const H = L.H, F = L.F, { camp, C } = champOf(L, 43);
    for (const id of [...camp.members]) { const m = F.getEnt(id); if (m && m !== C) { m.damagers = null; F.killEnt(m, null); F.removeEnt(m); } }
    for (const o of H.ENT.slice()) if (o.alive && o !== C && o.kind !== 'door' && o.role !== 'player' && !o.siegeEngine && Math.hypot(o.x - C.x, o.z - C.z) < 30) F.removeEnt(o);
    const a = Math.atan2(camp.x - C.x, camp.z - C.z) + Math.PI, fx = C.x + Math.sin(a) * 2.2, fz = C.z + Math.cos(a) * 2.2;
    const foe = F.spawnRealmUnit(0, 'warrior', 45, 'guard', fx, fz, { yaw: Math.atan2(C.x - fx, C.z - fz) });
    foe.ai.post = { x: fx, z: fz, leash: 0.3 }; foe.hp = foe.maxHp = 1e9; foe.testLook = true; L.made.push(foe);
    C.hp = C.maxHp; C.buffs.length = 0; C.target = foe.id; C.threat = new Map([[foe.id, 99]]);
    C.ai.l2 = { next: 0, next2: 1e9, rally: true, enr: false, w: null, last: H.GAME.t };
    L.away(C.x + 30, C.z - 30); H.GAME.player.hp = H.GAME.player.maxHp = 1e9; // (the camp thinks only with the player within reach)
    H.late.late2ChampThink(C, foe, 0.05);
    sim(L, at);
    const v = L.around(C.x, C.y, C.z, 9.5, 3.2, a + 0.9, { x: (C.x + fx) / 2, y: C.y + 0.5, z: (C.z + fz) / 2 });
    return { ...v, w: C.ai.l2 && C.ai.l2.w ? +C.ai.l2.w.t.toFixed(2) : null, wrath: H.late.LATE2.stats.wrath };
  };
  D('look5', 'wrath_ring', (L) => wrath(L, 0.95));
  D('look5', 'wrath_break', (L) => { const r = wrath(L, 1.62); for (let i = 0; i < 7; i++) L.H.frame(0.2); return r; }); // (the discs age by the frames' clock: the ring's 1.55 s run out, the cracks and the shockwave's after 0.2 s)
  // the standard of the player's name: made and planted on the frontier (the Logres muster's field) and in a keep's court
  const plant = (L, x, z, yaw) => {
    const H = L.H, F = L.F, P = H.GAME.player, Lt = H.late.LATE2;
    if (!Lt.names.length) { Lt.d.foes = 0; H.GAME.prog.realmKills = Math.max(H.GAME.prog.realmKills || 0, 30); H.late.late2CheckNames(true); }
    if (!Lt.names.length) Lt.names.push('blooded');
    Lt.std.made = true;
    L.play(x, z, yaw, 0.12, 6.5);
    const ok = H.late.late2StdPlant();
    sim(L, 0.9);
    P.yaw = yaw + 2.4; L.H.look(yaw + 0.5, 0.12, 6.5);
    return { planted: ok, at: Lt.std.at };
  };
  D('look5', 'std_field', (L) => {
    const H = L.H, m = H.REALMS[0].musterSite, sp = L.open(m.x + 26, m.z - 18, 4, 90) || { x: m.x + 26, z: m.z - 18 };
    L.hush(sp.x, sp.z, 20);
    return plant(L, sp.x, sp.z, 0.7);
  });
  D('look5', 'std_court', (L) => {
    const H = L.H, F = L.F, S = L.keepSite(0, 0), p = F.siteToWorld(S, 4.5, S.gateLocal.z - 7);
    L.hush(p.x, p.z, 12);
    return plant(L, p.x, p.z, L.yawTo(p.x, p.z, S.x, S.z) + 0.6);
  });
  // hens about a farmyard (Brackenford's hens), and mallards by a pond's edge, walking on their legs, from low beside them
  const walkers = (L, kinds, x, z, yaw, vs, gap = 0.9) => {
    const F = L.F, ux = Math.sin(yaw), uz = Math.cos(yaw), sx = Math.cos(yaw), sz = -Math.sin(yaw), B = [];
    kinds.forEach((k, i) => { const e = L.beast(k, x + sx * (i - (kinds.length - 1) / 2) * gap - ux * (1 + i * 0.4), z + sz * (i - (kinds.length - 1) / 2) * gap - uz * (1 + i * 0.4), yaw); e.role = 'test'; B.push(e); });
    run(L, 1.4, (t, dt) => B.forEach((e, i) => { const v = vs[i % vs.length] * Math.min(1, t / 0.35); e.x += ux * v * dt; e.z += uz * v * dt; e.yaw = yaw; }));
    return B;
  };
  D('look5', 'hens', (L) => {
    const H = L.H, F = L.F, S = H.REALMS[0].town, hn = H.ENT.filter((e) => e.alive && e.kind === 'hen' && Math.hypot(e.x - S.x, e.z - S.z) < 140);
    const c0 = hn[0] || S, sp = L.open(c0.x, c0.z, 2.2, 30) || c0;
    L.hush(sp.x, sp.z, 6); for (let j = -3; j <= 3; j++) H.nature.natureCut(sp.x + j, sp.z, 3.2, 1, false);
    const B = walkers(L, ['hen', 'hen', 'pheasant'], sp.x, sp.z, 1.57, [0.45, 0.7, 0.55], 0.75);
    const m = B[1], cx = m.x - 0.6, cz = m.z + 2.9;
    L.away(sp.x + 50, sp.z + 50);
    return { ...L.cam(cx, m.y + 0.62, cz, m.x + 0.3, m.y + 0.16, m.z - 0.3), at: [+sp.x.toFixed(1), +sp.z.toFixed(1)] };
  });
  D('look5', 'ducks', (L) => {
    const H = L.H, F = L.F, Pd = H.water.PONDS.filter((p) => p.n > 30).sort((a, b) => Math.hypot(a.x - H.REALMS[1].town.x, a.z - H.REALMS[1].town.z) - Math.hypot(b.x - H.REALMS[1].town.x, b.z - H.REALMS[1].town.z))[0];
    if (!Pd) return { skip: 'no pond' };
    // the bank: the first walkable point out from the pond's middle with no water on it, and dry ground along it
    let bank = null;
    for (let a = 0; a < 6.28 && !bank; a += 0.3) for (let r = 2; r < 40; r += 0.5) {
      const x = Pd.x + Math.sin(a) * r, z = Pd.z + Math.cos(a) * r;
      if (H.water.waterAt(x, z)) continue;
      if (!F.isWalkable(x, z)) break;
      const x1 = x + Math.sin(a) * 1.2, z1 = z + Math.cos(a) * 1.2;
      if (!H.water.waterAt(x1, z1) && F.isWalkable(x1, z1)) { bank = { x: x1, z: z1, a }; }
      break;
    }
    if (!bank) return { skip: 'no bank' };
    L.hush(bank.x, bank.z, 10);
    const yaw = bank.a + Math.PI / 2;
    for (let j = -3; j <= 3; j++) H.nature.natureCut(bank.x + Math.sin(yaw) * j, bank.z + Math.cos(yaw) * j, 2.6, 1, false);
    const B = walkers(L, ['duck', 'duck'], bank.x, bank.z, yaw, [0.5, 0.65], 0.7);
    const m = B[0], ox = Math.sin(bank.a), oz = Math.cos(bank.a);
    L.away(bank.x + 50, bank.z + 50);
    return { ...L.cam(m.x + ox * 2.4 + Math.sin(yaw) * 0.6, m.y + 0.6, m.z + oz * 2.4 + Math.cos(yaw) * 0.6, m.x - ox * 0.6, m.y + 0.1, m.z - oz * 0.6), pond: [Math.round(Pd.x), Math.round(Pd.z)] };
  });
  // two horses at a gallop (11 and 13 m/s) from abreast, the grass mown along their lane so the legs show
  D('look5', 'gallop', (L) => {
    const H = L.H, F = L.F, sp = L.open(H.REALMS[2].musterSite.x + 34, H.REALMS[2].musterSite.z + 10, 10, 90);
    if (!sp) return { skip: 'no room' };
    L.hush(sp.x, sp.z, 45);
    const a = L.beast('horse', sp.x - 22, sp.z - 1.4, Math.PI / 2), b = L.beast('horse', sp.x - 21, sp.z + 1.8, Math.PI / 2, { cols: [[0.66, 0.6, 0.52], [0.2, 0.17, 0.14]] });
    for (let j = -30; j <= 30; j += 1.5) H.nature.natureCut(sp.x + j, sp.z, 3.5, 1, false);
    run(L, 1.9, (t, dt) => { const k = Math.min(1, t / 0.5); a.x += 11 * k * dt; b.x += 13 * k * dt; a.yaw = b.yaw = Math.PI / 2; });
    const mx = (a.x + b.x) / 2;
    L.away(sp.x + 60, sp.z + 60);
    return { ...L.eye(mx - 0.5, sp.z - 8.0, mx, F.heightAt(mx, sp.z) + 0.95, sp.z, 1.2), at: [+(a.x - sp.x).toFixed(1), +(b.x - sp.x).toFixed(1)] };
  });
  // the mason up on a breached tower's scaffold with its mallet, close (look3's masons from 5 m)
  D('look5', 'mason_close', (L) => {
    // [look6] the war kept away while the masons come: a breach draws the commanders' bands, and after `mound` they kept
    // the keep from mending (no scaffold in 140 s); every foe of the keep within 140 m sent away and the commanders held
    const H0 = L.H, S0 = L.keepSite(0, 0), K0 = S0.keepRef, held = H0.WAR.commanders.map((Cm) => Cm.nextThink);
    const away = () => { for (const e of H0.ENT.slice()) if (e.alive && e.role === 'soldier' && e.faction !== K0.realm && Math.hypot(e.x - S0.x, e.z - S0.z) < 140) L.F.removeEnt(e); };
    for (const Cm of H0.WAR.commanders) Cm.nextThink = H0.GAME.t + 400;
    away();
    const sim0 = H0.simulate; H0.simulate = function (sec, dt) { away(); return sim0.call(this, sec, dt); };
    let r;
    try { r = L.views.masons.call(L, L); } finally { H0.simulate = sim0; H0.WAR.commanders.forEach((Cm, i) => { Cm.nextThink = Math.min(held[i], H0.GAME.t + 5); }); }
    if (r && r.skip) return r;
    const H = L.H, F = L.F, L3 = H.look3, ms = L3.MASON.list.filter((e) => !e.removed && e.alive && e.ai.mason && e.ai.mason.st === 'work');
    const up = ms.sort((a, b) => b.y - a.y)[0];
    if (!up) return { skip: 'no mason at work' };
    const fx = Math.sin(up.yaw), fz = Math.cos(up.yaw), sx = Math.cos(up.yaw), sz = -Math.sin(up.yaw);
    return { ...L.cam(up.x - fx * 1.6 + sx * 2.3, up.y + 1.7, up.z - fz * 1.6 + sz * 2.3, up.x + fx * 0.5, up.y + 1.25, up.z + fz * 0.5), act: up.anim.act, y: +up.y.toFixed(2), sts: r.sts };
  });
  // a fallen tower's mound of broken stone with stormers on it, from the field
  D('look5', 'mound', (L) => {
    const H = L.H, F = L.F, S = L.keepSite(0, 0), C = F.castles().find((q) => q.S === S), K = S.keepRef;
    const W = C.sections.find((q) => q.kind === 'tower' && q.T.role === 'corner' && q.T.sx === -1 && q.T.sz === -1), T = W.T;
    if (W.state !== 'breach') { if (W.state !== 'whole') { W.state = 'whole'; } const r = L.views.breach.call(L, L); if (r && r.skip) return r; }
    K.lastEnemyNear = H.GAME.t + 1e6;
    const Rt = H.siege2.siegeStormRoute(W), a = Rt[0], b = Rt[2];
    L.hush((a.x + b.x) / 2, (a.z + b.z) / 2, 16);
    const dx = b.x - a.x, dz = b.z - a.z, dl = Math.hypot(dx, dz), ux = dx / dl, uz = dz / dl, yaw = Math.atan2(ux, uz);
    const men = [[0.35, -0.7], [0.55, 0.8], [0.72, -0.2]].map(([f, lat], i) => {
      const x = a.x + dx * f - uz * lat, z = a.z + dz * f + ux * lat, e = F.spawnRealmUnit(2, ['warrior', 'archer', 'warrior'][i], 30, 'guard', x, z, { yaw });
      e.ai.post = null; e.role = 'test'; e.testLook = true; e.y = F.floorAt(x, z, 60); L.made.push(e); return e;
    });
    run(L, 0.8, (t, dt) => men.forEach((e, i) => { const v = 0.9 + 0.25 * i; e.x += ux * v * dt; e.z += uz * v * dt; e.yaw = yaw; }));
    const c = { x: a.x - ux * 5.5 + uz * 6.5, z: a.z - uz * 5.5 - ux * 6.5 };
    L.away(S.x + 60, S.z + 60);
    return { ...L.cam(c.x, F.heightAt(c.x, c.z) + 2.6, c.z, (a.x + b.x) / 2, men[1].y + 0.8, (a.z + b.z) / 2), ys: men.map((e) => +(e.y - F.heightAt(e.x, e.z)).toFixed(2)), st: W.state };
  });
  // a builder up on a house's scaffold, hammering at the wall from its boards (13z_look5.js look5ScafStep): a house with
  // people of its own, its walls high enough for the boards' work
  D('look5', 'house_up', (L) => {
    const H = L.H, F = L.F, Rb = H.rubble, S = H.REALMS[0].town;
    if (!L.l5up) {
      const hs = S.houses.map((h) => h.rec).filter((h) => h && !h.keepHall && h.state === 'whole' && h.residents && h.residents.length);
      hs.sort((a, b) => Math.hypot(a.x - S.x, a.z - S.z) - Math.hypot(b.x - S.x, b.z - S.z));
      const A = hs[1] || hs[0]; H.war2.HCREW.off = true; H.batter.houseBreak(A, null); sim(L, 2); A.stT = 1e4; sim(L, 0.3); L.l5up = A;
    }
    const A = L.l5up, Q = Rb.HSCAF.list.get(A); if (!Q) return { skip: 'no scaffold' };
    const full = (A.round ? A.wallH : A.wallH + A.rh) + 0.1, at = (lv) => lv / full * 0.6 * 70, Ld = Q.l3.ladders.find((q) => q.k === 0);
    let up = null;
    L.away(A.x + 30, A.z + 30);
    for (let t = 0; t < 160 && !up; t += 0.5) {
      if (A.state !== 'scaffold') break;
      A.stT = Math.min(Math.max(A.stT, at(Q.lifts[0] + 1.3)), at(full - 0.5)); sim(L, 0.5);
      up = A.residents.map(F.getEnt).find((b) => b && b.alive && !b.motion && b.y > Ld.wyb + 1 && b.anim.act === 23) || null;
    }
    if (!up) return { skip: 'nobody up', st: A.state };
    const fx = Math.sin(up.yaw), fz = Math.cos(up.yaw), sx = Math.cos(up.yaw), sz = -Math.sin(up.yaw);
    return { ...L.cam(up.x - fx * 2.6 + sx * 2.4, up.y + 1.6, up.z - fz * 2.6 + sz * 2.4, up.x + fx * 0.4, up.y + 1.2, up.z + fz * 0.4), y: +(up.y - Ld.wyb).toFixed(2), act: up.anim.act, lift: +(Ld.wyt - Ld.wyb).toFixed(2) };
  });
  // builders at a house being built back: a fallen house of Brackenford a third of the way through, from its street
  D('look5', 'house_builders', (L) => {
    const A = L.felled(0, 2), H = L.H;
    if (A.state === 'ruin') { A.stT = 1e4; sim(L, 0.3); }
    if (A.state === 'scaffold') A.stT = Math.max(A.stT, 30);
    sim(L, 6);
    const o = A.door.out2, dx = o.x - A.x, dz = o.z - A.z, l = Math.hypot(dx, dz) || 1, ux = dx / l, uz = dz / l;
    const cx = A.x + ux * (A.foot + 7) + uz * 4, cz = A.z + uz * (A.foot + 7) - ux * 4;
    const bs = H.ENT.filter((e) => e.alive && e.kind === 'humanoid' && Math.hypot(e.x - A.x, e.z - A.z) < 9 && e.role === 'villager');
    L.away(A.x + 40, A.z + 40);
    return { ...L.cam(cx, L.floor(cx, cz) + 2.4, cz, A.x, A.y + 1.8, A.z), st: A.state, t: +A.stT.toFixed(1), builders: bs.map((e) => +(e.y - A.y).toFixed(2)) };
  });
})();
// [look6] (version 18) what version 17 added, as a player meets it: the Deep Barrow hall by hall with the player in it by
// its own light (the seal, the Long Stair, the cistern dry and flooded with the player swimming, the pyres' pitch alight,
// a gallery slab giving way and fallen, the Ash Throne, the lord's cleave and his Ember Word), a veteran in its mantle,
// its horse in its barding at a gallop, the standard with its device and struck down, a column on the road from the
// muster, and two guards mending a broken gate with mallets
(function () {
  const LK = window.LK, D = (g, n, f) => LK.def(g, n, f);
  const sim = (L, s) => { const H = L.H, m = H.UI.modal; H.UI.modal = null; H.simulate(s, Math.min(0.05, s)); H.UI.modal = m || null; };
  // frames with the world running in step with them (what is emitted shows, as in play), then held
  const live = (L, sec, dt = 1 / 10) => { const H = L.H, m = H.UI.modal; H.UI.modal = null; for (let t = 0; t < sec - 1e-6; t += dt) H.frame(dt); H.UI.modal = m || null; };
  // a veteran of 50 who has laid the Hollow King to rest and brought the Ash-Crowned down, wearing a name (the mantle)
  LK.vet = function (name = 'ashbane') {
    const H = this.H, F = this.F, Lt = H.late.LATE2;
    if (H.GAME.prog.level < 50) { H.GAME.prog.level = 50; F.rescaleWar(); }
    Lt.d.king = Math.max(1, Lt.d.king || 0); H.GAME.prog.kingKills = Math.max(1, H.GAME.prog.kingKills || 0);
    if (name === 'ashbane') Lt.d.deep = Math.max(1, Lt.d.deep || 0);
    H.late.late2CheckNames(true);
    if (Lt.worn !== name) H.late.late2Wear(name);
    H.vet3.L3V.mantle = true;
    return Lt.worn;
  };
  // under the Barrow: the seal broken, the deep drawn, the player at (u, v) facing yaw, the play camera behind it
  LK.deepPrep = function () {
    const H = this.H, Dp = H.deep, D0 = Dp.DEEP;
    this.vet();
    if (!D0.opened) Dp.late3SealOpen(true);
    if (!this.l6deep) { Dp.deepPacksFresh(); this.l6deep = true; }
    return D0;
  };
  LK.under = function (u, v, yaw, pitch = 0.25, dist = 6, keep) {
    const H = this.H, F = this.F, P = H.GAME.player, p = F.dunPoint(u, v);
    if (P.mount) { try { F.dismount(P); } catch (e) { /* */ } }
    P.x = P.prevX = p.x; P.z = P.prevZ = p.z; P.y = p.y; P.yaw = yaw; P.vy = 0; P.onGround = true; P.motion = null; P.l3fall = null; P.hp = P.maxHp = 1e7; P.buffs.length = 0; P.casting = null; P.swim = false; P.target = null;
    F.setIndoor(true); this.afterIndoor = true;
    H.deep.DEEP.root.visible = true;
    H.CAM.mode = 'play'; H.UI.modal = null; H.look(yaw, pitch, dist); H.CAM.near = dist;
    return { at: [u, v], y: +p.y.toFixed(2) };
  };
  // the deep's dead in a hall cleared (a hall looked at on its own), or kept where they stand
  LK.deepCalm = function (room) {
    const H = this.H, F = this.F;
    for (const e of H.ENT.slice()) if (e.alive && e.deep && !e.deepLord && (!room || (H.deep.late3Room(e.x, e.z) || {}).id === room)) { e.damagers = null; F.killEnt(e, null); F.removeEnt(e); }
  };
  const P0 = (L) => L.H.GAME.player;
  LK.H.look6Top = (S, x, z) => { const m = S.mesh, lx = x - m.position.x, lz = z - m.position.z; return m.position.y + lx * Math.sin(m.rotation.z) * Math.cos(m.rotation.x) - lz * Math.sin(m.rotation.x); };
  D('look6', 'deep_seal', (L) => {
    const H = L.H, Dp = H.deep, D0 = L.deepPrep();
    // the seal whole, as a player first meets it
    D0.seal.target = 0; D0.seal.open = 0; D0.seal.mesh.position.y = -7; D0.seal.coll.active = true;
    const r = L.under(193, 10.5, 0, 0.12, 4.5);
    sim(L, 0.3);
    return { ...r, seal: D0.seal.open };
  });
  D('look6', 'deep_stair', (L) => {
    const H = L.H, Dp = H.deep, D0 = L.deepPrep();
    Dp.late3SealOpen(true); D0.seal.open = 1; D0.seal.target = 1;
    const r = L.under(193, 22.5, 0, 0.35, 4.5);
    sim(L, 0.3);
    return r;
  });
  D('look6', 'deep_cistern', (L) => {
    const H = L.H, Dp = H.deep, D0 = L.deepPrep();
    D0.flood.st = 0; D0.flood.next = 1e9; D0.wy = Dp.DEEP_FLOOD.base; D0.water.position.y = D0.wy;
    L.deepCalm('cistern');
    const r = L.under(180, 39.5, -Math.PI / 2 - 0.35, 0.22, 5.5);
    sim(L, 0.3);
    return { ...r, wy: +D0.wy.toFixed(2) };
  });
  D('look6', 'deep_flood', (L) => {
    const H = L.H, Dp = H.deep, D0 = L.deepPrep();
    D0.flood.st = 2; D0.flood.t = 0; D0.flood.next = 1e9; D0.wy = Dp.DEEP_FLOOD.high; D0.water.position.y = D0.wy;
    L.deepCalm('cistern');
    const r = L.under(171, 46.5, -Math.PI / 2 + 0.25, 0.3, 5.0);
    live(L, 1.2);
    const P = P0(L);
    return { ...r, wy: +D0.wy.toFixed(2), swim: !!P.swim, y: +P.y.toFixed(2) };
  });
  D('look6', 'deep_pyres', (L) => {
    const H = L.H, F = L.F, Dp = H.deep, D0 = L.deepPrep();
    L.deepCalm('pyres');
    Dp.deepPitchOut(); for (const C of D0.cells) C.ch = 0;
    const C = D0.cells.find((c) => c.hall === 'pyres' && Math.abs(F.dunU(c.x) - 123) < 1.2 && Math.abs(F.dunV(c.z) - 49) < 1.2) || D0.cells[20];
    Dp.deepIgnite(C, null);
    sim(L, 3.5);
    const r = L.under(131, 50.5, -Math.PI / 2 - 0.2, 0.3, 5.5);
    live(L, 1.0);
    return { ...r, lit: D0.cells.filter((c) => c.heat > 0.2).length };
  });
  // a gallery slab cracking under the player (shaking, embers through its cracks), and fallen with the player in the pit
  const gallerySlab = (L) => L.H.deep.DEEP.slabs.find((s) => s.hall === 'crack' && s.u0 === 80);
  D('look6', 'deep_slab', (L) => {
    const H = L.H, Dp = H.deep, D0 = L.deepPrep(), S = gallerySlab(L);
    L.deepCalm('crack');
    if (S.st !== 0) Dp.deepSlabMend(S);
    const r = L.under(82, 49, -Math.PI / 2, 0.32, 5.0);
    Dp.deepSlabCrack(S, 1.1, null);
    live(L, 0.8);
    return { ...r, st: S.st, t: +S.t.toFixed(2) };
  });
  D('look6', 'deep_slab_fall', (L) => {
    const H = L.H, Dp = H.deep, D0 = L.deepPrep(), S = gallerySlab(L);
    L.deepCalm('crack');
    if (S.st !== 0) Dp.deepSlabMend(S);
    const r = L.under(82, 49, -Math.PI / 2, 0.32, 5.0);
    Dp.deepSlabFall(S);
    live(L, 1.0);
    const P = P0(L), F = L.F;
    // as the player sees it: the play camera follows it down into the pit
    H.CAM.mode = 'play'; H.look(-Math.PI / 2 + 0.5, 0.55, 4.2); H.CAM.near = 4.2;
    for (let i = 0; i < 3; i++) H.frame(1 / 30);
    return { st: S.st, fall: !!P.l3fall, y: +P.y.toFixed(2), slabTop: +H.look6Top(S, P.x, P.z).toFixed(2), slabY: +S.mesh.position.y.toFixed(2) };
  });
  D('look6', 'deep_throne', (L) => {
    const H = L.H, Dp = H.deep, D0 = L.deepPrep();
    L.deepCalm('ashhall');
    Dp.deepLordFresh();
    const r = L.under(55, 48.5, -Math.PI / 2, 0.16, 6.0);
    sim(L, 0.3);
    return r;
  });
  // the lord's fight: his cleave's marker before him, and his Ember Word spoken over a burning aisle
  const lordFight = (L, want) => {
    const H = L.H, F = L.F, Dp = H.deep, D0 = L.deepPrep();
    L.deepCalm('ashhall');
    const id = Dp.deepLordFresh(), K = F.getEnt(D0.lord);
    const r = L.under(36, 48.5, -Math.PI / 2, 0.22, 7.0);
    const P = P0(L);
    for (let i = 0; i < 40 && !(K.casting && K.casting.id === want); i++) {
      P.hp = P.maxHp;
      if (want === 'word') K.ai.nextWord = Math.min(K.ai.nextWord || 0, H.GAME.t);
      else if (K.ai.awake) {
        K.ai.nextWord = H.GAME.t + 60; K.ai.nextCleave = Math.min(K.ai.nextCleave || 0, H.GAME.t);
        // (within his cleave's 4.8 m: from his reach's edge he only strikes)
        if (Math.hypot(P.x - K.x, P.z - K.z) > 4.2) { const a = Math.atan2(P.x - K.x, P.z - K.z); P.x = P.prevX = K.x + Math.sin(a) * 3.6; P.z = P.prevZ = K.z + Math.cos(a) * 3.6; P.yaw = a + Math.PI; }
      }
      sim(L, 0.25);
    }
    live(L, want === 'word' ? 1.2 : 0.5);
    P.hp = P.maxHp;
    H.look(Math.atan2(K.x - P.x, K.z - P.z), 0.18, 7.0);
    return { ...r, casting: K.casting ? K.casting.id : null, lordAt: [+F.dunU(K.x).toFixed(1), +F.dunV(K.z).toFixed(1)] };
  };
  D('look6', 'deep_word', (L) => lordFight(L, 'word'));
  D('look6', 'deep_cleave', (L) => lordFight(L, 'cleave'));
  /* ---- a veteran the March can see ---- */
  D('look6', 'vet_mantle', (L) => {
    const H = L.H, F = L.F, m = H.REALMS[0].musterSite, sp = L.open(m.x + 18, m.z + 14, 4, 90) || m;
    L.hush(sp.x, sp.z, 20);
    const worn = L.vet('ashbane');
    const r = L.play(sp.x, sp.z, 0.9, 0.16, 3.6);
    sim(L, 0.4);
    return { ...r, worn, code: H.vet3.late3MantleCode(P0(L)) };
  });
  D('look6', 'vet_mantle_side', (L) => {
    const H = L.H, F = L.F, m = H.REALMS[0].musterSite, sp = L.open(m.x + 18, m.z + 14, 4, 90) || m;
    L.hush(sp.x, sp.z, 20);
    L.vet('kingsbane');
    L.play(sp.x, sp.z, 0.9, 0.16, 3.6);
    sim(L, 0.4);
    const P = P0(L), a = 0.9 + 2.2;
    return { ...L.cam(P.x + Math.sin(a) * 3.4, P.y + 1.6, P.z + Math.cos(a) * 3.4, P.x, P.y + 1.15, P.z), worn: H.late.LATE2.worn };
  });
  // the horse in its barding at a gallop, from abreast (the device on its flank)
  D('look6', 'vet_barding', (L) => {
    const H = L.H, F = L.F, sp = L.open(H.REALMS[2].musterSite.x + 34, H.REALMS[2].musterSite.z + 10, 10, 90);
    if (!sp) return { skip: 'no room' };
    L.hush(sp.x, sp.z, 45);
    L.vet('ashbane'); H.late.LATE2.vet = Math.max(5, H.late.LATE2.vet || 0);
    for (let j = -36; j <= 30; j += 1.5) H.nature.natureCut(sp.x + j, sp.z, 3.5, 1, false);
    const P = P0(L); L.play(sp.x - 24, sp.z, Math.PI / 2, 0.1, 6);
    F.mountUp(P, true); sim(L, 0.2);
    H.UI.modal = null; H.INPUT.keys.clear(); H.INPUT.keys.add('KeyW'); H.INPUT.keys.add('ShiftLeft');
    H.CAM.yaw = Math.PI / 2;
    for (let k = 0; k < 110; k++) { H.CAM.yaw = Math.PI / 2; H.simulate(1 / 60, 1 / 60); }
    live(L, 0.2, 1 / 60);
    H.INPUT.keys.clear(); H.UI.modal = null;
    // from abreast at the horse's flank, on whichever side the ground is lower (the camera on a rise looked down on it)
    const side = F.heightAt(P.x, P.z - 5) <= F.heightAt(P.x, P.z + 5) ? -1 : 1, cz = P.z + side * 4.6;
    return { ...L.cam(P.x + 0.6, Math.max(F.heightAt(P.x, cz) + 0.6, P.y + 1.35), cz, P.x + 0.3, P.y + 1.15, P.z), at: +(P.x - sp.x).toFixed(1), bard: H.vet3.late3BardCode(P), mount: !!P.mount, side };
  });
  // the standard of the name: its flag with the device, planted on the frontier, and struck down
  const plant6 = (L) => {
    const H = L.H, F = L.F, P = P0(L), Lt = H.late.LATE2, m = H.REALMS[0].musterSite, sp = L.open(m.x + 26, m.z - 18, 4, 90) || { x: m.x + 26, z: m.z - 18 };
    L.hush(sp.x, sp.z, 20);
    L.vet('kingsbane');
    Lt.std.made = true;
    const V = H.vet3.L3V; V.std.fallen = false; V.std.k = 0; V.std.hp = 1;
    if (!(Lt.std.at && Math.hypot(Lt.std.at.x - sp.x, Lt.std.at.z - sp.z) < 3)) { L.play(sp.x, sp.z, 0.7, 0.12, 6.5); if (Lt.std.at) H.late.late2StdTake(); H.late.late2StdPlant(); }
    H.vet3.late3StdPose();
    return Lt.std.at;
  };
  D('look6', 'vet_std', (L) => {
    const H = L.H, F = L.F, at = plant6(L);
    if (!at) return { skip: 'not planted' };
    L.away(at.x + 40, at.z + 40);
    sim(L, 0.5);
    const y = F.heightAt(at.x, at.z);
    return { ...L.cam(at.x + 1.6, y + 2.6, at.z + 5.4, at.x + 0.5, y + 2.9, at.z), code: H.vet3.L3V.std.code };
  });
  D('look6', 'vet_std_fallen', (L) => {
    const H = L.H, F = L.F, at = plant6(L), V = H.vet3;
    if (!at) return { skip: 'not planted' };
    L.away(at.x + 40, at.z + 40);
    V.L3V.std.fallen = true; V.L3V.std.hp = 0; V.L3V.std.side = 1;
    sim(L, 1.3);
    const y = F.heightAt(at.x, at.z);
    return { ...L.cam(at.x + 3.0, y + 2.2, at.z + 4.6, at.x - 1.6, y + 0.3, at.z), k: +V.L3V.std.k.toFixed(2) };
  });
  /* ---- the war's holds: a column from the muster, a gate mended ---- */
  // a Logres keep falls to Ériu: a column marches from Ériu's muster to fill its posts; seen on the road
  LK.w3keep = function () {
    const H = this.H, F = this.F, WAR = H.WAR;
    if (this.l6col && this.l6col.ki != null) return this.l6col;
    const ki = WAR.keeps.findIndex((k) => k.realm === 0 && k.orig === 0), K = WAR.keeps[ki];
    for (const id of [...K.guards]) { const g = F.getEnt(id); if (g) F.removeEnt(g); }
    K.guards.clear();
    if (K.door.alive) F.killEnt(K.door, null);
    F.captureKeep(K, 1, null);
    this.l6col = { ki, t: H.GAME.t };
    return this.l6col;
  };
  D('look6', 'w3_column', (L) => {
    const H = L.H, F = L.F, WAR = H.WAR, s = L.w3keep();
    const col = WAR.warbands.find((w) => w.w3col && w.w3col.keep === s.ki && !w.dead);
    if (!col) return { skip: 'no column' };
    let ms = F.wbMembers(col);
    // the column some way along its road
    for (let t = 0; t < 40 && ms.length && Math.hypot(ms[0].x - H.REALMS[1].musterSite.x, ms[0].z - H.REALMS[1].musterSite.z) < 60; t += 1) { L.away(H.REALMS[0].town.x, H.REALMS[0].town.z); sim(L, 1); ms = F.wbMembers(col); }
    if (!ms.length) return { skip: 'column gone' };
    const L0 = F.wbLeader(col) || ms[0], yaw = L0.yaw || 0, fx = Math.sin(yaw), fz = Math.cos(yaw), sx = Math.cos(yaw), sz = -Math.sin(yaw);
    live(L, 0.5);
    const c = { x: L0.x + fx * 9 + sx * 6, z: L0.z + fz * 9 + sz * 6 };
    return { ...L.eye(c.x, c.z, L0.x - fx * 3, L0.y + 1.0, L0.z - fz * 3, 2.2), n: ms.length, name: H.CW.wbName(col) };
  });
  D('look6', 'w3_gate', (L) => {
    const H = L.H, F = L.F, WAR = H.WAR, W3 = H.war3.W3;
    const ki = WAR.keeps.findIndex((k) => k.realm === 2 && k.orig === 2), K = WAR.keeps[ki], S = K.site, C = F.castleOf(S), G0 = C.gate;
    if (K.door.alive) F.killEnt(K.door, null);
    K.lastEnemyNear = -99; K.nextGuardAt = 0; F.fillGarrison && F.fillGarrison(K, true);
    const w0 = W3.stats.gateWork;
    L.away(S.x + 80, S.z + 80);
    for (let t = 0; t < 30 && W3.stats.gateWork - w0 < 3; t += 0.5) { K.lastEnemyNear = -99; sim(L, 0.5); }
    live(L, 0.6);
    const ws = [...K.guards].map(F.getEnt).filter((g) => g && g.alive && g.ai.w3g);
    const p = F.siteToWorld(S, 0, G0.gz - 7.5), t = F.siteToWorld(S, 0, G0.gz - 0.5);
    return { ...L.eye(p.x, p.z, t.x, S.y + 1.2, t.z, 1.7), workers: ws.length, work: W3.stats.gateWork - w0, door: K.door.alive };
  });
})();
// [look6] the world's checks under the Barrow too: LK.check looks at the land (|x| <= 512); the Deep Barrow's dead stand on
// their floors and in nothing solid, its chests and its pitch where they belong, a standing slab's cells ground
(function () {
  const LK = window.LK;
  LK.checkDeep = function () {
    const H = this.H, F = this.F, Dp = H.deep, D0 = Dp && Dp.DEEP, out = { counts: {}, examples: {}, n: {} };
    const add = (k, ex) => { out.counts[k] = (out.counts[k] || 0) + 1; const L = out.examples[k] = out.examples[k] || []; if (L.length < 8) L.push(ex); };
    const keys = ['a deep body sunk into its floor', 'a deep body floating', 'a deep body inside something solid', 'a deep chest inside something solid', 'pitch off the floor', 'pitch under a pyre or brazier', 'a standing slab with no ground', 'a deep torch in the rock'];
    for (const k of keys) out.counts[k] = 0;
    if (!D0 || !D0.built) return out;
    const r1 = (v) => Math.round(v * 10) / 10, near = [];
    const inside = (c, x, z, r) => { if (c.type === 'circle') return c.r + r - Math.hypot(x - c.x, z - c.z); const dx = x - c.x, dz = z - c.z, lx = dx * c.cos - dz * c.sin, lz = dx * c.sin + dz * c.cos; return Math.min(c.hx + r - Math.abs(lx), c.hz + r - Math.abs(lz)); };
    const solid = (x, z, r, skip, tags) => { F.collidersNear(x, z, r + 8, near); let best = null, bd = 0.02; for (const c of near) { if ((skip && skip(c)) || c.active === false || (tags && !tags(c))) continue; const d = inside(c, x, z, r); if (d > bd) { bd = d; best = c; } } return best ? { tag: best.tag, by: r1(bd) } : null; };
    let nb = 0;
    for (const e of H.ENT) {
      if (!e.alive || e.removed || !(e.deep || e.deepLord) || e.l3fall || e.swim || e.wd > 0.3) continue;
      nb++;
      const fy = F.dunFloorAt(e.x, e.z);
      if (!(e.deepLord && e.seat)) {
        if (e.y < fy - 0.06) add('a deep body sunk into its floor', { name: e.name, u: r1(F.dunU(e.x)), v: r1(F.dunV(e.z)), y: r1(e.y), floor: r1(fy) });
        else if (e.y > fy + 0.12 && !(e.vy > 0.01)) add('a deep body floating', { name: e.name, u: r1(F.dunU(e.x)), v: r1(F.dunV(e.z)), y: r1(e.y), floor: r1(fy) });
      }
      const s = solid(e.x, e.z, Math.min(0.25, (e.radius || 0.4) * 0.5), null, (c) => c.tag !== 'door' && c.tag !== 'gate' && !(e.deepLord && c.tag === 'prop'));
      if (s && s.by > 0.15) add('a deep body inside something solid', { name: e.name, u: r1(F.dunU(e.x)), v: r1(F.dunV(e.z)), ...s });
    }
    out.n.bodies = nb;
    for (const ch of D0.chests) {
      const s = solid(ch.x, ch.z, 0.3, (c) => c.tag === 'prop' && Math.hypot(c.x - ch.x, c.z - ch.z) < 0.2);
      if (s) add('a deep chest inside something solid', { id: ch.id, ...s });
    }
    for (const C of D0.cells) {
      const fy = F.dunFloorAt(C.x, C.z);
      if (Math.abs(fy - C.y) > 0.03) add('pitch off the floor', { i: C.i, hall: C.hall, y: r1(C.y), floor: r1(fy) });
      const s = solid(C.x, C.z, 0.2, null, (c) => c.tag === 'prop' || c.tag === 'brazier');
      if (s) add('pitch under a pyre or brazier', { i: C.i, hall: C.hall, ...s });
    }
    out.n.pitch = D0.cells.length;
    for (const S of D0.slabs) {
      if (S.st !== 0) continue;
      for (let u = S.u0; u < S.u1; u++) for (let v = S.v0; v < S.v1; v++) { const k = F.dunCellAt(F.dunWX(u + 0.5), F.dunWZ(v + 0.5)); if (k < 0 || H.DUN.cell[k] !== 4) { add('a standing slab with no ground', { i: S.i, u, v }); break; } }
    }
    for (const t of H.DUN.torches || []) {
      if (t.x < 1000 || !Dp.late3Room(t.x, t.z)) continue;
      // the flame stands over open ground in its hall (a sconce on the wall's face, its fire out in the room)
      const k = F.dunCellAt(t.x, t.z);
      if (k < 0 || !H.DUN.cell[k]) add('a deep torch in the rock', { u: r1(F.dunU(t.x)), v: r1(F.dunV(t.z)) });
    }
    return out;
  };
  const check0 = LK.check;
  LK.check = function () {
    const o = check0.call(this), d = this.checkDeep();
    for (const k in d.counts) { o.counts['deep: ' + k] = d.counts[k]; if (d.examples[k]) o.examples['deep: ' + k] = d.examples[k]; }
    o.n.deep = d.n;
    return o;
  };
})();
// [look7] (version 20) what version 19 added, as a player meets it: the realm's stores yard behind its quartermaster (and
// an enemy's set alight), a cart on the road with its horse, carter and escort (and one taken: tipped and burning), the
// towns' woodcutters and quarryman at work; the weather's systems (heaps of cumulus, a front's deck, a storm's towers over
// the frontier, rain under its cloud and dry beside it, the clouds' shadows on the land, mist in a valley at dawn, the moon
// between clouds, lightning in a storm, the wet ground under a shower, a house in a storm from inside); the dead of a fight
// lying with their gear, Cinderwing dead where it fell, a bow drawn, a staff in a cast and a shield raised; others in the
// March (remote players: tools/tests/net_fake.js, look.py serve net)
(function () {
  const LK = window.LK, D = (g, n, f) => LK.def(g, n, f);
  const sim = (L, s) => { const H = L.H, m = H.UI.modal; H.UI.modal = null; H.simulate(s, Math.min(0.05, s)); H.UI.modal = m || null; };
  const live = (L, sec, dt = 1 / 4) => { const H = L.H, m = H.UI.modal; H.UI.modal = null; for (let t = 0; t < sec - 1e-6; t += dt) H.frame(dt); H.UI.modal = m || null; };
  // the live weather with nothing in the sky but what a view makes (weather2.py's W2T.live)
  LK.wxLive = function () { const W = this.H.dbg.WEATHER, X = this.H.weather2; W.mode = 'auto'; W.next = 60; X.WX.on = true; X.calm(); X.fairSet([0.22, 0.34, 0.3]); X.WX.grid && X.WX.grid.wet && X.WX.grid.wet.fill(0); W.wet = 0; return X; };
  // the way from (x, z) at height y with the lowest horizon
  LK.openDir = function (x, z, y) {
    let best = 0, bestE = 1e9;
    for (let k = 0; k < 48; k++) { const a = k / 48 * Math.PI * 2, ux = Math.sin(a), uz = -Math.cos(a); let e = -1e9;
      for (let d = 40; d < 1600; d *= 1.18) { const hx = x + ux * d, hz = z + uz * d; if (Math.abs(hx) > 510 || Math.abs(hz) > 510) break; e = Math.max(e, (this.F.heightAt(hx, hz) - y) / d); }
      if (e < bestE) { bestE = e; best = a; } }
    return { x: Math.sin(best), z: -Math.cos(best), e: bestE };
  };
  const site = (L, kind, realm) => L.H.weather2.sites.find((s) => s.kind === kind && s.realm === realm);
  /* ---- the realm's stores ---- */
  D('look7', 'l7_yard', (L) => {
    const H = L.H, Y = H.loops.LOOPS.yards[0], Q = H.REALMS[0].quartermaster;
    if (!Y) return { skip: 'no yard' };
    const gy = L.F.heightAt(Y.x, Y.z), a = Math.atan2(Q.x - Y.x, Q.z - Y.z) + 0.35;
    return { ...L.cam(Y.x + Math.sin(a) * 10, gy + 3.2, Y.z + Math.cos(a) * 10, Y.x, gy + 0.9, Y.z), stacks: Y.n || null };
  });
  D('look7', 'l7_yard_fire', (L) => {
    const H = L.H, Y = H.loops.LOOPS.yards[1];
    if (!Y) return { skip: 'no yard' };
    Y.burn = 0; H.loops.loopsYardIgnite(Y, null); sim(L, 6); live(L, 1.0);
    const gy = L.F.heightAt(Y.x, Y.z), a = Y.yaw + 0.6;
    return { ...L.cam(Y.x + Math.sin(a) * 11, gy + 3.5, Y.z + Math.cos(a) * 11, Y.x, gy + 1.2, Y.z), burn: +Y.burn.toFixed(1) };
  });
  // a cart on its way to a keep, from beside the road
  LK.l7cart = function () {
    const H = this.H, LO = H.loops, c0 = LO.LOOPS.caravans.find((c) => c.state === 'go' && this.F.getEnt(c.horse));
    if (c0) return c0;
    const K = H.WAR.keeps.find((k) => k.owner === 0) || H.WAR.keeps[0], S = LO.keep(H.WAR.keeps.indexOf(K)); S.timber = 2; S.food = 8; S.stone = 2;
    const c = LO.loopsCarSend(0, K, true); sim(this, 40); return c;
  };
  D('look7', 'l7_cart', (L) => {
    const c = L.l7cart(); if (!c) return { skip: 'no cart' };
    const h = L.F.getEnt(c.horse); if (!h) return { skip: 'no horse' };
    const mx = (c.ax + h.x) / 2, mz = (c.az + h.z) / 2, side = c.yaw + Math.PI / 2 + 0.55, gy = L.F.heightAt(mx, mz);
    L.H.GAME.player.x = h.x + 40; L.H.GAME.player.z = h.z + 40;
    return { ...L.cam(mx + Math.sin(side) * 8.5, gy + 2.6, mz + Math.cos(side) * 8.5, mx, gy + 1.0, mz), state: c.state };
  });
  D('look7', 'l7_cart_close', (L) => {
    const c = L.l7cart(); if (!c) return { skip: 'no cart' };
    const gy = L.F.heightAt(c.ax, c.az), side = c.yaw - Math.PI / 2 - 0.4;
    return L.cam(c.ax + Math.sin(side) * 3.6, gy + 1.7, c.az + Math.cos(side) * 3.6, c.ax, gy + 0.8, c.az);
  });
  D('look7', 'l7_cart_wreck', (L) => {
    const c = L.l7cart(); if (!c) return { skip: 'no cart' };
    const h = L.F.getEnt(c.horse), ca = L.F.getEnt(c.carter);
    if (c.state !== 'wreck') { if (ca && ca.alive) L.F.killEnt(ca, null); if (h && h.alive) L.F.killEnt(h, null); if (c.state !== 'wreck') L.H.loops.loopsCarLost(c); }
    sim(L, 4); live(L, 0.8);
    const gy = L.F.heightAt(c.ax, c.az), side = c.yaw + Math.PI / 2 + 0.7;
    return { ...L.cam(c.ax + Math.sin(side) * 6, gy + 2.4, c.az + Math.cos(side) * 6, c.ax, gy + 0.6, c.az), state: c.state };
  });
  // the town's woodcutters and quarryman at their work
  const worker = (L, job, k) => {
    const H = L.H, LO = H.loops.LOOPS, T = H.REALMS[0].town, P = H.GAME.player;
    P.x = P.prevX = T.x + 3; P.z = P.prevZ = T.z + 3;
    const ws = LO.workers.map((id) => L.F.getEnt(id)).filter((e) => e && e.ai.lj && e.ai.lj.realm === 0 && e.ai.lj.job === job);
    for (const e of ws) e.ai.lj.next = Math.min(e.ai.lj.next, H.GAME.t);
    for (let i = 0; i < 160; i++) {
      sim(L, 1);
      const w = ws.find((e) => { const st = e.ai.plan && e.ai.plan.steps[e.ai.plan.i]; return st && st.k === k && st.n >= 1 && !(st.tree && st.tree.felled); });
      if (w) return w;
    }
    return null;
  };
  D('look7', 'l7_woodcutter', (L) => {
    const w = worker(L, 'wood', 'lchop'); if (!w) return { skip: 'no woodcutter at work' };
    const st = w.ai.plan.steps[w.ai.plan.i], t = st.tree, gy = L.F.heightAt(w.x, w.z), a = Math.atan2(w.x - t.x, w.z - t.z) + 1.2;
    live(L, 0.6);
    return L.cam(w.x + Math.sin(a) * 5, gy + 2.0, w.z + Math.cos(a) * 5, (w.x + t.x) / 2, gy + 1.3, (w.z + t.z) / 2);
  });
  D('look7', 'l7_quarry', (L) => {
    const w = worker(L, 'stone', 'lquarry'); if (!w) return { skip: 'no quarryman at work' };
    const gy = L.F.heightAt(w.x, w.z), a = w.yaw + 1.3;
    live(L, 0.6);
    return L.cam(w.x + Math.sin(a) * 4.5, gy + 1.9, w.z + Math.cos(a) * 4.5, w.x + Math.sin(w.yaw) * 0.8, gy + 0.9, w.z + Math.cos(w.yaw) * 0.8);
  });
  /* ---- the weather's systems ---- */
  const sky = (L, tod, fn) => { const X = L.wxLive(); L.H.setTod(tod); L.F.applyTimeOfDay(tod); L.H.farm.setSeason(0.4); const r = fn(X); L.F.weatherAdvance(5); return { ...r, keepTod: true, tod }; };
  D('look7', 'l7_heaps', (L) => sky(L, 0.5, (X) => {
    const T = site(L, 'town', 0), o = L.openDir(T.x, T.z, T.y + 4);
    X.fairSet([0.5, 0.5, 0.5]);
    return L.cam(T.x, T.y + 4, T.z, T.x + o.x * 300, T.y + 55, T.z + o.z * 300);
  }));
  D('look7', 'l7_front', (L) => sky(L, 0.55, (X) => {
    const K = site(L, 'keep', 0), o = L.openDir(K.x, K.z, K.y + 9);
    const c = X.wxMake('front', K.x + o.x * 1500, K.z + o.z * 1500, { age: 220, ang: Math.atan2(o.z, o.x) + Math.PI / 2 }); c.sp = 0;
    return L.cam(K.x, K.y + 9, K.z, K.x + o.x * 300, K.y + 45, K.z + o.z * 300);
  }));
  D('look7', 'l7_storm', (L) => sky(L, 1.05, (X) => {
    const T = site(L, 'town', 1), o = L.openDir(T.x, T.z, T.y + 8);
    const c = X.wxMake('storm', T.x + o.x * 1300, T.z + o.z * 1300, { age: 150 }); c.sp = 0;
    return L.cam(T.x, T.y + 8, T.z, T.x + o.x * 300, T.y + 40, T.z + o.z * 300);
  }));
  D('look7', 'l7_rain_edge', (L) => sky(L, 0.45, (X) => {
    const T = site(L, 'town', 0), o = L.openDir(T.x, T.z, T.y + 12);
    const c = X.wxMake('storm', T.x + o.x * 700 + o.z * 250, T.z + o.z * 700 - o.x * 250, { age: 160 }); c.sp = 0;
    return L.cam(T.x, T.y + 12, T.z, T.x + o.x * 300, T.y + 30, T.z + o.z * 300);
  }));
  // under a shower's edge on the ground: wet road and grass under it, dry beside it (the wet film by place)
  D('look7', 'l7_wet_edge', (L) => sky(L, 0.5, (X) => {
    const T = site(L, 'town', 0), c = X.wxMake('shower', T.x + 160, T.z, { age: 180, ang: 0 }); c.sp = 0; c.a = 170; c.b = 150; c.life = 1e6;
    for (let i = 0; i < 20; i++) X.updateWeather2(0.5);
    return L.cam(T.x - 20, T.y + 22, T.z + 30, T.x + 20, T.y, T.z);
  }));
  D('look7', 'l7_shadows', (L) => sky(L, 0.35, (X) => {
    const T = site(L, 'town', 2); X.fairSet([0.55, 0.55, 0.55]);
    const R = L.H.REALMS[2], p = { x: T.x - R.dx * 70, z: T.z - R.dz * 70 };
    return L.cam(p.x, L.F.heightAt(p.x, p.z) + 40, p.z, T.x, T.y, T.z);
  }));
  D('look7', 'l7_mist', (L) => sky(L, 2.85, (X) => {
    const T = site(L, 'town', 1), o = L.openDir(T.x, T.z, T.y + 25);
    const c = X.wxMake('mist', T.x + o.x * 250, T.z + o.z * 250, { age: 120 }); c.sp = 0; c.life = 1e6;
    return L.cam(T.x, T.y + 25, T.z, T.x + o.x * 300, T.y + 5, T.z + o.z * 300);
  }));
  D('look7', 'l7_moon', (L) => sky(L, 2.0, (X) => {
    const H = L.H, P = H.GAME.player; H.frame(1 / 30);
    const M = H.dbg.skyU.uMoonDir.value, cy = P.y + 3, t = (330 - cy) / Math.max(M.y, 0.05), hl = Math.hypot(M.x, M.z) || 1, sx = -M.z / hl, sz = M.x / hl;
    X.wxMake('bank', P.x + M.x * t + sx * 560, P.z + M.z * t + sz * 560, { age: 200, ang: Math.atan2(sz, sx) }).sp = 0;
    X.wxMake('bank', P.x + M.x * t * 1.6 - sx * 640, P.z + M.z * t * 1.6 - sz * 640, { age: 200, ang: Math.atan2(sz, sx) }).sp = 0;
    return L.cam(P.x, cy, P.z, P.x + M.x * 100, cy + M.y * 100 - 18, P.z + M.z * 100);
  }));
  // a storm over the player at night, lightning in the cloud
  D('look7', 'l7_lightning', (L) => sky(L, 2.1, (X) => {
    const T = site(L, 'town', 0), o = L.openDir(T.x, T.z, T.y + 6);
    const c = X.wxMake('storm', T.x + o.x * 500, T.z + o.z * 500, { age: 150 }); c.sp = 0;
    for (let i = 0; i < 6; i++) X.updateWeather2(0.5);
    X.wxCloudFlash(c.x, c.z, 500);
    return L.cam(T.x, T.y + 6, T.z, T.x + o.x * 300, T.y + 50, T.z + o.z * 300);
  }));
  // in a house in a storm: the rain at the window, none inside
  D('look7', 'l7_inside_storm', (L) => sky(L, 0.5, (X) => {
    const h = L.house(0, 1, false), D0 = h.door, i = D0.in;
    const c = X.wxMake('storm', h.x, h.z, { age: 160 }); c.sp = 0; c.life = 1e6;
    L.F.setHouseDoor && L.F.setHouseDoor(h, true);
    return { ...L.play(i.x, i.z, Math.atan2(D0.out.x - h.x, D0.out.z - h.z), 0.2, 3.0), house: h.num };
  }));
  /* ---- bodies ---- */
  // the dead of a fight lying on the field: each calling of two realms struck down
  D('look7', 'l7_dead', (L) => {
    const H = L.H, F = L.F, m = H.REALMS[0].musterSite, sp = L.open(m.x + 30, m.z - 20, 6, 120) || m;
    L.hush(sp.x, sp.z, 30);
    for (let i = -7; i <= 7; i += 1.5) for (let j = -7; j <= 7; j += 1.5) H.nature.natureCut(sp.x + i, sp.z + j, 1.2, 1, false);
    const es = [];
    ['warrior', 'archer', 'mage', 'priest'].forEach((c, i) => [0, 2].forEach((r, j) => {
      const e = F.spawnRealmUnit(r, c, 30, 'guard', sp.x + (i - 1.5) * 2.4, sp.z + (j - 0.5) * 3.2, { yaw: 0.6 + i });
      e.ai.post = { x: e.x, z: e.z, leash: 1 }; e.testLook = true; L.made.push(e); es.push(e);
    }));
    sim(L, 0.5);
    for (const e of es) { F.killEnt(e, null); e.removeAt = Infinity; }
    sim(L, 2.6);
    return L.cam(sp.x + 6.5, F.heightAt(sp.x, sp.z) + 2.8, sp.z + 6.0, sp.x, F.heightAt(sp.x, sp.z) + 0.2, sp.z);
  });
  D('look7', 'l7_dragon_dead', (L) => {
    const H = L.H, F = L.F, Dg = H.dbg.DRAGON, e = Dg.e, P0 = Dg.perches[0];
    if (!e || !P0) return { skip: 'no dragon' };
    if (e.alive || Dg.state !== 'dead') {
      try { H.bal5.flattenCraters(); } catch (err) { /* */ }
      e.alive = true; e.hp = e.maxHp; e.x = P0.x; e.z = P0.z; e.y = F.heightAt(e.x, e.z); e.yaw = 0.7; e.fixedY = null; H.dbg.setDragonState('perch'); Dg.act = null;
      const P = H.GAME.player; P.x = P.prevX = P0.x + 30; P.z = P.prevZ = P0.z + 30;
      for (let i = 0; i < 30; i++) F.dragonAnimate(1 / 30);
      e.removeAt = Infinity; F.killEnt(e, P); e.removeAt = Infinity; e.fixedY = null; e.y = F.heightAt(e.x, e.z);
      for (let i = 0; i < 150; i++) F.dragonAnimate(1 / 30);
    }
    const a = e.yaw + 1.1;
    return { ...L.cam(e.x + Math.sin(a) * 18, e.y + 5, e.z + Math.cos(a) * 18, e.x, e.y + 1, e.z), state: Dg.state };
  });
  // the callings' weapons in their use, as a fight shows them: a bow drawn, a staff in a cast, a shield raised
  D('look7', 'l7_weapons', (L) => {
    const H = L.H, F = L.F, m = H.REALMS[1].musterSite, sp = L.open(m.x + 20, m.z + 20, 6, 120) || m;
    L.hush(sp.x, sp.z, 30);
    for (let i = -6; i <= 6; i += 1.5) for (let j = -4; j <= 4; j += 1.5) H.nature.natureCut(sp.x + i, sp.z + j, 1.2, 1, false);
    const face = 0, acts = [['archer', 2, 0.75], ['mage', 3, 0.55], ['warrior', 10, 0.6], ['priest', 3, 0.5]], es = [];
    acts.forEach(([c, act, at], i) => {
      const e = F.spawnRealmUnit(1, c, 30, 'guard', sp.x + (i - 1.5) * 2.0, sp.z, { yaw: face });
      e.ai.post = { x: e.x, z: e.z, leash: 1 }; e.testLook = true; L.made.push(e); es.push([e, act, at]);
    });
    sim(L, 0.3);
    for (const [e, act, at] of es) { e.yaw = e.prevYaw = face + 1.2; e.anim.act = act; e.anim.actDur = 1000; e.anim.actT = at * 1000; }
    H.frame(1 / 60);
    for (const [e, act, at] of es) e.anim.actT = at * 1000;
    const gy = F.heightAt(sp.x, sp.z);
    return L.cam(sp.x + 1.0, gy + 1.5, sp.z + 6.5, sp.x, gy + 1.1, sp.z);
  });
  /* ---- others in the March ---- */
  D('look7', 'l7_others', (L) => {
    const H = L.H, F = L.F;
    if (!window.NF) return { skip: 'no net_fake (load tools/tests/net_fake.js)' };
    if (!H.net || H.net.NET.state === 'alone') return { skip: 'no room (look.py serve net)' };
    const T = H.REALMS[0].town, sp = L.open(T.x + 10, T.z - 6, 3, 40) || T;
    if (!LK.l7nf) {
      LK.l7nf = [
        NF.add({ name: 'Wren', realm: 0, cls: 'archer', level: 34, x: sp.x + 2, z: sp.z + 3, yaw: 2.6 }),
        NF.add({ name: 'Osric', realm: 0, cls: 'priest', level: 41, x: sp.x - 2, z: sp.z + 3.5, yaw: 3.4 }),
        NF.add({ name: 'Brannoc', realm: 1, cls: 'warrior', level: 38, walk: 'circle', cx: sp.x, cz: sp.z + 8, r: 5, speed: 3.5, x: sp.x, z: sp.z + 13 }),
      ];
    }
    for (let i = 0; i < 25; i++) { H.frame(1 / 10); }
    try { H.net.chat('r', 'To the quartermaster with the timber!'); } catch (e) { /* */ }
    const P = H.GAME.player;
    const r = L.play(sp.x, sp.z - 2, 0, 0.18, 6.5);
    live(L, 1.0);
    return { ...r, peers: Object.keys(H.net.NET.peers || {}).length };
  });
})();
0;
