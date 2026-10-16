/** Manual QA only. Serialized into the already recovered owner browser page.
 * No access credential, game token, profile body or recovery leaves this page. */
export async function installNativeCompanionOwnerQaSession(config, suppliedModules) {
  const target = globalThis;
  const failure = code => Object.assign(new Error('Manual companion owner QA refused.'), { code });
  const check = (value, code) => { if (!value) throw failure(code); };
  const { enabled, run, owner, gameOrigin, relayOrigin, agentDid, agentPodUrl } = config || {};
  check(enabled === true && typeof run === 'string' && /^[A-Za-z0-9-]{1,64}$/.test(run), 'qa_companion_opt_in');
  const origin = value => { let url; try { url = new URL(value); } catch { throw failure('qa_companion_origin'); }
    check(url.protocol === 'https:' && url.origin === value, 'qa_companion_origin'); return value; };
  origin(gameOrigin); origin(relayOrigin);
  const requestTimeoutMs = config.requestTimeoutMs ?? 45000;
  check(Number.isInteger(requestTimeoutMs) && requestTimeoutMs >= 10 && requestTimeoutMs <= 60000, 'qa_companion_scope');
  check(gameOrigin === location.origin && gameOrigin !== relayOrigin && owner?.accountId && owner?.subjectDid && owner?.podUrl
    && /^did:web:[^\s]+:agents:[^\s]+$/.test(agentDid || '') && /^https:\/\/[^\s]+\/$/.test(agentPodUrl || ''), 'qa_companion_scope');
  const scopeKey = JSON.stringify([run, owner.accountId, owner.subjectDid, owner.podUrl, gameOrigin, relayOrigin, agentDid, agentPodUrl]);
  if (target.__hmNativeCompanionQa) {
    check(target.__hmNativeCompanionQa.matches(scopeKey), 'qa_companion_scope'); return target.__hmNativeCompanionQa.status();
  }
  const modules = suppliedModules || await Promise.all([
    import('/gaming/identity/assets/access-cache.mjs'), import('/gaming/identity/assets/owner-agent-grant.mjs'),
  ]);
  const [{ createBrowserAccessCache }, { createOwnerAgentGrants }] = modules;
  const cache = createBrowserAccessCache(), nativeUuid = target.crypto.randomUUID();
  const reference = { grantId: 'urn:uuid:' + nativeUuid, graphIri: 'urn:graph:interego:gaming:owner-agent-grant:' + nativeUuid };
  let client = null, nativeConnected = false, binding = null, manifest = null, description = null, actions = null, body = null, ws = null, welcome = null;
  let publicAttempted = false, publication = null, publicSaved = false, registered = false, localRevoked = false, podRevoked = false;
  let closed = false, busy = false, lastError = null, step = 'installed', serial = 0, snapshot = null, spawnCommand = null;
  let requestFlight = null, requestController = null;
  const pending = new Map();
  const status = () => ({ kind: 'native_companion_owner_qa', step, busy, closed, code: lastError,
    connected: !!ws && ws.readyState === 1, requestPending: !!requestFlight, bodyPresent: !!body, publicationAttempted: publicAttempted,
    publicationPending: !!publication?.operationId && !publicSaved, publicSaved, registered, localRevoked, podRevoked });
  const appToken = () => { const token = localStorage.getItem('hallowmarch.token.' + location.host); check(!!token, 'qa_companion_owner_session'); return token; };
  function sameOriginUrl(value) {
    let url; try { url = new URL(value); } catch { throw failure('qa_companion_description'); }
    check(url.origin === gameOrigin && url.protocol === 'https:' && url.href === value && !url.search && !url.hash
      && !url.username && !url.password, 'qa_companion_description'); return value;
  }
  async function request(url, payload) {
    check(!closed, 'qa_companion_closed');
    check(!requestFlight, 'qa_companion_game_request_pending');
    const targetUrl = url.startsWith('/') ? gameOrigin + url : sameOriginUrl(url);
    const controller = new AbortController(); requestController = controller; let timer;
    const task = (async () => {
      const response = await fetch(targetUrl, { method: payload ? 'POST' : 'GET', cache: 'no-store', credentials: 'same-origin', redirect: 'error', signal: controller.signal,
        headers: { Authorization: 'Bearer ' + appToken(), ...(payload ? { 'Content-Type': 'application/json' } : {}) },
        ...(payload ? { body: JSON.stringify(payload) } : {}) });
      check(!closed, 'qa_companion_closed'); check(response.ok, 'qa_companion_game_refused'); const result = await response.json();
      check(!closed, 'qa_companion_closed'); return result;
    })();
    requestFlight = task;
    const release = () => { if (requestFlight === task) { requestFlight = null; requestController = null; } };
    task.then(release, release);
    try { return await Promise.race([task, new Promise((_, reject) => { timer = setTimeout(() => {
      controller.abort(); reject(failure('qa_companion_game_timeout'));
    }, requestTimeoutMs); })]); }
    finally { clearTimeout(timer); controller.abort(); }
  }
  async function initialize() {
    check(!closed, 'qa_companion_closed');
    if (client) { if (!nativeConnected) { step = 'owner-native-connect'; await client.connect(); nativeConnected = true; } return; }
    step = 'owner-binding'; const state = await request('/gaming/identity/status');
    check(state.enabled && state.bound && state.verified && state.account?.id === owner.accountId
      && state.binding?.subjectDid === owner.subjectDid && state.binding?.podUrl === owner.podUrl, 'qa_companion_owner_binding');
    binding = state.binding;
    step = 'native-agent-discovery'; manifest = await request('/gaming/manifest');
    const advertised = manifest.nativeAgents;
    check(manifest.enabled && advertised?.enabled && advertised.audience === gameOrigin && /^did:/.test(advertised.applicationId || '')
      && Number.isInteger(advertised.leaseMs) && advertised.leaseMs >= 1000 && advertised.leaseMs <= 30000, 'qa_companion_description');
    description = await request(sameOriginUrl(advertised.affordances));
    check(description['@id'] === advertised.affordances && description.enabled === true && description.applicationId === advertised.applicationId
      && description.audience === gameOrigin && Array.isArray(description.operations) && description.operations.length <= 32, 'qa_companion_description');
    actions = {};
    for (const name of ['register', 'revoke']) {
      const rows = description.operations.filter(op => op?.['iep:action']?.['@id'] === 'urn:interego:gaming:native-agent:' + name);
      check(rows.length === 1 && rows[0]['hydra:method'] === 'POST', 'qa_companion_description');
      actions[name] = sameOriginUrl(rows[0]['hydra:target']);
    }
    step = 'owner-access-cache'; const held = await cache.get({ relayUrl: relayOrigin, ownerDid: binding.subjectDid, podUrl: binding.podUrl });
    check(held && held.credential?.kind === 'relay-oauth-bearer' && !held.credential.refreshToken && held.expiresAt > Date.now(), 'qa_companion_owner_access');
    // Keep one stable public grant UUID even if publication throws. Subsequent
    // native descriptor UUIDs use the original crypto implementation.
    let firstUuid = true;
    const crypto = { randomUUID: () => { if (firstUuid) { firstUuid = false; return nativeUuid; } return target.crypto.randomUUID(); },
      subtle: target.crypto.subtle, getRandomValues: target.crypto.getRandomValues.bind(target.crypto) };
    client = createOwnerAgentGrants({ binding, applicationId: advertised.applicationId, audience: gameOrigin,
      relayUrl: relayOrigin, credential: held.credential, crypto });
    check(!closed, 'qa_companion_closed'); step = 'owner-native-connect'; await client.connect(); nativeConnected = true;
  }
  async function guarded(name, run) {
    check(!closed && !busy, closed ? 'qa_companion_closed' : 'qa_companion_busy'); busy = true; step = name;
    try { const result = await run(); lastError = null; return result; }
    catch (error) { lastError = /^qa_companion_[a-z_]+$/.test(error?.code || '') ? error.code : 'qa_companion_owner_operation_failed'; throw failure(lastError); }
    finally { busy = false; }
  }
  async function socketConnect() {
    if (ws?.readyState === 1 && welcome) return;
    check(pending.size === 0, 'qa_companion_socket_uncertain');
    const socket = new WebSocket(gameOrigin.replace(/^https:/, 'wss:') + '/ws'); ws = socket; welcome = null;
    socket.addEventListener('message', event => {
      let value; try { value = JSON.parse(event.data); } catch { return; }
      if (value.t === 'gaming' && value.op === 'snapshot') snapshot = value.state;
      if (value.t === 'welcome') { welcome = value; pending.get('welcome')?.resolve(value); pending.delete('welcome'); }
      else if (value.t === 'gaming' && value.op === 'result') {
        const waiter = pending.get(value.requestId); if (!waiter) return;
        pending.delete(value.requestId); value.ok ? waiter.resolve(value.result) : waiter.reject(failure('qa_companion_domain_refused'));
      }
    });
    const stopped = () => { for (const waiter of pending.values()) waiter.reject(failure('qa_companion_socket_closed')); pending.clear(); };
    socket.addEventListener('close', stopped); socket.addEventListener('error', stopped);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(failure('qa_companion_socket_timeout')), 35000);
      socket.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once: true });
      socket.addEventListener('error', () => { clearTimeout(timer); reject(failure('qa_companion_socket_closed')); }, { once: true });
    });
    const response = wait('welcome');
    socket.send(JSON.stringify({ t: 'hello', v: 1, token: appToken(), room: 'native-companion-qa-' + run.slice(-24) }));
    const joined = await response;
    check(joined.acct?.id === owner.accountId && joined.acct?.nativeBound === true, 'qa_companion_owner_binding');
    socket.send(JSON.stringify({ t: 'slow', d: { r: 0, on: 1, n: 'QA Companion ' + run.slice(-8), dn: 'QA Companion ' + run.slice(-8),
      c: 'warrior', l: 1, rr: 0, pt: '' } }));
  }
  function wait(id) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(id); reject(failure('qa_companion_socket_timeout')); }, 35000);
      pending.set(id, { resolve: value => { clearTimeout(timer); resolve(value); }, reject: error => { clearTimeout(timer); reject(error); } });
    });
  }
  async function gaming(op, extra = {}) {
    check(ws?.readyState === 1, 'qa_companion_socket_closed'); const requestId = 'qa-companion-' + (++serial);
    const response = wait(requestId); ws.send(JSON.stringify({ t: 'gaming', op, requestId, ...extra })); return response;
  }
  const expectGrant = loaded => {
    const grant = loaded?.grant;
    check(loaded?.reference?.grantId === reference.grantId && loaded.reference.graphIri === reference.graphIri
      && grant?.issuer === owner.subjectDid && grant.actor === agentDid && grant.applicationId === manifest.nativeAgents.applicationId
      && grant.audience === gameOrigin && grant.roomId === body.roomId && grant.entityId === body.entityId && grant.role === 'pet'
      && JSON.stringify(grant.actions) === JSON.stringify(['observe', 'move']) && grant.maxCommandsPerSecond === 5
      && loaded.receipt?.ownerDid === owner.subjectDid && loaded.receipt?.visibility === 'public'
      && loaded.receipt.authorship?.verified === true, 'qa_companion_public_readback');
    return loaded;
  };
  const api = Object.freeze({ status, matches: value => value === scopeKey,
    enterAndSpawn: () => guarded('actual-game-body', async () => {
      await initialize(); check(!closed, 'qa_companion_closed'); if (body && ws?.readyState === 1) return { ...body };
      await socketConnect(); const entered = await gaming('enter');
      check(entered.roomId === manifest.roomId && typeof entered.result?.entityId === 'string', 'qa_companion_room');
      await gaming('observe');
      check(snapshot?.roomId === entered.roomId && Object.values(snapshot.entities || {}).filter(entity => entity.kind === 'player')
        .every(entity => entity.id === owner.accountId), 'qa_companion_room_not_isolated');
      if (!spawnCommand) spawnCommand = { type: 'spawnCompanion', name: 'QA Native Companion ' + run.slice(-8),
        entityId: entered.result.entityId, roomId: entered.roomId, commandId: 'qa-native-companion-spawn:' + run };
      const spawned = await gaming('command', { command: spawnCommand }); await gaming('observe');
      const entity = snapshot?.entities?.[spawned.result?.entityId];
      check(entity?.kind === 'companion' && entity.ownerPlayerId === owner.accountId && Number.isFinite(entity.x) && Number.isFinite(entity.z), 'qa_companion_body');
      body = { accountId: owner.accountId, roomId: entered.roomId, entityId: entity.id, x: entity.x, z: entity.z };
      return { ...body };
    }),
    publish: () => guarded('public-scoped-grant', async () => {
      await initialize(); check(!closed, 'qa_companion_closed'); check(body, 'qa_companion_body');
      if (publicSaved) return { reference: { ...reference }, saved: true };
      if (publication?.operationId) publication = await client.confirm(publication.operationId);
      else if (publicAttempted) {
        const found = await client.load(reference); check(found, 'qa_companion_publication_uncertain');
        expectGrant(found); check(found.grant.revoked === false, 'qa_companion_public_readback'); publicSaved = true;
      } else {
        publicAttempted = true;
        publication = await client.publish({ publicDisclosureAccepted: true, actor: agentDid, roomId: body.roomId, entityId: body.entityId,
          role: 'pet', actions: ['observe', 'move'], maxCommandsPerSecond: 5, lifetimeMs: 900000 });
        check(publication?.reference?.grantId === reference.grantId && publication.reference.graphIri === reference.graphIri, 'qa_companion_public_readback');
      }
      publicSaved ||= publication?.saved === true;
      check(publicSaved, 'qa_companion_publication_pending');
      return { reference: { ...reference }, saved: true };
    }),
    readback: () => guarded('owner-public-readback', async () => {
      await initialize(); check(publicAttempted && body, 'qa_companion_public_readback');
      const loaded = expectGrant(await client.load(reference));
      check(loaded.grant.revoked === podRevoked, 'qa_companion_public_readback');
      return loaded;
    }),
    register: () => guarded('game-reference-register', async () => {
      check(publicSaved && body, 'qa_companion_public_readback');
      const result = await request(actions.register, reference), ack = result.result;
      check(result.ok && ack?.reference?.grantId === reference.grantId && ack.reference.graphIri === reference.graphIri
        && ack.reference.ownerPlayerId === owner.accountId && ack.reference.ownerDid === owner.subjectDid && ack.authority?.durable === true,
      'qa_companion_game_receipt'); registered = true; return { reference: { ...reference }, authority: ack.authority };
    }),
    localRevoke: () => guarded('game-local-revoke', async () => {
      check(registered, 'qa_companion_game_receipt');
      const result = await request(actions.revoke, { grantId: reference.grantId });
      check(result.ok && result.result?.grantId === reference.grantId && result.result.revoked === true
        && result.result.authority?.durable === true, 'qa_companion_game_receipt'); localRevoked = true;
      return { revoked: true, authority: result.result.authority };
    }),
    ownerPodRevoke: () => guarded('owner-pod-revoke', async () => {
      check(localRevoked, 'qa_companion_local_revoke_required');
      if (!podRevoked) {
        if (publication?.operationId && publication.revoking === true) {
          const next = await client.confirm(publication.operationId); publication = { ...next, revoking: true };
        } else { publication = { ...(await client.revoke(reference)), revoking: true }; }
        check(publication.saved === true, 'qa_companion_publication_pending'); podRevoked = true;
      }
      const loaded = expectGrant(await client.load(reference)); check(loaded.grant.revoked === true, 'qa_companion_public_readback');
      return { revoked: true, reference: { ...reference }, receipt: loaded.receipt };
    }),
    async close() { closed = true; requestController?.abort(); ws?.close(); for (const waiter of pending.values()) waiter.reject(failure('qa_companion_closed'));
      pending.clear(); client?.close(); await cache.close(); },
  });
  target.__hmNativeCompanionQa = api; return status();
}
