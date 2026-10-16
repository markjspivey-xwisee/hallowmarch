import test from 'node:test';
import assert from 'node:assert/strict';
import { makeCompanies } from '../companies.js';

function fixture(t, canParticipate) {
  const accounts = {
    named: { id: 'named', name: 'Legacy Captain', guest: false },
    member: { id: 'member', name: 'Legacy Member', guest: false },
    native: { id: 'native', name: 'Guest', guest: true, nativeBound: true },
    teammate: { id: 'teammate', name: 'Guest', guest: true, nativeBound: true },
    guest: { id: 'guest', name: 'Guest', guest: true },
  };
  const writes = [];
  const C = makeCompanies({}, { read: () => null, write: (_file, data) => writes.push(structuredClone(data)) }, {}, {
    acct: id => accounts[id] ?? null,
    // Native participants can be addressed by their exact existing game ID;
    // duplicate guest labels do not become a new account-name identity index.
    acctByName: name => Object.values(accounts).find(a => !a.guest && a.name === name)
      ?? (accounts[name]?.nativeBound ? accounts[name] : null),
    realmOf: () => 0, reserved: [], seasonN: () => 1, projects: () => [],
    ...(canParticipate ? { canParticipate } : {}),
  });
  t.after(() => C.save(true));
  const actor = (id, nativeParticipant) => ({ ...accounts[id], nativeParticipant });
  return { C, accounts, writes, actor };
}

test('legacy named accounts retain company founding and membership while ordinary guests are denied', t => {
  const { C, accounts: A } = fixture(t);
  assert.equal(C.canParticipate(A.named), true); assert.equal(C.canParticipate(A.guest), false);
  const founded = C.found(A.named, 0, 'Amber Watch', 0, [0, 3]); assert.equal(founded.ok, true);
  assert.equal(C.invite(A.named, A.member.name).ok, true); assert.equal(C.answer(A.member, founded.id, true, 0).ok, true);
  assert.equal(C.found(A.guest, 0, 'Copper Guard', 0, [0, 3]).ok, false);
  assert.equal(C.stateFor(A.guest, 0, new Set()).guest, true); assert.equal(C.stateFor(A.named, 0, new Set()).guest, false);
});

test('the default company policy never interprets stored native binding or claimed flags as native proof', t => {
  const { C, accounts: A } = fixture(t);
  assert.equal(C.canParticipate(A.native), false);
  assert.equal(C.canParticipate({ ...A.native, nativeParticipant: true }), false);
  assert.equal(C.found({ ...A.native, nativeParticipant: true }, 0, 'Copper Guard', 0, [0, 3]).ok, false);
  assert.equal(C.stateFor(A.native, 0, new Set()).guest, true); assert.equal(A.native.guest, true); assert.equal(A.native.pass, undefined);
});

test('a server-verified native participant can found and join companies while retaining its guest account identity', t => {
  const { C, accounts: A, actor } = fixture(t, account => !account.guest || account.nativeParticipant === true);
  const captain = actor('native', true), member = actor('teammate', true);
  const founded = C.found(captain, 0, 'Silver Watch', 2, [0, 3]); assert.equal(founded.ok, true);
  assert.equal(C.invite(captain, A.teammate.id).ok, true); assert.equal(C.answer(member, founded.id, true, 0).ok, true);
  const state = C.stateFor(member, 0, new Set([A.native.id, A.teammate.id]));
  assert.equal(state.guest, false); assert.equal(state.co.role, 'mem'); assert.equal(state.co.mem.length, 2);
  for (const account of [A.native, A.teammate]) {
    assert.equal(account.guest, true); assert.equal(account.name, 'Guest'); assert.equal(account.pass, undefined);
  }
});

test('unverified native-bound guests cannot found or accept an invitation through the injected policy', t => {
  const { C, accounts: A, actor } = fixture(t, account => account.nativeBound ? account.nativeParticipant === true : !account.guest);
  const founded = C.found(A.named, 0, 'Bronze Guard', 0, [0, 3]); assert.equal(founded.ok, true);
  assert.equal(C.found(actor('native', false), 0, 'Silver Watch', 0, [0, 3]).ok, false);
  assert.equal(C.invite(A.named, A.native.id).ok, true);
  assert.equal(C.answer(actor('native', false), founded.id, true, 0).ok, false);
  assert.equal(C.of(A.native.id), null); assert.equal(C.stateFor(actor('native', false), 0, new Set()).guest, true);
  assert.equal(C.invite(A.named, A.native.id).ok, true);
  assert.equal(C.stateFor(actor('native', false), 0, new Set()).invites, undefined);
  assert.equal(C.answer(actor('native', true), founded.id, true, 0).ok, true);
  const redacted = C.stateFor(actor('native', false), 0, new Set());
  assert.equal(redacted.guest, true); assert.equal(redacted.co, undefined); assert.equal(redacted.invites, undefined);
  assert.deepEqual(Object.keys(redacted).sort(), ['guest', 'max', 'standing']);
});

test('named native-bound accounts also require active native proof for participation and private company state', t => {
  const { C, accounts: A, actor } = fixture(t, account => account.nativeBound ? account.nativeParticipant === true : !account.guest);
  A.named.nativeBound = true;
  assert.equal(C.canParticipate(A.named), false);
  assert.equal(C.found(actor('named', false), 0, 'Amber Watch', 0, [0, 3]).ok, false);
  const founded = C.found(actor('named', true), 0, 'Amber Watch', 0, [0, 3]); assert.equal(founded.ok, true);
  assert.equal(C.stateFor(actor('named', true), 0, new Set()).co.id, founded.id);
  const redacted = C.stateFor(actor('named', false), 0, new Set());
  assert.equal(redacted.co, undefined); assert.equal(redacted.invites, undefined); assert.equal(redacted.guest, true);
  assert.equal(A.named.guest, false); assert.equal(A.named.pass, undefined);
});

test('the injected eligibility hook fails closed on exceptions and nonboolean approval', t => {
  for (const canParticipate of [() => { throw new Error('native proof unavailable'); }, () => 'verified']) {
    const { C, accounts: A } = fixture(t, canParticipate);
    assert.equal(C.canParticipate(null), false); assert.equal(C.canParticipate(A.native), false);
    assert.equal(C.found(A.native, 0, 'Silver Watch', 0, [0, 3]).ok, false);
    assert.equal(C.stateFor(A.native, 0, new Set()).guest, true);
  }
});
