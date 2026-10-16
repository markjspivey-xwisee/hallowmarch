import fs from 'node:fs';

/** Public, fixed agent SDK module; no source directory or private files. */
export function createWorldAgentAssets({ clientFile = new URL('../../client/world-agent-client.mjs', import.meta.url) } = {}) {
  return function handle(req, res, pathname) {
    if (pathname !== '/world/agent-client.mjs') return false;
    const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
      'Access-Control-Allow-Origin': '*', 'Referrer-Policy': 'no-referrer' };
    if (!['GET', 'HEAD'].includes(req.method)) {
      res.writeHead(405, { ...headers, Allow: 'GET, HEAD' }); res.end(); return true;
    }
    let body;
    try { body = fs.readFileSync(clientFile); }
    catch { res.writeHead(503, headers); res.end(); return true; }
    res.writeHead(200, { ...headers, 'Content-Type': 'text/javascript; charset=utf-8' });
    res.end(req.method === 'HEAD' ? undefined : body); return true;
  };
}
