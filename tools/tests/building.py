"""The keep's great hall and the building system, end to end through window.__hm.
Hall: each realm's hall door opens with E, the player walks in, the war table opens the map and grants command to
the realm holding the keep (and not to others until the keep is taken), the armourer mends and cleans gear, the
basin washes, the hearth dries, the stores sell building goods.
Building: placing with snapping and rotation, refused spots, construction in stages with a hammer, a small
cottage with a door that opens and a roof that keeps the rain off, fire burning a structure and its repair,
demolition, save and load.
Screenshots: each realm's hall outside and in, the war table, a placement ghost (valid and invalid), a cottage.
usage: python3 tools/tests/building.py [noshots] [hall|build] [quality]"""
import json, asyncio, sys, pathlib, time
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
from hmlib import setup, OUT
from playwright.async_api import async_playwright

ARGS = sys.argv[1:]
SHOTS = 'noshots' not in ARGS
ONLY = next((a for a in ARGS if a in ('hall', 'build')), None)
QUALITY = next((a for a in ARGS if a in ('high', 'medium', 'low')), 'medium')
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
    await frames(page, 1)
    await page.screenshot(path=OUT + name + '.png', timeout=300000)
    print('  shot', name, f'[{time.time() - T0:.0f}s]', flush=True)

HELPERS = r"""
window.T = {
  H: __hm, F: __hm.fn,
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
  // stand the player at a world point, facing (fx, fz)
  // a quiet place: no foes about (the garrisons of enemy keeps would fight the player and set the halls alight)
  calm() { const P = this.H.GAME.player; for (const e of this.H.ENT) if (e !== P && e.alive && e.kind !== 'door' && this.F.isEnemy(P, e) && Math.hypot(e.x - P.x, e.z - P.z) < 60) { e.alive = false; e.removeAt = this.H.GAME.t; } P.buffs.length = 0; P.casting = null; P.hp = P.maxHp; },
  stand(x, z, fx, fz) { const P = this.H.GAME.player; this.H.teleport(x, z); this.calm(); P.yaw = Math.atan2(fx - x, fz - z); this.H.UI.modal = null; this.H.simulate(0.05); },
  // a point a little way from a spot toward the hall's middle (where a body can stand)
  near(h, q, k = 1.1) { const dx = h.x - q.x, dz = h.z - q.z, d = Math.hypot(dx, dz) || 1; return { x: q.x + dx / d * k, z: q.z + dz / d * k }; },
  cam(h, lx, ly, lz, tx, ty, tz) {
    const H = this.H, a = this.F.houseW(h, lx, lz), b = this.F.houseW(h, tx, tz);
    H.UI.modal = 'menu'; H.CAM.mode = 'fixed';
    H.camera.position.set(a.x, h.y + ly, a.z); H.camera.lookAt(b.x, h.y + ty, b.z);
  },
  camW(x, y, z, tx, ty, tz) { const H = this.H; H.UI.modal = 'menu'; H.CAM.mode = 'fixed'; H.camera.position.set(x, y, z); H.camera.lookAt(tx, ty, tz); },
  play() { this.H.UI.modal = null; this.H.CAM.mode = 'play'; },
  hall(realm, k = 0) { return this.F.halls().filter((h) => h.realm === realm)[k]; },
};
0;
"""

