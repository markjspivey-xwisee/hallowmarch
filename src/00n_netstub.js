/* ================================================================== */
/* [net] a stand-in for the artifact runtime's room, db and user        */
/* ================================================================== */
// The published page reaches the others who have it open through the artifact runtime: `claude.use('room')` (presence
// and moments), `claude.use('db')` (shared documents) and `claude.use('user')` (who is viewing). None of that exists in
// this container, so this stand-in implements the same calls over a BroadcastChannel and localStorage: every page of
// one browser profile (the tests' pages, two tabs on a desk) that installs it with the same room name is in one room.
// It keeps the runtime's rules where they shape the client: presence is a merged object of at most 4 KiB sent coalesced
// (about 30 a second), per field latest wins, a top-level null removes a field, newcomers get everyone's presence,
// a page that leaves (or stops answering for 12 s: `silence`) is in `left`; `emit` on a topic is refused (`not_permitted`) unless
// the stand-in is told the viewer may send (`emit: true`): viewers by link may set presence only, so the client never
// needs a topic; db writes are refused (`invalid_argument`) for a viewer at `view` (`dbWrite: false`); `join(name)` gives
// a named room. It can also delay and drop what it carries (`latency`, `jitter`, `drop`) to try the client against a
// slow or lossy room.
// Installed only when asked: an init script sets `window.__HM_NET = { room, user, ... }` before the page's own script
// (tools/tests/net.py), or the page's address carries `?net=local` (two tabs of the built file on one machine). A page
// that already has `window.claude` (the published artifact) never installs it.
const NETSTUB = { on: false, cfg: null, ch: null, peer: '', rooms: new Map(), stats: { sent: 0, recv: 0, bytes: 0, dropped: 0, refused: 0 } };
function netStubCfg() {
  try {
    if (window.__HM_NET && typeof window.__HM_NET === 'object') return window.__HM_NET;
    const q = new URLSearchParams(location.search);
    if (q.get('net') === 'local') return { room: q.get('room') || 'local', user: null, emit: false, dbWrite: true };
  } catch (e) { /* no address to read */ }
  return null;
}
function netStubId(n) { const a = 'abcdefghijkmnpqrstuvwxyz23456789'; let s = ''; for (let i = 0; i < n; i++) s += a[Math.floor(Math.random() * a.length)]; return s; }
function netStubInstall() {
  const cfg = netStubCfg();
  if (!cfg || (window.claude && typeof window.claude.use === 'function') || typeof BroadcastChannel === 'undefined') return false;
  NETSTUB.on = true; NETSTUB.cfg = cfg;
  let uid = cfg.user;
  if (!uid) { try { uid = sessionStorage.getItem('hmstub.uid'); if (!uid) { uid = 'u' + netStubId(10); sessionStorage.setItem('hmstub.uid', uid); } } catch (e) { uid = 'u' + netStubId(10); } }
  NETSTUB.uid = uid;
  NETSTUB.peer = netStubId(16);
  const ch = NETSTUB.ch = new BroadcastChannel('hm-net-' + (cfg.room || 'default'));
  const lat = () => Math.max(0, (+cfg.latency || 0) + (Math.random() - 0.5) * 2 * (+cfg.jitter || 0));
  const post = (m) => {
    const s = JSON.stringify(m);
    NETSTUB.stats.sent++; NETSTUB.stats.bytes += s.length;
    if (m.type === 'emit' && cfg.drop && Math.random() < cfg.drop) { NETSTUB.stats.dropped++; return; }
    ch.postMessage(s);
  };
  // the lobby is the room named '', every named room another
  const mkRoom = (name) => {
    const R = { name, peers: new Map(), mine: {}, handlers: new Map(), peerFns: new Set(), connFns: new Set(), pend: { joined: new Map(), left: new Map(), updated: new Map() }, flushAt: 0, snap: Object.freeze([]), dirty: false, presT: 0, left: false };
    NETSTUB.rooms.set(name, R);
    const me = () => Object.freeze({ peer: NETSTUB.peer, by: uid, isMe: true, sameTab: true, kind: 'viewer', guest: false, presence: Object.freeze({ ...R.mine }), updatedAt: Date.now() });
    R.peers.set(NETSTUB.peer, me());
    R.snapRebuild = () => { R.snap = Object.freeze([...R.peers.values()]); };
    R.snapRebuild();
    R.queue = (kind, p) => {
      const P = R.pend;
      if (kind === 'joined') { P.left.delete(p.peer); P.joined.set(p.peer, p); }
      else if (kind === 'left') { if (P.joined.has(p.peer)) P.joined.delete(p.peer); else P.left.set(p.peer, p); P.updated.delete(p.peer); }
      else if (!P.joined.has(p.peer)) P.updated.set(p.peer, p);
      else P.joined.set(p.peer, p);
      if (!R.flushT) R.flushT = setTimeout(R.flush, 16); // at most once a frame
    };
    R.flush = () => {
      R.flushT = 0;
      if (R.left) return;
      R.snapRebuild();
      const ch = { peers: R.snap, joined: Object.freeze([...R.pend.joined.values()]), left: Object.freeze([...R.pend.left.values()]), updated: Object.freeze([...R.pend.updated.values()]) };
      R.pend.joined.clear(); R.pend.left.clear(); R.pend.updated.clear();
      for (const fn of R.peerFns) { try { fn(ch); } catch (e) { setTimeout(() => { throw e; }); } }
    };
    R.sendPres = () => {
      R.presTimer = 0; R.presT = performance.now();
      post({ type: 'pres', from: NETSTUB.peer, by: uid, room: name, p: R.mine });
    };
    const api = {
      name,
      emit(topic, data) {
        if (R.left) return Promise.reject({ code: 'invalid_argument', message: 'left' });
        if (!/^[a-z][a-z0-9_.-]{0,47}$/.test(topic)) return Promise.reject({ code: 'invalid_argument', message: 'topic grammar' });
        if (!cfg.emit) { NETSTUB.stats.refused++; return Promise.reject({ code: 'not_permitted', message: 'topics are admin-only here' }); }
        const s = JSON.stringify(data ?? null);
        if (s.length > 4096) return Promise.reject({ code: 'invalid_argument', message: 'data over 4 KiB' });
        post({ type: 'emit', from: NETSTUB.peer, by: uid, room: name, topic, data: JSON.parse(s) });
        const own = R.handlers.get(topic); // yours comes back isMe && sameTab
        if (own) setTimeout(() => { for (const fn of own) fn({ topic, data: JSON.parse(s), peer: NETSTUB.peer, by: uid, isMe: true, sameTab: true, kind: 'viewer', guest: false }); }, 0);
        return Promise.resolve();
      },
      on(topic, fn) {
        if (typeof fn !== 'function') throw new TypeError('handler');
        if (!R.handlers.has(topic)) R.handlers.set(topic, new Set());
        R.handlers.get(topic).add(fn);
        return () => { const s = R.handlers.get(topic); if (s) s.delete(fn); };
      },
      presence(patch) {
        if (R.left) return Promise.reject({ code: 'invalid_argument', message: 'left' });
        if (!patch || typeof patch !== 'object') return Promise.reject({ code: 'invalid_argument', message: 'patch' });
        const next = { ...R.mine };
        for (const k in patch) { if (patch[k] === null) delete next[k]; else next[k] = patch[k]; }
        let s;
        try { s = JSON.stringify(next); } catch (e) { return Promise.reject({ code: 'invalid_argument', message: 'not JSON' }); }
        if (new TextEncoder().encode(s).length > 4096) { NETSTUB.stats.refused++; return Promise.reject({ code: 'invalid_argument', message: 'presence over 4 KiB' }); }
        R.mine = JSON.parse(s);
        R.peers.set(NETSTUB.peer, me());
        R.queue('updated', R.peers.get(NETSTUB.peer));
        // coalesced, whole, about 30 a second
        if (!R.presTimer) R.presTimer = setTimeout(R.sendPres, Math.max(0, 33 - (performance.now() - R.presT)));
        return Promise.resolve();
      },
      peers() { return R.snap; },
      onPeers(fn) {
        R.peerFns.add(fn);
        // the first delivery presents the room so far as joined, you included
        setTimeout(() => { if (!R.peerFns.has(fn)) return; R.snapRebuild(); fn({ peers: R.snap, joined: R.snap, left: Object.freeze([]), updated: Object.freeze([]) }); }, 0);
        return () => R.peerFns.delete(fn);
      },
      connected() { return !R.left; },
      onConnection(fn) { R.connFns.add(fn); setTimeout(() => { if (R.connFns.has(fn)) fn(!R.left); }, 0); return () => R.connFns.delete(fn); },
      leave() { if (!R.left) { R.left = true; post({ type: 'leave', from: NETSTUB.peer, room: name }); NETSTUB.rooms.delete(name); } return Promise.resolve(); },
    };
    R.api = api;
    return R;
  };
  const lobby = mkRoom('');
  const deliver = (m) => {
    NETSTUB.stats.recv++;
    // a page heard again after it was taken for gone (its timers starved, or new): everyone says again who they are, as a
    // room hands a reconnected page everyone's presence and everyone its own
    if (m.type !== 'hello' && m.type !== 'bye' && !NETSTUB.seen.has(m.from)) { NETSTUB.seen.set(m.from, performance.now()); NETSTUB.stats.back = (NETSTUB.stats.back || 0) + 1; post({ type: 'hello', from: NETSTUB.peer }); for (const R of NETSTUB.rooms.values()) post({ type: 'pres', from: NETSTUB.peer, by: uid, room: R.name, p: R.mine, re: 1 }); }
    if (m.type === 'hello') { for (const R of NETSTUB.rooms.values()) post({ type: 'pres', from: NETSTUB.peer, by: uid, room: R.name, p: R.mine, re: 1 }); return; }
    if (m.type === 'bye') { for (const R of NETSTUB.rooms.values()) { const p = R.peers.get(m.from); if (p) { R.peers.delete(m.from); R.queue('left', p); } } NETSTUB.seen.delete(m.from); return; }
    if (m.type === 'hb') { NETSTUB.seen.set(m.from, performance.now()); return; }
    const R = NETSTUB.rooms.get(m.room);
    if (!R) return;
    NETSTUB.seen.set(m.from, performance.now());
    if (m.type === 'leave') { const p = R.peers.get(m.from); if (p) { R.peers.delete(m.from); R.queue('left', p); } return; }
    if (m.type === 'pres') {
      const had = R.peers.get(m.from);
      const p = Object.freeze({ peer: m.from, by: m.by || null, isMe: m.by === uid, sameTab: false, kind: 'viewer', guest: false, presence: Object.freeze(m.p || {}), updatedAt: Date.now() });
      R.peers.set(m.from, p);
      R.queue(had ? 'updated' : 'joined', p);
      return;
    }
    if (m.type === 'emit') {
      const hs = R.handlers.get(m.topic);
      if (hs) for (const fn of hs) { try { fn({ topic: m.topic, data: m.data, peer: m.from, by: m.by || null, isMe: m.by === uid, sameTab: false, kind: 'viewer', guest: false }); } catch (e) { setTimeout(() => { throw e; }); } }
    }
  };
  NETSTUB.seen = new Map();
  ch.onmessage = (ev) => {
    let m; try { m = JSON.parse(ev.data); } catch (e) { return; }
    if (!m || m.from === NETSTUB.peer) return;
    const d = lat();
    if (d > 0) setTimeout(() => deliver(m), d); else deliver(m);
  };
  post({ type: 'hello', from: NETSTUB.peer });
  // a heartbeat, and a page not heard for 12 s has left (a page killed without its goodbye; a page's timers run late while
  // SwiftShader takes the machine, so the tests' pages are given that long)
  NETSTUB.hb = setInterval(() => {
    post({ type: 'hb', from: NETSTUB.peer });
    const now = performance.now();
    for (const [peer, t] of NETSTUB.seen) {
      if (now - t < (+cfg.silence || 12000)) continue;
      NETSTUB.seen.delete(peer);
      for (const R of NETSTUB.rooms.values()) { const p = R.peers.get(peer); if (p) { R.peers.delete(peer); R.queue('left', p); } }
    }
  }, 1000);
  addEventListener('pagehide', () => post({ type: 'bye', from: NETSTUB.peer }));
  const room = Object.freeze({
    ...lobby.api,
    async join(name) {
      if (!/^[a-z0-9][a-z0-9_.-]{0,47}$/.test(name)) throw { code: 'invalid_argument', message: 'room name' };
      if (cfg.noJoin) throw { code: 'not_permitted', message: 'named rooms are not offered here' };
      const R = NETSTUB.rooms.get(name) || mkRoom(name);
      post({ type: 'hello', from: NETSTUB.peer });
      return R.api;
    },
    async sendToClaudeSession() { throw { code: 'claude_unavailable', message: 'stand-in' }; },
    async canSendToClaudeSession() { return 'off'; },
  });
  // the db over localStorage (one profile's pages share it), its changes told over the channel
  const dbKey = (p) => 'hmstub.db:' + (cfg.room || 'default') + ':' + p;
  const dbSubs = new Map();
  const dbRead = (p) => { try { const s = localStorage.getItem(dbKey(p)); return s ? JSON.parse(s) : null; } catch (e) { return null; } };
  const snapOf = (path, d) => Object.freeze({ id: path.split('/').pop(), exists: !!d, data: () => (d ? JSON.parse(JSON.stringify(d)) : undefined), metadata: { fromCache: false, hasPendingWrites: false } });
  const dbNotify = (path) => {
    for (const [p, fns] of dbSubs) if (p === path || path.startsWith(p + '/')) for (const fn of fns) fn(path);
  };
  const dbch = new BroadcastChannel('hm-netdb-' + (cfg.room || 'default'));
  dbch.onmessage = (ev) => dbNotify(String(ev.data));
  const priv = (path) => { const s = path.split('/'); return s[0] === 'data' && s[1] === 'users' && s[2] && s[2] !== uid; };
  const dbWrite = (path, d) => {
    if (cfg.dbWrite === false) return Promise.reject({ code: 'invalid_argument', message: 'this viewer cannot write' });
    if (priv(path)) return Promise.reject({ code: 'invalid_argument', message: "another viewer's subtree" });
    const s = d === null ? null : JSON.stringify(d);
    if (s && s.length > 256 * 1024) return Promise.reject({ code: 'invalid_argument', message: 'over 256 KiB' });
    try { if (s === null) localStorage.removeItem(dbKey(path)); else localStorage.setItem(dbKey(path), s); } catch (e) { return Promise.reject({ code: 'quota_exceeded', message: String(e) }); }
    setTimeout(() => { dbNotify(path); dbch.postMessage(path); }, 0);
    return Promise.resolve();
  };
  const docRef = (path) => ({
    id: path.split('/').pop(), path,
    get: async () => snapOf(path, priv(path) ? null : dbRead(path)),
    set: (data) => dbWrite(path, data),
    update: (data) => { const d = dbRead(path); if (!d) return Promise.reject({ code: 'invalid_argument', message: 'no such document' }); return dbWrite(path, { ...d, ...data }); },
    delete: () => dbWrite(path, null),
    acquire: async (o) => {
      if (cfg.dbWrite === false) return { acquired: false };
      const k = dbKey(path) + '#lease', now = Date.now();
      let L = null; try { L = JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { /* none */ }
      if (L && L.until > now && L.holder !== o.holder) return { acquired: false, expiresAt: new Date(L.until).toISOString() };
      const until = now + clamp(o.ttlMs || 30000, 1000, 600000);
      try { localStorage.setItem(k, JSON.stringify({ holder: o.holder, until })); } catch (e) { return { acquired: false }; }
      if (o.data) { const d = dbRead(path) || {}; await dbWrite(path, { ...d, ...o.data }); }
      return { acquired: true, holder: o.holder, expiresAt: new Date(until).toISOString() };
    },
    onSnapshot(next) {
      const fn = (p) => { if (p === path) next(snapOf(path, priv(path) ? null : dbRead(path))); };
      if (!dbSubs.has(path)) dbSubs.set(path, new Set());
      dbSubs.get(path).add(fn);
      setTimeout(() => fn(path), 0);
      return () => dbSubs.get(path).delete(fn);
    },
    collection: (sub) => collRef(path + '/' + sub),
  });
  const collRef = (path, filt = [], ord = null, lim = 0) => {
    const list = () => {
      const pre = dbKey(path) + '/', out = [];
      try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k.startsWith(pre) && !k.slice(pre.length).includes('/') && !k.endsWith('#lease')) { const id = k.slice(pre.length), d = dbRead(path + '/' + id); if (d) out.push([id, d]); } } } catch (e) { /* none */ }
      let r = out.filter(([, d]) => filt.every(([f, op, v]) => op === '==' ? d[f] === v : op === '!=' ? d[f] !== v : op === '<' ? d[f] < v : op === '<=' ? d[f] <= v : op === '>' ? d[f] > v : op === '>=' ? d[f] >= v : op === 'in' ? v.includes(d[f]) : op === 'array-contains' ? Array.isArray(d[f]) && d[f].includes(v) : true));
      if (ord) r.sort((a, b) => (a[1][ord[0]] < b[1][ord[0]] ? -1 : a[1][ord[0]] > b[1][ord[0]] ? 1 : 0) * (ord[1] === 'desc' ? -1 : 1)); else r.sort((a, b) => (a[0] < b[0] ? -1 : 1));
      if (lim) r = r.slice(0, lim);
      const docs = r.map(([id, d]) => snapOf(path + '/' + id, d));
      return { docs, size: docs.length, empty: !docs.length, docChanges: () => docs.map((doc, i) => ({ type: 'added', doc, oldIndex: -1, newIndex: i })), metadata: { fromCache: false, hasPendingWrites: false } };
    };
    return {
      path,
      where: (f, op, v) => collRef(path, [...filt, [f, op, v]], ord, lim),
      orderBy: (f, dir = 'asc') => collRef(path, filt, [f, dir], lim),
      limit: (n) => collRef(path, filt, ord, n),
      get: async () => list(),
      onSnapshot(next) {
        const fn = () => next(list());
        if (!dbSubs.has(path)) dbSubs.set(path, new Set());
        dbSubs.get(path).add(fn);
        setTimeout(fn, 0);
        return () => dbSubs.get(path).delete(fn);
      },
      doc: (id) => docRef(path + '/' + (id || netStubId(20))),
      add: async (data) => { const r = docRef(path + '/' + netStubId(20)); await r.set(data); return r; },
    };
  };
  const db = Object.freeze({ doc: (p) => docRef(p), collection: (p) => collRef(p) });
  const user = Object.freeze({
    id: async () => uid,
    me: async () => ({ id: uid, name: cfg.name || '', guest: false }),
    isOwner: () => !!cfg.owner,
    canEdit: () => !!cfg.admin,
    can: (n) => (n === 'data.write' ? cfg.dbWrite !== false : null),
    profiles: async (ids) => Object.fromEntries(ids.map((i) => [i, { id: i, name: '' }])),
  });
  window.claude = Object.freeze({ use: async (name) => { await new Promise((r) => setTimeout(r, 5)); return name === 'room' ? (cfg.noRoom ? null : room) : name === 'db' ? (cfg.noDb ? null : db) : name === 'user' ? (cfg.noDb ? null : user) : null; } });
  return true;
}
netStubInstall();
