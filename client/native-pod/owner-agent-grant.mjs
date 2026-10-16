/** Generic gaming vertical composed with owner-native public record storage. */
import { createNativePublicRecordClient, NativePublicRecordError } from './public-record.mjs';
import { parseTrig } from './vendor/interego-browser.mjs';
import { OWNER_AGENT_GRANT_SCHEMA, OWNER_AGENT_GRANT_ROLES as roles } from './owner-agent-grant-schema.mjs';
export { OWNER_AGENT_GRANT_SCHEMA } from './owner-agent-grant-schema.mjs';

const RDF = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#', DCT = 'http://purl.org/dc/terms/';
const fail = code => { throw new NativePublicRecordError(code); };
const snapshot = value => JSON.parse(JSON.stringify(value));
const uuid = value => typeof value === 'string' && new RegExp(OWNER_AGENT_GRANT_SCHEMA.properties.id.pattern).test(value);
function reference(value) {
  if (!value || !uuid(value.grantId) || value.graphIri !== 'urn:graph:interego:gaming:owner-agent-grant:' + value.grantId.slice(9)) fail('invalid_grant_reference');
  return { grantId: value.grantId, graphIri: value.graphIri };
}
export function ownerAgentGrantGraph({ graphIri, grant }) {
  reference({ grantId: grant?.id, graphIri });
  return `@prefix schema: <https://schema.org/> .\n@prefix dct: <${DCT}> .\n@prefix rdf: <${RDF}> .\n`
    + `<${graphIri}> a schema:DigitalDocument ; dct:conformsTo <${OWNER_AGENT_GRANT_SCHEMA.$id}> ; rdf:value ${JSON.stringify(JSON.stringify(grant))}^^rdf:JSON .\n`;
}

/** Public disclosure is an explicit choice for each grant. This composes a
 * scoped game relationship; it never calls register_agent or delegates storage. */
