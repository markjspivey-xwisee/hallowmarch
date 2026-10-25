/* Owner identity and private character saves, composed through native ports. */
const NATIVE_PLAYER = { status: null, profile: null, cache: null, module: null, state: 'idle', message: '', busy: false, busyMessage: '', channel: null, authRefusal: null, switching: false, provisional: null, provisionalOpening: null, provisionalContext: null, playFlight: null, recoveryOpen: false, conflict: null, claimLastConfirmed: false, promoted: false, claimConfirmationPending: false };
const nativePlayerError = (code, message) => Object.assign(new Error(message), { code });
async function nativePlayerRequest(url, { method = 'GET', body, timeoutMs, token = NETWS.token } = {}) {
  // Durable admission and record registration include queued native CAS/readback.
  // Their bounded lifecycle budget does not change short control or explicit deadlines.
  const lifecycle = method === 'POST' && ['/gaming/identity/play/complete', '/gaming/identity/record-link'].includes(url);
  const requestTimeoutMs = timeoutMs === undefined ? (lifecycle ? 60000 : 18000) : timeoutMs;
  if (!token) throw nativePlayerError('account_required', 'Connect to the March before signing in.');
  const response = await fetch(url, { method, credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(requestTimeoutMs),
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
function nativePlayerIsProvisional() {
  return !NATIVE_PLAYER.promoted && (NATIVE_PLAYER.status?.provisional === true || NATIVE_PLAYER.provisional?.status().provisional === true);
}
function nativePlayerCanPlayNow() {
  return NATIVE_PLAYER.status?.provisionalPlay?.enabled === true && !NATIVE_PLAYER.status?.bound
    && !NATIVE_PLAYER.authRefusal && !NATIVE_PLAYER.newAdventure && !NATIVE_PLAYER.switching && !NATIVE_PLAYER.claimPendingResume
    && !nativePlayerGuestExpired() && !NATIVE_PLAYER.expiredAdventure;
}
function nativePlayerQuotaExhausted() {
  return nativePlayerIsProvisional() && (NATIVE_PLAYER.provisional?.status().quota === true || /quota|budget/.test(NATIVE_PLAYER.state));
}
function nativePlayerGuestExpired() {
  const expiry = NATIVE_PLAYER.provisional?.status().guestExpiresAt;
  return !NATIVE_PLAYER.promoted && (NATIVE_PLAYER.state === 'guest_expired' || !!expiry && expiry <= Date.now());
}
async function nativePlayerGuestRequest(url, options = {}, context = NATIVE_PLAYER.provisionalContext) {
  const target = new URL(url, location.origin);
  if (target.origin !== location.origin || target.username || target.password || target.search || target.hash) {
    throw nativePlayerError('owner_mismatch', 'The character proof destination changed. Retry its connection.');
  }
  const current = context && NATIVE_PLAYER.provisionalContext === context && NETWS.host === context.host
    && NETWS.acct?.id === context.accountId && !NETWS.reload;
  if (!current) throw nativePlayerError('owner_mismatch', 'The character connection changed. Retry its connection.');
  const proofOnly = options.method === 'POST' && ['/gaming/identity/play/challenge', '/gaming/identity/play/complete', '/gaming/identity/play/claim-complete', '/gaming/identity/play/claim-recovery-challenge'].includes(target.pathname);
  const token = NETWS.token || (proofOnly && NATIVE_PLAYER.provisionalProofContext === context ? NATIVE_PLAYER.provisionalProofToken : '');
  try { return await nativePlayerRequest(url, { ...options, token }); }
  catch (cause) {
    if (options.bootstrapRecovery !== true || options.method !== 'POST' || target.pathname !== '/gaming/identity/play/challenge'
      || cause.httpStatus !== 401 || cause.code !== 'game_account_required') throw cause;
    await nativePlayerRefreshBootstrapTransport(context, token);
    return nativePlayerRequest(url, { ...options, token: NETWS.token });
  }
}
async function nativePlayerRefreshBootstrapTransport(context, refusedToken) {
  const session = NATIVE_PLAYER.provisional, host = context.host;
  const allowed = () => NATIVE_PLAYER.provisionalContext === context && NATIVE_PLAYER.provisional === session
    && NETWS.host === host && NETWS.acct?.id === context.accountId && !NETWS.reload
    && !GAME.started && !SAVE.readConfirmed && !SAVE.loaded?.char && !SAVE.pending && !SAVE.nativeFlight
    && !NATIVE_PLAYER.profile && !NATIVE_PLAYER.claimPendingResume && !NATIVE_PLAYER.claimConfirmationPending;
  if (!session || !refusedToken || !allowed()) throw nativePlayerError('owner_mismatch', 'The temporary character connection changed. Retry without starting over.');
  const metadata = await session.peek();
  if (!allowed() || !metadata || metadata.gameAdmitted || metadata.credentialExpiresAt || metadata.characterId || metadata.targetAvailable || metadata.claimedOwnerDid) {
    throw nativePlayerError('owner_mismatch', 'The existing character requires its original connection. Nothing was changed.');
  }
  // Only this refused disposable game proof is replaced. The browser proof
  // key, native owner, pod and pending bootstrap metadata stay untouched.
  await netWsTokenForget(host, refusedToken, allowed);
  if (!allowed()) throw nativePlayerError('owner_mismatch', 'The game connection changed before its temporary proof could be refreshed.');
  if (NETWS.link) NETWS.link.close(); else netWsRetire(NETWS.ws, 'retry incomplete character bootstrap');
  NETWS.token = ''; NETWS.acct = null; context.accountId = undefined; NETWS.sessionRefusal = null;
  if (!await netLinkWS() || NATIVE_PLAYER.provisionalContext !== context || NATIVE_PLAYER.provisional !== session
    || NETWS.host !== host || NETWS.reload || GAME.started || SAVE.pending || SAVE.nativeFlight || !NETWS.acct?.id || !NETWS.token) {
    throw nativePlayerError('account_required', 'The fresh temporary game connection is unavailable. Retry without creating another owner.');
  }
  context.accountId = NETWS.acct.id;
}
async function nativePlayerAcceptSession(result, context) {
  const session = result?.appSession, account = session?.acct, binding = result?.binding;
  const current = () => NATIVE_PLAYER.provisionalContext === context && NETWS.host === context.host
    && NETWS.acct?.id === context.accountId && !NETWS.reload;
  if (!current() || !binding?.subjectDid || !binding?.podUrl || !account?.id || account.nativeBound !== true
    || typeof session.token !== 'string' || !session.token || typeof result.provisional !== 'boolean') {
    throw nativePlayerError('owner_mismatch', 'The character connection changed. Retry without closing this game.');
  }
  // This is the game's own opaque session. Native pod credentials stay sealed
  // in the browser's native access cache and are never sent to the game server.
  localStorage.setItem('hallowmarch.token.' + context.host, session.token);
  if (localStorage.getItem('hallowmarch.token.' + context.host) !== session.token) {
    throw nativePlayerError('storage_unavailable', 'This browser could not keep the character connection. Enable private storage and retry.');
  }
  NATIVE_PLAYER.provisionalProofToken = ''; NATIVE_PLAYER.provisionalProofContext = null;
  NETWS.token = session.token; NETWS.acct = account; context.accountId = account.id;
  if (NETWS.ws) netWsRetire(NETWS.ws, 'character identity confirmed');
  clearTimeout(NETWS.retryTimer); NETWS.retryTimer = 0;
  if (!await netLinkWS() || !current() || NETWS.acct?.id !== account.id) {
    throw nativePlayerError('native_signin_required', 'Your character connection is saved. Retry the connection before continuing.');
  }
  const status = await nativePlayerRequest('/gaming/identity/status');
  if (!current() || status.verified !== true || status.binding?.subjectDid !== binding.subjectDid
    || status.binding?.podUrl !== binding.podUrl || status.account?.id !== account.id) {
    throw nativePlayerError('owner_mismatch', 'The game could not confirm this character owner. Retry the connection.');
  }
  NATIVE_PLAYER.status = { ...status, enabled: true };
}
async function nativePlayerProvisionalSession(status = NATIVE_PLAYER.status) {
  if (NATIVE_PLAYER.provisional) return NATIVE_PLAYER.provisional;
  if (NATIVE_PLAYER.provisionalOpening) return NATIVE_PLAYER.provisionalOpening;
  const context = { host: NETWS.host, accountId: NETWS.acct?.id };
  NATIVE_PLAYER.provisionalContext = context;
  const opening = (async () => {
    const module = await import('/gaming/identity/assets/provisional-session.mjs');
    const session = await module.createProvisionalPlayerSession({ origin: location.origin,
      relayUrl: status?.provisionalPlay?.relayUrl, request: (url, options) => nativePlayerGuestRequest(url, options, context),
      onSession: result => nativePlayerAcceptSession(result, context), onState: nativePlayerChanged });
    if (NATIVE_PLAYER.provisionalContext !== context || NETWS.host !== context.host || NETWS.acct?.id !== context.accountId) {
      session.close(); throw nativePlayerError('owner_mismatch', 'The game connection changed. Retry opening the character.');
    }
    NATIVE_PLAYER.provisional = session;
    return session;
  })();
  NATIVE_PLAYER.provisionalOpening = opening;
  try { return await opening; }
  finally { if (NATIVE_PLAYER.provisionalOpening === opening) NATIVE_PLAYER.provisionalOpening = null; }
}
function nativePlayerProvisionalRef(session) {
  const context = NATIVE_PLAYER.provisionalContext;
  const owned = () => {
    if (NATIVE_PLAYER.provisional !== session || NATIVE_PLAYER.provisionalContext !== context
      || NETWS.host !== context.host || NETWS.acct?.id !== context.accountId || NETWS.reload) {
      throw nativePlayerError('revoked', 'Reconnect this character before saving.');
    }
  };
  return { native: true, get: async () => { owned(); const value = await session.get(); owned(); return value; },
    set: async save => { owned(); await session.set(save); owned(); },
    delete: async () => { owned(); await session.profile().delete(); owned(); } };
}
async function nativePlayerBegin(save) {
  if (NATIVE_PLAYER.playFlight) return NATIVE_PLAYER.playFlight;
  if (GAME.started || NATIVE_PLAYER.busy || NATIVE_PLAYER.switching) return;
  const flight = nativePlayerTask(async () => {
    const host = NETWS.host;
    if (nativePlayerCanPlayNow()) {
      const session = await nativePlayerProvisionalSession();
      // An old or unread character is never evidence that a new one is needed.
      const previous = await session.peek();
      if (previous) await session.resume({ requireGameSession: true }); else await session.bootstrap();
      if (NETWS.host !== host || NETWS.reload || !NATIVE_PLAYER.status?.verified) throw nativePlayerError('owner_mismatch', 'Retry the character connection.');
      NATIVE_PLAYER.profile = session.profile();
      const ref = nativePlayerProvisionalRef(session), snapshot = await ref.get();
      if (!snapshot || typeof snapshot.exists !== 'boolean') throw nativePlayerError('pod_pending', 'Your character is still awaiting pod confirmation. Retry Play now.');
      if (!snapshot.exists) throw nativePlayerError('missing_guest_checkpoint', 'Your temporary checkpoint could not be confirmed. Retry without starting over.');
      const stored = snapshot.exists ? snapshot.data() : null;
      const hadCharacter = stored?.char != null;
      const recovered = stored ? validSave(stored) : null;
      if (snapshot.exists && (!recovered || hadCharacter && !recovered.char)) throw nativePlayerError('character_unreadable', 'The saved character could not be opened. Keep it intact and retry.');
      SAVE.ref = ref; SAVE.native = true; SAVE.backend = 'pod'; SAVE.readConfirmed = true; SAVE.loaded = recovered;
      SAVE.lsKey = 'hallowmarch.native.' + NETWS.acct.id;
      if (SAVE.loading) { SAVE.loading.owner = NETWS.acct.id; SAVE.loading.host = host; SAVE.loading.ref = ref; }
      if (recovered?.char) {
        applySettings(recovered.settings); applyWorldSave(recovered.world);
        SAVE.lastBody = JSON.stringify({ ...recovered, savedAt: 0 }); SAVE.lastCore = coreKey(recovered);
        save = { ...recovered.char };
      }
    } else if (SAVE.native) {
      const profile = NATIVE_PLAYER.profile;
      const accountId = NETWS.acct?.id;
      if (!NATIVE_PLAYER.status?.verified || !SAVE.readConfirmed || !profile) throw nativePlayerError('native_signin_required', 'Confirm the character connection before playing.');
      const state = profile.status();
      if (!state.keyPresent) {
        if (state.hasRecord) throw nativePlayerError('key_required', 'Restore the recovery file for this character.');
        await profile.createKey(); // The recovery download can follow after play.
      }
      if (NATIVE_PLAYER.profile !== profile || NETWS.acct?.id !== accountId) throw nativePlayerError('owner_mismatch', 'The character owner changed. Open its own save before playing.');
    }
    if (NETWS.host !== host || NETWS.reload || GAME.started) return;
    const accountId = NETWS.acct?.id, profile = NATIVE_PLAYER.profile;
    await startGame(save, () => !NETWS.reload && NETWS.host === host && NETWS.acct?.id === accountId
      && NATIVE_PLAYER.profile === profile && (!SAVE.native || SAVE.readConfirmed && NATIVE_PLAYER.status?.verified));
    nativePlayerRender();
  }, 'Connecting your character…');
  NATIVE_PLAYER.playFlight = flight;
  try { return await flight; } finally { if (NATIVE_PLAYER.playFlight === flight) NATIVE_PLAYER.playFlight = null; }
}
async function nativePlayerSaveRef(initialization = { active: true }) {
  const server = netServerUrl();
  if (!server) return null;
  // Ownership is unknown until the linked server's public policy and account
  // status have been read. Never select another browser character meanwhile.
  SAVE.native = true; SAVE.lsKey = 'hallowmarch.native.unconfirmed';
  NATIVE_PLAYER.status = { enabled: true, bound: false, verified: false, recordLinks: {} };
  NATIVE_PLAYER.newAdventure = null;
  NATIVE_PLAYER.state = 'identity_unconfirmed';
  const active = () => initialization.active;
  let provisionalContract = null;
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
      if (manifest.playerIdentity?.provisionalPlay?.enabled === true) provisionalContract = manifest.playerIdentity.provisionalPlay;
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
  if (!await netLinkWS()) {
    // A retired/expired game bearer is never a socket session. A known browser
    // key may still recover its bounded proof ceremony or exact pending claim.
    if (active() && provisionalContract && NETWS.host && !NETWS.reload) {
      try {
        const host = NETWS.host, accountId = NETWS.acct?.id, socketToken = NETWS.token;
        const current = () => active() && NETWS.host === host && NETWS.acct?.id === accountId && NETWS.token === socketToken && !NETWS.reload;
        const token = await netWsToken(host);
        if (!current()) return active() ? blocked : null;
        if (typeof token === 'string' && token) {
          const status = { enabled: true, bound: true, verified: false, provisional: true,
            provisionalPlay: provisionalContract, recordLinks: {} };
          const session = await nativePlayerProvisionalSession(status), metadata = await session.peek();
          if (!current()) return active() ? blocked : null;
          if (metadata && !metadata.claimedOwnerDid) {
            NATIVE_PLAYER.status = status; NATIVE_PLAYER.claimLastConfirmed = metadata.lastConfirmedClaim === true;
            NATIVE_PLAYER.provisionalProofToken = token;
            NATIVE_PLAYER.provisionalProofContext = NATIVE_PLAYER.provisionalContext;
            const resumed = await session.resume({ requireGameSession: true });
            initialization.owner = NETWS.acct?.id; initialization.host = NETWS.host;
            if (!active()) return null;
            NATIVE_PLAYER.claimPendingResume = resumed?.pendingClaimResume === true;
            NATIVE_PLAYER.profile = session.profile();
            NATIVE_PLAYER.message = NATIVE_PLAYER.claimPendingResume ? 'A character claim is awaiting confirmation. Choose Retry keeping character to recover it.' : '';
            return nativePlayerProvisionalRef(session);
          }
          const refusal = NETWS.sessionRefusal;
          if (metadata === null && refusal?.code === 'native_signin_required' && refusal.host === host
            && refusal.token === token && refusal.generation === NETWS.generation) {
            NATIVE_PLAYER.status = { enabled: true, bound: false, verified: false, provisionalPlay: provisionalContract, recordLinks: {} };
            NATIVE_PLAYER.newAdventure = { refusal, session, accountId, socketToken };
            NATIVE_PLAYER.state = 'native_signin_required';
          }
        }
      } catch (error) {
        NATIVE_PLAYER.state = error.code || 'unavailable';
        NATIVE_PLAYER.message = 'Your saved character is still intact. Retry its connection or complete the pending identity claim.';
      }
    }
    return active() ? blocked : null;
  }
  if (!active()) return null;
  const owner = NETWS.acct?.id, host = NETWS.host;
  initialization.owner = owner; initialization.host = host;
  let status;
  try { status = await nativePlayerRequest('/gaming/identity/status'); }
  catch (error) { return active() ? blocked : null; }
  if (!active()) return null;
  if (!owner || NETWS.acct?.id !== owner || NETWS.host !== host || (status.account?.id && status.account.id !== owner)) return blocked;
  NATIVE_PLAYER.status = { ...status, enabled: true };
  if (status.provisional === true || status.provisionalPlay?.enabled === true) {
    try {
      const session = await nativePlayerProvisionalSession(status);
      const metadata = await session.peek();
      NATIVE_PLAYER.claimLastConfirmed = metadata?.lastConfirmedClaim === true;
      const canonicalRecovery = !!(metadata?.targetAvailable && metadata.targetOwnerDid === status.binding?.subjectDid);
      if (metadata && (status.provisional === true || !status.bound || canonicalRecovery)) {
        const resumed = await session.resume({ binding: status.binding || undefined, requireGameSession: !status.bound || status.verified !== true,
          recoverPendingClaim: canonicalRecovery });
        NATIVE_PLAYER.claimPendingResume = resumed?.pendingClaimResume === true;
        initialization.owner = NETWS.acct?.id; initialization.host = NETWS.host;
        if (!active()) return null;
        NATIVE_PLAYER.profile = session.profile();
        SAVE.lsKey = 'hallowmarch.native.' + NETWS.acct.id;
        return nativePlayerProvisionalRef(session);
      }
      if (status.provisional === true) NATIVE_PLAYER.state = 'guest_key_required';
    } catch (error) {
      NATIVE_PLAYER.state = error.code || 'unavailable';
      NATIVE_PLAYER.message = 'Your temporary character could not be confirmed. Retry its connection without starting over.';
      return active() ? blocked : null;
    }
  }
  if (!status.enabled || !status.bound || !status.verified || !status.binding) {
    NATIVE_PLAYER.state = status.enabled && !status.bound ? 'native_identity_required' : 'native_signin_required';
    return blocked;
  }
  // A verified canonical sign-in selects that owner's private save. An older
  // unclaimed device remains stored for recovery, but is not the active player.
  // Pending source-claim recovery returned its provisional port above.
  NATIVE_PLAYER.provisional?.close(); NATIVE_PLAYER.provisional = null; NATIVE_PLAYER.provisionalContext = null;
  NATIVE_PLAYER.provisionalProofToken = ''; NATIVE_PLAYER.provisionalProofContext = null;
  NATIVE_PLAYER.promoted = true; NATIVE_PLAYER.expiredAdventure = null;
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
  if (NATIVE_PLAYER.busy && !GAME.started) return (NATIVE_PLAYER.busyMessage || 'Preparing your character…') + ' Keep this page open until confirmation finishes.';
  if (!SAVE.native) return SAVE.backend === 'db' ? 'Progress saves automatically to your game account.' : 'Progress saves automatically in this browser.';
  if (nativePlayerGuestExpired() || NATIVE_PLAYER.expiredAdventure) return 'This temporary session expired. Open a character saved to Interego, or start a new one. Existing saves and browser keys are kept.';
  if (nativePlayerNewAdventureAllowed()) return 'This game sign-in expired. Reconnect your identity or start a new character. Your existing private saves are kept.';
  if (nativePlayerCanPlayNow()) return 'Play now. Save this character to your Interego identity later.';
  if (nativePlayerIsProvisional()) {
    const state = NATIVE_PLAYER.provisional?.status();
    const deadline = state?.guestExpiresAt;
    const expiry = deadline ? new Date(deadline < 1e12 ? deadline * 1000 : deadline).toLocaleString() : 'the temporary save expires';
    if (['quota_exceeded', 'guest_budget_exceeded', 'provisional_budget_exceeded'].includes(NATIVE_PLAYER.state)) return 'Your last confirmed save is safe. Keep this character with Interego to continue saving.';
    if (NATIVE_PLAYER.state === 'saved' && !SAVE.pending) return 'Temporary character saved. Keep it with Interego before ' + expiry + '.';
    return 'This browser holds your temporary character key. Keep the character with Interego before ' + expiry + '.';
  }
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
    const renderKey = JSON.stringify([NETWS.acct?.id, status.bound, status.provisional, SAVE.readConfirmed, !!SAVE.loaded, SAVE.loading?.settled, NATIVE_PLAYER.state, NATIVE_PLAYER.busy, NATIVE_PLAYER.switching, NATIVE_PLAYER.message, NATIVE_PLAYER.recoveryOpen, !!NATIVE_PLAYER.conflict, NATIVE_PLAYER.profile?.status(), nativePlayerFreshAllowed(), nativePlayerNewAdventureAllowed(), nativePlayerGuestExpired(), nativePlayerExpiredAdventureAllowed()]);
    if (box._nativeKey === renderKey) continue;
    box._nativeKey = renderKey;
    const sameOwner = box._nativeOwner === NETWS.acct?.id;
    const typedPassphrase = sameOwner ? box.querySelector('.native-source-recovery')?.value || '' : '';
    const currentClaimProfile = NATIVE_PLAYER.provisional?.claimProfile();
    const typedClaimPassphrase = box._claimProfile === currentClaimProfile ? box.querySelector('.native-target-recovery')?.value || '' : '';
    box._claimProfile = currentClaimProfile;
    box._nativeOwner = NETWS.acct?.id;
    box.replaceChildren();
    const add = (tag, text) => { const node = document.createElement(tag); node.textContent = text; box.appendChild(node); return node; };
    const provisional = nativePlayerIsProvisional(), expired = nativePlayerGuestExpired() || !!NATIVE_PLAYER.expiredAdventure;
    add('h3', expired ? 'Temporary session expired' : provisional ? 'Keep your character' : status.bound ? 'Your identity and character' : nativePlayerCanPlayNow() ? 'Start your adventure' : 'Your identity and character');
    add('p', expired || status.bound || nativePlayerCanPlayNow() || nativePlayerNewAdventureAllowed() ? nativePlayerSaveMessage() : 'Connect your Interego identity to open your private character.');
    const action = (label, run) => {
      const b = add('button', label); b.type = 'button'; b.className = 'btn'; b.disabled = NATIVE_PLAYER.busy;
      b.style.minHeight = '44px'; b.style.margin = '4px'; b.style.touchAction = 'manipulation';
      b.onclick = () => run(); return b;
    };
    if (expired) {
      action('Open my saved character', nativePlayerConnect);
      if (target.classList.contains('card-body') && nativePlayerExpiredAdventureAllowed()) action('Start a new character', nativePlayerExpiredAdventure);
      if (NATIVE_PLAYER.provisional?.status().claim?.targetAvailable || NATIVE_PLAYER.provisional?.status().claimStarted) add('p', 'A character claim was started. Connect the identity you used to keep it; its original browser key has not been replaced.');
    } else if (provisional) {
      if (nativePlayerQuotaExhausted() && SAVE.pending) {
        add('p', 'Your latest progress is waiting to save. Keep the last confirmed checkpoint first; this open game will then save its latest progress to your identity.');
        action('Keep last confirmed save', () => nativePlayerClaimConnect({ lastConfirmed: true }));
      } else action('Keep my character', nativePlayerClaimConnect);
      action('Refresh temporary connection', () => nativePlayerTask(nativePlayerRefreshGuest));
      if (NATIVE_PLAYER.provisional?.status().claim?.targetAvailable) action('Retry keeping character', () => nativePlayerTask(() => nativePlayerFinishClaim()));
    } else if (NATIVE_PLAYER.claimConfirmationPending) action('Confirm kept character', () => nativePlayerTask(nativePlayerConfirmClaim));
    else action(status.bound ? 'Reconnect identity' : 'I already have an identity', nativePlayerConnect);
    if (target.classList.contains('card-body') && nativePlayerNewAdventureAllowed()) action('Play with a new character', nativePlayerNewAdventure);
    if (target.classList.contains('card-body') && nativePlayerFreshAllowed()) action(
      NATIVE_PLAYER.authRefusal.reason === 'native_owner_mismatch' ? 'Sign in with a different account' : 'Start a fresh sign-in', () => nativePlayerConnect(true));
    if (!expired && SAVE.native && !SAVE.readConfirmed && !GAME.started && !NATIVE_PLAYER.switching) action('Retry connection', () => nativePlayerTask(nativePlayerRetryLoad));
    const profile = NATIVE_PLAYER.switching ? null : NATIVE_PLAYER.profile;
    if (profile) {
      action(NATIVE_PLAYER.recoveryOpen ? 'Hide recovery options' : 'Recovery options', () => { NATIVE_PLAYER.recoveryOpen = !NATIVE_PLAYER.recoveryOpen; nativePlayerRender(); });
      if (SAVE.pending || profile.status().pending) action('Retry saving character', () => nativePlayerTask(async () => {
        await NATIVE_PLAYER.provisional?.retry(); await saveNow({ final: true });
      }));
    }
    if (profile && (NATIVE_PLAYER.recoveryOpen || NATIVE_PLAYER.state === 'key_required' && profile.status().hasRecord)) {
      const pass = document.createElement('input'); pass.type = 'password'; pass.autocomplete = 'new-password';
      pass.className = 'native-source-recovery';
      pass.value = typedPassphrase;
      pass.placeholder = 'Recovery passphrase (12+ characters)'; pass.setAttribute('aria-label', 'Recovery file passphrase');
      pass.style.cssText = 'display:block;width:100%;box-sizing:border-box;min-height:44px;max-width:28rem;font-size:16px'; box.appendChild(pass);
      if (profile.status().keyPresent) action('Download recovery file', () => nativePlayerRecovery(pass.value));
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
    if (NATIVE_PLAYER.conflict) {
      add('p', 'This Interego identity already has a character. Both saves are intact. Choose which one to continue.');
      action('Keep playing this character', () => { NATIVE_PLAYER.conflict = null; NATIVE_PLAYER.message = ''; nativePlayerRender(); });
      action('Use my saved character', () => nativePlayerTask(() => nativePlayerUseExistingTarget()));
    }
    const claimProfile = NATIVE_PLAYER.provisional?.claimProfile();
    if (claimProfile?.status().hasRecord && !claimProfile.status().keyPresent) {
      add('p', 'This identity has an encrypted character. Restore its recovery file to open it. Your current character remains saved.');
      const pass = document.createElement('input'); pass.type = 'password'; pass.autocomplete = 'current-password';
      pass.className = 'native-target-recovery'; pass.value = typedClaimPassphrase;
      pass.placeholder = 'Saved character recovery passphrase'; pass.setAttribute('aria-label', 'Saved character recovery passphrase');
      pass.style.cssText = 'display:block;width:100%;min-height:44px;font-size:16px'; box.appendChild(pass);
      const file = document.createElement('input'); file.type = 'file'; file.accept = '.json,application/json'; file.hidden = true;
      file.setAttribute('aria-label', 'Choose saved character recovery file'); box.appendChild(file);
      action('Restore saved character', () => file.click());
      file.onchange = () => { if (file.files[0]) void nativePlayerTask(async () => {
        if (file.files[0].size > 32768) throw new Error('That recovery file is too large.');
        await claimProfile.restoreRecovery(JSON.parse(await file.files[0].text()), pass.value);
        pass.value = ''; await nativePlayerFinishClaim();
      }); };
    }
    if (NATIVE_PLAYER.message) { const p = add('p', NATIVE_PLAYER.message); p.setAttribute('role', 'status'); }
  }
  const titleBusy = NATIVE_PLAYER.busy && !GAME.started;
  if ($('save-note')) {
    const note = $('save-note'); note.setAttribute('role', 'status'); note.setAttribute('aria-live', 'polite'); note.setAttribute('aria-atomic', 'true');
    note.textContent = titleBusy ? nativePlayerSaveMessage() : !GAME.started && NATIVE_PLAYER.message ? NATIVE_PLAYER.message
      : nativePlayerGuestExpired() || NATIVE_PLAYER.expiredAdventure ? 'Expired session. Existing saves and browser keys are kept.' : nativePlayerSaveMessage();
  }
  // The owner index may reveal a record without any game-server pointer. Only
  // an actual private read (or confirmed absence) and held key permit entry.
  const profileStatus = NATIVE_PLAYER.profile?.status();
  const blocked = NATIVE_PLAYER.busy || NATIVE_PLAYER.switching || nativePlayerGuestExpired() || !!NATIVE_PLAYER.expiredAdventure || (SAVE.native && !nativePlayerCanPlayNow()
    && (!status?.verified || !SAVE.readConfirmed || !profileStatus || (profileStatus.hasRecord && (!profileStatus.keyPresent || !SAVE.loaded))));
  for (const id of ['btn-begin', 'btn-continue']) if ($(id)) {
    $(id).disabled = !!blocked; $(id).setAttribute('aria-busy', String(titleBusy));
  }
  const titleCharacter = typeof UI !== 'undefined' && UI.titleSave?.char;
  if ($('btn-begin')) $('btn-begin').textContent = titleBusy ? NATIVE_PLAYER.busyMessage
    : titleCharacter ? 'Continue as ' + titleCharacter.name : nativePlayerCanPlayNow() ? 'Play now' : 'Enter the realm';
  if ($('btn-continue')) $('btn-continue').textContent = titleBusy ? NATIVE_PLAYER.busyMessage : 'Return to the march';
  if ($('btn-keep-character')) {
    $('btn-keep-character').hidden = !nativePlayerIsProvisional() || nativePlayerGuestExpired();
    $('btn-keep-character').disabled = NATIVE_PLAYER.busy || NATIVE_PLAYER.switching;
    $('btn-keep-character').onclick = () => { openPlayerIdentity(); nativePlayerRender(); };
  }
}
async function nativePlayerRetryLoad() {
  if (GAME.started || SAVE.pending || SAVE.nativeFlight || NATIVE_PLAYER.switching) return;
  await loadSave({ retry: true });
  nativePlayerRender();
}
async function nativePlayerTask(run, busyMessage = 'Preparing your character…') {
  if (NATIVE_PLAYER.busy) return;
  NATIVE_PLAYER.busyMessage = busyMessage; NATIVE_PLAYER.busy = true; NATIVE_PLAYER.message = ''; nativePlayerRender();
  try { await run(); }
  catch (error) { NATIVE_PLAYER.message = error.message || 'Your pod did not confirm the operation. Try again.'; }
  finally { NATIVE_PLAYER.busy = false; NATIVE_PLAYER.busyMessage = ''; nativePlayerRender(); }
}
function nativePlayerClaimConnect({ lastConfirmed = false } = {}) {
  if (NATIVE_PLAYER.busy || !nativePlayerIsProvisional() || !NATIVE_PLAYER.provisional) return;
  const popup = window.open('about:blank', 'hallowmarch-identity', 'popup,width=520,height=760');
  if (!popup) { NATIVE_PLAYER.message = 'Allow this sign-in window, then choose Keep my character again.'; nativePlayerRender(); return; }
  void nativePlayerTask(async () => {
    const session = NATIVE_PLAYER.provisional, host = NETWS.host, accountId = NETWS.acct?.id;
    const same = () => NATIVE_PLAYER.provisional === session && NETWS.host === host && NETWS.acct?.id === accountId && !NETWS.reload;
    NATIVE_PLAYER.switching = true;
    if (typeof netHumanSuspend === 'function') netHumanSuspend();
    let channel;
    try {
      await saveNow({ final: true });
      if (!same() || SAVE.pending && !(lastConfirmed && nativePlayerQuotaExhausted())) throw nativePlayerError('pod_pending', 'Confirm the latest temporary save before connecting an identity. Keep this game open and retry.');
      NATIVE_PLAYER.claimLastConfirmed = lastConfirmed;
      const result = await session.prepareClaim({ lastConfirmed });
      if (!same() || !/^[A-Za-z0-9_-]{43}$/.test(result.browserCeremony || '')) throw nativePlayerError('invalid_claim', 'The character claim could not be confirmed. Retry without starting over.');
      const channelName = 'hallowmarch-claim-' + crypto.randomUUID();
      const ceremony = { purpose: 'character-claim-target', channel: channelName, token: NETWS.token, host,
        expectedOwnerDid: NATIVE_PLAYER.status.binding.subjectDid,
        browserCeremony: result.browserCeremony, expiresAt: Date.now() + 10 * 60 * 1000 };
      popup.sessionStorage.setItem('hallowmarch.identity.ceremony.v1', JSON.stringify(ceremony));
      NATIVE_PLAYER.channel?.close(); channel = NATIVE_PLAYER.channel = new BroadcastChannel(channelName);
      channel.onmessage = event => {
        if (NATIVE_PLAYER.channel !== channel || !same() || Date.now() > ceremony.expiresAt
          || event.data?.host !== host || event.data?.browserCeremony !== ceremony.browserCeremony) return;
        if (event.data.type === 'hallowmarch-native-failed') {
          channel.close(); NATIVE_PLAYER.channel = null;
          NATIVE_PLAYER.message = 'Sign-in did not complete. Your temporary character is still saved here.';
          nativePlayerRender(); return;
        }
        if (event.data.type !== 'hallowmarch-native-claim-target') return;
        channel.close(); NATIVE_PLAYER.channel = null;
        void nativePlayerTask(() => nativePlayerFinishClaim(event.data.result));
      };
      popup.location.replace(result.authorizationUrl);
      NATIVE_PLAYER.message = 'Complete sign-in to keep this character. You can return to playing while the identity window is open.';
    } catch (error) { popup.close(); channel?.close(); throw error; }
    finally { NATIVE_PLAYER.switching = false; }
  });
}
async function nativePlayerFinishClaim(target) {
  const session = NATIVE_PLAYER.provisional;
  if (!session || !nativePlayerIsProvisional()) throw nativePlayerError('not_connected', 'Open the temporary character before keeping it.');
  NATIVE_PLAYER.switching = true;
  if (typeof netHumanSuspend === 'function') netHumanSuspend();
  try {
    await saveNow({ final: true });
    if (SAVE.pending && !(NATIVE_PLAYER.claimLastConfirmed && nativePlayerQuotaExhausted())) throw nativePlayerError('pod_pending', 'Your latest progress is awaiting confirmation. Retry keeping the character once it is saved.');
    SAVE.nativePaused = true;
    const result = target ? await session.claimTarget(target) : await session.resumeClaim();
    if (result.conflict) {
      NATIVE_PLAYER.conflict = result;
      NATIVE_PLAYER.message = result.reason === 'claim_progress_changed'
        ? 'A previous claim copy needs confirmation. Both saved copies are intact. Retry keeping this character.'
        : 'Your connected identity already has a saved character. Choose which one to continue.';
      return;
    }
    if (!result.claimed) throw nativePlayerError('claim_unconfirmed', 'The claim is still awaiting confirmation. Retry keeping this character.');
    NATIVE_PLAYER.promoted = true;
    NATIVE_PLAYER.claimPendingResume = false;
    NATIVE_PLAYER.claimConfirmationPending = !!(result.localSessionPending || result.localPersistencePending || result.latestProgressPending);
    NATIVE_PLAYER.profile = session.profile(); SAVE.ref = nativePlayerProvisionalRef(session);
    SAVE.nativePaused = false; SAVE.lastBody = ''; NATIVE_PLAYER.conflict = null;
    await saveNow({ final: true });
    if (!GAME.started && !NATIVE_PLAYER.claimConfirmationPending) await nativePlayerClaimTitle();
    NATIVE_PLAYER.message = NATIVE_PLAYER.claimConfirmationPending || SAVE.pending
      ? 'Your identity accepted this character. Connection or latest-save confirmation is still pending. Keep this game open and choose Confirm kept character.'
      : 'Character kept with Interego. Your progress and place in the world are unchanged. Recovery options are available when you need them.';
  } finally { SAVE.nativePaused = false; NATIVE_PLAYER.switching = false; nativePlayerRender(); }
}
async function nativePlayerClaimTitle() {
  NATIVE_PLAYER.claimConfirmationPending = true;
  const found = await SAVE.ref.get();
  if (!found?.exists) throw nativePlayerError('claim_readback_failed', 'The kept character is awaiting readback. Keep this game open and confirm its connection.');
  const save = validSave(found.data());
  if (!save) throw nativePlayerError('claim_readback_failed', 'The kept character could not be opened. Keep this game open and retry.');
  SAVE.loaded = save; SAVE.readConfirmed = true;
  SAVE.lastBody = JSON.stringify({ ...save, savedAt: 0 }); SAVE.lastCore = coreKey(save);
  if (SAVE.loading) { SAVE.loading.owner = NETWS.acct?.id; SAVE.loading.host = NETWS.host; SAVE.loading.ref = SAVE.ref; }
  setupTitle(save);
  NATIVE_PLAYER.claimConfirmationPending = false;
}
async function nativePlayerConfirmClaim() {
  const session = NATIVE_PLAYER.provisional;
  if (!session || !NATIVE_PLAYER.promoted) return;
  NATIVE_PLAYER.switching = true; SAVE.nativePaused = true;
  if (typeof netHumanSuspend === 'function') netHumanSuspend();
  try {
    const result = await session.retrySession();
    NATIVE_PLAYER.profile = session.profile(); SAVE.ref = nativePlayerProvisionalRef(session);
    if (!NATIVE_PLAYER.openExistingPending) { SAVE.nativePaused = false; await saveNow({ final: true }); }
    NATIVE_PLAYER.claimConfirmationPending = !!(result.localSessionPending || result.localPersistencePending || result.latestProgressPending || !NATIVE_PLAYER.openExistingPending && SAVE.pending);
    if (!GAME.started && !NATIVE_PLAYER.openExistingPending && !NATIVE_PLAYER.claimConfirmationPending) await nativePlayerClaimTitle();
    if (NATIVE_PLAYER.openExistingPending && !NATIVE_PLAYER.claimConfirmationPending) { NETWS.reload = true; location.reload(); return; }
    NATIVE_PLAYER.message = NATIVE_PLAYER.claimConfirmationPending ? 'Confirmation is still pending. Keep this game open and retry.' : 'Character kept and its latest save confirmed with Interego.';
  } finally { SAVE.nativePaused = !!NATIVE_PLAYER.openExistingPending; NATIVE_PLAYER.switching = false; nativePlayerRender(); }
}
async function nativePlayerRefreshGuest() {
  const session = NATIVE_PLAYER.provisional;
  if (!session || !nativePlayerIsProvisional()) return;
  NATIVE_PLAYER.switching = true; SAVE.nativePaused = true;
  if (typeof netHumanSuspend === 'function') netHumanSuspend();
  try {
    if (!await withTimeout(SAVE.chain.then(() => true), 45000)) throw nativePlayerError('pod_pending', 'A save is still awaiting confirmation. Keep the game open and retry.');
    await session.resume({ binding: NATIVE_PLAYER.status.binding, requireGameSession: true });
    NATIVE_PLAYER.profile = session.profile(); SAVE.ref = nativePlayerProvisionalRef(session);
    SAVE.nativePaused = false;
    if (!GAME.started) {
      await loadSave({ retry: true });
      NATIVE_PLAYER.message = SAVE.readConfirmed ? 'Temporary character confirmed. Enter the realm when ready.' : 'The temporary connection is refreshed. Retry opening its private checkpoint.';
      return;
    }
    await saveNow({ final: true });
    NATIVE_PLAYER.message = SAVE.pending ? 'Connection refreshed. Your latest save is still awaiting confirmation.' : 'Temporary connection refreshed. Your current character stayed in this game.';
  } finally { SAVE.nativePaused = false; NATIVE_PLAYER.switching = false; nativePlayerRender(); }
}
async function nativePlayerUseExistingTarget() {
  const session = NATIVE_PLAYER.provisional;
  if (!session || !NATIVE_PLAYER.conflict) return;
  NATIVE_PLAYER.switching = true;
  if (typeof netHumanSuspend === 'function') netHumanSuspend();
  try {
    await saveNow({ final: true });
    if (SAVE.pending) throw nativePlayerError('pod_pending', 'Confirm this temporary save before opening the other character.');
    SAVE.nativePaused = true;
    const result = await session.useExistingTarget();
    if (!result.claimed) throw nativePlayerError('claim_unconfirmed', 'The saved character connection is not confirmed.');
    NATIVE_PLAYER.promoted = true; NATIVE_PLAYER.openExistingPending = true;
    NATIVE_PLAYER.claimConfirmationPending = !!(result.localSessionPending || result.localPersistencePending || result.latestProgressPending);
    NATIVE_PLAYER.profile = session.profile(); SAVE.ref = nativePlayerProvisionalRef(session);
    // Explicitly opening the other character reads its own save on the title.
    // The provisional pod keeps its last checkpoint until the fixed expiry.
    if (NATIVE_PLAYER.claimConfirmationPending) {
      NATIVE_PLAYER.message = 'The saved character is selected. Confirm its connection before opening it. Your temporary checkpoint remains intact.';
      return;
    }
    NETWS.reload = true; location.reload();
  } finally { SAVE.nativePaused = !!NATIVE_PLAYER.openExistingPending; NATIVE_PLAYER.switching = false; }
}
function nativePlayerSwitchIdle() {
  return !GAME.started && !SAVE.pending && !SAVE.nativeFlight && !SAVE.wiping && !NATIVE_PLAYER.profile?.status().pending
    && (!SAVE.loading || SAVE.loading.settled);
}
function nativePlayerFreshAllowed() {
  return nativePlayerSwitchIdle() && !!NATIVE_PLAYER.authRefusal && NATIVE_PLAYER.authRefusal.host === NETWS.host;
}
function nativePlayerNewAdventureAllowed() {
  const choice = NATIVE_PLAYER.newAdventure, refusal = choice?.refusal;
  return nativePlayerSwitchIdle() && NATIVE_PLAYER.status?.provisionalPlay?.enabled === true
    && !NATIVE_PLAYER.profile && !SAVE.loaded?.char && !SAVE.readConfirmed && !NATIVE_PLAYER.claimPendingResume
    && !NATIVE_PLAYER.claimConfirmationPending && !NATIVE_PLAYER.promoted && !NATIVE_PLAYER.openExistingPending
    && !!refusal && NETWS.sessionRefusal === refusal && refusal.code === 'native_signin_required'
    && refusal.host === NETWS.host && refusal.generation === NETWS.generation && !NETWS.reload
    && NETWS.state === 'off' && !NETWS.openP && !NETWS.linkP
    && NETWS.acct?.id === choice.accountId && NETWS.token === choice.socketToken
    && NATIVE_PLAYER.provisional === choice.session;
}
function nativePlayerExpiredAdventureAllowed() {
  const choice = NATIVE_PLAYER.expiredAdventure, session = NATIVE_PLAYER.provisional;
  if (!nativePlayerSwitchIdle() || !session || !NATIVE_PLAYER.status?.provisionalPlay?.enabled
    || NATIVE_PLAYER.profile || SAVE.loaded?.char || SAVE.readConfirmed || NATIVE_PLAYER.claimPendingResume
    || NATIVE_PLAYER.claimConfirmationPending || NATIVE_PLAYER.promoted || NATIVE_PLAYER.openExistingPending
    || NATIVE_PLAYER.channel || NETWS.reload || NETWS.openP || NETWS.linkP) return false;
  if (choice) return choice.session === session && choice.host === NETWS.host
    && choice.accountId === NETWS.acct?.id && choice.socketToken === NETWS.token;
  return nativePlayerGuestExpired() && session.status().provisional === true && !session.status().claim?.targetAvailable && !session.status().claimStarted;
}
function nativePlayerExpiredAdventure() {
  if (NATIVE_PLAYER.busy || NATIVE_PLAYER.switching || !nativePlayerExpiredAdventureAllowed()) return;
  return nativePlayerTask(async () => {
    const session = NATIVE_PLAYER.provisional, host = NETWS.host;
    const choice = NATIVE_PLAYER.expiredAdventure || { session, host, accountId: NETWS.acct?.id, socketToken: NETWS.token, archived: false };
    NATIVE_PLAYER.expiredAdventure = choice;
    const allowed = () => NATIVE_PLAYER.expiredAdventure === choice && nativePlayerExpiredAdventureAllowed();
    NATIVE_PLAYER.switching = true; nativePlayerRender();
    try {
      const metadata = await session.peek();
      if (!allowed() || (!choice.archived && (!metadata?.expired || metadata.claimedOwnerDid || metadata.targetAvailable || metadata.claimStarted))
        || (choice.archived && metadata !== null)) throw new Error('The character connection changed. Retry before starting a new one.');
      const token = NETWS.token || await netWsToken(host);
      if (!allowed() || !token) throw new Error('The previous game connection is unavailable. Retry before starting a new character.');
      if (!choice.archived) {
        await session.archiveExpired({ isCurrent: allowed }); choice.archived = true;
      }
      if (!allowed()) throw new Error('The game connection changed. The expired browser key was kept. Retry before starting a new character.');
      await netWsTokenForget(host, token, allowed);
      if (!allowed()) throw new Error('The game connection changed. Retry before starting a new character.');
      session.close(); NATIVE_PLAYER.provisional = null; NATIVE_PLAYER.provisionalContext = null;
      NATIVE_PLAYER.provisionalProofToken = ''; NATIVE_PLAYER.provisionalProofContext = null;
      NATIVE_PLAYER.expiredAdventure = null; NATIVE_PLAYER.newAdventure = null; NATIVE_PLAYER.authRefusal = null;
      NATIVE_PLAYER.state = 'identity_unconfirmed';
      NATIVE_PLAYER.status = { enabled: true, bound: false, verified: false, recordLinks: {}, provisionalPlay: NATIVE_PLAYER.status.provisionalPlay };
      if (NETWS.link) NETWS.link.close(); else netWsRetire(NETWS.ws, 'explicit expired character restart');
      NETWS.token = ''; NETWS.acct = null; NETWS.sessionRefusal = null;
      if (!await netLinkWS() || NETWS.host !== host || NETWS.reload || !nativePlayerSwitchIdle()) throw new Error('The new game connection is unavailable. Retry the connection.');
      const accountId = NETWS.acct?.id, nextToken = NETWS.token, generation = NETWS.generation;
      await loadSave({ retry: true });
      if (NETWS.host !== host || NETWS.acct?.id !== accountId || NETWS.token !== nextToken || NETWS.generation !== generation || NETWS.reload) {
        throw new Error('The game connection changed. Retry before playing.');
      }
      NATIVE_PLAYER.message = 'Choose Play now to begin. The expired browser key and all existing private saves were kept.';
    } finally { NATIVE_PLAYER.switching = false; nativePlayerRender(); }
  });
}
function nativePlayerNewAdventure() {
  if (NATIVE_PLAYER.busy || NATIVE_PLAYER.switching || !nativePlayerNewAdventureAllowed()) return;
  return nativePlayerTask(async () => {
    const choice = NATIVE_PLAYER.newAdventure, host = NETWS.host;
    const allowed = () => NATIVE_PLAYER.newAdventure === choice && nativePlayerNewAdventureAllowed();
    NATIVE_PLAYER.switching = true; nativePlayerRender();
    try {
      // Recheck the no-create device read on the explicit click. Another tab's
      // new or pending character must keep its original game connection.
      if (await choice.session.peek() !== null || !allowed()) throw new Error('A character connection changed. Retry its connection before starting a new character.');
      await netWsTokenForget(host, choice.refusal.token, allowed);
      if (!allowed()) throw new Error('The game connection changed. Retry before starting a new character.');
      choice.session.close(); NATIVE_PLAYER.provisional = null; NATIVE_PLAYER.provisionalContext = null;
      NATIVE_PLAYER.provisionalProofToken = ''; NATIVE_PLAYER.provisionalProofContext = null;
      NATIVE_PLAYER.newAdventure = null; NATIVE_PLAYER.authRefusal = null;
      NATIVE_PLAYER.status = { enabled: true, bound: false, verified: false, recordLinks: {} };
      NATIVE_PLAYER.state = 'identity_unconfirmed';
      if (NETWS.link) NETWS.link.close(); else netWsRetire(NETWS.ws, 'explicit new character');
      NETWS.token = ''; NETWS.acct = null; NETWS.sessionRefusal = null;
      if (!await netLinkWS() || NETWS.host !== host || NETWS.reload || !nativePlayerSwitchIdle()) {
        throw new Error('The new game connection is unavailable. Retry the connection.');
      }
      const accountId = NETWS.acct?.id, token = NETWS.token, generation = NETWS.generation;
      await loadSave({ retry: true });
      if (NETWS.host !== host || NETWS.acct?.id !== accountId || NETWS.token !== token || NETWS.generation !== generation || NETWS.reload) {
        throw new Error('The game connection changed. Retry the character connection before playing.');
      }
      if (NATIVE_PLAYER.status?.provisionalPlay?.enabled && !NATIVE_PLAYER.status.bound) {
        NATIVE_PLAYER.message = 'Choose Play now to begin your new character. Existing private saves are kept.';
      }
    } finally { NATIVE_PLAYER.switching = false; nativePlayerRender(); }
  });
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
        else netWsRetire(NETWS.ws, 'explicit title sign-in');
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
      channel.close(); if (NATIVE_PLAYER.channel === channel) NATIVE_PLAYER.channel = null;
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
      popup.close(); channel.close(); if (NATIVE_PLAYER.channel === channel) NATIVE_PLAYER.channel = null; throw error;
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
  NATIVE_PLAYER.provisional?.close(); NATIVE_PLAYER.provisional = null; NATIVE_PLAYER.provisionalContext = null;
  NATIVE_PLAYER.provisionalProofToken = ''; NATIVE_PLAYER.provisionalProofContext = null;
  clearTimeout(SAVE.guestTimer); SAVE.guestTimer = 0;
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


