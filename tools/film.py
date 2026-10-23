"""[capture] Film the March's shots with the capture build (src/14_capture.js), for trailers.

usage: python3 tools/film.py [shots=a,b,...|all] [look|track] [w=960] [h=540] [q=medium] [fps=24] [secs=S] [tag=film]
                             [stills=id:variant,...] [crf=20] [keep]
  Boots the game in headless Chromium (SwiftShader, seeded: the same war each run), starts a level 50 Logres warrior
  who has earned what the late shots need (a name, the standard of its name, the Hollow King laid to rest, the Deep
  Barrow's seal broken), lets the war run 30 s, then for each shot: `__hm.capture.shot(id)` stages it, and its camera
  move is filmed frame by frame (`__hm.capture.step(1/fps)`: the world's step and the camera's, then drawn), each frame
  read from the canvas as a JPEG into tools/out/film/<tag>/<shot>/, then encoded with ffmpeg (H.264, yuv420p, faststart)
  to tools/out/film/<tag>/<shot>.mp4.
  look: three frames of each shot only (its start, middle and end: tools/out/film/<tag>/look_<shot>_<0|1|2>.png), to
  frame a shot before filming it (at q=low and 640x360 a look at every shot takes a few minutes).
  stills=id:variant,...: a still of a shot's first frame with a variant laid on it: a season (spring, summer, autumn,
  winter), a time of day (dawn, day, golden, dusk, night) or a weather (clear, haze, rain, storm, snow, mist); written to
  tools/out/film/<tag>/still_<id>_<variant>.png.
  track: each shot's camera move and its marks seen through it, frame by frame, as the film's frames are taken
  (`__hm.capture.track`: no frame is drawn), to tools/out/film/<tag>/tracks.json ({shot: {marks, fps, frames:
  [[u, v] or null per mark], cams}}): what a compositor's tracking gives, for titles that stay on what they name.
  A path's camera is exactly the film's (it follows its keys alone); a shot whose keys hang on the war (the siege's
  engine) is tracked where this run's war put it.
  score: the trailer's score from the game's own procedural music (src/11b_music.js, rendered offline: a mood, or a
  stinger, a segment), its segments laid end to end with crossfades of 0.8 s to the trailer's chapters
  (`SCORE`), as tools/out/film/<tag>/score.m4a (AAC).
  Under SwiftShader a frame at 960x540 takes about 3 s at low, 6-9 s at medium and 8-13 s at high (two browsers at once
  are no faster: it uses both CPUs)."""
import asyncio, base64, io, json, os, pathlib, subprocess, sys, time
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import hm
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
FLAGS = {a for a in ARGS if '=' not in a}
W, H = int(opt('w', 960)), int(opt('h', 540))
Q = opt('q', 'medium')
FPS = int(opt('fps', 24))
TAG = opt('tag', 'film')
CRF = opt('crf', '20')
OUT = pathlib.Path(__file__).resolve().parent / 'out' / 'film' / TAG
OUT.mkdir(parents=True, exist_ok=True)
T0 = time.time()

HOLD = """(() => { let s = 1234567; Math.random = () => { s |= 0; s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; })();
(() => { window.__rafHold = false; const raf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = (cb) => raf((t) => { if (window.__rafHold) window.requestAnimationFrame(cb); else cb(t); }); })();"""

def log(*a):
    print(f'[{time.time() - T0:6.0f}s]', *a, flush=True)

