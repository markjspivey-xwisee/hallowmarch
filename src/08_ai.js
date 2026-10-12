/* ================================================================== */
/* AI: monsters, garrisons, warbands, realm commanders, relics         */
/* ================================================================== */
const WAR = { keeps: [], temples: [], relics: [], warbands: [], commanders: [], news: [], nextWb: 1, stats: { captures: 0, raids: 0, raidOrders: 0, raidSieges: 0, raidAborts: 0, raidWiped: 0, templeGates: 0, seized: 0 } };
const CAMPS = [];
const MAX_WARBANDS = () => (quality.level === 'low' ? 2 : quality.level === 'medium' ? 3 : 4);

function siteWorld(S, lx, ly, lz) { const p = siteToWorld(S, lx, lz); return { x: p.x, y: S.y + ly, z: p.z }; }

/* ------------------------------------------------------------------ */
/* spawning helpers                                                    */
/* ------------------------------------------------------------------ */
function spawnRealmUnit(realm, cls, level, role, x, z, extra = {}) {
  const name = randomName(realm);
  const look = classLook(cls, realm, Math.random, name);
  if (role === 'lord') { look.outfit = OUTFIT.lord; look.mask = (look.mask & ~(WB.helmet | WB.hairShort | WB.hairLong)) | WB.circlet | WB.cape | WB.hairShort; }
  // on a low platform (the temple dais, a rune circle, a stair foot) a body stands on top of it, not inside it
  const e = makeEnt({ kind: 'humanoid', faction: realm, role, cls, level, name, x, z, y: floorAt(x, z, heightAt(x, z) + 0.9), yaw: Math.random() * TAU, look, radius: 0.45, scale: look.scale, ...extra });
  if (role in WAR_LEVEL_OFF) e.wlOff = level - warLevel();
  setupStats(e);
  return e;
}

/* ------------------------------------------------------------------ */
/* the frontier keeps pace with you                                    */
/* ------------------------------------------------------------------ */
// past level 20 every realm's troops, gates and wardens rise with the strongest player,
// keeping the same steps between them as at 20
const WAR_LEVEL_OFF = { soldier: [-5, 0], guard: [0, 0], lord: [4, 4], guardian: [2, 2], muster: [10, 10] };
function warUnitLevel(role) { const o = WAR_LEVEL_OFF[role] || [0, 0]; return warLevel() + o[0] + Math.floor(Math.random() * (o[1] - o[0] + 1)); }
const DOOR_HP = { keep: 3600, temple: 2400 };
const doorHpScale = () => baseDmg(warLevel() + 2) / baseDmg(22);
const barrowBoost = () => Math.max(0, warLevel() - 20);
function scaleDoor(door) {
  const f = door.maxHp > 0 ? door.hp / door.maxHp : 1;
  door.level = warLevel() + 2;
  door.maxHp = (door.keepRef ? DOOR_HP.keep : DOOR_HP.temple) * doorHpScale();
  if (door.alive) door.hp = door.maxHp * f;
}
function rescaleWar() {
  const w = warLevel(), boost = barrowBoost();
  for (const e of ENT) {
    if (e.kind === 'door') { if (e.keepRef || e.templeRef) scaleDoor(e); continue; }
    if (!e.alive || e.role === 'player') continue;
    let lv = e.level;
    if (e.faction <= 2 && e.wlOff != null) lv = w + e.wlOff;
    else if (e.baseLevel != null) lv = e.baseLevel + boost;
    else if (e.role === 'boss' && e.mobType === 'dragon') lv = Math.max(DRAGON_LEVEL, w + 4);
    if (lv !== e.level) { e.level = lv; setupStats(e, true); }
  }
  VENT_SRC.level = 18 + boost;
}
function mobLook(M, type, lvl, sc, elite) {
  const tier = mobTier(M, lvl), late = tier - 4;
  if (M.kind !== 'humanoid') {
    const pal = MOB_LATE[type] && late >= 0 ? MOB_LATE[type][Math.min(late, MOB_LATE[type].length - 1)] : null;
    const A = pal ? pal[0] : M.colA || [0.6, 1.6, 1.4], B = pal ? pal[1] : M.colB || [0.3, 0.8, 0.7];
    return { colA: A.map((v) => v * (0.88 + Math.random() * 0.24) * (elite ? 1.08 : 1)), colB: B.slice() };
  }
  let mask = M.mask | (M.outfit === 5 && Math.random() < 0.3 ? WB.cape : 0) | (M.outfit === 5 && Math.random() < 0.5 ? WB.beard : 0);
  let flags = M.flags || 0, bulk = M.bulk || 0, tab = M.tabard.map((v) => v * (0.8 + Math.random() * 0.4)), armor = M.armor;
  // past 20 the outlaws, the dead and the trolls come better armed and grimmer
  if (late >= 0) {
    if (type === 'bandit') { mask |= WB.pauldron | (Math.random() < 0.6 ? WB.helmet : WB.hood); tab = [0.4 + Math.random() * 0.08, 0.15, 0.13]; armor = [0.36, 0.34, 0.33]; }
    if (type === 'skeleton' || type === 'draugr') { mask |= WB.pauldron | WB.helmet; flags |= (2 << 4) | ((late >= 2 ? 2 : 1) << 7); }
    if (type === 'troll') bulk = 1.2 + 0.1 * Math.min(late, 3);
    if (late >= 2) mask |= WB.cape;
  }
  if (elite) mask |= WB.cape | WB.pauldron;
  return { tabard: tab, armor, skin: Math.random() * 0.6, hair: Math.random(), mask, flags, scale: sc, outfit: M.outfit, emblem: 3, fem: 0, bulk };
}
function spawnMob(camp, elite = false) {
  const M = MOBS[camp.type];
  const lvl = elite ? camp.lmax + 1 : camp.lmin + Math.floor(Math.random() * (camp.lmax - camp.lmin + 1));
  const a = Math.random() * TAU, r = Math.random() * camp.r * (elite ? 0.4 : 1);
  let x = camp.x + Math.cos(a) * r, z = camp.z + Math.sin(a) * r;
  if (!isWalkable(x, z)) { x = camp.x; z = camp.z; }
  const name = elite ? pick(Math.random, ELITE_NAMES[camp.type]) : M.names[mobTier(M, lvl)];
  const sc = lerp(M.scale[0], M.scale[1], clamp((lvl - 1) / 19, 0, 1)) * (1 + 0.08 * clamp((lvl - 20) / 20, 0, 1)) * (elite ? 1.2 : 1);
  const e = makeEnt({
    kind: M.kind, faction: FACTION_MONSTER, role: 'mob', mobType: camp.type, level: lvl, name,
    x, z, y: heightAt(x, z), yaw: Math.random() * TAU, scale: sc, radius: M.radius, camp: camp.id,
    home: { x: camp.x, z: camp.z, r: camp.r },
    look: mobLook(M, camp.type, lvl, sc, elite),
    hover: M.kind === 'wisp' ? 1.6 : 0,
  });
  if (elite) { e.elite = true; e.properName = true; e.tweak = { hp: 2.8, dmg: 1.3 }; camp.eliteId = e.id; }
  setupStats(e);
  camp.members.add(e.id);
  return e;
}
function initCamps() {
  for (const c of W.camps) {
    const camp = { ...c, members: new Set(), respawnAt: [], eliteAt: 0, eliteId: null };
    CAMPS.push(camp);
    for (let i = 0; i < camp.count; i++) spawnMob(camp, camp.elite && i === 0);
  }
}
function villagerLook(realm) {
  const fem = Math.random() < 0.5 ? 1 : 0, r = Math.random;
  const dyes = [[0.55, 0.42, 0.28], [0.36, 0.42, 0.3], [0.5, 0.3, 0.24], [0.62, 0.56, 0.42], [0.32, 0.36, 0.46], [0.44, 0.24, 0.3]];
  return { tabard: pick(r, dyes), armor: [0.4, 0.33, 0.25], skin: r() * 0.8, hair: r(), mask: WB.skirt | WB.belt | hairAndBeard(r, fem, realm) | (fem && r() < 0.5 ? WB.robe : 0), flags: 0, scale: 0.9 + r() * 0.1, outfit: OUTFIT.villager, emblem: 3, fem, bulk: r() < 0.3 ? 0.35 : 0 };
}
function initTowns() {
  for (const R of REALMS) {
    const S = R.town;
    const hp = siteWorld(S, 3.5, 0, 9);
    const herald = makeEnt({ kind: 'humanoid', faction: FACTION_NEUTRAL, role: 'herald', cls: 'priest', level: 30, name: `${R.name} Herald`, x: hp.x, z: hp.z, y: heightAt(hp.x, hp.z), yaw: S.yaw + Math.PI, look: { ...classLook('priest', R.id, Math.random, 'herald'), mask: WB.cape | WB.staff | WB.robe | WB.tabard | WB.circlet | WB.belt | WB.hairShort | WB.beard, outfit: OUTFIT.herald }, radius: 0.5 });
    setupStats(herald);
    herald.ai.post = { x: hp.x, z: hp.z };
    R.herald = herald;
    for (let i = 0; i < 6; i++) {
      const a = Math.random() * TAU, rr = 6 + Math.random() * 12;
      const x = S.x + Math.cos(a) * rr, z = S.z + Math.sin(a) * rr;
      const v = makeEnt({ kind: 'humanoid', faction: FACTION_NEUTRAL, role: 'villager', level: 5, name: pick(Math.random, VILLAGER_NAMES), x, z, y: heightAt(x, z), look: villagerLook(R.id), home: { x: S.x, z: S.z, r: 20 }, speed: 2.2 });
      v.maxHp = v.hp = 300;
    }
    // muster wardens: very strong guards that keep the portal safe
    const M = R.musterSite;
    for (const [lx, lz] of [[-4.5, 15], [4.5, 15], [-4.5, -15], [4.5, -15]]) {
      const p = siteWorld(M, lx, 0, lz);
      const g = spawnRealmUnit(R.id, lz > 0 ? 'archer' : 'warrior', warUnitLevel('muster'), 'muster', p.x, p.z, { yaw: M.yaw + (lz > 0 ? 0 : Math.PI) });
      g.ai.post = { x: p.x, z: p.z, leash: 18 };
      g.name = `${R.name} Warden`;
    }
  }
}

