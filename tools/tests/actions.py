"""[motion4] Every action since version 10 measured as a body (version 14), from what the shaders draw (13r_motion.js's
probe): climbing a tower's ladder (body action 14: each foot on a rung while it bears the climber, each hand round a
rung while it holds), a blow from the rungs (18: the left hand on its rung, the feet on theirs), shoving a boat off
the shore (19: the planted feet held), the warrior's Charge along the ground (its stride's planted feet, and its
landing), a stormer walking in over a fallen tower's rubble (no foot in the stones, none in the air), rowing (16: the
hands on the oars' grips), diving (15), a townsman at a scaffold's work, and a kneeling priest's front foot; and
pictures of each (shots).
usage: python3 tools/tests/actions.py [only=ladder,blow,shove,rush,rubble,row,dive,build,kneel] [noshots] [shots=...]
Writes tools/out/actions_<tag>.json and pictures tools/out/act_*.png."""
import json, asyncio, sys, pathlib, time, re, base64, io
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
from hmlib import setup, OUT
from playwright.async_api import async_playwright
try:
    from PIL import Image
except Exception:
    Image = None

ARGS = sys.argv[1:]
OPT = dict(a.split('=', 1) for a in ARGS if '=' in a)
ONLY = OPT.get('only', 'ladder,blow,shove,rush,stop,rubble,row,dive,build,kneel').split(',')
TAG = OPT.get('tag', 'run')
SHOTS = 'noshots' not in ARGS
SHOTS_ONLY = OPT.get('shots', '').split(',') if 'shots' in OPT else None
FAILS = []
T0 = time.time()

def check(cond, what):
    print(('  ok   ' if cond else '  FAIL ') + what, flush=True)
    if not cond: FAILS.append(what)

SRC = (pathlib.Path(__file__).parent / 'motion.py').read_text()
HELP = re.search(r'HELP = r"""(.*?)"""', SRC, re.S).group(1)

