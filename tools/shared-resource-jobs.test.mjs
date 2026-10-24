import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read = path => fs.readFileSync(new URL(path, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const world = read('../src/14z_networldparts.js');
const craft = read('../src/09t_craft.js'), depth = read('../src/09u_depth.js');
const segment = (s, from, to) => { const a = s.indexOf(from), b = s.indexOf(to, a); assert.ok(a >= 0 && b > a); return s.slice(a, b) + '\n'; };
const copy = x => JSON.parse(JSON.stringify(x));
function scene() {
  let tick = 5000;
  const sent = [], hostGoods = { tool_pick: 1, sentinel: 77 }, hostBag = [];
  const host = { id: 1, role: 'player', name: 'host', x: 0, z: 0, alive: true };
  const peers = new Map(['alice', 'bob'].map((name, i) => [name, { ghost: { id: 10 + i, role: 'remote', x: 0, z: 0, alive: true, level: 10, look: { mask: 0 } } }]));
  const inventory = { goods: hostGoods, gold: 100, bag: hostBag };
  const math = Object.create(Math); math.random = () => .1;
  const ctx = vm.createContext({
    Math: math, Number, Object, Array, Map, Set, JSON, console,
    queueMicrotask: () => {}, performance: { now: () => 5000 },
    NETWS: { url: 'wss://march.example', state: 'on', acct: { id: 'account-host' } },
    NET: { self: 'host', peers }, GAME: { player: host, prog: { level: 10 }, t: 100 },
    INV: inventory, BAG_SIZE: 24, GOODS_UI: {}, BUILD: { work: { private: 'host-work' } },
    GOODS: Object.fromEntries(['tool_pick', 'tool_axe', 'tool_knife', 'stone', 'flint', 'iron_ore', 'firewood', 'stick', 'fibre', 'egg'].map(id => [id, { stack: 9999 }])),
    W: { rocks: [{ x: 1, z: 1, y: 15, s: 1 }], rock: {}, trees: [] },
    CRAFT: { rocks: new Map([[0, { n: 1, until: 0 }]]) },
    DEPTH: { job: { private: 'host-depth-work' }, grub: new Set(), nests: [], stats: { grubbed: 0, cutBushes: 0 } },
    FORAGE: { list: [], dirty: false }, NATURE: { felled: [], dyn: [], speed: 1 },
    DP_REGROW: { bush: 480 }, FORAGE_KINDS: { bush: { regrow: 400 } }, WB: { torch: 16 },
    netOn: () => true, netHumanLive: () => true, netSharedWorldReady: () => true,
    netWorldAdmissionRead: x => x, netSameWorldAdmission: (a, b) => a?.origin === b?.origin && a?.epoch === b?.epoch,
    netWsSend: m => { sent.push(copy(m)); return true; }, clamp: (x, a, b) => Math.max(a, Math.min(b, x)),
    sampleGrid: () => 1, uiLog: () => {}, uiError: () => {}, sfx: () => {}, saveSoon: () => {},
    activityRecord: () => {}, reportError: e => { throw e; }, goodName: id => id,
    dpDugEarth: () => {}, natShowRegular: (t, value) => { t.shown = value; },
    dpStanding: p => !p.gone && !p.cut && !(p.fire > 0) && (p.char || 0) < .5 && (p.grow ?? 1) > .6,
    dpFell: p => { p.cut = true; p.log = true; }, dpSplitApple: p => { p.log = false; },
    dpIgnite: p => { if (p.fire || p.gone) return false; p.fire = .15; return true; },
    loreNote: () => {}, addGold: n => { inventory.gold += n; }, bagAdd: item => inventory.bag.push(item),
  });
  Object.assign(ctx, {
    goodsHave: id => (inventory.goods[id] || 0) > 0,
    goodsAdd: (id, n) => { inventory.goods[id] = (inventory.goods[id] || 0) + n; return n; },
    goodsTake: (id, n) => { inventory.goods[id] = Math.max(0, (inventory.goods[id] || 0) - n); },
    goodsTakeAll: cost => { for (const [id, n] of cost) if ((inventory.goods[id] || 0) < n) return false; for (const [id, n] of cost) inventory.goods[id] -= n; return true; },
    skillGain: (key, amount) => { if (ctx.api?.NETPARTS.replay) ctx.api.NETPARTS.skills.push([key, amount]); },
  });
  vm.runInContext(world + '\nglobalThis.api = { NETPARTS, NETPART_COMMANDS, netWorldPartsExecute, netWorldPartsMessage, netWorldPartsPump };', ctx);
  ctx.queueMicrotask = fn => fn();
  vm.runInContext(segment(craft, 'function mineYield', '\nfunction stepRocks') + craft.slice(craft.lastIndexOf('\nqueueMicrotask(() => {')), ctx);
  vm.runInContext("const dpAxe = () => goodsHave('tool_axe'); const dpPick = () => goodsHave('tool_pick'); const dpKnife = () => goodsHave('tool_knife');\n"
    + segment(depth, 'function dpWorkPoint', '\nfunction dpFell')
    + segment(depth, 'function dpGrubTree', '// fire spells, brands')
    + segment(depth, 'function dpNestId', '\nfunction depthAnimalOffers')
    + depth.slice(depth.lastIndexOf('\nqueueMicrotask(() => {')), ctx);
  Object.assign(ctx.api.NETPARTS, { authority: 'lease', peer: 'host', ready: true, admission: { origin: 'https://march.example', epoch: 1 } });
  return { ctx, sent, host, hostGoods, hostBag, inventory,
    requester(name, goods = {}) { ctx.NET.self = name; ctx.NETWS.acct.id = 'account-' + name; ctx.GAME.player = { id: name, x: 0, z: 0, alive: true }; inventory.goods = goods; inventory.gold = 0; inventory.bag = []; return goods; },
    execute(packet, name) { ctx.NET.self = 'host'; ctx.NETWS.acct.id = 'account-host'; ctx.GAME.player = host; inventory.goods = hostGoods; inventory.gold = 100; inventory.bag = hostBag; ctx.api.netWorldPartsExecute({ command: packet.command, from: name, ownerAccount: 'account-' + name, position: { x: 0, z: 0 } });
      const offset = sent.length; ctx.api.netWorldPartsPump(tick += 200);
      for (const frame of sent.slice(offset).filter(m => m.op === 'snapshot')) ctx.api.netWorldPartsMessage({ ...frame, peer: 'host' });
    },
    requests() { return sent.filter(x => x.kind === 'worldparts' && x.op === 'command'); },
    results() { return sent.filter(x => x.kind === 'worldparts' && x.op === 'result'); },
  };
}

test('concurrent follower mining consumes the final shared yield once and only receipts award its owner', () => {
  const s = scene();
  const alice = s.requester('alice', { tool_pick: 1 }); s.ctx.mineYield(0, true);
  const bob = s.requester('bob', { tool_pick: 1 }); s.ctx.mineYield(0, true);
  assert.equal(s.ctx.CRAFT.rocks.get(0).n, 1, 'followers cannot deplete their own copy');
  assert.equal(alice.stone, undefined); assert.equal(bob.stone, undefined);
  const requests = s.requests();
  assert.equal(requests.length, 2); assert.deepEqual(requests[0].command.goods, { tool_pick: 1 });
  s.execute(requests[0], 'alice'); s.execute(requests[1], 'bob');
  const results = s.results(); assert.equal(results[0].ok, true); assert.equal(results[1].ok, false);
  assert.equal(s.ctx.CRAFT.rocks.get(0).n, 0); assert.equal(s.ctx.CRAFT.rocks.get(0).until, 1000);
  assert.deepEqual(s.hostGoods, { tool_pick: 1, sentinel: 77 });
  s.requester('alice', alice); s.ctx.api.netWorldPartsMessage(results[0]);
  assert.equal(alice.stone, 3); assert.equal(alice.iron_ore, 2); assert.equal(bob.stone, undefined);
  assert.deepEqual(results[0].skills, [['craft', .3]]);
});

test('a requested pick-assisted yield cannot use the host pick when the requester did not declare one', () => {
  const s = scene(); s.requester('alice', {}); s.ctx.mineYield(0, true);
  const request = s.requests()[0]; assert.deepEqual(request.command.goods, {});
  s.execute(request, 'alice'); assert.equal(s.results()[0].ok, false);
  assert.equal(s.ctx.CRAFT.rocks.get(0).n, 1); assert.deepEqual(s.hostGoods, { tool_pick: 1, sentinel: 77 });
});

test('concurrent grubbing is serialized, declares the actual tool and preserves the host private job', () => {
  const s = scene(), stump = { i: 0, x: 1, z: 1, kind: 'oak', felled: true, log: false, fall: { done: true }, coll: { active: true } };
  s.ctx.W.trees.push(stump); s.ctx.NATURE.felled.push(stump); s.ctx.NATURE.dyn.push(stump);
  for (const name of ['alice', 'bob']) { s.requester(name, { tool_pick: 1 }); s.ctx.dpWorkFinish({ kind: 'grub', t: stump }); }
  assert.equal(stump.grubbed, undefined);
  s.ctx.DEPTH.job = { private: 'host-depth-work' };
  const requests = s.requests(); s.execute(requests[0], 'alice'); s.execute(requests[1], 'bob');
  assert.deepEqual(requests[0].command.goods, { tool_pick: 1 });
  assert.equal(s.results()[0].ok, true); assert.equal(s.results()[1].ok, false);
  assert.equal(stump.grubbed, true); assert.equal(stump.coll.active, false);
  assert.equal(s.ctx.DEPTH.job.private, 'host-depth-work');
  assert.deepEqual(s.hostGoods, { tool_pick: 1, sentinel: 77 });
  assert.deepEqual(s.results()[0].goods, [['firewood', 1], ['stick', 2]]);
});

test('quiet canonical stump restoration changes public geometry without awarding goods', () => {
  const s = scene(), stump = { i: 0, x: 1, z: 1, kind: 'oak', coll: { active: true } };
  s.ctx.dpGrubTree(stump, true);
  assert.equal(stump.grubbed, true); assert.equal(stump.coll.active, false);
  assert.deepEqual(s.hostGoods, { tool_pick: 1, sentinel: 77 }); assert.equal(s.ctx.DEPTH.stats.grubbed, 0);
});

test('nest identity survives serialization and two followers cannot both claim the same eggs', () => {
  const s = scene(), nest = { x: 1, z: 1, ma: { aid: 'hen-a' }, seed: .123, eggs: 4, owner: 'player' };
  s.ctx.DEPTH.nests.push(nest);
  s.requester('alice', {}); s.ctx.depthNestTake(nest); const id = nest.id;
  s.requester('bob', {}); s.ctx.depthNestTake(nest);
  assert.equal(s.ctx.dpNestId(copy(nest)), id); assert.equal(nest.eggs, 4);
  const requests = s.requests(); s.execute(requests[0], 'alice'); s.execute(requests[1], 'bob');
  assert.equal(s.results()[0].ok, true); assert.equal(s.results()[1].ok, false);
  assert.equal(s.ctx.DEPTH.nests.length, 0); assert.deepEqual(s.results()[0].goods, [['egg', 4]]);
});

test('brand ignition is deferred without a false local failure and needs the requester held brand', () => {
  const s = scene(), plant = { i: 0, k: 'bush', x: 1, z: 1, fire: 0 };
  s.ctx.FORAGE.list.push(plant); s.ctx.setAct = () => {};
  s.requester('alice', {});
  assert.equal(s.ctx.dpPlayerIgnite(plant), null); assert.equal(plant.fire, 0);
  s.execute(s.requests()[0], 'alice'); assert.equal(s.results()[0].ok, false);
  s.ctx.NET.peers.get('alice').ghost.look.mask = 16;
  s.requester('alice', {}); s.ctx.dpPlayerIgnite(plant);
  s.execute(s.requests()[1], 'alice'); assert.equal(s.results()[1].ok, true); assert.equal(plant.fire, .15);
});
