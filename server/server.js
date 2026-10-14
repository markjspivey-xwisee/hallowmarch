// The Hallowmarch's own server: rung 2 of multiplayer (CLAUDE.md, Multiplayer).
// What it holds and decides:
//  - accounts: a guest account made at the first hello (a signed token the client keeps and presents again), or a name
//    and a password (scrypt); the token can be handed to the artifact's own page and kept in the player's private db
//    document, so a claude.ai account finds its server account on any device;
//  - saves: each account's character and world (`save`/`load`), held as files in HM_DATA;
//  - the shared world: the war's state the elected host reports (keeps' owners, gates, the hour, the campaign), checked
//    and persisted, handed to every client at its welcome (so a war goes on across sessions);
//  - presence: the players' profiles and fast states relayed with interest management (a body's fast state goes to
//    those within INTEREST m, its party and, every few seconds, to the rest for their maps), the moments it carries
//    filtered per reader (a blow, an invite, a party's chat only to whom it concerns; a realm's chat only to its realm);
//  - checks: a message rate, sizes, a pace no body can run (a jump not to a town, a muster or the Barrow is not
//    relayed), a blow from farther than any reach (dropped), the host chosen by the server's own clock.
// It does not run the March's simulation: the war is simulated by the host's page (as in rung 1) and kept here; the
// modules need three.js and the page to run (a headless war is rung 3's: see CLAUDE.md).
// usage: PORT=8787 HM_DATA=./data node server/server.js   (HM_SECRET signs tokens; HM_PAGE serves the built game at /)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { WebSocketServer } from 'ws';
import { makeSeason } from './season.js';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const ROOT = path.resolve(HERE, '..');
const CFG = {
  port: +process.env.PORT || 8787,
  data: process.env.HM_DATA || path.join(HERE, 'data'),
  page: process.env.HM_PAGE || path.join(ROOT, 'hallowmarch.html'),
  src: process.env.HM_SRC || path.join(ROOT, 'src'),
  roomCap: +process.env.HM_ROOM_CAP || 64,
  interest: +process.env.HM_INTEREST || 300,
  farEvery: 2500,
  maxMsg: 8192,
  maxSave: 768 * 1024,
  maxPace: 45,
  here: HERE,
  // the season (server/season.js): its seconds a real second, how often it is stepped (ms), its length, its seed
  seasonSpeed: +process.env.HM_SEASON_SPEED || 1,
  seasonStep: +process.env.HM_SEASON_STEP || 5000,
  seasonLen: (+process.env.HM_SEASON_DAYS || 28) * 86400,
  seasonSeed: +process.env.HM_SEASON_SEED || 19,
  seasonPush: +process.env.HM_SEASON_PUSH || 10000,
};
fs.mkdirSync(path.join(CFG.data, 'saves'), { recursive: true });
const STATS = { started: Date.now(), conns: 0, hellos: 0, msgs: 0, bytesIn: 0, bytesOut: 0, relayed: 0, farRelayed: 0, evRelayed: 0, evDropped: 0, hitsFar: 0, paceDropped: 0, rateDropped: 0, kicked: 0, saves: 0, loads: 0, worldWrites: 0, badMsgs: 0, claims: 0, logins: 0, acctRefused: 0, seasonSteps: 0, seasonSaves: 0, seasons: 0, contribs: 0, contribClipped: 0, orders: 0, ordersRefused: 0, liveCaptures: 0, seasonPushes: 0, chatKept: 0 };

