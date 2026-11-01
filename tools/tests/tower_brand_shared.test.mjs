import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import vm from 'node:vm';
import { createSharedScene } from '../../server/shared-scene.js';

const read = name => readFileSync(new URL('../../src/' + name, import.meta.url), 'utf8');
const transport = read('14z_networldparts.js');
const clone = value => JSON.parse(JSON.stringify(value));
function extract(text, name) {
  const at = text.indexOf('function ' + name + '(');
  assert.ok(at >= 0, name);
  return text.slice(at, text.indexOf('\n}', at) + 2);
}
function fixture() {
  let clock = 100000, mutable = true, host = 'a';
  const admission = { origin: 'https://march.test', epoch: 1 }, room = { clients: new Map(), name: 'march' }, state = {};
  const up = [], down = [], forwarded = [], accepted = [], peers = new Map();
  const client = id => ({ peer: id, room, live: true, slow: { r: 0 }, acct: { id: 'owner-' + id },
    pos: { x: 3.1, z: 0 }, posT: clock, worldAdmission: admission, fast: { p: [3.1, 2, 0], d: 0, fl: 2, a: 0 } });
  const scene = createSharedScene({ hostFor: () => room.clients.get(host), live: c => c.live,
    admission: () => admission, stateFor: () => state, canMutate: () => mutable, changed() {}, now: () => clock,
    send: (c, m) => { const packet = clone(m); down.push({ id: c.peer, packet }); if (m.op === 'command') forwarded.push(packet); } });
  function add(id) {
    const c = client(id), player = { alive: true, faction: 0, level: 1, x: id === 'a' ? 1000 : 3.1, y: 2, z: 0,
      brand: { until: 340 }, motion: null, carrying: null };
    room.clients.set(id, c);
    const C = { S: { yaw: 0 } }, S = { name: 'Test tower', x: 0, z: 0, y: 0 };
    const towers = ['timber', 'rath', 'stone'].map((look, i) => ({ look, S, wx: i * 20, wz: 0, HO: 3, HI: 2, RO: 3, TT: 8, apex: 14,
      ladders: [], topFloors: [], topColls: [], C, burn: null, fallen: null, char: 0, fresh: 0, heap: { visible: false } }));
    const microtasks = [], parts = {}, errors = [], publications = [];
    const scope = vm.createContext({ GAME: { started: true, t: 100, player, prog: { level: 1 } }, TOWER: { list: towers, keeps: [] },
      NETWS: { url: 'wss://march.test', state: 'on', acct: { id: c.acct.id } }, NET: { self: id, peers: new Map(), fastAt: 0, fastKey: '' },
      SAVE: { ref: {}, wiping: false }, INV: { goods: {}, gold: 0, bag: [] }, GOODS: {}, GOODS_UI: {}, BAG_SIZE: 40,
      performance: { now: () => clock }, crypto: { randomUUID }, window: {},
      queueMicrotask: fn => microtasks.push(fn), registerSavePart: (area, key, part) => { parts[key] = part; },
      clamp: (v, lo, hi) => Math.max(lo, Math.min(v, hi)), dist2: (x, z, a, b) => (x - a) ** 2 + (z - b) ** 2,
      dist: (x, z, a, b) => Math.hypot(x - a, z - b), twLocal: (T, x, z) => ({ x: x - T.wx, z: z - T.wz }),
      netOn: () => true, netHumanLive: () => c.live, netSharedWorldReady: () => true,
      netWorldAdmissionRead: value => value && value.origin === admission.origin && value.epoch === admission.epoch ? value : null,
      netWsSend: packet => { up.push({ id, packet: clone(packet) }); return true; },
      netSendFast: () => { publications.push('pose'); c.fast = { p: [player.x, player.y, player.z], d: player.alive ? 0 : 1, fl: player.brand ? 2 : 0, a: player.motion ? 14.5 : 0 };
        c.pos = { x: player.x, z: player.z }; c.posT = clock; },
      goodsHave: () => false, goodsTakeAll: () => true, goodsAdd() {}, goodsTake() {}, bagAdd() {}, addGold() {},
      loreNote() {}, skillGain() {}, saveSoon() {}, uiError: value => errors.push(value), reportError: error => { throw error; },
      sfx() {}, sfxAt() {}, uiLog() {}, brandTargetFrom: () => null, putOutBrand() {}, inDungeon: () => false,
      REALMS: [{ name: 'Test realm', town: { x: 500, z: 500 }, musterSite: { x: 500, z: 500 } }], WAR: { relics: [] }, BARROW: { door: null },
      houseOffers() {}, wearOffers() {}, natureOffers() {}, siegeOffers() {}, waterOffers() {}, hallOffers() {}, buildOffers() {},
      survivalOffers() {}, farmOffers() {}, animalOffers() {}, depthOffers() {}, late2Offers() {}, loopsOffers() {},
      palisadeFireOffers() {}, look3LadderOffers() {}, blazeOffers() {},
    });
    const prefix = transport.slice(0, transport.indexOf('\nqueueMicrotask(() => {'));
    const helpers = ['netWorldPartsDispatch', 'netWorldPartsSendSettled', 'netWorldPartsConfirmSettled', 'netWorldPartsTakeSettled', 'netWorldPartsPruneReceipts']
      .map(name => extract(transport, name)).join('\n');
    const interaction = [['09_player.js', 'currentInteraction'], ['09_player.js', 'playerInteract'], ['09d_brand.js', 'brandOffers'], ['04l_towers.js', 'towerOffers']]
      .map(([file, name]) => extract(read(file), name)).join('\n');
    vm.runInContext(prefix + '\n' + helpers + '\n' + read('04n_towerfire.js') + '\n' + interaction + '\n'
      + transport.slice(transport.indexOf('// Tower brand commands'))
      + '\nglobalThis.testHooks = { NETPARTS, NETPART_COMMANDS, TFIRE, netWorldPartsMessage, netWorldPartsPump, netWorldPartsPublish, netWorldPartsApply, towerBrandIgnite, currentInteraction, playerInteract };', scope);
    for (const fn of microtasks) fn();
    scope.NETPART_ADAPTERS?.set('towerfire', { save: parts.towerfire.save, apply: parts.towerfire.load });
    // Maps declared with const are reached through an explicit local setup.
    scope.part = parts.towerfire;
    vm.runInContext("NETPART_ADAPTERS.set('towerfire', {save:()=>part.save(), apply:value=>part.load(value)});", scope);
    const peer = { id, c, scope, player, towers, part: parts.towerfire, errors, publications, ...scope.testHooks };
    peers.set(id, peer); return peer;
  }
  const a = add('a'), b = add('b');
  function drain() {
    let steps = 0;
    while (up.length || down.length) {
      if (++steps > 1000) throw Error('Unexpected command/snapshot loop');
      if (up.length) {
        const entry = up.shift(); accepted.push({ ...entry, ok: scene.handle(peers.get(entry.id).c, entry.packet) });
      } else {
        const entry = down.shift(); peers.get(entry.id)?.netWorldPartsMessage(entry.packet);
      }
    }
  }
  const pump = () => { clock += 200; for (const p of peers.values()) p.netWorldPartsPump(clock); drain(); };
  scene.sync(room); drain(); a.netWorldPartsPublish(clock, true); pump();
  assert.equal(a.NETPARTS.ready, true); assert.equal(b.NETPARTS.ready, true);
  const direct = (command, more = {}) => scene.handle(b.c, { t: 'activity', kind: 'worldparts', op: 'command', authority: b.NETPARTS.authority,
    worldAdmission: admission, command, ...more });
  const command = (args = { id: 0 }) => ({ id: 'b:' + randomUUID(), op: 'tower.brand', args, goods: {}, capacity: 0 });
  return { a, b, scene, state, peers, up, down, forwarded, accepted, add, pump, drain, direct, command, admission,
    tick(ms) { clock += ms; }, fresh() { b.c.posT = clock; }, mutable(value) { mutable = value; },
    host(value) { host = value; scene.sync(room); drain(); } };
}

