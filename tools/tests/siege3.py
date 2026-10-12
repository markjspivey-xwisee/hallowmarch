"""[siege3] Fire and siege made whole (04g_blaze.js, 04j_rafters.js).
deck: a burh's wall walk catches from the player's fire spell (its own garrison's fire spares it), burns, chars, spreads
along the walk, burns whoever stands on it, burns through (the floor stands down, a body on it falls and is hurt, the
gap is no route), rain puts out a young fire, and it is built back in peace; gate: a burh's gate of planks burns, chars
and falls (its door dies: everyone may pass) and is rebuilt; temple: the timber hallow's gate burns only when exposed;
crew: the garrison sees a fire on its walls and goes to beat it out (leaving its posts), and the player beats flames
out with Use; storm: a band through a fallen gate tower's rubble with nobody stuck (gate broken), and a band of ten
storming each keep kind's tower door against its garrison; roof: a holed roof's shadow and its broken rafters; door:
arrows stuck in a built door swing with it; save: a burning walk, a burnt-through gap and a rebuilding one saved and
loaded. usage: python3 tools/tests/siege3.py [noshots] [only=deck,gate,temple,crew,player,storm,stormcost,roof,door,save,shots] [quality]"""
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

async def shot(page, name, js, q=None):
    if not SHOTS: return
    if 'shots' in OPT and name.replace('siege3_', '') not in OPT['shots'].split(','): return
    if q: await page.evaluate(f"__hm.fn.setQuality('{q}')")
    info = await page.evaluate(js)
    url = await page.evaluate("""(() => { __hm.frame(1/30); const now = __hm.dbg.U.uTime.value;
      for (const P of [__hm.walls.fx.fxAlpha, __hm.walls.fx.fxAdd]) { const a0 = P.a0.array, a1 = P.a1.array; let k = 0;
        for (let i = 0; i < P.max; i++) if (a0[i * 4 + 3] > now + 1e-3 && a1[i * 4 + 3] > 0) { a1[i * 4 + 3] = -1; k++; }
        if (k) { P.dirty0 = 0; P.dirty1 = P.max - 1; } }
      for (let i = 0; i < 7; i++) __hm.frame(1/30); return __hm.dbg.renderer.domElement.toDataURL('image/png'); })()""")
    data = base64.b64decode(url.split(',', 1)[1])
    if Image: Image.open(io.BytesIO(data)).convert('RGB').save(OUT + name + '.png')
    else: pathlib.Path(OUT + name + '.png').write_bytes(data)
    print('  shot', name, json.dumps(info), f'[{time.time() - T0:.0f}s]', flush=True)
    if q: await page.evaluate(f"__hm.fn.setQuality('{QUALITY}')")

