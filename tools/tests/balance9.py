"""[balance9] The rules of version 18 for the callings and the late game's foes, checked by number (07c_balance9.js).
usage: python3 tools/tests/balance9.py
  blunt:    a blunt head from a quick shot or a bow not fully drawn sets a spell back, from a full draw, an Aimed Shot or
            Deadeye it breaks it; a steadfast priest keeps its spell from it
  steady:   until Divine Shield is learned a priest's spell begun steadfast waits through a Shield Bash's stun and goes on
            after (heals when it ends); unsteadied, or once Divine Shield is learned, the bash breaks it
  bots:     a priest bot (the measures' fighters) comes with no devotion at any hour; a war priest with its 20 to 50
  mace:     a skilled priest bot of rank I holds its mace from a warrior's guard unless the warrior stands dazzled for more
            than half a second more
  measures: the wound of a bow of rank II, the priests' realm ways, Vorlach's holy light, the troll's stone-burst ring
  texts:    the tooltips, the Callings page and the Deep's page say the rules
The page's own frame loop stops while it measures (nothing is drawn)."""
import json, asyncio, sys, pathlib
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from hmlib import setup
from playwright.async_api import async_playwright
from classes import MECH_JS

FAILS = []
def check(cond, what):
    print(('  ok   ' if cond else '  FAIL ') + what, flush=True)
    if not cond: FAILS.append(what)

async def ev(page, label, js):
    r = await page.evaluate(js)
    print(label, json.dumps(r)[:1500], flush=True)
    return r

