/* ================================================================== */
/* player: input, camera, movement, targeting, interaction             */
/* ================================================================== */
const INPUT = { keys: new Set(), drag: null, wheel: 0, joy: null, look: null, pointers: new Map() };
const CAM = { yaw: 0, pitch: 0.36, dist: 8.5, targetDist: 8.5, pos: new THREE.Vector3(), focus: new THREE.Vector3(), shake: 0, mode: 'title', orbitT: 0 };
const PLAYER_SPEED = 6.9;

function createPlayer(save) {
  const realm = save.realm, cls = save.cls;
  const r = mulberry(Array.from(save.name).reduce((a, c) => a * 31 + c.charCodeAt(0), 7));
  const look = classLook(cls, realm, r, save.name);
  look.mask |= WB.cape;
  GAME.prog = { level: save.level || 1, xp: save.xp || 0, rp: save.rp || 0, kills: save.kills || 0, realmKills: save.realmKills || 0, deaths: save.deaths || 0, bounty: save.bounty || null, played: save.played || 0 };
  resetInventory(save);
  const T = REALMS[realm].town;
  const sp = siteWorld(T, (r() - 0.5) * 6, 0, 12);
  let x = sp.x, z = sp.z;
  if (save.pos && isFiniteNum(save.pos.x) && isFiniteNum(save.pos.z)) {
    const zk = zoneAt(save.pos.x, save.pos.z).kind;
    if (isWalkable(save.pos.x, save.pos.z) && zk !== 'keep' && zk !== 'temple') { x = save.pos.x; z = save.pos.z; }
    else if (Math.hypot(save.pos.x, save.pos.z) < R_RING) { const m = siteWorld(REALMS[realm].musterSite, (r() - 0.5) * 4, 0, 9); x = m.x; z = m.z; }
  }
  const P = makeEnt({ kind: 'humanoid', faction: realm, role: 'player', cls, level: GAME.prog.level, name: save.name, x, z, y: heightAt(x, z), yaw: T.yaw + Math.PI, look, radius: 0.45, scale: look.scale });
  P.baseLook = { ...look, tabard: look.tabard.slice(), armor: look.armor.slice() };
  GAME.player = P;
  applyGear();
  setupStats(P);
  P.endurance = 100;
  CAM.yaw = P.yaw;
  CAM.mode = 'play';
  return P;
}

