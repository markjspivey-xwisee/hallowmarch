/* [guest] Interego's general guest as one more way into the server-hosted March (issue 105;
 * server/gaming/general-guest.js). A general guest is one guest per browser across every
 * Interego application: its key lives on identity's guest door, never here. The page only
 *   - offers "Continue as an Interego guest" beside the other ways in, where the server says so;
 *   - sends the browser to the server's start route (a top-level navigation; the server binds
 *     the visit with an HttpOnly cookie and redirects to the door);
 *   - on the way back collects its game session once, by that cookie, and takes the flag out of
 *     the address (no code and no bearer is ever in an address);
 *   - plays with the March's server holding the character (the save's `load`, `save`, `wipe`);
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
    return { host: u.host, start: origin + m.startPath, session: origin + m.sessionPath };
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
  GENERAL_GUEST.timers.push(setTimeout(() => { if (GAME.started && GAME.player && typeof saveNow === 'function') saveNow(); }, Math.max(0, left - 25000)));
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
  GENERAL_GUEST.session = { host: policy.host, accountId: marker.accountId, expiresAt: marker.expiresAt, linked: marker.linked, start: policy.start };
  generalGuestRender(); generalGuestWatch();
  if (!ref) return null; // the server could not be reached: this browser keeps the character until it can
  return { server: true, generalGuest: true, get: ref.get, set: ref.set,
    // A guest linked to an account plays that account's guest character and never deletes it.
    delete: marker.linked ? async () => { throw { code: 'not_granted' }; } : ref.delete };
}
try { generalGuestRender(); } catch (e) { /* the control is optional: the other ways in stay */ }