async def main():
    async with async_playwright() as p:
        b, page, logs = await setup(p, w=640, h=360)
        await page.evaluate("window.requestAnimationFrame = () => 0; 0")
        await page.evaluate("() => {" + MECH_JS + "; return 0; }")

        r = await ev(page, 'blunt', """(() => { const H = T.H, F = T.F; const P = T.fresh('archer', 30, 0);
          const a = T.ahead(P, 12); const pr = T.foe(1, a.x, a.z, 30, 'priest', 0); pr.ai.nextAbility = 1e9; pr.swingAt = 1e9; H.simulate(0.1);
          const out = {};
          const shot = (name, opts, steady) => {
            pr.buffs = pr.buffs.filter((q) => q.kind !== 'steadfast'); if (steady) F.addBuff(pr, 'steadfast', 1, 4, 'steadfast');
            pr.casting = { id: 'mend', t: 0.9, total: 1.5, targetId: pr.id, gx: pr.x, gz: pr.z }; pr.hp = pr.maxHp;
            F.dealDamage(P, pr, 5, { kind: 'arrow', arrow: 'blunt', ...opts });
            out[name] = pr.casting ? +pr.casting.t.toFixed(2) : 'broken';
          };
          shot('quick', { ability: 'quickshot' }); shot('cripple', { ability: 'cripple' }); shot('half', { drawn: 0.6 });
          shot('full', { drawn: 1 }); shot('aimed', { ability: 'aimed' }); shot('deadeye', { ability: 'deadeye' }); shot('steadyFull', { drawn: 1 }, true);
          pr.casting = null; out.stats = H.bal9.BAL9.stats; return out; })()""")
        check(r['quick'] == 0.55 and r['cripple'] == 0.55 and r['half'] == 0.55, f"a blunt head from a quick shot, a crippling arrow or a bow not fully drawn sets the spell back 0.35 s ({r['quick']}, {r['cripple']}, {r['half']})")
        check(r['full'] == 'broken' and r['aimed'] == 'broken' and r['deadeye'] == 'broken', f"from a full draw, an Aimed Shot or Deadeye it breaks the spell ({r['full']}, {r['aimed']}, {r['deadeye']})")
        check(r['steadyFull'] != 'broken', f"a steadfast priest keeps its spell from a full draw's blunt head ({r['steadyFull']})")

        r = await ev(page, 'steady', """(() => { const H = T.H, F = T.F; const out = {};
          for (const [k, pl, steady] of [['l10', 10, true], ['l10bare', 10, false], ['l20', 20, true]]) {
            const P = T.fresh('warrior', pl, 0); const a = T.ahead(P, 2.2); const pr = T.foe(1, a.x, a.z, pl, 'priest', 0); pr.ai.nextAbility = 1e9; pr.swingAt = 1e9;
            H.simulate(0.1); pr.hp = pr.maxHp * 0.4; pr.power = pr.maxPower;
            if (steady) F.addBuff(pr, 'steadfast', 1, 4, 'steadfast');
            pr.casting = { id: 'mend', t: 0.5, total: 1.5, targetId: pr.id, gx: pr.x, gz: pr.z };
            P.target = pr.id; P.cds = {}; P.gcdUntil = 0; P.power = P.maxPower; P.yaw = Math.atan2(pr.x - P.x, pr.z - P.z);
            const why = F.useAbility(P, 'bash', pr); H.simulate(0.3);
            const stunned = F.hasBuff(pr, 'stun'), kept = !!pr.casting, t0 = pr.casting ? +pr.casting.t.toFixed(2) : null;
            H.simulate(0.8); const t1 = pr.casting ? +pr.casting.t.toFixed(2) : null; // still stunned: it waits
            const hp0 = pr.hp; H.simulate(2.2); const healed = pr.hp - hp0;
            out[k] = { why, stunned, kept, t0, t1, done: !pr.casting, healed: Math.round(healed), steadyLeft: F.hasBuff(pr, 'steadfast') };
            P.hp = P.maxHp;
          }
          return out; })()""")
        q = r['l10']
        check(q['why'] is True and q['stunned'] and q['kept'] and q['t0'] == q['t1'], f"a priest of 10 steadied keeps its Mend through a Shield Bash: it waits while stunned ({q})")
        check(q['done'] and q['healed'] > 0, f"and goes on after: its Mend lands ({q['healed']} health)")
        check(not r['l10bare']['kept'], f"unsteadied, the bash breaks its spell ({r['l10bare']})")
        check(not r['l20']['kept'], f"once Divine Shield is learned (14), a stun breaks a steadied spell as before ({r['l20']})")

        r = await ev(page, 'bots', """(() => { const H = T.H, F = T.F; const P = T.fresh('warrior', 20, 0); const a = T.ahead(P, 30);
          const bot = F.spawnRealmUnit(0, 'priest', 20, 'bot', a.x, a.z), war = F.spawnRealmUnit(0, 'priest', 20, 'guard', a.x + 3, a.z);
          const out = { t: Math.round(H.GAME.t), bot: Math.round(H.cls.csOf(bot).dev), war: Math.round(H.cls.devOf(war)) };
          for (const e of [bot, war]) { e.damagers = null; F.killEnt(e, null); F.removeEnt(e); }
          return out; })()""")
        check(r['bot'] == 0 and 20 <= r['war'] <= 50, f"a priest bot comes with no devotion at any hour, a war priest with its 20 to 50 ({r})")

        r = await ev(page, 'mace', """(() => { const H = T.H, F = T.F; const P = T.fresh('warrior', 10, 0); const a = T.ahead(P, 2.2);
          const pr = T.foe(1, a.x, a.z, 10, 'priest', 0); H.bal.botMake(pr, 'skilled', { x: a.x, z: a.z, r: 18 }); pr.target = P.id;
          const hold = () => H.bal9.priestMaceHold(pr);
          const out = { bare: hold() };
          F.addBuff(P, 'dazzle', 0.15, 2, 'test'); out.dazzled = hold();
          P.buffs.find((q) => q.kind === 'dazzle').until = H.GAME.t + 0.3; out.fading = hold();
          P.buffs = P.buffs.filter((q) => q.kind !== 'dazzle');
          const pr2 = T.foe(1, a.x, a.z + 3, 30, 'priest', 0); H.bal.botMake(pr2, 'skilled', { x: a.x, z: a.z, r: 18 }); pr2.target = P.id; out.rank2 = H.bal9.priestMaceHold(pr2);
          return out; })()""")
        check(r['bare'] and not r['dazzled'] and r['fading'] and not r['rank2'], f"a skilled priest of rank I holds its mace from a warrior's guard unless it stands dazzled for more than half a second more; from rank II it swings ({r})")

        r = await ev(page, 'measures', """(() => { const H = T.H, B9 = H.bal9; return {
          wound1: H.bal.woundOf({ level: 10 }), wound2: H.bal.woundOf({ level: 30 }), realm: H.bal4.PRIEST_REALM,
          lord: B9.lordHolyK({ deepLord: true }), dead: B9.lordHolyK({ mobType: 'skeleton' }), noDazzle: B9.lordNoDazzle({ deepLord: true }), dazzleDead: B9.lordNoDazzle({ mobType: 'skeleton' }), burst: B9.B9T.burstRing, steady: B9.B9T.steadyStun }; })()""")
        check(r['wound1'] == 0.3 and abs(r['wound2'] - 0.22) < 1e-9, f"a bow's wound takes 30% off healing at rank I, 22% from rank II ({r['wound1']}, {r['wound2']})")
        check(r['realm']['logresBless'] == 0.96 and r['realm']['logresGround'] == 0.96 and abs(r['realm']['eriuHot'] - 0.016) < 1e-9, f"the priests' realm ways: the Shield of Logres 4% and 4%, the Well of Ériu 1.6% a second ({r['realm']})")
        check(r['lord'] < r['dead'] and r['dead'] == 1.6, f"holy light strikes the dead 1.6 times as hard, Vorlach {r['lord']} times ({r['lord']}, {r['dead']})")
        check(r['noDazzle'] and not r['dazzleDead'], "and it does not dazzle him (the rest of the dead it does)")

        r = await ev(page, 'texts', """(() => { const H = T.H; H.LORE.openChronicle('callings'); const txt = document.body.textContent; const A = H.bal5.ABILITIES;
          H.LORE.openChronicle('deep'); const deep = document.body.textContent; // (textContent: a folded section's words are still in the page, not in innerText) H.UI.modal = 'menu';
          return { blunt: H.cls.ARROW_DEF.blunt.text, broad: H.cls.ARROW_DEF.broadhead.text, renew: A.renew.desc, cripple: A.cripple.desc,
            page: { full: txt.includes('from a full draw, an Aimed Shot or Deadeye'), steady: txt.includes('waits through a stun'), wound: txt.includes('22% from a bow of rank II'), realm: txt.includes('4% less harm') },
            deep: deep.includes('crown of ash') }; })()""")
        check('full draw' in r['blunt'] and 'quick shot' in r['blunt'], f"the blunt head's text says it ({r['blunt'][:120]})")
        check('Divine Shield' in r['renew'] and 'waits through a stun' in r['renew'], f"Renewal's tooltip says a steadied spell waits through a stun ({r['renew'][-160:]})")
        check('22% from a bow of rank II' in r['broad'] and '22% from a bow of rank II' in r['cripple'], "the broadhead's and Crippling Arrow's texts say the wound by rank")
        check(all(r['page'].values()), f"the Callings page says the rules ({r['page']})")
        check(r['deep'], "the Deep's page says the Ash-Crowned's crown of ash turns holy light")

        errs = await page.evaluate("__hm.errors.slice(0, 5)")
        check(not errs, f"no runtime errors ({errs})")
        await b.close()
    print('FAILS', len(FAILS), flush=True)
    for f in FAILS: print('  -', f)
    sys.exit(1 if FAILS else 0)

asyncio.run(main())
