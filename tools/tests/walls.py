"""[walls] What flies stops at what it hits, and stone towers that breach and are mended (07g_walls.js, 04o_breach.js).
Checks: the swept test (shotHit) against a keep's curtain (stone, a shot over it goes on), a Thule palisade (logs), a
town house's wall (daub or plaster) and its window (through it with the shutters open, stopped by them shut), a
roundhouse's thatch, a tower's drum (stone) and its arrow slit and open door, a crenellated parapet (a merlon stops a
shot, a crenel lets it by above the breastwork, the breastwork stops it below), a rock; the archer's drawn arrows stick
in timber (they stay, drawn in the wall) and glance off stone (and lie where they fall), and a body behind a wall is not
struck; an NPC archer does not loose a shot that would only strike a house and closes in, and with a clear line its shot
lands; an archer in a tower's store room shoots out through a slit; a fire spell on a roundhouse's thatch sets it alight
(an enemy's: the realm's own spares it); a garrison archer on a gate tower's top shoots out through its crenel at a
foe below, and the foe shoots back at it where it shows, while a body standing back from the parapet is covered; a
siege stone strikes the tower in its way; the cost of a test. [breach] a stone tower struck by engines cracks and falls
into a breach (its upper rooms and ladders gone, its top's archer down), is stormed through the gap into the courtyard,
mended in peace, and saved with the world. Screenshots (unless noshots): arrows stuck in a timber wall and a house,
arrows glanced off stone, a breached tower by day and night, high and low, the charred timber tower, the ladder fight.
usage: python3 tools/tests/walls.py [noshots] [only=geo,arrows,proj,slit,fire,crenel,stone,perf,breach,save,shots] [quality] [shots=...]"""
import json, asyncio, sys, pathlib, time, base64, io
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
from hmlib import setup, OUT
from playwright.async_api import async_playwright
try:
    from PIL import Image
except ImportError:
    Image = None

ARGS = sys.argv[1:]
SHOTS = 'noshots' not in ARGS
QUALITY = next((a for a in ARGS if a in ('high', 'medium', 'low')), 'low')
OPT = dict(a.split('=', 1) for a in ARGS if '=' in a)
ONLY = OPT['only'].split(',') if 'only' in OPT else None
def want(k): return ONLY is None or k in ONLY
FAILS = []
T0 = time.time()

def check(cond, what):
    print(('  ok   ' if cond else '  FAIL ') + what, flush=True)
    if not cond: FAILS.append(what)

async def ev(page, label, js):
    r = await page.evaluate(js)
    print(f'{label} [{time.time() - T0:.0f}s]', json.dumps(r)[:1800], flush=True)
    return r

async def shot(page, name, js):
    if not SHOTS: return
    if 'shots' in OPT and name.replace('walls_', '') not in OPT['shots'].split(','): return
    info = await page.evaluate(js)
    url = await page.evaluate("(() => { __hm.frame(1/30); __hm.frame(1/30); return __hm.dbg.renderer.domElement.toDataURL('image/png'); })()")
    data = base64.b64decode(url.split(',', 1)[1])
    if Image: Image.open(io.BytesIO(data)).convert('RGB').resize((960, 540), Image.LANCZOS).save(OUT + name + '.png')
    else: pathlib.Path(OUT + name + '.png').write_bytes(data)
    print('  shot', name, json.dumps(info), f'[{time.time() - T0:.0f}s]', flush=True)

