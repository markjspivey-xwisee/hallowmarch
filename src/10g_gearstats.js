/* ================================================================== */
/* [gearstats] What gear's stats do, said where players look           */
/* ================================================================== */
// A playtester could not find the gear's stats or what Damage and Power did. The kit's sums were bare numbers. A
// piece's card opened at the foot of the kit, below the bags and the goods, out of sight on a desk and on a phone. No
// page said what a stat did. Now:
// - each stat in the kit is a button that opens its card (what it does, with your own numbers and the pieces it comes
//   from);
// - a piece's card names what each of its stats does and stays in view at the foot of the kit;
// - the Character page shows the stats in a fight;
// - the Chronicle's Gear page explains each one;
// - a field note, How to play and a tip say where to look.
const GS_CRIT_BASE = 8; // every blow's chance of being critical, in % (computeDamage, 07_entities.js)
const GS_REGEN = [2.5, 9]; // power back each second, % of the pool: in a fight, out of one (updatePlayer, 09_player.js)
const GEAR_STAT_INFO = {
  dmg: { name: 'Damage', short: 'harder blows' },
  hp: { name: 'Health', short: 'more health' },
  arm: { name: 'Armour', short: 'less harm taken' },
  crit: { name: 'Critical', short: 'more critical hits' },
  pow: { name: 'Power', short: 'more power' },
};
const GS_SLOT_WORD = { weapon: 'weapons', head: 'helms and hoods', chest: 'coats and robes', hands: 'gloves', legs: 'leggings', cloak: 'cloaks', ring: 'rings', charm: 'charms' };
const gsPct = (v) => { const r = Math.round((+v || 0) * 10) / 10; return r % 1 ? r.toFixed(1) : String(Math.round(r)); };
const gsTap = () => (IS_TOUCH ? 'tap' : 'click');
const gsKitKey = () => (IS_TOUCH ? 'the Kit button' : 'I');
function gsList(a) { return a.length < 2 ? a.join('') : `${a.slice(0, -1).join(', ')} and ${a[a.length - 1]}`; }

/* the player's numbers now: gear's share and what it comes to */
function gsNow() {
  const P = GAME.player, g = gearTotals(INV.eq), C = (P && CLASSES[P.cls]) || { dr: 0, name: '' };
  const own = (C.dr || 0) * 100;
  const all = (1 - (1 - (C.dr || 0)) * (1 - g.arm / 100)) * 100; // the drBase setupStats gives (07_entities.js)
  const critAll = GS_CRIT_BASE + Math.max(0, ((P && P.critBonus) || 0) * 100);
  const critBoon = Math.max(0, critAll - GS_CRIT_BASE - g.crit); // a veteran's boons (10l_late.js)
  return { g, own, all, critAll, critBoon, hp: P ? P.maxHp : 0, pow: P ? P.maxPower : 0, cls: C.name || 'Your calling' };
}

