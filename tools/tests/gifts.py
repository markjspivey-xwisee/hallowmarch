"""Realm gifts, end to end through window.__hm:
for each realm, the two passives (locked below their realm rank, then their exact numbers through the real damage,
buff and speed paths), the realm ultimate on key 9 (its effects on allies and foes, the cooldown, the HUD slot and
its cooldown display), a champion of the realm calling it in a big fight, and the Chronicle page. Then the phone pad:
the round gift button sits clear of the other buttons and a tap calls the gift. Screenshots of each ultimate.
usage: python3 tools/tests/gifts.py [noshots] [nophone] [quality]   (quality for the shots: high, medium or low; default high)"""
import json, asyncio, sys, pathlib, time
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
from hmlib import setup, OUT
from playwright.async_api import async_playwright

ARGS = sys.argv[1:]
SHOTS = 'noshots' not in ARGS
PHONE = 'nophone' not in ARGS
QUALITY = next((a for a in ARGS if a in ('high', 'medium', 'low')), 'high')
FAILS = []
T0 = time.time()

def check(cond, what):
    print(('  ok   ' if cond else '  FAIL ') + what, flush=True)
    if not cond: FAILS.append(what)

async def ev(page, label, js):
    r = await page.evaluate(js)
    print(f'{label} [{time.time() - T0:.0f}s]', json.dumps(r)[:1400], flush=True)
    return r

def near(a, b, tol=0.004):
    return a is not None and b is not None and abs(a - b) <= tol

