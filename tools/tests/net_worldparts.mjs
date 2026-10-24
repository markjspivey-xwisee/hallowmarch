import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';

const moduleSource = fs.readFileSync(new URL('../../src/14z_networldparts.js', import.meta.url), 'utf8');
function client({ self = 'phone', host = 'desktop', account = 'phone-account' } = {}) {
  let clock = 1000;
  const sent = [], loaded = []; let persisted = null; let uid = 0;
  const context = {
    console, Map, Set, JSON, Math, Number, Object, Array, Infinity, setTimeout, clearTimeout,
    crypto: { randomUUID: () => 'outcome-' + (++uid) },
    SAVE: { native: true, ref: null, lastBody: '', nativeFlight: null, wiping: false },
    queueMicrotask() {}, performance: { now: () => clock },
    NETWS: { url: 'https://game.example', state: 'on', acct: { id: account } },
    NET: { self, peers: new Map() }, GAME: { player: { x: 0, y: 0, z: 0 }, prog: { level: 17 }, t: 1 },
    INV: { goods: { stone: 20, privateGem: 4, tool_hammer: 1 }, gold: 900, bag: [] }, BAG_SIZE: 40,
    GOODS: { stone: { stack: 999 }, privateGem: { stack: 999 }, tool_hammer: { stack: 1 } }, GOODS_UI: {},
    netOn: () => true, netHumanLive: () => true, netSharedWorldReady: () => true,
    netWorldAdmissionRead: a => a, netWsSend: m => { sent.push(structuredClone(m)); return true; },
    uiError() {}, reportError(error) { throw error; }, saveSoon() {},
    clamp: (v, lo, hi) => Math.max(lo, Math.min(v, hi)),
  };
  context.goodsHave = (id, n = 1) => (context.INV.goods[id] || 0) >= n;
  context.goodsTake = (id, n) => {
    if (!context.goodsHave(id, n)) return false;
    context.INV.goods[id] -= n; return true;
  };
  context.goodsTakeAll = rows => rows.every(([id, n]) => context.goodsHave(id, n))
    && rows.every(([id, n]) => context.goodsTake(id, n));
  context.goodsAdd = (id, n) => { context.INV.goods[id] = (context.INV.goods[id] || 0) + n; return n; };
  context.addGold = n => { context.INV.gold += n; };
  context.bagAdd = it => { context.INV.bag.push(it); return true; };
  context.loreNote = () => {}; context.skillGain = () => {};
  context.SAVE.ref = { get: async () => ({ exists: persisted !== null, data: () => structuredClone(persisted) }) };
  context.saveNow = async () => {
    if (context.commitHook) return context.commitHook();
    persisted = { char: { x: { sharedWorldReservations: structuredClone(context.api.journalSave()) },
      goods: structuredClone(context.INV.goods), bag: structuredClone(context.INV.bag), gold: context.INV.gold } };
    context.SAVE.lastBody = JSON.stringify(persisted);
  };
  vm.createContext(context);
  vm.runInContext(moduleSource + '\nglobalThis.api={state:NETPARTS,register:netWorldPartsRegister,command:netWorldPartsRegisterCommand,message:netWorldPartsMessage,pump:netWorldPartsPump,request:netWorldPartsRequest,publish:netWorldPartsPublish,apply:netWorldPartsApply,canSim:netWorldPartsCanSimulate,reset:netWorldPartsReset,journalSave:netWorldPartsJournalSave,journalLoad:netWorldPartsJournalLoad,flushPrivate:netWorldPartsFlushJournal};', context);
  const admission = { origin: 'https://game.example', epoch: 3 };
  context.api.message({ t: 'activity', kind: 'authority', authority: 'token', peer: host, worldAdmission: admission, worldpartsReady: false });
  return { context, api: context.api, sent, loaded, admission, getPersisted: () => structuredClone(persisted),
    setPersisted: value => { persisted = structuredClone(value); context.SAVE.lastBody = JSON.stringify(persisted); }, tick: ms => { clock += ms; context.api.pump(clock); } };
}
function frame(c, value, seq = 1) {
  const data = JSON.stringify(value);
  c.api.message({ t: 'activity', kind: 'worldparts', op: 'snapshot', authority: 'token',
    worldAdmission: c.admission, seq, part: 0, total: 1, data });
}

