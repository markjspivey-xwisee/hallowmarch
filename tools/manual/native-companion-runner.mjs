/** Optional manual runner composition. Imports perform no browser/native I/O. */
import { nativeCompanionOptIn, createNativeCompanionLiveQa } from './native-companion-live.mjs';
import { installNativeCompanionOwnerQaSession } from './native-companion-owner-session.mjs';
import { nativeCompanionBrowserRequest } from './native-companion-browser-request.mjs';

const fail = code => { throw Object.assign(new Error('Manual companion runner refused.'), { code }); };
export function nativeCompanionRunnerConfig(env = process.env) {
  if (!nativeCompanionOptIn(env)) return null;
  const agentDid = env.HM_NATIVE_COMPANION_AGENT_DID, agentPodUrl = env.HM_NATIVE_COMPANION_AGENT_POD_URL;
  if (typeof agentDid !== 'string' || !/^did:web:[A-Za-z0-9._%:-]+:agents:[A-Za-z0-9._%-]+$/.test(agentDid)
    || agentDid.length > 512 || typeof agentPodUrl !== 'string' || agentPodUrl.length > 2048) fail('qa_companion_agent_configuration');
  let pod; try { pod = new URL(agentPodUrl); } catch { fail('qa_companion_agent_configuration'); }
  if (pod.protocol !== 'https:' || pod.href !== agentPodUrl || !pod.pathname.endsWith('/') || pod.username || pod.password
    || pod.search || pod.hash) fail('qa_companion_agent_configuration');
  return Object.freeze({ agentDid, agentPodUrl });
}

export function createNativeCompanionRunner({ config, run, gameOrigin, relayOrigin, getOwner, getPage,
  privateQaComplete, signNativeRequest, onStage = () => {}, createQa = createNativeCompanionLiveQa } = {}) {
  if (!config || !['getOwner', 'getPage', 'privateQaComplete', 'signNativeRequest'].every(name =>
    typeof ({ getOwner, getPage, privateQaComplete, signNativeRequest })[name] === 'function')) fail('qa_companion_runner_configuration');
  let qa = null, opening = null, closed = false, page = null, statusFlight = null;
  async function ownerStatus() {
    if (!page) return { kind: 'native_companion_owner_qa', installed: false };
    if (statusFlight) return { kind: 'native_companion_owner_qa', inFlight: true, timedOut: true };
    const selected = page;
    const job = Promise.resolve().then(() => selected.evaluate(() => window.__hmNativeCompanionQa?.status() || null)).then(value => {
      const result = { kind: 'native_companion_owner_qa', installed: !!value, inFlight: false, timedOut: false };
      if (!value) return result;
      for (const key of ['busy', 'closed', 'connected', 'requestPending', 'bodyPresent', 'publicationAttempted',
        'publicationPending', 'publicSaved', 'registered', 'localRevoked', 'podRevoked']) result[key] = value[key] === true;
      result.step = ['installed', 'actual-game-body', 'owner-binding', 'native-agent-discovery', 'owner-access-cache',
        'owner-native-connect', 'public-scoped-grant', 'owner-public-readback', 'game-reference-register',
        'game-local-revoke', 'owner-pod-revoke'].includes(value.step) ? value.step : null;
      result.code = nativeCompanionFailureCode({ code: value.code }); return result;
    }, () => ({ kind: 'native_companion_owner_qa', unavailable: true }));
    statusFlight = job;
    job.then(() => { if (statusFlight === job) statusFlight = null; });
    let timer;
    try { return await Promise.race([job, new Promise(resolve => { timer = setTimeout(() => resolve({
      kind: 'native_companion_owner_qa', inFlight: true, timedOut: true }), 2000); })]); }
    finally { clearTimeout(timer); }
  }
  async function open() {
    if (closed) fail('qa_companion_closed');
    if (privateQaComplete() !== true) fail('qa_companion_private_qa_required');
    if (qa) return qa;
    if (opening) return opening;
    const owner = getOwner(), selected = getPage();
    if (!owner || !selected || selected.isClosed()) fail('qa_companion_owner_session');
    page = selected;
    opening = (async () => {
      // The browser installer is scope-bound and idempotent. An uncertain
      // evaluate reply re-enters the existing UUID/client, never a new grant.
      await page.evaluate(installNativeCompanionOwnerQaSession, {
        enabled: true, run, owner, gameOrigin, relayOrigin, ...config,
      });
      if (closed) fail('qa_companion_closed');
      const ownerPort = Object.fromEntries(['enterAndSpawn', 'publish', 'readback', 'register', 'localRevoke', 'ownerPodRevoke']
        .map(method => [method, () => page.evaluate(method => window.__hmNativeCompanionQa[method](), method)]));
      const request = async (url, init) => {
        const result = await page.evaluate(nativeCompanionBrowserRequest, { url, init: {
          method: init.method, headers: init.headers, ...(init.body === undefined ? {} : { body: init.body }),
          credentials: 'omit', redirect: 'error', cache: 'no-store',
        } });
        return { ...result, json: async () => result.value };
      };
      qa = createQa({ enabled: true, gameOrigin, relayOrigin, expectedOwner: owner, ...config,
        ownerPort, request, signNativeRequest, onStage });
      return qa;
    })();
    try { return await opening; } finally { opening = null; }
  }
  return Object.freeze({
    status: () => qa ? qa.status() : ({ kind: 'native_companion_qa', stage: 'not-started', completed: 0, total: 8,
      complete: false, busy: !!opening, closed }),
    async next() { return (await open()).next(); },
    async remaining() { return (await open()).remaining(); },
    restartAdmission() { if (closed || !qa) fail('qa_companion_restart_refused'); return qa.restartAdmission(); },
    ownerStatus,
    close() { closed = true; qa?.close(); },
  });
}

