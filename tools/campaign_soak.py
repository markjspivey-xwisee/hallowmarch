"""AI-only campaign soak: the player waits in their town while the three commanders fight the war.
Simulates in chunks and prints the standing, siege engines and campaign ends; at the end, how every campaign
was won (keeps, hallows or renown) with the raid and siege counters.
usage: python3 tools/campaign_soak.py [minutes=60] [low|medium|high (band count)] [chunk-seconds=300] [seed]"""
import json, asyncio, sys, pathlib, time
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from hmlib import setup
from playwright.async_api import async_playwright

ARGS = sys.argv[1:]
nums = [a for a in ARGS if a.isdigit()]
MINS = int(nums[0]) if nums else 60
CHUNK = int(nums[1]) if len(nums) > 1 else 300
QUALITY = next((a for a in ARGS if a in ('low', 'medium', 'high')), 'low')
T0 = time.time()

CHUNK_JS = """(() => {
  const P = __hm.GAME.player, S = __hm.REALMS[P.faction].town;
  const s = __hm.simulate(%d);
  // the player stays out of the war: back in their own town, unharmed
  P.x = P.prevX = S.x + 3; P.z = P.prevZ = S.z + 3; P.y = __hm.fn.heightAt(P.x, P.z); P.hp = P.maxHp; P.alive = true;
  const c = __hm.CW.state(), H = __hm.CW.CAMPAIGN.history;
  const sg = __hm.SIEGE ? __hm.SIEGE.stats() : null;
  return { t: Math.round(s.t), bad: s.nonFinite, errors: s.errors.slice(0, 3), n: c.n, state: c.state, el: c.el, keeps: c.keeps, hallows: c.hallows,
    claims: c.claims.map((q) => q.k + '/' + q.h), renown: c.renown, bands: __hm.WAR.warbands.filter((w) => !w.dead).length,
    stats: __hm.WAR.stats, siege: sg, hist: H.map((h) => ({ n: h.n, w: h.w, how: h.how, m: h.m, cap: h.cap, hal: h.hal })),
    news: __hm.WAR.news.filter((n) => n.t > s.t - %d && /won|claim|holds|breach|seized|placed|engine|ram|trebuchet|mangonel|sall/i.test(n.text)).slice(-10).map((n) => Math.round(n.t) + ' ' + n.text) };
})()"""

async def main():
    async with async_playwright() as p:
        b, page, logs = await setup(p, w=320, h=180)
        page.set_default_timeout(3000000)
        await page.evaluate(f"__hm.fn.setQuality('{QUALITY}')")
        await page.evaluate("(() => { __hm.start({ realm: 0, cls: 'warrior', level: 20 }); __hm.UI.modal = 'menu'; return 0; })()")
        print(f'soak {MINS} min, {QUALITY} band count, booted in {time.time() - T0:.0f}s', flush=True)
        last = None
        for i in range(MINS * 60 // CHUNK):
            t1 = time.time()
            d = await page.evaluate(CHUNK_JS % (CHUNK, CHUNK))
            last = d
            print(f"t={d['t']}s ({time.time() - t1:.0f}s wall) campaign {d['n']} {d['state']} el={d['el']} keeps={d['keeps']} hallows={d['hallows']} claims k/h={d['claims']} renown={d['renown']} bands={d['bands']} bad={d['bad']} errors={len(d['errors'])}", flush=True)
            if d['siege']: print('   siege:', json.dumps(d['siege']), flush=True)
            for n in d['news']: print('    ', n, flush=True)
            for e in d['errors']: print('   ERR', e[:300], flush=True)
        print('\nCAMPAIGNS', flush=True)
        for h in last['hist']: print(f"  campaign {h['n']}: realm {h['w']} by {h['how']} after {h['m']} min (keeps taken {h['cap']}, hallows home {h['hal']})", flush=True)
        if last['state'] == 'war': print(f"  campaign {last['n']}: still running at {last['el']} s", flush=True)
        print('stats', json.dumps(last['stats']), flush=True)
        for l in logs[:5]: print(l)
        await b.close()
    print(f'done in {time.time() - T0:.0f}s')

asyncio.run(main())
