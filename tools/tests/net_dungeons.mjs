import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const core = fs.readFileSync(new URL('../../src/14z_networldparts.js', import.meta.url), 'utf8');
const moduleSource = fs.readFileSync(new URL('../../src/14z_netdungeons.js', import.meta.url), 'utf8');
const barrow = fs.readFileSync(new URL('../../src/08e_barrow.js', import.meta.url), 'utf8');
const deep = fs.readFileSync(new URL('../../src/10m_deep.js', import.meta.url), 'utf8');
const mechanisms = barrow.slice(barrow.indexOf('function openChest('), barrow.indexOf('function updateChests('))
  + deep.slice(deep.indexOf('function deepWallBreak('), deep.indexOf('const DEEP_FLOOD'))
  + deep.slice(deep.indexOf('function late3ApplySaved('), deep.indexOf("queueMicrotask(() => { if (!window.__hm)", deep.indexOf('const DEEP_PART')));
const expose = 'globalThis.hm={state:NETPARTS,message:netWorldPartsMessage,pump:netWorldPartsPump,capture:netWorldPartsCapture,flush:netWorldPartsFlushJournal,journalSave:netWorldPartsJournalSave,chest:openChest,deepChest:late3OpenChest,seal:late3SealOpen,strike:deepWallStrike,save:netDungeonSave,private:DEEP_PART};';

