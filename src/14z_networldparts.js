/* Shared mutable world save parts. Personal save parts never enter this channel. */
const NETPARTS = { authority: '', peer: '', admission: null, ready: false, seq: 0, readSeq: -1,
  key: '', sentAt: -Infinity, assembly: null, keys: {}, pending: new Map(), commands: new Map(),
  receipts: [], confirmedReceipts: new Set(), resultQueue: new Map(), notes: [], skills: [], lootSeq: 0, outbox: null, awaiting: null, paused: '', outAt: -Infinity, sentKeys: {}, receiptsKey: '', replay: false, applying: false, next: 0, received: 0, sent: 0, refused: 0, settled: new Map(), privateFlight: null, privateScope: null, privateError: '', privateAttempt: 0, journalLoaded: false, settleAt: -Infinity };
const NETPART_ADAPTERS = new Map(), NETPART_COMMANDS = new Map(), NETPART_RESULTS = new Map(), NETPART_FAILURES = new Map();
const netWorldPartsActive = () => typeof NETWS !== 'undefined' && !!NETWS.url;
const netWorldPartsConnected = () => netWorldPartsActive() && NETWS.state === 'on' && netOn()
  && netHumanLive() && netSharedWorldReady() && !!NETPARTS.authority && !NETPARTS.paused;
function netWorldPartsCanSimulate() {
  return !netWorldPartsActive() || netWorldPartsConnected() && NETPARTS.peer === NET.self && NETPARTS.ready;
}
function netWorldPartsRegister(key, adapter) { NETPART_ADAPTERS.set(key, adapter); }
function netWorldPartsRegisterCommand(op, command) { NETPART_COMMANDS.set(op, command); }
function netWorldPartsRegisterResult(op, receive) { NETPART_RESULTS.set(op, receive); }
function netWorldPartsRegisterFailure(op, receive) { NETPART_FAILURES.set(op, receive); }
function netWorldPartsOwnerScope(row) {
  return !!row && typeof row.ownerAccount === 'string' && !!row.ownerAccount && typeof SAVE !== 'undefined' && !SAVE.wiping
    && row.ownerAccount === NETWS.acct?.id && row.profileRef === SAVE.ref && row.playerRef === GAME.player;
}
function netWorldPartsBindOwner(row) {
  return { ...row, profileRef: SAVE.ref, playerRef: GAME.player };
}
function netWorldPartsReset() {
  NETPARTS.authority = ''; NETPARTS.peer = ''; NETPARTS.ready = false; NETPARTS.readSeq = -1;
  NETPARTS.assembly = null; NETPARTS.outbox = null; NETPARTS.awaiting = null; NETPARTS.paused = ''; NETPARTS.resultQueue.clear(); NETPARTS.confirmedReceipts.clear(); NETPARTS.keys = {}; NETPARTS.sentKeys = {}; NETPARTS.key = ''; NETPARTS.sentAt = -Infinity;
}
const netPartsClone = value => JSON.parse(JSON.stringify(value));
const netPartsEqualAdmission = a => !!a && !!NETPARTS.admission && a.origin === NETPARTS.admission.origin
  && a.epoch === NETPARTS.admission.epoch;
