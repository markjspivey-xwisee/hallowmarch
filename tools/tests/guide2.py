"""[guide2] Players know what to do, with everything versions 13 and 14 added, on a phone first (version 15).
Phone (390x780, touch; window.__hm sets the scene): every Chronicle page measured before and after it folds (its natural
height, folded, the sheet's; nothing wider than the sheet at 390 and 360), a fold opened by a tap and kept, Open all, your
path's page (the steps walked and the rest folded, the step at hand open), a note shrunk to its title on a 360x640 phone
opening the field notes' page with itself first, the field notes for what came since (a keep's hall, the farmers, scaffolds
and masons, timber to set alight, houses broken by stones, a priest's Renewal, a mage's ward, a warrior's Charge) watched
through the world's own state, the war panel's line for your aim and a tap on it, a place or a pointer for the steps done
anywhere (the late levels, command, the realm's gift, a masterwork, a campaign), Cinderwing's step only for a real share,
and the companion bar's taps with the HUD changing under the finger (no tap lost).
Desk (960x540): a long page folds, the war panel's aim clicked.
usage: python3 tools/tests/guide2.py [phone] [desk] [noshots]"""
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
window.G2T = {
  H: window.__hm,
  P() { return this.H.GAME.player; },
  calm(r = 90) { const H = this.H, P = this.P(); for (const e of H.ENT) if (e !== P && e.alive && e.kind !== 'door' && !e.siegeEngine && H.fn.isEnemy(P, e) && Math.hypot(e.x - P.x, e.z - P.z) < r) { e.alive = false; e.removeAt = H.GAME.t; } P.hp = P.maxHp; P.buffs.length = 0; P.casting = null; P.target = null; P.combatUntil = 0; return 0; },
  lay() { const L = this.H.hud.HUDL; L.k = 0; L.t = 0; this.H.guide2.G2.tap.until = 0; this.H.hud.hudLayout(1); return 0; },
  // every page of the Chronicle: its natural height, folded, the sheet's, and what runs past the sheet
  pages() {
    const H = this.H, out = {};
    H.LORE.openChronicle('coach');
    if (H.UI.menuTab !== 'progress' || !document.querySelector('#march-coach-mount')) throw Error('Coach must redirect to the Progress tab');
    H.LORE.openChronicle('march');
    const keys = [...document.querySelectorAll('.chron-nav [data-sec]')].map((b) => b.dataset.sec).filter((k) => k !== 'coach');
    for (const k of keys) {
      H.LORE.openChronicle(k);
      const s = document.querySelector('#menu .sheet'), content = document.querySelector('#menu-body'), bd = document.querySelector('.chron-body'), st = H.guide2.G2.stats.pages[k] || {};
      if (!bd) throw Error('Missing Chronicle body for ' + k);
      out[k] = { h0: st.h0 || 0, h: Math.round(bd.getBoundingClientRect().height), vh: s.clientHeight, contentVh: content.clientHeight, ov: content.scrollWidth - content.clientWidth, folds: bd.querySelectorAll('details.cf').length };
    }
    return out;
  },
  // a field note through the world's own state: set, a look of the watch, unset
  watch(id, set, unset, sim = true) {
    const H = this.H, L = H.GAME.prog.lore; L.seen = L.seen.filter((x) => x !== id); H.LORE.state.queue.length = 0; H.LORE.state.noteUntil = 0;
    H.guide.GUIDE.scanT = 0; H.guide2.G2.scanT = 0;
    if (sim) H.simulate(0.05);
    set(); H.guide2.g2Scan(this.P());
    for (let i = 0; i < 3; i++) { H.LORE.check(); H.LORE.state.noteUntil = 0; H.frame(1 / 30); }
    if (unset) unset();
    const ok = H.LORE.progress().seen.includes(id) || H.LORE.state.queue.includes(id);
    for (const d of [...document.querySelectorAll('#banners > *')]) d.parentNode.removeChild(d);
    return ok;
  },
  prompt(t) { const p = document.getElementById('prompt'), q = document.getElementById('prompt-t'); if (t) { p.classList.add('on'); q._t = t; } else { p.classList.remove('on'); q._t = ''; } return 0; },
};
0;
"""

async def tap(page, sel, frames=2):
    """a finger on the middle of what the screen shows for sel (it must be the topmost thing there)"""
    await ev(page, "__hm.frame(1/30); G2T.lay(); 0")
    box = await page.evaluate("""((sel) => { const el = document.querySelector(sel); if (!el) return null; if (el.closest('#menu')) el.scrollIntoView({ block: 'center' }); const r = el.getBoundingClientRect(); if (r.width < 2 || r.height < 2) return null;
      const x = r.left + r.width / 2, y = r.top + r.height / 2, hit = document.elementFromPoint(x, y);
      return { x, y, top: !!hit && (hit === el || el.contains(hit)), hit: hit ? (hit.id || String(hit.className).slice(0, 30)) : null }; })""", sel)
    if not box or not box['top']:
        print('  cannot tap', sel, json.dumps(box)); return False
    await page.touchscreen.tap(box['x'], box['y'])
    for _ in range(frames): await ev(page, "__hm.frame(1/30); 0")
    return True

async def shot(page, name):
    if not SHOTS: return
    await ev(page, "__hm.frame(1/30); G2T.lay(); 0")
    await page.screenshot(path=OUT + name + '.png', timeout=300000)
    print(f'  shot {name} ({time.time() - T0:.0f}s)', flush=True)

async def phone(p):
    print('phone, 390 x 780, touch', flush=True)
    b, page, logs = await setup(p, touch=True, w=390, h=780)
    await page.emulate_media(reduced_motion='reduce')
    page.set_default_timeout(300000)
    cdp = await page.context.new_cdp_session(page)
    await ev(page, HELP)
    await ev(page, HOLD)
    await ev(page, "(async () => { await __hm.start({ realm: 1, cls: 'priest', level: 24 }); __hm.setTod(0.45); __hm.dbg.WEATHER.mode = 'clear'; G2T.calm(); __hm.simulate(0.3); __hm.GAME.prog.lore.seen.push('start'); __hm.LORE.state.queue.length = 0; __hm.LORE.state.noteUntil = performance.now() + 1e9; __hm.frame(1/30); return 0; })()")
    print(f'  started ({time.time() - T0:.0f}s)', flush=True)

    # ---- every page of the Chronicle, on three phones ----
    budget = {}
    for (w, h) in [(390, 780), (360, 640), (844, 390)]:
        await page.set_viewport_size({'width': w, 'height': h})
        await page.wait_for_timeout(250)
        r = await ev(page, "G2T.pages()")
        print(f'  {w}x{h}: page natural -> folded (sheet {next(iter(r.values()))["vh"]} px), folds', flush=True)
        for k, v in r.items(): print(f'     {k:10s} {v["h0"]:6d} -> {v["h"]:5d}  {v["folds"]:2d} folds' + (f'  OVERFLOW {v["ov"]}' if v['ov'] > 1 else ''), flush=True)
        over = [k for k, v in r.items() if v['ov'] > 1]
        check(not over, f'{w}x{h}: no page is wider than the sheet ({over})')
        lim = 2.4 if h > w else 3.5
        long = [f'{k} {v["h"]}' for k, v in r.items() if v['h'] > lim * v['vh']]
        check(not long, f'{w}x{h}: every page folded reads in under {lim} screens ({long})')
        budget[f'{w}x{h}'] = r
    pathlib.Path(OUT + 'guide2_pages.json').write_text(json.dumps(budget, indent=1))
    r = budget['390x780']
    check(r['callings']['h0'] > 5000 and r['callings']['h'] < 1300, f'the Callings page on an upright phone: {r["callings"]["h0"]} px, folded {r["callings"]["h"]}')
    await page.set_viewport_size({'width': 390, 'height': 780})
    await page.wait_for_timeout(250)

    # ---- a fold opened by a tap, kept when the page comes back; Open all ----
    await ev(page, "__hm.LORE.openChronicle('callings'); 0")
    r = await ev(page, "(() => { const d = document.querySelector('.chron-body details.cf-card'); return d ? { open: d.open, key: d.dataset.cf } : null; })()")
    check(r and not r['open'], f'a calling\'s card is folded under its head and first line ({r})')
    ok = await tap(page, '.chron-body .card.mine details.cf-card > summary')
    r2 = await ev(page, "(() => { const d = document.querySelector('.chron-body .card.mine details.cf-card'); return d ? d.open : null; })()")
    check(ok and r2 is True, 'a tap on your own calling\'s card opens it')
    await shot(page, 'guide2_phone_callings')
    await ev(page, "__hm.LORE.openChronicle('war'); __hm.LORE.openChronicle('callings'); 0")
    r2 = await ev(page, "(() => { const d = document.querySelector('.chron-body .card.mine details.cf-card'); return d ? d.open : null; })()")
    check(r2 is True, 'and it stays open when the page comes back')
    ok = await tap(page, '.chron-body .cf-all')
    r2 = await ev(page, "[...document.querySelectorAll('.chron-body details.cf')].every((d) => d.open)")
    check(ok and r2, 'Open all opens every fold')
    await tap(page, '.chron-body .cf-all')
    r2 = await ev(page, "[...document.querySelectorAll('.chron-body details.cf')].some((d) => d.open)")
    check(not r2, 'and Fold all shuts them')
    # what a test reads of a folded page is still there (text in a closed fold is in the page)
    r2 = await ev(page, "document.querySelector('.chron-body').textContent.includes('Steadfast')")
    check(r2, 'a folded page keeps its words (a closed fold\'s text is in the page)')

    # ---- your path's page: the step at hand, the rest folded ----
    r = await ev(page, """(() => { const H = __hm; for (const id of ['herald', 'bounty', 'lv5', 'draught', 'cook', 'craft']) H.LORE.complete(id); H.LORE.openChronicle('path');
      const cur = document.querySelector('.chron .steps li.cur'), dd = cur && cur.closest('details');
      return { n: document.querySelectorAll('.chron .steps li').length, cls: [...document.querySelectorAll('.chron .steps li')].map((li) => li.className).slice(0, 8), curShown: !!cur && !dd, folds: [...document.querySelectorAll('.chron-body details.cf summary')].map((s) => s.textContent), h: Math.round(document.querySelector('.chron-body').getBoundingClientRect().height), notes: !!document.querySelector('.chron [data-lore="sec:notes"]') }; })()""")
    check(r['n'] == 27 and r['curShown'] and len(r['folds']) == 2 and r['h'] < 900, f'your path: 27 steps ([loops]), the one at hand open, the walked and the rest folded, {r["h"]} px ({r["folds"]})')
    check(r['notes'], 'the path links to the field notes\' page')
    await shot(page, 'guide2_phone_path')

    # ---- the field notes for what came since, through the world's own state ----
    r = await ev(page, """(() => { const H = __hm, G = H.guide2, P = G2T.P(), out = {}; H.fn.closeMenu && H.fn.closeMenu(); H.UI.modal = null; document.getElementById('menu').hidden = true;
      // a keep's great hall: inside one of your realm's
      const hall = G.halls().find((h) => h.realm === P.faction) || G.halls()[0];
      out.hall = G2T.watch('hall', () => { H.teleport(hall.x, hall.z); P.y = hall.y + 0.05; }, null);
      // scaffolds and masons: the prompt by a scaffold's ladder
      out.scaffold = G2T.watch('scaffold', () => G2T.prompt('Climb the scaffold'), () => G2T.prompt(''));
      // timber to set alight with a brand
      out.setwall = G2T.watch('setwall', () => G2T.prompt('Set the palisade alight'), () => G2T.prompt(''));
      // the callings: a priest's Renewal on itself, a mage's ward, a warrior's rush
      out.renew = G2T.watch('renew', () => { P.buffs.push({ kind: 'hot', src: P.id, until: H.GAME.t + 9, v: 1, tick: 1 }); }, () => { P.buffs.length = 0; });
      const c0 = P.cls;
      out.ward = G2T.watch('ward', () => { P.cls = 'mage'; P.buffs.push({ kind: 'eward', until: H.GAME.t + 9, v: 1 }); }, () => { P.cls = c0; P.buffs.length = 0; });
      out.charge = G2T.watch('charge', () => { P.cls = 'warrior'; P.motion = { kind: 'leap', rush: true, t: 0, T: 1 }; H.LORE.check(); P.motion = null; P.cls = c0; }, null, false);
      out.dazzle = G2T.watch('dazzle', () => { P.buffs.push({ kind: 'dazzle', until: H.GAME.t + 3, value: 0.15 }); }, () => { P.buffs.length = 0; });
      out.wounded = G2T.watch('wounded', () => { P.buffs.push({ kind: 'wound', until: H.GAME.t + 6, value: 0.3 }); }, () => { P.buffs.length = 0; });
      out.chilled = G2T.watch('chilled', () => { P.buffs.push({ kind: 'chill', until: H.GAME.t + 4, value: 1 }); }, () => { P.buffs.length = 0; });
      return out; })()""")
    for k in ('hall', 'scaffold', 'setwall', 'renew', 'ward', 'charge', 'dazzle', 'wounded', 'chilled'):
        check(r.get(k) is True, f'the field note "{k}" is given in the world ({r.get(k)})')
    r = await ev(page, """(() => { const H = __hm, P = G2T.P();
      return G2T.watch('battered', () => { const h = H.guide2.nearHouse(P); if (h) { H.teleport(h.x + 9, h.z); H.batter.houseStoneHit(h, h.x, h.y + 1.2, h.z, 3, null, false); } }, null); })()""")
    check(r is True, f'the field note "battered" is given by a house battered near you ({r})')
    # the lakes' note waits for ice near you (it was given in Ériu in spring when ice lay anywhere)
    r = await ev(page, """(() => { const H = __hm, L = H.GAME.prog.lore, N = H.LORE.notes.lakeice; if (!N) return 'no note'; H.simulate(0.1); H.frame(1/30);
      const P = G2T.P(), Rh = H.REALMS[1].town; H.teleport(Rh.x, Rh.z); G2T.calm(); return { ok: typeof N.ok === 'function' ? N.ok() : 'none' }; })()""")
    check(isinstance(r, dict) and r['ok'] is False, f'the note on the lakes freezing waits in a town far from ice ({r})')
    # what is happening now: a garrison near you runs to a fire (a toast)
    r = await ev(page, """(() => { const H = __hm, P = G2T.P(), F = H.fn; for (const d of [...document.querySelectorAll('#banners > *')]) d.parentNode.removeChild(d);
      const e = F.spawnRealmUnit((P.faction + 1) % 3, 'warrior', 20, 'soldier', P.x + 30, P.z); e.ai.fire = { key: 1, kind: 'pal' }; H.guide2.G2.fireToldT = -1e9; H.guide2.g2Scan(P);
      const t = document.getElementById('banners').textContent; delete e.ai.fire; F.removeEnt(e); for (const d of [...document.querySelectorAll('#banners > *')]) d.parentNode.removeChild(d); return t; })()""")
    check('garrison leaves its posts' in r, f'a garrison running to a fire near you is told as it happens ({r[:80]})')
    # the farmers' word: by a town field (it was a toast)
    r = await ev(page, """(() => { const H = __hm, P = G2T.P(), F = H.farm.FARM; F.herbal.tips = 0; const L = H.GAME.prog.lore; L.seen = L.seen.filter((x) => x !== 'farmers'); H.LORE.state.queue.length = 0;
      const Q = F.plots.find((q) => q.own === 't'); if (!Q) return 'no field'; H.teleport(Q.x + 6, Q.z + 6); G2T.calm(); H.LORE.state.noteUntil = 0; H.UI.modal = null; for (let i = 0; i < 8; i++) { H.simulate(0.25); H.frame(1/30); }
      return H.LORE.state.queue.includes('farmers') || L.seen.includes('farmers'); })()""")
    check(r is True, f'the farmers\' word is a field note now ({r})')

    # ---- a note shrunk to its title on a small phone opens the field notes' page, itself first ----
    await page.set_viewport_size({'width': 360, 'height': 640})
    await page.wait_for_timeout(250)
    r = await ev(page, """(() => { const H = __hm, L = H.GAME.prog.lore, Rh = H.REALMS[G2T.P().faction].herald; H.UI.modal = null; document.getElementById('menu').hidden = true; H.teleport(Rh.x + 6, Rh.z + 6); G2T.calm(); H.simulate(0.2); H.frame(1/30); for (const d of [...document.querySelectorAll('#banners > *')]) d.parentNode.removeChild(d);
      L.seen = L.seen.filter((x) => x !== 'ward'); H.LORE.state.queue.length = 0; H.LORE.state.noteUntil = 0; H.LORE.loreNote('ward'); H.hud.note('ward'); const d = [...document.querySelectorAll('#banners .lore-note')].pop(); if (d) { d.style.animation = 'none'; d.remove = () => {}; } /* (it fades on the wall clock) */
      G2T.lay(); return { compact: document.getElementById('banners').classList.contains('hl-compact') || document.getElementById('banners').classList.contains('hl-brief'), brief: document.getElementById('banners').classList.contains('hl-brief'), n: document.querySelectorAll('#banners .lore-note').length }; })()""")  # [look6] or its first lines (hl-brief)
    print('  note at 360x640:', r, flush=True)
    # the zone's name over the middle of the screen fades by itself after a journey, and the plant card goes when you look
    # away: a few frames until the note has its place (a 360x640 phone has room for it beside nothing else)
    seen = await ev(page, """(() => { const H = __hm; for (let i = 0; i < 8; i++) { H.frame(1/30); document.getElementById('zonetoast').classList.remove('on'); G2T.lay();
      const d = document.querySelector('#banners .lore-note'); if (d && d.getBoundingClientRect().height > 2) return { i, placed: H.hud.HUDL.placed.map((p) => p.sel) }; H.simulate(0.25); }
      return { i: -1, placed: H.hud.HUDL.placed.map((p) => p.sel), off: [...document.querySelectorAll('.hl-off')].map((e) => e.id) }; })()""")
    print('  note placed after', seen, flush=True)
    ok = await tap(page, '#banners .lore-note')
    r2 = await ev(page, "(() => { const f = document.querySelector('.chron-body details.note-f'); return { modal: __hm.UI.modal, sec: __hm.LORE.state.chronSec, first: f ? f.dataset.note : null, open: f ? f.open : null }; })()")
    if r.get('compact'):
        check(ok and r2['sec'] == 'notes' and r2['first'] == 'ward' and r2['open'], f'a tap on a note shrunk to its title opens the field notes, itself first and open ({r2})')
        await shot(page, 'guide2_phone_notes')
    else:
        check(ok, f'the note shows whole on a 360x640 phone and a tap takes it away ({r2})')
    await ev(page, "(() => { if (!document.getElementById('menu').hidden) document.getElementById('btn-resume').click(); __hm.UI.modal = null; for (const d of [...document.querySelectorAll('#banners > *')]) d.parentNode.removeChild(d); return 0; })()")  # (the note kept for the tap goes: a note up makes room for itself and the war panel waits)
    await page.set_viewport_size({'width': 390, 'height': 780})
    await page.wait_for_timeout(250)

    # ---- a place or a pointer for the steps done anywhere ----
    r = await ev(page, """(() => { const H = __hm, G = H.guide2, P = G2T.P(), prog = H.GAME.prog, out = {};
      H.teleport(H.REALMS[P.faction].town.x + 20, H.REALMS[P.faction].town.z); G2T.calm();
      const m = (id) => { const q = G.g2MarkOf({ id }); return q ? q.what : q; };
      out.lv30 = m('lv30'); out.campaign = m('campaign');
      const R = H.REALMS[P.faction]; H.teleport(R.musterSite.x + 12, R.musterSite.z); G2T.calm(); out.campaignF = m('campaign');
      const l0 = prog.level, r0 = prog.rp; prog.level = 15; prog.rp = 0; out.command15 = m('command'); prog.level = l0; prog.rp = r0;
      out.command = m('command'); out.cmdPtr = (G.g2Pointer({ id: 'command' }) || {}).sel || null;
      prog.level = 30; out.giftPtr = (G.g2Pointer({ id: 'gift' }) || {}).sel || null; prog.level = 40; out.master = m('master');
      prog.level = l0; return out; })()""")
    check(r['lv30'], f'the late levels have a place: {r["lv30"]}')
    check(r['command15'] and 'war table' in r['command15'], f'below 20 the order is given at a war table: {r["command15"]}')
    check(r['command'] is None and r['cmdPtr'] == '#btn-map', f'from 20 there is no place but the map button ({r["cmdPtr"]})')
    check(r['giftPtr'] == '.gslot', f'the realm\'s gift points at its button ({r["giftPtr"]})')
    check(r['master'], f'a masterwork marks what it lacks first: {r["master"]}')
    check(r['campaign'] and r['campaignF'] and 'portal' not in r['campaignF'], f'a campaign marks the keep your realm fights for: {r["campaign"]} (at home), {r["campaignF"]} (on the frontier)')
    # the path's next step "command": the map button glows, the tracker says what to do
    r = await ev(page, """(() => { const H = __hm, L = H.GAME.prog.lore; for (const S of H.LORE.steps) { if (S.id === 'command') break; if (!L.done.includes(S.id)) L.done.push(S.id); }
      H.guide2.G2.pointT = 0; H.guide.GUIDE.markT = 0; for (let i = 0; i < 4; i++) H.simulate(0.25); H.LORE.state.hudT = 0; H.frame(1/30); G2T.lay();
      const e = document.getElementById('lore-path'); if (e && e.classList.contains('min')) e.querySelector('[data-act=max]').click(); H.LORE.state.hudT = 0; H.frame(1/30);
      return { next: H.LORE.progress().next, glow: document.getElementById('btn-map').classList.contains('g2-point'), line: (document.querySelector('#lore-path .gd-where') || {}).textContent || '' }; })()""")
    check(r['next'] == 'command' and r['glow'] and 'map button' in r['line'], f'the next step "command": the map button glows and the path says to open the map ({r})')

    # ---- the war panel's line for your aim, a tap from the Chronicle ----
    r = await ev(page, """(() => { const H = __hm; H.guide2.updateWarPanel(); const a = document.querySelector('#war .g2-aim'); return a ? { t: a.textContent, g: a.dataset.g2 } : null; })()""")
    check(r and r['t'], f'the war panel has a line for your aim ({r})')
    await shot(page, 'guide2_phone_war')
    await ev(page, "__hm.frame(1/30); document.getElementById('zonetoast').classList.remove('on'); G2T.lay(); 0")
    ok = await tap(page, '#war')
    r2 = await ev(page, "({ modal: __hm.UI.modal, sec: __hm.LORE.state.chronSec })")
    check(ok and r2['modal'] == 'menu' and r2['sec'] in ('path', 'goals'), f'a tap on the war panel opens it in the Chronicle ({r2})')
    await ev(page, "(() => { if (!document.getElementById('menu').hidden) document.getElementById('btn-resume').click(); __hm.UI.modal = null; return 0; })()")

    # ---- Cinderwing: a real share, not a single arrow from afar ----
    r = await ev(page, """(() => { const H = __hm, P = G2T.P(), L = H.LORE, Dg = H.guide.dragon(); if (!H.guide.dragon()) return 'no dragon'; const out = {}; const lore = H.GAME.prog.lore; lore.done = lore.done.filter((x) => x !== 'dragon');
      const a0 = Dg.alive; Dg.alive = true; Dg.removed = false; Dg.threat = new Map([[P.id, 30]]); Dg.lastHitBy = -1; H.teleport(Dg.x + 150, Dg.z); G2T.calm(); L.check(); Dg.alive = false; L.check(); L.check(); out.single = H.LORE.progress().done.includes('dragon');
      Dg.alive = true; Dg.threat = new Map([[P.id, Dg.maxHp * 0.2]]); H.teleport(Dg.x + 30, Dg.z); G2T.calm(); L.check(); Dg.alive = false; L.check(); L.check(); out.share = H.LORE.progress().done.includes('dragon'); Dg.alive = a0; return out; })()""")
    check(isinstance(r, dict) and r['single'] is False and r['share'] is True, f'Cinderwing\'s step: a single blow from 150 m no, a fifth of its harm yes ({r})')

    # ---- the companion bar: no tap lost while the HUD changes under the finger ----
    r = await ev(page, """(() => { const H = __hm, A = H.animals, P = G2T.P(); G2T.calm(); if (!A.anCompanions().length) A.anSpawn(A.anRecord('hound', { owner: 'player', cmd: 'follow' }), P.x + 1.5, P.z + 1); for (let i = 0; i < 6; i++) { H.simulate(0.1); H.frame(1/30); } G2T.lay(); return A.anCompanions().length; })()""")
    lost = 0
    for i in range(4):
        for cmd in ('stay', 'follow'):
            await ev(page, "__hm.frame(1/30); G2T.lay(); 0")
            box = await ev(page, f"(() => {{ const r = document.querySelector('#petbar [data-cmd=\"{cmd}\"]').getBoundingClientRect(); return {{ x: r.left + r.width / 2, y: r.top + r.height / 2 }}; }})()")
            await cdp.send('Input.dispatchTouchEvent', {'type': 'touchStart', 'touchPoints': [{'x': box['x'], 'y': box['y'], 'id': 3}]})
            # while the finger is down the HUD changes: a toast comes and the class panel grows; the layout must hold still
            moved = await ev(page, """(() => { const H = __hm, b = document.getElementById('petbar'), r0 = b.getBoundingClientRect().top; H.guide2.uiToast('A toast while you tap', 'hint'); const c = document.getElementById('cls'); if (c) c.style.paddingBottom = '60px';
              const L = H.hud.HUDL; L.k = 0; L.t = 0; H.hud.hudLayout(1); return Math.round(b.getBoundingClientRect().top - r0); })()""")
            await cdp.send('Input.dispatchTouchEvent', {'type': 'touchEnd', 'touchPoints': []})
            for _ in range(3): await ev(page, "__hm.frame(1/30); 0")
            c = await ev(page, "__hm.animals.anCompanions().map((e) => e.tame.cmd)")
            if not all(x == cmd for x in c) or moved != 0: lost += 1; print('    lost?', cmd, c, 'moved', moved, flush=True)
            await ev(page, "(() => { const c = document.getElementById('cls'); if (c) c.style.paddingBottom = ''; for (const d of [...document.querySelectorAll('#banners > *')]) d.parentNode.removeChild(d); G2T.lay(); return 0; })()")
    check(lost == 0, f'eight taps on Stay and Follow while the HUD changes under the finger: none lost, the bar held still ({lost} lost)')
    r = await ev(page, "(() => { const G = __hm.guide2.G2; return { held: __hm.guide2.g2TapHeld(), downs: G.tap.downs, clicks: G.tap.clicks }; })()")
    check(not r['held'] and r['clicks'] >= r['downs'] - 1, f'the layout goes on once each click has landed, every tap\'s click came ({r})')

    errs = await ev(page, "__hm.errors")
    check(errs == [], f'no errors ({errs[:2]})')
    for l in logs[-5:]: print('  ', l)
    await b.close()

async def desk(p):
    print('desk, 960 x 540', flush=True)
    b, page, logs = await setup(p, w=960, h=540)
    await page.emulate_media(reduced_motion='reduce')
    page.set_default_timeout(300000)
    await ev(page, HELP)
    await ev(page, HOLD)
    await ev(page, "(async () => { await __hm.start({ realm: 0, cls: 'warrior', level: 22 }); __hm.setTod(0.45); __hm.dbg.WEATHER.mode = 'clear'; G2T.calm(); __hm.simulate(0.3); __hm.LORE.state.noteUntil = performance.now() + 1e9; __hm.frame(1/30); return 0; })()")
    await page.keyboard.press('KeyJ')
    await ev(page, "document.querySelector('.chron-nav [data-grp=\"you\"]').click(); document.querySelector('.chron-nav [data-sec=\"callings\"]').click(); 0")
    r = await ev(page, "(() => { const st = __hm.guide2.G2.stats.pages.callings; return { st, folds: document.querySelectorAll('.chron-body details.cf').length, all: !!document.querySelector('.chron-body .cf-all') }; })()")
    check(r['folds'] >= 4 and r['all'], f'on a desk the Callings page folds too, with Open all ({r})')
    await ev(page, "document.querySelector('.chron-nav [data-grp=\"land\"]').click(); document.querySelector('.chron-nav [data-sec=\"dragon\"]').click(); 0")
    r = await ev(page, "document.querySelectorAll('.chron-body details.cf').length")
    check(r == 0, f'a short page does not fold ({r} folds)')
    await ev(page, "document.querySelector('.chron-nav [data-grp=\"you\"]').click(); document.querySelector('.chron-nav [data-sec=\"callings\"]').click(); 0")
    await shot(page, 'guide2_desk_callings')
    await page.keyboard.press('Escape')
    await ev(page, "__hm.frame(1/30); __hm.frame(1/30); 0")
    a = await ev(page, "(() => { const a = document.querySelector('#war .g2-aim'); if (!a) return null; const r = a.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, t: a.textContent }; })()")
    check(a is not None, f'the war panel shows your aim ({a and a["t"]})')
    if a:
        await page.mouse.click(a['x'], a['y'])
        r = await ev(page, "({ modal: __hm.UI.modal, sec: __hm.LORE.state.chronSec })")
        check(r['modal'] == 'menu' and r['sec'] in ('path', 'goals'), f'a click on it opens the Chronicle there ({r})')
        await page.keyboard.press('Escape')
    await shot(page, 'guide2_desk_war')
    errs = await ev(page, "__hm.errors")
    check(errs == [], f'no errors ({errs[:2]})')
    await b.close()

async def main():
    async with async_playwright() as p:
        if 'phone' in PARTS: await phone(p)
        if 'desk' in PARTS: await desk(p)
    print(f'{len(FAILS)} failed' if FAILS else 'all passed', f'in {time.time() - T0:.0f}s')
    for f in FAILS: print('  FAIL', f)
    sys.exit(1 if FAILS else 0)

asyncio.run(main())