function client(self, level = 50, king = 2, kills = 0) {
  let clock = 1000, persisted = null, uuid = 0, item = 0;
  const sent = [], delayed = [], N = () => {};
  const ctx = {
    console, Map, Set, JSON, Object, Number, Array, Infinity, setTimeout, clearTimeout,
    Math: Object.assign(Object.create(Math), { random: () => 0.25 }), queueMicrotask: N,
    performance: { now: () => clock }, crypto: { randomUUID: () => self + '-request-' + (++uuid) }, window: {},
    NETWS: { url: 'https://game.example', state: 'on', acct: { id: self + '-account' } },
    NET: { self, peers: new Map() }, SAVE: { native: true, ref: null, nativeFlight: null, lastBody: '', wiping: false },
    GAME: { t: 100, player: { id: self + '-body', alive: true, x: 5, y: -7, z: 0, cls: 'mage', faction: 1, level, role: 'player' },
      prog: { level, kingKills: king, personal: self } },
    INV: { goods: { privateGem: 4 }, gold: 900, bag: [] }, BAG_SIZE: 24, GOODS_UI: {},
    GOODS: { grave_iron: { stack: 999 }, privateGem: { stack: 999 } },
    DEEP: { built: true, opened: false, wallBroken: false, kills, taken: {}, stats: { sealOpened: 0, wallBroken: 0, chests: 0 },
      wall: { x: 30, z: 0, hits: 0, mesh: { visible: true }, coll: { active: true } },
      seal: { open: 0, target: 0, mesh: { position: { x: 5, y: -7, z: 0 } }, coll: { active: true } },
      rubble: { userData: {}, visible: false }, chests: [] },
    DUN: { chests: [] }, DEEP_Y: -30, DEEP_SEAL: { u: 5, v: 0, h: 4.5 }, DEEP_LV: 45,
    DEEP_LORD: { respawn: 900 }, DEEP_RESPAWN: 300, BARROW_RESPAWN: 240, KING_RESPAWN: 900,
    LEVEL_CAP: 50, DROP_WEIGHTS: { boss: [1], chest: [1] }, FACTION_MONSTER: 9, ENT: [], LATE2: { d: { deep: kills, king } },
    netOn: () => true, netHumanLive: () => true, netSharedWorldReady: () => true, netWorldAdmissionRead: a => a,
    netWsSend: m => { sent.push(structuredClone(m)); return true; }, registerSavePart: N, SAVE_PARTS: { world: {} },
    clamp: (v, lo, hi) => Math.max(lo, Math.min(v, hi)), smooth: n => n,
    dist: (x, z, a, b) => Math.hypot(x - a, z - b), dist2: (x, z, a, b) => (x - a) ** 2 + (z - b) ** 2,
    dunWX: x => x, dunWZ: z => z, inDungeon: actor => actor.y < 0, barrowBoost: () => 30,
    later: (seconds, fn) => { delayed.push(fn); }, deepRubbleGeo: () => ({}),
    sfx: N, sfxAt: N, uiError: N, uiLog: N, uiToast: N, uiBanner: N, uiFloatAt: N, cameraShake: N, lightFlash: N,
    FX: { burst: N, dust: N }, saveSoon: N, loreNote: N, skillGain: N, late2CheckNames: N, setAct: N,
    reportError: error => { throw error; },
    makeItem: o => ({ id: self + '-item-' + (++item), slot: 'weapon', ...o }), rollQuality: () => 4,
    dropItem: () => { throw Error('Shared chest scheduled world loot'); }, dropGood: N,
  };
  for (const [id, x, y] of [['crypt', 10, -7], ['vault', 15, -7], ['dcist', 20, -30], ['dpyre', 25, -30], ['dniche', 30, -30], ['dhoard', 35, -30]]) {
    const ch = { id, x, y, z: 0, deep: id.startsWith('d'), ready: id !== 'dniche', opened: false, refillAt: 0, lid: 0, lidMesh: { rotation: { x: 0 } } };
    ctx.DUN.chests.push(ch); if (ch.deep) ctx.DEEP.chests.push(ch);
  }
  ctx.late3SealReady = () => ctx.GAME.prog.level >= 45 && ctx.GAME.prog.kingKills > 0;
  ctx.late3SealWhy = () => 'Reach level 45 and lay the Hollow King to rest.';
  ctx.goodsHave = (id, n = 1) => (ctx.INV.goods[id] || 0) >= n;
  ctx.goodsTake = (id, n) => { if (!ctx.goodsHave(id, n)) return false; ctx.INV.goods[id] -= n; return true; };
  ctx.goodsTakeAll = rows => rows.every(([id, n]) => ctx.goodsHave(id, n)) && rows.every(([id, n]) => ctx.goodsTake(id, n));
  ctx.goodsAdd = (id, n) => { const k = Math.max(0, Math.min(n, ctx.GOODS[id].stack - (ctx.INV.goods[id] || 0))); ctx.INV.goods[id] = (ctx.INV.goods[id] || 0) + k; return k; };
  ctx.addGold = n => { ctx.INV.gold += Math.round(n); };
  ctx.bagAdd = v => { if (ctx.INV.bag.length >= ctx.BAG_SIZE) return false; ctx.INV.bag.push(v); return true; };
  ctx.SAVE.ref = { get: async () => ({ exists: persisted !== null, data: () => structuredClone(persisted) }) };
  ctx.saveNow = async () => {
    persisted = { char: { x: { sharedWorldReservations: structuredClone(ctx.hm.journalSave()) },
      goods: structuredClone(ctx.INV.goods), gold: ctx.INV.gold, bag: structuredClone(ctx.INV.bag) } };
    ctx.SAVE.lastBody = JSON.stringify(persisted);
  };
  vm.createContext(ctx);
  vm.runInContext(core + mechanisms + '\nqueueMicrotask = fn => fn();\n' + moduleSource + '\n' + expose, ctx);
  const admission = { origin: 'https://game.example', epoch: 3 };
  ctx.hm.message({ t: 'activity', kind: 'authority', authority: 'token', peer: 'keeper', worldAdmission: admission, worldpartsReady: false });
  return { ctx, hm: ctx.hm, self, sent, delayed, admission, tick(ms) { clock += ms; ctx.GAME.t += ms / 1000; ctx.hm.pump(clock); } };
}
function receive(peer, value) {
  peer.hm.message({ t: 'activity', kind: 'worldparts', op: 'snapshot', authority: 'token', worldAdmission: peer.admission,
    seq: 100, part: 0, total: 1, data: JSON.stringify(value) });
}
function move(peer, x, y) { Object.assign(peer.ctx.GAME.player, { x, y, z: 0 }); }
function command(host, peer) {
  const m = peer.sent.findLast(message => message.op === 'command');
  assert.ok(m, 'a real interaction dispatched a private-confirmed request');
  const actor = peer.ctx.GAME.player; host.ctx.NET.peers.set(peer.self, { ghost: { ...actor } });
  host.hm.message({ ...m, from: peer.self, ownerAccount: peer.ctx.NETWS.acct.id, position: { x: actor.x, z: actor.z } });
}
async function sync(host, peers, rounds = 4) {
  for (let i = 0; i < rounds; i++) {
    host.sent.length = 0; host.tick(2000);
    for (const packet of host.sent.filter(m => m.op === 'snapshot')) {
      host.hm.message(packet); for (const peer of peers) peer.hm.message(packet);
    }
    for (const result of host.sent.filter(m => m.op === 'result')) {
      const peer = peers.find(p => p.self === result.to); if (peer) peer.hm.message(result);
    }
    await Promise.all(peers.map(p => p.hm.flush()));
    for (const peer of peers) {
      for (const settled of peer.sent.filter(m => m.op === 'settled'))
        host.hm.message({ ...settled, from: peer.self, ownerAccount: peer.ctx.NETWS.acct.id });
      peer.sent.length = 0;
    }
  }
}

