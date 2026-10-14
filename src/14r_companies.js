/* ================================================================== */
/* [companies] Companies: lasting teams of a realm, kept by the server */
/* ================================================================== */
// Version 20. On the March's own server (14p_netws.js; server/companies.js) the players of a realm may band together in
// a company that lasts the season and beyond: a name and a device of its own (the veteran's ten devices, 04_l3device.js,
// on a shield of two of the realm's tinctures), a captain, officers and members (30 at most), its own chat kept for whoever
// was away, a notice the captain sets ("We muster at Kestrel Hold on day 12"), its roster (who is on, what each brought
// today and this season, the keeps taken with them about), its tally for the season (its members' deliveries and captures
// counted together, its points, its standing among the realm's companies on the Season page) and a pledge for one of the
// realm's works (the members' goods go to that work first). A captain or an officer musters the company: its members in
// the March now form one party at once (14o_netui.js's party). A member's company shows under its name on its nameplate
// and frame to the others (stamped by the server: a page cannot claim one). All of it in the Players sheet's Company part
// (P, or the Players button), by keys or by taps. Alone it does not run; inside the artifact's room (rung 1) the sheet says
// plainly that companies are kept by the March's own server. Every name and line from another player is set as text.
const CO = { s: null, q: 0, waits: new Map(), ver: 0, noted: false, told: false, dev: 2, col: [0, 3], busy: false, msg: '', bad: false, stats: { msgs: 0, said: 0, heard: 0, musters: 0, asks: 0 } };
const CO_DEV_NAMES = ['Crossed blades', 'Upright blade', 'Tower', 'Chalice', 'Wreath', 'Flame', 'Crowned skull', 'Hammer', 'Peak', 'Star'];
const CO_TINCT_NAMES = ['colour', 'light', 'dark', 'gold', 'silver'];
const coTinct = (r, i) => { const R = REALMS[NET_REALM_OK(r) ? r : 0]; return [R.color, R.light, R.dark, '#d4a944', '#e2e2da'][i] || R.color; };
const coLinked = () => typeof NETWS !== 'undefined' && NETWS.state === 'on' && NET.link && NET.link.kind === 'ws';
const coMine = () => (CO.s && CO.s.co) || null;
const coLead = () => { const c = coMine(); return !!c && (c.role === 'cap' || c.role === 'off'); };
// the device on a shield of two tinctures, in SVG (the sheet, the Season page): drawn from numbers only
const CO_DEV_SVG = [
  '<path d="M7 7l10 10M17 7L7 17" stroke-width="2.2"/><path d="M5.5 13l5.5 5.5M13 18.5l5.5-5.5" stroke-width="1.6"/>',
  '<path d="M12 4.5v12" stroke-width="2.4"/><path d="M8 15.5h8M12 17v3" stroke-width="1.8"/>',
  '<path d="M8 19V9h8v10z" stroke-width="1.6"/><path d="M7.5 9V6.5h2v1.5h1.5V6.5h2v1.5h1.5V6.5h2V9" stroke-width="1.4"/><path d="M11 19v-3h2v3" stroke-width="1.2"/>',
  '<path d="M7.5 6.5h9c0 4-2 6.5-4.5 6.5S7.5 10.5 7.5 6.5z" stroke-width="1.6"/><path d="M12 13v4M9 19h6" stroke-width="1.8"/>',
  '<circle cx="12" cy="12" r="5.5" stroke-width="1.8"/><path d="M7 9l-1.5-1M7 15l-1.5 1M17 9l1.5-1M17 15l1.5 1M12 6.5V5" stroke-width="1.4"/>',
  '<path d="M12 4.5c3 3.5 5 6 5 9a5 5 0 0 1-10 0c0-2 1-3.5 2.2-4.6.2 1.6 1 2.6 2.1 2.9C11 9.6 11.2 7 12 4.5z" stroke-width="1.5"/>',
  '<path d="M8 8.5l1.5-2.5 2.5 2 2.5-2L16 8.5" stroke-width="1.4"/><path d="M8.2 13a3.8 3.8 0 1 1 7.6 0c0 1.4-.7 2.2-1.4 2.6v2h-4.8v-2c-.7-.4-1.4-1.2-1.4-2.6z" stroke-width="1.5"/><circle cx="10.6" cy="13" r=".8"/><circle cx="13.4" cy="13" r=".8"/>',
  '<path d="M7 6.5h8v4H7z" stroke-width="1.6"/><path d="M11 10.5V19" stroke-width="2.2"/>',
  '<path d="M4.5 18.5L10 8l3 5 2-2.5 4.5 8z" stroke-width="1.6"/>',
  '<path d="M12 4.8l2.1 4.6 5 .5-3.8 3.3 1.1 4.9L12 15.6l-4.4 2.5 1.1-4.9L4.9 9.9l5-.5z" stroke-width="1.5"/>',
];
function coShield(realm, dev, col, size = 28) {
  const f = coTinct(realm, col && col[0] | 0), c = coTinct(realm, col && col[1] | 0), d = CO_DEV_SVG[dev | 0] || CO_DEV_SVG[0];
  return `<svg class="co-shield" width="${size}" height="${size}" viewBox="0 0 24 24" aria-hidden="true"><path d="M3.5 3h17v8.5c0 5-3.6 8.2-8.5 10.3C7.1 19.7 3.5 16.5 3.5 11.5z" fill="${f}" stroke="rgba(0,0,0,0.7)" stroke-width="1"/><g fill="none" stroke="${c}" stroke-linecap="round" stroke-linejoin="round">${d.replace(/<circle cx="(10.6|13.4)"/g, `<circle fill="${c}" cx="$1"`)}</g></svg>`;
}

