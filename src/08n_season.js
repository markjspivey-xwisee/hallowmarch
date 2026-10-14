// [loops] The season in the page (version 19): the realms' strategic life (08m_realm.js, RS) wired to the live war,
// the stores and the player. While you play, the page's own war and stores run and RS keeps the clock, the phases,
// the season points, the projects and the offensives (the stores are copied into RS before each step and back after);
// while you are away RS alone runs the war, and on your return it is stepped by the real time that passed (at most
// three weeks) and you are told what happened: on the title, in a banner and on the Chronicle's Season page.

const SEASONP = {
  rs: null, pend: undefined, ln: 0, mute: false, away: null, said: {},
  days: RSM.days, maxAway: 21 * 86400,
  you: { pts: 0, gold: 0, votes: 0, n: 0, won: 0, last: 0 }, // the player's part (saved with the character; won: seasons your realm won, last: the season last reckoned with you)
  stats: { applied: 0, liveCaps: 0, battles: 0, offline: 0, offlineS: 0, offlineMs: 0, aims: 0, braces: 0, relayed: 0, gave: 0 },
};
const seasonMe = () => (GAME.player ? GAME.player.faction : 0);
function seasonNames() { return { realms: REALMS.map((R) => R.name), keeps: WAR.keeps.map((K) => K.site.name) }; }

// the stores: the live economy's (08m_loops.js) into RS and back
function seasonCopyIn(RS) {
  if (typeof LOOPS === 'undefined') return;
  for (let r = 0; r < 3; r++) for (let g = 0; g < 7; g++) { const v = LOOPS.r[r][LOOPS_R[g]]; if (Number.isFinite(v)) RS.realms[r].s[g] = v; }
}
function seasonCopyOut(RS) {
  if (typeof LOOPS === 'undefined') return;
  for (let r = 0; r < 3; r++) for (let g = 0; g < 7; g++) LOOPS.r[r][LOOPS_R[g]] = Math.max(0, RS.realms[r].s[g]);
}

function seasonInit() {
  if (SEASONP.rs || !WAR.keeps.length || !GAME.player) return;
  const names = seasonNames(), homes = WAR.keeps.map((K) => K.orig);
  const d = SEASONP.pend;
  SEASONP.pend = undefined;
  let RS = null, el = 0;
  if (d && d.rs) {
    RS = realmSimSanitize(d.rs, { names, keeps: homes });
    if (RS.keeps.length !== WAR.keeps.length) RS = null;
    else { RS.names = names; el = clamp((Date.now() - (Number.isFinite(+d.real) ? +d.real : Date.now())) / 1000, 0, SEASONP.maxAway); }
  }
  if (!RS) RS = realmSimInit((Date.now() ^ 0x5eed) >>> 0, { names, keeps: homes, t0: Date.now(), days: SEASONP.days });
  SEASONP.rs = RS;
  if (el > 120) seasonAway(el);
  SEASONP.ln = RS.ln || 0;
  seasonApplyKeeps();
}
// RS stepped by the real time that passed while nobody played (the strategic war runs: armies, sieges, raids)
function seasonAway(el) {
  const RS = SEASONP.rs, me = seasonMe(), since = RS.t, t0 = performance.now();
  seasonCopyIn(RS);
  RS.live = false;
  realmSimStep(RS, el);
  seasonCopyOut(RS);
  SEASONP.stats.offline++; SEASONP.stats.offlineS += el; SEASONP.stats.offlineMs += performance.now() - t0;
  seasonApplyKeeps();
  // a reckoning passed while away: the season's winner told (and paid, if yours)
  if (RS.phase === 'reckon' && RS.winner != null) seasonReckoned(RS.n, RS.winner, true);
  for (const p of RS.past) if (p.n > SEASONP.you.last && p.n < RS.n) seasonReckoned(p.n, p.w, true);
  const sum = realmSimSummary(RS, me, since);
  SEASONP.away = { el, since, at: GAME.t, sum };
  const text = seasonAwayText(sum, el);
  later(4, () => { if (GAME.player) { uiBanner(text, me); uiLog(text, 'realm', me); } });
}
function seasonAwayText(sum, el) {
  const bits = sum.lines.filter((x) => !/^While you were away/.test(x)).slice(-3);
  return `While you were away (${rsmDur(el)}): ${bits.length ? bits.join(' ') : 'the March held its breath.'} ${seasonClockText(sum)}`;
}
const SEASON_PHASE = { muster: 'the muster', war: 'the war', reckon: 'the reckoning' };
function seasonClockText(sum) {
  return `Season ${sum.n}, ${SEASON_PHASE[sum.phase]}, day ${sum.day} of ${sum.days}: ${sum.clock}.`;
}

