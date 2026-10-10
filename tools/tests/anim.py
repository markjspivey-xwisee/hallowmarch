"""Animation: planted feet and believable gaits for people, beasts and horses, and Cinderwing's flight.

Strobe pictures are chronophotographs: one body drawn at successive moments along its path, so a foot that is
planted on the ground stays on one spot while the body goes past it. The dragon gets a filmstrip of a wingbeat and a
glide, plus numbers: how far its wings travel, whether its trims keep moving in a glide, which way it banks.
The title tagline is checked too: one line on a desktop screen, broken only between its phrases on a phone.
usage: python3 tools/tests/anim.py [noshots]"""
import json, asyncio, sys, pathlib, time, math
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
from hmlib import setup, OUT
from playwright.async_api import async_playwright

ARGS = sys.argv[1:]
SHOTS = 'noshots' not in ARGS
FAILS = []
T0 = time.time()

def check(cond, what):
    print(('  ok   ' if cond else '  FAIL ') + what, flush=True)
    if not cond: FAILS.append(what)

async def ev(page, label, js):
    r = await page.evaluate(js)
    print(f'{label} [{time.time() - T0:.0f}s]', json.dumps(r)[:1400], flush=True)
    return r

# --- the planted-foot gait, ported from HUMAN_GAIT (05a_rig.js): a planted foot must not slide ---
L1, L2, REST1, REST2 = 0.4205, 0.4265, -0.038, 0.118
def human_step(v): return min(max(min(0.40 + 0.20 * v + 0.006 * v * v, v / 1.6), 0.03), 2.2)  # [motion] short steps when slow
def sstep(a, b, x):
    t = min(1, max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t)
def foot_path(u, duty, reach, lift_h, run_k):
    if u < duty: return reach * (1 - 2 * u / duty), 0.0
    w = (u - duty) / (1 - duty); e = w * w * (3 - 2 * w); wl = w ** (1.0 - 0.38 * run_k)
    return reach * (2 * e - 1), lift_h * math.sin(math.pi * wl) ** 0.85
def leg_ik(fz, fy):
    dm = (L1 + L2) * 0.998
    fz = max(-dm * 0.97, min(dm * 0.97, fz)); d2 = fz * fz + fy * fy
    if d2 > dm * dm: fy = -math.sqrt(dm * dm - fz * fz); d2 = dm * dm
    d = math.sqrt(d2); a0 = math.atan2(-fz, -fy)
    ca = max(-1, min(1, (L1 * L1 + d2 - L2 * L2) / (2 * L1 * d))); cb = max(-1, min(1, (d2 - L1 * L1 - L2 * L2) / (2 * L1 * L2)))
    return a0 - math.acos(ca) - REST1, math.acos(cb) - REST2
def gait_numbers(v):
    amt = min(v / 4.3, 2.2); vel = amt * 4.3; run_k = sstep(2.4, 4.4, vel); gk = sstep(0.02, 0.3, amt)
    duty = (0.58 + (0.26 - 0.58) * run_k) - 0.06 * sstep(6.5, 9.0, vel)
    S = human_step(vel); reach = duty * S; lift_h = (0.1 + 0.2 * run_k) * min(1, S / 0.42) * sstep(0, 0.04, amt); drop = (0.015 + 0.075 * run_k) * gk
    dt = 1 / 600; x = 0; ph = 1.5708; stance = []; slip = 0; ends = 0
    for _ in range(int(4 * 2 * S / v / dt)):
        x += v * dt; ph += dt * v * math.pi / S
        u = ((ph - 1.5708) * 0.159155) % 1
        bob = (0.022 + (-0.03 - 0.022) * run_k) * gk * math.cos(12.566 * (u - duty * 0.5))
        fz, fy = foot_path(u, duty, reach, lift_h, run_k)
        th, sh = leg_ik(fz, fy - 0.845 + drop - bob)
        a = th + REST1; b = sh + REST2
        wz = x - L1 * math.sin(a) - L2 * math.sin(a + b); wy = 0.94 - L1 * math.cos(a) - L2 * math.cos(a + b) + bob - drop
        if u < duty: stance.append((wz, wy))
        elif stance:
            zs = [p[0] for p in stance]; slip = max(slip, max(zs) - min(zs)); ends = max(ends, max(p[1] for p in stance) - 0.095); stance = []
    return {'v': v, 'step': round(S, 2), 'cadence': round(v / S, 2), 'slip_cm': round(slip * 100, 1), 'heel_cm': round(ends * 100, 1)}

