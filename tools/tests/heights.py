"""[heights] The mountains shaped from everywhere (03d_heights.js): numbers through window.__hm, and screenshots.
usage: python3 tools/tests/heights.py
Checks: the shaping ran and how long it took; the land before it is version 10's (mountains_base.json); nothing changed
where anything is built or anyone goes (roads, sites, camps, water: heights read on them are exactly as they were);
what anyone could reach is as walkable as it was and nothing new opens; the skyline along the ring's crest has more
peaks and notches than before; every tree, rock, plant and herb stands on the ground (settled); the hardy trees
(after every tree there was): enough of them, on walkable mountain ground, none above the snow line, in water, in a
collider or on a road; the outcrops on the walkable lower slopes: enough, each with its collider, none by a road, in water, floating or on a tree, plant or herb; one tree is felled and falls, one burns, both grow back; the canopy map shades the ground under
them; snow lies on the new high ground in a Thule winter; no runtime errors. (Screenshots: mountains.py, whose views
include the range from a keep across the frontier, the towns and the hardy trees.)"""
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
def opt(name, default=None):
    for a in ARGS:
        if a.startswith(name + '='): return a.split('=', 1)[1]
    return default
FLAGS = {a for a in ARGS if '=' not in a}
Q = opt('q', 'high')
T0 = time.time()
FAILS = []
def check(cond, what):
    print(('  ok   ' if cond else '  FAIL ') + what, flush=True)
    if not cond: FAILS.append(what)
BASE = json.loads((pathlib.Path(__file__).resolve().parent / 'mountains_base.json').read_text())

HOLD = """(() => { let s = 1234567; Math.random = () => { s |= 0; s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; })();
(() => { window.__rafHold = false; const raf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = (cb) => raf((t) => { if (window.__rafHold) window.requestAnimationFrame(cb); else cb(t); }); })();"""

