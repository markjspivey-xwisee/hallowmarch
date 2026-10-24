import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { activityNpc } from '../server/shared-scene.js';

const source = fs.readFileSync(new URL('../src/14y_netnpcs.js', import.meta.url), 'utf8');
const admission = { origin: 'https://march.example', epoch: 9 };
const copy = value => JSON.parse(JSON.stringify(value));
function client(peer, offset = 0) {
  const sent = [], bodies = [];
  const state = { now: 0, live: true, connected: true, ready: true, server: 'wss://march.example', admission };
  let next = offset;
  const context = vm.createContext({
    Math, Number, Object, Array, Map, Set, URL, JSON, console,
    CLASSES: { priest: {}, warrior: {} }, FACTION_NEUTRAL: 4,
    GAME: { built: true, t: 10 }, NET: { self: peer }, NETWS: { state: 'on' },
    REALMS: [0, 1, 2].map(id => ({ town: { x: id * 200, z: 0 } })),
    FARM: { farmers: [], plots: [{ own: 't', stand: { worker: 8 } }] },
    performance: { now: () => state.now },
    netServerUrl: () => state.server, netOn: () => state.connected,
    netHumanLive: () => state.live, netSharedWorldReady: () => state.ready,
    netCurrentWorldAdmission: () => state.admission,
    netWorldAdmissionRead: x => x && typeof x.origin === 'string' && Number.isSafeInteger(x.epoch) ? x : null,
    netSameWorldAdmission: (a, b) => !!a && !!b && a.origin === b.origin && a.epoch === b.epoch,
    netWsSend: m => { sent.push(copy(m)); return true; },
    lerp: (a, b, u) => a + (b - a) * u,
    angDiff: (a, b) => ((b - a + Math.PI * 3) % (Math.PI * 2)) - Math.PI,
    animActValue: e => e.netNpcPose ?? e.desiredAct ?? 0,
    makeEnt: o => {
      const e = { id: ++next, ai: {}, anim: { phase: 0, amt: 0 },
        hp: 100, maxHp: 100, alive: true, removed: false, x: 0, y: 0, z: 0, yaw: 0, ...o };
      bodies.push(e); return e;
    },
  });
  vm.runInContext(source + '\n globalThis.api = { netNpcRegister, netNpcMessage, netNpcPump, netNpcReset, netNpcStep, netNpcVisible, netNpcSnapshot, netNpcRowsRead, NET_NPCS };', context);
  return { context, api: context.api, sent, bodies, state,
    entity(overrides = {}, id = 'town:0:villager:0') {
      const e = context.makeEnt({ kind: 'humanoid', role: 'villager', name: 'Fenn', faction: 4,
        cls: null, level: 5, x: 7, y: 2, z: 9, yaw: .6,
        look: { tabard: [.3, .4, .5], armor: [.4, .3, .2], skin: .2, hair: .7, mask: 32,
          flags: 0, scale: 1, outfit: 0, emblem: 3, fem: 0, bulk: 0 }, ...overrides });
      context.api.netNpcRegister(e, id); return e;
    },
  };
}
function authority(peer, npcs = [], token = 'lease-one') {
  return { t: 'activity', kind: 'authority', authority: token, peer, worldAdmission: admission, npcs };
}
function snapshot(m, peer) { return { ...copy(m), peer }; }

