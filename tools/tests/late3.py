"""[late3] The Deep Barrow end to end, and a veteran the March can see.
usage: python3 tools/tests/late3.py [only=probe,seal,halls,water,pitch,slabs,wall,lord,fight,save,reload,shots,std,mantle]
       [cls=warrior,archer,mage,priest] [lv=45,50] [q=low|high] [noshots] [phone]
  probe: the deep is built (rooms, cells, walls, the seal, the slabs, the channels, the water), its dead and lord stand
  seal:  the seal holds below 45 or before the Hollow King has fallen to you, says why, and yields to his slayer at 45
  halls: every hall is reachable on foot from the seal (the grid), nothing of the deep is walkable that should not be
  water: the cistern floods as you cross it: wading, swimming, fire put out, the drowned rise, it drains again
  pitch: fire spreads along the channels from a fire spell, burns who stands in it, burns out and re-arms
  slabs: a gallery slab cracks under a body, falls; the body falls into the embers and climbs out; the slab rises again
  wall:  the cracked wall breaks under Use (three blows) and under a meteor; the tomb's chest behind it
  lord:  the Ash-Crowned wakes, cleaves, speaks the Word (broken by a stun; spoken, it lights the pitch), stamps the slabs
         down from two thirds, calls his wardens, burns at a third, resets when you leave, falls; the hoard opens
  fight: each calling's skilled bot (fair gear, three draughts) through the deep's halls and against its lord at 45 and 50
  save:  the part read back whole, damaged ones made sane, an old save
  reload: saved, the page reloaded with the same storage, the seal open, the falls counted, the name earned
  shots: the halls by their own light (high and low), the lord's fight
"""
import json, asyncio, sys, pathlib, time
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
from hmlib import setup, OUT
from playwright.async_api import async_playwright

ARGS = sys.argv[1:]
def arg(k, d=None):
    for a in ARGS:
        if a.startswith(k + '='): return a.split('=', 1)[1]
    return d
ONLY = set((arg('only') or 'probe,seal,halls,water,pitch,slabs,wall,lord,save,fight,reload,shots').split(','))
CLS = (arg('cls') or 'warrior,archer,mage,priest').split(',')
LVS = [int(x) for x in (arg('lv') or '45,50').split(',')]
NOSHOTS = 'noshots' in ARGS
Q = arg('q', 'low')
FAILS = []

def check(ok, msg):
    print(('  ok   ' if ok else '  FAIL ') + msg, flush=True)
    if not ok: FAILS.append(msg)

async def ev(page, js):
    return await page.evaluate(js)

HELP = r"""
window.L3 = {
  H: () => window.__hm,
  D: () => window.__hm.deep.DEEP,
  pt: (u, v) => { const F = __hm.fn; return F.dunPoint(u, v); },
  to: (u, v) => { const H = __hm, F = H.fn, P = H.GAME.player, p = F.dunPoint(u, v); P.x = P.prevX = p.x; P.z = P.prevZ = p.z; P.y = p.y; P.onGround = true; P.vy = 0; H.fn.setIndoor(true); return p; },
  start: (cls, lv, realm) => { const H = __hm, F = H.fn; F.newCharacter(); H.start({ realm: realm || 0, cls, level: lv }); const P = H.GAME.player; H.bal.applyFairGear(P, Math.min(50, lv)); H.INV.potions = 3; P.hp = P.maxHp; P.power = P.maxPower; return 0; },
  calm: () => { const H = __hm; for (const e of H.ENT) if (e.alive && e.faction === H.FACTION_MONSTER && e.x > 1000 && !e.deepLord && e.role !== 'dungeonBoss') { e.damagers = null; H.fn.killEnt(e, null); } return 0; },
  kingDown: () => { const H = __hm; H.late.LATE2.d.king = Math.max(1, H.late.LATE2.d.king); H.GAME.prog.kingKills = Math.max(1, H.GAME.prog.kingKills || 0); return 0; },
  safe: () => { const P = __hm.GAME.player; P.hp = P.maxHp; P.power = P.maxPower; P.buffs.length = 0; return 0; },
};
0;
"""

