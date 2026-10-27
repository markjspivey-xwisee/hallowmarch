import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import { WebSocket } from 'ws';
import { seasonRoomPolicy, loadRealmModule } from '../season.js';
import { makeField } from '../fieldarmies.js';

test('reserved diagnostic namespace is bounded and invalid requests cannot become march', () => {
  for (const base of ['native-qa-synthetic', 'native-companion-qa-0123456789ab']) {
    assert.deepEqual(seasonRoomPolicy(base), { base, diagnostic: true });
  }
  for (const value of ['native-qa', 'native-qa-', 'native-companion-qa-', 'native-qa-bad room',
    'native-companion-qa-' + 'x'.repeat(24), ' native-qa-space', 'NATIVE-QA-uppercase']) assert.equal(seasonRoomPolicy(value), null);
  for (const value of [undefined, '', 'bad ordinary room', 'x'.repeat(33)]) assert.deepEqual(seasonRoomPolicy(value), { base: 'march', diagnostic: false });
  assert.deepEqual(seasonRoomPolicy('qa-fans'), { base: 'qa-fans', diagnostic: false });
});

test('canonical field armies ignore diagnostic keepers and refuse their reports', () => {
  let takes = 0, reports = 0;
  const army = { id: 1, r: 0, k: 0, n: 10, p: 0, kind: 'keep', state: 'march' };
  const season = { fieldGrantConfirmed: () => true, RS: { n: 1, phase: 'war', armies: [army] }, M: {
    realmSimFieldTake(_state, _id, who) { takes++; army.onField = { who }; return { id: 1 }; },
    realmSimFieldReport() { reports++; return true; },
  } };
  const rooms = new Map(), sent = [];
  function keeper(peer, diagnostic) {
    const room = { diagnostic, clients: new Map(), regions: { frontier: peer } };
    const c = { peer, room, realm: 0, region: 'frontier', slow: { on: 1, realmManagement: 1, seasonField: 2 }, pos: { x: 0, z: 0 }, ws: { readyState: 1 } };
    room.clients.set(peer, c); rooms.set(peer, room); return c;
  }
  const diagnostic = keeper('diagnostic', true), ordinary = keeper('ordinary', false);
  const field = makeField(season, rooms, (c, value) => sent.push({ peer: c.peer, value }), () => 'frontier',
    { keeps: [{ x: 0, z: 0 }] }, {});
  field.step(); assert.equal(takes, 1); assert.equal(sent[0].peer, ordinary.peer);
  const report = { id: 1, season: season.RS.n, fieldLease: sent[0].value.a.fieldLease, rep: { n: 1 } };
  assert.ok(report.fieldLease, 'the ordinary handoff carries an exact page lease');
  field.report(diagnostic, report); assert.equal(reports, 0);
  field.report(ordinary, report); assert.equal(reports, 1);
  field.left(ordinary); rooms.delete('ordinary'); field.step(); assert.equal(takes, 1);
});