HELPERS = r"""
(() => { if (window.__rafWrapped) { window.__rafHold = true; return; } window.__rafWrapped = true; window.__rafHold = true; const raf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = (cb) => raf((t) => { if (window.__rafHold) window.requestAnimationFrame(cb); else cb(t); }); })();
window.T3 = {
  H: __hm, F: __hm.fn, S: __hm.SIEGE, S2: __hm.siege2, Z: __hm.blaze,
  keep(realm, k) { return __hm.WAR.keeps.find((K) => K.orig === realm && K.site === __hm.REALMS[realm].keepSites[k]); },
  C(K) { return this.F.castleOf(K.site); },
  until(fn, max, step = 0.5) { let t = 0; while (t < max && !fn()) { this.H.simulate(step); t += step; } return t; },
  quiet() {
    const H = this.H;
    for (const e of H.ENT.slice()) if (e.role === 'soldier') this.F.removeEnt(e);
    for (const w of H.WAR.warbands) w.dead = true;
    H.WAR.commanders.forEach((C) => { C.nextThink = 1e9; C.nextSpawn = 1e9; });
    for (const E of this.S.SIEGE.engines.slice()) this.S.siegeRemove(E);
    H.simulate(0.2);
  },
  dry() { const Wt = __hm.dbg.WEATHER; Wt.mode = 'fixed'; Wt.kind = 'clear'; Wt.raining = 0; Wt.snowing = 0; Wt.wet = 0; Wt.snow = 0; Wt.next = 1e9; __hm.dbg.U.uWet.value = 0; __hm.dbg.U.uSnowCover.value = 0; },
  rain() { const Wt = __hm.dbg.WEATHER; Wt.mode = 'fixed'; Wt.kind = 'rain'; Wt.raining = 1; Wt.snowing = 0; Wt.wet = 1; Wt.next = 1e9; __hm.dbg.U.uWet.value = 1; },
  away() { const P = this.H.GAME.player, S = this.H.REALMS[P.faction].town; P.x = P.prevX = S.x + 3; P.z = P.prevZ = S.z + 3; P.y = this.F.heightAt(P.x, P.z); P.hp = P.maxHp = 1e7; },
  clearGarrison(K) { for (const id of [...K.guards]) { const g = this.F.getEnt(id); if (g) this.F.removeEnt(g); } K.guards.clear(); K.nextGuardAt = 1e9; },
  dummy(realm, x, z) { const e = this.F.spawnRealmUnit(realm, 'warrior', 30, 'guard', x, z, {}); e.role = 'dummy'; e.hp = e.maxHp = 1e9; e.ai.post = { x, z, leash: 0 }; return e; },
  cam(x, y, z, tx, ty, tz) { const H = this.H; H.UI.modal = 'menu'; H.CAM.mode = 'fixed'; const hud = document.getElementById('hud'); if (hud) hud.style.visibility = 'hidden'; H.camera.position.set(x, y, z); H.camera.lookAt(tx, ty, tz); H.camera.updateMatrixWorld(); },
  burh(k = 0) { const K = this.keep(2, k); return { K, C: this.C(K), B: this.C(K).blaze }; },
  cellsOf(B, di) { return B.cells.filter((c) => c.di === di); },
  peace(K) { K.lastEnemyNear = -1e9; },
  tower(K, pred) { return this.C(K).sections.find((W) => W.kind === 'tower' && pred(W.T)); },
  hit(W, src, n) { const T = W.T; for (let i = 0; i < n && W.state === 'whole'; i++) this.F.castleSiegeHit(src, T.wx + W.ox * (T.RO + 0.2), T.wz + W.oz * (T.RO + 0.2), 2.0, 4.4); },
  breakIt(W, src) { let n = 0; while (W.state === 'whole' && n < 80) { this.hit(W, src, 1); n++; } return n; },
  inCourt(C, e) { const S = C.S, dx = e.x - S.x, dz = e.z - S.z, c = Math.cos(S.yaw), s = Math.sin(S.yaw), lx = dx * c - dz * s, lz = dx * s + dz * c; const T = C.kind === 'round' ? lx * lx + lz * lz < 14.5 * 14.5 : Math.abs(lx) < 13 && Math.abs(lz) < 13; return T && !__hm.towers.towerRoomOf(e); },
};
"""

