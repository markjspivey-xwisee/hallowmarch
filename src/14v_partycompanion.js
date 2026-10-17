/* A separately owned humanoid beside the player. Its small character save
 * contains gameplay state only; native grants and agent identities stay in
 * their existing native resources. No bot may possess GAME.player here. */
const PARTY_COMPANION = { record: null, entity: null, player: null, accountId: '' };
const partyCompanionFinite = (value, min, max) => typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
const partyCompanionUuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const partyCompanionName = value => (typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f-\u009f\u00ad\u061c\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff<>&"]/g, '').trim().slice(0, 32) : '') || 'AI companion';
function partyCompanionLook(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  if (!['tabard', 'armor'].every(key => Array.isArray(value[key]) && value[key].length === 3 && value[key].every(n => partyCompanionFinite(n, 0, 2)))) return null;
  if (!['skin', 'hair'].every(key => partyCompanionFinite(value[key], 0, 1)) || !partyCompanionFinite(value.scale, 0.85, 1.12)
    || !partyCompanionFinite(value.bulk ?? 0, 0, 0.5) || !['mask', 'flags', 'outfit', 'emblem'].every(key => Number.isInteger(value[key]))) return null;
  if (!partyCompanionFinite(value.mask, 0, (1 << 24) - 1) || !partyCompanionFinite(value.flags, 0, 1023)
    || !partyCompanionFinite(value.outfit, 0, 3) || !partyCompanionFinite(value.emblem, 0, 3)) return null;
  return { tabard: value.tabard.slice(), armor: value.armor.slice(), skin: value.skin, hair: value.hair, scale: value.scale,
    bulk: value.bulk ?? 0, mask: value.mask, flags: value.flags, outfit: value.outfit, emblem: value.emblem, fem: value.fem ? 1 : 0 };
}
function partyCompanionClean(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || value.v !== 1 || !partyCompanionUuid(value.id)
    || typeof value.cls !== 'string' || !Object.hasOwn(CLASSES, value.cls) || !Number.isInteger(value.level)
    || !partyCompanionFinite(value.level, 1, LEVEL_CAP) || typeof value.alive !== 'boolean'
    || !partyCompanionFinite(value.hp, 0, 1) || !partyCompanionFinite(value.power, 0, 1)
    || !partyCompanionFinite(value.x, -4000, 4000) || !partyCompanionFinite(value.z, -4000, 4000)
    || !partyCompanionFinite(value.yaw, -1e6, 1e6)) return null;
  const role = value.role === undefined ? 'follow' : value.role;
  if (!['follow', 'guard', 'support'].includes(role)) return null;
  const guard = role === 'guard' && value.guard;
  if (role === 'guard' && (!guard || !partyCompanionFinite(guard.x, -4000, 4000) || !partyCompanionFinite(guard.z, -4000, 4000))) return null;
  const alive = value.alive && value.hp > 0;
  return { v: 1, id: value.id.toLowerCase(), name: partyCompanionName(value.name), cls: value.cls, level: value.level,
    alive, hp: alive ? value.hp : 0, power: value.power, x: value.x, z: value.z, yaw: value.yaw % TAU,
    role, guard: guard ? { x: guard.x, z: guard.z } : null, look: partyCompanionLook(value.look) };
}
function partyCompanionOwned(entity) {
  const state = PARTY_COMPANION;
  return !!entity && entity === state.entity && entity !== GAME.player && entity.role === 'companion'
    && !!state.record && entity.partyCompanionId === state.record.id && state.player === GAME.player
    && state.accountId === (NETWS.acct?.id || '');
}
function partyCompanionMember() {
  const state = PARTY_COMPANION, entity = state.entity;
  return !NETWS.acct?.id || !partyCompanionOwned(entity) ? null
    : { id: NETWS.acct.id + ':companion:' + state.record.id, name: entity.name, entity };
}
function partyCompanionBodies() {
  const member = partyCompanionMember();
  return member && !member.entity.removed ? [member] : [];
}
function partyCompanionSpawn(record) {
  const state = PARTY_COMPANION, player = GAME.player;
  const extra = { name: record.name, yaw: record.yaw, partyCompanionId: record.id, properName: true };
  if (record.look) { extra.look = partyCompanionLook(record.look); extra.scale = extra.look.scale; }
  const entity = spawnRealmUnit(player.faction, record.cls, record.level, 'companion', record.x, record.z, extra);
  entity.hp = record.alive ? entity.maxHp * record.hp : 0;
  entity.power = entity.maxPower * record.power;
  entity.alive = record.alive;
  if (!record.alive) { entity.deadAt = GAME.t; entity.removeAt = GAME.t + 10; }
  state.record = record; state.entity = entity; state.player = player; state.accountId = NETWS.acct?.id || '';
  return entity;
}
function partyCompanionCreate(name = 'AI companion', cls = GAME.player?.cls) {
  const player = GAME.player;
  if (!GAME.started || !player?.alive || !NETWS.acct?.id) throw new Error('Enter your character before adding a companion.');
  if (PARTY_COMPANION.record && PARTY_COMPANION.player === player) throw new Error('This character already has a companion. A fallen companion remains fallen.');
  if (typeof cls !== 'string' || !Object.hasOwn(CLASSES, cls)) throw new Error('Choose a known companion calling.');
  // Find an ordinary nearby standing place once, when the unit is created.
  // Movement after creation always follows the normal collision controller.
  let spot = null;
  for (let i = 0; i < 16; i++) {
    const angle = player.yaw + (i + 1) * TAU / 16, radius = i < 8 ? 2.6 : 4;
    const x = player.x + Math.sin(angle) * radius, z = player.z + Math.cos(angle) * radius;
    if (partyCompanionFinite(x, -4000, 4000) && partyCompanionFinite(z, -4000, 4000) && isWalkable(x, z)
      && segmentClear(player.x, player.z, x, z, 0.45)) { spot = { x, z }; break; }
  }
  if (!spot) throw new Error('Move to clear ground before adding your companion.');
  const id = crypto.randomUUID();
  if (!partyCompanionUuid(id)) throw new Error('A stable companion identity could not be created.');
  partyCompanionLoad(null);
  const entity = partyCompanionSpawn({ v: 1, id, name: partyCompanionName(name), cls,
    level: Math.max(1, Math.min(LEVEL_CAP, Math.round(player.level || 1))), hp: 1, power: 1, alive: true,
    x: spot.x, z: spot.z, yaw: player.yaw, role: 'follow', guard: null, look: null });
  saveSoon();
  return entity;
}
function partyCompanionStop(entity = PARTY_COMPANION.entity) {
  if (partyCompanionOwned(entity)) entity.target = null;
  // Existing casts, projectiles and physical motions finish by normal rules.
}
function partyCompanionSetRole(role) {
  const entity = PARTY_COMPANION.entity;
  if (!partyCompanionOwned(entity) || entity.removed || !entity.alive) throw new Error('Choose your living companion first.');
  if (!['follow', 'guard', 'support'].includes(role)) throw new Error('Choose follow, guard or support.');
  partyCompanionStop(entity);
  PARTY_COMPANION.record.role = role;
  PARTY_COMPANION.record.guard = role === 'guard' ? { x: entity.x, z: entity.z } : null;
  saveSoon();
}
function partyCompanionDismiss() {
  const state = PARTY_COMPANION;
  if (!partyCompanionOwned(state.entity)) throw new Error('Choose your own companion first.');
  partyCompanionStop(state.entity);
  partyCompanionLoad(null); saveSoon();
}
function partyCompanionMove(entity, dx, dz, dt) {
  if (!partyCompanionOwned(entity) || entity.removed || !entity.alive || entity.casting || entity.motion || isStunned(entity)
    || !partyCompanionFinite(dt, 0, 0.25) || !Number.isFinite(dx) || !Number.isFinite(dz) || Math.hypot(dx, dz) > 1.01) return false;
  if (!dx && !dz) return true;
  const x = entity.x, z = entity.z;
  // moveToward normalizes direction, so preserve an input's analog magnitude.
  moveToward(entity, x + dx, z + dz, dt, Math.min(1, Math.hypot(dx, dz)), 0);
  return entity.x !== x || entity.z !== z;
}
function partyCompanionTick(dt, { held = new Set(), paused = false } = {}) {
  const entity = PARTY_COMPANION.entity, player = GAME.player;
  if (!partyCompanionOwned(entity) || entity.removed || !entity.alive) return;
  if (paused || !GAME.started || !player?.alive || UI.modal) { partyCompanionStop(entity); return; }
  if (held.has(entity) || entity.casting || entity.motion || isStunned(entity) || !partyCompanionFinite(dt, 0, 0.25)) return;
  const record = PARTY_COMPANION.record, support = record.role === 'support';
  partyCompanionStop(entity);
  if (record.role === 'guard') {
    const anchor = record.guard;
    if (anchor && Math.hypot(entity.x - anchor.x, entity.z - anchor.z) > 0.8) moveToward(entity, anchor.x, anchor.z, dt, 1, 0.4);
    return;
  }
  if (support) {
    const target = getEnt(player.target);
    if (target?.alive && !target.removed && target !== entity && target !== player && target.role !== 'remote'
      && target.kind !== 'door' && isEnemy(entity, target) && inDungeon(target) === inDungeon(entity)
      && inDungeon(target) === inDungeon(player) && Math.hypot(target.x - player.x, target.z - player.z) <= 18
      && Math.hypot(target.x - entity.x, target.z - entity.z) <= 30) {
      fightTarget(entity, target, dt); return;
    }
  }
  const side = support ? 1.5 : 2.2, back = support ? 0.8 : 1.8;
  const x = player.x + Math.cos(player.yaw) * side - Math.sin(player.yaw) * back;
  const z = player.z - Math.sin(player.yaw) * side - Math.cos(player.yaw) * back;
  if (Math.hypot(entity.x - x, entity.z - z) > 1.2) moveToward(entity, x, z, dt, 1, 0.8);
}
function partyCompanionSave() {
  const state = PARTY_COMPANION, entity = state.entity;
  if (!partyCompanionOwned(entity)) return null;
  return partyCompanionClean({ ...state.record, name: entity.name, cls: entity.cls, level: entity.level,
    x: entity.x, z: entity.z, yaw: entity.yaw, alive: entity.alive, hp: entity.maxHp > 0 ? Math.max(0, Math.min(1, entity.hp / entity.maxHp)) : 0,
    power: entity.maxPower > 0 ? Math.max(0, Math.min(1, entity.power / entity.maxPower)) : 0, look: entity.look });
}
function partyCompanionLoad(value) {
  const state = PARTY_COMPANION;
  // Each startGame loads this part after creating the new human player.
  if (state.entity && !state.entity.removed) removeEnt(state.entity);
  state.record = null; state.entity = null; state.player = null; state.accountId = '';
  const record = partyCompanionClean(value);
  if (record && GAME.player) partyCompanionSpawn(record);
}
registerSavePart('char', 'partyCompanion', { save: partyCompanionSave, load: partyCompanionLoad });
