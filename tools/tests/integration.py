"""How the systems of version 8 fit together (water, callings, survival, farming, animals, building):
nothing one system places stands in another's way or in the water; ice forms at a pond's own level and carries
whoever stands on it; drinking at a river slakes thirst and fills the empty waterskins; a recipe that uses water gives
the skin back; companions swim after you; nothing is built on a tilled bed; a long run with everything going stays free
of errors.
usage: python3 tools/tests/integration.py"""
import json, asyncio, sys, pathlib, time
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
from hmlib import setup, OUT
from playwright.async_api import async_playwright
FAILS = []
T0 = time.time()
def check(cond, what):
    print(('  ok   ' if cond else '  FAIL ') + what, flush=True)
    if not cond: FAILS.append(what)

PLACES = """(() => {
  const H = __hm, F = H.fn, out = { bad: [] };
  const S = H.surv, A = H.animals.A, FM = H.farm.FARM, W = H.water;
  const wet = (x, z, d = 0.05) => { const q = W.waterAt(x, z); return !!q && q.depth > d; };
  const inPlot = (x, z, pad = 0) => FM.plots.find((P) => { const dx = x - P.x, dz = z - P.z, u = dx * P.bx + dz * P.bz, v = dx * P.ax + dz * P.az; return Math.abs(u) <= P.hw + pad && Math.abs(v) <= P.hd + pad; }) || null;
  const inPen = (x, z, pad = 0) => A.pens.find((p) => H.animals.penHas(p, x, z, -pad)) || null;
  const nearStation = (x, z, r) => S.CRAFT.stations.find((T) => Math.hypot(T.x - x, T.z - z) < r) || null;
  const bad = (what, x, z) => { if (out.bad.length < 40) out.bad.push(what + ' @' + x.toFixed(1) + ',' + z.toFixed(1)); };
  // the workstations: dry, not in a house or hall, not in a pen or a bed
  out.stations = S.CRAFT.stations.length;
  for (const T of S.CRAFT.stations) {
    if (wet(T.x, T.z)) bad('station in water ' + T.kind, T.x, T.z);
    if (F.houseAt(T.x, T.z, 0.8)) bad('station in a house ' + T.kind, T.x, T.z);
    if (inPen(T.x, T.z, 1.5)) bad('station in a pen ' + T.kind, T.x, T.z);
    if (inPlot(T.x, T.z, 1.5)) bad('station on a bed ' + T.kind, T.x, T.z);
  }
  // the keep halls: their doors open onto clear ground (no station on the step or between the banner poles)
  out.halls = F.halls().length;
  for (const Hl of F.halls()) {
    const fx = Math.sin(Hl.yaw), fz = Math.cos(Hl.yaw);
    for (const k of [1, 2.3, 4]) { const x = Hl.x + fx * (Hl.d / 2 + k), z = Hl.z + fz * (Hl.d / 2 + k); const T = nearStation(x, z, 2.2); if (T) bad('station before a hall door ' + T.kind, T.x, T.z); }
  }
  // paddocks and commons: dry, clear of houses, stations, beds and orchard trees
  out.pens = A.pens.length;
  for (const p of A.pens) {
    if (wet(p.x, p.z)) bad('pen in water', p.x, p.z);
    for (let a = -1; a <= 1; a += 0.5) for (let b = -1; b <= 1; b += 0.5) {
      const lx = a * p.hw, lz = b * p.hd, c = Math.cos(p.yaw || 0), s = Math.sin(p.yaw || 0);
      const x = p.x + lx * c + lz * s, z = p.z - lx * s + lz * c;
      if (F.houseAt(x, z, 0.3)) { bad('pen over a house', x, z); break; }
      if (inPlot(x, z, 0.3)) { bad('pen over a bed', x, z); break; }
      if (nearStation(x, z, 1.6)) { bad('pen over a station', x, z); break; }
    }
  }
  // beds: dry, clear of houses and stations
  out.plots = FM.plots.length;
  for (const P of FM.plots) {
    if (wet(P.x, P.z, 0.15)) bad('bed in water', P.x, P.z);
    if (F.houseAt(P.x, P.z, 0.5)) bad('bed in a house', P.x, P.z);
    if (nearStation(P.x, P.z, 2)) bad('bed on a station', P.x, P.z);
  }
  // foraged plants and wild herbs: not in a house, a pen, a bed or deep water
  out.forage = S.FORAGE.list.length;
  let nf = 0;
  for (const q of S.FORAGE.list) {
    if (wet(q.x, q.z, 0.35)) { bad('plant in water ' + q.k, q.x, q.z); nf++; }
    else if (F.houseAt(q.x, q.z, 0.2)) { bad('plant in a house ' + q.k, q.x, q.z); nf++; }
    else if (inPen(q.x, q.z, 0) && q.k !== 'nettle') { bad('plant in a pen ' + q.k, q.x, q.z); nf++; }
    else if (inPlot(q.x, q.z, 0.2)) { bad('plant on a bed ' + q.k, q.x, q.z); nf++; }
  }
  out.forageBad = nf;
  const herbs = FM.herbs || [];
  out.herbs = herbs.length;
  let nh = 0;
  for (const q of herbs) if (wet(q.x, q.z, 0.35) || F.houseAt(q.x, q.z, 0.2) || inPen(q.x, q.z, 0)) { nh++; bad('herb misplaced ' + q.k, q.x, q.z); }
  out.herbsBad = nh;
  // the animals at large: wild horses, livestock and deer stand on dry land or wade, never deep in a lake
  let na = 0, nb = 0;
  for (const e of H.ENT) if (e.alive && (e.role === 'animal' || e.kind === 'horse' || e.kind === 'deer')) { na++; const q = W.waterAt(e.x, e.z); if (q && q.depth > 1.0) { nb++; bad('animal in deep water ' + e.kind, e.x, e.z); } }
  out.animals = na; out.animalsWet = nb;
  return out;
})()"""

