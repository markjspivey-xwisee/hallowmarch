"""[guide] Players know what to do (version 13): a new player's first steps by touch alone on a phone, and on a desk.
Phone (390x780, touch only: taps, swipes and the stick; window.__hm only sets the scene and lets time pass): the title
screen tapped through, the prologue turned by swipes, the first-steps note first and on the screen (field notes used to
wait out of sight on an upright phone), the path's next step marked on the minimap (a gold gem, or an arrow on its rim)
with how far and which way, the stick walking you toward it, the herald by Use, the bounty moving the mark, field notes
for the systems held while you fight (unless they are about the fight), shown once and dismissed by a tap, the
Chronicle's Aims, Gear and Sieges pages and the How to play screen on a phone, every new step of the path taken through
the world's own state (a meal, a thing made, a tower's top, an order, a keep, the realm's gift, Cinderwing, a
masterwork, a campaign) and paid, an old character's save gaining the new steps quietly, notes fitting every phone size.
Desk (1024x600): H and J, the help's keys, a page's link to another, the map's mark.
usage: python3 tools/tests/guide.py [phone] [desk] [noshots]"""
import asyncio, json, sys, pathlib, time
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
from hmlib import setup, OUT
from playwright.async_api import async_playwright

ARGS = sys.argv[1:]
SHOTS = 'noshots' not in ARGS
PARTS = [a for a in ARGS if a in ('phone', 'desk')] or ['phone', 'desk']
FAILS = []
T0 = time.time()

def check(ok, msg):
    print(('  ok   ' if ok else '  FAIL ') + msg, flush=True)
    if not ok: FAILS.append(msg)

async def ev(page, js):
    return await page.evaluate(js)

HOLD = """(() => { if (window.__rafWrapped) { window.__rafHold = true; return 0; } window.__rafWrapped = true; window.__rafHold = true; const raf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = (cb) => raf((t) => { if (window.__rafHold) window.requestAnimationFrame(cb); else cb(t); }); __hm.quality.scale = 0.5; dispatchEvent(new Event('resize')); return 0; })()"""

