import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source = fs.readFileSync(new URL('../../src/08h_animals.js', import.meta.url), 'utf8');
function body(name) {
  const start = source.indexOf('function ' + name + '(');
  assert.ok(start >= 0, name);
  const rest = source.slice(start), next = rest.slice(1).search(/\n(?:function |const |queueMicrotask)/);
  return next < 0 ? rest : rest.slice(0, next + 1);
}
const names = ['anSharedWorldCanSimulate', 'anSharedOwnAnimal', 'anSharedAccount', 'anSharedPenMine', 'anSharedGate',
  'anPenFill', 'anPenMuck', 'anSharedProductionRestore', 'anSharedProduction', 'anSharedProductionRecord', 'anSharedProductionDone', 'anSharedProductionFailed', 'anSharedPenConsume', 'anSharedOffer', 'anSharedReceive', 'anSharedSave', 'anSharedApply', 'updateAnimals'];
function setup() {
  const commands = new Map(), resultHandlers = new Map(), failureHandlers = new Map(), requests = [], clocks = [];
  const entities = new Map(), inventory = { apple: 20, water: 8, feed: 5, plank: 20 };
  const A = { ready: false, trust: new Map(), claims: new Set(), consumed: new Map(), received: new Set() };
  const animalState = { list: [], pens: [], trust: new Map(), nextAid: 1, nextPen: 1, down: [], trail: [], inited: true };
  const ctx = vm.createContext({ Math, Number, Map, Set, console, host: true, HALF: 512,
    ANIMALS_SHARED: A, ANIMALS: animalState, NETWS: { acct: { id: 'host-account' } },
    GAME: { t: 0, started: true, player: { id: 'host', x: 0, z: 0, faction: 0, alive: true } },
    NET: { peers: new Map() }, NETPARTS: { next: 0, ready: true, replay: false }, CAMPS: [],
    AKIND: { horse: { likes: ['apple'], need: 4, grow: 900 }, pig: { likes: ['apple'], need: 3, grow: 480 }, cattle: { grow: 900 } },
    netWorldPartsActive: () => true, netWorldPartsCanSimulate: () => ctx.host,
    netWorldPartsRequest(op, args, cost = [], forceOwner = false) {
      if (ctx.host && !forceOwner) return false;
      if (ctx.refuseReservation) return true;
      ctx.NETPARTS.next++; requests.push({ op, args, cost, forceOwner }); return true;
    },
    netWorldPartsRegister() {}, netWorldPartsRegisterCommand: (op, spec) => commands.set(op, spec),
    netWorldPartsRegisterResult: (op, fn) => resultHandlers.set(op, fn),
    netWorldPartsRegisterFailure: (op, fn) => failureHandlers.set(op, fn),
    netEntityFind: id => entities.get(id), netEntityOwnPet: e => e?.tame?.owner === 'player' && !e.netEntityOwner,
    clamp: (x, a, b) => Math.max(a, Math.min(b, x)), r3: x => Math.round(x * 1000) / 1000,
    dist2: (x, z, a, b) => (x - a) ** 2 + (z - b) ** 2,
    goodsHave: id => inventory[id] > 0,
    goodsTake(id, n) { if ((inventory[id] || 0) < n) return false; inventory[id] -= n; return true; },
    goodsAdd(id, n) { inventory[id] = (inventory[id] || 0) + n; return true; },
    anWildKind: e => e?.alive && !e.removed && e.wildKind || null,
    anPlayerCalm: () => true, faceToward() {}, setAct() {}, loreNote() {}, uiToast() {}, saveSoon() {},
    anRecord: (k, options) => ({ aid: animalState.nextAid++, k, ...options, name: options.name || 'Moss' }),
    anWildTraits: () => ({ coat: [1, 1, 1] }), anCleanTraits: t => t,
    anSaveRec: (rec, e) => ({ a: rec.aid, k: rec.k, n: rec.name, s: rec.sex, age: rec.age, tr: rec.tr, x: e.x, z: e.z }),
    anMine: () => animalState.list.filter(e => e.tame?.owner === 'player'),
    anSpawn(rec, x, z) { const e = { id: 'own-' + rec.aid, alive: true, tame: rec, x, z }; animalState.list.push(e); return e; },
    removeEnt: e => { e.removed = true; },
    anTrust(e) { let t = animalState.trust.get(e.id); if (!t) animalState.trust.set(e.id, t = {}); return t; },
    penById: id => animalState.pens.find(p => p.id === id),
    penMake(row) { const p = { ...row, gate: { x: row.x, z: row.z }, rack: { x: row.x, z: row.z }, trough: { x: row.x, z: row.z }, gateColl: {} }; animalState.pens.push(p); return p; },
    penRemove: pen => { animalState.pens.splice(animalState.pens.indexOf(pen), 1); },
    penHas: () => true, wxPrecipAt: () => 0,
    anTrailStep() {}, anTamingStep() {}, anDied() {}, anClock: e => clocks.push(e.id),
    inDungeon: () => false, anMarkConfirm: () => false,
    queueMicrotask: fn => fn(),
  });
  vm.runInContext(names.map(body).join('\n') + '\n' + source.slice(source.lastIndexOf('\nqueueMicrotask(() => {'))
    + '\nthis.api={anSharedOffer,anSharedReceive,anPenFill,anPenMuck,anSharedSave,anSharedApply,anSharedPenConsume,anSharedProduction,updateAnimals};', ctx);
  return { ctx, api: ctx.api, commands, resultHandlers, requests, clocks, entities, inventory, A, animalState, failureHandlers };
}