/* ------------------------------------------------------------------ */
/* keeps, temples, relics                                              */
/* ------------------------------------------------------------------ */
function keepSlots(K) {
  const S = K.site, round = REALMS[K.orig].style === 'round';
  const wallY = round ? 6.2 : WALL_H;
  const walls = round
    ? [[-0.5, 16.3], [0.5, 16.3], [-1.6, 16.3], [1.6, 16.3]].map(([a, r]) => [Math.sin(a) * r, wallY, Math.cos(a) * r])
    : [[-8, WALL_H, KEEP_HS - 1.1], [8, WALL_H, KEEP_HS - 1.1], [-(KEEP_HS - 1.1), WALL_H, 3], [KEEP_HS - 1.1, WALL_H, 3]];
  const court = round ? [[-9, 0, 6], [9, 0, 6], [-10, 0, -6], [10, 0, -6]] : [[-9, 0, 8], [9, 0, 8], [-10, 0, -6], [10, 0, -6]];
  const lord = round ? [0, 0, 1.8] : [0, 0, -1.2];
  return { walls: castlePostSlots(K) || walls, court, lord }; // castles: posts up on the walks and tower tops (04g_castles.js)
}
function initWar() {
  for (const R of REALMS) {
    R.keepSites.forEach((S, k) => {
      const door = makeEnt({ kind: 'door', faction: R.id, role: 'door', name: `${S.name} gate`, level: warLevel() + 2, x: 0, z: 0, radius: 3.2 });
      const gp = siteWorld(S, 0, 0, S.gateLocal.z);
      door.x = gp.x; door.z = gp.z; door.y = S.y;
      door.maxHp = door.hp = DOOR_HP.keep * doorHpScale();
      S.door.owner = R.id;
      const K = { id: WAR.keeps.length, site: S, realm: R.id, orig: R.id, door, lord: null, guards: new Set(), nav: R.nav.k[k], underSiegeUntil: -99, lastEnemyNear: -99, nextGuardAt: 0, lastOwnerChange: -999, wantedBy: new Map() };
      door.keepRef = K;
      S.keepRef = K;
      K.slots = keepSlots(K);
      WAR.keeps.push(K);
      fillGarrison(K, true);
    });
    const S = R.templeSite;
    const door = makeEnt({ kind: 'door', faction: R.id, role: 'door', name: `${S.name} gate`, level: warLevel() + 2, x: 0, z: 0, radius: 3.4 });
    const gp = siteWorld(S, 0, 0, S.gateLocal.z);
    door.x = gp.x; door.z = gp.z; door.y = S.y;
    door.maxHp = door.hp = DOOR_HP.temple * doorHpScale();
    S.door.owner = R.id;
    const T = { id: WAR.temples.length, site: S, realm: R.id, door, guardians: new Set(), nav: R.nav, nextGuardAt: 0, lastEnemyNear: -99, exposedUntil: -99, underSiegeUntil: -99 };
    door.templeRef = T;
    S.templeRef = T;
    WAR.temples.push(T);
    fillGuardians(T, true);
    const relic = { id: R.id, realm: R.id, state: 'temple', at: R.id, carrier: null, x: 0, y: 0, z: 0, since: 0, from: R.id, mesh: relicMesh(R.id), slot: 'home' };
    scene.add(relic.mesh);
    WAR.relics.push(relic);
    WAR.commanders.push({ realm: R.id, nextThink: 2 + R.id, nextSpawn: 4 + R.id * 3 });
  }
  updateRelicBonuses();
}
function fillGarrison(K, all) {
  const R = K.realm, S = K.site;
  const lvl = warUnitLevel('guard');
  if (!K.lord || !getEnt(K.lord) || !getEnt(K.lord).alive) {
    const p = siteWorld(S, ...K.slots.lord);
    const L = spawnRealmUnit(R, 'warrior', warUnitLevel('lord'), 'lord', p.x, p.z, { yaw: S.yaw });
    L.name = `Lord ${L.name}`;
    L.ai.post = { x: p.x, z: p.z, leash: 12 };
    L.keep = K;
    K.lord = L.id;
    if (!all) return;
  }
  const need = [];
  K.slots.walls.slice(0, 3).forEach((s, i) => need.push({ slot: 'w' + i, pos: s, cls: 'archer', post: i }));
  K.slots.court.slice(0, 3).forEach((s, i) => need.push({ slot: 'c' + i, pos: s, cls: i === 2 ? 'priest' : 'warrior' }));
  const have = new Set([...K.guards].map((id) => getEnt(id)).filter((g) => g && g.alive).map((g) => g.ai.slot));
  for (const n of need) {
    if (have.has(n.slot)) continue;
    const p = siteWorld(S, n.pos[0], n.pos[1], n.pos[2]);
    // castles: wall archers stand on real walks; at the start they are at their posts, later ones walk up the stairs
    const wall = n.pos[1] > 0.5, route = wall ? castleRoute(K, n.post) : null;
    const from = wall && route && !all ? route[0] : p;
    const g = spawnRealmUnit(R, n.cls, lvl, 'guard', from.x, from.z, { yaw: S.yaw });
    if (wall) {
      g.tweak = { rangedRange: 36, dmg: 0.55, swing: 3.0 }; setupStats(g); g.ai.wall = true;
      if (!route) { g.fixedY = S.y + n.pos[1]; g.y = g.fixedY; } else if (all) g.y = route[route.length - 1].y; else { g.ai.route = route; g.ai.ri = 0; }
    }
    g.ai.post = { x: p.x, z: p.z, leash: wall ? 0 : 11 };
    g.ai.slot = n.slot;
    g.keep = K;
    K.guards.add(g.id);
    if (!all) return;
  }
}
function fillGuardians(T, all) {
  const S = T.site;
  const slots = [[-3.2, 2.5], [3.2, 2.5], [0, -5]];
  const have = new Set([...T.guardians].map((id) => getEnt(id)).filter((g) => g && g.alive).map((g) => g.ai.slot));
  let added = 0;
  slots.forEach(([lx, lz], i) => {
    if (have.has(i)) return;
    if (!all && added >= 1) return;
    added++;
    const p = siteWorld(S, lx, 0, lz);
    const g = spawnRealmUnit(T.realm, i < 2 ? 'warrior' : 'priest', warUnitLevel('guardian'), 'guardian', p.x, p.z, { yaw: S.yaw });
    g.name = `Hallow-warden ${g.name}`;
    g.ai.post = { x: p.x, z: p.z, leash: 9 };
    g.ai.slot = i;
    g.temple = T;
    T.guardians.add(g.id);
    have.add(i);
  });
}
function doorVulnerable(door) {
  if (door.templeRef) return templeExposed(door.templeRef);
  return true;
}
function templeExposed(T) { return GAME.t < T.exposedUntil || WAR.keeps.some((K) => K.orig === T.realm && K.realm !== T.realm); }
function setDoorState(door, alive, hpFrac = 1) {
  door.alive = alive;
  door.hp = alive ? door.maxHp * hpFrac : 0;
  const S = door.keepRef ? door.keepRef.site : door.templeRef.site;
  door.faction = door.keepRef ? door.keepRef.realm : door.templeRef.realm;
  if (S.door) { S.door.active = alive; S.door.owner = door.faction; }
  if (S.doorMesh) S.doorMesh.visible = alive;
  if (!alive) door.deadAt = GAME.t;
}
function relicSlotPos(T, slot) {
  const S = T.site;
  const bob = Math.sin(GAME.t * 1.4 + T.realm) * 0.08;
  if (slot === 'home') return siteWorld(S, 0, 2.55 + bob, -1);
  if (slot === 't0') return siteWorld(S, -4.5, 2.6 + bob, -1);
  return siteWorld(S, 4.5, 2.6 + bob, -1);
}
function relicPosition(rel) {
  if (rel.state === 'temple') return relicSlotPos(WAR.temples[rel.at], rel.slot);
  if (rel.state === 'carried') { const c = getEnt(rel.carrier); if (c) return { x: c.x, y: c.y + 2.6 * (c.scale || 1), z: c.z }; }
  return { x: rel.x, y: rel.y + 0.5 + Math.sin(GAME.t * 2) * 0.1, z: rel.z };
}
function updateRelicBonuses() {
  for (let r = 0; r < 3; r++) REALM_BONUS[r] = 1 + 0.1 * WAR.relics.filter((x) => x.state === 'temple' && x.at === r && x.realm !== r).length;
}
function freeTrophySlot(T) {
  const used = new Set(WAR.relics.filter((x) => x.state === 'temple' && x.at === T.realm).map((x) => x.slot));
  return !used.has('t0') ? 't0' : 't1';
}
function pickUpRelic(rel, e) {
  rel.state = 'carried';
  rel.carrier = e.id;
  rel.carrierRealm = e.faction;
  e.carrying = rel.id;
  e.casting = null;
  dismount(e);
  const R = REALMS[rel.realm], by = REALMS[e.faction];
  const fromName = rel.state === 'ground' ? '' : '';
  WAR.stats.seized++;
  news(`${by.name} has seized ${R.hallow}!`, e.faction, rel.realm === e.faction ? 'good' : 'big');
  if (e.role === 'player') uiToast(`You carry ${R.hallow}. Bring it to the ${by.templeName}.`, 'relic');
  sfx('horn');
  updateRelicBonuses();
}
function dropRelic(e) {
  const rel = WAR.relics[e.carrying];
  e.carrying = null;
  if (!rel) return;
  rel.state = 'ground';
  rel.carrier = null;
  rel.x = e.x; rel.z = e.z; rel.y = heightAt(e.x, e.z);
  rel.since = GAME.t;
  news(`${REALMS[rel.realm].hallow} has fallen to the ground near ${zoneAt(e.x, e.z).name}.`, rel.realm, 'big');
  updateRelicBonuses();
}
function deliverRelic(rel, e) {
  const T = WAR.temples[e.faction];
  e.carrying = null;
  rel.carrier = null;
  rel.state = 'temple';
  rel.at = T.realm;
  rel.from = T.realm;
  rel.slot = rel.realm === T.realm ? 'home' : freeTrophySlot(T);
  const R = REALMS[rel.realm], by = REALMS[e.faction];
  if (rel.realm === e.faction) news(`${by.name} has returned ${R.hallow} to the ${by.templeName}.`, e.faction, 'big');
  else { news(`${by.name} has placed ${R.hallow} in the ${by.templeName}! Its warriors grow stronger.`, e.faction, 'big'); WAR.stats.raids++; }
  if (e.role === 'player') { addRP(500); uiToast(`You delivered ${R.hallow}!`, 'relic'); flashScreen([1, 0.85, 0.4], 0.5); }
  else if (GAME.player && GAME.player.faction === e.faction && dist(GAME.player.x, GAME.player.z, e.x, e.z) < 60) addRP(150);
  sfx('fanfare');
  updateRelicBonuses();
  saveSoon();
}
function updateRelics(dt) {
  for (const rel of WAR.relics) {
    const p = relicPosition(rel);
    rel.mesh.position.set(p.x, p.y, p.z);
    rel.mesh.rotation.y += dt * 0.8;
    if (rel.state === 'carried') {
      const c = getEnt(rel.carrier);
      if (!c || !c.alive) { if (c) dropRelic(c); else { rel.state = 'ground'; rel.since = GAME.t; } continue; }
      const home = WAR.temples[c.faction].nav.tg;
      if (dist(c.x, c.z, home.x, home.z) < 6) deliverRelic(rel, c);
    } else if (rel.state === 'ground' && GAME.t - rel.since > 90) {
      rel.state = 'temple';
      rel.at = rel.from;
      const T = WAR.temples[rel.from];
      rel.slot = rel.realm === T.realm ? 'home' : freeTrophySlot(T);
      news(`${REALMS[rel.realm].hallow} has returned to the ${REALMS[T.realm].templeName}.`, rel.realm, 'normal');
      updateRelicBonuses();
    }
  }
}
// can entity e take this relic now?
function relicTakeable(rel, e) {
  if (!e.alive || e.faction > 2 || e.carrying != null) return false;
  if (rel.state === 'ground') return true;
  if (rel.state !== 'temple') return false;
  if (rel.at === e.faction) return false;
  const T = WAR.temples[rel.at];
  return !T.door.alive;
}