// a keep the season gives to another realm than the live war shows (after time away, or a battle's end in the war)
function seasonGiveKeep(K, realm) {
  for (const id of K.guards) { const g = getEnt(id); if (g) removeEnt(g); }
  K.guards.clear();
  const Lr = getEnt(K.lord);
  if (Lr) removeEnt(Lr);
  K.lord = null;
  K.realm = realm;
  setSiteBanners(K.site, realm);
  fillGarrison(K, true);
  K.underSiegeUntil = -99; K.lastOwnerChange = GAME.t;
  setDoorState(K.door, true, 1);
  K.door.faction = realm; if (K.site.door) K.site.door.owner = realm;
  SEASONP.stats.applied++;
}
function seasonApplyKeeps() {
  const RS = SEASONP.rs;
  if (!RS || RS.phase !== 'war') return;
  for (const K of WAR.keeps) { const Q = RS.keeps[K.id]; if (Q && Q.h !== K.realm) seasonGiveKeep(K, Q.h); }
  // the hallows resting in a temple: where the season has them
  let moved = false;
  for (const rel of WAR.relics) {
    const d = RS.hallows[rel.realm];
    if (rel.state !== 'temple' || d == null || rel.at === d) continue;
    rel.at = d; rel.from = d; rel.slot = d === rel.realm ? 'home' : freeTrophySlot(WAR.temples[d]); moved = true;
  }
  if (moved) updateRelicBonuses();
}
// a hallow placed in a temple in the field, told to the season (in its war)
function seasonHallowsIn(RS) {
  if (RS.phase !== 'war') return;
  for (const rel of WAR.relics) if (rel.state === 'temple' && RS.hallows[rel.realm] !== rel.at) realmSimLive(RS, { type: 'hallow', hallow: rel.realm, holder: rel.at });
}
// the peace of a battle in the war: a keep the season holds for its taker stays its (08g_campaign.js restoreKeep, 08l_war4.js war4HandBack)
function seasonKeepStays(K) {
  const RS = SEASONP.rs;
  return !!RS && RS.phase === 'war' && !!RS.keeps[K.id] && RS.keeps[K.id].h === K.realm && K.realm !== K.orig;
}
function seasonAfterReset() { seasonApplyKeeps(); }
function seasonKeepsHeld() { const RS = SEASONP.rs; return !!RS && RS.phase === 'war'; }
// the live war's news into the season
function seasonOnCapture(K, realm) {
  const RS = SEASONP.rs;
  if (!RS) return;
  SEASONP.mute = true;
  try { realmSimLive(RS, { type: 'keep', keep: K.id, holder: realm }); } finally { SEASONP.mute = false; }
  SEASONP.ln = RS.ln; // (the live war has told it)
  if (RS.phase === 'war') SEASONP.stats.liveCaps++;
  else if (RS.phase === 'muster' && GAME.player) uiLog(`The muster: ${K.site.name} is taken only for this battle, and goes back to ${REALMS[K.orig].name} when it ends. No keep falls for the season until the war.`, 'realm', realm);
}
function seasonOnBattle(r) {
  const RS = SEASONP.rs;
  if (!RS) return;
  realmSimLive(RS, { type: 'battle', winner: r });
  SEASONP.ln = RS.ln;
  SEASONP.stats.battles++;
}
// a live offensive: its realm's bands go for the keep it announced; the holder's brace it (08k_war3.js war3Choose)
function seasonLiveOff(r) { const RS = SEASONP.rs; return RS ? RS.offs.find((O) => O.r === r && O.state === 'live') : null; }
function seasonChoose(wb, r, C, L) {
  const RS = SEASONP.rs;
  if (!RS || RS.phase !== 'war' || CAMPAIGN.state !== 'war') return;
  // an offensive whose day has come, or a siege the season's armies were laying while nobody played: its keep
  const O = seasonLiveOff(r), sieges = RS.armies.filter((A) => A.state === 'siege' && A.r === r).map((A) => A.k);
  for (const c of C) if (c.o.type === 'attack' && ((O && c.o.keep.id === O.k) || sieges.includes(c.o.keep.id))) { c.s += O && c.o.keep.id === O.k ? 30 : 20; c.why = 'offensive'; SEASONP.stats.aims++; }
  const against = RS.offs.filter((Q) => Q.state === 'live').map((Q) => ({ r: Q.r, k: Q.k })).concat(RS.armies.filter((A) => A.state === 'siege').map((A) => ({ r: A.r, k: A.k })));
  for (const Q of against) {
    if (Q.r === r) continue;
    const K = WAR.keeps[Q.k];
    if (!K || K.realm !== r) continue;
    if (WAR.warbands.some((w) => !w.dead && w.realm === r && w.order && w.order.keep === K && w.order.type === 'defend')) continue;
    C.push({ s: 90 - dist(L.x, L.z, K.site.x, K.site.z) / 16, o: { type: 'defend', keep: K, since: GAME.t + 90, foe: Q.r }, why: 'brace' });
    SEASONP.stats.braces++;
  }
}
// the reckoning: your realm's season won pays its people and is a deed of the veteran's (the name 'of the Long War')
function seasonReckoned(n, w, quiet) {
  const P = GAME.player, prog = GAME.prog, Y = SEASONP.you;
  if (!P || !prog || Y.last >= n) return;
  Y.last = n;
  if (w !== P.faction) { if (!quiet) uiLog(`The ${ordinalWord(n)} season went to ${REALMS[w].name}. The next will be won by holding and preparing.`, 'realm', w); return; }
  Y.won++;
  const L = prog.level, rp = 2500 + 60 * L, gold = 300 + 20 * L;
  addRP(rp); addGold(gold);
  if (typeof late2Deed === 'function' && LATE2.d.season != null) late2Deed('season');
  const txt = `${REALMS[w].name} has won the ${ordinalWord(n)} season! Your share: ${fmtInt(rp)} realm points and ${fmtInt(gold)} gold.`;
  uiLog(txt, 'rp');
  if (!quiet) uiBanner(txt, w);
  saveSoon();
}
// a keep's walls raised a tier in the season: its gate and walls take a fifth less from each tier (07_entities.js
// dealDamage, 04g_castles.js castleSiegeHit)
function seasonGateK(door) {
  const RS = SEASONP.rs, K = door && door.keepRef;
  if (!RS || !K || !RS.keeps[K.id]) return 1;
  return 1 / (1 + 0.25 * RS.keeps[K.id].tier);
}
// the realm's catch-up and its yard in the live work (08m_loops.js loopsProduce)
function seasonProdK(r, g) {
  const RS = SEASONP.rs;
  if (!RS) return 1;
  const R = RS.realms[r];
  return (g === 'horses' ? 1 + 0.6 * R.proj.yard : 1) * (1 + RSM.catchUp * rsmBehind(RS, r));
}

