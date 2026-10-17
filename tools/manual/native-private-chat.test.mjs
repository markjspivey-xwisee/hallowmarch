import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { EventEmitter } from 'node:events';
import { nativePrivateChatStep, verifyNativePrivateChat } from './native-private-chat.mjs';
const run = '20261017000000000-1234abcd', gameOrigin = 'https://game.example';
const ownerText = 'Native QA ' + run + ' owner to private peer', peerText = 'Native QA ' + run + ' private peer to owner';
function fixture({ beforeFill, initialParty = '', stallAt = null } = {}) {
  const messages = [], counts = { clicks: 0, invites: 0, peerSay: 0, leave: 0 };
  let fixtureClock = 0;
  const fixtureDate = stallAt ? class extends Date { static now() { return fixtureClock; } } : Date;
  const fixtureTimeout = stallAt ? callback => { fixtureClock += 10000; return setTimeout(callback, 0); } : setTimeout;
  class Socket {
    readyState = 1; url = 'wss://game.example/ws'; listeners = new Set();
    addEventListener(_name, listener) { this.listeners.add(listener); }
    removeEventListener(_name, listener) { this.listeners.delete(listener); }
    emit(message) { for (const listener of [...this.listeners]) listener({ data: JSON.stringify(message) }); }
  }
  const peer = new Socket(), ownerSocket = new Socket();
  const N = { self: 'actual-owner-peer', party: initialParty, partyLead: false, invites: [], peers: new Map(), evSeq: 0, out: [], stats: { chatOut: 0 } };
  const U = { chan: 'r', sayAt: 0, chatOpen: false, lines: [] };
  const n = { ws: ownerSocket, token: 'NEVER_OUTPUT_TOKEN', generation: 1, acct: { id: 'qa-account', nativeBound: true }, state: 'on', worldRoom: 'native-qa-' + run.slice(-8) };
  const input = { value: '' }, button = { disabled: false, click() {
    counts.clicks++; const event = [++N.evSeq, 'say', 0, [U.chan, input.value, N.party]];
    N.out.push({ e: event }); N.stats.chatOut++;
    peer.emit({ t: 'peer', peer: N.self, fast: { ev: [event] } });
    input.value = ''; U.chatOpen = false;
  } };
  const H = { GAME: { started: true, prog: { level: 1 }, player: { alive: true, faction: 0, cls: 'warrior', x: 1, y: 2, z: 3, hp: 10, maxHp: 10 } }, errors: [],
    net: { NETWS: n, NET: N, NETUI: U, invite(id) {
      counts.invites++; assert.equal(id, 'actual-server-peer'); N.party = 'fixtureparty'; N.partyLead = true;
      queueMicrotask(() => {
        if (stallAt !== 'owner-party') peer.emit({ t: 'peer', peer: N.self, slow: { on: 1, pt: N.party } });
        if (stallAt !== 'invitation') peer.emit({ t: 'peer', peer: N.self, fast: { ev: [[1, 'inv', id, N.party]] } });
      }); return true;
    }, chatOpen(ch) { U.chan = ch === 'p' && N.party ? 'p' : 'r'; U.chatOpen = true; input.value = ''; },
    leave() { counts.leave++; N.party = ''; N.partyLead = false; } } };
  peer.send = raw => {
    const m = JSON.parse(raw); messages.push(m);
    if (m.t === 'slow' && m.d.on === 1) {
      const record = { peer: 'actual-server-peer', by: n.acct.id, slow: m.d };
      if (stallAt !== 'peer') N.peers.set(record.peer, record);
      if (m.d.pt && stallAt !== 'peer-party') ownerSocket.emit({ t: 'peer', peer: record.peer, slow: m.d });
    }
    if (m.t === 'fast') {
      const event = m.d.ev[0];
      if (!(stallAt === 'acceptance' && event[1] === 'pa')) ownerSocket.emit({ t: 'peer', peer: 'actual-server-peer', fast: m.d });
      if (event[1] === 'say') {
        counts.peerSay++; U.lines.push({ ch: event[3][0], who: 'Native QA peer ' + run, text: event[3][1] });
      }
    }
  };
  const context = vm.createContext({ Date: fixtureDate, Set, Object, Promise, Error, JSON, URL, Number, Array, setTimeout: fixtureTimeout, performance: { now: () => 10000 },
    location: { origin: gameOrigin, host: 'game.example' }, localStorage: { getItem: () => 'NEVER_OUTPUT_TOKEN' },
    __hm: H, __mainWorldQaPeer: { socket: peer }, document: { getElementById: id => id === 'netchat-in' ? input : id === 'netchat-go' ? button : null } });
  const step = vm.runInContext('(' + nativePrivateChatStep.toString() + ')', context);
  const page = new EventEmitter(); page.evaluate = (_fn, config) => step(config);
  page.locator = selector => ({ async fill(text) { assert.equal(selector, '#netchat-in'); assert.equal(text, ownerText); input.value = text; beforeFill?.({ H, N, U, n, page }); } });
  return { page, H, N, U, n, counts, messages, peer, ownerSocket, context, step: action => step({ action, run, gameOrigin }) };
}
test('offline protocol fixture reaches both actual UI and private fast-event guard boundaries once', async () => {
  const f = fixture(); const report = await verifyNativePrivateChat({ page: f.page, run, gameOrigin });
  assert.equal(report.ok, true); assert.equal(report.privateParty, true); assert.equal(report.ownerUiSend, true);
  assert.equal(report.peerReceivedOwnerFastSay, true); assert.equal(report.ownerReceivedPeerFastSay, true); assert.equal(report.ownerDisplayedPeerReply, true);
  assert.deepEqual(f.counts, { clicks: 1, invites: 1, peerSay: 1, leave: 1 }); assert.equal(f.N.party, '');
  assert(f.messages.filter(m => m.t === 'fast' && m.d.ev[0][1] === 'say').every(m => m.d.ev[0][3][0] === 'p'));
  const again = await verifyNativePrivateChat({ page: f.page, run, gameOrigin }); assert.equal(again.code, 'qa_chat_already_attempted'); assert.equal(f.counts.clicks, 1); assert.equal(f.counts.peerSay, 1);
  const foreign = await verifyNativePrivateChat({ page: f.page, run: '20261017000000000-8765abcd', gameOrigin }); assert.equal(foreign.code, 'qa_chat_scope');
  assert(!JSON.stringify(report).includes('NEVER_OUTPUT')); assert(!JSON.stringify(report).includes(ownerText)); assert(!JSON.stringify(report).includes(peerText));
});
test('party loss immediately before the real send click never falls back to realm chat', async () => {
  const f = fixture({ beforeFill: ({ N }) => { N.party = ''; } });
  const report = await verifyNativePrivateChat({ page: f.page, run, gameOrigin });
  assert.equal(report.ok, false); assert.equal(report.code, 'qa_chat_party'); assert.equal(f.counts.clicks, 0); assert.equal(f.counts.peerSay, 0);
  assert(!f.messages.some(m => m.t === 'fast' && m.d.ev[0][1] === 'say'));
});
test('owner generation, account, channel and current peer membership changes stop before any send click', async () => {
  for (const change of [({ n }) => { n.generation++; }, ({ n }) => { n.acct.id = 'another-owner'; },
    ({ U }) => { U.chan = 'r'; }, ({ N }) => { N.peers.get('actual-server-peer').slow.pt = ''; }]) {
    const f = fixture({ beforeFill: change }); const report = await verifyNativePrivateChat({ page: f.page, run, gameOrigin });
    assert.equal(report.ok, false); assert.equal(f.counts.clicks, 0); assert.equal(f.counts.peerSay, 0);
  }
});
test('an existing party or non-QA room cannot be repurposed by the private chat check', async () => {
  const party = fixture({ initialParty: 'existingparty' }); assert.equal((await party.step('start')).ok, false); assert.equal(party.counts.invites, 0);
  const room = fixture(); room.n.worldRoom = 'march'; const report = await room.step('start'); assert.equal(report.code, 'qa_chat_owner');
  assert.equal(room.messages.length, 0); assert.equal(room.counts.clicks, 0);
});
test('page errors fail the bounded result without exposing their exception or sending additional messages', async () => {
  const f = fixture({ beforeFill: ({ page }) => { page.emit('pageerror', Error('NEVER_OUTPUT_PRIVATE_ERROR')); } });
  const report = await verifyNativePrivateChat({ page: f.page, run, gameOrigin }); assert.equal(report.ok, false); assert.equal(report.code, 'qa_chat_errors');
  assert.equal(f.counts.clicks, 0); assert.equal(f.counts.peerSay, 0); assert(!JSON.stringify(report).includes('NEVER_OUTPUT'));
});
test('setup timeouts return fixed progress distinguishing each original private party handshake boundary', async () => {
  const cases = [
    ['peer', 'slow-profile-sent', { peerObserved: false, inviteAttempted: false, invitationObserved: false, ownerPartyEcho: false, peerJoinSent: false, acceptanceObserved: false, peerPartyEcho: false }],
    ['invitation', 'awaiting-invitation-and-owner-party', { peerObserved: true, inviteAttempted: true, invitationObserved: false, ownerPartyEcho: true, peerJoinSent: false, acceptanceObserved: false, peerPartyEcho: false }],
    ['owner-party', 'awaiting-invitation-and-owner-party', { peerObserved: true, inviteAttempted: true, invitationObserved: true, ownerPartyEcho: false, peerJoinSent: false, acceptanceObserved: false, peerPartyEcho: false }],
    ['acceptance', 'awaiting-acceptance-and-peer-party', { peerObserved: true, inviteAttempted: true, invitationObserved: true, ownerPartyEcho: true, peerJoinSent: true, acceptanceObserved: false, peerPartyEcho: true }],
    ['peer-party', 'awaiting-acceptance-and-peer-party', { peerObserved: true, inviteAttempted: true, invitationObserved: true, ownerPartyEcho: true, peerJoinSent: true, acceptanceObserved: true, peerPartyEcho: false }],
  ];
  for (const [stallAt, step, expected] of cases) {
    const f = fixture({ stallAt }); const report = await verifyNativePrivateChat({ page: f.page, run, gameOrigin });
    assert.equal(report.ok, false); assert.equal(report.phase, 'private-party-setup'); assert.equal(report.code, 'qa_chat_timeout');
    assert.equal(report.progress.step, step); assert.equal(report.progress.originalContextValid, true);
    assert.equal(report.progress.slowProfileAttempted, true); assert.equal(report.progress.slowProfileSent, true);
    for (const [key, value] of Object.entries(expected)) assert.equal(report.progress[key], value, stallAt + ': ' + key);
    for (const key of ['ownerSlowFrames', 'ownerFastFrames', 'ownerInviteEvents', 'peerSlowFrames', 'peerFastFrames', 'peerAcceptEvents']) {
      assert(Number.isSafeInteger(report.progress[key])); assert(report.progress[key] >= 0 && report.progress[key] <= 4096);
    }
    assert.equal(report.progress.ownerSendAttempted, false); assert.equal(report.progress.peerSendAttempted, false);
    assert.equal(f.counts.clicks, 0); assert.equal(f.counts.peerSay, 0);
    const before = f.messages.length;
    assert.equal((await verifyNativePrivateChat({ page: f.page, run, gameOrigin })).code, 'qa_chat_already_attempted');
    assert.equal(f.messages.length, before);
    const serialized = JSON.stringify(report); assert(!serialized.includes('NEVER_OUTPUT')); assert(!serialized.includes(ownerText)); assert(!serialized.includes(peerText));
    assert(!serialized.includes('actual-owner-peer')); assert(!serialized.includes('actual-server-peer')); assert(!serialized.includes('fixtureparty')); assert(!serialized.includes('game.example'));
  }
});