async def deck(page):
    r = await ev(page, 'deck: catch', """(() => { T3.quiet(); T3.away(); T3.dry(); const { K, C, B } = T3.burh(0), out = {}; K.lastEnemyNear = __hm.GAME.t;
      out.cells = B.cells.length; out.decks = C.decks.length; out.floors = B.cells.filter((c) => c.f.active).length;
      // the side walk's middle: a garrison soldier's fire spell spares it, the player's sets it alight
      const side = T3.cellsOf(B, 0), c = side[Math.floor(side.length / 2)], P = __hm.GAME.player;
      const own = __hm.ENT.find((e) => e.alive && e.faction === K.realm && e.role === 'guard');
      out.spared = T3.Z.deckFireAt(c.x, c.y + 0.1, c.z, 1.2, own || { faction: K.realm, role: 'guard' }); out.stSpared = c.st;
      out.lit = T3.Z.deckFireAt(c.x, c.y + 0.1, c.z, 1.2, P); out.st = c.st;
      T3.c = c; T3.B = B; T3.K = K;
      // nobody fights it (no garrison): it burns
      T3.clearGarrison(K);
      __hm.simulate(12);
      out.heat = +c.heat.toFixed(2); out.char = +c.char.toFixed(2); out.fires = c.fires.length;
      out.u = [...C.cutU.uDB.value.slice(0, 3).map((v) => [v.x, v.y, v.z, v.w].map((q) => +q.toFixed(2)))];
      return out; })()""")
    check(r['cells'] >= 30 and r['floors'] == r['cells'], f"deck: the burh's walks are cut into cells with their own floors ({r['cells']} cells on {r['decks']} decks)")
    check(r['spared'] == 0 and r['stSpared'] == 0, "deck: the garrison's own fire spares its walk")
    check(r['lit'] >= 1 and r['st'] == 1, "deck: the player's fire sets the walk alight")
    check(r['heat'] > 0.4 and r['char'] > 0.1 and r['fires'] >= 1, f"deck: it burns and chars with real flames (heat {r['heat']}, char {r['char']}, {r['fires']} flames)")
    # someone on the burning boards is burnt; the fire spreads; it burns through and drops whoever stands there
    r = await ev(page, 'deck: through', """(() => { const c = T3.c, B = T3.B, F = T3.F, out = {};
      const nb = c.nb.find((o) => o.di === c.di) || c.nb[0];
      const v = T3.dummy(0, c.x, c.z); v.y = c.y; v.fixedY = null; v.hp = v.maxHp = 5000; v.ai.post = { x: c.x, z: c.z, leash: 0 };
      const hp0 = v.hp; __hm.simulate(3); out.burnt = hp0 - v.hp > 0;
      // (off the boards while it burns on: it would burn to death standing there), back on just before they give way
      v.x = v.prevX = c.x + 30; v.y = F.heightAt(v.x, v.z);
      T3.until(() => c.t > T3.Z.BZ_T.burn - 2.5 || c.st !== 1, 80, 0.5);
      v.buffs.length = 0; v.hp = v.maxHp; v.x = v.prevX = c.x; v.z = v.prevZ = c.z; v.y = c.y;
      const t = T3.until(() => c.st === 3, 80, 0.25);
      out.t = t; out.st = c.st; out.floor = c.f.active; out.spread = B.cells.filter((q) => q.st === 1 || q.st === 3).length;
      out.y = +(v.y - c.y).toFixed(2); out.fell = T3.Z.BLAZE.stats.fell;
      __hm.simulate(3); out.yAfter = +(v.y - F.heightAt(v.x, v.z)).toFixed(2); out.hurt = v.hp < v.maxHp;
      // a floor no more: floorAt over the gap gives the ground
      out.floorAt = +(F.floorAt(c.x, c.z, c.y + 0.1) - F.heightAt(c.x, c.z)).toFixed(2);
      out.gap = T3.Z.blazeGapOn(c.x - 2, c.z, c.x + 2, c.z, c.y) || T3.Z.blazeGapOn(c.x, c.z - 2, c.x, c.z + 2, c.y);
      out.wreck = !!(c.wreck && c.wreck.visible);
      out.gaps = T3.Z.BLAZE.gaps;
      F.removeEnt(v);
      return out; })()""")
    check(r['burnt'], 'deck: a body on the burning boards is burnt')
    check(r['st'] == 3 and not r['floor'], f"deck: it burns through after {r['t']} s and its floor stands down")
    check(r['fell'] >= 1 and r['yAfter'] < 0.3, f"deck: whoever stood on it falls to the court (fell {r['fell']}, {r['yAfter']} m over the ground)")
    check(r['floorAt'] < 0.3 and r['wreck'], f"deck: nothing stands on air over the gap (floor {r['floorAt']} m over the ground); charred boards lie below")
    check(r['spread'] >= 2, f"deck: the fire spreads along the walk ({r['spread']} cells alight or burnt through)")
    # the routes over the gap are left; then the fire is let burn out and the walk is built back in peace
    r = await ev(page, 'deck: rebuild', """(() => { const B = T3.B, K = T3.K, C = T3.C(K), out = {};
      out.cut = C.posts.map((P, i) => T3.Z.blazeRouteCut(T3.F.castleRoute(K, i)) ? 1 : 0).join('');
      T3.until(() => !B.cells.some((c) => c.st === 1), 200, 1);
      T3.peace(K);
      out.gaps0 = T3.Z.BLAZE.gaps;
      const t = T3.until(() => B.cells.every((c) => c.st !== 3), 400, 2);
      out.t = t; out.gaps = T3.Z.BLAZE.gaps; out.floors = B.cells.filter((c) => c.f.active).length; out.cells = B.cells.length;
      out.fresh = +Math.max(...B.cells.map((c) => c.fresh)).toFixed(2); out.rebuilt = T3.Z.BLAZE.stats.rebuilt;
      return out; })()""")
    check('1' in r['cut'], f"deck: the routes over a burnt-through walk are left ({r['cut']})")
    check(r['gaps'] == 0 and r['floors'] == r['cells'] and r['rebuilt'] >= 1, f"deck: in peace the walk is built back ({r['rebuilt']} cells in {r['t']} s, fresh timber {r['fresh']})")
    # rain puts out a young fire
    r = await ev(page, 'deck: rain', """(() => { const B = T3.B, out = {}; const c = B.cells[3]; const U = __hm.dbg.U;
      T3.Z.deckIgnite(c, 0.12); T3.rain();
      const t = T3.until(() => c.st !== 1, 30, 0.5); out.t = t; out.st = c.st; T3.dry(); return out; })()""")
    check(r['st'] != 1 and r['t'] < 30, f"deck: rain puts out a young fire ({r['t']} s)")