test('real follower E interaction routes once through the server and a distant keeper, then converges for both peers and a late joiner', () => {
  const f = fixture();
  assert.equal(f.a.scope.NET.peers.size, 0, 'keeper has no rendered ghost of the distant caller');
  assert.equal(f.b.currentInteraction().label, 'Set the tower alight');
  f.tick(7000); f.b.c.fast.fl = 0; // unchanged/stale pose before the human E action
  f.b.playerInteract();
  assert.equal(f.b.towers[0].burn, null, 'follower must not predict a world mutation');
  assert.deepEqual(f.b.publications, ['pose']);
  f.drain();
  assert.ok(f.a.towers[0].burn, 'elected keeper executed the admitted command');
  assert.equal(f.b.towers[0].burn, null, 'caller waits for the canonical snapshot');
  assert.equal(f.a.TFIRE.stats.lit, 1); f.pump();
  assert.ok(f.b.towers[0].burn); assert.equal(f.b.NETPARTS.pending.size, 0);
  assert.deepEqual(clone(f.b.part.save()), clone(f.a.part.save()));
  const c = f.add('c'); f.scene.sync(f.b.c.room, c.c); f.drain();
  assert.deepEqual(clone(c.part.save()), clone(f.a.part.save()));
  assert.equal(JSON.stringify(f.state).includes('actorState'), false, 'transient caller equipment never enters retained world data');
});