test('follower waits for canonical parts and never publishes private bootstrap', () => {
  const c = client(); let value = 'private bootstrap';
  c.api.register('farm', { save: () => value, apply: v => { value = v; } });
  c.tick(2000);
  assert.equal(c.sent.length, 0); assert.equal(c.api.canSim(), false);
  frame(c, { v: 1, full: true, parts: { farm: 'shared field' }, remove: [] });
  assert.equal(value, 'shared field'); assert.equal(c.context.GAME.prog.level, 17);
  assert.equal(c.context.INV.gold, 900);
});

test('one authoritative image applies once and stale or wrong admission frames cannot rewind it', () => {
  const c = client(); let count = 0;
  c.api.register('farm', { save: () => null, apply: () => count++ });
  frame(c, { v: 1, full: true, parts: { farm: { crop: 'grain' } }, remove: [] }, 2);
  frame(c, { v: 1, full: true, parts: { farm: { crop: 'grain' } }, remove: [] }, 3);
  frame(c, { v: 1, full: true, parts: { farm: { crop: 'stale' } }, remove: [] }, 1);
  c.api.message({ t: 'activity', kind: 'worldparts', op: 'snapshot', authority: 'old',
    worldAdmission: c.admission, seq: 4, part: 0, total: 1, data: JSON.stringify({ v: 1, full: true, parts: { farm: null } }) });
  assert.equal(count, 1);
});

test('large snapshots are paced, bounded, and followed by changed-part deltas', () => {
  const c = client({ self: 'desktop', host: 'desktop' }); let building = 'a'.repeat(20000);
  c.api.register('build', { save: () => building, apply() {} });
  c.api.register('farm', { save: () => 'unchanged', apply() {} });
  c.tick(2000);
  assert.equal(c.sent.length, 2);
  for (let i = 0; i < 6; i++) c.tick(200);
  const first = c.sent.filter(m => m.op === 'snapshot');
  assert.ok(first.every(m => JSON.stringify(m).length < 8192));
  assert.equal(c.api.state.outbox, null);
  assert.ok(c.api.state.awaiting);
  for (const packet of first) c.api.message(packet);
  assert.equal(c.api.state.awaiting, null);
  const full = JSON.parse(first.map(m => m.data).join('')); assert.equal(full.full, true);
  c.sent.length = 0; building = 'changed'; c.tick(2000); c.tick(200);
  const delta = JSON.parse(c.sent.filter(m => m.op === 'snapshot').map(m => m.data).join(''));
  assert.equal(delta.full, false); assert.deepEqual(Object.keys(delta.parts), ['build']);
});

test('command reserves only recipe costs and borrows tools without sending other inventory', async () => {
  const c = client();
  c.api.command('build.place', { tools: ['tool_hammer'] });
  frame(c, { v: 1, full: true, parts: {}, remove: [] });
  assert.equal(c.api.request('build.place', { x: 1 }, [['stone', 6]]), true);
  assert.equal(c.sent.some(m => m.op === 'command'), false);
  await c.api.flushPrivate();
  assert.equal(c.context.INV.goods.stone, 14);
  const command = c.sent.find(m => m.op === 'command').command;
  assert.deepEqual(command.goods, { stone: 6, tool_hammer: 1 });
  assert.equal(command.goods.privateGem, undefined);
  c.api.message({ t: 'activity', kind: 'worldparts', op: 'result', authority: 'token',
    worldAdmission: c.admission, id: command.id, to: 'phone', ownerAccount: 'phone-account', ok: true, goods: [['stone', -6]] });
  assert.equal(c.context.INV.goods.stone, 14);
  assert.equal(c.context.INV.goods.privateGem, 4);
});

test('refused command refunds once and receipt replay cannot duplicate refund', async () => {
  const c = client(); frame(c, { v: 1, full: true, parts: {}, remove: [] });
  c.api.request('build.place', {}, [['stone', 6]]);
  await c.api.flushPrivate();
  const id = c.sent.find(m => m.op === 'command').command.id;
  const result = { t: 'activity', kind: 'worldparts', op: 'result', authority: 'token',
    worldAdmission: c.admission, id, to: 'phone', ownerAccount: 'phone-account', ok: false };
  c.api.message(result); c.api.message(result);
  assert.equal(c.context.INV.goods.stone, 20);
});

