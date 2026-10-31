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
  vm.runInContext(moduleSource + '\nglobalThis.api={state:NETPARTS,register:netWorldPartsRegister,command:netWorldPartsRegisterCommand,result:netWorldPartsRegisterResult,failure:netWorldPartsRegisterFailure,message:netWorldPartsMessage,pump:netWorldPartsPump,request:netWorldPartsRequest,publish:netWorldPartsPublish,apply:netWorldPartsApply,canSim:netWorldPartsCanSimulate,reset:netWorldPartsReset,journalSave:netWorldPartsJournalSave,journalLoad:netWorldPartsJournalLoad,flushPrivate:netWorldPartsFlushJournal};', context);
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

test('private-confirmed settlement retries through a temporary fence and stops on the durable server acknowledgement', async () => {
  const c = client(); frame(c, { v: 1, full: true, parts: {}, remove: [] });
  c.api.request('resource.take', {}, []); await c.api.flushPrivate();
  const id = c.sent.find(m => m.op === 'command').command.id;
  const ack = { t: 'activity', kind: 'worldparts', op: 'settled', authority: 'token',
    worldAdmission: c.admission, id, ownerAccount: 'phone-account', digest: 'retry-outcome' };
  c.api.message({ ...ack, op: 'result', to: 'phone', ok: true, goods: [['stone', 2]] });
  await c.api.flushPrivate();
  assert.equal(c.sent.filter(m => m.op === 'settled').length, 1);
  c.tick(2900); assert.equal(c.sent.filter(m => m.op === 'settled').length, 1);
  c.tick(200); assert.equal(c.sent.filter(m => m.op === 'settled').length, 2);
  c.api.message({ ...ack, ownerAccount: 'unrelated-account' });
  c.tick(3100); assert.equal(c.sent.filter(m => m.op === 'settled').length, 3);
  c.api.message(ack);
  c.tick(3100); assert.equal(c.sent.filter(m => m.op === 'settled').length, 3);
});

test('a failing command restores the host private character before reporting the failure', () => {
  const c = client({ self: 'desktop', host: 'desktop', account: 'desktop-account' });
  c.context.NET.peers.set('phone', { ghost: { x: 1, z: 1, level: 4 } });
  const owner = c.context.GAME.player, goods = c.context.INV.goods;
  c.api.command('resource.error', { run: () => { c.context.goodsTake('stone', 1); throw Error('test failure'); } });
  assert.throws(() => c.api.message({ t: 'activity', kind: 'worldparts', op: 'command', authority: 'token',
    worldAdmission: c.admission, from: 'phone', ownerAccount: 'phone-account', position: { x: 1, z: 1 },
    command: { id: 'bad-once', op: 'resource.error', args: {}, goods: { stone: 1 }, capacity: 0 } }), /test failure/);
  assert.equal(c.context.GAME.player, owner); assert.equal(c.context.INV.goods, goods);
  assert.equal(goods.stone, 20); assert.equal(c.context.INV.gold, 900);
  assert.equal(c.api.state.replay, false); assert.equal(c.api.state.receipts[0].ok, false);
});

test('live farm images restore herb regrowth while preserving private knowledge and local work', () => {
  const source = fs.readFileSync(new URL('../../src/08h_farming.js', import.meta.url), 'utf8');
  const load = source.slice(source.indexOf('function farmLoadData('), source.indexOf('// what counts as a change worth writing: beds'));
  const shared = source.slice(source.indexOf('function farmSharedApply('), source.indexOf('queueMicrotask(() => {', source.indexOf('function farmSharedApply(')));
  const known = { known: { herb_secret: { at: 10 } }, tips: 7 }, job = { kind: 'gather', swings: 2 };
  const c = { FARM: { nextStrain: 101, plots: [], herbs: [{ i: 0, gone: 100, regrow: 20 }], herbal: known, job },
    GAME: { t: 50 }, SEASON: { t: 4, yearSec: 1000, idx: 0 }, GOODS: {}, Math, Number, Array, Object,
    seasonCalc() {}, buildCoverMask() {}, farmNum: (v, lo, hi, fallback) => Number.isFinite(+v) ? Math.max(lo, Math.min(hi, +v)) : fallback };
  vm.createContext(c); vm.runInContext(load + shared + '\nglobalThis.apply=farmSharedApply;', c);
  c.apply({ v: 1, t: 4, n: 101, st: [], pl: [], tw: [], hb: [[0, 50, 10]], gr: {} });
  assert.equal(c.FARM.herbs[0].gone, 50); assert.equal(c.FARM.herbal, known); assert.equal(c.FARM.job, job);
  c.apply({ v: 1, t: 4, n: 101, st: [], pl: [], tw: [], hb: [], gr: {} });
  assert.equal(c.FARM.herbs[0].gone, 0); assert.equal(c.FARM.herbs[0].regrow, 0);
  assert.equal(c.FARM.herbal.known.herb_secret.at, 10); assert.equal(c.FARM.herbal.tips, 7);
});

