import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';

const moduleSource = fs.readFileSync(new URL('../../src/14z_networldparts.js', import.meta.url), 'utf8');
function client({ self = 'phone', host = 'desktop', account = 'phone-account' } = {}) {
  let clock = 1000;
  const sent = [], loaded = [];
  const context = {
    console, Map, Set, JSON, Math, Number, Object, Array, Infinity,
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
  vm.createContext(context);
  vm.runInContext(moduleSource + '\nglobalThis.api={state:NETPARTS,register:netWorldPartsRegister,command:netWorldPartsRegisterCommand,message:netWorldPartsMessage,pump:netWorldPartsPump,request:netWorldPartsRequest,publish:netWorldPartsPublish,apply:netWorldPartsApply,canSim:netWorldPartsCanSimulate,reset:netWorldPartsReset};', context);
  const admission = { origin: 'https://game.example', epoch: 3 };
  context.api.message({ t: 'activity', kind: 'authority', authority: 'token', peer: host, worldAdmission: admission, worldpartsReady: false });
  return { context, api: context.api, sent, loaded, admission, tick: ms => { clock += ms; context.api.pump(clock); } };
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
  const full = JSON.parse(first.map(m => m.data).join('')); assert.equal(full.full, true);
  c.sent.length = 0; building = 'changed'; c.tick(2000); c.tick(200);
  const delta = JSON.parse(c.sent.filter(m => m.op === 'snapshot').map(m => m.data).join(''));
  assert.equal(delta.full, false); assert.deepEqual(Object.keys(delta.parts), ['build']);
});

test('command reserves only recipe costs and borrows tools without sending other inventory', () => {
  const c = client();
  c.api.command('build.place', { tools: ['tool_hammer'] });
  frame(c, { v: 1, full: true, parts: {}, remove: [] });
  assert.equal(c.api.request('build.place', { x: 1 }, [['stone', 6]]), true);
  assert.equal(c.context.INV.goods.stone, 14);
  const command = c.sent.find(m => m.op === 'command').command;
  assert.deepEqual(command.goods, { stone: 6, tool_hammer: 1 });
  assert.equal(command.goods.privateGem, undefined);
  c.api.message({ t: 'activity', kind: 'worldparts', op: 'result', authority: 'token',
    worldAdmission: c.admission, id: command.id, to: 'phone', ownerAccount: 'phone-account', ok: true, goods: [['stone', -6]] });
  assert.equal(c.context.INV.goods.stone, 14);
  assert.equal(c.context.INV.goods.privateGem, 4);
});

test('refused command refunds once and receipt replay cannot duplicate refund', () => {
  const c = client(); frame(c, { v: 1, full: true, parts: {}, remove: [] });
  c.api.request('build.place', {}, [['stone', 6]]);
  const id = c.sent.find(m => m.op === 'command').command.id;
  const result = { t: 'activity', kind: 'worldparts', op: 'result', authority: 'token',
    worldAdmission: c.admission, id, to: 'phone', ownerAccount: 'phone-account', ok: false };
  c.api.message(result); c.api.message(result);
  assert.equal(c.context.INV.goods.stone, 20);
});

test('cached receipt resolves an interrupted command after peer changes without reserving again', () => {
  const c = client(); frame(c, { v: 1, full: true, parts: {}, remove: [] });
  c.api.request('build.place', {}, [['stone', 6]]);
  const id = c.sent.find(m => m.op === 'command').command.id;
  c.api.reset(); c.context.NET.self = 'phone-new';
  c.api.message({ t: 'activity', kind: 'authority', authority: 'new-token', peer: 'desktop',
    worldAdmission: c.admission, worldpartsReady: true });
  c.api.message({ t: 'activity', kind: 'worldparts', op: 'snapshot', authority: 'new-token',
    worldAdmission: c.admission, seq: 1, part: 0, total: 1,
    data: JSON.stringify({ v: 1, full: true, parts: {}, remove: [], receipts: [
      { id, ownerAccount: 'phone-account', to: 'phone', ok: true, goods: [['stone', -6]] }] }) });
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