function netWorldPartsCapture() {
  const parts = {};
  for (const [key, adapter] of NETPART_ADAPTERS) {
    const data = adapter.save();
    if (data != null) parts[key] = data;
  }
  return { v: 1, full: true, parts, remove: [], receipts: NETPARTS.receipts.slice(-32) };
}
function netWorldPartsApply(frame) {
  if (!frame || frame.v !== 1 || !frame.parts || typeof frame.parts !== 'object' || Array.isArray(frame.parts)) return false;
  NETPARTS.applying = true;
  try {
    for (const [key, adapter] of NETPART_ADAPTERS) {
      const present = Object.hasOwn(frame.parts, key), removed = frame.full || (frame.remove || []).includes(key);
      if (!present && !removed) continue;
      const value = present ? frame.parts[key] : null, serial = JSON.stringify(value);
      if (NETPARTS.keys[key] === serial) continue;
      adapter.apply(value);
      NETPARTS.keys[key] = serial;
    }
    if (Array.isArray(frame.receipts)) {
      NETPARTS.receipts = frame.receipts.slice(-32);
      NETPARTS.confirmedReceipts = new Set(NETPARTS.receipts.map(r => r.ownerAccount + ':' + r.id));
      netWorldPartsConfirmSettled(NETPARTS.receipts);
      for (const receipt of NETPARTS.receipts) {
        const pending = NETPARTS.pending.get(receipt.id);
        if (pending && pending.ownerAccount === receipt.ownerAccount) netWorldPartsResult(receipt);
      }
    }
    NETPARTS.ready = true; NETPARTS.received++;
    return true;
  } finally { NETPARTS.applying = false; }
}
function netWorldPartsPublish(now, force = false) {
  if (!netWorldPartsConnected() || NETPARTS.peer !== NET.self || !NETPARTS.ready || NETPARTS.outbox || NETPARTS.awaiting
    || !force && now - NETPARTS.sentAt < 1500) return false;
  const frame = netWorldPartsCapture(), full = !NETPARTS.key;
  const nextKeys = {}, changed = {};
  for (const [key, value] of Object.entries(frame.parts)) {
    nextKeys[key] = JSON.stringify(value);
    if (full || nextKeys[key] !== NETPARTS.sentKeys[key]) changed[key] = value;
  }
  const remove = Object.keys(NETPARTS.sentKeys).filter(key => !Object.hasOwn(nextKeys, key));
  const receiptsKey = JSON.stringify(frame.receipts);
  if (!Object.keys(changed).length && !remove.length && receiptsKey === NETPARTS.receiptsKey && !full) return false;
  const serial = JSON.stringify({ ...frame, full, parts: changed, remove });
  if (serial.length > 350000) { NETPARTS.refused++; return false; }
  const seq = ++NETPARTS.seq, total = Math.max(1, Math.ceil(serial.length / 3000));
  NETPARTS.outbox = { seq, total, part: 0, serial, nextKeys, receiptsKey, authority: NETPARTS.authority };
  NETPARTS.sentAt = now;
  return true;
}
function netWorldPartsOutcomeFits(delta, items) {
  for (const [id, n] of delta) {
    const have = INV.goods[id] || 0;
    if (n > 0 && have + n > GOODS[id].stack || n < 0 && have < -n) return false;
  }
  // Match bagAdd's junk stacking on copies before accepting any reward.
  const bag = INV.bag.map(item => ({ ...item }));
  for (const item of items) {
    const stack = item.slot === 'junk' && bag.find(other => other.slot === 'junk' && other.name === item.name
      && (other.n || 1) + (item.n || 1) <= 20);
    if (stack) stack.n = (stack.n || 1) + (item.n || 1);
    else { if (bag.length >= BAG_SIZE) return false; bag.push({ ...item }); }
  }
  return true;
}
function netWorldPartsResult(m) {
  const p = NETPARTS.pending.get(m.id);
  if (!p || !netWorldPartsOwnerScope(p) || m.ownerAccount !== p.ownerAccount) return;
  if (p.phase === 'applied') { if (p.durable) void netWorldPartsFlushJournal(); return; }
  // Reserved costs were removed on request. Return unused costs and apply only
  // this command's receipt; never replace the character's inventory or progress.
  const delta = new Map(p.cost.map(([id, n]) => [id, n]));
  if (m.ok && Array.isArray(m.goods)) for (const [id, n] of m.goods)
    if (GOODS[id] && Number.isFinite(n) && Math.abs(n) <= 9999) delta.set(id, (delta.get(id) || 0) + n);
  const items = m.ok && Array.isArray(m.items) ? m.items.filter(item => item && typeof item.id === 'string') : [];
  if (!netWorldPartsOutcomeFits(delta, items)) {
    p.owedReceipt = netPartsClone(m);
    if (!p.capacityBlocked) uiError('Make room in your packs to receive the waiting shared action. Its reward is kept for you.');
    p.capacityBlocked = true; return;
  }
  delete p.owedReceipt; p.capacityBlocked = false;
  for (const [id, n] of delta) if (n > 0) goodsAdd(id, n, true);
  else if (n < 0) goodsTake(id, -n);
  if (!m.ok && typeof uiError === 'function') uiError(m.reason || 'The shared world refused that action. Try again.');
  if (m.ok && Number.isFinite(m.gold) && m.gold > 0) addGold(m.gold);
  for (const item of items) bagAdd(item);
  if (m.ok && Array.isArray(m.notes)) for (const id of m.notes) if (typeof id === 'string') loreNote(id);
  if (m.ok && Array.isArray(m.skills)) for (const [key, amount] of m.skills) if (Number.isFinite(amount) && amount > 0) skillGain(key, amount);
  if (m.ok && m.result?.pieceId && typeof BUILD !== 'undefined') {
    const pc = BUILD.pieces.find(b => b.id === m.result.pieceId);
    if (pc && pc.st === 'build') BUILD.work = { pc, x: GAME.player.x, z: GAME.player.z, t: 0, auto: true };
  }
  if (m.ok && NETPART_RESULTS.has(p.op)) NETPART_RESULTS.get(p.op)(m.result, m, p);
  if (!m.ok && NETPART_FAILURES.has(p.op)) NETPART_FAILURES.get(p.op)(m, p);
  p.phase = 'applied'; p.outcomeToken = m.digest || 'legacy:' + m.id;
  NETPARTS.settled.set(m.id, netWorldPartsBindOwner({ id: m.id, ownerAccount: p.ownerAccount,
    digest: p.outcomeToken, confirmed: !p.durable, acknowledged: false, lastSent: -Infinity }));
  if (p.durable) void netWorldPartsFlushJournal();
  else { NETPARTS.pending.delete(m.id); netWorldPartsSendSettled(); }
  GOODS_UI.dirty = true; saveSoon();
}
function netWorldPartsExecute(m) {
  if (!netWorldPartsConnected() || NETPARTS.resultQueue.size >= 32) return;
  const c = m.command, spec = c && NETPART_COMMANDS.get(c.op);
  if (!spec || typeof c.id !== 'string' || c.id.length > 100) return;
  const prior = NETPARTS.receipts.find(r => r.id === c.id && r.ownerAccount === m.ownerAccount);
  if (prior) {
    const key = prior.ownerAccount + ':' + prior.id;
    if (NETPARTS.confirmedReceipts.has(key)) netWsSend({ t: 'activity', kind: 'worldparts', op: 'result',
      authority: NETPARTS.authority, worldAdmission: NETPARTS.admission, ...prior, to: m.from });
    else NETPARTS.resultQueue.set(key, { ...prior, to: m.from });
    return;
  }
  // One slot remains available for a server-created canonical outcome.
  if (NETPARTS.receipts.filter(r => !r.settled).length >= 23) return;
  const peer = NET.peers.get(m.from), actor = ['tower.brand', 'warband.order'].includes(c.op) && typeof spec.actor === 'function'
    ? spec.actor(m) : m.from === NET.self ? GAME.player : peer?.ghost;
  const position = m.position;
  const location = spec.point?.(c.args);
  if (!actor || !position || !Number.isFinite(position.x) || !Number.isFinite(position.z)
    || location && Math.hypot(location.x - position.x, location.z - position.z) > (spec.range || 14)) return;
  const declared = {};
  for (const [id, n] of Object.entries(c.goods || {})) if (GOODS[id] && Number.isSafeInteger(n) && n >= 0 && n <= GOODS[id].stack) declared[id] = n;
  const before = { ...declared }, saved = { player: GAME.player, prog: GAME.prog, goods: INV.goods, gold: INV.gold,
    buildWork: typeof BUILD !== 'undefined' ? BUILD.work : null, bag: INV.bag };
  const capacity = Number.isSafeInteger(c.capacity) ? clamp(c.capacity, 0, BAG_SIZE) : BAG_SIZE;
  let result, failure, ok = false, reason = '';
  NETPARTS.replay = true;
  GAME.player = actor; GAME.prog = { ...(saved.prog || {}), level: actor.level || 1 };
  INV.goods = declared; INV.gold = 0; INV.bag = Array.from({ length: capacity }, () => ({ slot: '__occupied' }));
  NETPARTS.notes = []; NETPARTS.skills = [];
  try {
    result = spec.run(c.args, { from: m.from, ownerAccount: m.ownerAccount, position: m.position, realm: m.realm, commandId: c.id });
    ok = result !== false && result?.ok !== false;
    if (!ok) reason = result?.why || 'The action is no longer available.';
  } catch (error) { reason = 'The shared action could not complete.'; failure = error; }
  const after = { ...INV.goods }, gold = INV.gold, items = INV.bag.slice(capacity);
  GAME.player = saved.player; GAME.prog = saved.prog; INV.goods = saved.goods; INV.gold = saved.gold; INV.bag = saved.bag;
  if (typeof BUILD !== 'undefined') BUILD.work = saved.buildWork;
  NETPARTS.replay = false;
  const goods = [...new Set([...Object.keys(before), ...Object.keys(after)])]
    .map(id => [id, (after[id] || 0) - (before[id] || 0)]).filter(([, n]) => n !== 0);
  const receipt = { durable: typeof spec.durable === 'function' ? spec.durable(c.args) !== false : spec.durable !== false,
    ...(c.op === 'warband.order' ? { action: c.op } : {}),
    digest: crypto.randomUUID(), to: m.from, ownerAccount: m.ownerAccount, id: c.id, ok, reason, goods, gold, items,
    notes: NETPARTS.notes.slice(0, 20), skills: NETPARTS.skills.slice(0, 20), result: result && typeof result === 'object' ? result.result ?? result : null };
  NETPARTS.receipts.push(receipt); netWorldPartsPruneReceipts();
  NETPARTS.resultQueue.set(receipt.ownerAccount + ':' + receipt.id, receipt);
  netWorldPartsPublish(performance.now(), true);
  if (failure) reportError(failure);
}
function netWorldPartsRequest(op, args, cost = [], forceOwner = false) {
  if (!netWorldPartsActive() || NETPARTS.replay || NETPARTS.applying) return false;
  const spec = NETPART_COMMANDS.get(op);
  const durable = typeof spec?.durable === 'function' ? spec.durable(args) !== false : spec?.durable !== false;
  if (netWorldPartsCanSimulate() && !forceOwner && !durable) return false;
  if (!netWorldPartsConnected() || !NETPARTS.ready || !NETWS.acct?.id
    || [...NETPARTS.pending.values()].filter(netWorldPartsOwnerScope).length >= 8 || NETPARTS.receipts.filter(r => !r.settled).length >= 24) {
    uiError("Waiting for this world and your character's save. Try again shortly."); return true;
  }
  // Reserve the exact JSON command that both persistence and transport carry.
  // Optional undefined properties must not make a valid readback look different.
  let requestArgs;
  try { requestArgs = netPartsClone(args); }
  catch { uiError('The shared action could not be prepared.'); return true; }
  const declared = {};
  for (const [id, n] of cost) if (GOODS[id] && n > 0) declared[id] = n;
  for (const id of spec?.tools || []) if (goodsHave(id)) declared[id] = Math.max(declared[id] || 0, 1);
  if (!goodsTakeAll(cost)) { uiError('You do not have the materials for that action.'); return true; }
  const id = NET.self + ':' + crypto.randomUUID();
  NETPARTS.next++;
  const pending = netWorldPartsBindOwner({ op, args: requestArgs, cost, declared, forceOwner, durable, phase: 'reserved',
    privateConfirmed: !durable, owner: NET.self, ownerAccount: NETWS.acct?.id,
    capacity: INV.bag.length, at: performance.now(), lastSent: -Infinity, authority: NETPARTS.authority });
  NETPARTS.pending.set(id, pending);
  if (durable) void netWorldPartsFlushJournal();
  else netWorldPartsDispatch(id, pending);
  return true;
}
function netWorldPartsCanonicalReceipt(m) {
  if (typeof m.id !== 'string' || !m.id || m.id.length > 100 || typeof m.ownerAccount !== 'string'
    || !m.ownerAccount || m.ownerAccount.length > 160 || typeof m.digest !== 'string' || !m.digest
    || m.digest.length > 160 || typeof m.ok !== 'boolean') return;
  // Strip transport fields: a later deduplicated result must keep op:'result'.
  const receipt = {
    id: m.id, ownerAccount: m.ownerAccount, digest: m.digest, to: m.to, durable: m.durable !== false,
    action: typeof m.action === 'string' ? m.action.slice(0, 80) : undefined,
    ok: m.ok, reason: typeof m.reason === 'string' ? m.reason : '',
    goods: Array.isArray(m.goods) ? netPartsClone(m.goods) : [], gold: Number.isFinite(m.gold) ? m.gold : 0,
    items: Array.isArray(m.items) ? netPartsClone(m.items) : [],
    notes: Array.isArray(m.notes) ? netPartsClone(m.notes) : [],
    skills: Array.isArray(m.skills) ? netPartsClone(m.skills) : [],
    result: m.result == null ? null : netPartsClone(m.result), settled: !!m.settled,
  };
  const existing = NETPARTS.receipts.find(r => r.id === receipt.id && r.ownerAccount === receipt.ownerAccount);
  if (existing) {
    if (existing.digest && existing.digest !== receipt.digest) return;
    receipt.settled = receipt.settled || !!existing.settled; Object.assign(existing, receipt);
  } else NETPARTS.receipts.push(receipt);
  netWorldPartsPruneReceipts();
  NETPARTS.confirmedReceipts.add(receipt.ownerAccount + ':' + receipt.id);
  netWorldPartsConfirmSettled([receipt]);
  NETPARTS.paused = ''; // This outcome confirms the server's waiting world save.
  const pending = NETPARTS.pending.get(receipt.id);
  if (pending && pending.ownerAccount === receipt.ownerAccount) netWorldPartsResult(receipt);
}
function netWorldPartsMessage(m) {
  if (!m || m.t !== 'activity') return;
  if (m.kind === 'authority') {
    const admission = netWorldAdmissionRead(m.worldAdmission);
    if (!admission || typeof m.authority !== 'string' || typeof m.peer !== 'string') return;
    const changed = NETPARTS.authority !== m.authority;
    NETPARTS.authority = m.authority; NETPARTS.peer = m.peer; NETPARTS.admission = admission;
    if (changed) { for (const row of NETPARTS.settled.values()) { row.acknowledged = false; row.lastSent = -Infinity; } NETPARTS.seq = 0; NETPARTS.readSeq = -1; NETPARTS.assembly = null; NETPARTS.outbox = null; NETPARTS.awaiting = null; NETPARTS.paused = ''; NETPARTS.sentKeys = {}; NETPARTS.key = ''; }
    // A new authority must take the canonical cache before publishing. A fresh
    // world without a cache may be seeded only by the server-elected host.
    if (m.worldpartsReady === false && m.peer === NET.self) NETPARTS.ready = true;
    else if (changed) NETPARTS.ready = false;
    return;
  }
  if (m.kind !== 'worldparts' || m.authority !== NETPARTS.authority || !netPartsEqualAdmission(m.worldAdmission)) return;
  if (m.ok === false && m.op === 'snapshot') {
    NETPARTS.paused = m.reason || 'snapshot_refused'; NETPARTS.outbox = null; NETPARTS.awaiting = null;
    NETPARTS.refused++; uiError('Shared world updates are paused. Please wait and try again.'); return;
  }
  if (m.op === 'receipt') { netWorldPartsCanonicalReceipt(m); return; }
  if (m.op === 'result') {
    const pending = NETPARTS.pending.get(m.id);
    if (pending && m.ownerAccount === pending.ownerAccount) netWorldPartsResult(m); return;
  }
  if (m.op === 'settled') { netWorldPartsTakeSettled(m); return; }
  if (m.op === 'command') { if (NETPARTS.peer === NET.self && NETPARTS.ready && netWorldPartsConnected()) netWorldPartsExecute(m); return; }
  if (m.op !== 'snapshot' || !Number.isSafeInteger(m.seq) || m.seq <= NETPARTS.readSeq
    || !Number.isInteger(m.part) || !Number.isInteger(m.total) || m.total < 1 || m.total > 128
    || m.part < 0 || m.part >= m.total || typeof m.data !== 'string' || m.data.length > 4000) return;
  let a = NETPARTS.assembly;
  if (!a || a.seq !== m.seq) NETPARTS.assembly = a = { seq: m.seq, total: m.total, chunks: new Map(), size: 0 };
  if (a.total !== m.total || a.chunks.has(m.part)) return;
  a.chunks.set(m.part, m.data); a.size += m.data.length;
  if (a.size > 350000) { NETPARTS.assembly = null; return; }
  if (a.chunks.size !== a.total) return;
  const serial = Array.from({ length: a.total }, (_, i) => a.chunks.get(i)).join('');
  NETPARTS.assembly = null;
  let frame; try { frame = JSON.parse(serial); } catch { return; }
  if (!frame || frame.v !== 1 || !frame.parts || typeof frame.parts !== 'object' || Array.isArray(frame.parts)) return;
  NETPARTS.paused = ''; // A canonical retry confirms the waiting world save.
  if (NETPARTS.peer === NET.self && NETPARTS.ready) {
    const ack = NETPARTS.awaiting;
    if (ack && ack.seq === m.seq) {
      NETPARTS.key = ack.serial; NETPARTS.sentKeys = ack.nextKeys; NETPARTS.receiptsKey = JSON.stringify(frame.receipts || []);
      NETPARTS.awaiting = null; NETPARTS.sent++;
      for (const receipt of frame.receipts || []) {
        // The server may settle an unavailable army as a canonical failure.
        // Do not retain or dispatch the keeper's earlier proposed success.
        if (receipt.action === 'warband.order') netWorldPartsCanonicalReceipt(receipt);
        const key = receipt.ownerAccount + ':' + receipt.id;
        NETPARTS.confirmedReceipts.add(key);
        const queued = NETPARTS.resultQueue.get(key);
        if (queued) {
          netWsSend({ t: 'activity', kind: 'worldparts', op: 'result', authority: NETPARTS.authority,
            worldAdmission: NETPARTS.admission, ...queued, ...receipt });
          NETPARTS.resultQueue.delete(key);
        }
      }
      netWorldPartsConfirmSettled(frame.receipts || []);
      if (NETPARTS.confirmedReceipts.size > 64) NETPARTS.confirmedReceipts = new Set(NETPARTS.receipts.map(r => r.ownerAccount + ':' + r.id));
    }
    NETPARTS.readSeq = m.seq; return;
  }
  if (netWorldPartsApply(frame)) { NETPARTS.readSeq = m.seq; NETPARTS.key = serial; }
}
function netWorldPartsPump(now) {
  if (!netWorldPartsConnected()) return;
  if (NETPARTS.awaiting && now - NETPARTS.awaiting.sentAt > 5000) {
    NETPARTS.awaiting = null; NETPARTS.sentKeys = {}; NETPARTS.key = '';
  }
  netWorldPartsPublish(now);
  const out = NETPARTS.outbox;
  if (out && now - NETPARTS.outAt >= 200) {
    NETPARTS.outAt = now;
    for (let count = 0; count < 2 && out.part < out.total; count++) {
      const part = out.part;
      if (netWsSend({ t: 'activity', kind: 'worldparts', op: 'snapshot', authority: out.authority,
        worldAdmission: NETPARTS.admission, seq: out.seq, part, total: out.total,
        data: out.serial.slice(part * 3000, (part + 1) * 3000) }) === false) break;
      out.part++;
    }
    if (out.part === out.total) {
      NETPARTS.awaiting = { ...out, sentAt: now }; NETPARTS.outbox = null;
    }
  }
  if (NETPARTS.privateError && typeof SAVE !== 'undefined' && SAVE.lastBody !== NETPARTS.privateObservedBody) {
    NETPARTS.privateObservedBody = SAVE.lastBody; NETPARTS.journalLoaded = true;
  }
  if (NETPARTS.journalLoaded) { NETPARTS.journalLoaded = false; void netWorldPartsFlushJournal(); }
  if (NETPARTS.ready) for (const [id, p] of NETPARTS.pending) {
    if (!netWorldPartsOwnerScope(p)) continue;
    if (p.owedReceipt) netWorldPartsResult(p.owedReceipt);
    if (NETPARTS.pending.get(id) === p) netWorldPartsDispatch(id, p);
  }
  netWorldPartsSendSettled(now);
}
queueMicrotask(() => {
  for (const [key, part] of Object.entries(SAVE_PARTS.world)) {
    if (['boats', 'realm', 'roam'].includes(key)) continue;
    netWorldPartsRegister(key, { save: () => part.save(), apply: value => part.load(value) });
  }
  if (typeof buildSharedSave === 'function') netWorldPartsRegister('build', { save: buildSharedSave, apply: buildSharedApply });
  if (typeof farmSharedSave === 'function') netWorldPartsRegister('farm', { save: farmSharedSave, apply: farmSharedApply });
  if (typeof landSharedApply === 'function') netWorldPartsRegister('land', { save: landSave, apply: landSharedApply });
  if (typeof campaignSaveData === 'function') netWorldPartsRegister('campaign', { save: campaignSaveData, apply: applyCampaignSave });
  if (window.__hm) window.__hm.worldparts = { NETPARTS, capture: netWorldPartsCapture, apply: netWorldPartsApply,
    request: netWorldPartsRequest, publish: () => netWorldPartsPublish(performance.now(), true),
    adapters: () => [...NETPART_ADAPTERS.keys()], flushPrivate: netWorldPartsFlushJournal,
    journalSave: netWorldPartsJournalSave, journalLoad: netWorldPartsJournalLoad };
});