HELP = r"""
window.GD = {
  H: window.__hm,
  P() { return this.H.GAME.player; },
  calm(r = 80) { const H = this.H, P = this.P(); for (const e of H.ENT) if (e !== P && e.alive && e.kind !== 'door' && !e.siegeEngine && H.fn.isEnemy(P, e) && Math.hypot(e.x - P.x, e.z - P.z) < r) { e.alive = false; e.removeAt = H.GAME.t; } P.hp = P.maxHp; P.buffs.length = 0; P.casting = null; P.target = null; P.combatUntil = 0; return 0; },
  // the HUD laid out now (the page's own pass runs four times a second of wall time)
  lay() { const L = this.H.hud.HUDL; L.k = 0; L.t = 0; this.H.hud.hudLayout(1); return 0; },
  // a field note on the screen now: shown, laid out, and held there (it fades on the wall clock)
  noteOn(id) { const H = this.H, L = H.GAME.prog.lore; L.seen = L.seen.filter((x) => x !== id); H.LORE.state.noteUntil = 0; H.LORE.loreNote(id); const q = H.LORE.state.queue; q.splice(q.indexOf(id), 1); q.unshift(id); H.hud.note(id); const d = [...document.querySelectorAll('#banners .lore-note')].pop(); if (d) { d.remove = () => {}; d.style.animation = 'none'; } this.lay(); return 0; },
  // where a panel is, and whether it is clear of every other panel the layout placed and on the screen
  clear(sel) {
    const el = document.querySelector(sel), Hd = this.H.hud.HUDL;
    if (!el || el.classList.contains('hl-off')) return { shown: false, placed: Hd.placed.map((p) => p.sel + ' ' + Math.round(p.x) + ',' + Math.round(p.y) + ' ' + Math.round(p.w) + 'x' + Math.round(p.h)), kids: el ? el.children.length : -1, size: innerWidth + 'x' + innerHeight };
    const kids = sel === '#banners' ? [...el.children] : [el];
    const rs = kids.map((k) => k.getBoundingClientRect()).filter((r) => r.width > 2);
    if (!rs.length) return { shown: false };
    const u = { x: Math.min(...rs.map((r) => r.left)), y: Math.min(...rs.map((r) => r.top)), r: Math.max(...rs.map((r) => r.right)), b: Math.max(...rs.map((r) => r.bottom)) };
    const hit = Hd.placed.filter((p) => p.sel !== sel && p.x < u.r - 1 && u.x < p.x + p.w - 1 && p.y < u.b - 1 && u.y < p.y + p.h - 1).map((p) => p.sel);
    return { shown: true, x: Math.round(u.x), y: Math.round(u.y), w: Math.round(u.r - u.x), h: Math.round(u.b - u.y), on: u.x >= 0 && u.y >= 0 && u.r <= innerWidth && u.b <= innerHeight, hit };
  },
  // the minimap's pixel where the next step's gem (or its rim arrow) should be: is it gold?
  gem() {
    const H = this.H, m = H.guide.GUIDE.mark, P = this.P(), cv = document.getElementById('minimap');
    if (!m || !cv) return null;
    H.guide.drawMinimap();
    const S = cv.width, k = S / 260, c = S / 2;
    let x = (m.x - P.x) * k + c, y = (m.z - P.z) * k + c;
    const pad = 9 * Math.min(2, devicePixelRatio || 1), inside = x > pad && y > pad && x < S - pad && y < S - pad;
    if (!inside) { const a = Math.atan2(y - c, x - c), r = c - 7 * Math.min(2, devicePixelRatio || 1), q = Math.min(Math.abs(r / Math.cos(a)), Math.abs(r / Math.sin(a))); x = c + Math.cos(a) * q; y = c + Math.sin(a) * q; }
    const d = cv.getContext('2d').getImageData(Math.round(x) - 1, Math.round(y) - 1, 3, 3).data;
    let gold = 0; for (let i = 0; i < d.length; i += 4) if (d[i] > 200 && d[i + 1] > 150 && d[i + 2] < 150) gold++;
    return { inside, gold };
  },
  // one look of the path's watch with no window open; what the path now has
  steps() { const L = this.H.LORE; for (let i = 0; i < 3; i++) L.check(); return L.progress(); },
  overflow() { const s = document.querySelector('#menu .sheet'); return s ? s.scrollWidth - s.clientWidth : 0; },
};
0;
"""

async def tap(page, sel, frames=2):
    """a finger on the middle of what the screen shows for sel (it must be the topmost thing there)"""
    await ev(page, "__hm.frame(1/30); GD.lay(); 0")
    box = await page.evaluate("""((sel) => { const el = document.querySelector(sel); if (!el) return null; const r = el.getBoundingClientRect(); if (r.width < 2 || r.height < 2) return null;
      const x = r.left + r.width / 2, y = r.top + r.height / 2, hit = document.elementFromPoint(x, y);
      return { x, y, top: !!hit && (hit === el || el.contains(hit)), hit: hit ? (hit.id || String(hit.className).slice(0, 30)) : null }; })""", sel)
    if not box or not box['top']:
        print('  cannot tap', sel, json.dumps(box)); return False
    await page.touchscreen.tap(box['x'], box['y'])
    for _ in range(frames): await ev(page, "__hm.frame(1/30); 0")
    return True

async def swipe(page, x0, x1, y):
    """a finger drawn across the page: the pointer events a touch screen sends (the prologue turns on them)"""
    await page.evaluate("""([x0, x1, y]) => { const t = document.elementFromPoint(x0, y) || document.body, o = { bubbles: true, pointerType: 'touch', isPrimary: true, pointerId: 7 };
      t.dispatchEvent(new PointerEvent('pointerdown', { ...o, clientX: x0, clientY: y }));
      for (let k = 1; k <= 5; k++) t.dispatchEvent(new PointerEvent('pointermove', { ...o, clientX: x0 + (x1 - x0) * k / 5, clientY: y }));
      t.dispatchEvent(new PointerEvent('pointerup', { ...o, clientX: x1, clientY: y })); return 0; }""", [x0, x1, y])

