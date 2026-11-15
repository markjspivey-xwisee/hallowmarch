/* Public class effects belong to the shared scene. Caster resources and held
 * actions remain private; the keeper alone advances hazards and projectiles. */
const NET_COMBAT_FIELDS = { next: 0, ticking: false, applying: false, area: null, actor: null, cooldowns: new Map(),
  fast: new Map(), retired: new Set(), scope: '',
  stats: { created: 0, applied: 0, commands: 0, effects: 0, refusedEffects: 0 } };
const NET_FIELD_KEYS = { arrows: 128, stuck: 60, snares: 64, grounds: 6, runes: 96, ice: 7, steam: 8 };
const NET_FIELD_SCALARS = ['x', 'y', 'z', 'px', 'py', 'pz', 'ox', 'oy', 'oz', 'vx', 'vy', 'vz',
  'dx', 'dy', 'dz', 'yaw', 'wy', 'r', 'faction', 'realm', 'level', 'type', 'el', 'tick', 'rk', 'sanct',
  'close', 'thule', 'age', 'mult', 'crit', 'wind', 'wall', 'dmgMult', 'k'];
const netCombatFieldsActive = () => typeof netWorldPartsActive === 'function' && netWorldPartsActive();
const netCombatFieldFinite = v => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= 1e6;
const netCombatFieldRef = e => !e ? null : e.role === 'remote' ? 'peer:' + e.netPeer
  : e === GAME.player ? 'peer:' + NET.self : e.netNpcId || e.netEntityId || null;