function netWorldPartsLocalStep(dt) {
  if (!netWorldPartsActive()) return;
  netWorldPartsLootStep();
  if (typeof dpHatchClaimStep === 'function') dpHatchClaimStep();
  if (typeof dpMoult === 'function') dpMoult(dt);
  if (netWorldPartsCanSimulate()) return;
  if (typeof stepJob === 'function') stepJob(dt);
  if (typeof dpJobStep === 'function') dpJobStep(dt);
}
function netWorldPartsLootSave() {
  return LOOT.map(L => {
    if (!L.sharedId) L.sharedId = NETPARTS.authority + ':loot:' + (++NETPARTS.lootSeq);
    return { id: L.sharedId, item: L.item, x: L.x, y: L.y, z: L.z,
      vx: L.vx || 0, vy: L.vy || 0, vz: L.vz || 0, age: GAME.t - L.t0,
      hatch: L.hatch ? { ...netPartsClone(L.hatch), at: undefined, left: Math.max(0, L.hatch.at - GAME.t) } : null,
      left: Math.max(0, L.until - GAME.t), seed: L.seed, landed: !!L.landed, bounce: L.bounce || 0 };
  });
}
function netWorldPartsLootApply(rows) {
  if (!Array.isArray(rows)) rows = [];
  const current = new Map(LOOT.map(L => [L.sharedId, L])), result = [];
  for (const row of rows.slice(0, LOOT_MAX)) {
    if (!row || typeof row.id !== 'string' || !row.item || !Number.isFinite(row.x + row.y + row.z)) continue;
    const L = current.get(row.id) || {};
    Object.assign(L, { sharedId: row.id, item: netPartsClone(row.item), x: row.x, y: row.y, z: row.z,
      vx: row.vx, vy: row.vy, vz: row.vz, t0: GAME.t - row.age, until: GAME.t + row.left,
      seed: row.seed, landed: row.landed, bounce: row.bounce,
      hatch: row.hatch ? { ...netPartsClone(row.hatch), at: GAME.t + row.hatch.left } : null });
    result.push(L);
  }
  LOOT.splice(0, LOOT.length, ...result);
}
function netWorldPartsLootStep() {
  const P = GAME.player;
  if (!P || !P.alive || !NETPARTS.ready) return;
  for (const L of LOOT) {
    if (!L.sharedId || GAME.t - L.t0 < 0.45 || Math.hypot(P.x - L.x, P.z - L.z) >= 1.7 || Math.abs(P.y - L.y) >= 2.5) continue;
    if ([...NETPARTS.pending.values()].some(p => p.op === 'loot.take' && p.args.id === L.sharedId)) continue;
    netWorldPartsRequest('loot.take', { id: L.sharedId }, [], true);
  }
}
function netWorldPartsLoopsSave() {
  const d = SAVE_PARTS.world.loops.save();
  if (d) delete d.c; // The legacy loader unloads carts; live cargo is already in shared entity metadata.
  return d;
}
function netWorldPartsLoopsApply(d) {
  if (!d || !Array.isArray(d.r)) return;
  for (let r = 0; r < 3; r++) LOOPS_R.forEach((g, i) => {
    const value = d.r[r]?.[i]; if (Number.isFinite(value)) LOOPS.r[r][g] = clamp(value, 0, LT.target[g] * LT.cap);
  });
  for (let k = 0; k < (d.k || []).length && k < WAR.keeps.length; k++) LOOPS_K.forEach((g, i) => {
    const value = d.k[k]?.[i]; if (Number.isFinite(value)) loopsKeep(WAR.keeps[k])[g] = clamp(value, 0, LT.keepTarget[g] * LT.keepCap);
  });
}
queueMicrotask(() => {
  netWorldPartsRegister('loot', { save: netWorldPartsLootSave, apply: netWorldPartsLootApply });
  if (SAVE_PARTS.world.loops) netWorldPartsRegister('loops', { save: netWorldPartsLoopsSave, apply: netWorldPartsLoopsApply });
  const rawLore = loreNote;
  loreNote = function(id, ...args) {
    if (NETPARTS.replay) { if (!NETPARTS.notes.includes(id)) NETPARTS.notes.push(id); return; }
    return rawLore(id, ...args);
  };
  const rawSkill = skillGain;
  skillGain = function(key, amount, ...args) {
    if (NETPARTS.replay) { NETPARTS.skills.push([key, amount]); return; }
    return rawSkill(key, amount, ...args);
  };
  const rawForage = forageTake;
  forageTake = function(p) {
    if (netWorldPartsRequest('forage.take', { id: p.i })) return 0;
    return rawForage(p);
  };
  netWorldPartsRegisterCommand('forage.take', {
    tools: ['tool_knife'], range: 4,
    point: a => FORAGE.list[a.id] || { x: Infinity, z: Infinity },
    run: a => { const p = FORAGE.list[a.id]; return p && p.ripe >= 0.99 ? { ok: rawForage(p) > 0 } : false; },
  });
  const rawDive = diveTake;
  diveTake = function(F) {
    if (netWorldPartsRequest('dive.take', { id: F.id })) return;
    return rawDive(F);
  };
  netWorldPartsRegisterCommand('dive.take', {
    range: 5, point: a => DIVE.finds.find(F => F.id === a.id) || { x: Infinity, z: Infinity },
    run: a => { const F = DIVE.finds.find(f => f.id === a.id); if (!F || F.taken) return false; rawDive(F); return { ok: F.taken }; },
  });
  netWorldPartsRegisterCommand('loot.take', {
    range: 3, point: a => LOOT.find(L => L.sharedId === a.id) || { x: Infinity, z: Infinity },
    run: a => {
      const L = LOOT.find(l => l.sharedId === a.id);
      if (!L) return false;
      if (L.item.goods) {
        const n = goodsAdd(L.item.goods, L.item.n || 1, true);
        if (!n) return false;
        L.item.n = (L.item.n || 1) - n;
        if (L.item.n <= 0) LOOT.splice(LOOT.indexOf(L), 1);
      } else {
        if (!bagAdd(L.item)) return false;
        LOOT.splice(LOOT.indexOf(L), 1);
      }
      return { ok: true };
    },
  });
  const rawLight = natureLightPile;
  natureLightPile = function(p) {
    if (netWorldPartsRequest('nature.light', { x: p.x, z: p.z })) return;
    return rawLight(p);
  };
  netWorldPartsRegisterCommand('nature.light', {
    durable: false, point: a => ({ x: a.x, z: a.z }), range: 4,
    run: a => { const p = NATURE.piles.find(q => Math.hypot(q.x - a.x, q.z - a.z) < 0.2); if (!p || p.lit) return false; rawLight(p); return { ok: p.lit }; },
  });
  netWorldPartsRegisterCommand('nature.job', {
    tools: ['tool_axe', 'tool_knife'], range: 8, point: a => W.trees[a.id] || { x: Infinity, z: Infinity },
    run: a => {
      const t = W.trees[a.id], P = GAME.player;
      if (!t || !['chop', 'split'].includes(a.kind)) return false;
      if (a.kind === 'chop') {
        if (t.felled) return false;
        fellTree(t, t.x - P.x, t.z - P.z, 30, true);
      } else {
        if (!t.log || !t.fall) return false;
        const len = TREE_DIM[t.kind].trunk * natS(t);
        const px = t.x + t.fall.ux * Math.min(len * 0.5 + 0.6, 2.4), pz = t.z + t.fall.uz * Math.min(len * 0.5 + 0.6, 2.4);
        natRemoveLog(t); t.leaf = 0;
        const p = natClearSpot(px, pz, t.x, t.z, 0.7);
        natAddPile(p.x, p.z, Math.atan2(t.fall.uz, -t.fall.ux), t.kind);
        natSplitGoods(t);
      }
      return { ok: true };
    },
  });
});