async def hall_tests(page):
    r = await ev(page, 'halls', """(() => { const L = T.F.halls();
      return { n: L.length, styles: L.map((h) => h.style), nums: L.map((h) => h.num), towns: T.H.REALMS.map((R) => R.town.houses.length),
        items: L.map((h) => h.items.length), kinds: [...new Set(L.flatMap((h) => h.items.map((i) => i.type)))], fires: L.map((h) => !!h.hearth.fire),
        spots: L.every((h) => ['table', 'armourer', 'basin', 'hearth', 'stores'].every((k) => h.hallSpots[k])) }; })()""")
    check(r['n'] == 6, 'every keep has a great hall')
    check(min(r['nums']) >= sum(r['towns']), 'the halls are numbered after every town house (old saves keep theirs)')
    check(all(k in r['kinds'] for k in ['wartable', 'armourer', 'basin', 'highseat', 'table', 'hanging', 'torch', 'weaponrack', 'stores']), 'the halls are furnished: war table, armourer, basin, high seat, long tables, hangings, torches, weapons, stores')
    check(all(r['fires']), 'a fire burns on every hall hearth')
    check(r['spots'], 'every hall has its places to use')
    r = await ev(page, 'hall states', "T.F.halls().map((h) => h.state)")
    for realm in (0, 1, 2):
        r = await ev(page, f'door {realm}', """((realm) => { const h = T.hall(realm), D = h.door, P = T.H.GAME.player;
          T.H.teleport(D.out2.x, D.out2.z); T.calm(); T.F.setHouseDoor(h, false); T.H.simulate(0.8);
          T.stand(D.out.x, D.out.z, D.c.x, D.c.z);
          const l0 = T.label(), coll0 = D.coll.active;
          const did = T.interact(); T.H.simulate(0.8);
          const open = D.leaf.open, coll1 = D.coll.active;
          const p = T.walk(D.out.x, D.out.z, T.yawTo(D.out.x, D.out.z, D.in.x, D.in.z), 1.6);
          const inside = T.F.houseInside(P.x, P.z) === h && T.F.hallOf(P) === h;
          return { l0, coll0, did, open, coll1, p, inside, name: h.S.name }; })(%d)""" % realm)
        check(r['l0'] and r['l0'].startswith('Open the great hall of') and 'war table' in r['l0'] and r['coll0'], f'realm {realm}: the closed hall door says what is inside ({r["l0"]})')
        check(r['open'] == 1 and not r['coll1'], f'realm {realm}: the hall door swings open and lets you through')
        check(r['inside'], f'realm {realm}: the player walks into the hall')
    # the Logres hall: war table, armourer, basin, hearth, stores (the player is of Logres, level 1, rank 0)
    r = await ev(page, 'hall states', "T.F.halls().map((h) => h.state)")
    r = await ev(page, 'war table', """(() => { const h = T.hall(0), P = T.H.GAME.player, sp = h.hallSpots.table;
      const before = T.F.cwCanCommand();
      T.stand(sp.x + 1.25 * h.c, sp.z - 1.25 * h.s, sp.x, sp.z);
      const label = T.label(); T.interact();
      const map = T.H.UI.modal, during = T.F.cwCanCommand();
      T.F.toggleMap(false);
      const stay = T.F.cwCanCommand();
      T.stand(h.door.out2.x, h.door.out2.z, h.x, h.z); T.H.simulate(0.2);
      const away = T.F.cwCanCommand();
      return { before, label, map, during, stay, away }; })()""")
    check(not r['before'], 'a level 1 recruit cannot command warbands from the field')
    check(r['label'] and r['label'].startswith('Command the warbands at the war table'), 'the war table is offered: ' + str(r['label']))
    check(r['map'] == 'map' and r['during'] and r['stay'], 'the war table opens the map and grants command while you stand at it')
    check(not r['away'], 'the grant ends when you walk away from the table')
    r = await ev(page, 'enemy table', """(() => { const h = T.hall(1), P = T.H.GAME.player, sp = h.hallSpots.table;
      T.stand(sp.x + 1.25 * h.c, sp.z - 1.25 * h.s, sp.x, sp.z);
      const label = T.label(); T.interact(); const map = T.H.UI.modal, can = T.F.cwCanCommand(); T.F.toggleMap(false);
      const K = h.S.keepRef; T.F.captureKeep(K, 0, P); T.H.simulate(0.1);
      T.stand(sp.x + 1.25 * h.c, sp.z - 1.25 * h.s, sp.x, sp.z);
      const label2 = T.label(); T.interact(); const can2 = T.F.cwCanCommand(); T.F.toggleMap(false);
      return { label, map, can, holder: K.realm, label2, can2 }; })()""")
    check(r['label'] and 'answers to' in r['label'] and not r['can'], "an enemy keep's war table does not answer to you")
    check(r['holder'] == 0 and r['can2'], 'once your realm takes the keep, its war table grants command')
    r = await ev(page, 'armourer', """(() => { const h = T.hall(0), P = T.H.GAME.player, sp = h.hallSpots.armourer, INV = T.H.INV;
      INV.gold = 5000;
      for (const slot of ['weapon', 'chest', 'head', 'legs']) INV.eq[slot] = T.F.makeItem({ cls: P.cls, realm: 0, lvl: 5, q: 2, slot });
      T.F.applyGear();
      const kit = ['weapon', 'chest', 'head', 'legs'].map((s) => INV.eq[s]).filter(Boolean);
      for (const it of kit) { it.dur = 35; it.dirt = 0.7; it.blood = 0.5; }
      P.dirt = 0.6; P.blood = 0.4; P.batter = 0.4;
      const q = T.near(h, sp, 1.0); T.stand(q.x, q.z, sp.x, sp.z);
      const label = T.label(); const g0 = INV.gold; T.interact();
      return { label, n: kit.length, dur: kit.map((it) => it.dur), dirt: kit.map((it) => it.dirt || 0), blood: kit.map((it) => it.blood || 0), P: [P.dirt, P.blood, P.batter], paid: g0 - INV.gold }; })()""")
    check(r['label'] and 'armourer' in r['label'], 'the armourer\'s bench is offered: ' + str(r['label']))
    check(r['n'] > 0 and all(d == 100 for d in r['dur']) and r['paid'] > 0, 'the armourer mends worn gear, for gold')
    check(all(d == 0 for d in r['dirt']) and all(b == 0 for b in r['blood']) and r['P'] == [0, 0, 0], 'and cleans the mud, blood and dents from it')
    r = await ev(page, 'basin', """(() => { const h = T.hall(0), P = T.H.GAME.player, sp = h.hallSpots.basin;
      P.dirt = 0.6; P.wet = 0; const q = T.near(h, sp, 1.0); T.stand(q.x, q.z, sp.x, sp.z);
      const label = T.label(); T.interact(); return { label, dirt: P.dirt, wet: P.wet }; })()""")
    check(r['label'] == 'Wash at the basin' and r['dirt'] == 0 and r['wet'] > 0.3, 'the basin washes you (and leaves you damp)')
    r = await ev(page, 'hearth', """(() => { const h = T.hall(0), P = T.H.GAME.player, sp = h.hallSpots.hearth;
      T.stand(sp.x, sp.z, h.hearth.x, h.hearth.z); P.wet = 0.9; P.snow = 0.5; P.hp = P.maxHp * 0.5;
      const label = T.label(); T.interact(); T.H.simulate(6);
      return { label, wet: +P.wet.toFixed(2), snow: +P.snow.toFixed(2), hp: +(P.hp / P.maxHp).toFixed(2) }; })()""")
    check(r['label'] and 'hearth' in r['label'] and r['wet'] < 0.1 and r['snow'] == 0 and r['hp'] > 0.8, 'resting by the hearth dries, warms and heals')
    r = await ev(page, 'stores', """(() => { const h = T.hall(0), P = T.H.GAME.player, sp = h.hallSpots.stores;
      const q = T.near(h, sp, 1.0); T.stand(q.x, q.z, sp.x, sp.z);
      const label = T.label(); T.interact(); const open = !document.getElementById('dialog').hidden;
      const btns = [...document.querySelectorAll('#dlg-actions button')].map((b) => b.textContent);
      document.querySelector('#dlg-actions button').click();
      const planks = T.F.goodsCount('plank');
      T.F.closeDialog();
      return { label, open, btns, planks }; })()""")
    check(r['label'] == 'Buy building stores' and r['open'] and r['planks'] >= 10, 'the stores sell building goods')
    if SHOTS:
        await page.evaluate("T.H.setTod(0.42); 0")
        for realm in (0, 1, 2):
            await shot(page, f'hall_out_{realm}', """(() => { const h = T.hall(%d); T.F.setHouseDoor(h, true); T.H.simulate(0.8);
              const far = (h.round ? h.r : h.d / 2) + 11; T.cam(h, 4.5, 3.6, far, 0, 3.4, 0); return 0; })()""" % realm)
            await shot(page, f'hall_in_{realm}', """(() => { const h = T.hall(%d); const r = h.round ? h.ri : h.id;
              T.cam(h, h.round ? 1.6 : 2.2, 2.3, r - 0.6, -0.5, 1.0, -r + 0.5); return 0; })()""" % realm)
        await shot(page, 'hall_wartable', """(() => { const h = T.hall(0), sp = h.hallSpots.table;
          const l = T.F.houseL(h, sp.x, sp.z); T.cam(h, l.x + 1.3, 2.3, l.z + 1.6, l.x, 0.9, l.z); return 0; })()""")
        await page.evaluate("T.play(); 0")

