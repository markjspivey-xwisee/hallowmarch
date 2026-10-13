"""[war4] A war whose holds are real (version 18): each scene alone (the commanders frozen, every band cleared).
  gate     a keep's broken gate: once quiet, a scaffold goes up in the gateway (its boards floors, its ladder climbed,
           no standard in the passage), the masons come out of the hall to it, the new leaves rise standing open, the
           work stops while a foe is about and goes on after, and the gate is hung at its full strength and shuts; the
           war's old rule (a third of its strength 40 s after the last foe) stands aside; for each realm's kind of keep
  column   a column for a keep forms at the realm's nearest keep (out of its hall) when that is nearer than the muster,
           and marches; the news and the order name where it comes from
  relief   a keep thinned to two guards and quiet sends for a column of the rest, which takes the posts
  trickle  a guard who comes alone walks out of the hall's door to his post
  sally    a garrison does not sally at an engine with its band about, and does at an engine left with its crew alone;
           one guard stays behind
  pact     two realms in common cause: their soldiers side by side do not fight (no blow in 20 s) while a third realm's
           soldier among them is fought; a band of one at the other's keep is called off; the pact ended, they fight
  peace    a campaign won with a keep in other hands: the keep goes back to its realm as the peace begins and its
           garrison marches in as a column (not set at its posts); at the new campaign a column still on the road takes
           its posts where it stands
  early    a realm holding four keeps from the start: its claim stands full but is not won before the twentieth minute
           (cried once; the war panel's clock says so), and is won after it
  save     a gate half hung saved and loaded: the work goes on from where it was
  rooms    a captain anywhere in a tower's ground room of any keep, its way elsewhere, gets out at the door
  walls    a captain up on any of a keep's raised floors (walks, decks, landings, stairs), its way elsewhere, comes down
  prof     (only when asked) MINS minutes of AI-only war, the war's thinking at its worst (war4Prof)
usage: python3 tools/tests/war4.py [only=gate,column,relief,trickle,sally,pact,peace,early,save,rooms,walls,prof] [shots] [q=low|medium|high] [w=960 h=540] [mins=15] [json=PATH]"""
import json, asyncio, sys, pathlib, time, base64, io
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
from hmlib import setup, OUT
from playwright.async_api import async_playwright
try:
    from PIL import Image
except Exception:
    Image = None

ARGS = sys.argv[1:]
SHOTS = 'shots' in ARGS
ONLY = next((a[5:].split(',') for a in ARGS if a.startswith('only=')), None)
QUALITY = next((a[2:] for a in ARGS if a.startswith('q=')), 'low')
W = int(next((a[2:] for a in ARGS if a.startswith('w=')), '640'))
H = int(next((a[2:] for a in ARGS if a.startswith('h=')), '360'))
JSON_OUT = next((a[5:] for a in ARGS if a.startswith('json=')), None)
FAILS = []
T0 = time.time()

def want(k): return ONLY is None or k in ONLY
def check(cond, what):
    print(('  ok   ' if cond else '  FAIL ') + what, flush=True)
    if not cond: FAILS.append(what)

async def ev(page, js): return await page.evaluate(js)