test('two independent tamers cannot claim the same public wild animal', () => {
  const c = setup(), wild = { id: 42, netEntityId: 'scene:wild:42', alive: true, wildKind: 'pig', kind: 'boar', x: 2, z: 0, ai: {} };
  c.entities.set(wild.netEntityId, wild);
  for (const owner of ['phone', 'desktop']) for (let i = 0; i < 2; i++) {
    c.ctx.GAME.t += 6;
    const out = c.api.anSharedOffer({ id: wild.netEntityId, food: 'apple' }, { ownerAccount: owner });
    assert.equal(out.ok, true); assert.equal(out.result.animal, undefined);
  }
  c.ctx.GAME.t += 6;
  const win = c.api.anSharedOffer({ id: wild.netEntityId, food: 'apple' }, { ownerAccount: 'phone' });
  assert.equal(win.result.animal.k, 'pig'); assert.equal(wild.removed, true);
  assert.equal(c.animalState.list.length, 0, 'authority must not put remote claim in its private herd');
  const before = c.inventory.apple;
  assert.equal(c.api.anSharedOffer({ id: wild.netEntityId, food: 'apple' }, { ownerAccount: 'desktop' }), false);
  assert.equal(c.inventory.apple, before);
});

test('wild feeding cooldown is per owner and rejects extra resource consumption', () => {
  const c = setup(), wild = { id: 1, alive: true, wildKind: 'pig', x: 0, z: 0, ai: {} };
  c.entities.set('wild', wild);
  assert.equal(c.api.anSharedOffer({ id: 'wild', food: 'apple' }, { ownerAccount: 'phone' }).ok, true);
  const before = c.inventory.apple;
  assert.equal(c.api.anSharedOffer({ id: 'wild', food: 'apple' }, { ownerAccount: 'phone' }), false);
  assert.equal(c.inventory.apple, before);
  assert.equal(c.api.anSharedOffer({ id: 'wild', food: 'apple' }, { ownerAccount: 'desktop' }).ok, true);
});

