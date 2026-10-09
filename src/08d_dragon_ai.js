/* ================================================================== */
/* Cinderwing's behaviour: circle, land, fight, strafe, fall, return      */
/* ================================================================== */
const DRAGON_LEVEL = 24;
ROLE_MULT.boss = [20, 1.6];
MOBS.dragon = { kind: 'dragon', names: [DRAGON_NAME], hp: 1, dmg: 1, speed: 3.2, swing: 2.5, range: 7, aggro: 26, scale: [1, 1], radius: 3.2 };
const DRAGON_ACT = { bite: 0.95, tail: 1.05, breath: 2.4, roar: 1.7 };

function findPerches() {
  const r = mulberry(1212), cands = [];
  for (let i = 0; i < 900; i++) {
    const a = r() * TAU, d = 60 + r() * (R_RING - 110);
    const x = Math.sin(a) * d, z = Math.cos(a) * d;
    if (!isWalkable(x, z)) continue;
    if (SITES.some((S) => dist2(S.x, S.z, x, z) < (S.r + 48) ** 2)) continue;
    const h = heightAt(x, z);
    if (h < WATER_Y + 2) continue;
    const slope = Math.abs(heightAt(x + 4, z) - heightAt(x - 4, z)) + Math.abs(heightAt(x, z + 4) - heightAt(x, z - 4));
    if (slope > 2.2) continue;
    let ok = true;
    for (let s = 0; s < 8 && ok; s++) { const aa = (s / 8) * TAU; if (!isWalkable(x + Math.sin(aa) * 9, z + Math.cos(aa) * 9)) ok = false; }
    if (!ok) continue;
    cands.push({ x, z, y: h, score: h - slope * 3 });
  }
  cands.sort((a, b) => b.score - a.score);
  const out = [];
  for (const c of cands) { if (out.every((o) => dist2(o.x, o.z, c.x, c.z) > 150 * 150)) out.push(c); if (out.length >= 3) break; }
  if (!out.length) out.push({ x: 40, z: 40, y: heightAt(40, 40) });
  return out;
}
function spawnDragon() {
  const D = DRAGON;
  if (!D.perches.length) D.perches = findPerches();
  const a = Math.random() * TAU;
  D.circ.ang = a; D.circ.dir = Math.random() < 0.5 ? 1 : -1;
  const x = Math.sin(a) * D.circ.r, z = Math.cos(a) * D.circ.r;
  const e = makeEnt({ kind: 'dragon', faction: FACTION_MONSTER, role: 'boss', mobType: 'dragon', level: Math.max(DRAGON_LEVEL, warLevel() + 4), name: DRAGON_NAME, x, z, y: heightAt(x, z) + 45, yaw: 0, radius: 3.2, scale: 1 });
  setupStats(e);
  e.flying = true;
  e.fixedY = e.y;
  D.e = e; D.state = 'fly'; D.stateT = 0; D.flyFor = 150 + Math.random() * 120; D.halfDone = false; D.act = null; D.pose = dragonPoseZero();
  D.alt = e.y;
  D.nextBreath = 0; D.nextTail = 0; D.nextBite = 0; D.lastFoe = GAME.t;
}
function updateDragonWorld(dt) {
  const D = DRAGON;
  if (!D.mesh) return;
  if (!D.e || D.e.removed) {
    if (!D.respawnAt) D.respawnAt = GAME.t + (D.e ? 900 : 20);
    if (GAME.t >= D.respawnAt) { D.respawnAt = 0; spawnDragon(); }
  }
}
function setDragonState(s) {
  const D = DRAGON, e = D.e;
  D.state = s; D.stateT = 0; D.act = null;
  e.flying = s !== 'perch' && s !== 'dead';
  if (s === 'perch') { e.fixedY = null; e.y = heightAt(e.x, e.z); }
}
function dragonFoes(e, r) {
  const out = [];
  forNear(e.x, e.z, r, (o) => {
    if (!o.alive || o === e || o.kind === 'door' || o.role === 'critter' || o.faction === FACTION_NEUTRAL || o.faction === FACTION_MONSTER) return;
    out.push(o);
  });
  return out;
}
function dragonBurn(e, x, z, dx, dz, range, half, mult) {
  fireConeAt(x, z, dx, dz, range, half);
  for (const o of dragonFoes(e, range + 3)) {
    const ox = o.x - x, oz = o.z - z, d = Math.hypot(ox, oz);
    if (d > range + o.radius) continue;
    if (d > 1.2 && (ox * dx + oz * dz) / d < Math.cos(half)) continue;
    const r = computeDamage(e, o, mult);
    if (o.mount) dismount(o, 'The flames throw you from the saddle!');
    dealDamage(e, o, r.d, { kind: 'fire', dot: true });
    if (o === GAME.player) flashScreen([0.9, 0.35, 0.05], 0.25);
  }
}
// the dragon's think: called from the NPC loop
function thinkDragon(e, dt) {
  const D = DRAGON, t = GAME.t;
  D.stateT += dt;
  const fwdX = Math.sin(e.yaw), fwdZ = Math.cos(e.yaw);
  if (D.state === 'fly') {
    const C = D.circ, sp = 15;
    C.ang += C.dir * dt * sp / C.r;
    const nx = Math.sin(C.ang) * C.r, nz = Math.cos(C.ang) * C.r;
    e.yaw = Math.atan2(nx - e.x, nz - e.z);
    e.x = nx; e.z = nz;
    const want = Math.max(heightAt(e.x, e.z), WATER_Y) + 44;
    D.alt += (want - D.alt) * (1 - Math.exp(-dt * 0.3));
    e.y = e.fixedY = D.alt;
    if (D.stateT > D.flyFor) { D.perch = D.perches[Math.floor(Math.random() * D.perches.length)]; setDragonState('approach'); }
    return;
  }
  if (D.state === 'approach' || D.state === 'strafeIn') {
    const P = D.perch;
    const dx = P.x - e.x, dz = P.z - e.z, d = Math.hypot(dx, dz) || 1;
    e.yaw += clamp(angDiff(e.yaw, Math.atan2(dx, dz)), -dt * 0.8, dt * 0.8);
    const sp = 17;
    e.x += Math.sin(e.yaw) * sp * dt; e.z += Math.cos(e.yaw) * sp * dt;
    const want = P.y + (d > 60 ? 38 : 16 + d * 0.35);
    D.alt += (want - D.alt) * (1 - Math.exp(-dt * 0.6));
    e.y = e.fixedY = D.alt;
    if (d < 9 || (d < 22 && D.stateT > 25)) { D.descendFrom = e.y; setDragonState('descend'); }
    return;
  }
  if (D.state === 'descend') {
    const P = D.perch, k = clamp(D.stateT / 3.6, 0, 1);
    e.x += (P.x - e.x) * (1 - Math.exp(-dt * 1.5)); e.z += (P.z - e.z) * (1 - Math.exp(-dt * 1.5));
    const g = heightAt(e.x, e.z);
    e.y = e.fixedY = lerp(D.descendFrom, g, smooth(k));
    const Pl = GAME.player;
    if (Pl) e.yaw += clamp(angDiff(e.yaw, Math.atan2(Pl.x - e.x, Pl.z - e.z)), -dt * 0.6, dt * 0.6);
    if (k >= 1) {
      setDragonState('perch');
      D.act = { kind: 'roar', t: 0, dur: DRAGON_ACT.roar };
      D.lastFoe = t;
      FX.ring(e.x, e.y + 0.3, e.z, 2, [0.5, 0.45, 0.38], 50, 9);
      FX.dust(e.x, e.y, e.z, 40, [0.45, 0.4, 0.32]);
      cameraShake(0.5, e.x, e.z);
      natureImpact(e.x, e.z, 'dragon'); // nature (05h_nature.js): the landing craters the ground and throws down trees
      sfx('thud');
      if (Pl && dist(Pl.x, Pl.z, e.x, e.z) < 260) news(`${DRAGON_NAME} has landed in the March!`, -1, 'big');
    }
    return;
  }
  if (D.state === 'takeoff') {
    const k = clamp(D.stateT / 2.6, 0, 1);
    e.y = e.fixedY = D.liftFrom + smooth(k) * 26;
    if (k >= 1) {
      D.alt = e.y;
      if (D.strafeNext) {
        D.strafeNext = false;
        const P = D.perch, foe = getEnt(D.lastTarget);
        const a = foe ? Math.atan2(foe.x - P.x, foe.z - P.z) : Math.random() * TAU;
        D.strafe = { ax: P.x - Math.sin(a) * 90, az: P.z - Math.cos(a) * 90, bx: P.x + Math.sin(a) * 90, bz: P.z + Math.cos(a) * 90, burnAt: 0 };
        setDragonState('strafeOut');
      } else {
        D.circ.ang = Math.atan2(e.x, e.z); D.circ.dir = Math.random() < 0.5 ? 1 : -1;
        D.flyFor = 150 + Math.random() * 120;
        setDragonState('rejoin');
      }
    }
    return;
  }
  if (D.state === 'rejoin') {
    // climb and swing out to the circuit
    const C = D.circ, tx = Math.sin(C.ang) * C.r, tz = Math.cos(C.ang) * C.r;
    const dx = tx - e.x, dz = tz - e.z, d = Math.hypot(dx, dz);
    e.yaw += clamp(angDiff(e.yaw, Math.atan2(dx, dz)), -dt * 0.7, dt * 0.7);
    e.x += Math.sin(e.yaw) * 15 * dt; e.z += Math.cos(e.yaw) * 15 * dt;
    D.alt += (Math.max(heightAt(e.x, e.z), WATER_Y) + 44 - D.alt) * (1 - Math.exp(-dt * 0.4));
    e.y = e.fixedY = D.alt;
    if (d < 12) setDragonState('fly');
    return;
  }
  if (D.state === 'strafeOut') {
    // swing round to the start of the run
    const S = D.strafe, dx = S.ax - e.x, dz = S.az - e.z, d = Math.hypot(dx, dz);
    e.yaw += clamp(angDiff(e.yaw, Math.atan2(dx, dz)), -dt * 0.9, dt * 0.9);
    e.x += Math.sin(e.yaw) * 18 * dt; e.z += Math.cos(e.yaw) * 18 * dt;
    D.alt += (D.perch.y + 22 - D.alt) * (1 - Math.exp(-dt * 0.5));
    e.y = e.fixedY = D.alt;
    if (d < 14 || D.stateT > 14) { setDragonState('strafe'); sfx('roar'); }
    return;
  }
  if (D.state === 'strafe') {
    // a low run over the field, breathing fire straight down the line
    const S = D.strafe, dx = S.bx - e.x, dz = S.bz - e.z, d = Math.hypot(dx, dz);
    e.yaw += clamp(angDiff(e.yaw, Math.atan2(dx, dz)), -dt * 0.5, dt * 0.5);
    e.x += Math.sin(e.yaw) * 20 * dt; e.z += Math.cos(e.yaw) * 20 * dt;
    D.alt += (Math.max(heightAt(e.x, e.z), WATER_Y) + 13 - D.alt) * (1 - Math.exp(-dt * 1.2));
    e.y = e.fixedY = D.alt;
    const near = dist(e.x, e.z, D.perch.x, D.perch.z) < 55;
    D.breathing = near;
    if (near && t > S.burnAt) {
      S.burnAt = t + 0.22;
      const gx = e.x + Math.sin(e.yaw) * 6, gz = e.z + Math.cos(e.yaw) * 6;
      dragonBurn(e, gx, gz, Math.sin(e.yaw), Math.cos(e.yaw), 6, Math.PI, 0.55);
      if (Math.random() < 0.45) addFire(gx + (Math.random() - 0.5) * 4, heightAt(gx, gz) + 0.05, gz + (Math.random() - 0.5) * 4, 0.7, false, t + 8);
    }
    if (d < 12 || D.stateT > 16) { D.breathing = false; setDragonState('strafeIn'); }
    return;
  }
  if (D.state === 'dead') return;
  /* ---- on the ground ---- */
  if (D.state !== 'perch') return;
  const foes = dragonFoes(e, 30);
  let tgt = getEnt(e.target);
  if (tgt && (!tgt.alive || dist(tgt.x, tgt.z, D.perch.x, D.perch.z) > 34)) tgt = null;
  if (!tgt && foes.length) {
    let best = null, bs = Infinity;
    for (const o of foes) {
      if (dist(o.x, o.z, D.perch.x, D.perch.z) > 32) continue;
      const th = e.threat && e.threat.get(o.id) || 0;
      const s = dist2(o.x, o.z, e.x, e.z) - th * 3 - (o.role === 'player' ? 30 : 0);
      if (s < bs) { bs = s; best = o; }
    }
    tgt = best;
  }
  e.target = tgt ? tgt.id : null;
  if (tgt) { D.lastFoe = t; D.lastTarget = tgt.id; }
  // wounded: up into the air for a burning run, then back down
  if (!D.halfDone && e.hp < e.maxHp * 0.5 && !D.act) {
    D.halfDone = true; D.strafeNext = true; D.liftFrom = e.y; setDragonState('takeoff'); sfx('roar'); return;
  }
  if (!tgt && t - D.lastFoe > 70 && !D.act) {
    // nothing to fight: heal and take to the sky again
    e.hp = e.maxHp; e.threat = null; D.halfDone = false; D.liftFrom = e.y; setDragonState('takeoff'); return;
  }
  // the current move
  if (D.act) {
    const A = D.act;
    A.t += dt;
    const at = A.t / A.dur;
    if (A.kind === 'bite' && !A.hit && at > 0.48) {
      A.hit = true;
      const o = getEnt(A.tgt);
      if (o && o.alive && dist(o.x, o.z, e.x + fwdX * 4.5, e.z + fwdZ * 4.5) < 4.2 + o.radius) {
        const r = computeDamage(e, o, 1.6);
        dealDamage(e, o, r.d, { kind: 'melee', crit: r.crit });
        FX.sparks(o.x, o.y + 1.1, o.z); sfx('hit'); cameraShake(0.2, o.x, o.z);
      }
    }
    if (A.kind === 'tail' && !A.hit && at > 0.5) {
      A.hit = true;
      for (const o of dragonFoes(e, 10)) {
        const ang = Math.abs(angDiff(e.yaw + Math.PI, Math.atan2(o.x - e.x, o.z - e.z)));
        if (ang > 1.4) continue;
        const r = computeDamage(e, o, 1.3);
        dealDamage(e, o, r.d, { kind: 'melee' });
        FX.dust(o.x, o.y, o.z, 6);
      }
      sfx('swing'); FX.dust(e.x - fwdX * 6, e.y, e.z - fwdZ * 6, 18, [0.45, 0.4, 0.32]);
    }
    if (A.kind === 'breath') {
      D.breathing = at > 0.28 && at < 0.88;
      if (D.breathing && t > (A.tick || 0)) {
        A.tick = t + 0.25;
        const sweep = 0.38 * Math.sin((at - 0.28) / 0.6 * Math.PI * 1.4 - 0.7);
        const yaw = e.yaw + sweep;
        const mx = e.x + Math.sin(e.yaw) * 5.2, mz = e.z + Math.cos(e.yaw) * 5.2;
        dragonBurn(e, mx, mz, Math.sin(yaw), Math.cos(yaw), 17, 0.36, 0.5);
        if (Math.random() < 0.6) { const rr = 5 + Math.random() * 11; const fx = mx + Math.sin(yaw) * rr, fz = mz + Math.cos(yaw) * rr; addFire(fx, heightAt(fx, fz) + 0.05, fz, 0.6 + Math.random() * 0.3, false, t + 7); }
      }
    }
    if (A.t >= A.dur) { D.act = null; D.breathing = false; }
    return;
  }
  if (!tgt) { D.walking = 0; return; }
  // turn to face, step closer, then choose a move
  const dx = tgt.x - e.x, dz = tgt.z - e.z, d = Math.hypot(dx, dz);
  const want = Math.atan2(dx, dz), off = angDiff(e.yaw, want);
  e.yaw += clamp(off, -dt * 1.1, dt * 1.1);
  D.walking = Math.abs(off) > 0.15 ? 0.6 : 0;
  const behind = foes.some((o) => dist(o.x, o.z, e.x, e.z) < 9 && Math.abs(angDiff(e.yaw + Math.PI, Math.atan2(o.x - e.x, o.z - e.z))) < 1.2);
  if (behind && t > D.nextTail) { D.nextTail = t + 7; D.act = { kind: 'tail', t: 0, dur: DRAGON_ACT.tail, side: Math.random() < 0.5 ? 1 : -1 }; return; }
  if (Math.abs(off) > 0.5) return;
  if (t > D.nextBreath && d < 17 && d > 4) { D.nextBreath = t + 11 + Math.random() * 5; D.act = { kind: 'breath', t: 0, dur: DRAGON_ACT.breath }; aoeMarker(e.x + fwdX * 13, e.z + fwdZ * 13, 7, 1.0); sfx('breath'); return; }
  if (d < 7.8 && t > D.nextBite) { D.nextBite = t + 2.4; D.act = { kind: 'bite', t: 0, dur: DRAGON_ACT.bite, tgt: tgt.id }; return; }
  if (d > 6.5 && dist(e.x + fwdX, e.z + fwdZ, D.perch.x, D.perch.z) < 26) {
    const sp = 3.2;
    const nx = e.x + fwdX * sp * dt, nz = e.z + fwdZ * sp * dt;
    if (isWalkable(nx, nz)) { e.x = nx; e.z = nz; e.y = heightAt(nx, nz); D.walking = 1; }
  }
}
function onDragonDeath(e) {
  const D = DRAGON;
  D.state = 'dead'; D.stateT = 0; D.act = null; D.breathing = false;
  D.fallFrom = e.y;
  e.removeAt = GAME.t + 90;
  e.flying = false;
  news(`${DRAGON_NAME} has fallen!`, -1, 'big');
  sfx('roar');
}

