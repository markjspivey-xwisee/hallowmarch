"""[gearstats] What gear's stats do, said where players look (after version 17: a playtester could not find the gear's
stats or what Damage and Power did).

On an upright phone (390x780, touch: taps only) and on a desk (1280x720, the mouse):
- the kit's sums are five stat buttons (40 px or more), each naming what it does;
- a tap or click on one opens its card (what it does, with the player's own numbers, the pieces it comes from), and on a
  desk hovering one shows it too;
- the card stays in view at the foot of the kit while the sheet scrolls (it opened below the bags and the goods);
- the card closes with its button;
- a piece's card names what each of its stats does and is in view;
- "Every stat explained" opens the Chronicle's Gear page, its stats section open on a phone;
- the Character page shows the stats in a fight (armour and critical chance as the game reckons them), "What do these
  do?" opens, and its Kit button opens the kit;
- the field note waits until a piece of gear is carried (or level 4), and How to play has the block;
- no errors.
usage: python3 tools/tests/gearstats.py [phone] [desk] [noshots]"""
import asyncio, sys, json
sys.path.insert(0, __import__('pathlib').Path(__file__).resolve().parents[1].as_posix())
from hmlib import setup, OUT
from playwright.async_api import async_playwright

ARGS = sys.argv[1:]
MODES = [m for m in ('phone', 'desk') if m in ARGS] or ['phone', 'desk']
SHOTS = 'noshots' not in ARGS
FAILS = []

def check(ok, what, info=None):
    print(('PASS ' if ok else 'FAIL ') + what + ('' if info is None else '  ' + json.dumps(info, default=str)[:400]))
    if not ok: FAILS.append(what)

INVIEW = """(sel) => { const e = document.querySelector(sel); if (!e) return null; const r = e.getBoundingClientRect();
  return { top: Math.round(r.top), bottom: Math.round(r.bottom), h: Math.round(r.height), vh: innerHeight, inView: r.height > 20 && r.top >= -1 && r.bottom <= innerHeight + 1 }; }"""

HOLD = """(() => { if (window.__rafWrapped) { window.__rafHold = true; return 0; } window.__rafWrapped = true; window.__rafHold = true; const raf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = (cb) => raf((t) => { if (window.__rafHold) window.requestAnimationFrame(cb); else cb(t); }); return 0; })()"""

async def press(page, sel, touch):
    """a finger (or the mouse) on the middle of what the screen shows for sel; it must be the topmost thing there (not under
    the card at the foot of the kit). It is first brought into view as a player scrolls it up out from under the card."""
    box = await page.evaluate("""((sel) => { const el = document.querySelector(sel); if (!el) return null; el.scrollIntoView({ block: 'nearest' });
      const r = el.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2, hit = document.elementFromPoint(x, y);
      return { x, y, top: !!hit && (hit === el || el.contains(hit)), hit: hit ? (hit.id || String(hit.className).slice(0, 30)) : null }; })""", sel)
    if not box or not box['top']:
        check(False, f'press {sel}: it is the topmost thing there', box)
        return False
    if touch: await page.touchscreen.tap(box['x'], box['y'])
    else: await page.mouse.click(box['x'], box['y'])
    await page.wait_for_timeout(150)
    return True

async def shot(page, name):
    if SHOTS: await page.screenshot(path=f'{OUT}gearstats_{name}.png', timeout=300000)

