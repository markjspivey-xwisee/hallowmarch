/** Real Chromium IndexedDB, nonextractable WebCrypto custody and two-tab races. */
import assert from 'node:assert/strict';
import http from 'node:http';
import { pathToFileURL } from 'node:url';
import { createPlayerBrowserAssets } from '../../server/gaming/player-browser-assets.js';

if (!process.env.HM_PLAYWRIGHT_MODULE) throw new Error('Set HM_PLAYWRIGHT_MODULE to the installed Playwright entry point.');
const { chromium } = await import(pathToFileURL(process.env.HM_PLAYWRIGHT_MODULE));
const assets = createPlayerBrowserAssets(), requests = [], fixtureErrors = [];
const server = http.createServer((req, res) => {
  requests.push({ method: req.method, url: req.url });
  try {
    const url = new URL(req.url, 'http://fixture');
    if (assets(req, res, url.pathname)) return;
    if (req.method === 'GET' && url.pathname === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' });
      res.end('<!doctype html><title>Retained key custody verification</title>'); return;
    }
    if (url.pathname === '/favicon.ico') { res.writeHead(204); res.end(); return; }
    throw new Error('Unexpected key custody fixture request.');
  } catch (error) { fixtureErrors.push(error.message); res.writeHead(500); res.end('Key custody fixture refused request.'); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = 'http://127.0.0.1:' + server.address().port;
const failures = []; let browser;
async function check(name, run) {
  const context = await browser.newContext(); context.setDefaultTimeout(5000);
  try { await run(context); console.log('PASS ' + name); }
  catch (error) { failures.push({ name, message: error.message }); console.error('FAIL ' + name + ': ' + error.message); }
  finally { await context.close(); }
}
async function pageFor(context) {
  const page = await context.newPage(); await page.goto(base);
  await page.evaluate(async () => {
    window.keyStorage = (await import('/gaming/identity/assets/client.mjs')).indexedDbKeyStorage();
    window.scopeApi = await import('/gaming/identity/assets/key-scope.mjs');
    window.ClientKeyVault = (await import('/gaming/identity/assets/vendor/interego-browser.mjs')).ClientKeyVault;
    const owner = 'did:web:identity.example:users:u-pk-browser-fixture', pod = 'u-pk-browser-fixture';
    window.currentScope = JSON.stringify(['interego-client-key/v1', 'https://relay.example', owner, pod]);
    window.previousScope = JSON.stringify(['interego-client-key/v1', 'https://previous-relay.example', owner, pod]);
    window.aliasAddress = 'hallowmarch-key-scope/v1:' + currentScope;
    window.fingerprint = async scope => {
      const value = await keyStorage.load(scope);
      if (!value) return null;
      const digest = await crypto.subtle.digest('SHA-256', value.ciphertext);
      return { publicKey: value.publicKey, version: value.version, wrappingExtractable: value.wrappingKey.extractable,
        wrappingAlgorithm: value.wrappingKey.algorithm.name, iv: Array.from(value.iv),
        ciphertextDigest: [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('') };
    };
    window.recordCount = async () => {
      const db = await new Promise((resolve, reject) => { const request = indexedDB.open('interego-client-keys-v1');
        request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
      try { return await new Promise((resolve, reject) => { const transaction = db.transaction('keys', 'readonly');
        const request = transaction.objectStore('keys').count(); request.onsuccess = () => resolve(request.result);
        transaction.onerror = transaction.onabort = () => reject(transaction.error); }); }
      finally { db.close(); }
    };
  });
  return page;
}

try {
  browser = await chromium.launch({ headless: true, executablePath: process.env.HM_CHROMIUM_EXECUTABLE || undefined, args: ['--no-sandbox'] });
  await check('explicit recovery retains the protected IndexedDB record and decrypts through its public link after reload', async context => {
    const page = await pageFor(context);
    const seeded = await page.evaluate(async () => {
      const original = new ClientKeyVault(previousScope, keyStorage, crypto), publicKey = await original.create();
      const envelope = await original.seal('private synthetic character');
      const before = await fingerprint(previousScope);
      const adopted = await scopeApi.adoptRetainedKey({ scope: currentScope, sourceScope: previousScope, publicKey, keyStorage, crypto });
      return { publicKey, envelope, before, after: await fingerprint(previousScope), adopted,
        canonical: await keyStorage.load(currentScope), aliasFields: Object.keys(await keyStorage.load(aliasAddress)).sort(), count: await recordCount() };
    });
    assert.deepEqual(seeded.adopted, { adopted: true }); assert.deepEqual(seeded.before, seeded.after);
    assert.equal(seeded.before.wrappingExtractable, false); assert.equal(seeded.before.wrappingAlgorithm, 'AES-GCM');
    assert.equal(seeded.canonical, null); assert.equal(seeded.count, 2);
    assert.deepEqual(seeded.aliasFields, ['publicKey', 'schema', 'sourceScope']);
    await page.reload();
    const reopened = await page.evaluate(async seeded => {
      const { indexedDbKeyStorage } = await import('/gaming/identity/assets/client.mjs');
      const { createOwnerKeyVault } = await import('/gaming/identity/assets/key-scope.mjs');
      const storage = indexedDbKeyStorage(), owner = 'did:web:identity.example:users:u-pk-browser-fixture';
      const scope = JSON.stringify(['interego-client-key/v1', 'https://relay.example', owner, 'u-pk-browser-fixture']);
      try { const vault = createOwnerKeyVault({ scope, keyStorage: storage, crypto });
        return { publicKey: await vault.publicKey(), content: await vault.open(seeded.envelope) }; }
      finally { await storage.close(); }
    }, seeded);
    assert.deepEqual(reopened, { publicKey: seeded.publicKey, content: 'private synthetic character' });
  });

  await check('the actual IndexedDB transaction checks context again before insert and refuses an aborted caller', async context => {
    const page = await pageFor(context);
    const result = await page.evaluate(async () => {
      const vault = new ClientKeyVault(previousScope, keyStorage, crypto), publicKey = await vault.create();
      const before = await fingerprint(previousScope), alias = { schema: 'hallowmarch-key-scope/v1', sourceScope: previousScope, publicKey };
      let guardCalls = 0, changedCode;
      try { await keyStorage.create(aliasAddress, alias, { isCurrent: () => ++guardCalls < 3 }); }
      catch (error) { changedCode = error.code; }
      const controller = new AbortController(); controller.abort(); let abortedCode;
      try { await keyStorage.create(aliasAddress, alias, { signal: controller.signal }); }
      catch (error) { abortedCode = error.code; }
      return { guardCalls, changedCode, abortedCode, before, after: await fingerprint(previousScope),
        alias: await keyStorage.load(aliasAddress), canonical: await keyStorage.load(currentScope), count: await recordCount() };
    });
    assert(result.guardCalls >= 3); assert.equal(result.changedCode, 'cancelled'); assert.equal(result.abortedCode, 'cancelled');
    assert.equal(result.alias, null); assert.equal(result.canonical, null); assert.equal(result.count, 1);
    assert.deepEqual(result.after, result.before);
  });

  await check('a second tab canonical winner aborts the queued alias insert without storing metadata or overwriting either key', async context => {
    const recovering = await pageFor(context), competing = await pageFor(context);
    const original = await recovering.evaluate(async () => {
      window.originalVault = new ClientKeyVault(previousScope, keyStorage, crypto);
      window.originalPublicKey = await originalVault.create(); window.originalEnvelope = await originalVault.seal('original retained fixture');
      const before = await fingerprint(previousScope);
      let release; const gate = new Promise(resolve => { release = resolve; }); window.releaseAlias = release;
      const wrappedStorage = { load: keyStorage.load, create: async (address, value, options) => {
        window.aliasWaiting = true; await gate; return keyStorage.create(address, value, options);
      } };
      window.adoption = scopeApi.adoptRetainedKey({ scope: currentScope, sourceScope: previousScope,
        publicKey: originalPublicKey, keyStorage: wrappedStorage, crypto }).then(() => ({ adopted: true }), error => ({ error: error.code }));
      return before;
    });
    await recovering.waitForFunction(() => window.aliasWaiting === true);
    const canonical = await competing.evaluate(async () => {
      const vault = new ClientKeyVault(currentScope, keyStorage, crypto), publicKey = await vault.create();
      return { publicKey, envelope: await vault.seal('canonical concurrent fixture'), fingerprint: await fingerprint(currentScope) };
    });
    const result = await recovering.evaluate(async canonical => {
      releaseAlias(); const outcome = await adoption;
      const resolved = scopeApi.createOwnerKeyVault({ scope: currentScope, keyStorage, crypto });
      return { outcome, selectedPublicKey: await resolved.publicKey(), content: await resolved.open(canonical.envelope),
        originalContent: await originalVault.open(originalEnvelope), source: await fingerprint(previousScope),
        canonical: await fingerprint(currentScope), count: await recordCount(), alias: await keyStorage.load(aliasAddress) };
    }, canonical);
    assert.deepEqual(result.outcome, { error: 'key_scope_changed' }); assert.equal(result.selectedPublicKey, canonical.publicKey);
    assert.equal(result.content, 'canonical concurrent fixture'); assert.equal(result.originalContent, 'original retained fixture');
    assert.deepEqual(result.source, original); assert.deepEqual(result.canonical, canonical.fingerprint); assert.equal(result.count, 2);
    assert.equal(result.alias, null);
  });
  for (const changed of ['source', 'canonical']) await check('an already resolved alias refuses private operations after a different ' + changed + ' key appears', async context => {
    const held = await pageFor(context), other = await pageFor(context);
    const seeded = await held.evaluate(async () => {
      const source = new ClientKeyVault(previousScope, keyStorage, crypto), publicKey = await source.create();
      window.heldEnvelope = await source.seal('original held alias fixture');
      await scopeApi.adoptRetainedKey({ scope: currentScope, sourceScope: previousScope, publicKey, keyStorage, crypto });
      window.heldAlias = scopeApi.createOwnerKeyVault({ scope: currentScope, keyStorage, crypto });
      return { publicKey, selected: await heldAlias.publicKey() };
    });
    assert.equal(seeded.selected, seeded.publicKey);
    const replacement = await other.evaluate(async changed => {
      if (changed === 'canonical') {
        const canonical = new ClientKeyVault(currentScope, keyStorage, crypto), publicKey = await canonical.create();
        return { publicKey, envelope: await canonical.seal('new canonical fixture') };
      }
      // A synthetic second actor replaces a protected record through the real
      // IndexedDB store. The replacement itself is made by the public SDK at
      // the same authenticated scope; no private SDK internals are used.
      const records = new Map(), storage = { load: async key => records.get(key) || null,
        create: async (key, value) => { if (!records.has(key)) records.set(key, value); return records.get(key); } };
      const replacement = new ClientKeyVault(previousScope, storage, crypto), publicKey = await replacement.create();
      const db = await new Promise((resolve, reject) => { const request = indexedDB.open('interego-client-keys-v1');
        request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
      try { await new Promise((resolve, reject) => { const transaction = db.transaction('keys', 'readwrite');
        transaction.objectStore('keys').put(records.get(previousScope), previousScope); transaction.oncomplete = resolve;
        transaction.onerror = transaction.onabort = () => reject(transaction.error); }); }
      finally { db.close(); }
      return { publicKey };
    }, changed);
    assert.notEqual(replacement.publicKey, seeded.publicKey);
    const outcomes = await held.evaluate(async replacement => {
      const outcomes = {};
      for (const [name, run] of [['open', () => heldAlias.open(heldEnvelope)], ['seal', () => heldAlias.seal('must refuse')],
        ['backup', () => heldAlias.backup('synthetic backup phrase')]]) {
        try { await run(); outcomes[name] = 'unexpected-success'; } catch (error) { outcomes[name] = error.code; }
      }
      if (replacement.envelope) {
        const fresh = scopeApi.createOwnerKeyVault({ scope: currentScope, keyStorage, crypto });
        outcomes.fresh = { publicKey: await fresh.publicKey(), content: await fresh.open(replacement.envelope) };
      }
      return outcomes;
    }, replacement);
    assert.deepEqual({ open: outcomes.open, seal: outcomes.seal, backup: outcomes.backup },
      { open: 'key_scope_changed', seal: 'key_scope_changed', backup: 'key_scope_changed' });
    if (changed === 'canonical') assert.deepEqual(outcomes.fresh, { publicKey: replacement.publicKey, content: 'new canonical fixture' });
  });
  await check('a cached empty vault cannot insert a canonical key after another tab adopts an alias while its insert is queued', async context => {
    const stalePage = await pageFor(context), other = await pageFor(context);
    const publicKey = await stalePage.evaluate(async () => {
      const source = new ClientKeyVault(previousScope, keyStorage, crypto), publicKey = await source.create();
      window.originalEnvelope = await source.seal('retained empty-race fixture');
      let release; const gate = new Promise(resolve => { release = resolve; }); window.releaseCanonicalInsert = release;
      const port = { load: keyStorage.load, create: async (scope, record, context) => {
        window.canonicalInsertWaiting = true; await gate; return keyStorage.create(scope, record, context);
      } };
      window.staleEmpty = scopeApi.createOwnerKeyVault({ scope: currentScope, keyStorage: port, crypto });
      if (await staleEmpty.publicKey() !== null) throw Error('The fixture target was not empty.');
      return publicKey;
    });
    await stalePage.evaluate(() => { window.staleCreation = staleEmpty.create().then(() => ({ created: true }), error => ({ code: error.code })); });
    await stalePage.waitForFunction(() => window.canonicalInsertWaiting === true);
    assert.deepEqual(await other.evaluate(publicKey => scopeApi.adoptRetainedKey({ scope: currentScope,
      sourceScope: previousScope, publicKey, keyStorage, crypto }), publicKey), { adopted: true });
    const result = await stalePage.evaluate(async () => {
      releaseCanonicalInsert(); const outcome = await staleCreation;
      const fresh = scopeApi.createOwnerKeyVault({ scope: currentScope, keyStorage, crypto });
      return { outcome, canonical: await keyStorage.load(currentScope), count: await recordCount(),
        publicKey: await fresh.publicKey(), content: await fresh.open(originalEnvelope) };
    });
    assert.deepEqual(result.outcome, { code: 'key_scope_changed' }); assert.equal(result.canonical, null); assert.equal(result.count, 2);
    assert.equal(result.publicKey, publicKey); assert.equal(result.content, 'retained empty-race fixture');
  });
  await check('default read-only browser enumeration retries a missing database, skips other owners and proves an encrypted nondefault profile before activation', async context => {
    const page = await pageFor(context);
    const proof = await page.evaluate(async () => {
      const { createRetainedCharacterRecovery } = await import('/gaming/identity/assets/recovery.mjs');
      const { playerProfileIndexGraphIri } = await import('/gaming/identity/assets/profile.mjs');
      const [, relayUrl, ownerDid, slug] = JSON.parse(currentScope), podUrl = 'https://pod.example/' + slug + '/';
      const indexGraph = await playerProfileIndexGraphIri(ownerDid), targetGraph = 'urn:graph:hallowmarch:retained-browser-profile:fixture';
      const encrypted = new Map(), calls = [], knownKeys = [];
      const head = graphIri => ({ descriptorUrl: podUrl + 'context-graphs/' + (graphIri === indexGraph ? 'index' : 'profile') + '.ttl',
        cid: 'sha256:' + 'a'.repeat(64), ...(graphIri === indexGraph ? {} : { nativeRevision: 'sha256:' + 'b'.repeat(64), recordCid: 'graph-nquads-sha256:' + 'c'.repeat(64) }) });
      const createClient = options => {
        if (Object.keys(options.vault).sort().join(',') !== 'open,publicKey') throw Error('Recovery received a mutable key port.');
        return { connect: async () => { calls.push('connect'); knownKeys.push(await options.vault.publicKey()); return { ownerDid, podUrl }; },
          currentHead: async input => { calls.push('head'); return encrypted.has(input.graphIri) ? head(input.graphIri) : null; },
          load: async input => { calls.push('load'); const value = encrypted.get(input.graphIri); if (!value) return null;
            return { graphIri: input.graphIri, head: head(input.graphIri), record: JSON.parse(await options.vault.open(value)), digest: 'fixture-authenticated-record' }; },
          close() { calls.push('close'); } };
      };
      const options = { binding: { subjectDid: ownerDid, podUrl }, relayUrl,
        credential: { kind: 'relay-oauth-bearer', accessToken: 'synthetic-recovery-browser-token', expiresAt: Date.now() + 600000 },
        createClient, limits: { maxCandidates: 2, maxRecords: 8 } };
      const recovery = createRetainedCharacterRecovery(options);
      const absent = await recovery.discover(), namesAfterAbsent = await indexedDB.databases();
      if (namesAfterAbsent.some(value => value.name === 'interego-client-keys-v1')) throw Error('Read-only absence probe created the database.');
      const foreignScope = JSON.stringify(['interego-client-key/v1', 'https://another-relay.example', ownerDid + '-other', slug]);
      const foreign = new ClientKeyVault(foreignScope, keyStorage, crypto), foreignKey = await foreign.create();
      const original = new ClientKeyVault(previousScope, keyStorage, crypto), publicKey = await original.create();
      encrypted.set(indexGraph, await original.seal(JSON.stringify({ schema: 'hallowmarch.player-profile-index/v1', ownerDid,
        game: 'urn:game:hallowmarch', profileGraphIri: targetGraph })));
      const profileEnvelope = await original.seal(JSON.stringify({ schema: 'hallowmarch.player-profile/v1', ownerDid,
        game: 'urn:game:hallowmarch', save: { v: 1, char: { name: 'Indexed retained hero', level: 19, realm: 1, cls: 'mage', rp: 217,
          inventory: ['hidden synthetic inventory'] } } }));
      encrypted.set(targetGraph, profileEnvelope);
      const before = await fingerprint(previousScope), countBefore = await recordCount();
      const limited = createRetainedCharacterRecovery({ ...options, limits: { maxCandidates: 1, maxRecords: 1 } });
      const bounded = await limited.discover(), connectionsAfterBoundedScan = knownKeys.length; limited.close();
      const discovered = await recovery.discover(), afterDiscover = await fingerprint(previousScope), countAfterDiscover = await recordCount();
      const noAliasBeforeActivation = await keyStorage.load(aliasAddress) === null && await keyStorage.load(currentScope) === null;
      const activated = await recovery.activate(discovered.handle), afterActivation = await fingerprint(previousScope);
      const countAfterActivation = await recordCount(), alias = await keyStorage.load(aliasAddress);
      recovery.close();
      return { absent, bounded, connectionsAfterBoundedScan, discovered, activated, before, afterDiscover, afterActivation, countBefore, countAfterDiscover,
        countAfterActivation, noAliasBeforeActivation, knownKeys, foreignKey, publicKey, profileEnvelope, calls,
        aliasFields: Object.keys(alias).sort(), backup: await original.backup('synthetic browser recovery phrase'),
        encryptedEntries: [...encrypted], indexGraph, targetGraph };
    });
    assert.deepEqual(proof.absent, { status: 'no_match' }); assert.equal(proof.discovered.status, 'verified_character');
    assert.deepEqual(proof.bounded, { status: 'limit_reached' }); assert.equal(proof.connectionsAfterBoundedScan, 0);
    assert.deepEqual(proof.discovered.summary, { name: 'Indexed retained hero', level: 19, realm: 1, calling: 'mage', realmPoints: 217 });
    assert(Object.keys(proof.discovered).every(key => ['status', 'summary', 'handle'].includes(key)));
    for (const secret of [proof.publicKey, proof.foreignKey, 'synthetic-recovery-browser-token', 'hidden synthetic inventory',
      'previous-relay.example', 'u-pk-browser-fixture']) assert(!JSON.stringify(proof.discovered).includes(secret));
    assert.equal(proof.countBefore, 2); assert.equal(proof.countAfterDiscover, 2); assert.equal(proof.noAliasBeforeActivation, true);
    assert.deepEqual(proof.afterDiscover, proof.before); assert.deepEqual(proof.afterActivation, proof.before);
    assert.deepEqual(proof.activated, { status: 'activated' }); assert.equal(proof.countAfterActivation, 3);
    assert(proof.knownKeys.length >= 2); assert(proof.knownKeys.every(key => key === proof.publicKey));
    assert(!proof.knownKeys.includes(proof.foreignKey)); assert(proof.calls.every(value => ['connect', 'head', 'load', 'close'].includes(value)));
    assert.deepEqual(proof.aliasFields, ['publicKey', 'schema', 'sourceScope']);
    const reopened = await pageFor(context);
    const selected = await reopened.evaluate(async envelope => {
      const vault = scopeApi.createOwnerKeyVault({ scope: currentScope, keyStorage, crypto });
      return { publicKey: await vault.publicKey(), name: JSON.parse(await vault.open(envelope)).save.char.name, count: await recordCount() };
    }, proof.profileEnvelope);
    assert.deepEqual(selected, { publicKey: proof.publicKey, name: 'Indexed retained hero', count: 3 });
    const fresh = await browser.newContext();
    try {
      const restoring = await pageFor(fresh);
      const result = await restoring.evaluate(async fixture => {
        const { createRetainedCharacterRecovery } = await import('/gaming/identity/assets/recovery.mjs');
        const [, relayUrl, ownerDid, slug] = JSON.parse(currentScope), podUrl = 'https://pod.example/' + slug + '/';
        const encrypted = new Map(fixture.encryptedEntries), calls = [];
        const head = graphIri => ({ descriptorUrl: podUrl + 'context-graphs/' + (graphIri === fixture.indexGraph ? 'index' : 'profile') + '.ttl',
          cid: 'sha256:' + 'a'.repeat(64), ...(graphIri === fixture.indexGraph ? {} : { nativeRevision: 'sha256:' + 'b'.repeat(64), recordCid: 'graph-nquads-sha256:' + 'c'.repeat(64) }) });
        const recovery = createRetainedCharacterRecovery({ binding: { subjectDid: ownerDid, podUrl }, relayUrl,
          credential: { kind: 'relay-oauth-bearer', accessToken: 'synthetic-fresh-restore-token', expiresAt: Date.now() + 600000 },
          createClient: options => ({ connect: async () => ({ ownerDid, podUrl }),
            currentHead: async input => { calls.push('head'); return encrypted.has(input.graphIri) ? head(input.graphIri) : null; },
            load: async input => { calls.push('load'); const value = encrypted.get(input.graphIri); return value
              ? { graphIri: input.graphIri, head: head(input.graphIri), record: JSON.parse(await options.vault.open(value)), digest: 'fixture-authenticated-record' } : null; },
            close() {} }) });
        const failed = await recovery.restore(fixture.backup, 'wrong synthetic phrase');
        const absentAfterFailure = !(await indexedDB.databases()).some(value => value.name === 'interego-client-keys-v1');
        const preview = await recovery.restore(fixture.backup, 'synthetic browser recovery phrase');
        const absentAfterPreview = !(await indexedDB.databases()).some(value => value.name === 'interego-client-keys-v1');
        const activated = await recovery.activate(preview.handle);
        const vault = scopeApi.createOwnerKeyVault({ scope: currentScope, keyStorage, crypto });
        const selected = { publicKey: await vault.publicKey(), name: JSON.parse(await vault.open(fixture.profileEnvelope)).save.char.name };
        const protectedRecord = await fingerprint(previousScope), count = await recordCount();
        recovery.close();
        return { failed, absentAfterFailure, preview, absentAfterPreview, activated, selected, protectedRecord, count, calls };
      }, proof);
      assert.equal(result.failed.status, 'unavailable'); assert.equal(result.absentAfterFailure, true);
      assert.equal(result.preview.status, 'verified_character'); assert.equal(result.absentAfterPreview, true);
      assert.deepEqual(result.preview.summary, proof.discovered.summary); assert.deepEqual(result.activated, { status: 'activated' });
      assert.deepEqual(result.selected, { publicKey: proof.publicKey, name: 'Indexed retained hero' });
      assert.equal(result.protectedRecord.wrappingExtractable, false); assert.equal(result.count, 2);
      assert(result.calls.every(operation => ['head', 'load'].includes(operation)));
      console.log('PASS original-scope encrypted backup preview stays ephemeral until explicit verified activation in a fresh browser context');
    } finally { await fresh.close(); }
  });
  assert.deepEqual(fixtureErrors, []); assert(requests.every(request => request.method === 'GET'));
  if (failures.length) throw new Error(JSON.stringify(failures));
  console.log('PASS key custody checks use real IndexedDB/WebCrypto and publish no native record.');
} finally {
  await browser?.close(); await new Promise(resolve => server.close(resolve));
}
