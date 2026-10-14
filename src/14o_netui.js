/* ================================================================== */
/* [net] the others in the March: the Players sheet, party, chat       */
/* ================================================================== */
// What a player meets once another is in the room (14n_net.js): a round button by the minimap (P on a desk) opens the
// Players sheet: everyone in the March now (name, realm, calling, level, how far), Invite to your party (your own realm),
// Target, the party (Leave), an invite to answer, and the chat (your realm, your party). On a desk Enter opens the chat
// line; on a phone the sheet holds it. The party's frames sit with the other panels (#netparty: name, level, health; a tap
// targets), its members and the others show on the minimap and the map, and what is said shows over the speaker's head
// and in the log. Every name and line another page sent is set as text (textContent), never as markup.
const NETUI = { on: false, open: false, chan: 'r', bubbles: [], lines: [], sayAt: 0, lastCount: -1, noted: false, chatOpen: false };
function netUiOn() {
  if (NETUI.on) return;
  NETUI.on = true;
  const host = document.querySelector('#topright .iconbtns');
  if (host && !$('btn-net')) {
    const b = document.createElement('button');
    b.id = 'btn-net'; b.type = 'button'; b.className = 'iconbtn panel'; b.hidden = true;
    b.setAttribute('aria-label', 'Players in the March: party and chat (P)');
    b.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="8" r="3"/><path d="M3.5 19c0-3.2 2.5-5.5 5.5-5.5s5.5 2.3 5.5 5.5"/><circle cx="16.5" cy="9" r="2.4"/><path d="M15 13.6c3 0 5.5 2 5.5 5"/></svg><span class="net-n"></span>';
    b.onclick = () => netSheetToggle();
    host.appendChild(b);
  }
  const hud = $('hud');
  if (hud && !$('netparty')) {
    const p = document.createElement('div');
    p.className = 'panel'; p.id = 'netparty'; p.hidden = true;
    p.addEventListener('click', (e) => { const r = e.target.closest('[data-peer]'); if (!r) return; const g = netGhost(r.dataset.peer); if (g && GAME.player) setPlayerTarget(g); });
    hud.appendChild(p);
    const bb = document.createElement('div'); bb.id = 'netbubbles'; hud.appendChild(bb);
    const cb = document.createElement('div');
    cb.className = 'panel'; cb.id = 'netchat'; cb.hidden = true;
    cb.innerHTML = '<button type="button" class="btn" id="netchat-ch"></button><input id="netchat-in" type="text" maxlength="140" autocomplete="off" enterkeyhint="send" aria-label="Say something"><button type="button" class="btn primary" id="netchat-go">Say</button>';
    document.body.appendChild(cb);
    $('netchat-ch').onclick = () => { NETUI.chan = NETUI.chan === 'r' ? (NET.party ? 'p' : 'r') : 'r'; netChatLabel(); $('netchat-in').focus(); };
    $('netchat-go').onclick = () => netChatGo();
    $('netchat-in').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); netChatGo(); }
      else if (e.key === 'Escape') { e.preventDefault(); netChatClose(); }
      e.stopPropagation();
    });
  }
  if (!$('netsheet')) {
    const o = document.createElement('div');
    o.className = 'overlay'; o.id = 'netsheet'; o.hidden = true;
    o.innerHTML = '<div class="sheet panel" role="dialog" aria-labelledby="netsheet-title"><div class="kithead"><h2 id="netsheet-title">In the March</h2><button class="btn" id="netsheet-close" type="button">Close</button></div><div id="netsheet-body"></div><div id="netsheet-acct" hidden></div></div>';
    document.body.appendChild(o);
    $('netsheet-close').onclick = () => netSheetToggle(false);
    o.addEventListener('click', (e) => {
      if (e.target === o) { netSheetToggle(false); return; }
      const b = e.target.closest('button[data-act]');
      if (!b) return;
      const peer = b.dataset.peer || '', act = b.dataset.act;
      if (act === 'inv') netInvite(peer);
      else if (act === 'join') netInviteAnswer(peer, true);
      else if (act === 'no') netInviteAnswer(peer, false);
      else if (act === 'leave') netPartyLeave();
      else if (act === 'tgt') { const g = netGhost(peer); if (g) { setPlayerTarget(g); netSheetToggle(false); } }
      else if (act === 'say') { netSheetToggle(false); netChatOpen(b.dataset.ch || 'r'); }
      else if (act === 'season') { netSheetToggle(false); openChronicle('season'); return; } // [net] the season's page (14q_netseason.js)
      else if (act === 'acct-claim' || act === 'acct-login' || act === 'acct-out') { netAcctClick(act); return; }
      netSheetRender();
    });
  }
}
addEventListener('keydown', (e) => {
  if (!NETUI.on || !GAME.started || typing()) return;
  if (e.code === 'KeyP' && !e.repeat && (!UI.modal || UI.modal === 'net')) { e.preventDefault(); netSheetToggle(); }
  else if ((e.code === 'Enter' || e.code === 'NumpadEnter') && !UI.modal && !BUILD.mode && netPeopleCount() > 0) { e.preventDefault(); netChatOpen(NETUI.chan); }
  else if (e.code === 'Escape' && UI.modal === 'net') { e.preventDefault(); e.stopImmediatePropagation(); netSheetToggle(false); }
}, true);
const netPeopleCount = () => { let n = 0; for (const R of NET.peers.values()) if (R.slow && R.slow.on) n++; return n; };
const netPartyPeers = () => (NET.party ? [...NET.peers.values()].filter((R) => R.slow && R.slow.on && R.slow.pt === NET.party) : []);

