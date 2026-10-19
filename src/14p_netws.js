/* ================================================================== */
/* [net] rung 2: a WebSocket to the March's own server (server/)       */
/* ================================================================== */
// The save's early request and the multiplayer pump share one attempt. A failed
// boot request is retryable after GAME.ready; reconnecting never reloads a save.
const NETWS = { ws: null, url: '', host: '', state: 'off', acct: null, token: '', world: null, worldPauseReason: '', worldPersistence: null, link: null, linkP: null, openP: null, generation: 0, cancelOpen: null, retryTimer: 0, pingTimer: 0, closed: false, waits: [], backoff: 1, lastFailure: '', lastClose: null, stats: { opens: 0, drops: 0, sent: 0, recv: 0, bytesUp: 0, bytesDown: 0, rtt: 0 } };
// World/season admission and the owner's character save are separate. Keep a
// pause visible across disconnects; only a fresh server status can clear it.
function netWsWorldStatus(value, entry = false) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || value.scope !== 'world-and-season') return;
  const paused = value.fenced === true || ['conflict', 'recovering', 'closing', 'closed', 'closed-unconfirmed'].includes(value.state);
  const running = value.fenced === false && value.mode === 'native' && value.enabled === true
    && ['confirmed', 'pending', 'delayed'].includes(value.state) && Number.isSafeInteger(value.confirmedVersion) && value.confirmedVersion > 0;
  const legacyEntry = entry && value.mode === 'legacy' && value.enabled === false;
  if (!paused && !running && !legacyEntry) return;
  NETWS.worldPersistence = { state: netStr(value.state, 32), mode: netStr(value.mode, 16),
    confirmedVersion: Number.isSafeInteger(value.confirmedVersion) ? value.confirmedVersion : null };
  const wasPaused = !!NETWS.worldPauseReason;
  NETWS.worldPauseReason = paused ? 'World and season changes paused until recovery.' : '';
  if (paused === wasPaused) return;
  const message = paused ? 'World and season changes are paused while the server recovers.' : 'World and season updates have resumed.';
  netNote(paused ? 'world and season paused' : 'world and season resumed');
  uiLog(message, 'sys');
  if (GAME.started) uiToast(message, 'hint');
  if (typeof NETUI !== 'undefined' && NETUI.open) netSheetRender();
}
netWsWorldStatus(window.__HM_GAMING && window.__HM_GAMING.worldAuthority, true);
function netServerUrl() {
  try {
    const q = new URLSearchParams(location.search).get('server');
    const u = q || (window.__HM_NET && window.__HM_NET.server) || window.__HM_NET_SERVER || '';
    if (!u) return '';
    const p = new URL(u);
    return p.protocol === 'ws:' || p.protocol === 'wss:' ? p.href : '';
  } catch (e) { return ''; }
}
// Resolve credentials before opening: the server allows only 10 s for hello.
// Unknown private storage is a retryable failure, never evidence of a new guest.
async function netWsToken(host) {
  let t = '';
  try { t = localStorage.getItem('hallowmarch.token.' + host) || ''; } catch (e) { /* try private storage */ }
  if (t) return t;
  const C = window.claude;
  if (!C || typeof C.use !== 'function') return '';
  return withTimeout((async () => {
    const [db, user] = await Promise.all([C.use('db'), C.use('user')]);
    if (!db || !user || typeof user.id !== 'function') throw { code: 'unavailable' };
    const uid = await user.id();
    if (!uid) return '';
    const s = await db.doc('data/users/' + uid + '/server').get();
    if (!s || typeof s.exists !== 'boolean') throw { code: 'unavailable' };
    const d = s.exists ? s.data() : null;
    return d && d.tokens && typeof d.tokens[host] === 'string' ? d.tokens[host] : '';
  })(), 4000);
}
async function netWsTokenKeep(host, t) {
  try { localStorage.setItem('hallowmarch.token.' + host, t); } catch (e) { /* storage blocked */ }
  try {
    const C = window.claude;
    if (C && typeof C.use === 'function') {
      const [db, user] = await Promise.all([C.use('db'), C.use('user')]);
      const uid = user && (await user.id());
      if (db && uid) { const ref = db.doc('data/users/' + uid + '/server'); const s = await ref.get(); const d = s.exists ? s.data() : {}; const tokens = { ...(d.tokens || {}), [host]: t }; await ref.set({ tokens }); }
    }
  } catch (e) { /* a viewer who may not write keeps it in this browser */ }
}
// Explicit title recovery removes only the refused app-session proof. Native
// owner grants, encryption keys and private characters belong to other ports.
async function netWsTokenForget(host, rejectedToken, allowed = () => false) {
  const deadline = Date.now() + 8000; let valid = true, timer;
  const active = () => {
    if (!valid || Date.now() >= deadline || !allowed() || GAME.started || SAVE.pending || SAVE.nativeFlight || NETWS.host !== host || !rejectedToken
      || (NETWS.token && NETWS.token !== rejectedToken)) throw new Error('Keep the current character open; its connection cannot be replaced.');
    const stored = localStorage.getItem('hallowmarch.token.' + host);
    if (stored && stored !== rejectedToken) throw new Error('Another game session arrived. Retry its connection before signing in again.');
    return stored;
  };
  const clearing = (async () => {
    active();
    const C = window.claude;
    if (C && typeof C.use === 'function') {
      const [db, user] = await Promise.all([C.use('db'), C.use('user')]); active();
      if (!db || !user || typeof user.id !== 'function') throw new Error('The previous game session storage is unavailable. Retry the connection.');
      const uid = await user.id(); active();
      if (!uid) throw new Error('The previous game session storage is not confirmed. Retry the connection.');
      const ref = db.doc('data/users/' + uid + '/server');
      const read = async () => {
        const snap = await ref.get(); active();
        if (!snap || typeof snap.exists !== 'boolean') throw new Error('The previous game session storage is not confirmed. Retry the connection.');
        const data = snap.exists ? snap.data() : {}, token = data?.tokens?.[host];
        if (!data || typeof data !== 'object' || Array.isArray(data)
          || (data.tokens !== undefined && (!data.tokens || typeof data.tokens !== 'object' || Array.isArray(data.tokens)))
          || (token && token !== rejectedToken)) throw new Error('Another game session arrived. Retry its connection before signing in again.');
        return data;
      };
      const data = await read(); active();
      if (data.tokens?.[host]) {
        const latest = await read(); active();
        const tokens = { ...(latest.tokens || {}) }; delete tokens[host];
        await ref.set({ ...latest, tokens }); active();
        if ((await read()).tokens?.[host]) throw new Error('The previous game session was not cleared. Retry the connection.');
      }
    }
    if (active()) localStorage.removeItem('hallowmarch.token.' + host);
    if (active()) throw new Error('The previous game session was not cleared. Retry the connection.');
  })();
  try {
    await Promise.race([clearing, new Promise((resolve, reject) => { timer = setTimeout(() => {
      valid = false; reject(new Error('The previous game session storage did not confirm in time. Retry the connection.'));
    }, 8000); })]);
  } finally { valid = false; clearTimeout(timer); }
}
function netWsSend(o, ws = NETWS.ws) {
  if (!ws || ws !== NETWS.ws || NETWS.state === 'off' || ws.readyState !== 1) return false;
  try {
    const s = JSON.stringify(o);
    ws.send(s);
    NETWS.stats.sent++; NETWS.stats.bytesUp += s.length;
    return true;
  } catch (e) { return false; }
}
function netWsPendingFail() {
  for (const w of NETWS.waits.splice(0)) w(null);
  const w = NETWS.acctWait; NETWS.acctWait = null;
  if (w) w({ ok: false, why: 'The server disconnected' });
}
function netWsRetryLater() {
  if (NETWS.retryTimer || NETWS.closed || NETWS.reload || !NETWS.link) return;
  NETWS.retryTimer = setTimeout(() => { NETWS.retryTimer = 0; netWsReconnect(); }, NETWS.backoff * 1000);
}
// A timed-out FIFO request makes every outstanding reply ambiguous. Retire the
// identity before closing: native close events may arrive after queued messages.
function netWsRetire(ws, why) {
  if (NETWS.ws !== ws || (!ws && !NETWS.openP)) return false;
  const was = NETWS.state;
  if (NETWS.cancelOpen) NETWS.cancelOpen();
  // A caller may request a fresh transport in this same turn, before the old
  // link promise's cleanup microtask runs. It must not inherit that attempt.
  NETWS.linkP = null;
  ++NETWS.generation; NETWS.ws = null; NETWS.state = 'off'; NETWS.lastFailure = why;
  netWsPendingFail();
  if (was === 'on') {
    NETWS.stats.drops++;
    for (const peer of [...NET.peers.keys()]) netPeerLeft(peer);
    netWsRetryLater();
  }
  if (ws) try { ws.close(); } catch (e) { /* already retired */ }
  return true;
}
function netWsOpen() {
  if (NETWS.closed || NETWS.reload) return Promise.resolve(false);
  if (NETWS.state === 'on' && NETWS.ws && NETWS.ws.readyState === 1) return Promise.resolve(true);
  if (NETWS.openP) return NETWS.openP;
  const generation = ++NETWS.generation, host = NETWS.host, url = NETWS.url;
  // Retire a closing socket before replacing it. Its queued callbacks remain
  // harmless because every handler checks both this generation and identity.
  const old = NETWS.ws; NETWS.ws = null; NETWS.state = 'opening';
  if (old) { netWsPendingFail(); try { old.close(); } catch (e) { /* gone */ } }
  let resolveOpen, settled = false, ws = null, fail = 0;
  const p = new Promise((resolve) => { resolveOpen = resolve; });
  NETWS.openP = p;
  const current = () => generation === NETWS.generation && !NETWS.closed && !NETWS.reload && (!ws || NETWS.ws === ws);
  const finish = (ok, why = '') => {
    if (settled) return;
    settled = true; clearTimeout(fail);
    if (NETWS.openP === p) { NETWS.openP = null; NETWS.cancelOpen = null; }
    if (!ok && generation === NETWS.generation) {
      NETWS.lastFailure = why; NETWS.state = 'off';
      if (NETWS.ws === ws) NETWS.ws = null;
      if (ws) try { ws.close(); } catch (e) { /* gone */ }
    }
    resolveOpen(ok);
  };
  NETWS.cancelOpen = () => finish(false, 'cancelled');
  (async () => {
    let tok;
    try { tok = NETWS.token || await netWsToken(host); }
    catch (e) { if (current()) finish(false, 'token unavailable'); else finish(false, 'superseded'); return; }
    if (!current()) { finish(false, 'superseded'); return; }
    if (typeof tok !== 'string') { finish(false, 'token unavailable'); return; }
    try { ws = new WebSocket(url); } catch (e) { finish(false, 'socket unavailable'); return; }
    NETWS.ws = ws;
    const giveUp = () => { if (current()) finish(false, 'welcome timeout'); };
    // Keep the existing handshake limits; retries handle boot CPU stalls.
    fail = setTimeout(() => { if (!current()) return; if (ws.readyState === 1 && NETWS.state === 'opening') fail = setTimeout(giveUp, 20000); else giveUp(); }, 7000);
    ws.onopen = () => {
      if (!current() || settled) return;
      NETWS.stats.opens++;
      const q = new URLSearchParams(location.search);
      if (!netWsSend({ t: 'hello', v: 1, token: tok || undefined, room: q.get('shard') || (window.__HM_NET && window.__HM_NET.shard) || undefined }, ws)) finish(false, 'hello failed');
    };
    ws.onmessage = (ev) => {
      if (!current()) return;
      NETWS.stats.recv++; NETWS.stats.bytesDown += ev.data.length;
      let m; try { m = JSON.parse(ev.data); } catch (e) { return; }
      if (!m || typeof m.t !== 'string') return;
      if (m.t === 'welcome') {
        if (settled || NETWS.state !== 'opening') return;
        NETWS.state = 'on'; NETWS.backoff = 1; NETWS.lastFailure = ''; NETWS.acct = m.acct; NETWS.world = m.world || null;
        netWsWorldStatus(m.worldAuthority, true);
        NET.self = m.peer; NETWS.worldRoom = m.room; NET.srvWorld = m.world || null; NET.srvWorldDone = false; NETWS.season = m.season || null;
        if (typeof m.token === 'string' && m.token !== NETWS.token) { NETWS.token = m.token; netWsTokenKeep(host, m.token); }
        NET.slowKey = ''; NET.fastKey = '';
        // Profile precedes a reconnecting player's first company/season action.
        if (GAME.ready && GAME.started && GAME.player) netWsSend({ t: 'slow', d: netSlowObj() }, ws);
        finish(true);
      } else if (m.t === 'denied') { netNote('denied ' + netStr(m.why, 80)); finish(false, 'denied'); }
      else if (NETWS.state !== 'on') return;
      else if (m.t === 'world-status') netWsWorldStatus(m.persistence);
      else if (m.t === 'peer' && typeof m.peer === 'string') netPeerUpdate(m.peer, { by: m.by || null, kind: 'viewer', slow: m.slow, fast: m.fast });
      else if (m.t === 'left' && typeof m.peer === 'string') netPeerLeft(m.peer);
      else if (m.t === 'ev' && typeof m.peer === 'string') netPeerEvents(m.peer, m.ev);
      else if (m.t === 'gaming') gamingMsg(m);
      else if (m.t === 'world-agent' && typeof mainWorldAgentMessage === 'function') mainWorldAgentMessage(m);
      else if (m.t === 'pong') NETWS.stats.rtt = Math.round(performance.now() - m.c);
      else if (m.t === 'save' || m.t === 'saved') { const w = NETWS.waits.shift(); if (w) w(m); }
      else if (m.t === 'acct') { const w = NETWS.acctWait; NETWS.acctWait = null; if (w) w(m); }
      else if (m.t === 'season' || m.t === 'contrib' || m.t === 'order') { if (m.persistence) netWsWorldStatus(m.persistence); netSeasonMsg(m); }
      else if (m.t === 'company' || m.t === 'co') coMsg(m);
      else if (m.t === 'sarmy' || m.t === 'sarmyfold') season2ServerMsg(m);
      else if (m.t === 'hosts' && m.h && typeof m.h === 'object' && Array.isArray(m.kr)) {
        const h = {};
        for (const k of Object.keys(m.h).slice(0, 12)) if (/^[fhb][0-2]?$/.test(k) && typeof m.h[k] === 'string') h[k] = m.h[k].slice(0, 32);
        NET.regions = { h, kr: m.kr.slice(0, 16).map((x) => netStr(x, 3)), you: netStr(m.you, 3) };
        NET.stats.regions = (NET.stats.regions || 0) + 1;
      } else if (m.t === 'world' && m.w && typeof m.w === 'object') { netWorldTake(netWorldRead(m.w), m.init ? 'keepsall' : 'keeps'); NET.stats.worldIn = (NET.stats.worldIn || 0) + 1; }
    };
    ws.onclose = (ev) => {
      if (!current()) return;
      const was = NETWS.state;
      NETWS.lastClose = { code: ev && ev.code || 0, reason: netStr(ev && ev.reason, 80) };
      if (!settled) finish(false, 'socket closed');
      else { NETWS.state = 'off'; NETWS.ws = null; }
      netWsPendingFail();
      if (was === 'on') {
        NETWS.stats.drops++;
        for (const peer of [...NET.peers.keys()]) netPeerLeft(peer);
        netWsRetryLater();
      }
    };
  })().catch(() => finish(false, 'connection failed'));
  return p;
}
async function netWsReconnect() {
  if (NETWS.state !== 'off' || !NETWS.link || NETWS.closed || NETWS.reload) return;
  const ok = await netWsOpen();
  if (!ok && !NETWS.closed && !NETWS.reload) { NETWS.backoff = Math.min(15, NETWS.backoff * 2); netWsRetryLater(); }
}
// Only pending requests are shared: a rejected or null result must not be cached.
function netLinkWS(url) {
  if (NETWS.linkP) return NETWS.linkP;
  const p = (async () => {
    await null; // boot may ask before this module's top level has run
    const u = url && /^wss?:/.test(url) ? url : netServerUrl();
    if (!u || typeof WebSocket === 'undefined' || NETWS.reload) return null;
    const host = new URL(u).host;
    if (NETWS.url && NETWS.url !== u && NETWS.link) NETWS.link.close();
    if (NETWS.host && NETWS.host !== host) { NETWS.token = ''; NETWS.acct = null; }
    NETWS.url = u; NETWS.host = host; NETWS.closed = false;
    const opening = netWsOpen(), generation = NETWS.generation;
    const ok = await opening;
    if (!ok || generation !== NETWS.generation || NETWS.closed || NETWS.reload
      || NETWS.state !== 'on' || NETWS.ws?.readyState !== 1) { netNote('server unreachable'); return null; }
    if (NETWS.link) return NETWS.link;
    const L = NETWS.link = {
      kind: 'ws',
      setSlow: (o) => netWsSend({ t: 'slow', d: o }),
      setFast: (o) => netWsSend({ t: 'fast', d: o }),
      connected: () => NETWS.link === L && NETWS.state === 'on',
      close: () => {
        if (NETWS.link !== L) return;
        NETWS.closed = true; NETWS.link = null;
        clearTimeout(NETWS.retryTimer); NETWS.retryTimer = 0;
        clearInterval(NETWS.pingTimer); NETWS.pingTimer = 0;
        if (NETWS.cancelOpen) NETWS.cancelOpen();
        NETWS.linkP = null;
        ++NETWS.generation;
        const ws = NETWS.ws; NETWS.ws = null; NETWS.state = 'off';
        if (ws) try { ws.close(); } catch (e) { /* gone */ }
        netWsPendingFail();
        if (NET.link === L) { NET.link = null; NET.state = 'alone'; }
      },
    };
    if (!NETWS.pingTimer) NETWS.pingTimer = setInterval(() => { if (NETWS.state === 'on' && !NETWS.reload) netWsSend({ t: 'ping', c: performance.now() }); }, 10000);
    return L;
  })();
  NETWS.linkP = p;
  const clear = () => { if (NETWS.linkP === p) NETWS.linkP = null; };
  p.then(clear, clear);
  return p;
}
// Login keeps the old socket's identity until the page reloads and reads the new save.
function netWsAcct(op, name, pass) {
  return new Promise((res) => {
    if (NETWS.acctWait || !netWsSend({ t: 'acct', op, name, pass })) { res({ ok: false, why: NETWS.acctWait ? 'Wait a moment' : 'Not linked to the server' }); return; }
    NETWS.acctWait = res;
    setTimeout(() => { if (NETWS.acctWait === res) { NETWS.acctWait = null; res({ ok: false, why: 'The server did not answer' }); } }, 9000);
  });
}
async function netAcctDo(op, name, pass) {
  const r = await netWsAcct(op, name, pass);
  if (!r || !r.ok || !r.acct || typeof r.token !== 'string') return r;
  NETWS.stats.acct = (NETWS.stats.acct || 0) + 1;
  if (op === 'claim') { NETWS.acct = r.acct; NETWS.token = r.token; await netWsTokenKeep(NETWS.host, r.token); return r; }
  NETWS.reload = true;
  await netWsTokenKeep(NETWS.host, r.token);
  setTimeout(() => location.reload(), 600);
  return r;
}
async function netAcctOut() {
  await nativePlayerForget();
  NETWS.reload = true;
  try { localStorage.removeItem('hallowmarch.token.' + NETWS.host); } catch (e) { /* storage blocked */ }
  try {
    const C = window.claude;
    if (C && typeof C.use === 'function') {
      const [db, user] = await Promise.all([C.use('db'), C.use('user')]);
      const uid = user && (await user.id());
      if (db && uid) { const ref = db.doc('data/users/' + uid + '/server'); const s = await ref.get(); const d = s.exists ? s.data() : {}; const tokens = { ...(d.tokens || {}) }; delete tokens[NETWS.host]; await ref.set({ tokens }); }
    }
  } catch (e) { /* kept in this browser only */ }
  setTimeout(() => location.reload(), 300);
}
// A remote reference belongs to the account that was actually read at boot.
// Late multiplayer recovery never changes SAVE.ref or promotes a local session.
async function netServerSaveRef() {
  await null;
  if (!netServerUrl()) return null;
  const L = await netLinkWS();
  if (!L) return null;
  const owner = NETWS.acct && NETWS.acct.id, host = NETWS.host;
  const owned = () => owner && NETWS.host === host && NETWS.acct && NETWS.acct.id === owner;
  const ask = (o) => new Promise((res, reject) => {
    if (!owned()) { reject({ code: 'revoked' }); return; }
    const ws = NETWS.ws;
    if (NETWS.state !== 'on' || !netWsSend(o, ws)) { res(null); return; }
    NETWS.waits.push(res);
    setTimeout(() => {
      const i = NETWS.waits.indexOf(res);
      if (i >= 0 && !netWsRetire(ws, 'save reply timeout')) {
        NETWS.waits.splice(i, 1); res(null);
      }
    }, 8000);
  });
  return {
    get: async () => { const m = await ask({ t: 'load' }); if (!m) throw { code: 'unavailable' }; return { exists: !!m.d, data: () => m.d }; },
    set: async (s) => { const m = await ask({ t: 'save', d: s }); if (!m || !m.ok) throw { code: 'unavailable' }; },
    delete: async () => { const m = await ask({ t: 'wipe' }); if (!m || !m.ok) throw { code: 'unavailable' }; },
  };
}
