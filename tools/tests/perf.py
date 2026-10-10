"""Performance: draw calls, triangles, programs and JS time in fixed views at high, medium and low.
Views: the Logres town with its fields and common, a keep courtyard, inside its great hall, a river, a frontier battle
with the war running, a forest, the Barrow, the mountains from the Logres orchard ([land]). For each view and quality: calls and triangles (main pass, shadow pass),
the top meshes by triangles (instances x triangles each) and the JS cost of a frame; then the JS cost of a
simulation step and the top systems by JS time (every update and draw function timed); then the boot.
usage: python3 tools/tests/perf.py [high|medium|low ...] [views=town,keep,...] [tag=before] [rows=8] [w=640] [h=360] [js|render] [settle=16]
(js: only the JS costs; render: only the draw counts; shots [shotq=low,medium]: a picture of each view)
Writes tools/out/perf_<tag>.json and prints a table."""
import asyncio, json, sys, time, pathlib
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
from hmlib import setup, OUT
from playwright.async_api import async_playwright

ARGS = sys.argv[1:]
QUALS = [a for a in ARGS if a in ('high', 'medium', 'low')] or ['low', 'medium', 'high']
OPT = dict(a.split('=', 1) for a in ARGS if '=' in a)
VIEWS = OPT.get('views', 'town,keep,hall,river,battle,forest,barrow,mountain').split(',')
TAG = OPT.get('tag', 'run')
ROWS = int(OPT.get('rows', 8))
W, H = int(OPT.get('w', 640)), int(OPT.get('h', 360))

HELP = r"""
window.PV = {
  H: window.__hm,
  calm() { const H = this.H, P = H.GAME.player; P.hp = P.maxHp = 1e7; P.buffs.length = 0; P.casting = null; },
  stand(x, z, yaw, pitch = 0.22, dist = 7) { const H = this.H, P = H.GAME.player; H.teleport(x, z); P.yaw = yaw; H.CAM.mode = 'play'; H.UI.modal = null; H.look(yaw, pitch, dist); this.calm(); },
  view(name) {
    const H = this.H, F = H.fn, pf = H.perf, P = H.GAME.player, R0 = H.REALMS[0];
    if (H.INDOOR.on && name !== 'barrow') { F.setIndoor(false); }
    const town = pf.SITES.find((s) => s.kind === 'town' && s.realm === 0);
    if (name === 'town') {
      // from the edge of the fields, looking over them and the common into the town
      const fr = (F.W.fieldRects || []).slice().sort((a, b) => Math.hypot(a.x - town.x, a.z - town.z) - Math.hypot(b.x - town.x, b.z - town.z))[0];
      const dx = town.x - fr.x, dz = town.z - fr.z, d = Math.hypot(dx, dz) || 1;
      const sx = fr.x - dx / d * 10, sz = fr.z - dz / d * 10;
      this.stand(sx, sz, Math.atan2(dx, dz));
    } else if (name === 'keep') {
      const k = pf.SITES.find((s) => s.kind === 'keep' && s.realm === 0);
      this.stand(k.x + 3, k.z + 3, Math.atan2(-k.x, -k.z));
    } else if (name === 'hall') {
      const h = F.halls().find((q) => q.realm === 0), sp = h.hallSpots.table;
      this.stand(sp.x + (h.x - sp.x) * 0.3, sp.z + (h.z - sp.z) * 0.3, Math.atan2(sp.x - h.x, sp.z - h.z) + Math.PI, 0.3, 5);
      P.y = F.floorAt ? F.floorAt(P.x, P.z, P.y + 0.3) : P.y;
    } else if (name === 'river') {
      const Rv = pf.RIVERS.find((r) => r.realm === 0) || pf.RIVERS[0], pts = Rv.pts, i = Math.floor(pts.length * 0.55), a = pts[i], b = pts[i + 1];
      const tx = b.x - a.x, tz = b.z - a.z, l = Math.hypot(tx, tz) || 1, nx = -tz / l, nz = tx / l, hw = (a.hw || a.w || 4);
      this.stand(a.x + nx * (hw + 5), a.z + nz * (hw + 5), Math.atan2(-nx * 0.6 + tx / l, -nz * 0.6 + tz / l));
    } else if (name === 'battle') {
      // the biggest fight of the war: the soldier with the most foes and friends about
      let best = null, bn = -1;
      for (const e of H.ENT) {
        if (!e.alive || (e.role !== 'soldier' && e.role !== 'guard') || !(e.combatUntil > H.GAME.t)) continue;
        let n = 0; for (const o of H.ENT) if (o.alive && o.kind !== 'door' && Math.abs(o.x - e.x) < 25 && Math.abs(o.z - e.z) < 25) n++;
        if (n > bn) { bn = n; best = e; }
      }
      if (!best) best = H.ENT.find((e) => e.alive && e.role === 'soldier');
      const a = Math.atan2(best.x, best.z);
      this.stand(best.x + Math.sin(a) * 14, best.z + Math.cos(a) * 14, a + Math.PI);
      this.battleN = bn;
    } else if (name === 'forest') {
      let best = null, bv = -1;
      for (let x = -440; x <= 440; x += 16) for (let z = -440; z <= 440; z += 16) {
        if (!F.isWalkable(x, z) || pf.SITES.some((s) => Math.hypot(s.x - x, s.z - z) < (s.r || 20) + 30)) continue;
        let v = 0; for (let k = 0; k < 9; k++) v += H.visual.canopy(x + (k % 3 - 1) * 8, z + (Math.floor(k / 3) - 1) * 8);
        if (v > bv) { bv = v; best = { x, z }; }
      }
      this.stand(best.x, best.z, 0.7);
    } else if (name === 'mountain') {
      // [land] from the Logres orchard, under the ring's mountains (crags, scree, the reshaped faces)
      const o = H.surv.FORAGE.orchard; this.stand(o.x, o.z, Math.atan2(95 - o.x, 234 - o.z), 0.05, 6);
    } else if (name === 'barrow') {
      const p = H.DUN.spots.arrive;
      P.x = P.prevX = p.x; P.z = P.prevZ = p.z; P.y = F.dunFloorAt(p.x, p.z); P.yaw = Math.PI / 2;
      F.setIndoor(true); H.CAM.mode = 'play'; H.UI.modal = null; H.look(Math.PI / 2, 0.3, 6); this.calm();
    }
    return 0;
  },
};
0;
"""

