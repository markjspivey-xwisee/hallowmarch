/* ================================================================== */
/* [net] the March shared: everyone who has it open, in one world       */
/* ================================================================== */
// Rung 1 of multiplayer (CLAUDE.md, Multiplayer). Each page runs its own March; the players are the shared part:
// every other player in the room is a body in this world (role 'remote', a ghost: drawn by the people's crowds as any
// person is, moved from what its own page says, never thought for), and what they do reaches here as what they say
// they did. Everything travels over one link with two kinds of state (net14n's link interface, below):
//  - the slow profile (the lobby's presence, key `hm`): name, realm, calling, level, the name worn, the look, the
//    mantle, the horse, the wear on the gear, the party, and from the host the war's shared state (`w`);
//  - the fast state (the named room 'march''s presence, key `f`): place, heading, pace, the body's action, health,
//    mounted, swimming, a spell in hand, and a ring of the last moments (`ev`: a blow struck at someone, a buff laid,
//    a heal, a death, a bolt or an arrow loosed, chat, a party's invite and its answer), each with a number so a
//    reader takes each once. Viewers by link may set presence but send on no topic, so nothing here needs a topic.
// A blow on another player is settled by the one struck: the striker's page sends what it struck for, the struck
// page deals it to itself with its own armour, parries, shields and wards and sends back what landed (`hr`), which
// the striker shows. Who may hit whom: a remote player is a foe only to the local player of another realm (never to
// the March's own bodies, which leave it alone: each page's war is its own; its blows land only from its own page).
// The war's shared state: one page is the host (a server peer if one is there, else whoever has been in the room
// longest): its keeps' owners, gates and the sky's hour ride its profile; every other page takes them and holds its
// own war's captures for the host's word (a player's capture is told to the host, which takes it if it is plausible).
// With no room (no runtime, a signed-out viewer, a public link) none of this runs: the page plays alone as before.
const NET = {
  state: 'off', // off: not tried; connecting; on: in a room; alone: no room to be had
  link: null, self: '', since: Date.now(), peers: new Map(),
  fastAt: 0, slowAt: 0, slowKey: '', fastKey: '', seq: 0, lastFast: null,
  out: [], evSeq: 0, inbox: [],
  party: '', partyLead: false, invites: [], partyMax: 6,
  host: '', isHost: false, applyingWorld: false, srvWorld: null, srvWorldDone: false, worldKey: '', worldT: 0, capAsked: new Map(),
  vel: { x: 0, z: 0, px: 0, pz: 0, t: 0 },
  cfg: { fastHz: 10, delay: 120, predict: 0.25, ringT: 2600, ringMax: 22, slowEvery: 1.0, ghostR: 260 },
  stats: { fastSent: 0, slowSent: 0, upBytes: 0, downBytes: 0, fastRecv: 0, slowRecv: 0, evOut: 0, evIn: 0, hitsOut: 0, hitsIn: 0, hitsRefused: 0, hitsLanded: 0, buffsOut: 0, buffsIn: 0, healsIn: 0, ghosts: 0, interp: 0, extrap: 0, held: 0, jumps: 0, keepsApplied: 0, capsAsked: 0, capsTaken: 0, chatOut: 0, chatIn: 0, refused: 0, sizeTrim: 0, kills: 0, deaths: 0, linkErr: 0 },
  log: [],
};
const NET_REALM_OK = (r) => r === 0 || r === 1 || r === 2;
const netNum = (v, lo, hi, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? clamp(v, lo, hi) : d);
// what another page sent is shown only as text, never as markup: no control, format or invisible characters
const netStr = (s, n) => (typeof s === 'string' ? s.replace(/[\u0000-\u001f\u007f-\u009f\u00ad\u061c\u115f\u1160\u17b4\u17b5\u180e\u200b-\u200f\u2028-\u202e\u2060-\u206f\u3164\ufe00-\ufe0f\ufeff\uffa0\ufff0-\ufffb]/g, '').trim().slice(0, n) : '');
const netR2 = (v) => Math.round(v * 100) / 100, netR3 = (v) => Math.round(v * 1000) / 1000;
const netOn = () => NET.state === 'on' && !!NET.link;
const netPeerOf = (e) => (e && e.role === 'remote' ? e.netPeer : '');
const netGhost = (peer) => { const R = NET.peers.get(peer); return R && R.ghost && !R.ghost.removed ? R.ghost : null; };
function netNote(s) { if (NET.log.length > 60) NET.log.shift(); NET.log.push([Math.round(performance.now()), s]); }

/* ------------------------------------------------------------------ */
/* links: one interface, three ways (the artifact's room; a WebSocket   */
/* to a server, 14p_netws.js; the stand-in is the room's own API)        */
/* ------------------------------------------------------------------ */
// A link is { kind, setSlow(obj), setFast(obj), connected(), close() }; it calls netPeerUpdate(peer, info) and
// netPeerLeft(peer) as it hears the others, and sets NET.self.
async function netLinkRoom() {
  const C = window.claude;
  if (!C || typeof C.use !== 'function') return null;
  const room = await withTimeout(C.use('room').catch(() => null), 12000);
  if (!room) return null;
  let fast = null;
  try { fast = await withTimeout(room.join('march'), 9000); } catch (e) { fast = null; } // named rooms not offered: the lobby carries both
  const L = { kind: 'room', room, fast, mine: {}, unsub: [], conn: true };
  const take = (ch, which) => {
    for (const p of ch.peers) {
      if (p.isMe && p.sameTab) { NET.self = p.peer; continue; }
      if (p.isMe && !p.sameTab) continue; // your other tab is not another player (it would be your own body twice)
      const pr = p.presence || {};
      const info = { by: p.by, kind: p.kind, guest: !!p.guest };
      if (which === 'lobby') { info.slow = pr.hm; if (!fast) info.fast = pr.f; info.ref = pr; }
      else { info.fast = pr.f; info.fref = pr; }
      netPeerUpdate(p.peer, info);
    }
    for (const p of ch.left) if (!(p.isMe && p.sameTab)) { if (which === 'lobby') netPeerLeft(p.peer); else netPeerFastGone(p.peer); }
  };
  L.unsub.push(room.onPeers((ch) => take(ch, 'lobby'), (e) => { NET.stats.linkErr++; netNote('lobby ' + (e && e.code)); }));
  if (fast) L.unsub.push(fast.onPeers((ch) => take(ch, 'fast'), (e) => { NET.stats.linkErr++; netNote('march ' + (e && e.code)); }));
  if (typeof room.onConnection === 'function') L.unsub.push(room.onConnection((c) => { L.conn = c; }));
  L.setSlow = (o) => room.presence({ hm: o }).catch((e) => { NET.stats.refused++; netNote('slow ' + (e && e.code)); });
  L.setFast = (o) => (fast || room).presence({ f: o }).catch((e) => { NET.stats.refused++; netNote('fast ' + (e && e.code)); });
  L.connected = () => (typeof room.connected === 'function' ? room.connected() : true) && L.conn;
  // the shared war kept in the artifact's db (written by the host: netWorldKeep), taken by the first host of a session
  try {
    const db = await withTimeout(C.use('db').catch(() => null), 6000);
    if (db) {
      L.db = db;
      const snap = await withTimeout(db.doc('net/world').get().catch(() => null), 6000);
      const d = snap && snap.exists ? snap.data() : null;
      if (d && d.v === 1 && d.w && typeof d.w === 'object' && Date.now() - netNum(d.at, 0, 1e15) < 14 * 86400e3) NET.srvWorld = d.w;
    }
  } catch (e) { /* no db: the war lives while someone is here */ }
  L.close = () => { for (const u of L.unsub) { try { u(); } catch (e) { /* gone */ } } if (fast) fast.leave().catch(() => {}); };
  return L;
}
async function netConnect() {
  if (NET.state !== 'off') return;
  NET.state = 'connecting';
  let L = null;
  try {
    if (netServerUrl()) L = await netLinkWS(); // rung 2: the March's own server (14p_netws.js)
    if (!L) L = await netLinkRoom();
  } catch (e) { reportError(e); L = null; }
  if (!L) { NET.state = 'alone'; netNote('no room'); return; }
  NET.link = L; NET.state = 'on'; NET.linkedAt = performance.now();
  netNote('linked ' + L.kind);
  NET.slowKey = ''; NET.fastKey = '';
  netUiOn(); // the Players button, the chat (14o_netui.js)
}