test('retry preserves the first admitted pose and command identity and cannot ignite twice', () => {
  const f = fixture(); f.b.playerInteract(); const original = clone(f.up[0].packet.command);
  f.drain(); f.pump(); const first = f.forwarded[0], saved = clone(f.a.part.save());
  f.tick(3100); f.b.c.pos = { x: 100, z: 100 }; f.b.c.fast = { p: [100, 400, 100], fl: 0, d: 1, a: 0 }; f.fresh();
  assert.equal(f.direct(original, { actorState: { alive: true, brand: true, y: -200, motion: null } }), true);
  f.drain(); f.pump();
  assert.deepEqual(f.forwarded.at(-1).position, first.position); assert.deepEqual(f.forwarded.at(-1).actorState, first.actorState);
  assert.equal(f.a.TFIRE.stats.lit, 1); assert.deepEqual(clone(f.a.part.save()), saved);
  assert.equal(f.b.NETPARTS.pending.size, 0);
});

test('server ignores forged actorState, rejects shape/equipment/dead/climbing and stale lease or authority', () => {
  const cases = [
    f => { f.b.c.fast.fl = 0; }, f => { f.b.c.fast.d = 1; }, f => { f.b.c.fast.a = 14.2; },
    f => { f.b.c.fast.a = 18.2; }, f => { f.b.c.fast.p[1] = 501; }, f => { f.b.c.fast = null; },
    f => { f.tick(6000); }, f => { f.b.c.live = false; },
  ];
  for (const change of cases) {
    const f = fixture(); change(f);
    assert.equal(f.direct(f.command(), { actorState: { alive: true, brand: true, y: 2, motion: null } }), false);
    f.drain(); assert.equal(f.forwarded.length, 0); assert.equal(f.a.towers[0].burn, null);
  }
  const f = fixture();
  for (const args of [{ id: 0, y: 2 }, { id: 0, brand: true }, { id: '0' }, { id: -1 }, { id: 512 }, null]) assert.equal(f.direct(f.command(args)), false);
  assert.equal(f.direct(f.command(), { authority: 'retired' }), false);
  assert.equal(f.direct(f.command(), { worldAdmission: { origin: f.admission.origin, epoch: 2 } }), false);
  f.mutable(false); assert.equal(f.direct(f.command()), false);
  assert.equal(f.a.towers[0].burn, null);
});

test('keeper validates current target and exact surface/height rather than trusting a valid command envelope', () => {
  for (const change of [
    f => { f.b.c.pos.x = 100; },
    f => { f.b.c.pos.x = 0; }, // centre of the tower is not within arm reach of its wall
    f => { f.b.c.fast.p[1] = 20; },
    f => { f.a.towers[0].fallen = { r: 0 }; },
    f => { f.a.towers[0].look = 'stone'; },
  ]) {
    const f = fixture(); change(f); assert.equal(f.direct(f.command()), true); f.drain(); f.pump();
    assert.equal(f.a.towers[0].burn, null); assert.equal(f.a.TFIRE.stats.lit, 0);
  }
  const f = fixture(); assert.equal(f.direct(f.command({ id: 511 })), true); f.drain();
  assert.equal(f.a.TFIRE.stats.lit, 0);
});

test('rath thatch requires the caller to stand at the platform height and converges after acceptance', () => {
  const f = fixture(); f.b.player.x = 20; f.b.player.y = 8;
  f.b.playerInteract(); assert.equal(f.b.towers[1].burn, null); f.drain(); f.pump();
  assert.ok(f.a.towers[1].burn); assert.ok(f.b.towers[1].burn); assert.equal(f.a.towers[1].burn.y0, 10);
  const bad = fixture(); bad.b.c.pos.x = 20; bad.b.c.fast.p = [20, 2, 0];
  assert.equal(bad.direct(bad.command({ id: 1 })), true); bad.drain();
  assert.equal(bad.a.towers[1].burn, null);
});

test('standalone and elected keeper retain immediate valid ignition; disconnected followers never mutate locally', () => {
  const f = fixture(); f.a.player.x = 3.1;
  assert.equal(f.a.towerBrandIgnite(f.a.towers[0]), true); assert.equal(f.a.TFIRE.stats.lit, 1); assert.equal(f.up.length, 0);
  const standalone = fixture(); standalone.b.scope.NETWS.url = '';
  assert.equal(standalone.b.towerBrandIgnite(standalone.b.towers[0]), true); assert.equal(standalone.up.length, 0);
  const offline = fixture(); offline.b.scope.NETWS.state = 'off';
  assert.equal(offline.b.towerBrandIgnite(offline.b.towers[0]), false); assert.equal(offline.b.towers[0].burn, null);
});
