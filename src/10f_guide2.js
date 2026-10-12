/* ================================================================== */
/* [guide2] players know what to do, on a phone first (version 15)    */
/* ================================================================== */
// What version 13's guide left, and what versions 13 and 14 added that a player meets without being told:
//  - the Chronicle readable on a phone: a long page folds into its summaries (chronFold: its lead, then each section,
//    calling or realm under its heading, opened with a tap; what the page says of now and its links stay open), your
//    path's page shows the step at hand and folds the rest, and the field notes have a page of their own (a note shrunk
//    to its title on a small screen opens there, itself first);
//  - field notes for what came since (a keep's hall, the farmers, a ripe bed, an unfamiliar herb, scaffolds and masons,
//    timber walls to set alight, houses broken by stones, a priest's Renewal, a mage's ward, a warrior's Charge; and
//    why something happened to you in a fight: dazzled, wounded, chilled), with
//    their help lines, a Chronicle section and loading tips;
//  - a gem or a pointer for the steps done anywhere (levels, command, the realm's gift, a masterwork, a campaign): a place
//    where there is one (a camp or a champion of your level, a war table, a station, the keep your realm fights for), or a
//    glow on the button that does it (the map, the gift);
//  - the war panel's line for your own aim, a tap from the Aims page;
//  - no tap lost on the HUD: the layout holds still while a finger is on a panel, until its click has landed (a panel
//    moved by the layout between the finger coming down and the click left the click on whatever was there then).
const G2 = { open: {}, noteFocus: null, point: null, pointT: 0, aimKey: '', stats: { folds: 0, pages: {} }, tap: { until: 0, downs: 0, clicks: 0, pending: false } };

/* ------------------------------------------------------------------ */
/* no tap lost: the HUD holds still under a finger                     */
/* ------------------------------------------------------------------ */
// A touch's click comes after the finger lifts (a tenth of a second and more on a slow phone) and lands on whatever is
// under it then: the HUD's layout pass (10p_hud.js) asks g2TapHeld() and waits while a finger is on a panel and until its
// click has landed (or 1.2 s after the finger lifts with no click: a drag)
const g2TapHeld = () => performance.now() < G2.tap.until;
// (only a panel the layout moves: the pad, the stick and the hotbar stay put, and a draw held on X must not hold the
// layout for its seconds)
document.addEventListener('pointerdown', (e) => {
  if (e.pointerType === 'mouse' || !e.target || !e.target.closest || !e.target.closest('#hud')) return;
  G2.tap.downs++; G2.tap.pending = true; // (a tap on the HUD whose click is still to come: tests wait for it)
  if (e.target.closest(HUD_ORDER.join(',') + ',#prompt')) G2.tap.until = performance.now() + 2500;
}, true);
const g2TapUp = () => { if (g2TapHeld()) G2.tap.until = performance.now() + 1200; }; // (a busy phone's click may come most of a second after the finger lifts)
document.addEventListener('pointerup', (e) => { if (e.pointerType !== 'mouse') g2TapUp(); }, true);
document.addEventListener('pointercancel', (e) => { if (e.pointerType !== 'mouse') g2TapUp(); }, true);
document.addEventListener('click', () => { const mine = G2.tap.pending; if (mine) { G2.tap.pending = false; G2.tap.clicks++; } if (mine && g2TapHeld()) { G2.tap.until = 0; HUDL.k = 0; } }, true); // (only a press's own click lets the layout go on)

