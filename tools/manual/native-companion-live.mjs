/** Importable manual QA extension. No top-level live I/O and no CI entrypoint. */
import { generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import { nativeLiveStages } from './native-live-stages.mjs';
import { agentCommandMessage, agentRenewalMessage, agentSessionPossessionMessage } from '../../server/gaming/native-agent-proof.js';

const names = ['register', 'challenge', 'complete', 'renew', 'command', 'observe', 'revoke'];
// Exact public error codes from the native agent HTTP/authority/proof adapters.
// Never retain an arbitrary response string, nested error, payload or message.
const httpCodes = new Set(['native_admission_expired', 'native_admission_uncertain', 'stale_native_proof',
  'native_proof_unavailable', 'agent_challenge_unavailable', 'agent_challenge_mismatch',
  'owner_grant_expired', 'owner_grant_revoked', 'owner_grant_rejected', 'native_grant_unavailable',
  'native_agent_session_unavailable', 'agent_session_unavailable', 'agent_renewal_rejected', 'agent_renewal_in_progress',
  'agent_command_expired', 'agent_scope_rejected', 'agent_sequence_rejected', 'invalid_session_signature',
  'invalid_native_signature', 'invalid_proof_shape', 'invalid_proof_time', 'invalid_session_key',
  'native_agent_rejected', 'native_agent_key_unproven', 'native_agent_unavailable', 'native_game_unavailable',
  'native_grant_rate_limited', 'agent_rate_limited', 'native_agent_busy', 'native_request_timeout']);
const fail = code => { throw Object.assign(new Error('Manual companion QA condition failed.'), { code }); };
const ensure = (value, code) => { if (!value) fail(code); };
const clone = value => structuredClone(value);
function httpsOrigin(value) {
  let url; try { url = new URL(value); } catch { fail('qa_companion_origin'); }
  ensure(url.protocol === 'https:' && url.origin === value, 'qa_companion_origin'); return url.origin;
}
export function nativeCompanionOptIn(environment = process.env) {
  if (environment.HM_NATIVE_COMPANION_LIVE_TEST !== '1') return false;
  ensure(environment.HM_NATIVE_LIVE_TEST === '1' && !['DEBUG', 'PWDEBUG', 'PW_TEST_TRACE', 'NODE_DEBUG'].some(key => environment[key]), 'qa_companion_opt_in');
  ensure(httpsOrigin(environment.HM_NATIVE_ORIGIN) !== httpsOrigin(environment.HM_NATIVE_RELAY_ORIGIN), 'qa_companion_origin'); return true;
}
export function createNativeCompanionLiveQa({ enabled, gameOrigin, relayOrigin, expectedOwner, agentDid, agentPodUrl,
  ownerPort, signNativeRequest, request = globalThis.fetch, now = Date.now, onStage = () => {}, readProofCounters = null } = {}) {
  ensure(enabled === true, 'qa_companion_opt_in'); httpsOrigin(gameOrigin); httpsOrigin(relayOrigin);
  ensure(gameOrigin !== relayOrigin && expectedOwner?.accountId && expectedOwner?.subjectDid && expectedOwner?.podUrl
    && /^did:web:[^\s]+:agents:[^\s]+$/.test(agentDid || '') && typeof agentPodUrl === 'string', 'qa_companion_scope');
  for (const name of ['enterAndSpawn', 'publish', 'readback', 'register', 'localRevoke', 'ownerPodRevoke']) ensure(typeof ownerPort?.[name] === 'function', 'qa_companion_owner_port');
  ensure(typeof signNativeRequest === 'function' && typeof request === 'function', 'qa_companion_signing_port');
  let manifest = null, description = null, routes = null, body = null, published = null, nativeGrant = null;
  let key = null, challenge = null, envelope = null, admission = null, completeAttempted = false, sequence = 0, phase = 0, closed = false;
  let lastCommand = null, completedCommand = null, nativeCounterMeasured = false, counterBefore = null, compoundStep = 'not-started';
  let lastHttpStatus = null, lastHttpCode = null;
  const stopped = new AbortController();
  const commandId = 'qa-native-companion-move:' + randomUUID();
  const observations = { negative: [], fastCommandAccepted: false, renewed: false, observed: false, localRevoked: false, ownerPodRevoked: false };
  function target(value) {
    let url; try { url = new URL(value); } catch { fail('qa_companion_description'); }
    ensure(url.origin === gameOrigin && url.href === value && !url.search && !url.hash && !url.username && !url.password, 'qa_companion_description'); return value;
  }
  async function call(url, payload) {
    ensure(!closed, 'qa_companion_closed'); const selected = target(url); let response;
    lastHttpStatus = null; lastHttpCode = null;
    try { response = await request(selected, { method: payload ? 'POST' : 'GET', redirect: 'error', credentials: 'omit', cache: 'no-store',
      headers: { Accept: 'application/json', ...(payload ? { 'Content-Type': 'application/json' } : {}) },
      ...(payload ? { body: JSON.stringify(payload) } : {}), signal: AbortSignal.any([stopped.signal, AbortSignal.timeout(45000)]) }); }
    catch { fail('qa_companion_http_uncertain'); }
    ensure(!closed, 'qa_companion_closed');
    lastHttpStatus = Number.isInteger(response.status) && response.status >= 100 && response.status <= 599 ? response.status : null;
    ensure(!response.url || response.url === selected, 'qa_companion_description');
    let value; try { value = await response.json(); } catch { fail('qa_companion_response'); }
    if (!(response.ok && value?.ok === true) && httpCodes.has(value?.error)) lastHttpCode = value.error;
    return { status: response.status, ok: response.ok, value };
  }
  const accepted = result => { ensure(result.ok && result.value?.ok === true && result.value.result, 'qa_companion_http_refused'); return result.value.result; };
  function freshSession() { ensure(!closed, 'qa_companion_closed'); ensure(admission && admission.expiresAt > now(), 'qa_companion_admission_expired'); }
  function signedCommand(command, { at = now(), seq = sequence + 1, signedAction = command.type } = {}) {
    freshSession(); const proof = { sequence: seq, at, method: 'POST', path: new URL(routes.command).pathname,
      action: signedAction, roomId: command.roomId, entityId: command.entityId, body: { command } };
    return { sessionId: admission.sessionId, sequence: seq, at, command,
      signature: sign(null, Buffer.from(agentCommandMessage(admission.sessionId, proof)), key.privateKey).toString('base64url') };
  }
  async function refusal(name, payload, allowed) {
    const result = await call(routes.command, payload);
    ensure(!result.ok && allowed.includes(result.value?.error), 'qa_companion_negative_failed'); observations.negative.push(name);
  }
  const stages = nativeLiveStages([
    { name: 'native-companion-discovery', async run() {
      manifest = (await call(gameOrigin + '/gaming/manifest')).value;
      const advertised = manifest?.nativeAgents;
      ensure(manifest?.enabled === true && advertised?.enabled === true && advertised.audience === gameOrigin && /^did:/.test(advertised.applicationId || '')
        && advertised.nativeReadScope === 'owner-grant-and-agent-proof-control-plane'
        && Number.isInteger(advertised.leaseMs) && advertised.leaseMs >= 1000 && advertised.leaseMs <= 30000, 'qa_companion_description');
      if (advertised.nativePublication) ensure(advertised.nativePublication.verified === true, 'qa_companion_native_description_unconfirmed');
      description = (await call(target(advertised.affordances))).value;
      ensure(description?.['@id'] === advertised.affordances && description.enabled === true && description.applicationId === advertised.applicationId
        && description.audience === gameOrigin && description.proof?.productionReaderModes?.includes('relay-mediated')
        && description.proof?.revocation?.maxPropagationMs === advertised.leaseMs && Array.isArray(description.operations)
        && description.operations.length <= 32, 'qa_companion_description');
      routes = {};
      for (const name of names) {
        const rows = description.operations.filter(op => op?.['iep:action']?.['@id'] === 'urn:interego:gaming:native-agent:' + name);
        ensure(rows.length === 1 && rows[0]['hydra:method'] === 'POST', 'qa_companion_description'); routes[name] = target(rows[0]['hydra:target']);
      }
      ensure(new Set(Object.values(routes)).size === names.length, 'qa_companion_description');
    } },
    { name: 'native-companion-owned-body', async run() {
      body = await ownerPort.enterAndSpawn();
      ensure(body?.accountId === expectedOwner.accountId && body.roomId === manifest.roomId && typeof body.entityId === 'string'
        && Number.isFinite(body.x) && Number.isFinite(body.z), 'qa_companion_body');
    } },
    { name: 'native-companion-public-grant', async run() {
      published = await ownerPort.publish(); ensure(published?.saved === true && published.reference, 'qa_companion_public_readback');
    } },
    { name: 'native-companion-owner-readback', async run() {
      const found = await ownerPort.readback(), grant = found?.grant, receipt = found?.receipt;
      ensure(found?.reference?.grantId === published.reference.grantId && found.reference.graphIri === published.reference.graphIri
        && grant?.id === published.reference.grantId && grant.schema === 'interego.gaming.owner-agent-grant/v1'
        && grant.issuer === expectedOwner.subjectDid && grant.actor === agentDid && grant.applicationId === manifest.nativeAgents.applicationId
        && grant.audience === gameOrigin && grant.roomId === body.roomId && grant.entityId === body.entityId && grant.revoked === false
        && grant.role === 'pet' && JSON.stringify(grant.actions) === JSON.stringify(['observe', 'move']) && grant.maxCommandsPerSecond === 5
        && Date.parse(grant.expiresAt) > now() + 30000 && receipt?.visibility === 'public' && receipt.ownerDid === expectedOwner.subjectDid
        && receipt.ownerPodUrl === expectedOwner.podUrl && receipt.authorship?.verified === true, 'qa_companion_public_readback'); nativeGrant = clone(grant);
    } },
    { name: 'native-companion-game-reference', async run() {
      const registered = await ownerPort.register(); ensure(registered.reference?.grantId === published.reference.grantId && registered.authority?.durable === true, 'qa_companion_game_receipt');
    } },
    { name: 'native-companion-proof-and-commands', async run() {
      if (phase === 0) {
        compoundStep = 'challenge'; if (!key) key = generateKeyPairSync('ed25519');
        if (!challenge) challenge = accepted(await call(routes.challenge, { grantId: nativeGrant.id, sessionPublicKeyJwk: key.publicKey.export({ format: 'jwk' }) }));
        ensure(challenge.payload?.audience === gameOrigin && challenge.payload.applicationId === manifest.nativeAgents.applicationId
          && challenge.payload.grantId === nativeGrant.id && challenge.expiresAt > now(), 'qa_companion_challenge');
        compoundStep = 'external-native-signature';
        if (!envelope) envelope = await signNativeRequest({ payload: clone(challenge.payload), expiresAt: challenge.expiresAt,
          agentDid, agentPodUrl, challengeId: challenge.challengeId });
        ensure(!closed, 'qa_companion_closed');
        ensure(!completeAttempted, 'qa_companion_admission_uncertain'); completeAttempted = true; compoundStep = 'native-admission';
        admission = accepted(await call(routes.complete, { challengeId: challenge.challengeId, envelope,
          sessionSignature: sign(null, Buffer.from(agentSessionPossessionMessage(challenge.payload)), key.privateKey).toString('base64url') }));
        ensure(admission.identity?.agentDid === agentDid && admission.identity.podUrl === agentPodUrl && admission.identity.mode === 'relay-mediated'
          && admission.receipt?.grantId === nativeGrant.id && admission.receipt.ownerDid === expectedOwner.subjectDid && admission.receipt.agentDid === agentDid
          && admission.receipt.ownerRecord?.graphIri === published.reference.graphIri && admission.receipt.scope?.entityId === body.entityId
          && admission.receipt.scope.roomId === body.roomId && admission.receipt.scope.role === 'pet'
          && JSON.stringify(admission.receipt.scope.actions) === JSON.stringify(nativeGrant.actions) && admission.authority?.durable === true,
        'qa_companion_native_receipt'); freshSession(); phase = 1;
      }
      // Keep fast proof checks together: pausing between them would exhaust a
      // deliberately short control-plane lease and would not measure game ping.
      if (phase === 1) {
        compoundStep = 'negative-command-proofs';
        const move = { type: 'move', roomId: body.roomId, entityId: body.entityId, commandId, x: body.x + 0.1, z: body.z };
        await refusal('forged-action', signedCommand(move, { signedAction: 'observe' }), ['invalid_session_signature']);
        await refusal('forbidden-scope', signedCommand({ ...move, type: 'claimLoot', targetId: 'qa-ungranted-target' }), ['agent_scope_rejected']);
        await refusal('wrong-room', signedCommand({ ...move, roomId: body.roomId + '-foreign' }), ['agent_scope_rejected']);
        await refusal('expired-command', signedCommand(move, { at: now() - 6000 }), ['agent_command_expired']); phase = 2;
      }
      if (phase === 2) {
        compoundStep = 'local-command'; freshSession();
        if (readProofCounters && description.proof?.counterObservationAdvertised === true) {
          counterBefore = await readProofCounters(); ensure(Number.isSafeInteger(counterBefore) && counterBefore >= 0, 'qa_companion_fast_native_reads');
        }
        lastCommand ||= signedCommand({ type: 'move', roomId: body.roomId, entityId: body.entityId, commandId, x: body.x + 0.1, z: body.z });
        const moved = accepted(await call(routes.command, lastCommand));
        ensure(moved.ok === true && moved.result?.entityId === body.entityId && Math.abs(moved.result.x - (body.x + 0.1)) < 1e-9, 'qa_companion_command_result');
        sequence = lastCommand.sequence; completedCommand = clone(lastCommand); observations.fastCommandAccepted = true;
        if (counterBefore !== null) { const after = await readProofCounters(); ensure(after === counterBefore, 'qa_companion_fast_native_reads'); nativeCounterMeasured = true; }
        phase = 3;
      }
      if (phase === 3) { compoundStep = 'replay-rejection'; await refusal('replay', completedCommand, ['agent_sequence_rejected']); phase = 4; }
      if (phase === 4) {
        compoundStep = 'native-renewal'; freshSession(); const proof = { sequence: sequence + 1, at: now() };
        const renewed = accepted(await call(routes.renew, { sessionId: admission.sessionId, ...proof,
          signature: sign(null, Buffer.from(agentRenewalMessage(admission.sessionId, proof)), key.privateKey).toString('base64url') }));
        ensure(renewed.sessionId === admission.sessionId && renewed.receipt?.grantDigest === admission.receipt.grantDigest
          && renewed.expiresAt > now(), 'qa_companion_renewal'); admission.expiresAt = renewed.expiresAt; sequence = proof.sequence;
        observations.renewed = true; phase = 5;
      }
      if (phase === 5) {
        compoundStep = 'redacted-observation'; freshSession();
        const publicBody = { roomId: body.roomId, entityId: body.entityId }, proof = { sequence: sequence + 1, at: now(), method: 'POST',
          path: new URL(routes.observe).pathname, action: 'observe', ...publicBody, body: publicBody };
        const observed = accepted(await call(routes.observe, { sessionId: admission.sessionId, sequence: proof.sequence, at: proof.at, ...publicBody,
          signature: sign(null, Buffer.from(agentCommandMessage(admission.sessionId, proof)), key.privateKey).toString('base64url') }));
        ensure(observed.roomId === body.roomId && Array.isArray(observed.entities) && !['inventory', 'chat', 'consent', 'grants', 'nativeReferences'].some(key => Object.hasOwn(observed, key)), 'qa_companion_redaction');
        sequence = proof.sequence; observations.observed = true; phase = 6; compoundStep = 'complete';
      }
    } },
    { name: 'native-companion-local-revocation', async run() {
      const revoked = await ownerPort.localRevoke(); ensure(revoked?.revoked === true && revoked.authority?.durable === true, 'qa_companion_game_receipt');
      observations.localRevoked = true;
      // Deliberately do not call freshSession: even an expired local capability
      // must remain refused. The game-owned revocation is separately durable.
      const command = { type: 'move', roomId: body.roomId, entityId: body.entityId, commandId: commandId + '-revoked', x: body.x, z: body.z };
      const proof = { sequence: sequence + 1, at: now(), method: 'POST', path: new URL(routes.command).pathname,
        action: command.type, roomId: body.roomId, entityId: body.entityId, body: { command } };
      const refused = await call(routes.command, { sessionId: admission.sessionId, sequence: proof.sequence, at: proof.at, command,
        signature: sign(null, Buffer.from(agentCommandMessage(admission.sessionId, proof)), key.privateKey).toString('base64url') });
      ensure(!refused.ok && ['native_agent_session_unavailable', 'agent_session_unavailable'].includes(refused.value?.error), 'qa_companion_revocation_failed');
      const denied = await call(routes.challenge, { grantId: nativeGrant.id, sessionPublicKeyJwk: key.publicKey.export({ format: 'jwk' }) });
      ensure(denied.status === 403 && denied.value?.error === 'native_grant_unavailable', 'qa_companion_revocation_failed');
      observations.negative.push('after-local-revoke');
    } },
    { name: 'native-companion-owner-revocation', async run() {
      ensure(observations.localRevoked, 'qa_companion_local_revoke_required'); const revoked = await ownerPort.ownerPodRevoke();
      ensure(revoked?.revoked === true && revoked.reference?.grantId === nativeGrant.id && revoked.receipt?.visibility === 'public', 'qa_companion_public_readback');
      const after = await ownerPort.readback(); ensure(after.grant?.revoked === true && after.grant.id === nativeGrant.id, 'qa_companion_public_readback'); observations.ownerPodRevoked = true;
    } },
  ], name => { ensure(!closed, 'qa_companion_closed'); onStage(name); });
  const status = () => ({ kind: 'native_companion_qa', ...stages.status(), compoundStep, closed, lastHttpStatus, lastHttpCode,
    hasKey: !!key, hasAdmission: !!admission, admissionLive: !!admission && admission.expiresAt > now(),
    publicGrantRetained: !!published, ownBodyRetained: !!body, nextSequence: sequence + 1,
    ...clone(observations), nativeCounterMeasured, nativeCounterAvailable: description?.proof?.counterObservationAdvertised === true,
    advertisedLeaseMs: manifest?.nativeAgents?.leaseMs ?? null, freshnessIsPlayerPing: false });
  return Object.freeze({ status, next() { ensure(!closed, 'qa_companion_closed'); return stages.next(); },
    remaining() { ensure(!closed, 'qa_companion_closed'); return stages.remaining(); },
    restartAdmission() {
      ensure(!closed && !stages.status().busy && stages.status().stage === 'native-companion-proof-and-commands'
        && !observations.localRevoked, 'qa_companion_restart_refused');
      key = null; challenge = null; envelope = null; admission = null; completeAttempted = false; sequence = 0; phase = 0;
      lastCommand = null; completedCommand = null; counterBefore = null; observations.negative = []; observations.fastCommandAccepted = false;
      observations.renewed = false; observations.observed = false; compoundStep = 'manual-restart'; return status();
    },
    close() { closed = true; stopped.abort(); key = null; challenge = null; envelope = null; admission = null; lastCommand = null; completedCommand = null; },
  });
}
