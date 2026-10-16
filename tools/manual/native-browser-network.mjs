/** Explicit executor routing/trust for manual browser QA, never a game feature. */
import { readFile } from 'node:fs/promises';
import { X509Certificate, createHash } from 'node:crypto';
import { isAbsolute } from 'node:path';

const invalid = () => { throw Object.assign(new Error('Manual browser network configuration was refused.'), { code: 'invalid_browser_network_config' }); };
export async function nativeBrowserNetwork(env = process.env) {
  if (env.HM_NATIVE_PROXY_FROM_ENV !== undefined && env.HM_NATIVE_PROXY_FROM_ENV !== '1') invalid();
  if (env.HM_NATIVE_CA_FROM_ENV !== undefined && env.HM_NATIVE_CA_FROM_ENV !== '1') invalid();
  if (env.HM_NATIVE_CA_FROM_ENV && !env.HM_NATIVE_PROXY_FROM_ENV) invalid();
  if (!env.HM_NATIVE_PROXY_FROM_ENV) return { args: [] };
  const raw = env.HTTPS_PROXY || env.https_proxy || env.HTTP_PROXY || env.http_proxy;
  let selected;
  try { selected = new URL(raw); } catch { invalid(); }
  if (!['http:', 'https:'].includes(selected.protocol) || selected.pathname !== '/' || selected.search || selected.hash) invalid();
  const proxy = { server: selected.protocol + '//' + selected.host };
  try {
    if (selected.username) proxy.username = decodeURIComponent(selected.username);
    if (selected.password) proxy.password = decodeURIComponent(selected.password);
  } catch { invalid(); }
  const args = [];
  if (env.HM_NATIVE_CA_FROM_ENV === '1') {
    const path = env.NODE_EXTRA_CA_CERTS || env.SSL_CERT_FILE;
    if (typeof path !== 'string' || !isAbsolute(path)) invalid();
    try {
      const contents = await readFile(path, 'utf8');
      const certificates = contents.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g) || [];
      // Exactly the configured executor CA, never an arbitrary bundle or a
      // blanket TLS bypass. This exposes only its public-key fingerprint.
      if (contents.length > 65536 || /PRIVATE KEY/.test(contents) || certificates.length !== 1) invalid();
      const certificate = new X509Certificate(certificates[0]);
      if (!certificate.ca || Date.parse(certificate.validFrom) > Date.now() || Date.parse(certificate.validTo) <= Date.now()) invalid();
      const pin = createHash('sha256').update(certificate.publicKey.export({ type: 'spki', format: 'der' })).digest('base64');
      args.push('--ignore-certificate-errors-spki-list=' + pin);
    } catch { invalid(); }
  }
  return { proxy, args };
}

const networkCodes = new Set(['ERR_EMPTY_RESPONSE', 'ERR_CERT_AUTHORITY_INVALID', 'ERR_CERT_COMMON_NAME_INVALID',
  'ERR_CERT_DATE_INVALID', 'ERR_NAME_NOT_RESOLVED', 'ERR_TIMED_OUT', 'ERR_CONNECTION_CLOSED', 'ERR_CONNECTION_RESET',
  'ERR_CONNECTION_REFUSED', 'ERR_PROXY_CONNECTION_FAILED', 'ERR_TUNNEL_CONNECTION_FAILED', 'ERR_HTTP_RESPONSE_CODE_FAILURE']);
const conditionCodes = new Set(['invalid_browser_network_config', 'advertised-pkce', 'synthetic-passkey-sync', 'claim',
  'one-qa-owner', 'browser-secret-custody', 'private-body-game-bridge', 'game-reload-body', 'reload-head-digest', 'same-owner',
  'recovery-head-digest', 'fresh-game-reload-body', 'central-write-rejection', 'privacy-invariants']);
conditionCodes.add('qa_registration_retry_refused');
conditionCodes.add('qa_native_step_failed');
const browserCodes = ['status', 'binding', 'owner', 'native-owner', 'owner-index', 'access-cache', 'readback', 'bridge-path',
  'bridge-body', 'bridge-refused', 'qa-owner-not-fresh', 'native-confirmation-timeout', 'profile-readback', 'fresh-browser-owner-index',
  'existing-index-key-replacement', 'recovery-not-required', 'recovery-readback', 'ws-timeout', 'ws-open', 'ws-reply'];
export function nativeFailureCode(error) {
  if (conditionCodes.has(error?.code)) return error.code;
  if (error?.name === 'TimeoutError') return 'browser_timeout';
  const message = typeof error?.message === 'string' ? error.message : '';
  const network = message.match(/net::(ERR_[A-Z_]+)/)?.[1];
  if (networkCodes.has(network)) return network.toLowerCase();
  for (const code of browserCodes) if (new RegExp('(?:^|Error: )' + code + '(?:\\n|$)').test(message)) return code;
  if (message.includes('NativePodError:')) return 'native_operation_failed';
  if (message.includes('BrowserAccessCacheError:')) return 'access_cache_failed';
  return 'stage_failed';
}
