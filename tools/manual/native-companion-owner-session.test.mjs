import assert from 'node:assert/strict';
import test from 'node:test';
import { installNativeCompanionOwnerQaSession } from './native-companion-owner-session.mjs';
import { nativeAgentAffordances } from '../../server/gaming/native-agent-http.js';

const gameOrigin = 'https://game.example', relayOrigin = 'https://relay.example';
const owner = { accountId: 'qa_account', subjectDid: 'did:web:identity.example:users:qa-owner', podUrl: 'https://pods.example/qa-owner/' };
const agentDid = 'did:web:identity.example:agents:existing-root', agentPodUrl = 'https://pods.example/root-owner/';
const binding = { ...owner, webId: 'https://identity.example/users/qa-owner/profile#me', userId: 'qa-owner' };
const applicationId = 'did:web:identity.example:users:game';
const config = { enabled: true, run: 'qa-fixture', owner, gameOrigin, relayOrigin, agentDid, agentPodUrl };
async function fixture(options, run) {
  const previous = Object.fromEntries(['location', 'localStorage', 'fetch', 'WebSocket'].map(name => [name, globalThis[name]]));
  const count = { clients: 0, connects: 0, publish: 0, confirms: 0, revokes: 0, spawn: 0, register: 0, localRevoke: 0, sockets: 0 };
  const posts = [], slow = [], socketMessages = [], current = { grant: null, reference: null };
  let connectFailure = options.connectFailure, pendingPublication = options.pendingPublication, pendingRevoke = options.pendingRevoke;
  let publishFailure = options.publishFailure, nativePending = 0;
  let socketOpen = false;
  const entities = { [owner.accountId]: { id: owner.accountId, kind: 'player', ownerPlayerId: owner.accountId, x: 0, z: 0 } };
  if (options.foreignPlayer) entities.other = { id: 'other', kind: 'player', ownerPlayerId: 'other' };
  const modules = [{ createBrowserAccessCache: () => ({
    get: async () => ({ credential: { kind: 'relay-oauth-bearer', accessToken: 'NATIVE_PRIVATE_BEARER', method: 'webauthn', expiresAt: Date.now() + 60000 }, expiresAt: Date.now() + 60000 }),
    close: async () => {},
  }) }, { createOwnerAgentGrants(input) {
    count.clients++; assert.equal(input.credential.accessToken, 'NATIVE_PRIVATE_BEARER');
    const receipt = () => ({ ownerDid: owner.subjectDid, ownerPodUrl: owner.podUrl, visibility: 'public', authorship: { verified: true } });
    return { async connect() { count.connects++; if (connectFailure) { connectFailure = false; throw new Error('PRIVATE_NATIVE_ERROR'); } },
      async publish(scope) {
        count.publish++; const uuid = input.crypto.randomUUID();
        current.reference = { grantId: 'urn:uuid:' + uuid, graphIri: 'urn:graph:interego:gaming:owner-agent-grant:' + uuid };
        current.grant = { ...scope, id: current.reference.grantId, issuer: owner.subjectDid, applicationId, audience: gameOrigin, revoked: false };
        if (publishFailure) { const code = publishFailure; publishFailure = null; throw Object.assign(new Error('PRIVATE_NATIVE_ERROR'), { code }); }
        if (pendingPublication) { pendingPublication = false; nativePending = 1; return { reference: current.reference, saved: false, operationId: 'retained-public-op' }; }
        return { reference: current.reference, saved: true, receipt: receipt() };
      },
      async confirm(operationId) { count.confirms++; assert(['retained-public-op', 'retained-revoke-op'].includes(operationId));
        nativePending = 0;
        return { saved: true, reference: current.reference, receipt: receipt() }; },
      async load(ref) { assert.deepEqual(ref, current.reference); return { reference: current.reference, grant: structuredClone(current.grant), receipt: receipt() }; },
      async revoke(ref) { count.revokes++; assert.deepEqual(ref, current.reference); current.grant.revoked = true;
        if (pendingRevoke) { pendingRevoke = false; return { saved: false, reference: ref, operationId: 'retained-revoke-op' }; }
        return { saved: true, reference: ref, receipt: receipt() }; },
      status: () => ({ pending: nativePending, pendingGrants: nativePending, ownerDid: 'DO_NOT_RETURN' }),
      close() {},
    };
  } }];
  class Socket {
    readyState = 0; listeners = new Map();
    constructor(url) { count.sockets++; assert.equal(url, 'wss://game.example/ws'); queueMicrotask(() => { this.readyState = 1; socketOpen = true; this.emit('open', {}); }); }
    addEventListener(name, callback) { if (!this.listeners.has(name)) this.listeners.set(name, []); this.listeners.get(name).push(callback); }
    emit(name, event) { for (const callback of this.listeners.get(name) || []) callback(event); }
    message(value) { queueMicrotask(() => this.emit('message', { data: JSON.stringify(value) })); }
    send(encoded) {
      const message = JSON.parse(encoded); socketMessages.push(message);
      if (message.t === 'hello') { assert.equal(message.token, 'GAME_PRIVATE_HMAC'); this.message({ t: 'welcome', acct: { id: owner.accountId, nativeBound: true } }); return; }
      if (message.t === 'slow') { slow.push(message.d); return; }
      assert.equal(message.t, 'gaming');
      let result = {};
      if (message.op === 'enter') result = { entityId: owner.accountId };
      else if (message.op === 'command') {
        assert.equal(message.command.type, 'spawnCompanion');
        if (!entities.companion) { count.spawn++; entities.companion = { id: 'companion', kind: 'companion', ownerPlayerId: owner.accountId, x: 1, z: 0 }; }
        result = { entityId: 'companion' };
      } else if (message.op === 'observe') this.message({ t: 'gaming', op: 'snapshot', state: { roomId: 'room-qa', entities: structuredClone(entities) } });
      this.message({ t: 'gaming', op: 'result', requestId: message.requestId, ok: true, result: { roomId: 'room-qa', version: 1, result } });
    }
    close() { this.readyState = 3; socketOpen = false; this.emit('close', {}); }
  }
  globalThis.location = { origin: gameOrigin, host: 'game.example' };
  globalThis.localStorage = { getItem: () => 'GAME_PRIVATE_HMAC' }; globalThis.WebSocket = Socket;
  globalThis.fetch = async (url, init) => {
    assert.equal(new URL(url).origin, gameOrigin); assert.equal(init.headers.Authorization, 'Bearer GAME_PRIVATE_HMAC');
    const path = new URL(url).pathname;
    if (path === '/gaming/identity/status') return Response.json({ enabled: true, verified: true, bound: true, account: { id: owner.accountId }, binding });
    if (path === '/gaming/manifest') return Response.json({ enabled: true, roomId: 'room-qa', nativeAgents: { enabled: true, audience: gameOrigin,
      applicationId, affordances: gameOrigin + '/gaming/native-agents', leaseMs: 10000 } });
    if (path === '/gaming/native-agents') return Response.json(nativeAgentAffordances({ publicOrigin: gameOrigin, applicationId, enabled: true }));
    const body = JSON.parse(init.body); posts.push({ path, body }); assert(!init.body.includes('NATIVE_PRIVATE_BEARER'));
    if (path.endsWith('/register')) { count.register++; assert.deepEqual(Object.keys(body).sort(), ['grantId', 'graphIri']);
      return Response.json({ ok: true, result: { reference: { ...body, ownerPlayerId: owner.accountId, ownerDid: owner.subjectDid }, authority: { durable: true, roomId: 'room-qa', version: 2 } } }); }
    if (path.endsWith('/revoke')) { count.localRevoke++; assert.deepEqual(Object.keys(body), ['grantId']);
      return Response.json({ ok: true, result: { grantId: body.grantId, revoked: true, authority: { durable: true, roomId: 'room-qa', version: 3 } } }); }
    throw new Error('Unexpected fixture target');
  };
  try { await run({ modules, count, posts, slow, socketMessages, socketOpen: () => socketOpen, current }); }
  finally {
    await globalThis.__hmNativeCompanionQa?.close(); delete globalThis.__hmNativeCompanionQa;
    for (const [name, value] of Object.entries(previous)) { if (value === undefined) delete globalThis[name]; else globalThis[name] = value; }
  }
}
test('owner helper keeps credentials in browser and sends only public references after actual owned body replies', async () => fixture({}, async f => {
  const installed = await installNativeCompanionOwnerQaSession(config, f.modules); assert.equal(installed.bodyPresent, false); assert.equal(f.count.clients, 0);
  const qa = globalThis.__hmNativeCompanionQa, body = await qa.enterAndSpawn();
  assert.deepEqual(body, { accountId: owner.accountId, roomId: 'room-qa', entityId: 'companion', x: 1, z: 0 });
  await qa.enterAndSpawn(); assert.equal(f.count.spawn, 1); assert(f.socketOpen());
  await qa.publish(); const found = await qa.readback(); assert.deepEqual(found.grant.actions, ['observe', 'move']);
  const registered = await qa.register(); assert(registered.authority.durable); assert.equal(f.posts.length, 1);
  await assert.rejects(qa.ownerPodRevoke(), { code: 'qa_companion_local_revoke_required' });
  await qa.localRevoke(); await qa.ownerPodRevoke(); assert((await qa.readback()).grant.revoked);
  const summary = JSON.stringify(qa.status()); assert(!summary.includes('PRIVATE')); assert(!summary.includes('credential'));
  assert.equal(f.slow.length, 1); assert.deepEqual(Object.keys(f.slow[0]).sort(), ['c', 'dn', 'l', 'n', 'on', 'pt', 'r', 'rr']);
  assert.equal(f.count.publish, 1); assert.equal(f.count.revokes, 1);
}));
test('uncertain public publication/revocation retry confirms the same retained operations without a second write', async () => fixture({ pendingPublication: true, pendingRevoke: true }, async f => {
  await installNativeCompanionOwnerQaSession(config, f.modules); const qa = globalThis.__hmNativeCompanionQa;
  await qa.enterAndSpawn(); await assert.rejects(qa.publish(), { code: 'qa_companion_publication_pending' });
  const reference = { ...f.current.reference }; assert(qa.status().publicationPending);
  assert.equal(qa.status().nativePendingCount, 1); assert.equal(qa.status().nativePendingGrants, 1);
  await qa.publish(); assert.deepEqual(f.current.reference, reference); assert.equal(f.count.publish, 1); assert.equal(f.count.confirms, 1);
  assert.equal(qa.status().nativePendingCount, 0);
  await qa.register(); await qa.localRevoke(); await assert.rejects(qa.ownerPodRevoke(), { code: 'qa_companion_publication_pending' });
  await qa.ownerPodRevoke(); assert.equal(f.count.revokes, 1); assert.equal(f.count.confirms, 2); assert(qa.status().podRevoked);
}));
for (const nativeCode of ['owner_mismatch', 'invalid_grant', 'PRIVATE_NATIVE_ERROR']) test('native publication error diagnostic is bounded: ' + nativeCode, async () => fixture({ publishFailure: nativeCode }, async f => {
  await installNativeCompanionOwnerQaSession(config, f.modules); const qa = globalThis.__hmNativeCompanionQa;
  await qa.enterAndSpawn(); await assert.rejects(qa.publish(), { code: 'qa_companion_owner_operation_failed' });
  const failed = qa.status(); assert.equal(failed.nativeCode, nativeCode === 'PRIVATE_NATIVE_ERROR' ? null : nativeCode);
  assert.equal(failed.publicationAttempted, true); assert.equal(failed.publicationPending, false);
  assert.equal(failed.nativePendingCount, 0); assert(!JSON.stringify(failed).includes('PRIVATE'));
  assert.equal(Object.hasOwn(failed, 'publicReference'), false);
  const originalReference = { ...f.current.reference };
  // Simulates a thrown post-commit parse acknowledgement. Retry only reads and
  // verifies that exact retained owner reference; it cannot publish a new UUID.
  await qa.publish(); assert.equal(f.count.publish, 1); assert.deepEqual(f.current.reference, originalReference);
  assert.equal(qa.status().nativeCode, null); assert.equal(qa.status().publicSaved, true);
}));
test('public reference diagnosis requires explicit opt-in and an accepted publication attempt', async () => fixture({}, async f => {
  await installNativeCompanionOwnerQaSession({ ...config, publicReferenceDiagnostics: true }, f.modules);
  const qa = globalThis.__hmNativeCompanionQa; assert.equal(Object.hasOwn(qa.status(), 'publicReference'), false);
  await qa.enterAndSpawn(); assert.equal(Object.hasOwn(qa.status(), 'publicReference'), false);
  await qa.publish(); assert.deepEqual(qa.status().publicReference, f.current.reference);
  assert(!JSON.stringify(qa.status()).includes('PRIVATE'));
}));
test('connect failures retain the same native client and replacement scope is refused', async () => fixture({ connectFailure: true }, async f => {
  await installNativeCompanionOwnerQaSession(config, f.modules); const qa = globalThis.__hmNativeCompanionQa;
  await assert.rejects(qa.enterAndSpawn(), { code: 'qa_companion_owner_operation_failed' });
  await qa.enterAndSpawn(); assert.equal(f.count.clients, 1); assert.equal(f.count.connects, 2);
  await assert.rejects(installNativeCompanionOwnerQaSession({ ...config, agentDid: 'did:web:identity.example:agents:other' }, f.modules), { code: 'qa_companion_scope' });
  assert.equal((await installNativeCompanionOwnerQaSession(config, f.modules)).bodyPresent, true);
}));
test('another player in the authoritative test room prevents spawn and publication', async () => fixture({ foreignPlayer: true }, async f => {
  await installNativeCompanionOwnerQaSession(config, f.modules);
  await assert.rejects(globalThis.__hmNativeCompanionQa.enterAndSpawn(), { code: 'qa_companion_room_not_isolated' });
  assert.equal(f.count.spawn, 0); assert.equal(f.count.publish, 0);
}));
test('explicit close refuses all subsequent game or pod mutation', async () => fixture({}, async f => {
  await installNativeCompanionOwnerQaSession(config, f.modules); const qa = globalThis.__hmNativeCompanionQa; await qa.close();
  const before = { ...f.count };
  for (const name of ['enterAndSpawn', 'publish', 'register', 'localRevoke', 'ownerPodRevoke']) await assert.rejects(qa[name](), { code: 'qa_companion_closed' });
  assert.deepEqual(f.count, before);
}));
test('a hung game fetch has a bounded diagnosis and retains its single backend permit until it settles', async () => fixture({}, async f => {
  globalThis.fetch = () => new Promise(() => {});
  await installNativeCompanionOwnerQaSession({ ...config, requestTimeoutMs: 20 }, f.modules); const qa = globalThis.__hmNativeCompanionQa;
  await assert.rejects(qa.enterAndSpawn(), { code: 'qa_companion_game_timeout' });
  assert.equal(qa.status().busy, false); assert.equal(qa.status().requestPending, true);
  await assert.rejects(qa.enterAndSpawn(), { code: 'qa_companion_game_request_pending' }); assert.equal(f.count.clients, 0);
}));
