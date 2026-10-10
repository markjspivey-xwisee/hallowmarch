"""Lore and onboarding: the prologue (shown to a new character, skippable, replayable, pausing the world),
the Chronicle tab, the path tracker with its rewards and saving, field notes, the death note, and saves
from before the path. Screenshots of every prologue page, the Chronicle and the path go to tools/out/lore_*.
usage: python3 tools/tests/lore.py [desktop|phone] [noshots]"""
import json, asyncio, sys, pathlib, time
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
from hmlib import setup, OUT
from playwright.async_api import async_playwright

ARGS = sys.argv[1:]
SHOTS = 'noshots' not in ARGS
PARTS = [a for a in ARGS if a in ('desktop', 'phone')] or ['desktop', 'phone']
FAILS = []
T0 = time.time()

def check(cond, what):
    print(('  ok   ' if cond else '  FAIL ') + what)
    if not cond: FAILS.append(what)

async def frames(page, n=2):
    for _ in range(n): await page.evaluate("new Promise(r=>requestAnimationFrame(()=>r()))")

async def shot(page, name):
    if not SHOTS: return
    await frames(page, 1)
    await page.screenshot(path=OUT + name + '.png', timeout=300000)
    print(f'  shot {name} ({time.time() - T0:.0f}s)')

async def ev(page, js):
    return await page.evaluate(js)

# a cheaper 3D view behind the HTML being tested: the world renders at half resolution, and is
# left out altogether behind the full-screen prologue and menu, where it barely shows
LIGHT = "(() => { __hm.quality.scale = 0.5; dispatchEvent(new Event('resize')); })()"
def world(on): return f"__hm.dbg.scene.visible = {'true' if on else 'false'}"

async def begin(page, realm, cls):
    """Pick a realm and a calling on the title screen and enter the realm, as a player would."""
    await ev(page, f"document.querySelector('#realm-pick [data-realm=\"{realm}\"]').click(); document.querySelector('#class-pick [data-cls=\"{cls}\"]').click()")
    await page.click('#btn-begin')
    await frames(page, 2)