CHECKS = r"""(() => { const F = __hm.fn, W = F.W, T = __hm.heights, H = T.HTS, HN = 513, N2 = HN * HN, out = { stats: T.stats() };
  const at = (A, x, z) => F.sampleGrid(A, x, z);
  // the land before the shaping is version 10's: the same checksums mountains.py takes
  let hw = 0, hh = 0; const walk = H.walk0, H0 = H.H0;
  const near = (k) => { const i = k % HN, j = (k / HN) | 0; for (let dj = -2; dj <= 2; dj++) for (let di = -2; di <= 2; di++) { const ii = i + di, jj = j + dj; if (ii < 0 || jj < 0 || ii >= HN || jj >= HN) continue; if (walk[jj * HN + ii] !== 1) return true; } return false; };
  for (let k = 0; k < N2; k++) { hw = (hw * 31 + walk[k]) % 1000000007; if (near(k)) hh = (hh * 131 + Math.round(H0[k] * 100) + 7) % 1000000007; }
  out.base = { walkSum: hw, walkHeights: hh };
  // nothing changed where anything is built or anyone goes
  let roadOff = 0, roadN = 0;
  for (const S of W.roads) for (let t = 0; t <= 1; t += 0.02) { const x = S.ax + (S.bx - S.ax) * t, z = S.az + (S.bz - S.az) * t; roadN++; if (Math.abs(F.heightAt(x, z) - at(H0, x, z)) > 1e-4) roadOff++; }
  let siteOff = 0; for (const R of __hm.REALMS) for (const S of [R.town, R.musterSite, R.templeSite, ...R.keepSites]) for (let a = 0; a < 6.28; a += 0.4) for (const f of [0, 0.5, 1]) { const x = S.x + Math.sin(a) * S.r * f, z = S.z + Math.cos(a) * S.r * f; if (Math.abs(F.heightAt(x, z) - at(H0, x, z)) > 1e-4) siteOff++; }
  let campOff = 0; for (const c of W.camps) for (let a = 0; a < 6.28; a += 0.5) for (const f of [0, 0.5, 1]) { const x = c.x + Math.sin(a) * c.r * f, z = c.z + Math.cos(a) * c.r * f; if (Math.abs(F.heightAt(x, z) - at(H0, x, z)) > 1e-4) campOff++; }
  let wetOff = 0; for (let k = 0; k < N2; k++) { const x = -512 + (k % HN) * 2, z = -512 + ((k / HN) | 0) * 2; if (__hm.water.waterAt(x, z) && W.H[k] !== H0[k]) wetOff++; }
  out.kept = { roadN, roadOff, siteOff, campOff, wetOff };
  // what anyone could reach
  let lost = 0, opened = 0, reach = 0; for (let k = 0; k < N2; k++) { if (H.reach[k]) { reach++; if (W.walk[k] !== H.walk0[k]) lost++; } if (H.walk0[k] === 1 && W.walk[k] !== 1) opened++; }
  out.walk = { reach, lost, opened, blocked: H.walkLost };
  // the ring's crest: peaks along it (local maxima standing 5 m over the lowest point on either side before the next
  // higher one), and the notches, before and after
  const crest = (A) => { const prof = []; for (let a = 0; a < 6.2832; a += 0.004) { let best = -1e9; for (let r = 226; r <= 274; r += 2) { const x = Math.sin(a) * r, z = -Math.cos(a) * r; best = Math.max(best, at(A, x, z)); } prof.push(best); }
    let peaks = 0, rough = 0; const n = prof.length;
    for (let i = 0; i < n; i++) { const h = prof[i]; rough += Math.abs(prof[(i + 1) % n] - h); let l = 1e9, r = 1e9, okL = false, okR = false;
      for (let d = 1; d < 120; d++) { const v = prof[(i - d + n) % n]; if (v > h) { okL = true; break; } l = Math.min(l, v); }
      for (let d = 1; d < 120; d++) { const v = prof[(i + d) % n]; if (v > h) { okR = true; break; } r = Math.min(r, v); }
      if (h > 20 && h - l > 5 && h - r > 5 && (prof[(i - 1 + n) % n] <= h && prof[(i + 1) % n] < h)) peaks++; }
    return { peaks, rough: Math.round(rough), max: Math.round(Math.max(...prof)) }; };
  out.crest = { before: crest(H0), after: crest(W.H) };
  // every tree, rock, plant and herb stands on the ground
  let tOff = 0; for (const t of W.trees) if (Math.abs(t.y - F.heightAt(t.x, t.z)) > 0.05 && !t.felled) tOff++;
  let rOff = 0; for (const r of W.rocks) if (Math.abs(r.y - F.heightAt(r.x, r.z)) > 0.05) rOff++;
  let pOff = 0; for (const p of __hm.surv.FORAGE.list) if (Math.abs(p.y - F.heightAt(p.x, p.z)) > 0.05) pOff++;
  let hOff = 0; for (const h of __hm.farm.FARM.herbs) if (Math.abs(h.y - F.heightAt(h.x, h.z)) > 0.05) hOff++;
  out.settled = { tOff, rOff, pOff, hOff };
  // the hardy trees
  const hard = W.trees.filter((t) => t.hardy);
  let walkBad = 0, high = 0, wet = 0, inColl = 0, onRoad = 0, idx = 0, state = 0, chunk = 0, kinds = {};
  const C = __hm.build.COLL;
  for (const t of hard) {
    kinds[t.kind] = (kinds[t.kind] || 0) + 1;
    if (!F.isWalkable(t.x, t.z)) walkBad++;
    const th = F.realmWeightsAt ? F.realmWeightsAt(t.x, t.z)[2] : 0;
    if (t.y > (th > 0.5 ? 31 : 47)) high++;
    if (__hm.water.waterAt(t.x, t.z)) wet++;
    if (F.sampleGrid(W.road, t.x, t.z) > 0.05) onRoad++;
    for (const c of C.circles) if (c !== t.coll && c.active && c.tag !== 'tree' && Math.hypot(c.x - t.x, c.z - t.z) < c.r + 0.6) { inColl++; break; }
    if (t.i < T.HTS.trees0) idx++;
    if (t.state === 'stand' && t.hp > 0 && t.s0 === t.s && t.coll) state++;
    if (t.chunk) chunk++;
  }
  out.hardy = { n: hard.length, kinds, walkBad, high, wet, inColl, onRoad, idxBad: idx, state, chunk, first: hard.length ? hard[0].i : -1, trees0: T.HTS.trees0, trees: W.trees.length };
  // the outcrops on the walkable lower slopes
  const oc = __hm.mtn.MTN.crags.filter((c) => c.outcrop);
  let ocColl = 0, ocRoad = 0, ocWet = 0, ocFloat = 0, ocNear = 0;
  for (const c of oc) {
    if (c.coll && c.coll.active && c.coll.tag === 'rock') ocColl++;
    if (W.roads.some((R) => { const ex = R.bx - R.ax, ez = R.bz - R.az, t = Math.max(0, Math.min(1, ((c.x - R.ax) * ex + (c.z - R.az) * ez) / (ex * ex + ez * ez || 1))); return Math.hypot(c.x - R.ax - ex * t, c.z - R.az - ez * t) < R.w + 6; })) ocRoad++;
    let wet = false, flo = false;
    for (let a = 0; a < 6.28; a += 0.4) for (const f of [0.4, 0.8, 1]) { const x = c.x + Math.sin(a) * c.r * f, z = c.z + Math.cos(a) * c.r * f; if (__hm.water.waterAt(x, z)) wet = true; if (F.heightAt(x, z) < c.y0 + 0.3) flo = true; }
    if (wet) ocWet++; if (flo) ocFloat++;
    if (W.trees.some((t) => Math.hypot(t.x - c.x, t.z - c.z) < c.r * 0.8) || __hm.surv.FORAGE.list.some((p) => Math.hypot(p.x - c.x, p.z - c.z) < c.r) || __hm.farm.FARM.herbs.some((h) => Math.hypot(h.x - c.x, h.z - c.z) < c.r)) ocNear++;
  }
  out.outcrops = { n: oc.length, coll: ocColl, road: ocRoad, wet: ocWet, float: ocFloat, near: ocNear };
  return out; })()"""

