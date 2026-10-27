// The season on the server: the realms' strategic state RS (the shared contract with loops, CLAUDE.md, Multiplayer)
// stepped continuously by src/08m_realm.js (or this server's stand-in, server/realm_stub.js, until loops's lands),
// persisted so a restart loses nothing, fed by the players' contributions and orders (checked here) and told to them.
import fs from 'node:fs';
import path from 'node:path';
import { realmLogisticsView, realmLogisticsRestore } from './realm-logistics.js';

// These room namespaces are reserved for the explicit manual QA runners. Room
// provenance is server metadata; a player's display name never classifies it.
export function seasonRoomPolicy(want) {
  const diagnostic = typeof want === 'string' && /^\s*(?:native-qa(?:-|$)|native-companion-qa(?:-|$))/i.test(want);
  const valid = typeof want === 'string' && /^[a-z0-9][a-z0-9_-]{0,31}$/.test(want);
  if (diagnostic && (!valid || !/^(?:native-qa-|native-companion-qa-)[a-z0-9][a-z0-9_-]*$/.test(want))) return null;
  return { base: valid ? want : 'march', diagnostic };
}

const FNS = ['realmSimInit', 'realmSimStep', 'realmSimContribute', 'realmSimOrder', 'realmSimSummary', 'realmSimSanitize'];
export function loadRealmModule(srcDir, hereDir) {
  let management = ''; try { management = fs.readFileSync(path.join(srcDir, '08p_realm_management.js'), 'utf8'); } catch {}
  for (const f of [path.join(srcDir, '08m_realm.js'), path.join(hereDir, 'realm_stub.js')]) {
    let code;
    try { code = fs.readFileSync(f, 'utf8'); } catch (e) { continue; }
    try {
      const M = new Function(code + '\n' + management + '\nreturn {' + FNS.join(',') + ', realmDevelopmentView: typeof realmDevelopmentView === "function" ? realmDevelopmentView : null, realmDevelopmentEarn: typeof realmDevelopmentEarn === "function" ? realmDevelopmentEarn : null, realmSimCapture: typeof realmSimCapture === "function" ? realmSimCapture : null, realmSimLive: typeof realmSimLive === "function" ? realmSimLive : null, /* [season2] */ realmSimFieldTake: typeof realmSimFieldTake === "function" ? realmSimFieldTake : null, realmSimFieldReport: typeof realmSimFieldReport === "function" ? realmSimFieldReport : null, realmSimFieldFold: typeof realmSimFieldFold === "function" ? realmSimFieldFold : null, realmManageInit: typeof realmManageInit === "function" ? realmManageInit : null, realmManageAction: typeof realmManageAction === "function" ? realmManageAction : null, realmManageView: typeof realmManageView === "function" ? realmManageView : null, realmManageAllied: typeof realmManageAllied === "function" ? realmManageAllied : null, RSM: typeof RSM === "object" ? RSM : null, RSM_GOODS: typeof RSM_GOODS !== "undefined" ? RSM_GOODS : null, RSM_GEO: typeof RSM_GEO !== "undefined" ? RSM_GEO : null};')();
      if (FNS.every((k) => typeof M[k] === 'function')) { const sanitize=M.realmSimSanitize;M.realmSimSanitize=input=>{const state=sanitize(input);if(state)realmLogisticsRestore(state,input);return state;}; M.file = path.basename(f); return M.RSM && M.RSM_GOODS ? loopsAdapt(M) : M; }
      console.warn('season: ' + f + ' lacks the contract\'s functions');
    } catch (e) { console.warn('season: ' + f + ' did not load: ' + e.message); }
  }
  return null;
}

