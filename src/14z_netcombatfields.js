/* Public class effects belong to the shared scene. Caster resources and held
 * actions remain private; the keeper alone advances hazards and projectiles. */
const NET_COMBAT_FIELDS = { next: 0, ticking: false, applying: false, cooldowns: new Map(),
  stats: { created: 0, applied: 0, commands: 0, effects: 0 } };
const NET_FIELD_KEYS = { arrows: 128, stuck: 60, snares: 64, grounds: 6, runes: 96, ice: 7, steam: 8 };
const NET_FIELD_SCALARS = ['x', 'y', 'z', 'px', 'py', 'pz', 'ox', 'oy', 'oz', 'vx', 'vy', 'vz',
  'dx', 'dy', 'dz', 'yaw', 'wy', 'r', 'faction', 'realm', 'level', 'type', 'el', 'tick', 'rk', 'sanct',
  'close', 'thule', 'age', 'mult', 'crit', 'wind', 'wall', 'dmgMult', 'k'];
const netCombatFieldsActive = () => typeof netWorldPartsActive === 'function' && netWorldPartsActive();
const netCombatFieldFinite = v => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= 1e6;
const netCombatFieldRef = e => !e ? null : e === GAME.player ? 'peer:' + NET.self
  : e.role === 'remote' ? 'peer:' + e.netPeer : e.netNpcId || e.netEntityId || null;
