"""Working castles, end to end through window.__hm:
gates swing open for their own side and shut when enemies come (the collider follows), and stop an enemy;
the player climbs a courtyard stair onto a wall walk and on up to a tower top (heights checked) and drops off
an edge; a garrison archer walks from the courtyard to its post; an enemy inside climbs after the archers;
a broken gate shows its wreck and comes back; a wall section is breached, can be walked through, and is
repaired. Screenshots of every keep style, the stairs, a wall walk, an open gate, a breach and banners.
usage: python3 tools/tests/castles.py [noshots] [quality]   (quality: high, medium or low; default medium)"""
import json, asyncio, sys, pathlib, time
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
from hmlib import setup, OUT
from playwright.async_api import async_playwright

ARGS = sys.argv[1:]
SHOTS = 'noshots' not in ARGS
QUALITY = next((a for a in ARGS if a in ('high', 'medium', 'low')), 'medium')
ONLY = next((a.split('=')[1] for a in ARGS if a.startswith('only=')), None)
FAILS = []
T0 = time.time()

def check(cond, what):
    print(('  ok   ' if cond else '  FAIL ') + what, flush=True)
    if not cond: FAILS.append(what)

async def ev(page, label, js):
    r = await page.evaluate(js)
    print(f'{label} [{time.time() - T0:.0f}s]', json.dumps(r)[:1600], flush=True)
    return r

async def frames(page, n=1):
    for _ in range(n): await page.evaluate("new Promise(r=>requestAnimationFrame(()=>r()))")

async def shot(page, name, js):
    if not SHOTS: return
    await page.evaluate(js)
    await frames(page, 2)
    await page.screenshot(path=OUT + name + '.png', timeout=300000)
    print('  shot', name, f'[{time.time() - T0:.0f}s]', flush=True)

HELPERS = r"""
window.T = {
  H: __hm, F: __hm.fn,
  keep(realm, k) { return __hm.WAR.keeps.find((K) => K.orig === realm && K.site === __hm.REALMS[realm].keepSites[k]); },
  w(S, lx, lz) { return this.F.siteToWorld(S, lx, lz); },
  // the player stands at a site-local point (on whatever floor is there at height y above the site)
  put(S, lx, lz, ly = 0, faction = S.realm >= 0 ? S.realm : 0) { const H = this.H, P = H.GAME.player, p = this.w(S, lx, lz); P.x = P.prevX = p.x; P.z = P.prevZ = p.z; P.y = S.y + ly; P.onGround = true; P.vy = 0; P.faction = faction; P.hp = P.maxHp; H.UI.modal = null; return this.where(S); },
  near(S, r = 12) { const D = __hm.fn.castleOf(S).gate.door; return this.H.ENT.filter((o) => o.alive && o.kind !== 'door' && Math.hypot(o.x - D.x, o.z - D.z) < r).map((o) => [o.role, o.faction, +(o.y - S.y).toFixed(1), +Math.hypot(o.x - D.x, o.z - D.z).toFixed(1)]); },
  where(S) { const P = this.H.GAME.player, c = Math.cos(S.yaw), s = Math.sin(S.yaw), dx = P.x - S.x, dz = P.z - S.z; return { lx: +(dx * c - dz * s).toFixed(2), lz: +(dx * s + dz * c).toFixed(2), y: +(P.y - S.y).toFixed(2) }; },
  // walk the player with W held toward a site-local point, steering the camera each tenth of a second
  walkTo(S, lx, lz, maxSec = 12) {
    const H = this.H, P = H.GAME.player, p = this.w(S, lx, lz);
    H.UI.modal = null; H.INPUT.keys.add('KeyW');
    let t = 0;
    while (t < maxSec) {
      const d = Math.hypot(p.x - P.x, p.z - P.z);
      if (d < 0.35) break;
      H.CAM.yaw = Math.atan2(p.x - P.x, p.z - P.z);
      H.simulate(Math.min(0.1, d / 7 + 0.02), 0.02); t += 0.1;
    }
    H.INPUT.keys.delete('KeyW');
    H.simulate(0.2, 0.02);
    return this.where(S);
  },
  cam(S, lx, ly, lz, tx, ty, tz) {
    const H = this.H, a = this.w(S, lx, lz), b = this.w(S, tx, tz);
    H.UI.modal = 'menu'; H.CAM.mode = 'fixed';
    H.camera.position.set(a.x, S.y + ly, a.z); H.camera.lookAt(b.x, S.y + ty, b.z); H.camera.updateMatrixWorld();
  },
  play() { this.H.UI.modal = null; this.H.CAM.mode = 'play'; },
  gate(S) { const G = __hm.fn.castleOf(S).gate; return { open: +G.open.toFixed(2), want: G.want, active: S.door.active, owner: S.door.owner, alive: G.door ? G.door.alive : null, wreck: G.wreck.visible, leaves: G.leaves.map((m) => m.visible) }; },
  foe(S, realm, lx, lz, cls = 'warrior') {
    const p = this.w(S, lx, lz), e = this.F.spawnRealmUnit(realm, cls, 20, 'guard', p.x, p.z, { yaw: S.yaw + Math.PI });
    e.ai.post = { x: p.x, z: p.z, leash: 60 }; e.testFoe = true; return e;
  },
  // nobody of another side near this gate (wandering wildlife or raiders would rightly keep it shut)
  hush(S, r = 30) { const D = this.F.castleOf(S).gate.door; for (const e of this.H.ENT.slice()) if (e.alive && e.kind !== 'door' && e.role !== 'player' && e.faction !== D.faction && e.faction !== 4 && Math.hypot(e.x - D.x, e.z - D.z) < r) this.F.removeEnt(e); },
  clearFoes() { for (const e of this.H.ENT.slice()) if (e.testFoe) this.F.removeEnt(e); },
  quiet(S, r = 60) { for (const e of this.H.ENT.slice()) if (e.role === 'soldier' && Math.hypot(e.x - S.x, e.z - S.z) < r) this.F.removeEnt(e); },
};
"""