test('live construction replaces different bootstrap once and preserves bed and work through repeated images', () => {
  const source = fs.readFileSync(new URL('../../src/06k_build.js', import.meta.url), 'utf8');
  const saveLoad = source.slice(source.indexOf('function buildSaveData('), source.indexOf('// what counts as a change worth writing: the pieces'));
  const shared = source.slice(source.indexOf('function buildSharedSave('), source.indexOf('function buildChestTransfer('));
  let made = 0;
  const c = { BUILD: { pieces: [], bed: 8, next: 20, work: null }, Math, Number, Array, Object, JSON,
    B_MAX: 600, HALF: 500, B_ST: ['build', 'built', 'ruin'], BP: { bed: {}, foundation: {} }, GOODS: { stone: {} },
    clamp: (v, lo, hi) => Math.max(lo, Math.min(v, hi)), buildCoverMask() {}, bSupport() {}, bApplyState() {}, bUniforms() {},
    smooth: n => n, buildDemolish: pc => { c.BUILD.pieces.splice(c.BUILD.pieces.indexOf(pc), 1); },
    bMakePiece: pc => { made++; c.BUILD.pieces.push({ ...pc, leaves: [] }); return pc; } };
  const row = (id, t, x, st, progress) => [id, t, x, 1, 2, 2, 0, 0, x, 1, 0, 0, 0, 'f', st, progress, 0, 0, 0, 0];
  vm.createContext(c); vm.runInContext(saveLoad + shared + '\nglobalThis.apply=buildSharedApply;globalThis.save=buildSharedSave;', c);
  c.apply({ v: 1, p: [row(8, 'bed', 0, 1, 100), row(12, 'foundation', 3, 0, 25)], live: [] });
  const piece = c.BUILD.pieces.find(pc => pc.id === 12);
  c.BUILD.bed = 8; c.BUILD.work = { pc: piece, t: 2, auto: true };
  c.apply({ v: 1, bed: 999, p: [row(8, 'bed', 0, 1, 100), row(12, 'foundation', 3, 0, 50)], live: [] });
  c.apply({ v: 1, bed: 999, p: [row(8, 'bed', 0, 1, 100), row(12, 'foundation', 3, 0, 50)], live: [] });
  assert.equal(made, 2); assert.equal(c.BUILD.pieces.length, 2);
  assert.equal(new Set(c.BUILD.pieces.map(pc => pc.id)).size, 2);
  assert.equal(c.BUILD.bed, 8); assert.equal(c.BUILD.work.pc, piece); assert.equal(piece.p, 0.5);
  assert.equal(Object.hasOwn(c.save(), 'bed'), false);
});

test('production success and refusal hooks settle owner cycles before the private outcome checkpoint', async () => {
  for (const ok of [true, false]) {
    const c = client(); frame(c, { v: 1, full: true, parts: {}, remove: [] });
    c.api.command('animal.lay', {});
    let ownerCycle = 'pending', callbackId;
    c.api.result('animal.lay', (result, receipt, pending) => {
      assert.equal(result.cycle, 4); assert.equal(pending.args.aid, 'hen-1');
      callbackId = receipt.id; ownerCycle = 'accepted';
    });
    c.api.failure('animal.lay', (receipt, pending) => {
      assert.equal(pending.args.cycle, 4); callbackId = receipt.id; ownerCycle = 'restored';
    });
    c.api.request('animal.lay', { aid: 'hen-1', cycle: 4 }, [], true); await c.api.flushPrivate();
    const id = c.sent.find(m => m.op === 'command').command.id;
    const save = c.context.saveNow;
    c.context.saveNow = async () => {
      assert.equal(ownerCycle, ok ? 'accepted' : 'restored');
      assert.equal(c.api.journalSave().pending[0].phase, 'applied');
      return save();
    };
    c.api.message({ t: 'activity', kind: 'worldparts', op: 'result', authority: 'token',
      worldAdmission: c.admission, id, ownerAccount: 'phone-account', digest: 'cycle-' + ok, ok,
      result: { cycle: 4 }, goods: [] });
    await c.api.flushPrivate();
    assert.equal(callbackId, id); assert.equal(c.api.state.pending.size, 0);
  }
});

test('canonical receipts carry the durability classification of the host command specification', () => {
  const c = client({ self: 'desktop', host: 'desktop', account: 'desktop-account' });
  for (const [id, spec, args, expected] of [
    ['default', {}, {}, true], ['public', { durable: false }, {}, false],
    ['dynamic-public', { durable: a => a.ownerChange }, { ownerChange: false }, false],
    ['dynamic-owner', { durable: a => a.ownerChange }, { ownerChange: true }, true],
  ]) {
    c.api.command(id, { ...spec, run: () => ({ ok: true }) });
    c.api.message({ t: 'activity', kind: 'worldparts', op: 'command', authority: 'token',
      worldAdmission: c.admission, from: 'desktop', ownerAccount: 'desktop-account', position: { x: 0, z: 0 },
      command: { id, op: id, args, goods: {}, capacity: 0, durable: !expected } });
    assert.equal(c.api.state.receipts.find(r => r.id === id).durable, expected);
  }
});

