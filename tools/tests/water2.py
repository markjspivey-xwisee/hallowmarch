"""[water2] Under the water, on the water, and the marks bodies leave (07d_dive.js, 07e_boats.js, 07f_tracks.js):
diving and coming up, the breath running down and the water harming a diver, the bed solid under them, the current
carrying a diver, the winter ice blocking them and a hole letting them up, the finds on the bed; a boat boarded, rowed,
turned, carried by a river, run aground (it cannot cross land), moored again, fished from, burnt and rebuilt, a hound
riding in it, the towns' fishers rowing out in the morning; tracks laid and fading in snow, mud and wet sand, cut by
later ones, ruts, drifts. Then screenshots: under the water, under the ice, a boat on a lake and on a river, tracks
in snow (water2_*.png).
usage: python3 tools/tests/water2.py [noshots] [shotsonly] [only=dive,ice,finds,boats,fisher,tracks] [shots=under,boat,river,tracks,drift,ice] [medium] [small]"""
import json, asyncio, sys, pathlib, time, math
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
from hmlib import setup, OUT
from playwright.async_api import async_playwright
FAILS = []
T0 = time.time()
SHOTS = 'noshots' not in sys.argv
SHOTSONLY = 'shotsonly' in sys.argv
ONLY = [a[5:] for a in sys.argv if a.startswith('only=')]
def want(name): return not SHOTSONLY and (not ONLY or name in ONLY[0].split(','))
SHOTSEL = [a[6:] for a in sys.argv if a.startswith('shots=')]
def want_shot(name): return not SHOTSEL or name in SHOTSEL[0].split(',')

def check(cond, what):
    print(('  ok   ' if cond else '  FAIL ') + what, flush=True)
    if not cond: FAILS.append(what)

async def ev(page, label, js):
    r = await page.evaluate(js)
    print(f'{label} [{time.time() - T0:.0f}s]', json.dumps(r)[:1800], flush=True)
    return r

HELPERS = r"""
window.W2 = {
  H: __hm, F: __hm.fn, Wt: __hm.water,
  // keep the player alive and the March's foes away while something else is tested
  safe() { const H = this.H, P = H.GAME.player; P.maxHp = Math.max(P.maxHp, 2000); P.hp = P.maxHp; P.combatUntil = -99;
    for (const e of H.ENT) if (e !== P && e.alive && e.kind !== 'door' && this.F.isEnemy(P, e) && Math.hypot(e.x - P.x, e.z - P.z) < 90) { e.alive = false; e.removeAt = H.GAME.t; } },
  // a spot of the given depth (or deeper) in a realm's lake, on a line out from its middle
  lakeSpot(realm, minD, maxD = 99) { const L = this.H.dbg.LAKES.find((l) => l.realm === realm); for (let r = 0; r < 40; r += 0.5) for (let a = 0; a < 12; a++) { const x = L.x + Math.cos(a * 0.52) * r, z = L.z + Math.sin(a * 0.52) * r, w = this.Wt.waterAt(x, z); if (w && w.depth >= minD && w.depth <= maxD && Math.hypot(w.fx, w.fz) < 0.05) return { x, z, depth: w.depth, surf: w.y }; } return null; },
  // put the player swimming at (x, z)
  swimAt(x, z) { const H = this.H, P = H.GAME.player; if (P.boat) this.Wt.boats.leave(); if (P.dive) this.Wt.dive.end(); P.mount = null; H.teleport(x, z); const w = this.Wt.waterAt(x, z); if (w) P.y = w.y - 1.3; H.simulate(0.4); return this.Wt.state(P.id); },
  keys(list, sec, dt = 0.05) { const H = this.H; const m = H.UI.modal; H.UI.modal = null; for (let t = 0; t < sec; t += dt) { for (const k of list) H.INPUT.keys.add(k); H.simulate(dt, dt); } for (const k of list) H.INPUT.keys.delete(k); H.UI.modal = m; },
  offers() { const L = []; const H = this.H, P = H.GAME.player; this.Wt.waterOffers(P, (d, r, label, act) => { if (d < r) L.push(label); }); return L; },
  offer(prefix) { let f = null; const P = this.H.GAME.player; this.Wt.waterOffers(P, (d, r, label, act) => { if (d < r && label.startsWith(prefix) && !f) f = act; }); if (f) { f(); return true; } return false; },
  cam(c, l) { const H = this.H; H.UI.modal = 'menu'; H.CAM.mode = 'fixed'; document.getElementById('hud').hidden = true; const cm = H.camera; cm.position.set(c[0], c[1], c[2]); cm.lookAt(l[0], l[1], l[2]); cm.updateMatrixWorld(); },
  play() { const H = this.H; H.UI.modal = null; H.CAM.mode = 'play'; document.getElementById('hud').hidden = false; },
  // two schools of fish brought into view a little way in front of a diver (they spawn round the eye as you swim)
  fishInView() { const H = this.H, P = H.GAME.player, D = this.Wt.dive, Dv = D.DIVE; for (let k = 0; k < 6 && Dv.schools.length < 2; k++) D.dvFishStep(0.8);
    const fx = Math.sin(H.CAM.yaw), fz = Math.cos(H.CAM.yaw), py = P.y + 1.3;
    Dv.schools.slice(0, 2).forEach((S, k) => { const d = 2.4 + k * 2.2, side = k ? 1.6 : -1.1; S.x = P.x + fx * d + fz * side; S.z = P.z + fz * d - fx * side; const g = H.fn.heightAt(S.x, S.z); S.y = Math.max(g + 0.5, py + (k ? 0.5 : -0.3)); S.ty = S.y; S.flee = 3; S.tx = S.x + fz * 8; S.tz = S.z - fx * 8; S.yaw = Math.atan2(fz, -fx); for (const f of S.fish) { f.x = S.x + f.ox * Math.cos(S.yaw) + f.oz * Math.sin(S.yaw); f.y = S.y + f.oy; f.z = S.z - f.ox * Math.sin(S.yaw) + f.oz * Math.cos(S.yaw); f.yaw = S.yaw; } });
    return Dv.schools.length; },
};
0
"""

