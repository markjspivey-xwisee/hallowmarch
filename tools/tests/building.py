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
    # one frame rendered and read straight off the canvas (the page screenshot waits on the compositor, which on a
    # busy machine under SwiftShader can take longer than any timeout)
    if not SHOTS: return
    import base64
    await page.evaluate(js)
    url = await page.evaluate("(() => { __hm.frame(1 / 60); __hm.frame(1 / 60); return __hm.dbg.renderer.domElement.toDataURL('image/png'); })()")
    pathlib.Path(OUT + name + '.png').write_bytes(base64.b64decode(url.split(',', 1)[1]))
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
    r = await ev(page, 'high seat', """(() => { const h = T.hall(0), P = T.H.GAME.player, sp = h.hallSpots.seat;
      const q = T.near(h, sp, 1.0); T.stand(q.x, q.z, sp.x, sp.z);
      const label = T.label(); T.interact(); T.H.simulate(1);
      const sat = !!P.seat && Math.hypot(P.x - sp.x, P.z - sp.z) < 0.05;
      T.H.INPUT.keys.add('KeyW'); T.H.simulate(0.3); T.H.INPUT.keys.delete('KeyW');
      return { label, sat, up: !P.seat }; })()""")
    check(r['label'] and 'high seat' in r['label'] and r['sat'] and r['up'], 'the lord\'s high seat can be sat in, and a step gets you up')
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
    B = "const B = T.H.build, BU = B.BUILD, P = T.H.GAME.player;"
    # goods and a hammer; a quiet, flat, open spot in Logres's homeland
    r = await ev(page, 'site', """(() => { %s
      for (const [id, n] of [['plank', 400], ['stone', 300], ['thatch', 120], ['nails', 400], ['glass', 20], ['iron', 30], ['tool_hammer', 1], ['log', 4]]) T.F.goodsAdd(id, n, true);
      const R = T.H.REALMS[0]; let best = null;
      for (let along = 290; along <= 440 && !best; along += 9) for (const lat of [40, -40, 55, -55, 70, -70, 30, -30, 85, -85]) {
        const p = { x: R.dx * along + R.px * lat, z: R.dz * along + R.pz * lat };
        T.H.teleport(p.x, p.z);
        let ok = true;
        for (const [a, b] of [[0, 0], [6, 0], [-3, 0], [0, 6], [6, 6], [-3, -3], [9, 3]]) { const sn = B.bValidate(B.bSnap('found', p.x + a, p.z + b, 0, P), P); if (!sn.ok) { ok = false; break; } }
        if (ok) { best = p; break; }
      }
      if (best) { T.H.teleport(best.x - 2, best.z - 1.5); T.calm(); T.H.CAM.yaw = 0; P.yaw = 0; }
      return { best, zone: best && T.F.zoneAt(best.x, best.z).name }; })()""" % B)
    check(r['best'] is not None, 'a place to build in the homeland: ' + str(r.get('zone')))
    if not r['best']: return
    bx, bz = r['best']['x'], r['best']['z']
    # refused places
    r = await ev(page, 'refused', """(() => { %s const R = T.H.REALMS;
      const why = (x, z) => { T.H.teleport(x + 3, z + 3); const sn = B.bValidate(B.bSnap('found', x, z, 0, P), P); return sn.ok ? 'ok' : sn.why; };
      const town = R[0].town, road = { x: R[0].dx * 300, z: R[0].dz * 300 }, enemy = { x: R[1].dx * 330 + R[1].px * 50, z: R[1].dz * 330 + R[1].pz * 50 };
      const lake = T.H.dbg.LAKES.find((L) => T.F.zoneAt(L.x, L.z).realm === 0) || T.H.dbg.LAKES[0];
      const keep = R[0].keepSites[0];
      const steep = (() => { for (let k = 0; k < 4000; k++) { const a = k * 2.399, rr = 260 + (k %% 60) * 3.2, x = Math.sin(a) * rr, z = Math.cos(a) * rr; if (T.F.zoneAt(x, z).realm !== 0 || T.F.zoneAt(x, z).kind !== 'home') continue; const g = [T.F.heightAt(x - 1.5, z - 1.5), T.F.heightAt(x + 1.5, z + 1.5), T.F.heightAt(x + 1.5, z - 1.5), T.F.heightAt(x - 1.5, z + 1.5)]; if (Math.max(...g) - Math.min(...g) > 3.2) return { x, z }; } return null; })();
      const out = { town: why(town.x + 4, town.z + 4), road: why(road.x, road.z), enemy: why(enemy.x, enemy.z), keep: why(keep.x, keep.z), lake: lake ? why(lake.x, lake.z) : 'none', steep: steep ? why(steep.x, steep.z) : 'none' };
      T.H.teleport(%f, %f); T.calm(); return out; })()""" % (B, bx - 2, bz - 1.5))
    check('Too near' in r['town'] or 'cannot build' in r['town'], 'no building in a town: ' + r['town'])
    check('road' in r['road'] or 'Too near' in r['road'], 'no building on the road: ' + r['road'])
    check('lands' in r['enemy'], "no building on another realm's lands: " + r['enemy'])
    check('Too near' in r['keep'] or 'cannot build' in r['keep'], 'no building in a keep: ' + r['keep'])
    check(r['lake'] == 'none' or 'water' in r['lake'] or 'lands' in r['lake'] or 'Too near' in r['lake'], 'no building on water: ' + r['lake'])
    check(r['steep'] == 'none' or 'steep' in r['steep'] or 'Too near' in r['steep'] or 'way' in r['steep'], 'no building on a steep slope: ' + r['steep'])
    # the first foundation: set down, it rises in stages as the hammer works it
    r = await ev(page, 'foundation', """(() => { %s
      T.calm(); const g0 = T.F.goodsCount('stone'), r = B.buildPlace('found', %f, %f, 0);
      if (!r.ok) return { ok: false, why: r.why };
      const pc = r.pc, took = g0 - T.F.goodsCount('stone'), rises = [];
      for (let k = 0; k < 4; k++) { rises.push([pc.st, +pc.p.toFixed(2), +pc.mat.uniforms.uRise.value.toFixed(2)]); T.H.simulate(1.6); }
      T.H.simulate(2);
      const fl = T.F.floorAt(pc.x, pc.z, pc.y + 0.3);
      return { ok: true, took, rises, st: pc.st, y: +pc.y.toFixed(2), floor: +fl.toFixed(2), ground: +T.F.heightAt(pc.x, pc.z).toFixed(2), frame: [pc.fx, pc.fz, pc.fyaw], id: pc.id }; })()""" % (B, bx, bz))
    check(r['ok'], 'a foundation is set down: ' + str(r.get('why')))
    if not r['ok']: return
    check(r['took'] == 6, 'it takes its goods (6 stone)')
    ps = [x[1] for x in r['rises']]
    check(r['rises'][0][0] == 'build' and all(ps[i] < ps[i + 1] for i in range(len(ps) - 1)) and r['rises'][1][2] < r['rises'][3][2], 'it rises in stages as the hammer works it ' + str(r['rises']))
    check(r['st'] == 'built' and abs(r['floor'] - r['y']) < 0.01 and r['y'] > r['ground'], 'the finished foundation is a floor you stand on, above the ground')
    # snapping and rotation: a second foundation next to the first lands exactly one cell along, at the same height
    r = await ev(page, 'snap', """(() => { %s const a = BU.pieces[0], c = Math.cos(a.fyaw), s = Math.sin(a.fyaw);
      const x = a.x + 3.3 * c + 0.4 * s, z = a.z - 3.3 * s + 0.4 * c;
      const sn = B.bValidate(B.bSnap('found', x, z, 0, P), P);
      const d = Math.hypot(sn.x - a.x, sn.z - a.z);
      const w0 = B.bSnap('wall', a.x + 1.4 * s, a.z + 1.4 * c, 0, P), w1 = B.bSnap('wall', a.x + 1.4 * s, a.z + 1.4 * c, 1, P);
      const r2 = B.buildPlace('found', x, z, 0); if (r2.ok) { T.H.teleport(r2.pc.x - 1.8, r2.pc.z - 1.8); BU.work = { pc: r2.pc, x: P.x, z: P.z, t: 0 }; } T.H.simulate(7);
      return { d: +d.toFixed(3), dy: +(sn.y - a.y).toFixed(3), i: sn.i, j: sn.j, yaw: +(sn.yaw - a.fyaw).toFixed(3), ok: r2.ok, st: r2.pc && r2.pc.st,
        wall: [w0.e, w0.i, w0.j, +(w1.yaw - w0.yaw).toFixed(3), +w0.y.toFixed(2)], ay: +a.y.toFixed(2) }; })()""" % B)
    check(abs(r['d'] - 3.0) < 0.01 and abs(r['dy']) < 0.01 and r['i'] == 1 and r['j'] == 0, 'a second foundation snaps one cell along, level with the first')
    check(r['ok'] and r['st'] == 'built', 'and is built')
    check(r['wall'][0] == 'x' and abs(abs(r['wall'][3]) - 3.1416) < 0.01 and abs(r['wall'][4] - r['ay']) < 0.01, 'a wall snaps to the cell edge, on the floor, and R turns it about')
    # the cottage: walls, a door and a window, two thatch roofs
    r = await ev(page, 'cottage', """(() => { %s const a = BU.pieces[0];
      const at = (u, v) => ({ x: a.fx + u * Math.cos(a.fyaw) + v * Math.sin(a.fyaw), z: a.fz - u * Math.sin(a.fyaw) + v * Math.cos(a.fyaw) });
      const C = 3, put = (t, u, v, rot = 0) => { const p = at(u, v); const r = B.buildPlace(t, p.x, p.z, rot); if (r.ok) { T.H.simulate(BU.pieces.length ? 10 : 0); } return r.ok ? r.pc.st : r.why; };
      // stand inside the cottage while it goes up
      const mid = at(C / 2, 0); T.H.teleport(mid.x, mid.z); T.calm();
      const res = {};
      res.back0 = put('wall', 0, -C / 2); res.back1 = put('wall', C, -C / 2);
      res.left = put('wallStone', -C / 2, 0); res.right = put('wall', C + C / 2, 0);
      // the front from outside, so the door opens away from the builder
      const out = at(C / 2, C * 1.6); T.H.teleport(out.x, out.z); T.calm();
      res.door = put('door', 0, C / 2); res.win = put('window', C, C / 2);
      T.H.teleport(mid.x, mid.z); T.calm();
      res.roof0 = put('roofThatch', 0, 0); res.roof1 = put('roofShingle', C, 0);
      res.floating = (() => { const p = at(C * 4, C * 4); const sn = B.bValidate(B.bSnap('roofThatch', p.x, p.z, 0, P), P); return sn.ok ? 'ok' : sn.why; })();
      res.n = BU.pieces.length; res.built = BU.pieces.filter((pc) => pc.st === 'built').length;
      return res; })()""" % B)
    check(all(r[k] == 'built' for k in ['back0', 'back1', 'left', 'right', 'door', 'win', 'roof0', 'roof1']), 'a cottage goes up: walls, a stone wall, a door, a window, thatch and shingle roofs ' + json.dumps(r))
    check(r['floating'] != 'ok', 'a roof will not float: it needs walls under it (' + str(r['floating']) + ')')
    # the door works; you walk in; the roof keeps the rain off
    r = await ev(page, 'door', """(() => { %s const d = BU.pieces.find((pc) => pc.t === 'door'), f = BU.pieces[0];
      const c = Math.cos(d.yaw), s = Math.sin(d.yaw), out = { x: d.x + 1.6 * s, z: d.z + 1.6 * c };
      T.stand(out.x, out.z, d.x, d.z);
      const l0 = T.label(), c0 = d.leafColl.active; T.interact(); T.H.simulate(1.0);
      const c1 = d.leafColl.active, open = d.leaves[0].open;
      const p = T.walk(out.x, out.z, T.yawTo(out.x, out.z, d.x - 1.5 * s, d.z - 1.5 * c), 1.0);
      const inside = BU.pieces.some((q) => q.t === 'found' && Math.hypot(P.x - q.x, P.z - q.z) < 2.1) && Math.abs(P.y - f.y) < 0.05;
      // rain: under the roof a body stays dry, outside it soaks
      const W = T.H.dbg.WEATHER; W.raining = 1; W.overcast = 1;
      P.wet = 0; P._wxT = 0; T.H.simulate(8);
      const wetIn = P.wet, skyIn = T.F.skyOver(P), roofIn = T.F.houseRoofOver(P.x, P.z);
      T.stand(out.x + 3 * s, out.z + 3 * c, d.x, d.z); P.wet = 0; P._wxT = 0; T.H.simulate(8);
      const wetOut = P.wet, skyOut = T.F.skyOver(P);
      W.raining = 0; W.overcast = 0;
      // shut it again from outside
      T.stand(out.x, out.z, d.x, d.z); const l1 = T.label(); T.interact(); T.H.simulate(1.0);
      return { l0, c0, c1, open, p, inside, y: +(P.y).toFixed(2), fy: +f.y.toFixed(2), wetIn: +wetIn.toFixed(3), skyIn, roofIn, wetOut: +wetOut.toFixed(3), skyOut, l1, closed: d.leafColl.active }; })()""" % B)
    check(r['l0'] == 'Open the door' and r['c0'] and not r['c1'] and r['open'] == 1, 'the cottage door opens with E and lets you through')
    check(r['inside'], 'you walk in through the doorway onto the floor')
    check(r['skyIn'] == 0 and r['roofIn'] and r['wetIn'] < 0.02, 'under the roof the rain does not reach you')
    check(r['skyOut'] == 1 and r['wetOut'] > 0.1, 'outside it soaks you')
    check(r['l1'] == 'Close the door' and r['closed'], 'the door shuts again')
    # inside, the camera stays in the room: under the roof and within the walls
    r = await ev(page, 'camera', """(() => { %s const f = BU.pieces[0], f2 = BU.pieces[1], c = Math.cos(f.fyaw), s = Math.sin(f.fyaw);
      const mx = (f.x + f2.x) / 2, mz = (f.z + f2.z) / 2; T.stand(mx, mz, mx + s, mz + c); T.play();
      const out = [];
      for (const [yaw, pitch, dist] of [[f.fyaw, 0.4, 8.5], [f.fyaw + Math.PI, 0.6, 8.5], [f.fyaw + 1.6, 1.1, 12]]) {
        T.H.look(yaw, pitch, dist); for (let i = 0; i < 4; i++) T.H.frame(1 / 30);
        const cp = T.H.camera.position, dx = cp.x - mx, dz = cp.z - mz, lu = dx * c - dz * s, lv = dx * s + dz * c;
        out.push({ inU: Math.abs(lu) < 3.0, inV: Math.abs(lv) < 1.5, below: cp.y < f.y + B.BUILD.pieces.find((q) => q.t === 'roofThatch').y - f.y + 1.2, y: +(cp.y - f.y).toFixed(2) });
      }
      T.H.look(f.fyaw, 0.36, 8.5);
      return out; })()""" % B)
    check(all(o['inU'] and o['inV'] and o['below'] for o in r), 'standing inside, the camera stays in the room under the roof')
    # bed, chest, campfire inside and out
    r = await ev(page, 'furniture', """(() => { %s const f = BU.pieces[0], f2 = BU.pieces[1];
      T.stand(f2.x, f2.z, f.x, f.z);
      const rb = B.buildPlace('bed', f2.x + 0.2, f2.z + 0.2, 0); T.H.simulate(6);
      const fire = B.buildPlace('campfire', f.x + 6 * Math.cos(f.fyaw) + 5 * Math.sin(f.fyaw), f.z - 6 * Math.sin(f.fyaw) + 5 * Math.cos(f.fyaw), 0);
      return { bed: rb.ok ? rb.pc.st : rb.why, bedY: rb.ok ? +(rb.pc.y - f2.y).toFixed(2) : null, fire: fire.ok ? 'ok' : fire.why }; })()""" % B)
    check(r['bed'] == 'built' and r['bedY'] == 0, 'a bed is built on the floor inside')
    r = await ev(page, 'bed', """(() => { %s const bed = BU.pieces.find((pc) => pc.t === 'bed');
      T.stand(bed.x + 1.2 * Math.cos(bed.yaw), bed.z - 1.2 * Math.sin(bed.yaw), bed.x, bed.z);
      const l = T.label(); B.buildSleep(bed); const spot = B.buildBedSpot();
      T.H.teleport(T.H.REALMS[0].town.x + 30, T.H.REALMS[0].town.z); P.hp = 0; P.alive = false;
      T.F.releasePlayer();
      return { l, bed: BU.bed === bed.id, spot: !!spot, d: spot ? +Math.hypot(P.x - bed.x, P.z - bed.z).toFixed(2) : null }; })()""" % B)
    check(r['bed'] and r['spot'], 'sleeping in the bed makes it your return point')
    check(r['d'] is not None and r['d'] < 2.5, 'when you fall you wake by your bed (%s m)' % r['d'])
    # fire: a roof set alight burns, spreads, falls; then it is repaired
    r = await ev(page, 'fire', """(() => { %s P.alive = true; P.hp = P.maxHp; const f = BU.pieces[0];
      T.stand(f.x + 9 * Math.sin(f.fyaw), f.z + 9 * Math.cos(f.fyaw), f.x, f.z);
      const roof = BU.pieces.find((pc) => pc.t === 'roofThatch');
      const lit = B.buildFireAt(roof.x, roof.y + 1, roof.z, 1);
      const seen = [];
      for (let k = 0; k < 10; k++) { T.H.simulate(3); seen.push(roof.st + ':' + roof.char.toFixed(2)); }
      const burnt = BU.pieces.filter((pc) => pc.st === 'ruin').map((pc) => pc.t), burning = BU.pieces.filter((pc) => pc.st === 'burning').map((pc) => pc.t);
      const stoneOk = BU.pieces.filter((pc) => pc.t === 'wallStone' || pc.t === 'found').every((pc) => pc.st !== 'ruin' || pc.t === 'found');
      return { lit, seen, burnt, burning, stoneOk, rise: +roof.mat.uniforms.uRise.value.toFixed(2), char: roof.mat.uniforms.uPc.value.y, meshY: +(roof.mesh.position.y - roof.y).toFixed(2) }; })()""" % B)
    check(r['lit'] >= 1 and 'roofThatch' in r['burnt'], 'a thatch roof set alight burns and falls in ' + str(r['seen'][-3:]))
    check(r['meshY'] < -1.5 and r['char'] == 1, 'the fallen roof lies charred on the floor below')
    check(len(r['burnt']) + len(r['burning']) >= 2, 'the fire spreads to what touches it ' + str(r['burnt'] + r['burning']))
    check(r['stoneOk'], 'stone does not burn down')
    r = await ev(page, 'repair', """(() => { %s const W = T.H.dbg.WEATHER; W.raining = 0;
      T.H.simulate(60);
      const roof = BU.pieces.find((pc) => pc.t === 'roofThatch');
      // put out what still burns, by letting it burn down; then repair everything burnt
      const before = BU.pieces.filter((pc) => pc.st === 'ruin').length;
      const g0 = T.F.goodsCount('thatch');
      T.stand(roof.x + 0.5, roof.z + 0.5, roof.x, roof.z);
      const order = BU.pieces.filter((pc) => pc.st === 'ruin' && !T.H.build.BP[pc.t].roof).concat(BU.pieces.filter((pc) => pc.st === 'ruin' && T.H.build.BP[pc.t].roof));
      for (const pc of order) { B.buildRepair(pc); BU.work = { pc, x: P.x, z: P.z, t: 0, auto: true }; T.H.simulate(12); }
      const after = BU.pieces.filter((pc) => pc.st === 'ruin').length;
      return { before, after, roof: roof.st, char: roof.char, paid: g0 - T.F.goodsCount('thatch'), meshY: +(roof.mesh.position.y - roof.y).toFixed(2), coll: BU.pieces.filter((pc) => pc.st === 'built' && ['wall', 'door', 'window'].includes(pc.t)).every((pc) => pc.coll.length > 0) }; })()""" % B)
    check(r['before'] >= 1 and r['after'] == 0 and r['roof'] == 'built' and r['char'] == 0 and r['meshY'] == 0, 'everything burnt is repaired with the hammer and stands again')
    check(r['paid'] >= 4 and r['coll'], 'a repair costs half the goods; repaired walls block again')
    # pulling down: half the goods back, the colliders go
    r = await ev(page, 'demolish', """(() => { %s const w = BU.pieces.find((pc) => pc.t === 'window');
      const n0 = BU.pieces.length, g0 = T.F.goodsCount('plank'), coll = w.coll.slice();
      B.buildDemolish(w);
      return { n: BU.pieces.length - n0, back: T.F.goodsCount('plank') - g0, had: coll.length, inColl: coll.some((c) => B.COLL.boxes.includes(c)) }; })()""" % B)
    check(r['n'] == -1 and r['back'] == 3, 'pulling down a window gives back half its planks')
    check(r['had'] > 0 and not r['inColl'], 'and its wall no longer blocks')
    # a fence line with a gate (the helper other systems can use for pens)
    r = await ev(page, 'fence', """(() => { %s const f = BU.pieces[0], c = Math.cos(f.fyaw), s = Math.sin(f.fyaw);
      const a = { x: f.x - 6 * c + 9 * s, z: f.z + 6 * s + 9 * c }, b2 = { x: f.x + 6 * c + 9 * s, z: f.z - 6 * s + 9 * c };
      const L = B.buildFenceLine(a.x, a.z, b2.x, b2.z, { gateAt: 0.5 });
      const g = L.find((pc) => pc.t === 'gate');
      T.stand(g.x + 1.5 * Math.sin(g.yaw), g.z + 1.5 * Math.cos(g.yaw), g.x, g.z);
      const l0 = T.label(); T.interact(); T.H.simulate(1);
      return { n: L.length, gate: !!g, l0, open: g.leaves[0].open, coll: g.leafColl.active }; })()""" % B)
    check(r['n'] >= 3 and r['gate'] and r['l0'] == 'Open the gate' and r['open'] == 1 and not r['coll'], 'a fence line with a gate that opens')
    # save and load: everything comes back as it was; an old save and a broken one load cleanly
    r = await ev(page, 'save', """(() => { %s
      const before = BU.pieces.map((pc) => [pc.t, pc.st, +pc.x.toFixed(2), +pc.z.toFixed(2), +pc.y.toFixed(2), pc.open]).sort().join(';');
      const data = JSON.parse(JSON.stringify(T.F.savePartsData('world'))), bed = BU.bed;
      const size = JSON.stringify(data.build).length;
      T.F.savePartsLoad('world', undefined);
      const empty = BU.pieces.length;
      T.F.savePartsLoad('world', data);
      const after = BU.pieces.map((pc) => [pc.t, pc.st, +pc.x.toFixed(2), +pc.z.toFixed(2), +pc.y.toFixed(2), pc.open]).sort().join(';');
      const solid = BU.pieces.filter((pc) => pc.st === 'built' && pc.t === 'found').every((pc) => pc.floors.length === 1);
      let broken = 'ok';
      try { T.F.savePartsLoad('world', { build: { v: 1, p: [['x'], [1, 'wall', 'a'], null, [5, 'roofThatch', 1e9, 0, 0]], bed: 'q' } }); } catch (e) { broken = String(e); }
      const nb = BU.pieces.length;
      T.F.savePartsLoad('world', data);
      return { same: before === after, size, empty, solid, broken, nb, n: BU.pieces.length, bed: BU.bed === bed }; })()""" % B)
    check(r['same'] and r['solid'] and r['bed'], 'saved and loaded, every piece comes back as it was (%d bytes for %d pieces)' % (r['size'], r['n']))
    check(r['empty'] == 0 and r['broken'] == 'ok' and r['nb'] == 0, 'an old save (none) and a broken record load cleanly')
    # the piece shader and the ghost compile (a frame looking at the cottage, with the builder open)
    r = await ev(page, 'programs', """(() => { const B = T.H.build, f = B.BUILD.pieces[0], P = T.H.GAME.player;
      T.H.teleport(f.x - 4 * Math.sin(f.fyaw), f.z - 4 * Math.cos(f.fyaw)); P.yaw = f.fyaw + Math.PI; B.buildToggle(true);
      T.camW(f.x + 6, f.y + 4, f.z + 6, f.x, f.y + 1, f.z); T.H.UI.modal = null; T.H.frame(); T.H.frame(); B.buildToggle(false);
      return T.H.dbg.renderer.info.programs.filter((p) => p.diagnostics && !p.diagnostics.runnable).map((p) => p.name).slice(0, 5); })()""")
    check(not r, 'the piece and ghost shaders compile')
    await page.evaluate("T.play(); 0")
    if SHOTS:
        await page.evaluate("T.H.setTod(0.42); T.H.dbg.WEATHER.raining = 0; 0")
        await shot(page, 'build_cottage', """(() => { const f = T.H.build.BUILD.pieces[0], c = Math.cos(f.fyaw), s = Math.sin(f.fyaw);
          const mx = f.x + 1.5 * c, mz = f.z - 1.5 * s;
          T.camW(mx + 7 * s + 4.5 * c, f.y + 3.4, mz + 7 * c - 4.5 * s, mx, f.y + 1.5, mz); T.H.UI.modal = 'menu'; return 0; })()""")
        await shot(page, 'build_ghost_ok', """(() => { const B = T.H.build, P = T.H.GAME.player, f = B.BUILD.pieces[0], c = Math.cos(f.fyaw), s = Math.sin(f.fyaw);
          T.H.UI.modal = null; T.H.teleport(f.x - 4 * c - 4 * s, f.z + 4 * s - 4 * c); P.yaw = f.fyaw + Math.PI; B.buildToggle(true); B.buildPick('found');
          T.H.CAM.mode = 'fixed'; const g = { x: P.x + Math.sin(P.yaw) * 3.6, z: P.z + Math.cos(P.yaw) * 3.6 };
          T.H.camera.position.set(P.x + 5 * Math.cos(P.yaw) - 5 * Math.sin(P.yaw), P.y + 5, P.z - 5 * Math.sin(P.yaw) - 5 * Math.cos(P.yaw)); T.H.camera.lookAt(g.x, P.y + 0.5, g.z);
          T.H.frame(); return 0; })()""")
        await shot(page, 'build_ghost_bad', """(() => { const B = T.H.build, P = T.H.GAME.player, f = B.BUILD.pieces[0];
          // a foundation over the cottage's own floor: refused, so the ghost shows red
          B.buildPick('found'); T.H.teleport(f.x - 2.2 * Math.sin(f.fyaw), f.z - 2.2 * Math.cos(f.fyaw)); P.yaw = Math.atan2(f.x - P.x, f.z - P.z);
          const c = B.buildCursor(); T.H.camera.position.set(c.x + 5 * Math.cos(f.fyaw) - 6 * Math.sin(f.fyaw), P.y + 5.5, c.z - 5 * Math.sin(f.fyaw) - 6 * Math.cos(f.fyaw)); T.H.camera.lookAt(c.x, P.y + 1, c.z);
          T.H.frame(); return 0; })()""")
        r = await ev(page, 'ghost state', "(() => { const M = T.H.build.BUILD.mode; return M && M.sn ? { ok: M.sn.ok, why: M.sn.why } : null; })()")
        check(r is not None and not r['ok'], 'the ghost turns red where a piece cannot go: ' + str(r and r['why']))
        # the builder's bar as a player sees it
        try:
            await page.evaluate("document.getElementById('hud').hidden = false; T.H.UI.modal = null; T.H.frame(); 0")
            await page.screenshot(path=OUT + 'build_ui.png', timeout=120000)
            print('  shot build_ui', flush=True)
        except Exception as e:
            print('  (no page screenshot of the bar:', str(e)[:80], ')')
        await page.evaluate("document.getElementById('hud').hidden = true; T.H.build.buildToggle(false); T.play(); 0")