/* ------------------------------------------------------------------ */
/* the sheet                                                           */
/* ------------------------------------------------------------------ */
function netSheetToggle(force) {
  const o = $('netsheet');
  if (!o) return;
  const open = force === undefined ? o.hidden : force;
  if (open && UI.modal && UI.modal !== 'net') return;
  o.hidden = !open;
  UI.modal = open ? 'net' : UI.modal === 'net' ? null : UI.modal;
  NETUI.open = open;
  if (open) { netSheetRender(); netAcctRender(); }
}
// your account on the March's own server (rung 2: 14p_netws.js), in its own part of the sheet so what you type stays while
// the rest is drawn again: a guest names its account (and keeps its character), or signs in to another (the page loads
// again with that account's character), or signs out of a named one
function netAcctRender(msg, bad) {
  const box = $('netsheet-acct');
  if (!box) return;
  const A = NETWS.acct;
  if (!NET.link || NET.link.kind !== 'ws' || !A) { box.hidden = true; return; }
  box.hidden = false;
  if (box._k !== A.id + ':' + A.guest) {
    box._k = A.id + ':' + A.guest;
    box.textContent = '';
    const el = (tag, cls, txt) => { const d = document.createElement(tag); if (cls) d.className = cls; if (txt != null) d.textContent = txt; return d; };
    const btn = (label, act, extra) => { const b = el('button', 'btn' + (extra || ''), label); b.type = 'button'; b.dataset.act = act; return b; };
    box.appendChild(el('h3', '', `Your account on ${NETWS.host}`));
    if (A.guest) {
      box.appendChild(el('p', 'net-quiet', 'You play as a guest of this server: your character is kept for this browser (and, inside the artifact, for your claude.ai account). Give your account a name and a password to come back to it from anywhere, or sign in to one you have.'));
      const f = el('div', 'net-fields');
      const n = el('input'); n.id = 'netacct-name'; n.type = 'text'; n.maxLength = 20; n.placeholder = 'Name (3 to 20 letters)'; n.autocomplete = 'username'; n.spellcheck = false;
      const pw = el('input'); pw.id = 'netacct-pass'; pw.type = 'password'; pw.maxLength = 200; pw.placeholder = 'Password (6 or more)'; pw.autocomplete = 'current-password';
      f.appendChild(n); f.appendChild(pw); box.appendChild(f);
      const acts = el('div', 'net-acts'); acts.appendChild(btn('Name this account', 'acct-claim', ' primary')); acts.appendChild(btn('Sign in', 'acct-login')); box.appendChild(acts);
    } else {
      box.appendChild(el('p', 'net-quiet', `Signed in as ${A.name}. The server keeps your character; sign in with your name and password on any device.`));
      const acts = el('div', 'net-acts'); acts.appendChild(btn('Sign out', 'acct-out')); box.appendChild(acts);
    }
    box.appendChild(el('div', 'net-msg'));
  }
  const m = box.querySelector('.net-msg');
  if (m && msg !== undefined) { m.textContent = msg; m.classList.toggle('bad', !!bad); }
}
async function netAcctClick(act) {
  if (act === 'acct-out') { netAcctRender('Signing out: the page loads again as a new guest.'); await netAcctOut(); return; }
  const n = $('netacct-name'), pw = $('netacct-pass');
  const name = n ? n.value.trim() : '', pass = pw ? pw.value : '';
  if (name.length < 3 || pass.length < 6) { netAcctRender('A name of 3 to 20 letters and a password of 6 or more.', true); return; }
  netAcctRender(act === 'acct-claim' ? 'Naming your account...' : 'Signing in...');
  const r = await netAcctDo(act === 'acct-claim' ? 'claim' : 'login', name, pass);
  if (!r || !r.ok) { netAcctRender(netStr(r && r.why, 80) || 'The server did not answer.', true); return; }
  if (pw) pw.value = '';
  if (act === 'acct-claim') { netAcctRender(); netAcctRender(`Your account is ${r.acct.name} now: sign in with it on any device.`); }
  else netAcctRender(`Signed in as ${r.acct.name}: the March loads again with your character.`);
}
// built with elements and textContent: names and lines from other pages are never markup
function netSheetRender() {
  const body = $('netsheet-body'), P = GAME.player;
  if (!body || !P) return;
  body.textContent = '';
  const el = (tag, cls, txt) => { const d = document.createElement(tag); if (cls) d.className = cls; if (txt != null) d.textContent = txt; return d; };
  const btn = (label, act, peer, extra) => { const b = el('button', 'btn' + (extra || ''), label); b.type = 'button'; b.dataset.act = act; if (peer) b.dataset.peer = peer; return b; };
  // invites to answer
  for (const I of NET.invites) {
    const R = NET.peers.get(I.peer);
    if (!R || !R.slow) continue;
    const row = el('div', 'net-row net-inv');
    row.appendChild(el('span', 'net-nm', `${R.slow.dn} invites you to their party.`));
    const acts = el('span', 'net-acts'); acts.appendChild(btn('Join', 'join', I.peer, ' primary')); acts.appendChild(btn('Decline', 'no', I.peer)); row.appendChild(acts);
    body.appendChild(row);
  }
  // your party
  const mates = netPartyPeers();
  if (NET.party) {
    body.appendChild(el('h3', '', `Your party (${mates.length + 1} of ${NET.partyMax})`));
    const row = el('div', 'net-row'); row.appendChild(el('span', 'net-nm', mates.length ? mates.map((R) => R.slow.dn).join(', ') : 'Only you, for now.')); const acts = el('span', 'net-acts'); acts.appendChild(btn('Party chat', 'say', '', '')); acts.lastChild.dataset.ch = 'p'; acts.appendChild(btn('Leave', 'leave', '')); row.appendChild(acts); body.appendChild(row);
  }
  // everyone here
  const list = [...NET.peers.values()].filter((R) => R.slow && R.slow.on);
  body.appendChild(el('h3', '', list.length ? `Others in the March (${list.length})` : 'No one else is in the March right now'));
  if (!list.length) body.appendChild(el('p', 'net-quiet', 'Whoever opens the March while you are here walks it with you: their realm, their calling and their deeds, beside you or against you.'));
  list.sort((a, b) => (a.slow.r === P.faction ? 0 : 1) - (b.slow.r === P.faction ? 0 : 1) || (a.slow.dn < b.slow.dn ? -1 : 1));
  for (const R of list) {
    const s = R.slow, f = R.fast;
    const row = el('div', 'net-row');
    row.style.setProperty('--rc', REALMS[s.r].color);
    const nm = el('span', 'net-nm'); nm.appendChild(el('b', '', s.dn)); nm.appendChild(el('small', '', ` ${REALMS[s.r].name} ${CLASSES[s.c].name} · level ${s.l}${f ? ` · ${Math.round(dist(f.x, f.z, P.x, P.z))} m` : ''}${s.pt && s.pt === NET.party ? ' · in your party' : ''}${R.peer === NET.host ? ' · keeps the shared war' : ''}${s.co ? ` · ${s.co[0]}` /* [companies] */ : ''}`));
    row.appendChild(nm);
    const acts = el('span', 'net-acts');
    if (R.ghost) acts.appendChild(btn('Target', 'tgt', R.peer));
    if (s.r === P.faction && !(s.pt && s.pt === NET.party) && (!NET.party || mates.length + 1 < NET.partyMax)) acts.appendChild(btn('Invite', 'inv', R.peer));
    row.appendChild(acts);
    body.appendChild(row);
  }
  // the season's roster of your realm (14q_netseason.js): who is on now (here or in another shard) and who was on today
  if (typeof NETS !== 'undefined' && NETS.roster && NETS.roster.list.length) {
    const ro = NETS.roster;
    body.appendChild(el('h3', '', `${REALMS[P.faction].name} today: ${ro.now} on now, ${ro.day} today`));
    const row = el('div', 'net-row'); row.style.setProperty('--rc', REALMS[P.faction].color);
    row.appendChild(el('span', 'net-nm', ro.list.slice(0, 16).map((x) => `${x.n}${x.on ? ' (on)' : ''}${x.g ? ` brought ${x.g}` : ''}`).join(' · ')));
    const acts = el('span', 'net-acts'); acts.appendChild(btn('The season', 'season', '')); row.appendChild(acts);
    body.appendChild(row);
  }
  // the chat
  const chat = el('div', 'net-chatbox');
  chat.appendChild(el('h3', '', 'Chat'));
  const lines = el('div', 'net-lines');
  for (const L of NETUI.lines.slice(-8)) { const d = el('div', 'net-line'); d.style.setProperty('--rc', L.c); d.appendChild(el('b', '', `${L.ch === 'p' ? '[Party] ' : '[Realm] '}${L.who}: `)); d.appendChild(document.createTextNode(L.text)); lines.appendChild(d); }
  if (!NETUI.lines.length) lines.appendChild(el('div', 'net-quiet', 'What is said by your realm and your party shows here, in the log and over the speaker.'));
  chat.appendChild(lines);
  const acts = el('div', 'net-acts');
  const rb = btn('Say to your realm', 'say', ''); rb.dataset.ch = 'r'; acts.appendChild(rb);
  if (NET.party) { const pb = btn('Say to your party', 'say', ''); pb.dataset.ch = 'p'; acts.appendChild(pb); }
  chat.appendChild(acts);
  body.appendChild(chat);
  netAcctRender(); // (drawn again only when the account changes: what you type stays)
}

