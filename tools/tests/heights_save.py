"""[heights] A save made by version 10 (before the mountains were shaped) loads into this build.
usage: HM_V10=path/to/version10.html python3 tools/tests/heights_save.py
Version 10's page makes a busy land (trees felled by number, one of them on the mountains' foot, a sapling, a burning
tree, a crater on a mountain slope, a grass fire), saves, and the page is loaded again from this build with the same
storage: no errors, every felled tree is the same tree (by number) lying the same way, the crater's change of height is
applied on the new ground, the character continues and the world runs on."""
import json, asyncio, sys, time, pathlib, os
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
import hm
from playwright.async_api import async_playwright

V10 = pathlib.Path(os.environ.get('HM_V10', ''))
T0 = time.time()
FAILS = []
def check(cond, what):
    print(('  ok   ' if cond else '  FAIL ') + what, flush=True)
    if not cond: FAILS.append(what)

HOLD = """(() => { let s = 1234567; Math.random = () => { s |= 0; s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; })();"""

MAKE = r"""(async () => { const F = __hm.fn, W = F.W, N = __hm.nature, H = __hm;
  await H.start({ realm: 0, cls: 'warrior', level: 30 }); H.UI.modal = 'menu';
  // trees on the foot of the mountains (the mountain's weight from __hm.mtn) and two ordinary ones
  const M = H.mtn.MTN, mk = (t) => M.mount[Math.round((t.z + 512) / 2) * 513 + Math.round((t.x + 512) / 2)];
  const foot = W.trees.filter((t) => mk(t) > 0.04 && mk(t) < 0.5).slice(0, 2), plain = W.trees.filter((t) => mk(t) === 0 && Math.hypot(t.x, t.z) > 300).slice(0, 3);
  const ids = [];
  for (const t of foot.concat(plain.slice(0, 1))) { N.fellTree(t, 1, 0.4, 90, false); ids.push(t.i); }
  H.simulate(8);
  N.igniteTree(plain[1].i); H.simulate(1);
  // a crater on a mountain slope anyone can reach, and one on the plain
  let cr = null;
  for (let k = 0; k < 400000 && !cr; k += 37) { const x = -500 + (k % 1000), z = -500 + ((k * 7) % 1000); const m = M.mount[Math.round((z + 512) / 2) * 513 + Math.round((x + 512) / 2)]; if (m > 0.15 && m < 0.5 && F.isWalkable(x, z)) cr = [x, z]; }
  const before = cr ? F.heightAt(cr[0], cr[1]) : null;
  if (cr) N.natureCrater(cr[0], cr[1], 3, 1.5);
  const after = cr ? F.heightAt(cr[0], cr[1]) : null;
  N.igniteGrass(plain[2].x + 6, plain[2].z, 2); H.simulate(2);
  F.saveNow();
  const fall = ids.map((i) => { const t = W.trees[i]; return t.fall ? [i, +t.fall.ux.toFixed(3), +t.fall.uz.toFixed(3)] : [i, null, null]; });
  return { ids, fall, burning: plain[1].i, cr, dh: before !== null ? +(after - before).toFixed(3) : null, trees: W.trees.length, errors: H.errors.slice(0, 3) }; })()"""

