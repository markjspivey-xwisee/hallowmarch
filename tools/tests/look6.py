"""[look6] The world looked at again with version 17's additions (version 18): what the look put right, by number. Its
pictures are look.py's `look6` group (python3 tools/tests/look.py views=look6 q=low,high, or look.py serve).
  patches  every shader patch of 14_look6.js took (the deep's floor, embers, water and pitch; the slabs' material)
  pitch    the pitch channels' strips face up (they faced down and were culled: the burning pitch was never drawn), and
           a burning cell's strip is drawn in the Hall of Pyres (the channels' draw call)
  seal     the seal's runes are embers (drawn by the embers' material, not the Barrow's blue glyphs)
  slab     every slab is drawn with the ground's marks on its top (a cracking slab's ring was under it), and the ring of a
           cracking slab is in the ground's marks while it cracks
  fall     a body on a gallery slab that falls goes down with it and lies on it (never below its top: it lay in the pit
           inside the fallen slab), harmed once by the fall as before, and climbs out onto the gallery's floor
  water    the cistern's water knows a swimmer in it (its rings and wake), and none when it is drained
  gate     a broken gate's hanging leaf stands against the passage's side (no board of it in the passage above the
           threshold's litter: it stood across half the gateway)
  builders the places at the foot of a house's scaffold: a builder's stints move along its side (k = 1..6 give four places
           or more) and two builders are not given the same place
  deep     the deep's own checks (LK.checkDeep, look_views.js): its dead on their floors and in nothing solid, its chests,
           its pitch, its slabs and its torches where they belong
  ash      ash round a burnt wreck is not charred, and burnt timber wears ash on what faces up (the siege material)
usage: python3 tools/tests/look6.py [only=patches,pitch,seal,slab,fall,water,gate,builders,deep,ash] [q=low]"""
import json, asyncio, sys, pathlib, time
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
from hmlib import setup
from playwright.async_api import async_playwright

ARGS = sys.argv[1:]
def arg(k, d=None):
    for a in ARGS:
        if a.startswith(k + '='): return a.split('=', 1)[1]
    return d
ALL = 'patches,pitch,seal,slab,fall,water,gate,builders,deep,ash'
ONLY = set((arg('only') or ALL).split(','))
Q = arg('q', 'low')
VIEWS_JS = pathlib.Path(__file__).resolve().parent / 'look_views.js'
FAILS = []
T0 = time.time()
def check(ok, msg):
    print(('  ok   ' if ok else '  FAIL ') + msg, flush=True)
    if not ok: FAILS.append(msg)
async def ev(page, js): return await page.evaluate(js)

PREP = r"""(() => {
  const H = __hm, F = H.fn, Lt = H.late.LATE2;
  H.start({ realm: 0, cls: 'warrior', level: 50 });
  const P = H.GAME.player; P.hp = P.maxHp = 1e7;
  Lt.d.king = Math.max(1, Lt.d.king || 0); H.GAME.prog.kingKills = 1;
  if (!H.deep.DEEP.opened) H.deep.late3SealOpen(true);
  window.L6 = {
    H, F, D: H.deep.DEEP,
    to(u, v) { const p = F.dunPoint(u, v); P.x = P.prevX = p.x; P.z = P.prevZ = p.z; P.y = p.y; P.vy = 0; P.onGround = true; P.l3fall = null; P.motion = null; P.hp = P.maxHp; F.setIndoor(true); H.deep.DEEP.root.visible = true; return p; },
    calm() { for (const e of H.ENT.slice()) if (e.alive && e.deep && !e.deepLord) { e.damagers = null; F.killEnt(e, null); F.removeEnt(e); } },
    sim(s, dt = 0.05) { const m = H.UI.modal; H.UI.modal = null; H.simulate(s, dt); H.UI.modal = m; },
  };
  return 0;
})()"""

