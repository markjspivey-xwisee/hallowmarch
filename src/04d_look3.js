/* ================================================================== */
/* [look3] the world looked at again (version 14): shared pieces       */
/* ================================================================== */
// What version 13's look left and what version 13 added, looked at as a player sees them. This module holds what the
// shaders and the builders of other modules call (it loads before the castles, the beasts and the scaffolds that use
// it); the rest is in 13v_look3.js. Small changes where a fault was carry [look3] marks in their own modules.

// Cracks in coursed masonry (the castle shader, 04g_castles.js). Version 13 drew a worn or breached wall's cracks as the
// iso-lines of a smooth noise: thick dark curves winding over the stones like vines, across joints and stones alike,
// on the timber of a door and the logs of a palisade too. A wall that settles or is battered cracks along its weakest
// line, the mortar: up a head joint, half a stone along the bed joint, up the next head joint, a course at a time. So
// does this crack. Each zone of four stones by six courses holds one (a second set of zones, offset, opens as the wall
// weakens further); it climbs three to six courses, breaks into runs and pinches out along its length, the joints it
// follows are not ruled lines, and the broken edge on one side of the gap (right of a head joint, above a bed joint)
// catches the light. Thinner than a pixel it fades instead of breaking into dashes.
// uv: the face's coordinates as the stone branch lays its courses (planarUV, stones 1.15 m by 0.58 m in running bond);
// k: how worn (0..1). Returns x the dark gap (0..1), y the lit lip (0..1).
const LOOK3_CRACK_GLSL = /* glsl */`
  float look3SegD(vec2 p, vec2 a, vec2 b, out float sd){
    vec2 ab = b - a, ap = p - a;
    float t = clamp(dot(ap, ab) / max(dot(ab, ab), 1e-6), 0.0, 1.0);
    vec2 q = ap - ab * t;
    sd = ab.x * ap.y - ab.y * ap.x;
    return length(q);
  }
  vec2 look3Crack(vec2 uv, float k){
    float px = max(length(fwidth(uv)), 1e-4);
    float row = floor(uv.y / 0.58), xb = uv.x / 1.15;
    vec2 res = vec2(0.0);
    for (int L = 0; L < 2; L++) {
      float fl = float(L);
      float lw = L == 0 ? smoothstep(0.05, 0.35, k) : smoothstep(0.3, 0.75, k);
      if (lw <= 0.0) continue;
      vec2 off = vec2(1.0, 2.0) * fl;
      vec2 zc = floor((vec2(xb, row) + off) / vec2(3.0, 5.0));
      vec2 h = hash22(zc * 1.37 + vec2(3.1, fl * 7.3));
      float dir = h.x < 0.5 ? -1.0 : 1.0;
      float r0 = zc.y * 5.0 - off.y + floor(h.y * 2.0);
      float nr = 2.0 + floor(fract(h.y * 13.7) * 3.0);
      // the head joint it starts at (a course's joints are half a stone over from the last's), far enough in from the
      // zone's edge that it never leaves the zone (it moves half a stone a course, at most a stone and a half)
      float odd = mod(r0, 2.0);
      float xb0 = zc.x * 3.0 - off.x + (dir > 0.0 ? (odd > 0.5 ? 0.5 : 1.0) : (odd > 0.5 ? 2.5 : 2.0));
      float rr = row - r0;
      if (rr < -0.5 || rr > nr - 0.5) continue;
      // in some courses it runs through the stone itself, slanting from joint to joint (the bed joint over it is then
      // left whole); in the rest up the head joint and along the bed joint
      float dg = step(hash12(vec2(row, zc.x + fl * 31.0) + 7.7), 0.42), dgB = step(hash12(vec2(row - 1.0, zc.x + fl * 31.0) + 7.7), 0.42);
      vec2 P = vec2(uv.x + (vnoise(vec2(uv.y * 17.0, 1.7 + fl * 3.1)) - 0.5) * 0.045, uv.y + (vnoise(vec2(uv.x * 17.0, 4.3 + fl * 5.7)) - 0.5) * 0.04);
      float xc = xb0 + 0.5 * rr * dir, sgn = 1.0, sdT;
      float best = look3SegD(P, vec2(xc * 1.15, row * 0.58), vec2((xc + 0.5 * dir * dg) * 1.15, (row + 1.0) * 0.58), sgn);
      if (rr >= 1.0 && dgB < 0.5) { float d = look3SegD(P, vec2((xc - 0.5 * dir) * 1.15, row * 0.58), vec2(xc * 1.15, row * 0.58), sdT); if (d < best) { best = d; sgn = sdT * dir; } }
      if (rr < nr - 1.0 && dg < 0.5) { float d = look3SegD(P, vec2(xc * 1.15, (row + 1.0) * 0.58), vec2((xc + 0.5 * dir) * 1.15, (row + 1.0) * 0.58), sdT); if (d < best) { best = d; sgn = sdT * dir; } }
      if (best > 0.07) continue;
      // it opens and pinches out along its length (runs a metre or so long) and narrows toward its ends
      float pinch = 0.25 + 0.75 * smoothstep(0.3, 0.6, vnoise(vec2((uv.x * 0.7 + uv.y * 1.1) * 1.6, 9.0 * fl + zc.x * 3.7 + zc.y)));
      float ends = clamp(min(rr + 0.7, nr - 0.3 - rr) / 1.5, 0.25, 1.0);
      float w = (0.006 + 0.016 * lw * k) * pinch * ends;
      float we = max(w, 0.6 * px);
      float core = clamp((we - best) / px + 0.5, 0.0, 1.0) * (w / we);
      // the broken edge on one side of the gap, catching the light
      float lipW = w + 0.014 * lw;
      float lip = sgn > 0.0 ? clamp((lipW - best) / px + 0.5, 0.0, 1.0) * clamp((best - w) / px + 0.5, 0.0, 1.0) * smoothstep(0.5 * px, 1.5 * px, lipW - w) : 0.0;
      res = max(res, vec2(core, lip * lw));
    }
    return res;
  }
`;