const root = fileURLToPath(new URL('../../', import.meta.url));
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function localServer(t) {
  const data = await mkdtemp(path.join(tmpdir(), 'hm-diagnostic-room-'));
  const canonicalWorld = { k: [0, 0, 1, 1, 2, 2], g: [1, 1, 1, 1, 1, 1], cn: 77, td: 0.3, tm: 0, at: 1000 };
  const historicalWorlds = { march: canonicalWorld, 'native-qa-historical': { ...canonicalWorld, cn: 78 } };
  const historical = { historical: { name: 'QA is part of my real name', r: 0, c: 'warrior', l: 3, last: Date.now(), today: 7, day: Math.floor(Date.now() / 86400000) } };
  await writeFile(path.join(data, 'worlds.json'), JSON.stringify(historicalWorlds));
  await writeFile(path.join(data, 'roster.json'), JSON.stringify(historical));
  const portServer = createServer(); portServer.listen(0, '127.0.0.1'); await once(portServer, 'listening');
  const port = portServer.address().port; await new Promise(resolve => portServer.close(resolve));
  const child = spawn(process.execPath, [path.join(root, 'server/server.js')], { cwd: root,
    env: { PATH: process.env.PATH, NODE_ENV: 'test', PORT: String(port), HM_DATA: data, HM_SECRET: 'synthetic-local-room-fixture',
      HM_GAMING_ENABLED: '0', HM_GAMING_BOOTSTRAP: '0', HM_WORLD_PERSISTENCE_MODE: 'legacy',
      HM_SEASON_STEP: '600000', HM_SEASON_PUSH: '600000', HM_ROOM_CAP: '2' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = ''; for (const stream of [child.stdout, child.stderr]) stream.on('data', bytes => { output = (output + bytes).slice(-8000); });
  const sockets = [];
  async function stop() { if (child.exitCode !== null) return; const done = once(child, 'exit'); child.kill('SIGTERM');
    const timer = setTimeout(() => child.kill('SIGKILL'), 5000); await done; clearTimeout(timer); }
  t.after(async () => { for (const ws of sockets) ws.terminate(); await stop(); await rm(data, { recursive: true, force: true }); });
  const base = 'http://127.0.0.1:' + port;
  let started = false;
  for (let i = 0; i < 200 && child.exitCode === null; i++) { try { if ((await fetch(base + '/health')).ok) { started = true; break; } } catch {} await wait(20); }
  assert(started, 'Explicit local server fixture starts: ' + output);
  const json = async target => (await fetch(base + target)).json();
  async function connect(room, hello = {}) {
    const ws = new WebSocket('ws://127.0.0.1:' + port + '/ws'); sockets.push(ws); await once(ws, 'open');
    const messages = []; ws.on('message', bytes => messages.push(JSON.parse(String(bytes))));
    async function receive(type) { for (let i = 0; i < 300; i++) { const index = messages.findIndex(m => m.t === type); if (index >= 0) return messages.splice(index, 1)[0]; await wait(5); } assert.fail('No local fixture packet: ' + type); }
    const send = value => ws.send(JSON.stringify(value)); send({ t: 'hello', room, ...hello });
    return { ws, send, receive, messages };
  }
  return { data, historicalWorlds, historical, stop, json, connect };
}

test('real server separates QA presence, chat, season writes and captures without erasing historical records', async t => {
  const f = await localServer(t), ordinary = await f.connect('march'), welcome = await ordinary.receive('welcome');
  const profile = (name, w) => ({ t: 'slow', d: { r: 0, on: 1, realmManagement: 1, seasonField: 2, n: name, dn: name, c: 'warrior', l: 3, rr: 0, ...(w ? { w } : {}) } });
  ordinary.send({ ...profile('Native QA fan'), d: { ...profile('Native QA fan').d, humanLive: 1, humanActivity: 1 } });
  const first = await ordinary.receive('season'); assert(first.roster.list.some(x => x.n === 'Native QA fan'));
  assert(first.roster.list.some(x => x.n === f.historical.historical.name), 'Display names never classify diagnostic participation');
  const before = await f.json('/season'), counters = await f.json('/stats');
  const qaRoom = 'native-companion-qa-123456789abc', qa = await f.connect(qaRoom,
    { reg: { name: 'SyntheticQa', pass: 'synthetic-local-fixture-pass' } }), qaWelcome = await qa.receive('welcome');
  assert.equal(qaWelcome.room, qaRoom); assert.equal(qaWelcome.season, null);
  assert.equal(qaWelcome.acct.guest, false, 'Diagnostic exclusion is independent of named/native account authority');
  const changed = { ...welcome.world, k: welcome.world.k.map((r, i) => i === 0 ? (r + 1) % 3 : r) };
  qa.send({ t: 'fast', d: { p: [0, 30, 0], ev: [[1, 'say', 0, ['r', 'Synthetic fixture line']]] } });
  qa.send({ t: 'contrib', q: 1, k: 'food', n: 120 });
  qa.send({ t: 'order', q: 2, o: { kind: 'target', keep: 2 } });
  for (const op of ['get', 'found', 'notice', 'pledge', 'say', 'muster', 'leave', 'invite', 'answer', 'remove', 'rank'])
    qa.send({ t: 'co', q: 10, op, name: 'Synthetic Company', text: 'Synthetic line', id: 'smithy' });
  qa.send({ t: 'season' }); qa.send({ t: 'ping', c: 1 }); assert.equal((await qa.receive('pong')).c, 1);
  assert.equal(qa.messages.some(m => ['season', 'contrib', 'order', 'co', 'company'].includes(m.t)), false,
    'Diagnostic packets never enter shared gameplay or persistence');
  const closed = once(qa.ws, 'close');
  qa.send({ ...profile('Sol', changed), d: { ...profile('Sol', changed).d,
    humanLive: 1, humanActivity: 1, wx: { v: 1, c: [] } } });
  assert.equal((await qa.receive('world-status')).standby, true);
  assert.equal((await closed)[0], 4000, 'A diagnostic frame cannot acquire a human lease');
  ordinary.send({ t: 'season' }); const later = await ordinary.receive('season');
  assert.equal(later.roster.list.some(x => x.n === 'Sol'), false);
  assert.equal(later.roster.now, 1); assert.equal(ordinary.messages.some(m => m.t === 'peer' && m.slow?.dn === 'Sol'), false);
  const qaSecond = await f.connect(qaRoom), secondWelcome = await qaSecond.receive('welcome');
  assert.equal(secondWelcome.room, qaRoom); assert.deepEqual(secondWelcome.world?.k, qaWelcome.world?.k,
    'Diagnostic frames cannot change even an in-memory world');
  assert.equal(secondWelcome.world?.wx, undefined, 'Diagnostic weather does not start a simulation');
  const qaThird = await f.connect(qaRoom);
  assert.equal((await qaThird.receive('welcome')).room, qaRoom, 'The closed diagnostic socket releases its room slot');
  const overflow = await f.connect(qaRoom), overflowWelcome = await overflow.receive('welcome');
  assert.equal(overflowWelcome.room, qaRoom + '-2'); assert.equal(overflowWelcome.season, null);
  overflow.send({ t: 'contrib', q: 3, k: 'food', n: 120 });
  overflow.send({ t: 'ping', c: 2 }); assert.equal((await overflow.receive('pong')).c, 2);
  assert.equal(overflow.messages.some(m => m.t === 'contrib'), false);
  const after = await f.json('/season'), stats = await f.json('/stats');
  assert.deepEqual(after.keeps, before.keeps); assert.deepEqual(after.news, before.news);
  for (const key of ['contribs', 'orders', 'liveCaptures', 'chatKept']) assert.equal(stats[key], counters[key], key);
  assert.equal(stats.companies.n, counters.companies.n);
  assert.equal(qa.messages.some(m => m.t === 'company'), false);
  const liveHealth = await f.json('/health');
  assert.equal(liveHealth.livePlay.players, 1, 'Only the explicit ordinary human actor counts');
  const invalid = await f.connect('native-companion-qa-' + 'x'.repeat(24));
  assert.equal((await invalid.receive('denied')).code, 'invalid_room');
  assert.equal((await f.json('/stats')).accounts, stats.accounts, 'Rejected diagnostic names create no account');
  const normalFallback = await f.connect('bad ordinary room'); assert.equal((await normalFallback.receive('welcome')).room, 'march');
  await f.stop();
  const roster = JSON.parse(await readFile(path.join(f.data, 'roster.json'), 'utf8'));
  assert.deepEqual(roster.historical, f.historical.historical); assert.equal(Object.hasOwn(roster, qaWelcome.acct.id), false);
  assert.deepEqual(JSON.parse(await readFile(path.join(f.data, 'worlds.json'), 'utf8')), f.historicalWorlds,
    'No diagnostic world/weather is added; pre-existing canonical and historical diagnostic worlds are unchanged');
  const chat = JSON.parse(await readFile(path.join(f.data, 'chat.json'), 'utf8'));
  assert.equal(chat.flat().some(line => line.includes('Synthetic fixture line')), false);
});
