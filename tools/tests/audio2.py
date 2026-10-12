"""audio2 (version 16): the March heard as it is seen.
Offline (an OfflineAudioContext, every sound through its own placed voice, seeded): every sound's level, length, no
clipping, no click (a peak far over its loudest 50 ms), none harsh (loud and all highs), what is left of it on a phone's
speaker (a 300 Hz high-pass, the phone's harmonics on); the distance law (2, 10, 40 m), the pan law (right, left, ahead),
a wall's muffle, the air's loops without a seam. In the world (a running AudioContext after a click): the listener at
the player's head facing the camera's way, placing and panning, a wall between (a house), the cap of voices (the
loudest kept), the places' air (a town by day and night, the woods, a keep's walls, rain drumming on a roof over you,
a lake's shore, the Barrow's echo), a battle heard from afar, which sounds each system asks for in a scripted scene
(masons, battered houses, fire crews, a burh's walk and gate burning, stormers on rubble, oars, fish, a band on the
march, a keep's alarm, a shot at you, a flare, a ward breaking, the town's voices), the settings (Volume, Effects,
Ambience: the menu rows, the buses, the save, old and junk saves), the cost of the sound in a battle, no errors.
usage: python3 tools/tests/audio2.py [nooffline] [noworld] [only=levels,laws,air,listen,cap,places,battle,systems,cues,settings,cost] [wav]"""
import json, asyncio, sys, time, base64, pathlib
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
from hmlib import setup, OUT
from playwright.async_api import async_playwright

ARGS = sys.argv[1:]
OFFLINE, WORLD, WAV = 'nooffline' not in ARGS, 'noworld' not in ARGS, 'wav' in ARGS
ONLY = next((a[5:].split(',') for a in ARGS if a.startswith('only=')), None)
want = lambda k: ONLY is None or k in ONLY
FAILS = []
T0 = time.time()
def check(cond, what):
    print(('  ok   ' if cond else '  FAIL ') + what, flush=True)
    if not cond: FAILS.append(what)
def log(*a): print(f'[{time.time() - T0:6.1f}s]', *a, flush=True)

# a helper in the page: quiet a place (no soldiers near), stop the commanders
HELP = """window.A2 = {
  hush(x, z, r) { const H = __hm, F = H.fn; for (const e of H.ENT.slice()) if (e.alive && (e.role === 'soldier' || e.role === 'mob' || e.role === 'warden') && Math.hypot(e.x - x, e.z - z) < r) F.removeEnt(e); },
  calm() { const H = __hm; H.WAR.commanders.forEach((c) => { c.nextThink = 1e9; c.nextSpawn = 1e9; }); for (const w of H.WAR.warbands) w.dead = true; },
  clear() { const W = __hm.dbg.WEATHER; W.mode = 'clear'; W.kind = 'clear'; W.overcast = W.fog = W.raining = W.storm = W.mist = 0; W.snowing = 0; },
  frames(n, dt = 0.25) { for (let i = 0; i < n; i++) { __hm.simulate(dt * 0.5); __hm.fn.updateAudio(dt); } return 0; },
  safe() { const P = __hm.GAME.player; if (P) { P.hp = P.maxHp = Math.max(P.maxHp, 1e6); } },
}; 0"""