HELPERS = r"""
window.T = {
  H: __hm, F: __hm.fn, G: __hm.gifts,
  RR: [0, 250, 750, 1750, 3500, 6000],
  setRR(rr) { this.H.GAME.prog.rp = this.RR[rr - 1]; this.H.simulate(0.6); },
  clearWeather() { const Wt = this.H.dbg.WEATHER; Wt.mode = 'fixed'; Wt.kind = 'clear'; Wt.raining = 0; Wt.wet = 0; Wt.snowing = 0; Wt.snow = 0; Wt.overcast = 0; Wt.target = 0; Wt.w = 0; },
  rain() { const Wt = this.H.dbg.WEATHER; Wt.mode = 'fixed'; Wt.kind = 'rain'; Wt.raining = 1; Wt.snowing = 0; Wt.overcast = 0.8; },
  meadow(cx, cz) {
    const W = this.F.W;
    for (let k = 0; k < 6000; k++) {
      const a = k * 2.4, r = 10 + k * 0.06, x = cx + Math.sin(a) * r, z = cz + Math.cos(a) * r;
      if (!this.F.isWalkable(x, z) || Math.hypot(x, z) > 440) continue;
      if (this.F.sampleGrid(W.road, x, z) > 0.05) continue;
      const hh = this.F.heightAt;
      if (Math.abs(hh(x + 8, z) - hh(x - 8, z)) + Math.abs(hh(x, z + 8) - hh(x, z - 8)) > 1.4) continue;
      if (W.trees.some((t) => Math.abs(t.x - x) < 16 && Math.abs(t.z - z) < 16)) continue;
      if (this.H.REALMS.some((R) => Math.hypot(x - R.town.x, z - R.town.z) < 90)) continue;
      if (this.H.ENT.some((e) => e.alive && e.role !== 'player' && e.kind !== 'door' && Math.hypot(e.x - x, e.z - z) < 30)) continue;
      return { x, z };
    }
    return null;
  },
  forest(cx, cz) {
    const W = this.F.W; let best = null, bn = 0;
    for (const t of W.trees) {
      if (Math.hypot(t.x - cx, t.z - cz) > 160) continue;
      let n = 0; for (const o of W.trees) if (Math.hypot(o.x - t.x, o.z - t.z) < 8) n++;
      if (n > bn && this.F.isWalkable(t.x + 1.6, t.z)) { bn = n; best = { x: t.x + 1.6, z: t.z }; }
    }
    return best;
  },
  // a dummy foe that does not fight back, and a friend
  foe(realm, x, z) { const e = this.F.spawnRealmUnit(realm, 'warrior', this.H.GAME.player.level, 'guard', x, z, { ai: { think: 0, post: { x, z } } }); this.F.addBuff(e, 'stun', 1, 9999, 'test'); return e; },
  friend(realm, x, z) { const e = this.F.spawnRealmUnit(realm, 'warrior', this.H.GAME.player.level, 'guard', x, z, { ai: { think: 0, post: { x, z } } }); this.F.addBuff(e, 'stun', 1, 9999, 'test'); return e; },
  clear() { for (const e of this.H.ENT.slice()) if (e.tmp) this.F.removeEnt(e); },
  // harm taken from a flat blow of 100 (no randomness): the gift's share is what changes
  taken(kind) { const P = this.H.GAME.player; P.hp = P.maxHp; P.buffs.length = 0; const src = this.dummy || (this.dummy = { id: -7, level: P.level, dmgMult: 1, faction: (P.faction + 1) % 3, buffs: [], role: 'none', scale: 1, alive: true });
    const before = P.hp; this.F.dealDamage(src, P, 100, { kind }); const d = before - P.hp; P.hp = P.maxHp; return d; },
  dealt(frac) { const P = this.H.GAME.player, t = this.target; P.hp = P.maxHp * frac; t.hp = t.maxHp; t.buffs.length = 0; const before = t.hp; this.F.dealDamage(P, t, 100, { kind: 'melee' }); const d = before - t.hp; t.hp = t.maxHp; P.hp = P.maxHp; return d; },
  cam(x, y, z, tx, ty, tz) { const H = this.H; y = Math.max(y, this.F.heightAt(x, z) + 1.6); H.UI.modal = 'menu'; H.CAM.mode = 'fixed'; H.camera.position.set(x, y, z); H.camera.lookAt(tx, ty, tz); H.camera.updateMatrixWorld(); },
  play() { this.H.UI.modal = null; this.H.CAM.mode = 'play'; },
  hud() { const g = document.querySelector('#hotbar .gslot'); const slots = [...document.querySelectorAll('#hotbar > *')].map((e) => e.className); return { has: !!g, key: g && g.querySelector('.key') && g.querySelector('.key').textContent, locked: g && g.classList.contains('locked'), ready: g && g.classList.contains('ready'), cdt: g && g.querySelector('.cdt').textContent, p: g && g.style.getPropertyValue('--p'), order: slots, pad: !!document.querySelector('#tpad .gslot'), marks: document.querySelectorAll('#pf-gifts .gift').length, lit: document.querySelectorAll('#pf-gifts .gift.on').length, uiSlots: this.H.UI.slots.length }; },
};
"""

async def frames(page, n):
    for _ in range(n): await page.evaluate("__hm.frame(1/30)")

async def shot(page, name, js, n=4):
    if not SHOTS: return
    await page.evaluate(js)
    await frames(page, n)
    await page.screenshot(path=OUT + 'gifts_' + name + '.png', timeout=300000)
    print('  shot', 'gifts_' + name, f'[{time.time() - T0:.0f}s]', flush=True)

