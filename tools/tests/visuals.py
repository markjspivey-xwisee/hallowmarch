"""The standard set of views for judging how the world looks, at one quality level:
a town by day, a keep from outside and from its wall walk, a forest edge, a lake, a frontier fight between
warbands, a dusk scene, a night scene and characters up close. Every view comes from a fixed camera in clear
weather, so shots taken before and after a change can be laid side by side.
usage: python3 tools/tests/visuals.py [high|medium|low] [tag] [view,view,...] [small] [nochecks]
  writes tools/out/vis_<tag>_<quality>_<view>.png (tag defaults to 'now'); 'small' renders at 640x360.
  Prints renderInfo() for the town view (draw calls, triangles) and fails on any runtime error. Unless 'nochecks',
  first checks the canopy map (shelter under crowns, let go when felled), the walls' ground shade and beasts' own wetness."""
import json, asyncio, sys, time, pathlib, base64, io
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
import hm
from hmlib import OUT
from playwright.async_api import async_playwright
try:
    from PIL import Image
except ImportError:
    Image = None

ARGS = [a for a in sys.argv[1:]]
QUALITY = next((a for a in ARGS if a in ('high', 'medium', 'low')), 'high')
SMALL = 'small' in ARGS
rest = [a for a in ARGS if a not in ('high', 'medium', 'low', 'small', 'nochecks')]
TAG = rest[0] if rest else 'now'
ONLY = rest[1].split(',') if len(rest) > 1 else None
T0 = time.time()
FAILS = []
def check(cond, what):
    print(('  ok   ' if cond else '  FAIL ') + what, flush=True)
    if not cond: FAILS.append(what)