/* ------------------------------------------------------------------ */
/* the March's ground: the sites and the walkable land (src/01_world.js) */
/* ------------------------------------------------------------------ */
function loadWorld() {
  const t0 = Date.now();
  try {
    // the sites are laid out when the module loads (buildWorld's land needs the page's other modules: rung 3 runs them headless)
    const code = ['00_util.js', '01_world.js'].map((f) => fs.readFileSync(path.join(CFG.src, f), 'utf8')).join('\n') +
      '\nreturn { SITES, REALMS, HALF };';
    const Wd = new Function(code)();
    const keeps = Wd.SITES.filter((s) => s.kind === 'keep');
    const ports = Wd.SITES.filter((s) => s.kind === 'town' || s.kind === 'muster').map((s) => [s.x, s.z]);
    console.log(`world: ${Wd.SITES.length} sites, ${keeps.length} keeps, built in ${Date.now() - t0} ms`);
    return { ...Wd, keepCount: keeps.length, ports, keeps: keeps.map((k) => ({ home: k.realm, x: Math.round(k.x), z: Math.round(k.z), name: k.name })) };
  } catch (e) {
    console.warn('world: not loaded (' + e.message + '): checks use bounds only');
    return { keepCount: 6, ports: [], HALF: 512, keeps: null };
  }
}
const WORLD = loadWorld();

/* ------------------------------------------------------------------ */
/* the store: files, written whole and renamed into place              */
/* ------------------------------------------------------------------ */
const store = {
  read(name, d) { try { return JSON.parse(fs.readFileSync(path.join(CFG.data, name), 'utf8')); } catch (e) { return d; } },
  write(name, obj) { const f = path.join(CFG.data, name), t = f + '.tmp' + process.pid; fs.writeFileSync(t, JSON.stringify(obj)); fs.renameSync(t, f); },
};
let SECRET = process.env.HM_SECRET;
if (!SECRET) { SECRET = store.read('secret.json', null); if (!SECRET) { SECRET = crypto.randomBytes(32).toString('hex'); store.write('secret.json', SECRET); } }
const ACCOUNTS = store.read('accounts.json', {});
let accTimer = null;
const accountsSave = () => { clearTimeout(accTimer); accTimer = setTimeout(() => store.write('accounts.json', ACCOUNTS), 400); };
const WORLDS = store.read('worlds.json', {});
// the season: the realms' strategic state, stepped while nobody is here (server/season.js)
CFG.keeps = WORLD.keeps;
const SEASON = makeSeason(CFG, store, STATS);
let worldTimer = null;
const worldsSave = () => { clearTimeout(worldTimer); worldTimer = setTimeout(() => { store.write('worlds.json', WORLDS); STATS.worldWrites++; }, 1500); };

