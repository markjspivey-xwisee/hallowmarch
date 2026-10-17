/** Browser-only, read-only verification of one generated QA checkpoint.
 * Self-contained for page.evaluate; no import-time I/O or cached PASS authority. */
export async function readNativeQaCheckpoint(config, suppliedModules) {
  const target = globalThis;
  const codes = new Set(['invalid_input', 'invalid_record', 'invalid_identity', 'invalid_owner', 'invalid_relay',
    'invalid_credential', 'record_capacity', 'key_storage_unavailable', 'not_connected', 'native_unavailable',
    'capability_missing', 'owner_mismatch', 'native_contract', 'key_required', 'recipient_conflict', 'registration_pending',
    'invalid_head', 'fork', 'conflict', 'invalid_proof', 'cannot_decrypt', 'needs_reauth', 'native_refused',
    'invalid_profile', 'invalid_profile_index', 'missing_profile_index', 'missing_record', 'revoked',
    'qa_checkpoint_scope', 'qa_checkpoint_binding', 'qa_checkpoint_access', 'qa_checkpoint_bridge',
    'qa_checkpoint_index_intent_missing', 'qa_checkpoint_profile_intent_missing', 'qa_checkpoint_index_absent',
    'qa_checkpoint_profile_absent', 'qa_checkpoint_publication_mismatch', 'qa_checkpoint_target_mismatch',
    'qa_checkpoint_readback', 'qa_checkpoint_head', 'qa_checkpoint_write_blocked', 'qa_checkpoint_cleanup']);
  const failure = code => Object.assign(new Error('Read-only native QA checkpoint verification refused.'), { code });
  const boundedText = (value, max = 1024) => typeof value === 'string' && value.length > 0 && value.length <= max
    && !/[\s\u0000-\u001f\u007f]/.test(value);
  const graph = value => boundedText(value) && /^urn:graph:[^<>"{}|^`\\]+$/.test(value);
  const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);
  const digest = value => typeof value === 'string' && /^graph-nquads-sha256:[0-9a-f]{64}$/.test(value);
  let phase = 'scope-check';
  try {
    const { owner, relayOrigin, gameOrigin, recovery, passphrase, expected, publications } = config || {};
    const origin = value => { const url = new URL(value); return url.protocol === 'https:' && url.origin === value; };
    if (!owner || !boundedText(owner.subjectDid) || !owner.subjectDid.startsWith('did:') || !boundedText(owner.accountId, 256)
      || !boundedText(owner.podUrl) || !origin(gameOrigin) || !origin(relayOrigin) || gameOrigin === relayOrigin
      || !recovery || typeof recovery !== 'object' || typeof passphrase !== 'string' || !expected || expected.v !== 1
      || !boundedText(expected.qa?.run, 128) || !Array.isArray(publications) || publications.length > 2) throw failure('qa_checkpoint_scope');
    const pod = new URL(owner.podUrl);
    if (pod.protocol !== 'https:' || pod.href !== owner.podUrl || pod.username || pod.password || pod.search || pod.hash
      || !/^\/[A-Za-z0-9_-]+\/$/.test(pod.pathname)) throw failure('qa_checkpoint_scope');
    const intent = kind => {
      const found = publications.filter(value => value?.kind === kind);
      if (found.length === 0) throw failure(kind === 'index' ? 'qa_checkpoint_index_intent_missing' : 'qa_checkpoint_profile_intent_missing');
      if (found.length !== 1 || Object.keys(found[0]).sort().join(',') !== 'digest,graphIri,kind,operationId'
        || !graph(found[0].graphIri) || !uuid(found[0].operationId) || !digest(found[0].digest)) throw failure('qa_checkpoint_scope');
      return { ...found[0] };
    };
    const indexIntent = intent('index'), profileIntent = intent('profile');
    if (publications.length !== 2 || indexIntent.graphIri === profileIntent.graphIri) throw failure('qa_checkpoint_scope');
    // Scope includes private expected/recovery inputs, but is held only in this
    // page's closure. Neither it nor any native credential enters a report.
    const scope = JSON.stringify({ owner: { accountId: owner.accountId, subjectDid: owner.subjectDid, podUrl: owner.podUrl },
      relayOrigin, gameOrigin, recovery, passphrase, expected, publications: [indexIntent, profileIntent] });
    let retained = target.__hmNativeQaCheckpointRead;
    if (retained) {
      if (!retained.matches?.(scope)) throw failure('qa_checkpoint_scope');
      return retained.read();
    }
    // All browser/session authority is pinned before the first await.
    const originalGame = target.__hm, originalNet = originalGame?.net?.NETWS;
    const token = originalNet?.token, generation = originalNet?.generation, originalHost = location.host;
    const ownerPin = { accountId: owner.accountId, subjectDid: owner.subjectDid, podUrl: owner.podUrl };
    let bindingPin = null, flight = null;
    const sameSession = () => {
      const h = target.__hm, net = h?.net?.NETWS;
      if (target.__hmNativeQaCheckpointRead !== retained || location.origin !== gameOrigin || location.host !== originalHost
        || h !== originalGame || net !== originalNet || !boundedText(token, 16384) || net?.token !== token
        || !Number.isSafeInteger(generation) || net.generation !== generation || net.reload
        || net.acct?.id !== ownerPin.accountId || net.acct.nativeBound !== true
        || localStorage.getItem('hallowmarch.token.' + originalHost) !== token) throw failure('qa_checkpoint_binding');
    };
    const verifyBinding = async () => {
      sameSession();
      const response = await fetch('/gaming/identity/status', { method: 'GET', cache: 'no-store', credentials: 'omit', redirect: 'error',
        headers: { Authorization: 'Bearer ' + token }, signal: AbortSignal.timeout(18000) });
      sameSession(); if (!response.ok) throw failure('qa_checkpoint_bridge');
      const status = await response.json(); sameSession();
      const binding = status?.binding;
      if (status?.bound !== true || status.verified !== true || status.account?.id !== ownerPin.accountId
        || binding?.subjectDid !== ownerPin.subjectDid || binding.podUrl !== ownerPin.podUrl
        || !boundedText(binding.authenticatedAgentDid)) throw failure('qa_checkpoint_binding');
      if (bindingPin && binding.authenticatedAgentDid !== bindingPin.authenticatedAgentDid) throw failure('qa_checkpoint_binding');
      bindingPin ||= { ...ownerPin, authenticatedAgentDid: binding.authenticatedAgentDid };
    };
    const readOnce = async () => {
      let native = null, cache = null, blockedWrite = false, result = null, refused = null;
      try {
        phase = 'binding-check'; await verifyBinding();
        const [{ createBrowserAccessCache }, { createNativePodClient }, { playerProfileIndexGraphIri, validatePlayerProfileIndex, validatePlayerProfile },
          { RelayMcpTransport }] = suppliedModules || await Promise.all([
          import('/gaming/identity/assets/access-cache.mjs'), import('/gaming/identity/assets/client.mjs'),
          import('/gaming/identity/assets/profile.mjs'), import('/gaming/identity/assets/vendor/interego-browser.mjs'),
        ]);
        sameSession();
        phase = 'owner-index-intent';
        const indexGraphIri = await playerProfileIndexGraphIri(ownerPin.subjectDid); sameSession();
        if (indexIntent.graphIri !== indexGraphIri) throw failure('qa_checkpoint_publication_mismatch');
        phase = 'access-cache'; cache = createBrowserAccessCache();
        const held = await cache.get({ relayUrl: relayOrigin, ownerDid: ownerPin.subjectDid, podUrl: ownerPin.podUrl }); sameSession();
        if (!held || held.credential?.kind !== 'relay-oauth-bearer' || typeof held.credential.accessToken !== 'string'
          || !held.credential.accessToken || held.credential.refreshToken || !Number.isFinite(held.expiresAt)
          || held.expiresAt <= Date.now()) throw failure('qa_checkpoint_access');
        const transport = new RelayMcpTransport(relayOrigin, { ...held.credential }, globalThis.fetch.bind(globalThis));
        const call = transport.callTool.bind(transport), connect = transport.connect.bind(transport);
        transport.connect = async (...args) => { sameSession(); const found = await connect(...args); sameSession(); return found; };
        transport.callTool = async (name, input, options) => {
          sameSession();
          if (!['get_pod_status', 'get_current_head', 'get_descriptor', 'get_encrypted_graph'].includes(name)) {
            blockedWrite = true; throw failure('qa_checkpoint_write_blocked');
          }
          const found = await call(name, input, options); sameSession(); return found;
        };
        native = createNativePodClient({ relayUrl: relayOrigin, credential: held.credential, ownerDid: ownerPin.subjectDid,
          podUrl: ownerPin.podUrl, transport });
        phase = 'native-connect'; await native.connect(); sameSession();
        phase = 'key-restore'; await native.restoreRecovery(recovery, passphrase); sameSession();
        const exact = (found, expectedIntent) => {
          if (!found || found.graphIri !== expectedIntent.graphIri || found.operationId !== expectedIntent.operationId
            || found.digest !== expectedIntent.digest) throw failure('qa_checkpoint_publication_mismatch');
          if (typeof found.head?.cid !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9:_-]{0,511}$/.test(found.head.cid)) throw failure('qa_checkpoint_head');
        };
        // Raw client reads cannot create a missing owner index or game link.
        phase = 'owner-index-head';
        if (!await native.currentHead({ graphIri: indexGraphIri })) throw failure('qa_checkpoint_index_absent');
        sameSession(); phase = 'owner-index-read';
        const index = await native.load({ graphIri: indexGraphIri }); sameSession();
        if (!index) throw failure('qa_checkpoint_index_absent'); exact(index, indexIntent);
        const graphIri = validatePlayerProfileIndex(index.record, ownerPin.subjectDid);
        if (graphIri !== profileIntent.graphIri) throw failure('qa_checkpoint_target_mismatch');
        phase = 'profile-head';
        if (!await native.currentHead({ graphIri })) throw failure('qa_checkpoint_profile_absent');
        sameSession(); phase = 'profile-read';
        const found = await native.load({ graphIri }); sameSession();
        if (!found) throw failure('qa_checkpoint_profile_absent'); exact(found, profileIntent);
        const save = validatePlayerProfile(found.record, ownerPin.subjectDid);
        if (JSON.stringify(save) !== JSON.stringify(expected) || found.record.provenance?.authority !== 'player-authored'
          || found.record.provenance.importedProgressIsAuthoritative !== false) throw failure('qa_checkpoint_readback');
        phase = 'final-binding'; await verifyBinding();
        result = { ok: true, complete: true, readOnly: true, indexVerified: true, profileVerified: true, publicationsVerified: true,
          heads: { indexGraphIri, indexCid: index.head.cid, indexDigest: index.digest, graphIri, cid: found.head.cid, digest: found.digest } };
      } catch (error) {
        refused = { ok: false, complete: false, phase, code: blockedWrite ? 'qa_checkpoint_write_blocked'
          : codes.has(error?.code) ? error.code : 'operation_failed' };
      } finally {
        let cleanupFailed = false;
        try { await native?.close(); } catch { cleanupFailed = true; }
        try { await cache?.close(); } catch { cleanupFailed = true; }
        if (cleanupFailed) refused = { ok: false, complete: false, phase: 'cleanup', code: 'qa_checkpoint_cleanup' };
      }
      // A cleanup await may allow the current game owner to change. No earlier
      // successful read or prior invocation can supply a reusable PASS.
      if (!refused) {
        try { phase = 'final-binding'; await verifyBinding(); sameSession(); }
        catch (error) { refused = { ok: false, complete: false, phase, code: codes.has(error?.code) ? error.code : 'operation_failed' }; }
      }
      return refused || result;
    };
    retained = target.__hmNativeQaCheckpointRead = Object.freeze({ matches: value => value === scope,
      read() {
        if (flight) return flight;
        const next = Promise.resolve().then(readOnce); flight = next;
        void next.then(() => { if (flight === next) flight = null; }, () => { if (flight === next) flight = null; });
        return next;
      } });
    return retained.read();
  } catch (error) {
    return { ok: false, complete: false, phase, code: codes.has(error?.code) ? error.code : 'qa_checkpoint_scope' };
  }
}