/* ------------------------------------------------------------------ */
/* hearing the others                                                  */
/* ------------------------------------------------------------------ */
function netRecFor(peer) {
  let R = NET.peers.get(peer);
  if (!R) { R = { peer, by: null, kind: 'viewer', slow: null, fast: null, slowRef: null, fastRef: null, buf: [], off: Infinity, offT: 0, lastEv: -1, lastFS: -1, ghost: null, seenAt: performance.now(), joinedAt: performance.now(), hits: [], chatAt: 0, bubble: null }; NET.peers.set(peer, R); }
  return R;
}
function netPeerUpdate(peer, info) {
  if (!peer || peer === NET.self) return;
  const R = netRecFor(peer);
  R.by = info.by || R.by; R.kind = info.kind || R.kind; R.seenAt = performance.now();
  if (info.srv) R.srv = true;
  if (info.slow !== undefined && info.slow !== R.slowRef) { R.slowRef = info.slow; R.slow = netSlowRead(info.slow); NET.stats.slowRecv++; NET.stats.downBytes += netSize(info.slow); }
  if (info.fast !== undefined && info.fast !== R.fastRef) {
    R.fastRef = info.fast;
    const f = netFastRead(info.fast);
    NET.stats.downBytes += netSize(info.fast);
    if (f) {
      NET.stats.fastRecv++;
      R.fast = f;
      if (f.s !== R.lastFS) { R.lastFS = f.s; netBufPush(R, f); }
      if (f.ev) for (const ev of f.ev) if (ev[0] > R.lastEv) { R.lastEv = ev[0]; NET.inbox.push([peer, ev]); }
      if (NET.inbox.length > 400) NET.inbox.splice(0, NET.inbox.length - 400);
    } else if (info.fast === null || info.fast === undefined) R.fast = null;
  }
}
// moments heard apart from a fast state (a server sends a far player's moments meant for you without its place)
function netPeerEvents(peer, evs) {
  const R = NET.peers.get(peer);
  if (!R || !Array.isArray(evs)) return;
  for (const ev of evs.slice(-NET.cfg.ringMax - 4)) if (Array.isArray(ev) && ev.length >= 3 && Number.isFinite(ev[0]) && typeof ev[1] === 'string' && ev[0] > R.lastEv) { R.lastEv = ev[0]; NET.inbox.push([peer, ev]); }
}
function netPeerFastGone(peer) { const R = NET.peers.get(peer); if (R) { R.fast = null; R.buf.length = 0; } }
function netPeerLeft(peer) {
  const R = NET.peers.get(peer);
  if (!R) return;
  if (R.ghost) netGhostDrop(R);
  NET.peers.delete(peer);
  if (R.slow && R.slow.on && R.slow.n) uiLog(`${R.slow.dn || R.slow.n} has left the March.`, 'sys', R.slow.r);
}
const netSize = (o) => { try { return o ? JSON.stringify(o).length : 0; } catch (e) { return 0; } };
// the profile, read as untrusted data (every field checked, every string cleaned, every number bounded)
function netSlowRead(o) {
  if (!o || typeof o !== 'object') return null;
  const s = { on: o.on === 1 ? 1 : 0, since: netNum(o.since, 0, 1e15, Date.now()), n: netStr(o.n, 24) || 'Stranger', r: NET_REALM_OK(o.r) ? o.r : 0, c: CLASSES[o.c] ? o.c : 'warrior', l: Math.round(netNum(o.l, 1, LEVEL_CAP, 1)), rr: Math.round(netNum(o.rr, 1, 20, 1)) };
  s.dn = netStr(o.dn, 56) || s.n;
  const lk = Array.isArray(o.lk) && o.lk.length === 15 ? o.lk : null;
  if (lk) s.lk = { tabard: [netNum(lk[0], 0, 2), netNum(lk[1], 0, 2), netNum(lk[2], 0, 2)], armor: [netNum(lk[3], 0, 2), netNum(lk[4], 0, 2), netNum(lk[5], 0, 2)], skin: netNum(lk[6], 0, 1), hair: netNum(lk[7], 0, 1), mask: Math.round(netNum(lk[8], 0, (1 << 24) - 1)) & ~(WB.torch | WB.beater | WB.hammer), flags: Math.round(netNum(lk[9], 0, 1023)), scale: netNum(lk[10], 0.85, 1.12, 1), outfit: Math.round(netNum(lk[11], 0, 3)), emblem: Math.round(netNum(lk[12], 0, 3)), fem: lk[13] === 1 ? 1 : 0, bulk: netNum(lk[14], 0, 0.5) };
  s.mc = Math.round(netNum(o.mc, 0, 8 * 12)) & ~7; // the mantle's device above the emblem (10n_veteran.js), whole eights
  if (Array.isArray(o.hz) && o.hz.length === 8) s.hz = { coat: [netNum(o.hz[0], 0, 1), netNum(o.hz[1], 0, 1), netNum(o.hz[2], 0, 1)], cloth: [netNum(o.hz[3], 0, 1), netNum(o.hz[4], 0, 1), netNum(o.hz[5], 0, 1)], crowd: typeof o.hz[6] === 'string' && /^horse[a-z]*$/.test(o.hz[6]) && crowdBeast[o.hz[6]] ? o.hz[6] : null, visCode: Math.round(netNum(o.hz[7], 0, 4096)) };
  if (Array.isArray(o.wr) && o.wr.length === 5) s.wr = o.wr.map((v) => netNum(v, 0, 1));
  s.pt = typeof o.pt === 'string' && /^[a-z0-9]{4,24}$/.test(o.pt) ? o.pt : '';
  s.pl = o.pl === 1 ? 1 : 0;
  if (o.w && typeof o.w === 'object') s.w = netWorldRead(o.w);
  if (o.srv === 1) s.srv = 1;
  return s;
}
function netFastRead(o) {
  if (!o || typeof o !== 'object' || !Array.isArray(o.p) || o.p.length !== 3) return null;
  const f = { s: Math.round(netNum(o.s, 0, 1e12)), t: netNum(o.t, 0, 1e12), x: netNum(o.p[0], -4000, 4000), y: netNum(o.p[1], -500, 500), z: netNum(o.p[2], -4000, 4000), yaw: netNum(o.y, -50, 50), vx: 0, vz: 0, a: netNum(o.a, 0, 63.999), h: netNum(o.h, 0, 1, 1), m: netNum(o.m, 1, 1e6, 100), d: o.d === 1 ? 1 : 0, mo: o.mo === 1 ? 1 : 0, ph: netNum(o.ph, 0, TAU * 64), sk: 0, sa: 0, st: netNum(o.st, -500, 500, 0), cs: null, fl: Math.round(netNum(o.fl, 0, 1023)), tg: typeof o.tg === 'string' ? o.tg.slice(0, 32) : '' };
  if (Array.isArray(o.v) && o.v.length === 2) { f.vx = netNum(o.v[0], -40, 40); f.vz = netNum(o.v[1], -40, 40); }
  if (Array.isArray(o.sw) && o.sw.length === 2) { f.sk = netNum(o.sw[0], 0, 1); f.sa = netNum(o.sw[1], 0, 2); }
  if (Array.isArray(o.cs) && o.cs.length === 2 && ABILITIES[o.cs[0]]) f.cs = [o.cs[0], netNum(o.cs[1], 0, 1)];
  if (Array.isArray(o.ev)) f.ev = o.ev.filter((e) => Array.isArray(e) && e.length >= 3 && Number.isFinite(e[0]) && typeof e[1] === 'string').slice(-NET.cfg.ringMax - 4);
  return f;
}
// one snapshot more in a remote body's buffer, with the sender's clock: the offset to ours is the least seen (the
// quickest delivery), creeping up slowly when deliveries slow down for good
function netBufPush(R, f) {
  const rt = performance.now();
  const o = rt - f.t;
  if (!(R.off < Infinity) || o < R.off) R.off = o; else R.off = Math.min(o, R.off + (rt - R.offT) * 0.03);
  R.offT = rt;
  const last = R.buf[R.buf.length - 1];
  if (last && f.t <= last.t) return; // an old one late
  if (last && Math.hypot(f.x - last.x, f.z - last.z) > 24) { R.buf.length = 0; NET.stats.jumps++; } // set down somewhere new: no sliding across the map
  R.buf.push({ t: f.t, x: f.x, y: f.y, z: f.z, yaw: f.yaw, vx: f.vx, vz: f.vz, a: f.a, ph: f.ph, sk: f.sk, sa: f.sa, st: f.st });
  while (R.buf.length > 24) R.buf.shift();
}