// Cracks in plaster, daub, wattle and timber (the house shader's houseBatter, 04e_houses.js): a battered house's walls
// had the same smooth-noise vines. Plaster cracks in jagged, nearly straight runs that meet at angles and branch: here
// the edges of a coarse jittered grid of cells (about 0.9 m), warped a little so no run is ruled, open only in patches
// that spread as the house is battered (k), thin and dark, fading rather than breaking into dashes when under a pixel.
// p: the face's coordinates in metres (planarUV); returns the crack's darkness (0..1)
const LOOK3_CRAZE_GLSL = /* glsl */`
  float look3Craze(vec2 p, float k){
    float px = max(length(fwidth(p)), 1e-4);
    vec2 q = p / 0.9 + (vec2(vnoise(p * 2.7), vnoise(p * 2.7 + 7.7)) - 0.5) * 0.3;
    vec2 ip = floor(q), fq = fract(q), c1 = ip;
    float d1 = 9.0, d2 = 9.0;
    for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
      vec2 c = vec2(float(i), float(j)), o = hash22(ip + c) * 0.8 + 0.1;
      float d = length(c + o - fq);
      if (d < d1) { d2 = d1; d1 = d; c1 = ip + c; } else if (d < d2) d2 = d;
    }
    float e = (d2 - d1) * 0.45 * 0.9;
    float zone = vnoise(p * 0.32 + 11.0) * 0.6 + hash12(c1 * 1.7 + 3.3) * 0.4;
    float open = smoothstep(0.82 - 0.55 * k, 0.9 - 0.55 * k, zone);
    float w = (0.003 + 0.009 * k) * open;
    if (w < 0.0004) return 0.0;
    float we = max(w, 0.6 * px);
    return clamp((we - e) / px + 0.5, 0.0, 1.0) * (w / we);
  }
`;

// A beast's coat lit from behind by a fire (the beasts' shader, 05c_beasts.js). A dark-coated hound by the hearth was lit
// only by the room's warm fill and the hearth's light on the faces turned to it, so it stood as a dark cut-out against the
// fire. Fur seen against a light glows along its outline (the light passes through the hair's tips), and a coat takes the
// warm light the room's walls and floor give back. For each near point light: the outline facing away from the camera
// glows by how much the light stands behind the body (a little warmer than the coat).
const LOOK3_FUR_GLSL = /* glsl */`
  vec3 look3FurGlow(vec3 wp, vec3 n, vec3 V, vec3 alb){
    vec3 sum = vec3(0.0);
    float rim = pow(1.0 - max(dot(n, V), 0.0), 3.0);
    for (int i = 0; i < ${PL_MAX}; i++) {
      if (i >= uPLN) break;
      vec3 d = uPLPos[i].xyz - wp;
      float r = uPLPos[i].w, dd = dot(d, d);
      if (dd >= r * r) continue;
      float x = sqrt(dd) / r, att = (1.0 - x * x); att *= att; att /= 1.0 + dd * 0.06;
      vec3 Ld = d * inversesqrt(max(dd, 1e-4));
      float behind = clamp(dot(-V, Ld) * 0.5 + 0.5, 0.0, 1.0);
      sum += uPLCol[i].rgb * att * rim * behind * behind;
    }
    return sum * mix(alb, vec3(0.5, 0.36, 0.22), 0.3) * 0.55;
  }
`;