/* ------------------------------------------------------------------ */
/* party                                                               */
/* ------------------------------------------------------------------ */
function netInvite(peer) {
  const R = NET.peers.get(peer), P = GAME.player;
  if (!R || !R.slow || !P || R.slow.r !== P.faction) return false;
  if (!NET.party) { NET.party = netStubId(10); NET.partyLead = true; NET.slowKey = ''; }
  if (netPartyPeers().length + 1 >= NET.partyMax) { uiError('Your party is full'); return false; }
  netEvent('inv', peer, NET.party);
  uiLog(`You invite ${R.slow.dn} to your party.`, 'sys');
  return true;
}
function netInviteAnswer(peer, yes) {
  const I = NET.invites.find((x) => x.peer === peer);
  NET.invites = NET.invites.filter((x) => x.peer !== peer);
  const R = NET.peers.get(peer);
  if (!I || !R || !R.slow) return false;
  if (yes) {
    NET.party = I.pt; NET.partyLead = false; NET.slowKey = '';
    uiLog(`You join ${R.slow.dn}'s party.`, 'sys');
    sfx('click');
  }
  netEvent('pa', peer, yes ? 1 : 0);
  netSheetBadge();
  return true;
}
function netPartyLeave() {
  if (!NET.party) return;
  NET.party = ''; NET.partyLead = false; NET.slowKey = '';
  if (NETUI.chan === 'p') NETUI.chan = 'r';
  uiLog('You leave the party.', 'sys');
}
function netPartyIn(R, kind, d) {
  const P = GAME.player;
  if (!P || !R.slow) return;
  if (kind === 'inv') {
    if (typeof d !== 'string' || !/^[a-z0-9]{4,24}$/.test(d) || R.slow.r !== P.faction || d === NET.party) return;
    if (NET.invites.some((x) => x.peer === R.peer && x.pt === d)) return;
    NET.invites = NET.invites.filter((x) => x.peer !== R.peer).concat([{ peer: R.peer, pt: d, t: performance.now() }]).slice(-4);
    uiToast(`${R.slow.dn} invites you to their party. ${IS_TOUCH ? 'Tap the Players button' : 'Press P'} to answer.`);
    uiLog(`${R.slow.dn} invites you to their party.`, 'sys', R.slow.r);
    netSheetBadge();
    if (NETUI.open) netSheetRender();
  } else if (kind === 'pa') {
    uiLog(d === 1 ? `${R.slow.dn} joins your party.` : `${R.slow.dn} declines your invitation.`, 'sys', R.slow.r);
    if (d === 1 && IS_TOUCH) uiToast(`${R.slow.dn} joins your party.`);
    if (NETUI.open) netSheetRender();
  }
}

