// [net] The season on the server, played by players without pages (CLAUDE.md, Multiplayer, the season):
//   node tools/tests/net_season.mjs              boots server/server.js on a free port with its own data folder
//   node tools/tests/net_season.mjs wss://host/ws   the same against a server already running (the deployed one): no restart
// An asynchronous player of Ériu signs in, is told the season, its roster and its realm's chat, delivers goods (a
// plausible load taken, a cart of iron beyond any gatherer's pace cut), votes for a work and a target, says a line to its
// realm and leaves; a Logres player comes and goes; the server is stopped and started again (its season kept and caught
// up, the account's token still good, the returning player told what happened while it was away, the chat kept).
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { Player } from '../net/player.mjs';

const HERE = path.dirname(new URL(import.meta.url).pathname), ROOT = path.resolve(HERE, '../..');
const remote = process.argv[2] && /^wss?:/.test(process.argv[2]) ? process.argv[2] : '';
let fails = 0;
const ok = (c, what, extra = '') => { console.log((c ? 'PASS ' : 'FAIL ') + what + (extra ? '  ' + extra : '')); if (!c) fails++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const freePort = () => new Promise((r) => { const s = net.createServer(); s.listen(0, () => { const p = s.address().port; s.close(() => r(p)); }); });
let proc = null, port = 0, slog = '';
const data = fs.mkdtempSync(path.join(os.tmpdir(), 'net_season_'));
async function boot() {
  port = port || (await freePort());
  proc = spawn('node', [path.join(ROOT, 'server/server.js')], { env: { ...process.env, PORT: String(port), HM_DATA: data, HM_SEASON_SPEED: '600', HM_SEASON_STEP: '500', HM_SEASON_PUSH: '2000' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  proc.stdout.on('data', (d) => { log += d; slog += d; }); proc.stderr.on('data', (d) => { log += d; slog += d; });
  for (let i = 0; i < 100 && !/server on/.test(log); i++) await sleep(100);
  console.log(log.trim().split('\n').map((l) => '  | ' + l).join('\n'));
}
async function stop() { if (!proc) return; const p = proc; proc = null; p.kill('SIGTERM'); await new Promise((r) => p.on('exit', r)); }
const url = () => remote || `ws://127.0.0.1:${port}/ws`;
const http = async (p) => { const u = (remote ? remote.replace(/^ws/, 'http').replace(/\/ws$/, '') : `http://127.0.0.1:${port}`) + p; return (await fetch(u)).json(); };

try {
  if (!remote) await boot();
  const h = await http('/health');
  ok(h.ok, 'the server answers its health', JSON.stringify(h));
  // an asynchronous player of Ériu
  const A = await new Player(url(), { name: 'Aeda' }).open();
  ok(!!A.token && A.acct && A.acct.guest, 'a guest account and its token', A.acct.id);
  ok(A.welcome.season && A.welcome.world && A.welcome.world.k.length === 6, 'the welcome carries the season and its keeps', JSON.stringify(A.welcome.world.k) + ' ' + JSON.stringify(A.welcome.season));
  const s0 = await A.profile({ realm: 1, name: 'Aeda', cls: 'archer', level: 24 });
  ok(s0 && s0.s && s0.s.day >= 1 && s0.s.st && s0.roster, 'told the season, its realm\'s stores and roster', `day ${s0 && s0.s.day} phase ${s0 && s0.s.phase} food ${s0 && s0.s.st.food} roster ${s0 && JSON.stringify(s0.roster.list.slice(0, 2))}`);
  ok(s0 && s0.roster.list.some((x) => x.n === 'Aeda' && x.on), 'the player on its realm\'s roster, on now');
  const food0 = s0.s.st.food, iron0 = s0.s.st.iron;
  const c1 = await A.contrib('food', 120);
  ok(c1 && c1.ok && c1.took === 120, 'a plausible delivery taken', JSON.stringify(c1));
  const c2 = await A.contrib('iron', 5000);
  ok(c2 && c2.ok && c2.took > 0 && c2.took <= 80, 'a cartload of iron beyond any gatherer cut to what one could carry', JSON.stringify(c2));
  const c3 = await A.contrib('iron', 50);
  ok(c3 && !c3.ok, 'and more iron at once refused', JSON.stringify(c3));
  const c4 = await A.contrib('gold', 50);
  ok(c4 && !c4.ok, 'a good that is not the realm\'s refused', JSON.stringify(c4));
  const s1 = await A.ask();
  ok(s1 && s1.s.st.food >= food0 + 100 && s1.s.st.iron >= iron0 + c2.took - 5, 'the realm\'s stores grew by what was brought', `food ${food0} -> ${s1 && s1.s.st.food}, iron ${iron0} -> ${s1 && s1.s.st.iron}`);
  const work = (s1.s.proj.find((p) => !p.built) || { id: 'forge' }).id; // a work the realm has not built yet (a long-lived server's season may have built some)
  const o1 = await A.order({ kind: 'project', id: work });
  ok(o1 && o1.ok, 'a vote for a work', JSON.stringify(o1));
  await sleep(2600);
  const o2 = await A.order({ kind: 'project', id: work });
  ok(o2 && !o2.ok, 'one vote an account', JSON.stringify(o2));
  await sleep(2600);
  const enemy = s1.s.keeps.find((K) => K.r !== 1);
  const o3 = await A.order({ kind: 'target', keep: enemy.i });
  ok(o3 && o3.ok, 'a vote for a target', JSON.stringify(o3));
  await sleep(2600);
  const o4 = await A.order({ kind: 'muster' });
  ok(o4 && !o4.ok, 'a muster called by one who is no officer refused', JSON.stringify(o4));
  const s2 = await A.ask();
  ok(s2 && (s2.s.proj.find((p) => p.id === work).votes >= 1 || (s2.s.proj.find((p) => p.id === work).atWork) || s2.s.built.includes(work)) && s2.s.target === enemy.i, 'the votes in the season', `${work} votes ${s2 && s2.s.proj.find((p) => p.id === work).votes}, target ${s2 && s2.s.target}`);
  A.say('Bring iron to the forge, all of you');
  await sleep(500);
  // a second player, of Logres: it sees Ériu's player, not Ériu's stores
  const B = await new Player(url(), { name: 'Bram' }).open();
  const sB = await B.profile({ realm: 0, name: 'Bram' });
  ok(sB && sB.roster.list.every((x) => x.n !== 'Aeda'), 'another realm\'s roster has not the player', JSON.stringify(sB && sB.roster.list.map((x) => x.n)));
  ok(sB && !(sB.chat || []).some((l) => /forge/.test(l[2])), 'nor its realm\'s chat');
  const t0 = s2.s.t;
  A.close(); B.close();
  await sleep(1500);
  const tokA = A.token;
  if (!remote) {
    // the server stopped and started again: the season kept (and caught up for the time it was down)
    await stop();
    await sleep(1500);
    await boot();
  } else await sleep(4000);
  const A2 = await new Player(url(), { name: 'Aeda', token: tokA }).open();
  ok(A2.acct.id === A.acct.id, 'the same account by its token' + (remote ? '' : ' after a restart'), A2.acct.id);
  const sA = await A2.profile({ realm: 1, name: 'Aeda', cls: 'archer', level: 24 });
  ok(sA && sA.s.t > t0, 'the season went on', `t ${t0} -> ${sA && sA.s.t}`);
  ok(sA && sA.away > 0 && Array.isArray(sA.s.news), 'a returning player told how long it was away and the news', `away ${sA && sA.away} s, news ${sA && sA.s.news.length}: ${sA && JSON.stringify(sA.s.news.slice(-2))}`);
  ok(sA && (sA.s.proj.find((p) => p.id === work).votes >= 1 || sA.s.proj.find((p) => p.id === work).atWork || sA.s.built.includes(work)), 'its vote kept (or the work it voted for built)', JSON.stringify(sA && sA.s.built));
  ok(sA && (sA.chat || []).some((l) => /forge/.test(l[2])), 'its realm\'s chat kept', JSON.stringify(sA && (sA.chat || []).slice(-1)));
  ok(sA && sA.roster.list.find((x) => x.n === 'Aeda').g >= 120, 'what it gave today on the roster', JSON.stringify(sA && sA.roster.list.find((x) => x.n === 'Aeda')));
  const pub = await http('/season');
  ok(pub && pub.keeps && pub.keeps.length === 6 && pub.st === null, 'the public season tells the keeps and no realm\'s stores', `day ${pub && pub.day} pts ${pub && JSON.stringify(pub.pts)}`);
  let st = await http('/stats');
  for (let i = 0; i < 20 && !(st.season && st.season.stepMs); i++) { await sleep(500); st = await http('/stats'); }
  ok(st.season && st.season.stepMs, 'the season stepped and measured', JSON.stringify(st.season));
  A2.close();
} catch (e) { ok(false, 'ran through', e.stack || String(e)); }
await stop();
if (/season step|message/.test(slog)) { console.log(slog); ok(false, 'no fault in the server\'s log'); }
console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
process.exit(fails ? 1 : 0);
