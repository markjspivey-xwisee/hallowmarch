/* Townspeople have world identities. One live page keeps their behaviour; the
 * other pages draw its bounded, complete roster instead of running another town.
 * The server stamps the authority token and world admission on every frame.
 */
const NET_NPCS = { entities: new Map(), rows: new Map(), confirmed: new Map(), buffers: new Map(), lastFrameAt: 0,
  authority: '', peer: '', admission: null, recv: -1, seq: 0, sentAt: -Infinity,
  complete: false, ensurePending: false, stats: { sent: 0, received: 0, refused: 0, made: 0 } };
const NET_NPC_MAX = 64;
// The four class appearances plus the actual villager and herald rig outfits.
// Town merchants use the villager outfit; combat-only outfits are not NPC rows.
const NET_NPC_OUTFITS = new Set([0, 1, 2, 3, 4, 9]);
const netNpcServer = () => typeof netServerUrl === 'function' && !!netServerUrl();
const netNpcMine = () => !!NET_NPCS.authority && NET_NPCS.peer === NET.self;
const netNpcId = (id) => typeof id === 'string' && /^town:[0-2]:(villager|herald|merchant):[0-9]{1,2}$/.test(id);
const netNpcFinite = (v, lo, hi) => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;
const netNpcBit = (v) => v === 0 || v === 1;
const netNpcFind = (id) => { const e = NET_NPCS.entities.get(id); return e && !e.removed ? e : null; };
const netNpcHost = () => NET_NPCS.peer;
const netNpcClean = (v, n) => typeof v === 'string' && v.length <= n && !/[\u0000-\u001f\u007f]/.test(v);

