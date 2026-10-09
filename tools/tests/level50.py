"""Level 50: the frontier and the Barrow scale with the player, ranks, the eight new abilities
(motion, damage, buffs, effects), borderland camps with champions, the eight-slot hotbar.
usage: python3 tools/tests/level50.py [shots]   (shots: also save screenshots of each ability)"""
import json, asyncio, sys, pathlib
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
from hmlib import setup, OUT
from playwright.async_api import async_playwright

SHOTS = 'shots' in sys.argv[1:]
FAILS = []

async def frames(page, n=3):
    for _ in range(n): await page.evaluate("new Promise(r=>requestAnimationFrame(()=>r()))")

async def ev(page, label, js):
    r = await page.evaluate(js)
    print(label, json.dumps(r)[:1600])
    return r

def check(cond, what):
    print(('  ok   ' if cond else '  FAIL ') + what)
    if not cond: FAILS.append(what)

# shared page helpers: an open patch of ground, enemies and friends to practise on
HELPERS = r"""
window.T = {
  H: __hm, F: __hm.fn,
  spot(P) {
    const H = this.H, F = this.F;
    for (let i = 0; i < 1500; i++) {
      const a = (i * 2.399) % (Math.PI * 2), d = 40 + (i % 23) * 8;
      const x = P.x + Math.sin(a) * d, z = P.z + Math.cos(a) * d;
      let ok = true;
      for (let k = 0; k < 12 && ok; k++) { const b = k / 12 * Math.PI * 2; for (const r of [5, 12, 20, 26]) { const xx = x + Math.sin(b) * r, zz = z + Math.cos(b) * r; if (!F.isWalkable(xx, zz) || Math.abs(F.heightAt(xx, zz) - F.heightAt(x, z)) > 2.2) ok = false; } }
      if (!ok) continue;
      if (H.ENT.some((e) => e.alive && e !== P && !e.testFoe && e.kind !== 'door' && Math.hypot(e.x - x, e.z - z) < 32)) continue;
      return { x, z };
    }
    throw new Error('no open ground found near ' + P.x.toFixed(0) + ',' + P.z.toFixed(0));
  },
  foe(realm, x, z, lvl, cls = 'warrior') {
    const e = this.F.spawnRealmUnit(realm, cls, lvl, 'guard', x, z);
    e.ai.post = { x, z, leash: 4 };
    e.testFoe = true;
    return e;
  },
  clearAround(x, z, r) { for (const e of this.H.ENT) if (e.alive && e.role !== 'player' && e.kind !== 'door' && Math.hypot(e.x - x, e.z - z) < r) { e.damagers = null; this.F.killEnt(e, null); this.F.removeEnt(e); } },
  fresh(cls, lvl, realm = 0) {
    const H = this.H, F = this.F;
    for (const e of H.ENT.slice()) if (e.testFoe) { e.damagers = null; if (e.alive) F.killEnt(e, null); F.removeEnt(e); }
    if (H.GAME.player) F.newCharacter();
    H.start({ realm, cls, level: lvl });
    const P = H.GAME.player;
    const s = this.spot(P);
    H.teleport(s.x, s.z);
    this.clearAround(s.x, s.z, 40);
    P.hp = P.maxHp; P.power = P.maxPower;
    return P;
  },
};
"""

async def shot(page, name, js, n=3):
    if not SHOTS: return
    await page.evaluate(js)
    await frames(page, n)
    await page.screenshot(path=str(OUT) + '/' + name + '.png', timeout=300000)
    print('  shot', name)

CAM = """((dx, dy, dz, ly) => { const H = __hm, P = H.GAME.player; H.UI.modal = 'menu'; H.CAM.mode = 'fixed';
  const c = Math.cos(P.yaw), s = Math.sin(P.yaw);
  H.camera.position.set(P.x + s * dz + c * dx, P.y + dy, P.z + c * dz - s * dx); H.camera.lookAt(P.x, P.y + ly, P.z); })"""

