/** Explicit read-only startup probe. No identity ceremony, private records,
 * screenshots, trace, HAR, storage inspection or raw browser error output. */
if (process.env.HM_NATIVE_STARTUP_DIAGNOSTIC !== '1') {
  console.log('SKIP: startup diagnostic requires HM_NATIVE_STARTUP_DIAGNOSTIC=1.');
  process.exit(0);
}

let gameOrigin, run, modulePath, executable;
try {
  const origin = new URL(process.env.HM_NATIVE_ORIGIN);
  if (origin.protocol !== 'https:' || origin.origin !== process.env.HM_NATIVE_ORIGIN) throw Error();
  gameOrigin = origin.origin; run = process.env.HM_NATIVE_STARTUP_RUN;
  if (!/^[0-9]{17}-[a-f0-9]{8}$/.test(run || '')) throw Error();
  modulePath = process.env.HM_PLAYWRIGHT_MODULE; executable = process.env.HM_CHROMIUM_EXECUTABLE;
  if (!modulePath?.startsWith('/') || !executable?.startsWith('/') || process.env.DEBUG || process.env.PWDEBUG
    || process.env.PW_TEST_TRACE || process.env.NODE_DEBUG) throw Error();
} catch {
  console.error('FAIL: startup diagnostic [configuration]. Explicit HTTPS origin, public run and pinned local browser paths are required.');
  process.exit(2);
}