function captureKeep(K, realm, killer) {
  const old = K.realm;
  K.realm = realm;
  K.lastOwnerChange = GAME.t;
  K.underSiegeUntil = -99;
  WAR.stats.captures++;
  for (const id of K.guards) { const g = getEnt(id); if (g && g.alive) { g.alive = false; g.removeAt = GAME.t; } }
  K.guards.clear();
  const L = getEnt(K.lord);
  if (L && L.alive) { L.alive = false; L.removeAt = GAME.t; }
  K.lord = null;
  setDoorState(K.door, true, 0.5);
  setSiteBanners(K.site, realm);
  fillGarrison(K, false);
  K.nextGuardAt = GAME.t + 8;
  const S = K.site;
  for (let i = 0; i < 6; i++) later(i * 0.25, () => FX.burst(S.x + (Math.random() - 0.5) * 20, S.y + 10 + Math.random() * 6, S.z + (Math.random() - 0.5) * 20, 30, REALMS[realm].rgb.map((v) => v * 2 + 0.4), 7, 1.0, 0.25, 3));
  news(`${S.name} has been captured by ${REALMS[realm].name}!`, realm, 'big');
  if (GAME.player && GAME.player.faction === realm && dist(GAME.player.x, GAME.player.z, S.x, S.z) < 70) { addRP(250); }
  sfx('horn');
  saveSoon();
}

/* ------------------------------------------------------------------ */
/* entity death hooks                                                  */
/* ------------------------------------------------------------------ */
function onEntityKilled(e, killer) {
  if (e.siegeEngine) { siegeEngineKilled(e, killer); return; } // [siege] an engine hacked apart or burnt (04h_siege.js)
  if (e.role === 'boss') { onDragonDeath(e); return; }
  if (e.role === 'dungeonBoss') { onKingDeath(e, killer); return; }
  if (e.dunPack != null) { onBarrowMobDeath(e); return; }
  if (e.kind === 'door') {
    const S = e.keepRef ? e.keepRef.site : e.templeRef.site;
    if (S.door) S.door.active = false;
    if (S.doorMesh) S.doorMesh.visible = false;
    if (!e.burntDown) FX.splinters(e.x, e.y + 2, e.z); // [siege3] a burnt gate falls in as ash and embers (04g_blaze.js)
    sfx('crash');
    if (e.templeRef) WAR.stats.templeGates++;
    news(e.burntDown ? `The gate of ${S.name} has burnt down!` : `The gate of ${S.name} has been broken!`, killer ? killer.faction : -1, e.faction === (GAME.player && GAME.player.faction) ? 'alarm' : 'normal'); // [siege3]
    return;
  }
  if (e.role === 'lord' && e.keep) {
    const K = e.keep;
    const realm = killer && killer.faction <= 2 && killer.faction !== K.realm ? killer.faction : null;
    if (realm !== null) captureKeep(K, realm, killer);
    else K.lord = null;
    return;
  }
  if (e.role === 'guard' && e.keep) { e.keep.guards.delete(e.id); return; }
  if (e.role === 'guardian' && e.temple) { e.temple.guardians.delete(e.id); return; }
  if (e.role === 'mob' && e.camp != null) {
    const camp = CAMPS[e.camp];
    camp.members.delete(e.id);
    // a champion takes longer to come back than its followers
    if (e.elite) { camp.eliteId = null; camp.eliteAt = GAME.t + 300 + Math.random() * 120; news(`${e.name} has fallen in the borderlands of ${REALMS[camp.realm].name}.`, killer ? killer.faction : -1); }
    else camp.respawnAt.push(GAME.t + 45 + Math.random() * 30);
    return;
  }
  if (e.role === 'player') onPlayerDeath(killer);
}

