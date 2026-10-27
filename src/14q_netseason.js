/* ================================================================== */
/* [net] the season: the realms' life on the server, told and fed     */
/* ================================================================== */
// With the March's own server (14p_netws.js), the three realms share one strategic state. The server steps it only
// while human players are active; an empty March stays in standby without catching up unattended time. Every
// player of a realm sees it and feeds it. Here: what the server tells (`season`: its day and phase, the keeps and who
// holds them, the realm's stores, its works and votes, its armies, the news; the realm's roster, who is on now and who was
// today; on the first telling what happened while you were away and the realm's chat), the keeps' holders taken into the
// live war (only by the page that keeps the shared war, only what the season changed since it last said), the realm's
// stores laid into loops's stores when they are here, the player's deliveries (the Season page's "Bring your goods", or
// loops's own deliveries at a quartermaster: told to the server, which takes what one could have gathered) and votes (a
// work, a target, an officer's muster), the war panel's line, the Season page of the Chronicle, a field note, help and
// tips. Alone (no server) none of it runs and the page plays exactly as before.
const NETS = { s: null, roster: null, k: null, at: 0, first: false, away: -1, q: 0, waits: new Map(), given: {}, chat: [], busy: false, noted: false, told: false, stats: { msgs: 0, keepsApplied: 0, stores: 0, contribs: 0, took: 0, refused: 0, orders: 0 } };
const NETS_PHASE = { build: 'Building', war: 'War', final: 'Final active week', over: 'Over' };
// what a carried good is worth to the realm's stores (loops's own table when it is here)
const NETS_WORTH = {
  grain: ['food', 1], flour: ['food', 2.2], bread: ['food', 1.4], meat_raw: ['food', 1], meat_cooked: ['food', 1.3], fish_raw: ['food', 0.8], fish_cooked: ['food', 1],
  egg: ['food', 0.4], milk: ['food', 0.5], cheese: ['food', 2], berries: ['food', 0.3], mushrooms: ['food', 0.4], apple: ['food', 0.4], cabbage: ['food', 1], turnip: ['food', 1], beans: ['food', 0.8],
  log: ['timber', 1], plank: ['timber', 0.4], firewood: ['timber', 0.25], stone: ['stone', 1], iron_ore: ['iron', 0.4], iron: ['iron', 1], grave_iron: ['iron', 2],
  hide: ['hides', 1], leather: ['hides', 1.3], wool: ['wool', 1], linen: ['wool', 1.2],
};
const netsWorth = () => (typeof LOOPS_WORTH !== 'undefined' ? LOOPS_WORTH : NETS_WORTH);
const netsOn = () => typeof NETWS !== 'undefined' && NETWS.state === 'on' && !!NETS.s;
const netsRealmName = (r) => (REALMS[r] ? REALMS[r].name : '?');
const netsKeepName = (i) => (WAR.keeps[i] ? WAR.keeps[i].site.name : 'keep ' + (i + 1));
function netsAgo(s) {
  s = Math.max(0, Math.round(s));
  if (s < 90) return s + ' s';
  if (s < 5400) return Math.round(s / 60) + ' min';
  if (s < 129600) return Math.round(s / 3600) + ' h';
  return Math.round(s / 86400) + ' days';
}
// a message of the season's kinds (14p_netws.js hands them here)
function netSeasonMsg(m) {
  if(m.t==='order'&&m.kind==='manage')netRealmManagementReceive(m);
  if(m.t==='order'&&m.kind==='logistics')netRealmLogisticsReceive(m);
  if(m.t==='order'&&m.kind==='view'){netRealmViewReceive(m);return;}
  if (m.t === 'contrib' || m.t === 'order') { const w = NETS.waits.get(m.q); if (w) { NETS.waits.delete(m.q); w(m); } return; }
  if (m.t !== 'season' || !m.s || typeof m.s !== 'object') return;
  NETS.stats.msgs++;
  const s = netsRead(m.s);
  if (!s) return;
  NETS.s = s; NETS.at = performance.now(); NETS.projectionKey=netRealmSeasonProjectionKey();
  NETS.roster = netsRoster(m.roster);
  if (m.wx && typeof m.wx === 'object' && JSON.stringify(m.wx).length < 4000) NETS.wx = m.wx; // weather2's systems from the server (kept, not read yet: for the integrator)
  if (m.first) { NETS.first = true; NETS.away = netNum(m.away, -1, 1e9); }
  if (Array.isArray(m.chat)) NETS.chat = m.chat.slice(-20).filter((L) => Array.isArray(L) && L.length === 3).map((L) => [netNum(L[0], 0, 1e15), netStr(L[1], 24), netStr(L[2], 140)]);
  if (GAME.started) netsApply(m.first);
  if(typeof realmLogisticsApplyProjection==='function')realmLogisticsApplyProjection();
  // (the Season page is drawn when it is opened and after the player's own deliveries and votes: drawn again at every
  // telling it faded in anew and lost its scroll)
}
// everything the server says is read and bounded (a season's news from the server is text, set as text)
function netsRead(o) {
  const s = { n: netNum(o.n, 1, 1e6), t: netNum(o.t, 0, 1e10), len: netNum(o.len, 600, 1e9), day: netNum(o.day, 1, 1e5), days: netNum(o.days, 1, 1e5), phase: NETS_PHASE[o.phase] ? o.phase : 'war', over: o.over ? 1 : 0, winner: NET_REALM_OK(o.winner) ? o.winner : -1 };
  s.pts = Array.isArray(o.pts) && o.pts.length === 3 ? o.pts.map((v) => netNum(v, 0, 1e12)) : [0, 0, 0];
  s.keeps = Array.isArray(o.keeps) ? o.keeps.slice(0, 16).map((K, i) => ({ i, r: NET_REALM_OK(K && K.r) ? K.r : -1, g: netNum(K && K.g, 0, 999), gate:netNum(K?.gate,0,1),tier:Math.floor(netNum(K?.tier,0,3)), siege: K && K.siege ? 1 : 0 })) : [];
  s.armies = Array.isArray(o.armies) ? o.armies.slice(0, 40).filter((A) => A && NET_REALM_OK(A.r)).map((A) => ({ id:Number.isSafeInteger(A.id)?A.id:null,kind:['raid','assault','offensive','hallow','company'].includes(A.kind)?A.kind:'assault',manual:A.manual===true,mission:['attack','defend'].includes(A.mission)?A.mission:'defend',k:netNum(A.k,-1,16),q:netNum(A.q,-1,3),fx:Number.isFinite(A.fx)?A.fx:null,fz:Number.isFinite(A.fz)?A.fz:null,arm:netNum(A.arm,0,10),eng:netNum(A.eng,0,10),r: A.r, n: netNum(A.n, 0, 9999), to: netNum(A.to, -1, 16), st: A.st === 'siege' ? 'siege' : 'march', x: netNum(A.x, -5000, 5000), z: netNum(A.z, -5000, 5000), f: A.f ? 1 : 0, off: A.off ? 1 : 0 })) : []; // [season2] f: on a page's field, off: an offensive's
  s.offs = Array.isArray(o.offs) ? o.offs.slice(0, 12).filter((O) => O && NET_REALM_OK(O.r)).map((O) => ({ r: O.r, k: netNum(O.k, -1, 16), state: O.state === 'planned' ? 'planned' : 'siege', inS: netNum(O.inS, 0, 1e9) })) : []; // [season2] the offensives announced
  s.st = o.st && typeof o.st === 'object' ? Object.fromEntries(['food', 'timber', 'stone', 'iron', 'hides', 'wool', 'horses'].map((g) => [g, netNum(o.st[g], 0, 1e9)])) : null;
  s.built = Array.isArray(o.built) ? o.built.slice(0, 12).map((x) => netStr(x, 24)) : [];
  s.proj = Array.isArray(o.proj) ? o.proj.slice(0, 12).filter((p) => p && typeof p.id === 'string').map((p) => ({ id: netStr(p.id, 24), label: netStr(p.label, 60), did: netStr(p.did, 80), built: !!p.built, votes: netNum(p.votes, 0, 1e9), need: netsGoods(p.need), have: netsGoods(p.have) })) : [];
  s.armyIds=Array.isArray(o.armyIds)&&o.armyIds.length<=40&&o.armyIds.every(Number.isSafeInteger)?[...new Set(o.armyIds)]:[];
  s.armyIdsComplete=o.armyIdsComplete===true&&Array.isArray(o.armyIds)&&s.armyIds.length===o.armyIds.length;
  s.works=Array.isArray(o.works)&&o.works.length===3?o.works.map((q,r)=>({r,hungry:netNum(q?.hungry,0,48),...Object.fromEntries(['walls','granary','yard','smithy','engines'].map(k=>[k,Math.floor(netNum(q?.[k],0,4))]))})):null;
  s.management=netRealmManagementRead(o.management);
  s.logistics=netRealmLogisticsRead(o.logistics);s.repairs=s.logistics?.repairs||[];
  s.target = netNum(o.target, -1, 16);
  s.levyIn = netNum(o.levyIn, 0, 1e9);
  s.news = Array.isArray(o.news) ? o.news.slice(-12).filter((L) => Array.isArray(L)).map((L) => [netNum(L[0], 0, 1e10), NET_REALM_OK(L[1]) ? L[1] : -1, netStr(L[2], 160)]) : [];
  return s;
}
const netsGoods = (o) => (o && typeof o === 'object' ? Object.fromEntries(Object.keys(o).slice(0, 8).filter((g) => /^[a-z]{2,10}$/.test(g)).map((g) => [g, netNum(o[g], 0, 1e9)])) : {});
function netsRoster(o) {
  if (!o || !Array.isArray(o.list)) return null;
  return { now: netNum(o.now, 0, 1e6), day: netNum(o.day, 0, 1e6), list: o.list.slice(0, 40).map((x) => ({ n: netStr(x && x.n, 24) || 'Guest', c: CLASSES[x && x.c] ? x.c : '', l: netNum(x && x.l, 0, 60), on: x && x.on ? 1 : 0, ago: netNum(x && x.ago, 0, 1e6), g: netNum(x && x.g, 0, 1e9), co: netStr(x && x.co, 24) /* [companies] */ })) };
}
// the season taken into the live war: the keeps the season changed (by the page that keeps the shared war: the others
// follow it), the realm's stores into loops's when it is here; the first telling to a returning player
function netsApply(first) {
  const s = NETS.s, P = GAME.player;
  const k = s.keeps.map((K) => K.r);
  if (k.length === WAR.keeps.length && WAR.keeps.some((K, i) => netKeepMine(i))) {
    NET.applyingWorld = true;
    try {
      WAR.keeps.forEach((K, i) => {
        const r = k[i];
        if (!NET_REALM_OK(r) || r === K.realm || !netKeepMine(i)) return; // the keep's region's keeper takes it (the others hear it from the server)
        if (NETS.k && NETS.k[i] === r) return; // the season has not changed it since it last said: the live war's own
        captureKeep(K, r, null);
        NETS.stats.keepsApplied++;
      });
    } finally { NET.applyingWorld = false; }
  }
  NETS.k = k;
  if (P && s.st && typeof LOOPS !== 'undefined' && LOOPS.r && LOOPS.r[P.faction]) {
    for (const g in s.st) if (g in LOOPS.r[P.faction]) LOOPS.r[P.faction][g] = s.st[g];
    NETS.stats.stores++;
  }
  if(typeof realmPublicWorksApply==='function')realmPublicWorksApply(s);
  if (first && P && !NETS.told) {
    NETS.told = true;
    const R = netsRealmName(P.faction);
    if (NETS.away > 300) {
      uiToast(`Welcome back after ${netsAgo(NETS.away)}. The shared season advances during human play and pauses when empty. The Season page has recent news.`, 'hint');
      for (const L of s.news.slice(-6)) uiLog('Season: ' + L[2], 'sys');
    } else uiLog(`The shared season, active day ${s.day} of ${s.days}: ${NETS_PHASE[s.phase].toLowerCase()}. ${R} holds ${k.filter((r) => r === P.faction).length} keeps. The world pauses when no human players are active.`, 'sys');
    for (const L of NETS.chat.slice(-4)) uiLog(`${L[1]} (earlier): ${L[2]}`, 'sys');
  }
  if (!NETS.noted && P) { NETS.noted = true; loreNote('netseason'); }
}
// the season's armies on the map: a pennant in their realm's colour with their number, a siege ringed (your realm's
// always; a foe's at a siege, as the news tells it)
function netsWorldMap(ctx, S) {
  if (!netsOn() || !GAME.player) return;
  const me = GAME.player.faction;
  ctx.save();
  ctx.font = `600 ${Math.round(S * 0.02)}px system-ui, sans-serif`;
  for (const A of NETS.s.armies) {
    if ((A.r !== me && A.st !== 'siege') || A.f) continue; // [season2] (one on a page's field is a band there: 08o_season2.js)
    const [x, y] = w2m(A.x, A.z, S), u = S * 0.012;
    ctx.strokeStyle = 'rgba(0,0,0,0.85)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(x, y + u * 1.4); ctx.lineTo(x, y - u * 1.6); ctx.stroke();
    ctx.fillStyle = REALMS[A.r].color;
    ctx.beginPath(); ctx.moveTo(x, y - u * 1.6); ctx.lineTo(x + u * 1.8, y - u * 1.1); ctx.lineTo(x, y - u * 0.6); ctx.closePath(); ctx.fill(); ctx.stroke();
    if (A.st === 'siege') { ctx.strokeStyle = REALMS[A.r].color; ctx.lineWidth = 2; ctx.setLineDash([4, 3]); ctx.beginPath(); ctx.arc(x, y, u * 3, 0, TAU); ctx.stroke(); ctx.setLineDash([]); }
    const t = String(A.n);
    ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,0.8)'; ctx.fillStyle = '#f4ead8';
    ctx.strokeText(t, x + u * 2.1, y - u * 0.6); ctx.fillText(t, x + u * 2.1, y - u * 0.6);
  }
  ctx.restore();
}
// a line on the war panel (10_ui.js updateWarPanel)
function netsConnectionText() {
  if (typeof NETWS === 'undefined' || !NETWS.url) return 'You are playing alone: this March is yours, and its war runs only while you play. Open the March from its server to join the season.';
  if (NETWS.state === 'on') return NETWS.season ? 'Waiting for the server’s latest season update.' : 'This server keeps no season.';
  if (NETWS.state === 'opening') return 'Connecting to the March’s server… Shared season updates are unavailable until connected.';
  if (NETWS.link && !NETWS.closed && !NETWS.reload) return 'Connection to the March’s server interrupted. Reconnecting…';
  return 'The March’s server cannot be reached. Shared season updates are unavailable.';
}
function netSeasonHudHTML() {
  if (typeof NETWS !== 'undefined' && NETWS.worldPauseReason) return `<div class="ns-line ns-off" role="status">${esc(NETWS.worldPauseReason)}</div>`;
  // A disconnected server session is not an independently chosen solo game.
  if (typeof NETWS !== 'undefined' && NETWS.url && !netsOn()) {
    if (NETWS.state === 'on') return '';
    return `<div class="ns-line ns-off" role="status">${esc(netsConnectionText())}</div>`;
  }
  if (!netsOn()) return '';
  const s = NETS.s, P = GAME.player, ro = NETS.roster;
  const left = Math.max(0, s.len - s.t);
  return `<div class="ns-line" title="The shared season advances while human players are active and pauses when empty">Season ${s.n} · ${s.over ? 'over' : 'active day ' + s.day + ' of ' + s.days} · ${NETS_PHASE[s.phase]}${!s.over && s.phase === 'build' ? '' : ''}${ro && P ? ` · <b style="color:${REALMS[P.faction].color}">${ro.now}</b> of ${esc(netsRealmName(P.faction))} on` : ''}${s.over ? '' : `<small> · ${netsAgo(left)} of active play left</small>`}</div>${season2HudLine() /* [season2] */}`;
}
// what the player carries that the realm's stores take, by store
function netsCarried() {
  const by = {}, W = netsWorth();
  for (const id in INV.goods || {}) { const n = INV.goods[id], w = W[id]; if (w && n > 0) (by[w[0]] = by[w[0]] || []).push([id, n, n * w[1]]); }
  return by;
}
function netsAsk(o) {
  return new Promise((res) => {
    const q = ++NETS.q; o.q = q;
    if (!netWsSend(o)) { res({ ok: false, why: 'Not linked to the March\'s server' }); return; }
    NETS.waits.set(q, res);
    setTimeout(() => { if (NETS.waits.has(q)) { NETS.waits.delete(q); res({ ok: false, why: 'The server did not answer' }); } }, 9000);
  });
}
// a delivery told to the server: it takes what one could have gathered and says so (the rest stays in your packs)
async function netsGive(g, units) {
  const r = await netsAsk({ t: 'contrib', k: g, n: Math.floor(units) });
  NETS.stats.contribs++;
  if (r && r.ok) { NETS.stats.took += r.took; NETS.given[g] = (NETS.given[g] || 0) + r.took; } else NETS.stats.refused++;
  return r;
}
// "Bring your goods": every good of a store's kind, from the packs to the realm's stores on the server
async function netsGiveAll(g) {
  const list = netsCarried()[g] || [];
  const units = list.reduce((a, x) => a + x[2], 0);
  if (!(units >= 1)) return { ok: false, why: 'You carry nothing of that' };
  const r = await netsGive(g, units);
  if (r && r.ok) {
    // take from the packs as much as the server took (the dearest goods last)
    let left = r.took;
    for (const [id, n, u] of list.sort((a, b) => a[2] / a[1] - b[2] / b[1])) { if (left <= 0) break; const per = u / n, k = Math.min(n, Math.ceil(left / per - 1e-9)); if (goodsTake(id, k)) left -= k * per; }
    const R = GAME.prog ? realmRank(GAME.prog.rp) : 1;
    addRP(Math.round(r.took * (g === 'iron' ? 4 : g === 'horses' ? 60 : 1) * (1 + R * 0.05)));
    uiLog(`You bring ${fmtInt(r.took)} ${g} to ${possessive(netsRealmName(GAME.player.faction))} stores for the season${r.took < r.asked ? ` (the quartermaster took no more than one could gather: ${fmtInt(r.asked - r.took)} stay in your packs)` : ''}.`, 'rp');
    saveSoon();
  }
  return r;
}
async function netsVote(o) {
  const r = await netsAsk({ t: 'order', o });
  NETS.stats.orders++;
  return r;
}
// loops's deliveries at a quartermaster told to the season too (when both are here)
function netsWrapLoops() {
  if (typeof loopsDeliver !== 'function' || loopsDeliver._nets) return;
  const f = loopsDeliver;
  // eslint-disable-next-line no-global-assign
  loopsDeliver = function (g, K) { const r = f.apply(this, arguments); if (r && r.units > 0 && netsOn()) netsGive(g, r.units); return r; };
  loopsDeliver._nets = true;
}
queueMicrotask(netsWrapLoops);

