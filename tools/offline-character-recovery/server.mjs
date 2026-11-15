/** Standalone fixed-origin static tool. No game backend, credentials or write endpoints. */
import http from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { checkedPublicScope, RECOVERY_ORIGIN } from './scope.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const TYPES = Object.freeze({ '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' });
const SECURITY = Object.freeze({
  'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'none'; img-src 'none'; font-src 'none'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
  'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff',
  'Cache-Control': 'no-store', 'Cross-Origin-Resource-Policy': 'same-origin',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), usb=(), serial=(), payment=()',
});
const escapeHtml = value => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

export function createOfflineRecoveryHandler(publicScope) {
  const selected = checkedPublicScope(publicScope), config = JSON.stringify(selected);
  const template = readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  if (template.split('<!--public-scope-->').length !== 2) throw new Error('The recovery page is unavailable.');
  const assets = new Map([['/', { type: 'text/html; charset=utf-8', body: Buffer.from(template.replace('<!--public-scope-->',
    () => '<template id="public-scope">' + escapeHtml(config) + '</template>')) }],
  ['/scope.json', { type: 'application/json; charset=utf-8', body: Buffer.from(config) }]]);
  for (const name of ['style.css', 'recovery-ui.mjs', 'recovery-core.mjs', 'scope.mjs']) {
    assets.set('/assets/' + name, { type: TYPES[path.extname(name)], body: readFileSync(path.join(ROOT, name)) });
  }
  assets.set('/client/native-pod/vendor/interego-browser.mjs', { type: TYPES['.mjs'],
    body: readFileSync(path.join(ROOT, '../../client/native-pod/vendor/interego-browser.mjs')) });
  return (request, response) => {
    const reject = status => { response.writeHead(status, { ...SECURITY, 'Content-Type': 'text/plain; charset=utf-8' }); response.end(request.method === 'HEAD' ? undefined : 'This recovery request is unavailable.'); };
    if (request.headers.host !== '127.0.0.1:8787'
      || request.headers.origin !== undefined && request.headers.origin !== RECOVERY_ORIGIN
      || !['127.0.0.1', '::ffff:127.0.0.1'].includes(request.socket.remoteAddress)) return reject(403);
    if (!['GET', 'HEAD'].includes(request.method)) return reject(405);
    const asset = assets.get(request.url);
    if (!asset) return reject(404);
    response.writeHead(200, { ...SECURITY, 'Content-Type': asset.type, 'Content-Length': asset.body.length });
    response.end(request.method === 'HEAD' ? undefined : asset.body);
  };
}

/** Deliberately has no host/port overrides, environment secrets or browser launcher. */
export function startOfflineRecovery({ publicScope }) {
  const server = http.createServer(createOfflineRecoveryHandler(publicScope));
  server.requestTimeout = 5000; server.headersTimeout = 5000; server.keepAliveTimeout = 1000;
  return new Promise((resolve, reject) => {
    const failed = () => { server.close(); reject(new Error('The recovery page could not start. Close another local recovery tool before trying again.')); };
    server.once('error', failed);
    server.listen(8787, '127.0.0.1', () => { server.removeListener('error', failed); resolve(server); });
  });
}
function argumentsScope(values) {
  if (values.length !== 4 || values[0] !== '--owner-did' || values[2] !== '--pod-url') throw new Error('Provide the public identity and pod launch arguments.');
  return checkedPublicScope({ ownerDid: values[1], podUrl: values[3] });
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const server = await startOfflineRecovery({ publicScope: argumentsScope(process.argv.slice(2)) });
    process.stdout.write('Optional recovery page ready at http://127.0.0.1:8787. No browser storage has been checked.\n');
    for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => server.close());
  } catch {
    process.stderr.write('The optional recovery page could not start. Check its public launch arguments and ensure the fixed local address is free.\n');
    process.exitCode = 1;
  }
}
