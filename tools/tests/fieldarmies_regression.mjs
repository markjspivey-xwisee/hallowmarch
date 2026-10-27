// Run: node --test tools/tests/fieldarmies_regression.mjs
// Exercise the server's lease manager with the real strategic realm module.
import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { makeField } from '../../server/fieldarmies.js';
const require = createRequire(import.meta.url);
const M = require('../../src/08m_realm.js');

function fixture() {
  const RS = M.realmSimInit(7);
  RS.phase = 'war'; RS.realms[2].lev = 40; RS.realms[2].aim = 0;
  assert.equal(M.realmSimOrder(RS, 2, { type: 'muster' }, { name: 'fixture', rank: 9 }), true);
  const army = RS.armies.find(x => x.r === 2 && x.k === 0);
  const WORLD = {
    SITES: [
      ...M.RSM_GEO.muster.map((p, realm) => ({ kind: 'muster', realm, x: p[0], z: p[1] })),
      ...M.RSM_GEO.temple.map((p, realm) => ({ kind: 'temple', realm, x: p[0], z: p[1] })),
    ],
    keeps: M.RSM_GEO.keep.map(p => ({ x: p[0], z: p[1] })),
  };
  const room = { regions: { f: 'a' }, clients: new Map() };
  const clients = ['a', 'b'].map(peer => ({ peer, realm: 0,
    slow: { realmManagement: 1, seasonField: 2 }, pos: { ...WORLD.keeps[0] }, region: 'f', ws: { readyState: 1 }, room }));
  for (const c of clients) room.clients.set(c.peer, c);
  const season = { RS, M, dirty: false, fieldGrantConfirmed: () => true }, sent = [];
  const field = makeField(season, new Map([['march', room]]),
    (c, message) => sent.push([c.peer, message]), () => 'f', WORLD, {});
  field.step();
  const report = (c, m) => field.report(c, { ...m, season: RS.n, fieldLease: field.held.get(m.id)?.lease });
  return { RS, army, room, clients, field, sent, report };
}

test('only the region keeper holds and reports an army; losses cannot create soldiers', () => {
  const { army, clients: [a, b], field, sent, report } = fixture();
  assert.equal(field.held.size, 1);
  assert.equal(army.onField.who, 'peer:a');
  assert.equal(sent.filter(x => x[1].t === 'sarmy').length, 1);
  const n = army.n;
  report(b, { id: army.id, rep: { n: 0, done: 'fallen' } });
  assert.equal(army.n, n);
  assert.equal(field.stats.refused, 1);
  report(a, { id: army.id, rep: { n: n - 6, p: 0.25 } });
  assert.equal(army.n, n - 6);
  assert.equal(army.p, 0.25);
  report(a, { id: army.id, rep: { n: n + 100 } });
  assert.equal(army.n, n - 6);
});

test('an unknown completion cannot orphan an active lease', () => {
  const { army, clients: [a], field, report } = fixture();
  report(a, { id: army.id, rep: { done: 'invalid' } });
  assert.equal(army.onField.who, 'peer:a');
  assert.equal(field.held.size, 1);
  field.step();
  assert.equal(field.held.size, 1);
});

test('a region handover transfers one lease and disconnect folds it back', () => {
  const { army, room, clients: [a, b], field, sent, report } = fixture();
  room.regions.f = 'b';
  field.step();
  assert.equal(field.held.size, 1);
  assert.equal(army.onField.who, 'peer:b');
  assert.equal(sent.filter(x => x[0] === 'a' && x[1].t === 'sarmyfold').length, 1);
  assert.equal(sent.filter(x => x[0] === 'b' && x[1].t === 'sarmy').length, 1);
  room.clients.delete(b.peer);
  field.left(b);
  assert.equal(field.held.size, 0);
  assert.equal(army.onField, null);
});

test('a valid completion releases the tracked lease and the season army', () => {
  const { RS, army, clients: [a], field, report } = fixture();
  report(a, { id: army.id, rep: { n: 0, done: 'fallen' } });
  assert.equal(field.held.size, 0);
  assert.equal(RS.armies.some(x => x.id === army.id), false);
});