/* ------------------------------------------------------------------ */
/* the others' bodies                                                  */
/* ------------------------------------------------------------------ */
function netGhostMake(R) {
  const s = R.slow, f = R.fast;
  const look = s.lk ? { ...s.lk, tabard: s.lk.tabard.slice(), armor: s.lk.armor.slice() } : classLook(s.c, s.r, mulberry(7), s.n);
  const e = makeEnt({ kind: 'humanoid', faction: s.r, role: 'remote', cls: s.c, level: s.l, name: s.dn, x: f.x, y: f.y, z: f.z, yaw: f.yaw, look, radius: 0.45, scale: look.scale || 1 });
  e.netPeer = R.peer; e.netAct = f.a; e.properName = true;
  e.netBase = { mask: look.mask, emblem: look.emblem };
  setupStats(e);
  e.maxHp = f.m; e.hp = f.h * f.m;
  R.ghost = e;
  NET.stats.ghosts++;
  netGhostLook(R);
  return e;
}
function netGhostDrop(R) {
  const e = R.ghost;
  R.ghost = null;
  if (!e || e.removed) return;
  const P = GAME.player;
  if (P && P.target === e.id) P.target = null;
  removeEnt(e);
}
// the profile on the body: name, level, look, mantle, wear
function netGhostLook(R) {
  const e = R.ghost, s = R.slow;
  if (!e || !s) return;
  e.name = s.dn; e.level = s.l; e.faction = s.r;
  if (e.cls !== s.c) { e.cls = s.c; setupStats(e, true); }
  if (s.lk && e._lkRef !== s) {
    e._lkRef = s;
    e.look = { ...s.lk, tabard: s.lk.tabard.slice(), armor: s.lk.armor.slice() };
    e.netBase = { mask: e.look.mask, emblem: e.look.emblem };
    e.scale = e.look.scale || 1;
  }
  // the mantle of the name it wears rides on the emblem (05a_rig.js reads the device above it): drawActors needs nothing
  e.look.emblem = e.netBase.emblem + (s.mc || 0);
  e.look.mask = e.netBase.mask | (s.mc ? WB.cape : 0) | (R.fast && R.fast.fl & 2 ? WB.torch : 0);
  if (s.wr) { e.wet = s.wr[0]; e.snow = s.wr[1]; e.dirt = s.wr[2]; e.blood = s.wr[3]; e.batter = s.wr[4]; }
}
// each step, from updateNPCs: where the body was a moment ago on its own page, a little ahead when the news is late
function netRemoteStep(e, dt) {
  const R = NET.peers.get(e.netPeer);
  if (!R || !R.fast || !R.buf.length) { e.prevX = e.x; e.prevZ = e.z; updateAnim(e, dt); return; }
  const now = performance.now(), b = R.buf, rt = now - R.off - NET.cfg.delay;
  let x, y, z, yaw, a, ph, sk, sa, st;
  const last = b[b.length - 1];
  if (rt >= last.t) {
    const k = Math.min((rt - last.t) / 1000, NET.cfg.predict); // a little prediction past the newest, then hold
    x = last.x + last.vx * k; z = last.z + last.vz * k; y = last.y; yaw = last.yaw; a = last.a; ph = last.ph; sk = last.sk; sa = last.sa; st = last.st;
    if (k > 0 && (last.vx || last.vz)) { if (k >= NET.cfg.predict) NET.stats.held++; else NET.stats.extrap++; }
    if (k > 0 && (last.vx || last.vz) && !stepOkForGhost(x, z)) { x = last.x; z = last.z; }
  } else if (rt <= b[0].t) { const s0 = b[0]; x = s0.x; y = s0.y; z = s0.z; yaw = s0.yaw; a = s0.a; ph = s0.ph; sk = s0.sk; sa = s0.sa; st = s0.st; }
  else {
    let i = b.length - 2;
    while (i > 0 && b[i].t > rt) i--;
    const s0 = b[i], s1 = b[i + 1], u = clamp((rt - s0.t) / Math.max(1, s1.t - s0.t), 0, 1);
    x = lerp(s0.x, s1.x, u); y = lerp(s0.y, s1.y, u); z = lerp(s0.z, s1.z, u);
    yaw = s0.yaw + angDiff(s0.yaw, s1.yaw) * u;
    a = Math.floor(s0.a) === Math.floor(s1.a) && s1.a >= s0.a ? lerp(s0.a, s1.a, u) : (u < 0.5 ? s0.a : s1.a); // one action's progress runs on; another takes over at the half
    ph = lerp(s0.ph, s1.ph, u); sk = lerp(s0.sk, s1.sk, u); sa = lerp(s0.sa, s1.sa, u); st = u < 0.5 ? s0.st : s1.st;
    NET.stats.interp++;
    while (b.length > 3 && b[1].t < rt - 400) b.shift();
  }
  e.x = x; e.z = z; e.y = y; e.yaw = yaw;
  e.netAct = a;
  // swimming: the shader's strokes and the waterline (07b_swim.js packs them from these)
  e.swimK = sk; e.swimAmt = sa; e.swim = sk > 0.5;
  if (sk > 0.01) e.swimPh = ((e.swimPh || 0) + dt * (0.6 + 2.86 * Math.hypot(last.vx, last.vz))) % (TAU * 64);
  e.seat = st ? { y: st } : null;
  const f = R.fast;
  e.maxHp = f.m; e.hp = f.h * f.m;
  if (f.cs) { if (!e.casting || !e.casting.net) e.casting = { id: f.cs[0], t: 0, total: 1, custom: true, net: true }; e.casting.id = f.cs[0]; e.casting.t = f.cs[1]; } else if (e.casting) e.casting = null;
  if (f.d && e.alive) { e.alive = false; e.deadAt = GAME.t; e.removeAt = Infinity; e.hp = 0; e.casting = null; if (e.mount) e.mount = null; deathEffects(e); }
  else if (!f.d && !e.alive) { e.alive = true; e.anim.death = 0; }
  // the horse under a rider
  const hz = R.slow && R.slow.hz;
  if (f.mo && e.alive && hz) { if (!e.mount) { e.mount = { coat: hz.coat, cloth: hz.cloth, crowd: hz.crowd, visCode: hz.visCode }; e.mountAnim = { phase: 0, amt: e.anim.amt || 0, q: 0 }; } }
  else if (e.mount) e.mount = null;
  if (f.fl & 1 && e.alive && Math.random() < 0.8) burnFlames(e); // on fire on its own page
  updateAnim(e, dt);
  if ((Math.floor(a) === 14 || Math.floor(a) === 18) && ph) e.anim.phase = ph; // on a ladder the rungs' own cycle (04l_towers.js)
  e.combatUntil = f.tg ? GAME.t + 2 : e.combatUntil;
}
const stepOkForGhost = (x, z) => inDungeon({ x }) || isWalkable(x, z) || !!waterAt(x, z);