test('independent devices converge on the same farmer body, work pose and interaction metadata', () => {
  const a = client('phone'), b = client('desktop', 400);
  const farmer = a.entity({ x: 50, z: 65, desiredAct: 23.45, _hamUntil: 20 });
  farmer.ai = { farmer: true, fieldHand: true, seedSeller: true }; farmer.farmTown = 0;
  farmer.anim.phase = 7.5; farmer.anim.amt = .7;
  farmer.seat = { y: 2.3, yaw: .6, sx: 50, sz: 65 };
  const local = b.entity({ x: -120, name: 'Different local random villager' });
  assert.equal(b.api.netNpcVisible(local), false, 'a private bootstrap NPC is not a shared NPC');
  a.api.netNpcMessage(authority('phone')); b.api.netNpcMessage(authority('phone'));
  a.api.netNpcPump(0);
  assert.equal(a.sent.length, 1);
  assert.equal(b.api.netNpcMessage(snapshot(a.sent[0], 'phone')), true);
  b.state.now = 1000; assert.equal(b.api.netNpcStep(local, 1 / 60), true);
  assert.deepEqual([local.x, local.y, local.z], [50, 2, 65]);
  assert.equal(local.name, 'Fenn'); assert.equal(local.netNpcPose, 23.45);
  assert.equal(local._hamUntil > b.context.GAME.t, true);
  assert.deepEqual(copy(local.seat), copy(farmer.seat));
  assert.deepEqual(copy(local.look), copy(farmer.look));
  assert.equal(local.ai.seedSeller, true); assert.equal(local.ai.fieldHand, true);
  assert.deepEqual(copy(b.context.FARM.farmers), [local.id]);
  assert.notEqual(farmer.id, local.id, 'network identities do not use local entity counters');
  assert.equal(b.api.netNpcVisible(local), true);
});

test('a late join reconstructs missing stable actors and applies death/removal without duplicates', () => {
  const a = client('a'), b = client('b'); a.entity(); a.api.netNpcMessage(authority('a'));
  const rows = a.api.netNpcSnapshot();
  b.api.netNpcMessage(authority('a', rows));
  assert.equal(b.bodies.length, 1);
  b.api.netNpcMessage(authority('a', rows)); assert.equal(b.bodies.length, 1);
  const body = b.bodies[0], frame = { t: 'activity', kind: 'npcs', op: 'snapshot', authority: 'lease-one', peer: 'a', worldAdmission: admission, seq: 1, npcs: copy(rows) };
  frame.npcs[0].d = 1; frame.npcs[0].h = 0;
  assert.equal(b.api.netNpcMessage(frame), true); assert.equal(body.alive, false);
  assert.equal(b.api.netNpcStep(body, .1), true, 'replicas cannot remove or run their own dead NPC');
  frame.seq++; frame.npcs[0].g = 1; b.api.netNpcMessage(frame);
  assert.equal(b.api.netNpcVisible(body), false);
});

test('authority handoff begins at the confirmed pose and fences old host packets', () => {
  const b = client('b'), e = b.entity({ x: -100 });
  const a = client('a'); a.entity({ x: 90 }); a.api.netNpcMessage(authority('a'));
  const rows = a.api.netNpcSnapshot();
  e.ai.plan = { private: true };
  assert.equal(b.api.netNpcMessage(authority('b', rows, 'lease-two')), true);
  assert.equal(e.x, 90); assert.equal(e.ai.plan, null);
  assert.equal(b.context.FARM.plots[0].stand.worker, null);
  assert.equal(b.api.netNpcStep(e, .1), false, 'only the new authority runs the NPC behaviour');
  const stale = { t: 'activity', kind: 'npcs', op: 'snapshot', authority: 'lease-one', peer: 'a', worldAdmission: admission, seq: 500, npcs: rows };
  assert.equal(b.api.netNpcMessage(stale), false); assert.equal(e.x, 90);
  b.api.netNpcPump(0); assert.equal(b.sent[0].authority, 'lease-two'); assert.equal(b.sent[0].seq, 1);
  b.context.NETWS.state = 'off'; assert.equal(b.api.netNpcStep(e, .1), true, 'disconnect freezes even the former authority');
});

test('malformed, replayed and wrong-world frames never replace a confirmed roster', () => {
  const a = client('a'), b = client('b'); a.entity(); a.api.netNpcMessage(authority('a')); a.api.netNpcPump(0);
  b.api.netNpcMessage(authority('a')); const frame = snapshot(a.sent[0], 'a');
  assert.equal(b.api.netNpcMessage(frame), true);
  assert.equal(b.api.netNpcMessage(frame), false);
  for (const patch of [{ peer: 'intruder', seq: 2 }, { authority: 'old', seq: 2 },
    { worldAdmission: { ...admission, epoch: 8 }, seq: 2 },
    { npcs: [{ ...frame.npcs[0], p: [NaN, 0, 0] }], seq: 2 },
    { npcs: [frame.npcs[0], frame.npcs[0]], seq: 2 }]) {
    assert.equal(b.api.netNpcMessage({ ...frame, ...patch }), false);
  }
  assert.equal(b.api.NET_NPCS.rows.size, 1);
  for (let i = 2; i < 100; i++) { b.state.now += 250; b.api.netNpcMessage({ ...frame, seq: i }); }
  assert.equal(b.api.NET_NPCS.buffers.get('town:0:villager:0').length, 4, 'buffers stay bounded');
});

