"""[siege2] The siege that uses everything the walls can do (04i_siege2.js, 04g_burn.js, 04j_batter.js).
mark: an engine takes a cracked tower for its mark (the weaker way in) and its stones crack it; storm: a band storms a
fallen tower, each member over the rubble, through the store room and out at its courtyard door, one or two at a time,
nobody stuck, leaving the foes on the walls above; the garrison plugs the court before the door; palisade: a Thule
palisade catches from a fire spell, burns and spreads along the wall, chars, burns through into a gap that is stormed,
rain damps it, its own garrison's fire spares it, and it is rebuilt behind scaffolding in peace; cone: an Eriu
thatched cone burns, falls in and is rebuilt; house: siege stones crack a house, hole its roof (rain comes in) and
bring it down to a ruin that is rebuilt; a hall takes it too; door: arrows stuck in a door swing with it; save: a
burning palisade, a burnt gap, a holed house and a ruin saved and loaded.
usage: python3 tools/tests/siege2.py [noshots] [only=mark,storm,palisade,cone,house,door,archers,save,shots] [quality] [small]"""
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
    if 'shots' in OPT and name.replace('siege2_', '') not in OPT['shots'].split(','): return
    if q: await page.evaluate(f"__hm.fn.setQuality('{q}')")
    info = await page.evaluate(js)
    url = await page.evaluate("""(() => { __hm.frame(1/30); const now = __hm.dbg.U.uTime.value;
      for (const P of [__hm.walls.fx.fxAlpha, __hm.walls.fx.fxAdd]) { const a0 = P.a0.array, a1 = P.a1.array; let k = 0;
        for (let i = 0; i < P.max; i++) if (a0[i * 4 + 3] > now + 1e-3 && a1[i * 4 + 3] > 0) { a1[i * 4 + 3] = -1; k++; }
        if (k) { P.dirty0 = 0; P.dirty1 = P.max - 1; } }
      __hm.frame(1/30); __hm.frame(1/30); return __hm.dbg.renderer.domElement.toDataURL('image/png'); })()""")
    data = base64.b64decode(url.split(',', 1)[1])
    if Image: Image.open(io.BytesIO(data)).convert('RGB').save(OUT + name + '.png')
    else: pathlib.Path(OUT + name + '.png').write_bytes(data)
    print('  shot', name, json.dumps(info), f'[{time.time() - T0:.0f}s]', flush=True)
    if q: await page.evaluate(f"__hm.fn.setQuality('{QUALITY}')")

HELPERS = r"""
(() => { if (window.__rafWrapped) { window.__rafHold = true; return; } window.__rafWrapped = true; window.__rafHold = true; const raf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = (cb) => raf((t) => { if (window.__rafHold) window.requestAnimationFrame(cb); else cb(t); }); })();
window.T2 = {
  H: __hm, F: __hm.fn, S: __hm.SIEGE, S2: __hm.siege2,
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
  away() { const P = this.H.GAME.player, S = this.H.REALMS[P.faction].town; P.x = P.prevX = S.x + 3; P.z = P.prevZ = S.z + 3; P.y = this.F.heightAt(P.x, P.z); P.hp = P.maxHp = 1e7; },
  clearGarrison(K) { for (const id of [...K.guards]) { const g = this.F.getEnt(id); if (g) this.F.removeEnt(g); } K.guards.clear(); K.nextGuardAt = 1e9; },
  tower(K, pred) { return this.C(K).sections.find((W) => W.kind === 'tower' && pred(W.T)); },
  hit(W, src, n) { const T = W.T; for (let i = 0; i < n && W.state === 'whole'; i++) this.F.castleSiegeHit(src, T.wx + W.ox * (T.RO + 0.2), T.wz + W.oz * (T.RO + 0.2), 2.0, 4.4); },
  breakIt(W, src) { let n = 0; while (W.state === 'whole' && n < 80) { this.hit(W, src, 1); n++; } return n; },
  dummy(realm, x, z) { const e = this.F.spawnRealmUnit(realm, 'warrior', 30, 'guard', x, z, {}); e.role = 'dummy'; e.hp = e.maxHp = 1e9; e.ai.post = { x, z, leash: 0 }; return e; },
  cam(x, y, z, tx, ty, tz) { const H = this.H; H.UI.modal = 'menu'; H.CAM.mode = 'fixed'; const hud = document.getElementById('hud'); if (hud) hud.style.visibility = 'hidden'; H.camera.position.set(x, y, z); H.camera.lookAt(tx, ty, tz); H.camera.updateMatrixWorld(); },
  inCourt(C, e) { const S = C.S, dx = e.x - S.x, dz = e.z - S.z, c = Math.cos(S.yaw), s = Math.sin(S.yaw), lx = dx * c - dz * s, lz = dx * s + dz * c; const T = C.kind === 'round' ? lx * lx + lz * lz < 14.5 * 14.5 : Math.abs(lx) < 13 && Math.abs(lz) < 13; return T && !__hm.towers.towerRoomOf(e); },
};
"""