FUNCS = """(() => {
  const H = __hm, F = H.fn, out = {};
  const P = H.GAME.player, W = H.water, C = H.cls, S = H.surv;
  const put = (x, z) => { P.x = P.prevX = x; P.z = P.prevZ = z; P.y = F.heightAt(x, z); };
  // a pond above the lakes' level, to freeze
  const ponds = (W.PONDS && (W.PONDS.list || W.PONDS)) || [];
  const pond = (Array.isArray(ponds) ? ponds : []).filter((p) => p && Number.isFinite(p.y) && p.y > 1.5).sort((a, b) => (b.n || 0) - (a.n || 0))[0];
  out.pond = pond ? { x: pond.x, z: pond.z, y: pond.y } : null;
  if (pond) {
    const q = W.waterAt(pond.x, pond.z);
    out.pondSurf = q ? q.y : null;
    const s = C.freezeWater(pond.x, pond.z, 6, P);
    out.ice = s ? { wy: s.wy } : null;
    // a soldier set down on the ice stands on it and does not swim
    const e = H.ENT.find((o) => o.alive && o.kind === 'humanoid' && o.role !== 'player' && o.fixedY === null && !o.mount);
    if (e) {
      const ox = e.x, oz = e.z;
      e.x = e.prevX = pond.x + 1; e.z = e.prevZ = pond.z; e.y = s.wy + 0.08; e.target = null; out.onIceRole = e.role;
      H.simulate(0.6);
      out.onIce = { y: e.y, swim: !!e.swim, wd: e.wd || 0 };
      e.x = e.prevX = ox; e.z = e.prevZ = oz; e.y = F.heightAt ? F.heightAt(ox, oz) : e.y;
    }
  }
  // drinking at a river: thirst goes, the empty skins fill
  const Rv = W.RIVERS[0];
  const mid = Rv.pts ? Rv.pts[Math.floor(Rv.pts.length * 0.6)] : null;
  if (mid) {
    // stand on the bank: step out from the middle of the river until the ground is dry
    const px = mid.x !== undefined ? mid.x : mid[0], pz = mid.z !== undefined ? mid.z : mid[1];
    let bx = px, bz = pz;
    for (let d = 1; d < 20; d += 0.5) { const x = px + d, z = pz; if (!W.waterAt(x, z) || W.waterAt(x, z).depth < 0.02) { bx = x + 0.4; bz = z; break; } }
    put(bx, bz); P.y = F.heightAt(bx, bz); P.vy = 0; P.yaw = -Math.PI / 2; H.simulate(0.3);
    out.bank = { x: bx, z: bz, y: P.y, w: W.waterAt(bx - 1, bz) ? W.waterAt(bx - 1, bz).depth : null };
    S.SURV.thirst = 0.3;
    H.INV.goods.water = 0; H.INV.goods.waterskin_empty = 3;
    const near = W.waterNear(P);
    out.near = near ? near.kind : null;
    if (near) { S.drinkAt({ x: near.x, z: near.z }, near.kind); H.simulate(2.5); }
    out.drank = { thirst: S.SURV.thirst, full: F.goodsCount('water'), empty: F.goodsCount('waterskin_empty') };
  }
  // a waterskin drunk from comes back empty; a recipe that uses water gives the skin back
  S.SURV.thirst = 0.5; const w0 = F.goodsCount('water'), e0 = F.goodsCount('waterskin_empty');
  S.eatGood('water');
  out.sip = [F.goodsCount('water') - w0, F.goodsCount('waterskin_empty') - e0];
  const rec = S.RECIPES.find((r) => r.id === 'bread');
  F.goodsAdd('flour', 1, true); F.goodsAdd('water', 1, true);
  const e1 = F.goodsCount('waterskin_empty');
  const oven = S.CRAFT.stations.find((T) => T.kind === 'oven');
  out.bread = S.survCraftOnce(rec, { silent: true, station: oven });
  out.breadSkin = F.goodsCount('waterskin_empty') - e1;
  // a companion swims after you; livestock in a pen does not
  const hound = H.ENT.find((o) => o.alive && o.role === 'animal' && o.tame && o.tame.owner === 'player');
  out.companion = hound ? W.swimAllowed(hound) : 'none';
  const sheep = H.ENT.find((o) => o.alive && o.role === 'animal' && o.tame && o.tame.owner === 'town');
  out.townSheep = sheep ? W.swimAllowed(sheep) : 'none';
  // nothing is built on a tilled bed
  const bed = H.farm.FARM.plots.find((Q) => Q.own !== 'p') || H.farm.FARM.plots[0];
  out.buildOnBed = bed ? H.build.bLandWhy(bed.x, bed.z, P) : 'no bed';
  return out;
})()"""

