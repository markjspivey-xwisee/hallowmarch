import test from 'node:test';
import assert from 'node:assert/strict';
import { mainWorldAgentAffordances } from './main-world-agents.js';
import { nativeAgentMetadataGraph } from './native-agent-http.js';
import { GAMEPLAY_ACTIVITY_PROFILE, GAMEPLAY_ACTIVITY_PROFILE_VERSION, GAMEPLAY_MILESTONES, GAMEPLAY_INTERVENTIONS } from '../../client/native-pod/gameplay-activity.mjs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const sdk = process.env.INTEREGO_SDK_TEST_ROOT ? await import(pathToFileURL(resolve(process.env.INTEREGO_SDK_TEST_ROOT, 'packages/core/dist/index.js'))) : null;

test('native discovery preserves the executable HTTP method of every main-world operation', () => {
  const document = mainWorldAgentAffordances({ publicOrigin: 'https://game.example',
    applicationId: 'did:web:identity.example:users:march', enabled: true });
  const graph = nativeAgentMetadataGraph(document);
  const operation = document.operations.find(op => op['@id'].endsWith('#ownerReferences'));
  assert.equal(operation['hydra:method'], 'GET');
  assert.ok(graph.includes('<https://game.example/world/native-agents> dct:relation <https://game.example/gaming/resources/descriptor.ttl>'));
  assert.ok(graph.includes('dct:relation <https://foxxi-bridge.interego.xwisee.com/agent/contextualize-and-plan/affordance>'));
  for (const op of document.operations) {
    const line = graph.split('\n').find(line => line.startsWith(`<${op['@id']}> a hydra:Operation`));
    assert.ok(line, op['@id']);
    assert.ok(line.includes(`hydra:method ${JSON.stringify(op['hydra:method'])} ;`), op['@id']);
    assert.ok(line.includes(`hydra:target <${op['hydra:target']}>`), op['@id']);
  }
});

test('main-world discovery separates an AI party body from player possession and observed progress from assessment', () => {
  const options = { publicOrigin: 'https://game.example', applicationId: 'did:web:identity.example:users:march', enabled: true };
  const doc = mainWorldAgentAffordances(options), support = doc.performanceSupport, graph = nativeAgentMetadataGraph(doc);
  assert.equal(doc.bodySelection.default, 'separate-owned-party-unit');
  assert.deepEqual(doc.bodySelection.options, ['separate-owned-party-unit', 'owned-animal']);
  assert.match(doc.agentClient.scope, /human character remains player-controlled/);
  assert.match(doc.execution, /accepted input from completed execution/); assert.match(doc.bodySelection.execution, /no independent avatar or offline/);
  assert.equal(support.activityProfile, 'https://game.example/gaming/activity-profile.jsonld');
  assert.equal(support.activityProfileCanonical, GAMEPLAY_ACTIVITY_PROFILE); assert.equal(support.activityProfileVersion, GAMEPLAY_ACTIVITY_PROFILE_VERSION);
  assert.equal(support.activityArchiveModule, 'https://game.example/gaming/identity/assets/gameplay-activity-archive.mjs');
  assert.equal(support.activity.storage, 'encrypted-observing-owner-pod'); assert.equal(support.activity.actor, 'authenticated-observing-owner');
  assert.equal(support.activity.controllerIdentity, 'context-only'); assert.equal(support.activity.competencyStatus, 'not-assessed');
  assert.equal(support.activity.lrsConformanceClaim, false);
  assert.deepEqual(support.milestoneCatalog.milestones, GAMEPLAY_MILESTONES); assert.deepEqual(support.milestoneCatalog.interventions, GAMEPLAY_INTERVENTIONS);
  assert.equal(support.milestoneCatalog.scope, 'observed-game-progress');
  for (const url of [support.activityProfile, support.activityProfileVersion, support.activityArchiveModule]) assert.ok(graph.includes(`dct:relation <${url}>`));
  support.milestoneCatalog.milestones[0].resources.push('mutated');
  support.milestoneCatalog.interventions[0].note = 'mutated';
  const fresh = mainWorldAgentAffordances(options).performanceSupport;
  assert.deepEqual(fresh.milestoneCatalog.milestones, GAMEPLAY_MILESTONES); assert.deepEqual(fresh.milestoneCatalog.interventions, GAMEPLAY_INTERVENTIONS);
});

test('actual native RDF retains the complete public activity and body-selection contract', { skip: !sdk }, () => {
  const doc = mainWorldAgentAffordances({ publicOrigin: 'https://game.example', applicationId: 'urn:game:march', enabled: true });
  const graph = nativeAgentMetadataGraph(doc), parsed = sdk.parseTrig(graph);
  assert.ok(sdk.canonicalGraphDigest(graph));
  const subject = parsed.subjects.find(s => s.subject === doc['@id']);
  const encoded = subject.properties.get('http://www.w3.org/1999/02/22-rdf-syntax-ns#value')[0];
  assert.deepEqual(JSON.parse(encoded.value), doc);
  const relations = subject.properties.get('http://purl.org/dc/terms/relation').map(term => term.iri);
  assert.ok(relations.includes(GAMEPLAY_ACTIVITY_PROFILE_VERSION));
  assert.equal(subject.properties.has('http://purl.org/dc/terms/conformsTo'), false);
});
