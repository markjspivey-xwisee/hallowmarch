/** Service-owned operational observations. No player identifiers, raw game events,
 * chat, credentials or competency claims cross this adapter. An encrypted native
 * outbox is committed before Foxxi receives a signed, own-subject xAPI snapshot.
 */
import { createHash, randomUUID } from 'node:crypto';
import { isFoxxiXapiAction } from './learning.js';

export const FOXXI_MONITOR_DESCRIPTOR = 'https://foxxi-bridge.interego.xwisee.com/affordances';
const NS = 'urn:interego:gaming:';
const canonical = v => Array.isArray(v) ? '[' + v.map(canonical).join(',') + ']' : v && typeof v === 'object' ? '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + canonical(v[k])).join(',') + '}' : JSON.stringify(v);
const hash = v => createHash('sha256').update(typeof v === 'string' ? v : canonical(v)).digest('hex');
const uuid = v => { const h = hash(v).slice(0, 32).split(''); h[12] = '8'; h[16] = ((parseInt(h[16], 16) & 3) | 8).toString(16); const s = h.join(''); return `${s.slice(0,8)}-${s.slice(8,12)}-${s.slice(12,16)}-${s.slice(16,20)}-${s.slice(20)}`; };
const copy = v => structuredClone(v);
const countFields = ['commands', 'refused', 'commits', 'conflicts', 'version', 'playerConnections', 'eventWindow'];
const timeFields = ['maxCommandMs', 'lastCommitMs'];
const eventKinds = ['world.created', 'player.joined', 'movement.applied', 'damage', 'loot.granted', 'companion.spawned', 'companion.granted', 'companion.revoked', 'consent.changed', 'encounter.started', 'entity.recovered', 'knowledge.consulted', 'teaching.delivered', 'resource.gathered'];
function number(v, name, integer = false) { if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > Number.MAX_SAFE_INTEGER || integer && !Number.isSafeInteger(v)) throw new TypeError('Invalid operational measurement: ' + name); return v; }
function descriptor(value) {
  if (!value || !isFoxxiXapiAction(value.action) || value.method !== 'POST') throw new TypeError('Discovered Foxxi own-xAPI descriptor required');
  const target = new URL(value.target), source = new URL(FOXXI_MONITOR_DESCRIPTOR);
  if (target.protocol !== 'https:' || target.origin !== source.origin || target.username || target.password || target.hash || target.search || /[{}]/.test(target.href)) throw new TypeError('Foxxi monitoring target must stay on the discovered HTTPS service');
  return Object.freeze({ action: value.action, method: 'POST', target: target.href, fromDescriptor: FOXXI_MONITOR_DESCRIPTOR });
}
/** Snapshot values are gauges of this server process and a bounded committed-event
 * window. Repeated windows may overlap; they are never summed as unique activity.
 * Whitelisting drops any account/actor/team/realm/body fields from the caller.
 */
export function sanitizeServiceMetrics(metrics) {
  if (!metrics || typeof metrics !== 'object') throw new TypeError('Operational metrics required');
  const processCounters = {}, timings = {}, snapshot = {}, recentEventWindow = { semantics: 'bounded-overlapping-committed-events', byKind: {} };
  for (const k of countFields) if (metrics[k] !== undefined) (['version', 'playerConnections', 'eventWindow'].includes(k) ? snapshot : processCounters)[k] = number(metrics[k], k, true);
  for (const k of timeFields) if (metrics[k] !== undefined) timings[k] = number(metrics[k], k);
  const byKind = metrics.performance?.byKind;
  if (byKind && typeof byKind === 'object') for (const k of eventKinds) if (byKind[k] !== undefined) recentEventWindow.byKind[k] = number(byKind[k], 'event kind', true);
  return { processCounters, timings, snapshot, recentEventWindow };
}

/** Store must be the native gaming store. Test fixtures do not establish physical
 * durability. Network uncertainty and acknowledgement failures retain exact ids.
 */