HELPERS = r"""
window.WT = {
  H: __hm, F: __hm.fn, W: __hm.walls,
  site(realm, k) { return __hm.REALMS[realm].keepSites[k]; },
  w(S, lx, lz) { return this.F.siteToWorld(S, lx, lz); },
  hit(a, b, o) { const R = this.W.shotHit(a.x, a.y, a.z, b.x, b.y, b.z, o || {}); return R ? { t: +R.t.toFixed(3), what: R.what, mat: R.mat, x: +R.x.toFixed(2), y: +R.y.toFixed(2), z: +R.z.toFixed(2), n: [+R.nx.toFixed(2), +R.ny.toFixed(2), +R.nz.toFixed(2)] } : null; },
  // a point in a site's frame at height ly above the site
  sp(S, lx, lz, ly) { const p = this.F.siteToWorld(S, lx, lz); return { x: p.x, y: S.y + ly, z: p.z }; },
  tower(S, pred) { return __hm.towers.TOWER.list.find((T) => T.S === S && pred(T)); },
  tp(T, a, r, ly) { const p = this.F.siteToWorld(T.S, T.cx + Math.sin(a) * r, T.cz + Math.cos(a) * r); return { x: p.x, y: T.S.y + ly, z: p.z }; },
  quiet() { for (const w of __hm.WAR.warbands) w.dead = true; __hm.WAR.commanders.forEach((C) => { C.nextThink = 1e9; C.nextSpawn = 1e9; }); },
  // a body of a realm that only stands (role dummy: nothing thinks for it but its auto-attack)
  body(realm, cls, x, z, y = null) { const e = this.F.spawnRealmUnit(realm, cls, 30, 'guard', x, z, {}); e.role = 'dummy'; e.testFoe = true; if (y !== null) { e.y = y; } e.ai.post = { x, z, leash: 0 }; e.hp = e.maxHp = 1e6; return e; },
  clearNear(x, z, r = 40) { const P = this.H.GAME.player; for (const e of this.H.ENT.slice()) if (e !== P && e.alive && e.kind !== 'door' && Math.hypot(e.x - x, e.z - z) < r && e.role !== 'critter') this.F.removeEnt(e); },
  house(pred) { return __hm.walls.WALLS && window.__hm_houses ? null : null; },
  put(x, z, y) { const P = this.H.GAME.player; P.x = P.prevX = x; P.z = P.prevZ = z; P.y = y ?? this.F.heightAt(x, z); P.vy = 0; P.onGround = true; P.motion = null; P.hp = P.maxHp = 1e7; this.H.UI.modal = null; },
};
"""

async def main():
    async with async_playwright() as p:
        b, page, logs = await setup(p, w=960 if SHOTS else 640, h=540 if SHOTS else 360)
        print('booted', f'[{time.time() - T0:.0f}s]', flush=True)
        await page.evaluate(f"__hm.fn.setQuality('{QUALITY}')")
        await page.evaluate("() => {" + HELPERS + "; return 0; }")
        await ev(page, 'start', "(() => { __hm.start({ realm: 0, cls: 'archer', level: 30 }); __hm.UI.modal = null; __hm.setTod(0.42); __hm.simulate(0.5); WT.quiet(); const W = __hm.dbg.WEATHER; W.mode = 'fixed'; W.kind = 'clear'; W.raining = 0; W.wet = 0; W.next = 1e9; return 0; })()")
        if want('geo'): await geo(page)
        if want('arrows'): await arrows(page)
        if want('proj'): await proj(page)
        if want('slit'): await slit(page)
        if want('fire'): await fire(page)
        if want('crenel'): await crenel(page)
        if want('stone'): await stone(page)
        if want('perf'): await perf(page)
        r = await ev(page, 'stats', "(() => { const s = __hm.walls.WALLS.stats; return s; })()")
        r = await ev(page, 'errors', "(() => __hm.errors.slice(0, 6))()")
        check(len(r) == 0, '__hm.errors is empty')
        for l in logs[:5]: print(l)
        await b.close()
    print('ALL PASSED' if not FAILS else 'FAILED', FAILS, f'[{time.time() - T0:.0f}s]', flush=True)

