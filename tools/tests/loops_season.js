// [loops] The season headless (Node): src/08m_realm.js loaded alone and stepped through whole seasons of weeks.
// usage: node tools/tests/loops_season.js [seeds=12] [json=PATH]   (exit code 1 on a failed check)
const path = require('path');
const M = require(path.resolve(__dirname, '../../src/08m_realm.js'));
const args = process.argv.slice(2);
const SEEDS = +((args.find((a) => a.startsWith('seeds=')) || 'seeds=12').slice(6));
const JSONOUT = (args.find((a) => a.startsWith('json=')) || '').slice(5);
const fails = [];
const check = (c, what) => { console.log((c ? '  ok   ' : '  FAIL ') + what); if (!c) fails.push(what); };
const DAY = 86400;

// one season: hourly steps of 60 s sub-steps; `work(RS, day, hour)` is what the players do
function season(seed, work, opts = {}) {
  const RS = M.realmSimInit(seed, opts);
  const trace = { leaders: [], placeAt: {}, keepsAtWar: null, spAtWar: null, changes: 0, noKeep: 0 };
  const run = [0, 0, 0];
  let lastLead = -1;
  const days = Math.round(RS.len / DAY);
  for (let d = 0; d < days; d++) {
    for (let h = 0; h < 24; h++) {
      if (work) work(RS, d, h);
      if (opts.starve) for (const [r, g] of opts.starve) { RS.realms[r].s[g] = 0; (RS.realms[r].pk = RS.realms[r].pk || [1, 1, 1, 1, 1, 1, 1, 1])[g] = 0; }
      const ph = RS.phase;
      M.realmSimStep(RS, 3600);
      if (ph === 'muster' && RS.phase === 'war') { trace.keepsAtWar = RS.keeps.map((K) => K.h); trace.spAtWar = RS.realms.map((R) => R.sp); }
      if (RS.phase === 'war') {
        for (let r = 0; r < 3; r++) { run[r] = RS.keeps.some((K) => K.h === r) ? 0 : run[r] + 1; trace.noKeep = Math.max(trace.noKeep, run[r]); }
        const lead = [0, 1, 2].sort((a, b) => RS.realms[b].sp - RS.realms[a].sp)[0];
        if (lastLead >= 0 && lead !== lastLead && h === 12) trace.changes++;
        if (h === 12) lastLead = lead;
      }
    }
    const order = [0, 1, 2].sort((a, b) => RS.realms[b].sp - RS.realms[a].sp);
    trace.placeAt[d + 1] = order;
    if (d === 13) trace.made14 = RS.realms.map((R) => R.stats.poured);
    if (d === 11) trace.ann = RS.log.filter((L) => /announces its offensive/.test(L.x)).map((L) => L.x);
    if (RS.phase === 'reckon' && trace.final == null) trace.final = order.slice();
  }
  trace.RS = RS;
  return trace;
}

const t0 = Date.now();
const runs = [];
for (let s = 1; s <= SEEDS; s++) runs.push(season(s * 7919));
const ms = (Date.now() - t0) / SEEDS;
console.log(`a season of 42 days: ${ms.toFixed(0)} ms of Node (60 s steps), its state ${JSON.stringify(runs[0].RS).length} bytes as JSON`);
check(ms < 6000, `a season steps in seconds (${ms.toFixed(0)} ms a season, ${(ms / 6).toFixed(0)} ms a week)`);
check(runs.every((t) => JSON.stringify(t.RS).length < 200000), 'the state stays under 200 KB as JSON');

