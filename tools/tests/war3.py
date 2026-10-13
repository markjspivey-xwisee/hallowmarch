"""[war3] Campaigns won in the field: a keep taken means something, momentum counts.
  capture  a keep taken through its broken gate: the gate stays broken, the band that took it holds its court and leaves
           soldiers as the court's guards, a column marches from the muster and takes the other posts (the archers up
           on the walls), two guards mend the gate in the gateway with mallets, the war's own rule hangs it again, the
           band holds until the keep is whole and then goes on
  lost     a column whose keep is lost on the way becomes a band like any other (its posts free again)
  press    a realm with three keeps presses for a fourth (cried, ringed on the map, a band turned to it), and the keep's
           owners send a band to hold it
  pact     a realm with four keeps finds the other two in common cause: neither chooses the other's keeps; the pact
           ends after the lead is gone
  rally    a realm down to one keep calls its bands to win one of its own back
  peace    the peace: the engines broken up, the breaches mended, the keeps handed back before the new campaign, and
           whatever is left done at the reset
  save     the pact, the presses and a keep newly taken saved and loaded
  ui       the war panel's line, the herald's word and the Chronicle's section
usage: python3 tools/tests/war3.py [only=capture,lost,press,pact,rally,peace,save,ui] [shots] [q=low|medium|high]"""
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
  window.__w3t = {
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
    // the scene alone: no commander plans, no band about
    calm() {
      for (const C of WAR.commanders) { C.nextThink = 1e9; C.nextSpawn = 1e9; }
      for (const e of H.ENT.slice()) if (e.role === 'soldier') fn.removeEnt(e);
      for (const w of WAR.warbands) w.dead = true;
      WAR.warbands.length = 0;
    },
    // every keep back to its own realm with its garrison whole, the gates whole
    whole() {
      for (const K of WAR.keeps) { if (K.realm !== K.orig) fn.captureKeep(K, K.orig, null); K.w3 = null; }
      const W3 = H.war3.W3; W3.pact = null; W3.press = [null, null, null]; W3.rally = [null, null, null];
    },
    // the keep given to realm r outright (its garrison as a capture leaves it)
    give(ki, r) { const K = WAR.keeps[ki]; fn.captureKeep(K, r, null); return K; },
    guards(K) { return H.war3.w3GuardsN(K); },
  };
  return 0;
})()"""

async def main(p):
    b, page, logs = await setup(p, w=640, h=360)
    page.set_default_timeout(900000)
    await ev(page, f"__hm.fn.setQuality('{QUALITY}')")
    await ev(page, "(() => { __hm.start({ realm: 0, cls: 'warrior', level: 20 }); __hm.UI.modal = 'menu'; return 0; })()")
    await ev(page, HELP)
    print(f'booted in {time.time() - T0:.0f}s', flush=True)

    if want('capture'):
        print('capture: a keep taken through its broken gate is held, garrisoned by a column and its gate mended', flush=True)
        r = await ev(page, r"""(() => {
          const H = __hm, fn = H.fn, WAR = H.WAR, W3 = H.war3.W3, CW = H.CW;
          __w3t.calm(); __w3t.quiet();
          // Ériu takes a Logres keep: its gate broken, a band of ten in its court, its lord killed by the band
          const ki = WAR.keeps.findIndex((k) => k.realm === 0), K = WAR.keeps[ki];
          for (const id of [...K.guards]) { const g = fn.getEnt(id); if (g) fn.removeEnt(g); }
          K.guards.clear();
          fn.killEnt(K.door, null);
          const c = K.nav.court;
          const id = __w3t.band(1, ki, 10, c.x, c.z), wb = __w3t.wb(id);
          wb.order.phase = 'assault';
          const n0 = fn.wbMembers(wb).length;
          const st0 = { ...W3.stats };
          fn.captureKeep(K, 1, fn.wbLeader(wb));
          const col = WAR.warbands.find((w) => w.w3col && w.w3col.keep === ki);
          const out = { ki, n0, gateDown: !K.door.alive, holder: K.w3 && K.w3.holder === id, given: W3.stats.given - st0.given, inBand: fn.wbMembers(wb).length,
            guards: __w3t.guards(K), col: !!col, colN: col ? fn.wbMembers(col).length : 0, colOrder: col && col.order ? col.order.type : '', colName: col ? H.CW.wbName(col) : '',
            news: WAR.news.slice(-4).map((q) => q.text) };
          // the war runs on with nobody about: the column marches, the band holds, the gate is mended
          let inAt = null, gateAt = null, workAt = null, holdEnd = null, guardsMax = 0;
          const w0 = W3.stats.gateWork;
          for (let t = 1; t <= 260; t++) {
            __w3t.quiet(); H.simulate(1);
            const g = __w3t.guards(K); guardsMax = Math.max(guardsMax, g);
            if (inAt === null && col && col.dead) inAt = t;
            if (workAt === null && W3.stats.gateWork > w0) workAt = t;
            if (gateAt === null && K.door.alive) gateAt = t;
            if (holdEnd === null && (!wb.order || wb.order.keep !== K || wb.order.phase !== 'hold')) holdEnd = t;
            if (inAt !== null && gateAt !== null && holdEnd !== null && t > 60) break;
          }
          const walls = [...K.guards].map(fn.getEnt).filter((g) => g && g.alive && g.ai.wall);
          out.inAt = inAt; out.workAt = workAt; out.gateAt = gateAt; out.holdEnd = holdEnd; out.guardsMax = guardsMax; out.guards1 = __w3t.guards(K);
          out.wallUp = walls.filter((g) => g.y - K.site.y > 3).length; out.walls = walls.length;
          out.realm = K.realm; out.stats = { ...W3.stats };
          return out;
        })()""")
        print('  ', json.dumps(r), flush=True)
        check(r['gateDown'], 'the gate broken when the keep fell stays broken')
        check(r['holder'], 'the band that took it holds it')
        check(1 <= r['given'] <= 3 and r['inBand'] >= 3, f"it leaves soldiers as the court's guards ({r['given']}) and keeps three of its own ({r['inBand']})")
        check(r['col'] and r['colOrder'] == 'garrison' and r['colN'] == 6 - r['given'], f"a column of {r['colN']} marches from the muster ({r['colName']})")
        check(any('column' in n for n in r['news']), 'the news cries the column')
        check(r['inAt'] is not None, f"the column takes its posts (after {r['inAt']} s)")
        check(r['guardsMax'] >= 6, f"the garrison is whole ({r['guardsMax']} of 6)")
        check(r['walls'] >= 2 and r['wallUp'] >= 2, f"its archers climb to the walls ({r['wallUp']} of {r['walls']} up)")
        check(r['workAt'] is not None, f"guards mend the gate with mallets (from {r['workAt']} s)")
        check(r['gateAt'] is not None, f"the gate is hung again (after {r['gateAt']} s)")
        check(r['holdEnd'] is not None and r['holdEnd'] > 36, f"the band holds the court past its old 35 s, until the keep is whole ({r['holdEnd']} s)")
        check(r['realm'] == 1, 'the keep is still the taker\'s')

    if want('lost'):
        print('lost: a column whose keep falls on the way is a band like any other', flush=True)
        r = await ev(page, r"""(() => {
          const H = __hm, fn = H.fn, WAR = H.WAR, W3 = H.war3.W3;
          __w3t.calm(); __w3t.quiet(); __w3t.whole();
          const ki = WAR.keeps.findIndex((k) => k.realm === 2), K = WAR.keeps[ki];
          for (const id of [...K.guards]) { const g = fn.getEnt(id); if (g) fn.removeEnt(g); }
          K.guards.clear();
          fn.captureKeep(K, 0, null);
          const col = WAR.warbands.find((w) => w.w3col && w.w3col.keep === ki);
          if (!col) return { err: 'no column' };
          H.simulate(3);
          fn.captureKeep(K, 2, null); // won back before the column comes
          for (let t = 0; t < 4; t++) H.simulate(1);
          return { colOrder: col.order ? col.order.type : null, w3col: !!col.w3col, slotsHeld: fn.wbMembers(col).filter((e) => e.w3slot).length, alive: fn.wbMembers(col).length, colRef: K.w3 ? K.w3.col : null };
        })()""")
        print('  ', json.dumps(r), flush=True)
        check(not r.get('err') and r['colOrder'] != 'garrison' and not r['w3col'] and r['slotsHeld'] == 0 and r['alive'] > 0, 'the column turns band: no garrison order, no posts held')

    if want('press'):
        print('press: a realm with three keeps presses for a fourth', flush=True)
        r = await ev(page, r"""(() => {
          const H = __hm, fn = H.fn, WAR = H.WAR, W3 = H.war3.W3;
          __w3t.calm(); __w3t.quiet(); __w3t.whole();
          for (const C of WAR.commanders) { C.nextThink = H.GAME.t + 1; C.nextSpawn = H.GAME.t + 1; }
          // Logres takes one of Ériu's keeps: three keeps
          const ki = WAR.keeps.findIndex((k) => k.realm === 1);
          __w3t.give(ki, 0);
          W3.look = 0;
          H.simulate(1);
          const P = W3.press[0];
          const news = WAR.news.slice(-8).map((q) => q.text);
          for (let t = 0; t < 30; t++) { __w3t.quiet(); H.simulate(1); }
          const K = P ? WAR.keeps[P.keep] : null;
          const att = WAR.warbands.filter((w) => !w.dead && w.realm === 0 && w.order && w.order.type === 'attack' && K && w.order.keep === K).length;
          const brace = WAR.warbands.filter((w) => !w.dead && K && w.realm === K.realm && w.order && w.order.type === 'defend' && w.order.keep === K).length;
          const hud = H.war3.war3HudLine(), herald = H.war3.war3HeraldText();
          return { press: P ? P.keep : null, target: K ? K.site.name : '', owner: K ? K.realm : null, att, brace, cried: news.some((q) => /presses for a fourth/.test(q)), seen: news.some((q) => /sees the blow coming/.test(q)), hud, herald,
            whys: WAR.warbands.filter((w) => !w.dead && w.order).map((w) => w.realm + ':' + w.order.type + ':' + (w.order.why || '') + ':' + (w.order.keep ? w.order.keep.id : '')) };
        })()""")
        print('  ', json.dumps(r), flush=True)
        check(r['press'] is not None and r['owner'] != 0, f"Logres presses for {r['target']}")
        check(r['cried'] and r['seen'], 'the press is cried, and its owner sees it coming')
        check(r['att'] >= 1, f"Logres's bands march on it ({r['att']})")
        check(r['brace'] >= 1, f"its owners send a band to hold it ({r['brace']})")
        check('presses for a fourth' in r['hud'], 'the war panel says so')
        check('presses for' in r['herald'], 'the herald says so')

    if want('pact'):
        print('pact: the two behind a leader make common cause', flush=True)
        r = await ev(page, r"""(() => {
          const H = __hm, fn = H.fn, WAR = H.WAR, W3 = H.war3.W3;
          __w3t.calm(); __w3t.quiet(); __w3t.whole();
          // Logres takes two keeps: four
          const ks = WAR.keeps.map((k, i) => i).filter((i) => WAR.keeps[i].realm !== 0);
          __w3t.give(ks[0], 0); __w3t.give(ks[2], 0);
          W3.look = 0; H.simulate(1);
          const pact = W3.pact ? { against: W3.pact.against, members: W3.pact.members.slice() } : null;
          const cried = WAR.news.slice(-8).some((q) => /make common cause/.test(q.text));
          // Ériu and Thule muster and choose: none of their attacks on each other
          for (const C of WAR.commanders) { C.nextThink = H.GAME.t + 0.5; C.nextSpawn = H.GAME.t + 0.5; }
          const seen = [];
          for (let t = 0; t < 40; t++) { __w3t.quiet(); H.simulate(1); for (const w of WAR.warbands) if (!w.dead && w.order && w.order.type === 'attack' && w.realm !== 0) seen.push(w.realm + '>' + w.order.keep.realm + ':' + w.order.why); }
          const onAlly = seen.filter((q) => { const [a, b] = q.split(':')[0].split('>').map(Number); return a !== 0 && b !== 0 && a !== b; }).length;
          const onLeader = seen.filter((q) => q.split(':')[0].split('>')[1] === '0').length;
          // the lead gone: the pact ends after its grace
          __w3t.give(ks[0], WAR.keeps[ks[0]].orig); __w3t.give(ks[2], WAR.keeps[ks[2]].orig);
          let endAt = null;
          for (let t = 1; t <= 70; t++) { __w3t.quiet(); H.simulate(1); if (!W3.pact) { endAt = t; break; } }
          return { pact, cried, onAlly, onLeader, endAt, ended: WAR.news.slice(-10).some((q) => /pact against/.test(q.text)) };
        })()""")
        print('  ', json.dumps(r), flush=True)
        check(r['pact'] and r['pact']['against'] == 0 and sorted(r['pact']['members']) == [1, 2], 'Ériu and Thule make common cause against Logres')
        check(r['cried'], 'the pact is cried')
        check(r['onAlly'] == 0, f"no band of the pact marches on its ally ({r['onAlly']} looks)")
        check(r['onLeader'] > 0, f"they march on the leader ({r['onLeader']} looks)")
        check(r['endAt'] is not None and r['endAt'] >= 40 and r['ended'], f"the pact ends after the lead is gone ({r['endAt']} s)")

    if want('rally'):
        print('rally: a realm down to one keep calls its bands to win one back', flush=True)
        r = await ev(page, r"""(() => {
          const H = __hm, fn = H.fn, WAR = H.WAR, W3 = H.war3.W3;
          __w3t.calm(); __w3t.quiet(); __w3t.whole();
          const ki = WAR.keeps.findIndex((k) => k.realm === 2);
          __w3t.give(ki, 1);
          W3.look = 0; H.simulate(1);
          const Q = W3.rally[2];
          const cried = WAR.news.slice(-8).some((q) => /calls every sword/.test(q.text));
          return { rally: Q ? Q.keep : null, own: Q ? WAR.keeps[Q.keep].orig === 2 : false, cried };
        })()""")
        print('  ', json.dumps(r), flush=True)
        check(r['rally'] is not None and r['own'], 'Thule names a keep of its own to win back')
        check(r['cried'], 'the call is cried')

    if want('peace'):
        print('peace: the field cleared, the walls mended, the keeps handed back', flush=True)
        r = await ev(page, r"""(() => {
          const H = __hm, fn = H.fn, WAR = H.WAR, W3 = H.war3.W3, CW = H.CW, SG = H.SIEGE;
          __w3t.calm(); __w3t.quiet(); __w3t.whole();
          // an engine in the field, a breached curtain, a keep in other hands
          const ki = WAR.keeps.findIndex((k) => k.realm === 1), K = WAR.keeps[ki], C = fn.castleOf(K.site);
          const g = SG.siegeGatePoint(K.site);
          const E = SG.siegeCreate('mangonel', 0, g.x + g.nx * 50, g.z + g.nz * 50, Math.atan2(-g.nx, -g.nz), { C, gate: true });
          E.build = 1; E.state = 'idle';
          const W = C.sections.find((q) => q.kind !== 'tower');
          fn.castleBreach(W);
          __w3t.give(ki, 0);
          const eng0 = SG.SIEGE.engines.filter((q) => !q.gone).length;
          CW.campaignVictory(0, 'keeps');
          const out = { eng0, wState0: W.state, peace: CW.CAMPAIGN.state };
          let engAt = null, wAt = null, backAt = null;
          const T = Math.ceil(CW.CAMPAIGN.peaceUntil - H.GAME.t) + 3;
          for (let t = 1; t <= T; t++) {
            __w3t.quiet(); H.simulate(1);
            if (engAt === null && SG.SIEGE.engines.filter((q) => !q.gone && q.state !== 'wreck').length === 0) engAt = t;
            if (wAt === null && W.state === 'whole') wAt = t;
            if (backAt === null && K.realm === K.orig) backAt = t;
          }
          return { ...out, engAt, wAt, backAt, T, state: CW.CAMPAIGN.state, n: CW.CAMPAIGN.n, guards: __w3t.guards(K), stats: { ...W3.stats } };
        })()""")
        print('  ', json.dumps(r), flush=True)
        check(r['peace'] == 'peace', 'the campaign is won: the peace')
        check(r['engAt'] is not None, f"the engines are broken up in the peace ({r['eng0']} at the start, gone after {r['engAt']} s)")
        check(r['wAt'] is not None and r['wAt'] < r['T'] - 3, f"the breach is mended in the peace (after {r['wAt']} s of {r['T']})")
        check(r['backAt'] is not None and r['backAt'] < r['T'] - 3, f"the keep goes back to its realm in the peace (after {r['backAt']} s)")
        check(r['state'] == 'war' and r['guards'] >= 6, f"the new campaign begins with the keep's garrison whole ({r['guards']})")

    if want('save'):
        print('save: the pact, a press and a keep newly taken, saved and loaded', flush=True)
        r = await ev(page, r"""(() => {
          const H = __hm, fn = H.fn, WAR = H.WAR, W3 = H.war3.W3;
          __w3t.calm(); __w3t.quiet(); __w3t.whole();
          const ks = WAR.keeps.map((k, i) => i).filter((i) => WAR.keeps[i].realm !== 0);
          __w3t.give(ks[0], 0); __w3t.give(ks[2], 0);
          W3.look = 0; H.simulate(1);
          const d = fn.savePartsData ? fn.savePartsData('world') : null;
          const part = d ? d.war3 : null;
          W3.pact = null; for (const K of WAR.keeps) K.w3 = null;
          if (part) fn.savePartsLoad('world', { war3: part });
          const back = { pact: W3.pact ? W3.pact.against : null, fresh: WAR.keeps.filter((K) => K.w3 && K.w3.by === 0).length };
          // a damaged part and an old save
          fn.savePartsLoad('world', { war3: { p: ['x', null], pr: 'no', kw: [[1e9, 7], null, 'a'] } });
          const bad = { pact: W3.pact, fresh: WAR.keeps.filter((K) => K.w3).length, errs: H.errors.length };
          fn.savePartsLoad('world', {});
          return { part, back, bad, size: JSON.stringify(part || '').length };
        })()""")
        print('  ', json.dumps(r), flush=True)
        check(r['part'] is not None and r['back']['pact'] == 0 and r['back']['fresh'] >= 2, f"the pact and the keeps newly taken come back ({r['size']} bytes)")
        check(r['bad']['pact'] is None and r['bad']['errs'] == 0, 'a damaged part loads as nothing, without an error')

    if want('ui'):
        print('ui: the Chronicle and the herald', flush=True)
        r = await ev(page, r"""(() => {
          const H = __hm;
          H.LORE.openChronicle('war');
          const txt = document.body.innerText;
          const ok = /Holding what you take/.test(txt);
          H.UI.modal = 'menu';
          return { ok };
        })()""")
        check(r['ok'], "the Chronicle's war page tells how keeps are held and pressed")

    errs = await ev(page, '__hm.errors.slice(0, 5)')
    check(not errs, f'no runtime errors {errs}')
    await b.close()

async def run():
    async with async_playwright() as p: await main(p)
    print(f"\n{'FAILED ' + str(len(FAILS)) + ': ' + '; '.join(FAILS) if FAILS else 'ALL OK'} ({time.time() - T0:.0f}s)", flush=True)
    sys.exit(1 if FAILS else 0)

asyncio.run(run())
