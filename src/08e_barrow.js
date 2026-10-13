/* ================================================================== */
/* the Barrow's dead: packs, the burning gallery, chests, the king      */
/* ================================================================== */
const BARROW_STATE = { kingDead: false, kingAt: 0, wardenDead: false, wardenAt: 0, king: null, warden: null, packs: [], flowAt: -9, flowCell: -1, entered: 0, intro: false, adds: new Set(), lastIn: -999 };
const FLOW = { dist: null, queue: null };
// who sleeps where: [mob type, level, u, v]
const BARROW_PACKS = [
  { room: 'bones', mobs: [['skeleton', 15, 24, 1.2], ['skeleton', 15, 33, -1.2]], wander: 3 },
  { room: 'ossuary', mobs: [['skeleton', 16, 50, -2], ['skeleton', 16, 52, 2.5], ['skeleton', 16, 55, -1], ['wisp', 16, 58, 6]], wander: 2 },
  { room: 'crypt', mobs: [['draugr', 17, 48, 21], ['draugr', 17, 56, 21]], wander: 2 },
  { room: 'pillars', mobs: [['draugr', 17, 76, -3], ['draugr', 17, 78, 2], ['skeleton', 18, 84, 0], ['wisp', 17, 90, -9], ['wisp', 17, 90, 9], ['draugr', 18, 94, 1]], wander: 3 },
  { room: 'well', mobs: [['skeleton', 18, 140, -6], ['skeleton', 18, 140, 6]], wander: 1.5 },
];
const BARROW_NAMES = { skeleton: ['barrow bones', 'barrow bones', 'barrow wight', 'grave guard'], draugr: ['barrow draugr', 'barrow draugr', 'draugr huscarl', 'draugr huscarl'], wisp: ['corpse light', 'corpse light', 'corpse light', 'corpse light'] };
const BARROW_RESPAWN = 360, WARDEN_RESPAWN = 600, KING_RESPAWN = 720;
// the gallery's fire, for the record of who killed whom
const VENT_SRC = { id: -77, name: 'the fires of the Burning Gallery', faction: FACTION_MONSTER, role: 'trap', level: 18, buffs: [], alive: false, scale: 1, x: 0, z: 0, y: 0 };