test('cached receipt resolves an interrupted command after peer changes without reserving again', async () => {
  const c = client(); frame(c, { v: 1, full: true, parts: {}, remove: [] });
  c.api.request('build.place', {}, [['stone', 6]]);
  await c.api.flushPrivate();
  const id = c.sent.find(m => m.op === 'command').command.id;
  c.api.reset(); c.context.NET.self = 'phone-new';
  c.api.message({ t: 'activity', kind: 'authority', authority: 'new-token', peer: 'desktop',
    worldAdmission: c.admission, worldpartsReady: true });
  c.api.message({ t: 'activity', kind: 'worldparts', op: 'snapshot', authority: 'new-token',
    worldAdmission: c.admission, seq: 1, part: 0, total: 1,
    data: JSON.stringify({ v: 1, full: true, parts: {}, remove: [], receipts: [
      { id, ownerAccount: 'phone-account', to: 'phone', ok: true, goods: [['stone', -6]] }] }) });
  await c.api.flushPrivate();
  assert.equal(c.api.state.pending.size, 0); assert.equal(c.context.INV.goods.stone, 14);
});

test('host executes a retried operation only once and does not change its own private inventory', () => {
  const c = client({ self: 'desktop', host: 'desktop', account: 'desktop-account' });
  c.context.NET.peers.set('phone', { ghost: { x: 1, y: 0, z: 1, level: 4 } });
  let changes = 0;
  c.api.command('build.place', { point: () => ({ x: 1, z: 1 }), run: () => {
    c.context.goodsTake('stone', 6); changes++; return { ok: true };
  } });
  const message = { t: 'activity', kind: 'worldparts', op: 'command', authority: 'token',
    worldAdmission: c.admission, from: 'phone', ownerAccount: 'phone-account', position: { x: 1, z: 1 },
    command: { id: 'once', op: 'build.place', args: {}, goods: { stone: 6 }, capacity: 0 } };
  c.api.message(message); c.api.message(message);
  assert.equal(changes, 1);
  assert.equal(c.context.INV.goods.stone, 20); assert.equal(c.context.INV.gold, 900);
  assert.equal(c.context.GAME.prog.level, 17);
});

test('live land reconciliation never accumulates crater depth and removing a crater restores terrain', () => {
  const land = fs.readFileSync(new URL('../../src/12b_worldstate.js', import.meta.url), 'utf8');
  const crater = land.slice(land.indexOf('function landCraters('), land.indexOf('function landMap('));
  const shared = land.slice(land.indexOf('function landSharedApply('));
  const HN = 8, heights = new Float32Array(HN * HN).fill(10);
  const c = { HN, W: { H: heights, trees: [] }, GAME: { t: 20 }, Math, Number, Map, Set, Array, Float32Array,
    LAND_CAP: { craters: 40 }, NATURE: { built: true, speed: 1, craters: [], dyn: [], felled: [], growing: [], tileKeys: [], tiles: new Map(),
      fire: new Map(), fireList: [], piles: [] }, LAND: {}, HOUSES: [], CASTLES: [], FIRES: [],
    landInt: (v, lo, hi) => Number.isFinite(v) && v >= lo && v <= hi ? Math.round(v) : null,
    landNum: (v, lo, hi, def = 0) => Number.isFinite(v) ? Math.max(lo, Math.min(v, hi)) : def,
    natTerrainUpdate() {}, natTreesNear() {}, forNear() {}, landMap() {}, landTrees() {}, landPiles() {},
    LAND_HOUSE: {}, landTree() {}, landHouses() {}, landWalls() {},
  };
  vm.createContext(c); vm.runInContext(crater + shared + '\nglobalThis.apply=landSharedApply;', c);
  const value = { v: 1, cr: [[0, 0, 10, 2, 2, 1, 1, 0, -200]] };
  c.apply(value); assert.equal(heights[2 * HN + 2], 8);
  c.apply(value); c.apply(value); assert.equal(heights[2 * HN + 2], 8);
  c.apply({ v: 1 }); assert.equal(heights[2 * HN + 2], 10);
});

