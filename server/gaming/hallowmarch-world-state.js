import fs from 'node:fs';
import path from 'node:path';
import { createProgressiveOwnedState, OwnedStateError } from './progressive-owned-state.js';

const own = value => value !== null && typeof value === 'object' && !Array.isArray(value)
  && [Object.prototype, null].includes(Object.getPrototypeOf(value));
// roomFor accepts a 32-character base and may append '-99'.
const roomName = /^[a-z0-9][a-z0-9_-]{0,34}$/;
const WORLD_FIELDS = new Set(['k', 'g', 'td', 'tm', 'cn', 'cl', 'at', 'wx']);
function invalid() { throw new OwnedStateError('INVALID_WORLD_STATE', 'The owned world snapshot is invalid; recovery is required.'); }

/** Preserve the legacy JSON omission of undefined object properties, without
 * silently converting nonfinite numbers, array holes, functions or classes. */
function project(value, depth = 0, active = new Set(), array = false) {
  if (value === undefined && !array) return undefined;
  if (value === null || ['string', 'boolean'].includes(typeof value)) return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (depth > 64 || (!Array.isArray(value) && !own(value)) || active.has(value)) invalid();
  active.add(value);
  try {
    if (Array.isArray(value)) {
      const out = [];
      for (let i = 0; i < value.length; i++) {
        if (!Object.hasOwn(value, i)) invalid();
        out.push(project(value[i], depth + 1, active, true));
      }
      return out;
    }
    const out = Object.create(null);
    for (const key of Object.keys(value)) {
      const clean = project(value[key], depth + 1, active);
      if (clean !== undefined) out[key] = clean;
    }
    return out;
  } finally { active.delete(value); }
}

export function checkedWorldSnapshot(value, { keepCount, realmModule } = {}) {
  const clean = project(value);
  if (!own(clean) || Object.keys(clean).sort().join(',') !== 'season,worlds' || !own(clean.worlds)
    || !Number.isSafeInteger(keepCount) || keepCount < 1 || keepCount > 32 || !realmModule) invalid();
  for (const [name, world] of Object.entries(clean.worlds)) {
    if (!roomName.test(name) || !own(world) || Object.keys(world).some(key => !WORLD_FIELDS.has(key))) invalid();
    if (world.k !== undefined && (!Array.isArray(world.k) || world.k.length !== keepCount || !world.k.every(n => [0, 1, 2].includes(n)))) invalid();
    if (world.g !== undefined && (!Array.isArray(world.g) || world.g.length !== keepCount || !world.g.every(n => [0, 1].includes(n)))) invalid();
    if (world.td !== undefined && (!(world.td >= 0 && world.td <= 3) || typeof world.td !== 'number')) invalid();
    if (world.tm !== undefined && ![0, 1].includes(world.tm)) invalid();
    if (world.cn !== undefined && (!Number.isInteger(world.cn) || world.cn < 0)) invalid();
    if (world.at !== undefined && (!Number.isSafeInteger(world.at) || world.at < 0)) invalid();
    if (world.cl !== undefined && (!Array.isArray(world.cl) || world.cl.length !== 3
      || !world.cl.every(pair => Array.isArray(pair) && pair.length === 2 && pair.every(n => typeof n === 'number' && n >= 0 && n <= 1e5)))) invalid();
    if (world.wx !== undefined && (!own(world.wx) || world.wx.v !== 1 || !Array.isArray(world.wx.c) || Buffer.byteLength(JSON.stringify(world.wx)) > 4200)) invalid();
  }
  if (clean.season !== null) {
    const season = clean.season;
    if (!own(season) || season.v !== 1 || !Number.isSafeInteger(season.n) || season.n < 1
      || typeof season.t !== 'number' || season.t < 0 || typeof season.len !== 'number' || season.len <= 0
      || !Array.isArray(season.realms) || season.realms.length !== 3 || !season.realms.every(own)
      || !Array.isArray(season.keeps) || season.keeps.length !== keepCount || !season.keeps.every(own)
      || (season.savedAt !== undefined && (!Number.isSafeInteger(season.savedAt) || season.savedAt < 0))) invalid();
    if (realmModule.loops && !season.realms.every(realm => Array.isArray(realm.s) && realm.s.length === 8)) invalid();
    if (!realmModule.loops && (!season.stub || !season.realms.every(realm => own(realm.st)))) invalid();
    if (!realmModule.realmSimSanitize(season)) invalid();
  }
  return JSON.parse(JSON.stringify(clean));
}

/** Domain composition only: no personal saves, credentials, roster, chat or
 * company files enter the snapshot. Call open before makeSeason or makeField. */