function actualCapacity(c) {
  const goods = fs.readFileSync(new URL('../../src/06d_goods.js', import.meta.url), 'utf8');
  const loot = fs.readFileSync(new URL('../../src/09c_loot.js', import.meta.url), 'utf8');
  vm.runInContext(goods.slice(goods.indexOf('function goodsAdd('), goods.indexOf('function goodsTake('))
    + loot.slice(loot.indexOf('function bagAdd('), loot.indexOf('function canEquip(')), c.context);
}

test('a full goods stack holds the entire canonical reward until it fits and then credits once', async () => {
  const c = client(); actualCapacity(c); frame(c, { v: 1, full: true, parts: {}, remove: [] });
  c.context.INV.goods.stone = 998;
  c.api.request('resource.take', {}, []); await c.api.flushPrivate();
  const id = c.sent.find(m => m.op === 'command').command.id;
  const receipt = { id, ownerAccount: 'phone-account', digest: 'full-stack', ok: true,
    goods: [['stone', 2]], gold: 10, items: [{ id: 'reward-sword', slot: 'weapon' }] };
  const message = { ...receipt, t: 'activity', kind: 'worldparts', op: 'result', authority: 'token', worldAdmission: c.admission };
  let warnings = 0; c.context.uiError = () => { warnings++; };
  c.api.message(message); c.api.message(message); c.tick(3100);
  assert.equal(c.context.INV.goods.stone, 998); assert.equal(c.context.INV.gold, 900);
  assert.equal(c.context.INV.bag.length, 0); assert.equal(c.api.state.pending.get(id).phase, 'reserved');
  assert.equal(c.sent.filter(m => m.op === 'settled').length, 0); assert.equal(warnings, 1);
  c.context.INV.goods.stone = 997; c.tick(200); await c.api.flushPrivate();
  assert.equal(c.context.INV.goods.stone, 999); assert.equal(c.context.INV.gold, 910);
  assert.equal(c.context.INV.bag.length, 1); assert.equal(c.api.state.pending.size, 0);
  c.api.message(message); c.tick(200);
  assert.equal(c.context.INV.goods.stone, 999); assert.equal(c.context.INV.gold, 910); assert.equal(c.context.INV.bag.length, 1);
});

test('bag slots filled after a request cannot partially consume an owner receipt', async () => {
  const c = client(); actualCapacity(c); frame(c, { v: 1, full: true, parts: {}, remove: [] });
  c.api.request('loot.take', { id: 'bag' }, []); await c.api.flushPrivate();
  const id = c.sent.find(m => m.op === 'command').command.id;
  c.context.INV.bag = Array.from({ length: c.context.BAG_SIZE }, (_, i) => ({ id: 'owned-' + i, slot: 'weapon' }));
  let skill = 0; c.context.skillGain = () => { skill++; };
  c.api.message({ t: 'activity', kind: 'worldparts', op: 'result', authority: 'token', worldAdmission: c.admission,
    id, ownerAccount: 'phone-account', digest: 'bag-full', ok: true, goods: [['stone', 2]], gold: 10,
    items: [{ id: 'first', slot: 'head' }, { id: 'second', slot: 'hands' }], skills: [['craft', 1]] });
  assert.equal(c.context.INV.goods.stone, 20); assert.equal(c.context.INV.gold, 900); assert.equal(skill, 0);
  c.context.INV.bag.pop(); c.tick(200);
  assert.equal(c.context.INV.goods.stone, 20); assert.equal(c.api.state.pending.get(id).phase, 'reserved');
  c.context.INV.bag.pop(); c.tick(200); await c.api.flushPrivate();
  assert.equal(c.context.INV.goods.stone, 22); assert.equal(c.context.INV.gold, 910); assert.equal(skill, 1);
  assert.equal(c.context.INV.bag.length, c.context.BAG_SIZE); assert.equal(c.api.state.pending.size, 0);
});

test('a refused action keeps an overflowing refund owed without running failure hooks early', async () => {
  const c = client(); actualCapacity(c); frame(c, { v: 1, full: true, parts: {}, remove: [] });
  c.api.request('build.place', {}, [['stone', 6]]); await c.api.flushPrivate();
  const id = c.sent.find(m => m.op === 'command').command.id;
  c.context.INV.goods.stone = 999;
  let failures = 0; c.api.failure('build.place', () => { failures++; });
  const m = { t: 'activity', kind: 'worldparts', op: 'result', authority: 'token', worldAdmission: c.admission,
    id, ownerAccount: 'phone-account', digest: 'refund-full', ok: false, goods: [] };
  c.api.message(m);
  assert.equal(failures, 0); assert.equal(c.context.INV.goods.stone, 999);
  assert.equal(c.api.state.pending.get(id).phase, 'reserved');
  c.context.INV.goods.stone = 993; c.tick(200); await c.api.flushPrivate();
  assert.equal(c.context.INV.goods.stone, 999); assert.equal(failures, 1); assert.equal(c.api.state.pending.size, 0);
  c.api.message(m); assert.equal(failures, 1); assert.equal(c.context.INV.goods.stone, 999);
});

