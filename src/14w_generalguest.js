/* [guest] Interego's general guest as one more way into the server-hosted March (issue 105;
 * server/gaming/general-guest.js). A general guest is one guest per browser across every
 * Interego application: its key lives on identity's guest door, never here. The page only
 *   - offers "Continue as an Interego guest" beside the other ways in, where the server says so;
 *   - sends the browser to the server's start route (a top-level navigation; the server binds
 *     the visit with an HttpOnly cookie and redirects to the door);
 *   - on the way back collects its game session once, by that cookie, and takes the flag out of
 *     the address (no code and no bearer is ever in an address);
 *   - plays with the March's server holding the character (the save's `load`, `save`, `wipe`);
 *   - where the server says so (`pod`), also keeps an unlinked guest's character in the guest's OWN Interego pod,
 *     sealed here with an X25519 key this browser makes and never sends (guest-checkpoint.mjs): the server forwards
 *     ciphertext only. `shadow`: beside the server's save. `authoritative`: instead of it, with this browser's
 *     own copy between the pod's spaced writes. Another browser cannot open what this one sealed;
 *   - when the session's bound comes (a guest's own deadline; about ten minutes for a guest
 *     linked to an account, so an unlink reaches this browser), saves and asks to go back
 *     through the door, where identity reads the link again.
 * The sign-in the browser had before is kept aside and put back when the guest session ends. */