test('publication is live-only, admission-gated and capped at four frames a second', () => {
  const a = client('a'); const e = a.entity(); a.api.netNpcMessage(authority('a'));
  a.state.live = false; a.api.netNpcPump(0); assert.equal(a.sent.length, 0);
  a.state.live = true; a.state.ready = false; a.api.netNpcPump(0); assert.equal(a.sent.length, 0);
  a.state.ready = true; a.api.netNpcPump(0); a.api.netNpcPump(50); a.api.netNpcPump(249);
  assert.equal(a.sent.length, 1); a.api.netNpcPump(250); assert.equal(a.sent.length, 2);
  a.api.netNpcReset(); a.api.netNpcPump(1000); assert.equal(a.sent.length, 2);
  assert.equal(a.api.netNpcStep(e, .1), true, 'reconnect waits for a fresh authority');
  a.state.server = ''; assert.equal(a.api.netNpcStep(e, .1), false, 'standalone gameplay is unchanged');
  assert.equal(a.api.netNpcVisible(e), true);
});

test('an authority cannot resurrect a locally removed worker from its stale handoff cache', () => {
  const a = client('a'), e = a.entity();
  const prior = a.api.netNpcSnapshot();
  a.api.netNpcMessage(authority('a', prior));
  e.alive = false; e.hp = 0; e.removed = true;
  a.api.netNpcPump(0);
  assert.equal(a.bodies.length, 1);
  assert.equal(a.sent[0].npcs[0].g, 1);
});

test('a shared fisher keeps the shared boat seat, oar phase and dismount on other devices', () => {
  const a = client('a'), b = client('b');
  const fisher = a.entity({ boat: { id: 7 } }), local = b.entity();
  const boat = { id: 7, x: 70, z: 80, y: 1, yaw: .4, ph: .7, eff: .6 };
  b.context.BOATS = { list: [boat] };
  b.context.boatSeat = (e, B) => { e.x = B.x; e.y = B.y; e.z = B.z; e.fixedY = B.y; };
  a.api.netNpcMessage(authority('a')); b.api.netNpcMessage(authority('a'));
  a.api.netNpcPump(0); b.api.netNpcMessage(snapshot(a.sent[0], 'a'));
  b.state.now = 1000; b.api.netNpcStep(local, .1);
  assert.equal(local.boat, boat); assert.equal(boat.rider, local.id);
  assert.equal(local.rowPh, .7); assert.equal(local.rowK, .6);
  assert.equal(local.yaw, boat.yaw + Math.PI);
  assert.deepEqual([local.x, local.z], [70, 80]);
  fisher.boat = null; a.api.netNpcPump(250); b.api.netNpcMessage(snapshot(a.sent[1], 'a'));
  b.state.now += 1000; b.api.netNpcStep(local, .1);
  assert.equal(local.boat, null); assert.equal(boat.rider, null); assert.equal(local.fixedY, null);
});

test('authority received before world construction recreates the admitted service NPC after boot', () => {
  const a = client('a'), b = client('b'); a.entity(); a.api.netNpcMessage(authority('a'));
  const row = copy(a.api.netNpcSnapshot()[0]);
  Object.assign(row, { id: 'town:0:merchant:1', role: 'merchant', n: 'Quartermaster Fenn', l: 20 });
  b.context.GAME.built = false;
  assert.equal(b.api.netNpcMessage(authority('b', [row])), true);
  assert.equal(b.bodies.length, 0);
  b.context.GAME.built = true;
  b.api.netNpcPump(0);
  assert.equal(b.bodies.length, 1);
  const npc = b.bodies[0];
  assert.equal(b.context.REALMS[0].quartermaster, npc);
  assert.equal(npc.fixedY, row.p[1]);
  assert.equal(b.api.netNpcStep(npc, .1), false);
  assert.equal(b.sent[0].npcs[0].id, 'town:0:merchant:1');
});