function barrowLook(type, lvl, o = {}) {
  const M = MOBS[type];
  if (M.kind !== 'humanoid') return M.colA ? { colA: M.colA.slice(), colB: M.colB.slice() } : { colA: [0.6, 1.6, 1.4], colB: [0.3, 0.8, 0.7] };
  const sc = o.scale || lerp(M.scale[0], M.scale[1], (lvl - 1) / 19);
  return { tabard: M.tabard.map((v) => v * (0.8 + Math.random() * 0.4)), armor: M.armor.slice(), skin: Math.random() * 0.6, hair: Math.random(), mask: M.mask, flags: M.flags || 0, scale: sc, outfit: M.outfit, emblem: 3, fem: 0, bulk: M.bulk || 0 };
}
function spawnBarrowMob(type, lvl, u, v, pack, extra = {}) {
  const M = MOBS[type];
  const p = dunPoint(u, v);
  const look = barrowLook(type, lvl, extra);
  const name = extra.name || (BARROW_NAMES[type] || M.names)[clamp(lvl - 15, 0, 3)];
  // the dead grow stronger as the living do: the barrow keeps pace past level 20
  const e = makeEnt({
    kind: M.kind, faction: FACTION_MONSTER, role: 'mob', mobType: type, level: lvl + barrowBoost(), baseLevel: lvl, name, x: p.x, z: p.z, y: p.y, yaw: Math.random() * TAU,
    scale: extra.scale || look.scale || 1, radius: M.radius, home: { x: p.x, z: p.z, r: pack ? pack.wander || 2 : 2 }, look, hover: M.kind === 'wisp' ? 1.6 : 0,
    dunPack: pack ? pack.idx : -1, camp: null,
  });
  if (extra.hp || extra.dmg) e.tweak = { hp: extra.hp || 0, dmg: extra.dmg || 0 };
  setupStats(e);
  if (extra.elite) e.elite = true;
  return e;
}
function initBarrow() {
  BARROW_PACKS.forEach((pk, i) => { pk.idx = i; pk.members = new Set(); pk.respawn = []; for (const m of pk.mobs) pk.members.add(spawnBarrowMob(m[0], m[1], m[2], m[3], pk).id); });
  spawnWarden();
  spawnKing();
  // chests: one in the side crypt, the king's hoard in the vault
  DUN.chests.length = 0;
  for (const [id, spot, yaw, label] of [['crypt', DUN.spots.cryptChest, 0, 'Open the burial chest'], ['vault', DUN.spots.vaultChest, -Math.PI / 2, "Open the Hollow King's hoard"]]) {
    const ch = { id, x: spot.x, z: spot.z, y: spot.y, yaw, label, ready: id === 'crypt', opened: false, lid: 0, refillAt: 0 };
    buildChestMesh(ch);
    DUN.chests.push(ch);
    addBox(ch.x, ch.z, 0.75, 0.5, yaw, 'prop', 1.0);
  }
}
function buildChestMesh(ch) {
  const b = new Batch(), lidB = new Batch(), M0 = new THREE.Matrix4();
  const wood = ch.id === 'vault' ? [0.3, 0.17, 0.1] : [0.34, 0.24, 0.14], band = ch.id === 'vault' ? [0.85, 0.66, 0.3] : [0.24, 0.23, 0.24];
  const bandMat = ch.id === 'vault' ? MAT.gold : MAT.metal;
  b.add(G.box, lm(M0, 0, 0.3, 0, 0, 1.3, 0.6, 0.8), MAT.wood, wood, 0, 0.8);
  for (const x of [-0.5, 0.5]) b.add(G.box, lm(M0, x, 0.3, 0, 0, 0.08, 0.62, 0.84), bandMat, band);
  b.add(G.box, lm(M0, 0, 0.52, 0.41, 0, 0.18, 0.2, 0.04), bandMat, band);
  // the lid pivots on its back edge (local z = -0.4)
  lidB.add(G.box, lm(M0, 0, 0.1, 0.4, 0, 1.34, 0.2, 0.84), MAT.wood, darker(wood, 1.1));
  lidB.add(G.cyl12, lm(M0, 0, 0.2, 0.4, 0, 0.42, 1.34, 0.18, 0, Math.PI / 2), MAT.wood, darker(wood, 1.05));
  for (const x of [-0.5, 0.5]) lidB.add(G.box, lm(M0, x, 0.16, 0.4, 0, 0.08, 0.34, 0.86), bandMat, band);
  // a gleam of coin inside, seen once the lid is up
  b.add(G.box, lm(M0, 0, 0.56, 0, 0, 1.15, 0.04, 0.66), MAT.gold, [0.95, 0.74, 0.3]);
  const body = new THREE.Mesh(b.build(), buildingMat);
  body.position.set(ch.x, ch.y, ch.z);
  body.rotation.y = ch.yaw;
  const lid = new THREE.Mesh(lidB.build(), buildingMat);
  lid.position.set(0, 0.6, -0.4);
  body.add(lid);
  DUN.root.add(body);
  ch.mesh = body; ch.lidMesh = lid;
}
function spawnWarden() {
  const p = { u: 150, v: 0 };
  const e = spawnBarrowMob('skeleton', 19, p.u, p.v, null, { name: 'Barrow Warden', scale: 1.32, hp: 3.6, dmg: 1.25, elite: true });
  e.look.mask = WB.sword | WB.shieldRound | WB.belt | WB.helmet | WB.cape | WB.pauldron;
  e.look.armor = [0.38, 0.34, 0.28];
  e.look.flags = 1 | (2 << 4) | (1 << 7);
  e.home.r = 1.5;
  BARROW_STATE.warden = e.id;
  BARROW_STATE.wardenDead = false;
  setGate(DUN.gates.well, false);
}
function spawnKing() {
  const sp = DUN.spots.seat;
  const e = makeEnt({
    kind: 'humanoid', faction: FACTION_MONSTER, role: 'dungeonBoss', mobType: 'skeleton', level: 21 + barrowBoost(), baseLevel: 21, name: 'The Hollow King', tweak: { speed: 6.0, swing: 2.5, meleeRange: 3.0 },
    x: sp.x, z: sp.z, y: -6.2, yaw: -Math.PI / 2, scale: 1.62, radius: 0.5,
    look: { tabard: [0.13, 0.1, 0.16], armor: [0.6, 0.46, 0.24], skin: 0.2, hair: 0.3, mask: WB.sword | WB.cape | WB.circlet | WB.pauldron | WB.tabard | WB.belt | WB.skirt, flags: 1 | (2 << 4) | (3 << 7), scale: 1.62, outfit: OUTFIT.skeleton, emblem: 3, fem: 0, bulk: -0.6 },
    home: { x: sp.x, z: sp.z, r: 1 }, camp: null,
  });
  setupStats(e);
  e.ai.awake = false;
  e.seat = { y: sp.y }; e.fixedY = -6.2;
  for (const t of DUN.tombs) t.target = 0;
  BARROW_STATE.king = e.id;
  BARROW_STATE.kingDead = false;
  BARROW_STATE.intro = false;
  setGate(DUN.gates.vault, false);
  const ch = DUN.chests.find((c) => c.id === 'vault');
  if (ch) { ch.ready = false; ch.opened = false; }
}

