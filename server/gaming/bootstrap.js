/** Generate deployment-owned keys inside the game process and persist them on its
 * existing mounted data volume. Private keys never need to enter deployment tools.
 * This file holds credentials only; canonical game state remains native Interego.
 */
import { constants } from 'node:fs';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { createGameServiceIdentity } from './service-identity.js';
import { ensureMonitorIdentity } from './monitor-identity.js';

const FILE_NAME = 'gaming-service-identity.json';
const MANUAL_KEYS = ['HM_GAMING_NATIVE_OWNER', 'HM_GAMING_NATIVE_POD_URL', 'HM_GAMING_NATIVE_PRIVATE_KEY',
  'HM_GAMING_NATIVE_OWNER_PUBLIC_KEY', 'HM_GAMING_SERVICE_IDENTITY_KEY_JSON', 'HM_GAMING_NATIVE_CAPABILITY',
  'HM_GAMING_MONITOR_PRIVATE_KEY', 'HM_GAMING_MONITOR_DID', 'HM_GAMING_MONITOR_POD_URL'];
function fail(message) { throw new Error('Gaming bootstrap: ' + message); }
const SECP_ORDER = BigInt('0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141');
function secpKey(value) { return /^[a-f0-9]{64}$/.test(value || '') && BigInt('0x' + value) > 0n && BigInt('0x' + value) < SECP_ORDER; }
function generateSecpKey() {
  const jwk = generateKeyPairSync('ec', { namedCurve: 'secp256k1' }).privateKey.export({ format: 'jwk' });
  return Buffer.from(jwk.d, 'base64url').toString('hex');
}
function origin(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.pathname !== '/' || url.search || url.hash || url.username || url.password) fail('HTTPS service origin required.');
  return url.origin;
}
function validate(keys) {
  if (!keys || keys.version !== 1 || typeof keys.createdAt !== 'string' || !Number.isFinite(Date.parse(keys.createdAt))
    || !secpKey(keys.encryptionPrivateKey) || !secpKey(keys.monitorPrivateKey)
    || keys.encryptionPrivateKey === keys.monitorPrivateKey) fail('persisted credential file is invalid; it will not be replaced.');
  // This also verifies that the private JWK derives its stated public key.
  createGameServiceIdentity({ keyJwk: keys.identityKeyJwk });
  return keys;
}
async function readKeys(file) {
  const handle = await fs.open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || (stat.mode & 0o777) !== 0o600 || stat.size > 16_384
      || (typeof process.getuid === 'function' && stat.uid !== process.getuid())) fail('credential file must be an owned regular file with mode 600.');
    return validate(JSON.parse(await handle.readFile('utf8')));
  } finally { await handle.close(); }
}
async function loadOrCreate(dataDir) {
  const file = path.join(dataDir, FILE_NAME);
  await fs.mkdir(dataDir, { recursive: true, mode: 0o700 });
  const dirStat = await fs.lstat(dataDir);
  if (!dirStat.isDirectory() || dirStat.isSymbolicLink()) fail('data directory must be a real mounted directory.');
  try { return await readKeys(file); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const keys = validate({ version: 1, createdAt: new Date().toISOString(),
    identityKeyJwk: generateKeyPairSync('ed25519').privateKey.export({ format: 'jwk' }),
    encryptionPrivateKey: generateSecpKey(), monitorPrivateKey: generateSecpKey() });
  const temporary = path.join(dataDir, '.' + FILE_NAME + '.' + randomBytes(16).toString('hex'));
  const handle = await fs.open(temporary, 'wx', 0o600);
  try {
    await handle.writeFile(JSON.stringify(keys) + '\n', 'utf8');
    await handle.sync();
  } finally { await handle.close(); }
  try {
    // A hard link publishes a fully fsynced inode only if no credential file exists.
    // Concurrent starts can generate candidates, but all consume the one winner.
    try { await fs.link(temporary, file); } catch (error) { if (error.code !== 'EEXIST') throw error; }
    const directory = await fs.open(dataDir, constants.O_RDONLY);
    try { await directory.sync(); } finally { await directory.close(); }
    return await readKeys(file);
  } finally { await fs.unlink(temporary).catch(() => {}); }
}

/** No mutation of process.env. The caller passes this same internal composition to
 * both configuredGamingStore and configuredServiceMonitoring. When bootstrap is off
 * existing manual deployment configuration remains available unchanged.
 */
export async function prepareGamingEnvironment(env = process.env, modules = {}) {
  const composed = { ...env };
  if (env.HM_GAMING_BOOTSTRAP !== '1') return composed;
  if (MANUAL_KEYS.some(name => env[name])) fail('bootstrap cannot overwrite explicitly configured service credentials.');
  if (!env.HM_DATA || !path.isAbsolute(env.HM_DATA)) fail('an absolute persistent HM_DATA directory is required.');
  const identityOrigin = origin(env.HM_GAMING_SERVICE_IDENTITY_ORIGIN || 'https://identity.interego.xwisee.com');
  const gateOrigin = origin(env.HM_GAMING_PUBLIC_GATE_ORIGIN || 'https://gate.interego.xwisee.com');
  const keys = await loadOrCreate(env.HM_DATA);
  const identity = createGameServiceIdentity({ identityOrigin, keyJwk: keys.identityKeyJwk });
  const core = modules.core || await import('@interego/core');
  const ownerKey = core.deriveEncryptionKeyPair(keys.encryptionPrivateKey, identity.owner);
  if (!/^[A-Za-z0-9+/]{43}=$/.test(ownerKey.publicKey || '')) fail('SDK did not derive a stable encryption public key.');
  Object.assign(composed, {
    HM_GAMING_ENABLED: '1', HM_GAMING_SERVICE_IDENTITY_ORIGIN: identityOrigin,
    HM_GAMING_SERVICE_IDENTITY_KEY_JSON: JSON.stringify(keys.identityKeyJwk),
    HM_GAMING_NATIVE_POD_URL: gateOrigin + '/' + identity.userId + '/',
    HM_GAMING_NATIVE_OWNER: identity.owner, HM_GAMING_NATIVE_PRIVATE_KEY: keys.encryptionPrivateKey,
    HM_GAMING_NATIVE_OWNER_PUBLIC_KEY: ownerKey.publicKey,
  });
  if (env.HM_GAMING_MONITOR_ENABLED === '1') {
    const provisionMonitor = modules.ensureMonitorIdentity || ensureMonitorIdentity;
    try {
      Object.assign(composed, await provisionMonitor({ privateKey: keys.monitorPrivateKey, core,
        fetch: modules.identityFetch || globalThis.fetch, identityBaseUrl: identityOrigin, gateOrigin }));
    } catch {
      // Optional operational export cannot prevent the independently authorized
      // native game service from starting. The host may retry with these same
      // persisted keys; no failed export or replacement identity is invented.
      composed.HM_GAMING_MONITOR_ENABLED = '0';
      composed.HM_GAMING_MONITOR_BOOTSTRAP_STATUS = 'identity-pending';
    }
  }
  // The game provider proves possession and checks the returned isolated owner
  // before any native store operation; no self-asserted bearer is manufactured here.
  return composed;
}