function netNpcRowRead(o) {
  if (!o || typeof o !== 'object' || Array.isArray(o) || !netNpcId(o.id)
    || !['villager', 'herald', 'merchant'].includes(o.role) || o.id.split(':')[2] !== o.role
    || !netNpcClean(o.n, 56) || !Number.isInteger(o.r) || o.r < 0 || o.r > 2 || +o.id.split(':')[1] !== o.r
    || !(o.c === null || typeof CLASSES !== 'undefined' && Object.hasOwn(CLASSES, o.c))
    || !Number.isInteger(o.l) || o.l < 1 || o.l > 50
    || !Array.isArray(o.p) || o.p.length !== 3 || !o.p.every((v, i) => netNpcFinite(v, i === 1 ? -500 : -4000, i === 1 ? 500 : 4000))
    || !netNpcFinite(o.y, -50, 50) || !netNpcFinite(o.a, 0, 63.999)
    || !netNpcFinite(o.ph, 0, Math.PI * 128) || !netNpcFinite(o.am, 0, 4)
    || !netNpcFinite(o.h, 0, 1e6) || !netNpcFinite(o.m, 1, 1e6) || o.h > o.m
    || !netNpcBit(o.d) || !netNpcBit(o.g) || !netNpcBit(o.hm)
    || !Array.isArray(o.lk) || o.lk.length !== 15 || !o.lk.every((v) => netNpcFinite(v, 0, (1 << 25) - 1))) return null;
  const lk = o.lk;
  if (!lk.slice(0, 6).every((v) => v <= 2) || lk[6] > 1 || lk[7] > 1
    || !Number.isInteger(lk[8]) || !Number.isInteger(lk[9]) || lk[9] > 1023
    || lk[10] < 0.85 || lk[10] > 1.12 || !Number.isInteger(lk[11]) || !NET_NPC_OUTFITS.has(lk[11])
    || !Number.isInteger(lk[12]) || lk[12] > 3 || !netNpcBit(lk[13]) || lk[14] > 0.5) return null;
  if (!(o.st === null || Array.isArray(o.st) && o.st.length === 4
    && netNpcFinite(o.st[0], -500, 500) && netNpcFinite(o.st[1], -50, 50)
    && netNpcFinite(o.st[2], -4000, 4000) && netNpcFinite(o.st[3], -4000, 4000))) return null;
  if (!(o.fm === null || Array.isArray(o.fm) && o.fm.length === 3
    && Number.isInteger(o.fm[0]) && o.fm[0] >= 0 && o.fm[0] <= 2 && netNpcBit(o.fm[1]) && netNpcBit(o.fm[2]))) return null;
  if (!(o.bt == null || Number.isInteger(o.bt) && o.bt >= 1 && o.bt <= 128)) return null;
  return { id: o.id, role: o.role, n: o.n, r: o.r, c: o.c, l: o.l, p: o.p.slice(), y: o.y,
    a: o.a, ph: o.ph, am: o.am, h: o.h, m: o.m, d: o.d, g: o.g,
    lk: lk.slice(), st: o.st && o.st.slice(), fm: o.fm && o.fm.slice(), hm: o.hm, bt: o.bt || null };
}
function netNpcRowsRead(rows) {
  if (!Array.isArray(rows) || rows.length > NET_NPC_MAX) return null;
  const seen = new Set(), out = [];
  for (const row of rows) {
    const r = netNpcRowRead(row);
    if (!r || seen.has(r.id)) return null;
    seen.add(r.id); out.push(r);
  }
  return out;
}
function netNpcRegister(e, id) {
  if (!e || !netNpcId(id)) return false;
  e.netNpcId = id; e.netNpcRealm = +id.split(':')[1];
  NET_NPCS.entities.set(id, e);
  const row = NET_NPCS.rows.get(id);
  if (row) netNpcApply(e, row, true);
  if (netNpcMine()) netNpcResumeWorker(e);
  return true;
}
function netNpcLook(lk) {
  return { tabard: lk.slice(0, 3), armor: lk.slice(3, 6), skin: lk[6], hair: lk[7],
    mask: lk[8], flags: lk[9], scale: lk[10], outfit: lk[11], emblem: lk[12], fem: lk[13], bulk: lk[14] };
}
// Carrying is an effective renderer mask, separate from the worker's idle look.
// Encode that visible load so replicas need no local economic plan to draw it.
function netNpcMask(e) {
  const haul = e.ai?.lj?.haul;
  return haul && typeof WB !== 'undefined' && typeof WEAPON_BITS !== 'undefined'
    ? (e.look.mask & ~WEAPON_BITS) | (haul === 'wood' ? WB.timberLoad : WB.stoneLoad) : e.look.mask;
}
function netNpcResumeWorker(e) {
  if (e.netNpcMissing || e.removed || !e.alive) { e.ai.lj = null; return; }
  const slot = Number(e.netNpcId?.split(':')[3]);
  if (e.role !== 'villager' || slot < 6 || slot > 8 || !Number.isInteger(slot)) { e.ai.lj = null; return; }
  const bits = typeof WB !== 'undefined' ? WB : {}, mask = e.look.mask;
  const carry = (bits.timberLoad || 0) | (bits.stoneLoad || 0);
  const base = mask & ~((typeof WEAPON_BITS !== 'undefined' ? WEAPON_BITS : 0) | carry);
  e.ai.lj = { job: slot === 8 ? 'stone' : 'wood', realm: e.netNpcRealm, look: base,
    next: GAME.t + 20, haul: mask & (bits.stoneLoad || 0) ? 'stone' : mask & (bits.timberLoad || 0) ? 'wood' : null };
  e.look.mask = base;
  if (typeof LOOPS !== 'undefined' && !LOOPS.workers.includes(e.id)) LOOPS.workers.push(e.id);
}
function netNpcBoat(e, row) {
  if (!row.bt) {
    if (e.netNpcBoat || e.boat) { if (e.boat?.rider === e.id) e.boat.rider = null; e.boat = null; e.rowK = undefined; e.rowPh = undefined; e.fixedY = null; }
    e.netNpcBoat = null; return;
  }
  if (typeof BOATS === 'undefined' || typeof boatSeat !== 'function') return;
  const boat = BOATS.list.find((b) => b.id === row.bt); if (!boat) return;
  // A later exclusive human grant wins over an older farmer motion frame.
  // Never let the worker adapter replace a server-admitted human rider.
  if (boat.netRider) {
    e.boat = null; e.netNpcBoat = null; e.rowK = undefined; e.rowPh = undefined; e.fixedY = null;
    return;
  }
  if (e.netNpcBoat && e.boat !== boat && e.boat?.rider === e.id) e.boat.rider = null;
  e.netNpcBoat = row.bt; e.boat = boat; boat.rider = e.id; boatSeat(e, boat, 'row');
  e.yaw = boat.yaw + Math.PI;
  e.rowK = boat.eff > 0.05 ? boat.eff : undefined; e.rowPh = boat.ph;
  if (Math.floor(row.a) === 16 && boat.eff > 0.05) e.netNpcPose = 16 + Math.min(0.998, Math.max(0, boat.ph || 0));
  if (netNpcMine() && (!e.ai.fisher || e.ai.fisher.B !== boat)) {
    const jetty = boat.home && BOATS.jetties?.[boat.home.j]
      || BOATS.jetties?.find((j) => j.boats.includes(boat));
    if (jetty) {
      jetty.fisher = e.id;
      e.ai.fisher = { st: 'back', J: jetty, B: boat, t: 0, until: GAME.t + 200 };
    }
  }
}
function netNpcApply(e, row, immediate = false) {
  e.netNpcMissing = !!row.g; e.netNpcPose = row.a;
  e.name = row.n; e.cls = row.c; e.level = row.l; e.look = netNpcLook(row.lk); e.scale = row.lk[10];
  e.maxHp = row.m; e.hp = row.h;
  if (e.alive && row.d) e.deadAt = GAME.t;
  e.alive = !row.d; e.removeAt = Infinity;
  if (!netNpcMine()) e.ai.lj = null;
  e.ai.farmer = !!row.fm; e.ai.fieldHand = !!row.fm?.[1]; e.ai.seedSeller = !!row.fm?.[2];
  if (row.fm) e.farmTown = row.fm[0];
  if (immediate) {
    e.x = e.prevX = row.p[0]; e.y = row.p[1]; e.z = e.prevZ = row.p[2]; e.yaw = row.y;
    e.anim.phase = row.ph; e.anim.amt = row.am;
  }
  e.seat = row.st ? { y: row.st[0], yaw: row.st[1], sx: row.st[2], sz: row.st[3] } : null;
  e._hamUntil = row.hm ? GAME.t + 1 : 0;
  if (immediate) netNpcBoat(e, row);
  // drawActors uses the base action as well as animActValue for a fire beater.
  e.anim.act = Math.floor(row.a); e.anim.actT = row.a % 1; e.anim.actDur = row.a ? 1 : 0;
}
function netNpcEnsure(row) {
  let e = NET_NPCS.entities.get(row.id);
  if (e && !e.removed) return e;
  if (row.g || !GAME.built) return null;
  const town = REALMS[row.r].town;
  e = makeEnt({ kind: 'humanoid', faction: FACTION_NEUTRAL, role: row.role, cls: row.c,
    level: row.l, name: row.n, x: row.p[0], y: row.p[1], z: row.p[2], yaw: row.y,
    look: netNpcLook(row.lk), speed: 2.2, home: { x: town.x, z: town.z, r: 20 } });
  if (row.c && typeof setupStats === 'function') setupStats(e);
  if (row.role === 'herald' || row.role === 'merchant') e.ai.post = { x: row.p[0], z: row.p[2], yaw: row.y };
  if (row.role === 'herald') REALMS[row.r].herald = e;
  if (row.role === 'merchant') {
    e.fixedY = row.p[1];
    REALMS[row.r][row.id.endsWith(':1') ? 'quartermaster' : 'merchant'] = e;
  }
  netNpcRegister(e, row.id); NET_NPCS.stats.made++;
  return e;
}
function netNpcReceiveRows(rows, immediate = false) {
  NET_NPCS.rows = new Map(rows.map((r) => [r.id, r]));
  NET_NPCS.complete = rows.length > 0;
  NET_NPCS.ensurePending = !GAME.built;
  const now = performance.now();
  for (const row of rows) {
    const e = netNpcEnsure(row); if (!e) continue;
    let b = NET_NPCS.buffers.get(row.id);
    if (!b || immediate) b = [];
    b.push({ at: now, row }); if (b.length > 4) b.shift();
    NET_NPCS.buffers.set(row.id, b);
    netNpcApply(e, row, immediate || b.length === 1);
  }
  // A complete roster also withdraws a vanished actor; never keep a local extra.
  if (NET_NPCS.complete) for (const [id, e] of NET_NPCS.entities) if (!NET_NPCS.rows.has(id)) e.netNpcMissing = true;
  if (typeof FARM !== 'undefined') FARM.farmers = [...NET_NPCS.entities.values()]
    .filter((e) => !e.removed && !e.netNpcMissing && e.alive && e.ai.farmer).map((e) => e.id);
}
function netNpcMessage(m) {
  if (!m || m.t !== 'activity' || !netNpcServer()) return false;
  const admission = netWorldAdmissionRead(m.worldAdmission), current = netCurrentWorldAdmission();
  if (!admission || !netSameWorldAdmission(admission, current)) { NET_NPCS.stats.refused++; return false; }
  if (m.kind === 'authority') {
    const rows = netNpcRowsRead(m.npcs);
    if (!rows || !netNpcClean(m.authority, 128) || !m.authority || !netNpcClean(m.peer, 128)) return false;
    const changed = m.authority !== NET_NPCS.authority || m.peer !== NET_NPCS.peer
      || !netSameWorldAdmission(admission, NET_NPCS.admission);
    if (!changed) return true;
    NET_NPCS.authority = m.authority; NET_NPCS.peer = m.peer; NET_NPCS.admission = admission;
    NET_NPCS.recv = -1; NET_NPCS.seq = 0; NET_NPCS.sentAt = -Infinity; NET_NPCS.buffers.clear();
    if (netNpcMine()) for (const e of NET_NPCS.entities.values()) {
      if (e.ai.fisher?.J?.fisher === e.id) e.ai.fisher.J.fisher = null;
      e.ai.fisher = null; e.ai.fishWait = 0;
    }
    NET_NPCS.confirmed = new Map(rows.map(r => [r.id, r])); NET_NPCS.lastFrameAt = performance.now();
    netNpcReceiveRows(rows, true);
    if (netNpcMine()) {
      // Local plans contain local entity/field references. Resume from the shared
      // pose with fresh plans rather than replaying a former private simulation.
      for (const e of NET_NPCS.entities.values()) { e.netNpcPose = null; e.ai.plan = null; netNpcResumeWorker(e); e.ai.lifeWait = 0; e.ai.farmNext = 0; }
      if (typeof FARM !== 'undefined') for (const p of FARM.plots) if (p.own === 't') p.stand.worker = null;
    }
    return true;
  }
  if (m.kind !== 'npcs' || m.op !== 'snapshot' || !NET_NPCS.authority || m.authority !== NET_NPCS.authority
    || m.peer !== NET_NPCS.peer || !Number.isSafeInteger(m.seq) || m.seq <= NET_NPCS.recv) { NET_NPCS.stats.refused++; return false; }
  const rows = netNpcRowsRead(m.npcs); if (!rows) { NET_NPCS.stats.refused++; return false; }
  NET_NPCS.recv = m.seq; NET_NPCS.stats.received++;
  NET_NPCS.confirmed = new Map(rows.map(r => [r.id, r])); NET_NPCS.lastFrameAt = performance.now();
  if (!netNpcMine()) netNpcReceiveRows(rows);
  return true;
}
function netNpcStep(e, dt) {
  if (!e.netNpcId || !netNpcServer()) return false;
  // A private bootstrap slot absent from the canonical roster stays withdrawn after handoff.
  if (e.netNpcMissing) return true;
  if (netNpcMine() && netSameWorldAdmission(NET_NPCS.admission, netCurrentWorldAdmission())
    && NETWS.state === 'on' && (typeof netWorldPartsCanSimulate !== 'function' || netWorldPartsCanSimulate())) {
    e.netNpcPose = null; return false;
  }
  // During admission/reconnection, hold the last confirmed pose. A missing frame
  // never licenses an independent copy of the town's work.
  const b = NET_NPCS.buffers.get(e.netNpcId);
  e.prevX = e.x; e.prevZ = e.z;
  if (!b?.length) return true;
  const t = performance.now() - 250;
  let a = b[0], z = b[b.length - 1];
  for (let i = 1; i < b.length; i++) if (b[i].at >= t) { a = b[i - 1]; z = b[i]; break; }
  const u = Math.max(0, Math.min(1, (t - a.at) / Math.max(1, z.at - a.at))), r = z.row;
  e.x = lerp(a.row.p[0], r.p[0], u); e.y = lerp(a.row.p[1], r.p[1], u); e.z = lerp(a.row.p[2], r.p[2], u);
  e.yaw = a.row.y + angDiff(a.row.y, r.y) * u;
  e.anim.phase = lerp(a.row.ph, r.ph, u); e.anim.amt = lerp(a.row.am, r.am, u);
  e.netNpcPose = Math.floor(a.row.a) === Math.floor(r.a) && r.a >= a.row.a ? lerp(a.row.a, r.a, u) : r.a;
  e.anim.death = e.alive ? 0 : Math.min(1, Math.max(0, (GAME.t - e.deadAt) / 0.7));
  e._hamUntil = r.hm ? GAME.t + 1 : 0;
  netNpcBoat(e, r);
  return true;
}
const netNpcVisible = (e) => !e.netNpcId || !netNpcServer() || !e.netNpcMissing
  && (netNpcMine() || NET_NPCS.rows.has(e.netNpcId));
