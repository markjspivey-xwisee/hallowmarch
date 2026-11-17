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
  const location = { href, get origin() { return new URL(this.href).origin; }, get search() { return new URL(this.href).search; },
    assign(url) { calls.assigned.push(url); }, reload() { calls.reloads++; } };
  const ref = { get: async () => ({ exists: false }), set: async () => { calls.saves++; }, delete: async () => { calls.wipes++; } };
  const context = vm.createContext({ console, URL, URLSearchParams, JSON, Object, Number, Math, Promise, AbortSignal,
    Date: Object.assign(function () { return new Date(now); }, { now: () => now }),
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
  return { context, H: context.H, nodes, store, calls, location, ref };
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
