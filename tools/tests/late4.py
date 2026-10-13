"""[late4] The late game alive (version 18): the risen move and look as what they are (body actions 20 and 22 on the beast
rig, measured as bodies; a second move for each kind from the rally; the marks of a risen champion), the roaming risen of
the borderlands past 40 (a host a homeland on its tracks, fighting what it meets, a deed, saved with the world), the
standard of your name as a veteran's (a long swallow-tailed flag on a taller pole, torn as it is struck), and the deep
remembering (its dead, slabs, pitch and water saved and restored as they lay) with an air of its own.
usage: python3 tools/tests/late4.py [only=marks,windup,motion,second,host,std,deep,air,reload,shots] [q=low|high] [noshots]
       [shots=bear,wolf,boar,bandit,host,std_day,std_night,std_rain,deep] [w=960 h=540] [phone]"""
import json, asyncio, sys, pathlib, time
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
from hmlib import setup, OUT
from playwright.async_api import async_playwright

ARGS = dict(a.split('=', 1) for a in sys.argv[1:] if '=' in a)
FLAGS = set(a for a in sys.argv[1:] if '=' not in a)
ONLY = set(ARGS['only'].split(',')) if 'only' in ARGS else None
SHOTS = 'noshots' not in FLAGS
SHOT_ONLY = set(ARGS['shots'].split(',')) if 'shots' in ARGS else None
Q = ARGS.get('q', 'low')
FAILS = []
T0 = time.time()

def want(k): return ONLY is None or k in ONLY

def check(cond, what):
    print(('  ok   ' if cond else '  FAIL ') + what, flush=True)
    if not cond: FAILS.append(what)

async def ev(page, label, js):
    r = await page.evaluate(js)
    print(label, json.dumps(r)[:2000], flush=True)
    return r

HELPERS = r"""
window.T4 = {
  H: __hm, F: __hm.fn, L: __hm.late, X: __hm.late4,
  fresh(cls, lvl, realm = 0) {
    const H = this.H, F = this.F;
    if (H.GAME.player) F.newCharacter();
    H.start({ realm, cls, level: lvl });
    const P = H.GAME.player;
    H.bal.applyFairGear(P, Math.min(50, lvl)); P.hp = P.maxHp; P.power = P.maxPower;
    H.simulate(0.3);
    return P;
  },
  risen() { return this.H.CAMPS.filter((c) => this.L.late2RiseK(c) >= 0); },
  champ(type, realm, fresh) {
    const F = this.F, camp = this.risen().find((c) => c.type === type && (realm == null || c.realm === realm)) || this.H.CAMPS.find((c) => c.elite && c.type === type && (realm == null || c.realm === realm));
    if (!camp) return null;
    let C = F.getEnt(camp.eliteId);
    if (fresh && C) { camp.members.delete(C.id); C.alive = false; C.damagers = null; F.removeEnt(C); C = null; camp.eliteId = null; } // (a calm one at its camp: one that fought walks with its feet held where it stepped)
    if (!C || !C.alive) { F.spawnMob(camp, true); C = F.getEnt(camp.eliteId); }
    return { camp, C };
  },
  clearAround(x, z, r, keep) { for (const e of this.H.ENT) if (e.alive && e.role !== 'player' && e.kind !== 'door' && !(keep && keep.has(e.id)) && Math.hypot(e.x - x, e.z - z) < r) { e.damagers = null; this.F.killEnt(e, null); this.F.removeEnt(e); } },
  // a spot on walkable ground about (x, z) at about distance d
  spot(x, z, d) { for (let a = 0; a < 6.28; a += 0.3) { const tx = x + Math.cos(a) * d, tz = z + Math.sin(a) * d; if (this.F.isWalkable(tx, tz)) return [tx, tz]; } return [x + d, z]; },
  safe() { const P = this.H.GAME.player; if (!P.alive) { P.alive = true; P.removeAt = 0; } P.hp = P.maxHp; P.power = P.maxPower; P.buffs.length = 0; return 0; },
};
0;
"""

async def frames(page, n=3):
    for _ in range(n): await page.evaluate("__hm.frame(1/30)")

async def shot(page, name):
    if not SHOTS: return
    if SHOT_ONLY is not None and not any(name.startswith(k) for k in SHOT_ONLY): return
    await page.evaluate("__hm.frame(1/30); 0")
    await page.screenshot(path=str(OUT) + '/late4_' + name + '.png', timeout=300000)
    print('  shot late4_' + name, f'[{time.time() - T0:.0f}s]', flush=True)