test('reopening a capacity-blocked reservation replays the canonical obligation without another claim', async () => {
  const c = client(); actualCapacity(c); frame(c, { v: 1, full: true, parts: {}, remove: [] });
  c.api.command('loot.take', {}); c.context.INV.goods.stone = 999;
  c.api.request('loot.take', { id: 'owed' }, []); await c.api.flushPrivate();
  const id = c.sent.find(m => m.op === 'command').command.id;
  const receipt = { id, ownerAccount: 'phone-account', digest: 'reopen-full', ok: true, goods: [['stone', 2]] };
  c.api.message({ ...receipt, t: 'activity', kind: 'worldparts', op: 'result', authority: 'token', worldAdmission: c.admission });
  const checkpoint = c.getPersisted();
  const restored = client(); actualCapacity(restored); restored.api.command('loot.take', {});
  restored.context.INV.goods = structuredClone(checkpoint.char.goods);
  restored.api.journalLoad(checkpoint.char.x.sharedWorldReservations);
  frame(restored, { v: 1, full: true, parts: {}, remove: [], receipts: [receipt] });
  assert.equal(restored.context.INV.goods.stone, 999); assert.equal(restored.api.state.pending.get(id).phase, 'reserved');
  restored.context.INV.goods.stone = 997; restored.tick(200); await restored.api.flushPrivate();
  assert.equal(restored.context.INV.goods.stone, 999); assert.equal(restored.api.state.pending.size, 0);
  assert.equal(restored.sent.filter(m => m.op === 'command').length, 0);
});

test('a confirmed retry clears a follower pause and resolves its original owed outcome exactly once', async () => {
  const c = client(); frame(c, { v: 1, full: true, parts: {}, remove: [] });
  c.api.request('resource.take', {}, []); await c.api.flushPrivate();
  const id = c.sent.find(m => m.op === 'command').command.id;
  c.api.message({ t: 'activity', kind: 'worldparts', op: 'snapshot', authority: 'token',
    worldAdmission: c.admission, ok: false, reason: 'checkpoint_unconfirmed' });
  c.tick(5000);
  assert.equal(c.api.state.paused, 'checkpoint_unconfirmed');
  assert.equal(c.api.state.pending.get(id).phase, 'reserved'); assert.equal(c.context.INV.goods.stone, 20);
  const packet = value => ({ t: 'activity', kind: 'worldparts', op: 'snapshot', authority: 'token',
    worldAdmission: c.admission, seq: 2, part: 0, total: 1, data: value });
  c.api.message(packet('{'));
  c.api.message(packet(JSON.stringify({ v: 1, parts: [] })));
  c.api.message({ ...packet(JSON.stringify({ v: 1, parts: {} })), authority: 'old-token' });
  assert.equal(c.api.state.paused, 'checkpoint_unconfirmed');
  const receipt = { id, ownerAccount: 'phone-account', digest: 'recovered-save', ok: true, goods: [['stone', 2]] };
  frame(c, { v: 1, full: true, parts: {}, remove: [], receipts: [receipt] }, 3);
  await c.api.flushPrivate();
  assert.equal(c.api.state.paused, ''); assert.equal(c.api.state.pending.size, 0);
  assert.equal(c.context.INV.goods.stone, 22);
  frame(c, { v: 1, full: false, parts: {}, remove: [], receipts: [receipt] }, 4);
  assert.equal(c.context.INV.goods.stone, 22);
  c.api.request('resource.take', {}, []); await c.api.flushPrivate();
  assert.equal(c.sent.filter(m => m.op === 'command').length, 2, 'normal requests resume with a new ID after the original outcome');
});

test('a confirmed original frame unpauses the keeper and permits a fresh transport acknowledgement', () => {
  const c = client({ self: 'desktop', host: 'desktop', account: 'desktop-account' });
  c.api.register('stock', { save: () => 4, apply() {} });
  c.tick(2000);
  const original = c.sent.filter(m => m.op === 'snapshot');
  assert.equal(original.length, 1); assert.ok(c.api.state.awaiting);
  c.api.message({ t: 'activity', kind: 'worldparts', op: 'snapshot', authority: 'token',
    worldAdmission: c.admission, ok: false, reason: 'checkpoint_unconfirmed' });
  assert.equal(c.api.canSim(), false);
  for (const packet of original) c.api.message(packet);
  assert.equal(c.api.state.paused, ''); assert.equal(c.api.canSim(), true);
  c.sent.length = 0; c.tick(2000);
  const fresh = c.sent.filter(m => m.op === 'snapshot');
  assert.ok(fresh.length); assert.ok(fresh[0].seq > original[0].seq);
  for (const packet of fresh) c.api.message(packet);
  assert.equal(c.api.state.awaiting, null); assert.equal(c.api.state.sent, 1);
});