/* ------------------------------------------------------------------ */
/* chat                                                                */
/* ------------------------------------------------------------------ */
function netChatLabel() { const b = $('netchat-ch'); if (b) b.textContent = NETUI.chan === 'p' ? 'Party' : 'Realm'; }
function netChatOpen(ch) {
  const c = $('netchat');
  if (!c || !GAME.player) return;
  NETUI.chan = ch === 'p' && NET.party ? 'p' : 'r';
  netChatLabel();
  c.hidden = false; NETUI.chatOpen = true;
  INPUT.keys.clear();
  const i = $('netchat-in'); i.value = ''; i.focus();
}
function netChatClose() { const c = $('netchat'); if (c) c.hidden = true; NETUI.chatOpen = false; const i = $('netchat-in'); if (i) i.blur(); }
function netChatGo() {
  const i = $('netchat-in');
  const t = i ? i.value : '';
  if (netChatSend(NETUI.chan, t)) i.value = '';
  netChatClose();
}
function netChatSend(ch, text) {
  const P = GAME.player;
  const t = netStr(String(text || ''), 140);
  if (!P || !t || !netOn()) return false;
  const now = performance.now();
  if (now - NETUI.sayAt < 1100) { uiError('Not so fast'); return false; }
  NETUI.sayAt = now;
  const c = ch === 'p' && NET.party ? 'p' : 'r';
  netEvent('say', 0, [c, t, c === 'p' ? NET.party : '']);
  NET.stats.chatOut++;
  netChatShow(P.name, P.faction, c, t, null);
  return true;
}
function netChatIn(R, d) {
  const P = GAME.player;
  if (!P || !R.slow || !Array.isArray(d)) return;
  const c = d[0] === 'p' ? 'p' : 'r', t = netStr(d[1], 140);
  if (!t) return;
  if (c === 'r' && R.slow.r !== P.faction) return; // a realm's chat is its own
  if (c === 'p' && !(NET.party && d[2] === NET.party && R.slow.pt === NET.party)) return;
  const now = performance.now();
  if (now - R.chatAt < 700) return; // a flood is not read
  R.chatAt = now;
  NET.stats.chatIn++;
  netChatShow(R.slow.dn, R.slow.r, c, t, R);
}
function netChatShow(who, realm, ch, text, R) {
  NETUI.lines.push({ who, ch, text, c: REALMS[realm].light });
  if (NETUI.lines.length > 40) NETUI.lines.shift();
  uiLog(`${ch === 'p' ? '[Party] ' : '[Realm] '}${who}: ${text}`, 'chat', realm);
  if (R) R.bubble = { text, until: performance.now() + 7000 };
  else NETUI.myBubble = { text, until: performance.now() + 7000 };
  if (R && IS_TOUCH && !$('log').classList.contains('show') && ch === 'p') uiToast(`${who}: ${text}`);
  if (NETUI.open) netSheetRender();
}

