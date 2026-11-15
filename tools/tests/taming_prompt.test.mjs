import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const root = new URL('../../', import.meta.url);
const animals = readFileSync(new URL('src/08h_animals.js', root), 'utf8');
const playerSource = readFileSync(new URL('src/09_player.js', root), 'utf8');
function between(source, startText, endText) {
  const start = source.indexOf(startText), end = source.indexOf(endText, start + startText.length);
  assert(start >= 0 && end > start, 'extract actual source: ' + startText);
  return source.slice(start, end);
}

function fixture(options = {}) {
  const inventory = { apple: 6, meat_raw: 6 }, errors = [], effects = [], opened = [], requests = [];
  const P = { id: 1, alive: true, faction: 0, x: 0, z: 0, yaw: 0, mount: null, combatUntil: 0, _anSp: 0, carrying: null, ...options };
  const wild = { id: 2, alive: true, removed: false, role: 'mob', mobType: 'boar', name: 'wild boar', camp: 0,
    elite: false, x: 0, z: 2, radius: 0.6, lastHitAt: 0, ai: {} };
  const entities = [wild], state = { inited: true, marking: null, trust: new Map(), pens: [] };
  const ctx = vm.createContext({ GAME: { t: 10, player: P }, ANIMALS: state, Math,
    REALMS: [{ town: { x: 1000, z: 1000 }, musterSite: { x: 1000, z: 1000 } }], WAR: { relics: [] }, BARROW: {},
    goodsHave: id => inventory[id] > 0,
    goodsTake(id, n) { assert(inventory[id] >= n); inventory[id] -= n; effects.push(['cost', id, n]); },
    goodName: id => ({ apple: 'Apple', grain: 'Grain', meat_raw: 'Raw meat' }[id] || id),
    dist: (x, z, a, b) => Math.hypot(a - x, b - z),
    angDiff: (a, b) => Math.atan2(Math.sin(b - a), Math.cos(b - a)),
    forNear(x, z, range, callback) { for (const e of entities) { const d2 = (e.x - x) ** 2 + (e.z - z) ** 2; if (d2 <= range * range) callback(e, d2); } },
    uiError: message => errors.push(message), uiLog: (...args) => effects.push(['log', ...args]),
    faceToward: e => effects.push(['face', e.id]), setAct: (...args) => effects.push(['act', args[0].id, ...args.slice(1)]),
    anHearts: (e, n) => effects.push(['hearts', e.id, n]), anVoice: (...args) => effects.push(['voice', args[0]]),
    loreNote: id => effects.push(['note', id]), anTame: (e, k) => effects.push(['tame', e.id, k]),
    openAnimalCard: e => opened.push(['card', e.id]), anStage: rec => rec.k, openHerder: pen => opened.push(['herder', pen.id]),
    openPen: pen => opened.push(['pen', pen.id]), anMarkConfirm: () => opened.push(['fence']),
    netWorldPartsActive: () => false, anSharedWorldCanSimulate: () => true,
    netWorldPartsRequest: (...args) => { requests.push(args); return true; },
    inDungeon: () => false, relicTakeable: () => false,
  });
  for (const name of ['houseOffers', 'wearOffers', 'natureOffers', 'brandOffers', 'siegeOffers', 'waterOffers', 'hallOffers',
    'buildOffers', 'survivalOffers', 'farmOffers', 'depthOffers', 'towerOffers', 'late2Offers', 'loopsOffers']) ctx[name] = () => {};
  vm.runInContext(between(animals, 'const AKIND = {', '\nconst ACOATS =')
    + '\n' + between(animals, 'function anWildKind(', '// every step for wild creatures')
    + '\n' + between(animals, 'const anWildName =', 'function anTame(')
    + '\n' + between(animals, 'function animalOffers(', '\n/* ------------------------------------------------------------------ */')
    + '\n' + between(playerSource, 'function currentInteraction(', 'function playerInteract('), ctx);
  return { ctx, P, wild, entities, state, inventory, errors, effects, opened, requests,
    interaction: () => ctx.currentInteraction(),
    trust: () => ctx.anTrust(wild),
    settle() { ctx.anTrust(wild).settle = 1; },
    snapshot() { const t = ctx.anTrust(wild); return { inventory: { ...inventory }, trust: { ...t }, ai: { ...wild.ai }, effects: effects.slice(), requests: requests.slice() }; },
  };
}