/* ---- a flow field over the floor grid: every cell knows the way to the player ---- */
function updateFlow() {
  const P = GAME.player;
  if (!P || !P.alive || !inDungeon(P)) return;
  const k0 = dunCellAt(P.x, P.z);
  if (k0 < 0 || (k0 === BARROW_STATE.flowCell && GAME.t - BARROW_STATE.flowAt < 3) || GAME.t - BARROW_STATE.flowAt < 0.3) return;
  BARROW_STATE.flowCell = k0; BARROW_STATE.flowAt = GAME.t;
  const N = DUN.GW * DUN.GH, GW = DUN.GW;
  if (!FLOW.dist) { FLOW.dist = new Float32Array(N); FLOW.queue = new Int32Array(N * 4); }
  const D = FLOW.dist, Q = FLOW.queue, C = DUN.cell;
  D.fill(1e9);
  let head = 0, tail = 0;
  D[k0] = 0; Q[tail++] = k0;
  while (head < tail) {
    const k = Q[head++], i = k % GW, j = (k / GW) | 0, d = D[k];
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      if (!di && !dj) continue;
      const q = dunIdx(i + di, j + dj);
      if (q < 0 || !dunOpen(C[q])) continue;
      // no cutting across a corner of rock
      if (di && dj && (!dunOpen(C[dunIdx(i + di, j)]) || !dunOpen(C[dunIdx(i, j + dj)]))) continue;
      const nd = d + (di && dj ? 1.414 : 1);
      if (nd < D[q] && tail < Q.length) { D[q] = nd; Q[tail++] = q; }
    }
  }
}
function flowWaypoint(e) {
  if (!FLOW.dist) return null;
  const GW = DUN.GW, k = dunCellAt(e.x, e.z);
  if (k < 0) return null;
  const i = k % GW, j = (k / GW) | 0;
  let best = k, bd = FLOW.dist[k];
  for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
    const q = dunIdx(i + di, j + dj);
    if (q < 0 || !dunOpen(DUN.cell[q])) continue;
    if (di && dj && (!dunOpen(DUN.cell[dunIdx(i + di, j)]) || !dunOpen(DUN.cell[dunIdx(i, j + dj)]))) continue;
    if (FLOW.dist[q] < bd) { bd = FLOW.dist[q]; best = q; }
  }
  if (bd >= 1e8) return null;
  // aim two steps ahead for a smoother line
  const bi = best % GW, bj = (best / GW) | 0;
  return { x: dunWX(bi + DUN.u0 + 0.5), z: dunWZ(bj + DUN.v0 + 0.5) };
}

/* ---- the barrow's dead: they wake when they see you, and call the rest of their pack ---- */
function packAggro(e, t) {
  const pk = BARROW_PACKS[e.dunPack];
  if (!pk) return;
  for (const id of pk.members) {
    const o = getEnt(id);
    if (!o || o === e || !o.alive || dist2(o.x, o.z, e.x, e.z) > 15 * 15) continue;
    o.threat = o.threat || new Map();
    if (!o.threat.has(t.id)) o.threat.set(t.id, 0.5);
  }
}
function thinkBarrowMob(e, dt) {
  const ai = e.ai, P = GAME.player;
  if (e.rise || GAME.t < (ai.riseUntil || 0)) return;
  let t = getEnt(e.target);
  if (t && (!t.alive || !isEnemy(e, t) || !inDungeon(t))) { t = null; e.target = null; }
  const top = topThreat(e);
  if (top && inDungeon(top)) t = top;
  if (!t && P && P.alive && inDungeon(P) && GAME.t > (ai.nextAggro || 0)) {
    ai.nextAggro = GAME.t + 0.4;
    const reach = (MOBS[e.mobType].aggro || 10) + (e.elite ? 5 : 0);
    if (dist2(e.x, e.z, P.x, P.z) < reach * reach && Math.abs(P.y - e.y) < 4 && segmentClear(e.x, e.z, P.x, P.z, 0.3)) {
      t = P;
      e.threat = e.threat || new Map();
      e.threat.set(P.id, 1);
      packAggro(e, P);
      if (e.elite && !ai.taunted) { ai.taunted = true; uiFloatAt(e.x, e.y + 2.8 * (e.scale || 1), e.z, 'None pass the Well', 'immune'); sfxAtE('roarSmall', e, null, 2); /* [audio2] placed */ }
    }
  }
  if (t) {
    ai.lostAt = 0;
    if (dist(e.x, e.z, t.x, t.z) > 3.5 && !segmentClear(e.x, e.z, t.x, t.z, 0.4)) {
      const wp = flowWaypoint(e);
      if (wp) { e.target = t.id; moveToward(e, wp.x, wp.z, dt, 1, 0.05); return; }
    }
    fightTarget(e, t, dt);
    return;
  }
  e.threat = null; e.target = null;
  if (e.hp < e.maxHp && GAME.t > e.combatUntil + 2) e.hp = Math.min(e.maxHp, e.hp + e.maxHp * dt * 0.12);
  const dh = dist(e.x, e.z, e.home.x, e.home.z);
  if (dh > e.home.r + 1.5) {
    // the dead do not walk home: they fade and gather again by their tombs
    if (!ai.lostAt) ai.lostAt = GAME.t;
    if (GAME.t - ai.lostAt > 3.5 || !segmentClear(e.x, e.z, e.home.x, e.home.z, 0.4)) {
      if (GAME.t - ai.lostAt > 2.5) {
        FX.burst(e.x, e.y + 1, e.z, 16, [0.4, 1.0, 1.1], 1.4, 0.8, 0.14, -1);
        e.x = e.prevX = e.home.x; e.z = e.prevZ = e.home.z; e.hp = e.maxHp; ai.lostAt = 0;
        FX.burst(e.x, e.y + 1, e.z, 16, [0.4, 1.0, 1.1], 1.4, 0.8, 0.14, -1);
      }
    } else moveToward(e, e.home.x, e.home.z, dt, 0.7, 0.4);
    return;
  }
  if (!ai.wander || GAME.t > ai.wanderUntil) {
    const a = Math.random() * TAU, r = Math.random() * e.home.r;
    ai.wander = { x: e.home.x + Math.cos(a) * r, z: e.home.z + Math.sin(a) * r };
    ai.wanderUntil = GAME.t + 5 + Math.random() * 9;
  }
  moveToward(e, ai.wander.x, ai.wander.z, dt, 0.25, 0.5);
}
function onBarrowMobDeath(e) {
  const S = BARROW_STATE;
  if (e.id === S.warden) {
    S.wardenDead = true; S.wardenAt = GAME.t + WARDEN_RESPAWN;
    later(1.2, () => { setGate(DUN.gates.well, true); uiBanner('The gate beyond the Well grinds open.', -1); });
    sfx('chain');
    return;
  }
  if (S.adds.has(e.id)) { S.adds.delete(e.id); return; }
  const pk = BARROW_PACKS[e.dunPack];
  if (!pk) return;
  pk.members.delete(e.id);
  const m = pk.mobs.find((x) => x[0] === e.mobType) || pk.mobs[0];
  pk.respawn.push({ at: GAME.t + BARROW_RESPAWN, spec: [e.mobType, m[1], dunU(e.home.x), dunV(e.home.z)] });
}

