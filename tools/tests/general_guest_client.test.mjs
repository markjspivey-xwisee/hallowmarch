/** The page's side of Interego's general guest (issue 105): the shipping source of
 * src/14w_generalguest.js and the save backend's hook, with controlled DOM, storage and network. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../../src/14w_generalguest.js', import.meta.url), 'utf8');
const saveSource = readFileSync(new URL('../../src/12_save.js', import.meta.url), 'utf8');
const hook = saveSource.slice(saveSource.indexOf('async function initSaveBackend('), saveSource.indexOf('function readLocal()'));
const shell = readFileSync(new URL('../../src/page.html', import.meta.url), 'utf8');
const HOST = 'game.example', ORIGIN = 'https://' + HOST;
const ACCOUNT = 'gg-' + 'a'.repeat(40), OTHER_ACCOUNT = 'gg-' + 'b'.repeat(40);
const MANIFEST = { enabled: true, startPath: '/guest/general/start', returnPath: '/guest/general/return', sessionPath: '/guest/general/session' };
async function flush() { for (let n = 0; n < 20; n++) await Promise.resolve(); await new Promise(resolve => setImmediate(resolve)); }

function fixture({ href = ORIGIN + '/', manifest = MANIFEST, storage = {}, session = null, serverRef = 'ok', now = 1_800_000_000_000 } = {}) {
  const element = () => ({ hidden: true, disabled: true, textContent: '', onclick: null, style: {}, classList: { add() {} }, setAttribute() {}, append() {}, focus() {} });
  const nodes = { 'loading-general-guest': element(), 'loading-general-guest-status': element() };
  const store = new Map(Object.entries(storage)), calls = { fetch: [], assigned: [], replaced: [], reloads: 0, appended: [], timers: [], saves: 0, wipes: 0, native: 0 };
  const clock = { t: now };
  const location = { href, get origin() { return new URL(this.href).origin; }, get search() { return new URL(this.href).search; },
    assign(url) { calls.assigned.push(url); }, reload() { calls.reloads++; } };
  const ref = { get: async () => ({ exists: false }), set: async () => { calls.saves++; }, delete: async () => { calls.wipes++; } };
  const context = vm.createContext({ console, URL, URLSearchParams, JSON, Object, Number, Math, Promise, AbortSignal,
    Date: Object.assign(function () { return new Date(clock.t); }, { now: () => clock.t }),
    window: { __HM_GAMING: manifest ? { generalGuest: manifest } : {} }, location,
    history: { state: null, replaceState(state, title, url) { calls.replaced.push(url); location.href = new URL(url, location.href).href; } },
    localStorage: { getItem: key => store.has(key) ? store.get(key) : null, setItem: (key, value) => { store.set(key, String(value)); }, removeItem: key => { store.delete(key); } },
    document: { createElement: () => element(), body: { appendChild(node) { calls.appended.push(node); } } },
    $: id => nodes[id] || null, setTimeout: (fn, ms) => { calls.timers.push({ fn, ms }); return calls.timers.length; }, clearTimeout() {},
    fetch: async (url, init) => { calls.fetch.push({ url, ...init });
      return session ? { ok: true, json: async () => session } : { ok: false, json: async () => ({ error: 'no_general_guest_arrival' }) }; },
    GAME: { started: false, player: null }, SAVE: { native: false, lsKey: 'hallowmarch.save.v1' },
    NATIVE_PLAYER: { status: { enabled: true }, state: 'identity_unconfirmed' },
    NETWS: { acct: null, sessionRefusal: null, reload: false },
    netServerUrl: () => 'wss://' + HOST + '/ws',
    netServerSaveRef: async () => {
      if (serverRef === 'refused') { context.NETWS.sessionRefusal = { host: HOST }; return null; }
      if (serverRef === 'down') return null;
      context.NETWS.acct = { id: serverRef === 'other' ? OTHER_ACCOUNT : JSON.parse(store.get('hallowmarch.generalguest.' + HOST)).accountId };
      return ref;
    },
    nativePlayerSaveRef: async () => { calls.native++; context.SAVE.native = true; return null; },
    validSave: () => null, readLocal: () => null, saveNow() { calls.saves++; } });
  vm.runInContext(source + '\n' + hook + '\nglobalThis.H = { GENERAL_GUEST, generalGuestWanted, generalGuestSaveRef, generalGuestRender, generalGuestEnded, initSaveBackend };', context);
  return { context, H: context.H, nodes, store, calls, location, ref, clock };
}
const marker = (over = {}) => JSON.stringify({ accountId: ACCOUNT, expiresAt: 1_800_000_000_000 + 600_000, linked: false, prior: '', ...over });

test('the shipping page carries the control hidden until the server offers it', () => {
  assert.match(shell, /<button id="loading-general-guest" class="btn" type="button" hidden disabled aria-describedby="loading-general-guest-status"><\/button>/);
  assert.match(shell, /#loading-identity \.entry-actions \.btn \{[^}]*min-height: 44px/);
  assert.ok(!/innerHTML|insertAdjacentHTML|outerHTML/.test(source), 'text is set with textContent only');
});

test('the control shows only where this server offers the door, and a tap starts a top-level visit', () => {
  const off = fixture({ manifest: null });
  assert.equal(off.nodes['loading-general-guest'].hidden, true); assert.equal(off.H.generalGuestWanted(), false);
  const elsewhere = fixture({ href: 'https://claude.example/artifact?server=wss://game.example/ws' });
  assert.equal(elsewhere.nodes['loading-general-guest'].hidden, true); assert.equal(elsewhere.H.generalGuestWanted(), false);
  for (const bad of [{ ...MANIFEST, enabled: false }, { ...MANIFEST, startPath: 'https://attacker.example/start' }, { ...MANIFEST, startPath: '//attacker.example' }, { ...MANIFEST, sessionPath: '/a/../b' }]) {
    assert.equal(fixture({ manifest: bad }).nodes['loading-general-guest'].hidden, true);
  }
  const on = fixture(), button = on.nodes['loading-general-guest'];
  assert.equal(button.hidden, false); assert.equal(button.disabled, false); assert.equal(button.textContent, 'Continue as an Interego guest');
  assert.equal(on.H.generalGuestWanted(), false, 'no guest session is kept or arriving');
  button.onclick();
  assert.deepEqual(on.calls.assigned, [ORIGIN + '/guest/general/start']); assert.equal(button.disabled, true);
});

test('a boot with no guest session starts the other ways in exactly as before', async () => {
  const f = fixture(), initialization = { active: true };
  const pending = f.H.initSaveBackend(initialization);
  assert.equal(f.calls.native, 1, 'the native policy is still selected synchronously'); assert.equal(f.context.SAVE.native, true);
  await pending;
  assert.equal(f.calls.fetch.length, 0); assert.deepEqual([...f.store.keys()], []);
});

test('arriving back from the door: the session is collected once by cookie and no flag stays in the address', async () => {
  const session = { token: 'guest-session-token', acct: { id: ACCOUNT, name: 'Guest' }, expiresAt: 1_800_000_000_000 + 3_600_000, linked: false };
  const f = fixture({ href: ORIGIN + '/?interego-guest=arrived', session, storage: { ['hallowmarch.token.' + HOST]: 'prior-native-token' } });
  assert.equal(f.H.generalGuestWanted(), true);
  const ref = await f.H.initSaveBackend({ active: true });
  assert.equal(f.calls.native, 0, 'the native owner flow is not started for a guest session');
  assert.deepEqual(f.calls.fetch.map(call => [call.url, call.method, call.credentials]), [[ORIGIN + '/guest/general/session', 'POST', 'same-origin']]);
  assert.deepEqual(f.calls.replaced, ['/']); assert.equal(f.location.href, ORIGIN + '/');
  assert.equal(f.store.get('hallowmarch.token.' + HOST), 'guest-session-token');
  assert.deepEqual(JSON.parse(f.store.get('hallowmarch.generalguest.' + HOST)), { accountId: ACCOUNT, expiresAt: session.expiresAt, linked: false, prior: 'prior-native-token' });
  assert.equal(ref.server, true); assert.equal(ref.generalGuest, true);
  assert.equal(f.context.SAVE.native, false); assert.equal(f.context.SAVE.lsKey, 'hallowmarch.generalguest.save.' + ACCOUNT);
  assert.equal(f.context.NATIVE_PLAYER.status, null);
  assert.equal(f.nodes['loading-general-guest'].hidden, true, 'no second door while a guest session plays');
  await ref.delete(); assert.equal(f.calls.wipes, 1, 'a guest may delete its own character');
  // Its bound: a last save a little before, then the way back through the door.
  assert.deepEqual(f.calls.timers.map(timer => timer.ms), [3_600_000 - 25_000, 3_600_000 - 2_000]);
  f.context.GAME.started = true; f.context.GAME.player = {};
  f.calls.timers[0].fn(); assert.equal(f.calls.saves, 1);
  f.calls.timers[1].fn(); assert.equal(f.calls.appended.length, 1);
});

test('a linked guest never deletes the account\'s character, and a refused arrival leaves the other ways in', async () => {
  const linked = fixture({ storage: { ['hallowmarch.generalguest.' + HOST]: marker({ linked: true }) } });
  const ref = await linked.H.initSaveBackend({ active: true });
  await assert.rejects(ref.delete(), value => value.code === 'not_granted'); assert.equal(linked.calls.wipes, 0);
  for (const flag of ['arrived', 'refused', 'unavailable', 'busy']) {
    const f = fixture({ href: ORIGIN + '/?interego-guest=' + flag });
    await f.H.initSaveBackend({ active: true });
    assert.equal(f.calls.native, 1, flag); assert.deepEqual(f.calls.replaced, ['/'], flag);
    assert.equal(f.store.has('hallowmarch.generalguest.' + HOST), false, flag);
    assert.equal(f.nodes['loading-general-guest'].hidden, false, flag);
    assert.ok(f.nodes['loading-general-guest-status'].textContent.length > 10, flag);
  }
  // A collected body that is not a guest session is not kept.
  const odd = fixture({ href: ORIGIN + '/?interego-guest=arrived', session: { token: 'x', acct: { id: 'alice' }, expiresAt: 1_900_000_000_000 } });
  await odd.H.initSaveBackend({ active: true });
  assert.equal(odd.store.has('hallowmarch.token.' + HOST), false); assert.equal(odd.calls.native, 1);
});

test('at its bound, or refused by the server, the guest session ends and the earlier sign-in comes back', async () => {
  const kept = { ['hallowmarch.token.' + HOST]: 'guest-session-token' };
  const expired = fixture({ storage: { ...kept, ['hallowmarch.generalguest.' + HOST]: marker({ expiresAt: 1_800_000_000_000 + 1000, prior: 'prior-native-token' }) } });
  await expired.H.initSaveBackend({ active: true });
  assert.equal(expired.store.get('hallowmarch.token.' + HOST), 'prior-native-token'); assert.equal(expired.store.has('hallowmarch.generalguest.' + HOST), false);
  assert.equal(expired.calls.native, 1, 'the usual ways in follow'); assert.equal(expired.calls.reloads, 0);
  assert.equal(expired.nodes['loading-general-guest'].hidden, false);

  for (const serverRef of ['refused', 'other']) {
    const f = fixture({ serverRef, storage: { ...kept, ['hallowmarch.generalguest.' + HOST]: marker() } });
    assert.equal(await f.H.initSaveBackend({ active: true }), null);
    assert.equal(f.store.has('hallowmarch.token.' + HOST), false, 'no earlier sign-in: the guest bearer is removed');
    assert.equal(f.store.has('hallowmarch.generalguest.' + HOST), false); assert.equal(f.calls.native, 0);
    f.calls.timers.at(-1).fn(); assert.equal(f.calls.reloads, 1, serverRef);
  }
  // The server out of reach is not the session's end: nothing is thrown away.
  const down = fixture({ serverRef: 'down', storage: { ...kept, ['hallowmarch.generalguest.' + HOST]: marker() } });
  assert.equal(await down.H.initSaveBackend({ active: true }), null);
  assert.equal(down.store.get('hallowmarch.token.' + HOST), 'guest-session-token'); assert.equal(down.calls.reloads, 0);
  await flush();
});

test('the end of a session offers the way back through the door, by text only', async () => {
  const f = fixture({ storage: { ['hallowmarch.token.' + HOST]: 'guest-session-token', ['hallowmarch.generalguest.' + HOST]: marker({ linked: true, prior: 'prior-native-token' }) } });
  await f.H.initSaveBackend({ active: true });
  const made = []; f.context.document.createElement = tag => { const node = { tag, style: {}, classList: { add() {} }, setAttribute() {}, append(...kids) { node.kids = kids; }, focus() {}, textContent: '', onclick: null }; made.push(node); return node; };
  f.H.generalGuestEnded(); f.H.generalGuestEnded();
  assert.equal(f.calls.appended.length, 1, 'shown once');
  const [, text, again, leave] = made;
  assert.match(text.textContent, /ten minutes/); assert.equal(again.textContent, 'Continue as an Interego guest'); assert.equal(again.style.minHeight, '44px');
  again.onclick(); assert.deepEqual(f.calls.assigned, [ORIGIN + '/guest/general/start']);
  leave.onclick();
  assert.equal(f.store.get('hallowmarch.token.' + HOST), 'prior-native-token'); assert.equal(f.calls.reloads, 1);
});

/* ---- the guest's own pod: the shipping page code with the shipping sealing module and a stand-in server ---- */
globalThis.self = globalThis;
const { createGuestCheckpoint } = await import('../../client/native-pod/guest-checkpoint.mjs');
async function settle(page) { for (let n = 0; n < 200; n++) { await flush(); if (!page.P.busy) { await flush(); return; } await new Promise(resolve => setTimeout(resolve, 5)); } }
const CHARACTER = { v: 1, savedAt: 5, char: { name: 'Synthetic Guest', level: 4 } };
/** A page with a live guest session where the server offers the pod, and the server's side of `gpod` as server.js answers it. */
async function podPage(mode, { markerOver = {}, keys = new Map(), server = {} } = {}) {
  const f = fixture({ manifest: { ...MANIFEST, pod: mode }, storage: { ['hallowmarch.token.' + HOST]: 'guest-session-token', ['hallowmarch.generalguest.' + HOST]: marker(markerOver) } });
  const P = vm.runInContext('GENERAL_GUEST_POD', f.context), sent = [];
  const state = { env: null, lastAt: -Infinity, token: true, legacy: null, answer: null, ...server };
  f.context.NETWS.state = 'on';
  f.context.netWsSend = message => {
    sent.push(structuredClone(message));
    assert.equal(message.t, 'gpod');
    let reply;
    if (state.answer) reply = state.answer(message);
    else if (!state.token) reply = { ok: false, code: 'reauth' };
    else if (message.op === 'budget') reply = { ok: true, mode };
    else if (message.op === 'get') reply = { ok: true, env: state.env };
    else if (f.clock.t < state.lastAt + P.FLOOR) reply = { ok: false, code: 'too_soon' };
    else { state.env = message.env; state.lastAt = f.clock.t; reply = { ok: true }; }
    if (reply) Promise.resolve().then(() => f.context.generalGuestPodReply({ t: 'gpod', op: message.op, n: message.n, ...reply }));
    return true;
  };
  P.load = async () => ({ createGuestCheckpoint: ({ account }) => createGuestCheckpoint({ account, now: () => f.clock.t,
    storage: { load: async key => keys.get(key) ?? null, create: async (key, value) => { if (!keys.has(key)) keys.set(key, value); return keys.get(key); } } }) });
  f.ref.get = async () => state.legacy ? { exists: true, data: () => state.legacy } : { exists: false };
  const ref = await f.H.initSaveBackend({ active: true });
  return { ...f, P, sent, state, saveRef: ref, keys, usage: () => f.context.generalGuestPodUsage(ACCOUNT), puts: () => sent.filter(message => message.op === 'put') };
}