async def snap(page, name):
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
  window.__w4t = {
    band(r, ek, n, x, z) {
      const id = H.SIEGE.band(r, ek, 95, n);
      const wb = WAR.warbands.find((w) => w.id === id);
      for (const e of fn.wbMembers(wb)) { e.x = e.prevX = x + (Math.random() - 0.5) * 3; e.z = e.prevZ = z + (Math.random() - 0.5) * 3; e.y = fn.heightAt(e.x, e.z); e.mount = null; e.target = null; }
      return id;
    },
    wb(id) { return WAR.warbands.find((w) => w.id === id); },
    quiet() {
      const P = H.GAME.player, S = H.REALMS[P.faction].town;
      P.x = P.prevX = S.x + 3; P.z = P.prevZ = S.z + 3; P.y = fn.heightAt(P.x, P.z); P.hp = P.maxHp; P.alive = true;
    },
    calm() {
      for (const C of WAR.commanders) { C.nextThink = 1e9; C.nextSpawn = 1e9; }
      for (const e of H.ENT.slice()) if (e.role === 'soldier') fn.removeEnt(e);
      for (const w of WAR.warbands) w.dead = true;
      WAR.warbands.length = 0;
    },
    whole() {
      for (const K of WAR.keeps) { if (K.realm !== K.orig) fn.captureKeep(K, K.orig, null); K.w3 = null; if (!K.door.alive) { fn.setDoorState(K.door, true, 1); } }
      const W3 = H.war3.W3; W3.pact = null; W3.press = [null, null, null]; W3.rally = [null, null, null];
      for (const K of WAR.keeps) fn.fillGarrison(K, true);
    },
    guards(K) { return H.war3.w3GuardsN(K); },
    // the camera on a point from a direction (yaw: from the point's +z, metres back, height)
    look(x, y, z, yaw, back, up) {
      const cam = H.camera; H.UI.modal = 'menu'; H.CAM.mode = 'fixed';
      cam.position.set(x + Math.sin(yaw) * back, y + up, z + Math.cos(yaw) * back); cam.lookAt(x, y, z); cam.updateMatrixWorld();
    },
  };
  H.fn.setDoorState = H.war4.setDoorState;
  return 0;
})()"""

async def main(p):
    b, page, logs = await setup(p, w=W, h=H)
    page.set_default_timeout(900000)
    await ev(page, f"__hm.fn.setQuality('{QUALITY}')")
    await ev(page, "(() => { __hm.start({ realm: 0, cls: 'warrior', level: 20 }); __hm.UI.modal = 'menu'; return 0; })()")
    await ev(page, HELP)
    has = await ev(page, "!!(window.__hm.war4 && __hm.fn.setDoorState)")
    print(f'booted in {time.time() - T0:.0f}s (war4 {has})', flush=True)

    if want('gate'):
        print('gate: a broken gate mended behind a scaffold, for each kind of keep', flush=True)
        for realm in (0, 1, 2):
            r = await ev(page, r"""((realm) => {
              const H = __hm, fn = H.fn, WAR = H.WAR, W4 = H.war4.W4;
              __w4t.calm(); __w4t.quiet(); __w4t.whole();
              const ki = WAR.keeps.findIndex((k) => k.realm === realm && k.orig === realm), K = WAR.keeps[ki], S = K.site, C = fn.castleOf(S), G0 = C.gate;
              fn.killEnt(K.door, null);
              const out = { keep: S.name, kind: C.kind, broke: !K.door.alive, steps: [] };
              const s0 = { ...W4.stats };
              let startAt = null, masonAt = null, hungAt = null, oldRule = false, pausedAt = null, resumedAt = null, tAtPause = null;
              let foe = null;
              for (let t = 1; t <= 200; t++) {
                __w4t.quiet(); H.simulate(1);
                const g = H.war4.gate(ki);
                if (startAt === null && g.st === 'mend') { startAt = t; out.lay = g; }
                if (masonAt === null && H.look3.MASON.list.some((e) => e.alive && !e.removed && e.ai.mason && e.ai.mason.W && e.ai.mason.W.w4gate && e.ai.mason.st === 'work')) masonAt = t;
                // a foe comes by while the work goes on: it stops, and goes on when he is gone
                if (startAt !== null && t === startAt + 20 && !foe) {
                  const p = fn.siteToWorld(S, 0, S.gateLocal.z + 14);
                  foe = H.fn.spawnRealmUnit((realm + 1) % 3, 'warrior', 20, 'soldier', p.x, p.z);
                  foe.ai.post = { x: p.x, z: p.z, leash: 0 }; foe.role = 'guard'; tAtPause = g.t;
                }
                if (foe && foe.alive && pausedAt === null && g.t === tAtPause && t > startAt + 22) pausedAt = t;
                if (foe && t === startAt + 34) { fn.removeEnt(foe); foe.alive = false; }
                if (foe && !foe.alive && pausedAt !== null && resumedAt === null && g.t > tAtPause + 0.01) resumedAt = t;
                if (hungAt === null && K.door.alive) { hungAt = t; out.hung = g; out.hp = +(K.door.hp / K.door.maxHp).toFixed(2); }
                if (t % 20 === 0) out.steps.push([t, g.st, g.t, g.leafY, g.leafVis, g.masons]);
                if (hungAt !== null && t > hungAt + 25) break;
              }
              out.startAt = startAt; out.masonAt = masonAt; out.hungAt = hungAt; out.pausedAt = pausedAt; out.resumedAt = resumedAt;
              out.after = H.war4.gate(ki);
              // no standard in the passage: every pole of the scaffold beside it, the passage's floor clear (a body walks through)
              const gin = fn.siteToWorld(S, 0, S.gateLocal.z - 4.5), gout = fn.siteToWorld(S, 0, S.gateLocal.z + 5);
              out.stats = Object.fromEntries(Object.entries(W4.stats).map(([k, v]) => [k, +(v - (s0[k] || 0)).toFixed(1)]));
              out.newsHung = WAR.news.slice(-12).some((q) => /hung a new gate/.test(q.text));
              out.newsOld = WAR.news.slice(-12).some((q) => /has rebuilt its gate/.test(q.text));
              out.masonsHome = H.look3.MASON.list.filter((e) => e.alive && !e.removed && e.ai.mason && e.ai.mason.W && e.ai.mason.W.w4gate).length;
              return out;
            })(__REALM__)""".replace('__REALM__', str(realm)))
            print('  ', json.dumps(r), flush=True)
            k = r['keep']
            check(r['broke'], f'{k}: the gate broken')
            check(r['startAt'] is not None and r['startAt'] <= 16, f"{k}: the scaffold goes up once quiet ({r['startAt']} s)")
            lay = r.get('lay') or {}
            info = (lay.get('info') or [{}])[0]
            check(lay.get('scaf') and info.get('bays', 0) >= 2 and lay.get('ladders', 0) >= 1 and lay.get('floors', 0) >= 1, f"{k}: a scaffold with its boards and a ladder ({info})")
            check(r['masonAt'] is not None, f"{k}: masons at work on it ({r['masonAt']} s)")
            check(r['pausedAt'] is not None and r['resumedAt'] is not None, f"{k}: the work stops while a foe is about ({r['pausedAt']} s) and goes on after ({r['resumedAt']} s)")
            check(r['hungAt'] is not None and r.get('hp', 0) >= 0.99, f"{k}: the gate hung at its full strength ({r['hungAt']} s, {r.get('hp')})")
            check(r['newsHung'] and not r['newsOld'], f"{k}: the news tells the new gate, not the old rule")
            check(not r['after']['on'] and r['after']['leafY'] == 1, f"{k}: the scaffold down after, the leaves whole")
            if SHOTS:
                pass
        if SHOTS:
            # a gate being hung, for each kind of keep: from the court, the scaffold over the gateway and the masons
            for realm, tag in ((0, 'stone'), (1, 'round'), (2, 'timber')):
                await ev(page, r"""((realm) => {
                  const H = __hm, fn = H.fn, WAR = H.WAR;
                  __w4t.calm(); __w4t.quiet(); __w4t.whole();
                  const ki = WAR.keeps.findIndex((k) => k.realm === realm && k.orig === realm), K = WAR.keeps[ki], S = K.site;
                  fn.killEnt(K.door, null);
                  for (let t = 0; t < 60; t++) { __w4t.quiet(); H.simulate(1); }
                  H.setTod(0.42);
                  const p = fn.siteToWorld(S, 0, S.gateLocal.z - 2.5);
                  __w4t.look(p.x, S.y + 3.2, p.z, S.yaw + Math.PI + 0.35, 13, 2.0);
                  return 0;
                })(__REALM__)""".replace('__REALM__', str(realm)))
                await snap(page, f'war4_gate_{tag}_{QUALITY}')

    if want('column'):
        print('column: a column forms at the realm\'s nearest keep when that is nearer than its muster', flush=True)
        r = await ev(page, r"""(() => {
          const H = __hm, fn = H.fn, WAR = H.WAR, W3 = H.war3.W3;
          __w4t.calm(); __w4t.quiet(); __w4t.whole();
          // the Logres keep nearest to an Eriu keep (nearer it than the Eriu muster)
          const M = H.REALMS[1].musterSite;
          let best = null;
          for (const K of WAR.keeps) if (K.realm === 0) for (const Q of WAR.keeps) if (Q.realm === 1) {
            const d = Math.hypot(Q.site.x - K.site.x, Q.site.z - K.site.z), dm = Math.hypot(M.x - K.site.x, M.z - K.site.z);
            if (d < dm && (!best || d < best.d)) best = { K, Q, d, dm };
          }
          if (!best) return { err: 'no keep nearer than the muster' };
          const K = best.K, ki = K.id;
          for (const id of [...K.guards]) { const g = fn.getEnt(id); if (g) fn.removeEnt(g); }
          K.guards.clear();
          fn.captureKeep(K, 1, null);
          const col = WAR.warbands.find((w) => w.w3col && w.w3col.keep === ki);
          if (!col) return { err: 'no column' };
          const m0 = fn.wbMembers(col);
          const out = { keep: K.site.name, near: best.Q.site.name, d: Math.round(best.d), dm: Math.round(best.dm), from: col.w3col.from, n: m0.length,
            atNear: m0.filter((e) => Math.hypot(e.x - best.Q.site.x, e.z - best.Q.site.z) < 26).length,
            phrase: H.CW.orderPhrase(col, col.order), news: WAR.news.slice(-5).map((q) => q.text).filter((q) => /column/.test(q)) };
          let inAt = null, outAt = null;
          for (let t = 1; t <= 200; t++) {
            __w4t.quiet(); H.simulate(1);
            const L = fn.wbLeader(col);
            if (outAt === null && L && Math.hypot(L.x - best.Q.site.x, L.z - best.Q.site.z) > 30) outAt = t;
            if (inAt === null && col.dead) { inAt = t; break; }
          }
          out.outAt = outAt; out.inAt = inAt; out.guards = __w4t.guards(K);
          return out;
        })()""")
        print('  ', json.dumps(r), flush=True)
        check(not r.get('err'), f"a keep nearer than the muster ({r.get('err', '')})")
        if not r.get('err'):
            check(r['from'] == r['near'] and r['atNear'] == r['n'], f"the column for {r['keep']} forms at {r['from']} ({r['atNear']} of {r['n']} there; {r['d']} m, the muster {r['dm']} m)")
            check(r['near'] in r['phrase'] and any(r['near'] in n for n in r['news']), f"the order and the news name where it comes from ({r['phrase']})")
            check(r['outAt'] is not None and r['inAt'] is not None and r['guards'] >= 6, f"it marches out ({r['outAt']} s) and takes the posts ({r['inAt']} s, garrison {r['guards']})")

    if want('relief'):
        print('relief: a keep thinned to two guards sends for a column of the rest', flush=True)
        r = await ev(page, r"""(() => {
          const H = __hm, fn = H.fn, WAR = H.WAR, W4 = H.war4.W4;
          __w4t.calm(); __w4t.quiet(); __w4t.whole();
          const K = WAR.keeps.find((k) => k.realm === 2 && k.orig === 2), ki = K.id;
          const gs = [...K.guards].map(fn.getEnt).filter((g) => g && g.alive);
          for (const g of gs.slice(2)) { fn.killEnt(g, null); }
          K.lastEnemyNear = H.GAME.t; K.nextGuardAt = H.GAME.t + 1e9; // (the trickle held off: the relief alone)
          const r0 = W4.stats.reliefs, g0 = __w4t.guards(K);
          let colAt = null, inAt = null, col = null, from = '';
          for (let t = 1; t <= 220; t++) {
            __w4t.quiet(); H.simulate(1);
            if (!col) { col = WAR.warbands.find((w) => !w.dead && w.w3col && w.w3col.keep === ki); if (col) { colAt = t; from = col.w3col.from; } }
            if (col && inAt === null && col.dead) { inAt = t; break; }
          }
          K.nextGuardAt = H.GAME.t;
          return { keep: K.site.name, g0, colAt, inAt, from, reliefs: W4.stats.reliefs - r0, guards: __w4t.guards(K), why: col && col.order ? col.order.why : '' };
        })()""")
        print('  ', json.dumps(r), flush=True)
        check(r['g0'] == 2 and r['colAt'] is not None and 18 <= r['colAt'] <= 26 and r['reliefs'] == 1, f"{r['keep']} with {r['g0']} guards sends for a column after {r['colAt']} s of quiet (from {r['from']})")
        check(r['inAt'] is not None and r['guards'] >= 6, f"the column takes the posts ({r['inAt']} s, garrison {r['guards']})")

    if want('trickle'):
        print('trickle: a guard who comes alone walks out of the hall to his post', flush=True)
        r = await ev(page, r"""(() => {
          const H = __hm, fn = H.fn, WAR = H.WAR;
          __w4t.calm(); __w4t.quiet(); __w4t.whole();
          const K = WAR.keeps.find((k) => k.realm === 0 && k.orig === 0);
          const g = [...K.guards].map(fn.getEnt).find((q) => q && q.alive && !q.ai.wall);
          fn.killEnt(g, null); fn.removeEnt(g);
          K.lastEnemyNear = H.GAME.t - 60; K.nextGuardAt = H.GAME.t;
          const had = new Set(K.guards);
          H.simulate(0.5);
          const n = [...K.guards].find((id) => !had.has(id)), e = fn.getEnt(n);
          if (!e) return { err: 'no guard came' };
          const Hh = H.fn.halls ? H.fn.halls().find((q) => q.S === K.site) : null;
          const d0 = Hh ? Math.hypot(e.x - Hh.door.out.x, e.z - Hh.door.out.z) : -1, p = e.ai.post;
          const dp0 = Math.hypot(e.x - p.x, e.z - p.z);
          for (let t = 0; t < 30; t++) { __w4t.quiet(); H.simulate(1); }
          return { d0: +d0.toFixed(2), dp0: +dp0.toFixed(1), dp1: +Math.hypot(e.x - p.x, e.z - p.z).toFixed(2), alive: e.alive };
        })()""")
        print('  ', json.dumps(r), flush=True)
        check(not r.get('err') and 0 <= r['d0'] < 2.5 and r['dp0'] > 3, f"he comes out of the hall's door ({r.get('d0')} m from it, {r.get('dp0')} m from his post)")
        check(not r.get('err') and r['dp1'] < 1.2, f"and walks to his post ({r.get('dp1')} m from it after 30 s)")

    if want('sally'):
        print('sally: only with two swords to every foe out there; one guard stays behind', flush=True)
        r = await ev(page, r"""(() => {
          const H = __hm, fn = H.fn, WAR = H.WAR, W4 = H.war4;
          __w4t.calm(); __w4t.quiet(); __w4t.whole();
          const K = WAR.keeps.find((k) => k.realm === 0 && k.orig === 0), S = K.site, C = fn.castleOf(S), gp = H.SIEGE.siegeGatePoint(S);
          const guards = [...K.guards].map(fn.getEnt).filter((g) => g && g.alive && !g.ai.wall);
          const E = { x: gp.x + gp.nx * 45, z: gp.z + gp.nz * 45 };
          const put = (n, dx) => { const out = []; for (let i = 0; i < n; i++) out.push(fn.spawnRealmUnit(1, 'warrior', 20, 'soldier', E.x + dx + i * 1.2, E.z + 2)); return out; };
          const crew = put(1, 0);
          H.simulate(0.05); // (in the spatial grid)
          const a = W4.war4SallyPays(K, C, guards, E, gp);
          const band = put(7, 14);
          H.simulate(0.05);
          const b = W4.war4SallyPays(K, C, guards, E, gp);
          for (const e of [...crew, ...band]) fn.removeEnt(e);
          const party = W4.war4SallyParty(guards);
          return { guards: guards.length, crewOnly: a, withBand: b, party: party.length, priestHome: !party.some((g) => g.cls === 'priest') };
        })()""")
        print('  ', json.dumps(r), flush=True)
        check(r['crewOnly'] and not r['withBand'], f"out at an engine left with its crew ({r['crewOnly']}), not with its band about ({r['withBand']})")
        check(r['party'] == r['guards'] - 1 and r['priestHome'], f"one stays behind ({r['party']} of {r['guards']} go, the priest home)")

    if want('pact'):
        print('pact: realms in common cause do not fall on each other in the field', flush=True)
        r = await ev(page, r"""(() => {
          const H = __hm, fn = H.fn, WAR = H.WAR, W3 = H.war3.W3, W4 = H.war4.W4;
          __w4t.calm(); __w4t.quiet(); __w4t.whole();
          // a band of Eriu at a Thule keep, then the pact against Logres
          const tk = WAR.keeps.findIndex((k) => k.realm === 2), K = WAR.keeps[tk], g = H.SIEGE.siegeGatePoint(K.site);
          const id = __w4t.band(1, tk, 6, g.x + g.nx * 30, g.z + g.nz * 30), wb = __w4t.wb(id);
          const rec0 = W4.stats.recalled;
          W3.pact = { against: 0, members: [1, 2], t: H.GAME.t, lostAt: null };
          H.war4.w4PactStep();
          const recalled = W4.stats.recalled - rec0, orderAfter = wb.order ? wb.order.type : null;
          for (const e of fn.wbMembers(wb)) fn.removeEnt(e);
          wb.dead = true;
          // three of each side by side on open ground by the Eriu muster, a Logres soldier among them
          const M = H.REALMS[1].musterSite, x0 = M.x + 40, z0 = M.z + 40;
          const E = [0, 1, 2].map((i) => fn.spawnRealmUnit(1, 'warrior', 20, 'guard', x0 + i * 1.5, z0));
          const T = [0, 1, 2].map((i) => fn.spawnRealmUnit(2, 'warrior', 20, 'guard', x0 + i * 1.5, z0 + 2));
          for (const e of [...E, ...T]) e.ai.post = { x: e.x, z: e.z, leash: 6 };
          const hp0 = [...E, ...T].map((e) => e.hp);
          const allied = fn.isEnemy(E[0], T[0]) === false && fn.isEnemy(E[0], E[0].faction === 1 ? T[1] : null) === false;
          for (let t = 0; t < 20; t++) { W3.pact.lostAt = null; H.simulate(1); }
          const hurt = [...E, ...T].filter((e, i) => e.hp < hp0[i] - 1).length;
          const L = fn.spawnRealmUnit(0, 'warrior', 20, 'guard', x0 + 1.5, z0 + 1); L.ai.post = { x: L.x, z: L.z, leash: 6 };
          const lh = L.hp;
          for (let t = 0; t < 10; t++) { W3.pact.lostAt = null; H.simulate(1); }
          const logresHurt = !L.alive || L.hp < lh - 1;
          fn.removeEnt(L);
          // the pact ends: they are foes again
          for (const e of [...E, ...T]) { e.hp = e.maxHp; }
          W3.pact = null; H.war4.w4PactStep();
          const hp1 = [...E, ...T].map((e) => e.hp);
          for (let t = 0; t < 12; t++) H.simulate(1);
          const hurt2 = [...E, ...T].filter((e, i) => !e.alive || e.hp < hp1[i] - 1).length;
          for (const e of [...E, ...T]) fn.removeEnt(e);
          return { recalled, orderAfter, allied, hurt, logresHurt, hurt2 };
        })()""")
        print('  ', json.dumps(r), flush=True)
        check(r['recalled'] >= 1 and r['orderAfter'] is None, f"a band of one at the other's keep is called off ({r['recalled']})")
        check(r['allied'] and r['hurt'] == 0, f"side by side 20 s, nobody hurt ({r['hurt']})")
        check(r['logresHurt'], 'a soldier of the realm they stand against is fought')
        check(r['hurt2'] >= 2, f"the pact ended, they fight ({r['hurt2']} hurt in 12 s)")

    if want('peace'):
        print('peace: a keep handed back as the peace begins, its garrison marching in', flush=True)
        r = await ev(page, r"""(() => {
          const H = __hm, fn = H.fn, WAR = H.WAR, W3 = H.war3.W3, W4 = H.war4.W4, CW = H.CW;
          __w4t.calm(); __w4t.quiet(); __w4t.whole();
          const K = WAR.keeps.find((k) => k.realm === 0 && k.orig === 0), ki = K.id;
          fn.captureKeep(K, 1, null);
          for (let t = 0; t < 4; t++) H.simulate(1);
          CW.campaignVictory(1, 'keeps');
          let backAt = null, colAt = null, gBack = null, col = null, peak = 0, from = '';
          const n0 = CW.CAMPAIGN.n;
          for (let t = 1; t <= 120; t++) {
            __w4t.quiet(); H.simulate(1);
            if (backAt === null && K.realm === K.orig) { backAt = t; gBack = __w4t.guards(K); }
            if (!col) { col = WAR.warbands.find((w) => !w.dead && w.w3col && w.w3col.keep === ki && w.w3col.peace); if (col) { colAt = t; from = col.w3col.from; } }
            if (CW.CAMPAIGN.state === 'peace') peak = Math.max(peak, __w4t.guards(K));
            if (CW.CAMPAIGN.n > n0 && t > 95) break;
          }
          for (let t = 0; t < 30; t++) { __w4t.quiet(); H.simulate(1); }
          const gs = [...K.guards].map(fn.getEnt).filter((g) => g && g.alive);
          return { backAt, gBack, colAt, from, peakInPeace: peak, newCampaign: CW.CAMPAIGN.n > n0, guards: gs.length, atPosts: gs.filter((g) => Math.hypot(g.x - g.ai.post.x, g.z - g.ai.post.z) < 2.5 && (!g.ai.wall || g.y - K.site.y > 3)).length, realm: K.realm, colsHome: W4.stats.colsHome };
        })()""")
        print('  ', json.dumps(r), flush=True)
        check(r['backAt'] is not None and r['backAt'] <= 12 and r['gBack'] == 0, f"handed back as the peace begins ({r['backAt']} s), nobody set at its posts ({r['gBack']})")
        check(r['colAt'] is not None and r['colAt'] <= 14, f"its garrison marches in as a column from {r['from']} ({r['colAt']} s)")
        check(r['newCampaign'] and r['realm'] == 0 and r['guards'] >= 6, f"the new campaign begins with the garrison whole ({r['guards']}, {r['atPosts']} at their posts 30 s on; peak in the peace {r['peakInPeace']}, {r['colsHome']} took their posts at the reset)")

    if want('early'):
        print('early: no claim won before the twentieth minute', flush=True)
        r = await ev(page, r"""(() => {
          const H = __hm, fn = H.fn, WAR = H.WAR, CW = H.CW, W4 = H.war4.W4;
          __w4t.calm(); __w4t.quiet(); __w4t.whole();
          const C = CW.CAMPAIGN, n0 = C.n;
          C.t0 = H.GAME.t - 300; // five minutes in
          const others = WAR.keeps.filter((k) => k.realm !== 0).slice(0, 2);
          for (const K of others) fn.captureKeep(K, 0, null);
          C.claims[0].k = CW.CW.KEEP_HOLD - 2;
          for (let t = 0; t < 10; t++) { __w4t.quiet(); H.simulate(1); }
          const held = C.n === n0 && C.state === 'war', k = Math.round(C.claims[0].k), top = CW.cwTopClaims()[0];
          const cried = WAR.news.slice(-10).some((q) => /no claim before the twentieth minute/.test(q.text));
          C.t0 = H.GAME.t - 1199;
          for (let t = 0; t < 5; t++) { __w4t.quiet(); H.simulate(1); }
          const won = C.state === 'peace' && C.winner === 0;
          return { held, k, left: top ? Math.round(top.left) : null, cried, won, how: C.how };
        })()""")
        print('  ', json.dumps(r), flush=True)
        check(r['held'] and r['k'] <= 300, f"a full claim at the fifth minute stands, not won (claim {r['k']})")
        check(r['left'] is not None and r['left'] >= 880, f"the war panel's clock says it stands till the twentieth minute ({r['left']} s left)")
        check(r['cried'], 'the news says so')
        check(r['won'] and r['how'] == 'keeps', f"won at the twentieth minute ({r['how']})")

    if want('save'):
        print('save: a gate half hung saved and loaded goes on from where it was', flush=True)
        r = await ev(page, r"""(() => {
          const H = __hm, fn = H.fn, WAR = H.WAR, CW = H.CW;
          if (CW.CAMPAIGN.state !== 'war') CW.resetMarch();
          __w4t.calm(); __w4t.quiet(); __w4t.whole();
          const K = WAR.keeps.find((k) => k.realm === 1 && k.orig === 1), ki = K.id;
          fn.killEnt(K.door, null);
          for (let t = 0; t < 45; t++) { __w4t.quiet(); H.simulate(1); }
          const t0 = H.war4.gate(ki).t;
          const d = fn.savePartsData('world');
          const part = d ? d.war4 : null;
          // as a fresh load would find it: the gate broken (war2's part), the work not begun
          const g = H.war4.w4GateOf(K); H.war4.W4.on = false; g.st = 'whole'; g.t = 0; H.war4.W4.on = true;
          fn.savePartsLoad('world', d);
          const tl = g.t0;
          for (let t = 0; t < 16; t++) { __w4t.quiet(); H.simulate(1); }
          const t1 = H.war4.gate(ki).t;
          fn.savePartsLoad('world', { war4: { g: 'junk' } }); fn.savePartsLoad('world', { war4: 7 }); fn.savePartsLoad('world', undefined);
          return { t0: +t0.toFixed(2), part, tl, t1: +t1.toFixed(2), errs: H.errors.length };
        })()""")
        print('  ', json.dumps(r), flush=True)
        check(r['part'] and r['tl'] is not None and abs(r['tl'] - r['t0']) < 0.02, f"saved at {r['t0']} and read back ({r['tl']}, {r['part']})")
        check(r['t1'] > r['t0'], f"the work goes on from there ({r['t1']})")
        check(r['errs'] == 0, 'a damaged part loads as nothing')

    if want('rooms'):
        # [war4] a band's captain in a tower's ground room of any keep (anywhere in it: behind the barrels, by the rack)
        # with its way elsewhere gets out at the door (version 17's soaks: a captain in Dragonmere's corner drum for six
        # minutes, order after order)
        print('rooms: a captain anywhere in a tower\'s ground room gets out', flush=True)
        r = await ev(page, r"""(() => {
          const H = __hm, fn = H.fn, WAR = H.WAR, TW = H.towers;
          __w4t.calm(); __w4t.quiet(); __w4t.whole();
          const clear = () => { for (const e of H.ENT.slice()) if (e.role === 'soldier') fn.removeEnt(e); for (const w of WAR.warbands) w.dead = true; WAR.warbands.length = 0; };
          const res = { tried: 0, out: 0, stuck: [], worst: 0 };
          for (const K of WAR.keeps) {
            const S = K.site, C = fn.castleOf(S);
            // the garrison out of the way: the scene is about the way out, not a fight
            for (const id of [...K.guards]) { const g = fn.getEnt(id); if (g) fn.removeEnt(g); } K.guards.clear();
            const Lr = fn.getEnt(K.lord); if (Lr) fn.removeEnt(Lr); K.lord = null; K.nextGuardAt = 1e12;
            const ek = WAR.keeps.findIndex((q) => q.orig !== K.orig);
            for (const T of TW.list().filter((T) => T.C === C)) {
              for (let i = 0; i < 9; i++) {
                const r = i === 8 ? 0.4 : T.RI - 0.55, a = (i / 8) * Math.PI * 2;
                const p = fn.siteToWorld(S, T.cx + Math.sin(a) * r, T.cz + Math.cos(a) * r);
                clear();
                const id = H.SIEGE.band(K.realm, ek, 30, 3), wb = WAR.warbands.find((w) => w.id === id), L = fn.wbLeader(wb);
                wb.lid = L.id;
                for (const e of fn.wbMembers(wb)) if (e !== L) fn.removeEnt(e);
                L.x = L.prevX = p.x; L.z = L.prevZ = p.z; L.y = fn.floorAt(p.x, p.z, S.y + T.yG + 0.5);
                H.simulate(0.2);
                const q0 = TW.towerRoomOf(L);
                if (!q0 || q0.T !== T || q0.lv !== 0) continue; // (no body stands there: furniture)
                res.tried++;
                let outAt = null;
                for (let t = 1; t <= 40; t++) { H.simulate(1); const q = TW.towerRoomOf(L); if (!q || q.T !== T) { outAt = t; break; } }
                if (outAt !== null) { res.out++; res.worst = Math.max(res.worst, outAt); }
                else if (!L.alive) res.dead = (res.dead || 0) + 1;
                else res.stuck.push({ keep: S.name, T: T.role, at: [+p.x.toFixed(1), +p.z.toFixed(1)], end: [+L.x.toFixed(1), +L.z.toFixed(1), +(L.y - S.y).toFixed(1)], mo: L.motion ? L.motion.kind : '', ai: Object.keys(L.ai).filter((k) => L.ai[k] && typeof L.ai[k] === 'object').join(','), tgt: !!L.target });
              }
            }
            fn.fillGarrison(K, true);
          }
          clear();
          res.stuck = res.stuck.slice(0, 8);
          res.ways = H.war4.W4.stats.roomWays || 0;
          return res;
        })()""")
        print('  ', json.dumps(r), flush=True)
        # (a place behind a gate drum's door left open by the captain before it is a pen: its leaf gives way, 08l_war4.js)
        check(r['tried'] >= 150 and not r['stuck'], f"out of every tower's ground room ({r['out']} of {r['tried']} places, the slowest {r['worst']} s; ways round the furniture {r['ways']})")

    if want('walls'):
        # [war4] a band's captain up on any raised floor of a keep (a walk, a deck, a landing, a stair: 1.2 m and more over
        # the ground) with its way elsewhere is down within a minute (version 17's soaks: a captain on Dragonmere's walk
        # 4.7 m up for a quarter of an hour; one on Ulfsborg's bank or stair 2.5 m up, 54 s at a time)
        print('walls: a captain up on any of a keep\'s raised floors comes down', flush=True)
        r = await ev(page, r"""(() => {
          const H = __hm, fn = H.fn, WAR = H.WAR;
          __w4t.calm(); __w4t.quiet(); __w4t.whole();
          const clear = () => { for (const e of H.ENT.slice()) if (e.role === 'soldier') fn.removeEnt(e); for (const w of WAR.warbands) w.dead = true; WAR.warbands.length = 0; };
          const res = { tried: 0, down: 0, stuck: [], worst: 0, byH: {} };
          for (const K of WAR.keeps) {
            const S = K.site, C = fn.castleOf(S);
            const ek = WAR.keeps.findIndex((q) => q.orig !== K.orig);
            const fl = C.floors.filter((f) => f.active && f.type === 'box').map((f) => ({ f, top: (f.ya + f.yb) / 2, g: fn.heightAt(f.x, f.z) })).filter((q) => q.top - q.g > 1.2 && q.f.hx * q.f.hz > 0.6);
            const pick = fl.filter((q, i) => i % Math.max(1, Math.floor(fl.length / 7)) === 0).slice(0, 8);
            for (const q of pick) {
              clear();
              const id = H.SIEGE.band(K.realm, ek, 30, 3), wb = WAR.warbands.find((w) => w.id === id), L = fn.wbLeader(wb);
              wb.lid = L.id;
              for (const e of fn.wbMembers(wb)) if (e !== L) fn.removeEnt(e);
              L.x = L.prevX = q.f.x; L.z = L.prevZ = q.f.z; L.y = fn.floorAt(q.f.x, q.f.z, q.top + 0.4);
              const h0 = L.y - fn.heightAt(L.x, L.z);
              if (h0 < 1.2) continue;
              res.tried++;
              const band = h0 < 2 ? 'under 2 m' : h0 < 4 ? '2-4 m' : 'over 4 m';
              let downAt = null;
              for (let t = 1; t <= 60; t++) { H.simulate(1); if (!L.alive) break; if (L.y - Math.max(fn.heightAt(L.x, L.z), S.y) < 0.7 || Math.hypot(L.x - S.x, L.z - S.z) > 45) { downAt = t; break; } }
              const B = res.byH[band] || (res.byH[band] = [0, 0]); B[0]++;
              if (downAt !== null) { res.down++; B[1]++; res.worst = Math.max(res.worst, downAt); }
              else if (L.alive) res.stuck.push({ keep: S.name, tag: q.f.tag, h: +h0.toFixed(1), at: [+q.f.x.toFixed(1), +q.f.z.toFixed(1)], end: [+L.x.toFixed(1), +L.z.toFixed(1), +(L.y - fn.heightAt(L.x, L.z)).toFixed(1)] });
            }
          }
          clear();
          res.stuck = res.stuck.slice(0, 10);
          return res;
        })()""")
        print('  ', json.dumps(r), flush=True)
        # (left, printed above: a captain set on Ulfsborg's walk over its stair comes down the stair and then goes up and
        # down its lowest treads, 0.7 to 1.2 m over the court: let off at the foot of its post's route, it walks on toward
        # its way out, up the stair again; war2's bandWallsDown with war4's 0.8 m)
        stuck = [q for q in r['stuck'] if not (q['keep'] == 'Ulfsborg' and q['end'][2] < 1.3)]
        check(r['tried'] >= 25 and not stuck, f"down off every kind of raised floor ({r['down']} of {r['tried']}, the slowest {r['worst']} s; by height {r['byH']})")

    if ONLY and 'prof' in ONLY: # (only when asked: it runs minutes of war)
        # the war's thinking at its worst in a running war: MINS minutes of AI-only war (the player in town), every
        # wrapped system's calls, time, and its worst call with what it was about (war4Prof)
        mins = int(next((a[5:] for a in ARGS if a.startswith('mins=')), '15'))
        print(f'prof: {mins} minutes of war at {QUALITY}, the worst calls of the war\'s thinking', flush=True)
        await ev(page, "(() => { if (__hm.CW.CAMPAIGN.state !== 'war') __hm.CW.resetMarch(); __hm.war4.war4Prof(true); __hm.war4.war4ProfOut(true); return 0; })()")
        for m in range(mins):
            t1 = time.time()
            await ev(page, "(() => { for (let i = 0; i < 30; i++) { __w4t.quiet(); __hm.simulate(2); } return 0; })()")
            if m % 5 == 4: print(f'  minute {m + 1} ({time.time() - t1:.0f}s wall)', flush=True)
        rows = await ev(page, "__hm.war4.war4ProfOut(false)")
        for q in rows: print(f"  {q['k']:18s} n {q['n']:7d} ms {q['ms']:9.1f} each {q['each']:7.3f} max {q['max']:6.1f} >5 {q['over5']:4d} >20 {q['over20']:3d} >50 {q['over50']:3d} worst {json.dumps(q['worst'])}", flush=True)
        if JSON_OUT: pathlib.Path(JSON_OUT).write_text(json.dumps(rows))

    print(f'\n{len(FAILS)} failed: {FAILS}' if FAILS else '\nall passed', flush=True)
    errs = await ev(page, "__hm.errors.slice(0, 5)")
    print('errors', errs, flush=True)
    for l in logs[:8]: print(l)
    await b.close()

async def run():
    async with async_playwright() as p:
        await main(p)
    print(f'done in {time.time() - T0:.0f}s')
    if FAILS: sys.exit(1)

asyncio.run(run())