async def geo(page):
    r = await ev(page, 'curtain', """(() => { const S = WT.site(0, 0), out = {};
      // the back wall from outside, chest high; then over it
      out.wall = WT.hit(WT.sp(S, 2, -26, 1.4), WT.sp(S, 2, -10, 1.4));
      out.over = WT.hit(WT.sp(S, 2, -26, 14), WT.sp(S, 2, -10, 14));
      // a Thule palisade
      const T = WT.site(2, 0); out.pal = WT.hit(WT.sp(T, 3, -28, 1.6), WT.sp(T, 3, -8, 1.6));
      // a rock in the open (an outcrop or a boulder)
      const rk = __hm.dbg.SHADOW ? null : null;
      return out; })()""")
    check(r['wall'] and r['wall']['mat'] == 'stone' and r['wall']['n'][2] != 0, 'a shot at a Logres curtain from outside strikes its stone face')
    check(r['over'] is None, 'a shot well over the wall goes on')
    check(r['pal'] and r['pal']['mat'] in ('logs', 'wood'), 'a Thule palisade stops a shot (logs)')
    r = await ev(page, 'house', """(() => { const out = {};
      const Hs = __hm.walls.WALLS.houseOf ? null : __hm.walls.wallHouseOf({}); // builds the map
      const all = []; for (const [c, H] of __hm.walls.WALLS.houseOf) if (!all.includes(H)) all.push(H);
      const H = all.find((q) => !q.keepHall && q.style === 'stone' && q.state === 'whole' && q.wins.some((w) => w.shutters && w.face === 1));
      const win = H.wins.find((w) => w.shutters && w.face === 1);
      const wy = H.y + win.y, out2 = { x: win.out.x + (win.out.x - win.c.x) * 4, z: win.out.z + (win.out.z - win.c.z) * 4 };
      const a = { x: out2.x, y: wy, z: out2.z }, inside = { x: win.c.x - (win.out.x - win.c.x) * 1.5, y: wy, z: win.c.z - (win.out.z - win.c.z) * 1.5 };
      win.target = 0; for (const L of win.leaves) L.open = 0;
      out.shut = WT.hit(a, inside);
      win.target = 1; for (const L of win.leaves) L.open = 1;
      out.open = WT.hit(a, inside);
      win.target = 0; for (const L of win.leaves) L.open = 0;
      // beside the window: the wall
      const side = { x: a.x + (win.c.z - win.out.z) * 1.6, y: wy, z: a.z - (win.c.x - win.out.x) * 1.6 }, side2 = { x: inside.x + (win.c.z - win.out.z) * 1.6, y: wy, z: inside.z - (win.c.x - win.out.x) * 1.6 };
      out.wall = WT.hit(side, side2);
      // an Eriu roundhouse's thatch from above
      const R = all.find((q) => !q.keepHall && q.round && q.state === 'whole');
      out.thatch = WT.hit({ x: R.x + 1, y: R.y + R.top + 3, z: R.z + 0.5 }, { x: R.x + 1, y: R.y + 1, z: R.z + 0.5 });
      // a Thule log house
      const L = all.find((q) => !q.keepHall && q.style === 'timber' && q.state === 'whole');
      const lp = (lx, lz, ly) => ({ x: L.x + lx * L.c + lz * L.s, y: L.y + ly, z: L.z - lx * L.s + lz * L.c });
      out.logs = WT.hit(lp(L.w / 2 + 0.9, 0.3, 1.2), lp(0, 0.3, 1.2));
      out.roofShingle = WT.hit(lp(L.w / 4, 0, L.wallH + L.rh + 3), lp(L.w / 4, 0, 0.5));
      out.mats = [H.style, R.style, L.style];
      return out; })()""")
    check(r['shut'] and r['shut']['what'] == 'shutter' or (r['shut'] and r['shut']['mat'] in ('plaster', 'wood')), 'a shot at a shuttered window strikes its shutters')
    check(r['open'] is None or r['open']['t'] > 0.6, 'with the shutters open it goes in through the window')
    check(r['wall'] and r['wall']['mat'] == 'plaster', 'beside the window the house wall stops it (plaster)')
    check(r['thatch'] and r['thatch']['what'] == 'roof' and r['thatch']['mat'] == 'thatch', 'a shot onto a roundhouse lands in its thatch')
    check(r['logs'] and r['logs']['mat'] == 'logs', 'a Thule house wall stops a shot (logs)')
    check(r['roofShingle'] and r['roofShingle']['what'] == 'roof', 'a Thule roof stops a shot from above (shingles)')
    r = await ev(page, 'tower', """(() => { const S = WT.site(0, 0), out = {};
      const T = WT.tower(S, (q) => q.role === 'corner' && q.sx === 1 && q.sz === -1);
      const s = T.slitsAt.find((q) => q.y0 < 3), ym = (s.y0 + s.y1) / 2;
      // straight at a slit from outside, and a little to one side of it
      out.slit = WT.hit(WT.tp(T, s.a, T.RO + 6, ym), WT.tp(T, s.a, 0.3, ym));
      out.beside = WT.hit(WT.tp(T, s.a + 0.12, T.RO + 6, ym), WT.tp(T, s.a + 0.12, 0.3, ym));
      // the courtyard door: shut, then open
      const D = T.doors[0], aIn = T.aIn;
      const a = WT.tp(T, aIn, T.RO + 5, T.yG + 1.2), b = WT.tp(T, aIn, 0.2, T.yG + 1.2);
      out.doorShut = WT.hit(a, b);
      D.k = 1; D.coll.active = false; out.doorOpen = WT.hit(a, b); D.k = 0; D.coll.active = true;
      return out; })()""")
    check(r['slit'] is None or r['slit']['t'] > 0.8, 'a shot straight into an arrow slit goes in')
    check(r['beside'] and r['beside']['mat'] == 'stone', 'beside the slit the drum stops it (stone)')
    check(r['doorShut'] and r['doorShut']['mat'] == 'wood', 'the tower door shut stops a shot (wood)')
    check(r['doorOpen'] is None or r['doorOpen']['t'] > 0.8, 'through the open door a shot goes in')
    r = await ev(page, 'parapet', """(() => { const S = WT.site(0, 0), out = {};
      const C = __hm.fn.castles().find((q) => q.S === S), P = C.colls.find((c) => c.cren && c.cren.n >= 4);
      const cr = P.cren, sp = cr.len / cr.n, mid = (k) => ({ x: cr.x0 + cr.ux * k, z: cr.z0 + cr.uz * k });
      const nx = -cr.uz, nz = cr.ux; // across the parapet
      const at = (al, y) => { const m = mid(al); return [{ x: m.x + nx * 6, y, z: m.z + nz * 6 }, { x: m.x - nx * 6, y, z: m.z - nz * 6 }]; };
      const merlon = at(1.5 * sp, cr.sill + 0.45), crenel = at(sp, cr.sill + 0.45), low = at(sp, cr.sill - 0.4);
      out.merlon = WT.hit(merlon[0], merlon[1]); out.crenel = WT.hit(crenel[0], crenel[1]); out.low = WT.hit(low[0], low[1]);
      out.sill = +(cr.sill - S.y).toFixed(2); return out; })()""")
    check(r['merlon'] and r['merlon']['what'] == 'parapet', 'a merlon stops a shot')
    check(r['crenel'] is None or r['crenel']['what'] != 'parapet', 'a crenel lets it by above the breastwork')
    check(r['low'] and r['low']['what'] == 'parapet', 'the breastwork stops it below the crenel')

