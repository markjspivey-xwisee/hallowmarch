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
// way; [motion3] across, both places kept still on the ground while the body moves on), and the foot passes over the
// floor under it on the way (a stair's nosing, a hump). Rows of a float texture
// (FOOT_LOCK, 05a_rig.js), one per body drawn near the camera with a foot held.
const FL_MAX = 0.42; // beyond this a planted foot gives way ([motion3] it takes a quick step: it was dragged, a body shoved a long way)
const FL_JUMP = 1.5; // [motion3] a planted foot this far from the gait's place: the body was set down somewhere new (planted afresh)
// [motion3] the lock's reach: bodies within FL_NEAR m of the camera have their feet followed and get a row (FOOT_LOCK.H,
// 05a_rig.js: 1024); farther off the gait alone draws them (a centimetre there is under a pixel), and their feet are
// not followed at all, which saves the work in a big battle
const FL_NEAR = 75;
const FL_UP = 0.8; // [motion3] how far over the body a person's foot may stand (a high step up a flight)
// [motion3] a quick step: past the leg's reach (by FL_GIVE m: the shaders hold a foot across only as far as that reach,
// so one held past it was dragged along the ground, 3 cm and more), the foot is lifted FL_HOP_H m and set down again in
// FL_HOP_T s; a stance is placed FL_MARGIN m inside that reach, so a steady one never comes to it
const FL_GIVE = 0.004, FL_HOP_T = 0.16, FL_HOP_H = 0.07, FL_MARGIN = 0.015, FL_HOLD_IN = 0.25;
// [motion4] a sharp cut at a sprint: the player's facing swings 0.2 rad a frame and its way at once, faster than any leg,
// and a planted foot's place could pass out of the leg's reach between one frame and the next (16 cm aside and 10 cm
// round): the shaders then drew it where the leg could still reach, over the ground (2 to 24 cm, at one cut in five
// across the stride). Now a foot the leg cannot draw where it stands (across, after the lean: flCanReach) or turn to its
// own heading (FL_YAW) is lifted in that very frame; a quick step clears the ground in its first frame (FL_HOP_POW: 4.7
// cm at once); where a swinging foot will come down is kept in the world from its last frames in the air (FL_LATCH_W),
// and a landing the leg cannot reach is taken in the air instead (FL_AIR_H over the ground, then a quick step)
const FL_YAW = 0.9, FL_HOP_POW = 0.35, FL_HOP_LIFT = 0.1, FL_LATCH_W = 0.85, FL_AIR_H = 0.055;
const flHopH = (hop) => FL_HOP_H * Math.pow(Math.max(Math.sin(Math.PI * clamp(hop, 0, 1)), 0), FL_HOP_POW);
const flNear = (e, r) => { const dx = e.x - camera.position.x, dz = e.z - camera.position.z; return dx * dx + dz * dz < r * r; };
const _flSS = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
// [motion4] whether the shaders can draw a person's foot cx m across from the gait's place (dy over the body's floor):
// humanVS swings the leg in or out at the hip only so far, after the lean into a turn has set the ankle (lkL.x there)
function flCanReach(e, o, cx, dy) {
  const sc = e.scale || 1, x0 = o.g[3] / sc, l = e.mount ? 0 : clamp(Math.round((e.anim.lean || 0) / 0.04), -7, 7) * 0.04;
  const lk = (x0 + cx / sc) * Math.cos(l) + (SK.ankle[1] + (dy || 0) / sc) * Math.sin(l) - x0;
  return x0 > 0 ? lk >= -FL_HOLD_IN - 0.002 && lk <= 0.45 + 0.002 : lk >= -0.45 - 0.002 && lk <= FL_HOLD_IN + 0.002;
}
// [motion4] how high the gait itself has a person's swinging foot at w of its swing (HUMAN_GAIT's footPath, metres)
function flHumanLift(e, w) {
  const sc = e.scale || 1, turnK = e.anim.turn > 0.05 && e.anim.amt < 0.15 ? clamp(e.anim.turn, 0, 1) : 0, amt = turnK ? 0 : clamp(e.anim.amt, 0, 2.2), vel = amt * 4.3 / Math.max(sc, 0.3);
  const runK = _flSS(2.4, 4.4, vel), stepS = Math.min(humanStep(vel), humanStepCap(humanSlopeQ(e)));
  const liftH = Math.max(lerp(0.1, 0.3, runK) * Math.min(1, stepS / 0.42) * _flSS(0, 0.04, amt), 0.075 * turnK);
  return liftH * Math.pow(Math.max(Math.sin(Math.PI * Math.pow(w, lerp(1, 0.62, runK))), 0), lerp(0.85, 0.5, _flSS(0.5, 1, w))) * sc;
}
// a person's feet: [u (0..1 round its cycle), duty, reach (m), x (its side, m)] for the left (0) and the right (1)
function flHumanGait(e, f) {
  const sc = e.scale || 1, amt = e.anim.turn > 0.05 && e.anim.amt < 0.15 ? 0 : clamp(e.anim.amt, 0, 2.2), vel = amt * 4.3 / Math.max(sc, 0.3); // (as drawActors sends it: stepping round, no walk)
  const runK = _flSS(2.4, 4.4, vel), duty = lerp(0.58, 0.26, runK) - 0.06 * _flSS(6.5, 9.0, vel);
  const reach = duty * Math.min(humanStep(vel), humanStepCap(humanSlopeQ(e))) * sc; // [motion3] (short steps on a flight)
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
  if (!flNear(e, FL_NEAR * 1.15)) { e._fl = e._flH = null; e._flX = e.x; e._flZ = e.z; e._flY = e.y; e._flVy = 0; e._flYw = e.yaw; return; } // [motion3] far off: not followed (planted afresh when it comes near)
  const human = e.kind === 'humanoid', S = !human ? BEASTS[e.crowd || e.kind] : null;
  const rush = !!(e.motion && e.motion.rush); // [motion4] a Charge's rush runs on its feet: they are held as a runner's (left to the run, it landed with a foot carried in over the ground, 4 to 7 cm)
  const onFeet = e.alive && !e.seat && !e.boat && !e.swim && !e.dive && e.fixedY == null && (e.onGround !== false || rush) && !e.flying && !(e.motion && ((e.motion.kind === 'leap' && !rush) || e.motion.kind === 'ladder')); // [motion4] (on a ladder the feet are on its rungs: ladderLegs, 05a_rig.js)
  // the body's own motion this step, in its frame (across, along)
  const c = Math.cos(e.yaw), s = Math.sin(e.yaw), mx = e.x - (e._flX ?? e.x), mz = e.z - (e._flZ ?? e.z), idt = 1 / Math.max(dt, 1e-4);
  e._flVy = lerp(e._flVy || 0, (e.y - (e._flY ?? e.y)) * idt, 0.5); e._flY = e.y; // [motion3] how fast it climbs (a foot lands on the floor it will be on)
  e._flX = e.x; e._flZ = e.z;
  e._flDy = e._flYw == null ? 0 : angDiff(e._flYw, e.yaw); e._flYw = e.yaw; // [motion4] how far it turned this step (a planted place is looked for where the turn will carry it)
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
function flFloor(e, x, z, yRef) {
  const y = yRef ?? e.y; // [motion3] (or where the body will be: the floor a swinging foot will land on)
  if (e.kind !== 'humanoid') { const h = floorTreadAt(x, z, y + 0.5); if (Math.abs(h - y) > 0.6) { _flTread = false; return y; } return h; }
  // a person's sole, heel to toe along the facing, stands on the highest floor under it: a foot by a stair's riser stands
  // on the next tread with its heel out over the edge, never with its toes in the stone (a third of the steps did)
  const sc = e.scale || 1, fx = Math.sin(e.yaw) * sc, fz = Math.cos(e.yaw) * sc;
  let best = -Infinity, tread = false;
  for (const k of FL_SOLE) {
    const h = floorTreadAt(x + fx * k, z + fz * k, y + 0.5);
    if (y - h > 0.6 || h - y > (_flTread ? FL_UP : 0.6)) continue; // [motion3] (a stair's tread up to FL_UP over the body: climbing a steep flight a foot lands 0.5 to 0.75 m over it, and the tread past 0.6 was passed over: the foot stood 27 cm into the riser)
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
    const lo = x0 > 0 ? -inL : -outL, hi = x0 > 0 ? outL : inL, mg = FL_MARGIN * sc;
    // [motion3] how far in a planted person's foot is held (it may come in under the body, the legs crossing, while the
    // body turns hard over it: 0.25 m, the shaders' limit too); stances are placed within lo..hi, quick steps start past
    // the hold
    const loH = o.human && x0 > 0 ? -FL_HOLD_IN * sc : lo, hiH = o.human && x0 < 0 ? FL_HOLD_IN * sc : hi;
    o.lo = loH; o.hi = hiH;
    if (du > 0.05 && du < 8) {
      const Tst = duty / du, k = 1 - Math.exp(-dt * 8);
      // [motion3] the whole stance kept within that reach: a foot that will travel in under the body comes down farther
      // out, one that travels out comes down as far in as it may (a stance centred on the gait's place ran into the inner
      // limit and was dragged: a walker shoved aside 10 cm)
      // [motion3] and so is a person's foot as it comes down and as it rises (it stands still on the ground while the body
      // moves on: carried past the reach, the leg dragged it along with the body, 1 to 3 cm)
      const Tsw = (1 - duty) / du, pre = o.human ? vx * 0.12 * Tsw : 0, d = -vx * Tst, post = d - (o.human ? vx * 0.15 * Tsw : 0);
      const a = lo + mg - Math.min(0, pre, post), b = hi - mg - Math.max(0, pre, post);
      o.tx = lerp(o.tx, a <= b ? clamp(-d / 2, a, b) : (lo + hi - d) / 2, k);
      o.tz = lerp(o.tz, clamp((vz - 2 * reach / Math.max(duty, 0.05) * du) * Tst / 2, -0.25, 0.25), k);
    } else { o.tx *= 0.9; o.tz *= 0.9; }
    if (down) {
      // it comes down where the gait puts it with what the swing brought it to (o.cx, o.cz); its place on the ground is
      // taken where the body is drawn next (footLockSlot: the player moves after its gait steps, so a place taken here
      // would be a step behind)
      if (!o.down) {
        o.latch = false; o.frozen = false;
        // [motion4] a landing the leg could not reach was taken in the air (footLockSlot: o.air): it goes on as a quick
        // step from there, already off the ground, and comes down where the stance can be spent
        if (o.air && o.lwx != null) {
          const ax = (o.lwx - e.x) * c - (o.lwz - e.z) * s, az = (o.lwx - e.x) * s + (o.lwz - e.z) * c;
          o.hop = FL_HOP_LIFT * 2.5; o.fresh = false; o.land = false; o.hwx = o.lwx; o.hwz = o.lwz; o.wx = o.lwx; o.wz = o.lwz;
          o.hx = clamp(ax - x0, loH, hiH); o.hz = az - along; o.h = o.hT ?? o.h; o.yw = o.ywL ?? e.yaw; o.ywL = null;
        } else { o.fresh = true; o.hop = 0; o.land = !!o.useA; } // ([motion3] o.land: set down where the swing held it, footLockSlot)
        o.air = false;
      }
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
        // [motion4] where it will stand in the body's frame by the next step, the body going on as it went, turning too (a
        // person's: the turn swung it out of reach between two frames), and whether the foot could keep its heading
        const d = o.human ? e._flDy || 0 : 0, px = x0 + cx - vx * dt, pz = along + cz - vz * dt, cxN = px * Math.cos(d) - pz * Math.sin(d) - x0;
        const yawOut = o.human && o.yw != null && Math.abs(angDiff(e.yaw + d, o.yw)) > FL_YAW;
        if (m > FL_JUMP) { cx = o.tx; cz = o.tz; at(o, x0, along, cx, cz); } // a jump (set down somewhere new): planted afresh
        else if ((m > FL_MAX || cxN < loH - FL_GIVE || cxN > hiH + FL_GIVE || yawOut) && !still) {
          // [motion3] beyond what the leg can hold (in under the body past its limit, or too far off), or about to be by the
          // next step: it steps (a cut at a sprint or a hard shove dragged the foot along the ground 10 cm and more)
          // ([motion3] from where it is drawn: brought in to FL_MAX first, it jumped over the ground, 10 cm in a sharp cut)
          o.hop = 1e-4; o.hx = clamp(cx, loH, hiH); o.hz = cz; cx = o.hx; cz = o.hz; o.hwx = o.wx; o.hwz = o.wz; // (and the place it leaves, on the ground: footLockSlot)
        }
        o.cx = cx; o.cz = cz;
      }
      o.lx = o.cx; o.lz = o.cz;
    } else {
      if (o.down) o.hL = o.h == null ? null : o.h + (o.hop > 0 ? flHopH(o.hop) : 0); // (the floor it lifts off; [motion3] or the height of a quick step it was taking)
      o.fresh = false; o.hop = 0;
      // in the air: from where it lifted off to where it will come down, over the swing
      // [motion3] a person's foot is near the ground at both ends of its swing: it rises in place and comes down in place,
      // moving over the ground only in between (it left and landed still moving, with the body or the gait, a centimetre
      // a frame); a beast's swing is all up in the air (it rises and comes down in place in the stance's ends, bbFoot)
      const w = clamp((u - duty) / Math.max(1 - duty, 0.05), 0, 1), k = o.human ? _flSS(0.12, 0.88, w) : w * w * (3 - 2 * w);
      const tl = du > 0.05 ? clamp((1 - u) / du, 0, 0.5) : 0;
      const q = 1 - w, ee = w * w * (3 - 2 * w) - (1 - duty) / Math.max(duty, 0.05) * (o.human ? 0.5 * w * q ** 4 - q * w ** 4 : w * q ** 4 - q * w ** 4); // [motion3] (a person's footPath: half the pace leaving, the whole pace landing)
      const gz = z0 + reach * (2 * ee - 1); // (where the gait alone has it along now)
      // [motion3] both ends of the swing are places on the ground, not on the body: where it lifted off (where it was last
      // drawn, footLockSlot) and where it will come down (where the coming stance should start, from where the body will
      // be by then), each seen from where the body is now (footLockSlot again where it is drawn). A person's foot goes
      // from the one to the other over the ground; a beast's across (along, its own swing: the vault reads it). A foot
      // carried across with a body shoved aside, or round with one turning, skated as it rose and as it came down
      // [motion4] the body halted (its gait no longer turns over: the keys let go, a rush landing, a walker at its place):
      // a person's foot in the air stays where it was last drawn and comes down there as the gait settles (it was carried
      // in toward the body over the ground as the stride shrank, 4 cm as a rush landed and up to 30 cm from a sprint)
      // (when the body goes on, the foot swings on from where it was held)
      if (o.human && du < 0.05 && o.useA && o.dx != null && o.gz != null && !o.frozen) {
        const px = x0 + o.dx, pz = o.gz + o.dz;
        o.ax = o.lwx = e.x + px * c + pz * s; o.az = o.lwz = e.z - px * s + pz * c; o.latch = true; o.ywL = e.yaw + (o.yo || 0); o.frozen = true;
      } else if (du >= 0.05) o.frozen = false;
      let lx = x0 + o.tx + vx * tl, lz = z0 + reach + o.tz + vz * tl;
      // [motion4] from its last frames in the air the place it comes down on is kept in the world: worked out afresh each
      // step it swung round with a body turning 0.2 rad a frame, and the foot came in over the ground
      if (o.human && o.latch && o.lwx != null) { const dx = o.lwx - e.x, dz = o.lwz - e.z; lx = dx * c - dz * s; lz = dx * s + dz * c; }
      else { o.lwx = e.x + lx * c + lz * s; o.lwz = e.z - lx * s + lz * c; if (o.human && w >= FL_LATCH_W) { o.latch = true; o.ywL = e.yaw; } } // (and its heading then: it comes down with it)
      o.useA = o.ax != null && Math.hypot(o.ax - o.lwx, o.az - o.lwz) < 6; // (no farther than a stride: else the body was set down somewhere new)
      if (o.useA) {
        const dx = o.ax - e.x, dz = o.az - e.z;
        o.cx = lerp(dx * c - dz * s, lx, k) - x0; o.cz = o.human ? lerp(dx * s + dz * c, lz, k) - gz : lerp(o.lz, o.tz, k);
      } else { o.cx = lerp(o.lx, o.tx, k); o.cz = lerp(o.lz, o.tz, k); }
      o.k = k; o.gz = gz;
      // the floor where it will come down (a tread, a bump, a slope's rise), and the floor under it now: it passes over a
      // stair's nosing or a hump on the way, not through it
      // [motion3] where it will come down is where the body will be by then (it was looked for where the body is now: up a
      // flight at a run that was a tread short, and the foot came up into the next riser)
      // (in the body's frame; footLockSlot looks for the floors there where the body is drawn: the player moves after
      // its gait steps, and up a flight at a run a step behind was a tread short, the foot coming up into the next riser)
      o.lT = [lx, lz, clamp(e._flVy || 0, -6, 6) * tl]; o.lN = [x0 + o.cx, gz + o.cz];
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
      let lx = o.g[3] + o.cx, lz = o.along + o.cz, refuse = false;
      // [motion3] after a swing, where the swing held it on the ground (a beast's: across; along, by its gait): read from
      // the body's frame a step late it came down a frame's motion away, 1 cm aside in a shove
      // ([motion3] never past where the leg holds it: in a hard turn the place it was coming down to swung far aside)
      if (o.land && o.lwx != null) {
        const dx = o.lwx - e.x, dz = o.lwz - e.z, ax = dx * c - dz * s - o.g[3];
        refuse = o.human && !flCanReach(e, o, ax, (o.hT ?? e.y) - e.y); // [motion4] (a place the leg cannot reach: taken in the air, below)
        lx = o.g[3] + clamp(ax, o.lo ?? -9, o.hi ?? 9); if (o.human) lz = dx * s + dz * c;
      }
      // [motion4] its heading: the one it came down with, kept from its last frames in the air (the body's now turned it
      // about its ankle as it touched down, 1.3 cm in a cut)
      const yw = o.land && o.ywL != null ? o.ywL : e.yaw;
      o.ywL = null;
      if (refuse) {
        // [motion4] not set down there (the leg would be drawn short of it, over the ground): a quick step from the air
        o.hop = FL_HOP_LIFT; o.hwx = o.wx = o.lwx; o.hwz = o.wz = o.lwz; o.hx = lx - o.g[3]; o.hz = lz - o.along;
        o.fresh = false; o.land = false; o.yw = yw; o.h = flFloor(e, o.wx, o.wz); o.tread = _flTread;
      } else {
        o.wx = e.x + lx * c + lz * s; o.wz = e.z - lx * s + lz * c; o.fresh = false; o.land = false; o.yw = yw; // ([motion3] and its heading)
        o.h = flFloor(e, o.wx, o.wz); o.tread = _flTread;
      }
    }
    if (o.down && o.h == null) { o.h = flFloor(e, o.wx, o.wz); o.tread = _flTread; }
    // [motion4] a person's planted foot the leg can no longer draw where it stands (the body cut away from it between two
    // frames: across past the hip's swing, or turned past its own heading) is lifted in this very frame (a quick step,
    // already off the ground), and so is a quick step still at its first frame: drawn short of its place on the ground,
    // it was carried over it with the body, 2 to 24 cm in a sharp cut at a sprint
    if (o.human && o.down && o.g && !(o.hop >= FL_HOP_LIFT)) {
      const hw = o.hop > 0 && o.hwx != null, pwx = hw ? o.hwx : o.wx, pwz = hw ? o.hwz : o.wz, dx = pwx - e.x, dz = pwz - e.z, cx = dx * c - dz * s - o.g[3];
      if (!flCanReach(e, o, cx, (o.h ?? e.y) - e.y) || (o.yw != null && Math.abs(angDiff(e.yaw, o.yw)) > FL_YAW + 0.002)) {
        if (!(o.hop > 0)) { o.hwx = o.wx; o.hwz = o.wz; o.hx = clamp(cx, o.lo ?? -9, o.hi ?? 9); o.hz = dx * s + dz * c - o.along; }
        o.hop = FL_HOP_LIFT;
      }
    }
    if (!o.down && o.lT) {
      // [motion3] in the air: the floor where it will come down (where the body will be by then), and the floor under it
      // now and a little ahead on its way (it comes forward faster than a tread is deep), all from where the body is drawn
      const [tx, tz, ty] = o.lT, [nx, nz] = o.lN;
      o.hT = flFloor(e, e.x + tx * c + tz * s, e.z - tx * s + tz * c, e.y + ty); o.treadT = _flTread; // (by the floor the body will be on by then: up a flight it climbs as fast as it runs)
      o.hN = flFloor(e, e.x + nx * c + nz * s, e.z - nx * s + nz * c);
      // (on a flight or a steep slope only: on the level it finds nothing new)
      if (o.human && (o.w ?? 1) < 0.97 && Math.abs(e._slope || 0) > 0.15) for (const k of [0.12, 0.24]) { const az = nz + k * (e.scale || 1); o.hN = Math.max(o.hN, flFloor(e, e.x + nx * c + az * s, e.z - nx * s + az * c)); }
    }
    // how high its floor stands over the body's own: planted, its own place's; in the air, from the floor it left to the
    // floor it will land on
    // [motion3] a swing that leaves from a place the leg can no longer reach (a stance planted before a shove took hold,
    // the body moving on from it) lifts the foot clear at once: the shaders carry it on with the body from the edge of
    // the reach, in the air, not over the ground (2 to 3 cm)
    let clear = 0;
    if (!o.down && o.useA && o.lo != null && o.g) { const ax = (o.ax - e.x) * c - (o.az - e.z) * s - o.g[3]; clear = FL_HOP_H * Math.min(1, Math.max(o.lo - ax, ax - o.hi, 0) / 0.02) * (1 - (o.k ?? 1)); }
    // [motion4] coming down where the leg cannot reach (the place it was kept for, the body cutting away from it in its
    // last frames in the air): held off the ground (FL_AIR_H, with the gait's own lift) and set down by a quick step
    if (o.human && !o.down && o.latch && o.useA && o.lwx != null && o.g && !o.air) o.air = !flCanReach(e, o, (o.lwx - e.x) * c - (o.lwz - e.z) * s - o.g[3], (o.hT ?? e.y) - e.y);
    let hy = o.down ? o.h + (o.hop > 0 ? flHopH(o.hop) : 0) : Math.max(lerp(o.hL ?? e.y, o.hT ?? e.y, (o.w ?? 0) * (o.w ?? 0) * (3 - 2 * (o.w ?? 0))), o.hN ?? -1e9) + clear; // [motion3] (a quick step raised)
    if (o.air && !o.down) hy = Math.max(hy, (o.hT ?? e.y) + FL_AIR_H - flHumanLift(e, o.w ?? 1));
    // (a person's leg reaches little below where it stands: a foot left too far below as the body climbs is drawn up)
    o.dy = clamp((hy ?? e.y) - e.y, e.kind === 'humanoid' && !horse ? -0.2 : -0.45, e.kind === 'humanoid' && !horse ? FL_UP : 0.45); // [motion3] (a person's foot up to FL_UP: flFloor finds nothing higher than 0.6 but a stair's tread)
    // [motion4] shoving a boat off (action 19), each foot steps into the stance (the front one 0.34 m ahead, the back one
    // 0.5 behind: humanVS) over the floor under it on its way, a shingle beach running down to the water
    if (o.human && o.down && o.g && !horse && e.anim.act === 19 && e.anim.actDur > 0) {
      const at = clamp(e.anim.actT / e.anim.actDur, 0, 1), kk = _flSS(0, 0.18, at) * (1 - _flSS(0.85, 1, at)), front = o.g[3] > 0;
      const kS = front ? _flSS(0, 0.55, kk) : _flSS(0.45, 1, kk), sc = e.scale || 1, a = lerp(o.along + o.dz, (front ? 0.34 : -0.5) * sc, _flSS(0.15, 0.85, kS)), lx = o.g[3] + o.dx;
      if (kS > 0) o.dy = clamp(flFloor(e, e.x + lx * c + a * s, e.z - lx * s + a * c) - e.y, -0.2, 0.6); // (the floor under it where it is now)
    }
    if (o.down && o.g && !(o.hop > 0)) {
      const dx = o.wx - e.x, dz = o.wz - e.z;
      let cx = dx * c - dz * s - o.g[3], cz = dx * s + dz * c - o.along;
      const m = Math.hypot(cx, cz);
      if (m > FL_JUMP) { cx = 0; cz = 0; } // ([motion3] past FL_MAX it is drawn where it is until the next step lifts it: brought in, it jumped over the ground)
      o.dx = cx; o.dz = cz;
      o.lx = cx; o.lz = cz; // (the swing starts from what was drawn: the player's step reads it a step late, 12 cm at a run)
    } else if (o.down && o.g && o.hop > 0 && o.hwx != null) {
      // [motion3] a quick step: from the place it leaves, on the ground, to where the rest of the stance can be spent,
      // seen from where the body is drawn (read from the body's frame a step late, the foot jumped as a body turned hard)
      const ax = o.hwx - e.x, az = o.hwz - e.z, k = _flSS(0.15, 0.85, o.hop);
      o.dx = lerp(clamp(ax * c - az * s - o.g[3], o.lo ?? -9, o.hi ?? 9), o.tx, k); o.dz = lerp(ax * s + az * c - o.along, o.tz, k);
      // [motion4] over the floors on its way: from the floor it left to the floor where it will come down, never under the
      // floor beneath it now (on a flight it was carried at the height it left, onto the next tread and into its riser)
      if (o.h != null && !(e.anim.act === 19 && e.anim.actDur > 0)) {
        const lx = o.g[3] + o.dx, lz = o.along + o.dz, gx = o.g[3] + o.tx, gz = o.along + o.tz;
        const hC = flFloor(e, e.x + lx * c + lz * s, e.z - lx * s + lz * c), hG = flFloor(e, e.x + gx * c + gz * s, e.z - gx * s + gz * c);
        const hum = e.kind === 'humanoid' && !horse;
        o.dy = clamp(Math.max(lerp(o.h, hG, k), hC) + flHopH(o.hop) - e.y, hum ? -0.2 : -0.45, hum ? FL_UP : 0.45);
      }
    } else if (!o.down && o.useA && o.g) {
      // [motion3] in the air: between where it lifted off and where it will come down, both on the ground, seen from where
      // the body is drawn (the player moves after its gait steps)
      const ax = o.ax - e.x, az = o.az - e.z, bx = o.lwx - e.x, bz = o.lwz - e.z;
      o.dx = lerp(ax * c - az * s, o.g[3] + clamp(bx * c - bz * s - o.g[3], o.lo ?? -9, o.hi ?? 9), o.k) - o.g[3]; o.dz = o.human ? lerp(ax * s + az * c, bx * s + bz * c, o.k) - o.gz : o.cz;
    } else { o.dx = o.cx; o.dz = o.cz; }
    if (o.down && o.g) { const lx = o.g[3] + o.dx, lz = o.along + o.dz; o.ax = e.x + lx * c + lz * s; o.az = e.z - lx * s + lz * c; } // [motion3] (where it stands as drawn: the swing leaves from there)
    // [motion3] a person's planted foot keeps its own heading while the body turns over it (the leg turns at the hip): it
    // turned with the body, and its sole swung round the ankle, a centimetre a frame in a cut at speed. In the air (and in
    // a quick step) it comes round to the body's again by the time it lands
    // [motion4] its heading in the world is kept from where it stood until it is off the ground (the body turning on, 0.2
    // rad a frame in a cut, turned a foot rising in place about its ankle), then comes round to the body's
    if (o.human) {
      const a = o.yw != null ? angDiff(e.yaw, o.yw) : 0;
      if (o.down && !(o.hop > 0)) o.yo = o.yoL = clamp(a, -FL_YAW, FL_YAW);
      else if (!o.down && o.latch && o.ywL != null) o.yo = clamp(angDiff(e.yaw, o.ywL), -FL_YAW, FL_YAW); // (coming down: the heading it will stand with)
      else o.yo = clamp(a * (1 - (o.down ? _flSS(0.15, 0.85, o.hop) : o.k ?? 1)), -FL_YAW, FL_YAW);
    }
    if (Math.abs(o.dx) > 0.002 || Math.abs(o.dz) > 0.002 || Math.abs(o.dy) > 0.004 || Math.abs(o.yo || 0) > 0.005) any = true;
  }
  if (!any) return 0;
  // (a beast stands tilted with the slope along it, beastLeanYaw: its feet's heights are what the tilt leaves)
  const tilt = horse || e.kind !== 'humanoid' ? clamp(Math.round((e._bslope || 0) * 20), -20, 20) * 0.05 : 0;
  const r = FOOT_LOCK.n++, D = FOOT_LOCK.data;
  for (let f = 0; f < 4; f++) { const o = L[f], k = (r * FOOT_LOCK.W + f) * 4; D[k] = o ? o.dx : 0; D[k + 1] = o ? o.dz : 0; D[k + 2] = o ? o.dy - tilt * (o.along + o.dz) : 0; D[k + 3] = (o && (o.down ? o.tread : o.treadT) ? 20 : 10) + (o ? (o.yo || 0) * 0.5 : 0); } // (w: 20 on a stair's tread, where a person's foot stands level, else 10; [motion3] plus half the turn that keeps a person's planted foot on its heading)
  return r + 1;
}
function footLockBegin() { FOOT_LOCK.n = 0; }
function footLockEnd() { if (FOOT_LOCK.n || FOOT_LOCK.was) FOOT_LOCK.tex.needsUpdate = true; FOOT_LOCK.was = FOOT_LOCK.n; }
window.__hm.footLock = { FOOT_LOCK, footLockStep, flHumanGait, flBeastGait, footLockSlot, floorTreadAt };
