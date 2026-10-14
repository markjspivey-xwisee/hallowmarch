// The season on the server: the realms' strategic state RS (the shared contract with loops, CLAUDE.md, Multiplayer)
// stepped continuously by src/08m_realm.js (or this server's stand-in, server/realm_stub.js, until loops's lands),
// persisted so a restart loses nothing, fed by the players' contributions and orders (checked here) and told to them.
import fs from 'node:fs';
import path from 'node:path';

const FNS = ['realmSimInit', 'realmSimStep', 'realmSimContribute', 'realmSimOrder', 'realmSimSummary', 'realmSimSanitize'];
export function loadRealmModule(srcDir, hereDir) {
  for (const f of [path.join(srcDir, '08m_realm.js'), path.join(hereDir, 'realm_stub.js')]) {
    let code;
    try { code = fs.readFileSync(f, 'utf8'); } catch (e) { continue; }
    try {
      const M = new Function(code + '\nreturn {' + FNS.join(',') + ', realmSimCapture: typeof realmSimCapture === "function" ? realmSimCapture : null};')();
      if (FNS.every((k) => typeof M[k] === 'function')) { M.file = path.basename(f); return M; }
      console.warn('season: ' + f + ' lacks the contract\'s functions');
    } catch (e) { console.warn('season: ' + f + ' did not load: ' + e.message); }
  }
  return null;
}

// what one account may plausibly bring in (a bucket each good: it fills at a gatherer's best pace and holds a long trip's
// load); anything over it is cut, counted and told
export const GATHER = {
  food: { rate: 40, cap: 600 }, timber: { rate: 20, cap: 300 }, stone: { rate: 12, cap: 200 }, iron: { rate: 5, cap: 80 },
  hides: { rate: 4, cap: 60 }, wool: { rate: 4, cap: 60 }, horses: { rate: 0.2, cap: 4 },
}; // rate: units a minute

