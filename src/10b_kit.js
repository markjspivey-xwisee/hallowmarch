/* ================================================================== */
/* kit: equipment, bags, merchants and item cards                       */
/* ================================================================== */
Object.assign(ICONS, {
  axe: '<path d="M5 21L14.6 8.4"/><path d="M11.2 6.2c2.2-3.6 8.2-4 9.6 1.4-3.4 2.4-7.6 2-9.6-1.4z"/><path d="M13.4 9.6l-1.6-1.4"/>',
  mace: '<path d="M5 21l8.6-10.4"/><circle cx="16" cy="7.4" r="3.2"/><path d="M16 2.4v1.6M21 7.4h-1.6M16 12.4v-1.6M11 7.4h1.6"/>',
  staff: '<path d="M6.5 21L16.5 5.5"/><circle cx="17.8" cy="4.2" r="2"/><path d="M14 10.5l3.2 1.2"/>',
  helm: '<path d="M4.5 16.5a7.5 8.5 0 0 1 15 0v2.5h-15z"/><path d="M12 9.5V19M7 15h3M14 15h3"/>',
  hood: '<path d="M5 20.5C5 12 8 4 12 4s7 8 7 16.5"/><path d="M9 20.5c0-4.2 1.3-7 3-7s3 2.8 3 7"/>',
  crown: '<path d="M4 16l1.8-8 4.2 4 2-6 2 6 4.2-4L20 16z"/><path d="M4 19h16"/>',
  chest: '<path d="M8.2 4L4 7l2 5 2-1v9.5h8V11l2 1 2-5-4.2-3c-.9 1.8-2.5 2.7-3.8 2.7S9.1 5.8 8.2 4z"/>',
  gloves: '<path d="M8 21v-4.5L5.2 12.4a1.2 1.2 0 0 1 1.9-1.4L9 13V6.2a1.1 1.1 0 0 1 2.2 0V11V5.2a1.1 1.1 0 0 1 2.2 0V11V6a1.1 1.1 0 0 1 2.2 0v5.5V8a1.1 1.1 0 0 1 2.2 0v7.5L16 21z"/>',
  legs: '<path d="M7 3h10l-.6 6L15.8 21h-3.2L12 11l-.6 10H8.2L7.6 9z"/>',
  cloak: '<path d="M9 3.5h6l1.2 3L20 20.5H4L7.8 6.5z"/><path d="M9 3.5c.8 1.8 5.2 1.8 6 0M12 7v13"/>',
  ring: '<circle cx="12" cy="14.5" r="5.8"/><path d="M9.6 8.6L12 4.6l2.4 4"/>',
  amulet: '<path d="M6 3c0 5.6 2 8.6 6 9.6 4-1 6-4 6-9.6"/><path d="M12 12.6l3 3.2-3 4.2-3-4.2z"/>',
  pelt: '<path d="M6 5.5c3.2 1.3 8.8 1.3 12 0l-1.2 5.3L19 17c-4.2 2.2-9.8 2.2-14 0l2.2-6.2z"/>',
  potion: '<path d="M10 3h4M10.6 3v5.2L6.4 15a4.6 4.6 0 0 0 4 6.2h3.2a4.6 4.6 0 0 0 4-6.2l-4.2-6.8V3"/><path d="M7.6 14.4h8.8"/>',
  bag: '<path d="M7.6 8h8.8l2.8 11.2a2 2 0 0 1-2 2.5H6.8a2 2 0 0 1-2-2.5z"/><path d="M9 8a3 3 0 0 1 6 0"/>',
  coin: '<circle cx="12" cy="12" r="7.5"/><circle cx="12" cy="12" r="4.4"/>',
});
const SLOT_ICON = { head: 'helm', chest: 'chest', hands: 'gloves', legs: 'legs', cloak: 'cloak', ring: 'ring', charm: 'amulet' };
function itemIcon(it, slot) {
  if (!it) return SLOT_ICON[slot] || (slot === 'weapon' ? 'sword' : 'circle');
  if (it.slot === 'junk') return 'pelt';
  if (it.slot === 'weapon') return { sword: 'sword', axe: 'axe', mace: 'mace', staff: 'staff', bow: 'bow' }[it.vis] || 'sword';
  if (it.slot === 'head') return it.vis === 'hood' ? 'hood' : it.vis === 'circlet' ? 'crown' : 'helm';
  return SLOT_ICON[it.slot] || 'circle';
}
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function openKit(mode = 'kit') {
  if (UI.modal && UI.modal !== 'kit') return;
  UI.modal = 'kit';
  UI.kitMode = mode;
  UI.kitShop = mode === 'shop' ? nearMerchant() : null;
  if (mode === 'shop' && !UI.kitShop) UI.kitMode = 'kit';
  UI.kitSel = null; UI.kitHover = null; UI.kitConfirm = null;
  $('kit').hidden = false;
  renderKit();
  sfx('bagOpen');
}
function closeKit() { $('kit').hidden = true; if (UI.modal === 'kit') UI.modal = null; UI.kitSel = null; UI.kitHover = null; }
function toggleKit() { if (UI.modal === 'kit') closeKit(); else openKit('kit'); }