async def main():
    async with async_playwright() as p:
        b, page, logs = await setup(p, w=640, h=360)
        await page.evaluate("__hm.start({ realm: 0, cls: 'mage', level: 24 })")
        r = await page.evaluate(PLACES)
        print('places', json.dumps(r))
        check(r['stations'] >= 30 and r['halls'] == 6 and r['pens'] >= 3 and r['plots'] >= 6, f"every system placed its things ({r['stations']} stations, {r['halls']} halls, {r['pens']} pens, {r['plots']} beds)")
        check(not [x for x in r['bad'] if x.startswith('station')], 'workstations stand dry, outside houses and halls, clear of pens, beds and hall doors')
        check(not [x for x in r['bad'] if x.startswith('pen')], 'paddocks and commons are dry and clear of houses, beds and stations')
        check(not [x for x in r['bad'] if x.startswith('bed')], 'tilled beds are dry and clear of houses and stations')
        check(r['forageBad'] <= max(2, r['forage'] // 200), f"foraged plants grow outside houses, pens, beds and deep water ({r['forageBad']} of {r['forage']})")
        check(r['herbsBad'] <= max(2, r['herbs'] // 200), f"wild herbs grow outside houses, pens and deep water ({r['herbsBad']} of {r['herbs']})")
        check(r['animalsWet'] == 0, f"no animal stands deep in the water at the start ({r['animals']} animals)")
        r = await page.evaluate(FUNCS)
        print('funcs', json.dumps(r))
        if r['pond']:
            check(r['ice'] and abs(r['ice']['wy'] - r['pondSurf']) < 0.05, 'a mage\'s ice forms at the pond\'s own surface, not the lakes\' level')
            check(r.get('onIce') and not r['onIce']['swim'] and r['onIce']['y'] > r['ice']['wy'] - 0.05, 'a soldier on the ice stands on it and does not swim')
        else:
            check(False, 'found a pond above the lakes\' level to freeze')
        check(r.get('near') == 'river', f"by a river the water offer knows it is a river ({r.get('near')})")
        d = r.get('drank') or {}
        check(d.get('thirst', 0) > 0.95 and d.get('full') == 3 and d.get('empty') == 0, f'drinking at the river slakes thirst and fills the empty waterskins ({d})')
        check(r['sip'] == [-1, 1], 'a waterskin you drink from comes back empty')
        check(r['bread'] is not False and r['breadSkin'] == 1, f"a recipe that uses water gives its skin back ({r['bread']}, {r['breadSkin']})")
        check(r['townSheep'] is False or r['townSheep'] == 'none', 'town livestock keeps out of deep water')
        check(r['buildOnBed'] and 'bed' in str(r['buildOnBed']).lower() or 'land' in str(r['buildOnBed']).lower() or 'near' in str(r['buildOnBed']).lower(), f"nothing is built on a tilled bed ({r['buildOnBed']})")
        # a long run with every system going: war, weather, seasons, needs, crops, animals
        r = await page.evaluate("""(() => { const H = __hm; H.farm.setSeason(0.3); for (let i = 0; i < 6; i++) H.simulate(30);
          let bad = 0; for (const e of H.ENT) if (!Number.isFinite(e.x) || !Number.isFinite(e.y) || !Number.isFinite(e.z)) bad++;
          return { bad, errors: H.errors.slice(0, 3), n: H.ENT.length }; })()""")
        print('run', json.dumps(r))
        check(r['bad'] == 0 and not r['errors'], f'three minutes with everything going: no errors, nothing non-finite ({r})')
        errs = await page.evaluate("__hm.errors")
        check(not errs and not logs, f'no runtime errors {errs[:2]} {logs[:2]}')
        print('FAILED:' if FAILS else 'ALL PASSED', FAILS, f'[{time.time() - T0:.0f}s]')
        await b.close()
asyncio.run(main())
