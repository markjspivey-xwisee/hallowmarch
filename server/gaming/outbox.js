/** Dispatcher for a durable authoritative game's learning outbox. It owns no queue:
 * getEntries/getConsent read committed state, acknowledge must commit its decision.
 * Crashes between Foxxi acceptance and acknowledgement replay the same statement IDs.
 */
import { createHash } from 'node:crypto';
import { projectGamingEvents, isFoxxiXapiAction } from './learning.js';

const canonical = value => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  return JSON.stringify(value);
};
const digest = value => createHash('sha256').update(canonical(value)).digest('hex');
/** Shared by the durable acknowledge implementation for compare-and-remove. */
export const learningOutboxDigest = entry => digest(entry);
const consentFields = c => c && ({ enabled: c.enabled, expiresAt: c.expiresAt, recipient: c.recipient, actorDid: c.actorDid, sessionId: c.sessionId });
const validConsent = (c, now) => c?.enabled === true && Number.isSafeInteger(c.expiresAt) && c.expiresAt > now &&
  typeof c.recipient === 'string' && /^https:\/\//.test(c.recipient) && !/[{}]/.test(c.recipient) &&
  typeof c.actorDid === 'string' && /^did:[a-z0-9]+:/i.test(c.actorDid) && typeof c.sessionId === 'string' && c.sessionId.length > 0;
const sameConsent = (a, b) => canonical(consentFields(a)) === canonical(consentFields(b));

/**
 * getEntries({limit}) -> committed [{event,consent}] (not an in-memory primary).
 * getConsent({actorId,sessionId,recipient}) -> current ROOT-NATIVE consent:
 *   {enabled,expiresAt:<milliseconds>,recipient,actorDid,sessionId}.
 * sink is an explicitly configured createFoxxiSink instance. Its separate consent
 * callback uses {allowed,expiresAt:<ISO>,subjectDid,...}; caller adapts that shape.
 * acknowledge({eventIds,eventRefs,sourceDigests,status,receipts,reason,binding}) MUST
 * durably compare-and-remove those exact entries and return {durable:true,...receipt}.
 * status=discarded records cancellation/expiry only, never successful learning.
 * The callbacks and signer are configured server-side; clients choose none of them.
 */
