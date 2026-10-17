/** Explicit opt-in input controller for ONE already authorized public gameplay
 * grant. No import-time I/O, identity creation, owner bearer, or renderer hooks. */
import { createWorldAgentClient } from '../../client/world-agent-client.mjs';
import { createNativeCompanionSigningBroker } from './native-companion-signing.mjs';
import { createInterface } from 'node:readline';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { nativeBrowserNetwork } from './native-browser-network.mjs';

const fail = code => { throw Object.assign(new Error('Authorized SDK controller stopped.'), { code }); };
const plain = v => v && typeof v === 'object' && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;
const FIELDS = ['enabled', 'origin', 'applicationId', 'agentDid', 'agentPodUrl', 'grantId', 'roomId', 'entityId', 'dx', 'dz'];
function configuration(input) {
  if (!plain(input) || Object.keys(input).length !== FIELDS.length || FIELDS.some(k => !Object.hasOwn(input, k))
    || input.enabled !== true) fail('controller_explicit_scope_required');
  if (FIELDS.filter(k => !['enabled', 'dx', 'dz'].includes(k)).some(k => typeof input[k] !== 'string' || !input[k] || input[k].length > 2048)
    || !/^did:[a-z0-9]+:[^\s]{1,500}$/.test(input.applicationId)
    || !/^did:web:[^\s]+:agents:[^\s]+$/.test(input.agentDid)
    || !/^urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(input.grantId)
    || ![input.dx, input.dz].every(v => Number.isFinite(v) && Math.abs(v) <= 1)
    || Math.hypot(input.dx, input.dz) < 0.01 || Math.hypot(input.dx, input.dz) > 1) fail('controller_invalid_public_scope');
  let origin, pod;
  try { origin = new URL(input.origin); pod = new URL(input.agentPodUrl); } catch { fail('controller_invalid_public_scope'); }
  if (origin.protocol !== 'https:' || origin.origin !== input.origin || pod.protocol !== 'https:' || pod.href !== input.agentPodUrl
    || !pod.pathname.endsWith('/') || pod.username || pod.password || pod.search || pod.hash
    || [input.roomId, input.entityId].some(v => v.length > 128 || /[\s\u0000-\u001f\u007f]/.test(v))) fail('controller_invalid_public_scope');
  return Object.freeze({ ...input });
}
const errorCodes = new Set(['controller_explicit_scope_required', 'controller_invalid_public_scope', 'controller_rate_or_actions_refused',
  'controller_closed', 'controller_one_run_only', 'controller_invalid_clock', 'controller_invalid_pose', 'controller_unconfirmed_input',
  'agent_operation_unconfirmed', 'agent_request_refused', 'agent_connection_required', 'agent_operation_expired', 'agent_client_closed',
  'invalid_agent_response', 'invalid_agent_admission', 'invalid_agent_execution_ack', 'invalid_agent_observation',
  'native_envelope_binding_rejected', 'qa_companion_signature_timeout', 'qa_companion_signature_binding',
  'qa_companion_signature_envelope', 'qa_companion_signing_closed']);

