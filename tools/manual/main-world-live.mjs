/** Explicit mutating manual QA of the real 3D world. No import-time I/O. */
import { generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import { nativeLiveStages } from './native-live-stages.mjs';
import { agentCommandMessage, agentRenewalMessage, agentSessionPossessionMessage } from '../../server/gaming/native-agent-proof.js';
const check = (ok, code) => { if (!ok) throw Object.assign(new Error('Main-world live verification refused.'), { code }); };
const companionId = (ownerId, bodyId) => typeof ownerId === 'string' && typeof bodyId === 'string'
  && bodyId.startsWith(ownerId + ':companion:') && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(bodyId.slice((ownerId + ':companion:').length));
export function mainWorldAdmissionCanRestart({ stopped, reference, localRevoked, completeAttempted, admission, challenge, envelope, now = Date.now() }) {
  return !stopped && !!reference && !localRevoked && (admission
    ? completeAttempted === true && admission.expiresAt <= now
    : !!challenge && challenge.expiresAt <= now && (completeAttempted === true || !envelope));
}
export function mainWorldLiveMotionEvidence(value) {
  check(value && companionId(value.ownerId, value.bodyId) && value.ownerId !== value.bodyId, 'qa_world_separate_body');
  check(value.confirmedCommands === 8 && value.elapsedMs >= 4000 && value.elapsedMs < 90000
    && value.gameElapsed > 0 && value.humanInputObserved && value.overlappingInputObserved, 'qa_world_ordinary_input');
  check(Number.isFinite(value.companionMeters) && value.companionMeters > .05 && value.companionMeters < 30
    && Number.isFinite(value.humanMeters) && value.humanMeters > .05 && value.humanMeters < 60, 'qa_world_physics');
  check(value.peerBodyId === value.bodyId.split(':').at(-1) && value.peerSeen > 0
    && Number.isFinite(value.peerCompanionMeters) && value.peerCompanionMeters > .05, 'qa_world_peer_projection');
  return { distinctCompanion: true, humanInput: true, simultaneousInput: true, ordinaryClock: true,
    confirmedCommands: value.confirmedCommands, movedMeters: Math.round(value.companionMeters * 1000) / 1000,
    humanMovedMeters: Math.round(value.humanMeters * 1000) / 1000,
    elapsedMs: value.elapsedMs, gameElapsed: value.gameElapsed,
    secondAuthenticatedPeer: true, sameOwnerMultiConnection: true };
}
export function createMainWorldLiveQa({ config, getPage, signNativeRequest, onStage = () => {} } = {}) {
  let page, description, routes, ownerBody, reference, key, challenge, envelope, admission, sequence = 0;
  let publicationClicked = false, completeAttempted = false, stopped = false, localRevoked = false, podRevoked = false, revokeClicked = false, lastHttp = null;
  let movement = null, movementBefore = null, needAdmission = false, companionCreateClicked = false, reloadAttempted = false, reloadDocument = null, reloadContinueClicked = false;
  const movementInputs = [];
  const results = { normalGame: false, separateCompanion: false, nativeCompanionSave: false, signedAdmission: false,
    mainWorldMoved: false, humanMoved: false, peerSawMovement: false, renewed: false, paused: false, companionReloaded: false, negative: [] };
  async function call(target, body) {
    check(!stopped && new URL(target).origin === pageOrigin(), 'qa_world_scope');
    const result = await page.evaluate(async ({ target, body }) => {
      const response = await fetch(target, { method: body ? 'POST' : 'GET', cache: 'no-store', redirect: 'error', credentials: 'omit',
        headers: body ? { 'Content-Type': 'application/json' } : {}, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(45000) });
      return { status: response.status, value: await response.json() };
    }, { target, body });
    lastHttp = { status: result.status, code: typeof result.value?.error === 'string' ? result.value.error : null };
    return result;
  }
  const pageOrigin = () => new URL(page.url()).origin;
  const accepted = r => { check(r.status === 200 && r.value.ok === true, 'qa_world_http_refused'); return r.value.result; };
  function signed(command, seq = sequence + 1, at = Date.now()) {
    check(admission?.expiresAt > Date.now(), 'qa_world_admission_expired');
    const request = { sequence: seq, at, method: 'POST', path: new URL(routes.command).pathname, action: command.type,
      roomId: command.roomId, entityId: command.entityId, body: { command } };
    return { sessionId: admission.sessionId, sequence: seq, at, command,
      signature: sign(null, Buffer.from(agentCommandMessage(admission.sessionId, request)), key.privateKey).toString('base64url') };
  }
  async function refuse(name, payload, code) { const r = await call(routes.command, payload); check(r.status === 403 && r.value.error === code, 'qa_world_negative_failed'); if (!results.negative.includes(name)) results.negative.push(name); }
  async function admitNative() {
      if (admission?.expiresAt > Date.now() && results.signedAdmission) return;
      description ||= (await call(pageOrigin() + '/world/native-agents')).value;
      check(description.enabled && description.scope === 'main-world' && description.audience === pageOrigin(), 'qa_world_description');
      routes ||= Object.fromEntries(['challenge', 'complete', 'renew', 'command', 'observe'].map(name => {
        const ops = description.operations.filter(o => o['iep:action']?.['@id'] === 'urn:interego:hallowmarch:main-world-agent:' + name);
        check(ops.length === 1 && ops[0]['hydra:method'] === 'POST' && new URL(ops[0]['hydra:target']).origin === pageOrigin(), 'qa_world_description');
        return [name, ops[0]['hydra:target']];
      }));
      key ||= generateKeyPairSync('ed25519');
      challenge ||= accepted(await call(routes.challenge, { grantId: reference.grantId, sessionPublicKeyJwk: key.publicKey.export({ format: 'jwk' }) }));
      envelope ||= await signNativeRequest({ payload: challenge.payload, expiresAt: challenge.expiresAt });
      check(!completeAttempted, 'qa_world_admission_uncertain'); completeAttempted = true;
      admission = accepted(await call(routes.complete, { challengeId: challenge.challengeId, envelope,
        sessionSignature: sign(null, Buffer.from(agentSessionPossessionMessage(challenge.payload)), key.privateKey).toString('base64url') }));
      check(admission.authority?.durable === true && admission.receipt?.scope.entityId === ownerBody.id
        && admission.receipt.scope.roomId === ownerBody.roomId && admission.expiresAt > Date.now(), 'qa_world_admission_expired');
      results.signedAdmission = true;
      needAdmission = false;
  }
  async function revokeAccess() {
      check(reference && routes && key, 'qa_world_revoke_unavailable');
      if (podRevoked) return;
      if (!await page.locator('#world-agent-controls').isVisible()) await page.locator('#btn-net').click();
      // This fixture publishes exactly one access relationship. Public IDs are
      // intentionally hidden behind the product's advanced details.
      if (!revokeClicked) { revokeClicked = true; await page.locator('#world-agent-records').getByRole('button', { name: 'Revoke access', exact: true }).click(); }
      await page.waitForFunction(id => window.__hm.worldAgents.state.records.get(id)?.localRevoked === true, reference.grantId, { timeout: 90000 }); localRevoked = true;
      const denied = await call(routes.challenge, { grantId: reference.grantId, sessionPublicKeyJwk: key.publicKey.export({ format: 'jwk' }) });
      check(denied.status === 403 && denied.value.error === 'native_grant_unavailable', 'qa_world_local_revocation');
      await page.waitForFunction(id => !window.__hm.worldAgents.state.busy && window.__hm.worldAgents.state.records.get(id)?.grant?.revoked === true, reference.grantId, { timeout: 150000 });
      const final = await page.evaluate(async id => {
        const s = window.__hm.worldAgents.state, record = s.records.get(id), read = await s.client.load(record.reference);
        return { reference: read.reference, head: read.head, revoked: read.grant.revoked };
      }, reference.grantId);
      check(final.revoked === true, 'qa_world_pod_revocation'); podRevoked = true;
      console.log(JSON.stringify({ kind: 'main_world_qa_revoked_reference', ...final }));
      await page.evaluate(() => window.__mainWorldQaPeer?.socket?.close());
      await page.locator('#netsheet-close').click();
  }
  const stages = nativeLiveStages([
    { name: 'actual-main-game-entry', async run() {
      page ||= getPage(); check(page && !page.isClosed(), 'qa_world_owner_page');
      if (!await page.evaluate(() => window.__hm?.GAME.started)) await page.locator('#btn-continue').click();
      await page.waitForFunction(() => window.__hm?.GAME.started && window.__hm.net.NETWS.state === 'on', null, { timeout: 60000 });
      const skip = page.getByRole('button', { name: 'Skip the prologue', exact: true }); if (await skip.isVisible()) await skip.click();
      ownerBody = await page.evaluate(async () => {
        const H = window.__hm, n = H.net.NETWS;
        if (document.querySelector('#gaming-menu-open') || document.querySelector('#gaming-mobile-open') || !document.querySelector('#gaming-sheet')?.hidden) throw Error('normal-game-flow');
        // A second authenticated socket observes the existing March protocol;
        // its app proof stays in the owner browser and never leaves this page.
        if (!window.__mainWorldQaPeer) {
          const probe = window.__mainWorldQaPeer = { position: null, seen: 0, socket: null, bodyId: null, companion: null, companionSeen: 0, companionMax: 0 };
          await new Promise((resolve, reject) => {
            const socket = probe.socket = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws');
            const timer = setTimeout(() => reject(Error('peer-timeout')), 15000);
            socket.onopen = () => socket.send(JSON.stringify({ t: 'hello', v: 1, token: n.token, room: n.worldRoom }));
            socket.onerror = () => { clearTimeout(timer); reject(Error('peer-unavailable')); };
            socket.onmessage = event => {
              const m = JSON.parse(event.data);
              if (m.t === 'welcome') { clearTimeout(timer); resolve(); }
              if (m.t === 'denied') { clearTimeout(timer); reject(Error('peer-refused')); }
              if (m.t === 'peer' && m.peer === H.net.NET.self) {
                if (Array.isArray(m.fast?.p)) { probe.position = m.fast.p; probe.seen++; }
                if (m.fast?.pc?.id === probe.bodyId && Array.isArray(m.fast.pc.p)) {
                  probe.companion = m.fast.pc.p; probe.companionSeen++;
                  if (probe.before) probe.companionMax = Math.max(probe.companionMax, Math.hypot(probe.companion[0] - probe.before.x, probe.companion[2] - probe.before.z));
                }
              }
            };
          });
        }
        return { ownerId: n.acct.id, roomId: n.worldRoom };
      });
      check(ownerBody.ownerId && ownerBody.roomId, 'qa_world_body'); results.normalGame = true;
    } },
    { name: 'actual-party-companion-native-save', async run() {
      if (!await page.locator('#world-agent-controls').isVisible()) await page.locator('#btn-net').click();
      await page.locator('#world-agent-controls').waitFor({ state: 'visible', timeout: 30000 });
      if (!companionCreateClicked) {
        check(await page.evaluate(() => window.__hm.worldAgents.bodies().length === 0), 'qa_world_existing_body');
        await page.locator('#world-agent-companion-name').fill('Synthetic QA companion');
        companionCreateClicked = true;
        await page.locator('#world-agent-create').click();
      }
      await page.waitForFunction(() => !window.__hm.worldAgents.state.busy && window.__hm.worldAgents.bodies().length === 1
        && !window.__hm.SAVE.pending && !window.__hm.SAVE.nativeFlight, null, { timeout: 150000 });
      const body = await page.evaluate(() => {
        const h = window.__hm, b = h.worldAgents.bodies()[0], saved = JSON.parse(h.SAVE.lastBody)?.char?.x?.partyCompanion;
        return b && saved ? { id: b.id, separate: b.entity !== h.GAME.player, alive: b.entity.alive,
          uuid: saved.id, confirmed: h.SAVE.native && h.SAVE.readConfirmed && !h.SAVE.pending && !h.SAVE.nativeFlight } : null;
      });
      check(body?.confirmed && body.separate && body.alive && companionId(ownerBody.ownerId, body.id)
        && body.id.endsWith(':' + body.uuid), 'qa_world_companion_save');
      ownerBody = { ...ownerBody, id: body.id, uuid: body.uuid };
      // A guard role prevents ordinary follow behaviour from being mistaken
      // for agent movement while the human walks independently.
      await page.locator('#world-agent-party-role').selectOption('guard');
      await page.evaluate(() => window.__hm.fn.saveNow());
      await page.waitForFunction(() => !window.__hm.SAVE.pending && !window.__hm.SAVE.nativeFlight, null, { timeout: 150000 });
      results.separateCompanion = true; results.nativeCompanionSave = true;
    } },
    { name: 'actual-main-game-public-grant', async run() {
      if (!await page.locator('#world-agent-controls').isVisible()) await page.locator('#btn-net').click();
      await page.locator('#world-agent-controls').waitFor({ state: 'visible', timeout: 30000 });
      if (!await page.locator('#world-agent-advanced').evaluate(element => element.open)) await page.locator('#world-agent-advanced > summary').click();
      if (!publicationClicked) {
        await page.locator('#world-agent-body').selectOption(ownerBody.id);
        await page.locator('#world-agent-did').fill(config.agentDid);
        await page.locator('#world-agent-role').selectOption('teammate');
        await page.locator('#world-agent-public').check(); publicationClicked = true;
        await page.locator('#world-agent-form button').click();
      }
      await page.waitForFunction(() => !window.__hm.worldAgents.state.busy, null, { timeout: 150000 });
      const state = await page.evaluate(async () => {
        const record = [...window.__hm.worldAgents.state.records.values()][0];
        if (!record) return null;
        if (record.phase) return { pending: true, phase: record.phase, reference: record.reference };
        const read = await window.__hm.worldAgents.state.client.load(record.reference);
        return { ...read, registered: record.registered };
      });
      check(state?.registered && !state.pending && state.grant?.actor === config.agentDid && !state.grant.revoked
        && state.grant.entityId === ownerBody.id && state.grant.roomId === ownerBody.roomId, 'qa_world_grant_pending');
      reference = state.reference;
      console.log(JSON.stringify({ kind: 'main_world_qa_public_reference', ...reference, head: state.head }));
      await page.locator('#world-agent-resume').click(); await page.locator('#netsheet-close').click();
      await page.bringToFront();
      await page.waitForFunction(() => window.__hm.worldAgents.state.lastFrame > 0 && !window.__hm.UI.modal, null, { timeout: 10000 });
    } },
    { name: 'actual-main-game-native-admission', async run() {
      await admitNative();
    } },
    { name: 'actual-main-game-movement-and-peer', async run() {
      check(!movementInputs.some(item => item.attempted && !item.confirmed), 'qa_world_command_uncertain');
      movementBefore ||= await page.evaluate(bodyId => {
        const h = window.__hm, b = h.worldAgents.bodies().find(b => b.id === bodyId), peer = window.__mainWorldQaPeer;
        if (!b || b.entity === h.GAME.player) throw Error('separate-body');
        const before = { x: b.entity.x, z: b.entity.z, humanX: h.GAME.player.x, humanZ: h.GAME.player.z, gameTime: h.GAME.t, at: Date.now() };
        peer.bodyId = bodyId.split(':').at(-1); peer.before = before; peer.companionMax = 0; peer.companionSeen = 0;
        const probe = window.__mainWorldQaMotion = { companionMax: 0, humanMax: 0, humanInputObserved: false, overlappingInputObserved: false, before, timer: null };
        // Passive observation only: neither the game clock nor simulation
        // state, animation frames or movement functions are replaced.
        probe.timer = setInterval(() => {
          const b = h.worldAgents.bodies().find(b => b.id === bodyId), held = h.INPUT.keys.has('KeyW');
          probe.humanInputObserved ||= held;
          probe.humanMax = Math.max(probe.humanMax, Math.hypot(h.GAME.player.x - before.humanX, h.GAME.player.z - before.humanZ));
          if (b && h.worldAgents.state.intent?.entity === b.entity) {
            probe.companionMax = Math.max(probe.companionMax, Math.hypot(b.entity.x - before.x, b.entity.z - before.z));
            probe.overlappingInputObserved ||= held;
          }
        }, 25);
        return before;
      }, ownerBody.id);
      movement ||= { type: 'move', roomId: ownerBody.roomId, entityId: ownerBody.id, dx: 1, dz: 0, durationMs: 500 };
      await page.bringToFront(); await page.keyboard.down('w');
      try {
        for (let index = 0; index < 8; index++) {
          const item = movementInputs[index] ||= { command: { ...movement, commandId: admission.sessionId + ':' + randomUUID() }, attempted: false, confirmed: false };
          if (item.confirmed) continue;
          const proof = signed(item.command); item.attempted = true;
          const applied = accepted(await call(routes.command, proof)); sequence++;
          check(applied.execution === 'owner-page-input-applied', 'qa_world_input_unconfirmed'); item.confirmed = true;
          if (index === 0) await refuse('replay', proof, 'agent_sequence_rejected');
          await page.waitForTimeout(550);
        }
      } finally { await page.keyboard.up('w'); }
      await page.waitForFunction(() => window.__mainWorldQaPeer.companionMax > .05, null, { polling: 100, timeout: 15000 });
      const sampled = await page.evaluate(() => {
        const h = window.__hm, p = window.__mainWorldQaMotion, peer = window.__mainWorldQaPeer;
        clearInterval(p.timer); p.timer = null;
        return { companionMeters: p.companionMax, humanMeters: p.humanMax, humanInputObserved: p.humanInputObserved,
          overlappingInputObserved: p.overlappingInputObserved, elapsedMs: Date.now() - p.before.at,
          gameElapsed: h.GAME.t - p.before.gameTime, peerBodyId: peer.bodyId, peerSeen: peer.companionSeen, peerCompanionMeters: peer.companionMax };
      });
      const evidence = mainWorldLiveMotionEvidence({ ...sampled, ownerId: ownerBody.ownerId, bodyId: ownerBody.id,
        confirmedCommands: movementInputs.filter(item => item.confirmed).length });
      results.mainWorldMoved = true; results.humanMoved = true; results.peerSawMovement = true;
      console.log(JSON.stringify({ kind: 'main_world_qa_movement', ...evidence }));
    } },
    { name: 'actual-main-game-scope-renewal-and-observation', async run() {
      const at = Date.now(), next = sequence + 1;
      const renewed = accepted(await call(routes.renew, { sessionId: admission.sessionId, sequence: next, at,
        signature: sign(null, Buffer.from(agentRenewalMessage(admission.sessionId, { sequence: next, at })), key.privateKey).toString('base64url') }));
      sequence = next; admission.expiresAt = renewed.expiresAt; results.renewed = true;
      const testCommand = { ...movement, commandId: admission.sessionId + ':' + randomUUID() };
      await refuse('wrong-body', signed({ ...testCommand, entityId: 'another-owner' }), 'agent_scope_rejected');
      await refuse('wrong-room', signed({ ...testCommand, roomId: 'another-room' }), 'agent_scope_rejected');
      const forged = signed(testCommand); forged.signature = 'A'.repeat(86); await refuse('forged-signature', forged, 'invalid_session_signature');
      await refuse('stale-command', signed(testCommand, sequence + 1, Date.now() - 60000), 'agent_command_expired');
      const observe = { roomId: ownerBody.roomId, entityId: ownerBody.id }, seq = sequence + 1, time = Date.now();
      const read = accepted(await call(routes.observe, { ...observe, sessionId: admission.sessionId, sequence: seq, at: time,
        signature: sign(null, Buffer.from(agentCommandMessage(admission.sessionId, { sequence: seq, at: time, method: 'POST',
          path: new URL(routes.observe).pathname, action: 'observe', ...observe, body: observe })), key.privateKey).toString('base64url') }));
      sequence = seq;
      check(read.state?.body?.id === ownerBody.id && !/private-native-qa-|accessToken|refreshToken|inventory|chat|recovery/.test(JSON.stringify(read)), 'qa_world_observation_privacy');
    } },
    { name: 'actual-main-game-owner-revocation', async run() {
      if (!results.paused) {
        if (!await page.locator('#world-agent-controls').isVisible()) await page.locator('#btn-net').click();
        await page.locator('#world-agent-pause').click();
        await page.waitForFunction(() => window.__hm.worldAgents.state.paused && !window.__hm.worldAgents.state.intent, null, { timeout: 10000 });
        // Opening Players also pauses dispatch. The explicit product Pause
        // must remain in force once the panel is closed.
        await page.locator('#netsheet-close').click();
        await page.waitForTimeout(700);
        await refuse('owner-pause', signed({ ...movement, commandId: admission.sessionId + ':' + randomUUID() }), 'native_body_forbidden');
        results.paused = true;
      }
      await revokeAccess();
    } },
    { name: 'actual-party-companion-reload-persistence', async run() {
      if (!reloadAttempted) {
        await page.evaluate(() => window.__hm.fn.saveNow());
        await page.waitForFunction(() => !window.__hm.SAVE.pending && !window.__hm.SAVE.nativeFlight, null, { timeout: 150000 });
        const saved = await page.evaluate(uuid => {
          const h = window.__hm, s = JSON.parse(h.SAVE.lastBody)?.char?.x?.partyCompanion;
          return !!(h.SAVE.native && s?.id === uuid && s.role === 'guard');
        }, ownerBody.uuid);
        check(saved, 'qa_world_companion_save');
        reloadDocument = randomUUID(); await page.evaluate(marker => { window.__mainWorldQaReloadDocument = marker; }, reloadDocument);
        reloadAttempted = true; await page.reload({ waitUntil: 'domcontentloaded' });
      }
      await page.waitForFunction(({ marker, ownerId, uuid }) => {
        const h = window.__hm;
        return window.__mainWorldQaReloadDocument !== marker && h?.ready && h.SAVE.native
          && h.net.NETWS.acct?.id === ownerId && h.SAVE.loaded?.char?.x?.partyCompanion?.id === uuid;
      }, { marker: reloadDocument, ownerId: ownerBody.ownerId, uuid: ownerBody.uuid }, { timeout: 180000 });
      if (!await page.evaluate(() => window.__hm.GAME.started) && !reloadContinueClicked) {
        reloadContinueClicked = true; await page.locator('#btn-continue').click();
      }
      await page.waitForFunction(({ id, uuid }) => {
        const h = window.__hm, b = h?.worldAgents?.bodies().find(b => b.id === id);
        return h?.GAME.started && b?.entity !== h.GAME.player && b?.id.endsWith(':' + uuid)
          && h.SAVE.loaded.char.x.partyCompanion.role === 'guard';
      }, { id: ownerBody.id, uuid: ownerBody.uuid }, { timeout: 60000 });
      results.companionReloaded = true;
    } },
  ], onStage);
  return Object.freeze({
    status() { return { kind: 'main_world_qa', ...stages.status(), ...results, publicReference: reference || null, localRevoked, podRevoked, reloadAttempted, lastHttp }; },
    async diagnose() { if (!page || page.isClosed()) return { pageAvailable: false }; return page.evaluate(() => {
      const h = window.__hm, p = h?.GAME.player, peer = window.__mainWorldQaPeer;
        return { t: h?.GAME.t, position: p ? { x:p.x, y:p.y, z:p.z, alive:p.alive } : null,
        companionCount:h?.worldAgents.bodies().length, modal:h?.UI.modal,
        paused:h?.worldAgents.state.paused, hasIntent:!!h?.worldAgents.state.intent, humanKeys:h ? [...h.INPUT.keys].filter(k=>/^Key[WASD]$|^Arrow/.test(k)) : [],
        gameErrors:h?.errors.length, peerSeen:peer?.seen, peerPosition:peer?.position, network:h?.net.state().state, fastSent:h?.net.NET.stats.fastSent }; }); },
    revoke: () => revokeAccess(),
    next: async () => { if (needAdmission) await admitNative(); return stages.next(); }, remaining: async () => { if (needAdmission) await admitNative(); return stages.remaining(); },
    restartAdmission() { check(mainWorldAdmissionCanRestart({ stopped, reference, completeAttempted, localRevoked, admission, challenge, envelope }), 'qa_world_restart_refused');
      key = challenge = envelope = admission = null; completeAttempted = false; sequence = 0; needAdmission = true; return this.status(); },
    close() { stopped = true; key = envelope = null; },
  });
}
