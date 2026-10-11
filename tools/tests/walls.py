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
// the page's own frames are held (the tests draw the frames they look at): under SwiftShader a frame of the whole
// world takes seconds, and every evaluate waited behind them
(() => { if (window.__rafWrapped) { window.__rafHold = true; return; } window.__rafWrapped = true; window.__rafHold = true; const raf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = (cb) => raf((t) => { if (window.__rafHold) window.requestAnimationFrame(cb); else cb(t); }); })();
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
        if want('breach'): await breach(page)
        if want('save'): await save(page)
        if want('shots') and SHOTS: await shots(page)
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
      // a side wall with nothing stacked against it outside: the first offset where the way in from 3 m is clear
      for (const [side, lz] of [[1, 0.3], [1, -0.6], [1, 0.9], [-1, 0.3], [-1, -0.6], [-1, 0.9]]) {
        if (WT.hit(lp(side * (L.w / 2 + 3), lz, 1.2), lp(side * (L.w / 2 + 0.25), lz, 1.2))) continue;
        out.logs = WT.hit(lp(side * (L.w / 2 + 3), lz, 1.2), lp(0, lz, 1.2)); break;
      }
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
    check(r['usAtWall'] < 200 and r['usPerTest'] < 100, f"a step's test costs little ({r['usPerTest']} us in the open, {r['usAtWall']} us along a keep's wall, on a loaded machine)")

BR = r"""
window.BT = {
  // the Logres keep's right front corner tower (the third archer's post is on its top) and its section
  pick(realm = 0, k = 0, pred = (T) => T.role === 'corner' && T.sx === 1 && T.sz === 1) {
    const S = WT.site(realm, k), C = WT.F.castles().find((q) => q.S === S), W = C.sections.find((q) => q.kind === 'tower' && pred(q.T));
    return { S, C, W, T: W.T };
  },
  hitUntil(W, src, max = 80) { const T = W.T; let n = 0; const p = { x: T.wx + W.ox * (T.RO + 0.2), z: T.wz + W.oz * (T.RO + 0.2) };
    while (W.state === 'whole' && n < max) { WT.F.castleSiegeHit(src, p.x, p.z, 2.0, 4.4); n++; } return n; },
  floorH(T, a, r, y) { const p = WT.tp(T, a, r, 0); return +(WT.F.floorAt(p.x, p.z, T.S.y + y) - T.S.y).toFixed(2); },
};
"""

