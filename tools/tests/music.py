"""Music and the night sky: the score starts with the first gesture, moods follow the zone, night, combat and the
Barrow with crossfades that complete, stingers fire on their real events, the music volume works and is saved,
the tab pausing suspends it, audio voices do not leak (a real-time run, then an offline soak with many mood
changes and stingers), and each mood renders offline to tools/out/music_<mood>.wav with sane levels.
Then screenshots: the aurora over Thule at night (high and medium), a cloudy night with it hidden, the faint
northern lights from Logres, and a shooting star.
usage: python3 tools/tests/music.py [noshots] [noaudio] [nooffline]"""
import json, asyncio, sys, time, base64, pathlib
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
from hmlib import setup, OUT
from playwright.async_api import async_playwright

ARGS = sys.argv[1:]
SHOTS, AUDIO_T, OFFLINE = 'noshots' not in ARGS, 'noaudio' not in ARGS, 'nooffline' not in ARGS
FAILS = []
T0 = time.time()
def check(cond, what):
    print(('  ok   ' if cond else '  FAIL ') + what, flush=True)
    if not cond: FAILS.append(what)
def log(*a): print(f'[{time.time() - T0:6.1f}s]', *a, flush=True)

async def main():
    async with async_playwright() as p:
        b, page, logs = await setup(p, w=640, h=360)
        ev = page.evaluate
        st = lambda: ev("__hm.music.state()")
        log('booted')
        # under SwiftShader a frame can take a minute, so the frame loop is stopped and the test drives the score
        # itself: updateMusic every quarter second (what tick does each frame), and frames only for screenshots
        await ev("window.requestAnimationFrame = () => 0; 0")
        tick_hook = await ev("String(__hm.fn.updateAudio).includes('updateMusic(dt)')")
        check(tick_hook, 'updateAudio (called by tick every frame) drives the score')

        # -------- before any gesture there is no score --------
        s = await st()
        check(s['ctx'] == 'none' and not s['pieces'], f"silent until the first gesture (ctx {s['ctx']})")

        if AUDIO_T:
            # a real click (a trusted gesture) unlocks the audio, like the existing effects
            await page.mouse.click(8, 8)  # a corner of the title screen, away from its buttons
            await page.wait_for_timeout(1500)
            s = await st()
            if s['ctx'] == 'suspended':
                log('context suspended after the click: resuming through the page')
                await ev("__hm.fn.AUDIO.ctx.resume().then(() => 0)")
                await page.wait_for_timeout(800)
            s = await st()
            check(s['ctx'] == 'running', f"the click started the audio context ({s['ctx']})")
            await ev("window.__mt = setInterval(() => { try { __hm.music.updateMusic(0.25); } catch (e) { __hm.errors.push(String(e.stack || e)); } }, 250); 0")
            t_audio = await ev("__hm.fn.AUDIO.ctx.currentTime")
            await page.wait_for_timeout(1000)
            t_audio2 = await ev("__hm.fn.AUDIO.ctx.currentTime")
            check(t_audio2 > t_audio + 0.3, f'audio clock runs ({t_audio:.2f} -> {t_audio2:.2f})')

            async def settle(mood, limit=25, flavour=None):
                """waits until the mood is playing alone at full gain, the crossfade finished; returns seconds"""
                t = time.time()
                last = None
                while time.time() - t < limit:
                    s = await st()
                    last = s
                    cur = [x for x in s['pieces'] if x['name'] == mood and x['target'] == 1 and (flavour is None or x['flavour'] == flavour)]
                    if s['mood'] == mood and cur and cur[0]['gain'] > 0.97 and not cur[0]['fading'] and len(s['pieces']) == 1 and (flavour is None or s['flavour'] == flavour):
                        return time.time() - t, s
                    await page.wait_for_timeout(700)
                return None, last

            dt, s = await settle('title', 15)
            check(dt is not None, f"title theme plays after the gesture (state {json.dumps(s)[:300] if dt is None else 'ok'})")

            # -------- into the game: the homeland of Logres by day --------
            r = await ev("""(() => { const H = __hm; H.fn.setQuality('low'); H.start({ realm: 0, cls: 'warrior', level: 20 }); H.setTod(0.3); H.fn.applyTimeOfDay(0.3);
              const W = H.dbg.WEATHER; W.mode = 'clear'; W.kind = 'clear'; W.overcast = W.fog = W.raining = W.storm = W.mist = 0;
              H.UI.modal = 'menu'; const P = H.GAME.player; return H.fn.zoneAt(P.x, P.z); })()""")
            log('start zone', r)
            dt, s = await settle('logres', 25)
            check(dt is not None, f"Logres homeland theme after the title, crossfade complete ({'%.1fs' % dt if dt else json.dumps(s)[:300]})")
            peak_live = s['live'] if s else 0

            async def go(realm, along, lat):
                return await ev(f"""(() => {{ const H = __hm, R = H.REALMS[{realm}]; const x = R.dx * {along} + R.px * {lat}, z = R.dz * {along} + R.pz * {lat};
                  H.teleport(x, z); const P = H.GAME.player; return H.fn.zoneAt(P.x, P.z); }})()""")
            for realm, along, lat, mood in [(0, 150, 30, 'frontier'), (1, 330, 40, 'eriu'), (2, 330, 40, 'thule')]:
                z = await go(realm, along, lat)
                dt, s = await settle(mood, 30)
                check(dt is not None, f"{mood} in {z['name']} (crossfade {'%.1fs' % dt if dt else 'never finished: ' + json.dumps(s)[:240]})")
                if s: peak_live = max(peak_live, s['live'])

            # -------- night in Thule: sparse, the drone of the north --------
            await ev("__hm.setTod(2.1); __hm.fn.applyTimeOfDay(2.1); 0")
            dt, s = await settle('night', 30, flavour=2)
            check(dt is not None, f"night falls: the night mood with Thule's voice ({'%.1fs' % dt if dt else json.dumps(s)[:240]})")
            # walking into Ériu at night changes the night's voice
            await go(1, 330, 40)
            dt, s = await settle('night', 30, flavour=1)
            check(dt is not None, f"night in Ériu takes Ériu's voice ({'%.1fs' % dt if dt else json.dumps(s)[:240]})")
            await ev("__hm.setTod(0.3); __hm.fn.applyTimeOfDay(0.3); 0")
            await go(0, 150, 30)
            dt, s = await settle('frontier', 30)
            check(dt is not None, 'day again on the frontier')

            # -------- a fight: real blows between the player and enemy soldiers nearby --------
            r = await ev("""(() => { const H = __hm, F = H.fn, P = H.GAME.player; H.UI.modal = null; const ids = [];
              for (let i = 0; i < 6; i++) { const a = i * 1.05; const e = F.spawnRealmUnit(1, 'warrior', 20, 'soldier', P.x + Math.cos(a) * 6, P.z + Math.sin(a) * 6); ids.push(e.id); }
              for (const id of ids) { const e = F.getEnt(id); F.dealDamage(e, P, 1); F.dealDamage(P, e, 1); }
              P.hp = P.maxHp = 1e6; H.simulate(0.5); return ids.length; })()""")
            log('spawned foes', r)
            t = time.time()
            got = None
            while time.time() - t < 25:
                await ev("""(() => { const H = __hm, F = H.fn, P = H.GAME.player; P.hp = P.maxHp; H.simulate(0.25); for (const e of H.ENT) if (e.alive && e.faction === 1 && Math.hypot(e.x - P.x, e.z - P.z) < 30) { F.dealDamage(e, P, 1); F.dealDamage(P, e, 1); e.hp = e.maxHp; } return 0; })()""")
                s = await st()
                bt = [x for x in s['pieces'] if x['name'] == 'battle']
                if s['mood'] == 'battle' and bt and bt[0]['gain'] > 0.9:
                    got = s
                    if bt[0]['layers'].get('drums', 0) > 0.5: break
                await page.wait_for_timeout(800)
            check(got is not None, f"battle music when the fighting starts (heat {s['heat']}, mood {s['mood']})")
            if got:
                L = [x for x in got['pieces'] if x['name'] == 'battle'][0]['layers']
                check(L.get('base', 0) > 0.7 and L.get('drums', 0) > 0.3, f'battle layers follow the heat {L} (heat {got["heat"]})')
                peak_live = max(peak_live, got['live'])
            # the fight ends: the foes go, the heat cools, the music leaves the battle
            await ev("""(() => { const H = __hm, F = H.fn, P = H.GAME.player; for (const e of H.ENT.slice()) if (e.faction === 1 && Math.hypot(e.x - P.x, e.z - P.z) < 40 && e.role === 'soldier') F.removeEnt(e); P.combatUntil = -99; H.UI.modal = 'menu'; return 0; })()""")
            await ev("__hm.simulate(8); 0")
            dt, s = await settle('frontier', 40)
            check(dt is not None, f"after the fight the frontier theme returns ({'%.1fs' % dt if dt else json.dumps(s)[:240]})")

            # -------- the Barrow --------
            await ev("__hm.UI.modal = null; __hm.fn.enterBarrow(); 0")
            await page.wait_for_timeout(2500)
            ind = await ev("__hm.INDOOR.on")
            dt, s = await settle('barrow', 25)
            check(ind and dt is not None, f"the Barrow's drones and bells below ground ({'%.1fs' % dt if dt else json.dumps(s)[:240]})")
            await ev("__hm.fn.leaveBarrow(); 0")
            await page.wait_for_timeout(2500)
            await ev("__hm.UI.modal = 'menu'; 0")
            s = await st()
            log('after leaving the barrow', s['mood'], s['want'])

            # -------- stingers on their real events --------
            r = await ev("""(() => { const H = __hm, F = H.fn, P = H.GAME.player, W = H.WAR, CW = H.CW;
              F.addXP(200000);
              return { level: H.GAME.prog.level }; })()""")
            await page.wait_for_timeout(1200)
            r2 = await ev("""(() => { const H = __hm, F = H.fn, P = H.GAME.player, W = H.WAR;
              const K = W.keeps.find((k) => k.realm !== P.faction); F.captureKeep(K, P.faction, P); return K.site.name; })()""")
            await page.wait_for_timeout(1500)
            r3 = await ev("""(() => { const H = __hm, F = H.fn, P = H.GAME.player, W = H.WAR;
              const rel = W.relics.find((x) => x.realm === P.faction); const foe = H.ENT.find((e) => e.alive && e.faction !== P.faction && e.faction <= 2 && e.kind !== 'door' && e.carrying == null);
              if (rel.state !== 'temple' || !foe) return 'no hallow to take';
              F.pickUpRelic(rel, foe); return rel.state + ' by ' + foe.name; })()""")
            await page.wait_for_timeout(1500)
            await ev("(() => { const H = __hm, P = H.GAME.player; H.CW.campaignVictory(P.faction, 'keeps'); return 0; })()")
            await page.wait_for_timeout(1500)
            await ev("(() => { const H = __hm, P = H.GAME.player; H.CW.resetMarch(); H.CW.campaignVictory((P.faction + 1) % 3, 'keeps'); return 0; })()")
            await page.wait_for_timeout(1500)
            s = await st()
            kinds = {k: t for k, t in s['stingers']}
            log('stinger events', r, r2, r3, s['stingers'])
            for k in ['levelup', 'keepWon', 'hallowLost', 'victory', 'defeat']:
                check(k in kinds and kinds[k] >= 0, f'stinger {k} played on its event')
            await ev("__hm.CW.resetMarch(); 0")

            # -------- side-chain: loud effects duck the score --------
            await ev("__hm.fn.sfx('crash'); __hm.fn.sfx('boom'); 0")
            await page.wait_for_timeout(250)
            mx = 0
            for _ in range(6):
                await ev("__hm.fn.sfx('thunderNear'); 0")
                await page.wait_for_timeout(200)
                mx = max(mx, (await st())['duckDb'])
            check(mx > 1.5, f'the score ducks under loud effects (max {mx} dB)')

            # -------- the volume setting: the menu, the bus, the save --------
            await ev("(() => { const H = __hm; if (H.LORE && H.UI.modal === 'prologue') H.LORE.closePrologue(); H.UI.modal = 'menu'; H.fn.openMenu('settings'); return 0; })()")
            await page.wait_for_timeout(300)
            seg = await ev("[...document.querySelectorAll('#set-m button')].map((b) => b.dataset.v + ':' + b.getAttribute('aria-checked')).join(' ')")
            check('medium:true' in seg, f'music row in the settings menu, Medium by default ({seg})')
            if SHOTS:
                await page.screenshot(path=str(OUT) + '/music_settings.png', timeout=300000)
            await ev("document.querySelector('#set-m button[data-v=\"low\"]').click(); 0")
            await page.wait_for_timeout(400)
            r = await ev("""(() => { const H = __hm, M = H.music; const s = M.buildSave(); H.fn.saveNow(); return { vol: M.M.vol, bus: +M.M.bus.gain.value.toFixed(3), saved: s.settings.music,
              checked: [...document.querySelectorAll('#set-m button')].filter((b) => b.getAttribute('aria-checked') === 'true').map((b) => b.dataset.v) }; })()""")
            await page.wait_for_timeout(600)
            ls = await ev("(() => { try { return JSON.parse(localStorage.getItem('hallowmarch.save.v1')).settings.music; } catch (e) { return null; } })()")
            check(abs(r['vol'] - 0.3) < 1e-6 and r['checked'] == ['low'] and abs(r['saved'] - 0.3) < 1e-6, f'Low sets the volume and goes into the save {r}')
            check(ls is not None and abs(ls - 0.3) < 1e-6, f'the music volume is written with the settings (localStorage: {ls})')
            r = await ev("(() => { const M = __hm.music; M.applySettings({ music: 0.9 }); const a = M.M.vol; M.applySettings({ sound: true }); const b = M.M.vol; M.applySettings({ music: 'loud' }); return [a, b, M.M.vol]; })()")
            check(r == [0.9, 0.9, 0.9], f'a saved volume is restored, old saves without one keep it, junk is ignored {r}')
            await ev("__hm.fn.closeMenu ? __hm.fn.closeMenu() : 0; __hm.UI.modal = 'menu'; __hm.music.setMusicVolume(0.55); 0")

            # -------- the tab hidden: everything pauses --------
            r = await ev("""(async () => { const A = __hm.fn.AUDIO; Object.defineProperty(document, 'hidden', { value: true, configurable: true });
              document.dispatchEvent(new Event('visibilitychange')); await new Promise((r) => setTimeout(r, 400)); const a = A.ctx.state;
              Object.defineProperty(document, 'hidden', { value: false, configurable: true }); document.dispatchEvent(new Event('visibilitychange'));
              await new Promise((r) => setTimeout(r, 600)); return [a, A.ctx.state]; })()""")
            check(r == ['suspended', 'running'], f'hidden tab suspends the audio, showing it resumes {r}')

            # -------- no leaks: volume off lets every voice and piece go --------
            s = await st()
            peak_live = max(peak_live, s['live'])
            log('voices now', s['live'], 'nodes', s['nodes'], 'made', s['made'], 'peak', s['peak'])
            await ev("__hm.music.setMusicVolume(0); 0")
            t = time.time()
            while time.time() - t < 20:
                s = await st()
                if not s['pieces'] and s['live'] == 0: break
                await page.wait_for_timeout(700)
            check(not s['pieces'] and s['live'] == 0 and s['nodes'] == 0, f"music off: pieces {len(s['pieces'])}, live voices {s['live']}, nodes {s['nodes']} (made {s['made']}, peak {s['peak']})")
            check(s['peak'] < 400, f"concurrent voices stay bounded (peak {s['peak']})")
            await ev("__hm.music.setMusicVolume(0.55); 0")
            await page.wait_for_timeout(1500)
            s = await st()
            check(s['mood'] != '' and s['pieces'], f"music back on resumes ({s['mood']})")

        if OFFLINE:
            # -------- an offline soak: many minutes of mood changes and stingers --------
            r = await ev("__hm.music.soak(180, 2).then((r) => ({ end: r.end, made: r.made, peak: r.peak, live: r.samples.map((x) => x[1]), nodes: r.samples.map((x) => x[2]) }))")
            lv = r['live']
            first, last = max(lv[5:30]), max(lv[-30:])
            log('soak', 'made', r['made'], 'peak', r['peak'], 'end', r['end'], 'live max first/last', first, last)
            check(r['end'][0] == 0 and r['end'][1] == 0, f"offline soak: every voice ends and lets go of its nodes (live {r['end'][0]}, nodes {r['end'][1]})")
            check(last <= first * 2.5 + 40, f'offline soak: live voices do not grow over three minutes ({first} early, {last} late)')
            # -------- every mood and stinger rendered offline: levels and a WAV --------
            for w, secs, extra in [('title', 10, ''), ('logres', 10, ''), ('eriu', 10, ''), ('thule', 10, ''), ('frontier', 10, ''), ('battle', 10, ''), ('barrow', 10, ''), ('night', 10, ', flavour: 2'),
                                   ('levelup', 4, ''), ('keepWon', 4, ''), ('keepLost', 4, ''), ('hallowWon', 4, ''), ('hallowLost', 5, ''), ('victory', 7, ''), ('defeat', 8, '')]:
                r = await ev(f"__hm.music.render('{w}', {secs}, {{ wav: true{extra} }})")
                wav = r.pop('wav')
                (pathlib.Path(OUT) / f'music_{w}.wav').write_bytes(base64.b64decode(wav))
                ok = r['finite'] and r['clip'] == 0 and r['peakDb'] < -1 and -42 < r['rmsDb'] < -16
                check(ok, f"offline {w}: peak {r['peakDb']} dBFS, rms {r['rmsDb']} dBFS, loudest 0.4 s {r['maxShortDb']} dBFS, {r['voices']} voices -> music_{w}.wav")

        if SHOTS:
            # -------- the aurora over Thule at night --------
            await ev("clearInterval(window.__mt); 0")
            # a clear view of the sky: no menu, prologue, victory screen or HUD over it
            await ev("""(() => { const H = __hm; document.getElementById('menu').hidden = true; if (H.LORE && H.UI.modal === 'prologue') H.LORE.closePrologue();
              if (H.CW) { H.CW.CAMPAIGN.pendingVictory = null; H.CW.closeVictory(); } const hud = document.getElementById('hud'); if (hud) hud.hidden = true; H.UI.modal = 'menu'; return 0; })()""")
            async def shot(name, js, frames=2):
                await ev(js)
                for _ in range(frames): await ev("__hm.frame(1/30)")
                await page.screenshot(path=str(OUT) + f'/{name}.png', timeout=300000)
                a = await ev("__hm.aurora.state()")
                log('shot', name, a)
                return a
            await ev("""(() => { const H = __hm; if (!H.GAME.player) H.start({ realm: 2, cls: 'warrior', level: 20 }); H.UI.modal = 'menu'; H.CAM.mode = 'fixed';
              const W = H.dbg.WEATHER; W.mode = 'clear'; W.kind = 'clear'; W.overcast = W.fog = W.raining = W.storm = W.mist = 0; W.snowing = 0; H.setTod(2.1); return 0; })()""")
            north = """(() => { const H = __hm, F = H.fn, R = H.REALMS[2]; const x = R.dx * 300 + R.px * 30, z = R.dz * 300 + R.pz * 30; H.teleport(x, z);
              H.camera.position.set(x, F.heightAt(x, z) + %s, z); H.camera.lookAt(x + %s, F.heightAt(x, z) + %s, z - 100); %s return 0; })()"""
            for q in ['high', 'medium']:
                await ev(f"__hm.fn.setQuality('{q}'); 0")
                a = await shot(f'aurora_thule_{q}', north % ('3', '10', '58', "__hm.aurora.force({ str: 1 });"), 2)
                check(a['on'] and a['str'] > 0.9 and a['lat'] > 0.9, f'aurora over Thule at night ({q}): {a}')
            await ev("__hm.aurora.force(null); 0")
            # its natural strength, unforced, after a few seconds of clear night in Thule
            await ev("(() => { for (let i = 0; i < 12; i++) __hm.aurora.updateNightSky(0.5); return 0; })()")
            a = await ev("__hm.aurora.state()")
            check(a['on'] and a['str'] > 0.6, f'unforced, the clear Thule night shows the lights {a}')
            # looking straight up from Thule
            await shot('aurora_thule_overhead', north % ('3', '2', '200', ''), 1)
            # a cloudy night hides them
            await ev("(() => { const W = __hm.dbg.WEATHER; W.mode = 'auto'; W.kind = 'cloudy'; W.next = 999; W.overcast = 0.95; W.fog = 0.3; return 0; })()")
            await ev("__hm.frame(0.5)")
            await ev("(() => { for (let i = 0; i < 40; i++) __hm.aurora.updateNightSky(0.5); return 0; })()")
            a = await shot('aurora_cloudy', north % ('3', '10', '58', ''), 1)
            check(a['str'] < 0.05, f'a cloudy night hides the aurora (strength {a["str"]})')
            # dawn fades them
            await ev("(() => { const W = __hm.dbg.WEATHER; W.mode = 'clear'; W.kind = 'clear'; W.overcast = W.fog = W.raining = W.storm = W.mist = 0; __hm.setTod(2.1); return 0; })()")
            await ev("__hm.frame(0.5)")
            await ev("(() => { for (let i = 0; i < 40; i++) __hm.aurora.updateNightSky(0.5); return 0; })()")
            a1 = await ev("__hm.aurora.state()")
            await ev("__hm.setTod(0.15)")
            await ev("__hm.frame(0.5)")
            await ev("(() => { for (let i = 0; i < 40; i++) __hm.aurora.updateNightSky(0.5); return 0; })()")
            a2 = await ev("__hm.aurora.state()")
            check(a1['str'] > 0.5 and a2['str'] < 0.05 and not a2['visible'], f'dawn fades the lights ({a1["str"]} at night, {a2["str"]} in the morning)')
            # from Logres: faint, low in the north
            await ev("__hm.setTod(2.1); 0")
            await ev("""(() => { const H = __hm, F = H.fn, R = H.REALMS[0]; const x = R.dx * 300, z = R.dz * 300; H.teleport(x, z);
              H.camera.position.set(x, F.heightAt(x, z) + 4, z); H.camera.lookAt(x, F.heightAt(x, z) + 30, z - 100); return 0; })()""")
            await ev("__hm.frame(0.5)")
            await ev("(() => { for (let i = 0; i < 40; i++) __hm.aurora.updateNightSky(0.5); return 0; })()")
            a = await shot('aurora_logres_north', "0", 1)
            check(a['on'] and 0.1 < a['str'] < 0.4 and a['lat'] < 0.1, f'from Logres the lights are faint and low in the north {a}')
            # a shooting star across the view
            await ev("__hm.fn.setQuality('high'); 0")
            a = await shot('shooting_star', north % ('3', '-60', '40', "__hm.aurora.force({ str: 0.35, lat: 1 }); __hm.aurora.shootStar({ az: 305, el: 32, daz: 14, del: 12, dur: 1, hold: 0.62, bright: 1.6 });"), 1)
            check(a['star'], f'a shooting star is drawn {a}')
            await ev("__hm.aurora.force(null); __hm.aurora.S.hold = -1; 0")
            # every program still compiles
            bad = await ev("__hm.dbg.renderer.info.programs.filter(p => p.diagnostics && !p.diagnostics.runnable).map(p => p.name)")
            check(not bad, f'no broken shader programs {bad}')

        errs = await ev("__hm.errors")
        check(not errs, f'no runtime errors {errs[:3]}')
        print('logs', [l for l in logs if 'error' in l.lower()][:4])
        print('FAILED:' if FAILS else 'ALL PASSED', FAILS, f'({time.time() - T0:.0f}s)')
        await b.close()
asyncio.run(main())