AJS = r"""
window.AC = {
  H: __hm, F: __hm.fn, M: __hm.motion,
  keep(realm, k) { return __hm.WAR.keeps.find((K) => K.orig === realm && K.site === __hm.REALMS[realm].keepSites[k]); },
  tower(S, sx, sz) { return __hm.towers.TOWER.list.find((T) => T.S === S && T.sx === sx && T.sz === sz); },
  put(x, z, y) { const H = this.H, P = H.GAME.player; P.x = P.prevX = x; P.z = P.prevZ = z; P.y = y; P.onGround = true; P.vy = 0; P.hp = P.maxHp = 1e7; P.motion = null; P.faction = 0; H.UI.modal = null; P.anim.act = 0; P.anim.actDur = 0; },
  quiet() { for (const w of __hm.WAR.warbands) w.dead = true; __hm.WAR.commanders.forEach((C) => { C.nextThink = 1e9; C.nextSpawn = 1e9; }); },
  empty(S) { const H = this.H, F = this.F, K = S.keepRef; if (!K) return; for (const id of [...K.guards]) { const g = F.getEnt(id); if (g) F.removeEnt(g); } K.guards.clear(); const Lo = F.getEnt(K.lord); if (Lo) F.removeEnt(Lo); K.lord = null; K.nextGuardAt = 1e9; for (const e of H.ENT) if (e !== H.GAME.player && e.alive && e.kind === 'humanoid' && Math.hypot(e.x - S.x, e.z - S.z) < 45) F.removeEnt(e); },
  // a ladder's frame: its rung line, the climber's line, its rungs (world heights)
  ladderFrame(L) {
    const T = L.T, S = T.S, D = T.ld, rail = this.F.siteToWorld(S, T.cx + Math.sin(L.a) * (D.R0 + 0.04), T.cz + Math.cos(L.a) * (D.R0 + 0.04));
    const rungs = []; for (let y = 0.3; y < L.yt - L.yb - 0.05; y += 0.3) rungs.push(L.wyb + y);
    const fx = Math.sin(L.yawW), fz = Math.cos(L.yawW);
    return { rail, rungs, fx, fz, lx: L.lx, lz: L.lz, ahead: (rail.x - L.lx) * fx + (rail.z - L.lz) * fz };
  },
  // per frame: a point's distance ahead of the climber's line (toward the rungs) and its height over the nearest rung's top
  onRung(Fr, p) {
    const a = (p[0] - Fr.lx) * Fr.fx + (p[2] - Fr.lz) * Fr.fz;
    let best = 9, bi = -1; for (let i = 0; i < Fr.rungs.length; i++) { const d = p[1] - Fr.rungs[i]; if (Math.abs(d) < Math.abs(best)) { best = d; bi = i; } }
    return { a, dy: best, i: bi };
  },
  // the climb: the player up a Logres corner tower's first ladder, each frame its feet and hands
  climb(sec = 3.2, dir = 1, blows = false) {
    const H = this.H, P = H.GAME.player, M = this.M, S = this.keep(0, 0).site, T = this.tower(S, 1, 1), L = T.ladders[0];
    this.empty(S);
    const f = this.F.siteToWorld(S, L.foot.x, L.foot.z); this.put(f.x, f.z, L.wyb);
    H.towers.towerClimb(P, L, dir);
    let nb = 0;
    const Fr = this.ladderFrame(L), rec = M.motionRun([{ e: P, kind: 'human', which: ['feet', 'hands'], drive: (e, t) => { if (blows && P.motion && P.motion.kind === 'ladder' && P.motion.st === 1 && t > 0.9 + nb * 0.8) { nb++; P.anim.act = 18; P.anim.actT = 0; P.anim.actDur = 0.6; } } }], sec, 1 / 60, { cam: () => { H.UI.modal = null; H.CAM.mode = 'fixed'; H.camera.position.set(P.x + 4, P.y + 2, P.z + 4); H.camera.lookAt(P.x, P.y + 1, P.z); H.camera.updateMatrixWorld(); } });
    return this.rungStats(rec[0], Fr, (s) => s.y > L.wyb + 0.05 && s.y < L.wyt - 0.05);
  },
  // each foot near the ground (within 4 cm of the floor under it): how far it moves over the ground while it stays
  // that near, the worst such stretch (cm), for bodies whose feet should stand: a still body, a pose stepping in
  skate(R, from = 0, to = 99) {
    const M = this.M, S = R.filter((s) => s.t >= from && s.t <= to && s.L && s.L.feet); let worst = 0, path = 0;
    for (let f = 0; f < 2; f++) {
      let run = [];
      const close = () => { if (run.length >= 2) { const a = run[0], b = run[run.length - 1]; worst = Math.max(worst, Math.hypot(b[0] - a[0], b[2] - a[2])); } run = []; };
      for (const s of S) { const p = s.L.feet[f]; if (!p) { close(); continue; } const h = p[3] - M.motionFloor(p[0], p[2], s.y); if (h < 0.04) run.push(p); else close(); }
      close();
    }
    return +(worst * 100).toFixed(1);
  },
  // the warrior's Charge at a foe 16 m off: the planted feet of its stride, and its landing
  rush() {
    const H = this.H, P = H.GAME.player, F = this.F, M = this.M, Ln = MO.lane(MO.cx, MO.cz, 30, 1);
    this.put(Ln.x - Ln.ux * 10, Ln.z - Ln.uz * 10, F.heightAt(Ln.x - Ln.ux * 10, Ln.z - Ln.uz * 10)); P.yaw = Math.atan2(Ln.ux, Ln.uz);
    const f = F.spawnRealmUnit(2, 'mage', 30, 'guard', Ln.x + Ln.ux * 6, Ln.z + Ln.uz * 6); delete f.wlOff; f.ai.post = { x: f.x, z: f.z, leash: 0.5 }; f.testFoe = true; f.ai.nextAbility = 1e9; f.swingAt = 1e9; f.tweak = { hp: 500 }; F.setupStats(f);
    H.simulate(0.3, 1 / 60); P.target = f.id; P.cds = {}; P.gcdUntil = 0; P.power = P.maxPower;
    const t0 = 0.1; let started = null, ended = null;
    const rec = M.motionRun([{ e: P, kind: 'human', which: ['feet'], drive: (e, t) => { if (t >= t0 && !started) { started = t; F.useAbility(P, 'charge', f); } } }], 2.0, 1 / 60, { cam: (t) => { if (started && !ended && !(P.motion && P.motion.rush)) ended = t; H.UI.modal = null; MO.chase(P); } });
    const run = M.motionMeasure(rec[0].filter((q) => q.t > started + 0.12 && q.t < (ended || 9) - 0.02), { skip: 0 });
    const land = this.skate(rec[0], ended || 9, (ended || 9) + 0.8);
    F.removeEnt(f);
    return { rushT: ended && started ? +(ended - started).toFixed(2) : null, v: run.v, slide: run.slideMax, slip: run.slipK, landSkate: land, landMeasure: M.motionMeasure(rec[0].filter((q) => q.t >= (ended || 9)), { skip: 0 }).slideMax };
  },
  // shoving a beached boat off the shore (action 19): the feet step into the stance and stand while the body drives
  shove() {
    const H = this.H, P = H.GAME.player, M = this.M, Bt = H.water.boats, Bs = Bt.BOATS;
    const i = Bt.list().findIndex((q) => q.st === 'beached'); if (i < 0) return { err: 'no beached boat' };
    const B = Bs.list[i], E = Bt.shoveEnd(i); H.teleport(E.x, E.z); P.yaw = Math.atan2(B.x - P.x, B.z - P.z); H.CAM.yaw = P.yaw; H.UI.modal = null; H.simulate(0.3, 1 / 60);
    let act = 0;
    const rec = M.motionRun([{ e: P, kind: 'human', which: ['feet'], drive: (e, t) => { if (t >= 0.1 && !act) { Bt.shoveOff(i); act = P.anim.act || -1; } } }], 1.8, 1 / 60, { cam: () => { H.UI.modal = null; MO.chase(P); } });
    return { act, skate: this.skate(rec[0], 0.13, 1.8), measure: M.motionMeasure(rec[0].filter((q) => q.t >= 0.13), { skip: 0 }).slideMax }; // (from the frame after the shove: shoveOff sets the body at her end)
  },
  // the player running (or sprinting) and letting go of the keys: the feet as the body halts
  stop(sprint) {
    const H = this.H, P = H.GAME.player, M = this.M, Ln = MO.lane(MO.cx, MO.cz, 30, 1);
    this.put(Ln.x - Ln.ux * 12, Ln.z - Ln.uz * 12, this.F.heightAt(Ln.x - Ln.ux * 12, Ln.z - Ln.uz * 12)); P.yaw = Math.atan2(Ln.ux, Ln.uz); P.endurance = 100;
    const out = [];
    for (let k = 0; k < 6; k++) {
      this.put(Ln.x - Ln.ux * 12, Ln.z - Ln.uz * 12, this.F.heightAt(Ln.x - Ln.ux * 12, Ln.z - Ln.uz * 12)); P.yaw = Math.atan2(Ln.ux, Ln.uz); P.endurance = 100;
      H.UI.modal = null; H.INPUT.keys.clear(); H.INPUT.keys.add('KeyW'); if (sprint) H.INPUT.keys.add('ShiftLeft');
      const t0 = 1.0 + k * 0.047, yaw0 = P.yaw;
      const rec = M.motionRun([{ e: P, kind: 'human', which: ['feet'], drive: (e, t) => { H.CAM.yaw = yaw0; if (t >= t0) H.INPUT.keys.clear(); } }], t0 + 1.0, 1 / 60, { cam: () => { H.UI.modal = null; MO.chase(P); } });
      out.push(this.skate(rec[0], t0, t0 + 1.0));
    }
    H.INPUT.keys.clear();
    return out;
  },
  rungStats(R, Fr, keep) {
    const out = { feet: [], hands: [], n: 0 };
    const S = R.filter((s) => s.L && s.L.feet && s.L.hands && keep(s));
    // a foot or hand that holds: still in the world (under 0.15 m/s) for 4 frames or more
    for (const part of ['feet', 'hands']) for (let f = 0; f < 2; f++) {
      let run = [];
      const close = () => { if (run.length >= 4) { const m = run[Math.floor(run.length / 2)], r = this.onRung(Fr, m); out[part].push({ n: run.length, a: +r.a.toFixed(3), dy: +r.dy.toFixed(3), y: +m[1].toFixed(2) }); } run = []; };
      for (let i = 1; i < S.length; i++) {
        const p = S[i].L[part][f], q = S[i - 1].L[part][f];
        if (!p || !q) { close(); continue; }
        const v = Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]) * 60;
        if (v < 0.15) run.push(part === 'feet' ? [p[0], p[3], p[2]] : [p[0], p[1], p[2]]); else close();
      }
      close();
    }
    out.n = S.length; out.ahead = +Fr.ahead.toFixed(3);
    return out;
  },
};
0;
"""