function updateSeason(dt) {
  seasonInit();
  const RS = SEASONP.rs;
  if (!RS) return;
  seasonCopyIn(RS);
  RS.live = true;
  const ph = RS.phase;
  realmSimStep(RS, dt);
  seasonCopyOut(RS);
  if (ph !== RS.phase) seasonApplyKeeps(); // (the war begins: the muster's skirmishes are over, the keeps as the season holds them)
  if (ph === 'war' && RS.phase === 'reckon' && RS.winner != null) seasonReckoned(RS.n, RS.winner, false);
  SEASONP.hallowT = (SEASONP.hallowT || 0) + dt;
  if (SEASONP.hallowT >= 1) { SEASONP.hallowT = 0; seasonHallowsIn(RS); }
  // the season's own news: told as the war's
  if ((RS.ln || 0) > SEASONP.ln) {
    const n = Math.min(RS.ln - SEASONP.ln, RS.log.length);
    for (const L of RS.log.slice(RS.log.length - n)) {
      if (L.k === 'proj' && L.r !== seasonMe()) continue;
      news(L.x, L.r, L.k === 'big' ? 'big' : 'normal');
      SEASONP.stats.relayed++;
    }
    SEASONP.ln = RS.ln;
  }
}

/* ------------------------------------------------------------------ */
/* the player's part                                                   */
/* ------------------------------------------------------------------ */
// a delivery at the quartermaster or a keep's hall (08m_loops.js loopsDeliver): it counts for the realm's season
function seasonDelivered(r, g, units) {
  seasonInit();
  const RS = SEASONP.rs, P = GAME.player;
  if (!RS || !(units > 0)) return 0;
  const pts = realmSimContribute(RS, r, g, units, P ? P.name : 'you');
  SEASONP.you.pts += pts; SEASONP.you.n++;
  return pts;
}
function seasonGiveGold(n) {
  seasonInit();
  const RS = SEASONP.rs, P = GAME.player;
  if (!RS || !P || !(n > 0) || INV.gold < n) return false;
  if (!spendGold(n)) return false;
  const pts = realmSimContribute(RS, P.faction, 'gold', n, P.name);
  SEASONP.you.pts += pts; SEASONP.you.gold += n; SEASONP.stats.gave++;
  if (typeof GUIDE !== 'undefined') GUIDE.made.push('fund'); // (the path's step: 10c_lore.js)
  uiToast(`You give ${fmtInt(n)} gold to ${possessive(REALMS[P.faction].name)} treasury (${pts.toFixed(1)} season points).`);
  saveSoon();
  return true;
}
function seasonRank() { return GAME.prog ? realmRank(GAME.prog.rp || 0) : 1; }
function seasonVote(id) {
  seasonInit();
  const RS = SEASONP.rs, P = GAME.player;
  if (!RS || !P) return false;
  const ok = realmSimOrder(RS, P.faction, { type: 'project', id }, { name: P.name, rank: seasonRank() });
  if (ok && typeof GUIDE !== 'undefined') GUIDE.made.push('fund');
  if (ok) { SEASONP.you.votes++; uiToast(seasonRank() >= 5 ? `As an officer of the realm you set its work: ${RSM.projects[id].name}.` : `Your voice is counted for ${RSM.projects[id].name}.`); saveSoon(); }
  return ok;
}
function seasonAim(k) {
  seasonInit();
  const RS = SEASONP.rs, P = GAME.player;
  if (!RS || !P) return false;
  const ok = realmSimOrder(RS, P.faction, { type: 'target', keep: k }, { name: P.name, rank: seasonRank() });
  if (ok) { uiToast(`You name ${WAR.keeps[k].site.name} for the realm's next offensive.`); saveSoon(); }
  return ok;
}