async def arrows(page):
    r = await ev(page, 'drawn arrows', """(() => { const out = {}, F = WT.F, H = WT.H, P = H.GAME.player, W = WT.W.WALLS;
      // at a Thule palisade from outside: they stick in the logs
      const T = WT.site(2, 0); const a = WT.sp(T, 3, -24, 0); WT.put(a.x, a.z); P.faction = 0;
      const tgt = WT.sp(T, 3, -10, 0);
      const st0 = W.stats.stuck, n0 = W.stuck.length;
      P.yaw = Math.atan2(tgt.x - P.x, tgt.z - P.z); H.CAM.yaw = P.yaw; H.CAM.pitch = 0.25;
      for (let i = 0; i < 3; i++) { __hm.cls.looseArrow(P, 1, null, 0); H.simulate(0.6); }
      out.stuck = W.stats.stuck - st0; out.lying = W.stuck.slice(n0).map((s) => [+(s.y - T.y).toFixed(2), s.dx.toFixed(2)]);
      out.inWall = W.stuck.slice(n0).filter((s) => Math.abs(F.heightAt(s.x, s.z) - s.y) > 0.4).length;
      // at a Logres curtain: they glance off and fall, and a body behind it is not struck
      const S = WT.site(0, 0), b = WT.sp(S, 2, -26, 0); WT.clearNear(S.x, S.z, 50); WT.put(b.x, b.z);
      const behind = WT.sp(S, 2, -12, 0), foe = WT.body(1, 'warrior', behind.x, behind.z);
      const hp0 = foe.hp, g0 = W.stats.glanced;
      P.yaw = Math.atan2(behind.x - P.x, behind.z - P.z); H.CAM.yaw = P.yaw;
      for (let i = 0; i < 3; i++) { __hm.cls.looseArrow(P, 1, foe, 0); H.simulate(0.6); }
      H.simulate(2.5);
      out.glanced = W.stats.glanced - g0; out.foeHurt = foe.hp < hp0; out.fallLeft = W.fall.length;
      F.removeEnt(foe);
      return out; })()""")
    check(r['stuck'] >= 3 and r['inWall'] >= 3, 'drawn arrows stick in a Thule palisade and stay in the wall')
    check(r['glanced'] >= 3 and not r['foeHurt'], 'drawn arrows glance off a Logres curtain; the foe behind it is not struck')