/* ---- the Burning Gallery: grates that breathe fire in a wave ---- */
const VENT_PERIOD = 4.4;
function ventState(V) { return ((GAME.t / VENT_PERIOD + V.k * 0.16) % 1 + 1) % 1; }
function updateVents(dt) {
  const P = GAME.player;
  if (!P || !inDungeon(P) || Math.abs(dunU(P.x) - 116) > 60) return;
  DUN.vents.forEach((V, i) => {
    V.k = i;
    const s = ventState(V);
    const warn = s > 0.52 && s < 0.68, burn = s >= 0.68 && s < 0.93;
    if (warn && Math.random() < dt * 30) fxAdd.emit(V.x + (Math.random() - 0.5) * 1.4, V.y + 0.1, V.z + (Math.random() - 0.5) * 1.4, 0, 0.6 + Math.random(), 0, 0.5, 2.0, 0.8, 0.25, 0.08, -1, 0.5);
    if (burn) {
      if (!V.burning) { V.burning = true; sfxAt('ventRoar', V.x, V.y + 1, V.z); } // [audio2] placed (11c_sound.js)
      for (let n = 0; n < 5; n++) {
        const a = Math.random() * TAU, r = Math.random() * 0.6;
        fxAdd.emit(V.x + Math.cos(a) * r, V.y + 0.1, V.z + Math.sin(a) * r, (Math.random() - 0.5) * 0.6, 4.5 + Math.random() * 2.5, (Math.random() - 0.5) * 0.6, 0.55 + Math.random() * 0.25, 2.4, 1.0, 0.3, 0.32 + Math.random() * 0.25, -1.5, 0.4);
      }
      if (Math.random() < dt * 8) lightFlash(V.x, V.y + 1.6, V.z, 9, [3.0, 1.3, 0.4], 0.3);
      V.tick = (V.tick || 0) - dt;
      if (V.tick <= 0) {
        V.tick = 0.3;
        forNear(V.x, V.z, 1.5, (o) => {
          if (!o.alive || o.kind === 'door' || o.flying) return;
          if (Math.abs(o.y - V.y) > 2.5) return;
          dealDamage(VENT_SRC, o, o.maxHp * 0.075, { kind: 'fire', trap: true });
          if (o === P && P.alive) FX.burst(P.x, P.y + 1, P.z, 8, [2.4, 1.0, 0.3], 2, 0.4, 0.12, -1);
        });
      }
    } else V.burning = false;
  });
}