async def gate(page):
    r = await ev(page, 'gate: burn', """(() => { T3.quiet(); T3.away(); T3.dry(); const { K, C } = T3.burh(1), G0 = C.gate, D = K.door, out = {}, F = T3.F; K.lastEnemyNear = __hm.GAME.t;
      T3.clearGarrison(K);
      D.alive || F.setDoorState && 0; out.alive0 = D.alive; out.hp0 = D.hp;
      const P = __hm.GAME.player, p = F.siteToWorld(K.site, 0, G0.gz + 0.6);
      out.lit = T3.Z.gateFireAt(p.x, K.site.y + 1.5, p.z, 1.2, P); out.burning = !!G0.bz.burn;
      __hm.simulate(15); out.char = +G0.bz.char.toFixed(2); out.hp = +(D.hp / D.maxHp).toFixed(2); out.fires = G0.bz.burn ? G0.bz.burn.fires.length : -1;
      out.mat = G0.leaves[0].material.uniforms.uChar ? +G0.leaves[0].material.uniforms.uChar.value.toFixed(2) : null;
      const t = T3.until(() => !D.alive, 90, 0.5); out.t = t; out.alive = D.alive; out.coll = K.site.door.active;
      out.news = __hm.WAR.news.slice(-3).map((n) => n.text); out.wreck = G0.wreck.visible; out.wreckChar = G0.wreck.material.uniforms.uChar ? G0.wreck.material.uniforms.uChar.value : null;
      T3.gK = K; return out; })()""")
    check(r['lit'] >= 1 and r['burning'], "gate: a burh's gate of planks catches from the player's fire")
    check(r['char'] > 0.1 and r['hp'] < 1 and r['fires'] >= 1 and (r['mat'] or 0) > 0.1, f"gate: it burns and chars (char {r['char']}, strength {r['hp']}, {r['fires']} flames)")
    check(not r['alive'] and not r['coll'] and r['wreck'], f"gate: it burns down in {r['t'] + 15} s: everyone may pass, its charred wreck lies in the gateway")
    check(any('burnt down' in n for n in r['news']), f"gate: the news tells it burnt down ({r['news']})")
    r = await ev(page, 'gate: rebuilt', """(() => { const K = T3.gK, C = T3.C(K), G0 = C.gate, D = K.door, out = {}; T3.peace(K); D.deadAt = -1e9;
      const t = T3.until(() => D.alive, 120, 1); __hm.simulate(1); out.t = t; out.alive = D.alive; out.down = G0.bz.down; out.leafMat = G0.leaves[0].material === G0.bz.leafMats[0]; out.wreck = G0.wreck.visible; return out; })()""")
    check(r['alive'] and not r['down'] and r['leafMat'] and not r['wreck'], f"gate: in peace the keep hangs new leaves ({r['t']} s)")

