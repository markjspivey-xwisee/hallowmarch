// One bounded latest scene per game-owned world. No event history or idle timers.
import { randomBytes } from 'node:crypto';
const finite = (v, lo, hi) => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;
const sameAdmission = (a, b) => a?.origin === b?.origin && Number.isSafeInteger(a?.epoch) && a.epoch === b?.epoch;
const boatId = v => Number.isSafeInteger(v) && v >= 1 && v <= 128;
const array = (v, n, lo, hi) => Array.isArray(v) && v.length === n && v.every(x => finite(x, lo, hi));
const keyOk = s => typeof s === 'string' && s.length > 0 && s.length <= 128 && !['__proto__', 'constructor', 'prototype'].includes(s);
function safeJson(v, depth = 0) {
  if (depth > 36) return false;
  if (v === null || typeof v === 'boolean') return true;
  if (typeof v === 'number') return Number.isFinite(v);
  if (typeof v === 'string') return v.length <= 65536;
  if (Array.isArray(v)) return v.length <= 16384 && v.every(x => safeJson(x, depth + 1));
  return !!v && typeof v === 'object' && Object.entries(v).every(([k, x]) => keyOk(k) && safeJson(x, depth + 1));
}
export function activityBoat(r) {
  if (!r || !boatId(r.id) || !finite(r.x, -4000, 4000) || !finite(r.z, -4000, 4000)
    || !finite(r.yaw, -1000, 1000) || !finite(r.vx, -35, 35) || !finite(r.vz, -35, 35)
    || !['moored', 'free', 'beached', 'burning', 'burnt'].includes(r.st)) return null;
  const out = { id: r.id, x: r.x, z: r.z, yaw: r.yaw, vx: r.vx, vz: r.vz, st: r.st,
    wr: finite(r.wr, -10, 10) ? r.wr : 0, ph: finite(r.ph, 0, 1) ? r.ph : 0,
    eff: finite(r.eff, 0, 1) ? r.eff : 0, grounded: finite(r.grounded, 0, 1) ? r.grounded : 0,
    char: finite(r.char, 0, 1) ? r.char : 0, still: r.still === true, rider: null, home: null, launch: null };
  if (r.home && Number.isSafeInteger(r.home.j) && Number.isSafeInteger(r.home.b)
    && r.home.j >= 0 && r.home.j < 128 && r.home.b >= 0 && r.home.b < 128) out.home = { j: r.home.j, b: r.home.b };
  if (r.launch && finite(r.launch.t, 0, 30) && finite(r.launch.dx, -1, 1) && finite(r.launch.dz, -1, 1))
    out.launch = { t: r.launch.t, dx: r.launch.dx, dz: r.launch.dz };
  return out;
}
export function activityNpc(r) {
  if (!r || !/^town:[012]:(?:villager|herald|merchant):\d{1,2}$/.test(r.id)
    || !['villager', 'herald', 'merchant'].includes(r.role) || !Number.isInteger(r.r) || r.r < 0 || r.r > 2
    || r.id.split(':')[2] !== r.role || Number(r.id.split(':')[1]) !== r.r
    || typeof r.n !== 'string' || r.n.length > 56 || /[\u0000-\u001f\u007f]/.test(r.n)
    || !Number.isInteger(r.l) || r.l < 1 || r.l > 50
    || !array(r.p, 3, -4000, 4000) || Math.abs(r.p[1]) > 500 || !finite(r.y, -50, 50)
    || !finite(r.a, 0, 63.999) || !finite(r.ph, 0, Math.PI * 128) || !finite(r.am, 0, 4)
    || !finite(r.h, 0, 1e6) || !finite(r.m, 1, 1e6) || r.h > r.m
    || ![0, 1].includes(r.d) || ![0, 1].includes(r.g) || ![0, 1].includes(r.hm)
    || !array(r.lk, 15, 0, (1 << 25) - 1)) return null;
  if (r.st != null && (!array(r.st, 4, -4000, 4000) || Math.abs(r.st[0]) > 500 || Math.abs(r.st[1]) > 50)) return null;
  if (r.fm != null && (!Array.isArray(r.fm) || r.fm.length !== 3 || !Number.isInteger(r.fm[0]) || r.fm[0] < 0 || r.fm[0] > 2
    || ![0, 1].includes(r.fm[1]) || ![0, 1].includes(r.fm[2]))) return null;
  if (r.bt != null && !boatId(r.bt)) return null;
  return { id: r.id, role: r.role, n: r.n, r: r.r, c: typeof r.c === 'string' ? r.c.slice(0, 20) : null,
    l: r.l, p: r.p.slice(), y: r.y, a: r.a, ph: r.ph, am: r.am, h: r.h, m: r.m,
    d: r.d, g: r.g, lk: r.lk.slice(), st: r.st?.slice() || null, fm: r.fm?.slice() || null, hm: r.hm, bt: r.bt ?? null };
}
function rowsRead(rows, max, clean) {
  if (!Array.isArray(rows) || rows.length > max) return null;
  const ids = new Set(), out = [];
  for (const r of rows) { const value = clean(r); if (!value || ids.has(value.id)) return null; ids.add(value.id); out.push(value); }
  return out;
}
function sceneValue(kind, old, payload) {
  if (!payload || payload.v !== 1 || typeof payload.full !== 'boolean' || !safeJson(payload)) return null;
  let value;
  if (kind === 'entities') {
    if (!Array.isArray(payload.rows) || payload.rows.length > 2048 || !Array.isArray(payload.remove)
      || payload.remove.length > 2048 || !payload.remove.every(keyOk)) return null;
    const rows = new Map(payload.full ? [] : (old?.rows || []).map(r => [r.id, r])), seen = new Set();
    for (const row of payload.rows) {
      if (!row || !keyOk(row.id) || seen.has(row.id)) return null;
      seen.add(row.id); rows.set(row.id, payload.full ? row : { ...(rows.get(row.id) || {}), ...row });
    }
    for (const id of payload.remove) rows.delete(id);
    if (rows.size > 2048) return null;
    value = { v: 1, full: true, rows: [...rows.values()], remove: [], meta: Object.hasOwn(payload, 'meta') ? payload.meta : old?.meta ?? null };
  } else {
    if (!payload.parts || Array.isArray(payload.parts) || typeof payload.parts !== 'object'
      || Object.keys(payload.parts).length > 128 || !Array.isArray(payload.remove)
      || payload.remove.length > 128 || !payload.remove.every(keyOk)) return null;
    const parts = Object.assign(Object.create(null), payload.full ? {} : old?.parts || {}, payload.parts);
    for (const key of payload.remove) delete parts[key];
    if (Object.keys(parts).length > 128) return null;
    const incoming = payload.receipts === undefined ? old?.receipts || [] : payload.receipts;
    if (!Array.isArray(incoming) || incoming.length > 32 || !incoming.every(r => r && typeof r === 'object' && !Array.isArray(r) && safeJson(r)
      && (r.goods === undefined || Array.isArray(r.goods) && r.goods.length <= 256 && r.goods.every(row =>
        Array.isArray(row) && row.length === 2 && typeof row[0] === 'string' && row[0].length <= 64 && finite(row[1], -1e9, 1e9)))
      && (r.items === undefined || Array.isArray(r.items) && r.items.length <= 256)
      && (r.skills === undefined || Array.isArray(r.skills) && r.skills.length <= 256)
      && (r.gold === undefined || finite(r.gold, -1e9, 1e9))
      && (r.durable === undefined || typeof r.durable === 'boolean')
      && (r.settled === undefined || typeof r.settled === 'boolean'))) return null;
    const receiptKey = r => String(r.ownerAccount || r.to || '') + ':' + String(r.id) + ':' + String(r.digest || '');
    const prior = new Map((old?.receipts || []).map(r => [receiptKey(r), r]));
    const retained = new Map(incoming.map(r => {
      const before = prior.get(receiptKey(r));
      return [receiptKey(r), before?.settled ? { ...r, settled: true } : r];
    }));
    // An outcome remains canonical until its authenticated owner acknowledges private readback.
    for (const r of prior.values()) if (!r.settled && !retained.has(receiptKey(r))) retained.set(receiptKey(r), r);
    const waiting = [...retained.values()].filter(r => !r.settled);
    if (waiting.length > 24) return null;
    const recent = [...retained.values()].filter(r => r.settled).slice(-8);
    const receipts = [...waiting, ...recent];
    value = { v: 1, full: true, parts, remove: [], receipts };
  }
  // A cached full snapshot must itself fit the same 128 x 3500-char transport.
  const text = JSON.stringify(value);
  return text.length <= 448000 && Buffer.byteLength(text) <= 512 * 1024 ? value : null;
}
// Validate persisted scene structure without allocating sessions or consulting live authority.
export function checkedSharedScene(value) {
  if (!value || !safeJson(value) || value.v !== 1
    || Object.keys(value).some(k => !['v', 'worldAdmission', 'boats', 'npcs', 'entities', 'worldparts'].includes(k))
    || !value.worldAdmission || Object.keys(value.worldAdmission).some(k => !['origin', 'epoch'].includes(k))
    || !Number.isSafeInteger(value.worldAdmission.epoch) || value.worldAdmission.epoch < 1) return null;
  try { if (new URL(value.worldAdmission.origin).origin !== value.worldAdmission.origin) return null; } catch { return null; }
  const boats = rowsRead(value.boats, 128, activityBoat), npcs = rowsRead(value.npcs, 64, activityNpc);
  const entities = value.entities == null ? null : sceneValue('entities', null, value.entities);
  const worldparts = value.worldparts == null ? null : sceneValue('worldparts', null, value.worldparts);
  if (!boats || !npcs || value.entities != null && !entities || value.worldparts != null && !worldparts
    || value.boats.some(b => b.rider != null)) return null;
  const normalized = { v: 1, worldAdmission: { ...value.worldAdmission }, boats, npcs, entities, worldparts };
  return Buffer.byteLength(JSON.stringify(normalized)) <= 400 * 1024 ? normalized : null;
}


