"""[weather2] Weather that is real (version 19), end to end through window.__hm.weather2:
the weather systems (fronts, showers, storms, cloud banks, mist) are born of the realms' climates and the season, move
with the wind and grow and die away; the weather at a place comes from the systems over it (rain under a storm, clear
beside it), the camera's own weather (WEATHER) is the weather at the camera, and the readers ask at their own place (a
body's wet, a bed's water, the snow lying, the dryness of the grass, a fire's damp, the lightning under the storm); a held
weather (Always clear, a test's fixed kind) is one weather everywhere; the systems are saved with the world (an old save
and a damaged part load). The clouds are the systems' own: the cloud field's rain under a storm, the dome of the sky dark
toward it and clear away from it, the moon hidden behind a cloud and shining where none stands, the cloud's shadow on
the ground. Snow and rain never inside: every house, hall and tower room (and the walks over the gates) under the
shelter map, no drift on a floor inside, and, rendered, no difference inside a house, a hall and the towers' rooms
between a blizzard over a white winter and no snow at all (the same view outside differs). Pictures (unless noshots):
a front coming in over a keep, a storm over the frontier from a town, the moon between clouds, a clear sky after rain,
mist in a valley, rain under its cloud, inside in a blizzard; at the quality given (q=high|medium|low) and `phone`.
usage: python3 tools/tests/weather2.py [only=systems,place,held,save,shelter,inside,clouds,shots] [q=medium] [noshots] [phone] [big]
(big: 960x540 for the final pictures; 640x360 by default)"""
import json, asyncio, sys, pathlib, time
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
from hmlib import setup, OUT
from playwright.async_api import async_playwright

ARGS = sys.argv[1:]
SHOTS = 'noshots' not in ARGS
PHONE = 'phone' in ARGS
Q = next((a[2:] for a in ARGS if a.startswith('q=')), 'medium')
ONLY = set(next((a[5:].split(',') for a in ARGS if a.startswith('only=')), ['systems', 'place', 'held', 'save', 'shelter', 'inside', 'clouds', 'shots']))
FAILS = []
T0 = time.time()

def check(cond, what):
    print(('  ok   ' if cond else '  FAIL ') + what, flush=True)
    if not cond: FAILS.append(what)

async def ev(page, label, js):
    r = await page.evaluate(js)
    print(f'{label} [{time.time() - T0:.0f}s]', json.dumps(r)[:1600], flush=True)
    return r

HOLD = """(() => { if (window.__rafWrapped) { window.__rafHold = true; return 0; } window.__rafWrapped = true; window.__rafHold = true; const raf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = (cb) => raf((t) => { if (window.__rafHold) window.requestAnimationFrame(cb); else cb(t); }); return 0; })()"""

