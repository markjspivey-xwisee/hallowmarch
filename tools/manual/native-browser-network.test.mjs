import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rootCertificates } from 'node:tls';
import { X509Certificate, createHash } from 'node:crypto';
import { nativeBrowserNetwork, nativeFailureCode } from './native-browser-network.mjs';

test('standard proxy configuration requires an exact explicit opt-in and remains structured', async () => {
  assert.deepEqual(await nativeBrowserNetwork({ HTTPS_PROXY: 'untrusted-not-used' }), { args: [] });
  const configured = await nativeBrowserNetwork({ HM_NATIVE_PROXY_FROM_ENV: '1', HTTPS_PROXY: 'http://fixture-user:fixture-password@proxy.example:8080' });
  assert.deepEqual(configured, { args: [], proxy: { server: 'http://proxy.example:8080', username: 'fixture-user', password: 'fixture-password' } });
  for (const values of [{ HM_NATIVE_PROXY_FROM_ENV: 'true' }, { HM_NATIVE_PROXY_FROM_ENV: '1' },
    { HM_NATIVE_CA_FROM_ENV: '1' }, { HM_NATIVE_PROXY_FROM_ENV: '1', HTTPS_PROXY: 'socks5h://proxy.example:1080' },
    { HM_NATIVE_PROXY_FROM_ENV: '1', HTTPS_PROXY: 'http://proxy.example/path?private=fixture-secret' }]) {
    await assert.rejects(nativeBrowserNetwork(values), error => error.code === 'invalid_browser_network_config' && !error.message.includes('fixture-secret'));
  }
});

test('CA opt-in derives exactly one configured current CA SPKI and refuses bundles or invalid files', async () => {
  const pem = rootCertificates.find(value => { const cert = new X509Certificate(value);
    return cert.ca && Date.parse(cert.validFrom) <= Date.now() && Date.parse(cert.validTo) > Date.now(); });
  assert(pem, 'Node must provide a current public CA fixture');
  const directory = await mkdtemp(join(tmpdir(), 'native-qa-public-ca-')), path = join(directory, 'fixture-public-ca.pem');
  try {
    await writeFile(path, pem, { mode: 0o600 });
    const env = { HM_NATIVE_PROXY_FROM_ENV: '1', HM_NATIVE_CA_FROM_ENV: '1', HTTPS_PROXY: 'http://proxy.example:8080', NODE_EXTRA_CA_CERTS: path };
    const selected = await nativeBrowserNetwork(env), cert = new X509Certificate(pem);
    const pin = createHash('sha256').update(cert.publicKey.export({ type: 'spki', format: 'der' })).digest('base64');
    assert.deepEqual(selected.args, ['--ignore-certificate-errors-spki-list=' + pin]);
    assert(!selected.args.includes('--ignore-certificate-errors'));
    await writeFile(path, pem + '\n' + pem, { mode: 0o600 });
    await assert.rejects(nativeBrowserNetwork(env), { code: 'invalid_browser_network_config' });
    await writeFile(path, 'malformed-public-certificate', { mode: 0o600 });
    await assert.rejects(nativeBrowserNetwork(env), { code: 'invalid_browser_network_config' });
    await assert.rejects(nativeBrowserNetwork({ ...env, NODE_EXTRA_CA_CERTS: 'relative.pem' }), { code: 'invalid_browser_network_config' });
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('failure diagnostics return known fixed codes without echoing arbitrary data', () => {
  const sensitive = 'https://fixture.example/cb?code=fixture-do-not-print-this';
  assert.equal(nativeFailureCode(Error(sensitive)), 'stage_failed');
  assert.equal(nativeFailureCode(Object.assign(Error(sensitive), { code: 'fixture-do-not-print-this' })), 'stage_failed');
  assert.equal(nativeFailureCode(Error('page.goto: net::ERR_EMPTY_RESPONSE at ' + sensitive)), 'err_empty_response');
  assert.equal(nativeFailureCode(Error('page.goto: net::ERR_FIXTURE_SECRET at ' + sensitive)), 'stage_failed');
  assert.equal(nativeFailureCode(Object.assign(Error(sensitive), { name: 'TimeoutError' })), 'browser_timeout');
  assert.equal(nativeFailureCode(Error('page.evaluate: Error: owner-index\nprivate fixture details')), 'owner-index');
  assert.equal(nativeFailureCode(Error('page.evaluate: NativePodError: private fixture details')), 'native_operation_failed');
});