/* ------------------------------------------------------------------ */
/* input                                                               */
/* ------------------------------------------------------------------ */
const typing = () => { const a = document.activeElement; return a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA'); };
window.addEventListener('keydown', (e) => {
  if (typing()) return;
  const k = e.code;
  if (['Space', 'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(k) && GAME.started) e.preventDefault();
  if (e.repeat && !['KeyW', 'KeyA', 'KeyS', 'KeyD'].includes(k)) return;
  INPUT.keys.add(k);
  if (!GAME.started) return;
  if (k === 'Escape') { onEscape(); return; }
  if (k === 'KeyM') { toggleMap(); return; }
  if (k === 'KeyI' || k === 'KeyB') { if (!UI.modal || UI.modal === 'kit') toggleKit(); return; }
  if (UI.modal) return;
  if (k.startsWith('Digit')) { const n = parseInt(k.slice(5), 10); if (n >= 1 && n <= 8) playerUseSlot(n - 1); }
  if (k === 'Tab') cycleTarget(e.shiftKey);
  if (k === 'KeyF') { setPlayerTarget(GAME.player); }
  if (k === 'KeyE') playerInteract();
  if (k === 'KeyR') toggleMount();
  if (k === 'KeyQ') usePotion();
  if (k === 'KeyL') toggleLog();
  if (k === 'KeyH') openMenu('help');
});
window.addEventListener('keyup', (e) => { INPUT.keys.delete(e.code); });
window.addEventListener('blur', () => { INPUT.keys.clear(); INPUT.joy = null; });
const keyDown = (...codes) => codes.some((c) => INPUT.keys.has(c));

canvas.addEventListener('contextmenu', (e) => e.preventDefault());
canvas.addEventListener('pointerdown', (e) => {
  try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* synthetic or already released */ }
  audioUnlock();
  if (e.pointerType === 'touch' && GAME.started && !UI.modal) {
    // left part of the screen: movement stick
    if (!INPUT.joy && e.clientX < view.w * 0.42 && e.clientY > view.h * 0.35) {
      INPUT.joy = { id: e.pointerId, ox: e.clientX, oy: e.clientY, dx: 0, dy: 0 };
      showJoystick(e.clientX, e.clientY, 0, 0);
      return;
    }
  }
  INPUT.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, button: e.button, moved: 0, t: performance.now(), type: e.pointerType });
});
canvas.addEventListener('pointermove', (e) => {
  if (INPUT.joy && e.pointerId === INPUT.joy.id) {
    let dx = e.clientX - INPUT.joy.ox, dy = e.clientY - INPUT.joy.oy;
    const l = Math.hypot(dx, dy), max = 56;
    if (l > max) { dx *= max / l; dy *= max / l; }
    INPUT.joy.dx = dx / max; INPUT.joy.dy = dy / max;
    showJoystick(INPUT.joy.ox, INPUT.joy.oy, dx, dy);
    return;
  }
  const p = INPUT.pointers.get(e.pointerId);
  if (!p) return;
  const dx = e.clientX - p.x, dy = e.clientY - p.y;
  p.x = e.clientX; p.y = e.clientY;
  p.moved += Math.abs(dx) + Math.abs(dy);
  if (p.moved > 4 && CAM.mode === 'play') {
    const k = p.type === 'touch' ? 0.0062 : 0.0048;
    CAM.yaw -= dx * k;
    CAM.pitch = clamp(CAM.pitch + dy * k * 0.8, -0.25, 1.25);
    if (p.button === 2 && GAME.player && GAME.player.alive && !GAME.player.casting) GAME.player.yaw = CAM.yaw;
  }
});
function endPointer(e) {
  if (INPUT.joy && e.pointerId === INPUT.joy.id) { INPUT.joy = null; hideJoystick(); return; }
  const p = INPUT.pointers.get(e.pointerId);
  INPUT.pointers.delete(e.pointerId);
  if (!p) return;
  if (p.moved < 8 && performance.now() - p.t < 450 && GAME.started && !UI.modal && e.type === 'pointerup') pickAt(e.clientX, e.clientY);
}
canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', endPointer);
canvas.addEventListener('wheel', (e) => { e.preventDefault(); CAM.targetDist = clamp(CAM.targetDist * (1 + Math.sign(e.deltaY) * 0.12), 3.2, 22); }, { passive: false });

/* ------------------------------------------------------------------ */
/* targeting                                                           */
/* ------------------------------------------------------------------ */
const _proj = new THREE.Vector3();
function screenOf(x, y, z) {
  _proj.set(x, y, z).project(camera);
  if (_proj.z > 1 || _proj.z < -1) return null;
  return { x: (_proj.x * 0.5 + 0.5) * view.w, y: (-_proj.y * 0.5 + 0.5) * view.h, z: _proj.z };
}
function pickAt(sx, sy) {
  const P = GAME.player;
  let best = null, bd = Infinity;
  for (const e of ENT) {
    if (e.removed || e.role === 'critter' || e.flying) continue;
    if (!e.alive && e.kind !== 'door') continue;
    if (e.kind === 'door' && !e.alive) continue;
    const d3 = dist(e.x, e.z, camera.position.x, camera.position.z);
    if (d3 > 90) continue;
    const h = e.kind === 'door' ? 2.5 : e.kind === 'dragon' ? 3 : (e.kind === 'humanoid' ? 1.0 + (e.mount ? 0.8 : 0) : 0.6) * (e.scale || 1);
    const s = screenOf(e.x, e.y + h, e.z);
    if (!s) continue;
    const rad = clamp((e.kind === 'door' ? 900 : e.kind === 'dragon' ? 1400 : 260) / Math.max(d3, 1), 18, e.kind === 'dragon' ? 260 : 120) * (e.scale || 1);
    const d = Math.hypot(s.x - sx, (s.y - sy) * 0.8);
    if (d < rad && d - rad * 0.3 * (e === P ? -1 : 0) < bd) { bd = d; best = e; }
  }
  setPlayerTarget(best);
}
function setPlayerTarget(e) {
  const P = GAME.player;
  if (!P) return;
  P.target = e ? e.id : null;
  if (e && e !== P) sfx('click');
}
function cycleTarget(back = false) {
  const P = GAME.player;
  const list = [];
  forNear(P.x, P.z, 40, (o) => {
    if (!o.alive || !isEnemy(P, o) || o.kind === 'door') return;
    const ang = Math.abs(angDiff(CAM.yaw, Math.atan2(o.x - P.x, o.z - P.z)));
    if (ang > 1.4) return;
    list.push(o);
  });
  if (!list.length) { setPlayerTarget(null); return; }
  list.sort((a, b) => dist2(a.x, a.z, P.x, P.z) - dist2(b.x, b.z, P.x, P.z));
  const i = list.findIndex((o) => o.id === P.target);
  setPlayerTarget(list[(i + (back ? list.length - 1 : 1) + list.length) % list.length] || list[0]);
}
function playerUseSlot(i) {
  const P = GAME.player;
  if (!P || !P.alive) return;
  const id = CLASSES[P.cls].abilities[i];
  if (!id) return;
  if (P.mount) dismount(P);
  let t = getEnt(P.target);
  const A = ABILITIES[id];
  if (!A.self && !A.friendly && (!t || !isEnemy(P, t) || !t.alive)) {
    cycleTarget();
    t = getEnt(P.target);
  }
  // with no foe to aim at, a fire spell can be aimed at the house in front of you
  const aim = !A.self && !A.friendly && (!t || !isEnemy(P, t) || !t.alive) ? houseFireAim(P, id) : null;
  const r = aim ? castAtHouse(P, id, aim) : useAbility(P, id, t);
  if (r !== true) {
    const msg = { cooldown: 'That ability is not ready yet', power: 'Not enough power', range: 'Your target is too far away', target: 'You need a hostile target', close: 'Too close to charge', level: `Learned at level ${A.level}`, stunned: 'You are stunned', busy: 'You are already casting', carrying: 'Your hands are full with the hallow', dead: '' }[r];
    if (msg) uiError(msg);
  } else flashSlot(i);
}