test('host withholds owner rewards until the server echoes the canonical mutation snapshot', () => {
  const c = client({ self: 'desktop', host: 'desktop', account: 'desktop-account' });
  c.context.NET.peers.set('phone', { ghost: { x: 1, y: 0, z: 1, level: 4 } });
  c.api.command('resource.take', { point: () => ({ x: 1, z: 1 }), run: () => {
    c.context.goodsAdd('stone', 2); return { ok: true };
  } });
  c.api.message({ t: 'activity', kind: 'worldparts', op: 'command', authority: 'token',
    worldAdmission: c.admission, from: 'phone', ownerAccount: 'phone-account', position: { x: 1, z: 1 },
    command: { id: 'resource-once', op: 'resource.take', args: {}, goods: {}, capacity: 0 } });
  assert.equal(c.sent.filter(m => m.op === 'result').length, 0);
  c.tick(200);
  const packets = c.sent.filter(m => m.op === 'snapshot');
  assert.ok(packets.length > 0);
  for (const packet of packets) c.api.message(packet);
  const results = c.sent.filter(m => m.op === 'result');
  assert.equal(results.length, 1);
  assert.equal(results[0].ownerAccount, 'phone-account');
  assert.equal(results[0].goods[0][1], 2);
});


test('native flight coalescing cannot dispatch before the exact reservation reaches readback', async () => {
  const c = client(); frame(c, { v: 1, full: true, parts: {}, remove: [] });
  const save = c.context.saveNow; let calls = 0;
  c.context.saveNow = async options => { calls++; if (calls > 1) return save(options); };
  c.api.request('build.place', {}, [['stone', 6]]);
  assert.equal(c.sent.filter(m => m.op === 'command').length, 0);
  await c.api.flushPrivate();
  assert.equal(calls, 2);
  const command = c.sent.find(m => m.op === 'command').command;
  assert.equal(c.getPersisted().char.x.sharedWorldReservations.pending[0].id, command.id);
  assert.equal(c.getPersisted().char.goods.stone, 14);
});

test('an acknowledged write with a mismatched canonical read holds the reservation and sends no command', async () => {
  const c = client(); frame(c, { v: 1, full: true, parts: {}, remove: [] });
  c.context.SAVE.ref.get = async () => ({ exists: true, data: () => ({ char: { x: {} } }) });
  c.api.request('build.place', {}, [['stone', 6]]);
  assert.equal(await c.api.flushPrivate(), false);
  assert.equal(c.sent.filter(m => m.op === 'command').length, 0);
  assert.equal(c.api.state.pending.size, 1);
  assert.equal(c.context.INV.goods.stone, 14);
  assert.equal(c.api.state.privateError, 'private_checkpoint_pending');
});

test('owner outcome remains pending until its private inventory and tombstone are confirmed together', async () => {
  const c = client(); frame(c, { v: 1, full: true, parts: {}, remove: [] });
  c.api.request('resource.take', {}, []);
  await c.api.flushPrivate();
  const id = c.sent.find(m => m.op === 'command').command.id;
  const save = c.context.saveNow; let release;
  c.context.saveNow = () => new Promise(resolve => { release = async () => { await save(); resolve(); }; });
  const result = { t: 'activity', kind: 'worldparts', op: 'result', authority: 'token',
    worldAdmission: c.admission, id, to: 'phone', ownerAccount: 'phone-account', digest: 'outcome-proof',
    ok: true, goods: [['stone', 2]] };
  c.api.message(result); c.api.message(result);
  await Promise.resolve();
  assert.equal(c.context.INV.goods.stone, 22);
  assert.equal(c.api.state.pending.get(id).phase, 'applied');
  assert.equal(c.sent.filter(m => m.op === 'settled').length, 0);
  assert.equal(c.getPersisted().char.goods.stone, 20);
  await release(); await c.api.flushPrivate();
  assert.equal(c.api.state.pending.size, 0);
  assert.equal(c.getPersisted().char.goods.stone, 22);
  assert.equal(c.getPersisted().char.x.sharedWorldReservations.settled[0].digest, 'outcome-proof');
  assert.equal(c.sent.filter(m => m.op === 'settled').length, 1);
});

