"""[capture] The capture build (src/14_capture.js): a mode for filming trailers and taking stills, checked by number.
usage: python3 tools/tests/capture.py [only=open,save,fly,clock,path,orbit,shots,still,leave,phone] [noshots]
  open:   from the Settings page's button and with ` (backquote): the HUD hidden, the panel up, the game's own keys held
          off, the player out of the frame and no one's foe (and back to both with "Show yourself");
  save:   nothing is written while the mode is on (a change made then is not saved), and saving goes on after it;
  fly:    W flies the camera along its view, E up, a drag of the mouse turns it, the wheel sets its pace and Shift with the
          wheel its lens;
  clock:  F freezes the world (its clock stands, the camera's moves), ] and [ change its pace, a slowed world steps
          slower;
  path:   K sets keys, P plays them through every key at an even pace and stops at the last, a pasted path is read;
  orbit:  the orbit keeps its distance round its point while it turns, Follow keeps a body in the middle of the view;
  shots:  every shot is staged for a level 50 character who has done what the late shots need, its camera move starts,
          a few frames are drawn, nothing is left of the last shot's bodies, nothing goes wrong;
  still:  a still is the frame (not black), cropped to the 2.39:1 bars when they are up;
  leave:  leaving puts the HUD, the play camera, its lens and the player back, and the shot's bodies are gone;
  phone:  on an upright phone with touch: the Settings button opens it by a tap, the panel is a sheet at the foot of the
          screen, its buttons and the pad's are 40 px and more, the pad flies the camera, a drag turns it.
  Screenshots (unless noshots): tools/out/capture_desk.png (the panel over a shot), capture_phone.png."""
import json, asyncio, sys, time, pathlib, base64, io
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
from hmlib import setup, OUT
from playwright.async_api import async_playwright
try:
    from PIL import Image
except ImportError:
    Image = None

ARGS = sys.argv[1:]
def opt(name, default=None):
    for a in ARGS:
        if a.startswith(name + '='): return a.split('=', 1)[1]
    return default
ONLY = (opt('only') or 'open,save,fly,clock,path,orbit,shots,still,leave,phone').split(',')
SHOTS = 'noshots' not in ARGS
FAILS = []
T0 = time.time()
def check(cond, what):
    print(('  ok   ' if cond else '  FAIL ') + what, flush=True)
    if not cond: FAILS.append(what)
def log(*a): print(f'[{time.time() - T0:6.1f}s]', *a, flush=True)

# what film.py's character has done: level 50, a name, the standard made, the Hollow King down, the seal broken
START = """(() => { const H = __hm;
  H.start({ realm: 0, cls: 'warrior', level: 50, name: 'Aldric' });
  const P = H.GAME.player; P.hp = P.maxHp = 1e7;
  const L = H.late.LATE2; H.GAME.prog.realmKills = 40; L.d.king = 1; H.GAME.prog.kingKills = 1; L.vet = 4;
  H.late.late2CheckNames(true); if (!L.worn && L.names.length) H.late.late2Wear(L.names[L.names.length - 1]);
  L.std.made = true; H.deep.late3SealOpen(true);
  H.simulate(20); H.fn.setQuality('low');
  // the page's own frames held (each costs seconds under SwiftShader): the test draws the frames it needs
  if (!window.__rafWrapped) { window.__rafWrapped = true; const raf = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = (cb) => raf((t) => { if (window.__rafHold) window.requestAnimationFrame(cb); else cb(t); }); }
  window.__rafHold = true; return 0; })()"""
ST = "JSON.stringify(__hm.capture.state())"

# a press at a control's middle, the control checked to be the topmost thing there (the page's frames are held, so
# Playwright's own wait for a control to stand still waits on frames that do not come)
WHERE = """((sel) => { const b = document.querySelector(sel); b.scrollIntoView({ block: 'center' }); const r = b.getBoundingClientRect();
  const x = r.left + r.width / 2, y = r.top + r.height / 2, top = document.elementFromPoint(x, y); return [x, y, !!top && (top === b || b.contains(top))]; })"""
async def press(page, sel, touch=False):
    x, y, top = await page.evaluate(WHERE + f"({sel!r})")
    check(top, f"{sel} is the topmost thing where it is pressed")
    if touch: await page.touchscreen.tap(x, y)
    else: await page.mouse.click(x, y)