test('shadow: every save goes to the server as before, and a sealed copy follows to the pod, spaced and counted', async () => {
  const p = await podPage('shadow');
  assert.equal(p.saveRef.generalGuestPod, undefined); assert.equal(p.sent.length, 0, 'nothing is asked of the pod before a save');
  await p.saveRef.set(CHARACTER); await settle(p);
  assert.equal(p.calls.saves, 1, 'the server\'s save is written first, unchanged');
  assert.equal(p.puts().length, 1);
  const envelope = p.puts()[0].env;
  assert.deepEqual(Object.keys(envelope).sort(), ['algorithm', 'content', 'version', 'wrappedKeys']); assert.equal(envelope.wrappedKeys.length, 1);
  assert.ok(!JSON.stringify(p.sent).includes('Synthetic Guest'), 'the page sends the pod ciphertext only');
  assert.deepEqual({ ...p.usage(), bytes: 0, lastBytes: 0 }, { writes: 1, bytes: 0, lastAt: p.clock.t, lastBytes: 0, wipedAt: 0 });
  assert.ok(p.usage().bytes > 200 && p.usage().bytes === p.usage().lastBytes);
  // A minute later: the server's save still goes, the pod's copy waits for its spacing, and is not dropped.
  p.clock.t += 60_000;
  await p.saveRef.set({ ...CHARACTER, savedAt: 6, char: { ...CHARACTER.char, level: 5 } }); await settle(p);
  assert.equal(p.calls.saves, 2); assert.equal(p.puts().length, 1); assert.equal(p.P.stats.skipped, 1); assert.equal(p.P.stats.last, 'spaced');
  const due = p.calls.timers.at(-1);
  assert.ok(due.ms > 8.9 * 60_000 && due.ms <= 9 * 60_000 + 1000, 'the held copy is sent when its ten minutes are up: ' + due.ms);
  p.clock.t += due.ms; due.fn(); await flush(); await settle(p);
  assert.equal(p.puts().length, 2); assert.equal(p.usage().writes, 2);
  // The pod failing never fails or delays the save.
  p.clock.t += 11 * 60_000; p.state.answer = () => ({ ok: false, code: 'pod_unreachable' });
  await p.saveRef.set({ ...CHARACTER, savedAt: 7 }); await settle(p);
  assert.equal(p.calls.saves, 3); assert.equal(p.P.stats.failed, 1); assert.equal(p.usage().writes, 3, 'an attempt that left the server is spent');
  assert.equal(p.calls.appended.length, 0, 'in shadow nothing is shown for it');
  // A linked guest plays an account's character: nothing of it is sealed for the guest's pod.
  const linked = await podPage('shadow', { markerOver: { linked: true } });
  await linked.saveRef.set(CHARACTER); await settle(linked);
  assert.equal(linked.calls.saves, 1); assert.equal(linked.sent.length, 0);
});

