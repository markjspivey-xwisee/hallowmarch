"""Working houses, end to end through window.__hm:
doors open and close with E (and their colliders follow), shutters too; the player walks in through the doorway
and is shut in by a closed door; the camera stays in the room; fire spells set roofs alight; a house burns,
falls in, smoulders, goes up on a scaffold and stands whole again; townsfolk go home at night by the door and
close their shutters, and run from a fire. Screenshots: outside by day, a window at night, by the hearth,
a burning roof, the ruin.
usage: python3 tools/tests/houses.py [noshots] [quality]   (quality: high, medium or low; default medium)"""
import json, asyncio, sys, pathlib, time
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
from hmlib import setup, OUT
from playwright.async_api import async_playwright

ARGS = sys.argv[1:]
SHOTS = 'noshots' not in ARGS
QUALITY = next((a for a in ARGS if a in ('high', 'medium', 'low')), 'medium')
FAILS = []
T0 = time.time()

def check(cond, what):
    print(('  ok   ' if cond else '  FAIL ') + what, flush=True)
    if not cond: FAILS.append(what)

async def ev(page, label, js):
    r = await page.evaluate(js)
    print(f'{label} [{time.time() - T0:.0f}s]', json.dumps(r)[:1400], flush=True)
    return r

async def frames(page, n=1):
    for _ in range(n): await page.evaluate("new Promise(r=>requestAnimationFrame(()=>r()))")

async def shot(page, name, js):
    if not SHOTS: return
    await page.evaluate(js)
    await frames(page, 1)
    await page.screenshot(path=OUT + name + '.png', timeout=300000)
    print('  shot', name, f'[{time.time() - T0:.0f}s]', flush=True)

HELPERS = r"""
window.T = {
  H: __hm, F: __hm.fn,
  house(i) { return __hm.HOUSES[i]; },
  // put the player at a world point, facing a direction, and walk forward for sec seconds with W held
  walk(x0, z0, yaw, sec) {
    const H = this.H, P = H.GAME.player;
    if (x0 !== null) H.teleport(x0, z0);
    P.yaw = yaw; H.CAM.yaw = yaw; H.UI.modal = null;
    H.INPUT.keys.add('KeyW'); H.simulate(sec); H.INPUT.keys.delete('KeyW');
    return { x: +P.x.toFixed(2), z: +P.z.toFixed(2) };
  },
  yawTo(ax, az, bx, bz) { return Math.atan2(bx - ax, bz - az); },
  interact() { const it = this.F.currentInteraction(); if (it) it.act(); return it ? it.label : null; },
  label() { const it = this.F.currentInteraction(); return it ? it.label : null; },
  // a fixed camera at house-local (lx, ly, lz) looking at house-local (tx, ty, tz)
  cam(h, lx, ly, lz, tx, ty, tz) {
    const H = this.H, a = this.F.houseW(h, lx, lz), b = this.F.houseW(h, tx, tz);
    H.UI.modal = 'menu'; H.CAM.mode = 'fixed';
    H.camera.position.set(a.x, h.y + ly, a.z); H.camera.lookAt(b.x, h.y + ty, b.z);
  },
  play() { this.H.UI.modal = null; this.H.CAM.mode = 'play'; },
};
0; // return nothing: serialising window.T (and with it all of __hm) can stall Playwright for minutes
"""

