import { pathToFileURL } from 'node:url';

const fail = message => { throw Object.assign(new Error(message), { code: 'DEPLOYMENT_CHECKPOINT_UNCONFIRMED' }); };
export function assertConfirmedCheckpoint(status) {
  if (!status || status.enabled !== true || status.mode !== 'native' || status.scope !== 'world-and-season'
    || status.state !== 'confirmed' || status.fenced !== false || status.durable !== true
    || status.pendingSnapshots !== 0 || status.writing !== false || status.backgroundCaptureDeferred === true
    || status.error != null || !Number.isSafeInteger(status.liveVersion) || status.liveVersion < 1
    || status.liveVersion !== status.confirmedLiveVersion
    || !Number.isSafeInteger(status.confirmedVersion) || status.confirmedVersion < 1) {
    fail('Deployment refused: the current world and season do not have a fully confirmed native checkpoint.');
  }
  return { liveVersion: status.liveVersion, confirmedVersion: status.confirmedVersion };
}
export async function checkDeploymentCheckpoint(origin, { fetchImpl = globalThis.fetch, timeoutMs = 8000 } = {}) {
  const base = new URL(origin);
  if (base.username || base.password || base.search || base.hash || base.pathname !== '/'
    || (base.protocol !== 'https:' && !(base.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(base.hostname)))) {
    fail('Deployment preflight requires an HTTPS origin or a local test origin.');
  }
  const signal = AbortSignal.timeout(timeoutMs);
  async function read(path) {
    const response = await fetchImpl(new URL(path, base), { signal, cache: 'no-store', redirect: 'error' });
    if (!response.ok) fail('Deployment refused: the original process is unavailable or unhealthy.');
    return response.json();
  }
  const first = await read('/health');
  if (first.ok !== true || first.players !== 0) fail('Deployment refused: live human play must stop before checking the final checkpoint.');
  const before = assertConfirmedCheckpoint(await read('/gaming/world-state'));
  const last = await read('/health');
  if (last.ok !== true || last.players !== 0) fail('Deployment refused: live human play changed during the final checkpoint check.');
  const after = assertConfirmedCheckpoint(last.worldAuthority);
  if (before.liveVersion !== after.liveVersion || before.confirmedVersion !== after.confirmedVersion) {
    fail('Deployment refused: the native world checkpoint changed during preflight.');
  }
  return { origin: base.origin, ...after };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const origins = process.argv.slice(2);
    if (!origins.length && process.env.HM_PUBLIC_ORIGIN) origins.push(process.env.HM_PUBLIC_ORIGIN);
    if (!origins.length) fail('Provide every currently running game origin; no original process was checked.');
    const checks = [];
    for (const origin of origins) checks.push(await checkDeploymentCheckpoint(origin));
    console.log(JSON.stringify({ ok: true, checks }));
  } catch (error) {
    console.error(error.code === 'DEPLOYMENT_CHECKPOINT_UNCONFIRMED' ? error.message : 'Deployment refused: the checkpoint preflight could not complete.');
    process.exitCode = 1;
  }
}