async def state(page): return json.loads(await page.evaluate(ST))
# the world and the camera moved as frames move them, not drawn (a frame drawn under SwiftShader takes seconds)
async def steps(page, n, dt=0.05): await page.evaluate(f"for (let i = 0; i < {n}; i++) __hm.capture.think({dt}); 0")
async def frames(page, n, dt=1 / 24): await page.evaluate(f"for (let i = 0; i < {n}; i++) __hm.capture.step({dt}); 0")

async def desk(p):
    b, page, logs = await setup(p, w=960, h=540)
    ev = page.evaluate
    await ev(START)
    log('started a level 50 warrior')
    if 'open' in ONLY:
        await ev("__hm.fn.openMenu('settings'); 0")
        has = await ev("!!document.getElementById('set-capture')")
        check(has, "the Settings page has its Capture mode row")
        await press(page, '#set-capture')
        s = await state(page)
        check(s['on'] and s['modal'] == 'capture' and not s['hud'], f"its button opens capture mode: the HUD hidden ({s['modal']}, hud {s['hud']})")
        vis = await ev("(() => { const c = document.getElementById('cap'), r = c.getBoundingClientRect(); return !c.hidden && r.width > 200 && r.height > 200; })()")
        check(vis, "the panel is up")
        hid = await ev("(() => { const H = __hm, P = H.GAME.player, e = H.fn.spawnRealmUnit(2, 'warrior', 50, 'guard', P.x + 3, P.z, {}); const r = { cap: !!P.capHide, foe: H.fn.isEnemy(e, P), foe2: H.fn.isEnemy(P, e) }; H.capture.CAPTURE.hideMe = false; H.capture.think(0.05); r.shown = H.fn.isEnemy(e, P); H.capture.CAPTURE.hideMe = true; H.capture.think(0.05); H.fn.removeEnt(e); return r; })()")
        check(hid['cap'] and not hid['foe'] and not hid['foe2'], f"the player is out of the frame and no foe's mark ({hid})")
        check(hid['shown'], "with Show yourself a foe sees it again")
        # the game's own keys are held off: E (interact) and Q (a potion) do nothing to the player
        pot = await ev("__hm.INV.potions")
        await page.keyboard.press('q')
        check(await ev("__hm.INV.potions") == pot, "the game's own keys are held off (Q drank no potion)")
        await page.keyboard.press('Escape')
        s = await state(page)
        check(not s['on'] and s['modal'] is None and s['hud'], f"Escape leaves it: the HUD back ({s['modal']}, hud {s['hud']})")
        await page.keyboard.press('Backquote')
        s = await state(page)
        check(s['on'], "` opens it again")
    else:
        await ev("__hm.capture.open(); 0")
    if 'save' in ONLY:
        r = await ev("""(async () => { const H = __hm, S = H.SAVE; await H.fn.saveNow(); const before = S.lastBody; H.GAME.prog.kills += 7; await H.fn.saveNow(); const during = S.lastBody === before;
          H.capture.close(); await H.fn.saveNow(); const after = S.lastBody !== before; H.capture.open(); return { during, after }; })()""")
        check(r['during'], "nothing is written while capture is on (a change is not saved)")
        check(r['after'], "saving goes on once it is left")
    if 'fly' in ONLY:
        await ev("(() => { const C = __hm.capture.CAPTURE; C.mode = 'free'; C.play = false; C.cam.y += 20; C.cam.pitch = 0; C.aim.pitch = 0; C.cam.yaw = 0; C.aim.yaw = 0; C.vel = [0, 0, 0]; C.speed = 8; C.smooth = 0; __hm.capture.step(0.05); return 0; })()")
        a = (await state(page))['cam']
        await page.keyboard.down('w'); await steps(page, 20); await page.keyboard.up('w')
        await steps(page, 6)
        b2 = (await state(page))['cam']
        dz = b2[2] - a[2]
        check(dz < -5 and abs(b2[0] - a[0]) < 1, f"W flies it along its view (yaw 0 looks along -z: moved {b2[0] - a[0]:.1f}, {dz:.1f})")
        await page.keyboard.down('e'); await steps(page, 10); await page.keyboard.up('e'); await steps(page, 4)
        c2 = (await state(page))['cam']
        check(c2[1] - b2[1] > 2, f"E lifts it ({c2[1] - b2[1]:.1f} m)")
        await page.mouse.move(480, 270); await page.mouse.down(); await page.mouse.move(380, 270, steps=4); await page.mouse.up()
        await steps(page, 10)
        d2 = (await state(page))['cam']
        check(d2[3] - c2[3] > 0.2, f"a drag of the mouse turns it ({d2[3] - c2[3]:.2f} rad)")
        sp0 = await ev("__hm.capture.CAPTURE.speed"); fov0 = (await state(page))['cam'][6]
        await page.mouse.move(480, 270); await page.mouse.wheel(0, -300)
        sp1 = await ev("__hm.capture.CAPTURE.speed")
        await page.keyboard.down('Shift'); await page.mouse.wheel(0, 300); await page.keyboard.up('Shift')
        fov = (await state(page))['cam'][6]
        check(sp1 > sp0, f"the wheel sets its pace ({sp0:.1f} -> {sp1:.1f})")
        check(fov > fov0 + 1, f"Shift with the wheel widens its lens ({fov0:.1f} -> {fov:.1f})")
    if 'clock' in ONLY:
        r = await ev("""(() => { const H = __hm, C = H.capture.CAPTURE; C.k = 1; const g0 = H.GAME.t; H.capture.think(0.05); const g1 = H.GAME.t;
          const e = new KeyboardEvent('keydown', { code: 'KeyF', bubbles: true }); window.dispatchEvent(e); window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyF', bubbles: true }));
          const frozen = C.k; const t0 = H.GAME.t; C.keys = [H.capture.keyOf(C.cam.x, C.cam.y, C.cam.z, C.cam.x, C.cam.y, C.cam.z - 10), H.capture.keyOf(C.cam.x + 10, C.cam.y, C.cam.z, C.cam.x + 10, C.cam.y, C.cam.z - 10)]; C.dur = 1; C.pt = 0; C.play = true;
          const x0 = C.cam.x; for (let i = 0; i < 10; i++) H.capture.think(0.05); const t1 = H.GAME.t, x1 = C.cam.x; C.play = false;
          window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyF', bubbles: true })); window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyF', bubbles: true }));
          window.dispatchEvent(new KeyboardEvent('keydown', { code: 'BracketLeft', bubbles: true })); window.dispatchEvent(new KeyboardEvent('keyup', { code: 'BracketLeft', bubbles: true }));
          const slow = C.k; const t2 = H.GAME.t; for (let i = 0; i < 10; i++) H.capture.think(0.05); const t3 = H.GAME.t; C.k = 1;
          return { live: +(g1 - g0).toFixed(3), frozen, still: +(t1 - t0).toFixed(4), moved: +(x1 - x0).toFixed(2), slow, slowStep: +(t3 - t2).toFixed(3) }; })()""")
        check(r['live'] > 0.04, f"the world steps with the frames while the clock runs ({r['live']} s)")
        check(r['frozen'] == 0 and r['still'] < 0.01, f"F freezes the world (its clock moved {r['still']} s in 10 frames)")
        check(r['moved'] > 4, f"the camera plays its path over the frozen world ({r['moved']} m)")
        check(r['slow'] == 0.5 and 0.2 < r['slowStep'] < 0.3, f"[ slows it ({r['slow']}: 10 frames of 0.05 s stepped {r['slowStep']} s)")
    if 'path' in ONLY:
        r = await ev("""(() => { const H = __hm, C = H.capture.CAPTURE; C.keys = []; C.mode = 'free'; C.play = false; C.k = 1;
          const p = [[0, 30, 0, 0], [20, 34, 5, 0.6], [40, 30, -10, 1.2]]; const fire = (code) => { window.dispatchEvent(new KeyboardEvent('keydown', { code, bubbles: true })); window.dispatchEvent(new KeyboardEvent('keyup', { code, bubbles: true })); };
          for (const [x, y, z, yaw] of p) { C.cam.x = x; C.cam.y = y; C.cam.z = z; C.cam.yaw = yaw; C.cam.pitch = 0; fire('KeyK'); }
          const n = C.keys.length; C.dur = 2; fire('KeyP'); const playing = C.play; let near = [9, 9, 9], k = 0;
          for (let i = 0; i < 220; i++) { H.capture.think(0.01); p.forEach((q, j) => { near[j] = Math.min(near[j], Math.hypot(C.cam.x - q[0], C.cam.y - q[1], C.cam.z - q[2])); }); }
          const end = [C.cam.x, C.cam.y, C.cam.z, C.cam.yaw];
          return { n, playing, near: near.map((v) => +v.toFixed(2)), stopped: !C.play, end: end.map((v) => +v.toFixed(2)) }; })()""")
        check(r['n'] == 3 and r['playing'], f"K sets keys and P plays them ({r['n']} keys)")
        check(max(r['near']) < 0.3, f"the path passes through every key ({r['near']})")
        check(r['stopped'] and abs(r['end'][0] - 40) < 0.05 and abs(r['end'][3] - 1.2) < 0.01, f"it stops at the last key ({r['end']})")
        r = await ev("""(() => { const C = __hm.capture.CAPTURE; C.out.hidden = true; document.querySelector('#cap [data-c="pastepath"]').click(); const ta = document.getElementById('cap-pathtext');
          ta.value = JSON.stringify({ dur: 6, keys: [{ x: 1, y: 2, z: 3, yaw: 0, pitch: 0 }, { x: 4, y: 5, z: 6, yaw: 1, pitch: 0.1, fov: 40 }] }); document.querySelector('#cap-out [data-c="pathok"]').click();
          return { n: C.keys.length, dur: C.dur, fov: C.keys[1].fov, shut: C.out.hidden }; })()""")
        check(r['n'] == 2 and r['dur'] == 6 and r['fov'] == 40 and r['shut'], f"a pasted path is read ({r})")
    if 'orbit' in ONLY:
        r = await ev("""(() => { const H = __hm, C = H.capture.CAPTURE; C.play = false; C.mode = 'free'; const P = H.GAME.player; C.cam.x = P.x + 20; C.cam.z = P.z; C.cam.y = H.fn.heightAt(P.x, P.z) + 8; C.cam.yaw = Math.PI / 2; C.cam.pitch = -0.38; C.aim.yaw = C.cam.yaw; C.aim.pitch = C.cam.pitch;
          H.capture.mode('orbit'); const O = C.orbit; O.w = 0.5; C.smooth = 0; const a0 = O.a, ds = [];
          for (let i = 0; i < 30; i++) { H.capture.think(0.05); ds.push(Math.hypot(C.cam.x - O.x, C.cam.z - O.z)); }
          return { mode: C.mode, turned: +(O.a - a0).toFixed(2), r: +O.r.toFixed(2), dmin: +Math.min(...ds.slice(10)).toFixed(2), dmax: +Math.max(...ds.slice(10)).toFixed(2) }; })()""")
        check(r['mode'] == 'orbit' and r['turned'] > 0.6, f"the orbit turns round its point ({r['turned']} rad)")
        check(abs(r['dmin'] - r['r']) < 0.6 and abs(r['dmax'] - r['r']) < 0.6, f"it keeps its distance ({r['dmin']} to {r['dmax']} of {r['r']} m)")
    if 'shots' in ONLY:
        ids = json.loads(await ev("JSON.stringify(__hm.capture.shots())"))
        check(len(ids) >= 15 and not [s for s in ids if s['need']], f"{len(ids)} shots, each can be staged for this character ({[s['id'] for s in ids if s['need']]})")
        prev = 0
        for s in ids:
            r = json.loads(await ev(f"JSON.stringify(__hm.capture.shot('{s['id']}'))"))
            left = await ev("__hm.ENT.filter((e) => e.alive && !e.removed && e._capPrev).length")
            await ev("(() => { for (const e of __hm.capture.CAPTURE.made) e._capPrev = true; return 0; })()")
            await steps(page, 4, 1 / 24); await frames(page, 2)
            st = await state(page)
            check(not r.get('error') and st['mode'] in ('path', 'follow', 'orbit') and left == 0, f"{s['id']}: staged ({r.get('error') or st['mode']}, {st['made']} bodies made, {left} left of the last shot's)")
            if s['id'] in ('logres', 'siege'):
                t = await ev("(() => { const C = __hm.capture.CAPTURE, pt0 = C.pt, x0 = C.cam.x, T = __hm.capture.track(24, 96, 16 / 9); return { n: T.frames.length, marks: T.marks, f0: T.frames[0], fl: T.frames[95], back: C.pt === pt0 && C.cam.x === x0 }; })()")
                inside = all(q is not None and 0 <= q[0] <= 1 and 0 <= q[1] <= 1 for q in t['f0'][:1])
                check(t['n'] == 96 and t['marks'] and inside and t['back'], f"{s['id']}: its camera move tracked frame by frame, its first mark on the frame and the camera put back ({t['marks']}, {t['f0']}, {t['fl']})")
            if s['id'] == 'gallop':
                g = await ev("(() => { const C = __hm.capture.CAPTURE, e = __hm.fn.getEnt(C.follow.id); for (let i = 0; i < 30; i++) __hm.capture.think(1 / 24); return +Math.hypot(e.x - C.cam.x, e.z - C.cam.z).toFixed(1); })()")
                check(g < 14, f"Follow keeps the galloping horse beside the camera ({g} m off)")
            if s['id'] == 'cinderwing':
                g = await ev("(() => { const C = __hm.capture.CAPTURE, e = __hm.fn.getEnt(C.follow.id); for (let i = 0; i < 30; i++) __hm.capture.think(1 / 24); const fx = -Math.sin(C.cam.yaw), fz = -Math.cos(C.cam.yaw), dx = e.x - C.cam.x, dz = e.z - C.cam.z, d = Math.hypot(dx, dz); return +((dx * fx + dz * fz) / d).toFixed(2); })()")
                check(g > 0.9, f"the camera keeps Cinderwing in the middle of its view ({g})")
        errs = await ev("__hm.errors.map(String).slice(0, 5)")
        check(not errs, f"no runtime errors staging the shots ({errs[:2]})")
        if SHOTS:
            await ev("__hm.capture.shot('storm', { hold: true }); __hm.capture.render(); 0")
            await frames(page, 3)
            await page.screenshot(path=OUT + 'capture_desk.png', timeout=300000)
    if 'still' in ONLY:
        r = await ev("""(() => { const C = __hm.capture.CAPTURE; C.bars = 0; const a = __hm.capture.still('image/png'); C.bars = 2.39; const b = __hm.capture.still('image/png'); C.bars = 0; return { a, b }; })()""")
        def dims(u):
            if not Image: return None
            im = Image.open(io.BytesIO(base64.b64decode(u.split(',', 1)[1]))).convert('RGB')
            sm = im.resize((32, 18)); px = list(sm.get_flattened_data() if hasattr(sm, "get_flattened_data") else sm.getdata())
            return im.size, sum(sum(q) for q in px) / (len(px) * 3)
        if Image:
            (wa, ha), ma = dims(r['a']); (wb, hb), mb = dims(r['b'])
            check(ma > 12, f"a still is the frame, not black (mean {ma:.0f})")
            check(abs(wb / hb - 2.39) < 0.03 and wb == wa, f"with the 2.39:1 bars it is cropped to them ({wb}x{hb})")
    if 'leave' in ONLY:
        r = await ev("""(() => { const H = __hm, C = H.capture.CAPTURE; H.capture.shot('callings'); const made = C.made.slice(); H.capture.close(); H.frame(0.02);
          return { on: C.on, modal: H.UI.modal, mode: H.CAM.mode, fov: +H.camera.fov.toFixed(1), hud: !document.getElementById('hud').hidden, cap: !!H.GAME.player.capHide, gone: made.every((e) => e.removed), panel: document.getElementById('cap').hidden }; })()""")
        check(not r['on'] and r['modal'] is None and r['mode'] == 'play', f"leaving puts the play camera back ({r['mode']}, {r['modal']})")
        check(r['fov'] == 55 and r['hud'] and r['panel'] and not r['cap'], f"its lens, the HUD and the player are back, the panel gone ({r})")
        check(r['gone'], "the shot's bodies are gone")
    errs = await ev("__hm.errors.map(String).slice(0, 5)")
    check(not errs, f"no runtime errors ({errs[:3]})")
    print('logs', logs[:4])
    await b.close()