function netWorldPartsCoreSave() {
  return {
    campaign: { n: CAMPAIGN.n, el: Math.round(campaignElapsed() * 10) / 10, state: CAMPAIGN.state,
      peace: Math.max(0, CAMPAIGN.peaceUntil - GAME.t), truce: Math.max(0, CAMPAIGN.truceUntil - GAME.t),
      winner: CAMPAIGN.winner, how: CAMPAIGN.how, longSaid: CAMPAIGN.longSaid,
      claims: CAMPAIGN.claims.map(c => ({ k: c.k, h: c.h, kOn: c.kOn, hOn: c.hOn })),
      renown: CAMPAIGN.renown.slice(), history: CAMPAIGN.history.map(h => ({ ...h, you: null, reward: undefined })) },
    relics: WAR.relics.map(rel => {
      const e = rel.carrier != null && getEnt(rel.carrier);
      if (e) { rel.x = e.x; rel.y = e.y; rel.z = e.z; }
      else if (rel.state === 'carried') { rel.state = 'ground'; rel.since = GAME.t; rel.carrier = null; }
      return { id: rel.id, state: rel.state, at: rel.at, from: rel.from, slot: rel.slot,
        peer: e ? e === GAME.player ? NET.self : e.netPeer || null : null,
        actor: e ? e.netEntityId || null : null,
        x: rel.x || 0, y: rel.y || 0, z: rel.z || 0, age: GAME.t - (rel.since || GAME.t) };
    }),
    doors: HOUSES.map(H => ({ id: H.num, leaves: houseLeavesOf(H).map(L => [L.open, L.target]),
      windows: H.wins.map(w => w.target) })),
  };
}
function netWorldPartsCoreApply(d) {
  if (!d || typeof d !== 'object') return;
  const c = d.campaign;
  if (c && Array.isArray(c.claims) && c.claims.length === 3) {
    CAMPAIGN.n = c.n; CAMPAIGN.t0 = GAME.t - c.el; CAMPAIGN.state = c.state;
    CAMPAIGN.peaceUntil = GAME.t + c.peace; CAMPAIGN.truceUntil = GAME.t + (c.truce || 0);
    CAMPAIGN.winner = c.winner; CAMPAIGN.how = c.how; CAMPAIGN.longSaid = !!c.longSaid;
    c.claims.forEach((row, i) => Object.assign(CAMPAIGN.claims[i], row)); CAMPAIGN.renown = c.renown.slice();
    const own = new Map(CAMPAIGN.history.map(h => [h.n, { you: h.you, reward: h.reward }]));
    CAMPAIGN.history = c.history.map(h => ({ ...h, ...own.get(h.n) }));
  }
  for (const row of d.relics || []) {
    const rel = WAR.relics[row.id]; if (!rel) continue;
    if (rel.carrier != null) { const old = getEnt(rel.carrier); if (old && old.carrying === rel.id) old.carrying = null; }
    const e = row.peer === NET.self ? GAME.player : row.peer ? netGhost(row.peer)
      : row.actor && typeof netEntityFind === 'function' ? netEntityFind(row.actor) : null;
    Object.assign(rel, { state: row.state, at: row.at, from: row.from, slot: row.slot,
      x: row.x, y: row.y, z: row.z, since: GAME.t - row.age, carrier: e ? e.id : null });
    if (e && row.state === 'carried') { e.carrying = rel.id; rel.carrierRealm = e.faction; }
  }
  updateRelicBonuses();
  for (const row of d.doors || []) {
    const H = HOUSES[row.id]; if (!H) continue;
    houseLeavesOf(H).forEach((L, i) => { if (row.leaves[i]) { L.open = row.leaves[i][0]; L.target = row.leaves[i][1]; } });
    H.wins.forEach((w, i) => { if (Number.isFinite(row.windows[i])) w.target = row.windows[i]; });
  }
}
queueMicrotask(() => {
  NETPART_ADAPTERS.delete('campaign');
  netWorldPartsRegister('core', { save: netWorldPartsCoreSave, apply: netWorldPartsCoreApply });
  const rawTake = pickUpRelic, rawDrop = dropRelic;
  pickUpRelic = function(rel, e) {
    if (e === GAME.player && netWorldPartsRequest('relic.take', { id: rel.id })) return;
    return rawTake(rel, e);
  };
  dropRelic = function(e) {
    if (e === GAME.player && netWorldPartsRequest('relic.drop', {})) return;
    return rawDrop(e);
  };
  netWorldPartsRegisterCommand('relic.take', {
    durable: false, range: 6, point: a => WAR.relics[a.id] ? relicPosition(WAR.relics[a.id]) : { x: Infinity, z: Infinity },
    run: a => { const rel = WAR.relics[a.id]; if (!rel || !relicTakeable(rel, GAME.player)) return false; rawTake(rel, GAME.player); return { ok: true }; },
  });
  netWorldPartsRegisterCommand('relic.drop', {
    durable: false, run: () => { if (GAME.player.carrying == null) return false; rawDrop(GAME.player); return { ok: true }; },
  });
});

