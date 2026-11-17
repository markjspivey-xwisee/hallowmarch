/** A general guest's sealed character in the guest's own pod: the server's side (general-guest-pod.js) with the
 * browser's sealing (client/native-pod/guest-checkpoint.mjs) and a stand-in for the storage gate that holds a
 * write to the gate's own rules (Interego's deploy/css-gate/provisional-play.mjs). Offline; made-up origins,
 * tokens and characters only. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, webcrypto } from 'node:crypto';
globalThis.self = globalThis;
const { createGuestCheckpoint, GUEST_SAVE_MAX_ENVELOPE } = await import('../../client/native-pod/guest-checkpoint.mjs');
const { configuredGuestPod, createGuestPodStore, guestCheckpointUrl, guestPodInterval, sealedGuestEnvelope, GUEST_POD_LIMITS, GUEST_POD_COMMIT_TYPE }
  = await import('./general-guest-pod.js');

const POD = 'https://pods.example', USER = 'u-try-guest-' + 'c'.repeat(32), OWNER = 'did:web:identity.example:users:' + USER;
const TOKEN = 'cg2_fixture_application_token', T0 = 1_800_000_000_000, ACCOUNT = 'gg-' + 'a'.repeat(40);
const hex = value => createHash('sha256').update(value).digest('hex');
const memory = () => { const map = new Map(); return { load: async key => map.get(key) ?? null, create: async (key, value) => { if (!map.has(key)) map.set(key, value); return map.get(key); },
  remove: async key => { map.delete(key); } }; };
const browserVault = (account = ACCOUNT, storage = memory()) => createGuestCheckpoint({ account, storage, crypto: webcrypto, now: () => T0 });
const SAVE = { v: 1, savedAt: T0, char: { name: 'Synthetic Guest', realm: 1, cls: 'archer', level: 7 }, settings: { quality: 'low' }, world: { keeps: [0, 0, 1, 1, 2, 2] } };

/** The gate, as far as a general guest's write goes: the same target, headers, command and envelope checks, and its lifetime budget. */
function gate(clock, { namespace = 'hallowmarch' } = {}) {
  const documents = new Map(), calls = [], budget = { writes: 0, bytes: 0 }, state = { down: false, status: null, etagless: false };
  const target = `${POD}/${USER}/${namespace}/checkpoints/${hex(`urn:graph:${namespace}:player-profile:${hex(OWNER)}`)}.json`;
  const fetch = async (url, init) => {
    calls.push({ url, method: init.method, headers: { ...init.headers }, body: init.body });
    assert.equal(init.redirect, 'error'); assert.equal(init.credentials, 'omit');
    if (state.down) throw new Error('unreachable');
    const answer = (status, body = '', headers = {}) => new Response(body, { status, headers });
    if (init.method === 'GET') {
      assert.equal(init.headers.Authorization, undefined, 'a read carries no bearer');
      const found = documents.get(url);
      return found ? answer(200, found.text, { ETag: `"${found.revision}"`, 'Content-Type': 'application/json' }) : answer(404);
    }
    assert.equal(init.method, 'PUT');
    if (init.headers.Authorization !== 'Bearer ' + TOKEN) return answer(401);
    if (url !== target) return answer(403, JSON.stringify({ error: 'provisional_play_scope' }));
    if (init.headers['Content-Type'] !== GUEST_POD_COMMIT_TYPE) return answer(415);
    const initial = init.headers['If-None-Match'] === '*' && !init.headers['If-Match'];
    const expected = !init.headers['If-None-Match'] && /^"(sha256:[a-f0-9]{64})"$/.exec(init.headers['If-Match'] ?? '')?.[1];
    if (!initial && !expected) return answer(428);
    const command = JSON.parse(init.body);
    assert.deepEqual(Object.keys(command).sort(), ['bodyBase64', 'contentType', 'expectedRevision', 'version']);
    if (command.version !== 1 || command.expectedRevision !== (initial ? null : expected) || command.contentType !== 'application/json') return answer(400);
    const decoded = Buffer.from(command.bodyBase64, 'base64');
    if (decoded.length > 4 * 1024 * 1024) return answer(413);
    const envelope = JSON.parse(decoded.toString('utf8'));
    if (envelope.version !== 1 || envelope.algorithm !== 'X25519-XSalsa20-Poly1305' || envelope.content?.algorithm !== 'XSalsa20-Poly1305'
      || !Array.isArray(envelope.wrappedKeys) || envelope.wrappedKeys.length !== 1) return answer(400, JSON.stringify({ error: 'provisional_play_encrypted_required' }));
    // The budget is reserved before the write is forwarded: a conflict still spends an attempt.
    if (budget.writes + 1 > 1024 || budget.bytes + decoded.length > 32 * 1024 * 1024) return answer(507);
    budget.writes++; budget.bytes += decoded.length;
    if (state.status) return answer(state.status);
    const stored = documents.get(url);
    if (initial ? stored : stored?.revision !== expected) return answer(412);
    const revision = 'sha256:' + hex(decoded.toString('utf8') + clock.t + budget.writes);
    documents.set(url, { text: decoded.toString('utf8'), revision });
    return answer(200, JSON.stringify({ version: 1, status: 'committed', revision }), state.etagless ? {} : { ETag: `"${revision}"` });
  };
  return { fetch, documents, calls, budget, state, target };
}
function fixture(options = {}) {
  const clock = { t: T0 }, pod = gate(clock, options), kept = new Map();
  const store = createGuestPodStore({ fetch: pod.fetch, now: () => clock.t, podOrigin: POD, usage: id => kept.get(id), keep: (id, used) => kept.set(id, used) });
  const admit = (over = {}) => store.admit(ACCOUNT, { token: TOKEN, tokenExpiresAt: new Date(T0 + 3_600_000).toISOString(), podUrl: `${POD}/${USER}/`, userId: USER, ownerDid: OWNER,
    namespace: options.namespace ?? 'hallowmarch', sessionExpiresAt: T0 + 4 * 3_600_000, ...over });
  return { clock, pod, kept, store, admit };
}

