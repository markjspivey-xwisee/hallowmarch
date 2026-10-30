/* Canonical realm production and government. Pure state; stepped only by the shared season clock. */
const RM_RAW = { food: 0, timber: 1, stone: 2, iron: 3, hides: 4, wool: 5, horses: 6, gold: 7 };
const RM_PROCESSED = { grain: 400, flour: 200, bread: 200, planks: 300, cloth: 200, tools: 120 };
const RM_LABEL = { food: 'Army provisions', timber: 'Timber', stone: 'Stone', iron: 'Iron', hides: 'Hides', wool: 'Wool', horses: 'Horses', gold: 'Treasury', grain: 'Grain', flour: 'Flour', bread: 'Bread', planks: 'Planks', cloth: 'Cloth', tools: 'Tools' };
const RM_PRICE = { food: 2, timber: 4, stone: 4, iron: 15, hides: 6, wool: 5, horses: 120, gold: 1, grain: 2, flour: 3, bread: 5, planks: 6, cloth: 8, tools: 20 };
const RM_CATALOG = {
  farm: { label: 'Grain farm', siteTypes: ['town'], cost: { timber: 28, stone: 8 }, seconds: 45, workers: 2, inputs: {}, outputs: { grain: 4 } },
  mill: { label: 'Flour mill', siteTypes: ['town'], cost: { timber: 35, stone: 14 }, seconds: 50, workers: 2, inputs: { grain: 3 }, outputs: { flour: 3 } },
  bakery: { label: 'Bakery', siteTypes: ['town'], cost: { planks: 14, stone: 20, iron: 4 }, seconds: 55, workers: 2, inputs: { flour: 3, timber: 0.3 }, outputs: { bread: 3 } },
  woodcutter: { label: 'Woodcutters', siteTypes: ['town', 'keep'], cost: { timber: 20, stone: 4 }, seconds: 35, workers: 2, inputs: {}, outputs: { timber: 1.5 } },
  sawmill: { label: 'Sawmill', siteTypes: ['town', 'keep'], cost: { timber: 30, stone: 10 }, seconds: 45, workers: 2, inputs: { timber: 1.5 }, outputs: { planks: 3 } },
  sheepfold: { label: 'Sheepfold', siteTypes: ['town'], cost: { timber: 24, stone: 6 }, seconds: 40, workers: 2, inputs: {}, outputs: { wool: 0.4 } },
  weaver: { label: 'Weavers', siteTypes: ['town'], cost: { planks: 12, stone: 10 }, seconds: 45, workers: 2, inputs: { wool: 0.4 }, outputs: { cloth: 0.6 } },
  mine: { label: 'Iron mine', siteTypes: ['town', 'keep'], cost: { planks: 16, stone: 20, tools: 2 }, seconds: 60, workers: 2, inputs: {}, outputs: { iron: 0.5 } },
  toolmaker: { label: 'Toolsmith', siteTypes: ['town', 'keep'], cost: { planks: 18, stone: 16, iron: 8 }, seconds: 60, workers: 2, inputs: { iron: 0.5, planks: 1 }, outputs: { tools: 0.4 } },
  quarry: { label: 'Stone quarry', siteTypes: ['town', 'keep'], cost: { timber: 24, planks: 4 }, seconds: 45, workers: 2, inputs: {}, outputs: { stone: 1 } },
  hunter: { label: 'Hunters', siteTypes: ['town', 'keep'], cost: { timber: 16 }, seconds: 30, workers: 1, inputs: {}, outputs: { food: 1, hides: 0.25 } },
  stables: { label: 'Stables', siteTypes: ['town', 'keep'], cost: { timber: 30, stone: 8, food: 20 }, seconds: 55, workers: 1, inputs: { food: 0.5 }, outputs: { horses: 0.02 } },
  house: { label: 'Dwellings', siteTypes: ['town'], cost: { timber: 18, stone: 8, planks: 6 }, seconds: 35, workers: 0, housing: 16, inputs: {}, outputs: {} },
  market: { label: 'Market', siteTypes: ['town'], cost: { planks: 22, stone: 20, tools: 2 }, seconds: 50, workers: 2, inputs: {}, outputs: {} },
  watchpost: { label: 'Watchpost', siteTypes: ['keep'], maxLevel: 1, defenseSupport: 0.1,
    description: 'A defensive watchtower: two workers and food support the existing keep garrison with 10% more outgoing damage. It does not fire on its own.',
    cost: { timber: 60, stone: 40, iron: 8, tools: 2 }, seconds: 90, workers: 2, inputs: { food: 0.5 }, outputs: {} },
};
const RM_START = ['farm', 'woodcutter', 'quarry', 'mine', 'sheepfold', 'hunter', 'stables', 'house', 'house', 'house'];
// A placement version is fixed when construction is commissioned. Version 1 is
// the historical layout; absent fields retain that layout without rewriting saves.
const RM_PLOT_LAYOUT_VERSION = 2;
// Vetted against buildWorld(7): a rotated 12 m footprint, dry ground, static
// obstacles and crowns, and every possible legacy footprint remain clear.
const RM_PLOT_LAYOUT_V2 = Object.freeze({
  "town:0:0": Object.freeze({ x: 215.48, z: 201.22 }),
  "town:0:1": Object.freeze({ x: 132.41, z: 265.34 }),
  "town:0:2": Object.freeze({ x: 114.89, z: 287 }),
  "town:0:3": Object.freeze({ x: 238.94, z: 233.86 }),
  "town:0:4": Object.freeze({ x: 264.19, z: 221.59 }),
  "town:0:5": Object.freeze({ x: 252.07, z: 228.59 }),
  "town:0:6": Object.freeze({ x: 280.39, z: 237.64 }),
  "town:0:7": Object.freeze({ x: 282.19, z: 252.77 }),
  "town:0:8": Object.freeze({ x: 108.52, z: 359.97 }),
  "town:0:9": Object.freeze({ x: 77.15, z: 389.63 }),
  "town:0:10": Object.freeze({ x: 115.79, z: 376.55 }),
  "town:0:11": Object.freeze({ x: 85.88, z: 400.75 }),
  "town:0:12": Object.freeze({ x: 308.85, z: 278.95 }),
  "town:0:13": Object.freeze({ x: 124.52, z: 387.68 }),
  "town:0:14": Object.freeze({ x: 314.12, z: 292.07 }),
  "town:0:15": Object.freeze({ x: 236.18, z: 337.07 }),
  "town:1:0": Object.freeze({ x: -298, z: -14 }),
  "town:1:1": Object.freeze({ x: -316, z: -32 }),
  "town:1:2": Object.freeze({ x: -328, z: 44 }),
  "town:1:3": Object.freeze({ x: -338, z: -60 }),
  "town:1:4": Object.freeze({ x: -352, z: -48 }),
  "town:1:5": Object.freeze({ x: -352, z: -74 }),
  "town:1:6": Object.freeze({ x: -360, z: -96 }),
  "town:1:7": Object.freeze({ x: -366, z: 76 }),
  "town:1:8": Object.freeze({ x: -370, z: 62 }),
  "town:1:9": Object.freeze({ x: -372, z: 46 }),
  "town:1:10": Object.freeze({ x: -386, z: 46 }),
  "town:1:11": Object.freeze({ x: -396, z: -62 }),
  "town:1:12": Object.freeze({ x: -400, z: 42 }),
  "town:1:13": Object.freeze({ x: -410, z: -66 }),
  "town:1:14": Object.freeze({ x: -416, z: 28 }),
  "town:1:15": Object.freeze({ x: -422, z: 80 }),
  "town:2:0": Object.freeze({ x: 170.32, z: -255 }),
  "town:2:1": Object.freeze({ x: 99.72, z: -332.72 }),
  "town:2:2": Object.freeze({ x: 103.25, z: -346.84 }),
  "town:2:3": Object.freeze({ x: 233.16, z: -271.84 }),
  "town:2:4": Object.freeze({ x: 119.38, z: -346.77 }),
  "town:2:5": Object.freeze({ x: 129.65, z: -368.55 }),
  "town:2:6": Object.freeze({ x: 251.89, z: -300.29 }),
  "town:2:7": Object.freeze({ x: 135.18, z: -386.14 }),
  "town:2:8": Object.freeze({ x: 155.23, z: -376.87 }),
  "town:2:9": Object.freeze({ x: 244.57, z: -327.61 }),
  "town:2:10": Object.freeze({ x: 126.06, z: -398.34 }),
  "town:2:11": Object.freeze({ x: 262.43, z: -326.53 }),
  "town:2:12": Object.freeze({ x: 232.25, z: -346.27 }),
  "town:2:13": Object.freeze({ x: 146.65, z: -398 }),
  "town:2:14": Object.freeze({ x: 276.55, z: -323 }),
  "town:2:15": Object.freeze({ x: 136.52, z: -408.46 }),
  "keep:0:0": Object.freeze({ x: -27.62, z: 92.16 }),
  "keep:0:1": Object.freeze({ x: -57.26, z: 120.82 }),
  "keep:0:2": Object.freeze({ x: 38.22, z: 114.19 }),
  "keep:0:3": Object.freeze({ x: 27.72, z: 208.01 }),
  "keep:1:0": Object.freeze({ x: 88.89, z: 17.96 }),
  "keep:1:1": Object.freeze({ x: 74.52, z: 77.07 }),
  "keep:1:2": Object.freeze({ x: 167.53, z: 74.17 }),
  "keep:1:3": Object.freeze({ x: 135.43, z: 106.56 }),
  "keep:2:0": Object.freeze({ x: -116, z: -148 }),
  "keep:2:1": Object.freeze({ x: -130, z: 18 }),
  "keep:2:2": Object.freeze({ x: -132, z: 4 }),
  "keep:2:3": Object.freeze({ x: -134, z: -144 }),
  "keep:3:0": Object.freeze({ x: -60, z: 84 }),
  "keep:3:1": Object.freeze({ x: -74, z: 104 }),
  "keep:3:2": Object.freeze({ x: -100, z: 8 }),
  "keep:3:3": Object.freeze({ x: -100, z: -12 }),
  "keep:4:0": Object.freeze({ x: 82.16, z: -10.3 }),
  "keep:4:1": Object.freeze({ x: 116.14, z: -9.16 }),
  "keep:4:2": Object.freeze({ x: 131.8, z: -16.28 }),
  "keep:4:3": Object.freeze({ x: 124.57, z: -119.76 }),
  "keep:5:0": Object.freeze({ x: -35.07, z: -147.26 }),
  "keep:5:1": Object.freeze({ x: -63.44, z: -182.12 }),
  "keep:5:2": Object.freeze({ x: -24.73, z: -185.17 }),
  "keep:5:3": Object.freeze({ x: -35.05, z: -207.3 }),
});
// Future layouts get another entry; never revise the coordinates of a retained version.
const RM_PLOT_LAYOUTS = Object.freeze({ 2: RM_PLOT_LAYOUT_V2 });
const rmClone = x => JSON.parse(JSON.stringify(x));
const rmNum = (x, fallback = 0, lo = 0, hi = 1e9) => Number.isFinite(x) ? Math.max(lo, Math.min(hi, x)) : fallback;
const rmInt = (x, fallback = 0, lo = 0, hi = 1e9) => Math.floor(rmNum(x, fallback, lo, hi));
const rmRealm = r => Number.isSafeInteger(r) && r >= 0 && r < 3;
function rmLegacyPlots(RS) {
  const out = [], bearings = [150, 270, 30];
  const place = (r, along, lat) => { const a = bearings[r] * Math.PI / 180, dx = Math.sin(a), dz = -Math.cos(a); return { x: dx * along - dz * lat, z: dz * along + dx * lat }; };
  for (let r = 0; r < 3; r++) for (let i = 0; i < 16; i++) out.push({ id: 'town:' + r + ':' + i, site: 'town:' + r, name: 'Town plot ' + (i + 1), owner: r, ...place(r, 432 + Math.floor(i / 4) * 18, [-63, -39, 39, 63][i % 4]) });
  RS.keeps.slice(0, Math.min(6, RSM_GEO.keep.length)).forEach((K, k) => { const r = K.home; for (let i = 0; i < 4; i++) { const a = place(r, [-28, -28, 28, 28][i], [-26, 26, -26, 26][i]); out.push({ id: 'keep:' + k + ':' + i, site: 'keep:' + k, name: 'Keep ' + (k + 1) + ' plot ' + (i + 1), owner: K.h, x: RSM_GEO.keep[k][0] + a.x, z: RSM_GEO.keep[k][1] + a.z }); } });
  return out.map(p => {
    const home = p.site.startsWith('town:') ? Number(p.site.slice(5)) : RS.keeps[Number(p.site.slice(5))].home;
    const a = bearings[home] * Math.PI / 180;
    return { ...p, home, yaw: Math.atan2(-Math.sin(a), Math.cos(a)), placementVersion: 1,
      x: Math.round(p.x * 100) / 100, z: Math.round(p.z * 100) / 100 };
  });
}
function rmPlots(RS) {
  const occupied = new Map((RS.realms || []).flatMap(R => R.management?.buildings || []).map(b => [b.plotId, b]));
  return rmLegacyPlots(RS).map(legacy => {
    const building = occupied.get(legacy.id), version = building ? Object.hasOwn(building, 'placementVersion') ? building.placementVersion : 1 : RM_PLOT_LAYOUT_VERSION;
    const current = Number.isSafeInteger(version) && Object.hasOwn(RM_PLOT_LAYOUTS, version) ? RM_PLOT_LAYOUTS[version][legacy.id] : null;
    const available = version === 1 || current && Number.isFinite(current.x) && Number.isFinite(current.z);
    return { ...legacy, ...(current ? { x: current.x, z: current.z } : {}), placementVersion: version, placementAvailable: !!available };
  });
}
function rmBuilding(plotId, kind, adopted = false) {
  const D = RM_CATALOG[kind];
  return { id: 'b:' + plotId, plotId, kind, level: adopted ? 1 : 0, targetLevel: 1, status: adopted ? 'built' : 'building',
    remaining: adopted ? 0 : D.seconds, total: D.seconds, paused: false, priority: 1, workers: D.workers,
    assigned: 0, working: false, blocked: adopted ? '' : 'construction', adopted };
}
function realmManageBuildSiteAllowed(kind, plot) {
  const D = Object.hasOwn(RM_CATALOG, kind) ? RM_CATALOG[kind] : null;
  const siteType = typeof plot?.site === 'string' ? plot.site.split(':')[0] : '';
  return !!D && D.siteTypes.includes(siteType);
}
// The last active step paid the full food input. Partial supply has an inputs
// block; existing assigned/working/blocked fields survive canonical save/load.
function realmManageDefenseSupport(RS, keepIndex) {
  const K = Number.isSafeInteger(keepIndex) && keepIndex >= 0 ? RS?.keeps?.[keepIndex] : null;
  if (!K || !rmRealm(K.h)) return 0;
  const rows = RS.realms?.[K.h]?.management?.buildings;
  if (!Array.isArray(rows)) return 0;
  const prefix = 'keep:' + keepIndex + ':';
  return rows.some(b => b?.kind === 'watchpost' && typeof b.plotId === 'string' && b.plotId.startsWith(prefix) && b.level === 1
    && b.status === 'built' && !b.paused && b.workers >= 2 && b.assigned >= 2 && b.working === true && b.blocked === '') ? 0.1 : 0;
}
function rmFreshRealm(r) {
  return { v: 1, stock: { grain: 24, flour: 6, bread: 12, planks: 20, cloth: 8, tools: 6 },
    population: 32, happiness: 65, taxPolicy: 'normal', revenue: 0, needs: { bread: 1, cloth: 1, tools: 1 },
    training: null, rates: Object.fromEntries(Object.keys(RM_LABEL).map(g => [g, 0])), buildings: RM_START.map((kind, i) => rmBuilding('town:' + r + ':' + i, kind, true)), log: [] };
}
function realmManageInit(RS) {
  if (!RS || !Array.isArray(RS.realms) || RS.realms.length !== 3) return null;
  if (!RS.management || RS.management.v !== 1) RS.management = { v: 1, revision: 0, nextOffer: 1, offers: [], relations: [{ a: 0, b: 1, score: 0, treaty: 'war', expires: 0 }, { a: 0, b: 2, score: 0, treaty: 'war', expires: 0 }, { a: 1, b: 2, score: 0, treaty: 'war', expires: 0 }] };
  for (let r = 0; r < 3; r++) if (!RS.realms[r].management || RS.realms[r].management.v !== 1) RS.realms[r].management = rmFreshRealm(r);
  if (!Array.isArray(RS.managementReceipts)) RS.managementReceipts = [];
  return RS.management;
}
function rmStock(R, id) { return Object.hasOwn(RM_RAW, id) ? R.s[RM_RAW[id]] : R.management.stock[id] || 0; }
function rmCap(R, id) { return Object.hasOwn(RM_RAW, id) ? rsmCap(R, RM_RAW[id]) : RM_PROCESSED[id] || 0; }
function rmAdd(R, id, n) {
  if (!(n > 0)) return 0;
  const amount = Math.min(n, Math.max(0, rmCap(R, id) - rmStock(R, id)));
  if (Object.hasOwn(RM_RAW, id)) R.s[RM_RAW[id]] += amount; else if (Object.hasOwn(RM_PROCESSED, id)) R.management.stock[id] += amount;
  return amount;
}
function rmTake(R, id, n) {
  if (!(n >= 0) || rmStock(R, id) + 1e-8 < n) return false;
  if (Object.hasOwn(RM_RAW, id)) R.s[RM_RAW[id]] = Math.max(0, R.s[RM_RAW[id]] - n); else R.management.stock[id] = Math.max(0, R.management.stock[id] - n);
  return true;
}
function rmCanPay(R, cost) { return Object.entries(cost).every(([g, n]) => rmStock(R, g) + 1e-8 >= n); }
function rmPay(R, cost) { if (!rmCanPay(R, cost)) return false; for (const [g, n] of Object.entries(cost)) rmTake(R, g, n); return true; }
function rmLog(RS, r, message) {
  const M = RS.realms[r].management;
  M.log.push({ at: Math.round(RS.t), text: String(message).slice(0, 160) }); if (M.log.length > 12) M.log.shift();
}
function rmRelation(RS, a, b, create = true) {
  const lo = Math.min(a, b), hi = Math.max(a, b), M = RS.management;
  let row = M.relations.find(x => x.a === lo && x.b === hi);
  if (!row && create) { row = { a: lo, b: hi, score: 0, treaty: 'war', expires: 0 }; M.relations.push(row); }
  return row;
}
function realmManageAllied(RS, a, b) {
  if (!rmRealm(a) || !rmRealm(b) || a === b || !RS.management) return false;
  const relation = rmRelation(RS, a, b, false);
  return !!relation && relation.treaty !== 'war' && relation.expires > RS.t;
}
function rmEscortCount(RS, realm) {
  const jobs = RS.management?.logistics?.jobs;
  if (!Array.isArray(jobs)) return 0;
  return jobs.slice(0, 64).reduce((n, job) => n + (job?.state === 'active' && job.season === RS.n && job.realm === realm ? rmInt(job.escorts, 0, 0, 2) : 0), 0);
}
function rmFieldCount(RS, realm) {
  return RS.armies.filter(a => a.r === realm && a.state !== 'gone').reduce((n, a) => n + a.n, 0) + rmEscortCount(RS, realm);
}
function rmPopulation(M) {
  const capacity = M.buildings.reduce((n, b) => n + (RM_CATALOG[b.kind].housing || 0) * b.level, 0);
  const workers = Math.floor(M.population * 0.65 * (0.5 + M.happiness / 200));
  return { capacity, workers };
}
function rmPeace(RS) {
  if (typeof rsmArmyHome === 'function') for (const A of RS.armies) {
    const owner = A.k >= 0 ? RS.keeps[A.k]?.h : A.q;
    if (A.state !== 'gone' && realmManageAllied(RS, A.r, owner)) rsmArmyHome(RS, A, 'the realms have agreed to peace');
  }
  RS.armies = RS.armies.filter(A => A.state !== 'gone');
  for (const O of RS.offs) if (O.state !== 'done' && realmManageAllied(RS, O.r, RS.keeps[O.k]?.h)) { O.state = 'done'; O.res = 'peace'; }
}
function rmResolveOffer(RS, offer, accept) {
  if (offer.status !== 'pending') return { ok: false, why: 'That proposal is no longer pending.' };
  if (offer.expires <= RS.t) return { ok: false, why: 'That proposal has expired.' };
  if (!accept) { offer.status = 'declined'; return { ok: true, message: 'The proposal was declined.' }; }
  const A = RS.realms[offer.from], B = RS.realms[offer.to];
  let relation;
  if (offer.type === 'trade') {
    const give = offer.give, want = offer.want;
    if (!rmCanPay(A, { [give.id]: give.n }) || !rmCanPay(B, { [want.id]: want.n })) return { ok: false, why: 'A realm no longer has the goods it offered.' };
    // Account for outgoing goods when both sides exchange the same resource.
    const roomA = rmCap(A, want.id) - rmStock(A, want.id) + (give.id === want.id ? give.n : 0);
    const roomB = rmCap(B, give.id) - rmStock(B, give.id) + (give.id === want.id ? want.n : 0);
    if (roomA + 1e-8 < want.n || roomB + 1e-8 < give.n) return { ok: false, why: 'A realm needs more storage before this trade.' };
    rmTake(A, give.id, give.n); rmTake(B, want.id, want.n); rmAdd(A, want.id, want.n); rmAdd(B, give.id, give.n);
    relation = rmRelation(RS, offer.from, offer.to);
    relation.score = Math.min(100, relation.score + 5);
  } else {
    const cost = offer.treaty === 'trade' ? 20 : 30;
    if (!rmPay(A, { gold: cost })) return { ok: false, why: 'The treasury cannot pay the envoy cost.' };
    relation = rmRelation(RS, offer.from, offer.to);
    relation.treaty = offer.treaty; relation.expires = RS.t + (offer.treaty === 'trade' ? 1800 : 1200); relation.score = Math.min(100, relation.score + 5);
    rmPeace(RS);
  }
  offer.status = 'accepted'; offer.acceptedAt = RS.t;
  rmLog(RS, offer.from, offer.type === 'trade' ? 'The agreed goods were exchanged.' : 'The realms have ratified a ' + offer.treaty + ' agreement.');
  rmLog(RS, offer.to, offer.type === 'trade' ? 'The agreed goods were exchanged.' : 'The realms have ratified a ' + offer.treaty + ' agreement.');
  return { ok: true, message: offer.type === 'trade' ? 'Trade completed.' : 'Agreement ratified.' };
}
function realmManageStep(RS, dt) {
  if (!realmManageInit(RS) || !(dt > 0)) return;
  if (dt > 60) { let left = Math.min(dt, 86400); while (left > 1e-6) { const slice = Math.min(60, left); realmManageStep(RS, slice); left -= slice; } return; }
  const minutes = dt / 60, plots = rmPlots(RS), owners = new Map(plots.map(p => [p.id, p.owner]));
  // Captured keep plots follow the keep's canonical holder, preserving the actual building.
  for (let r = 0; r < 3; r++) for (const b of [...RS.realms[r].management.buildings]) {
    const owner = owners.get(b.plotId);
    if (rmRealm(owner) && owner !== r) {
      RS.realms[r].management.buildings = RS.realms[r].management.buildings.filter(x => x !== b);
      if (b.kind === 'watchpost') { b.assigned = 0; b.working = false; b.blocked = 'workforce'; }
      RS.realms[owner].management.buildings.push(b);
    }
  }
  for (const relation of RS.management.relations) if (relation.treaty !== 'war' && relation.expires <= RS.t) { relation.treaty = 'war'; relation.expires = 0; }
  for (const offer of RS.management.offers) if (offer.status === 'pending' && offer.expires <= RS.t) offer.status = 'expired';
  for (let r = 0; r < 3; r++) {
    const R = RS.realms[r], M = R.management, before = Object.fromEntries(Object.keys(RM_LABEL).map(g => [g, rmStock(R, g)]));
    const population = rmPopulation(M); let workers = population.workers;
    const sorted = [...M.buildings].sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id));
    for (const b of sorted) {
      b.assigned = 0; b.working = false; b.blocked = '';
      if (b.paused) { b.blocked = 'paused'; continue; }
      const D = RM_CATALOG[b.kind], requested = b.status === 'built' ? b.workers : Math.max(2, D.workers);
      b.assigned = Math.min(workers, requested); workers -= b.assigned;
      if (requested > 0 && !b.assigned) { b.blocked = 'workforce'; continue; }
      if (b.status !== 'built') {
        b.remaining = Math.max(0, b.remaining - dt * b.assigned / requested);
        b.working = b.remaining > 0; b.blocked = 'construction';
        if (b.remaining === 0) { b.level = b.targetLevel; b.status = 'built'; b.blocked = ''; if (typeof realmDevelopmentFed === 'function' && realmDevelopmentFed(RS, r)) realmDevelopmentEarn(RS, r, 'work', 40); rmLog(RS, r, D.label + ' completed.'); }
        continue;
      }
      if (!D.workers) continue;
      const toolFactor = M.stock.tools > 0 || ['farm', 'woodcutter', 'quarry', 'hunter', 'watchpost'].includes(b.kind) ? 1 : 0.65;
      let fraction = b.assigned / (D.workers * b.level) * toolFactor;
      for (const [g, n] of Object.entries(D.inputs)) if (n > 0) {
        const room = rmStock(R, g) / (n * b.level * minutes || 1);
        if (room < fraction) b.blocked = 'inputs:' + g; fraction = Math.min(fraction, room);
      }
      for (const [g, n] of Object.entries(D.outputs)) if (n > 0) {
        const extra = b.kind === 'stables' ? 1 + 0.6 * R.proj.yard : 1;
        const room = (rmCap(R, g) - rmStock(R, g)) / (n * extra * b.level * minutes || 1);
        if (room < fraction) b.blocked = 'storage:' + g; fraction = Math.min(fraction, room);
      }
      fraction = Math.max(0, Math.min(1, fraction));
      for (const [g, n] of Object.entries(D.inputs)) rmTake(R, g, n * b.level * minutes * fraction);
      for (const [g, n] of Object.entries(D.outputs)) {
        const made = rmAdd(R, g, n * b.level * minutes * fraction * (b.kind === 'stables' ? 1 + 0.6 * R.proj.yard : 1));
        if (typeof realmDevelopmentFed === 'function' && realmDevelopmentFed(RS, r)) realmDevelopmentEarn(RS, r, 'work', made * 0.25);
      }
      b.working = fraction > 0;
    }
    if (M.training) {
      const job = M.training, capacity = RSM.levyMax * (1 + 0.15 * R.proj.smithy);
      const field = rmFieldCount(RS, r);
      job.assigned = Math.min(2, workers); workers -= job.assigned;
      job.blocked = !job.assigned ? 'workforce' : R.lev + field + job.units > capacity ? 'capacity' : '';
      if (job.blocked !== 'capacity') job.remaining = Math.max(0, job.remaining - dt * job.assigned / 2);
      if (job.remaining === 0 && R.lev + field + job.units <= capacity) {
        R.lev += job.units; R.stats.trained += job.units;
        if (typeof realmDevelopmentFed === 'function' && realmDevelopmentFed(RS, r)) realmDevelopmentEarn(RS, r, 'training', job.units * 8);
        rmLog(RS, r, job.units + ' paid recruits joined the reserve.'); M.training = null;
      }
    }
    const needs = { bread: M.population * 0.012 * minutes, cloth: M.population * 0.001 * minutes, tools: M.population * 0.0003 * minutes };
    for (const [g, need] of Object.entries(needs)) { const used = Math.min(need, M.stock[g]); M.stock[g] -= used; M.needs[g] = need ? used / need : 1; }
    const market = M.buildings.some(b => b.kind === 'market' && b.status === 'built' && !b.paused && b.assigned > 0);
    const target = Math.max(5, Math.min(100, 10 + 45 * M.needs.bread + 20 * M.needs.cloth + 10 * M.needs.tools
      + (M.population <= population.capacity ? 15 : 0) + (market ? 5 : 0) + (M.taxPolicy === 'low' ? 3 : M.taxPolicy === 'high' ? -12 : 0)));
    M.happiness += (target - M.happiness) * Math.min(1, minutes / 3);
    if (M.population > 0 && M.happiness >= 60 && M.population < population.capacity) M.population = Math.min(500, population.capacity, M.population + 0.12 * minutes * M.needs.bread);
    else if (M.happiness < 20) M.population = Math.max(0, M.population - 0.08 * minutes);
    const tax = M.population * 0.04 * (M.taxPolicy === 'low' ? 0.65 : M.taxPolicy === 'high' ? 1.5 : 1) * (0.4 + 0.6 * M.happiness / 100);
    M.revenue = rmAdd(R, 'gold', tax * minutes) / minutes;
    // Bread feeds the same provisions consumed by the realm's real levy and garrisons.
    const surplus = Math.max(0, M.stock.bread - Math.max(8, M.population * 0.5));
    const bread = Math.min(surplus, 2 * minutes), food = rmAdd(R, 'food', bread * 1.4);
    M.stock.bread -= food / 1.4;
    M.rates = Object.fromEntries(Object.keys(RM_LABEL).map(g => [g, (rmStock(R, g) - before[g]) / minutes]));
  }
  rmPeace(RS);
}
function realmManageAction(RS, realm, args, context = {}) {
  const M = realmManageInit(RS), R = RS?.realms?.[realm], no = why => ({ ok: false, why, revision: M?.revision || 0 });
  if (!M || !rmRealm(realm) || !R || !args || typeof args !== 'object' || Array.isArray(args)) return no('Choose an available realm command.');
  if ((args.expectedRevision != null && args.expectedRevision !== M.revision) || (args.revision != null && args.revision !== M.revision)) return no('The realm has newer orders. Review it and try again.');
  const local = R.management, type = args.type, plots = rmPlots(RS), all = RS.realms.flatMap(q => q.management.buildings);
  let message = '', outcome;
  if (type === 'build') {
    const plot = plots.find(p => p.id === args.plotId), D = Object.hasOwn(RM_CATALOG, args.kind) ? RM_CATALOG[args.kind] : null;
    if (!plot || plot.owner !== realm || !D || all.some(b => b.plotId === plot.id)) return no('Choose an empty plot held by your realm.');
    if (!realmManageBuildSiteAllowed(args.kind, plot)) return no('Choose a ' + D.siteTypes.join(' or ') + ' plot for this building.');
    if (args.kind === 'watchpost' && all.some(b => b.kind === 'watchpost' && b.plotId.startsWith(plot.site + ':')))
      return no('This keep already has a watchpost or one under construction.');
    if (!plot.placementAvailable || plot.placementVersion !== RM_PLOT_LAYOUT_VERSION) return no('This construction site is unavailable. Review the realm’s current plots.');
    if (!rmPay(R, D.cost)) return no('The realm lacks the building materials.');
    local.buildings.push({ ...rmBuilding(plot.id, args.kind), placementVersion: RM_PLOT_LAYOUT_VERSION }); message = D.label + ' construction commissioned.';
  } else if (['upgrade', 'pause', 'workforce'].includes(type)) {
    const b = all.find(b => b.id === args.buildingId), plot = b && plots.find(p => p.id === b.plotId);
    if (!b || plot?.owner !== realm) return no('That building is not held by your realm.');
    if (type === 'upgrade') {
      if (b.status !== 'built' || b.level >= (RM_CATALOG[b.kind].maxLevel || 3)) return no('That building cannot be upgraded now.');
      const cost = Object.fromEntries(Object.entries(RM_CATALOG[b.kind].cost).map(([g, n]) => [g, Math.ceil(n * (b.level + 1) * 0.75)]));
      if (!rmPay(R, cost)) return no('The realm lacks the upgrade materials.');
      b.status = 'upgrading'; b.targetLevel = b.level + 1; b.total = b.remaining = RM_CATALOG[b.kind].seconds * b.targetLevel; message = 'Building upgrade commissioned.';
    } else if (type === 'pause') {
      if (typeof args.paused !== 'boolean') return no('Choose pause or resume.');
      b.paused = args.paused; message = args.paused ? 'Work paused.' : 'Work resumed.';
    } else {
      if (!Number.isSafeInteger(args.workers) || args.workers < 0 || args.workers > RM_CATALOG[b.kind].workers * Math.max(1, b.level)
        || !Number.isSafeInteger(args.priority) || args.priority < 0 || args.priority > 2) return no('Choose valid workers and priority.');
      b.workers = args.workers; b.priority = args.priority; message = 'Workforce allocation updated.';
    }
  } else if (type === 'recruit') {
    const units = args.units, cap = RSM.levyMax * (1 + 0.15 * R.proj.smithy);
    const field = rmFieldCount(RS, realm);
    if (!Number.isSafeInteger(units) || units < 1 || units > 12 || local.training || R.lev + field + units > cap) return no('Choose 1–12 recruits within the realm levy capacity; finish the current training first.');
    const cost = Object.fromEntries(Object.entries(RM_RAW).filter(([, g]) => RSM.levyCost[g] > 0).map(([id, g]) => [id, RSM.levyCost[g] * units]));
    if (!rmPay(R, cost)) return no('The realm lacks the food, gear or treasury for these recruits.');
    local.training = { units, remaining: units * 45, total: units * 45, assigned: 0, blocked: '' };
    message = units + ' recruits commissioned; two town workers will train them.';
  } else if (type === 'tax') {
    if (!['low', 'normal', 'high'].includes(args.policy)) return no('Choose a tax policy.');
    local.taxPolicy = args.policy; message = 'Tax policy updated.';
  } else if (['offer', 'gift', 'treaty', 'declareWar'].includes(type)) {
    const target = args.targetRealm;
    if (!rmRealm(target) || target === realm) return no('Choose another realm.');
    const B = RS.realms[target], relation = rmRelation(RS, realm, target, false) || { a: Math.min(realm, target), b: Math.max(realm, target), score: 0, treaty: 'war', expires: 0 };
    if (type === 'gift') {
      if (!Object.hasOwn(RM_PRICE, args.resource) || !Number.isSafeInteger(args.amount) || args.amount < 1 || args.amount > 500
        || rmStock(R, args.resource) < args.amount || rmCap(B, args.resource) - rmStock(B, args.resource) < args.amount) return no('The gift cannot be supplied or stored.');
      rmTake(R, args.resource, args.amount); rmAdd(B, args.resource, args.amount);
      if (!RS.management.relations.includes(relation)) RS.management.relations.push(relation);
      relation.score = Math.min(100, relation.score + Math.min(10, args.amount * RM_PRICE[args.resource] / 20));
      message = 'The gift was delivered to the other realm.';
    } else if (type === 'declareWar') {
      if (!RS.management.relations.includes(relation)) RS.management.relations.push(relation);
      relation.treaty = 'war'; relation.expires = 0; relation.score = Math.max(-100, relation.score - 20);
      message = 'The agreement is ended; the realms are at war.';
    } else {
      if (M.offers.filter(o => o.status === 'pending').length >= 12) return no('Resolve the pending proposals first.');
      const treaty = type === 'treaty';
      if (treaty && !['trade', 'truce'].includes(args.kind)) return no('Choose a trade agreement or truce.');
      const validGood = (g, n) => Object.hasOwn(RM_PRICE, g) && Number.isSafeInteger(n) && n >= 1 && n <= 500;
      if (!treaty && (!validGood(args.giveResource, args.giveAmount) || !validGood(args.wantResource, args.wantAmount))) return no('Choose available goods and quantities.');
      if (!treaty && !rmCanPay(R, { [args.giveResource]: args.giveAmount })) return no('The realm lacks the offered goods.');
      if (treaty && rmStock(R, 'gold') < (args.kind === 'trade' ? 20 : 30)) return no('The treasury cannot fund the envoy.');
      const offer = { id: M.nextOffer++, from: realm, to: target, type: treaty ? 'treaty' : 'trade', treaty: treaty ? args.kind : '',
        give: treaty ? { id: 'gold', n: args.kind === 'trade' ? 20 : 30 } : { id: args.giveResource, n: args.giveAmount },
        want: treaty ? { id: 'gold', n: 0 } : { id: args.wantResource, n: args.wantAmount },
        status: 'pending', at: RS.t, expires: RS.t + 300 };
      M.offers.push(offer); while (M.offers.length > 24) { const i = M.offers.findIndex(o => o.status !== 'pending'); M.offers.splice(i >= 0 ? i : 0, 1); }
      if (Array.isArray(context.aiRealms) && context.aiRealms.includes(target)) {
        const fair = treaty ? relation.score >= (args.kind === 'trade' ? 0 : -5)
          : offer.give.n * RM_PRICE[offer.give.id] >= offer.want.n * RM_PRICE[offer.want.id] * (realmManageAllied(RS, realm, target) ? 1 : 1.05)
            && rmStock(B, offer.want.id) - offer.want.n >= Math.min(10, rmCap(B, offer.want.id) * 0.1);
        outcome = rmResolveOffer(RS, offer, fair);
        if (!outcome.ok) offer.status = 'declined';
        message = offer.status === 'accepted' ? outcome.message : 'The other realm declined the proposal.';
      } else message = 'Proposal sent; the other realm must accept it.';
    }
  } else if (type === 'reply') {
    const offer = M.offers.find(o => o.id === args.offerId);
    if (!offer || offer.to !== realm || typeof args.accept !== 'boolean') return no('That proposal is not addressed to your realm.');
    outcome = rmResolveOffer(RS, offer, args.accept);
    if (!outcome.ok) return no(outcome.why);
    message = outcome.message;
  } else if (['project', 'target', 'muster'].includes(type)) {
    if (type === 'muster') {
      if (RS.armies.length >= 40) return no('The March already has forty companies in the field; stand one down before mobilizing another.');
      const units = Math.min(30, Math.floor(R.lev - 4));
      if (RS.phase === 'reckon') return no('The season is being reckoned; mobilization resumes next season.');
      if (units < 4) return no('Keep four soldiers in reserve and mobilize at least four; recruit more soldiers first.');
      if (R.s[0] < units * 1.5) return no('The company needs ' + (units * 1.5) + ' army provisions to mobilize.');
    }
    if (type === 'target' && (!Number.isSafeInteger(args.keep) || !RS.keeps[args.keep] || realmManageAllied(RS, realm, RS.keeps[args.keep].h))) return no('That realm is protected by an agreement.');
    if (!realmSimOrder(RS, realm, { type, id: args.id, keep: args.keep }, { name: String(context.name || 'The ruler'), rank: 5, manual: true })) return no('That strategic order cannot be carried out now.');
    message = type === 'project' ? 'The realm has a new work priority.' : type === 'target' ? 'The offensive target is set.' : 'The levy has mustered.';
  } else return no('Choose an available realm command.');
  M.revision++; rmLog(RS, realm, message);
  return { ok: true, message, revision: M.revision };
}
function realmManageView(RS, realm) {
  if (!realmManageInit(RS) || !rmRealm(realm)) return null;
  const R = RS.realms[realm], M = R.management, plots = rmPlots(RS), all = RS.realms.flatMap((q, r) => q.management.buildings.map(b => ({ ...b, owner: r })));
  const publicBuildings = all.map(b => { const p = plots.find(p => p.id === b.plotId), D = RM_CATALOG[b.kind]; return { ...rmClone(b), x: p.x, z: p.z,
    home: p.home, yaw: p.yaw, placementVersion: p.placementVersion,
    owner: p.owner, maxLevel: D.maxLevel || 3, upgradeCost: b.status === 'built' && b.level < (D.maxLevel || 3) ? Object.fromEntries(Object.entries(D.cost).map(([g, n]) => [g, Math.ceil(n * (b.level + 1) * 0.75)])) : null,
    upgradeSeconds: b.status === 'built' && b.level < (D.maxLevel || 3) ? D.seconds * (b.level + 1) : 0, progress: b.status === 'built' ? 1 : Math.max(0, 1 - b.remaining / (b.total || 1)), inputs: D.inputs, outputs: D.outputs }; });
  const publicPlots = plots.map(p => ({ ...p, buildingId: all.find(b => b.plotId === p.id)?.id || null }));
  const pop = rmPopulation(M), assigned = M.buildings.reduce((n, b) => n + b.assigned, 0) + (M.training?.assigned || 0);
  const relations = [0, 1, 2].filter(r => r !== realm).map(r => { const q = rmRelation(RS, realm, r, false); return { realm: r, score: q?.score || 0, treaty: q?.expires > RS.t ? q.treaty : 'war', expires: q?.expires || 0 }; });
  return { v: 1, realm, revision: RS.management.revision, time: RS.t,
    stocks: Object.keys(RM_LABEL).map(id => ({ id, label: RM_LABEL[id], n: rmStock(R, id), cap: rmCap(R, id), rate: M.rates[id] || 0 })),
    population: { residents: M.population, capacity: pop.capacity, workers: pop.workers, available: Math.max(0, pop.workers - assigned), assigned,
      happiness: M.happiness, needs: { ...M.needs }, taxPolicy: M.taxPolicy, revenue: M.revenue },
    publicWorks: RSM_PROJ.map(id => {
      const P = RSM.projects[id], vector = rsmProjectCost(R, id);
      const cost = Object.fromEntries(vector.map((n, g) => [RSM_GOODS[g], n]).filter(([, n]) => n > 0));
      return { id, label: P.name, level: R.proj[id], maxLevel: P.max, cost, nextCost: R.proj[id] < P.max ? { ...cost } : null,
        atWork: R.act === id, progress: R.act === id ? R.prog : 0 };
    }),
    military: { reserves: R.lev, capacity: RSM.levyMax * (1 + 0.15 * R.proj.smithy),
      field: rmFieldCount(RS, realm), queued: M.training?.units || 0,
      training: M.training ? rmClone(M.training) : null,
      recruitCost: Object.fromEntries(Object.entries(RM_RAW).filter(([, g]) => RSM.levyCost[g] > 0).map(([id, g]) => [id, RSM.levyCost[g]])),
      secondsPerUnit: 45, musterCostPerTroop: 1.5, musterReserve: 4, musterLimit: 30 },
    plots: publicPlots.filter(p => p.owner === realm), buildings: publicBuildings.filter(b => b.owner === realm),
    publicPlots, publicBuildings: publicBuildings.map(b => ({ id: b.id, plotId: b.plotId, kind: b.kind, level: b.level, targetLevel: b.targetLevel,
      status: b.status, remaining: b.remaining, total: b.total, progress: b.progress, paused: b.paused, assigned: b.assigned, working: b.working,
      blocked: b.blocked, adopted: b.adopted, owner: b.owner, home: b.home, yaw: b.yaw, placementVersion: b.placementVersion, x: b.x, z: b.z })), catalog: Object.entries(RM_CATALOG).map(([id, D]) => ({ id, ...rmClone(D), maxLevel: D.maxLevel || 3 })),
    recipes: Object.entries(RM_CATALOG).filter(([, D]) => Object.keys(D.inputs).length).map(([id, D]) => ({ id, inputs: D.inputs, outputs: D.outputs })),
    offers: RS.management.offers.filter(o => o.from === realm || o.to === realm).map(rmClone), relations,
    allRelations: RS.management.relations.map(rmClone), log: M.log.map(rmClone) };
}
function rmReceiptData(value) {
  let nodes = 0;
  const seen = new Set(), badKeys = new Set(['__proto__', 'prototype', 'constructor']);
  const clone = (x, depth) => {
    if (++nodes > 256 || depth > 6) throw new Error('receipt data bounds');
    if (x === null || typeof x === 'boolean') return x;
    if (typeof x === 'number') { if (!Number.isFinite(x)) throw new Error('receipt number'); return x; }
    if (typeof x === 'string') { if (x.length > 160) throw new Error('receipt string'); return x; }
    if (!x || typeof x !== 'object' || seen.has(x)) throw new Error('receipt data type');
    seen.add(x);
    let out;
    if (Array.isArray(x)) {
      if (x.length > 32) throw new Error('receipt array');
      out = x.map(v => clone(v, depth + 1));
    } else {
      if (![Object.prototype, null].includes(Object.getPrototypeOf(x))) throw new Error('receipt prototype');
      const keys = Object.keys(x);
      if (keys.length > 32 || keys.some(k => k.length > 160 || badKeys.has(k))) throw new Error('receipt keys');
      out = Object.fromEntries(keys.map(k => [k, clone(x[k], depth + 1)]));
    }
    seen.delete(x); return out;
  };
  try {
    const out = clone(value, 0), json = JSON.stringify(out);
    if (json.length > 2048 || encodeURIComponent(json).replace(/%[0-9A-F]{2}/g, 'x').length > 2048) return undefined;
    return out;
  } catch { return undefined; }
}
function realmManageSanitize(RS, inputRS) {
  realmManageInit(RS);
  const source = inputRS?.management, fresh = !source || source.v !== 1;
  if (!fresh) {
    RS.management.revision = rmInt(source.revision, 0, 0, Number.MAX_SAFE_INTEGER - 1);
    RS.management.nextOffer = rmInt(source.nextOffer, 1, 1, 1e9);
    RS.management.relations = [];
    for (const p of (Array.isArray(source.relations) ? source.relations : []).slice(0, 3)) if (rmRealm(p?.a) && rmRealm(p?.b) && p.a < p.b
      && !RS.management.relations.some(q => q.a === p.a && q.b === p.b)) RS.management.relations.push({ a: p.a, b: p.b, score: rmNum(p.score, 0, -100, 100), treaty: ['war', 'trade', 'truce'].includes(p.treaty) ? p.treaty : 'war', expires: rmNum(p.expires, 0, 0, 1e12) });
    RS.management.offers = [];
    for (const o of (Array.isArray(source.offers) ? source.offers : []).slice(-24)) {
      if (!o || !Number.isSafeInteger(o.id) || o.id < 1 || !rmRealm(o.from) || !rmRealm(o.to) || o.from === o.to
        || !['trade', 'treaty'].includes(o.type) || !['pending', 'accepted', 'declined', 'expired'].includes(o.status)
        || !Object.hasOwn(RM_PRICE, o.give?.id) || !Object.hasOwn(RM_PRICE, o.want?.id)
        || !Number.isSafeInteger(o.give.n) || o.give.n < 0 || o.give.n > 500 || !Number.isSafeInteger(o.want.n) || o.want.n < 0 || o.want.n > 500
        || (o.type === 'trade' && (o.give.n < 1 || o.want.n < 1)) || (o.type === 'treaty' && !['trade', 'truce'].includes(o.treaty))
        || RS.management.offers.some(q => q.id === o.id)) continue;
      RS.management.offers.push({ id: o.id, from: o.from, to: o.to, type: o.type, treaty: ['trade', 'truce'].includes(o.treaty) ? o.treaty : '',
        give: { id: o.give.id, n: o.give.n }, want: { id: o.want.id, n: o.want.n }, status: o.status, at: rmNum(o.at, 0, 0, 1e12), expires: rmNum(o.expires, 0, 0, 1e12),
        ...(o.acceptedAt != null ? { acceptedAt: rmNum(o.acceptedAt, 0, 0, 1e12) } : {}) });
    }
    RS.management.nextOffer = Math.max(RS.management.nextOffer, ...RS.management.offers.map(o => o.id + 1));
  }
  const plots = rmPlots(RS), ids = new Set(), watchKeeps = new Set();
  for (let r = 0; r < 3; r++) {
    const src = inputRS?.realms?.[r]?.management;
    if (!src || src.v !== 1) continue;
    const M = RS.realms[r].management;
    M.stock = Object.fromEntries(Object.entries(RM_PROCESSED).map(([g, cap]) => [g, rmNum(src.stock?.[g], 0, 0, cap)]));
    M.population = rmNum(src.population, 32, 0, 500); M.happiness = rmNum(src.happiness, 65, 0, 100);
    if (!Object.hasOwn(src, 'training')) delete M.training;
    else M.training = src.training && Number.isSafeInteger(src.training.units) && src.training.units >= 1 && src.training.units <= 12
      ? { units: src.training.units, remaining: rmNum(src.training.remaining, src.training.units * 45, 0, src.training.units * 45),
        total: src.training.units * 45, assigned: rmInt(src.training.assigned, 0, 0, 2), blocked: ['workforce', 'capacity', ''].includes(src.training.blocked) ? src.training.blocked : '' } : null;
    M.taxPolicy = ['low', 'normal', 'high'].includes(src.taxPolicy) ? src.taxPolicy : 'normal'; M.revenue = rmNum(src.revenue, 0, 0, 100);
    M.needs = Object.fromEntries(['bread', 'cloth', 'tools'].map(g => [g, rmNum(src.needs?.[g], 0, 0, 1)]));
    M.rates = Object.fromEntries(Object.keys(RM_LABEL).map(g => [g, rmNum(src.rates?.[g], 0, -1e5, 1e5)]));
    M.buildings = [];
    for (const b of (Array.isArray(src.buildings) ? src.buildings : []).slice(0, 72)) {
      const p = plots.find(p => p.id === b?.plotId), D = Object.hasOwn(RM_CATALOG, b?.kind) ? RM_CATALOG[b.kind] : null;
      if (!p || !D || b.id !== 'b:' + p.id || ids.has(b.id)
        || Object.hasOwn(b, 'placementVersion') && !(b.placementVersion === 1 || Number.isSafeInteger(b.placementVersion) && Object.hasOwn(RM_PLOT_LAYOUTS, b.placementVersion))) continue;
      if (b.kind === 'watchpost' && (!realmManageBuildSiteAllowed(b.kind, p) || b.adopted === true || watchKeeps.has(p.site))) continue;
      if (b.kind === 'watchpost') watchKeeps.add(p.site);
      ids.add(b.id);
      M.buildings.push({ id: b.id, plotId: b.plotId, kind: b.kind, level: rmInt(b.level, 0, 0, D.maxLevel || 3), targetLevel: rmInt(b.targetLevel, 1, 1, D.maxLevel || 3),
        status: ['built', 'building', 'upgrading'].includes(b.status) ? b.status : 'building', remaining: rmNum(b.remaining, 0, 0, 600), total: rmNum(b.total, D.seconds, 1, 600),
        paused: b.paused === true, priority: rmInt(b.priority, 1, 0, 2), workers: rmInt(b.workers, D.workers, 0, D.workers * 3), assigned: rmInt(b.assigned, 0, 0, D.workers * 3 + 2),
        working: b.working === true, blocked: String(b.blocked || '').slice(0, 40), adopted: b.adopted === true,
        ...(Object.hasOwn(b, 'placementVersion') ? { placementVersion: b.placementVersion } : {}) });
    }
    M.log = (Array.isArray(src.log) ? src.log : []).slice(-12).filter(x => x && typeof x.text === 'string').map(x => ({ at: rmNum(x.at, 0, 0, 1e12), text: x.text.slice(0, 160) }));
  }
  RS.managementReceipts = [];
  for (const q of (Array.isArray(inputRS?.managementReceipts) ? inputRS.managementReceipts : []).slice(-32)) {
    if (!q || !['owner', 'id', 'digest'].every(k => typeof q[k] === 'string' && q[k].length > 0 && q[k].length <= 200)
      || !Number.isSafeInteger(q.season) || q.season < 1 || !rmRealm(q.realm) || !Number.isSafeInteger(q.revision) || q.revision < 0
      || !q.result || typeof q.result.ok !== 'boolean') continue;
    const data = Object.hasOwn(q.result, 'data') ? rmReceiptData(q.result.data) : undefined;
    RS.managementReceipts.push({ owner: q.owner, id: q.id, digest: q.digest, season: q.season, realm: q.realm, revision: q.revision,
      result: { ok: q.result.ok, message: String(q.result.message || '').slice(0, 160), revision: rmInt(q.result.revision, q.revision, 0, Number.MAX_SAFE_INTEGER - 1),
        ...(data !== undefined ? { data } : {}) } });
  }
  return RS;
}