/* ------------------------------------------------------------------ */
/* telling the others                                                  */
/* ------------------------------------------------------------------ */
function netSlowObj() {
  const P = GAME.player, prog = GAME.prog;
  const o = { v: 1, on: GAME.started && P ? 1 : 0, since: NET.since };
  if (P && prog) {
    const L = P.look;
    o.n = P.name.slice(0, 24); o.dn = late2Named(P).slice(0, 56); o.r = P.faction; o.c = P.cls; o.l = prog.level; o.rr = realmRank(prog.rp);
    o.lk = [...L.tabard.map(netR3), ...L.armor.map(netR3), netR3(L.skin), netR3(L.hair), L.mask & ~(WB.torch | WB.beater | WB.hammer), L.flags || 0, netR3(L.scale || 1), L.outfit ?? 0, L.emblem ?? 3, L.fem ? 1 : 0, netR3(L.bulk || 0)];
    o.mc = late3MantleCode(P) || 0;
    if (P.mount) o.hz = [...P.mount.coat.map(netR3), ...P.mount.cloth.map(netR3), P.mount.crowd || '', P.mount.crowd ? P.mount.visCode || 0 : 0];
    o.wr = [P.wet || 0, P.snow || 0, P.dirt || 0, P.blood || 0, P.batter || 0].map((v) => Math.round(clamp(v, 0, 1) * 20) / 20);
    if (NET.party) { o.pt = NET.party; o.pl = NET.partyLead ? 1 : 0; }
  }
  if (NET.isHost) o.w = netWorldObj();
  return o;
}
function netFastObj(now) {
  const P = GAME.player;
  const V = NET.vel, dts = Math.max(0.03, (now - V.t) / 1000);
  // the pace over the last send (what the others predict with)
  let vx = (P.x - V.px) / dts, vz = (P.z - V.pz) / dts;
  if (Math.hypot(vx, vz) > 30) { vx = 0; vz = 0; } // a jump, not a pace
  V.px = P.x; V.pz = P.z; V.t = now;
  V.x = lerp(V.x, vx, 0.6); V.z = lerp(V.z, vz, 0.6);
  if (Math.hypot(P.x - P.prevX, P.z - P.prevZ) < 1e-4 && Math.hypot(vx, vz) < 0.05) { V.x = 0; V.z = 0; }
  let fl = 0;
  if (P.alive && P.buffs.some((b) => b.kind === 'burn' && b.until > GAME.t)) fl |= 1;
  if (P.brand && P.alive) fl |= 2;
  if (isStunned(P)) fl |= 4;
  if (inDungeon(P)) fl |= 8;
  const act = animActValue(P);
  const o = { s: 0, t: Math.round(now), p: [netR2(P.x), netR2(P.y), netR2(P.z)], y: netR3(((P.yaw % TAU) + TAU) % TAU), v: [netR2(V.x), netR2(V.z)], a: netR3(act), h: netR3(clamp(P.hp / P.maxHp, 0, 1)), m: Math.round(P.maxHp), d: P.alive ? 0 : 1, mo: P.mount ? 1 : 0, ph: 0, sw: 0, st: 0, cs: 0, fl, tg: '' };
  if (Math.floor(act) === 14 || Math.floor(act) === 18) o.ph = netR2(P.anim.phase);
  if (P.swimK > 0.01) o.sw = [netR3(P.swimK), netR3(P.swimAmt || 0)];
  if (P.seat) o.st = netR2(P.seat.y);
  if (P.casting && P.casting.id !== 'summon' && ABILITIES[P.casting.id]) o.cs = [P.casting.id, netR2(clamp(P.casting.t / P.casting.total, 0, 1))];
  const t = getEnt(P.target);
  if (t && t.role === 'remote') o.tg = t.netPeer;
  return o;
}
// the ring of moments: each read once by its number; kept a few seconds, so a page that hears every few updates still has them
// a moment that must not be lost (an invite and its answer, a chat line, a death, a capture told to the host, the land)
// stays in the ring longer than a blow's: a page busy for a few seconds (a long frame, a phone in a pocket) still finds it
// in the latest state it reads, which is all presence keeps
const NET_EV_KEEP = { inv: 9000, pa: 9000, say: 9000, die: 9000, cap: 9000, land: 6000 };
function netEvent(kind, to, data) {
  if (!netOn()) return;
  NET.evSeq++;
  NET.out.push({ e: [NET.evSeq, kind, to || 0, data], t: performance.now(), k: NET_EV_KEEP[kind] || NET.cfg.ringT });
  NET.stats.evOut++;
  NET.fastAt = Math.min(NET.fastAt, performance.now() - 1000 / NET.cfg.fastHz + 30); // out within a few hundredths
}
function netPump(dt) {
  if (NET.state === 'off' && GAME.ready) netConnect();
  if (!netOn()) return;
  const now = performance.now();
  netHostElect();
  netInbox();
  netGhosts();
  const P = GAME.player;
  // the profile when it has changed (looked at once a second)
  if (now - NET.slowAt > NET.cfg.slowEvery * 1000) {
    NET.slowAt = now;
    const o = netSlowObj(), k = JSON.stringify(o);
    if (k !== NET.slowKey) { NET.slowKey = k; NET.stats.slowSent++; NET.stats.upBytes += k.length; NET.link.setSlow(o); }
  }
  // the fast state ten times a second while anything changes
  if (P && GAME.started && now - NET.fastAt >= 1000 / NET.cfg.fastHz) {
    NET.fastAt = now;
    if (NET.out.length) NET.out = NET.out.filter((x) => now - x.t <= x.k);
    while (NET.out.length > NET.cfg.ringMax) NET.out.shift();
    const o = netFastObj(now);
    const key = JSON.stringify([o.p, o.y, o.v, o.a, o.h, o.m, o.d, o.mo, o.ph, o.sw, o.st, o.cs, o.fl, o.tg, NET.evSeq]);
    if (key !== NET.fastKey) {
      NET.fastKey = key;
      o.s = ++NET.seq;
      o.ev = NET.out.map((x) => x.e);
      let s = JSON.stringify(o);
      while (s.length > 3700 && o.ev.length) { o.ev.shift(); NET.out.shift(); NET.stats.sizeTrim++; s = JSON.stringify(o); } // presence holds 4 KiB
      NET.stats.fastSent++; NET.stats.upBytes += s.length;
      NET.lastFast = o;
      NET.link.setFast(o);
    }
  }
  netDeathWatch();
  netWorldKeep(now);
}
// the host writes the shared war to the artifact's db when it has changed (once in 30 s at most, one write at a time),
// so the next session's first host takes it up; a viewer who may not write the db leaves it to whoever may
function netWorldKeep(now) {
  const L = NET.link;
  if (!NET.isHost || !L || !L.db || L.dbNo || L.dbBusy || now - (L.dbAt || 0) < 30000 || !GAME.started) return;
  const w = netWorldObj(), k = JSON.stringify([w.k, w.g, w.cn, w.cl]);
  if (k === L.dbKey) return;
  L.dbAt = now; L.dbBusy = true;
  L.db.doc('net/world').set({ v: 1, w, at: Date.now() }).then(() => { L.dbKey = k; NET.stats.worldKept = (NET.stats.worldKept || 0) + 1; }).catch((e) => { if (e && (e.code === 'invalid_argument' || e.code === 'not_granted' || e.code === 'revoked')) L.dbNo = true; }).finally(() => { L.dbBusy = false; });
}

