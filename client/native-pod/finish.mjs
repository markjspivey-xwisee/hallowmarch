const status = document.querySelector('#status'), button = document.querySelector('#return');
const key = 'hallowmarch.identity.ceremony.v1';
try {
  // Consume callback URLs before any import or claim. The fixed finish page
  // also runs directly at the callback, without a second document navigation.
  history.replaceState(null, '', '/gaming/identity/finish');
  const failure = document.querySelector('meta[name="hallowmarch-identity-error"]');
  const ceremony = JSON.parse(sessionStorage.getItem(key) || 'null');
  sessionStorage.removeItem(key);
  if (typeof ceremony?.token !== 'string' || !ceremony.token || typeof ceremony.channel !== 'string'
    || !/^[A-Za-z0-9_-]{12,128}$/.test(ceremony.channel) || ceremony.host !== location.host
    || !Number.isFinite(ceremony.expiresAt) || ceremony.expiresAt < Date.now()) throw new Error('The sign-in window expired. Return to the game and connect again.');
  if (failure) {
    const messages = {
      native_owner_mismatch: 'This sign-in belongs to a different account. Your current character has not been switched. Return to the game to reconnect its original identity, or use “Sign in with a different account” from the title screen.',
      identity_authorization_declined: 'Sign-in was cancelled. Return to the game and connect again when you are ready.',
      identity_connection_failed: 'The identity connection could not be confirmed. Your current character has not been switched. Return to the game and connect again.',
    };
    const proof = document.querySelector('meta[name="hallowmarch-identity-ceremony"]')?.content;
    // Only the server's consumed, cookie-verified callback can confirm this
    // popup's ceremony. A query string or an unrelated failure cannot switch
    // accounts, claim a grant, or touch the retained browser credential.
    if (!Object.hasOwn(messages, failure.content) || !/^[A-Za-z0-9_-]{43}$/.test(proof || '')
      || proof !== ceremony.browserCeremony) throw new Error('The sign-in window expired. Return to the game and connect again.');
    const channel = new BroadcastChannel(ceremony.channel);
    channel.postMessage({ type: 'hallowmarch-native-failed', error: failure.content,
      browserCeremony: proof, host: ceremony.host });
    setTimeout(() => channel.close(), 1000);
    throw new Error(messages[failure.content]);
  }
  const characterClaim = ceremony.purpose === 'character-claim-target';
  const response = await fetch(characterClaim ? '/gaming/identity/claim-owner/claim' : '/gaming/identity/claim', { method: 'POST', credentials: 'same-origin', cache: 'no-store',
    headers: { Authorization: 'Bearer ' + ceremony.token, 'Content-Type': 'application/json' }, body: JSON.stringify({ ownerPodWriteAccess: true }) });
  if (!response.ok) throw new Error('The connection could not be confirmed. Return to the game and connect again.');
  const result = await response.json();
  if (characterClaim) {
    const { createProvisionalPlayerSession } = await import('./provisional-session.mjs');
    if (result.appSession?.purpose !== 'character-claim-target' || !result.nativeSession?.accessToken
      || !result.binding?.subjectDid || result.appSession.guestOwnerDid !== ceremony.expectedOwnerDid) {
      throw new Error('The character claim does not match the original provisional identity. Return to the game and try again.');
    }
    const mcp = new URL(result.nativeSession.mcpUrl);
    if (mcp.protocol !== 'https:' || mcp.href !== mcp.origin + '/mcp') throw new Error('The canonical native relay grant is invalid.');
    const session = await createProvisionalPlayerSession({ origin: location.origin, relayUrl: mcp.origin,
      request: async () => { throw new Error('The sign-in window cannot change active game participation.'); } });
    // Durable custody precedes notification, so a reloaded/closed opener can
    // recover this bounded handoff without another OAuth ceremony. The target
    // grant is a copy/read capability and never replaces the guest game token.
    try { await session.stageClaimTarget(result); } finally { session.close(); }
    const channel = new BroadcastChannel(ceremony.channel);
    channel.postMessage({ type: 'hallowmarch-native-claim-target', ownerDid: result.binding.subjectDid,
      podUrl: result.binding.podUrl, claimOperationId: result.appSession.claimOperationId,
      browserCeremony: ceremony.browserCeremony, host: ceremony.host });
    setTimeout(() => channel.close(), 1000);
    status.textContent = 'Owner connected. Return to the game to keep your character.';
    button.hidden = false; button.onclick = () => { window.close(); location.replace('/'); };
    setTimeout(() => window.close(), 600);
  } else {
  if (!result.binding?.subjectDid || !result.appSession?.token || !result.nativeSession?.accessToken
    || typeof result.appSession.acct?.id !== 'string' || !result.appSession.acct.id
    || result.appSession.acct.id.length > 256) throw new Error('The owner pod grant is incomplete. Return to the game and connect again.');
  if ((ceremony.expectedAccountId !== undefined || ceremony.expectedOwnerDid !== undefined || ceremony.expectedPodUrl !== undefined)
    && (typeof ceremony.expectedAccountId !== 'string' || typeof ceremony.expectedOwnerDid !== 'string' || typeof ceremony.expectedPodUrl !== 'string'
      || result.appSession.acct.id !== ceremony.expectedAccountId || result.binding.subjectDid !== ceremony.expectedOwnerDid
      || result.binding.podUrl !== ceremony.expectedPodUrl)) {
    throw new Error('This game is playing another identity’s character. Reconnect its original identity; your current progress has not been moved.');
  }
  const mcp = new URL(result.nativeSession.mcpUrl);
  if (mcp.protocol !== 'https:' || mcp.username || mcp.password || mcp.search || mcp.hash || mcp.href !== mcp.origin + '/mcp') {
    throw new Error('This identity relay needs a compatible browser credential bridge.');
  }
  const relayUrl = mcp.origin;
  // The reviewed relay credential contract binds these provisioned namespaces
  // to its two authentication methods. Unknown providers need their own bridge.
  const method = result.binding.userId?.startsWith('u-pk-') ? 'webauthn'
    : result.binding.userId?.startsWith('u-eth-') ? 'siwe' : null;
  if (!method) throw new Error('This identity provider needs a compatible browser credential bridge.');
  const credential = { kind: 'relay-oauth-bearer', method, accessToken: result.nativeSession.accessToken,
    expiresAt: Date.parse(result.nativeSession.expiresAt) };
  // Claim the short-lived, owner-bound handoff before loading the cache/SDK.
  const { createBrowserAccessCache } = await import('./access-cache.mjs');
  const cache = createBrowserAccessCache();
  await cache.put({ relayUrl, ownerDid: result.binding.subjectDid, podUrl: result.binding.podUrl, credential });
  await cache.close();
  // Game account token is opaque app authentication, never an Interego bearer.
  localStorage.setItem('hallowmarch.token.' + ceremony.host, result.appSession.token);
  const channel = new BroadcastChannel(ceremony.channel);
  channel.postMessage({ type: 'hallowmarch-native-connected', accountId: result.appSession.acct.id,
    ownerDid: result.binding.subjectDid, podUrl: result.binding.podUrl });
  setTimeout(() => channel.close(), 1000);
  status.textContent = 'Connected. Your game can now open your private pod.';
  button.hidden = false; button.onclick = () => { window.close(); location.replace('/'); };
  setTimeout(() => window.close(), 600);
  }
} catch (error) {
  status.textContent = error.message || 'Return to the game and try connecting again.';
  button.hidden = false; button.onclick = () => { window.close(); location.replace('/'); };
}