async def mark(page):
    r = await ev(page, 'mark: plan', """(() => { T2.quiet(); const K = T2.keep(0, 0), C = T2.C(K), out = {};
      // a stone or two have cracked the right front corner tower: from in front it is the weaker way in
      const W = T2.tower(K, (T) => T.role === 'corner' && T.sx === 1 && T.sz === 1), src = T2.dummy(2, K.site.x + W.ox * 70, K.site.z + W.oz * 70);
      T2.hit(W, src, 5); T2.F.removeEnt(src);
      out.wear = +W.wear.toFixed(2);
      out.scores = T2.S2.siegeMarks(C, K.site.x + W.ox * 60, K.site.z + W.oz * 60, 0).map((q) => q.kind + (q.kind === 'tower' ? ':' + q.T.role + q.T.sx + (q.T.sz || '') : ':' + q.k) + '=' + T2.S2.siegeMarkScore(q, K.site.x + W.ox * 60, K.site.z + W.oz * 60).toFixed(2)).slice(0, 4);
      out.wayOk = __hm.breach.list().filter((q) => q.state !== undefined).map((q) => T2.S2.siegeTowerWayOk(q) ? 1 : 0).join('');
      T2.S.SIEGE.force = 'trebuchet';
      // a band of realm 1 mustered off the tower's face
      const g = { x: W.wx + W.ox * 80, z: W.wz + W.oz * 80 }; const id = T2.S.band(1, K.id, 95, 10); const wb = __hm.WAR.warbands.find((w) => w.id === id);
      T2.F.wbMembers(wb).forEach((e, i) => { e.x = e.prevX = g.x + (i % 4) * 1.6; e.z = e.prevZ = g.z + Math.floor(i / 4) * 1.6; e.y = T2.F.heightAt(e.x, e.z); });
      T2.markWb = id; const t = T2.until(() => wb.order && wb.order.siegeE, 40); T2.S.SIEGE.force = null;
      const E = T2.S.siegeById(wb.order.siegeE); T2.markE = E ? E.id : null; T2.markW = W;
      out.t = t; out.kind = E ? E.kind : null; out.mark = E && E.target.W ? E.target.W.kind + ':' + (E.target.W.T ? E.target.W.T.role : '') : null; out.same = !!(E && E.target.W === W);
      out.news = __hm.WAR.news.slice(-2).map((n) => n.text);
      return out; })()""")
    check(r['mark'] == 'tower:corner' and r['same'], f"a band's trebuchet takes the cracked corner tower for its mark, the weaker way in ({r['scores']})")
    r = await ev(page, 'mark: stones', """(() => { const E = T2.S.siegeById(T2.markE), W = T2.markW, out = {}; if (!E) return { none: true };
      const h0 = __hm.breach.TBREACH.stats.hits, w0 = W.wear; const t = T2.until(() => E.state === 'work' && __hm.breach.TBREACH.stats.hits > h0 + 1, 240, 1);
      out.t = t; out.state = E.state; out.hits = __hm.breach.TBREACH.stats.hits - h0; out.wear0 = +w0.toFixed(2); out.wear = +W.wear.toFixed(2); out.Wstate = W.state;
      return out; })()""")
    check(r.get('hits', 0) >= 1 and (r['wear'] > r['wear0'] or r['Wstate'] != 'whole'), f"its stones strike the tower and crack it further (wear {r.get('wear0')} -> {r.get('wear')}, {r.get('hits')} hits)")