/* ------------------------------------------------------------------ */
/* accounts and tokens                                                 */
/* ------------------------------------------------------------------ */
const b64u = (b) => Buffer.from(b).toString('base64url');
function tokenFor(id) {
  const body = b64u(JSON.stringify({ id, exp: Date.now() + 1000 * 3600 * 24 * 180 }));
  return body + '.' + crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
}
function tokenRead(tok) {
  if (typeof tok !== 'string' || tok.length > 600) return null;
  const [body, sig] = tok.split('.');
  if (!body || !sig) return null;
  const want = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
  if (sig.length !== want.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(want))) return null;
  try { const o = JSON.parse(Buffer.from(body, 'base64url').toString()); return o && typeof o.id === 'string' && o.exp > Date.now() ? o.id : null; } catch (e) { return null; }
}
const cleanName = (s) => (typeof s === 'string' ? s.replace(/[^A-Za-z0-9 _'-]/g, '').trim().slice(0, 20) : '');
function accountNew(name, guest, pass) {
  const id = (guest ? 'g' : 'a') + crypto.randomBytes(9).toString('base64url').replace(/[^A-Za-z0-9]/g, 'x');
  const A = { id, name: name || 'Guest', guest: !!guest, created: Date.now(), last: Date.now() };
  if (pass) { const salt = crypto.randomBytes(16).toString('hex'); A.pass = { salt, hash: crypto.scryptSync(pass, salt, 32).toString('hex') }; }
  ACCOUNTS[id] = A; accountsSave();
  return A;
}
function accountByName(name) { const n = name.toLowerCase(); return Object.values(ACCOUNTS).find((A) => !A.guest && A.name.toLowerCase() === n) || null; }
function accountResolve(h) {
  if (h.reg && typeof h.reg === 'object') {
    const name = cleanName(h.reg.name), pass = typeof h.reg.pass === 'string' ? h.reg.pass : '';
    if (name.length < 3 || pass.length < 6 || pass.length > 200) return { err: 'A name of 3 to 20 letters and a password of 6 or more' };
    if (accountByName(name)) return { err: 'That name is taken' };
    return { A: accountNew(name, false, pass) };
  }
  if (h.login && typeof h.login === 'object') {
    const A = accountByName(cleanName(h.login.name));
    const pass = typeof h.login.pass === 'string' ? h.login.pass : '';
    if (!A || !A.pass || !crypto.timingSafeEqual(Buffer.from(crypto.scryptSync(pass, A.pass.salt, 32).toString('hex')), Buffer.from(A.pass.hash))) return { err: 'No such name and password' };
    return { A };
  }
  const id = tokenRead(h.token);
  if (id && ACCOUNTS[id]) return { A: ACCOUNTS[id] };
  return { A: accountNew('Guest', true, null) };
}

/* ------------------------------------------------------------------ */
/* rooms (shards of the March)                                         */
/* ------------------------------------------------------------------ */
const ROOMS = new Map();
function roomFor(want) {
  let base = typeof want === 'string' && /^[a-z0-9][a-z0-9_-]{0,31}$/.test(want) ? want : 'march';
  for (let i = 1; i < 100; i++) {
    const name = i === 1 ? base : `${base}-${i}`;
    let R = ROOMS.get(name);
    if (!R) { R = { name, clients: new Map() }; ROOMS.set(name, R); }
    if (R.clients.size < CFG.roomCap) return R;
  }
  return null;
}
function roomHost(R) {
  let best = null;
  for (const c of R.clients.values()) if (c.slow && c.slow.on === 1 && (!best || c.since < best.since || (c.since === best.since && c.peer < best.peer))) best = c;
  return best;
}
const send = (c, o) => { if (c.ws.readyState !== 1) return; const s = JSON.stringify(o); STATS.bytesOut += s.length; c.ws.send(s); };
const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

// the war's shared state as a host reports it, checked: keeps' owners and gates (one a keep), the hour, the campaign
function worldCheck(w) {
  if (!w || typeof w !== 'object' || !Array.isArray(w.k) || w.k.length !== WORLD.keepCount) return null;
  if (!w.k.every((r) => r === 0 || r === 1 || r === 2)) return null;
  const g = Array.isArray(w.g) && w.g.length === WORLD.keepCount ? w.g.map((v) => (v === 0 ? 0 : 1)) : WORLD.keepCount ? new Array(WORLD.keepCount).fill(1) : [];
  const td = typeof w.td === 'number' && w.td >= 0 && w.td <= 3 ? w.td : 0;
  const cl = Array.isArray(w.cl) && w.cl.length === 3 ? w.cl.map((c) => (Array.isArray(c) ? [Math.max(0, Math.min(1e5, +c[0] || 0)), Math.max(0, Math.min(1e5, +c[1] || 0))] : [0, 0])) : undefined;
  return { k: w.k.slice(), g, td, tm: w.tm === 1 ? 1 : 0, cn: Number.isFinite(w.cn) ? Math.max(0, Math.round(w.cn)) : 0, cl, at: Date.now() };
}
const legitJump = (p) => p.x > 1000 || WORLD.ports.some(([x, z]) => Math.hypot(p.x - x, p.z - z) < 45);
// a moment for this reader? (a blow, an invite, a party's chat to whom it concerns; a realm's chat to its realm)
function evFor(c, o, ev) {
  const [, kind, to, data] = ev;
  if (to) return to === o.peer;
  if (kind === 'say') { const ch = Array.isArray(data) ? data[0] : ''; if (ch === 'p') return !!(c.party && o.party === c.party); return c.realm === o.realm; }
  return true;
}

/* ------------------------------------------------------------------ */
/* the connection                                                      */
/* ------------------------------------------------------------------ */
function onHello(c, h) {
  const r = accountResolve(h);
  if (r.err) { send(c, { t: 'denied', why: r.err }); return; }
  const R = roomFor(h.room);
  if (!R) { send(c, { t: 'denied', why: 'The March is full' }); c.ws.close(); return; }
  c.acct = r.A; c.acct.last = Date.now(); accountsSave();
  c.room = R; c.peer = crypto.randomBytes(8).toString('hex'); c.since = Date.now();
  R.clients.set(c.peer, c);
  STATS.hellos++;
  const sk = SEASON.keepsOf(); let world = WORLDS[R.name] || null;
  if (sk && sk.length === WORLD.keepCount && sk.every((r) => r === 0 || r === 1 || r === 2)) world = { ...(world || { g: new Array(sk.length).fill(1), td: 0, tm: 0, cn: 0 }), k: sk.slice(), at: Date.now() }; // the season decides who holds the keeps
  c.lastSeen = (SEASON.roster[c.acct.id] && SEASON.roster[c.acct.id].last) || 0;
  send(c, { t: 'welcome', v: 1, peer: c.peer, acct: { id: c.acct.id, name: c.acct.name, guest: c.acct.guest }, token: tokenFor(c.acct.id), room: R.name, world, interest: CFG.interest, season: SEASON.RS ? { file: SEASON.M.file, speed: SEASON.speed } : null });
  for (const o of R.clients.values()) if (o !== c && o.slow) send(c, { t: 'peer', peer: o.peer, by: o.acct.id, slow: o.slow, fast: o.fast ? { ...o.fast, ev: [] } : undefined });
}
// the account, from a page already in: a guest names its own (`claim`: name and password set on it, so it keeps its
// save), or asks for a named one's token (`login`: the page keeps it and loads again; this socket stays the guest's, so
// nothing the page saves before it reloads lands on the named account); six tries a minute a socket
function onAcct(c, m) {
  const now = Date.now(), no = (why) => send(c, { t: 'acct', ok: false, why });
  c.acctTries = (c.acctTries || []).filter((t) => now - t < 60000);
  if (c.acctTries.length >= 6) { STATS.acctRefused++; no('Too many tries: wait a minute'); return; }
  c.acctTries.push(now);
  const name = cleanName(m.name), pass = typeof m.pass === 'string' ? m.pass : '';
  if (name.length < 3 || pass.length < 6 || pass.length > 200) { no('A name of 3 to 20 letters and a password of 6 or more'); return; }
  if (m.op === 'claim') {
    if (!c.acct.guest) { no('This account has a name already'); return; }
    if (accountByName(name)) { no('That name is taken'); return; }
    const salt = crypto.randomBytes(16).toString('hex');
    c.acct.name = name; c.acct.guest = false; c.acct.pass = { salt, hash: crypto.scryptSync(pass, salt, 32).toString('hex') };
    accountsSave(); STATS.claims++;
    send(c, { t: 'acct', ok: true, op: 'claim', acct: { id: c.acct.id, name: c.acct.name, guest: false }, token: tokenFor(c.acct.id) });
  } else if (m.op === 'login') {
    const r = accountResolve({ login: { name, pass } });
    if (r.err) { STATS.acctRefused++; no(r.err); return; }
    STATS.logins++;
    send(c, { t: 'acct', ok: true, op: 'login', acct: { id: r.A.id, name: r.A.name, guest: false }, token: tokenFor(r.A.id) });
  } else no('Unknown');
}
function onSlow(c, d) {
  if (!d || typeof d !== 'object' || Array.isArray(d)) return;
  d.since = c.since; // the server's clock decides who was here first (the host)
  c.slow = d;
  c.realm = d.r === 0 || d.r === 1 || d.r === 2 ? d.r : -1;
  c.party = typeof d.pt === 'string' ? d.pt.slice(0, 24) : '';
  const R = c.room;
  if (d.w && roomHost(R) === c) {
    const w = worldCheck(d.w);
    if (w) {
      // a keep taken in the live war is taken in the season (a change between two of the host's reports, not its first)
      if (R.hostK && R.hostBy === c.peer && SEASON.RS) { const sk = SEASON.keepsOf(); w.k.forEach((r, i) => { if (r !== R.hostK[i] && sk && sk[i] !== r) SEASON.capture(i, r, c.acct.name); }); }
      R.hostK = w.k.slice(); R.hostBy = c.peer;
      WORLDS[R.name] = w; worldsSave();
    }
  }
  if (c.realm >= 0) {
    SEASON.seen(c.acct.id, { name: cleanName(d.dn || d.n) || c.acct.name, r: c.realm, c: typeof d.c === 'string' ? d.c.slice(0, 10) : '', l: Number.isFinite(d.l) ? Math.max(1, Math.min(60, d.l | 0)) : 1, rk: Number.isFinite(d.rr) ? Math.max(0, Math.min(20, d.rr | 0)) : 0 });
    c.rank = Number.isFinite(d.rr) ? d.rr | 0 : 0;
    if (!c.toldSeason || c.toldRealm !== c.realm) { c.toldSeason = true; c.toldRealm = c.realm; seasonTell(c, c.lastSeen ? (Date.now() - c.lastSeen) / 1000 : -1, true); }
  }
  for (const o of R.clients.values()) if (o !== c) send(o, { t: 'peer', peer: c.peer, by: c.acct.id, slow: d });
}
function onFast(c, d) {
  if (!d || typeof d !== 'object' || !Array.isArray(d.p) || d.p.length !== 3 || !d.p.every(Number.isFinite)) { STATS.badMsgs++; return; }
  const now = Date.now(), p = { x: d.p[0], z: d.p[2] };
  if (Math.abs(p.x) > 4000 || Math.abs(p.z) > 4000) { STATS.badMsgs++; return; }
  // a pace no body runs (the gallop is 15 m/s, a rush 18): not relayed, unless the jump ends where bodies are set down
  if (c.pos && now - c.posT < 5000) {
    const dt = Math.max(0.05, (now - c.posT) / 1000), dd = dist(p, c.pos);
    if (dd > 6 && dd / dt > CFG.maxPace && !legitJump(p) && !(c.pos.x > 1000)) { c.suspect = (c.suspect || 0) + 1; STATS.paceDropped++; return; }
  }
  c.pos = p; c.posT = now;
  // the moments new since this sender's last (over a socket nothing is lost: each is sent once)
  const evs = Array.isArray(d.ev) ? d.ev.filter((e) => Array.isArray(e) && e.length >= 3 && Number.isFinite(e[0]) && e[0] > (c.evSeq || 0) && typeof e[1] === 'string').slice(-40) : [];
  if (evs.length) c.evSeq = evs[evs.length - 1][0];
  for (const e of evs) if (e[1] === 'say' && Array.isArray(e[3]) && e[3][0] === 'r' && typeof e[3][1] === 'string' && c.realm >= 0) { SEASON.chatIn(c.realm, c.acct.name === 'Guest' && c.slow ? cleanName(c.slow.n) || 'Guest' : c.acct.name, e[3][1].replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff]/g, '')); STATS.chatKept++; }
  c.fast = { ...d, ev: [] };
  const R = c.room;
  for (const o of R.clients.values()) {
    if (o === c) continue;
    const mine = evs.filter((e) => {
      if (!evFor(c, o, e)) return false;
      if (e[1] === 'hit' && o.pos && dist(c.pos, o.pos) > 70) { STATS.hitsFar++; return false; } // no reach is that long
      return true;
    });
    STATS.evDropped += evs.length - mine.length;
    const near = !o.pos || dist(o.pos, c.pos) < CFG.interest || (c.party && o.party === c.party);
    if (near) { send(o, { t: 'peer', peer: c.peer, fast: { ...d, ev: mine } }); STATS.relayed++; }
    else {
      if (mine.length) { send(o, { t: 'ev', peer: c.peer, ev: mine }); STATS.evRelayed += mine.length; }
      const k = c.peer; o.farAt = o.farAt || new Map();
      if (now - (o.farAt.get(k) || 0) > CFG.farEvery) { o.farAt.set(k, now); send(o, { t: 'peer', peer: c.peer, fast: { ...d, ev: [] }, far: 1 }); STATS.farRelayed++; }
    }
  }
}
/* ------------------------------------------------------------------ */
/* the season: told, given to, ordered (server/season.js)               */
/* ------------------------------------------------------------------ */
// what a player of a realm is told: the season's summary for its realm (with the news since `away` s ago on the first
// telling: what a returning player missed), its realm's roster, and (the first time) its realm's chat
function seasonTell(c, away, first) {
  if (!SEASON.RS || !(c.realm >= 0)) return;
  const since = away >= 0 ? SEASON.RS.t - away * SEASON.speed : first ? SEASON.RS.t - 3600 : c.seasonT || SEASON.RS.t - 60;
  const s = SEASON.summary(c.realm, since);
  c.seasonT = SEASON.RS.t;
  const online = [...c.room.clients.values()].filter((o) => o.realm === c.realm).map((o) => o.acct.id);
  for (const R of ROOMS.values()) if (R !== c.room) for (const o of R.clients.values()) if (o.realm === c.realm) online.push(o.acct.id);
  const o = { t: 'season', s, roster: SEASON.rosterOf(c.realm, online), first: first ? 1 : 0, away: away >= 0 ? Math.round(away) : -1, speed: SEASON.speed };
  if (first) o.chat = (SEASON.chat[c.realm] || []).slice(-20);
  send(c, o); STATS.seasonPushes++;
}
function onContrib(c, m) {
  const now = Date.now();
  c.cWin = (c.cWin || []).filter((t) => now - t < 1000);
  if (c.cWin.length >= 4) { send(c, { t: 'contrib', ok: false, why: 'Too fast', q: m.q }); return; }
  c.cWin.push(now);
  if (!(c.realm >= 0)) { send(c, { t: 'contrib', ok: false, why: 'No realm yet', q: m.q }); return; }
  const r = SEASON.RS ? SEASON.contribute(c.acct.id, c.realm, String(m.k || ''), m.n) : { ok: false, why: 'No season here' };
  send(c, { t: 'contrib', q: m.q, k: m.k, ...r });
}
function onOrder(c, m) {
  const now = Date.now();
  if (now - (c.orderAt || 0) < 2500) { STATS.ordersRefused++; send(c, { t: 'order', ok: false, why: 'One order at a time', q: m.q }); return; }
  c.orderAt = now;
  if (!(c.realm >= 0) || !SEASON.RS) { send(c, { t: 'order', ok: false, why: 'No season here', q: m.q }); return; }
  // one vote an account for each choice a season (a vote again for the same thing counts once)
  const o = m.o || {}, key = [o.kind, o.id, o.keep].join(':');
  const V = (c.acct.votes = c.acct.votes || {});
  const sn = SEASON.RS.n || 1;
  if (o.kind !== 'muster' && V[key] === sn) { STATS.ordersRefused++; send(c, { t: 'order', ok: false, why: 'You have voted for that already', q: m.q }); return; }
  const r = SEASON.order(c.acct.id, c.realm, o, c.rank || 0, c.acct.name);
  if (r.ok && o.kind !== 'muster') { V[key] = sn; accountsSave(); }
  if (!r.ok) STATS.ordersRefused++;
  send(c, { t: 'order', q: m.q, ...r });
  if (r.ok) for (const R of ROOMS.values()) for (const x of R.clients.values()) if (x.realm === c.realm) seasonTell(x, -1, false);
}
function onMsg(c, raw) {
  STATS.msgs++; STATS.bytesIn += raw.length;
  if (raw.length > CFG.maxMsg && !(raw.length <= CFG.maxSave + 64 && raw.slice(0, 20).includes('"save"'))) { STATS.badMsgs++; return; }
  const now = Date.now();
  if (now - c.winT > 1000) { c.winT = now; c.winN = 0; }
  if (++c.winN > 60) { STATS.rateDropped++; if (c.winN > 240) { STATS.kicked++; c.ws.close(4008, 'too many messages'); } return; }
  let m;
  try { m = JSON.parse(raw); } catch (e) { STATS.badMsgs++; return; }
  if (!m || typeof m.t !== 'string') return;
  if (m.t === 'hello') { if (!c.acct) onHello(c, m); return; }
  if (!c.acct) return;
  if (m.t === 'slow') onSlow(c, m.d);
  else if (m.t === 'acct') onAcct(c, m);
  else if (m.t === 'fast') onFast(c, m.d);
  else if (m.t === 'ping') send(c, { t: 'pong', c: m.c, s: now });
  else if (m.t === 'contrib') onContrib(c, m);
  else if (m.t === 'order') onOrder(c, m);
  else if (m.t === 'season') seasonTell(c, -1, false);
  else if (m.t === 'save') {
    if (!m.d || typeof m.d !== 'object' || m.d.v !== 1) { send(c, { t: 'saved', ok: false }); return; }
    store.write(path.join('saves', c.acct.id + '.json'), m.d); STATS.saves++;
    send(c, { t: 'saved', ok: true, at: now });
  } else if (m.t === 'load') { STATS.loads++; send(c, { t: 'save', d: store.read(path.join('saves', c.acct.id + '.json'), null) }); }
  else if (m.t === 'wipe') { try { fs.unlinkSync(path.join(CFG.data, 'saves', c.acct.id + '.json')); } catch (e) { /* none */ } send(c, { t: 'saved', ok: true, at: now }); }
}

/* ------------------------------------------------------------------ */
/* HTTP: health, the numbers, the game itself                          */
/* ------------------------------------------------------------------ */
const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/health') { res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' }); res.end(JSON.stringify({ ok: true, rooms: ROOMS.size, players: [...ROOMS.values()].reduce((n, R) => n + R.clients.size, 0), up: Math.round((Date.now() - STATS.started) / 1000) })); return; }
  // the keeper's door (HM_ADMIN set in Railway's variables, never in the repository): a keep's holder set as the season
  // would set it (tests: the season's own capture told to the pages), a new season, the season saved now
  if (u.pathname === '/admin' && req.method === 'POST') {
    const key = process.env.HM_ADMIN || '', give = (code, o) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
    const got = String(req.headers['x-hm-admin'] || '');
    if (!key || got.length !== key.length || !crypto.timingSafeEqual(Buffer.from(got), Buffer.from(key))) { give(403, { ok: false }); return; }
    const op = u.searchParams.get('op'), i = +u.searchParams.get('i'), r = +u.searchParams.get('r');
    if (op === 'keep' && SEASON.RS && SEASON.RS.keeps[i] && r >= 0 && r <= 2) { const K = SEASON.RS.keeps[i]; if ('r' in K) K.r = r; else K.holder = r; SEASON.dirty = true; give(200, { ok: true, keeps: SEASON.keepsOf() }); return; }
    if (op === 'reset' && SEASON.M) { SEASON.RS = SEASON.M.realmSimInit(CFG.seasonSeed + Date.now() % 1000, { keeps: CFG.keeps, len: CFG.seasonLen, season: (SEASON.RS && SEASON.RS.n || 0) + 1 }); SEASON.roster = {}; SEASON.chat = [[], [], []]; for (const A of Object.values(ACCOUNTS)) delete A.votes; accountsSave(); SEASON.save(); give(200, { ok: true, n: SEASON.RS.n }); return; }
    if (op === 'save') { SEASON.save(); give(200, { ok: true }); return; }
    give(400, { ok: false }); return;
  }
  if (u.pathname === '/season') { res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' }); res.end(JSON.stringify(SEASON.summary(-1, (SEASON.RS ? SEASON.RS.t : 0) - 86400))); return; }
  if (u.pathname === '/stats') { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ ...STATS, proc: { mem: process.memoryUsage(), cpu: process.cpuUsage(), up: process.uptime() }, season: SEASON.RS ? { file: SEASON.M.file, t: SEASON.RS.t, phase: SEASON.RS.phase, stepMs: SEASON.stepMs.length ? { last: SEASON.stepMs[SEASON.stepMs.length - 1], max: Math.max(...SEASON.stepMs), mean: SEASON.stepMs.reduce((a, b) => a + b, 0) / SEASON.stepMs.length } : null, roster: Object.keys(SEASON.roster).length } : null, rooms: [...ROOMS.values()].map((R) => ({ name: R.name, players: R.clients.size, host: roomHost(R)?.peer || null, world: WORLDS[R.name] || null })), accounts: Object.keys(ACCOUNTS).length })); return; }
  if (u.pathname === '/' || u.pathname === '/index.html') {
    let html;
    try { html = fs.readFileSync(CFG.page, 'utf8'); } catch (e) { res.writeHead(404); res.end('The game is not built here (python3 build.py)'); return; }
    // the page served from here connects back here
    html = '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><script>window.__HM_NET_SERVER=(location.protocol==="https:"?"wss://":"ws://")+location.host+"/ws";</script></head><body>' + html + '</body></html>';
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache' }); res.end(html); return;
  }
  res.writeHead(404); res.end();
});
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: CFG.maxSave + 1024 });
wss.on('connection', (ws) => {
  STATS.conns++;
  const c = { ws, acct: null, room: null, peer: '', slow: null, fast: null, pos: null, posT: 0, winT: 0, winN: 0 };
  const helloTimer = setTimeout(() => { if (!c.acct) ws.close(4001, 'no hello'); }, 10000);
  ws.on('message', (data) => { try { onMsg(c, String(data)); } catch (e) { STATS.badMsgs++; console.warn('message', e.message); } });
  ws.on('close', () => {
    clearTimeout(helloTimer);
    const R = c.room;
    if (!R) return;
    R.clients.delete(c.peer);
    for (const o of R.clients.values()) send(o, { t: 'left', peer: c.peer });
    if (!R.clients.size && R.name !== 'march') ROOMS.delete(R.name);
  });
});
// a heartbeat: a socket that stops answering is closed (its body leaves the others' worlds)
setInterval(() => { for (const ws of wss.clients) { if (ws._dead) { ws.terminate(); continue; } ws._dead = true; ws.ping(); } }, 15000);
wss.on('connection', (ws) => ws.on('pong', () => { ws._dead = false; }));
// the season goes on while nobody is here: stepped by the server's clock, told to each realm's players, kept
if (SEASON.RS) {
  setInterval(() => { try { SEASON.step(); } catch (e) { console.warn('season step', e.message); } }, CFG.seasonStep);
  setInterval(() => { for (const R of ROOMS.values()) for (const c of R.clients.values()) if (c.realm >= 0) seasonTell(c, -1, false); }, CFG.seasonPush);
  setInterval(() => { if (SEASON.dirty) SEASON.save(); }, 30000);
}
let closing = false;
const shutdown = () => { if (closing) return; closing = true; try { SEASON.step(); SEASON.save(); store.write('accounts.json', ACCOUNTS); store.write('worlds.json', WORLDS); } catch (e) { console.warn('shutdown', e.message); } process.exit(0); };
process.on('SIGTERM', shutdown); process.on('SIGINT', shutdown);
server.listen(CFG.port, () => console.log(`The Hallowmarch server on :${CFG.port} (data ${CFG.data})`));
export { server, STATS, CFG, SEASON };