/* ------------------------------------------------------------------ */
/* the server's word (14p_netws.js hands `company` and `co` here)      */
/* ------------------------------------------------------------------ */
function coMsg(m) {
  if (m.t === 'co') { const w = CO.waits.get(m.q); if (w) { CO.waits.delete(m.q); w(m); } return; }
  if (m.t !== 'company') return;
  CO.stats.msgs++;
  const P = GAME.player;
  if (m.s && typeof m.s === 'object') {
    const was = coMine();
    CO.s = coRead(m.s); CO.ver++;
    const now = coMine();
    if (m.first && now && P && !CO.told) {
      // a returning member: the notice and what was said while it was away
      CO.told = true;
      const seen = netNum(m.seen, 0, 1e15);
      const missed = now.chat.filter((L) => L[0] > seen && L[1]);
      if (now.notice.x) uiLog(`${now.n}'s notice: ${now.notice.x}`, 'sys');
      for (const L of missed.slice(-6)) uiLog(`[Company] ${L[1]} (while you were away): ${L[2]}`, 'chat', P.faction);
      if (missed.length) uiToast(`${now.n}: ${missed.length} ${missed.length === 1 ? 'line' : 'lines'} said while you were away. ${IS_TOUCH ? 'The Players button' : 'P'} opens the company.`, 'hint');
    }
    if (was && !now && P) uiLog(`You are no longer of ${was.n}.`, 'sys');
    if (!was && now && P && !m.first) uiLog(`You are of ${now.n} now.`, 'sys');
    if (P && !CO.noted && (now || (CO.s && !CO.s.guest))) { CO.noted = true; loreNote('netcompany'); }
    if (CO.s && CO.s.invites && CO.s.invites.length) netSheetBadge();
    coSheetRender();
  }
  if (Array.isArray(m.say) && coMine() && m.co === coMine().id) {
    const L = [netNum(m.say[0], 0, 1e15), netStr(m.say[1], 24), netStr(m.say[2], 140)];
    if (!L[2]) return;
    const c = coMine();
    c.chat.push(L); if (c.chat.length > 40) c.chat.shift();
    CO.ver++; CO.stats.heard++;
    if (P) {
      uiLog(`[Company] ${L[1]}: ${L[2]}`, 'chat', P.faction);
      if (L[1] !== NETWS.acct?.name && IS_TOUCH && !$('log').classList.contains('show') && !NETUI.open) uiToast(`${L[1]}: ${L[2]}`);
    }
    coSheetRender();
  }
  if (m.invited && typeof m.invited === 'object' && P) {
    uiToast(`${netStr(m.invited.by, 24)} invites you to the company ${netStr(m.invited.co, 24)}. ${IS_TOUCH ? 'Tap the Players button' : 'Press P'} to answer.`);
    uiLog(`${netStr(m.invited.by, 24)} invites you to the company ${netStr(m.invited.co, 24)}.`, 'sys');
    netSheetBadge();
  }
  if (m.muster && typeof m.muster === 'object' && P) {
    const M = m.muster, who = netStr(M.by, 24), co = netStr(M.co, 24);
    if (M.full) { uiToast(`${co} musters, but ${who}'s party is full: ${netNum(M.n, 0, 6)} are with them.`, 'hint'); return; }
    if (typeof M.pt !== 'string' || !/^[a-z0-9]{4,24}$/.test(M.pt)) return;
    NET.party = M.pt; NET.partyLead = !!NETWS.acct && who === NETWS.acct.name; NET.slowKey = ''; NET.invites = [];
    CO.stats.musters++;
    uiToast(`${co} musters: ${NET.partyLead ? 'your' : who + "'s"} party of ${netNum(M.n, 0, 6)} is formed.`);
    uiLog(`${co} musters: ${NET.partyLead ? 'you lead' : 'you join ' + who + "'s"} party of ${netNum(M.n, 0, 6)}.`, 'sys');
    sfx('click');
  }
}
// what the server says, read and bounded (as text)
function coRead(o) {
  const s = { guest: !!o.guest, max: netNum(o.max, 1, 99, 30), standing: Array.isArray(o.standing) ? o.standing.slice(0, 12).map(coReadBrief) : [], invites: Array.isArray(o.invites) ? o.invites.slice(0, 8).map(coReadBrief).filter((x) => x.id) : [] };
  const c = o.co;
  if (c && typeof c === 'object') {
    s.co = {
      ...coReadBrief(c), realm: NET_REALM_OK(c.realm) ? c.realm : 0, role: c.role === 'cap' || c.role === 'off' ? c.role : 'mem', pledge: netStr(c.pledge, 16),
      notice: c.notice && typeof c.notice === 'object' ? { x: netStr(c.notice.x, 120), by: netStr(c.notice.by, 24), at: netNum(c.notice.at, 0, 1e15) } : { x: '', by: '', at: 0 },
      pts: netNum(c.pts, 0, 1e9), u: netNum(c.u, 0, 1e12), caps: netNum(c.caps, 0, 1e6),
      pl: c.pl && typeof c.pl === 'object' ? Object.fromEntries(Object.keys(c.pl).slice(0, 8).filter((k) => /^[a-z]{2,16}$/.test(k)).map((k) => [k, netNum(c.pl[k], 0, 1e12)])) : {},
      chat: Array.isArray(c.chat) ? c.chat.slice(-40).filter((L) => Array.isArray(L) && L.length === 3).map((L) => [netNum(L[0], 0, 1e15), netStr(L[1], 24), netStr(L[2], 140)]).filter((L) => L[2]) : [],
      inv: Array.isArray(c.inv) ? c.inv.slice(0, 24).map((x) => netStr(x, 24)) : [],
      mem: Array.isArray(c.mem) ? c.mem.slice(0, 40).filter((M) => M && typeof M.id === 'string').map((M) => ({ id: M.id.slice(0, 40), n: netStr(M.n, 24) || '?', role: M.role === 'cap' || M.role === 'off' ? M.role : 'mem', on: M.on ? 1 : 0, ago: netNum(M.ago, 0, 1e8), du: netNum(M.du, 0, 1e12), u: netNum(M.u, 0, 1e12), c: netNum(M.c, 0, 1e6), r: NET_REALM_OK(M.r) ? M.r : -1 })) : [],
    };
  }
  return s;
}
const coReadBrief = (x) => ({ id: typeof (x && x.id) === 'string' ? x.id.slice(0, 40) : '', n: netStr(x && x.n, 24), dev: Math.round(netNum(x && x.dev, 0, 9)), col: Array.isArray(x && x.col) ? [Math.round(netNum(x.col[0], 0, 4)), Math.round(netNum(x.col[1], 0, 4))] : [0, 3], m: netNum(x && x.m, 0, 99), pts: netNum(x && x.pts, 0, 1e9), u: netNum(x && x.u, 0, 1e12), caps: netNum(x && x.caps, 0, 1e6), by: netStr(x && x.by, 24) });
function coAsk(op, o = {}) {
  return new Promise((res) => {
    const q = ++CO.q;
    CO.stats.asks++;
    if (!netWsSend({ t: 'co', op, q, ...o })) { res({ ok: false, why: "Not linked to the March's server" }); return; }
    CO.waits.set(q, res);
    setTimeout(() => { if (CO.waits.has(q)) { CO.waits.delete(q); res({ ok: false, why: 'The server did not answer' }); } }, 9000);
  });
}

