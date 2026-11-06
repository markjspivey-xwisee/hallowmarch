import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { analyzeGameplayPatterns } from '../../client/native-pod/gameplay-patterns.mjs';

const require = createRequire(import.meta.url), Ajv = require('ajv');
const profile = JSON.parse(await readFile(new URL('../../server/gaming/gameplay-activity-profile.jsonld', import.meta.url), 'utf8'));
const legacyBytes = await readFile(new URL('../../server/gaming/gameplay-activity-profile-1.0.0.jsonld', import.meta.url));
const legacy = JSON.parse(legacyBytes);
const source = process.env.HM_GAMEPLAY_ACTIVITY_MODULE || new URL('../../client/native-pod/gameplay-activity.mjs', import.meta.url).href;
const core = await import(source);
const NS = 'urn:interego:gaming:activity:', DID = 'did:web:identity.interego.xwisee.com:users:synthetic-profile-test';
const UUID = '8bb38ad2-c605-4ba6-956c-168fa3c825df', VERSION = profile.versions[0].id;
const ajv = new Ajv({ allErrors: true });
const validators = selected => Object.fromEntries(selected.concepts.filter(c => c.inlineSchema).map(c => [c.id, ajv.compile(JSON.parse(c.inlineSchema))]));
const extensionValidators = new Map([[profile, validators(profile)], [legacy, validators(legacy)]]);