queueMicrotask(() => registerSavePart('char', 'sharedWorldReservations', {
  save: netWorldPartsJournalSave, load: netWorldPartsJournalLoad,
}));

queueMicrotask(() => {
  const depth = SAVE_PARTS.world.depth;
  if (depth) netWorldPartsRegister('depth', {
    save: () => depth.save(),
    apply: value => {
      const job = DEPTH.job;
      // Legacy apple-log restoration allocates colliders; remove the previous
      // replicas before replaying the canonical image.
      for (const p of FORAGE.list) if (p.logColl) { bCollRemove(p.logColl); p.logColl = null; }
      depth.load(value);
      for (const i of DEPTH.pendGrub || []) {
        const t = W.trees[i]; if (!t) continue;
        t.grubbed = true; t.felled = true; t.regrowAt = 0;
        if (t.coll) t.coll.active = false;
        natShowRegular(t, 0); DEPTH.grub.add(i);
      }
      DEPTH.pendGrub = null; DEPTH.job = job;
    },
  });
  const tracks = SAVE_PARTS.world.tracks;
  if (tracks) netWorldPartsRegister('tracks', {
    save: () => tracks.save(),
    apply: value => {
      if (TRACKS.mesh) {
        TRACKS.mesh.geometry.attributes.iK.array.fill(0);
        TRACKS.n = 0; TRACKS.head = 0; TRACKS.cells.clear();
      }
      tracks.load(value);
    },
  });
});