/* ------------------------------------------------------------------ */
/* interactions                                                        */
/* ------------------------------------------------------------------ */
function currentInteraction() {
  const P = GAME.player;
  if (!P || !P.alive) return null;
  const R = REALMS[P.faction];
  // the nearest thing in reach wins; hallows win ties
  let best = null, bs = Infinity;
  const offer = (d, range, label, act, bias = 0) => { const sc = d / range - bias; if (d < range && sc < bs) { bs = sc; best = { label, act }; } };
  for (const rel of WAR.relics) {
    if (!relicTakeable(rel, P)) continue;
    const p = relicPosition(rel);
    offer(dist(P.x, P.z, p.x, p.z), 3.4, `Take ${REALMS[rel.realm].hallow}`, () => pickUpRelic(rel, P), 0.5);
  }
  if (P.carrying == null) {
    offer(dist(P.x, P.z, R.town.x, R.town.z), 4.8, `Step through the stones to ${R.name} Muster`, () => teleportPlayer(R.musterSite, 'frontier'));
    offer(dist(P.x, P.z, R.musterSite.x, R.musterSite.z), 4.8, `Step through the stones to ${R.townName}`, () => teleportPlayer(R.town, 'home'));
  }
  if (R.herald) offer(dist(P.x, P.z, R.herald.x, R.herald.z), 4.5, `Speak with the ${R.name} Herald`, () => openHerald());
  if (R.merchant) offer(dist(P.x, P.z, R.merchant.x, R.merchant.z), 4.6, `Trade with ${R.merchant.name}`, () => openKit('shop'));
  // the barrow: in through the door, out by the stair, and whatever the dead left behind
  if (inDungeon(P)) {
    const ex = DUN.spots.exit;
    offer(dist(P.x, P.z, ex.x, ex.z), 3.4, 'Climb back up to the daylight', () => leaveBarrow());
    for (const ch of DUN.chests) if (ch.ready && !ch.opened) offer(dist(P.x, P.z, ch.x, ch.z), 3.0, ch.label || 'Open the chest', () => openChest(ch), 0.3);
  } else if (BARROW.door && P.carrying == null) offer(dist(P.x, P.z, BARROW.door.x, BARROW.door.z), 3.8, 'Enter the Hollow Barrow', () => enterBarrow());
  houseOffers(P, offer); // doors and shutters
  natureOffers(P, offer); // nature (05h_nature.js): trees to chop, logs to split, firewood to light
  return best;
}
function playerInteract() {
  const it = currentInteraction();
  if (it) { it.act(); sfx('click'); }
}
function teleportPlayer(S, kind) {
  const P = GAME.player;
  FX.burst(P.x, P.y + 1, P.z, 40, [0.5, 1.4, 1.8], 3, 0.8, 0.2, -1);
  const a = Math.random() * TAU;
  const p = siteWorld(S, Math.cos(a) * 2, 0, 9 + Math.sin(a) * 2);
  dismount(P);
  P.x = p.x; P.z = p.z; P.prevX = p.x; P.prevZ = p.z; P.y = heightAt(p.x, p.z);
  P.yaw = S.yaw + (kind === 'frontier' ? 0 : Math.PI);
  CAM.yaw = P.yaw;
  P.target = null;
  FX.burst(P.x, P.y + 1, P.z, 40, [0.5, 1.4, 1.8], 3, 0.8, 0.2, -1);
  sfx('portal');
  flashScreen([0.5, 0.9, 1.0], 0.4);
  saveSoon();
}