test('the page never asks past this game\'s part of the guest\'s lifetime budget', async () => {
  const p = await podPage('shadow');
  p.store.set('hallowmarch.generalguest.pod.' + ACCOUNT, JSON.stringify({ writes: p.P.WRITES, bytes: 1000, lastAt: 0, lastBytes: 500 }));
  await p.saveRef.set(CHARACTER); await settle(p);
  assert.equal(p.calls.saves, 1); assert.equal(p.sent.length, 0); assert.equal(p.P.stats.last, 'budget');
  p.store.set('hallowmarch.generalguest.pod.' + ACCOUNT, JSON.stringify({ writes: 3, bytes: p.P.BYTES - 10, lastAt: 0, lastBytes: 500 }));
  await p.saveRef.set(CHARACTER); await settle(p);
  assert.equal(p.sent.length, 0);
  // The server saying so (its own count, or the pod's 507) stops the page for good.
  const q = await podPage('shadow', { server: { answer: () => ({ ok: false, code: 'pod_full' }) } });
  await q.saveRef.set(CHARACTER); await settle(q);
  q.clock.t += 3_600_000; await q.saveRef.set({ ...CHARACTER, savedAt: 9 }); await settle(q);
  assert.equal(q.puts().length, 1); assert.equal(q.usage().writes, q.P.WRITES);
  assert.ok(p.P.WRITES <= 256 && p.P.BYTES <= 16 * 1024 * 1024 && p.P.FLOOR >= 5 * 60_000 && p.P.INTERVAL >= 10 * 60_000);
});

