/* ================================================================== */
/* townsfolk keep house: home at night and in storms, out by day; they  */
/* open the door to go in and out, see to the shutters, run from fire, */
/* and put up the scaffold to build again                              */
/* ================================================================== */
// Called from thinkVillager for every villager; returns true when it has moved the villager this step.
// A villager's routine is a short list of steps (walk, door, shutters, sit, wait, work) run in order.
function houseLife(e, dt) {
  if (e.role !== 'villager' || !HOUSES.length) return false;
  const ai = e.ai;
  if (ai.house === undefined) houseAssign(e);
  const H = ai.house;
  if (!H) return false;
  // fire first: anyone near a burning house gets out and away
  const F = houseBurningNear(e.x, e.z, 19);
  if (F && !(ai.plan && ai.plan.flee === F)) { houseFlee(e, F); }
  if (ai.plan) { if (lifeRun(e, dt)) return true; }
  if (boatLife(e, dt)) return true; // [water2] a fisher rows out in the morning (07e_boats.js)
  e.seat = null;
  if (GAME.t < (ai.lifeWait || 0)) { if (ai.lifeIdle) lifeIdle(e, dt); return true; }
  const inside = houseHas(H, e.x, e.z, -0.1);
  // a house being built again: its people help with the work
  if (H.state === 'scaffold') { lifePlan(e, houseWorkPlan(e, H)); return true; }
  if (!houseIntact(H)) { lifeWander(e); return true; }
  const shut = houseWantsShut(), day = !shut;
  const windowsToDo = H.wins.filter((w) => w.leaves.length && w.target !== (day ? 1 : 0));
  if (!day || GAME.t < (ai.visitUntil || 0)) {
    // [v9] a night (or a storm) at home: the day's first call home comes a while after going out again, not at once
    if (!day) ai.nextVisit = null;
    // home: in through the door, shutters closed for the night or the storm, then rest
    if (!inside) { lifePlan(e, houseEnterPlan(e, H)); return true; }
    if (windowsToDo.length) { lifePlan(e, houseShutterPlan(e, H, windowsToDo, day)); return true; }
    lifePlan(e, houseRestPlan(e, H, day ? 12 + Math.random() * 14 : 30 + Math.random() * 30));
    return true;
  }
  // day: open up, then out into the town
  if (inside) {
    if (windowsToDo.length) { lifePlan(e, houseShutterPlan(e, H, windowsToDo, day)); return true; }
    lifePlan(e, houseLeavePlan(e, H));
    return true;
  }
  if (farmLife(e)) return true; // [farming] farmers go out to work the town fields before anything else (08h_farming.js)
  if (GAME.t > (ai.nextVisit ?? (ai.nextVisit = GAME.t + 30 + Math.random() * 90))) {
    ai.nextVisit = GAME.t + 80 + Math.random() * 120;
    ai.visitUntil = GAME.t + 50;
    return true;
  }
  lifeWander(e);
  return true;
}
// [v10] the way round what stands between a body and where it is going, out of doors: A* on a 1 m grid over the
// colliders (houses, fences, workstations, furniture, trees; doors open for townsfolk, so they are no wall), smoothed to
// a few waypoints by sight lines over the same grid. Null when there is no way within the box (or the ends are far).
const _lpC = [];
function localPath(ax, az, bx, bz, pad = 0.45, maxSpan = 76) {
  const x0 = Math.floor(Math.min(ax, bx) - 10), z0 = Math.floor(Math.min(az, bz) - 10);
  const W = Math.ceil(Math.max(ax, bx) + 10) - x0, Hh = Math.ceil(Math.max(az, bz) + 10) - z0;
  if (W > maxSpan || Hh > maxSpan || W < 2 || Hh < 2) return null;
  const N = W * Hh, blocked = new Uint8Array(N);
  for (let j = 0; j < Hh; j++) for (let i = 0; i < W; i++) if (!isWalkable(x0 + i + 0.5, z0 + j + 0.5)) blocked[j * W + i] = 1;
  collidersNear(x0 + W / 2, z0 + Hh / 2, Math.hypot(W, Hh) / 2 + 2, _lpC);
  for (const c of _lpC) {
    if (!c.active || c.tag === 'door' || c.tag === 'hdoor' || c.vert) continue;
    const r = (c.type === 'circle' ? c.r : Math.hypot(c.hx, c.hz)) + pad;
    const i0 = Math.max(0, Math.floor(c.x - r - x0)), i1 = Math.min(W - 1, Math.floor(c.x + r - x0)), j0 = Math.max(0, Math.floor(c.z - r - z0)), j1 = Math.min(Hh - 1, Math.floor(c.z + r - z0));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const dx = x0 + i + 0.5 - c.x, dz = z0 + j + 0.5 - c.z;
      if (c.type === 'circle') { if (dx * dx + dz * dz < r * r) blocked[j * W + i] = 1; continue; }
      const lx = dx * c.cos - dz * c.sin, lz = dx * c.sin + dz * c.cos;
      if (Math.abs(lx) < c.hx + pad && Math.abs(lz) < c.hz + pad) blocked[j * W + i] = 1;
    }
  }
  const cellOf = (x, z) => clamp(Math.floor(z - z0), 0, Hh - 1) * W + clamp(Math.floor(x - x0), 0, W - 1);
  const s = cellOf(ax, az), g = cellOf(bx, bz);
  blocked[s] = 0; blocked[g] = 0;
  // A* with a binary heap of [f, cell] pairs; 8 neighbours, no corner cutting
  const gs = new Float32Array(N).fill(Infinity), from = new Int32Array(N).fill(-1), shut = new Uint8Array(N), heap = [];
  const hOf = (k) => Math.hypot((k % W) - (g % W), ((k / W) | 0) - ((g / W) | 0));
  const push = (fv, k) => { const it = [fv, k]; heap.push(it); let q = heap.length - 1; while (q > 0) { const pq = (q - 1) >> 1; if (heap[pq][0] <= fv) break; heap[q] = heap[pq]; q = pq; } heap[q] = it; };
  const pop = () => {
    const top = heap[0], last = heap.pop(), n = heap.length;
    if (n) { let q = 0; for (;;) { const l = 2 * q + 1, r2 = l + 1; let m = q, mv = last[0]; if (l < n && heap[l][0] < mv) { m = l; mv = heap[l][0]; } if (r2 < n && heap[r2][0] < mv) m = r2; if (m === q) break; heap[q] = heap[m]; q = m; } heap[q] = last; }
    return top[1];
  };
  gs[s] = 0; push(hOf(s), s);
  let found = false, guard = 0;
  while (heap.length && guard++ < N * 8) {
    const k = pop();
    if (shut[k]) continue;
    if (k === g) { found = true; break; }
    shut[k] = 1;
    const ki = k % W, kj = (k / W) | 0;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      if (!di && !dj) continue;
      const ni = ki + di, nj = kj + dj;
      if (ni < 0 || nj < 0 || ni >= W || nj >= Hh) continue;
      const n2 = nj * W + ni;
      if (blocked[n2] || shut[n2]) continue;
      if (di && dj && (blocked[kj * W + ni] || blocked[nj * W + ki])) continue;
      const ng = gs[k] + (di && dj ? 1.4142 : 1);
      if (ng < gs[n2]) { gs[n2] = ng; from[n2] = k; push(ng + hOf(n2), n2); }
    }
  }
  if (!found) return null;
  const cells = [];
  for (let k = g; k !== -1; k = from[k]) cells.push(k);
  cells.reverse();
  // smoothed: from each waypoint, on to the farthest cell in clear sight (sampled every half metre over the grid)
  const clear = (a, b) => { const ax2 = (a % W) + 0.5, az2 = ((a / W) | 0) + 0.5, bx2 = (b % W) + 0.5, bz2 = ((b / W) | 0) + 0.5, n = Math.ceil(Math.hypot(bx2 - ax2, bz2 - az2) * 2); for (let q = 1; q < n; q++) { const t = q / n, i = Math.floor(ax2 + (bx2 - ax2) * t), j = Math.floor(az2 + (bz2 - az2) * t); if (blocked[j * W + i]) return false; } return true; };
  const out = [];
  let a = 0;
  while (a < cells.length - 1) {
    let b = cells.length - 1;
    while (b > a + 1 && !clear(cells[a], cells[b])) b--;
    out.push({ x: x0 + (cells[b] % W) + 0.5, z: z0 + ((cells[b] / W) | 0) + 0.5 });
    a = b;
  }
  if (out.length) { out[out.length - 1].x = bx; out[out.length - 1].z = bz; }
  return out;
}
// each house gets its people in turn, from the town's villagers
function houseAssign(e) {
  const ai = e.ai;
  ai.house = null;
  const S = REALMS.map((R) => R.town).filter((T) => T.houseSet).sort((a, b) => dist2(a.x, a.z, e.x, e.z) - dist2(b.x, b.z, e.x, e.z))[0];
  if (!S || dist2(S.x, S.z, e.x, e.z) > 70 * 70) return;
  const recs = S.houseSet.recs;
  S.houseNext = S.houseNext || 0;
  // fill empty houses first
  let H = recs.find((h) => h.residents.length === 0);
  if (!H) H = recs[(S.houseNext++) % recs.length];
  H.residents.push(e.id);
  ai.house = H;
}