export function createServiceMonitoring({ store, serviceDid, descriptor: discovered, signRequest, transport, gameId = 'hallowmarch', now = Date.now, runId = randomUUID(), maxPending = 16 } = {}) {
  if (!store || !['load', 'commit'].every(k => typeof store[k] === 'function') || typeof signRequest !== 'function' || typeof transport !== 'function') throw new TypeError('Native store, service signer and transport are required');
  if (!/^did:ethr:0x[a-f0-9]{40}$/i.test(serviceDid || '') || !/^[a-zA-Z0-9._:-]{1,100}$/.test(gameId) || !/^[a-zA-Z0-9._:-]{1,100}$/.test(runId) || !Number.isSafeInteger(maxPending) || maxPending < 1 || maxPending > 20) throw new TypeError('Bounded monitoring service configuration required');
  const target = descriptor(discovered), streamId = 'service-monitoring:' + gameId;
  let queue = Promise.resolve(), last = { enabled: true, state: 'initializing', pending: 0, exported: 0 };
  const serial = fn => { const work = queue.then(fn); queue = work.catch(() => {}); return work; };
  const load = async () => {
    const current = await store.load(streamId);
    if (!Number.isSafeInteger(current.version) || current.version < 0) throw new Error('Invalid monitoring version');
    const state = current.state || { schemaVersion: 1, ownerDid: serviceDid, gameId, pending: [], receipts: [] };
    if (state.schemaVersion !== 1 || state.ownerDid !== serviceDid || state.gameId !== gameId || !Array.isArray(state.pending) || state.pending.length > 20 || !Array.isArray(state.receipts) || state.receipts.length > 64) throw new Error('Invalid monitoring state');
    for (const row of state.pending) {
      const s = row?.statement, e = s?.context?.extensions, m = e?.[NS + 'measurements'];
      if (!s || row.statementId !== s.id || row.digest !== hash(s) || s.actor?.account?.name !== serviceDid || s.actor?.account?.homePage !== NS + 'services' || s.actor?.objectType !== 'Agent'
        || s.verb?.id !== NS + 'verbs/observed-service-snapshot' || s.object?.id !== NS + 'services/' + encodeURIComponent(gameId) || !Number.isFinite(Date.parse(s.timestamp))
        || e?.[NS + 'scope'] !== 'game-service' || e?.[NS + 'humanRecordsExported'] !== false || e?.[NS + 'competencyStatus'] !== 'not-assessed' || !m) throw new Error('Invalid persisted monitoring observation');
      const safe = sanitizeServiceMetrics({ ...m.processCounters, ...m.timings, ...m.snapshot, performance: { byKind: m.recentEventWindow?.byKind } });
      const expected = { id: s.id, actor: { objectType: 'Agent', account: { homePage: NS + 'services', name: serviceDid } },
        verb: { id: NS + 'verbs/observed-service-snapshot', display: { en: 'observed game service snapshot' } },
        object: { objectType: 'Activity', id: NS + 'services/' + encodeURIComponent(gameId), definition: { type: NS + 'OperationalGameService', name: { en: gameId + ' game service' } } },
        timestamp: s.timestamp, context: { extensions: { [NS + 'measurements']: safe, [NS + 'purpose']: e[NS + 'purpose'], [NS + 'processRunId']: e[NS + 'processRunId'], [NS + 'scope']: 'game-service', [NS + 'epistemicStatus']: 'observed-operational-snapshot', [NS + 'competencyStatus']: 'not-assessed', [NS + 'humanRecordsExported']: false } } };
      if (!['operational', 'software-verification'].includes(e[NS + 'purpose']) || !/^[a-zA-Z0-9._:-]{1,100}$/.test(e[NS + 'processRunId']) || canonical(s) !== canonical(expected)) throw new Error('Unexpected persisted monitoring content');
    }
    last = { ...last, pending: state.pending.length, state: state.pending.length ? 'pending' : 'ready' };
    return { version: current.version, state: copy(state) };
  };
  const update = async (operationId, apply) => {
    for (let attempt = 0; attempt < 4; attempt++) {
      const current = await load(), result = apply(current.state);
      if (result === false) return current;
      try {
        const committed = await store.commit(streamId, { expectedVersion: current.version, state: current.state, event: { kind: 'service.monitoring', operationId }, idempotencyKey: operationId + ':' + current.version });
        if (committed.version !== current.version + 1) throw new Error('Monitoring commit was not confirmed');
        last.pending = current.state.pending.length; return committed;
      } catch (error) { if (!['VERSION_CONFLICT', 'version_conflict'].includes(error.code) || attempt === 3) throw error; }
    }
  };
  const ready = serial(async () => { await load(); return true; });
  function record(metrics, { sampleId = randomUUID(), observedAt = new Date(now()).toISOString(), purpose = 'operational' } = {}) {
    if (!['operational', 'software-verification'].includes(purpose)) return Promise.reject(new TypeError('Explicit monitoring observation purpose required'));
    if (!/^[a-zA-Z0-9._:-]{1,128}$/.test(sampleId) || !Number.isFinite(Date.parse(observedAt)) || Math.abs(Date.parse(observedAt) - now()) > 300000) return Promise.reject(new TypeError('Fresh observed sample identity required'));
    const measurements = sanitizeServiceMetrics(metrics);
    const statement = { id: uuid([serviceDid, gameId, sampleId]), actor: { objectType: 'Agent', account: { homePage: NS + 'services', name: serviceDid } },
      verb: { id: NS + 'verbs/observed-service-snapshot', display: { en: 'observed game service snapshot' } },
      object: { objectType: 'Activity', id: NS + 'services/' + encodeURIComponent(gameId), definition: { type: NS + 'OperationalGameService', name: { en: gameId + ' game service' } } },
      timestamp: observedAt, context: { extensions: { [NS + 'measurements']: measurements, [NS + 'purpose']: purpose, [NS + 'processRunId']: runId, [NS + 'scope']: 'game-service', [NS + 'epistemicStatus']: 'observed-operational-snapshot', [NS + 'competencyStatus']: 'not-assessed', [NS + 'humanRecordsExported']: false } } };
    const digest = hash(statement);
    return serial(async () => {
      await update('record:' + sampleId, state => {
        const existing = [...state.pending, ...state.receipts].find(x => x.statementId === statement.id);
        if (existing) { if (existing.digest !== digest) throw new Error('Monitoring sample identity conflict'); return false; }
        if (state.pending.length >= maxPending) throw Object.assign(new Error('Native monitoring outbox is full'), { code: 'MONITORING_CAPACITY' });
        state.pending.push({ statementId: statement.id, digest, statement });
      });
      return { ok: true, durable: true, statementId: statement.id };
    });
  }
  function flush() { return serial(async () => {
    const { state } = await load(), batch = state.pending.slice(0, 20);
    if (!batch.length) return { ok: true, durable: true, exported: 0, receipts: [] };
    const statements = batch.map(x => x.statement), envelope = await signRequest({ statements });
    let signed; try { signed = JSON.parse(envelope?._signed_payload); } catch { throw new Error('Invalid service signature envelope'); }
    if (typeof envelope?._signature !== 'string' || signed.agent_id !== serviceDid || canonical(signed.statements) !== canonical(statements)) throw new Error('Service signature identity or statement mismatch');
    let response; try { response = await transport({ url: target.target, method: 'POST', body: envelope }); } catch { last.state = 'delivery-uncertain'; return { ok: false, reason: 'foxxi-transport-uncertain', exported: 0 }; }
    const body = response?.body, expected = batch.map(x => x.statementId).sort();
    const exact = values => Array.isArray(values) && canonical([...values].sort()) === canonical(expected);
    if (response?.status !== 200 || body?.ok !== true || body.durable !== true || body.lrsAccepted !== true || !exact(body.statementIds) || !Array.isArray(body.receipts) || !exact(body.receipts.map(x => x.statementId)) || !body.receipts.every(x => x.persisted === true)) {
      last.state = 'delivery-unconfirmed'; return { ok: false, reason: 'foxxi-durable-ack-required', exported: 0 };
    }
    await update('ack:' + hash(expected), current => {
      const ids = new Set(expected), pending = current.pending.filter(x => ids.has(x.statementId));
      if (!pending.length) return false;
      if (pending.some(x => batch.find(b => b.statementId === x.statementId)?.digest !== x.digest)) throw new Error('Monitoring acknowledgement changed');
      current.pending = current.pending.filter(x => !ids.has(x.statementId));
      current.receipts.push(...pending.map(x => ({ statementId: x.statementId, digest: x.digest, persisted: true, recipient: target.target })));
      current.receipts = current.receipts.slice(-64);
    });
    last = { ...last, state: 'ready', exported: last.exported + batch.length, lastStatementIds: expected, lastConfirmedAt: new Date(now()).toISOString() };
    return { ok: true, durable: true, exported: batch.length, receipts: body.receipts };
  }); }
  return { ready, record, flush, status: () => copy({ ...last, serviceDid, recipient: target.target, humanLearning: 'disabled-until-verified-binding-and-consent' }) };
}