/* ------------------------------------------------------------------ */
/* ghosts come and go                                                  */
/* ------------------------------------------------------------------ */
function netGhosts() {
  const P = GAME.player;
  for (const R of NET.peers.values()) {
    const want = R.slow && R.slow.on && R.fast && GAME.started && (!P || dist2(R.fast.x, R.fast.z, P.x, P.z) < NET.cfg.ghostR * NET.cfg.ghostR || (R.slow.pt && R.slow.pt === NET.party));
    if (want && !R.ghost) netGhostMake(R);
    else if (!want && R.ghost) netGhostDrop(R);
    if (R.ghost && R.ghost.removed) R.ghost = null;
    if (R.ghost && R.slowRef !== R._lookRef) { R._lookRef = R.slowRef; netGhostLook(R); }
    else if (R.ghost && R.fast && (R.fast.fl & 2) !== (R._fl2 || 0)) { R._fl2 = R.fast.fl & 2; netGhostLook(R); }
    if (R.bubble && R.bubble.until < performance.now()) R.bubble = null;
  }
}
// a remote player is a foe only to you, and only of another realm (and not in a pact, as the March's own); the March's
// own bodies leave it alone: each page's war is its own (isEnemy, 07_entities.js)
function netIsEnemy(a, b) {
  const P = GAME.player;
  if (!P) return false;
  if (a.role === 'remote' && b.role === 'remote') return false;
  const me = a.role === 'remote' ? b : a, o = a.role === 'remote' ? a : b;
  if (me !== P && !(me.tame && me.tame.owner === 'player')) return false;
  return o.faction !== P.faction;
}