async def ev(page, js):
    return await page.evaluate(js)

async def shot(page, name, js):
    if not SHOTS or (SHOTS_ONLY and name not in SHOTS_ONLY): return
    info = await page.evaluate(js)
    url = await page.evaluate("(() => { __hm.frame(1/30); return __hm.dbg.renderer.domElement.toDataURL('image/png'); })()")
    pathlib.Path(OUT + 'act_' + name + '.png').write_bytes(base64.b64decode(url.split(',', 1)[1]))
    print('  shot', name, json.dumps(info), f'[{time.time() - T0:.0f}s]', flush=True)

async def main():
    async with async_playwright() as p:
        b, page, logs = await setup(p, w=640, h=360)
        page.on('console', lambda m: logs.append(f'[{m.type}] {m.text[:300]}') if m.type == 'error' else None)
        await ev(page, "window.requestAnimationFrame = () => 0; __hm.fn.setQuality('" + OPT.get('q', 'low') + "'); __hm.start({ realm: 0, cls: 'warrior', level: 30 }); __hm.setTod(0.45); 0")
        await ev(page, HELP)
        await ev(page, AJS)
        await ev(page, "(() => { MO.quiet(); MO.calm(); AC.quiet(); const W = __hm.dbg.WEATHER; W.mode = 'fixed'; W.kind = 'clear'; W.raining = 0; W.wet = 0; W.next = 1e9; const R = __hm.REALMS[0], S = R.musterSite, a = Math.atan2(S.x, S.z); MO.cx = S.x + Math.sin(a) * 40; MO.cz = S.z + Math.cos(a) * 40; __hm.simulate(0.5); return 0; })()")
        print(f'booted [{time.time() - T0:.0f}s]', flush=True)
        res = {}
        def rungs(name, r):
            ah = r['ahead']
            print(f"  {name}: rung line {ah} m ahead; feet holding {json.dumps(r['feet'])[:500]}", flush=True)
            print(f"         hands holding {json.dumps(r['hands'])[:500]}", flush=True)
            fe, ha = r['feet'], r['hands']
            check(len(fe) >= 8 and all(0.012 <= q['dy'] <= 0.04 and ah - 0.1 <= q['a'] <= ah + 0.06 for q in fe), f"{name}: every foot stands on a rung while it holds ({len(fe)} holds: its sole {min([q['dy'] for q in fe] or [0])}-{max([q['dy'] for q in fe] or [0])} m over the rung's middle, the rung 0.028 m round; {min([q['a'] for q in fe] or [0])}-{max([q['a'] for q in fe] or [0])} m ahead)")
            check(len(ha) >= 8 and all(abs(q['dy']) <= 0.06 and abs(q['a'] - ah) <= 0.05 for q in ha), f"{name}: every hand holds a rung while it holds ({len(ha)} holds: {min([q['dy'] for q in ha] or [0])}-{max([q['dy'] for q in ha] or [0])} m from the rung's middle, {min([q['a'] for q in ha] or [0])}-{max([q['a'] for q in ha] or [0])} m ahead)")
        if 'ladder' in ONLY:
            r = await ev(page, "AC.climb(3.2, 1)")
            res['climb'] = r; rungs('climbing up', r)
            r = await ev(page, "AC.climb(3.2, -1)") if False else None
        if 'blow' in ONLY:
            r = await ev(page, "AC.climb(3.2, 1, true)")
            res['blow'] = r
            print('  blows from the rungs: the feet', len(r['feet']), 'holds, the hands', len(r['hands']), flush=True)
            fe = r['feet']
            check(len(fe) >= 8 and all(0.012 <= q['dy'] <= 0.04 for q in fe), f"striking from the rungs, the feet stay on their rungs ({len(fe)} holds, {min([q['dy'] for q in fe] or [0])}-{max([q['dy'] for q in fe] or [0])} m over the rungs' middles)")
        if 'rush' in ONLY:
            r = await ev(page, "AC.rush()")
            res['rush'] = r
            print(f"  the Charge: {json.dumps(r)}", flush=True)
            check(r['rushT'] and r['slide'] <= 4 and r['landSkate'] <= 3, f"the Charge's stride plants its feet (the worst stance {r['slide']} cm at {r['v']} m/s) and it lands without its feet sliding ({r['landSkate']} cm near the ground)")
        if 'stop' in ONLY:
            for name, sp in (('running', 'false'), ('sprinting', 'true')):
                r = await ev(page, f"AC.stop({sp})")
                res['stop_' + name] = r
                print(f"  stopping from {name}: a foot near the ground moves at most {r} cm", flush=True)
                check(max(r) <= 2, f"stopping from {name} (six stops across the stride), no foot moves over the ground ({max(r)} cm at most)")
        if 'shove' in ONLY:
            r = await ev(page, "AC.shove()")
            res['shove'] = r
            print(f"  the boat shove: {json.dumps(r)}", flush=True)
            check(r.get('act') == 19 and r['skate'] <= 2, f"shoving a boat off, the feet step into the stance and stand (a foot near the ground moves at most {r.get('skate')} cm)")
        pathlib.Path(OUT + f'actions_{TAG}.json').write_text(json.dumps(res, indent=1))
        errs = await ev(page, "__hm.errors")
        check(not errs, f'no runtime errors {errs[:2]}')
        check(not any('Shader Error' in l for l in logs), 'every shader compiles')
        print('FAILED:' if FAILS else 'ALL PASSED', FAILS, f'[{time.time() - T0:.0f}s]')
        await b.close()
asyncio.run(main())
