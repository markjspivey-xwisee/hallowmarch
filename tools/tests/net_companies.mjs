// [companies] Companies on the March's own server, played by players without pages (version 20): a server of its own on
// a free port (or, given a host, that one), named accounts and a guest. Founded (a name checked: the March's own names,
// characters, length, the realm's others), a guest refused, an invitation to an account that is away waiting for its
// next visit and taken then, the company's chat kept and read on return, its notice, a pledge counted (goods delivered
// counted for the company and taken toward the pledged work), the captain's officers and removal, a muster forming one
// party, a member's company stamped on its profile (and not one a page claims), the realm's roster naming it, and the
// whole read back after the server is stopped and started again.
// usage: node tools/tests/net_companies.mjs [ws://host/ws]
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const WebSocket = require(path.join(ROOT, 'server/node_modules/ws/index.js'));
const FAILS = [];
const check = (ok, msg) => { console.log((ok ? '  ok   ' : '  FAIL ') + msg); if (!ok) FAILS.push(msg); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const freePort = () => new Promise((res) => { const s = net.createServer(); s.listen(0, () => { const p = s.address().port; s.close(() => res(p)); }); });

let url = process.argv[2], srv = null, port = 0, data = '';
const T = Date.now().toString(36).slice(-4);
async function startServer() {
  srv = spawn('node', [path.join(ROOT, 'server/server.js')], { env: { ...process.env, PORT: String(port), HM_DATA: data, HM_SEASON_SPEED: '1', HM_SEASON_STEP: '1000' }, stdio: ['ignore', 'pipe', 'pipe'] });
  srv.stdout.on('data', () => {}); srv.stderr.on('data', (d) => process.stderr.write(d));
  for (let i = 0; i < 80; i++) { try { const r = await fetch(`http://127.0.0.1:${port}/health`); if (r.ok) return; } catch (e) { /* not yet */ } await sleep(150); }
  throw new Error('server did not start');
}
async function stopServer() { const p = new Promise((r) => srv.on('exit', r)); srv.kill('SIGTERM'); await p; }

// Explicit live-human protocol fixture: hello, one fresh activity counter and its profile.
// These bounded test players do not establish human activity in production.
class Player {
  constructor(label) { this.label = label; this.msgs = []; this.q = 0; }
  open(hello, realm, name, x = 0, z = 0) {
    this.realm = realm; this.name = name;
    return new Promise((res, rej) => {
      const ws = (this.ws = new WebSocket(url));
      ws.on('open', () => ws.send(JSON.stringify({ t: 'hello', v: 1, ...hello })));
      ws.on('message', (d) => {
        const m = JSON.parse(String(d));
        this.msgs.push(m);
        if (m.t === 'welcome') {
          this.acct = m.acct; this.token = m.token;
          ws.send(JSON.stringify({ t: 'slow', d: { v: 1, on: 1, realmManagement: 1, seasonField: 2, sharedCombat: 1, actorDevelopment: 1, sharedScene: 2, warbandOrders: 1, humanLive: 1, humanActivity: 1, n: name, dn: name, r: realm, c: 'warrior', l: 30, rr: 2, co: ['Forged Company', 1, 0, 1] } }));
          ws.send(JSON.stringify({ t: 'fast', d: { s: 1, t: 1, p: [x, 30, z], y: 0, v: [0, 0], a: 0, h: 1, m: 2000, d: 0, ev: [] } }));
          res(this);
        } else if (m.t === 'denied') rej(new Error(m.why));
      });
      ws.on('error', rej);
    });
  }
  send(o) { this.ws.send(JSON.stringify(o)); }
  ask(op, o = {}) {
    const q = ++this.q;
    this.send({ t: 'co', op, q, ...o });
    return this.wait((m) => m.t === 'co' && m.q === q, 5000);
  }
  async wait(f, limit = 5000) { const t = Date.now(); let i = 0; while (Date.now() - t < limit) { for (; i < this.msgs.length; i++) if (f(this.msgs[i])) return this.msgs[i]; await sleep(30); } return null; }
  last(f) { for (let i = this.msgs.length - 1; i >= 0; i--) if (f(this.msgs[i])) return this.msgs[i]; return null; }
  state() { const m = this.last((x) => x.t === 'company' && x.s); return m ? m.s : null; }
  async fresh() { const n = this.msgs.length; await this.ask('get'); await this.wait((m) => m.t === 'company' && m.s && this.msgs.indexOf(m) >= n, 3000); return this.state(); }
  close() { return new Promise((r) => { if (!this.ws || this.ws.readyState > 1) { r(); return; } this.ws.on('close', r); this.ws.close(); }); }
}
const pause = () => sleep(420); // (the server takes a company's asks a third of a second apart)

async function main() {
  if (!url) { port = await freePort(); data = fs.mkdtempSync(path.join(os.tmpdir(), 'hm_co_')); url = `ws://127.0.0.1:${port}/ws`; await startServer(); }
  const pw = 'company-pass-1';
  const cap = await new Player('cap').open({ reg: { name: 'Corwen' + T, pass: pw } }, 0, 'Corwen');
  const off = await new Player('off').open({ reg: { name: 'Branna' + T, pass: pw } }, 0, 'Branna');
  const guest = await new Player('guest').open({}, 0, 'Wanderer');
  const foe = await new Player('foe').open({ reg: { name: 'Hakon' + T, pass: pw } }, 2, 'Hakon');
  await sleep(400);
  check(!!cap.state() && !cap.state().co && cap.state().guest === false, 'a named account is told it may found a company (none yet)');
  check(guest.state() && guest.state().guest === true, 'a guest is told it is a guest');
  // a slow profile that claims a company is not stamped with it
  const capPeerSeen = off.last((m) => m.t === 'peer' && m.slow && m.slow.n === 'Corwen');
  check(capPeerSeen && !capPeerSeen.slow.co, 'a company a page claims for itself is not relayed');
  // Malformed identifiers arrive through the public socket and must be refused
  // without terminating the server or damaging the company's membership maps.
  for (const id of ['constructor', '__proto__', 'toString']) {
    await pause();
    const bad = await cap.ask('answer', { id, yes: true });
    check(bad && !bad.ok, `an inherited company key is refused without losing the connection (${id})`);
  }
  // names refused
  let r = await guest.ask('found', { name: 'Wayfarers', dev: 2, col: [0, 3] });
  check(r && !r.ok && /guest/i.test(r.why), `a guest cannot found a company (${r && r.why})`);
  for (const [nm, why] of [['Kestrel Hold Guard', "March's own"], ['xy', '3 to 24'], ['Bad<b>Name</b>', 'only'], ['The Grail Knights', "March's own"], ['Ériu Watch', "March's own"], ['a', '3 to 24'], ['12345', 'Three letters'], ['Herald of Ash', "March's own"]]) {
    await pause(); r = await cap.ask('found', { name: nm, dev: 1, col: [0, 3] });
    check(r && !r.ok && r.why.includes(why), `"${nm}" is refused (${r && r.why})`);
  }
  await pause(); r = await cap.ask('found', { name: 'The Iron Oath', dev: 2, col: [0, 3] });
  check(r && r.ok, `Corwen founds The Iron Oath (${r && (r.why || 'ok')})`);
  let s = await cap.fresh();
  check(s && s.co && s.co.n === 'The Iron Oath' && s.co.role === 'cap' && s.co.dev === 2 && s.co.col.join() === '0,3', `he is its captain, its device a tower, its tinctures 0 and 3 (${s && s.co && [s.co.role, s.co.dev, s.co.col]})`);
  await pause(); r = await foe.ask('found', { name: 'the iron oath', dev: 0, col: [1, 2] });
  check(r && r.ok, 'another realm may have a company by the same name');
  await pause(); r = await off.ask('found', { name: 'The  Iron-Oath', dev: 0, col: [1, 2] });
  check(r && !r.ok && /by that name/.test(r.why), `the same name in the realm is refused (${r && r.why})`);
  // the profile stamped: the others see the company on his frame and nameplate
  const stamped = await off.wait((m) => m.t === 'peer' && m.slow && m.slow.n === 'Corwen' && Array.isArray(m.slow.co), 3000);
  check(stamped && stamped.slow.co[0] === 'The Iron Oath' && stamped.slow.co[1] === 2, `the others hear Corwen's company on his profile (${stamped && JSON.stringify(stamped.slow.co)})`);
  // an invitation to an account that is away: waiting for its next visit
  const awayName = 'Edda' + T;
  let away = await new Player('away').open({ reg: { name: awayName, pass: pw } }, 0, 'Edda');
  const awayTok = away.token;
  await sleep(300); await away.close(); await sleep(200);
  await pause(); r = await cap.ask('invite', { name: awayName });
  check(r && r.ok, `Corwen invites ${awayName}, who is away (${r && (r.why || 'ok')})`);
  await pause(); r = await cap.ask('invite', { name: 'Hakon' + T });
  check(r && !r.ok && /another realm/.test(r.why), `an account of another realm is refused (${r && r.why})`);
  await pause(); r = await cap.ask('invite', { name: 'Nobody' + T });
  check(r && !r.ok, `an unknown name is refused (${r && r.why})`);
  // the company's chat while she is away, and its notice
  await pause(); r = await cap.ask('say', { text: 'We muster at Kestrel Hold at dusk. <img src=x>' });
  check(r && r.ok, 'the captain speaks to the company');
  await pause(); r = await cap.ask('notice', { text: 'We muster at Kestrel Hold on day 12' });
  check(r && r.ok, 'and sets its notice');
  await pause(); r = await off.ask('notice', { text: 'I am not in it' });
  check(r && !r.ok, 'one not in the company sets no notice');
  // she comes back: the invitation and what was said are waiting
  away = await new Player('away').open({ token: awayTok }, 0, 'Edda');
  const first = await away.wait((m) => m.t === 'company' && m.first, 4000);
  const inv = first && first.s.invites;
  check(inv && inv.length === 1 && inv[0].n === 'The Iron Oath' && inv[0].by === cap.acct.name, `on her return the invitation is waiting (${inv && JSON.stringify(inv[0])})`);
  await pause(); r = await away.ask('answer', { id: inv && inv[0].id, yes: true });
  check(r && r.ok, `she accepts (${r && (r.why || 'ok')})`);
  s = await away.fresh();
  check(s && s.co && s.co.n === 'The Iron Oath' && s.co.role === 'mem', 'she is a member of The Iron Oath');
  check(s && s.co.chat.some((L) => L[2].startsWith('We muster at Kestrel Hold at dusk')) && s.co.notice.x === 'We muster at Kestrel Hold on day 12', 'the company\'s chat and notice are hers to read');
  check(s && s.co.mem.length === 2 && s.co.mem.filter((x) => x.on).length === 2, `its roster: two, both on (${s && s.co.mem.map((x) => x.n + (x.on ? '+' : '-'))})`);
  const capHeard = await cap.wait((m) => m.t === 'company' && m.s && m.s.co && m.s.co.mem.length === 2, 3000);
  check(!!capHeard, 'the captain is told she has joined');
  // Branna invited and made an officer; the officer invites; the captain removes; the muster
  await pause(); r = await cap.ask('invite', { name: 'Branna' + T });
  const offInv = await off.wait((m) => m.t === 'company' && m.invited, 3000);
  check(r && r.ok && offInv && offInv.invited.co === 'The Iron Oath', 'Branna, on now, is told of her invitation at once');
  s = await off.fresh();
  await pause(); r = await off.ask('answer', { id: s.invites[0].id, yes: true });
  check(r && r.ok, 'Branna joins');
  await pause(); r = await cap.ask('rank', { who: off.acct.id, role: 'off' });
  s = await off.fresh();
  check(r && r.ok && s.co.role === 'off', 'the captain makes her an officer');
  await pause(); r = await away.ask('remove', { who: off.acct.id });
  check(r && !r.ok, 'a member removes no one');
  // a pledge: goods delivered are the company's, and go to the pledged work first
  await pause(); r = await off.ask('pledge', { id: 'smithy' });
  check(r && r.ok, `the officer pledges the company to the smithy (${r && (r.why || 'ok')})`);
  const pts0 = (await cap.fresh()).co.pts;
  const ct = await new Promise(async (res) => { away.send({ t: 'contrib', k: 'iron', n: 40, q: 99 }); res(await away.wait((m) => m.t === 'contrib' && m.q === 99, 4000)); });
  check(ct && ct.ok && ct.co && ct.co.pledge === 'smithy' && (ct.co.moved > 0 || ct.co.voted > 0), `40 iron brought by Edda count for the company and the pledged smithy (${ct && JSON.stringify(ct.co)})`);
  s = await cap.fresh();
  const edda = s.co.mem.find((x) => x.n === awayName);
  check(s.co.pts > pts0 && s.co.u >= 40 && s.co.pl.smithy >= 40 && edda && edda.du >= 40 && edda.u >= 40, `the company's tally: ${s.co.pts} points, ${s.co.u} units, ${s.co.pl.smithy} pledged; Edda brought ${edda && edda.du} today`);
  // pledged to the work at hand (a new season's first: the granary), the goods go into its own stock
  await pause(); r = await off.ask('pledge', { id: 'granary' });
  const ct2 = await new Promise(async (res) => { away.send({ t: 'contrib', k: 'timber', n: 30, q: 98 }); res(await away.wait((m) => m.t === 'contrib' && m.q === 98, 4000)); });
  check(r && r.ok && ct2 && ct2.ok && ct2.co && ct2.co.moved > 0, `pledged to the granary at work, 30 timber go into its own stock (${ct2 && JSON.stringify(ct2.co)})`);
  s = await cap.fresh();
  const st = s.standing.find((x) => x.n === 'The Iron Oath');
  check(st && st.pts === s.co.pts && st.m === 3, `the realm's companies' standing names it (${st && JSON.stringify(st)})`);
  // the realm's roster names each one's company
  const seasonMsg = cap.last((m) => m.t === 'season' && m.roster);
  check(seasonMsg && seasonMsg.roster.list.some((x) => x.co === 'The Iron Oath'), 'the realm\'s roster names the company');
  // a muster: one party for those on
  await pause(); r = await cap.ask('muster');
  const mu = await away.wait((m) => m.t === 'company' && m.muster && m.muster.pt, 3000), mu2 = await off.wait((m) => m.t === 'company' && m.muster && m.muster.pt, 3000);
  check(r && r.ok && r.n === 3 && mu && mu2 && mu.muster.pt === mu2.muster.pt && /^[a-z0-9]{4,24}$/.test(mu.muster.pt), `the captain musters the company: three in one party (${r && (r.why || r.n)}, ${mu && mu.muster.pt})`);
  // chat flood and a rate
  await pause(); r = await cap.ask('say', { text: 'one' }); const r2 = await cap.ask('say', { text: 'two' });
  check(r.ok && !r2.ok, 'a second line within the second is refused');
  // the captain removes a member; she is told
  await pause(); r = await cap.ask('remove', { who: away.acct.id });
  const told = await away.wait((m) => m.t === 'company' && m.s && !m.s.co, 3000);
  check(r && r.ok && !!told, 'the captain removes Edda, and she is told');
  // the restart: everything read back
  if (srv) {
    await Promise.all([cap.close(), off.close(), away.close(), guest.close(), foe.close()]);
    await stopServer();
    // a damaged entry beside the good ones
    const f = path.join(data, 'companies.json'), D = JSON.parse(fs.readFileSync(f, 'utf8'));
    D.list.bad = { name: 12, realm: 9, mem: 'x' }; D.list['../x'] = { name: 'Evil', realm: 0, mem: { a: { role: 'cap' } } };
    fs.writeFileSync(f, JSON.stringify(D));
    await startServer();
    const cap2 = await new Player('cap2').open({ token: cap.token }, 0, 'Corwen');
    await sleep(300);
    s = await cap2.fresh();
    check(s && s.co && s.co.n === 'The Iron Oath' && s.co.mem.length === 2 && s.co.notice.x === 'We muster at Kestrel Hold on day 12' && s.co.pl.smithy >= 40 && s.co.pl.granary >= 30 && s.co.chat.length >= 5, `after the server restarts the company is read back whole (${s && s.co && [s.co.mem.length, s.co.pl.smithy, s.co.chat.length]})`);
    const stats = await (await fetch(`http://127.0.0.1:${port}/stats`)).json();
    check(stats.companies && stats.companies.n === 2, `damaged entries dropped: ${stats.companies && stats.companies.n} companies`);
    await pause(); r = await cap2.ask('leave');
    s = await cap2.fresh();
    check(r && r.ok && !s.co, 'the captain leaves: Branna is the captain now');
    await cap2.close();
    await stopServer();
    const D2 = JSON.parse(fs.readFileSync(f, 'utf8')), co = Object.values(D2.list).find((x) => x.name === 'The Iron Oath');
    check(co && co.mem[off.acct.id] && co.mem[off.acct.id].role === 'cap', 'the captaincy passed to the officer');
  } else await Promise.all([cap.close(), off.close(), away.close(), guest.close(), foe.close()]);
  console.log(`\n${FAILS.length} failed`); for (const f of FAILS) console.log('  FAIL', f);
  process.exit(FAILS.length ? 1 : 0);
}
main().catch((e) => { console.error(e); if (srv) srv.kill(); process.exit(1); });
