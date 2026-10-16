import fs from 'node:fs';
import path from 'node:path';

/** Fixed, same-origin assets for the owner browser bridge. No directory serving. */
export function createPlayerBrowserAssets({ clientRoot = new URL('../../client/native-pod/', import.meta.url) } = {}) {
  const root = clientRoot instanceof URL ? clientRoot : path.resolve(clientRoot);
  const types = { 'finish.html': 'text/html; charset=utf-8', 'finish.css': 'text/css; charset=utf-8',
    'finish.mjs': 'text/javascript; charset=utf-8', 'profile.mjs': 'text/javascript; charset=utf-8',
    'client.mjs': 'text/javascript; charset=utf-8', 'access-cache.mjs': 'text/javascript; charset=utf-8',
    'public-record.mjs': 'text/javascript; charset=utf-8', 'owner-agent-grant.mjs': 'text/javascript; charset=utf-8',
    'owner-agent-grant-schema.mjs': 'text/javascript; charset=utf-8',
    'vendor/interego-browser.mjs': 'text/javascript; charset=utf-8', 'vendor/interego-public-browser.mjs': 'text/javascript; charset=utf-8' };
  return function handle(req, res, pathname) {
    const name = pathname === '/gaming/identity/finish' ? 'finish.html'
      : pathname.startsWith('/gaming/identity/assets/') ? pathname.slice('/gaming/identity/assets/'.length) : null;
    if (name === null) return false;
    const headers = { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'" };
    if (!Object.hasOwn(types, name) || !['GET', 'HEAD'].includes(req.method)) { res.writeHead(404, headers); res.end(); return true; }
    let body;
    try { body = fs.readFileSync(root instanceof URL ? new URL(name, root) : path.join(root, name)); }
    catch { res.writeHead(503, headers); res.end(); return true; }
    res.writeHead(200, { ...headers, 'Content-Type': types[name] }); res.end(req.method === 'HEAD' ? undefined : body); return true;
  };
}