// A reservation and its eventual owner outcome are committed to the existing
// encrypted character profile. No separate plaintext recovery log is created.
function netWorldPartsJournalSave() {
  const pending = [...NETPARTS.pending].filter(([, p]) => p.durable && netWorldPartsOwnerScope(p)).slice(0, 8).map(([id, p]) => ({
    id, op: p.op, args: p.args, cost: p.cost, declared: p.declared, owner: p.owner,
    ownerAccount: p.ownerAccount, capacity: p.capacity, forceOwner: p.forceOwner,
    phase: p.phase === 'applied' ? 'applied' : 'reserved', outcomeToken: p.outcomeToken || null,
  }));
  const settled = [...NETPARTS.settled.values()].filter(netWorldPartsOwnerScope).slice(-64)
    .map(r => ({ id: r.id, ownerAccount: r.ownerAccount, digest: r.digest }));
  return pending.length || settled.length ? { v: 2, pending, settled } : null;
}
function netWorldPartsJournalLoad(value) {
  // Character loading is a new private scope, including a new character under
  // the same account. Retained transport requests must not cross that boundary.
  ++NETPARTS.privateAttempt;
  NETPARTS.pending.clear(); NETPARTS.settled.clear();
  const rows = Array.isArray(value) ? value : value?.v === 2 && Array.isArray(value.pending) ? value.pending : [];
  for (const row of value?.v === 2 && Array.isArray(value.settled) ? value.settled.slice(-64) : []) {
    if (row && typeof row.id === 'string' && typeof row.ownerAccount === 'string' && row.ownerAccount
      && row.ownerAccount === NETWS.acct?.id && typeof row.digest === 'string')
      NETPARTS.settled.set(row.id, netWorldPartsBindOwner({ ...row, confirmed: true, acknowledged: false, lastSent: -Infinity }));
  }
  for (const row of rows.slice(0, 8)) {
    if (!row || typeof row.id !== 'string' || typeof row.ownerAccount !== 'string' || !row.ownerAccount || row.ownerAccount !== NETWS.acct?.id
      || typeof row.op !== 'string' || !Array.isArray(row.cost) || !NETPART_COMMANDS.has(row.op)) continue;
    if (row.phase === 'applied' && typeof row.outcomeToken === 'string') {
      NETPARTS.settled.set(row.id, netWorldPartsBindOwner({ id: row.id, ownerAccount: row.ownerAccount,
        digest: row.outcomeToken, confirmed: true, acknowledged: false, lastSent: -Infinity }));
    } else if (!NETPARTS.settled.has(row.id)) NETPARTS.pending.set(row.id, netWorldPartsBindOwner({
      ...row, durable: true, phase: 'reserved', privateConfirmed: false, lastSent: -Infinity, at: performance.now(),
    }));
  }
  NETPARTS.journalLoaded = true;
}
function netWorldPartsJournalFromSave(save) {
  const value = save?.char?.x?.sharedWorldReservations;
  return Array.isArray(value) ? { pending: value, settled: [] }
    : value?.v === 2 ? value : { pending: [], settled: [] };
}
function netWorldPartsStable(value) {
  if (Array.isArray(value)) return '[' + value.map(netWorldPartsStable).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort()
    .map(key => JSON.stringify(key) + ':' + netWorldPartsStable(value[key])).join(',') + '}';
  return JSON.stringify(value);
}
function netWorldPartsPrivateProof(save, id, p) {
  const journal = netWorldPartsJournalFromSave(save);
  if (p.phase === 'applied') return (journal.settled || []).some(r =>
    r.id === id && r.ownerAccount === p.ownerAccount && r.digest === p.outcomeToken);
  return (journal.pending || []).some(r => r.id === id && r.ownerAccount === p.ownerAccount
    && r.phase !== 'applied' && r.op === p.op
    && netWorldPartsStable(r.args) === netWorldPartsStable(p.args)
    && netWorldPartsStable(r.cost) === netWorldPartsStable(p.cost)
    && netWorldPartsStable(r.declared) === netWorldPartsStable(p.declared)
    && r.capacity === p.capacity && !!r.forceOwner === !!p.forceOwner);
}
function netWorldPartsJournalNeeded() {
  return [...NETPARTS.pending].some(([, p]) => p.durable
    && (p.phase === 'applied' || !p.privateConfirmed) && netWorldPartsOwnerScope(p));
}
async function netWorldPartsFlushJournal() {
  if (NETPARTS.privateFlight) {
    const previous = NETPARTS.privateFlight;
    // The previous profile's bounded save must finish without authorizing this
    // one's action. Resume the replacement scope after that flight has drained.
    return NETPARTS.privateScope?.attempt === NETPARTS.privateAttempt && netWorldPartsOwnerScope(NETPARTS.privateScope) ? previous
      : previous.then(() => netWorldPartsFlushJournal());
  }
  if (!netHumanLive()) { if (netWorldPartsJournalNeeded()) NETPARTS.journalLoaded = true; return false; }
  if (!netWorldPartsJournalNeeded()) return true;
  const attempt = ++NETPARTS.privateAttempt;
  const account = NETWS.acct?.id, ref = SAVE.ref, player = GAME.player;
  const sameProfile = () => NETWS.acct?.id === account && SAVE.ref === ref && GAME.player === player && !SAVE.wiping;
  const owned = () => NETPARTS.privateAttempt === attempt && sameProfile();
  NETPARTS.privateError = '';
  let timer;
  const work = Promise.resolve().then(async () => {
    // An existing native flight may resolve before the newly coalesced body was
    // committed. Drain bounded passes and verify the exact journal on readback.
    for (let pass = 0; pass < 3 && netHumanLive() && owned(); pass++) {
      await saveNow({ final: true });
      await Promise.resolve();
      if (!owned() || !netHumanLive()) return false;
      if (SAVE.nativeFlight) await SAVE.nativeFlight;
      if (!owned()) return false;
      const goals = [...NETPARTS.pending].filter(([, p]) => p.durable && netWorldPartsOwnerScope(p)
        && (p.phase === 'applied' || !p.privateConfirmed));
      if (!goals.length) return true;
      if (SAVE.native) {
        let acknowledged;
        try { acknowledged = JSON.parse(SAVE.lastBody || 'null'); } catch { acknowledged = null; }
        if (!goals.every(([id, p]) => netWorldPartsPrivateProof(acknowledged, id, p))) continue;
        if (!ref?.get) return false;
      }
      const snap = ref?.get ? await ref.get() : null;
      if (!owned()) return false;
      const confirmed = snap?.exists === true && typeof snap.data === 'function' ? snap.data()
        : !SAVE.native && !ref ? readLocal() : null;
      if (!confirmed) return false;
      let advanced = false;
      for (const [id, p] of goals) if (NETPARTS.pending.get(id) === p && netWorldPartsPrivateProof(confirmed, id, p)) {
        advanced = true;
        if (p.phase === 'applied') {
          const settled = NETPARTS.settled.get(id);
          if (settled) settled.confirmed = true;
          NETPARTS.pending.delete(id);
          saveSoon(); // Compaction is optional; the confirmed tombstone prevents replay.
        } else p.privateConfirmed = true;
      }
      for (const [id, p] of NETPARTS.pending) netWorldPartsDispatch(id, p);
      netWorldPartsSendSettled();
      if (!netWorldPartsJournalNeeded()) return true;
      if (!advanced && pass === 2) return false;
    }
    return false;
  });
  const flight = Promise.race([work, new Promise(resolve => {
    timer = setTimeout(() => { if (owned()) NETPARTS.privateAttempt++; resolve(false); }, 20000);
  })]).catch(error => { if (sameProfile()) NETPARTS.privateError = error?.code || 'private_checkpoint_pending'; return false; }).then(ok => {
    if (!ok && sameProfile()) {
      NETPARTS.privateError = NETPARTS.privateError || 'private_checkpoint_pending';
      NETPARTS.privateObservedBody = SAVE.lastBody;
      uiError('Your save has not been confirmed. This action will wait; keep this character open and try saving again.');
    }
    return ok;
  }).finally(() => {
    clearTimeout(timer);
    if (NETPARTS.privateFlight === flight) { NETPARTS.privateFlight = null; NETPARTS.privateScope = null; }
  });
  NETPARTS.privateFlight = flight; NETPARTS.privateScope = netWorldPartsBindOwner({ ownerAccount: account, attempt });
  return flight;
}
function netWorldPartsDispatch(id, p) {
  if (p.phase !== 'reserved' || !p.privateConfirmed || !netWorldPartsOwnerScope(p)
    || !netWorldPartsConnected() || !NETPARTS.ready || performance.now() - p.lastSent < 3000) return false;
  p.lastSent = performance.now();
  return netWsSend({ t: 'activity', kind: 'worldparts', op: 'command', authority: NETPARTS.authority,
    worldAdmission: NETPARTS.admission, command: { id, op: p.op, args: p.args, goods: p.declared, capacity: p.capacity } });
}
function netWorldPartsSendSettled(now = performance.now()) {
  if (!netWorldPartsConnected() || now - NETPARTS.settleAt < 200) return;
  let sent = 0;
  for (const row of NETPARTS.settled.values()) {
    if (!row.confirmed || !netWorldPartsOwnerScope(row) || row.acknowledged || sent >= 2
      || now - row.lastSent < 3000) continue;
    if (netWsSend({ t: 'activity', kind: 'worldparts', op: 'settled', authority: NETPARTS.authority,
      worldAdmission: NETPARTS.admission, id: row.id, digest: row.digest }) !== false) {
      row.lastSent = now; sent++;
    }
  }
  if (sent) NETPARTS.settleAt = now;
  while (NETPARTS.settled.size > 64) {
    const retired = [...NETPARTS.settled].find(([, r]) => r.acknowledged);
    if (!retired) break;
    NETPARTS.settled.delete(retired[0]);
  }
}
function netWorldPartsConfirmSettled(receipts) {
  for (const receipt of receipts) {
    const row = NETPARTS.settled.get(receipt.id);
    if (receipt.settled && row && row.ownerAccount === receipt.ownerAccount && row.digest === (receipt.digest || 'legacy:' + receipt.id))
      row.acknowledged = true;
  }
}
function netWorldPartsTakeSettled(m) {
  if (typeof m.id !== 'string' || typeof m.digest !== 'string') return;
  const own = NETPARTS.settled.get(m.id);
  if (own && netWorldPartsOwnerScope(own) && own.ownerAccount === m.ownerAccount && own.digest === m.digest)
    own.acknowledged = true;
  if (NETPARTS.peer !== NET.self) return;
  const row = NETPARTS.receipts.find(r => r.id === m.id && r.ownerAccount === m.ownerAccount);
  if (!row || (row.digest || 'legacy:' + row.id) !== m.digest) return;
  row.settled = true; netWorldPartsPruneReceipts(); netWorldPartsPublish(performance.now(), true);
}
function netWorldPartsPruneReceipts() {
  const recent = new Set(NETPARTS.receipts.filter(r => r.settled).slice(-8));
  NETPARTS.receipts = NETPARTS.receipts.filter(r => !r.settled || recent.has(r));
}