test('authoritative: the pod\'s sealed copy and this browser\'s own are the character; the server is sent no save', async () => {
  const keys = new Map(), p = await podPage('authoritative', { keys });
  assert.equal(p.saveRef.generalGuestPod, 'authoritative'); assert.deepEqual(p.sent.map(message => message.op), ['budget']);
  assert.deepEqual(await p.saveRef.get().then(found => found.exists), false);
  await p.saveRef.set(CHARACTER);
  assert.equal(p.calls.saves, 0, 'no save is sent to the server'); assert.equal(p.puts().length, 1);
  assert.equal(JSON.parse(p.store.get('hallowmarch.generalguest.save.' + ACCOUNT)).char.name, 'Synthetic Guest', 'this browser keeps its own copy between the pod\'s writes');
  // Two minutes on: the pod's copy lags, this browser's is current; a reload reads the newer.
  p.clock.t += 120_000;
  const later = { ...CHARACTER, savedAt: 9, char: { ...CHARACTER.char, level: 6 } };
  await p.saveRef.set(later);
  assert.equal(p.puts().length, 1);
  const again = await podPage('authoritative', { keys, server: { env: p.state.env } });
  for (const [key, value] of p.store) again.store.set(key, value);
  assert.equal((await again.saveRef.get()).data().char.level, 6, 'the browser\'s newer copy');
  again.store.delete('hallowmarch.generalguest.save.' + ACCOUNT);
  assert.equal((await again.saveRef.get()).data().char.level, 4, 'with its own copy gone, the pod\'s is opened with this browser\'s key');
  // Another browser has no key for it: nothing opens, nothing is shown of it, and a new character may begin.
  const other = await podPage('authoritative', { server: { env: p.state.env } });
  assert.equal((await other.saveRef.get()).exists, false); assert.equal(other.H.GENERAL_GUEST.podUnreadable, true);
  // A character the server kept before the pod became its home is read once.
  const before = await podPage('authoritative', { server: { legacy: { v: 1, savedAt: 2, char: { name: 'Kept Before' } } } });
  assert.equal((await before.saveRef.get()).data().char.name, 'Kept Before');
  // Deleting: this browser's copy goes and the pod's is given up, even before the pod takes the sealed deletion.
  await again.saveRef.delete(); await settle(again);
  assert.equal(again.calls.wipes, 1); assert.ok(again.usage().wipedAt > 0);
  again.state.env = p.state.env;
  assert.equal((await again.saveRef.get()).exists, false, 'the given-up copy is not read back');
});