/* ---- chests ---- */
function openChest(ch) {
  const P = GAME.player;
  if (!ch.ready || ch.opened || !P) return;
  const near = ENT.some((o) => o.alive && o.faction === FACTION_MONSTER && inDungeon(o) && dist2(o.x, o.z, ch.x, ch.z) < 12 * 12 && o.threat && o.threat.has(P.id));
  if (near) { uiError('Not while the dead are on you'); return; }
  ch.opened = true;
  ch.refillAt = GAME.t + (ch.id === 'vault' ? KING_RESPAWN : BARROW_RESPAWN * 2);
  sfx('chestOpen');
  const lvl = clamp(GAME.prog.level + (ch.id === 'vault' ? 2 : 0), 15, 22 + barrowBoost()); // [balance2] the hoard a little above you, to item level 50
  later(0.45, () => {
    const n = ch.id === 'vault' ? 3 : 1 + (Math.random() < 0.5 ? 1 : 0);
    for (let i = 0; i < n; i++) {
      const w = ch.id === 'vault' ? (i === 0 ? [0, 0, 0, 0, 90, 10] : DROP_WEIGHTS.boss) : DROP_WEIGHTS.chest;
      dropItem(makeItem({ cls: P.cls, realm: P.faction, lvl, q: rollQuality(w) }), ch.x, ch.z, ch.y + 0.9);
    }
    addGold(ch.id === 'vault' ? 320 + Math.random() * 220 : 60 + Math.random() * 70, ch.x, ch.y + 1.5, ch.z);
    FX.burst(ch.x, ch.y + 0.8, ch.z, 30, [2.2, 1.7, 0.7], 2.2, 0.8, 0.12, 2);
    lightFlash(ch.x, ch.y + 1.2, ch.z, 7, [2.6, 2.0, 0.9], 0.8);
  });
  saveSoon();
}
function updateChests(dt) {
  for (const ch of DUN.chests) {
    const want = ch.opened ? 1 : 0;
    if (ch.lid !== want) {
      ch.lid = clamp(ch.lid + Math.sign(want - ch.lid) * dt * 1.6, 0, 1);
      if (ch.lidMesh) ch.lidMesh.rotation.x = -smooth(ch.lid) * 1.75;
    }
    if (ch.opened && GAME.t > ch.refillAt && ch.id === 'crypt' && !(GAME.player && inDungeon(GAME.player) && dist2(GAME.player.x, GAME.player.z, ch.x, ch.z) < 30 * 30)) { ch.opened = false; }
    // a glint over a chest that has not been opened
    if (INDOOR.on && ch.ready && !ch.opened && Math.random() < dt * 4) FX.trail(ch.x + (Math.random() - 0.5) * 1.1, ch.y + 0.7 + Math.random() * 0.2, ch.z + (Math.random() - 0.5) * 0.7, [1.8, 1.4, 0.6], 0.07, 0.9);
  }
}