/* ------------------------------------------------------------------ */
/* every frame: the button, the party's frames, speech over heads       */
/* ------------------------------------------------------------------ */
function netSheetBadge() {
  const b = $('btn-net');
  if (!b) return;
  const n = netPeopleCount();
  const coI = typeof coInvited === 'function' && coInvited(); // [companies] the company is there with nobody else in the March; an invitation to one
  b.hidden = !netOn() || (n === 0 && !NET.party && !NET.invites.length && !(typeof coWanted === 'function' && coWanted()));
  const t = NET.invites.length || coI ? '!' : n ? String(n) : '';
  const s = b.querySelector('.net-n');
  if (s && s.textContent !== t) s.textContent = t;
  b.classList.toggle("net-glow", NET.invites.length > 0 || coI);
}
function netUiFrame() {
  if (!NETUI.on || !GAME.started || !GAME.player) return;
  const P = GAME.player;
  if ((UI.frame & 7) === 0) netSheetBadge();
  if (NETUI.open && (UI.frame & 31) === 0) netAcctRender(); // the server's link may come up while the sheet is open
  // the party's frames
  const pp = $('netparty');
  if (pp && (UI.frame & 3) === 0) {
    const mates = netPartyPeers();
    if (!mates.length) { if (!pp.hidden) pp.hidden = true; }
    else {
      const key = mates.map((R) => `${R.peer}:${R.slow.dn}:${R.slow.l}:${R.fast ? Math.round(R.fast.h * 40) + ':' + R.fast.d : '-'}:${R.ghost && P.target === R.ghost.id ? 1 : 0}`).join('|');
      if (pp._k !== key) {
        pp._k = key;
        pp.textContent = '';
        const h = document.createElement('div'); h.className = 'net-ph'; h.textContent = 'Party'; pp.appendChild(h);
        for (const R of mates) {
          const row = document.createElement('div');
          row.className = 'net-pm' + (R.ghost && P.target === R.ghost.id ? ' sel' : '') + (R.fast && R.fast.d ? ' dead' : '');
          row.dataset.peer = R.peer;
          const nm = document.createElement('span'); nm.className = 'net-pn'; nm.textContent = `${R.slow.dn}`; row.appendChild(nm);
          const lv = document.createElement('span'); lv.className = 'net-pl'; lv.textContent = R.fast && R.fast.d ? 'fallen' : `Lv ${R.slow.l}`; row.appendChild(lv);
          const bar = document.createElement('i'); bar.className = 'net-hb'; const fill = document.createElement('b'); fill.style.width = `${Math.round((R.fast ? R.fast.h : 1) * 100)}%`; bar.appendChild(fill); row.appendChild(bar);
          pp.appendChild(row);
        }
      }
      if (pp.hidden) { pp.hidden = false; try { HUDL.k = 0; } catch (e) { /* not up yet */ } }
    }
  }
  // what is said, over the speaker's head a few seconds
  const host = $('netbubbles');
  if (!host) return;
  let used = 0;
  const now = performance.now();
  const put = (e, B) => {
    if (!B || B.until < now || used >= 6) return;
    const s = screenOf(e.x, e.y + (2.45 + (e.mount ? 0.8 : 0)) * (e.scale || 1), e.z);
    if (!s || s.x < -40 || s.x > view.w + 40 || s.y < 0 || s.y > view.h) return;
    let el = NETUI.bubbles[used];
    if (!el) { el = document.createElement('div'); el.className = 'net-bub'; host.appendChild(el); NETUI.bubbles.push(el); }
    if (el._t !== B.text) { el.textContent = B.text; el._t = B.text; }
    el.style.display = '';
    el.style.transform = `translate(${s.x.toFixed(1)}px, ${s.y.toFixed(1)}px) translate(-50%, -100%)`;
    el.style.opacity = clamp((B.until - now) / 1200, 0, 1).toFixed(2);
    used++;
  };
  for (const R of NET.peers.values()) if (R.ghost && R.bubble && dist2(R.ghost.x, R.ghost.z, camera.position.x, camera.position.z) < 50 * 50) put(R.ghost, R.bubble);
  put(P, NETUI.myBubble);
  for (let i = used; i < NETUI.bubbles.length; i++) if (NETUI.bubbles[i].style.display !== 'none') NETUI.bubbles[i].style.display = 'none';
  // the first time another player is near: a field note
  if (!NETUI.noted && (UI.frame & 31) === 0 && [...NET.peers.values()].some((R) => R.ghost && dist2(R.ghost.x, R.ghost.z, P.x, P.z) < 80 * 80)) { NETUI.noted = true; loreNote('netothers'); }
}