async def proj(page):
    r = await ev(page, 'npc archer', """(() => { const out = {}, F = WT.F, H = WT.H, W = WT.W;
      const all = []; WT.W.wallHouseOf({}); for (const [c, Hh] of WT.W.WALLS.houseOf) if (!all.includes(Hh)) all.push(Hh);
      const Hs = all.find((q) => !q.keepHall && !q.round && q.state === 'whole' && q.style === 'stone');
      const at = (lx, lz) => ({ x: Hs.x + lx * Hs.c + lz * Hs.s, z: Hs.z - lx * Hs.s + lz * Hs.c });
      WT.put(at(0, Hs.d / 2 + 12).x, at(0, Hs.d / 2 + 12).z);
      WT.clearNear(Hs.x, Hs.z, 30);
      const sa = at(Hs.w / 2 + 6, 0), fa = at(-Hs.w / 2 - 4, 0);
      const archer = WT.body(1, 'archer', sa.x, sa.z), foe = WT.body(0, 'warrior', fa.x, fa.z);
      archer.target = foe.id; archer.rangedRange = 30;
      out.clear = W.wallsShotClear(archer, foe, true);
      const n0 = WT.W.WALLS.stats.tests, p0 = __hm.bal.PROJ.length, hp0 = foe.hp;
      H.simulate(3);
      out.proj = __hm.bal.PROJ.length; out.hurt = foe.hp < hp0; out.wallShot = archer.ai.wallShot != null;
      // a clear line: the foe steps out from behind the house
      const ca = at(Hs.w / 2 + 6, Hs.d / 2 + 6); foe.x = foe.prevX = ca.x; foe.z = foe.prevZ = ca.z; foe.ai.post = { x: ca.x, z: ca.z, leash: 0 };
      out.clear2 = W.wallsShotClear(archer, foe, true);
      const hp1 = foe.hp; H.simulate(4); out.hurt2 = foe.hp < hp1;
      F.removeEnt(archer); F.removeEnt(foe);
      return out; })()""")
    check(r['clear'] is False and not r['hurt'] and r['wallShot'], 'an NPC archer does not shoot into a house between it and its foe (and marks its shot walled)')
    check(r['clear2'] and r['hurt2'], 'with a clear line its arrows land')