// Tower brand commands carry a bounded server-derived actor pose, so this
// interaction also works when the keeper is too far away to render its caller.
function netWorldPartsTowerActor(m) {
  const state = m.actorState, p = m.position;
  if (!state || state.alive !== true || state.brand !== true || state.motion !== null
    || !Number.isFinite(state.y) || Math.abs(state.y) > 500 || !p || ![p.x, p.z].every(Number.isFinite)) return null;
  return { role: 'remote', netPeer: m.from, faction: m.realm, level: 1, alive: true,
    x: p.x, y: state.y, z: p.z, brand: { until: GAME.t + 1 }, motion: null };
}
queueMicrotask(() => netWorldPartsRegisterCommand('tower.brand', {
  durable: false, actor: netWorldPartsTowerActor, range: 18,
  point: a => Number.isInteger(a?.id) && TOWER.list[a.id] ? { x: TOWER.list[a.id].wx, z: TOWER.list[a.id].wz } : { x: Infinity, z: Infinity },
  run: a => {
    if (!a || Object.keys(a).length !== 1 || !Number.isInteger(a.id) || a.id < 0) return false;
    const T = TOWER.list[a.id], P = GAME.player;
    if (!P?.brand || !towerBrandCanReach(T, P)) return false;
    return { ok: towerIgnite(T, T.look === 'rath' ? T.TT + 2 : P.y - T.S.y + 1.2) };
  },
}));

