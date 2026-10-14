"""The HUD on every screen: every panel showing at once (needs bars and gift marks in the player frame, the class
panel, the companion bar with two companions, the builder's bar, the plant card, a target, the path tracker, a toast
and a field note), measured for overlaps, boxes off the screen or under the notch (safe areas emulated), and touch
targets under 40 px, at 390x780, 360x640, 844x390 and 667x375 with touch and at 1280x720, 960x540 and 1920x1080 on a
desk. Each calling's class panel is tried at each size. One screenshot per size (tools/out/hud_<w>x<h>.png).
usage: python3 tools/tests/hud_layout.py [touch|desk] [noshots] [sizes=390x780,...] [notch] [all] [cls=warrior,...]
(all: every calling at every size; by default every calling at the first size of each kind, one at the others)"""
import asyncio, json, sys, pathlib
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
from hmlib import setup, OUT
from playwright.async_api import async_playwright

ARGS = sys.argv[1:]
SHOTS = 'noshots' not in ARGS
OPT = dict(a.split('=', 1) for a in ARGS if '=' in a)
TOUCH = [(390, 780), (360, 640), (844, 390), (667, 375)]
DESK = [(1280, 720), (960, 540), (1920, 1080)]
if 'sizes' in OPT:
    want = [tuple(int(v) for v in s.split('x')) for s in OPT['sizes'].split(',')]
    TOUCH = [s for s in TOUCH if s in want]; DESK = [s for s in DESK if s in want]
MODES = [m for m in ('touch', 'desk') if m in ARGS] or ['touch', 'desk']
FAILS = []
def check(ok, msg):
    print(('PASS ' if ok else 'FAIL ') + msg, flush=True)
    if not ok: FAILS.append(msg)