/* ------------------------------------------------------------------ */
/* the Players sheet's Company part                                    */
/* ------------------------------------------------------------------ */
// its own part of the sheet (#netsheet-co), drawn again only when what it shows changes; what is typed in it stays
function coSheetEnsure() {
  let box = $('netsheet-co');
  if (box) return box;
  const acct = $('netsheet-acct');
  if (!acct) return null;
  box = document.createElement('div');
  box.id = 'netsheet-co';
  acct.parentNode.insertBefore(box, acct);
  box.addEventListener('click', (e) => { const b = e.target.closest('button[data-co]'); if (b && !b.disabled) coClick(b); });
  box.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter' && e.target.dataset.go) { e.preventDefault(); const b = box.querySelector(`button[data-co="${e.target.dataset.go}"]`); if (b) coClick(b); }
  });
  return box;
}
function coSheetRender(force) {
  if (!NETUI.open) return;
  const box = coSheetEnsure();
  if (!box) return;
  const mode = !NET.link ? 'off' : NET.link.kind !== 'ws' ? 'room' : !CO.s ? 'wait' : coMine() ? 'co' : 'none';
  const key = `${mode}:${CO.ver}:${CO.dev}:${CO.col}:${CO.busy ? 1 : 0}:${typeof NETS !== 'undefined' && NETS.s ? NETS.s.proj.map((p) => p.id + p.built).join() : ''}`;
  if (!force && box._k === key) { coSay(); return; }
  box._k = key;
  // what is typed and where the caret is stay across a drawing
  const keep = {}, fid = document.activeElement && box.contains(document.activeElement) ? document.activeElement.id : '';
  for (const i of box.querySelectorAll('input')) keep[i.id] = i.value;
  box.textContent = '';
  const el = (tag, cls, txt) => { const d = document.createElement(tag); if (cls) d.className = cls; if (txt != null) d.textContent = txt; return d; };
  const btn = (label, act, extra, data) => { const b = el('button', 'btn' + (extra || ''), label); b.type = 'button'; b.dataset.co = act; if (data) Object.assign(b.dataset, data); if (CO.busy) b.disabled = true; return b; };
  const input = (id, ph, max, go) => { const i = el('input'); i.id = id; i.type = 'text'; i.maxLength = max; i.placeholder = ph; i.autocomplete = 'off'; i.spellcheck = false; if (go) i.dataset.go = go; i.value = keep[id] || ''; return i; };
  const P = GAME.player, realm = P ? P.faction : 0;
  box.appendChild(el('h3', '', 'Company'));
  if (mode === 'off') { box.hidden = true; return; }
  box.hidden = false;
  if (mode === 'room') { box.appendChild(el('p', 'net-quiet', "Companies, the lasting teams of a realm, are kept by the March's own server. Here, in the shared room of this page, there are none: open the March from its server to found or join one.")); return; }
  if (mode === 'wait') { box.appendChild(el('p', 'net-quiet', 'Asking the server for your company...')); return; }
  const S = CO.s, c = coMine();
  const head = (x, sub) => { const h = el('div', 'co-head'); h.innerHTML = coShield(x.realm ?? realm, x.dev, x.col, 34); const t = el('div', 'co-title'); t.appendChild(el('b', '', x.n)); if (sub) t.appendChild(el('small', '', sub)); h.appendChild(t); return h; };
  if (!c) {
    for (const I of S.invites) {
      const row = el('div', 'net-row net-inv');
      row.appendChild(head({ ...I, realm }, `${I.by} invites you · ${I.m} ${I.m === 1 ? 'member' : 'members'}`));
      const acts = el('span', 'net-acts'); acts.appendChild(btn('Join', 'answer', ' primary', { id: I.id, yes: '1' })); acts.appendChild(btn('Decline', 'answer', '', { id: I.id, yes: '' })); row.appendChild(acts);
      box.appendChild(row);
    }
    if (S.guest) box.appendChild(el('p', 'net-quiet', 'A company is a lasting team of your realm: its own name and device, chat, notice and tally for the season. Companies are kept for named accounts: name yours below, then found one or answer an invitation.'));
    else {
      box.appendChild(el('p', 'net-quiet', `A company is a lasting team of your realm (up to ${S.max}): its own name and device, its own chat kept for whoever was away, a notice, and a tally for the season. Found one, or answer an invitation (the captain invites you by your account's name).`));
      const f = el('div', 'co-found');
      const nm = input('co-name', 'The company\'s name (3 to 24 letters)', 24, 'found'); f.appendChild(nm);
      const devs = el('div', 'co-devs'); devs.setAttribute('role', 'radiogroup'); devs.setAttribute('aria-label', 'Device');
      CO_DEV_NAMES.forEach((n, i) => { const b = btn('', 'dev', ' co-dev' + (CO.dev === i ? ' on' : ''), { i: String(i) }); b.innerHTML = coShield(realm, i, CO.col, 26); b.title = n; b.setAttribute('aria-label', n); b.setAttribute('aria-pressed', CO.dev === i ? 'true' : 'false'); devs.appendChild(b); });
      f.appendChild(devs);
      for (const k of [0, 1]) {
        const row = el('div', 'co-tinct'); row.appendChild(el('span', '', k ? 'Device' : 'Field'));
        for (let i = 0; i < 5; i++) { const b = btn('', 'col', ' co-sw' + (CO.col[k] === i ? ' on' : ''), { k: String(k), i: String(i) }); b.style.setProperty('--sw', coTinct(realm, i)); b.setAttribute('aria-label', `${k ? 'Device' : 'Field'}: ${REALMS[realm].name}'s ${CO_TINCT_NAMES[i]}`); b.setAttribute('aria-pressed', CO.col[k] === i ? 'true' : 'false'); row.appendChild(b); }
        f.appendChild(row);
      }
      const acts = el('div', 'net-acts'); acts.appendChild(btn('Found the company', 'found', ' primary')); f.appendChild(acts);
      box.appendChild(f);
    }
  } else {
    box.appendChild(head(c, `${{ cap: 'Captain', off: 'Officer', mem: 'Member' }[c.role]} · ${c.mem.length} of ${S.max} · ${c.mem.filter((M) => M.on).length} on now`));
    const nb = el('div', 'co-notice');
    nb.appendChild(el('span', '', c.notice.x ? `"${c.notice.x}"` : 'No notice.'));
    if (c.notice.x && c.notice.by) nb.appendChild(el('small', '', ` ${c.notice.by}`));
    box.appendChild(nb);
    const proj = typeof NETS !== 'undefined' && NETS.s ? NETS.s.proj : [];
    const pl = proj.find((p) => p.id === c.pledge);
    box.appendChild(el('p', 'co-tally', `This season: ${fmtInt(Math.round(c.pts))} points · ${fmtInt(c.u)} units brought · ${c.caps} ${c.caps === 1 ? 'keep' : 'keeps'} taken${c.pledge ? ` · pledged to ${pl ? pl.label.toLowerCase() : c.pledge}${c.pl[c.pledge] ? ` (${fmtInt(c.pl[c.pledge])} given)` : ''}` : ''}.`));
    if (coLead()) {
      const f = el('div', 'net-fields'); f.appendChild(input('co-notice', 'The notice: "We muster at Kestrel Hold on day 12"', 120, 'notice')); const a = el('div', 'net-acts'); a.appendChild(btn('Set the notice', 'notice')); f.appendChild(a); box.appendChild(f);
      if (proj.length) {
        const pr = el('div', 'net-acts co-pledge'); pr.appendChild(el('span', 'net-quiet', 'Pledge the company\'s goods to:'));
        for (const p of proj) if (!p.built) pr.appendChild(btn(p.label, 'pledge', c.pledge === p.id ? ' primary' : '', { id: c.pledge === p.id ? '' : p.id }));
        box.appendChild(pr);
      }
    }
    // the roster
    const list = el('div', 'co-roster');
    for (const M of c.mem) {
      const row = el('div', 'net-row co-mem' + (M.on ? ' on' : ''));
      row.style.setProperty('--rc', M.on ? '#6fdc7f' : 'var(--line)');
      const nm = el('span', 'net-nm'); nm.appendChild(el('b', '', M.n)); nm.appendChild(el('small', '', ` ${{ cap: 'captain', off: 'officer', mem: '' }[M.role]}${M.role !== 'mem' ? ' · ' : ''}${M.on ? 'on now' : M.ago < 2 ? 'just now' : netsAgo(M.ago * 60) + ' ago'}${M.du ? ` · brought ${fmtInt(M.du)} today` : ''}${M.u ? ` · ${fmtInt(M.u)} this season` : ''}${M.c ? ` · ${M.c} ${M.c === 1 ? 'keep' : 'keeps'}` : ''}${M.r >= 0 && M.r !== c.realm ? ` · now of ${REALMS[M.r].name}` : ''}`));
      row.appendChild(nm);
      if (c.role === 'cap' && NETWS.acct && M.id !== NETWS.acct.id) {
        const acts = el('span', 'net-acts');
        acts.appendChild(btn(M.role === 'off' ? 'Make member' : 'Make officer', 'rank', '', { who: M.id, role: M.role === 'off' ? 'mem' : 'off' }));
        acts.appendChild(btn('Make captain', 'rank', '', { who: M.id, role: 'cap' }));
        acts.appendChild(btn('Remove', 'remove', '', { who: M.id }));
        row.appendChild(acts);
      }
      list.appendChild(row);
    }
    box.appendChild(list);
    if (c.inv.length) box.appendChild(el('p', 'net-quiet', `Invited, waiting for an answer: ${c.inv.join(', ')}.`));
    if (coLead()) { const f = el('div', 'net-fields'); f.appendChild(input('co-inv', "Invite by the account's name", 20, 'invite')); const a = el('div', 'net-acts'); a.appendChild(btn('Invite', 'invite')); f.appendChild(a); box.appendChild(f); }
    // the company's chat
    const lines = el('div', 'net-lines co-lines');
    for (const L of c.chat.slice(-10)) { const d = el('div', 'net-line'); if (L[1]) { d.appendChild(el('b', '', `${L[1]}: `)); d.appendChild(document.createTextNode(L[2])); } else d.appendChild(el('i', '', L[2])); lines.appendChild(d); }
    if (!c.chat.length) lines.appendChild(el('div', 'net-quiet', 'What the company says is kept here for those who were away.'));
    box.appendChild(lines);
    const f = el('div', 'net-fields'); f.appendChild(input('co-say', 'Say to the company', 140, 'say')); const a = el('div', 'net-acts'); a.appendChild(btn('Say', 'say', ' primary')); f.appendChild(a); box.appendChild(f);
    const acts = el('div', 'net-acts');
    if (coLead()) acts.appendChild(btn('Muster the company', 'muster'));
    acts.appendChild(btn('Leave the company', 'leave'));
    box.appendChild(acts);
  }
  // the realm's companies this season
  if (S.standing.length) {
    box.appendChild(el('h3', '', `${REALMS[realm].name}'s companies this season`));
    const ol = el('ol', 'co-standing');
    for (const x of S.standing.slice(0, 6)) { const li = el('li', c && x.id === c.id ? 'on' : ''); li.innerHTML = coShield(realm, x.dev, x.col, 20); li.appendChild(el('span', '', ` ${x.n} · ${fmtInt(Math.round(x.pts))} points · ${x.m} ${x.m === 1 ? 'member' : 'members'}`)); ol.appendChild(li); }
    box.appendChild(ol);
  }
  box.appendChild(el('div', 'net-msg co-msg' + (CO.bad ? ' bad' : ''), CO.msg));
  if (fid && $(fid)) { const i = $(fid); i.focus(); try { i.setSelectionRange(i.value.length, i.value.length); } catch (e) { /* not text */ } }
}
function coSay() { const m = document.querySelector('#netsheet-co .co-msg'); if (m && m.textContent !== CO.msg) { m.textContent = CO.msg; m.classList.toggle('bad', CO.bad); } }
function coTell(msg, bad) { CO.msg = msg || ''; CO.bad = !!bad; coSay(); }
async function coClick(b) {
  const act = b.dataset.co;
  if (act === 'dev') { CO.dev = b.dataset.i | 0; coSheetRender(); return; }
  if (act === 'col') { const k = b.dataset.k | 0, i = b.dataset.i | 0; CO.col[k] = i; if (CO.col[1 - k] === i) CO.col[1 - k] = (i + 3) % 5; coSheetRender(); return; }
  if (CO.busy) return;
  const val = (id) => { const i = $(id); return i ? i.value.trim() : ''; };
  let o = null, done = '';
  if (act === 'found') { const n = val('co-name'); if (n.length < 3) { coTell('A name of 3 to 24 letters.', true); return; } o = { name: n, dev: CO.dev, col: CO.col.slice() }; done = `You found ${n}.`; }
  else if (act === 'answer') { o = { id: b.dataset.id, yes: !!b.dataset.yes }; done = b.dataset.yes ? 'You join the company.' : 'Declined.'; }
  else if (act === 'invite') { const n = val('co-inv'); if (n.length < 3) { coTell("The account's name to invite.", true); return; } o = { name: n }; done = `Invited ${n}: the invitation waits for their next visit if they are away.`; }
  else if (act === 'notice') { o = { text: val('co-notice') }; done = 'The notice is set.'; }
  else if (act === 'say') { const t = netStr(val('co-say'), 140); if (!t) return; o = { text: t }; done = ''; }
  else if (act === 'pledge') { o = { id: b.dataset.id || '' }; done = b.dataset.id ? "The company's goods are pledged." : 'The pledge is taken back.'; }
  else if (act === 'rank') { o = { who: b.dataset.who, role: b.dataset.role }; done = 'Done.'; }
  else if (act === 'remove') { o = { who: b.dataset.who }; done = 'Removed from the company.'; }
  else if (act === 'leave') { o = {}; done = 'You leave the company.'; }
  else if (act === 'muster') { o = {}; done = ''; }
  else return;
  CO.busy = true; sfx('click'); coSheetRender();
  let r;
  try { r = await coAsk(act, o); } finally { CO.busy = false; }
  if (r && r.ok) {
    if (act === 'say') { CO.stats.said++; const i = $('co-say'); if (i) i.value = ''; }
    if (act === 'found' || act === 'invite' || act === 'notice') { const i = $(act === 'found' ? 'co-name' : act === 'invite' ? 'co-inv' : 'co-notice'); if (i) i.value = ''; }
    coTell(act === 'muster' ? `The company musters: ${r.n} in your party${r.left ? ` (${r.left} more on: a party holds six)` : ''}.` : done);
    if (done && act !== 'say') uiLog(done, 'sys');
  } else coTell((r && netStr(r.why, 120)) || 'Not now', true);
  coSheetRender(true);
}
// the sheet's own drawing, and then the company's part (14o_netui.js)
queueMicrotask(() => {
  if (typeof netSheetRender !== 'function' || netSheetRender._co) return;
  const f = netSheetRender;
  // eslint-disable-next-line no-global-assign
  netSheetRender = function () { const r = f.apply(this, arguments); coSheetRender(); return r; };
  netSheetRender._co = true;
});