async def storm(page, garrison):
    tag = 'storm+garrison' if garrison else 'storm'
    # the movement alone on a Logres corner tower (no garrison, no lord to take: the keep cannot fall), then a fight
    # through an Eriu lookout with its garrison at home
    keep, pred = ('1, 0', "(T) => T.role === 'lookout' && T.sx === 1") if garrison else ('0, 1', "(T) => T.role === 'corner' && T.sx === -1 && T.sz === 1")
    r = await ev(page, f'{tag}: setup', """((garrison) => { T2.quiet(); T2.away(); const K = T2.keep(""" + keep + """), C = T2.C(K), out = {};
      const W = T2.tower(K, """ + pred + """);
      T2.clearGarrison(K); K.lastEnemyNear = __hm.GAME.t;
      if (!garrison) { const Lr = T2.F.getEnt(K.lord); if (Lr) T2.F.removeEnt(Lr); K.lord = null; }
      if (garrison) { K.nextGuardAt = 0; T2.F.fillGarrison(K, true); __hm.simulate(1); }
      const src = T2.dummy(2, K.site.x + W.ox * 70, K.site.z + W.oz * 70); out.hits = T2.breakIt(W, src); T2.F.removeEnt(src);
      out.plugs = [...K.guards].map(T2.F.getEnt).filter((g) => g && g.ai && g.ai.plug && g.ai.plug.W === W).length;
      out.state = W.state; out.guards = K.guards.size; out.realm = K.realm;
      // a band of realm 2 before the fallen face: it is ordered to attack, and the commanders send it in through the tower
      const id = T2.S.band(2, K.id, 95, 10), wb = __hm.WAR.warbands.find((w) => w.id === id);
      const Rt = T2.S2.siegeStormRoute(W), p0 = Rt[0];
      T2.F.wbMembers(wb).forEach((e, i) => { e.x = e.prevX = p0.x + W.ox * (6 + Math.floor(i / 4) * 1.6) + (i % 4 - 1.5) * 1.6 * W.oz; e.z = e.prevZ = p0.z + W.oz * (6 + Math.floor(i / 4) * 1.6) - (i % 4 - 1.5) * 1.6 * W.ox; e.y = T2.F.heightAt(e.x, e.z); if (!garrison) { e.hp = e.maxHp = 1e6; } });
      wb.order.siegeE = null; T2.stormWb = id; T2.stormW = W; T2.stormK = K;
      return out; })(""" + ('true' if garrison else 'false') + ")")
    check(r['state'] == 'breach', f"{tag}: the tower lies breached ({r['hits']} stones, {r['guards']} guards)")
    r = await ev(page, f'{tag}: through', """(() => { const wb = __hm.WAR.warbands.find((w) => w.id === T2.stormWb), W = T2.stormW, K = T2.stormK, C = T2.C(K), out = {}, F = T2.F;
      const ms = F.wbMembers(wb), n0 = ms.length, still = new Map(), worst = new Map(), phases = new Set(), upTargets = new Set(), thru = new Map();
      let t = 0, maxIn = 0, plugs = 0; const tl = [];
      const stride = 0.25;
      while (t < 150) {
        __hm.simulate(stride); t += stride;
        if (wb.dead || !wb.order) break;
        phases.add(wb.order.phase + (wb.order.breach ? ':' + wb.order.breach.kind : ''));
        let inside = 0, alive = 0, done = 0;
        for (const e of F.wbMembers(wb)) {
          alive++;
          const s = e.ai.storm;
          if (T2.inCourt(C, e)) { done++; if (!thru.has(e.id)) thru.set(e.id, t); }
          const tr = __hm.towers.towerRoomOf(e); if (tr || (s && s.i >= 2 && s.i <= 4)) inside++;
          // nobody stands still for long while it has somewhere to go (waiting its turn on the field is not standing stuck)
          const p = still.get(e.id), moving = !p || Math.hypot(e.x - p.x, e.z - p.z) > 0.25;
          const waiting = s && !s.done && s.i <= 1 && !s.go, fighting = e.target != null;
          if (moving || waiting || fighting || T2.inCourt(C, e)) still.set(e.id, { x: e.x, z: e.z, t });
          else worst.set(e.id, Math.max(worst.get(e.id) || 0, t - p.t));
          const tg = F.getEnt(e.target); if (tg && tg.alive && tg.y > e.y + 2.2 && s && !s.done) upTargets.add(e.id);
        }
        if (Math.round(t * 4) % 8 === 0) tl.push(Math.round(t) + ':' + F.wbMembers(wb).map((e) => { const s = e.ai.storm; return s ? (s.done ? 'D' : s.i + (s.go ? 'g' : '')) : 'x'; }).join(''));
        maxIn = Math.max(maxIn, inside);
        plugs = Math.max(plugs, [...K.guards].map(F.getEnt).filter((g) => g && g.alive && g.ai && g.ai.plug && g.ai.plug.W === W).length);
        if (alive && done >= alive) break;
        if (K.realm !== out.realm0 && out.realm0 !== undefined) break;
      }
      const ms2 = F.wbMembers(wb);
      out.t = t; out.n0 = n0; out.alive = ms2.length; out.inCourt = ms2.filter((e) => T2.inCourt(C, e)).length; out.maxIn = maxIn;
      out.phases = [...phases]; out.worst = Math.max(0, ...worst.values()).toFixed(1); out.upTargets = upTargets.size; out.plugs = plugs;
      out.st = JSON.parse(JSON.stringify(T2.S2.SIEGE2.stats)); out.realm = K.realm; out.dead = !!wb.dead;
      out.thru = [...thru.values()].map((v) => Math.round(v)).join(' ');
      out.tl = tl.slice(0, 40).join(' | ');
      out.where = ms2.filter((e) => !T2.inCourt(C, e)).map((e) => { const s = e.ai.storm; return s ? `${s.i}${s.go ? 'g' : ''}${s.done ? 'd' : ''}@${Math.hypot(e.x - W.T.wx, e.z - W.T.wz).toFixed(1)}` : 'x'; }).join(' ');
      return out; })()""")
    check(any(p == 'breach:tower' for p in r['phases']), f"{tag}: the commander sends the band in through the fallen tower ({r['phases']})")
    if not garrison:
        check(r['inCourt'] >= r['alive'] - 1 and r['alive'] >= 9, f"{tag}: the band comes through the store room into the courtyard ({r['inCourt']} of {r['alive']} in {r['t']} s; through at {r['thru']}; {r['where']})")
        check(float(r['worst']) < 8, f"{tag}: nobody stands stuck in the gap, the store room or the doorway (longest stand {r['worst']} s; sidesteps {r['st']['sidesteps']}, gave up {r['st']['stormFails']})")
        check(r['maxIn'] <= 3, f"{tag}: one or two at a time through the narrow part (at most {r['maxIn']} inside at once)")
    else:
        check(r['plugs'] >= 1, f"{tag}: the garrison runs to hold the court before the tower's door ({r['plugs']} plugging)")
        check(r['upTargets'] == 0, f"{tag}: the stormers leave the foes up on the walls for later ({r['upTargets']} went for one)")
        check(r['inCourt'] >= 2 or r['realm'] != 1 or r['dead'], f"{tag}: attackers fight their way out into the court ({r['inCourt']} of {r['alive']} in {r['t']} s, realm {r['realm']})")