async def main():
    async with async_playwright() as p:
        b, page, logs = await setup(p, w=960, h=540)
        await page.evaluate("__hm.fn.setQuality('high')")
        await page.evaluate("() => {" + HELPERS + "; return 0; }")  # a function, so Playwright does not serialise __hm back

        # ---- scaling: a level 35 player meets a level 35 frontier ----
        r = await ev(page, 'scaling', """(() => { const H = __hm, F = H.fn; H.start({ realm: 0, cls: 'warrior', level: 35 }); const P = H.GAME.player;
          const keeps = H.WAR.keeps.map((K) => ({ door: [K.door.level, Math.round(K.door.maxHp)], lord: (F.getEnt(K.lord) || {}).level, guards: [...K.guards].map((id) => F.getEnt(id)).filter(Boolean).map((g) => g.level) }));
          const temples = H.WAR.temples.map((T) => ({ door: [T.door.level, Math.round(T.door.maxHp)], guardians: [...T.guardians].map((id) => F.getEnt(id)).filter(Boolean).map((g) => g.level) }));
          const king = F.getEnt(H.BARROW_STATE.king), warden = F.getEnt(H.BARROW_STATE.warden);
          const dragon = H.ENT.find((e) => e.role === 'boss');
          const musters = H.ENT.filter((e) => e.role === 'muster').map((e) => e.level);
          return { level: P.level, war: F.warLevel(), rank: F.abilityRank(P.level), mult: F.rankMult(P.level), keeps: keeps.slice(0, 2), temples: temples.slice(0, 1), king: king && [king.level, Math.round(king.maxHp)], warden: warden && warden.level, dragon: dragon && dragon.level, musters: musters.slice(0, 4) }; })()""")
        check(r['war'] == 35 and r['rank'] == 2, 'war level 35, ability rank II')
        check(all(g == 35 for g in r['keeps'][0]['guards']) and r['keeps'][0]['lord'] == 39, 'keep guards 35, lord 39')
        check(r['keeps'][0]['door'][0] == 37 and r['keeps'][0]['door'][1] > 3600, 'keep gate level 37 with more HP')
        check(r['king'][0] == 36 and r['warden'] == 34, 'Hollow King 36, warden 34')
        check(r['dragon'] == 39, 'dragon 39')
        check(all(m == 45 for m in r['musters']), 'muster wardens 45')

        # ---- borderland camps and their champions ----
        r = await ev(page, 'camps', """(() => { const H = __hm, F = H.fn; const late = H.CAMPS.filter((c) => c.elite);
          const per = [0, 1, 2].map((rl) => late.filter((c) => c.realm === rl).map((c) => c.type + ' ' + c.lmin + '-' + c.lmax));
          const elites = late.map((c) => F.getEnt(c.eliteId)).filter(Boolean).map((e) => [e.name, e.level, +e.scale.toFixed(2), Math.round(e.maxHp)]);
          return { per, elites: elites.slice(0, 6), n: elites.length }; })()""")
        check(all(len(x) >= 6 for x in r['per']), 'each realm has at least 6 borderland camps')
        check(r['n'] == sum(len(x) for x in r['per']), 'every borderland camp has its champion')

        # ---- warrior: whirlwind and leap strike ----
        r = await ev(page, 'whirl', """(() => { const P = T.fresh('warrior', 35); const H = T.H, F = T.F;
          const foes = [0, 2.1, 4.2].map((a) => T.foe(1, P.x + Math.sin(a) * 2.6, P.z + Math.cos(a) * 2.6, 33));
          const hp0 = foes.map((f) => f.hp), yaw0 = P.yaw;
          const why = F.useAbility(P, 'whirl', null);
          H.simulate(0.4);
          const spinMid = P.motion ? P.motion.kind : null, yawMid = P.yaw;
          H.simulate(0.6);
          return { why, spinMid, turned: +(yawMid - yaw0).toFixed(2), done: !P.motion, hit: foes.map((f, i) => Math.round(hp0[i] - f.hp)), discs: H.SPELL.discs.filter((d) => d.on).length }; })()""")
        check(r['why'] is True and r['spinMid'] == 'spin' and r['done'], 'whirlwind spins and ends')
        check(r['turned'] > 4, 'the body really turns during the spin')
        check(all(h > 0 for h in r['hit']), 'whirlwind cuts every foe around')
        await shot(page, 'l50_whirl', """(() => { const H = T.H, F = T.F, P = H.GAME.player; P.cds = {}; P.power = P.maxPower; F.useAbility(P, 'whirl', null); H.simulate(0.36); """ + CAM + """(3.6, 2.2, 5.4, 1.0); })()""")
        await page.evaluate("T.H.UI.modal = null; T.H.CAM.mode = 'play'")

        r = await ev(page, 'leap', """(() => { const P = T.fresh('warrior', 35); const H = T.H, F = T.F;
          const tx = P.x + Math.sin(P.yaw) * 14, tz = P.z + Math.cos(P.yaw) * 14;
          const t = T.foe(1, tx, tz, 33); P.target = t.id; const g0 = P.y, hp0 = t.hp;
          const why = F.useAbility(P, 'leap', t);
          H.simulate(0.3);
          const mid = { up: +(P.y - F.heightAt(P.x, P.z)).toFixed(2), act: P.anim.act, flying: !!P.motion };
          H.simulate(1.2);
          return { why, mid, landed: !P.motion && P.onGround, gap: +Math.hypot(P.x - t.x, P.z - t.z).toFixed(2), dmg: Math.round(hp0 - t.hp), stunned: F.hasBuff(t, 'stun') || t.buffs.some((b) => b.kind === 'stun') }; })()""")
        check(r['why'] is True and r['mid']['flying'] and r['mid']['up'] > 1.0, 'leap strike flies through the air')
        check(r['landed'] and r['gap'] < 2.5, 'lands beside the foe')
        check(r['dmg'] > 0, 'the landing strikes')
        await shot(page, 'l50_leap', """(() => { const H = T.H, F = T.F, P = H.GAME.player; P.cds = {}; P.power = P.maxPower;
          const t = T.foe(1, P.x + Math.sin(P.yaw) * 15, P.z + Math.cos(P.yaw) * 15, 33); P.target = t.id; F.useAbility(P, 'leap', t); H.simulate(0.28); """ + CAM + """(7.5, 2.0, 2.0, 1.6); })()""")
        await page.evaluate("T.H.UI.modal = null; T.H.CAM.mode = 'play'")

        # ---- archer: fire arrow and deadeye ----
        r = await ev(page, 'archer', """(() => { const P = T.fresh('archer', 35); const H = T.H, F = T.F;
          const t = T.foe(1, P.x + Math.sin(P.yaw) * 20, P.z + Math.cos(P.yaw) * 20, 33); t.maxHp *= 4; t.hp = t.maxHp; P.target = t.id;
          const hp0 = t.hp; F.useAbility(P, 'firearrow', t); H.simulate(0.8);
          const burning = t.buffs.some((b) => b.kind === 'burn'), hp1 = t.hp; H.simulate(3.0); const hp2 = t.hp;
          P.cds = {}; P.power = P.maxPower; P.gcdUntil = 0;
          const why = F.useAbility(P, 'deadeye', t); const casting = !!P.casting; H.simulate(3.2);
          return { burning, arrowHit: Math.round(hp0 - hp1), burnTicks: Math.round(hp1 - hp2), deadeye: why, casting, hp3: Math.round(t.hp), maxHp: Math.round(t.maxHp) }; })()""")
        check(r['burning'] and r['arrowHit'] > 0 and r['burnTicks'] > 0, 'fire arrow hits and sets the foe burning')
        check(r['deadeye'] is True and r['casting'], 'deadeye draws a long shot')
        await shot(page, 'l50_firearrow', """(() => { const H = T.H, F = T.F, P = H.GAME.player; const t = F.getEnt(P.target); P.cds = {}; P.power = P.maxPower; P.gcdUntil = 0;
          F.useAbility(P, 'firearrow', t); H.simulate(0.9); H.UI.modal = 'menu'; H.CAM.mode = 'fixed';
          H.camera.position.set(t.x + 3.2, t.y + 2.0, t.z + 3.2); H.camera.lookAt(t.x, t.y + 1.0, t.z); })()""", 4)
        await page.evaluate("T.H.UI.modal = null; T.H.CAM.mode = 'play'")

        # ---- mage: chain lightning and blizzard ----
        r = await ev(page, 'mage', """(() => { const P = T.fresh('mage', 35); const H = T.H, F = T.F;
          const fx = Math.sin(P.yaw), fz = Math.cos(P.yaw), sx = Math.cos(P.yaw), sz = -Math.sin(P.yaw);
          const foes = [[16, 0], [19, 4], [21, -4], [24, 1]].map(([f, s]) => T.foe(1, P.x + fx * f + sx * s, P.z + fz * f + sz * s, 33));
          foes.forEach((f) => { f.maxHp *= 4; f.hp = f.maxHp; });
          P.target = foes[0].id; const hp0 = foes.map((f) => f.hp);
          F.useAbility(P, 'chain', foes[0]); H.simulate(2.0);
          const chained = foes.map((f, i) => Math.round(hp0[i] - f.hp));
          P.cds = {}; P.power = P.maxPower; P.gcdUntil = 0;
          const hp1 = foes.map((f) => f.hp);
          F.useAbility(P, 'blizzard', foes[0]); H.simulate(2.6);
          const em = H.SPELL.emitters.length, snared = foes.filter((f) => f.buffs.some((b) => b.kind === 'snare')).length;
          H.simulate(5.5);
          return { chained, blizzard: foes.map((f, i) => Math.round(hp1[i] - f.hp)), emitters: em, snared }; })()""")
        check(sum(1 for c in r['chained'] if c > 0) >= 3, 'chain lightning leaps between foes')
        check(r['emitters'] >= 1 and r['snared'] >= 1, 'blizzard falls and slows')
        await shot(page, 'l50_chain', """(() => { const H = T.H, F = T.F, P = H.GAME.player; const t = F.getEnt(P.target); P.cds = {}; P.power = P.maxPower; P.gcdUntil = 0;
          F.useAbility(P, 'chain', t); H.simulate(1.28); H.UI.modal = 'menu'; H.CAM.mode = 'fixed';
          const c = Math.cos(P.yaw), s = Math.sin(P.yaw); H.camera.position.set(P.x - s * 4 + c * 6, P.y + 4.5, P.z - c * 4 - s * 6); H.camera.lookAt(t.x, t.y + 1.2, t.z); })()""", 2)
        await page.evaluate("T.H.UI.modal = null; T.H.CAM.mode = 'play'")
        await shot(page, 'l50_blizzard', """(() => { const H = T.H, F = T.F, P = H.GAME.player; const t = F.getEnt(P.target); P.cds = {}; P.power = P.maxPower; P.gcdUntil = 0;
          F.useAbility(P, 'blizzard', t); H.simulate(2.2); H.UI.modal = null; for (let i = 0; i < 40; i++) H.frame(1 / 30); H.UI.modal = 'menu'; H.CAM.mode = 'fixed';
          const c = Math.cos(P.yaw), s = Math.sin(P.yaw); H.camera.position.set(P.x + c * 5, P.y + 5, P.z - s * 5); H.camera.lookAt(t.x, t.y, t.z); })()""", 3)
        await page.evaluate("T.H.UI.modal = null; T.H.CAM.mode = 'play'")

        # ---- priest: pillar of dawn and mass renewal ----
        r = await ev(page, 'priest', """(() => { const P = T.fresh('priest', 35); const H = T.H, F = T.F;
          const fx = Math.sin(P.yaw), fz = Math.cos(P.yaw);
          const foe = T.foe(1, P.x + fx * 14, P.z + fz * 14, 33); foe.maxHp *= 4; foe.hp = foe.maxHp;
          const ally = T.foe(0, P.x + fx * 13 + 1.5, P.z + fz * 13 - 1.0, 33); ally.hp = ally.maxHp * 0.4;
          const near = T.foe(0, P.x + 3, P.z + 2, 33); near.hp = near.maxHp * 0.5;
          P.target = foe.id; const fh0 = foe.hp, ah0 = ally.hp;
          F.useAbility(P, 'pillar', foe); H.simulate(2.4);
          const pillar = { foe: Math.round(fh0 - foe.hp), ally: Math.round(ally.hp - ah0), pillars: H.SPELL.pillars.filter((p) => p.on).length };
          P.cds = {}; P.power = P.maxPower; P.gcdUntil = 0; P.hp = P.maxHp * 0.6;
          F.useAbility(P, 'massrenew', null); H.simulate(0.2);
          const hots = [P, near].map((u) => u.buffs.some((b) => b.kind === 'hot'));
          return { pillar, hots }; })()""")
        check(r['pillar']['foe'] > 0 and r['pillar']['ally'] > 0, 'pillar of dawn burns the foe and mends the friend')
        check(all(r['hots']), 'mass renewal settles on you and those near')
        await shot(page, 'l50_pillar', """(() => { const H = T.H, F = T.F, P = H.GAME.player; const t = F.getEnt(P.target); P.cds = {}; P.power = P.maxPower; P.gcdUntil = 0;
          F.useAbility(P, 'pillar', t); H.simulate(1.7); H.UI.modal = null; for (let i = 0; i < 8; i++) H.frame(1 / 30); H.UI.modal = 'menu'; H.CAM.mode = 'fixed';
          const c = Math.cos(P.yaw), s = Math.sin(P.yaw); H.camera.position.set(P.x - s * 2 + c * 4, P.y + 3.0, P.z - c * 2 - s * 4); H.camera.lookAt(t.x, t.y + 4, t.z); })()""", 2)
        await page.evaluate("T.H.UI.modal = null; T.H.CAM.mode = 'play'")

        # ---- the hotbar: eight slots and rank marks ----
        r = await ev(page, 'hotbar', """(() => { const slots = document.querySelectorAll('#hotbar .slot:not(.potion)'), tp = document.querySelectorAll('#tpad .slot:not(.potion)');
          return { bar: slots.length, pad: tp.length, ranks: document.querySelectorAll('#hotbar .slot .rk').length, tip: slots[7].querySelector('.tip').textContent.slice(0, 160) }; })()""")
        check(r['bar'] == 8 and r['pad'] == 8 and r['ranks'] == 8, 'eight slots, all marked rank II at 35')
        if SHOTS:
            await page.evaluate("T.H.UI.modal = null; T.H.CAM.mode = 'play'; T.H.look(T.H.GAME.player.yaw, 0.25, 7)")
            await frames(page, 3)
            await page.screenshot(path=str(OUT) + '/l50_hud.png', timeout=300000)

        errs = await page.evaluate("__hm.errors")
        print('errors', errs[:3])
        check(not errs, 'no runtime errors')
        print('logs', logs[:4])
        print('FAILED:' if FAILS else 'ALL PASSED', FAILS)
        await b.close()
asyncio.run(main())
