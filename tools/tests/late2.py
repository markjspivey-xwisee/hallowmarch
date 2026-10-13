"""[late2] The late game (version 16): the risen of the borderlands past 40, deeds and the names they earn, veterancy past
the cap and its boons, the Chronicle's Deeds page, the aims and the tracker's mark, and the save (with the character, an old
save's deeds taken from its path, a damaged one, and a reload with the same storage).
usage: python3 tools/tests/late2.py [only=rise,wrath,fight,names,vet,page,std,herald,save,reload,shots] [cls=warrior,mage|all] [realm=0|1|2] [q=low|high]
       [noshots] [phone] [small] [shots=wrath_day,standard_day,...]"""
import json, asyncio, sys, pathlib, time
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
from hmlib import setup, OUT
from playwright.async_api import async_playwright

ARGS = dict(a.split('=', 1) for a in sys.argv[1:] if '=' in a)
FLAGS = set(a for a in sys.argv[1:] if '=' not in a)
ONLY = set(ARGS['only'].split(',')) if 'only' in ARGS else None
CLS = ['warrior', 'archer', 'mage', 'priest'] if ARGS.get('cls') == 'all' else ARGS.get('cls', 'warrior,mage').split(',')
SHOTS = 'noshots' not in FLAGS
REALM = int(ARGS.get('realm', 0))
REALM_NAMES = ['Logres', 'Eriu', 'Thule']
Q = ARGS.get('q', 'low')
FAILS = []
T0 = time.time()

def want(k): return ONLY is None or k in ONLY

def check(cond, what):
    print(('  ok   ' if cond else '  FAIL ') + what, flush=True)
    if not cond: FAILS.append(what)

async def ev(page, label, js):
    r = await page.evaluate(js)
    print(label, json.dumps(r)[:1800], flush=True)
    return r

HELPERS = r"""
window.T = {
  H: __hm, F: __hm.fn, L: __hm.late,
  fresh(cls, lvl, realm = 0) {
    const H = this.H, F = this.F;
    if (H.GAME.player) F.newCharacter();
    H.start({ realm, cls, level: lvl });
    const P = H.GAME.player;
    H.bal.applyFairGear(P, lvl); P.hp = P.maxHp; P.power = P.maxPower;
    H.simulate(0.3); // (the late game's watcher has had its first look: an older character's deeds are taken from its path)
    return P;
  },
  risen() { return this.H.CAMPS.filter((c) => this.L.late2RiseK(c) >= 0); },
  campInfo(c) { const e = this.F.getEnt(c.eliteId); const mem = [...c.members].map((id) => this.F.getEnt(id)).filter((m) => m && m.alive && !m.elite).map((m) => m.level);
    return { id: c.id, realm: c.realm, type: c.type, band: c.lmin + '-' + c.lmax, k: this.L.late2RiseK(c), risen: this.L.late2Risen(c), champ: e && e.alive ? [e.name, e.level, !!e.l2risen, Math.round(e.maxHp)] : null, members: mem }; },
  clearAround(x, z, r, keep) { for (const e of this.H.ENT) if (e.alive && e.role !== 'player' && e.kind !== 'door' && !(keep && keep.has(e.id)) && Math.hypot(e.x - x, e.z - z) < r) { e.damagers = null; this.F.killEnt(e, null); this.F.removeEnt(e); } },
};
"""

async def frames(page, n=3):
    for _ in range(n): await page.evaluate("__hm.frame(1/30)")

SHOT_ONLY = set(ARGS['shots'].split(',')) if 'shots' in ARGS else None

async def shot(page, name, w=None, h=None):
    if not SHOTS: return
    if SHOT_ONLY is not None and not any(name.startswith(k) for k in SHOT_ONLY): return
    # (the Chronicle's page fades in on the wall clock: a loaded machine took the picture before it had)
    try: await page.wait_for_function("[...document.querySelectorAll('.chron-body')].every((b) => b.getAnimations().every((a) => a.playState === 'finished'))", timeout=20000, polling=200)
    except Exception: pass
    await page.screenshot(path=str(OUT) + '/late2_' + name + '.png', timeout=300000)
    print('  shot late2_' + name, f'[{time.time() - T0:.0f}s]', flush=True)