/* ------------------------------------------------------------------ */
/* what players are told                                               */
/* ------------------------------------------------------------------ */
// the war panel's line: the season's clock and standing, an offensive near (08m_loops.js loopsHudLine)
function seasonHudLine() {
  seasonInit();
  const RS = SEASONP.rs;
  if (!RS || !GAME.player) return '';
  const me = seasonMe(), sum = realmSimSummary(RS, me);
  const pts = [0, 1, 2].map((r) => `<span style="--rc:${REALMS[r].color}"${r === me ? ' class="me"' : ''}>${REALMS[r].name} ${fmtInt(sum.sp[r])}</span>`).join(' ');
  let off = '';
  const O = sum.offs.filter((q) => q.ours || q.against).sort((a, b) => a.inS - b.inS)[0];
  if (O) off = `<div class="season-off">${O.state === 'planned' ? `${REALMS[O.r].name} marches on ${O.keep} in ${rsmDur(O.inS)}` : `${REALMS[O.r].name}'s offensive on ${O.keep} is under way`}</div>`;
  return `<div class="season-hud"><b>Season ${sum.n} · ${capFirst(SEASON_PHASE[sum.phase].replace('the ', ''))}</b> day ${sum.day}/${sum.days}, ${sum.clock} · ${pts}${off}</div>`;
}
// a sentence for the herald and the war table
function seasonWarText(r) {
  seasonInit();
  const RS = SEASONP.rs;
  if (!RS) return '';
  const sum = realmSimSummary(RS, r);
  const O = sum.offs.find((q) => q.against);
  return `${seasonClockText(sum)} ${REALMS[r].name} stands ${ordinalWord(sum.place)} with ${fmtInt(sum.sp[r])} season points.${O ? ` ${REALMS[O.r].name} has announced an offensive on ${O.keep}: ${O.state === 'planned' ? `it marches in ${rsmDur(O.inS)}` : 'its bands are on the march'}.` : ''}${sum.project ? ` The realm's work: ${sum.project.name} (${sum.project.prog}%).` : ''}`;
}
const SEASON_PROJ_X = {
  walls: 'a keep of ours (the one an offensive is named against first) stands far harder',
  granary: 'half as much food again stored, the soldiers hungry later',
  yard: 'more horses for the captains and riders',
  smithy: 'the levies better armed, and more of them',
  engines: 'the realm marches with them on its offensive\'s day',
};
function chronSeason() {
  seasonInit();
  const RS = SEASONP.rs, P = GAME.player;
  if (!RS || !P) return '<p class="lead">The season begins once you are in the March.</p>';
  const me = P.faction, sum = realmSimSummary(RS, me, SEASONP.away ? SEASONP.away.since : -1), R = RS.realms[me];
  const order = [0, 1, 2].sort((a, b) => sum.sp[b] - sum.sp[a]);
  const stand = order.map((r, i) => `<li style="--rc:${REALMS[r].color}"><b>${ordinalWord(i + 1)}: ${REALMS[r].name}</b> ${fmtInt(sum.sp[r])} points, ${RS.keeps.filter((K) => K.h === r).length} keeps${r === me ? ' (yours)' : ''}</li>`).join('');
  const offs = sum.offs.map((O) => `<li><b>${REALMS[O.r].name}</b> on ${O.keep}: ${O.state === 'planned' ? `in ${rsmDur(O.inS)}` : 'under way'}${O.against ? ' <b>(against us)</b>' : ''}</li>`).join('');
  const officer = seasonRank() >= 5;
  // the works: one line each, a button to vote (or, an officer, to set it)
  const projs = RSM_PROJ.map((id) => {
    const P0 = RSM.projects[id], built = R.proj[id], act = R.act === id;
    const full = id !== 'walls' && built >= P0.max;
    return `<li${act ? ' class="on"' : ''}><b>${capFirst(P0.name)}</b>${built ? ` (${built})` : ''}<small>${SEASON_PROJ_X[id]}</small>${act ? `<span class="l2-tag">At work: ${sum.project.prog}%</span>` : full ? '<span class="l2-tag">Done</span>' : `<button type="button" class="btn season-btn" data-season="proj:${id}">${officer ? 'Set the realm to it' : 'Vote for it'}${R.votes[id] ? ` (${Math.round(R.votes[id])})` : ''}</button>`}</li>`;
  }).join('');
  const wants = RSM_PROJ.map((id) => `<li><b>${capFirst(RSM.projects[id].name)}</b>: ${RSM.projects[id].cost.map((v, g) => (v ? `${fmtInt(v)} ${RSM_GOODS[g]}` : '')).filter(Boolean).join(', ')}</li>`).join('');
  const aims = officer ? `<div class="acts">${RS.keeps.map((K, k) => (K.h !== me ? `<button type="button" class="btn season-btn" data-season="aim:${k}">${R.aim === k ? 'Named: ' : 'Name '}${esc(WAR.keeps[k].site.name)}</button>` : '')).join('')}</div>` : '<p>From realm rank 5 you are an officer of the realm: you set its work and name the keep for its next offensive.</p>';
  const gold = [100, 500].map((n) => `<button type="button" class="btn season-btn" data-season="gold:${n}"${INV.gold >= n ? '' : ' disabled'}>Give ${n} gold</button>`).join('');
  const news = RS.log.filter((L) => L.r === me || L.r === -1 || L.k === 'big').slice(-8).reverse().map((L) => `<li><small>day ${Math.floor(L.t / 86400) + 1}</small> ${esc(L.x)}</li>`).join('');
  const past = RS.past.slice(-4).reverse().map((p) => `<li>Season ${p.n}: <b>${REALMS[p.w].name}</b> (${p.sp.map((v, r) => `${REALMS[r].name} ${fmtInt(v)}`).join(', ')})</li>`).join('');
  const y = SEASONP.you;
  return `<p class="lead">The war is a season of ${sum.days} days: the muster (a week of building and skirmishes: no keep falls for the season), the war (keeps and hallows change hands; offensives are announced days ahead), the reckoning (the most season points wins). The realms live on while you are away.</p>
    <div class="now"><p><b>${seasonClockText(sum)}</b></p><ol class="plain season-stand">${stand}</ol>
    ${offs ? `<ul class="plain">${offs}</ul>` : ''}
    ${SEASONP.away ? `<p><b>While you were away (${rsmDur(SEASONP.away.el)}):</b> ${esc(SEASONP.away.sum.lines.filter((x) => !/^While/.test(x)).slice(-3).join(' '))}</p>` : ''}</div>
    <h3 data-cf-open>The realm's work</h3><p>${REALMS[me].name} pours its stores into one work at a time. ${officer ? 'You are an officer: your word sets it.' : 'Vote for the next.'} Gold to the treasury buys what the work lacks at the border fairs${y.pts ? `; you have given ${y.pts.toFixed(1)} season points` : ''}.</p>
    <div class="acts">${gold}</div><ul class="gd-aims season-proj">${projs}</ul>
    <h3>Season points</h3><p>Each hour of the war a realm's own keep counts ${RSM.sp.own}, a keep taken ${RSM.sp.won}, an enemy hallow in its temple ${RSM.sp.hallow}. A work finished ${RSM.sp.project} (a tier of walls ${RSM.sp.tier}), an offensive that takes its keep ${RSM.sp.offensive} (beaten off, ${Math.round(RSM.sp.offensive * 0.6)} to the defender), a battle won ${RSM.sp.battle}, every ${RSM.sp.units} units delivered one. A realm behind works harder and its walls stand stronger, and the others turn on the leader.</p>
    <h3>Offensives</h3><p>An offensive is announced about two days ahead: the realm marches with everything it trained and every engine it stockpiled. Defend the keep named: raise its walls, fill its stores, be there.</p>${aims}
    <h3>What each work wants</h3><ul class="plain">${wants}</ul>
    <h3>The season's news</h3><ul class="plain season-news">${news || '<li>Nothing yet.</li>'}</ul>
    ${past ? `<h3>Seasons past</h3><ul class="plain">${past}</ul>` : ''}`;
}
registerSavePart('world', 'realm', {
  save() { return SEASONP.rs ? { rs: SEASONP.rs, real: Date.now() } : SEASONP.pend || null; },
  load(d) { SEASONP.rs = null; SEASONP.away = null; SEASONP.pend = d && typeof d === 'object' ? d : undefined; },
  // a change worth writing: the phase, the hour, the keeps' holders, the points in tens, the projects
  key: (d) => (d && d.rs ? [d.rs.n, d.rs.phase, Math.floor((d.rs.t || 0) / 3600), (d.rs.keeps || []).map((K) => K.h), (d.rs.realms || []).map((R) => [Math.round((R.sp || 0) / 10), R.act, Math.round((R.prog || 0) * 20)])] : null),
});
registerSavePart('char', 'season', {
  save() { const y = SEASONP.you; return y.n || y.gold || y.votes || y.last ? { p: Math.round(y.pts * 10) / 10, g: Math.round(y.gold), v: y.votes, n: y.n, w: y.won, l: y.last } : null; },
  load(d) { const o = d && typeof d === 'object' ? d : {}, n = (v, c) => (Number.isFinite(+v) ? clamp(+v, 0, c) : 0); SEASONP.you = { pts: n(o.p, 1e7), gold: n(o.g, 1e10), votes: n(o.v, 1e6) | 0, n: n(o.n, 1e7) | 0, won: n(o.w, 1e6) | 0, last: n(o.l, 1e6) | 0 }; },
  key: (d) => (d ? [Math.round(d.p), d.g, d.v] : null),
});