async def temple(page):
    r = await ev(page, 'temple: gate', """(() => { T3.quiet(); T3.away(); T3.dry(); const out = {}, T = __hm.WAR.temples[2], C = T3.C(T), G0 = C.gate, D = T.door, P = __hm.GAME.player, F = T3.F;
      out.has = !!G0.bz; const p = F.siteToWorld(T.site, 0, G0.gz + 0.6);
      T.exposedUntil = -99; for (const K of __hm.WAR.keeps) if (K.orig === 2) K.realm = 2;
      out.shut = T3.Z.gateFireAt(p.x, T.site.y + 1.5, p.z, 1.2, P);
      T.exposedUntil = __hm.GAME.t + 300;
      out.open = T3.Z.gateFireAt(p.x, T.site.y + 1.5, p.z, 1.2, P);
      __hm.simulate(5); out.burning = !!G0.bz.burn; out.char = +G0.bz.char.toFixed(2);
      if (G0.bz.burn) G0.bz.burn.heat = 0; __hm.simulate(1); T.exposedUntil = -99; return out; })()""")
    check(r['has'] and r['shut'] == 0, "temple: the timber hallow's gate holds against fire until its realm has lost a keep")
    check(r['open'] >= 1 and r['burning'], f"temple: once exposed its gate of planks burns (char {r['char']})")

async def crew(page):
    r = await ev(page, 'crew: palisade', """(() => { T3.quiet(); T3.away(); T3.dry(); const { K, C } = T3.burh(0), out = {}, F = T3.F; K.lastEnemyNear = __hm.GAME.t;
      for (const B of T3.Z.BLAZE.list) for (const c of B.cells) if (c.st) { c.st = 0; c.heat = 0; c.char = 0; c.f.active = true; }
      T3.clearGarrison(K); K.nextGuardAt = 0; F.fillGarrison(K, true); __hm.simulate(2);
      const gs = [...K.guards].map(F.getEnt).filter(Boolean); out.guards = gs.length;
      const posts = new Map(gs.map((g) => [g.id, { x: g.x, z: g.z }]));
      // a stretch of the back palisade set alight by an enemy's spell
      __hm.palisade.palisadeInit(); const P = C.pal, c = P.cells.find((q) => q.side === 0 && Math.abs(q.a) < 2);
      __hm.palisade.palisadeIgnite(c, 0.4);
      const crews = T3.Z.BLAZE.stats.crews;
      let t = 0, at = 0; const beaters = new Set();
      while (t < 60 && c.st === 1) { __hm.simulate(0.5); t += 0.5; for (const g of gs) if (g.alive && g.ai.fire) beaters.add(g.id); if (gs.some((g) => g.alive && g.ai.fire && Math.hypot(g.x - c.x, g.z - c.z) < 3.6)) at = at || t; }
      out.t = t; out.st = c.st; out.heat = +c.heat.toFixed(2); out.crews = T3.Z.BLAZE.stats.crews - crews; out.beaters = beaters.size; out.arrived = at;
      out.left = gs.filter((g) => beaters.has(g.id)).map((g) => +Math.hypot(posts.get(g.id).x - c.x, posts.get(g.id).z - c.z).toFixed(1));
      out.doused = __hm.palisade.PAL.stats.doused || 0;
      return out; })()""")
    check(r['crews'] >= 1 and r['beaters'] >= 1, f"crew: the garrison sees the fire on its palisade and sends people to it ({r['beaters']} went, from {r['left']} m)")
    check(r['st'] != 1, f"crew: they beat it out (arrived at {r['arrived']} s, out at {r['t']} s, heat {r['heat']}; doused {r['doused']})")
    r = await ev(page, 'crew: deck', """(() => { const { K, C, B } = T3.burh(0), out = {}, F = T3.F; K.lastEnemyNear = __hm.GAME.t;
      const side = T3.cellsOf(B, 1), c = side[Math.floor(side.length / 2)];
      T3.Z.deckIgnite(c, 0.35);
      let t = 0, at = 0; const beaters = new Set(); const gs = [...K.guards].map(F.getEnt).filter(Boolean);
      while (t < 90 && c.st === 1) { __hm.simulate(0.5); t += 0.5; for (const g of gs) if (g.alive && g.ai.fire) beaters.add(g.id); if (!at && gs.some((g) => g.alive && g.ai.fire && Math.abs(g.y - c.y) < 1 && Math.hypot(g.x - c.x, g.z - c.z) < 2.5)) at = t; }
      out.t = t; out.st = c.st; out.char = +c.char.toFixed(2); out.beaters = beaters.size; out.arrived = at; out.beats = +T3.Z.BLAZE.stats.beats.toFixed(1);
      out.acts = gs.filter((g) => g.anim.act === 21).length;
      return out; })()""")
    check(r['beaters'] >= 1 and r['arrived'] > 0, f"crew: they climb onto the walk to a fire on its boards (on it at {r['arrived']} s)")
    check(r['st'] != 1 and r['st'] != 3, f"crew: and beat it out before it burns through ({r['t']} s, char {r['char']}, {r['beats']} s of beating)")
    r = await ev(page, 'crew: diversion', """(() => { const { K, C, B } = T3.burh(0), out = {}, F = T3.F;
      // with a foe at the gate the crew still goes to a fire on the far wall: the watch is thinner while it burns
      __hm.palisade.palisadeInit(); const c = C.pal.cells.find((q) => q.side === 0 && q.a > 4 && q.st === 0); __hm.palisade.palisadeIgnite(c, 0.3);
      __hm.simulate(6); const gs = [...K.guards].map(F.getEnt).filter((g) => g && g.alive);
      out.atFire = gs.filter((g) => g.ai.fire).length; out.court = gs.filter((g) => !g.ai.wall).length;
      __hm.palisade.palisadeIgnite(c, 0); c.heat = 0; __hm.simulate(2); return out; })()""")
    check(r['atFire'] >= 1, f"crew: a fire draws people from their posts ({r['atFire']} of {r['court']} court guards at the fire)")