test('fisher handoff resumes the admitted boat, while an on-foot cache clears a former private boat', () => {
  const a = client('a'), b = client('b'); a.entity({ boat: { id: 7 } });
  a.api.netNpcMessage(authority('a')); const rows = a.api.netNpcSnapshot();
  const local = b.entity();
  const boat = { id: 7, home: { j: 0, b: 0 }, x: 70, z: 80, y: 1, yaw: .4, ph: .7, eff: .6 };
  const jetty = { boats: [boat], fisher: null };
  b.context.BOATS = { list: [boat], jetties: [jetty] };
  b.context.boatSeat = (e, B) => { e.x = B.x; e.y = B.y; e.z = B.z; e.fixedY = B.y; };
  local.ai.fisher = { st: 'out', B: boat, J: jetty, t: 999 };
  assert.equal(b.api.netNpcMessage(authority('b', rows, 'takeover')), true);
  assert.equal(local.boat, boat); assert.equal(local.ai.fisher.st, 'back');
  assert.equal(local.ai.fisher.t, 0); assert.equal(jetty.fisher, local.id);
  const foot = copy(rows); foot[0].bt = null; foot[0].st = null;
  assert.equal(b.api.netNpcMessage(authority('b', foot, 'next-takeover')), true);
  assert.equal(local.boat, null); assert.equal(local.fixedY, null); assert.equal(jetty.fisher, null);
  assert.equal(local.ai.fisher, null);
});

test('the real shop initializer registers one stable service NPC per realm', () => {
  const b = client('b');
  const loot = fs.readFileSync(new URL('../src/09c_loot.js', import.meta.url), 'utf8');
  const start = loot.indexOf('function initMerchants()');
  const end = loot.indexOf('\nfunction merchantStock', start);
  assert.ok(start >= 0 && end > start);
  b.context.REALMS.forEach((r, id) => { r.id = id; r.town.yaw = 0; });
  Object.assign(b.context, {
    siteToWorld: (s, x, z) => ({ x: s.x + x, z: s.z + z }), heightAt: () => 0,
    WB: { robe: 1, belt: 2, skirt: 4 }, NAMES: [['Ada', 'Ben'], ['Ada', 'Ben'], ['Ada', 'Ben']],
    FEMALE: new Set(['Ada']), pick: (_rng, names) => names[0],
    villagerLook: () => ({ tabard: [.3, .4, .5], armor: [.4, .3, .2], skin: .2, hair: .7,
      mask: 32, flags: 0, scale: 1, outfit: 0, emblem: 3, fem: 0, bulk: 0 }),
  });
  vm.runInContext(loot.slice(start, end) + '\ninitMerchants();', b.context);
  assert.equal(b.api.NET_NPCS.entities.size, 3);
  for (let r = 0; r < 3; r++) {
    const m = b.context.REALMS[r].merchant;
    assert.equal(m.netNpcId, `town:${r}:merchant:0`);
    assert.equal(b.api.NET_NPCS.entities.get(m.netNpcId), m);
  }
});

test('appearance transport quantizes continuous traits and preserves exact equipment bitfields', () => {
  const a = client('a'), e = a.entity();
  e.look.tabard[0] = .554132194865376; e.look.scale = .9645453137661634;
  e.look.mask = 14554754; e.look.flags = 345; e.look.outfit = 2;
  const row = a.api.netNpcSnapshot()[0];
  assert.equal(row.lk[0], .554); assert.equal(row.lk[10], .965);
  assert.equal(row.lk[8], 14554754); assert.equal(row.lk[9], 345); assert.equal(row.lk[11], 2);
});