export function createLearningOutbox({ sink = null, getEntries, getConsent, acknowledge, domain = 'gaming', gameId = domain,
  now = Date.now, batchSize = 20, maxEntries = 200 } = {}) {
  if (![getEntries, getConsent, acknowledge, now].every(f => typeof f === 'function')) throw new TypeError('durable getEntries, getConsent, acknowledge and a trusted clock are required');
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 20 || !Number.isInteger(maxEntries) || maxEntries < 1 || maxEntries > 10000) throw new TypeError('batchSize must be 1..20 and maxEntries 1..10000');
  // Only scheduling is cached. No events, consents or receipts live here as primary data.
  let flight = null;
  async function dispatch() {
    const report = { ok: true, exported: 0, discarded: 0, retained: 0, batches: 0, saturated: false, outcomes: [] };
    const raw = await getEntries({ limit: maxEntries });
    if (!Array.isArray(raw)) throw new TypeError('getEntries must return a durable outbox array');
    report.saturated = raw.length >= maxEntries;
    const unique = new Map();
    for (const value of raw.slice(0, maxEntries)) {
      // Snapshot before any asynchronous operation, without mutating the source store.
      const entry = structuredClone(value), id = entry?.event?.id;
      if (typeof id !== 'string' || !id || typeof entry.event.actorId !== 'string') throw new TypeError('every outbox entry requires an event id and actor id');
      const previous = unique.get(id);
      if (previous && canonical(previous) !== canonical(entry)) throw new Error('conflicting durable outbox event id');
      unique.set(id, entry);
    }
    const entries = [...unique.values()];
    const configured = isFoxxiXapiAction(sink?.descriptor?.action) && sink.descriptor.method === 'POST' && typeof sink.descriptor.target === 'string' && typeof sink.publish === 'function';
    const groups = new Map();
    for (const entry of entries) {
      const c = entry.consent;
      const key = canonical([entry.event.actorId, consentFields(c)]);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(entry);
    }
    async function commit(batch, status, reason, receipts = []) {
      const first = batch[0], c = first.consent;
      const data = {
        eventIds: batch.map(e => e.event.id),
        eventRefs: batch.map(({ event: e }) => ({ eventId: e.id, streamId: e.streamId, version: e.version, ...(e.index !== undefined ? { index: e.index } : {}) })),
        sourceDigests: batch.map(e => ({ eventId: e.event.id, sha256: digest(e) })),
        status, receipts, reason,
        binding: { actorId: first.event.actorId, sessionId: c?.sessionId || '', recipient: c?.recipient || '', actorDid: c?.actorDid || '' }
      };
      let receipt;
      try { receipt = await acknowledge(data); } catch { /* only a durable receipt permits removal */ }
      if (receipt?.durable !== true) {
        report.ok = false; report.retained += batch.length;
        report.outcomes.push({ status: 'retained', reason: 'acknowledgement-not-durable', eventIds: data.eventIds });
        return;
      }
      report[status] += batch.length;
      report.outcomes.push({ status, reason, eventIds: data.eventIds });
    }
    for (const group of groups.values()) {
      for (let offset = 0; offset < group.length; offset += batchSize) {
        const batch = group.slice(offset, offset + batchSize), first = batch[0], c = first.consent;
        const binding = { actorId: first.event.actorId, sessionId: c?.sessionId || '', recipient: c?.recipient || '' };
        let fresh;
        try { fresh = structuredClone(await getConsent(binding)); }
        catch {
          report.ok = false; report.retained += batch.length;
          report.outcomes.push({ status: 'retained', reason: 'consent-read-failed', eventIds: batch.map(e => e.event.id) });
          continue;
        }
        const checkedAt = now();
        if (!Number.isSafeInteger(checkedAt)) {
          report.ok = false; report.retained += batch.length;
          report.outcomes.push({ status: 'retained', reason: 'trusted-clock-unavailable', eventIds: batch.map(e => e.event.id) });
          continue;
        }
        if (!validConsent(c, checkedAt) || !validConsent(fresh, checkedAt) || batch.some(e => !sameConsent(e.consent, fresh))) {
          await commit(batch, 'discarded', 'consent-missing-revoked-expired-or-changed');
          continue;
        }
        if (!configured || sink.descriptor.target !== c.recipient) {
          report.retained += batch.length;
          report.outcomes.push({ status: 'retained', reason: 'recipient-transport-unconfigured', eventIds: batch.map(e => e.event.id) });
          continue;
        }
        let result, expected;
        try {
          const events = batch.map(e => e.event);
          expected = projectGamingEvents(events, { domain, gameId }).evidence.map(e => e.id).sort();
          report.batches++;
          result = await sink.publish(events, { domain, gameId, ...binding });
        } catch {
          report.ok = false; report.retained += batch.length;
          report.outcomes.push({ status: 'retained', reason: 'learning-delivery-uncertain', eventIds: batch.map(e => e.event.id) });
          continue;
        }
        const receipts = result?.receipts;
        const durable = result?.ok === true && result.exported === batch.length && Array.isArray(receipts) && receipts.length === batch.length &&
          receipts.every(r => r.persisted === true) && canonical(receipts.map(r => r.statementId).sort()) === canonical(expected);
        if (durable) await commit(batch, 'exported', 'foxxi-durable-receipts', receipts);
        else {
          // Consent can change while the sink signs. Re-read on the next flush; do
          // not turn a transient failure or a partial remote write into a success.
          report.ok = false; report.retained += batch.length;
          report.outcomes.push({ status: 'retained', reason: 'learning-durable-receipts-required', eventIds: batch.map(e => e.event.id) });
        }
      }
    }
    return report;
  }
  return {
    flush() {
      if (!flight) flight = dispatch().finally(() => { flight = null; });
      return flight;
    }
  };
}
