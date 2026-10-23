/** Public, credential-free contracts for composing an owner identity bridge.
 * The publisher owns the resulting graph; this helper never publishes it or
 * claims that an HTTP document has acquired native authorship or persistence.
 */
const DRAFT = 'https://json-schema.org/draft/2020-12/schema';
const DEFAULT_PATHS = Object.freeze({ start: '/gaming/identity/start', status: '/gaming/identity/status',
  claim: '/gaming/identity/claim', recordLink: '/gaming/identity/record-link',
  callback: '/gaming/identity/callback', clientMetadata: '/gaming/identity/client.json',
  playChallenge: '/gaming/identity/play/challenge', playComplete: '/gaming/identity/play/complete',
  claimChallenge: '/gaming/identity/play/claim-challenge', claimComplete: '/gaming/identity/play/claim-complete',
  claimOwnerStart: '/gaming/identity/claim-owner/start', claimOwnerClaim: '/gaming/identity/claim-owner/claim',
  affordances: '/gaming/identity/affordances', schemas: '/gaming/identity/schemas' });
const literal = value => JSON.stringify(value);
const freeze = value => {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
};

export function nativeIdentityDescription({ publicOrigin, paths: supplied = {}, allowOwnerBrowserHandoff = false } = {}) {
  const origin = new URL(publicOrigin);
  if (origin.protocol !== 'https:' || origin.username || origin.password || origin.pathname !== '/'
    || origin.search || origin.hash) throw new TypeError('Owner bridge description requires a public HTTPS origin');
  const paths = { ...DEFAULT_PATHS, ...supplied };
  for (const path of Object.values(paths)) {
    if (typeof path !== 'string' || !/^\/[A-Za-z0-9/_.,-]+$/.test(path) || path.includes('//')
      || path.split('/').some(segment => segment === '.' || segment === '..')) throw new TypeError('Invalid owner bridge description route');
  }
  if (new Set(Object.values(paths)).size !== Object.keys(paths).length) throw new TypeError('Owner bridge routes must be distinct');
  const uri = name => origin.origin + paths[name], id = uri('affordances') + '#service';
  const shape = name => uri('schemas') + '#' + name;
  const text = (maxLength = 2048) => ({ type: 'string', minLength: 1, maxLength });
  const account = { type: 'object', required: ['id', 'name', 'guest'], properties: {
    id: text(256), name: text(128), guest: { type: 'boolean' }, nativeBound: { type: 'boolean' } }, additionalProperties: false };
  const binding = { type: 'object', required: ['subjectDid', 'podUrl', 'webId', 'userId', 'authenticatedAgentDid', 'verifiedAt', 'issuer', 'verificationMethod'],
    properties: { ...Object.fromEntries(['subjectDid', 'podUrl', 'webId', 'userId', 'authenticatedAgentDid', 'authenticatedAgentId', 'verifiedAt', 'issuer', 'verificationMethod']
      .map(key => [key, key === 'verifiedAt' ? { type: 'string', format: 'date-time' } : text()])),
      provisional: { const: true }, expiresAt: { type: 'string', format: 'date-time' }, proofKeyThumbprint: text(43),
      capabilities: { const: ['human-play', 'own-pod-checkpoint'] } }, additionalProperties: false };
  const pointer = { type: 'object', required: ['kind', 'graphIri', 'descriptorUrl'], properties: {
    kind: { const: 'character' }, graphIri: { type: 'string', pattern: '^urn:graph:[^\\s]+$', maxLength: 1024 },
    descriptorUrl: { ...text(), format: 'uri', description: 'Concrete descriptor inside the authenticated owner pod, verified server-side; not fetched by this endpoint.' },
    cid: text(256) }, additionalProperties: false };
  const intent = { type: 'object', properties: { ownerPodWriteAccess: { type: 'boolean', default: false } },
    additionalProperties: true, description: 'Only ownerPodWriteAccess is an input. Account and native owner labels cannot select an identity.' };
  const rawSchemas = {
    PlayChallengeRequest: { type: 'object', required: ['publicKeyJwk'], properties: { publicKeyJwk: { type: 'object',
      description: 'Public P-256 browser proof key only; private JWK fields are refused.' } }, additionalProperties: false },
    PlayChallengeResponse: { type: 'object', required: ['audience', 'challenge', 'issuer', 'relayUrl', 'provisionalEndpoint', 'expiresAt', 'playGrant'], properties: {
      audience: text(), challenge: text(128), issuer: text(), relayUrl: text(), provisionalEndpoint: text(), verificationEndpoint: text(),
      expiresAt: { type: 'string', format: 'date-time' }, playGrant: { type: 'object', required: ['_signed_payload', '_signature'],
        properties: { _signed_payload: text(16384), _signature: text(1024) }, additionalProperties: false } }, additionalProperties: false },
    PlayProofRequest: { type: 'object', required: ['attestation', 'challenge', 'proof'], properties: {
      attestation: text(16384), challenge: text(128), proof: text(86) }, additionalProperties: false },
    PlayCompleteResponse: { type: 'object', required: ['appSession', 'binding', 'provisional'], properties: { binding,
      provisional: { const: true }, appSession: { type: 'object', description: 'Short host-signed provisional human-play session; never canonical agent authority.' } }, additionalProperties: false },
    ClaimChallengeRequest: { type: 'object', additionalProperties: false },
    ClaimChallengeResponse: { type: 'object', required: ['challenge', 'audience', 'expiresAt'], properties: {
      challenge: text(128), audience: text(), expiresAt: { type: 'string', format: 'date-time' } }, additionalProperties: false },
    ClaimOwnerStartRequest: { type: 'object', required: ['attestation', 'challenge', 'proof', 'ownerPodWriteAccess'], properties: {
      attestation: text(16384), challenge: text(128), proof: text(86), ownerPodWriteAccess: { const: true } }, additionalProperties: false },
    ClaimOwnerResponse: { type: 'object', required: ['binding', 'nativeSession', 'appSession'], properties: { binding,
      nativeSession: { type: 'object', description: 'One-use same-browser canonical owner write grant; sealed in browser before transition.' },
      appSession: { type: 'object', required: ['purpose', 'claimOperationId', 'guestOwnerDid', 'targetOwnerDid', 'audience', 'sourceChallenge', 'expiresAt'], properties: {
        purpose: { const: 'character-claim-target' }, claimOperationId: text(128), guestOwnerDid: text(), targetOwnerDid: text(), audience: text(),
        sourceChallenge: text(128), expiresAt: { type: 'string', format: 'date-time' }, existingRecord: { anyOf: [pointer, { type: 'null' }] } }, additionalProperties: false } }, additionalProperties: false },
    ClaimCompleteRequest: { type: 'object', required: ['claimOperationId', 'attestation', 'proof', 'targetRecord', 'readConfirmed'], properties: {
      claimOperationId: text(128), attestation: text(16384), proof: text(86), readConfirmed: { const: true },
      selection: { enum: ['copy-guest', 'use-existing'] }, targetRecord: { type: 'object', required: ['kind', 'graphIri', 'descriptorUrl', 'cid', 'nativeRevision', 'recordCid', 'digest', 'proofKind'],
        properties: { ...pointer.properties, bindingCid: text(256), nativeRevision: { type: 'string', pattern: '^sha256:[a-f0-9]{64}$' }, recordCid: text(256), digest: text(256),
          proofKind: { const: 'owner-key-authenticated-checkpoint' } }, additionalProperties: false } }, additionalProperties: false },
    ClaimCompleteResponse: { type: 'object', required: ['appSession', 'binding', 'provisional', 'claimed', 'claimOperationId', 'pointer'], properties: {
      appSession: { type: 'object', description: 'Canonical game session issued only after native claim CAS readback.' }, binding, provisional: { const: false },
      claimed: { const: true }, claimOperationId: text(128), pointer }, additionalProperties: false },
    StartRequest: intent,
    StartResponse: { type: 'object', required: ['authorizationUrl', 'expiresAt', 'ownerPodWriteAccess'], properties: {
      authorizationUrl: { type: 'string', format: 'uri' }, expiresAt: { type: 'string', format: 'date-time' }, ownerPodWriteAccess: { type: 'boolean' }, browserCeremony: text(43) }, additionalProperties: false },
    ClaimRequest: { ...intent, description: intent.description + ' The same explicit ownerPodWriteAccess:true intent is required again to claim an owner write grant; false or absent is for a read-only ceremony.' },
    ClaimResponse: { type: 'object', required: ['binding'], properties: { binding,
      appSession: { type: 'object', required: ['token', 'acct', 'nativeVerifiedUntil'], properties: {
        token: text(8192), acct: account, nativeVerifiedUntil: { type: 'number' } }, additionalProperties: false },
      nativeSession: { type: 'object', required: ['accessToken', 'tokenType', 'scope', 'expiresAt', 'authorizationServer', 'tokenEndpoint', 'mcpUrl'], properties: {
        accessToken: text(16384), tokenType: { const: 'Bearer' }, scope: text(128), expiresAt: { type: 'string', format: 'date-time' },
        authorizationServer: { type: 'string', format: 'uri' }, tokenEndpoint: { type: 'string', format: 'uri' }, mcpUrl: { type: 'string', format: 'uri' } },
      additionalProperties: false, description: 'Present only for an explicitly enabled owner write grant; no refresh token is returned.' } }, additionalProperties: false },
    StatusResponse: { type: 'object', required: ['enabled', 'status', 'account', 'bound', 'verified', 'binding', 'recordLinks', 'legacyImportAvailable', 'saveAuthority'], properties: {
      enabled: { const: true }, status: { enum: ['verified', 'native_identity_required', 'native_signin_required'] }, account,
      bound: { type: 'boolean' }, verified: { type: 'boolean' }, binding: { anyOf: [binding, { type: 'null' }] },
      recordLinks: { type: 'object', properties: { character: pointer }, additionalProperties: false }, legacyImportAvailable: { type: 'boolean' },
      provisional: { type: 'boolean' }, provisionalPlay: { type: 'object', required: ['enabled', 'relayUrl', 'audience'], properties: {
        enabled: { type: 'boolean' }, relayUrl: text(), audience: text() }, additionalProperties: false },
      saveAuthority: { enum: ['player-pod', 'legacy-server'] } }, additionalProperties: false },
    RecordLinkRequest: { ...pointer, additionalProperties: true,
      description: 'Only kind, graphIri, descriptorUrl and cid are retained. All other fields are ignored; no save body, claimed owner, or credential is persisted.' },
    RecordLinkResponse: { type: 'object', required: ['ok', 'pointer', 'version'], properties: {
      ok: { const: true }, pointer, version: { type: 'integer', minimum: 0 } }, additionalProperties: false },
    ErrorResponse: { type: 'object', required: ['error'], properties: { error: text(128) }, additionalProperties: false },
  };
  const schemas = { $schema: DRAFT, $id: uri('schemas'), $defs: Object.fromEntries(Object.entries(rawSchemas)
    .map(([name, value]) => [name, { $anchor: name, ...value }])) };
  const requirements = {
    account: 'A host application Bearer session authenticates the initiating account. Only start and claim may accept a host-HMAC-verified native credential expired by at most 24 hours, exclusively to reauthenticate its existing account and native owner. It grants no game, pod, companion or learning authority. A claimed DID, pod URL or account label is never owner proof.',
    origin: 'Mutating requests require the configured HTTPS Host and exact same Origin. No cross-origin bearer or credential CORS surface is advertised.',
    ceremony: 'The same initiating account/session and Secure HttpOnly SameSite=Lax origin-bound cookie are required. OAuth state is single-use and the provider code uses S256 PKCE. A reconnect must freshly authenticate the exact existing native owner before any binding or application-session change.',
    native: 'Fresh host-signed native proof must match the confirmed native owner ledger. The server derives the owner and account; the caller cannot select either.',
  };
  const operation = (name, method, input, output, auth, description) => ({
    '@id': id + '/' + name, '@type': 'hydra:Operation', 'hydra:method': method, 'hydra:target': uri(name),
    'iep:action': { '@id': 'urn:interego:identity:owner:' + name },
    ...(input ? { 'hydra:expects': { '@id': shape(input) } } : {}), 'hydra:returns': { '@id': shape(output) },
    'dct:requires': auth.map(key => ({ '@id': id + '/auth/' + key })), 'hydra:description': description,
  });
  const operations = [
    operation('playChallenge', 'POST', 'PlayChallengeRequest', 'PlayChallengeResponse', ['account', 'origin'],
      'Create a short browser-key-bound native service grant for a provisional owner and owner pod. No native owner credential enters the game server.'),
    operation('playComplete', 'POST', 'PlayProofRequest', 'PlayCompleteResponse', ['account', 'origin'],
      'Verify the provider attestation and browser key proof, then confirm a native ownership ledger entry before issuing human-only provisional play.'),
    operation('claimChallenge', 'POST', 'ClaimChallengeRequest', 'ClaimChallengeResponse', ['account', 'origin', 'native'],
      'Begin an explicit character claim using the current provisional native human session. This does not change its owner.'),
    operation('claimOwnerStart', 'POST', 'ClaimOwnerStartRequest', 'StartResponse', ['account', 'origin', 'native'],
      'Require guest key proof before a separate canonical OAuth ceremony. The generic owner reconnect remains restricted to its original owner.'),
    operation('claimOwnerClaim', 'POST', 'ClaimRequest', 'ClaimOwnerResponse', ['account', 'origin', 'ceremony'],
      'Consume a purpose-limited canonical target grant. Its public claim lease contains no game token; provisional play authority is not upgraded here.'),
    operation('claimComplete', 'POST', 'ClaimCompleteRequest', 'ClaimCompleteResponse', ['account', 'origin', 'native'],
      'Require fresh guest proof bound to the canonical target and owner-key target checkpoint readback acknowledgement. Atomically retire provisional participation after native ledger readback. This personal-save acknowledgement is not proof for authoritative rewards or loot.'),
    operation('start', 'POST', 'StartRequest', 'StartResponse', ['account', 'origin'],
      'Begin a new, non-idempotent hosted owner authentication ceremony. Default scope is mcp:read and that native grant is discarded after owner verification. An enabled ownerPodWriteAccess:true request asks the provider for mcp:write; this is not learning consent.'),
    operation('status', 'GET', null, 'StatusResponse', ['account'],
      'Read own participation status without mutation. Owner identity and record links are returned only with fresh matching native proof. Native storage unavailability returns 503.'),
    operation('claim', 'POST', 'ClaimRequest', 'ClaimResponse', ['account', 'origin', 'ceremony'],
      'Consume a same-browser, same-account result once within at most 30 seconds. This is non-idempotent: a second claim is refused. Application credentials and any explicit owner write access token appear only in this no-store response, never in URLs. No refresh token is returned.'),
    operation('recordLink', 'POST', 'RecordLinkRequest', 'RecordLinkResponse', ['account', 'origin', 'native'],
      'Idempotently register an owner-asserted descriptor pointer within the proven owner pod in the application-owned participation ledger. Does not fetch the descriptor or prove its existence, content or authorship; does not upload a personal save body.'),
  ];
  const boundaries = [
    'Provisional owners retain browser proof keys and private character checkpoints in their own native pods. Provisional game sessions authorize human live play and own-record linking only; they do not authorize companion agents or canonical owner operations.',
    'Claiming requires fresh source key proof, independently canonical OAuth identity and owner-key checkpoint readback. A distinct existing canonical character is preserved; no authoritative multiplayer progress is merged. Native claim retirement markers prevent old guest credentials acquiring canonical authority.',
    'Personal records are sealed and published by the owner browser to the owner pod; the application backend holds no persistent native player bearer or private key.',
    'The application-owned native participation ledger holds owner-to-account bindings and owner record pointers only. Existing personal files remain read-only import sources for native-bound accounts.',
    'The existing legacy world, realm, season and team state is not migrated by this owner bridge. Agent delegation and team-owned pods require separate capabilities.',
    'Learning export requires separately verified identity and current explicit session consent; owner authentication and pod write authorization do not supply that consent.',
    'Owner browser mcp:write is a provider pod-wide grant, not an application-path delegation. The application native proof lasts at most one hour and does not imply continuous native revocation checks.',
    'This description advertises contracts. Native authorship and persistence exist only after a native publisher signs, stores and verifies the resulting descriptor.',
  ];
  const description = { '@context': { hydra: 'http://www.w3.org/ns/hydra/core#', dct: 'http://purl.org/dc/terms/',
    iep: 'https://markjspivey-xwisee.github.io/interego/ns/iep#' },
    '@id': id, '@type': 'hydra:ApiDocumentation', 'dct:title': 'Native owner identity and record pointers',
    'dct:identifier': 'native-owner-bridge.v1', 'hydra:entrypoint': { '@id': uri('status') },
    'hydra:supportedOperation': operations,
    'dct:requires': Object.entries(requirements).map(([key, value]) => ({ '@id': id + '/auth/' + key, 'dct:description': value })),
    'dct:description': boundaries,
    ownerBrowserWriteHandoff: allowOwnerBrowserHandoff === true,
    oauth: { callback: uri('callback'), clientMetadata: uri('clientMetadata'), grant: 'authorization_code', pkce: 'S256', refreshTokensReturned: false },
    schemas: uri('schemas') };
  const graph = [
    '@prefix hydra: <http://www.w3.org/ns/hydra/core#> .', '@prefix dct: <http://purl.org/dc/terms/> .',
    '@prefix schema: <https://schema.org/> .', '@prefix sh: <http://www.w3.org/ns/shacl#> .',
    '@prefix iep: <https://markjspivey-xwisee.github.io/interego/ns/iep#> .', '@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .',
    '@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .', '@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .',
    `<${id}> a hydra:ApiDocumentation, schema:SoftwareApplication ; dct:identifier "native-owner-bridge.v1" ;`,
    '  dct:title "Native owner identity and record pointers" ;',
    `  hydra:entrypoint <${uri('status')}> ; schema:subjectOf <${uri('affordances')}>, <${uri('schemas')}> ;`,
    `  hydra:supportedOperation ${operations.map(op => `<${op['@id']}>`).join(', ')} ;`,
    `  dct:description ${boundaries.map(literal).join(', ')} .`,
    `<${uri('schemas')}> a schema:CreativeWork ; schema:encodingFormat "application/schema+json" ; rdf:value ${literal(JSON.stringify(schemas))}^^rdf:JSON .`,
    `<${uri('clientMetadata')}> a schema:CreativeWork ; schema:encodingFormat "application/json" ; dct:description "Public OAuth client metadata; authorization_code with S256 PKCE and no client secret." .`,
    `<${id}> schema:associatedMedia <${uri('clientMetadata')}> ; dct:requires ${Object.keys(requirements).map(key => `<${id}/auth/${key}>`).join(', ')} .`,
    ...Object.entries(requirements).map(([key, value]) => `<${id}/auth/${key}> a schema:CreativeWork ; dct:description ${literal(value)} .`),
    ...operations.map(op => `<${op['@id']}> a hydra:Operation ; hydra:method ${literal(op['hydra:method'])} ; hydra:target <${op['hydra:target']}> ;`
      + ` iep:action <${op['iep:action']['@id']}> ;`
      + (op['hydra:expects'] ? ` hydra:expects <${op['hydra:expects']['@id']}> ;` : '')
      + ` hydra:returns <${op['hydra:returns']['@id']}> ; dct:requires ${op['dct:requires'].map(item => `<${item['@id']}>`).join(', ')} ; hydra:description ${literal(op['hydra:description'])} .`),
    ...Object.keys(rawSchemas).map(name => `<${shape(name)}> a schema:CreativeWork ; schema:encodingFormat "application/schema+json" ; rdf:value ${literal(JSON.stringify({ $schema: DRAFT, ...rawSchemas[name] }))}^^rdf:JSON .`),
    ...operations.map(op => `<${op['iep:action']['@id']}> a schema:Action ; dct:title ${literal(op['@id'].split('/').at(-1))} ; dct:description ${literal(op['hydra:description'])} .`),
    ...['StartRequest', 'ClaimRequest', 'RecordLinkRequest'].map(name => {
      const definition = rawSchemas[name];
      const fields = Object.entries(definition.properties).map(([key, field]) => {
        const datatype = field.type === 'boolean' ? 'xsd:boolean' : field.type === 'integer' ? 'xsd:integer' : 'xsd:string';
        return `[ sh:path <${id}/field/${key}> ; sh:name ${literal(key)} ; sh:datatype ${datatype} ; sh:minCount ${definition.required?.includes(key) ? 1 : 0} ; sh:maxCount 1`
          + (field.maxLength ? ` ; sh:maxLength ${field.maxLength}` : '')
          + (field.pattern ? ` ; sh:pattern ${literal(field.pattern)}` : '')
          + (field.const !== undefined ? ` ; sh:hasValue ${literal(field.const)}` : '')
          + (field.default !== undefined ? ` ; sh:defaultValue ${literal(field.default)}` : '') + ' ]';
      });
      return `<${shape(name)}> a sh:NodeShape ; dct:description "SHACL RDF projection of the declared HTTP JSON Schema; JSON keys are the sh:name values." ; sh:property ${fields.join(', ')} .`;
    }),
    ...[...new Set(['StartRequest', 'ClaimRequest', 'RecordLinkRequest'].flatMap(name => Object.keys(rawSchemas[name].properties)))].map(key =>
      `<${id}/field/${key}> a rdf:Property ; rdfs:label ${literal(key)} ; dct:description ${literal('JSON request field ' + key + ' in this application-owned contract.')} .`),
    // SHACL validates the RDF projection of a record-link request. JSON HTTP
    // bodies use the exact JSON Schema above; no RDF body parser is implied.
    `<${id}/RecordPointerShape> a sh:NodeShape ; sh:targetClass <${id}/RecordPointer> ; dct:description "RDF projection of a record pointer; the authenticated host additionally verifies the owner pod boundary." ;`,
    `  sh:property [ sh:path schema:additionalType ; sh:hasValue "character" ; sh:minCount 1 ; sh:maxCount 1 ] ;`,
    `  sh:property [ sh:path schema:identifier ; sh:datatype xsd:string ; sh:pattern "^urn:graph:" ; sh:minCount 1 ; sh:maxCount 1 ] ;`,
    `  sh:property [ sh:path schema:url ; sh:nodeKind sh:IRI ; sh:minCount 1 ; sh:maxCount 1 ] .`,
  ].join('\n');
  return freeze({ id, graphContent: graph, description, schemas,
    manifest: { capability: id, affordances: uri('affordances'), schemas: uri('schemas'), clientMetadata: uri('clientMetadata'),
      ownerBrowserWriteHandoff: allowOwnerBrowserHandoff === true, nativePublication: 'requires-verified-owned-descriptor',
      personalStateAuthority: 'owner-pod', legacyWorldMigration: false, nativeTeamMigration: false, nativeAgentDelegation: false } });
}