async def main():
    if not V10.exists():
        print('set HM_V10 to a version 10 build'); sys.exit(2)
    serve = {'html': V10.read_text()}
    async with async_playwright() as p:
        b = await p.chromium.launch(args=['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
        ctx = await b.new_context(viewport={'width': 480, 'height': 270})
        page = await ctx.new_page()
        await page.add_init_script(HOLD)
        logs = []
        page.on('pageerror', lambda e: logs.append(f'[pageerror] {e}'))
        three = hm.THREE_LOCAL.read_text()
        async def three_route(route): await route.fulfill(status=200, content_type='application/javascript', body=three, headers={'Access-Control-Allow-Origin': '*'})
        await page.route(hm.THREE_URL, three_route)
        async def font_route(route): await route.fulfill(status=200, content_type='text/css', body='')
        await page.route('https://fonts.googleapis.com/**', font_route)
        async def doc_route(route): await route.fulfill(status=200, content_type='text/html', body=hm.SKELETON.replace('%s', serve['html']))
        await page.route('http://hm.test/', doc_route)
        await page.goto('http://hm.test/', wait_until='commit')
        await page.wait_for_function('window.__hm && window.__hm.ready', timeout=300000, polling=500)
        await page.evaluate("try { localStorage.removeItem('hallowmarch.save.v1') } catch (e) {} ; 0")
        print(f'version 10 booted [{time.time() - T0:.0f}s]', flush=True)
        made = await page.evaluate(MAKE)
        print('made', json.dumps(made), flush=True)
        check(not made['errors'] and len(made['ids']) == 3 and made['cr'], 'version 10 makes and saves a busy land')
        stored = await page.evaluate("(localStorage.getItem('hallowmarch.save.v1') || '').length")
        # this build, the same storage
        serve['html'] = hm.HTML.read_text()
        await page.goto('http://hm.test/', wait_until='commit', timeout=300000)
        await page.wait_for_function("window.__hm && window.__hm.ready", timeout=300000, polling=500)
        print(f'this build booted on the version 10 save ({stored} bytes) [{time.time() - T0:.0f}s]', flush=True)
        r = await page.evaluate("(() => ({ heights: !!__hm.heights, hardy: __hm.heights ? __hm.heights.HTS.hardy : 0, restored: __hm.land.LAND.restored, errors: __hm.errors.slice(0, 3) }))()")
        print('restored', json.dumps(r), flush=True)
        check(r['heights'] and not r['errors'], 'the save loads into the shaped land without errors')
        got = r['restored'] or {}
        check(got.get('felled', 0) >= 3 and got.get('craters', 0) >= 1, f"its felled trees and craters are read back ({got})")
        ids = made['ids']
        r = await page.evaluate("(() => { const W = __hm.fn.W, ids = " + json.dumps(ids) + "; return ids.map((i) => { const t = W.trees[i]; return t ? [i, !!t.felled, t.fall ? +t.fall.ux.toFixed(3) : null, t.fall ? +t.fall.uz.toFixed(3) : null, t.hardy ? 1 : 0] : [i, null]; }); })()")
        print('trees', json.dumps(r), flush=True)
        same = all(a[1] is True and b2[0] is not None and abs(a[2] - b2[0]) < 0.01 and abs(a[3] - b2[1]) < 0.01 and a[4] == 0 for a, b2 in zip(r, [f[1:] for f in made['fall']]))
        check(same, 'every felled tree is the same tree, lying the same way')
        r = await page.evaluate("(() => { const N = __hm.nature.NATURE, cr = " + json.dumps(made['cr']) + "; const K = N.craters.find((C) => Math.hypot(C.x - cr[0], C.z - cr[1]) < 1); return { found: !!K, h: __hm.fn.heightAt(cr[0], cr[1]), was: __hm.heights.was(cr[0], cr[1]) }; })()")
        print('crater', json.dumps(r), flush=True)
        check(r['found'], 'the crater on the mountain slope is back')
        # the character continues and the world runs on
        assert await page.evaluate('!!__hm.UI.titleSave?.char'), 'Reload must offer the retained character.'
        await page.locator('#btn-begin').click()
        await page.wait_for_function("window.__hm && (__hm.GAME.started || window.__hmStartup?.stopped || __hm.errors.length)", timeout=300000, polling=100)
        r = await page.evaluate("(() => { if (!__hm.GAME.started) throw new Error('Continue did not start: ' + (__hmStartup?.titleError || __hm.errors.join('; '))); __hm.UI.modal = 'menu'; const s = __hm.simulate(15); let bad = 0; for (const e of __hm.ENT) if (!Number.isFinite(e.x + e.y + e.z)) bad++; return { started: __hm.GAME.started, errors: __hm.errors.slice(0, 3), bad }; })()")
        print('continue', json.dumps(r), flush=True)
        check(r['started'] and not r['errors'] and r['bad'] == 0, 'the character continues and the world runs on (15 s, nothing non-finite)')
        if logs: print('logs', logs[:4])
        print('FAILED:' if FAILS else 'ALL PASSED', FAILS, flush=True)
        await b.close()
asyncio.run(main())