async def breach(page):
    await page.evaluate("() => {" + BR + "; return 0; }")
    r = await ev(page, 'towers', """(() => { const out = {}; const L = __hm.breach.list();
      out.n = L.length; out.kinds = [...new Set(L.map((W) => W.T.look + ':' + W.T.role))];
      const c = WT.F.castles(); out.per = c.map((C) => (C.sections || []).filter((W) => W.kind === 'tower').length);
      return out; })()""")
    check(r['n'] == 20 and 'stone:corner' in r['kinds'] and 'stone:gate' in r['kinds'] and 'rath:gate' in r['kinds'] and 'rath:lookout' in r['kinds'], 'every stone tower is a breachable section (Logres 6 a keep, Eriu 4)')
    r = await ev(page, 'strike', """(() => { const out = {}, { S, C, W, T } = BT.pick(), F = WT.F, H = WT.H;
      WT.clearNear(S.x, S.z, 60); const K = S.keepRef;
      // the third archer of the garrison on the top, and a body in the guard room
      const top = WT.tp(T, T.aIn + Math.PI, 1.2, T.TT), room = WT.tp(T, T.aIn + 0.6, 1.4, T.H);
      const ar = WT.body(0, 'archer', top.x, top.z, top.y), gd = WT.body(0, 'warrior', room.x, room.z, room.y);
      ar.hp = ar.maxHp = gd.hp = gd.maxHp = 2000;
      WT.put(S.x + 60, S.z + 60); H.simulate(0.3);
      out.before = { top: BT.floorH(T, T.aIn + Math.PI, 1.2, T.TT + 0.2), room: BT.floorH(T, T.aIn + 0.6, 1.4, T.H + 0.2), ladders: T.ladders.map((L) => !!L.gone), arY: +(ar.y - S.y).toFixed(2) };
      const src = WT.body(2, 'warrior', S.x + W.ox * 60, S.z + W.oz * 60); src.hp = 1e9;
      // a few stones: it cracks
      for (let i = 0; i < 4; i++) F.castleSiegeHit(src, T.wx + W.ox * (T.RO + 0.2), T.wz + W.oz * (T.RO + 0.2), 2.0, 4.4);
      out.wear = +W.wear.toFixed(2); out.stateMid = W.state;
      out.hits = 4 + BT.hitUntil(W, src);
      out.state = W.state; out.breached = !!T.breached;
      H.simulate(2.5);
      out.after = { top: BT.floorH(T, T.aIn + Math.PI, 1.2, T.TT + 0.2), room: BT.floorH(T, T.aIn + 0.6, 1.4, T.H + 0.2), ladders: T.ladders.map((L) => !!L.gone), hatches: T.hatches.map((h) => h.floor.active), doorsUp: T.doors.filter((D) => D.y > 1).map((D) => D.coll.active), arY: +(ar.y - S.y).toFixed(2), gdY: +(gd.y - S.y).toFixed(2), arHurt: ar.hp < 2000, roomOf: !!__hm.towers.towerRoomOf(gd) };
      // the rubble: a ramp up from the field and down into the store room
      out.ramp = [T.RO + 2.2, T.RO + 0.6, T.RO - 0.35, 1.2].map((r) => BT.floorH(T, W.aOut, r, 2.5));
      out.wreck = W.wreck.visible; out.news = H.WAR.news.slice(-3).map((n) => n.text || n);
      F.removeEnt(src); F.removeEnt(ar); F.removeEnt(gd);
      return out; })()""")
    check(r['before']['top'] > r['before']['room'] > 5 and not any(r['before']['ladders']), 'whole: the guard room and the top carry a body, the ladders stand')
    check(r['wear'] > 0.1 and r['stateMid'] == 'whole', f"a few stones crack it (wear {r['wear']})")
    check(r['state'] == 'breach' and r['breached'], f"more of them bring its upper works down ({r['hits']} stones of a trebuchet)")
    check(r['after']['top'] < 3 and r['after']['room'] < 3 and all(r['after']['ladders']) and not any(r['after']['hatches']) and not any(r['after']['doorsUp']), 'the rooms above are lost: floors, ladders, hatches and the doors at the walks stand down')
    check(r['after']['arY'] < 3 and r['after']['gdY'] < 3 and r['after']['arHurt'], 'the archer on its top and the guard in its room fall into the rubble, hurt by the fall')
    check(r['ramp'][0] > r['ramp'][3] - 1.5 and r['ramp'][2] > 0.6 and r['wreck'], f"a mound of rubble spills out over the fallen face (heights {r['ramp']})")
    r = await ev(page, 'storm', """(() => { const out = {}, { S, C, W, T } = BT.pick(), F = WT.F, H = WT.H, P = H.GAME.player;
      // the player walks in over the rubble from the field, through the store room and out at its courtyard door
      const a = WT.tp(T, W.aOut, T.RO + 6, 0); WT.put(a.x, a.z); P.faction = 2;
      // the way the bands storm it (siegeBreachRoute: towerBreachRoute)
      const Rt = __hm.breach.route(W), path = Rt.slice(1), goal = Rt[Rt.length - 1];
      H.UI.modal = null; H.INPUT.keys.add('KeyW');
      let t = 0, i = 0; const ys = [];
      while (t < 40 && i < path.length) { const p = path[i]; if (Math.hypot(p.x - P.x, p.z - P.z) < 0.6) { i++; continue; } H.CAM.yaw = Math.atan2(p.x - P.x, p.z - P.z); H.simulate(0.1, 0.02); t += 0.1; if (Math.round(t * 10) % 5 === 0) ys.push(+(P.y - S.y).toFixed(1)); }
      H.INPUT.keys.delete('KeyW'); H.simulate(0.2);
      out.reached = i; out.t = +t.toFixed(1); out.inCourt = F.castleInside ? null : null; out.end = WT.F.castles ? +Math.hypot(P.x - goal.x, P.z - goal.z).toFixed(2) : null; out.ys = ys.slice(0, 30);
      // the siege's commanders see it as a breach to storm
      out.open = C.sections.filter((q) => q.state === 'breach').map((q) => q.kind);
      P.faction = 0;
      return out; })()""")
    check(r['reached'] == 5, f"the player climbs in over the rubble, through the store room and out into the courtyard the way the bands storm it ({r['t']} s)")
    check('tower' in r['open'], 'the commanders see the fallen tower as a breach to storm')
    r = await ev(page, 'mend', """(() => { const out = {}, { S, C, W, T } = BT.pick(), F = WT.F, H = WT.H, K = S.keepRef;
      WT.put(S.x + 80, S.z + 80); WT.clearNear(S.x, S.z, 60); K.lastEnemyNear = -1e9;
      const st = []; for (let i = 0; i < 24; i++) { H.simulate(8); K.lastEnemyNear = -1e9; st.push(W.state[0] + (W.state === 'repair' ? Math.round(W.t * 10) : '')); }
      out.states = st.join(' '); out.state = W.state; out.fresh = +(W.fresh || 0).toFixed(2);
      out.top = BT.floorH(T, T.aIn + Math.PI, 1.2, T.TT + 0.2); out.room = BT.floorH(T, T.aIn + 0.6, 1.4, T.H + 0.2);
      out.ladders = T.ladders.map((L) => !!L.gone); out.hatches = T.hatches.map((h) => h.floor.active); out.breached = !!T.breached; out.hp = W.hp > 0 && W.hp === W.maxHp;
      out.colls = T.colls.filter((c) => !c.active).length;
      return out; })()""")
    check(r['state'] == 'whole' and not r['breached'] and 'r' in r['states'], f"in peace its owners mend it behind scaffolding ({r['states']})")
    check(r['top'] > 9 and r['room'] > 5 and not any(r['ladders']) and all(r['hatches']) and r['hp'], 'mended: its rooms, ladders and hatches are back and it stands whole')