/* plans */
const lifeStep = (k, o = {}) => ({ k, ...o });
function lifePlan(e, steps, extra = {}) { e.ai.plan = { steps, i: 0, t: 0, ...extra }; }
function houseGo(x, z, o = {}) { return lifeStep('go', { x, z, ...o }); }
// from anywhere in town: round by the street in front of the door, then in
function houseEnterPlan(e, H) {
  const D = H.door, S = H.spots;
  const steps = [];
  if (!houseHas(H, e.x, e.z, -0.4)) steps.push(houseGo(D.out2.x, D.out2.z, { loose: true }), houseGo(D.out.x, D.out.z));
  steps.push(lifeStep('door', { open: true }), houseGo(D.c.x, D.c.z, { loose: true, via: H }), houseGo(D.in.x, D.in.z, { via: H, exact: true }), lifeStep('door', { open: false }));
  steps.push(houseGo(S.mid.wx, S.mid.wz, { loose: true, room: H }));
  return steps;
}
function houseLeavePlan(e, H) {
  const D = H.door;
  return [houseGo(D.in.x, D.in.z, { room: H, exact: true }), lifeStep('door', { open: true }), houseGo(D.c.x, D.c.z, { loose: true, via: H }), houseGo(D.out.x, D.out.z, { via: H }), lifeStep('door', { open: false }), houseGo(D.out2.x, D.out2.z, { loose: true })];
}
function houseShutterPlan(e, H, wins, open) {
  const steps = [];
  for (const w of wins) steps.push(houseGo(w.in.x, w.in.z, { room: H }), lifeStep('shutter', { win: w, open }));
  return steps;
}
function houseRestPlan(e, H, dur) {
  const S = H.spots, steps = [];
  if (S.seat && Math.random() < 0.6) steps.push(houseGo(S.seat.ax, S.seat.az, { room: H }), lifeStep('sit', { dur, y: H.y + S.seat.h, yaw: S.seat.wyaw, sx: S.seat.wx, sz: S.seat.wz }));
  else steps.push(houseGo(S.hearth.wx, S.hearth.wz, { room: H }), lifeStep('wait', { dur, fx: S.hearth.fx ?? H.hearth.x, fz: S.hearth.fz ?? H.hearth.z }));
  return steps;
}
// hammer at the new frame from a spot beside the scaffold
function houseWorkPlan(e, H) {
  const side = (e.id % 2) ? 1 : -1;
  const lx = H.round ? side * (H.r + 1.6) : side * (H.w / 2 + 1.7), lz = H.round ? -0.6 : -H.d * 0.15;
  const p = houseW(H, lx, lz);
  return [houseGo(p.x, p.z), lifeStep('work', { dur: 14 + Math.random() * 10, fx: H.x, fz: H.z, H })];
}
// out of a burning house by the door, then away to watch from a safe distance
function houseFlee(e, F) {
  const ai = e.ai, steps = [];
  e.seat = null;
  if (houseHas(F, e.x, e.z, -0.6)) {
    const D = F.door;
    steps.push(houseGo(D.in.x, D.in.z, { run: true, room: F, exact: true }), lifeStep('door', { open: true }), houseGo(D.c.x, D.c.z, { run: true, loose: true, via: F }), houseGo(D.out2.x, D.out2.z, { run: true, loose: true, via: F }));
  }
  // a spot away from the fire, on the town side
  let dx = e.x - F.x, dz = e.z - F.z;
  const towardTown = { x: F.S.x - F.x, z: F.S.z - F.z };
  const l = Math.hypot(dx, dz) || 1, lt = Math.hypot(towardTown.x, towardTown.z) || 1;
  dx = dx / l + (towardTown.x / lt) * 0.8; dz = dz / l + (towardTown.z / lt) * 0.8;
  const ll = Math.hypot(dx, dz) || 1;
  let tx = F.x + (dx / ll) * 22, tz = F.z + (dz / ll) * 22;
  for (let k = 0; k < 8 && (!isWalkable(tx, tz) || houseAt(tx, tz, 1.2)); k++) { const a = Math.random() * TAU; tx = F.S.x + Math.cos(a) * 8; tz = F.S.z + Math.sin(a) * 8; }
  steps.push(houseGo(tx, tz, { run: true, loose: true }), lifeStep('watch', { H: F }));
  lifePlan(e, steps, { flee: F });
  ai.lifeWait = 0;
}