async def setup(p):
    b = await p.chromium.launch(args=['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
    ctx = await b.new_context(viewport={'width': W, 'height': H})
    page = await ctx.new_page()
    await page.add_init_script(HOLD)
    logs = []
    page.on('pageerror', lambda e: logs.append(f'[pageerror] {e}'))
    three = hm.THREE_LOCAL.read_text()
    async def three_route(route): await route.fulfill(status=200, content_type='application/javascript', body=three, headers={'Access-Control-Allow-Origin': '*'})
    await page.route(hm.THREE_URL, three_route)
    async def font_route(route): await route.fulfill(status=200, content_type='text/css', body='')
    await page.route('https://fonts.googleapis.com/**', font_route)
    async def doc_route(route): await route.fulfill(status=200, content_type='text/html', body=hm.SKELETON.replace('%s', hm.HTML.read_text()))
    await page.route('http://hm.test/', doc_route)
    await page.goto('http://hm.test/', wait_until='commit')
    await page.wait_for_function('window.__hm && window.__hm.ready', timeout=300000, polling=500)
    return b, page, logs

# a veteran of 50 who has done what the late shots ask of a character
START = """(async () => { const H = __hm, F = H.fn;
  await H.start({ realm: 0, cls: 'warrior', level: 50, name: 'Aldric' });
  const P = H.GAME.player; H.bal.applyFairGear(P, 50); P.hp = P.maxHp = 1e7;
  const L = H.late.LATE2; H.GAME.prog.realmKills = Math.max(H.GAME.prog.realmKills || 0, 40); L.d.king = Math.max(1, L.d.king || 0); H.GAME.prog.kingKills = 1;
  L.vet = Math.max(L.vet || 0, 4); H.late.late2CheckNames(true); if (!L.worn && L.names.length) H.late.late2Wear(L.names[L.names.length - 1]);
  L.std.made = true;
  H.deep.late3SealOpen(true);
  H.simulate(30);
  window.__rafHold = true;
  H.fn.setQuality('%Q%');
  return 0; })()"""

# a frame drawn and read in the same task (the canvas's buffer is cleared once it is shown)
async def jpeg(page, path, dt):
    url = await page.evaluate(f"(__hm.capture.step({dt}), __hm.dbg.renderer.domElement.toDataURL('image/jpeg', 0.94))")
    pathlib.Path(path).write_bytes(base64.b64decode(url.split(',', 1)[1]))

async def png(page, path, dt):
    url = await page.evaluate(f"(__hm.capture.step({dt}), __hm.dbg.renderer.domElement.toDataURL('image/png'))")
    data = base64.b64decode(url.split(',', 1)[1])
    if Image: Image.open(io.BytesIO(data)).convert('RGB').save(path)
    else: pathlib.Path(path).write_bytes(data)

async def stage(page, sid, extra='{}'):
    r = await page.evaluate(f"JSON.stringify(__hm.capture.shot('{sid}', {extra}))")
    return json.loads(r)

async def look(page, sid):
    r = await stage(page, sid)
    if r.get('error'): log(sid, 'not staged:', r['error']); return
    dur = r['dur']
    for n, at in enumerate([0, dur / 2, dur * 0.98]):
        if at:
            # the world and the path on to `at` without drawing, then a few frames for the follow camera to come round
            prev = n and [0, dur / 2, dur * 0.98][n - 1]
            gap = max(0, at - prev - 3 / FPS)
            await page.evaluate(f"(() => {{ const C = __hm.capture.CAPTURE; __hm.capture.run({gap}); C.pt += {gap}; return 0; }})()")
        await page.evaluate(f"for (let i = 0; i < 2; i++) __hm.capture.step({1 / FPS}); 0")
        await png(page, OUT / f'look_{sid}_{n}.png', 1 / FPS)
    st = await page.evaluate("JSON.stringify(__hm.capture.state())")
    info = await page.evaluate("JSON.stringify([__hm.renderInfo().calls, __hm.renderInfo().triangles])")
    log(sid, 'look', st, info)

async def film(page, sid):
    r = await stage(page, sid, json.dumps({'dur': float(opt('secs'))}) if opt('secs') else '{}')
    if r.get('error'): log(sid, 'not staged:', r['error']); return None
    secs = float(opt('secs', r['dur']))
    n = int(round(secs * FPS))
    d = OUT / sid
    d.mkdir(exist_ok=True)
    for f in d.glob('f*.jpg'): f.unlink()
    t = time.time()
    for i in range(n):
        await jpeg(page, d / f'f{i:04d}.jpg', 1 / FPS)
        if i % 12 == 11: log(sid, f'{i + 1}/{n} frames, {(time.time() - t) / (i + 1):.1f} s a frame')
    mp4 = OUT / f'{sid}.mp4'
    subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-framerate', str(FPS), '-i', str(d / 'f%04d.jpg'), '-c:v', 'libx264', '-preset', 'slow', '-crf', CRF,
                    '-pix_fmt', 'yuv420p', '-movflags', '+faststart', str(mp4)], check=True)
    log(sid, 'filmed', n, 'frames ->', mp4.name, f'{mp4.stat().st_size / 1e6:.2f} MB')
    if 'keep' not in FLAGS:
        for f in d.glob('f*.jpg'):
            if f.name not in ('f0000.jpg',): f.unlink()
    return mp4

# the trailer's chapters and the mood under each: (mood or stinger, seconds, the battle's heat)
SCORE = [('title', 5.56, None), ('logres', 5.33, None), ('eriu', 5.33, None), ('thule', 5.33, None), ('frontier', 5.33, None), ('battle', 26.45, 1),
         ('title', 10.33, None), ('frontier', 5.33, None), ('barrow', 10.67, None), ('title', 5.56, None), ('victory', 7.0, None)]
XF = 0.8