test('a server receipt survives an older in-flight host frame and resolves its scoped owner once', async () => {
  const host = client({ self: 'desktop', host: 'desktop', account: 'desktop-account' }), owner = client();
  frame(owner, { v: 1, full: true, parts: {}, remove: [] });
  owner.context.GOODS.plank = { stack: 999 }; owner.context.INV.goods.plank = 10;
  owner.api.command('boat.rebuild', { tools: ['tool_hammer'] });
  owner.api.request('boat.rebuild', { id: 'boat-1' }, [['plank', 6]], true); await owner.api.flushPrivate();
  const id = owner.sent.find(m => m.op === 'command').command.id;
  host.context.NET.peers.set('phone', { ghost: { x: 1, y: 0, z: 1, level: 4 } });
  let stock = 0;
  host.api.register('stock', { save: () => stock, apply() {} });
  host.api.command('queued', { run: () => { stock++; return { ok: true }; } });
  const local = name => ({ t: 'activity', kind: 'worldparts', op: 'command', authority: 'token',
    worldAdmission: host.admission, from: 'phone', ownerAccount: 'phone-account', position: { x: 1, z: 1 },
    command: { id: name, op: 'queued', args: {}, goods: {}, capacity: 0 } });
  host.api.message(local('local-a')); host.tick(200);
  const older = host.sent.filter(m => m.op === 'snapshot'), awaiting = host.api.state.awaiting;
  assert.ok(awaiting); host.api.message(local('local-b'));
  const sequence = host.api.state.seq;
  const receipt = { t: 'activity', kind: 'worldparts', op: 'receipt', authority: 'token',
    worldAdmission: host.admission, id, ownerAccount: 'phone-account', to: 'phone', digest: 'server-rebuild',
    action: 'boat.rebuild', durable: true, ok: true, goods: [['plank', -6]], gold: 0, items: [], result: { boatId: 'boat-1' } };
  host.api.message({ ...receipt, authority: 'wrong' });
  host.api.message({ ...receipt, worldAdmission: { ...host.admission, origin: 'https://wrong.example' } });
  assert.equal(host.api.state.receipts.length, 2);
  host.api.message(receipt); host.api.message(receipt);
  assert.equal(host.api.state.seq, sequence); assert.equal(host.api.state.awaiting, awaiting);
  assert.equal(host.api.state.receipts.length, 3);
  assert.equal(host.api.state.receipts.find(r => r.id === id).action, 'boat.rebuild');
  assert.equal(host.api.state.receipts.find(r => r.id === id).op, undefined, 'transport fields cannot override later result relay');
  assert.equal(host.context.INV.gold, 900); assert.equal(host.context.INV.goods.stone, 20);
  owner.api.message({ t: 'activity', kind: 'worldparts', op: 'snapshot', authority: 'token',
    worldAdmission: owner.admission, ok: false, reason: 'checkpoint_unconfirmed' });
  owner.api.message({ ...receipt, digest: '' });
  owner.api.message({ ...receipt, authority: 'wrong' });
  assert.equal(owner.api.state.paused, 'checkpoint_unconfirmed');
  assert.equal(owner.context.INV.goods.plank, 4); assert.equal(owner.api.state.pending.size, 1);
  owner.api.message(receipt); await owner.api.flushPrivate();
  assert.equal(owner.api.state.paused, ''); assert.equal(owner.api.state.pending.size, 0);
  assert.equal(owner.context.INV.goods.plank, 4);
  owner.api.message(receipt); assert.equal(owner.context.INV.goods.plank, 4);
  for (const packet of older) host.api.message(packet);
  assert.equal(host.api.state.receipts.length, 3, 'the older acknowledgement cannot erase the injected or newer local outcome');
  assert.ok(host.api.state.resultQueue.has('phone-account:local-b'));
  host.sent.length = 0; host.tick(2000); host.tick(200);
  const packets = host.sent.filter(m => m.op === 'snapshot');
  const next = JSON.parse(packets.map(m => m.data).join(''));
  assert.deepEqual(next.receipts.map(r => r.id).sort(), ['local-a', 'local-b', id].sort());
  assert.equal(next.parts.stock, 2);
  for (const packet of packets) host.api.message(packet);
  assert.equal(host.api.state.awaiting, null); assert.equal(host.api.state.resultQueue.size, 0);
});