async def shot(page, name):
    if not SHOTS: return
    await ev(page, "__hm.frame(1/30); GD.lay(); 0")
    await page.screenshot(path=OUT + name + '.png', timeout=300000)
    print(f'  shot {name} ({time.time() - T0:.0f}s)', flush=True)

async def phone(p):
    print('phone, 390 x 780, touch only', flush=True)
    b, page, logs = await setup(p, touch=True, w=390, h=780)
    await page.emulate_media(reduced_motion='reduce')  # the Chronicle's pages fade in on the wall clock otherwise
    page.set_default_timeout(300000)
    cdp = await page.context.new_cdp_session(page)
    await ev(page, HELP)
    await ev(page, HOLD)  # the page's own frames wait: every frame is drawn when the test asks (taps and swipes are not held up)
    # ---- the title screen, tapped through ----
    for sel in ['#realm-pick [data-realm="1"]', '#class-pick [data-cls="mage"]', '#btn-begin']:
        r = await page.evaluate("(sel) => { const el = document.querySelector(sel), r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }", sel)
        await page.touchscreen.tap(r['x'], r['y'])
    await page.wait_for_timeout(600)
    check(await ev(page, "__hm.UI.modal") == 'prologue', 'tapping a realm, a calling and Enter the realm opens the prologue')
    # ---- the prologue, turned by swipes; Begin on the last page ----
    for i in range(4):
        await swipe(page, 330, 120, 200)
        await page.wait_for_timeout(150)
    r = await ev(page, "({ i: __hm.LORE.state.pro && __hm.LORE.state.pro.i, p: __hm.LORE.state.pro && __hm.LORE.state.pro.pages[4].p.join(' ') })")
    check(r['i'] == 4, f'four swipes turn to the last page ({r["i"]})')
    check('gold gem' in (r['p'] or '') and 'cook what you hunt' in (r['p'] or ''), 'the last page tells of the living side of the March and the gem on the minimap')
    check(await tap(page, '#lore-pro [data-pro="next"]'), 'Begin is tapped')
    r = await ev(page, "({ modal: __hm.UI.modal, q: __hm.LORE.state.queue.slice(), seen: __hm.LORE.progress().seen.slice() })")
    check(r['modal'] is None and (r['q'][:1] == ['start'] or 'start' in r['seen']), f'the first-steps note comes first ({r["q"]}, {r["seen"]})')
    await ev(page, "GD.calm(); __hm.simulate(0.3); __hm.frame(1/30); 0")
    r = await ev(page, "({ seen: __hm.LORE.progress().seen.slice(), quiet: __hm.guide.GUIDE && typeof guideQuiet === 'undefined' })")
    check(r['seen'][:1] == ['start'], f'no other note shows before it ({r["seen"]})')
    # the note on the screen, clear of every panel, on every phone size
    await ev(page, "GD.noteOn('start')")
    r = await ev(page, "GD.clear('#banners')")
    check(r.get('shown') and r.get('on') and not r.get('hit'), f'the first-steps note is on an upright phone\'s screen, clear of the other panels ({r})')
    await ev(page, "document.getElementById('zonetoast').classList.remove('on'); 0")
    await shot(page, 'guide_phone_start')
    for (w, h) in [(360, 640), (844, 390), (667, 375)]:
        await page.set_viewport_size({'width': w, 'height': h})
        await page.wait_for_timeout(250)
        await ev(page, "GD.noteOn('needs')")
        r = await ev(page, "(() => { const c = GD.clear('#banners'); c.compact = document.getElementById('banners').classList.contains('hl-compact'); return c; })()")
        check(r.get('shown') and r.get('on') and not r.get('hit'), f'a field note fits a {w}x{h} phone, clear of the other panels, {"shrunk to its title" if r.get("compact") else "whole"} ({r})')
        if r.get('compact') and w == 844: await shot(page, 'guide_phone_note_small')
    await page.set_viewport_size({'width': 390, 'height': 780})
    await page.wait_for_timeout(250)
    await ev(page, "for (const d of [...document.querySelectorAll('#banners > *')]) d.parentNode.removeChild(d); GD.lay(); 0")

    # ---- the next step's place: the herald, 70 m off ----
    r = await ev(page, """(() => { const H = __hm, P = GD.P(), Rh = H.REALMS[P.faction].herald; H.teleport(Rh.x + 70, Rh.z); GD.calm(); H.simulate(0.2); const m = H.guide.mark(); H.LORE.state.hudT = 0; H.frame(1/30); GD.lay(); return { m, gem: GD.gem(), chip: document.querySelector('#lore-path .st').textContent }; })()""")
    check(r['m'] and 'Herald' in r['m']['what'] and r['m']['where'].startswith('70 m west'), f'the next step is marked: the herald, 70 m west ({r["m"]})')
    check(r['gem'] and r['gem']['inside'] and r['gem']['gold'] >= 3, f'a gold gem on the minimap where the herald stands ({r["gem"]})')
    check('70 m' in r['chip'], f'the folded path says how far ({r["chip"]})')
    await ev(page, "document.getElementById('zonetoast').classList.remove('on'); 0")  # the zone's name dims the folded path for three seconds after a journey
    check(await tap(page, '#lore-path [data-act="max"]'), 'a tap unfolds the path')
    r = await ev(page, "(document.querySelector('#lore-path .gd-where') || {}).textContent || ''")
    check('70 m west' in r, f'the unfolded step says where and which way ({r})')
    await shot(page, 'guide_phone_path')
    # the stick walks you there: the camera turned toward the gem, push up for two seconds
    r = await ev(page, """(() => { const H = __hm, P = GD.P(), m = H.guide.GUIDE.mark; const yaw = Math.atan2(m.x - P.x, m.z - P.z); P.yaw = yaw; H.CAM.yaw = yaw; return Math.round(Math.hypot(m.x - P.x, m.z - P.z)); })()""")
    d0 = r
    await cdp.send('Input.dispatchTouchEvent', {'type': 'touchStart', 'touchPoints': [{'x': 90, 'y': 600, 'id': 1}]})
    await ev(page, "__hm.frame(1/30); 0")
    for k in range(1, 5): await cdp.send('Input.dispatchTouchEvent', {'type': 'touchMove', 'touchPoints': [{'x': 90, 'y': 600 - 60 * k / 4, 'id': 1}]})
    await ev(page, "(() => { for (let i = 0; i < 20; i++) __hm.simulate(0.1); return 0; })()")
    await cdp.send('Input.dispatchTouchEvent', {'type': 'touchEnd', 'touchPoints': []})
    d1 = await ev(page, "(() => { const m = __hm.guide.GUIDE.mark, P = GD.P(); return Math.round(Math.hypot(m.x - P.x, m.z - P.z)); })()")
    check(d1 < d0 - 5, f'the stick walks you toward the gem ({d0} m, then {d1} m)')
    # ---- the herald, by Use ----
    await ev(page, "(() => { const H = __hm, P = GD.P(), Rh = H.REALMS[P.faction].herald; H.teleport(Rh.x + 1.6, Rh.z + 0.4); GD.calm(); H.simulate(0.2); return 0; })()")
    check(await tap(page, '#t-use'), 'Use is tapped by the herald')
    check(await ev(page, "(() => { __hm.LORE.check(); return __hm.UI.modal; })()") == 'dialog', 'the herald speaks')
    check(await tap(page, '#dlg-actions button.primary'), 'Accept bounty is tapped')
    r = await ev(page, "(() => { const H = __hm; const p = GD.steps(); H.guide.GUIDE.markT = 0; const m = H.guide.mark(); return { p, b: H.GAME.prog.bounty && ('the ' + H.guide.pluralName(H.GAME.prog.bounty.name)), m }; })()")
    check('herald' in r['p']['done'] and r['p']['next'] == 'bounty', f'speaking with the herald takes the first step ({r["p"]["next"]})')
    check(r['b'] and r['m'] and r['b'] == r['m']['what'], f'the gem moves to the bounty\'s creatures, named as many ({r["m"]})')

    # ---- field notes: held in a fight unless about the fight, shown once, dismissed by a tap ----
    await ev(page, "for (const d of [...document.querySelectorAll('#banners > *')]) d.parentNode.removeChild(d); 0")
    r = await ev(page, """(() => { const H = __hm, P = GD.P(), L = H.LORE; GD.calm(); H.surv.SURV.hunger = 0.3; H.GAME.prog.lore.seen = H.GAME.prog.lore.seen.filter((x) => x !== 'needs' && x !== 'burning');
      P.combatUntil = H.GAME.t + 30; L.check(); L.state.noteUntil = 0; H.frame(1/30);
      const held = !L.progress().seen.includes('needs') && L.state.queue.includes('needs');
      P.buffs.push({ kind: 'burn', until: H.GAME.t + 6, src: null, v: 0, tick: 99 }); L.check(); L.state.noteUntil = 0; H.frame(1/30);
      const fightNote = L.progress().seen.includes('burning');
      P.buffs.length = 0; P.combatUntil = 0; L.state.noteUntil = 0; H.frame(1/30);
      return { held, fightNote, after: L.progress().seen.includes('needs'), banners: [...document.querySelectorAll('#banners .lore-note b')].map((b) => b.textContent) }; })()""")
    check(r['held'], 'a note on food and water waits while you fight')
    check(r['fightNote'], 'a note about the fight (on fire) shows in it')
    check(r['after'], f'the held note shows once the fight is over ({r["banners"]})')
    await ev(page, "GD.lay(); 0")
    n0 = await ev(page, "document.querySelectorAll('#banners .lore-note').length")
    check(await tap(page, '#banners .lore-note:not(.hl-old):last-child'), 'a note is tapped')
    n1 = await ev(page, "document.querySelectorAll('#banners .lore-note').length")
    check(n1 < n0, f'a tap dismisses it ({n0} then {n1})')
    # every new note's watch, through the world's own state
    await ev(page, "(() => { if (!document.getElementById('menu').hidden) document.getElementById('btn-resume').click(); __hm.UI.modal = null; return 0; })()")  # a tap on a note shrunk to its title opens the Chronicle
    r = await ev(page, """(() => { const H = __hm, G = H.guide, P = GD.P(), seen = () => H.LORE.progress().seen, out = {};
      const want = (id, set, unset) => { set(); G.GUIDE.scanT = 0; for (let i = 0; i < 3; i++) { H.LORE.check(); H.LORE.state.noteUntil = 0; H.frame(1/30); } out[id] = seen().includes(id); if (unset) unset(); };
      want('brand', () => { P.brand = { until: H.GAME.t + 30, wet: 0, x: P.x, y: P.y + 1.4, z: P.z, emitAcc: 0 }; }, () => { P.brand = null; });
      want('gear', () => { const it = Object.values(H.INV.eq).find(Boolean); if (it) it.dur = 20; P.dirt = 0.6; });
      want('walls', () => { G.GUIDE.wallSeen = true; });
      return out; })()""")
    check(r['brand'] and r['gear'] and r['walls'], f'the notes for a brand, worn gear and a shot into a wall are watched ({r})')
    await shot(page, 'guide_phone_note')

    # ---- the Chronicle on a phone: Aims, Gear, Sieges; the How to play screen ----
    # no more notes for a while: the path tracker has its room back
    await ev(page, "__hm.LORE.state.queue.length = 0; __hm.LORE.state.noteUntil = performance.now() + 1e9; for (const d of [...document.querySelectorAll('#banners > *')]) d.parentNode.removeChild(d); GD.lay(); 0")
    dbg = await ev(page, "(() => { const e = document.getElementById('lore-path'); __hm.LORE.state.hudT = 0; __hm.frame(1/30); GD.lay(); const r = e.getBoundingClientRect(); return { cls: e.className, disp: getComputedStyle(e).display, r: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)], open: !!e.querySelector('[data-act=open]'), tf: !document.getElementById('tf').hidden, modal: __hm.UI.modal }; })()")
    ok = await tap(page, '#lore-path [data-act="open"]')
    check(ok, f'the step is tapped ({dbg})')
    r = await ev(page, "({ modal: __hm.UI.modal, sec: __hm.LORE.state.chronSec, n: document.querySelectorAll('.chron .steps li').length })")
    check(r['modal'] == 'menu' and r['sec'] == 'path' and r['n'] == 24, f'it opens your path: twenty-four steps ({r})')
    for sec, want in [('goals', ['Level 20', 'Level 30', 'Level 40', 'Level 50', 'Realm rank']), ('gear', ['Wear', 'Mud and blood', 'Masterworks']), ('callings', ['warrior'])]:
        ok = await tap(page, f'.chron-nav [data-sec="{sec}"]')
        r = await ev(page, "({ t: document.querySelector('.chron-body').textContent, o: GD.overflow(), errs: __hm.errors.length })")
        check(ok and all(w in r['t'] for w in want) and r['o'] <= 1, f'the Chronicle page "{sec}" reads on a phone ({[w for w in want if w not in r["t"]]}, overflow {r["o"]})')
        if sec == 'goals': await shot(page, 'guide_phone_aims')
    check(await tap(page, '.chron-nav [data-grp="war"]'), 'the war part is tapped')
    ok = await tap(page, '.chron-nav [data-sec="sieges"]')
    r = await ev(page, "({ t: document.querySelector('.chron-body').textContent, o: GD.overflow() })")
    check(ok and 'Engines' in r['t'] and 'Towers and ladders' in r['t'] and 'Breaches' in r['t'] and r['o'] <= 1, f'the Sieges page has the engines, breaches and towers (overflow {r["o"]})')
    check(await tap(page, '#menu-tabs [data-tab="help"]'), 'How to play is tapped')
    r = await ev(page, "({ t: document.getElementById('menu-body').textContent, o: GD.overflow() })")
    want = ['Left thumb', 'Use', 'Food and water bars', 'Your path', 'Keeps, towers and sieges', 'Water', 'Food, water and crafting', 'Animals', 'Keep halls and building']
    check(all(w in r['t'] for w in want) and r['o'] <= 1, f'How to play gives a phone\'s controls and every system\'s lines ({[w for w in want if w not in r["t"]]})')
    check('press E' not in r['t'] and 'Press V' not in r['t'], 'and speaks of taps, not keys')
    await shot(page, 'guide_phone_help')
    check(await tap(page, '#btn-resume'), 'Resume closes the menu')

    # ---- every new step of the path, through the world's own state, each paid ----
    r = await ev(page, """(() => { const H = __hm, F = H.fn, P = GD.P(), L = H.LORE, out = {};
      GD.calm(); for (const id of ['bounty', 'lv5', 'draught']) L.complete(id);
      const gold0 = H.INV.gold;
      H.guide.guideMade({ id: 'roast_meat', skill: 'cook', st: 'fire' }); out.cook = GD.steps().done.includes('cook');
      H.guide.guideMade({ id: 'leather', st: 'tanning' }); out.craft = GD.steps().done.includes('craft');
      // the top of a tower of a keep of your realm
      const T = H.guide.TOWER.list.find((t) => !t.breached && t.C && t.C.S && H.WAR.keeps.some((K) => K.site === t.C.S && K.realm === P.faction)) || H.guide.TOWER.list[0];
      H.teleport(T.wx, T.wz); P.y = T.S.y + T.levels[T.levels.length - 1] + 0.05; out.climb = GD.steps().done.includes('climb');
      // an order of yours to a band of your realm
      let wb = H.WAR.warbands.find((w) => w.realm === P.faction && !w.dead) || null, made = null; let o0 = null;
      if (!wb) { made = F.spawnRealmUnit(P.faction, 'warrior', 10, 'soldier', P.x + 3, P.z); wb = { id: 998, realm: P.faction, members: [made.id], order: null, dead: false }; H.WAR.warbands.push(wb); }
      o0 = wb.order; wb.order = { type: 'rally', byPlayer: true }; out.command = GD.steps().done.includes('command'); wb.order = o0;
      if (made) { H.WAR.warbands.splice(H.WAR.warbands.indexOf(wb), 1); F.removeEnt(made); }
      // a keep turned to your realm with you there
      const K = H.WAR.keeps.find((k) => k.realm !== P.faction); const r0 = K.realm; H.teleport(K.site.x + 8, K.site.z); GD.steps(); K.realm = P.faction; out.keep = GD.steps().done.includes('keep'); K.realm = r0;
      // the realm's gift called by you
      H.gifts.GIFT.lastCast = { id: 'x', by: P.id, t: H.GAME.t, realm: P.faction }; out.gift = GD.steps().done.includes('gift'); H.gifts.GIFT.lastCast = null;
      return out; })()""")
    for k in ('cook', 'craft', 'climb', 'command', 'keep', 'gift'):
        check(r.get(k) is True, f'the step "{k}" is taken in the world ({r.get(k)})')
    r = await ev(page, """(() => { const H = __hm, G = H.guide, P = GD.P(), out = {};
      // a named masterwork in your bags, a campaign won with you in it
      const it = G.makeItem({ cls: P.cls, realm: P.faction, lvl: 40, q: 4, slot: 'weapon' }); it.name = 'Stormwrack'; G.bagAdd(it); out.master = GD.steps().done.includes('master');
      G.CAMPAIGN.history.push({ n: 999, w: P.faction, how: 'keeps', m: 30, you: { r: P.faction } }); out.campaign = GD.steps().done.includes('campaign'); G.CAMPAIGN.history.pop();
      return out; })()""")
    check(r.get('master') is True, f'the step "master" is taken when a named masterwork is in your bags ({r})')
    check(r.get('campaign') is True, f'the step "campaign" is taken when your realm wins a campaign with you in it ({r})')
    # Cinderwing: hit by you (a fifth of its harm: [guide2] a single blow from afar no longer counts), then fallen
    r = await ev(page, """(() => { const H = __hm, P = GD.P(), L = H.LORE, Dg = H.guide.dragon(); if (!Dg) return 'no dragon';
      const a0 = Dg.alive; Dg.alive = true; Dg.removed = false; Dg.damagers = new Set([P.id]); Dg.threat = new Map([[P.id, Dg.maxHp * 0.2]]); GD.steps(); H.teleport(Dg.x + 20, Dg.z); Dg.alive = false; const done = GD.steps().done.includes('dragon'); Dg.alive = a0; return done; })()""")
    check(r is True, f'the step "dragon" is taken when Cinderwing falls with your blows in it ({r})')
    r = await ev(page, "({ banners: [...document.querySelectorAll('#banners .lore-step b')].map((b) => b.textContent), errs: __hm.errors.slice(0, 3) })")
    check(len(r['banners']) >= 1, f'each step taken is named in a banner ({r["banners"][-3:]})')

    # ---- an old character's save: the new early steps taken quietly, the late ones still ahead ----
    r = await ev(page, """(() => { const F = __hm.LORE.fn, s = F.buildSave();
      s.char.lore = { done: ['herald', 'bounty', 'lv5', 'draught', 'muster', 'warband'], seen: ['start'], pro: 1 }; s.char.level = 24; s.char.xp = 0;
      __hm.fn.newCharacter(); const v = F.validSave(JSON.parse(JSON.stringify(s))); F.startGame({ ...v.char });
      return __hm.LORE.progress(); })()""")
    check(all(k in r['done'] for k in ('cook', 'craft', 'climb')) and not any(k in r['done'] for k in ('command', 'keep', 'gift', 'dragon', 'master', 'campaign')), f'an old save gains the new early steps quietly and keeps the late ones ahead ({r["done"]})')
    check(await ev(page, "__hm.GAME.prog.lore.pv") == 2, 'and its path is now of version 2')
    errs = await ev(page, "__hm.errors")
    check(errs == [], f'no errors ({errs[:2]})')
    for l in logs[-5:]: print('  ', l)
    await b.close()