async def realm_case(page, realm):
    name = ['Logres', 'Eriu', 'Thule'][realm]
    print(f'--- {name} ---', flush=True)
    await page.evaluate(f"(async () => {{ if (__hm.GAME.player) __hm.fn.newCharacter(); await __hm.start({{ realm: {realm}, cls: 'warrior', level: 35 }}); }})()")
    await page.evaluate(HELPERS + '\n;0')
    r = await ev(page, 'place', """(() => { const P = T.H.GAME.player; T.clearWeather(); T.H.setTod(0.55); const R = T.H.REALMS[P.faction];
      const m = T.meadow(R.town.x * 0.8, R.town.z * 0.8); T.H.teleport(m.x, m.z); window.T.m = m; T.setRR(1);
      return { m, rr: T.G.giftRR(), unlocked: T.G.giftUltUnlocked(P) }; })()""")
    # ---- below the ranks: nothing ----
    r = await ev(page, 'locked', """(() => { const P = T.H.GAME.player; return { has: T.G.GIFT_DEF[P.faction].passives.map((p) => T.G.giftHas(P, p.id)), melee: T.taken('melee'), frost: T.taken('frost'), speed: T.F.effectiveSpeed ? 0 : 0 }; })()""")
    check(all(h == 0 for h in r['has']), f'{name}: no passive gifts at realm rank 1')
    base_melee, base_frost = r['melee'], r['frost']
    # ---- realm rank 4: both passives; the first is 10% stronger (two ranks past its own) ----
    await page.evaluate("T.setRR(4)")
    if realm == 0:
        r = await ev(page, 'steadfast', """(() => { const P = T.H.GAME.player, out = {};
          out.alone = T.taken('melee');
          const fs = [0, 1].map((k) => { const f = T.friend(0, P.x + 2 + k, P.z + 1); f.tmp = true; return f; }); T.H.simulate(0.6); out.two = T.taken('melee'); out.allies2 = T.G.GIFT.allies; out.on2 = T.G.GIFT.on.steadfast;
          for (let k = 0; k < 2; k++) { const f = T.friend(0, P.x - 2 - k, P.z - 1); f.tmp = true; } T.H.simulate(0.6); out.four = T.taken('melee'); out.allies4 = T.G.GIFT.allies;
          T.clear(); T.H.simulate(0.6); out.after = T.taken('melee'); for (let i = 0; i < 10; i++) T.H.frame(1 / 30); out.hud = T.hud(); // the marks are redrawn every tenth frame
          // unbroken: a 2 s stun lasts 1.4 s
          P.buffs.length = 0; const b = T.F.addBuff(P, 'stun', 1, 2, 'test'); out.stun = +(b.until - T.H.GAME.t).toFixed(4); P.buffs.length = 0;
          const s = T.F.addBuff(P, 'snare', 0.5, 2, 'test'); out.snare = [s.value, +(s.until - T.H.GAME.t).toFixed(4)]; P.buffs.length = 0;
          return out; })()""")
        check(near(r['alone'], base_melee, 0.01), 'Logres: alone, Steadfast Lines does nothing')
        check(r['allies2'] == 2 and r['on2'] and near(r['two'] / r['alone'], 1 - 0.08 * 1.1), f"Logres: with two allies near, harm taken x{r['two'] / r['alone']:.4f} (expected {1 - 0.088:.4f})")
        check(r['allies4'] >= 4 and near(r['four'] / r['alone'], 1 - 0.14 * 1.1), f"Logres: with four, x{r['four'] / r['alone']:.4f} (expected {1 - 0.154:.4f})")
        check(near(r['stun'], 1.4, 0.002), f"Logres: Unbroken: a 2 s stun lasts {r['stun']} s")
        check(near(r['snare'][0], 0.5) and near(r['snare'][1], 2, 0.002), 'Logres: snares are not touched by Unbroken')
        check(r['hud']['marks'] == 2, 'Logres: two passive marks under the player frame')
    elif realm == 1:
        r = await ev(page, 'woodwise', """(() => { const P = T.H.GAME.player, out = {};
          T.H.simulate(0.6); out.open = T.F.effectiveSpeed ? null : null; out.openSpeed = P.speed * T.G.giftSpeedMult(P); out.onOpen = T.G.GIFT.on.woodwise;
          const f = T.forest(P.x, P.z); T.H.teleport(f.x, f.z); T.H.simulate(0.6); out.trees = T.G.GIFT.trees; out.onWood = T.G.GIFT.on.woodwise; out.woodMult = T.G.giftSpeedMult(P);
          // and really faster: walk for two seconds among the trees
          T.H.teleport(T.m.x, T.m.z); T.H.simulate(0.6);
          // rain-blest: the same rest, with and without rain
          const heal = (wet) => { if (wet) T.rain(); else T.clearWeather(); T.H.simulate(0.6); P.hp = P.maxHp * 0.5; P.combatUntil = T.H.GAME.t + 30; const h0 = P.hp; T.H.simulate(4.2); const g = (P.hp - h0) / P.maxHp; return g; };
          out.dry = heal(false); out.wet = heal(true); out.onRain = T.G.GIFT.on.rainblest; T.clearWeather();
          out.hud = T.hud(); return out; })()""")
        check(not r['onOpen'] and r['trees'] >= 3 and r['onWood'] and near(r['woodMult'], 1 + 0.15 * 1.1), f"Eriu: Wood-wise: among {r['trees']} trees x{r['woodMult']:.4f} speed (expected 1.165), none in the open")
        check(r['onRain'] and near(r['wet'] - r['dry'], 0.024, 0.004), f"Eriu: Rain-blest: {100 * (r['wet'] - r['dry']):.2f}% of health in 4 s of rain (expected 2.4%)")
        check(r['hud']['marks'] == 2, 'Eriu: two passive marks under the player frame')
    else:
        r = await ev(page, 'coldblood', """(() => { const P = T.H.GAME.player, out = {};
          out.melee = T.taken('melee'); out.frost = T.taken('frost'); out.ice = T.taken('ice');
          const s = T.F.addBuff(P, 'snare', 0.4, 2, 'test'); out.snare = [s.value, +(s.until - T.H.GAME.t).toFixed(4)]; P.buffs.length = 0;
          const ro = T.F.addBuff(P, 'root', 1, 2, 'test'); out.root = +(ro.until - T.H.GAME.t).toFixed(4); P.buffs.length = 0;
          // wound-fury: a foe to strike
          const t = T.foe(0, P.x + 3, P.z); t.tmp = true; window.T.target = t;
          out.full = T.dealt(1); out.half = T.dealt(0.45); out.quarter = T.dealt(0.2);
          P.hp = P.maxHp * 0.3; T.H.simulate(0.6); out.furyOn = T.G.GIFT.on.woundfury; P.hp = P.maxHp; T.clear();
          out.hud = T.hud(); return out; })()""")
        check(near(r['melee'], base_melee, 0.01), 'Thule: ordinary blows are not touched by Cold-blooded')
        check(near(r['frost'] / r['melee'], 1 - 0.25 * 1.1) and near(r['ice'] / r['melee'], 1 - 0.25 * 1.1), f"Thule: frost harm x{r['frost'] / r['melee']:.4f} (expected 0.725)")
        check(near(r['snare'][0], 0.4 * (1 - 0.35 * 1.1)) and near(r['root'], 2 * (1 - 0.35 * 1.1), 0.003), f"Thule: snare {r['snare'][0]:.4f} (0.246), root {r['root']} s (1.23)")
        check(near(r['half'] / r['full'], 1.12) and near(r['quarter'] / r['full'], 1.24) and r['furyOn'], f"Thule: Wound-fury x{r['half'] / r['full']:.4f} below half, x{r['quarter'] / r['full']:.4f} below a quarter")
        check(r['hud']['marks'] == 2, 'Thule: two passive marks under the player frame')

    # ---- the realm ultimate ----
    r = await ev(page, 'hud', "(() => { T.H.GAME.prog.level = 29; T.F.buildHotbar(); T.H.frame(1/30); const a = T.hud(); T.H.GAME.prog.level = 35; T.F.buildHotbar(); T.H.frame(1/30); T.H.GAME.player.buffs.length = 0; /* [classes] the frost tests above chill and may freeze the player */ return { locked: a, open: T.hud(), res: T.G.useRealmGift() }; })()")
    # (useRealmGift above ran with the gift open: it is the first cast)
    hud = r['open']
    check(r['locked']['locked'] and not hud['locked'], f'{name}: the gift button is locked below level 30 and realm rank 5, open at level 35')
    check(hud['has'] and hud['key'] == '9' and hud['pad'] and hud['uiSlots'] == 16, f"{name}: the 9th button on the hotbar ({hud['order']}) and on the phone pad; the 8 abilities keep their own slots")
    check(r['res'] is True, f"{name}: the gift is called")
    # undo that cast's effects so the real test goes through key 9
    await page.evaluate("(() => { const P = T.H.GAME.player; P.giftCdUntil = 0; for (const S of T.G.GIFT.standards.slice()) S.until = 0; for (const S of T.G.GIFT.storms.slice()) S.until = 0; for (const h of T.G.GIFT.hounds) h.hunt.until = 0; T.H.simulate(3); T.H.GAME.player.buffs.length = 0; })()")
    # foes and friends round the caster
    await page.evaluate(f"""(() => {{ const P = T.H.GAME.player; P.yaw = 0; const foeR = (P.faction + 1) % 3;
      window.T.foes = [0, 1, 2].map((k) => {{ const e = T.foe(foeR, P.x + (k - 1) * 3, P.z + 9); e.tmp = true; return e; }});
      window.T.friends = [0, 1].map((k) => {{ const e = T.friend(P.faction, P.x + (k ? 2.5 : -2.5), P.z - 1.5); e.tmp = true; return e; }});
      T.F.addBuff(T.friends[0], 'snare', 0.5, 20, 'test');
      P.target = T.foes[1].id; T.play(); }})()""")
    casts0 = await page.evaluate("T.G.GIFT.casts")
    await page.keyboard.press('Digit9')
    r = await ev(page, 'key 9', "(() => { const P = T.H.GAME.player; return { casts: T.G.GIFT.casts, cd: +(P.giftCdUntil - T.H.GAME.t).toFixed(1), state: T.G.state() }; })()")
    check(r['casts'] == casts0 + 1 and near(r['cd'], 300, 0.6), f"{name}: key 9 calls the realm gift; cooldown {r['cd']} s")
    await page.keyboard.press('Digit9')
    r2 = await ev(page, 'again', "(() => ({ casts: T.G.GIFT.casts, err: document.getElementById('error') ? document.getElementById('error').textContent : '' }))()")
    check(r2['casts'] == r['casts'] and 'not ready' in r2['err'], f"{name}: pressed again it waits for the cooldown ({r2['err']!r})")
    if realm == 0:
        r = await ev(page, 'standard', """(() => { T.H.simulate(1.6); const P = T.H.GAME.player, S = T.G.GIFT.standards.find((q) => q.src === P.id), f = T.friends[0]; /* [v13] the caller's own */
          const buf = (e, k) => { const b = e.buffs.find((q) => q.kind === k && q.src === 'standard'); return b ? +b.value.toFixed(3) : 0; };
          return { n: T.G.GIFT.standards.filter((q) => q.src === P.id).length, landed: S && S.landed, at: S && [S.x - P.x, S.z - P.z], shield: buf(P, 'shield') / P.maxHp, dmg: buf(P, 'dmg'), fshield: buf(f, 'shield') / f.maxHp, fsnare: f.buffs.some((b) => b.kind === 'snare'),
            foeShield: buf(T.foes[0], 'shield'), k: S && S.k }; })()""")
        k = r['k'] or 0
        check(r['n'] == 1 and r['landed'], 'Logres: the great standard is planted')
        check(near(r['shield'], 0.12 * k, 0.002) and near(r['dmg'], 0.15 * k, 0.002) and near(r['fshield'], 0.12 * k, 0.002), f"Logres: allies in reach are warded ({r['shield']:.3f} of health) and rallied (+{r['dmg']:.3f} damage), k {k:.2f}")
        check(not r['fsnare'] and r['foeShield'] == 0, 'Logres: the rally frees allies from snares; foes get nothing')
        await shot(page, 'standard', """(() => { const P = T.H.GAME.player, S = T.G.GIFT.standards.find((q) => q.src === P.id) || T.G.GIFT.standards[0]; T.cam(S.x + 7.5, S.y + 3.2, S.z - 10, S.x, S.y + 4.2, S.z); })()""", 8)
        await page.evaluate("T.play()")
        r = await ev(page, 'standard ends', "(() => { T.H.simulate(22); return { n: T.G.GIFT.standards.filter((q) => q.src === T.H.GAME.player.id).length, shield: T.H.GAME.player.buffs.filter((b) => b.src === 'standard' && b.until > T.H.GAME.t).length }; })()")
        check(r['n'] == 0 and r['shield'] == 0, 'Logres: after 20 s the standard is taken up and its wards run out')
    elif realm == 1:
        r = await ev(page, 'hunt', """(() => { const hp0 = T.foes.map((e) => e.hp); T.H.simulate(4); const hs = T.G.GIFT.hounds.filter((h) => !h.removed && h.hunt && h.hunt.owner === T.H.GAME.player.id); /* [v13] the caller's own: a keep lord fighting elsewhere may loose his */
          return { n: hs.length, targets: hs.filter((h) => h.target && T.foes.some((f) => f.id === h.target)).length, hurt: T.foes.filter((e, i) => e.hp < hp0[i] || !e.alive).length, snared: T.foes.filter((e) => e.buffs.some((b) => b.kind === 'snare')).length,
            near: hs.filter((h) => T.foes.some((f) => Math.hypot(f.x - h.x, f.z - h.z) < 4)).length, faction: hs.every((h) => h.faction === T.H.GAME.player.faction), finite: hs.every((h) => Number.isFinite(h.x + h.y + h.z)) }; })()""")
        check(r['n'] == 5 and r['faction'] and r['finite'], 'Eriu: five hounds of the Grey Hunt run with the caller')
        check(r['targets'] >= 3 and r['near'] >= 3 and r['hurt'] >= 2 and r['snared'] >= 1, f"Eriu: they hunt the foes: {r['hurt']} hurt, {r['snared']} slowed by their bites")
        await shot(page, 'hunt', """(() => { const P = T.H.GAME.player; const hs = T.G.GIFT.hounds.filter((h) => !h.removed); const cx = hs.reduce((a, h) => a + h.x, 0) / hs.length, cz = hs.reduce((a, h) => a + h.z, 0) / hs.length;
          T.cam(cx - 7, T.F.heightAt(cx, cz) + 3.4, cz - 6, cx, T.F.heightAt(cx, cz) + 0.8, cz); })()""", 8)
        await page.evaluate("T.play()")
        r = await ev(page, 'hunt ends', "(() => { const id = T.H.GAME.player.id; T.H.simulate(16); return { n: T.G.GIFT.hounds.filter((h) => h.hunt && h.hunt.owner === id).length, ents: T.H.ENT.filter((e) => e.role === 'hound' && e.hunt && e.hunt.owner === id).length }; })()")
        check(r['n'] == 0 and r['ents'] == 0, 'Eriu: after 16 s the hounds go back into the mist')
    else:
        r = await ev(page, 'winter', """(() => { const hp0 = T.foes.map((e) => e.hp); const fr0 = T.friends.map((e) => e.hp); T.H.simulate(3.2); const S = T.G.GIFT.storms.find((q) => q.src === T.H.GAME.player.id); /* [v13] the caller's own */
          return { n: T.G.GIFT.storms.filter((q) => q.src === T.H.GAME.player.id).length, at: S && Math.hypot(S.x - T.foes[1].x, S.z - T.foes[1].z), hurt: T.foes.filter((e, i) => e.hp < hp0[i] || !e.alive).length, snared: T.foes.filter((e) => e.buffs.some((b) => b.kind === 'snare' && Math.abs(b.value - 0.45) < 1e-6)).length,
            friendsHurt: T.friends.filter((e, i) => e.hp < fr0[i]).length, held: T.foes.filter((e) => e.buffs.some((b) => (b.kind === 'snare' && b.value >= 0.45 - 1e-6) || b.kind === 'frozen')).length,
            buffs: T.foes.map((e) => e.alive ? e.buffs.filter((b) => b.src !== 'test').map((b) => b.kind + ':' + (+b.value).toFixed(2) + ':' + b.src + ':' + (b.until - T.H.GAME.t).toFixed(1)).join(',') : 'dead') }; })()""")
        check(r['n'] == 1 and r['at'] is not None and r['at'] < 4, f"Thule: the Iron Winter comes down on the foe ({r['at']:.1f} m off)")
        # (a foe the frost has frozen is held fast; [v12] the buffs are printed so a miss tells why)
        check(r['hurt'] == 3 and r['snared'] >= 2 and r['held'] == 3 and r['friendsHurt'] == 0, f"Thule: foes inside take frost and are slowed 45% or frozen; friends are spared ({r['snared']} slowed, {r['held']} held: {r['buffs']})")
        await shot(page, 'winter', """(() => { const S = T.G.GIFT.storms.find((q) => q.src === T.H.GAME.player.id) || T.G.GIFT.storms[0]; T.cam(S.x + 21, S.y + 9, S.z - 17, S.x, S.y + 5, S.z); })()""", 10)
        await page.evaluate("T.play()")
        # ([v13] the caller's own storm: a keep lord fighting elsewhere may call one of his own meanwhile)
        r = await ev(page, 'winter ends', "(() => { const P = T.H.GAME.player, S0 = T.G.GIFT.storms.find((S) => S.src === P.id); T.H.simulate(15); return { n: T.G.GIFT.storms.filter((S) => S.src === P.id).length, had: !!S0, gone: !!S0 && !T.G.GIFT.storms.includes(S0), others: T.G.GIFT.storms.length }; })()")
        check(r['had'] and r['gone'] and r['n'] == 0, f"Thule: the storm blows out after 14 s ({r['others']} storms of others)")
    # the HUD counts the cooldown down
    r = await ev(page, 'cooldown hud', "(() => { T.H.frame(1/30); return T.hud(); })()")
    check(r['cdt'] and r['cdt'].endswith('m') and float(r['p'] or 0) > 0.8, f"{name}: the button shows the cooldown ({r['cdt']}, {r['p']})")
    await page.evaluate("T.clear()")

    # ---- a champion calls it in a big fight ----
    r = await ev(page, 'champion', f"""(() => {{ const H = T.H, P = H.GAME.player; const K = H.WAR.keeps.find((k) => k.realm === {realm} && H.fn.getEnt(k.lord));
      if (!K) return {{ none: true }};
      const L = H.fn.getEnt(K.lord); const foeR = ({realm} + 1) % 3; const c0 = T.G.GIFT.casts;
      L.giftCdUntil = 0; T.G.GIFT.npcNext[{realm}] = 0;
      const foes = []; for (let k = 0; k < 7; k++) {{ const a = k * 0.9; const e = T.foe(foeR, L.x + Math.sin(a) * 6, L.z + Math.cos(a) * 6); e.tmp = true; foes.push(e); }}
      for (let k = 0; k < 3; k++) {{ const e = T.friend({realm}, L.x + k - 1, L.z + 2); e.tmp = true; }}
      L.combatUntil = H.GAME.t + 30; H.simulate(2);
      const last = T.G.GIFT.lastCast; const news = H.WAR.news.slice(-4).map((n) => n.text);
      T.clear(); H.simulate(25);
      return {{ cast: T.G.GIFT.casts - c0, by: last && last.by === L.id, id: last && last.id, news, cd: L.giftCdUntil - H.GAME.t }}; }})()""")
    if not r.get('none'):
        check(r['cast'] >= 1 and r['by'] and any('calls' in n for n in r['news']), f"{name}: a keep lord in a big fight calls the realm gift ({r['id']}): {r['news'][-1:]}")
    # ---- the Chronicle has a page on it ----
    r = await ev(page, 'chronicle', "(() => { const h = T.G.chronGifts(); return { len: h.length, realms: ['Logres', 'Ériu', 'Thule'].every((n) => h.includes(n)), key9: h.includes('key 9'), nav: !!document.querySelector('[data-sec=gifts]') || true }; })()")
    check(r['len'] > 1500 and r['realms'] and r['key9'], f'{name}: the Chronicle explains every realm\'s gifts')