async def palisade(page):
    r = await ev(page, 'palisade: catch', """(() => { T2.quiet(); T2.away(); const K = T2.keep(2, 0), C = T2.C(K), PL = __hm.palisade, out = {}, F = T2.F;
      PL.palisadeInit(); const P = C.pal; out.cells = P.cells.length; out.sides = [...new Set(P.cells.map((c) => c.side))].join('');
      K.lastEnemyNear = __hm.GAME.t;
      // the garrison's own fire spares its own palisade
      const c0 = P.cells.find((c) => c.side === 0 && Math.abs(c.a) < 1), own = T2.dummy(2, c0.x, c0.z); F.fireLandsAt(c0.x, K.site.y + 3, c0.z, 1.2, own); F.removeEnt(own);
      out.spared = c0.st === 0;
      // an enemy's fire spell lands on its back wall
      const foe = T2.dummy(0, c0.x, c0.z); F.fireLandsAt(c0.x, K.site.y + 3, c0.z, 1.2, foe); F.removeEnt(foe);
      out.lit = c0.st; T2.palC = P.cells.indexOf(c0); T2.palK = K;
      const t0 = __hm.GAME.t; let t = 0, maxB = 0; while (t < 30) { __hm.simulate(1); t++; K.lastEnemyNear = __hm.GAME.t; maxB = Math.max(maxB, P.cells.filter((c) => c.st === 1).length); }
      out.heat = +c0.heat.toFixed(2); out.char = +c0.char.toFixed(2); out.burning = maxB; out.fires = c0.fires.length; out.spread = PL.PAL.stats.spread;
      out.zones = C.cutU.uPA.value.filter((v) => v.z > v.y).length;
      return out; })()""")
    check(r['spared'], 'palisade: the garrison\'s own fire spares its own palisade')
    check(r['lit'] == 1 and r['char'] > 0.3 and r['fires'] >= 1, f"palisade: an enemy's fire spell sets its logs alight, the flames take hold and char them (char {r['char']}, {r['fires']} flames)")
    check(r['burning'] >= 2 and r['zones'] >= 1, f"palisade: the fire spreads along the wall ({r['burning']} stretches burning at once; {r['zones']} zones in the shader)")
    r = await ev(page, 'palisade: through', """(() => { const K = T2.palK, C = T2.C(K), P = C.pal, PL = __hm.palisade, F = T2.F, out = {}, c0 = P.cells[T2.palC];
      let t = 0; while (t < 60 && !P.gaps.length) { __hm.simulate(1); t++; K.lastEnemyNear = __hm.GAME.t; }
      out.t = t; out.gaps = P.gaps.length; const W = P.gaps[0];
      if (!W) return out;
      out.width = +(W.a1 - W.a0).toFixed(1); out.state = W.state;
      // a body walks in through the gap from the field to the court
      const o = { x: W.wx - (W.wx - K.site.x) / 15 * -6, z: W.wz - (W.wz - K.site.z) / 15 * -6 };
      const fx = W.wx + (W.wx - K.site.x) / Math.hypot(W.wx - K.site.x, W.wz - K.site.z) * 6, fz = W.wz + (W.wz - K.site.z) / Math.hypot(W.wx - K.site.x, W.wz - K.site.z) * 6;
      const b = F.spawnRealmUnit(0, 'warrior', 30, 'guard', fx, fz, {}); b.role = 'dummy'; b.hp = b.maxHp = 1e9;
      let k = 0; for (; k < 120; k++) { F.stepTo(b, b.x + (K.site.x - b.x) / Math.hypot(K.site.x - b.x, K.site.z - b.z) * 0.1, b.z + (K.site.z - b.z) / Math.hypot(K.site.x - b.x, K.site.z - b.z) * 0.1); if (T2.S2.castleInside(C, b.x, b.z) && Math.hypot(b.x - W.wx, b.z - W.wz) > 3) break; }
      out.walkedIn = T2.S2.castleInside(C, b.x, b.z); F.removeEnt(b);
      // the commanders count it a breach a band can storm, and the garrison plugs it
      out.bandWay = __hm.SIEGE.siegeOpenBreach(C, fx, fz) === W; out.danger = __hm.SIEGE.siegeDanger(K);
      out.news = __hm.WAR.news.slice(-3).map((n) => n.text);
      return out; })()""")
    check(r.get('gaps', 0) >= 1, f"palisade: a stretch burnt {r.get('t')} s more burns through into a gap ({r.get('width')} m wide)")
    check(r.get('walkedIn') and r.get('bandWay') and r.get('danger', 0) >= 0.9, f"palisade: the gap can be walked through into the court and is a breach the bands storm (danger {r.get('danger')})")
    r = await ev(page, 'palisade: rain', """(() => { const K = T2.palK, C = T2.C(K), P = C.pal, PL = __hm.palisade, out = {}, Wt = __hm.dbg.WEATHER;
      const c = P.cells.find((q) => q.side === 1 && q.st === 0 && Math.abs(q.a) < 3); PL.palisadeIgnite(c);
      Wt.kind = 'rain'; Wt.raining = 1; Wt.wet = 1; __hm.dbg.U.uWet.value = 1;
      let t = 0; while (t < 25 && c.st === 1) { __hm.simulate(0.5); t += 0.5; Wt.raining = 1; __hm.dbg.U.uWet.value = 1; K.lastEnemyNear = __hm.GAME.t; }
      out.t = t; out.st = c.st; Wt.kind = 'clear'; Wt.raining = 0; Wt.wet = 0; __hm.dbg.U.uWet.value = 0;
      return out; })()""")
    check(r['st'] != 1, f"palisade: rain puts out a young fire on it ({r['t']} s)")
    r = await ev(page, 'palisade: rebuilt', """(() => { const K = T2.palK, C = T2.C(K), P = C.pal, out = {}; T2.away(); for (const c of P.cells) if (c.st === 1) { for (const f of c.fires) f.until = 0; c.st = 2; c.heat = 0; }
      const W = P.gaps[0], colls = W ? W.colls.map((q) => q.mid) : []; const st = [];
      let t = 0; while (t < 260 && P.gaps.length) { __hm.simulate(4); t += 4; K.lastEnemyNear = -1e9; if (W) st.push(W.state[0] + (W.state === 'repair' ? Math.round(W.t * 10) : '')); }
      out.t = t; out.gaps = P.gaps.length; out.states = st.slice(0, 40).join(' '); out.closed = colls.every((c) => c.active); out.whole = P.cells.filter((c) => c.st !== 0).length; out.fresh = +Math.max(...P.cells.map((c) => c.fresh)).toFixed(2);
      return out; })()""")
    check(r['gaps'] == 0 and r['closed'] and 'r' in r['states'], f"palisade: in peace its owners build the gap back behind scaffolding ({r['t']} s: {r['states'][:80]})")
    check(r['whole'] == 0 and r['fresh'] > 0.2, f"palisade: and the charred logs are replaced with new ones, pale for a time ({r['whole']} cells not whole, fresh {r['fresh']})")