async def save(page):
    r = await ev(page, 'save', """(() => { const out = {}, { S, C, W, T } = BT.pick(0, 1, (T) => T.role === 'gate' && T.sx === -1), F = WT.F, H = WT.H;
      const src = WT.body(2, 'warrior', S.x + W.ox * 60, S.z + W.oz * 60); src.hp = 1e9;
      out.hits = BT.hitUntil(W, src); F.removeEnt(src);
      const B = BT.pick(1, 0, (T) => T.role === 'lookout' && T.sx === 1), src2 = WT.body(2, 'warrior', B.S.x + B.W.ox * 60, B.S.z + B.W.oz * 60);
      for (let i = 0; i < 5; i++) F.castleSiegeHit(src2, B.T.wx + B.W.ox * (B.T.RO + 0.2), B.T.wz + B.W.oz * (B.T.RO + 0.2), 2.0, 4.4); F.removeEnt(src2);
      out.a = [W.state, W.k]; out.b = [B.W.state, +B.W.wear.toFixed(2), B.W.k];
      H.UI.modal = 'menu'; F.saveNow();
      return out; })()""")
    check(r['a'][0] == 'breach' and r['b'][0] == 'whole' and r['b'][1] > 0, 'a Logres gate tower breached and an Eriu lookout cracked before saving')
    await page.goto('http://hm.test/', wait_until='commit', timeout=300000)
    await page.wait_for_function("window.__hm && window.__hm.ready && ((window.__hm.UI.modal = 'menu'), true)", timeout=240000, polling=1000)
    await page.evaluate("__hm.fn.setQuality('low')")
    await page.evaluate("() => {" + HELPERS + BR + "; return 0; }")
    r2 = await ev(page, 'loaded', """(() => { const out = {}; const { W, T } = BT.pick(0, 1, (T) => T.role === 'gate' && T.sx === -1), B = BT.pick(1, 0, (T) => T.role === 'lookout' && T.sx === 1);
      out.a = [W.state, W.k, !!T.breached, T.ladders.map((L) => !!L.gone), T.hatches.map((h) => h.floor.active)]; out.b = [B.W.state, +B.W.wear.toFixed(2)];
      out.walls = __hm.land.LAND.restored ? __hm.land.LAND.restored.walls : null; out.errors = __hm.errors.slice(0, 3);
      return out; })()""")
    check(r2['a'][0] == 'breach' and r2['a'][2] and all(r2['a'][3]) and not any(r2['a'][4]), 'after loading, the gate tower lies breached: its ladders and hatches down')
    check(r2['b'][0] == 'whole' and abs(r2['b'][1] - r['b'][1]) < 0.01, 'and the lookout keeps its cracks')
    check(not r2['errors'], 'no errors on loading')