/** Resolve the exact live advertised own-xAPI operation. The current Foxxi root
 * serves Turtle; accept only its concrete, bounded operation block and same-host
 * HTTPS target. This is capability discovery, never suffix-derived routing.
 */
export async function discoverFoxxiMonitoringDescriptor(fetch = globalThis.fetch) {
  const response = await fetch(FOXXI_MONITOR_DESCRIPTOR, { headers: { accept: 'text/turtle' }, redirect: 'error', signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new Error('Foxxi descriptor unavailable');
  const text = await response.text(); if (Buffer.byteLength(text) > 3 * 1024 * 1024) throw new Error('Foxxi descriptor exceeds capacity');
  for (const action of ['https://relay.interego.xwisee.com/ns/iep/action/foxxi/write-xapi-statements-signed', 'urn:iep:action:foxxi:write-xapi-statements-signed']) {
    const marker = '<' + action + '> a ', start = text.indexOf(marker); if (start === -1) continue;
    const end = text.indexOf('\n\n<', start + marker.length), block = text.slice(start, end === -1 ? undefined : end);
    const method = /hydra:method\s+"([^"]+)"/.exec(block)?.[1], target = /hydra:target\s+<([^>]+)>/.exec(block)?.[1];
    return descriptor({ action, method, target });
  }
  throw new Error('Foxxi own-xAPI operation was not advertised');
}