HELPERS = r"""
window.A = {
  H: __hm, F: __hm.fn, made: [],
  clear() { for (const e of this.made) { if (e.mount) e.mount = null; this.F.removeEnt(e); } this.made = []; },
  // n copies of one body at successive moments dt apart, moving at v along the site's local +x at lz
  strobe(S, kind, v, n, dt, lz) {
    const F = this.F, c = Math.cos(S.yaw), s = Math.sin(S.yaw), yaw = Math.atan2(c, -s);
    const amt = Math.min(v / 4.3, 2.2), ph0 = 0.4;
    for (let i = 0; i < n; i++) {
      const lx = -((n - 1) * v * dt) / 2 + i * v * dt, p = F.siteToWorld(S, lx, lz);
      let e;
      if (kind === 'human' || kind === 'rider') e = F.spawnRealmUnit(0, 'warrior', 10, 'test', p.x, p.z);
      else e = F.makeEnt({ kind, faction: 4, role: 'test', name: 'strobe ' + kind, level: 5, x: p.x, z: p.z, y: F.heightAt(p.x, p.z), radius: 0.5, look: { colA: [0.45, 0.43, 0.4], colB: [0.3, 0.28, 0.26] }, scale: 1 });
      e.yaw = yaw; e.prevX = e.x; e.prevZ = e.z;
      const sc = e.scale || 1;
      if (kind === 'rider') {
        F.mountUp(e, true);
        const a = Math.min(v / 4.3, 1.5);
        e.mountAnim.amt = a; e.mountAnim.phase = ph0 + i * dt * v * Math.PI / F.beastStride('horse', a);
        e.anim.amt = a;
      } else {
        const stride = kind === 'human' ? F.humanStep(amt * 4.3 / sc) * sc : F.beastStride(kind, amt) * sc;
        e.anim.amt = amt; e.anim.phase = ph0 + i * dt * v * Math.PI / stride;
      }
      this.made.push(e);
    }
    return n;
  },
  // a side view of the strobe line at lz from dist away, eye at height h
  side(S, lz, dist, h, lookH) {
    const F = this.F, H = this.H, c = F.siteToWorld(S, 0, lz + dist), t = F.siteToWorld(S, 0, lz);
    H.camera.position.set(c.x, S.y + h, c.z); H.camera.lookAt(t.x, S.y + lookH, t.z);
  },
};
0
"""

async def frames(page, n=3):
    for _ in range(n): await page.evaluate("__hm.frame(1/60)")

async def shot(page, name):
    await page.screenshot(path=OUT + name + '.png', timeout=300000)
    print('  shot', name, f'[{time.time() - T0:.0f}s]', flush=True)