async def desktop(p):
    print('desktop, 1024 x 600')
    b, page, logs = await setup(p, w=1024, h=600)
    await page.emulate_media(reduced_motion='reduce')
    page.set_default_timeout(240000)  # frames can take seconds under SwiftShader on a busy machine
    await ev(page, LIGHT)
    await ev(page, world(False))
    await begin(page, 1, 'mage')

    # ---- the prologue ----
    r = await ev(page, "({ modal: __hm.UI.modal, shown: !document.getElementById('lore-pro').hidden, pages: __hm.LORE.state.pro && __hm.LORE.state.pro.pages.length })")
    check(r['modal'] == 'prologue' and r['shown'] and r['pages'] == 5, f'a new character from the title screen gets the prologue ({r})')
    t0 = await ev(page, "__hm.GAME.t")
    await frames(page, 2)
    t1 = await ev(page, "__hm.GAME.t")
    check(t1 == t0, 'the world waits while the prologue is open')
    titles = []
    for i in range(5):
        titles.append(await ev(page, "document.querySelector('#lore-pro h2').textContent"))
        art = await ev(page, "document.querySelectorAll('#lore-pro .art svg *').length")
        check(art > 60, f'page {i + 1} "{titles[-1]}" has its illustration ({art} shapes)')
        await shot(page, f'lore_prologue_{i + 1}')
        if i < 4: await page.click('#lore-pro [data-pro="next"]')
    last = await ev(page, "document.querySelector('#lore-pro [data-pro=\"next\"]').textContent")
    check(last == 'Begin', f'the last page ends with Begin ({last})')
    text5 = await ev(page, "document.querySelector('#lore-pro .text').textContent")
    name = await ev(page, "__hm.GAME.player.name")
    check(name in text5 and 'Glenrua' in text5 and 'Circle of the Stone' in text5, 'the last page speaks to this character, its town and its temple')
    # the dots jump between pages, the arrow keys turn them, and Skip closes the book
    await page.click('#lore-pro .dots [data-pro="1"]')
    check(await ev(page, "__hm.LORE.state.pro.i") == 1, 'a page dot jumps to that page')
    await page.keyboard.press('ArrowRight')
    check(await ev(page, "__hm.LORE.state.pro.i") == 2, 'the right arrow key turns the page')
    await page.click('#lore-pro [data-pro="skip"]')
    r = await ev(page, "({ modal: __hm.UI.modal, hidden: document.getElementById('lore-pro').hidden, p: __hm.LORE.progress() })")
    check(r['modal'] is None and r['hidden'] and r['p']['pro'] == 1, 'Skip closes the prologue and the character remembers it')
    check('start' in r['p']['seen'] or 'start' in await ev(page, "__hm.LORE.state.queue"), 'the first-steps note follows the prologue')
    t2 = await ev(page, "__hm.GAME.t")
    await frames(page, 2)
    check(await ev(page, "__hm.GAME.t") > t2, 'the world runs again')

    # ---- the path ----
    r = await ev(page, "({ next: __hm.LORE.progress().next, hud: document.querySelector('#lore-path .st') && document.querySelector('#lore-path .st').textContent, pot: __hm.INV.potions, gold: __hm.INV.gold })")
    check(r['next'] == 'herald' and r['hud'] == 'Speak with the herald', f'the path starts with the herald ({r["next"]}, "{r["hud"]}")')
    await ev(page, "__hm.simulate(1)")
    await ev(page, world(True))
    await shot(page, 'lore_path_desktop')
    await ev(page, world(False))
    # 1. speak with the herald: walk up and press E, then say farewell
    await ev(page, "(() => { const P = __hm.GAME.player, H = __hm.REALMS[P.faction].herald; __hm.teleport(H.x + 1.6, H.z + 0.4); __hm.simulate(0.2); __hm.fn.playerInteract(); })()")
    check(await ev(page, "__hm.UI.modal") == 'dialog', 'pressing E by the herald opens his dialog')
    await ev(page, "__hm.LORE.check()")
    check(await ev(page, "__hm.LORE.progress().done.includes('herald')") is False, 'no step completes over an open window')
    await ev(page, "[...document.querySelectorAll('#dlg-actions button')].pop().click()")
    await ev(page, "__hm.LORE.check()")
    r = await ev(page, "({ p: __hm.LORE.progress(), pot: __hm.INV.potions, toast: [...document.querySelectorAll('#banners .lore-step b')].map(b => b.textContent) })")
    check('herald' in r['p']['done'] and r['pot'] == 3 + 2, f'speaking with the herald pays two draughts ({r["pot"]})')
    check('Speak with the herald' in r['toast'], 'a banner names the step taken')
    check(r['p']['next'] == 'bounty', f'the next step is the bounty ({r["p"]["next"]})')
    # 2. reach level 5 by experience; the step pays its gold on the next look
    g0 = await ev(page, "__hm.INV.gold")
    await ev(page, "__hm.fn.addXP(2000)")
    lv = await ev(page, "__hm.GAME.prog.level")
    await ev(page, "__hm.LORE.check()")
    r = await ev(page, "({ p: __hm.LORE.progress(), gold: __hm.INV.gold })")
    check(lv >= 5 and 'lv5' in r['p']['done'] and r['gold'] - g0 == 40, f'reaching level {lv} pays 40 gold ({r["gold"] - g0})')
    # 3. a step out of order pays an item: the muster's cloak goes straight on
    await ev(page, "__hm.LORE.complete('muster')")
    r = await ev(page, "(() => { const c = __hm.INV.eq.cloak || __hm.INV.bag.find((i) => i.slot === 'cloak'); return c ? { q: c.q, name: c.name, worn: __hm.INV.eq.cloak === c } : null; })()")
    check(r is not None and r['q'] == 3 and r['worn'], f'the muster pays a rare cloak, worn at once ({r})')
    # 4. a bounty claimed from the herald
    await ev(page, "(() => { const prog = __hm.GAME.prog; prog.bounty = { type: 'wolf', camp: 0, need: 6, have: 6, name: 'young wolf', reward: 10, done: true }; __hm.LORE.check(); prog.bounty = null; __hm.LORE.check(); })()")
    r = await ev(page, "(() => { const w = __hm.INV.eq.weapon, b = __hm.INV.bag.filter((i) => i.slot === 'weapon'); return { done: __hm.LORE.progress().done, fine: [w, ...b].filter(Boolean).some((i) => i.q === 2) }; })()")
    check('bounty' in r['done'] and r['fine'], 'a bounty claimed from the herald pays a fine weapon')
    # saving: the path rides in the character's save, and counts as a change worth writing
    await ev(page, "__hm.fn.saveNow()")
    await page.wait_for_timeout(300)
    r = await ev(page, "(() => { const s = JSON.parse(localStorage.getItem('hallowmarch.save.v1')); return s && s.char ? s.char.lore : null; })()")
    check(r is not None and all(k in r['done'] for k in ('herald', 'lv5', 'muster', 'bounty')) and r['pro'] == 1, f'the path is saved with the character ({r})')
    r = await ev(page, "(() => { const F = __hm.LORE.fn, s = F.buildSave(), k1 = F.coreKey(s); s.char.lore = { done: [], seen: [], pro: 0 }; return k1 !== F.coreKey(s); })()")
    check(r, 'a step taken changes the save key, so it is written promptly')

    # ---- the Chronicle ----
    await ev(page, "__hm.fn.openMenu('char')")
    await page.click('#menu-tabs [data-tab="chronicle"]')
    r = await ev(page, "({ tab: __hm.UI.menuTab, secs: document.querySelectorAll('.chron-nav [data-sec]').length, map: !!document.querySelector('.chron .figure svg') })")
    check(r['tab'] == 'chronicle' and r['secs'] >= 8 and r['map'], f'the Chronicle tab opens with its sections and the map ({r})')
    await shot(page, 'lore_chronicle_march')
    for sec, sel, n in [('war', '.dg-wide svg rect', 6), ('orders', '.chron .order', 7), ('realms', '.chron .rcard', 3), ('path', '.chron .steps li', 15)]:
        await page.click(f'.chron-nav [data-sec="{sec}"]')
        k = await ev(page, f"document.querySelectorAll('{sel}').length")
        check(k >= n, f'the Chronicle section "{sec}" shows its {n} parts ({k})')
        if sec in ('war', 'path'): await shot(page, f'lore_chronicle_{sec}')
    r = await ev(page, "[...document.querySelectorAll('.chron .steps li')].map((li) => li.className)")
    check(r[:3] == ['done', 'done', 'done'] and r.count('done') == 4 and r.count('cur') == 1, f'the path in the Chronicle marks what is done ({r[:6]})')
    # the prologue again, from the Chronicle; Escape closes it
    await page.click('.chron [data-lore="prologue"]')
    r = await ev(page, "({ modal: __hm.UI.modal, replay: __hm.LORE.state.pro && __hm.LORE.state.pro.replay, menu: document.getElementById('menu').hidden })")
    check(r['modal'] == 'prologue' and r['replay'] and r['menu'], 'the prologue can be replayed from the Chronicle')
    await page.keyboard.press('Escape')
    check(await ev(page, "__hm.UI.modal") is None, 'Escape closes the prologue')

    # ---- field notes and the death sheet ----
    r = await ev(page, "(() => { __hm.LORE.loreNote('keep'); for (let i = 0; i < 6 && !__hm.LORE.progress().seen.includes('keep'); i++) { __hm.LORE.state.noteUntil = 0; __hm.frame(); } return { seen: __hm.LORE.progress().seen, note: [...document.querySelectorAll('#banners .lore-note b')].map((b) => b.textContent) }; })()")
    check('keep' in r['seen'] and 'An enemy keep' in r['note'], f'a field note shows once and is remembered ({r["note"]})')
    await ev(page, "(() => { const P = __hm.GAME.player; __hm.fn.killEnt(P, null); __hm.frame(); })()")
    r = await ev(page, "({ modal: __hm.UI.modal, note: (document.getElementById('lore-dnote') || {}).textContent || '' })")
    check(r['modal'] == 'death' and 'nothing but the walk back' in r['note'], 'the first death carries a field note')
    await page.click('#btn-release')

    # ---- every other step, through the world's own state ----
    r = await ev(page, """(() => {
      const H = __hm, F = H.fn, L = H.LORE, P = H.GAME.player;
      const settle = () => { for (let i = 0; i < 4; i++) L.check(); };
      // fight beside a warband of your realm
      const m = F.spawnRealmUnit(P.faction, 'warrior', 10, 'soldier', P.x + 3, P.z);
      const wb = { id: 999, realm: P.faction, members: [m.id], order: null, dead: false };
      H.WAR.warbands.push(wb);
      m.combatUntil = P.combatUntil = H.GAME.t + 5;
      settle();
      H.WAR.warbands.splice(H.WAR.warbands.indexOf(wb), 1); F.removeEnt(m);
      // break an enemy keep's gate
      const K = H.WAR.keeps.find((k) => k.realm !== P.faction);
      settle();
      H.teleport(K.door.x + 6, K.door.z);
      F.dealDamage(P, K.door, 1e9, { siege: true });
      settle();
      // slay a borderland champion
      const c = H.CAMPS.find((q) => q.elite && F.getEnt(q.eliteId)), e = F.getEnt(c.eliteId);
      H.teleport(e.x + 4, e.z);
      settle();
      F.dealDamage(P, e, 1e9);
      settle();
      // carry a hallow home to your temple gate
      const rel = H.WAR.relics.find((x) => x.realm !== P.faction);
      F.pickUpRelic(rel, P);
      settle();
      const tg = H.WAR.temples[P.faction].nav.tg;
      H.teleport(tg.x, tg.z);
      H.simulate(0.1);
      settle();
      // the Hollow King falls
      H.GAME.prog.kingKills = 1;
      settle();
      return { done: L.progress().done, gate: K.door.alive, champ: e.alive, rel: rel.state + '@' + rel.at, me: P.faction };
    })()""")
    for k in ('warband', 'gate', 'champion', 'hallow', 'king'):
        check(k in r['done'], f'the step "{k}" is taken in the world ({r["gate"]}, {r["champ"]}, {r["rel"]})')
    await ev(page, "__hm.fn.enterBarrow()")
    await page.wait_for_timeout(1500)
    await ev(page, "(() => { for (let i = 0; i < 4; i++) __hm.LORE.check(); })()")
    r = await ev(page, "({ done: __hm.LORE.progress().done, inside: __hm.INDOOR.on })")
    check(r['inside'] and 'barrow' in r['done'], 'entering the Barrow takes its step')
    await ev(page, "__hm.fn.leaveBarrow()")
    await page.wait_for_timeout(1500)

    # ---- saves from before the path ----
    r = await ev(page, """(() => {
      const F = __hm.LORE.fn, s = F.buildSave();
      delete s.char.lore; s.char.level = 12; s.char.xp = 0; s.char.gold = 50; s.char.bounty = null;
      __hm.fn.newCharacter();
      const v = F.validSave(JSON.parse(JSON.stringify(s)));
      F.startGame({ ...v.char });
      return { p: __hm.LORE.progress(), gold: __hm.INV.gold, level: __hm.GAME.prog.level };
    })()""")
    check(r['level'] == 12 and r['gold'] == 50, 'an old save still loads, and no rewards are paid for what came before')
    check(all(k in r['p']['done'] for k in ('herald', 'bounty', 'lv5', 'draught')) and r['p']['next'] == 'muster', f'an old character starts the path at a fitting step ({r["p"]["next"]})')
    r = await ev(page, "__hm.LORE.fn.loreSanitize({ done: ['herald', 'bogus', 7, 'herald'], seen: 'nope', pro: 'yes' })")
    check(r == {'done': ['herald'], 'seen': [], 'pro': 1}, f'a damaged path in a save is cleaned up ({r})')

    errs = await ev(page, "__hm.errors")
    check(errs == [], f'no errors ({errs[:2]})')
    for l in logs[-5:]: print('  ', l)
    await b.close()

