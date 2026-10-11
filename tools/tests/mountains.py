"""[land] The mountains: how they look up close and from afar, and that the ground people walk on is untouched.
usage: python3 tools/tests/mountains.py [tag] [views=a,b,...] [q=high|medium|low] [noshots] [nochecks] [small]
  tag (default 'now') names the screenshots: tools/out/mtn_<tag>_<view>.png.
  Views: orchard, orchard_dusk, orchard_winter, orchard_low, pass0, pass1, pass2, road, wall, wall_low, foot, foot_low,
  thule_winter, far, crag, crag_low, and ([heights]) keep_far, keep_far_low, keep_far_dusk (the range across the frontier
  from before a Logres keep's gate, 350-450 m), town0, town2, town2_winter (the towns looking at the mountains), trees, trees_low (the
  hardy trees) (each from a fixed camera in clear weather; *_low at low quality, the rest at q, default high).
  Checks (unless nochecks): the walk mask, the heights of every walkable texel, the navigation graph, the roads and the
  colliders are what they were before the mountains were reshaped (checksums below, taken on version 9); no new closed
  hollow on the mountains; the crags stand only on unwalkable mountain ground, clear of walkable ground, and nowhere in
  the water; the camera never ends up inside one; the snow lies on the peaks by altitude and season; no runtime errors."""
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
TAG = next((a for a in ARGS if '=' not in a and a not in ('noshots', 'nochecks', 'small')), 'now')
Q = opt('q', 'high')
ALL_VIEWS = ['orchard', 'orchard_dusk', 'orchard_winter', 'orchard_low', 'pass0', 'pass1', 'pass2', 'road', 'wall', 'wall_low', 'foot', 'foot_low', 'thule_winter', 'far', 'crag', 'crag_low', 'keep_far', 'keep_far_low', 'keep_far_dusk', 'town0', 'town2', 'town2_winter', 'trees', 'trees_low']
VIEWS = opt('views', ','.join(ALL_VIEWS)).split(',')
SMALL = 'small' in FLAGS
T0 = time.time()
FAILS = []
def check(cond, what):
    print(('  ok   ' if cond else '  FAIL ') + what, flush=True)
    if not cond: FAILS.append(what)

# version 9's ground, before the mountains were reshaped: what people walk on must stay exactly the same
BASE = {}
BASE_FILE = pathlib.Path(__file__).resolve().parent / 'mountains_base.json'
if BASE_FILE.exists(): BASE = json.loads(BASE_FILE.read_text())