/* ------------------------------------------------------------------ */
/* the Season page of the Chronicle                                    */
/* ------------------------------------------------------------------ */
// [v19] the Season page while linked to the server (08n_season.js chronSeason hands it here; alone, loops's own page)
function netsChronSeason() {
  const P = GAME.player;
  if (!netsOn() || !P) {
    return `<h2>The season</h2><p class="lead">The three realms share a ${NETS.s?.days || 28}-day season measured in active play time. Their stores, works, armies and season clock advance while human players are active. The world pauses when empty. Bring what you gather, vote for your realm's works and targets, and fight alongside other players when they are here.</p><p role="status">${esc(typeof NETWS !== 'undefined' && NETWS.worldPauseReason || netsConnectionText())}</p>`;
  }
  const s = NETS.s, r = P.faction, R = REALMS[r], ro = NETS.roster;
  const goodsRow = (o) => Object.entries(o).map(([g, n]) => `${fmtInt(n)} ${g}`).join(', ');
  const keeps = s.keeps.map((K) => `<li style="--rc:${K.r >= 0 ? REALMS[K.r].color : '#888'}"><b>${esc(netsKeepName(K.i))}</b> ${K.r >= 0 ? esc(netsRealmName(K.r)) : '?'} · ${K.g} guards${K.gate ? '' : ' · gate down'}${K.siege ? ' · <em>under siege</em>' : ''}${K.r !== r && s.target !== K.i ? ` <button type="button" class="btn ns-btn" data-ns="target:${K.i}">Vote to march on it</button>` : ''}${s.target === K.i ? ' <span class="l2-tag">Your realm\'s target</span>' : ''}</li>`).join('');
  const armies = s.armies.filter((A) => A.r === r || A.st === 'siege').map((A) => `<li>${esc(netsRealmName(A.r))}: ${fmtInt(A.n)} ${A.st === 'siege' ? 'besiege' : 'march on'} ${esc(netsKeepName(A.to))}</li>`).join('') || '<li>No army in the field.</li>';
  const proj = s.proj.map((p) => `<li${p.built ? ' class="on"' : ''}><b>${esc(p.label)}</b><small>${esc(p.did)}. ${p.built ? 'Built.' : `Needs ${esc(goodsRow(p.need))}; has ${esc(goodsRow(p.have))}. ${fmtInt(p.votes)} votes.`}</small>${p.built ? '' : `<button type="button" class="btn ns-btn" data-ns="project:${p.id}">Vote for this work</button>`}</li>`).join('');
  const carried = netsCarried();
  const give = Object.keys(carried).map((g) => `<button type="button" class="btn ns-btn" data-ns="give:${g}">Bring ${fmtInt(carried[g].reduce((a, x) => a + x[2], 0))} ${g}</button>`).join('') || '<span>You carry nothing the stores take (food, timber, stone, iron, hides, wool): gather, farm and hunt, then come back.</span>';
  const st = s.st ? Object.entries(s.st).map(([g, n]) => `<li><b>${fmtInt(n)}</b> ${g}</li>`).join('') : '';
  const list = ro ? ro.list.map((x) => `<li>${x.on ? '<b class="ns-on">●</b> ' : ''}${esc(x.n)}${x.c ? ` · ${CLASSES[x.c].name} ${x.l}` : ''}${x.on ? ' · on now' : ` · ${x.ago < 2 ? 'just now' : netsAgo(x.ago * 60) + ' ago'}`}${x.g ? ` · brought ${fmtInt(x.g)} today` : ''}${x.co ? ` · ${esc(x.co)}` /* [companies] */ : ''}</li>`).join('') : '';
  const news = s.news.slice().reverse().map((L) => `<li>${esc(L[2])}</li>`).join('') || '<li>All quiet.</li>';
  const pts = s.pts.map((p, i) => `<li style="--rc:${REALMS[i].color}"${i === r ? ' class="on"' : ''}><b>${esc(netsRealmName(i))}</b> ${fmtInt(p)} points · ${((n) => n + (n === 1 ? ' keep' : ' keeps'))(s.keeps.filter((K) => K.r === i).length)}</li>`).join('');
  const officer = realmRank(GAME.prog.rp) >= 5;
  return `<h2>The season</h2>
<p class="lead">Season ${s.n}, ${s.over ? `over: ${s.winner >= 0 ? esc(netsRealmName(s.winner)) + ' holds the March' : 'the March is quiet'}` : `active day ${s.day} of ${s.days}`}: ${esc(NETS_PHASE[s.phase].toLowerCase())}. This shared season lasts ${s.days} days of active play time and pauses when no human players are active. While it runs, every keep held earns its realm points (twice in the final seven active days). The realm with the most at its end holds the March.</p>
<div class="now"><ul class="gd-aims ns-pts">${pts}</ul></div>
<h3 data-cf-open>${esc(R.name)}'s stores</h3><ul class="gd-aims ns-st">${st}</ul><div class="acts ns-give">${give}</div>
<h3 data-cf-open>Works</h3><p>The realm builds the work with the most votes from its stores as the goods come in. One vote each for each work${officer ? '; yours counts thrice (an officer of the realm)' : '; an officer of the realm (rank 5) counts thrice'}.</p><ul class="gd-aims ns-proj">${proj}</ul>
<h3>The keeps and the armies</h3><ul class="gd-aims ns-keeps">${keeps}</ul><p>${esc(R.name)}'s next levy in ${netsAgo(s.levyIn)} of active play.${officer ? '' : ' An officer of the realm (rank 5) may call a muster now.'}</p><ul class="ns-armies">${armies}</ul>${officer && s.phase !== 'build' ? '<div class="acts"><button type="button" class="btn ns-btn" data-ns="muster">Call a muster</button></div>' : ''}
${season2ChronHTML() /* [season2] (08o_season2.js) */}
<h3 data-cf-open>Your realm today</h3><p>${ro ? `${ro.now} on now, ${ro.day} today.` : ''}</p><ul class="ns-roster">${list}</ul>
<h3 data-cf-open>News of the season</h3><ul class="ns-news">${news}</ul>
<p class="fineprint" id="ns-said"></p>`;
}
function netsRender() { if (typeof renderChronicle === 'function' && UI.modal === 'menu' && LORE.chronSec === 'season') renderChronicle($('menu-body')); }
$('menu-body').addEventListener('click', async (ev) => {
  const b = ev.target.closest('.chron [data-ns]');
  if (!b || b.disabled || NETS.busy) return;
  const [act, id] = b.dataset.ns.split(':');
  NETS.busy = true; b.disabled = true; sfx('click');
  let r = null;
  try {
    if (act === 'give') r = await netsGiveAll(id);
    else if (act === 'project') r = await netsVote({ kind: 'project', id });
    else if (act === 'target') r = await netsVote({ kind: 'target', keep: id | 0 });
    else if (act === 'muster') r = await netsVote({ kind: 'muster' });
  } finally { NETS.busy = false; }
  netWsSend({ t: 'season' });
  const msg = r && r.ok ? (act === 'give' ? `Brought ${fmtInt(r.took)} ${id}.` : act === 'muster' ? 'The muster is called.' : 'Your vote is counted.') : (r && r.why) || 'Not now';
  uiToast(msg, r && r.ok ? '' : 'hint');
  NETS.said = msg;
  setTimeout(() => { netsRender(); const e = document.getElementById('ns-said'); if (e) e.textContent = NETS.said; }, 400);
});
if (typeof G2_SEE !== 'undefined') G2_SEE.season = ['war', 'orders'];