test('reloading a confirmed applied journal never awards the same owner outcome twice', async () => {
  const c = client(); frame(c, { v: 1, full: true, parts: {}, remove: [] });
  c.api.request('resource.take', {}, []); await c.api.flushPrivate();
  const id = c.sent.find(m => m.op === 'command').command.id;
  const receipt = { id, ownerAccount: 'phone-account', digest: 'saved-outcome', to: 'phone', ok: true, goods: [['stone', 2]] };
  c.api.message({ ...receipt, t: 'activity', kind: 'worldparts', op: 'result', authority: 'token', worldAdmission: c.admission });
  await c.api.flushPrivate();
  const checkpoint = c.getPersisted();
  assert.equal(checkpoint.char.x.sharedWorldReservations.pending[0].phase, 'applied');
  const restored = client(); restored.context.INV.goods = structuredClone(checkpoint.char.goods);
  restored.api.command('resource.take', {});
  restored.api.journalLoad(checkpoint.char.x.sharedWorldReservations);
  frame(restored, { v: 1, full: true, parts: {}, remove: [], receipts: [receipt] });
  assert.equal(restored.api.state.pending.size, 0);
  assert.equal(restored.context.INV.goods.stone, 22);
});

test('changing the private profile while a journal is in flight cannot dispatch under the replacement identity', async () => {
  const c = client(); frame(c, { v: 1, full: true, parts: {}, remove: [] });
  let release;
  c.context.saveNow = () => new Promise(resolve => { release = resolve; });
  c.api.request('build.place', {}, [['stone', 6]]);
  await Promise.resolve();
  c.context.SAVE.ref = { get: async () => ({ exists: false }) };
  release(); await c.api.flushPrivate();
  assert.equal(c.sent.filter(m => m.op === 'command').length, 0);
  assert.equal(c.api.state.pending.size, 1);
});

test('pure public work avoids private checkpoints while forced owner actions use the host self actor', async () => {
  const follower = client(); frame(follower, { v: 1, full: true, parts: {}, remove: [] });
  let writes = 0;
  follower.context.saveNow = async () => { writes++; };
  follower.api.command('build.work', { durable: false });
  follower.api.request('build.work', { id: 1 }, []);
  assert.equal(writes, 0); assert.equal(follower.sent.filter(m => m.op === 'command').length, 1);
  const host = client({ self: 'desktop', host: 'desktop', account: 'desktop-account' });
  let actor;
  host.api.command('animal.hatch.claim', { run: () => { actor = host.context.GAME.player; return { ok: true }; } });
  assert.equal(host.api.request('animal.hatch.claim', { id: 'chick' }, [], true), true);
  await host.api.flushPrivate();
  const command = host.sent.find(m => m.op === 'command').command;
  const owner = host.context.GAME.player;
  host.api.message({ t: 'activity', kind: 'worldparts', op: 'command', authority: 'token',
    worldAdmission: host.admission, from: 'desktop', ownerAccount: 'desktop-account',
    position: { x: 0, z: 0 }, command });
  assert.equal(actor, owner);
});

test('a former account or replaced character cannot receive an old private outcome', async () => {
  for (const replace of [c => { c.context.NETWS.acct = { id: 'another-account' }; },
    c => { c.context.SAVE.ref = { get: async () => ({ exists: false }) }; },
    c => { c.context.GAME.player = { x: 0, y: 0, z: 0 }; }]) {
    const c = client(); frame(c, { v: 1, full: true, parts: {}, remove: [] });
    c.api.request('resource.take', {}, []); await c.api.flushPrivate();
    const id = c.sent.find(m => m.op === 'command').command.id;
    replace(c); c.sent.length = 0;
    c.api.message({ t: 'activity', kind: 'worldparts', op: 'result', authority: 'token',
      worldAdmission: c.admission, id, ownerAccount: 'phone-account', digest: 'old-scope',
      ok: true, goods: [['stone', 5]] });
    assert.equal(c.context.INV.goods.stone, 20);
    assert.equal(c.api.journalSave(), null, 'old reservations cannot enter the replacement profile');
    c.tick(4000);
    assert.equal(c.sent.filter(m => m.op === 'command' || m.op === 'settled').length, 0);
  }
});

test('loading another character clears old reservations and rejects foreign journal rows', async () => {
  const c = client(); frame(c, { v: 1, full: true, parts: {}, remove: [] });
  c.api.command('resource.take', {});
  c.api.request('resource.take', {}, []); await c.api.flushPrivate();
  const old = c.api.journalSave();
  c.api.journalLoad(null);
  assert.equal(c.api.state.pending.size, 0); assert.equal(c.api.state.settled.size, 0);
  c.context.NETWS.acct = { id: 'other-account' };
  c.api.journalLoad(old);
  assert.equal(c.api.state.pending.size, 0); assert.equal(c.api.journalSave(), null);
});