async def phone(p):
    b, page, logs = await setup(p, w=390, h=780, touch=True)
    ev = page.evaluate
    await ev(START)
    await ev("__hm.fn.openMenu('settings'); 0")
    await press(page, '#set-capture', touch=True)
    s = await state(page)
    check(s['on'], "a tap on the Settings page's button opens capture mode on a phone")
    r = await ev("""(() => { const c = document.getElementById('cap'), r = c.getBoundingClientRect(), pad = document.getElementById('cap-pad'), pr = pad.getBoundingClientRect();
      const small = [...c.querySelectorAll('button')].filter((b) => b.offsetParent && b.getBoundingClientRect().height < 39.5).map((b) => b.textContent.trim().slice(0, 16));
      const pads = [...pad.querySelectorAll('button')].map((b) => { const q = b.getBoundingClientRect(); return Math.min(q.width, q.height); });
      return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, h: innerHeight, w: innerWidth, small, pad: !pad.hidden, pads, padBottom: pr.bottom, padTop: pr.top, sheetTop: r.top }; })()""")
    check(r['left'] >= 0 and r['right'] <= r['w'] and r['bottom'] <= r['h'] and r['top'] > r['h'] * 0.4, f"the panel is a sheet at the foot of the screen ({r['top']:.0f}..{r['bottom']:.0f} of {r['h']})")
    check(not r['small'], f"its buttons are 40 px and more ({r['small'][:4]})")
    check(r['pad'] and len(r['pads']) == 6 and min(r['pads']) >= 40 and r['padBottom'] <= r['sheetTop'], f"the pad's six buttons are up, 40 px and more, above the sheet ({r['pads']})")
    await ev("(() => { const C = __hm.capture.CAPTURE; C.mode = 'free'; C.play = false; C.cam.y += 20; C.cam.pitch = 0; C.aim.pitch = 0; C.cam.yaw = 0; C.aim.yaw = 0; C.smooth = 0; return 0; })()")
    a = (await state(page))['cam']
    box = await ev("(() => { const q = document.querySelector('#cap-pad [data-k=\"pad-f\"]').getBoundingClientRect(); return [q.left + q.width / 2, q.top + q.height / 2]; })()")
    cdp = await page.context.new_cdp_session(page)
    await cdp.send('Input.dispatchTouchEvent', {'type': 'touchStart', 'touchPoints': [{'x': box[0], 'y': box[1]}]})
    await steps(page, 16)
    await cdp.send('Input.dispatchTouchEvent', {'type': 'touchEnd', 'touchPoints': []})
    await steps(page, 4)
    b2 = (await state(page))['cam']
    check(b2[2] - a[2] < -4, f"holding the pad's forward flies the camera ({b2[2] - a[2]:.1f} m)")
    await cdp.send('Input.dispatchTouchEvent', {'type': 'touchStart', 'touchPoints': [{'x': 200, 'y': 150}]})
    for k in range(1, 6): await cdp.send('Input.dispatchTouchEvent', {'type': 'touchMove', 'touchPoints': [{'x': 200 - k * 20, 'y': 150}]})
    await cdp.send('Input.dispatchTouchEvent', {'type': 'touchEnd', 'touchPoints': []})
    await steps(page, 10)
    c2 = (await state(page))['cam']
    check(c2[3] - b2[3] > 0.15, f"a drag of a finger turns it ({c2[3] - b2[3]:.2f} rad)")
    if SHOTS:
        await ev("__hm.capture.shot('lonetree', { hold: true }); __hm.capture.render(); 0")
        await frames(page, 3)
        await page.screenshot(path=OUT + 'capture_phone.png', timeout=300000)
    errs = await ev("__hm.errors.map(String).slice(0, 5)")
    check(not errs, f"no runtime errors on the phone ({errs[:3]})")
    await b.close()

async def main():
    async with async_playwright() as p:
        if any(k in ONLY for k in ('open', 'save', 'fly', 'clock', 'path', 'orbit', 'shots', 'still', 'leave')): await desk(p)
        if 'phone' in ONLY: await phone(p)
    print(f'took {time.time() - T0:.0f} s')
    print('FAILED: ' + '; '.join(FAILS) if FAILS else 'all capture checks passed', flush=True)

asyncio.run(main())