HELPERS = r"""
window.V = {
  H: __hm, F: __hm.fn,
  dry() { const Wt = this.H.dbg.WEATHER; Wt.mode = 'fixed'; Wt.kind = 'clear'; Wt.raining = 0; Wt.wet = 0; Wt.snowing = 0; Wt.snow = 0; Wt.overcast = 0; Wt.target = 0; Wt.w = 0; this.H.dbg.U.uWet.value = 0; this.H.dbg.U.uSnowCover.value = 0; },
  cam(x, y, z, tx, ty, tz, floor = 1.6) {
    const H = this.H;
    y = Math.max(y, this.F.heightAt(x, z) + floor);
    H.UI.modal = 'menu'; H.CAM.mode = 'fixed';
    H.camera.position.set(x, y, z); H.camera.lookAt(tx, ty, tz); H.camera.updateMatrixWorld();
  },
  keep(realm, k) { return __hm.WAR.keeps.find((K) => K.orig === realm && K.site === __hm.REALMS[realm].keepSites[k]); },
  w(S, lx, lz) { return this.F.siteToWorld ? this.F.siteToWorld(S, lx, lz) : { x: S.x + lx, z: S.z + lz }; },
  findMeadow(cx, cz, clear = 12) {
    const W = this.F.W;
    for (let k = 0; k < 4000; k++) {
      const a = k * 2.4, r = 6 + k * 0.08, x = cx + Math.sin(a) * r, z = cz + Math.cos(a) * r;
      if (!this.F.isWalkable(x, z) || Math.hypot(x, z) > 430) continue;
      if (this.F.sampleGrid(W.grass, x, z) < 0.7 || this.F.sampleGrid(W.road, x, z) > 0.05) continue;
      const hh = this.F.heightAt;
      if (Math.abs(hh(x + 6, z) - hh(x - 6, z)) + Math.abs(hh(x, z + 6) - hh(x, z - 6)) > 1.6) continue;
      if (W.trees.some((t) => Math.abs(t.x - x) < clear && Math.abs(t.z - z) < clear)) continue;
      if (this.H.REALMS.some((R) => Math.hypot(x - R.town.x, z - R.town.z) < 70)) continue;
      if (this.H.WAR.keeps.some((K) => Math.hypot(x - K.site.x, z - K.site.z) < 40)) continue;
      return { x, z };
    }
    return { x: cx, z: cz };
  },
  // clear the ground round a spot of everyone but the player (who is sent far away)
  hush(x, z, r = 40) { for (const e of this.H.ENT.slice()) if (e.alive && e.kind !== 'door' && e.role !== 'player' && Math.hypot(e.x - x, e.z - z) < r) this.F.removeEnt(e); },
  // the player waits safe at home (a hit would flash the screen edges red)
  park() { const P = this.H.GAME.player, S = this.H.REALMS[0].town; P.x = P.prevX = S.x; P.z = P.prevZ = S.z; P.y = this.F.heightAt(S.x, S.z); P.hp = P.maxHp; },
  views: {
    town_day(V) { const H = V.H, F = V.F, S = H.REALMS[0].town; H.setTod(0.42); const c = Math.cos(S.yaw), s = Math.sin(S.yaw); const x = S.x + s * 34 - c * 18, z = S.z + c * 34 + s * 18; V.cam(x, F.heightAt(x, z) + 7, z, S.x, F.heightAt(S.x, S.z) + 2.5, S.z); },
    keep_out(V) { const H = V.H, F = V.F, K = V.keep(0, 0), S = K.site; H.setTod(0.55); const c = Math.cos(S.yaw), s = Math.sin(S.yaw); const x = S.x + s * 46 + c * 22, z = S.z + c * 46 - s * 22; V.cam(x, F.heightAt(x, z) + 9, z, S.x, S.y + 5, S.z); },
    keep_walk(V) { const H = V.H, S = V.keep(0, 0).site; H.setTod(0.55); const a = V.w(S, 14.4, -4.2), b = V.w(S, 14.6, 8); V.cam(a.x, S.y + 8.8, a.z, b.x, S.y + 8.6, b.z, 0); },
    forest(V) {
      const H = V.H, F = V.F, T = F.W.trees; H.setTod(0.62);
      let best = null, bn = -1;
      for (let i = 0; i < T.length; i += 5) { const t = T[i]; if (Math.hypot(t.x, t.z) > 400) continue; if (H.REALMS.some((R) => Math.hypot(t.x - R.town.x, t.z - R.town.z) < 80)) continue; let n = 0; for (const u of T) if (Math.abs(u.x - t.x) < 18 && Math.abs(u.z - t.z) < 18) n++; if (n > bn) { bn = n; best = t; } }
      let cx = 0, cz = 0, m = 0; for (const u of T) if (Math.hypot(u.x - best.x, u.z - best.z) < 22) { cx += u.x; cz += u.z; m++; } cx /= m; cz /= m;
      let spot = null;
      for (let k = 0; k < 16 && !spot; k++) { const a = k * Math.PI / 8; for (let r = 14; r < 70; r += 2) { const x = cx + Math.sin(a) * r, z = cz + Math.cos(a) * r; if (!F.isWalkable(x, z)) break; if (T.some((u) => Math.hypot(u.x - x, u.z - z) < 10)) continue; spot = { x: x + Math.sin(a) * 10, z: z + Math.cos(a) * 10 }; break; } }
      spot = spot || { x: cx + 30, z: cz };
      V.cam(spot.x, F.heightAt(spot.x, spot.z) + 2.4, spot.z, cx, F.heightAt(cx, cz) + 5, cz);
    },
    lake(V) {
      const H = V.H, F = V.F, L = H.dbg.LAKES[0]; H.setTod(0.75);
      let p = null; for (let k = 0; k < 12 && !p; k++) { const a = k * Math.PI / 6, x = L.x + Math.sin(a) * (L.r + 12), z = L.z + Math.cos(a) * (L.r + 12); if (F.isWalkable(x, z)) p = { x, z }; }
      p = p || { x: L.x + L.r + 12, z: L.z };
      const wy = F.heightAt(L.x, L.z);
      V.cam(p.x, F.heightAt(p.x, p.z) + 3.2, p.z, L.x - (p.x - L.x) * 0.6, wy + 1.0, L.z - (p.z - L.z) * 0.6);
    },
    fight(V) {
      const H = V.H, F = V.F; H.setTod(0.5);
      const a = H.REALMS[0].keepSites[1], b = H.REALMS[1].keepSites[0];
      const p = V.findMeadow((a.x + b.x) / 2, (a.z + b.z) / 2, 8);
      V.park(); V.hush(p.x, p.z, 60);
      const dx = b.x - a.x, dz = b.z - a.z, dl = Math.hypot(dx, dz), ux = dx / dl, uz = dz / dl;
      const cls = ['warrior', 'warrior', 'archer', 'mage', 'priest', 'warrior'];
      for (let side = 0; side < 2; side++) for (let i = 0; i < 6; i++) {
        const lat = (i - 2.5) * 2.2, along = (side ? 1 : -1) * (3.5 + (i % 3 === 2 ? 4 : 0));
        const x = p.x + ux * along - uz * lat, z = p.z + uz * along + ux * lat;
        const e = F.spawnRealmUnit(side, cls[i], 30, 'guard', x, z, { yaw: Math.atan2(-ux * (side ? 1 : -1), -uz * (side ? 1 : -1)) });
        e.ai.post = { x, z, leash: 60 };
      }
      H.UI.modal = null; H.simulate(4); H.UI.modal = 'menu';
      const cx = p.x - uz * 16 + ux * 2, cz = p.z + ux * 16 + uz * 2;
      V.cam(cx, F.heightAt(cx, cz) + 4.5, cz, p.x, F.heightAt(p.x, p.z) + 1.2, p.z);
    },
    dusk(V) { const H = V.H, F = V.F, S = H.REALMS[0].town; H.setTod(1.62); F.applyTimeOfDay(1.62); const d = H.dbg.skyU.uSunDir.value; const hl = Math.hypot(d.x, d.z) || 1; const x = S.x - d.x / hl * 40, z = S.z - d.z / hl * 40; V.cam(x, F.heightAt(x, z) + 6, z, x + d.x / hl * 60, F.heightAt(x, z) + 12, z + d.z / hl * 60); },
    night(V) { const H = V.H, F = V.F, S = H.REALMS[0].town; H.setTod(2.1); const c = Math.cos(S.yaw), s = Math.sin(S.yaw); const x = S.x + s * 34 - c * 18, z = S.z + c * 34 + s * 18; V.cam(x, F.heightAt(x, z) + 7, z, S.x, F.heightAt(S.x, S.z) + 4.5, S.z); },
    chars(V) {
      const H = V.H, F = V.F; H.setTod(0.5);
      // on the open shore of a lake, the water behind them
      const L = H.dbg.LAKES[0]; let p = null, dir = null;
      for (let k = 0; k < 12 && !p; k++) { const a = k * Math.PI / 6, x = L.x + Math.sin(a) * (L.r + 7), z = L.z + Math.cos(a) * (L.r + 7); if (F.isWalkable(x, z)) { p = { x, z }; dir = a; } }
      p = p || V.findMeadow(L.x + 40, L.z, 6);
      V.park(); V.hush(p.x, p.z, 30);
      const list = [[0, 'warrior'], [0, 'archer'], [0, 'mage'], [0, 'priest']];
      // a line along the shore, facing away from the water toward the camera
      const ox = Math.sin(dir ?? 0), oz = Math.cos(dir ?? 0), lx = -oz, lz = ox, face = Math.atan2(ox, oz);
      list.forEach(([r, c], i) => { const x = p.x + lx * (i - 1.5) * 1.5, z = p.z + lz * (i - 1.5) * 1.5; const e = F.spawnRealmUnit(r, c, 40, 'guard', x, z, { yaw: face }); e.ai.post = { x, z, leash: 2 }; e.yaw = face; });
      H.UI.modal = null; H.simulate(0.6); H.UI.modal = 'menu';
      for (const e of H.ENT) if (e.role === 'guard' && Math.hypot(e.x - p.x, e.z - p.z) < 6) { e.yaw = face; }
      const cx = p.x + ox * 4.8 + lx * 0.6, cz = p.z + oz * 4.8 + lz * 0.6;
      V.cam(cx, F.heightAt(cx, cz) + 1.75, cz, p.x, F.heightAt(p.x, p.z) + 1.1, p.z, 0);
    },
  },
  set(name) { this.dry(); this.views[name](this); },
};
"""
VIEWS = ['town_day', 'keep_out', 'keep_walk', 'forest', 'lake', 'fight', 'dusk', 'night', 'chars']

