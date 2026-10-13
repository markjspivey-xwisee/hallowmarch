"""[perf2] The March on a phone: boot, memory and frame time with everything the game has become.
usage: python3 tools/tests/perf2.py boot [track] [w=640] [h=360] [tag=now]
         the boot's steps, the heap after boot and what holds it: the JS heap (a GC first), the ArrayBuffers' backing
         stores, the GPU's buffers, textures and renderbuffers (counted at the WebGL calls), the geometries and textures
         by the system that made them, the biggest typed arrays still alive by where they were made (`track`: every
         typed array of 64 KB or more is followed from its making; slows the boot a little), the processes' RSS
       python3 tools/tests/perf2.py views [low,medium] [views=town,keep,siege,battle,barrow,townfire] [frames=240] [tag=now]
         the steady JS per step and per frame in each view, and the worst frames of a run of frames played in it
         (what each spike did: programs linked, geometries and textures made, the systems' JS time)
       python3 tools/tests/perf2.py long [minutes=60] [every=5] [q=low] [tag=now]
         an hour of AI-only war (campaign_soak's way: the player in their town), every `every` minutes the heap (after
         a GC), the GPU's bytes, the scene's objects, geometries, textures and programs, the lists that can grow, and a
         run of frames drawn at low; fails if the heap or the scene keeps growing
       python3 tools/tests/perf2.py phone [cpu=4] [tag=now]
         a phone: 390x780 with touch, the CPU slowed `cpu` times (CDP), the boot and the first minute's frames at low,
         the touch controls' own cost (the stick, a camera drag, a tap that picks), the memory after
       python3 tools/tests/perf2.py geohash [tag=now]     the merged meshes' arrays hashed (two builds: the same geometry)
       python3 tools/tests/perf2.py ab [tag=now]          the old way and the new, turn and turn about, in one page
Writes tools/out/perf2_<mode>_<tag>.json."""
import asyncio, json, os, sys, time, pathlib, re
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
import hm
from playwright.async_api import async_playwright

ARGS = sys.argv[1:]
MODE = ARGS[0] if ARGS else 'boot'
OPT = dict(a.split('=', 1) for a in ARGS if '=' in a)
TAG = OPT.get('tag', 'now')
OUT = str(hm.OUT) + '/'

# ---------------------------------------------------------------------------------------------------------------
# Followed from before the page's first script: typed arrays of 64 KB or more (where they were made, a weak ref to
# their buffer) and the GPU's memory (the WebGL calls that size a buffer, a texture or a renderbuffer).
# ---------------------------------------------------------------------------------------------------------------
INIT_GL = r"""
(() => {
  // the page's own frame loop can be held (window.__rafHold): only the frames a test asks for are drawn
  window.__rafHold = false; const raf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = (cb) => raf((t) => { if (window.__rafHold) window.requestAnimationFrame(cb); else cb(t); });
  // the JS heap's highest, looked at between the boot's steps (each step's garbage is still there as it ends)
  const PK = window.__perf2peak = { heap: 0, at: 0, n: 0 };
  const look = () => { const m = performance.memory; if (m && m.usedJSHeapSize > PK.heap) { PK.heap = m.usedJSHeapSize; PK.at = Math.round(performance.now()); } PK.n++; if (!(window.__hm && window.__hm.ready)) setTimeout(look, 20); };
  setTimeout(look, 0);
})();
(() => {
  const T = window.__perf2 = { arrays: [], gl: { buf: new Map(), tex: new Map(), rb: new Map(), mips: new Set() }, t0: performance.now() };
  const G = T.gl;
  const P = WebGL2RenderingContext.prototype;
  const st = { buf: {}, unit: 0, tex: {}, rb: null };
  const bpp = (fmt, type) => {
    const gl = WebGL2RenderingContext;
    switch (fmt) {
      case gl.R8: case gl.ALPHA: case gl.LUMINANCE: case gl.RED: return type === gl.FLOAT ? 4 : type === gl.HALF_FLOAT ? 2 : 1;
      case gl.RG8: case gl.LUMINANCE_ALPHA: case gl.RG: return type === gl.FLOAT ? 8 : type === gl.HALF_FLOAT ? 4 : 2;
      case gl.R16F: case gl.DEPTH_COMPONENT16: return 2;
      case gl.RG16F: case gl.R32F: case gl.DEPTH_COMPONENT24: case gl.DEPTH_COMPONENT32F: case gl.DEPTH24_STENCIL8: case gl.RGBA8: case gl.SRGB8_ALPHA8: case gl.RGB10_A2: case gl.R11F_G11F_B10F: return 4;
      case gl.RG32F: case gl.RGBA16F: return 8;
      case gl.RGB16F: return 6;
      case gl.RGB32F: return 12;
      case gl.RGBA32F: return 16;
      case gl.RGB8: case gl.RGB: return type === gl.FLOAT ? 12 : type === gl.HALF_FLOAT ? 6 : 3;
      case gl.RGBA: return type === gl.FLOAT ? 16 : type === gl.HALF_FLOAT ? 8 : 4;
      case gl.DEPTH_COMPONENT: return 4;
      case gl.DEPTH_STENCIL: return 4;
      default: return 4;
    }
  };
  const wrap = (name, f) => { const o = P[name]; P[name] = function (...a) { f.call(this, a); return o.apply(this, a); }; };
  wrap('bindBuffer', (a) => { st.buf[a[0]] = a[1]; });
  wrap('bufferData', (a) => { const b = st.buf[a[0]]; if (b) G.buf.set(b, typeof a[1] === 'number' ? a[1] : a[1] ? a[1].byteLength : 0); });
  wrap('deleteBuffer', (a) => { G.buf.delete(a[0]); });
  wrap('activeTexture', (a) => { st.unit = a[0]; });
  wrap('bindTexture', (a) => { st.tex[st.unit + ':' + a[0]] = a[1]; });
  const texOf = (target) => { const gl = WebGL2RenderingContext; const t = target >= gl.TEXTURE_CUBE_MAP_POSITIVE_X && target <= gl.TEXTURE_CUBE_MAP_NEGATIVE_Z ? gl.TEXTURE_CUBE_MAP : target; return st.tex[st.unit + ':' + t]; };
  const setTex = (tex, key, bytes) => { if (!tex) return; let m = G.tex.get(tex); if (!m) G.tex.set(tex, (m = new Map())); m.set(key, bytes); };
  wrap('texImage2D', (a) => {
    const tex = texOf(a[0]); let w, h, fmt = a[2], type;
    if (a.length >= 8 && typeof a[3] === 'number' && typeof a[4] === 'number' && typeof a[5] === 'number') { w = a[3]; h = a[4]; type = a[7]; }
    else { const s = a[5]; w = s && (s.width || s.videoWidth) || 0; h = s && (s.height || s.videoHeight) || 0; type = a[4]; }
    setTex(tex, a[0] + ':' + a[1], w * h * bpp(fmt, type));
  });
  wrap('texStorage2D', (a) => { const tex = texOf(a[0]); let w = a[3], h = a[4], s = 0; for (let l = 0; l < a[1]; l++) { s += w * h; w = Math.max(1, w >> 1); h = Math.max(1, h >> 1); } setTex(tex, 'storage', s * bpp(a[2]) * (a[0] === WebGL2RenderingContext.TEXTURE_CUBE_MAP ? 6 : 1)); });
  wrap('texImage3D', (a) => { const tex = texOf(a[0]); setTex(tex, a[0] + ':' + a[1], (a[3] * a[4] * a[5]) * bpp(a[2], a[8])); });
  wrap('texStorage3D', (a) => { const tex = texOf(a[0]); setTex(tex, 'storage', a[2] ? a[3] * a[4] * a[5] * bpp(a[2]) : 0); });
  wrap('generateMipmap', (a) => { const tex = texOf(a[0]); if (tex) G.mips.add(tex); });
  wrap('deleteTexture', (a) => { G.tex.delete(a[0]); G.mips.delete(a[0]); });
  wrap('bindRenderbuffer', (a) => { st.rb = a[1]; });
  wrap('renderbufferStorage', (a) => { if (st.rb) G.rb.set(st.rb, a[2] * a[3] * bpp(a[1])); });
  wrap('renderbufferStorageMultisample', (a) => { if (st.rb) G.rb.set(st.rb, a[3] * a[4] * bpp(a[2]) * Math.max(1, a[1])); });
  wrap('deleteRenderbuffer', (a) => { G.rb.delete(a[0]); });
  T.glBytes = () => {
    let b = 0, t = 0, r = 0, nt = 0;
    for (const v of G.buf.values()) b += v;
    for (const [tex, m] of G.tex) { let s = 0; for (const v of m.values()) s += v; if (G.mips.has(tex)) s *= 4 / 3; t += s; nt++; }
    for (const v of G.rb.values()) r += v;
    return { buffers: Math.round(b / 1048576 * 10) / 10, textures: Math.round(t / 1048576 * 10) / 10, renderbuffers: Math.round(r / 1048576 * 10) / 10, nBuffers: G.buf.size, nTextures: nt, nRenderbuffers: G.rb.size };
  };
})();
"""
INIT_TRACK = r"""
(() => {
  const T = window.__perf2, MIN = 1 << 16;
  const caller = () => {
    const lim = Error.stackTraceLimit; Error.stackTraceLimit = 14;
    const st = String(new Error().stack || '').split('\n'); Error.stackTraceLimit = lim;
    const out = [];
    for (let i = 2; i < st.length && out.length < 3; i++) {
      const m = /at (?:new )?([\w$.<>]+)(?: \[as [\w$]+\])? \(/.exec(st[i]);
      if (!m || /^(Proxy|Reflect)\b|construct$/.test(m[1])) continue;
      out.push(m[1].replace(/^Object\./, ''));
    }
    return out.join(' < ') || '(top level)';
  };
  for (const name of ['Float32Array', 'Float64Array', 'Uint8Array', 'Uint8ClampedArray', 'Int8Array', 'Uint16Array', 'Int16Array', 'Uint32Array', 'Int32Array']) {
    const C = window[name];
    const Px = new Proxy(C, { construct(t, args, nt) {
      const o = Reflect.construct(t, args, nt === Px ? t : nt);
      if (o.byteLength >= MIN) T.arrays.push({ k: name, b: o.buffer.byteLength, at: caller(), ref: new WeakRef(o.buffer), t: Math.round(performance.now()) });
      return o;
    } });
    window[name] = Px;
  }
})();
"""

