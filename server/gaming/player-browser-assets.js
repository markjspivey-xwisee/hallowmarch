import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

const defaultClientRoot = new URL('../../client/native-pod/', import.meta.url);
const finishMessages = Object.freeze({
  native_owner_mismatch: 'This sign-in belongs to a different identity. Your character has not been switched. Return to the game and choose your original identity.',
  identity_authorization_declined: 'Identity sign-in was declined. Return to the game to try again.',
  identity_connection_failed: 'Sign-in did not finish. Your saved character has not been changed. Return to the game and try again.',
});
function fixedFile(root, name) {
  return fs.readFileSync(root instanceof URL ? new URL(name, root) : path.join(root, name), 'utf8');
}
function replaceSlot(template, slot, value) {
  if (template.split(slot).length !== 2) throw new Error('Invalid fixed identity return template');
  return template.replace(slot, () => value);
}

/** Source-only HTML and a CSP hash of its exact inline bytes; never accepts credentials. */
export function renderPlayerIdentityFinish({ clientRoot = defaultClientRoot, failureCode, browserCeremony } = {}) {
  const root = clientRoot instanceof URL ? clientRoot : path.resolve(clientRoot);
  // HTML parsing normalizes line endings, so injection and CSP use the same LF bytes on Windows too.
  const bootstrap = fixedFile(root, 'finish-bootstrap.js').replace(/\r\n?/g, '\n');
  if (/<\/script(?:\s|>)/i.test(bootstrap)) throw new Error('Invalid fixed identity bootstrap');
  let body = fixedFile(root, 'finish.html'), metadata = '';
  if (failureCode !== undefined) {
    if (!Object.hasOwn(finishMessages, failureCode)) throw new TypeError('Invalid identity failure code');
    metadata = '<meta name="hallowmarch-identity-error" content="' + failureCode + '">';
    if (/^[A-Za-z0-9_-]{43}$/.test(browserCeremony ?? '')) {
      metadata += '<meta name="hallowmarch-identity-ceremony" content="' + browserCeremony + '">';
    }
    body = replaceSlot(body, '<h1>Returning to the March</h1>', '<h1>Identity connection incomplete</h1>');
    body = replaceSlot(body, 'Finishing your identity connection…', finishMessages[failureCode]);
  }
  body = replaceSlot(body, '<!--hallowmarch-finish-metadata-->', metadata);
  body = replaceSlot(body, '<!--hallowmarch-finish-bootstrap-->', '<script>' + bootstrap + '</script>');
  const digest = createHash('sha256').update(bootstrap, 'utf8').digest('base64');
  return { body: Buffer.from(body, 'utf8'), headers: {
    'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', Pragma: 'no-cache',
    'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; script-src 'self' 'sha256-" + digest
      + "'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
  } };
}

/** Fixed, same-origin assets for the owner browser bridge. No directory serving. */
export function createPlayerBrowserAssets({ clientRoot = defaultClientRoot } = {}) {
  const root = clientRoot instanceof URL ? clientRoot : path.resolve(clientRoot);
  const types = { 'finish.html': 'text/html; charset=utf-8', 'finish.css': 'text/css; charset=utf-8',
    'finish.mjs': 'text/javascript; charset=utf-8', 'profile.mjs': 'text/javascript; charset=utf-8',
    'client.mjs': 'text/javascript; charset=utf-8', 'checkpoint.mjs': 'text/javascript; charset=utf-8',
    'access-cache.mjs': 'text/javascript; charset=utf-8', 'recovery.mjs': 'text/javascript; charset=utf-8',
    'key-scope.mjs': 'text/javascript; charset=utf-8',
    'provisional-session.mjs': 'text/javascript; charset=utf-8', 'provisional-device.mjs': 'text/javascript; charset=utf-8',
    'public-record.mjs': 'text/javascript; charset=utf-8', 'signing-delegation.mjs': 'text/javascript; charset=utf-8', 'owner-agent-grant.mjs': 'text/javascript; charset=utf-8',
    'owner-agent-grant-schema.mjs': 'text/javascript; charset=utf-8',
    'foxxi-consulting.mjs': 'text/javascript; charset=utf-8',
    'agent-own-session.mjs': 'text/javascript; charset=utf-8', 'agent-directory.mjs': 'text/javascript; charset=utf-8',
    'performance-consultation.mjs': 'text/javascript; charset=utf-8',
    'gameplay-activity.mjs': 'text/javascript; charset=utf-8',
    'gameplay-patterns.mjs': 'text/javascript; charset=utf-8',
    'gameplay-semantics.mjs': 'text/javascript; charset=utf-8',
    'activity-dashboard.mjs': 'text/javascript; charset=utf-8',
    'gameplay-record-reader.mjs': 'text/javascript; charset=utf-8',
    'gameplay-activity-archive.mjs': 'text/javascript; charset=utf-8',
    'gameplay-learning-delivery.mjs': 'text/javascript; charset=utf-8',
    'vendor/interego-browser.mjs': 'text/javascript; charset=utf-8', 'vendor/interego-public-browser.mjs': 'text/javascript; charset=utf-8',
    'vendor/interego-native-resource-browser.mjs': 'text/javascript; charset=utf-8' };
  return function handle(req, res, pathname) {
    const name = pathname === '/gaming/identity/finish' ? 'finish.html'
      : pathname.startsWith('/gaming/identity/assets/') ? pathname.slice('/gaming/identity/assets/'.length) : null;
    if (name === null) return false;
    const headers = { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'" };
    if (!Object.hasOwn(types, name) || !['GET', 'HEAD'].includes(req.method)) { res.writeHead(404, headers); res.end(); return true; }
    if (name === 'finish.html') {
      let page;
      try { page = renderPlayerIdentityFinish({ clientRoot: root }); }
      catch { res.writeHead(503, headers); res.end(); return true; }
      res.writeHead(200, page.headers); res.end(req.method === 'HEAD' ? undefined : page.body); return true;
    }
    let body;
    try { body = fs.readFileSync(root instanceof URL ? new URL(name, root) : path.join(root, name)); }
    catch { res.writeHead(503, headers); res.end(); return true; }
    res.writeHead(200, { ...headers, 'Content-Type': types[name] }); res.end(req.method === 'HEAD' ? undefined : body); return true;
  };
}

