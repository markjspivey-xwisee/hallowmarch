import { createBrowserAccessCache } from './access-cache.mjs';
const status = document.querySelector('#status'), button = document.querySelector('#return');
const key = 'hallowmarch.identity.ceremony.v1';
try {
  const ceremony = JSON.parse(sessionStorage.getItem(key) || 'null');
  sessionStorage.removeItem(key);
  if (typeof ceremony?.token !== 'string' || !ceremony.token || typeof ceremony.channel !== 'string'
    || !/^[A-Za-z0-9_-]{12,128}$/.test(ceremony.channel) || ceremony.host !== location.host
    || !Number.isFinite(ceremony.expiresAt) || ceremony.expiresAt < Date.now()) throw new Error('The sign-in window expired. Return to the game and connect again.');
  const response = await fetch('/gaming/identity/claim', { method: 'POST', credentials: 'same-origin', cache: 'no-store',
    headers: { Authorization: 'Bearer ' + ceremony.token, 'Content-Type': 'application/json' }, body: JSON.stringify({ ownerPodWriteAccess: true }) });
  if (!response.ok) throw new Error('The connection could not be confirmed. Return to the game and connect again.');
  const result = await response.json();
  if (!result.binding?.subjectDid || !result.appSession?.token || !result.nativeSession?.accessToken
    || typeof result.appSession.acct?.id !== 'string' || !result.appSession.acct.id
    || result.appSession.acct.id.length > 256) throw new Error('The owner pod grant is incomplete. Return to the game and connect again.');
  const relayUrl = new URL(result.nativeSession.mcpUrl).origin;
  // The reviewed relay credential contract binds these provisioned namespaces
  // to its two authentication methods. Unknown providers need their own bridge.
  const method = result.binding.userId?.startsWith('u-pk-') ? 'webauthn'
    : result.binding.userId?.startsWith('u-eth-') ? 'siwe' : null;
  if (!method) throw new Error('This identity provider needs a compatible browser credential bridge.');
  const credential = { kind: 'relay-oauth-bearer', method, accessToken: result.nativeSession.accessToken,
    expiresAt: Date.parse(result.nativeSession.expiresAt) };
  const cache = createBrowserAccessCache();
  await cache.put({ relayUrl, ownerDid: result.binding.subjectDid, podUrl: result.binding.podUrl, credential });
  await cache.close();
  // Game account token is opaque app authentication, never an Interego bearer.
  localStorage.setItem('hallowmarch.token.' + ceremony.host, result.appSession.token);
  const channel = new BroadcastChannel(ceremony.channel);
  channel.postMessage({ type: 'hallowmarch-native-connected', accountId: result.appSession.acct.id });
  setTimeout(() => channel.close(), 1000);
  status.textContent = 'Connected. Your game can now open your private pod.';
  button.hidden = false; button.onclick = () => { window.close(); location.replace('/'); };
  setTimeout(() => window.close(), 600);
} catch (error) {
  status.textContent = error.message || 'Return to the game and try connecting again.';
  button.hidden = false; button.onclick = () => { window.close(); location.replace('/'); };
}