/* ------------------------------------------------------------------ */
/* a member's company to the others: nameplate and frame               */
/* ------------------------------------------------------------------ */
const coOfEnt = (e) => { if (!e || e.role !== 'remote') return null; const R = NET.peers.get(e.netPeer); return R && R.slow && R.slow.co ? R.slow.co : null; };
queueMicrotask(() => {
  // under the name on its nameplate (10_ui.js updateNameplates calls campaignPlate for every plate)
  if (typeof campaignPlate === 'function' && !campaignPlate._co) {
    const f = campaignPlate;
    // eslint-disable-next-line no-global-assign
    campaignPlate = function (el, e) {
      const r = f.apply(this, arguments);
      const co = coOfEnt(e), t = co ? co[0] : '';
      if (el._coT !== t) {
        el._coT = t;
        if (!el._co) { el._co = document.createElement('span'); el._co.className = 'co'; el.insertBefore(el._co, el._hb); }
        el._co.textContent = t;
        el._co.style.display = t ? '' : 'none';
        if (co) el._co.style.setProperty('--cc', coTinct(e.faction, co[2] === 2 ? co[3] : co[2]));
      }
      return r;
    };
    campaignPlate._co = true;
  }
  // after its calling on the target frame (10_ui.js updateHUD: unitSub)
  if (typeof unitSub === 'function' && !unitSub._co) {
    const f = unitSub;
    // eslint-disable-next-line no-global-assign
    unitSub = function (e) { const s = f.apply(this, arguments), co = coOfEnt(e); return co ? `${s} · ${co[0]}` : s; };
    unitSub._co = true;
  }
});