/* what a stat does, in a sentence or three, with the player's numbers */
function gsWhat(k, n) {
  const p = gsPct(n.g[k]);
  if (k === 'dmg') return `Every blow, arrow and spell you deal strikes ${p}% harder than it would without your gear. Heals are not changed: they mend a share of health. Each realm rank adds 1.5% more.`;
  if (k === 'hp') return `You have ${p}% more health than you would without your gear: ${fmtInt(n.hp)} in all. Heals, healing draughts and rest mend a share of it, so they mend more too.`;
  if (k === 'arm') return `Every blow, arrow and spell that strikes you does ${p}% less harm. ${n.own > 0 ? `Your calling's own armour (${gsPct(n.own)}%) adds to it: ${gsPct(n.all)}% less in all.` : `${n.cls}s wear no armour of their own.`} Gear's armour stops at ${ARMOUR_CAP}%, and a bodkin or Deadeye goes through half of it, lightning through all of it.`;
  if (k === 'crit') return `${gsPct(n.critAll)}% of your blows, arrows and spells are critical and strike half again as hard: ${GS_CRIT_BASE}% for everyone${n.g.crit ? `, ${p}% from your gear` : ''}${n.critBoon >= 0.05 ? ` and ${gsPct(n.critBoon)}% from your boons` : ''}.`;
  return `Your power (the blue bar your abilities spend) is ${p}% deeper: ${fmtInt(n.pow)} in all. It comes back by a share of itself each second (${GS_REGEN[0]}% in a fight, ${GS_REGEN[1]}% out of one), so a deeper pool lasts more abilities and fills faster.`;
}

/* which pieces carry a stat (SLOT_DEF, 06b_items.js) */
function gsFrom(k) {
  const main = [], some = [];
  for (const s of SLOTS) {
    const D = SLOT_DEF[s];
    if (D.prim && D.prim.some((x) => x[0] === k)) main.push(GS_SLOT_WORD[s]);
    else if (D.pick && D.pick.includes(k)) some.push(GS_SLOT_WORD[s]);
  }
  const on = main.length ? `${gsList(main)}${some.length ? `, and some ${gsList(some)}` : ''}` : `some ${gsList(some)}`;
  return `Comes on ${on}. Fine gear and better may add it to any piece.`;
}
/* what you wear gives it */
function gsSources(k) {
  const out = [];
  for (const s of SLOTS) {
    const it = INV.eq[s];
    if (!it || !it.st || !it.st[k]) continue;
    out.push(itemBroken(it) ? `${esc(it.base)} (broken: nothing)` : `${esc(it.base)} +${gsPct(it.st[k])}%`);
  }
  return out.length ? `From what you wear: ${out.join(', ')}.` : 'Nothing you wear gives it yet.';
}

/* the kit: the stats as buttons, each opening its card */
function gsSummaryHTML() {
  const g = gearTotals(INV.eq), P = GAME.player, sel = UI.kitSel && UI.kitSel.stat;
  const cell = (k) => `<button type="button" class="gs-cell${sel === k ? ' sel' : ''}" data-stat="${k}" aria-label="${GEAR_STAT_INFO[k].name}: what it does"><small>${GEAR_STAT_INFO[k].name}</small><b>+${gsPct(g[k])}%</b><i>${GEAR_STAT_INFO[k].short}</i></button>`;
  return `<div class="statsum">${STAT_ORDER.map(cell).join('')}<div><small>Max health</small><b>${fmtInt(P.maxHp)}</b><i>power ${fmtInt(P.maxPower)}</i></div></div><p class="gs-tap">${IS_TOUCH ? 'Tap' : 'Click'} a stat to see what it does.</p>`;
}
function gsCloseHTML() { return UI.kitSel ? '<button type="button" class="gs-x" data-act="clear" aria-label="Close this card">✕</button>' : ''; }
function gsCardHTML(k) {
  const I = GEAR_STAT_INFO[k] || GEAR_STAT_INFO.dmg, n = gsNow();
  return `${gsCloseHTML()}<b class="in" style="--qc:var(--bronze-hi)">${I.name} +${gsPct(n.g[k])}%</b><span class="sub">${I.short[0].toUpperCase() + I.short.slice(1)}, from your gear</span><p class="gs-what">${gsWhat(k, n)}</p><span class="cmp">${gsSources(k)}</span><div class="acts"><button class="btn" type="button" data-act="stats">Every stat explained</button></div>`;
}
/* a piece's stat on its card, with what it does */
function gsStatLi(k, v) { return `<li>${statText(k, v)}<small class="gs-why">${GEAR_STAT_INFO[k] ? GEAR_STAT_INFO[k].short : ''}</small></li>`; }
// the card lies over the foot of the kit's view: what you tapped is kept above it (the sheet's scroll padding is the
// card's height, so a scroll into view stops short of it)
function gsKeepInView() {
  const sheet = document.querySelector('#kit .sheet'), box = $('kit-card');
  if (sheet && box) sheet.style.scrollPaddingBottom = `${box.offsetHeight + 8}px`;
}
function gsReveal(s) {
  if (!s) return;
  gsKeepInView();
  const q = s.stat ? '#kit .statsum' : s.where === 'bag' ? `#kit [data-bag="${INV.bag.indexOf(s.item)}"]` : s.where === 'eq' ? `#kit [data-eq="${s.slot || s.item.slot}"]` : s.where === 'shop' ? '#kit .shoprow.sel' : null;
  const el = q && document.querySelector(q);
  if (el && el.scrollIntoView) el.scrollIntoView({ block: 'nearest' });
}
function gsKitAction(a) {
  if (a === 'clear') { UI.kitSel = null; UI.kitHover = null; UI.kitConfirm = null; renderKit(); return true; }
  if (a === 'stats') { closeKit(); openChronicle('gear'); return true; }
  return false;
}