async def ev(page, js):
    return await page.evaluate(js)

def fmt_m(n):
    return f'{n/1e6:.2f}M' if n >= 1e6 else f'{n/1e3:.0f}k'

async def main():
    res = {'tag': TAG, 'views': {}, 'sim': {}, 'systems': [], 'boot': {}}
    async with async_playwright() as p:
        t0 = time.time()
        b, page, logs = await setup(p, touch=False, w=W, h=H)
        res['boot']['wall'] = round(time.time() - t0, 1)
        res['boot'].update(await ev(page, '__hm.perf.boot()'))
        await ev(page, HELP)
        await ev(page, "__hm.start({realm:0, cls:'warrior', level:30}); PV.calm(); __hm.setTod(0.55); 0")
        # let the war get going and the town wake up
        await ev(page, "__hm.simulate(40); 0")
        for q in (QUALS if 'js' not in ARGS else []):
            await ev(page, f"__hm.fn.setQuality('{q}'); 0")
            for v in VIEWS:
                await ev(page, f"PV.view('{v}'); __hm.simulate(0.3); __hm.frame(); for (let i = 0; i < {int(OPT.get('settle', 0))}; i++) __hm.frame(); 0")  # [motion] settle=N: N more frames so the levels of detail settle
                r = await ev(page, "(() => { const f = __hm.perf.frame(); return f; })()")
                r['frameMs'] = r['ms']
                if 'shots' in ARGS and q in OPT.get('shotq', 'low').split(','):
                    await ev(page, "__hm.frame(); 0")
                    await page.screenshot(path=OUT + f'perf_{TAG}_{q}_{v}.png', timeout=300000)
                r['rows'] = r['rows'][:ROWS * 2]
                res['views'].setdefault(v, {})[q] = r
                print(f"{q:6s} {v:7s} calls {r['calls']:4d} (main {r['main']['calls']:4d} shadow {r['shadow']['calls']:3d})  tris {fmt_m(r['tris']):>7s} (main {fmt_m(r['main']['tris'])}, shadow {fmt_m(r['shadow']['tris'])})  programs {r['programs']}  frame JS {r['frameMs']} ms", flush=True)
                for row in r['rows'][:ROWS]:
                    print(f"         {row['pass']:6s} {row['label'][:44]:44s} {row['calls']:3d} calls {fmt_m(row['tris']):>7s}  ({row['inst']} x {row['each']})")
        # the JS cost of the simulation and of the frame, by system (at low: SwiftShader's frames at high take minutes)
        await ev(page, "__hm.fn.setQuality('low'); __hm.perf.timers(); 0")
        for v in (VIEWS if 'render' not in ARGS else []):
            if v == 'barrow': continue
            await ev(page, f"PV.view('{v}'); __hm.simulate(0.5); __hm.perf.times(true); 0")
            r = await ev(page, "(() => { const t = performance.now(); __hm.simulate(4); const s = performance.now() - t; const t2 = performance.now(); for (let i = 0; i < 6; i++) __hm.frame(); const f = performance.now() - t2; return { stepMs: +(s / 80).toFixed(2), frameMs: +(f / 6).toFixed(1), top: __hm.perf.times(true).slice(0, 14) }; })()")
            res['sim'][v] = r
            print(f"JS {v:7s} step {r['stepMs']} ms (simulate 0.05 s), frame {r['frameMs']} ms;  top: " + ', '.join(f"{t['k']} {t['ms']:.1f}" for t in r['top'][:9]), flush=True)
        # a sampling profile of the simulation in the town (self time by function)
        if 'profile' in ARGS:
            cdp = await page.context.new_cdp_session(page)
            await ev(page, "__hm.fn.setQuality('low'); PV.view('town'); __hm.simulate(1); 0")
            await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', {'interval': 200})
            await cdp.send('Profiler.start')
            await ev(page, "__hm.simulate(12); for (let i = 0; i < 4; i++) __hm.frame(); 0")
            prof = (await cdp.send('Profiler.stop'))['profile']
            nodes = {n['id']: n for n in prof['nodes']}
            self_t = {}
            dts = prof.get('timeDeltas', [])
            for sid, dt in zip(prof.get('samples', []), dts):
                fn = nodes[sid]['callFrame']['functionName'] or '(anon)'
                self_t[fn] = self_t.get(fn, 0) + dt
            tot = sum(self_t.values()) or 1
            top = sorted(self_t.items(), key=lambda kv: -kv[1])[:30]
            res['profile'] = [(k, round(v / 1000, 1)) for k, v in top]
            print('profile (self ms over 12 s simulated + 4 frames, total %.0f ms): ' % (tot / 1000) + ', '.join(f"{k} {v/1000:.0f}" for k, v in top), flush=True)
        res['errors'] = await ev(page, "__hm.errors")
        res['heap'] = await ev(page, "performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null")
        print('boot', json.dumps(res['boot']), 'heap now', res['heap'], 'MB')
        print('errors', res['errors'])
        await b.close()
    pathlib.Path(OUT + f'perf_{TAG}.json').write_text(json.dumps(res, indent=1))

asyncio.run(main())
