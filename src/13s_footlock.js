/* ================================================================== */
/* [polish] planted feet: each foot stays where it came down            */
/* ================================================================== */
// The walk shaders put a foot where the gait says it should be for its phase (HUMAN_GAIT, beastBodyGLSL), which keeps it
// planted only while the body goes straight ahead along its facing at a steady pace. A body shoved aside (by a crowd, a
// wall it slides along, a rock), a runner whose facing has not caught up with a sharp cut, one turning on the spot or
// round a tight bend, all moved their planted feet with them, and the gait set every foot on the slope's line through
// the body (on a stair, between the treads). Here each foot is followed on the CPU: when it comes down its place on the
// ground is kept, on the floor there (a tread, a bump), and while it bears weight the shaders are told how far that place
// lies from where the gait alone would put it (along the body and across it, and how high its floor stands over the
// body's own, in metres): the leg reaches for it (along by its IK, across by swinging out at the hip or the shoulder,
// down and up by its IK). In the air the difference eases from where it lifted off to where the coming stance should
// start (half of what the body's own motion will move the foot over a stance, so a body going sideways steps out that
// way), and the foot passes over the floor under it on the way (a stair's nosing, a hump). Rows of a float texture
// (FOOT_LOCK, 05a_rig.js), one per body drawn near the camera with a foot held.
const FL_MAX = 0.42; // beyond this a planted foot gives way and is dragged (a body shoved a long way)
// [motion3] the lock's reach: bodies within FL_NEAR m of the camera have their feet followed and get a row (FOOT_LOCK.H,
// 05a_rig.js: 1024); farther off the gait alone draws them (a centimetre there is under a pixel), and their feet are
// not followed at all, which saves the work in a big battle
const FL_NEAR = 75;
const FL_GIVE = 0.03, FL_HOP_T = 0.16, FL_HOP_H = 0.07; // [motion3] a quick step: past the leg's reach by FL_GIVE m, the foot is lifted FL_HOP_H m and set down again in FL_HOP_T s
const flNear = (e, r) => { const dx = e.x - camera.position.x, dz = e.z - camera.position.z; return dx * dx + dz * dz < r * r; };
const _flSS = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
// a person's feet: [u (0..1 round its cycle), duty, reach (m), x (its side, m)] for the left (0) and the right (1)
function flHumanGait(e, f) {
  const sc = e.scale || 1, amt = e.anim.turn > 0.05 && e.anim.amt < 0.15 ? 0 : clamp(e.anim.amt, 0, 2.2), vel = amt * 4.3 / Math.max(sc, 0.3); // (as drawActors sends it: stepping round, no walk)
  const runK = _flSS(2.4, 4.4, vel), duty = lerp(0.58, 0.26, runK) - 0.06 * _flSS(6.5, 9.0, vel);
  const reach = duty * humanStep(vel) * sc;
  const uL = ((((e.anim.phase - Math.PI / 2) / TAU) % 1) + 1) % 1, u = f ? (uL + 0.5) % 1 : uL;
  return [u, duty, reach, (f ? -1 : 1) * SK.ankle[0] * sc, 0];
}
// a beast's (bbGait, 05c_beasts.js): the four legs front left, front right, hind left, hind right
function flBeastGait(S, ph, amtRaw, sc, f) {
  const amt = clamp(amtRaw, 0, 1.6), trot = _flSS(0.55, 0.95, amt), gal = _flSS(1.05, 1.4, amt);
  const gz = S.front.top[1] - S.front.foot[1], gw = S.back.top[1] - S.back.foot[1];
  const amtS = clamp(amtRaw, 0, 2.2), vSpd = amtS * 4.3, bsc = Math.max(sc, 0.2), fC = Math.sqrt(1.06 / Math.max(gz * bsc, 0.05));
  const strideM = clamp(lerp(S.stride[0], S.stride[1], _flSS(0.7, 1.4, amtS)), vSpd / (4 * fC * bsc), Math.max(vSpd / (1.6 * fC * bsc), 0.02));
  const reachL = Math.min(gz, gw) / strideM;
  const duty = Math.min(lerp(lerp(0.64, 0.46, trot), 0.26, gal), lerp(0.42, 0.46, gal) * reachL);
  // [motion3] the walk's lateral sequence, the trot's diagonal pairs, the gallop spread by its own duty (bbGait)
  const dG = Math.min(0.26, 0.46 * reachL), gp = 0.12, gq = clamp(0.8 * dG, 0.1, 0.22);
  const W = [0, 3.1416, 1.5708, 4.7124], T = [0, 3.1416, 3.1416, 6.2832], G = [0.5 - gp - gq, 0.5 - gq, 0.5, 0.5 + gp];
  const off = lerp(lerp(W[f], T[f], trot), G[f] * 6.28318, gal);
  const u = ((((ph + off - Math.PI / 2) / TAU) % 1) + 1) % 1, F = f < 2 ? S.front.foot : S.back.foot;
  return [u, duty, duty * strideM * bsc, (f % 2 ? -1 : 1) * F[0] * bsc, F[2] * bsc];
}
// one step of the lock for a body (from updateAnim, after its phase moved on); the horse under a rider has its own
function footLockStep(e, dt) {
  if (!flNear(e, FL_NEAR * 1.15)) { e._fl = e._flH = null; e._flX = e.x; e._flZ = e.z; return; } // [motion3] far off: not followed (planted afresh when it comes near)
  const human = e.kind === 'humanoid', S = !human ? BEASTS[e.crowd || e.kind] : null;
  const onFeet = e.alive && !e.seat && !e.boat && !e.swim && !e.dive && e.fixedY == null && e.onGround !== false && !e.flying && !(e.motion && e.motion.kind === 'leap');
  // the body's own motion this step, in its frame (across, along)
  const c = Math.cos(e.yaw), s = Math.sin(e.yaw), mx = e.x - (e._flX ?? e.x), mz = e.z - (e._flZ ?? e.z), idt = 1 / Math.max(dt, 1e-4);
  e._flX = e.x; e._flZ = e.z;
  const vx = (mx * c - mz * s) * idt, vz = (mx * s + mz * c) * idt;
  if (human && e.mount && onFeet) footLockFeet(e, e._flH || (e._flH = []), 4, (f) => flBeastGait(BEASTS.horse, e.mountAnim.phase, e.mountAnim.amt, 1, f), e.mountAnim.amt < 0.02, dt, vx, vz);
  else e._flH = null;
  if (!onFeet || e.mount || (!human && !(S && S.front)) || e.role === 'bird') { e._fl = null; return; }
  const still = e.anim.amt < 0.02 && !(e.anim.turn > 0.05);
  footLockFeet(e, e._fl || (e._fl = []), human ? 2 : 4, human ? (f) => flHumanGait(e, f) : (f) => flBeastGait(S, e.anim.phase, e.anim.amt, e.scale || 1, f), still, dt, vx, vz);
}
// the floor under a foot at (x, z): a stair's tread, a deck, the ground (a drop beyond a step, off a wall walk's edge or a
// jetty's, is no floor for it: then the body's own)
let _flTread = false; // (the last floor flFloor found was a stair's tread: the foot stands level on it)
function flFloor(e, x, z) {
  const y = e.y;
  if (e.kind !== 'humanoid') { const h = floorTreadAt(x, z, y + 0.5); if (Math.abs(h - y) > 0.6) { _flTread = false; return y; } return h; }
  // a person's sole, heel to toe along the facing, stands on the highest floor under it: a foot by a stair's riser stands
  // on the next tread with its heel out over the edge, never with its toes in the stone (a third of the steps did)
  const sc = e.scale || 1, fx = Math.sin(e.yaw) * sc, fz = Math.cos(e.yaw) * sc;
  let best = -Infinity, tread = false;
  for (const k of FL_SOLE) {
    const h = floorTreadAt(x + fx * k, z + fz * k, y + 0.5);
    if (Math.abs(h - y) > 0.6) continue;
    if (h > best) { best = h; tread = _flTread; }
  }
  _flTread = best > -Infinity && tread;
  return best > -Infinity ? best : y;
}
const FL_SOLE = [-0.05, 0.05, 0.15]; // (from the ankle: the heel, the middle of the sole, the toes)
// floorAt, but on a castle's flight of steps the tread over that point: a flight is one ramp from its foot to its landing
// (castleFlight, 04g_castles.js), which joins the treads' back edges, so a foot set on the ramp stood up to a riser
// below the stone it was drawn on (the treads: n of them, each as high as the ramp at its upper end)
function floorTreadAt(x, z, y) {
  const g = floorAt(x, z, y);
  _flTread = false;
  if (y == null || x > DUN_X0) return g;
  const list = FLOOR.grid.get(collKey(Math.floor(x / FLOOR.cell), Math.floor(z / FLOOR.cell)));
  if (!list) return g;
  for (const f of list) {
    if (!f.active || !f.flight || f.type !== 'box' || f.yb === f.ya) continue;
    const t = floorTopOf(f, x, z);
    if (t === null || Math.abs(t - g) > 1e-4) continue; // (the flight is not what stands highest here)
    const fl = f.flight, n = Math.max(2, Math.round((fl.y1 - fl.y0) / 0.27)), frac = clamp((t - f.ya) / (f.yb - f.ya), 0, 1);
    _flTread = true;
    return f.ya + (f.yb - f.ya) * Math.min(n, Math.floor(frac * n + 1e-6) + 1) / n;
  }
  _flTread = false;
  return g;
}
function footLockFeet(e, L, n, gait, still, dt, vx, vz) {
  const c = Math.cos(e.yaw), s = Math.sin(e.yaw);
  const at = (o, x0, along, cx, cz) => { const lx = x0 + cx, lz = along + cz; o.wx = e.x + lx * c + lz * s; o.wz = e.z - lx * s + lz * c; };
  for (let f = 0; f < n; f++) {
    const [u, duty, reach, x0, z0] = gait(f);
    const o = L[f] || (L[f] = { down: false, wx: 0, wz: 0, cx: 0, cz: 0, lx: 0, lz: 0, u, tx: 0, tz: 0, human: n === 2 });
    const down = still || u < duty;
    // where the gait alone puts this foot now (along: its rest place and the stance's way back under the body)
    const along = z0 + (u < duty ? reach * (1 - 2 * u / duty) : 0);
    o.g = [u, duty, reach, x0, z0]; o.along = along;
    // where to come down so the coming stance is spent about the gait's place: half of what the motion will move the foot
    // in the body's frame over a stance (a body going sideways steps out to that side; feet that keep pace with the gait
    // need nothing)
    const du = ((u - o.u) % 1 + 1) % 1 / Math.max(dt, 1e-4);
    o.u = u;
    // [motion3] across, how far the leg reaches: in under the body no farther than the shaders let it (people 0.12 m past
    // their own line, beasts 0.85 of the way to the middle), out to 0.45 m
    const sc = e.scale || 1, inL = o.human ? 0.12 * sc : 0.85 * Math.abs(x0), outL = 0.45 * sc;
    const lo = x0 > 0 ? -inL : -outL, hi = x0 > 0 ? outL : inL;
    if (du > 0.05 && du < 8) {
      const Tst = duty / du, k = 1 - Math.exp(-dt * 8);
      // [motion3] the whole stance kept within that reach: a foot that will travel in under the body comes down farther
      // out, one that travels out comes down as far in as it may (a stance centred on the gait's place ran into the inner
      // limit and was dragged: a walker shoved aside 10 cm)
      const d = -vx * Tst, a = lo - Math.min(0, d), b = hi - Math.max(0, d);
      o.tx = lerp(o.tx, a <= b ? clamp(-d / 2, a, b) : (lo + hi - d) / 2, k);
      o.tz = lerp(o.tz, clamp((vz - 2 * reach / Math.max(duty, 0.05) * du) * Tst / 2, -0.25, 0.25), k);
    } else { o.tx *= 0.9; o.tz *= 0.9; }
    if (down) {
      // it comes down where the gait puts it with what the swing brought it to (o.cx, o.cz); its place on the ground is
      // taken where the body is drawn next (footLockSlot: the player moves after its gait steps, so a place taken here
      // would be a step behind)
      if (!o.down) { o.fresh = true; o.hop = 0; }
      if (o.hop > 0) {
        // [motion3] a quick step: lifted off a place the leg could no longer hold, carried to where the rest of the stance
        // can be spent, and set down again (FL_HOP_T s, FL_HOP_H m high: footLockSlot raises it)
        o.hop = Math.min(1, o.hop + dt / FL_HOP_T);
        const k = _flSS(0.15, 0.85, o.hop);
        o.cx = lerp(o.hx, o.tx, k); o.cz = lerp(o.hz, o.tz, k);
        if (o.hop >= 1) { o.hop = 0; o.fresh = true; }
      } else if (!o.fresh) {
        // the planted place in the body's frame, against the gait's
        const dx = o.wx - e.x, dz = o.wz - e.z;
        let cx = dx * c - dz * s - x0, cz = dx * s + dz * c - along;
        const m = Math.hypot(cx, cz);
        if (m > FL_MAX * 1.6) { cx = o.tx; cz = o.tz; at(o, x0, along, cx, cz); } // a jump (set down somewhere new): planted afresh
        else if ((m > FL_MAX || cx < lo - FL_GIVE || cx > hi + FL_GIVE) && !still) {
          // [motion3] beyond what the leg can hold (in under the body past its limit, or too far off): it steps (a cut at a
          // sprint or a hard shove dragged the foot along the ground 10 cm and more)
          const k = m > FL_MAX ? FL_MAX / m : 1;
          o.hop = 1e-4; o.hx = clamp(cx * k, lo, hi); o.hz = cz * k; cx = o.hx; cz = o.hz;
        }
        o.cx = cx; o.cz = cz;
      }
      o.lx = o.cx; o.lz = o.cz;
    } else {
      if (o.down) o.hL = o.h == null ? null : o.h + (o.hop > 0 ? FL_HOP_H * Math.sqrt(Math.sin(Math.PI * o.hop)) : 0); // (the floor it lifts off; [motion3] or the height of a quick step it was taking)
      o.fresh = false; o.hop = 0;
      // in the air: from where it lifted off to where it will come down, over the swing
      // [motion3] a person's foot is near the ground at both ends of its swing: it moves across only once it has risen and
      // is there before it comes down (it came down still moving aside, a centimetre a frame); a beast's swing is all up
      // in the air (it rises and comes down in place in the stance's ends, bbFoot)
      const w = clamp((u - duty) / Math.max(1 - duty, 0.05), 0, 1), k = o.human ? _flSS(0.12, 0.75, w) : w * w * (3 - 2 * w);
      o.cx = lerp(o.lx, o.tx, k); o.cz = lerp(o.lz, o.tz, k);
      // the floor where it will come down (a tread, a bump, a slope's rise), and the floor under it now: it passes over a
      // stair's nosing or a hump on the way, not through it
      const lx = x0 + o.tx, lz = z0 + reach + o.tz;
      o.hT = flFloor(e, e.x + lx * c + lz * s, e.z - lx * s + lz * c); o.treadT = _flTread;
      const q = 1 - w, ee = w * w * (3 - 2 * w) - (1 - duty) / Math.max(duty, 0.05) * (o.human ? 0.5 * w * q ** 4 - q * w ** 4 : w * q ** 4 - q * w ** 4); // [motion3] (a person's footPath: half the pace leaving, the whole pace landing)
      const nx = x0 + o.cx, nz = z0 + reach * (2 * ee - 1) + o.cz;
      o.hN = flFloor(e, e.x + nx * c + nz * s, e.z - nx * s + nz * c);
      o.w = w;
    }
    o.down = down;
  }
}
// drawActors: the body's row for this frame (1 + its row; 0: nothing held), its feet's differences written into it. A
// planted foot's difference is taken again from where the body is now: the player moves and turns after its gait steps
// (updatePlayer), and a foot read a step late moved with the body for that step (18 cm in a sharp cut at a sprint)
function footLockSlot(e, horse) {
  const L = horse ? e._flH : e._fl;
  if (!L || FOOT_LOCK.n >= FOOT_LOCK.H || !flNear(e, FL_NEAR)) return 0; // [motion3] only near the camera
  const c = Math.cos(e.yaw), s = Math.sin(e.yaw);
  let any = false;
  for (const o of L) {
    if (!o) continue;
    if (o.down && o.g && o.fresh) {
      // planted since the last frame: its place is where it is drawn now, on the floor there
      const lx = o.g[3] + o.cx, lz = o.along + o.cz;
      o.wx = e.x + lx * c + lz * s; o.wz = e.z - lx * s + lz * c; o.fresh = false;
      o.h = flFloor(e, o.wx, o.wz); o.tread = _flTread;
    }
    if (o.down && o.h == null) { o.h = flFloor(e, o.wx, o.wz); o.tread = _flTread; }
    // how high its floor stands over the body's own: planted, its own place's; in the air, from the floor it left to the
    // floor it will land on
    const hy = o.down ? o.h + (o.hop > 0 ? FL_HOP_H * Math.sqrt(Math.sin(Math.PI * o.hop)) : 0) : Math.max(lerp(o.hL ?? e.y, o.hT ?? e.y, (o.w ?? 0) * (o.w ?? 0) * (3 - 2 * (o.w ?? 0))), o.hN ?? -1e9); // [motion3] (a quick step raised)
    // (a person's leg reaches little below where it stands: a foot left too far below as the body climbs is drawn up)
    o.dy = clamp((hy ?? e.y) - e.y, e.kind === 'humanoid' && !horse ? -0.2 : -0.45, 0.45);
    if (o.down && o.g && !(o.hop > 0)) {
      const dx = o.wx - e.x, dz = o.wz - e.z;
      let cx = dx * c - dz * s - o.g[3], cz = dx * s + dz * c - o.along;
      const m = Math.hypot(cx, cz);
      if (m > FL_MAX) { const k = m > FL_MAX * 1.6 ? 0 : FL_MAX / m; cx *= k; cz *= k; }
      o.dx = cx; o.dz = cz;
      o.lx = cx; o.lz = cz; // (the swing starts from what was drawn: the player's step reads it a step late, 12 cm at a run)
    } else { o.dx = o.cx; o.dz = o.cz; }
    if (Math.abs(o.dx) > 0.002 || Math.abs(o.dz) > 0.002 || Math.abs(o.dy) > 0.004) any = true;
  }
  if (!any) return 0;
  // (a beast stands tilted with the slope along it, beastLeanYaw: its feet's heights are what the tilt leaves)
  const tilt = horse || e.kind !== 'humanoid' ? clamp(Math.round((e._bslope || 0) * 20), -20, 20) * 0.05 : 0;
  const r = FOOT_LOCK.n++, D = FOOT_LOCK.data;
  for (let f = 0; f < 4; f++) { const o = L[f], k = (r * FOOT_LOCK.W + f) * 4; D[k] = o ? o.dx : 0; D[k + 1] = o ? o.dz : 0; D[k + 2] = o ? o.dy - tilt * (o.along + o.dz) : 0; D[k + 3] = o && (o.down ? o.tread : o.treadT) ? 2 : 1; } // (w: 2 on a stair's tread, where a person's foot stands level)
  return r + 1;
}
function footLockBegin() { FOOT_LOCK.n = 0; }
function footLockEnd() { if (FOOT_LOCK.n || FOOT_LOCK.was) FOOT_LOCK.tex.needsUpdate = true; FOOT_LOCK.was = FOOT_LOCK.n; }
window.__hm.footLock = { FOOT_LOCK, footLockStep, flHumanGait, flBeastGait, footLockSlot, floorTreadAt };