/* ------------------------------------------------------------------ */
/* the minimap and the map                                             */
/* ------------------------------------------------------------------ */
function netMinimap(ctx, toM, S, dpr) {
  if (!netOn() || INDOOR.on) return;
  const P = GAME.player;
  for (const R of NET.peers.values()) {
    const e = R.ghost;
    if (!e || !R.slow) continue;
    const [x, y] = toM(e.x, e.z);
    if (x < -4 || y < -4 || x > S + 4 || y > S + 4) continue;
    const mate = NET.party && R.slow.pt === NET.party, foe = R.slow.r !== P.faction;
    ctx.fillStyle = foe ? REALMS[R.slow.r].color : mate ? '#7dff9a' : '#9fd8ff';
    ctx.strokeStyle = '#000'; ctx.lineWidth = 1.5 * dpr;
    ctx.beginPath(); ctx.arc(x, y, (mate ? 4 : 3.2) * dpr, 0, TAU); ctx.fill(); ctx.stroke();
    if (mate) { ctx.strokeStyle = '#d8ffe0'; ctx.lineWidth = 1.2 * dpr; ctx.beginPath(); ctx.arc(x, y, 6.5 * dpr, 0, TAU); ctx.stroke(); }
  }
}
function netWorldMap(ctx, S) {
  if (typeof netsWorldMap === 'function') netsWorldMap(ctx, S); // the season's armies (14q_netseason.js)
  if (!netOn()) return;
  const P = GAME.player;
  for (const R of NET.peers.values()) {
    if (!R.slow || !R.slow.on || !R.fast || R.fast.x > 1000) continue;
    const mate = NET.party && R.slow.pt === NET.party, own = R.slow.r === P.faction;
    if (!own && !R.ghost) continue; // a foe shows only where you could see it
    const [x, y] = w2m(R.fast.x, R.fast.z, S);
    ctx.fillStyle = own ? (mate ? '#7dff9a' : '#9fd8ff') : REALMS[R.slow.r].color;
    ctx.strokeStyle = '#000'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(x, y, S * (mate ? 0.009 : 0.007), 0, TAU); ctx.fill(); ctx.stroke();
    if (mate) { ctx.font = `${Math.round(S * 0.018)}px system-ui, sans-serif`; ctx.fillStyle = '#e8fff0'; ctx.strokeStyle = 'rgba(0,0,0,0.8)'; ctx.lineWidth = 3; ctx.strokeText(R.slow.n, x + S * 0.012, y + S * 0.006); ctx.fillText(R.slow.n, x + S * 0.012, y + S * 0.006); }
  }
}