function stableScene(value) {
  if (Array.isArray(value)) return '[' + value.map(stableScene).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + stableScene(value[k])).join(',') + '}';
  return JSON.stringify(value);
}
function receiptNeedsCommit(receipt) {
  return receipt.durable !== false || (receipt.goods || []).some(row => Array.isArray(row) && row[1] !== 0)
    || !!receipt.gold || (receipt.items || []).length > 0 || (receipt.skills || []).length > 0;
}
function receiptChangesNeedCommit(before, after) {
  const prior = new Map((before?.receipts || []).map(r => [String(r.ownerAccount || r.to) + ':' + r.id, r]));
  return (after?.receipts || []).some(r => receiptNeedsCommit(r)
    && stableScene(r) !== stableScene(prior.get(String(r.ownerAccount || r.to) + ':' + r.id)));
}

export async function confirmOwnedSceneCheckpoint(world) {
  const target = world.capture().liveVersion;
  if (!Number.isSafeInteger(target) || target < 1) throw Error('Invalid owned checkpoint version');
  for (let pass = 0; pass < 3; pass++) {
    const state = world.status();
    if (state.fenced || state.error) throw Error('Owned world checkpoint is fenced');
    if (state.confirmedLiveVersion >= target) return;
    await world.checkpoint({ allowInactive: true });
  }
  const state = world.status();
  if (state.fenced || state.error || state.confirmedLiveVersion < target) throw Error('Owned world checkpoint was not confirmed');
}