/* bounties from the herald */
function chooseBounty() {
  const P = GAME.player, prog = GAME.prog;
  const camps = CAMPS.filter((c) => c.realm === P.faction).map((c) => ({ c, mid: (c.lmin + c.lmax) / 2 }));
  camps.sort((a, b) => Math.abs(a.mid - prog.level - 0.5) - Math.abs(b.mid - prog.level - 0.5));
  const c = camps[Math.floor(Math.random() * Math.min(2, camps.length))].c;
  return { type: c.type, camp: c.id, need: 6, have: 0, name: MOBS[c.type].names[mobTier(MOBS[c.type], (c.lmin + c.lmax) / 2)], reward: Math.round(xpToNext(prog.level) * 0.35) };
}
function bountyOnKill(e) {
  const b = GAME.prog && GAME.prog.bounty;
  if (!b || e.mobType !== b.type || e.camp == null) return;
  b.have = Math.min(b.need, b.have + 1);
  if (b.have >= b.need && !b.done) { b.done = true; uiToast('Bounty complete. Return to the herald.', 'quest'); sfx('fanfare'); }
}

/* ------------------------------------------------------------------ */
/* per-frame player update                                             */
/* ------------------------------------------------------------------ */
let lastZone = '';
function updatePlayer(dt) {
  const P = GAME.player;
  if (!P) return;
  updateAnim(P, dt);
  if (!P.alive) return;
  tickBuffs(P, dt);
  if (!P.alive) return;
  // in the air on a leap strike: the leap carries you
  if (P.motion && updateMotion(P, dt)) { GAME.prog.played += dt; return; }
  const spin = spinning(P);
  // movement intent relative to the camera
  let f = 0, s = 0;
  if (!UI.modal) {
    if (keyDown('KeyW', 'ArrowUp')) f += 1;
    if (keyDown('KeyS', 'ArrowDown')) f -= 1;
    if (keyDown('KeyD', 'ArrowRight')) s += 1;
    if (keyDown('KeyA', 'ArrowLeft')) s -= 1;
    if (INPUT.joy) { f += -INPUT.joy.dy; s += INPUT.joy.dx; }
  }
  const mag = Math.min(1, Math.hypot(f, s));
  const fx = Math.sin(CAM.yaw), fz = Math.cos(CAM.yaw);
  const rx = -Math.cos(CAM.yaw), rz = Math.sin(CAM.yaw);
  const sprinting = (keyDown('ShiftLeft', 'ShiftRight') || (INPUT.joy && Math.hypot(INPUT.joy.dx, INPUT.joy.dy) > 0.97)) && P.endurance > 1 && mag > 0.1;
  if (mag > 0.08 && !isRooted(P)) {
    let mx = fx * f + rx * s, mz = fz * f + rz * s;
    const ml = Math.hypot(mx, mz) || 1;
    mx /= ml; mz /= ml;
    let sp = effectiveSpeed(P) * (PLAYER_SPEED / P.speed) * mag * (P.mount ? MOUNT_SPEED * (sprinting ? 1.22 : 1) : sprinting ? 1.45 : 1);
    if (P.casting) { P.casting = null; uiLog('Your casting is interrupted.', 'warn'); sfx('fizzle'); }
    const nx = P.x + mx * sp * dt, nz = P.z + mz * sp * dt;
    const ok = stepTo(P, nx, nz);
    if (!ok) stepTo(P, P.x + mx * sp * dt * 0.5, P.z);
    const want = Math.atan2(mx, mz);
    if (!spin) P.yaw += clamp(angDiff(P.yaw, want), -dt * (P.mount ? 5.5 : 12), dt * (P.mount ? 5.5 : 12));
    if (sprinting) P.endurance = Math.max(0, P.endurance - dt * (P.mount ? 6 : 11));
  } else {
    const t = getEnt(P.target);
    if (t && t !== P && (P.casting || (isEnemy(P, t) && dist(P.x, P.z, t.x, t.z) < 40))) turnToward(P, t.x, t.z, dt * 10);
  }
  if (!sprinting) P.endurance = Math.min(100, P.endurance + dt * (GAME.t > P.combatUntil ? 14 : 7));
  // jumping
  const gy = heightAt(P.x, P.z);
  if (keyDown('Space') && P.onGround && !UI.modal && !isRooted(P)) { P.vy = P.mount ? 7.0 : 6.2; P.onGround = false; }
  if (!P.onGround) {
    P.vy -= 18 * dt;
    P.y += P.vy * dt;
    if (P.y <= gy) { P.y = gy; P.onGround = true; P.vy = 0; FX.dust(P.x, gy, P.z, 4); }
  } else P.y = gy;
  // casting
  if (P.casting) {
    if (isStunned(P)) P.casting = null;
    else { P.casting.t += dt; if (P.casting.t >= P.casting.total) finishCast(P); }
  }
  autoAttack(P);
  // regeneration
  const resting = GAME.t > P.combatUntil + 3;
  P.power = Math.min(P.maxPower, P.power + P.maxPower * dt * (resting ? 0.09 : 0.025));
  if (resting) P.hp = Math.min(P.maxHp, P.hp + P.maxHp * dt * 0.05);
  // drop a target that is gone
  const t = getEnt(P.target);
  if (P.target != null && (!t || (!t.alive && t.kind !== 'door' && GAME.t - t.deadAt > 3) || dist(P.x, P.z, t.x, t.z) > 120)) P.target = null;
  // zone changes
  const z = zoneAt(P.x, P.z);
  if (z.name !== lastZone) { lastZone = z.name; uiZone(z); saveSoon(); }
  GAME.prog.played += dt;
}

