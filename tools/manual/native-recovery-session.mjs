/** Retained browser-only QA recovery. No import-time browser, identity or pod I/O. */
export async function recoverNativeOwnerQa(config, suppliedModules) {
  const target = globalThis;
  const { run, owner, relayOrigin, recovery, passphrase, expected } = config;
  const codes = new Set(['invalid_input', 'invalid_record', 'invalid_identity', 'invalid_owner', 'invalid_relay',
    'invalid_credential', 'key_storage_unavailable', 'not_connected', 'native_unavailable', 'capability_missing',
    'owner_mismatch', 'native_contract', 'key_required', 'key_exists', 'recipient_conflict', 'registration_pending',
    'invalid_head', 'fork', 'conflict', 'invalid_proof', 'cannot_decrypt', 'needs_reauth', 'native_refused',
    'invalid_profile', 'invalid_profile_index', 'missing_profile_index', 'profile_index_conflict', 'unread_record',
    'missing_record', 'recovery_required', 'revoked', 'tool_error', 'manifest_incomplete', 'server_unavailable', 'upstream_error',
    'qa_scope_mismatch', 'qa_binding', 'qa_access_cache',
    'qa_bridge_refused', 'qa_readback', 'qa_recovery_initial_state', 'qa_key_replacement_not_blocked',
    'qa_recovery_not_required', 'qa_recovery_not_ready', 'qa_recovery_registration_required']);
  const fail = code => Object.assign(new Error('Retained native recovery QA condition failed.'), { code });
  if (!run || expected?.qa?.run !== run || !owner?.subjectDid || !owner?.podUrl || !owner?.accountId) throw fail('qa_scope_mismatch');
  let retained = target.__hmNativeQaRecovery;
  if (retained && !retained.matches?.(run, owner, relayOrigin)) throw fail('qa_scope_mismatch');
  if (!retained) {
    let step = 'binding-check', code = null, profile = null, native = null, cache = null, checked = false, complete = false, busy = false;
    let credentialExpiresAt = 0;
    const originalToken = localStorage.getItem('hallowmarch.token.' + location.host);
    const originalHost = location.host, originalNet = target.__hm?.net?.NETWS, history = [];
    const originalGeneration = originalNet?.generation;
    const numberCode = value => Number.isInteger(value) && ((value >= 100 && value <= 599)
      || (value >= -32700 && value <= -32000)) ? value : null;
    const matches = (nextRun, nextOwner, nextRelay) => nextRun === run && nextRelay === relayOrigin
      && nextOwner?.subjectDid === owner.subjectDid && nextOwner?.podUrl === owner.podUrl && nextOwner?.accountId === owner.accountId;
    const state = () => profile?.status() || {};
    const profileStates = new Set(['connecting', 'ready', 'key_required', 'saving', 'uncertain', 'index_pending', 'link_pending', 'saved', 'closed']);
    const status = () => ({ step, code, busy, checked, complete, profilePresent: !!profile,
      keyPresent: state().keyPresent === true, hasRecord: state().hasRecord === true, pending: state().pending === true,
      profileState: profileStates.has(state().state) || codes.has(state().state) ? state().state : null,
      connected: native?.status().connected === true, tools: history.map(entry => ({ ...entry })) });
    const sameSession = () => {
      const net = target.__hm?.net?.NETWS;
      if (location.host !== originalHost || localStorage.getItem('hallowmarch.token.' + location.host) !== originalToken
        || net !== originalNet || !net?.acct?.nativeBound || net.acct.id !== owner.accountId || net.token !== originalToken) throw fail('qa_binding');
      if (!Number.isSafeInteger(originalGeneration) || net.generation !== originalGeneration) throw fail('qa_binding');
    };
    const verifyBinding = async () => {
      sameSession();
      const response = await fetch('/gaming/identity/status', { method: 'GET', cache: 'no-store',
        headers: { Authorization: 'Bearer ' + originalToken }, signal: AbortSignal.timeout(18000) });
      if (!response.ok) throw fail('qa_bridge_refused');
      const binding = await response.json();
      if (!binding.verified || binding.account?.id !== owner.accountId || binding.binding?.subjectDid !== owner.subjectDid
        || binding.binding?.podUrl !== owner.podUrl) throw fail('qa_binding');
      sameSession();
      return binding;
    };
    const readiness = async () => {
      step = 'recovery-readiness';
      if (!profile || state().state === 'closed' || !native?.status().connected || state().pending || native.status().pending
        || !Number.isFinite(credentialExpiresAt) || credentialExpiresAt <= Date.now()) throw fail('qa_recovery_not_ready');
      await verifyBinding();
      // Pure local key/readiness inspection, with no registration or publish.
      await native.keyStatus();
      sameSession();
    };
    const initialize = async () => {
      if (profile) return;
      step = 'binding-check';
      const request = async (path, init = {}) => {
        if (path !== '/gaming/identity/status' || init.body) throw fail('qa_scope_mismatch');
        const response = await fetch(path, { method: 'GET', cache: 'no-store',
          headers: { Authorization: 'Bearer ' + originalToken }, signal: AbortSignal.timeout(18000) });
        if (!response.ok) throw fail('qa_bridge_refused');
        return response.json();
      };
      const binding = await verifyBinding();
      const [{ createBrowserAccessCache }, { createPlayerPodProfile }, { createNativePodClient }, { RelayMcpTransport }] = suppliedModules || await Promise.all([
        import('/gaming/identity/assets/access-cache.mjs'), import('/gaming/identity/assets/profile.mjs'),
        import('/gaming/identity/assets/client.mjs'), import('/gaming/identity/assets/vendor/interego-browser.mjs'),
      ]);
      step = 'access-cache'; cache ||= createBrowserAccessCache();
      const held = await cache.get({ relayUrl: relayOrigin, ownerDid: owner.subjectDid, podUrl: owner.podUrl });
      if (!held || held.credential?.refreshToken || !Number.isFinite(held.expiresAt) || held.expiresAt <= Date.now()) throw fail('qa_access_cache');
      credentialExpiresAt = held.expiresAt;
      const transport = new RelayMcpTransport(relayOrigin, { ...held.credential }, globalThis.fetch.bind(globalThis));
      const call = transport.callTool.bind(transport);
      transport.callTool = async (name, input, options) => {
        const graph = input.graph_iri ?? input.urn;
        const index = typeof graph === 'string' && graph.startsWith('urn:graph:hallowmarch:player-profile-index:');
        const nativeStep = name === 'get_pod_status' ? 'native-connect' : name === 'get_current_head' ? (index ? 'owner-index-head' : 'profile-head')
          : name === 'get_descriptor' ? (input.url === owner.podUrl + 'agents' ? 'recipient-registry-read' : 'signed-descriptor-readback')
          : name === 'register_agent' ? 'recipient-register' : name === 'get_encrypted_graph' ? 'encrypted-readback' : 'native-capability';
        const add = entry => { history.push({ step: nativeStep, ...entry }); if (history.length > 32) history.shift(); };
        sameSession();
        if (!['get_pod_status', 'get_current_head', 'get_descriptor', 'get_encrypted_graph'].includes(name)) {
          // The original registered recipient must already exist. Recovery may
          // inspect it; it cannot register a different/missing recipient or
          // publish any private version while diagnosing an uncertain read.
          add({ outcome: 'refused', code: 'qa_recovery_registration_required', numericCode: null, timeout: false });
          throw fail('qa_recovery_registration_required');
        }
        try {
          const result = await call(name, input, options);
          sameSession();
          add({ outcome: result?.error ? 'refused' : 'returned', code: result?.error ? (codes.has(result.error) ? result.error : 'operation_failed') : null,
            numericCode: numberCode(result?.code), timeout: false });
          return result;
        } catch (error) {
          add({ outcome: 'threw', code: codes.has(error?.code) ? error.code : 'operation_failed',
            numericCode: numberCode(error?.result?.error?.code) ?? numberCode(error?.result?.payload?.code),
            timeout: ['TimeoutError', 'AbortError'].includes(error?.name) });
          throw error;
        }
      };
      // Deliberately omit the Hallow pointer: discovery belongs to the owner pod.
      profile = createPlayerPodProfile({ binding: binding.binding, credential: held.credential, relayUrl: relayOrigin, request,
        createClient: input => { native = createNativePodClient({ ...input, transport }); return native; } });
    };
    retained = target.__hmNativeQaRecovery = Object.freeze({ matches, status,
      get profile() { return profile; }, get cache() { return cache; },
      async recover() {
        if (busy) return { ok: false, ...status(), code: 'operation_busy' };
        busy = true;
        try {
          sameSession();
          if (complete) { await verifyBinding(); return { ok: true, ...status(), busy: false }; }
          await initialize();
          if (!checked) {
            step = 'profile-connect'; const connected = await profile.connect(); sameSession();
            if (connected.keyPresent || !connected.hasRecord) throw fail('qa_recovery_initial_state');
            step = 'key-replacement-rejection';
            let replacementBlocked = false;
            try { await profile.createKey(); } catch (error) { if (error.code !== 'recovery_required') throw error; replacementBlocked = true; }
            sameSession();
            if (!replacementBlocked) throw fail('qa_key_replacement_not_blocked');
            step = 'pre-recovery-read';
            let blocked = false;
            try { await profile.get(); } catch (error) { if (error.code !== 'key_required') throw error; blocked = true; }
            sameSession();
            if (!blocked) throw fail('qa_recovery_not_required');
            checked = true;
          }
          await readiness();
          step = 'key-restore'; await profile.restoreRecovery(recovery, passphrase); sameSession();
          step = 'exact-profile-readback'; const read = await profile.get();
          sameSession(); await verifyBinding();
          if (!read.exists || JSON.stringify(read.data()) !== JSON.stringify(expected)) throw fail('qa_readback');
          step = 'complete'; code = null; complete = true;
          return { ok: true, ...status(), busy: false };
        } catch (error) {
          code = codes.has(error?.code) ? error.code : 'operation_failed';
          if (code === 'qa_binding') complete = false;
          return { ok: false, ...status(), busy: false };
        } finally { busy = false; }
      },
    });
  }
  return retained.recover();
}
