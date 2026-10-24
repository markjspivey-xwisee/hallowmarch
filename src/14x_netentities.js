/* Shared actors and combat. Private players/pets retain their own owner; the
 * admitted scene keeper owns every other actor, including creatures and doors. */
const NET_ENTITIES = { authority: '', peer: '', admission: null, complete: false, waiting: false,
  seq: 0, received: -1, next: 1, at: -Infinity, applying: false, rows: new Map(), bodies: new Map(),
  sent: new Map(), buffers: new Map(), assembly: null, commands: 0, rewards: new Set(), rewarding: false,
  petsAt: -Infinity, metaKey: '', published: false, lastRefusal: '',
  stats: { frames: 0, sent: 0, made: 0, hits: 0, refused: 0, commands: 0, rewards: 0 } };
const netEntityShared = () => typeof NETWS !== 'undefined' && !!NETWS.url;
const netEntityPrivate = e => !e || e === GAME.player || e.role === 'player' || e.role === 'remote'
  || e.netCompanion;
const netEntityPersonal = e => !!e && (e.role === 'pet' || !!e.netEntityOwner || e.tame?.owner === 'player');
const netEntityOwnPet = e => netEntityPersonal(e) && (!e.netEntityOwner || e.netEntityOwner === NET.self);
const netEntityTown = e => !!e?.netNpcId || ['villager', 'herald', 'merchant'].includes(e?.role);
const netEntityOwned = e => !!e && !netEntityPrivate(e) && !netEntityTown(e);
const netEntityLive = () => typeof netOn === 'function' && netOn() && NETWS.state === 'on'
  && (typeof netHumanLive !== 'function' || netHumanLive())
  && (typeof netSharedWorldReady !== 'function' || netSharedWorldReady());
