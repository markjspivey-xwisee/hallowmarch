import test from 'node:test';
import assert from 'node:assert/strict';
import { ensureMonitorIdentity } from './monitor-identity.js';
const privateKey = '0x' + '1'.repeat(64), address = '0xAbCdEf123456' + '1'.repeat(28);
const core = { importWallet: key => { assert.equal(key, privateKey); return { address }; }, signMessageRaw: async (wallet, message) => { assert.equal(wallet.address, address); assert(message.startsWith('identity.interego.xwisee.com wants you to sign in')); return 'fixture-wallet-proof'; } };
const userId = 'u-eth-abcdef123456';

test('bootstrap proves only a fresh service wallet and returns its isolated pod settings', async () => {
  const calls = [];
  const env = await ensureMonitorIdentity({ privateKey, core, now: () => 100000, fetch: async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body) }); assert.equal(init.headers.authorization, undefined); assert.equal(init.redirect, 'error');
    return new Response(JSON.stringify(url.endsWith('/challenges') ? { nonce: 'freshNonce123' } : { userId, token: 'own-service-bearer', did: 'did:web:identity.interego.xwisee.com:users:' + userId }));
  } });
  assert.equal(calls.length, 2); assert.deepEqual(calls[0].body, { purpose: 'siwe' });
  assert.equal(calls[1].body.signature, 'fixture-wallet-proof'); assert.equal(calls[1].body.message.split('\n').length, 10); assert(!calls[1].body.message.includes('\\n'));  assert(calls[1].body.message.includes('Nonce: freshNonce123'));
  assert(calls[1].body.message.includes('Issued At: 1970-01-01T00:01:40.000Z')); assert(!JSON.stringify(calls).includes(privateKey));
  assert.equal(env.HM_GAMING_MONITOR_DID, 'did:ethr:' + address); assert.equal(env.HM_GAMING_MONITOR_POD_URL, 'https://gate.interego.xwisee.com/' + userId + '/');
  assert.equal(env.HM_GAMING_MONITOR_PRIVATE_KEY, privateKey); assert(!JSON.stringify(env).includes('own-service-bearer'));
});

test('an account or pod outside the proven service wallet is refused', async () => {
  await assert.rejects(ensureMonitorIdentity({ privateKey, core, fetch: async url => new Response(JSON.stringify(url.endsWith('/challenges') ? { nonce: 'freshNonce123' } : { userId: 'human-account', token: 'must-not-use' })) }), /isolation/);
  await assert.rejects(ensureMonitorIdentity({ privateKey, core, fetch: async url => new Response(JSON.stringify(url.endsWith('/challenges') ? { nonce: 'freshNonce123' } : { userId, token: 'own-service-bearer', did: 'did:example:human' })) }), /subject mismatch/);
});

test('missing key, malformed nonce and denied identity operations fail before provisioning', async () => {
  await assert.rejects(ensureMonitorIdentity({ privateKey: '' }));
  let calls = 0; await assert.rejects(ensureMonitorIdentity({ privateKey, core, fetch: async () => { calls++; return new Response(JSON.stringify({ nonce: '\ninvalid challenge' })); } }), /challenge/); assert.equal(calls, 1);
  await assert.rejects(ensureMonitorIdentity({ privateKey, core, fetch: async () => new Response('{}', { status: 403 }) }), /refused/);
});
