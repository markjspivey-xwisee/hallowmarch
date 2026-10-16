import { requireGame } from './authority.js';

// An explicitly bounded shared expedition. Its rewards are expedition records,
// not writes into the legacy browser-owned inventory or an MMO-world migration.
export function createHallowmarchDomain({ origin = { x: 0, z: 0 }, monsterHp = 100 } = {}) {
  requireGame(Number.isFinite(origin?.x) && Number.isFinite(origin?.z) && Math.abs(origin.x) <= 1000000 && Math.abs(origin.z) <= 1000000
    && Number.isSafeInteger(monsterHp) && monsterHp > 0 && monsterHp <= 1000000, 'invalid_domain', 'A bounded expedition origin and enemy health are required.');
  // Configuration is captured once; callers cannot move the authoritative
  // expedition's origin while commands are being processed.
  origin = { x: origin.x, z: origin.z };
  const point = (dx, dz) => ({ x: origin.x + dx, z: origin.z + dz });
  const entity = (s, id) => typeof id === 'string' && Object.hasOwn(s.entities, id) ? s.entities[id] : undefined;
  const alive = e => e && e.hp > 0;
  const finite = n => typeof n === 'number' && Number.isFinite(n);
  const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
  return {
    id: 'hallowmarch.shared-expedition.v1', evidenceDomain: 'hallowmarch',
    initialState(roomId) {
      return { domain: 'hallowmarch', encounter: { sequence: 1, defeatedAt: null }, entities: { 'march-guardian': { id: 'march-guardian', name: 'March guardian', kind: 'npc',
        ...point(0, 5), hp: monsterHp, maxHp: monsterHp, damage: 5, realmId: 'wild', teamId: 'wild', lastAttackAt: 0 } }, loot: {}, rewards: {}, domainEvents: 0 };
    },
    join(state, principal, { actorId, now, emit }) {
      const existing = entity(state, actorId);
      requireGame(!existing || (existing.kind === 'player' && existing.ownerPlayerId === actorId), 'identity_collision', 'This player identity is reserved by another entity.');
      if (!existing) {
        const realm = String(principal.realmId ?? '0');
        requireGame(['0', '1', '2'].includes(realm), 'invalid_realm', 'Choose one of the three realms.');
        state.entities[actorId] = { id: actorId, kind: 'player', ownerPlayerId: actorId, name: String(principal.name || 'Traveller').slice(0, 32),
          ...point(0, 0), hp: 100, maxHp: 100, damage: 10, speed: 6, realmId: realm, teamId: `expedition:${state.roomId}`, lastMoveAt: now, lastAttackAt: 0 };
        emit('player.joined', { entityId: actorId });
      }
      return { entityId: actorId };
    },
    apply(state, cmd, { actorId, entityId, now, emit, authorization }) {
      const e = entity(state, entityId);
      requireGame(e && e.ownerPlayerId === actorId && e.kind !== 'npc', 'entity_forbidden', 'You cannot control that entity.');
      if (cmd.type === 'resetEncounter') {
        requireGame(!authorization, 'human_required', 'Only a human player can start the next encounter.');
        const guardian = entity(state, 'march-guardian');
        requireGame(guardian && !alive(guardian), 'encounter_active', 'Defeat the guardian before starting the next encounter.');
        const unclaimed = Object.values(state.loot).some(drop => !drop.claimedBy);
        requireGame(!unclaimed || now - (state.encounter?.defeatedAt ?? now) >= 30000, 'reward_pending', 'Claim the guardian reward first, or wait thirty seconds for the next encounter.');
        state.encounter = { sequence: (state.encounter?.sequence || 1) + 1, defeatedAt: null };
        state.loot = {};
        Object.assign(guardian, point(0, 5), { hp: monsterHp, maxHp: monsterHp, lastAttackAt: 0 });
        for (const body of Object.values(state.entities)) if (body.kind !== 'npc') {
          Object.assign(body, point(body.kind === 'companion' ? 1 : 0, 0), { hp: body.maxHp, lastMoveAt: now, lastAttackAt: 0 });
        }
        emit('encounter.started', { sequence: state.encounter.sequence });
        return { encounter: structuredClone(state.encounter) };
      }
      if (cmd.type === 'recover') {
        requireGame(!authorization, 'human_required', 'Only the human owner can recover a fallen companion or body.');
        requireGame(!alive(e), 'entity_alive', 'This body is already ready.');
        Object.assign(e, point(0, 0), { hp: e.maxHp, lastMoveAt: now, lastAttackAt: now });
        emit('entity.recovered', { entityId }); return { entityId, hp: e.hp };
      }
      if (cmd.type === 'spawnCompanion') {
        requireGame(!authorization, 'human_required', 'Only the human creates a companion.');
        requireGame(Object.values(state.entities).filter(x => x.kind === 'companion' && x.ownerPlayerId === actorId).length < 2, 'companion_limit', 'Two companions per player are supported.');
        let suffix = Object.keys(state.entities).length, id;
        do { id = `${actorId}:companion:${suffix++}`; } while (entity(state, id));
        state.entities[id] = { ...structuredClone(e), id, kind: 'companion', name: String(cmd.name || 'Companion').slice(0, 32), hp: 60, maxHp: 60, damage: 5, x: e.x + 1, lastMoveAt: now, lastAttackAt: 0 };
        emit('companion.spawned', { entityId: id, ownerPlayerId: actorId }); return { entityId: id };
      }
      requireGame(alive(e), 'entity_dead', 'This entity has fallen.');
      if (cmd.type === 'move') {
        requireGame(finite(cmd.x) && finite(cmd.z) && Math.abs(cmd.x - origin.x) <= 40 && Math.abs(cmd.z - origin.z) <= 40, 'invalid_move', 'Stay inside the expedition area.');
        const next = { x: cmd.x, z: cmd.z }, elapsed = Math.max(0, Math.min(1000, now - e.lastMoveAt)) / 1000;
        requireGame(distance(e, next) <= e.speed * elapsed + 1e-9, 'pace_exceeded', 'Movement exceeds the server speed limit.');
        e.x = next.x; e.z = next.z; e.lastMoveAt = now; emit('movement.applied', { entityId, x: e.x, z: e.z });
        return { entityId, x: e.x, z: e.z };
      }
      if (cmd.type === 'attack') {
        const target = entity(state, cmd.targetId);
        requireGame(target?.kind === 'npc' && alive(target), 'invalid_target', 'Choose a living expedition enemy.');
        requireGame(distance(e, target) <= 3, 'out_of_range', 'Move closer to the enemy.');
        requireGame(now - e.lastAttackAt >= 700, 'cooldown', 'The attack is still recovering.');
        e.lastAttackAt = now;
        const amount = Math.min(e.damage, target.hp); target.hp -= amount;
        const killId = target.hp <= 0 ? `${state.roomId}:${target.id}:encounter-${state.encounter?.sequence || 1}:defeated` : null;
        emit('damage', { sourceId: entityId, targetId: target.id, amount, dead: target.hp <= 0, ...(killId ? { killId } : {}) });
        if (killId && !state.loot[killId]) {
          state.encounter ||= { sequence: 1 }; state.encounter.defeatedAt = now;
          state.loot[killId] = { id: killId, targetId: target.id, itemId: 'guardian-token', quantity: 1, claimedBy: null, eligiblePlayers: [...new Set(Object.values(state.entities).filter(x => x.kind === 'player' && distance(x, target) <= 20).map(x => x.id))] };
        }
        // One server-owned retaliation per cooldown, independent of client claims.
        if (target.hp > 0 && now - target.lastAttackAt >= 1000) {
          target.lastAttackAt = now; const retaliation = Math.min(e.hp, target.damage); e.hp -= retaliation;
          emit('damage', { sourceId: target.id, targetId: entityId, amount: retaliation, dead: e.hp <= 0 }, { actorId: `npc:${target.id}`, actorKind: 'npc', humanSubject: false, teamId: 'wild', realmId: 'wild' });
        }
        return { targetId: target.id, hp: target.hp, killId };
      }
      if (cmd.type === 'claimLoot') {
        const drop = Object.values(state.loot).find(x => x.targetId === cmd.targetId);
        requireGame(drop && drop.eligiblePlayers.includes(actorId), 'loot_forbidden', 'This reward is not available to you.');
        requireGame(!drop.claimedBy, 'loot_claimed', 'That reward has already been claimed.');
        requireGame(distance(e, entity(state, drop.targetId)) <= 4, 'out_of_range', 'Move closer to the reward.');
        drop.claimedBy = actorId;
        state.rewards[actorId] ||= {}; state.rewards[actorId][drop.itemId] = (state.rewards[actorId][drop.itemId] || 0) + drop.quantity;
        emit('loot.granted', { targetId: drop.targetId, claimantId: actorId, itemId: drop.itemId, quantity: drop.quantity, killId: drop.id });
        return { itemId: drop.itemId, quantity: drop.quantity };
      }
      if (cmd.type === 'knowledge.consulted' || cmd.type === 'teaching.delivered') {
        requireGame(typeof cmd.resourceId === 'string' && /^https?:\/\//.test(cmd.resourceId) && cmd.resourceId.length <= 512, 'invalid_resource', 'A concrete knowledge resource is required.');
        emit(cmd.type, { entityId, resourceId: cmd.resourceId }); return { recorded: true };
      }
      requireGame(false, 'unknown_command', 'Unsupported expedition command.');
    },
    observe(state, actorId) {
      return { domain: state.domain, encounter: structuredClone(state.encounter || { sequence: 1, defeatedAt: null }), entities: structuredClone(state.entities), loot: Object.values(state.loot).map(x => ({ id: x.id, targetId: x.targetId, claimedBy: x.claimedBy, itemId: x.itemId })), rewards: structuredClone(state.rewards[actorId] || {}) };
    },
  };
}