const { pathToFileURL } = await import('node:url');
const { readFile } = await import('node:fs/promises');
const { nativeBrowserNetwork } = await import('./native-browser-network.mjs');
const errorCounts = { SyntaxError: 0, ReferenceError: 0, TypeError: 0, RangeError: 0, SecurityError: 0, Other: 0 };
const errorCategories = { moduleImport: 0, duplicateIdentifier: 0, temporalInitialization: 0, graphics: 0, other: 0 };
const consoleErrorCategories = { csp: 0, certificate: 0, network: 0, module: 0, other: 0 };
const capped = value => Math.min(4096, value + 1);
const assets = {
  document: { path: '/', requested: 0, finished: 0, failed: 0, pending: 0, http2xx: 0, http3xx: 0, http4xx: 0, http5xx: 0 },
  three: { path: '/npm/three@0.160.0/build/three.module.min.js', requested: 0, finished: 0, failed: 0, pending: 0, http2xx: 0, http3xx: 0, http4xx: 0, http5xx: 0 },
  fontCss: { path: '/css2', requested: 0, finished: 0, failed: 0, pending: 0, http2xx: 0, http3xx: 0, http4xx: 0, http5xx: 0 },
  fontFile: { path: '(public-font-file)', requested: 0, finished: 0, failed: 0, pending: 0, http2xx: 0, http3xx: 0, http4xx: 0, http5xx: 0 },
};
const classifyAsset = request => {
  try {
    const url = new URL(request.url());
    if (url.origin === gameOrigin && url.pathname === '/' && request.resourceType() === 'document') return 'document';
    if (url.origin === 'https://cdn.jsdelivr.net' && url.pathname === assets.three.path && !url.search) return 'three';
    if (url.origin === 'https://fonts.googleapis.com' && url.pathname === '/css2') return 'fontCss';
    if (url.origin === 'https://fonts.gstatic.com' && request.resourceType() === 'font') return 'fontFile';
  } catch { /* Unknown/private URLs are never retained or printed. */ }
  return null;
};
const requests = new WeakMap();
function snapshot() {
  const H = globalThis.__hm, startup = globalThis.__hmStartup, n = H?.net?.NETWS;
  const phases = new Set(['Creating graphics context', 'Graphics context creation failed', 'Preparing graphics data',
    'Raising the hills', 'Shaping the land', 'Planting the forests', 'Raising the keeps', 'Digging the barrow',
    'Sowing the meadows', 'Raising the mountains', 'Mustering the realms', 'Reading the chronicle', 'Sizing graphics targets',
    'Compiling world shaders', 'Drawing the map', 'Lighting the sky', 'Drawing the first view', 'Ready']);
  const loadMessage = document.getElementById('loadmsg')?.textContent || '';
  const width = document.getElementById('loadbar')?.style.width || '';
  const amount = /^[0-9]+(?:\.[0-9]+)?%$/.test(width) ? Number(width.slice(0, -1)) : null;
  const visible = id => { const el = document.getElementById(id); return !!el && !el.hidden && el.style.display !== 'none'; };
  const count = value => Number.isSafeInteger(value) && value >= 0 && value <= 4096 ? value : null;
  return {
    documentReadyState: ['loading', 'interactive', 'complete'].includes(document.readyState) ? document.readyState : null,
    inlineModulePresent: !!document.querySelector('script[type="module"]'), hmPresent: !!H, startupPresent: !!startup,
    netHookPresent: !!H?.net, nativeStatusHookPresent: typeof H?.nativePlayerStatus === 'function',
    phase: phases.has(startup?.phase) ? startup.phase : startup ? 'other' : null,
    loadMessageClass: phases.has(loadMessage) ? loadMessage : !loadMessage ? 'empty'
      : loadMessage === 'Something went wrong while building the world. Reloading may help.' ? 'world-build-failed' : 'other',
    loadPercent: amount !== null && amount >= 0 && amount <= 100 ? amount : null,
    loadingVisible: visible('loading'), titleVisible: visible('title'), noGlVisible: visible('nogl'),
    built: H?.GAME?.built === true, ready: H?.ready === true, gameReady: H?.GAME?.ready === true,
    saveLoadingPhase: ['identity', 'read', 'confirmed', 'blocked'].includes(H?.SAVE?.loading?.phase) ? H.SAVE.loading.phase : null,
    networkState: ['off', 'opening', 'on', 'alone', 'connecting'].includes(n?.state) ? n.state : null,
    graphicsRecovery: startup?.recovery === true, graphicsStopped: startup?.stopped === true,
    graphicsLost: count(startup?.lost), graphicsRestored: count(startup?.restored),
    gameErrorCount: Array.isArray(H?.errors) ? Math.min(20, H.errors.length) : null,
  };
}
let browser, context, page, deadlineTimer, snapshotFlight = null, stage = 'browser-configuration', timedOut = false;
const started = Date.now(), deadline = started + 180000;
const boundedSnapshot = async () => {
  if (!page || page.isClosed()) return { unavailable: true };
  if (snapshotFlight) return { inFlight: true };
  const task = page.evaluate(snapshot).catch(() => ({ unavailable: true })); snapshotFlight = task;
  void task.finally(() => { if (snapshotFlight === task) snapshotFlight = null; });
  let timer;
  try { return await Promise.race([task, new Promise(resolve => { timer = setTimeout(() => resolve({ inFlight: true }), 2000); })]); }
  finally { clearTimeout(timer); }
};
const report = async kind => {
  const state = await boundedSnapshot();
  console.log(JSON.stringify({ kind, elapsedMs: Math.min(180000, Math.max(0, Date.now() - started)), stage, timedOut, state, errorCounts, errorCategories, consoleErrorCategories, assets }));
  return state;
};
try {
  const entry = pathToFileURL(modulePath), pkg = JSON.parse(await readFile(new URL('./package.json', entry), 'utf8'));
  if (pkg.name !== 'playwright' || pkg.version !== '1.55.0') throw Object.assign(Error(), { code: 'browser_pin' });
  const { chromium } = await import(entry.href), network = await nativeBrowserNetwork();
  stage = 'launch-browser';
  browser = await chromium.launch({ headless: true, executablePath: executable, timeout: 30000,
    ...(network.proxy ? { proxy: network.proxy } : {}),
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', ...network.args] });
  deadlineTimer = setTimeout(() => { timedOut = true; void browser.close().catch(() => {}); }, Math.max(1, deadline - Date.now()));
  context = await browser.newContext({ viewport: { width: 1024, height: 768 }, acceptDownloads: false });
  page = await context.newPage();
  page.on('console', message => {
    if (message.type() !== 'error') return;
    const text = message.text();
    const category = /Content Security Policy|violates.*directive|Refused to load.*script/i.test(text) ? 'csp'
      : /ERR_CERT_|certificate|CERT_AUTHORITY/i.test(text) ? 'certificate'
      : /module script|MIME type.*module|import.*module/i.test(text) ? 'module'
      : /net::ERR_|Failed to load resource|ERR_CONNECTION/i.test(text) ? 'network' : 'other';
    consoleErrorCategories[category] = capped(consoleErrorCategories[category]);
  });
  page.on('pageerror', error => {
    const name = Object.hasOwn(errorCounts, error?.name) ? error.name : 'Other'; errorCounts[name] = capped(errorCounts[name]);
    const text = typeof error?.message === 'string' ? error.message : '';
    const category = /Failed to fetch.*module|Importing a module script|module script.*failed/i.test(text) ? 'moduleImport'
      : /has already been declared/i.test(text) ? 'duplicateIdentifier'
      : /before initialization/i.test(text) ? 'temporalInitialization'
      : /WebGL|graphics context|context.*lost/i.test(text) ? 'graphics' : 'other';
    errorCategories[category] = capped(errorCategories[category]);
  });
  page.on('request', request => { const key = classifyAsset(request); if (key) { requests.set(request, key); assets[key].requested = capped(assets[key].requested); assets[key].pending = capped(assets[key].pending); } });
  page.on('response', response => { const key = requests.get(response.request()); const status = response.status();
    if (key && status >= 200 && status <= 599) { const field = 'http' + Math.floor(status / 100) + 'xx'; assets[key][field] = capped(assets[key][field]); } });
  for (const [event, field] of [['requestfinished', 'finished'], ['requestfailed', 'failed']]) page.on(event, request => {
    const key = requests.get(request); if (key) { assets[key][field] = capped(assets[key][field]); assets[key].pending = Math.max(0, assets[key].pending - 1); }
  });
  console.log(JSON.stringify({ kind: 'native_startup_diagnostic_start', run, shard: 'native-qa-' + run.slice(-8), limitMs: 180000 }));
  stage = 'navigation';
  try { await page.goto(gameOrigin + '/?safe=1&shard=native-qa-' + run.slice(-8), { waitUntil: 'domcontentloaded', timeout: Math.min(45000, Math.max(1, deadline - Date.now())) }); }
  catch { stage = timedOut ? 'deadline' : 'navigation-unconfirmed'; }
  let state = await report('native_startup_diagnostic_early');
  while (!timedOut && Date.now() < deadline && !(state.ready && state.networkState === 'on')) {
    // A confirmed JavaScript parse/runtime failure cannot become a working
    // initial module by waiting or reloading. Retain its fixed diagnosis now.
    if (!state.hmPresent && (errorCounts.SyntaxError || errorCounts.ReferenceError || errorCounts.TypeError
      || assets.three.failed || assets.three.http4xx || assets.three.http5xx)) break;
    if (state.graphicsStopped || state.noGlVisible || state.loadMessageClass === 'world-build-failed') break;
    stage = 'startup-observation';
    await new Promise(resolve => setTimeout(resolve, Math.min(15000, Math.max(1, deadline - Date.now()))));
    state = await report('native_startup_diagnostic_progress');
  }
  stage = timedOut || Date.now() >= deadline ? 'deadline' : state.ready ? 'ready' : 'startup-blocked';
  await report('native_startup_diagnostic_final');
  process.exitCode = state.ready && state.networkState === 'on' ? 0 : 1;
} catch (error) {
  const code = ['browser_pin', 'invalid_browser_network_config'].includes(error?.code) ? error.code
    : error?.name === 'TimeoutError' ? 'browser_timeout' : 'startup_probe_failed';
  console.error(JSON.stringify({ kind: 'native_startup_diagnostic_failure', stage, code }));
  if (page) await report('native_startup_diagnostic_final'); process.exitCode = 1;
} finally {
  clearTimeout(deadlineTimer);
  let closeTimer;
  try { if (browser) await Promise.race([browser.close(), new Promise(resolve => { closeTimer = setTimeout(resolve, 5000); })]); }
  catch { /* No browser error details leave this read-only probe. */ }
  finally { clearTimeout(closeTimer); }
}
process.exit(process.exitCode || 0);