HELPERS = r"""
window.M = {
  H: __hm, F: __hm.fn,
  dry() { const Wt = this.H.dbg.WEATHER; Wt.mode = 'fixed'; Wt.kind = 'clear'; Wt.raining = 0; Wt.wet = 0; Wt.snowing = 0; Wt.snow = 0; Wt.overcast = 0; Wt.target = 0; Wt.w = 0; Wt.next = 1e9; this.H.dbg.U.uWet.value = 0; },
  season(k) { this.H.farm.setSeason(k); this.H.seasons.seasonSettle(); },
  cam(x, y, z, tx, ty, tz) {
    const H = this.H;
    H.UI.modal = 'menu'; H.CAM.mode = 'fixed';
    H.camera.position.set(x, y, z); H.camera.lookAt(tx, ty, tz); H.camera.updateMatrixWorld();
  },
  rp(R, along, lat) { const Q = this.H.REALMS[R]; return { x: Q.dx * along + Q.px * lat, z: Q.dz * along + Q.pz * lat }; },
  // the steepest-looking mountain in a cone round a bearing: the ground point that rises highest over the line of sight
  peakFrom(x, z, eye, bearing, cone = 0.6, d0 = 40, d1 = 220) {
    const h = this.F.heightAt; let best = null, ba = -9;
    for (let a = bearing - cone; a <= bearing + cone; a += 0.04) for (let d = d0; d <= d1; d += 4) {
      const px = x + Math.sin(a) * d, pz = z - Math.cos(a) * d, el = Math.atan2(h(px, pz) - eye, d);
      if (el > ba) { ba = el; best = { x: px, z: pz, y: h(px, pz), d, a }; }
    }
    return best;
  },
  look(x, z, up, bearing, cone, frac = 0.62, d0 = 40) {
    const y = this.F.heightAt(x, z) + up, p = this.peakFrom(x, z, y, bearing, cone, d0);
    this.cam(x, y, z, p.x, y + (p.y - y) * frac, p.z);
    return { cam: [+x.toFixed(1), +y.toFixed(1), +z.toFixed(1)], at: [+p.x.toFixed(1), +p.y.toFixed(1), +p.z.toFixed(1)], d: p.d };
  },
  bearing(x, z, tx, tz) { return Math.atan2(tx - x, -(tz - z)); },
  // a walkable spot at the foot of the biggest cliff near (x, z)
  foot(cx, cz, rad = 120) {
    const W = this.F.W, HN = 513, h = this.F.heightAt; let best = null, bs = -1;
    for (let k = 0; k < 6000; k++) {
      const a = k * 2.399, r = 6 + Math.sqrt(k / 6000) * rad, x = cx + Math.sin(a) * r, z = cz + Math.cos(a) * r;
      if (!this.F.isWalkable(x, z) || this.F.sampleGrid(W.road, x, z) > 0.1) continue;
      if (W.trees.some((t) => Math.abs(t.x - x) < 9 && Math.abs(t.z - z) < 9)) continue;
      for (let b = 0; b < 6.28; b += 0.39) {
        const tx = x + Math.sin(b) * 22, tz = z - Math.cos(b) * 22, rise = h(tx, tz) - h(x, z);
        if (rise > bs) { bs = rise; best = { x, z, b, rise }; }
      }
    }
    return best;
  },
  views: {
    orchard(M) { const o = M.H.surv.FORAGE.orchard; M.H.setTod(0.42); const R = M.H.REALMS[0]; return M.look(o.x, o.z, 2.2, R.bearing + Math.PI - 0.55, 0.5, 0.55); },
    orchard_dusk(M) { const o = M.H.surv.FORAGE.orchard; M.H.setTod(1.62); M.F.applyTimeOfDay(1.62); const R = M.H.REALMS[0]; return M.look(o.x, o.z, 2.2, R.bearing + Math.PI - 0.55, 0.5, 0.55); },
    orchard_winter(M) { M.season(0.875); const o = M.H.surv.FORAGE.orchard; M.H.setTod(0.42); const R = M.H.REALMS[0]; return M.look(o.x, o.z, 2.2, R.bearing + Math.PI - 0.55, 0.5, 0.55); },
    orchard_low(M) { return M.views.orchard(M); },
    pass0(M) { const p = M.rp(0, 254, 0), t = M.rp(0, 250, 70); M.H.setTod(0.5); return M.look(p.x, p.z, 1.8, M.bearing(p.x, p.z, t.x, t.z), 0.35, 0.5, 25); },
    pass1(M) { const p = M.rp(1, 254, 0), t = M.rp(1, 250, -70); M.H.setTod(0.5); return M.look(p.x, p.z, 1.8, M.bearing(p.x, p.z, t.x, t.z), 0.35, 0.5, 25); },
    pass2(M) { const p = M.rp(2, 254, 0), t = M.rp(2, 250, 70); M.H.setTod(0.5); return M.look(p.x, p.z, 1.8, M.bearing(p.x, p.z, t.x, t.z), 0.35, 0.5, 25); },
    road(M) { const p = M.rp(0, 194, 31), t = M.rp(0, 250, 100); M.H.setTod(0.45); return M.look(p.x, p.z, 1.8, M.bearing(p.x, p.z, t.x, t.z), 0.4, 0.5); },
    wall(M) { const S = M.H.REALMS[0].keepSites[0], c = Math.cos(S.yaw), s = Math.sin(S.yaw); const lx = -14.4, lz = -6, x = S.x + lx * c + lz * s, z = S.z - lx * s + lz * c; M.H.setTod(0.55);
      const y = S.y + 8.8, out = M.bearing(S.x, S.z, x, z) ; const p = M.peakFrom(x, z, y, M.H.REALMS[0].bearing, 0.5, 60, 240); M.cam(x, y, z, p.x, y + (p.y - y) * 0.5, p.z); return { cam: [x, y, z], at: [p.x, p.y, p.z] }; },
    wall_low(M) { return M.views.wall(M); },
    foot(M) { const c = M.rp(0, 282, 60); const f = M.foot(c.x, c.z); M.H.setTod(0.47); const y = M.F.heightAt(f.x, f.z) + 1.7; const tx = f.x + Math.sin(f.b) * 22, tz = f.z - Math.cos(f.b) * 22; M.cam(f.x - Math.sin(f.b) * 6, y + 0.4, f.z + Math.cos(f.b) * 6, tx, y + f.rise * 0.45, tz); return { foot: [f.x, f.z], rise: f.rise }; },
    foot_low(M) { return M.views.foot(M); },
    thule_winter(M) { M.season(0.875); const p = M.rp(2, 300, 40), t = M.rp(2, 250, 90); M.H.setTod(0.45); return M.look(p.x, p.z, 2.4, M.bearing(p.x, p.z, t.x, t.z), 0.5, 0.6); },
    // the biggest crag seen from the nearest open ground below it
    crag(M) { const C = M.H.mtn.MTN.crags, h = M.F.heightAt; let best = null, bs = 0;
      for (const c of C) { if (c.kind > 3) continue; for (let a = -0.8; a <= 0.8; a += 0.2) for (let d = c.r + 4; d < c.r + 26; d += 2) {
        const x = c.x + Math.sin(c.yaw + a) * d, z = c.z + Math.cos(c.yaw + a) * d; if (!M.F.isWalkable(x, z)) continue;
        if (M.F.W.trees.some((t) => Math.abs(t.x - x) < 6 && Math.abs(t.z - z) < 6)) continue;
        const sc = c.h * c.w / d; if (sc > bs) { bs = sc; best = { x, z, c }; } break; } }
      M.H.setTod(0.45); const b = best, y = h(b.x, b.z) + 1.7; M.cam(b.x, y, b.z, b.c.x, b.c.y0 + b.c.h * 0.6, b.c.z); return { cam: [b.x, y, b.z], crag: [b.c.x, b.c.z, b.c.kind, +b.c.h.toFixed(1)] }; },
    crag_low(M) { return M.views.crag(M); },
    far(M) { const S = M.H.REALMS[1].town; M.H.setTod(0.4); const R = M.H.REALMS[1]; return M.look(S.x, S.z, 14, R.bearing + Math.PI, 0.7, 0.3, 120); },
    // [heights] the range from afar: from a Logres keep's wall walk across the frontier to the far side of the ring
    // (350-450 m), and from the towns (each looking at the nearest mountains)
    keep_far(M) { const p = M.rp(0, 88, 64), y = M.F.heightAt(p.x, p.z) + 3.5; M.H.setTod(0.42); const t = M.rp(2, 250, -60); M.cam(p.x, y, p.z, t.x, 22, t.z); return { cam: [p.x, y, p.z], at: [t.x, t.z], d: Math.hypot(t.x - p.x, t.z - p.z) }; },
    keep_far_low(M) { return M.views.keep_far(M); },
    keep_far_dusk(M) { const r = M.views.keep_far(M); M.H.setTod(1.62); M.F.applyTimeOfDay(1.62); return r; },
    town0(M) { const S = M.H.REALMS[0].town; M.H.setTod(0.45); const R = M.H.REALMS[0]; return M.look(S.x, S.z, 3, R.bearing + Math.PI + 0.35, 0.5, 0.4, 70); },
    town2(M) { const S = M.H.REALMS[2].town; M.H.setTod(0.45); const R = M.H.REALMS[2]; return M.look(S.x, S.z, 3, R.bearing + Math.PI - 0.3, 0.5, 0.4, 70); },
    town2_winter(M) { M.season(0.875); return M.views.town2(M); },
    // hardy trees on a lower slope: the most of them within 40 m, seen from below
    trees(M) { const T = M.F.W.trees.filter((t) => t.hardy), h = M.F.heightAt; let best = null, bn = 0;
      for (const t of T) { const n = T.filter((o) => Math.hypot(o.x - t.x, o.z - t.z) < 30).length; if (n > bn) { bn = n; best = t; } }
      M.H.setTod(0.45); if (!best) return null; const a = Math.atan2(best.x, best.z), x = best.x - Math.sin(a) * 34, z = best.z - Math.cos(a) * 34, y = h(x, z) + 2;
      M.cam(x, y, z, best.x, best.y + 4, best.z); return { cam: [x, y, z], at: [best.x, best.z], n: bn }; },
    trees_low(M) { return M.views.trees(M); },
  },
  set(name) { this.dry(); if (!/winter/.test(name)) this.season(0.375); return this.views[name](this); },
};
"""