HELPERS = r"""
window.W2T = {
  H: __hm, X: __hm.weather2, W: __hm.dbg.WEATHER,
  P() { return this.H.GAME.player; },
  // the live weather (the systems), none in the sky but what the test makes
  live() { const W = this.W; W.mode = 'auto'; W.next = 60; this.X.WX.on = true; this.X.calm(); return 0; },
  // a fixed camera at (x, y, z) looking at (tx, ty, tz)
  cam(x, y, z, tx, ty, tz) {
    const H = this.H; H.UI.modal = 'menu'; H.CAM.mode = 'fixed';
    document.getElementById('hud').style.visibility = 'hidden';
    H.camera.position.set(x, y, z); H.camera.lookAt(tx, ty, tz); H.camera.updateMatrixWorld();
  },
  play() { const H = this.H; H.UI.modal = null; H.CAM.mode = 'play'; document.getElementById('hud').style.visibility = ''; },
  // the player somewhere safe: no foes about, full health
  safe() { const P = this.P(); P.hp = P.maxHp; for (const e of this.H.ENT) if (e !== P && e.alive && e.faction !== P.faction && e.faction !== 4 && Math.hypot(e.x - P.x, e.z - P.z) < 60) { e.x += 400; e.z += 400; } return 0; },
  go(x, z) { const H = this.H; H.teleport(x, z); const P = this.P(); H.camera.position.set(P.x, P.y + 5, P.z + 7); H.camera.updateMatrixWorld(); return P; },
  // the canvas's mean colour (0..255) over a box of the screen (fractions), right after a frame
  px(x0 = 0, y0 = 0, x1 = 1, y1 = 1) {
    const R = this.H.dbg.renderer, gl = R.getContext(), w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
    R.setRenderTarget(null);
    const X0 = Math.floor(x0 * w), Y0 = Math.floor((1 - y1) * h), W = Math.max(1, Math.floor((x1 - x0) * w)), Hh = Math.max(1, Math.floor((y1 - y0) * h));
    const b = new Uint8Array(W * Hh * 4); gl.readPixels(X0, Y0, W, Hh, gl.RGBA, gl.UNSIGNED_BYTE, b);
    let r = 0, g = 0, bl = 0; const n = W * Hh; for (let i = 0; i < n; i++) { r += b[i * 4]; g += b[i * 4 + 1]; bl += b[i * 4 + 2]; }
    return { r: r / n, g: g / n, b: bl / n, l: (r + g + bl) / 3 / n, raw: b };
  },
  diff(A, B) { let s = 0, m = 0; for (let i = 0; i < A.length; i += 4) { const d = (Math.abs(A[i] - B[i]) + Math.abs(A[i + 1] - B[i + 1]) + Math.abs(A[i + 2] - B[i + 2])) / 3; s += d; if (d > m) m = d; } return { mean: +(s / (A.length / 4)).toFixed(3), max: m }; },
  // the dome's (rgb, a) toward a direction
  dome(dir) {
    const X = this.X, R = this.H.dbg.renderer, rt = X.WXR.dome, n = rt.width;
    const l = Math.hypot(dir[0], dir[1], dir[2]), d = [dir[0] / l, dir[1] / l, dir[2] / l];
    const e = Math.asin(Math.max(0, Math.min(1, d[1]))), r = 1 - Math.pow(e / (Math.PI / 2), 0.625), hl = Math.hypot(d[0], d[2]);
    const u = (hl > 1e-5 ? d[0] / hl * r : 0) * 0.5 + 0.5, v = (hl > 1e-5 ? d[2] / hl * r : 0) * 0.5 + 0.5;
    const half = rt.texture.type === 1016; // THREE.HalfFloatType
    const b = half ? new Uint16Array(4) : new Uint8Array(4);
    R.readRenderTargetPixels(rt, Math.floor(u * n), Math.floor(v * n), 1, 1, b);
    const f = (x) => half ? __hm.weather2.half(x) : x / 255;
    return [f(b[0]), f(b[1]), f(b[2]), f(b[3])].map((x) => +x.toFixed(3));
  },
  field(x, z) {
    const X = this.X, R = this.H.dbg.renderer, rt = X.WXR.field, n = rt.width, P = this.H.dbg.U.uCloudMapP.value;
    const dx = x - P.x, dz = z - P.y, L = Math.hypot(dx, dz), qx = dx / (P.z + L), qz = dz / (P.z + L);
    const b = new Uint8Array(4); R.readRenderTargetPixels(rt, Math.floor((qx * 0.5 + 0.5) * n), Math.floor((qz * 0.5 + 0.5) * n), 1, 1, b);
    return Array.from(b).map((v) => +(v / 255).toFixed(3));
  },
  // a white winter in a held blizzard (the same light either way): with the snow lying everywhere and falling (on) or
  // with none lying and none drawn falling (off)
  winterSnow(on) {
    const S = this.H.seasons.SEAS, W = this.W, X = this.X;
    this.H.farm.setSeason(0.88); this.H.seasons.seasonSettle();
    W.mode = 'auto'; W.next = 1e9; W.kind = 'storm'; X.WX.coldK = 1;
    W.raining = 1; W.storm = 1; W.overcast = 1; W.fog = 1; W.snow = on ? 1 : 0; W.wet = 0;
    if (S.lie) { S.lie.fill(on ? 1 : 0); for (let i = 0; i < S.lie.length; i++) S.bytes[i * 4] = on ? 255 : 0; S.dirty = true; if (S.tex) S.tex.needsUpdate = true; }
    for (const e of this.H.ENT) e.snow = on ? 1 : 0;
    X.precip().snow.visible = on;
    return 0;
  },
  winterEnd() { const X = this.X; delete X.WX.coldK; X.precip().snow.visible = true; this.W.next = 60; return 0; },
};
0;
"""

