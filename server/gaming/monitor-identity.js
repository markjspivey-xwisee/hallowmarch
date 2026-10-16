/** Establish the freshly generated, persistent game-monitor wallet's own pod.
 * Reviewed Identity SIWE challenge/proof flow; no relay, operator or human
 * credentials are accepted, and no secret is logged or transmitted elsewhere.
 * Caller owns stable in-process/on-volume key storage and invokes this internally.
 */
const IDENTITY = 'https://identity.interego.xwisee.com';
const GATE = 'https://gate.interego.xwisee.com';

export async function ensureMonitorIdentity({ privateKey, core, fetch = globalThis.fetch, now = Date.now } = {}) {
  if (typeof fetch !== 'function' || !/^(0x)?[a-f0-9]{64}$/i.test(privateKey || '')) throw new TypeError('Fresh service-owned monitor wallet is required');
  const sdk = core || await import('@interego/core');
  const key = privateKey.startsWith('0x') ? privateKey : '0x' + privateKey;
  const wallet = sdk.importWallet(key, 'agent', 'Hallowmarch Game Monitoring Service');
  if (!/^0x[a-f0-9]{40}$/i.test(wallet?.address || '')) throw new Error('Service wallet address is invalid');
  const post = async (path, body) => {
    const response = await fetch(IDENTITY + path, { method: 'POST', redirect: 'error',
      headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw new Error('Monitor identity operation was refused');
    const text = await response.text(); if (Buffer.byteLength(text) > 1024 * 1024) throw new Error('Monitor identity response exceeds capacity');
    return JSON.parse(text);
  };
  const challenge = await post('/challenges', { purpose: 'siwe' });
  if (typeof challenge.nonce !== 'string' || !/^[a-zA-Z0-9_-]{8,256}$/.test(challenge.nonce)) throw new Error('Invalid monitor identity challenge');
  const message = ['identity.interego.xwisee.com wants you to sign in with your Ethereum account:', wallet.address, '',
    'Hallowmarch Game Monitoring Service', '', 'URI: ' + IDENTITY, 'Version: 1', 'Chain ID: 1', 'Nonce: ' + challenge.nonce,
    'Issued At: ' + new Date(now()).toISOString()].join('\n');
  const signature = await sdk.signMessageRaw(wallet, message);
  const receipt = await post('/auth/siwe', { message, signature, nonce: challenge.nonce, name: 'Hallowmarch Game Monitoring Service', surfaceAgent: 'hallowmarch-monitor' });
  const userId = 'u-eth-' + wallet.address.slice(2, 14).toLowerCase();
  if (receipt.userId !== userId || typeof receipt.token !== 'string' || !receipt.token) throw new Error('Monitor identity isolation could not be verified');
  // Native SIWE issues an internal CSS URL. Use its same verified user root on
  // the public gate, whose u-eth spelling is preserved by Foxxi's own-pod guard.
  if (receipt.did !== undefined && receipt.did !== 'did:web:identity.interego.xwisee.com:users:' + userId) throw new Error('Monitor identity subject mismatch');
  return { HM_GAMING_MONITOR_ENABLED: '1', HM_GAMING_MONITOR_DID: 'did:ethr:' + wallet.address,
    HM_GAMING_MONITOR_PRIVATE_KEY: key, HM_GAMING_MONITOR_POD_URL: GATE + '/' + userId + '/' };
}