// no realm wins (or takes a keep) before the war
check(runs.every((t) => t.keepsAtWar && t.keepsAtWar.every((h, i) => h === [0, 0, 1, 1, 2, 2][i])), 'no keep changes hands in the muster');
check(runs.every((t) => t.RS.past.length === 1 && t.RS.n === 2), 'every season ends in its reckoning and a new one begins');
const caps = runs.map((t) => t.RS.stats.captures);
const prev = runs.map((t) => t.RS.past[0]);
console.log('captures a season', caps.join(' '), ' winners', prev.map((p) => p.w).join(''), ' final points', prev.map((p) => p.sp.join('/')).join('  '));
check(caps.every((c) => c >= 6 && c <= 120), `keeps change hands through the war (${Math.min(...caps)} to ${Math.max(...caps)} a season)`);
const wins = [0, 0, 0]; prev.forEach((p) => wins[p.w]++);
check(wins.filter((w) => w > 0).length >= 2, `more than one realm wins across seeds (${wins.join('/')})`);
const changes = runs.map((t) => t.changes);
check(changes.filter((c) => c >= 1).length >= SEEDS * 0.6, `the lead changes in most seasons (${changes.join(' ')})`);
// a realm behind at the war's middle comes back: last on day 20, not last at the end
let back = 0, behind = 0;
for (const t of runs) { const mid = t.placeAt[20], fin = t.final; if (!mid || !fin) continue; behind++; if (fin.indexOf(mid[2]) < 2) back++; }
check(back >= 1, `a realm last at day 20 climbs out of last place by the reckoning in ${back} of ${behind} seasons`);
const margins = prev.map((p) => { const s = p.sp.slice().sort((a, b) => b - a); return (s[0] - s[1]) / s[0]; });
console.log('winning margins', margins.map((m) => (m * 100).toFixed(0) + '%').join(' '));
check(margins.filter((m) => m < 0.25).length >= SEEDS / 2, 'most seasons are close at the top (the winner within a quarter of the second)');

const noKeep = runs.map((t) => t.noKeep);
check(noKeep.every((h) => h < 72), `no realm is ground into nothing: its longest spell without a keep under three days (${noKeep.join(' ')} hours)`);
// a realm whose players give nothing still lives and fights
check(runs.every((t) => t.RS.realms.every((R) => R.stats.trained > 50 && R.stats.offensives >= 3 && R.stats.made >= 3)), 'every realm trains, builds and announces offensives with no player at all');
// the war's draw on the stores
const ate = runs[0].RS.realms.map((R) => Math.round(R.stats.ate));
console.log('food eaten in a season by each realm', ate.join(' '), ' made', runs[0].RS.realms.map((R) => R.stats.made).join(' '), ' lost', runs[0].RS.realms.map((R) => Math.round(R.stats.lost)).join(' '));

// players who give: a day's deliveries of an hour's work (timber 350, stone 650, iron 30) and an hour of work, to realm 0
const daily = (RS, d, h) => { if (h === 19) { M.realmSimContribute(RS, 0, 'timber', 350, 'p'); M.realmSimContribute(RS, 0, 'stone', 650, 'p'); M.realmSimContribute(RS, 0, 'iron', 30, 'p'); M.realmSimContribute(RS, 0, 'work', 1, 'p'); } };
const every3 = (RS, d, h) => { if (d % 3 === 0) daily(RS, d, h); };
const place = (ts) => ts.reduce((a, t) => a + (t.final ? t.final.indexOf(0) + 1 : 2), 0) / ts.length;
const projects = (ts) => ts.reduce((a, t) => a + t.made14[0], 0) / ts.length; // (by the fourteenth day: later the realm has built all it can)
const none = runs, d1 = [], d3 = [];
for (let s = 1; s <= SEEDS; s++) { d1.push(season(s * 7919, daily)); d3.push(season(s * 7919, every3)); }
console.log(`Logres's mean place: nobody ${place(none).toFixed(2)}, an hour every three days ${place(d3).toFixed(2)}, an hour a day ${place(d1).toFixed(2)}; the goods poured into its projects by day 14 ${projects(none).toFixed(0)}, ${projects(d3).toFixed(0)}, ${projects(d1).toFixed(0)}`);
check(projects(d3) > projects(none) && projects(d1) > projects(d3), 'a player an hour every few days builds more for the realm, one every day more still');
check(place(d1) < place(none), 'and the realm of a daily player places better on average');
check(place(d1) > 1.0 || SEEDS < 4, 'but never wins every season by deliveries alone');

