// [net] A load test of the March's server: simulated players (tools/net/player.mjs), each with a realm, walking about the
// March at ten states a second, speaking now and then and delivering to its realm, for a while at each crowd's size; the
// server's own numbers read before and after (/stats: messages, bytes, its process's CPU and memory, the season's step).
// usage: node tools/net/loadtest.mjs [wss://host/ws] [sizes=10,50,100] [secs=30] [spread=420] [json=PATH]
import fs from 'node:fs';
import { Player } from './player.mjs';

const args = process.argv.slice(2);
const KV = Object.fromEntries(args.filter((a) => a.includes('=') && !a.startsWith('ws')).map((a) => a.split('=')));
const url = args.find((a) => /^wss?:/.test(a)) || 'wss://march-production-f6d9.up.railway.app/ws';
const sizes = (KV.sizes || '10,50,100').split(',').map(Number);
const secs = +KV.secs || 30, spread = +KV.spread || 420;
const base = url.replace(/^ws/, 'http').replace(/\/ws$/, '');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const stats = async () => (await fetch(base + '/stats')).json();
const results = [];
const players = [];
let tick = null;
function walk() {
  for (const P of players) {
    if (P.closed) continue;
    P.a = (P.a || Math.random() * 6.28) + (Math.random() - 0.5) * 0.3;
    P.x = Math.max(-480, Math.min(480, P.x + Math.cos(P.a) * 0.45)); P.z = Math.max(-480, Math.min(480, P.z + Math.sin(P.a) * 0.45)); // 4.5 m/s
    P.fast();
    if (Math.random() < 0.002) P.say('hold the line ' + Math.floor(Math.random() * 100));
  }
}
for (const n of sizes) {
  while (players.length < n) {
    const i = players.length;
    const P = new Player(url, { name: 'Load' + i, x: (Math.random() * 2 - 1) * spread, z: (Math.random() * 2 - 1) * spread, room: KV.room || 'load' });
    try { await P.open(); await P.profile({ realm: i % 3, name: 'Load' + i, cls: ['warrior', 'archer', 'mage', 'priest'][i % 4], level: 20 + (i % 30) }); players.push(P); } catch (e) { console.log('could not join', i, e.message); break; }
    await sleep(40);
  }
  if (!tick) tick = setInterval(walk, 100);
  await sleep(2000);
  const s0 = await stats(), m0 = players.reduce((a, P) => a + P.msgs, 0), b0 = players.reduce((a, P) => a + P.bytes, 0), t0 = Date.now();
  // deliveries now and then while they walk
  const cint = setInterval(() => { const P = players[Math.floor(Math.random() * players.length)]; if (P && !P.closed) P.contrib(['food', 'timber', 'stone'][Math.floor(Math.random() * 3)], 20); }, 500);
  await sleep(secs * 1000);
  clearInterval(cint);
  const s1 = await stats(), dt = (Date.now() - t0) / 1000;
  const m1 = players.reduce((a, P) => a + P.msgs, 0), b1 = players.reduce((a, P) => a + P.bytes, 0);
  const cpu = ((s1.proc.cpu.user + s1.proc.cpu.system) - (s0.proc.cpu.user + s0.proc.cpu.system)) / 1e6 / dt;
  const r = {
    players: players.filter((P) => !P.closed).length, secs: Math.round(dt),
    inPerSec: Math.round((s1.msgs - s0.msgs) / dt), outKBps: Math.round((s1.bytesOut - s0.bytesOut) / dt / 1024),
    clientMsgsPerSec: Math.round((m1 - m0) / dt), clientKBpsEach: +((b1 - b0) / dt / 1024 / players.length).toFixed(1),
    serverCpu: +cpu.toFixed(3), rssMB: Math.round(s1.proc.mem.rss / 1048576), heapMB: Math.round(s1.proc.mem.heapUsed / 1048576),
    seasonStepMs: s1.season && s1.season.stepMs, rooms: s1.rooms.map((R) => [R.name, R.players]), dropped: { rate: s1.rateDropped - s0.rateDropped, pace: s1.paceDropped - s0.paceDropped, bad: s1.badMsgs - s0.badMsgs },
    contribs: s1.contribs - s0.contribs,
  };
  results.push(r);
  console.log(JSON.stringify(r));
}
clearInterval(tick);
for (const P of players) P.close();
if (KV.json) fs.writeFileSync(KV.json, JSON.stringify(results, null, 1));
await sleep(500);
process.exit(0);