export function createOwnerAgentGrants({ binding, applicationId, audience, relayUrl, credential,
  createClient = createNativePublicRecordClient, crypto = globalThis.crypto, now = Date.now, ...clientOptions } = {}) {
  if (!/^did:[a-z0-9]+:[^\s]{1,500}$/.test(applicationId || '') || !binding?.subjectDid || !crypto?.randomUUID) fail('invalid_game_identity');
  let origin; try { origin = new URL(audience); } catch { fail('invalid_game_audience'); }
  if (origin.protocol !== 'https:' || origin.origin !== audience) fail('invalid_game_audience');
  const client = createClient({ ...clientOptions, relayUrl, credential, ownerDid: binding.subjectDid,
    podUrl: binding.podUrl, webId: binding.webId, publicData: true, crypto, now });
  const operations = new Map(); let closed = false;
  const open = () => { if (closed) fail('not_connected'); };
  function validate(grant) {
    const fields = OWNER_AGENT_GRANT_SCHEMA.required;
    if (!grant || typeof grant !== 'object' || Array.isArray(grant) || Object.keys(grant).length !== fields.length
      || fields.some(key => !Object.hasOwn(grant, key)) || grant.schema !== OWNER_AGENT_GRANT_SCHEMA.properties.schema.const
      || !uuid(grant.id) || grant.issuer !== binding.subjectDid || grant.applicationId !== applicationId || grant.audience !== audience
      || !/^did:web:[^\s]+:agents:[A-Za-z0-9][A-Za-z0-9._-]{0,255}$/.test(grant.actor || '') || grant.actor === grant.issuer
      || !Object.hasOwn(roles, grant.role) || !Array.isArray(grant.actions) || !grant.actions.length || grant.actions.length > 4
      || new Set(grant.actions).size !== grant.actions.length || grant.actions.some(action => !roles[grant.role].includes(action))
      || !Number.isSafeInteger(grant.maxCommandsPerSecond) || grant.maxCommandsPerSecond < 1 || grant.maxCommandsPerSecond > 20
      || typeof grant.revoked !== 'boolean') fail('invalid_grant');
    for (const field of ['roomId', 'entityId']) if (typeof grant[field] !== 'string' || !grant[field]
      || new TextEncoder().encode(grant[field]).length > 256 || /[\s\u0000-\u001f\u007f]/.test(grant[field])) fail('invalid_grant');
    const start = Date.parse(grant.notBefore), end = Date.parse(grant.expiresAt);
    if (!Number.isFinite(start) || !Number.isFinite(end) || new Date(start).toISOString() !== grant.notBefore
      || new Date(end).toISOString() !== grant.expiresAt || end <= start || end - start > 3_600_000) fail('invalid_grant_time');
    return snapshot(grant);
  }
  function parse(result, ref) {
    const nodes = parseTrig(result.graphContent).subjects;
    if (nodes.length !== 1 || nodes[0].subject !== ref.graphIri) fail('invalid_grant');
    const values = nodes[0].properties.get(RDF + 'value'), conforms = nodes[0].properties.get(DCT + 'conformsTo');
    if (values?.length !== 1 || values[0].kind !== 'literal' || values[0].datatype !== RDF + 'JSON'
      || conforms?.length !== 1 || conforms[0].kind !== 'iri' || conforms[0].iri !== OWNER_AGENT_GRANT_SCHEMA.$id) fail('invalid_grant');
    let grant; try { grant = JSON.parse(values[0].value); } catch { fail('invalid_grant'); }
    if (grant.id !== ref.grantId) fail('invalid_grant_reference'); return validate(grant);
  }
  function outward(result, ref) {
    open();
    if (result.operationId && !result.saved) operations.set(result.operationId, ref);
    if (result.saved || result.status === 'conflict') operations.delete(result.operationId);
    if (result.saved) parse(result, ref);
    return { status: result.status, saved: result.saved === true, reference: { ...ref },
      ...(result.operationId ? { operationId: result.operationId } : {}), ...(result.saved ? { receipt: snapshot(result.receipt) } : {}) };
  }
  async function load(input) {
    open(); const ref = reference(input), result = await client.load(ref); open();
    if (!result) return null;
    return { reference: ref, grant: parse(result, ref), head: { ...result.head }, receipt: snapshot(result.receipt) };
  }
  return Object.freeze({
    connect: () => { open(); return client.connect(); }, load,
    async publish({ publicDisclosureAccepted, actor, roomId, entityId, role, actions, maxCommandsPerSecond, lifetimeMs } = {}) {
      open(); if (publicDisclosureAccepted !== true) fail('public_disclosure_required');
      if (!Number.isSafeInteger(lifetimeMs) || lifetimeMs < 1000 || lifetimeMs > 3_600_000) fail('invalid_grant_time');
      const start = now(); if (!Number.isSafeInteger(start) || start < 0) fail('invalid_grant_time');
      const grantId = 'urn:uuid:' + crypto.randomUUID(), ref = reference({ grantId,
        graphIri: 'urn:graph:interego:gaming:owner-agent-grant:' + grantId.slice(9) });
      const grant = validate({ schema: OWNER_AGENT_GRANT_SCHEMA.properties.schema.const, id: grantId, issuer: binding.subjectDid,
        actor, applicationId, audience, roomId, entityId, role, actions, notBefore: new Date(start).toISOString(),
        expiresAt: new Date(start + lifetimeMs).toISOString(), maxCommandsPerSecond, revoked: false });
      return outward(await client.create({ graphIri: ref.graphIri, publicData: true, graphContent: ownerAgentGrantGraph({ graphIri: ref.graphIri, grant }) }), ref);
    },
    async revoke(input) {
      open(); const current = await load(input); if (!current) fail('grant_not_found');
      if (current.grant.revoked) return { status: 'saved', saved: true, reference: current.reference, receipt: current.receipt, alreadyRevoked: true };
      const grant = validate({ ...current.grant, revoked: true });
      return outward(await client.save({ graphIri: current.reference.graphIri, expectedHead: current.head, publicData: true,
        graphContent: ownerAgentGrantGraph({ graphIri: current.reference.graphIri, grant }) }), current.reference);
    },
    async confirm(operationId) {
      open(); const ref = operations.get(operationId); if (!ref) fail('unknown_operation');
      return outward(await client.confirm(operationId), ref);
    },
    status() { return { ...client.status(), pendingGrants: operations.size, applicationId, audience, publicRelationships: true }; },
    close() { closed = true; operations.clear(); client.close(); },
  });
}