async def main():
    async with async_playwright() as p:
        b, page, logs = await setup(p, w=640, h=360)
        ev = page.evaluate
        log('booted')
        await ev("window.requestAnimationFrame = () => 0; 0")
        await ev(HELP)

        # ---------------------------------------------------------------- offline
        if OFFLINE and want('levels'):
            names = await ev("__hm.snd.names().filter((n) => !n.includes(':'))")
            rows, worst_phone, bad = [], [], []
            for n in names:
                r = await ev(f"__hm.snd.render('{n}', {{ secs: 4, at: [0, 0, -2], seed: 11 }})")
                ph = await ev(f"__hm.snd.render('{n}', {{ secs: 4, at: [0, 0, -2], seed: 11, hp: 300, phone: true }})")
                crest = r['peakDb'] - r['loud50Db']
                loss = ph['loud50Db'] - r['loud50Db']
                rows.append((n, r['peakDb'], r['loud50Db'], r['len'], r['bright'], round(loss, 1), round(crest, 1)))
                if not (r['finite'] and r['clip'] == 0 and r['peakDb'] < -3 and r['len'] > 0.03 and r['len'] < 5 and r['loud50Db'] > -62): bad.append((n, 'level', r))
                if crest > 22: bad.append((n, 'click', round(crest, 1)))
                if r['loud50Db'] > -32 and r['bright'] > 1.2: bad.append((n, 'harsh', r['bright']))
                worst_phone.append((round(loss, 1), n))
            print('  sound        peak  loud50  len   bright  phone  crest')
            for x in rows: print(f'  {x[0]:<12} {x[1]:6} {x[2]:6} {x[3]:5}  {x[4]:6} {x[5]:6} {x[6]:6}')
            worst_phone.sort()
            check(not bad, f'every sound ({len(names)}) renders finite, unclipped (peak under -3 dBFS at Medium), 0.03 to 5 s, audible, with no click (peak within 22 dB of its loudest 50 ms) and none loud and harsh {bad[:6]}')
            check(worst_phone[0][0] > -9, f"on a phone's speaker (a 300 Hz high-pass, the phone's harmonics on) no sound loses more than 9 dB of its loudness (worst {worst_phone[:4]})")
        if OFFLINE and want('laws'):
            r2 = await ev("__hm.snd.render('hit', { secs: 1, at: [0, 0, -2], seed: 3 })")
            r10 = await ev("__hm.snd.render('hit', { secs: 1, at: [0, 0, -10], seed: 3 })")
            r40 = await ev("__hm.snd.render('hit', { secs: 1, at: [0, 0, -40], seed: 3 })")
            log('distance', [(x['mix'], x['loud50Db'], x['bright']) for x in (r2, r10, r40)])
            check(r2['loud50Db'] - r10['loud50Db'] > 6 and r10['loud50Db'] - r40['loud50Db'] > 6, f"the distance law: a blow at 2, 10 and 40 m: {r2['loud50Db']}, {r10['loud50Db']}, {r40['loud50Db']} dB")
            c2 = await ev("__hm.snd.render('chisel', { secs: 1, at: [0, 0, -5], seed: 3, max: 400 })")
            c150 = await ev("__hm.snd.render('chisel', { secs: 1, at: [0, 0, -150], seed: 3, max: 400 })")
            check(c150['mix']['fc'] < 6000 and c150['bright'] < c2['bright'] * 0.8, f"the air takes a far sound's highs: a chisel's tick at 150 m low-passed at {c150['mix']['fc']} Hz (brightness {c150['bright']} against {c2['bright']} at 5 m)")
            rr = await ev("__hm.snd.render('hit', { secs: 1, at: [8, 0, 0], seed: 3 })")
            rl = await ev("__hm.snd.render('hit', { secs: 1, at: [-8, 0, 0], seed: 3 })")
            rf = await ev("__hm.snd.render('hit', { secs: 1, at: [0, 0, -8], seed: 3 })")
            check(rr['rmsR'] - rr['rmsL'] > 6 and rl['rmsL'] - rl['rmsR'] > 6 and abs(rf['rmsL'] - rf['rmsR']) < 0.5, f"the pan law: a blow 8 m to the right {rr['rmsR'] - rr['rmsL']:.1f} dB louder on the right, to the left {rl['rmsL'] - rl['rmsR']:.1f} on the left, ahead even ({rf['rmsL'] - rf['rmsR']:.2f})")
            rb = await ev("__hm.snd.render('hit', { secs: 1, at: [0, 0, 8], seed: 3 })")
            check(rb['mix']['fc'] < rf['mix']['fc'] and rb['loud50Db'] < rf['loud50Db'], f"a sound behind you is a little duller and quieter ({rb['mix']['fc']} Hz against {rf['mix']['fc']} ahead)")
            ro = await ev("__hm.snd.render('hit', { secs: 1, at: [0, 0, -8], seed: 3, occ: 1 })")
            check(rf['loud50Db'] - ro['loud50Db'] > 8 and ro['bright'] < rf['bright'] * 0.5, f"a wall between: a blow at 8 m is {rf['loud50Db'] - ro['loud50Db']:.1f} dB quieter and dull (brightness {ro['bright']} against {rf['bright']})")
            lp = await ev("""(() => { const S = __hm.snd, out = {}; for (const n of ['crackle', 'roar', 'lap', 'roofrain', 'murmur', 'battle']) { const b = S.sndBuf(n), d = b.getChannelData(0); let s = 0, pk = 0; for (let i = 0; i < d.length; i++) { s += d[i] * d[i]; pk = Math.max(pk, Math.abs(d[i])); } const rms = Math.sqrt(s / d.length);
                let js = 0; for (let k = 1; k < 64; k++) js = Math.max(js, Math.abs(d[k] - d[k - 1])); const seam = Math.abs(d[0] - d[d.length - 1]);
                out[n] = { sec: +(d.length / b.sampleRate).toFixed(2), rms: +rms.toFixed(4), peak: +pk.toFixed(3), seam: +seam.toFixed(4), step: +js.toFixed(4) }; } return out; })()""")
            log('loops', lp)
            check(all(v['rms'] > 0.005 and v['peak'] < 1 and v['seam'] < max(0.05, v['rms'] * 3) for v in lp.values()), f"the air's loops are made, not clipped and loop without a seam {lp}")
            if WAV:
                for n in ['collapse', 'shout', 'warcry', 'bell', 'chisel', 'howl']:
                    r = await ev(f"(async () => {{ const r = await __hm.snd.render('{n}', {{ secs: 4, at: [3, 0, -6] }}); return r; }})()")

        if not WORLD:
            print('FAILED:' if FAILS else 'ALL PASSED', FAILS, f'({time.time() - T0:.0f}s)'); await b.close(); return

        # ---------------------------------------------------------------- the world
        await page.mouse.click(8, 8)
        await page.wait_for_timeout(1200)
        st = await ev("__hm.fn.AUDIO.ctx ? __hm.fn.AUDIO.ctx.state : 'none'")
        if st == 'suspended':
            await ev("__hm.fn.AUDIO.ctx.resume().then(() => 0)"); await page.wait_for_timeout(600)
        st = await ev("__hm.snd ? __hm.snd.state() : { ctx: __hm.fn.AUDIO.ctx.state, ready: true }")
        check(st['ctx'] == 'running' and st['ready'], f"a click starts the audio and the placed sounds ({st['ctx']}, ready {st['ready']})")
        await ev("""(() => { const H = __hm; H.fn.setQuality('low'); H.start({ realm: 0, cls: 'warrior', level: 20 }); H.setTod(0.3); H.fn.applyTimeOfDay(0.3); A2.clear(); A2.calm(); A2.safe(); H.UI.modal = null; H.CAM.mode = 'play'; for (let i = 0; i < 4; i++) H.frame(1 / 30); return 0; })()""")

        if want('listen'):
            r = await ev("""(() => { const H = __hm, S = H.snd, P = H.GAME.player; H.frame(1 / 30); const L = S.SND.L;
              const ahead = S.mix('hit', P.x + L.fx * 10, P.y + 1.5, P.z + L.fz * 10), right = S.mix('hit', P.x + L.rx * 10, P.y + 1.5, P.z + L.rz * 10), left = S.mix('hit', P.x - L.rx * 10, P.y + 1.5, P.z - L.rz * 10), far = S.mix('hit', P.x + L.fx * 45, P.y + 1.5, P.z + L.fz * 45);
              return { L: { x: L.x - P.x, y: L.y - P.y, z: L.z - P.z }, ahead, right, left, far }; })()""")
            log('listener', r)
            check(abs(r['L']['x']) < 0.01 and abs(r['L']['z']) < 0.01 and 1.2 < r['L']['y'] < 2, f"the ears are at the player's head while the play camera follows it ({r['L']})")
            check(r['right']['pan'] > 0.5 and r['left']['pan'] < -0.5 and abs(r['ahead']['pan']) < 0.05, f"a blow to the camera's right is heard on the right ({r['right']['pan']}), to its left on the left ({r['left']['pan']}), ahead in the middle ({r['ahead']['pan']})")
            check(r['far']['g'] < r['ahead']['g'] * 0.4, f"at 45 m a blow is far quieter than at 10 m ({r['far']['g']} against {r['ahead']['g']})")
            # a wall between: a town house between the ears and the sound
            r = await ev("""(() => { const H = __hm, F = H.fn, S = H.snd, P = H.GAME.player;
              const Hs = H.HOUSES.filter((q) => !q.keepHall && q.state === 'whole' && !q.round && q.realm === 0 && Math.hypot(q.x - P.x, q.z - P.z) < 120).sort((a, b) => Math.hypot(a.x - P.x, a.z - P.z) - Math.hypot(b.x - P.x, b.z - P.z));
              for (const Hh of Hs) {
                const r = Hh.foot + 4, dx = Math.cos(Hh.yaw), dz = -Math.sin(Hh.yaw);
                const ax = Hh.x + dx * r, az = Hh.z + dz * r, bx = Hh.x - dx * r, bz = Hh.z - dz * r;
                if (!F.isWalkable(ax, az) || F.houseAt(ax, az, 0.5)) continue;
                H.teleport(ax, az); H.frame(1 / 30);
                const through = S.mix('hit', bx, Hh.y + 1.5, bz);
                const ox = ax + dz * 2 * r, oz = az - dx * 2 * r, side = S.mix('hit', ox, F.heightAt(ox, oz) + 1.5, oz);
                return { house: Hh.style, through, side, d: +(2 * r).toFixed(1) };
              } return null; })()""")
            log('wall', r)
            check(r and r['through']['occ'] == 1 and r['side']['occ'] == 0, f"a house between the ears and a blow muffles it; one in the open at the same distance does not ({r})")
            # what is placed is played at its place's loudness: a crash at 10 m and at 150 m
            r = await ev("""(() => { const H = __hm, S = H.snd, P = H.GAME.player; S.resetCounts(); const L = S.SND.L;
              S.sfxAt('crash', P.x + L.fx * 10, P.y + 1, P.z + L.fz * 10); H.fn.updateAudio(1 / 30);
              S.sfxAt('crash', P.x + L.fx * 150, P.y + 1, P.z + L.fz * 150); H.fn.updateAudio(1 / 30);
              S.sfxAt('hit', P.x + L.fx * 400, P.y + 1, P.z + L.fz * 400); H.fn.updateAudio(1 / 30);
              return { log: S.SND.log.slice(-3), far: S.SND.stats.far }; })()""")
            log('placed', r)
            lg = r['log']
            check(len(lg) >= 2 and lg[-2][0] == 'crash' and lg[-1][0] == 'crash' and lg[-1][2] < lg[-2][2] * 0.25 and lg[-1][4] < lg[-2][4] and r['far'] >= 1, f"a crash at 150 m plays at {lg[-1][2] if lg else '?'} against {lg[-2][2] if lg else '?'} at 10 m, duller; a blow 400 m off is not played at all ({r['far']})")

        if want('cap'):
            await page.wait_for_timeout(2500)  # (the voices before have fallen silent)
            r = await ev("""(() => { const H = __hm, S = H.snd, P = H.GAME.player; S.resetCounts(); const names = ['hit', 'swing', 'thud', 'bow', 'zap', 'cast', 'blink', 'frost', 'holy', 'heal', 'clash', 'beat', 'shout', 'march', 'rubble', 'mallet', 'chisel', 'oar', 'plop', 'splash'];
              H.fn.updateAudio(1 / 30);
              const asked = [];
              for (const n of names) for (let k = 0; k < 3; k++) { const a = Math.random() * 6.28, d = 4 + Math.random() * 40; S.sfxAt(n, P.x + Math.cos(a) * d, P.y + 1, P.z + Math.sin(a) * d); asked.push(d); }
              H.fn.updateAudio(1 / 30);
              const st = S.state(); return { cap: st.cap, played: st.stats.played, capped: st.stats.capped, live: st.live, asked: asked.length, perName: st.stats.perName, quiet: st.stats.quiet }; })()""")
            log('cap', r)
            check(1 <= r['played'] <= min(r['cap'], 2) and r['capped'] > 0, f"60 sounds asked for in one frame: {r['played']} played (at most 2 new voices a frame, 1 at low and on a phone; {r['cap']} at once), {r['capped']} held back for louder ones")
            # the louder ones are those played: every voice played is louder than every one held back
            await page.wait_for_timeout(2500)  # (the voices before have fallen silent)
            r = await ev("""(() => { const H = __hm, S = H.snd, P = H.GAME.player; S.resetCounts(); H.fn.updateAudio(1 / 30); S.SND.log.length = 0;
              for (let k = 0; k < 40; k++) { const d = 3 + k * 2.5; S.sfxAt(k % 2 ? 'hit' : 'clash', P.x + d, P.y + 1, P.z + (k % 3) * 0.7, { per: 99 }); }
              S.SND_DEF.hit.per = 99; S.SND_DEF.clash.per = 99; H.fn.updateAudio(1 / 30); S.SND_DEF.hit.per = 2; S.SND_DEF.clash.per = 3;
              const ds = S.SND.log.map((x) => x[1]); return { n: ds.length, maxD: Math.max(...ds), cap: S.SND.cap }; })()""")
            check(1 <= r['n'] <= 2 and r['maxD'] < 3 + (r['n'] + 1) * 2.5, f"of 40 blows at 3 to 100 m the {r['n']} played are the nearest (the farthest played {r['maxD']} m)")

        if want('places'):
            async def place(js, sec=4.0):
                await ev(js)
                await ev(f"A2.frames({int(sec / 0.25)}); 0")
                return await ev("__hm.snd.state()")
            # a town by day, and at night
            s = await place("""(() => { const H = __hm, R = H.REALMS[0], T = R.town; H.teleport(T.x + 4, T.z + 4); H.setTod(0.3); H.fn.applyTimeOfDay(0.3); A2.clear(); return 0; })()""")
            day = s['air']['town']
            check(s['place']['town'] > 0.8 and day > 0.03, f"in Brackenford by day its people's voices ({s['place']['town']:.2f} town, murmur {day})")
            s = await place("(() => { __hm.setTod(2.1); __hm.fn.applyTimeOfDay(2.1); return 0; })()", 6)
            check(s['air']['town'] < day * 0.5, f"at night the town falls quiet (murmur {s['air']['town']} against {day} by day; crickets {s['air']['cr']})")
            await ev("(() => { __hm.setTod(0.3); __hm.fn.applyTimeOfDay(0.3); return 0; })()")
            # the woods: the densest stand near the Logres homeland
            s = await place("""(() => { const H = __hm, F = H.fn, T = F.W.trees; let best = null, bn = 0;
              for (let k = 0; k < 400; k++) { const t = T[Math.floor(Math.random() * T.length)]; if (!t || t.gone || F.zoneAt(t.x, t.z).realm !== 0) continue; let n = 0; for (const o of T) if (!o.gone && Math.abs(o.x - t.x) < 22 && Math.abs(o.z - t.z) < 22) n++; if (n > bn) { const x = t.x + 2, z = t.z + 2; if (F.isWalkable(x, z)) { bn = n; best = [x, z]; } } }
              H.teleport(best[0], best[1]); window.__a2wood = best; return bn; })()""")
            check(s['place']['forest'] > 0.5 and s['air']['leaves'] > 0.005 and s['air']['town'] < 0.01, f"in the woods the leaves rustle (forest {s['place']['forest']:.2f}, leaves {s['air']['leaves']})")
            # a keep's wall walk
            s = await place("""(() => { const H = __hm, F = H.fn, S = H.REALMS[0].keepSites[0];
              const g = H.ENT.find((e) => e.alive && e.faction === 0 && Math.hypot(e.x - S.x, e.z - S.z) < 25 && e.y > S.y + 4); A2.hush(S.x, S.z, 80);
              H.teleport(g.x + 0.6, g.z); const P = H.GAME.player; P.y = g.y; P.prevY = g.y; return [g.x, g.y, g.z]; })()""")
            check(s['place']['keep'] == 1 and s['place']['walls'] > 0.5 and s['air']['flap'] > 0.001 and s['air']['wind'] > 0.05, f"up on a keep's walls: the wind and its banners (walls {s['place']['walls']:.2f}, wind {s['air']['wind']}, flags {s['air']['flap']})")
            # rain: on the ground out of doors, drumming on a roof over you
            s = await place("""(() => { const H = __hm, F = H.fn, P = H.GAME.player, W = H.dbg.WEATHER; const T = H.REALMS[0].town; H.teleport(T.x + 4, T.z + 4); W.mode = 'auto'; W.kind = 'rain'; W.next = 999; W.raining = 1; W.overcast = 0.8; return 0; })()""")
            out_rain, out_roof = s['air']['rain'], s['air']['roofrain']
            s = await place("""(() => { const H = __hm, F = H.fn, P = H.GAME.player, W = H.dbg.WEATHER; W.raining = 1;
              const Hh = H.HOUSES.filter((q) => !q.keepHall && q.state === 'whole' && q.realm === 0 && F.houseInside(q.x, q.z)).sort((a, b) => Math.hypot(a.x - P.x, a.z - P.z) - Math.hypot(b.x - P.x, b.z - P.z))[0];
              H.teleport(Hh.x, Hh.z); P.y = F.floorAt(Hh.x, Hh.z, Hh.y + 0.5); return [Hh.style]; })()""")
            check(s['place']['roof'] == 1 and s['air']['roofrain'] > 0.1 and s['air']['rain'] < out_rain * 0.5 and out_roof < 0.01, f"in the rain: its hiss on the ground out of doors ({out_rain}), under a house's roof the rain drums on it ({s['air']['roofrain']}) and the hiss falls ({s['air']['rain']}); the room's echo {s['wet']}")
            await ev("A2.clear(); 0")
            # a lake's shore by a jetty
            s = await place("""(() => { const H = __hm, F = H.fn, J = H.water.boats.jetties()[0]; H.teleport(J.x0, J.z0); return [J.x0, J.z0]; })()""")
            check(s['place']['shore'] > 0.2 and s['air']['lap'] > 0.002, f"by a lake its water laps at the shore (shore {s['place']['shore']:.2f}, lap {s['air']['lap']})")
            # the Barrow's echo
            await ev("(() => { __hm.fn.enterBarrow(); return 0; })()")
            for _ in range(20):
                if await ev("__hm.INDOOR.on && __hm.GAME.player.x > 1000"): break
                await page.wait_for_timeout(500)
            s = await place("0", 3)
            check(s['place']['barrow'] == 1 and s['wet'] > 0.3, f"in the Barrow every sound echoes in its halls (the echo's send {s['wet']})")
            await ev("(() => { __hm.fn.leaveBarrow(); return 0; })()")
            for _ in range(20):
                if await ev("!__hm.INDOOR.on && __hm.GAME.player.x < 1000"): break
                await page.wait_for_timeout(500)

        if want('battle'):
            r = await ev("""(() => { const H = __hm, F = H.fn, P = H.GAME.player, T = H.REALMS[0].town; H.teleport(T.x, T.z); A2.calm();
              const a = Math.random() * 6.28, cx = P.x + Math.cos(a) * 160, cz = P.z + Math.sin(a) * 160, ids = [];
              for (let i = 0; i < 9; i++) { const e1 = F.spawnRealmUnit(1, 'warrior', 20, 'soldier', cx + i, cz); const e2 = F.spawnRealmUnit(2, 'warrior', 20, 'soldier', cx + i, cz + 2); e1.combatUntil = e2.combatUntil = H.GAME.t + 30; ids.push(e1.id, e2.id); }
              H.snd.sndListener(); H.snd.sndBattleStep(__hm.fn.AUDIO.ctx.currentTime); const b = H.snd.SND.battle.slice(); const g = H.snd.SND.air.battle[0].on;
              for (const id of ids) { const e = F.getEnt(id); if (e) F.removeEnt(e); } return { b, g, a }; })()""")
            log('battle', r)
            check(r['b'] and r['b'][0]['n'] >= 16 and 120 < r['b'][0]['d'] < 200 and r['g'] > 0.01, f"a fight 160 m off, out of sight, is heard as a din toward it ({r['b']}, its voice at {r['g']})")

        if want('systems'):
            r = await ev("""(() => { const H = __hm, F = H.fn, S = H.snd, P = H.GAME.player; S.resetCounts(); const out = {};
              // a house battered by stones: its wall cracks, its roof's covering clatters down, it falls
              const T = H.REALMS[0].town; H.teleport(T.x, T.z);
              const Hh = H.HOUSES.filter((q) => !q.keepHall && q.state === 'whole' && q.realm === 0).sort((a, b) => Math.hypot(a.x - P.x, a.z - P.z) - Math.hypot(b.x - P.x, b.z - P.z))[0];
              const B = H.batter; B.houseStoneHit(Hh, Hh.x + Hh.foot * 0.6, Hh.y + 1.2, Hh.z, 1, null, false); B.houseStoneHit(Hh, Hh.x, Hh.y + Hh.top, Hh.z, 1, null, true); B.houseBreak(Hh);
              // a storming band's feet on a fallen tower's rubble (the life step's look at bodies storming)
              const st = F.spawnRealmUnit(1, 'warrior', 20, 'soldier', P.x + 6, P.z); st.ai.storm = { i: 2, done: false }; st.anim.amt = 1; (S.sndListener(), S.sndLifeStep(F.AUDIO.ctx.currentTime)); F.removeEnt(st);
              // the beater's two blows; the ward breaking; a priest's flare
              S.sndBeat(P);
              return S.SND.count; })()""")
            log('systems a', r)
            for n in ['crack', 'tiles', 'collapse', 'house:collapse', 'rubble', 'beat']:
                check(r.get(n, 0) >= 1, f'{n}: asked for by its system ({r.get(n, 0)})')
            # fire: a burning house in town: its people run to it calling out and beat it
            r = await ev("""(() => { const H = __hm, F = H.fn, S = H.snd, P = H.GAME.player; S.resetCounts(); H.setTod(0.4); F.applyTimeOfDay(0.4);
              const T = H.REALMS[0].town; const Hh = H.HOUSES.filter((q) => !q.keepHall && q.state === 'whole' && q.realm === 0).sort((a, b) => Math.hypot(a.x - T.x, a.z - T.z) - Math.hypot(b.x - T.x, b.z - T.z))[2];
              H.teleport(Hh.x + Hh.foot + 6, Hh.z); F.igniteHouse(Hh); let t = 0; while (t < 40 && !(S.SND.count.beat > 0)) { H.simulate(1); t++; }
              return { t, count: S.SND.count, state: Hh.state }; })()""")
            log('systems house fire', r)
            check(r['count'].get('shout', 0) >= 1 and r['count'].get('beat', 0) >= 1, f"a house afire: its people call out as they run ({r['count'].get('shout', 0)}) and their beaters are heard ({r['count'].get('beat', 0)}) after {r['t']} s")
            # a burh's walk alight: the garrison sent calls out and beats it; burnt through it falls; its gate burns and falls
            r = await ev("""(() => { const H = __hm, F = H.fn, S = H.snd, Z = H.blaze; S.resetCounts(); const P = H.GAME.player;
              const Bk = Z.BLAZE.list.find((q) => !q.ring && q.cells && q.cells.length); const c = Bk.cells[Math.floor(Bk.cells.length / 2)];
              H.teleport(c.x + 10, c.z); A2.hush(c.x, c.z, 60); Z.deckIgnite(c, 0.4); let t = 0; while (t < 30 && !(S.SND.count.beat > 0)) { H.simulate(1); t++; }
              Z.deckThrough(c); const G0 = Z.BLAZE.gates && Z.BLAZE.gates[0]; let gate = null;
              if (G0) { try { Z.gateIgnite(G0); const D = G0.door; if (D && D.alive) { Z.gateFalls(G0, D); gate = 'fell'; } else gate = 'no door'; } catch (e) { gate = String(e).slice(0, 80); } }
              return { t, count: S.SND.count, gate }; })()""")
            log('systems walk', r)
            check(r['count'].get('shout', 0) >= 1 and r['count'].get('beat', 0) >= 1 and r['count'].get('timberfall', 0) >= 1 and r['count'].get('ignite', 0) >= 1, f"a burh's walk alight: it catches ({r['count'].get('ignite', 0)}), the crew sent calls out ({r['count'].get('shout', 0)}) and beats ({r['count'].get('beat', 0)}), burnt through it falls ({r['count'].get('timberfall', 0)}; the gate: {r['gate']})")
            # masons at a breached tower's scaffold: one dresses the stone, one sets it, the boards creak
            r = await ev("""(() => { const H = __hm, F = H.fn, L3 = H.look3, S = H.REALMS[0].keepSites[0], C = F.castles().find((q) => q.S === S), K = S.keepRef; H.snd.resetCounts();
              const W = C.sections.find((q) => q.kind === 'tower' && q.T.role === 'corner' && q.T.sx === -1 && q.T.sz === -1), T = W.T;
              A2.hush(S.x, S.z, 70); for (const e of H.ENT.slice()) if (e.alive && e.role === 'soldier') F.removeEnt(e); A2.calm();
              if (W.state === 'whole') { const src = F.spawnRealmUnit(2, 'warrior', 30, 'guard', S.x + W.ox * 70, S.z + W.oz * 70, {}); src.hp = src.maxHp = 1e9; for (let n = 0; W.state === 'whole' && n < 80; n++) F.castleSiegeHit(src, T.wx + W.ox * (T.RO + 0.2), T.wz + W.oz * (T.RO + 0.2), 2.0, 4.4); F.removeEnt(src); }
              H.teleport(T.wx + W.ox * 14, T.wz + W.oz * 14); K.lastEnemyNear = -1e9;
              let t = 0; while (t < 120 && !(H.snd.SND.count.chisel > 0 && H.snd.SND.count.mallet > 0)) { H.simulate(1); K.lastEnemyNear = -1e9; if (W.t > 0.6) W.t = 0.3; t++; }
              return { t, count: H.snd.SND.count, masons: L3.MASON.stats }; })()""")
            log('systems masons', r)
            check(r['count'].get('chisel', 0) >= 1 and r['count'].get('mallet', 0) >= 1 and r['count'].get('creak', 0) >= 1, f"masons at a breached tower: the one at the foot dresses stone ({r['count'].get('chisel', 0)}), the one above sets it ({r['count'].get('mallet', 0)}) on creaking boards ({r['count'].get('creak', 0)}) ({r['t']} s)")
            # a band on the march near you tramps along
            r = await ev("""(() => { const H = __hm, F = H.fn, S = H.snd, P = H.GAME.player; S.resetCounts(); for (const c of H.WAR.commanders) { c.nextThink = 0; c.nextSpawn = 0; }
              let t = 0, n = 0; while (t < 200 && !(S.SND.count.march > 0)) { H.simulate(1); t++; const wb = H.WAR.warbands.find((w) => !w.dead && F.wbLeader(w) && F.wbLeader(w).anim.amt > 0.3);
                if (wb) { const ld = F.wbLeader(wb); H.teleport(ld.x + 25, ld.z); A2.safe(); (S.sndListener(), S.sndLifeStep(F.AUDIO.ctx.currentTime)); n++; } }
              return { t, n, count: S.SND.count.march || 0 }; })()""")
            log('systems march', r)
            check(r['count'] >= 1, f"a band on the march near you is heard tramping ({r['count']} after {r['t']} s)")
            # oars: the player rows a boat; a fish breaks the water
            r = await ev("""(() => { const H = __hm, F = H.fn, S = H.snd, Bt = H.water.boats; S.resetCounts(); A2.calm();
              const i = Bt.list().findIndex((b) => b.st === 'moored'); const B0 = Bt.list()[i]; H.teleport(B0.x + 1.5, B0.z); const ok = Bt.board(i); const P = H.GAME.player;
              for (let k = 0; k < 120; k++) Bt.phys(i, 0.05, 1, 0);
              return { ok: !!ok, count: S.SND.count.oar || 0, boat: P.boat ? 1 : 0 }; })()""")
            log('systems oar', r)
            check(r['count'] >= 1, f"rowing: each stroke's oar is heard ({r['count']})")
            r = await ev("""(() => { const H = __hm, S = H.snd; S.resetCounts(); let k = 0; while (k < 400 && !(S.SND.count.plop > 0)) { S.fish(0.1); k++; } return { k, count: S.SND.count.plop || 0 }; })()""")
            log('systems fish', r)
            check(r['count'] >= 1, f"a fish breaks the water near you ({r['count']} after {r['k']} frames)")
            await ev("(() => { const H = __hm, P = H.GAME.player; if (P.boat) H.water.boats.leave(); return 0; })()")
            # the town's own voices by day
            r = await ev("""(() => { const H = __hm, F = H.fn, S = H.snd, T = H.REALMS[0].town; S.resetCounts(); H.teleport(T.x + 3, T.z + 3); H.setTod(0.3); F.applyTimeOfDay(0.3); A2.clear();
              for (let k = 0; k < 60; k++) { H.simulate(0.5); (S.sndListener(), S.sndLifeStep(F.AUDIO.ctx.currentTime)); (S.sndListener(), S.sndAirStep(F.AUDIO.ctx.currentTime, 0.5)); } return S.SND.count; })()""")
            log('systems town', r)
            voices = sum(r.get(n, 0) for n in ['chatter', 'cluck', 'bleat', 'moo', 'bark', 'anvil'])
            check(voices >= 2 and r.get('chirp', 0) >= 1, f"a town by day: its people talk, its beasts and its forge are heard, birds in the trees ({ {n: r.get(n, 0) for n in ['chatter', 'cluck', 'bleat', 'moo', 'bark', 'anvil', 'chirp']} })")

        if want('cues'):
            r = await ev("""(() => { const H = __hm, F = H.fn, S = H.snd, P = H.GAME.player; S.resetCounts(); A2.calm(); A2.safe(); const T = H.REALMS[0].town; H.teleport(T.x, T.z);
              // a foe's archer looses at you: its bow where it stands, the shaft's whistle coming
              const e = F.spawnRealmUnit(1, 'archer', 20, 'soldier', P.x + 22, P.z + 4); e.target = P.id; F.spawnProjectile(e, P, 'arrow', { mult: 0.01, auto: true });
              // a priest's holy fire flares a casting foe's spell
              const pr = F.spawnRealmUnit(0, 'priest', 30, 'soldier', P.x + 3, P.z); const mg = F.spawnRealmUnit(1, 'mage', 30, 'soldier', P.x + 6, P.z); mg.casting = { id: 'firebolt', t: 0, total: 2, targetId: pr.id }; const fl = H.bal5.holyFlare(pr, mg);
              // a mage's ward worn through
              const m2 = F.spawnRealmUnit(0, 'mage', 30, 'soldier', P.x - 4, P.z); F.addBuff(m2, 'eward', 1, 10, 'eward'); F.addBuff(m2, 'shield', 50, 10, m2.id); F.dealDamage(e, m2, 200, {});
              // one of your keeps attacked: its bell, the news' call
              const K = H.WAR.keeps.find((k) => k.realm === P.faction); K.underSiegeUntil = -1; for (let i = 0; i < 3; i++) F.spawnRealmUnit(2, 'warrior', 20, 'soldier', K.site.x + 4 + i, K.site.z + 4);
              H.simulate(1.5);
              for (const id of [e.id, pr.id, mg.id, m2.id]) { const q = F.getEnt(id); if (q) F.removeEnt(q); }
              return { count: S.SND.count, fl, cues: S.SND.stats.cues }; })()""")
            log('cues', r)
            c = r['count']
            check(c.get('loose', 0) >= 1 and c.get('incoming', 0) >= 1, f"a foe's shot at you: the bow where it was loosed ({c.get('loose', 0)}) and the shaft's whistle coming ({c.get('incoming', 0)})")
            check(r['fl'] and c.get('flare', 0) >= 1, f"a priest's flare is heard over the fight ({c.get('flare', 0)})")
            check(c.get('wardbreak', 0) >= 1, f"a mage's ward breaking is heard ({c.get('wardbreak', 0)})")
            check(c.get('alarmBell', 0) >= 1 and c.get('alarmCue', 0) >= 1, f"one of your keeps attacked: its bell rings ({c.get('alarmBell', 0)}) and the news calls ({c.get('alarmCue', 0)})")
            # a cue is played over the cap, and the rest dips under it
            r = await ev("""(() => { const H = __hm, S = H.snd, P = H.GAME.player; S.resetCounts(); H.fn.updateAudio(2);
              for (let k = 0; k < 40; k++) S.sfxAt(k % 2 ? 'hit' : 'swing', P.x + 2 + k * 0.3, P.y + 1, P.z);
              S.sfxAt('flare', P.x + 30, P.y + 1, P.z); H.fn.updateAudio(1 / 30);
              const g = S.SND.fxIn.gain.value; return { played: S.SND.played, cues: S.SND.stats.cues, dipTo: S.SND.duckUntil > H.fn.AUDIO.ctx.currentTime }; })()""")
            check(r['played'].get('flare', 0) == 1 and r['dipTo'], f"a cue is played over a full cap and the rest dips under it ({r})")

        if want('settings'):
            await ev("""(() => { const H = __hm; H.UI.modal = 'menu'; H.fn.openMenu('settings'); return 0; })()""")
            await page.wait_for_timeout(300)
            rows = await ev("""['set-s', 'set-fx', 'set-amb', 'set-m'].map((id) => { const el = document.getElementById(id); return el ? id + ':' + [...el.querySelectorAll('button')].map((b) => b.dataset.v + (b.getAttribute('aria-checked') === 'true' ? '*' : '')).join(',') : id + ':none'; })""")
            log('rows', rows)
            check(all(':none' not in x for x in rows) and 'medium*' in rows[1] and 'medium*' in rows[2] and 'medium*' in rows[0], f"the settings have Volume, Effects, Ambience and Music rows, Medium by default {rows}")
            await ev("document.querySelector('#set-fx button[data-v=\"low\"]').click(); 0")
            await page.wait_for_timeout(500)
            await ev("document.querySelector('#set-amb button[data-v=\"high\"]').click(); 0")
            await page.wait_for_timeout(500)
            r = await ev("""(() => { const H = __hm, A = H.fn.AUDIO, s = H.fn.buildSave(); return { sfx: A.lvl.sfx, amb: A.lvl.amb, fx: +A.fx.gain.value.toFixed(3), ambBus: +A.amb.bus.gain.value.toFixed(3), saved: [s.settings.master, s.settings.effects, s.settings.ambience],
              checked: ['set-fx', 'set-amb'].map((id) => [...document.querySelectorAll('#' + id + ' button')].filter((b) => b.getAttribute('aria-checked') === 'true').map((b) => b.dataset.v)[0]) }; })()""")
            log('settings', r)
            check(r['sfx'] == 0.5 and r['amb'] == 1.4 and abs(r['fx'] - 0.45) < 0.02 and abs(r['ambBus'] - 0.77) < 0.03 and r['saved'] == [1, 0.5, 1.4] and r['checked'] == ['low', 'high'], f"Effects Low and Ambience High set their buses and go into the save {r}")
            await ev("document.querySelector('#set-s button[data-v=\"off\"]').click(); 0")
            await page.wait_for_timeout(500)
            r = await ev("""(() => { const H = __hm, A = H.fn.AUDIO; const a = { on: A.on, master: +A.master.gain.value.toFixed(3), sound: H.fn.buildSave().settings.sound }; document.querySelector('#set-s button[data-v="high"]').click(); return a; })()""")
            await page.wait_for_timeout(500)
            r2 = await ev("(() => { const A = __hm.fn.AUDIO; return { on: A.on, lvl: A.lvl.master, master: +A.master.gain.value.toFixed(3) }; })()")
            check(not r['on'] and r['master'] < 0.01 and r['sound'] is False and r2['on'] and r2['lvl'] == 1.4 and abs(r2['master'] - 0.7) < 0.02, f"Volume Off silences everything and is saved as the old Sound Off; High turns it up {r} {r2}")
            r = await ev("""(() => { const S = __hm.snd, A = __hm.fn.AUDIO, ap = __hm.music.applySettings; const out = [];
              ap({ master: 0.5, effects: 1, ambience: 0.5, sound: true }); out.push([A.lvl.master, A.lvl.sfx, A.lvl.amb, A.on]);
              ap({ sound: true, quality: 'low' }); out.push([A.lvl.master, A.lvl.sfx, A.lvl.amb, A.on]);
              ap({ master: 'loud', effects: -1, ambience: 9 }); out.push([A.lvl.master, A.lvl.sfx, A.lvl.amb, A.on]);
              ap({ master: 1, effects: 1, ambience: 1, sound: true }); return out; })()""")
            check(r[0] == [0.5, 1, 0.5, True] and r[1] == [0.5, 1, 0.5, True] and r[2] == [0.5, 1, 0.5, True], f"a saved Volume, Effects and Ambience are restored, an old save without them keeps them, junk is left alone {r}")
            await ev("(() => { __hm.fn.closeMenu ? __hm.fn.closeMenu() : 0; __hm.UI.modal = null; return 0; })()")

        if want('cost'):
            # the sound's cost: updateAudio each frame (the score, the placed sounds, the air) and the simulation's steps (where
            # sounds are asked for), in a town by day and beside a fight of 32; works on an older build too (HM_HTML) for a before
            async def cost(where):
                return await ev("""(() => { const H = __hm, F = H.fn, P = H.GAME.player; A2.safe(); A2.calm(); const T = H.REALMS[0].town; H.teleport(T.x + 3, T.z + 3); H.setTod(0.3); F.applyTimeOfDay(0.3); A2.clear(); const ids = [];
                  if ('%s' === 'battle') for (let i = 0; i < 16; i++) { const e1 = F.spawnRealmUnit(1, 'warrior', 20, 'soldier', P.x + 8 + (i %% 4) * 2, P.z + Math.floor(i / 4) * 2); const e2 = F.spawnRealmUnit(2, i %% 3 ? 'warrior' : 'archer', 20, 'soldier', P.x + 12 + (i %% 4) * 2, P.z + Math.floor(i / 4) * 2); ids.push(e1.id, e2.id); }
                  H.simulate(2); for (let k = 0; k < 8; k++) F.updateAudio(1 / 30);
                  let au = 0, st = 0, worst = 0; const n = 120; const S = H.snd; if (S) S.resetCounts();
                  for (let k = 0; k < n; k++) { const t0 = performance.now(); H.simulate(1 / 30); const t1 = performance.now(); F.updateAudio(1 / 30); const t2 = performance.now(); st += t1 - t0; au += t2 - t1; worst = Math.max(worst, t2 - t1); }
                  const out = { audio: +(au / n).toFixed(3), worst: +worst.toFixed(2), step: +(st / n).toFixed(2) };
                  if (S) { const q = S.state(); out.asked = q.stats.asked; out.played = q.stats.played; out.occTests = q.stats.occTests; out.live = q.live; }
                  for (const id of ids) { const e = F.getEnt(id); if (e) F.removeEnt(e); } return out; })()""" % where)
            town = await cost('town')
            battle = await cost('battle')
            log('cost town', town, 'battle', battle)
            check(battle['audio'] < 2.5 and town['audio'] < 2.5, f"the sound's cost a frame (updateAudio: the score, the placed sounds, the air): {town['audio']} ms in a town by day, {battle['audio']} ms beside a fight of 32 ({battle.get('asked')} sounds asked and {battle.get('played')} played in 120 frames, {battle.get('occTests')} wall tests; the step {town['step']} and {battle['step']} ms)")

        errs = await ev("__hm.errors")
        check(not errs, f'no runtime errors {errs[:3]}')
        print('logs', [l for l in logs if 'error' in l.lower()][:4])
        print('FAILED:' if FAILS else 'ALL PASSED', FAILS, f'({time.time() - T0:.0f}s)')
        await b.close()
asyncio.run(main())
