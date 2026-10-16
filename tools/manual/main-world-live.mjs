/** Explicit mutating manual QA of the real 3D world. No import-time I/O. */
import { generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import { nativeLiveStages } from './native-live-stages.mjs';
import { agentCommandMessage, agentRenewalMessage, agentSessionPossessionMessage } from '../../server/gaming/native-agent-proof.js';
const check = (ok, code) => { if (!ok) throw Object.assign(new Error('Main-world live verification refused.'), { code }); };
export function createMainWorldLiveQa({ config, getPage, signNativeRequest, onStage = () => {} } = {}) {
  let page, description, routes, ownerBody, reference, key, challenge, envelope, admission, sequence = 0;
  let publicationClicked = false, completeAttempted = false, stopped = false, localRevoked = false, podRevoked = false, lastHttp = null;
  let movement = null, commandAttempted = false, needAdmission = false;
  const results = { normalGame: false, signedAdmission: false, mainWorldMoved: false, peerSawMovement: false, renewed: false, negative: [] };
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
          const probe = window.__mainWorldQaPeer = { position: null, seen: 0, socket: null };
          await new Promise((resolve, reject) => {
            const socket = probe.socket = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws');
            const timer = setTimeout(() => reject(Error('peer-timeout')), 15000);
            socket.onopen = () => socket.send(JSON.stringify({ t: 'hello', v: 1, token: n.token, room: n.worldRoom }));
            socket.onerror = () => { clearTimeout(timer); reject(Error('peer-unavailable')); };
            socket.onmessage = event => {
              const m = JSON.parse(event.data);
              if (m.t === 'welcome') { clearTimeout(timer); resolve(); }
              if (m.t === 'denied') { clearTimeout(timer); reject(Error('peer-refused')); }
              if (m.t === 'peer' && m.peer === H.net.NET.self && Array.isArray(m.fast?.p)) { probe.position = m.fast.p; probe.seen++; }
            };
          });
        }
        return { id: n.acct.id, roomId: n.worldRoom, x: H.GAME.player.x, z: H.GAME.player.z };
      });
      check(ownerBody.id && ownerBody.roomId, 'qa_world_body'); results.normalGame = true;
    } },
    { name: 'actual-main-game-public-grant', async run() {
      if (!await page.locator('#world-agent-controls').isVisible()) await page.locator('#btn-net').click();
      await page.locator('#world-agent-controls').waitFor({ state: 'visible', timeout: 30000 });
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
      check(!commandAttempted, 'qa_world_command_uncertain');
      const before = await page.evaluate(() => ({ x: window.__hm.GAME.player.x, z: window.__hm.GAME.player.z, peerSeen: window.__mainWorldQaPeer.seen }));
      movement ||= { type: 'move', commandId: admission.sessionId + ':' + randomUUID(), roomId: ownerBody.roomId, entityId: ownerBody.id, dx: 1, dz: 0, durationMs: 500 };
      const proof = signed(movement); commandAttempted = true;
      const applied = accepted(await call(routes.command, proof)); sequence++;
      await refuse('replay', proof, 'agent_sequence_rejected');
      check(applied.execution === 'owner-page-input-applied', 'qa_world_input_unconfirmed');
      await page.waitForFunction(before => Math.hypot(window.__hm.GAME.player.x - before.x, window.__hm.GAME.player.z - before.z) > .05, before, { timeout: 5000 });
      await page.waitForFunction(before => { const p = window.__mainWorldQaPeer.position;
        return window.__mainWorldQaPeer.seen > before.peerSeen && p && Math.hypot(p[0] - before.x, p[2] - before.z) > .05; }, before, { timeout: 10000 });
      const moved = await page.evaluate(before => Math.hypot(window.__hm.GAME.player.x - before.x, window.__hm.GAME.player.z - before.z), before);
      check(moved > .05 && moved < 6, 'qa_world_physics'); results.mainWorldMoved = true; results.peerSawMovement = true;
      console.log(JSON.stringify({ kind: 'main_world_qa_movement', movedMeters: Math.round(moved * 1000) / 1000, secondAuthenticatedPeer: true, sameOwnerMultiConnection: true }));
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
      if (!await page.locator('#world-agent-controls').isVisible()) await page.locator('#btn-net').click();
      const row = page.locator('#world-agent-records p').filter({ hasText: reference.grantId });
      await row.getByRole('button', { name: 'Revoke access', exact: true }).click();
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
    } },
  ], onStage);
  return Object.freeze({
    status() { return { kind: 'main_world_qa', ...stages.status(), ...results, publicReference: reference || null, localRevoked, podRevoked, lastHttp }; },
    next: async () => { if (needAdmission) await admitNative(); return stages.next(); }, remaining: async () => { if (needAdmission) await admitNative(); return stages.remaining(); },
    restartAdmission() { check(!stopped && reference && completeAttempted && !localRevoked
      && (admission ? admission.expiresAt <= Date.now() : challenge?.expiresAt <= Date.now()), 'qa_world_restart_refused');
      key = challenge = envelope = admission = null; completeAttempted = false; sequence = 0; needAdmission = true; return this.status(); },
    close() { stopped = true; key = envelope = null; },
  });
}