export function createSharedScene({ hostFor, live, admission, stateFor, send, changed = () => {}, now = Date.now, canMutate = () => true, validatePersist = () => true, writeState = null, confirm = null, confirmPersist = confirm }) {
  const sessions = new WeakMap();
  function session(room) {
    const worldAdmission = admission(), persisted = stateFor(room).activity; let s = sessions.get(room);
    // Native recovery replaces the owned snapshot, even if its season epoch stays the same.
    // A cached unconfirmed scene must never reseed that recovered world.
    if (!s || s.persistedRef !== persisted || !sameAdmission(s.worldAdmission, worldAdmission)) {
      const kept = persisted, valid = kept?.v === 1 && sameAdmission(kept.worldAdmission, worldAdmission);
      s = { host: '', authority: '', worldAdmission, persistedRef: persisted,
        boats: valid ? rowsRead(kept.boats, 128, activityBoat) || [] : [],
        npcs: valid ? rowsRead(kept.npcs, 64, activityNpc) || [] : [],
        seq: { boats: -1, npcs: -1 }, motion: new Map(), lastPersist: -Infinity, dirty: false,
        streams: { entities: valid ? sceneValue('entities', null, kept.entities) : null,
          worldparts: valid ? sceneValue('worldparts', null, kept.worldparts) : null },
        streamSeq: { entities: 0, worldparts: 0 }, pending: {}, commands: new Map() };
      s.burntSince = new Map(s.boats.filter(b => b.st === 'burnt').map(b => [b.id, now()])); s.rebuildAwaitSnapshot = new Set();
      s.publicWorldparts = s.streams.worldparts; s.publicWorldSeq = 0; s.worldBarrier = null;
      s.needsReadback = typeof confirmPersist === 'function' && !!s.publicWorldparts?.receipts?.some(receiptNeedsCommit);
      if (s.needsReadback) s.publicWorldparts = null;
      s.accepted = accepted(s); sessions.set(room, s);
    }
    return s;
  }
  function accepted(s) {
    return { boats: s.boats.map(b => ({ ...b })), npcs: s.npcs, streams: { ...s.streams },
      seq: { ...s.seq }, streamSeq: { ...s.streamSeq } };
  }
  function persist(room, s, force = false) {
    const candidate = { v: 1, worldAdmission: s.worldAdmission,
      boats: s.boats.map(b => ({ ...(s.pendingBoatRebuild?.id === b.id ? s.pendingBoatRebuild : b), rider: null })), npcs: s.npcs,
      entities: s.streams.entities ? { ...s.streams.entities, rows: s.streams.entities.rows.filter(row => !row.owner) } : null,
      worldparts: s.streams.worldparts };
    if (!checkedSharedScene(candidate) || !validatePersist(room, candidate)) {
      Object.assign(s, { ...s.accepted, boats: s.accepted.boats.map(b => ({ ...b })),
        streams: { ...s.accepted.streams }, seq: { ...s.accepted.seq }, streamSeq: { ...s.accepted.streamSeq } });
      return false;
    }
    (writeState ? writeState(room, candidate) : stateFor(room).activity = candidate); s.persistedRef = candidate; s.accepted = accepted(s); s.dirty = true;
    if (force || now() - s.lastPersist >= 10000) { s.lastPersist = now(); s.dirty = false; changed(room); }
    return true;
  }
  function broadcast(room, message) {
    for (const c of room.clients.values()) if (live(c)) send(c, message);
  }
  function authorityFrame(s) {
    return { t: 'activity', kind: 'authority', authority: s.authority, peer: s.host, worldAdmission: s.worldAdmission,
      boats: s.boats, npcs: s.npcs, hasEntities: !!s.streams.entities, entitiesReady: !!s.streams.entities, worldpartsReady: !!(s.publicWorldparts || s.worldBarrier || s.needsReadback) };
  }
  function frame(s, kind, op, rows, extra = {}) {
    return { t: 'activity', kind, op, authority: s.authority, peer: s.host, worldAdmission: s.worldAdmission,
      seq: s.seq[kind], [kind]: rows, ...extra };
  }
  function chunks(s, kind, seq, payload) {
    const text = JSON.stringify(payload), out = [], total = Math.ceil(text.length / 3500);
    for (let part = 0; part < total; part++) out.push({ t: 'activity', kind, op: 'snapshot',
      authority: s.authority, peer: s.host, worldAdmission: s.worldAdmission, seq, part, total,
      data: text.slice(part * 3500, (part + 1) * 3500) });
    return out;
  }
  function tell(c, s) {
    send(c, authorityFrame(s)); c.sceneAuthority = s.authority;
    for (const kind of ['entities', 'worldparts']) {
      const value = kind === 'worldparts' ? (!s.worldBarrier && !s.needsReadback ? s.publicWorldparts : null) : s.streams[kind];
      if (value) for (const m of chunks(s, kind, kind === 'worldparts' ? s.publicWorldSeq : s.streamSeq[kind], value)) send(c, m);
    }
  }
  function sync(room, target = null) {
    if (!room || !canMutate() || !sessions.has(room) && !hostFor(room)) return null;
    const s = session(room), selected = hostFor(room), host = selected && live(selected) ? selected.peer : ''; let released = false;
    for (const b of s.boats) if (b.rider && ![...room.clients.values()].some(c => c.peer === b.rider && live(c))) {
      b.rider = null; b.vx = 0; b.vz = 0; released = true;
    }
    if (host !== s.host || !s.authority) {
      s.host = host; s.authority = randomBytes(16).toString('hex'); s.seq = { boats: -1, npcs: -1 };
      s.motion.clear(); s.pending = {}; s.rebuildAwaitSnapshot.clear(); s.rebuildReceiptAwaitHost = null; s.streamSeq = { entities: 0, worldparts: 0 }; s.commands.clear(); s.publicWorldSeq = 0; s.accepted = accepted(s);
      for (const c of room.clients.values()) if (live(c)) tell(c, s);
    } else {
      if (released) broadcast(room, frame(s, 'boats', 'snapshot', s.boats));
      if (target && live(target) && target.sceneAuthority !== s.authority) tell(target, s);
    }
    if (released) persist(room, s, true);
    if (host && s.worldBarrier?.failed && now() - s.worldBarrier.lastAttempt >= 3000) void s.worldBarrier.retry();
    if (s.needsReadback && !s.worldBarrier) {
      s.needsReadback = false;
      confirmWorldParts(room, s, s.streams.worldparts, null, () => {
        for (const packet of chunks(s, 'worldparts', 0, s.publicWorldparts)) broadcast(room, packet);
      });
    }
    return s;
  }
  function refuse(c, s, m, reason) {
    send(c, frame(s, m.kind, m.op, [], { ok: false, id: m.id ?? m.boats?.[0]?.id, reason }));
    return false;
  }

  function confirmWorldParts(room, s, target, requester, publish) {
    const required = typeof confirmPersist === 'function' && (s.needsReadback || receiptChangesNeedCommit(s.publicWorldparts, target)
      || !s.publicWorldparts && target?.receipts?.some(receiptNeedsCommit));
    if (!required) {
      s.publicWorldparts = target;
      publish(false); return true;
    }
    const record = { target, authority: s.authority, candidate: stateFor(room).activity, boatIds: s.pendingBoatRebuild ? [s.pendingBoatRebuild.id] : [], failed: false, promise: null, lastAttempt: -Infinity, retry: null };
    s.worldBarrier = record;
    record.retry = () => {
      record.failed = false; record.lastAttempt = now();
      record.promise = Promise.resolve().then(() => confirmPersist(room, record.candidate, { boatIds: record.boatIds })).then(() => {
      if (sessions.get(room) !== s || s.worldBarrier !== record || s.persistedRef !== stateFor(room).activity
        || s.streams.worldparts !== target || !sameAdmission(s.worldAdmission, admission()) || !canMutate())
        throw new Error('The owned world changed during outcome confirmation.');
      s.publicWorldparts = target; s.worldBarrier = null; s.needsReadback = false;
      publish(s.authority !== record.authority);
      return true;
    }).catch(() => {
      if (sessions.get(room) === s && s.worldBarrier === record) {
        record.failed = true;
        if (requester && live(requester)) refuse(requester, s, { kind: 'worldparts', op: 'snapshot' }, 'checkpoint_unconfirmed');
      }
      return false;
      });
      return record.promise;
    };
    return record.retry();
  }


  function receiptPacket(s, receipt) {
    return { ...receipt, t: 'activity', kind: 'worldparts', op: 'receipt',
      authority: s.authority, worldAdmission: s.worldAdmission, peer: s.host };
  }
  function rebuildBoat(c, command, s) {
    if (typeof command.id !== 'string' || !s.streams.worldparts || s.worldBarrier) return false;
    const ownerAccount = c.acct?.id || c.peer;
    const prior = s.publicWorldparts?.receipts?.find(r => r.id === command.id && r.ownerAccount === ownerAccount);
    if (prior) { send(c, receiptPacket(s, prior)); return true; }
    if (s.pending.worldparts && now() - s.pending.worldparts.at > 30000) delete s.pending.worldparts;
    if (s.rebuildReceiptAwaitHost || s.pending.worldparts) return false;
    if ((s.streams.worldparts.receipts || []).filter(r => !r.settled).length >= 24) return false;
    const id = command.args?.id, boat = s.boats.find(b => b.id === id), goods = command.goods;
    const declared = goods && !Array.isArray(goods) && goods.plank === 6 && goods.tool_hammer === 1
      && Object.keys(goods).every(k => ['plank', 'tool_hammer'].includes(k));
    const nearby = boat && c.pos && now() - c.posT <= 5000 && Math.hypot(c.pos.x - boat.x, c.pos.z - boat.z) <= 18;
    const valid = !!(boatId(id) && command.args && Object.keys(command.args).length === 1
      && declared && nearby && boat.st === 'burnt' && !boat.rider);
    const receipt = { id: command.id, to: c.peer, ownerAccount, digest: randomBytes(16).toString('hex'),
      action: 'boat.rebuild', durable: valid, ok: !!valid, goods: valid ? [['plank', -6]] : [],
      gold: 0, items: [], skills: [], result: valid ? { boatId: id } : null,
      reason: valid ? '' : !declared ? 'rebuild_materials_required' : !nearby ? 'boat_out_of_reach' : 'boat_not_burnt' };
    const restored = valid ? { ...boat, st: boat.grounded > 0.5 ? 'beached' : 'free', char: 0,
      vx: 0, vz: 0, wr: 0, ph: 0, eff: 0, launch: null, rider: null, still: false } : null;
    const before = s.streams.worldparts;
    s.streams.worldparts = sceneValue('worldparts', before, { v: 1, full: false, parts: {}, remove: [], receipts: [...before.receipts, receipt] });
    if (!s.streams.worldparts) { s.streams.worldparts = before; return false; }
    s.pendingBoatRebuild = restored;
    if (!persist(c.room, s, true)) { s.pendingBoatRebuild = null; return false; }
    return confirmWorldParts(c.room, s, s.streams.worldparts, c, changedAuthority => {
      if (restored) {
        s.boats = s.boats.map(b => b.id === restored.id ? { ...restored } : b);
        s.pendingBoatRebuild = null; s.burntSince.delete(restored.id); s.rebuildAwaitSnapshot.add(restored.id); s.accepted = accepted(s);
        broadcast(c.room, frame(s, 'boats', 'rebuild', [{ ...restored }], { ok: true, id: restored.id }));
      }
      if (changedAuthority) {
        s.publicWorldSeq = 0;
        for (const packet of chunks(s, 'worldparts', 0, s.publicWorldparts)) broadcast(c.room, packet);
      }
      s.rebuildReceiptAwaitHost = { id: receipt.id, ownerAccount, digest: receipt.digest };
      broadcast(c.room, receiptPacket(s, receipt));
    });
  }
  function streamHandle(c, m, s) {
    const room = c.room, kind = m.kind;
    if (m.op === 'command') {
      const command = m.command;
      if (!command || typeof command !== 'object' || !safeJson(command) || JSON.stringify(command).length > 6000
        || !(typeof command.id === 'string' && command.id.length <= 100 || Number.isSafeInteger(command.id))) return false;
      const seen = s.commands.get(c.peer) || { at: now(), count: 0, ids: new Map() };
      if (now() - seen.at > 1000) { seen.at = now(); seen.count = 0; }
      const id = kind + ':' + command.id;
      const serialized = stableScene(command), prior = seen.ids.get(id);
      if (++seen.count > 20 || !c.pos || now() - c.posT > 5000
        || prior && (kind !== 'worldparts' || prior.serialized !== serialized || now() - prior.at < 2000)) return false;
      const stamp = { serialized, at: now(), ...(prior?.towerBrand ? { towerBrand: prior.towerBrand } : {}) };
      seen.ids.set(id, stamp);
      if (seen.ids.size > 128) seen.ids.delete(seen.ids.keys().next().value);
      s.commands.set(c.peer, seen); const host = room.clients.get(s.host);
      if (!host || !live(host)) return false;
      if (kind === 'worldparts' && command.op === 'boat.rebuild') return rebuildBoat(c, command, s);
      let actorState;
      if (kind === 'worldparts' && command.op === 'tower.brand') {
        const args = command.args, fast = c.fast;
        if (!args || Array.isArray(args) || Object.keys(args).length !== 1 || !Number.isSafeInteger(args.id) || args.id < 0 || args.id > 511
          || Object.keys(command.goods || {}).length) return false;
        if (!stamp.towerBrand) {
          if (!fast || !Array.isArray(fast.p) || fast.p.length !== 3 || !fast.p.every(Number.isFinite) || Math.abs(fast.p[1]) > 500
            || fast.d !== 0 || !Number.isInteger(fast.fl) || !(fast.fl & 2) || !Number.isFinite(fast.a)
            || [14, 18].includes(Math.floor(fast.a))) return false;
          stamp.towerBrand = { actorState: { alive: true, brand: true, y: fast.p[1], motion: null },
            position: { x: c.pos.x, z: c.pos.z }, realm: c.slow?.r ?? -1 };
        }
        actorState = stamp.towerBrand.actorState;
      }
      send(host, { t: 'activity', kind, op: 'command', authority: s.authority, worldAdmission: s.worldAdmission,
        peer: s.host, from: c.peer, ownerAccount: c.acct?.id || c.peer,
        position: stamp.towerBrand?.position || { x: c.pos.x, z: c.pos.z }, realm: stamp.towerBrand?.realm ?? c.slow?.r ?? -1, at: now(), command,
        ...(actorState ? { actorState } : {}) });
      return true;
    }
    if (kind === 'worldparts' && s.worldBarrier && ['snapshot', 'settled'].includes(m.op)) return false;
    if (kind === 'worldparts' && m.op === 'settled') {
      if (typeof m.id !== 'string' || !m.id || m.id.length > 100
        || typeof m.digest !== 'string' || !m.digest || m.digest.length > 200) return false;
      const ownerAccount = c.acct?.id || c.peer;
      const receipt = s.streams.worldparts?.receipts?.find(r => r.id === m.id && r.ownerAccount === ownerAccount);
      if (!receipt || (receipt.digest || 'legacy:' + receipt.id) !== m.digest) return false;
      const seen = s.commands.get(c.peer) || { at: now(), count: 0, ids: new Map() };
      if (now() - seen.at > 1000) { seen.at = now(); seen.count = 0; }
      if (++seen.count > 20) return false;
      s.commands.set(c.peer, seen);
      if (!receipt.settled) {
        s.streams.worldparts = { ...s.streams.worldparts, receipts: s.streams.worldparts.receipts.map(r =>
          r === receipt ? { ...r, settled: true } : r) };
        if (!persist(room, s, true)) return refuse(c, s, m, 'scene_capacity');
      }
      const acknowledge = () => {
        const host = room.clients.get(s.host);
        const acknowledged = { t: 'activity', kind, op: 'settled', authority: s.authority,
          worldAdmission: s.worldAdmission, peer: s.host, from: c.peer, ownerAccount, id: m.id, digest: m.digest };
        if (host && live(host)) send(host, acknowledged);
        if (host !== c && live(c)) send(c, acknowledged);
      };
      return confirmWorldParts(room, s, s.streams.worldparts, c, acknowledge);
    }
    if (m.op === 'result') {
      if (c.peer !== s.host || typeof m.to !== 'string') return false;
      const target = room.clients.get(m.to);
      const result = kind !== 'worldparts' && m.result || Object.fromEntries(Object.entries(m).filter(([k]) =>
        !['t', 'kind', 'op', 'authority', 'worldAdmission', 'peer', 'to'].includes(k)));
      if (!target || !live(target) || !safeJson(result) || JSON.stringify(result).length > 6000) return false;
      if (kind === 'worldparts') {
        const receipt = s.publicWorldparts?.receipts?.find(r => r.id === result.id && r.ownerAccount === (target.acct?.id || target.peer)
          && (r.digest || 'legacy:' + r.id) === (result.digest || 'legacy:' + result.id));
        if (!receipt) return false;
        send(target, { ...receipt, to: target.peer, t: 'activity', kind, op: 'result', authority: s.authority,
          worldAdmission: s.worldAdmission, peer: s.host }); return true;
      }
      send(target, { ...result, t: 'activity', kind, op: 'result', authority: s.authority,
        worldAdmission: s.worldAdmission, peer: s.host, result }); return true;
    }
    if (m.op !== 'snapshot' || c.peer !== s.host || !Number.isSafeInteger(m.seq)
      || m.seq <= s.streamSeq[kind] || !Number.isInteger(m.part) || !Number.isInteger(m.total)
      || m.total < 1 || m.total > 128 || m.part < 0 || m.part >= m.total
      || typeof m.data !== 'string' || m.data.length > 3500) return false;
    let pending = s.pending[kind];
    if (!pending || pending.seq !== m.seq) {
      if (pending && m.seq < pending.seq) return false;
      pending = s.pending[kind] = { seq: m.seq, total: m.total, at: now(), parts: new Map(), size: 0 };
    }
    if (pending.total !== m.total || now() - pending.at > 30000) { delete s.pending[kind]; return false; }
    if (pending.parts.has(m.part)) return pending.parts.get(m.part) === m.data;
    pending.parts.set(m.part, m.data); pending.size += Buffer.byteLength(m.data);
    if (pending.size > 512 * 1024) { delete s.pending[kind]; return false; }
    if (pending.parts.size !== pending.total) return true;
    let payload;
    try { payload = JSON.parse([...Array(pending.total)].map((_, i) => pending.parts.get(i)).join('')); }
    catch { delete s.pending[kind]; return false; }
    delete s.pending[kind]; const merged = sceneValue(kind, s.streams[kind], payload);
    if (!merged) return false;
    if (kind === 'worldparts' && s.rebuildReceiptAwaitHost && payload.receipts?.some(r =>
      r.id === s.rebuildReceiptAwaitHost.id && r.ownerAccount === s.rebuildReceiptAwaitHost.ownerAccount
      && r.digest === s.rebuildReceiptAwaitHost.digest)) s.rebuildReceiptAwaitHost = null;
    s.streams[kind] = merged; s.streamSeq[kind] = m.seq;
    if (!persist(room, s)) return refuse(c, s, m, 'scene_capacity');
    const publish = changedAuthority => {
      const publicPayload = kind === 'worldparts' ? changedAuthority ? s.publicWorldparts : { ...payload, receipts: s.publicWorldparts.receipts } : payload;
      const seq = changedAuthority ? 0 : m.seq;
      if (kind === 'worldparts') s.publicWorldSeq = seq;
      for (const packet of chunks(s, kind, seq, publicPayload)) broadcast(room, packet);
    };
    if (kind === 'worldparts') return confirmWorldParts(room, s, merged, c, publish);
    publish(false); return true;
  }
  function handle(c, m) {
    if (!c.room || !live(c) || !canMutate()) return false;
    const room = c.room, s = sync(room);
    // Buffered input from a retired scope must not manufacture a refusal in
    // the current scope: that would fence a client which has already resumed.
    if (!sameAdmission(m.worldAdmission, s.worldAdmission) || !sameAdmission(c.worldAdmission, s.worldAdmission)
      || m.authority !== s.authority) return false;
    if (['entities', 'worldparts'].includes(m.kind)) return streamHandle(c, m, s);
    if (!['boats', 'npcs'].includes(m.kind)) return false;
    if (m.op === 'snapshot') {
      if (c.peer !== s.host || !Number.isSafeInteger(m.seq) || m.seq <= s.seq[m.kind]) return false;
      const rows = rowsRead(m[m.kind], m.kind === 'boats' ? 128 : 64, m.kind === 'boats' ? activityBoat : activityNpc);
      if (!rows) return false;
      if (m.kind === 'boats') {
        const incoming = new Map(rows.map(b => [b.id, b]));
        for (const b of s.boats) {
          const row = incoming.get(b.id);
          const terminalRegression = b.st === 'burnt' && row?.st !== 'burnt'
            || b.st === 'burning' && !['burning', 'burnt'].includes(row?.st);
          const staleBurn = s.rebuildAwaitSnapshot.has(b.id) && ['burning', 'burnt'].includes(row?.st)
            && !['burning', 'burnt'].includes(b.st);
          if (b.rider || s.pendingBoatRebuild?.id === b.id || !row || terminalRegression || staleBurn) incoming.set(b.id, b);
          else if (s.rebuildAwaitSnapshot.has(b.id)) s.rebuildAwaitSnapshot.delete(b.id);
        }
        if (incoming.size > 128) return false;
        s.boats = [...incoming.values()];
        for (const b of s.boats) if (b.st === 'burnt' && !s.burntSince.has(b.id)) s.burntSince.set(b.id, now());
      } else s.npcs = rows;
      s.seq[m.kind] = m.seq; if (!persist(room, s)) return refuse(c, s, m, 'scene_capacity');
      broadcast(room, frame(s, m.kind, 'snapshot', s[m.kind])); return true;
    }
    if (m.kind !== 'boats') return false;
    const raw = m.boats?.[0], id = m.id ?? raw?.id, boat = s.boats.find(b => b.id === id);
    if (!boat) return refuse(c, s, m, 'boat_unavailable');
    if (s.pendingBoatRebuild?.id === id) return refuse(c, s, m, 'rebuild_confirmation_pending');
    const nearby = c.pos && now() - c.posT < 5000 && Math.hypot(c.pos.x - boat.x, c.pos.z - boat.z) <= 18;
    if (m.op === 'board') {
      if (!nearby || (boat.rider && boat.rider !== c.peer) || s.boats.some(b => b.id !== id && b.rider === c.peer)
        || ['burning', 'burnt'].includes(boat.st)) return refuse(c, s, m, 'boat_occupied_or_out_of_reach');
      boat.rider = c.peer; s.motion.set(id, { at: now(), seq: -1 });
      if (!persist(room, s, true)) return refuse(c, s, m, 'scene_capacity');
      broadcast(room, frame(s, 'boats', 'board', [boat], { ok: true, id })); return true;
    }
    if (m.op === 'leave') {
      if (boat.rider !== c.peer) return refuse(c, s, m, 'not_rider');
      boat.rider = null; boat.vx = 0; boat.vz = 0; s.motion.delete(id);
      if (!persist(room, s, true)) return refuse(c, s, m, 'scene_capacity');
      broadcast(room, frame(s, 'boats', 'leave', [boat], { ok: true, id })); return true;
    }
    const row = activityBoat(m.op === 'ignite' ? boat : raw);
    if (!row) return false;
    const prior = s.motion.get(id) || { at: now(), seq: -1 };
    if (m.op === 'state' || m.op === 'moor') {
      if (boat.rider !== c.peer || !Number.isSafeInteger(m.seq) || m.seq <= prior.seq) return false;
      const dt = Math.min(3, Math.max(0.05, (now() - prior.at) / 1000));
      if (Math.hypot(row.x - boat.x, row.z - boat.z) > 4 + 25 * dt) return false;
      Object.assign(boat, row, { rider: m.op === 'moor' ? null : c.peer });
      if (m.op === 'moor') { boat.vx = 0; boat.vz = 0; }
      s.motion.set(id, { at: now(), seq: m.seq });
      if (!persist(room, s, m.op === 'moor')) return refuse(c, s, m, 'scene_capacity');
      broadcast(room, frame(s, 'boats', m.op, [boat], { ok: true, id })); return true;
    }
    if (m.op === 'ignite') {
      if ((!nearby && !(m.ambient === true && c.peer === s.host)) || ['burning', 'burnt'].includes(boat.st)) return false;
      Object.assign(boat, { st: 'burning', char: 0, rider: null, vx: 0, vz: 0 }); s.motion.delete(id); s.burntSince.delete(id); s.rebuildAwaitSnapshot.delete(id);
      if (!persist(room, s, true)) return refuse(c, s, m, 'scene_capacity');
      broadcast(room, frame(s, 'boats', 'ignite', [boat], { ok: true, id })); return true;
    }
    if (m.op === 'replace') {
      const age = now() - (s.burntSince.get(id) ?? now());
      const unattended = [...room.clients.values()].filter(live).every(p => p.pos && now() - p.posT <= 5000
        && Math.hypot(p.pos.x - boat.x, p.pos.z - boat.z) > 30);
      if (c.peer !== s.host || m.ambient !== true || boat.st !== 'burnt' || !boat.home || age < 300000 || !unattended
        || row.st !== 'moored' || !row.home || row.home.j !== boat.home.j || row.home.b !== boat.home.b
        || row.char !== 0 || row.vx !== 0 || row.vz !== 0 || row.wr !== 0) return false;
      Object.assign(boat, row, { rider: null, launch: null, char: 0 });
      s.burntSince.delete(id); s.rebuildAwaitSnapshot.add(id);
      if (!persist(room, s)) return refuse(c, s, m, 'scene_capacity');
      broadcast(room, frame(s, 'boats', 'replace', [boat], { ok: true, id })); return true;
    }
    if (m.op === 'restore') return refuse(c, s, m, 'durable_rebuild_required');
    if (m.op === 'launch') {
      if (!nearby || boat.rider || ['burning', 'burnt'].includes(boat.st) || Math.hypot(row.x - boat.x, row.z - boat.z) > 8) return false;
      Object.assign(boat, row, { rider: null });
      if (!persist(room, s, true)) return refuse(c, s, m, 'scene_capacity');
      broadcast(room, frame(s, 'boats', 'launch', [boat], { ok: true, id })); return true;
    }
    return false;
  }
  function leave(c) {
    if (!c.room || !canMutate() || !sessions.has(c.room)) return;
    const s = session(c.room); let released = false;
    const owned = s.streams.entities?.rows.filter(row => row.owner === c.peer).map(row => row.id) || [];
    if (owned.length) s.streams.entities = { ...s.streams.entities, rows: s.streams.entities.rows.filter(row => row.owner !== c.peer) };
    for (const b of s.boats) if (b.rider === c.peer) { b.rider = null; b.vx = 0; b.vz = 0; released = true; }
    if (released) { persist(c.room, s, true); broadcast(c.room, frame(s, 'boats', 'leave', s.boats)); }
    else if (s.dirty || owned.length) persist(c.room, s, true);
    if (owned.length) broadcast(c.room, { t: 'activity', kind: 'entities', op: 'owner-left', authority: s.authority,
      worldAdmission: s.worldAdmission, peer: s.host, owner: c.peer, ids: owned });
    s.commands.delete(c.peer); sync(c.room);
  }
  function acceptsChunk(c, m) {
    if (!c.room || !live(c) || !canMutate()) return false;
    const s = sessions.get(c.room);
    return !!s && s.persistedRef === stateFor(c.room).activity && c.peer === s.host && hostFor(c.room)?.peer === c.peer
      && m.authority === s.authority && sameAdmission(m.worldAdmission, admission())
      && sameAdmission(c.worldAdmission, m.worldAdmission);
  }
  function publicActivity(room) {
    const kept = stateFor(room).activity, s = sessions.get(room);
    if (!kept) return kept;
    if (s && s.persistedRef === kept) return { ...kept, boats: s.boats.map(b => ({ ...b, rider: null })), worldparts: s.publicWorldparts };
    // A cold retained outcome is read back by the first live sync before exposure.
    return typeof confirmPersist === 'function' && kept.worldparts?.receipts?.some(receiptNeedsCommit)
      ? { ...kept, worldparts: null } : kept;
  }
  return { handle, sync, leave, acceptsChunk, publicActivity };
}