async def phone(p):
    print('phone, 390 x 780, touch')
    b, page, logs = await setup(p, touch=True, w=390, h=780)
    await page.emulate_media(reduced_motion='reduce')
    page.set_default_timeout(240000)  # frames can take seconds under SwiftShader on a busy machine
    await ev(page, LIGHT)
    await ev(page, world(False))
    await begin(page, 2, 'warrior')
    check(await ev(page, "__hm.UI.modal") == 'prologue', 'the prologue opens on a phone')
    await shot(page, 'lore_phone_prologue_1')
    await page.click('#lore-pro [data-pro="next"]')
    await page.click('#lore-pro [data-pro="next"]')
    r = await ev(page, "(() => { const b = document.querySelector('#lore-pro .book').getBoundingClientRect(); return { w: b.width, h: b.height, sw: document.documentElement.scrollWidth }; })()")
    check(r['w'] <= 390 and r['h'] <= 780 and r['sw'] <= 390, f'the book fits the phone screen ({r})')
    await page.click('#lore-pro [data-pro="skip"]')
    check(await ev(page, "__hm.UI.modal") is None, 'Skip closes it on a phone')
    await ev(page, "__hm.simulate(1)")
    await ev(page, world(True))
    await frames(page, 1)
    r = await ev(page, "(() => { const e = document.getElementById('lore-path'), r = e.getBoundingClientRect(), f = document.getElementById('pf').getBoundingClientRect(); return { min: e.classList.contains('min'), top: r.top, pfb: f.bottom, right: r.right, h: r.height }; })()")
    check(r['min'] and r['top'] >= r['pfb'] and r['right'] <= 390 and r['h'] < 50, f'the path sits folded under the player frame ({r})')
    await ev(page, "document.getElementById('zonetoast').classList.remove('on')")  # the zone name fades by itself after a few seconds
    await shot(page, 'lore_phone_path')
    await page.click('#lore-path [data-act="max"]')
    r = await ev(page, "(() => { const e = document.getElementById('lore-path'); return { min: e.classList.contains('min'), hint: !!e.querySelector('.hint') }; })()")
    check(not r['min'] and r['hint'], 'a tap unfolds the next step')
    await shot(page, 'lore_phone_path_open')
    await ev(page, world(False))
    await page.click('#lore-path [data-act="open"]')
    r = await ev(page, "({ modal: __hm.UI.modal, tab: __hm.UI.menuTab, sec: __hm.LORE.state.chronSec })")
    check(r == {'modal': 'menu', 'tab': 'chronicle', 'sec': 'path'}, f'tapping the step opens your path in the Chronicle ({r})')
    await shot(page, 'lore_phone_chronicle_path')
    await page.click('.chron-nav [data-sec="war"]')
    r = await ev(page, "(() => { const t = document.querySelector('.dg-tall'), w = document.querySelector('.dg-wide'); return { tall: getComputedStyle(t).display, wide: getComputedStyle(w).display, sw: document.querySelector('#menu .sheet').scrollWidth, cw: document.querySelector('#menu .sheet').clientWidth }; })()")
    check(r['tall'] == 'block' and r['wide'] == 'none' and r['sw'] <= r['cw'] + 1, f'the war diagram stands tall on a phone and nothing overflows ({r})')
    await ev(page, "document.querySelector('.chron .figure').scrollIntoView()")
    await shot(page, 'lore_phone_chronicle_war')
    errs = await ev(page, "__hm.errors")
    check(errs == [], f'no errors ({errs[:2]})')
    for l in logs[-5:]: print('  ', l)
    await b.close()

async def main():
    async with async_playwright() as p:
        if 'desktop' in PARTS: await desktop(p)
        if 'phone' in PARTS: await phone(p)
    print(f'{len(FAILS)} failed' if FAILS else 'all passed', f'in {time.time() - T0:.0f}s')
    for f in FAILS: print('  FAIL', f)
    sys.exit(1 if FAILS else 0)

asyncio.run(main())