/* ------------------------------------------------------------------ */
/* the Season page: the companies' lines                               */
/* ------------------------------------------------------------------ */
function coSeasonHTML() {
  if (!coLinked() || !CO.s || !GAME.player) return '';
  const r = GAME.player.faction, c = coMine(), S = CO.s;
  const rows = S.standing.map((x, i) => `<li class="co-st${c && x.id === c.id ? ' on' : ''}">${coShield(r, x.dev, x.col, 22)} <b>${i + 1}. ${esc(x.n)}</b> · ${fmtInt(Math.round(x.pts))} points · ${fmtInt(x.u)} brought · ${x.caps} ${x.caps === 1 ? 'keep' : 'keeps'} · ${x.m} ${x.m === 1 ? 'member' : 'members'}</li>`).join('') || '<li>No company of your realm yet.</li>';
  const proj = typeof NETS !== 'undefined' && NETS.s ? NETS.s.proj : [], pl = c && proj.find((p) => p.id === c.pledge);
  const mine = c ? `<p>Yours: <b>${esc(c.n)}</b>, ${fmtInt(Math.round(c.pts))} points this season from ${fmtInt(c.u)} units brought and ${c.caps} ${c.caps === 1 ? 'keep' : 'keeps'} taken${c.pledge ? `; its goods pledged to ${esc(pl ? pl.label.toLowerCase() : c.pledge)} (they go to that work first)` : ''}.${c.notice.x ? ` The notice: "${esc(c.notice.x)}"` : ''}</p>` : `<p>${S.guest ? 'Name your account (the Players sheet) to found or join a company.' : `You are of no company: found one or answer an invitation in the Players sheet (${IS_TOUCH ? 'the Players button' : 'P'}).`}</p>`;
  return `<h3 data-cf-open>Companies of ${esc(REALMS[r].name)}</h3><p>Lasting teams of the realm: what their members bring and the keeps they take with them about count together, a point for each 40 units brought (iron four times over) and two and a half for a keep. A company may pledge its goods to one of the realm's works: while that work is at hand they go into its own stock, while it is not they press for it as votes.</p>${mine}<ol class="gd-aims co-standing-page">${rows}</ol>`;
}
queueMicrotask(() => {
  if (typeof netsChronSeason !== 'function' || netsChronSeason._co) return;
  const f = netsChronSeason;
  // eslint-disable-next-line no-global-assign
  netsChronSeason = function () {
    const h = f.apply(this, arguments), add = coSeasonHTML();
    if (!add) return h;
    const at = h.indexOf('<h3 data-cf-open>News of the season</h3>');
    return at >= 0 ? h.slice(0, at) + add + h.slice(at) : h + add;
  };
  netsChronSeason._co = true;
});
// the Players button shows while linked to the server (the company is there even with nobody else in the March), and
// glows with an invitation to a company
const coWanted = () => coLinked() && !!CO.s;
const coInvited = () => coLinked() && !!(CO.s && CO.s.invites && CO.s.invites.length && !coMine());