export async function openHallowmarchWorldState({ nativeStore, files, dataDir, keepCount, realmModule,
  checkpointIntervalMs = 1000, clock = Date.now } = {}) {
  if (!files || !['read', 'write'].every(method => typeof files[method] === 'function') || !realmModule
    || typeof realmModule.realmSimSanitize !== 'function') invalid();
  const validate = value => checkedWorldSnapshot(value, { keepCount, realmModule });
  const bridge = createProgressiveOwnedState({ store: nativeStore, streamId: 'hallowmarch-world-season-v1', checkpointIntervalMs, clock });
  function strictRead(name, fallback) {
    try { return JSON.parse(fs.readFileSync(path.join(dataDir, name), 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') return fallback; invalid(); }
  }
  const initial = validate(await bridge.start({ seed: () => validate({ worlds: strictRead('worlds.json', {}), season: strictRead('season.json', null) }) }));
  let attached = null, captureFailure = false, closing = false;
  const status = () => ({ ...bridge.status(), enabled: true, mode: 'native', scope: 'world-and-season',
    snapshotOwnershipMigrated: true, realtimeAuthority: 'elected-page-region-keepers', authoritativeCombat: false,
    teamsAndRealmPermissionsMigrated: false, personalSavesIncluded: false, credentialsIncluded: false,
    fenced: captureFailure || ['conflict', 'recovering'].includes(bridge.status().state),
    ...(captureFailure ? { durable: false, error: 'WORLD_SNAPSHOT_REJECTED' } : {}) });
  const canMutate = () => !closing && !status().fenced;
  function assertMutable() { if (!canMutate()) throw new OwnedStateError('WORLD_FENCED', 'World persistence needs recovery before play can continue.'); }
  function capture() {
    if (!attached) invalid();
    try {
      return bridge.capture(validate({ worlds: attached.worlds,
        season: attached.season.RS ? { ...attached.season.RS, savedAt: attached.season.lastStep } : null }));
    } catch (error) { captureFailure = true; throw error; }
  }
  function wrap(target, name) {
    if (typeof target[name] !== 'function') return;
    const original = target[name];
    target[name] = function (...args) {
      assertMutable();
      try { return original.apply(this, args); }
      finally { capture(); }
    };
  }
  const store = { read(name, fallback) {
    if (name === 'worlds.json') return structuredClone(initial.worlds);
    if (name === 'season.json') return structuredClone(initial.season);
    return files.read(name, fallback);
  }, write(name, value) {
    if (name === 'worlds.json' || name === 'season.json') { assertMutable(); capture(); return; }
    files.write(name, value);
  } };
  function attach({ worlds, season, field, rooms }) {
    if (attached || !own(worlds) || !season?.RS || !season.M || !field || !(rooms instanceof Map)) invalid();
    attached = { worlds, season, field, rooms };
    for (const name of ['step', 'contribute', 'order', 'capture']) wrap(season, name);
    for (const name of ['step', 'report', 'left']) wrap(field, name);
    capture();
  }
  async function recover() {
    if (!attached || closing) invalid();
    const { worlds, season, field, rooms } = attached;
    await bridge.recover({ discardUnconfirmed: true, restore: value => {
      const restored = validate(value);
      if (!restored.season) invalid();
      const next = season.M.realmSimSanitize(restored.season);
      if (!next) invalid();
      const now = clock(), away = Math.max(0, Math.min(7 * 86400, ((now - (restored.season.savedAt ?? now)) / 1000) * season.speed));
      if (away > 1) season.M.realmSimStep(next, away);
      validate({ worlds: restored.worlds, season: { ...next, savedAt: now } });
      for (const name of Object.keys(worlds)) delete worlds[name];
      Object.assign(worlds, restored.worlds);
      season.RS = next; season.lastStep = now; season.contrib = {}; season.dirty = true;
      field.held.clear();
      for (const room of rooms.values()) {
        room.rep = []; room.wxSavedAt = 0;
        for (const client of room.clients.values()) { client.toldSeason = false; client.seasonT = 0; }
      }
    } });
    captureFailure = false; capture();
    return status();
  }
  async function shutdown(options) { closing = true; return bridge.shutdown(options); }
  return { store, attach, capture, canMutate, assertMutable, recover, shutdown, status, checkpoint: bridge.checkpoint };
}

/** Read-only bridge discovery; snapshot bodies remain encrypted in the game pod. */
export function hallowmarchWorldDescription(publicOrigin) {
  const url = new URL(publicOrigin);
  if (url.pathname !== '/' || url.username || url.password || url.search || url.hash
    || (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname)))) invalid();
  const id = url.origin + '/gaming/world-state/descriptor', target = url.origin + '/gaming/world-state';
  const text = 'Progressive game-owned world and season snapshots. The main world retains elected page and region keepers; this does not add authoritative combat or migrate team permissions or player data.';
  return { description: { '@context': { hydra: 'http://www.w3.org/ns/hydra/core#', schema: 'https://schema.org/', iep: 'https://markjspivey-xwisee.github.io/interego/ns/iep#' },
    '@id': id, '@type': 'hydra:ApiDocumentation', 'schema:name': 'Hallowmarch world and season persistence',
    'schema:about': { '@id': 'urn:hallowmarch:game' }, 'schema:description': text,
    'hydra:supportedOperation': [{ '@id': id + '/status', '@type': 'hydra:Operation', 'hydra:method': 'GET',
      'hydra:target': { '@id': target }, 'iep:action': { '@id': 'urn:hallowmarch:world:status' } }] },
  graphIri: 'urn:graph:hallowmarch:world-season-persistence', graphContent: [
    '@prefix hydra: <http://www.w3.org/ns/hydra/core#> .', '@prefix schema: <https://schema.org/> .',
    '@prefix iep: <https://markjspivey-xwisee.github.io/interego/ns/iep#> .',
    `<${id}> a hydra:ApiDocumentation, schema:SoftwareApplication ; schema:name "Hallowmarch world and season persistence" ;`,
    `  schema:about <urn:hallowmarch:game> ; schema:description ${JSON.stringify(text)} ; hydra:entrypoint <${target}> ; hydra:supportedOperation <${id}/status> .`,
    `<${id}/status> a hydra:Operation ; iep:action <urn:hallowmarch:world:status> ; hydra:method "GET" ; hydra:target <${target}> .`,
    '<urn:hallowmarch:world:status> a schema:Action ; schema:name "Observe world and season checkpoint status" .',
  ].join('\n') };
}
