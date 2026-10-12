"""AI-only campaign soak: the player waits in their town while the three commanders fight the war.
Simulates in chunks and prints the standing, siege engines and campaign ends; at the end, how every campaign
was won (keeps, hallows or renown) with the raid and siege counters.
[war2] Every 2 s of game time it also looks at every band: whether it fought (a blow landed), got nearer where it
is going (its leader nearer its next waypoint), waited on purpose (holding a keep, defending, on watch, by its working
engine) or stood still; a band still for 30 s or more is written down (its order, phase, where its leader stands, what
is round it), and so is every band that gives its order back after 150 s without getting anywhere (`bandStalls`).
usage: python3 tools/campaign_soak.py [minutes=60] [low|medium|high (band count)] [chunk-seconds=300] [json=PATH] [quiet]"""
import json, asyncio, sys, pathlib, time
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from hmlib import setup
from playwright.async_api import async_playwright

ARGS = sys.argv[1:]
nums = [a for a in ARGS if a.isdigit()]
MINS = int(nums[0]) if nums else 60
CHUNK = int(nums[1]) if len(nums) > 1 else 300
QUALITY = next((a for a in ARGS if a in ('low', 'medium', 'high')), 'low')
JSON_OUT = next((a[5:] for a in ARGS if a.startswith('json=')), None)
QUIET = 'quiet' in ARGS
T0 = time.time()

