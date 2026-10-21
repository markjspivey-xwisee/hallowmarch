"""[perf3] What version 19's systems cost a step and a frame, the weather's passes at each quality, the net code alone, and
localPath's A* in WebAssembly against the JS in the page (the same ways, and the time).
usage: python3 tools/tests/perf3.py [only=systems,wx,wasm,net] [q=low,medium,high] [w=640 h=360] [phone] [tag=now]
  systems: a war run on, every system timed (13p_perf.js's timers, version 19's too): ms a step by system, in the town
           and at the biggest fight
  wx:      frames with the GPU drained, turn about: everything on / the view's own clouds off / every cloud pass off
           (WXR.on), at each quality: what the cloud field, the dome and the view's clouds cost a frame
  wasm:    the searches of a running war recorded and replayed both ways (the same parents; ms), then the war itself
           run turn about with WASM.lp on and off (localPath's own time)
  net:     netPump's cost a step with no room and no server (it should do nothing)
Writes tools/out/perf3_<tag>.json."""
import asyncio, json, sys, time, pathlib
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
import hm
from hmlib import human_play
from playwright.async_api import async_playwright

ARGS = sys.argv[1:]
OPT = dict(a.split('=', 1) for a in ARGS if '=' in a)
ONLY = OPT.get('only', 'systems,wx,wasm,net').split(',')
QUALS = OPT.get('q', 'low,medium,high').split(',')
PHONE = 'phone' in ARGS
W, H = (390, 780) if PHONE else (int(OPT.get('w', 640)), int(OPT.get('h', 360)))
TAG = OPT.get('tag', 'now')
FAILS = []
T0 = time.time()
def check(ok, msg):
    print(('  ok   ' if ok else '  FAIL ') + msg, flush=True)
    if not ok: FAILS.append(msg)
def log(*a): print(f'[{time.time() - T0:6.1f}s]', *a, flush=True)

HOLD = """(() => { window.__rafHold = true; const raf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = (cb) => raf((t) => { if (window.__rafHold) window.requestAnimationFrame(cb); else cb(t); }); })();"""

HELP = r"""
window.P3 = {
  H: window.__hm,
  calm() { const P = this.H.GAME.player; P.hp = P.maxHp = 1e7; P.buffs.length = 0; P.casting = null; P.alive = true; },
  drain() { const R = this.H.dbg.renderer, gl = R.getContext(), px = new Uint8Array(4); R.setRenderTarget(null); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); },
  // a frame with the GPU drained before and after: its whole cost (JS and SwiftShader's drawing)
  frameMs() { this.drain(); const t = performance.now(); this.H.frame(1 / 30); this.drain(); return performance.now() - t; },
  stand(x, z, yaw, pitch = 0.12, dist = 7) { const H = this.H, P = H.GAME.player; H.teleport(x, z); P.yaw = yaw; H.CAM.mode = 'play'; H.UI.modal = null; H.look(yaw, pitch, dist); this.calm(); },
  town() { const T = this.H.REALMS[0].town; this.stand(T.x + 6, T.z + 18, 0.6); },
  battle() {
    const H = this.H; let best = null, bn = -1;
    for (const e of H.ENT) { if (!e.alive || (e.role !== 'soldier' && e.role !== 'guard') || !(e.combatUntil > H.GAME.t)) continue; let n = 0; for (const o of H.ENT) if (o.alive && Math.abs(o.x - e.x) < 25 && Math.abs(o.z - e.z) < 25) n++; if (n > bn) { bn = n; best = e; } }
    if (!best) best = H.ENT.find((e) => e.alive && e.role === 'soldier');
    const a = Math.atan2(best.x, best.z); this.stand(best.x + Math.sin(a) * 14, best.z + Math.cos(a) * 14, a + Math.PI); return bn;
  },
};
0"""

SYS = ['updateWeather2', 'wxCloudsFrame', 'wxCloudsScreen', 'updateLoops', 'updateSeason', 'netPump', 'netUiFrame', 'footLockStep', 'updateWar3', 'updateWar4',
       'updateLate2', 'updateLate4', 'drawLate4', 'updateSeasons', 'updateBlaze', 'updatePalisades', 'updateMountains', 'updateLod', 'hudLayout', 'updateTowers',
       'updateSiege', 'localPath', 'a2DragonSolve', 'tracksUpdate', 'drawWalls', 'updateWarPanel', 'look5Frame', 'look6Frame', 'updateNPCs', 'updateHUD', 'drawActors', 'updateWar']

async def active_eval(page, js):
    # Explicit test-operator input; no synthetic activity flag or recurring keepalive.
    await human_play(page)
    return await page.evaluate(js)

