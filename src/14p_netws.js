/* ================================================================== */
/* [net] rung 2: a WebSocket to the March's own server (server/)       */
/* ================================================================== */
// The same link as the artifact's room (14n_net.js: setSlow, setFast, connected, close; the others heard through
// netPeerUpdate, netPeerLeft, netPeerEvents), over a socket to server/server.js: `?server=wss://host/ws` on the page's
// address, or the page served by that server (it sets window.__HM_NET_SERVER). The server keeps the account (a token kept
// for that host in this browser, and, inside the artifact, in the player's private db document so another device finds it
// too), the save (12_save.js asks netServerSaveRef first) and the shared war, relays the others by interest, and checks
// what it relays. A socket that drops is opened again (1, 2, 4 ... 15 s), the profile and the state sent again; a server
// that cannot be reached leaves the page with the artifact's room, or alone.
const NETWS = { ws: null, url: '', host: '', state: 'off', acct: null, token: '', world: null, link: null, linkP: null, waits: [], backoff: 1, stats: { opens: 0, drops: 0, sent: 0, recv: 0, bytesUp: 0, bytesDown: 0, rtt: 0 } };
function netServerUrl() {
  try {
    const q = new URLSearchParams(location.search).get('server');
    const u = q || (window.__HM_NET && window.__HM_NET.server) || window.__HM_NET_SERVER || '';
    if (!u) return '';
    const p = new URL(u);
    return p.protocol === 'ws:' || p.protocol === 'wss:' ? p.href : '';
  } catch (e) { return ''; }
}
// the token for that host: this browser's copy, or the private db document's (the artifact's own account, any device)
async function netWsToken(host) {
  let t = '';
  try { t = localStorage.getItem('hallowmarch.token.' + host) || ''; } catch (e) { /* storage blocked */ }
  if (t) return t;
  try {
    const C = window.claude;
    if (C && typeof C.use === 'function') {
      const [db, user] = await Promise.all([C.use('db'), C.use('user')]);
      const uid = user && (await user.id());
      if (db && uid) { const s = await withTimeout(db.doc('data/users/' + uid + '/server').get(), 4000); const d = s && s.exists ? s.data() : null; if (d && d.tokens && typeof d.tokens[host] === 'string') t = d.tokens[host]; }
    }
  } catch (e) { /* no private document */ }
  return t;
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
function netWsSend(o) {
  const ws = NETWS.ws;
  if (!ws || ws.readyState !== 1) return false;
  const s = JSON.stringify(o);
  NETWS.stats.sent++; NETWS.stats.bytesUp += s.length;
  ws.send(s);
  return true;
}
function netWsOpen() {
  return new Promise((resolve) => {
    let ws;
    try { ws = new WebSocket(NETWS.url); } catch (e) { resolve(false); return; }
    NETWS.ws = ws; NETWS.state = 'opening';
    // 7 s to open; a socket open and waiting on its welcome (a page busy booting, a slow phone) waits 20 s more
    let fail = null;
    const giveUp = () => { try { ws.close(); } catch (e) { /* gone */ } resolve(false); };
    fail = setTimeout(() => { if (ws.readyState === 1 && NETWS.state === 'opening') fail = setTimeout(giveUp, 20000); else giveUp(); }, 7000);
    ws.onopen = async () => {
      NETWS.stats.opens++;
      const tok = NETWS.token || (await netWsToken(NETWS.host));
      const q = new URLSearchParams(location.search);
      netWsSend({ t: 'hello', v: 1, token: tok || undefined, room: q.get('shard') || (window.__HM_NET && window.__HM_NET.shard) || undefined });
    };
    ws.onmessage = (ev) => {
      NETWS.stats.recv++; NETWS.stats.bytesDown += ev.data.length;
      let m; try { m = JSON.parse(ev.data); } catch (e) { return; }
      if (!m || typeof m.t !== 'string') return;
      if (m.t === 'welcome') {
        clearTimeout(fail);
        NETWS.state = 'on'; NETWS.backoff = 1; NETWS.acct = m.acct; NETWS.world = m.world || null;
        NET.self = m.peer; NET.srvWorld = m.world || null; NETWS.season = m.season || null;
        if (typeof m.token === 'string' && m.token !== NETWS.token) { NETWS.token = m.token; netWsTokenKeep(NETWS.host, m.token); }
        NET.slowKey = ''; NET.fastKey = ''; // everything again, to whoever is there now
        resolve(true);
      } else if (m.t === 'denied') { clearTimeout(fail); netNote('denied ' + netStr(m.why, 80)); resolve(false); }
      else if (m.t === 'peer' && typeof m.peer === 'string') netPeerUpdate(m.peer, { by: m.by || null, kind: 'viewer', slow: m.slow, fast: m.fast });
      else if (m.t === 'left' && typeof m.peer === 'string') netPeerLeft(m.peer);
      else if (m.t === 'ev' && typeof m.peer === 'string') netPeerEvents(m.peer, m.ev);
      else if (m.t === 'pong') NETWS.stats.rtt = Math.round(performance.now() - m.c);
      else if (m.t === 'save' || m.t === 'saved') { const w = NETWS.waits.shift(); if (w) w(m); }
      else if (m.t === 'acct') { const w = NETWS.acctWait; NETWS.acctWait = null; if (w) w(m); }
      else if (m.t === 'season' || m.t === 'contrib' || m.t === 'order') netSeasonMsg(m); // the season (14q_netseason.js)
      else if (m.t === 'company' || m.t === 'co') coMsg(m); // [companies] the companies (14r_companies.js)
      else if (m.t === 'hosts' && m.h && typeof m.h === 'object' && Array.isArray(m.kr)) { // the regions' keepers (CLAUDE.md, Multiplayer: who simulates what)
        const h = {};
        for (const k of Object.keys(m.h).slice(0, 12)) if (/^[fhb][0-2]?$/.test(k) && typeof m.h[k] === 'string') h[k] = m.h[k].slice(0, 32);
        NET.regions = { h, kr: m.kr.slice(0, 16).map((x) => netStr(x, 3)), you: netStr(m.you, 3) };
        NET.stats.regions = (NET.stats.regions || 0) + 1;
      } else if (m.t === 'world' && m.w && typeof m.w === 'object') { netWorldTake(netWorldRead(m.w), m.init ? 'keepsall' : 'keeps'); NET.stats.worldIn = (NET.stats.worldIn || 0) + 1; }
    };
    ws.onclose = () => {
      clearTimeout(fail);
      const was = NETWS.state;
      NETWS.state = 'off'; NETWS.ws = null;
      for (const w of NETWS.waits.splice(0)) w(null);
      if (was === 'on') {
        NETWS.stats.drops++;
        for (const peer of [...NET.peers.keys()]) netPeerLeft(peer); // they come back with the next welcome
        setTimeout(netWsReconnect, NETWS.backoff * 1000);
      }
      resolve(false);
    };
  });
}
async function netWsReconnect() {
  if (NETWS.state !== 'off' || !NETWS.link) return;
  const ok = await netWsOpen();
  if (!ok) { NETWS.backoff = Math.min(15, NETWS.backoff * 2); setTimeout(netWsReconnect, NETWS.backoff * 1000); }
}
// the link (one a page: the save's early ask and the room's share it)
function netLinkWS(url) {
  if (NETWS.linkP) return NETWS.linkP;
  NETWS.linkP = (async () => {
    await null; // (the module's top level has run: the boot asks before it does)
    const u = url && /^wss?:/.test(url) ? url : netServerUrl();
    if (!u || typeof WebSocket === 'undefined') return null;
    NETWS.url = u; NETWS.host = new URL(u).host;
    const ok = await netWsOpen();
    if (!ok) { netNote('server unreachable'); return null; }
    const L = NETWS.link = {
      kind: 'ws',
      setSlow: (o) => netWsSend({ t: 'slow', d: o }),
      setFast: (o) => netWsSend({ t: 'fast', d: o }),
      connected: () => NETWS.state === 'on',
      close: () => { NETWS.link = null; try { if (NETWS.ws) NETWS.ws.close(); } catch (e) { /* gone */ } },
    };
    setInterval(() => netWsSend({ t: 'ping', c: performance.now() }), 10000);
    return L;
  })();
  return NETWS.linkP;
}
// the account: name a guest's (`claim`: it keeps its character), or sign in to a named one (`login`: its token is kept and
// the page loads again, so the boot reads that account's save: nothing of the guest's character is written over it)
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
  await netWsTokenKeep(NETWS.host, r.token);
  NETWS.reload = true;
  setTimeout(() => location.reload(), 600);
  return r;
}
async function netAcctOut() {
  try { localStorage.removeItem('hallowmarch.token.' + NETWS.host); } catch (e) { /* storage blocked */ }
  try {
    const C = window.claude;
    if (C && typeof C.use === 'function') {
      const [db, user] = await Promise.all([C.use('db'), C.use('user')]);
      const uid = user && (await user.id());
      if (db && uid) { const ref = db.doc('data/users/' + uid + '/server'); const s = await ref.get(); const d = s.exists ? s.data() : {}; const tokens = { ...(d.tokens || {}) }; delete tokens[NETWS.host]; await ref.set({ tokens }); }
    }
  } catch (e) { /* kept in this browser only */ }
  NETWS.reload = true;
  setTimeout(() => location.reload(), 300);
}
// the save held by the server (12_save.js: initSaveBackend asks this first): a document's three calls over the socket
async function netServerSaveRef() {
  await null;
  if (!netServerUrl()) return null;
  const L = await netLinkWS();
  if (!L) return null;
  const ask = (o) => new Promise((res) => { if (!netWsSend(o)) { res(null); return; } NETWS.waits.push(res); setTimeout(() => { const i = NETWS.waits.indexOf(res); if (i >= 0) { NETWS.waits.splice(i, 1); res(null); } }, 8000); });
  return {
    get: async () => { const m = await ask({ t: 'load' }); if (!m) throw { code: 'unavailable' }; return { exists: !!m.d, data: () => m.d }; },
    set: async (s) => { const m = await ask({ t: 'save', d: s }); if (!m || !m.ok) throw { code: 'unavailable' }; },
    delete: async () => { await ask({ t: 'wipe' }); },
  };
}