async def main():
    async with async_playwright() as p:
        b, page, logs = await setup(p, w=640, h=360)
        await ev(page, f"__hm.fn.setQuality('{Q}')")
        await ev(page, PREP)
        print(f'booted [{time.time() - T0:.0f}s]', flush=True)

        if 'patches' in ONLY:
            r = await ev(page, "(() => { const L = __hm.look6.LOOK6; return { patched: L.patched, missed: L.missed }; })()")
            print('  ', json.dumps(r), flush=True)
            want = ['floor:joints', 'floor:shade', 'floor:embers', 'embers:broken', 'pitch:flames', 'water:decl', 'water:rings', 'water:light', 'slab']
            check(not r['missed'] and all(w in r['patched'] for w in want), f"every patch took ({len(r['patched'])}: {r['patched']}; missed {r['missed']})")

        if 'pitch' in ONLY:
            r = await ev(page, r"""(() => { const H = __hm, L6m = H.look6, D = H.deep.DEEP;
              const ch = D.root.children.find((m) => m.material === L6m.deepChannelMat);
              const g = ch.geometry, P = g.attributes.position.array, I = g.index.array; let up = 0, down = 0;
              for (let t = 0; t < I.length; t += 3) {
                const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3;
                const ux = P[b] - P[a], uz = P[b + 2] - P[a + 2], vx = P[c] - P[a], vz = P[c + 2] - P[a + 2];
                const ny = uz * vx - ux * vz; if (ny > 0) up++; else down++;
              }
              // a cell burning in the Hall of Pyres, the camera over it: the channels' mesh is drawn (its draw call)
              L6.calm(); H.deep.deepPitchOut(); const C = D.cells.find((q) => q.hall === 'pyres'); H.deep.deepIgnite(C, null); L6.sim(2.0);
              L6.to(H.fn.dunU(C.x) + 4, H.fn.dunV(C.z) + 1.5);
              H.UI.modal = 'menu'; H.CAM.mode = 'fixed'; H.camera.position.set(C.x + 3, C.y + 3, C.z + 2); H.camera.lookAt(C.x, C.y, C.z); H.camera.updateMatrixWorld();
              let drawn = 0; const r0 = ch.onAfterRender; ch.onAfterRender = () => { drawn++; };
              H.frame(1 / 30); H.frame(1 / 30); ch.onAfterRender = r0;
              return { up, down, side: ch.material.side, heat: +C.heat.toFixed(2), drawn };
            })()""")
            print('  ', json.dumps(r), flush=True)
            check(r['down'] == 0 and r['up'] > 200, f"the pitch channels' strips face up ({r['up']} triangles up, {r['down']} down: they faced down and were culled)")
            check(r['heat'] > 0.5 and r['drawn'] >= 1, f"a burning cell's channel is drawn in the Hall of Pyres (heat {r['heat']}, drawn {r['drawn']} times in two frames)")

        if 'seal' in ONLY:
            r = await ev(page, r"""(() => { const H = __hm, D = H.deep.DEEP, m = D.seal.mesh, kid = m.children.find((k) => k.material === H.look6.deepEmberMat);
              return { kid: !!kid, n: kid ? kid.geometry.attributes.position.count : 0 }; })()""")
            print('  ', json.dumps(r), flush=True)
            check(r['kid'] and r['n'] > 200, f"the seal's runes are drawn as embers ({r['n']} vertices in the embers' material)")

        if 'slab' in ONLY:
            r = await ev(page, r"""(() => { const H = __hm, D = H.deep.DEEP, M = H.look6.look6SlabMat;
              const all = D.slabs.every((S) => S.mesh.material === M), dec = M.fragmentShader.includes('sampleDecal(vW.xz)');
              L6.calm(); const S = D.slabs.find((s) => s.hall === 'crack' && s.st === 0); L6.to(H.fn.dunU(S.x) - 12, H.fn.dunV(S.z));
              H.deep.deepSlabCrack(S, 1.1, null);
              const marks = D.marks.filter((q) => q.slab === S).length; L6.sim(1.6);
              return { all, dec, marks, st: S.st };
            })()""")
            print('  ', json.dumps(r), flush=True)
            check(r['all'] and r['dec'], 'every slab is drawn with the ground\'s marks on its top (look6SlabMat)')
            check(r['marks'] >= 1 and r['st'] >= 2, f"a cracking slab's ring is in the ground's marks while it cracks, then it falls (state {r['st']})")

        if 'fall' in ONLY:
            r = await ev(page, r"""(() => { const H = __hm, F = H.fn, D = H.deep.DEEP, P = H.GAME.player, Dp = H.deep;
              L6.calm();
              const out = [];
              for (const [du, dv] of [[0, 0], [1.3, -2.0], [-1.4, 2.2]]) {
                const S = D.slabs.find((s) => s.hall === 'crack' && s.u0 === 76); if (S.st !== 0) Dp.deepSlabMend(S);
                S.mesh.rotation.set(0, 0, 0);
                L6.to((S.u0 + S.u1) / 2 + du, (S.v0 + S.v1) / 2 + dv); P.hp = P.maxHp = 1e6;
                const hp0 = P.hp; let below = 0, minGap = 9, worst = 0, landed = null, out1 = null;
                Dp.deepSlabFall(S);
                for (let i = 0; i < 90; i++) {
                  L6.sim(1 / 30, 1 / 30);
                  if (P.l3fall && P.l3fall.t < 1.5) { const top = H.look6.look6SlabTop(S, P.x, P.z), gap = P.y - top; minGap = Math.min(minGap, gap); if (gap < -0.03) { below++; worst = Math.min(worst, gap); } if (P.l3fall.t > 1.2 && landed === null) landed = { over: +(P.y - Dp.DEEP_PIT).toFixed(2), on: Math.abs(P.y - Math.max(Dp.DEEP_PIT + 0.05, top)) < 0.03 }; }
                  if (!P.l3fall && out1 === null && i > 10) out1 = { y: +P.y.toFixed(2), floor: +F.dunFloorAt(P.x, P.z).toFixed(2), t: i };
                }
                out.push({ du, dv, below, worst: +worst.toFixed(3), minGap: +minGap.toFixed(3), landed, harm: Math.round(hp0 - P.hp), out: out1, tilt: S.tilt.map((v) => +v.toFixed(2)) });
                Dp.deepSlabMend(S);
              }
              return out; })()""")
            print('  ', json.dumps(r), flush=True)
            for o in r:
                check(o['below'] == 0 and o['minGap'] > -0.03, f"a body falls with its slab, never below its top (at {o['du']}, {o['dv']} from its middle: worst {o['worst']} m, tilt {o['tilt']})")
                check(o['landed'] is not None and o['landed']['on'] and o['landed']['over'] > 0.03, f"it lies on the fallen slab (or the embers where its end has sunk), not in the pit under it ({o['landed']})")
                check(o['out'] is not None and abs(o['out']['y'] - o['out']['floor']) < 0.05, f"and climbs out onto the gallery's floor ({o['out']})")
            check(len(set(o['harm'] > 0 for o in r)) == 1 and all(o['harm'] > 0 for o in r), f"the fall harms it as before ({[o['harm'] for o in r]})")

        if 'water' in ONLY:
            r = await ev(page, r"""(() => { const H = __hm, D = H.deep.DEEP, Dp = H.deep, P = H.GAME.player;
              L6.calm();
              D.flood.st = 2; D.flood.t = 0; D.flood.next = 1e9; D.wy = Dp.DEEP_FLOOD.high; D.water.position.y = D.wy;
              L6.to(171, 46.5); H.UI.modal = 'menu'; H.CAM.mode = 'play';
              L6.sim(1.0); H.frame(1 / 30); H.frame(1 / 30);
              const a = { swim: !!P.swim, n: H.look6.LOOK6.ringN, u: H.look6.deepWaterMat.uniforms.uL6Ring.value[0].toArray().map((v) => +v.toFixed(2)), px: +P.x.toFixed(2), pz: +P.z.toFixed(2) };
              D.flood.st = 0; D.wy = Dp.DEEP_FLOOD.base; D.water.position.y = D.wy; L6.to(180, 39.5); L6.sim(0.3); H.frame(1 / 30);
              a.dry = H.look6.LOOK6.ringN;
              return a; })()""")
            print('  ', json.dumps(r), flush=True)
            check(r['swim'] and r['n'] >= 1 and abs(r['u'][0] - r['px']) < 0.5 and abs(r['u'][1] - r['pz']) < 0.5, f"the cistern's water knows the swimmer in it ({r['n']} rings, at {r['u'][:2]})")
            check(r['dry'] == 0, f"and none on the walkway once it drains ({r['dry']})")

        if 'gate' in ONLY:
            r = await ev(page, r"""(() => { const H = __hm, F = H.fn, out = [];
              for (const K of H.WAR.keeps) {
                const S = K.site, C = F.castleOf(S), G0 = C && C.gate; if (!G0) continue;
                const st = C.st || { wood: [0.42, 0.29, 0.18] }, timber = C.R ? C.R.style === 'timber' : false;
                const geo = H.look6.gateWreckGeo(S, st, G0.hw, G0.h, timber), pos = geo.attributes.position.array;
                const c = Math.cos(S.yaw), s = Math.sin(S.yaw), gz = S.gateLocal.z;
                let inPass = 0, n = 0;
                for (let i = 0; i < pos.length; i += 3) {
                  const dx = pos[i] - S.x, dz = pos[i + 2] - S.z, lx = dx * c - dz * s, lz = dx * s + dz * c, y = pos[i + 1] - S.y;
                  if (y < 0.45 || lz < gz - 3.2 || lz > gz + 1.0) continue; // (the litter on the threshold lies under 0.3 m)
                  n++;
                  if (Math.abs(lx) < G0.hw - 0.55) inPass++;
                }
                out.push({ keep: S.name, hw: +G0.hw.toFixed(2), n, inPass });
              }
              return out; })()""")
            print('  ', json.dumps(r), flush=True)
            bad = [o for o in r if o['inPass'] > 0]
            check(len(r) >= 6 and not bad, f"a broken gate's hanging leaf stands against the passage's side at every keep ({len(r)} keeps; in the passage: {bad})")

        if 'builders' in ONLY:
            r = await ev(page, r"""(() => { const H = __hm, F = H.fn, Rb = H.rubble, S = H.REALMS[0].town;
              const hs = S.houses.map((h) => h.rec).filter((h) => h && !h.keepHall && h.state === 'whole' && h.residents && h.residents.length >= 2);
              hs.sort((a, b) => Math.hypot(a.x - S.x, a.z - S.z) - Math.hypot(b.x - S.x, b.z - S.z));
              const out = [];
              for (const A of hs.slice(0, 3)) {
                H.war2.HCREW.off = true; H.batter.houseBreak(A, null); L6.sim(1.5); A.stT = 1e4; L6.sim(0.3);
                const id = A.residents[0], side = (id % 2) ? 1 : -1, spots = [];
                for (let k = 1; k <= 6; k++) { const p = Rb.houseScafWorkSpot(A, side, k); if (p) spots.push([+p.x.toFixed(2), +p.z.toFixed(2)]); }
                const distinct = new Set(spots.map((q) => q.join())).size;
                // two builders on the same side, at their stints: not one place
                const e1 = F.getEnt(A.residents[0]), e2 = F.getEnt(A.residents[1]);
                const p1 = e1 && Rb.houseScafWorkSpot(A, side, 3, e1), p1x = p1 && { ...p1 };
                if (e1 && p1) { e1.x = e1.prevX = p1.x; e1.z = e1.prevZ = p1.z; }
                const p2 = e2 && Rb.houseScafWorkSpot(A, side, 3, e2);
                const gap = p1x && p2 ? +Math.hypot(p1x.x - p2.x, p1x.z - p2.z).toFixed(2) : null;
                out.push({ num: A.num, round: !!A.round, n: Rb.look6SpotList(A, side).length, distinct, gap });
                H.fn.houseRestore && H.fn.houseRestore(A);
              }
              H.war2.HCREW.off = false;
              return out; })()""")
            print('  ', json.dumps(r), flush=True)
            for o in r:
                check(o['distinct'] >= min(4, o['n']), f"house {o['num']}{' (round)' if o['round'] else ''}: a builder's stints move along its side ({o['distinct']} places in six stints of {o['n']})")
                check(o['gap'] is None or o['gap'] >= 0.85, f"house {o['num']}: two builders at their stints are not given one place ({o['gap']} m apart)")

        if 'deep' in ONLY:
            await ev(page, VIEWS_JS.read_text() + '\n;0')
            r = await ev(page, "(() => { L6.calm(); __hm.deep.deepPacksFresh(); __hm.simulate(2); return LK.checkDeep(); })()")
            print('  ', json.dumps(r)[:1500], flush=True)
            for k, v in r['counts'].items():
                check(v == 0, f"deep: {k}: {v}" + (f"  e.g. {json.dumps(r['examples'].get(k, [])[:3])}" if v else ''))
            check(r['n'].get('bodies', 0) >= 12, f"the deep's dead looked at ({r['n']})")

        if 'ash' in ONLY:
            r = await ev(page, "(() => { const fs = __hm.look6.siegeFS(); return { ash: fs.includes('ashK'), noAshChar: fs.includes('m != 6 && m != 9') }; })()")
            check(r['ash'] and r['noAshChar'], f"the siege material: burnt timber's ash coat and ash not charred ({r})")

        errs = await ev(page, "__hm.errors.map(String).slice(0, 6)")
        check(not errs, f"no runtime errors ({errs})")
        print(f'took {time.time() - T0:.0f} s')
        print('FAILED: ' + '; '.join(FAILS) if FAILS else 'all look6 checks passed', flush=True)
        await b.close()

asyncio.run(main())