export function createWorldAgentSdkController({ config, writePublic = () => {}, now = Date.now,
  createClient = createWorldAgentClient, createBroker = createNativeCompanionSigningBroker,
  fetch = globalThis.fetch,
  wait = ms => new Promise(resolve => setTimeout(resolve, ms)) } = {}) {
  const scope = configuration(config);
  if (![writePublic, now, createClient, createBroker, wait].every(v => typeof v === 'function')) throw new TypeError('Controller ports required');
  let closed = false, attempted = false, acknowledged = 0, before = null, after = null, phase = 'prepared';
  const broker = createBroker({ enabled: true, agentDid: scope.agentDid, agentPodUrl: scope.agentPodUrl, now,
    writePublicRequest(value) { if (!closed) writePublic(value); } });
  const client = createClient({ origin: scope.origin, applicationId: scope.applicationId, agentDid: scope.agentDid, now, fetch,
    sign_request: ({ payload }, { expiresAt }) => broker.signNativeRequest({ payload, expiresAt }) });
  const clock = () => { const value = now(); if (!Number.isSafeInteger(value) || value < 0) fail('controller_invalid_clock'); return value; };
  const open = () => { if (closed) fail('controller_closed'); };
  const emit = extra => writePublic({ kind: 'world_agent_sdk_controller', phase, acknowledgedCommands: acknowledged, ...extra });
  const pose = observation => {
    const body = observation?.state?.body;
    if (observation?.authority !== 'owner-page-observation' || observation.roomId !== scope.roomId || observation.entityId !== scope.entityId
      || body?.id !== scope.entityId || ![body.x, body.y, body.z].every(v => Number.isFinite(v) && Math.abs(v) <= 4000)) fail('controller_invalid_pose');
    return Object.freeze({ x: body.x, y: body.y, z: body.z });
  };
  async function pause(ms) {
    const until = clock() + ms;
    while (clock() < until) { const previous = clock(); await wait(Math.min(100, until - previous)); open();
      if (clock() < previous) fail('controller_invalid_clock'); }
  }
  const stop = () => { closed = true; client.close(); broker.close(); };
  async function run() {
    open(); if (attempted) fail('controller_one_run_only'); attempted = true;
    try {
      phase = 'admitting'; emit({ requestedCommands: 8, inputDurationMs: 500, minimumPaceMs: 400 });
      await client.connect({ grantId: scope.grantId, roomId: scope.roomId, entityId: scope.entityId }); open();
      const admitted = client.status();
      if (admitted.connected !== true || !admitted.scope?.actions?.includes('observe') || !admitted.scope.actions.includes('move')
        || admitted.scope.maxCommandsPerSecond < 3) fail('controller_rate_or_actions_refused');
      before = pose(await client.observe()); open(); phase = 'before'; emit({ pose: before });
      // Separating the initial observation from input by 400ms keeps this
      // controller at <=3 signed gameplay calls per second for a 3/s grant.
      for (let index = 0; index < 8; index++) {
        await pause(400);
        // A fresh SDK call creates a distinct logical command ID. This is NOT
        // recovery or replay of the original runner's uncertain command.
        const ack = await client.move({ dx: scope.dx, dz: scope.dz, durationMs: 500 }); open();
        if (ack?.accepted !== true || ack.execution !== 'owner-page-input-applied') fail('controller_unconfirmed_input');
        acknowledged++; phase = 'input-applied'; emit({ execution: 'owner-page-input-applied' });
      }
      // Ordinary elapsed time only. No game clock, physics, frame or pose is
      // overridden; the final observation may still show zero displacement.
      await pause(750); after = pose(await client.observe()); open(); phase = 'complete';
      const displacement = Math.hypot(after.x - before.x, after.z - before.z);
      const report = { before, after, horizontalDisplacement: displacement, execution: 'owner-page-input-applied', verifiedCombatOutcome: false };
      emit(report); return Object.freeze({ acknowledgedCommands: acknowledged, ...report });
    } catch (error) {
      phase = 'stopped'; emit({ code: errorCodes.has(error?.code) ? error.code : 'controller_operation_failed',
        uncertain: error?.uncertain === true, outcome: error?.uncertain === true ? 'unknown' : 'not-established' });
      throw Object.assign(new Error('Authorized SDK controller stopped.'), {
        code: errorCodes.has(error?.code) ? error.code : 'controller_operation_failed', uncertain: error?.uncertain === true });
    } finally { stop(); }
  }
  return Object.freeze({ run, acceptLine: line => !closed && broker.acceptLine(line), close: stop,
    status: () => ({ phase, attempted, closed, acknowledgedCommands: acknowledged }) });
}

/** A caller-owned BLANK browser context supplies the already reviewed executor
 * proxy/CA path; no game boot, owner cookies, credential cache or rendering. */
