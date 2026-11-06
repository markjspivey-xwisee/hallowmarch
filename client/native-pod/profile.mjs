/** Hallowmarch's private profile and discovery index both belong to its owner. */
import { createNativePodClient } from './client.mjs';
import { sameNativeHead } from './checkpoint.mjs';

const PROFILE_SCHEMA = 'hallowmarch.player-profile/v1';
const INDEX_SCHEMA = 'hallowmarch.player-profile-index/v1';
const GAME = 'urn:game:hallowmarch';
const CHECKPOINT = 'hallowmarch-character/v1';
const copy = value => JSON.parse(JSON.stringify(value));
const error = (code, message) => Object.assign(new Error(message), { code });
export function validatePlayerProfile(value, ownerDid) {
  if (!value || value.schema !== PROFILE_SCHEMA || value.ownerDid !== ownerDid
    || value.game !== GAME || !value.save || value.save.v !== 1
    || typeof value.save !== 'object' || Array.isArray(value.save)) {
    throw error('invalid_profile', 'This pod record is not your Hallowmarch character.');
  }
  return copy(value.save);
}
export function validatePlayerProfileIndex(value, ownerDid) {
  if (!value || Array.isArray(value) || value.schema !== INDEX_SCHEMA || value.ownerDid !== ownerDid
    || value.game !== GAME || Object.keys(value).some(key => !['schema', 'ownerDid', 'game', 'profileGraphIri'].includes(key))
    || typeof value.profileGraphIri !== 'string' || value.profileGraphIri.length > 1024
    || !/^urn:graph:[^\s<>"{}|^`\\]+$/.test(value.profileGraphIri)) {
    throw error('invalid_profile_index', 'This pod index is not your Hallowmarch character index.');
  }
  return value.profileGraphIri;
}
/** Stable across game origins/authorities and browser sessions, inside this owner pod. */
export async function playerProfileIndexGraphIri(ownerDid, crypto = globalThis.crypto) {
  if (typeof ownerDid !== 'string' || !ownerDid.startsWith('did:') || ownerDid.length > 1024 || !crypto?.subtle) {
    throw error('invalid_owner', 'A native owner identity and browser cryptography are required.');
  }
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(ownerDid)));
  return 'urn:graph:hallowmarch:player-profile-index:' + [...digest].map(value => value.toString(16).padStart(2, '0')).join('');
}
/** New characters are discoverable even if their first index acknowledgement is lost. */
export async function playerProfileGraphIri(ownerDid, crypto = globalThis.crypto) {
  return (await playerProfileIndexGraphIri(ownerDid, crypto)).replace(':player-profile-index:', ':player-profile:');
}

