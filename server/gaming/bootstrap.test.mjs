import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash, createPrivateKey, createPublicKey } from 'node:crypto';
import { prepareGamingEnvironment } from './bootstrap.js';

const core = {
  deriveEncryptionKeyPair(key, owner) {
    const secret = createHash('sha256').update(key.toLowerCase() + ':interego-agent-encryption-v1:' + owner).digest();
    const privateKey = createPrivateKey({ key: Buffer.concat([Buffer.from('302e020100300506032b656e04220420', 'hex'), secret]), format: 'der', type: 'pkcs8' });
    return { publicKey: Buffer.from(createPublicKey(privateKey).export({ format: 'jwk' }).x, 'base64url').toString('base64') };
  },
};
const fixture = async fn => { const dir = await fs.mkdtemp(path.join(tmpdir(), 'hm-service-bootstrap-')); try { await fn(dir); } finally { await fs.rm(dir, { recursive: true, force: true }); } };
const options = dir => ({ HM_GAMING_BOOTSTRAP: '1', HM_DATA: dir });

test('disabled bootstrap clones configuration without touching a data path', async () => {
  const env = { HM_GAMING_ENABLED: '0', HM_DATA: '/unavailable/path' };
  const result = await prepareGamingEnvironment(env);
  assert.deepEqual(result, env); assert.notEqual(result, env);
});

test('bootstrap persists separate credentials with mode600 and reuses them after restart', async () => fixture(async dir => {
  const env = options(dir), first = await prepareGamingEnvironment(env, { core });
  assert.equal(env.HM_GAMING_NATIVE_PRIVATE_KEY, undefined);
  const file = path.join(dir, 'gaming-service-identity.json'), stat = await fs.stat(file);
  assert.equal(stat.mode & 0o777, 0o600);
  const bytes = await fs.readFile(file, 'utf8'), keys = JSON.parse(bytes);
  assert.notEqual(keys.encryptionPrivateKey, keys.monitorPrivateKey);
  assert.equal(keys.identityKeyJwk.crv, 'Ed25519');
  assert.match(first.HM_GAMING_NATIVE_OWNER, /^did:web:identity\.interego\.xwisee\.com:users:u-did-/);
  assert.match(first.HM_GAMING_NATIVE_POD_URL, /^https:\/\/gate\.interego\.xwisee\.com\/u-did-[a-f0-9]{12}\/$/);
  assert.equal(first.HM_GAMING_NATIVE_CAPABILITY, undefined);
  assert.deepEqual(Object.keys(keys).sort(), ['createdAt', 'encryptionPrivateKey', 'identityKeyJwk', 'monitorPrivateKey', 'version']);
  assert.deepEqual(await prepareGamingEnvironment(env, { core }), first);
  assert.equal(await fs.readFile(file, 'utf8'), bytes);
}));

test('concurrent process starts converge on one fully written credential file', async () => fixture(async dir => {
  const configurations = await Promise.all(Array.from({ length: 8 }, () => prepareGamingEnvironment(options(dir), { core })));
  for (const env of configurations) assert.deepEqual(env, configurations[0]);
  assert.deepEqual(await fs.readdir(dir), ['gaming-service-identity.json']);
}));

test('monitor authentication gets only a separately persisted deployment-owned key', async () => fixture(async dir => {
  let supplied;
  const config = await prepareGamingEnvironment({ ...options(dir), HM_GAMING_MONITOR_ENABLED: '1' }, { core,
    ensureMonitorIdentity: async request => { supplied = request.privateKey; return { HM_GAMING_MONITOR_PRIVATE_KEY: supplied, HM_GAMING_MONITOR_DID: 'did:ethr:0x' + 'a'.repeat(40), HM_GAMING_MONITOR_POD_URL: 'https://gate.interego.xwisee.com/u-eth-aaaaaaaaaaaa/' }; } });
  const persisted = JSON.parse(await fs.readFile(path.join(dir, 'gaming-service-identity.json'), 'utf8'));
  assert.equal(supplied, persisted.monitorPrivateKey);
  assert.notEqual(supplied, config.HM_GAMING_NATIVE_PRIVATE_KEY);
  assert.equal(config.HM_GAMING_MONITOR_PRIVATE_KEY, supplied);
}));

test('optional monitor identity outage preserves the native game identity and can retry with the same keys', async () => fixture(async dir => {
  const env = { ...options(dir), HM_GAMING_MONITOR_ENABLED: '1' }; let failedKey;
  const pending = await prepareGamingEnvironment(env, { core, ensureMonitorIdentity: async request => { failedKey = request.privateKey; throw new Error('unavailable'); } });
  assert.equal(pending.HM_GAMING_ENABLED, '1'); assert.equal(pending.HM_GAMING_MONITOR_ENABLED, '0');
  assert.equal(pending.HM_GAMING_MONITOR_BOOTSTRAP_STATUS, 'identity-pending');
  const resumed = await prepareGamingEnvironment(env, { core, ensureMonitorIdentity: async request => {
    assert.equal(request.privateKey, failedKey); return { HM_GAMING_MONITOR_ENABLED: '1' };
  } });
  assert.equal(resumed.HM_GAMING_NATIVE_PRIVATE_KEY, pending.HM_GAMING_NATIVE_PRIVATE_KEY);
  assert.equal(resumed.HM_GAMING_NATIVE_OWNER, pending.HM_GAMING_NATIVE_OWNER);
  assert.equal(resumed.HM_GAMING_MONITOR_ENABLED, '1');
}));

test('invalid existing credentials and explicit external credentials fail without replacement', async () => fixture(async dir => {
  const file = path.join(dir, 'gaming-service-identity.json');
  await fs.writeFile(file, '{"version":999}', { mode: 0o600 });
  await assert.rejects(prepareGamingEnvironment(options(dir), { core }), /invalid/);
  assert.equal(await fs.readFile(file, 'utf8'), '{"version":999}');
  await assert.rejects(prepareGamingEnvironment({ ...options(dir), HM_GAMING_NATIVE_PRIVATE_KEY: 'external' }, { core }), /overwrite/);
  await assert.rejects(prepareGamingEnvironment({ HM_GAMING_BOOTSTRAP: '1' }, { core }), /persistent/);
}));

test('bootstrap refuses readable credential files and symlinked paths', async () => fixture(async dir => {
  await prepareGamingEnvironment(options(dir), { core });
  const file = path.join(dir, 'gaming-service-identity.json');
  await fs.chmod(file, 0o644);
  await assert.rejects(prepareGamingEnvironment(options(dir), { core }), /mode 600/);
  await fs.chmod(file, 0o600);
  const link = path.join(dir, 'linked'); await fs.symlink(dir, link);
  await assert.rejects(prepareGamingEnvironment(options(link), { core }), /real mounted directory/);
  await fs.unlink(file); await fs.symlink(path.join(dir, 'missing'), file);
  await assert.rejects(prepareGamingEnvironment(options(dir), { core }));
}));