async def shots(page):
    await page.evaluate("() => {" + BR + "; return 0; }")
    cam = """(x, y, z, tx, ty, tz) => { const H = __hm; H.UI.modal = 'menu'; H.CAM.mode = 'fixed'; H.camera.position.set(x, y, z); H.camera.lookAt(tx, ty, tz); H.camera.updateMatrixWorld(); }"""
    # arrows stuck in a Thule palisade and a house, arrows glanced off stone
    await shot(page, 'walls_stuck', """(() => { const cam = """ + cam + """; const F = WT.F, H = WT.H, P = H.GAME.player;
      const all = []; WT.W.wallHouseOf({}); for (const [c, Hh] of WT.W.WALLS.houseOf) if (!all.includes(Hh)) all.push(Hh);
      // a Logres house with a long plain side wall and room before it
      const Hs = all.find((q) => !q.keepHall && q.style === 'stone' && q.state === 'whole' && q.d > 6.5) || all.find((q) => !q.keepHall && q.style === 'stone');
      const at = (lx, lz, ly) => ({ x: Hs.x + lx * Hs.c + lz * Hs.s, y: Hs.y + ly, z: Hs.z - lx * Hs.s + lz * Hs.c });
      const a = at(Hs.w / 2 + 9, 0, 0); WT.put(a.x, a.z); WT.clearNear(Hs.x, Hs.z, 25); H.UI.modal = null;
      for (let i = 0; i < 12; i++) { const tg = at(Hs.w / 2, -1.6 + (i % 4) * 1.05 + (Math.random() - 0.5) * 0.5, 0.9 + (i / 4 | 0) * 0.55 + Math.random() * 0.3); P.yaw = Math.atan2(tg.x - P.x, tg.z - P.z); H.CAM.yaw = P.yaw; const dh = Math.hypot(tg.x - P.x, tg.z - P.z); H.CAM.pitch = 0.3 - Math.atan2(tg.y - (P.y + 1.5), dh); __hm.cls.looseArrow(P, 1, null, 0); H.simulate(0.3); }
      H.setTod(0.4); WT.put(a.x + 20, a.z + 20);
      const c = at(Hs.w / 2 + 2.6, 3.4, 1.75), t = at(Hs.w / 2, -0.2, 1.5); cam(c.x, c.y, c.z, t.x, t.y, t.z); return __hm.walls.WALLS.stuck.length; })()""")
    await shot(page, 'walls_glance', """(() => { const cam = """ + cam + """; const F = WT.F, H = WT.H, P = H.GAME.player, S = WT.site(0, 1);
      WT.clearNear(S.x, S.z, 50); const a = WT.sp(S, -4, -3, 0); WT.put(a.x, a.z); H.UI.modal = null;
      for (let i = 0; i < 10; i++) { const tg = WT.sp(S, -6 + (i % 5) * 1.1, -13.8, 0); P.yaw = Math.atan2(tg.x - P.x, tg.z - P.z); H.CAM.yaw = P.yaw; H.CAM.pitch = 0.2; __hm.cls.looseArrow(P, 1, null, 0); H.simulate(0.3); }
      H.simulate(2); H.setTod(0.4); WT.put(a.x + 30, a.z + 30);
      const c = WT.sp(S, -0.5, -9.5, 1.9), t = WT.sp(S, -4.5, -12.8, 0.1); cam(c.x, c.y, c.z, t.x, t.y, t.z); return __hm.walls.WALLS.stats.glanced; })()""")
    # the breached tower (the Logres keep's other corner) by day and night, high and low
    for q, tod, name in (('high', 0.42, 'walls_breach_day'), ('high', 2.05, 'walls_breach_night'), ('low', 0.42, 'walls_breach_low')):
        await page.evaluate(f"__hm.fn.setQuality('{q}')")
        await shot(page, name, """(() => { const cam = """ + cam + """; const { S, C, W, T } = BT.pick(0, 0, (T) => T.role === 'corner' && T.sx === -1 && T.sz === -1), F = WT.F, H = WT.H;
          S.keepRef.lastEnemyNear = H.GAME.t + 1e6;
          if (W.state === 'whole') { const src = WT.body(2, 'warrior', S.x + W.ox * 60, S.z + W.oz * 60); src.hp = 1e9; BT.hitUntil(W, src); F.removeEnt(src); H.simulate(3); }
          H.setTod(""" + str(tod) + """);
          const c = WT.tp(T, W.aOut + 0.55, T.RO + 15, 5.2), t = WT.tp(T, W.aOut, 0, 4.0); WT.put(c.x + 40, c.z + 40); cam(c.x, c.y, c.z, t.x, t.y, t.z); return W.state; })()""")
    await page.evaluate("__hm.fn.setQuality('high')")
    await shot(page, 'walls_breach_mend', """(() => { const cam = """ + cam + """; const { S, W, T } = BT.pick(0, 0, (T) => T.role === 'corner' && T.sx === -1 && T.sz === -1), H = WT.H;
      S.keepRef.lastEnemyNear = -1e9; for (let i = 0; i < 10 && W.state !== 'whole' && !(W.state === 'repair' && W.t > 0.45); i++) { H.simulate(10); S.keepRef.lastEnemyNear = -1e9; }
      H.setTod(0.42); const c = WT.tp(T, W.aOut - 0.5, T.RO + 14, 6.0), t = WT.tp(T, W.aOut, 0, 4.5); cam(c.x, c.y, c.z, t.x, t.y, t.z); return [W.state, +W.t.toFixed(2)]; })()""")
    await page.evaluate("__hm.fn.setQuality('low')")
    await look_shots(page)