const netCombatFieldEnt = id => typeof netEntityFind === 'function' ? netEntityFind(id) : null;
function netCombatFieldId(field, prefix = 'field') {
  if (!field.netFieldId) field.netFieldId = prefix + ':' + (NETPARTS.authority || 'local').slice(0, 12) + ':' + (++NET_COMBAT_FIELDS.next);
  return field.netFieldId;
}
function netCombatFieldRememberRetired(id) {
  NET_COMBAT_FIELDS.retired.add(id);
  if (NET_COMBAT_FIELDS.retired.size > 512) NET_COMBAT_FIELDS.retired.delete(NET_COMBAT_FIELDS.retired.values().next().value);
}
function netCombatFieldsReset() {
  const applying = NET_COMBAT_FIELDS.applying; NET_COMBAT_FIELDS.applying = true;
  try { for (const [id, entry] of NET_COMBAT_FIELDS.fast) {
    const field = CLS[entry.kind].find(f => f.netFieldId === id);
    if (field) netCombatFieldRemove(entry.kind, field);
  } } finally { NET_COMBAT_FIELDS.applying = applying; }
  NET_COMBAT_FIELDS.fast.clear(); NET_COMBAT_FIELDS.retired.clear(); NET_COMBAT_FIELDS.scope = '';
}
function netCombatFieldScope() {
  const scope = JSON.stringify([NETPARTS.authority, NETPARTS.admission?.origin, NETPARTS.admission?.epoch]);
  if (scope !== NET_COMBAT_FIELDS.scope) { netCombatFieldsReset(); NET_COMBAT_FIELDS.scope = scope; }
}
function netCombatFieldAnnounce(kind, field, op = 'create', target = null) {
  if (!netCombatFieldsActive() || !netEntityCanSimulateWorld() || NETPARTS.applying || NET_COMBAT_FIELDS.applying) return;
  if (!['grounds', 'steam', 'runes'].includes(kind)) return;
  const id = netCombatFieldId(field);
  const scope = JSON.stringify([NETPARTS.authority, NETPARTS.admission?.origin, NETPARTS.admission?.epoch]);
  if (field.netFieldScope !== scope) { field.netFieldScope = scope; field.netFieldPeers = new Map(); field.netFieldRetired = false; }
  if (op === 'create' && (field.dead || !Number.isFinite(field.until) || GAME.t >= field.until)) return;
  if (op === 'retire' && field.netFieldRetired) return;
  field.netFieldPeers ||= new Map();
  const peers = target ? [target] : op === 'retire' ? [...field.netFieldPeers.keys()].map(netPeer => ({ netPeer }))
    : ENT.filter(e => e.role === 'remote' && e.alive && !e.removed && e.netPeer
      && NET.peers?.get(e.netPeer)?.slow?.on === 1 && dist2(e.x, e.z, field.x, field.z) <= 80 * 80).slice(0, 64);
  if (op === 'retire') field.netFieldRetired = true;
  for (const peer of peers) {
    if (typeof peer.netPeer !== 'string' || !peer.netPeer || peer.netPeer.length > 32
      || op === 'create' && field.netFieldPeers.has(peer.netPeer) && field.netFieldPeers.get(peer.netPeer) === peer.id) continue;
    const result = { id: NETPARTS.authority + ':field-' + op + ':' + (++NET_COMBAT_FIELDS.next),
      kind: 'class-field', op, fieldKind: kind, fieldId: id,
      ...(op === 'create' ? { field: netCombatFieldPack(field) } : {}) };
    if (netEntitySend('result', { to: peer.netPeer, result }) !== false && op === 'create') {
      if (field.netFieldPeers.size >= 64 && !field.netFieldPeers.has(peer.netPeer)) field.netFieldPeers.delete(field.netFieldPeers.keys().next().value);
      field.netFieldPeers.set(peer.netPeer, peer.id);
    }
  }
}
function netCombatFieldCreate(kind, create) {
  const before = CLS[kind].slice(), result = create();
  for (const old of before) if (!CLS[kind].includes(old)) netCombatFieldAnnounce(kind, old, 'retire');
  for (const field of CLS[kind]) if (!before.includes(field)) netCombatFieldAnnounce(kind, field);
  return result;
}
function netCombatFieldAnnouncement(result) {
  netCombatFieldScope();
  const kind = result.fieldKind, id = result.fieldId;
  if (!['grounds', 'steam', 'runes'].includes(kind) || typeof id !== 'string' || !id || id.length > 100
    || !['create', 'retire'].includes(result.op)) return true;
  const fields = CLS[kind];
  if (result.op === 'retire') {
    const field = fields.find(f => f.netFieldId === id);
    if (field) netCombatFieldRemove(kind, field);
    NET_COMBAT_FIELDS.fast.delete(id); netCombatFieldRememberRetired(id); return true;
  }
  if (NET_COMBAT_FIELDS.retired.has(id)) return true;
  const row = result.field;
  if (!row || typeof row !== 'object' || Array.isArray(row) || row.id !== id
    || Object.keys(row).some(k => ['__proto__', 'constructor', 'prototype'].includes(k))
    || !Number.isFinite(row.life) || row.life <= 0 || row.life > (kind === 'grounds' ? 12 : kind === 'steam' ? 10 : 30)) return true;
  const next = netCombatFieldRead(row);
  if (!next || !Number.isFinite(next.until) || (kind === 'runes' ? !ELEMENTS.includes(next.el)
    : !Number.isFinite(next.r) || next.r <= 0 || next.r > 25)) return true;
  let field = fields.find(f => f.netFieldId === id);
  if (field) {
    next.until = Math.min(field.until, next.until);
    if (Number.isFinite(field.armAt) && Number.isFinite(next.armAt)) next.armAt = Math.min(field.armAt, next.armAt);
    Object.assign(field, next);
    if (field.mark) field.mark.until = Math.min(field.mark.until, field.until);
  } else {
    if (fields.length >= NET_FIELD_KEYS[kind]) {
      const old = fields[0]; netCombatFieldRemove(kind, old);
      NET_COMBAT_FIELDS.fast.delete(old.netFieldId); netCombatFieldRememberRetired(old.netFieldId);
    }
    field = next; fields.push(field); netCombatFieldVisualMake(kind, field);
  }
  const previous = NET_COMBAT_FIELDS.fast.get(id);
  NET_COMBAT_FIELDS.fast.set(id, { kind, field, projected: previous?.projected || false });
  return true;
}
function netCombatFieldAreaRun(kind, field, radius, run) {
  const previous = NET_COMBAT_FIELDS.area, previousActor = NET_COMBAT_FIELDS.actor;
  if (typeof netEntitySourceStamp === 'function') field.netFieldActor = netEntitySourceStamp(getEnt(field.src)) || field.netFieldActor;
  NET_COMBAT_FIELDS.area = netCombatFieldsActive() && NET_COMBAT_FIELDS.ticking ? {
    v: 1, kind, id: netCombatFieldId(field), x: field.x, z: field.z, r: radius,
  } : null;
  NET_COMBAT_FIELDS.actor = NET_COMBAT_FIELDS.area ? field.netFieldActor || null : null;
  try { return run(); } finally { NET_COMBAT_FIELDS.area = previous; NET_COMBAT_FIELDS.actor = previousActor; }
}
function netCombatFieldAreaAccept(area, player) {
  if (!area || area.v !== 1 || !['grounds', 'steam', 'runes'].includes(area.kind)
    || Object.keys(area).some(key => !['v', 'kind', 'id', 'x', 'z', 'r'].includes(key))
    || typeof area.id !== 'string' || !area.id || area.id.length > 100
    || ![area.x, area.z, area.r].every(netCombatFieldFinite) || Math.abs(area.x) > 4000 || Math.abs(area.z) > 4000
    || area.r <= 0 || area.r > 25 || !Number.isFinite(player?.x) || !Number.isFinite(player?.z)) return false;
  const field = CLS[area.kind].find(f => f.netFieldId === area.id && !f.dead && !f.netFieldPending);
  if (!field || !Number.isFinite(field.until) || GAME.t >= field.until
    || !Number.isFinite(field.x) || !Number.isFinite(field.z)
    || Math.abs(field.x - area.x) > 0.01 || Math.abs(field.z - area.z) > 0.01
    || (area.kind === 'runes' ? area.r !== 5 : !Number.isFinite(field.r) || Math.abs(field.r - area.r) > 0.01)
    || (area.kind !== 'steam' && player.flying)) return false;
  return dist2(player.x, player.z, area.x, area.z) <= area.r * area.r;
}
function netCombatFieldPack(field) {
  const row = { id: netCombatFieldId(field) };
  for (const key of NET_FIELD_SCALARS) if (field[key] != null && ['number', 'string', 'boolean'].includes(typeof field[key]))
    row[key] = typeof field[key] === 'number' ? Math.round(field[key] * 1000) / 1000 : field[key];
  for (const key of ['src', 'owner', 'tgt', 'caught']) if (field[key] != null) row[key] = netCombatFieldRef(getEnt(field[key]));
  if (!row.src && typeof field.netFieldSource === 'string') row.src = field.netFieldSource;
  const source = getEnt(field.src);
  if (typeof netEntitySourceStamp === 'function') field.netFieldActor = netEntitySourceStamp(source) || field.netFieldActor;
  if (field.netFieldActor) row.actor = { ...field.netFieldActor };
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
  if (typeof row.src === 'string' && row.src.length <= 100) f.netFieldSource = row.src;
  if (row.actor != null) {
    const actor = typeof netEntitySourceRead === 'function' && netEntitySourceRead(row.actor);
    if (!actor) return null;
    f.netFieldActor = netEntitySourceStamp(actor);
  }
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
    f.mark = aoeMarker(f.x, f.z, 5, Math.max(0, f.until - GAME.t), f.faction);
    f.cut = spellDisc(f.x, f.z, 2.2, DISC_KIND.runecut, Math.max(0.1, f.until - GAME.t), [1, 1, 1], 0.04);
    f.disc = spellDisc(f.x, f.z, 2.2, DISC_KIND.rune, Math.max(0.1, f.until - GAME.t), ELEM_COL[f.el] || ELEM_COL.fire);
    if (f.cut) f.cut.owner = f; if (f.disc) f.disc.owner = f;
  } else if (kind === 'grounds') {
    f.disc = spellDisc(f.x, f.z, f.r, DISC_KIND.consecrate, Math.max(0.1, f.until - GAME.t),
      f.realm === 2 ? [2.2, 1.3, 0.6] : f.realm === 1 ? [1.2, 1.9, 1] : [1.9, 1.6, 0.9]);
  } else if (kind === 'steam') steamPuff(f.x, heightAt(f.x, f.z) + 0.5, f.z, 8);
}
function netCombatFieldVisualEnd(kind, f) {
  if (kind === 'runes' && f.mark) f.mark.until = Math.min(f.mark.until, GAME.t);
  if (kind === 'ice') {
    if (f.floor && typeof bFloorRemove === 'function') bFloorRemove(f.floor);
    iceSheetEnd(f);
  }
  else if (kind === 'snares') snareEnd(f);
  else if (kind === 'runes') {
    if (CLS.runes.includes(f)) runeEnd(f);
    else { f.dead = true; for (const disc of [f.disc, f.cut]) if (disc?.on) disc.age = Math.max(disc.age, disc.dur - 0.4); }
  }
  else if (f.disc && f.disc.on) f.disc.age = Math.max(f.disc.age, f.disc.dur - 0.3);
}
function netCombatFieldRemove(kind, field) {
  netCombatFieldVisualEnd(kind, field);
  const index = CLS[kind].indexOf(field); if (index >= 0) CLS[kind].splice(index, 1);
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
  netCombatFieldScope();
  NET_COMBAT_FIELDS.applying = true;
  try {
    for (const kind of Object.keys(NET_FIELD_KEYS)) {
      const old = new Map(CLS[kind].map(f => [f.netFieldId, f])), keep = new Set(), result = [];
      for (const row of prepared[kind]) {
        if (NET_COMBAT_FIELDS.retired.has(row.netFieldId)) continue;
        let f = old.get(row.netFieldId); const fresh = !f;
        const fast = NET_COMBAT_FIELDS.fast.get(row.netFieldId);
        if (fast) {
          row.until = Math.min(fast.field.until, row.until);
          if (Number.isFinite(fast.field.armAt) && Number.isFinite(row.armAt)) row.armAt = Math.min(fast.field.armAt, row.armAt);
          fast.projected = true;
        }
        if (!f) f = row; else Object.assign(f, row);
        if (f.mark && Number.isFinite(f.until)) f.mark.until = Math.min(f.mark.until, f.until);
        if (fast) fast.field = f;
        f.netFieldPending = false;
        if (kind === 'arrows') f.vis = NETPARTS.peer !== NET.self;
        if (fresh) netCombatFieldVisualMake(kind, f);
        else if (kind === 'ice') netCombatFieldIceRefresh(f);
        keep.add(f.netFieldId); result.push(f);
      }
      for (const f of CLS[kind].slice()) if (!keep.has(f.netFieldId)) {
        // A freshly loosed owner arrow is a local preview until its canonical receipt arrives.
        if (f.netFieldPending) { result.push(f); continue; }
        const fast = NET_COMBAT_FIELDS.fast.get(f.netFieldId);
        if (fast && !fast.projected && GAME.t < f.until) { result.push(f); continue; }
        if (fast) netCombatFieldRememberRetired(f.netFieldId);
        NET_COMBAT_FIELDS.fast.delete(f.netFieldId);
        netCombatFieldVisualEnd(kind, f);
      }
      const cap = NET_FIELD_KEYS[kind];
      for (const old of result.slice(0, Math.max(0, result.length - cap))) {
        netCombatFieldRemove(kind, old); NET_COMBAT_FIELDS.fast.delete(old.netFieldId);
        netCombatFieldRememberRetired(old.netFieldId);
      }
      CLS[kind] = result.slice(-cap);
    }
    CLS.frozen = new Set((Array.isArray(frame.frozen) ? frame.frozen : []).slice(0, 256)
      .map(netCombatFieldEnt).filter(Boolean).map(e => e.id));
    NET_COMBAT_FIELDS.stats.applied++;
  } finally { NET_COMBAT_FIELDS.applying = false; }
}
function netCombatFieldsVisual(dt) {
  if (!netCombatFieldsActive() || netEntityCanSimulateWorld()) return;
  netCombatFieldScope();
  for (const kind of ['ice', 'snares', 'runes', 'grounds', 'steam']) for (const f of CLS[kind].slice()) {
    if (GAME.t >= f.until) {
      NET_COMBAT_FIELDS.fast.delete(f.netFieldId);
      if (['grounds', 'steam', 'runes'].includes(kind)) netCombatFieldRememberRetired(f.netFieldId);
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
  const area = NET_COMBAT_FIELDS.area;
  if (area) {
    const field = CLS[area.kind].find(f => f.netFieldId === area.id);
    if (field) netCombatFieldAnnounce(area.kind, field, 'create', dst);
  }
  return netEntitySend('result', { to: dst.netPeer, result: { id: NETPARTS.authority + ':field:' + (++NET_COMBAT_FIELDS.next),
    kind: 'class-effect', ...effect, ...(NET_COMBAT_FIELDS.area ? { area: { ...NET_COMBAT_FIELDS.area } } : {}),
    ...(NET_COMBAT_FIELDS.actor ? { sourceActor: { ...NET_COMBAT_FIELDS.actor } } : {}) } }) !== false;
}
function netCombatFieldResult(result) {
  if (result.kind === 'class-field') return netCombatFieldAnnouncement(result);
  if (result.kind !== 'class-effect') return false;
  const P = GAME.player; if (!P?.alive) return true;
  if (Object.hasOwn(result, 'area') && !netCombatFieldAreaAccept(result.area, P)) {
    NET_COMBAT_FIELDS.stats.refusedEffects++; return true;
  }
  const instant = result.effect === 'buff' ? result.extra : result.opts;
  if (Object.hasOwn(instant || {}, 'area')
    && (typeof netEntityAreaAccept !== 'function' || !netEntityAreaAccept(instant.area, P))) {
    NET_COMBAT_FIELDS.stats.refusedEffects++; return true;
  }
  const field = result.area ? CLS[result.area.kind].find(f => f.netFieldId === result.area.id) : null;
  const source = netCombatFieldEnt(result.source)
    || (typeof netEntitySourceRead === 'function' && (netEntitySourceRead(result.sourceActor)
      || field && (netEntitySourceRead(field.netFieldActor)
        || netEntitySourceRead({ name: result.area.kind === 'steam' ? 'Scalding steam' : result.area.kind === 'runes' ? 'A ground rune' : 'Holy ground',
          level: field.level, faction: field.faction, kind: 'hazard', role: 'hazard', cls: null }))));
  if (!source) { NET_COMBAT_FIELDS.stats.refusedEffects++; return true; }
  NET_COMBAT_FIELDS.applying = true;
  try {
    if (result.effect === 'damage' && Number.isFinite(result.amount) && result.amount > 0)
      dealDamage(source, P, Math.min(result.amount, baseDmg(source.level) * 40), result.opts || {});
    else if (result.effect === 'heal' && Number.isFinite(result.amount) && result.amount > 0)
      healEnt(source, P, Math.min(result.amount, P.maxHp));
    else if (result.effect === 'chill' && Number.isFinite(result.amount)) addChill(P, clamp(result.amount, 0, 3), source);
    else if (result.effect === 'buff' && typeof result.buff === 'string'
      && (Object.hasOwn(NET_BUFFS, result.buff) || ['blind', 'hallowed', 'frozen'].includes(result.buff)))
      addBuff(P, result.buff, clamp(+result.value || 0, 0, Math.max(P.maxHp, 100)), clamp(+result.dur || 0, 0, 30), source.id,
        { ...(result.extra || {}), sourceActor: netEntitySourceStamp(source), sourceFaction: source.faction });
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
  const raw = { frostLands, freezeWater, steamAt, fireMeetsIce, layRune, runeEnd, laySnare, consecrate, raiseFallen, netOnArrow,
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
    return netCombatFieldCreate('steam', () => raw.steamAt(x, z, r, src, dur));
  };
  fireMeetsIce = function(x, z, r, src) {
    if (src === GAME.player && netWorldPartsRequest('combat.melt', { x, z, r })) return;
    return raw.fireMeetsIce(x, z, r, src);
  };
  layRune = function(e, x, z, el) {
    if (e === GAME.player && netWorldPartsRequest('combat.rune', { x, z, el })) return null;
    return netCombatFieldCreate('runes', () => raw.layRune(e, x, z, el));
  };
  runeEnd = function(field) {
    const result = raw.runeEnd(field); netCombatFieldAnnounce('runes', field, 'retire'); return result;
  };
  laySnare = function(e) {
    if (e === GAME.player && netWorldPartsRequest('combat.snare', { x: e.x, z: e.z })) return null;
    return raw.laySnare(e);
  };
  consecrate = function(e, A, t, cast, rk) {
    if (e === GAME.player && netWorldPartsRequest('combat.consecrate', { x: e.x, z: e.z, rk })) {
      csOf(e).dev = Math.max(0, devOf(e) - 35); return;
    }
    return netCombatFieldCreate('grounds', () => raw.consecrate(e, A, t, cast, rk));
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
      else if (op === 'steam') netCombatFieldCreate('steam', () => raw.steamAt(args.x, args.z, r, e, clamp(+args.dur || 5, 0.1, 10)));
      else if (op === 'melt') raw.fireMeetsIce(args.x, args.z, r, e);
      else if (op === 'rune') { if (!ELEMENTS.includes(args.el)) return false; netCombatFieldCreate('runes', () => raw.layRune(e, args.x, args.z, args.el)); }
      else if (op === 'snare') raw.laySnare(e);
      else if (op === 'consecrate') netCombatFieldCreate('grounds', () => raw.consecrate(e, ABILITIES.consecrate, null, null, rk));
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
    arrow.netFieldActor = typeof netEntitySourceStamp === 'function' ? netEntitySourceStamp(e) : null;
    arrow.netFieldSource = netCombatFieldRef(e);
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
    const fields = NET_COMBAT_FIELDS.ticking ? Object.fromEntries(['grounds', 'steam', 'runes'].map(kind => [kind, CLS[kind].slice()])) : {};
    try { return raw.updateClasses(dt); } finally {
      for (const [kind, old] of Object.entries(fields)) for (const field of old)
        if (!CLS[kind].includes(field)) netCombatFieldAnnounce(kind, field, 'retire');
      NET_COMBAT_FIELDS.ticking = before;
    }
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
      source: netCombatFieldRef(src), sourceActor: typeof netEntitySourceStamp === 'function' ? netEntitySourceStamp(src) : null,
      opts: typeof netEntityPlain === 'function' ? netEntityPlain(opts) : {} })) return amount;
    return raw.dealDamage(src, dst, amount, opts);
  };
  healEnt = function(src, dst, amount, quiet = false) {
    if (!NET_COMBAT_FIELDS.applying && netCombatFieldSend(dst, { effect: 'heal', amount, source: netCombatFieldRef(src),
      sourceActor: typeof netEntitySourceStamp === 'function' ? netEntitySourceStamp(src) : null })) return 0;
    return raw.healEnt(src, dst, amount, quiet);
  };
  addBuff = function(e, kind, value, dur, src = null, extra = null) {
    if (!NET_COMBAT_FIELDS.applying && netCombatFieldSend(e, { effect: 'buff', buff: kind, value, dur,
      source: netCombatFieldRef(getEnt(src)), sourceActor: typeof netEntitySourceStamp === 'function' ? netEntitySourceStamp(getEnt(src)) : null,
      extra: typeof netEntityPlain === 'function' ? netEntityPlain(extra) : null })) return { kind, value, until: GAME.t + dur, src, tick: GAME.t };
    return raw.addBuff(e, kind, value, dur, src, extra);
  };
  addChill = function(e, amount, src) {
    if (!NET_COMBAT_FIELDS.applying && netCombatFieldSend(e, { effect: 'chill', amount, source: netCombatFieldRef(src),
      sourceActor: typeof netEntitySourceStamp === 'function' ? netEntitySourceStamp(src) : null })) return;
    return raw.addChill(e, amount, src);
  };
  arrowHits = function(A, target, src) {
    if (!src && netCombatFieldsActive() && Number.isFinite(A.level)) {
      const remembered = typeof netEntitySourceRead === 'function' && netEntitySourceRead(A.netFieldActor);
      src = { ...(remembered || {}), id: A.src, level: A.level,
        dmgMult: clamp(+A.dmgMult || 1, 0, 10), faction: A.faction, buffs: [], role: remembered?.role || 'none', scale: 1,
        alive: false, x: A.x, y: A.y, z: A.z };
    }
    return raw.arrowHits(A, target, src);
  };
  if (window.__hm) window.__hm.combatfields = { save: netCombatFieldsSave, apply: netCombatFieldsApply,
    state: () => ({ counts: Object.fromEntries(Object.keys(NET_FIELD_KEYS).map(k => [k, CLS[k].length])), stats: { ...NET_COMBAT_FIELDS.stats } }),
    freeze: (x, z, r = 5) => freezeWater(x, z, r, GAME.player),
    rune: el => layRune(GAME.player, GAME.player.x, GAME.player.z, el), visual: netCombatFieldsVisual };
});
