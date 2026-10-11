"""[look2] What version 12's look left, fixed at the cause (version 13): numeric checks and the views to look at.
Checks:
  - paths: every footpath of the three towns is in the 1 m path map (13u_look2.js: its middle full, 3 m off it bare),
    and the terrain reads it (the shader compiles);
  - climb: a body on a ladder (action 14) carries its weapon, shield or bow on its back (read back from what the
    shader draws: 13r_motion.js's probe), and in its hands again once off the ladder; in a blow from the rungs (18) the
    weapon is in the hand and the shield on the back;
  - hound: a hound by a hearth inside a house at night is lit by the room (warm), as the priest beside it is, not blue
    by the moon (the picture's pixels at the hound);
  - no runtime errors.
Screenshots (unless noshots): the look2 group of tools/tests/look_views.js (hound_in at night, handover at high and
medium, the crown at low, apples in summer and winter, the towns' paths, a street in snow, the climb, and version 12's
additions: arrows stuck and glanced, the breached and mended tower, the burnt log tower, the rush).
usage: python3 tools/tests/look2.py [noshots] [only=paths,climb,hound] [shots=view:q:variant,...] [tag=now]"""
import json, asyncio, sys, time, pathlib, base64, io
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
import hm
from hmlib import OUT
from playwright.async_api import async_playwright
try:
    from PIL import Image
except ImportError:
    Image = None

ARGS = sys.argv[1:]
OPT = dict(a.split('=', 1) for a in ARGS if '=' in a)
ONLY = OPT['only'].split(',') if 'only' in OPT else None
def want(k): return ONLY is None or k in ONLY
SHOTS = 'noshots' not in ARGS
TAG = OPT.get('tag', 'now')
VIEWS_JS = pathlib.Path(__file__).resolve().parent / 'look_views.js'
T0 = time.time()
FAILS = []
def check(cond, what):
    print(('  ok   ' if cond else '  FAIL ') + what, flush=True)
    if not cond: FAILS.append(what)

HOLD = """(() => { let s = 1234567; Math.random = () => { s |= 0; s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; })();
(() => { window.__rafHold = false; const raf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = (cb) => raf((t) => { if (window.__rafHold) window.requestAnimationFrame(cb); else cb(t); }); })();"""