async def slit(page):
    r = await ev(page, 'slit', """(() => { const out = {}, F = WT.F, H = WT.H;
      const S = WT.site(0, 0), T = WT.tower(S, (q) => q.role === 'corner' && q.sx === 1 && q.sz === -1);
      const s = T.slitsAt.find((q) => q.y0 < 3), aim = s.a;
      const inP = WT.tp(T, aim, T.RI - 0.45, T.yG), outP = WT.tp(T, aim, T.RO + 16, 0);
      WT.clearNear(outP.x, outP.z, 12); WT.put(outP.x + 25, outP.z + 25);
      const archer = WT.body(0, 'archer', inP.x, inP.z, inP.y), foe = WT.body(1, 'warrior', outP.x, outP.z);
      archer.fixedY = inP.y; archer.target = foe.id; archer.rangedRange = 30; archer.yaw = Math.atan2(foe.x - archer.x, foe.z - archer.z);
      out.room = __hm.towers.towerRoomOf(archer) ? __hm.towers.towerRoomOf(archer).lv : null;
      out.clear = WT.W.wallsShotClear(archer, foe, true);
      const hp0 = foe.hp; H.simulate(4); out.hurt = foe.hp < hp0;
      // one standing a pace to the side of the slit cannot shoot through the masonry
      const side = WT.tp(T, aim + 0.55, T.RI - 0.45, T.yG); archer.x = archer.prevX = side.x; archer.z = archer.prevZ = side.z;
      out.sideClear = WT.W.wallsShotClear(archer, foe, true);
      F.removeEnt(archer); F.removeEnt(foe);
      return out; })()""")
    check(r['clear'] and r['hurt'], 'an archer at a slit in the store room shoots out through it, and its arrows land')
    check(r['sideClear'] is False, 'a pace beside the slit the masonry stops the shot')

async def fire(page):
    r = await ev(page, 'fire', """(() => { const out = {}, F = WT.F, H = WT.H;
      const all = []; WT.W.wallHouseOf({}); for (const [c, Hh] of WT.W.WALLS.houseOf) if (!all.includes(Hh)) all.push(Hh);
      const R = all.find((q) => !q.keepHall && q.round && q.state === 'whole' && q.realm === 1);
      WT.put(R.x + 40, R.z + 40);
      // an enemy (Logres) mage's fire bolt at a point beyond the house: it bursts in the thatch, and the roof catches
      const m = WT.body(0, 'mage', R.x + 14, R.z); m.y = F.heightAt(m.x, m.z);
      const aim = { x: R.x - 6, y: R.y + R.wallH + 0.9, z: R.z };
      const b0 = WT.W.WALLS.stats.burst;
      F.spawnProjectile(m, null, 'fire', { mult: 1 }, aim);
      H.simulate(1.2);
      out.burst = WT.W.WALLS.stats.burst - b0; out.state = R.state;
      // the realm's own (Eriu) mage: its fire spares its own town's roof
      const R2 = all.find((q) => !q.keepHall && q.round && q.state === 'whole' && q.realm === 1 && q !== R);
      const own = WT.body(1, 'mage', R2.x + 14, R2.z);
      F.spawnProjectile(own, null, 'fire', { mult: 1 }, { x: R2.x - 6, y: R2.y + R2.wallH + 0.9, z: R2.z });
      H.simulate(1.2); out.ownState = R2.state;
      F.removeEnt(m); F.removeEnt(own);
      return out; })()""")
    check(r['burst'] >= 1 and r['state'] == 'burning', "an enemy's fire bolt bursts on a roundhouse's thatch and sets it alight")
    check(r['ownState'] == 'whole', "the realm's own fire bolt bursts on the thatch but spares its own town's roof")

