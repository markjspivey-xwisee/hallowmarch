/** A derived, private evidence view. No writes, network calls or achievement claims. */
import { gameplayActivityStatement, validateGameplayActivityEvent } from './gameplay-activity.mjs';

export const GAMEPLAY_SEMANTIC_SOURCE = Object.freeze({
  release: 'v0.0.93', commit: 'b75261de5ad7851c1f61607091cc00e486bbbb5f',
  glossary: 'https://id.i2idl.org/scheme',
  vocabulary: 'https://relay.interego.xwisee.com/ns/u-pk-33d42e6b33dc/i2idlx',
  mappingStatus: 'Hypothetical',
});

export function gameplayEvidenceGraph(events, ownerDid) {
  if (!Array.isArray(events) || events.length > 64) throw new TypeError('Select at most 64 retained gameplay observations.');
  const nodes = [], seen = new Map();
  for (const input of events) {
    const event = validateGameplayActivityEvent(input), statement = gameplayActivityStatement(event, ownerDid);
    const encoded = JSON.stringify(statement);
    if (seen.has(statement.id)) {
      if (seen.get(statement.id) !== encoded) throw new TypeError('Conflicting evidence for the same statement identifier.');
      continue;
    }
    seen.set(statement.id, encoded);
    const recordId = 'urn:uuid:' + statement.id, occurrenceId = 'urn:interego:gaming:observation:' + statement.id;
    nodes.push({ '@id': occurrenceId, '@type': 'prov:Activity',
      'prov:startedAtTime': { '@value': event.observedAt, '@type': 'http://www.w3.org/2001/XMLSchema#dateTime' }, 'gaming:eventType': event.type,
      'gaming:bodyId': event.body.id, 'gaming:bodyKind': event.body.kind,
      'gaming:controllerKind': event.actor.kind,
      ...(event.actor.id ? { 'gaming:controllerId': { '@id': event.actor.id } } : {}),
      'gaming:observationAuthority': 'owner-browser-observation', 'gaming:competencyStatus': 'not-assessed' });
    nodes.push({ '@id': recordId, '@type': 'prov:Entity',
      'i2x:isClassifiedBy': { '@id': 'i2idl:xapi-statement' },
      'prov:wasGeneratedBy': { '@id': occurrenceId }, 'prov:wasAttributedTo': { '@id': ownerDid },
      'dct:conformsTo': { '@id': statement.context.contextActivities.category[0].id },
      'gaming:mappingStatus': GAMEPLAY_SEMANTIC_SOURCE.mappingStatus,
      // Preserve the exact xAPI JSON as data; it is never an RDF event or a new statement.
      'gaming:statement': { '@value': statement, '@type': '@json' } });
  }
  return { '@context': { prov: 'http://www.w3.org/ns/prov#', dct: 'http://purl.org/dc/terms/',
    gaming: 'urn:interego:gaming:', i2idl: 'https://id.i2idl.org/concepts/',
    i2x: GAMEPLAY_SEMANTIC_SOURCE.vocabulary + '#' },
    '@id': 'urn:interego:gaming:evidence-view',
    'dct:source': [{ '@id': GAMEPLAY_SEMANTIC_SOURCE.glossary }, { '@id': GAMEPLAY_SEMANTIC_SOURCE.vocabulary }],
    'gaming:glossaryPublicationVersion': GAMEPLAY_SEMANTIC_SOURCE.release,
    'gaming:glossaryCommit': GAMEPLAY_SEMANTIC_SOURCE.commit,
    'gaming:scope': 'Derived view of retained owner-browser observations; I2IDL-X classifications remain Hypothetical.',
    '@graph': nodes };
}