async def main():
    async with async_playwright() as p:
        W, Hh = (960, 540) if SHOTS and 'small' not in sys.argv else (640, 360)
        b, page, logs = await setup(p, w=W, h=Hh)
        await page.evaluate(HELPERS)
        r = await ev(page, 'boot', """(() => { const H = __hm; H.start({ realm: 0, cls: 'warrior', level: 24 }); W2.safe();
          return { errors: H.errors.slice(0, 3), finds: H.water.dive.finds().length, kinds: [...new Set(H.water.dive.finds().map((f) => f.kind))], boats: H.water.boats.list().length, jetties: H.water.boats.jetties().length, drifts: H.water.tracks.drifts(), where: { jetties: H.water.boats.jetties().map((j) => [j.realm, Math.round(j.x0), Math.round(j.z0), Math.round(j.end.x), Math.round(j.end.z)]), boats: H.water.boats.list().map((q) => [q.realm, Math.round(q.x), Math.round(q.z), q.st]) } }; })()""")
        check(not r['errors'], 'boots without errors')
        check(r['finds'] >= 12 and 'chest' in r['kinds'], 'finds lie on the beds (%d, %s)' % (r['finds'], r['kinds']))
        check(r['jetties'] == 3 and r['boats'] >= 9, 'a jetty for each town and boats (%d jetties, %d boats)' % (r['jetties'], r['boats']))
        check(r['drifts']['n'] > 5, 'drift wedges are built against the walls (%s)' % r['drifts'])

        if want('dive'):
            r = await ev(page, 'dive', """(() => { const H = __hm, Wt = H.water, D = Wt.dive, P = H.GAME.player; W2.safe();
              const s = W2.lakeSpot(0, 3.0); const st0 = W2.swimAt(s.x, s.z);
              const why = D.whyNot(); D.start(); const a = D.state();
              // look down and swim: deeper
              H.CAM.yaw = 0.3; H.CAM.pitch = 1.2; W2.keys(['KeyW'], 1.6); const b = D.state();
              // keep going down: the bed stops the body
              W2.keys(['KeyW'], 3); const c = D.state();
              // let go: the body drifts up, then breaks the surface
              H.simulate(1.5); const d = D.state();
              let t = 0; while (P.dive && t < 20) { H.simulate(0.25); t += 0.25; }
              const e = D.state();
              return { s, st0, why, a, b, c, d, e, t, errors: H.errors.slice(0, 3) }; })()""")
            check(r['st0']['swim'] and r['why'] is None and r['a']['dive'], 'a swimmer in deep water dives')
            check(r['b']['pivot'] < r['a']['pivot'] - 1.0, 'looking down and swimming takes the diver down (%.2f -> %.2f)' % (r['a']['pivot'], r['b']['pivot']))
            check(r['c']['pivot'] >= r['c']['bed'] + 0.4 and r['c']['pivot'] < r['c']['bed'] + 0.75, 'the bed is solid under a diver (body %.2f, bed %.2f)' % (r['c']['pivot'], r['c']['bed']))
            check(r['d']['pivot'] > r['c']['pivot'] + 0.15, 'a still diver drifts up (%.2f -> %.2f)' % (r['c']['pivot'], r['d']['pivot']))
            check(not r['e']['dive'] and r['e']['swim'] and r['t'] < 20, 'and comes up to swim at the surface (%.1f s)' % r['t'])
            check(r['b']['act'] >= 15 and r['b']['act'] < 16, 'the diver swims with the underwater stroke (action %.2f)' % r['b']['act'])

            r = await ev(page, 'breath', """(() => { const H = __hm, Wt = H.water, D = Wt.dive, P = H.GAME.player; W2.safe();
              const s = W2.lakeSpot(0, 3.0); W2.swimAt(s.x, s.z); P.breath = 1; D.start(); H.CAM.pitch = 1.2; W2.keys(['KeyW'], 1.0);
              // hold on the bed: Space not pressed, the diver keeps swimming down to stay under
              const out = []; const hp0 = P.hp;
              for (let i = 0; i < 44; i++) { W2.keys(['KeyW'], 1.0); out.push([i, +D.state().breath.toFixed(2), Math.round(P.hp)]); if (!P.dive || P.hp < hp0 * 0.6) break; }
              const hp1 = P.hp, b1 = P.breath, el = document.getElementById('breath'), barShown = el.classList.contains('on');
              H.frame(1 / 30);
              const bar = document.getElementById('breath').classList.contains('on'), low = document.getElementById('breath').classList.contains('low'), txt = document.getElementById('breath-t').textContent;
              // up for air: the breath comes back
              D.end(); W2.swimAt(P.x, P.z); H.simulate(4); const b2 = P.breath;
              return { out: out.filter((q, i) => i % 6 === 0 || i > 30), hp0, hp1, b1, bar, low, txt, b2, alive: P.alive, errors: H.errors.slice(0, 3) }; })()""")
            check(r['b1'] == 0 and r['hp1'] < r['hp0'] * 0.9, 'breath runs out after about half a minute and the water harms the diver (hp %d -> %d)' % (r['hp0'], r['hp1']))
            check(r['bar'] and r['low'] and r['txt'] == 'Drowning', 'the breath bar shows, low and drowning (%s)' % r['txt'])
            check(r['b2'] > 0.95, 'surfacing brings the breath back (%.2f)' % r['b2'])

            r = await ev(page, 'drown', """(() => { const H = __hm, Wt = H.water, D = Wt.dive, P = H.GAME.player;
              const s = W2.lakeSpot(0, 3.0); W2.swimAt(s.x, s.z); P.maxHp = 500; P.hp = 500; P.breath = 0; D.start(); H.CAM.pitch = 1.2;
              for (let i = 0; i < 30 && P.alive; i++) W2.keys(['KeyW'], 1.0);
              const dead = !P.alive, by = document.getElementById('death-by').textContent;
              document.getElementById('btn-release').click(); H.simulate(0.5);
              return { dead, by, alive: P.alive, dive: !!P.dive, errors: H.errors.slice(0, 3) }; })()""")
            check(r['dead'] and 'drowning' in r['by'] and r['alive'] and not r['dive'], 'a diver who stays down drowns, and rises again on release (%s)' % r['by'])

            r = await ev(page, 'current', """(() => { const H = __hm, Wt = H.water, D = Wt.dive, P = H.GAME.player; W2.safe();
              let best = null;
              for (const Rv of Wt.RIVERS) for (const q of Rv.pts) { const w = Wt.waterAt(q.x, q.z); if (w && w.depth > 2.0 && Math.hypot(w.fx, w.fz) > 0.4 && (!best || w.depth > best.depth)) best = { x: q.x, z: q.z, depth: w.depth, fx: w.fx, fz: w.fz }; }
              if (!best) return { none: true };
              W2.swimAt(best.x, best.z); P.breath = 1; const ok = D.start(); H.CAM.pitch = 1.2; W2.keys(['KeyW'], 0.6);
              const x0 = P.x, z0 = P.z; H.CAM.pitch = 0.32; W2.keys(['Space'], 0.01); H.simulate(2.0);
              const f = Math.hypot(best.fx, best.fz), along = ((P.x - x0) * best.fx + (P.z - z0) * best.fz) / f;
              return { best, ok, along, dive: !!P.dive, errors: H.errors.slice(0, 3) }; })()""")
            check(not r.get('none') and r['along'] > 0.6, 'the current carries a diver downstream (%.2f m in 2 s, depth %.1f)' % (r.get('along', 0), r.get('best', {}).get('depth', 0)))

            r = await ev(page, 'nodive', """(() => { const H = __hm, Wt = H.water, D = Wt.dive, P = H.GAME.player;
              const s = W2.lakeSpot(0, 1.3, 1.7); const st = W2.swimAt(s.x, s.z); const why1 = D.whyNot();
              H.teleport(s.x + 200, s.z); H.simulate(0.3); const why2 = D.whyNot();
              return { s, st, why1, why2 }; })()""")
            check(r['why1'] is not None and r['why2'] is not None, 'no diving in shallow water or on land (%s / %s)' % (r['why1'], r['why2']))

        if want('finds'):
            r = await ev(page, 'finds', """(() => { const H = __hm, Wt = H.water, D = Wt.dive, P = H.GAME.player; W2.safe();
              const out = {}; const gold0 = H.INV.gold, bag0 = H.INV.bag.length;
              for (const kind of ['chest', 'blade', 'purse', 'arrow']) {
                const f = D.finds().find((q) => q.kind === kind && !q.taken); if (!f) { out[kind] = null; continue; }
                W2.swimAt(f.x + 1.2, f.z); P.breath = 1; D.start();
                // down beside it
                P.y = f.y + 0.55 - 1.3; H.simulate(0.1);
                const offers = W2.offers(); const label = offers.find((l) => /chest|blade|purse|arrows/.test(l));
                if (label) W2.offer(label);
                const after = D.finds().find((q) => q.id === f.id);
                out[kind] = { depth: +f.depth.toFixed(2), label, taken: after.taken };
                D.end();
              }
              const save = H.fn.savePartsData('world');
              return { out, gold: H.INV.gold - gold0, bag: H.INV.bag.length - bag0, saved: save && save.dive, errors: H.errors.slice(0, 3) }; })()""")
            ok = all(v and v['taken'] and v['label'] for v in r['out'].values())
            check(ok, 'every kind of find is offered to a diver beside it and taken (%s)' % json.dumps(r['out']))
            check(r['gold'] > 0 and r['bag'] >= 2, 'the finds pay: gold %d, %d items' % (r['gold'], r['bag']))
            check(r['saved'] and len(r['saved']['t']) >= 4, 'the world save remembers what was taken (%s)' % r['saved'])

        if want('ice'):
            r = await ev(page, 'ice', """(() => { const H = __hm, Wt = H.water, D = Wt.dive, P = H.GAME.player; W2.safe();
              H.farm.setSeason(0.875); H.seasons.seasonSettle(); H.frame(1 / 60);
              const L = H.dbg.LAKES.find((l) => l.realm === 2);
              let s = null; for (let r = 0; r < 25 && !s; r += 0.5) for (let a = 0; a < 12 && !s; a++) { const x = L.x + Math.cos(a) * r, z = L.z + Math.sin(a) * r, w = Wt.waterAt(x, z); if (w && w.depth > 3 && H.seasons.ice(x, z).thick > 0.5) s = { x, z }; }
              if (!s) return { none: true, frozen: H.seasons.frozen() };
              H.teleport(s.x, s.z); P.y = H.seasons.ice(s.x, s.z).y; H.simulate(0.5); const onIce = { y: P.y, swim: !!P.swim };
              const offers = W2.offers(); const cut = W2.offer('Cut a hole');
              H.simulate(3.2); const holes = D.DIVE.holes.length, hole = D.DIVE.holes[0];
              // into the hole: down into the water and under
              H.teleport(hole.x, hole.z); H.simulate(1.0); const inHole = Wt.state(P.id);
              P.breath = 1; const why = D.whyNot(); D.start(); H.CAM.pitch = 1.1; W2.keys(['KeyW'], 1.2);
              // away from the hole under the ice, then let go: the ice holds the diver down
              H.CAM.pitch = 0.32; H.CAM.yaw = Math.atan2(L.x - hole.x, L.z - hole.z) + 1.2; W2.keys(['KeyW'], 2.5);
              const away = D.state(); H.simulate(4); const under = D.state();
              const hp0 = P.hp; P.breath = 0.02; H.simulate(4); const hp1 = P.hp;
              // back to the hole: up and out
              P.breath = 1; P.x = hole.x; P.z = hole.z; let t = 0; while (P.dive && t < 15) { H.simulate(0.25); t += 0.25; }
              const out = D.state();
              return { s, onIce, offers, cut, holes, inHole, why, away, under, hp0, hp1, out, t, errors: H.errors.slice(0, 3) }; })()""")
            if r.get('none'):
                check(False, 'a frozen deep spot in Thule\'s lake (%s)' % r)
            else:
                check(not r['onIce']['swim'] and 'Cut a hole in the ice' in r['offers'] and r['holes'] >= 1, 'on thick ice a hole can be cut (%s)' % r['offers'])
                check(r['inHole']['swim'] and r['why'] is None, 'the hole drops you into the water, and you can dive through it')
                check(r['under']['dive'] and r['under']['pivot'] <= r['under']['surf'] - 0.4, 'away from the hole the ice holds a diver under (body %.2f, surface %.2f)' % (r['under']['pivot'], r['under']['surf']))
                check(r['hp1'] < r['hp0'], 'under the ice without breath the water harms (%d -> %d)' % (r['hp0'], r['hp1']))
                check(not r['out']['dive'], 'at the hole the diver comes up (%.1f s)' % r['t'])
            await ev(page, 'summer', "(() => { __hm.farm.setSeason(0.42); __hm.seasons.seasonSettle(); __hm.frame(1/60); return __hm.seasons.frozen(); })()")

        if want('boats'):
            r = await ev(page, 'board', """(() => { const H = __hm, Wt = H.water, Bt = Wt.boats, P = H.GAME.player; W2.safe();
              const J = Bt.jetties()[0]; const i = Bt.list().findIndex((q) => q.realm === J.realm && q.home && q.st === 'moored');
              const B0 = Bt.state(i);
              // walk out along the jetty to the boat
              H.teleport(J.land.x, J.land.z); H.simulate(0.3);
              P.x = J.end.x; P.z = J.end.z; P.y = J.deck; H.simulate(0.3); const onDeck = { y: P.y, deck: J.deck, swim: !!P.swim };
              const offers = W2.offers(); const ok = W2.offer('Untie the boat');
              const S1 = Bt.state(i);
              return { J, i, B0, onDeck, offers, ok, S1, inBoat: P.boat ? P.boat.id : null, seat: P.seat, errors: H.errors.slice(0, 3) }; })()""")
            check(abs(r['onDeck']['y'] - r['J']['deck']) < 0.1 and not r['onDeck']['swim'], 'the jetty\'s deck carries the player over the water (y %.2f, deck %.2f)' % (r['onDeck']['y'], r['J']['deck']))
            check(r['ok'] and r['inBoat'] == r['S1']['id'] and r['S1']['rider'] is not None, 'E steps into a moored boat (%s)' % r['offers'])
            bi = r['i']
            r = await ev(page, 'row', """((i) => { const H = __hm, Wt = H.water, Bt = Wt.boats, P = H.GAME.player;
              // out on the open lake (the berth's boat faces the shore)
              const B = Wt.boats.BOATS.list[i], L = H.dbg.LAKES.find((l) => l.realm === B.realm); B.x = L.x; B.z = L.z; B.vx = B.vz = B.wr = 0;
              const s0 = Bt.state(i); H.CAM.yaw = s0.yaw;
              W2.keys(['KeyA'], 1.0); const s1 = Bt.state(i);
              const x0 = s1.x, z0 = s1.z; W2.keys(['KeyW'], 6); const s2 = Bt.state(i);
              const act = H.fn.getEnt(P.id) ? Wt.dive.state().act : null;
              // glide: she runs on after the oars stop
              const sp0 = s2.sp; H.simulate(1.5); const s3 = Bt.state(i);
              const yaw0 = s3.yaw; W2.keys(['KeyD'], 2.5); const s4 = Bt.state(i);
              return { s0, s1, s2, s3, s4, moved: Math.hypot(s2.x - x0, s2.z - z0), act, sp0, turned: s4.yaw - yaw0, pY: P.y, seatY: P.seat && P.seat.y, errors: H.errors.slice(0, 3) }; })(%d)""" % bi)
            check(r['moved'] > 4 and r['s2']['sp'] > 1.0, 'rowing moves the boat (%.1f m in 6 s, %.2f m/s)' % (r['moved'], r['s2']['sp']))
            check(r['act'] is not None and 16 <= r['act'] < 17, 'the rower pulls with the oars\' stroke (action %s)' % r['act'])
            check(r['s3']['sp'] > 0.2 and r['s3']['sp'] < r['sp0'], 'she glides on and slows (%.2f -> %.2f m/s)' % (r['sp0'], r['s3']['sp']))
            check(r['turned'] < -0.3, 'D turns her to starboard (%.2f rad)' % r['turned'])
            r = await ev(page, 'aground', """((i) => { const H = __hm, Wt = H.water, Bt = Wt.boats, P = H.GAME.player;
              // head for the nearest shore and row hard: she grounds there and goes no further
              const s = Bt.state(i); let best = null;
              for (let a = 0; a < 32; a++) { const ang = a / 32 * Math.PI * 2; for (let r = 1; r < 60; r += 0.5) { const w = Wt.waterAt(s.x + Math.sin(ang) * r, s.z + Math.cos(ang) * r); if (!w) { if (!best || r < best.r) best = { r, ang }; break; } } }
              const B = Wt.boats.BOATS.list[i]; B.yaw = best.ang; B.vx = B.vz = B.wr = 0; H.CAM.yaw = best.ang;
              W2.keys(['KeyW'], Math.min(30, best.r / 1.2 + 6));
              const s2 = Bt.state(i); const land = Wt.waterAt(s2.x + Math.sin(s2.yaw) * 2.6, s2.z + Math.cos(s2.yaw) * 2.6);
              const hit = Bt.hit(i); const offers = W2.offers();
              const ashore = W2.offer('Step ashore'); const after = { boat: !!P.boat, swim: !!P.swim, x: P.x, z: P.z, walk: H.fn.isWalkable(P.x, P.z) };
              return { best, s2, ground: s2.grounded, landAhead: !land, hit, offers, ashore, after, centreWater: !!Wt.waterAt(s2.x, s2.z), errors: H.errors.slice(0, 3) }; })(%d)""" % bi)
            # (rowed into the shore at a slant she rubs along it: grounded is 1 at each touch and fades between them)
            check(r['ground'] > 0.3 and r['landAhead'] and r['centreWater'], 'rowed at the shore she runs aground and stays afloat (grounded %.2f)' % r['ground'])
            check(r['ashore'] and not r['after']['boat'] and not r['after']['swim'], 'the rower steps ashore (%s)' % r['offers'])
            r = await ev(page, 'nocross', """((i) => { const H = __hm, Wt = H.water, Bt = Wt.boats, P = H.GAME.player;
              // no boat crosses land: try to move her through the shore by brute force
              const B = Wt.boats.BOATS.list[i]; let crossed = 0; for (let k = 0; k < 200; k++) { B.vx += Math.sin(B.yaw) * 0.4; B.vz += Math.cos(B.yaw) * 0.4; Bt.phys(i, 0.05, 1, 0); if (!Wt.waterAt(B.x, B.z)) crossed++; }
              return { crossed, s: Bt.state(i) }; })(%d)""" % bi)
            check(r['crossed'] == 0, 'a boat cannot be pushed over land (%d steps on land)' % r['crossed'])
            r = await ev(page, 'river', """(() => { const H = __hm, Wt = H.water, Bt = Wt.boats, P = H.GAME.player; W2.safe();
              // a free boat in a river runs downstream with the current
              let best = null;
              for (const Rv of Wt.RIVERS) for (const q of Rv.pts) { const w = Wt.waterAt(q.x, q.z); if (w && w.depth > 1.3 && Math.hypot(w.fx, w.fz) > 0.5 && (!best || Math.hypot(w.fx, w.fz) > best.f)) best = { x: q.x, z: q.z, f: Math.hypot(w.fx, w.fz), fx: w.fx, fz: w.fz, ux: q.ux, uz: q.uz }; }
              const i = Bt.list().findIndex((q) => !q.home && q.st === 'beached');
              const B = Wt.boats.BOATS.list[i]; B.x = best.x; B.z = best.z; B.yaw = Math.atan2(best.fx, best.fz); B.st = 'free'; B.grounded = 0; B.vx = B.vz = 0;
              const x0 = B.x, z0 = B.z; const hit0 = Bt.hit(i);
              for (let k = 0; k < 60; k++) H.simulate(0.05);
              const along = ((B.x - x0) * best.fx + (B.z - z0) * best.fz) / best.f;
              return { best, i, hit0, along, st: Bt.state(i), errors: H.errors.slice(0, 3) }; })()""")
            check(r['along'] > 1.0, 'a river carries a boat downstream (%.1f m in 3 s, %s)' % (r['along'], r['hit0']))
            r = await ev(page, 'hull', """((i) => { const H = __hm, Wt = H.water, Bt = Wt.boats, P = H.GAME.player; W2.safe();
              // a hull is solid: a swimmer goes round it, a boat under way shoulders a swimmer aside, a diver under it comes up against its keel
              if (P.boat) Bt.leave();
              const B = Wt.boats.BOATS.list[i]; const s = W2.lakeSpot(B.realm, 3.0); B.x = s.x; B.z = s.z; B.vx = B.vz = B.wr = 0; B.st = 'free'; B.grounded = 0; H.simulate(0.1);
              const q = () => { const c = Math.cos(B.yaw), sn = Math.sin(B.yaw), dx = P.x - B.x, dz = P.z - B.z, lx = dx * c - dz * sn, lz = dx * sn + dz * c; return (lx * lx) / (0.68 * 0.68) + (lz * lz) / (2.15 * 2.15); };
              const c = Math.cos(B.yaw), sn = Math.sin(B.yaw), m = H.UI.modal; H.UI.modal = null;
              W2.swimAt(B.x + c * 4, B.z - sn * 4); const yaw0 = B.yaw;
              let q1 = 99; for (let t = 0; t < 7; t += 0.05) { H.CAM.yaw = Math.atan2(B.x - P.x, B.z - P.z); H.CAM.pitch = 0.3; H.INPUT.keys.add('KeyW'); H.simulate(0.05, 0.05); B.x = s.x; B.z = s.z; B.yaw = yaw0; B.vx = B.vz = B.wr = 0; q1 = Math.min(q1, q()); }
              H.INPUT.keys.delete('KeyW');
              // she comes on at a swimmer lying still a little off her bow
              const fx = Math.sin(B.yaw), fz = Math.cos(B.yaw);
              W2.swimAt(B.x + fx * 5.5 + c * 0.3, B.z + fz * 5.5 - sn * 0.3); const p0 = { x: P.x, z: P.z };
              let q2 = 99; for (let k = 0; k < 100; k++) { B.vx = fx * 1.3; B.vz = fz * 1.3; B.wr = 0; B.yaw = yaw0; H.simulate(0.05, 0.05); q2 = Math.min(q2, q()); }
              const shoved = Math.hypot(P.x - p0.x, P.z - p0.z), passed = ((B.x - s.x) * fx + (B.z - s.z) * fz);
              // a diver below her keel drifting up stays under it
              B.x = s.x; B.z = s.z; B.vx = B.vz = 0; H.simulate(0.1);
              W2.swimAt(B.x + c * 2.6, B.z - sn * 2.6); P.breath = 1; Wt.dive.start(); H.CAM.pitch = 1.25; H.CAM.yaw = 0; H.INPUT.keys.add('KeyW'); for (let t = 0; t < 1.3; t += 0.05) H.simulate(0.05, 0.05); H.INPUT.keys.delete('KeyW');
              P.x = B.x; P.z = B.z; let top = -99; for (let t = 0; t < 4; t += 0.05) { H.simulate(0.05, 0.05); B.x = s.x; B.z = s.z; B.vx = B.vz = 0; top = Math.max(top, Wt.dive.state().pivot); }
              const keel = B.y - 0.24, still = Wt.dive.state().dive;
              Wt.dive.end(); H.UI.modal = m;
              return { q1, q2, shoved, passed, top, keel, still, errors: H.errors.slice(0, 3) }; })(%d)""" % bi)
            check(r['q1'] >= 1.0, 'a swimmer swimming at a boat goes round her hull, not through it (closest %.2f of the hull)' % r['q1'])
            check(r['q2'] >= 1.0 and r['shoved'] > 0.5 and r['passed'] > 3, 'a boat under way shoulders a still swimmer aside (%.1f m, closest %.2f)' % (r['shoved'], r['q2']))
            check(r['still'] and r['top'] < r['keel'] - 0.3, 'a diver drifting up under a boat stays below her keel (body %.2f, keel %.2f)' % (r['top'], r['keel']))
            r = await ev(page, 'moor', """((i) => { const H = __hm, Wt = H.water, Bt = Wt.boats, P = H.GAME.player; W2.safe();
              // back to the jetty and tie her up
              const J = Bt.jetties()[0], b = J.berths[0]; const B = Wt.boats.BOATS.list[i];
              const ds = W2.lakeSpot(J.realm, 2.5); B.x = ds.x; B.z = ds.z; B.vx = B.vz = 0; B.st = 'free'; B.grounded = 0; W2.swimAt(ds.x + Math.cos(B.yaw) * 1.6, ds.z - Math.sin(B.yaw) * 1.6); const into = W2.offer('Climb into the boat');
              B.x = b.x - Math.sin(b.yaw) * 2.5; B.z = b.z - Math.cos(b.yaw) * 2.5; B.yaw = b.yaw; B.vx = B.vz = 0; H.simulate(0.2);
              const offers = W2.offers(); const tied = W2.offer('Tie the boat up');
              return { into, offers, tied, st: Bt.state(i), boat: !!P.boat, py: P.y, deck: J.deck, errors: H.errors.slice(0, 3) }; })(%d)""" % bi)
            check(r['into'] and r['tied'] and r['st']['st'] == 'moored' and not r['boat'] and abs(r['py'] - r['deck']) < 0.2, 'climbed in from the water, she is tied up at the jetty and you stand on its deck (%s)' % r['offers'])
            r = await ev(page, 'fish', """((i) => { const H = __hm, Wt = H.water, Bt = Wt.boats, P = H.GAME.player, S = H.surv; W2.safe();
              H.fn.goodsAdd('tool_rod', 1, true);
              Bt.board(i); const B = Wt.boats.BOATS.list[i]; H.CAM.yaw = B.yaw; W2.keys(['KeyS'], 2); W2.keys(['KeyA'], 2.5); W2.keys(['KeyW'], 6);
              const offers = W2.offers(); let fishOffer = null; S.survivalOffers ? S.survivalOffers(P, (d, r, label, act) => { if (d < r && label === 'Fish here') fishOffer = act; }) : null;
              if (fishOffer) fishOffer();
              const x0 = B.x; H.simulate(6); const fishing = !!S.SURV.fish, drift = Math.hypot(B.x - x0, 0);
              if (S.SURV.fish) S.fishStop ? S.fishStop(null) : null;
              return { offers, fishOffer: !!fishOffer, fishing, drift, errors: H.errors.slice(0, 3) }; })(%d)""" % bi)
            check(r['fishOffer'] and r['fishing'], 'you can fish from a boat (%s)' % r['offers'])
            r = await ev(page, 'burn', """((i) => { const H = __hm, Wt = H.water, Bt = Wt.boats, P = H.GAME.player; W2.safe();
              const B = Wt.boats.BOATS.list[i]; const inBoat = !!P.boat;
              Bt.ignite(i); const out = { inBoat, after: !!P.boat, swim: !!P.swim };
              for (let k = 0; k < 120 && B.st === 'burning'; k++) H.simulate(1); // [weather2] (a shower over the jetty slows the fire: wait for it, not 50 s)
              out.st = B.st; out.char = B.char;
              // rebuild: planks and a hammer, a few seconds' work
              H.fn.goodsAdd('plank', 6, true); H.fn.goodsAdd('tool_hammer', 1, true);
              W2.swimAt(B.x + 1.6, B.z); const near = W2.offers();
              const lab = near.find((l) => l.startsWith('Rebuild')); if (lab) W2.offer('Rebuild');
              H.simulate(7); out.offer = lab; out.st2 = B.st; out.char2 = B.char; out.planks = H.fn.goodsCount('plank');
              out.errors = H.errors.slice(0, 3); return out; })(%d)""" % bi)
            check(r['inBoat'] and not r['after'], 'a boat set alight throws its rower into the water')
            check(r['st'] == 'burnt' and r['char'] >= 1, 'the boat burns out (%s, char %.2f)' % (r['st'], r['char']))
            check(r['offer'] and r['st2'] in ('free', 'moored') and r['char2'] == 0 and r['planks'] == 0, 'a burnt boat is rebuilt with planks and a hammer (%s -> %s)' % (r['offer'], r['st2']))

        if want('fisher'):
            r = await ev(page, 'fisher', """(() => { const H = __hm, Wt = H.water, Bt = Wt.boats, P = H.GAME.player; W2.safe();
              const R = H.REALMS[0], J = Bt.jetties()[0];
              for (const B of Wt.boats.BOATS.list) if (B.home) Bt.restore(Wt.boats.BOATS.list.indexOf(B));
              H.teleport(J.land.x - 6, J.land.z - 6); H.setTod(2.8);
              const t0 = H.GAME.t; let fisher = null, out = null, track = [];
              for (let k = 0; k < 420; k++) { H.simulate(0.5); const jj = Bt.jetties()[0]; if (jj.fisher != null && fisher == null) fisher = jj.fisher;
                const e = fisher != null ? H.fn.getEnt(fisher) : null; const F = e && e.ai.fisher;
                if (k % 20 === 0) track.push([Math.round(H.GAME.t - t0), F ? F.st : null]);
                if (F && F.st === 'fish') { out = { st: F.st, boat: Bt.state(Wt.boats.BOATS.list.indexOf(F.B)), e: { x: e.x, z: e.z, y: e.y, fishing: !!e.fishing } }; break; } }
              // the line comes in: back to the jetty, the catch into the town's stores
              const g0 = H.farm.FARM.granary.fish_raw || 0; let home = null;
              const e = fisher != null ? H.fn.getEnt(fisher) : null;
              if (e && e.ai.fisher) { e.ai.fisher.dur = 0; for (let k = 0; k < 300 && e.ai.fisher; k++) { H.simulate(0.5); if (e.ai.fisher && e.ai.fisher.st === 'ashore' && !home) home = { t: k * 0.5, boat: Bt.state(Wt.boats.BOATS.list.indexOf(e.ai.fisher.B)).st }; } }
              const g1 = H.farm.FARM.granary.fish_raw || 0;
              H.setTod(0.45);
              return { fisher, out, track, home, g0, g1, errors: H.errors.slice(0, 3) }; })()""")
            check(r['fisher'] is not None and r['out'] is not None, 'a townsman rows out to fish in the morning (%s)' % r['track'])
            check(r['home'] is not None and r['home']['boat'] == 'moored' and r['g1'] > r['g0'], 'and rows back, ties up and brings the catch to the stores (%s, fish %d -> %d)' % (r['home'], r['g0'], r['g1']))

        if want('tracks'):
            r = await ev(page, 'snowtracks', """(() => { const H = __hm, Wt = H.water, T = Wt.tracks, P = H.GAME.player; W2.safe();
              H.farm.setSeason(0.875); H.seasons.seasonSettle(); H.frame(1 / 60);
              // Thule's town in the snow
              const R = H.REALMS[2]; H.teleport(R.town.x + 30, R.town.z + 30); H.simulate(0.3);
              let x = P.x, z = P.z; for (let k = 0; k < 40 && T.surface(P.x, P.z) !== 0; k++) { H.teleport(R.town.x + 30 + k * 3, R.town.z + 30); H.simulate(0.05); }
              const surf = T.surface(P.x, P.z); const laid0 = T.TRACKS.laid;
              H.camera.position.set(P.x, P.y + 6, P.z - 6); H.CAM.yaw = 0.5; W2.keys(['KeyW'], 4);
              const prints = T.prints(P.x, P.z, 20); const laid = T.TRACKS.laid - laid0;
              const one = prints[prints.length - 1]; const show0 = one ? T.shows(one.i) : null;
              // snow falls: they fill
              H.dbg.WEATHER.snowing = 1; H.simulate(20); H.dbg.WEATHER.snowing = 0; const show1 = one ? T.shows(one.i) : null;
              return { surf, laid, kinds: [...new Set(prints.map((q) => q.kind))], surfs: [...new Set(prints.map((q) => q.surf))], show0, show1, errors: H.errors.slice(0, 3) }; })()""")
            check(r['surf'] == 0 and r['laid'] >= 6 and r['surfs'] == [0], 'walking in lying snow leaves boot prints (%d laid)' % r['laid'])
            check(r['show0'] is not None and r['show0'] > 0.95 and r['show1'] < 0.5, 'falling snow fills the prints in (%.2f -> %.2f)' % (r['show0'] or 0, r['show1'] or 0))
            r = await ev(page, 'mudtracks', """(() => { const H = __hm, Wt = H.water, T = Wt.tracks, P = H.GAME.player; W2.safe();
              H.farm.setSeason(0.42); H.seasons.seasonSettle(); H.frame(1 / 60);
              const R = H.REALMS[0]; H.teleport(R.town.x + 60, R.town.z + 40); H.simulate(0.3);
              H.dbg.WEATHER.wet = 0.9; H.dbg.U.uWet.value = 0.9; H.dbg.WEATHER.raining = 0.6;
              const surf = T.surface(P.x, P.z); const laid0 = T.TRACKS.laid; H.CAM.yaw = 2.0; W2.keys(['KeyW'], 3);
              H.dbg.WEATHER.raining = 0; const prints = T.prints(P.x, P.z, 20).filter((q) => q.surf === 1); const one = prints[prints.length - 1];
              const s0 = one ? T.shows(one.i) : null; H.dbg.WEATHER.wet = 0; H.dbg.U.uWet.value = 0; H.simulate(240); const s1 = one ? T.shows(one.i) : null;
              // a later print laid on an earlier one cuts it
              const cut0 = T.TRACKS.cut; const a = T.lay(P.x + 5, P.z + 5, 0, 0, 0.3, 1, 1); const bb = T.lay(P.x + 5.03, P.z + 5.05, 0.3, 2, 0.12, 1, 1);
              const cut = T.TRACKS.cut - cut0, aShows = T.shows(a);
              return { surf, laid: T.TRACKS.laid - laid0, n: prints.length, s0, s1, cut, aShows, errors: H.errors.slice(0, 3) }; })()""")
            check(r['surf'] == 1 and r['n'] >= 4, 'in the mud after rain the player leaves prints (%d)' % r['n'])
            check(r['s0'] is not None and r['s0'] > 0.9 and r['s1'] < 0.2, 'mud prints dry away in fine weather (%.2f -> %.2f)' % (r['s0'] or 0, r['s1'] or 0))
            check(r['cut'] >= 1 and r['aShows'] == 0, 'a later print cuts an earlier one')
            r = await ev(page, 'beasts', """(() => { const H = __hm, Wt = H.water, T = Wt.tracks, P = H.GAME.player;
              // a wolf and a rider in the snow: paws and hooves
              H.farm.setSeason(0.875); H.seasons.seasonSettle(); H.frame(1 / 60);
              const R = H.REALMS[2]; let s = null; for (let k = 0; k < 60 && !s; k++) { const x = R.town.x + 40 + k * 2, z = R.town.z - 20; if (T.surface(x, z) === 0 && H.fn.isWalkable(x, z)) s = { x, z }; }
              H.teleport(s.x, s.z); H.simulate(0.2);
              const wolf = H.fn.makeEnt({ kind: 'wolf', faction: H.FACTION_NEUTRAL, role: 'critter', name: 'wolf', level: 5, x: s.x + 3, z: s.z, y: H.fn.heightAt(s.x + 3, s.z), look: { colA: [0.4, 0.4, 0.4], colB: [0.3, 0.3, 0.3] }, home: { x: s.x + 3, z: s.z, r: 8 } });
              H.fn.setupStats(wolf); wolf.fixedY = null;
              const kinds = new Set(); const laid0 = T.TRACKS.laid;
              // the wolf trots along beside the player (its own think is held: it is moved by hand)
              for (let k = 0; k < 60; k++) { wolf.x += 0.15; wolf.ai.think = 99; H.simulate(0.05); }
              H.fn.mountUp(P, true); W2.keys(['KeyW'], 1.5); H.fn.dismount(P);
              const A = T.TRACKS.mesh.geometry.attributes; for (let i = 0; i < T.TRACKS.n; i++) if (A.iK.array[i * 4 + 3] > 0) kinds.add(A.iK.array[i * 4]);
              H.fn.removeEnt(wolf);
              return { kinds: [...kinds], laid: T.TRACKS.laid - laid0, errors: H.errors.slice(0, 3) }; })()""")
            check(2 in r['kinds'] and 1 in r['kinds'], 'paws and hooves leave their own prints (%s)' % r['kinds'])
            r = await ev(page, 'sand', """(() => { const H = __hm, Wt = H.water, T = Wt.tracks, P = H.GAME.player;
              H.farm.setSeason(0.42); H.seasons.seasonSettle(); H.dbg.WEATHER.wet = 0; H.dbg.U.uWet.value = 0; H.dbg.WEATHER.raining = 0; H.frame(1 / 60);
              const L = H.dbg.LAKES[0]; let s = null;
              for (let a = 0; a < 24 && !s; a++) { const dx = Math.cos(a / 24 * 6.28), dz = Math.sin(a / 24 * 6.28); for (let r = 5; r < 60; r += 0.25) { if (!Wt.waterAt(L.x + dx * r, L.z + dz * r)) { const x = L.x + dx * (r + 0.6), z = L.z + dz * (r + 0.6); if (T.surface(x, z) === 2) s = { x, z }; break; } } }
              return { s, surf: s ? T.surface(s.x, s.z) : null }; })()""")
            check(r['s'] is not None, 'the wet sand at the water\'s edge takes prints')
            r = await ev(page, 'drifts', """(() => { const H = __hm, Wt = H.water, T = Wt.tracks, P = H.GAME.player;
              H.farm.setSeason(0.875); H.seasons.seasonSettle(); const R = H.REALMS[2]; H.teleport(R.town.x, R.town.z + 10); H.simulate(0.3); for (let i = 0; i < 20; i++) H.frame(1 / 30);
              const on = T.drifts(); H.farm.setSeason(0.42); H.seasons.seasonSettle(); const Rl = H.REALMS[0]; H.teleport(Rl.town.x, Rl.town.z + 10); H.simulate(0.3); for (let i = 0; i < 20; i++) H.frame(1 / 30); const off = T.drifts();
              return { on, off }; })()""")
            check(r['on']['visible'] > 0 and r['off']['visible'] == 0, 'drifts show where snow lies and not in the summer (%s / %s)' % (r['on'], r['off']))

        r = await ev(page, 'errors', "__hm.errors.slice(0, 5)")
        check(not r, 'no runtime errors')
        if SHOTS:
            await shots(page)
        await b.close()
    print('FAILS', FAILS, flush=True)