async def main():
    async with async_playwright() as p:
        print('booting', flush=True)
        b, page, logs = await setup(p, w=640 if not SHOTS else 960, h=360 if not SHOTS else 540)
        print('booted', f'[{time.time() - T0:.0f}s]', flush=True)
        await page.evaluate(f"__hm.fn.setQuality('{QUALITY}')")
        print('quality', QUALITY, f'[{time.time() - T0:.0f}s]', flush=True)
        await page.evaluate("() => {" + HELPERS + "; return 0; }")
        print('helpers', f'[{time.time() - T0:.0f}s]', flush=True)
        await ev(page, 'start', "(() => { __hm.start({ realm: 0, cls: 'archer', level: 30 }); __hm.UI.modal = null; __hm.setTod(1.0); __hm.simulate(0.5); return { errors: __hm.errors.length, castles: __hm.fn.castles().length }; })()")
        await ev(page, 'floors', "(() => __hm.fn.castles().map((C) => ({ name: C.S.name, kind: C.kind, floors: C.floors.length, colls: C.colls.length, posts: C.posts.length })))()")
        await ev(page, 'war quiet', "(() => { for (const S of __hm.REALMS.flatMap((R) => [...R.keepSites, R.templeSite])) T.quiet(S, 80); for (const w of __hm.WAR.warbands) w.dead = true; __hm.WAR.commanders.forEach((C) => { C.nextThink = 1e9; C.nextSpawn = 1e9; }); return __hm.WAR.warbands.length; })()")

        # 1. gates: open for their own side, shut for enemies, collider follows
        if not ONLY or ONLY == 'gate':
            r = await ev(page, 'gate: owner arrives', "(() => { const K = T.keep(0, 0), S = K.site; T.put(S, 0, S.gateLocal.z + 6, 0, 0); __hm.simulate(3); return T.gate(S); })()")
            check(r['open'] > 0.95 and not r['active'], 'a keep gate swings open for its own side and its collider stands down')
            r = await ev(page, 'gate: enemy comes', "(() => { const K = T.keep(0, 0), S = K.site; T.foe(S, 1, 2, S.gateLocal.z + 14); __hm.simulate(2.5); return T.gate(S); })()")
            check(r['open'] < 0.05 and r['active'] and r['owner'] == -1, 'the gate shuts when an enemy comes near, and blocks everyone')
            r = await ev(page, 'gate: enemy pushes', "(() => { const K = T.keep(0, 0), S = K.site; T.clearFoes(); T.put(S, 0, S.gateLocal.z + 30); const e = T.foe(S, 1, 0, S.gateLocal.z + 1.6); for (let i = 0; i < 60; i++) { const p = T.w(S, 0, S.gateLocal.z - 3); __hm.fn.stepTo(e, e.x + (p.x - e.x) * 0.05, e.z + (p.z - e.z) * 0.05); __hm.simulate(0.05); } const c = Math.cos(S.yaw), s = Math.sin(S.yaw); const lz = (e.x - S.x) * s + (e.z - S.z) * c; T.clearFoes(); return { lz: +lz.toFixed(2), gz: S.gateLocal.z, gate: T.gate(S) }; })()")
            check(r['lz'] > r['gz'] + 0.4, 'an enemy cannot push through the shut gate')
            r = await ev(page, 'gate: owner leaves', "(() => { const S = T.keep(0, 0).site; T.put(S, 0, S.gateLocal.z + 6, 0, 0); __hm.simulate(3); const a = T.gate(S); T.put(S, 0, S.gateLocal.z + 40); __hm.simulate(3); return [a, T.gate(S), T.near(S)]; })()")
            check(r[0]['open'] > 0.95 and r[1]['open'] < 0.05 and r[1]['active'], 'it opens again for its own side, and shuts behind them')
            for realm, kind in ((1, 'round'), (2, 'timber')):
                r = await ev(page, f'gate {kind}', f"(() => {{ const S = T.keep({realm}, 0).site; const G = __hm.fn.castleOf(S).gate; G.door.faction; T.hush(S); T.put(S, 0, S.gateLocal.z + 6, 0, {realm}); __hm.simulate(3); const a = T.gate(S); T.put(S, 0, S.gateLocal.z + 40); __hm.simulate(3); return [a, T.gate(S), T.near(S)]; }})()")
                check(r[0]['open'] > 0.95 and r[1]['open'] < 0.05, f'the {kind} keep gate opens for its own side and shuts again')
            r = await ev(page, 'temple gate', "(() => { const S = __hm.REALMS[0].templeSite; T.hush(S); T.put(S, 0, S.gateLocal.z + 5, 0, 0); __hm.simulate(3); const a = T.gate(S); T.put(S, 0, S.gateLocal.z + 40); __hm.simulate(3); return [a, T.gate(S)]; })()")
            check(r[0]['open'] > 0.95 and r[1]['open'] < 0.05, 'a temple gate opens for its own side and shuts again')
            r = await ev(page, 'gate broken and rebuilt', "(() => { const K = T.keep(0, 0), S = K.site, D = K.door; __hm.fn.killEnt(D, null); __hm.simulate(0.5); const a = T.gate(S); D.alive = true; D.hp = D.maxHp * 0.35; __hm.simulate(0.5); const b = T.gate(S); return [a, b]; })()")
            check(r[0]['wreck'] and not any(r[0]['leaves']) and not r[0]['active'], 'a broken gate shows its splintered wreck and lets everyone through')
            check(not r[1]['wreck'] and all(r[1]['leaves']), 'the rebuilt gate is back on its hinges')

        # 2. the player climbs: courtyard stair -> wall walk -> tower stair -> tower top, then drops off an edge
        if not ONLY or ONLY == 'climb':
            r = await ev(page, 'climb stone', "(() => { const S = T.keep(0, 0).site; T.put(S, 10.6, -7.6); const out = []; out.push(T.walkTo(S, 13.0, -6.6)); out.push(T.walkTo(S, 13.0, 3.4)); out.push(T.walkTo(S, 13.0, 4.1)); out.push(T.walkTo(S, 14.65, 4.1)); out.push(T.walkTo(S, 14.65, 0)); out.push(T.walkTo(S, 14.65, 5.6)); out.push(T.walkTo(S, 14.65, 12.3)); out.push(T.walkTo(S, 14.2, 14.6)); return out; })()")
            check(abs(r[2]['y'] - 7) < 0.3 and abs(r[4]['y'] - 7) < 0.3, 'the player climbs the courtyard stair onto the wall walk (y = 7)')
            check(abs(r[7]['y'] - 10.5) < 0.3, 'and on up the tower stair onto the tower top (y = 10.5)')
            r = await ev(page, 'parapet holds', "(() => { const S = T.keep(0, 0).site; T.put(S, 14.65, 0, 7); const a = T.walkTo(S, 18, 0, 3); return a; })()")
            check(r['lx'] < 15.6 and abs(r['y'] - 7) < 0.3, 'the parapet keeps the player on the walk')
            r = await ev(page, 'drop off', "(() => { const S = T.keep(0, 0).site; T.put(S, 14.65, 0, 7); const a = T.walkTo(S, 10, 0, 3); __hm.simulate(1.5, 0.02); return T.where(S); })()")
            check(r['y'] < 0.5, 'stepping off the inner edge of the walk drops the player to the courtyard')
            r = await ev(page, 'wall blocks below', "(() => { const S = T.keep(0, 0).site; T.put(S, 11, 0, 0); const a = T.walkTo(S, 18, 0, 3); return a; })()")
            check(r['lx'] < 13.8 and r['y'] < 0.5, 'from the courtyard the wall (and the stair) still block the way')
            r = await ev(page, 'climb round', "(() => { const S = T.keep(1, 0).site; const P = __hm.GAME.player; T.put(S, 7.6, 9.6); const arc = []; for (let k = 0; k <= 8; k++) { const a = 0.58 + (1.4 - 0.58) * k / 8; arc.push(T.walkTo(S, Math.sin(a) * 14.5, Math.cos(a) * 14.5)); } const top = T.walkTo(S, Math.sin(1.4) * 16.2, Math.cos(1.4) * 16.2); const look = T.walkTo(S, 16.0, -0.4); return { arc: arc.map((q) => q.y), top, look }; })()")
            check(abs(r['top']['y'] - 6.7) < 0.3 and abs(r['look']['y'] - 6.7) < 0.3, 'on a round rath the curved stair leads onto the ring walk and into a lookout')
            r = await ev(page, 'climb timber', "(() => { const S = T.keep(2, 0).site; T.put(S, 10.2, -4.6); const a = T.walkTo(S, 12.0, -3.6); const b = T.walkTo(S, 12.0, 4.3); const c = T.walkTo(S, 13.6, 4.6); const d = T.walkTo(S, 13.6, 10.6); const e = T.walkTo(S, 11.9, 11.9); const f = T.walkTo(S, 11.0, 13.6); const g = T.walkTo(S, 9.0, 13.7); return [b, c, d, e, f, g]; })()")
            check(all(abs(q['y'] - 5.5) < 0.3 for q in r[1:]), 'on a timber burh the stair leads onto the walk behind the palisade, round the corner to the front')
            r = await ev(page, 'temple walk', "(() => { const S = __hm.REALMS[0].templeSite; const a0 = 1.05, a1 = 1.38; T.put(S, Math.sin(a0 - 0.1) * 14.55, Math.cos(a0 - 0.1) * 14.55); T.walkTo(S, Math.sin(a0) * 14.55, Math.cos(a0) * 14.55); T.walkTo(S, Math.sin(a1) * 14.55, Math.cos(a1) * 14.55); const a = T.walkTo(S, Math.sin(1.415) * 14.75, Math.cos(1.415) * 14.75); const b = T.walkTo(S, Math.sin(1.415) * 15.6, Math.cos(1.415) * 15.6); return [a, b]; })()")
            check(abs(r[1]['y'] - 3.0) < 0.3, 'a temple stair leads onto the walk on its ring wall')

        # 3. the garrison: an archer walks from the courtyard to its post; an enemy inside climbs after them
        if not ONLY or ONLY == 'garrison':
            for realm in (0, 1, 2):
                r = await ev(page, f'archer walks up {realm}', f"(() => {{ const K = T.keep({realm}, 0); const S = K.site; T.put(S, 0, 60); for (const id of [...K.guards]) {{ const g = __hm.fn.getEnt(id); if (g && g.ai.slot === 'w0') {{ g.alive = false; K.guards.delete(id); __hm.fn.removeEnt(g); }} }} __hm.fn.fillGarrison(K, false); __hm.fn.fillGarrison(K, false); const g = [...K.guards].map(__hm.fn.getEnt).find((e) => e && e.ai.slot === 'w0'); if (!g) return null; const start = {{ x: g.x, z: g.z, y: +(g.y - S.y).toFixed(2), route: !!g.ai.route }}; const ys = []; for (let i = 0; i < 30 && g.ai.route; i++) {{ __hm.simulate(1); ys.push(+(g.y - S.y).toFixed(1)); }} return {{ start, ys, end: {{ y: +(g.y - S.y).toFixed(2), d: +Math.hypot(g.x - g.ai.post.x, g.z - g.ai.post.z).toFixed(2), route: !!g.ai.route }}, post: K.slots.walls[0] }}; }})()")
                check(r and r['start']['route'] and r['start']['y'] < 0.5 and not r['end']['route'] and r['end']['d'] < 1.0 and abs(r['end']['y'] - r['post'][1]) < 0.4, f'a new wall archer walks up the stairs from the courtyard to its post (realm {realm})')
            r = await ev(page, 'attacker climbs', "(() => { const K = T.keep(0, 0), S = K.site; T.put(S, 0, 70); for (const id of [...K.guards]) { const g = __hm.fn.getEnt(id); if (g && !g.ai.wall) { K.guards.delete(id); __hm.fn.removeEnt(g); } } { const L = __hm.fn.getEnt(K.lord); if (L) { __hm.fn.removeEnt(L); K.lord = null; } } K.nextGuardAt = 1e9; const e = T.foe(S, 1, 8, -2, 'warrior'); e.tweak = { hp: 30 }; __hm.fn.setupStats(e); let maxY = 0; for (let i = 0; i < 24; i++) { __hm.simulate(0.5); maxY = Math.max(maxY, e.y - S.y); } const r = { maxY: +maxY.toFixed(2), alive: e.alive, target: e.target }; T.clearFoes(); return r; })()")
            check(r['maxY'] > 5.5, 'an enemy who gets into the courtyard climbs the stairs after the archers')

        # 4. a wall section is battered to a breach, walked through, and rebuilt
        if not ONLY or ONLY == 'breach':
            r = await ev(page, 'breach', "(() => { const K = T.keep(0, 0), S = K.site, C = __hm.fn.castleOf(S), W = C.sections[0]; T.put(S, 0, 70); const e = T.foe(S, 1, 0, 60, 'mage'); const hp = []; for (let i = 0; i < 30 && W.state === 'whole'; i++) { __hm.fn.castleSiegeHit(e, W.wx, W.wz, 6, 3.0); hp.push(+(W.hp / W.maxHp).toFixed(2)); } T.clearFoes(); return { state: W.state, hits: hp.length, hp: hp.slice(0, 4), coll: W.coll ? W.coll.active : null, floors: W.floors.map((f) => f.active), wreck: W.wreck.visible, patched: __hm.fn.CASTLE_PATCHED.slice() }; })()")
            check(r['state'] == 'breach' and r['coll'] is False and not any(r['floors']) and r['wreck'], 'meteors crack a wall section and bring it down into a breach (collider and walk gone, rubble shown)')
            check(len(r['patched']) == 2, 'the castle shader patched in its breach cut and its cracks')
            if SHOTS:
                await shot(page, 'castle_breach', "(() => { const S = T.keep(0, 0).site, W = __hm.fn.castleOf(S).sections[0]; T.cam(S, W.lx - 13, 5.5, W.lz + 6, W.lx, 3.2, W.lz); })()")
            r = await ev(page, 'through the breach', "(() => { const S = T.keep(0, 0).site, W = __hm.fn.castleOf(S).sections[0]; T.put(S, W.lx - 4.5, W.lz); const a = T.walkTo(S, W.lx + 4.5, W.lz, 6); return a; })()")
            check(r['lx'] > -12.5, 'the player climbs over the rubble through the breach into the courtyard')
            r = await ev(page, 'repair', "(() => { const K = T.keep(0, 0), S = K.site, W = __hm.fn.castleOf(S).sections[0]; T.put(S, 0, 70); K.lastEnemyNear = -999; __hm.simulate(30); const a = { state: W.state, t: +W.t.toFixed(2), scaffold: W.scaffold.visible }; return a; })()")
            check(r['state'] == 'repair' and r['scaffold'], 'when the castle is quiet its owners put up scaffolding and start to rebuild')
            if SHOTS:
                await shot(page, 'castle_repair', "(() => { const S = T.keep(0, 0).site, W = __hm.fn.castleOf(S).sections[0]; __hm.simulate(40); T.cam(S, W.lx - 13, 5.5, W.lz + 6, W.lx, 3.2, W.lz); })()")
            r = await ev(page, 'repaired', "(() => { const K = T.keep(0, 0), S = K.site, W = __hm.fn.castleOf(S).sections[0]; K.lastEnemyNear = -999; for (let i = 0; i < 20 && W.state !== 'whole'; i++) __hm.simulate(10); return { state: W.state, coll: W.coll.active, floors: W.floors.map((f) => f.active), fresh: +W.fresh.toFixed(2), scaffold: W.scaffold.visible }; })()")
            check(r['state'] == 'whole' and r['coll'] and all(r['floors']) and not r['scaffold'], 'after a few minutes the wall stands whole again, walk and all')
            if SHOTS:
                await shot(page, 'castle_rebuilt', "(() => { const S = T.keep(0, 0).site, W = __hm.fn.castleOf(S).sections[0]; T.cam(S, W.lx - 13, 5.5, W.lz + 6, W.lx, 3.2, W.lz); })()")
            r = await ev(page, 'round breach', "(() => { const S = T.keep(1, 1).site, W = __hm.fn.castleOf(S).sections[0]; const e = T.foe(S, 0, 0, 60, 'mage'); for (let i = 0; i < 30 && W.state === 'whole'; i++) __hm.fn.castleSiegeHit(e, W.wx, W.wz, 6, 3.0); T.clearFoes(); return { state: W.state, coll: W.coll ? W.coll.active : 'none' }; })()")
            check(r['state'] == 'breach' and r['coll'] is False, 'a round rath\'s ring wall can be breached too')
            if SHOTS:
                await shot(page, 'castle_breach_round', "(() => { const S = T.keep(1, 1).site, W = __hm.fn.castleOf(S).sections[0]; const o = { x: W.lx * 1.9, z: W.lz * 1.9 }; T.cam(S, o.x, 7, o.z, W.lx, 3, W.lz); })()")
            r = await ev(page, 'timber breach', "(() => { const S = T.keep(2, 1).site, W = __hm.fn.castleOf(S).sections[1]; const e = T.foe(S, 0, 0, 60, 'mage'); for (let i = 0; i < 30 && W.state === 'whole'; i++) __hm.fn.castleSiegeHit(e, W.wx, W.wz, 6, 3.0); T.clearFoes(); return { state: W.state, coll: W.coll ? W.coll.active : 'none' }; })()")
            check(r['state'] == 'breach' and r['coll'] is False, 'a timber palisade can be breached too')
            if SHOTS:
                await shot(page, 'castle_breach_timber', "(() => { const S = T.keep(2, 1).site, W = __hm.fn.castleOf(S).sections[1]; T.cam(S, W.lx + 12, 6, W.lz + 5, W.lx, 3, W.lz); })()")

        # 5. how it all looks
        if SHOTS and (not ONLY or ONLY == 'shots'):
            await ev(page, 'shots setup', "(() => { const S = T.keep(0, 0).site; T.put(S, 0, S.gateLocal.z + 4, 0, 0); __hm.simulate(3); return T.gate(S); })()")
            await shot(page, 'castle_stone', "(() => { const S = T.keep(0, 0).site; T.cam(S, -30, 21, 40, 0, 3, 3); })()")
            await shot(page, 'castle_stone_gate', "(() => { const S = T.keep(0, 0).site; T.cam(S, 6, 3.2, 27, 0, 3.2, 14); })()")
            await shot(page, 'castle_stone_stairs', "(() => { const S = T.keep(0, 0).site; T.cam(S, 1, 5.5, 8, 13, 4.5, -3); })()")
            await shot(page, 'castle_stone_walk', "(() => { const S = T.keep(0, 0).site; T.cam(S, 14.4, 8.8, -4.2, 14.6, 8.6, 8); })()")
            await shot(page, 'castle_stone_tower', "(() => { const S = T.keep(0, 0).site; T.cam(S, 6, 14, 3, 14.8, 10.5, 14.8); })()")
        if SHOTS and (not ONLY or ONLY in ('shots', 'shots2')):
            await shot(page, 'castle_round', "(() => { const S = T.keep(1, 0).site; T.cam(S, -27, 19, 30, 0, 2, 0); })()")
            await shot(page, 'castle_round_inside', "(() => { const S = T.keep(1, 0).site; T.cam(S, -4, 7, -4, 13, 4, 6); })()")
            await shot(page, 'castle_timber', "(() => { const S = T.keep(2, 0).site; T.cam(S, -27, 18, 30, 0, 2, 0); })()")
            await shot(page, 'castle_timber_inside', "(() => { const S = T.keep(2, 0).site; T.cam(S, -2, 6.5, -6, 12, 4, 6); })()")
            await shot(page, 'castle_temple', "(() => { const S = __hm.REALMS[0].templeSite; T.cam(S, -20, 13, 26, 0, 1.5, 0); })()")
        if SHOTS and (not ONLY or ONLY in ('shots', 'shots2', 'banners')):
            await shot(page, 'castle_banners_town', "(() => { const S = __hm.REALMS.map((R) => R.town).find((t) => t.houses.some((q) => q.kind === 'hall')), h = S.houses.find((q) => q.kind === 'hall'); const fx = Math.sin(h.yaw), fz = Math.cos(h.yaw); const H = __hm; H.UI.modal = 'menu'; H.CAM.mode = 'fixed'; const y = __hm.fn.heightAt(h.x, h.z); H.camera.position.set(h.x + fx * (h.d / 2 + 12) + fz * 4, y + 4.5, h.z + fz * (h.d / 2 + 12) - fx * 4); H.camera.lookAt(h.x + fx * (h.d / 2 + 2), y + 3, h.z + fz * (h.d / 2 + 2)); H.camera.updateMatrixWorld(); })()")

        r = await ev(page, 'errors', "__hm.errors.slice(0, 5)")
        check(len(r) == 0, '__hm.errors is empty')
        print('logs', logs[:5])
        await b.close()
    print(f'\n{len(FAILS)} failed' if FAILS else '\nall passed', f'[{time.time() - T0:.0f}s]')

asyncio.run(main())