// These are the JSONPath forms actually used by this profile, not an xAPI validator.
function located(statement, location) {
  const tokens = [...location.matchAll(/\.([A-Za-z][A-Za-z0-9_]*)|\['([^']+)'\]|\[(\*)\]/g)].map(m => m[1] || m[2] || m[3]);
  let values = [statement];
  for (const token of tokens) values = values.flatMap(value => token === '*' ? Array.isArray(value) ? value : []
    : value && Object.hasOwn(value, token) ? [value[token]] : []);
  return values;
}
function checkStatement(statement, selected = profile) {
  const template = selected.templates.find(t => t.verb === statement.verb.id);
  assert.ok(template, 'known observed verb');
  assert.equal(statement.object.definition.type, template.objectActivityType);
  for (const rule of template.rules) {
    const found = located(statement, rule.location);
    if (rule.presence === 'included') assert.ok(found.length, rule.location);
    if (rule.presence === 'excluded') assert.equal(found.length, 0, rule.location);
    if (rule.all) for (const item of found) assert.ok(rule.all.some(value => JSON.stringify(item) === JSON.stringify(value)), rule.location);
    if (rule.any) assert.ok(found.some(item => rule.any.some(value => JSON.stringify(item) === JSON.stringify(value))), rule.location);
  }
  for (const [kind, location] of [['ContextExtension', statement.context.extensions], ['ResultExtension', statement.result.extensions]]) {
    for (const concept of selected.concepts.filter(c => c.type === kind)) {
      assert.ok(Object.hasOwn(location, concept.id));
      const validate = extensionValidators.get(selected)[concept.id];
      assert.equal(validate(location[concept.id]), true, JSON.stringify(validate.errors));
    }
  }
}
function event(type, extra = {}) {
  return { schema: core.GAMEPLAY_EVENT_SCHEMA, id: 'urn:uuid:' + UUID, sessionId: UUID, sequence: 1, ordinal: 1,
    type, observedAt: '2026-10-17T03:00:00.000Z', body: { id: 'synthetic-body', kind: 'character' },
    actor: type === 'agent.command-accepted' ? { kind: 'agent', id: 'did:web:identity.interego.xwisee.com:agents:synthetic-agent', grantId: 'urn:uuid:' + UUID } : { kind: 'human-input' },
    object: { id: 'synthetic-object', kind: type.split('.')[0] }, result: type.endsWith('.refused') ? { success: false, reason: 'unavailable' } : type === 'agent.command-accepted' ? { success: true } : {},
    context: { party: false, realm: 0, level: 1 }, ...extra };
}

test('Profile metadata, native module constants and all emitted vocabulary agree', () => {
  assert.equal(profile.id, core.GAMEPLAY_ACTIVITY_PROFILE);
  assert.equal(VERSION, core.GAMEPLAY_ACTIVITY_PROFILE_VERSION);
  assert.equal(profile['@context'], 'https://w3id.org/xapi/profiles/context');
  assert.equal(profile.type, 'Profile');
  assert.equal(profile.conformsTo, 'https://w3id.org/xapi/profiles#1.0');
  assert.ok(profile.author.name && ['Organization', 'Person'].includes(profile.author.type));
  assert.ok(Number.isFinite(Date.parse(profile.versions[0].generatedAtTime)));
  assert.deepEqual(profile.concepts.filter(c => c.type === 'Verb').map(c => c.id).sort(), core.GAMEPLAY_EVENT_TYPES.map(k => NS + 'verb:' + k).sort());
  assert.equal(profile.templates.length, core.GAMEPLAY_EVENT_TYPES.length);
});

test('1.0.0 stays unchanged across platform line endings and old stored events keep their exact historical category', () => {
  assert.equal(createHash('sha256').update(legacyBytes.toString('utf8').replace(/\r\n/g, '\n')).digest('hex'), 'c74b4a9bb66b6643aca8bb34707d1ce2f88080c4e26de329e4c78c21780139ac');
  assert.deepEqual(profile.versions[0].wasRevisionOf, [legacy.versions[0].id]);
  assert.equal(legacy.versions[0].id, core.GAMEPLAY_ACTIVITY_PROFILE_LEGACY_VERSION);
  const original = event('resource.gathered'); original.schema = core.GAMEPLAY_EVENT_LEGACY_SCHEMA;
  const statement = core.gameplayActivityStatement(original, DID);
  checkStatement(statement, legacy);
  assert.equal(statement.context.contextActivities.category[0].id, legacy.versions[0].id);
  const fresh = core.gameplayActivityStatement(event('resource.gathered'), DID);
  assert.deepEqual({ ...statement, context: { ...statement.context, contextActivities: fresh.context.contextActivities } }, fresh);
  const semantics = selected => selected.concepts.map(({ inScheme, ...concept }) => concept);
  assert.deepEqual(semantics(profile), semantics(legacy), 'concept meanings and extension schemas stay stable');
  assert.ok(profile.templates.every(template => !legacy.templates.some(previous => previous.id === template.id)));
  assert.ok(profile.patterns.every(pattern => !legacy.patterns.some(previous => previous.id === pattern.id)));
});

test('All references resolve in one immutable version and the pattern graph is acyclic', () => {
  const parts = [...profile.concepts, ...profile.templates, ...profile.patterns], ids = new Set(parts.map(p => p.id));
  assert.equal(ids.size, parts.length);
  for (const p of parts) assert.equal(p.inScheme, VERSION);
  for (const template of profile.templates) {
    assert.ok(ids.has(template.verb)); assert.ok(ids.has(template.objectActivityType));
    assert.ok(template.prefLabel.en && template.definition.en);
  }
  const byId = new Map([...profile.templates, ...profile.patterns].map(p => [p.id, p]));
  const operators = ['alternates', 'optional', 'oneOrMore', 'sequence', 'zeroOrMore'];
  function visit(id, chain = []) {
    assert.ok(byId.has(id), 'known pattern/template reference'); assert.ok(!chain.includes(id), 'no pattern cycle');
    const p = byId.get(id); if (p.type === 'StatementTemplate') return;
    const keys = operators.filter(k => Object.hasOwn(p, k)); assert.equal(keys.length, 1);
    if (p.primary) assert.ok(p.prefLabel.en && p.definition.en);
    const targets = Array.isArray(p[keys[0]]) ? p[keys[0]] : [p[keys[0]]];
    assert.ok(targets.length >= (keys[0] === 'alternates' ? 2 : 1));
    for (const target of targets) visit(target, [...chain, id]);
  }
  for (const p of profile.patterns) visit(p.id);
  assert.equal(profile.patterns.filter(p => p.primary).length, 1);
});

test('Every actual module projection satisfies its template and draft-07 extension schemas', () => {
  for (const type of core.GAMEPLAY_EVENT_TYPES) checkStatement(core.gameplayActivityStatement(event(type), DID));
  checkStatement(core.gameplayActivityStatement(event('combat.defeated', {
    body: { id: 'synthetic-owned-unit', kind: 'owned-unit' },
    actor: { kind: 'agent', id: 'did:web:identity.interego.xwisee.com:agents:synthetic-agent', grantId: 'urn:uuid:' + UUID },
    result: { quantity: 1, success: true }, context: { party: true, realm: 2, level: 50, attemptId: UUID, interventionId: 'one-foe-practice' }
  }), DID));
});

test('real ordered observation sequences validate both immutable versions and current secondary motifs', () => {
  const previous = event('craft.refused', { ordinal: 1 });
  const next = event('craft.completed', { id: 'urn:uuid:8bb38ad2-c605-4ba6-956c-168fa3c825d0', ordinal: 2 });
  const statements = [next, previous].map(value => core.gameplayActivityStatement(value, DID));
  const result = analyzeGameplayPatterns(statements, [profile, legacy]);
  assert.equal(result.status, 'matched');
  assert.equal(result.partitions[0].primary.status, 'matched');
  assert.equal(result.partitions[0].motifs.find(pattern => pattern.id.endsWith('/craft-recovery')).status, 'matched');
  next.schema = core.GAMEPLAY_EVENT_LEGACY_SCHEMA;
  const split = analyzeGameplayPatterns([core.gameplayActivityStatement(previous, DID), core.gameplayActivityStatement(next, DID)], [profile, legacy]);
  assert.equal(split.partitions.length, 2);
  assert.equal(split.partitions[0].motifs.find(pattern => pattern.id.endsWith('/craft-recovery')).status, 'incomplete');
});

test('Wrong event, provenance, level, controller identity and added secret fields fail the profile schemas', () => {
  const statement = core.gameplayActivityStatement(event('ability.executed'), DID);
  for (const [extension, key, value] of [
    ['context', 'eventType', 'combat.learned'], ['context', 'schema', 'invented'], ['context', 'realm', 3],
    ['context', 'level', 51], ['context', 'controllerKind', 'agent'], ['context', 'token', 'must-not-be-retained'],
    ['observation', 'authority', 'server-verified'], ['observation', 'competencyStatus', 'mastered'],
    ['observation', 'quantity', -1], ['observation', 'historyOrdinal', 0], ['observation', 'reason', 'free transcript']
  ]) {
    const changed = structuredClone(statement), target = extension === 'context' ? changed.context.extensions[NS + 'context'] : changed.result.extensions[NS + 'observation'];
    target[key] = value; assert.throws(() => checkStatement(changed), key);
  }
  const refused = core.gameplayActivityStatement(event('craft.refused'), DID); refused.result.success = true;
  assert.throws(() => checkStatement(refused));
  for (const type of ['agent.command-accepted', 'intervention.started']) {
    const changed = core.gameplayActivityStatement(event(type), DID); changed.result.completion = true;
    assert.throws(() => checkStatement(changed));
  }
});

test('Verified agent control preserves the observing owner actor and accepted input is not completion', () => {
  const controllerDid = 'did:web:identity.interego.xwisee.com:agents:synthetic-agent';
  for (const type of ['combat.defeated', 'agent.command-accepted']) {
    const statement = core.gameplayActivityStatement(event(type, {
      body: { id: 'synthetic-owned-unit', kind: 'owned-unit' },
      actor: { kind: 'agent', id: controllerDid, grantId: 'urn:uuid:' + UUID }, result: { success: true }
    }), DID);
    checkStatement(statement); assert.equal(statement.actor.account.name, DID);
    const context = statement.context.extensions[NS + 'context'];
    assert.equal(context.controllerKind, 'agent'); assert.equal(context.controllerId, controllerDid);
    assert.equal(context.grantId, 'urn:uuid:' + UUID);
    if (type === 'agent.command-accepted') {
      assert.equal(statement.result.success, true); assert.equal(Object.hasOwn(statement.result, 'completion'), false);
    }
  }
  for (const input of [
    event('agent.command-accepted', { actor: { kind: 'human-input' } }),
    event('agent.command-accepted', { actor: { kind: 'agent', id: controllerDid } }),
    event('agent.command-accepted', { result: { success: false } })
  ]) assert.throws(() => checkStatement(core.gameplayActivityStatement(input, DID)));
});

test('LRS enrichment does not invalidate the same Profile version category', () => {
  const statement = core.gameplayActivityStatement(event('resource.gathered'), DID);
  statement.authority = { objectType: 'Agent', account: { homePage: 'https://lrs.example', name: 'test-lrs' } };
  statement.stored = '2026-10-17T03:00:01.000Z'; checkStatement(statement);
});

test('ADL Profile source values have no empty or null metadata', () => {
  function check(value) {
    assert.notEqual(value, null); assert.notEqual(value, '');
    if (value && typeof value === 'object') {
      assert.ok(Object.keys(value).length, 'nonempty metadata container');
      for (const child of Object.values(value)) check(child);
    }
  }
  check(profile);
});