async def main():
    w, h = (390, 780) if PHONE else (960, 540) if 'big' in ARGS else (640, 360)
    async with async_playwright() as p:
        b, page, logs = await setup(p, touch=PHONE, w=w, h=h)
        await page.evaluate(HELPERS)
        await page.evaluate(f"__hm.fn.setQuality('{Q}'); __hm.start({{ realm: 0, cls: 'warrior', level: 20 }}); 0")
        await page.evaluate("__hm.simulate(2); W2T.safe(); 0")
        await page.evaluate(HOLD)
        r = await ev(page, 'boot', "({ errors: __hm.errors.length, live: __hm.weather2.wxLive(), field: !!__hm.weather2.WXR.field || 'not yet', cells: __hm.weather2.WX.cells.length })")
        check(r['errors'] == 0, 'no errors at the start')
        check(r['live'], 'the weather is the systems\' by default (not held)')

        if 'systems' in ONLY:
            # the systems come and go by themselves: over an hour of the world
            r = await ev(page, 'systems', """(() => { const X = W2T.X, WX = X.WX; W2T.live(); X.release(); WX.stats.made = 0; WX.stats.kinds = {};
              const v0 = { x: Math.sin(WX.wind.from), z: Math.cos(WX.wind.from) };
              let maxN = 0, moved = [], speeds = [];
              const step = (sec) => { for (let t = 0; t < sec; t += 0.5) X.updateWeather2(0.5); };
              for (let k = 0; k < 120; k++) { const c0 = WX.cells.map((c) => [c.id, c.x, c.z]); step(30); maxN = Math.max(maxN, WX.cells.length);
                for (const [id, x, z] of c0) { const c = WX.cells.find((q) => q.id === id); if (c) speeds.push(Math.hypot(c.x - x, c.z - z) / 30); } }
              speeds.sort((a, b) => a - b);
              return { made: WX.stats.made, gone: WX.stats.gone, kinds: WX.stats.kinds, now: WX.cells.length, maxN, medSpeed: +speeds[speeds.length >> 1].toFixed(2), wind: [Math.round(WX.wind.from * 57.3), +WX.wind.s.toFixed(1)], errors: __hm.errors.length }; })()""")
            check(r['made'] >= 6, f"systems are born over an hour ({r['made']})")
            check(len(r['kinds']) >= 3, f"of several kinds ({r['kinds']})")
            check(0.5 < r['medSpeed'] < 15, f"they move with the wind ({r['medSpeed']} m/s)")
            check(r['maxN'] <= 40, f"and never pile up ({r['maxN']} at most)")
            # the realms' own weather: the share of the hour each town spends in rain and the like, in winter and summer
            r = await ev(page, 'climates', """(() => { const X = W2T.X, WX = X.WX, out = {};
              const T = __hm.weather2.sites.filter((s) => s.kind === 'town');
              for (const [season, sk] of [[0.88, 'winter'], [0.4, 'summer']]) {
                const step = (sec) => { for (let t = 0; t < sec; t += 0.5) X.updateWeather2(0.5); };
                __hm.farm.setSeason(season); W2T.live(); X.release(); step(600);
                const acc = T.map(() => ({ rain: 0, snow: 0, storm: 0, cloudy: 0, clear: 0, mist: 0 })), q = {};
                for (let k = 0; k < 480; k++) { step(15); if (k % 40 === 0) __hm.setTod((k / 40 * 0.25) % 3); T.forEach((S, i) => { const w = X.weatherAt(S.x, S.z, q); const a = acc[i];
                  if (w.snowing > 0.3) a.snow++; else if (w.storm > 0.5) a.storm++; else if (w.rain > 0.3) a.rain++; else if (w.mist > 0.5) a.mist++; else if (w.overcast > 0.55) a.cloudy++; else a.clear++; }); }
                out[sk] = T.map((S, i) => [S.realm, Object.fromEntries(Object.entries(acc[i]).map(([k, v]) => [k, Math.round(v / 4.8)]))]);
              }
              return out; })()""")
            for sk in ('winter', 'summer'):
                for realm, a in r[sk]:
                    wet = a['rain'] + a['snow'] + a['storm']
                    check(0 < wet < 85, f"{sk}, realm {realm}: wet {wet}% of the time ({a})")
                    check(a['clear'] + a['cloudy'] > 10, f"{sk}, realm {realm}: and dry for a while too")
            thule_w = dict(r['winter'])[2]
            check(thule_w['snow'] > 0, f"Thule's winter weather falls as snow ({thule_w})")

        if 'place' in ONLY:
            # a storm over one place: the weather there and beside it
            r = await ev(page, 'place', """(() => { const X = W2T.X, WX = X.WX, P = W2T.P(); W2T.live(); __hm.farm.setSeason(0.4);
              const c = X.wxMake('storm', P.x + 300, P.z, { age: 120, ang: 0 }); c.life = 1e6; c.sp = 0; WX.wind.s = 0.01; WX.wind.toS = 0.01; WX.wind.next = 1e9; __hm.simulate(1);
              const q = (x, z) => { const w = X.weatherAt(x, z); return { k: w.kind, r: +w.rain.toFixed(2), s: +w.storm.toFixed(2), oc: +w.overcast.toFixed(2) }; };
              return { under: q(c.x, c.z), edge: q(c.x + c.a * 0.9, c.z), beside: q(P.x - 300, P.z), cell: [Math.round(c.x), Math.round(c.z), Math.round(c.a), Math.round(c.b)] }; })()""")
            check(r['under']['k'] == 'storm' and r['under']['r'] > 0.6, f"under the storm it storms ({r['under']})")
            check(r['beside']['k'] in ('clear', 'cloudy') and r['beside']['r'] < 0.05, f"600 m off it does not ({r['beside']})")
            # the camera's own weather is the weather at the camera
            r = await ev(page, 'camera', """(() => { const X = W2T.X, c = X.WX.cells[0], P = W2T.P(), W = W2T.W;
              W2T.cam(c.x, 20, c.z, c.x + 10, 25, c.z); __hm.fn.weatherAdvance(25); const under = { k: W.kind, r: +W.raining.toFixed(2), oc: +W.overcast.toFixed(2) };
              W2T.cam(P.x - 300, 20, P.z, P.x - 290, 25, P.z); __hm.fn.weatherAdvance(25); const away = { k: W.kind, r: +W.raining.toFixed(2), oc: +W.overcast.toFixed(2) };
              return { under, away }; })()""")
            check(r['under']['r'] > 0.6 and r['under']['k'] == 'storm', f"the camera under it: WEATHER is the storm ({r['under']})")
            check(r['away']['r'] < 0.1, f"the camera away from it: no rain ({r['away']})")
            # the readers at their own places: a body, a bed, the grass's dryness, the snow lying, the lightning
            r = await ev(page, 'readers', """(() => { const X = W2T.X, WX = X.WX, c = WX.cells[0], H = __hm, P = W2T.P();
              const out = {};
              // the player under the storm, then in the clear
              H.teleport(c.x, c.z); P.wet = 0; W2T.cam(P.x, P.y + 6, P.z + 8, P.x, P.y, P.z); H.simulate(20); out.wetUnder = +P.wet.toFixed(2);
              H.teleport(c.x - 600, c.z); W2T.cam(P.x, P.y + 6, P.z + 8, P.x, P.y, P.z); H.simulate(20); out.wetAfter = +P.wet.toFixed(2);
              // the grass's dryness and a fire's damp
              out.natUnder = +X.wxGridAt('wet', c.x, c.z).toFixed(2); out.natAway = +X.wxGridAt('wet', c.x - 600, c.z).toFixed(2);
              out.precipUnder = +X.wxPrecipAt(c.x, c.z).toFixed(2); out.precipAway = +X.wxPrecipAt(c.x - 600, c.z).toFixed(2);
              // two beds: one under it, one away; a minute of growing
              const a = H.farm.till(c.x + 20, c.z + 20), b = H.farm.till(c.x - 600, c.z + 30), A = H.farm.plot(a), B = H.farm.plot(b);
              if (A && B) { A.moist = B.moist = 0.3; H.farm.step(60); out.bedUnder = +A.moist.toFixed(3); out.bedAway = +B.moist.toFixed(3); }
              // lightning only under the storm
              WX.stats.at = []; for (let k = 0; k < 240; k++) X.updateWeather2(0.5);
              const at = WX.stats.at || []; out.strikes = at.length;
              out.strikesOff = at.filter(([x, z]) => Math.hypot(x - c.x, z - c.z) > Math.max(c.a, c.b) * 1.05).length;
              return out; })()""")
            check(r['wetUnder'] > 0.3, f"a body under the storm gets wet ({r['wetUnder']})")
            check(r['wetAfter'] < r['wetUnder'], f"and dries out of it ({r['wetAfter']})")
            check(r['natUnder'] > r['natAway'] + 0.2, f"the ground under the storm is wet, beside it dry ({r['natUnder']} / {r['natAway']})")
            if 'bedUnder' in r: check(r['bedUnder'] > r['bedAway'] + 0.01, f"a bed under the rain is watered, one away is not ({r['bedUnder']} / {r['bedAway']})")
            check(r['strikes'] > 0, f"the storm's lightning strikes ({r['strikes']})")
            check(r['strikesOff'] == 0, f"only under the storm ({r['strikesOff']} strikes off it)")
            # winter: snow falls and lies under a snow cloud in Thule, not beside it
            r = await ev(page, 'snow', """(() => { const X = W2T.X, WX = X.WX, H = __hm; W2T.live(); WX.wind.s = 0.01; WX.wind.toS = 0.01;
              H.farm.setSeason(0.88); H.seasons.seasonSettle();
              const T = H.weather2.sites.find((s) => s.kind === 'town' && s.realm === 2);
              const c = X.wxMake('front', T.x, T.z, { age: 200 }); c.life = 1e6; c.sp = 0; c.a = 260; c.b = 200; H.simulate(1);
              const ax = T.x + 450 * Math.sign(-T.x || 1), az = T.z;
              const S = H.seasons.SEAS; S.lie.fill(0);
              const w = X.weatherAt(T.x, T.z), w2 = X.weatherAt(ax, az);
              H.seasons.step(20); H.simulate(1);
              return { snowing: +w.snowing.toFixed(2), temp: +w.temp.toFixed(1), snowingAway: +w2.snowing.toFixed(2), lieUnder: +H.seasons.seasonSnowLieAt(T.x, T.z).toFixed(3), lieAway: +H.seasons.seasonSnowLieAt(ax, az).toFixed(3) }; })()""")
            check(r['snowing'] > 0.4, f"in a Thule winter the front's rain falls as snow ({r})")
            check(r['lieUnder'] > r['lieAway'] + 0.1, f"and lies under it more than beside it ({r['lieUnder']} / {r['lieAway']})")

        if 'held' in ONLY:
            r = await ev(page, 'held', """(() => { const X = W2T.X, W = W2T.W, P = W2T.P(); W2T.live(); X.wxMake('storm', P.x + 200, P.z, { age: 150 });
              W.mode = 'clear'; __hm.fn.weatherAdvance(30); const clear = [X.wxHeld(), X.weatherAt(P.x + 200, P.z).kind, W.kind];
              W.mode = 'auto'; W.kind = 'rain'; W.next = 1e9; __hm.fn.weatherAdvance(30); const rain = [X.wxHeld(), X.weatherAt(P.x - 400, P.z).kind, +X.weatherAt(P.x - 400, P.z).raining.toFixed(2)];
              W.next = 60; return { clear, rain, live: X.wxHeld() }; })()""")
            check(r['clear'][0] and r['clear'][1] == 'clear', f"Always clear holds the whole land clear ({r['clear']})")
            check(r['rain'][0] and r['rain'][1] == 'rain' and r['rain'][2] > 0.5, f"a test's held rain falls everywhere, as before ({r['rain']})")
            check(not r['live'], 'and the systems come back when it is let go')

        if 'save' in ONLY:
            r = await ev(page, 'save', """(() => { const X = W2T.X, WX = X.WX; W2T.live(); X.wxMake('front', 100, 200, { age: 50 }); X.wxMake('shower', -300, 40, { age: 10 }); WX.wind.from = 1.2;
              const d = X.wxSave(), json = JSON.stringify(d), n = WX.cells.length, kinds = WX.cells.map((c) => c.kind).join();
              X.wxLoad(JSON.parse(json)); const back = [WX.cells.length, WX.cells.map((c) => c.kind).join(), +WX.wind.from.toFixed(3)];
              X.wxLoad(undefined); const old = WX.cells.length;
              X.wxLoad({ v: 1, w: ['x', null], c: [['front', 'a', 2], ['nope', 1, 2], ['storm', 1e9, 3, 0, 300, 200, 50, 100, 1, 1, 7], 5], g: [1, 2] }); const bad = [WX.cells.length, __hm.errors.length];
              X.wxLoad(JSON.parse(json));
              const fin = WX.cells.every((c) => isFinite(c.x) && isFinite(c.z) && isFinite(c.s) && c.a >= 50);
              return { bytes: json.length, n, kinds, back, old, bad, fin }; })()""")
            check(r['back'][0] == r['n'] and r['back'][1] == r['kinds'], f"the systems come back as they were saved ({r['back']})")
            check(r['bytes'] < 6000, f"in a small part ({r['bytes']} bytes)")
            check(r['old'] == 0, 'an old save (no part) loads with none')
            check(r['bad'][1] == 0 and r['fin'], f"a damaged part loads sanely ({r['bad']})")

        if 'shelter' in ONLY:
            # the shelter map over every building in the world
            r = await ev(page, 'shelter', """(() => { const X = W2T.X, H = __hm, S = X.WXS; X.wxShelterBuild();
              const out = { builds: S.builds, ms: +S.ms.toFixed(1), counts: S.counts, houses: 0, housePts: 0, houseMiss: 0, outPts: 0, outLeak: 0, towers: 0, towerPts: 0, towerMiss: 0, missAt: [] };
              for (const Hh of H.HOUSES) {
                if (Hh.state !== 'whole') continue; out.houses++;
                const R = Hh.round ? Hh.r : Math.max(Hh.w, Hh.d) / 2;
                for (let dz = -R; dz <= R; dz += 0.7) for (let dx = -R; dx <= R; dx += 0.7) {
                  const x = Hh.x + dx, z = Hh.z + dz;
                  if (!H.fn.houseHas(Hh, x, z, 0.25)) continue;
                  for (const y of [Hh.y + 0.3, Hh.y + 1.6]) { out.housePts++; if (!X.wxSheltered(x, z, y)) { out.houseMiss++; if (out.missAt.length < 6) out.missAt.push(['house', Hh.num, Math.round(x), Math.round(z), +(y - Hh.y).toFixed(1), +X.wxShelterY(x, z).toFixed(1)]); } }
                }
                // and the open ground 3 m out from its walls is under the sky (unless something else stands over it)
                for (let k = 0; k < 8; k++) { const a = k / 8 * Math.PI * 2, rr = (Hh.round ? Hh.r : Math.hypot(Hh.w, Hh.d) / 2) + 3.2, x = Hh.x + Math.cos(a) * rr, z = Hh.z + Math.sin(a) * rr;
                  if (H.HOUSES.some((Q) => Math.hypot(Q.x - x, Q.z - z) < (Q.round ? Q.r : Math.hypot(Q.w, Q.d) / 2) + 2.5) || H.towers.TOWER.list.some((T) => Math.hypot(T.wx - x, T.wz - z) < 12)) continue;
                  out.outPts++; if (X.wxSheltered(x, z, H.fn.heightAt(x, z) + 1)) out.outLeak++; }
              }
              for (const T of H.towers.TOWER.list) {
                if (T.breached) continue; out.towers++;
                const RI = T.kind === 'drum' ? T.RI : T.HI;
                for (const L of T.levels) {
                  const y = T.S.y + L + 0.5; if (y > T.S.y + T.shelterY - 0.6) continue;
                  for (let k = 0; k < 12; k++) { const a = k * 2.399, rr = Math.sqrt((k + 0.5) / 12) * (RI - 0.4);
                    const lx = T.cx + Math.sin(a) * rr, lz = T.cz + Math.cos(a) * rr, c = Math.cos(T.S.yaw), s = Math.sin(T.S.yaw);
                    const x = T.S.x + lx * c + lz * s, z = T.S.z - lx * s + lz * c; out.towerPts++;
                    if (!X.wxSheltered(x, z, y)) { out.towerMiss++; if (out.missAt.length < 10) out.missAt.push(['tower', T.look, T.role, Math.round(x), Math.round(z), +L.toFixed(1)]); } }
                }
              }
              // no drift lies on a floor inside a house or a tower's room
              let dv = 0, dIn = 0;
              const TR = H.weather2.TRACKS;
              const list = TR && TR.drifts ? TR.drifts : [];
              for (const D of list) { const P = D.m.geometry.attributes.position, A = D.m.geometry.attributes.aD; if (!P || !P.array || !P.array.length) continue;
                for (let i = 0; i < P.count; i++) { if (A.getX(i) < 0.05) continue; const x = P.getX(i), z = P.getZ(i); dv++;
                  const Hh = H.fn.houseAt(x, z); if ((Hh && H.fn.houseHas(Hh, x, z, 0.1)) || H.towers.TOWER.list.some((T) => !T.breached && Math.hypot(T.wx - x, T.wz - z) < (T.kind === 'drum' ? T.RI : T.HI) - 0.2)) dIn++; } }
              out.driftVerts = dv; out.driftInside = dIn; out.driftSheltered = TR ? TR.driftsSheltered : null;
              return out; })()""")
            check(r['houses'] > 12 and r['housePts'] > 2000, f"every house and hall looked at ({r['houses']}, {r['housePts']} points)")
            check(r['houseMiss'] == 0, f"inside every house and hall the roof is over you ({r['houseMiss']} points not: {r['missAt'][:4]})")
            check(r['outLeak'] <= max(1, r['outPts'] // 50), f"and 3 m out from their walls the sky ({r['outLeak']} of {r['outPts']})")
            check(r['towers'] > 20 and r['towerMiss'] == 0, f"every tower's rooms are under cover ({r['towers']} towers, {r['towerMiss']} of {r['towerPts']} points not)")
            check(r['driftInside'] == 0, f"no drift on a floor inside ({r['driftInside']} of {r['driftVerts']} drift points; {r['driftSheltered']} faces kept out)")
            check(r['counts'].get('floors', 0) > 0, f"the walks over open ground shelter what is under them ({r['counts']})")

        if 'inside' in ONLY:
            # rendered: the same view with a blizzard over a white winter and with no snow at all; inside, no difference
            views = await ev(page, 'views', """(() => { const H = __hm, out = [];
              const Hh = H.HOUSES.find((Q) => !Q.keepHall && Q.state === 'whole' && !Q.round && Q.w > 4.5), hall = H.HOUSES.find((Q) => Q.keepHall && Q.state === 'whole');
              const rh = H.HOUSES.find((Q) => !Q.keepHall && Q.state === 'whole' && Q.round);
              const look = (Q, k) => { const c = Q.c, s = Q.s, x = Q.x, z = Q.z; return [x, Q.y + 1.7, z, x + s * 1.2 * k, Q.y + 0.1, z + c * 1.2 * k]; };
              if (Hh) out.push(['house', ...look(Hh, 1)]);
              if (rh) out.push(['roundhouse', ...look(rh, -1)]);
              if (hall) out.push(['hall', ...look(hall, 1)]);
              for (const [name, q] of [['logres_store', (T) => T.look === 'stone' && T.role === 'corner'], ['thule_room', (T) => T.look === 'timber' && T.role === 'corner'], ['eriu_store', (T) => T.look === 'rath' && T.role === 'gate']]) {
                const T = H.towers.TOWER.list.find(q); if (!T) continue;
                const y = T.S.y + T.levels[0] + 1.6; out.push([name, T.wx, y, T.wz, T.wx + 0.8, y - 1.5, T.wz + 0.6]);
                if (name === 'thule_room' && T.levels[1] !== undefined) { const y2 = T.S.y + T.levels[1] + 1.6; out.push(['thule_room_up', T.wx, y2, T.wz, T.wx + 0.8, y2 - 1.5, T.wz + 0.6]); }
              }
              const P = H.GAME.player; out.push(['outside', P.x, P.y + 2, P.z, P.x + 4, P.y, P.z + 3]);
              return out; })()""")
            for v in views:
                name = v[0]
                r = await ev(page, 'inside ' + name, f"""(() => {{ const H = __hm, v = {json.dumps(v)};
                  W2T.cam(v[1], v[2], v[3], v[4], v[5], v[6]); H.setTod(0.4);
                  W2T.winterSnow(true); for (let i = 0; i < 4; i++) H.frame(1 / 30); W2T.W.snow = 1; H.frame(0); const A = W2T.px(0.1, 0.1, 0.9, 0.9);
                  W2T.winterSnow(false); W2T.W.snow = 0; H.frame(0); const B = W2T.px(0.1, 0.1, 0.9, 0.9);
                  return {{ ...W2T.diff(A.raw, B.raw), lA: +A.l.toFixed(1), lB: +B.l.toFixed(1), snowing: +H.dbg.WEATHER.snowing.toFixed(2), errors: H.errors.length }}; }})()""")
                if name == 'outside':
                    check(r['mean'] > 4, f"outside the same blizzard shows (mean difference {r['mean']}, the method sees snow)")
                else:
                    check(r['mean'] < 1.0, f"inside {name}: no snow lies or falls (mean difference {r['mean']}, at most {r['max']}; light {r['lA']} / {r['lB']})")

        await page.evaluate("W2T.winterEnd && W2T.winterEnd(); 0")
        if 'clouds' in ONLY:
            r = await ev(page, 'clouds', """(() => { const X = W2T.X, H = __hm, P = W2T.P(); W2T.live(); const F = X.WX_FAIR || null;
              H.farm.setSeason(0.4); H.setTod(0.4);
              const fair = __hm.weather2.fairSet([0, 0, 0]);
              W2T.cam(P.x, P.y + 3, P.z, P.x + 100, P.y + 40, P.z);
              for (let i = 0; i < 4; i++) H.frame(1 / 30);
              const clearUp = W2T.dome([0.3, 0.6, 0.2]), clearN = W2T.dome([0, 0.25, -1]);
              // a storm 900 m to the east: dark and opaque that way, still clear to the west
              const c = X.wxMake('storm', P.x + 900, P.z, { age: 150, ang: 0 }); c.sp = 0; c.life = 1e6;
              for (let i = 0; i < 4; i++) H.frame(1 / 30);
              const dirS = [900, 260 - (P.y + 3), 0];
              const storm = W2T.dome(dirS), west = W2T.dome([-900, 260 - P.y, 0]);
              const fld = W2T.field(c.x, c.z), fldW = W2T.field(P.x - 900, P.z);
              __hm.weather2.fairSet(fair);
              return { clearUp, clearN, storm, west, fld, fldW, errors: H.errors.length }; })()""")
            check(r['clearUp'][3] > 0.9 and r['clearN'][3] > 0.9, f"a calm sky lets the light through ({r['clearUp']}, {r['clearN']})")
            check(r['storm'][3] < 0.35, f"toward the storm the dome is cloud ({r['storm']})")
            check(r['west'][3] > 0.8, f"the other way it is clear ({r['west']})")
            check(r['fld'][2] > 0.5 and r['fldW'][2] < 0.05, f"the cloud field rains under the storm, not beside it ({r['fld']} / {r['fldW']})")
            # the moon: shining in a clear sky, gone behind a cloud bank
            r = await ev(page, 'moon', """(() => { const X = W2T.X, H = __hm, P = W2T.P(); W2T.live(); const fair = __hm.weather2.fairSet([0, 0, 0]);
              H.setTod(2.0); for (let i = 0; i < 3; i++) H.frame(1 / 30);
              const M = H.dbg.skyU ? H.dbg.skyU.uMoonDir.value : null;
              const m = [M.x, M.y, M.z], cy = P.y + 3;
              W2T.cam(P.x, cy, P.z, P.x + m[0] * 100, cy + m[1] * 100, P.z + m[2] * 100); H.frame(1 / 30); H.frame(1 / 30);
              const clear = W2T.px(0.47, 0.47, 0.53, 0.53).l;
              const t = (300 - cy) / Math.max(m[1], 0.05), c = X.wxMake('bank', P.x + m[0] * t, P.z + m[2] * t, { age: 200 }); c.sp = 0; c.life = 1e6; c.a = Math.max(c.a, 500); c.b = Math.max(c.b, 400);
              for (let i = 0; i < 4; i++) H.frame(1 / 30);
              const cloud = W2T.px(0.47, 0.47, 0.53, 0.53).l;
              __hm.weather2.fairSet(fair);
              const scr = !!X.WXR.scrOn && !!X.WXR.scr, scrK = X.WXR.scr ? [X.WXR.scr.width, X.WXR.scr.height] : null;
              return { moon: m.map((v) => +v.toFixed(2)), clear: +clear.toFixed(1), cloud: +cloud.toFixed(1), scr, scrK }; })()""")
            check(r['clear'] > r['cloud'] * 1.6 and r['clear'] > 60, f"the moon shines in a clear sky and is hidden behind a cloud ({r['clear']} / {r['cloud']})")
            check(r['scr'], f"the view's own clouds are drawn (a pass of {r['scrK']})")

        if 'shots' in ONLY and SHOTS:
            sfx = ('phone_' if PHONE else '') + Q
            async def shot(name, js):
                await page.evaluate(js)
                await page.evaluate("(() => { for (let i = 0; i < 3; i++) __hm.frame(1 / 30); return 0; })()")
                await page.screenshot(path=OUT + f'weather2_{name}_{sfx}.png', timeout=300000)
                print('  shot', name, f'[{time.time() - T0:.0f}s]', flush=True)
            setup_js = "(() => { W2T.live(); __hm.farm.setSeason(0.4); __hm.fn.weatherAdvance(5); return 0; })()"
            await page.evaluate(setup_js)
            # a front coming in over a keep, seen from its wall walk
            await shot('front_keep', """(() => { const H = __hm, X = W2T.X, K = H.weather2.sites.find((s) => s.kind === 'keep' && s.realm === 0); H.setTod(0.55);
              const v = { x: -Math.sin(X.WX.wind.from), z: Math.cos(X.WX.wind.from) };
              const c = X.wxMake('front', K.x - v.x * 1400, K.z - v.z * 1400, { age: 220 }); c.sp = 0;
              X.wxMake('shower', K.x - v.x * 700 + v.z * 300, K.z - v.z * 700 - v.x * 300, { age: 120 }).sp = 0;
              W2T.cam(K.x, K.y + 9, K.z, K.x - v.x * 300, K.y + 60, K.z - v.z * 300); __hm.fn.weatherAdvance(5); return 0; })()""")
            # a storm over the frontier from a town
            await shot('storm_frontier', """(() => { const H = __hm, X = W2T.X; W2T.live(); const T = H.weather2.sites.find((s) => s.kind === 'town' && s.realm === 1); H.setTod(1.05);
              const dx = -T.x, dz = -T.z, L = Math.hypot(dx, dz), ux = dx / L, uz = dz / L;
              const c = X.wxMake('storm', T.x + ux * 900, T.z + uz * 900, { age: 150 }); c.sp = 0;
              W2T.cam(T.x, T.y + 8, T.z, T.x + ux * 300, T.y + 70, T.z + uz * 300); __hm.fn.weatherAdvance(5); return 0; })()""")
            # the moon between clouds
            await shot('moon_clouds', """(() => { const H = __hm, X = W2T.X, P = W2T.P(); W2T.live(); H.setTod(2.0); H.frame(1 / 30);
              const M = H.dbg.skyU.uMoonDir.value, cy = P.y + 3, t = (330 - cy) / Math.max(M.y, 0.05);
              const hl = Math.hypot(M.x, M.z) || 1, sx = -M.z / hl, sz = M.x / hl;
              X.wxMake('bank', P.x + M.x * t + sx * 560, P.z + M.z * t + sz * 560, { age: 200, ang: Math.atan2(sz, sx) }).sp = 0; X.wxMake('bank', P.x + M.x * t * 1.6 - sx * 640, P.z + M.z * t * 1.6 - sz * 640, { age: 200, ang: Math.atan2(sz, sx) }).sp = 0;
              W2T.cam(P.x, cy, P.z, P.x + M.x * 100, cy + M.y * 100 - 18, P.z + M.z * 100); __hm.fn.weatherAdvance(3); return 0; })()""")
            # a clear sky after rain: the shower moved off, the ground wet
            await shot('after_rain', """(() => { const H = __hm, X = W2T.X, P = W2T.P(); W2T.live(); H.setTod(0.7);
              const c = X.wxMake('shower', P.x + 600, P.z + 200, { age: 200 }); c.sp = 0; X.WX.grid.wet.fill(0.8); W2T.W.wet = 0.8;
              W2T.cam(P.x, P.y + 4, P.z, P.x + 100, P.y + 25, P.z + 30); __hm.fn.weatherAdvance(5); return 0; })()""")
            # rain under its cloud, clear beside it, seen from the side
            await shot('rain_edge', """(() => { const H = __hm, X = W2T.X, P = W2T.P(); W2T.live(); H.setTod(0.45);
              const c = X.wxMake('storm', P.x + 520, P.z - 120, { age: 160 }); c.sp = 0;
              W2T.cam(P.x - 150, P.y + 10, P.z, P.x + 400, P.y + 40, P.z - 100); __hm.fn.weatherAdvance(5); return 0; })()""")
            # mist lying in a valley at dawn
            await shot('mist_valley', """(() => { const H = __hm, X = W2T.X, P = W2T.P(); W2T.live(); H.setTod(2.85);
              const c = X.wxMake('mist', P.x, P.z, { age: 120 }); c.sp = 0; c.life = 1e6;
              W2T.cam(P.x - 40, P.y + 14, P.z - 40, P.x + 120, P.y, P.z + 120); __hm.fn.weatherAdvance(12); return 0; })()""")
            # inside a house in a blizzard
            await shot('inside_blizzard', """(() => { const H = __hm, Q = H.HOUSES.find((h) => !h.keepHall && h.state === 'whole' && !h.round && h.w > 4.5); H.setTod(0.45);
              W2T.cam(Q.x - Q.s * 0.3, Q.y + 1.6, Q.z - Q.c * 0.3, Q.x + Q.s * 3, Q.y + 0.6, Q.z + Q.c * 3); W2T.winterSnow(true); return 0; })()""")
            await page.evaluate("W2T.winterSnow(false); W2T.winterEnd(); 0")

        r = await ev(page, 'end', "({ errors: __hm.errors.slice(0, 5) })")
        check(not r['errors'], 'no runtime errors')
        for l in logs[:5]: print(l)
        await b.close()
    print(f'\n{len(FAILS)} failed' + (': ' + '; '.join(FAILS) if FAILS else ''), flush=True)
    sys.exit(1 if FAILS else 0)

asyncio.run(main())