/* ------------------------------------------------------------------ */
/* what you do to them                                                 */
/* ------------------------------------------------------------------ */
// a blow on a remote player: told to its page, which settles it (dealDamage, 07_entities.js); what it estimates here
// drives what follows on your own side (momentum, the hit's flash and sound)
function netOutHit(src, dst, amount, opts) {
  const P = GAME.player;
  if (!src || !P || !(src === P || (src.tame && src.tame.owner === 'player')) || !dst.alive || !netOn()) return 0;
  const est = amount * (1 - (opts.pierce === true ? 0 : dst.drBase * (1 - (+opts.pierce || 0))));
  netEvent('hit', dst.netPeer, { a: Math.round(amount * 10) / 10, c: opts.crit ? 1 : 0, k: typeof opts.kind === 'string' ? opts.kind.slice(0, 12) : 'melee', pi: opts.pierce === true ? 1 : +opts.pierce || 0, dt: opts.dot ? 1 : 0, ab: typeof opts.ability === 'string' ? opts.ability.slice(0, 16) : '', ar: typeof opts.arrow === 'string' ? opts.arrow.slice(0, 10) : '', el: opts.elem === 'fire' ? 'fire' : '', pet: src !== P ? 1 : 0 });
  NET.stats.hitsOut++;
  src.combatUntil = GAME.t + 6;
  dst.anim.flash = 1;
  onImpact(src, dst, est, opts);
  return est;
}
function netOutBuff(e, kind, value, dur, src, extra) {
  const P = GAME.player;
  const fake = { kind, value, until: GAME.t + dur, src, tick: GAME.t };
  if (!P || src !== P.id || !netOn()) return fake;
  if (!NET_BUFFS[kind]) return fake;
  netEvent('buf', e.netPeer, [kind, netR3(+value || 0), netR2(+dur || 0)]);
  NET.stats.buffsOut++;
  return fake;
}
function netOutHeal(src, dst, amount) {
  const P = GAME.player;
  if (!P || src !== P || !netOn() || !(amount > 0) || dst.faction !== P.faction) return 0;
  netEvent('heal', dst.netPeer, Math.round(amount));
  return Math.min(amount, dst.maxHp - dst.hp);
}
// the buffs a page takes from another's blows and spells, and the bounds it takes them within
const NET_BUFFS = { stun: [1, 4], snare: [0.9, 8], root: [1, 6], dot: [0, 0], burn: [0, 0], bleed: [0, 0], hot: [0, 0], wound: [0.6, 10], dazzle: [0.5, 4], tracked: [1, 30], dr: [0.5, 10], dmg: [0.3, 10], shield: [0, 0] };
// a bolt, an arrow or a spell loosed by you is shown on their pages (visual only: its blow comes as `hit`)
function netOnShot(src, target, kind, point, from) {
  const P = GAME.player;
  if (!P || src !== P || !netOn()) return;
  const tp = netPeerOf(target);
  netEvent('pj', 0, [kind.slice(0, 10), netR2(from ? from.x : P.x), netR2(from ? from.y : P.y + 1.45 * (P.scale || 1)), netR2(from ? from.z : P.z), tp, point ? netR2(point.x) : netR2(target ? target.x : P.x), point ? netR2(point.y) : netR2(target ? target.y + 1 : P.y), point ? netR2(point.z) : netR2(target ? target.z : P.z)]);
}
function netOnArrow(A) {
  const P = GAME.player;
  if (!P || A.src !== P.id || !netOn()) return;
  netEvent('ar', 0, [netR2(A.x), netR2(A.y), netR2(A.z), netR2(A.vx), netR2(A.vy), netR2(A.vz), (A.type || '').slice(0, 10)]);
}
// the land changed by your hand (a tree you fell, your fire landing, your meteor's or your leap's crater): told to the
// others, whose pages change theirs the same way (those here now: a page that comes later has its own land)
// a spell of another page's player broken here (a flare, a storm, a blunt arrow that broke it on your page: breakCast and
// flareBreak): told to its page, which breaks it by its own rules (a steadied spell, a mage's ward), so a flare is a flare
// between players too; the body here stops casting at once, and its page's word follows
function netOutBreak(e, flare) {
  if (!e.casting || !netOn() || !GAME.player || !netIsEnemy(GAME.player, e)) return false;
  netEvent('brk', e.netPeer, flare ? 1 : 0);
  NET.stats.breaksOut = (NET.stats.breaksOut || 0) + 1;
  e.casting = null;
  return true;
}
// a change a player makes to the land, told to the pages there now (each does it as its own page did; the fire with the
// remote body as its caster, so it spares what the March's own fire spares there: a friend's town, a foe's never)
function netLand(kind, data) { if (netOn() && GAME.player) netEvent('land', 0, [kind, ...data]); }
// a keep's capture by your hand, when another page is the host: told to it (it takes it if it agrees)
function netCaptureHeld(K, realm) {
  if (!netOn() || NET.isHost || NET.applyingWorld || !NET.host) return false;
  const i = WAR.keeps.indexOf(K), P = GAME.player;
  if (P && realm === P.faction && dist(P.x, P.z, K.site.x, K.site.z) < 90 && !NET.capAsked.has(i + ':' + realm)) {
    NET.capAsked.set(i + ':' + realm, GAME.t);
    netEvent('cap', NET.host, [i, realm]);
    NET.stats.capsAsked++;
    uiLog(`You have taken ${K.site.name}: the March's host hears of it.`, 'sys', realm);
  }
  K.lord = null; // its lord fell here: the garrison sends another, the host's word holds the keep
  return true;
}

