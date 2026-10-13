"""Performance: draw calls, triangles, programs and JS time in fixed views at high, medium and low.
Views: the Logres town with its fields and common, a keep courtyard, inside its great hall, a river, a frontier battle
with the war running, a forest, the Barrow, the mountains from the Logres orchard ([land]); [perf2] a Thule burh on fire
stormed by a band (siege), the Logres town with three houses burning and its crews at them (townfire), a house in rubble and
one behind its scaffold (rubble), a breached tower mended by the masons (masons). For each view and quality: calls and triangles (main pass, shadow pass),
the top meshes by triangles (instances x triangles each) and the JS cost of a frame; then the JS cost of a
simulation step and the top systems by JS time (every update and draw function timed); then the boot.
usage: python3 tools/tests/perf.py [high|medium|low ...] [views=town,keep,...] [tag=before] [rows=8] [w=640] [h=360] [js|render] [settle=16] [budget] [seed] [audio] [war=MIN]
(budget: [perf2] fails when a view goes over its budget, BUDGET below; [war3] budget and seed: the same war each run, Math.random seeded and the page's own frames held)
(js: only the JS costs; render: only the draw counts; shots [shotq=low,medium]: a picture of each view; audio: a click
first, so the sound runs: without a gesture there is no AudioContext and updateAudio does nothing)
Writes tools/out/perf_<tag>.json and prints a table."""
import asyncio, json, sys, time, pathlib
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
from hmlib import setup, OUT
from playwright.async_api import async_playwright

