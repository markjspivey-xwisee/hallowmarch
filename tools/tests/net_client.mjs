// [net] A headless player for the server's tests (tools/tests/net.py server): speaks server/server.js's protocol as a
// page does (hello with a token, the profile, the fast state ten times a second with its ring of moments), driven by
// JSON lines on stdin, telling what it hears as JSON lines on stdout.
// commands: {"cmd":"hello","name":..,"realm":..,"cls":..,"x":..,"z":..} {"cmd":"move","x":..,"z":..} {"cmd":"ev","kind":..,"to":..,"data":..}
//           {"cmd":"state"} {"cmd":"save","d":{...}} {"cmd":"load"} {"cmd":"quit"}
import { createRequire } from 'node:module';
import readline from 'node:readline';
const require = createRequire(import.meta.url);
const WebSocket = require(new URL('../../server/node_modules/ws/index.js', import.meta.url).pathname);
const url = process.argv[2], token = process.argv[3] || '';
const out = (o) => process.stdout.write(JSON.stringify(o) + '\n');
const S = { peer: '', acct: null, token: '', peers: {}, got: { peer: 0, far: 0, ev: 0, left: 0, fast: 0 }, evs: [], me: null, seq: 0, evSeq: 0, ring: [], save: null };
const ws = new WebSocket(url);
let tick = null;
ws.on('open', () => out({ open: true }));
ws.on('message', (data) => {
  const m = JSON.parse(String(data));
  if (m.t === 'welcome') { S.peer = m.peer; S.acct = m.acct; S.token = m.token; out({ welcome: { peer: m.peer, acct: m.acct, token: m.token, world: m.world } }); }
  else if (m.t === 'peer') {
    S.got.peer++; if (m.far) S.got.far++;
    const P = S.peers[m.peer] || (S.peers[m.peer] = { slow: null, fast: null, n: 0 });
    if (m.slow) P.slow = m.slow;
    if (m.fast) { P.fast = m.fast; P.n++; S.got.fast++; for (const e of m.fast.ev || []) { S.got.ev++; S.evs.push([m.peer, e]); } }
  } else if (m.t === 'ev') { for (const e of m.ev || []) { S.got.ev++; S.evs.push([m.peer, e]); } }
  else if (m.t === 'left') { S.got.left++; delete S.peers[m.peer]; }
  else if (m.t === 'save' || m.t === 'saved') { S.save = m; out({ save: m }); }
  else if (m.t === 'denied') out({ denied: m.why });
});
ws.on('close', () => { out({ closed: true }); process.exit(0); });
const send = (o) => ws.send(JSON.stringify(o));
function fast() {
  if (!S.me) return;
  const d = { s: ++S.seq, t: Math.round(performance.now()), p: [S.me.x, 30, S.me.z], y: 0, v: [0, 0], a: 0, h: 1, m: 2000, d: 0, mo: 0, ph: 0, sw: 0, st: 0, cs: 0, fl: 0, tg: '', ev: S.ring.map((r) => r.e) };
  const now = performance.now();
  S.ring = S.ring.filter((r) => now - r.t < 2600);
  send({ t: 'fast', d });
}
readline.createInterface({ input: process.stdin }).on('line', (line) => {
  let c; try { c = JSON.parse(line); } catch (e) { return; }
  if (c.cmd === 'hello') {
    send({ t: 'hello', v: 1, token: c.token || token || undefined });
    S.me = { x: c.x || 0, z: c.z || 0 };
    setTimeout(() => {
      send({ t: 'slow', d: { v: 1, on: 1, since: 0, n: c.name || 'Bot', dn: c.name || 'Bot', r: c.realm ?? 1, c: c.cls || 'warrior', l: c.level || 30, rr: 1 } });
      tick = setInterval(fast, 100);
    }, 300);
  } else if (c.cmd === 'move') { S.me.x = c.x; S.me.z = c.z; fast(); }
  else if (c.cmd === 'ev') { S.ring.push({ e: [++S.evSeq, c.kind, c.to || 0, c.data], t: performance.now() }); fast(); }
  else if (c.cmd === 'state') out({ state: { peer: S.peer, acct: S.acct, got: S.got, peers: Object.fromEntries(Object.entries(S.peers).map(([k, v]) => [k, { name: v.slow && v.slow.n, x: v.fast && v.fast.p[0], z: v.fast && v.fast.p[2], n: v.n }])), evs: S.evs.slice(-20) } });
  else if (c.cmd === 'save') send({ t: 'save', d: c.d });
  else if (c.cmd === 'load') send({ t: 'load' });
  else if (c.cmd === 'quit') { clearInterval(tick); ws.close(); }
});