// [v19] loops's src/08m_realm.js (the real module) under the stand-in's shape: what the server and the pages (14q_netseason.js
// netsRead) speak is the stand-in's (realm_stub.js); loops's RS is kept as it is and only its ways in and out are mapped here
function loopsAdapt(L) {
  const G = L.RSM_GOODS, RSM = L.RSM, GEO = L.RSM_GEO, day = 86400;
  const PROJ = {
    walls: ['Raise the walls a tier', "a keep's walls and gate take a fifth less (the keep an offensive names first)"],
    granary: ['Build a granary', 'the stores hold more food'],
    yard: ['A horse-breeding yard', 'more horses for the captains'],
    smithy: ['A smithy', 'the levies better armed'],
    engines: ['Siege engines', 'stockpiled for the offensive'],
  };
  const PHASE = { muster: 'build', war: 'war', reckon: 'over' };
  const pos = (A) => { if(A.manual&&[A.fx,A.fz].every(Number.isFinite))return[A.fx,A.fz]; const from = GEO.muster[A.r], to = A.k >= 0 ? GEO.keep[A.k] : A.q >= 0 ? (A.kind === 'hallow' ? GEO.temple[A.q] : GEO.muster[A.q]) : from; const p = A.state === 'siege' ? 1 : Math.max(0, Math.min(1, A.p || 0)); return [from[0] + (to[0] - from[0]) * p, from[1] + (to[1] - from[1]) * p]; };
  return {
    ...L, loops: true,
    realmSimInit: (seed, o = {}) => L.realmSimInit(seed, { days: (o.len || 28 * day) / day, n: o.season || 1, t0: Date.now(), keeps: Array.isArray(o.keeps) ? o.keeps.map((k) => (typeof k === 'object' ? k.home | 0 : k | 0)) : undefined, names: Array.isArray(o.keeps) ? { realms: ['Logres', 'Ériu', 'Thule'], keeps: o.keeps.map((k, i) => (k && k.name) || 'keep ' + (i + 1)) } : undefined }),
    realmSimSanitize: (o) => (o && o.v === 1 && Array.isArray(o.realms) && o.realms[0] && Array.isArray(o.realms[0].s) ? L.realmSimSanitize(o) : null),
    // everything brought is taken (the stores up to their cap, the rest kept for the realm's works): the units
    realmSimContribute: (RS, realm, kind, n, who) => { L.realmSimContribute(RS, realm, kind, n, who); return G.includes(kind) ? n : 0; },
    realmSimOrder: (RS, realm, o, acct) => {
      const rank = o.w >= 3 ? 5 : 1;
      // a voice below rank 5 for a keep: it names the realm's next keep while no officer has (an officer's word stands)
      if (o.kind === 'target' && rank < 5) {
        const K = RS.keeps[o.keep | 0];
        if (!K || K.h === realm) return { ok: false, why: 'Not a keep of the foe' };
        if (RS.realms[realm].aim >= 0 && RS.realms[realm].aim !== (o.keep | 0)) return { ok: true, why: 'Counted: an officer has named the keep already' };
        RS.realms[realm].aim = o.keep | 0; return { ok: true };
      }
      if (o.kind === 'muster' && RS.phase !== 'war') return { ok: false, why: 'No muster before the war' };
      const ok = L.realmSimOrder(RS, realm, { type: o.kind, id: o.id, keep: o.keep }, { name: o.by || acct, rank });
      return ok ? { ok: true } : { ok: false, why: 'Not now' };
    },
    realmSimCapture: (RS, keep, realm) => L.realmSimLive(RS, { type: 'keep', keep, holder: realm }),
    realmSimSummary: (RS, realm, since, owner) => {
      const R = realm >= 0 ? RS.realms[realm] : null, ph = PHASE[RS.phase] || 'war';
      const s = {
        development: L.realmDevelopmentView ? L.realmDevelopmentView(RS) : null,
        n: RS.n, t: RS.t, len: RS.len, day: Math.floor(RS.t / day) + 1, days: Math.round(RS.len / day), phase: ph, over: ph === 'over' ? 1 : 0, winner: RS.winner == null ? -1 : RS.winner,
        pts: RS.realms.map((q) => Math.round(q.sp)),
        keeps: RS.keeps.map((K, i) => ({ i, r: K.h, g: Math.round(K.g), gate: Math.max(0,Math.min(1,K.gate)), siege: K.siege ? 1 : 0, tier: K.tier })),
        armies: RS.armies.filter((A) => A.state !== 'gone').slice(0, 40).map((A) => { const [x, z] = pos(A); return { id: A.id, r: A.r, n: Math.round(A.n), to: A.k, k: A.k, q: A.q, kind: A.kind, manual: A.manual === true, mission: A.mission, fx: A.fx, fz: A.fz, arm: A.arm, eng: A.eng, st: A.state === 'siege' ? 'siege' : 'march', x: Math.round(x), z: Math.round(z), f: A.onField ? 1 : 0, off: RS.offs.some((O) => O.army === A.id && O.state === 'siege') ? 1 : 0 }; }), // [season2] f: on a page's field, off: an offensive's
        offs: RS.offs.filter((O) => O.state === 'planned' || O.state === 'siege').slice(-12).map((O) => ({ r: O.r, k: O.k, state: O.state, inS: Math.max(0, Math.round(O.at - RS.t)) })), // [season2] the offensives announced
        news: RS.log.filter((L2) => L2.t > since && (realm < 0 || L2.r === realm || L2.r === -1 || L2.k === 'big')).slice(-12).map((L2) => [Math.round(L2.t), L2.r, L2.x]),
        target: R ? R.aim : -1, st: null, levyIn: R ? Math.max(0, Math.round(R.levyAt - RS.t)) : 0,
      };
      s.armyIds=RS.armies.filter(a=>a.state!=='gone').map(a=>a.id);s.armyIdsComplete=s.armyIds.length<=40&&s.armyIds.every(Number.isSafeInteger);
      s.works = RS.realms.map((q,r)=>({r,hungry:Math.max(0,Math.min(48,Number(q.hungry)||0)),...Object.fromEntries(['walls','granary','yard','smithy','engines'].map(k=>[k,Math.max(0,Math.min(4,Math.floor(q.proj?.[k]||0)))]))}));
      s.logistics = realmLogisticsView(RS,owner);s.repairs=s.logistics?.repairs||[];
      s.management = typeof L.realmManageView === 'function' && realm >= 0 ? L.realmManageView(RS,realm) : null;
      if (R) {
        s.st = Object.fromEntries(G.slice(0, 7).map((g, i) => [g, Math.round(R.s[i])]));
        s.built = Object.keys(R.proj).filter((id) => R.proj[id] > 0);
        s.proj = Object.keys(RSM.projects).map((id) => {
          const P = RSM.projects[id], need = {}, have = {};
          P.cost.forEach((c, i) => { if (c > 0 && i < 7) { need[G[i]] = c; have[G[i]] = Math.round(Math.min(c, R.s[i] + R.bank[i])); } });
          return { id, label: (PROJ[id] || [P.name])[0], did: `${(PROJ[id] || ['', P.name])[1]}${R.act === id ? ` (at work: ${Math.round(R.prog * 100)}%)` : ''}`, built: R.proj[id] >= P.max && id !== 'walls', votes: Math.round(R.votes[id] || 0), atWork: R.act === id, need, have };
        });
      }
      return s;
    },
  };
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
    const away = cfg.seasonLiveOnly === true ? 0 : Math.max(0, Math.min(7 * 86400, ((Date.now() - (kept.savedAt || Date.now())) / 1000) * S.speed));
    if (away > 1) { const t0 = performance.now(); M.realmSimStep(S.RS, away); console.log(`season: ${Math.round(away)} s caught up in ${Math.round(performance.now() - t0)} ms`); }
    console.log(`season: kept (${M.file}), day ${Math.floor(S.RS.t / 86400) + 1}`);
  }
  S.save = ({ background = false } = {}) => {
    if (!S.RS) return;
    store.write('season.json', { ...S.RS, savedAt: Date.now() }, { background });
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
    const previousSeason=S.RS.n,previousLogistics=S.RS.management?.logistics;
    S.M.realmSimStep(S.RS, dt);
    // a new season once one has been over for a day (its winner told in the log first)
    if (S.RS.over && S.RS.t > S.RS.len + 86400) {
      const n = (S.RS.n || 1) + 1, w = S.RS.winner;
      S.RS = S.M.realmSimInit(cfg.seasonSeed + n, { keeps: cfg.keeps, len: cfg.seasonLen, season: n });
      S.RS.lastWinner = w; stats.seasons++;
    }
    if(S.RS.n!==previousSeason&&previousLogistics) realmLogisticsRestore(S.RS,{n:previousSeason,management:{logistics:previousLogistics}});
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
  S.keepsOf = () => (S.RS && Array.isArray(S.RS.keeps) ? S.RS.keeps.map((K) => (K && (K.r ?? K.h ?? K.holder ?? K.owner))) : null);
  S.summary = (realm, since, owner) => {
    if (!S.RS) return null;
    const s = S.M.realmSimSummary(S.RS, realm, since, owner);
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
      .map(([id, R]) => ({ n: R.name || 'Guest', c: R.c || '', l: R.l || 0, on: on.has(id) ? 1 : 0, ago: Math.round((now - R.last) / 60000), g: Math.round(R.today || 0), co: S.coOf ? S.coOf(id) || undefined : undefined /* [companies] */ }));
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