function netNpcSnapshot() {
  const rows = [];
  for (const [id, e] of NET_NPCS.entities) {
    const L = e.look; if (!L || rows.length >= NET_NPC_MAX) continue;
    const r2 = (n) => Math.round(n * 100) / 100;
    const row = { id, role: e.role, n: e.name || '', r: e.netNpcRealm, c: e.cls || null, l: e.level,
      p: [r2(e.x), r2(e.y), r2(e.z)], y: r2(e.yaw), a: Math.min(63.999, Math.round(animActValue(e) * 1000) / 1000),
      ph: Math.min(Math.PI * 128, r2(e.anim.phase)), am: r2(Math.max(0, Math.min(4, e.anim.amt))),
      h: r2(Math.max(0, Math.min(e.maxHp, e.hp))), m: r2(e.maxHp), d: e.alive ? 0 : 1, g: e.removed || e.netNpcMissing ? 1 : 0,
      lk: [...L.tabard, ...L.armor, L.skin, L.hair, netNpcMask(e), L.flags || 0, L.scale || e.scale || 1,
        L.outfit || 0, L.emblem ?? 3, L.fem ? 1 : 0, L.bulk || 0]
        .map((v, i) => [8, 9, 11, 12, 13].includes(i) ? v : Math.round(v * 1000) / 1000),
      st: e.seat ? [e.seat.y, e.seat.yaw ?? e.yaw, e.seat.sx ?? e.x, e.seat.sz ?? e.z].map(r2) : null,
      fm: e.ai.farmer ? [e.farmTown ?? e.netNpcRealm, e.ai.fieldHand ? 1 : 0, e.ai.seedSeller ? 1 : 0] : null,
      hm: e._hamUntil > GAME.t ? 1 : 0, bt: e.boat?.id || null };
    const clean = netNpcRowRead(row); if (clean) rows.push(clean);
  }
  return rows;
}
function netNpcPump(now) {
  if (!netNpcServer() || !netOn() || NETWS.state !== 'on' || !netHumanLive() || !netSharedWorldReady()) return;
  // An authority frame may arrive before the world has finished constructing.
  if (!netNpcMine() || NET_NPCS.ensurePending) {
    for (const row of NET_NPCS.rows.values()) if (!NET_NPCS.entities.get(row.id) || NET_NPCS.entities.get(row.id).removed) netNpcEnsure(row);
    if (GAME.built) NET_NPCS.ensurePending = false;
  }
  if (!netNpcMine() || !netSameWorldAdmission(NET_NPCS.admission, netCurrentWorldAdmission()) || now - NET_NPCS.sentAt < 250) return;
  const npcs = netNpcSnapshot(); if (!npcs.length) return;
  NET_NPCS.sentAt = now;
  if (netWsSend({ t: 'activity', kind: 'npcs', op: 'snapshot', authority: NET_NPCS.authority,
    worldAdmission: NET_NPCS.admission, seq: ++NET_NPCS.seq, npcs })) NET_NPCS.stats.sent++;
}
function netNpcReset() {
  NET_NPCS.authority = ''; NET_NPCS.peer = ''; NET_NPCS.admission = null;
  NET_NPCS.recv = -1; NET_NPCS.seq = 0; NET_NPCS.sentAt = -Infinity;
  NET_NPCS.rows.clear(); NET_NPCS.confirmed.clear(); NET_NPCS.lastFrameAt = 0; NET_NPCS.buffers.clear(); NET_NPCS.complete = false; NET_NPCS.ensurePending = false;
  for (const e of NET_NPCS.entities.values()) e.netNpcPose = null;
}
function netNpcAudit() {
  const actual = new Map(netNpcSnapshot().map(r => [r.id, r]));
  const canonical = NET_NPCS.confirmed.size ? NET_NPCS.confirmed : NET_NPCS.rows;
  const changes = [];
  for (const [id, expected] of canonical) {
    const value = actual.get(id), fields = [];
    if (!value) fields.push('unserializable-or-missing');
    else for (const key of ['n', 'role', 'r', 'lk', 'fm', 'd', 'g', 'bt'])
      if (JSON.stringify(value[key]) !== JSON.stringify(expected[key])) fields.push(key);
    const error = value ? Math.hypot(...value.p.map((v, i) => v - expected.p[i])) : null;
    if (fields.length || error > 2.5) changes.push({ id, fields, distance: error,
      expected: { n: expected.n, lk: expected.lk, fm: expected.fm, p: expected.p },
      actual: value && { n: value.n, lk: value.lk, fm: value.fm, p: value.p } });
  }
  return { self: NET.self, keeper: NET_NPCS.peer, mine: netNpcMine(), seq: NET_NPCS.recv,
    age: performance.now() - NET_NPCS.lastFrameAt, registered: NET_NPCS.entities.size,
    serializable: actual.size, canonical: canonical.size, changes,
    invalid: [...NET_NPCS.entities].filter(([id]) => !actual.has(id)).map(([id, e]) =>
      ({ id, role: e.role, name: e.name, realm: e.netNpcRealm, cls: e.cls, level: e.level, hp: e.hp, maxHp: e.maxHp, look: e.look })) };
}
if (typeof window !== 'undefined' && window.__hm) window.__hm.npcs = {
  state: NET_NPCS, snapshot: netNpcSnapshot, receive: netNpcMessage, visible: netNpcVisible, audit: netNpcAudit,
};