# Math.random is seeded so the land comes out the same on every boot (the pond fill dithers its heights with it)
HOLD = """(() => { let s = 1234567; Math.random = () => { s |= 0; s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; })();
(() => { window.__rafHold = false; const raf = window.requestAnimationFrame.bind(window);
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
    await page.wait_for_function('window.__hm && window.__hm.ready', timeout=240000, polling=500)
    return b, page, logs

async def grab(page, path, w, h):
    url = await page.evaluate("(() => { __hm.frame(1/30); __hm.frame(1/30); return __hm.dbg.renderer.domElement.toDataURL('image/png'); })()")
    data = base64.b64decode(url.split(',', 1)[1])
    if Image: Image.open(io.BytesIO(data)).convert('RGB').resize((w, h), Image.LANCZOS).save(path)
    else: pathlib.Path(path).write_bytes(data)

# what people walk on: the walk mask, the heights of every walkable texel and of every texel next to one, the roads,
# the navigation graph and the colliders (counts and a checksum of their places)
GROUND = r"""((pre) => { const W = __hm.fn.W, HN = 513, N2 = HN * HN, Ht = __hm.heights && __hm.heights.HTS, walk = pre && Ht && Ht.walk0 ? Ht.walk0 : W.walk, H = pre && Ht && Ht.H0 ? Ht.H0 : W.H; // [heights] pre: the land as version 10 left it, before mtnHeights (03d_heights.js)
  // the ground anyone can reach: flooded from the roads over walkable ground and swimmable water (8 neighbours)
  const reach = new Uint8Array(N2), st = [];
  const seed = (x, z) => { const k = Math.round((z + 512) / 2) * HN + Math.round((x + 512) / 2); if (walk[k] !== 1 && !reach[k]) { reach[k] = 1; st.push(k); } };
  for (const S of W.roads) { seed(S.ax, S.az); seed(S.bx, S.bz); }
  while (st.length) { const k = st.pop(), i = k % HN, j = (k / HN) | 0;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) { const ii = i + di, jj = j + dj; if (ii < 0 || jj < 0 || ii >= HN || jj >= HN) continue; const n = jj * HN + ii; if (!reach[n] && walk[n] !== 1) { reach[n] = 1; st.push(n); } } }
  let hw = 0, hh = 0, nWalk = 0, nDeep = 0, nReach = 0, nProt = 0;
  // every texel within two of ground a body could stand on (walkable, reachable or not, or water): the heights, slopes
  // and normals read there by anything placed later, and by every body, come from these
  const near = (k) => { const i = k % HN, j = (k / HN) | 0; for (let dj = -2; dj <= 2; dj++) for (let di = -2; di <= 2; di++) { const ii = i + di, jj = j + dj; if (ii < 0 || jj < 0 || ii >= HN || jj >= HN) continue; if (walk[jj * HN + ii] !== 1) return true; } return false; };
  for (let k = 0; k < N2; k++) { hw = (hw * 31 + walk[k]) % 1000000007; if (walk[k] === 0) nWalk++; if (walk[k] === 2) nDeep++; if (reach[k]) nReach++;
    if (near(k)) { nProt++; hh = (hh * 131 + Math.round(H[k] * 100) + 7) % 1000000007; } }
  let hr = 0; for (const S of W.roads) hr = (hr * 131 + Math.round((S.ax + S.az * 3 + S.bx * 7 + S.bz * 11) * 10)) % 1000000007;
  // (not those of the stone keeps: their corner towers are hollow since version 10, [land] 04l_towers.js)
  const C = __hm.build.COLL, keeps = __hm.REALMS[0].keepSites, inKeep = (c) => keeps.some((S) => Math.hypot(c.x - S.x, c.z - S.z) < 26);
  let cs = 0, nb = 0, nc = 0;
  for (const c of C.boxes) { if (c.tag === 'tree' || inKeep(c)) continue; nb++; cs = (cs * 131 + Math.round((c.x * 3 + c.z * 7 + c.hx * 11 + c.hz * 13) * 10)) % 1000000007; }
  for (const c of C.circles) { if (c.tag === 'tree' || inKeep(c) || c.jetty || c.outcrop) continue; // [v10] not the jetties' posts (07e_boats.js); [heights] nor the outcrops' (03d_heights.js)
    nc++; cs = (cs * 131 + Math.round((c.x * 3 + c.z * 7 + c.r * 11) * 10)) % 1000000007; }
  const coll = { boxes: nb, circles: nc, sum: cs };
  // (the trees there were before the hardy ones were added after them: [heights])
  const nT = Ht && Ht.trees0 ? Ht.trees0 : W.trees.length;
  let ts = 0; const T = W.trees; for (let i = 0; i < nT; i++) ts = (ts * 131 + Math.round((T[i].x * 3 + T[i].z * 7) * 10)) % 1000000007;
  return { walkSum: hw, walkHeights: hh, nWalk, nDeep, nReach, nProt, roads: W.roads.length, roadSum: hr, coll, trees: nT, treeSum: ts, rocks: W.rocks.length, camps: W.camps.length }; })"""

async def main():
    async with async_playwright() as p:
        w, h = (640, 360) if SMALL else (960, 540)
        b, page, logs = await setup(p, w=w, h=h)
        print(f'booted [{time.time() - T0:.0f}s]', flush=True)
        await page.evaluate("__hm.start({realm:0, cls:'warrior', level:30})")
        await page.evaluate(HELPERS + '\n;0')
        await page.evaluate("document.getElementById('hud').hidden = true; M.dry(); __hm.simulate(1); window.__rafHold = true; 0")
        # the player waits at home, out of every view
        await page.evaluate("(() => { const P = __hm.GAME.player, S = __hm.REALMS[0].town; P.x = P.prevX = S.x; P.z = P.prevZ = S.z; P.hp = P.maxHp; return 0; })()")
        print(f'started [{time.time() - T0:.0f}s]', flush=True)
        if 'nochecks' not in FLAGS:
            # [heights] the land as version 10 left it (before mtnHeights) must be exactly the base; after it, what anyone
            # can reach, the roads, the camps, the colliders, the trees there were and the rocks stay the same
            g0 = await page.evaluate(GROUND + '(true)')
            g = await page.evaluate(GROUND + '(false)')
            print('ground before the shaping', json.dumps(g0), flush=True)
            print('ground now', json.dumps(g), flush=True)
            if TAG == 'base':
                BASE_FILE.write_text(json.dumps(g0, indent=1))
                print('wrote', BASE_FILE)
            elif BASE:
                for k in ('walkSum', 'walkHeights', 'nWalk', 'nDeep', 'nReach', 'nProt', 'roads', 'roadSum', 'camps', 'coll', 'trees', 'treeSum', 'rocks'):
                    check(g0.get(k) == BASE.get(k), f'{k} as version 10 left it ({g0.get(k)} vs {BASE.get(k)})')
                for k in ('nDeep', 'nReach', 'roads', 'roadSum', 'camps', 'coll', 'trees', 'treeSum', 'rocks'):
                    check(g.get(k) == BASE.get(k), f'{k} unchanged by the shaping ({g.get(k)} vs {BASE.get(k)})')
            hs = await page.evaluate("(() => { const T = __hm.heights; if (!T) return null; const H = T.HTS, W = __hm.fn.W, N2 = 513 * 513; let off = 0, walkOff = 0, reachLost = 0, opened = 0;"
                "  for (let k = 0; k < N2; k++) { const i = k % 513, j = (k / 513) | 0, near = (dk) => H.changed[k + dk] === 1; const ch = H.changed[k] || (i > 0 && near(-1)) || (i < 512 && near(1)) || (j > 0 && near(-513)) || (j < 512 && near(513));"
                "    if (!H.changed[k] && W.H[k] !== H.H0[k]) off++; if (!ch && W.walk[k] !== H.walk0[k]) walkOff++; if (H.reach[k] && W.walk[k] !== H.walk0[k]) reachLost++; if (H.walk0[k] === 1 && W.walk[k] !== 1) opened++; }"
                "  return { ...T.stats(), off, walkOff, reachLost, opened }; })()")
            print('heights', json.dumps(hs), flush=True)
            if hs:
                check(hs['off'] == 0, f"no height changed outside the shaped ground ({hs['off']})")
                check(hs['walkOff'] == 0, f"the walk mask is unchanged away from the shaped ground ({hs['walkOff']})")
                check(hs['reachLost'] == 0, f"every texel anyone could reach is as walkable as it was ({hs['reachLost']})")
                check(hs['opened'] == 0, f"no blocked ground opened ({hs['opened']})")
                check(hs['changed'] > 40000, f"the mountains are shaped, walkable slopes and crests too ({hs['changed']} texels)")
                print(f"  (recorded: {hs['walkLost']} unreachable texels on the faces and crests too steep to walk now)")
            land = await page.evaluate("__hm.mtn ? __hm.mtn.check() : null")
            print('land', json.dumps(land)[:1500], flush=True)
            if land:
                check(land['crags'] > 200, f"crags stand on the mountains ({land['crags']})")
                check(land['cragOnWalk'] == 0, f"no crag over walkable ground ({land['cragOnWalk']})")
                check(land['cragWet'] == 0, f"no crag in the water ({land['cragWet']})")
                check(land['cragFloat'] == 0, f"no crag floats over the slope ({land['cragFloat']})")
                check(land['newHollows'] == 0, f"no closed hollow on the reshaped mountains ({land['newHollows']})")
                check(land['shaped'] > 1000, f"the mountain ground is reshaped ({land['shaped']} texels)")
                check(land['camInside'] == 0, f"the camera stays out of the crags ({land['camInside']})")
        if 'noshots' not in FLAGS:
            for v in VIEWS:
                q = 'low' if v.endswith('_low') else Q
                await page.evaluate(f"__hm.fn.setQuality('{q}'); 0")
                info = await page.evaluate(f"(() => {{ const r = M.set('{v}'); __hm.frame(1/30); return r; }})()")
                name = f'mtn_{TAG}_{v}'
                await grab(page, OUT + name + '.png', w, h)
                ri = await page.evaluate("(() => { const r = __hm.renderInfo(); return [r.calls, r.triangles]; })()")
                print('  shot', name, json.dumps(info), 'calls/tris', ri, f'[{time.time() - T0:.0f}s]', flush=True)
        errs = await page.evaluate("__hm.errors")
        check(not errs, 'no runtime errors ' + json.dumps(errs)[:600])
        if logs: print('logs', logs[:4])
        print('FAILED:' if FAILS else 'ALL PASSED', FAILS, flush=True)
        await b.close()
asyncio.run(main())