export function makeSeason(cfg, store, stats) {
  const M = loadRealmModule(cfg.src, cfg.here);
  const S = {
    M, RS: null, speed: cfg.seasonSpeed, stepEvery: cfg.seasonStep, lastStep: Date.now(), stepMs: [], dirty: false,
    contrib: {}, // account id -> { good: [units in the bucket, at] }
    roster: store.read('roster.json', {}), // account id -> { name, r, c, l, last, today: units given today, day }
    chat: store.read('chat.json', [[], [], []]), // a realm's last lines: [at, name, text]
  };
  if (!M) { console.warn('season: no realm module: the season does not run'); return S; }
  const kept = store.read('season.json', null);
  S.RS = kept && M.realmSimSanitize(kept);
  if (!S.RS) {
    S.RS = M.realmSimInit(cfg.seasonSeed, { keeps: cfg.keeps, len: cfg.seasonLen, season: 1 });
    console.log(`season: a new season (${M.file}, ${Math.round(cfg.seasonLen / 86400)} days)`);
  } else {
    // the time the server was down: the realms lived on (at most a week at once)
    const away = Math.max(0, Math.min(7 * 86400, ((Date.now() - (kept.savedAt || Date.now())) / 1000) * S.speed));
    if (away > 1) { const t0 = performance.now(); M.realmSimStep(S.RS, away); console.log(`season: ${Math.round(away)} s caught up in ${Math.round(performance.now() - t0)} ms`); }
    console.log(`season: kept (${M.file}), day ${Math.floor(S.RS.t / 86400) + 1}`);
  }
  S.save = () => {
    if (!S.RS) return;
    store.write('season.json', { ...S.RS, savedAt: Date.now() });
    store.write('roster.json', S.roster);
    store.write('chat.json', S.chat);
    S.dirty = false; stats.seasonSaves++;
  };
  // the step: the season's seconds since the last, the server's own clock (stepped by big steps in RS itself)
  S.step = () => {
    const now = Date.now(), dt = ((now - S.lastStep) / 1000) * S.speed;
    S.lastStep = now;
    if (!(dt > 0)) return;
    const t0 = performance.now();
    S.M.realmSimStep(S.RS, dt);
    // a new season once one has been over for a day (its winner told in the log first)
    if (S.RS.over && S.RS.t > S.RS.len + 86400) {
      const n = (S.RS.n || 1) + 1, w = S.RS.winner;
      S.RS = S.M.realmSimInit(cfg.seasonSeed + n, { keeps: cfg.keeps, len: cfg.seasonLen, season: n });
      S.RS.lastWinner = w; stats.seasons++;
    }
    const ms = performance.now() - t0;
    S.stepMs.push(ms); if (S.stepMs.length > 120) S.stepMs.shift();
    stats.seasonSteps++; S.dirty = true;
  };
  // a player's delivery: the account's bucket for that good decides how much of it is taken
  S.contribute = (acct, realm, kind, amount) => {
    const G = GATHER[kind];
    if (!G || !(realm >= 0 && realm <= 2)) return { ok: false, why: 'No such goods' };
    let n = Math.floor(Number(amount));
    if (!Number.isFinite(n) || n <= 0) return { ok: false, why: 'Nothing to bring' };
    n = Math.min(n, 100000);
    const now = Date.now(), B = (S.contrib[acct] = S.contrib[acct] || {});
    const b = B[kind] || [G.cap, now];
    const fill = Math.min(G.cap, b[0] + ((now - b[1]) / 60000) * G.rate);
    const take = Math.min(n, Math.floor(fill));
    B[kind] = [fill - take, now];
    if (take < n) stats.contribClipped++;
    if (take <= 0) return { ok: false, why: 'More than you could have gathered: wait a while', took: 0 };
    const got = S.M.realmSimContribute(S.RS, realm, kind, take, acct);
    if (got < take) B[kind][0] += take - got; // what the stores had no room for stays in the bucket
    if (!(got > 0)) return { ok: false, why: `The realm's stores of ${kind} are full`, took: 0 };
    const R = S.roster[acct];
    if (R) { const day = Math.floor(now / 86400e3); if (R.day !== day) { R.day = day; R.today = 0; } R.today += got; R.given = (R.given || 0) + got; }
    stats.contribs++; S.dirty = true;
    return { ok: true, took: got, asked: n };
  };
  S.order = (acct, realm, order, rank, name) => {
    if (!order || typeof order !== 'object' || typeof order.kind !== 'string') return { ok: false, why: 'No such order' };
    const o = { kind: order.kind.slice(0, 16), id: typeof order.id === 'string' ? order.id.slice(0, 24) : undefined, keep: Number.isInteger(order.keep) ? order.keep : undefined, w: rank >= 5 ? 3 : 1, by: name };
    const r = S.M.realmSimOrder(S.RS, realm, o, acct) || { ok: false };
    stats.orders++; S.dirty = true;
    return r;
  };
  S.capture = (keep, realm, who) => {
    if (!S.RS || !S.RS.keeps || !S.RS.keeps[keep]) return;
    if (S.M.realmSimCapture) S.M.realmSimCapture(S.RS, keep, realm, who);
    else S.RS.keeps[keep].r = realm; // (the contract's shape: a keep's holder)
    stats.liveCaptures++; S.dirty = true;
  };
  S.keepsOf = () => (S.RS && Array.isArray(S.RS.keeps) ? S.RS.keeps.map((K) => (K && (K.r ?? K.holder ?? K.owner))) : null);
  S.summary = (realm, since) => {
    if (!S.RS) return null;
    const s = S.M.realmSimSummary(S.RS, realm, since);
    return s && typeof s === 'object' ? s : null;
  };
  S.seen = (acct, p) => {
    const now = Date.now(), day = Math.floor(now / 86400e3);
    const R = (S.roster[acct] = S.roster[acct] || { today: 0, day, given: 0 });
    if (R.day !== day) { R.day = day; R.today = 0; }
    Object.assign(R, p, { last: now });
    const ks = Object.keys(S.roster);
    if (ks.length > 20000) { ks.sort((a, b) => S.roster[a].last - S.roster[b].last); for (const k of ks.slice(0, ks.length - 20000)) delete S.roster[k]; }
  };
  // who of a realm is on now (the connections) and who was on today
  S.rosterOf = (realm, online) => {
    const now = Date.now(), on = new Set(online);
    const today = Object.entries(S.roster).filter(([id, R]) => R.r === realm && now - R.last < 86400e3).sort((a, b) => b[1].last - a[1].last).slice(0, 40)
      .map(([id, R]) => ({ n: R.name || 'Guest', c: R.c || '', l: R.l || 0, on: on.has(id) ? 1 : 0, ago: Math.round((now - R.last) / 60000), g: Math.round(R.today || 0) }));
    return { now: today.filter((x) => x.on).length, day: today.length, list: today };
  };
  S.chatIn = (realm, name, text) => {
    if (!(realm >= 0 && realm <= 2)) return;
    const L = S.chat[realm] || (S.chat[realm] = []);
    L.push([Date.now(), String(name || 'Guest').slice(0, 24), String(text).slice(0, 140)]);
    if (L.length > 40) L.splice(0, L.length - 40);
    S.dirty = true;
  };
  return S;
}