/* ------------------------------------------------------------------ */
/* the Chronicle on a phone: summaries first, detail folded            */
/* ------------------------------------------------------------------ */
// A page taller than about a screen and a third on a phone (two and a half on a desk) folds: its lead stays, each <h3>
// section folds under its heading, a tall card (a calling, a realm) under its head and first line, a tier (an <h4> in a
// box) under its heading, and the rest of a long opening under the page's own word for it; what the page says of now
// (.now, .tide, .live, ...) and its links (.acts) at its end stay open. A fold the player opens or shuts stays so while the
// game runs. Any module's page folds the same way: write it in <h3> sections, cards or tiers.
const G2_KEEP = /\b(now|acts|fineprint|tide|live|skills)\b/;
const G2_INTRO = { callings: 'Keys, power and control', war: 'How a keep falls, step by step', orders: 'The orders', gifts: 'How the gifts work', herbal: 'The herbs of the March', realms: 'The three realms' };
const g2Phone = () => IS_TOUCH || innerWidth <= 760;
function g2FoldEl(sec, title, nodes, cls = '') {
  const d = document.createElement('details');
  d.className = 'cf' + (cls ? ' ' + cls : '');
  const s = document.createElement('summary');
  if (typeof title === 'string') { const h = document.createElement('h3'); h.textContent = title; s.appendChild(h); } else for (const n of title) s.appendChild(n);
  const b = document.createElement('div');
  b.className = 'cf-b';
  for (const n of nodes) b.appendChild(n);
  d.append(s, b);
  const key = sec + '|' + s.textContent.trim().slice(0, 48);
  d.dataset.cf = key;
  if (G2.open[key] != null) d.open = G2.open[key];
  d.addEventListener('toggle', () => { G2.open[key] = d.open; });
  G2.stats.folds++;
  return d;
}
// pages a reader of one goes on to: linked at its end where the page does not link them already
const G2_SEE = {
  march: ['realms', 'war'], realms: ['gifts', 'war'], water: ['living', 'land'], land: ['gear', 'living'], wilds: ['dragon', 'barrow'], dragon: ['barrow', 'wilds'], barrow: ['dragon', 'gear'],
  path: [], notes: [], goals: ['path', 'callings', 'gear'], callings: ['gifts', 'gear'], gear: ['callings', 'halls'],
  war: [], orders: ['war', 'sieges'], sieges: ['war', 'halls'], halls: ['orders', 'building'], gifts: ['callings', 'war'],
  living: ['fields', 'water'], fields: ['herbal', 'living'], herbal: ['fields'], animals: ['building', 'living'], building: ['halls', 'animals'],
};
function chronSee(sec, el) {
  const label = Object.fromEntries(CHRON_SECTIONS), ks = (G2_SEE[sec] || []).filter((k) => label[k] && k !== sec && !el.querySelector(`[data-lore="sec:${k}"]`));
  if (!ks.length) return;
  const d = document.createElement('div');
  d.className = 'acts g2-see';
  d.innerHTML = `<span>See also</span>${ks.map((k) => chronLink(k, label[k])).join('')}`;
  el.appendChild(d);
}
function chronFold(sec) {
  const body = $('menu-body'), el = body && body.querySelector('.chron-body');
  if (!el) return;
  chronSee(sec, el);
  const sheet = body.closest('.sheet'), vh = Math.max(320, (sheet && sheet.clientHeight) || innerHeight);
  const h0 = el.offsetHeight;
  G2.stats.pages[sec] = { h0, h: h0, vh, folds: 0 };
  if (el.querySelector(':scope > details.cf') || h0 < vh * (g2Phone() ? 1.3 : 2.5)) return; // folded already (your path), or short enough
  const kids = [...el.children], hts = new Map(kids.map((n) => [n, n.offsetHeight])); // (measured before anything moves)
  const cls = (n) => (typeof n.className === 'string' ? n.className : '');
  // the page's word on now and its links, at its end, stay open
  let tail = kids.length;
  while (tail > 1 && G2_KEEP.test(cls(kids[tail - 1]))) tail--;
  const big = (n) => hts.get(n) > vh * 0.42;
  const isTier = (n) => n.tagName === 'DIV' && n.firstElementChild && n.firstElementChild.tagName === 'H4';
  const isCard = (n) => /\bcard\b/.test(cls(n));
  const put = (at, title, nodes, c = '', open = false) => {
    const mark = document.createComment('cf');
    el.insertBefore(mark, at);
    const d = g2FoldEl(sec, title, nodes, c);
    if (open && G2.open[d.dataset.cf] == null) d.open = true;
    el.replaceChild(d, mark);
    G2.stats.pages[sec].folds++;
  };
  let S = null, run = [];
  const closeS = () => { if (S && S.nodes.length) put(S.h, [S.h], S.nodes, '', S.h.hasAttribute('data-cf-open')); S = null; };
  const flush = () => { if (run.length && run.reduce((t, n) => t + hts.get(n), 0) > vh * 0.42) put(run[0], G2_INTRO[sec] || 'Read more', run); run = []; };
  // a tall card (a calling, a realm) folds under its head and its first line; a tier (an <h4> in a box) under its heading
  const foldIn = (n) => {
    const ch = [...n.children];
    if (isTier(n)) {
      if (hts.get(n) < 120) return;
      const d = g2FoldEl(sec, [ch[0]], ch.slice(1), 'cf-in');
      if (n.hasAttribute('data-cf-open') && G2.open[d.dataset.cf] == null) d.open = true;
      n.appendChild(d);
    } else {
      const intro = ch.find((c, k) => k > 0 && c.tagName === 'P'), sumN = [ch[0], intro].filter(Boolean), rest = ch.filter((c) => !sumN.includes(c));
      if (!rest.length) return;
      n.appendChild(g2FoldEl(sec, sumN, rest, 'cf-in cf-card'));
    }
    G2.stats.pages[sec].folds++;
  };
  for (let i = 0; i < tail; i++) {
    const n = kids[i];
    if (n.tagName === 'H3') { closeS(); flush(); S = { h: n, nodes: [] }; continue; }
    if (isTier(n) || (isCard(n) && big(n))) { closeS(); flush(); foldIn(n); continue; }
    if (S) { S.nodes.push(n); continue; }
    // before the first section: the lead and the figures stay (a figure is a summary), the rest of a long opening folds
    if (i === 0 && n.tagName === 'P') continue;
    if (n.tagName === 'FIGURE' || G2_KEEP.test(cls(n))) { flush(); continue; }
    run.push(n);
  }
  closeS();
  if (G2.stats.pages[sec].folds) flush(); else run = []; // (a page of a lead and one block, the herbal's herbs, a list, stays as it is: one fold would only hide it)
  // one tap opens or shuts them all
  const all = [...el.querySelectorAll('details.cf')];
  if (all.length > 1) {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'btn cf-all';
    const setLbl = () => { b.textContent = all.every((d) => d.open) ? 'Fold all' : 'Open all'; };
    setLbl();
    b.addEventListener('click', () => { const o = !all.every((d) => d.open); for (const d of all) d.open = o; setLbl(); sfx('click'); });
    for (const d of all) d.addEventListener('toggle', setLbl);
    el.insertBefore(b, el.firstElementChild ? el.firstElementChild.nextSibling : null);
  }
  G2.stats.pages[sec].h = el.offsetHeight;
}