async def main():
    async with async_playwright() as p:
        b, page, logs = await setup(p, touch='phone' in ARGS, w=640 if 'phone' not in ARGS else 390, h=360 if 'phone' not in ARGS else 780)
        await page.evaluate(f"__hm.fn.setQuality('{Q}')")
        await page.evaluate(HELP)
        await page.evaluate("L3.start('warrior', 50)")
        t0 = time.time()
        if 'probe' in ONLY: await probe(page)
        if 'seal' in ONLY: await seal(page)
        if 'halls' in ONLY: await halls(page)
        if 'water' in ONLY: await water(page)
        if 'pitch' in ONLY: await pitch(page)
        if 'slabs' in ONLY: await slabs(page)
        if 'wall' in ONLY: await wall(page)
        if 'lord' in ONLY: await lord(page)
        if 'save' in ONLY: await save(page)
        if 'fight' in ONLY: await fight(page)
        if 'shots' in ONLY and not NOSHOTS: await shots(page)
        errs = await ev(page, "__hm.errors.map(String).slice(0, 8)")
        check(not errs, f"no runtime errors ({errs[:3]})")
        print('logs', [l for l in logs][:6])
        if 'reload' in ONLY: await reload(page)
        print(f'took {time.time() - t0:.0f} s')
        print('FAILED: ' + '; '.join(FAILS) if FAILS else 'all late3 checks passed', flush=True)
        await b.close()

async def probe(page):
    r = await ev(page, """(() => { const H = __hm, F = H.fn, D = H.deep.DEEP, DN = H.DUN;
      const rooms = H.deep.DEEP_ROOMS.map((R) => R.id);
      let open = 0, slab = 0, stair = 0;
      for (let k = 0; k < DN.cell.length; k++) { if (!F.late3IsDeepCell || !DN.room) break; }
      for (let k = 0; k < DN.cell.length; k++) { const R = DN.room[k] >= 0 ? H.deep.DEEP_ROOMS.find((x) => x.idx === DN.room[k]) : null; if (!R) continue; if (DN.cell[k] === 1) open++; else if (DN.cell[k] === 4) slab++; else if (DN.cell[k] === 3) stair++; }
      const L = F.getEnt(D.lord), mobs = H.ENT.filter((e) => e.alive && e.deep).map((e) => e.mobType);
      return { built: D.built, rooms: rooms.length, open, slab, stair, cells: D.cells.length, slabs: D.slabs.length, chests: D.chests.length, walls: (D.walls || []).length,
        lord: L ? { lvl: L.level, hp: Math.round(L.maxHp), name: L.name, role: L.role } : null, mobs, opened: D.opened, wy: D.wy, GH: DN.GH }; })()""")
    print(json.dumps(r))
    check(r['built'] and r['rooms'] == 11, f"the deep is built: {r['rooms']} rooms, {r['open']} open cells, {r['slab']} slab cells, {r['stair']} stair cells")
    check(r['slab'] == 5 * 24 + 12 * 24, f"every slab's cells are slab cells ({r['slab']})")
    check(r['stair'] == 22 * 4, f"the Long Stair's cells are steps ({r['stair']})")
    check(r['cells'] >= 100 and r['slabs'] == 17 and r['chests'] == 4, f"{r['cells']} pitch cells, {r['slabs']} slabs, {r['chests']} chests")
    check(r['lord'] is not None and r['lord']['role'] == 'dungeonBoss', f"the Ash-Crowned sits his throne: {r['lord']}")
    check(len(r['mobs']) >= 12, f"the deep's dead stand: {sorted(set(r['mobs']))} ({len(r['mobs'])})")