async def main():
    print('gait numbers (port of the shader):')
    worst = 0
    for v in [0.3, 0.7, 1.2, 1.6, 2.2, 3.4, 4.6, 6.5, 9.4]:
        g = gait_numbers(v); print('  ', g); worst = max(worst, g['slip_cm'])
        check(g['heel_cm'] < 14, f'at {v} m/s the heel rises at most 14 cm at the ends of a stance ({g["heel_cm"]} cm)')
    check(worst < 2.0, f'a planted foot slides less than 2 cm at any speed ({worst} cm)')
    async with async_playwright() as p:
        b, page, logs = await setup(p, w=1146, h=640)
        # the title tagline: one line on a desktop screen, and on a phone it breaks only between phrases
        r = await ev(page, 'tagline desktop', """(() => { const el = document.querySelector('#title .brand p'); const tops = new Set([...el.querySelectorAll('span')].map((s) => Math.round(s.getBoundingClientRect().top))); return { lines: tops.size, w: Math.round(el.getBoundingClientRect().width) }; })()""")
        check(r['lines'] == 1, 'the tagline sits on one line at 1146 px')
        if SHOTS:
            bb = await page.evaluate("(() => { const r = document.querySelector('#title .brand').getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; })()")
            await page.screenshot(path=OUT + 'title_tagline.png', clip=bb, timeout=300000)
            print('  shot title_tagline', flush=True)
        await page.set_viewport_size({'width': 390, 'height': 844})
        r = await ev(page, 'tagline phone', """(() => { const el = document.querySelector('#title .brand p'); const sp = [...el.querySelectorAll('span')]; const tops = sp.map((s) => Math.round(s.getBoundingClientRect().top)); const lines = new Set(tops).size; const one = sp.map((s) => s.getClientRects().length); return { lines, spanRects: one }; })()""")
        check(r['lines'] <= 2 and max(r['spanRects']) == 1, 'on a phone the tagline breaks only between its phrases')
        await page.set_viewport_size({'width': 800, 'height': 450})
        await page.evaluate("__hm.fn.setQuality('medium')")
        await page.evaluate("__hm.start({ realm: 0, cls: 'warrior', level: 20 })")
        await page.evaluate(HELPERS)
        await page.evaluate("""(() => { const H = __hm; H.UI.modal = 'menu'; H.CAM.mode = 'fixed'; H.setTod(0.45);
          const W = H.dbg.WEATHER; if (W) { W.mode = 'clear'; W.kind = 'clear'; W.nextBolt = 1e9; }
          for (const el of document.querySelectorAll('#hud, #nameplates, #floaters')) el.style.visibility = 'hidden';
          for (const m of H.dbg.grassMeshes) m.visible = false; })()""")
        # strobes on the trodden muster ground: walk, villager pace, run, wolf, horse at the gallop
        cases = [('human', 1.6, 7, 0.27, 'strobe_walk', 6.5, 1.0, 0.75), ('human', 6.5, 8, 1 / 22, 'strobe_run', 5.5, 1.0, 0.8),
                 ('wolf', 7.6, 8, 1 / 26, 'strobe_wolf', 4.5, 0.7, 0.45), ('rider', 12.0, 7, 1 / 22, 'strobe_horse', 8.5, 1.5, 1.1)]
        for kind, v, n, dt, name, dist, h, look in cases:
            await page.evaluate(f"""(() => {{ const S = __hm.REALMS[0].musterSite; A.clear(); A.strobe(S, '{kind}', {v}, {n}, {dt}, 7); A.side(S, 7, {dist}, {h}, {look}); }})()""")
            await frames(page, 3)
            if SHOTS: await shot(page, name)
        await page.evaluate("A.clear(); 0")
        # Cinderwing: a filmstrip of beats and of a glide, followed from behind and to one side
        await page.evaluate("""(() => { const H = __hm; H.UI.modal = null; for (const el of document.querySelectorAll('#hud, #nameplates, #floaters')) el.style.visibility = 'hidden'; })()""")
        DRAGON_CAM = """(() => { const H = __hm, D = H.dbg.DRAGON, e = D.e; if (!e) return 'no dragon';
            const fx = Math.sin(e.yaw), fz = Math.cos(e.yaw), rx = Math.cos(e.yaw), rz = -Math.sin(e.yaw);
            H.camera.position.set(e.x - fx * 24 + rx * 14, e.y + 9, e.z - fz * 24 + rz * 14); H.camera.lookAt(e.x, e.y + 3, e.z); return 0; })()"""
        r = await ev(page, 'dragon', """(() => { const D = __hm.dbg.DRAGON, e = D.e; return e ? { state: D.state, y: +e.y.toFixed(1) } : null; })()""")
        check(r is not None and r['state'] == 'fly', 'Cinderwing is aloft')
        # sample its pose over four seconds of beats, then four of glide
        r = await ev(page, 'wing travel', """(() => { const H = __hm, D = H.dbg.DRAGON, F = H.fn; D.fl = null; F.dragonAnimate(1/60); D.fl.mode = 'flap'; D.fl.left = 99;
            const arm = [], hand = [], body = [], roll = [], turn = [];
            for (let i = 0; i < 240; i++) { if (i % 3 === 0) H.simulate(0.05); F.dragonAnimate(1/60); arm.push(D.pose.wl[0]); hand.push(D.pose.wl[3]); body.push(D.pose.bodyY); roll.push(D.pose.bodyRoll); turn.push(D.fl.turn); }
            D.fl.mode = 'glide'; D.fl.left = 99; for (let i = 0; i < 90; i++) { if (i % 3 === 0) H.simulate(0.05); F.dragonAnimate(1/60); }
            const garm = [], ghand = [];
            for (let i = 0; i < 240; i++) { if (i % 3 === 0) H.simulate(0.05); F.dragonAnimate(1/60); garm.push(D.pose.wl[0]); ghand.push(D.pose.wl[3]); }
            const span = (a) => +(Math.max(...a) - Math.min(...a)).toFixed(2), mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
            return { arm: span(arm), hand: span(hand), body: span(body), roll: +mean(roll).toFixed(3), turn: +mean(turn).toFixed(3), glideArm: span(garm), glideHand: span(ghand), dir: D.circ.dir }; })()""")
        check(r['arm'] > 1.3 and r['hand'] > 0.8 and r['body'] > 0.4, 'in beating flight the wings sweep through a deep stroke, the hands whip and the body rises and falls')
        check(0.03 < r['glideArm'] < 0.4 and r['glideHand'] > 0.05, 'in a glide the wings are held out but never frozen: they trim and the tips flex')
        check(r['roll'] * r['turn'] < 0 and abs(r['roll']) > 0.05, 'it banks into its turn')
        if SHOTS:
            await page.evaluate("""(() => { const D = __hm.dbg.DRAGON; D.fl.mode = 'flap'; D.fl.left = 99; })()""")
            for i in range(4):
                await page.evaluate("__hm.frame(0.07); __hm.frame(0.07); 0")
                await page.evaluate(DRAGON_CAM)
                await page.evaluate("__hm.frame(1/120); 0")
                await shot(page, f'dragon_beat{i}')
            await page.evaluate("""(() => { const D = __hm.dbg.DRAGON; D.fl.mode = 'glide'; D.fl.left = 99; for (let i = 0; i < 60; i++) __hm.frame(1/30); return 0; })()""")
            await page.evaluate(DRAGON_CAM)
            await page.evaluate("__hm.frame(1/120); 0")
            await shot(page, 'dragon_glide')
        errs = await page.evaluate("__hm.errors")
        check(not errs, f'no runtime errors {errs[:2]}')
        print('logs', logs[:4])
        print('FAILED:' if FAILS else 'ALL PASSED', FAILS, f'[{time.time() - T0:.0f}s]')
        await b.close()
asyncio.run(main())