/* ------------------------------------------------------------------ */
/* the field notes' own page                                           */
/* ------------------------------------------------------------------ */
// every note seen, the newest first; the one a tap opened (a note shrunk to its title on a small screen) first and open
function chronNotes() {
  const prog = GAME.prog, P = GAME.player, R = REALMS[P.faction];
  const ids = prog.lore.seen.filter((id) => FIELD_NOTES[id]).reverse();
  const f = G2.noteFocus;
  if (f && ids.includes(f)) { ids.splice(ids.indexOf(f), 1); ids.unshift(f); }
  G2.noteFocus = null;
  const one = (id, i) => { let x = ''; try { x = FIELD_NOTES[id].x(R); } catch (e) { reportError(e); } return `<details class="cf note-f"${i === 0 ? ' open' : ''} data-note="${id}"><summary><h3>${FIELD_NOTES[id].t}</h3></summary><div class="cf-b"><p>${x}</p></div></details>`; };
  return `<p>Every field note you have been given, the newest first. A note comes once, at the moment it matters; here you can read it again.</p>
    ${ids.length ? ids.map(one).join('') : '<p class="now">No field notes yet: they come as you meet each part of the March.</p>'}
    <div class="acts">${chronLink('path', 'Your path')}${chronLink('goals', 'Aims')}</div>`;
}
chronAdd('notes', 'Field notes', 'you', chronNotes, 'path');