/* ------------------------------------------------------------------ */
/* targeting                                                           */
/* ------------------------------------------------------------------ */
function canReach(e, t) {
  // [v12] a foe this body chased and could not get any nearer to (behind a wall, in a tower room, over water) is left
  // alone a while, so it does not stand at the wall with its sword up for the rest of the war
  const ur = e.ai && e.ai.unreach;
  if (ur && GAME.t < ur.get(t.id)) return false;
  // melee units cannot reach archers standing on walls
  if (!e.rangedKind && t.fixedY !== null && t.fixedY > groundY(e) + 2) return false;
  if (!castleCanReach(e, t)) return false; // castles: melee climbs the stairs, or cannot reach (04g_castles.js)
  return true;
}
// can e see o? walls block fights on the ground; archers on walls see over them
function inSight(e, o) {
  if (towerSightBlocked(e, o)) return false; // [keeps] a tower's floors, shut hatches and walls (04m_ladders.js)
  if (e.fixedY !== null || o.fixedY !== null || elevatedEnt(e) || elevatedEnt(o)) return true;
  return segmentClear(e.x, e.z, o.x, o.z, 0.15, false);
}
const _cands = [];
function pickTarget(e, radius, clearOnly = false) { // [walls] clearOnly: only a foe a bow or a staff can strike (07g_walls.js)
  _cands.length = 0;
  forNear(e.x, e.z, radius, (o, d2) => {
    if (!o.alive || !isEnemy(e, o) || o === e) return;
    if (o.kind === 'door') return;
    if (!canReach(e, o)) return;
    if (!classSeen(e, o, d2)) return; // [classes] a hidden archer is seen only close by
    let s = d2;
    if (e.threat && e.threat.has(o.id)) s -= e.threat.get(o.id) * 4;
    if (o.role === 'player') s *= 0.85;
    if (o.carrying != null) s *= 0.4;
    _cands.push([s, o]);
  });
  if (!_cands.length) return null;
  _cands.sort((a, b) => a[0] - b[0]);
  // [walls] a bow, a wand or a staff takes the first of them it can strike, not one behind a wall or a breastwork
  // (07g_walls.js); with none clear, the first in sight as before
  let first = null;
  for (let i = 0; i < Math.min(3, _cands.length); i++) {
    const o = _cands[i][1];
    if (!inSight(e, o)) continue;
    if (!e.rangedKind || wallsShotClear(e, o, e.rangedKind === 'arrow', false)) return o;
    if (!first) first = o;
  }
  return clearOnly ? null : first;
}
function topThreat(e) {
  if (!e.threat) return null;
  let best = null, bv = 0;
  for (const [id, v] of e.threat) {
    const o = getEnt(id);
    if (!o || !o.alive) { e.threat.delete(id); continue; }
    if (v > bv) { bv = v; best = o; }
  }
  return best;
}

/* combat behaviour shared by soldiers, guards and the player's allies */
function fightTarget(e, t, dt, opts = {}) {
  const d = dist(e.x, e.z, t.x, t.z);
  const tr = t.radius * (t.scale || 1);
  e.target = t.id;
  const C = e.cls;
  // healers look after their side first
  if (C === 'priest' && e.ai.healCheck !== undefined) { /* handled in priestThink */ }
  if (e.rangedKind && t.kind !== 'door') {
    if (wallsSeekLine(e, t, null, dt)) return; // [siege2] its shot held: to a place with a line to its foe, back from the wall or aside (07h_lines.js)
    const want = Math.min(e.rangedRange - 4, 24);
    const walled = e.fixedY === null && e.ai && GAME.t - (e.ai.wallShot ?? -9) < 2.5 && d > 2.5; // [walls] its last shot struck a wall: close in (07g_walls.js)
    const under = walled && elevatedEnt(t) && !elevatedEnt(e); // [walls] a foe up behind a breastwork: stand off where its crenel shows, not under the wall
    if (under && d < Math.min(e.rangedRange - 4, 20) && !e.casting) moveToward(e, e.x - ((t.x - e.x) / d) * 4, e.z - ((t.z - e.z) / d) * 4, dt, 0.9, 0);
    else if ((d > e.rangedRange - 1 || (walled && !under)) && !e.casting) moveToward(e, t.x, t.z, dt, 1, 0);
    else if (d < 6 && !e.casting && e.fixedY === null && Math.random() < 0.6) {
      const ax = e.x - (t.x - e.x) / d * 3, az = e.z - (t.z - e.z) / d * 3;
      moveToward(e, ax, az, dt, 0.8, 0.1);
    } else turnToward(e, t.x, t.z, dt * 10);
  } else {
    if (castleClimbToward(e, t, dt)) return; // castles: up the stairs after a foe on the walls (04g_castles.js)
    const reach = (e.rangedKind ? e.rangedRange : e.meleeRange * (e.scale || 1)) + tr - 0.4;
    if (d > reach && !e.casting) { moveToward(e, t.x, t.z, dt, 1, reach * 0.9); fightChase(e, t, d); }
    else { turnToward(e, t.x, t.z, dt * 10); if (e.ai) e.ai.chase = null; }
  }
}
// [v12] a chase that gets no nearer in six seconds is given up, and that foe left alone for twenty (canReach)
function fightChase(e, t, d) {
  if (!e.ai || e.role === 'player') return;
  const c = e.ai.chase;
  if (!c || c.id !== t.id) { e.ai.chase = { id: t.id, d, t: GAME.t }; return; }
  if (c.d - d > 1) { c.d = d; c.t = GAME.t; return; }
  if (GAME.t - c.t > 6) {
    if (!e.ai.unreach) e.ai.unreach = new Map();
    const ur = e.ai.unreach;
    for (const [id, u] of ur) if (u < GAME.t) ur.delete(id);
    ur.set(t.id, GAME.t + 20);
    e.ai.chase = null; e.target = null;
    if (e.threat) e.threat.delete(t.id);
    WAR.stats.chasesDropped = (WAR.stats.chasesDropped || 0) + 1;
  }
}
function npcAbilities(e, t) {
  if (!e.cls || e.casting || GAME.t < (e.ai.nextAbility || 0)) return;
  e.ai.nextAbility = GAME.t + 1.2 + Math.random() * 1.6;
  if (classNpc(e, t)) return; // [classes] stances and finishers, draws and snares, elemental combos, holy ground and raising (07b_classes.js)
  const list = CLASSES[e.cls].abilities.filter((k) => ABILITIES[k].level <= e.level);
  // priests: heal the weakest ally first
  if (e.cls === 'priest') {
    let weak = null, wf = 0.62;
    forNear(e.x, e.z, 28, (o) => { if (o.alive && o.faction === e.faction && isActor(o) && o.hp / o.maxHp < wf) { wf = o.hp / o.maxHp; weak = o; } });
    if (weak) {
      if (wf < 0.4 && !canUse(e, 'mend', weak)) { useAbility(e, 'mend', weak); return; }
      if (!hasBuff(weak, 'hot') && !canUse(e, 'renew', weak)) { useAbility(e, 'renew', weak); return; }
      if (!canUse(e, 'mend', weak)) { useAbility(e, 'mend', weak); return; }
    }
  }
  if (!t || !t.alive || t.kind === 'door') return;
  const order = shuffle(Math.random, list.slice());
  for (const k of order) {
    const A = ABILITIES[k];
    if (A.self) {
      if (k === 'rally' && e.hp / e.maxHp > 0.6) continue;
      if (k === 'bulwark' && e.hp / e.maxHp > 0.5) continue;
      if (k === 'ward' && e.hp / e.maxHp > 0.7) continue;
      if (k === 'blink' || k === 'tumble') continue;
      if (k === 'nova' && dist(e.x, e.z, t.x, t.z) > 6) continue;
      if (k === 'sanctuary') continue;
      if (k === 'whirl' && !nearestWhere(e.x, e.z, A.spin, (o) => o.alive && isEnemy(e, o) && isActor(o))) continue;
      if (k === 'massrenew' && !nearestWhere(e.x, e.z, A.radius, (o) => o.alive && o.faction === e.faction && isActor(o) && o.hp / o.maxHp < 0.7)) continue;
    }
    if (k === 'leap' && (e.fixedY !== null || e.ai.post)) continue;
    if (A.friendly) continue;
    if (!canUse(e, k, t)) {
      if (A.proj && (wallsHeld(e, t) || !wallsShotClear(e, t, false))) { e.ai.wallShot = GAME.t; continue; } // [walls] not into a wall (07g_walls.js); [siege2] nor looked at again while held (07h_lines.js)
      useAbility(e, k, t); return;
    }
  }
}