/** Neither a local cache nor a game-owned pointer is the discovery primary. */
export function createPlayerPodProfile({ binding, credential, relayUrl, request,
  pointer = null, onState = () => {}, createClient = createNativePodClient, crypto = globalThis.crypto,
  deferRelationship = false } = {}) {
  if (!binding?.subjectDid || !binding?.podUrl || typeof request !== 'function') throw new TypeError('A verified owner and game bridge are required.');
  const ownerDid = binding.subjectDid;
  const client = createClient({ relayUrl, credential, ownerDid, podUrl: binding.podUrl });
  let current = null, pending = null, pendingIndex = null, latest = null, state = 'connecting', keyPresent = false;
  let chain = Promise.resolve(), linked = !!pointer, closed = false, connected = false, readConfirmed = false;
  let relationshipDeferred = deferRelationship === true;
  let indexGraphIri = null, indexHead = null, indexSeen = false, indexVerified = false, profileGraphIri = null, defaultProfileGraphIri = null, checkpointSeen = false;
  const hasRecord = () => !!(indexSeen || checkpointSeen || current || pointer || pending || pendingIndex);
  const change = (next, detail = '') => { state = next; onState({ state, detail, keyPresent,
    hasRecord: hasRecord(), pending: !!(pending || pendingIndex) }); };
  const active = () => { if (closed) throw error('revoked', 'This identity connection is closed.'); };
  const ready = () => { active(); if (!connected) throw error('not_connected', 'Connect your identity before opening its character.'); };
  const normalizedSave = save => {
    const value = copy(save);
    // The game builds its ordinary save from registered game parts. Preserve
    // native claim provenance when a later ordinary save omits that metadata.
    // An explicit supplied value is still checked by the provisional adapter.
    if (current?.record?.save?.nativePlay && !Object.hasOwn(value, 'nativePlay')) {
      value.nativePlay = copy(current.record.save.nativePlay);
    }
    return value;
  };
  const record = save => ({ schema: PROFILE_SCHEMA, ownerDid, game: GAME,
    provenance: { authority: 'player-authored', importedProgressIsAuthoritative: false }, save: normalizedSave(save) });
  const indexRecord = () => ({ schema: INDEX_SCHEMA, ownerDid, game: GAME, profileGraphIri: current.graphIri });
  const keyRequired = () => { change('key_required'); throw error('key_required', 'Restore your recovery key to open this character.'); };
  async function probeIndex() {
    ready();
    const selected = await client.currentHead({ graphIri: indexGraphIri }); active();
    if (selected) indexSeen = true;
    // An index that was already observed cannot become permission to recreate.
    if (!selected && indexSeen) throw error('missing_profile_index', 'The existing owner index could not be found.');
    return selected;
  }
  async function readIndex() {
    const selected = await probeIndex();
    if (!selected) return null;
    if (!keyPresent) keyRequired();
    if (indexVerified && indexHead?.cid === selected.cid && indexHead?.descriptorUrl === selected.descriptorUrl) return profileGraphIri;
    const found = await client.load({ graphIri: indexGraphIri }); active();
    if (!found) throw error('missing_profile_index', 'The existing owner index could not be opened.');
    const target = validatePlayerProfileIndex(found.record, ownerDid);
    if (current && current.graphIri !== target) throw error('profile_index_conflict', 'Your owner index points to another character. Open it before saving.');
    indexHead = found.head; indexVerified = true; profileGraphIri = target;
    linked = pointer?.graphIri === target && (!current || pointer.cid === current.head.cid);
    return target;
  }
  async function connect() {
    active();
    try {
      const result = await client.connect(); active(); keyPresent = result.keyPresent; connected = true;
      indexGraphIri = await playerProfileIndexGraphIri(ownerDid, crypto); active();
      defaultProfileGraphIri = await playerProfileGraphIri(ownerDid, crypto); active();
      const selected = await probeIndex();
      if (selected) {
        if (indexHead?.cid !== selected.cid || indexHead?.descriptorUrl !== selected.descriptorUrl) indexVerified = false;
        indexHead = selected;
      }
      if (keyPresent) { await client.registerKey(); active(); }
      change(keyPresent ? 'ready' : 'key_required');
      return { ...result, hasRecord: hasRecord(), indexGraphIri };
    } catch (cause) { if (!closed) change(cause.code || 'unavailable'); throw cause; }
  }
  async function link(observed) {
    active();
    const next = { kind: 'character', graphIri: observed.graphIri,
      descriptorUrl: observed.head.descriptorUrl, cid: observed.head.cid };
    // A game may cache this relationship, but never owns private discovery.
    await request('/gaming/identity/record-link', { method: 'POST', body: next }); active();
    pointer = next; linked = true;
  }
  function acceptedProfile(result) {
    active();
    if (!result?.saved) {
      if (result?.status === 'conflict') { pending = null; throw error('conflict', 'The native character has competing versions.'); }
      pending = result?.operationId ? result : pending;
      change(result?.status || 'uncertain');
      if (result?.reason === 'guest_quota_exhausted') throw error('guest_quota_exhausted', 'The provisional pod save allowance is full. Keep the last confirmed character with your identity to continue.');
      throw error('pod_pending', 'Your pod has not confirmed this save yet.');
    }
    validatePlayerProfile(result.record, ownerDid);
    if (profileGraphIri && result.graphIri !== profileGraphIri) throw error('profile_index_conflict', 'The character differs from your owner index.');
    current = result; pending = null; readConfirmed = true;
    linked = pointer?.graphIri === current.graphIri && pointer?.cid === current.head.cid;
    if (latest && JSON.stringify(latest) === JSON.stringify(result.record.save)) latest = null;
  }
  function acceptedIndex(result) {
    active();
    if (!result?.saved) {
      if (result?.status === 'conflict') { pendingIndex = null; throw error('profile_index_conflict', 'The owner index has competing versions.'); }
      pendingIndex = result?.operationId ? result : pendingIndex;
      change('index_pending');
      throw error('pod_index_pending', 'The character is private in your pod; its owner index is not confirmed yet.');
    }
    if (result.graphIri !== indexGraphIri || validatePlayerProfileIndex(result.record, ownerDid) !== current.graphIri) {
      throw error('profile_index_conflict', 'The confirmed owner index points to another character.');
    }
    pendingIndex = null; indexHead = result.head; indexSeen = true; indexVerified = true; profileGraphIri = current.graphIri;
  }
  async function ensureIndexed() {
    if (pendingIndex) acceptedIndex(await client.confirm(pendingIndex.operationId));
    const target = await readIndex();
    if (target) {
      if (target !== current.graphIri) throw error('profile_index_conflict', 'Your owner index points to another character.');
      return;
    }
    // A stable named graph has no atomic compare-with-absence primitive. Keep
    // the original profile and pending operation, never create another profile
    // on index failure, and let native readback reject concurrent index forks.
    change('index_pending');
    acceptedIndex(await client.createAt({ graphIri: indexGraphIri, record: indexRecord() }));
  }
  async function finishRelationship() {
    // A provisional-to-owner claim confirms the private owner-pod copy before
    // the game changes its participation session. Linking it through the old
    // guest session would confuse the two owners. The claim host explicitly
    // enables the normal relationship only after its own admission readback.
    if (relationshipDeferred) { change('private_saved'); return; }
    try { if (!linked) await link(current); }
    catch (cause) {
      active(); linked = false; change('link_pending');
      throw error('pod_link_pending', 'Your character and owner index are saved in your pod; its game link is pending.');
    }
    change('saved');
  }
  async function read() {
    ready();
    try {
      if (pending) throw error('pod_pending', 'Confirm the outstanding private save before opening it.');
      const indexedTarget = await readIndex();
      if (pendingIndex) await ensureIndexed();
      const knownTarget = indexedTarget || profileGraphIri || current?.graphIri || pointer?.graphIri;
      const target = knownTarget || defaultProfileGraphIri;
      if (knownTarget && !keyPresent) keyRequired();
      const found = await client.load({ graphIri: target, checkpoint: CHECKPOINT }); active();
      if (!found && !knownTarget) { readConfirmed = true; return { exists: false, data: () => null }; }
      if (!found) throw error('missing_record', 'The private character could not be found in your pod.');
      checkpointSeen = true;
      const save = validatePlayerProfile(found.record, ownerDid);
      current = found; readConfirmed = true;
      // A legacy game hint can seed the owner index only after native private
      // readback verifies its owner/schema/game. An unread index always wins.
      await ensureIndexed(); active();
      linked = pointer?.graphIri === target && pointer?.cid === found.head.cid;
      change(linked ? 'ready' : relationshipDeferred ? 'private_ready' : 'link_pending');
      return { exists: true, data: () => copy(save) };
    } catch (cause) {
      if (cause.code === 'checkpoint_binding_pending') {
        checkpointSeen = true; pending = { operationId: cause.operationId, graphIri: cause.graphIri, checkpointBinding: true };
        change('pod_pending'); throw error('pod_pending', 'Reconcile the original private character binding before saving again.');
      }
      if (cause.code === 'key_required') checkpointSeen = true;
      if (!closed && !['pod_pending', 'pod_index_pending'].includes(cause.code)) change(cause.code || 'unavailable'); throw cause;
    }
  }
  async function persist(reconcileBinding = false) {
    ready();
    try {
      if (!keyPresent) keyRequired();
      if (pending) {
        let result = await client.confirm(pending.operationId);
        if (!result.saved && reconcileBinding && pending.checkpointBinding) result = await client.reconcileCheckpoint({ graphIri: pending.graphIri, checkpoint: CHECKPOINT });
        acceptedProfile(result);
      }
      if (current) await ensureIndexed();
      // A caller can resubmit the same progress while the index acknowledgement
      // is pending. Confirmation must not turn that retry into another version.
      if (current && latest && JSON.stringify(latest) === JSON.stringify(current.record.save)) latest = null;
      if (!latest) { if (current) await finishRelationship(); return; }
      if ((indexSeen || pointer) && !current) throw error('unread_record', 'Open the existing private character before changing it.');
      // Recheck the owner index immediately before first creation. It is never
      // replaced by a local/game hint or overwritten without being read.
      if (!current && await readIndex()) throw error('unread_record', 'Open the existing private character before changing it.');
      const save = latest; change('saving');
      acceptedProfile(current
        ? await client.save({ graphIri: current.graphIri, expectedHead: current.head, record: record(save), checkpoint: CHECKPOINT })
        : await client.create({ graphIri: defaultProfileGraphIri, record: record(save), checkpoint: CHECKPOINT }));
      await ensureIndexed();
      await finishRelationship();
    } catch (cause) {
      if (cause.code === 'checkpoint_binding_pending') {
        checkpointSeen = true; pending = { operationId: cause.operationId, graphIri: cause.graphIri, checkpointBinding: true };
        change('pod_pending'); throw error('pod_pending', 'Reconcile the original private character binding before saving again.');
      }
      if (!closed && !['pod_pending', 'pod_index_pending', 'pod_link_pending'].includes(cause.code)) change(cause.code || 'unavailable'); throw cause;
    }
  }
  function serialized(run) { const next = chain.then(run); chain = next.catch(() => {}); return next; }
  function reference() {
    active();
    if (!current || !readConfirmed || !indexVerified || pending || pendingIndex) return null;
    return copy({ kind: 'character', graphIri: current.graphIri,
      descriptorUrl: current.head.descriptorUrl, cid: current.head.cid,
      ...(current.head.nativeRevision ? { bindingCid: current.head.bindingCid || current.head.cid,
        nativeRevision: current.head.nativeRevision, recordCid: current.head.recordCid,
        proofKind: current.head.proofKind, digest: current.digest } : {}) });
  }
  return Object.freeze({ connect, get: () => serialized(read), native: true,
    reference,
    deferRelationship() { return serialized(async () => { ready(); relationshipDeferred = true; }); },
    confirmRelationship() { return serialized(async () => {
      ready();
      if (!reference()) throw error('unread_record', 'Confirm the private character before linking it to the game.');
      relationshipDeferred = false;
      await finishRelationship();
      return reference();
    }); },
    reauthenticate({ credential } = {}) { return serialized(async () => {
      active();
      if (!readConfirmed && !current && !pending) throw error('unread_record', 'Open this private character before resuming it.');
      try {
        const result = await client.reauthenticate({ credential }); active();
        connected = true; keyPresent = result.keyPresent;
        if (!keyPresent) keyRequired();
        // Preserve the exact original operation receipts, including a profile
        // committed before its owner-index acknowledgement was lost.
        if (pending) acceptedProfile(await client.confirm(pending.operationId));
        if (pendingIndex) acceptedIndex(await client.confirm(pendingIndex.operationId));
        const selected = await client.currentHead({ graphIri: indexGraphIri }); active();
        if (indexSeen && !selected) throw error('missing_profile_index', 'The original owner index could not be confirmed.');
        if (selected) {
          if (!indexHead || selected.cid !== indexHead.cid || selected.descriptorUrl !== indexHead.descriptorUrl) {
            throw error('profile_index_conflict', 'The owner index changed while reconnecting. Your progress remains in this game.');
          }
          const foundIndex = await client.load({ graphIri: indexGraphIri }); active();
          if (!foundIndex || foundIndex.head.cid !== indexHead.cid || foundIndex.head.descriptorUrl !== indexHead.descriptorUrl
            || validatePlayerProfileIndex(foundIndex.record, ownerDid) !== (current?.graphIri || profileGraphIri)) {
            throw error('profile_index_conflict', 'The owner index points to another character.');
          }
        }
        if (current) {
          const found = await client.load({ graphIri: current.graphIri, checkpoint: CHECKPOINT }); active();
          if (!found || !sameNativeHead(found.head, current.head)) {
            throw error('conflict', 'The private character changed elsewhere. Your progress remains in this game.');
          }
          validatePlayerProfile(found.record, ownerDid);
        } else if (pointer || profileGraphIri || selected) throw error('unread_record', 'The existing private character has not been read.');
        change('ready'); return { keyPresent, readConfirmed: true, hasRecord: hasRecord() };
      } catch (cause) { if (!closed) change(cause.code || 'unavailable'); throw cause; }
    }); },
    set(save) { latest = validatePlayerProfile(record(save), ownerDid); return serialized(persist); },
    retry() { return serialized(() => persist(true)); },
    createKey() { return serialized(async () => {
      ready(); await probeIndex();
      if (!hasRecord()) {
        try { if (await client.currentHead({ graphIri: defaultProfileGraphIri, checkpoint: CHECKPOINT })) checkpointSeen = true; }
        catch (cause) { if (['key_required', 'checkpoint_binding_pending'].includes(cause.code)) checkpointSeen = true; else throw cause; }
      }
      if (hasRecord()) throw error('recovery_required', 'Restore the existing character key instead of replacing it.');
      if (keyPresent) throw error('key_exists', 'This browser already holds a character key.');
      await client.createKey(); active(); keyPresent = true; change('ready');
    }); },
    restoreRecovery(file, passphrase) { return serialized(async () => {
      ready(); await client.restoreRecovery(file, passphrase); active(); keyPresent = true; change('ready');
    }); },
    exportRecovery: passphrase => { ready(); return client.exportRecovery(passphrase); },
    status: () => ({ state, keyPresent, hasRecord: hasRecord(), pending: !!(pending || pendingIndex), linked,
      indexed: indexVerified, indexGraphIri, profileGraphIri: profileGraphIri || current?.graphIri || null }),
    // Reset is another private version, not deletion of the owner's history.
    delete() { return this.set({ v: 1, char: null, resetAt: Date.now() }); },
    close() { closed = true; client.close(); change('closed'); },
  });
}