test('seal and wall changes share across distinct characters while personal deeds remain isolated', async () => {
  const host = client('keeper', 17, 0), phone = client('phone', 50, 3, 7);
  await sync(host, [phone]);
  phone.hm.seal(false); await phone.hm.flush(); command(host, phone);
  assert.equal(host.ctx.DEEP.opened, true); assert.equal(phone.ctx.DEEP.opened, false);
  await sync(host, [phone]);
  assert.equal(phone.ctx.DEEP.opened, true); assert.equal(phone.ctx.DEEP.seal.coll.active, false);
  assert.equal(host.ctx.GAME.prog.kingKills, 0); assert.equal(phone.ctx.GAME.prog.kingKills, 3);
  for (let n = 1; n <= 3; n++) {
    move(phone, 30, -30); phone.hm.strike(); await phone.hm.flush(); command(host, phone); await sync(host, [phone]);
    assert.equal(phone.ctx.DEEP.wall.hits, n); assert.equal(host.ctx.DEEP.wall.hits, n);
  }
  assert.equal(phone.ctx.DEEP.wallBroken, true); assert.equal(phone.ctx.DEEP.wall.coll.active, false);
  phone.hm.private.load({ v: 1, o: 0, w: 0, k: 9, c: {} });
  assert.equal(phone.ctx.DEEP.opened, true); assert.equal(phone.ctx.DEEP.wallBroken, true);
  assert.equal(phone.ctx.DEEP.kills, 9); assert.equal(phone.ctx.LATE2.d.deep, 9); assert.equal(host.ctx.DEEP.kills, 0);
  assert.deepEqual(Object.keys(phone.hm.private.save()).sort(), ['k', 'v']);
  assert.equal(Object.hasOwn(host.hm.save(), 'kills'), false); assert.equal(host.delayed.length, 0);
});

test('concurrent chest uses roll one reward and late join reload preserves opened state without private rewards', async () => {
  const host = client('keeper', 17, 0), phone = client('phone'), tablet = client('tablet');
  await sync(host, [phone, tablet]);
  for (const peer of [phone, tablet]) {
    move(peer, 10, -7); peer.hm.chest(peer.ctx.DUN.chests[0]); await peer.hm.flush(); command(host, peer);
  }
  assert.equal(host.ctx.DUN.chests[0].opened, true); assert.equal(phone.ctx.INV.gold, 900);
  assert.equal(host.ctx.INV.gold, 900); assert.equal(host.ctx.INV.bag.length, 0); assert.equal(host.delayed.length, 0);
  await sync(host, [phone, tablet], 6);
  assert.equal(phone.ctx.INV.gold, 978); assert.equal(phone.ctx.INV.bag.length, 2);
  assert.equal(tablet.ctx.INV.gold, 900); assert.equal(tablet.ctx.INV.bag.length, 0);
  assert.equal(phone.ctx.DUN.chests[0].opened, true); assert.equal(tablet.ctx.DUN.chests[0].opened, true);
  assert.equal(phone.hm.state.pending.size, 0); assert.equal(tablet.hm.state.pending.size, 0);
  const late = client('late', 12, 0, 1);
  late.hm.private.load({ v: 1, o: 1, w: 1, k: 2, c: { dcist: 600 } });
  assert.equal(late.ctx.DEEP.opened, false, 'old private flags cannot seed the public scene');
  receive(late, host.hm.capture()); const refill = late.ctx.DUN.chests[0].refillAt;
  assert.equal(late.ctx.DUN.chests[0].opened, true); assert.equal(late.ctx.DEEP.kills, 2);
  late.ctx.GAME.t += 10; late.hm.private.load({ v: 1, o: 0, w: 0, k: 3, c: {} });
  assert.equal(late.ctx.DUN.chests[0].opened, true); assert.equal(late.ctx.DUN.chests[0].refillAt, refill);
  assert.equal(late.ctx.DEEP.kills, 3); assert.equal(late.ctx.GAME.prog.level, 12); assert.equal(late.ctx.INV.gold, 900);
  assert.equal(late.ctx.INV.bag.length, 0);
});

test('deep chest rewards remain owed when packs fill and height validation excludes surface characters', async () => {
  const host = client('keeper', 17, 0), phone = client('phone');
  await sync(host, [phone]);
  move(phone, 20, 0); phone.hm.deepChest(phone.ctx.DEEP.chests[0]); await phone.hm.flush(); command(host, phone);
  await sync(host, [phone]); assert.equal(host.ctx.DEEP.chests[0].opened, false); assert.equal(phone.ctx.INV.gold, 900);
  move(phone, 20, -30); phone.hm.deepChest(phone.ctx.DEEP.chests[0]); await phone.hm.flush(); command(host, phone);
  phone.ctx.INV.bag = Array.from({ length: 24 }, (_, i) => ({ id: 'owned-' + i, slot: 'head' }));
  await sync(host, [phone]);
  assert.equal(phone.ctx.DEEP.chests[0].opened, true); assert.equal(phone.ctx.INV.gold, 900);
  assert.equal(phone.ctx.INV.goods.grave_iron || 0, 0); assert.equal(phone.hm.state.pending.size, 1);
  phone.ctx.INV.bag.splice(0, 2); phone.tick(200); await phone.hm.flush();
  assert.equal(phone.ctx.INV.gold, 1070); assert.equal(phone.ctx.INV.goods.grave_iron, 1);
  assert.equal(phone.ctx.INV.bag.length, 24); assert.equal(phone.hm.state.pending.size, 0); assert.equal(host.delayed.length, 0);
});