/* ------------------------------------------------------------------ */
/* per-role thinking                                                   */
/* ------------------------------------------------------------------ */
function thinkMob(e, dt) {
  const M = MOBS[e.mobType];
  const ai = e.ai;
  if (ai.tameHold > GAME.t) return; // [animals] eating from the player's hand (08h_animals.js)
  if (ai.evade) {
    e.target = null;
    e.hp = Math.min(e.maxHp, e.hp + e.maxHp * dt * 0.5);
    if (moveToward(e, e.home.x, e.home.z, dt, 1.25, 1.5)) { ai.evade = false; e.threat = null; e.damagers = null; }
    return;
  }
  let t = getEnt(e.target);
  if (t && (!t.alive || !isEnemy(e, t))) { t = null; e.target = null; }
  const top = topThreat(e);
  if (top) t = top;
  if (!t && M.aggro > 0 && GAME.t > (ai.nextAggro || 0)) {
    ai.nextAggro = GAME.t + 0.5;
    t = nearestWhere(e.x, e.z, M.aggro, (o) => o.alive && o.faction <= 2 && isActor(o) && (o.role !== 'player' || conIndex(e.level, o.level) > 0) && classSeen(e, o, dist2(e.x, e.z, o.x, o.z))); // [classes] hidden archers
    if (t) { e.threat = e.threat || new Map(); e.threat.set(t.id, 1); }
  }
  if (t) {
    if (dist(e.x, e.z, e.home.x, e.home.z) > 42) { ai.evade = true; e.target = null; return; }
    if (!ai.pulled) { ai.pulled = true; socialAggro(e, t); }
    fightTarget(e, t, dt);
    return;
  }
  ai.pulled = false;
  // idle wandering inside the camp
  if (!ai.wander || GAME.t > ai.wanderUntil) {
    const a = Math.random() * TAU, r = Math.random() * e.home.r;
    ai.wander = { x: e.home.x + Math.cos(a) * r, z: e.home.z + Math.sin(a) * r };
    ai.wanderUntil = GAME.t + 4 + Math.random() * 8;
  }
  if (e.hp < e.maxHp && GAME.t > e.combatUntil) e.hp = Math.min(e.maxHp, e.hp + e.maxHp * dt * 0.08);
  moveToward(e, ai.wander.x, ai.wander.z, dt, 0.3, 0.5);
}
function socialAggro(e, t) {
  // pack animals bring at most one friend; bandits and the dead bring two
  const camp = CAMPS[e.camp];
  if (!camp) return;
  const M = MOBS[e.mobType];
  const max = M.aggro > 0 ? 2 : Math.random() < 0.45 ? 1 : 0;
  const near = [];
  for (const id of camp.members) {
    const o = getEnt(id);
    if (!o || o === e || !o.alive || o.ai.evade || (o.threat && o.threat.has(t.id))) continue;
    const d2 = dist2(o.x, o.z, e.x, e.z);
    if (d2 < 10 * 10) near.push([d2, o]);
  }
  near.sort((a, b) => a[0] - b[0]);
  for (const [, o] of near.slice(0, max)) { o.threat = o.threat || new Map(); o.threat.set(t.id, 0.5); o.ai.pulled = true; }
}
function thinkVillager(e, dt) {
  if (houseLife(e, dt)) return; // townsfolk keep house (08f_townlife.js)
  const ai = e.ai;
  if (e.role === 'merchant') {
    const P = GAME.player;
    if (P && dist(P.x, P.z, e.x, e.z) < 9) turnToward(e, P.x, P.z, dt * 3);
    else e.yaw += clamp(angDiff(e.yaw, ai.post.yaw), -dt * 2, dt * 2);
    return;
  }
  if (e.role === 'herald') { if (ai.post) moveToward(e, ai.post.x, ai.post.z, dt, 0.4, 0.3); const P = GAME.player; if (P && dist(P.x, P.z, e.x, e.z) < 8) turnToward(e, P.x, P.z, dt * 3); return; }
  if (!ai.wander || GAME.t > ai.wanderUntil) {
    const a = Math.random() * TAU, r = 4 + Math.random() * e.home.r;
    ai.wander = { x: e.home.x + Math.cos(a) * r, z: e.home.z + Math.sin(a) * r };
    ai.wanderUntil = GAME.t + 6 + Math.random() * 10;
  }
  moveToward(e, ai.wander.x, ai.wander.z, dt, 1, 0.6);
}
function thinkPosted(e, dt, aggroR) {
  // garrison troops: hold a post, fight what comes near, never wander off. A soldier whose band is gone (one raised by
  // a priest after the rest fell, say) holds where it stands.
  const post = e.ai.post || (e.ai.post = { x: e.x, z: e.z, leash: 14 });
  if (e.ai.fire && blazeFightStep(e, dt)) return; // [siege3] beating out a fire on its walls (04g_blaze.js)
  if (e.ai.route && castleFollow(e, dt)) return; // castles: up the stairs to a wall post (04g_castles.js)
  if ((e.ai.plug || e.ai.sally) && siegePostedThink(e, dt)) return; // [siege] holding a breach, or out on a sally (04h_siege.js)
  let t = getEnt(e.target);
  if (t && (!t.alive || !isEnemy(e, t) || dist(t.x, t.z, post.x, post.z) > aggroR + 8 || !canReach(e, t))) { t = null; e.target = null; }
  if (!t && GAME.t > (e.ai.nextScan || 0)) {
    e.ai.nextScan = GAME.t + 0.4 + Math.random() * 0.3;
    t = topThreat(e);
    if (t && dist(t.x, t.z, post.x, post.z) > aggroR + 8) t = null;
    if (t && e.rangedKind && !wallsShotClear(e, t, e.rangedKind === 'arrow', false)) t = pickTarget(e, aggroR, true) || t; // [walls] one it can strike first (07g_walls.js)
    if (!t) t = pickTarget(e, aggroR);
  }
  if (e.cls === 'priest' || (t && t.alive)) npcAbilities(e, t);
  if (t) {
    if (e.fixedY !== null || post.leash === 0) {
      e.target = t.id; turnToward(e, t.x, t.z, dt * 10);
      if (e.ai.wall && e.fixedY === null && GAME.t - (e.ai.wallShot ?? -9) < 2) { if (!wallsSeekLine(e, t, post, dt)) wallsStepToCrenel(e, t, post, dt); } // [walls] up to the crenel facing its foe (07g_walls.js); [siege2] or the crenel, slit or edge with a line to it (07h_lines.js)
      return;
    }
    const far = dist(e.x, e.z, post.x, post.z) > post.leash;
    if (far && dist(t.x, t.z, post.x, post.z) > post.leash) { e.target = null; moveToward(e, post.x, post.z, dt, 1, 0.5); return; }
    fightTarget(e, t, dt);
    return;
  }
  e.target = null;
  if (e.hp < e.maxHp && GAME.t > e.combatUntil + 4) e.hp = Math.min(e.maxHp, e.hp + e.maxHp * dt * 0.05);
  if (e.fixedY === null) moveToward(e, post.x, post.z, dt, 0.6, 0.4);
}

