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
  // an open stretch near (cx, cz): motion.py's lane (no prop on the bodies' lines)
  lane(cx, cz, L, n) {
    const F = this.F, CV = this.H.dbg.COVER, clear = (x, z) => { const i = Math.floor(x + 512), j = Math.floor(z + 512); return !CV || i < 0 || j < 0 || i >= 1024 || j >= 1024 || CV.data[j * 1024 + i] === 0; };
    for (let r = 0; r < 160; r += 6) for (let k = 0; k < 16; k++) {
      const a = k / 16 * Math.PI * 2, x0 = cx + Math.sin(a) * r, z0 = cz + Math.cos(a) * r;
      for (const yaw of [0, 0.8, 1.6, 2.4]) {
        const ux = Math.sin(yaw), uz = Math.cos(yaw), sx = uz, sz = -ux;
        let ok = true, hmin = 1e9, hmax = -1e9;
        for (let i = 0; i < n && ok; i++) for (let j = -2; j <= L + 2 && ok; j += 0.75) for (const o of [-1, 0, 1]) { const x = x0 + ux * (j - L / 2) + sx * ((i - (n - 1) / 2) * 3 + o), z = z0 + uz * (j - L / 2) + sz * ((i - (n - 1) / 2) * 3 + o); if (!clear(x, z) || !F.isWalkable(x, z) || __hm.water.waterAt(x, z)) ok = false; else { const h = F.heightAt(x, z); hmin = Math.min(hmin, h); hmax = Math.max(hmax, h); } }
        if (ok && hmax - hmin < 0.6) return { x: x0, z: z0, ux, uz, sx, sz, L };
      }
    }
    return null;
  },
  made: [],
  clear() { for (const e of this.made) { if (e.mount) e.mount = null; this.F.removeEnt(e); } this.made = []; },
  person(x, z, yaw, cls = 'warrior', realm = 0) { const e = this.F.spawnRealmUnit(realm, cls, 20, 'test', x, z); e.yaw = yaw; e.prevX = e.x; e.prevZ = e.z; e.testMo = true; this.made.push(e); return e; },
  // people walking or running side by side, each stopping dead at its own point of the stride, then standing: the search
  // looks at them every frame (a raised foot should come down as the gait settles)
  stops(v, n, dt, tag) {
    const P = this.H.GAME.player, Ln = this.lane(P.x + 40, P.z + 40, v * 3 + 6, n);
    if (!Ln) return { err: 'no lane' };
    const es = [];
    for (let i = 0; i < n; i++) { const off = (i - (n - 1) / 2) * 3; es.push(this.person(Ln.x + Ln.sx * off - Ln.ux * v * 1.5, Ln.z + Ln.sz * off - Ln.uz * v * 1.5, Math.atan2(Ln.ux, Ln.uz))); }
    this.over(Ln.x, Ln.z, 10, 10);
    const T = Math.round(3.4 / dt);
    for (let s = 0; s < T; s++) {
      const t = s * dt;
      es.forEach((e, i) => { const tStop = 1.2 + i * (0.6 / n); const k = t < tStop ? Math.min(1, t / 0.35) : 0; e.x += Ln.ux * v * k * dt; e.z += Ln.uz * v * k * dt; e.yaw = Math.atan2(Ln.ux, Ln.uz); });
      this.A.a2Step(dt, { tag });
    }
    this.clear();
    return 0;
  },
  // duels of every pair of callings, skilled or simple, side by side (6 m apart within a ring), the search looking at
  // them every frame; each pair made again as it ends
  duels(lvl, kind, sec, dt, tag) {
    const H = this.H, F = this.F, B = H.bal, P = H.GAME.player, CL = ['warrior', 'archer', 'mage', 'priest'], pairs = [];
    for (let i = 0; i < 4; i++) for (let j = i + 1; j < 4; j++) pairs.push([CL[i], CL[j]]);
    const Ln = this.lane(P.x + 60, P.z + 60, 30, 3);
    if (!Ln) return { err: 'no lane' };
    const unit = (realm, cls, x, z) => { const e = F.spawnRealmUnit(realm, cls, lvl, 'bot', x, z); e.tweak = { hp: 1.1, dmg: 1.25 }; e.gear = B.fairGear(cls, lvl).tot; B.botMake(e, kind, { x, z, r: 9 }); F.setupStats(e); e.hp = e.maxHp; e.power = e.maxPower; e.a2duel = true; this.made.push(e); return e; };
    const spots = pairs.map((pr, i) => ({ x: Ln.x + Ln.sx * ((i % 3) - 1) * 11 + Ln.ux * (Math.floor(i / 3) - 0.5) * 14, z: Ln.z + Ln.sz * ((i % 3) - 1) * 11 + Ln.uz * (Math.floor(i / 3) - 0.5) * 14 }));
    const A = pairs.map(() => null);
    const make = (i) => { const s = spots[i], [a, b] = pairs[i]; const ua = unit(0, a, s.x - 4, s.z), ub = unit(1, b, s.x + 4, s.z); ua.bot.home = ub.bot.home = { x: s.x, z: s.z, r: 9 }; ua.target = ub.id; ub.target = ua.id; A[i] = { ua, ub, t0: H.GAME.t }; };
    pairs.forEach((_, i) => make(i));
    this.over(Ln.x, Ln.z, 22, 18);
    let duels = pairs.length;
    for (let s = 0; s < Math.round(sec / dt); s++) {
      this.A.a2Step(dt, { tag, r: 70 });
      if (s % 30 === 0) A.forEach((D, i) => { if (!D.ua.alive || !D.ub.alive || H.GAME.t - D.t0 > 40) { for (const e of [D.ua, D.ub]) { if (e.alive) F.killEnt(e, null); } if (H.GAME.t - Math.max(D.ua.deadAt || 0, D.ub.deadAt || 0) > 2.5 || H.GAME.t - D.t0 > 42) { for (const e of [D.ua, D.ub]) { F.removeEnt(e); } make(i); duels++; } } });
    }
    this.clear();
    return duels;
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