/* every stat, what it does and where it comes from (the Chronicle's Gear page, the Character page) */
function gsListHTML(from) {
  const n = gsNow();
  return `<ul class="plain gs-list">${STAT_ORDER.map((k) => `<li><b>${GEAR_STAT_INFO[k].name}</b> <span class="gs-num">+${gsPct(n.g[k])}%</span>. ${gsWhat(k, n)}${from ? `<span class="gs-from">${gsFrom(k)}</span>` : ''}</li>`).join('')}</ul>`;
}
function gsChronHTML() {
  return `<h3 data-cf-open>What the stats do</h3>
    <p>Every piece of gear adds to five stats. Your numbers now:</p>
    ${gsListHTML(true)}
    <p>To see what a piece gives, open your kit (${gsKitKey()}) and ${gsTap()} it. Its card lists its stats and what it would change against what you wear. ${IS_TOUCH ? 'Tap' : 'Click'} a stat in your kit for the pieces it comes from.</p>`;
}

/* the Character page: the stats in a fight */
function gsCharHTML() {
  const n = gsNow(), g = n.g;
  const cell = (label, val, sub) => `<div class="stat"><small>${label}</small><b>${val}</b><i class="gs-sub">${sub}</i></div>`;
  return `<h4 class="gs-h">In a fight</h4>
    <div class="stats gs-stats">
      ${cell('Health', fmtInt(n.hp), `+${gsPct(g.hp)}% from gear`)}
      ${cell('Power', fmtInt(n.pow), `+${gsPct(g.pow)}% from gear`)}
      ${cell('Damage', `+${gsPct(g.dmg)}%`, 'harder blows')}
      ${cell('Armour', `${gsPct(n.all)}%`, 'less harm taken')}
      ${cell('Critical', `${gsPct(n.critAll)}%`, 'of your blows')}
      <button type="button" class="stat gs-kit" data-gs="kit"><small>Your gear</small><b>Kit ›</b><i class="gs-sub">compare, wear</i></button>
    </div>
    <details class="gs-more"><summary>What do these do?</summary>${gsListHTML(false)}<div class="acts"><button class="btn" type="button" data-gs="chron">The Chronicle's Gear page</button></div></details>`;
}
function gsCharWire(body) {
  for (const b of body.querySelectorAll('[data-gs]')) {
    b.onclick = () => {
      if (b.dataset.gs === 'kit') { closeMenu(); openKit('kit'); }
      else openChronicle('gear');
    };
  }
}

/* the first word of it: a field note, How to play, a tip */
if (!FIELD_NOTES.gearstats) FIELD_NOTES.gearstats = { t: 'What your gear gives', x: () => `Every piece adds to five stats: Damage (harder blows), Health, Armour (less harm taken), Critical (blows half again as hard) and Power (for your abilities). In your kit (${gsKitKey()}), ${gsTap()} a stat to see what it does.` };
else reportError(new Error('[gearstats] the field note "gearstats" is another module\'s'));
GUIDE_WATCH.gearstats = () => !!GAME.prog && (GAME.prog.level >= 4 || INV.bag.some((it) => it && SLOT_DEF[it.slot]));
GUIDE_HELP.splice(4, 0, () => `<h3>What your gear's stats do</h3><p><b>Damage</b> makes every blow, arrow and spell you deal harder. <b>Health</b> raises your health. <b>Armour</b> takes a share off every blow that strikes you (gear's stops at ${ARMOUR_CAP}%). <b>Critical</b> is the chance a blow strikes half again as hard (${GS_CRIT_BASE}% for everyone, more with gear). <b>Power</b> deepens the pool your abilities spend, and it refills faster. In your kit (${gsKitKey()}), ${gsTap()} a stat for your own numbers, or a piece to compare it with what you wear.</p>`); // right after Loot and gear (10e_guide.js), in the order a player meets them
LOADING_TIPS.push(`Gear has five stats: Damage, Health, Armour, Critical and Power. In your kit, ${gsTap()} a stat to see what it does, and ${gsTap()} a piece to compare it with what you wear.`);

queueMicrotask(() => { if (window.__hm) window.__hm.gearstats = { GEAR_STAT_INFO, gsNow, gsWhat, gsFrom, gsSources, gsCardHTML, gsCharHTML, gsListHTML }; });