test('host command backpressure reserves one canonical receipt slot without evicting any owed outcome', () => {
  const host = client({ self: 'desktop', host: 'desktop', account: 'desktop-account' });
  let runs = 0; host.api.command('queued', { run: () => { runs++; return { ok: true }; } });
  for (let n = 0; n < 24; n++) host.api.message({ t: 'activity', kind: 'worldparts', op: 'command',
    authority: 'token', worldAdmission: host.admission, from: 'desktop', ownerAccount: 'desktop-account',
    position: { x: 0, z: 0 }, command: { id: 'local-' + n, op: 'queued', args: {}, goods: {}, capacity: 0 } });
  assert.equal(runs, 23); assert.equal(host.api.state.receipts.length, 23);
  host.api.message({ t: 'activity', kind: 'worldparts', op: 'receipt', authority: 'token',
    worldAdmission: host.admission, id: 'server-created', ownerAccount: 'another-account', digest: 'canonical',
    durable: true, ok: true, goods: [], items: [], gold: 0 });
  assert.equal(host.api.state.receipts.length, 24);
  assert.equal(host.api.state.receipts.filter(r => r.id.startsWith('local-')).length, 23);
});

test('server boat receipts settle reserved planks once for either keeper or follower and survive reload', async () => {
  for (const self of ['phone', 'desktop']) for (const ok of [true, false]) {
    const c = client({ self });
    c.context.GOODS.plank = { stack: 999 }; c.context.INV.goods.plank = 20;
    c.api.command('boat.rebuild', { durable: true, tools: ['tool_hammer'] });
    frame(c, { v: 1, full: true, parts: {}, remove: [], receipts: [] });
    c.api.request('boat.rebuild', { id: 1 }, [['plank', 6]], true);
    await c.api.flushPrivate();
    const request = c.sent.find(m => m.op === 'command');
    assert.equal(c.context.INV.goods.plank, 14);
    const receipt = { id: request.command.id, ownerAccount: 'phone-account', digest: 'server-hull-' + ok,
      durable: true, ok, goods: ok ? [['plank', -6]] : [], result: { boatId: 1 } };
    const packet = { t: 'activity', kind: 'worldparts', op: 'receipt', authority: 'token', worldAdmission: c.admission, ...receipt };
    const sequence = c.api.state.readSeq;
    c.api.message(packet); c.api.message(packet); await c.api.flushPrivate();
    assert.equal(c.context.INV.goods.plank, ok ? 14 : 20, 'only a successful hull consumes the reservation');
    assert.equal(c.api.state.receipts.length, 1, 'keepers retain the canonical server receipt for handoff');
    assert.equal(c.api.state.readSeq, sequence, 'a server outcome does not consume the keeper snapshot sequence');
    const saved = c.getPersisted();
    assert.equal(saved.char.x.sharedWorldReservations.settled[0].digest, receipt.digest);
    const restored = client({ self });
    restored.context.GOODS.plank = { stack: 999 };
    restored.context.INV.goods = structuredClone(saved.char.goods);
    restored.api.command('boat.rebuild', { durable: true, tools: ['tool_hammer'] });
    restored.api.journalLoad(saved.char.x.sharedWorldReservations);
    frame(restored, { v: 1, full: true, parts: {}, remove: [], receipts: [receipt] });
    restored.api.message({ ...packet, worldAdmission: restored.admission });
    assert.equal(restored.context.INV.goods.plank, ok ? 14 : 20, 'a replay after reload cannot charge or refund twice');
  }
});

function buildClient(options = {}, yaw = 0) {
  const c = client(options);
  const source = fs.readFileSync(new URL('../../src/06k_build.js', import.meta.url), 'utf8');
  const recipes = source.slice(source.indexOf('const BP = {'), source.indexOf('const BP_ORDER ='));
  const costHelpers = source.slice(source.indexOf('const bpCost ='), source.indexOf('/*', source.indexOf('const bpCost =')));
  const grid = source.slice(source.indexOf('const bW ='), source.indexOf('function bMakePiece('));
  const place = source.slice(source.indexOf('function buildPlace('), source.indexOf('// raise a piece:'));
  const commands = source.slice(source.lastIndexOf('queueMicrotask(() => {'));
  Object.assign(c.context, {
    CAM: { yaw }, BUILD: { pieces: [], next: 1, work: null },
    B_C: 3, B_WH: 2.8, B_REACH: 12, B_MAX: 220,
    DUN_X0: 1000, WATER_Y: -1, SITES: [], CAMPS: [],
    BARROW: { x: 100, z: 100, r: 1 }, W: { road: {} }, FX: { burst() {} },
    heightAt: () => 0, floorAt: () => 0, waterAt: () => null,
    plotAt: () => null, houseAt: () => null,
    zoneAt: () => ({ kind: 'home', realm: 0 }),
    sampleGrid: (_grid, x) => x > 3.8 ? 1 : 0,
    dist2: (x, z, a, b) => (x-a)**2 + (z-b)**2,
    dist: (x, z, a, b) => Math.hypot(x-a, z-b),
    collidersNear(_x, _z, _r, out) { out.length = 0; },
    collCovers: () => false, houseSfx() {}, bApplyState() {},
    queueMicrotask: callback => callback(),
  });
  Object.assign(c.context.GAME.player, { faction: 0, yaw: 0 });
  c.context.GOODS.plank = { stack: 999 }; c.context.INV.goods.plank = 20;
  c.context.bMakePiece = data => {
    const pc = { ...data, id: c.context.BUILD.next++ };
    c.context.BUILD.pieces.push(pc);
    return pc;
  };
  vm.runInContext(recipes + costHelpers + grid + place + commands + '\n'
    + "globalThis.buildApi={snap:bSnap,validate:bValidate,place:buildPlace};", c.context);
  return c;
}