async def main():
    async with async_playwright() as p:
        b, page, logs = await setup(p, w=640 if not SHOTS else 960, h=360 if not SHOTS else 540)
        await page.evaluate(f"__hm.fn.setQuality('{QUALITY}')")
        await page.evaluate("__hm.start({realm:0, cls:'warrior', level:1}); const P = __hm.GAME.player; P.maxHp = P.hp = 1e8; 0")
        await page.evaluate("() => {" + HELPERS + "; return 0; }")
        await page.evaluate("() => { const W = __hm.dbg.WEATHER; W.mode = 'clear'; W.kind = 'clear'; W.storm = 0; W.raining = 0; W.overcast = 0; W.nextBolt = 1e9; T.H.setTod(0.42); return 0; }")
        await page.evaluate("document.getElementById('hud').hidden = true")
        # the page's own animation loop stops: frames are drawn only when a screenshot asks (on a busy machine under
        # SwiftShader a loop of frames queued behind each other can hold a screenshot for many minutes)
        await page.evaluate("window.requestAnimationFrame = () => 0; 0")
        if ONLY in (None, 'hall'): await hall_tests(page)
        if ONLY in (None, 'build'): await build_tests(page)
        errs = await page.evaluate("__hm.errors.slice(0, 8)")
        check(not errs, 'no runtime errors: ' + json.dumps(errs)[:600])
        for l in logs[:8]: print(l)
        await b.close()
    print(f'\n{len(FAILS)} failed' if FAILS else '\nall passed', f'[{time.time() - T0:.0f}s]')
    sys.exit(1 if FAILS else 0)

asyncio.run(main())