/* ------------------------------------------------------------------ */
/* camera                                                              */
/* ------------------------------------------------------------------ */
function cameraShake(amount, x, z) {
  const P = GAME.player;
  const d = P ? dist(P.x, P.z, x, z) : 0;
  CAM.shake = Math.max(CAM.shake, amount * clamp(1 - d / 40, 0, 1));
}
const _look = new THREE.Vector3();
const _camColl = [];
function cameraRoom(px, py, pz, cp, sp, dist) {
  const sx = -Math.sin(CAM.yaw) * cp, sz = -Math.cos(CAM.yaw) * cp;
  collidersNear(px + sx * dist * 0.5, pz + sz * dist * 0.5, dist * 0.5 + 6, _camColl);
  if (!_camColl.length) return dist;
  for (let t = 0.8; t <= dist; t += 0.4) {
    const x = px + sx * t, z = pz + sz * t, y = py + sp * t;
    for (const c of _camColl) {
      if (!c.active || c.tag === 'tree' || c.tag === 'rock' || y > c.baseY + c.h + 0.3) continue;
      let hit;
      if (c.type === 'circle') hit = dist2(x, z, c.x, c.z) < (c.r + 0.35) ** 2;
      else { const dx = x - c.x, dz = z - c.z; hit = Math.abs(dx * c.cos - dz * c.sin) < c.hx + 0.35 && Math.abs(dx * c.sin + dz * c.cos) < c.hz + 0.35; }
      if (hit) return Math.max(1.4, t - 0.5);
    }
  }
  return dist;
}
function updateCamera(dt) {
  if (CAM.mode === 'fixed') return; // test and photo views place the camera themselves
  if (CAM.mode === 'title') {
    CAM.orbitT += dt * 0.035;
    const a = CAM.orbitT + 2.2;
    const T = W.heroTree;
    const r = 34;
    const cx = T.x + Math.sin(a) * r, cz = T.z + Math.cos(a) * r;
    const cy = Math.max(heightAt(cx, cz) + 2.2, T.y + 1.6);
    camera.position.set(cx, cy, cz);
    _look.set(T.x, T.y + 4.2, T.z);
    camera.lookAt(_look);
    return;
  }
  const P = GAME.player;
  CAM.dist = lerp(CAM.dist, CAM.targetDist, 1 - Math.exp(-dt * 8));
  CAM.ride = lerp(CAM.ride || 0, P.mount ? 1 : 0, 1 - Math.exp(-dt * 4));
  const fy = P.y + 1.55 * (P.scale || 1) + 0.85 * CAM.ride;
  CAM.focus.set(P.x, fy, P.z);
  const cp = Math.cos(CAM.pitch), sp = Math.sin(CAM.pitch);
  // walls, stones and houses between the player and the camera pull the camera in
  const room = cameraRoom(P.x, fy, P.z, cp, sp, CAM.dist + 1.6 * CAM.ride);
  CAM.near = room < (CAM.near ?? CAM.dist) ? room : lerp(CAM.near ?? CAM.dist, room, 1 - Math.exp(-dt * 2.5));
  const dd = Math.min(CAM.dist + 1.6 * CAM.ride, CAM.near, INDOOR.on ? 10 : 99);
  let cx = P.x - Math.sin(CAM.yaw) * cp * dd;
  let cz = P.z - Math.cos(CAM.yaw) * cp * dd;
  let cy = fy + sp * dd;
  const minY = heightAt(cx, cz) + 0.9;
  if (cy < minY) cy = minY;
  // under the barrow's roof the camera keeps below the stones
  if (INDOOR.on) {
    const roof = Math.min(dunCeilAt(cx, cz), dunCeilAt(P.x, P.z), dunCeilAt((cx + P.x) / 2, (cz + P.z) / 2)) - 0.5;
    if (cy > roof) cy = Math.max(roof, fy - 0.4);
  }
  // houses: the camera stays in the room the player is in, or outside if the player is
  const hc = houseCamera(P.x, fy, P.z, cx, cy, cz, dt);
  if (hc) { cx = hc.x; cy = hc.y; cz = hc.z; }
  CAM.pos.set(cx, cy, cz);
  camera.position.copy(CAM.pos);
  if (CAM.shake > 0) {
    camera.position.x += (Math.random() - 0.5) * CAM.shake;
    camera.position.y += (Math.random() - 0.5) * CAM.shake;
    CAM.shake = Math.max(0, CAM.shake - dt * 1.5);
  }
  _look.set(P.x, fy + 0.25, P.z);
  camera.lookAt(_look);
}