async def seal(page):
    r = await ev(page, """(() => { const H = __hm, F = H.fn, D = H.deep.DEEP, P = H.GAME.player;
      H.late.LATE2.d.king = 0; H.GAME.prog.kingKills = 0; H.GAME.prog.level = 44;
      const a = { ready44: H.deep.late3SealReady(), why: H.deep.late3SealWhy() };
      L3.kingDown(); a.ready44k = H.deep.late3SealReady(); a.why44k = H.deep.late3SealWhy();
      H.GAME.prog.level = 50; a.ready50 = H.deep.late3SealReady();
      // stand before the seal in the Hollow King's hall: the offer, then break it
      L3.to(193, 12.6); H.simulate(0.2);
      const offers = []; H.deep.late3Offers(P, (d, r, label, fn) => { if (d < r) offers.push(label); });
      a.offers = offers;
      a.collBefore = D.seal.coll.active;
      // walk at the seal: it holds
      const z0 = P.z; for (let i = 0; i < 30; i++) { P.yaw = 0; F.stepTo(P, P.x, P.z + 0.15); } a.blockedAt = +(F.dunV(P.z)).toFixed(2);
      H.deep.late3SealOpen(false); H.simulate(4.0);
      a.open = D.seal.open; a.collAfter = D.seal.coll.active; a.opened = D.opened;
      for (let i = 0; i < 40; i++) F.stepTo(P, P.x, P.z + 0.15);
      a.pastAt = +(F.dunV(P.z)).toFixed(2);
      return a; })()""")
    print(json.dumps(r))
    check(not r['ready44'] and 'Hollow King' in r['why'] and '45' in r['why'], f"below 45 and before the Hollow King the seal holds and says why: {r['why'][:90]}")
    check(not r['ready44k'] and '45' in r['why44k'], f"the Hollow King's slayer at 44 is told to come back at 45: {r['why44k'][:90]}")
    check(r['ready50'], 'his slayer at 50 may break it')
    check(any('seal' in o for o in r['offers']), f"Use at the seal offers to break it: {r['offers']}")
    check(r['collBefore'] and r['blockedAt'] < 15.2, f"the seal stands in the way (stopped at v {r['blockedAt']})")
    check(r['opened'] and r['open'] > 0.99 and not r['collAfter'], 'broken, it sinks into the floor and the way is open')
    check(r['pastAt'] > 15.6, f"walked on past it down the stair (v {r['pastAt']})")

async def halls(page):
    r = await ev(page, """(() => { const H = __hm, F = H.fn, DN = H.DUN;
      // a flood fill over the walkable cells from the stair's top: every deep room reached
      const GW = DN.GW, seen = new Uint8Array(DN.cell.length), q = [];
      const k0 = F.dunCellAt(F.dunWX(193), F.dunWZ(15.5)); seen[k0] = 1; q.push(k0);
      while (q.length) { const k = q.pop(), i = k % GW, j = (k / GW) | 0; for (const [a, c] of [[1,0],[-1,0],[0,1],[0,-1]]) { const n = F.dunIdx(i + a, j + c); if (n < 0 || seen[n] || !(DN.cell[n] === 1 || DN.cell[n] === 3 || DN.cell[n] === 4)) continue; seen[n] = 1; q.push(n); } }
      const reach = {}; for (const R of H.deep.DEEP_ROOMS) { reach[R.id] = false; }
      for (let k = 0; k < seen.length; k++) if (seen[k] && DN.room[k] >= 0) { const R = H.deep.DEEP_ROOMS.find((x) => x.idx === DN.room[k]); if (R) reach[R.id] = true; }
      // heights along the way: the stair's foot, the halls' floors
      const fl = (u, v) => +F.heightAt(F.dunWX(u), F.dunWZ(v)).toFixed(2);
      return { reach, stairTop: fl(193, 15.5), stairFoot: fl(193, 36.5), land: fl(193, 40), cist: fl(160, 38), pool: fl(168, 48), pyres: fl(120, 46), crack: fl(70, 49), ash: fl(40, 48), dais: fl(23, 48.5),
        zones: ['dstair','cistern','pyres','crack','ashhall'].map((id) => { const R = H.deep.DUN_ROOM[id], p = F.dunPoint((R.u[0]+R.u[1])/2, (R.v[0]+R.v[1])/2); return F.zoneAt(p.x, p.z).name; }) }; })()""")
    print(json.dumps(r))
    check(all(r['reach'].values()), f"every hall of the deep is reached on foot from the seal: {[k for k,v in r['reach'].items() if not v]}")
    check(abs(r['stairTop'] + 7.5) < 0.3 and abs(r['stairFoot'] + 18) < 0.3 and abs(r['ash'] + 18) < 0.05, f"the Long Stair goes down twelve metres ({r['stairTop']} to {r['stairFoot']}), the halls at -18")
    check(r['pool'] < -19.5 and abs(r['dais'] + 17.4) < 0.05, f"the basin lies lower ({r['pool']}), the dais higher ({r['dais']})")
    check(r['zones'] == ['The Long Stair', 'The Sunken Cistern', 'The Hall of Pyres', 'The Breaking Gallery', 'The Ash Throne'], f"the halls' names: {r['zones']}")