// A working scaffold (the towers', the palisades' and the curtains' while they are built back: 04g_breach.js,
// 04g_burn.js, 04g_castles.js). Version 13's were poles and two rings of ledgers, the boards on edge to the eye: no floor
// to stand on, no braces, no ladders. A putlog scaffold as masons put one up: a row of standards along the face, ledgers
// lashed along them at each lift, putlogs from the ledgers into the wall, a floor of boards on the putlogs with a rail at
// its outer edge, braces zigzagging across the outer face, a ladder from the ground to the first lift and one from lift
// to lift through a gap in the boards above, at alternate ends. Into the batch b, in the frame M (y up, the site's).
//   pts: the standards' places along the face, in order ([x, z]); ins: the way to the wall at each ([nx, nz], unit);
//   o: { lifts: [y, ...] the floors' heights, top: the standards' tops, deep: how far the boards reach toward the wall,
//        gy(x, z): the ground's height under a standard (in the frame), clear(x, z): false where a standard cannot
//        stand (a wall, a tree: it is left out with the bays either side), pole, wood: colours, baseY, seed }
// Returns what was laid: { standards, bays, boards, ladders } (the tests count them).
function look3Pole(b, M, p0, p1, rad, col, matId = MAT.logH, baseY = null) {
  const dx = p1[0] - p0[0], dy = p1[1] - p0[1], dz = p1[2] - p0[2], L = Math.hypot(dx, dy, dz);
  if (L < 1e-4) return;
  b.add(G.cyl8, lm(M, (p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2, (p0[2] + p1[2]) / 2, Math.atan2(dx, dz), rad, L, rad, Math.atan2(Math.hypot(dx, dz), dy)), matId, col, baseY);
}
// a ladder from its foot (x, y, z) up to its top, its rungs across `side` (unit, horizontal)
function look3Ladder(b, M, foot, top, side, col) {
  const [sx, sz] = side, L = Math.hypot(top[0] - foot[0], top[1] - foot[1], top[2] - foot[2]);
  for (const k of [-0.21, 0.21]) look3Pole(b, M, [foot[0] + sx * k, foot[1], foot[2] + sz * k], [top[0] + sx * k, top[1], top[2] + sz * k], 0.032, darker(col, 0.85), MAT.plaster);
  const n = Math.floor((L - 0.15) / 0.3);
  for (let i = 1; i <= n; i++) {
    const t = (i * 0.3) / L, x = lerp(foot[0], top[0], t), y = lerp(foot[1], top[1], t), z = lerp(foot[2], top[2], t);
    look3Pole(b, M, [x - sx * 0.23, y, z - sz * 0.23], [x + sx * 0.23, y, z + sz * 0.23], 0.019, col, MAT.plaster);
  }
}
function look3Scaffold(b, M, pts, ins, o) {
  const n = pts.length, gy = o.gy || (() => 0), r = mulberry(o.seed ?? 7);
  const ok = pts.map(([x, z]) => !o.clear || o.clear(x, z));
  const pole = o.pole, wood = o.wood, lifts = o.lifts, deep = o.deep ?? 0.95;
  const out = { standards: 0, bays: 0, boards: 0, ladders: 0, floors: [], ladderRecs: [] };
  for (let i = 0; i < n; i++) {
    if (!ok[i]) continue;
    // a standard needs a bay beside it, or it is a lone pole
    if (!((i > 0 && ok[i - 1]) || (i + 1 < n && ok[i + 1]))) { ok[i] = false; continue; }
  }
  for (let i = 0; i < n; i++) if (ok[i]) {
    const [x, z] = pts[i], g = gy(x, z) - 0.3;
    look3Pole(b, M, [x, g, z], [x + (r() - 0.5) * 0.06, o.top + r() * 0.3, z + (r() - 0.5) * 0.06], 0.07, darker(pole, 0.88 + 0.22 * r()), MAT.logH, o.baseY);
    out.standards++;
  }
  const bays = [];
  for (let i = 0; i + 1 < n; i++) if (ok[i] && ok[i + 1]) bays.push(i);
  if (bays.length < 2) return out;
  // each lift is reached by a ladder standing in an opening left in the boards at one end of the run (the first bay's
  // outer end, then the last bay's, by turns); a body climbs it between the ladder and the outer row, facing the wall
  const OPEN = 0.85;
  const upBay = (k) => (k % 2 ? bays[0] : bays[bays.length - 1]);
  const bayOf = (i) => {
    const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
    let nx = (ins[i][0] + ins[i + 1][0]) / 2, nz = (ins[i][1] + ins[i + 1][1]) / 2;
    const nl = Math.hypot(nx, nz) || 1; nx /= nl; nz /= nl;
    const L = Math.hypot(bx - ax, bz - az);
    return { ax, az, bx, bz, nx, nz, L, ux: (bx - ax) / L, uz: (bz - az) / L };
  };
  const nb = Math.max(2, Math.floor((deep - 0.05) / 0.27)), b0 = 0.045, b1 = 0.17 + (nb - 1) * 0.27 + 0.125, b0b = b; // [look4]
  for (const i of bays) {
    const B = bayOf(i), { ax, az, bx, bz, nx, nz, L, ux, uz } = B, yaw = Math.atan2(ux, uz);
    out.bays++;
    lifts.forEach((y, k) => {
      const b = k < LOOK4.lifts ? b0b : LOOK4_NOB; // [look4] a lift not yet up is laid out but not drawn (look4LiftStep, 04d_look4.js)
      // the ledger along the outer row, the putlogs from it into the wall
      look3Pole(b, M, [ax - ux * 0.15, y, az - uz * 0.15], [bx + ux * 0.15, y, bz + uz * 0.15], 0.055, darker(pole, 0.92 + 0.15 * r()));
      for (const t of [0.22, 0.78]) {
        const px = lerp(ax, bx, t), pz = lerp(az, bz, t);
        b.add(G.box, lm(M, px + nx * (deep / 2 + 0.05), y + 0.07, pz + nz * (deep / 2 + 0.05), Math.atan2(nx, nz), 0.09, 0.09, deep + 0.35), MAT.plaster, darker(wood, 0.72 + 0.12 * r()));
      }
      // the boards on the putlogs, side by side across the floor; short of the opening where a ladder comes up
      // [look4] and short where the ladder from the lift below comes up through it (it stands to a climber's reach over
      // its own lift: the hands reached for rungs in the air above a ladder that stopped at the boards)
      const openAt = (kk) => (kk >= 0 && upBay(kk) === i ? (i === bays[0] ? -1 : 1) : 0), open = openAt(k), openB = openAt(k - 1);
      const u0 = open < 0 || openB < 0 ? OPEN : -0.11, u1 = open > 0 || openB > 0 ? L - OPEN : L + 0.11;
      for (let j = 0; j < nb; j++) {
        const off = 0.17 + j * 0.27, ue = u1 - (o.curve ? j * 0.03 : 0), us = u0 + (o.curve ? j * 0.03 : 0), um = (us + ue) / 2;
        b.add(G.box, lm(M, ax + ux * (um + (r() - 0.5) * 0.04) + nx * off, y + 0.14, az + uz * (um + (r() - 0.5) * 0.04) + nz * off, yaw + (r() - 0.5) * 0.012, 0.25, 0.045, ue - us), MAT.plaster, darker(wood, 0.95 + 0.22 * r()));
        out.boards++;
      }
      // a floor a body stands on (the boards' top), in the frame: centre, along, half-length, half-depth
      const fu = (u0 + u1) / 2, fd = (b0 + b1) / 2;
      out.floors.push({ x: ax + ux * fu + nx * fd, z: az + uz * fu + nz * fd, ux, uz, hx: (u1 - u0) / 2, hz: (b1 - b0) / 2, y: y + 0.1625, k });
      // a rail along the outer edge, at hand's height
      look3Pole(b, M, [ax, y + 1.05, az], [bx, y + 1.05, bz], 0.035, darker(pole, 1.0));
      // braces across the outer face, zigzagging up the run (every other bay; none across a ladder's way in)
      if ((i + k) % 2 === 0 && !(k === 0 && upBay(0) === i)) {
        const y0 = k === 0 ? Math.max(gy(ax, az), gy(bx, bz)) + 0.3 : lifts[k - 1], s = (i + k) % 4 === 0;
        look3Pole(b, M, [s ? ax : bx, y0, s ? az : bz], [s ? bx : ax, y - 0.05, s ? bz : az], 0.04, darker(pole, 0.85));
      }
    });
  }
  // the ladders, each in its opening: the rails close to the wall, the climber's line between them and the outer row
  const lad = darker(wood, 1.05);
  lifts.forEach((y, k) => {
    const i = upBay(k), B = bayOf(i), { ax, az, nx, nz, L, ux, uz } = B, first = i === bays[0];
    const uc = first ? OPEN * 0.5 : L - OPEN * 0.5, at = (u, d) => [ax + ux * u + nx * d, az + uz * u + nz * d];
    const dl = Math.min(deep - 0.12, 0.78), yb = k === 0 ? null : lifts[k - 1] + 0.1625;
    const [lx0, lz0] = at(uc, dl), foot = k === 0 ? gy(lx0, lz0) : yb;
    // [look4] upright, its rungs where a climber's hands and feet reach for a tower's (LADDER_AHEAD in front of the line it
    // climbs on, a rung every 0.3 m from where it starts, 05a_rig.js): it leaned 6 cm and its climber stood 0.42 m back;
    // and up to a climber's reach over the boards it leads to (1.95 m: through the next lift's boards, left short for it)
    look3Ladder(k < LOOK4.lifts ? b : LOOK4_NOB, M, [lx0, foot, lz0], [lx0, y + 0.1625 + 1.95, lz0], [ux, uz], lad);
    // where a body starts, the line it climbs on, the place it steps off onto the boards (in the frame)
    const [fx, fz] = k === 0 ? at(uc, -0.45) : at(uc + (first ? 1 : -1) * 0.9, 0.5), [lx, lz] = at(uc, dl - LADDER_AHEAD), [qx, qz] = at(uc + (first ? 1 : -1) * 0.95, 0.5);
    out.ladderRecs.push({ k, fx, fz, fy: foot, lx, lz, ox: qx, oz: qz, yt: y + 0.1625, yaw: Math.atan2(nx, nz), rx: lx0, rz: lz0 }); // [look4] fy: its foot (the rungs count from there); rx, rz: its rails' line
    out.ladders++;
  });
  return out;
}
// is (x, z) clear of every active collider (but those in `skip`) by r, the trees too, and of any floor raised over the
// ground (a stair's flight, a deck behind a palisade)? (a standard's place)
const _l3C = [];
function look3Clear(x, z, r, skip) {
  for (const [dx, dz] of [[0, 0], [r, 0], [-r, 0], [0, r], [0, -r]]) if (floorAt(x + dx, z + dz, 1e4) > heightAt(x + dx, z + dz) + 0.3) return false;
  collidersNear(x, z, r + 4, _l3C);
  for (const c of _l3C) {
    if (c.active === false || c.hollow || (skip && skip.has(c))) continue;
    if (c.type === 'circle') { if (Math.hypot(x - c.x, z - c.z) < c.r + r) return false; continue; }
    const dx = x - c.x, dz = z - c.z, lx = dx * c.cos - dz * c.sin, lz = dx * c.sin + dz * c.cos;
    if (Math.abs(lx) < c.hx + r && Math.abs(lz) < c.hz + r) return false;
  }
  return true;
}
// The scaffold's boards are floors and its ladders are climbed (as the towers' are: towerClimb, towerLadderNear, the
// offers), but only while it stands (look3ScafSync, each step from look3Scaffolds). infos: what look3Scaffold returned
// for each run, in the site's frame S; kept on the section or gap (W.l3)
const LOOK3S = { ladders: [], list: [] };
function look3ScaffoldWorld(W, S, infos) {
  if (LOOK4.geoOnly) return W.l3; // [look4] a scaffold's mesh made again as its lifts go up: its floors and ladders stay (04d_look4.js)
  const R = { floors: [], ladders: [], on: false, S };
  for (const info of infos) {
    if (!info) continue;
    for (const f of info.floors || []) {
      const p = siteToWorld(S, f.x, f.z);
      const fl = addFloorBox(p.x, p.z, f.hx, f.hz, S.yaw + Math.atan2(-f.uz, f.ux), S.y + f.y, S.y + f.y, S.y + f.y - 0.12, 0.12, 'scaffold');
      fl.active = false; fl.k = f.k;
      R.floors.push(fl);
    }
    for (const q of info.ladderRecs || []) {
      const f = siteToWorld(S, q.fx, q.fz), l = siteToWorld(S, q.lx, q.lz), o = siteToWorld(S, q.ox, q.oz);
      const L = { T: { S }, a: q.yaw, yaw: q.yaw, k: q.k, fx: f.x, fz: f.z, lx: l.x, lz: l.z, ox: o.x, oz: o.z, wyb: S.y + q.fy, wyt: S.y + q.yt, yawW: S.yaw + q.yaw, hatch: null, gone: true, scaffold: W, id: 'scaffold' };
      if (q.rx !== undefined) { const rr = siteToWorld(S, q.rx, q.rz); L.rx = rr.x; L.rz = rr.z; } // [look4] where its rungs are (the tests)
      R.ladders.push(L); LOOK3S.ladders.push(L);
    }
  }
  W.l3 = R;
  LOOK3S.list.push(W);
  return R;
}
function look3ScafSync(W, on) {
  const R = W.l3;
  const up = W.l4n ?? 99; // [look4] the lifts that are up (look4LiftStep, 04d_look4.js)
  if (!R || (R.on === on && R.up === up)) return;
  R.on = on; R.up = up;
  for (const f of R.floors) f.active = on && (f.k ?? 0) < up;
  for (const L of R.ladders) L.gone = !on || (L.k ?? 0) >= up;
}
// a gap's scaffold taken down for good (a palisade's: its scaffold is made for each repair): its floors and ladders go
function look3ScaffoldDrop(W) {
  const R = W.l3;
  if (!R || LOOK4.geoOnly) return; // [look4]
  look3ScafSync(W, false);
  for (const f of R.floors) {
    const i = FLOOR.list.indexOf(f); if (i >= 0) FLOOR.list.splice(i, 1);
    for (const l of FLOOR.grid.values()) { const j = l.indexOf(f); if (j >= 0) l.splice(j, 1); }
  }
  for (const L of R.ladders) { const i = LOOK3S.ladders.indexOf(L); if (i >= 0) LOOK3S.ladders.splice(i, 1); }
  const i = LOOK3S.list.indexOf(W); if (i >= 0) LOOK3S.list.splice(i, 1);
  W.l3 = null;
}
// each step for each castle (updateCastles): the scaffolds that stand are floors and ladders, the rest are not; and the
// masons at work on them (look3Masons, 13v_look3.js)
function look3Scaffolds(C, dt) {
  // a section's scaffold is laid out the first time it is put up (look3Lay), round what stands then: laid out at boot,
  // the 44 scaffolds of the March would hold some 13 MB that most never show
  for (const W of C.sections || []) if (W.state === 'repair' && !W.l3again && W.scaffold) look3Lay(C, W);
  for (const W of C.sections || []) if (W.l3) look3ScafSync(W, !!(W.scaffold && W.scaffold.visible && (W.state === 'repair')));
  if (C.pal) for (const W of C.pal.gaps) if (W.l3) look3ScafSync(W, W.state === 'repair' && !!W.scaffold);
  look4LiftStep(C); // [look4] the lifts go up as the work comes up to them (04d_look4.js)
  if (typeof look3Masons === 'function') look3Masons(C, dt);
}
function look3Lay(C, W) {
  W.l3again = true;
  look3ScaffoldDrop(W);
  const g = W.kind === 'tower' ? towerScaffoldGeo(W) : scaffoldGeo(C, W);
  W.scaffold.geometry.dispose(); W.scaffold.geometry = g;
  for (const q of SHADOW.proxies) if (q.userData.src === W.scaffold) q.geometry = g; // (its shadow too)
  return W.scafInfo;
}
// a geometry with nothing in it, for a scaffold not yet laid out
function look3EmptyGeo() {
  const g = new THREE.BufferGeometry();
  for (const [k, n] of [['position', 3], ['normal', 3], ['aCol', 3], ['aMat', 1], ['aAO', 1]]) g.setAttribute(k, new THREE.Float32BufferAttribute([], n));
  g.setIndex([]);
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 0.01);
  return g;
}
// the scaffold's ladders for the player's E: climb one, climb down one (and walking into one: towerLadderNear)
function look3LadderOffers(P, offer) {
  for (const L of LOOK3S.ladders) {
    if (L.gone || Math.abs(P.x - L.fx) > 8 || Math.abs(P.z - L.fz) > 8) continue;
    if (Math.abs(P.y - L.wyb) < 0.7) offer(dist(P.x, P.z, L.fx, L.fz), 1.5, 'Climb the scaffold', () => towerClimb(P, L, 1), 0.35);
    if (Math.abs(P.y - L.wyt) < 0.7) offer(dist(P.x, P.z, L.ox, L.oz), 1.2, 'Climb down the ladder', () => towerClimb(P, L, -1), 0.35);
  }
}