# Like hmlib.setup, plus a hold on the game's own animation frames: while window.__rafHold is set the main loop waits,
# so under SwiftShader only the frames the test asks for are drawn, and each view is read straight from the canvas.
HOLD = """(() => { window.__rafHold = false; const raf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = (cb) => raf((t) => { if (window.__rafHold) window.requestAnimationFrame(cb); else cb(t); }); })();"""
async def setup(p, w, h):
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
    await page.wait_for_function('window.__hm && window.__hm.ready', timeout=180000, polling=500)
    await page.evaluate("__hm.fn.setQuality('low')")
    return b, page, logs

async def grab(page, path, w, h):
    url = await page.evaluate("(() => { __hm.frame(1/30); return __hm.dbg.renderer.domElement.toDataURL('image/png'); })()")
    data = base64.b64decode(url.split(',', 1)[1])
    if Image:
        Image.open(io.BytesIO(data)).convert('RGB').resize((w, h), Image.LANCZOS).save(path)
    else:
        pathlib.Path(path).write_bytes(data)

async def main():
    async with async_playwright() as p:
        w, h = (640, 360) if SMALL else (960, 540)
        b, page, logs = await setup(p, w=w, h=h)
        print(f'booted [{time.time() - T0:.0f}s]', flush=True)
        page.on('console', lambda m: print('  console:', m.text[:300], flush=True) if m.type == 'error' else None)
        await page.evaluate(f"__hm.fn.setQuality('{QUALITY}')")
        await page.evaluate("__hm.start({realm:0, cls:'warrior', level:30})")
        await page.evaluate(HELPERS + '\n;0')
        await page.evaluate("document.getElementById('hud').hidden = true; V.dry(); __hm.simulate(2); window.__rafHold = true; 0")
        print(f'started [{time.time() - T0:.0f}s]', flush=True)
        if 'nochecks' not in ARGS:
            # the canopy map: a lone tree shelters the ground under it, open meadow is open sky, a felled tree no longer shelters
            r = await page.evaluate("""(() => { const H = __hm, V = H.visual; if (!V) return { err: 'no visual hooks' }; V.refresh();
              const T = H.fn.W.trees; let t = null;
              for (const u of T) { if (Math.hypot(u.x, u.z) > 380 || u.felled) continue; if (T.some((o) => o !== u && Math.hypot(o.x - u.x, o.z - u.z) < 9)) continue; t = u; break; }
              const m = window.V.findMeadow(t.x + 40, t.z + 40, 14);
              const c0 = V.canopy(t.x, t.z), cm = V.canopy(m.x, m.z), mp = V.meadow(m.x, m.z);
              H.nature.fellTree(t, 1, 0, 30); V.refresh(); const c1 = V.canopy(t.x, t.z);
              // walls cast contact shade on the ground at their foot
              const K = H.WAR.keeps[0].site; let ao = 0; for (let a = 0; a < 6.28; a += 0.1) for (let r = 8; r < 30; r += 0.5) ao = Math.max(ao, V.groundAO(K.x + Math.sin(a) * r, K.z + Math.cos(a) * r));
              return { c0: +c0.toFixed(2), cm: +cm.toFixed(2), c1: +c1.toFixed(2), meadow: mp.map((x) => +x.toFixed(2)), wallAO: +ao.toFixed(2) }; })()""")
            print('canopy', json.dumps(r), flush=True)
            check(r.get('c0', 0) > 0.5 and r.get('cm', 1) < 0.05 and r.get('c1', 1) < 0.25, 'the canopy map covers the ground under a crown, not open meadow, and lets go of a felled tree')
            check(r.get('wallAO', 0) > 0.5, 'walls shade the ground at their foot')
            # beasts soak in the rain under open sky and dry again in the sun (their own wetness)
            r = await page.evaluate("""(() => { const H = __hm, Wt = H.dbg.WEATHER;
              const b = H.ENT.find((e) => e.alive && ['wolf', 'boar', 'bear', 'deer', 'stag'].includes(e.kind) && Math.hypot(e.x, e.z) < 420);
              if (!b) return { err: 'no beast' };
              H.UI.modal = 'menu'; H.CAM.mode = 'fixed'; H.camera.position.set(b.x + 6, b.y + 4, b.z + 6);
              b.wet = 0; Wt.mode = 'fixed'; Wt.kind = 'rain'; Wt.raining = 1; Wt.snowing = 0; Wt.overcast = 1; Wt.next = 1e9;
              H.UI.modal = null; H.simulate(30); const wet = b.wet || 0;
              Wt.kind = 'clear'; Wt.raining = 0; Wt.overcast = 0; H.setTod(0.4); H.fn.applyTimeOfDay(0.4); H.simulate(60); const dried = b.wet || 0;
              H.UI.modal = 'menu';
              return { kind: b.kind, wet: +wet.toFixed(2), dried: +dried.toFixed(2) }; })()""")
            print('beast wet', json.dumps(r), flush=True)
            check(r.get('wet', 0) > 0.3 and r.get('dried', 1) < r.get('wet', 0), 'a beast soaks in the rain and dries in the sun')
            await page.evaluate("V.dry(); 0")
        for v in VIEWS:
            if ONLY and v not in ONLY: continue
            await page.evaluate(f"V.set('{v}'); __hm.frame(1/30); 0")
            if v == 'town_day':
                info = await page.evaluate("(() => { const r = __hm.renderInfo(); return { calls: r.calls, triangles: r.triangles, programs: r.programs, textures: r.textures, geometries: r.geometries, rt: r.rt }; })()")
                print('renderInfo town_day', json.dumps(info), flush=True)
            name = f'vis_{TAG}_{QUALITY}_{v}'
            await grab(page, OUT + name + '.png', w, h)
            print('  shot', name, f'[{time.time() - T0:.0f}s]', flush=True)
        errs = await page.evaluate("__hm.errors")
        check(not errs, 'no runtime errors ' + json.dumps(errs)[:600])
        print('logs', logs[:4])
        print('FAILED:' if FAILS else 'ALL PASSED', FAILS, flush=True)
        await b.close()
asyncio.run(main())