test('animal receipt imports only once into the actual owner private herd', () => {
  const c = setup(), result = { animal: { k: 'horse', s: 'f', n: 'Brindle', age: 950, tr: {}, x: 3, z: 1 } };
  c.api.anSharedReceive(result, { id: 'claim-one' });
  c.api.anSharedReceive(result, { id: 'claim-one' });
  assert.equal(c.animalState.list.length, 1);
  assert.equal(c.animalState.list[0].tame.owner, 'player');
  assert.equal(c.animalState.list[0].tame.sharedClaim, 'claim-one');
});

test('pen feed, water, and manure mutate only on the shared authority', () => {
  const c = setup(), pen = { id: 1, feed: 2, water: 3, manure: 4 };
  c.ctx.host = false;
  c.api.anPenFill(pen, 'feed', 'feed', 2); c.api.anPenFill(pen, 'water', 'water', 2); c.api.anPenMuck(pen);
  assert.equal(pen.feed, 2); assert.equal(pen.water, 3); assert.equal(pen.manure, 4);
  assert.equal(c.requests.length, 3);
  c.ctx.host = true;
  c.api.anPenFill(pen, 'feed', 'feed', 2); c.api.anPenFill(pen, 'water', 'water', 2); c.api.anPenMuck(pen);
  assert.equal(pen.feed, 18); assert.equal(pen.water, 9); assert.equal(pen.manure, 0);
  assert.equal(c.inventory.waterskin_empty, 2); assert.equal(c.inventory.manure, 4);
  assert.equal(c.api.anPenMuck(pen), false, 'the same manure cannot be claimed twice');
});

test('a pet can consume shared rack contents only for its published owner', () => {
  const c = setup(), pen = { id: 3, x: 0, z: 0, rack: { x: 1, z: 0 }, trough: { x: 2, z: 0 }, feed: 2, water: 2 };
  c.animalState.pens.push(pen);
  c.entities.set('pet:phone:1', { alive: true, netEntityOwner: 'phone', x: 1, z: 0, tame: { owner: 'remote', pen: 3, cmd: 'pen' } });
  const run = c.commands.get('animal.consume').run, args = { id: 'pet:phone:1', pen: 3, mode: 'feed' };
  assert.equal(run(args, { from: 'desktop' }), false); assert.equal(pen.feed, 2);
  const out = run(args, { from: 'phone' }); assert.equal(out.ok, true); assert.equal(pen.feed, 1.8);
  assert.equal(run(args, { from: 'phone' }), false, 'duplicate trough cycles are bounded');
});

test('public animal clocks are host-only while private owner pets keep progressing', () => {
  const c = setup(); c.ctx.host = false;
  c.animalState.list.push({ id: 'town', alive: true, tame: { owner: 'town' }, _anClk: 1 },
    { id: 'own', alive: true, tame: { owner: 'player' }, _anClk: 1 },
    { id: 'remote', alive: true, netEntityOwner: 'phone', tame: { owner: 'remote' }, _anClk: 1 });
  c.api.updateAnimals(0.1); assert.deepEqual(c.clocks, ['own']);
});

test('a player on another device opens the same authoritative pen gate', () => {
  const c = setup(), pen = { id: 3, gate: { x: 20, z: 20 }, gateColl: {}, gateOpen: 0, gateWant: 0, owner: 'town', feed: 20, water: 20 };
  c.animalState.pens.push(pen); c.ctx.GAME.player.x = 100;
  c.ctx.NET.peers.set('phone', { slow: { on: 1 }, ghost: { x: 20, z: 20 } });
  c.api.updateAnimals(0.1); assert.equal(pen.gateWant, 1.5); assert.equal(pen.gateColl.active, false);
});