const codes = new Set(['qa_companion_private_qa_required', 'qa_companion_agent_configuration', 'qa_companion_runner_configuration',
  'qa_companion_opt_in', 'qa_companion_origin', 'qa_companion_scope', 'qa_companion_owner_port', 'qa_companion_signing_port',
  'qa_companion_closed', 'qa_companion_description', 'qa_companion_http_uncertain', 'qa_companion_response', 'qa_companion_http_refused',
  'qa_companion_admission_expired', 'qa_companion_negative_failed', 'qa_companion_native_description_unconfirmed', 'qa_companion_body',
  'qa_companion_public_readback', 'qa_companion_game_receipt', 'qa_companion_challenge', 'qa_companion_admission_uncertain',
  'qa_companion_native_receipt', 'qa_companion_fast_native_reads', 'qa_companion_command_result', 'qa_companion_renewal',
  'qa_companion_redaction', 'qa_companion_revocation_failed', 'qa_companion_local_revoke_required', 'qa_companion_restart_refused',
  'qa_companion_signing_configuration', 'qa_companion_signing_busy', 'qa_companion_signing_payload', 'qa_companion_signature_timeout',
  'qa_companion_signature_output', 'qa_companion_signature_envelope', 'qa_companion_signature_binding', 'qa_companion_signing_closed',
  'qa_companion_owner_session', 'qa_companion_owner_binding', 'qa_companion_owner_access', 'qa_companion_owner_operation_failed',
  'qa_companion_game_request_pending', 'qa_companion_game_refused', 'qa_companion_game_timeout', 'qa_companion_busy',
  'qa_companion_socket_uncertain', 'qa_companion_socket_closed', 'qa_companion_socket_timeout', 'qa_companion_domain_refused',
  'qa_companion_room', 'qa_companion_room_not_isolated', 'qa_companion_publication_uncertain', 'qa_companion_publication_pending']);
export const nativeCompanionFailureCode = error => codes.has(error?.code) ? error.code : null;