async def cone(page):
    r = await ev(page, 'cone: catch', """(() => { T2.quiet(); T2.away(); const K = T2.keep(1, 1), C = T2.C(K), F = T2.F, TF = __hm.towerfire, out = {};
      const T = __hm.towers.TOWER.list.find((q) => q.C === C && q.look === 'rath' && q.role === 'gate'); K.lastEnemyNear = __hm.GAME.t;
      const own = T2.dummy(1, T.wx, T.wz); F.fireLandsAt(T.wx, T.S.y + T.eave + 0.5, T.wz, 1.2, own); F.removeEnt(own); out.spared = !T.burn;
      const foe = T2.dummy(2, T.wx, T.wz); F.fireLandsAt(T.wx + 1.0, T.S.y + T.eave + 0.4, T.wz, 1.2, foe); F.removeEnt(foe);
      out.lit = !!T.burn; T2.coneT = T; T2.coneK = K;
      let t = 0; while (t < 30) { __hm.simulate(1); t++; K.lastEnemyNear = __hm.GAME.t; }
      out.heat = T.burn ? +T.burn.heat.toFixed(2) : null; out.char = +(T.char || 0).toFixed(2); out.fires = T.burn ? T.burn.fires.length : 0;
      const U = C.towerU, i = __hm.towers.TOWER.list.filter((q) => q.C === C && (q.look === 'timber' || q.look === 'rath')).indexOf(T); out.u = [U.uTA.value[i].z, +U.uTA.value[i].w.toFixed(2)];
      return out; })()""")
    check(r['spared'], "cone: the garrison's own fire spares its own tower's thatch")
    check(r['lit'] and r['char'] > 0.2 and r['fires'] >= 2 and r['u'][0] < 0, f"cone: an enemy's fire spell sets an Eriu gate tower's thatched cone alight; it burns and chars (char {r['char']}, {r['fires']} flames)")
    r = await ev(page, 'cone: falls', """(() => { const T = T2.coneT, K = T2.coneK, out = {}; let t = 0; while (t < 80 && !T.fallen) { __hm.simulate(1); t++; K.lastEnemyNear = __hm.GAME.t; }
      out.t = t; out.fallen = !!T.fallen; out.heap = !!(T.heap && T.heap.visible); out.ladders = T.ladders.map((L) => !!L.gone); out.top = T2.F.floorAt(T.wx + 0.8, T.wz, T.S.y + T.TT + 0.2) - T.S.y;
      T2.away(); let u = 0; while (u < 240 && T.fallen) { __hm.simulate(4); u += 4; K.lastEnemyNear = -1e9; }
      out.rebuilt = !T.fallen; out.u = u; out.fresh = +(T.fresh || 0).toFixed(2);
      return out; })()""")
    check(r['fallen'] and r['heap'] and not any(r['ladders']) and abs(r['top'] - 6.7) < 0.3, f"cone: the burnt cone falls in ({r['t']} s more): charred thatch heaped on the platform, which still stands with its ladder")
    check(r['rebuilt'] and r['fresh'] > 0, f"cone: in peace it is thatched again ({r['u']} s)")

async def house(page):
    r = await ev(page, 'house: stones', """(() => { T2.quiet(); T2.away(); const F = T2.F, B = __hm.batter, out = {};
      const S = __hm.REALMS[0].town, H = __hm.houses ? null : null;
      const Hs = F.houseInside ? null : null; void Hs;
      const list = window.__hm_housesList || (window.__hm_housesList = __hm.dbg && __hm.dbg.HOUSES ? __hm.dbg.HOUSES : null);
      const Hh = S.houses.map((h) => h.rec).filter((h) => h && !h.keepHall && h.state === 'whole' && !h.round)[1] || null;
      if (!Hh) return { none: true };
      T2.house = Hh; const src = T2.dummy(1, Hh.x + 40, Hh.z);
      // a stone strikes its wall (from the side): cracks, no hole
      B.houseStoneHit(Hh, Hh.x + 2, Hh.y + 1.5, Hh.z, 2.6, src, false);
      out.k1 = +Hh.bat.k.toFixed(2); out.hole1 = Hh.bat.hr;
      // one falls on its roof: a hole there, and the rain comes in under it
      B.houseStoneHit(Hh, Hh.x + 0.5, Hh.y + Hh.wallH + 1, Hh.z + 0.5, 4.4, src, true);
      out.k2 = +Hh.bat.k.toFixed(2); out.hole2 = +Hh.bat.hr.toFixed(2);
      out.dry = F.houseRoofOver(Hh.x - (Hh.bat.hx - Hh.x) * 0.0 + (Hh.bat.hx - Hh.x) * 3 + 0.01, Hh.z + (Hh.bat.hz - Hh.z) * 3 + 0.01);
      out.wet = !F.houseRoofOver(Hh.bat.hx, Hh.bat.hz);
      const set = Hh.S.houseSet; __hm.frame(1/30); out.u = set.TU.uHD.value[Hh.slot].toArray().map((v) => +v.toFixed(2));
      // more of them bring it down: a ruin of rubble, not soot
      let n = 0; while (Hh.state === 'whole' && n < 20) { B.houseStoneHit(Hh, Hh.x, Hh.y + Hh.wallH + 1, Hh.z, 4.4, src, true); n++; }
      out.n = n + 2; out.state = Hh.state; out.fell = !!(Hh.bat && Hh.bat.fell); out.char = Hh.char; out.smoulder = Hh.burn ? Hh.burn.smoulder.length : -1;
      T2.F.removeEnt(src); __hm.frame(1/30); out.u2 = set.TU.uHD.value[Hh.slot].w;
      return out; })()""")
    if r.get('none'):
        check(False, 'house: found a town house to strike'); return
    check(r['k1'] > 0 and r['hole1'] == 0, f"house: a stone striking a house's wall cracks it (batter {r['k1']}), no hole")
    check(r['hole2'] > 0.4 and r['wet'] and r['dry'] is not None, f"house: a stone from above knocks a hole in its roof ({r['hole2']} m) and the rain comes in under it (dry elsewhere: {r['dry']})")
    check(r['state'] == 'ruin' and r['fell'] and r['char'] < 0.3 and r['smoulder'] == 0 and r['u2'] > 1.5, f"house: enough stones bring it down to a ruin of rubble, not burnt ({r['n']} stones)")
    r = await ev(page, 'house: rebuilt', """(() => { const Hh = T2.house, out = {}; const st = []; let t = 0; while (t < 260 && Hh.state !== 'whole') { __hm.simulate(5); t += 5; st.push(Hh.state[0] + Math.round(Hh.char * 10)); }
      out.t = t; out.state = Hh.state; out.bat = Hh.bat; out.st = st.join(' '); return out; })()""")
    check(r['state'] == 'whole' and r['bat'] is None, f"house: the townsfolk build it back behind scaffolding as after a fire ({r['t']} s: {r['st'][:90]})")
    r = await ev(page, 'house: hall', """(() => { const F = T2.F, B = __hm.batter, out = {}; const hs = F.halls ? F.halls() : []; const Hh = hs.find((h) => h && h.state === 'whole');
      if (!Hh) return { none: true };
      const src = T2.dummy(2, Hh.x + 40, Hh.z); let n = 0; while (Hh.state === 'whole' && n < 40) { B.houseStoneHit(Hh, Hh.x, Hh.y + Hh.wallH + 1, Hh.z, 4.4, src, true); n++; } T2.F.removeEnt(src);
      out.n = n; out.state = Hh.state; out.hall = !!Hh.keepHall;
      // put it back for the rest of the run
      F.houseRestore(Hh); return out; })()""")
    check(r.get('hall') and r.get('state') == 'ruin' and r.get('n', 0) >= 6, f"house: a keep's great hall takes it too, more slowly ({r.get('n')} trebuchet stones)")