/* running a plan, one step at a time */
function lifeRun(e, dt) {
  const ai = e.ai, plan = ai.plan, st = plan.steps[plan.i];
  if (!st) { ai.plan = null; return false; }
  plan.t += dt;
  const H = ai.house, next = () => { plan.i++; plan.t = 0; if (st.k === 'sit') e.seat = null; };
  // a step that cannot be finished is given up, and the villager thinks again shortly
  const giveUp = () => { e.seat = null; ai.plan = null; ai.lifeWait = GAME.t + 2 + Math.random() * 3; ai.lifeIdle = true; };
  switch (st.k) {
    case 'go': {
      // a door shut in the way is pushed open again
      const Fh = st.via;
      if (Fh && houseIntact(Fh) && Fh.door.leaf.target === 0 && dist2(e.x, e.z, Fh.door.c.x, Fh.door.c.z) < 2.6 * 2.6) { setAct(e, 5, 0.5); setHouseDoor(Fh, true, e); }
      // in a room the way goes round the furniture
      if (st.room && !st.path) st.path = houseRoute(st.room, e.x, e.z, st.x, st.z) || [{ x: st.x, z: st.z }];
      let tx = st.x, tz = st.z, last = true;
      if (st.path) {
        while (st.path.length > 1 && dist2(e.x, e.z, st.path[0].x, st.path[0].z) < 0.3 * 0.3) st.path.shift();
        tx = st.path[0].x; tz = st.path[0].z; last = st.path.length === 1;
      }
      // outdoors the way is a straight line, and it can meet a workstation, a well, a fence or a cart: when no headway
      // is made, step round whatever is in the way, first one side and then the other
      if (!st.room && dist2(e.x, e.z, tx, tz) > 1.4 * 1.4) {
        const dNow = Math.hypot(tx - e.x, tz - e.z);
        const tr = st.track || (st.track = { x: e.x, z: e.z, t: plan.t, d: dNow });
        if (plan.t - tr.t > 1.5) {
          const gained = (tr.d ?? dNow) - dNow; // nearer the goal, not just moving: sliding along a wall is no headway
          st.track = { x: e.x, z: e.z, t: plan.t, d: dNow };
          if (gained < 0.5 && !st.detour) {
            const dx = tx - e.x, dz = tz - e.z, l = Math.hypot(dx, dz) || 1, sd = (st.turn = -(st.turn || (e.id % 2 ? 1 : -1))), w = 2.4 + (st.tries = (st.tries || 0) + 1) * 0.9;
            st.detour = { x: e.x + (-dz / l) * sd * w - (dx / l) * 0.8, z: e.z + (dx / l) * sd * w - (dz / l) * 0.8, until: plan.t + 2.8 };
          }
        }
        if (st.detour) {
          if (moveToward(e, st.detour.x, st.detour.z, dt, st.run ? 1.65 : 0.9, 0.4) || plan.t > st.detour.until) st.detour = null;
          if (plan.t > 28) giveUp();
          return true;
        }
      }
      const done = moveToward(e, tx, tz, dt, st.run ? 1.65 : 0.9, last ? (st.loose ? 0.6 : st.exact ? 0.1 : 0.28) : 0.22) && last;
      if (done) next();
      else if (plan.t > (st.tries ? 28 : 16)) giveUp();
      return true;
    }
    case 'door': {
      const Fh = plan.flee || H, want = st.open ? 1 : 0;
      turnToward(e, Fh.door.c.x, Fh.door.c.z, dt * 8);
      if (!houseIntact(Fh) || (Fh.door.leaf.target === want && !st.acted)) { next(); return true; }
      if (!st.acted) { st.acted = true; setAct(e, 5, 0.6); }
      if (plan.t > 0.28 && !st.done) {
        if (setHouseDoor(Fh, st.open, e)) st.done = true;
        else if (plan.t > 3) { next(); return true; } // someone stands in the doorway: leave it
      }
      if (st.done && plan.t > 0.62) next();
      return true;
    }
    case 'shutter': {
      const w = st.win;
      turnToward(e, w.c.x, w.c.z, dt * 8);
      if (!st.acted) { st.acted = true; setAct(e, 5, 0.6); }
      if (plan.t > 0.3 && !st.done) { st.done = true; setHouseShutters(H, w, st.open, e); }
      if (plan.t > 0.75) next();
      return true;
    }
    case 'sit': {
      // settle onto the seat (the bench is inside the table's footprint), and get up the same way
      if (!st.started) { st.started = true; st.night = houseWantsShut(); st.ax = e.x; st.az = e.z; }
      const k = clamp(plan.t / 0.45, 0, 1);
      e.x = lerp(st.ax, st.sx, k); e.z = lerp(st.az, st.sz, k);
      if (k >= 1 && !e.seat) e.seat = { y: st.y };
      e.yaw += clamp(angDiff(e.yaw, st.yaw), -dt * 5, dt * 5);
      if (plan.t > st.dur || (houseWantsShut() !== st.night && plan.t > 3)) { e.seat = null; e.x = st.ax; e.z = st.az; e.prevX = e.x; e.prevZ = e.z; next(); }
      return true;
    }
    case 'wait': {
      turnToward(e, st.fx, st.fz, dt * 4);
      if (plan.t > st.dur) next();
      return true;
    }
    case 'watch': {
      turnToward(e, st.H.x, st.H.z, dt * 3);
      if (st.H.state !== 'burning' && plan.t > 6) { ai.plan = null; ai.lifeWait = GAME.t + 3 + Math.random() * 6; ai.lifeIdle = false; }
      return true;
    }
    case 'work': {
      const W = st.H;
      if (W.state !== 'scaffold') { next(); return true; }
      turnToward(e, st.fx, st.fz, dt * 4);
      st.next = st.next ?? plan.t + 0.4;
      if (plan.t >= st.next) {
        st.next = plan.t + 1.0 + Math.random() * 0.5;
        setAct(e, 1, 0.6);
        later(0.3, () => { if (e.alive) houseSfx('hammer', e.x, e.y + 1.3, e.z); });
      }
      if (plan.t > st.dur) next();
      return true;
    }
    case 'farm': return farmLifeStep(e, st, plan, dt, next); // [farming] tilling, sowing, weeding, harvesting a strip (08h_farming.js)
    default: next(); return true;
  }
}
// walking about the town between errands, keeping clear of the houses
function lifeWander(e) {
  const ai = e.ai;
  if (!ai.wander || GAME.t > ai.wanderUntil || (ai.wanderT || 0) > 12) {
    let x = e.x, z = e.z;
    for (let k = 0; k < 12; k++) {
      const a = Math.random() * TAU, r = 4 + Math.random() * e.home.r;
      x = e.home.x + Math.cos(a) * r; z = e.home.z + Math.sin(a) * r;
      if (isWalkable(x, z) && !houseAt(x, z, 1.4)) break;
    }
    ai.wander = { x, z };
    ai.wanderUntil = GAME.t + 6 + Math.random() * 10;
    ai.wanderT = 0;
  }
  ai.wanderT = (ai.wanderT || 0) + GAME.dt;
  if (moveToward(e, ai.wander.x, ai.wander.z, GAME.dt, 1, 0.6)) ai.wanderT = 0;
}
function lifeIdle(e, dt) { /* catch breath where you are */ }