const GENERAL_GUEST = { session: null, note: '', timers: [], ended: false };
const GENERAL_GUEST_FLAG = 'interego-guest';
const GENERAL_GUEST_NOTES = {
  refused: 'The Interego guest door did not finish. You can try again.',
  unavailable: 'The Interego guest door is unavailable right now. Try again in a moment.',
  busy: 'The Interego guest door is busy. Try again in a moment.',
  ended: 'Your Interego guest session ended. Continue as an Interego guest to go on.',
};
// The door works only on the server's own page: the visit's cookie belongs to that origin.
function generalGuestPolicy() {
  try {
    const server = netServerUrl();
    if (!server) return null;
    const u = new URL(server), origin = (u.protocol === 'wss:' ? 'https:' : 'http:') + '//' + u.host;
    const m = window.__HM_GAMING && window.__HM_GAMING.generalGuest;
    const path = (p) => typeof p === 'string' && /^\/[A-Za-z0-9._~/-]{1,127}$/.test(p) && !p.includes('//') && !p.includes('..');
    if (origin !== location.origin || !m || m.enabled !== true || !path(m.startPath) || !path(m.sessionPath)) return null;
    return { host: u.host, start: origin + m.startPath, session: origin + m.sessionPath,
      pod: m.pod === 'shadow' || m.pod === 'authoritative' ? m.pod : null };
  } catch (e) { return null; }
}
const generalGuestKey = (host) => 'hallowmarch.generalguest.' + host;
function generalGuestMarker(host) {
  try {
    const m = JSON.parse(localStorage.getItem(generalGuestKey(host)) || 'null');
    if (!m || typeof m !== 'object' || typeof m.accountId !== 'string' || !/^gg-[0-9a-f]{40}$/.test(m.accountId)
      || !Number.isSafeInteger(m.expiresAt) || typeof m.linked !== 'boolean' || typeof m.prior !== 'string' || m.prior.length > 1000) return null;
    return m;
  } catch (e) { return null; }
}
// The guest session is over for this browser: the sign-in it had before comes back.
function generalGuestEnd(host) {
  for (const t of GENERAL_GUEST.timers) clearTimeout(t);
  GENERAL_GUEST.timers = []; GENERAL_GUEST.session = null;
  let prior = '', known = false;
  try { const m = generalGuestMarker(host); known = !!m; prior = m ? m.prior : ''; } catch (e) { /* storage blocked */ }
  try {
    localStorage.removeItem(generalGuestKey(host));
    if (known) { if (prior) localStorage.setItem('hallowmarch.token.' + host, prior); else localStorage.removeItem('hallowmarch.token.' + host); }
  } catch (e) { /* storage blocked */ }
}
// The game session waiting on the server for this browser's cookie, collected once.
async function generalGuestCollect(policy) {
  try {
    const response = await fetch(policy.session, { method: 'POST', credentials: 'same-origin', cache: 'no-store', redirect: 'error',
      headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(15000) });
    if (!response.ok) return false;
    const s = await response.json();
    if (!s || typeof s.token !== 'string' || !s.token || s.token.length > 1000 || !s.acct || typeof s.acct.id !== 'string'
      || !/^gg-[0-9a-f]{40}$/.test(s.acct.id) || !Number.isSafeInteger(s.expiresAt) || s.expiresAt <= Date.now()) return false;
    const before = generalGuestMarker(policy.host);
    let prior = before ? before.prior : '';
    if (!before) try { prior = localStorage.getItem('hallowmarch.token.' + policy.host) || ''; } catch (e) { /* none kept */ }
    localStorage.setItem(generalGuestKey(policy.host), JSON.stringify({ accountId: s.acct.id, expiresAt: s.expiresAt, linked: s.linked === true,
      prior: prior.length <= 1000 ? prior : '' }));
    localStorage.setItem('hallowmarch.token.' + policy.host, s.token);
    return true;
  } catch (e) { return false; }
}
function generalGuestStart() {
  const policy = generalGuestPolicy();
  if (!policy) return;
  const button = $('loading-general-guest');
  if (button) button.disabled = true;
  location.assign(policy.start);
}
function generalGuestRender() {
  const button = $('loading-general-guest'), status = $('loading-general-guest-status');
  if (!button) return;
  const policy = generalGuestPolicy(), kept = policy && generalGuestMarker(policy.host);
  const show = !!policy && !GENERAL_GUEST.session && !(kept && kept.expiresAt > Date.now() + 5000) && !GAME.started;
  button.hidden = button.disabled = !show;
  button.textContent = 'Continue as an Interego guest';
  button.onclick = show ? generalGuestStart : null;
  if (status) { status.textContent = show ? GENERAL_GUEST.note : ''; status.hidden = !status.textContent; }
}
// The session's bound: a last save while the server still takes it, then the way back through the door.
function generalGuestEnded() {
  const s = GENERAL_GUEST.session;
  if (!s || GENERAL_GUEST.ended) return;
  GENERAL_GUEST.ended = true;
  const box = document.createElement('div'), text = document.createElement('p'), again = document.createElement('button'), leave = document.createElement('button');
  box.id = 'general-guest-ended'; box.setAttribute('role', 'alertdialog'); box.setAttribute('aria-labelledby', 'general-guest-ended-text');
  box.style.cssText = 'position:fixed;left:50%;top:max(12px,env(safe-area-inset-top));transform:translateX(-50%);z-index:2147483000;display:grid;gap:8px;'
    + 'width:min(22rem,calc(100vw - 24px));padding:12px;border-radius:10px;background:rgba(14,16,20,0.94);color:#f1ead8;font:400 14px/1.4 system-ui,sans-serif;text-align:center';
  text.id = 'general-guest-ended-text'; text.style.margin = '0';
  text.textContent = s.linked ? 'Your Interego guest session is checked again every ten minutes while it plays as your account. Your character is saved.'
    : 'Your Interego guest session ended. Your character is saved.';
  for (const b of [again, leave]) { b.type = 'button'; b.className = 'btn'; b.style.minHeight = '44px'; }
  again.classList.add('primary'); again.textContent = 'Continue as an Interego guest';
  leave.textContent = 'Leave the guest session';
  again.onclick = () => { again.disabled = leave.disabled = true; location.assign(s.start); };
  leave.onclick = () => { again.disabled = leave.disabled = true; generalGuestEnd(s.host); location.reload(); };
  box.append(text, again, leave); document.body.appendChild(box);
  again.focus({ preventScroll: true });
}
function generalGuestWatch() {
  const s = GENERAL_GUEST.session;
  if (!s) return;
  const left = s.expiresAt - Date.now();
  GENERAL_GUEST.timers.push(setTimeout(() => {
    if (!GAME.started || !GAME.player || typeof saveNow !== 'function') return;
    // The pod's copy is brought up to date before the session's token goes with its bound.
    Promise.resolve(saveNow()).then(() => generalGuestPodFlush(), () => {});
  }, Math.max(0, left - 25000)));
  GENERAL_GUEST.timers.push(setTimeout(generalGuestEnded, Math.max(0, left - 2000)));
}
// Is a guest session kept here, or arriving? Synchronous, so a boot with neither starts exactly as it always did.
function generalGuestWanted() {
  const policy = generalGuestPolicy();
  if (!policy) return false;
  try { if (new URL(location.href).searchParams.has(GENERAL_GUEST_FLAG)) return true; } catch (e) { /* no flag */ }
  return !!generalGuestMarker(policy.host);
}
// Asked first by the save's backend (12_save.js). `undefined`: no guest session, the usual ways in follow.
async function generalGuestSaveRef(initialization) {
  const policy = generalGuestPolicy();
  if (!policy) return undefined;
  // Whose character this is stays unknown until the session is confirmed: no browser character is chosen meanwhile.
  SAVE.native = true;
  let flag = '';
  try {
    const here = new URL(location.href);
    flag = here.searchParams.get(GENERAL_GUEST_FLAG) || '';
    if (flag) { here.searchParams.delete(GENERAL_GUEST_FLAG); history.replaceState(history.state, '', here.pathname + here.search + here.hash); }
  } catch (e) { /* the address stays as it is */ }
  if (flag === 'arrived') { if (!await generalGuestCollect(policy)) GENERAL_GUEST.note = GENERAL_GUEST_NOTES.refused; }
  else if (flag && Object.hasOwn(GENERAL_GUEST_NOTES, flag)) GENERAL_GUEST.note = GENERAL_GUEST_NOTES[flag];
  if (!initialization.active) return null;
  const marker = generalGuestMarker(policy.host);
  if (!marker) { generalGuestRender(); return undefined; }
  if (marker.expiresAt <= Date.now() + 5000) {
    generalGuestEnd(policy.host); GENERAL_GUEST.note = GENERAL_GUEST_NOTES.ended; generalGuestRender();
    return undefined;
  }
  // The March's server holds this character: the save's own server path, never a pod or another browser character.
  SAVE.native = false; SAVE.lsKey = 'hallowmarch.generalguest.save.' + marker.accountId;
  NATIVE_PLAYER.status = null; NATIVE_PLAYER.state = 'idle';
  let ref = null;
  try { ref = await netServerSaveRef(); } catch (e) { ref = null; }
  if (!initialization.active) return null;
  const refused = NETWS.sessionRefusal && NETWS.sessionRefusal.host === policy.host;
  if (refused || (ref && (!NETWS.acct || NETWS.acct.id !== marker.accountId))) {
    // The server no longer takes this session (its bound passed, or the door was closed): back to the usual ways in.
    generalGuestEnd(policy.host); NETWS.reload = true;
    setTimeout(() => location.reload(), 50);
    return null;
  }
  GENERAL_GUEST.session = { host: policy.host, accountId: marker.accountId, expiresAt: marker.expiresAt, linked: marker.linked, start: policy.start,
    pod: marker.linked ? null : policy.pod };
  generalGuestRender(); generalGuestWatch();
  if (!ref) return null; // the server could not be reached: this browser keeps the character until it can
  const pod = GENERAL_GUEST.session.pod;
  if (pod === 'authoritative') {
    // The pod holds the character, so a session whose pod token the server no longer has (it restarted) keeps
    // nothing: back through the door, where a fresh one is given.
    const state = await generalGuestPodAsk({ op: 'budget' });
    if (!initialization.active) return null;
    if (state && state.ok === false && state.code !== 'busy') {
      generalGuestEnd(policy.host); NETWS.reload = true;
      setTimeout(() => location.reload(), 50);
      return null;
    }
    return { server: true, generalGuest: true, generalGuestPod: pod, get: () => generalGuestPodGet(ref), set: generalGuestPodSet, delete: () => generalGuestPodDelete(ref) };
  }
  return { server: true, generalGuest: true, get: ref.get,
    // Shadow: the server's save is the character; the sealed copy follows it and never delays or fails it.
    set: pod === 'shadow' ? async (s, o) => { await ref.set(s, o); void generalGuestPodPut(s, o); } : ref.set,
    // A guest linked to an account plays that account's guest character and never deletes it.
    delete: marker.linked ? async () => { throw { code: 'not_granted' }; } : ref.delete };
}