async def water(page):
    r = await ev(page, """(() => { const H = __hm, F = H.fn, D = H.deep.DEEP, P = H.GAME.player; L3.calm(); L3.safe();
      D.flood.st = 0; D.flood.next = 0; D.wy = H.deep.DEEP_FLOOD.base;
      const a = {};
      L3.to(178, 38.5); H.simulate(0.5); a.dryWalk = F.waterAt(P.x, P.z) ? F.waterAt(P.x, P.z).depth : 0; a.poolDepth = +(F.waterAt(F.dunWX(168), F.dunWZ(48.5)) || { depth: 0 }).depth.toFixed(2);
      // crossing the cistern: past its middle the sluices burst
      L3.to(166, 38.5); H.simulate(0.3); a.st = D.flood.st; a.drowned = D.flood.drowned.length;
      H.simulate(18); a.wy = +D.wy.toFixed(2); const w = F.waterAt(P.x, P.z); a.walkDepth = w ? +w.depth.toFixed(2) : 0; a.wade = +(P.wadeK || 0).toFixed(2);
      // into the basin: swimming, a fire on you put out
      L3.to(168, 48.5); H.fn.addBuff(P, 'burn', 10, 6, null); H.simulate(1.5); a.swim = !!P.swim; a.burning = P.buffs.some((b) => b.kind === 'burn');
      a.float = +(D.wy - P.y).toFixed(2);
      // drink it
      L3.to(163, 41.2); H.simulate(0.3); const offers = []; F.currentInteraction && 0;
      H.simulate(70); a.drained = +D.wy.toFixed(2); a.stAfter = D.flood.st; a.floods = D.stats.floods;
      return a; })()""")
    print(json.dumps(r))
    check(r['dryWalk'] == 0 and r['poolDepth'] > 0.2, f"the walkways dry, the basin holding water ({r['poolDepth']} m)")
    check(r['st'] >= 1, 'past the cistern\'s middle its sluices burst')
    check(r['drowned'] >= 1, f"the drowned rise with it ({r['drowned']})")
    check(r['wy'] > -17.5 and r['walkDepth'] > 0.4 and r['wade'] > 0.3, f"the water rises over the walkways (surface {r['wy']}, {r['walkDepth']} m deep: wading {r['wade']})")
    check(r['swim'] and not r['burning'], f"in the basin you swim, and the water puts out a fire on you (floating {r['float']} m under the surface)")
    check(r['drained'] < -19 and r['stAfter'] == 0, f"it drains again ({r['drained']})")

async def pitch(page):
    r = await ev(page, """(() => { const H = __hm, F = H.fn, D = H.deep.DEEP, P = H.GAME.player; L3.calm(); L3.safe();
      H.deep.deepPitchOut(); for (const C of D.cells) { C.ch = 0; C.st = 0; }
      const a = {};
      const C0 = D.cells.find((c) => c.hall === 'pyres');
      L3.to(F.dunU(C0.x) + 3, F.dunV(C0.z) + 3); H.simulate(0.2);
      // a fire spell landing on the pitch (fireLandsAt) lights it
      a.lit = F.fireLandsAt(C0.x, C0.y + 0.2, C0.z, 1.2, P);
      H.simulate(3); a.burning3 = D.cells.filter((c) => c.st === 1).length;
      H.simulate(4); a.burning7 = D.cells.filter((c) => c.st === 1 && c.hall === 'pyres').length; a.fires = D.fires.length;
      // a body stood in the burning pitch burns
      const C1 = D.cells.find((c) => c.st === 1 && c.heat > 0.6);
      P.x = P.prevX = C1.x; P.z = P.prevZ = C1.z; const hp0 = P.hp; H.simulate(1.0); a.harm = +((hp0 - P.hp) / P.maxHp).toFixed(3);
      L3.safe(); L3.to(F.dunU(C0.x) + 3, F.dunV(C0.z) + 3);
      H.simulate(30); a.burnt = D.cells.filter((c) => c.st === 2).length; a.burningLate = D.cells.filter((c) => c.st === 1).length;
      a.relight = F.fireLandsAt(C0.x, C0.y + 0.2, C0.z, 1.2, P);
      H.simulate(50); a.rearmed = D.cells.filter((c) => c.st === 0).length; a.total = D.cells.length; a.firesAfter = D.fires.length;
      return a; })()""")
    print(json.dumps(r))
    check(r['lit'] >= 1, f"a fire spell landing on the pitch lights it ({r['lit']} cells)")
    check(r['burning7'] > r['burning3'] >= 1, f"the fire spreads along the channels ({r['burning3']} cells burning at 3 s, {r['burning7']} at 7 s, {r['fires']} flames)")
    check(r['harm'] > 0.04, f"whoever stands in the burning pitch burns ({r['harm'] * 100:.1f}% of health a second)")
    check(r['burnt'] > 10 and r['relight'] == 0, f"it burns out ({r['burnt']} cells charred) and a burnt channel will not catch again at once")
    check(r['rearmed'] == r['total'] and r['firesAfter'] == 0, f"the pitch seeps back ({r['rearmed']} of {r['total']} cells ready again), no flame left")