# what holds the memory, seen from inside the page (the scene's geometries and the textures its materials use)
MEM_JS = r"""(() => {
  const H = __hm, R = H.dbg.renderer, scene = H.dbg.scene, lab = H.perf.label;
  const geos = new Map(), byLab = {}, texs = new Map();
  let nObj = 0, nMesh = 0, nVis = 0;
  const addTex = (t, who) => { if (t && t.isTexture && !texs.has(t)) texs.set(t, who); };
  scene.traverse((o) => {
    nObj++;
    if (o.visible) nVis++;
    if (o.geometry) {
      nMesh++;
      const g = o.geometry;
      if (!geos.has(g)) {
        const seen = new Set(); let b = 0;
        const arrs = Object.values(g.attributes).concat(g.index ? [g.index] : []);
        for (const a of arrs) { const arr = a.isInterleavedBufferAttribute ? a.data.array : a.array; if (arr && !seen.has(arr)) { seen.add(arr); b += arr.byteLength; } }
        geos.set(g, b);
        const k = lab(o); const r = byLab[k] || (byLab[k] = { k, n: 0, b: 0 }); r.n++; r.b += b;
      }
    }
    const ms = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
    for (const m of ms) {
      for (const p of ['map', 'alphaMap', 'normalMap', 'envMap']) addTex(m[p], lab(o));
      if (m.uniforms) for (const u of Object.values(m.uniforms)) { const v = u && u.value; if (v && v.isTexture) addTex(v, lab(o)); else if (Array.isArray(v)) for (const q of v) addTex(q, lab(o)); }
    }
  });
  const tex = [];
  for (const [t, who] of texs) {
    const im = t.image || {}; let b = 0;
    if (im.data) b = im.data.byteLength * (im.depth || 1) / (im.depth ? im.depth : 1);
    else if (t.isRenderTargetTexture || t.isDepthTexture) b = (im.width || 0) * (im.height || 0) * (t.type === 1016 || t.type === 1015 ? (t.type === 1015 ? 16 : 8) : 4);
    else b = (im.width || 0) * (im.height || 0) * 4;
    if (t.generateMipmaps && !t.isDataTexture) b *= 4 / 3;
    tex.push({ k: (t.name || '') + ' ' + (im.width || 0) + 'x' + (im.height || 0) + (im.depth ? 'x' + im.depth : '') + (t.isRenderTargetTexture ? ' rt' : '') + ' (' + who + ')', b });
  }
  tex.sort((a, b) => b.b - a.b);
  const rows = Object.values(byLab).sort((a, b) => b.b - a.b);
  const T = window.__perf2;
  let arrays = null;
  if (T && T.arrays.length) {
    const seen = new Set(), by = {}; let live = 0, made = 0;
    for (const a of T.arrays) {
      made += a.b;
      const buf = a.ref.deref(); if (!buf || seen.has(buf)) continue; seen.add(buf); live += buf.byteLength;
      const r = by[a.at] || (by[a.at] = { at: a.at, n: 0, b: 0, k: a.k }); r.n++; r.b += buf.byteLength;
    }
    arrays = { liveMB: +(live / 1048576).toFixed(1), madeMB: +(made / 1048576).toFixed(1), n: T.arrays.length, top: Object.values(by).sort((a, b) => b.b - a.b).slice(0, 40).map((r) => ({ at: r.at, n: r.n, mb: +(r.b / 1048576).toFixed(2), k: r.k })) };
  }
  return {
    scene: { objects: nObj, meshes: nMesh, visible: nVis, geometries: geos.size, geoMB: +([...geos.values()].reduce((a, b) => a + b, 0) / 1048576).toFixed(1) },
    info: { geometries: R.info.memory.geometries, textures: R.info.memory.textures, programs: R.info.programs.length },
    gl: T && T.glBytes ? T.glBytes() : null,
    geoTop: rows.slice(0, 30).map((r) => ({ k: r.k, n: r.n, mb: +(r.b / 1048576).toFixed(2) })),
    texTop: tex.slice(0, 30).map((t) => ({ k: t.k, mb: +(t.b / 1048576).toFixed(2) })), texMB: +(tex.reduce((a, t) => a + t.b, 0) / 1048576).toFixed(1),
    arrays,
    ents: H.ENT.length,
  };
})()"""

def procs_rss():
    """RSS (MB) of this test's own browser processes (descendants of this python process), by kind."""
    me = os.getpid()
    par = {}
    for d in os.listdir('/proc'):
        if not d.isdigit(): continue
        try:
            s = open(f'/proc/{d}/stat').read()
            par[int(d)] = int(s[s.rfind(')') + 2:].split()[1])
        except Exception: pass
    kids, frontier = set(), {me}
    while frontier:
        nxt = {p for p, pp in par.items() if pp in frontier and p not in kids}
        kids |= nxt; frontier = nxt
    out = {}
    for pid in kids:
        try:
            cmd = open(f'/proc/{pid}/cmdline').read().replace('\0', ' ')
            rss = 0
            for line in open(f'/proc/{pid}/status'):
                if line.startswith('VmRSS:'): rss = int(line.split()[1]) / 1024
            m = re.search(r'--type=([\w-]+)', cmd)
            kind = m.group(1) if m else ('browser' if 'chrom' in cmd else 'driver')
            if kind == 'utility' and 'network' in cmd: kind = 'network'
            out[kind] = round(out.get(kind, 0) + rss)
        except Exception: pass
    return out