/* ------------------------------------------------------------------ */
/* death                                                               */
/* ------------------------------------------------------------------ */
function onPlayerDeath(killer) {
  const P = GAME.player;
  GAME.prog.deaths++;
  P.target = null;
  INPUT.keys.clear();
  sfx('death');
  flashScreen([0.6, 0.05, 0.05], 0.6);
  uiDeath(killer ? killer.name + (killer.faction <= 2 && killer.faction !== P.faction ? ` of ${REALMS[killer.faction].name}` : '') : 'the wilds');
}
function releasePlayer() {
  const P = GAME.player;
  const R = REALMS[P.faction];
  if (inDungeon(P)) {
    P.alive = true; P.hp = P.maxHp; P.power = P.maxPower; P.endurance = 100;
    P.buffs.length = 0; P.casting = null; P.threat = null; P.damagers = null; P.mount = null; P.removeAt = 0;
    leaveBarrow(true);
    return;
  }
  const inFrontier = Math.hypot(P.x, P.z) < R_RING;
  const S = inFrontier ? R.musterSite : R.town;
  const p = siteWorld(S, (Math.random() - 0.5) * 4, 0, 9);
  P.x = p.x; P.z = p.z; P.prevX = p.x; P.prevZ = p.z; P.y = heightAt(p.x, p.z);
  P.alive = true; P.hp = P.maxHp; P.power = P.maxPower; P.endurance = 100;
  P.buffs.length = 0; P.casting = null; P.threat = null; P.damagers = null; P.mount = null;
  P.removeAt = 0;
  P.yaw = S.yaw + (inFrontier ? 0 : Math.PI);
  CAM.yaw = P.yaw;
  FX.burst(P.x, P.y + 1, P.z, 40, [0.5, 1.4, 1.8], 3, 0.8, 0.2, -1);
  sfx('portal');
  saveSoon();
}
