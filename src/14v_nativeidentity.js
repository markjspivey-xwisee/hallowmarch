/* Owner identity and private character saves, composed through native ports. */
const NATIVE_PLAYER = { status: null, profile: null, cache: null, module: null, state: 'idle', message: '', busy: false, channel: null, authRefusal: null, switching: false };
const nativePlayerError = (code, message) => Object.assign(new Error(message), { code });
async function nativePlayerRequest(url, { method = 'GET', body, timeoutMs = 18000, token = NETWS.token } = {}) {
  if (!token) throw nativePlayerError('account_required', 'Connect to the March before signing in.');
  const response = await fetch(url, { method, credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(timeoutMs),
    headers: { Authorization: 'Bearer ' + token, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}) });
  if (!response.ok) {
    let code = 'unavailable'; try { code = (await response.json()).error || code; } catch (e) { /* response may be unavailable */ }
    throw Object.assign(nativePlayerError(response.status === 404 ? 'not_available' : code, 'The identity service could not confirm this request. Try again.'), { httpStatus: response.status });
  }
  return response.json();
}
async function nativePlayerModules() {
  if (!NATIVE_PLAYER.module) NATIVE_PLAYER.module = Promise.all([
    import('/gaming/identity/assets/profile.mjs'), import('/gaming/identity/assets/access-cache.mjs'),
  ]).then(([profile, access]) => { NATIVE_PLAYER.cache = access.createBrowserAccessCache(); return profile; });
  return NATIVE_PLAYER.module;
}
function nativePlayerChanged(info) {
  NATIVE_PLAYER.state = info.state;
  nativePlayerRender();
}
async function nativePlayerSaveRef(initialization = { active: true }) {
  const server = netServerUrl();
  if (!server) return null;
  // Ownership is unknown until the linked server's public policy and account
  // status have been read. Never select another browser character meanwhile.
  SAVE.native = true; SAVE.lsKey = 'hallowmarch.native.unconfirmed';
  NATIVE_PLAYER.status = { enabled: true, bound: false, verified: false, recordLinks: {} };
  NATIVE_PLAYER.state = 'identity_unconfirmed';
  const active = () => initialization.active;
  const blocked = { native: true, blocked: true,
    get: async () => { throw nativePlayerError('native_signin_required', 'Connect your identity to open this private character.'); },
    set: async () => { throw nativePlayerError('native_signin_required', 'Reconnect your identity to save this character.'); },
    delete: async () => { throw nativePlayerError('native_signin_required', 'Reconnect your identity before changing this character.'); } };
  try {
    const url = new URL(server); url.protocol = url.protocol === 'wss:' ? 'https:' : 'http:';
    url.pathname = '/gaming/manifest'; url.search = ''; url.hash = '';
    const response = await fetch(url.href, { credentials: 'omit', cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(18000) });
    let legacy = response.status === 404;
    if (!legacy) {
      if (!response.ok) throw nativePlayerError('identity_unconfirmed', 'The game could not confirm its identity service.');
      const manifest = await response.json();
      if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) throw nativePlayerError('identity_unconfirmed', 'The game identity contract is unreadable.');
      legacy = !Object.hasOwn(manifest, 'playerIdentity');
    }
    if (!active()) return null;
    // Once the bounded boot wait exposed a native-blocked title, a late
    // legacy response cannot downgrade its storage policy or select a local
    // character. An explicit new title retry must confirm that policy afresh.
    if (legacy && initialization.timedOut) return blocked;
    if (legacy) {
      SAVE.native = false; SAVE.lsKey = 'hallowmarch.save.v1';
      NATIVE_PLAYER.status = null; NATIVE_PLAYER.state = 'idle';
      return null;
    }
  } catch (error) { return active() ? blocked : null; }
  if (!await netLinkWS()) return active() ? blocked : null;
  if (!active()) return null;
  const owner = NETWS.acct?.id, host = NETWS.host;
  initialization.owner = owner; initialization.host = host;
  let status;
  try { status = await nativePlayerRequest('/gaming/identity/status'); }
  catch (error) { return active() ? blocked : null; }
  if (!active()) return null;
  if (!owner || NETWS.acct?.id !== owner || NETWS.host !== host || (status.account?.id && status.account.id !== owner)) return blocked;
  NATIVE_PLAYER.status = { ...status, enabled: true };
  if (!status.enabled || !status.bound || !status.verified || !status.binding) {
    NATIVE_PLAYER.state = status.enabled && !status.bound ? 'native_identity_required' : 'native_signin_required';
    return blocked;
  }
  SAVE.lsKey = 'hallowmarch.native.' + owner;
  try {
    const module = await nativePlayerModules();
    const matches = await NATIVE_PLAYER.cache.list({});
    const match = matches.find(item => item.ownerDid === status.binding.subjectDid && item.podUrl === status.binding.podUrl);
    const cached = match && await NATIVE_PLAYER.cache.get(match);
    if (!active()) return null;
    if (!cached) { NATIVE_PLAYER.state = 'native_signin_required'; return blocked; }
    // The cache API returns the access credential; no native bearer goes to request().
    const credential = cached.credential || cached;
    const profile = module.createPlayerPodProfile({ binding: status.binding, credential, relayUrl: match.relayUrl,
      request: nativePlayerRequest, pointer: status.recordLinks?.character || null,
      onState: info => { if (NATIVE_PLAYER.profile === profile && NETWS.acct?.id === owner && NETWS.host === host && !NETWS.reload) nativePlayerChanged(info); } });
    NATIVE_PLAYER.profile = profile;
    const owned = () => {
      if (NETWS.acct?.id !== owner || NETWS.host !== host || NETWS.reload) {
        profile.close(); throw nativePlayerError('revoked', 'This character belongs to the previous identity connection. Reconnect before continuing.');
      }
    };
    let opening;
    return { native: true,
      get: async () => {
        owned();
        if (!opening) opening = profile.connect().catch(error => { opening = null; throw error; });
        await opening; owned(); const result = await profile.get(); owned(); return result;
      },
      set: async save => { owned(); await profile.set(save); owned(); },
      delete: async () => { owned(); await profile.delete(); owned(); } };
  } catch (error) { if (!active()) return null; NATIVE_PLAYER.state = error.code || 'unavailable'; return blocked; }
}
function nativePlayerSaveMessage() {
  if (!SAVE.native) return SAVE.backend === 'db' ? 'Progress saves automatically to your game account.' : 'Progress saves automatically in this browser.';
  if (SAVE.loading && !SAVE.loading.settled) return 'Opening your private character from your pod… Keep this game open while it is confirmed.';
  if (!SAVE.readConfirmed && !['key_required', 'native_identity_required', 'native_signin_required'].includes(NATIVE_PLAYER.state)) return 'Your private character is not confirmed. Retry the connection before choosing a character.';
  if (NATIVE_PLAYER.state === 'saved') return 'Private character saved and verified in your pod.';
  if (NATIVE_PLAYER.state === 'saving') return 'Saving your private character to your pod…';
  if (['pending', 'uncertain', 'link_pending', 'index_pending', 'pod_pending', 'pod_link_pending', 'pod_index_pending'].includes(NATIVE_PLAYER.state)) return 'Pod confirmation is pending. Keep this game open and retry.';
  if (NATIVE_PLAYER.state === 'key_required') return NATIVE_PLAYER.profile?.status().hasRecord || NATIVE_PLAYER.status?.recordLinks?.character
    ? 'Restore your recovery file to open this private character.' : 'Protect your character with a recovery file to start saving in your pod.';
  if (NATIVE_PLAYER.state === 'ready') return 'Private character saves go to your pod.';
  return 'Connect your identity to open and save your private character.';
}
function nativePlayerRender() {
  const status = NATIVE_PLAYER.status;
  for (const target of [document.querySelector('#create .card-body'), $('netsheet-acct')]) {
    if (!target || !status?.enabled) continue;
    let box = target.querySelector('.native-player');
    if (!box) {
      box = document.createElement('section'); box.className = 'native-player';
      if (target.classList.contains('card-body')) target.prepend(box); else target.appendChild(box);
    }
    const renderKey = JSON.stringify([NETWS.acct?.id, status.bound, SAVE.readConfirmed, !!SAVE.loaded, SAVE.loading?.settled, NATIVE_PLAYER.state, NATIVE_PLAYER.busy, NATIVE_PLAYER.switching, NATIVE_PLAYER.message, NATIVE_PLAYER.profile?.status(), nativePlayerFreshAllowed()]);
    if (box._nativeKey === renderKey) continue;
    box._nativeKey = renderKey;
    const sameOwner = box._nativeOwner === NETWS.acct?.id;
    const typedPassphrase = sameOwner ? box.querySelector('input[type="password"]')?.value || '' : '';
    box._nativeOwner = NETWS.acct?.id;
    box.replaceChildren();
    const add = (tag, text) => { const node = document.createElement(tag); node.textContent = text; box.appendChild(node); return node; };
    add('h3', 'Your identity and character');
    add('p', status.bound ? nativePlayerSaveMessage() : 'Connect your Interego identity to keep a private character in your own pod.');
    const action = (label, run) => {
      const b = add('button', label); b.type = 'button'; b.className = 'btn'; b.disabled = NATIVE_PLAYER.busy;
      b.style.minHeight = '44px'; b.style.margin = '4px'; b.style.touchAction = 'manipulation';
      b.onclick = () => run(); return b;
    };
    action(status.bound ? 'Reconnect identity' : 'Connect identity', nativePlayerConnect);
    if (target.classList.contains('card-body') && nativePlayerFreshAllowed()) action(
      NATIVE_PLAYER.authRefusal.reason === 'native_owner_mismatch' ? 'Sign in with a different account' : 'Start a fresh sign-in', () => nativePlayerConnect(true));
    if (SAVE.native && !SAVE.readConfirmed && !GAME.started && !NATIVE_PLAYER.switching) action('Retry connection', () => nativePlayerTask(nativePlayerRetryLoad));
    const profile = NATIVE_PLAYER.switching ? null : NATIVE_PLAYER.profile;
    if (profile) {
      const pass = document.createElement('input'); pass.type = 'password'; pass.autocomplete = 'new-password';
      pass.value = typedPassphrase;
      pass.placeholder = 'Recovery passphrase (12+ characters)'; pass.setAttribute('aria-label', 'Recovery file passphrase');
      pass.style.cssText = 'display:block;width:100%;box-sizing:border-box;min-height:44px;max-width:28rem;font-size:16px'; box.appendChild(pass);
      if (!profile.status().hasRecord || profile.status().keyPresent) action(profile.status().keyPresent ? 'Download recovery file' : 'Protect character', () => nativePlayerRecovery(pass.value));
      const file = document.createElement('input'); file.type = 'file'; file.accept = '.json,application/json'; file.hidden = true;
      file.setAttribute('aria-label', 'Choose encrypted recovery file'); box.appendChild(file);
      action('Restore recovery file', () => file.click());
      file.onchange = () => { if (file.files[0]) nativePlayerRestore(file.files[0], pass.value); };
      action('Retry pod save', () => nativePlayerTask(async () => {
        if (!GAME.started && !SAVE.readConfirmed) {
          if (profile.status().pending) await profile.retry();
          await nativePlayerRetryLoad(); return;
        }
        await profile.retry(); if (SAVE.pending) await saveNow();
      }));
      if (!profile.status().hasRecord && status.legacyImportAvailable) action('Import my previous character', nativePlayerImport);
    }
    if (NATIVE_PLAYER.message) { const p = add('p', NATIVE_PLAYER.message); p.setAttribute('role', 'status'); }
  }
  if ($('save-note')) $('save-note').textContent = nativePlayerSaveMessage();
  // The owner index may reveal a record without any game-server pointer. Only
  // an actual private read (or confirmed absence) and held key permit entry.
  const profileStatus = NATIVE_PLAYER.profile?.status();
  const blocked = NATIVE_PLAYER.switching || (SAVE.native && (!status?.verified || !SAVE.readConfirmed || !profileStatus?.keyPresent || (profileStatus.hasRecord && !SAVE.loaded)));
  for (const id of ['btn-begin', 'btn-continue']) if ($(id)) $(id).disabled = !!blocked;
}
async function nativePlayerRetryLoad() {
  if (GAME.started || SAVE.pending || SAVE.nativeFlight || NATIVE_PLAYER.switching) return;
  await loadSave({ retry: true });
  nativePlayerRender();
}
async function nativePlayerTask(run) {
  if (NATIVE_PLAYER.busy) return;
  NATIVE_PLAYER.busy = true; NATIVE_PLAYER.message = ''; nativePlayerRender();
  try { await run(); }
  catch (error) { NATIVE_PLAYER.message = error.message || 'Your pod did not confirm the operation. Try again.'; }
  finally { NATIVE_PLAYER.busy = false; nativePlayerRender(); }
}
function nativePlayerSwitchIdle() {
  return !GAME.started && !SAVE.pending && !SAVE.nativeFlight && !SAVE.wiping && !NATIVE_PLAYER.profile?.status().pending
    && (!SAVE.loading || SAVE.loading.settled);
}
function nativePlayerFreshAllowed() {
  return nativePlayerSwitchIdle() && !!NATIVE_PLAYER.authRefusal && NATIVE_PLAYER.authRefusal.host === NETWS.host;
}
function nativePlayerConnect(fresh = false) {
  if (NATIVE_PLAYER.busy) return;
  if (fresh && !nativePlayerFreshAllowed()) {
    NATIVE_PLAYER.message = 'Keep the current character open. Reconnect its original identity without replacing the session.'; nativePlayerRender(); return;
  }
  const expected = GAME.started ? { accountId: NETWS.acct?.id, ownerDid: NATIVE_PLAYER.status?.binding?.subjectDid,
    podUrl: NATIVE_PLAYER.status?.binding?.podUrl, host: NETWS.host, profile: NATIVE_PLAYER.profile } : null;
  if (expected && (!expected.accountId || !expected.ownerDid || !expected.podUrl || !expected.profile || !SAVE.readConfirmed)) {
    NATIVE_PLAYER.message = 'Your current character is still in memory. Confirm its original identity before reconnecting.'; nativePlayerRender(); return;
  }
  const popup = window.open('about:blank', 'hallowmarch-identity', 'popup,width=520,height=760');
  if (!popup) { NATIVE_PLAYER.message = 'Allow this sign-in window, then connect again.'; nativePlayerRender(); return; }
  let starting;
  starting = nativePlayerTask(async () => {
    const host = NETWS.host;
    if (fresh) {
      try {
        if (!nativePlayerFreshAllowed()) throw new Error('Keep the current character open. Its session cannot be replaced.');
        NATIVE_PLAYER.switching = true; SAVE.readConfirmed = false; nativePlayerRender();
        await netWsTokenForget(host, NATIVE_PLAYER.authRefusal.token, nativePlayerFreshAllowed);
        if (!nativePlayerFreshAllowed()) throw new Error('Keep the current character open. Its session cannot be replaced.');
        SAVE.readConfirmed = false;
        NATIVE_PLAYER.authRefusal = null;
        if (NETWS.link) NETWS.link.close();
        else if (NETWS.ws) netWsRetire(NETWS.ws, 'explicit title sign-in');
        NETWS.token = ''; NETWS.acct = null;
        if (!await netLinkWS() || !nativePlayerSwitchIdle()) throw new Error('The fresh game session is unavailable. Retry the connection.');
      } catch (error) { popup.close(); throw error; }
    }
    // A refused expired session has no welcome account or active token. Its
    // stored opaque proof may still authorize the server's bounded sign-in
    // ceremony, but must never become a multiplayer session by itself.
    const token = NETWS.token || (!GAME.started && host ? await netWsToken(host) : '');
    if (typeof token !== 'string' || !token || NETWS.host !== host || (GAME.started && !expected)) {
      popup.close(); throw nativePlayerError('account_required', 'The previous game session could not be confirmed. Retry the connection.');
    }
    const channelName = 'hallowmarch-owner-' + crypto.randomUUID();
    const ceremony = { channel: channelName, token, host, expiresAt: Date.now() + 10 * 60 * 1000,
      ...(expected ? { expectedAccountId: expected.accountId, expectedOwnerDid: expected.ownerDid, expectedPodUrl: expected.podUrl } : {}) };
    popup.sessionStorage.setItem('hallowmarch.identity.ceremony.v1', JSON.stringify(ceremony));
    NATIVE_PLAYER.channel?.close();
    const channel = NATIVE_PLAYER.channel = new BroadcastChannel(channelName);
    channel.onmessage = event => {
      if (event.data?.type === 'hallowmarch-native-failed') {
        if (NATIVE_PLAYER.channel !== channel || NETWS.host !== host || Date.now() > ceremony.expiresAt
          || (NETWS.token && NETWS.token !== token) || event.data.host !== host
          || !/^[A-Za-z0-9_-]{43}$/.test(ceremony.browserCeremony || '')
          || event.data.browserCeremony !== ceremony.browserCeremony
          || !['native_owner_mismatch', 'identity_authorization_declined', 'identity_connection_failed'].includes(event.data.error)) return;
        channel.close(); NATIVE_PLAYER.channel = null;
        const canSwitch = !expected && nativePlayerSwitchIdle();
        NATIVE_PLAYER.authRefusal = event.data.error === 'native_owner_mismatch' && canSwitch
          ? { host, token, reason: 'native_owner_mismatch' } : null;
        NATIVE_PLAYER.message = event.data.error === 'native_owner_mismatch'
          ? canSwitch ? 'This sign-in belongs to a different account. Reconnect the original identity, or choose “Sign in with a different account” to open the selected identity’s own character.'
            : 'This sign-in belongs to a different account. Reconnect this character’s original identity. Your current progress remains in this game.'
          : event.data.error === 'identity_authorization_declined' ? 'Sign-in was cancelled. Your current character has not been switched.'
            : 'The identity connection could not be confirmed. Your current character has not been switched. Try connecting again.';
        nativePlayerRender(); return;
      }
      if (event.data?.type !== 'hallowmarch-native-connected') return;
      channel.close(); NATIVE_PLAYER.channel = null;
      if (!GAME.started) { NETWS.reload = true; location.reload(); return; }
      void Promise.resolve(starting).then(() => nativePlayerTask(() => nativePlayerReconnect(expected, event.data)));
    };
    try {
      const result = await nativePlayerRequest('/gaming/identity/start', { method: 'POST', token, body: { ownerPodWriteAccess: true } });
      if (/^[A-Za-z0-9_-]{43}$/.test(result.browserCeremony || '')) {
        ceremony.browserCeremony = result.browserCeremony;
        const pendingCeremony = JSON.parse(popup.sessionStorage.getItem('hallowmarch.identity.ceremony.v1') || 'null');
        popup.sessionStorage.setItem('hallowmarch.identity.ceremony.v1', JSON.stringify({ ...pendingCeremony, browserCeremony: result.browserCeremony }));
      }
      NATIVE_PLAYER.authRefusal = null;
      popup.location.replace(result.authorizationUrl);
      NATIVE_PLAYER.message = 'Complete sign-in in the identity window, then return here.';
    } catch (error) {
      if (error.httpStatus === 401 && error.code === 'game_account_required' && !GAME.started && !SAVE.pending && !SAVE.nativeFlight && !NATIVE_PLAYER.profile?.status().pending) {
        NATIVE_PLAYER.authRefusal = { host, token };
        error.message = 'The previous game session has expired or was refused. Start a fresh sign-in, then choose your existing identity.';
      }
      popup.close(); channel.close(); throw error;
    }
  });
}
async function nativePlayerReconnect(expected, notification) {
  const sameSession = () => expected && GAME.started && NETWS.acct?.id === expected.accountId && NETWS.host === expected.host
    && NATIVE_PLAYER.profile === expected.profile && NATIVE_PLAYER.status?.binding?.subjectDid === expected.ownerDid
    && NATIVE_PLAYER.status?.binding?.podUrl === expected.podUrl && !NETWS.reload;
  SAVE.nativePaused = true;
  if (!sameSession() || notification.accountId !== expected.accountId) throw nativePlayerError('owner_mismatch', 'Reconnect the original identity. Your current progress remains in this game.');
  const token = localStorage.getItem('hallowmarch.token.' + expected.host);
  if (!token) throw nativePlayerError('account_required', 'The new game session is not available. Your progress remains in memory.');
  const status = await nativePlayerRequest('/gaming/identity/status', { token });
  if (!sameSession() || status.enabled !== true || status.verified !== true || status.bound !== true
    || status.account?.id !== expected.accountId || status.binding?.subjectDid !== expected.ownerDid || status.binding?.podUrl !== expected.podUrl) {
    throw nativePlayerError('owner_mismatch', 'The new connection belongs to another identity. Your current progress has not been moved.');
  }
  await nativePlayerModules();
  const matches = (await NATIVE_PLAYER.cache.list({})).filter(item => item.ownerDid === expected.ownerDid && item.podUrl === expected.podUrl);
  if (matches.length !== 1) throw nativePlayerError('native_signin_required', 'Reconnect the original identity before saving this character.');
  const cached = await NATIVE_PLAYER.cache.get(matches[0]);
  if (!sameSession() || !cached?.credential) throw nativePlayerError('native_signin_required', 'The refreshed identity grant is unavailable. Your progress remains in memory.');
  // Let the one active save settle. Pending operation IDs remain inside this
  // same profile and must be confirmed against its original native CAS head.
  if (!await withTimeout(SAVE.chain.then(() => true), 45000)) throw nativePlayerError('pod_pending', 'A save is still awaiting confirmation. Keep this game open and retry.');
  if (!sameSession() || typeof expected.profile.reauthenticate !== 'function') throw nativePlayerError('native_signin_required', 'This character connection cannot be resumed safely. Keep this game open.');
  await expected.profile.reauthenticate({ credential: cached.credential });
  if (!sameSession()) throw nativePlayerError('owner_mismatch', 'The game identity changed while reconnecting. Your progress remains in memory.');
  NETWS.token = token;
  if (NETWS.ws) netWsRetire(NETWS.ws, 'identity refreshed');
  if (!await netLinkWS() || NETWS.acct?.id !== expected.accountId || NETWS.host !== expected.host) {
    if (NETWS.ws) netWsRetire(NETWS.ws, 'identity confirmation failed');
    throw nativePlayerError('native_signin_required', 'The game session could not confirm your original account. Your progress remains in memory.');
  }
  NATIVE_PLAYER.status = status;
  SAVE.nativePaused = false;
  // Readback confirms the old baseline; it never replaces the live character.
  // Build the newest live state now, including progress made during sign-in.
  await saveNow();
  NATIVE_PLAYER.message = SAVE.pending ? 'Reconnected. Your latest progress is still awaiting pod confirmation.' : 'Reconnected. Your current character stayed in this game.';
  nativePlayerRender();
}
async function nativePlayerForget() {
  if (typeof gamingNativeForget === 'function') gamingNativeForget();
  NATIVE_PLAYER.profile?.close();
  if (!NATIVE_PLAYER.cache) {
    try { NATIVE_PLAYER.cache = (await import('/gaming/identity/assets/access-cache.mjs')).createBrowserAccessCache(); }
    catch (error) { if (SAVE.native || NETWS.acct?.nativeBound) throw error; }
  }
  if (NATIVE_PLAYER.cache) await NATIVE_PLAYER.cache.forgetAll();
  NATIVE_PLAYER.profile = null;
}
function nativePlayerRecovery(passphrase) {
  if (NATIVE_PLAYER.switching) return;
  return nativePlayerTask(async () => {
    if (passphrase.length < 12) throw new Error('Use at least 12 characters for the recovery passphrase. Keep it separate from the file.');
    const profile = NATIVE_PLAYER.profile;
    if (!profile.status().keyPresent) await profile.createKey();
    const recovery = await profile.exportRecovery(passphrase);
    const url = URL.createObjectURL(new Blob([JSON.stringify(recovery)], { type: 'application/json' }));
    const a = document.createElement('a'); a.href = url; a.download = 'hallowmarch-encrypted-recovery.json'; a.click();
    document.querySelectorAll('.native-player input[type="password"]').forEach(input => { input.value = ''; });
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    NATIVE_PLAYER.message = 'Keep the recovery file and passphrase. You need both to open this character on another browser.';
    if (GAME.player) await saveNow();
  });
}
function nativePlayerRestore(file, passphrase) {
  if (NATIVE_PLAYER.switching) return;
  return nativePlayerTask(async () => {
    if (file.size > 32768) throw new Error('That recovery file is too large.');
    await NATIVE_PLAYER.profile.restoreRecovery(JSON.parse(await file.text()), passphrase);
    if (!GAME.started) await nativePlayerRetryLoad();
  });
}
function nativePlayerImport() {
  if (NATIVE_PLAYER.switching) return;
  return nativePlayerTask(async () => {
    const imported = await nativePlayerRequest('/gaming/identity/legacy-import');
    const save = validSave(imported.save);
    if (!save?.char) throw new Error('No previous character is available to import.');
    await NATIVE_PLAYER.profile.set(save);
    location.reload();
  });
}
// Fixed-shape diagnostics expose no owner identifiers, record bodies or grants.
if (window.__hm) window.__hm.nativePlayerStatus = () => {
  const profile = NATIVE_PLAYER.profile?.status();
  return { state: NATIVE_PLAYER.state, readConfirmed: SAVE.readConfirmed === true, loaded: !!SAVE.loaded,
    started: GAME.started === true, loading: !!SAVE.loading && !SAVE.loading.settled, loadPhase: SAVE.loading?.phase,
    refPresent: !!SAVE.ref, refBlocked: SAVE.ref?.blocked === true, profilePresent: !!profile,
    profileStatus: profile ? { state: profile.state, keyPresent: profile.keyPresent === true, hasRecord: profile.hasRecord === true,
      pending: profile.pending === true, indexed: profile.indexed === true, linked: profile.linked === true } : null };
};