async def slabs(page):
    r = await ev(page, """(() => { const H = __hm, F = H.fn, D = H.deep.DEEP, P = H.GAME.player; L3.calm(); L3.safe();
      const S = D.slabs.find((s) => s.hall === 'crack' && s.st === 0); const a = {};
      L3.to((S.u0 + S.u1) / 2, (S.v0 + S.v1) / 2); const y0 = P.y, hp0 = P.hp;
      H.simulate(1.0); a.stAfter1 = S.st;
      H.simulate(0.8); a.cracked = S.st >= 1;
      H.simulate(1.0); a.fell = S.st >= 2; a.falling = !!P.l3fall; a.cellOpen = F.isWalkable(S.x, S.z);
      H.simulate(0.8); a.pitY = +P.y.toFixed(2); a.harm = +((hp0 - P.hp) / P.maxHp).toFixed(3);
      H.simulate(2.2); a.out = !P.l3fall; a.yOut = +P.y.toFixed(2); a.outsideSlab = !(F.dunU(P.x) > S.u0 && F.dunU(P.x) < S.u1 && F.dunV(P.z) > S.v0 && F.dunV(P.z) < S.v1) || F.isWalkable(P.x, P.z);
      // the slab rises again in time, nobody near
      L3.to(60, 49); H.simulate(46); a.risen = S.st === 0 && F.isWalkable(S.x, S.z); a.meshY = +S.mesh.position.y.toFixed(2);
      // a meteor on a slab breaks it at once
      const S2 = D.slabs.find((s) => s.hall === 'crack' && s.st === 0 && s !== S);
      F.natureImpact(S2.x, S2.z, 'meteor', 3); a.meteor = S2.st === 1;
      H.simulate(2.5); a.meteorFell = S2.st >= 2;
      a.falls = D.stats.falls; return a; })()""")
    print(json.dumps(r))
    check(r['stAfter1'] == 0 and r['cracked'], 'a slab stood on a moment holds, stood on too long it cracks')
    check(r['fell'] and r['falling'] and not r['cellOpen'], 'it falls, the body on it with it, and where it lay is no ground')
    check(r['pitY'] < -20 and r['harm'] > 0.05, f"the body lands in the embers ({r['pitY']}) burnt and hurt ({r['harm'] * 100:.0f}%)")
    check(r['out'] and abs(r['yOut'] + 18) < 0.3 and r['outsideSlab'], f"and climbs out onto firm ground ({r['yOut']})")
    check(r['risen'] and abs(r['meshY'] + 18) < 0.02, 'the slab rises again in time, nobody near')
    check(r['meteor'] and r['meteorFell'], 'a meteor on a slab breaks it')