async def open_page(p, w, h, touch=False, track=False, cpu=1, sampling=False, init=''):
    b = await p.chromium.launch(args=['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-precise-memory-info', '--js-flags=--expose-gc'])
    ctx = await b.new_context(viewport={'width': w, 'height': h}, has_touch=touch, is_mobile=touch, device_scale_factor=(2 if touch else 1))
    page = await ctx.new_page()
    logs = []
    page.on('pageerror', lambda e: logs.append(f'[pageerror] {e}'))
    await page.add_init_script(INIT_GL + (INIT_TRACK if track else '') + init)
    three = hm.THREE_LOCAL.read_text()
    async def three_route(route): await route.fulfill(status=200, content_type='application/javascript', body=three, headers={'Access-Control-Allow-Origin': '*'})
    await page.route(hm.THREE_URL, three_route)
    async def font_route(route): await route.fulfill(status=200, content_type='text/css', body='')
    await page.route('https://fonts.googleapis.com/**', font_route)
    html = hm.SKELETON.replace('%s', hm.HTML.read_text())
    async def doc_route(route): await route.fulfill(status=200, content_type='text/html', body=html)
    await page.route('http://hm.test/', doc_route)
    cdp = await ctx.new_cdp_session(page)
    if cpu > 1: await cdp.send('Emulation.setCPUThrottlingRate', {'rate': cpu})
    if sampling:
        await cdp.send('HeapProfiler.enable')
        await cdp.send('HeapProfiler.startSampling', {'samplingInterval': 65536})
    if 'profile' in ARGS and MODE in ('boot', 'phone'):
        await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', {'interval': 500})
        await cdp.send('Profiler.start')
    t0 = time.time()
    await page.goto('http://hm.test/', wait_until='commit')
    await page.wait_for_function('window.__hm && window.__hm.ready', timeout=900000, polling=500)
    wall = time.time() - t0
    return b, page, cdp, logs, wall

async def heap(cdp):
    await cdp.send('HeapProfiler.collectGarbage')
    u = await cdp.send('Runtime.getHeapUsage')
    return {'usedMB': round(u['usedSize'] / 1048576, 1), 'totalMB': round(u['totalSize'] / 1048576, 1),
            'backingMB': round(u.get('backingStorageSize', 0) / 1048576, 1), 'embedderMB': round(u.get('embedderHeapUsedSize', 0) / 1048576, 1)}

def sampling_top(prof, n=30):
    """live JS heap by the function that allocated it (self) and by the boot step functions (total)"""
    self_b, tot_b = {}, {}
    def walk(node, stack):
        cf = node['callFrame']; fn = cf['functionName'] or '(anon)'
        if cf.get('url', '').startswith('http://hm.test') or fn != '(anon)':
            pass
        self_b[fn] = self_b.get(fn, 0) + node['selfSize']
        stack2 = stack + [fn]
        sub = node['selfSize']
        for c in node.get('children', []): sub += walk(c, stack2)
        if fn not in stack: tot_b[fn] = tot_b.get(fn, 0) + sub
        return sub
    walk(prof['head'], [])
    top_self = sorted(self_b.items(), key=lambda kv: -kv[1])[:n]
    top_tot = sorted(tot_b.items(), key=lambda kv: -kv[1])[:n]
    return [(k, round(v / 1048576, 1)) for k, v in top_self], [(k, round(v / 1048576, 1)) for k, v in top_tot]

def mb(x): return f'{x:.1f}'

async def mode_boot():
    W, H = int(OPT.get('w', 640)), int(OPT.get('h', 360))
    track = 'track' in ARGS
    res = {}
    async with async_playwright() as p:
        b, page, cdp, logs, wall = await open_page(p, W, H, track=track, sampling='sample' in ARGS)
        res['wall'] = round(wall, 1)
        if 'profile' in ARGS:
            prof = (await cdp.send('Profiler.stop'))['profile']
            res['profile'] = prof_top(prof, 60)
            res['profileTotal'] = prof_total(prof, 50)
        res['boot'] = await page.evaluate('__hm.perf.boot()')
        res['peak'] = await page.evaluate("({ heapMB: Math.round(window.__perf2peak.heap / 1048576), at: window.__perf2peak.at, looks: window.__perf2peak.n })")
        res['scriptAt'] = await page.evaluate("__hm.perf2 ? __hm.perf2.scriptAt : null")
        res['steps'] = await page.evaluate("__hm.perf2 ? __hm.perf2.steps() : null")
        if 'sample' in ARGS:
            prof = (await cdp.send('HeapProfiler.getSamplingProfile'))['profile']
            await cdp.send('HeapProfiler.stopSampling')
            res['heapSelf'], res['heapTotal'] = sampling_top(prof)
        res['heapBoot'] = await heap(cdp)
        res['memBoot'] = await page.evaluate(MEM_JS)
        res['rssBoot'] = procs_rss()
        # the world's own checks: the map image's pixels and the land's heights, the same from build to build
        res['world'] = await page.evaluate("""(() => { const c = __hm.UI.mapImg, d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let h = 0; for (let i = 0; i < d.length; i++) h = (h * 31 + d[i]) >>> 0;
          const W = __hm.fn.W; let hh = 0; for (let i = 0; i < W.H.length; i += 7) hh = (hh * 31 + Math.round(W.H[i] * 1000)) >>> 0;
          return { mapHash: h, heightHash: hh, trees: W.trees.length, colliders: __hm.build ? __hm.build.COLL.boxes.length + __hm.build.COLL.circles.length : null }; })()""")
        # a game started and a minute of it (the world comes alive: the war, the towns), at low as a test runs
        await page.evaluate("(() => { __hm.fn.setQuality(%r); __hm.start({ realm: 0, cls: 'warrior', level: 20 }); __hm.UI.modal = null; const P = __hm.GAME.player; P.hp = P.maxHp = 1e7; return 0; })()" % OPT.get('q', 'low'))
        await page.evaluate("(() => { for (let i = 0; i < 6; i++) { __hm.simulate(10); __hm.frame(0.05); } return 0; })()")
        res['heapPlay'] = await heap(cdp)
        res['memPlay'] = await page.evaluate(MEM_JS)
        res['rssPlay'] = procs_rss()
        res['errors'] = await page.evaluate('__hm.errors')
        await b.close()
    bt = res['boot']
    print(f"boot: ready in {res['wall']} s wall ({bt.get('readyAt')} ms page time), script began at {res['scriptAt']} ms; the JS heap's highest between steps {res['peak']}; the world {res['world']}")
    for s in (res['steps'] or bt['steps']): print(f"   {s[1]:9.1f} ms  {s[0]}" + (f"  (began at {s[2]} ms)" if len(s) > 2 else '') + (f", JS heap {s[3]} MB as it ended" if len(s) > 3 and s[3] is not None else ''))
    for k in ('Boot', 'Play'):
        hp, m, rs = res['heap' + k], res['mem' + k], res['rss' + k]
        print(f"\n== after {'boot' if k == 'Boot' else 'a game started and a minute played'}: JS heap {hp['usedMB']} MB (of {hp['totalMB']}), ArrayBuffers {hp['backingMB']} MB; GPU {m['gl']}; RSS {rs}")
        print(f"   scene {m['scene']}, renderer {m['info']}, entities {m['ents']}")
        print('   geometries by system (MB):', ', '.join(f"{r['k']} {r['mb']} ({r['n']})" for r in m['geoTop'][:18]))
        print(f"   textures (MB, {m['texMB']} in all):", ', '.join(f"{t['k']} {t['mb']}" for t in m['texTop'][:16]))
        if m['arrays']:
            a = m['arrays']
            print(f"   typed arrays of 64 KB or more: {a['liveMB']} MB alive of {a['madeMB']} MB made ({a['n']} made)")
            for r in a['top'][:28]: print(f"      {r['mb']:7.2f} MB  {r['n']:4d} x {r['k']:12s} {r['at']}")
    if 'heapSelf' in res:
        print('\nlive JS heap by allocating function (self, MB):', ', '.join(f'{k} {v}' for k, v in res['heapSelf'][:25]))
        print('live JS heap by function (with callees, MB):', ', '.join(f'{k} {v}' for k, v in res['heapTotal'][:25]))
    if 'profile' in res:
        print('\nboot profile, self ms:', ', '.join(f'{k} {v}' for k, v in res['profile'][:45]))
        print('\nboot profile, with callees ms:', ', '.join(f'{k} {v}' for k, v in res['profileTotal'][:45]))
    print('errors', res['errors'])
    pathlib.Path(OUT + f'perf2_boot_{TAG}.json').write_text(json.dumps(res, indent=1))


