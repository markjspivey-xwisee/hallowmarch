import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { fixture } from './world_build.fixture.mjs';

const source = ['14n_net.js', '14p_netws.js', '14z_networldparts.js']
  .map(name => fs.readFileSync(new URL('../../src/' + name, import.meta.url), 'utf8')).join('\n');
const admission = { origin: 'https://game.test', epoch: 4 };
function harness(game = {}) {
  const sockets = [], notices = [], channels = [], applies = [];
  class Socket {
    constructor(url) { this.url = url; this.readyState = 0; this.sent = []; sockets.push(this); }
    send(text) { this.sent.push(JSON.parse(text)); }
    open() { this.readyState = 1; this.onopen?.({}); }
    message(m) { this.onmessage?.({ data: JSON.stringify(m) }); }
    close() { this.readyState = 3; this.onclose?.({ code: 1000, reason: 'closed' }); }
  }
  const context = vm.createContext({ console, URL, URLSearchParams, Map, Set, Object, Array, JSON, Math, Date, AbortSignal,
    performance: { now: () => 1000 }, GAME: game, NET_HUMAN_PLAY: { activity: 1 },
    netHumanLive: () => false, netHumanSuspend() {}, netHumanSync() {},
    netWxTake() {}, netWxResume() {}, netWorldCapture() {}, netStr: s => String(s || ''),
    reportError(error) { throw error; }, uiError: (...args) => notices.push(args),
    uiLog: (...args) => notices.push(args), uiToast: (...args) => notices.push(args),
    clamp: (n, a, b) => Math.max(a, Math.min(b, n)), WebSocket: Socket,
    location: { search: '?server=' + encodeURIComponent('wss://game.test/ws'), reload() { throw Error('No automatic reload'); } },
    window: { addEventListener() {} }, document: { addEventListener() {} },
    SAVE: { ref: { character: 'same-owner' }, kind: 'native', native: true, wiping: false },
    NATIVE_PLAYER: { binding: { subjectDid: 'did:web:identity.test:owner' } },
    localStorage: { getItem: () => '', setItem() {}, removeItem() { throw Error('Identity must remain'); } },
    queueMicrotask() {}, setTimeout: () => 1, clearTimeout() {}, setInterval: () => 2, clearInterval() {}, withTimeout: p => p,
    netThroneMessage: m => channels.push(['thrones', m]), netBoatMessage: m => channels.push(['boats', m]),
    netNpcMessage: m => channels.push(['npcs', m]), netEntityMessage: m => channels.push(['entities', m]),
  });
  vm.runInContext(source + '\nglobalThis.api={NET,NETWS,state:NET_SCENE_BOOT,parts:NETPARTS,message:netSharedSceneMessage,flush:netSharedSceneFlushBuilt,reset:netSharedSceneReset,register:netWorldPartsRegister,open:netWsOpen,readRef:netServerSaveRef};', context);
  const api = context.api, ws = { readyState: 1, close() { this.readyState = 3; } };
  Object.assign(api.NETWS, { ws, url: 'wss://game.test/ws', host: 'game.test', token: 'same-issued-session', acct: { id: 'owner' },
    state: 'on', generation: 1, worldAdmission: { ...admission } });
  api.NET.self = 'follower';
  api.register('land', { save: () => null, apply: value => applies.push(structuredClone(value)) });
  const identity = [api.NETWS.acct, api.NETWS.token, context.SAVE.ref, context.NATIVE_PLAYER.binding];
  const authority = (extra = {}) => ({ t: 'activity', kind: 'authority', authority: 'auth', peer: 'host', worldpartsReady: true,
    worldAdmission: { ...admission }, ...extra });
  const packets = (value, seq = 1, pieces = 1, extra = {}) => {
    const text = JSON.stringify(value), width = Math.ceil(text.length / pieces);
    return Array.from({ length: pieces }, (_, part) => ({ t: 'activity', kind: 'worldparts', op: 'snapshot', authority: 'auth',
      worldAdmission: { ...admission }, seq, part, total: pieces, data: text.slice(part * width, (part + 1) * width), ...extra }));
  };
  const frame = (land, extra = {}) => ({ v: 1, full: true, parts: { land }, remove: [], ...extra });
  return { api, context, sockets, notices, channels, applies, authority, packets, frame,
    identityUnchanged() { assert.deepEqual(api.NETWS.acct, identity[0]); assert.equal(api.NETWS.token, identity[1]);
      assert.equal(context.SAVE.ref, identity[2]); assert.equal(context.NATIVE_PLAYER.binding, identity[3]); } };
}