test('the document is the one the gate derives, and a pod anywhere else is no pod', () => {
  const f = fixture();
  assert.equal(guestCheckpointUrl({ podUrl: `${POD}/${USER}/`, userId: USER, ownerDid: OWNER, podOrigin: POD }), f.pod.target);
  assert.match(f.pod.target, /^https:\/\/pods\.example\/u-try-guest-c{32}\/hallowmarch\/checkpoints\/[0-9a-f]{64}\.json$/);
  assert.equal(guestCheckpointUrl({ podUrl: `${POD}/${USER}/`, userId: USER, ownerDid: OWNER, namespace: 'game', podOrigin: POD }),
    `${POD}/${USER}/game/checkpoints/${hex(`urn:graph:game:player-profile:${hex(OWNER)}`)}.json`);
  for (const bad of [{ podUrl: `https://elsewhere.example/${USER}/` }, { podUrl: `${POD}/someone-else/` }, { podUrl: `${POD}/${USER}/deeper/` }, { podUrl: `${POD}/${USER}/?x=1` },
    { podUrl: `http://pods.example/${USER}/` }, { podUrl: `https://user:pass@pods.example/${USER}/` }, { namespace: '../up' }, { namespace: 'Game' }, { userId: 'u-pk-0123456789ab' },
    { ownerDid: 'did:web:identity.example:users:another' }]) {
    assert.equal(guestCheckpointUrl({ podUrl: `${POD}/${USER}/`, userId: USER, ownerDid: OWNER, podOrigin: POD, ...bad }), null, JSON.stringify(bad));
  }
  assert.equal(f.admit({ podUrl: `https://elsewhere.example/${USER}/` }), false); assert.equal(f.store.has(ACCOUNT), false);
  assert.equal(f.admit({ tokenExpiresAt: new Date(T0 - 1).toISOString() }), false);
  assert.equal(f.admit({ token: 'has a space in it....' }), false);
  assert.throws(() => createGuestPodStore({ podOrigin: 'http://pods.example', usage() {}, keep() {} }), /HTTPS origin/);
});

