"""Goods and save parts (06d_goods.js): goods are added, taken and capped; listed in the bags; dropped goods are
picked up by walking over them; goods and a test save part travel through a save and come back; an old save with
no goods loads with empty packs; a malformed one is cleaned.
usage: python3 tools/tests/goods.py"""
import json, asyncio, sys, pathlib, time
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
from hmlib import setup, OUT
from playwright.async_api import async_playwright
FAILS = []
T0 = time.time()
def check(cond, what):
    print(('  ok   ' if cond else '  FAIL ') + what, flush=True)
    if not cond: FAILS.append(what)
async def main():
    async with async_playwright() as p:
        b, page, logs = await setup(p, w=640, h=360)
        await page.evaluate("__hm.start({ realm: 1, cls: 'archer', level: 12 })")
        r = await page.evaluate("""(() => { const H = __hm, F = H.fn, out = {};
          out.cat = Object.keys(F.GOODS || {}).length;
          H.INV.goods = {}; // [survival] a new character starts with bread, apples and water: begin from empty packs
          F.goodsAdd('plank', 5, true); F.goodsAdd('stone', 3, true); out.has = [F.goodsCount('plank'), F.goodsHave('stone', 3), F.goodsHave('stone', 4)];
          out.take = F.goodsTake('plank', 2); out.after = F.goodsCount('plank');
          out.all = F.goodsTakeAll([['plank', 1], ['stone', 9]]); out.after2 = [F.goodsCount('plank'), F.goodsCount('stone')];
          F.openKit(); out.html = document.getElementById('kit-right').innerHTML.includes('Plank'); F.closeKit();
          // a record of another system, saved with the character
          F.registerSavePart('char', 'testpart', { save: () => ({ n: 7 }), load: (d) => { window.__gotPart = d; } });
          const s = F.buildSave(); out.saved = s.char.x;
          // load it back into empty packs
          H.INV.goods = {}; F.savePartsLoad('char', JSON.parse(JSON.stringify(s.char.x)));
          out.back = [F.goodsCount('plank'), F.goodsCount('stone'), window.__gotPart && window.__gotPart.n];
          // an old save with no goods, and a malformed one
          // (other systems may issue a new or older character something on loading: a waterskin, an archer's arrows)
          const issued = new Set(['waterskin_empty', 'water', 'arrows_broadhead', 'bread', 'apple']);
          const own = () => Object.fromEntries(Object.entries(H.INV.goods).filter(([k]) => !issued.has(k)));
          F.savePartsLoad('char', undefined); out.old = Object.keys(own()).length;
          F.savePartsLoad('char', { goods: { plank: 'x', nope: 4, stone: -3, flint: 2.6 } }); out.bad = JSON.stringify(own());
          // goods on the ground are picked up by walking over them
          const P = H.GAME.player; H.INV.goods = {}; const L = F.dropGood('berries', 4, P.x + 6, P.z); H.simulate(2); P.x = P.prevX = L.x; P.z = P.prevZ = L.z; H.simulate(0.5); out.picked = F.goodsCount('berries');
          return out; })()""")
        print('goods', json.dumps(r))
        check(r['cat'] >= 40, 'the shared catalogue is registered')
        check(r['has'] == [5, True, False] and r['take'] and r['after'] == 3, 'goods are added, counted and taken')
        check(r['all'] is False and r['after2'] == [3, 3], 'taking a list is all or nothing')
        check(r['html'], 'the bags list the goods')
        check(r['saved'] and r['saved']['goods'] == {'plank': 3, 'stone': 3} and r['saved']['testpart'] == {'n': 7}, 'goods and other parts are saved with the character')
        check(r['back'] == [3, 3, 7], 'and come back on load')
        check(r['old'] == 0 and r['bad'] == '{"flint":3}', 'an old save loads with empty packs; a malformed one is cleaned')
        check(r['picked'] == 4, 'goods dropped on the ground are picked up by walking over them')
        errs = await page.evaluate("__hm.errors")
        check(not errs, f'no runtime errors {errs[:2]}')
        print('FAILED:' if FAILS else 'ALL PASSED', FAILS, f'[{time.time() - T0:.0f}s]')
        await b.close()
asyncio.run(main())