test('authoritative: without the server\'s pod token the session goes back through the door, and nothing is lost meanwhile', async () => {
  const cold = await podPage('authoritative', { server: { token: false } });
  assert.equal(cold.saveRef, null);
  assert.equal(cold.store.has('hallowmarch.generalguest.' + HOST), false, 'the session is over for this browser');
  cold.calls.timers.at(-1).fn(); assert.equal(cold.calls.reloads, 1);
  // The token going mid-session: the save stays in this browser, and the way back through the door is offered.
  const p = await podPage('authoritative');
  p.state.token = false;
  await p.saveRef.set(CHARACTER);
  assert.equal(JSON.parse(p.store.get('hallowmarch.generalguest.save.' + ACCOUNT)).char.name, 'Synthetic Guest');
  assert.equal(p.calls.appended.length, 1, 'the door is offered again'); assert.equal(p.usage().writes, 0, 'no attempt was spent');
  // The pod out of reach when the character is read: the read is not confirmed, so nothing is overwritten.
  const down = await podPage('authoritative', { server: { answer: message => message.op === 'get' ? null : { ok: true, mode: 'authoritative' } } });
  down.context.setTimeout = (fn) => { fn(); return 1; };
  await assert.rejects(down.saveRef.get(), value => value.code === 'unavailable');
});