async def desk(p):
    print('desk, 1024 x 600', flush=True)
    b, page, logs = await setup(p, w=1024, h=600)
    await page.emulate_media(reduced_motion='reduce')
    page.set_default_timeout(300000)
    await ev(page, HELP)
    await ev(page, HOLD)
    await ev(page, "document.querySelector('#realm-pick [data-realm=\"0\"]').click(); document.querySelector('#class-pick [data-cls=\"warrior\"]').click(); 0")
    await page.click('#btn-begin')
    await page.wait_for_timeout(400)
    await page.keyboard.press('Escape')
    await ev(page, "GD.calm(); __hm.simulate(0.3); __hm.frame(1/30); __hm.frame(1/30); 0")
    r = await ev(page, "(document.querySelector('#banners .lore-note') || {}).textContent || ''")
    check('H shows every key' in r and 'gold gem' in r, f'the first-steps note points to H and the gem ({r[:80]})')
    await page.keyboard.press('KeyH')
    r = await ev(page, "({ tab: __hm.UI.menuTab, t: document.getElementById('menu-body').textContent })")
    want = ['W A S D', 'J · H · Esc', 'V · C', 'G · K · U', '9', 'Your path', 'Keeps, towers and sieges']
    check(r['tab'] == 'help' and all(w in r['t'] for w in want), f'H opens How to play with every key ({[w for w in want if w not in r["t"]]})')
    await page.keyboard.press('Escape')
    await page.keyboard.press('KeyJ')
    check(await ev(page, "__hm.UI.menuTab") == 'chronicle', 'J opens the Chronicle')
    await ev(page, "document.querySelector('.chron-nav [data-grp=\"war\"]').click(); 0")
    await ev(page, "document.querySelector('.chron-nav [data-sec=\"war\"]').click(); 0")
    await ev(page, "document.querySelector('.chron [data-lore=\"sec:sieges\"]').click(); 0")
    check(await ev(page, "__hm.LORE.state.chronSec") == 'sieges', 'the war page links to the Sieges page')
    await page.keyboard.press('Escape')
    # the map's mark
    await ev(page, "(() => { const H = __hm, P = GD.P(), Rh = H.REALMS[P.faction].herald; H.teleport(Rh.x + 40, Rh.z + 30); GD.calm(); H.simulate(0.2); H.guide.mark(); return 0; })()")
    await page.keyboard.press('KeyM')
    await page.wait_for_timeout(300)
    check(await ev(page, "__hm.UI.modal") == 'map', 'M opens the map')
    if SHOTS:
        await page.screenshot(path=OUT + 'guide_desk_map.png', timeout=300000)
        print(f'  shot guide_desk_map ({time.time() - T0:.0f}s)', flush=True)
    await page.keyboard.press('KeyM')
    await ev(page, "GD.noteOn('ladder')")
    r = await ev(page, "GD.clear('#banners')")
    check(r.get('shown') and r.get('on') and not r.get('hit'), f'a note on a desk sits clear of the other panels ({r})')
    await shot(page, 'guide_desk_note')
    errs = await ev(page, "__hm.errors")
    check(errs == [], f'no errors ({errs[:2]})')
    for l in logs[-5:]: print('  ', l)
    await b.close()

async def main():
    async with async_playwright() as p:
        if 'phone' in PARTS: await phone(p)
        if 'desk' in PARTS: await desk(p)
    print(f'{len(FAILS)} failed' if FAILS else 'all passed', f'in {time.time() - T0:.0f}s')
    for f in FAILS: print('  FAIL', f)
    sys.exit(1 if FAILS else 0)

asyncio.run(main())