async def player(page):
    r = await ev(page, 'player: beat', """(() => { T3.quiet(); T3.dry(); const { K, C, B } = T3.burh(0), out = {}, F = T3.F, P = __hm.GAME.player; T3.clearGarrison(K);
      const side = T3.cellsOf(B, 0), c = side[2];
      T3.Z.deckIgnite(c, 0.5, T3.Z.BZ_T.reach); __hm.simulate(1); /* (it does not spread to the boards the player stands on) */
      const nb = c.nb.find((o) => o.di === c.di && o.f.active && o.st === 0);
      P.x = P.prevX = nb.x; P.z = P.prevZ = nb.z; P.y = nb.y; P.hp = P.maxHp = 1e7; P.motion = null; __hm.simulate(0.2);
      const prompt = () => { let best = null; const offer = (d, range, label, act, bias = 0) => { if (d < range && (!best || d / range - bias < best.s)) best = { s: d / range - bias, label, act }; }; __hm.towers.towerOffers(P, offer); return best; };
      const o = prompt(); out.label = o ? o.label : null; const h0 = c.heat;
      if (o && o.label === 'Beat out the flames') o.act(); out.act = P.anim.act; out.drop = +(h0 - c.heat).toFixed(2);
      let n = 1; while (c.st === 1 && n < 12) { const q = prompt(); if (!q || q.label !== 'Beat out the flames') break; q.act(); __hm.simulate(0.4); n++; }
      out.presses = n; out.st = c.st; return out; })()""")
    check(r['label'] == 'Beat out the flames', f"player: Use beside a fire on the walk offers to beat it out ({r['label']})")
    check(r['act'] == 21 and r['drop'] > 0.1, f"player: a press beats the flames down (body action {r['act']}, heat -{r['drop']})")
    check(r['st'] != 1, f"player: a few presses put it out ({r['presses']} presses)")

async def save(page):
    r = await ev(page, 'save: set', """(() => { T3.quiet(); T3.away(); const { K, B } = T3.burh(0), Z = T3.Z; K.lastEnemyNear = __hm.GAME.t + 1e5;
      for (const c of B.cells) if (c.st) { if (c.st === 1) { for (const f of c.fires) f.until = 0; c.fires = []; } c.st = 0; c.heat = 0; c.char = 0; c.rb = 0; if (!c.f.active) { c.f.active = true; Z.BLAZE.gaps = Math.max(0, Z.BLAZE.gaps - 1); } }
      const s = T3.cellsOf(B, 0); Z.deckIgnite(s[1], 0.5); s[1].t = 20; Z.deckThrough(s[5]); s[8].st = 3; Z.deckThrough(s[8]); s[8].rb = 0.4;
      const d = __hm.fn.saveNow ? (__hm.fn.saveNow(), 1) : 0; out = { saved: d }; return { idx: [1, 5, 8], st: [s[1].st, s[5].st, s[8].st] }; })()""")
    print(r)