# [war2] the band watcher: installed once, then every chunk is simulated 2 s at a time with a look between
WATCH_JS = r"""(() => {
  const H = __hm, WAR = H.WAR, GAME = H.GAME, fn = H.fn;
  const W2 = window.__w2 = { cls: {}, eps: [], stalls: [], prev: new Map(), seenStalls: WAR.stats.bandStalls || 0, keepsHeld: [0, 0, 0], held4: [0, 0, 0] };
  const key = (O) => (O ? O.type + '/' + (O.phase || '-') : 'none');
  const castles = () => (fn.castles ? fn.castles() : []);
  function goalPt(wb, O) {
    if (!O) return null;
    if (O.type === 'attack' || O.type === 'defend') {
      const K = O.keep;
      if (O.phase === 'breach' && O.breach) return { x: O.breach.wx, z: O.breach.wz };
      const n = O.phase === 'assault' || O.phase === 'hold' || O.type === 'defend' ? K.nav.court : K.nav.gate;
      return { x: n.x, z: n.z };
    }
    if (O.type === 'raid') { const n = O.phase === 'assault' ? O.temple.nav.tc : O.temple.nav.tg; return { x: n.x, z: n.z }; }
    if (O.type === 'carry') { const n = WAR.temples[wb.realm].nav.tg; return { x: n.x, z: n.z }; }
    if (O.type === 'retrieve' || O.type === 'rally') return O.point ? { x: O.point.x, z: O.point.z } : null;
    if (O.type === 'patrol') return { x: O.node.x, z: O.node.z };
    return null;
  }
  const engineOf = (O) => (O && O.siegeE && H.SIEGE ? H.SIEGE.SIEGE.engines.find((E) => E.id === O.siegeE && !E.gone) : null);
  function snap(wb, L, O, d) {
    const m = fn.wbMembers(wb);
    let near = null, nd = 1e9;
    for (const C of castles()) { const q = Math.hypot(C.S.x - L.x, C.S.z - L.z); if (q < nd) { nd = q; near = C; } }
    const inside = near && H.siege2 ? H.siege2.castleInside(near, L.x, L.z) : false;
    const E = engineOf(O);
    const tg = fn.getEnt(L.target);
    const gy = fn.heightAt(L.x, L.z);
    const fighting = m.filter((e) => { const t = fn.getEnt(e.target); return t && t.alive; }).length;
    const doorTgt = m.filter((e) => { const t = fn.getEnt(e.target); return t && t.alive && t.kind === 'door' && !t.siegeEngine; }).length;
    const far = m.filter((e) => Math.hypot(e.x - L.x, e.z - L.z) > 40).length;
    const K = O && O.keep;
    const nref = near ? near.S.keepRef || near.S.templeRef : null;
    const nOwn = nref ? nref.realm : null, nGate = near && near.gate ? (nref && !nref.door.alive ? 'down' : +near.gate.open.toFixed(2)) : '';
    return { t: Math.round(GAME.t), id: wb.id, r: wb.realm, k: key(O), why: O ? O.why || '' : '', n: m.length, L: [Math.round(L.x), Math.round(L.z)], up: +(L.y - gy).toFixed(1), nOwn, nGate,
      dGoal: d.dGoal == null ? null : Math.round(d.dGoal), dLG: d.dLG == null ? null : +d.dLG.toFixed(1), eng: !!wb.engaged, fighting, doorTgt, far, mount: !!L.mount,
      Ltgt: tg ? (tg.kind === 'door' ? (tg.siegeEngine ? 'engine' : 'door') : tg.role || tg.kind) : '', near: near ? near.S.name : '', nd: Math.round(nd), inside,
      door: K ? (K.door.alive ? +(K.door.hp / K.door.maxHp).toFixed(2) : 0) : O && O.temple ? (O.temple.door.alive ? 1 : 0) : null,
      own: K ? K.realm : null, E: E ? E.kind + ':' + E.state : '', storm: m.filter((e) => e.ai && e.ai.storm).length, crew: m.filter((e) => e.siegeCrew).length,
      path: wb.path ? wb.pathIdx + '/' + wb.path.length : '-', replans: wb.replans || 0, ai: L.ai ? Object.keys(L.ai).filter((k) => L.ai[k] && typeof L.ai[k] === 'object').slice(0, 6).join(',') : '' };
  }
  function look(dt) {
    const now = GAME.t, peace = H.CW.CAMPAIGN.state !== 'war';
    const nowStalls = WAR.stats.bandStalls || 0;
    if (nowStalls > W2.seenStalls) {
      for (const [id, p] of W2.prev) {
        const wb = WAR.warbands.find((w) => w.id === id);
        if (wb && !wb.dead && !wb.order && p.snap) W2.stalls.push(p.snap);
      }
      W2.seenStalls = nowStalls;
    }
    const keeps = [0, 1, 2].map((r) => WAR.keeps.filter((K) => K.realm === r).length);
    for (let r = 0; r < 3; r++) { W2.keepsHeld[r] += keeps[r] * dt; if (keeps[r] >= 4) W2.held4[r] += dt; }
    const seen = new Set();
    for (const wb of WAR.warbands) {
      if (wb.dead) continue;
      const L = fn.wbLeader(wb), O = wb.order;
      if (!L) continue;
      seen.add(wb.id);
      const p = W2.prev.get(wb.id);
      const lg = wb.leaderGoal, g = goalPt(wb, O);
      const d = { dGoal: g ? Math.hypot(g.x - L.x, g.z - L.z) : null, dLG: lg ? Math.hypot(lg.x - L.x, lg.z - L.z) : null };
      let c = 'none';
      if (peace) c = 'peace';
      else if (O && p && p.O === O) {
        const fought = now - (wb.hitAt ?? -1e9) < dt + 0.5;
        const nearer = lg && p.x !== undefined ? Math.hypot(lg.x - p.x, lg.z - p.z) - (d.dLG ?? 0) >= 1.0 : false;
        const E = engineOf(O);
        const waiting = O.phase === 'hold' || (O.type === 'defend' && d.dGoal != null && d.dGoal < 45) || (O.type === 'patrol' && d.dGoal != null && d.dGoal < 20)
          || (E && E.state === 'work') || (O.type === 'rally' && d.dGoal != null && d.dGoal < 12);
        c = fought ? 'fight' : nearer ? 'nearer' : waiting ? 'wait' : 'still';
      } else if (O) c = 'new';
      if (c !== 'peace' && c !== 'new' && c !== 'none') {
        const kk = key(O);
        const T = W2.cls[kk] || (W2.cls[kk] = { fight: 0, nearer: 0, wait: 0, still: 0 });
        T[c] += dt;
      }
      // a still run of 30 s or more is an episode
      const run = p && p.O === O && c === 'still' ? (p.run || 0) + dt : 0;
      let ep = p && p.O === O ? p.ep : null;
      if (run >= 30 && !ep) { ep = snap(wb, L, O, d); ep.dur = run; W2.eps.push(ep); }
      if (ep && c === 'still') ep.dur = run;
      if (c !== 'still') ep = null;
      W2.prev.set(wb.id, { O, x: L.x, z: L.z, run, ep, snap: c === 'still' || c === 'wait' ? snap(wb, L, O, d) : p && p.O === O ? p.snap : null });
    }
    for (const id of [...W2.prev.keys()]) if (!seen.has(id)) W2.prev.delete(id);
  }
  W2.go = (sec, step) => { const n = Math.round(sec / step); let s = null; for (let i = 0; i < n; i++) { s = H.simulate(step); look(step); } return s; };
  return 0;
})()"""