test('public pen snapshot restores resources and ownership without importing private herd', () => {
  const c = setup(), frame = { v: 1, pens: [{ id: 10, owner: 'player', account: 'phone-account', realm: 0,
    x: 20, z: 30, yaw: 0, hw: 6, hd: 4.5, feed: 11, water: 8, manure: 3, name: 'Phone paddock', gate: 2, open: 0.5 }], claims: ['wild:1'], trust: [] };
  c.api.anSharedApply(frame);
  assert.equal(c.animalState.pens[0].sharedOwner, 'phone-account');
  assert.equal(c.animalState.pens[0].feed, 11); assert.equal(c.animalState.pens[0].gateWant, 2);
  assert.equal(c.animalState.list.length, 0); assert.equal(c.A.ready, true);
  assert.equal(c.A.claims.has('wild:1'), true);
});
test('owned hen production defers to canonical commands and remains ready before admission', () => {
  const c = setup(); c.ctx.host = false;
  const hen = { tame: { aid: 1, owner: 'player', prod: { egg: 0 }, preg: null } };
  assert.equal(c.api.anSharedProduction(hen, 'animal.lay'), true);
  assert.equal(hen.tame.prod.egg, 1); assert.equal(c.requests.length, 0);
  hen.netEntityId = 'pet:phone:hen';
  c.api.anSharedProduction(hen, 'animal.lay'); assert.equal(c.requests.at(-1).op, 'animal.lay');
  const sire = { aid: 9, name: 'Red', tr: {} };
  delete hen.netEntityId; c.api.anSharedProduction(hen, 'animal.clutch', { sire });
  assert.equal(hen.tame.preg.left, 1); assert.equal(hen.tame.preg.sire, sire);
});
test('a stable offspring claim remains single-owned across different recovery receipt IDs', () => {
  const c = setup(), result = { claimId: 'offspring:one', animal: { k: 'pig', s: 'f', n: 'Pip', age: 0, tr: {}, x: 3, z: 1 } };
  c.api.anSharedReceive(result, { id: 'first-command' });
  c.api.anSharedReceive(result, { id: 'recovered-command' });
  assert.equal(c.animalState.list.length, 1);
  assert.equal(c.animalState.list[0].tame.sharedClaim, 'offspring:one');
});
test('keeper-owned hen production also uses a forced private reservation', () => {
  const c = setup(), hen = { netEntityId: 'pet:self:7', tame: { aid: 7, owner: 'player', prod: { egg: 0 } } };
  c.animalState.list.push(hen);
  assert.equal(c.api.anSharedProduction(hen, 'animal.lay'), true);
  assert.equal(c.requests[0].forceOwner, true); assert.equal(c.requests[0].args.cycle, 1);
  assert.equal(hen.tame.publicPending.lay, 1);
  c.resultHandlers.get('animal.lay')({}, { id: 'receipt' }, { op: 'animal.lay', args: { aid: 7, cycle: 1 } });
  assert.equal(hen.tame.publicPending.lay, undefined);
  assert.equal(hen.tame.publicCycles.lay, 1);
});

test('refused reservation and failed canonical production restore private timers', () => {
  const c = setup(), hen = { netEntityId: 'pet:self:7', tame: { aid: 7, owner: 'player', prod: { egg: 0 } } };
  c.animalState.list.push(hen); c.ctx.refuseReservation = true;
  c.api.anSharedProduction(hen, 'animal.lay');
  assert.equal(hen.tame.prod.egg, 1); assert.equal(hen.tame.publicCycles.lay, 0);
  assert.equal(hen.tame.publicPending.lay, undefined);
  c.ctx.refuseReservation = false;
  const sire = { aid: 8, name: 'Red', tr: {} };
  c.api.anSharedProduction(hen, 'animal.clutch', { sire });
  c.failureHandlers.get('animal.clutch')({ ok: false }, { op: 'animal.clutch', args: { aid: 7, cycle: 1, sire } });
  assert.equal(hen.tame.preg.left, 1); assert.equal(hen.tame.preg.sire, sire);
  assert.equal(hen.tame.publicCycles.clutch, 0); assert.equal(hen.tame.publicPending.clutch, undefined);
});