async def main():
    phone = 'phone' in FLAGS
    async with async_playwright() as p:
        W, Hh = (390, 780) if phone else (int(ARGS.get('w', 640)), int(ARGS.get('h', 360)))
        b, page, logs = await setup(p, touch=phone, w=W, h=Hh)
        await page.evaluate(f"__hm.fn.setQuality('{Q}')")
        await page.evaluate(HELPERS)
        print(f'booted [{time.time() - T0:.0f}s]', flush=True)

        # ---- the marks of a risen champion ----
        if want('marks'):
            r = await ev(page, 'marks', """(() => { const P = T4.fresh('warrior', 50), H = T4.H, X = T4.X, out = {};
              for (const [type, realm] of [['bear', 1], ['bandit', 0], ['skeleton', 0], ['wolf', 1], ['troll', 2]]) {
                const R = T4.champ(type, realm); if (!R) { out[type] = null; continue; }
                const C = R.C; out[type] = { risen: !!C.l2risen, marked: X.LATE4.marked.has(C), flags: C.look.flags || 0, g: C.look.colB ? +C.look.colB[1].toFixed(2) : null };
              }
              // its name in ember on its plate, and read from farther
              const R = T4.champ('bandit', 0), C = R.C; const [qx, qz] = T4.spot(C.x, C.z, 40); H.teleport(qx, qz); P.yaw = Math.atan2(C.x - P.x, C.z - P.z); H.CAM.yaw = P.yaw; for (let i = 0; i < 12; i++) { H.simulate(0.05); P.yaw = Math.atan2(C.x - P.x, C.z - P.z); H.CAM.yaw = P.yaw; H.frame(1/30); }
              const el = [...document.querySelectorAll('#nameplates .np')].find((n) => n.style.display !== 'none' && n._eid === C.id);
              out.plate = el ? { risen: el.classList.contains('risen'), text: el.textContent } : null;
              out.errors = H.errors.slice(0, 3); return out; })()""")
            check(r['bear'] and r['bear']['marked'] and r['bear']['g'] >= 4, f"a risen bear is marked: 4 above its second colour's green ({r['bear']})")
            check(r['bandit'] and r['bandit']['marked'] and (r['bandit']['flags'] & 512), f"a risen outlaw is marked: flag 512 for the people's shader ({r['bandit']})")
            check(r['skeleton'] and (r['skeleton']['flags'] & 512) and r['wolf'] and r['wolf']['g'] >= 4 and r['troll'] and (r['troll']['flags'] & 512), 'the dead, the wolves and the trolls marked too')
            check(r['plate'] and r['plate']['risen'], f"its name in ember on its plate at 40 m ({r['plate']})")
            check(not r['errors'], f"no errors ({r['errors']})")

        # ---- the wind-ups ----
        if want('windup'):
            r = await ev(page, 'windup', """(() => { const P = T4.fresh('warrior', 50), H = T4.H, F = T4.F, L = T4.L, X = T4.X, out = {};
              for (const [type, realm] of [['bear', 1], ['wolf', 1], ['boar', 1], ['bandit', 0], ['troll', 2]]) {
                const R = T4.champ(type, realm); if (!R) { out[type] = null; continue; }
                const C = R.C; T4.clearAround(C.x, C.z, 30, new Set([C.id]));
                H.teleport(C.x + 2.5, C.z + 1); H.simulate(0.05); T4.safe(); C.buffs.length = 0; C.target = P.id; C.threat = new Map([[P.id, 99]]);
                C.ai.l2 = { next: 0, next2: 1e9, rally: true, enr: false, w: null, last: H.GAME.t };
                L.late2ChampThink(C, P, 0.05);
                const o = { started: !!C.ai.l2.w, act: C.anim.act, dur: +C.anim.actDur.toFixed(2) };
                H.simulate(0.5); o.actMid = C.anim.act; o.frac = +(C.anim.actT / Math.max(0.01, C.anim.actDur)).toFixed(2);
                // a stun as it rears breaks it, and the body comes down at once
                F.addBuff(C, 'stun', 1, 1.0, P.id); H.simulate(0.2); o.brokenFrac = +(C.anim.actT / Math.max(0.01, C.anim.actDur)).toFixed(2); o.brokenAct = C.anim.act;
                H.simulate(1.5); C.buffs.length = 0;
                out[type] = o;
              }
              out.errors = H.errors.slice(0, 3); return out; })()""")
            check(r['bear'] and r['bear']['started'] and r['bear']['act'] == 20, f"a risen bear rears for its blow: body action 20 ({r['bear']})")
            check(r['wolf'] and r['wolf']['act'] == 22 and r['boar'] and r['boar']['act'] == 22, f"a risen wolf and boar crouch to spring: body action 22 ({r['wolf']}, {r['boar']})")
            check(r['bandit'] and r['bandit']['act'] == 8 and r['troll'] and r['troll']['act'] == 8, 'a humanoid raises its weapon overhead (8) as before')
            check(r['bear'] and (r['bear']['brokenAct'] != 20 or r['bear']['brokenFrac'] >= 0.77), f"a stun as it rears sends it down at once ({r['bear']})")
            check(not r['errors'], f"no errors ({r['errors']})")

        # ---- the wind-ups as bodies: feet planted, the bear's forepaws up ----
        if want('motion'):
            r = await ev(page, 'motion', """(() => { const P = T4.fresh('warrior', 50), H = T4.H, F = T4.F, M = H.motion, out = {};
              H.fn.setQuality('low');
              for (const [type, realm, act, dur] of [['bear', 1, 20, 1.6], ['wolf', 1, 22, 1.6], ['boar', 1, 22, 1.6]]) {
                const R = T4.champ(type, realm, true); if (!R) { out[type] = null; continue; }
                const C = R.C; T4.clearAround(C.x, C.z, 40, new Set([C.id]));
                C.ai.tameHold = H.GAME.t + 999; C.target = null; C.threat = null; C.buffs.length = 0; // (it thinks nothing: the action alone)
                const [px, pz] = T4.spot(C.x, C.z, 30); H.teleport(px, pz); H.simulate(1.0); C.ai.tameHold = H.GAME.t + 999;
                H.UI.modal = 'menu'; H.CAM.mode = 'fixed'; H.camera.position.set(C.x + 6, C.y + 2.5, C.z + 6); H.camera.lookAt(C.x, C.y + 0.8, C.z); H.camera.updateMatrixWorld();
                let started = false;
                const rec = M.motionRun([{ e: C, kind: 'beast', which: ['feet'], drive: (e, t) => { if (t >= 0.3 && !started) { started = true; T4.X.setAct(e, act, dur); } e.ai.tameHold = H.GAME.t + 999; } }], 0.3 + dur + 0.4, 1 / 60, { cam: () => { H.UI.modal = 'menu'; H.CAM.mode = 'fixed'; } })[0];
                // each foot: how far it moves over the ground while it is down; the highest it rises; the body's place still
                const feet = [0, 1, 2, 3].map((f) => { let lo = null, slide = 0, rise = 0, n = 0; const S = rec.filter((s) => s.L && s.L.feet && s.L.feet[f]);
                  const g0 = S.length ? S[0].L.feet[f] : null;
                  for (const s of S) { const p = s.L.feet[f], fl = H.fn.heightAt(p[0], p[2]), h = p[3] - fl; rise = Math.max(rise, h); if (h < 0.04) { n++; if (!lo) lo = p; slide = Math.max(slide, Math.hypot(p[0] - lo[0], p[2] - lo[2])); } }
                  const last = S.length ? S[S.length - 1].L.feet[f] : null;
                  return { slideCm: +(slide * 100).toFixed(1), riseCm: +(rise * 100).toFixed(0), back: g0 && last ? +(Math.hypot(last[0] - g0[0], last[2] - g0[2]) * 100).toFixed(1) : null, down: n };
                });
                const xs = rec.map((s) => Math.hypot(s.x - rec[0].x, s.z - rec[0].z));
                out[type] = { seen: rec.filter((s) => s.L).length, n: rec.length, feet, bodyMoved: +(Math.max(...xs) * 100).toFixed(1), amt: +Math.max(...rec.map((s) => s.amt || 0)).toFixed(3) };
                C.ai.tameHold = 0;
              }
              H.UI.modal = null; H.CAM.mode = 'play';
              out.errors = H.errors.slice(0, 3); return out; })()""")
            for k in ('bear', 'wolf', 'boar'):
                o = r.get(k)
                if not o: check(False, f'{k}: no champion'); continue
                print(f'  {k}: ' + ' | '.join(f"foot {i}: slide {f['slideCm']} cm, up {f['riseCm']} cm, end {f['back']} cm" for i, f in enumerate(o['feet'])), flush=True)
                check(o['seen'] > o['n'] * 0.9, f'{k}: the probe found the body every frame ({o["seen"]} of {o["n"]})')
            b = r.get('bear')
            if b:
                check(all(f['slideCm'] <= 2.0 for f in b['feet'][2:]), 'a rearing bear\'s hind feet stay where they stand (2 cm at most)')
                check(all(f['riseCm'] >= 40 for f in b['feet'][:2]), 'its forepaws rise 40 cm and more as it rears')
                check(all(f['back'] is not None and f['back'] <= 3.0 for f in b['feet']), 'and come down where they stood (3 cm)')
            for k in ('wolf', 'boar'):
                o = r.get(k)
                if o: check(all(f['slideCm'] <= 2.0 and f['riseCm'] <= 6 for f in o['feet']), f'a crouching {k}\'s four feet stay planted (2 cm at most, none lifted)')
            check(not r['errors'], f"no errors ({r['errors']})")

        # ---- the second moves ----
        if want('second'):
            r = await ev(page, 'second', """(() => { const P = T4.fresh('warrior', 50), H = T4.H, F = T4.F, L = T4.L, X = T4.X, St = X.LATE4.stats, out = {};
              for (const [type, realm, d, wait] of [['bear', 1, 2.6, 1.2], ['wolf', 1, 10, 2.0], ['boar', 1, 10, 2.4], ['skeleton', 0, 8, 1.6], ['bandit', 0, 12, 1.5], ['troll', 2, 15, 2.0], ['wisp', 1, 12, 2.6]]) {
                const R = T4.champ(type, realm); if (!R) { out[type] = null; continue; }
                const C = R.C; T4.clearAround(C.x, C.z, 40, new Set([C.id]));
                const [tx, tz] = T4.spot(C.x, C.z, d); H.teleport(tx, tz); H.simulate(0.05); T4.safe(); P.ccdr = null; C.buffs.length = 0; C.target = P.id; C.threat = new Map([[P.id, 99]]); C.motion = null;
                const by0 = St.by[X.LATE4_SECOND[type]] || 0, hp0 = P.hp, x0 = P.x, z0 = P.z, cx0 = C.x, cz0 = C.z;
                C.ai.l2 = { next: 1e9, next2: 1e9, next3: 0, rally: true, enr: false, w: null, last: H.GAME.t };
                const did = X.late4Second(C, P, Math.hypot(P.x - C.x, P.z - C.z));
                const o = { did, n: (St.by[X.LATE4_SECOND[type]] || 0) - by0 };
                const seen = new Set(); let moved = 0, cmoved = 0;
                for (let k = 0; k < Math.round(wait / 0.1); k++) { H.simulate(0.1); for (const b of P.buffs) seen.add(b.kind); moved = Math.max(moved, Math.hypot(P.x - x0, P.z - z0)); cmoved = Math.max(cmoved, Math.hypot(C.x - cx0, C.z - cz0)); }
                o.harm = Math.round(hp0 - P.hp); o.moved = +moved.toFixed(1); o.cmoved = +cmoved.toFixed(1);
                o.buffs = [...seen];
                out[type] = o; T4.safe();
              }
              out.errors = H.errors.slice(0, 3); return out; })()""")
            for k, need in (('bear', 'wound'), ('wolf', 'stun'), ('boar', 'stun'), ('skeleton', 'root'), ('bandit', 'burn'), ('troll', 'stun'), ('wisp', 'snare')):
                o = r.get(k)
                check(o and o['did'] and o['n'] == 1 and o['harm'] > 0 and need in o['buffs'], f"{k}'s second move lands on a foe that stands in it: {o}")
            check(r['wolf'] and r['wolf']['cmoved'] >= 4, 'the wolf pounces across the gap')
            check(r['boar'] and r['boar']['cmoved'] >= 4, 'the boar charges down its line')
            check(r['wisp'] and r['wisp']['moved'] >= 2, 'the wisp draws its foe to it')
            check(not r['errors'], f"no errors ({r['errors']})")

        # ---- the roaming risen ----
        if want('host'):
            r = await ev(page, 'host', """(() => { const P = T4.fresh('warrior', 50), H = T4.H, F = T4.F, L = T4.L, X = T4.X, out = {};
              const t = H.REALMS[0].town; H.teleport(t.x, t.z); H.simulate(0.5);
              X.late4HostsFresh();
              H.simulate(6);
              out.hosts = X.LATE4.hosts.map((Hh) => { const l = F.getEnt(Hh.lead); return { up: Hh.up, route: Hh.route ? Hh.route.length : 0, ids: Hh.ids.length, lead: l ? l.name : null, level: l ? l.level : null }; });
              out.legs = X.LATE4.stats.routeLegs; out.fails = X.LATE4.stats.routeFails;
              // it walks its track: the point goes on, its bodies with it
              const Hh = X.LATE4.hosts[0], p0 = [Hh.px, Hh.pz]; let maxLag = 0;
              for (let i = 0; i < 40; i++) { H.simulate(1); for (const id of Hh.ids) { const o = F.getEnt(id); if (o && o.alive) maxLag = Math.max(maxLag, Math.hypot(o.x - Hh.px, o.z - Hh.pz)); } }
              out.walked = +Math.hypot(Hh.px - p0[0], Hh.pz - p0[1]).toFixed(1); out.maxLag = +maxLag.toFixed(1); out.ri = Hh.ri;
              out.onWalk = Hh.ids.map(F.getEnt).filter((o) => o && o.alive).every((o) => F.isWalkable(o.x, o.z));
              // it fights what it meets: the player put in its way
              const lead = F.getEnt(Hh.lead) || F.getEnt(Hh.ids[0]); const [lx, lz] = T4.spot(lead.x, lead.z, 9); H.teleport(lx, lz); T4.safe(); H.simulate(2);
              out.engaged = Hh.ids.map(F.getEnt).filter((o) => o && o.alive && o.target === P.id).length; out.fight = Hh.fight > 0;
              // brought down with your share: a deed, the news, and it walks again later
              const d0 = L.LATE2.d.roam || 0; for (const id of Hh.ids) { const o = F.getEnt(id); if (o && o.alive) { o.damagers = new Map([[P.id, o.maxHp]]); F.killEnt(o, P); } }
              H.simulate(1); out.deed = (L.LATE2.d.roam || 0) - d0; out.down = Hh.down; out.up = Hh.up;
                            // saved with the world, loaded back
              const sv = F.buildSave(); out.saved = sv.world && sv.world.x ? sv.world.x.roam : null;
              const want = X.LATE4.hosts.map((h) => [h.px, h.pz, h.down]);
              F.savePartsLoad('world', { roam: out.saved }); out.loaded = X.LATE4.hosts.map((h, i) => +(Math.hypot((h.px ?? 0) - (want[i][0] ?? 0), (h.pz ?? 0) - (want[i][1] ?? 0))).toFixed(2));
              F.savePartsLoad('world', { roam: { v: 1, h: [[1e9, 'x', -3, 'q'], 7, null] } }); out.junk = X.LATE4.hosts.map((h) => [h.px, h.down]);
              F.savePartsLoad('world', undefined); out.none = X.LATE4.hosts.map((h) => h.px);
              out.errors = H.errors.slice(0, 3); return out; })()""")
            check(all(h['route'] >= 6 for h in r['hosts']), f"each homeland's host has its track between the borderland camps ({[h['route'] for h in r['hosts']]} points, {r['fails']} legs of {r['legs']} without a way)")
            check(sum(1 for h in r['hosts'] if h['up'] and h['ids'] >= 4) >= 2, f"the hosts walk at 50: a leader and its host ({r['hosts']})")
            check(r['walked'] >= 30 and r['onWalk'], f"a host walks on along its track ({r['walked']} m in 40 s, its bodies on walkable ground, the farthest {r['maxLag']} m from the point)")
            check(r['engaged'] >= 2 and r['fight'], f"it fights what it meets ({r['engaged']} on the player)")
            check(r['deed'] == 1 and r['down'] > 800 and not r['up'], f"its leader brought down is a deed, and it walks again later ({r['deed']}, {r['down']} s)")
            check(r['saved'] and all(d < 0.2 for d in r['loaded']), f"saved with the world and loaded where it was ({r['loaded']})")
            check(r['junk'][0][0] is None and r['none'][0] is None, f"a damaged part made sane and none read as none ({r['junk']}, {r['none']})")
            check(not r['errors'], f"no errors ({r['errors']})")

        # ---- the standard of your name ----
        if want('std'):
            r = await ev(page, 'std', """(() => { const P = T4.fresh('warrior', 50), H = T4.H, F = T4.F, L = T4.L, V = H.vet3, X = T4.X, out = {};
              L.LATE2.d.king = 1; L.late2CheckNames(true); L.late2Wear('kingsbane');
              const t = H.REALMS[0].town; H.INV.gold = 5000; L.late2StdMake();
              let planted = false; for (let r = 30; r < 140 && !planted; r += 6) for (let k = 0; k < 12 && !planted; k++) { const x = t.x + Math.cos(k * 0.52) * r, z = t.z + Math.sin(k * 0.52) * r; if (!F.isWalkable(x, z)) continue; H.teleport(x, z); P.yaw = k; H.simulate(0.1); planted = L.late2StdPlant(); }
              const at = L.LATE2.std.at, B = H.dbg.bannerGeo ? H.dbg.bannerGeo.attributes : null;
              out.planted = planted; out.at = at; out.slot = L.L2STD.slot;
              const bg = T4.X.bannerGeo.attributes; out.kind = bg ? +bg.aB1.array[L.L2STD.slot * 4 + 3].toFixed(3) : null; out.dims = bg ? [bg.aB1.array[L.L2STD.slot * 4], bg.aB1.array[L.L2STD.slot * 4 + 1]] : null; out.top = bg ? +(bg.aB0.array[L.L2STD.slot * 4 + 1] - F.heightAt(at.x, at.z)).toFixed(2) : null;
              out.pole = L.LATE2_STD.poleH;
              // struck: torn
              const foes = []; for (let i = 0; i < 2; i++) { const o = F.spawnRealmUnit((P.faction + 1) % 3, 'warrior', 50, 'soldier', at.x + Math.cos(i * 2) * 1.6, at.z + Math.sin(i * 2) * 1.6); o.combatUntil = H.GAME.t + 999; foes.push(o); }
              P.x = P.prevX = at.x + 30; P.z = P.prevZ = at.z;
              for (let i = 0; i < 3; i++) { for (const o of foes) { o.combatUntil = H.GAME.t + 999; } H.simulate(1); }
              out.tear = +(V.L3V.std.tear || 0).toFixed(2); out.kindTorn = bg ? +bg.aB1.array[L.L2STD.slot * 4 + 3].toFixed(3) : null;
              for (const o of foes) { o.damagers = null; F.killEnt(o, null); }
              const sv = F.buildSave(); out.saved = sv.char && sv.char.x ? sv.char.x.late4 : null;
              // taken up, the rents are mended
              P.x = P.prevX = at.x + 1.2; P.z = P.prevZ = at.z; H.simulate(0.2); if (V.L3V.std.fallen) V.late3StdRaise(); H.simulate(1.2); L.late2StdTake(); out.tearAfter = V.L3V.std.tear || 0;
              out.errors = H.errors.slice(0, 3); return out; })()""")
            check(r['planted'] and r['pole'] >= 5 and r['dims'] and r['dims'][0] >= 2.5 and r['dims'][1] >= 1.4, f"planted: a long flag ({r['dims']}) on a taller pole ({r['pole']} m)")
            check(r['kind'] is not None and 1.99 < r['kind'] < 2.02, f"its flag is a veteran's (kind 2: {r['kind']})")
            check(r['tear'] > 0.05 and r['kindTorn'] > 2.04, f"struck, it is torn ({r['tear']}, kind {r['kindTorn']})")
            check(r['saved'] and r['saved'].get('t', 0) > 0 and r['tearAfter'] == 0, f"its rents saved, and mended once it is taken up ({r['saved']}, {r['tearAfter']})")
            check(not r['errors'], f"no errors ({r['errors']})")

        # ---- the deep remembers ----
        if want('deep') or want('reload'):
            r = await ev(page, 'deep', """(() => { const P = T4.fresh('warrior', 50), H = T4.H, F = T4.F, D = H.deep, DP = D.DEEP, out = {};
              H.deep.deepPacksFresh(); H.deep.deepPitchOut();
              // two of the pyres' dead and a hound fall, a gallery slab falls, the pitch burns and one cell is charred, the cistern floods
              const pk = D.DEEP_PACKS[1], hk = D.DEEP_PACKS[2]; let killed = 0;
              for (const id of [...pk.members].slice(0, 2).concat([...hk.members].slice(0, 1))) { const e = F.getEnt(id); if (e && e.alive) { e.damagers = null; F.killEnt(e, null); killed++; } }
              H.simulate(0.2);
              const S = DP.slabs.find((s) => s.hall === 'crack'); D.deepSlabFall(S); H.simulate(1.5);
              const C1 = DP.cells[3], C2 = DP.cells[40]; D.deepIgnite(C1, null); D.deepIgnite(C2, null); H.simulate(3);
              const C3 = DP.cells[80]; C3.st = 2; C3.heat = 0; C3.ch = 1; C3.rearm = H.GAME.t + 30;
              DP.flood.st = 2; DP.flood.t = 10; DP.wy = D.DEEP_FLOOD.high;
              out.before = { packs: D.DEEP_PACKS.map((p) => p.members.size), respawn: D.DEEP_PACKS.map((p) => p.respawn.length), slab: S.st, burning: DP.cells.filter((c) => c.st === 1).length, charred: DP.cells.filter((c) => c.st === 2).length, wy: +DP.wy.toFixed(2), killed };
              const sv = F.buildSave(); out.part = sv.char && sv.char.x ? sv.char.x.deep4 : null;
              window.__l4deep = out.part; window.__l4save = sv;
              // as new, then loaded back as it lay
              H.deep.deepPacksFresh(); H.deep.deepPitchOut(); H.deep.deepSlabMend(S); DP.flood.st = 0; DP.flood.t = 0; DP.wy = D.DEEP_FLOOD.base;
              F.savePartsLoad('char', { deep4: out.part });
              out.after = { packs: D.DEEP_PACKS.map((p) => p.members.size), respawn: D.DEEP_PACKS.map((p) => p.respawn.length), slab: S.st, burning: DP.cells.filter((c) => c.st === 1).length, charred: DP.cells.filter((c) => c.st === 2).length, wy: +DP.wy.toFixed(2), flood: DP.flood.st };
              // an old save with none, a damaged one
              F.savePartsLoad('char', { deep4: { v: 1, d: [[99, 'x', 5], 'q', [1, 'cinder', -5, 1e9, NaN]], s: [[1e6, 2, 3]], p: [[1, 9, 'z', 300]], f: ['a', 1e9] } });
              out.junkOk = !H.errors.length;
              out.errors = H.errors.slice(0, 3); return out; })()""")
            b, a = r['before'], r['after']
            check(r['part'] and b['killed'] == 3, f"the deep's state saved ({json.dumps(r['part'])[:300]})")
            check(a['respawn'][1] == b['respawn'][1] and a['respawn'][2] == b['respawn'][2] and a['packs'][1] == b['packs'][1], f"its dead stay dead until their time (packs {b['packs']} -> {a['packs']}, waiting {b['respawn']} -> {a['respawn']})")
            check(a['slab'] == 3, f"the fallen slab lies in its pit ({a['slab']})")
            check(a['burning'] >= 1 and a['charred'] >= 1, f"the pitch burns and lies charred as it was ({b['burning']}/{b['charred']} -> {a['burning']}/{a['charred']})")
            check(abs(a['wy'] - b['wy']) < 0.05 and a['flood'] == 2, f"the cistern's water stands as it stood ({b['wy']} -> {a['wy']})")
            check(r['junkOk'], 'a damaged part made sane')
            check(not r['errors'], f"no errors ({r['errors']})")

        # ---- the deep's own air (a real click starts the sound) ----
        if want('air'):
            await page.mouse.click(W // 2, Hh // 2)
            await asyncio.sleep(1.0)
            r = await ev(page, 'air', """(async () => { const H = __hm, F = H.fn, D = H.deep, X = T4.X, out = {};
              if (!H.GAME.player) T4.fresh('warrior', 50);
              D.DEEP.opened = true; D.late3SealOpen(true);
              const p = F.dunPoint(168, 48); const P = H.GAME.player; P.x = P.prevX = p.x; P.z = P.prevZ = p.z; P.y = p.y; F.setIndoor(true);
              for (let i = 0; i < 30; i++) { H.simulate(0.1); H.frame(1/30); }
              out.ctx = !!(window.AUDIO_CTX_STATE || 1);
              out.voices = X.LATE4.air ? Object.keys(X.LATE4.air) : null;
              out.gain = X.LATE4.air ? Object.fromEntries(Object.entries(X.LATE4.air).map(([k, V]) => [k, +V.on.toFixed(3)])) : null;
              const q = F.dunPoint(30, 48); P.x = P.prevX = q.x; P.z = P.prevZ = q.z; P.y = q.y;
              for (let i = 0; i < 30; i++) { H.simulate(0.1); H.frame(1/30); }
              out.gainHall = X.LATE4.air ? Object.fromEntries(Object.entries(X.LATE4.air).map(([k, V]) => [k, +V.on.toFixed(3)])) : null;
              const t = H.REALMS[0].town; F.setIndoor(false); H.teleport(t.x, t.z); for (let i = 0; i < 20; i++) { H.simulate(0.1); H.frame(1/30); }
              out.gainOut = X.LATE4.air ? Object.fromEntries(Object.entries(X.LATE4.air).map(([k, V]) => [k, +V.on.toFixed(3)])) : null;
              out.errors = H.errors.slice(0, 3); return out; })()""")
            check(r['voices'] and len(r['voices']) == 3, f"the deep's air: three placed voices of its own ({r['voices']})")
            check(r['gain'] and r['gain']['drip'] > 0.005, f"water in the cistern ({r['gain']})")
            check(r['gainHall'] and r['gainHall']['hall'] > 0.005 and r['gainHall']['hall'] > r['gainHall']['drip'], f"the lord's hall breathes, and the cistern is far ({r['gainHall']})")
            check(r['gainOut'] and all(v == 0 for v in r['gainOut'].values()), f"silent out of the deep ({r['gainOut']})")
            check(not r['errors'], f"no errors ({r['errors']})")

        # ---- the pictures ----
        if want('shots') and SHOTS:
            await ev(page, 'prep', "(() => { T4.fresh('warrior', 50); __hm.fn.setQuality('" + Q + "'); __hm.setTod(0.75); return 0; })()")
            for name, type, realm, act in (('bear', 'bear', 1, 20), ('wolf', 'wolf', 1, 22), ('boar', 'boar', 1, 22), ('bandit', 'bandit', 0, 8)):
                await ev(page, name, """(() => { const H = T4.H, F = T4.F, P = H.GAME.player; const R = T4.champ('%s', %d); const C = R.C;
                  T4.clearAround(C.x, C.z, 30, new Set([C.id])); C.ai.tameHold = H.GAME.t + 999; C.target = null; C.threat = null;
                  const [px, pz] = T4.spot(C.x, C.z, 25); H.teleport(px, pz); H.simulate(0.2);
                  T4.X.setAct(C, %d, 1.6); H.simulate(0.62);
                  H.UI.modal = 'menu'; H.CAM.mode = 'fixed'; const a = C.yaw + 1.1, d = %s; H.camera.position.set(C.x + Math.sin(a) * d, C.y + 1.7, C.z + Math.cos(a) * d); H.camera.lookAt(C.x, C.y + 1.0 * (C.scale || 1), C.z); H.camera.updateMatrixWorld();
                  window.__rafHold = true; return { act: C.anim.act, frac: +(C.anim.actT / C.anim.actDur).toFixed(2) }; })()""" % (type, realm, act, '5.5' if type != 'bandit' else '4.5'))
                await frames(page, 2)
                await shot(page, name + '_' + Q)
                await page.evaluate("window.__rafHold = false; __hm.UI.modal = null; __hm.CAM.mode = 'play'; 0")
            # a roaming host on its track
            await ev(page, 'host', """(() => { const H = T4.H, F = T4.F, X = T4.X, P = H.GAME.player; const t = H.REALMS[1].town; H.teleport(t.x, t.z); H.simulate(0.3);
              X.late4HostsFresh(); H.simulate(4);
              const Hh = X.LATE4.hosts[1]; for (let i = 0; i < 12; i++) H.simulate(1);
              const lead = F.getEnt(Hh.lead); if (!lead) return { none: 1 };
              const [px, pz] = T4.spot(lead.x, lead.z, 70); H.teleport(px, pz); H.simulate(0.1);
              H.UI.modal = 'menu'; H.CAM.mode = 'fixed'; const r = Hh.route, nx = r[Hh.ri % r.length], dx = nx.x - Hh.px, dz = nx.z - Hh.pz, L = Math.hypot(dx, dz) || 1;
              H.camera.position.set(Hh.px + dx / L * 11 + dz / L * 5, F.heightAt(Hh.px, Hh.pz) + 2.6, Hh.pz + dz / L * 11 - dx / L * 5); H.camera.lookAt(Hh.px, F.heightAt(Hh.px, Hh.pz) + 0.8, Hh.pz); H.camera.updateMatrixWorld();
              window.__rafHold = true; return { ids: Hh.ids.length }; })()""")
            await frames(page, 2)
            await shot(page, 'host_' + Q)
            await page.evaluate("window.__rafHold = false; __hm.UI.modal = null; __hm.CAM.mode = 'play'; 0")
            # the standard: by day, at night, in rain
            await ev(page, 'stdprep', """(() => { const H = T4.H, F = T4.F, L = T4.L, P = H.GAME.player; L.LATE2.d.king = 1; L.late2CheckNames(true); L.late2Wear('kingsbane');
              const t = H.REALMS[0].town; H.INV.gold = 5000; L.late2StdMake();
              let planted = false; for (let r = 30; r < 140 && !planted; r += 6) for (let k = 0; k < 12 && !planted; k++) { const x = t.x + Math.cos(k * 0.52) * r, z = t.z + Math.sin(k * 0.52) * r; if (!F.isWalkable(x, z)) continue; H.teleport(x, z); P.yaw = k; H.simulate(0.1); planted = L.late2StdPlant(); }
              const at = L.LATE2.std.at; const wd = H.dbg.U.uWindDir.value; P.x = P.prevX = at.x + 40; P.z = P.prevZ = at.z; H.simulate(0.2);
              H.UI.modal = 'menu'; H.CAM.mode = 'fixed'; const gy = F.heightAt(at.x, at.z);
              // from 15 m, abreast of the wind so the flag streams across the view
              H.camera.position.set(at.x - wd.y * 15 + wd.x * 2, gy + 2.2, at.z + wd.x * 15 + wd.y * 2); H.camera.lookAt(at.x + wd.x * 1.2, gy + 3.8, at.z - wd.y * 1.2); H.camera.updateMatrixWorld();
              return { planted }; })()""")
            for name, tod, js in (('std_day', 0.75, ''), ('std_night', 2.1, ''), ('std_rain', 0.75, "{ const Wt = __hm.dbg.WEATHER; Wt.mode = 'fixed'; Wt.kind = 'rain'; Wt.raining = 1; Wt.wet = 1; Wt.overcast = 1; Wt.fog = 0.7; Wt.next = 1e9; }")):
                await page.evaluate(f"__hm.setTod({tod}); {js} __hm.simulate(0.2); window.__rafHold = true; 0")
                await frames(page, 3)
                await shot(page, name + '_' + Q)
                await page.evaluate("window.__rafHold = false; 0")
            await page.evaluate("__hm.UI.modal = null; __hm.CAM.mode = 'play'; __hm.setTod(0.75); 0")

        print('ERRORS', await page.evaluate("__hm.errors.slice(0, 5)"), flush=True)
        await b.close()
    print(f'done in {time.time() - T0:.0f}s', flush=True)
    if FAILS:
        print('FAILED:', *FAILS, sep='\n  ', flush=True)
        sys.exit(1)
    print('ALL OK', flush=True)

asyncio.run(main())