/* ------------------------------------------------------------------ */
/* what players are told                                               */
/* ------------------------------------------------------------------ */
Object.assign(FIELD_NOTES, {
  netcompany: { t: 'Companies', x: () => `On the March's server the players of a realm band together in companies that last: a name and a device of their own, their own chat kept for whoever was away, a notice, and a tally for the season. ${IS_TOUCH ? 'The Players button' : 'P'} opens yours: found one (a named account), or answer an invitation.` },
});
GUIDE_HELP.push(() => `<h3>Companies</h3><p>On the March's own server the players of a realm may form a company: a lasting team of up to 30 with its own name, device and tinctures, a captain, officers and members. ${IS_TOUCH ? 'The Players button' : 'P (or the Players button)'} holds it: found one (a named account: guests name theirs first), invite by an account's name (the invitation waits for their next visit), answer an invitation, speak to the company (kept for whoever was away), set its notice, and the captain names officers and removes members. What its members bring to the realm's stores and the keeps they take together count for the company: its points and standing among the realm's companies show on the Season page. A captain or an officer may pledge the company's goods to one of the realm's works (they go to that work first) and muster the company: those of it in the March now form one party. Others see your company under your name.</p>`);
LOADING_TIPS.push("On the March's server a company is a lasting team of your realm: its chat waits for you, and what its members bring counts together.");
window.__hm.companies = { CO, msg: coMsg, read: coRead, ask: coAsk, render: coSheetRender, shield: coShield, season: coSeasonHTML, ofEnt: coOfEnt, wanted: coWanted, invited: coInvited, tinct: coTinct };