test('activity during real chunked construction cannot touch partial records and replays full image then deltas in order', async () => {
  const world = fixture(), h = harness(world.context.GAME), iterator = world.api.buildWorldChunks(7);
  let settled = false;
  h.api.register('physical', { save: () => null, apply(value) { assert.equal(world.api.W.ready, true); assert.equal(h.context.GAME.built, true); settled = value; } });
  const packets = [h.authority(), ...h.packets(h.frame('initial', { parts: { land: 'initial', physical: true } }), 1, 3),
    ...h.packets({ v: 1, full: false, parts: { land: 'latest' }, remove: [] }, 2, 2)];
  let result, turn = 0;
  do {
    for (let i = 0; i < 128; i++) { result = iterator.next(); if (result.done) break; }
    if (!result.done) await new Promise(resolve => setImmediate(() => {
      if (turn < packets.length) h.api.message(packets[turn++]);
      assert.equal(h.applies.length, 0); assert.equal(h.channels.length, 0); assert.equal(h.api.parts.ready, false); resolve();
    }));
  } while (!result.done);
  assert.equal(world.api.W.ready, true); assert.equal(settled, false); assert.equal(h.api.flush(), false);
  h.context.GAME.built = true;
  assert.equal(h.api.flush(), true); assert.deepEqual(h.applies, ['initial', 'latest']); assert.equal(settled, true);
  assert.equal(h.api.parts.readSeq, 2); assert.equal(h.api.state.packets.length, 0); assert.equal(h.api.state.chars, 0);
  assert.equal(h.api.flush(), true); assert.deepEqual(h.applies, ['initial', 'latest']); h.identityUnchanged();
});

test('undefined initial built flag and pending private restore retain packets until explicit release', () => {
  const h = harness(); assert.equal(h.context.GAME.built, undefined);
  h.api.message(h.authority()); for (const m of h.packets(h.frame(1))) h.api.message(m);
  assert.equal(h.applies.length, 0); assert.equal(h.channels.length, 0);
  h.context.GAME.built = true; for (const m of h.packets(h.frame(2), 2)) h.api.message(m);
  assert.deepEqual(h.applies, []); assert.equal(h.api.NETWS.sceneBootReady, false);
  h.applies.push('private restore'); assert.equal(h.api.flush(), true);
  for (const m of h.packets(h.frame(3), 3)) h.api.message(m);
  assert.deepEqual(h.applies, ['private restore', 1, 2, 3]); assert.equal(h.api.state.packets.length, 0); h.identityUnchanged();
});

test('frame validation, stale parts and full/delta ordering retain existing canonical parser behavior', () => {
  const h = harness({ built: false }); h.api.message(h.authority());
  for (const m of h.packets(h.frame('old'), 1, 2)) h.api.message(m);
  const complete = h.packets(h.frame('current'), 3, 3); h.api.message(complete[1]); h.api.message(complete[1]);
  h.api.message(complete[0]); h.api.message(complete[2]);
  for (const m of h.packets(h.frame('stale'), 2)) h.api.message(m);
  for (const m of h.packets(h.frame('wrong authority'), 4, 1, { authority: 'stale' })) h.api.message(m);
  for (const m of h.packets(h.frame('wrong epoch'), 4, 1, { worldAdmission: { ...admission, epoch: 3 } })) h.api.message(m);
  h.api.message({ ...h.packets(h.frame('bad JSON'), 5)[0], data: '{' });
  for (const m of h.packets({ v: 2, parts: { land: 'bad version' } }, 6)) h.api.message(m);
  const partial = h.packets(h.frame('after boot'), 7, 2); h.api.message(partial[0]);
  h.context.GAME.built = true; assert.equal(h.api.flush(), true); assert.deepEqual(h.applies, ['old', 'current']);
  h.api.message(partial[1]); assert.deepEqual(h.applies, ['old', 'current', 'after boot']); h.identityUnchanged();
});

test('disconnect clears the boot buffer and a fresh socket receives its own full initial snapshot', async () => {
  const h = harness({ built: false });
  h.api.NETWS.state = 'off'; const first = h.api.open();
  for (let i = 0; i < 20; i++) await Promise.resolve();
  const a = h.sockets[0]; a.open(); a.message({ t: 'welcome', peer: 'follower', acct: h.api.NETWS.acct, room: 'march', worldAdmission: admission });
  assert.equal(await first, true); a.message(h.authority()); for (const m of h.packets(h.frame('disconnected'))) a.message(m);
  assert(h.api.state.packets.length > 0);
  for (let i = 0; i < 2048; i++) a.message(h.authority()); assert(h.api.state.failure);
  a.close(); assert.equal(h.api.state.packets.length, 0); assert.equal(h.api.state.failure, '');
  const second = h.api.open(); for (let i = 0; i < 20; i++) await Promise.resolve();
  const b = h.sockets[1]; b.open(); b.message({ t: 'welcome', peer: 'follower2', acct: h.api.NETWS.acct, room: 'march', worldAdmission: admission });
  assert.equal(await second, true); b.message(h.authority()); for (const m of h.packets(h.frame('fresh'))) b.message(m);
  a.message(h.authority()); for (const m of h.packets(h.frame('late old socket'), 99)) a.message(m);
  h.context.GAME.built = true; assert.equal(h.api.flush(), true); assert.deepEqual(h.applies, ['fresh']); h.identityUnchanged();
});

