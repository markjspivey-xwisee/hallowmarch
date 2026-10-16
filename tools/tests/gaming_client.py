"""Protocol unit checks for the optional expedition adapter, without WebGL.

Executes the real client source in a Node VM with a controlled socket and minimal
DOM. This does not claim a live network or full-game rendering verification.
"""
import os
import pathlib
import subprocess

ROOT = pathlib.Path(__file__).resolve().parents[2]
NODE = os.environ.get('CODEX_PRIMARY_RUNTIME_NODE') or 'node'
SCRIPT = r'''
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');
const source = fs.readFileSync('src/14u_gaming.js', 'utf8');
const sent = [], nodes = new Map(), intervals = [];
let timer = 0;
const timers = new Map();
const context = {
  window: { __HM_GAMING: { enabled: false }, __hm: {} },
  NETWS: { state: 'on', ws: { readyState: 1 }, acct: { id: 'alice' }, stats: { rtt: 45 }, generation: 1 },
  UI: { modal: null }, IS_TOUCH: true, Date, Promise, Error, Map, Set, Object, Number, String,
  structuredClone, crypto: webcrypto, performance,
  $: id => nodes.get(id), document: { activeElement: null },
  setTimeout: fn => { const id = ++timer; timers.set(id, () => { timers.delete(id); fn(); }); return id; },
  clearTimeout: id => timers.delete(id), setInterval: fn => intervals.push(fn),
  netWsSend: message => { sent.push(structuredClone(message)); return true; },
};
vm.createContext(context); vm.runInContext(source, context);
const api = context.window.__hm.gaming;
const flush = () => new Promise(resolve => setImmediate(resolve));
const reply = (message, result = {}) => api.msg({ t: 'gaming', op: 'result', requestId: message.requestId, ok: true, result });
const snapshot = (version = 1, overrides = {}) => ({ t: 'gaming', op: 'snapshot', roomId: 'march-proof', version, state: {
  entities: { alice: { id: 'alice', kind: 'player', name: 'Alice', ownerPlayerId: 'alice', x: 0, z: 0, hp: 100, maxHp: 100 },
    guardian: { id: 'guardian', kind: 'npc', name: 'Guardian', x: 0, z: 5, hp: 100, maxHp: 100 } },
  loot: [], grants: [], rewards: {}, ...overrides,
} });
async function join() {
  const joining = api.enter(); const enter = sent.at(-1);
  assert.equal(enter.op, 'enter');
  api.msg(snapshot()); reply(enter, { roomId: 'march-proof' }); await flush();
  const observe = sent.at(-1); assert.equal(observe.op, 'observe'); reply(observe);
  await joining; assert.equal(api.state.status, 'joined');
}
(async () => {
  assert.equal(api.enabled, false); assert.equal(sent.length, 0); assert.equal(intervals.length, 0);
  await assert.rejects(api.enter(), /not available/);
  api.msg(snapshot()); assert.equal(api.state.snapshot, null);
  assert.equal(sent.length, 0); assert.equal(nodes.size, 0);
  console.log('PASS disabled adapter has no UI, timer, network, or accepted snapshots');

  context.window.__HM_GAMING.enabled = true;
  context.NETWS.state = 'off'; await assert.rejects(api.enter(), /Reconnect/);
  assert.equal(sent.length, 0); context.NETWS.state = 'on';
  await join();
  assert.equal(api.state.snapshot.entities.length, 2);
  console.log('PASS explicit authenticated entry routes request IDs and observes server state');

  const moving = api.command({ type: 'move', x: 1, z: 0 }); const move = sent.at(-1);
  assert.match(move.command.commandId, /^[0-9a-f-]{36}$/);
  assert.equal(move.command.roomId, 'march-proof');
  assert.equal(api.state.snapshot.entities[0].x, 0, 'movement is not optimistically applied to shared state');
  api.msg({ t: 'gaming', op: 'result', requestId: 'unrelated', ok: true });
  assert.equal(api.state.pending, 1);
  reply(move, { moved: true }); await moving;
  assert.equal(api.state.snapshot.entities[0].x, 0, 'a success result never invents a state snapshot');
  const next = snapshot(2); next.state.entities.alice.x = 1; api.msg(next);
  assert.equal(api.state.snapshot.entities[0].x, 1);
  api.msg(snapshot(1)); assert.equal(api.state.version, 2);
  api.msg({ ...snapshot(10), roomId: 'another-room' }); assert.equal(api.state.version, 2);
  console.log('PASS server confirmation controls state; stale and other-room snapshots cannot replace it');

  for (const broken of [
    { ...snapshot(3), state: null }, { ...snapshot(3), state: [] },
    snapshot(3, { entities: [null] }), snapshot(3, { entities: [{ id: 'x', kind: 'npc', x: NaN, z: 0, hp: 10, maxHp: 10 }] }),
    snapshot(3, { entities: [{ id: 'x', kind: 'npc', x: 0, z: 0, hp: 11, maxHp: 10 }] }),
    { ...snapshot(3), version: -1 }, snapshot(3, { roomId: 'wrong-room' }),
  ]) { api.msg(broken); assert.equal(api.state.version, 2); }
  const privateView = snapshot(3, { profile: { secret: 'profile' }, chat: ['private'], inventory: ['sword'],
    grants: [{ id: 'grant1', role: 'coach', agentId: 'did:key:chosen', expiresAt: Date.now() + 1000, tokenHash: 'secret' }] });
  privateView.state.entities.alice.inventory = ['secret']; api.msg(privateView);
  assert.ok(!JSON.stringify(api.state).includes('secret')); assert.equal(api.state.snapshot.profile, undefined);
  const copy = api.state; copy.snapshot.entities[0].hp = 0;
  assert.equal(api.state.snapshot.entities[0].hp, 100);
  console.log('PASS malformed snapshots are ignored and private/nested server fields are omitted');

  const granting = api.grant({ agentId: 'did:key:chosen', role: 'coach', entityId: 'alice' });
  const grantRequest = sent.at(-1); assert.equal(grantRequest.op, 'grant');
  assert.match(grantRequest.commandId, /^[0-9a-f-]{36}$/); assert.equal(grantRequest.request.role, 'coach');
  reply(grantRequest, { grant: { id: 'grant1' }, token: 'one-time-bearer' }); await flush();
  assert.equal(sent.at(-1).op, 'observe'); reply(sent.at(-1));
  assert.equal((await granting).token, 'one-time-bearer');
  assert.ok(!JSON.stringify(api.state).includes('one-time-bearer'));
  const revoking = api.revoke('grant1'); assert.equal(sent.at(-1).op, 'revoke');
  assert.equal(sent.at(-1).grantId, 'grant1'); reply(sent.at(-1)); await flush(); reply(sent.at(-1)); await revoking;
  console.log('PASS human grant/revoke use scoped commands and bearer tokens never enter public client state');

  const attack = api.command({ type: 'attack', targetId: 'guardian' }); const attackRequest = sent.at(-1);
  api.msg({ t: 'gaming', op: 'result', requestId: attackRequest.requestId, ok: false, error: { code: 'out_of_range', message: 'Move closer.' } });
  await assert.rejects(attack, error => error.message === 'Move closer.' && error.code === 'out_of_range');
  assert.equal(api.state.snapshot.entities[1].hp, 100);
  const crossSession = api.command({ type: 'move', x: 2, z: 0 }); const staleRequest = sent.at(-1);
  const originalSocket = context.NETWS.ws;
  context.NETWS.generation++; context.NETWS.ws = { readyState: 1 };
  reply(staleRequest); await assert.rejects(crossSession, /connection changed/);
  assert.equal(api.state.pending, 0);
  api.msg(snapshot(100)); assert.equal(api.state.version, 3);
  await assert.rejects(api.command({ type: 'attack' }), /connection changed/);
  context.NETWS.generation--; context.NETWS.ws = originalSocket;
  console.log('PASS authoritative errors propagate and prior socket/session replies cannot complete commands');

  const pending = [];
  for (let i = 0; i < 8; i++) pending.push(api.command({ type: 'observe' }));
  await assert.rejects(api.command({ type: 'observe' }), /pending expedition/);
  for (const item of sent.slice(-8)) reply(item);
  await Promise.all(pending); assert.equal(api.state.pending, 0);
  const timeout = api.command({ type: 'attack', targetId: 'guardian' });
  const timeoutCallback = [...timers.values()].at(-1); timeoutCallback();
  await assert.rejects(timeout, /did not confirm/);
  console.log('PASS pending requests and timeout handling are bounded');

  nodes.set('gaming-sheet', { hidden: false }); nodes.set('gaming-token', { value: 'one-time-secret' });
  nodes.set('gaming-token-wrap', { hidden: false });
  api.show(false); assert.equal(nodes.get('gaming-token').value, ''); assert.equal(nodes.get('gaming-token-wrap').hidden, true);
  assert.ok(!JSON.stringify(api.state).includes('one-time-secret'));
  nodes.delete('gaming-sheet');
  const leaving = api.leave(); reply(sent.at(-1)); await leaving;
  assert.equal(api.state.status, 'idle'); assert.equal(api.state.snapshot, null);
  await assert.rejects(api.command({ type: 'attack' }), /Enter the shared expedition/);
  api.msg(snapshot(999)); assert.equal(api.state.snapshot, null);
  assert.equal(timers.size, 0);
  console.log('PASS closing clears one-time capabilities; leaving requires an explicit new entry');
})().catch(error => { console.error(error); process.exitCode = 1; });
'''

subprocess.run([NODE, '-e', SCRIPT], cwd=ROOT, check=True)