/* ------------------------------------------------------------------ */
/* what players are told                                               */
/* ------------------------------------------------------------------ */
Object.assign(FIELD_NOTES, {
  netseason: { t: 'The shared season', x: () => `This March shares a ${NETS.s?.days || 28}-day season measured in active play time. The world advances while human players are active and pauses when empty. Bring what you gather to your realm's stores, vote for its works and targets, and find other players on the Chronicle's Season page${IS_TOUCH ? '' : ' (J)'}.` },
});
GUIDE_HELP.push(() => `<h3>The shared season</h3><p>On the March's server, the three realms share a ${NETS.s?.days || 28}-day season measured in active play time. Stores fill, works are built, armies march and the season clock advances while human players are active. The world pauses when empty, so time away does not automatically move the season forward. Other players can keep it moving while you are away. Bring goods to your realm's stores (Chronicle → Season → Bring), vote for its next work and target, and fight beside your realm. Keeps held earn season points while the world is active, twice in the final seven active days. The realm with the most points at the season's end holds the March. The Season page has recent news when you return.</p>`);
LOADING_TIPS.push('The shared season counts active play time. The world advances while human players are active and pauses when empty.');
window.__hm.netseason = { NETS, msg: netSeasonMsg, give: netsGive, giveAll: netsGiveAll, vote: netsVote, hud: netSeasonHudHTML, carried: netsCarried, render: netsRender };