async def wall(page):
    r = await ev(page, """(() => { const H = __hm, F = H.fn, D = H.deep.DEEP, P = H.GAME.player; L3.calm(); L3.safe();
      D.wallBroken = false; D.wall.hits = 0; H.deep.DEEP.wall.mesh.visible = true; D.wall.coll.active = true;
      const a = {}; L3.to(67.5, 50.6); H.simulate(0.2);
      const offers = []; H.deep.late3Offers(P, (d, r, label, fn) => { if (d < r) offers.push(label); }); a.offers = offers;
      a.blocked = !!D.wall.coll.active;
      for (let i = 0; i < 3; i++) { H.deep.deepWallStrike(); H.simulate(1.0); }
      a.broken = D.wallBroken; a.coll = D.wall.coll.active; a.rubble = D.rubble.visible;
      // walk through into the tomb: its chest
      for (let i = 0; i < 40; i++) F.stepTo(P, P.x, P.z + 0.15); a.inTomb = F.dunV(P.z) > 53;
      const ch = D.chests.find((c) => c.id === 'dniche'); a.chest = ch.ready && !ch.opened;
      return a; })()""")
    print(json.dumps(r))
    check(any('cracked wall' in o for o in r['offers']) and r['blocked'], f"Use at the cracked wall offers to break it: {r['offers']}")
    check(r['broken'] and not r['coll'] and r['rubble'], 'three blows bring it down to rubble')
    check(r['inTomb'] and r['chest'], 'beyond it a forgotten tomb and its chest')

async def lord(page):
    r = await ev(page, """(() => { const H = __hm, F = H.fn, D = H.deep.DEEP, P = H.GAME.player; L3.calm(); L3.safe();
      const id = H.deep.deepLordFresh(), K = F.getEnt(id); const a = { lvl: K.level, hp: Math.round(K.maxHp) };
      L3.to(48, 48.5); P.yaw = -Math.PI / 2; H.simulate(0.5); a.awake = K.ai.awake;
      // keep the player alive and standing: count what the lord does
      let cleave = 0, word = 0;
      for (let i = 0; i < 40; i++) { L3.safe(); P.x = P.prevX = K.x + 3.5; P.z = P.prevZ = K.z; H.simulate(0.5); if (K.casting && K.casting.id === 'cleave') cleave++; if (K.casting && K.casting.id === 'word') word++; }
      a.cleaves = D.stats.cleaves; a.wordsSeen = word;
      // a Word broken by a stun
      K.ai.nextWord = 0; K.casting = null; H.simulate(0.3); const casting = K.casting && K.casting.id;
      F.addBuff(K, 'stun', 1, 1.0, P.id); H.simulate(1.2); a.wordCast = casting; a.broken = D.stats.wordsBroken;
      // a Word spoken: the pitch about his foe catches
      K.ai.nextWord = 0; K.casting = null; L3.safe(); H.deep.deepPitchOut('ashhall');
      const C = D.cells.find((c) => c.hall === 'ashhall'); P.x = P.prevX = C.x; P.z = P.prevZ = C.z; K.x = K.prevX = C.x - 4; K.z = K.prevZ = C.z;
      H.simulate(0.2); const w0 = D.stats.words; for (let i = 0; i < 14 && D.stats.words === w0; i++) { L3.safe(); H.simulate(0.25); }
      a.spoken = D.stats.words > w0; a.litHall = D.cells.filter((c) => c.hall === 'ashhall' && c.st === 1).length;
      // two thirds: he calls his wardens and stamps the slabs down
      L3.safe(); H.deep.deepPitchOut('ashhall'); K.hp = K.maxHp * 0.6; P.x = P.prevX = F.dunWX(42); P.z = P.prevZ = F.dunWZ(42.5);
      for (let i = 0; i < 40 && D.stats.stamps === 0; i++) { L3.safe(); H.simulate(0.5); }
      H.simulate(2.5); a.stamps = D.stats.stamps; a.slabsDown = D.slabs.filter((s) => s.hall === 'ash' && s.st >= 2).length; a.calls = D.stats.calls;
      a.adds = [...D.adds].map((id) => F.getEnt(id)).filter((e) => e && e.alive).length;
      // a third: fury
      K.hp = K.maxHp * 0.3; L3.safe(); H.simulate(1.0); a.enraged = !!K.ai.enraged;
      // you leave his hall: he goes back to his throne whole, his slabs mended
      L3.to(60, 49); for (let i = 0; i < 12; i++) H.simulate(0.5);
      a.reset = !K.ai.awake && K.hp === K.maxHp && D.slabs.filter((s) => s.hall === 'ash' && s.st !== 0).length === 0;
      // and he falls: the hoard opens, the deed, the name
      L3.to(48, 48.5); H.simulate(0.3); const k0 = D.kills, n0 = H.late.LATE2.d.deep;
      K.ai.awake = true; F.dealDamage(P, K, K.maxHp * 2, {}); H.simulate(2.5);
      const ch = D.chests.find((c) => c.id === 'dhoard');
      a.dead = !K.alive; a.kills = D.kills - k0; a.deed = H.late.LATE2.d.deep - n0; a.name = H.late.LATE2.names.includes('ashbane'); a.hoard = ch.ready && !ch.opened;
      // the hoard: the top of the gear curve
      P.x = P.prevX = ch.x + 1.2; P.z = P.prevZ = ch.z; L3.calm(); const nL = H.LOOT.length; H.deep.late3OpenChest(ch); H.simulate(1.0);
      const got = H.LOOT.slice(nL).filter((l) => l.item); a.items = got.map((l) => [l.item.lvl, l.item.q]);
      return a; })()""")
    print(json.dumps(r))
    check(r['lvl'] >= 54, f"the Ash-Crowned at level {r['lvl']} for a player of 50 ({r['hp']} health)")
    check(r['awake'], 'he wakes as you come into his hall')
    check(r['cleaves'] >= 2, f"he cleaves ({r['cleaves']} in 20 s)")
    check(r['wordCast'] == 'word' and r['broken'] >= 1, f"the Ember Word is broken by a stun ({r['broken']})")
    check(r['spoken'] and r['litHall'] >= 1, f"spoken, it lights the pitch about his foe ({r['litHall']} cells)")
    check(r['stamps'] >= 1 and r['slabsDown'] >= 1, f"from two thirds he stamps and the slabs fall ({r['slabsDown']})")
    check(r['calls'] >= 1 and r['adds'] >= 1, f"he calls his ash-wardens up out of the pits ({r['adds']} standing)")
    check(r['enraged'], 'at a third he burns with fury')
    check(r['reset'], 'you leave his hall: he is back on his throne whole, his slabs mended')
    check(r['dead'] and r['kills'] == 1 and r['deed'] == 1 and r['name'], 'he falls: a deed, and the name Ashbane')
    check(r['hoard'] and len(r['items']) == 3 and all(l == 50 and q >= 4 for l, q in r['items']), f"his hoard: {r['items']} (item level, quality)")