export function worldAgentControllerBrowserFetch({ page, origin } = {}) {
  if (typeof page?.evaluate !== 'function') throw new TypeError('A blank trusted browser page is required');
  return async (url, options) => {
    const target = new URL(url);
    const action = /^\/world\/native-agent\/(challenge|complete|renew|command|observe)$/.test(target.pathname);
    if (target.origin !== origin || target.protocol !== 'https:' || target.search || target.hash || target.username || target.password
      || !(options.method === 'GET' && ['/gaming/manifest', '/world/native-agents'].includes(target.pathname)
        || options.method === 'POST' && action) || Object.keys(options.headers || {}).some(k => !['accept', 'content-type'].includes(k.toLowerCase()))
      || typeof options.body === 'string' && Buffer.byteLength(options.body) > 32768) fail('controller_invalid_public_scope');
    const aborted = () => Object.assign(new Error('Authorized controller transport stopped.'), { code: 'agent_operation_unconfirmed', uncertain: true });
    if (options.signal?.aborted) throw aborted();
    let onAbort;
    const cancelled = new Promise((_, reject) => {
      onAbort = () => reject(aborted()); options.signal?.addEventListener('abort', onAbort, { once: true });
    });
    let result;
    try { result = await Promise.race([page.evaluate(async ({ url, method, body }) => {
      const response = await fetch(url, { method, credentials: 'omit', redirect: 'error', cache: 'no-store', referrerPolicy: 'no-referrer',
        headers: { Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body } : {}),
        signal: AbortSignal.timeout(35000) });
      const reader = response.body?.getReader(); if (!reader) throw new Error('bounded-response-required');
      const parts = []; let size = 0;
      try { for (;;) { const next = await reader.read(); if (next.done) break; size += next.value.byteLength;
        if (size > 65536) { await reader.cancel(); throw new Error('bounded-response-required'); } parts.push(next.value); } }
      finally { reader.releaseLock(); }
      const bytes = new Uint8Array(size); let offset = 0; for (const part of parts) { bytes.set(part, offset); offset += part.byteLength; }
      return { status: response.status, type: response.headers.get('content-type'), body: new TextDecoder('utf-8', { fatal: true }).decode(bytes) };
    }, { url, method: options.method, ...(options.body ? { body: options.body } : {}) }), cancelled]);
    } finally { options.signal?.removeEventListener('abort', onAbort); }
    return new Response(result.body, { status: result.status, headers: { 'content-type': result.type || '' } });
  };
}

/** CLI only: two explicit flags, one bounded public config file, one stdin
 * signing reply protocol. Never evaluate input or read ambient credentials. */
export async function runWorldAgentSdkControllerCli({ args, input, output, env = process.env } = {}) {
  if (!Array.isArray(args) || args.length !== 3 || args[0] !== '--authorized-existing-grant' || args[1] !== '--public-config'
    || typeof args[2] !== 'string' || !input || typeof output?.write !== 'function') fail('controller_explicit_scope_required');
  const bytes = await readFile(args[2]); if (bytes.byteLength > 8192) fail('controller_invalid_public_scope');
  let config; try { config = JSON.parse(bytes.toString('utf8')); } catch { fail('controller_invalid_public_scope'); }
  const scope = configuration(config);
  if (typeof env.HM_PLAYWRIGHT_MODULE !== 'string' || !env.HM_PLAYWRIGHT_MODULE) fail('controller_explicit_scope_required');
  const { chromium } = await import(pathToFileURL(env.HM_PLAYWRIGHT_MODULE));
  const network = await nativeBrowserNetwork(env);
  const browser = await chromium.launch({ headless: true, args: network.args, ...(network.proxy ? { proxy: network.proxy } : {}),
    ...(env.HM_CHROMIUM_EXECUTABLE ? { executablePath: env.HM_CHROMIUM_EXECUTABLE } : {}) });
  let controller, reader;
  try {
    const context = await browser.newContext({ acceptDownloads: false });
    const page = await context.newPage();
    // Establish only the actual HTTPS origin. The document is empty, not a game
    // renderer, and this brand-new context has no human session or credential.
    await page.route(scope.origin + '/', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Authorized agent input controller</title>' }));
    await page.goto(scope.origin + '/');
    controller = createWorldAgentSdkController({ config: scope,
      fetch: worldAgentControllerBrowserFetch({ page, origin: scope.origin }), writePublic: value => output.write(JSON.stringify(value) + '\n') });
    reader = createInterface({ input, terminal: false });
    reader.on('line', line => { if (line === 'finish') { controller.close(); return; }
      if (typeof line === 'string' && Buffer.byteLength(line) <= 32768) controller.acceptLine(line); });
    reader.once('close', () => controller.close());
    return await controller.run();
  } finally { reader?.close(); controller?.close(); await browser.close(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runWorldAgentSdkControllerCli({ args: process.argv.slice(2), input: process.stdin, output: process.stdout }).catch(() => {
    process.exitCode = 1; // The bounded controller report already describes failure.
  });
}