/* ------------------------------------------------------------------ */
/* what players are told                                               */
/* ------------------------------------------------------------------ */
Object.assign(FIELD_NOTES, {
  netothers: { t: 'Others in the March', x: () => `Other players walk the March with you. Those of your realm fight beside you; the others are foes, and a blow you strike lands on them as it would on a soldier. ${IS_TOUCH ? 'The Players button' : 'P'} opens who is here: invite your realm's players to a party, and speak to your realm or your party${IS_TOUCH ? '' : ' (Enter)'}.` },
});
GUIDE_HELP.push(() => `<h3>Others in the March</h3><p>Whoever has the March open while you play walks it with you, in their own realm and calling. Players of your realm fight beside you; the others are your foes, and a fight between players is settled as one with a soldier. ${IS_TOUCH ? 'The Players button by the map' : 'P (or the Players button by the map)'} lists them: invite your realm's players to a party (up to six: their health on your screen, their places on the map) and speak to your realm or your party${IS_TOUCH ? '' : ' (Enter opens the chat line)'}. One of you keeps the shared war: its keeps' owners and its hour hold for everyone here, and a keep you take is told to it.</p>`);
LOADING_TIPS.push('Other players in the March are drawn as they are: their realm, calling, gear and the name they wear. Those of your realm are allies, the others foes.', 'Invite players of your realm to a party from the Players button: their health shows by your own and their places on the map.');

/* test and debug hooks */
window.__hm.net = { NET, NETUI, NETSTUB, uiOn: netUiOn, peerUpdate: netPeerUpdate, peerLeft: netPeerLeft, state: netState, chat: netChatSend, invite: netInvite, answer: netInviteAnswer, leave: netPartyLeave, sheet: netSheetToggle, sheetRender: netSheetRender, chatOpen: netChatOpen, pump: netPump, ghost: netGhost, world: netWorldObj, land: netLand, get NETWS() { return NETWS; } }; // (14p_netws.js loads after: read when asked)
