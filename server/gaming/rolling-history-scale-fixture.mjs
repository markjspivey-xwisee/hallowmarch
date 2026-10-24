// Scratch-only, deterministic sizing model. No network or native writes.
import fs from 'node:fs';
import vm from 'node:vm';
import { createHash } from 'node:crypto';

import { parse } from '../../tools/node_modules/acorn/dist/acorn.mjs';
const root = new URL('../../', import.meta.url);
const text = file => fs.readFileSync(new URL(file, root), 'utf8');
const fixture = text('tools/tests/shared_entities.mjs');
const declaration = parse(fixture, { ecmaVersion: 'latest', sourceType: 'module' }).body.find(n => n.type === 'FunctionDeclaration' && n.id.name === 'page');
const admission = { origin: 'https://march.test', epoch: 2 };
const page = new Function('vm', 'code', 'admission', 'return (' + fixture.slice(declaration.start, declaration.end) + ');')(vm, text('src/14x_netentities.js'), admission);
const a = page('a'); a.authority();
a.run(`for(let i=0;i<523;i++){const human=i%3===0;
 makeEnt({kind:human?'humanoid':i%3===1?'wolf':'deer',role:human?'guard':i%3===1?'mob':'critter',
 faction:human?i%3:3,cls:human?'warrior':null,mobType:human?null:'wolf',level:20,
 x:i%31,y:0,z:Math.floor(i/31),home:{x:i%31,z:Math.floor(i/31),r:12},hp:800,maxHp:800,
 look:human?{tabard:[0.4,0.3,0.2],armor:[0.5,0.5,0.5],skin:0.35,hair:0.4,mask:32,flags:0,scale:1,outfit:0,emblem:3,fem:0,bulk:0}
 :{colA:[0.4,0.5,0.6],colB:[0.2,0.3,0.4]}});}`);
const hash = value => createHash('sha256').update(value).digest('hex');
const canonical = x => x === null || typeof x !== 'object' ? JSON.stringify(x) : Array.isArray(x)
  ? '[' + x.map(canonical).join(',') + ']' : '{' + Object.keys(x).sort().map(k => JSON.stringify(k) + ':' + canonical(x[k])).join(',') + '}';