/* The king's realm controls spend authoritative season stock, never personal bags. */
const NETR_MANAGE={pending:null,result:null,message:'',focus:null,viewAt:0,viewKey:'',viewSeq:0,viewAck:0};
function netRealmManagementRead(value) {
  if(!value||value.v!==1||![0,1,2].includes(value.realm)||!Number.isSafeInteger(value.revision)||value.revision<0
    ||!Number.isFinite(value.time)||value.time<0)return null;
  const bounds={stocks:20,plots:72,buildings:72,publicPlots:72,publicBuildings:72,catalog:20,recipes:20,offers:24,relations:2,allRelations:3,log:12};
  for(const[key,max]of Object.entries(bounds))if(!Array.isArray(value[key])||value[key].length>max)return null;
  let serial;try{serial=JSON.stringify(value);}catch{return null;}if(serial.length>65536)return null;
  let nodes=0;
  function walk(x,depth=0){
    if(++nodes>18000||depth>10)throw Error('view');
    if(x===null||typeof x==='boolean')return x;
    if(typeof x==='number'){if(!Number.isFinite(x)||Math.abs(x)>1e12)throw Error('number');return x;}
    if(typeof x==='string'){if(x.length>240)throw Error('string');return x;}
    if(Array.isArray(x)){if(x.length>100)throw Error('array');return x.map(q=>walk(q,depth+1));}
    if(typeof x!=='object')throw Error('json');
    const out={};if(Object.keys(x).length>48)throw Error('fields');
    for(const key of Object.keys(x)){if(['__proto__','constructor','prototype'].includes(key)||key.length>60)throw Error('key');out[key]=walk(x[key],depth+1);}return out;
  }
  try{return walk(JSON.parse(serial));}catch{return null;}
}
function netRealmManagementView(){
  const p=GAME.player,s=NETS.s;
  return netsOn()&&netHumanLive()&&p?.alive&&s?.management?.realm===p.faction?s.management:null;
}
function netRealmManagementStatus(){return{pending:!!NETR_MANAGE.pending,result:NETR_MANAGE.result,message:NETR_MANAGE.message};}
function netRealmManagementReceive(m){
  const p=NETR_MANAGE.pending;if(!p||m.nonce!==p.request.nonce)return;
  const view=netRealmManagementRead(m.management);
  if(view&&NETS.s&&view.realm===GAME.player?.faction)NETS.s.management=view;
  NETR_MANAGE.result={ok:m.ok===true,confirmed:m.confirmed===true,pending:m.pending===true,revision:m.revision};
  NETR_MANAGE.message=String(m.message||m.why||(m.ok?'Realm order confirmed.':'Realm order refused.')).slice(0,200);
  if(m.pending!==true)NETR_MANAGE.pending=null;
}
async function netRealmManagementSend(p){
  if(p.sending)return{ok:false,pending:true,why:'The same order is already being sent.'};
  if(!netHumanLive()||!netsOn()||!hallThroneGrant())return{ok:false,pending:true,why:'Return to a high seat and reconnect before retrying.'};
  p.sending=true;NETR_MANAGE.message='Waiting for the native realm save…';
  try{
    const r=await netsAsk({t:'order',o:p.request});
    if(r.kind!=='manage'&&NETR_MANAGE.pending===p){
      NETR_MANAGE.message='The order has not been confirmed. Retry this same order after reconnecting.';
      NETR_MANAGE.result={ok:false,pending:true,confirmed:false};return{...r,pending:true};
    }return r;
  }finally{p.sending=false;}
}
function netRealmManagementCommand(args){
  if(NETR_MANAGE.pending)return Promise.resolve({ok:false,pending:true,why:'Confirm or retry the pending realm order first.'});
  const view=netRealmManagementView();
  if(!view||!hallThroneGrant()){NETR_MANAGE.message='Take a high seat of your realm to manage it.';return Promise.resolve({ok:false,why:NETR_MANAGE.message});}
  let clean;try{clean=JSON.parse(JSON.stringify(args));}catch{return Promise.resolve({ok:false,why:'Invalid realm order.'});}
  if(typeof netSendSlow==='function')netSendSlow(performance.now(),true);
  if(typeof netSendFast==='function'){NET.fastKey='';NET.fastAt=-Infinity;netSendFast(performance.now());}
  const p={request:{kind:'manage',nonce:NET.self+':'+crypto.randomUUID(),season:NETS.s.n,revision:view.revision,hall:HALL.sit.H.num,args:clean},sending:false};
  NETR_MANAGE.pending=p;NETR_MANAGE.result=null;return netRealmManagementSend(p);
}
function netRealmManagementRetry(){return NETR_MANAGE.pending?netRealmManagementSend(NETR_MANAGE.pending):Promise.resolve({ok:false,why:'No pending realm order.'});}
function netRealmViewInterest(){
  const f=NETR_MANAGE.focus;
  return f&&netHumanLive()&&netsOn()&&hallThroneGrant()&&NETS.s?.n===f.n&&HALL.sit.H.num===f.hall&&performance.now()<f.expires
    ?{realm:f.realm,x:f.x,z:f.z,radius:f.radius}:null;
}
function netRealmViewUpdate(){
  netRealmSeasonProjectionFresh();
  if(!netHumanLive()||!netsOn()||!hallThroneGrant()||typeof THRONE_RTS==='undefined'||!THRONE_RTS.active){NETR_MANAGE.focus=null;NETR_MANAGE.viewKey='';return;}
  const now=performance.now(),x=THRONE_RTS.x,z=THRONE_RTS.z,radius=clamp(THRONE_RTS.distance*1.5,45,220);
  if(![x,z,radius].every(Number.isFinite))return;
  const key=[NETS.s.n,HALL.sit.H.num,Math.round(x/4),Math.round(z/4),Math.round(radius/5)].join(':');
  if(now-NETR_MANAGE.viewAt<3000||key===NETR_MANAGE.viewKey&&now-NETR_MANAGE.viewAt<10000)return;
  NETR_MANAGE.viewAt=now;NETR_MANAGE.viewKey=key;
  netWsSend({t:'order',q:++NETS.q,o:{kind:'view',seq:++NETR_MANAGE.viewSeq,n:NETS.s.n,hall:HALL.sit.H.num,x,z,radius}});
}
function netRealmViewReceive(m){
  if(!Number.isSafeInteger(m.seq)||m.seq<NETR_MANAGE.viewAck)return;NETR_MANAGE.viewAck=m.seq;
  const v=m.view;
  if(!m.ok||!v||![v.x,v.z,v.radius].every(Number.isFinite)||v.n!==NETS.s?.n||v.hall!==HALL.sit?.H.num||v.realm!==GAME.player?.faction
    ||v.radius<30||v.radius>220||!Number.isFinite(v.ttl)||v.ttl<=0||v.ttl>15000){NETR_MANAGE.focus=null;return;}
  NETR_MANAGE.focus={n:v.n,hall:v.hall,realm:v.realm,x:v.x,z:v.z,radius:v.radius,expires:performance.now()+v.ttl};
}
function netRealmBattleReport(report){
  if(!netsOn()||!netHumanLive()||typeof netEntityCanSimulateWorld!=='function'||!netEntityCanSimulateWorld()
    ||typeof NETPARTS==='undefined')return Promise.resolve({ok:false,why:'The battlefield keeper changed.'});
  return netsAsk({t:'order',o:{kind:'battle',n:report.n,keep:report.keep,owner:report.owner,g:report.g,gate:report.gate,seq:report.seq,
    authority:NETPARTS.authority,worldAdmission:NETPARTS.admission}});
}
Object.assign(window.__hm.netseason,{realmView:netRealmManagementView,realmCommand:netRealmManagementCommand,
  realmStatus:netRealmManagementStatus,realmRetry:netRealmManagementRetry,viewInterest:netRealmViewInterest});

