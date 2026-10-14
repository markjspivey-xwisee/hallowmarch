// [net] A player without a page: speaks server/server.js's protocol (the hello with a token, the profile, the fast state,
// the season's contributions and orders) for the season's tests (tools/tests/net_season.mjs), the deployed server's check
// and the load test (tools/net/loadtest.mjs). An asynchronous player: it logs in, delivers and votes, and leaves.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const WebSocket = require(new URL('../../server/node_modules/ws/index.js', import.meta.url).pathname);

export class Player {
  constructor(url, o = {}) {
    this.url = url; this.o = o; this.token = o.token || ''; this.peers = new Map(); this.msgs = 0; this.bytes = 0;
    this.season = null; this.seasons = 0; this.waiters = []; this.q = 0; this.welcome = null; this.closed = false; this.chat = null;
    this.x = o.x ?? 0; this.z = o.z ?? 0; this.seq = 0; this.ring = []; this.evSeq = 0;
  }
  open() {
    return new Promise((res, rej) => {
      const ws = (this.ws = new WebSocket(this.url));
      const t = setTimeout(() => rej(new Error('no welcome')), 15000);
      ws.on('open', () => ws.send(JSON.stringify({ t: 'hello', v: 1, token: this.token || undefined, room: this.o.room })));
      ws.on('error', (e) => { clearTimeout(t); rej(e); });
      ws.on('close', () => { this.closed = true; });
      ws.on('message', (data) => {
        const s = String(data); this.msgs++; this.bytes += s.length;
        let m; try { m = JSON.parse(s); } catch (e) { return; }
        if (m.t === 'welcome') { clearTimeout(t); this.welcome = m; this.token = m.token; this.acct = m.acct; this.peer = m.peer; res(this); }
        else if (m.t === 'denied') { clearTimeout(t); rej(new Error(m.why)); }
        else if (m.t === 'season') { this.season = m; this.seasons++; if (m.chat) this.chat = m.chat; }
        else if (m.t === 'peer') { const P = this.peers.get(m.peer) || {}; if (m.slow) P.slow = m.slow; if (m.fast) P.fast = m.fast; this.peers.set(m.peer, P); }
        else if (m.t === 'left') this.peers.delete(m.peer);
        for (const w of this.waiters.slice()) if (w.f(m)) { this.waiters.splice(this.waiters.indexOf(w), 1); w.res(m); }
      });
    });
  }
  send(o) { if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(o)); }
  wait(f, ms = 10000) {
    return new Promise((res) => { const w = { f, res }; this.waiters.push(w); setTimeout(() => { const i = this.waiters.indexOf(w); if (i >= 0) { this.waiters.splice(i, 1); res(null); } }, ms); });
  }
  profile(p = {}) {
    this.realm = p.realm ?? this.realm ?? 0;
    this.send({ t: 'slow', d: { v: 1, on: 1, since: 0, n: p.name || this.o.name || 'Bot', dn: p.name || this.o.name || 'Bot', r: this.realm, c: p.cls || 'warrior', l: p.level || 20, rr: p.rank ?? 1 } });
    return this.wait((m) => m.t === 'season' && m.first);
  }
  fast() {
    const d = { s: ++this.seq, t: Math.round(performance.now()), p: [this.x, 30, this.z], y: 0, v: [0, 0], a: 0, h: 1, m: 2000, d: 0, mo: 0, ph: 0, sw: 0, st: 0, cs: 0, fl: 0, tg: '', ev: this.ring.map((r) => r.e) };
    const now = performance.now(); this.ring = this.ring.filter((r) => now - r.t < 2600);
    this.send({ t: 'fast', d });
  }
  say(text) { this.ring.push({ e: [++this.evSeq, 'say', 0, ['r', text]], t: performance.now() }); this.fast(); }
  contrib(k, n) { const q = ++this.q; this.send({ t: 'contrib', k, n, q }); return this.wait((m) => m.t === 'contrib' && m.q === q); }
  order(o) { const q = ++this.q; this.send({ t: 'order', o, q }); return this.wait((m) => m.t === 'order' && m.q === q); }
  ask() { this.send({ t: 'season' }); return this.wait((m) => m.t === 'season'); }
  close() { try { this.ws.close(); } catch (e) { /* gone */ } }
}