/* ------------------------------------------------------------------ */
/* finding the way across a room                                       */
/* ------------------------------------------------------------------ */
// a grid over the floor, a quarter metre to a cell, free where a body fits between the walls and the furniture
function houseGrid(H) {
  if (H.grid) return H.grid;
  const cs = 0.25, ext = (H.round ? H.ri : Math.max(H.iw, H.id)) + 0.25, n = Math.ceil((2 * ext) / cs) + 1;
  const free = new Uint8Array(n * n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const w = houseW(H, -ext + i * cs, -ext + j * cs);
    free[j * n + i] = houseHas(H, w.x, w.z, 0.4) && !H.furnColl.some((c) => collCovers(c, w.x, w.z, 0.36)) ? 1 : 0;
  }
  return (H.grid = { cs, ext, n, free });
}
// waypoints from (ax, az) to (bx, bz) inside H, round the furniture; null if either end is not in the room
function houseRoute(H, ax, az, bx, bz) {
  const G2 = houseGrid(H), { cs, ext, n, free } = G2;
  const cell = (x, z) => { const l = houseL(H, x, z); return [Math.round((l.x + ext) / cs), Math.round((l.z + ext) / cs)]; };
  const nearestFree = ([i, j]) => {
    if (i >= 0 && j >= 0 && i < n && j < n && free[j * n + i]) return [i, j];
    for (let r = 1; r < 6; r++) for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) {
      const a = i + di, b = j + dj;
      if (a >= 0 && b >= 0 && a < n && b < n && free[b * n + a]) return [a, b];
    }
    return null;
  };
  const s = nearestFree(cell(ax, az)), g = nearestFree(cell(bx, bz));
  if (!s || !g) return null;
  const key = (i, j) => j * n + i, gk = key(g[0], g[1]);
  const open = [[s[0], s[1], 0, 0]], best = new Map([[key(s[0], s[1]), 0]]), from = new Map();
  let found = false, guard = 0;
  while (open.length && guard++ < 4000) {
    let bi = 0;
    for (let k = 1; k < open.length; k++) if (open[k][3] < open[bi][3]) bi = k;
    const [i, j, c] = open.splice(bi, 1)[0];
    if (key(i, j) === gk) { found = true; break; }
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      if (!di && !dj) continue;
      const a = i + di, b = j + dj;
      if (a < 0 || b < 0 || a >= n || b >= n || !free[b * n + a]) continue;
      if (di && dj && (!free[j * n + a] || !free[b * n + i])) continue;
      const nc = c + (di && dj ? 1.414 : 1), k = key(a, b);
      if (nc >= (best.get(k) ?? Infinity)) continue;
      best.set(k, nc); from.set(k, key(i, j));
      open.push([a, b, nc, nc + Math.hypot(a - g[0], b - g[1])]);
    }
  }
  if (!found) return null;
  const cells = [];
  for (let k = gk; k !== undefined; k = from.get(k)) cells.push([k % n, Math.floor(k / n)]);
  cells.reverse();
  // keep only the corners the straight line cannot cut
  const clear = (p, q) => {
    const steps = Math.ceil(Math.hypot(q[0] - p[0], q[1] - p[1]) * 2);
    for (let t = 1; t < steps; t++) { const i = Math.round(p[0] + (q[0] - p[0]) * t / steps), j = Math.round(p[1] + (q[1] - p[1]) * t / steps); if (!free[j * n + i]) return false; }
    return true;
  };
  const pts = [cells[0]];
  for (let k = 1; k < cells.length; k++) if (!clear(pts[pts.length - 1], cells[k])) pts.push(cells[k - 1]);
  pts.push(cells[cells.length - 1]);
  const out = pts.slice(1).map(([i, j]) => houseW(H, -ext + i * cs, -ext + j * cs));
  out.push({ x: bx, z: bz });
  return out;
}