/* ------------------------------------------------------------------ */
/* field notes for what came since                                     */
/* ------------------------------------------------------------------ */
const g2Use = () => (IS_TOUCH ? 'Use' : 'E');
const G2_NOTES = {
  hall: { t: 'A keep\'s great hall', x: () => `At the war table you command your realm's warbands; at the armourer's bench you mend and clean your gear; wash at the basin, dry off and heal by the hearth; the stores sell building goods. ${g2Use()} beside each.` },
  farmers: { t: 'The farmers', x: () => `They sell seed and hoes. Till a bed of meadow (${IS_TOUCH ? 'Till a bed here, on the plant card' : 'E'}), sow it, keep it weeded, and harvest it ripe: the rain waters it. The Chronicle's Fields page tells more.` },
  ripe: { t: 'A ripe bed', x: () => `Harvest it before it sheds. Look at its plants first: keep the seed of the best (${IS_TOUCH ? 'on its plant card' : 'E on it'}), and your strain grows better each year.` },
  herb: { t: 'An unfamiliar plant', x: () => `Examine it (${IS_TOUCH ? 'on the plant card' : 'E'}) to learn it for your herbal; then you may gather it, dig up its root with a knife, and plant it in your own bed.` },
  scaffold: { t: 'Scaffolds and masons', x: () => `In peace a keep mends its breaches behind scaffolding, and two masons come out of its hall to work. Its boards carry you and its ladders climb: walk into one, or ${g2Use()}.` },
  setwall: { t: 'Timber burns', x: () => `With a brand in hand, ${g2Use()} sets it alight. The keep's people leave their posts to beat the fire out; a stretch that burns through is a breach for your warbands. Rain damps a fire.` },
  battered: { t: 'Stones on houses', x: () => 'A siege stone cracks a house it strikes and holes its roof (the rain comes in), and enough of them bring it down to rubble. Its town builds it back once the fighting moves on.' },
  renew: { t: 'Renewal on yourself', x: () => `For 4 s nothing but a stun breaks your spells: renew before a long one. Renewing again while the last still has more than ${typeof RENEW_ROTE_LEFT !== 'undefined' ? RENEW_ROTE_LEFT : 2} s to mend costs twice the power: renew at need, not by rote.`, fight: true },
  ward: { t: 'Your Arcane Ward', x: () => 'While it holds, a stun breaks on it, and so does a blow that would break your spell ("Warded"): each costs the ward some of its strength. Raise it before a long spell, or before a warrior leaps in.', fight: true },
  charge: { t: 'Charge', x: () => 'It rushes you at a foe 5 to 28 m off, shield first, and lands with a blow. A snare, a frost, a wall or water may stop it on its way: then it is ready again in half the time.', fight: true },
  // why something happened to you in a fight
  dazzle: { t: 'Dazzled', x: () => 'Holy light: for a few seconds some of your weapon blows go wide, and you cannot read a blow coming to parry it. Step off a priest\'s hallowed ground.', fight: true },
  wounded: { t: 'Wounded', x: () => 'A broadhead or a crippling arrow has opened a wound: healing on you takes less until it closes, in a few seconds.', fight: true },
  chilled: { t: 'Chilled', x: () => 'Frost slows you, and the third chill freezes you solid for a moment. Fire, a storm or a heavy blow breaks the ice.', fight: true },
};
for (const k in G2_NOTES) if (!FIELD_NOTES[k]) FIELD_NOTES[k] = G2_NOTES[k]; else reportError(new Error(`[guide2] the field note "${k}" is another module's`)); // (an id taken twice would replace the other's note)
// what each waits for (10e_guide.js guideWatch calls these)
Object.assign(GUIDE_WATCH, {
  hall: (P) => !!hallOf(P),
  scaffold: (P, ctx) => /scaffold/i.test(ctx.prompt) || G2.near.scaffold,
  setwall: (P, ctx) => /^Set the (palisade|wall walk|log wall|gate|thatch)\b.* alight/i.test(ctx.prompt),
  battered: () => G2.near.battered,
  renew: (P) => P.cls === 'priest' && P.buffs.some((b) => b.kind === 'hot' && b.src === P.id && b.until > GAME.t + 2),
  ward: (P) => P.cls === 'mage' && hasBuff(P, 'eward'),
  charge: (P) => P.cls === 'warrior' && !!(P.motion && P.motion.rush),
  dazzle: (P) => hasBuff(P, 'dazzle'),
  wounded: (P) => hasBuff(P, 'wound'),
  chilled: (P) => hasBuff(P, 'chill') || hasBuff(P, 'frozen'),
});
// slower looks, once a second (with guideScan)
G2.near = { scaffold: false, battered: false };
G2.scanT = 0;
function g2Scan(P) {
  const N = G2.near;
  N.scaffold = false; N.battered = false;
  if (inDungeon(P)) return;
  if (typeof LOOK3S !== 'undefined' && LOOK3S.ladders) for (const L of LOOK3S.ladders) if (L && !L.gone && L.fx != null && dist2(L.fx, L.fz, P.x, P.z) < 30 * 30) { N.scaffold = true; break; } // (a scaffold taken down keeps its ladders, gone)
  if (!N.scaffold && typeof MASON !== 'undefined') for (const e of MASON.list) if (e && e.alive && dist2(e.x, e.z, P.x, P.z) < 30 * 30) { N.scaffold = true; break; }
  for (const H of HOUSES) if (H.bat && (H.bat.k > 0.15 || H.bat.fell) && dist2(H.x, H.z, P.x, P.z) < 45 * 45) { N.battered = true; break; }
  // what is happening now: a garrison near you leaving its posts to fight a fire (once in a minute and a half)
  if (GAME.t > (G2.fireToldT || -1e9) + 90) {
    let crew = null;
    for (const e of ENT) if (e.alive && e.ai && e.ai.fire && dist2(e.x, e.z, P.x, P.z) < 80 * 80) { crew = e; break; }
    if (crew) {
      G2.fireToldT = GAME.t;
      uiToast(isEnemy(P, crew) ? 'Fire on their walls: the garrison leaves its posts to beat it out.' : `Fire on your walls: the garrison runs to beat it out. ${IS_TOUCH ? 'Use' : 'E'} beside the flames to help.`, 'hint');
    }
  }
}