async def main():
    async with async_playwright() as p:
        w, h = (640, 360) if 'small' in FLAGS else (960, 540)
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
        await page.wait_for_function('window.__hm && window.__hm.ready', timeout=300000, polling=500)
        print(f'booted [{time.time() - T0:.0f}s]', flush=True)
        await page.evaluate("(async () => { await __hm.start({realm:0, cls:'warrior', level:30}); return 0; })()")
        await page.evaluate("(() => { const P = __hm.GAME.player, S = __hm.REALMS[0].town; P.x = P.prevX = S.x; P.z = P.prevZ = S.z; P.hp = P.maxHp; document.getElementById('hud').hidden = true; return 0; })()")
        if True:
            r = await page.evaluate(CHECKS)
            print('checks', json.dumps(r)[:3000], flush=True)
            st = r['stats']
            check(st['ms'] < 12000, f"the shaping runs at boot in {st['ms']} ms")
            check(r['base']['walkSum'] == BASE['walkSum'] and r['base']['walkHeights'] == BASE['walkHeights'], 'the land before the shaping is version 10\'s (walk mask and heights round all walkable ground)')
            k = r['kept']
            check(k['roadOff'] == 0, f"every road's heights are as they were ({k['roadOff']} of {k['roadN']} points moved)")
            check(k['siteOff'] == 0 and k['campOff'] == 0, f"every site and camp stands on the ground it had ({k['siteOff']}, {k['campOff']})")
            check(k['wetOff'] == 0, f"no water's ground moved ({k['wetOff']})")
            wk = r['walk']
            check(wk['lost'] == 0 and wk['opened'] == 0, f"all {wk['reach']} texels anyone could reach are as walkable as they were, nothing new opens (lost {wk['lost']}, opened {wk['opened']})")
            print(f"  (recorded: {wk['blocked']} texels no one could reach on the faces and crests are too steep to walk now)")
            c = r['crest']
            check(c['after']['peaks'] > c['before']['peaks'] * 1.3, f"the ring's skyline has more peaks and notches ({c['before']['peaks']} -> {c['after']['peaks']} peaks)")
            check(c['after']['rough'] > c['before']['rough'] * 1.3, f"and is more broken ({c['before']['rough']} -> {c['after']['rough']} m of rise and fall along it)")
            s = r['settled']
            check(s['tOff'] == 0 and s['rOff'] == 0, f"every tree and rock stands on the ground ({s['tOff']}, {s['rOff']})")
            check(s['pOff'] == 0 and s['hOff'] == 0, f"every plant and herb stands on the ground ({s['pOff']}, {s['hOff']})")
            hd = r['hardy']
            check(hd['n'] >= 80, f"hardy trees on the mountains' lower slopes ({hd['n']}: {hd['kinds']})")
            check(hd['idxBad'] == 0 and hd['first'] == hd['trees0'], f"added after every tree there was (from index {hd['first']}, {hd['trees0']} before)")
            check(hd['walkBad'] == 0 and hd['wet'] == 0 and hd['onRoad'] == 0 and hd['inColl'] == 0, f"none on blocked ground, in water, on a road or in a collider ({hd['walkBad']}, {hd['wet']}, {hd['onRoad']}, {hd['inColl']})")
            check(hd['high'] == 0, f"none above the snow line ({hd['high']})")
            check(hd['state'] == hd['n'] and hd['chunk'] == hd['n'], 'each has its felling and burning state, collider and chunk instance')
            oc = r['outcrops']
            check(oc['n'] >= 30, f"outcrops on the walkable lower slopes ({oc['n']})")
            check(oc['coll'] == oc['n'], f"each has its collider ({oc['coll']} of {oc['n']})")
            check(oc['road'] == 0 and oc['wet'] == 0 and oc['float'] == 0 and oc['near'] == 0, f"none by a road, in water, floating, or on a tree, plant or herb ({oc['road']}, {oc['wet']}, {oc['float']}, {oc['near']})")
            # one is felled, one burns, both grow back
            r = await page.evaluate("""(() => { const N = __hm.nature, W = __hm.fn.W, hard = W.trees.filter((t) => t.hardy); const a = hard[0], b = hard[Math.floor(hard.length / 2)];
              let blows = 0; while (!a.felled && blows < 40) { N.treeBlow(a, 60, a.x + 2, a.z); blows++; }
              const okB = N.igniteTree(b.i); __hm.simulate(4); const t1 = N.tree(a.i), t2 = N.tree(b.i);
              return { blows, felled: t1.felled, fall: !!t1.fall, fire: t2.fire, char: t2.char, okB, ai: a.i, bi: b.i }; })()""")
            print('fell and burn', json.dumps(r), flush=True)
            check(r['felled'] and r['fall'], f"a hardy tree is chopped down and falls ({r['blows']} blows)")
            check(r['fire'] > 0.3 or r['char'] > 0.1, f"a hardy tree burns (fire {r['fire']:.2f}, char {r['char']:.2f})")
            # the felled one is split into firewood and its stump grows a sapling (as worldstate.py does with a tree)
            r = await page.evaluate(f"""(() => {{ const N = __hm.nature, W = __hm.fn.W, t = W.trees[{r['ai']}]; __hm.simulate(7);
              const F = t.fall; __hm.teleport(t.x + F.ux * 1.6 + F.uz * 1.3, t.z + F.uz * 1.6 - F.ux * 1.3); __hm.simulate(0.1);
              N.natureStartJob('split', t); __hm.simulate(4.5); t.regrowAt = __hm.GAME.t; __hm.simulate(3);
              const b = N.tree({r['bi']}); return {{ a: [!!t.felled, +t.grow.toFixed(2), !!t.log], b: [+b.fire.toFixed(2), +b.char.toFixed(2), +b.leaf.toFixed(2)] }}; }})()""")
            print('regrowth', json.dumps(r), flush=True)
            check(r['a'][0] is False and 0.1 < r['a'][1] < 0.2, f"the felled one is split and its stump grows a sapling ({r['a']})")
            check(r['b'][1] > 0.5, f"the burnt one burns out charred ({r['b']})")
            # canopy, seasons, snow
            r = await page.evaluate("""(() => { const W = __hm.fn.W, hard = W.trees.filter((t) => t.hardy && !t.felled && t.fire < 0.1); __hm.frame(1/30); __hm.dbg.U.uTime.value += 0;
              const V = __hm.visual; const can = V && V.canopy ? hard.slice(0, 20).map((t) => V.canopy(t.x, t.z)) : [];
              return { canopy: can.length ? can.reduce((a, b) => a + b, 0) / can.length : null }; })()""")
            print('canopy', json.dumps(r), flush=True)
            if r['canopy'] is not None: check(r['canopy'] > 0.15, f"the canopy map shades the ground under them ({r['canopy']:.2f})")
            r = await page.evaluate("""(() => { const W = __hm.fn.W; __hm.farm.setSeason(0.875); __hm.seasons.seasonSettle(); __hm.simulate(2);
              const hard = W.trees.filter((t) => t.hardy); const S = __hm.seasons; let hi = null, hv = -1;
              for (let k = 0; k < 4000; k++) { const a = k * 0.0016, r = 250 + ((k * 37) % 30) - 15, x = Math.sin(a) * r, z = -Math.cos(a) * r; if (__hm.heights.changedAt(x, z) && __hm.fn.realmWeightsAt(x, z)[2] > 0.6) { const h = __hm.fn.heightAt(x, z); if (h > hv) { hv = h; hi = [x, z]; } } }
              const lie = hi ? S.lie(hi[0], hi[1]) : null;
              return { lie, at: hi, h: hv }; })()""")
            print('winter', json.dumps(r), flush=True)
            if r['lie'] is not None: check((r['lie'] if isinstance(r['lie'], (int, float)) else (r['lie'].get('snow', 0) if isinstance(r['lie'], dict) else 0)) > 0.3, f"snow lies on the new high ground in a Thule winter ({r['lie']} at {r['h']:.1f} m)")
            await page.evaluate("__hm.farm.setSeason(0.375); __hm.seasons.seasonSettle(); 0")
        errs = await page.evaluate("__hm.errors")
        check(not errs, 'no runtime errors ' + json.dumps(errs)[:600])
        if logs: print('logs', logs[:4])
        print('FAILED:' if FAILS else 'ALL PASSED', FAILS, flush=True)
        await b.close()
asyncio.run(main())