const NETR_LOGISTICS=new Map();
function netRealmLogisticsScope(){
  const a=typeof netCurrentWorldAdmission==='function'?netCurrentWorldAdmission():null,p=typeof NETPARTS!=='undefined'?NETPARTS:null;
  const owner=typeof NETWS!=='undefined'?NETWS.acct?.id:null,realm=GAME.player?.faction,n=NETS.s?.n;
  if(typeof owner!=='string'||!owner||!Number.isInteger(realm)||realm<0||realm>2||!Number.isSafeInteger(n)||n<1
    ||typeof a?.origin!=='string'||!a.origin||!Number.isSafeInteger(a.epoch)||a.epoch<1
    ||p?.admission?.origin!==a.origin||p.admission.epoch!==a.epoch)return '';
  // Native identity survives an ordinary socket or keeper handoff. Its uncertain
  // transactions retain their exact nonce until a genuinely different world.
  return JSON.stringify([owner,realm,n,a.origin,a.epoch]);
}
function netRealmLogisticsPrune(){
  const scope=netRealmLogisticsScope();
  if(scope)for(const[id,p]of NETR_LOGISTICS)if(p.scope!==scope)NETR_LOGISTICS.delete(id);
  return scope;
}
function netRealmLogisticsRead(value){
  if(!value||value.v!==1)return null;
  try{
    const text=JSON.stringify(value);if(text.length>131072)return null;
    if(value.jobs&&(!Array.isArray(value.jobs)||value.jobs.length>40)||value.repairs&&(!Array.isArray(value.repairs)||value.repairs.length>108))return null;
    const clean=JSON.parse(text);let nodes=0;
    function valid(x,d=0){
      if(++nodes>10000||d>10)return false;
      if(x===null||typeof x==='boolean')return true;
      if(typeof x==='number')return Number.isFinite(x)&&Math.abs(x)<=1e12;
      if(typeof x==='string')return x.length<=200;
      if(Array.isArray(x))return x.length<=256&&x.every(y=>valid(y,d+1));
      return typeof x==='object'&&Object.keys(x).length<=40&&Object.entries(x).every(([k,v])=>!['__proto__','constructor','prototype'].includes(k)&&valid(v,d+1));
    }
    return valid(clean)?clean:null;
  }catch{return null;}
}
function netRealmLogisticsView(){return netsOn()&&netHumanLive()?NETS.s?.logistics||null:null;}
function netRealmLogisticsReceive(m){
  const scope=netRealmLogisticsPrune(),pending=NETR_LOGISTICS.get(m.nonce);
  if(!scope||!pending||pending.scope!==scope||pending.q!==m.q)return;
  const v=netRealmLogisticsRead(m.logistics);if(v&&NETS.s){NETS.s.logistics=v;NETS.s.repairs=v.repairs||[];}
  const management=netRealmManagementRead(m.management);if(management&&NETS.s&&management.realm===GAME.player?.faction)NETS.s.management=management;
  if(v&&m.confirmed===true&&typeof realmLogisticsApplyProjection==='function')realmLogisticsApplyProjection();
  pending.result=m;
  if(m.pending!==true)NETR_LOGISTICS.delete(m.nonce);
}
async function netRealmLogisticsCommand(args,nonce){
  const keeper=typeof netEntityCanSimulateWorld==='function'&&netEntityCanSimulateWorld(),ruler=['repair.issue','convoy.dispatch'].includes(args?.op)&&hallThroneGrant(),donor=args?.op==='horse.donate';
  if(!netsOn()||!netHumanLive()||!NETS.s?.management||!keeper&&!ruler&&!donor||typeof NETPARTS==='undefined')return{ok:false,why:'The battlefield keeper or ruler changed.'};
  const scope=netRealmLogisticsPrune();
  if(!scope)return{ok:false,pending:true,why:'Waiting for the current native world admission.'};
  let clean,key;try{clean=JSON.parse(JSON.stringify(args));key=JSON.stringify(clean);}catch{return{ok:false,why:'Invalid logistics order.'};}
  let p=typeof nonce==='string'?NETR_LOGISTICS.get(nonce):[...NETR_LOGISTICS.values()].find(p=>p.key===key);
  if(!p){
    if(NETR_LOGISTICS.size>=8)return{ok:false,pending:true,why:'Logistics orders are waiting for native confirmation.'};
    const id=typeof nonce==='string'?nonce:NET.self+':'+crypto.randomUUID();
    p={key,scope,request:{kind:'logistics',nonce:id,season:NETS.s.n,revision:NETS.s.management.revision,args:clean,hall:HALL.sit?.H.num??-1},sending:false};
    NETR_LOGISTICS.set(id,p);
  }
  if(p.key!==key)return{ok:false,why:'This logistics reference belongs to a different action.'};
  if(p.sending)return{ok:false,pending:true,nonce:p.request.nonce};
  p.request.authority=NETPARTS.authority;p.request.worldAdmission=NETPARTS.admission;
  p.sending=true;
  try{
    const envelope={t:'order',o:p.request},reply=netsAsk(envelope);p.q=envelope.q;
    const r=await reply,current=netRealmLogisticsPrune(),active=NETR_LOGISTICS.get(p.request.nonce);
    if(current!==p.scope||active&&active!==p)return{ok:false,pending:!current,nonce:p.request.nonce,code:'stale_context',why:'The logistics request belongs to an earlier native world or identity.'};
    return r.kind==='logistics'?r:{...r,pending:true,nonce:p.request.nonce};
  }finally{p.sending=false;}
}
Object.assign(window.__hm.netseason,{logisticsView:netRealmLogisticsView,logisticsCommand:netRealmLogisticsCommand});

function netRealmSeasonProjectionKey(){
  const p=typeof NETPARTS!=='undefined'?NETPARTS:null;
  return JSON.stringify([p?.admission?.origin||'',p?.admission?.epoch||0,p?.authority||'',typeof NETWS!=='undefined'?NETWS.generation:0,NET.self||'']);
}
function netRealmSeasonProjectionFresh(){
  const fresh=netsOn()&&netHumanLive()&&NETS.projectionKey===netRealmSeasonProjectionKey();
  if(!fresh&&NETS.s)NETS.s.armyIdsComplete=false;
  return fresh;
}