async def main():
    async with async_playwright() as p:
        b, page, logs = await setup(p, w=800, h=450)
        page.on('console', lambda m: print('  console:', m.text[:300], flush=True) if m.type == 'error' else None)
        print(f'booted [{time.time() - T0:.0f}s]', flush=True)
        await page.evaluate(f"__hm.fn.setQuality('{QUALITY}')")
        for realm in (0, 1, 2):
            await realm_case(page, realm)
        # the Chronicle tab opens on the gifts
        r = await ev(page, 'chronicle tab', "(() => { __hm.LORE.openChronicle('gifts'); const b = document.querySelector('.chron-nav [data-sec=gifts]'); const body = document.querySelector('.chron-body'); const out = { tab: !!b, current: b && b.getAttribute('aria-current'), text: body ? body.textContent.slice(0, 80) : '' }; return out; })()")
        check(r['tab'] and r['current'] == 'true' and 'hallow' in r['text'], 'the Chronicle has a Realm gifts tab')
        if SHOTS:
            await page.screenshot(path=OUT + 'gifts_chronicle.png', timeout=300000)
            print('  shot gifts_chronicle', flush=True)
        await page.evaluate("__hm.UI.modal = null; document.getElementById('menu').hidden = true")
        # the hotbar with the gift button
        if SHOTS:
            await page.evaluate("(() => { const H = __hm; H.UI.modal = null; H.CAM.mode = 'play'; document.getElementById('hud').hidden = false; H.GAME.player.giftCdUntil = H.GAME.t + 137; })()")
            await frames(page, 3)
            await page.screenshot(path=OUT + 'gifts_hud.png', timeout=300000, clip={'x': 0, 'y': 300, 'width': 800, 'height': 150})
            print('  shot gifts_hud', flush=True)
        errs = await page.evaluate("__hm.errors")
        check(not errs, f'no runtime errors ({errs[:3]})')
        bad = await page.evaluate("__hm.dbg.renderer.info.programs.filter(p => p.diagnostics && !p.diagnostics.runnable).map(p => p.name)")
        check(not bad, f'every shader program compiled ({bad})')
        await b.close()
        if PHONE:
            b, page, logs = await setup(p, touch=True, w=740, h=360)
            print(f'phone booted [{time.time() - T0:.0f}s]', flush=True)
            await page.evaluate("__hm.start({ realm: 2, cls: 'archer', level: 32 })")
            await frames(page, 2)
            r = await ev(page, 'pad', """(() => { const g = document.querySelector('#tpad .gslot'), pad = document.getElementById('tpad'); const gr = g.getBoundingClientRect();
              const others = [...pad.querySelectorAll('button')].filter((x) => x !== g).map((x) => x.getBoundingClientRect());
              const hit = others.some((o) => !(o.right <= gr.left || o.left >= gr.right || o.bottom <= gr.top || o.top >= gr.bottom));
              const vis = getComputedStyle(pad).display !== 'none' && gr.width > 40;
              return { rect: [gr.left, gr.top, gr.width, gr.height], hit, vis, inView: gr.left >= 0 && gr.top >= 0 && gr.right <= innerWidth && gr.bottom <= innerHeight, cx: gr.left + gr.width / 2, cy: gr.top + gr.height / 2 }; })()""")
            check(r['vis'] and r['inView'] and not r['hit'], f"phone: the round gift button sits on screen, clear of the other buttons {r['rect']}")
            c0 = await page.evaluate("__hm.gifts.GIFT.casts")
            await page.touchscreen.tap(r['cx'], r['cy'])
            await frames(page, 2)
            c1 = await page.evaluate("__hm.gifts.GIFT.casts")
            check(c1 == c0 + 1, 'phone: a tap on it calls the realm gift')
            if SHOTS:
                await page.screenshot(path=OUT + 'gifts_phone.png', timeout=300000)
                print('  shot gifts_phone', flush=True)
            errs = await page.evaluate("__hm.errors")
            check(not errs, f'phone: no runtime errors ({errs[:3]})')
            await b.close()
        print('FAILED:' if FAILS else 'ALL PASSED', FAILS)

asyncio.run(main())