/* ------------------------------------------------------------------ */
/* warbands                                                            */
/* ------------------------------------------------------------------ */
const WB_CLASSES = ['warrior', 'warrior', 'warrior', 'archer', 'archer', 'mage', 'priest', 'warrior', 'archer', 'priest', 'mage', 'warrior'];
function spawnWarband(realm, size) {
  const R = REALMS[realm], M = R.musterSite;
  const wb = { id: WAR.nextWb++, realm, members: [], order: null, path: null, pathIdx: 0, created: GAME.t, engagedUntil: -99, lastProgress: GAME.t, progX: M.x, progZ: M.z };
  for (let i = 0; i < size; i++) {
    const cls = WB_CLASSES[i % WB_CLASSES.length];
    const a = (i / size) * TAU, r = 3 + Math.random() * 4;
    const x = M.x + Math.cos(a) * r, z = M.z + Math.sin(a) * r;
    const e = spawnRealmUnit(realm, cls, warUnitLevel('soldier'), 'soldier', x, z);
    e.warband = wb;
    wb.members.push(e.id);
  }
  WAR.warbands.push(wb);
  return wb;
}
function wbMembers(wb) { return wb.members.map(getEnt).filter((e) => e && e.alive); }
function wbLeader(wb) {
  const m = wbMembers(wb);
  if (!m.length) return null;
  // prefer the relic carrier as the leader so the band escorts it
  const carrier = m.find((e) => e.carrying != null);
  if (carrier) return carrier;
  // [campaign] the same leader while it lives; when it falls, the soldier nearest to where it led takes
  // over, so a band at a siege is not led away by a straggler far behind (08g_campaign.js)
  let L = m.find((e) => e.id === wb.lid);
  if (!L) { const p = wb.L || m[0]; L = m.reduce((a, e) => (dist2(e.x, e.z, p.x, p.z) < dist2(a.x, a.z, p.x, p.z) ? e : a), m[0]); wb.lid = L.id; }
  return L;
}
function wbSetOrder(wb, order) {
  if (order.type === 'raid') WAR.stats.raidOrders++;
  wb.order = order;
  wb.order.phase = 'travel';
  wb.path = null;
  wb.pathIdx = 0;
  wb.lastProgress = GAME.t;
  const L = wbLeader(wb);
  if (L) { wb.progX = L.x; wb.progZ = L.z; }
  announceOrder(wb, wb.order); // [campaign] every order is cried in the news (08g_campaign.js)
}
function doorOpenFor(wb) {
  return (a, b) => {
    // a door edge may be walked once that gate is broken, and always by the realm that holds it
    for (const K of WAR.keeps) if ((K.nav.gate.id === a && K.nav.court.id === b) || (K.nav.gate.id === b && K.nav.court.id === a)) return !K.door.alive || K.realm === wb.realm;
    for (const T of WAR.temples) if ((T.nav.tg.id === a && T.nav.tc.id === b) || (T.nav.tg.id === b && T.nav.tc.id === a)) return !T.door.alive || T.realm === wb.realm;
    return false;
  };
}
function wbPlan(wb, goalNode) {
  const L = wbLeader(wb);
  if (!L) return;
  const start = nearestNavNode(L.x, L.z, null, true);
  const path = navPath(start.id, goalNode.id, doorOpenFor(wb));
  wb.path = path || [goalNode.id];
  wb.pathIdx = 0;
  wb.goal = goalNode.id;
}
function wbEnemiesNear(wb, x, z, r) {
  // enemies on walls or behind them do not hold the band in place
  let n = 0;
  forNear(x, z, r, (o) => {
    if (n || !o.alive || o.faction > 3 || o.faction === wb.realm || !isActor(o) || o.fixedY !== null || elevatedEnt(o)) return;
    if (segmentClear(x, z, o.x, o.z, 0.2, false)) n++;
  });
  return n;
}
function updateWarband(wb, dt) {
  const members = wbMembers(wb);
  if (!members.length) { wb.dead = true; if (wb.order && wb.order.type === 'raid') WAR.stats.raidWiped++; return; }
  const L = wbLeader(wb);
  const O = wb.order;
  if (!O) return;
  // keep a record of progress so a stuck band can be nudged
  if (dist(L.x, L.z, wb.progX, wb.progZ) > 6) { wb.progX = L.x; wb.progZ = L.z; wb.lastProgress = GAME.t; wb.realProgress = GAME.t; }
  // footsteps for the rest of the band to follow
  if (!wb.trail) { wb.trail = [{ x: L.x, z: L.z }]; wb.trailBase = 0; }
  const lastStep = wb.trail[wb.trail.length - 1];
  if (dist(L.x, L.z, lastStep.x, lastStep.z) > 2.5) {
    wb.trail.push({ x: L.x, z: L.z });
    if (wb.trail.length > 90) { wb.trail.shift(); wb.trailBase++; }
  }
  // engagement: any enemy near the leader holds the band in place
  if (GAME.t > (wb.nextEngageCheck || 0)) {
    wb.nextEngageCheck = GAME.t + 0.4;
    if (wbEnemiesNear(wb, L.x, L.z, 24) > 0) wb.engagedUntil = GAME.t + 2.5;
  }
  const engaged = GAME.t < wb.engagedUntil;

  let goal = null;
  if (O.type === 'attack' || O.type === 'defend') {
    const K = O.keep;
    if (O.type === 'attack' && K.realm === wb.realm) {
      if (O.phase !== 'hold') { O.phase = 'hold'; O.holdUntil = GAME.t + 35; wbPlan(wb, K.nav.court); }
      if (GAME.t > O.holdUntil) { wb.order = null; return; }
      goal = K.nav.court;
    } else if (O.type === 'defend' && (K.realm !== wb.realm || (GAME.t > K.underSiegeUntil + 15 && GAME.t > O.since + 30))) { wb.order = null; return; }
    else {
      if (O.phase === 'travel' && K.realm !== wb.realm && dist(L.x, L.z, K.nav.gate.x, K.nav.gate.z) < 16) O.phase = 'siege';
      if (O.phase === 'siege' && !K.door.alive) { O.phase = 'assault'; wbPlan(wb, K.nav.court); }
      if (O.phase === 'assault' && K.door.alive) { O.phase = 'siege'; wbPlan(wb, K.nav.gate); }
      goal = O.phase === 'assault' ? K.nav.court : K.nav.gate;
    }
  } else if (O.type === 'raid') {
    const T = O.temple;
    const rel = O.relic;
    if (!rel || rel.state !== 'temple' || rel.at !== T.realm) { wb.order = null; return; }
    if (!templeExposed(T) && T.door.alive) { WAR.stats.raidAborts++; wb.order = null; return; }
    if (O.phase === 'travel' && dist(L.x, L.z, T.nav.tg.x, T.nav.tg.z) < 16) { O.phase = 'siege'; WAR.stats.raidSieges++; }
    if (O.phase === 'siege' && !T.door.alive) { O.phase = 'assault'; wbPlan(wb, T.nav.tc); }
    goal = O.phase === 'assault' ? T.nav.tc : T.nav.tg;
    if (O.phase === 'assault') {
      const rp = relicPosition(rel);
      const grabber = members.filter((m) => m.cls !== 'priest').sort((a, b) => dist2(a.x, a.z, rp.x, rp.z) - dist2(b.x, b.z, rp.x, rp.z))[0];
      if (grabber && dist(grabber.x, grabber.z, rp.x, rp.z) < 3.2 && relicTakeable(rel, grabber)) {
        O.grabT = (O.grabT || 0) + dt;
        grabber.casting = null;
        if (O.grabT > 2.5) {
          pickUpRelic(rel, grabber);
          wbSetOrder(wb, { type: 'carry', relic: rel });
          return;
        }
      } else O.grabT = 0;
    }
  } else if (O.type === 'carry') {
    const rel = O.relic;
    if (rel.state !== 'carried' || getEnt(rel.carrier)?.warband !== wb) {
      if (rel.state === 'ground') { wbSetOrder(wb, { type: 'retrieve', relic: rel }); return; }
      wb.order = null; return;
    }
    goal = WAR.temples[wb.realm].nav.tg;
  } else if (O.type === 'retrieve') {
    // pick up a hallow from the ground, or run down an enemy carrying ours
    const rel = O.relic;
    let px, pz;
    if (rel.state === 'ground') { px = rel.x; pz = rel.z; }
    else if (rel.state === 'carried') {
      const c = getEnt(rel.carrier);
      if (!c || !c.alive || c.faction === wb.realm) { wb.order = null; return; }
      px = c.x; pz = c.z;
    } else { wb.order = null; return; }
    if (rel.state === 'ground') {
      const grab = members.sort((a, b) => dist2(a.x, a.z, rel.x, rel.z) - dist2(b.x, b.z, rel.x, rel.z))[0];
      if (grab && dist(grab.x, grab.z, rel.x, rel.z) < 2.5) { pickUpRelic(rel, grab); wbSetOrder(wb, { type: 'carry', relic: rel }); return; }
    }
    O.point = { x: px, z: pz };
    if (GAME.t > (O.replanAt || 0)) {
      O.replanAt = GAME.t + 4;
      const n = nearestNavNode(px, pz, null, true);
      if (n && wb.goal !== n.id) wbPlan(wb, n);
    }
  } else if (O.type === 'rally') {
    // [campaign] the player called this band to their side (08g_campaign.js)
    if (!rallyPoint(wb, O, L)) { wb.order = null; return; }
  } else if (O.type === 'patrol') {
    if (GAME.t > O.until) { wb.order = null; return; }
    goal = O.node;
  }
  if (goal && wb.goal !== goal.id) wbPlan(wb, goal);
  // stuck for a long time: replan from wherever the leader is
  if (GAME.t - wb.lastProgress > 25 && !engaged) { if (goal) wbPlan(wb, goal); wb.lastProgress = GAME.t; wb.replans = (wb.replans || 0) + 1; }
  // [v12] and a band that has got nowhere for two and a half minutes, replans or no (held by foes it cannot reach, at a
  // breach it cannot climb, before a wall), gives the order back for a new one: the war never stands still. Waiting
  // is no stall: holding a keep it took, by its engine while it works, or defending its own keep.
  if (GAME.t - (wb.hitAt ?? -1e9) < 20) wb.realProgress = GAME.t; // (blows that land are progress too: a gate being battered)
  if (GAME.t - (wb.realProgress ?? (wb.realProgress = GAME.t)) > 150) {
    const waiting = O.phase === 'hold' || O.type === 'defend' || O.type === 'patrol' || (O.phase === 'bombard' && O.bombSince !== undefined);
    wb.realProgress = GAME.t;
    if (!waiting) {
      WAR.stats.bandStalls = (WAR.stats.bandStalls || 0) + 1;
      for (const m of members) { m.target = null; if (m.ai) m.ai.chase = null; }
      wb.order = null; wb.replans = 0;
      return;
    }
  }

  // leader movement
  let tx = L.x, tz = L.z;
  if ((O.type === 'retrieve' || O.type === 'rally') && O.point) { // [campaign] rally walks like retrieve
    if (wb.path && wb.pathIdx < wb.path.length - 1) { const n = NAV.nodes[wb.path[wb.pathIdx]]; if (dist(L.x, L.z, n.x, n.z) < 3.5) wb.pathIdx++; } // [campaign] walk on along the path
    const lastNode = wb.path && wb.path.length ? NAV.nodes[wb.path[Math.min(wb.pathIdx, wb.path.length - 1)]] : null;
    if (!wb.path || !wb.path.length || wb.pathIdx >= wb.path.length || segmentClear(L.x, L.z, O.point.x, O.point.z, 0.4)) { tx = O.point.x; tz = O.point.z; }
    else if (lastNode) { tx = lastNode.x; tz = lastNode.z; }
    if (!wb.path) { const n = nearestNavNode(O.point.x, O.point.z, null, true); wbPlan(wb, n); }
  } else if (wb.path && wb.pathIdx < wb.path.length) {
    const n = NAV.nodes[wb.path[wb.pathIdx]];
    tx = n.x; tz = n.z;
    if (dist(L.x, L.z, n.x, n.z) < 3.5 && wb.pathIdx < wb.path.length - 1) wb.pathIdx++;
  } else if (goal) { tx = goal.x; tz = goal.z; }
  wb.leaderGoal = { x: tx, z: tz };
  wb.engaged = engaged;
  wb.L = L;
  siegeBandAfter(wb, L, O); // [siege] engines, breaches, and where the leader stands while they work (04h_siege.js)
}
function thinkSoldier(e, dt) {
  const wb = e.warband;
  if (!wb || wb.dead) { e.warband = null; thinkPosted(e, dt, 24); return; }
  const L = wb.L || wbLeader(wb);
  const O = wb.order;
  // carriers run home, they do not fight
  if (e.carrying != null) {
    e.target = null;
    if (wb.leaderGoal) moveToward(e, wb.leaderGoal.x, wb.leaderGoal.z, dt, 1, 0.5);
    return;
  }
  if (e.siegeCrew && siegeCrewThink(e, dt)) return; // [siege] working a siege engine (04h_siege.js)
  if (e.hallowRun && siegeHallowRun(e, dt)) return; // [siege] campaign tuning: a raider runs for the hallow (04h_siege.js)
  if (e.ai.storm && siegeStormStep(e, dt)) return; // [siege2] storming a fallen tower: its own way in, one or two at a time (04i_siege2.js)
  // [campaign] a band called to the player's side: its leader breaks off any fight and goes, and the
  // rest follow once their foes are left behind (08g_campaign.js)
  if (O && O.type === 'rally' && e === L && wb.leaderGoal && O.point && dist(e.x, e.z, O.point.x, O.point.z) > 12) {
    e.target = null; e.casting = null;
    moveToward(e, wb.leaderGoal.x, wb.leaderGoal.z, dt, 1, 0.8);
    return;
  }
  let t = getEnt(e.target);
  const anchor = L || e;
  const leash = O && O.type === 'carry' ? 14 : 40; // [siege] tuning: a hallow's escort stays by its bearer instead of giving chase
  if (t && (!t.alive || !isEnemy(e, t) || dist(t.x, t.z, anchor.x, anchor.z) > leash || !canReach(e, t))) { t = null; e.target = null; }
  // [v13] a gate struck under an old order is left once the band is sent elsewhere (a band at a gate given a new order
  // by the player or its commander kept striking that gate until it died there: the order never moved it)
  if (t && t.kind === 'door' && !t.siegeEngine && !(O && O.phase === 'siege' && t === (O.keep ? O.keep.door : O.temple ? O.temple.door : null))) { t = null; e.target = null; }
  if (GAME.t > (e.ai.nextScan || 0)) {
    e.ai.nextScan = GAME.t + 0.35 + Math.random() * 0.3;
    let cand = topThreat(e);
    if (cand && (!canReach(e, cand) || dist(cand.x, cand.z, anchor.x, anchor.z) > Math.min(36, leash) || !inSight(e, cand))) cand = null;
    if (cand && e.rangedKind && !wallsShotClear(e, cand, e.rangedKind === 'arrow', false)) cand = pickTarget(e, 30, true) || cand; // [walls] one it can strike first (07g_walls.js)
    if (!cand) cand = pickTarget(e, e.rangedKind ? 30 : 22);
    if (cand && dist(cand.x, cand.z, anchor.x, anchor.z) < Math.min(36, leash)) t = cand;
    else if ((!t || t.kind === 'door') && O && O.type === 'defend' && (t = siegeFoeEngine(e, O))) { /* [siege] defenders go for the engines before their walls (04h_siege.js) */ if (e.rangedKind && !wallsShotClear(e, t, e.rangedKind === 'arrow', false)) t = null; /* [walls] not a bow's or a staff's through their own wall (07g_walls.js) */ }
    // sieges: with nothing better to hit, strike the gate
    else if ((!t || t.kind === 'door') && O && O.phase === 'siege') {
      const door = O.keep ? O.keep.door : O.temple ? O.temple.door : null;
      t = door && door.alive && isEnemy(e, door) && doorVulnerable(door) ? door : null;
    }
  }
  if (e.cls === 'priest' || t) npcAbilities(e, t && t.alive ? t : null);
  if (t) { if (e.mount) { dismount(e); e.ai.remountAt = GAME.t + 12; } fightTarget(e, t, dt); return; }
  e.target = null;
  if (!L) return;
  // [siege] siegeLikePhase: the gate, the court, a breach, or standing by the engines (04h_siege.js)
  if (e === L && !e.mount && !wb.engaged && GAME.t > (e.ai.remountAt || 0) && !siegeLikePhase(O)) mountUp(e, true);
  if (e === L && e.mount && (wb.engaged || siegeLikePhase(O))) { dismount(e); e.ai.remountAt = GAME.t + 15; }
  if (e === L) { if (wb.leaderGoal && (!wb.engaged || siegeLikePhase(O))) moveToward(e, wb.leaderGoal.x, wb.leaderGoal.z, dt, 0.92, 0.8); return; }
  // formation behind the leader
  const k = wb.members.indexOf(e.id);
  const row = Math.floor(k / 3) + 1, col = (k % 3) - 1;
  const c = Math.cos(L.yaw), s = Math.sin(L.yaw);
  const ox = col * 2.4, oz = -row * 2.4;
  const fx = L.x + ox * c + oz * s, fz = L.z - ox * s + oz * c;
  const d = dist(e.x, e.z, fx, fz);
  if (d > 6) {
    if (GAME.t > (e.ai.losCheck || 0)) { e.ai.losCheck = GAME.t + 0.6; e.ai.blocked = !segmentClear(e.x, e.z, L.x, L.z, 0.3, false); }
  } else e.ai.blocked = false;
  if (e.ai.blocked && wb.trail && wb.trail.length > 1 && followTrail(e, wb, dt)) return;
  const sl = bandSlot(e, L, fx, fz); // [siege3] a place nobody can stand in (rubble, a fallen drum) moved toward the leader (04i_siege3.js)
  if (bandUnstick(e, wb, L, sl.x, sl.z, dt)) return; // [siege3] pressed against something: along the leader's footsteps, a step aside
  e.ai.trailAbs = undefined;
  moveToward(e, sl.x, sl.z, dt, d > 10 ? 1.15 : d > 3 ? 1.0 : 0.6, 0.6);
}
// walk the leader's recent footsteps (used when a wall or palisade is in the way)
function followTrail(e, wb, dt) {
  const base = wb.trailBase || 0, T = wb.trail;
  let i = e.ai.trailAbs;
  if (i === undefined || i < base || i >= base + T.length) {
    // the nearest footstep this unit can walk to in a straight line
    const order = T.map((p, j) => [dist2(e.x, e.z, p.x, p.z), j]).sort((a, b) => a[0] - b[0]);
    i = -1;
    for (let q = 0; q < Math.min(8, order.length); q++) { const p = T[order[q][1]]; if (segmentClear(e.x, e.z, p.x, p.z, 0.3, false)) { i = base + order[q][1]; break; } }
    if (i < 0) i = base + order[0][1];
  }
  const p = T[i - base];
  if (dist(e.x, e.z, p.x, p.z) < 2.2 && i < base + T.length - 1) i++;
  e.ai.trailAbs = i;
  const q = T[i - base];
  moveToward(e, q.x, q.z, dt, 1.15, 0.2);
  return true;
}