# ---------------------------------------------------------------------------------------------------------------
# views: the steady JS per step and per frame, and the worst frames of a run played in each view
# ---------------------------------------------------------------------------------------------------------------
VIEWS_JS = r"""
window.PV2 = {
  H: window.__hm,
  calm() { const P = this.H.GAME.player; P.hp = P.maxHp = 1e7; P.buffs.length = 0; P.casting = null; P.alive = true; },
  stand(x, z, yaw, pitch = 0.22, dist = 7) { const H = this.H, P = H.GAME.player; H.teleport(x, z); P.yaw = yaw; H.CAM.mode = 'play'; H.UI.modal = null; H.look(yaw, pitch, dist); this.calm(); },
  keepOf(realm) { return this.H.WAR.keeps.find((k) => k.orig === realm && k.realm === realm) || this.H.WAR.keeps.find((k) => k.orig === realm); },
  view(name) {
    const H = this.H, F = H.fn, pf = H.perf, P = H.GAME.player, WAR = H.WAR;
    if (H.INDOOR.on && name !== 'barrow') F.setIndoor(false);
    const town = pf.SITES.find((s) => s.kind === 'town' && s.realm === 0);
    if (name === 'town') {
      const fr = (F.W.fieldRects || []).slice().sort((a, b) => Math.hypot(a.x - town.x, a.z - town.z) - Math.hypot(b.x - town.x, b.z - town.z))[0];
      const dx = town.x - fr.x, dz = town.z - fr.z, d = Math.hypot(dx, dz) || 1;
      this.stand(fr.x - dx / d * 10, fr.z - dz / d * 10, Math.atan2(dx, dz));
    } else if (name === 'keep') {
      const k = pf.SITES.find((s) => s.kind === 'keep' && s.realm === 0);
      this.stand(k.x + 3, k.z + 3, Math.atan2(-k.x, -k.z));
    } else if (name === 'battle') {
      let best = null, bn = -1;
      for (const e of H.ENT) {
        if (!e.alive || (e.role !== 'soldier' && e.role !== 'guard') || !(e.combatUntil > H.GAME.t)) continue;
        let n = 0; for (const o of H.ENT) if (o.alive && o.kind !== 'door' && Math.abs(o.x - e.x) < 25 && Math.abs(o.z - e.z) < 25) n++;
        if (n > bn) { bn = n; best = e; }
      }
      if (!best) best = H.ENT.find((e) => e.alive && e.role === 'soldier');
      const a = Math.atan2(best.x, best.z);
      this.stand(best.x + Math.sin(a) * 14, best.z + Math.cos(a) * 14, a + Math.PI);
      this.battleN = bn;
    } else if (name === 'barrow') {
      const p = H.DUN.spots.arrive;
      P.x = P.prevX = p.x; P.z = P.prevZ = p.z; P.y = F.dunFloorAt(p.x, p.z); P.yaw = Math.PI / 2;
      F.setIndoor(true); H.CAM.mode = 'play'; H.UI.modal = null; H.look(Math.PI / 2, 0.3, 6); this.calm();
    } else if (name === 'siege') {
      // a Thule burh on fire (its palisade, its walk and its gate) with its garrison at the fires and a Logres band storming it
      const K = this.keepOf(2), C = F.castleOf(K.site), ek = WAR.keeps.indexOf(K);
      if (!this.siegeSet) {
        this.siegeSet = true;
        H.palisade.palisadeInit(); H.blaze.blazeInit();
        const g = H.SIEGE.SIEGE ? null : null;
        const pc = C.pal ? C.pal.cells.filter((c) => c.st === 0) : [];
        for (let i = 0; i < 4 && pc.length; i++) H.palisade.palisadeIgnite(pc[Math.floor((i + 0.5) * pc.length / 4)], 0.5);
        const dc = C.blaze ? C.blaze.cells.filter((c) => c.st === 0) : [];
        for (let i = 0; i < 3 && dc.length; i++) H.blaze.deckIgnite(dc[Math.floor((i + 0.5) * dc.length / 3)], 0.5);
        if (C.gate) H.blaze.gateIgnite(C.gate, 0.4);
        this.siegeBand = H.SIEGE.band(0, ek, 45, 10);
      }
      const S = K.site, a = Math.atan2(S.x, S.z);
      this.stand(S.x + Math.sin(a) * 42, S.z + Math.cos(a) * 42, a + Math.PI, 0.18, 9);
    } else if (name === 'townfire') {
      // the Logres town with three houses on fire and their people at them
      const S = H.REALMS[0].town;
      if (!this.fireSet) {
        this.fireSet = true;
        const hs = H.HOUSES.filter((h) => !h.keepHall && h.S === S && h.state === 'whole').sort((a, b) => Math.hypot(a.x - S.x, a.z - S.z) - Math.hypot(b.x - S.x, b.z - S.z));
        this.fireHouses = [hs[1], hs[4], hs[7]].filter(Boolean);
        for (const h of this.fireHouses) F.igniteHouse(h);
      }
      const h = this.fireHouses[0];
      this.stand(S.x + (h.x - S.x) * 0.3 + 6, S.z + (h.z - S.z) * 0.3 + 6, Math.atan2(h.x - S.x, h.z - S.z), 0.2, 8);
    }
    return 0;
  },
};
0;
"""

FRAMES_JS = r"""((n, dt, simGap) => {
  // each frame drawn with the GPU idle first (gl.finish), so the frame's own JS is measured apart from SwiftShader's
  // drawing, which is then waited for and timed on its own (gpu: a phone's GPU is another matter)
  const H = __hm, R = H.dbg.renderer, gl = R.getContext(), T = H.perf.PERFX.times, G = window.__perf2;
  const px = new Uint8Array(4), drain = () => { R.setRenderTarget(null); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); };
  const out = [], acc = {};
  const snap = () => { const s = {}; for (const k in T) s[k] = T[k].ms; return s; };
  const glb = () => { let b = 0; for (const v of G.gl.buf.values()) b += v; return b; };
  out.acc = acc;
  for (let i = 0; i < n; i++) {
    if (simGap > 0) H.simulate(simGap);
    drain();
    const p0 = R.info.programs.length, g0 = R.info.memory.geometries, t0x = R.info.memory.textures, b0 = glb(), s0 = snap();
    const t = performance.now();
    H.frame(dt);
    const ms = performance.now() - t;
    const t2 = performance.now(); drain(); const gpu = performance.now() - t2;
    const rec = { i, ms: +ms.toFixed(1), gpu: Math.round(gpu), prog: R.info.programs.length - p0, geo: R.info.memory.geometries - g0, tex: R.info.memory.textures - t0x, up: Math.round((glb() - b0) / 1024) };
    const s1 = snap(); let sys = 0; const top = [];
    for (const k in s1) { const d = s1[k] - (s0[k] || 0); sys += d; acc[k] = (acc[k] || 0) + d; if (d > 1.5) top.push([k, +d.toFixed(1)]); }
    rec.sys = +sys.toFixed(1);
    if (ms > 40 || rec.prog) rec.top = top.sort((a, b) => b[1] - a[1]).slice(0, 5);
    out.push(rec);
  }
  // the systems' JS within the frames themselves (ms a frame), the last record
  out.push({ acc: Object.entries(acc).map(([k, v]) => [k, +(v / n).toFixed(2)]).sort((a, b) => b[1] - a[1]).slice(0, 16) });
  return out;
})"""