async def door(page):
    r = await ev(page, 'door: arrows', """(() => { T2.quiet(); T2.away(); const F = T2.F, Wl = __hm.walls, out = {};
      const S = __hm.REALMS[0].town; const Hh = S.houses.map((h) => h.rec).filter((h) => h && !h.keepHall && h.state === 'whole')[3];
      const D = Hh.door; F.setHouseDoor(Hh, false, null, true); D.leaf.open = 0; __hm.simulate(0.2);
      // a shot at the closed door, from out in front of it
      const a = { x: D.out2.x, y: Hh.y + 1.3, z: D.out2.z }, b = { x: D.c.x + (D.c.x - D.out2.x) * 0.5, y: Hh.y + 1.2, z: D.c.z + (D.c.z - D.out2.z) * 0.5 };
      const R = Wl.shotHit(a.x, a.y, a.z, b.x, b.y, b.z, {}); out.what = R ? R.what + ':' + (R.c ? R.c.tag : '') : null;
      if (!R) return out;
      const L = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z); const n0 = Wl.WALLS.stuck.length;
      Wl.wallArrow(R, (b.x - a.x) / L, (b.y - a.y) / L, (b.z - a.z) / L, 40, 'plain', null);
      const A = Wl.WALLS.stuck[Wl.WALLS.stuck.length - 1]; out.stuck = Wl.WALLS.stuck.length > n0 && !!A.door;
      if (!A.door) return out;
      const p0 = { ...__hm.batter.doorPose(A.door) };
      F.setHouseDoor(Hh, true, null, true); __hm.simulate(2);
      const p1 = { ...__hm.batter.doorPose(A.door) };
      out.moved = +Math.hypot(p1.x - p0.x, p1.z - p0.z).toFixed(2); out.open = +D.leaf.open.toFixed(2);
      // where the leaf now is: the arrow's head lies on it (its distance from the hinge is kept)
      const h0 = Math.hypot(p0.x - D.leaf.hx, p0.z - D.leaf.hz), h1 = Math.hypot(p1.x - D.leaf.hx, p1.z - D.leaf.hz); out.radius = [+h0.toFixed(2), +h1.toFixed(2)];
      out.alive = Wl.WALLS.stuck.includes(A);
      F.setHouseDoor(Hh, false, null, true); __hm.simulate(2); const p2 = __hm.batter.doorPose(A.door); out.back = +Math.hypot(p2.x - p0.x, p2.z - p0.z).toFixed(3);
      return out; })()""")
    check(r.get('stuck'), f"door: an arrow shot at a closed door sticks in it ({r.get('what')})")
    check(r.get('moved', 0) > 0.3 and abs(r['radius'][0] - r['radius'][1]) < 0.02 and r.get('alive'), f"door: it swings with the door as it opens (moved {r.get('moved')} m about the hinge, kept)")
    check(r.get('back', 1) < 0.01, 'door: and back as it shuts')