test('only an envelope of the gate\'s shape is forwarded: nothing readable can ride with it', async () => {
  const vault = browserVault(), { envelope, bytes } = await vault.seal(SAVE);
  const forwarded = sealedGuestEnvelope(envelope);
  assert.ok(forwarded); assert.equal(forwarded.length, bytes);
  assert.ok(!forwarded.toString('utf8').includes('Synthetic Guest'), 'the character is not readable in what is forwarded');
  for (const bad of [null, 'text', [], { ...envelope, char: SAVE.char }, { ...envelope, content: { ...envelope.content, plaintext: 'Synthetic Guest' } },
    { ...envelope, wrappedKeys: [...envelope.wrappedKeys, envelope.wrappedKeys[0]] }, { ...envelope, wrappedKeys: [] },
    { ...envelope, wrappedKeys: [{ ...envelope.wrappedKeys[0], senderPublicKey: 'A'.repeat(43) + '=' }] }, { ...envelope, wrappedKeys: [{ ...envelope.wrappedKeys[0], note: 'x' }] },
    { ...envelope, algorithm: 'none' }, { ...envelope, version: 2 }, { ...envelope, content: { ...envelope.content, ciphertext: '{"name":"Synthetic Guest"}' } },
    { ...envelope, content: { ...envelope.content, encryptedAt: 'Synthetic Guest' } }, { ...envelope, content: { ...envelope.content, ciphertext: 'A'.repeat(GUEST_POD_LIMITS.envelopeBytes + 4) } }]) {
    assert.equal(sealedGuestEnvelope(bad), null);
  }
});

test('a save is sealed in the browser, forwarded as a conditional native commit, and opened again only by that browser', async () => {
  const f = fixture(), storage = memory(), vault = browserVault(ACCOUNT, storage);
  assert.equal(f.admit(), true);
  assert.equal(await vault.hasKey(), false);
  const first = await vault.seal(SAVE);
  assert.deepEqual(await f.store.put(ACCOUNT, first.envelope), { ok: true, bytes: first.bytes });
  assert.equal(await vault.hasKey(), true);
  assert.deepEqual(f.pod.calls.map(call => call.method), ['GET', 'PUT'], 'the revision is read once, without a bearer');
  assert.equal(f.pod.calls[1].url, f.pod.target); assert.equal(f.pod.calls[1].headers['If-None-Match'], '*');
  assert.ok(!JSON.stringify(f.pod.calls).includes('Synthetic Guest'), 'the pod is sent ciphertext only');
  assert.deepEqual(f.kept.get(ACCOUNT), { writes: 1, bytes: first.bytes, lastAt: T0, full: false });
  // The next write is conditional on the revision the pod answered, with no read between.
  f.clock.t += GUEST_POD_LIMITS.floorMs;
  const second = await vault.seal({ ...SAVE, char: { ...SAVE.char, level: 8 } });
  assert.equal((await f.store.put(ACCOUNT, second.envelope)).ok, true);
  assert.equal(f.pod.calls.length, 3); assert.match(f.pod.calls[2].headers['If-Match'], /^"sha256:[0-9a-f]{64}"$/);
  assert.equal(JSON.parse(f.pod.calls[2].body).expectedRevision, f.pod.calls[2].headers['If-Match'].slice(1, -1));
  // Read back and opened by the browser that sealed it; another browser's key opens nothing.
  const read = await f.store.get(ACCOUNT);
  assert.equal(read.ok, true);
  assert.equal((await vault.open(read.env)).save.char.level, 8);
  assert.equal((await browserVault(ACCOUNT, storage).open(read.env)).save.char.name, 'Synthetic Guest', 'the same browser storage, a later page');
  assert.equal(await browserVault().open(read.env), null, 'another browser');
  assert.equal(await browserVault('gg-' + 'b'.repeat(40), storage).open(read.env), null, 'another guest account in the same browser');
  assert.deepEqual({ ...f.store.status(), reasons: 0 }, { guests: 1, admitted: 1, written: 2, refused: 0, failed: 0, read: 1, readFailed: 0, bytes: first.bytes + second.bytes, reasons: 0 });
  // A deleted character is sealed too, and a large one is compressed before it is sealed.
  assert.equal((await vault.open((await vault.seal(null)).envelope)).save, null);
  const large = { ...SAVE, world: { land: 'felled tree '.repeat(40_000) } };
  assert.ok((await vault.seal(large)).bytes < JSON.stringify(large).length / 10, 'gzip before sealing');
  assert.ok(GUEST_SAVE_MAX_ENVELOPE <= GUEST_POD_LIMITS.envelopeBytes);
});