test('unexpected owner, host, generation, socket or admission replacement refuses buffered work without touching private character state', () => {
  for (const mutate of [h => { h.api.NETWS.acct = { id: 'other' }; }, h => { h.api.NETWS.host = 'other.test'; },
    h => { h.api.NETWS.generation++; }, h => { h.api.NETWS.ws = { readyState: 1 }; },
    h => { h.api.NETWS.worldAdmission = { ...admission, epoch: 5 }; }]) {
    const h = harness({ built: false }); h.api.message(h.authority()); for (const m of h.packets(h.frame('stale'))) h.api.message(m);
    const ref = h.context.SAVE.ref, token = h.api.NETWS.token; mutate(h); h.context.GAME.built = true;
    assert.equal(h.api.flush(), false); assert.deepEqual(h.applies, []); assert.equal(h.api.NETWS.reload, true);
    assert.equal(h.api.state.packets.length, 0); assert.equal(h.context.SAVE.ref, ref); assert.equal(h.api.NETWS.token, token);
  }
});

test('unexpected scope change during construction cannot replace and silently discard an initial image', () => {
  const h = harness({ built: false }); h.api.message(h.authority()); h.api.NETWS.acct = { id: 'other' };
  h.api.message(h.authority()); assert(h.api.state.failure); assert.notEqual(h.api.NETWS.reload, true); assert.equal(h.api.state.packets.length, 0);
  h.context.GAME.built = true; assert.equal(h.api.flush(), false); assert.deepEqual(h.applies, []);
});

test('both bounded buffer limits refuse shared play and preserve pending character reads', () => {
  for (const limit of ['packets', 'chars']) {
    const h = harness({ built: false }), read = () => {}; h.api.NETWS.waits.push(read);
    const m = h.authority(limit === 'chars' ? { padding: 'x'.repeat(1024 * 1024) } : {});
    const count = limit === 'chars' ? 5 : 2049; for (let i = 0; i < count; i++) h.api.message(m);
    assert(h.api.state.failure); assert.notEqual(h.api.NETWS.reload, true); assert.equal(h.api.state.packets.length, 0); assert.equal(h.api.state.chars, 0);
    assert.equal(h.api.NETWS.waits[0], read); assert.equal(h.api.NETWS.ws.readyState, 1);
    h.context.GAME.built = true; assert.equal(h.api.flush(), false); assert.deepEqual(h.applies, []); h.identityUnchanged();
  }
});

test('real authenticated character read still receives its reply after boot-buffer failure, before shared-play release', async () => {
  const h = harness({ built: false }); h.api.NETWS.state = 'off'; const opening = h.api.open();
  for (let i = 0; i < 20; i++) await Promise.resolve();
  const socket = h.sockets[0]; socket.open(); socket.message({ t: 'welcome', peer: 'follower', acct: h.api.NETWS.acct, room: 'march', worldAdmission: admission });
  assert.equal(await opening, true); const ref = await h.api.readRef(); assert(ref);
  const reading = ref.get(); assert.equal(socket.sent.at(-1).t, 'load');
  for (let i = 0; i < 2049; i++) socket.message(h.authority());
  assert(h.api.state.failure); assert.notEqual(h.api.NETWS.reload, true); assert.equal(h.applies.length, 0);
  socket.message({ t: 'save', d: { character: 'preserved checkpoint' } });
  const save = await reading; assert.equal(save.exists, true); assert.equal(save.data().character, 'preserved checkpoint');
  h.context.GAME.built = true; assert.equal(h.api.flush(), false); assert.equal(h.api.NETWS.reload, true);
  h.identityUnchanged();
});

test('reconnect after explicit release remains live without reopening the startup hold', () => {
  const h = harness({ built: true }); assert.equal(h.api.flush(), true); h.api.reset();
  assert.equal(h.api.NETWS.sceneBootReady, true);
  h.api.message(h.authority()); for (const m of h.packets(h.frame('live'))) h.api.message(m);
  assert.deepEqual(h.applies, ['live']); assert.equal(h.api.state.packets.length, 0); h.identityUnchanged();
});