function statSummary() {
  const g = gearTotals(INV.eq);
  const P = GAME.player;
  const row = (k, label) => `<div><small>${label}</small><b>+${k === 'crit' ? g[k].toFixed(g[k] % 1 ? 1 : 0) : Math.round(g[k])}%</b></div>`;
  return `<div class="statsum">${row('dmg', 'Damage')}${row('hp', 'Health')}${row('arm', 'Armour')}${row('crit', 'Critical')}${row('pow', 'Power')}<div><small>Max health</small><b>${fmtInt(P.maxHp)}</b></div></div>`;
}
function itemButton(it, cls, data, slotName) {
  const Q = it ? QUALITY[it.q] : null;
  const ic = iconSvg(itemIcon(it, slotName), 24);
  return `<button type="button" class="${cls}${UI.kitSel && it && UI.kitSel.item === it ? ' sel' : ''}" ${data} style="${Q ? `--qc:${Q.col}` : ''}" aria-label="${it ? esc(it.name) : esc(SLOT_NAME[slotName] || 'Empty')}">${ic}${it && it.slot === 'junk' && it.n > 1 ? `<span class="cnt">${it.n}</span>` : ''}</button>`;
}
function renderKit() {
  if ($('kit').hidden) return;
  const P = GAME.player;
  const shop = UI.kitMode === 'shop' && UI.kitShop;
  $('kit-title').textContent = shop ? `${UI.kitShop.merchant.name}'s stall` : `${P.name}'s kit`;
  $('kit-gold').innerHTML = `${iconSvg('coin', 16)}${fmtInt(INV.gold)} gold`;
  let left = '';
  if (shop) {
    const R = UI.kitShop, st = merchantStock(R), pp = potionPrice();
    left = `<h3>For sale</h3>
      ${wearShopRow()}
      <div class="shoprow potionrow"><span class="ic" style="--qc:#e0605a">${iconSvg('potion', 22)}</span><span class="nm">Healing draught<small>Restores 40% of your health. ${INV.potions} / ${POTION.max} carried.</small></span><span class="pr">${fmtInt(pp)}</span><span class="bb"><button class="btn" type="button" data-buyp="1">Buy</button><button class="btn" type="button" data-buyp="5">Buy 5</button></span></div>
      ${st.items.map((it, i) => `<button type="button" class="shoprow item${UI.kitSel && UI.kitSel.item === it ? ' sel' : ''}" data-shop="${i}" style="--qc:${QUALITY[it.q].col}"><span class="ic">${iconSvg(itemIcon(it), 22)}</span><span class="nm">${esc(it.name)}<small>${itemLine(it)} · level ${it.lvl}</small></span><span class="pr">${fmtInt(buyPrice(it))}</span></button>`).join('') || '<p>Sold out for now.</p>'}
      <p class="fineprint">New stock arrives as you grow stronger.</p>`;
  } else {
    left = `<h3>Equipped</h3><div class="eqgrid">${SLOTS.map((s) => {
      const it = INV.eq[s], Q = it ? QUALITY[it.q] : null;
      return `<button type="button" class="eqslot${UI.kitSel && it && UI.kitSel.item === it ? ' sel' : ''}${itemBroken(it) ? ' broken' : ''}" data-eq="${s}" style="${Q ? `--qc:${Q.col}` : ''}"><span class="ic">${iconSvg(itemIcon(it, s), 22)}</span><span class="nm">${it ? esc(it.name) : SLOT_NAME[s]}<small>${it ? (itemBroken(it) ? 'Broken' : itemLine(it)) : 'Empty'}</small></span>${wearSlotBar(it)}</button>`;
    }).join('')}</div>${statSummary()}`;
  }
  const cells = [];
  for (let i = 0; i < BAG_SIZE; i++) {
    const it = INV.bag[i];
    cells.push(it ? itemButton(it, 'bagslot', `data-bag="${i}"`) : '<span class="bagslot empty"></span>');
  }
  const right = `<h3>Bags <span class="num">${INV.bag.length} / ${BAG_SIZE}</span></h3><div class="bagrid">${cells.join('')}</div>
    <div class="bagfoot"><span class="pots">${iconSvg('potion', 18)}${INV.potions} healing draught${INV.potions === 1 ? '' : 's'}</span>${shop ? '<button class="btn" type="button" id="kit-junk">Sell grey and trophies</button>' : ''}</div>`;
  $('kit-left').innerHTML = left;
  $('kit-right').innerHTML = right;
  renderKitCard();
}
function compareLines(it, other) {
  const keys = new Set([...Object.keys(it.st), ...Object.keys(other ? other.st : {})]);
  const out = [];
  for (const k of STAT_ORDER) {
    if (!keys.has(k)) continue;
    const d = (it.st[k] || 0) - (other ? other.st[k] || 0 : 0);
    if (Math.abs(d) < 0.05) continue;
    out.push(`<span class="${d > 0 ? 'up' : 'down'}">${d > 0 ? '+' : '−'}${k === 'crit' ? Math.abs(d).toFixed(Math.abs(d) % 1 ? 1 : 0) : Math.round(Math.abs(d))}% ${STAT_NAME[k]}</span>`);
  }
  return out;
}
function renderKitCard() {
  const box = $('kit-card');
  const sel = UI.kitHover || UI.kitSel;
  if (!sel || !sel.item) {
    box.innerHTML = `<p class="hint">${IS_TOUCH ? 'Tap an item to see it.' : 'Click an item to see it; double-click to equip it.'} Loot drops where foes fall. Walk over it to pick it up.</p>`;
    return;
  }
  const it = sel.item, Q = QUALITY[it.q], where = sel.where;
  const shop = UI.kitMode === 'shop' && UI.kitShop;
  let html = `<b class="in" style="--qc:${Q.col}">${esc(it.name)}</b>`;
  if (it.slot === 'junk') {
    html += `<span class="sub">Trophy${it.n > 1 ? ` · ${it.n} carried` : ''}. Merchants pay for these.</span><span class="val">${iconSvg('coin', 14)}Worth ${fmtInt(sellValue(it))} gold</span>`;
  } else {
    const req = itemReq(it), lowLv = GAME.prog.level < req, wrong = it.cls && it.cls !== GAME.player.cls;
    html += `<span class="sub">${Q.name} ${SLOT_NAME[it.slot].toLowerCase()}${it.base !== SLOT_NAME[it.slot] ? ' · ' + esc(it.base.toLowerCase()) : ''} · item level ${it.lvl}${wrong ? ` · <span class="down">${CLASSES[it.cls].name} only</span>` : ''}${lowLv ? ` · <span class="down">needs level ${req}</span>` : ''}</span>`;
    html += `<ul>${STAT_ORDER.filter((k) => it.st[k]).map((k) => `<li>${statText(k, it.st[k])}</li>`).join('')}${it.glow ? `<li class="glow" style="--gc:${['', '#ff8a3a', '#7cc4ff', '#ffe08a', '#c58cff', '#8cf07a', '#9cc8ff'][it.glow]}">Enchanted: ${GLOW_KIND[it.glow]}</li>` : ''}</ul>`;
    html += wearCardLines(it); // feature/weather: durability, mud and blood
    const eq = INV.eq[it.slot];
    if (where !== 'eq' && eq !== it) {
      const lines = compareLines(it, eq);
      html += `<span class="cmp">${eq ? `Against your ${esc(eq.name)}:` : 'Nothing worn there yet:'} ${lines.join(', ') || 'no change'}</span>`;
    }
    html += `<span class="val">${iconSvg('coin', 14)}${where === 'shop' ? `Costs ${fmtInt(buyPrice(it))} gold` : `Sells for ${fmtInt(sellValue(it))} gold`}</span>`;
  }
  const acts = [];
  if (where === 'bag' && it.slot !== 'junk') acts.push(['Equip', 'equip', !!canEquip(it)]);
  if (where === 'eq') acts.push(['Take off', 'unequip', false]);
  if (where === 'bag' && shop) acts.push([`Sell for ${fmtInt(sellValue(it))}`, 'sell', false]);
  if (where === 'shop') acts.push([`Buy for ${fmtInt(buyPrice(it))}`, 'buy', INV.gold < buyPrice(it)]);
  if (where === 'bag' && !shop) acts.push([UI.kitConfirm === it ? 'Press again to throw away' : 'Throw away', 'discard', false]);
  html += `<div class="acts">${acts.map(([l, a, dis]) => `<button class="btn${a === 'equip' || a === 'buy' ? ' primary' : ''}" type="button" data-act="${a}" ${dis ? 'disabled' : ''}>${l}</button>`).join('')}</div>`;
  box.innerHTML = html;
}
function kitItemFrom(el) {
  if (!el) return null;
  if (el.dataset.bag !== undefined) { const it = INV.bag[+el.dataset.bag]; return it ? { item: it, where: 'bag' } : null; }
  if (el.dataset.eq !== undefined) { const it = INV.eq[el.dataset.eq]; return it ? { item: it, where: 'eq', slot: el.dataset.eq } : null; }
  if (el.dataset.shop !== undefined && UI.kitShop) { const it = merchantStock(UI.kitShop).items[+el.dataset.shop]; return it ? { item: it, where: 'shop' } : null; }
  return null;
}
function kitAction(a) {
  const sel = UI.kitSel;
  if (!sel) return;
  const it = sel.item;
  if (a === 'equip') { if (equipItem(it)) UI.kitSel = { item: it, where: 'eq', slot: it.slot }; }
  else if (a === 'unequip') { if (unequip(sel.slot || it.slot)) UI.kitSel = { item: it, where: 'bag' }; }
  else if (a === 'sell') { if (sellItem(it)) UI.kitSel = null; }
  else if (a === 'buy') { if (buyItem(UI.kitShop, it)) UI.kitSel = { item: it, where: 'bag' }; }
  else if (a === 'discard') {
    if (UI.kitConfirm !== it) { UI.kitConfirm = it; renderKitCard(); return; }
    const i = INV.bag.indexOf(it);
    if (i >= 0) INV.bag.splice(i, 1);
    UI.kitSel = null; UI.kitConfirm = null; saveSoon();
  }
  renderKit();
}
function bindKit() {
  const kit = $('kit');
  kit.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.id === 'kit-close') { closeKit(); return; }
    if (b.id === 'kit-junk') { sellJunk(); renderKit(); return; }
    if (b.id === 'kit-repair') { repairAll(); renderKit(); return; } // feature/weather
    if (b.dataset.buyp) { buyPotions(+b.dataset.buyp); renderKit(); return; }
    if (b.dataset.act) { kitAction(b.dataset.act); return; }
    const s = kitItemFrom(b);
    if (s) { UI.kitSel = s; UI.kitConfirm = null; UI.kitHover = null; renderKit(); sfx('click'); }
  });
  kit.addEventListener('dblclick', (e) => {
    const b = e.target.closest('button');
    const s = kitItemFrom(b);
    if (!s) return;
    UI.kitSel = s;
    if (s.where === 'bag' && s.item.slot !== 'junk') kitAction(UI.kitMode === 'shop' ? 'sell' : 'equip');
    else if (s.where === 'eq') kitAction('unequip');
  });
  if (!IS_TOUCH) {
    kit.addEventListener('pointerover', (e) => {
      const s = kitItemFrom(e.target.closest('button'));
      if (s && (!UI.kitHover || UI.kitHover.item !== s.item)) { UI.kitHover = s; renderKitCard(); }
    });
    kit.addEventListener('pointerout', (e) => {
      if (!UI.kitHover) return;
      const to = e.relatedTarget && e.relatedTarget.closest ? kitItemFrom(e.relatedTarget.closest('button')) : null;
      if (!to) { UI.kitHover = null; renderKitCard(); }
    });
  }
  bgClose('kit', () => closeKit());
}
bindKit();

/* a banner when something good drops */
function uiLootToast(it) {
  const host = $('banners');
  const d = document.createElement('div');
  const Q = QUALITY[it.q];
  d.className = 'banner panel loot' + (it.q >= 5 ? ' legend' : '');
  d.style.setProperty('--rcol', Q.col);
  d.innerHTML = `<small>${Q.name} ${SLOT_NAME[it.slot].toLowerCase()}</small><span style="color:${Q.col}">${esc(it.name)}</span>`;
  host.appendChild(d);
  setTimeout(() => d.remove(), 6200);
  while (host.childNodes.length > 3) host.removeChild(host.firstChild);
}
/* the potion button next to the abilities */
function updatePotionSlot() {
  const rem = Math.max(0, INV.potionAt + POTION.cd - GAME.t);
  for (const s of document.querySelectorAll('.slot.potion')) {
    setT(s.querySelector('.cnt'), String(INV.potions));
    s.style.setProperty('--p', rem > 0 ? (rem / POTION.cd).toFixed(3) : 0);
    setT(s.querySelector('.cdt'), rem > 1 ? Math.ceil(rem) : '');
    s.classList.toggle('empty', INV.potions <= 0);
  }
}
