import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from '../node_modules/playwright/index.mjs';

const TARGET = Object.freeze({
  origin: 'https://march-native-preview-production.up.railway.app',
  expectedRuntimeCommit: 'fc17a60a061827ecf91cf242b09ead4f70841f00',
  railwayDeploymentReceipt: 'cac91168-e35a-4f81-b4a9-f847ccd2895b',
});
const OUT = 'tools/out/native-release-acceptance/result.json';
const result = { schema: 'hallowmarch.native-release-acceptance/v1', target: TARGET,
  runtimeBinding: 'Operator verifies Railway receipt before and after; health does not expose a build SHA.',
  startedAt: new Date().toISOString(), cases: [], diagnostics: [], pageErrorCount: 0, consoleErrorCount: 0 };
const actors = [];
let stage = 'configuration';
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const bounded = (promise, ms, code = 'operation_timeout') => {
  let timer;
  return Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(code)), ms); })])
    .finally(() => clearTimeout(timer));
};
function check(ok, name, detail = {}) {
  result.cases.push({ name, ok: !!ok, ...detail });
  console.log((ok ? 'PASS ' : 'FAIL ') + name);
  assert(ok, name);
}
async function health() {
  const response = await fetch(TARGET.origin + '/health', { signal: AbortSignal.timeout(10000), redirect: 'error' });
  const body = await response.json();
  return { ok: response.ok && body.ok === true, players: body.players, connections: body.connections,
    standby: body.livePlay?.mode === 'standby' && body.livePlay.active === false,
    worldConfirmed: body.worldAuthority?.mode === 'native' && body.worldAuthority.fenced === false
      && body.worldAuthority.state === 'confirmed' && body.worldAuthority.pendingSnapshots === 0
      && Number.isSafeInteger(body.worldAuthority.liveVersion) && body.worldAuthority.liveVersion > 0
      && body.worldAuthority.liveVersion === body.worldAuthority.confirmedLiveVersion,
    worldLiveVersion: Number.isSafeInteger(body.worldAuthority?.liveVersion) ? body.worldAuthority.liveVersion : null,
    worldConfirmedLiveVersion: Number.isSafeInteger(body.worldAuthority?.confirmedLiveVersion) ? body.worldAuthority.confirmedLiveVersion : null,
    worldPendingSnapshots: Number.isSafeInteger(body.worldAuthority?.pendingSnapshots) ? body.worldAuthority.pendingSnapshots : null };
}
async function idleGate() {
  const deadline = Date.now() + 600000;
  let zeroSince = null, observed = null;
  while (Date.now() < deadline) {
    try {
      observed = await health();
      if (observed.ok && observed.players === 0 && observed.connections === 0) {
        zeroSince ??= Date.now();
        if (Date.now() - zeroSince >= 15000) {
          check(true, 'target_idle_before_native_acceptance', observed);
          return;
        }
      } else zeroSince = null;
    } catch { zeroSince = null; }
    await delay(5000);
  }
  check(false, 'target_idle_before_native_acceptance', { healthy: !!observed?.ok,
    players: Number.isInteger(observed?.players) ? observed.players : null,
    connections: Number.isInteger(observed?.connections) ? observed.connections : null });
}
async function evaluate(actor, fn, arg) {
  return bounded(actor.page.evaluate(fn, arg), 20000, 'page_evaluation_timeout');
}
async function poll(name, run, ms = 120000) {
  stage = name;
  const until = Date.now() + ms;
  let value = false;
  while (Date.now() < until) {
    value = await run();
    if (value) { check(true, name); return value; }
    await delay(500);
  }
  check(false, name);
}
async function focus(actor) {
  await actor.page.bringToFront();
  await actor.cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true });
  await actor.page.waitForFunction(() => !document.hidden, undefined, { timeout: 30000 });
}
function stopInput(actor) { clearInterval(actor.inputTimer); actor.inputTimer = null; }
async function activate(actor) {
  await focus(actor);
  await actor.page.keyboard.down('w'); await delay(150); await actor.page.keyboard.up('w');
  stopInput(actor);
  let n = 0, busy = false;
  actor.inputTimer = setInterval(async () => {
    if (busy || actor.page.isClosed()) return;
    busy = true;
    try { await actor.page.mouse.move(100 + n % 20, 120 + n++ % 10); } catch {} finally { busy = false; }
  }, 800);
}
async function attachPage(actor) {
  actor.page = await actor.context.newPage();
  actor.page.setDefaultTimeout(30000);
  actor.cdp = await actor.context.newCDPSession(actor.page);
  actor.page.on('pageerror', () => { result.pageErrorCount++; });
  actor.page.on('console', message => { if (message.type() === 'error') result.consoleErrorCount++; });
  actor.page.on('response', response => {
    try {
      const url = new URL(response.url());
      if (url.origin === TARGET.origin && url.pathname === '/gaming/identity/play/complete'
        && response.request().method() === 'POST' && response.status() === 503) actor.exactPlay503++;
    } catch {}
  });
  await focus(actor);
  await actor.page.goto(TARGET.origin + '/?safe=1', { waitUntil: 'domcontentloaded', timeout: 90000 });
  await focus(actor);
}
async function waitTitle(actor, returning = false) {
  await poll(actor.label + '_title_ready', async () => {
    const state = await evaluate(actor, () => {
      const stopped = !!window.__hmStartup?.stopped;
      return { stopped, ready: !!window.__hm?.ready };
    });
    if (state.stopped) throw new Error('graphics_startup_stopped');
    if (!state.ready) return false;
    return returning || await actor.page.getByRole('button', { name: 'Play now', exact: true }).isEnabled();
  }, 240000);
}
async function identity(actor) {
  return evaluate(actor, () => {
    const h = window.__hm, p = h?.SAVE?.loaded?.nativePlay;
    return { id: p?.characterId, expiry: p?.guestExpiresAt, name: h?.SAVE?.loaded?.char?.name };
  });
}
async function created(actor) {
  const until = Date.now() + 240000;
  let retried = false;
  while (Date.now() < until) {
    const current = await evaluate(actor, name => {
      const h = window.__hm;
      return { stopped: !!window.__hmStartup?.stopped,
        ok: !!(h?.GAME?.started && h.GAME.player?.name === name && h.nativePlayerStatus?.().readConfirmed) };
    }, actor.name);
    if (current.stopped) throw new Error('graphics_startup_stopped');
    if (current.ok) return;
    if (actor.exactPlay503 > 0 && !retried) {
      const button = actor.page.getByRole('button', { name: 'Play now', exact: true });
      if (await button.isVisible() && await button.isEnabled()
        && await actor.page.getByRole('textbox', { name: 'Character name', exact: true }).inputValue() === actor.name) {
        retried = true; actor.retryCount++; await button.click();
      }
    }
    await delay(500);
  }
  throw new Error('native_character_creation_timeout');
}
async function skipPrologue(actor) {
  const button = actor.page.getByRole('button', { name: 'Skip the prologue', exact: true });
  if (await button.isVisible()) await button.click();
}
async function boot(label, phone) {
  stage = label + '_launch';
  const actor = { label, phone, name: phone ? 'CloudPhoneQA' : 'CloudDesktopQA', exactPlay503: 0, retryCount: 0, inputTimer: null };
  actors.push(actor);
  actor.browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage',
    '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  actor.context = await actor.browser.newContext({ viewport: phone ? { width: 430, height: 932 } : { width: 1280, height: 900 },
    isMobile: phone, hasTouch: phone });
  await attachPage(actor); await waitTitle(actor);
  stage = label + '_create_native_guest';
  await actor.page.getByRole('textbox', { name: 'Character name', exact: true }).fill(actor.name);
  await actor.page.getByRole('button', { name: 'Play now', exact: true }).click();
  await created(actor); await skipPrologue(actor); await activate(actor);
  actor.original = await identity(actor);
  const expiry = typeof actor.original.expiry === 'number' ? actor.original.expiry : Date.parse(actor.original.expiry);
  check(typeof actor.original.id === 'string' && !!actor.original.id && Number.isFinite(expiry)
    && expiry > Date.now() && expiry <= Date.now() + 86400000 + 60000, label + '_native_guest_identity_and_expiry');
  return actor;
}
async function live(actor) {
  return evaluate(actor, () => {
    const h = window.__hm, n = h?.net, w = n?.NETWS;
    return !!(h?.GAME?.started && n.NET.state === 'on' && n.NET.link?.connected() === true
      && w?.state === 'on' && w.ws?.readyState === 1 && w.acct?.nativeBound === true
      && w.humanSuspended === false && w.worldInitialized === true && w.activeWorldAdmission
      && !w.worldReloadRequired && !w.worldPauseReason && w.worldPersistence?.mode === 'native'
      && w.worldPersistence.confirmedVersion > 0);
  });
}
async function snapshot(actor) {
  return evaluate(actor, () => {
    const h = window.__hm, b = h?.netboats?.NET_BOATS, n = h?.npcs?.state, e = h?.entities?.state();
    if (!b || !n || !e) return null;
    return { self: h.net.NET.self, boatAuthority: b.authority, boatKeeper: b.host,
      npcAuthority: n.authority, npcKeeper: n.peer, entityAuthority: e.authority, entityKeeper: e.peer,
      mine: e.mine, count: e.count, complete: e.complete, partsReady: !!h.worldparts?.NETPARTS.ready,
      npcs: h.npcs.snapshot().map(r => ({ id: r.id, look: r.lk, farm: r.fm, p: r.p })).sort((a,b) => a.id.localeCompare(b.id)),
      boats: [...b.frames.values()].map(r => ({ id: r.id, x: r.x, z: r.z, st: r.st, rider: r.rider })).sort((a,b) => a.id-b.id) };
  });
}
function compare(a, b) {
  const npcs = !!a && !!b && a.npcs.length === b.npcs.length;
  const boats = !!a && !!b && a.boats.length === b.boats.length;
  const diag = {
    bothReady: !!(a?.complete && b?.complete && a.partsReady && b.partsReady),
    independentPeers: !!a?.self && !!b?.self && a.self !== b.self,
    sameAuthority: !!a?.entityAuthority && a.entityAuthority === b?.entityAuthority
      && [a.boatAuthority, a.npcAuthority, b.boatAuthority, b.npcAuthority].every(x => x === a.entityAuthority),
    sameKeeper: !!a?.entityKeeper && a.entityKeeper === b?.entityKeeper
      && [a.boatKeeper, a.npcKeeper, b.boatKeeper, b.npcKeeper].every(x => x === a.entityKeeper),
    exactlyOneKeeper: Number(!!a?.mine) + Number(!!b?.mine) === 1,
    entityCountA: a?.count ?? 0, entityCountB: b?.count ?? 0,
    sameEntityCount: !!a?.count && a.count === b?.count,
    npcCountA: a?.npcs.length ?? 0, npcCountB: b?.npcs.length ?? 0,
    farmerPresent: !!a?.npcs.some(r => r.farm && r.farm[1]),
    sameNpcIdentity: npcs && a.npcs.every((r,i) => r.id === b.npcs[i].id),
    sameNpcAppearance: npcs && a.npcs.every((r,i) => JSON.stringify(r.look) === JSON.stringify(b.npcs[i].look)),
    sameNpcFarm: npcs && a.npcs.every((r,i) => JSON.stringify(r.farm) === JSON.stringify(b.npcs[i].farm)),
    sameNpcPosition: npcs && a.npcs.every((r,i) => Array.isArray(r.p) && Array.isArray(b.npcs[i].p)
      && Math.hypot(r.p[0]-b.npcs[i].p[0],r.p[2]-b.npcs[i].p[2]) < 4),
    boatCountA: a?.boats.length ?? 0, boatCountB: b?.boats.length ?? 0,
    sameBoatIdentity: boats && a.boats.every((r,i) => r.id === b.boats[i].id),
    sameBoatState: boats && a.boats.every((r,i) => r.st === b.boats[i].st && r.rider === b.boats[i].rider),
    sameBoatPosition: boats && a.boats.every((r,i) => Math.hypot(r.x-b.boats[i].x,r.z-b.boats[i].z) < 2.5),
  };
  const ok = Object.entries(diag).every(([key,value]) => key.endsWith('A') || key.endsWith('B') ? true : value === true)
    && diag.npcCountA >= 21 && diag.boatCountA > 0;
  return { ok, diag };
}
async function converge(name, pair) {
  let last = null;
  await poll(name, async () => {
    const [a,b] = await Promise.all(pair.map(snapshot));
    last = compare(a,b);
    if (last.ok) result.diagnostics.push({ stage: name, ...last.diag });
    return last.ok;
  }, 120000).catch(error => {
    if (last) result.diagnostics.push({ stage: name, ...last.diag });
    throw error;
  });
  return Promise.all(pair.map(snapshot));
}
async function confirmedSave(actor) {
  return evaluate(actor, name => {
    const h = window.__hm, s = h?.nativePlayerStatus?.();
    let body; try { body = JSON.parse(h?.SAVE?.lastBody || 'null'); } catch {}
    return !!(s?.readConfirmed && s.profileStatus?.hasRecord && !s.profileStatus.pending
      && !h.SAVE.pending && !h.SAVE.nativeFlight && body?.char?.name === name);
  }, actor.name);
}
async function pause(actor, name) {
  stage = name + '_focus';
  stopInput(actor); await focus(actor);
  stage = name + '_open_visible_menu';
  if (!await evaluate(actor, () => window.__hm?.UI?.modal === 'menu')) {
    // Mobile moves the desktop menu button into its closed tray. The visible
    // character/status button opens the same real menu without forced clicks.
    await actor.page.locator(actor.phone ? '#mobile-character' : '#btn-menu').click();
  }
  await poll(name + '_paused', () => evaluate(actor, () => {
    const h = window.__hm, w = h?.net?.NETWS;
    return !!(h?.UI?.modal === 'menu' && w?.humanSuspended === true && !w.pingTimer);
  }), 45000);
  await poll(name + '_private_save_confirmed', () => confirmedSave(actor), 90000);
}
async function safeDiagnostic(actor) {
  if (!actor.page || actor.page.isClosed()) return { label: actor.label, closed: true };
  try { return await evaluate(actor, () => {
    const h = window.__hm, w = h?.net?.NETWS, s = h?.nativePlayerStatus?.(), e = h?.entities?.state();
    return { boot: !!h?.ready, started: !!h?.GAME?.started, startupStopped: !!window.__hmStartup?.stopped,
      nativeReadConfirmed: !!s?.readConfirmed, nativeHasRecord: !!s?.profileStatus?.hasRecord,
      nativePending: !!s?.profileStatus?.pending, savePending: !!h?.SAVE?.pending, saveFlight: !!h?.SAVE?.nativeFlight,
      connected: w?.state === 'on' && w.ws?.readyState === 1, suspended: w?.humanSuspended === true,
      worldInitialized: !!w?.worldInitialized, worldAdmission: !!w?.activeWorldAdmission,
      worldPaused: !!w?.worldPauseReason, worldReload: !!w?.worldReloadRequired,
      sharedComplete: !!e?.complete, entityCount: e?.count ?? 0, keeper: !!e?.mine,
      npcCount: h?.npcs?.snapshot().length ?? 0, boatCount: h?.netboats?.NET_BOATS.frames.size ?? 0,
      partsReady: !!h?.worldparts?.NETPARTS.ready, partsPending: h?.worldparts?.NETPARTS.pending.size ?? 0 };
  }); } catch { return { label: actor.label, diagnosticUnavailable: true }; }
}
async function main() {
  stage = 'idle_gate'; await idleGate();
  const desktop = await boot('desktop', false);
  await poll('desktop_native_live', () => live(desktop));
  const phone = await boot('phone', true);
  await poll('phone_native_live', () => live(phone));
  check(desktop.original.id !== phone.original.id, 'independent_native_characters');
  const initial = await converge('independent_public_scenes_converge', [desktop,phone]);
  const departing = initial[0].mine ? desktop : phone, survivor = departing === desktop ? phone : desktop;
  const oldAuthority = initial[0].entityAuthority;
  await pause(departing, 'keeper_departure'); await departing.page.close();
  await activate(survivor);
  await poll('survivor_becomes_complete_keeper', async () => {
    const s = await snapshot(survivor);
    return !!(await live(survivor) && s?.mine && s.complete && s.partsReady && s.entityAuthority !== oldAuthority
      && s.boatKeeper === s.self && s.npcKeeper === s.self && s.entityKeeper === s.self
      && s.boatAuthority === s.entityAuthority && s.npcAuthority === s.entityAuthority);
  });
  stage = 'saved_character_rejoin';
  await attachPage(departing); await waitTitle(departing, true);
  await poll('saved_character_available_after_page_rejoin', () => evaluate(departing, name => {
    const h = window.__hm;
    return !!(h?.ready && h.nativePlayerStatus?.().readConfirmed && h.SAVE.loaded?.char?.name === name
      && !document.getElementById('btn-continue')?.disabled);
  }, departing.name), 180000);
  const returned = await identity(departing);
  check(returned.id === departing.original.id && returned.expiry === departing.original.expiry,
    'same_saved_character_and_exact_guest_expiry');
  await departing.page.getByRole('button', { name: 'Return to the march', exact: true }).click();
  await poll('rejoined_character_started', () => evaluate(departing, name => {
    const h = window.__hm;
    return !!(h?.GAME?.started && h.GAME.player?.name === name && h.nativePlayerStatus?.().readConfirmed);
  }, departing.name));
  await skipPrologue(departing); await activate(departing);
  await poll('rejoined_native_player_live', () => live(departing));
  await converge('public_scenes_reconverge_after_handoff_and_rejoin', [desktop,phone]);
  await pause(desktop, 'final_desktop'); await pause(phone, 'final_phone');
  check(result.pageErrorCount === 0, 'no_uncaught_page_errors', { count: result.pageErrorCount });
  result.ok = true;
}
let watchdog;
try {
  watchdog = setTimeout(() => {
    result.ok = false; result.failure = { stage, code: 'acceptance_deadline' }; result.finishedAt = new Date().toISOString();
    mkdirSync('tools/out/native-release-acceptance', { recursive: true });
    writeFileSync(OUT, JSON.stringify(result, null, 2) + '\n');
    console.error('FAIL acceptance_deadline'); process.exit(1);
  }, 2100000);
  await main();
} catch {
  result.ok = false; result.failure = { stage, code: 'acceptance_stage_failed' };
  for (const actor of actors) result.diagnostics.push({ stage: 'failure', label: actor.label, ...await safeDiagnostic(actor) });
  console.error('FAIL ' + stage + ' [acceptance_stage_failed]');
  process.exitCode = 1;
} finally {
  clearTimeout(watchdog);
  for (const actor of actors) {
    stopInput(actor);
    if (actor.page && !actor.page.isClosed()) {
      try { if (await evaluate(actor, () => !!window.__hm?.GAME?.started)) await bounded(pause(actor, actor.label + '_cleanup'), 45000); } catch {}
    }
    try { await bounded(actor.browser?.close(), 15000); } catch {}
  }
  const quietUntil = Date.now() + 45000;
  do {
    try { result.finalHealth = await health(); } catch { result.finalHealth = { available: false }; }
    if (result.finalHealth.ok && result.finalHealth.players === 0 && result.finalHealth.connections === 0 && result.finalHealth.standby && result.finalHealth.worldConfirmed) break;
    await delay(1000);
  } while (Date.now() < quietUntil);
  const quiet = result.finalHealth.ok && result.finalHealth.players === 0 && result.finalHealth.connections === 0 && result.finalHealth.standby;
  result.cases.push({ name: 'closed_browsers_and_public_standby_confirmed', ok: !!quiet });
  if (!quiet) { result.ok = false; process.exitCode = 1; }
  result.admissionRecovery = actors.map(actor => ({ role: actor.label, exactPlay503: actor.exactPlay503, sameButtonRetries: actor.retryCount }));
  result.finishedAt = new Date().toISOString();
  await mkdir('tools/out/native-release-acceptance', { recursive: true });
  await writeFile(OUT, JSON.stringify(result, null, 2) + '\n');
  console.log('SAFE_RESULT ' + JSON.stringify(result));
  console.log(result.ok ? 'PASS native_release_acceptance_complete' : 'FAIL native_release_acceptance_incomplete');
}
