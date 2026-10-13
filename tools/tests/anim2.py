"""[anim2] Bodies that never break (version 19): no leg left in the air, weapons held and used as weapons are,
Cinderwing's fall and every death.

The search (`war`, `duels`, `player`): every body drawn near the camera, every frame, read from what the shaders draw
(14a_anim2.js's probe: each foot's lowest sole point, each instance by its number): a foot well off the floor under it
(over what its swing reaches at its pace, and at least 20 cm) while the body stands or walks and is not in the air, or a
body standing still with both feet off the floor, is written down with what the body was doing, grouped by its kind and
action. `war`: a running war, the camera over its biggest fight, at 30 steps a second; `duels`: every pair of callings,
skilled and simple, at 20 and 50, at 60 steps a second; `player`: the player's own doings by the keys, at 60 and at 20
frames a second (stops, turns on the spot, a jump and its landing, knocked back, stunned, a fall from a wall walk, a
ladder on and off, mounting and dismounting, swimming out, kneeling, dying and released). Bodies lying dead are measured
too (the lowest point of the body over the floor, its feet's highest).
usage: python3 tools/tests/anim2.py [only=war,duels,player,dead] [min=4] [q=low] [fps=30]"""
import json, asyncio, sys, pathlib, time
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
from hmlib import setup, OUT
from playwright.async_api import async_playwright

ARGS = sys.argv[1:]
def arg(k, d):
    return next((a.split('=', 1)[1] for a in ARGS if a.startswith(k + '=')), d)
ONLY = arg('only', 'war,duels,player,dead').split(',')
MIN = float(arg('min', '4'))
Q = arg('q', 'low')
FPS = int(arg('fps', '30'))
FAILS = []
T0 = time.time()

def check(cond, what):
    print(('  ok   ' if cond else '  FAIL ') + what, flush=True)
    if not cond: FAILS.append(what)

async def ev(page, js, label=None):
    r = await page.evaluate(js)
    if label: print(f'{label} [{time.time() - T0:.0f}s]', json.dumps(r)[:3000], flush=True)
    return r

HELP = r"""
window.A2T = {
  H: __hm, F: __hm.fn, A: __hm.anim2,
  calm() { const P = this.H.GAME.player; P.hp = P.maxHp = 1e7; P.buffs.length = 0; P.casting = null; P.target = null; P.testImmortal = true; },
  // the camera over a place, looking down at it from d m off (everything within ~40 m of it in view)
  over(x, z, d = 30, h = 22) { const H = this.H; H.UI.modal = 'menu'; H.CAM.mode = 'fixed'; const y = this.F.heightAt(x, z); H.camera.position.set(x - d * 0.6, y + h, z - d * 0.8); H.camera.lookAt(x, y, z); H.camera.updateMatrixWorld(); },
  // the biggest fight of the war: the body with the most others fighting about it
  fight() {
    const H = this.H; let best = null, bn = -1;
    for (const e of H.ENT) {
      if (!e.alive || e.kind !== 'humanoid' || !(e.combatUntil > H.GAME.t) || e.role === 'player') continue;
      let n = 0; for (const o of H.ENT) if (o.alive && o.kind !== 'door' && Math.abs(o.x - e.x) < 25 && Math.abs(o.z - e.z) < 25) n++;
      if (n > bn) { bn = n; best = e; }
    }
    return best ? { x: best.x, z: best.z, n: bn } : null;
  },
  // n frames of the search at dt, the camera following a place (a function giving x, z)
  run(n, dt, follow, tag) {
    for (let i = 0; i < n; i++) { if (follow && i % 15 === 0) { const f = follow(); if (f) this.over(f.x, f.z); } this.A.a2Step(dt, { tag }); }
    return this.A.A2.stats.frames;
  },
};
0;
"""

def summary(r, label):
    st = r['stats']
    print("hist", json.dumps(dict(sorted(r.get("hist", {}).items()))), flush=True)
    print(f"{label}: frames {st['frames']}, bodies on their feet looked at {st['bodies']} (all looked at {st['looked']})", flush=True)
    for s in r['sigs'][:30]:
        print(f"  {s['n']:6d}  {s['sig']}", flush=True)
        for ex in s['ex'][:3]:
            print('          ', json.dumps(ex)[:600], flush=True)

async def main():
    res = {}
    async with async_playwright() as p:
        b, page, logs = await setup(p, w=640, h=360)
        page.on('console', lambda m: logs.append(f'[{m.type}] {m.text[:300]}') if m.type == 'error' else None)
        await ev(page, f"__hm.fn.setQuality('{Q}'); 0")
        await ev(page, HELP)
        if 'war' in ONLY:
            await ev(page, "__hm.start({ realm: 0, cls: 'warrior', level: 20 }); A2T.calm(); __hm.setTod(0.45); __hm.simulate(150); 0")
            print(f'war booted [{time.time() - T0:.0f}s]', flush=True)
            await ev(page, "__hm.anim2.a2Reset(); 0")
            rounds = max(1, int(MIN * 60 / 20))
            for k in range(rounds):
                f = await ev(page, f"(() => {{ A2T.calm(); __hm.simulate(10); const f = A2T.fight(); if (!f) return null; A2T.over(f.x, f.z); A2T.run({10 * FPS}, {1 / FPS}, () => A2T.fight(), 'war'); return f; }})()")
                if k % 3 == 0: print(f'  round {k + 1}/{rounds}: fight {f} [{time.time() - T0:.0f}s]', flush=True)
            r = await ev(page, "__hm.anim2.a2Report()")
            summary(r, 'war'); res['war'] = r
        errs = await ev(page, "__hm.errors.slice(0, 5)")
        print('errors', errs, flush=True)
        await b.close()
    (pathlib.Path(OUT) / 'anim2_search.json').write_text(json.dumps(res, indent=1))
    print(f'done [{time.time() - T0:.0f}s]', 'FAILS: ' + '; '.join(FAILS) if FAILS else '', flush=True)

asyncio.run(main())