test('actual villager, merchant and herald rig outfits survive client and server roundtrips', () => {
  const rig = fs.readFileSync(new URL('../src/05a_rig.js', import.meta.url), 'utf8');
  const declaration = rig.match(/^const OUTFIT = \{[^\n]+\};/m);
  assert.ok(declaration, 'the production rig owns the outfit enumeration');
  const outfits = vm.runInNewContext(declaration[0] + '\nOUTFIT;');
  const a = client('phone'), b = client('desktop');
  for (const [role, outfit] of [['villager', outfits.villager], ['merchant', outfits.villager], ['herald', outfits.herald]]) {
    const e = a.entity({ role }, `town:0:${role}:0`);
    e.look.outfit = outfit;
  }
  a.api.netNpcMessage(authority('phone'));
  a.api.netNpcPump(0);
  const rows = a.sent[0].npcs;
  assert.equal(rows.length, 3, 'the complete authored town roster is published');
  assert.deepEqual(rows.map(r => [r.role, r.lk[11]]), [['villager', outfits.villager], ['merchant', outfits.villager], ['herald', outfits.herald]]);
  const normalized = rows.map(activityNpc);
  assert.ok(normalized.every(Boolean));
  b.api.netNpcMessage(authority('phone', normalized));
  assert.equal(b.bodies.length, 3);
  assert.deepEqual(copy(b.api.netNpcSnapshot()).map(r => [r.role, r.lk[11]]), rows.map(r => [r.role, r.lk[11]]));
  for (const outfit of [-1, .5, outfits.bandit, outfits.skeleton, outfits.draugr, outfits.troll, outfits.lord, 11, 999]) {
    const invalid = copy(rows[0]); invalid.lk[11] = outfit;
    assert.equal(a.api.netNpcRowsRead([invalid]), null, `unsupported NPC outfit ${outfit} is refused`);
  }
});

test('a stale fisher frame cannot replace a later exclusive human boat occupant', () => {
  const a = client('a'), b = client('b'); a.entity({ boat: { id: 7 } });
  const local = b.entity();
  const boat = { id: 7, netRider: 'human-peer', rider: 900, x: 70, z: 80, y: 1, yaw: .4, ph: .7, eff: .6 };
  b.context.BOATS = { list: [boat] };
  b.context.boatSeat = () => { throw Error('A fisher must not take the granted human seat'); };
  a.api.netNpcMessage(authority('a')); b.api.netNpcMessage(authority('a'));
  a.api.netNpcPump(0); b.api.netNpcMessage(snapshot(a.sent[0], 'a'));
  b.state.now = 1000; b.api.netNpcStep(local, .1);
  assert.equal(boat.rider, 900); assert.equal(local.boat, null);
});

test('server normalization round-trips the client NPC schema including masks and numeric boat identity', () => {
  const a = client('a'), e = a.entity({ boat: { id: 128 } });
  e.look.mask = (1 << 24) - 1; e.look.flags = 1023; e.look.scale = 1.12;
  e.anim.phase = Math.PI * 128 - .01; e.desiredAct = 23.99;
  e.ai.farmer = true; e.ai.fieldHand = true; e.ai.seedSeller = true; e.farmTown = 2;
  e.seat = { y: 2, yaw: .3, sx: 4, sz: 5 };
  const outgoing = copy(a.api.netNpcSnapshot()[0]);
  const normalized = activityNpc(outgoing);
  assert.ok(normalized); assert.deepEqual(normalized, outgoing);
  const decoded = a.api.netNpcRowsRead([normalized]);
  assert.ok(decoded); assert.equal(decoded[0].bt, 128); assert.equal(decoded[0].lk[8], (1 << 24) - 1);
});

test('the elected town keeper waits for canonical fields before running AI without blocking roster publication', () => {
  const a = client('a'), e = a.entity();
  a.context.netWorldPartsCanSimulate = () => false;
  a.api.netNpcMessage(authority('a'));
  assert.equal(a.api.netNpcStep(e, .1), true, 'elected authority cannot work a private field before canonical state');
  a.api.netNpcPump(0);
  assert.equal(a.sent.length, 1, 'initial roster publication remains independent of world readiness');
  a.context.netWorldPartsCanSimulate = () => true;
  assert.equal(a.api.netNpcStep(e, .1), false, 'town AI resumes after the admitted core is ready');
});