LK = r"""
window.LKT = {
  kinds() { const L = __hm.towers.TOWER.list, f = (q) => L.find(q); return { tc: f((T) => T.look === 'timber' && T.role === 'corner' && T.sx === 1 && T.sz === 1), lc: f((T) => T.look === 'stone' && T.role === 'corner' && T.sx === 1 && T.sz === 1), lg: f((T) => T.look === 'stone' && T.role === 'gate' && T.sx === 1) }; },
  cam(T, a, r, y, ta, tr, ty) { const H = __hm, p = WT.tp(T, a, r, y), q = WT.tp(T, ta, tr, ty); H.UI.modal = 'menu'; H.CAM.mode = 'fixed'; H.camera.position.set(p.x, p.y, p.z); H.camera.lookAt(q.x, q.y, q.z); H.camera.updateMatrixWorld(); },
  empty(S) { const F = WT.F, K = S.keepRef; for (const id of [...K.guards]) { const g = F.getEnt(id); if (g) F.removeEnt(g); } K.guards.clear(); K.nextGuardAt = 1e9; WT.clearNear(S.x, S.z, 45); },
  body(S, realm, cls, x, z, y, role = 'guard') { const e = WT.F.spawnRealmUnit(realm, cls, 30, role, x, z, {}); e.y = y; e.ai.post = { x, z, leash: 0.5 }; e.testFoe = true; e.hp = e.maxHp = 1e5; return e; },
};
"""