/* ------------------------------------------------------------------ */
/* a place, or a pointer, for the steps done anywhere                  */
/* ------------------------------------------------------------------ */
// where to grow: a champion of your level, else a fight of your realm's warbands, else the keep it fights for
function g2LevelMark(P, prog) {
  const R = REALMS[P.faction];
  const ch = guideMarkOf({ id: 'champion' });
  if (ch && prog.level <= 42) return ch;
  return guideMarkOf({ id: 'warband' }) || guideMarkOf({ id: 'keep' }) || (guideOnFrontier(P) ? null : { x: R.town.x, z: R.town.z, what: 'the portal stones to the frontier' });
}
// a keep hall of your realm: its war table
function g2WarTable(P) {
  const R = REALMS[P.faction];
  const H = guideNearest(HALL.list.filter((h) => hallHolder(h) === P.faction && h.hallSpots), P);
  return H ? guideFront(P, R, H.hallSpots.table.x, H.hallSpots.table.z, `the war table of ${H.S.name}`) : null;
}
// a named masterwork: what you still lack, else the station that makes it
function g2MasterMark(P, prog) {
  const R = REALMS[P.faction];
  const recs = RECIPES.filter((r) => r.mw && (!r.cls || r.cls.includes(P.cls)));
  if (!recs.length) return null;
  const r = recs[0], lack = (id) => { const q = r.need.find((n) => n[0] === id); return q && goodsCount(id) < q[1]; };
  if (lack('trophy')) return guideMarkOf({ id: 'champion' });
  if (lack('grave_iron')) return guideMarkOf({ id: 'barrow' });
  if (lack('dragon_scale')) return guideMarkOf({ id: 'dragon' }) || guideMarkOf({ id: 'champion' });
  const S = guideNearest(CRAFT.stations.filter((q) => q.kind === r.st), P);
  return S ? guideTown(P, R, S.x, S.z, `the ${STATION_DEF[r.st].name}`) : null;
}
// the steps of version 13 done anywhere, and the late levels: where, or null (then perhaps a pointer: g2Pointer)
function g2MarkOf(S) {
  const P = GAME.player, prog = GAME.prog;
  switch (S.id) {
    case 'lv30': case 'lv40': case 'lv50': return g2LevelMark(P, prog);
    case 'command': return cwCanCommand() ? null : g2WarTable(P);
    case 'gift': return giftUltUnlocked(P) ? null : g2LevelMark(P, prog);
    case 'master': return prog.level < 40 ? g2LevelMark(P, prog) : g2MasterMark(P, prog);
    case 'campaign': return CAMPAIGN.state === 'war' ? guideMarkOf({ id: 'keep' }) : null;
    default: return undefined; // (10e_guide.js knows it)
  }
}
// a button that does the step: it glows while the step is next (the map for an order, the gift's own button)
function g2Pointer(S) {
  const P = GAME.player;
  if (!S || !P || !P.alive) return null;
  if (S.id === 'command' && cwCanCommand()) return { sel: '#btn-map', say: IS_TOUCH ? 'Tap the map button, then a warband' : 'Open the map (M) and choose a warband' };
  if (S.id === 'gift' && giftUltUnlocked(P)) return { sel: '.gslot', say: IS_TOUCH ? 'Tap the round gift button in a big fight' : 'Press 9 in a big fight' };
  return null;
}
function g2UpdatePointer(dt) {
  G2.pointT -= dt;
  if (G2.pointT > 0) return;
  G2.pointT = 0.5;
  const S = GAME.prog && GAME.prog.lore ? pathNext() : null, p = g2Pointer(S);
  if ((p && p.say) !== (G2.point && G2.point.say)) LORE.hudKey = '';
  G2.point = p;
  // every look (the hotbar is built again on a level, and its gift slot with it)
  const want = p ? new Set(document.querySelectorAll(p.sel)) : new Set();
  for (const el of document.querySelectorAll('.g2-point')) if (!want.has(el)) el.classList.remove('g2-point');
  for (const el of want) el.classList.add('g2-point');
}
// the tracker's line when there is no place but a button
function g2PointerLine() {
  const p = G2.point;
  return p && !GUIDE.mark ? `<span class="gd-where">${iconSvg('lpath', 13)}${esc(p.say)}</span>` : '';
}

