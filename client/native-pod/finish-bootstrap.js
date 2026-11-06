// A fixed parser-time classic script: claim before external styles, modules or SDKs.
// The server hashes these exact normalized bytes into CSP. No request data enters this source.
(async () => {
  'use strict';
  const status = document.querySelector('#status'), button = document.querySelector('#return');
  const key = 'hallowmarch.identity.ceremony.v1';
  try {
    history.replaceState(null, '', '/gaming/identity/finish');
    const failure = document.querySelector('meta[name="hallowmarch-identity-error"]');
    const retained = sessionStorage.getItem(key);
    sessionStorage.removeItem(key);
    const ceremony = JSON.parse(retained || 'null');
    if (typeof ceremony?.token !== 'string' || !ceremony.token || typeof ceremony.channel !== 'string'
      || !/^[A-Za-z0-9_-]{12,128}$/.test(ceremony.channel) || ceremony.host !== location.host
      || !Number.isFinite(ceremony.expiresAt) || ceremony.expiresAt < Date.now()) throw new Error('The sign-in window expired. Return to the game and connect again.');
    if (failure) {
      const messages = {
        native_owner_mismatch: 'This sign-in belongs to a different account. Your current character has not been switched. Return to the game to reconnect its original identity, or use “Sign in with a different account” from the title screen.',
        identity_authorization_declined: 'Sign-in was cancelled. Return to the game and connect again when you are ready.',
        identity_connection_failed: 'Sign-in did not finish. Your saved character has not been changed. Return to the game and try again.',
      };
      const proof = document.querySelector('meta[name="hallowmarch-identity-ceremony"]')?.content;
      if (!Object.hasOwn(messages, failure.content) || !/^[A-Za-z0-9_-]{43}$/.test(proof || '')
        || proof !== ceremony.browserCeremony) throw new Error('The sign-in window expired. Return to the game and connect again.');
      const channel = new BroadcastChannel(ceremony.channel);
      channel.postMessage({ type: 'hallowmarch-native-failed', error: failure.content,
        browserCeremony: proof, host: ceremony.host });
      setTimeout(() => channel.close(), 1000);
      throw new Error(messages[failure.content]);
    }
    const characterClaim = ceremony.purpose === 'character-claim-target';
    const response = await fetch(characterClaim ? '/gaming/identity/claim-owner/claim' : '/gaming/identity/claim', {
      method: 'POST', credentials: 'same-origin', cache: 'no-store',
      headers: { Authorization: 'Bearer ' + ceremony.token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ownerPodWriteAccess: true }),
    });
    delete ceremony.token;
    if (!response.ok) throw new Error('Sign-in did not finish. Your saved character has not been changed. Return to the game and try again.');
    const result = await response.json();
    // Private lexical arguments, never a window property, DOM value or message containing a grant.
    const { completeIdentityConnection } = await import('/gaming/identity/assets/finish.mjs');
    await completeIdentityConnection(ceremony, result);
  } catch (error) {
    status.textContent = error.message || 'Return to the game and try connecting again.';
    button.hidden = false; button.onclick = () => { window.close(); location.replace('/'); };
  }
})();