async def track(page, sid, tracks):
    r = await stage(page, sid, json.dumps({'dur': float(opt('secs')), 'hold': True}) if opt('secs') else '{"hold": true}')
    if r.get('error'): log(sid, 'not staged:', r['error']); return
    secs = float(opt('secs', r['dur']))
    t = json.loads(await page.evaluate(f"JSON.stringify(__hm.capture.track({FPS}, {int(round(secs * FPS))}, {W} / {H}))"))
    tracks[sid] = t
    log(sid, 'tracked', t['marks'], len(t['frames']), 'frames')

async def score(page):
    parts = []
    for i, (what, secs, heat) in enumerate(SCORE):
        o = {'wav': True, 'vol': 0.9}
        if heat is not None: o['heat'] = heat
        r = json.loads(await page.evaluate(f"__hm.music.render('{what}', {secs + (XF if i < len(SCORE) - 1 else 0):.2f}, {json.dumps(o)}).then((r) => JSON.stringify(r))"))
        f = OUT / f'score_{i:02d}_{what}.wav'
        f.write_bytes(base64.b64decode(r['wav']))
        # each segment brought to a level of its own (the moods come out 18 dB apart): the battle and the last stinger louder
        want = -19.0 if what in ('battle', 'victory') else -22.0
        parts.append((f, want - r['rmsDb']))
        log('score', what, f'{secs} s', 'peak', r['peakDb'], 'dB, rms', r['rmsDb'], 'dB')
    # laid end to end with crossfades, a gentle fade at the very end
    inputs = sum((['-i', str(f)] for f, _ in parts), [])
    chain = [f'[{i}:a]volume={g:.1f}dB[g{i}]' for i, (_, g) in enumerate(parts)]
    last = '[g0]'
    for i in range(1, len(parts)):
        out = f'[x{i}]'
        chain.append(f'{last}[g{i}]acrossfade=d={XF}:c1=tri:c2=tri{out}')
        last = out
    total = sum(x[1] for x in SCORE)
    chain.append(f'{last}afade=t=out:st={total - 2.5:.2f}:d=2.5,alimiter=limit=0.89[out]')
    subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', *inputs, '-filter_complex', ';'.join(chain), '-map', '[out]', '-c:a', 'aac', '-b:a', '128k', '-ar', '44100', str(OUT / 'score.m4a')], check=True)
    log('score ->', (OUT / 'score.m4a').name, f'{total:.1f} s')

VARIANT = {'spring': 'season', 'summer': 'season', 'autumn': 'season', 'winter': 'season', 'dawn': 'tod', 'day': 'tod', 'golden': 'tod', 'dusk': 'tod', 'night': 'tod', 'after': 'tod',
           'clear': 'weather', 'haze': 'weather', 'rain': 'weather', 'storm': 'weather', 'snow': 'weather', 'mist': 'weather'}

async def still(page, spec):
    sid, _, var = spec.partition(':')
    extra = json.dumps({VARIANT[var]: var, 'hold': True}) if var else '{"hold": true}'
    r = await stage(page, sid, extra)
    if r.get('error'): log(spec, 'not staged:', r['error']); return
    await page.evaluate(f"for (let i = 0; i < 3; i++) __hm.capture.step({1 / FPS}); 0")
    await png(page, OUT / f'still_{sid}_{var or "plain"}.png', 1 / FPS)
    log(spec, 'still')

async def main():
    async with async_playwright() as p:
        b, page, logs = await setup(p)
        log('booted')
        await page.evaluate(START.replace('%Q%', Q))
        log('started; the war has run 30 s')
        shots = json.loads(await page.evaluate("JSON.stringify(__hm.capture.shots())"))
        want = opt('shots')
        ids = [s['id'] for s in shots] if (want in (None, 'all') and not opt('stills') and 'score' not in FLAGS) else ([] if want is None else want.split(','))
        for s in shots:
            if s['id'] in ids and s['need']: log(s['id'], 'needs:', s['need'])
        tracks = {}
        for sid in ids:
            if 'look' in FLAGS: await look(page, sid)
            elif 'track' in FLAGS: await track(page, sid, tracks)
            else: await film(page, sid)
        if tracks: (OUT / 'tracks.json').write_text(json.dumps(tracks)); log('tracks ->', 'tracks.json')
        for spec in (opt('stills') or '').split(','):
            if spec: await still(page, spec)
        if 'score' in FLAGS: await score(page)
        errs = await page.evaluate("__hm.errors.map(String).slice(0, 8)")
        log('errors:', errs or 'none', logs[:4])
        await b.close()

if __name__ == "__main__":
    asyncio.run(main())