/* ------------------------------------------------------------------ */
/* the war panel's line for your own aim                               */
/* ------------------------------------------------------------------ */
const G2_WAR_STEPS = new Set(['muster', 'climb', 'warband', 'gate', 'hallow', 'command', 'keep', 'gift', 'dragon', 'campaign', 'champion']);
function guideWarAimHTML() {
  const P = GAME.player, prog = GAME.prog;
  if (!P || !prog || !prog.lore) return '';
  const S = pathNext();
  if (S && G2_WAR_STEPS.has(S.id)) {
    const w = guideShortWhere();
    return `<div class="g2-aim" data-g2="path" title="Your path's next step: open it in the Chronicle"><span class="gem"></span><span class="t">${esc(S.short)}</span>${w ? `<span class="d">${w}</span>` : ''}</div>`;
  }
  const A = guideAims(), a = A.find((q) => /RP/.test((q.m && q.m[1]) || '')) || A[0];
  if (!a) return '';
  const pct = a.m ? Math.round(clamp(a.m[0], 0, 1) * 100) : null;
  const t = a.t.replace(/^Realm rank (\d+):.*$/, 'Realm rank $1');
  return `<div class="g2-aim" data-g2="goals" title="Your aims: open them in the Chronicle"><span class="gem"></span><span class="t">${esc(t)}</span>${pct != null ? `<span class="d">${pct}%</span><i><b style="width:${pct}%"></b></i>` : ''}</div>`;
}
// (a line, not a button: on a touch screen the whole panel is the target, 40 px and more; a mouse clicks the line)
$('war').addEventListener('click', (e) => {
  const b = e.target.closest('[data-g2]') || (IS_TOUCH ? $('war').querySelector('[data-g2]') : null);
  if (!b || UI.modal) return;
  sfx('click');
  openChronicle(b.dataset.g2);
});

