// Regression checks for company invitations and untrusted identifiers.
// Run: node --test tools/tests/companies_regression.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import { makeCompanies, coSanitize } from '../../server/companies.js';

function fixture(saved = null) {
  const accounts = Object.fromEntries(['aa', 'bb', 'cc', 'xx', 'yy'].map(id =>
    [id, { id, name: id.toUpperCase(), guest: false }]));
  const writes = [];
  const C = makeCompanies({}, {
    read: () => saved,
    write: (file, data) => writes.push(JSON.parse(JSON.stringify(data))),
  }, {}, {
    acct: id => accounts[id],
    acctByName: name => Object.values(accounts).find(a => a.name === name),
    realmOf: () => 0,
    reserved: [], seasonN: () => 1, projects: () => [],
  });
  return { C, accounts, writes, flush: () => C.save(true) };
}

test('untrusted company/member IDs cannot resolve Object prototype properties', () => {
  const F = fixture(), { C, accounts: A } = F;
  try {
    assert.equal(C.found(A.aa, 0, 'Amber Watch', 0, [0, 3]).ok, true);
    for (const id of ['constructor', '__proto__', 'prototype', 'toString']) {
      assert.equal(C.answer(A.xx, id, true, 0).ok, false);
      assert.equal(C.remove(A.aa, id).ok, false);
      assert.equal(C.rank(A.aa, id, 'off').ok, false);
      assert.deepEqual(C.membersOf(id), []);
    }
    assert.equal(Object.prototype.role, undefined);
    assert.equal(C.stateFor(A.aa, 0, new Set()).co.mem.length, 1);
  } finally { F.flush(); }
});

test('joining a company clears invitations from every company', () => {
  const F = fixture(), { C, accounts: A } = F;
  try {
    const a = C.found(A.aa, 0, 'Amber Watch', 0, [0, 3]);
    const b = C.found(A.bb, 0, 'Bronze Guard', 0, [0, 3]);
    assert.equal(C.invite(A.aa, 'XX').ok, true);
    assert.equal(C.invite(A.bb, 'XX').ok, true);
    assert.equal(C.answer(A.xx, a.id, true, 0).ok, true);
    assert.equal(C.D.inv.xx, undefined);
    assert.equal(Object.keys(C.D.list[b.id].inv).length, 0);
    assert.equal(C.leave(A.xx).ok, true);
    assert.equal(C.invite(A.bb, 'XX').ok, true);
  } finally { F.flush(); }
});

test('founding a company clears previous invitations; declining only clears the selected one', () => {
  const F = fixture(), { C, accounts: A } = F;
  try {
    const a = C.found(A.aa, 0, 'Amber Watch', 0, [0, 3]);
    const b = C.found(A.bb, 0, 'Bronze Guard', 0, [0, 3]);
    C.invite(A.aa, 'XX'); C.invite(A.bb, 'XX');
    assert.equal(C.answer(A.xx, a.id, false, 0).ok, true);
    assert.equal(C.invitesOf('xx').length, 1);
    assert.equal(C.invitesOf('xx')[0].id, b.id);
    assert.equal(C.found(A.xx, 0, 'Copper Shield', 0, [0, 3]).ok, true);
    assert.equal(C.D.inv.xx, undefined);
    assert.equal(Object.keys(C.D.list[b.id].inv).length, 0);
  } finally { F.flush(); }
});

test('a restart reconstructs bounded consistent invitation indexes', () => {
  const F = fixture(), { C, accounts: A } = F;
  try {
    const a = C.found(A.aa, 0, 'Amber Watch', 0, [0, 3]);
    C.invite(A.aa, 'XX');
    const saved = JSON.parse(JSON.stringify(C.D));
    saved.list[a.id].inv.yy = 123; // stale company-only invitation
    saved.inv.xx.push({ ...saved.inv.xx[0] }); // duplicate account-side invitation
    saved.inv.yy = [{ co: 'constructor', by: 'Bad', at: 1 }];
    const D = coSanitize(saved);
    assert.equal(D.inv.xx.length, 1);
    assert.equal(Object.keys(D.list[a.id].inv).length, 1);
    assert.equal(D.list[a.id].inv.xx, D.inv.xx[0].at);
    assert.equal(D.inv.yy, undefined);
    assert.equal(D.list.constructor, undefined);
    assert.equal(Object.getPrototypeOf(D.list), null);
  } finally { F.flush(); }
});

test('a company is founded only in one of the three integer realms', () => {
  for (const realm of [0.5, -1, 3, NaN, '0', null]) {
    const F = fixture();
    try { assert.equal(F.C.found(F.accounts.aa, realm, 'Amber Watch', 0, [0, 3]).ok, false); }
    finally { F.flush(); }
  }
});