async def snap(page, name):
    # one frame rendered and read straight off the canvas (a page screenshot waits on the compositor, which under
    # SwiftShader on a busy machine can take longer than any timeout)
    import base64
    url = await page.evaluate("(() => { __hm.frame(1 / 30); __hm.frame(1 / 30); return __hm.dbg.renderer.domElement.toDataURL('image/png'); })()")
    pathlib.Path(OUT + name).write_bytes(base64.b64decode(url.split(',', 1)[1]))
    print('  shot', OUT + name, f'[{time.time() - T0:.0f}s]', flush=True)

async def shots(page):
    await page.evaluate("(() => { window.requestAnimationFrame = () => 0; __hm.dbg.WEATHER.mode = 'clear'; __hm.dbg.WEATHER.wet = 0; __hm.dbg.U.uWet.value = 0; __hm.setTod(0.45); return 0; })()")
    q = 'medium' if 'medium' in sys.argv else 'high'
    await page.evaluate("__hm.fn.setQuality('%s')" % q)
    await page.evaluate("(() => { __hm.farm.setSeason(0.42); __hm.seasons.seasonSettle(); return 0; })()")
    if want_shot('under'):
        # 1. under the water: the diver from behind and below, the surface overhead
        await ev(page, 'shot-under', """(() => { const H = __hm, Wt = H.water, D = Wt.dive, P = H.GAME.player; W2.safe(); W2.play();
          const s = W2.lakeSpot(0, 3.1); W2.swimAt(s.x, s.z); P.breath = 1; D.start(); H.CAM.yaw = 0.8; H.CAM.pitch = 0.9; W2.keys(['KeyW'], 1.4); H.CAM.pitch = 0.32; W2.keys(['KeyW'], 1.0);
          H.CAM.pitch = -0.2; H.CAM.dist = H.CAM.targetDist = 4.2; W2.fishInView(); for (let i = 0; i < 6; i++) H.frame(1 / 30);
          return { st: D.state(), under: D.under() }; })()""")
        await snap(page, 'water2_under.png')
        await ev(page, 'shot-under2', """(() => { const H = __hm, P = H.GAME.player; H.CAM.pitch = 0.75; H.CAM.yaw += 2.2; W2.fishInView(); for (let i = 0; i < 4; i++) H.frame(1 / 30); return __hm.water.dive.under(); })()""")
        await snap(page, 'water2_under_bed.png')
    if want_shot('boat'):
        # 2. a boat on the lake, rowed
        await ev(page, 'shot-boat', """(() => { const H = __hm, Wt = H.water, Bt = Wt.boats, P = H.GAME.player; Wt.dive.end(); W2.safe();
          const J = Bt.jetties()[0]; const i = Bt.list().findIndex((q) => q.home && q.realm === J.realm); Bt.restore(i);
          W2.swimAt(Bt.state(i).x + 1.5, Bt.state(i).z); Bt.board(i); const B = Wt.boats.BOATS.list[i]; H.CAM.yaw = B.yaw;
          W2.keys(['KeyS'], 3); W2.keys(['KeyA'], 2.5); W2.keys(['KeyW'], 5); for (let k = 0; k < 12; k++) { W2.keys(['KeyW'], 0.05); Wt.tickWater(1 / 30); }
          const s = Bt.state(i), fx = Math.sin(s.yaw), fz = Math.cos(s.yaw);
          W2.cam([s.x + fz * 5.5 + fx * 3, s.y + 2.6, s.z - fx * 5.5 + fz * 3], [s.x, s.y + 0.4, s.z]); H.frame(1 / 30);
          return s; })()""")
        await snap(page, 'water2_boat_lake.png')
    if want_shot('river'):
        # 3. a boat on a river, carried down
        await ev(page, 'shot-river', """(() => { const H = __hm, Wt = H.water, Bt = Wt.boats, P = H.GAME.player; W2.play(); Bt.leave(); W2.safe();
          let best = null; for (const Rv of Wt.RIVERS) for (const q of Rv.pts) { const w = Wt.waterAt(q.x, q.z); if (w && w.depth > 1.4 && Math.hypot(w.fx, w.fz) > 0.5 && (!best || w.depth > best.d)) best = { x: q.x, z: q.z, d: w.depth, fx: w.fx, fz: w.fz, hw: q.hw }; }
          const i = Bt.list().findIndex((q) => !q.home); const B = Wt.boats.BOATS.list[i]; B.x = best.x; B.z = best.z; B.yaw = Math.atan2(best.fx, best.fz); B.st = 'free'; B.grounded = 0;
          W2.swimAt(B.x + 1.4, B.z); Bt.board(i);
          for (let k = 0; k < 40; k++) { W2.keys(['KeyW'], 0.05); Wt.tickWater(1 / 30); }
          const s = Bt.state(i), fx = Math.sin(s.yaw), fz = Math.cos(s.yaw);
          W2.cam([s.x - fx * 6 + fz * 4, s.y + 3.2, s.z - fz * 6 - fx * 4], [s.x + fx * 1.5, s.y + 0.3, s.z + fz * 1.5]); H.frame(1 / 30);
          return s; })()""")
        await snap(page, 'water2_boat_river.png')
    if want_shot('tracks'):
        # 4. tracks in the snow: a wolf's and the player's
        await ev(page, 'shot-tracks', """(() => { const H = __hm, Wt = H.water, T = Wt.tracks, P = H.GAME.player; W2.play(); Wt.boats.leave(); W2.safe();
          H.farm.setSeason(0.875); H.seasons.seasonSettle();
          const R = H.REALMS[2]; let s = null; for (let k = 0; k < 60 && !s; k++) { const x = R.town.x + 46 + k * 2, z = R.town.z - 24; if (T.surface(x, z) === 0 && H.fn.isWalkable(x, z)) s = { x, z }; }
          H.teleport(s.x, s.z); H.simulate(0.2); H.CAM.yaw = 0.4; for (let k = 0; k < 50; k++) { W2.keys(['KeyW'], 0.06); if (k === 20) H.CAM.yaw = -0.3; }
          const fx = Math.sin(0.4), fz = Math.cos(0.4), g0 = H.fn.heightAt(s.x, s.z);
          W2.cam([s.x - fx * 2.2 + fz * 0.6, g0 + 1.9, s.z - fz * 2.2 - fx * 0.6], [s.x + fx * 3.2, H.fn.heightAt(s.x + fx * 3.2, s.z + fz * 3.2), s.z + fz * 3.2]); H.frame(1 / 30);
          return { s, n: T.prints(s.x, s.z, 15).length }; })()""")
        await snap(page, 'water2_tracks_snow.png')
    if want_shot('drift'):
        # 4b. a drift against the windward wall of a house in Thule's town, in deep winter
        await ev(page, 'shot-drift', """(() => { const H = __hm, Wt = H.water, T = Wt.tracks, P = H.GAME.player; W2.play(); W2.safe();
          H.farm.setSeason(0.875); H.seasons.seasonSettle(); H.dbg.WEATHER.snow = 0;
          const R = H.REALMS[2], wd = H.dbg.U.uWindDir.value; let best = null;
          // a house wall facing into the wind, near the town's middle, with snow lying
          for (const D of T.TRACKS.drifts) { if (Math.hypot(D.x - R.town.x, D.z - R.town.z) > 90) continue; if (!best || Math.hypot(D.x - R.town.x, D.z - R.town.z) < best.d) best = { x: D.x, z: D.z, d: Math.hypot(D.x - R.town.x, D.z - R.town.z) }; }
          if (!best) return null;
          // the drift's own vertices: the one nearest its middle, and which way it faces
          const D = T.TRACKS.drifts.find((q) => q.x === best.x && q.z === best.z), pos = D.m.geometry.attributes.position.array, ad = D.m.geometry.attributes.aD.array;
          let k = 0, bd = 1e9; for (let i = 0; i < pos.length / 3; i++) { if (ad[i * 4 + 1] !== 0) continue; const dd = Math.hypot(pos[i * 3] - best.x, pos[i * 3 + 2] - best.z); if (dd < bd) { bd = dd; k = i; } }
          const fx = pos[k * 3], fz = pos[k * 3 + 2], nx = ad[k * 4 + 2], nz = ad[k * 4 + 3], g = H.fn.heightAt(fx, fz);
          H.teleport(fx + nx * 9, fz + nz * 9); H.simulate(0.3);
          W2.cam([fx + nx * 6.5 - nz * 2.5, g + 2.4, fz + nz * 6.5 + nx * 2.5], [fx, g + 0.4, fz]); for (let i = 0; i < 12; i++) H.frame(1 / 30);
          return { fx, fz, nx, nz, drifts: T.drifts(), lie: H.seasons.lie(fx, fz) }; })()""")
        await snap(page, 'water2_drift.png')
    if want_shot('ice'):
        # 5. under the winter ice, looking up at the hole
        await ev(page, 'shot-ice', """(() => { const H = __hm, Wt = H.water, D = Wt.dive, P = H.GAME.player; W2.play(); W2.safe();
          const L = H.dbg.LAKES.find((l) => l.realm === 2);
          let s = null; for (let r = 0; r < 25 && !s; r += 0.5) for (let a = 0; a < 12 && !s; a++) { const x = L.x + Math.cos(a) * r, z = L.z + Math.sin(a) * r, w = Wt.waterAt(x, z); if (w && w.depth > 3.2 && H.seasons.ice(x, z).thick > 0.5) s = { x, z }; }
          if (!s) return null; D.cutHole(s.x, s.z); H.teleport(s.x, s.z); H.simulate(1.0); P.breath = 1; D.start(); H.CAM.pitch = 1.2; W2.keys(['KeyW'], 1.4);
          H.CAM.pitch = 0.32; H.CAM.yaw = 1.1; W2.keys(['KeyW'], 1.2); H.CAM.pitch = -0.25; H.CAM.yaw += 3.1; H.CAM.dist = H.CAM.targetDist = 3.5; for (let i = 0; i < 6; i++) H.frame(1 / 30);
          return D.state(); })()""")
        await snap(page, 'water2_under_ice.png')
    print('shot errors', json.dumps(await page.evaluate("__hm.errors.slice(0, 3)")))

asyncio.run(main())