async def setup(p, w=640, h=360):
    b = await p.chromium.launch(args=['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
    ctx = await b.new_context(viewport={'width': w, 'height': h})
    page = await ctx.new_page()
    await page.add_init_script(HOLD)
    logs = []
    page.on('pageerror', lambda e: logs.append(f'[pageerror] {e}'))
    three = hm.THREE_LOCAL.read_text()
    async def three_route(route): await route.fulfill(status=200, content_type='application/javascript', body=three, headers={'Access-Control-Allow-Origin': '*'})
    await page.route(hm.THREE_URL, three_route)
    async def font_route(route): await route.fulfill(status=200, content_type='text/css', body='')
    await page.route('https://fonts.googleapis.com/**', font_route)
    async def doc_route(route): await route.fulfill(status=200, content_type='text/html', body=hm.SKELETON.replace('%s', hm.HTML.read_text()))
    await page.route('http://hm.test/', doc_route)
    await page.goto('http://hm.test/', wait_until='commit')
    await page.wait_for_function('window.__hm && window.__hm.ready', timeout=400000, polling=500)
    return b, page, logs

async def grab(page, frames=2):
    url = await page.evaluate(f"(() => {{ for (let i = 0; i < {frames}; i++) __hm.frame(1/30); return __hm.dbg.renderer.domElement.toDataURL('image/png'); }})()")
    return base64.b64decode(url.split(',', 1)[1])

async def ev(page, label, js):
    r = await page.evaluate(js)
    print(f'{label} [{time.time() - T0:.0f}s]', json.dumps(r)[:1500], flush=True)
    return r

# a probe of where the shader draws chosen vertices of the player: the tip of the blade (or the staff's foot), the middle
# of the shield, the bow's grip, in the body's own frame (x left, y up, z forward, from its root)
PROBE = r"""
window.L2 = {
  parts() {
    const M = __hm.motion, H = __hm, P = H.GAME.player;
    M.motionDraw();
    const f = M.motionFind(P)[0];
    if (!f) return null;
    const A = f.crowd.geo.attributes, pos = A.position.array, bit = A.aBit.array, n = A.position.count;
    // WB bits (05a_rig.js): sword 0, mace 1, staff 2, axe 3, shield 5, bow 6, shieldRound 16
    const far = (b, ref) => { let best = -1, bd = -1; for (let i = 0; i < n; i++) if (Math.round(bit[i]) === b) { const d = Math.hypot(pos[i * 3] - ref[0], pos[i * 3 + 1] - ref[1], pos[i * 3 + 2] - ref[2]); if (d > bd) { bd = d; best = i; } } return best; };
    const near = (b, ref) => { let best = -1, bd = 1e9; for (let i = 0; i < n; i++) if (Math.round(bit[i]) === b) { const d = Math.hypot(pos[i * 3] - ref[0], pos[i * 3 + 1] - ref[1], pos[i * 3 + 2] - ref[2]); if (d < bd) { bd = d; best = i; } } return best; };
    const ids = { sword: far(0, [-0.244, 0.868, 0.004]), mace: far(1, [-0.244, 0.868, 0.004]), shield: near(5, [0.32, 1.0, 0.02]), round: near(16, [0.33, 1.0, 0.02]), bow: near(6, [0.25, 0.868, 0.004]), staff: far(2, [-0.244, 0.868, 0.004]) };
    const keys = Object.keys(ids).filter((k) => ids[k] >= 0), vids = keys.map((k) => ids[k]);
    const out = M.mprobeRun(f.crowd, vids, [f.idx])[0];
    const c = Math.cos(P.yaw), s = Math.sin(P.yaw), r = {};
    keys.forEach((k, i) => { const w = out[i]; if (!w) { r[k] = null; return; } const dx = w[0] - P.x, dy = w[1] - P.y, dz = w[2] - P.z; r[k] = [+(dx * c - dz * s).toFixed(2), +dy.toFixed(2), +(dx * s + dz * c).toFixed(2)]; });
    r.act = P.anim.act;
    return r;
  },
};
"""

async def main():
    async with async_playwright() as p:
        b, page, logs = await setup(p)
        print(f'booted [{time.time() - T0:.0f}s]', flush=True)
        await page.evaluate("__hm.start({realm:0, cls:'warrior', level:30}); 0")
        await page.evaluate(VIEWS_JS.read_text() + '\n;0')
        await page.evaluate("LK.boot(); 0")
        await page.evaluate(PROBE + '\n;0')
        await page.evaluate("__hm.fn.setQuality('low'); 0")
        if want('paths'):
            r = await ev(page, 'paths', """(() => { const out = { n: 0, mid: [], side: [], bad: [] }; const L2 = __hm.look2, X = __hm.lookx;
              for (const T of X.lookTownPlan()) for (const P of T.paths) {
                out.n++; const mx = (P.ax + P.bx) / 2, mz = (P.az + P.bz) / 2, dx = P.bx - P.ax, dz = P.bz - P.az, l = Math.hypot(dx, dz) || 1;
                const m = L2.path(mx, mz); out.mid.push(+m.toFixed(2));
                // 3.2 m to each side, unless another path runs there
                for (const sd of [-1, 1]) { const sx = mx - dz / l * 3.2 * sd, sz = mz + dx / l * 3.2 * sd;
                  if (X.lookTownPlan().some((T2) => T2.paths.some((Q) => Q !== P && Math.hypot(sx - (Q.ax + Q.bx) / 2, sz - (Q.az + Q.bz) / 2) < Math.hypot(Q.bx - Q.ax, Q.bz - Q.az) / 2 + 3))) continue;
                  const v = L2.path(sx, sz); out.side.push(+v.toFixed(2)); if (v > 0.1) out.bad.push([+sx.toFixed(1), +sz.toFixed(1), +v.toFixed(2)]); }
              }
              out.minMid = Math.min(...out.mid); out.maxSide = Math.max(0, ...out.side); return out; })()""")
            check(r['n'] >= 12, f"the towns' footpaths planned: {r['n']}")
            check(r['minMid'] >= 0.85, f"every path's middle is in the 1 m path map (least {r['minMid']})")
            check(r['maxSide'] <= 0.1, f"3 m off a path the map is bare (most {r['maxSide']}; {r['bad'][:3]})")
        if want('climb'):
            await page.evaluate("__hm.fn.setQuality('high'); 0")
            r0 = await ev(page, 'standing', """(() => { const H = __hm, P = H.GAME.player; LK.set('k0_court', 'day'); P.anim.act = 0; P.anim.actT = 0; P.anim.actDur = 0; return L2.parts(); })()""")
            r1 = await ev(page, 'climbing', """(() => { LK.set('climb', 'day'); return L2.parts(); })()""")
            r2 = await ev(page, 'a blow from the rungs', """(() => { const H = __hm, P = H.GAME.player; LK.set('climb', 'day'); P.anim.act = 18; P.anim.actDur = 1.0; P.anim.actT = 0.5; return L2.parts(); })()""")
            w0 = r0.get('sword') or r0.get('mace'); w1 = r1.get('sword') or r1.get('mace'); w2 = r2.get('sword') or r2.get('mace')
            s0 = r0.get('shield') or r0.get('round'); s1 = r1.get('shield') or r1.get('round'); s2 = r2.get('shield') or r2.get('round')
            check(w0 is not None and s0 is not None, f'the warrior carries a blade and a shield ({w0}, {s0})')
            check(w0 is not None and w0[2] > 0.15, f'standing, the blade points forward from the hand (its tip {w0})')
            check(s0 is not None and s0[0] > 0.2, f'standing, the shield hangs on the left forearm ({s0})')
            check(w1 is not None and -0.5 < w1[2] < -0.12 and 0.4 < w1[1] < 1.7, f'on the ladder the blade hangs on the back (its tip {w1})')
            check(s1 is not None and -0.5 < s1[2] < -0.15 and abs(s1[0]) < 0.12 and 0.8 < s1[1] < 1.5, f'and the shield on the back, over the cloak ({s1})')
            check(w2 is not None and w2[2] > -0.1, f'in a blow from the rungs the blade is in the hand again ({w2})')
            check(s2 is not None and s2[2] < -0.15, f'and the shield stays on the back ({s2})')
        if want('hound'):
            await page.evaluate("__hm.fn.setQuality('high'); 0")
            info = await ev(page, 'hound by the hearth', """(() => { const r = LK.set('hound_in', 'night'); const H = __hm, hd = LK.made.find((e) => e.kind === 'hound'), pr = LK.made.find((e) => e.kind !== 'hound');
              const pt = (e, dy) => { const c = H.camera; const p = { x: e.x, y: e.y + dy, z: e.z }; const q = new (c.position.constructor)(p.x, p.y, p.z).project(c); return [Math.round((q.x * 0.5 + 0.5) * 640), Math.round((0.5 - q.y * 0.5) * 360)]; };
              return { r, hound: pt(hd, 0.45), priest: pt(pr, 1.0) }; })()""")
            png = await grab(page)
            if Image:
                im = Image.open(io.BytesIO(png)).convert('RGB')
                im.save(OUT + f'look2_{TAG}_hound_check.png')
                W, H = im.size
                def avg(px, py):
                    sx, sy = W / 640, H / 360; xs = []
                    for dx in range(-3, 4):
                        for dy in range(-3, 4):
                            x, y = int(px * sx) + dx, int(py * sy) + dy
                            if 0 <= x < W and 0 <= y < H: xs.append(im.getpixel((x, y)))
                    return [round(sum(c[i] for c in xs) / max(1, len(xs)), 1) for i in range(3)]
                hc, pc = avg(*info['hound']), avg(*info['priest'])
                print('  hound rgb', hc, 'priest rgb', pc, flush=True)
                check(hc[0] > hc[2] * 1.05, f'the hound inside at night is lit warm by the room, not blue (rgb {hc})')
        if SHOTS:
            shots = OPT.get('shots', 'hound_in:high:night,handover:high:day,handover:medium:day,crown:low:day,apples:high:day,apples:high:winter,t0_paths:high:day,t2_street:high:snow,climb:high:day')
            for sp in shots.split(','):
                v, q, var = sp.split(':')
                await page.evaluate(f"__hm.fn.setQuality('{q}'); 0")
                info = await page.evaluate(f"LK.set('{v}', '{var}')")
                if isinstance(info, dict) and info.get('skip'): print('  skip', v, info); continue
                data = await grab(page)
                name = f'look2_{TAG}_{v}_{q}_{var}'
                if Image: Image.open(io.BytesIO(data)).convert('RGB').save(OUT + name + '.png')
                else: pathlib.Path(OUT + name + '.png').write_bytes(data)
                print('  shot', name, json.dumps(info)[:200], f'[{time.time() - T0:.0f}s]', flush=True)
        errs = await page.evaluate("__hm.errors.map(String)")
        check(not errs, 'no runtime errors ' + json.dumps(errs)[:600])
        if logs: print('logs', logs[:4])
        print('FAILED:' if FAILS else 'ALL PASSED', FAILS, flush=True)
        await b.close()

asyncio.run(main())