/* ------------------------------------------------------------------ */
/* commanders                                                          */
/* ------------------------------------------------------------------ */
function looseRelicFor(r, mine) {
  const M = REALMS[r].musterSite;
  return WAR.relics.find((x) => {
    if (mine.some((w) => w.order && w.order.relic === x)) return false;
    if (x.state === 'ground') return dist(x.x, x.z, M.x, M.z) < 420;
    return x.state === 'carried' && x.realm === r && x.carrierRealm !== r;
  });
}
// take the nearest band that is only marching somewhere and give it a more urgent order
function retask(mine, x, z, order) {
  let best = null, bd = Infinity;
  for (const wb of mine) {
    const O = wb.order;
    if (O && (O.byPlayer || !((O.type === 'attack' && O.phase === 'travel') || O.type === 'patrol'))) continue; // [campaign] the player's orders hold
    if (wbMembers(wb).length < 4) continue;
    const L = wbLeader(wb);
    const d = dist(L.x, L.z, x, z);
    if (d < bd) { bd = d; best = wb; }
  }
  if (best) wbSetOrder(best, order);
  return best;
}
// [campaign] the commander's thinking lives in 08g_campaign.js: objectives chosen for stated reasons,
// bands spread across the realm's two fronts, every order announced
function commanderThink(C) { planWar(C); }