async def save(page):
    r = await ev(page, """(() => { const H = __hm, D = H.deep.DEEP, PT = H.deep.DEEP_PART; const a = {};
      const s = H.fn.buildSave(); a.x = s.char && s.char.x ? (s.char.x.deep || null) : null;
      const keep = PT.save();
      // damaged parts: not a record, wrong types, out of range
      for (const bad of [undefined, null, 7, 'x', [], { o: 'yes', k: -5, w: {}, c: [] }, { o: 1, k: 1e12, c: { dcist: 'NaN', dpyre: -4, dniche: 1e9, nope: 5 } }]) PT.load(bad);
      a.sane = { opened: D.opened, kills: D.kills, taken: Object.keys(D.taken) };
      PT.load(undefined); a.old = { opened: D.opened, kills: D.kills, wall: D.wallBroken, seal: D.seal.coll.active };
      PT.load(keep); a.back = { opened: D.opened, kills: D.kills, seal: D.seal.coll.active };
      a.errors = H.errors.length; return a; })()""")
    print(json.dumps(r))
    check(r['x'] is not None and r['x'].get('o') == 1, f"the save carries the deep: {r['x']}")
    check(r['sane']['kills'] <= 1e6 and all(k in ('dcist', 'dpyre', 'dniche') for k in r['sane']['taken']), f"a damaged part is made sane: {r['sane']}")
    check(not r['old']['opened'] and r['old']['kills'] == 0 and r['old']['seal'], f"an old save (no part): the seal whole, no falls: {r['old']}")
    check(r['back']['opened'] and not r['back']['seal'], f"read back: the seal open again: {r['back']}")

