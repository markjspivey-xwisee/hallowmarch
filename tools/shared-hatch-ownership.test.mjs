import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read = p => fs.readFileSync(new URL(p, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const depth = read('../src/09u_depth.js'), animals = read('../src/08h_animals.js');
const segment = (s, from, to) => { const a = s.indexOf(from), b = s.indexOf(to, a); assert.ok(a >= 0 && b > a); return s.slice(a, b) + '\n'; };
const copy = x => JSON.parse(JSON.stringify(x));
function scene(account = 'account-host') {
  const requests = [], dropped = [], commands = new Map(), results = new Map(), parts = { char: {}, world: {} };
  let aid = 1, ent = 1, now = 5000;
  const ctx = vm.createContext({
    Math, Number, Object, Array, Map, Set, JSON, Date, console,
    queueMicrotask: fn => fn(), performance: { now: () => now },
    DEPTH: { offspring: [], hatchClaims: new Set(), nextHatch: 1, claimAt: -Infinity,
      grub: new Set(), burn: [], nests: [], moultT: 0, stats: { hatched: 0, feathers: 0 } },
    NETWS: { acct: { id: account } }, NET: { self: 'host', peers: new Map() },
    NETPARTS: { ready: true, pending: new Map() }, GAME: { t: 1000, player: { x: 0, z: 0 } },
    ANIMALS: { list: [], tamedCount: 0 }, ANIMALS_SHARED: { received: new Set() },
    FORAGE: { list: [], dirty: false }, W: { trees: [] },
    AKIND: { hen: { grow: 360 } }, SAVE_PARTS: parts,
    netWorldPartsActive: () => true, netWorldPartsConnected: () => true,
    netWorldPartsCanSimulate: () => true,
    netWorldPartsRequest: (...args) => { requests.push(args); return true; },
    netWorldPartsRegisterCommand: (op, spec) => commands.set(op, spec),
    netWorldPartsRegisterResult: (op, fn) => results.set(op, fn),
    registerSavePart: (scope, name, part) => { parts[scope][name] = part; },
    clamp: (v, lo, hi) => Math.max(lo, Math.min(hi, v)),
    floorAt: (_x, _z, y) => y, heightAt: () => 0, penById: () => null,
    dist2: (x, z, a, b) => (x - a) ** 2 + (z - b) ** 2,
    anAdult: () => true, anInherit: (a, b) => ({ ...copy(a), inherited: !!b }),
    anWildTraits: () => ({ coat: [1, 1, 1] }), anCleanTraits: x => copy(x),
    anHearts: () => {}, fxAlpha: { emit: () => {} },
    anSharedAccount: () => ctx.NETWS.acct.id,
    anSharedOwnAnimal: e => e.tame?.owner === 'player' && (!e.netEntityOwner || e.netEntityOwner === ctx.NET.self),
    anMine: () => ctx.ANIMALS.list.filter(e => !e.removed && e.tame?.owner === 'player' && e.privateAccount === ctx.NETWS.acct.id),
    anRecord: (k, o) => ({ aid: aid++, k, name: o.name || 'Chick', sex: o.sex || 'f', ...o }),
    anSpawn: (rec, x, z) => {
      const e = { id: ent++, x, y: 0, z, tame: rec, alive: true, removed: false, hp: 100, maxHp: 100 };
      if (rec.owner === 'player') e.privateAccount = ctx.NETWS.acct.id;
      ctx.ANIMALS.list.push(e); return e;
    },
    anSaveRec: (rec, e) => ({ a: rec.aid, k: rec.k, n: rec.name, s: rec.sex, g: rec.gen || 0, age: rec.age || 0,
      tr: copy(rec.tr), p: rec.pen, ma: rec.ma ? [rec.ma.aid, rec.ma.name] : null,
      pa: rec.pa ? [rec.pa.aid, rec.pa.name] : null, x: e.x, z: e.z }),
    netEntityRegister: e => { e.netEntityId ||= 'scene:public:' + e.id; },
    netEntityFind: id => ctx.ANIMALS.list.find(e => !e.removed && e.netEntityId === id) || null,
    removeEnt: e => { e.removed = true; },
    uiLog: () => {}, uiToast: () => {}, uiError: () => {}, sfx: () => {}, saveSoon: () => {}, loreNote: () => {},
    dpWorkPoint: () => null, dpApplyWork: () => false, dpIgnite: () => false, WB: { torch: 1 },
    anLay: (_e, owner) => { ctx.laidFor = owner; }, LOOT: [], dropGood: (...args) => dropped.push(args),
  });
  vm.runInContext(segment(animals, 'function anSharedReceive', '\nfunction anSharedSave'), ctx);
  vm.runInContext(segment(depth, 'function dpMoultOne', 'const DP_HATCH =') + segment(depth, 'const DP_HATCH =', '// Nest identities survive canonical save/load')
    + segment(depth, 'function dpNestId', '\nfunction depthAnimalOffers'), ctx);
  vm.runInContext(segment(depth, "registerSavePart('world', 'depth',", '/* ------------------------------------------------------------------ */\n/* test hooks:'), ctx);
  vm.runInContext(depth.slice(depth.lastIndexOf('\nqueueMicrotask(() => {')), ctx);
  const nest = (owner = 'account-alice', eggs = 1) => ({ id: 'nest-one', owner: 'player', ownerAccount: owner,
    x: 1, z: 2, pen: null, eggs, at: 0, ma: { aid: 71, name: 'Mother', gen: 2, tr: { coat: [1, 0, 0] } },
    pa: { aid: 72, name: 'Father', gen: 1, tr: { coat: [0, 0, 1] } } });
  return { ctx, requests, dropped, commands, parts, nest,
    account(id) { ctx.NETWS.acct.id = id; now += 1100; },
    privateFor(id) { return ctx.ANIMALS.list.filter(e => !e.removed && e.tame.owner === 'player' && e.privateAccount === id); },
  };
}

test('offline owner chicks remain reserved public bodies and never enter the keeper private herd', () => {
  const s = scene('account-host'), N = s.nest();
  s.ctx.DEPTH.nests.push(N); s.ctx.dpHatchStep();
  assert.equal(s.ctx.DEPTH.nests.length, 0); assert.equal(s.ctx.DEPTH.offspring.length, 1);
  const entry = s.ctx.DEPTH.offspring[0], body = s.ctx.dpHatchBody(entry);
  assert.equal(entry.ownerAccount, 'account-alice'); assert.equal(entry.state, 'pending');
  assert.equal(body.tame.owner, 'town'); assert.equal(body.tame.reservedOwnerAccount, 'account-alice');
  assert.equal(body.tame.gen, 3); assert.equal(s.privateFor('account-host').length, 0);
  assert.equal(s.requests.length, 0);
});

test('keeper handoff reloads owner metadata and rebuilds only the reserved public body', () => {
  const a = scene(); a.ctx.DEPTH.nests.push(a.nest()); a.ctx.dpHatchStep();
  const saved = copy(a.parts.world.depth.save()), id = saved.h[0].id;
  const b = scene('different-keeper'); b.parts.world.depth.load(saved); b.ctx.dpHatchStep();
  assert.equal(b.ctx.DEPTH.offspring[0].id, id);
  assert.equal(b.ctx.DEPTH.offspring[0].ownerAccount, 'account-alice');
  assert.equal(b.ctx.ANIMALS.list.filter(e => !e.removed).length, 1);
  assert.equal(b.privateFor('different-keeper').length, 0);
  assert.equal(b.ctx.dpHatchBody(b.ctx.DEPTH.offspring[0]).tame.reservedClaim, id);
});

test('only the real owner can claim; lost receipt recovery imports one private animal using a stable claim', () => {
  const s = scene(); s.ctx.DEPTH.nests.push(s.nest()); s.ctx.dpHatchStep();
  const entry = s.ctx.DEPTH.offspring[0];
  assert.equal(s.ctx.dpHatchClaim({ id: entry.id }, { ownerAccount: 'account-host' }), false);
  const first = s.ctx.dpHatchClaim({ id: entry.id }, { ownerAccount: 'account-alice' });
  assert.equal(first.ok, true); assert.equal(entry.state, 'claimed');
  assert.equal(s.privateFor('account-host').length, 0, 'canonical claim alone grants nothing to keeper');
  const saved = copy(s.parts.world.depth.save());
  const restored = scene('account-alice'); restored.parts.world.depth.load(saved);
  restored.ctx.dpHatchClaimStep();
  assert.equal(restored.requests[0][0], 'animal.hatch.claim'); assert.equal(restored.requests[0][3], true, 'owner requests use journal/receipt path even when keeper');
  const replay = restored.ctx.dpHatchClaim({ id: entry.id }, { ownerAccount: 'account-alice' });
  restored.ctx.dpHatchReceive(replay.result, { id: 'new-receipt-id' });
  restored.ctx.dpHatchReceive(replay.result, { id: 'yet-another-receipt' });
  assert.equal(restored.privateFor('account-alice').length, 1);
  assert.equal(restored.privateFor('account-alice')[0].tame.sharedClaim, entry.id);
});

test('death and receipt-ring rollover cannot resurrect a previously imported chick', () => {
  const s = scene('account-alice'); s.ctx.DEPTH.nests.push(s.nest()); s.ctx.dpHatchStep();
  const entry = s.ctx.DEPTH.offspring[0], result = s.ctx.dpHatchClaim({ id: entry.id }, { ownerAccount: 'account-alice' });
  s.ctx.dpHatchReceive(result.result, { id: 'original' });
  s.privateFor('account-alice')[0].removed = true; s.ctx.ANIMALS_SHARED.received.clear();
  const privateClaims = copy(s.parts.char.hatchedClaims.save()), canonical = copy(s.parts.world.depth.save());
  const after = scene('account-alice'); after.parts.world.depth.load(canonical); after.parts.char.hatchedClaims.load(privateClaims);
  after.ctx.dpHatchReceive(result.result, { id: 'receipt-after-ring-rotated' }); after.ctx.dpHatchClaimStep();
  assert.equal(after.privateFor('account-alice').length, 0); assert.equal(after.requests.length, 0);
});

test('bounded registry backpressure keeps eggs and existing offline claims without eviction', () => {
  const s = scene();
  for (let i = 0; i < 128; i++) s.ctx.DEPTH.offspring.push({ id: 'hatch:kept:' + i, ownerAccount: 'offline-' + i, state: 'claimed', animal: {} });
  const before = s.ctx.DEPTH.offspring.map(e => e.id), N = s.nest(); s.ctx.DEPTH.nests.push(N);
  s.ctx.dpHatchStep();
  assert.equal(N.eggs, 1); assert.equal(s.ctx.DEPTH.nests.length, 1); assert.equal(s.ctx.DEPTH.offspring.length, 128);
  assert.deepEqual(copy(s.ctx.DEPTH.offspring.map(e => e.id)), copy(before)); assert.equal(s.ctx.ANIMALS.list.length, 0);
});

test('unknown legacy owners stay unresolved, while town and standalone hatch behavior stays distinct', () => {
  const s = scene(); const legacy = s.nest(null); s.ctx.DEPTH.nests.push(legacy); s.ctx.dpHatchStep();
  assert.equal(legacy.eggs, 1); assert.equal(s.privateFor('account-host').length, 0);
  const town = { ...s.nest(null), owner: 'town' }; assert.ok(s.ctx.dpHatchOne(town, 1, 2));
  assert.equal(s.ctx.DEPTH.offspring.length, 0);
  s.ctx.netWorldPartsActive = () => false;
  assert.ok(s.ctx.dpHatchOne(s.nest(null), 1, 2)); assert.equal(s.privateFor('account-host').length, 1);
});

test('dead reserved offspring cannot be claimed and ownership is preserved on fresh clutches', () => {
  const s = scene(); s.ctx.DEPTH.nests.push(s.nest()); s.ctx.dpHatchStep();
  const entry = s.ctx.DEPTH.offspring[0]; s.ctx.dpHatchBody(entry).alive = false; s.ctx.dpHatchStep();
  assert.equal(entry.state, 'lost'); assert.equal(s.ctx.dpHatchClaim({ id: entry.id }, { ownerAccount: 'account-alice' }), false);
  const hen = s.ctx.anSpawn({ k: 'hen', aid: 70, name: 'Owner hen', gen: 1, owner: 'remote', tr: {}, pen: null }, 0, 0);
  hen.netEntityId = 'scene:pet:hen'; hen.netEntityOwner = 'owner-peer';
  const spec = s.commands.get('animal.clutch'), args = { id: hen.netEntityId, aid: 70, cycle: 1, sire: { aid: 71, name: 'Sire', gen: 1, tr: {} } };
  assert.equal(spec.run(args, { from: 'intruder', ownerAccount: 'account-intruder' }), false);
  assert.equal(spec.run(args, { from: 'owner-peer', ownerAccount: 'account-alice' }).ok, true);
  assert.equal(s.ctx.DEPTH.nests[0].ownerAccount, 'account-alice');
  const saved = copy(s.parts.world.depth.save()), b = scene(); b.parts.world.depth.load(saved);
  assert.equal(b.ctx.DEPTH.nests[0].ownerAccount, 'account-alice');
});


test('saved production cycles suppress duplicate clutches across body changes, death and keeper handoff', () => {
  const s = scene(), hen = s.ctx.anSpawn({ k: 'hen', aid: 70, name: 'Private hen', gen: 1, owner: 'remote', tr: {} }, 0, 0);
  hen.netEntityId = 'scene:pet:first'; hen.netEntityOwner = 'owner-peer';
  const args = { id: hen.netEntityId, aid: 70, cycle: 1, sire: { aid: 71, name: 'Sire', gen: 1, tr: {} } };
  const owner = { from: 'owner-peer', ownerAccount: 'account-alice' }, run = s.commands.get('animal.clutch').run;
  assert.equal(run(args, owner).ok, true); assert.equal(s.ctx.DEPTH.nests.length, 1);
  assert.equal(run(args, owner).ok, true); assert.equal(s.ctx.DEPTH.nests.length, 1);
  assert.equal(run({ ...args, cycle: 3 }, owner), false, 'out-of-order cycles do not create eggs');
  assert.equal(run({ ...args, aid: 999 }, owner), false, 'a request cannot use another private animal identity');
  const saved = copy(s.parts.world.depth.save()), next = scene(); next.parts.world.depth.load(saved);
  const replay = next.commands.get('animal.clutch').run(args, owner);
  assert.equal(replay.ok, true, 'existing cycle is acknowledged even after the old body disappeared');
  assert.equal(next.ctx.DEPTH.nests.length, 1);
  assert.equal(next.commands.get('animal.clutch').run({ ...args, cycle: 2 }, owner), false, 'new production still requires its live owner body');
  assert.equal(next.commands.get('animal.clutch').run(args, { from: 'intruder', ownerAccount: 'different-account' }), false);
  const restored = next.ctx.anSpawn({ k: 'hen', aid: 70, name: 'Private hen', gen: 1, owner: 'remote', tr: {} }, 0, 0);
  restored.netEntityId = 'scene:pet:after-reload'; restored.netEntityOwner = 'owner-peer';
  assert.equal(next.commands.get('animal.clutch').run({ ...args, id: restored.netEntityId, cycle: 2 }, owner).ok, true);
  assert.equal(next.ctx.DEPTH.nests.length, 2); assert.equal(next.ctx.DEPTH.production[0].cycle, 2);
});

test('bounded production ledger backpressure preserves prior cycles without evicting replay protection', () => {
  const s = scene();
  for (let i = 0; i < 256; i++) s.ctx.DEPTH.production ||= [], s.ctx.DEPTH.production.push({ account: 'owner-' + i, aid: i + 1, op: 'animal.lay', cycle: 1 });
  const hen = s.ctx.anSpawn({ k: 'hen', aid: 900, name: 'Hen', owner: 'remote', tr: {} }, 0, 0);
  hen.netEntityId = 'scene:pet:full'; hen.netEntityOwner = 'owner-peer';
  assert.equal(s.commands.get('animal.lay').run({ id: hen.netEntityId, aid: 900, cycle: 1 }, { from: 'owner-peer', ownerAccount: 'account-alice' }), false);
  assert.equal(s.ctx.DEPTH.production.length, 256); assert.equal(s.ctx.laidFor, undefined);
  const saved = copy(s.parts.world.depth.save()), handoff = scene(); handoff.parts.world.depth.load(saved);
  assert.deepEqual(copy(handoff.ctx.DEPTH.production), copy(s.ctx.DEPTH.production));
});


test('private owner moulting requests one public drop and cycle replay cannot duplicate feathers', () => {
  const s = scene('account-alice');
  const local = s.ctx.anSpawn({ k: 'hen', aid: 70, name: 'Local hen', gen: 1, owner: 'player', tr: {}, cmd: 'pen', mood: 1, moult: 239 }, 0, 0);
  local.netEntityId = 'scene:pet:hen'; local.netEntityOwner = 'host';
  const mirror = s.ctx.anSpawn({ k: 'hen', aid: 71, name: 'Other owner hen', owner: 'remote', tr: {}, cmd: 'pen', mood: 1, moult: 239 }, 0, 0);
  mirror.netEntityOwner = 'another-owner';
  s.ctx.anSharedProduction = (e, op) => { s.requests.push({ id: e.netEntityId, op }); return true; };
  s.ctx.dpMoult(5);
  assert.deepEqual(copy(s.requests), [{ id: local.netEntityId, op: 'animal.moult' }]);
  assert.equal(mirror.tame.moult, 239); assert.equal(s.dropped.length, 0, 'owner clocks do not drop local-only feathers');
  const a = { id: local.netEntityId, aid: 70, cycle: 1 }, context = { from: 'host', ownerAccount: 'account-alice' };
  assert.equal(s.commands.get('animal.moult').run(a, context).ok, true);
  assert.equal(s.dropped.length, 1); assert.equal(s.dropped[0][0], 'feather');
  assert.equal(s.commands.get('animal.moult').run(a, context).ok, true); assert.equal(s.dropped.length, 1);
  const saved = copy(s.parts.world.depth.save()), next = scene(); next.parts.world.depth.load(saved);
  assert.equal(next.commands.get('animal.moult').run(a, context).ok, true); assert.equal(next.dropped.length, 0, 'handoff only acknowledges the existing production');
});