async def archers(page):
    # a garrison archer on a Logres corner tower's top with a foe close below off to the tower's side, and an attacking
    # archer under the curtain with a defender back on the walk: how many shots each looses in 20 s, the old way and the new
    res = {}
    for on in (False, True):
        r = await ev(page, f'archers: {"new" if on else "old"}', """((on) => { T2.quiet(); T2.away(); const F = T2.F, Ln = __hm.lines, Wl = __hm.walls, out = {};
          Ln.LINE.on = on; const K = T2.keep(0, 0), C = T2.C(K); K.lastEnemyNear = __hm.GAME.t;
          T2.clearGarrison(K); const Lr = F.getEnt(K.lord); if (Lr) F.removeEnt(Lr); K.lord = null; K.nextGuardAt = 1e9; F.fillGarrison(K, true); __hm.simulate(0.5);
          const gs = [...K.guards].map(F.getEnt).filter((q) => q && q.alive);
          for (const q of gs) if (!q.ai.wall) F.removeEnt(q);
          const Lr2 = F.getEnt(K.lord); if (Lr2) F.removeEnt(Lr2);
          const g = gs.find((q) => q.ai.wall && q.ai.slot === 'w2'); out.has = !!g; if (!g) return out;
          g.hp = g.maxHp = 1e9;
          const T = __hm.towers.TOWER.list.find((q) => q.C === C && q.role === 'corner' && q.sx === 1 && q.sz === 1);
          // the foe: on the ground off the tower's side, close under it (the archer's breastwork hides it from its post)
          const side = { x: T.wx + Math.sin(K.site.yaw + Math.PI / 2) * 0 , z: 0 };
          const fp = F.siteToWorld(K.site, T.cx + 5.2, T.cz - 2.0);
          const foe = T2.dummy(2, fp.x, fp.z); foe.hp = foe.maxHp = 1e9; foe.role = 'dummy'; foe.ai.post = { x: fp.x, z: fp.z, leash: 0 };
          // an attacking archer under the curtain, and a defender standing back on the walk behind the breastwork
          const ap = F.siteToWorld(K.site, -16 - 3.5, -8.5), dp = F.siteToWorld(K.site, -14.1, -8.5);
          const att = F.spawnRealmUnit(2, 'archer', 30, 'guard', ap.x, ap.z, {}); att.hp = att.maxHp = 1e9; att.ai.post = { x: ap.x, z: ap.z, leash: 30 };
          const def = T2.dummy(0, dp.x, dp.z); def.y = F.floorAt(dp.x, dp.z, K.site.y + 8); def.fixedY = null; def.hp = def.maxHp = 1e9;
          const h0 = foe.hp, d0 = def.hp, gx = g.x, gz = g.z, c0 = Wl.WALLS.stats.checks || 0, k0 = Wl.WALLS.stats.held || 0;
          let t = 0, far = 0; while (t < 20) { __hm.simulate(0.25); t += 0.25; K.lastEnemyNear = __hm.GAME.t; g.target = foe.id; att.target = def.id; far = Math.max(far, Math.hypot(g.x - gx, g.z - gz)); }
          out.wallHits = Math.round((h0 - foe.hp) > 0 ? 1 : 0); out.wallDmg = Math.round(h0 - foe.hp); out.attDmg = Math.round(d0 - def.hp);
          out.checks = (Wl.WALLS.stats.checks || 0) - c0; out.held = (Wl.WALLS.stats.held || 0) - k0; out.moved = +far.toFixed(2);
          out.back = +Math.hypot(att.x - ap.x, att.z - ap.z).toFixed(1); out.stats = JSON.parse(JSON.stringify(Ln.LINE.stats));
          F.removeEnt(foe); F.removeEnt(att); F.removeEnt(def); Ln.LINE.on = true;
          return out; })(""" + ('true' if on else 'false') + ")")
        res[on] = r
    o, n = res[False], res[True]
    if n.get('has'):
        check(n['wallDmg'] > o['wallDmg'] or n['wallDmg'] > 0, f"archers: a garrison archer with a foe close below off its tower's side finds a crenel with a line and shoots (harm {o['wallDmg']} -> {n['wallDmg']}, moved {n['moved']} m)")
        check(n['attDmg'] >= o['attDmg'], f"archers: an attacking archer under the curtain steps back to where the walk shows (harm {o['attDmg']} -> {n['attDmg']}, {n['back']} m back)")
        hs_o = o['held'] / max(1, o['checks']); hs_n = n['held'] / max(1, n['checks'])
        check(hs_n <= hs_o + 0.05, f"archers: fewer of their looks are held ({o['held']}/{o['checks']} -> {n['held']}/{n['checks']})")