/* ------------------------------------------------------------------ */
/* the dragon's body language, eased each frame                        */
/* ------------------------------------------------------------------ */
const _dRoot = new THREE.Matrix4(), _dRy = new THREE.Matrix4(), _dSph = new THREE.Sphere(), _dHeadF = new THREE.Vector3(), _dMouth = new THREE.Vector3();
function dragonTargetPose(dt) {
  const D = DRAGON, e = D.e, P = dragonPoseZero(), t = renderTime;
  const st = D.state;
  const flying = st === 'fly' || st === 'approach' || st === 'rejoin' || st === 'strafeOut' || st === 'strafe' || st === 'strafeIn';
  const hover = st === 'descend' || st === 'takeoff' || (st === 'approach' && D.e && dist(e.x, e.z, D.perch.x, D.perch.z) < 30);
  if (flying || hover) {
    const glideT = st === 'fly' ? (Math.sin(t * 0.11 + 1.3) > 0.25 ? 1 : 0) : 0;
    D.glide += (glideT - D.glide) * (1 - Math.exp(-dt * 1.2));
    const gl = hover ? 0 : D.glide;
    const rate = hover ? 0.95 : 0.55;
    D.flap += dt * TAU * rate * (1 - 0.85 * gl);
    const a = Math.sin(D.flap), c = Math.cos(D.flap);
    const wing = [0.16 + (hover ? 0.75 : 0.62) * a * (1 - gl) + 0.06 * gl, (hover ? -0.35 : -0.12) * c * (1 - gl), 0.15 * c * (1 - gl), 0.42 * Math.sin(D.flap - 0.7) * (1 - gl) + 0.04 * gl, 0.08 + 0.22 * Math.max(0, -c) * (1 - gl), 0];
    P.wl = wing; P.wr = wing.slice();
    P.bodyY = -0.3 * a * (1 - gl);
    if (hover) {
      P.bodyPitch = -0.5; P.fl = [-0.35, 0.25, 0.2]; P.fr = [-0.35, 0.25, 0.2]; P.bl = [-0.15, 0.35, -0.15]; P.br = [-0.15, 0.35, -0.15];
      P.neck = [-0.05, 0.15, 0.2]; P.head = 0.12; P.tail = [0.22, 0.12, 0.08, 0.05];
    } else {
      P.bodyPitch = st === 'strafe' ? 0.12 : 0.04;
      P.bodyRoll = st === 'fly' ? -D.circ.dir * 0.32 : 0;
      P.fl = [0.95, -1.55, 0.6]; P.fr = [0.95, -1.55, 0.6]; P.bl = [1.15, 0.45, 0.4]; P.br = [1.15, 0.45, 0.4];
      P.neck = [0.3, 0.2, 0.14]; P.head = st === 'strafe' ? 0.35 : -0.36;
      P.tail = [-0.1, -0.05, 0.0, 0.05];
      P.neckYaw = [0, 0, 0].map(() => (st === 'fly' ? D.circ.dir * 0.06 : 0));
    }
    for (let k = 0; k < 4; k++) P.tailYaw[k] = 0.09 * Math.sin(t * 1.5 - k * 0.9);
    P.jaw = D.breathing ? 0.7 : 0.04;
    // a downstroke whoosh when close
    if (Math.sin(D.flap - 0.4) > 0.9 && D.wingSnd < t && dist2(e.x, e.z, camera.position.x, camera.position.z) < 90 * 90) { D.wingSnd = t + 0.6; sfx('wingbeat'); }
    return P;
  }
  if (st === 'dead') {
    const k = clamp(D.stateT / 1.2, 0, 1);
    P.bodyRoll = 1.25 * smooth(k); P.bodyY = -1.15 * smooth(k);
    P.wl = [0.35, 0.5, 0.3, -0.1, 0.7, 0.3]; P.wr = [-0.6, 0.9, 0.2, -0.3, 1.2, 0.6];
    P.neck = [0.25, 0.3, 0.2]; P.neckYaw = [0.3, 0.3, 0.2]; P.head = 0.3; P.jaw = 0.35;
    P.fl = [0.4, 0.6, 0.3]; P.fr = [-0.3, 0.8, 0.2]; P.bl = [0.5, 0.4, 0.2]; P.br = [-0.2, 0.5, 0.2];
    P.tail = [-0.05, -0.05, -0.05, -0.05]; P.tailYaw = [0.2, 0.25, 0.3, 0.3];
    return P;
  }
  // standing on the perch: wings folded, neck in an S, tail on the ground
  P.wl = [0.6, 1.0, 0.0, -1.4, 0.6, 1]; P.wr = P.wl.slice();
  P.chest = 0.025 * Math.sin(t * 1.1);
  P.neck = [-0.28, 0.06, 0.3]; P.head = 0.24;
  P.tail = [-0.04, -0.08, -0.06, -0.03];
  for (let k = 0; k < 4; k++) P.tailYaw[k] = 0.16 * Math.sin(t * 0.55 - k * 0.7);
  const tg = getEnt(e.target);
  if (tg) {
    const off = clamp(angDiff(e.yaw, Math.atan2(tg.x - e.x, tg.z - e.z)), -1.2, 1.2);
    P.neckYaw = [off * 0.22, off * 0.28, off * 0.25]; P.headYaw = off * 0.2;
  } else {
    const look = 0.5 * Math.sin(t * 0.21) * Math.sin(t * 0.13 + 1);
    P.neckYaw = [look * 0.25, look * 0.3, look * 0.3]; P.headYaw = look * 0.2;
  }
  // stepping when it walks or turns
  if (D.walking > 0.01) {
    D.walkPh += dt * 3.2;
    const sw = (o) => Math.sin(D.walkPh + o) * 0.32, lift = (o) => Math.max(0, Math.cos(D.walkPh + o)) * 0.55;
    P.fl = [-sw(1.57), lift(1.57), 0]; P.fr = [-sw(4.71), lift(4.71), 0]; P.bl = [-sw(0), -lift(0) * 0.6, 0]; P.br = [-sw(3.14), -lift(3.14) * 0.6, 0];
    P.bodyY = 0.05 * Math.abs(Math.sin(D.walkPh));
  }
  const A = D.act;
  if (A) {
    const at = clamp(A.t / A.dur, 0, 1), k = Math.sin(at * Math.PI);
    if (A.kind === 'bite') {
      P.neck = [P.neck[0] + 0.32 * k, P.neck[1] + 0.32 * k, P.neck[2] + 0.12 * k]; P.head -= 0.15 * k;
      P.jaw = at < 0.42 ? 0.65 * smooth(at / 0.42) : 0.65 * (1 - smooth(clamp((at - 0.42) / 0.12, 0, 1)));
    } else if (A.kind === 'tail') {
      for (let q = 0; q < 4; q++) P.tailYaw[q] = A.side * (0.55 + 0.15 * q) * k;
      P.neckYaw = P.neckYaw.map((v) => v - A.side * 0.25 * k); P.bodyRoll = -A.side * 0.08 * k;
    } else if (A.kind === 'breath') {
      const wind = smooth(clamp(at / 0.28, 0, 1)), fire = clamp((at - 0.28) / 0.6, 0, 1), rec = smooth(clamp((at - 0.88) / 0.12, 0, 1));
      const sweep = 0.38 * Math.sin(fire * Math.PI * 1.4 - 0.7) * (fire > 0 ? 1 : 0);
      P.neck = [-0.4 * wind + 0.62 * (fire > 0 ? 1 : 0) * (1 - rec), -0.15 * wind + 0.3 * (fire > 0 ? 1 : 0) * (1 - rec), 0.3]; P.head = 0.24 - 0.5 * wind + 0.55 * (fire > 0 ? 1 : 0) * (1 - rec);
      P.neckYaw = [sweep * 0.3, sweep * 0.35, sweep * 0.25]; P.headYaw = sweep * 0.15;
      P.jaw = 0.3 * wind + 0.5 * (fire > 0 ? 1 : 0) * (1 - rec);
      P.wl = [0.55, 0.7, 0.0, -0.9, 0.4, 0.6]; P.wr = P.wl.slice();
    } else if (A.kind === 'roar') {
      const r = smooth(clamp(at / 0.2, 0, 1)) * (1 - smooth(clamp((at - 0.85) / 0.15, 0, 1)));
      P.neck = [P.neck[0] - 0.35 * r, P.neck[1] - 0.25 * r, P.neck[2] - 0.15 * r]; P.head -= 0.5 * r; P.jaw = 0.85 * r;
      P.wl = [0.6 + 0.1 * r, 1.0 - 0.75 * r, 0.0, -1.4 + 1.2 * r, 0.6 - 0.4 * r, 1 - 0.8 * r]; P.wr = P.wl.slice();
      if (!A.snd && at > 0.15) { A.snd = true; sfx('roar'); cameraShake(0.35, D.e.x, D.e.z); }
    }
  }
  if (D.poseOverride) for (const k in D.poseOverride) P[k] = Array.isArray(D.poseOverride[k]) ? D.poseOverride[k].slice() : D.poseOverride[k];
  return P;
}
function easePose(P, T, k) {
  for (const key in T) {
    const v = T[key];
    if (Array.isArray(v)) for (let i = 0; i < v.length; i++) P[key][i] += (v[i] - P[key][i]) * k;
    else P[key] += (v - P[key]) * k;
  }
}
function drawDragon(dt) {
  const D = DRAGON, e = D.e;
  if (!D.mesh) return;
  if (!e || e.removed) { D.mesh.visible = false; return; }
  const d2 = dist2(e.x, e.z, camera.position.x, camera.position.z);
  _dSph.center.set(e.x, e.y + 3, e.z); _dSph.radius = 13;
  const vis = d2 < 520 * 520 && frustum.intersectsSphere(_dSph);
  if (D.state === 'dead' && e.fixedY !== null) {
    // falling out of the sky
    const g = heightAt(e.x, e.z);
    e.fixedY = Math.max(g, e.fixedY - dt * Math.min(30, 4 + D.stateT * 14));
    e.y = e.fixedY;
    if (e.fixedY <= g + 0.01) { e.fixedY = null; e.y = g; FX.dust(e.x, g, e.z, 40, [0.45, 0.4, 0.32]); cameraShake(0.6, e.x, e.z); sfx('crash'); }
  }
  if (D.state === 'dead') D.stateT += dt;
  // ease toward the pose the state asks for (faster during sharp moves)
  const T = dragonTargetPose(dt);
  easePose(D.pose, T, 1 - Math.exp(-dt * (D.act ? 10 : 4.5)));
  if (!vis) { D.mesh.visible = false; return; }
  D.mesh.visible = true;
  _dRoot.makeTranslation(e.x, e.y + D.pose.bodyY, e.z);
  _dRy.makeRotationY(e.yaw);
  _dRoot.multiply(_dRy);
  poseDragonBones(_dRoot);
  // skin every frame when close, every other frame further out
  D.skinTick = (D.skinTick || 0) + 1;
  if (d2 < 150 * 150 || D.skinTick % 2 === 0) skinDragon();
  dragonMat.uniforms.uHurt.value = e.anim ? e.anim.flash : 0;
  // fire from the mouth
  const breath = D.breathing ? 1 : 0;
  dragonMat.uniforms.uBreath.value += (breath - dragonMat.uniforms.uBreath.value) * (1 - Math.exp(-dt * 8));
  if (D.breathing && d2 < 260 * 260) {
    _dMouth.copy(dragonPoint(DBI.head, [0, 4.42, 5.7]));
    _dHeadF.set(0, -0.12, 1).transformDirection(DRAGON.world[DBI.head]);
    if (D.state === 'strafe') _dHeadF.set(Math.sin(e.yaw) * 0.55, -0.83, Math.cos(e.yaw) * 0.55);
    const n = quality.level === 'low' ? 10 : 22;
    for (let i = 0; i < n; i++) {
      const s = 16 + Math.random() * 9, j = 0.13;
      const vx = (_dHeadF.x + (Math.random() - 0.5) * j * 2) * s, vy = (_dHeadF.y + (Math.random() - 0.5) * j * 2) * s, vz = (_dHeadF.z + (Math.random() - 0.5) * j * 2) * s;
      const hot = Math.random();
      fxAdd.emit(_dMouth.x, _dMouth.y, _dMouth.z, vx, vy, vz, 0.55 + Math.random() * 0.45, 2.6 + hot * 0.6, 1.0 + hot * 1.0, 0.25 + hot * 0.4, 0.5 + Math.random() * 0.6, -2.0, 1.4);
    }
    if (Math.random() < 0.35) fxAlpha.emit(_dMouth.x + _dHeadF.x * 9, _dMouth.y + _dHeadF.y * 9 + 1, _dMouth.z + _dHeadF.z * 9, _dHeadF.x * 3, 1.2, _dHeadF.z * 3, 2.5, 0.12, 0.1, 0.09, -2.2, -0.4, 0.4);
    lightFlash(_dMouth.x + _dHeadF.x * 5, _dMouth.y + _dHeadF.y * 5, _dMouth.z + _dHeadF.z * 5, 18, [3.2, 1.4, 0.35], 0.08);
  }
  // ground shadow when it stands
  if (!e.flying && Math.abs(e.x - (GAME.player ? GAME.player.x : e.x)) < 46 && Math.abs(e.z - (GAME.player ? GAME.player.z : e.z)) < 46) decalAdd(e.x, e.z, 4.2, 0);
}