async def look_shots(page):
    await page.evaluate("() => {" + LK + "; return 0; }")
    # the burnt log tower: fallen in with its char smouldering, at dusk, then cold
    await page.evaluate("__hm.fn.setQuality('high')")
    await shot(page, 'walls_charred', """(() => { const H = __hm, T = LKT.kinds().tc, S = T.S, F = __hm.towerfire;
      LKT.empty(S); if (!T.fallen) { F.towerIgnite(T, 3); H.simulate(F.TFIRE.burn + 1); }
      H.setTod(0.45); H.simulate(4); WT.put(S.x + 60, S.z + 60);
      LKT.cam(T, T.aIn, T.RO + 9, 6.0, T.aIn, 0, 7.5); return { fallen: !!T.fallen, ember: T.fallen && +T.fallen.ember.toFixed(2), char: T.char }; })()""")
    await shot(page, 'walls_charred_dusk', """(() => { const H = __hm, T = LKT.kinds().tc; H.setTod(0.8); LKT.cam(T, T.aIn + 0.5, T.RO + 6, 4.5, T.aIn, 0, 7.8); return 0; })()""")
    await shot(page, 'walls_charred_cold', """(() => { const H = __hm, T = LKT.kinds().tc, S = T.S; S.keepRef.lastEnemyNear = H.GAME.t + 1e6; H.simulate(140); H.setTod(0.45); LKT.cam(T, T.aIn, T.RO + 9, 6.0, T.aIn, 0, 7.5); return { ember: T.fallen && +T.fallen.ember.toFixed(2) }; })()""")
    # the gallery floor of a whole log tower in the sun, at high and medium (no lines of sun through its boards)
    await page.evaluate("(() => { const T = LKT.kinds().tc; if (T.fallen) __hm.towerfire.towerRebuilt(T); T.char = 0; T.fresh = 0; __hm.towerfire.castleTowerUpload(T.C); return 0; })()")
    for q in ('high', 'medium'):
        await page.evaluate(f"__hm.fn.setQuality('{q}')")
        await shot(page, 'walls_gallery_' + q, """(() => { const H = __hm, T = LKT.kinds().tc; H.setTod(0.36); H.simulate(0.2); LKT.cam(T, T.aIn + Math.PI, 1.6, T.TT + 1.75, T.aIn, 1.2, T.TT); return 0; })()""")
    # a hatch lid in a Logres corner tower's top (no seams across its boards)
    await page.evaluate("__hm.fn.setQuality('high')")
    await shot(page, 'walls_hatch', """(() => { const H = __hm, T = LKT.kinds().lc, L = T.ladders[1], Hh = L.hatch; Hh.held = false; Hh.until = 0; H.simulate(1.5); H.setTod(0.45);
      const c = WT.tp(T, L.a + 0.9, 1.4, T.TT + 1.6), q = { x: Hh.cx, y: T.S.y + T.TT, z: Hh.cz }; H.UI.modal = 'menu'; H.CAM.mode = 'fixed'; H.camera.position.set(c.x, c.y, c.z); H.camera.lookAt(q.x, q.y, q.z); H.camera.updateMatrixWorld(); return Hh.k; })()""")
    # a fight on a ladder: a climber held below the hatch striking up at a warrior beside it, from the top and from the room
    await shot(page, 'walls_ladder_fight', """(() => { const H = __hm, F = WT.F, T = LKT.kinds().lc, S = T.S, L = T.ladders[1], Hh = L.hatch;
      LKT.empty(S); Hh.held = true; H.simulate(1.0, 0.02);
      const dp = WT.tp(T, L.a + 0.75, 1.15, T.TT), d = LKT.body(S, 0, 'warrior', dp.x, dp.z, S.y + T.TT); d.yaw = Math.atan2(Hh.cx - d.x, Hh.cz - d.z);
      const c = LKT.body(S, 1, 'warrior', L.fx, L.fz, S.y + L.yb, 'soldier'); c.ai.post = null;
      H.towers.towerClimb(c, L, 1); for (let i = 0; i < 90; i++) { H.simulate(0.1, 0.02); if (c.anim.act === 18 && c.anim.actT > 0.25) break; }
      d.target = c.id; H.setTod(0.45);
      LKT.cam(T, L.a - 0.95, 5.6, T.TT + 5.2, L.a, 1.45, T.TT + 0.5); return { act: c.anim.act, y: +(c.y - S.y).toFixed(2), d: d.anim.act }; })()""")
    await shot(page, 'walls_ladder_fight_below', """(() => { const H = __hm, T = LKT.kinds().lc, L = T.ladders[1]; H.simulate(0.2, 0.02); LKT.cam(T, L.a + Math.PI - 0.4, 1.7, T.H + 1.0, L.a, 1.7, T.TT - 0.4); return 0; })()""")
    await page.evaluate("__hm.fn.setQuality('low')")


asyncio.run(main())