async def shots(page):
    # a band climbing in over the rubble of a fallen Logres corner tower, by day (high) and at low
    await ev(page, 'shots: storm', """(() => { T2.quiet(); T2.away(); const K = T2.keep(0, 1), C = T2.C(K), F = T2.F; __hm.setTod(0.45);
      const W = T2.tower(K, (T) => T.role === 'corner' && T.sx === 1 && T.sz === -1); T2.clearGarrison(K); const Lr = F.getEnt(K.lord); if (Lr) F.removeEnt(Lr); K.lord = null;
      if (W.state === 'whole') { const src = T2.dummy(2, K.site.x + W.ox * 70, K.site.z + W.oz * 70); T2.breakIt(W, src); F.removeEnt(src); }
      const id = T2.S.band(2, K.id, 95, 10), wb = __hm.WAR.warbands.find((w) => w.id === id), Rt = T2.S2.siegeStormRoute(W), p0 = Rt[0];
      F.wbMembers(wb).forEach((e, i) => { e.x = e.prevX = p0.x + W.ox * (3 + Math.floor(i / 4) * 1.6) + (i % 4 - 1.5) * 1.6 * W.oz; e.z = e.prevZ = p0.z + W.oz * (3 + Math.floor(i / 4) * 1.6) - (i % 4 - 1.5) * 1.6 * W.ox; e.y = F.heightAt(e.x, e.z); e.hp = e.maxHp = 1e6; });
      wb.order.siegeE = null; T2.shotW = W; T2.shotWb = id;
      T2.until(() => F.wbMembers(wb).some((e) => e.ai.storm && e.ai.storm.i >= 3), 20, 0.1); __hm.simulate(0.6, 0.05); return 0; })()""")
    cam = """const W = T2.shotW, T = W.T; T2.cam(T.wx + W.ox * 13 + W.oz * 7, T.S.y + 6.5, T.wz + W.oz * 13 - W.ox * 7, T.wx + W.ox * 2, T.S.y + 1.5, T.wz + W.oz * 2);"""
    await shot(page, 'siege2_storm_high', "(() => { " + cam + " return 0; })()", 'high')
    await shot(page, 'siege2_storm_low', "(() => { " + cam + " return 0; })()", 'low')
    # a Thule palisade burning at night, its burnt gap by day (high and low)
    await ev(page, 'shots: palisade', """(() => { T2.quiet(); T2.away(); const K = T2.keep(2, 1), C = T2.C(K), P = (__hm.palisade.palisadeInit(), C.pal), F = T2.F;
      const c0 = P.cells.find((c) => c.side === 2 && Math.abs(c.a + 4) < 1); __hm.palisade.palisadeIgnite(c0, 0.5);
      for (let i = 0; i < 26; i++) { __hm.simulate(1); K.lastEnemyNear = __hm.GAME.t; }
      T2.palShot = { K, c0 }; __hm.setTod(1.9); return P.cells.filter((c) => c.st === 1).length; })()""")
    pcam = """const { K, c0 } = T2.palShot, S = K.site, o = T2.F.siteToWorld(S, 14.9 + 14, c0.a + 7), t = T2.F.siteToWorld(S, 14.9, c0.a); T2.cam(o.x, S.y + 5.5, o.z, t.x, S.y + 3.2, t.z);"""
    await shot(page, 'siege2_palisade_night', "(() => { " + pcam + " return 0; })()", 'high')
    await ev(page, 'shots: gap', """(() => { const { K, c0 } = T2.palShot, P = T2.C(K).pal; let t = 0; while (t < 60 && !P.gaps.length) { __hm.simulate(1); t++; K.lastEnemyNear = __hm.GAME.t; } __hm.simulate(20); for (const c of P.cells) if (c.st === 1) { for (const f of c.fires) f.until = 0; c.st = 2; c.heat = 0; } __hm.simulate(1); K.lastEnemyNear = __hm.GAME.t; __hm.setTod(0.42); return P.gaps.length; })()""")
    await shot(page, 'siege2_palisade_gap_high', "(() => { " + pcam + " return 0; })()", 'high')
    await shot(page, 'siege2_palisade_gap_low', "(() => { " + pcam + " return 0; })()", 'low')
    # an Eriu gate tower's thatched cone burning at dusk
    await ev(page, 'shots: cone', """(() => { T2.quiet(); T2.away(); const K = T2.keep(1, 0), C = T2.C(K); const T = __hm.towers.TOWER.list.find((q) => q.C === C && q.look === 'rath' && q.role === 'gate' && q.sx === -1);
      if (!T.burn && !T.fallen) __hm.towerfire.towerIgnite(T, T.TT + 2); for (let i = 0; i < 24; i++) { __hm.simulate(1); K.lastEnemyNear = __hm.GAME.t; } T2.coneShot = T; __hm.setTod(1.25); return 0; })()""")
    await shot(page, 'siege2_cone_dusk', """(() => { const T = T2.coneShot, S = T.S, o = T2.F.siteToWorld(S, T.cx - 9, T.cz + 16), t = T2.F.siteToWorld(S, T.cx, T.cz); T2.cam(o.x, S.y + 9, o.z, t.x, S.y + 8.5, t.z); return 0; })()""", 'high')
    # a town house holed and cracked by stones, then another fallen to a ruin
    await ev(page, 'shots: house', """(() => { T2.quiet(); T2.away(); const F = T2.F, B = __hm.batter, S = __hm.REALMS[0].town; __hm.setTod(0.42);
      const hs = S.houses.map((h) => h.rec).filter((h) => h && !h.keepHall && h.state === 'whole');
      const A = hs[0], Bh = hs[1] || hs[0], src = T2.dummy(1, S.x + 60, S.z);
      B.houseStoneHit(A, A.x + 1.5, A.y + 1.4, A.z, 4.4, src, false); B.houseStoneHit(A, A.x + 0.6, A.y + A.wallH + 1, A.z + 0.4, 4.4, src, true);
      let n = 0; while (Bh !== A && Bh.state === 'whole' && n < 20) { B.houseStoneHit(Bh, Bh.x, Bh.y + Bh.wallH + 1, Bh.z, 4.4, src, true); n++; }
      F.removeEnt(src); __hm.simulate(3); T2.hA = A; T2.hB = Bh; return { a: A.bat, b: Bh.state }; })()""")
    await shot(page, 'siege2_house_holed', """(() => { const H = T2.hA, d = H.door.out2, dx = d.x - H.x, dz = d.z - H.z, L = Math.hypot(dx, dz); T2.cam(H.x + dx / L * 9 + dz / L * 4, H.y + 7.5, H.z + dz / L * 9 - dx / L * 4, H.x, H.y + 2.2, H.z); return 0; })()""", 'high')
    await shot(page, 'siege2_house_ruin', """(() => { const H = T2.hB, d = H.door.out2, dx = d.x - H.x, dz = d.z - H.z, L = Math.hypot(dx, dz); T2.cam(H.x + dx / L * 10 + dz / L * 3, H.y + 5, H.z + dz / L * 10 - dx / L * 3, H.x, H.y + 1, H.z); return 0; })()""", 'high')

async def main():
    async with async_playwright() as p:
        small = 'small' in ARGS
        b, page, logs = await setup(p, w=960 if SHOTS and not small else 640, h=540 if SHOTS and not small else 360)
        page.set_default_timeout(900000)
        print('booted', f'[{time.time() - T0:.0f}s]', flush=True)
        await page.evaluate(f"__hm.fn.setQuality('{QUALITY}')")
        await page.evaluate("() => {" + HELPERS + "; return 0; }")
        await ev(page, 'start', "(() => { __hm.start({ realm: 0, cls: 'mage', level: 30 }); __hm.UI.modal = null; __hm.setTod(0.42); __hm.simulate(0.5); T2.quiet(); T2.away(); const W = __hm.dbg.WEATHER; W.mode = 'fixed'; W.kind = 'clear'; W.raining = 0; W.wet = 0; W.next = 1e9; return { errors: __hm.errors.length }; })()")
        if want('mark'): await mark(page)
        if want('storm'):
            await storm(page, False)
            await storm(page, True)
        if want('palisade'): await palisade(page)
        if want('cone'): await cone(page)
        if want('house'): await house(page)
        if want('door'): await door(page)
        if want('archers'): await archers(page)
        if SHOTS and want('shots'): await shots(page)
        r = await ev(page, 'errors', "__hm.errors.slice(0, 5)")
        check(len(r) == 0, '__hm.errors is empty')
        print('logs', logs[:5])
        await b.close()
    print(f'\n{len(FAILS)} failed' if FAILS else '\nall passed', f'[{time.time() - T0:.0f}s]')
    for f in FAILS: print('  FAIL', f)

asyncio.run(main())
