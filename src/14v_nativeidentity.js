/* Owner identity and private character saves, composed through native ports. */
const NATIVE_PLAYER = { status: null, profile: null, cache: null, module: null, state: 'idle', message: '', busy: false, channel: null };
const nativePlayerError = (code, message) => Object.assign(new Error(message), { code });
async function nativePlayerRequest(url, { method = 'GET', body, timeoutMs = 18000 } = {}) {
  if (!NETWS.token) throw nativePlayerError('account_required', 'Connect to the March before signing in.');
  const response = await fetch(url, { method, credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(timeoutMs),
    headers: { Authorization: 'Bearer ' + NETWS.token, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}) });
  if (!response.ok) {
    let code = 'unavailable'; try { code = (await response.json()).error || code; } catch (e) { /* response may be unavailable */ }
    throw nativePlayerError(response.status === 404 ? 'not_available' : code, 'The identity service could not confirm this request. Try again.');
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
async function nativePlayerSaveRef() {
  if (!netServerUrl()) return null;
  if (!await netLinkWS()) return null;
  if (NETWS.acct?.nativeBound) { SAVE.native = true; SAVE.lsKey = 'hallowmarch.native.' + NETWS.acct.id; }
  let status;
  try { status = await nativePlayerRequest('/gaming/identity/status', { timeoutMs: 4000 }); }
  catch (error) {
    if (!NETWS.acct?.nativeBound) return null;
    status = { enabled: true, bound: true, verified: false, recordLinks: {} };
  }
  NATIVE_PLAYER.status = status;
  if (!status.bound) return null;
  // Once this account is native, no unread server/browser record is substituted.
  SAVE.native = true; SAVE.lsKey = 'hallowmarch.native.' + NETWS.acct.id;
  const blocked = { native: true,
    get: async () => { throw nativePlayerError('native_signin_required', 'Connect your identity to open this private character.'); },
    set: async () => { throw nativePlayerError('native_signin_required', 'Reconnect your identity to save this character.'); },
    delete: async () => { throw nativePlayerError('native_signin_required', 'Reconnect your identity before changing this character.'); } };
  if (!status.verified || !status.binding) { NATIVE_PLAYER.state = 'native_signin_required'; return blocked; }
  try {
    const module = await nativePlayerModules();
    const matches = await NATIVE_PLAYER.cache.list({});
    const match = matches.find(item => item.ownerDid === status.binding.subjectDid && item.podUrl === status.binding.podUrl);
    const cached = match && await NATIVE_PLAYER.cache.get(match);
    if (!cached) { NATIVE_PLAYER.state = 'native_signin_required'; return blocked; }
    // The cache API returns the access credential; no native bearer goes to request().
    const credential = cached.credential || cached;
    const profile = module.createPlayerPodProfile({ binding: status.binding, credential, relayUrl: match.relayUrl,
      request: nativePlayerRequest, pointer: status.recordLinks?.character || null, onState: nativePlayerChanged });
    NATIVE_PLAYER.profile = profile;
    let opening;
    return { native: true,
      get: async () => { if (!opening) opening = profile.connect(); await opening; return profile.get(); },
      set: save => profile.set(save), delete: () => profile.delete() };
  } catch (error) { NATIVE_PLAYER.state = error.code || 'unavailable'; return blocked; }
}
function nativePlayerSaveMessage() {
  if (!SAVE.native) return SAVE.backend === 'db' ? 'Progress saves automatically to your game account.' : 'Progress saves automatically in this browser.';
  if (NATIVE_PLAYER.state === 'saved') return 'Private character saved and verified in your pod.';
  if (NATIVE_PLAYER.state === 'saving') return 'Saving your private character to your pod…';
  if (['pending', 'uncertain', 'link_pending', 'pod_pending', 'pod_link_pending'].includes(NATIVE_PLAYER.state)) return 'Pod confirmation is pending. Keep this game open and retry.';
  if (NATIVE_PLAYER.state === 'key_required') return NATIVE_PLAYER.status?.recordLinks?.character
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
    const renderKey = JSON.stringify([NETWS.acct?.id, status.bound, NATIVE_PLAYER.state, NATIVE_PLAYER.busy, NATIVE_PLAYER.message, NATIVE_PLAYER.profile?.status()]);
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
    const profile = NATIVE_PLAYER.profile;
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
      action('Retry pod save', () => nativePlayerTask(async () => { await profile.retry(); if (SAVE.pending) await saveNow(); }));
      if (!profile.status().hasRecord && status.legacyImportAvailable) action('Import my previous character', nativePlayerImport);
    }
    if (NATIVE_PLAYER.message) { const p = add('p', NATIVE_PLAYER.message); p.setAttribute('role', 'status'); }
  }
  if ($('save-note')) $('save-note').textContent = nativePlayerSaveMessage();
  // A linked record must be opened before a new character can overwrite it.
  if ($('btn-begin')) $('btn-begin').disabled = !!(SAVE.native && (!status?.verified || (status?.recordLinks?.character && !SAVE.loaded)));
}
async function nativePlayerTask(run) {
  if (NATIVE_PLAYER.busy) return;
  NATIVE_PLAYER.busy = true; NATIVE_PLAYER.message = ''; nativePlayerRender();
  try { await run(); }
  catch (error) { NATIVE_PLAYER.message = error.message || 'Your pod did not confirm the operation. Try again.'; }
  finally { NATIVE_PLAYER.busy = false; nativePlayerRender(); }
}
function nativePlayerConnect() {
  if (NATIVE_PLAYER.busy) return;
  const popup = window.open('about:blank', 'hallowmarch-identity', 'popup,width=520,height=760');
  if (!popup) { NATIVE_PLAYER.message = 'Allow this sign-in window, then connect again.'; nativePlayerRender(); return; }
  nativePlayerTask(async () => {
    const channelName = 'hallowmarch-owner-' + crypto.randomUUID();
    const ceremony = { channel: channelName, token: NETWS.token, host: NETWS.host, expiresAt: Date.now() + 10 * 60 * 1000 };
    popup.sessionStorage.setItem('hallowmarch.identity.ceremony.v1', JSON.stringify(ceremony));
    NATIVE_PLAYER.channel?.close();
    const channel = NATIVE_PLAYER.channel = new BroadcastChannel(channelName);
    channel.onmessage = event => {
      if (event.data?.type !== 'hallowmarch-native-connected') return;
      channel.close(); NATIVE_PLAYER.channel = null;
      NETWS.reload = true; location.reload();
    };
    try {
      const result = await nativePlayerRequest('/gaming/identity/start', { method: 'POST', body: { ownerPodWriteAccess: true } });
      popup.location.replace(result.authorizationUrl);
      NATIVE_PLAYER.message = 'Complete sign-in in the identity window, then return here.';
    } catch (error) { popup.close(); channel.close(); throw error; }
  });
}
async function nativePlayerForget() {
  NATIVE_PLAYER.profile?.close();
  if (!NATIVE_PLAYER.cache) {
    try { NATIVE_PLAYER.cache = (await import('/gaming/identity/assets/access-cache.mjs')).createBrowserAccessCache(); }
    catch (error) { if (SAVE.native || NETWS.acct?.nativeBound) throw error; }
  }
  if (NATIVE_PLAYER.cache) await NATIVE_PLAYER.cache.forgetAll();
  NATIVE_PLAYER.profile = null;
}
function nativePlayerRecovery(passphrase) {
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
  return nativePlayerTask(async () => {
    if (file.size > 32768) throw new Error('That recovery file is too large.');
    await NATIVE_PLAYER.profile.restoreRecovery(JSON.parse(await file.text()), passphrase);
    location.reload();
  });
}
function nativePlayerImport() {
  return nativePlayerTask(async () => {
    const imported = await nativePlayerRequest('/gaming/identity/legacy-import');
    const save = validSave(imported.save);
    if (!save?.char) throw new Error('No previous character is available to import.');
    await NATIVE_PLAYER.profile.set(save);
    location.reload();
  });
}
