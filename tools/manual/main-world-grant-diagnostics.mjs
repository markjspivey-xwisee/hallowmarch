/** Fixed read-only diagnostics for the one deliberately published QA grant.
 * No generic browser callback, credential, grant body or arbitrary error leaves
 * this surface. The supplied public reference is independently shape-checked. */
export async function readMainWorldGrant(expected) {
  const h = window.__hm, state = h?.worldAgents?.state;
  const net = h?.net?.NETWS, token = net?.token, generation = net?.generation, client = state?.client;
  const rows = state?.records ? [...state.records.values()] : [];
  const result = { ownerMatched: h?.net?.NETWS?.acct?.nativeBound === true && h.net.NETWS.acct.id === expected.ownerId,
    recordsCount: rows.length, busy: state?.busy === true, nativeRead: 'not-attempted' };
  if (!result.ownerMatched || rows.length !== 1 || state.busy) return result;
  const record = rows[0], reference = record?.reference;
  const uuid = reference?.grantId?.match(/^urn:uuid:([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/)?.[1];
  const referenceMatched = !!uuid && reference.graphIri === 'urn:graph:interego:gaming:owner-agent-grant:' + uuid
    && (!expected.reference || reference.grantId === expected.reference.grantId && reference.graphIri === expected.reference.graphIri);
  const scopeMatched = record.grant?.actor === expected.actor && record.grant.entityId === expected.bodyId
    && record.grant.roomId === expected.roomId && h.worldAgents.bodies().some(body => body.id === expected.bodyId && body.entity !== h.GAME.player);
  Object.assign(result, { referenceMatched, scopeMatched });
  if (!referenceMatched || !scopeMatched) return result;
  result.reference = { grantId: reference.grantId, graphIri: reference.graphIri };
  const target = { ...result.reference }, originalPhase = record.phase, originalOperation = record.operationId;
  const originalRegistered = record.registered, originalRevoked = record.localRevoked;
  result.phase = ['', 'publish', 'register', 'stop', 'pod-revoke', 'pod-revoke-pending'].includes(record.phase) ? record.phase : 'unknown';
  result.operationPresent = typeof record.operationId === 'string' && !!record.operationId;
  result.registered = record.registered === true;
  result.localRevoked = record.localRevoked === true;
  try {
    // load is the existing native client's read-only head/descriptor/graph path;
    // confirm, publish, register and revoke are deliberately unavailable here.
    const read = await client.load(target);
    result.nativeRead = read ? 'read' : 'missing';
    if (read) {
      result.exactActiveGrant = read.reference?.grantId === reference.grantId && read.reference?.graphIri === reference.graphIri
        && read.grant?.actor === expected.actor && read.grant.entityId === expected.bodyId && read.grant.roomId === expected.roomId
        && read.grant.revoked === false && Date.parse(read.grant.expiresAt) > Date.now();
    }
  } catch (error) {
    result.nativeRead = 'refused';
    const codes = ['not_connected', 'needs_reauth', 'native_unavailable', 'native_contract', 'native_refused', 'capability_missing',
      'owner_mismatch', 'conflict', 'invalid_descriptor', 'invalid_proof', 'public_distribution_required', 'graph_scope_mismatch',
      'public_readback_unavailable', 'public_readback_mismatch', 'record_capacity', 'invalid_graph', 'invalid_grant',
      'invalid_grant_reference', 'invalid_grant_time', 'record_outside_owner_pod', 'invalid_native_url'];
    result.code = codes.includes(error?.code) ? error.code : 'operation_failed';
  }
  if (window.__hm !== h || h.worldAgents.state !== state || h.net.NETWS !== net || net.acct?.nativeBound !== true || net.acct.id !== expected.ownerId
    || net.token !== token || net.generation !== generation || state.client !== client || state.busy
    || state.records.size !== 1 || state.records.get(target.grantId) !== record
    || record.reference?.grantId !== target.grantId || record.reference?.graphIri !== target.graphIri
    || record.grant?.actor !== expected.actor || record.grant.entityId !== expected.bodyId || record.grant.roomId !== expected.roomId
    || record.phase !== originalPhase || record.operationId !== originalOperation || record.registered !== originalRegistered || record.localRevoked !== originalRevoked
    || !h.worldAgents.bodies().some(body => body.id === expected.bodyId && body.entity !== h.GAME.player)) {
    return { ownerMatched: false, recordsCount: state.records.size, busy: state.busy === true, nativeRead: 'not-attempted' };
  }
  return result;
}

export function publicMainWorldGrantReference(value) {
  const uuid = typeof value?.grantId === 'string' && value.grantId.match(/^urn:uuid:([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/)?.[1];
  return uuid && value.graphIri === 'urn:graph:interego:gaming:owner-agent-grant:' + uuid
    ? { grantId: value.grantId, graphIri: value.graphIri } : null;
}

/** A second boundary protects stdout from an unexpected/malicious page value. */
export function safeMainWorldGrantRead(value) {
  const result = { kind: 'main_world_grant_read' };
  for (const field of ['ownerMatched', 'busy', 'referenceMatched', 'scopeMatched', 'operationPresent', 'registered', 'localRevoked', 'exactActiveGrant'])
    if (typeof value?.[field] === 'boolean') result[field] = value[field];
  if (Number.isSafeInteger(value?.recordsCount) && value.recordsCount >= 0 && value.recordsCount <= 64) result.recordsCount = value.recordsCount;
  if (['not-attempted', 'read', 'missing', 'refused'].includes(value?.nativeRead)) result.nativeRead = value.nativeRead;
  if (['', 'publish', 'register', 'stop', 'pod-revoke', 'pod-revoke-pending', 'unknown'].includes(value?.phase)) result.phase = value.phase;
  const codes = ['not_connected', 'needs_reauth', 'native_unavailable', 'native_contract', 'native_refused', 'capability_missing',
    'owner_mismatch', 'conflict', 'invalid_descriptor', 'invalid_proof', 'public_distribution_required', 'graph_scope_mismatch',
    'public_readback_unavailable', 'public_readback_mismatch', 'record_capacity', 'invalid_graph', 'invalid_grant',
    'invalid_grant_reference', 'invalid_grant_time', 'record_outside_owner_pod', 'invalid_native_url', 'operation_failed'];
  if (codes.includes(value?.code)) result.code = value.code;
  const reference = publicMainWorldGrantReference(value?.reference);
  if (result.ownerMatched && result.referenceMatched && result.scopeMatched && reference) result.reference = reference;
  return result;
}