test('writes are spaced and counted before they leave, and this game\'s part of the lifetime budget is a hard stop that a restart keeps', async () => {
  const f = fixture(), vault = browserVault(), sealed = await vault.seal(SAVE);
  f.admit();
  assert.equal((await f.store.put(ACCOUNT, sealed.envelope)).ok, true);
  assert.deepEqual(await f.store.put(ACCOUNT, sealed.envelope), { ok: false, code: 'too_soon' });
  f.clock.t += GUEST_POD_LIMITS.floorMs - 1;
  assert.equal((await f.store.put(ACCOUNT, sealed.envelope)).code, 'too_soon');
  assert.equal(f.pod.budget.writes, 1, 'a refusal here spends nothing at the pod');
  assert.equal(f.store.budget(ACCOUNT).writesLeft, GUEST_POD_LIMITS.writes - 1);
  // A failure at the pod is still an attempt spent, here and there.
  f.clock.t += 1; f.pod.state.status = 412;
  assert.deepEqual(await f.store.put(ACCOUNT, sealed.envelope), { ok: false, code: 'pod_conflict' });
  assert.equal(f.kept.get(ACCOUNT).writes, 2); assert.equal(f.pod.budget.writes, 2);
  f.pod.state.status = null; f.clock.t += GUEST_POD_LIMITS.floorMs;
  assert.equal((await f.store.put(ACCOUNT, sealed.envelope)).ok, true, 'the revision is read again after a conflict');
  // The whole part, at the floor's pace, by a page that ignores its own spacing.
  let written = 2;
  for (;;) {
    f.clock.t += GUEST_POD_LIMITS.floorMs;
    if (f.clock.t >= T0 + 3_500_000) f.admit({ tokenExpiresAt: new Date(f.clock.t + 3_600_000).toISOString(), sessionExpiresAt: f.clock.t + 3_600_000 });
    const result = await f.store.put(ACCOUNT, sealed.envelope);
    if (!result.ok) { assert.equal(result.code, 'budget'); break; }
    written++;
  }
  assert.equal(f.kept.get(ACCOUNT).writes, GUEST_POD_LIMITS.writes); assert.equal(written, GUEST_POD_LIMITS.writes - 1);
  assert.equal(f.pod.budget.writes, GUEST_POD_LIMITS.writes, 'never more attempts at the pod than this game\'s part');
  assert.ok(GUEST_POD_LIMITS.writes <= 1024 / 4 && GUEST_POD_LIMITS.bytes <= 32 * 1024 * 1024 / 2, 'well under the guest\'s lifetime budget, which other applications share');
  // A new process with the same kept usage: still stopped.
  const restarted = createGuestPodStore({ fetch: f.pod.fetch, now: () => f.clock.t + 86_400_000, podOrigin: POD, usage: id => f.kept.get(id), keep: (id, used) => f.kept.set(id, used) });
  restarted.admit(ACCOUNT, { token: TOKEN, tokenExpiresAt: new Date(f.clock.t + 2 * 86_400_000).toISOString(), podUrl: `${POD}/${USER}/`, userId: USER, ownerDid: OWNER, sessionExpiresAt: f.clock.t + 2 * 86_400_000 });
  assert.equal((await restarted.put(ACCOUNT, sealed.envelope)).code, 'budget');
  // Bytes are a part of their own, and the spacing grows with the envelope so the part lasts.
  const g = fixture(); g.admit(); g.kept.set(ACCOUNT, { writes: 3, bytes: GUEST_POD_LIMITS.bytes - 100, lastAt: 0, full: false });
  assert.equal((await g.store.put(ACCOUNT, sealed.envelope)).code, 'budget'); assert.equal(g.pod.calls.length, 0);
  assert.equal(guestPodInterval(10_000), GUEST_POD_LIMITS.intervalMs);
  assert.equal(guestPodInterval(GUEST_POD_LIMITS.bytes / 32), 3_600_000);
  assert.ok(GUEST_POD_LIMITS.spreadMs / GUEST_POD_LIMITS.intervalMs <= GUEST_POD_LIMITS.writes, 'the spread of play fits within the write part');
});