test('follower construction uses builder view and preserves keeper camera and private inventory', async () => {
  const follower = buildClient({}, 4*Math.PI);
  frame(follower, { v: 1, full: true, parts: {}, remove: [], receipts: [] });
  const keeper = buildClient({ self: 'desktop', host: 'desktop', account: 'desktop-account' }, Math.PI/4);
  const actor = { x: 0, y: 0, z: 0, faction: 0, yaw: 0, level: 17 };
  keeper.context.NET.peers.set('phone', { ghost: actor });
  const preview = follower.context.buildApi.validate(
    follower.context.buildApi.snap('found', 2, 0, 0, follower.context.GAME.player),
    follower.context.GAME.player);
  assert.equal(preview.ok, true);
  const wrong = keeper.context.buildApi.validate(
    keeper.context.buildApi.snap('found', 2, 0, 0, actor), actor);
  assert.equal(wrong.ok, false);
  assert.equal(wrong.why, 'Not on the road');
  assert.equal(follower.context.buildApi.place('found', 2, 0, 0).pending, true);
  await follower.api.flushPrivate();
  const request = follower.sent.find(m => m.op === 'command');
  assert.ok(Number.isFinite(request.command.args.viewYaw));
  assert.ok(Math.abs(request.command.args.viewYaw) <= Math.PI);
  keeper.api.message({ ...request, from: 'phone', ownerAccount: 'phone-account',
    position: { x: 0, z: 0 }, realm: 0 });
  assert.equal(keeper.api.state.receipts.at(-1).ok, true);
  const pc = keeper.context.BUILD.pieces[0];
  assert.ok(pc, 'the actual authoritative build.place command created a foundation');
  assert.ok(Math.abs(Math.atan2(Math.sin(pc.yaw-preview.yaw),
    Math.cos(pc.yaw-preview.yaw))) < 1e-12, 'canonical grid matches the builder preview');
  assert.equal(keeper.context.CAM.yaw, Math.PI/4);
  assert.equal(keeper.context.INV.goods.stone, 20);
  assert.equal(keeper.context.INV.goods.plank, 20);
});

test('standalone placement retains default camera yaw and build commands reject malformed orientation', () => {
  const standalone = buildClient({}, Math.PI/6);
  standalone.context.NETWS.url = '';
  standalone.context.sampleGrid = () => 0;
  const placed = standalone.context.buildApi.place('found', 2, 0, 1);
  assert.equal(placed.ok, true);
  assert.ok(Math.abs(placed.pc.yaw - Math.PI/4) < 1e-12);
  assert.equal(standalone.context.CAM.yaw, Math.PI/6);
  const keeper = buildClient({ self: 'desktop', host: 'desktop' }, Math.PI/4);
  keeper.context.NET.peers.set('phone', {
    ghost: { x: 0, y: 0, z: 0, faction: 0, yaw: 0, level: 17 } });
  for (const [i, viewYaw] of [undefined, null, '0', NaN, Infinity, -Math.PI-0.01, Math.PI+0.01].entries()) {
    keeper.api.message({ t: 'activity', kind: 'worldparts', op: 'command', authority: 'token',
      worldAdmission: keeper.admission, from: 'phone', ownerAccount: 'phone-account',
      position: { x: 0, z: 0 }, command: { id: 'bad-yaw-'+i, op: 'build.place',
        args: { t: 'found', x: 2, z: 0, rot: 0, viewYaw },
        goods: { stone: 6, plank: 4, tool_hammer: 1 }, capacity: 0 } });
    assert.equal(keeper.api.state.receipts.at(-1).ok, false);
    assert.equal(keeper.api.state.receipts.at(-1).reason, 'Invalid building orientation.');
  }
  assert.equal(keeper.context.BUILD.pieces.length, 0);
  assert.equal(keeper.context.CAM.yaw, Math.PI/4);
});

