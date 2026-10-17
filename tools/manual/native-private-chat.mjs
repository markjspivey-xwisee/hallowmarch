/** Explicit manual QA of two synthetic PRIVATE party messages. No import-time I/O. */
const flights = new WeakMap();

/** Self-contained browser port. Never substitute party membership with a label. */
export async function nativePrivateChatStep({ action, run, gameOrigin }) {
  const fixed = new Set(['qa_chat_scope', 'qa_chat_owner', 'qa_chat_party', 'qa_chat_peer', 'qa_chat_protocol',
    'qa_chat_timeout', 'qa_chat_already_attempted', 'qa_chat_control', 'qa_chat_errors']);
  const fail = code => { throw Object.assign(Error('Private native QA chat refused.'), { code }); };
  let phase = action === 'start' ? 'private-party-setup' : action === 'cleanup' ? 'cleanup' : 'private-chat';
  let retained = null, scopeVerified = false;
  try {
    if (!/^[0-9]{17}-[a-f0-9]{8}$/.test(run || '') || !['start', 'open-owner', 'send-and-receive', 'cleanup'].includes(action)
      || typeof gameOrigin !== 'string' || new URL(gameOrigin).protocol !== 'https:' || new URL(gameOrigin).origin !== gameOrigin) fail('qa_chat_scope');
    retained = globalThis.__hmNativePrivateChatQa;
    if (!retained && action === 'start') {
      const H = globalThis.__hm, n = H?.net?.NETWS, N = H?.net?.NET, U = H?.net?.NETUI;
      const socket = globalThis.__mainWorldQaPeer?.socket, ownerSocket = n?.ws;
      const token = n?.token, generation = n?.generation, accountId = n?.acct?.id, self = N?.self;
      const room = 'native-qa-' + run.slice(-8), peerName = 'Native QA peer ' + run;
      const ownerText = 'Native QA ' + run + ' owner to private peer';
      const peerText = 'Native QA ' + run + ' private peer to owner';
      const errorCount = H?.errors?.length, deadline = Date.now() + 20000;
      let peerId = null, party = null, invitation = false, acceptance = false, ownerPartyEcho = false, peerPartyEcho = false;
      let profileAttempted = false, inviteAttempted = false, ownerAttempted = false, peerAttempted = false, ownerUiAccepted = false;
      let peerReceived = false, ownerReceived = false, displayed = false, retired = false, stopped = false;
      let fastSequence = 0, eventSequence = 0, ownerSayId = null, peerSayId = null;
      let progressStep = 'initial', slowProfileSent = false, peerJoinAttempted = false, peerJoinSent = false;
      const observed = { ownerSlowFrames: 0, ownerFastFrames: 0, ownerInviteEvents: 0,
        peerSlowFrames: 0, peerFastFrames: 0, peerAcceptEvents: 0 };
      const count = name => { observed[name] = Math.min(4096, observed[name] + 1); };
      const current = (timed = true) => {
        if (globalThis.__hmNativePrivateChatQa !== retained || location.origin !== gameOrigin || globalThis.__hm !== H
          || H.net.NETWS !== n || H.net.NET !== N || H.net.NETUI !== U || !H.GAME?.started || !H.GAME.player?.alive
          || n.state !== 'on' || n.reload || n.worldPauseReason || n.acct?.nativeBound !== true || n.acct.id !== accountId
          || !token || n.token !== token || !Number.isSafeInteger(generation) || n.generation !== generation
          || localStorage.getItem('hallowmarch.token.' + location.host) !== token || n.worldRoom !== room || N.self !== self
          || n.ws !== ownerSocket || ownerSocket?.readyState !== 1 || socket?.readyState !== 1
          || globalThis.__mainWorldQaPeer?.socket !== socket || new URL(socket.url).host !== new URL(gameOrigin).host
          || new URL(socket.url).pathname !== '/ws') fail('qa_chat_owner');
        if (timed && (stopped || Date.now() >= deadline)) fail('qa_chat_timeout');
        if (!Array.isArray(H.errors) || H.errors.length !== errorCount) fail('qa_chat_errors');
      };
      const member = () => {
        current();
        const peers = [...N.peers.values()].filter(value => value.slow?.on && value.slow.pt === party);
        if (!party || !/^[a-z0-9]{4,24}$/.test(party) || N.party !== party || N.partyLead !== true || !invitation || !acceptance
          || !ownerPartyEcho || !peerPartyEcho || peers.length !== 1 || peers[0].peer !== peerId
          || peers[0].by !== accountId || peers[0].slow.dn !== peerName) fail('qa_chat_party');
      };
      const wait = async predicate => {
        while (!predicate()) { current(); await new Promise(resolve => setTimeout(resolve, 50)); }
        current();
      };
      const send = message => { current(); socket.send(JSON.stringify(message)); };
      const slow = joined => ({ v: 1, on: 1, n: 'Native QA peer', dn: peerName, r: H.GAME.player.faction,
        c: H.GAME.player.cls, l: H.GAME.prog.level, rr: 1, ...(joined ? { pt: party, pl: 0 } : {}) });
      const fast = event => {
        const p = H.GAME.player;
        return { t: 'fast', d: { s: ++fastSequence, t: Math.round(performance.now()), p: [p.x, p.y, p.z], y: p.yaw || 0,
          v: [0, 0], a: 0, h: Math.max(0, Math.min(1, p.hp / p.maxHp)), m: p.maxHp, d: 0, mo: 0, ph: 0, sw: 0, st: 0, cs: 0, fl: 0, tg: '', ev: [event] } };
      };
      const events = message => message.t === 'peer' && Array.isArray(message.fast?.ev) ? message.fast.ev
        : message.t === 'ev' && Array.isArray(message.ev) ? message.ev : [];
      const fromOwner = event => {
        try {
          const message = JSON.parse(event.data); if (message.peer !== self) return;
          if (message.t === 'peer' && message.slow !== undefined) {
            count('ownerSlowFrames'); ownerPartyEcho = !!party && message.slow?.on === 1 && message.slow.pt === party;
          }
          if (message.t === 'peer' && message.fast !== undefined) count('ownerFastFrames');
          for (const ev of events(message)) {
            if (ev[1] === 'inv' && ev[2] === peerId) count('ownerInviteEvents');
            if (ev[1] === 'inv' && ev[2] === peerId && ev[3] === party && party) invitation = true;
            if (message.t === 'peer' && Array.isArray(message.fast?.ev) && ev[1] === 'say' && ev[2] === 0
              && Array.isArray(ev[3]) && ev[3][0] === 'p' && ev[3][1] === ownerText && ev[3][2] === party && ownerAttempted) {
              if (ownerSayId !== null && ownerSayId !== ev[0]) { stopped = true; return; }
              ownerSayId = ev[0]; peerReceived = true;
            }
          }
        } catch { stopped = true; }
      };
      const fromPeer = event => {
        try {
          const message = JSON.parse(event.data); if (!peerId || message.peer !== peerId) return;
          if (message.t === 'peer' && message.slow !== undefined) {
            count('peerSlowFrames'); peerPartyEcho = !!party && message.slow?.on === 1 && message.slow.pt === party;
          }
          if (message.t === 'peer' && message.fast !== undefined) count('peerFastFrames');
          for (const ev of events(message)) {
            if (ev[1] === 'pa' && ev[2] === self) count('peerAcceptEvents');
            if (ev[1] === 'pa' && ev[2] === self && ev[3] === 1) acceptance = true;
            if (message.t === 'peer' && Array.isArray(message.fast?.ev) && ev[1] === 'say' && ev[2] === 0
              && Array.isArray(ev[3]) && ev[3][0] === 'p' && ev[3][1] === peerText && ev[3][2] === party && peerAttempted) {
              if (peerSayId !== null && peerSayId !== ev[0]) { stopped = true; return; }
              peerSayId = ev[0]; ownerReceived = true;
            }
          }
        } catch { stopped = true; }
      };
      const progress = () => {
        let originalContextValid = false;
        try { current(false); originalContextValid = true; } catch { /* A failed guard grants no new action. */ }
        return { step: progressStep, originalContextValid, slowProfileAttempted: profileAttempted, slowProfileSent,
          peerObserved: !!peerId, inviteAttempted, invitationObserved: invitation, ownerPartyEcho,
          peerJoinAttempted, peerJoinSent, acceptanceObserved: acceptance, peerPartyEcho,
          ownerSendAttempted: ownerAttempted, peerSendAttempted: peerAttempted,
          ownerUiAccepted, peerReceivedOwnerFastSay: peerReceived, ownerReceivedPeerFastSay: ownerReceived,
          ownerDisplayedPeerReply: displayed, ...observed };
      };
      retained = globalThis.__hmNativePrivateChatQa = Object.freeze({
        matches: (label, origin) => label === run && origin === gameOrigin,
        progress,
        async start() {
          current(); if (inviteAttempted || N.party || N.invites.length) fail('qa_chat_already_attempted');
          if ([...N.peers.values()].some(value => value.slow?.on)) fail('qa_chat_peer');
          socket.addEventListener('message', fromOwner); ownerSocket.addEventListener('message', fromPeer);
          profileAttempted = true; send({ t: 'slow', d: slow(false) }); slowProfileSent = true; progressStep = 'slow-profile-sent';
          await wait(() => {
            const peers = [...N.peers.values()].filter(value => value.by === accountId && value.slow?.on && value.slow.dn === peerName);
            if (peers.length > 1) fail('qa_chat_peer');
            peerId = peers[0]?.peer || null; return !!peerId;
          });
          progressStep = 'peer-observed';
          current(); if (N.party || N.invites.length) fail('qa_chat_party');
          progressStep = 'invite-attempted'; inviteAttempted = true; if (H.net.invite(peerId) !== true) fail('qa_chat_protocol');
          party = N.party; if (!/^[a-z0-9]{4,24}$/.test(party || '') || !N.partyLead) fail('qa_chat_party');
          progressStep = 'awaiting-invitation-and-owner-party';
          await wait(() => invitation && ownerPartyEcho);
          current(); if (N.party !== party) fail('qa_chat_party');
          progressStep = 'peer-join-attempted'; peerJoinAttempted = true;
          send({ t: 'slow', d: slow(true) });
          send(fast([++eventSequence, 'pa', self, 1]));
          peerJoinSent = true; progressStep = 'awaiting-acceptance-and-peer-party';
          await wait(() => acceptance && peerPartyEcho && N.peers.get(peerId)?.slow?.pt === party);
          member(); progressStep = 'private-party-ready'; return { ok: true, phase: 'private-party-ready', progress: progress() };
        },
        async open() {
          member(); if (ownerAttempted || peerAttempted) fail('qa_chat_already_attempted');
          await wait(() => performance.now() - U.sayAt >= 1100);
          member(); H.net.chatOpen('p');
          if (U.chan !== 'p' || !U.chatOpen) fail('qa_chat_party');
          progressStep = 'owner-input-open'; return { ok: true, phase: 'private-owner-input', progress: progress() };
        },
        async exchange() {
          member(); if (ownerAttempted || peerAttempted) fail('qa_chat_already_attempted');
          const input = document.getElementById('netchat-in'), button = document.getElementById('netchat-go');
          if (!input || !button || button.disabled || input.value !== ownerText || U.chan !== 'p' || !U.chatOpen) fail('qa_chat_control');
          const before = N.evSeq, chatOut = N.stats.chatOut;
          // Membership, channel, original session and the one real UI click
          // share a browser turn. Party chat must never fall back to realm.
          member(); progressStep = 'owner-send-attempted'; ownerAttempted = true; button.click();
          const sent = N.out.filter(value => value.e?.[0] > before && value.e[1] === 'say');
          if (sent.length !== 1 || sent[0].e[3]?.[0] !== 'p' || sent[0].e[3][1] !== ownerText || sent[0].e[3][2] !== party
            || N.stats.chatOut !== chatOut + 1) fail('qa_chat_protocol');
          ownerUiAccepted = true;
          await wait(() => peerReceived); member();
          progressStep = 'peer-send-attempted'; peerAttempted = true; send(fast([++eventSequence, 'say', 0, ['p', peerText, party]]));
          await wait(() => {
            displayed = U.lines.some(value => value.ch === 'p' && value.who === peerName && value.text === peerText);
            return ownerReceived && displayed;
          });
          member(); progressStep = 'reply-displayed'; return { ok: true, privateParty: true, ownerUiSend: ownerUiAccepted, peerReceivedOwnerFastSay: peerReceived,
            ownerReceivedPeerFastSay: ownerReceived, ownerDisplayedPeerReply: displayed, ownerMessages: 1, peerMessages: 1, newGameErrors: 0, progress: progress() };
        },
        cleanup() {
          socket.removeEventListener('message', fromOwner); ownerSocket.removeEventListener('message', fromPeer);
          if (retired) return { ok: false, phase: 'cleanup', code: 'qa_chat_already_attempted' };
          current(false);
          // Retire only this actual synthetic profile/party. No chat is sent.
          if (party && N.party !== party) fail('qa_chat_party');
          if (party) H.net.leave();
          if (profileAttempted) socket.send(JSON.stringify({ t: 'slow', d: { v: 1, on: 0 } }));
          retired = true; stopped = true;
          return { ok: true, cleanupConfirmed: true };
        },
      });
    }
    if (!retained?.matches?.(run, gameOrigin)) fail('qa_chat_scope');
    scopeVerified = true;
    if (action === 'start') return await retained.start();
    if (action === 'open-owner') return await retained.open();
    if (action === 'send-and-receive') return await retained.exchange();
    return retained.cleanup();
  } catch (error) {
    return { ok: false, phase, code: fixed.has(error?.code) ? error.code : 'qa_chat_protocol',
      ...(scopeVerified ? { progress: retained.progress() } : {}) };
  }
}