test('the pod full, the token refused or gone, the pod down: each is counted by reason and nothing else is tried', async () => {
  const f = fixture(), vault = browserVault(), sealed = await vault.seal(SAVE);
  assert.deepEqual(await f.store.put(ACCOUNT, sealed.envelope), { ok: false, code: 'reauth' });
  assert.deepEqual(await f.store.get(ACCOUNT), { ok: false, code: 'reauth' });
  f.admit();
  assert.deepEqual(await f.store.put(ACCOUNT, { ...sealed.envelope, extra: SAVE }), { ok: false, code: 'not_sealed' });
  assert.equal(f.pod.calls.length, 0);
  f.pod.state.down = true;
  assert.equal((await f.store.put(ACCOUNT, sealed.envelope)).code, 'pod_unreadable'); assert.equal(f.kept.get(ACCOUNT), undefined, 'nothing left, nothing spent');
  assert.deepEqual(await f.store.get(ACCOUNT), { ok: false, code: 'pod_unreadable' });
  f.pod.state.down = false; f.pod.state.status = 507;
  assert.equal((await f.store.put(ACCOUNT, sealed.envelope)).code, 'pod_full');
  f.pod.state.status = null; f.clock.t += GUEST_POD_LIMITS.floorMs;
  assert.equal((await f.store.put(ACCOUNT, sealed.envelope)).code, 'budget', 'a full pod is not asked again');
  assert.equal(f.store.budget(ACCOUNT).writesLeft, 0);
  const g = fixture(); g.admit(); g.pod.state.status = 401;
  assert.equal((await g.store.put(ACCOUNT, sealed.envelope)).code, 'reauth'); assert.equal(g.store.has(ACCOUNT), false, 'a refused token is dropped');
  // The token goes with the session's bound, whichever comes first.
  const h = fixture(); h.admit({ sessionExpiresAt: T0 + 1000 }); h.clock.t += 1001;
  assert.equal(h.store.has(ACCOUNT), false); assert.equal((await h.store.put(ACCOUNT, sealed.envelope)).code, 'reauth');
  const s = f.store.status();
  assert.deepEqual(s.reasons, { reauth: 2, not_sealed: 1, pod_unreadable: 1, pod_full: 1, budget: 1 });
  assert.ok(!JSON.stringify(s).includes(TOKEN) && !JSON.stringify(s).includes(USER), 'counts only');
  // What another application, or anything else, left in the document is never handed on as an envelope.
  const o = fixture(); o.admit(); o.pod.documents.set(o.pod.target, { text: JSON.stringify({ readable: 'Synthetic Guest' }), revision: 'sha256:' + 'e'.repeat(64) });
  assert.deepEqual(await o.store.get(ACCOUNT), { ok: true, env: null });
});

test('as a deployment configures it: off by default, and on only with the guest itself and the pods\' origin', () => {
  const ports = { usage() {}, keep() {} };
  assert.equal(configuredGuestPod({ env: {}, ...ports }), null);
  assert.equal(configuredGuestPod({ env: { HM_GENERAL_GUEST: '1', HM_GENERAL_GUEST_POD_SHADOW: 'true', HM_GENERAL_GUEST_POD_ORIGIN: POD }, ...ports }), null);
  assert.equal(configuredGuestPod({ env: { HM_GENERAL_GUEST: '1', HM_GENERAL_GUEST_POD_SHADOW: '1', HM_GENERAL_GUEST_POD_ORIGIN: POD }, ...ports }).mode, 'shadow');
  assert.equal(configuredGuestPod({ env: { HM_GENERAL_GUEST: '1', HM_GENERAL_GUEST_POD_SHADOW: '1', HM_GENERAL_GUEST_POD_AUTHORITATIVE: '1', HM_GENERAL_GUEST_POD_ORIGIN: POD }, ...ports }).mode, 'authoritative');
  assert.throws(() => configuredGuestPod({ env: { HM_GENERAL_GUEST_POD_SHADOW: '1', HM_GENERAL_GUEST_POD_ORIGIN: POD }, ...ports }), /HM_GENERAL_GUEST is not 1/);
  assert.throws(() => configuredGuestPod({ env: { HM_GENERAL_GUEST: '1', HM_GENERAL_GUEST_POD_AUTHORITATIVE: '1' }, ...ports }), /HM_GENERAL_GUEST_POD_ORIGIN is not set/);
  assert.throws(() => configuredGuestPod({ env: { HM_GENERAL_GUEST: '1', HM_GENERAL_GUEST_POD_SHADOW: '1', HM_GENERAL_GUEST_POD_ORIGIN: POD + '/pods' }, ...ports }), /HTTPS origin with no path/);
});