// the title: the season as it stands, stepped by the time away (a copy: the game steps its own on loading)
function seasonTitleText(save) {
  try {
    const d = save && save.world && save.world.x && save.world.x.realm;
    if (!d || !d.rs) return '';
    const RS = realmSimSanitize(JSON.parse(JSON.stringify(d.rs)));
    const el = clamp((Date.now() - (+d.real || Date.now())) / 1000, 0, SEASONP.maxAway), since = RS.t;
    if (el > 120) realmSimStep(RS, el);
    const r = save.char ? save.char.realm : 0, sum = realmSimSummary(RS, r, since);
    const bits = sum.lines.filter((x) => !/^While you were away/.test(x)).slice(-2);
    return `${seasonClockText(sum)} ${REALMS[r].name} stands ${ordinalWord(sum.place)}.${el > 120 ? ` While you were away (${rsmDur(el)}): ${bits.join(' ') || 'quiet.'}` : ''}`;
  } catch (err) { reportError(err); return ''; }
}

queueMicrotask(() => $('menu-body').addEventListener('click', (ev) => { // ($ is 10_ui.js's)
  const b = ev.target.closest('.chron [data-season]');
  if (!b || b.disabled) return;
  const [act, id] = b.dataset.season.split(':');
  let ok = false;
  if (act === 'proj') ok = seasonVote(id);
  else if (act === 'gold') ok = seasonGiveGold(+id);
  else if (act === 'aim') ok = seasonAim(+id);
  if (ok) { sfx('click'); renderChronicle($('menu-body'), true); }
}));