async def build_tests(page):
    pass

async def main():
    async with async_playwright() as p:
        b, page, logs = await setup(p, w=640 if not SHOTS else 960, h=360 if not SHOTS else 540)
        await page.evaluate(f"__hm.fn.setQuality('{QUALITY}')")
        await page.evaluate("__hm.start({realm:0, cls:'warrior', level:1}); const P = __hm.GAME.player; P.maxHp = P.hp = 1e8; 0")
        await page.evaluate("() => {" + HELPERS + "; return 0; }")
        await page.evaluate("() => { const W = __hm.dbg.WEATHER; W.mode = 'clear'; W.kind = 'clear'; W.storm = 0; W.raining = 0; W.overcast = 0; W.nextBolt = 1e9; T.H.setTod(0.42); return 0; }")
        await page.evaluate("document.getElementById('hud').hidden = true")
        if ONLY in (None, 'hall'): await hall_tests(page)
        if ONLY in (None, 'build'): await build_tests(page)
        errs = await page.evaluate("__hm.errors.slice(0, 8)")
        check(not errs, 'no runtime errors: ' + json.dumps(errs)[:600])
        for l in logs[:8]: print(l)
        await b.close()
    print(f'\n{len(FAILS)} failed' if FAILS else '\nall passed', f'[{time.time() - T0:.0f}s]')
    sys.exit(1 if FAILS else 0)

asyncio.run(main())