/* ---- the Hollow King ---- */
function wakeKing(e) {
  e.ai.awake = true;
  if (e.seat) {
    const T = DUN.spots.throne;
    e.seat = null;
    e.ai.stepOff = { t0: GAME.t, x0: e.x, z0: e.z, x1: T.x + 1.2, z1: T.z };
    FX.dust(e.x, -6.2, e.z, 14, [0.4, 0.38, 0.34]);
  }
  e.ai.nextCleave = GAME.t + 3; e.ai.nextChill = GAME.t + 8; e.ai.nextLance = GAME.t + 6;
  sfxAtE('kingRoar', e, null, 2.5); /* [audio2] placed */
  cameraShake(0.25, e.x, e.z);
  uiBanner('The Hollow King rises from his throne.', -1);
  setAct(e, 5, 1.4);
  for (let i = 0; i < 40; i++) FX.trail(e.x + (Math.random() - 0.5) * 2, e.y + Math.random() * 3.4, e.z + (Math.random() - 0.5) * 2, [0.5, 1.3, 1.5], 0.16, 1.2);
}
function flareHall(on) {
  if (BARROW_STATE.flared === on) return;
  BARROW_STATE.flared = on;
  for (const f of FIRES) if (inDungeonX(f.x) && dunU(f.x) > 166) f.size *= on ? 1.35 : 1 / 1.35;
}
function resetKing(e) {
  flareHall(false);
  for (const id of BARROW_STATE.adds) { const o = getEnt(id); if (o) removeEnt(o); }
  BARROW_STATE.adds.clear();
  e.yaw = -Math.PI / 2;
  e.hp = e.maxHp; e.threat = null; e.damagers = null; e.target = null; e.casting = null; e.buffs.length = 0;
  e.speed = 6.0; e.swing = 2.5;
  e.ai = { think: 0, awake: false };
  const seat = DUN.spots.seat;
  e.x = e.prevX = seat.x; e.z = e.prevZ = seat.z; e.seat = { y: seat.y }; e.fixedY = -6.2;
  for (const t of DUN.tombs) t.target = 0;
}
function raiseDead(e, n) {
  const closed = DUN.tombs.filter((t) => t.target === 0).sort((a, b) => dist2(a.x, a.z, e.x, e.z) - dist2(b.x, b.z, e.x, e.z));
  const tombs = closed.length >= n ? closed.slice(0, n) : closed.concat(DUN.tombs.filter((t) => t.target === 1)).slice(0, n);
  uiBanner('"Rise, my wardens."', -1);
  sfxAtE('raise', e, null, 2); // [audio2] placed (11c_sound.js)
  tombs.forEach((T, i) => {
    later(i * 0.45, () => { if (e.alive) { T.target = 1; sfxAt('grind', T.x, null, T.z); } }); // [audio2] placed (11c_sound.js)
    later(0.75 + i * 0.45, () => {
      if (!e.alive) return;
      const o = spawnBarrowMob('skeleton', 18, dunU(T.x), dunV(T.z), null, { name: 'risen bones', hp: 0.55 });
      o.dunPack = -2;
      // up out of the tomb, then a hop down onto the floor toward the hall
      const side = dunV(T.z) > 0 ? -1 : 1;
      o.rise = { t0: GAME.t, y: T.y, x0: T.x, z0: T.z, x1: T.x, z1: T.z + side * 1.55 };
      o.fixedY = T.y - 1.0;
      o.yaw = side > 0 ? 0 : Math.PI;
      o.ai.riseUntil = GAME.t + 1.25;
      setAct(o, 13, 1.0, 0.22); // [motion] crouched in the tomb, it straightens as it comes up over the rim
      BARROW_STATE.adds.add(o.id);
      const P = GAME.player;
      if (P) o.threat = new Map([[P.id, 1]]);
      FX.burst(T.x, T.y + 1.0, T.z, 28, [0.45, 1.2, 1.3], 2.4, 0.9, 0.16, -0.5);
      FX.dust(T.x, T.y + 0.9, T.z, 10, [0.4, 0.38, 0.34]);
      lightFlash(T.x, T.y + 1.4, T.z, 6, [0.6, 1.6, 1.8], 0.6);
    });
  });
}
// tomb lids slide, the risen climb out, the king steps down from his throne
function updateBarrowMotion(dt) {
  for (const T of DUN.tombs) {
    if (T.open === T.target) continue;
    T.open = clamp(T.open + Math.sign(T.target - T.open) * dt / 0.9, 0, 1);
    const k = smooth(T.open), side = dunV(T.z) > 0 ? 1 : -1, d = 0.82 * k * side;
    T.lid.position.set(T.x + Math.cos(T.yaw) * d, T.y + 0.06 * Math.sin(k * Math.PI), T.z - Math.sin(T.yaw) * d);
    T.lid.rotation.y = T.yaw + 0.3 * k * side;
  }
  for (const id of BARROW_STATE.adds) {
    const o = getEnt(id);
    if (!o || !o.rise) continue;
    const R = o.rise, t = GAME.t - R.t0;
    if (t < 0.8) o.fixedY = lerp(R.y - 1.0, R.y + 0.45, smooth(t / 0.8));
    else if (t < 1.15) {
      if (!R.hop) { R.hop = true; setAct(o, 6, 0.36); } // [motion] the hop down: knees drawn up in the air
      const k = smooth((t - 0.8) / 0.35);
      o.x = o.prevX = lerp(R.x0, R.x1, k); o.z = o.prevZ = lerp(R.z0, R.z1, k);
      o.fixedY = lerp(R.y + 0.45, R.y, k) + Math.sin(k * Math.PI) * 0.35;
    } else { o.fixedY = null; o.rise = null; FX.dust(o.x, o.y, o.z, 6, [0.4, 0.38, 0.34]); }
  }
  const K = getEnt(BARROW_STATE.king);
  if (K && K.ai.stepOff) {
    const S = K.ai.stepOff, k = clamp((GAME.t - S.t0) / 0.9, 0, 1);
    K.x = lerp(S.x0, S.x1, smooth(k)); K.z = lerp(S.z0, S.z1, smooth(k)); // [motion] he walks down (his legs step as he moves)
    K.fixedY = -6.2 + Math.sin(k * Math.PI) * 0.12;
    if (k >= 1) { K.ai.stepOff = null; K.fixedY = null; }
  }
}
function kingCast(e, id, total) { e.casting = { id, custom: true, t: 0, total, targetId: e.target }; }
function thinkHollowKing(e, dt) {
  const ai = e.ai, P = GAME.player, S = BARROW_STATE;
  // a cold light about him, brighter as he weakens
  if (INDOOR.on && Math.random() < dt * (ai.enraged ? 30 : 12)) FX.trail(e.x + (Math.random() - 0.5) * 1.2, e.y + 0.5 + Math.random() * 2.6, e.z + (Math.random() - 0.5) * 1.2, ai.enraged ? [0.6, 1.4, 2.4] : [0.4, 1.1, 1.3], 0.12, 1.0);
  if (ai.stepOff) return;
  if (!ai.awake) {
    e.hp = e.maxHp;
    if (P && P.alive && inDungeon(P) && dunU(P.x) > 169 && dist(P.x, P.z, e.x, e.z) < 26) wakeKing(e);
    else if (e.threat && e.threat.size) wakeKing(e);
    return;
  }
  let t = topThreat(e);
  if (!t && P && P.alive && inDungeon(P)) t = P;
  if (!t || !t.alive || !inDungeon(t) || dunU(t.x) < 154) { if (GAME.t > (ai.giveUpAt || 0)) { if (!ai.giveUpAt) { ai.giveUpAt = GAME.t + 4; return; } resetKing(e); } return; }
  ai.giveUpAt = 0;
  e.target = t.id;
  const hpF = e.hp / e.maxHp;
  for (const th of [0.85, 0.6, 0.35]) if (hpF < th && !ai['sum' + th]) { ai['sum' + th] = true; raiseDead(e, th < 0.5 ? 3 : 2); }
  if (hpF < 0.25 && !ai.enraged) {
    ai.enraged = true; e.speed = 7.4; e.swing = 1.9;
    uiBanner('The Hollow King burns with a cold fury!', -1);
    sfxAtE('kingRoar', e, null, 2.5); /* [audio2] placed */
    flareHall(true);
  }
  // a spell in hand: hold still and let it build
  if (e.casting && e.casting.custom) {
    const c = e.casting;
    c.t += dt;
    if (c.id === 'chill') {
      if (Math.random() < dt * 40) { const a = Math.random() * TAU, r = 1 + Math.random() * 6; fxAdd.emit(e.x + Math.cos(a) * r, e.y + 0.2, e.z + Math.sin(a) * r, -Math.cos(a) * 1.5, 0.8, -Math.sin(a) * 1.5, 0.6, 0.6, 1.4, 2.2, 0.14, 0, 1); }
      if (c.t >= c.total) {
        e.casting = null;
        FX.ring(e.x, e.y + 0.4, e.z, 7, [0.6, 1.4, 2.4], 70, 10);
        FX.burst(e.x, e.y + 1.2, e.z, 50, [0.7, 1.5, 2.4], 6, 0.7, 0.18, 1);
        lightFlash(e.x, e.y + 1.5, e.z, 14, [1.2, 2.2, 3.2], 0.7);
        cameraShake(0.3, e.x, e.z);
        sfxAtE('frost', e); sfxAtE('boom', e); /* [audio2] placed */
        forNear(e.x, e.z, 7.2, (o) => {
          if (!o.alive || !isEnemy(e, o) || !isActor(o)) return;
          const r = computeDamage(e, o, 1.0);
          dealDamage(e, o, r.d, { crit: r.crit, kind: 'frost' });
          addBuff(o, 'snare', 0.5, 4, e.id);
        });
        ai.nextChill = GAME.t + (ai.enraged ? 11 : 16);
      }
    } else if (c.id === 'cleave') {
      turnToward(e, t.x, t.z, dt * 3);
      if (!c.hit && c.t >= 0.62) {
        c.hit = true;
        spawnSlash(e, true);
        sfxAtE('swing', e, { vol: 1.4 }, 1.6); /* [audio2] placed */ cameraShake(0.22, e.x, e.z);
        forNear(e.x, e.z, 5.6, (o) => {
          if (!o.alive || !isEnemy(e, o) || !isActor(o)) return;
          if (Math.abs(angDiff(e.yaw, Math.atan2(o.x - e.x, o.z - e.z))) > 1.15) return;
          const r = computeDamage(e, o, 1.55);
          dealDamage(e, o, r.d, { crit: r.crit, kind: 'melee' });
          FX.sparks(o.x, o.y + 1.1, o.z);
        });
      }
      if (c.t >= c.total) { e.casting = null; ai.nextCleave = GAME.t + (ai.enraged ? 5 : 7.5); e.swingAt = GAME.t + 1.2; }
    } else e.casting = null;
    return;
  }
  const d = dist(e.x, e.z, t.x, t.z);
  if (GAME.t > ai.nextChill && d < 7.5) { kingCast(e, 'chill', 1.4); aoeMarker(e.x, e.z, 7, 1.4); sfxAtE('cast', e, null, 2); /* [audio2] placed */ return; }
  if (GAME.t > ai.nextCleave && d < 4.6) {
    kingCast(e, 'cleave', 1.05);
    setAct(e, 8, 1.0);
    const fx = e.x + Math.sin(e.yaw) * 3, fz = e.z + Math.cos(e.yaw) * 3;
    aoeMarker(fx, fz, 2.8, 0.75);
    return;
  }
  // soul lances: three circles round the target; spears of ghost-light burst up from them
  if (hpF < 0.62 && GAME.t > ai.nextLance) {
    ai.nextLance = GAME.t + (ai.enraged ? 4.5 : 6.5);
    const pts = [[t.x, t.z]];
    for (let i = 0; i < 2; i++) { const a = Math.random() * TAU, r = 2.6 + Math.random() * 2.2; pts.push([t.x + Math.cos(a) * r, t.z + Math.sin(a) * r]); }
    for (const [x, z] of pts) {
      if (!isWalkable(x, z)) continue;
      aoeMarker(x, z, 2.2, 1.45);
      for (let n = 0; n < 6; n++) { const a = Math.random() * TAU; FX.trail(x + Math.cos(a) * 2, heightAt(x, z) + 0.1, z + Math.sin(a) * 2, [0.5, 1.3, 1.6], 0.12, 1.2); }
      later(1.4, () => {
        if (!e.alive) return;
        const y = heightAt(x, z);
        for (let n = 0; n < 22; n++) fxAdd.emit(x + (Math.random() - 0.5) * 1.6, y + 0.1, z + (Math.random() - 0.5) * 1.6, 0, 6 + Math.random() * 5, 0, 0.45, 0.6, 1.6, 2.2, 0.22, 0, 0.5);
        lightFlash(x, y + 2, z, 8, [0.8, 1.9, 2.6], 0.5);
        sfxAtE('lance', e, null, 2); /* [audio2] placed */
        forNear(x, z, 2.3, (o) => {
          if (!o.alive || !isEnemy(e, o) || !isActor(o)) return;
          const r = computeDamage(e, o, 1.25);
          dealDamage(e, o, r.d, { crit: r.crit, kind: 'holy' });
        });
      });
    }
  }
  fightTarget(e, t, dt);
}
function onKingDeath(e, killer) {
  const S = BARROW_STATE;
  S.kingDead = true; S.kingAt = GAME.t + KING_RESPAWN;
  for (const id of S.adds) { const o = getEnt(id); if (o && o.alive) killEnt(o, null); }
  S.adds.clear();
  sfxAtE('kingDeath', e, null, 2); /* [audio2] placed */
  cameraShake(0.45, e.x, e.z);
  flashScreen([0.6, 0.9, 1.0], 0.35);
  FX.burst(e.x, e.y + 1.6, e.z, 90, [0.6, 1.4, 1.8], 5, 1.4, 0.2, -0.5);
  lightFlash(e.x, e.y + 2, e.z, 18, [1.4, 2.4, 3.0], 1.6);
  flareHall(false);
  later(2.0, () => {
    setGate(DUN.gates.vault, true);
    const ch = DUN.chests.find((c) => c.id === 'vault');
    if (ch) { ch.ready = true; ch.opened = false; }
    uiBanner('The Hollow King is dust. The door to his vault grinds open.', -1);
  });
  GAME.prog.kingKills = (GAME.prog.kingKills || 0) + 1;
}