queueMicrotask(() => { // (CHRON, FIELD_NOTES, GUIDE_WATCH, GUIDE_HELP and LOADING_TIPS are declared by later modules)
  chronAdd('season', 'Season', 'war', chronSeason, 'stores');
  // the veteran's deed and name for a season won (10l_late.js, 04_l3device.js)
  if (typeof LATE2 !== 'undefined' && !LATE2_DEEDS.season) {
    LATE2_DEEDS.season = 'Seasons won with your realm'; LATE2.d.season = 0;
    const N = { id: 'longwar', t: 'of the Long War', deed: 'season', n: 1, rp: 2500, k: { rp: 0.08 }, gift: 'You win 8% more realm points.' };
    LATE2_NAMES.push(N); LATE2_BY_ID[N.id] = N;
    if (typeof L3_DEVICE_OF !== 'undefined') L3_DEVICE_OF.season = 4;
  }
  if (typeof G2_SEE !== 'undefined') G2_SEE.season = ['stores', 'war'];
  Object.assign(FIELD_NOTES, {
    lseason: { t: 'A season of weeks', x: (R) => `The war is fought over a season of ${SEASONP.days} days: the muster (skirmishes: no keep falls for the season), the war, the reckoning. Keeps and hallows held, projects built and goods delivered win it; the realms live on while you are away. The Chronicle's Season page.` },
    loffensive: { t: 'An offensive is coming', x: (R) => `An offensive is announced against a keep of ${R.name}. Raise its walls, fill its stores, and be there when it comes: the war panel counts it down.` },
  });
  GUIDE_WATCH.lseason = (P) => !!SEASONP.rs && GAME.prog.level >= 4;
  GUIDE_WATCH.loffensive = (P) => !!SEASONP.rs && SEASONP.rs.offs.some((O) => O.state === 'planned' && SEASONP.rs.keeps[O.k].h === P.faction);
  GUIDE_HELP.push(() => `<h3>The season</h3><p>The war is a season of ${SEASONP.days} days: the muster, the war, the reckoning. Each hour a keep or an enemy hallow held earns its realm season points, and so do projects built, offensives won and goods delivered. Offensives are announced days ahead. Your realm votes on its work (officers from realm rank 5 set it); give gold to its treasury on the Chronicle's Season page. The realms live on while you are away, and you are told what happened when you return.</p>`);
  // the path: the realm's work funded (pv 3, with the stores' steps: 08m_loops.js)
  const S = { id: 'fund', lv: 10, old: 18, pv: 3, title: "Fund the realm's work", short: "Fund the realm's work",
    hint: (R) => `${R.name} pours its stores into one work at a time: walls, a granary, a yard, a smithy, siege engines. On the Chronicle's Season page give gold to its treasury, or vote for the next work.`,
    reward: { gold: (L) => 40 + L * 4 } };
  if (!PATH_BY_ID[S.id]) { const i = PATH_STEPS.findIndex((q) => q.lv > S.lv); PATH_STEPS.splice(i < 0 ? PATH_STEPS.length : i, 0, S); PATH_BY_ID[S.id] = S; PATH_STEPS.forEach((q, j) => { q.idx = j; }); }
  LOADING_TIPS.push('A season lasts weeks: the realm that holds and prepares best wins it, not the one that wins an hour.', 'Offensives are announced days ahead on the war panel: raise the walls of the keep named and be there when it comes.', 'The realms live on while you are away: the Chronicle\'s Season page tells what happened.');
});
queueMicrotask(() => {
  if (!window.__hm) return;
  window.__hm.season = {
    SEASONP, RSM, rs: () => { seasonInit(); return SEASONP.rs; }, summary: (r) => (SEASONP.rs ? realmSimSummary(SEASONP.rs, r == null ? seasonMe() : r) : null),
    // tests: the season run on as if nobody had played for `sec` (RS alone)
    away: (sec) => { if (!SEASONP.rs) seasonInit(); if (SEASONP.rs) seasonAway(sec); return SEASONP.away ? SEASONP.away.sum : null; },
    apply: seasonApplyKeeps, seasonHallowsIn, seasonGiveKeep, seasonKeepStays, seasonDelivered, seasonReckoned, seasonGiveGold, seasonVote, seasonAim, seasonHudLine, seasonWarText, seasonTitleText, chronSeason, seasonProdK, seasonGateK, seasonChoose, updateSeason, realmSimInit, realmSimStep, realmSimContribute, realmSimOrder, realmSimSummary, realmSimSanitize, realmSimLive,
  };
});
