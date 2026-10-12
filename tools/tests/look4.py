"""[look4] (version 15) The world looked at again, checked by number: a house brought down by stones lies in rubble (its
walls broken off, its colliders and the shots' walls cut down with them, the broken tops closed, the rubble heaped) and is
built back behind a working scaffold (its standards solid, its boards floors, its ladder climbed with the climber's hands
and feet on the rungs, the walls rising course by course, the new roof frame on them, the townsfolk at the wall inside
it); a castle's scaffold ladder has its rungs where a climber's limbs reach; the firefighters' beater; the map's names
laid out clear of each other, the sites' marks and the guide's gem (on a desk and a phone); then pictures of the look4
group of tools/tests/look_views.js unless noshots.
usage: python3 tools/tests/look4.py [noshots] [only=ruin,scaffold,ladder,map,beater] [shots=view:q:variant,...] [tag=now]"""
import json, asyncio, sys, time, pathlib, base64, io
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
import hm
from hmlib import OUT
from playwright.async_api import async_playwright
try:
    from PIL import Image
except ImportError:
    Image = None
VIEWS_JS = pathlib.Path(__file__).resolve().parent / 'look_views.js'
# (look.py's own setup and grab: importing look.py would run it)
HOLD = """(() => { let s = 1234567; Math.random = () => { s |= 0; s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; })();
(() => { window.__rafHold = false; const raf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = (cb) => raf((t) => { if (window.__rafHold) window.requestAnimationFrame(cb); else cb(t); }); })();"""
async def setup(p, w, h, touch=False):
    b = await p.chromium.launch(args=['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
    ctx = await b.new_context(viewport={'width': w, 'height': h}, has_touch=touch, is_mobile=touch)
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
    return b, page, logs
async def grab(page, path, frames=2):
    url = await page.evaluate(f"(() => {{ for (let i = 0; i < {frames}; i++) __hm.frame(1/30); return __hm.dbg.renderer.domElement.toDataURL('image/png'); }})()")
    data = base64.b64decode(url.split(',', 1)[1])
    if Image: Image.open(io.BytesIO(data)).convert('RGB').save(path)
    else: pathlib.Path(path).write_bytes(data)

ARGS = sys.argv[1:]
OPT = dict(a.split('=', 1) for a in ARGS if '=' in a)
FLAGS = {a for a in ARGS if '=' not in a}
ONLY = OPT.get('only', 'ruin,scaffold,ladder,map,beater').split(',')
TAG = OPT.get('tag', 'now')
T0 = time.time()
FAILS = []
def check(cond, what):
    print(('  ok   ' if cond else '  FAIL ') + what, flush=True)
    if not cond: FAILS.append(what)
async def ev(page, js):
    return await page.evaluate(js)

T4 = r"""
window.T4 = {
  H: __hm, F: __hm.fn, Rb: __hm.rubble,
  sim(s) { const H = this.H, m = H.UI.modal; H.UI.modal = null; H.simulate(s); H.UI.modal = m; },
  house(r, n, style) { const S = this.H.REALMS[r].town; const hs = S.houses.map((h) => h.rec).filter((h) => h && !h.keepHall && h.state === 'whole'); hs.sort((a, b) => Math.hypot(a.x - S.x, a.z - S.z) - Math.hypot(b.x - S.x, b.z - S.z)); return hs[n] || hs[0]; },
  // the wall's colliders' tops, and a shot across a wall at a height (does it strike the house?)
  shotAcross(H, y) {
    const F = H.door.F, a = this.F.houseWorldOnFace ? null : null;
    // across the middle of its back wall, from 3 m out to 3 m in, at height y over the floor
    const W = this.H.walls, l0 = H.round ? { x: 0, z: -(H.r + 0.7) } : { x: 0.3, z: -(H.d / 2 + 0.7) }, l1 = H.round ? { x: 0, z: -(H.r - 3) } : { x: 0.3, z: -(H.d / 2 - 3) };
    const w0 = { x: H.x + l0.x * H.c + l0.z * H.s, z: H.z - l0.x * H.s + l0.z * H.c }, w1 = { x: H.x + l1.x * H.c + l1.z * H.s, z: H.z - l1.x * H.s + l1.z * H.c };
    const R = W.shotHit(w0.x, H.y + y, w0.z, w1.x, H.y + y, w1.z, { ground: false });
    return R ? R.what : null;
  },
  ruin(r, n) {
    const H = this.house(r, n), Rb = this.Rb, out = { style: H.style, round: !!H.round };
    out.h0 = Math.max(...H.coll.filter((c) => c.tag === 'house').map((c) => c.h));
    out.shotHigh0 = this.shotAcross(H, 2.0); out.shotLow0 = this.shotAcross(H, 0.25);
    this.H.batter.houseBreak(H, null); this.sim(0.5);
    out.fell = Rb.fell(H); out.state = H.state;
    const R = Rb.RUBBLE.list.get(H); out.mesh = !!(R && R.mesh); out.info = R && R.info;
    out.h1 = Math.max(...H.coll.filter((c) => c.tag === 'house').map((c) => c.h));
    out.shotHigh1 = this.shotAcross(H, 2.0); out.shotLow1 = this.shotAcross(H, 0.25);
    // the stubs: every one between knee and chest height, the shader's uniforms: the walls' measures and the level
    const runs = Rb.houseRubbleRuns(H); let lo = 9, hi = 0;
    for (const run of runs) for (let i = 0; i < run.n; i++) { const s = Rb.houseRubbleStub(H, run, i); lo = Math.min(lo, s); hi = Math.max(hi, s); }
    out.stub = [+lo.toFixed(2), +hi.toFixed(2)];
    this.H.frame(1 / 30);
    const TU = H.S.houseSet.TU; out.uY = TU.uHY.value[H.slot].w; out.dims = Rb.dims(H); out.uD = [TU.uHD.value[H.slot].x, +TU.uHD.value[H.slot].w.toFixed(2)];
    this.ruinH = this.ruinH || []; this.ruinH.push(H);
    return out;
  },
  // the same house put back: its scaffold, its walls rising, the roof frame, and whole again
  rebuild(H) {
    const Rb = this.Rb, out = {};
    H.stT = 1e4; this.sim(0.3);
    out.state = H.state;
    const Q = Rb.HSCAF.list.get(H); out.scaf = !!Q; if (!Q) return out;
    out.info = Q.info; out.colls = Q.colls.filter((c) => c.active).length; out.floors = Q.l3 ? Q.l3.floors.filter((f) => f.active).length : 0; out.ladders = Q.l3 ? Q.l3.ladders.filter((L) => !L.gone).length : 0;
    out.lv = [];
    for (const k of [0.1, 0.3, 0.5, 0.7]) { H.stT = 70 * k; this.sim(0.1); this.H.frame(1 / 30); out.lv.push([k, Rb.houseRubbleLevel(H), H.S.houseSet.TU.uHD.value[H.slot].x, Q.key]); }
    // a body climbs its ladder onto the boards
    const L = Q.l3.ladders.find((q) => !q.gone);
    if (L) {
      const e = this.F.spawnRealmUnit(H.realm, 'warrior', 30, 'guard', L.fx, L.fz, { yaw: L.yawW }); e.ai.post = null; e.hp = e.maxHp = 1e7; e.y = L.wyb;
      this.H.towers.towerClimb(e, L, 1); let t = 0; while (e.motion && t < 12) { this.sim(0.1); t += 0.1; }
      out.climb = { t: +t.toFixed(1), y: +(e.y - L.wyt).toFixed(2), floor: +(this.F.floorAt(e.x, e.z, e.y + 0.1) - L.wyt).toFixed(2) };
      this.F.removeEnt(e);
    }
    // the townsfolk at work: the spot inside the scaffold at the wall, clear of every collider
    const sp = Rb.houseScafWorkSpot(H, 1); out.spot = sp ? { solid: !!this.F.collidersNear && (() => { const near = []; this.F.collidersNear(sp.x, sp.z, 2, near); return near.filter((c) => c.active !== false && (c.type === 'circle' ? Math.hypot(sp.x - c.x, sp.z - c.z) < c.r + 0.3 : (() => { const dx = sp.x - c.x, dz = sp.z - c.z, lx = dx * c.cos - dz * c.sin, lz = dx * c.sin + dz * c.cos; return Math.abs(lx) < c.hx + 0.3 && Math.abs(lz) < c.hz + 0.3; })())).length; })(), d: +Math.hypot(sp.x - sp.fx, sp.z - sp.fz).toFixed(2) } : null;
    H.stT = 69.9; this.sim(0.3);
    out.after = { state: H.state, rub: !!H.rub, colls: Q.colls.filter((c) => c.active).length, floors: Q.l3.floors.filter((f) => f.active).length, ladders: Q.l3.ladders.filter((L) => !L.gone).length, mesh: !!Q.mesh, rubble: Rb.RUBBLE.list.has(H), h: Math.max(...H.coll.filter((c) => c.tag === 'house').map((c) => c.h)), shotHigh: this.shotAcross(H, 2.0) };
    return out;
  },
  // a climber's hands and feet on a ladder's rungs (look3's scaffold or a house's): each holds still on a rung
  climbRungs(L, sec = 3.0) {
    const H = this.H, P = H.GAME.player, M = H.motion;
    P.x = P.prevX = L.fx; P.z = P.prevZ = L.fz; P.y = L.wyb; P.motion = null; P.hp = P.maxHp = 1e7; P.onGround = true; P.vy = 0; P.anim.act = 0; P.anim.actDur = 0; H.UI.modal = null;
    H.towers.towerClimb(P, L, 1);
    const fx = Math.sin(L.yawW), fz = Math.cos(L.yawW), rungs = []; for (let y = 0.3; y < L.wyt - L.wyb + 0.75; y += 0.3) rungs.push(L.wyb + y); // (a scaffold's ladder stands 0.8 m over the boards it leads to)
    const Fr = { rungs, fx, fz, lx: L.lx, lz: L.lz, ahead: (L.rx - L.lx) * fx + (L.rz - L.lz) * fz };
    const rec = M.motionRun([{ e: P, kind: 'human', which: ['feet', 'hands'] }], sec, 1 / 60, { cam: () => { H.UI.modal = null; H.CAM.mode = 'fixed'; H.camera.position.set(P.x + 4, P.y + 2, P.z + 4); H.camera.lookAt(P.x, P.y + 1, P.z); H.camera.updateMatrixWorld(); } });
    const S = rec[0].filter((s) => s.L && s.L.feet && s.L.hands && s.y > L.wyb + 0.05 && s.y < L.wyt - 0.05), out = { feet: [], hands: [], ahead: +Fr.ahead.toFixed(3), n: S.length };
    const onRung = (p) => { const a = (p[0] - Fr.lx) * Fr.fx + (p[2] - Fr.lz) * Fr.fz; let best = 9; for (const r of Fr.rungs) { const d = p[1] - r; if (Math.abs(d) < Math.abs(best)) best = d; } return { a, dy: best }; };
    for (const part of ['feet', 'hands']) for (let f = 0; f < 2; f++) {
      let run = [];
      const close = () => { if (run.length >= 4) { const m = run[Math.floor(run.length / 2)], r = onRung(m); out[part].push({ n: run.length, a: +r.a.toFixed(3), dy: +r.dy.toFixed(3) }); } run = []; };
      for (let i = 1; i < S.length; i++) { const p = S[i].L[part][f], q = S[i - 1].L[part][f]; if (!p || !q) { close(); continue; } const v = Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]) * 60; if (v < 0.15) run.push(part === 'feet' ? [p[0], p[3], p[2]] : [p[0], p[1], p[2]]); else close(); }
      close();
    }
    P.motion = null;
    return out;
  },
};
0;
"""

async def main():
    async with async_playwright() as p:
        b, page, logs = await setup(p, 960, 540)
        print(f'booted [{time.time() - T0:.0f}s]', flush=True)
        await page.evaluate("__hm.start({realm:0, cls:'warrior', level:30}); 0")
        await page.evaluate(VIEWS_JS.read_text() + '\n;0')
        await page.evaluate("LK.boot(); 0")
        await page.evaluate(T4)
        print(f'started [{time.time() - T0:.0f}s]', flush=True)
        if 'ruin' in ONLY or 'scaffold' in ONLY:
            for r, n in ((0, 2), (1, 1), (2, 1)):
                o = await ev(page, f"T4.ruin({r}, {n})")
                print(f'  ruin realm {r}: {json.dumps(o)}', flush=True)
                check(o['fell'] and o['state'] == 'ruin' and o['mesh'] and o['info']['caps'] >= 8 and o['info']['stones'] >= 20, f"realm {r} ({o['style']}): a house brought down by stones lies in rubble: broken tops closed ({o['info']['caps']} caps, {o['info']['ends']} step ends), {o['info']['stones']} stones heaped, {o['info']['timbers']} timbers")
                check(0.29 <= o['stub'][0] and o['stub'][1] <= 1.46, f"realm {r}: its walls stand {o['stub'][0]}-{o['stub'][1]} m (knee to chest height)")
                check(o['uY'] == o['dims'] and abs(o['uD'][0]) < 1e-6 and o['uD'][1] > 2.5, f"realm {r}: the shader knows the walls' measures ({o['uY']}) and that it fell, level 0 ({o['uD']})")
                check(o['h0'] > 3 and o['h1'] <= 1.61, f"realm {r}: its walls' colliders stand {o['h1']:.2f} m (were {o['h0']:.2f})")
                check(o['shotHigh0'] == 'house' and o['shotHigh1'] != 'house' and o['shotLow1'] == 'house', f"realm {r}: a shot at 2 m crosses its broken wall (was {o['shotHigh0']}, now {o['shotHigh1']}), one at 0.25 m strikes it ({o['shotLow1']})")
        if 'scaffold' in ONLY:
            for i in range(3):
                o = await ev(page, f"T4.rebuild(T4.ruinH[{i}])")
                print(f'  rebuild {i}: {json.dumps(o)}', flush=True)
                if not o.get('scaf'): check(False, f'house {i}: its scaffold goes up ({o})'); continue
                inf = o['info']
                check(o['state'] == 'scaffold' and inf['standards'] >= 6 and inf['boards'] >= 10 and inf['ladders'] >= 1 and o['colls'] >= 6 and o['floors'] >= 3 and o['ladders'] >= 1, f"house {i}: built back behind a working scaffold ({inf['standards']} standards solid ({o['colls']}), {inf['bays']} bays, {o['floors']} floors of boards, {o['ladders']} ladder(s))")
                lv = o['lv']
                check(lv[0][1] < lv[1][1] < lv[2][1] and lv[3][1] > 1e3 and all(abs(q[1] - q[2]) < 1e-3 or q[1] > 1e3 for q in lv) and lv[3][3] == 'roof' and lv[0][3] == 'up', f"house {i}: its walls rise course by course ({[q[1] for q in lv]}), the shader told, the roof frame on them once they stand ({[q[3] for q in lv]})")
                c = o.get('climb') or {}
                check(c and abs(c['y']) < 0.05 and abs(c['floor']) < 0.05, f"house {i}: a body climbs its ladder onto the boards ({c})")
                sp = o.get('spot') or {}
                check(sp and sp['solid'] == 0 and sp['d'] <= 0.8, f"house {i}: the townsfolk work inside it at the wall ({sp})")
                a = o['after']
                check(a['state'] == 'whole' and not a['rub'] and a['colls'] == 0 and a['floors'] == 0 and a['ladders'] == 0 and not a['mesh'] and not a['rubble'] and a['h'] > 3 and a['shotHigh'] == 'house', f"house {i}: whole again, the scaffold down (colliders, floors and ladder off), the walls' colliders whole ({a})")
        if 'ladder' in ONLY:
            # a breached tower's scaffold (look3's) and a house's: the climber's hands and feet on the rungs
            r = await ev(page, """(() => { const L = LK.views.mend.call(LK, LK); const S = LK.keepSite(0, 0), C = __hm.fn.castles().find((q) => q.S === S), W = C.sections.find((q) => q.kind === 'tower' && q.T.role === 'corner' && q.T.sx === -1 && q.T.sz === -1); S.keepRef.lastEnemyNear = __hm.GAME.t + 1e6; const Ld = W.l3 && W.l3.ladders.find((q) => q.k === 0); return Ld ? T4.climbRungs(Ld, 3.0) : { none: true }; })()""")
            for name, rr in (('a tower scaffold', r),):
                if rr.get('none'): check(False, f'{name}: a ladder to climb'); continue
                ah, fe, ha = rr['ahead'], rr['feet'], rr['hands']
                print(f"  {name}: rung line {ah} m ahead; feet {json.dumps(fe)[:300]}; hands {json.dumps(ha)[:300]}", flush=True)
                check(len(fe) >= 6 and all(0.012 <= q['dy'] <= 0.045 and ah - 0.1 <= q['a'] <= ah + 0.06 for q in fe), f"{name}: every foot stands on a rung while it holds ({len(fe)} holds, {min([q['dy'] for q in fe] or [0])}-{max([q['dy'] for q in fe] or [0])} m over its middle, {min([q['a'] for q in fe] or [0])}-{max([q['a'] for q in fe] or [0])} m ahead)")
                check(len(ha) >= 6 and all(abs(q['dy']) <= 0.06 and abs(q['a'] - ah) <= 0.06 for q in ha), f"{name}: every hand holds a rung while it holds ({len(ha)} holds, {min([q['dy'] for q in ha] or [0])}-{max([q['dy'] for q in ha] or [0])} m, {min([q['a'] for q in ha] or [0])}-{max([q['a'] for q in ha] or [0])} m ahead)")
        if 'beater' in ONLY:
            r = await ev(page, """(() => { const WB = __hm.fn.WB; return { bit: WB.beater, torch: WB.torch }; })()""")
            check(r['bit'] == 1 << 21 and r['torch'] == 1 << 20, f"the fire beater has its own part bit ({r}); the beaters view shows it in their hands")
        if 'map' in ONLY:
            for (w, h) in ((1280, 720), (390, 780)):
                await page.set_viewport_size({'width': w, 'height': h})
                r = await ev(page, """(() => { const H = __hm; H.UI.modal = null; document.getElementById('hud').hidden = false; try { H.guide.mark && H.guide.mark(); } catch (e) {}
                  __hm.fn.toggleMap ? __hm.fn.toggleMap(true) : document.dispatchEvent(new KeyboardEvent('keydown', { key: 'm', code: 'KeyM' }));
                  const L = H.look4.MAPL.last; if (!L) return { none: true };
                  const over = (a, b) => a[0] < b[2] - 0.5 && a[2] > b[0] + 0.5 && a[1] < b[3] - 0.5 && a[3] > b[1] + 0.5;
                  let n = 0; for (let i = 0; i < L.placed.length; i++) for (let j = i + 1; j < L.placed.length; j++) if (over(L.placed[i].box, L.placed[j].box)) n++;
                  return { n: L.placed.length, of: L.n, overlaps: n, pills: L.placed.filter((q) => q.pill).map((q) => q.t), names: L.placed.map((q) => q.t) }; })()""")
                print(f'  map {w}x{h}: {json.dumps(r)}', flush=True)
                check(not r.get('none') and r['overlaps'] == 0 and r['n'] >= (r['of'] - 3 if w > 600 else 12) and all(t in r['names'] for t in ('Brackenford', 'Glenrua', 'Skarvik', 'Logres', 'Thule')), f"the map at {w}x{h}: {r.get('n')} of {r.get('of')} names placed (every town, keep and realm), none over another ({r.get('overlaps')}), on pills: {r.get('pills')}")
                await page.screenshot(path=OUT + f'look4_{TAG}_map_{w}x{h}.png', timeout=300000)
                await ev(page, "(() => { __hm.fn.toggleMap ? __hm.fn.toggleMap(false) : null; document.getElementById('hud').hidden = true; return 0; })()")
            await page.set_viewport_size({'width': 960, 'height': 540})
        if 'noshots' not in FLAGS:
            shots = OPT.get('shots', 'ruin0:high:day,ruin1:medium:day,ruin2:low:day,house_scaf0:high:day,gate_burn:high:day,tower_roof:high:day,hallow:high:day,beaters:medium:day,scaf_climb:high:day').split(',')
            for s in shots:
                v, q, var = (s.split(':') + ['high', 'day'])[:3]
                await ev(page, f"__hm.fn.setQuality('{q}'); 0")
                info = await ev(page, f"LK.set('{v}', '{var}')")
                if isinstance(info, dict) and info.get('skip'): print(f'  skip {v}: {info}', flush=True); continue
                name = f'look4_{TAG}_{v}_{q}_{var}'
                await grab(page, OUT + name + '.png', 2)
                print(f'  shot {name} {json.dumps(info)[:300]} [{time.time() - T0:.0f}s]', flush=True)
        errs = await ev(page, "__hm.errors.map(String)")
        check(not errs, 'no runtime errors ' + json.dumps(errs)[:600])
        if logs: print('logs', logs[:4])
        print('FAILED:' if FAILS else 'ALL PASSED', FAILS, flush=True)
        await b.close()

asyncio.run(main())
