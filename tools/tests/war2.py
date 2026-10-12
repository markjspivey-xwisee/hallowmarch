"""[war2] A war that keeps moving: each stall the campaign soak found, set up and watched until it moves on.
  down    a band's leader left up on its own keep's wall walk with an order elsewhere comes down by the castle's ways
  tower   a band's leader in a burh's corner tower's ground room comes out at its door and goes on
  island  a leader on a stretch of walk cut off by burnt gaps jumps down into the court (hurt by the fall)
  court   a band in the court of the keep it attacks storms the court, not the gate behind it
  engine  a mangonel that cannot be pushed to its place is settled where it stands (or given up), not waited on for good
  watch   a band at a gate whose own engine is at work is not given up as stalled
  storm   a band of four waits before a fallen tower against the whole garrison, and goes in with a second band beside it
  gap     a raid on the Thule hallow goes round to a gap burnt in its log ring (its gate whole) and takes the hallow
  stormshot  a band through a fallen tower's door into the court (screenshots by day and night)
  houses  townsfolk run to a burning house and beat it out (screenshots by day and night at low and high)
  gate    a gate burnt down is kept with the world: saved, put back, loaded broken and charred
usage: python3 tools/tests/war2.py [only=down,tower,island,court,engine,watch,storm,gap,stormshot,houses,gate] [noshots] [q=low|medium|high]"""
import json, asyncio, sys, pathlib, time, base64, io
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
from hmlib import setup, OUT
from playwright.async_api import async_playwright
try:
    from PIL import Image
except Exception:
    Image = None

ARGS = sys.argv[1:]
SHOTS = 'noshots' not in ARGS
ONLY = next((a[5:].split(',') for a in ARGS if a.startswith('only=')), None)
QUALITY = next((a[2:] for a in ARGS if a.startswith('q=')), 'low')
FAILS = []
T0 = time.time()

def want(k): return ONLY is None or k in ONLY
def check(cond, what):
    print(('  ok   ' if cond else '  FAIL ') + what, flush=True)
    if not cond: FAILS.append(what)

async def ev(page, js): return await page.evaluate(js)

async def snap(page, name):
    # the picture from the fixed camera already set: the HUD hidden, the particles born in the frames' future while
    # simulating let go (CLAUDE.md, Gotchas), a few frames drawn, the canvas read
    url = await page.evaluate("""(() => { const hud = document.getElementById('hud'); if (hud) hud.style.visibility = 'hidden';
      __hm.frame(1/30); const now = __hm.dbg.U.uTime.value;
      for (const P of [__hm.walls.fx.fxAlpha, __hm.walls.fx.fxAdd]) { const a0 = P.a0.array, a1 = P.a1.array; let k = 0;
        for (let i = 0; i < P.max; i++) if (a0[i * 4 + 3] > now + 1e-3 && a1[i * 4 + 3] > 0) { a1[i * 4 + 3] = -1; k++; }
        if (k) { P.dirty0 = 0; P.dirty1 = P.max - 1; } }
      for (let i = 0; i < 7; i++) __hm.frame(1/30); const u = __hm.dbg.renderer.domElement.toDataURL('image/png');
      if (hud) hud.style.visibility = ''; return u; })()""")
    data = base64.b64decode(url.split(',', 1)[1])
    if Image: Image.open(io.BytesIO(data)).convert('RGB').save(OUT + name + '.png')
    else: pathlib.Path(OUT + name + '.png').write_bytes(data)
    print(f'  shot {name}', flush=True)

HELP = r"""(() => {
  const H = __hm, fn = H.fn, WAR = H.WAR;
  window.__w2t = {
    // a band of realm r of n soldiers, ordered to attack enemy keep ek, every member put at (x, z) on the floor there
    band(r, ek, n, x, z, y) {
      const id = H.SIEGE.band(r, ek, 95, n);
      const wb = WAR.warbands.find((w) => w.id === id);
      for (const e of fn.wbMembers(wb)) { e.x = e.prevX = x + (Math.random() - 0.5) * 3; e.z = e.prevZ = z + (Math.random() - 0.5) * 3; e.y = y ?? fn.heightAt(e.x, e.z); e.mount = null; e.target = null; }
      return id;
    },
    wb(id) { return WAR.warbands.find((w) => w.id === id); },
    quiet() { // the player in its own town, unharmed, out of the war
      const P = H.GAME.player, S = H.REALMS[P.faction].town;
      P.x = P.prevX = S.x + 3; P.z = P.prevZ = S.z + 3; P.y = fn.heightAt(P.x, P.z); P.hp = P.maxHp; P.alive = true;
    },
  };
  return 0;
})()"""

