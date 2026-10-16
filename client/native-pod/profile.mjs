/** Hallowmarch's private profile composes the owner-side native record port. */
import { createNativePodClient } from './client.mjs';

const PROFILE_SCHEMA = 'hallowmarch.player-profile/v1';
const copy = value => JSON.parse(JSON.stringify(value));
export function validatePlayerProfile(value, ownerDid) {
  if (!value || value.schema !== PROFILE_SCHEMA || value.ownerDid !== ownerDid
    || value.game !== 'urn:game:hallowmarch' || !value.save || value.save.v !== 1
    || typeof value.save !== 'object' || Array.isArray(value.save)) {
    throw Object.assign(new Error('This pod record is not your Hallowmarch character.'), { code: 'invalid_profile' });
  }
  return copy(value.save);
}

/** Neither a local cache nor the game server is an acknowledged save primary. */
export function createPlayerPodProfile({ binding, credential, relayUrl, request,
  pointer = null, onState = () => {}, createClient = createNativePodClient } = {}) {
  if (!binding?.subjectDid || !binding?.podUrl || typeof request !== 'function') throw new TypeError('A verified owner and game bridge are required.');
  const ownerDid = binding.subjectDid;
  const client = createClient({ relayUrl, credential, ownerDid, podUrl: binding.podUrl });
  let current = null, pending = null, latest = null, state = 'connecting', keyPresent = false;
  let chain = Promise.resolve(), linked = !!pointer, closed = false;
  const change = (next, detail = '') => { state = next; onState({ state, detail, keyPresent, hasRecord: !!(current || pointer), pending: !!pending }); };
  const error = (code, message) => Object.assign(new Error(message), { code });
  const record = save => ({ schema: PROFILE_SCHEMA, ownerDid, game: 'urn:game:hallowmarch',
    provenance: { authority: 'player-authored', importedProgressIsAuthoritative: false }, save: copy(save) });
  async function connect() {
    try {
      const result = await client.connect(); keyPresent = result.keyPresent;
      if (keyPresent) await client.registerKey();
      change(keyPresent ? 'ready' : 'key_required');
      return result;
    } catch (cause) { if (!closed) change(cause.code || 'unavailable'); throw cause; }
  }
  async function link(observed) {
    if (closed) throw error('revoked', 'This identity connection is closed.');
    const next = { kind: 'character', graphIri: observed.graphIri,
      descriptorUrl: observed.head.descriptorUrl, cid: observed.head.cid };
    // Relationship metadata only. No save body or decryption key is sent here.
    await request('/gaming/identity/record-link', { method: 'POST', body: next });
    if (closed) throw error('revoked', 'This identity connection is closed.');
    pointer = next; linked = true;
  }
  async function accepted(result) {
    if (closed) throw error('revoked', 'This identity connection is closed.');
    if (!result?.saved) {
      pending = result?.operationId ? result : pending;
      change(result?.status || 'uncertain');
      throw error('pod_pending', 'Your pod has not confirmed this save yet.');
    }
    validatePlayerProfile(result.record, ownerDid);
    current = result; pending = null;
    if (latest && JSON.stringify(latest) === JSON.stringify(result.record.save)) latest = null;
    try { await link(result); }
    catch (cause) {
      if (closed) throw error('revoked', 'This identity connection is closed.');
      linked = false; change('link_pending'); throw error('pod_link_pending', 'The private save is in your pod; its game link is still pending.');
    }
    change('saved'); return result;
  }
  async function get() {
    if (closed) throw error('revoked', 'This identity connection is closed.');
    if (!pointer && current) {
      const saved = validatePlayerProfile(current.record, ownerDid);
      return { exists: true, data: () => copy(saved) };
    }
    if (!pointer) return { exists: false, data: () => null };
    if (!keyPresent) { change('key_required'); throw error('key_required', 'Restore your recovery key to open this character.'); }
    try {
      const found = await client.load({ graphIri: pointer.graphIri });
      if (closed) throw error('revoked', 'This identity connection is closed.');
      if (!found) throw error('missing_record', 'The linked private character could not be found.');
      const save = validatePlayerProfile(found.record, ownerDid);
      current = found; change('ready'); return { exists: true, data: () => copy(save) };
    } catch (cause) { if (!closed) change(cause.code || 'unavailable'); throw cause; }
  }
  async function persist() {
    if (closed) throw error('revoked', 'This identity connection is closed.');
    if (!keyPresent) { change('key_required'); throw error('key_required', 'Protect this character with a recovery key before saving to your pod.'); }
    if (pending) await accepted(await client.confirm(pending.operationId));
    if (current && !linked) { await link(current); change('saved'); }
    if (!latest) return;
    if (pointer && !current) throw error('unread_record', 'Open the existing private character before changing it.');
    const save = latest; change('saving');
    const result = current
      ? await client.save({ graphIri: current.graphIri, expectedHead: current.head, record: record(save) })
      : await client.create({ record: record(save) });
    await accepted(result);
    if (latest === save) latest = null;
  }
  function serialized(run) { const next = chain.then(run); chain = next.catch(() => {}); return next; }
  return Object.freeze({ connect, get, native: true,
    set(save) { validatePlayerProfile(record(save), ownerDid); latest = copy(save); return serialized(persist); },
    retry() { return serialized(persist); },
    async createKey() {
      if (pointer || current) throw error('recovery_required', 'Restore the existing character key instead of replacing it.');
      await client.createKey(); keyPresent = true; change('ready');
    },
    async restoreRecovery(file, passphrase) { await client.restoreRecovery(file, passphrase); keyPresent = true; change('ready'); },
    exportRecovery: passphrase => client.exportRecovery(passphrase),
    status: () => ({ state, keyPresent, hasRecord: !!(pointer || current), pending: !!pending, linked }),
    // Reset is another private version, not deletion of the pod's history.
    delete() { return this.set({ v: 1, char: null, resetAt: Date.now() }); },
    close() { closed = true; client.close(); change('closed'); },
  });
}