CHUNK_JS = """(() => {
  const P = __hm.GAME.player, S = __hm.REALMS[P.faction].town;
  const s = window.__w2.go(%d, 2);
  // the player stays out of the war: back in their own town, unharmed
  P.x = P.prevX = S.x + 3; P.z = P.prevZ = S.z + 3; P.y = __hm.fn.heightAt(P.x, P.z); P.hp = P.maxHp; P.alive = true;
  const c = __hm.CW.state(), H = __hm.CW.CAMPAIGN.history;
  const sg = __hm.SIEGE ? __hm.SIEGE.stats() : null;
  const W2 = window.__w2;
  const eps = W2.eps.splice(0), stalls = W2.stalls.splice(0);
  return { t: Math.round(s.t), bad: s.nonFinite, errors: s.errors.slice(0, 3), n: c.n, state: c.state, el: c.el, keeps: c.keeps, hallows: c.hallows,
    claims: c.claims.map((q) => q.k + '/' + q.h), renown: c.renown, bands: __hm.WAR.warbands.filter((w) => !w.dead).length,
    stats: __hm.WAR.stats, siege: sg, hist: H.map((h) => ({ n: h.n, w: h.w, how: h.how, m: h.m, cap: h.cap, hal: h.hal })),
    cls: W2.cls, eps, stalls, keepsHeld: W2.keepsHeld.map(Math.round), held4: W2.held4.map(Math.round),
    news: __hm.WAR.news.filter((n) => n.t > s.t - %d && /won|claim|holds|breach|seized|placed|engine|ram|trebuchet|mangonel|sall/i.test(n.text)).slice(-10).map((n) => Math.round(n.t) + ' ' + n.text) };
})()"""

def fmt_snap(e):
    return (f"t={e['t']} {['Logres','Eriu','Thule'][e['r']]}#{e['id']} {e['k']} why={e['why']} n={e['n']} L={e['L']} up={e['up']} dGoal={e['dGoal']} dLG={e['dLG']} "
            f"eng={int(e['eng'])} fighting={e['fighting']} doorTgt={e['doorTgt']} far={e['far']} Ltgt={e['Ltgt']} near={e['near']}@{e['nd']}{' in' if e['inside'] else ''}(own {e.get('nOwn')} gate {e.get('nGate')}) "
            f"door={e['door']} own={e['own']} E={e['E']} storm={e['storm']} crew={e['crew']} path={e['path']} replans={e['replans']} mount={int(e['mount'])} ai={e['ai']}"
            + (f" dur={e['dur']:.0f}" if 'dur' in e else ''))