const netCombatFieldEnt = id => typeof netEntityFind === 'function' ? netEntityFind(id) : null;
function netCombatFieldId(field, prefix = 'field') {
  if (!field.netFieldId) field.netFieldId = prefix + ':' + (NETPARTS.authority || 'local').slice(0, 12) + ':' + (++NET_COMBAT_FIELDS.next);
  return field.netFieldId;
}
function netCombatFieldPack(field) {
  const row = { id: netCombatFieldId(field) };
  for (const key of NET_FIELD_SCALARS) if (field[key] != null && ['number', 'string', 'boolean'].includes(typeof field[key]))
    row[key] = typeof field[key] === 'number' ? Math.round(field[key] * 1000) / 1000 : field[key];
  for (const key of ['src', 'owner', 'tgt', 'caught']) if (field[key] != null) row[key] = netCombatFieldRef(getEnt(field[key]));
  const source = getEnt(field.src);
  if (source && !Number.isFinite(row.level)) row.level = source.level;
  if (source && !Number.isFinite(row.dmgMult)) row.dmgMult = Math.round((source.dmgMult || 1) * 1000) / 1000;
  if (Number.isFinite(field.until)) row.life = Math.max(0, Math.round((field.until - GAME.t) * 100) / 100);
  if (Number.isFinite(field.t0)) row.since = Math.max(0, Math.round((GAME.t - field.t0) * 100) / 100);
  if (Number.isFinite(field.armAt)) row.arm = Math.max(0, Math.round((field.armAt - GAME.t) * 100) / 100);
  row.sprung = field.sprung ? Math.max(0.001, GAME.t - field.sprung) : 0;
  return row;
}
function netCombatFieldsSave() {
  const frame = { v: 1 };
  for (const [kind, cap] of Object.entries(NET_FIELD_KEYS)) frame[kind] = CLS[kind]
    .filter(f => !f.dead && !f.netFieldPending).slice(-cap).map(netCombatFieldPack);
  frame.frozen = [...CLS.frozen].map(id => netCombatFieldRef(getEnt(id))).filter(Boolean).slice(0, 256);
  return frame;
}
function netCombatFieldRead(row) {
  if (!row || typeof row.id !== 'string' || row.id.length > 100 || !netCombatFieldFinite(row.x)
    || !netCombatFieldFinite(row.z) || Math.abs(row.x) > 4000 || Math.abs(row.z) > 4000) return null;
  const f = { netFieldId: row.id, dead: false };
  for (const key of NET_FIELD_SCALARS) if (row[key] != null) {
    if (!['number', 'string', 'boolean'].includes(typeof row[key])
      || typeof row[key] === 'number' && !netCombatFieldFinite(row[key]) || typeof row[key] === 'string' && row[key].length > 32) return null;
    f[key] = row[key];
  }
  for (const key of ['src', 'owner', 'tgt', 'caught']) f[key] = netCombatFieldEnt(row[key])?.id ?? null;
  if (netCombatFieldFinite(row.life)) f.until = GAME.t + Math.max(0, Math.min(120, row.life));
  if (netCombatFieldFinite(row.since)) f.t0 = GAME.t - Math.max(0, Math.min(120, row.since));
  if (netCombatFieldFinite(row.arm)) f.armAt = GAME.t + Math.max(0, Math.min(30, row.arm));
  f.sprung = row.sprung > 0 ? GAME.t - Math.min(30, row.sprung) : false;
  return f;
}
function netCombatFieldVisualMake(kind, f) {
  if (kind === 'ice') {
    f.floor = addFloorDisc(f.x, f.z, f.r, f.wy + 0.07, f.wy - 4, 'ice'); iceSheetMesh(f);
  } else if (kind === 'snares') snareMesh(f);
  else if (kind === 'runes') {
    f.cut = spellDisc(f.x, f.z, 2.2, DISC_KIND.runecut, Math.max(0.1, f.until - GAME.t), [1, 1, 1], 0.04);
    f.disc = spellDisc(f.x, f.z, 2.2, DISC_KIND.rune, Math.max(0.1, f.until - GAME.t), ELEM_COL[f.el] || ELEM_COL.fire);
    if (f.cut) f.cut.owner = f; if (f.disc) f.disc.owner = f;
  } else if (kind === 'grounds') {
    f.disc = spellDisc(f.x, f.z, f.r, DISC_KIND.consecrate, Math.max(0.1, f.until - GAME.t),
      f.realm === 2 ? [2.2, 1.3, 0.6] : f.realm === 1 ? [1.2, 1.9, 1] : [1.9, 1.6, 0.9]);
  }
}
function netCombatFieldVisualEnd(kind, f) {
  if (kind === 'ice') {
    if (f.floor && typeof bFloorRemove === 'function') bFloorRemove(f.floor);
    iceSheetEnd(f);
  }
  else if (kind === 'snares') snareEnd(f);
  else if (kind === 'runes') runeEnd(f);
  else if (f.disc && f.disc.on) f.disc.age = Math.max(f.disc.age, f.disc.dur - 0.3);
}
function netCombatFieldIceRefresh(f) {
  const old = f.floor;
  if (!old || old.x !== f.x || old.z !== f.z || old.r !== f.r || old.ya !== f.wy + 0.07) {
    if (old) { old.active = false; if (typeof bFloorRemove === 'function') bFloorRemove(old); }
    f.floor = addFloorDisc(f.x, f.z, f.r, f.wy + 0.07, f.wy - 4, 'ice');
  }
  f.mesh?.position?.set?.(f.x, f.wy + 0.05, f.z);
  if (f.mesh?.material?.uniforms?.uWY) f.mesh.material.uniforms.uWY.value = f.wy;
  iceSheetRefresh(f);
}
function netCombatFieldsApply(frame) {
  if (!frame || frame.v !== 1) return;
  // Validate the complete projection before touching physics or visible geometry.
  const prepared = {};
  for (const [kind, cap] of Object.entries(NET_FIELD_KEYS)) {
    if (!Array.isArray(frame[kind]) || frame[kind].length > cap) return;
    const rows = frame[kind].map(netCombatFieldRead);
    if (rows.some(r => !r) || new Set(rows.map(r => r.netFieldId)).size !== rows.length) return;
    if (rows.some(r => kind === 'arrows' ? !['vx', 'vy', 'vz', 'y'].every(k => netCombatFieldFinite(r[k]))
      : !Number.isFinite(r.until) || (['ice', 'grounds', 'steam'].includes(kind) && (!Number.isFinite(r.r) || r.r <= 0 || r.r > 25))
        || kind === 'ice' && !Number.isFinite(r.wy) || kind === 'runes' && !ELEMENTS.includes(r.el))) return;
    prepared[kind] = rows;
  }
  NET_COMBAT_FIELDS.applying = true;
  try {
    for (const kind of Object.keys(NET_FIELD_KEYS)) {
      const old = new Map(CLS[kind].map(f => [f.netFieldId, f])), keep = new Set(), result = [];
      for (const row of prepared[kind]) {
        let f = old.get(row.netFieldId); const fresh = !f;
        if (!f) f = row; else Object.assign(f, row);
        f.netFieldPending = false;
        if (kind === 'arrows') f.vis = NETPARTS.peer !== NET.self;
        if (fresh) netCombatFieldVisualMake(kind, f);
        else if (kind === 'ice') netCombatFieldIceRefresh(f);
        keep.add(f.netFieldId); result.push(f);
      }
      for (const f of CLS[kind].slice()) if (!keep.has(f.netFieldId)) {
        // A freshly loosed owner arrow is a local preview until its canonical receipt arrives.
        if (f.netFieldPending) { result.push(f); continue; }
        netCombatFieldVisualEnd(kind, f);
      }
      CLS[kind] = result;
    }
    CLS.frozen = new Set((Array.isArray(frame.frozen) ? frame.frozen : []).slice(0, 256)
      .map(netCombatFieldEnt).filter(Boolean).map(e => e.id));
    NET_COMBAT_FIELDS.stats.applied++;
  } finally { NET_COMBAT_FIELDS.applying = false; }
}
function netCombatFieldsVisual(dt) {
  if (!netCombatFieldsActive() || netEntityCanSimulateWorld()) return;
  for (const kind of ['ice', 'snares', 'runes', 'grounds', 'steam']) for (const f of CLS[kind].slice()) {
    if (GAME.t >= f.until) {
      netCombatFieldVisualEnd(kind, f);
      const index = CLS[kind].indexOf(f); if (index >= 0) CLS[kind].splice(index, 1);
    } else if (kind === 'snares' && f.sprung) f.close = Math.min(1, f.close + dt * 14);
    else if (kind === 'steam' && Math.random() < dt * 5) steamPuff(f.x, heightAt(f.x, f.z) + 0.5, f.z, 2);
  }
  const P = GAME.player;
  if (P?.alive) for (const f of CLS.stuck) if (!f.netRecoverPending && f.src === P.id && f.type !== 'plain'
    && !f.wall && dist2(P.x, P.z, f.x, f.z) < 1.4 * 1.4) {
    f.netRecoverPending = true; netWorldPartsRequest('combat.arrow-recover', { id: f.netFieldId });
  }
}
function netCombatFieldSend(dst, effect) {
  if (!netCombatFieldsActive() || !NET_COMBAT_FIELDS.ticking || dst?.role !== 'remote' || !dst.netPeer) return false;
  return netEntitySend('result', { to: dst.netPeer, result: { id: NETPARTS.authority + ':field:' + (++NET_COMBAT_FIELDS.next),
    kind: 'class-effect', ...effect } }) !== false;
}
function netCombatFieldResult(result) {
  if (result.kind !== 'class-effect') return false;
  const P = GAME.player; if (!P?.alive) return true;
  const source = netCombatFieldEnt(result.source) || P;
  NET_COMBAT_FIELDS.applying = true;
  try {
    if (result.effect === 'damage' && Number.isFinite(result.amount) && result.amount > 0)
      dealDamage(source, P, Math.min(result.amount, baseDmg(source.level) * 40), result.opts || {});
    else if (result.effect === 'heal' && Number.isFinite(result.amount) && result.amount > 0)
      healEnt(source, P, Math.min(result.amount, P.maxHp));
    else if (result.effect === 'chill' && Number.isFinite(result.amount)) addChill(P, clamp(result.amount, 0, 3), source);
    else if (result.effect === 'buff' && typeof result.buff === 'string'
      && (Object.hasOwn(NET_BUFFS, result.buff) || ['blind', 'hallowed', 'frozen'].includes(result.buff)))
      addBuff(P, result.buff, clamp(+result.value || 0, 0, Math.max(P.maxHp, 100)), clamp(+result.dur || 0, 0, 30), source.id);
  } finally { NET_COMBAT_FIELDS.applying = false; }
  NET_COMBAT_FIELDS.stats.effects++; return true;
}
function netCombatFieldPoint(args) { return { x: args?.x, z: args?.z }; }
function netCombatFieldReady(args, actor, kind, wait = 0) {
  if (!actor?.alive || !netCombatFieldFinite(args?.x) || !netCombatFieldFinite(args?.z)
    || Math.abs(args.x) > 4000 || Math.abs(args.z) > 4000 || Math.hypot(actor.x - args.x, actor.z - args.z) > 65) return false;
  const key = (actor.netPeer || NET.self) + ':' + kind, last = NET_COMBAT_FIELDS.cooldowns.get(key);
  if (wait > 0 && last != null && GAME.t - last < wait) return false;
  NET_COMBAT_FIELDS.cooldowns.set(key, GAME.t);
  if (NET_COMBAT_FIELDS.cooldowns.size > 256) NET_COMBAT_FIELDS.cooldowns.delete(NET_COMBAT_FIELDS.cooldowns.keys().next().value);
  return true;
}
queueMicrotask(() => {
  netWorldPartsRegister('combatfields', { save: netCombatFieldsSave, apply: netCombatFieldsApply });
  const raw = { frostLands, freezeWater, steamAt, fireMeetsIce, layRune, laySnare, consecrate, raiseFallen, netOnArrow,
    updateClasses, npcClassStep, dealDamage, healEnt, addBuff, addChill, arrowHits, stepArrows };
  frostLands = function(x, z, r, src) {
    if (src === GAME.player && netWorldPartsRequest('combat.frost', { x, z, r })) return;
    return raw.frostLands(x, z, r, src);
  };
  freezeWater = function(x, z, r, src) {
    if (src === GAME.player && netWorldPartsRequest('combat.ice', { x, z, r })) return null;
    return raw.freezeWater(x, z, r, src);
  };
  steamAt = function(x, z, r, src, dur = 5) {
    if (src === GAME.player && netWorldPartsRequest('combat.steam', { x, z, r, dur })) return;
    return raw.steamAt(x, z, r, src, dur);
  };
  fireMeetsIce = function(x, z, r, src) {
    if (src === GAME.player && netWorldPartsRequest('combat.melt', { x, z, r })) return;
    return raw.fireMeetsIce(x, z, r, src);
  };
  layRune = function(e, x, z, el) {
    if (e === GAME.player && netWorldPartsRequest('combat.rune', { x, z, el })) return null;
    return raw.layRune(e, x, z, el);
  };
  laySnare = function(e) {
    if (e === GAME.player && netWorldPartsRequest('combat.snare', { x: e.x, z: e.z })) return null;
    return raw.laySnare(e);
  };
  consecrate = function(e, A, t, cast, rk) {
    if (e === GAME.player && netWorldPartsRequest('combat.consecrate', { x: e.x, z: e.z, rk })) {
      csOf(e).dev = Math.max(0, devOf(e) - 35); return;
    }
    return raw.consecrate(e, A, t, cast, rk);
  };
  raiseFallen = function(e, A, t, cast, rk) {
    if (e === GAME.player && netWorldPartsRequest('combat.raise', { x: e.x, z: e.z, rk })) {
      csOf(e).dev = Math.max(0, devOf(e) - 70); return;
    }
    return raw.raiseFallen(e, A, t, cast, rk);
  };
  for (const op of ['frost', 'ice', 'steam', 'melt', 'rune', 'snare', 'consecrate', 'raise'])
    netWorldPartsRegisterCommand('combat.' + op, { durable: false, range: 65, point: netCombatFieldPoint, run: args => {
      const e = GAME.player, primary = ['snare', 'consecrate', 'raise'].includes(op);
      if (!netCombatFieldReady(args, e, op, primary ? Math.max(1, ABILITIES[op]?.cd || 1) : 0.08)) return false;
      if (['frost', 'ice', 'rune'].includes(op) && e.cls !== 'mage') return false;
      if (op === 'snare' && !clsHas(e, 'snare') || ['consecrate', 'raise'].includes(op) && !clsHas(e, op)) return false;
      const r = clamp(+args.r || 4, 0.5, 20), rk = clamp(+args.rk || 1, 0.5, 5);
      if (op === 'frost') raw.frostLands(args.x, args.z, r, e);
      else if (op === 'ice') { if (!isWaterAt(args.x, args.z)) return false; raw.freezeWater(args.x, args.z, r, e); }
      else if (op === 'steam') raw.steamAt(args.x, args.z, r, e, clamp(+args.dur || 5, 0.1, 10));
      else if (op === 'melt') raw.fireMeetsIce(args.x, args.z, r, e);
      else if (op === 'rune') { if (!ELEMENTS.includes(args.el)) return false; raw.layRune(e, args.x, args.z, args.el); }
      else if (op === 'snare') raw.laySnare(e);
      else if (op === 'consecrate') raw.consecrate(e, ABILITIES.consecrate, null, null, rk);
      else if (op === 'raise') raw.raiseFallen(e, ABILITIES.raise, null, null, rk);
      NET_COMBAT_FIELDS.stats.created++; return { ok: true };
    } });
  netOnArrow = function(A) {
    if (!netCombatFieldsActive()) return raw.netOnArrow(A);
    if (!A.netFieldId) A.netFieldId = 'arrow:' + NET.self + ':' + (++NET_COMBAT_FIELDS.next);
    if (!netEntityCanSimulateWorld() && A.src === GAME.player?.id && !NETPARTS.replay) {
      const row = netCombatFieldPack(A);
      if (netWorldPartsRequest('combat.arrow', { x: A.x, z: A.z, row })) { A.vis = true; A.netFieldPending = true; }
    }
  };
  netWorldPartsRegisterCommand('combat.arrow', { durable: false, range: 5, point: netCombatFieldPoint, run: args => {
    const e = GAME.player, row = args.row;
    if (!e?.alive || e.cls !== 'archer' || !netCombatFieldReady(args, e, 'arrow', 0.12)
      || !row || typeof row.id !== 'string' || !row.id.startsWith('arrow:' + e.netPeer + ':')
      || !['x', 'y', 'z', 'vx', 'vy', 'vz'].every(k => netCombatFieldFinite(row[k]))
      || Math.hypot(row.vx, row.vy, row.vz) > 130 || Math.abs(row.y - e.y) > 4) return false;
    const arrow = netCombatFieldRead(row); if (!arrow || !ARROW_TYPES.includes(arrow.type)) return false;
    if (CLS.arrows.some(a => a.netFieldId === arrow.netFieldId)) return { ok: true };
    arrow.src = e.id; arrow.faction = e.faction; arrow.vis = false; arrow.netFieldPending = false;
    // Caster scaling comes from the admitted actor, not the requesting arrow row.
    arrow.level = clamp(+e.level || 1, 1, 50); arrow.dmgMult = clamp(+e.dmgMult || 1, 0, 10);
    arrow.age = 0; arrow.mult = clamp(+arrow.mult || 1, 0.1, 3); arrow.crit = clamp(+arrow.crit || 0, 0, 0.5);
    CLS.arrows.push(arrow); return { ok: true };
  } });
  netWorldPartsRegisterCommand('combat.arrow-recover', { range: 2,
    point: args => CLS.stuck.find(f => f.netFieldId === args.id) || { x: Infinity, z: Infinity },
    run: args => {
      const f = CLS.stuck.find(f => f.netFieldId === args.id), P = GAME.player;
      if (!f || f.src !== P.id || f.wall || f.type === 'plain' || !ARROW_DEF[f.type]) return false;
      CLS.stuck.splice(CLS.stuck.indexOf(f), 1);
      if (Math.random() < 0.6) goodsAdd(ARROW_DEF[f.type].good, 1, true);
      return { ok: true };
    } });
  updateClasses = function(dt) {
    const before = NET_COMBAT_FIELDS.ticking;
    NET_COMBAT_FIELDS.ticking = netCombatFieldsActive() && netEntityCanSimulateWorld();
    try { return raw.updateClasses(dt); } finally { NET_COMBAT_FIELDS.ticking = before; }
  };
  npcClassStep = function(e, dt) {
    if (netCombatFieldsActive() && (e.role === 'remote' || !netEntityCanSimulateWorld() && !netEntityOwnPet(e))) return;
    return raw.npcClassStep(e, dt);
  };
  stepArrows = function(dt) {
    if (netCombatFieldsActive()) {
      const ownsPhysics = netEntityCanSimulateWorld();
      for (const arrow of CLS.arrows) arrow.vis = !ownsPhysics || !!arrow.netFieldPending;
    }
    return raw.stepArrows(dt);
  };
  dealDamage = function(src, dst, amount, opts = {}) {
    if (!NET_COMBAT_FIELDS.applying && netCombatFieldSend(dst, { effect: 'damage', amount,
      source: netCombatFieldRef(src), opts: typeof netEntityPlain === 'function' ? netEntityPlain(opts) : {} })) return amount;
    return raw.dealDamage(src, dst, amount, opts);
  };
  healEnt = function(src, dst, amount, quiet = false) {
    if (!NET_COMBAT_FIELDS.applying && netCombatFieldSend(dst, { effect: 'heal', amount, source: netCombatFieldRef(src) })) return 0;
    return raw.healEnt(src, dst, amount, quiet);
  };
  addBuff = function(e, kind, value, dur, src = null, extra = null) {
    if (!NET_COMBAT_FIELDS.applying && netCombatFieldSend(e, { effect: 'buff', buff: kind, value, dur,
      source: netCombatFieldRef(getEnt(src)) })) return { kind, value, until: GAME.t + dur, src, tick: GAME.t };
    return raw.addBuff(e, kind, value, dur, src, extra);
  };
  addChill = function(e, amount, src) {
    if (!NET_COMBAT_FIELDS.applying && netCombatFieldSend(e, { effect: 'chill', amount, source: netCombatFieldRef(src) })) return;
    return raw.addChill(e, amount, src);
  };
  arrowHits = function(A, target, src) {
    if (!src && netCombatFieldsActive() && Number.isFinite(A.level)) src = { id: A.src, level: A.level,
      dmgMult: clamp(+A.dmgMult || 1, 0, 10), faction: A.faction, buffs: [], role: 'none', scale: 1,
      alive: false, x: A.x, y: A.y, z: A.z };
    return raw.arrowHits(A, target, src);
  };
  if (window.__hm) window.__hm.combatfields = { save: netCombatFieldsSave, apply: netCombatFieldsApply,
    state: () => ({ counts: Object.fromEntries(Object.keys(NET_FIELD_KEYS).map(k => [k, CLS[k].length])), stats: { ...NET_COMBAT_FIELDS.stats } }),
    freeze: (x, z, r = 5) => freezeWater(x, z, r, GAME.player),
    rune: el => layRune(GAME.player, GAME.player.x, GAME.player.z, el), visual: netCombatFieldsVisual };
});