STORM_KINDS = [('0, 1', "(T) => T.role === 'corner' && T.sx === 1 && T.sz === 1", 'logres-corner'), ('0, 0', "(T) => T.role === 'gate' && T.sx === 1", 'logres-gate'),
               ('1, 1', "(T) => T.role === 'lookout' && T.sx === -1", 'eriu-lookout'), ('1, 0', "(T) => T.role === 'gate' && T.sx === 1", 'eriu-gate')]
STORM_JS = """((keep, garrison, gateDown, cap) => { T3.quiet(); T3.away(); T3.dry(); const K = T3.keep(...keep), C = T3.C(K), F = T3.F, out = {}, W = T3.tower(K, PRED);
  T3.clearGarrison(K); const Lr0 = F.getEnt(K.lord); if (Lr0) F.removeEnt(Lr0); K.lord = null;
  K.door.alive = true; K.door.hp = K.door.maxHp; K.site.door.active = true;
  if (gateDown) { K.door.alive = false; K.door.hp = 0; K.door.deadAt = __hm.GAME.t; K.site.door.active = false; }
  if (garrison) { K.nextGuardAt = 0; F.fillGarrison(K, true); __hm.simulate(1); }
  K.lastEnemyNear = __hm.GAME.t;
  if (W.state === 'whole') { const src = T3.dummy(2, K.site.x + W.ox * 70, K.site.z + W.oz * 70); T3.breakIt(W, src); F.removeEnt(src); }
  else if (garrison) __hm.siege3.siegeOnBreach(W);
  if (garrison) __hm.simulate(4);
  const realm = K.realm === 2 ? 1 : 2, id = T3.S.band(realm, K.id, 95, 10), wb = __hm.WAR.warbands.find((w) => w.id === id), Rt = T3.S2.siegeStormRoute(W), p0 = Rt[0];
  F.wbMembers(wb).forEach((e, i) => { e.x = e.prevX = p0.x + W.ox * (6 + Math.floor(i / 4) * 1.6) + (i % 4 - 1.5) * 1.6 * W.oz; e.z = e.prevZ = p0.z + W.oz * (6 + Math.floor(i / 4) * 1.6) - (i % 4 - 1.5) * 1.6 * W.ox; e.y = F.heightAt(e.x, e.z); if (!garrison) { e.hp = e.maxHp = 1e6; } });
  wb.order.siegeE = null;
  const gs0 = [...K.guards].map(F.getEnt).filter(Boolean), lord0 = F.getEnt(K.lord); out.def0 = gs0.length + (lord0 ? 1 : 0);
  const still = new Map(), worst = new Map(), phases = new Set(); let t = 0, maxCourt = 0; const n0 = F.wbMembers(wb).length;
  while (t < cap) { __hm.simulate(0.25); t += 0.25; if (wb.dead || !wb.order) break; let done = 0, n = 0;
    if (wb.order) phases.add(wb.order.phase + (wb.order.breach ? ':' + wb.order.breach.kind : ''));
    for (const e of F.wbMembers(wb)) { n++; if (T3.inCourt(C, e)) done++; const s = e.ai.storm, p = still.get(e.id), moving = !p || Math.hypot(e.x - p.x, e.z - p.z) > 0.25, waiting = s && !s.done && s.i <= 1 && !s.go, fighting = e.target != null;
      if (moving || waiting || fighting || T3.inCourt(C, e)) still.set(e.id, { x: e.x, z: e.z, t }); else worst.set(e.id, Math.max(worst.get(e.id) || 0, t - p.t)); }
    maxCourt = Math.max(maxCourt, done);
    if (n && done >= n && !garrison) break; if (K.realm === realm) break; if (garrison && !n) break; }
  const ms = F.wbMembers(wb); out.t = t; out.n0 = n0; out.alive = ms.length; out.inCourt = ms.filter((e) => T3.inCourt(C, e)).length; out.maxCourt = maxCourt;
  out.worst = +Math.max(0, ...worst.values()).toFixed(1); out.phases = [...phases];
  const gs = gs0.filter((g) => g.alive); out.def = gs.length + (lord0 && lord0.alive ? 1 : 0); out.taken = K.realm === realm;
  out.where = ms.filter((e) => !T3.inCourt(C, e)).map((e) => { const s = e.ai.storm; return (s ? s.i + (s.go ? 'g' : '') + (s.done ? 'd' : '') : 'x') + '@' + Math.hypot(e.x - W.T.wx, e.z - W.T.wz).toFixed(1) + '/' + (e.y - K.site.y).toFixed(1); }).join(' ');
  out.st = JSON.parse(JSON.stringify(T3.S2.SIEGE2.stats)); out.s3 = JSON.parse(JSON.stringify(__hm.siege3.SIEGE3.stats));
  for (const e of ms) F.removeEnt(e); wb.dead = true;
  return out; })"""