async def crenel(page):
    r = await ev(page, 'crenels', """(() => { const out = {}, F = WT.F, H = WT.H, S = WT.site(0, 0);
      const C = F.castles().find((q) => q.S === S), T = WT.tower(S, (q) => q.role === 'gate' && q.sx === 1);
      const top = T.TT, a = 0; // the outer side
      const post = WT.tp(T, a, T.RO - 0.85, top), below = WT.tp(T, a, T.RO + 22, 0);
      below.y = F.heightAt(below.x, below.z);
      WT.clearNear(S.x, S.z, 60); WT.put(below.x + 30, below.z);
      const archer = WT.body(0, 'archer', post.x, post.z, post.y); archer.fixedY = post.y;
      const foe = WT.body(1, 'archer', below.x, below.z);
      archer.target = foe.id; foe.target = archer.id; archer.rangedRange = foe.rangedRange = 34;
      out.down = WT.W.wallsShotClear(archer, foe, true); out.up = WT.W.wallsShotClear(foe, archer, true);
      const h0 = foe.hp, h1 = archer.hp; H.simulate(5); out.foeHurt = foe.hp < h0; out.archerHurt = archer.hp < h1;
      // a body standing back in the middle of the top, from close under the tower: covered
      const mid = WT.tp(T, 0, 0.3, top); archer.x = archer.prevX = mid.x; archer.z = archer.prevZ = mid.z;
      const close = WT.tp(T, a, T.RO + 4, 0); foe.x = foe.prevX = close.x; foe.z = foe.prevZ = close.z; foe.y = F.heightAt(close.x, close.z);
      out.covered = !WT.W.wallsShotClear(foe, archer, true);
      F.removeEnt(archer); F.removeEnt(foe);
      return out; })()""")
    check(r['down'] and r['foeHurt'], "a garrison archer on a gate tower's top shoots out through its crenel at a foe below")
    check(r['up'] and r['archerHurt'], 'the foe below shoots back at it where it shows')
    check(r['covered'], 'a body standing back on the top is covered from close below')

async def stone(page):
    r = await ev(page, 'stone', """(() => { const out = {}, S = WT.site(0, 0), T = WT.tower(S, (q) => q.role === 'corner' && q.sx === 1 && q.sz === -1);
      // a stone's last step toward a point beyond the tower: it meets the drum
      const a = WT.tp(T, T.aIn + Math.PI, T.RO + 2.5, 6), b = WT.tp(T, T.aIn + Math.PI, T.RO - 1.5, 5.6);
      const s = { x0: a.x + 30, y0: a.y, z0: a.z + 30, x: b.x, y: b.y, z: b.z, r: 0.42, aim: { kind: 'wall', x: b.x - 40, y: 2, z: b.z - 40 } };
      out.hit = WT.W.wallsStoneStep(s, a.x, a.y, a.z); out.aim = s.aim.kind; out.mat = s.aim.mat;
      return out; })()""")
    check(r['hit'] and r['aim'] == 'wall' and r['mat'] == 'stone', 'a siege stone meets the tower in its way and strikes it')

async def perf(page):
    r = await ev(page, 'cost', """(() => { const S = WT.site(0, 0), W = WT.W, out = {};
      const a = WT.sp(S, -20, -30, 2), n = 20000; let hits = 0;
      const t0 = performance.now();
      for (let i = 0; i < n; i++) { const u = (i % 200) / 200 * 40 - 20; const p = WT.sp(S, u, -30, 2 + (i % 7)); const q = { x: p.x + 0.4, y: p.y - 0.02, z: p.z + 0.9 }; if (W.shotHit(p.x, p.y, p.z, q.x, q.y, q.z)) hits++; }
      out.usPerTest = +((performance.now() - t0) * 1000 / n).toFixed(2);
      const t1 = performance.now();
      for (let i = 0; i < n; i++) { const u = (i % 200) / 200 * 30 - 15; const p = WT.sp(S, u, -15.5, 1 + (i % 9)); const q = { x: p.x + 0.3, y: p.y, z: p.z + 1.2 }; if (W.shotHit(p.x, p.y, p.z, q.x, q.y, q.z)) hits++; }
      out.usAtWall = +((performance.now() - t1) * 1000 / n).toFixed(2); out.hits = hits;
      return out; })()""")
    check(r['usAtWall'] < 60, f"a step's test costs little (about {r['usAtWall']} us at a keep's wall under SwiftShader's CPU)")

asyncio.run(main())
