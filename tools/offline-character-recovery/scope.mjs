/** Public launch information only. No identity discovery, grants or browser storage. */
export const RECOVERY_ORIGIN = 'http://127.0.0.1:8787';
export const KEY_DATABASE = 'interego-client-keys-v1';
export const KEY_STORE = 'keys';
const RELAYS = Object.freeze(['https://relay.interego.xwisee.com']);
const SCHEMA = 'hallowmarch.offline-character-key-recovery/v1';
const invalid = () => { throw new Error('Provide the public identity and pod shown by your existing Hallowmarch account.'); };

export function checkedPublicScope(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)
    || Object.keys(input).some(key => !['schema', 'ownerDid', 'podUrl', 'relayOrigins'].includes(key))
    || input.schema !== undefined && input.schema !== SCHEMA
    || typeof input.ownerDid !== 'string' || input.ownerDid.length > 1024
    || /[\x00-\x20\x7f]/.test(input.ownerDid)
    || !/^did:[a-z0-9]+:[^\s<>"{}|^`\\]{1,1000}$/.test(input.ownerDid)
    || typeof input.podUrl !== 'string' || input.podUrl.length > 4096) invalid();
  let pod;
  try { pod = new URL(input.podUrl); } catch { invalid(); }
  if (pod.protocol !== 'https:' || pod.href !== input.podUrl || pod.username || pod.password || pod.search || pod.hash
    || !/^\/[A-Za-z0-9_-]{1,200}\/$/.test(pod.pathname)) invalid();
  if (input.relayOrigins !== undefined && (!Array.isArray(input.relayOrigins)
    || input.relayOrigins.length !== RELAYS.length || input.relayOrigins.some((value, index) => value !== RELAYS[index]))) invalid();
  return Object.freeze({ schema: SCHEMA, ownerDid: input.ownerDid, podUrl: pod.href, relayOrigins: RELAYS });
}

export function candidateSlots(publicScope) {
  const selected = checkedPublicScope(publicScope), podName = new URL(selected.podUrl).pathname.slice(1, -1);
  return Object.freeze(selected.relayOrigins.map(relayOrigin => Object.freeze({ relayOrigin,
    scope: JSON.stringify(['interego-client-key/v1', relayOrigin, selected.ownerDid, podName]) })));
}