/* ---- an unlinked guest's character in the guest's own pod ---- */
// This game's part of the guest's lifetime write budget at the pod (1024 attempts and 32 MiB for every application
// together): the server keeps the same count and refuses past it; the page keeps its own so it never asks in vain.
const GENERAL_GUEST_POD = { vault: null, vaultFor: '', waits: new Map(), n: 0, busy: false, dirty: null, timer: 0,
  WRITES: 192, BYTES: 12 * 1024 * 1024, INTERVAL: 10 * 60000, FLOOR: 5 * 60000, SPREAD: 32 * 3600000,
  stats: { sealed: 0, written: 0, failed: 0, skipped: 0, opened: 0, unreadable: 0, last: '' },
  load: () => import('/gaming/identity/assets/guest-checkpoint.mjs') };
const generalGuestPodKey = (account) => 'hallowmarch.generalguest.pod.' + account;
function generalGuestPodUsage(account) {
  let u = null;
  try { u = JSON.parse(localStorage.getItem(generalGuestPodKey(account)) || 'null'); } catch (e) { u = null; }
  const n = (v) => (Number.isSafeInteger(v) && v >= 0 ? v : 0);
  return { writes: n(u && u.writes), bytes: n(u && u.bytes), lastAt: n(u && u.lastAt), lastBytes: n(u && u.lastBytes), wipedAt: n(u && u.wipedAt) };
}
function generalGuestPodKeep(account, usage) {
  try { localStorage.setItem(generalGuestPodKey(account), JSON.stringify(usage)); } catch (e) { /* storage blocked: the server still counts */ }
}
// Ten minutes between writes, longer for a large character, so the byte part lasts about 32 hours of play.
const generalGuestPodInterval = (bytes) => Math.max(GENERAL_GUEST_POD.INTERVAL, Math.ceil(GENERAL_GUEST_POD.SPREAD * bytes / GENERAL_GUEST_POD.BYTES));
function generalGuestPodReply(m) {
  const wait = GENERAL_GUEST_POD.waits.get(m && m.n);
  if (wait) { GENERAL_GUEST_POD.waits.delete(m.n); wait(m); }
}
function generalGuestPodAsk(o) {
  return new Promise((resolve) => {
    const n = ++GENERAL_GUEST_POD.n;
    if (typeof netWsSend !== 'function' || NETWS.state !== 'on' || !netWsSend({ t: 'gpod', n, ...o })) { resolve(null); return; }
    GENERAL_GUEST_POD.waits.set(n, resolve);
    setTimeout(() => { if (GENERAL_GUEST_POD.waits.delete(n)) resolve(null); }, 25000);
  });
}
async function generalGuestPodVault() {
  const s = GENERAL_GUEST.session;
  if (!s || !s.pod) return null;
  if (GENERAL_GUEST_POD.vault && GENERAL_GUEST_POD.vaultFor === s.accountId) return GENERAL_GUEST_POD.vault;
  const module = await GENERAL_GUEST_POD.load();
  GENERAL_GUEST_POD.vault = module.createGuestCheckpoint({ account: s.accountId }); GENERAL_GUEST_POD.vaultFor = s.accountId;
  return GENERAL_GUEST_POD.vault;
}
// Seal the character here and have the server forward the envelope. Never throws; answers whether the pod took it.
async function generalGuestPodPut(save, { final = false } = {}) {
  const s = GENERAL_GUEST.session, P = GENERAL_GUEST_POD, done = (kind, why) => { P.stats[kind]++; P.stats.last = why; return kind === 'written'; };
  if (!s || !s.pod) return false;
  const usage = generalGuestPodUsage(s.accountId), time = Date.now();
  const due = usage.lastAt + (final ? P.FLOOR : Math.max(P.FLOOR, generalGuestPodInterval(usage.lastBytes)));
  if (P.busy || time < due) {
    // Kept for the next write that is due: the pod's copy lags, it is never dropped.
    P.dirty = save;
    if (!P.timer && !P.busy) P.timer = setTimeout(() => { P.timer = 0; void generalGuestPodFlush(); }, Math.min(due - time + 250, 2147483647));
    return done('skipped', P.busy ? 'busy' : 'spaced');
  }
  if (usage.writes >= P.WRITES || usage.bytes >= P.BYTES) return done('skipped', 'budget');
  // The pod holds a character this browser cannot open: nothing is written over it unless the player chose to.
  if (GENERAL_GUEST.podUnreadable && !GENERAL_GUEST.podReplace) { P.dirty = save; return done('skipped', 'unreadable'); }
  P.busy = true; P.dirty = null;
  try {
    const vault = await generalGuestPodVault();
    if (!vault || GENERAL_GUEST.session !== s) return done('failed', 'no_vault');
    const sealed = await vault.seal(save);
    if (usage.bytes + sealed.bytes > P.BYTES) return done('skipped', 'budget');
    P.stats.sealed++;
    // Counted before it is sent, as the server and the pod count it: an attempt is spent whatever is answered.
    generalGuestPodKeep(s.accountId, { ...usage, writes: usage.writes + 1, bytes: usage.bytes + sealed.bytes, lastAt: time, lastBytes: sealed.bytes });
    const reply = await generalGuestPodAsk({ op: 'put', env: sealed.envelope });
    if (reply && reply.ok) return done('written', 'ok');
    const code = reply && typeof reply.code === 'string' ? reply.code : 'no_reply';
    // Refused before anything left the server: the attempt was not spent.
    if (!reply || ['too_soon', 'busy', 'reauth', 'not_sealed', 'linked', 'off'].includes(code)) generalGuestPodKeep(s.accountId, { ...usage, lastAt: code === 'too_soon' ? time : usage.lastAt });
    if (code === 'budget' || code === 'pod_full') generalGuestPodKeep(s.accountId, { ...usage, writes: P.WRITES, lastAt: time });
    if (code !== 'budget' && code !== 'pod_full' && code !== 'not_sealed') P.dirty = save;
    // The server no longer holds this guest's pod token: where the pod is the character, back through the door.
    if (code === 'reauth' && s.pod === 'authoritative' && GENERAL_GUEST.session === s) generalGuestEnded();
    return done('failed', code);
  } catch (e) { return done('failed', e && e.code === 'too_large' ? 'too_large' : 'seal'); }
  finally { P.busy = false; }
}
// What was held back by the spacing goes once it is due (and before the session's bound, or as the page is hidden).
function generalGuestPodFlush() {
  const save = GENERAL_GUEST_POD.dirty;
  return save ? generalGuestPodPut(save, { final: true }) : Promise.resolve(false);
}
function generalGuestLocal() {
  try { const text = localStorage.getItem(SAVE.lsKey); return text ? JSON.parse(text) : null; } catch (e) { return null; }
}
// Authoritative: the newer of the pod's sealed copy and this browser's own (the pod's lags by its spacing).
async function generalGuestPodGet(serverRef) {
  const s = GENERAL_GUEST.session, P = GENERAL_GUEST_POD;
  const reply = await generalGuestPodAsk({ op: 'get' });
  if (!reply || !reply.ok) throw { code: 'unavailable' };
  const local = generalGuestLocal(), usage = s ? generalGuestPodUsage(s.accountId) : null;
  let kept = null;
  if (reply.env && s) {
    const vault = await generalGuestPodVault(), opened = vault ? await vault.open(reply.env) : null;
    if (opened) { P.stats.opened++; if (opened.at > usage.wipedAt) kept = opened.save; }
    // Sealed by another browser's key (or this browser's key was cleared): it cannot be opened here. It is kept,
    // and a character made here is written over it only once the player says so.
    else { P.stats.unreadable++; generalGuestPodUnreadable(); }
  } else if (reply.present === true) {
    // A document stands in the pod that is not a sealed character this game can read: never taken for an empty pod.
    P.stats.unreadable++; generalGuestPodUnreadable();
  } else if (!reply.env) {
    // Nothing in the pod yet: a character the server kept before the pod became its home is read once, and sealed at the next save.
    try { const before = await serverRef.get(); if (before && before.exists) kept = before.data(); } catch (e) { /* none */ }
  }
  const newer = kept && local ? ((local.savedAt || 0) > (kept.savedAt || 0) ? local : kept) : kept || local;
  return { exists: !!newer, data: () => newer };
}
// The pod's character cannot be opened here. Play goes on with this browser's own copy; the pod's is replaced only
// by the player's own choice (a lost key, or another browser, must never silently cost a character).
function generalGuestPodUnreadable() {
  if (GENERAL_GUEST.podUnreadable) return;
  GENERAL_GUEST.podUnreadable = true; GENERAL_GUEST.podReplace = false;
  const show = () => {
    if (!document.body || $('general-guest-pod-unreadable')) return;
    const box = document.createElement('div'), text = document.createElement('p'), keep = document.createElement('button'), replace = document.createElement('button');
    box.id = 'general-guest-pod-unreadable'; box.setAttribute('role', 'alertdialog'); box.setAttribute('aria-labelledby', 'general-guest-pod-unreadable-text');
    box.style.cssText = 'position:fixed;left:50%;top:max(12px,env(safe-area-inset-top));transform:translateX(-50%);z-index:2147483000;display:grid;gap:8px;'
      + 'width:min(22rem,calc(100vw - 24px));padding:12px;border-radius:10px;background:rgba(14,16,20,0.94);color:#f1ead8;font:400 14px/1.4 system-ui,sans-serif;text-align:center';
    text.id = 'general-guest-pod-unreadable-text'; text.style.margin = '0';
    text.textContent = 'Your Interego pod holds a character this browser cannot open (it was saved from another browser, or this browser\'s key was cleared). '
      + 'It is kept: nothing is written over it unless you choose.';
    for (const b of [keep, replace]) { b.type = 'button'; b.className = 'btn'; b.style.minHeight = '44px'; }
    keep.classList.add('primary'); keep.textContent = 'Keep it (this browser saves only here)';
    replace.textContent = 'Replace it with this browser\'s character';
    keep.onclick = () => box.remove();
    replace.onclick = () => { GENERAL_GUEST.podReplace = true; box.remove(); void generalGuestPodFlush(); };
    box.append(text, keep, replace); document.body.appendChild(box);
    keep.focus({ preventScroll: true });
  };
  try { setTimeout(show, 0); } catch (e) { /* no page here */ }
}
async function generalGuestPodSet(save, options) {
  let local = false;
  try { localStorage.setItem(SAVE.lsKey, JSON.stringify(save)); local = true; } catch (e) { /* storage blocked */ }
  const written = await generalGuestPodPut(save, options);
  if (!local && !written) throw { code: 'unavailable' };
}
async function generalGuestPodDelete(serverRef) {
  const s = GENERAL_GUEST.session;
  if (!s) throw { code: 'unavailable' };
  // The pod takes no deletion from a guest: its copy is marked as given up here, and overwritten by the next character.
  generalGuestPodKeep(s.accountId, { ...generalGuestPodUsage(s.accountId), wipedAt: Date.now() });
  GENERAL_GUEST_POD.dirty = null;
  try { await serverRef.delete(); } catch (e) { /* no save kept from before */ }
  void generalGuestPodPut(null, { final: true });
}
try { addEventListener('pagehide', () => { void generalGuestPodFlush(); }); } catch (e) { /* no page events here */ }
Promise.resolve().then(() => { try { if (window.__hm) window.__hm.generalGuest = { GENERAL_GUEST, GENERAL_GUEST_POD, flush: generalGuestPodFlush, usage: generalGuestPodUsage }; } catch (e) { /* test hooks only */ } });
try { generalGuestRender(); } catch (e) { /* the control is optional: the other ways in stay */ }