test('combat has no wild-taming prompt even though a tameable boar is in E range', () => {
  const f = fixture({ combatUntil: 16 }); f.settle();
  const before = f.snapshot();
  assert.equal(f.interaction(), null);
  assert.deepEqual(f.snapshot(), before, 'reading the prompt cannot spend food, change trust or request an action');
});

for (const [label, options] of [
  ['active combat', { combatUntil: 16 }],
  ['exact combat expiry', { combatUntil: 10 }],
  ['mounted', { mount: {} }],
  ['running at the existing calm cutoff', { _anSp: 7.4 }],
  ['sprinting', { _anSp: 8 }],
]) test('UI and actual feed agree that taming is unavailable: ' + label, () => {
  const f = fixture(options); f.settle(); const before = f.snapshot();
  assert.equal(f.interaction(), null);
  f.ctx.anOffer(f.wild); f.ctx.anOffer(f.wild);
  assert.deepEqual(f.snapshot(), before, 'repeated direct feeds retain the existing refusal without costs or trust');
  assert.deepEqual(f.errors, Array(2).fill('Calm down first: on foot, out of the fight, walking'));
});

test('the ordinary calm feed returns just after combat expiry, with its original cost, trust and pause', () => {
  const f = fixture({ combatUntil: 10 }); f.settle();
  assert.equal(f.interaction(), null);
  f.ctx.GAME.t = 10.001;
  const it = f.interaction(); assert.match(it.label, /^Offer apple to the wild boar \(trust 0\/3\)$/);
  it.act();
  assert.equal(f.inventory.apple, 5); assert.equal(f.inventory.meat_raw, 6);
  assert.equal(f.trust().n, 1); assert.equal(f.trust().last, 10.001); assert.equal(f.trust().settle, 1);
  assert.equal(f.wild.ai.tameHold, f.ctx.GAME.t + 6);
  assert.deepEqual(f.effects.filter(row => row[0] === 'cost'), [['cost', 'apple', 1]]);
  assert.deepEqual(f.effects.filter(row => row[0] === 'note'), [['note', 'tame']]);
  assert.equal(f.effects.some(row => row[0] === 'tame'), false);
  assert.deepEqual(f.errors, []); assert.deepEqual(f.requests, []);
});

test('calm walking below the existing cutoff still permits feeding', () => {
  const f = fixture({ _anSp: 7.399 }); f.settle();
  assert.match(f.interaction().label, /^Offer apple/); f.interaction().act();
  assert.equal(f.inventory.apple, 5); assert.equal(f.trust().n, 1);
});

test('the existing wary instruction and refusal remain discoverable outside combat', () => {
  const f = fixture(); const before = f.snapshot();
  assert.match(f.interaction().label, /trust 0\/3, wary/); f.interaction().act();
  assert.deepEqual(f.snapshot(), before); assert.deepEqual(f.errors, ['It is still wary of you. Stand still a moment.']);
});

test('successful calm feeding keeps the five-second eating cooldown and completion threshold', () => {
  const f = fixture(); f.settle();
  for (let i = 0; i < 3; i++) {
    f.ctx.GAME.t = 10 + i * 5; f.interaction().act();
    assert.equal(f.trust().n, i + 1); assert.equal(f.inventory.apple, 5 - i);
    const before = f.snapshot(); f.ctx.anOffer(f.wild); assert.deepEqual(f.snapshot(), before);
  }
  assert.deepEqual(f.effects.filter(row => row[0] === 'tame'), [['tame', f.wild.id, 'pig']]);
  assert.deepEqual(f.errors, Array(3).fill('It is still eating'));
});