// Warband commands use the accepted connection's progression and pose. Hall
// access remains a canonical keeper check, and never borrows the keeper's grant.
function netWorldPartsWarbandActor(m) {
  const s = m.actorState, p = m.position;
  if (!s || s.alive !== true || !Number.isFinite(s.y) || Math.abs(s.y) > 500
    || !Number.isSafeInteger(s.level) || s.level < 1 || s.level > 60
    || !Number.isSafeInteger(s.rank) || s.rank < 0 || s.rank > 20
    || ![0, 1, 2].includes(m.realm) || !p || ![p.x, p.z].every(v => Number.isFinite(v) && Math.abs(v) <= 4000)) return null;
  return { role: 'remote', netPeer: m.from, faction: m.realm, alive: true, x: p.x, y: s.y, z: p.z,
    level: s.level, name: typeof s.name === 'string' ? s.name.slice(0, 56) : 'the commander',
    netCommand: true, commandRank: s.rank, commandTable: -1,
    commandThrone: Number.isSafeInteger(s.throne) && s.throne >= 0 && s.throne < 4096 ? s.throne : -1 };
}
queueMicrotask(() => {
  netWorldPartsRegisterCommand('warband.order', {
    durable: false, actor: netWorldPartsWarbandActor,
    run: (a, context) => {
      if (!a || Object.keys(a).sort().join(',') !== 'campaign,cmd,table,target,version,wb'
        || !Number.isSafeInteger(a.campaign) || a.campaign !== CAMPAIGN.n
        || !Number.isSafeInteger(a.wb) || a.wb < 1 || !Number.isSafeInteger(a.target)
        || !Number.isSafeInteger(a.table) || a.table < -1 || a.table > 4095
        || !Number.isSafeInteger(a.version) || a.version < 0
        || !['attack', 'defend', 'raid', 'rally', 'release'].includes(a.cmd)) return false;
      GAME.player.commandTable = a.table;
      const index = WAR.warbands.findIndex(w => w.id === a.wb && !w.dead), wb = WAR.warbands[index];
      if (!wb) return false;
      const baseline = wb.orderCampaign === CAMPAIGN.n ? wb.orderVersion || 0 : 0;
      // Several commands can reach the keeper before the prior checkpoint is
      // acknowledged. Plan against the last queued outcome without publishing
      // any of those candidates as live army state.
      const queued = NETPARTS.receipts.filter(r => r.ok && r.action === 'warband.order'
        && r.result?.campaign === CAMPAIGN.n && r.result.warband?.id === wb.id
        && Number.isSafeInteger(r.result.orderVersion) && r.result.orderVersion > baseline)
        .sort((x, y) => y.result.orderVersion - x.result.orderVersion)[0]?.result;
      const previous = queued ? queued.orderVersion : baseline;
      if (!Number.isSafeInteger(previous) || previous < 0 || previous >= Number.MAX_SAFE_INTEGER) return false;
      if (a.version !== previous) return { ok: false, why: 'That warband has newer orders. Review its current orders and try again.' };
      const candidate = { ...wb, order: queued ? netEntityOrderDecode(queued.warband.order) : wb.order };
      let r;
      WAR.warbands[index] = candidate;
      try { r = cwPlayerOrder(a.wb, a.cmd, a.target); }
      finally { WAR.warbands[index] = wb; }
      if (!r.ok) return { ok: false, why: r.message };
      return { ok: true, result: { message: r.message, ordered: !!r.ordered,
        campaign: CAMPAIGN.n, orderVersion: previous + 1, warband: { id: wb.id, order: netEntityOrderEncode(candidate.order) } } };
    },
  });
  netWorldPartsRegisterResult('warband.order', result => {
    if (result?.ordered) { CAMPAIGN.story.you.orders++; sfx('horn'); }
    if (typeof result?.message === 'string') {
      if (typeof CWUI !== 'undefined') CWUI.msg = result.message;
      uiToast(result.message);
    }
  });
});
