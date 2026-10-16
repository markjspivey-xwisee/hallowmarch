import test from 'node:test';
import assert from 'node:assert/strict';
import { mainWorldAgentAffordances } from './main-world-agents.js';
import { nativeAgentMetadataGraph } from './native-agent-http.js';

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