test('an unacknowledged cycle is not reissued and replayed public production cannot recurse', () => {
  const c = setup(), hen = { netEntityId: 'pet:self:7', tame: { aid: 7, owner: 'player', prod: { egg: 0 } } };
  c.api.anSharedProduction(hen, 'animal.lay'); c.api.anSharedProduction(hen, 'animal.lay');
  assert.equal(c.requests.length, 1); assert.equal(hen.tame.prod.egg, 1);
  c.ctx.NETPARTS.replay = true;
  assert.equal(c.api.anSharedProduction(hen, 'animal.lay'), false);
  c.ctx.NETPARTS.replay = false; hen.tame.owner = 'town';
  assert.equal(c.api.anSharedProduction(hen, 'animal.lay'), false);
});

test('offspring receipts retain generation, parents, and the shared pen', () => {
  const c = setup(); c.animalState.pens.push({ id: 10 });
  c.api.anSharedReceive({ claimId: 'offspring:lineage', animal: { a: 99, k: 'pig', s: 'f', n: 'Pip', age: 0, tr: {},
    g: 4, ma: [12, 'Sow'], pa: [13, 'Boar'], p: 10, c: 'pen', x: 3, z: 1 } }, { id: 'receipt:lineage' });
  const rec = c.animalState.list[0].tame;
  assert.equal(rec.gen, 4); assert.equal(rec.ma.aid, 12); assert.equal(rec.pa.name, 'Boar');
  assert.equal(rec.pen, 10); assert.equal(rec.cmd, 'pen'); assert.notEqual(rec.aid, 99);
});
test('moulting uses the same durable owner cycle and restores rejected feather production', () => {
  const c = setup(), hen = { netEntityId: 'pet:self:7', tame: { aid: 7, owner: 'player', prod: { egg: 0 }, moult: 0 } };
  c.animalState.list.push(hen);
  c.api.anSharedProduction(hen, 'animal.moult');
  assert.equal(c.requests[0].forceOwner, true); assert.equal(c.requests[0].args.cycle, 1);
  assert.equal(hen.tame.publicCycles.moult, 1);
  c.failureHandlers.get('animal.moult')({ ok: false }, { op: 'animal.moult', args: { aid: 7, cycle: 1 } });
  assert.equal(hen.tame.moult, 240); assert.equal(hen.tame.publicCycles.moult, 0);
  assert.equal(hen.tame.publicPending.moult, undefined);
});

test('private animal save and load retain production serials, reservations, and feather clock', () => {
  const c = setup();
  c.ctx.anSaveTr = t => t; c.ctx.isFiniteNum = Number.isFinite;
  vm.runInContext(body('anSaveRec') + '\n' + body('animalsLoad') + '\nthis.privateCodec={save:anSaveRec,load:animalsLoad};', c.ctx);
  const record = { aid: 7, k: 'pig', owner: 'player', name: 'Moss', sex: 'f', gen: 3, age: 1000, tr: {}, cmd: 'follow',
    hunger: 0.9, thirst: 0.8, lvl: 1, xp: 0, prod: { wool: 0, milk: 0, egg: 0 },
    publicCycles: { lay: 2, clutch: 1, moult: 4 }, publicPending: { moult: 4 }, moult: 120, sharedClaim: 'owned-claim' };
  const saved = c.ctx.privateCodec.save(record);
  assert.equal(saved.pc.moult, 4); assert.equal(saved.pp.moult, 4); assert.equal(saved.mt, 120);
  c.ctx.privateCodec.load({ v: 1, next: 8, np: 1, list: [saved], pens: [], receipts: ['owned-claim'] });
  const restored = c.animalState.list[0].tame;
  assert.equal(restored.publicCycles.lay, 2); assert.equal(restored.publicPending.moult, 4);
  assert.equal(restored.moult, 120); assert.equal(restored.sharedClaim, 'owned-claim');
  assert.equal(c.A.received.has('owned-claim'), true);
});