STEPS_JS = r"""((n) => {
  // n single steps, each timed (simulate(0.05) is one simStep and the war's summary); a step over 40 ms keeps what its
  // systems took (the timers, when they are on: window.__perf2spikes), the rest of it being the GC and what is not timed
  const H = __hm, out = [], sp = window.__perf2spikes = [];
  for (let i = 0; i < n; i++) {
    H.perf.times(true);
    const t = performance.now(); H.simulate(0.05); const ms = performance.now() - t;
    out.push(+ms.toFixed(2));
    if (ms > 40) sp.push({ i, ms: +ms.toFixed(1), top: H.perf.times(true).slice(0, 4).map((q) => [q.k, q.ms]) });
  }
  return out;
})"""

MODLINES = None
def modline(line):
    """a line of the built page as module:line (the page's own lines are the skeleton's plus the build's)"""
    global MODLINES
    if MODLINES is None:
        html = hm.SKELETON.replace('%s', hm.HTML.read_text()).split('\n')
        MODLINES = [(i + 1, l[8:-8].strip()) for i, l in enumerate(html) if l.startswith('/* ---- ') and l.endswith(' ---- */') and l[8:-8].strip().endswith('.js')]
    best = None
    for start, name in MODLINES:
        if start <= line: best = (start, name)
        else: break
    return f'{best[1]}:{line - best[0]}' if best else str(line)

def prof_top(prof, n=40):
    nodes = {q['id']: q for q in prof['nodes']}
    self_t = {}
    for sid, dt in zip(prof.get('samples', []), prof.get('timeDeltas', [])):
        cf = nodes[sid]['callFrame']
        k = (cf['functionName'] or '(anon)') + (f" {modline(cf['lineNumber'] + 1)}" if cf.get('url', '').startswith('http://hm.test') else '')
        self_t[k] = self_t.get(k, 0) + dt
    return [(k, round(v / 1000, 1)) for k, v in sorted(self_t.items(), key=lambda kv: -kv[1])[:n]]

def prof_total(prof, n=40):
    """time with callees, by function (a function counted once in its own stack)"""
    nodes = {q['id']: q for q in prof['nodes']}
    parent = {}
    for q in prof['nodes']:
        for c in q.get('children', []): parent[c] = q['id']
    key = lambda q: (q['callFrame']['functionName'] or '(anon)') + (f" {modline(q['callFrame']['lineNumber'] + 1)}" if q['callFrame'].get('url', '').startswith('http://hm.test') else '')
    tot = {}
    for sid, dt in zip(prof.get('samples', []), prof.get('timeDeltas', [])):
        seen = set(); q = sid
        while q is not None:
            k = key(nodes[q])
            if k not in seen: seen.add(k); tot[k] = tot.get(k, 0) + dt
            q = parent.get(q)
    return [(k, round(v / 1000, 1)) for k, v in sorted(tot.items(), key=lambda kv: -kv[1])[:n]]