/* ------------------------------------------------------------------ */
/* help, the Chronicle and tips for what came since                    */
/* ------------------------------------------------------------------ */
CHRON_EXTRA.sieges.push(() => `<h3>Scaffolds and masons</h3><p>In peace a keep mends a fallen tower, a breached wall and a burnt stretch of palisade behind scaffolding: standards, ledgers, boards at every lift and ladders up to them. Its boards carry you and its ladders climb like a tower's (walk into one, or ${g2Use()}). Two masons come out of the keep's hall to work on it, one at its foot and one up on the boards, and go home when the work is done or a foe comes near.</p><h3>Stones on houses</h3><p>A siege stone that strikes a house on its way cracks its walls; one that falls on its roof holes it, and the rain comes in through the hole. Enough of them bring the house down to rubble, and its town builds it back as after a fire.</p>`);
LOADING_TIPS.push(
  'Every field note you have been given waits in the Chronicle\'s Field notes page.',
  'A long page of the Chronicle folds on a phone: tap a heading to open it.',
  'In peace a keep mends its breaches behind scaffolding: its boards carry you and its ladders climb.',
  'Two masons come out of a keep\'s hall to mend its walls, and go home when a foe comes near.',
  'Set a burh\'s timber alight with a brand: its people leave their posts to beat the fire out.',
  'Siege stones break houses: a holed roof lets the rain in, and a house struck often enough falls to rubble.',
  'Your aim shows on the war panel: tap it for the Chronicle\'s Aims page.',
);

/* ------------------------------------------------------------------ */
/* the frame                                                           */
/* ------------------------------------------------------------------ */
// the lakes' note only where ice is near you: 05k_seasons.js gives the note at boot (seasonsInit replaces the one 10e_guide.js
// had guarded) and queues it when ice lies anywhere, so a player in Ériu in spring was told of the ice; it waits now
const g2LakeIceOk = () => { const P = GAME.player; return !!(P && typeof SICE !== 'undefined' && SICE.on && guideIceNear(P)); };
function updateGuide2(dt) {
  const P = GAME.player;
  if (FIELD_NOTES.lakeice && FIELD_NOTES.lakeice.ok !== g2LakeIceOk) FIELD_NOTES.lakeice.ok = g2LakeIceOk;
  if (!GAME.started || !P || !GAME.prog) return;
  G2.scanT -= dt;
  if (G2.scanT <= 0) { G2.scanT = 1; g2Scan(P); }
  g2UpdatePointer(dt);
}

/* ------------------------------------------------------------------ */
/* test hooks: window.__hm.guide2                                      */
/* ------------------------------------------------------------------ */
queueMicrotask(() => {
  if (!window.__hm) return;
  window.__hm.guide2 = {
    G2, chronFold, chronNotes, g2MarkOf, g2Pointer, g2Scan, guideWarAimHTML, g2TapHeld, g2LevelMark, g2MasterMark, g2WarTable, updateWarPanel, uiToast,
    halls: () => HALL.list, nearHouse: (P) => guideNearest(HOUSES.filter((h) => !h.keepHall && h.state === 'whole'), P),
  };
});