async def main():
    async with async_playwright() as p:
        b, page, logs = await setup(p, w=640, h=360)
        await page.evaluate(f"__hm.fn.setQuality('{QUALITY}')")
        await page.evaluate("__hm.start({realm:0, cls:'mage', level:20})")
        await page.evaluate("() => {" + HELPERS + "; return 0; }")  # a function, so Playwright does not serialise __hm back
        # clear skies for the whole test: storms keep townsfolk at home and lightning sets roofs alight
        await page.evaluate("() => { const W = __hm.dbg.WEATHER; W.mode = 'clear'; W.kind = 'clear'; W.storm = 0; W.raining = 0; W.overcast = 0; W.nextBolt = 1e9; return 0; }")
        await page.evaluate("document.getElementById('hud').hidden = true")

        # ---- every town has its houses, each with a hinged door and shuttered windows ----
        r = await ev(page, 'houses', """(() => { const L = __hm.HOUSES.filter((h) => !h.keepHall); // [building] the keeps' great halls are houses too (building.py tests them)
          return { n: L.length, towns: __hm.REALMS.map((R) => R.town.houses.length), styles: [...new Set(L.map((h) => h.style))],
            doors: L.every((h) => h.door && h.door.leaf && h.door.coll), shut: L.every((h) => h.wins.length >= 2 && h.wins.every((w) => w.leaves.length === 2)),
            hearths: L.filter((h) => h.hearth.fire).length, items: L.map((h) => h.items.length) }; })()""")
        check(r['n'] == sum(r['towns']) and r['n'] >= 12, 'a record for every town house')
        check(len(r['styles']) == 3, 'houses in all three styles')
        check(r['doors'] and r['shut'], 'every house has a hinged door and shuttered windows')
        check(r['hearths'] == r['n'], 'a fire burns on every hearth')
        check(min(r['items']) >= 8, 'every house is furnished')

        # ---- the door: offered by E, swings in half a second, the collider follows ----
        r = await ev(page, 'door', """(() => { const h = T.house(0), D = h.door, P = T.H.GAME.player;
          T.H.setTod(0.45); T.F.setHouseDoor(h, false); T.H.simulate(0.7);
          T.H.teleport(D.out.x, D.out.z); T.H.simulate(0.05);
          const before = { label: T.label(), coll: D.coll.active, open: D.leaf.open };
          const did = T.interact(); T.H.simulate(0.25);
          const mid = +D.leaf.open.toFixed(2);
          T.H.simulate(0.35);
          return { before, did, mid, open: D.leaf.open, coll: D.coll.active, leaf: D.collLeaf.active, label: T.label(),
            events: T.H.HOUSE_EVENTS.slice(-2) }; })()""")
        check(r['before']['label'] == 'Open the door' and r['before']['coll'], 'a closed door is offered to open, and blocks')
        check(0.2 < r['mid'] < 0.9 and r['open'] == 1, 'the door swings open over half a second')
        check(not r['coll'] and r['leaf'], 'the open door lets you through (its leaf stands into the room)')
        check(r['label'] == 'Close the door', 'an open door is offered to close')

        # ---- in through the doorway ----
        r = await ev(page, 'walk in', """(() => { const h = T.house(0), D = h.door;
          const yaw = T.yawTo(D.out.x, D.out.z, D.in.x, D.in.z);
          const p = T.walk(D.out.x, D.out.z, yaw, 1.6);
          const P = T.H.GAME.player;
          return { p, inside: T.F.houseInside(P.x, P.z) === h, walkable: T.F.isWalkable(P.x, P.z), at: T.F.houseAt(P.x, P.z) === h }; })()""")
        check(r['inside'] and r['at'], 'the player walks in through the open door')
        check(r['walkable'], 'the floor inside is walkable')

        # ---- the camera stays in the room ----
        r = await ev(page, 'camera', """(() => { const h = T.house(0), P = T.H.GAME.player; T.play();
          const out = [];
          for (const [yaw, pitch, dist] of [[P.yaw + Math.PI, 0.36, 8.5], [P.yaw, 0.6, 8.5], [P.yaw + 1.6, 1.1, 12], [P.yaw - 1.2, -0.2, 6]]) {
            T.H.look(yaw, pitch, dist); for (let i = 0; i < 4; i++) T.H.frame(1 / 30);
            const c = T.H.camera.position, l = T.F.houseL(h, c.x, c.z);
            out.push({ inside: T.F.houseInside(c.x, c.z) === h, below: c.y - h.y < h.ceilLocal(l.x, l.z) + 0.01, d: +Math.hypot(c.x - P.x, c.z - P.z).toFixed(2) });
          }
          T.H.look(P.yaw + Math.PI, 0.36, 8.5);
          return out; })()""")
        check(all(c['inside'] and c['below'] for c in r), 'with the player inside, the camera stays inside, under the roof')

        # ---- shut in: close the door from inside, then try to walk out ----
        r = await ev(page, 'shut in', """(() => { const h = T.house(0), D = h.door, P = T.H.GAME.player;
          T.H.teleport(D.in.x, D.in.z); T.H.simulate(0.05);
          const label = T.label(); const did = T.interact(); T.H.simulate(0.7);
          const yaw = T.yawTo(D.in.x, D.in.z, D.out.x, D.out.z);
          const p = T.walk(null, null, yaw, 1.5);
          return { label, did, open: D.leaf.open, coll: D.coll.active, inside: T.F.houseInside(P.x, P.z) === h, p }; })()""")
        check(r['did'] == 'Close the door' and r['open'] == 0 and r['coll'], 'the door closes from inside and blocks')
        check(r['inside'], 'a closed door keeps the player in')
        r = await ev(page, 'out again', """(() => { const h = T.house(0), D = h.door, P = T.H.GAME.player;
          const did = T.interact(); T.H.simulate(0.6);
          const p = T.walk(null, null, T.yawTo(P.x, P.z, D.out.x, D.out.z), 1.8);
          return { did, out: !T.F.houseAt(P.x, P.z), p }; })()""")
        check(r['did'] == 'Open the door' and r['out'], 'open again, and out through the door')

        # ---- shutters: E at a window ----
        r = await ev(page, 'shutters', """(() => { const h = T.house(0), w = h.wins[0];
          T.H.teleport(w.out.x, w.out.z); T.H.simulate(0.05);
          const l0 = T.label(), t0 = w.target; T.interact(); T.H.simulate(0.6);
          const l1 = T.label(), t1 = w.target, o1 = w.leaves.map((L) => L.open); T.interact(); T.H.simulate(0.6);
          return { l0, t0, l1, t1, o1, o2: w.leaves.map((L) => L.open), events: T.H.HOUSE_EVENTS.slice(-2) }; })()""")
        check(r['l0'] in ('Open the shutters', 'Close the shutters') and r['t1'] != r['t0'], 'the shutters are offered and turn')
        check(all(o == r['t1'] for o in r['o1']) and all(o == r['t0'] for o in r['o2']), 'both leaves swing all the way, and back')

        # ---- screenshots of a whole house ----
        await page.evaluate("(() => { const h = T.house(1); T.H.setTod(0.42); T.F.setHouseDoor(h, true); for (const w of h.wins) T.F.setHouseShutters(h, w, true); T.H.UI.modal = null; T.H.simulate(0.8); })()")
        await shot(page, 'houses_day', "(() => { const h = T.house(1); T.cam(h, 3.4, 2.1, h.d / 2 + 7.5, 0, 1.9, 0); })()")
        await shot(page, 'houses_hearth', "(() => { const h = T.house(1); T.cam(h, h.iw - 0.4, 1.65, h.id - 0.5, -0.2, 0.8, -h.id + 0.4); })()")
        await page.evaluate("(() => { T.H.setTod(2.1); T.H.UI.modal = null; T.H.simulate(0.1); })()")
        await shot(page, 'houses_window_night', """(() => { const h = T.house(1); const w = h.wins.find((w) => w.face === 1) || h.wins[0], F = w.F;
          T.cam(h, F.ox + F.nx * 2.2 + F.ux * 0.5, w.y + 0.15, F.oz + F.nz * 2.2 + F.uz * 0.5, F.ox - F.nx * 3, w.y - 0.7, F.oz - F.nz * 3); })()""")
        await page.evaluate("(() => { T.H.setTod(0.42); T.play(); })()")

        # ---- a firebolt aimed at a house with no foe about ----
        r = await ev(page, 'firebolt', """(() => { const h = T.house(2), P = T.H.GAME.player; T.play();
          const D = h.door; T.H.teleport(D.out2.x + (D.out2.x - h.x) * 1.5, D.out2.z + (D.out2.z - h.z) * 1.5);
          P.target = null; const yaw = T.yawTo(P.x, P.z, h.x, h.z); P.yaw = yaw; T.H.CAM.yaw = yaw; P.power = P.maxPower; P.cds = {}; P.gcdUntil = 0;
          const aim = T.F.houseFireAim(P, 'firebolt');
          T.F.playerUseSlot(0);
          const casting = !!(P.casting && P.casting.aim);
          T.H.simulate(3.0);
          return { aim: !!aim, casting, state: h.state, dist: +Math.hypot(P.x - h.x, P.z - h.z).toFixed(1) }; })()""")
        check(r['aim'] and r['casting'], 'with no foe in front, a firebolt is aimed at the house')
        check(r['state'] == 'burning', 'the firebolt sets the roof alight')

        # ---- flame nova beside another house ----
        r = await ev(page, 'nova', """(() => { const h = T.house(3), P = T.H.GAME.player;
          const w = T.F.houseW(h, h.w / 2 + 1.4, 0); T.H.teleport(w.x, w.z);
          P.power = P.maxPower; P.cds = {}; P.gcdUntil = 0;
          const why = T.F.useAbility(P, 'nova', null); T.H.simulate(0.2);
          return { why, state: h.state }; })()""")
        check(r['why'] is True and r['state'] == 'burning', 'a flame nova beside a house sets it alight')

        # ---- the burn: spreading fires, char, collapse, a smoking ruin, scaffold, whole again ----
        r = await ev(page, 'burning', """(() => { const h = T.house(2), P = T.H.GAME.player;
          T.H.teleport(h.door.out2.x + 14, h.door.out2.z + 14);
          const fires0 = h.burn.pts.filter((q) => q.fire).length;
          T.H.simulate(12);
          const fires = h.burn.pts.filter((q) => q.fire), sizes = fires.map((q) => +q.fire.size.toFixed(2));
          const inFIRES = fires.filter((q) => T.H.dbg.FIRES.includes(q.fire)).length;
          return { state: h.state, char: +h.char.toFixed(2), R: +h.burn.R.toFixed(1), maxR: +h.burn.maxR.toFixed(1), fires0, fires: fires.length, inFIRES, smax: Math.max(...sizes), smin: Math.min(...sizes) }; })()""")
        check(r['state'] == 'burning' and r['fires'] > r['fires0'] and r['fires'] >= 4, 'the fire spreads across the roof, more flames as it goes')
        check(r['inFIRES'] == r['fires'] and r['smax'] > r['smin'], 'the roof fires are real fires, and grow')
        check(0.1 < r['char'] < 0.9, 'the walls char as it burns')
        if SHOTS:
            await shot(page, 'houses_burning', """(() => { const h = T.house(2); for (let i = 0; i < 20; i++) T.H.frame(1 / 30);
              T.cam(h, -6.5, 3.6, h.d / 2 + 8.5, 0, 3.0, 0); })()""")
            await page.evaluate("T.play()")
        r = await ev(page, 'collapse', """(() => { const h = T.house(2); let t = 12;
          const seen = {}; while (h.state === 'burning' && t < 60) { T.H.simulate(1); t++; if (h.fall > 0 && !seen.fall) seen.fall = t; }
          T.H.simulate(0.1); // [keeps] a step after the roof falls: the doorway's state follows on the next step (it read 'shut' when it fell on the last one)
          return { state: h.state, t, fallAt: seen.fall, smoulder: h.burn.smoulder.filter((s) => s.f).length, hearth: !!h.hearth.fire, door: h.door.coll.active, ember: h.ember }; })()""")
        check(r['state'] == 'ruin' and 20 <= r['t'] <= 45, 'the roof falls in after the fire has crossed it (20 to 40 s)')
        check(r['smoulder'] >= 3 and not r['hearth'], 'the ruin smoulders; the hearth is out')
        check(not r['door'], 'the burnt doorway stands open')
        if SHOTS:
            await shot(page, 'houses_ruin', """(() => { const h = T.house(2); T.H.UI.modal = null; T.H.simulate(3); for (let i = 0; i < 24; i++) T.H.frame(1 / 30);
              T.cam(h, -5.5, 5.0, h.d / 2 + 7, 0, 0.8, 0); })()""")
            await page.evaluate("T.play()")
        r = await ev(page, 'rebuild', """(() => { const h = T.house(2); const out = {};
          T.H.simulate(60); out.ruin60 = [h.state, +h.ember.toFixed(2)];
          let t = 60; while (h.state === 'ruin' && t < 200) { T.H.simulate(5); t += 5; }
          out.scaffoldAt = t; out.scaffold = h.state; out.poles = h.scafColl.every((c) => c.active);
          T.H.simulate(30); out.char30 = +h.char.toFixed(2);
          while (h.state === 'scaffold' && t < 400) { T.H.simulate(5); t += 5; }
          out.wholeAt = t; out.state = h.state; out.char = h.char; out.hearth = !!h.hearth.fire; out.door = h.door.coll.active; out.poles2 = h.scafColl.some((c) => c.active);
          return out; })()""")
        check(r['scaffold'] == 'scaffold' and r['poles'], 'after a while the ruin is cleared and a scaffold goes up')
        check(r['state'] == 'whole' and r['char'] == 0 and r['hearth'] and r['door'] and not r['poles2'], 'then the house stands whole again, its hearth lit, its door shut')
        check(r['wholeAt'] <= 330, 'rebuilt within a few minutes')

        # ---- townsfolk: home at night by the door, shutters closed; out by day ----
        r = await ev(page, 'night', """(() => { const P = T.H.GAME.player, S = T.H.REALMS[0].town;
          T.H.teleport(S.x + 3, S.z + 3); T.H.setTod(2.1); T.H.UI.modal = null;
          const n0 = T.H.HOUSE_EVENTS.length;
          T.H.simulate(90);
          const vill = T.H.ENT.filter((e) => e.role === 'villager' && Math.hypot(e.x - S.x, e.z - S.z) < 60);
          const home = vill.filter((e) => e.ai.house && T.F.houseHas(e.ai.house, e.x, e.z, -0.2));
          const ev = T.H.HOUSE_EVENTS.slice(-60).filter((x) => x.by.startsWith('villager'));
          const houses = S.houses.map((x) => x.rec);
          return { vill: vill.length, home: home.length, doorsBy: ev.filter((x) => x.what.startsWith('door')).length, shutBy: ev.filter((x) => x.what === 'shutters close').length,
            closed: houses.every((h) => h.state !== 'whole' || h.wins.every((w) => w.target === 0)), doorsShut: houses.filter((h) => h.door.leaf.target === 0).length, n: houses.length,
            seated: vill.filter((e) => e.seat).length,
            away: vill.filter((e) => !(e.ai.house && T.F.houseHas(e.ai.house, e.x, e.z, -0.2))).map((e) => ({ id: e.id, hand: !!e.ai.fieldHand, house: e.ai.house ? e.ai.house.state : null, door: e.ai.house ? +Math.hypot(e.x - e.ai.house.door.out2.x, e.z - e.ai.house.door.out2.z).toFixed(1) : null, step: e.ai.plan && e.ai.plan.steps ? (e.ai.plan.steps[e.ai.plan.i] || {}).k : null, amt: +e.anim.amt.toFixed(2) })) }; })()""")
        check(r['home'] >= max(1, r['vill'] - 2), 'at night the townsfolk are at home')
        check(r['doorsBy'] >= 2, 'they open and close their doors as they go in')
        check(r['shutBy'] >= 1 and r['closed'], 'they close the shutters for the night')
        r = await ev(page, 'morning', """(() => { const S = T.H.REALMS[0].town; T.H.setTod(0.3); T.H.simulate(80);
          const houses = S.houses.map((x) => x.rec);
          const vill = T.H.ENT.filter((e) => e.role === 'villager' && Math.hypot(e.x - S.x, e.z - S.z) < 60);
          const ev = T.H.HOUSE_EVENTS.slice(-60).filter((x) => x.by.startsWith('villager'));
          return { opened: houses.filter((h) => h.wins.every((w) => w.target === 1)).length, n: houses.length,
            out: vill.filter((e) => !T.F.houseInside(e.x, e.z)).length, vill: vill.length, openBy: ev.filter((x) => x.what === 'shutters open').length }; })()""")
        check(r['openBy'] >= 1 and r['opened'] >= r['n'] - 1, 'in the morning they open the shutters')
        check(r['out'] >= r['vill'] - 2, 'and go out into the town')

        # ---- they run from a fire ----
        r = await ev(page, 'flee', """(() => { const S = T.H.REALMS[0].town, h = S.houses[0].rec;
          const vill = T.H.ENT.filter((e) => e.role === 'villager' && Math.hypot(e.x - S.x, e.z - S.z) < 60);
          vill.forEach((e, i) => { const a = i * 1.3; e.x = h.door.out2.x + Math.cos(a) * 3; e.z = h.door.out2.z + Math.sin(a) * 3; e.prevX = e.x; e.prevZ = e.z; e.ai.plan = null; });
          T.F.igniteHouse(h); T.H.simulate(10);
          const d = vill.map((e) => +Math.hypot(e.x - h.x, e.z - h.z).toFixed(1));
          T.F.houseRestore(h);
          return { d, far: d.filter((x) => x > 15).length, n: d.length }; })()""")
        check(r['far'] >= r['n'] - 1, 'townsfolk run from a burning house')

        # ---- rain does not fall indoors ----
        r = await ev(page, 'roof', """(() => { const h = T.house(1); return { over: T.F.houseRoofOver(h.x, h.z), out: T.F.houseRoofOver(h.door.out2.x + 0, h.door.out2.z + 0) }; })()""")
        check(r['over'] and not r['out'], 'roofs keep the rain off (splashes and drops stop at the roof)')

        errs = await page.evaluate("__hm.errors")
        print('errors', errs[:3])
        check(not errs, 'no runtime errors')
        print('logs', logs[:4])
        print('FAILED:' if FAILS else 'ALL PASSED', FAILS, f'[{time.time() - T0:.0f}s]', flush=True)
        await b.close()
asyncio.run(main())