// a realm short of each thing shows it
const st = (starve) => { const t = season(424242, null, { starve }); return t.RS.realms[0]; };
const base = runs[0].RS.realms[0];
const noFood = st([[0, 0]]), noIron = st([[0, 3]]), noTimber = st([[0, 1], [0, 7]]); // (and no gold to buy it at the fairs)
console.log(`Logres short: of food trained ${noFood.stats.trained} (whole ${base.stats.trained}), hungry ${noFood.stats.hungryH.toFixed(0)} h; of iron trained ${noIron.stats.trained}; of timber made ${noTimber.stats.made} projects (whole ${base.stats.made})`);
check(noFood.stats.trained < base.stats.trained * 0.3 && noFood.stats.hungryH > 48, 'without food it trains next to nobody and its soldiers go hungry');
check(noIron.stats.trained < base.stats.trained * 0.3, 'without iron its levies go untrained');
check(noTimber.stats.made < base.stats.made * 0.5, 'without timber (nor gold to buy it) its projects stall');

// determinism, the save and its sanitising
const a = season(99), b = season(99);
check(JSON.stringify(a.RS) === JSON.stringify(b.RS), 'the same seed gives the same season');
const mid = M.realmSimInit(55); M.realmSimStep(mid, 20 * DAY);
const round = M.realmSimSanitize(JSON.parse(JSON.stringify(mid)));
const strip = (o) => JSON.stringify(o, (k, v) => (k === 'live' ? undefined : v));
check(strip(round) === strip(mid), 'a season saved and read back is the same');
const c1 = M.realmSimSanitize(JSON.parse(JSON.stringify(mid))); M.realmSimStep(c1, 5 * DAY); M.realmSimStep(mid, 5 * DAY);
check(strip(c1) === strip(mid), 'and runs on the same');
const junk = M.realmSimSanitize({ v: 1, realms: [{ s: ['x', -5, 1e99] }, null, 7], keeps: [{ h: 9, g: 'q' }, 3], armies: [{ kind: 'assault', k: 99 }, { kind: 'raid', r: 5, n: 1e9 }], log: [5, { x: 1 }] });
check(junk.realms[0].s.every((v) => Number.isFinite(v) && v >= 0) && junk.keeps.every((K) => K.h >= 0 && K.h <= 2) && junk.armies.every((A) => A.n <= 200), 'a damaged state is made sane');
check(M.realmSimSanitize('nonsense').v === M.RSM_V && M.realmSimSanitize(null).phase === 'muster', 'anything not a state is a fresh season');
let threw = null; try { const J = M.realmSimSanitize(junk); M.realmSimStep(J, 30 * DAY); } catch (e) { threw = e; }
check(!threw, 'and a sane one runs a month without error');
// orders and votes
const O = M.realmSimInit(3);
O.realms[1].act = 'granary'; O.realms[1].prog = 0.5;
check(M.realmSimOrder(O, 1, { type: 'project', id: 'smithy' }, { name: 'a', rank: 2 }) && O.realms[1].act === 'granary' && O.realms[1].votes.smithy > 0, 'a voice below rank 5 is a vote');
check(M.realmSimOrder(O, 1, { type: 'project', id: 'smithy' }, { name: 'b', rank: 6 }) && O.realms[1].act === 'smithy', 'an officer of rank 5 and up sets the work');
check(!M.realmSimOrder(O, 1, { type: 'target', keep: 2 }, { name: 'c', rank: 2 }) && M.realmSimOrder(O, 1, { type: 'target', keep: 0 }, { name: 'd', rank: 7 }) && O.realms[1].aim === 0, 'only an officer names the offensive\'s keep');
const sum = M.realmSimSummary(mid, 0, 15 * DAY);
check(sum.lines.length >= 2 && /While you were away/.test(sum.lines[0]) && sum.phase === 'war' && sum.offs.every((q) => q.inS >= 0), `a returning player is told what happened (${sum.lines.length - 1} lines: "${(sum.lines[1] || '').slice(0, 90)}...")`);
// the defenders are warned days ahead
let warned = 0, offs = 0;
for (const t of runs) for (const x of t.ann) if (true) { const L = { x }; offs++; const m = /in (\d+)d/.exec(L.x); if (m && +m[1] >= 1) warned++; }
check(offs > 0 && warned / offs > 0.8, `offensives are announced a day and more ahead (${warned} of ${offs} in the logs kept)`);