test('authoritative: a pod character this browser cannot open is never written over unless the player chooses to', async () => {
  const owner = await podPage('authoritative');
  await owner.saveRef.set(CHARACTER);
  const sealedElsewhere = owner.state.env;
  // Another browser (or this one with its key cleared): the pod's copy cannot be opened, and play starts here.
  const other = await podPage('authoritative', { server: { env: sealedElsewhere } });
  assert.equal((await other.saveRef.get()).exists, false);
  assert.equal(other.H.GENERAL_GUEST.podUnreadable, true);
  await other.saveRef.set({ ...CHARACTER, savedAt: 11, char: { name: 'New Here' } }); await settle(other);
  assert.equal(other.puts().length, 0, 'nothing is sent over the pod\'s unopened character');
  assert.equal(other.P.stats.last, 'unreadable'); assert.equal(other.usage().writes, 0);
  assert.equal(JSON.parse(other.store.get('hallowmarch.generalguest.save.' + ACCOUNT)).char.name, 'New Here', 'this browser still keeps its own copy');
  // The choice is offered; only the player's "replace" lets the next write go.
  const ask = other.calls.timers.find(t => t.ms === 0); assert.ok(ask, 'the choice is offered'); ask.fn();
  assert.ok(other.calls.appended.length >= 1, 'a choice is shown');
  other.H.GENERAL_GUEST.podReplace = true; await other.context.generalGuestPodFlush(); await settle(other);
  assert.equal(other.puts().length, 1, 'replaced by the player\'s own choice');
  // A document that stands in the pod but is not a sealed character is not taken for an empty pod either.
  const odd = await podPage('authoritative', { server: { answer: message => message.op === 'get' ? { ok: true, present: true, env: null }
    : message.op === 'budget' ? { ok: true, mode: 'authoritative' } : { ok: true } } });
  assert.equal((await odd.saveRef.get()).exists, false); assert.equal(odd.H.GENERAL_GUEST.podUnreadable, true);
  await odd.saveRef.set(CHARACTER); await settle(odd);
  assert.equal(odd.puts().length, 0);
});
