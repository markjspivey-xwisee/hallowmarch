/* Public dungeon mechanisms; character deeds and discovery stay in the private save. */
const NET_DUNGEONS = { image: null, imageAt: 0, wallNext: 0 };
const netDungeonShared = () => typeof netWorldPartsActive === 'function' && netWorldPartsActive();
function netDungeonChest(id) { return DUN.chests.find(ch => ch.id === id); }
function netDungeonSave() {
  if (!DEEP.built) return null;
  return { v: 1, seal: !!DEEP.opened, wall: { broken: !!DEEP.wallBroken,
    hits: Math.min(3, Math.max(0, DEEP.wall?.hits || 0)), wait: Math.max(0, NET_DUNGEONS.wallNext - GAME.t) },
    chests: DUN.chests.slice(0, 8).map(ch => ({ id: ch.id, ready: !!ch.ready, opened: !!ch.opened,
      left: Math.max(0, ch.refillAt - GAME.t) })) };
}
function netDungeonApply(image) {
  if (!image || image.v !== 1 || !image.wall || !Array.isArray(image.chests)) return;
  NET_DUNGEONS.image = netPartsClone(image); NET_DUNGEONS.imageAt = GAME.t;
  netDungeonRestore();
}
function netDungeonRestore() {
  const image = NET_DUNGEONS.image;
  if (!netDungeonShared() || !image) return false;
  const elapsed = Math.max(0, GAME.t - NET_DUNGEONS.imageAt);
  DEEP.opened = !!image.seal; DEEP.wallBroken = !!image.wall.broken;
  NET_DUNGEONS.wallNext = GAME.t + Math.max(0, Math.min(1, +image.wall.wait || 0) - elapsed);
  if (DEEP.wall) DEEP.wall.hits = Math.round(clamp(+image.wall.hits || 0, 0, 3));
  if (DEEP.built && DEEP.seal) {
    DEEP.seal.target = DEEP.seal.open = DEEP.opened ? 1 : 0; deepSealPose();
    deepWallShow();
  }
  DEEP.taken = {};
  for (const row of image.chests.slice(0, 8)) {
    const ch = row && typeof row.id === 'string' && netDungeonChest(row.id);
    if (!ch) continue;
    ch.ready = !!row.ready; ch.opened = !!row.opened;
    ch.refillAt = GAME.t + Math.max(0, Math.min(3600, +row.left || 0) - elapsed);
    ch.lid = ch.opened ? 1 : 0;
    if (ch.lidMesh) ch.lidMesh.rotation.x = -smooth(ch.lid) * 1.75;
    if (ch.deep && ch.opened) DEEP.taken[ch.id] = ch.refillAt;
  }
  return true;
}
function netDungeonUseChest(ch) {
  if (!netDungeonShared() || NETPARTS.replay || NETPARTS.applying) return false;
  if (!ch || !ch.ready || ch.opened) return true;
  netWorldPartsRequest('dungeon.chest', { id: ch.id }, [], true); return true;
}
function netDungeonUseSeal(quiet) {
  if (quiet || !netDungeonShared() || NETPARTS.replay || NETPARTS.applying) return false;
  if (!late3SealReady()) { uiError(late3SealWhy()); return true; }
  // Only this prerequisite is declared; no other character's deeds are copied.
  netWorldPartsRequest('dungeon.seal', { eligible: true }, [], true); return true;
}
function netDungeonUseWall() {
  if (!netDungeonShared() || NETPARTS.replay || NETPARTS.applying) return false;
  if (!DEEP.wallBroken) netWorldPartsRequest('dungeon.wall', {}, [], true);
  return true;
}
function netDungeonNear(target, range, y = target?.y) {
  const actor = GAME.player;
  return !!target && !!actor && actor.alive && inDungeon(actor)
    && Math.hypot(actor.x - target.x, actor.z - target.z) <= range
    && Number.isFinite(y) && Math.abs(actor.y - y) < 4;
}
function netDungeonOpenChest(args) {
  const ch = netDungeonChest(args.id), actor = GAME.player;
  if (!ch || !ch.ready || ch.opened || !netDungeonNear(ch, 4)) return false;
  const fighting = ENT.some(e => e.alive && e.faction === FACTION_MONSTER && inDungeon(e)
    && dist2(e.x, e.z, ch.x, ch.z) < 144 && e.threat?.has(actor.id));
  if (fighting) return { ok: false, why: 'Not while the dead are on you.' };
  const hoard = ch.id === 'dhoard', vault = ch.id === 'vault';
  const level = ch.deep ? Math.min(LEVEL_CAP, GAME.prog.level + (hoard ? 2 : 1))
    : clamp(GAME.prog.level + (vault ? 2 : 0), 15, 22 + barrowBoost());
  const count = hoard || vault ? 3 : ch.id === 'dniche' ? 2 : 1 + (Math.random() < 0.5 ? 1 : 0);
  const items = [];
  for (let i = 0; i < count; i++) {
    const weights = hoard ? (i === 0 ? [0, 0, 0, 0, 40, 60] : [0, 0, 0, 0, 70, 30])
      : vault ? (i === 0 ? [0, 0, 0, 0, 90, 10] : DROP_WEIGHTS.boss)
      : ch.deep ? DROP_WEIGHTS.boss : DROP_WEIGHTS.chest;
    items.push(makeItem({ cls: actor.cls, realm: actor.faction, lvl: level, q: rollQuality(weights) }));
  }
  // The temporary command inventory becomes one durable owner receipt. The
  // receiver holds the entire outcome if its packs filled during the request.
  INV.bag.push(...items);
  addGold(ch.deep ? hoard ? 700 + Math.random() * 300 : 140 + Math.random() * 120
    : vault ? 320 + Math.random() * 220 : 60 + Math.random() * 70);
  if (ch.deep) goodsAdd('grave_iron', hoard ? 4 : 1, true);
  ch.opened = true;
  ch.refillAt = GAME.t + (ch.deep ? hoard ? DEEP_LORD.respawn : DEEP_RESPAWN * 2
    : vault ? KING_RESPAWN : BARROW_RESPAWN * 2);
  if (ch.deep) { DEEP.taken[ch.id] = ch.refillAt; DEEP.stats.chests++; }
  sfx('chestOpen'); saveSoon(); return { ok: true };
}
queueMicrotask(() => {
  netWorldPartsRegister('dungeons', { save: netDungeonSave, apply: netDungeonApply });
  netWorldPartsRegisterCommand('dungeon.chest', {
    range: 4, point: args => netDungeonChest(args.id) || { x: Infinity, z: Infinity }, run: netDungeonOpenChest,
  });
  netWorldPartsRegisterCommand('dungeon.seal', {
    range: 4, point: () => ({ x: dunWX(DEEP_SEAL.u), z: dunWZ(DEEP_SEAL.v - 0.9) }),
    run: args => {
      const point = { x: dunWX(DEEP_SEAL.u), z: dunWZ(DEEP_SEAL.v - 0.9), y: -7 };
      if (!args.eligible || DEEP.opened || !DEEP.built || !netDungeonNear(point, 4)
        || GAME.prog.level < DEEP_LV) return false;
      late3SealOpen(false); return { ok: true };
    },
  });
  netWorldPartsRegisterCommand('dungeon.wall', {
    range: 3.2, point: () => DEEP.wall || { x: Infinity, z: Infinity },
    run: () => {
      if (!DEEP.wall || DEEP.wallBroken || GAME.player?.casting || GAME.t < NET_DUNGEONS.wallNext
        || !netDungeonNear(DEEP.wall, 3.2, DEEP_Y)) return false;
      NET_DUNGEONS.wallNext = GAME.t + 0.4;
      DEEP.wall.hits = Math.min(3, (DEEP.wall.hits || 0) + 1);
      setAct(GAME.player, 8, 0.9);
      if (DEEP.wall.hits >= 3) deepWallBreak(GAME.player);
      else sfxAt('slam', DEEP.wall.x, DEEP_Y + 1.2, DEEP.wall.z);
      saveSoon(); return { ok: true };
    },
  });
  if (window.__hm) window.__hm.dungeons = { NET_DUNGEONS, save: netDungeonSave, apply: netDungeonApply };
});