async def main(p):
    b, page, logs = await setup(p, w=640, h=360)
    page.set_default_timeout(600000)
    await ev(page, f"__hm.fn.setQuality('{QUALITY}')")
    await ev(page, "(() => { __hm.start({ realm: 0, cls: 'warrior', level: 20 }); __hm.UI.modal = 'menu'; return 0; })()")
    await ev(page, HELP)
    await ev(page, "__w2t.quiet(); __hm.simulate(2); 0")

    if want('down'):
        print('-- down: a leader left up on a wall walk', flush=True)
        r = await ev(page, r"""(() => {
          const H = __hm, fn = H.fn, WAR = H.WAR;
          const K = WAR.keeps.find((k) => k.realm === 0 && k.orig === 0), C = fn.castleOf(K.site);
          const ek = WAR.keeps.findIndex((k) => k.realm !== 0);
          // a point on the walk: on a post's way, high up, no ladder, out of any tower
          let q = null;
          for (let i = 0; i < C.posts.length && !q; i++) for (const p of fn.castleRoute(K, i)) if (!p.ladder && p.y > K.site.y + 4 && !H.towers.towerRoomOf({ x: p.x, z: p.z, y: p.y })) { q = p; break; }
          if (!q) return { err: 'no walk point' };
          const id = __w2t.band(0, ek, 6, K.site.x, K.site.z);
          const wb = __w2t.wb(id), L = fn.wbLeader(wb);
          L.x = L.prevX = q.x; L.z = L.prevZ = q.z; L.y = q.y; wb.lid = L.id;
          const out = [], x0 = L.x, z0 = L.z;
          let downAt = null;
          for (let t = 0; t < 90; t++) {
            __w2t.quiet(); H.simulate(1);
            const h = L.y - fn.heightAt(L.x, L.z);
            if (downAt === null && h < 1.2) downAt = t + 1;
            if (t % 10 === 9) out.push([t + 1, +h.toFixed(1), Math.round(Math.hypot(L.x - x0, L.z - z0))]);
          }
          return { downAt, far: Math.round(Math.hypot(L.x - x0, L.z - z0)), alive: L.alive, out, h0: +(q.y - fn.heightAt(q.x, q.z)).toFixed(1), stats: H.war2.WAR2.stats };
        })()""")
        print('  ', json.dumps(r), flush=True)
        check(r.get('h0', 0) > 3, f"the leader starts up on the walk ({r.get('h0')} m)")
        check(r.get('downAt') is not None and r['downAt'] <= 60, f"it comes down by the castle's ways (on the ground after {r.get('downAt')} s)")
        check(r.get('far', 0) > 25, f"and goes on toward its order ({r.get('far')} m from the walk after 90 s)")

    if want('tower'):
        print('-- tower: a leader in a burh tower\'s ground room', flush=True)
        r = await ev(page, r"""(() => {
          const H = __hm, fn = H.fn, WAR = H.WAR;
          const K = WAR.keeps.find((k) => k.realm === 2 && k.orig === 2);
          if (!K) return { err: 'no Thule keep' };
          const T = H.towers.list().find((t) => t.S === K.site && t.role !== 'gate' && t.kind !== 'drum') || H.towers.list().find((t) => t.S === K.site);
          const ek = WAR.keeps.findIndex((k) => k.realm !== 2);
          const y = fn.floorAt(T.wx, T.wz, K.site.y + T.yG + 0.4);
          const id = __w2t.band(2, ek, 6, K.site.x, K.site.z);
          const wb = __w2t.wb(id), L = fn.wbLeader(wb);
          L.x = L.prevX = T.wx; L.z = L.prevZ = T.wz; L.y = y; wb.lid = L.id;
          const in0 = !!H.towers.towerRoomOf(L);
          let outAt = null; const x0 = L.x, z0 = L.z;
          for (let t = 0; t < 90; t++) {
            __w2t.quiet(); H.simulate(1);
            if (outAt === null && !H.towers.towerRoomOf(L)) outAt = t + 1;
          }
          return { in0, outAt, far: Math.round(Math.hypot(L.x - x0, L.z - z0)), role: T.role, kind: T.kind, stats: H.war2.WAR2.stats };
        })()""")
        print('  ', json.dumps(r), flush=True)
        check(r.get('in0'), 'the leader starts in the tower\'s ground room')
        check(r.get('outAt') is not None and r['outAt'] <= 20, f"it goes out at the door ({r.get('outAt')} s)")
        check(r.get('far', 0) > 25, f"and on toward its order ({r.get('far')} m after 90 s)")

    if want('island'):
        print('-- island: a leader on a stretch of a burh\'s walk cut off by burnt gaps', flush=True)
        r = await ev(page, r"""(() => {
          const H = __hm, fn = H.fn, WAR = H.WAR, Z = H.blaze;
          Z.blazeInit();
          const K = WAR.keeps.find((k) => k.realm === 2 && k.orig === 2), C = fn.castleOf(K.site), B = C.blaze;
          if (!B || B.ring) return { err: 'no walk' };
          // a cell in the middle of a run, its neighbours either side burnt through
          const c = B.cells.find((q) => q.nb.length >= 2 && q.nb.every((o) => o.nb.length >= 2) && q.f.active);
          for (const o of c.nb) Z.deckThrough(o, true);
          const ek = WAR.keeps.findIndex((k) => k.realm !== 2);
          const id = __w2t.band(2, ek, 5, K.site.x, K.site.z);
          const wb = __w2t.wb(id), L = fn.wbLeader(wb);
          L.x = L.prevX = c.x; L.z = L.prevZ = c.z; L.y = c.y; wb.lid = L.id;
          const h0 = +(L.y - Math.max(fn.heightAt(L.x, L.z), K.site.y)).toFixed(1);
          let downAt = null;
          for (let t = 0; t < 40; t++) { __w2t.quiet(); H.simulate(1); if (downAt === null && L.y - Math.max(fn.heightAt(L.x, L.z), K.site.y) < 0.8) downAt = t + 1; }
          return { h0, downAt, alive: L.alive, hp: +(L.hp / L.maxHp).toFixed(2), jumps: H.war2.WAR2.stats.jumps || 0 };
        })()""")
        print('  ', json.dumps(r), flush=True)
        check(r.get('h0', 0) > 2, f"the leader starts up on the walk ({r.get('h0')} m)")
        check(r.get('downAt') is not None and r['downAt'] <= 30, f"with no way down it jumps into the court ({r.get('downAt')} s, {r.get('jumps')} jumps, health {r.get('hp')})")

    if want('court'):
        print('-- court: a band in an enemy court with its gate whole', flush=True)
        r = await ev(page, r"""(() => {
          const H = __hm, fn = H.fn, WAR = H.WAR;
          const ki = WAR.keeps.findIndex((k) => k.realm === 0 && k.door.alive);
          const K = WAR.keeps[ki];
          const id = __w2t.band(1, ki, 10, K.site.x, K.site.z);
          const wb = __w2t.wb(id); wb.order.phase = 'siege';
          let ph = null, door = 0, foes = 0;
          for (let t = 0; t < 12; t += 2) {
            __w2t.quiet(); H.simulate(2);
            if (ph === null && wb.order && wb.order.phase === 'assault') ph = t + 2;
            for (const m of fn.wbMembers(wb)) { const q = fn.getEnt(m.target); if (!q) continue; if (q.kind === 'door') door++; else if (q.role === 'lord' || q.role === 'guard') foes++; }
          }
          return { ph, door, foes, gate: K.door.alive };
        })()""")
        print('  ', json.dumps(r), flush=True)
        check(r.get('ph') is not None and r['ph'] <= 6, f"a band in the court of a keep it attacks storms the court, not the gate behind it ({r.get('ph')} s)")
        check(r.get('foes', 0) > 0 and r.get('door', 1) == 0, f"it fights the lord and the garrison, not the gate ({r.get('foes')} looks at them, {r.get('door')} at the gate)")

    if want('engine'):
        print('-- engine: a mangonel its crew cannot push', flush=True)
        r = await ev(page, r"""(() => {
          const H = __hm, fn = H.fn, WAR = H.WAR, SG = H.SIEGE;
          const K = WAR.keeps.find((k) => k.realm !== 0), C = fn.castleOf(K.site), g = SG.siegeGatePoint(K.site);
          const W = (C.sections || []).find((w) => w.state === 'whole');
          const f = SG.siegeFace(W);
          const x = f.x + f.nx * 70, z = f.z + f.nz * 70, wx = f.x + f.nx * 40, wz = f.z + f.nz * 40;
          const E = SG.siegeCreate('mangonel', 0, x, z, Math.atan2(f.x - x, f.z - z), { C, W }, { x: wx, z: wz });
          E.build = 1; E.state = 'move';
          const d0 = Math.hypot(E.x - wx, E.z - wz);
          let t = 0;
          for (; t < 60; t++) { __w2t.quiet(); H.simulate(1); if (E.gone || E.state !== 'move') break; }
          return { d0: Math.round(d0), t: t + 1, gone: E.gone, state: E.state, settled: H.war2.WAR2.stats.engineSettled, given: H.war2.WAR2.stats.engineGivenUp };
        })()""")
        print('  ', json.dumps(r), flush=True)
        check(r.get('gone') or r.get('state') == 'work', f"an engine nobody can push is settled or given up ({r.get('state')}, gone {r.get('gone')}, after {r.get('t')} s)")
        check(r.get('t', 99) <= 40, 'within 40 s')

    if want('watch'):
        print('-- watch: a band at the gate whose engine is at work', flush=True)
        r = await ev(page, r"""(() => {
          const H = __hm, fn = H.fn, WAR = H.WAR, SG = H.SIEGE;
          const ki = WAR.keeps.findIndex((k) => k.realm !== 0), K = WAR.keeps[ki], C = fn.castleOf(K.site);
          const g = SG.siegeGatePoint(K.site);
          const id = __w2t.band(0, ki, 7, g.x + g.nx * 60, g.z + g.nz * 60);
          const wb = __w2t.wb(id), O = wb.order;
          O.phase = 'siege';
          const W = (C.sections || []).find((w) => w.state === 'whole'), f = SG.siegeFace(W);
          const x = f.x + f.nx * 55, z = f.z + f.nz * 55;
          const E = SG.siegeCreate('trebuchet', 0, x, z, Math.atan2(f.x - x, f.z - z), { C, W }, { x, z });
          E.build = 1; E.state = 'work'; E.wb = wb; O.siegeE = E.id;
          // its leader and crew stand by it; the band gets no nearer and lands no blow (the gate's foes are kept off)
          const ms = fn.wbMembers(wb);
          ms.slice(0, 4).forEach((m, i) => { m.siegeCrew = E.id; m.siegeSlot = i; E.crew.push(m.id); });
          for (const m of ms) m.hp = m.maxHp = 1e6; // (the watchdog alone: a band cut down to two by a sally is merged into the next to muster,
          E.ent.hp = E.ent.maxHp = E.lastHp = 1e9; //  and an engine hacked apart is no longer at work)
          const st0 = WAR.stats.bandStalls || 0;
          wb.realProgress = H.GAME.t; wb.hitAt = -1e9;
          for (let t = 0; t < 170; t += 5) { __w2t.quiet(); H.simulate(5); if (!wb.order || wb.order !== O) break; }
          return { kept: wb.order === O, stalls: (WAR.stats.bandStalls || 0) - st0, E: E.state, crew: E.crew.length, n: fn.wbMembers(wb).length, dead: !!wb.dead, phase: wb.order ? wb.order.phase : null };
        })()""")
        print('  ', json.dumps(r), flush=True)
        check(r.get('kept') and r.get('E') == 'work' and r.get('crew', 0) > 0, f"a band whose engine works keeps its order past the 150 s watchdog (kept {r.get('kept')}, stalls {r.get('stalls')}, engine {r.get('E')}, crew {r.get('crew')})")

    if want('storm'):
        print('-- storm: a small band waits for enough to storm a fallen tower', flush=True)
        r = await ev(page, r"""(() => {
          const H = __hm, fn = H.fn, WAR = H.WAR, SG = H.SIEGE;
          // a Logres keep's corner tower brought down, its garrison whole, two Thule bands before it
          const ki = WAR.keeps.findIndex((k) => k.realm === 0 && fn.castleOf(k.site).sections.some((w) => w.kind === 'tower' && H.siege2.siegeTowerWayOk(w)));
          const K = WAR.keeps[ki], C = fn.castleOf(K.site);
          const W = C.sections.find((w) => w.kind === 'tower' && H.siege2.siegeTowerWayOk(w));
          fn.fillGarrison(K, true); // the whole garrison and its lord (an earlier scene may have thinned it)
          fn.castleBreach(W);
          const f = SG.siegeFace(W);
          const small = __w2t.band(2, ki, 4, f.x + f.nx * 30, f.z + f.nz * 30);
          const wbS = __w2t.wb(small);
          let t = 0, sPhase = [];
          for (; t < 40; t += 2) { __w2t.quiet(); H.simulate(2); sPhase.push(wbS.order ? wbS.order.phase : '-'); }
          const waited = !sPhase.includes('breach');
          const st1 = W.state;
          if (W.state !== 'breach') fn.castleBreach(W); // (mended meanwhile in a quiet moment: down again)
          const big = __w2t.band(2, ki, 12, f.x + f.nx * 32 + 3, f.z + f.nz * 32);
          const wbB = __w2t.wb(big); wbB.order.siegeE = null; // (no engine of its own to build: every hand for the storm)
          if (!fn.wbMembers(wbS).length) { const again = __w2t.band(2, ki, 4, f.x + f.nx * 30, f.z + f.nz * 30); __w2t.wb(again).order.siegeE = null; }
          let goT = null; const bPh = [];
          for (t = 0; t < 40; t += 2) { __w2t.quiet(); H.simulate(2); bPh.push((wbB.order ? wbB.order.phase : '-') + ':' + fn.wbMembers(wbB).length + ':' + fn.wbMembers(wbS).length); if (goT === null && ((wbS.order && wbS.order.phase === 'breach') || (wbB.order && wbB.order.phase === 'breach'))) goT = t + 2; }
          let def = 0; for (const id of K.guards) { const g = fn.getEnt(id); if (g && g.alive) def += g.ai.wall ? 0.5 : 1; }
          const Lb = fn.wbLeader(wbB);
          return { tower: W.T.role, waited, st1, st2: W.state, sPhase: sPhase.join(','), goT, bPh: bPh.join(','), def, lord: !!(fn.getEnt(K.lord) && fn.getEnt(K.lord).alive), dB: Lb ? Math.round(Math.hypot(Lb.x - K.site.x, Lb.z - K.site.z)) : null, ban: wbB.order && wbB.order.breachBan, stats: H.war2.WAR2.stats.stormWaits };
        })()""")
        print('  ', json.dumps(r), flush=True)
        check(r.get('waited'), f"a band of four does not storm a fallen tower against the whole garrison alone ({r.get('sPhase')})")
        check(r.get('goT') is not None, f"with a second band beside it they go in ({r.get('goT')} s; {r.get('bPh')})")

    if want('gap'):
        print('-- gap: a raid goes in by a gap burnt in the timber hallow\'s ring', flush=True)
        r = await ev(page, r"""(() => {
          const H = __hm, fn = H.fn, WAR = H.WAR, Z = H.blaze;
          Z.blazeInit();
          const T = WAR.temples[2], C = fn.castleOf(T.site), B = C.blaze;
          if (!B || !B.ring) return { err: 'no ring' };
          // Thule has lost a keep (its hallow may be raided); a stretch of its ring burnt through on the side away from its gate
          const K = WAR.keeps.find((k) => k.orig === 2); fn.captureKeep(K, 0, null);
          // (on its flank: its back faces Thule's muster, whose wardens would cut the raid down before it got in)
          const c = B.cells.slice().sort((a, b) => Math.abs(Math.abs(a.am) - Math.PI / 2) - Math.abs(Math.abs(b.am) - Math.PI / 2))[0];
          Z.deckThrough(c, true);
          const S = T.site, g = { x: T.nav.tg.x, z: T.nav.tg.z };
          // Thule's bands kept away and its hallow-wardens fallen (the way in is the matter here, not the fight)
          for (const w of WAR.warbands) if (w.realm === 2) for (const e of fn.wbMembers(w)) { e.alive = false; e.hp = 0; e.removeAt = H.GAME.t; }
          for (const id of T.guardians) { const q = fn.getEnt(id); if (q) { q.alive = false; q.hp = 0; q.removeAt = H.GAME.t; } }
          T.guardians.clear(); T.nextGuardAt = H.GAME.t + 600; T.lastEnemyNear = H.GAME.t;
          const ek = WAR.keeps.findIndex((k) => k.realm !== 0);
          const id = __w2t.band(0, ek, 12, g.x, g.z);
          const wb = __w2t.wb(id);
          const msg = H.CW.playerOrder(id, 'raid', 2);
          const phases = new Set(); let took = null, inside = null;
          for (let t = 0; t < 120; t += 2) {
            __w2t.quiet(); H.simulate(2);
            if (wb.order) phases.add(wb.order.type + '/' + wb.order.phase + (wb.order.gi !== undefined ? wb.order.gi : ''));
            const L = fn.wbLeader(wb);
            if (L && inside === null && Math.hypot(L.x - S.x, L.z - S.z) < 12) inside = t + 2;
            if (took === null && WAR.relics.some((x) => x.state === 'carried' && x.carrierRealm === 0)) took = t + 2;
            if (took !== null && t > took + 10) break;
          }
          const L = fn.wbLeader(wb);
          return { msg, gap: !!H.war2.hallowRingGap(T), door: T.door.alive, phases: [...phases].join(','), inside, took, raids: H.war2.WAR2.stats.ringRaids, n: fn.wbMembers(wb).length, L: L ? [Math.round(L.x - S.x), Math.round(L.z - S.z)] : null, wardens: [...T.guardians].map(fn.getEnt).filter((q) => q && q.alive).length };
        })()""")
        print('  ', json.dumps(r), flush=True)
        check(r.get('door') and r.get('gap'), 'the hallow\'s gate stands; its ring is burnt through')
        check('raid/gap' in (r.get('phases') or ''), f"the raid goes round to the gap ({r.get('phases')})")
        check(r.get('took') is not None, f"in by the gap, it takes the hallow (its wardens fallen; in the court at {r.get('inside')} s, taken at {r.get('took')} s; {r.get('n')} left)")

    if want('stormshot') and SHOTS:
        print('-- stormshot: a band through a fallen tower\'s door, by day and by night', flush=True)
        r = await ev(page, """(() => {
          const H = __hm, fn = H.fn, WAR = H.WAR, SG = H.SIEGE;
          H.setTod(0.42); // (look_views.js's TOD: day 0.42, night 2.1)
          const Ks = WAR.keeps.map((q, i) => i).filter((i) => WAR.keeps[i].orig === 0 && WAR.keeps[i].door.alive && fn.castleOf(WAR.keeps[i].site).sections.some((w) => w.kind === 'tower' && H.siege2.siegeTowerWayOk(w)));
          if (!Ks.length) return { err: 'no keep' };
          const ki = Ks[0], K = WAR.keeps[ki], C = fn.castleOf(K.site);
          if (K.realm !== 0) fn.captureKeep(K, 0, null);
          fn.fillGarrison(K, true);
          const W = C.sections.find((w) => w.kind === 'tower' && H.siege2.siegeTowerWayOk(w));
          // the court's guards and the lord stand down and none come fresh (a thinned court: the archers on the walls
          // stay), and the stormers are not thinned by them: the picture is the way in, not the fight (war2.py storm)
          for (const id of K.guards) { const g = fn.getEnt(id); if (g && !g.ai.wall) { g.alive = false; g.hp = 0; g.removeAt = H.GAME.t; } }
          const Lr = fn.getEnt(K.lord); if (Lr) fn.removeEnt(Lr); K.lord = null; K.nextGuardAt = H.GAME.t + 1e6;
          fn.castleBreach(W);
          const f = SG.siegeFace(W);
          const id = __w2t.band(2, ki, 12, f.x + f.nx * 14, f.z + f.nz * 14);
          const wb = __w2t.wb(id); wb.order.siegeE = null;
          for (const m of fn.wbMembers(wb)) m.hp = m.maxHp = 1e6;
          let through = 0, t = 0;
          for (; t < 60 && through < 2; t += 0.5) { __w2t.quiet(); H.simulate(0.5); through = fn.wbMembers(wb).filter((m) => m.ai.storm && m.ai.storm.done && !m.ai.storm.failed).length; if (W.state !== 'breach') fn.castleBreach(W); }
          const Rt = H.siege2.siegeStormRoute(W), door = Rt[4], inn = Rt[3];
          // from the court, a little to the side of the door's line, at a man's height and a half: the first place
          // out of the hall and the houses with nothing between it and the door
          const dx = door.x - inn.x, dz = door.z - inn.z, d = Math.hypot(dx, dz) || 1, fy = door.y ?? K.site.y;
          let px = door.x + dx / d * 9 + dz / d * 3.5, pz = door.z + dz / d * 9 - dx / d * 3.5, py = fy + 2.4;
          found: for (const dd of [8, 6.5, 10, 5, 12]) for (const lat of [3.5, -3.5, 2, -2, 5.5, -5.5, 0]) for (const hh of [2.2, 3.6]) {
            const qx = door.x + dx / d * dd + dz / d * lat, qz = door.z + dz / d * dd - dx / d * lat, qy = fy + hh;
            if (fn.houseAt(qx, qz, 0.6)) continue;
            const R = H.walls.shotHit(qx, qy, qz, door.x, fy + 1.2, door.z);
            if (R && R.t < 0.85) continue;
            px = qx; pz = qz; py = qy; break found;
          }
          H.UI.modal = 'menu'; H.CAM.mode = 'fixed';
          H.camera.position.set(px, py, pz);
          H.camera.lookAt(door.x, fy + 1.3, door.z);
          H.camera.updateMatrixWorld();
          const near = fn.wbMembers(wb).filter((m) => Math.hypot(m.x - door.x, m.z - door.z) < 12).length;
          return { keep: K.site.name, t, through, n: fn.wbMembers(wb).length, near };
        })()""")
        print('  ', json.dumps(r), flush=True)
        check(r.get('through', 0) >= 1, f"stormshot: the band comes through the fallen tower's door ({r.get('through')} through in {r.get('t')} s at {r.get('keep')})")
        await snap(page, f'war2_storm_day_{QUALITY}')
        # the same moment by night (a second and a half on)
        await ev(page, "(() => { __hm.setTod(2.1); __w2t.quiet(); __hm.simulate(1.5); return 0; })()")
        await snap(page, f'war2_storm_night_{QUALITY}')
        await ev(page, "(() => { __hm.CAM.mode = 'follow'; __hm.setTod(0.42); return 0; })()")

    if want('houses'):
        print('-- houses: townsfolk beat out a burning house', flush=True)
        r = await ev(page, r"""(() => {
          const H = __hm, fn = H.fn, P = H.GAME.player, S = H.REALMS[0].town;
          // a house with people about it: the one with most villagers within 35 m
          let best = null, bn = -1;
          for (const h of H.HOUSES) {
            if (h.keepHall || h.S !== S || h.state !== 'whole') continue;
            const n = H.ENT.filter((e) => e.alive && e.role === 'villager' && Math.hypot(e.x - h.x, e.z - h.z) < 35).length;
            if (n > bn) { bn = n; best = h; }
          }
          window.__w2t.H = best;
          P.x = P.prevX = best.x + 14; P.z = P.prevZ = best.z + 14; P.y = fn.heightAt(P.x, P.z);
          const ok = fn.igniteHouse(best);
          const out = []; let saved = null, crewMax = 0;
          for (let t = 0; t < 70; t++) {
            H.simulate(1);
            const c = best.w2crew ? best.w2crew.size : 0; crewMax = Math.max(crewMax, c);
            const beating = H.ENT.filter((e) => e.alive && e.role === 'villager' && e.anim.act === 21).length;
            if (t % 5 === 4) out.push([t + 1, best.state, best.burn ? +best.burn.R.toFixed(1) : 0, c, beating]);
            if (best.state === 'whole' && saved === null) saved = t + 1;
            if (t === 12) window.__w2t.shotT = 1;
            if (best.state !== 'burning') break;
          }
          return { near: bn, ok, saved, crewMax, state: best.state, out, stats: H.war2.WAR2.stats };
        })()""")
        print('  ', json.dumps(r), flush=True)
        check(r.get('ok'), f"the house catches ({r.get('near')} villagers within 35 m)")
        check(r.get('crewMax', 0) >= 2, f"its people run to it and beat the flames ({r.get('crewMax')} at once)")
        check(r.get('saved') is not None, f"they beat it out (out after {r.get('saved')} s; {r.get('state')})")
        if SHOTS:
            for tod, tag in ((0.42, 'day'), (2.1, 'night')):  # (look_views.js's TOD: day 0.42, night 2.1)
                ok = await ev(page, f"""(() => {{
                  const H = __hm, fn = H.fn, B = window.__w2t.H;
                  H.setTod({tod});
                  // set alight again and caught while its people beat it (two or more at it, the fire still up)
                  let vs = [];
                  for (let t = 0; t < 60; t++) {{
                    if (B.state === 'whole') fn.igniteHouse(B);
                    if (B.state !== 'burning') break;
                    H.simulate(1);
                    vs = H.ENT.filter((e) => e.alive && e.role === 'villager' && e.anim.act === 21 && Math.hypot(e.x - B.x, e.z - B.z) < 12);
                    if (vs.length >= 2 && B.burn && B.burn.R > 1.2) break;
                  }}
                  H.UI.modal = 'menu'; H.CAM.mode = 'fixed';
                  // look at the house from its side, the crew in the foreground
                  const cx = vs.length ? vs.reduce((a, e) => a + e.x, 0) / vs.length : B.x, cz = vs.length ? vs.reduce((a, e) => a + e.z, 0) / vs.length : B.z;
                  const dx = cx - B.x, dz = cz - B.z, d = Math.hypot(dx, dz) || 1;
                  const px = cx + dx / d * 7 + dz / d * 4, pz = cz + dz / d * 7 - dx / d * 4;
                  H.camera.position.set(px, fn.heightAt(px, pz) + 3.2, pz);
                  H.camera.lookAt(B.x, B.y + 2.6, B.z);
                  H.camera.updateMatrixWorld();
                  return [vs.length, B.state, B.burn ? +B.burn.R.toFixed(1) : 0];
                }})()""")
                print(f'   {tag}: beating, state, front {ok}', flush=True)
                await snap(page, f'war2_houses_{tag}_{QUALITY}')
                await ev(page, "(() => { __hm.CAM.mode = 'follow'; for (let t = 0; t < 90; t++) { __hm.simulate(1); if (window.__w2t.H.state !== 'burning') break; } return 0; })()")

    if want('gate'):
        print('-- gate: a burnt gate kept with the world', flush=True)
        r = await ev(page, r"""(() => {
          const H = __hm, fn = H.fn, WAR = H.WAR;
          H.blaze.blazeInit();
          const K = WAR.keeps.find((k) => { const C = fn.castleOf(k.site); return C && C.gate && C.gate.bz; });
          if (!K) return { err: 'no gate of planks' };
          const C = fn.castleOf(K.site), G0 = C.gate;
          H.blaze.gateIgnite(G0, 0.5);
          H.blaze.gateFalls(G0, K.door);
          const dead0 = !K.door.alive, down0 = !!(G0.bz && G0.bz.down);
          H.simulate(5);
          const data = fn.savePartsData('world');
          const g = data && data.gates;
          // as a fresh world would have it: the gate whole again, then the save read back
          K.door.alive = true; K.door.hp = K.door.maxHp; if (G0.bz) G0.bz.down = false;
          fn.savePartsLoad('world', data);
          const dead1 = !K.door.alive, down1 = !!(G0.bz && G0.bz.down);
          H.simulate(1);
          return { name: K.site.name, dead0, down0, g, dead1, down1, coll: K.site.door ? K.site.door.active : null };
        })()""")
        print('  ', json.dumps(r), flush=True)
        check(r.get('dead0') and r.get('down0'), f"the gate of {r.get('name')} burns down")
        check(bool(r.get('g')), f"the save keeps it ({r.get('g')})")
        check(r.get('dead1') and r.get('down1') and r.get('coll') is False, 'loaded, it lies burnt and open')

    errs = await ev(page, "__hm.errors.slice(0, 5)")
    check(not errs, f'no runtime errors {errs}')
    await b.close()

async def run():
    async with async_playwright() as p: await main(p)
    print(f"\n{'PASS' if not FAILS else 'FAILED: ' + '; '.join(FAILS)} ({time.time() - T0:.0f}s)")
    sys.exit(1 if FAILS else 0)

asyncio.run(run())
