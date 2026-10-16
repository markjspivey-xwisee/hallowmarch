/** Manual QA only: capture a response digest before the native page navigates.
 * No top-level I/O and no credential, redirect, code or state crosses the port. */
import { randomUUID } from 'node:crypto';

const codes = new Set(['capture_complete', 'capture_native_refused', 'capture_body_unavailable', 'capture_body_oversize',
  'capture_json_invalid', 'capture_shape_refused', 'capture_url_refused', 'capture_origin_refused', 'capture_path_refused',
  'capture_state_refused', 'capture_query_refused', 'capture_sender_refused', 'capture_receipt_refused', 'capture_duplicate']);
export const nativeOAuthCaptureCode = value => codes.has(value) ? value : null;
const failure = () => Object.assign(new Error('Manual OAuth response capture refused.'), { code: 'qa_oauth_capture_refused' });

// Serialized into ONLY the owned native authorization popup, before clicking
// its proof button. Returning the original Response preserves provider behavior.
export function installNativeOAuthBrowserCapture({ binding, captureId, gameOrigin, relayOrigin, state }) {
  const original = globalThis.fetch.bind(globalThis);
  let captured = false;
  const send = async (code, status, redirectHash = null) => {
    try { await globalThis[binding]({ captureId, code, status, redirectHash }); } catch { /* Node records fixed refusal; never log input. */ }
  };
  globalThis.fetch = async function(input, init) {
    const response = await original(input, init);
    let url; try { url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url, location.href); }
    catch { return response; }
    const method = String(init?.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();
    if (url.origin !== relayOrigin || url.pathname !== '/oauth/verify' || url.search || url.hash || method !== 'POST') return response;
    if (captured) { await send('capture_duplicate', response.status); return response; }
    captured = true;
    if (response.status !== 200) { await send('capture_native_refused', response.status); return response; }
    let value;
    try {
      if (Number(response.headers.get('content-length') || 0) > 8192) { await send('capture_body_oversize', 200); return response; }
      const reader = response.clone().body?.getReader(); if (!reader) { await send('capture_body_unavailable', 200); return response; }
      const chunks = []; let size = 0;
      try { for (;;) { const part = await reader.read(); if (part.done) break;
        size += part.value.byteLength;
        if (size > 8192) {
          // A cloned body's tee cancellation may await the untouched original
          // branch. Its consumer cannot read until this wrapper returns.
          reader.cancel().catch(() => {}); await send('capture_body_oversize', 200); return response;
        }
        chunks.push(part.value);
      } } finally { reader.releaseLock(); }
      const bytes = new Uint8Array(size); let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
      try { value = JSON.parse(new TextDecoder().decode(bytes)); }
      catch { await send('capture_json_invalid', 200); return response; }
    } catch { await send('capture_body_unavailable', 200); return response; }
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).join(',') !== 'redirect'
      || typeof value.redirect !== 'string') { await send('capture_shape_refused', 200); return response; }
    let redirect; try { redirect = new URL(value.redirect); } catch { await send('capture_url_refused', 200); return response; }
    if (redirect.origin !== gameOrigin || redirect.username || redirect.password) { await send('capture_origin_refused', 200); return response; }
    if (redirect.pathname !== '/gaming/identity/callback' || redirect.hash) { await send('capture_path_refused', 200); return response; }
    if (redirect.searchParams.getAll('state').length !== 1 || redirect.searchParams.get('state') !== state) {
      await send('capture_state_refused', 200); return response;
    }
    if (redirect.searchParams.getAll('code').length !== 1 || !redirect.searchParams.get('code')
      || [...redirect.searchParams.keys()].sort().join(',') !== 'code,state') { await send('capture_query_refused', 200); return response; }
    const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(redirect.href));
    const digest = [...new Uint8Array(bytes)].map(value => value.toString(16).padStart(2, '0')).join('');
    // The acknowledgement occurs before submitProof receives its unchanged
    // Response and assigns window.location.href from the native JSON body.
    await send('capture_complete', 200, digest);
    return response;
  };
}

export async function prepareNativeOAuthRedirectCapture(popup, { gameOrigin, relayOrigin, state, onReceipt }) {
  const binding = '__hmNativeOAuthVerifyReceipt', captureId = randomUUID();
  await popup.waitForURL(url => url.origin === relayOrigin && url.pathname === '/authorize', { timeout: 60000 });
  let received = false;
  await popup.exposeBinding(binding, (source, receipt) => {
    const refuse = code => { onReceipt({ code, status: null, redirectHash: null }); throw failure(); };
    let sender; try { sender = new URL(source.frame.url()); } catch { return refuse('capture_sender_refused'); }
    if (source.page !== popup || source.frame !== popup.mainFrame() || sender.origin !== relayOrigin || sender.pathname !== '/authorize') return refuse('capture_sender_refused');
    if (received) return refuse('capture_duplicate');
    received = true;
    if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)
      || Object.keys(receipt).sort().join(',') !== 'captureId,code,redirectHash,status' || receipt.captureId !== captureId
      || !codes.has(receipt.code) || !Number.isInteger(receipt.status) || receipt.status < 100 || receipt.status > 599
      || (receipt.code === 'capture_complete' ? receipt.status !== 200 || !/^[a-f0-9]{64}$/.test(receipt.redirectHash)
        : receipt.redirectHash !== null)) return refuse('capture_receipt_refused');
    onReceipt({ code: receipt.code, status: receipt.status, redirectHash: receipt.redirectHash });
  });
  await popup.evaluate(installNativeOAuthBrowserCapture, { binding, captureId, gameOrigin, relayOrigin, state });
}