HELP = r"""
window.HL = {
  H: window.__hm,
  // a quiet place by a wild herb in Logres, with every panel up
  setup(cls) {
    const H = this.H, F = H.fn;
    if (!H.GAME.player || H.GAME.player.cls !== cls) H.start({ realm: 0, cls, level: 32, rp: 60000 });
    const P = H.GAME.player;
    const herbs = H.farm.herbs().filter((h) => Math.hypot(h.x - P.x, h.z - P.z) < 400 && !h.gone).sort((a, b) => Math.hypot(a.x - P.x, a.z - P.z) - Math.hypot(b.x - P.x, b.z - P.z));
    const hb = herbs[0];
    if (hb) { H.teleport(hb.x - 0.9, hb.z); P.yaw = Math.PI / 2; H.CAM.yaw = P.yaw; }
    for (const e of H.ENT) if (e !== P && e.alive && e.kind !== 'door' && F.isEnemy(P, e) && Math.hypot(e.x - P.x, e.z - P.z) < 80) { e.alive = false; e.removeAt = H.GAME.t; }
    P.hp = P.maxHp; P.buffs.length = 0;
    if (H.loops) { const L = H.loops.LOOPS; L.r[0].food = 10; L.r[0].iron = 1; L.r[2].timber = 5; } // [loops] the war panel with its stores line (two realms short)
    // two companions
    const A = H.animals;
    if (A.anCompanions().length < 2) for (let i = A.anCompanions().length; i < 2; i++) A.anSpawn(A.anRecord('hound', { owner: 'player', cmd: 'follow' }), P.x + 1.5 + i, P.z + 1);
    // a target: a townsman or a soldier near by, else a companion
    const t = H.ENT.filter((e) => e !== P && e.alive && e.kind === 'humanoid').sort((a, b) => Math.hypot(a.x - P.x, a.z - P.z) - Math.hypot(b.x - P.x, b.z - P.z))[0] || A.anCompanions()[0];
    if (t) F.setPlayerTarget(t);
    // hungry enough for the needs bars to matter
    if (H.surv && H.surv.SURV) { H.surv.SURV.hunger = 0.45; H.surv.SURV.thirst = 0.55; }
    P.breath = 0.15; // [water2] the breath bar, coming back after a dive (07d_dive.js)
    // the builder's bar
    if (H.build && !H.build.BUILD.mode) { F.goodsAdd && F.goodsAdd('tool_hammer', 1); try { H.build.buildToggle(true); } catch (e) {} }
    // [net] the March shared: two players of your realm in your party (the party's frames, the Players button), over a
    // stand-in link that sends nothing
    if (H.net) {
      const N = H.net.NET;
      if (N.state !== 'on') { N.state = 'on'; N.link = { kind: 'test', setSlow() {}, setFast() {}, connected: () => true, close() {} }; H.net.uiOn(); }
      N.party = 'hltest01';
      [['hlpeera', 'Brisa'], ['hlpeerb', 'Caelan Longshadow']].forEach(([k, nm], i) => H.net.peerUpdate(k, { slow: { v: 1, on: 1, since: 1, n: nm, dn: nm, r: 0, c: i ? 'priest' : 'mage', l: 31, rr: 2, pt: 'hltest01' }, fast: { s: 1 + Math.round(H.GAME.t * 10), t: Math.round(performance.now()), p: [P.x + 2 + i, P.y, P.z + 3], y: 0, v: [0, 0], a: 0, h: 0.6 + 0.3 * i, m: 2400, d: 0, mo: 0, ph: 0, sw: 0, st: 0, cs: 0, fl: 0, tg: '', ev: [] } }));
      // [net] the season on the server: its line on the war panel (a long one: the season's day, phase, who is on, the time left)
      if (H.season) { H.net.NETWS.state = 'on'; H.season.msg({ t: 'season', s: { n: 1, t: 200000, len: 2419200, day: 3, days: 28, phase: 'final', pts: [100, 120, 90], keeps: [0, 0, 1, 1, 2, 2].map((r, i) => ({ i, r, g: 8, gate: 1 })), armies: [], st: { food: 900, timber: 300, stone: 200, iron: 80, hides: 50, wool: 30, horses: 12 }, built: [], proj: [], target: 2, levyIn: 1800, news: [] }, roster: { now: 12, day: 40, list: [] } }); }
    }
    H.UI.modal = null; H.CAM.mode = 'play';
    return 0;
  },
  // a toast and a field note
  notes() { const H = this.H; H.hud.uiToast('A toast to measure'); H.hud.note('pen'); return 0; },
  vis(el) {
    if (!el || el.hidden) return false;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity < 0.05) return false;
    for (let q = el.parentElement; q && q !== document.body; q = q.parentElement) { const c = getComputedStyle(q); if (c.display === 'none' || c.visibility === 'hidden' || q.hidden) return false; }
    const r = el.getBoundingClientRect();
    return r.width > 2 && r.height > 2;
  },
  // the panels a player reads or touches
  PANELS: ['#pf', '#tf', '#mmwrap', '#topright > .iconbtns', '#war', '#bounty', '#log', '#lore-path', '#cls', '#petbar', '#netparty', '#buildbar', '#farmcard', '#castbar', '#breath', '#prompt', '#hotbar', '#tpad', '#banners > .banner', '#zonetoast', '#error', '#joyhint'],
  measure() {
    this.H.hud.HUDL.k = 0; this.H.hud.hudLayout(0); // the layout pass looks four times a second: look now
    const out = [], W = innerWidth, Hh = innerHeight;
    const st = getComputedStyle(document.documentElement);
    const px = (v) => parseFloat(v) || 0;
    const probe = document.createElement('div'); probe.style.cssText = 'position:fixed;left:0;top:0;width:0;height:0;padding:var(--safe-t) var(--safe-r,0px) var(--safe-b) var(--safe-l,0px)'; document.body.appendChild(probe);
    const pcs = getComputedStyle(probe), safe = { t: px(pcs.paddingTop), r: px(pcs.paddingRight), b: px(pcs.paddingBottom), l: px(pcs.paddingLeft) }; probe.remove();
    for (const sel of this.PANELS) for (const el of document.querySelectorAll(sel)) {
      if (!this.vis(el)) continue;
      const r = el.getBoundingClientRect();
      out.push({ sel: sel + (el.id && !sel.includes('#' + el.id) ? '#' + el.id : ''), x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height), soft: ['#joyhint', '#zonetoast', '#banners > .banner', '#error'].includes(sel) });
    }
    // overlaps between panels (more than 3 px each way); a transient toast may lie over the world, not over a panel
    const ov = [];
    for (let i = 0; i < out.length; i++) for (let j = i + 1; j < out.length; j++) {
      const a = out[i], b = out[j];
      if (a.sel === b.sel) continue;
      if (a.sel === '#joyhint' && b.sel === '#joyhint') continue;
      const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x), oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
      if (ox > 3 && oy > 3) ov.push(`${a.sel} x ${b.sel} (${ox}x${oy})`);
    }
    // off the screen or under the notch
    const off = out.filter((a) => a.x < safe.l - 1 || a.y < safe.t - 1 || a.x + a.w > W - safe.r + 1 || a.y + a.h > Hh - safe.b + 1).map((a) => `${a.sel} [${a.x},${a.y} ${a.w}x${a.h}]`);
    // touch targets: a cross 19 px each way from the middle lands on the control itself
    const small = [];
    if (document.body.classList.contains('touch')) {
      for (const el of document.querySelectorAll('#hud button, #hud .slot, #hud [role=button]')) {
        if (!this.vis(el) || el.closest('.tip') || getComputedStyle(el).pointerEvents === 'none') continue;
        const r = el.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
        // a control scrolled out of its row (the builder's pieces) is reached by scrolling, not measured
        let clipped = false;
        for (let q = el.parentElement; q && q !== document.body; q = q.parentElement) { const o = getComputedStyle(q); if (o.overflowX !== 'visible' || o.overflowY !== 'visible') { const qr = q.getBoundingClientRect(); if (r.left < qr.left - 1 || r.right > qr.right + 1 || r.top < qr.top - 1 || r.bottom > qr.bottom + 1) { clipped = true; break; } } }
        if (clipped) continue;
        let ok = 0, n = 0; const miss = [];
        for (const [dx, dy] of [[0, 0], [-19, 0], [19, 0], [0, -19], [0, 19]]) {
          const x = cx + dx, y = cy + dy;
          if (x < 0 || y < 0 || x >= W || y >= Hh) continue;
          n++;
          const hit = document.elementFromPoint(x, y);
          if (hit && (hit === el || el.contains(hit))) ok++; else if (miss.length < 1) miss.push('hits ' + (hit ? (hit.id ? '#' + hit.id : String(hit.className || hit.tagName).slice(0, 18)) : 'nothing'));
        }
        if (ok < n) small.push(miss.join('|') + ' ' + `${el.id ? '#' + el.id : (el.className || el.tagName).toString().slice(0, 30)}${el.textContent ? ' "' + el.textContent.trim().slice(0, 14) + '"' : ''} ${Math.round(r.width)}x${Math.round(r.height)}`);
      }
    }
    return { W, H: Hh, safe, boxes: out, ov, off, small };
  },
};
0;
"""

