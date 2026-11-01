/* Shared boats: an elected page rows ambient boats; a granted player rows
 * their own. The server arbitrates occupancy and keeps the last public pose.
 * Character saves, local entity ids and credentials never enter these rows. */
const NET_BOATS = {
  authority: '', host: '', admission: null, frames: new Map(), buffers: new Map(),
  seq: 0, lastSend: -Infinity, lastSnapshot: '', pending: null, applying: false, actions: new Map(),
};
const NET_BOAT_STATES = new Set(['moored', 'free', 'beached', 'burning', 'burnt']);
const netBoatEnabled = () => typeof NETWS !== 'undefined' && !!NETWS.url;
const netBoatLive = () => netBoatEnabled() && NETWS.state === 'on' && netOn() && netHumanLive()
  && netSharedWorldReady() && !!NET_BOATS.authority;
const netBoatAmbient = () => !netBoatEnabled() || netBoatLive() && NET_BOATS.host === NET.self;
function netBoatRead(row) {
  if (!row || typeof row !== 'object' || !Number.isInteger(row.id) || row.id < 1 || row.id > 128
    || !['x', 'z', 'yaw', 'vx', 'vz', 'wr', 'ph', 'eff', 'grounded', 'char'].every(k => Number.isFinite(row[k]))
    || Math.abs(row.x) > 4000 || Math.abs(row.z) > 4000 || !NET_BOAT_STATES.has(row.st)
    || row.rider != null && (typeof row.rider !== 'string' || row.rider.length > 64)) return null;
  const r = { id: row.id, x: row.x, z: row.z, yaw: row.yaw,
    vx: clamp(row.vx, -15, 15), vz: clamp(row.vz, -15, 15), wr: clamp(row.wr, -8, 8),
    st: row.st, ph: clamp(row.ph, 0, 1), eff: clamp(row.eff, 0, 1),
    grounded: clamp(row.grounded, 0, 1), char: clamp(row.char, 0, 1), rider: row.rider || null,
    still: row.still === true, home: null, launch: null };
  if (row.home && Number.isInteger(row.home.j) && row.home.j >= 0 && row.home.j < 128
    && Number.isInteger(row.home.b) && row.home.b >= 0 && row.home.b < 128) r.home = { j: row.home.j, b: row.home.b };
  if (row.launch && ['t', 'dx', 'dz'].every(k => Number.isFinite(row.launch[k])))
    r.launch = { t: clamp(row.launch.t, 0, 30), dx: clamp(row.launch.dx, -1, 1), dz: clamp(row.launch.dz, -1, 1) };
  return r;
}
function netBoatRow(B) {
  const P = GAME.player;
  return { id: B.id, x: netR2(B.x), z: netR2(B.z), yaw: netR3(B.yaw),
    vx: netR3(B.vx), vz: netR3(B.vz), wr: netR3(B.wr), st: B.st,
    ph: netR3(B.ph), eff: netR3(B.eff), grounded: netR3(B.grounded), char: netR3(B.char),
    rider: P && P.boat === B && B.rider === P.id ? NET.self : B.netRider || null,
    still: !!B.still, home: B.home ? { j: B.home.j, b: B.home.b } : null,
    launch: B.launch ? { t: netR3(B.launch.t), dx: netR3(B.launch.dx), dz: netR3(B.launch.dz) } : null };
}
function netBoatSend(op, fields = {}) {
  if (!netBoatLive()) return false;
  return netWsSend({ t: 'activity', kind: 'boats', op, authority: NET_BOATS.authority,
    worldAdmission: NET_BOATS.admission, seq: ++NET_BOATS.seq, ...fields });
}
function netBoatCanSimulate(B) {
  if (!netBoatEnabled()) return true;
  if (!netBoatLive()) return false;
  const row = NET_BOATS.frames.get(B.id), P = GAME.player;
  if (row && B.netAuthority !== NET_BOATS.authority) netBoatTake(row, true);
  if (row?.rider) return row.rider === NET.self && !!P && P.boat === B;
  return NET_BOATS.host === NET.self;
}
// A true return means multiplayer handled the action. Boarding itself waits
// for the exclusive grant, so two players cannot both consume the same seat.
function netBoatBoard(B, e) {
  if (!netBoatEnabled() || e !== GAME.player) return false;
  if (!B || B.rider != null || B.st === 'burning' || B.st === 'burnt') return true;
  if (!netBoatLive() || !NET_BOATS.frames.has(B.id)) { uiToast('Waiting for the shared boat.'); return true; }
  const now = performance.now();
  if (NET_BOATS.pending && now - NET_BOATS.pending.at < 5000) return true;
  if (netBoatSend('board', { id: B.id })) NET_BOATS.pending = { id: B.id, at: now, authority: NET_BOATS.authority };
  return true;
}
function netBoatChanged(B, op) {
  if (!B || !netBoatEnabled() || NET_BOATS.applying) return;
  if (!netBoatLive()) return;
  const row = netBoatRow(B);
  if (op === 'leave' || op === 'moor') row.rider = null;
  if (op === 'launch' || op === 'leave' || op === 'moor') netBoatSend(op, { id: B.id, boats: [row] });
  NET_BOATS.lastSnapshot = '';
}
function netBoatLoad(B) {
  if (!netBoatEnabled()) return false;
  const row = NET_BOATS.frames.get(B.id);
  if (!row) return false;
  netBoatTake(row, true);
  return true;
}
function netBoatRebuildRequest(B) {
  if (!netBoatEnabled()) return false;
  if (!B || B.st !== 'burnt' || !netBoatLive() || !NET_BOATS.frames.has(B.id)
    || typeof netWorldPartsRequest !== 'function') {
    uiError('Waiting for the shared boat before rebuilding.'); return true;
  }
  // The server commits the hull and this command's receipt in one candidate.
  // The private journal owns the six reserved planks until that receipt settles.
  return netWorldPartsRequest('boat.rebuild', { id: B.id }, [['plank', 6]], true);
}
function netBoatReplaceRequest(B) {
  if (!netBoatLive() || NET_BOATS.host !== NET.self) return true;
  const berth = B.home && BOATS.jetties[B.home.j]?.berths[B.home.b];
  if (!berth) return true;
  const now = performance.now(), key = 'replace:' + B.id;
  if (now - (NET_BOATS.actions.get(key) ?? -Infinity) < 1000) return true;
  const row = { ...netBoatRow(B), x: berth.x, z: berth.z, yaw: berth.yaw,
    st: 'moored', char: 0, vx: 0, vz: 0, wr: 0, ph: 0, eff: 0, grounded: 0,
    rider: null, launch: null, still: false };
  // Only the server can confirm unattended replacement. A keeper snapshot
  // must never revive a burnt hull or race a nearby player's paid rebuild.
  if (netBoatSend('replace', { id: B.id, boats: [row], ambient: true })) NET_BOATS.actions.set(key, now);
  return true;
}
function netBoatAction(B, op, by = null) {
  if (!netBoatEnabled() || NET_BOATS.applying) return false;
  if (netBoatAmbient()) {
    if (op === 'ignite' && by && by !== GAME.player) {
      if (!NET_BOATS.frames.get(B.id)?.rider) return false;
      netBoatSend('ignite', { id: B.id, boats: [netBoatRow(B)], ambient: true });
      return true;
    }
    if (op === 'restore' && B.rebuildAt && GAME.t > B.rebuildAt
      && GAME.player && Math.hypot(B.x - GAME.player.x, B.z - GAME.player.z) > 30) return netBoatReplaceRequest(B);
  }
  if (!netBoatLive() || !NET_BOATS.frames.has(B.id)) return true;
  const now = performance.now(), key = op + ':' + B.id;
  if (now - (NET_BOATS.actions.get(key) ?? -Infinity) < 1000) return true;
  const row = netBoatRow(B);
  row.rider = null;
  if (op === 'ignite') { row.st = 'burning'; row.char = 0; }
  else if (op === 'restore') return netBoatRebuildRequest(B);
  if (netBoatSend(op, { id: B.id, boats: [row] })) NET_BOATS.actions.set(key, now);
  return true;
}
function netBoatTake(row, force = false) {
  const B = BOATS.list.find(b => b.id === row.id);
  if (!B) return;
  const P = GAME.player, mine = P && P.boat === B;
  // An authority change or another accepted occupant must stop local physics.
  if (mine && row.rider !== NET.self) {
    NET_BOATS.applying = true;
    try { boatLeave(P, null, null, true); } finally { NET_BOATS.applying = false; }
  }
  B.netRider = row.rider; B.netAuthority = NET_BOATS.authority;
  if (!force && mine && row.rider === NET.self) return;
  const oldRider = B.rider != null ? getEnt(B.rider) : null;
  if (oldRider && oldRider.boat === B && row.rider && row.rider !== NET.self) {
    oldRider.boat = null; oldRider.seat = null; oldRider.rowK = undefined; oldRider.fixedY = null;
  }
  Object.assign(B, { x: row.x, z: row.z, yaw: row.yaw, vx: row.vx, vz: row.vz, wr: row.wr,
    st: row.st, ph: row.ph, eff: row.eff, grounded: row.grounded, char: row.char,
    still: row.still, home: row.home, launch: row.launch ? { ...row.launch } : null });
  if (row.rider && row.rider !== NET.self) B.rider = netGhost(row.rider)?.id ?? 'net:' + row.rider;
  else if (row.rider === NET.self) B.rider = mine ? P.id : null;
  else if (oldRider && oldRider !== P && oldRider.role !== 'remote' && netBoatAmbient()) B.rider = oldRider.id;
  else B.rider = null;
  boatPose(B, 0);
}
function netBoatMessage(m) {
  if (!netBoatEnabled() || !m || m.t !== 'activity') return;
  const admission = netCurrentWorldAdmission();
  if (!admission || !netSameWorldAdmission(admission, m.worldAdmission)) return;
  if (m.kind === 'authority') {
    if (typeof m.authority !== 'string' || !m.authority || typeof m.peer !== 'string') return;
    if (NET_BOATS.authority !== m.authority) {
      NET_BOATS.pending = null; NET_BOATS.seq = 0; NET_BOATS.lastSend = -Infinity;
      NET_BOATS.lastSnapshot = ''; NET_BOATS.frames.clear(); NET_BOATS.buffers.clear(); NET_BOATS.actions.clear();
    }
    NET_BOATS.authority = m.authority; NET_BOATS.host = m.peer; NET_BOATS.admission = admission;
  } else if (m.kind !== 'boats' || m.authority !== NET_BOATS.authority) return;
  const now = performance.now();
  if (m.kind === 'boats' && (m.op === 'ignite' || m.op === 'restore')) NET_BOATS.actions.delete(m.op + ':' + m.id);
  for (const raw of Array.isArray(m.boats) ? m.boats.slice(0, 128) : []) {
    const row = netBoatRead(raw); if (!row) continue;
    const prev = NET_BOATS.frames.get(row.id);
    NET_BOATS.frames.set(row.id, row);
    const buf = NET_BOATS.buffers.get(row.id) || [];
    buf.push({ ...row, at: now }); while (buf.length > 5) buf.shift();
    NET_BOATS.buffers.set(row.id, buf);
    const ownSnapshot = m.op === 'snapshot' && netBoatAmbient() && !!prev;
    if (!ownSnapshot && (m.kind === 'authority' || !prev || prev.rider !== row.rider || row.st !== prev.st || netBoatCanSimulate(BOATS.list.find(b => b.id === row.id) || { id: row.id })))
      netBoatTake(row, m.kind === 'authority');
  }
  if (m.kind === 'boats' && m.op === 'board' && NET_BOATS.pending?.id === m.id) {
    const pending = NET_BOATS.pending; NET_BOATS.pending = null;
    const row = NET_BOATS.frames.get(m.id), B = BOATS.list.find(b => b.id === m.id), P = GAME.player;
    if (m.ok && pending.authority === NET_BOATS.authority && row?.rider === NET.self && P?.alive && !P.boat && B) {
      netBoatTake(row, true);
      boatBoard(B, P, true);
    } else if (m.ok && row?.rider === NET.self) netBoatSend('leave', { id: row.id, boats: [{ ...row, rider: null }] });
    else if (!m.ok) uiToast('That boat is already in use or no longer within reach.');
  }
}
// Followers draw accepted poses on the same delayed timeline as players.
// They never run currents, NPC rowing, burn/rebuild timers or collisions.
function netBoatStep(B, dt) {
  const buf = NET_BOATS.buffers.get(B.id), row = NET_BOATS.frames.get(B.id);
  if (!row) { boatPose(B, dt); return; }
  const rt = performance.now() - (NET.cfg.delay || 120);
  let a = buf?.[0] || row, b = a;
  for (const frame of buf || []) { if (frame.at <= rt) a = frame; if (frame.at >= rt) { b = frame; break; } b = frame; }
  const u = a === b ? 1 : clamp((rt - a.at) / Math.max(1, b.at - a.at), 0, 1);
  B.x = lerp(a.x, b.x, u); B.z = lerp(a.z, b.z, u); B.yaw = a.yaw + angDiff(a.yaw, b.yaw) * u;
  B.vx = lerp(a.vx, b.vx, u); B.vz = lerp(a.vz, b.vz, u); B.wr = lerp(a.wr, b.wr, u);
  B.ph = b.ph; B.eff = b.eff; B.st = row.st; B.char = row.char; B.grounded = row.grounded;
  B.home = row.home; B.still = row.still;
  boatPose(B, dt);
  const rider = row.rider && row.rider !== NET.self ? netGhost(row.rider) : null;
  if (rider) netBoatRemoteRider(rider);
}
function netBoatRemoteRider(e) {
  if (!netBoatEnabled() || !e || e.netCompanion) return;
  const row = [...NET_BOATS.frames.values()].find(r => r.rider === e.netPeer);
  const B = row && BOATS.list.find(b => b.id === row.id);
  if (!B) { if (e.boat) { e.boat = null; e.rowK = undefined; e.rowPh = undefined; e.fixedY = null; } return; }
  e.boat = B; B.rider = e.id;
  boatSeat(e, B, 'row'); e.yaw = B.yaw + Math.PI; e.rowK = B.eff > 0.05 ? B.eff : undefined; e.rowPh = B.ph;
}
function netBoatPump(now) {
  if (!netBoatEnabled()) return;
  if (!netBoatLive()) return;
  if (now - NET_BOATS.lastSend < 200 || !BOATS.built) return;
  NET_BOATS.lastSend = now;
  for (const B of BOATS.list) {
    const row = NET_BOATS.frames.get(B.id);
    if (row && B.netAuthority !== NET_BOATS.authority) netBoatTake(row, true);
  }
  const P = GAME.player;
  if (P?.boat && NET_BOATS.frames.get(P.boat.id)?.rider === NET.self)
    netBoatSend('state', { boats: [netBoatRow(P.boat)] });
  if (NET_BOATS.host !== NET.self) return;
  const rows = BOATS.list.filter(B => !NET_BOATS.frames.get(B.id)?.rider).map(netBoatRow);
  const key = JSON.stringify(rows);
  if (key !== NET_BOATS.lastSnapshot && netBoatSend('snapshot', { boats: rows })) NET_BOATS.lastSnapshot = key;
}
function netBoatReset() {
  NET_BOATS.authority = ''; NET_BOATS.host = ''; NET_BOATS.admission = null;
  NET_BOATS.frames.clear(); NET_BOATS.buffers.clear(); NET_BOATS.pending = null; NET_BOATS.actions.clear();
  NET_BOATS.lastSnapshot = ''; NET_BOATS.lastSend = -Infinity; NET_BOATS.seq = 0;
}
queueMicrotask(() => {
  if (typeof window.__hm === 'object') window.__hm.netboats = { NET_BOATS, read: netBoatRead,
    row: netBoatRow, message: netBoatMessage, pump: netBoatPump, reset: netBoatReset, canSimulate: netBoatCanSimulate };
});

queueMicrotask(() => {
  if (typeof netWorldPartsRegisterCommand !== 'function') return;
  netWorldPartsRegisterCommand('boat.rebuild', {
    durable: true, tools: ['tool_hammer'],
    point: args => { const B = BOATS.list.find(b => b.id === args.id); return B ? { x: B.x, z: B.z } : null; },
    range: 18,
    // This operation is intercepted by the server-owned boat authority. An
    // older server must refund the reservation rather than restoring for free.
    run: () => ({ ok: false, why: 'This server cannot safely settle the boat rebuild yet.' }),
  });
  netWorldPartsRegisterResult('boat.rebuild', () => {
    uiLog('The boat is sound again: new strakes where the old ones burnt.', 'sys');
  });
});