async def stormcost(page):
    # a band of ten storms each stone tower kind's breach against the keep's whole garrison (its lord too): how many come
    # through, how many fall on each side, and does the keep fall (siege2's storm with the garrison, each keep kind)
    reps = int(OPT.get('reps', '1'))
    for keep, pred, name in STORM_KINDS:
        for rep in range(reps):
            r = await ev(page, f'stormcost: {name} #{rep}', STORM_JS.replace('PRED', pred) + f"([{keep}], true, false, 150)")
            print(f"  STORM {name}: through {r['maxCourt']} of {r['n0']}, attackers left {r['alive']}, defenders {r['def0']} -> {r['def']}, taken {r['taken']} in {r['t']} s (worst stand {r['worst']} s)", flush=True)

async def gatepast(page):
    # the gate broken (a ram, an earlier step): a band goes in by the gate past a fallen gate tower; nobody stands stuck
    for keep, pred, name in [STORM_KINDS[3], STORM_KINDS[1]]:
        r = await ev(page, f'gatepast: {name}', STORM_JS.replace('PRED', pred) + f"([{keep}], false, true, 90)")
        check(r['inCourt'] >= r['n0'] - 1 and r['worst'] < 10, f"gatepast: a band goes in by the broken gate past a fallen {name} tower ({r['inCourt']} of {r['n0']} in {r['t']} s, longest stand {r['worst']} s; {r['phases']}; {r['where']})")

async def main():
    async with async_playwright() as p:
        b, page, logs = await setup(p, w=640, h=360)
        await page.evaluate(f"__hm.fn.setQuality('{QUALITY}')")
        await page.evaluate("__hm.start({ realm: 2, cls: 'mage', level: 30 }); 0")
        await page.evaluate("() => {" + HELPERS + "; return 0; }")
        await page.evaluate("__hm.simulate(1); 0")
        r = await ev(page, 'boot', "(() => ({ errors: __hm.errors.slice(0, 5), ready: __hm.blaze.BLAZE.ready, decks: __hm.blaze.BLAZE.list.length, gates: __hm.blaze.BLAZE.gates.length }))()")
        check(not r['errors'] and r['ready'] and r['decks'] == 3 and r['gates'] == 3, f"boot: no errors, both burhs' walks, the timber hallow's ring and three gates of planks known ({r})")
        if want('deck'): await deck(page)
        if want('gate'): await gate(page)
        if want('temple'): await temple(page)
        if want('crew'): await crew(page)
        if want('player'): await player(page)
        if want('gatepast'): await gatepast(page)
        if want('stormcost'): await stormcost(page)
        r = await ev(page, 'end', "(() => ({ errors: __hm.errors.slice(0, 5), stats: __hm.blaze.BLAZE.stats }))()")
        check(not r['errors'], f"no runtime errors ({r['errors']})")
        for l in logs[:5]: print(l)
        await b.close()
    print(f'{len(FAILS)} failed' if FAILS else 'all passed', f'[{time.time() - T0:.0f}s]')
    sys.exit(1 if FAILS else 0)

asyncio.run(main())