// [season2] (version 20) crowds of players: each realm's players log in when they can (six days in ten, at an hour of
// their own) and bring an hour's work (timber, stone, iron, food and an hour on the works) and vote; realms uneven
const crowdDay = (seed, P) => { // P: players a realm; returns the players' plan [r][i] = { hour, on(d) }
  let x = (seed * 2654435761) >>> 0;
  const rnd = () => { x = (x + 0x6d2b79f5) | 0; let t = Math.imul(x ^ (x >>> 15), x | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  return P.map((n) => Array.from({ length: n }, () => ({ hour: Math.floor(rnd() * 24), q: 0.6 + rnd() * 0.8, rnd })));
};
function crowdSeason(seed, P) {
  const plan = crowdDay(seed, P), got = [0, 0, 0];
  const work = (RS, d, h) => {
    for (let r = 0; r < 3; r++) for (const pl of plan[r]) {
      if (pl.hour !== h || pl.rnd() > 0.6) continue;
      const q = pl.q;
      got[r] += M.realmSimContribute(RS, r, 'timber', Math.round(250 * q), 'p') + M.realmSimContribute(RS, r, 'stone', Math.round(450 * q), 'p') + M.realmSimContribute(RS, r, 'iron', Math.round(20 * q), 'p') + M.realmSimContribute(RS, r, 'food', Math.round(200 * q), 'p') + M.realmSimContribute(RS, r, 'work', 1, 'p');
      if (pl.rnd() < 0.3) M.realmSimOrder(RS, r, { type: 'project', id: ['walls', 'smithy', 'engines', 'granary'][Math.floor(pl.rnd() * 4)] }, { name: 'p', rank: 2 });
    }
  };
  const t = season(seed, work);
  t.got = got;
  return t;
}
const CROWDS = { even: [2, 2, 2], ten: [10, 2, 2], twenty: [20, 2, 2], none: [0, 0, 0], many: [20, 20, 20] };
const cr = {};
const t1 = Date.now();
for (const [name, P] of Object.entries(CROWDS)) {
  const ts = [];
  for (let s = 1; s <= SEEDS; s++) ts.push(crowdSeason(s * 7919 + 17, P));
  const prevs = ts.map((t) => t.RS.past[0]);
  const w = [0, 0, 0]; prevs.forEach((q) => w[q.w]++);
  const mean = (f) => ts.reduce((a, t) => a + f(t), 0) / ts.length;
  const sp0 = mean((t) => t.RS.past[0].sp[0]), del0 = mean((t) => t.got[0]), spO = mean((t) => (t.RS.past[0].sp[1] + t.RS.past[0].sp[2]) / 2);
  const margin = prevs.map((q) => { const v = q.sp.slice().sort((a, b) => b - a); return (v[0] - v[1]) / v[0]; });
  const offs = ts.map((t) => t.RS.realms.map((R) => [R.stats.offensives, R.stats.won]));
  cr[name] = { P, wins: w, place0: mean((t) => (t.final ? t.final.indexOf(0) + 1 : 2)), sp0: Math.round(sp0), del0: Math.round(del0), spO: Math.round(spO), share: del0 / Math.max(1, sp0), margin: margin.reduce((a, b) => a + b, 0) / margin.length, close: margin.filter((m) => m < 0.25).length, offs: offs.reduce((a, o) => a + o[0][0] + o[1][0] + o[2][0], 0) / ts.length, offWon: offs.reduce((a, o) => a + o[0][1] + o[1][1] + o[2][1], 0) / ts.length, made0: mean((t) => t.RS.realms[0].stats.made), madeO: mean((t) => (t.RS.realms[1].stats.made + t.RS.realms[2].stats.made) / 2) };
  const c = cr[name];
  console.log(`crowd ${name.padEnd(6)} ${P.join('/').padEnd(8)} wins ${w.join('/')}  Logres's mean place ${c.place0.toFixed(2)}, points ${c.sp0} (the others ${c.spO}), of which deliveries ${c.del0} (${(c.share * 100).toFixed(0)}%), works ${c.made0.toFixed(0)} (the others ${c.madeO.toFixed(0)}); margin ${(c.margin * 100).toFixed(0)}%, close ${c.close}/${SEEDS}; offensives a season ${c.offs.toFixed(1)}, ${c.offWon.toFixed(1)} won`);
}
console.log(`crowds: ${((Date.now() - t1) / 1000).toFixed(1)} s`);
check(cr.ten.wins[0] < SEEDS && cr.twenty.wins[0] < SEEDS, `a realm of ten or twenty players against two and two does not win every season (${cr.ten.wins[0]} and ${cr.twenty.wins[0]} of ${SEEDS})`);
check(cr.twenty.share < 0.35, `deliveries are under a third of a crowd's season points (${(cr.twenty.share * 100).toFixed(0)}% for twenty players a day)`);
check(cr.twenty.del0 < cr.ten.del0 * 1.25, `twenty players' deliveries count barely more than ten's (${cr.twenty.del0} and ${cr.ten.del0} points)`);
check(cr.ten.place0 <= cr.even.place0 + 0.01, `but a realm with more players does place better (${cr.ten.place0.toFixed(2)} against ${cr.even.place0.toFixed(2)})`);
check(cr.many.close >= SEEDS / 2 && cr.even.close >= SEEDS / 2, `even realms stay close at the top (${cr.even.close} and ${cr.many.close} of ${SEEDS} within a quarter)`);
// [season2] the field contract: an army on a page's field is the page's; told back; folded unheard
{
  const F = M.realmSimInit(7); M.realmSimStep(F, 8 * DAY);
  F.realms[2].lev = 40; F.realms[2].aim = 0;
  M.realmSimOrder(F, 2, { type: 'muster' }, { name: 'o', rank: 9 });
  const A = F.armies.find((q) => q.r === 2 && q.k === 0);
  const d = A && M.realmSimFieldTake(F, A.id, 'peer:a');
  check(d && d.n === A.n && !M.realmSimFieldTake(F, A.id, 'peer:b'), 'an army taken onto a page\'s field is that page\'s alone (never two of one army)');
  const p0 = A.p; M.realmSimStep(F, 60); check(A.p === p0, 'RS steps it no further while it is there');
  M.realmSimFieldReport(F, A.id, { n: A.n - 6, p: 0.5 }, 'peer:a'); check(A.n === d.n - 6 && A.p === 0.5, 'its losses and its road told back');
  check(!M.realmSimFieldReport(F, A.id, { n: 0 }, 'peer:b') && A.n === d.n - 6, 'a page that does not hold it is not heard');
  M.realmSimFieldReport(F, A.id, { n: A.n + 50 }, 'peer:a'); check(A.n === d.n - 6, 'an army never grows on the field');
  M.realmSimStep(F, M.RSM.field.stale + 120); check(!A.onField && A.p > 0.5, 'unheard longer than its time, it is folded back and marches on');
  const B2 = M.realmSimFieldTake(F, A.id, 'peer:c'), sp1 = F.realms[0].sp;
  M.realmSimFieldReport(F, A.id, { n: 0, done: 'fallen' }, 'peer:c');
  check(B2 && !F.armies.includes(A), 'cut down in the field, it is gone from the season');
  const G = M.realmSimInit(8); M.realmSimStep(G, 8 * DAY); G.realms[1].lev = 40; G.realms[1].aim = 1; M.realmSimOrder(G, 1, { type: 'muster' }, { name: 'o', rank: 9 });
  const A2 = G.armies.find((q) => q.r === 1 && q.k === 1); M.realmSimFieldTake(G, A2.id, 'page');
  M.realmSimFieldReport(G, A2.id, { n: A2.n, state: 'siege' }, 'page'); const sieged = G.keeps[1].siege && G.keeps[1].siege.a === A2.id;
  M.realmSimFieldReport(G, A2.id, { n: A2.n - 3, done: 'taken' }, 'page');
  check(sieged && G.keeps[1].h === 1 && !G.armies.includes(A2) && G.keeps[1].g >= 3, `its siege laid and the keep taken in the field: taken in the season, the army into its garrison (${G.keeps[1].g.toFixed(1)})`);
  check(M.realmSimFieldFold(F, 'nobody') === 0, 'folding a page that holds nothing folds nothing');
}
if (JSONOUT) require('fs').writeFileSync(JSONOUT, JSON.stringify({ ms, caps, wins, changes, margins, crowds: cr, place: { none: place(none), d3: place(d3), d1: place(d1) } }, null, 1));
console.log(fails.length ? `FAILED ${fails.length}: ${fails.join('; ')}` : 'all passed');
process.exit(fails.length ? 1 : 0);