async def main():
    phone = 'phone' in FLAGS
    async with async_playwright() as p:
        small = 'small' in FLAGS  # (pictures at 640x360: under SwiftShader on a loaded machine one at 960x540 and high quality ran past five minutes)
        b, page, logs = await setup(p, touch=phone, w=390 if phone else 640 if small else 960, h=780 if phone else 360 if small else 540)
        await page.evaluate(f"__hm.fn.setQuality('{Q}')")
        await page.evaluate("() => {" + HELPERS + "; return 0; }")
        print(f'booted [{time.time() - T0:.0f}s]', flush=True)

        # ---- the risen of the borderlands: none under 40, nine from 40, keeping pace to 50 ----
        if want('rise') or want('fight') or want('shots'):
            r = await ev(page, 'at 39', "(() => { const P = T.fresh('warrior', 39); return { war: T.F.warLevel(), camps: T.risen().map((c) => T.campInfo(c)) }; })()")
            check(len(r['camps']) == 9 and all(c['k'] in (0, 1, 2) for c in r['camps']), 'nine camps can rise: the three farthest of each homeland')
            check(not any(c['risen'] or (c['champ'] and c['champ'][2]) for c in r['camps']), 'at 39 none has risen')
            names39 = [c['champ'][0] for c in r['camps'] if c['champ']]
            r = await ev(page, 'to 40', """(() => { const H = T.H, P = H.GAME.player, n0 = T.L.LATE2.stats.camps; H.fn.addXP(Math.round(55 * Math.pow(39, 1.55) + 40) - H.GAME.prog.xp); const lv = H.GAME.prog.level;
              return { lv, war: T.F.warLevel(), retaken: T.L.LATE2.stats.camps - n0, camps: T.risen().map((c) => T.campInfo(c)), others: H.CAMPS.filter((c) => c.elite && T.L.late2RiseK(c) < 0).map((c) => T.campInfo(c)).slice(0, 4) }; })()""")
            lv = r['lv']
            check(lv >= 40 and r['retaken'] == 9, f"at level {lv} the nine camps are taken by the risen ({r['retaken']} retaken)")
            ok = all(c['risen'] and c['champ'] and c['champ'][2] and c['champ'][1] == lv + 1 + c['k'] and all(lv - 4 + c['k'] <= m <= lv - 1 + c['k'] for m in c['members']) for c in r['camps'])
            check(ok, 'each led by a risen champion one to three levels above you, its camp a few round yours')
            check(all(c['champ'][0] not in names39 for c in r['camps']), 'the risen have names of their own')
            check(all(c['champ'] and not c['champ'][2] for c in r['others']), 'the nearer borderland camps keep their champions')
            r = await ev(page, 'at 50', "(() => { const P = T.fresh('warrior', 50); return { camps: T.risen().map((c) => T.campInfo(c)) }; })()")
            check(all(c['champ'] and c['champ'][1] == 51 + c['k'] for c in r['camps']), 'a level 50 meets risen champions of 51 to 53')
            r = await ev(page, 'back to 30', "(() => { const P = T.fresh('mage', 30); return { camps: T.risen().map((c) => T.campInfo(c)) }; })()")
            check(all(not c['risen'] and c['champ'] and not c['champ'][2] for c in r['camps']), 'a new character of 30 finds the old champions again')

        # ---- a fight: each calling at 50 in fair gear, played by the skilled bot, against a risen camp ----
        if want('fight'):
            for cls in CLS:
                r = await ev(page, f'fight {cls} of {REALM_NAMES[REALM]}', """((cls, realm) => { const P = T.fresh(cls, 50, realm), H = T.H, F = T.F, L = T.L.LATE2, prog = H.GAME.prog;
                  const camp = T.risen().filter((c) => c.realm === P.faction).sort((a, b) => T.L.late2RiseK(b) - T.L.late2RiseK(a))[0];
                  let C = F.getEnt(camp.eliteId); if (!C || !C.alive) { F.spawnMob(camp, true); C = F.getEnt(camp.eliteId); }
                  const keep = new Set(camp.members); T.clearAround(camp.x, camp.z, 60, keep);
                  const a = Math.random() * 6.28; H.teleport(C.x + Math.cos(a) * 16, C.z + Math.sin(a) * 16);
                  H.INV.potions = 3; P.hp = P.maxHp; P.power = P.maxPower; P.buffs.length = 0;
                  const s0 = { ...L.stats }, d0 = { ...L.d }, vx0 = L.vxp + T.L.late2VetNeed(0) * L.vet, loot0 = H.LOOT.length + H.INV.bag.length, tr0 = F.goodsCount('trophy'), rp0 = prog.rp;
                  H.bal.botMake(P, 'skilled', { x: camp.x, z: camp.z, r: 32 }); P.target = C.id;
                  const foes = new Set(camp.members); let t = 0, champT = null, minHp = 1;
                  for (; t < 180 && P.alive; t += 1) { H.simulate(1); minHp = Math.min(minHp, P.hp / P.maxHp); for (const id of camp.members) foes.add(id);
                    if (!C.alive && champT == null) champT = t;
                    if (!P.target || !F.getEnt(P.target) || !F.getEnt(P.target).alive) { const n = [...foes].map(F.getEnt).filter((e) => e && e.alive && Math.hypot(e.x - P.x, e.z - P.z) < 40)[0]; if (n) P.target = n.id; else if (!C.alive) break; } }
                  P.bot = null;
                  const vx1 = L.vxp + T.L.late2VetNeed(0) * L.vet;
                  return { cls, champ: C.name, clvl: C.level, champHp: Math.round(C.maxHp), php: Math.round(P.maxHp), champT, t, alive: P.alive, minHp: +minHp.toFixed(2), left: +(P.hp / P.maxHp).toFixed(2), potions: H.INV.potions,
                    wrath: L.stats.wrath - s0.wrath, hits: L.stats.wrathHits - s0.wrathHits, kinds: (L.stats.kinds || 0) - (s0.kinds || 0), broken: (L.stats.broken || 0) - (s0.broken || 0), rallies: L.stats.rallies - s0.rallies, fell: L.stats.risenFell - s0.risenFell,
                    high: L.d.high - d0.high, champD: L.d.champ - d0.champ, vetXP: vx1 - vx0, rp: Math.round(prog.rp - rp0), drops: H.LOOT.length + H.INV.bag.length - loot0, trophies: F.goodsCount('trophy') + H.LOOT.filter((q) => q.item && q.item.goods === 'trophy').length - tr0, foes: foes.size, errors: H.errors.length }; })('""" + cls + "', " + str(REALM) + ")")
                won = r['champT'] is not None and r['alive']
                check(won, f"a level 50 {cls} (skilled) brings down {r['champ']} ({r['clvl']}) in {r['champT']} s, {r['minHp']*100:.0f}% health at the lowest, {r['potions']} draughts left")
                check(r['rallies'] == 1 and (r['wrath'] + r['kinds'] + r['broken'] >= 1 or cls == 'archer'), f"it broke the ground {r['wrath']} times ({r['hits']} struck, {r['broken']} broken off; a foe that keeps it off may never see it), went its own way {r['kinds']} times and rallied its pack once")
                if won:
                    check(r['high'] == 1 and r['champD'] == 1 and r['fell'] == 1, 'the deed is told: one risen, one champion')
                    check(r['vetXP'] > 12000 and r['rp'] >= 250 and r['drops'] >= 3 and r['trophies'] >= 2, f"its spoils: {r['vetXP']} experience to veterancy, {r['rp']} realm points, {r['drops']} pieces of gear and other things, {r['trophies']} trophies")
                check(r['errors'] == 0, 'no errors in the fight')

        # ---- a risen champion's ways, by number: the ring and its blow, a stun that breaks it off, each kind its own ----
        if want('wrath'):
            r = await ev(page, 'wrath', """(() => { const P = T.fresh('warrior', 50), H = T.H, F = T.F, L = T.L, St = L.LATE2.stats;
              const camp = T.risen().find((c) => c.realm === 0 && c.type === 'bandit'); let C = F.getEnt(camp.eliteId); if (!C || !C.alive) { F.spawnMob(camp, true); C = F.getEnt(camp.eliteId); }
              const keep = new Set(camp.members); T.clearAround(camp.x, camp.z, 60, keep); for (const id of camp.members) { const m = F.getEnt(id); if (m && m !== C) { m.damagers = null; F.killEnt(m, null); F.removeEnt(m); } }
              H.bal6.cleanArena(camp.x, camp.z, 45, new Set()); // (what the fights before left about the camp: runes, snares, ice, fire; after them the champion here once never thought through the scene)
              const place = () => { H.teleport(C.x + 3, C.z + 2); P.hp = P.maxHp; P.buffs.length = 0; C.buffs.length = 0; C.ccdr = null; C.target = P.id; C.threat = new Map([[P.id, 99]]); };
              const out = {}; place();
              // the blow lands on a foe that stays in the ring
              C.ai.l2 = { next: 0, next2: 1e9, rally: true, enr: false, w: null, last: H.GAME.t }; const w0 = St.wrath, h0 = St.wrathHits, hp0 = P.hp;
              L.late2ChampThink(C, P, 0.05); out.started = !!C.ai.l2.w; H.simulate(1.6); out.landed = St.wrath - w0; out.hit = St.wrathHits - h0; out.stunned = !!P.buffs.find((b) => b.kind === 'stun'); out.harm = Math.round(hp0 - P.hp);
              // a stun as it rears breaks the blow off
              place(); C.ai.l2 = { next: 0, next2: 1e9, rally: true, enr: false, w: null, last: H.GAME.t }; const w1 = St.wrath, b1 = St.broken || 0;
              L.late2ChampThink(C, P, 0.05); H.simulate(0.4); F.addBuff(C, 'stun', 1, 1.2, P.id); H.simulate(1.6); out.broken = (St.broken || 0) - b1; out.landed2 = St.wrath - w1;
              // each kind its own way: an outlaw's hamstring on its foe beside it
              place(); H.teleport(C.x + 1.4, C.z + 0.9); C.ai.l2 = { next: 1e9, next2: 0, rally: true, enr: false, w: null, last: H.GAME.t }; const k0 = St.kinds || 0; P.buffs.length = 0;
              L.late2ChampThink(C, P, 0.05); out.kind = (St.kinds || 0) - k0; out.wound = !!P.buffs.find((b) => b.kind === 'wound'); out.snare = !!P.buffs.find((b) => b.kind === 'snare');
              out.errors = H.errors.slice(0, 3); return out; })()""")
            check(r['started'] and r['landed'] == 1 and r['hit'] == 1 and r['stunned'] and r['harm'] > 0, f"the ring glows and the blow lands on a foe in it: {r['harm']} harm and a stun")
            check(r['broken'] == 1 and r['landed2'] == 0, 'a stun as it rears breaks the blow off')
            check(r['kind'] == 1 and r['wound'] and r['snare'], 'an outlaw hamstrings its foe: slowed and wounded')
            r = await ev(page, 'kinds', """(() => { const H = T.H, F = T.F, L = T.L, P = H.GAME.player, out = {};
              for (const [type, realm, d] of [['bear', 1, 8], ['skeleton', 0, 10], ['troll', 2, 12], ['wisp', 1, 3]]) {
                const camp = T.risen().find((c) => c.type === type && c.realm === realm); let C = F.getEnt(camp.eliteId); if (!C || !C.alive) { F.spawnMob(camp, true); C = F.getEnt(camp.eliteId); }
                let tx = C.x + d, tz = C.z; for (let a = 0; a < 6.28 && !F.isWalkable(tx, tz); a += 0.4) { tx = C.x + Math.cos(a) * d; tz = C.z + Math.sin(a) * d; }
                H.teleport(tx, tz); H.simulate(0.05); P.hp = P.maxHp; P.buffs.length = 0; P.ccdr = null; C.target = P.id; // (a step, so the grid finds you where you stand)
                const n0 = camp.members.size, x0 = C.x, z0 = C.z, hp0 = P.hp, did = L.late2KindMove(C, P, Math.hypot(P.x - C.x, P.z - C.z));
                const o = { did, members: camp.members.size - n0, moved: +Math.hypot(C.x - x0, C.z - z0).toFixed(1), snare: !!P.buffs.find((b) => b.kind === 'snare') };
                if (type === 'bear') o.pack = [...camp.members].map(F.getEnt).filter((m) => m && m !== C && m.alive && m.buffs.some((b) => b.kind === 'dmg')).length;
                if (type === 'troll') { H.simulate(1.3); o.stun = !!P.buffs.find((b) => b.kind === 'stun'); o.harm = Math.round(hp0 - P.hp); }
                out[type] = o;
              }
              out.errors = H.errors.slice(0, 3); return out; })()""")
            check(r['bear']['did'] and r['bear']['snare'] and r['bear'].get('pack', 0) >= 1, f"a beast howls: its foe slowed, its pack's blood up ({r['bear']})")
            check(r['skeleton']['did'] and 1 <= r['skeleton']['members'] <= 2, f"the dead call the dead up about their foe ({r['skeleton']})")
            check(r['troll']['did'] and r['troll'].get('stun') and r['troll'].get('harm', 0) > 0, f"a troll's stone-burst under a foe that keeps off ({r['troll']})")
            check(r['wisp']['did'] and r['wisp']['moved'] >= 4, f"a wisp slips away from a blade at its side ({r['wisp']})")

        # ---- deeds and names ----
        if want('names'):
            r = await ev(page, 'blooded', """(() => { const P = T.fresh('warrior', 45), H = T.H, F = T.F, L = T.L, prog = H.GAME.prog;
              const n0 = L.LATE2.names.length; prog.realmKills = 24; const rp0 = prog.rp;
              const foe = F.spawnRealmUnit(1, 'warrior', 40, 'soldier', P.x + 3, P.z + 3); foe.damagers = new Map([[P.id, 1]]); F.killEnt(foe, P); H.simulate(0.3);
              return { names: L.LATE2.names.slice(), worn: L.LATE2.worn, named: L.late2Named(P), rp: Math.round(prog.rp - rp0), foes: prog.realmKills,
                frame: document.getElementById('pf-name').textContent, k: +L.late2HarmMult(P, F.spawnRealmUnit(2, 'warrior', 45, 'soldier', P.x + 5, P.z), {}).toFixed(3),
                kSelf: +L.late2HarmMult(P, H.ENT.find((e) => e.alive && e.faction === H.FACTION_MONSTER) || P, {}).toFixed(3) }; })()""")
            check(r['names'] == ['blooded'] and r['worn'] == 'blooded', 'twenty-five soldiers of the enemy realms: the Blooded, worn at once')
            check(r['named'].endswith(' the Blooded') and r['rp'] >= 150, f"the March names you \"{r['named']}\", and pays {r['rp']} realm points")
            check(r['k'] == 1.02 and r['kSelf'] == 1.0, f"wearing it you strike enemy soldiers 2% harder ({r['k']}) and nothing else ({r['kSelf']})")
            await frames(page, 2)
            r = await ev(page, 'frame', "(() => document.getElementById('pf-name').textContent)()")
            check(r.endswith('the Blooded'), f'the name shows on your frame: "{r}"')
            r = await ev(page, 'king and dragon', """(() => { const H = T.H, F = T.F, L = T.L, P = H.GAME.player;
              L.late2Deed('king'); L.late2Deed('dragon');
              const out = { names: L.LATE2.names.slice(), worn: L.LATE2.worn };
              out.wearK = L.late2Wear('kingsbane'); const sk = F.spawnMob(H.CAMPS.find((c) => c.type === 'skeleton'));
              out.dead = +L.late2HarmMult(P, sk, {}).toFixed(3); out.fireBefore = +L.late2HarmMult(sk, P, { kind: 'fire' }).toFixed(3);
              L.late2Wear('dragonfoe'); out.fire = +L.late2HarmMult(sk, P, { kind: 'fire' }).toFixed(3); out.melee = +L.late2HarmMult(sk, P, { kind: 'melee' }).toFixed(3);
              out.notEarned = L.late2Wear('victor'); out.wornAfter = L.LATE2.worn; L.late2Wear(null); out.plain = L.late2Named(P) === P.name;
              sk.damagers = null; F.killEnt(sk, null); F.removeEnt(sk); return out; })()""")
            check(set(r['names']) >= {'blooded', 'kingsbane', 'dragonfoe'}, 'the Hollow King and Cinderwing each earn a name')
            check(r['wearK'] and r['dead'] == 1.08 and r['fireBefore'] == 1.0, f"Kingsbane: the dead struck 8% harder ({r['dead']}), fire as before ({r['fireBefore']})")
            check(r['fire'] == 0.85 and r['melee'] == 1.0, f"Dragonfoe: fire harms you 15% less ({r['fire']}), a blade as before ({r['melee']})")
            check(not r['notEarned'] and r['wornAfter'] == 'dragonfoe' and r['plain'], 'a name not earned cannot be worn; going by your own name')
            r = await ev(page, 'champions and keeps', """(() => { const H = T.H, F = T.F, L = T.L, P = H.GAME.player, prog = H.GAME.prog;
              const c = H.CAMPS.find((q) => q.elite && T.L.late2RiseK(q) < 0); let e = F.getEnt(c.eliteId); if (!e || !e.alive) { F.spawnMob(c, true); e = F.getEnt(c.eliteId); }
              const d0 = L.LATE2.d.champ; e.damagers = new Map([[P.id, 1]]); F.killEnt(e, P); const one = L.LATE2.d.champ - d0;
              for (let i = 0; i < 4; i++) L.late2Deed('champ');
              const g0 = L.LATE2.names.includes('gatebreaker'); for (let i = 0; i < 3; i++) L.late2Deed('keep');
              L.late2Wear('gatebreaker'); const gate = H.WAR.keeps[0].door;
              return { one, champbane: L.LATE2.names.includes('champbane'), g0, gate: +L.late2HarmMult(P, gate, {}).toFixed(3), next: (L.late2NextName() || {}).id, aims: H.guide.guideAims().map((a) => a.t) }; })()""")
            check(r['one'] == 1 and r['champbane'], 'a borderland champion is a deed; five of them earn Championsbane')
            check(not r['g0'] and r['gate'] == 1.15, f"three keeps taken: Gatebreaker, and gates struck 15% harder ({r['gate']})")
            check(any(a.startswith('Earn a name') for a in r['aims']), f"the aims name the next name to earn ({r['next']})")
            r = await ev(page, 'realm ranks', """(() => { const H = T.H, F = T.F, L = T.L, P = H.GAME.player, prog = H.GAME.prog;
              F.addRP(52000 - prog.rp); H.simulate(0.3); const out = { rr: L.LATE2.names.filter((id) => /^rr/.test(id)) };
              L.late2Wear('rr6'); out.gift = +(1 - L.LATE2_NAMES.find((N) => N.id === 'rr6').k.giftCd).toFixed(2); out.cdK = +L.late2GiftCdK().toFixed(2);
              L.late2Wear('rr8'); out.named = L.late2Named(P);
              const s = F.spawnRealmUnit(P.faction, 'warrior', 45, 'soldier', P.x + 4, P.z + 2); s.ai.post = { x: s.x, z: s.z, leash: 1 }; H.simulate(1.3);
              out.aura = s.buffs.some((b) => b.kind === 'dmg' && b.src === 'l2aura'); s.damagers = null; F.killEnt(s, null); F.removeEnt(s);
              L.late2Wear('rr12'); const foe = F.spawnMob(H.CAMPS[0]); out.all = +L.late2HarmMult(P, foe, {}).toFixed(3); foe.damagers = null; F.killEnt(foe, null); F.removeEnt(foe);
              return out; })()""")
            check(r['rr'] == ['rr6', 'rr8', 'rr10', 'rr12'], f"realm ranks past the great gift earn the realm's own names: {r['rr']}")
            check(r['cdK'] == 0.85, f"Champion of the realm: the great gift comes round 15% sooner ({r['cdK']})")
            check(r['named'].endswith(', Marshal of Logres') and r['aura'], f"\"{r['named']}\": soldiers of your realm about you strike harder")
            check(r['all'] == 1.03, f"Sword of the realm: everything struck 3% harder ({r['all']})")

        # ---- veterancy and boons ----
        if want('vet'):
            r = await ev(page, 'veterancy', """(() => { const P = T.fresh('priest', 50), H = T.H, F = T.F, L = T.L, prog = H.GAME.prog; const need = L.late2VetNeed(0);
              const hp0 = P.maxHp, xp0 = prog.xp; F.addXP(need + 120);
              const out = { vet: L.LATE2.vet, vxp: L.LATE2.vxp, level: prog.level, xp: prog.xp, free: L.late2Free(), bar: L.late2XpBar(), need0: need, need1: L.late2VetNeed(1), aims: H.guide.guideAims().map((a) => a.t).slice(0, 3) };
              out.learn = L.late2Learn('hide'); out.hp = +(P.maxHp / hp0).toFixed(4); out.again = L.late2Learn('edge'); out.free2 = L.late2Free();
              F.addXP(L.late2VetNeed(1) + L.late2VetNeed(2) + L.late2VetNeed(3)); out.vet2 = L.LATE2.vet;
              for (let i = 0; i < 6; i++) L.late2Learn('hide'); out.hideSteps = L.LATE2.boons.hide; L.late2Learn('campaigner'); L.late2Learn('edge');
              const foe = F.spawnRealmUnit(1, 'warrior', 50, 'soldier', P.x + 4, P.z); out.edge = +L.late2HarmMult(P, foe, {}).toFixed(3); out.rpK = +L.late2RpMult().toFixed(3);
              foe.damagers = null; F.killEnt(foe, null); F.removeEnt(foe);
              H.INV.gold = 100; out.forgetPoor = L.late2Forget(); H.INV.gold = 5000; out.forget = L.late2Forget(); out.afterForget = { spent: L.late2Spent(), free: L.late2Free(), gold: H.INV.gold, hp: +(P.maxHp / hp0).toFixed(4) };
              return out; })()""")
            check(r['level'] == 50 and r['vet'] == 1 and r['vxp'] == 120 and r['free'] == 1, f"at 50 experience raises veterancy: rank {r['vet']}, {r['vxp']} toward the next ({r['need1']})")
            check(r['bar'][1].startswith('Veterancy 1') and 0 < r['bar'][0] < 0.05, f"the experience bar says so: {r['bar'][1]}")
            check(any('boon' in a for a in r['aims']), f"the aims say a boon waits: {r['aims']}")
            check(r['learn'] and r['hp'] == 1.01 and not r['again'] and r['free2'] == 0, 'Iron hide: 1% more health; no second boon without a second rank')
            check(r['vet2'] == 4 and r['hideSteps'] == 4, f"three more ranks, three more steps ({r['hideSteps']} of five learned)")
            check(r['edge'] == 1.0 and r['rpK'] == 1.0, 'with every rank spent nothing more is learned')
            check(not r['forgetPoor'] and r['forget'] and r['afterForget']['spent'] == 0 and r['afterForget']['free'] == 4 and r['afterForget']['gold'] == 3500 and r['afterForget']['hp'] == 1.0, f"unlearning costs 1,500 gold and gives every rank back: {r['afterForget']}")
            r = await ev(page, 'frame at 50', """(() => { T.H.frame(1/30); return { xpt: document.getElementById('pf-xpt').textContent }; })()""")
            check(r['xpt'].startswith('Veterancy 4'), f"the frame's bar: {r['xpt']}")

        # ---- the Deeds page: names, boons and the risen, worn and learned by a click (or a tap) ----
        if want('page'):
            r = await ev(page, 'page', """(() => { const P = T.fresh('archer', 50), H = T.H, F = T.F, L = T.L; H.GAME.prog.realmKills = 300; L.late2CheckNames(true); L.late2Deed('king'); F.addXP(L.late2VetNeed(0) + 5);
              H.LORE.openChronicle('deeds'); const body = document.getElementById('menu-body');
              const btns = [...body.querySelectorAll('[data-l2]')].map((b) => b.dataset.l2);
              const tall = body.querySelector('.chron-body').scrollHeight, wide = body.querySelector('.chron-body').scrollWidth > body.querySelector('.chron-body').clientWidth + 1;
              return { btns, worn: L.LATE2.worn, tall, wide, text: body.textContent.length, open: H.UI.modal }; })()""")
            check(r['open'] == 'menu' and 'wear:reaver' in r['btns'] and 'boon:hide' in r['btns'], f"the Deeds page offers the names to wear and the boons to learn ({len(r['btns'])} buttons)")
            check(not r['wide'], f"nothing wider than the page ({r['tall']} px tall)")
            # a click (or a tap on a phone) on Wear and on Learn
            for sel, label in [('[data-l2="wear:reaver"]', 'wear'), ('[data-l2="boon:eye"]', 'learn')]:
                box = await page.evaluate(f"""(() => {{ const el = document.querySelector('#menu-body {sel}'); if (!el) return null; el.scrollIntoView({{ block: 'center' }}); const r = el.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2, r.width, r.height]; }})()""")
                if box is None: check(False, f'{label}: its button is on the page'); continue
                check(box[3] >= 40 or not phone, f'{label}: its button is {box[2]:.0f} x {box[3]:.0f} px')
                if phone: await page.touchscreen.tap(box[0], box[1])
                else: await page.mouse.click(box[0], box[1])
                await page.wait_for_timeout(400)
            r = await ev(page, 'after', "(() => ({ worn: T.L.LATE2.worn, eye: T.L.LATE2.boons.eye || 0, crit: +(T.H.GAME.player.critBonus || 0).toFixed(3), errors: T.H.errors.slice(0, 3) }))()")
            check(r['worn'] == 'reaver' and r['eye'] == 1, f"by {'tap' if phone else 'click'}: wearing the Reaver, Steady eye learned (crit {r['crit']})")
            await page.evaluate("document.querySelector('#menu .sheet').scrollTop = 0")
            await shot(page, ('phone_' if phone else 'desk_') + 'deeds')
            await page.evaluate("(() => { const el = [...document.querySelectorAll('#menu-body h3')].find((h) => /Veterancy/.test(h.textContent)); if (el) { const d = el.closest('details'); if (d) d.open = true; el.scrollIntoView({ block: 'start' }); } })()")
            await shot(page, ('phone_' if phone else 'desk_') + 'veterancy')
            await page.evaluate("T.H.UI.modal = null; document.getElementById('menu').hidden = true;")

        # ---- the standard of your name: made, planted, rallying, taken up ----
        if want('std'):
            r = await ev(page, 'standard', """(() => { const P = T.fresh('warrior', 45), H = T.H, F = T.F, L = T.L, S = L.LATE2;
              const out = { okBefore: L.late2StdMake() };
              H.GAME.prog.realmKills = 30; H.simulate(0.3); H.INV.gold = 2500;
              out.made = L.late2StdMake(); out.gold = H.INV.gold; out.again = L.late2StdMake();
              // open ground: a meadow of the homeland, away from the town
              const R = H.REALMS[0]; let spot = null;
              for (let i = 0; i < 400 && !spot; i++) { const a = i * 2.399, d = 60 + (i % 20) * 6, x = R.town.x + Math.sin(a) * d, z = R.town.z - Math.cos(a) * d;
                if (!F.isWalkable(x, z) || H.water.waterAt(x, z) || (i < 300 && F.W.trees.some((t) => !t.gone && !t.felled && Math.hypot(t.x - x, t.z - z) < 11))) continue; H.teleport(x, z); P.yaw = a; if (L.late2StdSpot(P)) spot = { x, z }; } // (open meadow first, for the pictures)
              out.spot = !!spot; T.clearAround(P.x, P.z, 40);
              out.planted = L.late2StdPlant(); const at = S.std.at; out.at = at;
              out.mesh = at ? +Math.hypot(L.L2STD.mesh.position.x - at.x, L.L2STD.mesh.position.z - at.z).toFixed(2) : null;
              out.meshY = at ? +(L.L2STD.mesh.position.y - F.heightAt(at.x, at.z)).toFixed(2) : null;
              out.coll = !!(L.L2STD.coll && L.L2STD.coll.active);
              const near = F.spawnRealmUnit(0, 'warrior', 45, 'soldier', at.x + 6, at.z + 2), far = F.spawnRealmUnit(0, 'warrior', 45, 'soldier', at.x + 26, at.z), foe = F.spawnRealmUnit(1, 'warrior', 45, 'soldier', at.x - 5, at.z + 1);
              for (const e of [near, far, foe]) { e.ai.post = { x: e.x, z: e.z, leash: 2 }; }
              foe.faction = 1; H.simulate(1.3);
              const has = (e) => e.buffs.some((b) => b.kind === 'dmg' && b.src === 'l2std');
              out.buff = { you: has(P), near: has(near), far: has(far), foe: has(foe) };
              H.teleport(at.x + 1.2, at.z + 0.6); H.simulate(0.2); out.label = F.currentInteraction ? (F.currentInteraction() || {}).label : null;
              const save = F.buildSave().char.x.late; out.save = { sm: save.sm, sp: save.sp };
              out.taken = L.late2StdTake(); out.after = { at: S.std.at, meshY: L.L2STD.mesh.position.y, coll: !!(L.L2STD.coll && L.L2STD.coll.active) };
              F.savePartsLoad('char', { late: save }); out.loaded = { at: S.std.at, meshOk: !!S.std.at && Math.hypot(L.L2STD.mesh.position.x - S.std.at.x, L.L2STD.mesh.position.z - S.std.at.z) < 0.01 };
              F.savePartsLoad('char', { late: { ...save, sp: [99999, 3] } }); out.badSp = S.std.at; T.stdSave = save;
              for (const e of [near, far, foe]) { e.damagers = null; F.killEnt(e, null); F.removeEnt(e); }
              out.errors = H.errors.slice(0, 3); return out; })()""")
            check(not r['okBefore'] and r['made'] and r['gold'] == 1500 and not r['again'], 'with a name and 1,000 gold the standard is made, once')
            check(r['spot'] and r['planted'] and r['mesh'] == 0 and -0.2 < r['meshY'] < 0.05 and r['coll'], f"planted on open ground, its pole standing on it ({r['meshY']} m) with a collider")
            check(r['buff']['you'] and r['buff']['near'] and not r['buff']['far'] and not r['buff']['foe'], f"you and your realm's soldier beside it strike harder; one 26 m off and a foe do not ({r['buff']})")
            check(r['label'] == 'Take up your standard', f"Use beside it offers to take it up ({r['label']})")
            check(r['save']['sm'] == 1 and r['save']['sp'] and r['taken'] and r['after']['at'] is None and r['after']['meshY'] < -900 and not r['after']['coll'], 'saved where it stands; taken up, it is gone from the land')
            check(r['loaded']['at'] and r['loaded']['meshOk'] and r['badSp'] is None, 'loaded, it stands again where it was; a place off the map is dropped')
            if SHOTS:
                await page.evaluate("""(() => { const H = T.H, F = T.F, L = T.L, P = H.GAME.player; F.savePartsLoad('char', { late: T.stdSave }); const at = L.LATE2.std.at; if (!at) return 0; H.setTod(0.42); document.getElementById('hud').hidden = true;
                  H.teleport(at.x + 2.2, at.z + 1.5); P.yaw = Math.atan2(at.x - P.x, at.z - P.z); H.simulate(0.5); H.UI.modal = 'menu'; H.CAM.mode = 'fixed';
                  H.camera.position.set(at.x + 5.5, F.heightAt(at.x, at.z) + 2.6, at.z + 4.2); H.camera.lookAt(at.x, F.heightAt(at.x, at.z) + 2.2, at.z); return 0; })()""")
                await frames(page, 3)
                await shot(page, f'standard_day_{Q}')
                await page.evaluate("(() => { T.H.setTod(2.1); return 0; })()")
                await frames(page, 3)
                await shot(page, f'standard_night_{Q}')
                await page.evaluate("(() => { const H = T.H; H.UI.modal = null; H.CAM.mode = 'play'; document.getElementById('hud').hidden = false; return 0; })()")

        # ---- the herald's bounty on a risen champion, and the March hailing you by your name ----
        if want('herald'):
            r = await ev(page, 'herald', """(() => { const P = T.fresh('archer', 46), H = T.H, F = T.F, L = T.L, prog = H.GAME.prog;
              const out = {}; const o = L.late2HeraldBounty(); out.offered = !!o; if (!o) return out;
              o.accept(); const b = prog.bounty; out.bounty = { name: b.name, camp: b.camp, risen: b.risen, need: b.need };
              const camp = H.CAMPS[b.camp], other = T.risen().find((c) => c !== camp && c.realm === P.faction);
              const kill = (c) => { let C = F.getEnt(c.eliteId); if (!C || !C.alive) { F.spawnMob(c, true); C = F.getEnt(c.eliteId); } C.damagers = new Map([[P.id, 1]]); F.killEnt(C, P); };
              kill(other); out.afterOther = !!b.done;
              kill(camp); out.afterOwn = !!b.done;
              out.saved = (F.buildSave().char.bounty || {}).risen;
              // hailed by name: a soldier of your realm beside you, out of a fight
              prog.realmKills = 30; H.simulate(0.3); L.late2Wear('blooded');
              // out in the homeland's fields, nobody about (townsfolk hailed you a second time), a guard of your realm beside you
              const R = H.REALMS[P.faction];
              for (let i = 0; i < 300; i++) { const a = i * 2.399, d = 80 + (i % 12) * 7, x = R.town.x + Math.sin(a) * d, z = R.town.z - Math.cos(a) * d;
                if (!F.isWalkable(x, z) || H.water.waterAt(x, z) || H.ENT.some((e) => e.alive && e !== P && e.kind !== 'door' && Math.hypot(e.x - x, e.z - z) < 16)) continue; H.teleport(x, z); break; }
              H.simulate(0.1);
              const s = F.spawnRealmUnit(P.faction, 'warrior', 45, 'guard', P.x + 3, P.z + 1); s.ai.post = { x: s.x, z: s.z, leash: 1 };
              H.simulate(0.05); s.target = null; s.threat = null; s.l2hailT = 0; out.near = [+Math.hypot(s.x - P.x, s.z - P.z).toFixed(1), s.alive, s.faction, P.faction, s.role, L.LATE2.worn, P.alive]; // (a step, so the grid finds the guard where it stands)
              P.combatUntil = -100; L.LATE2.w.hailT = 0; const h0 = L.LATE2.stats.hails || 0; // (out of a fight these six seconds: the clock of a game just begun is under 6)
              out.dbg = { t: +H.GAME.t.toFixed(1), cu: P.combatUntil, ht: L.LATE2.w.hailT, worn: L.LATE2.worn, isP: P === H.GAME.player, near: H.ENT.filter((o) => o !== P && Math.hypot(o.x - P.x, o.z - P.z) < 7).map((o) => [o.role, o.faction, !!o.target, o.l2hailT || 0, o.alive, +Math.hypot(o.x - P.x, o.z - P.z).toFixed(1)]) };
              L.late2Hail(P); out.hails = (L.LATE2.stats.hails || 0) - h0;
              L.LATE2.w.hailT = 0; L.late2Hail(P); out.again = (L.LATE2.stats.hails || 0) - h0; // (once in ten minutes a body)
              s.damagers = null; F.killEnt(s, null); F.removeEnt(s);
              out.errors = H.errors.slice(0, 3); return out; })()""")
            check(r['offered'] and r['bounty']['risen'] == 1 and r['bounty']['need'] == 1, f"past 40 the herald offers a risen champion's bounty: {r.get('bounty')}")
            check(not r['afterOther'] and r['afterOwn'] and r['saved'] == 1, 'another risen champion does not pay it; its own does, and the bounty is saved as a risen one')
            check(r['hails'] == 1 and r['again'] == 1, f"a soldier of your realm beside you hails you by your name, once ({r.get('hails')}, {r.get('again')}, the guard {r.get('near')}, {r.get('dbg')})")

        # ---- the save ----
        if want('save') or want('reload'):
            r = await ev(page, 'save', """(() => { const P = T.fresh('mage', 50), H = T.H, F = T.F, L = T.L, prog = H.GAME.prog;
              prog.realmKills = 260; L.late2CheckNames(true); L.late2Deed('high'); L.late2Deed('high'); L.late2Deed('high'); F.addXP(L.late2VetNeed(0) + L.late2VetNeed(1) + 777); L.late2Learn('wells'); L.late2Learn('skin'); L.late2Wear('wastebane');
              const s = F.buildSave(), x = s.char.x.late; const keep = JSON.stringify(x);
              // a scramble, then the part read back
              L.LATE2.names = []; L.LATE2.vet = 0; L.LATE2.boons = {}; L.LATE2.worn = null; L.LATE2.d.high = 0;
              F.savePartsLoad('char', JSON.parse(JSON.stringify(s.char.x)));
              const back = { names: L.LATE2.names.slice().sort(), worn: L.LATE2.worn, vet: L.LATE2.vet, vxp: L.LATE2.vxp, boons: { ...L.LATE2.boons }, high: L.LATE2.d.high };
              // a damaged part
              F.savePartsLoad('char', { late: { v: 1, d: { champ: 'x', high: -4, king: 1e12 }, n: ['nope', 5, 'kingsbane', 'kingsbane'], w: 'victor', vt: 'q', vx: -9, b: { hide: 99, edge: 2 }, s: 1 } });
              const bad = { d: { ...L.LATE2.d }, names: L.LATE2.names.slice(), worn: L.LATE2.worn, vet: L.LATE2.vet, vxp: L.LATE2.vxp, boons: { ...L.LATE2.boons } };
              F.savePartsLoad('char', { late: [1, 2, 3] }); const arr = { vet: L.LATE2.vet, names: L.LATE2.names.length };
              // an old save: no part at all, the deeds taken from its path once
              F.savePartsLoad('char', {}); prog.lore.done.push('king', 'dragon', 'champion'); const before = L.LATE2.names.slice(); L.LATE2.w.t = 0; L.updateLate2(0.3);
              const old = { seeded: L.LATE2.seeded, names: L.LATE2.names.slice().sort(), d: { ...L.LATE2.d } };
              return { size: keep.length, x, back, bad, arr, before, old, errors: H.errors.slice(0, 3) }; })()""")
            b2 = r['back']
            check(b2['vet'] == 2 and b2['vxp'] == 777 and b2['boons'] == {'wells': 1, 'skin': 1} and b2['worn'] == 'wastebane' and b2['high'] == 3 and 'reaver' in b2['names'] and 'wastebane' in b2['names'], f"the part reads back whole ({r['size']} bytes): {b2}")
            bd = r['bad']
            check(bd['d']['champ'] == 0 and bd['d']['high'] == 0 and bd['d']['king'] == 10000000 and bd['names'] == ['kingsbane'] and bd['worn'] is None and bd['vet'] == 0 and bd['vxp'] == 0 and bd['boons'] == {}, f'a damaged part is made sane: {bd}')
            check(r['arr']['vet'] == 0 and r['arr']['names'] == 0, 'a part that is not a record is dropped')
            check(r['old']['seeded'] and set(r['old']['names']) >= {'kingsbane', 'dragonfoe'} and r['old']['d']['champ'] >= 1, f"an older character's deeds are taken from its path: {r['old']}")
            check(not r['errors'], 'no errors')
        if want('reload'):
            await page.evaluate("""(() => { const H = T.H, F = T.F, L = T.L; const P = T.fresh('warrior', 50); H.GAME.prog.realmKills = 30; L.late2CheckNames(true); L.late2Deed('king'); F.addXP(L.late2VetNeed(0) + 1234); L.late2Learn('edge'); L.late2Wear('kingsbane'); F.saveNow(); return 0; })()""")
            await page.wait_for_timeout(1500)
            stored = await page.evaluate("(localStorage.getItem('hallowmarch.save.v1') || '').length")
            await page.goto('http://hm.test/', wait_until='commit', timeout=300000)
            await page.wait_for_function("window.__hm && window.__hm.ready", timeout=240000, polling=500)
            await page.evaluate("__hm.fn.setQuality('low')")
            await page.evaluate("() => {" + HELPERS + "; return 0; }")
            r = await ev(page, 'continued', """(() => { document.getElementById('btn-continue').click(); const H = T.H, L = T.L; H.simulate(1); H.frame(1/30);
              return { started: H.GAME.started, lvl: H.GAME.prog && H.GAME.prog.level, names: L.LATE2.names.slice().sort(), worn: L.LATE2.worn, vet: L.LATE2.vet, vxp: L.LATE2.vxp, edge: L.LATE2.boons.edge, frame: document.getElementById('pf-name').textContent, xpt: document.getElementById('pf-xpt').textContent,
                risen: T.risen().filter((c) => T.L.late2Risen(c)).length, errors: H.errors.slice(0, 3) }; })()""")
            check(r['started'] and r['lvl'] == 50 and r['vet'] == 1 and r['vxp'] == 1234 and r['edge'] == 1 and r['worn'] == 'kingsbane' and set(r['names']) >= {'blooded', 'kingsbane'}, f"reloaded ({stored} bytes stored): the character continues with its names, veterancy and boons")
            check(r['frame'].endswith('Kingsbane') and r['xpt'].startswith('Veterancy 1') and r['risen'] == 9, f"\"{r['frame']}\", \"{r['xpt']}\", the risen up ({r['risen']})")
            check(not r['errors'], 'no errors after the reload')

        # ---- pictures: a risen champion's warning ring and its blow, by day and by night ----
        if want('shots') and SHOTS:
            r = await ev(page, 'scene', """(() => { const P = T.fresh('warrior', 50), H = T.H, F = T.F, L = T.L;
              const camp = T.risen().filter((c) => c.realm === 0 && c.type === 'bandit')[0] || T.risen()[0];
              let C = F.getEnt(camp.eliteId); if (!C || !C.alive) { F.spawnMob(camp, true); C = F.getEnt(camp.eliteId); }
              H.bal6.cleanArena(camp.x, camp.z, 45, new Set()); T.camp = camp.id; T.C = C.id; H.teleport(C.x + 3.2, C.z + 2.4); P.hp = P.maxHp;
              H.simulate(1.5); return { name: C.name, lvl: C.level, type: camp.type }; })()""")
            for tod, label in [(0.45, "day"), (2.1, "night")]:
                await page.evaluate(f"""(() => {{ const H = T.H, F = T.F, P = H.GAME.player, C = F.getEnt(T.C); if (!C || !C.alive) return 0; H.setTod({tod});
                  C.ai.l2 = null; C.target = P.id; C.threat = new Map([[P.id, 50]]); P.hp = P.maxHp; H.teleport(C.x + 3.2, C.z + 2.4);
                  const S = C.ai.l2 = {{ next: 0, rally: true, enr: false, w: null, last: H.GAME.t }}; T.L.late2ChampThink(C, P, 0.05); H.simulate(0.8);
                  document.getElementById('hud').hidden = true; T.camA = Math.atan2(P.x - C.x, P.z - C.z) + 0.9; T.cam = () => {{ const C2 = F.getEnt(T.C); H.UI.modal = 'menu'; H.CAM.mode = 'fixed'; H.camera.position.set(C2.x + Math.sin(T.camA) * 9.5, C2.y + 4.6, C2.z + Math.cos(T.camA) * 9.5); H.camera.lookAt(C2.x, C2.y + 1.1, C2.z); }}; T.cam(); return 0; }})()""")
                await frames(page, 3)
                await shot(page, f'wrath_{label}_{Q}')
                await page.evaluate("(() => { T.H.simulate(0.75); T.cam(); return 0; })()")
                await frames(page, 2)
                await shot(page, f'wrath_blow_{label}_{Q}')
            await page.evaluate("(() => { const H = T.H; H.UI.modal = null; H.CAM.mode = 'play'; document.getElementById('hud').hidden = false; return 0; })()")

        errs = await page.evaluate("__hm.errors.slice(0, 5)")
        check(not errs, f'no runtime errors ({errs})')
        for l in logs[-6:]: print(l)
        await b.close()
    print(f'late2: {len(FAILS)} failed [{time.time() - T0:.0f}s]' + (': ' + '; '.join(FAILS) if FAILS else ''), flush=True)
    sys.exit(1 if FAILS else 0)

asyncio.run(main())
