import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { committedGameplayStatements, COMMITTED_GAMEPLAY_EVENT_TYPES, COMMITTED_GAMEPLAY_PROFILE,
  COMMITTED_GAMEPLAY_PROFILE_VERSION, GAMING_NS } from './learning.js';

const require = createRequire(new URL('../../tools/package.json', import.meta.url));
const Ajv = require('ajv'), ajv = new Ajv({ allErrors: true });
const profile = JSON.parse(readFileSync(new URL('./committed-gameplay-profile.jsonld', import.meta.url), 'utf8'));
const validators = new Map(profile.concepts.filter(c => c.inlineSchema).map(c => [c.id, ajv.compile(JSON.parse(c.inlineSchema))]));
const subjectDid = 'did:example:committed-profile-test', registration = '413f08a1-0347-46e5-b06b-dfd6785474b4';
const options = { domain: 'hallowmarch', gameId: 'synthetic-profile-run', subjectDid, registration };
const event = (kind, version = 1) => ({ id: 'synthetic-event-' + version, streamId: 'synthetic-stream', version,
  actorId: subjectDid, kind, at: '2026-10-27T19:00:00.000Z', payload: { amount: 1, quantity: 1, rttMs: 2 } });

// Only the JSONPath forms in this one Profile are evaluated here. This is a
// projection-contract regression test, not a general xAPI conformance validator.
function located(statement, location) {
  const tokens = [...location.matchAll(/\.([A-Za-z][A-Za-z0-9_]*)|\['([^']+)'\]|\[(\*)\]/g)].map(m => m[1] || m[2] || m[3]);
  let values = [statement];
  for (const token of tokens) values = values.flatMap(value => token === '*' ? Array.isArray(value) ? value : []
    : value && Object.hasOwn(value, token) ? [value[token]] : []);
  return values;
}
function check(statement) {
  const template = profile.templates.find(t => t.verb === statement.verb.id);
  assert.ok(template, 'supported verb');
  assert.equal(statement.object.definition.type, template.objectActivityType);
  for (const rule of template.rules) {
    const values = located(statement, rule.location);
    if (rule.presence === 'included') assert.ok(values.length, rule.location);
    if (rule.presence === 'excluded') assert.equal(values.length, 0, rule.location);
    if (rule.all) for (const wanted of rule.all) assert.ok(values.some(value => JSON.stringify(value) === JSON.stringify(wanted)), rule.location);
    if (rule.any) assert.ok(values.some(value => rule.any.includes(value)), rule.location);
  }
  for (const [id, value] of Object.entries(statement.context.extensions)) {
    const validate = validators.get(id); assert.ok(validate, 'no undeclared extension');
    assert.equal(validate(value), true, id + ': ' + JSON.stringify(validate.errors));
  }
}

test('committed Profile and explicit API agree on version, supported kinds and broad primary stream', () => {
  assert.equal(profile.id, COMMITTED_GAMEPLAY_PROFILE);
  assert.equal(profile.versions[0].id, COMMITTED_GAMEPLAY_PROFILE_VERSION);
  assert.equal(profile['@context'], 'https://w3id.org/xapi/profiles/context');
  assert.equal(profile.conformsTo, 'https://w3id.org/xapi/profiles#1.0');
  assert.deepEqual(profile.concepts.filter(c => c.type === 'Verb').map(c => c.id), COMMITTED_GAMEPLAY_EVENT_TYPES.map(kind => GAMING_NS + 'verbs/' + kind));
  assert.equal(profile.templates.length, COMMITTED_GAMEPLAY_EVENT_TYPES.length);
  const ids = new Set([...profile.concepts, ...profile.templates, ...profile.patterns].map(c => c.id));
  assert.equal(ids.size, profile.concepts.length + profile.templates.length + profile.patterns.length);
  for (const item of [...profile.concepts, ...profile.templates, ...profile.patterns]) assert.equal(item.inScheme, COMMITTED_GAMEPLAY_PROFILE_VERSION);
  for (const template of profile.templates) { assert.ok(ids.has(template.verb)); assert.ok(ids.has(template.objectActivityType)); }
  const [alternate, stream] = profile.patterns;
  assert.deepEqual(alternate.alternates, profile.templates.map(t => t.id));
  assert.equal(stream.primary, true); assert.equal(stream.oneOrMore, alternate.id);
  assert.equal(Object.hasOwn(stream, 'sequence'), false, 'partial committed windows do not invent lifecycle events');
});

test('every actual explicit committed projection satisfies its template and closed extension schemas', () => {
  for (const kind of COMMITTED_GAMEPLAY_EVENT_TYPES) check(committedGameplayStatements([event(kind)], options)[0]);
  const delegated = event('damage'); delegated.agentId = 'did:example:controller';
  check(committedGameplayStatements([delegated], options)[0]);
  const enriched = committedGameplayStatements([event('damage')], options)[0];
  enriched.authority = { objectType: 'Agent', account: { homePage: 'https://lrs.example', name: 'synthetic-lrs' } };
  enriched.stored = '2026-10-27T19:00:01.000Z'; check(enriched);
});

test('committed Profile rejects provenance promotion, secret fields, learning claims and missing registration', () => {
  const base = committedGameplayStatements([event('damage')], options)[0];
  for (const mutate of [
    s => { s.context.extensions[GAMING_NS + 'source'].authority = 'owner-browser-observation'; },
    s => { s.context.extensions[GAMING_NS + 'source'].token = 'must-not-retain'; },
    s => { s.context.extensions[GAMING_NS + 'source'].version = 0; },
    s => { s.context.extensions[GAMING_NS + 'measured'].metrics.skill = 1; },
    s => { s.context.extensions[GAMING_NS + 'competencyStatus'] = 'mastered'; },
    s => { s.context.extensions[GAMING_NS + 'measured'].metrics.damageDealt = -1; },
    s => { delete s.context.registration; },
    s => { s.context.contextActivities.category[0].id = COMMITTED_GAMEPLAY_PROFILE; },
    s => { s.result = { success: true }; }
  ]) {
    const changed = structuredClone(base); mutate(changed); assert.throws(() => check(changed));
  }
});