test('a delayed debit holds all owner rewards until the declared goods can be paid atomically', async () => {
  const c = client(); frame(c, { v: 1, full: true, parts: {}, remove: [] });
  c.api.command('resource.consume', { tools: ['privateGem'] });
  c.api.request('resource.consume', {}, []); await c.api.flushPrivate();
  const id = c.sent.find(m => m.op === 'command').command.id;
  c.context.INV.goods.privateGem = 0;
  const receipt = { t: 'activity', kind: 'worldparts', op: 'result', authority: 'token',
    worldAdmission: c.admission, id, ownerAccount: 'phone-account', digest: 'delayed-debit',
    ok: true, goods: [['privateGem', -1]], gold: 3 };
  c.api.message(receipt);
  assert.equal(c.context.INV.gold, 900); assert.equal(c.api.state.pending.get(id).phase, 'reserved');
  c.context.INV.goods.privateGem = 1; c.tick(200); await c.api.flushPrivate();
  assert.equal(c.context.INV.goods.privateGem, 0); assert.equal(c.context.INV.gold, 903);
  assert.equal(c.api.state.pending.size, 0);
  c.api.message(receipt); assert.equal(c.context.INV.gold, 903);
});

test('durable reservations normalize optional arguments to the exact JSON save and wire command', async () => {
  const c = client(); frame(c, { v: 1, full: true, parts: {}, remove: [], receipts: [] });
  c.api.command('farm.job', { durable: true });
  const args = { kind: 'till', plot: null, slot: undefined, gid: undefined, herb: undefined };
  c.api.request('farm.job', args, [['stone', 2]]);
  args.kind = 'mutated after reservation';
  await c.api.flushPrivate();
  const requests = c.sent.filter(m => m.op === 'command');
  assert.equal(requests.length, 1, 'native readback confirms optional fields before dispatch');
  assert.deepEqual(requests[0].command.args, { kind: 'till', plot: null });
  const pending = c.api.state.pending.get(requests[0].command.id);
  assert.equal(pending.privateConfirmed, true);
  assert.deepEqual(JSON.parse(JSON.stringify(pending.args)), { kind: 'till', plot: null });
  const saved = c.getPersisted().char.x.sharedWorldReservations.pending[0];
  assert.deepEqual(saved.args, requests[0].command.args);
  assert.equal(c.context.INV.goods.stone, 18, 'materials are reserved exactly once');
});

test('an unserializable action cannot reserve materials or enter the private journal', () => {
  const c = client(); frame(c, { v: 1, full: true, parts: {}, remove: [], receipts: [] });
  const args = { kind: 'till' }; args.circular = args;
  assert.equal(c.api.request('farm.job', args, [['stone', 2]]), true);
  assert.equal(c.context.INV.goods.stone, 20);
  assert.equal(c.api.state.pending.size, 0);
  assert.equal(c.sent.some(m => m.op === 'command'), false);
});


test('retired snapshot refusals cannot pause a resumed worldparts publisher', () => {
  const c = client({ self: 'desktop', host: 'desktop' });
  c.api.register('build', { save: () => ({ v: 1, p: [] }), apply() {} });
  c.tick(2000);
  const oldAdmission = c.admission;
  const admission = { ...oldAdmission, epoch: oldAdmission.epoch + 1 };
  c.api.message({ t: 'activity', kind: 'authority', authority: 'resumed-token',
    peer: 'desktop', worldAdmission: admission, worldpartsReady: false });
  c.tick(2000);
  const awaiting = c.api.state.awaiting;
  assert.ok(awaiting, 'the resumed publisher has a current snapshot awaiting confirmation');
  const refused = c.api.state.refused;
  for (const scope of [
    { authority: 'token', worldAdmission: admission },
    { authority: 'resumed-token', worldAdmission: oldAdmission },
  ]) {
    c.api.message({ t: 'activity', kind: 'worldparts', op: 'snapshot',
      ...scope, ok: false, reason: 'stale_authority' });
    assert.equal(c.api.state.paused, '');
    assert.equal(c.api.state.awaiting, awaiting);
    assert.equal(c.api.state.refused, refused);
    assert.equal(c.api.canSim(), true);
  }
});

test('current capacity and native checkpoint refusals still fence worldparts publication', () => {
  for (const reason of ['scene_capacity', 'world_checkpoint_unconfirmed']) {
    const c = client({ self: 'desktop', host: 'desktop' });
    c.api.register('build', { save: () => ({ v: 1, p: [] }), apply() {} });
    c.tick(2000);
    assert.ok(c.api.state.awaiting);
    c.api.message({ t: 'activity', kind: 'worldparts', op: 'snapshot',
      authority: 'token', worldAdmission: c.admission, ok: false, reason });
    assert.equal(c.api.state.paused, reason);
    assert.equal(c.api.state.awaiting, null);
    assert.equal(c.api.state.outbox, null);
    assert.equal(c.api.state.refused, 1);
    assert.equal(c.api.canSim(), false);
    const sent = c.sent.length;
    c.tick(10000);
    assert.equal(c.sent.length, sent, 'polling cannot clear or retry through the current fence');
    assert.equal(c.api.state.paused, reason);
  }
});