/* ---- the barrow's clock: respawns, the gallery, the light, the air ---- */
function onEnterBarrow() {
  BARROW_STATE.lastIn = GAME.t;
  BARROW_STATE.flowAt = -9;
  if (!BARROW_STATE.entered) {
    setTimeout(() => uiToast('Cold air breathes up from below. The barrow’s king waits at its far end.', 'hint'), 1600);
  }
  BARROW_STATE.entered++;
  uiLog('You descend into the Hollow Barrow.', 'sys');
}
function onLeaveBarrow(dead) {
  const k = getEnt(BARROW_STATE.king);
  if (k && k.alive && k.ai.awake) resetKing(k);
  if (!dead) uiLog('You climb back into the daylight.', 'sys');
}
function updateBarrow(dt) {
  if (!DUN.built) return;
  const S = BARROW_STATE, P = GAME.player, now = GAME.t;
  checkBarrowDoor();
  updateBarrowMotion(dt);
  if (P && P.alive && INDOOR.on && inDungeon(P) && dunU(P.x) < -5.4 && !UI.travelling) leaveBarrow();
  updateFlow();
  updateVents(dt);
  updateChests(dt);
  const playerNear = (x, z, r) => P && inDungeon(P) && dist2(P.x, P.z, x, z) < r * r;
  for (const pk of BARROW_PACKS) {
    for (let i = pk.respawn.length - 1; i >= 0; i--) {
      const R = pk.respawn[i];
      if (now < R.at) continue;
      const [type, lvl, u, v] = R.spec;
      if (playerNear(dunWX(u), dunWZ(v), 32)) { R.at = now + 15; continue; }
      pk.respawn.splice(i, 1);
      pk.members.add(spawnBarrowMob(type, lvl, u, v, pk).id);
    }
  }
  if (S.wardenDead && now > S.wardenAt && !playerNear(dunWX(150), dunWZ(0), 40)) spawnWarden();
  if (S.kingDead && now > S.kingAt && !playerNear(DUN.spots.throne.x, DUN.spots.throne.z, 50)) spawnKing();
  if (!INDOOR.on || !P) return;
  // dust motes drifting through the torchlight, and the well breathing ghost-light
  if (Math.random() < dt * 9) {
    const a = Math.random() * TAU, r = 2 + Math.random() * 9;
    const x = P.x + Math.cos(a) * r, z = P.z + Math.sin(a) * r;
    if (isWalkable(x, z)) fxAdd.emit(x, heightAt(x, z) + 0.5 + Math.random() * 2.5, z, (Math.random() - 0.5) * 0.1, 0.03, (Math.random() - 0.5) * 0.1, 5, 0.32, 0.27, 0.2, 0.03, 0, 0);
  }
  const W = DUN.spots.well;
  if (dist2(P.x, P.z, W.x, W.z) < 40 * 40 && Math.random() < dt * 14) {
    const a = Math.random() * TAU, r = Math.random() * 2.6;
    fxAdd.emit(W.x + Math.cos(a) * r, W.y + 0.1, W.z + Math.sin(a) * r, 0, 1.2 + Math.random() * 1.6, 0, 1.6 + Math.random(), 0.35, 1.1, 1.25, 0.16, -0.3, 0.3);
  }
  if (Math.random() < dt * 0.4) sndAround('drip', 3, 14, 1.5 + Math.random() * 2); // [audio2] the Barrow's drips placed round you, its halls' echo after them (11c_sound.js)
}