test('a replacement character can confirm its own reservation after an older private flight drains', async () => {
  const c = client(); frame(c, { v: 1, full: true, parts: {}, remove: [] });
  const save = c.context.saveNow; let release;
  c.context.saveNow = () => new Promise(resolve => { release = resolve; });
  c.api.request('build.place', { x: 1 }, [['stone', 6]]);
  await Promise.resolve();
  c.context.GAME.player = { x: 0, y: 0, z: 0 };
  c.context.INV.goods = { stone: 100, tool_hammer: 1 };
  c.api.journalLoad(null);
  c.api.request('build.place', { x: 2 }, [['stone', 6]]);
  c.context.saveNow = save; release(); await c.api.flushPrivate();
  const commands = c.sent.filter(m => m.op === 'command');
  assert.equal(commands.length, 1); assert.equal(commands[0].command.args.x, 2);
  assert.equal(c.getPersisted().char.goods.stone, 94);
});

test('settlement retries until a canonical settled receipt arrives and then stops', async () => {
  const c = client(); frame(c, { v: 1, full: true, parts: {}, remove: [] });
  c.api.request('resource.take', {}, []); await c.api.flushPrivate();
  const id = c.sent.find(m => m.op === 'command').command.id;
  const receipt = { id, ownerAccount: 'phone-account', digest: 'retry-proof', ok: true, goods: [['stone', 2]] };
  c.api.message({ ...receipt, t: 'activity', kind: 'worldparts', op: 'result', authority: 'token', worldAdmission: c.admission });
  await c.api.flushPrivate();
  assert.equal(c.sent.filter(m => m.op === 'settled').length, 1);
  c.tick(3100);
  assert.equal(c.sent.filter(m => m.op === 'settled').length, 2, 'a locally sent acknowledgement is not canonical confirmation');
  frame(c, { v: 1, full: false, parts: {}, remove: [], receipts: [{ ...receipt, settled: true }] }, 2);
  c.tick(3100);
  assert.equal(c.sent.filter(m => m.op === 'settled').length, 2);
  assert.equal(c.context.INV.goods.stone, 22);
});

test('forty private outcomes settle without exhausting the public receipt budget', async () => {
  const host = client({ self: 'desktop', host: 'desktop', account: 'desktop-account' }), follower = client();
  host.context.NET.peers.set('phone', { ghost: { x: 0, z: 0, level: 4 } });
  let stock = 100;
  host.api.register('stock', { save: () => stock, apply: value => { stock = value; } });
  host.api.command('resource.take', { run: () => {
    if (!stock) return false;
    stock--; host.context.goodsAdd('stone', 1); return { ok: true };
  } });
  frame(follower, { v: 1, full: true, parts: {}, remove: [] });
  for (let index = 0; index < 40; index++) {
    follower.sent.length = 0; host.sent.length = 0;
    follower.api.request('resource.take', {}, []); await follower.api.flushPrivate();
    const command = follower.sent.find(m => m.op === 'command');
    assert.ok(command, 'the next private reservation is admitted');
    host.api.message({ ...command, from: 'phone', ownerAccount: 'phone-account', position: { x: 0, z: 0 } });
    host.tick(2000);
    for (const packet of host.sent.filter(m => m.op === 'snapshot')) {
      host.api.message(packet); follower.api.message(packet);
    }
    for (const packet of host.sent.filter(m => m.op === 'result')) follower.api.message(packet);
    await follower.api.flushPrivate();
    for (let pass = 0; pass < 4 && host.api.state.receipts.some(r => r.id === command.command.id && !r.settled); pass++) {
      follower.tick(3100);
      for (const settled of follower.sent.filter(m => m.op === 'settled'))
        host.api.message({ ...settled, ownerAccount: 'phone-account', from: 'phone' });
      follower.sent.length = 0;
      host.sent.length = 0; host.tick(2000);
      for (const packet of host.sent.filter(m => m.op === 'snapshot')) {
        host.api.message(packet); follower.api.message(packet);
      }
    }
    assert.equal(follower.api.state.pending.size, 0);
    assert.ok(host.api.state.receipts.length <= 8, 'settled outcomes leave room for the next action');
  }
  assert.equal(stock, 60); assert.equal(follower.context.INV.goods.stone, 60);
  assert.equal(follower.context.INV.goods.privateGem, 4); assert.equal(host.context.INV.goods.stone, 20);
  assert.equal(host.context.INV.gold, 900);
});
