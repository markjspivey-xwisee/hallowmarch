/** Secret-free, append-only manual QA episode fence. No import-time I/O.
 * A process restart never reuses this file or manufactures a replacement owner.
 * Native credentials and recovery material remain solely in the runner's RAM. */
import { open } from 'node:fs/promises';
import { dirname, isAbsolute } from 'node:path';

const SCHEMA = 'hallowmarch.manual-qa-episode/v1';
const KINDS = ['main-world-complete', 'coaching-delivery-intent', 'coaching-followup-intent', 'coaching-complete',
  'activity-delivery-intent', 'activity-input-intent', 'activity-complete'];
const fail = code => { throw Object.assign(new Error('The manual QA episode fence is unavailable.'), { code }); };
const origin = value => { try { const u = new URL(value); return u.protocol === 'https:' && u.origin === value; } catch { return false; } };
export function validateNativeQaEpisodeFile(value) {
  if (typeof value !== 'string' || !isAbsolute(value) || value.length > 4096 || /[\u0000-\u001f\u007f]/.test(value)) fail('qa_episode_configuration');
  return value;
}
export async function createNativeQaEpisode({ file, run, gameOrigin, relayOrigin } = {}) {
  validateNativeQaEpisodeFile(file);
  if (typeof run !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(run) || !origin(gameOrigin) || !origin(relayOrigin) || gameOrigin === relayOrigin) fail('qa_episode_configuration');
  let handle;
  // Exclusive creation deliberately refuses *every* existing episode, including
  // an unreadable file or an unknown delivery intent. Never inspect-and-reset.
  try { handle = await open(file, 'wx', 0o600); }
  catch { fail('qa_episode_exists_or_unreadable'); }
  const stages = new Set(); let closed = false, failed = false, chain = Promise.resolve();
  const append = async value => {
    if (closed || failed) fail('qa_episode_unavailable');
    try { await handle.writeFile(JSON.stringify(value) + '\n', 'utf8'); await handle.sync(); }
    catch { failed = true; fail('qa_episode_unavailable'); }
  };
  try {
    await append({ schema: SCHEMA, run, gameOrigin, relayOrigin, kind: 'fixture-reserved', at: new Date().toISOString() });
    const directory = await open(dirname(file), 'r');
    try { await directory.sync(); } finally { await directory.close(); }
  } catch { failed = true; await handle.close().catch(() => {}); fail('qa_episode_unavailable'); }
  return Object.freeze({
    status: () => ({ kind: 'native_qa_episode', reserved: true, failed, closed, stages: [...stages] }),
    mark(kind) {
      const task = chain.then(async () => {
        if (!KINDS.includes(kind) || stages.has(kind) || closed || failed) fail('qa_episode_stage_refused');
        if (kind !== 'main-world-complete' && !stages.has('main-world-complete')
          || kind === 'coaching-followup-intent' && !stages.has('coaching-delivery-intent')
          || kind === 'coaching-complete' && !stages.has('coaching-delivery-intent')
          || kind.startsWith('activity-') && !stages.has('coaching-complete')
          || kind === 'activity-input-intent' && !stages.has('activity-delivery-intent')
          || kind === 'activity-complete' && !stages.has('activity-input-intent')
          || stages.has('coaching-complete') && !kind.startsWith('activity-')
          || stages.has('activity-complete')) fail('qa_episode_stage_refused');
        await append({ kind, at: new Date().toISOString() }); stages.add(kind);
        return { confirmed: true, kind };
      }); chain = task.catch(() => {}); return task;
    },
    async close() { await chain; if (!closed) { closed = true; await handle.close().catch(() => {}); } },
  });
}