def stats(frames):
    ms = sorted(f['ms'] for f in frames)
    n = len(ms)
    if not n: return {}
    return {'n': n, 'median': ms[n // 2], 'p90': ms[int(n * 0.9)], 'p99': ms[min(n - 1, int(n * 0.99))], 'max': ms[-1], 'mean': round(sum(ms) / n, 1),
            'over50': sum(1 for x in ms if x > 50), 'over100': sum(1 for x in ms if x > 100), 'programs': sum(f['prog'] for f in frames)}

async def mode_views():
    W, H = int(OPT.get('w', 480)), int(OPT.get('h', 270))
    quals = [q for a in ARGS for q in a.split(',') if q in ('low', 'medium', 'high')] or ['low', 'medium']
    views = OPT.get('views', 'town,keep,siege,battle,barrow,townfire').split(',')
    nframes = int(OPT.get('frames', 60))
    res = {'views': {}}
    async with async_playwright() as p:
        b, page, cdp, logs, wall = await open_page(p, W, H)
        page.set_default_timeout(3000000)
        res['wall'] = round(wall, 1)
        await page.evaluate("window.__rafHold = true; 0")
        await page.evaluate(VIEWS_JS)
        await page.evaluate("(() => { __hm.fn.setQuality('low'); __hm.start({ realm: 0, cls: 'warrior', level: 30 }); PV2.calm(); __hm.setTod(0.55); __hm.UI.modal = null; return 0; })()")
        await page.evaluate("__hm.simulate(40); 0" if 'profile' in ARGS else "__hm.simulate(40); __hm.perf.timers(); 0")
        for q in quals:
            await page.evaluate(f"__hm.fn.setQuality('{q}'); 0")
            for v in views:
                t1 = time.time()
                await page.evaluate(f"PV2.view('{v}'); 0")
                # the steady cost of a step: 4 s simulated (80 steps), the systems timed, and each step on its own
                st = await page.evaluate("""(() => { __hm.simulate(0.5); __hm.perf.times(true);
                  const t = performance.now(); __hm.simulate(4); const s = performance.now() - t; const top = __hm.perf.times(true).slice(0, 10);
                  return { stepMs: +(s / 80).toFixed(2), top: top.map((q) => [q.k, q.ms]), ents: __hm.ENT.length }; })()""")
                if 'profile' in ARGS:
                    await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', {'interval': 250})
                    await cdp.send('Profiler.start')
                    await page.evaluate("__hm.simulate(8); 0")
                    prof = (await cdp.send('Profiler.stop'))['profile']
                    st['profile'] = prof_top(prof)
                    print(f'        profile of 8 s simulated (self ms):', ', '.join(f'{k} {v}' for k, v in st['profile'][:22]), flush=True)
                steps = await page.evaluate(STEPS_JS + "(160)")
                ss = sorted(steps)
                st['stepMedian'], st['stepP99'], st['stepMax'] = ss[len(ss) // 2], ss[int(len(ss) * 0.99)], ss[-1]
                st['stepSpikes'] = await page.evaluate("window.__perf2spikes || []")
                # frames: the first ones in view (what compiles and uploads on first sight), then a minute of the world with a
                # frame drawn every half second of it
                if 'fprofile' in ARGS:
                    # a CPU profile of 10 frames drawn back to back (no world between them): where a frame's own JS goes
                    await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', {'interval': 200})
                    await page.evaluate("(() => { const R = __hm.dbg.renderer, gl = R.getContext(), px = new Uint8Array(4); R.setRenderTarget(null); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); return 0; })()")
                    await cdp.send('Profiler.start')
                    await page.evaluate("(() => { for (let i = 0; i < 10; i++) __hm.frame(1 / 30); return 0; })()")
                    prof = (await cdp.send('Profiler.stop'))['profile']
                    st['fprofile'] = prof_top(prof, 40)
                    print('        frames profile (self ms over 10 frames):', ', '.join(f'{k} {v}' for k, v in st['fprofile'][:30]), flush=True)
                first = (await page.evaluate(FRAMES_JS + "(8, 1 / 30, 0)"))[:-1]
                fr = await page.evaluate(FRAMES_JS + f"({nframes}, 0.1, {60 / nframes - 0.1:.3f})")
                ftop = fr.pop()['acc']
                s = stats(fr)
                spikes = sorted(fr, key=lambda f: -f['ms'])[:5]
                res['views'].setdefault(v, {})[q] = {'steady': st, 'first': first, 'frames': s, 'spikes': spikes, 'ftop': ftop, 'gpu': sorted(f['gpu'] for f in fr)[len(fr) // 2]}
                med_sys = sorted(f['sys'] for f in fr)[len(fr) // 2]
                print(f"{q:6s} {v:9s} step {st['stepMs']:5.2f} ms (median {st['stepMedian']}, p99 {st['stepP99']}, max {st['stepMax']}); frame JS median {s['median']} ms (systems {med_sys}, the rest the draw), p90 {s['p90']}, max {s['max']}; first frames {[f['ms'] for f in first]} (programs {sum(f['prog'] for f in first)}); SwiftShader's drawing {res['views'][v][q]['gpu']} ms  [{time.time() - t1:.0f}s wall]", flush=True)
                print('        step top (ms in 80 steps):', ', '.join(f'{k} {m:.0f}' for k, m in st['top'][:8]), flush=True)
                for x in sorted(st['stepSpikes'], key=lambda x: -x['ms'])[:3]: print(f"        step spike #{x['i']}: {x['ms']} ms; " + (', '.join(f'{k} {m}' for k, m in x['top']) or '(no timers)') + ' (nested timers overlap: updateNPCs holds the thinks)', flush=True)
                print(f'        frame top (ms a frame, the frame alone):', ', '.join(f'{k} {m}' for k, m in ftop[:12]), flush=True)
                for f in [x for x in first if x['ms'] > 60] + spikes[:3]:
                    print(f"        spike #{f['i']}: {f['ms']} ms (systems {f['sys']}), programs {f['prog']}, geometries {f['geo']:+d}, textures {f['tex']:+d}, uploaded {f['up']} KB; " + ', '.join(f'{k} {m}' for k, m in f.get('top', [])), flush=True)
        res['errors'] = await page.evaluate('__hm.errors')
        print('errors', res['errors'])
        await b.close()
    pathlib.Path(OUT + f'perf2_views_{TAG}.json').write_text(json.dumps(res, indent=1))


# ---------------------------------------------------------------------------------------------------------------
# long: an hour of AI-only war, the page's memory and the scene watched for anything that grows without bound
# ---------------------------------------------------------------------------------------------------------------
LONG_JS = r"""(() => {
  const H = __hm, R = H.dbg.renderer, scene = H.dbg.scene;
  let objs = 0, meshes = 0; scene.traverse((o) => { objs++; if (o.isMesh || o.isPoints || o.isLine) meshes++; });
  const n = (v) => (v == null ? null : Array.isArray(v) ? v.length : v instanceof Map || v instanceof Set ? v.size : typeof v === 'number' ? v : null);
  const s = H.summary();
  const W = H.walls && H.walls.WALLS, B = H.blaze && H.blaze.BLAZE, TR = H.water && H.water.tracks;
  const lists = {
    ents: H.ENT.length, fires: H.dbg.FIRES.length, proj: s.proj, later: s.later, loot: H.LOOT.length, news: H.WAR.news.length,
    bands: H.WAR.warbands.length, bandsLive: H.WAR.warbands.filter((w) => !w.dead).length,
    shadowProxies: H.dbg.SHADOW.proxies.length, stuck: W ? n(W.stuck) : null, falling: W ? n(W.fall) : null,
    engines: H.SIEGE && H.SIEGE.SIEGE ? H.SIEGE.SIEGE.engines.length : null, masons: H.look3 ? n(H.look3.MASON.list) : null,
    rubble: H.rubble ? n(H.rubble.RUBBLE.list) : null, rafters: H.rafters ? n(H.rafters.RAFTERS.list) : null,
    roles: s.roles,
  };
  const G = window.__perf2 && window.__perf2.glBytes ? window.__perf2.glBytes() : null;
  return { t: Math.round(H.GAME.t), objs, meshes, geos: R.info.memory.geometries, texs: R.info.memory.textures, progs: R.info.programs.length, gl: G, lists,
    campaign: H.CW ? H.CW.state().n + ':' + H.CW.state().state : null, keeps: H.WAR.keeps.map((K) => K.realm).join(''), errors: H.errors.length, bad: s.nonFinite,
    perf2: H.perf2 ? H.perf2.mem() : null };
})()"""

LONG_FRAMES_JS = r"""(() => {
  // three frames at low in three places: the player's town, the biggest fight, the busiest keep; each with the GPU drained
  const H = __hm, R = H.dbg.renderer, gl = R.getContext(), P = H.GAME.player, px = new Uint8Array(4);
  const drain = () => { R.setRenderTarget(null); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); };
  const out = [];
  const at = (x, z) => { const ox = P.x, oz = P.z; P.x = P.prevX = x; P.z = P.prevZ = z; P.y = H.fn.heightAt(x, z); H.CAM.mode = 'play'; H.UI.modal = null;
    drain(); const p0 = R.info.programs.length; const t = performance.now(); H.frame(1 / 30); const ms = performance.now() - t; drain();
    H.frame(1 / 30); drain(); const t2 = performance.now(); H.frame(1 / 30); const ms2 = performance.now() - t2; drain();
    out.push([Math.round(ms), Math.round(ms2), R.info.programs.length - p0]); P.x = P.prevX = ox; P.z = P.prevZ = oz; P.y = H.fn.heightAt(ox, oz); };
  const S = H.REALMS[P.faction].town;
  at(S.x + 3, S.z + 3);
  let best = null, bn = -1;
  for (const e of H.ENT) { if (!e.alive || e.role !== 'soldier' || !(e.combatUntil > H.GAME.t)) continue; let k = 0; for (const o of H.ENT) if (o.alive && Math.abs(o.x - e.x) < 25 && Math.abs(o.z - e.z) < 25) k++; if (k > bn) { bn = k; best = e; } }
  if (best) at(best.x + 12, best.z + 12);
  const K = H.WAR.keeps[Math.floor(H.GAME.t / 300) % H.WAR.keeps.length];
  at(K.site.x + 30, K.site.z + 30);
  H.UI.modal = 'menu'; H.CAM.mode = 'play';
  return out;
})()"""

async def mode_long():
    mins = int(OPT.get('minutes', 60)); every = int(OPT.get('every', 5))
    W, H = int(OPT.get('w', 320)), int(OPT.get('h', 180))
    res = {'samples': []}
    async with async_playwright() as p:
        b, page, cdp, logs, wall = await open_page(p, W, H)
        page.set_default_timeout(3000000)
        await page.evaluate("window.__rafHold = true; 0")
        await page.evaluate(f"(() => {{ __hm.fn.setQuality('{OPT.get('q', 'low')}'); __hm.start({{ realm: 0, cls: 'warrior', level: 20 }}); __hm.UI.modal = 'menu'; return 0; }})()")
        res['boot'] = {'wall': round(wall, 1)}
        t0 = time.time()
        for k in range(mins // every + 1):
            if k:
                # the war goes on: 30 s at a time, the player kept out of it in their town, unharmed
                await page.evaluate("""((sec) => { const H = __hm; for (let t = 0; t < sec; t += 30) { H.simulate(30); const P = H.GAME.player, S = H.REALMS[P.faction].town;
                  P.x = P.prevX = S.x + 3; P.z = P.prevZ = S.z + 3; P.y = H.fn.heightAt(P.x, P.z); P.hp = P.maxHp; P.alive = true; } return 0; })""" + f"({every * 60})")
            fr = await page.evaluate(LONG_FRAMES_JS)
            hp = await heap(cdp)
            d = await page.evaluate(LONG_JS)
            d['heap'] = hp; d['frames'] = fr; d['rss'] = procs_rss(); d['wall'] = round(time.time() - t0)
            res['samples'].append(d)
            print(f"t={d['t']:5d}s [{d['wall']}s wall] heap {hp['usedMB']} MB, ArrayBuffers {hp['backingMB']} MB, GPU {d['gl']['buffers'] if d['gl'] else '?'}+{d['gl']['textures'] if d['gl'] else '?'} MB; scene {d['objs']} objects ({d['meshes']} drawn kinds), {d['geos']} geometries, {d['texs']} textures, {d['progs']} programs; "
                  f"frames (first, again, programs) {fr}; {d['campaign']} keeps {d['keeps']}; renderer RSS {d['rss'].get('renderer')} MB, GPU process {d['rss'].get('gpu-process')} MB", flush=True)
            print('       lists', json.dumps(d['lists']), 'errors', d['errors'], 'bad', d['bad'], flush=True)
        res['errors'] = await page.evaluate('__hm.errors')
        await b.close()
    S = res['samples']
    # what grew: from the sample at 10 minutes (the world awake, the war under way) to the last
    # from the tenth minute of war (the war's first engines, scaffolds and fires shown by then), never the last sample
    base = next((x for x in S[:-1] if x['t'] >= 590), S[max(0, len(S) - 2)])
    last = S[-1]
    grow = {'heapMB': round(last['heap']['usedMB'] - base['heap']['usedMB'], 1), 'backingMB': round(last['heap']['backingMB'] - base['heap']['backingMB'], 1),
            'objs': last['objs'] - base['objs'], 'geos': last['geos'] - base['geos'], 'texs': last['texs'] - base['texs'], 'progs': last['progs'] - base['progs']}
    peak = max(s['heap']['usedMB'] for s in S)
    res['grow'] = grow; res['peakHeap'] = peak
    print('\ngrowth from', base['t'], 's to', last['t'], 's:', json.dumps(grow), 'peak heap', peak, 'MB')
    fails = []
    # the limits: a heap that grows by more than a quarter (and 12 MB) over the hour, or a scene that keeps adding objects
    if grow['heapMB'] > max(12, base['heap']['usedMB'] * 0.25): fails.append(f"the JS heap grew {grow['heapMB']} MB")
    if grow['backingMB'] > 24: fails.append(f"ArrayBuffers grew {grow['backingMB']} MB")
    if grow['objs'] > 400: fails.append(f"the scene grew by {grow['objs']} objects")
    if grow['geos'] > 300: fails.append(f"the renderer holds {grow['geos']} more geometries")
    if grow['texs'] > 8: fails.append(f"the renderer holds {grow['texs']} more textures")
    if res['errors']: fails.append(f"errors: {res['errors'][:2]}")
    if any(s['bad'] for s in S): fails.append('non-finite positions')
    for f in fails: print('FAIL', f)
    print('PASS' if not fails else f'{len(fails)} FAILED')
    pathlib.Path(OUT + f'perf2_long_{TAG}.json').write_text(json.dumps(res, indent=1))
    if fails: sys.exit(1)

# ---------------------------------------------------------------------------------------------------------------
# phone: an upright phone with touch, its CPU slowed (CDP), the boot and the first minute's frames at low
# ---------------------------------------------------------------------------------------------------------------
TOUCH_JS = r"""(() => {
  const c = __hm.dbg.renderer.domElement, R = c.getBoundingClientRect(), now = () => performance.now();
  const ev = (type, id, x, y) => new PointerEvent(type, { pointerId: id, pointerType: 'touch', clientX: x, clientY: y, bubbles: true, isPrimary: id === 7 });
  const x0 = R.left + R.width * 0.2, y0 = R.top + R.height * 0.75, x1 = R.left + R.width * 0.75, y1 = R.top + R.height * 0.45;
  document.body.offsetWidth;
  c.dispatchEvent(ev('pointerdown', 7, x0, y0));
  let t = now();
  for (let i = 0; i < 200; i++) c.dispatchEvent(ev('pointermove', 7, x0 + 30 * Math.sin(i / 10), y0 - 30 * Math.cos(i / 10)));
  const stick = (now() - t) / 200;
  t = now(); document.body.offsetWidth; const layout = now() - t;
  c.dispatchEvent(ev('pointerup', 7, x0, y0));
  c.dispatchEvent(ev('pointerdown', 8, x1, y1));
  t = now();
  for (let i = 0; i < 200; i++) c.dispatchEvent(ev('pointermove', 8, x1 + 40 * Math.sin(i / 15), y1 + 10 * Math.cos(i / 15)));
  const drag = (now() - t) / 200;
  c.dispatchEvent(ev('pointerup', 8, x1, y1));
  t = now();
  for (let i = 0; i < 40; i++) { c.dispatchEvent(ev('pointerdown', 9 + i, x1, y1)); c.dispatchEvent(ev('pointerup', 9 + i, x1, y1)); }
  const tap = (now() - t) / 40;
  const r = (v) => +v.toFixed(3);
  return { stick: r(stick), drag: r(drag), tap: r(tap), layout: r(layout) };
})()"""

async def mode_phone():
    cpu = float(OPT.get('cpu', 4))
    res = {'cpu': cpu}
    async with async_playwright() as p:
        b, page, cdp, logs, wall = await open_page(p, 390, 780, touch=True, cpu=cpu)
        page.set_default_timeout(3000000)
        res['wall'] = round(wall, 1)
        res['steps'] = await page.evaluate("__hm.perf2 ? __hm.perf2.steps() : __hm.perf.boot().steps")
        res['scriptAt'] = await page.evaluate("__hm.perf2 ? __hm.perf2.scriptAt : null")
        res['quality'] = await page.evaluate("__hm.quality.level")
        res['heapBoot'] = await heap(cdp)
        res['memBoot'] = await page.evaluate(MEM_JS)
        res['rssBoot'] = procs_rss()
        print(f"phone (CPU {cpu}x slower, 390x780, touch): ready in {res['wall']} s wall, the game's script began at {res['scriptAt']} ms, quality {res['quality']}", flush=True)
        for st in res['steps']: print(f"   {st[1]:9.1f} ms  {st[0]}" + (f", JS heap {st[3]} MB as it ended" if len(st) > 3 and st[3] is not None else ''), flush=True)
        print(f"   after boot: JS heap {res['heapBoot']['usedMB']} MB, ArrayBuffers {res['heapBoot']['backingMB']} MB, GPU {res['memBoot']['gl']}, RSS {res['rssBoot']}", flush=True)
        # the title's own frames for a few seconds (the hidden things' shaders are asked for meanwhile), then the game
        await page.wait_for_timeout(3000)
        await page.evaluate("window.__rafHold = true; 0")
        await page.evaluate("(() => { __hm.start({ realm: 0, cls: 'warrior', level: 1 }); __hm.UI.modal = null; const P = __hm.GAME.player; P.hp = P.maxHp = 1e7; return 0; })()")
        # the first minute: a frame each 1/30 s of the world for the first 3 s, then one each half second (as a phone
        # draws at about 30 a second, the world between the frames simulated)
        fr = (await page.evaluate(FRAMES_JS + "(90, 1 / 30, 0)"))[:-1]
        fr2 = (await page.evaluate(FRAMES_JS + "(60, 0.1, 0.4)"))[:-1]
        res['first'] = stats(fr); res['minute'] = stats(fr2)
        res['spikes'] = sorted(fr + fr2, key=lambda f: -f['ms'])[:6]
        steps = await page.evaluate(STEPS_JS + "(100)")
        ss = sorted(steps)
        res['step'] = {'median': ss[len(ss) // 2], 'p90': ss[int(len(ss) * 0.9)], 'max': ss[-1]}
        # the touch controls' own cost: the stick dragged (200 moves), the camera dragged on the right (200), taps that
        # pick what is under the finger (40), each dispatched to the canvas as a phone's pointer events are, and the
        # style and layout the next frame then pays
        try:
            res['touch'] = await page.evaluate(TOUCH_JS)
            print(f"   touch: a stick move {res['touch']['stick']} ms, a camera drag's move {res['touch']['drag']} ms, a tap (picking) {res['touch']['tap']} ms; the style and layout after 200 stick moves {res['touch']['layout']} ms", flush=True)
        except Exception as ex:
            res['touch'] = {'error': str(ex)[:300]}
            print('   touch: could not measure:', res['touch']['error'], flush=True)
        res['heapPlay'] = await heap(cdp)
        res['memPlay'] = await page.evaluate(MEM_JS)
        res['rssPlay'] = procs_rss()
        res['errors'] = await page.evaluate('__hm.errors')
        await b.close()
    f, m = res['first'], res['minute']
    print(f"   first 90 frames (3 s at 30 a second): JS median {f['median']} ms, p90 {f['p90']}, max {f['max']}; programs linked {f['programs']}", flush=True)
    print(f"   a minute (a frame each half second): JS median {m['median']} ms, p90 {m['p90']}, max {m['max']}; a step (0.05 s) median {res['step']['median']} ms, p90 {res['step']['p90']}, max {res['step']['max']}", flush=True)
    for x in res['spikes'][:4]: print(f"      spike #{x['i']}: {x['ms']} ms (systems {x['sys']}), programs {x['prog']}, geometries {x['geo']:+d}, uploaded {x['up']} KB; " + ', '.join(f'{k} {v}' for k, v in x.get('top', [])), flush=True)
    print(f"   after a minute: JS heap {res['heapPlay']['usedMB']} MB, ArrayBuffers {res['heapPlay']['backingMB']} MB, GPU {res['memPlay']['gl']}, RSS {res['rssPlay']}", flush=True)
    print('errors', res['errors'])
    pathlib.Path(OUT + f'perf2_phone_{TAG}.json').write_text(json.dumps(res, indent=1))

# ---------------------------------------------------------------------------------------------------------------
# geohash: the merged meshes' arrays hashed (houses, keeps and temples, castles, towers' rooms and moving parts, the
# Barrow), the static meshes' arrays kept (__perf2NoRelease): run on two builds, the same hashes say the same geometry
# ---------------------------------------------------------------------------------------------------------------
GEOHASH_JS = r"""(() => {
  const H = __hm, out = {};
  const hashArr = (a, h) => { const u = new Uint8Array(a.buffer, a.byteOffset, a.byteLength); for (let i = 0; i < u.length; i++) h = Math.imul(h ^ u[i], 16777619) >>> 0; return h; };
  const hashGeo = (g, h) => { for (const k of Object.keys(g.attributes).sort()) { const a = g.attributes[k]; if (!a.array) return null; h = hashArr(new Float32Array(a.array), h); } if (g.index) { if (!g.index.array) return null; h = hashArr(new Uint32Array(g.index.array), h); } return h; };
  const add = (key, m) => { if (!m || !m.geometry) return; const v = hashGeo(m.geometry, out[key] || 2166136261); out[key] = v; out[key + '#n'] = (out[key + '#n'] || 0) + (m.geometry.attributes.position ? m.geometry.attributes.position.count : 0); };
  for (const R of H.REALMS) for (const S of [R.town, ...R.keepSites]) if (S.houseSet) { add('houses', S.houseSet.mExt); add('houses', S.houseSet.mIn); add('houses', S.houseSet.mGl); }
  for (const C of H.fn.castles()) add('castles', C.mesh);
  for (const q of H.towers.TOWER.inner) add('towerRooms', q.m);
  for (const K of H.towers.TOWER.keeps) add('towerParts', K.mesh);
  if (H.DUN.root) H.DUN.root.traverse((o) => { if (o.isMesh && !o.isInstancedMesh && o.geometry && o.geometry.attributes.aMat) add('barrow', o); });
  return out;
})()"""

async def mode_geohash():
    async with async_playwright() as p:
        b, page, cdp, logs, wall = await open_page(p, 320, 180, init='window.__perf2NoRelease = true;')
        r = await page.evaluate(GEOHASH_JS)
        await b.close()
    print('geohash', json.dumps(r, sort_keys=True))
    pathlib.Path(OUT + f'perf2_geohash_{TAG}.json').write_text(json.dumps(r, sort_keys=True))

# ---------------------------------------------------------------------------------------------------------------
# ab: the old way and the new side by side in one page, turn and turn about (a loaded machine moves each run's time a
# lot; turns of a few milliseconds each see the same load): collidersNear with a Set against the stamp (the same lists
# checked)
# ---------------------------------------------------------------------------------------------------------------
AB_JS = r"""(() => {
  const H = __hm, COLL = H.build.COLL, s = COLL.cell, key = (cx, cz) => cx * 4096 + cz, seen = new Set(), out = [];
  const oldNear = (x, z, rad) => { out.length = 0; seen.clear(); for (let cx = Math.floor((x - rad) / s); cx <= Math.floor((x + rad) / s); cx++) for (let cz = Math.floor((z - rad) / s); cz <= Math.floor((z + rad) / s); cz++) { const l = COLL.grid.get(key(cx, cz)); if (!l) continue; for (const c of l) if (!seen.has(c)) { seen.add(c); out.push(c); } } return out.length; };
  let q = 1e9; const newNear = (x, z, rad) => { out.length = 0; const qq = ++q; for (let cx = Math.floor((x - rad) / s), cx1 = Math.floor((x + rad) / s); cx <= cx1; cx++) for (let cz = Math.floor((z - rad) / s), cz1 = Math.floor((z + rad) / s); cz <= cz1; cz++) { const l = COLL.grid.get(key(cx, cz)); if (!l) continue; for (let i = 0; i < l.length; i++) { const c = l[i]; if (c._abq !== qq) { c._abq = qq; out.push(c); } } } return out.length; };
  const pts = H.ENT.filter((e) => e.alive && e.kind !== 'door').map((e) => [e.x, e.z]);
  const T = { old: 0, new: 0, n: 0, same: true, colls: 0 };
  for (let turn = 0; turn < 40; turn++) {
    for (const which of turn % 2 ? ['new', 'old'] : ['old', 'new']) {
      const f = which === 'old' ? oldNear : newNear, t = performance.now(); let c = 0;
      for (const [x, z] of pts) c += f(x, z, 12.5);
      T[which] += performance.now() - t; if (which === 'old') T.colls = c;
    }
  }
  for (const [x, z] of pts.slice(0, 50)) { const a = oldNear(x, z, 12.5), A = out.slice(); const b = newNear(x, z, 12.5); if (a !== b || out.some((c, i) => c !== A[i])) T.same = false; }
  T.n = pts.length * 40;
  return { queries: T.n, oldMs: +T.old.toFixed(1), newMs: +T.new.toFixed(1), usEachOld: +(T.old * 1000 / T.n).toFixed(2), usEachNew: +(T.new * 1000 / T.n).toFixed(2), collidersEach: Math.round(T.colls / pts.length), sameLists: T.same };
})()"""

async def mode_ab():
    async with async_playwright() as p:
        b, page, cdp, logs, wall = await open_page(p, 320, 180)
        page.set_default_timeout(3000000)
        await page.evaluate("window.__rafHold = true; 0")
        await page.evaluate("(() => { __hm.fn.setQuality('low'); __hm.start({ realm: 0, cls: 'warrior', level: 20 }); __hm.UI.modal = 'menu'; __hm.simulate(60); return 0; })()")
        r = await page.evaluate(AB_JS)
        # in a keep under siege: the bodies at the gate and on the walls
        await page.evaluate("(() => { const H = __hm, K = H.WAR.keeps[0]; H.SIEGE.band(1, 0, 30, 12); H.simulate(20); return 0; })()")
        r2 = await page.evaluate(AB_JS)
        await b.close()
    for k, v in (('the war at large', r), ('a keep stormed', r2)):
        print(f"collidersNear, {k}: {v['queries']} queries of 12.5 m ({v['collidersEach']} colliders each on average): a Set {v['oldMs']} ms ({v['usEachOld']} us each), the stamp {v['newMs']} ms ({v['usEachNew']} us each); the same lists: {v['sameLists']}")
    pathlib.Path(OUT + f'perf2_ab_{TAG}.json').write_text(json.dumps({'war': r, 'keep': r2}))

if __name__ == '__main__':
    asyncio.run({'boot': mode_boot, 'views': mode_views, 'long': mode_long, 'phone': mode_phone, 'geohash': mode_geohash, 'ab': mode_ab}[MODE]())
