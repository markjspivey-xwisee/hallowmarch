import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { loadRealmModule } from '../season.js';
import { checkedWorldSnapshot, hallowmarchWorldDescription } from './hallowmarch-world-state.js';

const root = new URL('../../', import.meta.url).pathname;
const realmModule = loadRealmModule(root + 'src', root + 'server');
const season = () => ({ ...realmModule.realmSimInit(19, { season: 1 }), savedAt: Date.now() });
const options = { keepCount: 6, realmModule };

test('domain snapshot permits only the world/season pair, omits optional undefined JSON fields and accepts generated shard names', () => {
  const value = checkedWorldSnapshot({ worlds: { ['x'.repeat(32) + '-99']: { k: [0, 0, 1, 1, 2, 2], cl: undefined } }, season: season() }, options);
  assert.equal(Object.hasOwn(value.worlds['x'.repeat(32) + '-99'], 'cl'), false);
  for (const extra of ['accounts', 'credentials', 'playerSave', 'roster', 'chat', 'companies', 'learning']) {
    assert.throws(() => checkedWorldSnapshot({ worlds: {}, season: season(), [extra]: {} }, options), { code: 'INVALID_WORLD_STATE' });
  }
});

test('domain snapshot rejects unknown room fields and invalid strategic input before a sanitizer could replace it with a fresh season', () => {
  for (const value of [{ worlds: { march: { personalSave: {} } }, season: season() },
    { worlds: {}, season: { v: 1, n: 1, t: 0, len: 100, realms: [], keeps: [] } },
    { worlds: {}, season: { ...season(), realms: [{}, {}, {}] } },
    { worlds: { march: { k: [0, 1] } }, season: season() },
    { worlds: { march: { cn: Infinity } }, season: season() }]) {
    assert.throws(() => checkedWorldSnapshot(value, options), { code: 'INVALID_WORLD_STATE' });
  }
});

test('world bridge advertises a public read-only operation and keeps game authority limits explicit', () => {
  const value = hallowmarchWorldDescription('https://game.example');
  const operations = value.description['hydra:supportedOperation']; assert.equal(operations.length, 1);
  assert.equal(operations[0]['hydra:method'], 'GET'); assert.equal(operations[0]['hydra:target']['@id'], 'https://game.example/gaming/world-state');
  assert.match(value.graphContent, /does not add authoritative combat/); assert.doesNotMatch(value.graphContent, /i2idl|privateKey|accessToken/);
  for (const origin of ['https://game.example/path', 'http://other.example', 'https://name:secret@game.example', 'https://game.example/?x=1']) assert.throws(() => hallowmarchWorldDescription(origin));
});

test('actual pinned Interego affordance extraction discovers the composed world status operation', { skip: !process.env.INTEREGO_SDK_TEST_ROOT }, async () => {
  const core = await import(pathToFileURL(process.env.INTEREGO_SDK_TEST_ROOT + '/packages/core/dist/index.js').href);
  const value = hallowmarchWorldDescription('https://game.example');
  const actions = core.extractAffordancesFromTurtle(value.graphContent, 'https://game.example/gaming/world-state/descriptor');
  assert.equal(actions.length, 1); assert.equal(actions[0].action, 'urn:hallowmarch:world:status');
  assert.equal(actions[0].method, 'GET'); assert.equal(actions[0].target, 'https://game.example/gaming/world-state');
});
