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
    if (!Array.isArray(incoming) || incoming.length > 32 || !incoming.every(r => r && typeof r === 'object' && safeJson(r))) return null;
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

export function createSharedScene({ hostFor, live, admission, stateFor, send, changed = () => {}, now = Date.now, canMutate = () => true, validatePersist = () => true, confirm = null, writeState = null }) {
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
        streamSeq: { entities: 0, worldparts: 0 }, pending: {}, commands: new Map(), pendingCommit: null, fenced: false };
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
      boats: s.boats.map(b => ({ ...(s.pendingCommit?.boat?.id === b.id ? s.pendingCommit.boat : b), rider: null })), npcs: s.npcs,
      entities: s.streams.entities ? { ...s.streams.entities, rows: s.streams.entities.rows.filter(row => !row.owner) } : null,
      worldparts: s.pendingCommit?.merged || s.streams.worldparts };
    if (!checkedSharedScene(candidate) || !validatePersist(room, candidate)) {
      Object.assign(s, { ...s.accepted, boats: s.accepted.boats.map(b => ({ ...b })),
        streams: { ...s.accepted.streams }, seq: { ...s.accepted.seq }, streamSeq: { ...s.accepted.streamSeq } });
      return false;
    }
    if (writeState) writeState(room, candidate); else stateFor(room).activity = candidate;
    s.persistedRef = candidate; s.accepted = accepted(s); s.dirty = true;
    if (force || now() - s.lastPersist >= 10000) { s.lastPersist = now(); s.dirty = false; changed(room); }
    return true;
  }
  function broadcast(room, message) {
    for (const c of room.clients.values()) if (live(c)) send(c, message);
  }
  function authorityFrame(s) {
    return { t: 'activity', kind: 'authority', authority: s.authority, peer: s.host, worldAdmission: s.worldAdmission,
      boats: s.boats, npcs: s.npcs, hasEntities: !!s.streams.entities, entitiesReady: !!s.streams.entities, worldpartsReady: !!s.pendingCommit || !!s.streams.worldparts };
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
    for (const kind of ['entities', 'worldparts']) if (s.streams[kind])
      for (const m of chunks(s, kind, s.streamSeq[kind], s.streams[kind])) send(c, m);
  }
  function sync(room, target = null) {
    if (!room || !canMutate()) return null;
    if (!sessions.has(room) && !hostFor(room)) return null;
    const s = session(room), host = hostFor(room)?.peer || ''; let released = false;
    // An accepted economic mutation is not available for another keeper to replay
    // until native storage confirms it. Late viewers hold the prior image.
    if (s.pendingCommit || s.fenced) {
      if (target && live(target) && target.sceneAuthority !== s.authority) tell(target, s);
      return s;
    }
    for (const b of s.boats) if (b.rider && ![...room.clients.values()].some(c => c.peer === b.rider && live(c))) {
      b.rider = null; b.vx = 0; b.vz = 0; released = true;
    }
    if (host !== s.host || !s.authority) {
      s.host = host; s.authority = randomBytes(16).toString('hex'); s.seq = { boats: -1, npcs: -1 };
      s.motion.clear(); s.pending = {}; s.streamSeq = { entities: 0, worldparts: 0 }; s.commands.clear(); s.accepted = accepted(s);
      for (const c of room.clients.values()) if (live(c)) tell(c, s);
    } else {
      if (released) broadcast(room, frame(s, 'boats', 'snapshot', s.boats));
      if (target && live(target) && target.sceneAuthority !== s.authority) tell(target, s);
    }
    if (released) persist(room, s, true);
    return s;
  }
  function refuse(c, s, m, reason) {
    send(c, frame(s, m.kind, m.op, [], { ok: false, id: m.id ?? m.boats?.[0]?.id, reason }));
    return false;
  }
  function boatRebuild(c, command, s) {
    const room = c.room, ownerAccount = c.acct?.id || c.peer;
    const prior = s.streams.worldparts?.receipts?.find(r => r.id === command.id && r.ownerAccount === ownerAccount);
    const receiptFrame = receipt => ({ t: 'activity', kind: 'worldparts', op: 'receipt', authority: s.authority,
      worldAdmission: s.worldAdmission, peer: s.host, receipt });
    if (prior) { send(c, receiptFrame(prior)); return true; }
    // The previous image remains public until its exact hull and economic
    // outcome are confirmed together. A racing builder retries against it.
    if (s.pendingCommit || !s.streams.worldparts) return false;
    const id = command.args?.id, boat = boatId(id) && s.boats.find(b => b.id === id);
    const goods = command.goods;
    const nearby = c.pos && now() - c.posT < 5000 && boat && Math.hypot(c.pos.x - boat.x, c.pos.z - boat.z) <= 18;
    const ok = !!(boat && boat.st === 'burnt' && nearby && Number.isSafeInteger(goods?.plank) && goods.plank >= 6
      && Number.isSafeInteger(goods?.tool_hammer) && goods.tool_hammer >= 1);
    const rebuilt = ok ? { ...boat, st: boat.grounded > 0.5 ? 'beached' : 'free', char: 0,
      vx: 0, vz: 0, wr: 0, eff: 0, ph: 0, rider: null, launch: null } : null;
    const receipt = { id: command.id, ownerAccount, to: c.peer, durable: true, digest: randomBytes(16).toString('hex'),
      ok, reason: ok ? '' : 'The boat is no longer burnt, within reach, or supplied with six planks and a hammer.',
      goods: ok ? [['plank', -6]] : [], gold: 0, items: [], notes: [], skills: [], result: { boatId: id ?? null } };
    const merged = sceneValue('worldparts', s.streams.worldparts, { ...s.streams.worldparts,
      receipts: [...s.streams.worldparts.receipts, receipt] });
    if (!merged) return false;
    const ticket = { merged, boat: rebuilt, payload: { receipts: merged.receipts }, worldAdmission: { ...s.worldAdmission } };
    s.pendingCommit = ticket;
    if (!persist(room, s, true)) { s.pendingCommit = null; return false; }
    let timer;
    const deadline = new Promise((_, reject) => { timer = setTimeout(() => reject(Error('World checkpoint deadline')), 15000); timer.unref?.(); });
    const current = () => sessions.get(room) === s && s.pendingCommit === ticket
      && s.persistedRef === stateFor(room).activity && sameAdmission(ticket.worldAdmission, admission());
    Promise.race([Promise.resolve().then(() => confirm?.(room)), deadline]).then(() => {
      if (!current()) return;
      s.streams.worldparts = ticket.merged;
      if (rebuilt) s.boats = s.boats.map(b => b.id === id ? rebuilt : b);
      s.pendingCommit = null; s.accepted = accepted(s);
      if (rebuilt) broadcast(room, frame(s, 'boats', 'restore', [rebuilt], { ok: true, id }));
      broadcast(room, receiptFrame(receipt));
      sync(room);
    }).catch(() => {
      if (!current()) return;
      s.fenced = true;
      broadcast(room, frame(s, 'worldparts', 'snapshot', [], { ok: false, reason: 'world_checkpoint_unconfirmed' }));
    }).finally(() => clearTimeout(timer));
    return true;
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
      const serialized = JSON.stringify(command), prior = seen.ids.get(id);
      if (++seen.count > 20 || !c.pos || now() - c.posT > 5000
        || prior && (kind !== 'worldparts' || prior.serialized !== serialized || now() - prior.at < 2000)) return false;
      seen.ids.set(id, { serialized, at: now() });
      if (seen.ids.size > 128) seen.ids.delete(seen.ids.keys().next().value);
      s.commands.set(c.peer, seen);
      if (kind === 'worldparts' && command.op === 'boat.rebuild') return boatRebuild(c, command, s);
      const host = room.clients.get(s.host);
      if (!host || !live(host)) return false;
      send(host, { t: 'activity', kind, op: 'command', authority: s.authority, worldAdmission: s.worldAdmission,
        peer: s.host, from: c.peer, ownerAccount: c.acct?.id || c.peer, position: { x: c.pos.x, z: c.pos.z }, realm: c.slow?.r ?? -1, at: now(), command });
      return true;
    }
    if (m.op === 'settled') {
      if (kind !== 'worldparts' || typeof m.id !== 'string' || !m.id || m.id.length > 100
        || typeof m.digest !== 'string' || !m.digest || m.digest.length > 200) return false;
      const ownerAccount = c.acct?.id || c.peer;
      const receipt = s.streams.worldparts?.receipts?.find(r => r.id === m.id && r.ownerAccount === ownerAccount);
      if (!receipt || (receipt.digest || 'legacy:' + receipt.id) !== m.digest) return false;
      const seen = s.commands.get(c.peer) || { at: now(), count: 0, ids: new Map() };
      if (now() - seen.at > 1000) { seen.at = now(); seen.count = 0; }
      if (++seen.count > 20) return false;
      s.commands.set(c.peer, seen);
      const settle = rows => (rows || []).map(r => r.id === receipt.id && r.ownerAccount === ownerAccount
        && (r.digest || 'legacy:' + r.id) === m.digest ? { ...r, settled: true } : r);
      s.streams.worldparts = { ...s.streams.worldparts, receipts: settle(s.streams.worldparts.receipts) };
      if (s.pendingCommit) {
        s.pendingCommit.merged.receipts = settle(s.pendingCommit.merged.receipts);
        if (s.pendingCommit.payload.receipts) s.pendingCommit.payload.receipts = settle(s.pendingCommit.payload.receipts);
      }
      if (!persist(room, s, true)) return refuse(c, s, m, 'scene_capacity');
      const host = room.clients.get(s.host);
      const acknowledged = { t: 'activity', kind, op: 'settled', authority: s.authority,
        worldAdmission: s.worldAdmission, peer: s.host, from: c.peer, ownerAccount, id: m.id, digest: m.digest };
      if (host && live(host)) send(host, acknowledged);
      if (host !== c) send(c, acknowledged);
      return true;
    }
    if (m.op === 'result') {
      if (c.peer !== s.host || typeof m.to !== 'string') return false;
      const target = room.clients.get(m.to);
      if (kind === 'worldparts') {
        const receipt = s.streams.worldparts?.receipts?.find(r => r.id === m.id && r.ownerAccount === (target?.acct?.id || target?.peer));
        if (!receipt || !target || !live(target) || receipt.digest !== m.digest) return false;
        send(target, { ...receipt, t: 'activity', kind, op: 'result', authority: s.authority,
          worldAdmission: s.worldAdmission, peer: s.host }); return true;
      }
      const result = kind !== 'worldparts' && m.result || Object.fromEntries(Object.entries(m).filter(([k]) =>
        !['t', 'kind', 'op', 'authority', 'worldAdmission', 'peer', 'to'].includes(k)));
      if (!target || !live(target) || !safeJson(result) || JSON.stringify(result).length > 6000) return false;
      send(target, { ...result, t: 'activity', kind, op: 'result', authority: s.authority,
        worldAdmission: s.worldAdmission, peer: s.host, ...(kind === 'worldparts' ? {} : { result }) }); return true;
    }
    if (m.op !== 'snapshot' || kind === 'worldparts' && s.pendingCommit || c.peer !== s.host || !Number.isSafeInteger(m.seq)
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
    const oldReceipts = s.streams.worldparts?.receipts || [];
    const economic = kind === 'worldparts' && typeof confirm === 'function' && merged.receipts.some(r => r.durable !== false &&
      !oldReceipts.some(old => old.id === r.id && old.ownerAccount === r.ownerAccount && old.digest === r.digest));
    if (economic) {
      const ticket = { merged, seq: m.seq, payload, worldAdmission: { ...s.worldAdmission } };
      s.pendingCommit = ticket;
      if (!persist(room, s, true)) { s.pendingCommit = null; return refuse(c, s, m, 'scene_capacity'); }
      let timer;
      const deadline = new Promise((_, reject) => { timer = setTimeout(() => reject(Error('World checkpoint deadline')), 15000); timer.unref?.(); });
      const current = () => sessions.get(room) === s && s.pendingCommit === ticket
        && s.persistedRef === stateFor(room).activity && sameAdmission(ticket.worldAdmission, admission());
      Promise.race([Promise.resolve().then(() => confirm(room)), deadline]).then(() => {
        if (!current()) return;
        s.streams.worldparts = merged; s.streamSeq.worldparts = ticket.seq; s.pendingCommit = null;
        s.accepted = accepted(s);
        for (const packet of chunks(s, kind, ticket.seq, { ...ticket.payload, receipts: merged.receipts })) broadcast(room, packet);
        sync(room);
      }).catch(() => {
        if (!current()) return;
        s.fenced = true;
        broadcast(room, frame(s, kind, 'snapshot', [], { ok: false, reason: 'world_checkpoint_unconfirmed' }));
      }).finally(() => clearTimeout(timer));
      return true;
    }
    s.streams[kind] = merged; s.streamSeq[kind] = m.seq;
    if (!persist(room, s)) return refuse(c, s, m, 'scene_capacity');
    const publicPayload = kind === 'worldparts' ? { ...payload, receipts: merged.receipts } : payload;
    for (const packet of chunks(s, kind, m.seq, publicPayload)) broadcast(room, packet);
    return true;
  }
  function handle(c, m) {
    if (!c.room || !live(c) || !canMutate()) return false;
    const room = c.room, s = sync(room);
    if (s.fenced) return false;
    if (!sameAdmission(m.worldAdmission, s.worldAdmission) || !sameAdmission(c.worldAdmission, s.worldAdmission)
      || m.authority !== s.authority) return refuse(c, s, m, 'stale_authority');
    if (['entities', 'worldparts'].includes(m.kind)) return streamHandle(c, m, s);
    if (!['boats', 'npcs'].includes(m.kind)) return false;
    if (m.op === 'snapshot') {
      if (c.peer !== s.host || !Number.isSafeInteger(m.seq) || m.seq <= s.seq[m.kind]) return false;
      const rows = rowsRead(m[m.kind], m.kind === 'boats' ? 128 : 64, m.kind === 'boats' ? activityBoat : activityNpc);
      if (!rows) return false;
      if (m.kind === 'boats') {
        const incoming = new Map(rows.map(b => [b.id, b]));
        for (const b of s.boats) if (b.rider || !incoming.has(b.id)
          || incoming.get(b.id).st === 'burnt' && !['burning', 'burnt'].includes(b.st)) incoming.set(b.id, b);
        if (incoming.size > 128) return false;
        s.boats = [...incoming.values()];
      } else s.npcs = rows;
      s.seq[m.kind] = m.seq; if (!persist(room, s)) return refuse(c, s, m, 'scene_capacity');
      broadcast(room, frame(s, m.kind, 'snapshot', s[m.kind])); return true;
    }
    if (m.kind !== 'boats') return false;
    const raw = m.boats?.[0], id = m.id ?? raw?.id, boat = s.boats.find(b => b.id === id);
    if (!boat) return refuse(c, s, m, 'boat_unavailable');
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
      Object.assign(boat, { st: 'burning', char: 0, rider: null, vx: 0, vz: 0 }); s.motion.delete(id);
      if (!persist(room, s, true)) return refuse(c, s, m, 'scene_capacity');
      broadcast(room, frame(s, 'boats', 'ignite', [boat], { ok: true, id })); return true;
    }
    if (m.op === 'restore') {
      // Paid player rebuilds require a private reservation and canonical receipt.
      // Unattended ambient replacement remains an elected-host snapshot.
      return false;
    }
    if (m.op === 'launch') {
      if (!nearby || boat.rider || Math.hypot(row.x - boat.x, row.z - boat.z) > 8) return false;
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
    const s = sessions.get(room), kept = stateFor(room).activity;
    return s?.pendingCommit && s.persistedRef === kept ? { ...kept, boats: s.boats.map(b => ({ ...b, rider: null })), worldparts: s.streams.worldparts } : kept;
  }
  return { handle, sync, leave, acceptsChunk, publicActivity };
}
