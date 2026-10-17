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
    'qa_bridge_refused', 'qa_bridge_body', 'qa_binding', 'qa_readback', 'qa_confirmation_timeout',
    'checkpoint_binding_pending', 'checkpoint_binding_conflict', 'checkpoint_write_budget', 'missing_checkpoint',
    'invalid_checkpoint', 'invalid_checkpoint_mode', 'invalid_checkpoint_sender', 'INVALID_ARGUMENT', 'UNSUPPORTED',
    'TRANSPORT', 'TIMEOUT', 'HTTP', 'INTEGRITY', 'LIMIT', 'CONFLICT', 'qa_checkpoint_recovery_refused',
    'qa_checkpoint_digest_changed', 'qa_checkpoint_key_changed', 'qa_checkpoint_write_refused']);
  const safeCode = value => fixedCodes.has(value) ? value : 'operation_failed';
  const checkpointStages = new Set(['protocol-discovery', 'native-read', 'headers', 'envelope', 'owner-key', 'decrypt',
    'body-scope', 'record-digest', 'binding-plan', 'budget', 'history']);
  const safeCheckpointStage = value => checkpointStages.has(value) ? value : null;
  const checkpointChecks = new Set(['schema', 'owner', 'pod', 'graph', 'resource', 'mode', 'key', 'operation', 'previous-revision',
    'time', 'history-shape', 'budget-shape', 'binding-schema', 'record-digest', 'binding-value', 'binding-digest', 'binding-graph',
    'binding-plan-digest', 'binding-record', 'binding-record-value', 'budget-entry', 'history-entry']);
  const safeCheckpointCheck = value => checkpointChecks.has(value) ? value : null;
  const numberCode = value => Number.isInteger(value) && ((value >= 100 && value <= 599)
    || (value >= -32700 && value <= -32000)) ? value : null;
  const failure = code => Object.assign(new Error('Manual native QA condition failed.'), { code });
  const { run, owner, relayOrigin, expected, passphrase, recoverCommittedBootstrap: recoveryEvidence } = config;
  const recovering = !!recoveryEvidence;
  if (!run || expected?.qa?.run !== run || !owner?.subjectDid || !owner?.podUrl || !owner?.accountId) throw failure('qa_scope_mismatch');
  if (target.__hmNativeQaSession) {
    if (!target.__hmNativeQaSession.matches(run, owner, relayOrigin)) throw failure('qa_scope_mismatch');
    return target.__hmNativeQaSession.status();
  }
  const modules = suppliedModules || await Promise.all([
    import('/gaming/identity/assets/access-cache.mjs'), import('/gaming/identity/assets/client.mjs'),
    import('/gaming/identity/assets/profile.mjs'), import('/gaming/identity/assets/vendor/interego-browser.mjs'),
  ]);
  const [{ createBrowserAccessCache }, { createNativePodClient }, { createPlayerPodProfile, playerProfileGraphIri }, { RelayMcpTransport }] = modules;
  let step = 'access-cache', lastError = null, profile = null, native = null, transport = null;
  let connected = false, freshChecked = false, freshRefused = false, keyStarted = false, keyReady = false, setStarted = false;
  let recovery = null, complete = false, closed = false, busy = false;
  let checkpointWriteCount = 0, originalWriteDigest = null, rawEvidence = null, allowRecoveryWrites = false, recoveryReadStarted = false;
  const history = [], cache = createBrowserAccessCache();
  const matches = (nextRun, nextOwner, nextRelay) => nextRun === run && nextRelay === relayOrigin
    && nextOwner.subjectDid === owner.subjectDid && nextOwner.podUrl === owner.podUrl && nextOwner.accountId === owner.accountId;
  const recordTool = entry => { history.push(entry); if (history.length > 32) history.shift(); };
  const status = () => ({ kind: 'native_qa_session', step, code: lastError?.code || null,
    checkpointStage: lastError?.checkpointStage || null, checkpointCheck: lastError?.checkpointCheck || null,
    numericCode: lastError?.numericCode ?? null,
    checkpointWriteCount, recoveringCommittedBootstrap: recovering,
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
    if (path.endsWith('/record-link')) { if (recovering) await verifyExactRecord(); step = 'game-pointer-link'; }
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
  const sha = async bytes => 'sha256:' + [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(x => x.toString(16).padStart(2, '0')).join('');
  const graphAndResource = async () => {
    const graphIri = await playerProfileGraphIri(owner.subjectDid);
    return { graphIri, resourceUrl: owner.podUrl + 'hallowmarch/checkpoints/' + (await sha(new TextEncoder().encode(graphIri))).slice(7) + '.json' };
  };
  const keyHash = async () => {
    const key = await native.keyStatus(), prefix = owner.podUrl + 'agents#browser-encryption-';
    if (!key.keyPresent || !key.keyRegistered || !key.agentId?.startsWith(prefix) || !/^[0-9a-f]{64}$/.test(key.agentId.slice(prefix.length))) throw failure('qa_checkpoint_key_changed');
    return key.agentId.slice(prefix.length);
  };
  const pin = async evidence => {
    const scope = await graphAndResource();
    if (!evidence || evidence.graphIri !== scope.graphIri || evidence.resourceUrl !== scope.resourceUrl
      || !/^sha256:[0-9a-f]{64}$/.test(evidence.cipherDigest || '') || !/^sha256:[0-9a-f]{64}$/.test(evidence.nativeRevision || '')
      || !/^[0-9a-f]{64}$/.test(evidence.recipientKeyHash || '') || !Number.isSafeInteger(evidence.storedBytes)
      || evidence.storedBytes < 1 || evidence.storedBytes > 4194304) throw failure('qa_checkpoint_recovery_refused');
    return scope;
  };
  const readRawCheckpoint = async evidence => {
    const scope = evidence ? await pin(evidence) : await graphAndResource();
    const held = await cache.get({ relayUrl: relayOrigin, ownerDid: owner.subjectDid, podUrl: owner.podUrl });
    if (!held?.credential?.accessToken || held.expiresAt <= Date.now() + 30000) throw failure('needs_reauth');
    const { createNativeResourceClient } = suppliedModules?.[4] || await import('/gaming/identity/assets/vendor/interego-native-resource-browser.mjs');
    const client = createNativeResourceClient({ ...scope, podUrl: owner.podUrl, maxBytes: 4194304, crypto,
      fetch: (url, init) => { const headers = new Headers(init.headers); headers.set('Authorization', 'Bearer ' + held.credential.accessToken);
        return checkpointFetch(url, { ...init, headers }); } });
    await client.ready(); const found = await client.read();
    if (!(found.body instanceof Uint8Array) || !found.body.length || !/^sha256:[0-9a-f]{64}$/.test(found.revision || '')) throw failure('qa_checkpoint_recovery_refused');
    const result = { ...scope, cipherDigest: await sha(found.body), nativeRevision: found.revision, storedBytes: found.body.length };
    if (evidence && (result.cipherDigest !== evidence.cipherDigest || result.nativeRevision !== evidence.nativeRevision
      || result.storedBytes !== evidence.storedBytes)) throw failure('qa_checkpoint_digest_changed');
    rawEvidence = result; return result;
  };
  async function verifyExactRecord() {
    const { graphIri } = await pin(recoveryEvidence), opened = await native.load({ graphIri, checkpoint: 'hallowmarch-character/v1' });
    if (!opened || opened.record.ownerDid !== owner.subjectDid || opened.record.schema !== 'hallowmarch.player-profile/v1'
      || JSON.stringify(opened.record.save) !== JSON.stringify(expected)) throw failure('qa_readback');
    return opened;
  }
  const checkpointFetch = async (url, init = {}) => {
    // Preserve the actual request/response. Record only a bounded method,
    // HTTP status, and fixed failure code, never headers, bytes or errors.
    const method = init.method || 'GET', toolStep = {
      OPTIONS: 'native-checkpoint-options', GET: 'native-checkpoint-get', PUT: 'native-checkpoint-put',
    }[method];
    const parsed = new URL(url), pod = new URL(owner.podUrl);
    if (!toolStep || parsed.origin !== pod.origin || parsed.search || parsed.hash
      || !parsed.pathname.startsWith(pod.pathname + 'hallowmarch/checkpoints/')
      || !/\/[0-9a-f]{64}\.json$/.test(parsed.pathname)) throw failure('qa_scope_mismatch');
    if (recovering && (url !== recoveryEvidence.resourceUrl || method === 'PUT')) throw failure('qa_checkpoint_write_refused');
    if (method === 'PUT') {
      const command = JSON.parse(init.body);
      if (command.version !== 1 || command.expectedRevision !== null || command.contentType !== 'application/json'
        || typeof command.bodyBase64 !== 'string' || command.bodyBase64.length > 5592408) throw failure('qa_checkpoint_recovery_refused');
      originalWriteDigest = await sha(Uint8Array.from(atob(command.bodyBase64), c => c.charCodeAt(0))); checkpointWriteCount++;
    }
    step = toolStep; const startedAt = performance.now();
    const elapsedMs = () => Math.max(0, Math.min(120000, Math.round(performance.now() - startedAt)));
    try {
      const response = await fetch(url, init);
      recordTool({ step: toolStep, outcome: response.ok || response.status === 404 ? 'returned' : 'refused',
        code: null, numericCode: numberCode(response.status), elapsedMs: elapsedMs() });
      if (recovering && method === 'GET') {
        if (response.status !== 200 || response.headers.get('Interego-Revision') !== recoveryEvidence.nativeRevision) throw failure('qa_checkpoint_digest_changed');
        const bytes = new Uint8Array(await response.clone().arrayBuffer());
        if (bytes.length !== recoveryEvidence.storedBytes || await sha(bytes) !== recoveryEvidence.cipherDigest) throw failure('qa_checkpoint_digest_changed');
      }
      return response;
    } catch (error) {
      recordTool({ step: toolStep, outcome: 'threw', code: safeCode(error?.code), numericCode: numberCode(error?.status), elapsedMs: elapsedMs() });
      throw error;
    }
  };
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
      if (recovering && !['get_pod_status', 'get_current_head', 'get_descriptor', 'get_encrypted_graph'].includes(name)) {
        const { graphIri } = await pin(recoveryEvidence), indexIri = graphIri.replace(':player-profile:', ':player-profile-index:');
        if (!allowRecoveryWrites || name !== 'publish_context' || ![graphIri, indexIri].includes(input.graph_iri)
          || input.visibility !== 'private' || input.sealed_payload !== true || input.sign_authorship !== true
          || input.pod_name !== new URL(owner.podUrl).pathname.slice(1, -1)) throw failure('qa_checkpoint_write_refused');
        if (input.graph_iri === indexIri) await verifyExactRecord();
      }
      const toolStep = nativeStep(name, input); step = toolStep;
      try {
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
      createClient: input => { native = createNativePodClient({ ...input, transport, fetch: checkpointFetch }); return native; } });
  }
  async function recoverOriginalBootstrap() {
    await pin(recoveryEvidence); await readRawCheckpoint(recoveryEvidence);
    if (!connected) { await profile.connect(); connected = true; }
    if (await keyHash() !== recoveryEvidence.recipientKeyHash) throw failure('qa_checkpoint_key_changed');
    keyReady = true;
    if (!recoveryReadStarted) {
      try { await verifyExactRecord(); allowRecoveryWrites = true; }
      catch (error) { if (error.code !== 'checkpoint_binding_pending') throw error; }
      recoveryReadStarted = true;
      try { await profile.get(); } catch (error) { if (!['pod_pending', 'pod_index_pending', 'pod_link_pending'].includes(error.code)) throw error; }
    }
    // One explicit attempt, no automatic retry loop. The native profile keeps
    // the original sealed binding plan/operation if its outcome is uncertain.
    await readRawCheckpoint(recoveryEvidence); allowRecoveryWrites = true; await profile.retry();
    const read = await profile.get(); if (!read.exists || JSON.stringify(read.data()) !== JSON.stringify(expected)) throw failure('qa_readback');
    if (!recovery) recovery = await profile.exportRecovery(passphrase);
    complete = true;
  }
  const api = Object.freeze({ matches, status,
    async ensureSaved({ confirmationMs = 180000 } = {}) {
      if (closed || busy) return { ok: false, ...status(), code: closed ? 'revoked' : 'operation_busy' };
      busy = true;
      try {
        if (freshRefused) throw failure('qa_owner_not_fresh');
        await initialize();
        if (recovering) {
          if (!complete) await recoverOriginalBootstrap();
          lastError = null; busy = false; return { ok: true, ...status() };
        }
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
        if (!complete) {
          step = setStarted ? 'profile-confirmation-retry' : 'profile-set';
          const persist = setStarted ? () => profile.retry() : () => { setStarted = true; return profile.set(expected); };
          try { await persist(); } catch (error) { if (!['pod_pending', 'pod_index_pending', 'pod_link_pending'].includes(error?.code)) throw error; }
          const deadline = Date.now() + Math.min(Math.max(confirmationMs, 0), 180000);
          while (profile.status().state !== 'saved') {
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
        lastError = { code: safeCode(error?.code), checkpointStage: safeCheckpointStage(error?.checkpointStage),
          checkpointCheck: safeCheckpointCheck(error?.checkpointCheck),
          numericCode: numberCode(error?.status) }; busy = false; return { ok: false, ...status() };
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
    async checkpointRead() {
      // Explicit retained command only: currentHead performs native reads and
      // authentication. It never confirms by resending a CAS or publishes a
      // missing binding, even when the original operation remains pending.
      if (closed || busy || !native || !connected || typeof playerProfileGraphIri !== 'function') {
        return { ok: false, code: closed ? 'revoked' : busy ? 'operation_busy' : 'not_connected' };
      }
      busy = true;
      try {
        const evidence = await readRawCheckpoint(), recipientKeyHash = await keyHash();
        const known = { knownCommitted: true, originalWriteMatched: checkpointWriteCount === 1 && evidence.cipherDigest === originalWriteDigest,
          ...evidence, recipientKeyHash };
        const graphIri = await playerProfileGraphIri(owner.subjectDid);
        step = 'native-checkpoint-read';
        let head;
        try { head = await native.currentHead({ graphIri, checkpoint: 'hallowmarch-character/v1' }); }
        catch (error) { return { ...known, ok: false, code: safeCode(error?.code), numericCode: numberCode(error?.status),
          checkpointStage: safeCheckpointStage(error?.checkpointStage), checkpointCheck: safeCheckpointCheck(error?.checkpointCheck) }; }
        return { ok: true, found: !!head, checkpointVerified: head?.proofKind === 'owner-key-authenticated-checkpoint',
          hasNativeRevision: typeof head?.nativeRevision === 'string' && !!head.nativeRevision, ...known };
      } catch (error) { return { ok: false, code: safeCode(error?.code), numericCode: numberCode(error?.status),
        checkpointStage: safeCheckpointStage(error?.checkpointStage), checkpointCheck: safeCheckpointCheck(error?.checkpointCheck) }; }
      finally { busy = false; }
    },
    async recoveryPreflight(evidence) {
      if (closed || busy || !connected || !keyReady || !setStarted || !profile?.status().pending || profile.status().indexed
        || profile.status().linked || native.status().pending !== 1 || checkpointWriteCount !== 1) return { ok: false, code: 'qa_checkpoint_recovery_refused' };
      busy = true;
      try {
        await request('/gaming/identity/status'); await readRawCheckpoint(evidence);
        if (evidence.cipherDigest !== originalWriteDigest || await keyHash() !== evidence.recipientKeyHash) throw failure('qa_checkpoint_key_changed');
        return { ok: true };
      } catch (error) { return { ok: false, code: safeCode(error?.code) }; }
      finally { busy = false; }
    },
    encryptedRecovery() { if (!complete || !recovery) throw failure('qa_readback'); return recovery; },
    async close() { closed = true; profile?.close(); await cache.close(); recovery = null; },
  });
  target.__hmNativeQaSession = api;
  return status();
}