/** The owner sends through the actual input and button, once. Raw browser
 * errors, private session proofs and message contents never leave this port. */
export function verifyNativePrivateChat({ page, run, gameOrigin }) {
  if (!page || typeof page.evaluate !== 'function') return Promise.resolve({ ok: false, phase: 'scope', code: 'qa_chat_scope' });
  const existing = flights.get(page);
  if (existing) return existing.run !== run || existing.gameOrigin !== gameOrigin
    ? Promise.resolve({ ok: false, phase: 'scope', code: 'qa_chat_scope' })
    : existing.settled ? Promise.resolve({ ok: false, phase: 'private-chat', code: 'qa_chat_already_attempted' }) : existing.task;
  const task = (async () => {
    const deadline = Date.now() + 20000;
    let pageErrors = 0, result = { ok: false, phase: 'private-party-setup', code: 'qa_chat_browser_unconfirmed' };
    const onError = () => { pageErrors++; };
    page.on('pageerror', onError);
    try {
      for (const action of ['start', 'open-owner']) {
        result = await page.evaluate(nativePrivateChatStep, { action, run, gameOrigin });
        if (result?.ok !== true) return result;
        if (pageErrors) return { ok: false, phase: 'private-chat', code: 'qa_chat_errors' };
      }
      await page.locator('#netchat-in').fill('Native QA ' + run + ' owner to private peer', { timeout: Math.max(1, deadline - Date.now()) });
      result = pageErrors ? { ok: false, phase: 'private-chat', code: 'qa_chat_errors' }
        : await page.evaluate(nativePrivateChatStep, { action: 'send-and-receive', run, gameOrigin });
    } catch { result = { ok: false, phase: 'private-chat', code: 'qa_chat_browser_unconfirmed' }; }
    finally {
      try {
        const cleaned = await page.evaluate(nativePrivateChatStep, { action: 'cleanup', run, gameOrigin });
        if (result?.ok === true) result = cleaned?.ok === true ? { ...result, cleanupConfirmed: true } : cleaned;
      } catch { result = { ok: false, phase: 'cleanup', code: 'qa_chat_browser_unconfirmed' }; }
      page.off('pageerror', onError);
      if (pageErrors) result = { ok: false, phase: 'private-chat', code: 'qa_chat_errors', ...(result?.progress ? { progress: result.progress } : {}) };
    }
    return result?.ok === true ? { ...result, newPageErrors: 0 } : result;
  })();
  // Retain the one attempt even after uncertainty. Calling again cannot click
  // or send a second message under a fresh command identity.
  const record = { run, gameOrigin, task, settled: false };
  flights.set(page, record);
  void task.then(() => { record.settled = true; }, () => { record.settled = true; });
  return task;
}