const netEntityMine = () => !!NET_ENTITIES.authority && NET_ENTITIES.peer === NET.self && !NET_ENTITIES.waiting;
function netEntityCanSimulateWorld() {
  return !netEntityShared() || (netEntityLive() && netEntityMine()
    && (typeof netWorldPartsCanSimulate !== 'function' || netWorldPartsCanSimulate()));
}
function netEntityRegister(e) {
  if (!netEntityOwned(e)) return;
  if (netEntityPersonal(e) && !e.netEntityOwner && NET.self) {
    if (e.netEntityId) NET_ENTITIES.bodies.delete(e.netEntityId);
    e.netEntityOwner = NET.self; e.netEntityLocalOwner = true;
    e.netEntityId = 'scene:pet' + NET.self + ':' + NET_ENTITIES.next++;
  }
  if (e.netEntityId && e.netEntityKey) { NET_ENTITIES.bodies.set(e.netEntityId, e); return; }
  const home = e.home || e;
  e.netEntityKey = [e.kind, e.role, e.faction, e.mobType || '', Math.round(home.x || 0), Math.round(home.z || 0)].join(':');
  e.netEntityId = e.netEntityId || 'scene:' + (NET_ENTITIES.authority ? NET_ENTITIES.authority.slice(0, 8) : 'bootstrap') + ':' + NET_ENTITIES.next++;
  NET_ENTITIES.bodies.set(e.netEntityId, e);
}
function netEntityFind(id) {
  if (typeof id !== 'string') return null;
  if (id.startsWith('peer:')) return id.slice(5) === NET.self ? GAME.player : NET.peers.get(id.slice(5))?.ghost || null;
  const e = NET_ENTITIES.bodies.get(id);
  if (e && !e.removed) return e;
  if (typeof netNpcFind === 'function') return netNpcFind(id);
  return null;
}
function netEntityVisible(e) {
  if (!netEntityShared() || !netEntityOwned(e)) return true;
  if (netEntityOwnPet(e)) return true;
  if (netEntityMine()) return !e.netEntityMissing;
  return NET_ENTITIES.complete && !!e.netEntityId && NET_ENTITIES.rows.has(e.netEntityId) && !e.netEntityMissing;
}
function netEntityForget(e) {
  if (e?.netEntityId && NET_ENTITIES.bodies.get(e.netEntityId) === e) NET_ENTITIES.bodies.delete(e.netEntityId);
}
// Serialise only scene data; never retain entity object graphs, callbacks or a player's inventory.
function netEntityPlain(value, depth = 0) {
  if (value == null || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? Math.round(value * 1000) / 1000 : null;
  if (typeof value === 'string') return value.slice(0, 120);
  if (depth > 5 || typeof value !== 'object') return null;
  if (Array.isArray(value)) return value.slice(0, 64).map(v => netEntityPlain(v, depth + 1));
  const o = {};
  for (const k of Object.keys(value).slice(0, 40)) {
    if (['__proto__', 'constructor', 'prototype'].includes(k) || typeof value[k] === 'function') continue;
    o[k] = netEntityPlain(value[k], depth + 1);
  }
  return o;
}
const netEntityR = v => Math.round((Number.isFinite(v) ? v : 0) * 100) / 100;
const NET_ENTITY_DEFAULTS = { kind: 'humanoid', role: 'mob', faction: 3, name: '', level: 1,
  cls: null, mobType: null, yaw: 0, alive: 1, a: 0, ph: 0, am: 0, scale: 1, radius: 0.45, speed: 6.5,
  fixedY: null, hover: 0, home: null, game: false, deep: false, deepLord: false, l2risen: null,
  elite: false, camp: null, dunPack: null, owner: null, seat: null, tame: null, keep: null, temple: null,
  ai: null, flying: false, dragon: null, buffs: null, look: null };
function netEntityPackLook(look) {
  if (!look || Array.isArray(look)) return look;
  const keys = Object.keys(look);
  if (keys.every(k => ['colA', 'colB'].includes(k)) && look.colA?.length === 3 && look.colB?.length === 3)
    return [2, ...look.colA, ...look.colB];
  if (keys.every(k => ['tabard', 'armor', 'skin', 'hair', 'mask', 'flags', 'scale', 'outfit', 'emblem', 'fem', 'bulk'].includes(k))
    && look.tabard?.length === 3 && look.armor?.length === 3
    && [look.skin, look.hair, look.mask].every(Number.isFinite))
    return [1, ...look.tabard, ...look.armor, look.skin, look.hair, look.mask, look.flags || 0,
      look.scale ?? 1, look.outfit ?? 0, look.emblem ?? 3, look.fem ? 1 : 0, look.bulk || 0];
  return look;
}
function netEntityUnpackLook(look) {
  if (!Array.isArray(look)) return look;
  if (!look.every(Number.isFinite)) return null;
  if (look[0] === 2 && look.length === 7) return { colA: look.slice(1, 4), colB: look.slice(4, 7) };
  if (look[0] === 1 && look.length === 16) return { tabard: look.slice(1, 4), armor: look.slice(4, 7),
    skin: look[7], hair: look[8], mask: look[9], flags: look[10], scale: look[11], outfit: look[12],
    emblem: look[13], fem: look[14], bulk: look[15] };
  return null;
}
function netEntityWire(row) {
  row.look = netEntityPackLook(row.look);
  if (row.ai && Object.values(row.ai).every(v => v == null || v === false)) row.ai = null;
  if (!row.buffs?.length) row.buffs = null;
  else row.buffs = row.buffs.map(b => ({ kind: b.kind, value: Math.round(b.value * 1000) / 1000,
    left: Math.round(b.left * 10) / 10 }));
  for (const [key, value] of Object.entries(NET_ENTITY_DEFAULTS)) if (row[key] === value) delete row[key];
  if (row.hp === row.maxHp) delete row.hp;
  return row;
}
function netEntityRow(e) {
  netEntityRegister(e);
  return netEntityWire({ id: e.netEntityId, key: e.netEntityKey, kind: e.kind, role: e.role, faction: e.faction,
    name: String(e.name || '').slice(0, 80), level: e.level, cls: e.cls, mobType: e.mobType,
    p: [netEntityR(e.x), netEntityR(e.y), netEntityR(e.z)], yaw: netEntityR(e.yaw),
    hp: netEntityR(e.hp), maxHp: netEntityR(e.maxHp), alive: e.alive ? 1 : 0,
    a: netEntityR(animActValue(e)), ph: netEntityR(e.anim.phase % (Math.PI * 2)), am: netEntityR(e.anim.amt),
    scale: netEntityR(e.scale || 1), radius: netEntityR(e.radius || 0.45), speed: netEntityR(e.speed || 0),
    fixedY: Number.isFinite(e.fixedY) ? e.fixedY : null, hover: netEntityR(e.hover || 0),
    look: netEntityPlain(e.look), home: e.home ? { x: e.home.x, z: e.home.z, r: e.home.r || 0 } : null,
    game: !!e.game, deep: !!e.deep, deepLord: !!e.deepLord, l2risen: e.l2risen || null,
    elite: !!e.elite, camp: Number.isInteger(e.camp) ? e.camp : null,
    dunPack: Number.isInteger(e.dunPack) ? e.dunPack : null, owner: e.netEntityOwner || null,
    seat: e.seat ? netEntityPlain(e.seat) : null, tame: e.tame ? netEntityPlain(e.tame) : null,
    keep: Number.isInteger(e.keep?.id) ? e.keep.id : null, temple: Number.isInteger(e.temple?.id) ? e.temple.id : null,
    ai: e.ai ? netEntityPlain({ post: e.ai.post, slot: e.ai.slot, wall: e.ai.wall }) : null,
    flying: !!e.flying, dragon: e.kind === 'dragon' && typeof DRAGON !== 'undefined'
      ? netEntityPlain({ state: DRAGON.state, stateT: DRAGON.stateT, act: DRAGON.act, flap: DRAGON.flap,
        glide: DRAGON.glide, alt: DRAGON.alt, yaw: DRAGON.yaw, walking: DRAGON.walking, circ: DRAGON.circ, perch: DRAGON.perch }) : null,
    buffs: e.buffs.slice(0, 24).map(b => ({ kind: b.kind, value: b.value, left: Math.max(0, b.until - GAME.t) })) });
}
function netEntityReadRow(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = { ...value };
  for (const [key, fallback] of Object.entries(NET_ENTITY_DEFAULTS)) if (row[key] == null) row[key] = fallback;
  if (row.hp == null) row.hp = row.maxHp;
  row.look = netEntityUnpackLook(row.look);
  if (Array.isArray(value.look) && row.look === null) return null;
  const finite = (v, lo, hi) => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;
  if (!row || typeof row.id !== 'string' || !/^scene:[a-zA-Z0-9_-]{1,32}:\d{1,8}$/.test(row.id)
    || typeof row.key !== 'string' || row.key.length > 160 || typeof row.kind !== 'string' || row.kind.length > 24
    || typeof row.role !== 'string' || row.role.length > 24 || ['player', 'remote', 'villager', 'herald', 'merchant'].includes(row.role)
    || !Number.isInteger(row.faction) || row.faction < 0 || row.faction > 4
    || !Array.isArray(row.p) || row.p.length !== 3 || !row.p.every(v => finite(v, -4000, 4000))
    || !finite(row.yaw, -1000, 1000) || !finite(row.hp, 0, 1e8) || !finite(row.maxHp, 1, 1e8)
    || !finite(row.level, 1, 100) || !finite(row.a, 0, 128) || !finite(row.ph, -1000, 1000)
    || !finite(row.am, 0, 20) || !finite(row.scale, 0.01, 50)
    || (row.owner != null && (typeof row.owner !== 'string' || !/^[a-zA-Z0-9_-]{1,24}$/.test(row.owner)))) return null;
  return netEntityPlain(row);
}
function netEntityEnsure(row) {
  let e = NET_ENTITIES.bodies.get(row.id);
  if (e && !e.removed && netEntityOwned(e)) return e;
  // Reuse bootstrap bodies where possible: their keep, dungeon and rendering references stay valid.
  e = ENT.find(x => netEntityOwned(x) && !x.removed && !NET_ENTITIES.rows.has(x.netEntityId)
    && !x.netEntityConfirmed && (x.netEntityKey === row.key || x.kind === row.kind && x.role === row.role
      && ((row.kind === 'door' && Math.hypot(x.x - row.p[0], x.z - row.p[2]) < 1) || row.kind === 'dragon')));
  if (!e) {
    e = makeEnt({ kind: row.kind, role: row.role, faction: row.faction, cls: row.cls, mobType: row.mobType,
      level: row.level, name: row.name, x: row.p[0], y: row.p[1], z: row.p[2], yaw: row.yaw,
      look: netEntityPlain(row.look), home: netEntityPlain(row.home) });
    setupStats(e); NET_ENTITIES.stats.made++;
  }
  if (e.netEntityId) NET_ENTITIES.bodies.delete(e.netEntityId);
  e.netEntityId = row.id; e.netEntityKey = row.key; e.netEntityConfirmed = true;
  NET_ENTITIES.bodies.set(row.id, e);
  return e;
}
function netEntityApply(e, row, immediate = false) {
  e.netEntityMissing = false;
  if (row.owner === NET.self && netEntityOwnPet(e)) return;
  e.netEntityMissing = false; e.netEntityPose = row.a;
  e.name = row.name; e.faction = row.faction; e.cls = row.cls; e.mobType = row.mobType; e.level = row.level;
  e.look = netEntityPlain(row.look); e.scale = row.scale; e.radius = row.radius; e.speed = row.speed;
  e.fixedY = row.fixedY; e.hover = row.hover; e.home = row.home ? netEntityPlain(row.home) : e.home;
  e.netEntityOwner = row.owner || null;
  e.tame = row.tame ? netEntityPlain(row.tame) : null;
  if (e.tame && row.owner && row.owner !== NET.self) e.tame.owner = 'remote';
  if (e.tame && e.role === 'animal' && typeof ANIMALS !== 'undefined' && !ANIMALS.list.includes(e)) ANIMALS.list.push(e);
  e.flying = !!row.flying;
  if (e.ai) {
    delete e.ai.post; delete e.ai.slot; delete e.ai.wall;
    if (row.ai) Object.assign(e.ai, netEntityPlain(row.ai));
  }
  if (typeof WAR !== 'undefined') {
    if (Number.isInteger(row.keep) && WAR.keeps[row.keep]) {
      e.keep = WAR.keeps[row.keep];
      if (e.role === 'lord') e.keep.lord = e.id; else if (e.role === 'guard') e.keep.guards.add(e.id);
    }
    if (Number.isInteger(row.temple) && WAR.temples[row.temple]) { e.temple = WAR.temples[row.temple]; e.temple.guardians.add(e.id); }
  }
  if (e.kind === 'dragon' && typeof DRAGON !== 'undefined') {
    DRAGON.e = e; if (row.dragon) Object.assign(DRAGON, netEntityPlain(row.dragon));
    if (!DRAGON.pose && typeof dragonPoseZero === 'function') DRAGON.pose = dragonPoseZero();
  }
  e.game = row.game; e.deep = row.deep; e.deepLord = row.deepLord; e.l2risen = row.l2risen; e.elite = row.elite; e.dunPack = row.dunPack;
  e.camp = row.camp;
  e.hp = row.hp; e.maxHp = row.maxHp;
  if (e.alive && !row.alive) e.deadAt = GAME.t;
  e.alive = !!row.alive; e.removeAt = Infinity; e.seat = netEntityPlain(row.seat);
  e.anim.act = Math.floor(row.a); e.anim.actT = row.a % 1; e.anim.actDur = row.a ? 1 : 0;
  e.anim.death = e.alive ? 0 : Math.min(1, (GAME.t - e.deadAt) / 0.7);
  e.buffs = Array.isArray(row.buffs) ? row.buffs.slice(0, 24).filter(b => typeof b.kind === 'string' && Number.isFinite(b.value) && Number.isFinite(b.left))
    .map(b => ({ kind: b.kind, value: b.value, until: GAME.t + Math.min(600, b.left), tick: GAME.t, src: null })) : [];
  if (immediate) {
    e.x = e.prevX = row.p[0]; e.y = row.p[1]; e.z = e.prevZ = row.p[2]; e.yaw = row.yaw;
    e.anim.phase = row.ph; e.anim.amt = row.am;
  }
}
function netEntityReceive(payload, immediate = false) {
  if (!payload || payload.v !== 1 || !Array.isArray(payload.rows) || payload.rows.length > 2048) return false;
  const rows = payload.rows.map(row => netEntityReadRow(payload.full === false ? { ...NET_ENTITIES.rows.get(row.id), ...row } : row));
  if (rows.some(r => !r) || new Set(rows.map(r => r.id)).size !== rows.length) return false;
  if (payload.full !== false) {
    const keep = new Set(rows.map(r => r.id));
    for (const [id, e] of NET_ENTITIES.bodies) if (!keep.has(id) && netEntityOwned(e)) {
      e.netEntityMissing = true;
      if (e.netEntityConfirmed && e.kind !== 'door') removeEnt(e);
    }
    NET_ENTITIES.rows.clear(); NET_ENTITIES.buffers.clear();
  }
  for (const id of Array.isArray(payload.remove) ? payload.remove.slice(0, 2048) : []) {
    const e = NET_ENTITIES.bodies.get(id);
    if (e) { e.netEntityMissing = true; if (e.kind !== 'door') removeEnt(e); }
    NET_ENTITIES.rows.delete(id); NET_ENTITIES.buffers.delete(id);
  }
  const at = performance.now();
  for (const row of rows) {
    // Ensure before inserting so a bootstrap body with the same local id remains reusable.
    const e = netEntityEnsure(row);
    NET_ENTITIES.rows.set(row.id, row);
    netEntityApply(e, row, immediate || !NET_ENTITIES.complete);
    const buf = NET_ENTITIES.buffers.get(row.id) || [];
    buf.push({ at, row }); if (buf.length > 4) buf.shift(); NET_ENTITIES.buffers.set(row.id, buf);
  }
  NET_ENTITIES.complete = true; NET_ENTITIES.waiting = false;
  if (payload.meta) netEntityApplyMeta(payload.meta);
  NET_ENTITIES.stats.frames++;
  if (netEntityMine()) for (const e of NET_ENTITIES.bodies.values()) {
    e.netEntityPose = null;
    if (e.ai) { e.ai.path = null; e.ai.think = 0; }
  }
  return true;
}
function netEntityMeta() {
  const ref = id => getEnt(id)?.netEntityId || null;
  const meta = {};
  if (typeof WAR !== 'undefined') meta.warbands = WAR.warbands.slice(0, 96).map(w => ({
    id: w.id, realm: w.realm, ord: w.ord || 0, members: w.members.map(ref).filter(Boolean),
    season: w.season ? netEntityPlain(w.season) : null,
    order: w.order ? { type: w.order.type, keep: w.order.keep?.id ?? null, relic: w.order.relic?.id ?? null,
      x: w.order.x, z: w.order.z, phase: w.order.phase } : null }));
  if (typeof CAMPS !== 'undefined') meta.camps = CAMPS.slice(0, 128).map(c => ({ id: c.id,
    members: [...c.members].map(ref).filter(Boolean), elite: ref(c.eliteId),
    eliteIn: Math.max(0, c.eliteAt - GAME.t), respawn: c.respawnAt.slice(0, 32).map(t => Math.max(0, t - GAME.t)) }));
  if (typeof LATE4 !== 'undefined') meta.roam = LATE4.hosts.slice(0, 3).map((h, i) => ({ i,
    px: h.px, pz: h.pz, ri: h.ri, down: h.down, hpK: h.hpK, up: h.up, ids: h.ids.map(ref).filter(Boolean),
    lead: ref(h.lead), home: netEntityPlain(h.home) }));
  if (typeof LOOPS !== 'undefined') meta.caravans = LOOPS.caravans.slice(0, 64).map(c => ({
    id: c.id, realm: c.realm, keep: c.keep, route: netEntityPlain(c.route), i: c.i, state: c.state,
    load: netEntityPlain(c.load), back: c.back, horse: ref(c.horse), carter: ref(c.carter), esc: c.esc.map(ref).filter(Boolean),
    ax: c.ax, az: c.az, y: c.y, yaw: c.yaw, roll: c.roll, pitch: c.pitch, wheel: c.wheel,
    wreckT: c.wreckT, parked: c.parkT || 0, age: Math.max(0, GAME.t - c.t0) }));
  return meta;
}
function netEntityApplyMeta(meta) {
  const ref = id => netEntityFind(id)?.id || null;
  if (typeof WAR !== 'undefined' && Array.isArray(meta.warbands) && meta.warbands.length <= 96) {
    const old = new Map(WAR.warbands.map(w => [w.id, w]));
    WAR.warbands = meta.warbands.filter(w => Number.isSafeInteger(w.id) && [0, 1, 2].includes(w.realm) && Array.isArray(w.members)).map(row => {
      const w = old.get(row.id) || { id: row.id, realm: row.realm, path: null, pathIdx: 0,
        created: GAME.t, engagedUntil: -99, lastProgress: GAME.t, progX: 0, progZ: 0 };
      w.realm = row.realm; w.ord = row.ord; w.members = row.members.map(ref).filter(id => id != null); w.season = row.season;
      w.order = row.order ? { ...row.order, keep: WAR.keeps[row.order.keep] || null,
        relic: WAR.relics[row.order.relic] || null, since: GAME.t + 1 } : null;
      for (const id of w.members) { const e = getEnt(id); if (e) e.warband = w; }
      return w;
    });
    WAR.nextWb = Math.max(WAR.nextWb, ...WAR.warbands.map(w => w.id + 1));
    for (const C of WAR.commanders) { C.nextThink = GAME.t + 1; C.nextSpawn = Math.max(C.nextSpawn, GAME.t + 2); }
  }
  if (typeof CAMPS !== 'undefined' && Array.isArray(meta.camps) && meta.camps.length <= 128) {
    for (const row of meta.camps) {
      const c = CAMPS.find(camp => camp.id === row.id); if (!c || !Array.isArray(row.members)) continue;
      c.members = new Set(row.members.map(ref).filter(id => id != null)); c.eliteId = ref(row.elite);
      c.eliteAt = GAME.t + Math.max(0, Math.min(86400, +row.eliteIn || 0));
      c.respawnAt = Array.isArray(row.respawn) ? row.respawn.slice(0, 32).map(t => GAME.t + Math.max(0, Math.min(86400, +t || 0))) : [];
    }
  }
  if (typeof LATE4 !== 'undefined' && Array.isArray(meta.roam) && meta.roam.length <= 3) {
    if (typeof late4HostInit === 'function') late4HostInit();
    for (const row of meta.roam) {
      const H = LATE4.hosts[row.i]; if (!H || !Array.isArray(row.ids)) continue;
      Object.assign(H, { px: row.px, pz: row.pz, ri: row.ri, down: row.down, hpK: row.hpK, up: !!row.up,
        ids: row.ids.map(ref).filter(id => id != null), lead: ref(row.lead), home: netEntityPlain(row.home) });
      if (!H.camp) H.camp = { id: H.D.realm, realm: H.D.realm, type: H.D.type, x: H.px, z: H.pz,
        r: 3, count: H.D.n, members: new Set(), respawnAt: [], eliteAt: 0, eliteId: null, l2k: 1, l2on: true, l4host: H };
      H.camp.members = new Set(H.ids);
      H.ids.forEach((id, i) => { const e = getEnt(id); if (e) { e.l4host = H; e.l4slot = i; e.home = H.home; } });
      if (H.up && netEntityMine() && !H.route && typeof late4Route === 'function') {
        late4Route(H); if (H.route?.length) H.ri %= H.route.length;
      }
    }
  }
  if (typeof LOOPS !== 'undefined' && Array.isArray(meta.caravans) && meta.caravans.length <= 64) {
    const old = new Map(LOOPS.caravans.map(c => [c.id, c])), kept = new Set();
    LOOPS.caravans = meta.caravans.filter(c => Number.isSafeInteger(c.id) && [0, 1, 2].includes(c.realm) && Array.isArray(c.route)).map(row => {
      const c = old.get(row.id) || { id: row.id, cart: null, ents: [], near: 0, nearT: 0, by: null, stuckT: 0, lastD: 1e9 };
      kept.add(row.id); Object.assign(c, { ...row, horse: ref(row.horse), carter: ref(row.carter), esc: (row.esc || []).map(ref).filter(id => id != null),
        t0: GAME.t - (row.age || 0), parkT: row.parked || 0 });
      for (const id of [c.horse, c.carter, ...c.esc]) { const e = getEnt(id); if (e) e.lCar = c; }
      return c;
    });
    for (const [id, c] of old) if (!kept.has(id) && c.cart && typeof loopsCartFree === 'function') loopsCartFree(c);
    LOOPS.nextCar = Math.max(LOOPS.nextCar, ...LOOPS.caravans.map(c => c.id + 1));
  }
}
function netEntityStep(e, dt) {
  if (!netEntityShared() || !netEntityOwned(e)) return false;
  netEntityRegister(e);
  if (netEntityOwnPet(e) && netEntityLive()) { e.netEntityPose = null; return false; }
  if (!e.netEntityOwner && netEntityCanSimulateWorld()) { e.netEntityPose = null; return false; }
  const buf = NET_ENTITIES.buffers.get(e.netEntityId);
  if (!buf?.length || !netEntityVisible(e)) return true;
  const rt = performance.now() - 130;
  let b = buf[buf.length - 1], a = b;
  for (let i = 0; i < buf.length - 1; i++) if (buf[i].at <= rt && buf[i + 1].at >= rt) { a = buf[i]; b = buf[i + 1]; break; }
  const u = a === b ? 1 : Math.max(0, Math.min(1, (rt - a.at) / Math.max(1, b.at - a.at)));
  const l = (x, y) => x + (y - x) * u;
  e.prevX = e.x; e.prevZ = e.z;
  e.x = l(a.row.p[0], b.row.p[0]); e.y = l(a.row.p[1], b.row.p[1]); e.z = l(a.row.p[2], b.row.p[2]);
  e.yaw = a.row.yaw + Math.atan2(Math.sin(b.row.yaw - a.row.yaw), Math.cos(b.row.yaw - a.row.yaw)) * u;
  e.anim.phase = l(a.row.ph, b.row.ph); e.anim.amt = l(a.row.am, b.row.am);
  e.anim.death = e.alive ? 0 : Math.min(1, (GAME.t - e.deadAt) / 0.7);
  e.anim.flash = Math.max(0, e.anim.flash - dt * 5);
  return true;
}
function netEntityHumanDistance(e) {
  let d = GAME.player ? dist2(e.x, e.z, GAME.player.x, GAME.player.z) : Infinity;
  if (netEntityShared() && netEntityMine()) for (const peer of NET.peers.values()) {
    const p = peer.ghost || peer.fast;
    if (peer.slow?.on && p && p.alive !== false) d = Math.min(d, dist2(e.x, e.z, p.x, p.z));
  }
  return d === Infinity ? 0 : d;
}
function netEntityRemoteEnemy(a, b) {
  if (!netEntityShared() || !netEntityMine()) return null;
  const r = a.role === 'remote' ? a : b.role === 'remote' ? b : null, other = r === a ? b : a;
  if (!r || !other || netEntityPrivate(other) || other.flying || r.flying) return null;
  if (other.faction === FACTION_NEUTRAL) return !!other.game;
  if (typeof W3 !== 'undefined' && W3.pact && war4Allied(other.faction, r.faction)) return false;
  return other.faction !== r.faction;
}
function netEntitySend(op, more) {
  if (!netEntityLive() || !NET_ENTITIES.authority) return false;
  return netWsSend({ t: 'activity', kind: 'entities', op, authority: NET_ENTITIES.authority,
    worldAdmission: NET_ENTITIES.admission, ...more });
}
function netEntityCommand(kind, dst, amount, opts = {}) {
  if (!netEntityLive() || !NET_ENTITIES.authority) return false;
  const command = { id: ++NET_ENTITIES.commands, kind, target: dst.netNpcId || dst.netEntityId,
    amount, opts: netEntityPlain(opts) };
  NET_ENTITIES.stats.commands++;
  return netEntitySend('command', { command });
}
function netEntityDamage(src, dst, amount, opts = {}) {
  if (!netEntityShared()) return null;
  const worldSrc = netEntityOwned(src) || netEntityTown(src), worldDst = netEntityOwned(dst) || netEntityTown(dst);
  if (worldDst && dst.netEntityOwner && dst.netEntityOwner !== NET.self && netEntityMine()) {
    netEntitySend('result', { to: dst.netEntityOwner, result: { id: NET_ENTITIES.authority + ':pet-hurt:' + (++NET_ENTITIES.commands),
      kind: 'damage', source: src?.netNpcId || src?.netEntityId || (src?.netPeer ? 'peer:' + src.netPeer : null),
      target: dst.netEntityId, amount, opts: netEntityPlain(opts) } });
    return amount;
  }
  if (NET_ENTITIES.applying) return null;
  if (worldDst && netEntityOwnPet(dst)) return null;
  if (worldDst && !netEntityCanSimulateWorld()) {
    if (src === GAME.player || netEntityOwnPet(src)) netEntityCommand('damage', dst, amount,
      netEntityOwnPet(src) ? { ...opts, petSource: src.netEntityId } : opts);
    return 0;
  }
  if (worldSrc && dst?.role === 'remote' && netEntityMine()) {
    netEntitySend('result', { to: dst.netPeer, result: { id: NET_ENTITIES.authority + ':hurt:' + (++NET_ENTITIES.commands), kind: 'damage',
      source: src.netNpcId || src.netEntityId, amount, opts: netEntityPlain(opts) } });
    return amount;
  }
  if (worldSrc && dst === GAME.player && !netEntityCanSimulateWorld()) return 0;
  return null;
}
function netEntityHeal(src, dst, amount) {
  if (!netEntityShared()) return null;
  if (dst.netEntityOwner && dst.netEntityOwner !== NET.self && netEntityMine()) {
    netEntitySend('result', { to: dst.netEntityOwner, result: { id: NET_ENTITIES.authority + ':pet-heal:' + (++NET_ENTITIES.commands),
      kind: 'heal', source: src?.netNpcId || src?.netEntityId || (src?.netPeer ? 'peer:' + src.netPeer : null),
      target: dst.netEntityId, amount } }); return 0;
  }
  if (NET_ENTITIES.applying || netEntityOwnPet(dst)) return null;
  if ((netEntityOwned(dst) || netEntityTown(dst)) && !netEntityCanSimulateWorld()) {
    if (src === GAME.player) netEntityCommand('heal', dst, amount);
    return 0;
  }
  if ((netEntityOwned(src) || netEntityTown(src)) && dst?.role === 'remote' && netEntityMine()) {
    netEntitySend('result', { to: dst.netPeer, result: { id: NET_ENTITIES.authority + ':heal:' + (++NET_ENTITIES.commands), kind: 'heal',
      source: src.netNpcId || src.netEntityId, amount } }); return 0;
  }
  return null;
}
function netEntityBuff(dst, kind, value, dur, src, extra) {
  if (!netEntityShared()) return false;
  const source = getEnt(src);
  if (dst.netEntityOwner && dst.netEntityOwner !== NET.self && netEntityMine()) {
    netEntitySend('result', { to: dst.netEntityOwner, result: { id: NET_ENTITIES.authority + ':pet-buff:' + (++NET_ENTITIES.commands),
      kind: 'buff', source: source?.netNpcId || source?.netEntityId || (source?.netPeer ? 'peer:' + source.netPeer : null),
      target: dst.netEntityId, buff: kind, amount: value, dur, extra: netEntityPlain(extra) } }); return true;
  }
  if (NET_ENTITIES.applying || netEntityOwnPet(dst)) return false;
  if (dst?.role === 'remote' && netEntityMine() && (netEntityOwned(source) || netEntityTown(source))) {
    netEntitySend('result', { to: dst.netPeer, result: { id: NET_ENTITIES.authority + ':buff:' + (++NET_ENTITIES.commands),
      kind: 'buff', source: source.netNpcId || source.netEntityId, buff: kind, amount: value, dur, extra: netEntityPlain(extra) } });
    return true;
  }
  if (!netEntityOwned(dst) && !netEntityTown(dst)) return false;
  if (netEntityCanSimulateWorld()) return false;
  if (src === GAME.player?.id) netEntityCommand('buff', dst, value, { kind, dur, extra: netEntityPlain(extra) });
  return true;
}
function netEntityKilled(e) {
  if (!netEntityShared() || !netEntityMine() || !e.damagers || e.kind === 'door' || netEntityTown(e)) return;
  if (!e.netEntityLootMade && !e.damagers.has(GAME.player?.id)
    && [...e.damagers].some(id => getEnt(id)?.role === 'remote') && typeof rollLoot === 'function') rollLoot(e);
  e.netEntityLootMade = true;
  e.netEntityDeaths = (e.netEntityDeaths || 0) + 1;
  const reward = { id: NET_ENTITIES.authority + ':reward:' + (e.netNpcId || e.netEntityId) + ':' + e.netEntityDeaths, kind: 'reward', row: netEntityRow(e) };
  for (const id of e.damagers) {
    const src = getEnt(id);
    if (src?.role === 'remote' && src.netPeer) netEntitySend('result', { to: src.netPeer, result: reward });
  }
}
function netEntityRelicDelivered(rel, e) {
  if (!netEntityShared() || !netEntityMine() || e?.role !== 'remote' || !e.netPeer) return;
  netEntitySend('result', { to: e.netPeer, result: { id: NET_ENTITIES.authority + ':relic:' + rel.id + ':' + (++NET_ENTITIES.commands),
    kind: 'realm-points', amount: 500 } });
}
function netEntityHandleCommand(m) {
  if (!netEntityMine() || !m.command || typeof m.from !== 'string') return;
  if (m.command.kind === 'pet-state') {
    const row = netEntityReadRow(m.command.row), peer = NET.peers.get(m.from);
    if (!row || row.owner !== m.from || !row.id.startsWith('scene:pet' + m.from + ':') || !peer?.slow?.on
      || ENT.filter(e => e.netEntityOwner === m.from && !e.removed).length >= 16 && !netEntityFind(row.id)) return;
    const e = netEntityEnsure(row); netEntityApply(e, row, true); NET_ENTITIES.rows.set(row.id, row);
    NET_ENTITIES.buffers.set(row.id, [{ at: performance.now(), row }]);
    return;
  }
  if (!netEntityCanSimulateWorld()) return;
  const cmd = m.command, target = netEntityFind(cmd.target), peer = NET.peers.get(m.from), actor = peer?.ghost;
  const opts = cmd.opts && typeof cmd.opts === 'object' ? cmd.opts : {};
  const pet = typeof opts.petSource === 'string' ? netEntityFind(opts.petSource) : null;
  if (pet && (pet.netEntityOwner !== m.from || !m.position || Math.hypot(pet.x - m.position.x, pet.z - m.position.z) > 120)) return;
  const src = pet || actor, origin = pet ? { x: pet.x, z: pet.z } : m.position;
  if (!target?.alive || !src?.alive || !m.position || !Number.isFinite(m.position.x) || !Number.isFinite(m.position.z)) return;
  if (Math.hypot(target.x - origin.x, target.z - origin.z) > 65 || Math.abs(target.y - src.y) > 40) return;
  const amount = typeof cmd.amount === 'number' && Number.isFinite(cmd.amount) ? Math.max(0, Math.min(baseDmg(src.level) * 40, cmd.amount)) : 0;
  NET_ENTITIES.applying = true;
  try {
    if (cmd.kind === 'damage' && isEnemy(src, target) && amount > 0) {
      const range = opts.kind === 'melee' && !opts.dot ? Math.max(6, src.meleeRange || 3) : 65;
      if (Math.hypot(target.x - origin.x, target.z - origin.z) <= range) { dealDamage(src, target, amount, opts); NET_ENTITIES.stats.hits++; }
    } else if (cmd.kind === 'heal' && !isEnemy(src, target) && amount > 0) healEnt(src, target, amount);
    else if (cmd.kind === 'buff' && typeof opts.kind === 'string' && typeof NET_BUFFS !== 'undefined' && NET_BUFFS[opts.kind]) {
      const friendly = ['hot', 'dr', 'dmg', 'shield'].includes(opts.kind);
      if (friendly !== isEnemy(src, target)) addBuff(target, opts.kind, amount, Math.max(0, Math.min(30, +opts.dur || 0)), src.id, opts.extra);
    }
  } finally { NET_ENTITIES.applying = false; }
}
function netEntityResult(result) {
  if (!result || typeof result.id !== 'string' || NET_ENTITIES.rewards.has(result.id)) return;
  NET_ENTITIES.rewards.add(result.id); if (NET_ENTITIES.rewards.size > 256) NET_ENTITIES.rewards.delete(NET_ENTITIES.rewards.values().next().value);
  NET_ENTITIES.applying = true;
  try {
    if (typeof netCombatFieldResult === 'function' && netCombatFieldResult(result)) return;
    const P = GAME.player, src = netEntityFind(result.source), target = result.target ? netEntityFind(result.target) : P;
    if (result.kind === 'realm-points' && P && result.amount === 500) {
      addRP(500); if (typeof uiToast === 'function') uiToast('Your realm receives the hallow. (+500 realm points)', 'relic');
    } else if (result.kind === 'reward') {
      const row = netEntityReadRow(result.row);
      if (row && P) {
        const e = netEntityFind(row.id) || netEntityEnsure(row);
        NET_ENTITIES.rewarding = true;
        try { grantKillRewards(e); NET_ENTITIES.stats.rewards++; } finally { NET_ENTITIES.rewarding = false; }
      }
    } else if (target?.alive && (!result.target || netEntityOwnPet(target)) && src && Number.isFinite(result.amount) && result.amount > 0) {
      const amount = Math.min(result.amount, baseDmg(src.level) * 40);
      if (result.kind === 'damage' && isEnemy(src, target)) dealDamage(src, target, amount, result.opts || {});
      else if (result.kind === 'heal' && !isEnemy(src, target)) healEnt(src, target, amount);
      else if (result.kind === 'buff' && typeof result.buff === 'string' && typeof NET_BUFFS !== 'undefined' && NET_BUFFS[result.buff])
        addBuff(target, result.buff, amount, Math.max(0, Math.min(30, +result.dur || 0)), src.id, result.extra);
    }
  } finally { NET_ENTITIES.applying = false; }
}
function netEntityMessage(m) {
  if (!m || m.t !== 'activity') return false;
  if (m.kind === 'authority') {
    const current = typeof netCurrentWorldAdmission === 'function' ? netCurrentWorldAdmission() : m.worldAdmission;
    if (!current || !m.worldAdmission || current.origin !== m.worldAdmission.origin || current.epoch !== m.worldAdmission.epoch
      || typeof m.authority !== 'string' || !m.authority || typeof m.peer !== 'string') return false;
    if (m.authority !== NET_ENTITIES.authority) {
      NET_ENTITIES.sent.clear(); NET_ENTITIES.received = -1; NET_ENTITIES.seq = 0; NET_ENTITIES.assembly = null; NET_ENTITIES.published = false;
      NET_ENTITIES.waiting = m.hasEntities === true;
    }
    NET_ENTITIES.authority = m.authority; NET_ENTITIES.peer = m.peer; NET_ENTITIES.admission = { ...m.worldAdmission };
    if (!m.hasEntities && NET_ENTITIES.peer === NET.self) NET_ENTITIES.complete = true;
    return true;
  }
  if (m.kind !== 'entities' || m.authority !== NET_ENTITIES.authority || !m.worldAdmission
    || m.worldAdmission.origin !== NET_ENTITIES.admission?.origin || m.worldAdmission.epoch !== NET_ENTITIES.admission?.epoch) return false;
  if (m.ok === false) {
    NET_ENTITIES.stats.refused++;
    NET_ENTITIES.lastRefusal = String(m.error || m.reason || 'Shared actor state was refused.').slice(0, 120);
    if (NET_ENTITIES.lastRefusal === 'scene_capacity') {
      NET_ENTITIES.waiting = true; NET_ENTITIES.published = false;
      if (typeof uiLog === 'function') uiLog('Shared world simulation paused: its actor checkpoint was refused.', 'warn');
    }
    return false;
  }
  if (m.op === 'owner-left' && typeof m.owner === 'string' && Array.isArray(m.ids) && m.ids.length <= 2048) {
    for (const id of m.ids) {
      const e = NET_ENTITIES.bodies.get(id);
      if (e?.netEntityOwner === m.owner && !netEntityOwnPet(e)) { e.netEntityMissing = true; removeEnt(e); }
      NET_ENTITIES.rows.delete(id); NET_ENTITIES.buffers.delete(id); NET_ENTITIES.sent.delete(id);
    }
    return true;
  }
  if (m.op === 'command') { netEntityHandleCommand(m); return true; }
  if (m.op === 'result') { netEntityResult(m.result); return true; }
  if (m.op !== 'snapshot' || !Number.isSafeInteger(m.seq) || m.seq <= NET_ENTITIES.received
    || !Number.isInteger(m.part) || !Number.isInteger(m.total) || m.total < 1 || m.total > 128
    || m.part < 0 || m.part >= m.total || typeof m.data !== 'string' || m.data.length > 3500) return false;
  let a = NET_ENTITIES.assembly;
  if (!a || a.seq !== m.seq) a = NET_ENTITIES.assembly = { seq: m.seq, total: m.total, parts: new Map(), size: 0 };
  if (a.total !== m.total || a.parts.has(m.part)) return false;
  a.parts.set(m.part, m.data); a.size += m.data.length;
  if (a.size > 512 * 1024) { NET_ENTITIES.assembly = null; return false; }
  if (a.parts.size !== a.total) return true;
  const text = Array.from({ length: a.total }, (_, i) => a.parts.get(i)).join(''); NET_ENTITIES.assembly = null;
  let payload; try { payload = JSON.parse(text); } catch { return false; }
  // The keeper already ran these changes; echoes must never rewind its physics.
  if (netEntityMine() && !NET_ENTITIES.waiting && !payload.replay) { NET_ENTITIES.received = m.seq; return true; }
  if (!netEntityReceive(payload, NET_ENTITIES.waiting)) return false;
  NET_ENTITIES.received = m.seq; return true;
}
function netEntityPump(now) {
  if (netEntityLive() && NET_ENTITIES.authority && !netEntityMine() && now - NET_ENTITIES.petsAt >= 1000) {
    NET_ENTITIES.petsAt = now;
    for (const e of ENT.filter(netEntityOwnPet).slice(0, 16)) if (!e.removed) {
      netEntityRegister(e);
      netEntitySend('command', { command: { id: ++NET_ENTITIES.commands, kind: 'pet-state', row: netEntityRow(e) } });
    }
  }
  if (!netEntityLive() || !netEntityMine() || now - NET_ENTITIES.at < 500) return;
  NET_ENTITIES.at = now;
  const rows = [], current = new Set(), nextSent = new Map(NET_ENTITIES.sent);
  for (const e of ENT) if (netEntityOwned(e) && !e.removed && !e.netEntityMissing) {
    netEntityRegister(e); current.add(e.netEntityId);
    const row = netEntityRow(e), key = JSON.stringify(row), previous = NET_ENTITIES.sent.get(row.id);
    if (!NET_ENTITIES.published || previous !== key) {
      let delta = row;
      if (NET_ENTITIES.published && previous) {
        const old = JSON.parse(previous); delta = { id: row.id };
        for (const k of Object.keys(row)) if (k !== 'id' && JSON.stringify(old[k]) !== JSON.stringify(row[k])) delta[k] = row[k];
        for (const k of Object.keys(old)) if (k !== 'id' && !Object.hasOwn(row, k)) delta[k] = null;
      }
      rows.push(delta); nextSent.set(row.id, key);
    }
  }
  const remove = [...NET_ENTITIES.sent.keys()].filter(id => !current.has(id));
  for (const id of remove) nextSent.delete(id);
  const meta = netEntityMeta(), metaKey = JSON.stringify(meta), metaChanged = metaKey !== NET_ENTITIES.metaKey;
  if (!rows.length && !remove.length && !metaChanged && NET_ENTITIES.published) return;
  const full = !NET_ENTITIES.published, payload = { v: 1, full, rows, remove, ...(full || metaChanged ? { meta } : {}) };
  if (current.size > 2048) { NET_ENTITIES.stats.refused++; return; }
  const data = JSON.stringify(payload); if (data.length > 512 * 1024) { NET_ENTITIES.stats.refused++; return; }
  const total = Math.ceil(data.length / 3500); if (total > 128) return;
  const seq = ++NET_ENTITIES.seq;
  for (let part = 0; part < total; part++) {
    if (netEntitySend('snapshot', { seq, part, total, data: data.slice(part * 3500, (part + 1) * 3500) }) === false) return;
  }
  NET_ENTITIES.sent = nextSent; NET_ENTITIES.published = true;
  NET_ENTITIES.stats.sent++;
  NET_ENTITIES.metaKey = metaKey;
}
function netEntityReset() {
  for (const e of ENT) if (e.netEntityLocalOwner) {
    if (e.netEntityId) NET_ENTITIES.bodies.delete(e.netEntityId);
    e.netEntityOwner = null; e.netEntityId = null;
  }
  NET_ENTITIES.authority = ''; NET_ENTITIES.peer = ''; NET_ENTITIES.admission = null;
  NET_ENTITIES.waiting = true; NET_ENTITIES.sent.clear(); NET_ENTITIES.buffers.clear(); NET_ENTITIES.assembly = null;
  NET_ENTITIES.metaKey = '';
  NET_ENTITIES.published = false;
}
queueMicrotask(() => {
  if (!window.__hm) return;
  window.__hm.entities = { state: () => ({ authority: NET_ENTITIES.authority, peer: NET_ENTITIES.peer, mine: netEntityMine(),
    complete: NET_ENTITIES.complete, count: netEntityMine() ? NET_ENTITIES.sent.size : NET_ENTITIES.rows.size,
    published: NET_ENTITIES.published, lastRefusal: NET_ENTITIES.lastRefusal,
    bytes: [...NET_ENTITIES.sent.values()].reduce((n, v) => n + v.length, 0), stats: { ...NET_ENTITIES.stats } }),
    rows: () => netEntityMine() ? ENT.filter(e => netEntityOwned(e) && !e.removed && !e.netEntityMissing).map(e => netEntityReadRow(netEntityRow(e))) : [...NET_ENTITIES.rows.values()],
    wireRows: () => netEntityMine() ? ENT.filter(e => netEntityOwned(e) && !e.removed && !e.netEntityMissing).map(netEntityRow)
      : [...NET_ENTITIES.rows.values()].map(r => netEntityWire(netEntityPlain(r))),
    find: netEntityFind, take: netEntityMessage, pump: netEntityPump,
    canSimulate: netEntityCanSimulateWorld,
    attack: (id, amount = 10) => dealDamage(GAME.player, netEntityFind(id), amount, { kind: 'melee' }) };
  window.__hm.netentities = window.__hm.entities;
});