/** Uses only this service's separately provisioned wallet. No human/relay/operator
 * credential fallback and no learner enrollment or personal learning export.
 */
export async function configuredServiceMonitoring({ store, env = process.env, core, fetch = globalThis.fetch, now = Date.now } = {}) {
  if (env.HM_GAMING_MONITOR_ENABLED !== '1') return null;
  const configuredDid = env.HM_GAMING_MONITOR_DID, privateKey = env.HM_GAMING_MONITOR_PRIVATE_KEY, pod = new URL(env.HM_GAMING_MONITOR_POD_URL);
  if (!/^did:ethr:0x[a-f0-9]{40}$/i.test(configuredDid || '') || !/^(0x)?[a-f0-9]{64}$/i.test(privateKey || '') || pod.protocol !== 'https:' || !pod.pathname.endsWith('/') || pod.search || pod.hash || pod.username || pod.password) throw new Error('Dedicated service monitoring identity required');
  const sdk = core || await import('@interego/core'), wallet = sdk.importWallet(privateKey.startsWith('0x') ? privateKey : '0x' + privateKey, 'agent', 'Hallowmarch operational monitoring');
  if (configuredDid.toLowerCase() !== 'did:ethr:' + wallet.address.toLowerCase()) throw new Error('Monitoring wallet does not match service DID');
  const serviceDid = 'did:ethr:' + wallet.address;
  const discovered = await discoverFoxxiMonitoringDescriptor(fetch);
  const signRequest = async args => {
    const _signed_payload = JSON.stringify({ ...args, agent_id: serviceDid, subject_pod_url: pod.href, timestamp: new Date(now()).toISOString() });
    return { _signed_payload, _signature: await sdk.signMessageRaw(wallet, 'sha256:' + hash(_signed_payload)) };
  };
  const monitoring = createServiceMonitoring({ store, serviceDid, descriptor: discovered, signRequest, now, transport: async ({ url, method, body }) => {
    const response = await fetch(url, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), redirect: 'error', signal: AbortSignal.timeout(90000) });
    return { status: response.status, body: await response.json() };
  } });
  await monitoring.ready; return monitoring;
}