let owner = 'did:web:identity.interego.xwisee.com:agents:hallowmarch-service';
let namespace = 'hallowmarch-shared-expedition-v1', start = 1700000000000; const worldId = 'hallowmarch-world-season-v1';
const round = value => Math.round(value * 1000) / 1000;
function binding(i) {
  const userId = 'u-play-' + hash('user-' + i).slice(0, 24), accountId = hash('acct-' + i).slice(0, 14);
  return { accountId, binding: { subjectDid: 'did:web:identity.interego.xwisee.com:users:' + userId,
    webId: 'https://identity.interego.xwisee.com/users/' + userId + '/profile#me', userId,
    podUrl: 'https://gate.interego.xwisee.com/' + userId + '/',
    authenticatedAgentDid: 'did:web:identity.interego.xwisee.com:agents:hallowmarch-' + userId,
    verifiedAt: new Date(start).toISOString(), issuer: 'https://identity.interego.xwisee.com/',
    verificationMethod: 'provisional-browser-key', provisional: true,
    proofKeyThumbprint: Buffer.from(hash('key-' + i), 'hex').toString('base64url'),
    expiresAt: new Date(start + 86400000).toISOString(), capabilities: ['human-play', 'own-pod-checkpoint'] },
  accountSummary: { id: accountId, name: 'Traveler', guest: true }, records: {} };
}
function record(streamId, state, version) {
  return { schema: 'urn:interego:gaming:stream:v1', namespace, streamId, version, state, event: null,
    operationId: 'gaming-v1-' + hash(streamId + version) };
}
function world(minute, movingFraction, decorations) {
  a.c.minute = minute; a.c.movingFraction = movingFraction;
  a.run(`for(let i=1;i<ENT.length;i++){const e=ENT[i],n=i-1,move=(n%100)/100<movingFraction;
    if(move){e.x=e.home.x+Math.sin(minute*0.37+n*0.71)*18;e.z=e.home.z+Math.cos(minute*0.29+n*0.43)*18;
      e.yaw=minute*0.15+n*0.02;e.anim.phase=(minute*1.37+n*0.77)%(Math.PI*2);e.anim.amt=0.8;}}`);
  const rows = a.json('window.__hm.entities.wireRows()');
  const boats = decorations ? Array.from({ length: 14 }, (_, i) => ({ id: i + 1, x: i * 20 + (i ? 0 : round(Math.sin(minute) * 10)), z: i * 8,
    yaw: 0, vx: 0, vz: 0, wr: 0, st: 'moored', ph: 0, eff: 0, grounded: 0, char: 0, rider: null, still: true,
    home: { j: i % 3, b: i }, launch: null })) : [];
  const npcs = decorations ? Array.from({ length: 36 }, (_, i) => ({ id: 'town:' + i % 3 + ':villager:' + i, role: 'villager', n: 'Worker ' + i,
    r: i % 3, c: null, l: 1, p: [round(i * 3 + Math.sin(minute * 0.5 + i) * 6), 2, round(i + Math.cos(minute * 0.7 + i) * 6)],
    y: round(minute * 0.2 + i), a: 21, ph: round((minute * 1.3 + i) % (Math.PI * 2)), am: 0.5, h: 100, m: 100, d: 0, g: 0,
    lk: [0.3, 0.4, 0.5, 0.5, 0.5, 0.5, 0.4, 0.3, 0, 0, 1, 0, 3, 0, 0], st: null, fm: [i % 3, 1, 0], hm: 0, bt: null })) : [];
  const parts = { farm: { plots: Array.from({ length: 12 }, (_, i) => ({ id: i, growth: round(Math.min(1, minute / 60)) })) } };
  if (decorations) {
    parts.build = { pieces: Array.from({ length: 24 }, (_, i) => ({ id: i, t: 'found', x: i * 3, z: 60, y: 0, yaw: 0, st: 'built', p: 1, char: 0 })) };
    parts.resources = { mineral: Array.from({ length: 72 }, (_, i) => ({ id: i, x: i * 5, z: 80, kind: 'iron', left: i % 6 ? 100 : Math.max(0, 100 - minute) })) };
  }
  const value = { worlds: { march: { activity: { v: 1, worldAdmission: admission, boats, npcs,
    entities: { v: 1, full: true, rows, remove: [] }, worldparts: { v: 1, full: true, parts, remove: [], receipts: [] } } } },
  season: { savedAt: start + minute * 60000, number: 2, elapsed: minute * 60 } };
  return record(worldId, { schema: 'urn:bridge:owned-state-checkpoint:v1', owner, liveVersion: minute + 1,
    capturedAt: start + minute * 60000, digest: 'sha256:' + hash(canonical(value)), value }, minute + 1);
}
function document(checkpoints, players) {
  return { schema: 'urn:hallowmarch:multiplayer-rolling-hour:v1', owner, namespace,
    resourceUrl: 'https://gate.interego.xwisee.com/hallowmarch/gaming/head', retentionMs: 3600000, writtenAt: start + 59 * 60000,
    streams: [checkpoints.at(-1).streams[0], record('player-bindings-v1', { schema: 'urn:interego:gaming:player-bindings:v1',
      bindings: Array.from({ length: players }, (_, i) => binding(i)) }, players)], checkpoints,
    receipts: Array.from({ length: 60 }, (_, i) => ({ operationId: 'gaming-v1-' + hash('op' + i), inputDigest: hash('input' + i),
      streamId: worldId, version: i + 1, at: start + i * 60000 })), writeBudget: [] };
}

/** Test-only scale fixture. Actors pass through the production netEntityRow
 * serializer; generated motion is already quantized by that authored contract. */
export function realisticRollingWindow({ owner: newOwner = owner, namespace: newNamespace = namespace,
  resourceUrl = 'https://gate.interego.xwisee.com/hallowmarch/gaming/head',
  now = 1700003600000, snapshots = 61, players = 500 } = {}) {
  owner = newOwner; namespace = newNamespace; start = now - (snapshots - 1) * 60000;
  const checkpoints = Array.from({ length: snapshots }, (_, i) => ({ at: start + i * 60000, streams: [world(i, 1, true)] }));
  const doc = document(checkpoints, players);
  doc.resourceUrl = resourceUrl; doc.writtenAt = now;
  doc.receipts = Array.from({ length: snapshots }, (_, i) => ({ operationId: 'gaming-v1-' + hash('operation-' + i),
    inputDigest: hash('input-' + i), streamId: worldId, version: i + 1, at: start + i * 60000 }));
  return doc;
}