/* ------------------------------------------------------------------ */
/* what they do to you                                                 */
/* ------------------------------------------------------------------ */
function netInbox() {
  if (!NET.inbox.length) return;
  const list = NET.inbox.splice(0, NET.inbox.length);
  for (const [peer, ev] of list) {
    const to = ev[2];
    if (to && to !== NET.self) continue;
    const R = NET.peers.get(peer);
    if (!R) continue;
    NET.stats.evIn++;
    try { netHandle(R, ev[1], ev[3]); } catch (err) { reportError(err); }
  }
}
function netHandle(R, kind, d) {
  const P = GAME.player, src = R.ghost;
  if (kind === 'say') { netChatIn(R, d); return; }
  if (kind === 'inv' || kind === 'pa' || kind === 'pk') { netPartyIn(R, kind, d); return; }
  if (!P || !GAME.started) return;
  if (kind === 'hit') {
    NET.stats.hitsIn++;
    if (!src || !src.alive || !P.alive || !d || typeof d !== 'object' || !isEnemy(P, src)) { NET.stats.hitsRefused++; return; }
    // plausible: from about where its body is, at a pace a body strikes, no harder than its level allows
    const now = performance.now();
    R.hits = R.hits.filter((t) => now - t < 1000);
    const range = d.k === 'melee' && !d.dt ? 12 : 60;
    if (R.hits.length >= 14 || dist(src.x, src.z, P.x, P.z) > range) { NET.stats.hitsRefused++; return; }
    R.hits.push(now);
    const cap = baseDmg(src.level) * 2.2 * 6 * (d.c ? 1.5 : 1);
    const amt = netNum(d.a, 0, cap);
    const opts = { crit: d.c === 1, kind: typeof d.k === 'string' ? d.k : 'melee', pierce: d.pi === 1 ? true : netNum(d.pi, 0, 1), dot: d.dt === 1, net: true };
    if (d.ab && ABILITIES[d.ab]) opts.ability = d.ab;
    if (d.ar && /^[a-z]+$/.test(d.ar)) opts.arrow = d.ar;
    if (d.el === 'fire') opts.elem = 'fire';
    const hp0 = P.hp;
    const dealt = dealDamage(src, P, amt, opts);
    NET.stats.hitsLanded++;
    netEvent('hr', R.peer, [Math.round(dealt || 0), d.c ? 1 : 0, P.alive ? 0 : 1, Math.round(hp0 - P.hp)]);
    return;
  }
  if (kind === 'hr') {
    if (!Array.isArray(d) || !src) return;
    const n = Math.round(netNum(d[0], 0, 1e6)), crit = d[1] === 1;
    uiFloatAt(src.x, src.y + 2.1 * (src.scale || 1), src.z, (crit ? 'Crit ' : '') + (n > 0 ? n : 'Absorbed'), crit ? 'crit' : '');
    uiLog(`You hit ${src.name} for ${n} damage${crit ? ' (critical)' : ''}.`, 'dmg');
    return;
  }
  if (kind === 'buf') {
    if (!src || !Array.isArray(d) || !P.alive) return;
    const B = NET_BUFFS[d[0]];
    if (!B) return;
    const friendly = !isEnemy(P, src);
    if (friendly !== (d[0] === 'hot' || d[0] === 'dr' || d[0] === 'dmg' || d[0] === 'shield')) return; // a foe lays only harm, a friend only help
    if (dist(src.x, src.z, P.x, P.z) > 60) return;
    let v = +d[1] || 0;
    if (B[0] > 0) v = clamp(v, 0, B[0]); else v = clamp(v, 0, baseDmg(src.level) * 3);
    const dur = clamp(+d[2] || 0, 0, B[1] || 20);
    if (!(dur > 0)) return;
    addBuff(P, d[0], v, dur, src.id);
    NET.stats.buffsIn++;
    return;
  }
  if (kind === 'heal') {
    if (!src || isEnemy(P, src) || !P.alive || dist(src.x, src.z, P.x, P.z) > 60) return;
    healEnt(src, P, netNum(d, 0, baseDmg(src.level) * 8));
    NET.stats.healsIn++;
    return;
  }
  if (kind === 'die') {
    const killer = Array.isArray(d) ? d[0] : '';
    const name = R.slow ? R.slow.dn : 'Someone';
    if (killer === NET.self && src) {
      NET.stats.kills++;
      GAME.prog.realmKills++;
      const rp = Math.round(40 + 6 * (R.slow ? R.slow.l : 1));
      addRP(rp);
      uiLog(`You have slain ${name} of ${REALMS[src.faction].name}. (+${rp} realm points)`, 'kill', src.faction);
      uiToast(`${name} falls to your hand.`);
    } else if (R.slow && (R.slow.r === P.faction || R.slow.pt && R.slow.pt === NET.party)) uiLog(`${name} has fallen.`, 'warn', R.slow.r);
    return;
  }
  if (kind === 'pj') {
    if (!src || !Array.isArray(d) || d.length < 8 || !PROJ_COL.hasOwnProperty(d[0])) return;
    if (dist2(src.x, src.z, camera.position.x, camera.position.z) > 200 * 200) return;
    const tgt = d[4] === NET.self ? P : d[4] ? netGhost(d[4]) : null;
    const from = { x: netNum(d[1], -4000, 4000), y: netNum(d[2], -500, 500), z: netNum(d[3], -4000, 4000) };
    const pt = tgt ? null : { x: netNum(d[5], -4000, 4000), y: netNum(d[6], -500, 500), z: netNum(d[7], -4000, 4000) };
    spawnProjectile(src, tgt, d[0], null, pt, true, from);
    if (tgt === P) sndOnLoose(src, P, d[0], PROJ_SPEED[d[0]] || 24); // a foe's shot at you is heard coming (11c_sound.js)
    return;
  }
  if (kind === 'ar') {
    if (!src || !Array.isArray(d) || d.length < 7) return;
    if (dist2(src.x, src.z, camera.position.x, camera.position.z) > 200 * 200) return;
    const x = netNum(d[0], -4000, 4000), y = netNum(d[1], -500, 500), z = netNum(d[2], -4000, 4000);
    CLS.arrows.push({ ox: x, oy: y, oz: z, x, y, z, px: x, py: y, pz: z, vx: netNum(d[3], -120, 120), vy: netNum(d[4], -120, 120), vz: netNum(d[5], -120, 120), src: src.id, faction: src.faction, k: 1, type: /^[a-z]{1,10}$/.test(d[6]) ? d[6] : '', age: 0, tgt: null, mult: 0, crit: 0, wind: 1, vis: true });
    sfxAtE('bow', src);
    return;
  }
  if (kind === 'brk') {
    // a foe broke your spell on its page: within reach of a spell's interrupt (a flare's 10 m, a storm's or an arrow's
    // reach), one a second at most; your own rules decide (castSteady, a ward)
    if (!src || !src.alive || !P || !P.alive || !P.casting || !netIsEnemy(src, P) || dist(src.x, src.z, P.x, P.z) > 45 || GAME.t - (R.brkAt || -9) < 0.8) return;
    R.brkAt = GAME.t;
    const id = P.casting.id, broke = d === 1 ? flareBreak(P) : breakCast(P);
    if (broke) { NET.stats.breaksIn = (NET.stats.breaksIn || 0) + 1; uiLog(`${R.slow ? R.slow.dn : 'A foe'} breaks your ${ABILITIES[id] ? ABILITIES[id].name : 'spell'}.`, 'hurt'); }
    return;
  }
  if (kind === 'land') {
    if (!src || !Array.isArray(d) || !NATURE.built) return;
    const k = d[0];
    if (k === 'fell') { const t = W.trees[d[1] | 0]; if (t && !t.felled && dist(t.x, t.z, src.x, src.z) < 12) fellTree(t, netNum(d[2], -50, 50, 1), netNum(d[3], -50, 50, 0), 30, true); }
    else if (k === 'fire') { const x = netNum(d[1], -4000, 4000), z = netNum(d[3], -4000, 4000); if (dist(x, z, src.x, src.z) < 70) fireLandsAt(x, netNum(d[2], -500, 500), z, netNum(d[4], 0.2, 6, 1), src); }
    else if (k === 'imp' && (d[3] === 'meteor' || d[3] === 'leap')) { const x = netNum(d[1], -4000, 4000), z = netNum(d[2], -4000, 4000); if (dist(x, z, src.x, src.z) < 60) natureImpact(x, z, d[3], netNum(d[4], 1, 8, 3)); }
    NET.stats.landIn = (NET.stats.landIn || 0) + 1;
    return;
  }
  if (kind === 'cap' && NET.isHost) {
    // a player's capture told to the host: taken when that player is of the realm and stands at the keep
    if (!Array.isArray(d)) return;
    const K = WAR.keeps[d[0] | 0], realm = d[1];
    if (!K || !NET_REALM_OK(realm) || K.realm === realm || !R.slow || R.slow.r !== realm || !src || dist(src.x, src.z, K.site.x, K.site.z) > 110) return;
    captureKeep(K, realm, src);
    NET.stats.capsTaken++;
  }
}
// your own death told (who struck the last blow); a body of the March that kills you is no one's to tell
function netDeathWatch() {
  const P = GAME.player;
  if (!P) return;
  if (NET._alive === true && !P.alive) {
    const k = getEnt(P.lastHitBy);
    netEvent('die', 0, [k && k.role === 'remote' && GAME.t - P.lastHitAt < 8 ? k.netPeer : '']);
    NET.stats.deaths++;
  }
  NET._alive = P.alive;
}