async def fight(page):
    print('fight: each calling\'s skilled bot through the deep and against its lord', flush=True)
    for lv in LVS:
        for cls in CLS:
            await page.evaluate(f"L3.start('{cls}', {lv}); L3.kingDown(); __hm.deep.late3SealOpen(true); 0")
            # through the halls: a pack of each, the skilled bot played by the game's own bot
            r = await ev(page, f"""(() => {{ const H = __hm, F = H.fn, D = H.deep.DEEP, P = H.GAME.player;
              F.setIndoor(true); const out = {{ cls: '{cls}', lv: {lv}, halls: [] }};
              for (const [room, u, v, r] of [['cistern', 168.5, 38.5, 16], ['pyres', 123, 49, 15], ['crack', 82, 49, 12]]) {{
                L3.to(u, v); L3.safe(); H.INV.potions = 3;
                H.bal.botMake(P, 'skilled', {{ x: F.dunWX(u), z: F.dunWZ(v), r }});
                const foes = () => H.ENT.filter((e) => e.alive && e.deep && !e.deepLord && H.deep.late3Room(e.x, e.z) === H.deep.DUN_ROOM[room]);
                for (const e of foes()) {{ e.threat = new Map([[P.id, 1]]); }}
                let t = 0; for (; t < 150 && foes().length && P.alive; t += 1) {{ const f = foes()[0]; if (!F.getEnt(P.target) || !F.getEnt(P.target).alive) P.target = f.id; H.simulate(1); }}
                out.halls.push([room, t, foes().length, P.alive ? +(P.hp / P.maxHp).toFixed(2) : 0]);
                if (!P.alive) break;
              }}
              P.bot = null; return out; }})()""")
            print(json.dumps(r), flush=True)
            hall_ok = all(h[2] == 0 for h in r['halls']) and len(r['halls']) == 3
            check(hall_ok, f"a level {lv} {cls} clears the deep's halls ({', '.join(f'{h[0]} {h[1]} s, {h[3]*100:.0f}% left' for h in r['halls'])})")
            r = await ev(page, f"""(() => {{ const H = __hm, F = H.fn, D = H.deep.DEEP, P = H.GAME.player;
              L3.start('{cls}', {lv}); L3.kingDown(); H.deep.late3SealOpen(true); F.setIndoor(true);
              const id = H.deep.deepLordFresh(), K = F.getEnt(id);
              for (const e of H.ENT) if (e.alive && e.deep && !e.deepLord && H.deep.late3Room(e.x, e.z) === H.DUN_ROOM.ashhall) {{ e.damagers = null; F.killEnt(e, null); }}
              L3.to(46, 48.5); L3.safe(); H.INV.potions = 3;
              H.bal.botMake(P, 'skilled', {{ x: F.dunWX(40), z: F.dunWZ(48.5), r: 9 }}); P.target = K.id; H.simulate(0.5);
              const st0 = {{ ...D.stats }};
              const out = {{ lvl: K.level, hp: Math.round(K.maxHp), php: Math.round(P.maxHp) }};
              let t = 0, low = 1; for (; t < 300 && K.alive && P.alive; t += 1) {{ if (!F.getEnt(P.target) || !F.getEnt(P.target).alive) P.target = K.id; H.simulate(1); low = Math.min(low, P.hp / P.maxHp); }}
              out.t = t; out.dead = !K.alive; out.alive = P.alive; out.low = +low.toFixed(2); out.kLeft = +(Math.max(0, K.hp) / K.maxHp).toFixed(2); out.potions = H.INV.potions;
              out.words = D.stats.words - st0.words; out.broken = D.stats.wordsBroken - st0.wordsBroken; out.stamps = D.stats.stamps - st0.stamps; out.falls = D.stats.falls - st0.falls; out.burns = D.stats.burnHits - st0.burnHits;
              P.bot = null; return out; }})()""")
            print(json.dumps(r), flush=True)
            check(r['dead'] and r['alive'], f"a level {lv} {cls} (skilled bot) brings down the Ash-Crowned (level {r['lvl']}): {r['t']} s, lowest health {r['low']*100:.0f}%, Words spoken {r['words']} broken {r['broken']}, stamps {r['stamps']}, falls {r['falls']}, pitch burns {r['burns']}, draughts left {r['potions']}, lord at {r['kLeft']*100:.0f}%")

async def reload(page):
    pass

async def shots(page):
    pass

asyncio.run(main())
