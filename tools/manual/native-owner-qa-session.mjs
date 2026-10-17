/** Browser-only retained manual QA. Never part of the shipped game or automatic CI. */
export async function installNativeOwnerQaSession(config, suppliedModules) {
  // Self-contained so Playwright can serialize this function without a server
  // route. Secrets, exact payloads and native operation maps stay in this page.
  const target = globalThis;
  const fixedCodes = new Set(['invalid_input', 'invalid_record', 'invalid_identity', 'invalid_owner', 'invalid_relay',
    'invalid_credential', 'record_capacity', 'key_storage_unavailable', 'not_connected', 'native_unavailable',
    'capability_missing', 'owner_mismatch', 'native_contract', 'key_required', 'key_exists', 'recipient_conflict',
    'registration_pending', 'invalid_head', 'fork', 'conflict', 'invalid_proof', 'cannot_decrypt', 'unknown_operation',
    'key_registration_required', 'confirmation_required', 'needs_reauth', 'native_refused', 'crypto_unavailable',
    'invalid_profile', 'invalid_profile_index', 'missing_profile_index', 'profile_index_conflict', 'pod_pending',
    'pod_index_pending', 'pod_link_pending', 'unread_record', 'missing_record', 'recovery_required', 'revoked',
    'tool_error', 'manifest_incomplete', 'qa_owner_not_fresh', 'qa_scope_mismatch', 'qa_access_cache',
    'qa_bridge_refused', 'qa_bridge_body', 'qa_binding', 'qa_readback', 'qa_confirmation_timeout', 'qa_checkpoint_unavailable', 'qa_checkpoint_failed']);
  const safeCode = value => fixedCodes.has(value) ? value : 'operation_failed';
  const numberCode = value => Number.isInteger(value) && ((value >= 100 && value <= 599)
    || (value >= -32700 && value <= -32000)) ? value : null;
  const failure = code => Object.assign(new Error('Manual native QA condition failed.'), { code });
  const { run, owner, relayOrigin, expected, passphrase, checkpointEnabled = false } = config;
  if (checkpointEnabled && typeof target.__hmNativeQaCheckpoint !== 'function') throw failure('qa_checkpoint_unavailable');
  if (!run || expected?.qa?.run !== run || !owner?.subjectDid || !owner?.podUrl || !owner?.accountId) throw failure('qa_scope_mismatch');
  if (target.__hmNativeQaSession) {
    if (!target.__hmNativeQaSession.matches(run, owner, relayOrigin)) throw failure('qa_scope_mismatch');
    return target.__hmNativeQaSession.status();
  }
  const modules = suppliedModules || await Promise.all([
    import('/gaming/identity/assets/access-cache.mjs'), import('/gaming/identity/assets/client.mjs'),
    import('/gaming/identity/assets/profile.mjs'), import('/gaming/identity/assets/vendor/interego-browser.mjs'),
  ]);
  const [{ createBrowserAccessCache }, { createNativePodClient }, { createPlayerPodProfile }, { RelayMcpTransport }] = modules;
  let step = 'access-cache', lastError = null, profile = null, native = null, transport = null;
  let connected = false, freshChecked = false, freshRefused = false, keyStarted = false, keyReady = false, setStarted = false;
  let recovery = null, recoveryCheckpointed = false, checkpointFailed = false, complete = false, closed = false, busy = false;
  const checkpoint = async event => {
    try { if ((await target.__hmNativeQaCheckpoint(event))?.ok !== true) throw failure('qa_checkpoint_failed'); }
    catch { checkpointFailed = true; throw failure('qa_checkpoint_failed'); }
  };
  const history = [], cache = createBrowserAccessCache();
  const matches = (nextRun, nextOwner, nextRelay) => nextRun === run && nextRelay === relayOrigin
    && nextOwner.subjectDid === owner.subjectDid && nextOwner.podUrl === owner.podUrl && nextOwner.accountId === owner.accountId;
  const recordTool = entry => { history.push(entry); if (history.length > 32) history.shift(); };
  const status = () => ({ kind: 'native_qa_session', step, code: lastError?.code || null,
    complete, busy, connected, keyStarted, keyReady, setStarted, recoveryPresent: !!recovery,
    profilePresent: !!profile, pending: !!profile?.status().pending,
    hasRecord: !!profile?.status().hasRecord, indexed: !!profile?.status().indexed,
    linked: !!profile?.status().linked, nativePendingCount: native?.status().pending || 0,
    profileState: ['connecting', 'ready', 'key_required', 'saving', 'uncertain', 'index_pending', 'link_pending', 'saved', 'closed']
      .includes(profile?.status().state) ? profile.status().state : safeCode(profile?.status().state),
    tools: history.map(entry => ({ ...entry })) });
  const request = async (path, init = {}) => {
    if (!['/gaming/identity/status', '/gaming/identity/record-link'].includes(path)
      || (init.body && Object.keys(init.body).sort().join(',') !== 'cid,descriptorUrl,graphIri,kind')) throw failure('qa_bridge_body');
    if (path.endsWith('/record-link')) step = 'game-pointer-link';
    const appToken = localStorage.getItem('hallowmarch.token.' + location.host);
    const response = await fetch(path, { method: init.method || 'GET', cache: 'no-store', credentials: 'same-origin',
      headers: { Authorization: 'Bearer ' + appToken, ...(init.body ? { 'Content-Type': 'application/json' } : {}) },
      ...(init.body ? { body: JSON.stringify(init.body) } : {}) });
    if (!response.ok) throw failure('qa_bridge_refused');
    const result = await response.json();
    if (path.endsWith('/status') && (!result.verified || result.binding?.subjectDid !== owner.subjectDid
      || result.binding?.podUrl !== owner.podUrl || result.account?.id !== owner.accountId)) throw failure('qa_binding');
    return result;
  };
  function nativeStep(name, input) {
    const graphIri = input.graph_iri ?? input.urn;
    const index = typeof graphIri === 'string' && graphIri.startsWith('urn:graph:hallowmarch:player-profile-index:');
    if (name === 'get_pod_status') return 'native-connect';
    if (name === 'get_current_head') return index ? 'owner-index-head' : 'profile-head';
    if (name === 'get_descriptor') return input.url === owner.podUrl + 'agents' ? 'recipient-registry-read' : 'signed-descriptor-readback';
    if (name === 'register_agent') return 'recipient-register';
    if (name === 'publish_context') return index ? 'owner-index-publish' : 'profile-publish';
    if (name === 'get_encrypted_graph') return 'encrypted-readback';
    return 'native-capability';
  }
  async function initialize() {
    if (profile) return;
    step = 'binding-check'; const binding = await request('/gaming/identity/status');
    if (binding.recordLinks?.character) throw failure('qa_owner_not_fresh');
    step = 'access-cache';
    const held = await cache.get({ relayUrl: relayOrigin, ownerDid: owner.subjectDid, podUrl: owner.podUrl });
    if (!held || held.credential.refreshToken || held.expiresAt <= Date.now()) throw failure('qa_access_cache');
    transport = new RelayMcpTransport(relayOrigin, { ...held.credential }, globalThis.fetch.bind(globalThis));
    const call = transport.callTool.bind(transport);
    transport.callTool = async (name, input, options) => {
      const toolStep = nativeStep(name, input); step = toolStep;
      try {
        if (checkpointEnabled && name === 'publish_context') await checkpoint({ kind: 'publication',
          recordKind: toolStep === 'owner-index-publish' ? 'index' : 'profile', graphIri: input.graph_iri,
          operationId: input.descriptor_id?.replace(/^urn:uuid:/, ''), digest: input.content_digest });
        const result = await call(name, input, options);
        recordTool({ step: toolStep, outcome: result?.error ? 'refused' : 'returned',
          code: result?.error ? safeCode(result.error) : null, numericCode: numberCode(result?.code) });
        return result;
      } catch (error) {
        recordTool({ step: toolStep, outcome: 'threw', code: safeCode(error?.code),
          numericCode: numberCode(error?.result?.error?.code) ?? numberCode(error?.result?.payload?.code) });
        throw error;
      }
    };
    profile = createPlayerPodProfile({ binding: binding.binding, credential: held.credential, relayUrl: relayOrigin, request,
      createClient: input => { native = createNativePodClient({ ...input, transport }); return native; } });
  }
  const api = Object.freeze({ matches, status,
    async ensureSaved({ confirmationMs = 180000 } = {}) {
      if (closed || busy) return { ok: false, ...status(), code: closed ? 'revoked' : 'operation_busy' };
      busy = true;
      try {
        if (checkpointFailed) throw failure('qa_checkpoint_failed');
        if (freshRefused) throw failure('qa_owner_not_fresh');
        await initialize();
        if (!connected) {
          step = 'profile-connect'; const result = await profile.connect(); connected = true;
          if (!freshChecked && (result.hasRecord || (result.keyPresent && !keyStarted))) {
            freshRefused = true; throw failure('qa_owner_not_fresh');
          }
          freshChecked = true;
        }
        if (!keyReady) {
          if (keyStarted && (await native.keyStatus()).keyPresent) {
            // A prior registration refusal may follow durable local key creation.
            // Reconnect registers that SAME key; never replace it or its recipient.
            step = 'recipient-register-resume'; await profile.connect();
          } else { keyStarted = true; step = 'browser-key-create'; await profile.createKey(); }
          keyReady = true;
        }
        if (!recovery) { step = 'encrypted-recovery-export'; recovery = await profile.exportRecovery(passphrase); }
        if (checkpointEnabled && !recoveryCheckpointed) {
          await checkpoint({ kind: 'recovery', recovery }); recoveryCheckpointed = true;
        }
        if (!complete) {
          step = setStarted ? 'profile-confirmation-retry' : 'profile-set';
          const persist = setStarted ? () => profile.retry() : () => { setStarted = true; return profile.set(expected); };
          try { await persist(); } catch (error) {
            if (checkpointFailed) throw failure('qa_checkpoint_failed');
            if (!['pod_pending', 'pod_index_pending', 'pod_link_pending'].includes(error?.code)) throw error;
          }
          const deadline = Date.now() + Math.min(Math.max(confirmationMs, 0), 180000);
          while (profile.status().state !== 'saved') {
            if (checkpointFailed) throw failure('qa_checkpoint_failed');
            if (Date.now() >= deadline) throw failure('qa_confirmation_timeout');
            await new Promise(resolve => setTimeout(resolve, 1500));
            try { await profile.retry(); } catch (error) { if (!['pod_pending', 'pod_index_pending', 'pod_link_pending'].includes(error?.code)) throw error; }
          }
          step = 'exact-profile-readback'; const read = await profile.get();
          if (!read.exists || JSON.stringify(read.data()) !== JSON.stringify(expected)) throw failure('qa_readback');
          complete = true;
        }
        lastError = null; busy = false; return { ok: true, ...status() };
      } catch (error) {
        lastError = { code: safeCode(error?.code) }; busy = false; return { ok: false, ...status() };
      } finally { busy = false; }
    },
    async diagnose() {
      // Status only: no native writes, registration, key creation or retry.
      const report = status();
      if (native && connected) {
        try { const key = await native.keyStatus(); report.heldKeyPresent = !!key.keyPresent; report.recipientRegistered = !!key.keyRegistered; }
        catch (error) { report.keyStatusCode = safeCode(error?.code); }
      }
      return report;
    },
    encryptedRecovery() { if (!complete || !recovery) throw failure('qa_readback'); return recovery; },
    async close() { closed = true; profile?.close(); await cache.close(); recovery = null; },
  });
  target.__hmNativeQaSession = api;
  return status();
}