async def main():
    async with async_playwright() as p:
        b, page, logs = await setup(p, w=320, h=180)
        page.set_default_timeout(3000000)
        await page.evaluate(f"__hm.fn.setQuality('{QUALITY}')")
        await page.evaluate("(() => { __hm.start({ realm: 0, cls: 'warrior', level: 20 }); __hm.UI.modal = 'menu'; return 0; })()")
        await page.evaluate(WATCH_JS)
        print(f'soak {MINS} min, {QUALITY} band count, booted in {time.time() - T0:.0f}s', flush=True)
        last = None
        all_eps, all_stalls = [], []
        for i in range(MINS * 60 // CHUNK):
            t1 = time.time()
            d = await page.evaluate(CHUNK_JS % (CHUNK, CHUNK))
            last = d
            all_eps += d['eps']; all_stalls += d['stalls']
            print(f"t={d['t']}s ({time.time() - t1:.0f}s wall) campaign {d['n']} {d['state']} el={d['el']} keeps={d['keeps']} hallows={d['hallows']} claims k/h={d['claims']} renown={d['renown']} bands={d['bands']} bad={d['bad']} errors={len(d['errors'])} stalls={d['stats'].get('bandStalls', 0)} chases={d['stats'].get('chasesDropped', 0)}", flush=True)
            if d['siege']: print('   siege:', json.dumps(d['siege']), flush=True)
            tot = {'fight': 0, 'nearer': 0, 'wait': 0, 'still': 0}
            for T in d['cls'].values():
                for q in tot: tot[q] += T[q]
            s = sum(tot.values()) or 1
            print(f"   band time so far: fight {tot['fight'] / s:.1%} nearer {tot['nearer'] / s:.1%} wait {tot['wait'] / s:.1%} still {tot['still'] / s:.1%} ({s:.0f} band-s)", flush=True)
            if not QUIET:
                for n in d['news']: print('    ', n, flush=True)
            for e in d['stalls']: print('   STALL', fmt_snap(e), flush=True)
            for e in d['eps']: print('   STILL', fmt_snap(e), flush=True)
            for e in d['errors']: print('   ERR', e[:300], flush=True)
        print('\nCAMPAIGNS', flush=True)
        for h in last['hist']: print(f"  campaign {h['n']}: realm {h['w']} by {h['how']} after {h['m']} min (keeps taken {h['cap']}, hallows home {h['hal']})", flush=True)
        if last['state'] == 'war': print(f"  campaign {last['n']}: still running at {last['el']} s", flush=True)
        print('stats', json.dumps(last['stats']), flush=True)
        # [war2] how the bands spent their time, by order and phase (seconds of band time)
        print('\nBAND TIME (fight / nearer / wait / still, share of band-seconds)', flush=True)
        tot = {'fight': 0, 'nearer': 0, 'wait': 0, 'still': 0}
        for k, T in sorted(last['cls'].items(), key=lambda kv: -sum(kv[1].values())):
            s = sum(T.values()) or 1
            for q in tot: tot[q] += T[q]
            print(f"  {k:18s} {s:7.0f}s  fight {T['fight'] / s:5.1%}  nearer {T['nearer'] / s:5.1%}  wait {T['wait'] / s:5.1%}  still {T['still'] / s:5.1%}", flush=True)
        s = sum(tot.values()) or 1
        print(f"  {'all':18s} {s:7.0f}s  fight {tot['fight'] / s:5.1%}  nearer {tot['nearer'] / s:5.1%}  wait {tot['wait'] / s:5.1%}  still {tot['still'] / s:5.1%}", flush=True)
        print(f"keeps held (keep-seconds by realm) {last['keepsHeld']}; time each realm held four or more {last['held4']}", flush=True)
        by = {}
        for e in all_eps: by.setdefault(e['k'], []).append(e.get('dur', 30))
        print('still episodes (30 s or more) by order/phase:', {k: f"{len(v)} x, {sum(v):.0f}s" for k, v in sorted(by.items(), key=lambda kv: -sum(kv[1]))}, flush=True)
        bs = {}
        for e in all_stalls: bs[e['k']] = bs.get(e['k'], 0) + 1
        print('stalls (orders given back) by order/phase:', bs, flush=True)
        if JSON_OUT:
            pathlib.Path(JSON_OUT).write_text(json.dumps({'mins': MINS, 'quality': QUALITY, 'hist': last['hist'], 'state': last['state'], 'el': last['el'], 'n': last['n'], 'stats': last['stats'], 'siege': last['siege'], 'cls': last['cls'], 'eps': all_eps, 'stalls': all_stalls, 'keepsHeld': last['keepsHeld'], 'held4': last['held4']}))
        for l in logs[:5]: print(l)
        await b.close()
    print(f'done in {time.time() - T0:.0f}s')

asyncio.run(main())