async def frames(page, n=3):
    for _ in range(n):
        await page.evaluate("__hm.frame(1/30); 0")

async def run_mode(p, mode):
    sizes = TOUCH if mode == 'touch' else DESK
    if not sizes: return
    w0, h0 = sizes[0]
    b, page, logs = await setup(p, touch=(mode == 'touch'), w=w0, h=h0)
    await page.evaluate(HELP)
    if 'notch' in ARGS and mode == 'touch':
        await page.evaluate("document.documentElement.style.setProperty('--safe-t', '24px'); document.documentElement.style.setProperty('--safe-b', '20px'); 0")
    clsl = OPT['cls'].split(',') if 'cls' in OPT else ['warrior', 'archer', 'mage', 'priest']
    for si, (w, h) in enumerate(sizes):
        await page.set_viewport_size({'width': w, 'height': h})
        if 'notch' in ARGS and mode == 'touch':
            land = w > h
            await page.evaluate(f"document.documentElement.style.setProperty('--safe-l', '{44 if land else 0}px'); document.documentElement.style.setProperty('--safe-r', '{44 if land else 0}px'); 0")
        await page.evaluate("window.dispatchEvent(new Event('resize')); 0")
        await page.wait_for_timeout(200)
        worst = None
        # every calling's class panel at the first size of each kind of screen, one calling (in turn) at the others
        for ci, cls in enumerate(clsl):
            if si > 0 and ci != si % len(clsl) and 'all' not in ARGS: continue
            await page.evaluate(f"HL.setup('{cls}'); __hm.simulate(0.6); 0")
            await frames(page, 4)
            await page.evaluate("HL.notes(); 0")
            await frames(page, 3)
            m = await page.evaluate("HL.measure()")
            tag = f'{mode} {w}x{h} {cls}'
            print(f"{tag}: {len(m['boxes'])} panels: " + ', '.join(f"{b_['sel']}[{b_['x']},{b_['y']} {b_['w']}x{b_['h']}]" for b_ in m['boxes']), flush=True)
            check(not m['ov'], f'{tag}: no panels overlap' + (f": {'; '.join(m['ov'])}" if m['ov'] else ''))
            check(not m['off'], f'{tag}: nothing off the screen or under the notch' + (f": {'; '.join(m['off'])}" if m['off'] else ''))
            if mode == 'touch':
                check(not m['small'], f'{tag}: every touch target is at least 40 px' + (f": {'; '.join(m['small'][:12])}" if m['small'] else ''))
            # and without the builder's bar (the everyday screen): what waited for room comes back
            await page.evaluate("__hm.build.buildToggle(false); __hm.simulate(0.3); 0")
            await frames(page, 4)
            m2 = await page.evaluate("HL.measure()")
            hidden = await page.evaluate("[...document.querySelectorAll('.hl-off')].map((e) => '#' + e.id)")
            print(f"{tag} without the builder's bar: " + ', '.join(f"{b_['sel']}[{b_['x']},{b_['y']} {b_['w']}x{b_['h']}]" for b_ in m2['boxes']) + f"; waiting: {hidden}", flush=True)
            check(not m2['ov'] and not m2['off'], f'{tag} without the builder\'s bar: no overlaps, nothing off the screen' + (f": {'; '.join(m2['ov'] + m2['off'])}" if m2['ov'] or m2['off'] else ''))
            await page.evaluate("__hm.build.buildToggle(true); 0")
            if ci == (si % 4) and SHOTS:
                await page.evaluate("__hm.frame(1/30); 0")
                await page.screenshot(path=OUT + f'hud_{w}x{h}.png', timeout=300000)
        print('errors', await page.evaluate("__hm.errors"), flush=True)
    await b.close()

async def main():
    async with async_playwright() as p:
        for mode in MODES:
            await run_mode(p, mode)
    print(f'{len(FAILS)} failures')

asyncio.run(main())
