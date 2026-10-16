/** Optional serialized public transport for an executor's already configured
 * browser network. No browser/account/native credential is attached. */
export async function nativeCompanionBrowserRequest({ url, init, timeoutMs = 45000 } = {}) {
  const fail = () => { throw new Error('Manual companion public transport refused.'); };
  let target; try { target = new URL(url); } catch { fail(); }
  if (target.origin !== location.origin || target.protocol !== 'https:' || target.href !== url || target.username || target.password
    || target.search || target.hash || !['GET', 'POST'].includes(init?.method) || init.credentials !== 'omit'
    || init.cache !== 'no-store' || init.redirect !== 'error' || !Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 60000) fail();
  const headers = init.headers;
  if (!headers || typeof headers !== 'object' || Array.isArray(headers)
    || Object.entries(headers).some(([key, value]) => !['accept', 'content-type'].includes(key.toLowerCase()) || value !== 'application/json')) fail();
  if (init.method === 'GET' ? init.body !== undefined : typeof init.body !== 'string' || new TextEncoder().encode(init.body).length > 16384) fail();
  if (init.body) {
    let body; try { body = JSON.parse(init.body); } catch { fail(); }
    const check = (value, depth = 0) => {
      if (depth > 16 || !value || typeof value !== 'object') return;
      if (Object.keys(value).some(key => ['accessToken', 'refreshToken', 'privateKey', 'token', 'authorization', 'd'].includes(key))) fail();
      Object.values(value).forEach(value => check(value, depth + 1));
    }; check(body);
  }
  const response = await fetch(url, { method: init.method, headers, ...(init.body ? { body: init.body } : {}),
    credentials: 'omit', redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(timeoutMs) });
  if (response.url !== url || Number(response.headers.get('content-length') || 0) > 262144) fail();
  const reader = response.body?.getReader(); if (!reader) fail();
  const chunks = []; let size = 0;
  try { for (;;) { const part = await reader.read(); if (part.done) break; size += part.value.byteLength;
    if (size > 262144) { await reader.cancel(); fail(); } chunks.push(part.value); } } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  let value; try { value = JSON.parse(new TextDecoder().decode(bytes)); } catch { fail(); }
  return { ok: response.ok, status: response.status, url: response.url, value };
}