test('a calm wolf still selects its actual preferred food and four-feed trust requirement', () => {
  const f = fixture(); Object.assign(f.wild, { mobType: 'wolf', name: 'young wolf' }); f.settle();
  assert.match(f.interaction().label, /^Offer raw meat to the young wolf \(trust 0\/4\)$/); f.interaction().act();
  assert.equal(f.inventory.meat_raw, 5); assert.equal(f.inventory.apple, 6); assert.equal(f.trust().n, 1);
});

test('food and shared-animal refusal paths remain unchanged', () => {
  const f = fixture(); f.settle(); f.inventory.apple = 0;
  assert.match(f.interaction().label, /^Offer apple/); f.interaction().act();
  assert.equal(f.trust().n, 0); assert.deepEqual(f.errors, ['It wants apple or grain']);
  f.inventory.apple = 6; f.errors.length = 0;
  f.ctx.netWorldPartsActive = () => true; f.ctx.anSharedWorldCanSimulate = () => false;
  const before = f.snapshot(); f.interaction().act(); assert.deepEqual(f.snapshot(), before);
  assert.deepEqual(f.errors, ['Waiting for the shared animal.']);
  f.wild.netEntityId = 'scene:boar:2'; f.errors.length = 0; f.interaction().act();
  assert.equal(f.requests.length, 1); assert.equal(f.requests[0][0], 'animal.offer');
  assert.equal(f.inventory.apple, 6); assert.equal(f.trust().n, 0);
});

for (const owner of ['player', 'town']) test('combat does not hide an existing ' + owner + ' animal card', () => {
  const f = fixture({ combatUntil: 16 });
  f.entities.push({ id: 3, role: 'animal', alive: true, x: 1, z: 0, radius: 0.5, tame: { owner, k: 'pig', name: 'Moss' } });
  const it = f.interaction(); assert.match(it.label, owner === 'player' ? /^Moss the pig$/ : /^Look at the pig \(Moss\)$/); it.act();
  assert.deepEqual(f.opened, [['card', 3]]); assert.equal(f.state.trust.size, 0);
});

test('combat leaves the own paddock, tending and same-realm herder offers unchanged', () => {
  const f = fixture({ combatUntil: 16 });
  const own = { id: 5, owner: 'player', name: 'Own', gateOut: { x: 1, z: 0 }, rack: { x: 1, z: 0 }, trough: { x: 1, z: 0 }, feed: 2, water: 3, manure: 4 };
  const herd = { id: 6, owner: 'town', realm: 0, name: 'Glenrua', gateOut: { x: 1, z: 0 } };
  const foreign = { ...herd, id: 7, realm: 1 };
  f.state.pens.push(own, herd, foreign); const offers = [];
  f.ctx.animalOffers(f.P, (d, range, label, act) => { if (d < range) offers.push({ label, act }); });
  assert.deepEqual(offers.map(it => it.label), ['Your paddock (feed 2, water 3, manure 4)', 'Tend the paddock', "The herder's board at Glenrua"]);
  for (const it of offers) it.act();
  assert.deepEqual(f.opened, [['pen', 5], ['pen', 5], ['herder', 6]]);
});

test('combat and mounted fence placement retain their original high-priority offer', () => {
  const f = fixture({ combatUntil: 16, mount: {} }); f.state.marking = {};
  const it = f.interaction(); assert.equal(it.label, 'Fence the paddock here'); it.act(); assert.deepEqual(f.opened, [['fence']]);
});

test('suppressing a combat feeding offer leaves another real E choice available', () => {
  const f = fixture({ combatUntil: 16 }); f.ctx.houseOffers = (P, offer) => offer(1, 3, 'Open the door', () => f.opened.push(['door']));
  const it = f.interaction(); assert.equal(it.label, 'Open the door'); it.act(); assert.deepEqual(f.opened, [['door']]);
});