ARGS = sys.argv[1:]
QUALS = [a for a in ARGS if a in ('high', 'medium', 'low')] or ['low', 'medium', 'high']
OPT = dict(a.split('=', 1) for a in ARGS if '=' in a)
VIEWS = OPT.get('views', 'town,keep,hall,river,battle,forest,barrow,mountain,siege,townfire,rubble,masons').split(',') # [perf2] the newest systems' views: a burning burh stormed, a town's fire crews, rubble and a scaffold, the masons
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
    } else if (name === 'siege') {
      // [perf2] a Thule burh on fire (its palisade, walk and gate), its garrison at the fires, a Logres band of ten storming it
      const WAR = H.WAR, K = WAR.keeps.find((k) => k.orig === 2 && k.realm === 2) || WAR.keeps.find((k) => k.orig === 2), C = F.castleOf(K.site);
      if (!this.siegeSet) {
        this.siegeSet = true;
        H.palisade.palisadeInit(); H.blaze.blazeInit();
        const pc = C.pal ? C.pal.cells.filter((c) => c.st === 0) : [], dc = C.blaze ? C.blaze.cells.filter((c) => c.st === 0) : [];
        for (let i = 0; i < 4 && pc.length; i++) H.palisade.palisadeIgnite(pc[Math.floor((i + 0.5) * pc.length / 4)], 0.5);
        for (let i = 0; i < 3 && dc.length; i++) H.blaze.deckIgnite(dc[Math.floor((i + 0.5) * dc.length / 3)], 0.5);
        if (C.gate) H.blaze.gateIgnite(C.gate, 0.4);
        this.siegeBand = H.SIEGE.band(0, WAR.keeps.indexOf(K), 40, 10);
        H.simulate(6);
      }
      const wb = WAR.warbands.find((w) => w.id === this.siegeBand), L = wb && !wb.dead ? F.wbLeader(wb) : null, S = K.site;
      const bx = L ? L.x : S.x + Math.sin(Math.atan2(S.x, S.z)) * 40, bz = L ? L.z : S.z + Math.cos(Math.atan2(S.x, S.z)) * 40;
      const dx = S.x - bx, dz = S.z - bz, d = Math.hypot(dx, dz) || 1;
      this.stand(bx - dx / d * 10, bz - dz / d * 10, Math.atan2(dx, dz), 0.16, 8);
    } else if (name === 'townfire') {
      // [perf2] the Logres town with three houses on fire and their people beating them out
      const S = H.REALMS[0].town;
      if (!this.fireSet) {
        this.fireSet = true;
        const hs = H.HOUSES.filter((h) => !h.keepHall && h.S === S && h.state === 'whole').sort((a, b) => Math.hypot(a.x - S.x, a.z - S.z) - Math.hypot(b.x - S.x, b.z - S.z));
        this.fireHouses = [hs[1], hs[4], hs[7]].filter(Boolean);
        for (const h of this.fireHouses) F.igniteHouse(h);
        H.simulate(6);
      }
      const h = this.fireHouses[0];
      this.stand(S.x + (h.x - S.x) * 0.35 + 5, S.z + (h.z - S.z) * 0.35 + 5, Math.atan2(h.x - S.x, h.z - S.z), 0.2, 8);
    } else if (name === 'rubble') {
      // [perf2] a house of the Logres town brought down by stones, and another being built back behind its scaffold
      const S = H.REALMS[0].town;
      if (!this.rubbleSet) {
        this.rubbleSet = true;
        // (the town's whole houses: the townfire view sets three of them alight before it)
        const hs = H.HOUSES.filter((h) => !h.keepHall && h.S === S && h.state === 'whole').sort((a, b) => Math.hypot(a.x - S.x, a.z - S.z) - Math.hypot(b.x - S.x, b.z - S.z));
        this.ruin = hs[Math.min(2, hs.length - 2)]; this.scaf = hs[Math.min(5, hs.length - 1)];
        H.batter.houseBreak(this.ruin, null); H.batter.houseBreak(this.scaf, null);
        H.simulate(2.5);
        if (this.scaf.state === 'ruin') { this.scaf.stT = 1e4; H.simulate(0.3); }
        if (this.scaf.state === 'scaffold') this.scaf.stT = Math.max(this.scaf.stT, 22);
        H.simulate(0.5);
      }
      const A = this.ruin, B = this.scaf, mx = (A.x + B.x) / 2, mz = (A.z + B.z) / 2, dx = mx - S.x, dz = mz - S.z, d = Math.hypot(dx, dz) || 1;
      this.stand(mx - dx / d * 9, mz - dz / d * 9, Math.atan2(dx, dz), 0.25, 9);
    } else if (name === 'masons') {
      // [perf2] a Logres corner tower brought down by stones and mended behind its scaffold, the keep's masons at work on it
      const S = H.REALMS[0].keepSites[0], C = F.castles().find((q) => q.S === S), K = S.keepRef;
      const W = C.sections.find((q) => q.kind === 'tower' && q.T.role === 'corner' && q.T.sx === -1 && q.T.sz === -1), T = W.T;
      if (!this.masonSet) {
        this.masonSet = true;
        if (W.state === 'whole') {
          const src = F.spawnRealmUnit(2, 'warrior', 30, 'guard', S.x + W.ox * 60, S.z + W.oz * 60, {}); src.hp = src.maxHp = 1e9;
          for (let n = 0; W.state === 'whole' && n < 80; n++) F.castleSiegeHit(src, T.wx + W.ox * (T.RO + 0.2), T.wz + W.oz * (T.RO + 0.2), 2.0, 4.4);
          F.removeEnt(src);
        }
        const L3 = H.look3, mine = () => L3.MASON.list.filter((e) => !e.removed && e.ai.mason && e.ai.mason.W === W);
        for (let t = 0; t < 160 && !(mine().length >= 2 && mine().every((e) => e.ai.mason.st === 'work')); t++) { K.lastEnemyNear = -1e9; H.simulate(1); if (W.state === 'repair' && W.t > 0.6) W.t = 0.4; }
        this.masonsN = mine().length;
      }
      K.lastEnemyNear = -1e9;
      const a = Math.atan2(W.ox, W.oz), x = T.wx + Math.sin(a) * (T.RO + 12), z = T.wz + Math.cos(a) * (T.RO + 12);
      this.stand(x, z, a + Math.PI, 0.3, 8);
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

# [perf2] the budgets (CLAUDE.md, Phones and performance): triangles and draw calls a frame, both passes, in every view;
# `budget` fails the run when a view goes over (low about 700k and 160 calls, medium about 1.6 million: a tenth more is
# let by, so a view that comes and goes with the war's bodies does not fail one run in three)
BUDGET = {'low': (770e3, 176), 'medium': (1.76e6, 240), 'high': (2.9e6, 290)}

# [war3] `budget` (and `seed`) measures the same war each time: Math.random seeded before the page's own script, and the
# page's own frames held once it is up, so the war unfolds only by the steps simulated and the frames drawn here (a
# war fifteen minutes on drew far more where it fought, one run in three over the budget: CLAUDE.md, row 57's left)
SEED = 'budget' in ARGS or 'seed' in ARGS
HOLD = """(() => { let s = 1234567; Math.random = () => { s |= 0; s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; })();
(() => { window.__rafHold = false; const raf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = (cb) => raf((t) => { if (window.__rafHold) window.requestAnimationFrame(cb); else cb(t); }); })();"""

def fmt_m(n):
    return f'{n/1e6:.2f}M' if n >= 1e6 else f'{n/1e3:.0f}k'

async def main():
    res = {'tag': TAG, 'views': {}, 'sim': {}, 'systems': [], 'boot': {}}
    async with async_playwright() as p:
        t0 = time.time()
        b, page, logs = await setup(p, touch=False, w=W, h=H, init=HOLD if SEED else None)
        if SEED: await ev(page, "window.__rafHold = true; 0")  # [war3] only the steps and frames asked for from here
        res['boot']['wall'] = round(time.time() - t0, 1)
        res['boot'].update(await ev(page, '__hm.perf.boot()'))
        await ev(page, HELP)
        if 'audio' in ARGS:  # [audio2] a click first, so the sound runs in what is measured (no gesture, no AudioContext: updateAudio does nothing)
            await page.mouse.click(8, 8); await page.wait_for_timeout(1500)
            res['boot']['audio'] = await ev(page, "__hm.fn.AUDIO.ctx ? __hm.fn.AUDIO.ctx.state : 'none'")
        await ev(page, "__hm.start({realm:0, cls:'warrior', level:30}); PV.calm(); __hm.setTod(0.55); 0")
        # let the war get going and the town wake up
        await ev(page, "__hm.simulate(40); 0")
        # [war4] war=MIN: the war MIN minutes on (its engines, wrecks, scaffolds and fires where it fought), the player kept
        # in town and whole meanwhile (the seeded war is the same each run: compare builds with the same MIN)
        for m in range(int(OPT.get('war', 0))):
            await ev(page, "(() => { const P = __hm.GAME.player, S = __hm.REALMS[P.faction].town; for (let i = 0; i < 30; i++) { P.x = P.prevX = S.x + 3; P.z = P.prevZ = S.z + 3; P.y = __hm.fn.heightAt(P.x, P.z); P.hp = P.maxHp; P.alive = true; __hm.simulate(2); } return 0; })()")
        if OPT.get('war'): print(f"the war {OPT['war']} minutes on: {await ev(page, 'JSON.stringify(__hm.CW.state().keeps)')} keeps, {await ev(page, '__hm.SIEGE.SIEGE.engines.filter((q) => !q.gone).length')} engines in the field", flush=True)
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
        # [perf2] every view within its budget
        over = []
        for v, qs in res['views'].items():
            for q, r in qs.items():
                bt, bc = BUDGET[q]
                if r['tris'] > bt or r['calls'] > bc: over.append(f"{q} {v}: {fmt_m(r['tris'])} triangles (budget {fmt_m(bt)}), {r['calls']} calls (budget {bc})")
        res['over'] = over
        if 'budget' in ARGS:
            for o in over: print('OVER BUDGET', o, flush=True)
            print('budget: ' + ('every view within its budget' if not over else f'{len(over)} over'), flush=True)
        res['errors'] = await ev(page, "__hm.errors")
        res['heap'] = await ev(page, "performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null")
        print('boot', json.dumps(res['boot']), 'heap now', res['heap'], 'MB')
        print('errors', res['errors'])
        await b.close()
    pathlib.Path(OUT + f'perf_{TAG}.json').write_text(json.dumps(res, indent=1))
    if 'budget' in ARGS and (res.get('over') or res.get('errors')): sys.exit(1)

asyncio.run(main())
