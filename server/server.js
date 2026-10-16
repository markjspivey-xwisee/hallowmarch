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
import { createGamingRuntime } from './gaming/runtime.js';
import { configuredGamingStore } from './gaming/provider.js';
import { prepareGamingEnvironment } from './gaming/bootstrap.js';
import { configuredServiceMonitoring } from './gaming/service-monitoring.js';
import { createAgentHttp, gamingAgentAffordances } from './gaming/agent-http.js';
import { makeCompanies, reservedNames, coPledgeApply, coText } from './companies.js'; // [companies]
import { makeField } from './fieldarmies.js'; // [season2] the season's armies on the pages' fields

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
const STATS = { started: Date.now(), conns: 0, hellos: 0, msgs: 0, bytesIn: 0, bytesOut: 0, relayed: 0, farRelayed: 0, evRelayed: 0, evDropped: 0, hitsFar: 0, paceDropped: 0, rateDropped: 0, kicked: 0, saves: 0, loads: 0, worldWrites: 0, badMsgs: 0, claims: 0, logins: 0, acctRefused: 0, seasonSteps: 0, seasonSaves: 0, seasons: 0, contribs: 0, contribClipped: 0, orders: 0, ordersRefused: 0, liveCaptures: 0, seasonPushes: 0, chatKept: 0, regionChanges: 0, worldTold: 0, thinned: 0 };

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
// [companies] the companies of the realms (server/companies.js): kept beside the season, told to their members
const COMP = makeCompanies(CFG, store, STATS, {
  acct: (id) => ACCOUNTS[id] || null,
  acctByName: (n) => (n ? accountByName(n) : null),
  realmOf: (id) => (SEASON.roster[id] && (SEASON.roster[id].r === 0 || SEASON.roster[id].r === 1 || SEASON.roster[id].r === 2) ? SEASON.roster[id].r : -1),
  seasonN: () => (SEASON.RS && SEASON.RS.n) || 1,
  unitsPerPoint: () => (SEASON.M && SEASON.M.RSM && SEASON.M.RSM.sp && SEASON.M.RSM.sp.units) || 40,
  projects: () => (SEASON.M && SEASON.M.RSM ? Object.keys(SEASON.M.RSM.projects) : ((SEASON.summary(0, 0) || {}).proj || []).map((p) => p.id)),
  projectName: (id) => (SEASON.M && SEASON.M.RSM && SEASON.M.RSM.projects[id] ? SEASON.M.RSM.projects[id].name : id),
  pledgeApply: (realm, proj, good, units) => coPledgeApply(SEASON, realm, proj, good, units),
  reserved: reservedNames(WORLD),
});
SEASON.coOf = (id) => { const co = COMP.of(id); return co ? co.name : ''; }; // [companies] the realm's roster names each one's company
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
/* ------------------------------------------------------------------ */
/* regions: who simulates what (CLAUDE.md, Multiplayer)                */
/* ------------------------------------------------------------------ */
// The March in seven regions: each realm's third of the frontier (f0, f1, f2: the keeps stand there), each homeland
// (h0, h1, h2) and the Barrow (b). Of the pages in a region the one there longest keeps it: its word on the keeps of that
// region is the shard's (a keep's region is its frontier third), and the shard's host (the page longest in the shard) keeps
// whatever has no keeper of its own, the hour and the claims. Handed on when it leaves the region or the March.
const MUSTERS = (WORLD.SITES || []).filter((s) => s.kind === 'muster').map((s) => [s.x, s.z, s.realm]);
function regionOf(x, z) {
  if (x > 1000) return 'b';
  let best = 0, bd = Infinity;
  for (const [mx, mz, r] of MUSTERS) { const d = Math.hypot(x - mx, z - mz); if (d < bd) { bd = d; best = r; } }
  return (Math.hypot(x, z) < 190 ? 'f' : 'h') + best;
}
const KEEP_REGION = (WORLD.keeps || []).map((k) => regionOf(k.x, k.z));
const FIELD = makeField(SEASON, ROOMS, (c, o) => send(c, o), regionOf, WORLD, STATS); // [season2] (server/fieldarmies.js)
let gamingStore = null, gamingEnvironment = { ...process.env };
try { gamingEnvironment = await prepareGamingEnvironment(process.env); gamingStore = await configuredGamingStore(gamingEnvironment); }
catch { console.warn('gaming: native service configuration unavailable; shared expeditions disabled'); }
const GAMING = createGamingRuntime({ store: gamingStore, send: (c, o) => c.gamingReply ? c.gamingReply(o) : send(c, o) });
await GAMING.ready;
const gamingHttp = createAgentHttp({ gaming: GAMING });
let gamingMonitor = null, gamingMonitorBusy = false, gamingMonitorInitializing = false;
async function initializeGamingMonitor() {
  if (!gamingStore || !GAMING.manifest().enabled || gamingMonitor || gamingMonitorInitializing) return;
  gamingMonitorInitializing = true;
  try {
    if (gamingEnvironment.HM_GAMING_MONITOR_BOOTSTRAP_STATUS) gamingEnvironment = await prepareGamingEnvironment(process.env);
    gamingMonitor = await configuredServiceMonitoring({ store: gamingStore, env: gamingEnvironment });
  } catch { console.warn('gaming: operational monitoring unavailable; durable game service remains independent'); }
  finally { gamingMonitorInitializing = false; }
}
await initializeGamingMonitor();
async function sampleGamingService() {
  if (!gamingMonitor || gamingMonitorBusy) return;
  gamingMonitorBusy = true;
  try {
    try { await gamingMonitor.record(GAMING.metrics()); }
    catch { console.warn('gaming: operational sample pending; retrying retained observations'); }
    await gamingMonitor.flush();
  }
  catch { console.warn('gaming: operational monitoring delivery pending'); }
  finally { gamingMonitorBusy = false; }
}
if (process.env.HM_GAMING_MONITOR_ENABLED === '1') {
  setTimeout(() => { void sampleGamingService(); }, 5000).unref();
  setInterval(() => { void initializeGamingMonitor().then(sampleGamingService); }, 30000).unref();
}
function regionHosts(R) {
  const h = {};
  for (const c of R.clients.values()) {
    if (!c.region || !c.slow || c.slow.on !== 1) continue;
    const o = h[c.region] && R.clients.get(h[c.region]);
    if (!o || c.since < o.since || (c.since === o.since && c.peer < o.peer)) h[c.region] = c.peer;
  }
  return h;
}
function regionsTell(R, force) {
  const h = regionHosts(R), key = JSON.stringify(h);
  if (!force && key === R.regionKey) return;
  R.regionKey = key; R.regions = h; STATS.regionChanges++;
  for (const c of R.clients.values()) send(c, { t: 'hosts', h, kr: KEEP_REGION, you: c.region || '' });
}
// the war's shared state as the pages report it: each keep from its region's keeper (else the shard's host), the hour
// and the claims from the shard's host; merged, kept, told to every page when a keep changes, and a keep a page took in
// the live war taken in the season (a change between two of one keeper's reports, not its first word)
// the shard's war now: its kept word with the season's keeps (the season decides who holds them while nobody keeps them)
function worldNow(R) {
  const w = WORLDS[R.name] || null, sk = SEASON.keepsOf();
  if (sk && sk.length === WORLD.keepCount && sk.every((r) => r === 0 || r === 1 || r === 2) && !Object.keys(R.regions || {}).length && R.clients.size <= 1) return { ...(w || { g: new Array(sk.length).fill(1), td: 0, tm: 0, cn: 0 }), k: sk.slice(), at: Date.now() };
  return w;
}
function worldReport(c, raw) {
  const w = worldCheck(raw);
  if (!w) return;
  const R = c.room, H = roomHost(R), hosts = R.regions || {};
  const cur = WORLDS[R.name] || { ...w };
  const merged = { ...cur, k: (cur.k || w.k).slice(), g: (cur.g || w.g).slice() };
  if (H === c) { merged.td = w.td; merged.tm = w.tm; merged.cn = w.cn; merged.cl = w.cl; }
  let changed = false;
  R.rep = R.rep || [];
  const sk = SEASON.keepsOf();
  w.k.forEach((r, i) => {
    const keeper = hosts[KEEP_REGION[i]] || (H && H.peer);
    if (keeper !== c.peer) return;
    // the keeper's last word on it, or the shard's (a new keeper was handed the merged war with its hosts: `world` init)
    const last = R.rep[i] && R.rep[i].peer === c.peer ? R.rep[i].r : cur.k ? cur.k[i] : r;
    if (last !== r && sk && sk[i] !== r) { SEASON.capture(i, r, c.acct.name); coCaptured(R, i, r); } // [companies] the companies about it count it
    R.rep[i] = { peer: c.peer, r };
    if (merged.k[i] !== r) { merged.k[i] = r; changed = true; }
    merged.g[i] = w.g[i];
  });
  merged.at = Date.now();
  WORLDS[R.name] = merged; worldsSave();
  if (changed) { STATS.worldTold++; for (const o of R.clients.values()) if (o !== c) send(o, { t: 'world', w: merged }); }
}
// [perf3] the host's word on the sky: kept with the shard's war (a later session's first host takes it up), on disk once a minute
function keepWx(R, wx) {
  if (!wx || typeof wx !== 'object' || wx.v !== 1 || !Array.isArray(wx.c)) return;
  const s = JSON.stringify(wx);
  if (s.length > 4000) { STATS.wxRefused = (STATS.wxRefused || 0) + 1; return; }
  const w = WORLDS[R.name] || (WORLDS[R.name] = {});
  w.wx = { ...JSON.parse(s), at: Date.now() };
  STATS.wxKept = (STATS.wxKept || 0) + 1;
  if (!R.wxSavedAt || Date.now() - R.wxSavedAt > 60000) { R.wxSavedAt = Date.now(); worldsSave(); }
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
  const world = worldNow(R); // the season decides who holds the keeps while nobody is here
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
    coTell(c, false); // [companies] a named account may found or join a company now
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
  { const tag = c.realm >= 0 && !c.acct.guest ? COMP.tag(c.acct.id, c.realm) : null; if (tag) d.co = tag; else delete d.co; } // [companies] a member's company, stamped here: a page cannot claim one
  c.party = typeof d.pt === 'string' ? d.pt.slice(0, 24) : '';
  const R = c.room;
  if (d.w) worldReport(c, d.w);
  if (d.wx && roomHost(R) === c) keepWx(R, d.wx); // [perf3] the shard's sky, kept with its war (src/14r_netwx.js)
  if (c.realm >= 0) {
    SEASON.seen(c.acct.id, { name: cleanName(d.dn || d.n) || c.acct.name, r: c.realm, c: typeof d.c === 'string' ? d.c.slice(0, 10) : '', l: Number.isFinite(d.l) ? Math.max(1, Math.min(60, d.l | 0)) : 1, rk: Number.isFinite(d.rr) ? Math.max(0, Math.min(20, d.rr | 0)) : 0 });
    c.rank = Number.isFinite(d.rr) ? d.rr | 0 : 0;
    if (!c.toldSeason || c.toldRealm !== c.realm) { c.toldSeason = true; c.toldRealm = c.realm; seasonTell(c, c.lastSeen ? (Date.now() - c.lastSeen) / 1000 : -1, true); coTell(c, true); } // [companies] and its company
  }
  for (const o of R.clients.values()) if (o !== c) send(o, { t: 'peer', peer: c.peer, by: c.acct.id, slow: d });
  if (c.region && !c.regionTold) { c.regionTold = true; regionsTell(R); }
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
  const rg = regionOf(p.x, p.z);
  if (rg !== c.region) { const first = !c.region; c.region = rg; regionsTell(c.room); if (first) { send(c, { t: 'hosts', h: c.room.regions || {}, kr: KEEP_REGION, you: rg }); const w = worldNow(c.room); if (w) send(c, { t: 'world', w, init: 1 }); } }
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
    const dd = o.pos ? dist(o.pos, c.pos) : 0, mate = c.party && o.party === c.party;
    const near = !o.pos || dd < CFG.interest || mate;
    // a phone's budget: a body near at the sender's own pace (10 a second), farther ones less often (60 m: 5, 140 m: 2.5),
    // a moment always at once; the reader's own interpolation draws them between
    let gap = mate || dd < 60 ? 0 : dd < 140 ? 190 : 390;
    if (near && gap && !mine.length) { o.nearAt = o.nearAt || new Map(); if (now - (o.nearAt.get(c.peer) || 0) < gap) { STATS.thinned++; continue; } o.nearAt.set(c.peer, now); }
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
  // weather2's weather systems on the map, when the season's module keeps them (RS.weather): a slot the pages will read
  if (SEASON.RS.weather && typeof SEASON.RS.weather === 'object') o.wx = SEASON.RS.weather;
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
  if (r.ok && r.took > 0) { const cr = COMP.delivered(c.acct.id, c.realm, String(m.k || ''), r.took); if (cr) { r.co = cr; coTellCo(cr.co); } } // [companies] counted for the company (and its pledge)
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
/* ------------------------------------------------------------------ */
/* [companies] the companies: asked, answered, told (server/companies.js) */
/* ------------------------------------------------------------------ */
const coClients = function* () { for (const R of ROOMS.values()) yield* R.clients.values(); };
const coOnline = () => { const s = new Set(); for (const o of coClients()) if (o.acct) s.add(o.acct.id); return s; };
// a player told its company (or its invitations) and the realm's companies' standing; the first telling a session carries
// when it was last here, so the page tells it what was said in the company meanwhile
function coTell(c, first) {
  if (!c.acct) return;
  const o = { t: 'company', s: COMP.stateFor(c.acct, c.realm, coOnline()) };
  if (first) { o.first = 1; o.seen = c.lastSeen || 0; }
  send(c, o); STATS.coTold = (STATS.coTold || 0) + 1;
}
function coTellAcct(id) { for (const o of coClients()) if (o.acct && o.acct.id === id) coTell(o, false); }
function coTellCo(coId) { const m = new Set(COMP.membersOf(coId)); for (const o of coClients()) if (o.acct && m.has(o.acct.id)) coTell(o, false); }
// a keep taken in the live war (worldReport): the players of its taker about it (on its region's pages: within 160 m)
function coCaptured(R, i, r) {
  const K = WORLD.keeps && WORLD.keeps[i];
  if (!K) return;
  const accts = [];
  for (const o of R.clients.values()) if (o.realm === r && o.pos && Math.hypot(o.pos.x - K.x, o.pos.z - K.z) < 160 && !o.acct.guest) accts.push(o.acct.id);
  for (const id of COMP.captured(accts, r)) coTellCo(id);
}
function onCo(c, m) {
  const now = Date.now(), reply = (r) => send(c, { t: 'co', q: m.q, op: m.op, ...r });
  if (m.op === 'say' ? now - (c.coSayAt || 0) < 1000 : now - (c.coAt || 0) < 350) { COMP.stats.refused++; reply({ ok: false, why: 'Not so fast' }); return; }
  if (m.op === 'say') c.coSayAt = now; else c.coAt = now;
  if (m.op === 'get') { coTell(c, false); reply({ ok: true }); return; }
  if (!(c.realm >= 0)) { reply({ ok: false, why: 'No realm yet' }); return; }
  const A = c.acct, before = COMP.of(A.id);
  let r;
  if (m.op === 'found') r = COMP.found(A, c.realm, m.name, m.dev, m.col);
  else if (m.op === 'invite') r = COMP.invite(A, m.name);
  else if (m.op === 'answer') r = COMP.answer(A, String(m.id || ''), !!m.yes, c.realm);
  else if (m.op === 'leave') r = COMP.leave(A);
  else if (m.op === 'remove') r = COMP.remove(A, m.who);
  else if (m.op === 'rank') r = COMP.rank(A, m.who, m.role);
  else if (m.op === 'notice') r = COMP.notice(A, m.text);
  else if (m.op === 'pledge') r = COMP.pledge(A, typeof m.id === 'string' ? m.id.slice(0, 16) : '');
  else if (m.op === 'say') {
    r = COMP.say(A, m.text);
    if (r.ok) { const mem = new Set(COMP.membersOf(r.co)); for (const o of coClients()) if (o.acct && mem.has(o.acct.id)) send(o, { t: 'company', say: r.line, co: r.co }); }
    reply({ ok: r.ok, why: r.why }); return;
  } else if (m.op === 'muster') {
    // the company's members here now, the nearest first, form one party with the one who called it (six at most)
    const co = COMP.of(A.id);
    if (!co || (co.mem[A.id].role !== 'cap' && co.mem[A.id].role !== 'off')) { reply({ ok: false, why: 'Only the captain and the officers muster the company' }); return; }
    if (now - (co.musAt || 0) < 20000) { reply({ ok: false, why: 'The company mustered a moment ago' }); return; }
    const mem = new Set(Object.keys(co.mem)), here = [...c.room.clients.values()].filter((o) => o !== c && o.acct && mem.has(o.acct.id) && o.realm === co.realm && o.slow && o.slow.on === 1);
    here.sort((a, b) => (a.pos && c.pos ? Math.hypot(a.pos.x - c.pos.x, a.pos.z - c.pos.z) : 9e9) - (b.pos && c.pos ? Math.hypot(b.pos.x - c.pos.x, b.pos.z - c.pos.z) : 9e9));
    if (!here.length) { reply({ ok: false, why: 'No one of the company is in the March with you now' }); return; }
    co.musAt = now; COMP.stats.musters++;
    const pt = 'co' + crypto.randomBytes(6).toString('hex'), take = [c, ...here.slice(0, 5)];
    for (const o of take) send(o, { t: 'company', muster: { pt, by: A.name, n: take.length, co: co.name } });
    for (const o of here.slice(5)) send(o, { t: 'company', muster: { full: 1, by: A.name, n: take.length, co: co.name } });
    reply({ ok: true, n: take.length, left: Math.max(0, here.length - 5) }); return;
  } else r = { ok: false, why: 'Unknown' };
  reply({ ok: r.ok, why: r.why, name: r.name });
  if (!r.ok) return;
  // told: everyone of the company (and of the one it was before), an invitee or the one removed
  const after = COMP.of(A.id);
  if (after) coTellCo(after.id);
  if (before && before !== after) coTellCo(before.id);
  coTell(c, false);
  if (r.to) { coTellAcct(r.to); for (const o of coClients()) if (o.acct && o.acct.id === r.to) send(o, { t: 'company', invited: { by: A.name, co: after ? after.name : '' } }); }
  if (r.who) coTellAcct(r.who);
  if (m.op === 'answer' && r.co) coTellCo(r.co);
  // the stamp on the profile: a member's company on its frame and nameplate to the others at once
  for (const o of coClients()) if (o.acct && (o === c || o.acct.id === r.who) && o.slow) onSlow(o, { ...o.slow });
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
  if (m.t === 'gaming') { void GAMING.handle(c, m); return; }
  if (m.t === 'hello') { if (!c.acct) onHello(c, m); return; }
  if (!c.acct) return;
  if (m.t === 'slow') onSlow(c, m.d);
  else if (m.t === 'acct') onAcct(c, m);
  else if (m.t === 'fast') onFast(c, m.d);
  else if (m.t === 'ping') send(c, { t: 'pong', c: m.c, s: now });
  else if (m.t === 'contrib') onContrib(c, m);
  else if (m.t === 'order') onOrder(c, m);
  else if (m.t === 'season') seasonTell(c, -1, false);
  else if (m.t === 'co') onCo(c, m); // [companies]
  else if (m.t === 'sarmyrep') FIELD.report(c, m); // [season2]
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
  if (gamingHttp(req, res, u.pathname)) return;
  if (u.pathname === '/gaming/agents') { res.writeHead(200, { 'content-type': 'application/ld+json' }); res.end(JSON.stringify(gamingAgentAffordances())); return; }
  if (u.pathname === '/gaming/manifest') { res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(GAMING.manifest())); return; }
  if (u.pathname === '/gaming/status') { res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify({ manifest: GAMING.manifest(), metrics: GAMING.metrics(), monitoring: gamingMonitor?.status() || { enabled: false }, humanLearning: 'requires-verified-identity-and-session-consent' })); return; }
  if (u.pathname === '/gaming/vocabulary' || u.pathname === '/gaming/hallowmarch-vocabulary') { const file = u.pathname.endsWith('/vocabulary') ? 'vocabulary.jsonld' : 'hallowmarch-vocabulary.jsonld'; res.writeHead(200, { 'content-type': 'application/ld+json' }); res.end(fs.readFileSync(path.join(HERE, 'gaming', file))); return; }
  if (u.pathname === '/health') { const ok = process.env.HM_GAMING_ENABLED !== '1' || GAMING.manifest().enabled; res.writeHead(ok ? 200 : 503, { 'content-type': 'application/json', 'access-control-allow-origin': '*' }); res.end(JSON.stringify({ ok, rooms: ROOMS.size, players: [...ROOMS.values()].reduce((n, R) => n + R.clients.size, 0), up: Math.round((Date.now() - STATS.started) / 1000), gaming: GAMING.manifest().status })); return; }
  // the keeper's door (HM_ADMIN set in Railway's variables, never in the repository): a keep's holder set as the season
  // would set it (tests: the season's own capture told to the pages), a new season, the season saved now
  if (u.pathname === '/admin' && req.method === 'POST') {
    const key = process.env.HM_ADMIN || '', give = (code, o) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
    const got = String(req.headers['x-hm-admin'] || '');
    if (!key || got.length !== key.length || !crypto.timingSafeEqual(Buffer.from(got), Buffer.from(key))) { give(403, { ok: false }); return; }
    const op = u.searchParams.get('op'), i = +u.searchParams.get('i'), r = +u.searchParams.get('r');
    if (op === 'keep' && SEASON.RS && SEASON.RS.keeps[i] && r >= 0 && r <= 2) { const K = SEASON.RS.keeps[i]; if ('h' in K) K.h = r; else if ('r' in K) K.r = r; else K.holder = r; SEASON.dirty = true; give(200, { ok: true, keeps: SEASON.keepsOf() }); return; }
    if (op === 'reset' && SEASON.M) { SEASON.RS = SEASON.M.realmSimInit(CFG.seasonSeed + Date.now() % 1000, { keeps: CFG.keeps, len: CFG.seasonLen, season: (SEASON.RS && SEASON.RS.n || 0) + 1 }); SEASON.roster = {}; SEASON.chat = [[], [], []]; for (const A of Object.values(ACCOUNTS)) delete A.votes; accountsSave(); SEASON.save(); give(200, { ok: true, n: SEASON.RS.n }); return; }
    if (op === 'step' && SEASON.RS) { const s = Math.max(0, Math.min(90 * 86400, +(u.searchParams.get('s')) || 0)); SEASON.M.realmSimStep(SEASON.RS, s); SEASON.dirty = true; give(200, { ok: true, t: SEASON.RS.t, phase: SEASON.RS.phase }); return; }
    if (op === 'save') { SEASON.save(); give(200, { ok: true }); return; }
    give(400, { ok: false }); return;
  }
  if (u.pathname === '/season') { res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' }); res.end(JSON.stringify(SEASON.summary(-1, (SEASON.RS ? SEASON.RS.t : 0) - 86400))); return; }
  if (u.pathname === '/stats') { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ ...STATS, proc: { mem: process.memoryUsage(), cpu: process.cpuUsage(), up: process.uptime() }, season: SEASON.RS ? { file: SEASON.M.file, t: SEASON.RS.t, phase: SEASON.RS.phase, stepMs: SEASON.stepMs.length ? { last: SEASON.stepMs[SEASON.stepMs.length - 1], max: Math.max(...SEASON.stepMs), mean: SEASON.stepMs.reduce((a, b) => a + b, 0) / SEASON.stepMs.length } : null, roster: Object.keys(SEASON.roster).length } : null, companies: { n: Object.keys(COMP.D.list).length, ...COMP.stats }, rooms: [...ROOMS.values()].map((R) => ({ regions: R.regions || {}, name: R.name, players: R.clients.size, host: roomHost(R)?.peer || null, world: WORLDS[R.name] || null })), accounts: Object.keys(ACCOUNTS).length })); return; }
  if (u.pathname === '/' || u.pathname === '/index.html') {
    let html;
    try { html = fs.readFileSync(CFG.page, 'utf8'); } catch (e) { res.writeHead(404); res.end('The game is not built here (python3 build.py)'); return; }
    // the page served from here connects back here
    html = '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=auto"><script>window.__HM_GAMING=' + JSON.stringify(GAMING.manifest()).replace(/</g, '\\u003c') + ';window.__HM_NET_SERVER=(location.protocol==="https:"?"wss://":"ws://")+location.host+"/ws";</script></head><body>' + html + '</body></html>';
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache' }); res.end(html); return;
  }
  res.writeHead(404); res.end();
});
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: CFG.maxSave + 1024 });
wss.on('connection', (ws) => {
  STATS.conns++;
  const c = { ws, acct: null, room: null, peer: '', slow: null, fast: null, pos: null, posT: 0, winT: 0, winN: 0 };
  const helloTimer = setTimeout(() => { if (!c.acct && !c.gamingAgent) ws.close(4001, 'no hello'); }, 10000);
  ws.on('message', (data) => { try { onMsg(c, String(data)); } catch (e) { STATS.badMsgs++; console.warn('message', e.message); } });
  ws.on('close', () => {
    clearTimeout(helloTimer); GAMING.close(c);
    const R = c.room;
    if (!R) return;
    R.clients.delete(c.peer);
    FIELD.left(c); // [season2] its armies back to the season
    for (const o of R.clients.values()) { send(o, { t: 'left', peer: c.peer }); if (o.nearAt) o.nearAt.delete(c.peer); if (o.farAt) o.farAt.delete(c.peer); }
    regionsTell(R);
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
  setInterval(() => { try { FIELD.step(); } catch (e) { console.warn('field step', e.message); } }, 2000); // [season2]
}
let closing = false;
const shutdown = () => { if (closing) return; closing = true; try { SEASON.step(); SEASON.save(); COMP.save(true); /* [companies] */ store.write('accounts.json', ACCOUNTS); store.write('worlds.json', WORLDS); } catch (e) { console.warn('shutdown', e.message); } process.exit(0); };
process.on('SIGTERM', shutdown); process.on('SIGINT', shutdown);
server.listen(CFG.port, () => console.log(`The Hallowmarch server on :${CFG.port} (data ${CFG.data})`));
export { server, STATS, CFG, SEASON, COMP };
