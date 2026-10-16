// Writes only to an explicitly configured dedicated gaming pod. This measures
// the real native path; a missing SDK/identity is a failed prerequisite, not a
// reason to substitute an in-memory benchmark and call it multiplayer latency.
import { performance } from 'node:perf_hooks';
import { configuredGamingStore } from './provider.js';
import { AuthoritativeRoom } from './authority.js';
import { createHallowmarchDomain } from './hallowmarch.js';

if (!process.argv.includes('--authorize-native-writes')) throw new Error('Pass --authorize-native-writes with dedicated benchmark pod settings.');
const count = Number(process.argv.find(a => a.startsWith('--commands='))?.split('=')[1] || 100);
const progress = process.argv.includes('--progress');
const report = phase => { if (progress) console.log(JSON.stringify({ kind: 'native-benchmark-progress', phase })); };
if (!Number.isInteger(count) || count < 1 || count > 10000) throw new Error('commands must be 1..10000');
const store = await configuredGamingStore();
if (!store) throw new Error('HM_GAMING_ENABLED=1 and dedicated native service settings are required.');
await store.ready();
report('native-ready');
const roomId = `benchmark-${Date.now()}`, room = await new AuthoritativeRoom({ roomId, store, domain: createHallowmarchDomain() }).open();
report('world-committed');
const principal = { playerId: 'benchmark-observer', realmId: '0', name: 'Software verification' };
await room.execute(principal, { type: 'join', commandId: 'join' });
report('observer-joined');
const samples = [];
for (let i = 0; i < count; i++) {
  const start = performance.now();
  await room.execute(principal, { type: 'knowledge.consulted', resourceId: 'https://github.com/markjspivey-xwisee/hallowmarch' , commandId: `benchmark-${i}` });
  samples.push(performance.now() - start);
  report(`command-${i + 1}-committed`);
}
const ordered = [...samples].sort((a, b) => a - b), percentile = p => Math.round(ordered[Math.min(ordered.length - 1, Math.floor(ordered.length * p))] * 100) / 100;
// A new store also creates a fresh SDK/transport cache: cached immutable
// ciphertext cannot satisfy the benchmark's native recovery check.
const recoveredStore = await configuredGamingStore();
await recoveredStore.ready();
const restarted = await new AuthoritativeRoom({ roomId, store: recoveredStore, domain: createHallowmarchDomain() }).open();
if (JSON.stringify(restarted.current) !== JSON.stringify(room.current) || restarted.version !== room.version) throw new Error('Fresh native recovery differs.');
console.log(JSON.stringify({ kind: 'native-durable-command-latency', roomId, commands: count, p50Ms: percentile(.5), p95Ms: percentile(.95), p99Ms: percentile(.99),
  maxMs: percentile(1), meanMs: samples.reduce((a, b) => a + b) / count, version: room.version, recovered: true, coldStore: true, includesClientNetwork: false }, null, 2));