async def main():
    res = {}
    async with async_playwright() as p:
        b = await p.chromium.launch(args=['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-precise-memory-info'])
        ctx = await b.new_context(viewport={'width': W, 'height': H}, has_touch=PHONE, is_mobile=PHONE)
        page = await ctx.new_page()
        page.set_default_timeout(1800000)
        await page.add_init_script(HOLD)
        three = hm.THREE_LOCAL.read_text()
        async def three_route(route): await route.fulfill(status=200, content_type='application/javascript', body=three, headers={'Access-Control-Allow-Origin': '*'})
        await page.route(hm.THREE_URL, three_route)
        async def font_route(route): await route.fulfill(status=200, content_type='text/css', body='')
        await page.route('https://fonts.googleapis.com/**', font_route)
        async def doc_route(route): await route.fulfill(status=200, content_type='text/html', body=hm.SKELETON.replace('%s', hm.HTML.read_text()))
        await page.route('http://hm.test/', doc_route)
        await page.goto('http://hm.test/', wait_until='commit')
        await page.wait_for_function('window.__hm && window.__hm.ready', timeout=300000, polling=500)
        await page.evaluate(HELP)
        await page.evaluate("(() => { __hm.fn.setQuality('low'); __hm.start({ realm: 0, cls: 'warrior', level: 30 }); P3.calm(); __hm.setTod(0.55); __hm.UI.modal = null; const E = __hm.dbg.WEATHER; E.mode = 'auto'; if (E.next > 1e6) E.next = 60; return 0; })()")
        log('ready; a war run on 60 s')
        advanced = await active_eval(page, "() => { const t = __hm.GAME.t; __hm.simulate(60); return __hm.GAME.t - t; }")
        check(advanced > 59, 'trusted browser input runs the active war benchmark')
        if 'systems' in ONLY:
            await active_eval(page, '__hm.perf.timers(); 0')
            out = {}
            for where in ('town', 'battle'):
                bn = await active_eval(page, f"P3.{where}()")
                await active_eval(page, "__hm.simulate(1); for (let i = 0; i < 4; i++) __hm.frame(1/30); __hm.perf.times(true); 0")
                t = await active_eval(page, "(() => { const t = performance.now(); __hm.simulate(10); for (let i = 0; i < 20; i++) { __hm.simulate(0.1); __hm.frame(1/30); } return performance.now() - t; })()")
                tops = await active_eval(page, "__hm.perf.times(true)")
                steps = 200 + 40  # 10 s and 2 s of 1/20 s steps; 20 frames
                by = {r['k']: r for r in tops}
                out[where] = {'wall': round(t), 'sys': {k: [round(by[k]['ms'], 1), by[k]['n'], by[k]['each']] for k in SYS if k in by}}
                log(f'{where} (fight of {bn}):', ', '.join(f"{k} {by[k]['ms']:.1f} ms/{by[k]['n']} ({by[k]['each']})" for k in SYS if k in by))
            res['systems'] = out
            wxs = await active_eval(page, "(() => { const S = __hm.weather2.WXS; return { builds: S.builds, ms: +S.ms.toFixed(1), t: Math.round(__hm.GAME.t) }; })()")
            log('the shelter map:', wxs)
            res['shelter'] = wxs
        if 'net' in ONLY:
            st = await active_eval(page, "(() => { const s = __hm.net.state(); return { state: s.state, kind: s.kind }; })()")
            check(st['state'] in ('alone', 'off'), f"no room and no server: the net is {st['state']}")
            r = await active_eval(page, "(() => { const T = __hm.perf.PERFX.times; delete T.netPump; delete T.netUiFrame; __hm.simulate(5); for (let i = 0; i < 10; i++) __hm.frame(1/30); const a = T.netPump || { ms: 0, n: 0 }, b = T.netUiFrame || { ms: 0, n: 0 }; return { pump: [a.ms, a.n], ui: [b.ms, b.n] }; })()")
            log('net alone:', r)
            check(r['pump'][1] == 0 or r['pump'][0] / max(1, r['pump'][1]) < 0.02, f"netPump with no room: {r['pump'][0]:.2f} ms over {r['pump'][1]} calls")
            check(r['ui'][1] == 0 or r['ui'][0] / max(1, r['ui'][1]) < 0.05, f"netUiFrame with no room: {r['ui'][0]:.2f} ms over {r['ui'][1]} frames")
            res['net'] = r
        if 'wx' in ONLY:
            out = {}
            await active_eval(page, "P3.town(); __hm.look(2.2, -0.05, 7); 0")  # toward the sky over the land
            for q in QUALS:
                await active_eval(page, f"__hm.fn.setQuality('{q}'); for (let i = 0; i < 6; i++) __hm.frame(1/30); 0")
                cfg = {'all': "W.on = true; W.scrOff = false;", 'noview': "W.on = true; W.scrOff = true;", 'none': "W.on = false; W.scrOff = false;"}
                ms = {k: [] for k in cfg}
                for rnd in range(int(OPT.get('rounds', 6))):
                    for k, js in cfg.items():
                        v = await active_eval(page, f"(() => {{ const W = __hm.weather2.WXR; {js} P3.frameMs(); P3.frameMs(); const a = P3.frameMs(), b = P3.frameMs(); W.on = true; W.scrOff = false; return [a, b]; }})()")
                        ms[k] += v
                med = {k: round(sorted(v)[len(v) // 2], 1) for k, v in ms.items()}
                out[q] = med
                log(f"{q}: a whole frame (GPU drained) with every cloud pass {med['all']} ms, without the view's own clouds {med['noview']}, without any {med['none']}: the view's clouds {med['all'] - med['noview']:+.1f} ms, the field and the dome {med['noview'] - med['none']:+.1f} ms")
            await active_eval(page, "__hm.fn.setQuality('low'); 0")
            res['wx'] = out
        if 'wasm' in ONLY:
            hasw = await active_eval(page, "!!__hm.wasm")
            check(hasw, 'the WebAssembly module is in the build')
            if hasw:
                # the searches a running war asks for, recorded
                await active_eval(page, "__hm.wasm.WASM.rec = []; __hm.wasm.WASM.lp = false; 0")
                # Keep the >20-search assertion and sample quiet openings too.
                for _ in range(240):
                    n = await active_eval(page, "(() => { __hm.simulate(5); return __hm.wasm.WASM.rec.length; })()")
                    if n >= 80: break
                rep = await active_eval(page, r"""(() => {
                  const M = __hm.wasm, LP = M.LP, rec = M.WASM.rec; M.WASM.rec = null;
                  const path = (s, g, N) => { const p = []; for (let k = g; k !== -1 && p.length <= N; k = k === s ? -1 : LP.fromV[k]) p.push(k); return p.join(','); };
                  let same = 0, diff = 0, cells = 0;
                  for (const r of rec) {
                    LP.blocked.set(r.b); M.WASM.lp = false; const fj = M.lpSearch(r.W, r.Hh, r.N, r.s, r.g); const pj = fj ? path(r.s, r.g, r.N) : '';
                    LP.blocked.set(r.b); M.WASM.lp = true; const fw = M.lpSearch(r.W, r.Hh, r.N, r.s, r.g); const pw = fw ? path(r.s, r.g, r.N) : '';
                    if (fj === fw && pj === pw) same++; else diff++;
                    cells += r.N;
                  }
                  const time = (on) => { M.WASM.lp = on; const t = performance.now(); for (let k = 0; k < 3; k++) for (const r of rec) { LP.blocked.set(r.b); M.lpSearch(r.W, r.Hh, r.N, r.s, r.g); } return performance.now() - t; };
                  const tj = [], tw = []; for (let k = 0; k < 4; k++) { tj.push(time(false)); tw.push(time(true)); }
                  M.WASM.lp = true;
                  const med = (v) => v.slice().sort((a, b) => a - b)[v.length >> 1];
                  return { n: rec.length, cells, same, diff, js: med(tj), wasm: med(tw), compile: M.WASM.stats.compileMs, heap: M.WASM.stats.lpHeap };
                })()""")
                log('wasm replay:', rep)
                check(rep['diff'] == 0 and rep['n'] > 20, f"{rep['n']} searches of a running war ({rep['cells'] / 1e6:.1f} M cells): {rep['same']} the same both ways, {rep['diff']} different")
                check(True, f"the searches three times over: JS {rep['js']:.1f} ms, WebAssembly {rep['wasm']:.1f} ms ({rep['js'] / max(0.01, rep['wasm']):.2f}x); compiled in {rep['compile']:.2f} ms")
                # localPath's own time in the war, turn about
                tt = await active_eval(page, r"""(() => {
                  const H = __hm, LPs = H.wasm.LP.stats, out = { js: [0, 0], wasm: [0, 0] };
                  for (let r = 0; r < 6; r++) for (const on of [false, true]) { H.wasm.WASM.lp = on; const m0 = LPs.ms, c0 = LPs.calls; H.simulate(5); const o = out[on ? 'wasm' : 'js']; o[0] += LPs.ms - m0; o[1] += LPs.calls - c0; }
                  H.wasm.WASM.lp = true; return out; })()""")
                log('localPath in the war, turn about (ms, calls):', tt)
                res['wasm'] = {'replay': rep, 'war': tt}
        res['errors'] = await active_eval(page, '__hm.errors.slice(0, 5)')
        check(not res['errors'], f"no errors ({res['errors'][:2]})")
        await b.close()
    pathlib.Path(str(hm.OUT) + f'/perf3_{TAG}.json').write_text(json.dumps(res, indent=1))
    print(f'\n{len(FAILS)} failed in {time.time() - T0:.0f}s')
    for f in FAILS: print('  FAIL', f)
    sys.exit(1 if FAILS else 0)

asyncio.run(main())
