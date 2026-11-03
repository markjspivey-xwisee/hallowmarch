import { createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { brotliCompress, gzip, constants } from 'node:zlib';

const brotli = promisify(brotliCompress), gz = promisify(gzip);
// Only the public game document passes here. Never cache private identity or
// character responses. The public manifest remains part of the content hash.
export function createGamePageDelivery() {
  const encoded = new Map();
  return async function sendGamePage(req, res, html) {
    const accepted = new Map(String(req.headers['accept-encoding'] || '').toLowerCase().split(',').map(part => {
      const [name, ...parameters] = part.trim().split(';');
      const q = parameters.find(p => /^\s*q\s*=/.test(p));
      return [name, q === undefined ? 1 : Math.max(0, Math.min(1, Number(q.split('=')[1]) || 0))];
    }));
    const quality = name => accepted.get(name) ?? accepted.get('*') ?? 0;
    const brQuality = quality('br'), gzipQuality = quality('gzip');
    let encoding = brQuality > 0 && brQuality >= gzipQuality ? 'br' : gzipQuality > 0 ? 'gzip' : null;
    const digest = createHash('sha256').update(html).digest('hex');
    const etag = 'W/"' + digest + '"';
    const headers = { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache', vary: 'Accept-Encoding', etag };
    if (String(req.headers['if-none-match'] || '').split(',').map(s => s.trim()).includes(etag)) {
      res.writeHead(304, headers); res.end(); return;
    }
    let body = html;
    if (encoding) {
      const key = encoding + ':' + digest;
      let result = encoded.get(key);
      if (!result) {
        result = encoding === 'br' ? brotli(html, { params: { [constants.BROTLI_PARAM_QUALITY]: 4 } }) : gz(html);
        encoded.set(key, result);
        while (encoded.size > 2) encoded.delete(encoded.keys().next().value);
      }
      try { body = await result; }
      catch { if (encoded.get(key) === result) encoded.delete(key); encoding = null; }
    }
    if (res.destroyed) return;
    if (encoding) headers['content-encoding'] = encoding;
    headers['content-length'] = Buffer.byteLength(body);
    res.writeHead(200, headers); res.end(req.method === 'HEAD' ? undefined : body);
  };
}