/* ------------------------------------------------------------------ */
/* the shared war: a host, its word on the keeps and the sky           */
/* ------------------------------------------------------------------ */
function netHostElect() {
  let best = null, bs = Infinity, bp = '';
  const me = GAME.started && GAME.player;
  if (me) { best = NET.self || 'me'; bs = NET.since; bp = NET.self; }
  for (const R of NET.peers.values()) {
    if (!R.slow || !R.slow.on) continue;
    if (R.srv || R.slow.srv) { best = R.peer; bs = -1; bp = R.peer; break; } // a server is the host whenever it is there
    if (R.slow.since < bs || (R.slow.since === bs && R.peer < bp)) { best = R.peer; bs = R.slow.since; bp = R.peer; }
  }
  const was = NET.host;
  NET.host = best === 'me' ? NET.self : best || '';
  NET.isHost = !!me && (NET.host === NET.self || best === 'me');
  if (was !== NET.host && was) { netNote('host ' + NET.host); if (NET.isHost) uiLog('You now keep the March\'s shared war for those here.', 'sys'); }
  if (!NET.isHost) { const H = NET.peers.get(NET.host); netWorldTake(H && H.slow && H.slow.w); }
  else if (NET.srvWorld && !NET.srvWorldDone && performance.now() - NET.linkedAt > 3000 && ![...NET.peers.values()].some((R) => R.slow && R.slow.on)) { NET.srvWorldDone = true; netWorldTake(netWorldRead(NET.srvWorld)); netNote('world kept'); } // the first host of a session takes the war where it was kept (the server's, or the artifact's db)
}
function netWorldObj() {
  return {
    k: WAR.keeps.map((K) => K.realm), g: WAR.keeps.map((K) => (K.door.alive ? 1 : 0)), td: Math.round(tod.p * 1000) / 1000, tm: tod.mode === 'cycle' ? 1 : 0,
    cn: CAMPAIGN.n || 0, cl: CAMPAIGN.claims.map((c) => [Math.round(c.k), Math.round(c.h)]),
  };
}
function netWorldRead(w) {
  const o = { k: [], g: [], td: netNum(w.td, 0, 3), tm: w.tm === 1 ? 1 : 0, cn: Math.round(netNum(w.cn, 0, 1e6)) };
  if (Array.isArray(w.k)) o.k = w.k.slice(0, 16).map((r) => (NET_REALM_OK(r) ? r : -1));
  if (Array.isArray(w.g)) o.g = w.g.slice(0, 16).map((v) => (v === 0 ? 0 : 1));
  if (Array.isArray(w.cl) && w.cl.length === 3) o.cl = w.cl.map((c) => (Array.isArray(c) ? [netNum(c[0], 0, 1e5), netNum(c[1], 0, 1e5)] : [0, 0]));
  return o;
}
function netWorldTake(w) {
  if (!w || !GAME.started) return;
  NET.applyingWorld = true;
  try {
    // the keeps' owners, as the host's war has them
    WAR.keeps.forEach((K, i) => {
      const r = w.k[i];
      if (!NET_REALM_OK(r) || r === K.realm) return;
      captureKeep(K, r, null);
      NET.stats.keepsApplied++;
    });
    // the claims on the March, while it is the same campaign: one war panel for everyone here
    if (w.cl && w.cn === (CAMPAIGN.n || 0)) CAMPAIGN.claims.forEach((c, i) => { const h = w.cl[i]; if (Math.abs(c.k - h[0]) > 3) c.k = h[0]; if (Math.abs(c.h - h[1]) > 3) c.h = h[1]; });
    // the hour: one sky for everyone here (only while the sky runs its cycle)
    if (w.tm && tod.mode === 'cycle') { const d = ((w.td - tod.p + 4.5) % 3) - 1.5; tod.p = Math.abs(d) > 0.08 ? w.td : (tod.p + d * 0.05 + 3) % 3; }
  } finally { NET.applyingWorld = false; }
}

/* ------------------------------------------------------------------ */
/* test and debug hooks                                                */
/* ------------------------------------------------------------------ */
function netState() {
  const peers = [...NET.peers.values()].map((R) => ({ peer: R.peer, by: R.by, srv: !!R.srv, on: R.slow ? R.slow.on : 0, name: R.slow ? R.slow.dn : '', realm: R.slow ? R.slow.r : -1, cls: R.slow ? R.slow.c : '', level: R.slow ? R.slow.l : 0, party: R.slow ? R.slow.pt : '', ghost: R.ghost ? R.ghost.id : null, gx: R.ghost ? netR2(R.ghost.x) : null, gz: R.ghost ? netR2(R.ghost.z) : null, gy: R.ghost ? netR2(R.ghost.y) : null, alive: R.ghost ? R.ghost.alive : null, hp: R.ghost ? Math.round(R.ghost.hp) : null, act: R.ghost ? R.ghost.netAct : null, amt: R.ghost ? netR3(R.ghost.anim.amt) : null, mount: R.ghost ? !!R.ghost.mount : null, fx: R.fast ? R.fast.x : null, fz: R.fast ? R.fast.z : null, buf: R.buf.length, off: Math.round(R.off) }));
  return { state: NET.state, kind: NET.link ? NET.link.kind : '', self: NET.self, host: NET.host, isHost: NET.isHost, party: NET.party, lead: NET.partyLead, invites: NET.invites.map((i) => i.peer), peers, stats: { ...NET.stats }, out: NET.out.length, seq: NET.seq, lastFastBytes: NET.lastFast ? JSON.stringify(NET.lastFast).length : 0, slowBytes: NET.slowKey.length, log: NET.log.slice(-12) };
}