/* ------------------------------------------------------------------ */
/* the war tick                                                        */
/* ------------------------------------------------------------------ */
function updateWar(dt) {
  const now = GAME.t;
  for (const C of WAR.commanders) if (now > C.nextThink) { C.nextThink = now + 3 + Math.random() * 2; commanderThink(C); }
  for (const wb of WAR.warbands) updateWarband(wb, dt);
  for (let i = WAR.warbands.length - 1; i >= 0; i--) if (WAR.warbands[i].dead) WAR.warbands.splice(i, 1);
  for (const K of WAR.keeps) {
    // siege detection
    let hostile = 0;
    forNear(K.site.x, K.site.z, 34, (o) => { if (o.alive && isActor(o) && o.faction <= 2 && o.faction !== K.realm) hostile++; });
    if (hostile > 0) { K.lastEnemyNear = now; if (hostile >= 2 || K.door.hp < K.door.maxHp * 0.98) { if (now > K.underSiegeUntil && K.realm === (GAME.player && GAME.player.faction)) news(`${K.site.name} is under attack!`, K.realm, 'alarm'); K.underSiegeUntil = now + 20; } }
    // door repair or rebuild
    const D = K.door;
    if (D.alive && now - D.lastHitAt > 25 && D.hp < D.maxHp) D.hp = Math.min(D.maxHp, D.hp + D.maxHp * 0.015 * dt);
    if (!D.alive && now - K.lastEnemyNear > 40 && now - D.deadAt > 40) { setDoorState(D, true, 0.35); news(`${K.site.name} has rebuilt its gate.`, K.realm, 'normal'); }
    // reinforcements trickle in when the keep is quiet
    if (now > K.nextGuardAt && now - K.lastEnemyNear > 12) { K.nextGuardAt = now + 14; fillGarrison(K, false); }
  }
  for (const T of WAR.temples) {
    const D = T.door;
    let hostile = 0;
    forNear(T.site.x, T.site.z, 30, (o) => { if (o.alive && isActor(o) && o.faction <= 2 && o.faction !== T.realm) hostile++; });
    if (hostile) { T.lastEnemyNear = now; if (hostile >= 2 || D.hp < D.maxHp * 0.98) T.underSiegeUntil = now + 20; }
    if (WAR.keeps.some((K) => K.orig === T.realm && K.realm !== T.realm)) T.exposedUntil = now + 180;
    if (D.alive && now - D.lastHitAt > 25 && D.hp < D.maxHp) D.hp = Math.min(D.maxHp, D.hp + D.maxHp * 0.015 * dt);
    if (!D.alive && now - T.lastEnemyNear > 40 && now - D.deadAt > 45) setDoorState(D, true, 0.4);
    if (now > T.nextGuardAt && now - T.lastEnemyNear > 20) { T.nextGuardAt = now + 30; fillGuardians(T, false); }
  }
  updateRelics(dt);
  updateCampaign(dt); // [campaign] claims, victory, the peace and the reset (08g_campaign.js)
  // camps respawn
  for (const c of CAMPS) {
    for (let i = c.respawnAt.length - 1; i >= 0; i--) {
      if (now > c.respawnAt[i]) {
        const P = GAME.player;
        if (P && dist(P.x, P.z, c.x, c.z) < 22) { c.respawnAt[i] = now + 10; continue; }
        c.respawnAt.splice(i, 1);
        spawnMob(c);
      }
    }
    if (c.elite && c.eliteId == null && now > c.eliteAt) {
      const P = GAME.player;
      if (P && dist(P.x, P.z, c.x, c.z) < 26) c.eliteAt = now + 10;
      else spawnMob(c, true);
    }
  }
}
function news(text, realm, kind = 'normal') {
  WAR.news.push({ t: GAME.t, text, realm, kind });
  if (WAR.news.length > 60) WAR.news.shift();
  uiLog(text, 'realm', realm);
  const P = GAME.player;
  if (P && (kind === 'big' || (kind === 'alarm' && realm === P.faction))) uiBanner(text, realm);
}

/* ------------------------------------------------------------------ */
/* simulation step for every NPC                                       */
/* ------------------------------------------------------------------ */
function updateNPCs(dt0) {
  const P = GAME.player;
  for (let i = ENT.length - 1; i >= 0; i--) {
    const e = ENT[i];
    if (e.removed) continue;
    let dt = dt0; // [phones] townsfolk and kept beasts far from the player live at half rate (below)
    if (!e.alive) {
      if (GAME.t > e.removeAt && e.kind !== 'door') removeEnt(e);
      updateAnim(e, dt);
      continue;
    }
    if (e.kind === 'door' || e.role === 'player') continue;
    // home-zone creatures far from the player rest
    const far = P ? dist2(e.x, e.z, P.x, P.z) : 0;
    if ((e.role === 'mob' || e.role === 'villager' || e.role === 'critter') && far > 170 * 170) { e.prevX = e.x; e.prevZ = e.z; continue; }
    // [phones] 90 m off, townsfolk and the town's and the wild's beasts think every other step, with two steps' time
    if (far > 90 * 90 && e.alive && (e.role === 'villager' || (e.role === 'animal' && e.tame && e.tame.owner !== 'player'))) { e._half = !e._half; if (e._half) continue; dt = dt0 * 2; }
    if (e.role === 'critter') { thinkCritter(e, dt); e.y = heightAt(e.x, e.z); updateAnim(e, dt); continue; }
    if (e.role === 'boss') { tickBuffs(e, dt); if (e.alive) thinkDragon(e, dt); updateAnim(e, dt); continue; }
    tickBuffs(e, dt);
    if (!e.alive) continue;
    // mid-leap: the leap carries the body, nothing else does
    if (e.motion && updateMotion(e, dt)) { updateAnim(e, dt); continue; }
    if (e.casting) {
      if (isStunned(e)) e.casting = null;
      else if (!e.casting.custom) { e.casting.t += dt; if (e.casting.t >= e.casting.total) finishCast(e); }
    }
    if (!isStunned(e)) {
      if (e.role === 'mob') { if (e.dunPack != null) thinkBarrowMob(e, dt); else thinkMob(e, dt); }
      else if (e.role === 'dungeonBoss') thinkHollowKing(e, dt);
      else if (e.role === 'soldier') thinkSoldier(e, dt);
      else if (e.role === 'guard') thinkPosted(e, dt, e.fixedY !== null || e.ai.wall ? 38 : 22);
      else if (e.role === 'lord') thinkPosted(e, dt, 14);
      else if (e.role === 'guardian') thinkPosted(e, dt, 16);
      else if (e.role === 'muster') thinkPosted(e, dt, 26);
      else if (e.role === 'villager' || e.role === 'herald' || e.role === 'merchant') thinkVillager(e, dt);
      else if (e.role === 'animal') thinkAnimal(e, dt); // [animals] companions, livestock, wild horses (08h_animals.js)
      autoAttack(e);
    }
    // power regen
    e.power = Math.min(e.maxPower, e.power + e.maxPower * dt * (GAME.t > e.combatUntil ? 0.05 : 0.02));
    // separation
    if (e.fixedY === null) {
      forNear(e.x, e.z, 1.6, (o) => {
        if (o === e || !o.alive || o.kind === 'door' || o.fixedY !== null || Math.abs(o.y - e.y) > 1.5) return; // [keeps] not bodies on another floor
        const rr = (e.radius * (e.scale || 1) + o.radius * (o.scale || 1)) * 0.9;
        const dx = e.x - o.x, dz = e.z - o.z, d2 = dx * dx + dz * dz;
        if (d2 < rr * rr && d2 > 1e-6) {
          const d = Math.sqrt(d2), push = (rr - d) * 0.5;
          if (o.role !== 'player') stepTo(e, e.x + (dx / d) * push, e.z + (dz / d) * push);
          else stepTo(e, e.x + (dx / d) * push * 2, e.z + (dz / d) * push * 2);
        }
      });
    }
    const gy = groundY(e) + (e.hover || 0) * (1 + 0.15 * Math.sin(GAME.t * 2 + e.id));
    e.y = e.fixedY !== null ? e.fixedY : gy;
    updateAnim(e, dt);
  }
}
