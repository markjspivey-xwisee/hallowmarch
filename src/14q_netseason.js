/* ================================================================== */
/* [net] the season: the realms' life on the server, told and fed     */
/* ================================================================== */
// Version 19. With the March's own server (14p_netws.js) the three realms live on while nobody plays: the server steps
// their strategic state (RS, the shared contract with loops: CLAUDE.md, Multiplayer, the season) day and night, and every
// player of a realm sees it and feeds it. Here: what the server tells (`season`: its day and phase, the keeps and who
// holds them, the realm's stores, its works and votes, its armies, the news; the realm's roster, who is on now and who was
// today; on the first telling what happened while you were away and the realm's chat), the keeps' holders taken into the
// live war (only by the page that keeps the shared war, only what the season changed since it last said), the realm's
// stores laid into loops's stores when they are here, the player's deliveries (the Season page's "Bring your goods", or
// loops's own deliveries at a quartermaster: told to the server, which takes what one could have gathered) and votes (a
// work, a target, an officer's muster), the war panel's line, the Season page of the Chronicle, a field note, help and
// tips. Alone (no server) none of it runs and the page plays exactly as before.
const NETS = { s: null, roster: null, k: null, at: 0, first: false, away: -1, q: 0, waits: new Map(), given: {}, chat: [], busy: false, noted: false, told: false, stats: { msgs: 0, keepsApplied: 0, stores: 0, contribs: 0, took: 0, refused: 0, orders: 0 } };
const NETS_PHASE = { build: 'Building', war: 'War', final: 'The final week', over: 'Over' };
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
  if (m.t === 'contrib' || m.t === 'order') { const w = NETS.waits.get(m.q); if (w) { NETS.waits.delete(m.q); w(m); } return; }
  if (m.t !== 'season' || !m.s || typeof m.s !== 'object') return;
  NETS.stats.msgs++;
  const s = netsRead(m.s);
  if (!s) return;
  NETS.s = s; NETS.at = performance.now();
  NETS.roster = netsRoster(m.roster);
  if (m.wx && typeof m.wx === 'object' && JSON.stringify(m.wx).length < 4000) NETS.wx = m.wx; // weather2's systems from the server (kept, not read yet: for the integrator)
  if (m.first) { NETS.first = true; NETS.away = netNum(m.away, -1, 1e9); }
  if (Array.isArray(m.chat)) NETS.chat = m.chat.slice(-20).filter((L) => Array.isArray(L) && L.length === 3).map((L) => [netNum(L[0], 0, 1e15), netStr(L[1], 24), netStr(L[2], 140)]);
  if (GAME.started) netsApply(m.first);
  // (the Season page is drawn when it is opened and after the player's own deliveries and votes: drawn again at every
  // telling it faded in anew and lost its scroll)
}
// everything the server says is read and bounded (a season's news from the server is text, set as text)
function netsRead(o) {
  const s = { n: netNum(o.n, 1, 1e6), t: netNum(o.t, 0, 1e10), len: netNum(o.len, 600, 1e9), day: netNum(o.day, 1, 1e5), days: netNum(o.days, 1, 1e5), phase: NETS_PHASE[o.phase] ? o.phase : 'war', over: o.over ? 1 : 0, winner: NET_REALM_OK(o.winner) ? o.winner : -1 };
  s.pts = Array.isArray(o.pts) && o.pts.length === 3 ? o.pts.map((v) => netNum(v, 0, 1e12)) : [0, 0, 0];
  s.keeps = Array.isArray(o.keeps) ? o.keeps.slice(0, 16).map((K, i) => ({ i, r: NET_REALM_OK(K && K.r) ? K.r : -1, g: netNum(K && K.g, 0, 999), gate: K && K.gate ? 1 : 0, siege: K && K.siege ? 1 : 0 })) : [];
  s.armies = Array.isArray(o.armies) ? o.armies.slice(0, 24).filter((A) => A && NET_REALM_OK(A.r)).map((A) => ({ r: A.r, n: netNum(A.n, 0, 9999), to: netNum(A.to, -1, 16), st: A.st === 'siege' ? 'siege' : 'march', x: netNum(A.x, -5000, 5000), z: netNum(A.z, -5000, 5000), f: A.f ? 1 : 0, off: A.off ? 1 : 0 })) : []; // [season2] f: on a page's field, off: an offensive's
  s.offs = Array.isArray(o.offs) ? o.offs.slice(0, 12).filter((O) => O && NET_REALM_OK(O.r)).map((O) => ({ r: O.r, k: netNum(O.k, -1, 16), state: O.state === 'planned' ? 'planned' : 'siege', inS: netNum(O.inS, 0, 1e9) })) : []; // [season2] the offensives announced
  s.st = o.st && typeof o.st === 'object' ? Object.fromEntries(['food', 'timber', 'stone', 'iron', 'hides', 'wool', 'horses'].map((g) => [g, netNum(o.st[g], 0, 1e9)])) : null;
  s.built = Array.isArray(o.built) ? o.built.slice(0, 12).map((x) => netStr(x, 24)) : [];
  s.proj = Array.isArray(o.proj) ? o.proj.slice(0, 12).filter((p) => p && typeof p.id === 'string').map((p) => ({ id: netStr(p.id, 24), label: netStr(p.label, 60), did: netStr(p.did, 80), built: !!p.built, votes: netNum(p.votes, 0, 1e9), need: netsGoods(p.need), have: netsGoods(p.have) })) : [];
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
  if (first && P && !NETS.told) {
    NETS.told = true;
    const R = netsRealmName(P.faction);
    if (NETS.away > 300) {
      uiToast(`While you were away (${netsAgo(NETS.away)}), the season went on: ${s.news.length ? s.news.length + ' things happened' : 'all was quiet'}. The Season page tells it.`, 'hint');
      for (const L of s.news.slice(-6)) uiLog('Season: ' + L[2], 'sys');
    } else uiLog(`The season of the March, day ${s.day} of ${s.days}: ${NETS_PHASE[s.phase].toLowerCase()}. ${R} holds ${k.filter((r) => r === P.faction).length} keeps.`, 'sys');
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
  return `<div class="ns-line" title="The season of the March: the realms live on while you are away">Season ${s.n} · ${s.over ? 'over' : 'day ' + s.day + ' of ' + s.days} · ${NETS_PHASE[s.phase]}${!s.over && s.phase === 'build' ? '' : ''}${ro && P ? ` · <b style="color:${REALMS[P.faction].color}">${ro.now}</b> of ${esc(netsRealmName(P.faction))} on` : ''}${s.over ? '' : `<small> · ${netsAgo(left)} left</small>`}</div>${season2HudLine() /* [season2] */}`;
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
    return `<h2>The season</h2><p class="lead">On the March's own server the three realms live on day and night: their stores fill and empty, their works are built, their armies march and lay siege by the numbers while nobody is there, and a season lasts weeks. Players of a realm come and go when they can, bring what they gathered, vote for the realm's works and its targets, and fight its battles when they meet.</p><p role="status">${esc(typeof NETWS !== 'undefined' && NETWS.worldPauseReason || netsConnectionText())}</p>`;
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
<p class="lead">Season ${s.n}, ${s.over ? `over: ${s.winner >= 0 ? esc(netsRealmName(s.winner)) + ' holds the March' : 'the March is quiet'}` : `day ${s.day} of ${s.days}`}: ${esc(NETS_PHASE[s.phase].toLowerCase())}. The realms live on while you are away: every keep held earns its realm points through the season (twice in the final week), and the realm with the most at its end holds the March.</p>
<div class="now"><ul class="gd-aims ns-pts">${pts}</ul></div>
<h3 data-cf-open>${esc(R.name)}'s stores</h3><ul class="gd-aims ns-st">${st}</ul><div class="acts ns-give">${give}</div>
<h3 data-cf-open>Works</h3><p>The realm builds the work with the most votes from its stores as the goods come in. One vote each for each work${officer ? '; yours counts thrice (an officer of the realm)' : '; an officer of the realm (rank 5) counts thrice'}.</p><ul class="gd-aims ns-proj">${proj}</ul>
<h3>The keeps and the armies</h3><ul class="gd-aims ns-keeps">${keeps}</ul><p>${esc(R.name)}'s next levy in ${netsAgo(s.levyIn)}.${officer ? '' : ' An officer of the realm (rank 5) may call a muster now.'}</p><ul class="ns-armies">${armies}</ul>${officer && s.phase !== 'build' ? '<div class="acts"><button type="button" class="btn ns-btn" data-ns="muster">Call a muster</button></div>' : ''}
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
  netseason: { t: 'The season', x: () => `This March runs on its server: the realms live on while you are away, for weeks. Bring what you gather to your realm's stores, vote for its works and its targets, and see who of your realm is on: the Season page of the Chronicle${IS_TOUCH ? '' : ' (J)'}.` },
});
GUIDE_HELP.push(() => `<h3>The season</h3><p>On the March's own server a season lasts weeks, and the realms live on while nobody plays: their stores fill from their towns and the keeps they hold, the works their players voted for are built, their armies muster, march and lay siege by the numbers. You help your realm when you can: bring what you gathered to its stores (the Season page of the Chronicle: Bring), vote for its next work and the keep it marches on, and fight beside whoever of your realm is on. Every keep held earns its realm points through the season, twice in the final week; the realm with the most at the season's end holds the March. When you come back you are told what happened while you were away.</p>`);
LOADING_TIPS.push('On the March\'s server the season goes on while you are away: the Season page tells what your realm did, and what it needs.');
window.__hm.netseason = { NETS, msg: netSeasonMsg, give: netsGive, giveAll: netsGiveAll, vote: netsVote, hud: netSeasonHudHTML, carried: netsCarried, render: netsRender };