async def run(p, mode):
    touch = mode == 'phone'
    w, h = (390, 780) if touch else (1280, 720)
    b, page, logs = await setup(p, touch=touch, w=w, h=h)
    page.set_default_timeout(300000)
    await page.emulate_media(reduced_motion='reduce')  # the Chronicle's page fades in; a picture is taken at once
    try:
        await page.evaluate(HOLD)  # the page's own frames held (the kit is a page over the game; the game's frames only slow the test)
        await page.evaluate("""(async () => { await __hm.start({ realm: 0, cls: 'warrior', level: 30 }); __hm.bal.applyFairGear(__hm.GAME.player, 30);
          const it = __hm.fn.makeItem({ slot: 'ring', q: 3, lvl: 30, cls: 'warrior' }); __hm.INV.bag.push(it);
          __hm.simulate(0.5); __hm.CAM.mode = 'fixed'; __hm.fn.openKit('kit'); return 0; })()""")
        await page.wait_for_timeout(400)
        cells = await page.evaluate("""[...document.querySelectorAll('#kit .statsum [data-stat]')].map((e) => { const r = e.getBoundingClientRect();
          return { k: e.dataset.stat, h: Math.round(r.height), w: Math.round(r.width), why: (e.querySelector('i') || {}).textContent || '' }; })""")
        check(len(cells) == 5 and all(c['h'] >= 40 and c['w'] >= 40 for c in cells), f'{mode}: five stat buttons of 40 px or more', cells)
        check(all(len(c['why']) > 4 for c in cells), f'{mode}: each stat says what it gives', [c['why'] for c in cells])
        hint = await page.evaluate("document.getElementById('kit-card').textContent")
        check('a stat' in hint, f'{mode}: the empty card points to the stats', hint[:120])
        await shot(page, f'{mode}_kit')
        # a stat's card: what it does, with the player's numbers
        await press(page, '#kit [data-stat=arm]', touch)
        nums = await page.evaluate("""(() => { const n = __hm.gearstats.gsNow(), P = __hm.GAME.player;
          return { all: n.all, dr: P.drBase * 100, crit: n.critAll, critP: 8 + (P.critBonus || 0) * 100, arm: n.g.arm }; })()""")
        card = await page.evaluate("document.getElementById('kit-card').textContent")
        check(abs(nums['all'] - nums['dr']) < 0.06, f'{mode}: armour in all as the game reckons it', nums)
        check(abs(nums['crit'] - nums['critP']) < 0.06, f'{mode}: critical chance as the game reckons it', nums)
        allp = str(round(nums['all'], 1)).rstrip('0').rstrip('.')
        check('Armour' in card and 'less harm' in card and f'{allp}% less in all' in card and 'From what you wear' in card, f'{mode}: the armour card says what it does with your numbers', card[:300])
        v = await page.evaluate(INVIEW, '#kit-card')
        check(v and v['inView'], f'{mode}: the stat card is in view', v)
        await shot(page, f'{mode}_statcard')
        for k, word in (('dmg', 'strikes'), ('hp', 'more health'), ('crit', 'critical'), ('pow', 'abilities')):
            await press(page, f'#kit [data-stat={k}]', touch)
            t = await page.evaluate("document.getElementById('kit-card').textContent")
            check(word in t, f'{mode}: the {k} card says what it does', t[:200])
        await press(page, '#kit-card .gs-x', touch)
        t = await page.evaluate("[document.getElementById('kit-card').textContent, document.getElementById('kit-card').classList.contains('has-x')]")
        check('a stat' in t[0] and not t[1], f'{mode}: the card closes', t[0][:80])
        # a piece's card: its stats say what they do, in view, and stays in view as the sheet scrolls
        await press(page, '#kit [data-bag="0"]', touch)
        info = await page.evaluate("""(() => { const c = document.getElementById('kit-card');
          return { why: [...c.querySelectorAll('.gs-why')].map((e) => e.textContent), name: (c.querySelector('.in') || {}).textContent, cmp: (c.querySelector('.cmp') || {}).textContent }; })()""")
        check(len(info['why']) >= 1 and all(info['why']), f'{mode}: a piece\'s stats say what they do', info)
        v = await page.evaluate(INVIEW, '#kit-card')
        check(v and v['inView'], f'{mode}: the piece\'s card is in view', v)
        await shot(page, f'{mode}_itemcard')
        for top in (0, 99999):
            await page.evaluate(f"document.querySelector('#kit .sheet').scrollTop = {top}; 0")
            await page.wait_for_timeout(200)
            v = await page.evaluate(INVIEW, '#kit-card')
            check(v and v['inView'], f'{mode}: the card in view with the sheet scrolled to {"the top" if top == 0 else "the end"}', v)
        if not touch:
            await page.evaluate("__hm.UI.kitSel = null; __hm.fn.renderKit(); document.querySelector('#kit .sheet').scrollTop = 0; 0")
            hb = await page.evaluate("(() => { const r = document.querySelector('#kit [data-stat=pow]').getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; })()")
            await page.mouse.move(hb[0], hb[1])
            await page.wait_for_timeout(250)
            t = await page.evaluate("document.getElementById('kit-card').textContent")
            check('Power' in t and 'abilities' in t, 'desk: hovering a stat shows what it does', t[:120])
            await page.mouse.move(5, 5)
        # every stat explained: the Chronicle's Gear page
        await page.evaluate("document.querySelector('#kit .sheet').scrollTop = 0; 0")
        await press(page, '#kit [data-stat=dmg]', touch)
        await press(page, '#kit-card [data-act=stats]', touch)
        g = await page.evaluate("""(() => { const body = document.getElementById('menu-body'), l = body.querySelector('.gs-list');
          return { modal: __hm.UI.modal, kit: document.getElementById('kit').hidden, text: body.textContent.includes('What the stats do'),
            names: ['Damage', 'Health', 'Armour', 'Critical', 'Power'].every((n) => l && l.textContent.includes(n)),
            open: !!l && !l.closest('details:not([open])'), wearFix: body.textContent.includes('Worn gear gives all its stats until it breaks') }; })()""")
        check(g['modal'] == 'menu' and g['kit'] and g['text'] and g['names'], f'{mode}: "Every stat explained" opens the Gear page', g)
        check(g['open'], f'{mode}: the stats section is open on the page', g)
        check(g['wearFix'], f'{mode}: the Gear page says worn gear keeps its stats until it breaks', g)
        await shot(page, f'{mode}_chron')
        # the Character page
        await page.evaluate("__hm.fn.openMenu('char'); 0")
        await page.evaluate("document.querySelector('#menu-tabs [data-tab=char]').click(); 0")
        await page.wait_for_timeout(300)
        ch = await page.evaluate("""(() => { const s = document.querySelector('#menu-body .gs-stats'); if (!s) return null;
          const cells = [...s.children].map((e) => [e.querySelector('small').textContent, e.querySelector('b').textContent]);
          const k = s.querySelector('[data-gs=kit]').getBoundingClientRect(); return { cells, kitH: Math.round(k.height) }; })()""")
        check(ch and len(ch['cells']) == 6 and ch['kitH'] >= 40, f'{mode}: the Character page shows the stats in a fight', ch)
        check(ch and any(c[0] == 'Armour' and c[1] == f'{allp}%' for c in ch['cells']), f'{mode}: its armour is the game\'s', ch)
        await press(page, '#menu-body details.gs-more > summary', touch)
        o = await page.evaluate("document.querySelector('#menu-body details.gs-more').open")
        check(o, f'{mode}: "What do these do?" opens')
        await shot(page, f'{mode}_char')
        await press(page, '#menu-body [data-gs=kit]', touch)
        k = await page.evaluate("[__hm.UI.modal, document.getElementById('kit').hidden]")
        check(k[0] == 'kit' and not k[1], f'{mode}: the Character page\'s Kit button opens the kit', k)
        await page.evaluate("__hm.fn.closeKit(); 0")
        # the field note, How to play, the tip
        fn = await page.evaluate("""(() => { const g = __hm.guide; const W = g.GUIDE_WATCH, P = __hm.GAME.player, INV = __hm.INV, prog = __hm.GAME.prog;
          const lv = prog.level, bag = INV.bag.slice(); prog.level = 1; INV.bag.length = 0; const before = !!W.gearstats(P, {});
          INV.bag.push(bag[0]); const after = !!W.gearstats(P, {}); prog.level = lv; INV.bag.length = 0; INV.bag.push(...bag);
          return { before, after }; })()""")
        check(fn['before'] is False and fn['after'] is True, f'{mode}: the field note waits for a piece of gear carried', fn)
        hp = await page.evaluate("__hm.fn.openMenu('help'), document.querySelector('#menu-tabs [data-tab=help]').click(), document.getElementById('menu-body').textContent.includes(\"What your gear's stats do\")")
        check(hp, f'{mode}: How to play has the stats')
        errs = await page.evaluate("__hm.errors.slice(0, 5)")
        check(not errs and not logs, f'{mode}: no errors', [errs, logs[:3]])
    finally:
        await b.close()

async def main():
    async with async_playwright() as p:
        for m in MODES: await run(p, m)
    print('FAILED: ' + ', '.join(FAILS) if FAILS else 'ALL PASSED')
    sys.exit(1 if FAILS else 0)

asyncio.run(main())
