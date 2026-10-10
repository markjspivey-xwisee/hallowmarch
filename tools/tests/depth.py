"""Depth (version 9): what the version 8 systems' builders left undone, end to end through window.__hm.
  1. a berry bush set alight by a fire spell burns and chars, spreads to the grass and comes back; a grass fire takes a
     bush; a brand offers it; a knife cuts a bush down; an apple tree is chopped, falls on its own arc, is cut into
     firewood and logs; stumps are grubbed out with a pick and the ground can then be built on and tilled; the save
  2. hens give feathers (plucked, and moulted in the paddock); pheasants in the meadows and ducks on the lakes flush,
     fly off and come down again; shot, they fall and give meat and feathers; the player's drawn arrows strike them
  3. crafting to the level cap: grave-iron, dragon scales, trophies; a level 50 masterwork; tier 2 at item level 36;
     the new herbs' draughts; farm produce in recipes; the masterwork mark survives the save
  4. building: a hip roof and a lean-to on walls, leaded windows, a well that waters the troughs and beds; a townsman
     walks through a built door (it opens and shuts); the garrison's fire spares its own roofs, the player's does not
  5. animals: a hen's clutch hatches into chicks; eggs laid with a cockerel about hatch; a hound herds sheep home;
     the trough gives back the skins
Screenshots (tools/out/depth_*): a burning bush, a felled apple tree, a level 50 masterwork in hand, a hip-roofed
cottage with leaded windows and a well, hens with chicks, a hound herding sheep, a hen pecking, a sheep lying down.
usage: python3 tools/tests/depth.py [noshots] [only=nature|birds|craft|build|animals] [shotsonly]"""
import json, asyncio, sys, pathlib, time
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
from hmlib import setup, OUT
from playwright.async_api import async_playwright

ARGS = sys.argv[1:]
SHOTS = 'noshots' not in ARGS
SHOTSONLY = 'shotsonly' in ARGS
ONLY = next((a.split('=')[1] for a in ARGS if a.startswith('only=')), None)
FAILS = []
T0 = time.time()

def check(cond, what):
    print(('  ok   ' if cond else '  FAIL ') + what, flush=True)
    if not cond: FAILS.append(what)

async def ev(page, label, js):
    r = await page.evaluate(js)
    print(f'{label} [{time.time() - T0:.0f}s]', json.dumps(r)[:1400], flush=True)
    return r

async def shot(page, name, js):
    if not SHOTS: return
    await page.evaluate(js)
    for _ in range(2): await page.evaluate("__hm.frame(0.033); 0")
    # read the canvas (the page's own frame loop is slow under SwiftShader)
    data = await page.evaluate("(() => { __hm.frame(0.033); return document.querySelector('canvas').toDataURL('image/png'); })()")
    import base64
    pathlib.Path(OUT + name + '.png').write_bytes(base64.b64decode(data.split(',')[1]))
    print('  shot', name, f'[{time.time() - T0:.0f}s]', flush=True)

def on(name): return not ONLY or ONLY == name

HELPERS = r"""
window.T = {
  H: __hm, F: __hm.fn, D: __hm.depth, A: __hm.animals, S: __hm.surv, N: __hm.nature,
  get B() { return __hm.build; },
  P() { return __hm.GAME.player; },
  dry() { const Wt = this.H.dbg.WEATHER; Wt.mode = 'fixed'; Wt.kind = 'clear'; Wt.raining = 0; Wt.wet = 0; Wt.snowing = 0; Wt.snow = 0; Wt.overcast = 0; Wt.target = 0; Wt.w = 0; this.H.dbg.U.uWet.value = 0; this.H.dbg.U.uSnowCover.value = 0; },
  // foes near the player are put away; game is left alone
  calm() { const P = this.P(); for (const e of this.H.ENT) if (e !== P && e.alive && e.kind !== 'door' && !e.game && this.F.isEnemy(P, e) && Math.hypot(e.x - P.x, e.z - P.z) < 90) { e.alive = false; e.removeAt = this.H.GAME.t; } P.buffs.length = 0; P.casting = null; P.hp = P.maxHp; P.combatUntil = 0; },
  stand(x, z, fx, fz) { const P = this.P(); this.H.teleport(x, z); this.calm(); P.yaw = Math.atan2(fx - x, fz - z); this.H.UI.modal = null; this.H.simulate(0.05); },
  until(fn, max, step = 0.5) { let t = 0; while (t < max && !fn()) { this.H.simulate(step); this.P().hp = this.P().maxHp; t += step; } return t; },
  sim(s, step = 0.5) { for (let t = 0; t < s; t += step) { this.H.simulate(Math.min(step, s - t)); const P = this.P(); P.hp = P.maxHp; } },
  label() { return __hm.SIEGE.interaction(); },
  act() { const it = this.F.playerInteract(); return 0; },
  cam(x, y, z, tx, ty, tz) { const H = this.H; H.UI.modal = 'menu'; H.CAM.mode = 'fixed'; const hud = document.getElementById('hud'); if (hud) hud.style.visibility = 'hidden'; H.camera.position.set(x, y, z); H.camera.lookAt(tx, ty, tz); H.camera.updateMatrixWorld(); },
  play() { this.H.UI.modal = null; this.H.CAM.mode = 'play'; const hud = document.getElementById('hud'); if (hud) hud.style.visibility = ''; },
  firesNear(x, z, r) { return this.H.dbg.FIRES ? this.H.dbg.FIRES.filter((f) => f.until > this.H.GAME.t && Math.hypot(f.x - x, f.z - z) < r).length : -1; },
  lootNear(id, x, z, r) { return this.H.LOOT.filter((L) => L.item && L.item.goods === id && Math.hypot(L.x - x, L.z - z) < r).reduce((n, L) => n + (L.item.n || 1), 0); },
};
"""

async def nature_tests(page):
    r = await ev(page, 'bush: a fire spell', """(() => { T.dry(); const P = T.P(), R = T.H.REALMS[0];
      const bush = T.D.plant('bush', { x: R.town.x + 120, z: R.town.z }); T.bush = bush;
      T.stand(bush.x + 3, bush.z, bush.x, bush.z);
      T.F.fireLandsAt(bush.x, bush.y + 0.6, bush.z, 2.2, P); const a = T.D.pstate(bush);
      T.sim(6); const b = T.D.pstate(bush); const fires = T.firesNear(bush.x, bush.z, 2); const grass = T.N.fireAt(bush.x + 0.5, bush.z) + T.N.burntAt(bush.x + 0.5, bush.z) + T.N.burntAt(bush.x - 0.5, bush.z) + T.N.burntAt(bush.x, bush.z + 0.6);
      T.sim(30); const c = T.D.pstate(bush);
      return { a, b, c, fires, grass: +grass.toFixed(2) }; })()""")
    check(r['a']['fire'] > 0, 'a fire spell landing on a berry bush sets it alight')
    check(r['b']['char'] > 0.25 and r['fires'] >= 1, f"it burns with real flames and chars (char {r['b']['char']}, {r['fires']} fire)")
    check(r['grass'] > 0, 'the fire runs on into the grass beneath it')
    check(r['c']['fire'] == 0 and r['c']['char'] > 0.85 and r['c']['regrowAt'] > 0 and r['c']['ripe'] == 0, 'it burns out to a charred tangle with no fruit, its regrowth clock set')
    r = await ev(page, 'bush: grows back', """(() => { const b = T.bush; b.regrowAt = T.H.GAME.t + 1; T.N.NATURE.speed = 8;
      T.sim(4); const a = T.D.pstate(b); T.sim(120, 1); const c = T.D.pstate(b); T.N.NATURE.speed = 1; return { a, c }; })()""")
    check(r['c']['char'] < 0.05 and r['c']['fire'] == 0, f"it puts out new shoots and the char grows over (char {r['c']['char']}, grow {r['c']['grow']})")
    r = await ev(page, 'bush: grass fire and a brand', """(() => { T.dry(); const P = T.P(), R = T.H.REALMS[0];
      const b2 = T.D.plant('bush', { x: R.town.x - 140, z: R.town.z + 40 }); T.b2 = b2;
      T.N.igniteGrass(b2.x + 1.2, b2.z, 1.2, 3, 1); const t = T.until(() => b2.fire > 0, 30, 0.5);
      const b3 = T.D.plant('bush', { x: R.town.x + 60, z: R.town.z - 160 }); T.b3 = b3;
      T.stand(b3.x + 1.6, b3.z, b3.x, b3.z); P.brand = { until: T.H.GAME.t + 200, wet: 0, x: P.x, y: P.y + 1.4, z: P.z, emitAcc: 0 };
      const label = T.label(); T.act(); T.sim(1); const lit = b3.fire > 0; P.brand = null;
      return { t, caught: b2.fire > 0 || b2.char > 0, label, lit }; })()""")
    check(r['caught'], f"a grass fire spreading into a bush sets it alight ({r['t']} s)")
    check(r['label'] == 'Set the berry bush alight' and r['lit'], f"with a brand in hand: \"{r['label']}\", and it catches")
    r = await ev(page, 'bush: cut down', """(() => { T.dry(); const P = T.P(), R = T.H.REALMS[0]; T.F.goodsAdd('tool_knife', 1, true);
      const b = T.D.plant('bush', { x: R.town.x + 80, z: R.town.z + 150 }); T.b4 = b; b.ripe = 0; b.at = T.H.GAME.t + 999;
      T.stand(b.x + 1.5, b.z, b.x, b.z); const label = T.label(); const st0 = T.F.goodsCount('stick');
      T.act(); T.sim(4, 0.25); const s = T.D.pstate(b);
      return { label, s, sticks: T.F.goodsCount('stick') - st0 }; })()""")
    check(r['label'] == 'Cut down the berry bush' and r['s']['cut'] and not r['s']['coll']['active'] and r['sticks'] >= 2, f"a knife cuts a bush down to its roots: \"{r['label']}\", +{r['sticks']} sticks, no longer in the way")
    r = await ev(page, 'apple: chop', """(() => { T.dry(); const P = T.P(), R = T.H.REALMS[0];
      const a = T.D.plant('apple', R.town); T.apple = a; T.F.goodsAdd('tool_axe', 1, true); a.ripe = 0; a.at = T.H.GAME.t + 999;
      T.stand(a.x + 1.6, a.z + 0.3, a.x, a.z); const label = T.label();
      T.act(); const t = T.until(() => a.cut, 12, 0.25); const f0 = T.D.pstate(a); if (!a.fall) return { label, t, f0, angs: [0], f1: f0, logColl: false, stumpH: 9 };
      const angs = []; for (let i = 0; i < 12; i++) { T.H.simulate(0.2); angs.push(+a.fall.ang.toFixed(2)); }
      T.until(() => a.fall.done, 8, 0.25); T.sim(1); const f1 = T.D.pstate(a);
      return { label, t, f0, angs, f1, logColl: !!a.logColl, stumpH: a.coll && a.coll.h }; })()""")
    check(r['label'] == 'Chop down the apple tree' and r['f0']['cut'] and r['f0']['log'], f"an apple tree is chopped down with an axe: \"{r['label']}\" ({r['t']} s)")
    angs = r['angs']
    check(all(angs[i] <= angs[i + 1] + 0.02 for i in range(4)) and angs[-1] > 0.8 and r['f1']['fall']['done'] and r['f1']['fall']['stop'] > 0.9, f"it falls about its stump, faster as it goes, and comes to rest on its crown (angles {angs[:6]} .. stop {r['f1']['fall']['stop']})")
    check(r['logColl'] and r['stumpH'] < 1, 'the fallen trunk lies in the way; a low stump is left')
    r = await ev(page, 'apple: firewood', """(() => { const a = T.apple, P = T.P(); const L = 3.2 * a.s * 0.5;
      T.stand(a.x + a.fall.ux * L + a.fall.uz * 1.4, a.z + a.fall.uz * L - a.fall.ux * 1.4, a.x + a.fall.ux * L, a.z + a.fall.uz * L);
      const label = T.label(); const g0 = { log: T.F.goodsCount('log'), fw: T.F.goodsCount('firewood') };
      T.act(); T.until(() => !a.log, 8, 0.25); return { label, log: !!a.log, logs: T.F.goodsCount('log') - g0.log, fw: T.F.goodsCount('firewood') - g0.fw, piles: T.N.NATURE.piles.filter((p) => Math.hypot(p.x - a.x, p.z - a.z) < 6).length }; })()""")
    check(r['label'] == 'Cut the apple tree into firewood' and not r['log'] and r['logs'] >= 1 and r['fw'] >= 2 and r['piles'] >= 1, f"the fallen tree is cut into firewood and a log (+{r['logs']} log, +{r['fw']} firewood, a pile by the stump)")
    r = await ev(page, 'stumps: grubbed out', """(() => { T.dry(); const P = T.P(), R = T.H.REALMS[0], B = T.B, N = T.N;
      // a tree on Logres's own homeland, felled and its log split, leaves a stump in the way of building
      let t = null; for (const tr of T.F.W.trees) { if (tr.felled || T.F.zoneAt(tr.x, tr.z).realm !== 0 || T.F.zoneAt(tr.x, tr.z).kind !== 'home') continue; const d = Math.hypot(tr.x - R.town.x, tr.z - R.town.z); if (d > 120 && d < 260) { t = tr; break; } }
      if (!t) return { none: true };
      N.fellTree(t, 1, 0, 60, true); T.until(() => t.fall && t.fall.done, 15, 0.25); T.sim(1);
      if (t.log) { const N2 = N.NATURE; t.log = false; if (t.logColl) { t.logColl.active = false; t.logColl = null; } }
      T.stand(t.x + 1.6, t.z, t.x, t.z);
      const before = B.bValidate(B.bSnap('found', t.x, t.z, 0, P), P).why || 'ok';
      const noTool = T.label(); T.F.goodsTake('tool_axe', T.F.goodsCount('tool_axe')); T.F.goodsTake('tool_pick', T.F.goodsCount('tool_pick')); const bare = T.label();
      T.F.goodsAdd('tool_pick', 1, true); const label = T.label(); const fw0 = T.F.goodsCount('firewood');
      T.act(); T.until(() => t.grubbed, 10, 0.25);
      const after = B.bValidate(B.bSnap('found', t.x, t.z, 0, P), P).why || 'ok';
      const till = T.H.farm.tillWhy(t.x, t.z);
      T.tree = t.i;
      // the save: the grubbed stump stays gone, a felled apple tree's stump and a cut bush stay as they were
      const data = T.D.part().save();
      return { before, bare, label, grubbed: !!t.grubbed, coll: t.coll ? t.coll.active : null, after, till, earth: +N.earthAt(t.x, t.z).toFixed(2), stumps: N.NATURE.felled.includes(t), fw: T.F.goodsCount('firewood') - fw0, part: data ? { g: data.g.length, f: data.f.length } : null }; })()""")
    if r.get('none'): check(False, 'a tree to fell in Logres'); return
    check('stump' in r['before'], 'a stump stands in the way of a foundation: ' + r['before'])
    check(r['bare'] != 'Grub out the ' + 'oak stump' and r['label'] and r['label'].startswith('Grub out the'), f"with a pick (or an axe) the stump can be grubbed out: \"{r['label']}\" (bare hands: {r['bare']})")
    check(r['grubbed'] and r['coll'] is False and not r['stumps'] and r['earth'] > 0.3, f"it comes out roots and all, leaving dug earth ({r['earth']})")
    check(r['after'] in ('ok',) or ('stump' not in r['after'] and 'tree' not in r['after']), 'the ground can be built on: ' + r['after'])
    check(r['till'] is None or ('tree' not in r['till']), f"and tilled: {r['till']}")
    r = await ev(page, 'save and load', """(() => { const part = T.D.part(); const d = JSON.parse(JSON.stringify(part.save()));
      const a = T.apple, t = T.F.W.trees[T.tree];
      part.load(d); T.sim(1);
      const ok1 = !!t.grubbed && !(t.coll && t.coll.active) && a.cut && !a.gone && T.b4.cut && !T.b4.coll.active;
      part.load({ g: ['x', -1, 1e9], f: [[99999, 1], 'junk', [0, 'a', 'b'], null], n: [{}, null, 5] }); T.sim(1);
      part.load(undefined); T.sim(0.5);
      part.load(d); T.sim(0.5);
      return { size: JSON.stringify(d).length, ok1, errors: T.H.errors.length }; })()""")
    check(r['ok1'] and r['errors'] == 0, f"the save keeps grubbed stumps, felled apple trees and cut bushes ({r['size']} bytes); old and damaged saves load")

async def bird_tests(page):
    r = await ev(page, 'birds', """(() => { const b = T.D.birds(); const ducks = b.filter((q) => q.kind === 'duck'), ph = b.filter((q) => q.kind === 'pheasant');
      const onWater = ducks.filter((q) => { const w = T.H.water.waterAt(q.x, q.z); return w && Math.abs(q.y - (w.y - 0.13)) < 0.1; }).length;
      return { n: b.length, ducks: ducks.length, ph: ph.length, onWater }; })()""")
    check(r['ph'] >= 6 and r['ducks'] >= 6 and r['onWater'] == r['ducks'], f"pheasants in the meadows ({r['ph']}) and ducks floating on the lakes ({r['ducks']}, {r['onWater']} at the surface)")
    r = await ev(page, 'birds: flush', """(() => { T.dry(); const P = T.P(); const e = T.D.DEPTH.birds.find((q) => q.kind === 'pheasant' && q.alive);
      T.ph = e.id; T.stand(e.x + 14, e.z, e.x, e.z); T.sim(2); const quiet = !e.bird.fly;
      T.H.teleport(e.x + 4, e.z); P.yaw = Math.atan2(-1, 0); T.H.simulate(0.3); const flew = !!e.bird.fly;
      const ys = []; for (let i = 0; i < 8; i++) { T.H.simulate(0.25); ys.push(+(e.y - T.F.heightAt(e.x, e.z)).toFixed(1)); }
      const t = T.until(() => !e.bird.fly, 40, 0.5); return { quiet, flew, ys, t, landed: !e.bird.fly, d: +Math.hypot(e.x - P.x, e.z - P.z).toFixed(0), y: +(e.y - T.F.heightAt(e.x, e.z)).toFixed(2) }; })()""")
    check(r['quiet'] and r['flew'] and max(r['ys']) > 2.5, f"a pheasant sits tight until you are close, then flushes and climbs ({r['ys']})")
    check(r['landed'] and r['d'] > 30 and abs(r['y']) < 0.2, f"it flies off and comes down again {r['d']} m away ({r['t']} s)")
    r = await ev(page, 'birds: shot down', """(() => { const P = T.P(); const e = T.D.DEPTH.birds.find((q) => q.kind === 'duck' && q.alive); T.stand(e.x + 25, e.z, e.x, e.z);
      const T0 = T.lootNear('feather', e.x, e.z, 6), M0 = T.lootNear('meat_raw', e.x, e.z, 6);
      // in flight: flushed, then struck
      T.D.dpFlush(e, P.x, P.z); T.sim(1.5, 0.25); const y0 = +(e.y - T.F.heightAt(e.x, e.z)).toFixed(1);
      T.F.dealDamage(P, e, 999, { kind: 'arrow' }); const dead = !e.alive; T.sim(4, 0.25);
      const w = T.H.water.waterAt(e.x, e.z), g = w ? w.y - 0.1 : T.F.heightAt(e.x, e.z);
      return { y0, dead, fell: Math.abs(e.y - g) < 0.15, feathers: T.lootNear('feather', e.x, e.z, 8) - T0, meat: T.lootNear('meat_raw', e.x, e.z, 8) - M0 }; })()""")
    check(r['dead'] and r['y0'] > 2 and r['fell'], f"a duck shot in flight ({r['y0']} m up) falls to the water")
    check(r['feathers'] >= 2 and r['meat'] >= 1, f"it gives feathers ({r['feathers']}) and meat ({r['meat']})")
    r = await ev(page, 'birds: the drawn bow', """(() => { const P = T.P(); const e = T.D.DEPTH.birds.find((q) => q.kind === 'pheasant' && q.alive && !q.bird.fly);
      T.stand(e.x, e.z + 8, e.x, e.z); e.bird.until = 1e9; e.bird.mode = 'idle'; const hp0 = e.hp;
      // an arrow loosed by the player at it from a full draw (the archer's own ballistic arrows, 07b_classes.js)
      const fr = T.D.DP_BIRD.pheasant.flushR; T.D.DP_BIRD.pheasant.flushR = 0.1;
      P.yaw = Math.atan2(e.x - P.x, e.z - P.z); const n0 = T.H.cls.CLS.arrows.length; T.H.cls.looseArrow(P, 1, e); const flew = T.H.cls.CLS.arrows.length > n0;
      for (let i = 0; i < 30 && e.alive && e.hp === hp0; i++) T.H.simulate(0.05);
      T.D.DP_BIRD.pheasant.flushR = fr;
      return { hp0, hp: e.hp, alive: e.alive, has: flew }; })()""")
    check(r['has'] and (r['hp'] < r['hp0'] or not r['alive']), f"the archer's drawn arrows strike game birds (hp {r['hp0']} -> {r['hp']})")
    r = await ev(page, 'hens: feathers', """(() => { T.dry(); const P = T.P(), A = T.A; const R = T.H.REALMS[0];
      const pen = A.A.pens.find((p) => p.owner === 'town' && p.realm === 0) || A.A.pens[0];
      const rec = A.anRecord('hen', { owner: 'player', sex: 'f', cmd: 'follow' }); const h = A.anSpawn(rec, pen.x + 12, pen.z + 12);
      T.stand(h.x + 2, h.z, h.x, h.z); const f0 = T.lootNear('feather', h.x, h.z, 6);
      T.F.dealDamage(P, h, 9999, { kind: 'melee' }); T.sim(0.5);
      return { dead: !h.alive, feathers: T.lootNear('feather', h.x, h.z, 6) - f0 }; })()""")
    check(r['dead'] and r['feathers'] >= 3, f"a hen killed is plucked: {r['feathers']} feathers")

async def craft_tests(page):
    r = await ev(page, 'craft: rare materials', """(() => { const P = T.P(), D = T.D; T.calm();
      const at = (o) => Object.assign({ x: P.x + 4, z: P.z + 4, y: P.y, alive: false, buffs: [], scale: 1, kind: 'humanoid', role: 'mob', faction: 3, name: 'x' }, o);
      const n = (id) => T.lootNear(id, P.x + 4, P.z + 4, 10);
      const g0 = n('grave_iron'); D.depthOnKill(at({ role: 'dungeonBoss', name: 'The Hollow King' })); const king = n('grave_iron') - g0;
      const d0 = n('dragon_scale'); D.depthOnKill(at({ kind: 'dragon', role: 'boss' })); const scales = n('dragon_scale') - d0;
      const t0 = n('trophy'); D.depthOnKill(at({ elite: true, mobType: 'wolf', kind: 'wolf', name: 'Grimfang' })); const trophy = n('trophy') - t0;
      return { king, scales, trophy }; })()""")
    check(r['king'] >= 4 and r['scales'] >= 4 and r['trophy'] == 1, f"the Hollow King's hoard gives grave-iron ({r['king']}), Cinderwing dragon scales ({r['scales']}), a champion a trophy")
    r = await ev(page, 'craft: tiers', """(() => { const P = T.P(), S = T.S; const prog = T.H.GAME.prog;
      for (const [id, n] of [['grave_iron', 40], ['dragon_scale', 30], ['trophy', 20], ['iron', 30], ['leather', 20], ['linen', 20], ['woollen', 20], ['plank', 20], ['log', 10], ['herb_marsh', 10], ['herb_moon', 10], ['herb_stone', 10], ['herb_storm', 10], ['feather', 40], ['water', 10], ['milk', 10], ['egg', 10], ['beans', 6], ['meat_raw', 4]]) T.F.goodsAdd(id, n, true);
      T.S.SURV.skill.craft = 100; T.S.SURV.skill.cook = 60;
      const R = (id) => S.RECIPES.find((r) => r.id === id);
      const forge = { station: { kind: 'forge' } }, bench = { station: { kind: 'workbench' } }, loom = { station: { kind: 'loom' } }, alch = { station: { kind: 'alchemy' } };
      const lvl0 = prog.level;
      prog.level = 22; const lowBlock = T.F.craftBlock ? null : null;
      const made = [];
      const mk = (id, ctx) => { const n0 = T.H.INV.bag.length; const ok = S.survCraftOnce(R(id), ctx); const it = T.H.INV.bag[T.H.INV.bag.length - 1]; return ok && T.H.INV.bag.length > n0 ? { name: it.name, lvl: it.lvl, q: it.q, mw: !!it.mw, st: Object.keys(it.st).length } : { fail: true }; };
      const blockedLow = !S.survCraftOnce(R('mw_warrior'), Object.assign({ silent: true }, forge));
      prog.level = 30; const t2a = mk('gi_blade', forge);
      prog.level = 45; const t2b = mk('gi_blade', forge);
      prog.level = 50; const mw = mk('mw_warrior', forge); const t3 = mk('ds_blade', forge);
      // the masterwork mark survives the save
      const it = T.H.INV.bag.find((q) => q.name === 'Wyrmbiter');
      const packed = it ? JSON.parse(JSON.stringify(T.D.packItem(it))) : null;
      const back = packed ? T.D.sanitizeItem(packed) : null;
      // potions from the new herbs, farm produce in recipes
      const pots = {}; for (const id of ['cure', 'moonfern', 'stonebloom']) { const n0 = T.F.goodsCount(R(id).make[0]); S.survCraftOnce(R(id), alch); pots[id] = T.F.goodsCount(R(id).make[0]) - n0; }
      const ch0 = T.F.goodsCount('cheese'); S.survCraftOnce(R('cheese'), { station: { kind: 'oven' } }); const cheese = T.F.goodsCount('cheese') - ch0;
      const fire = { fire: { x: P.x, z: P.z, indoor: true } }; const fe0 = T.F.goodsCount('eggs_fried'); S.survCraftOnce(R('eggs_fried'), fire); const fried = T.F.goodsCount('eggs_fried') - fe0;
      const st0 = T.F.goodsCount('stew'); S.survCraftOnce(R('stew_bean'), fire); const stew = T.F.goodsCount('stew') - st0;
      // using the draughts
      P.hp = P.maxHp * 0.5; T.F.addBuff(P, 'burn', 5, 10, null); T.F.goodsAdd('potion_cure', 0, true); T.F.GOODS.potion_cure.use(P, 'potion_cure'); const cured = !P.buffs.some((b) => b.kind === 'burn') && P.buffs.some((b) => b.kind === 'hot');
      T.F.addBuff(P, 'snare', 0.5, 6, null); P.power = 0; T.F.GOODS.potion_moon.use(P, 'potion_moon'); const steady = !P.buffs.some((b) => b.kind === 'snare') && P.power === P.maxPower;
      T.F.GOODS.potion_stone.use(P, 'potion_stone'); const ward = P.buffs.some((b) => b.kind === 'shield');
      prog.level = lvl0;
      return { blockedLow, t2a, t2b, mw, t3, saved: back ? { lvl: back.lvl, mw: !!back.mw, name: back.name } : null, pots, cheese, fried, stew, cured, steady, ward, recipes: S.RECIPES.length }; })()""")
    check(r['blockedLow'], 'a masterwork cannot be made before level 40')
    check(r['t2a'].get('lvl') == 30 and r['t2b'].get('lvl') == 36, f"grave-iron gear is made at your level up to item level 36 ({r['t2a'].get('lvl')}, {r['t2b'].get('lvl')})")
    check(r['t3'].get('lvl') == 50, f"dragon scale gear reaches item level 50: {r['t3']}")
    check(r['mw'].get('name') == 'Wyrmbiter' and r['mw'].get('lvl') == 50 and r['mw'].get('q', 0) >= 3, f"a named masterwork at level 50: {r['mw']}")
    check(r['saved'] is not None and r['saved']['lvl'] == 50 and r['saved']['mw'], f"the masterwork keeps its item level and mark through the save: {r['saved']}")
    check(all(v >= 1 for v in r['pots'].values()) and r['cured'] and r['steady'] and r['ward'], f"marshgold, moonfern and stonebloom draughts are brewed and work ({r['pots']})")
    check(r['cheese'] >= 1 and r['fried'] >= 1 and r['stew'] >= 2, 'milk makes cheese, eggs fry, beans go into a stew')
    r = await ev(page, 'craft: odds', """(() => { const S = T.S, P = T.P(), prog = T.H.GAME.prog; const R = S.RECIPES.find((r) => r.id === 'ds_blade'); prog.level = 50;
      const runs = (sk) => { S.SURV.skill.craft = sk; let q = 0, mw = 0, n = 0; for (let i = 0; i < 40; i++) { const it = T.H.fn.makeItem({ cls: P.cls, realm: P.faction, lvl: 50, lvlCap: 50, q: T.D.rollQuality(T.D.craftOdds(sk)), slot: 'weapon' }); T.D.depthCraftGear(R, it, sk); q += it.q; mw += it.mw ? 1 : 0; n++; } return { q: +(q / n).toFixed(2), mw }; };
      const lo = runs(65), hi = runs(100); return { lo, hi }; })()""")
    check(r['hi']['mw'] > r['lo']['mw'], f"a master's hand (skill 100) adds the rare bonus stat more often than a journeyman's (65): {r['lo']} vs {r['hi']}")

async def build_tests(page):
    B = "const B = T.B, BU = B.BUILD, P = T.P();"
    r = await ev(page, 'build: site', """(() => { %s
      for (const [id, n] of [['plank', 400], ['stone', 300], ['thatch', 120], ['nails', 400], ['glass', 20], ['iron', 30], ['tool_hammer', 1], ['log', 4], ['waterskin_empty', 4]]) T.F.goodsAdd(id, n, true);
      const R = T.H.REALMS[0]; let best = null;
      for (let along = 300; along <= 440 && !best; along += 9) for (const lat of [-55, 55, -70, 70, -40, 40, 85, -85]) {
        const p = { x: R.dx * along + R.px * lat, z: R.dz * along + R.pz * lat };
        T.H.teleport(p.x, p.z);
        let ok = true;
        for (const [a, b] of [[0, 0], [6, 0], [-3, 0], [0, 6], [6, 6], [-3, -3], [9, 3], [0, -6], [3, -6]]) { const sn = B.bValidate(B.bSnap('found', p.x + a, p.z + b, 0, P), P); if (!sn.ok) { ok = false; break; } }
        if (ok) { best = p; break; }
      }
      if (best) { T.H.teleport(best.x - 2, best.z - 1.5); T.calm(); T.H.CAM.yaw = 0; P.yaw = 0; }
      return { best }; })()""" % B)
    check(r['best'] is not None, 'a place to build')
    if not r['best']: return
    bx, bz = r['best']['x'], r['best']['z']
    r = await ev(page, 'build: cottage', """(() => { %s T.dry();
      const f = B.buildPlace('found', %f, %f, 0); T.sim(10);
      const a = f.pc; T.home = a.id;
      const at = (u, v) => ({ x: a.fx + u * Math.cos(a.fyaw) + v * Math.sin(a.fyaw), z: a.fz - u * Math.sin(a.fyaw) + v * Math.cos(a.fyaw) });
      // place a piece from where the builder stands, then stand by it (on the cottage's side) while the hammer raises it
      const C = 3, put = (t, u, v, rot = 0) => { const p = at(u, v); const r = B.buildPlace(t, p.x, p.z, rot); if (!r.ok) return r.why; const P0 = { x: P.x, z: P.z }, m = at(C, 0), dx = m.x - r.pc.x, dz = m.z - r.pc.z, d = Math.hypot(dx, dz) || 1; T.H.teleport(r.pc.x + dx / d * 1.3, r.pc.z + dz / d * 1.3); T.calm(); B.BUILD.work = { pc: r.pc, x: P.x, z: P.z, t: 0, auto: true }; T.until(() => r.pc.st === 'built', 16, 0.5); T.H.teleport(P0.x, P0.z); return r.pc.st; };
      const res = {};
      res.f2 = put('found', C, 0); res.f3 = put('found', 2 * C, 0);
      const mid = at(C, 0); T.H.teleport(mid.x, mid.z); T.calm();
      res.back0 = put('wall', 0, -C / 2); res.back1 = put('wall', C, -C / 2); res.back2 = put('wall', 2 * C, -C / 2);
      res.left = put('wall', -C / 2, 0); res.right = put('wall', 2 * C + C / 2, 0);
      const out = at(C, C * 1.8); T.H.teleport(out.x, out.z); T.calm();
      res.door = put('door', C, C / 2); res.win0 = put('window', 0, C / 2); res.win1 = put('window', 2 * C, C / 2);
      T.H.teleport(mid.x, mid.z); T.calm();
      res.hip0 = put('roofHip', 0, 0); res.hip1 = put('roofHip', C, 0); res.lean = put('roofLean', 2 * C, 0);
      res.well = 'no spot'; for (const [u, v] of [[C, C * 3.4], [-C * 1.8, C * 2], [C * 4, C * 2], [C, -C * 2.6], [-C * 2, -C], [C * 4.2, -C]]) { const w = at(u, v); T.H.teleport(w.x + 1.6, w.z); T.calm(); const sn = B.bValidate(B.bSnap('well', w.x, w.z, 0, P), P); if (!sn.ok) { res.well = sn.why; continue; } const r = B.buildPlace('well', w.x, w.z, 0); if (r.ok) { B.BUILD.work = { pc: r.pc, x: P.x, z: P.z, t: 0, auto: true }; T.until(() => r.pc.st === 'built', 16, 0.5); res.well = r.pc.st; } else res.well = r.why; break; }
      const roofs = BU.pieces.filter((pc) => (pc.t === 'roofHip' || pc.t === 'roofLean') && pc.st === 'built');
      const dry = roofs.map((pc) => +(B.buildRoofOver ? B.buildRoofOver(pc.x, pc.z) : 0) || 0);
      const inside = at(C, 0); const sheltered = T.H.fn.skyOver ? T.H.fn.skyOver({ x: inside.x, z: inside.z, y: a.y + 0.2 }) : null;
      return { res, dry, sheltered, n: BU.pieces.length, errors: T.H.errors.length }; })()""" % (B, bx, bz))
    res = r['res']
    check(res.get('hip0') == 'built' and res.get('hip1') == 'built', 'hip roofs go up on the walls: ' + json.dumps(res))
    check(res.get('lean') == 'built', 'a lean-to roof goes up beside them')
    check(res.get('win0') == 'built' and res.get('win1') == 'built' and res.get('door') == 'built', 'leaded windows (a pane of glass each) and a door')
    check(res.get('well') == 'built', 'a well is built')
    r = await ev(page, 'build: the well', """(() => { %s const w = BU.pieces.find((pc) => pc.t === 'well' && pc.st === 'built');
      if (!w) return { none: true };
      T.stand(w.x + 1.6, w.z, w.x, w.z); const label = T.label(); const s0 = T.F.goodsCount('water'); const S = T.S.SURV; S.thirst = 0.3;
      T.act(); T.sim(1); const drank = S.thirst > 0.9, skins = T.F.goodsCount('water') - s0;
      // a paddock near the well: its trough fills; a bed near it stays damp
      const A = T.A; let pen = null;
      for (let a = 0; a < 6.28 && !pen; a += 0.5) for (const d of [12, 16, 20]) { const x = w.x + Math.cos(a) * d, z = w.z + Math.sin(a) * d; if (!A.penSiteOk(x, z, 0, 6, 4.5)) { pen = A.penMake({ owner: 'player', x, z, yaw: 0, hw: 6, hd: 4.5, feed: 4, water: 0, name: 'Paddock W' }); break; } }
      const w0 = pen ? pen.water : null; T.sim(20, 1); const w1 = pen ? pen.water : null; T.penW = pen ? pen.id : null;
      return { label, drank, skins, w0, w1 }; })()""" % B)
    if r.get('none'): check(False, 'the well stands'); return
    check(r['label'] == 'Draw water from your well' and r['drank'] and r['skins'] >= 1, f"you draw water from your well: drink, and fill the skins (+{r['skins']})")
    check(r['w1'] is not None and r['w1'] > (r['w0'] or 0) + 1, f"it keeps a paddock's trough near it full ({r['w0']} -> {r['w1']})")
    r = await ev(page, 'build: doors for townsfolk', """(() => { %s const d = BU.pieces.find((pc) => pc.t === 'door' && pc.st === 'built');
      B.buildSetOpen(d, false); const c = Math.cos(d.yaw), s = Math.sin(d.yaw);
      // a townsman walks in through the doorway from outside and on into the cottage
      const e = T.F.spawnRealmUnit(0, 'warrior', 5, 'guard', d.x + s * 3.2, d.z + c * 3.2); e.role = 'walker'; e.y = d.y;
      T.H.teleport(d.x + s * 9 + c * 5, d.z + c * 9 - s * 5); T.calm();
      let opened = 0, through = false; const tx = d.x - s * 1.6, tz = d.z - c * 1.6;
      for (let i = 0; i < 70; i++) { const dx = tx - e.x, dz = tz - e.z, L = Math.hypot(dx, dz); if (L > 0.2) T.F.stepTo ? T.F.stepTo(e, e.x + dx / L * 0.09, e.z + dz / L * 0.09) : (e.x += dx / L * 0.09, e.z += dz / L * 0.09); e.yaw = Math.atan2(dx, dz); T.H.simulate(0.05); if (d.open) opened++; const lz = (e.x - d.x) * s + (e.z - d.z) * c; if (lz < -1) through = true; }
      const openMid = d.open; const t = T.until(() => !d.open, 8, 0.25);
      // one standing in the doorway does not stay there
      e.x = e.prevX = d.x; e.z = e.prevZ = d.z; T.sim(3, 0.25); const lz2 = (e.x - d.x) * s + (e.z - d.z) * c;
      const out = { opened, through, closedAfter: !d.open, t, lz2: +lz2.toFixed(2), npcDoors: T.D.stats().npcDoors };
      T.F.removeEnt(e); return out; })()""" % B)
    check(r['opened'] > 0 and r['through'], f"a townsman walking through a built doorway opens the door and passes ({r['npcDoors']} openings)")
    check(r['closedAfter'], f"and it swings shut behind him ({r['t']} s)")
    check(abs(r['lz2']) > 0.6, f"nobody stands in a doorway: he steps out of it ({r['lz2']} m)")
    r = await ev(page, 'build: the garrison spares its roofs', """(() => { const R = T.H.REALMS[0]; const HS = T.H.HOUSES || [];
      const H = HS.find((h) => !h.keepHall && h.realm === 0 && h.state === 'whole'); if (!H) return { none: true };
      const guard = T.H.ENT.find((e) => e.alive && e.faction === 0 && (e.role === 'guard' || e.role === 'villager') && e.kind === 'humanoid');
      const foe = T.F.makeEnt({ kind: 'humanoid', faction: 1, role: 'soldier', name: 'Raider', level: 30, x: H.x + 30, z: H.z, y: 0, yaw: 0, radius: 0.4 });
      T.dry();
      const n1 = T.F.fireLandsAt(H.x, H.y + 3, H.z, 3, guard); const s1 = H.state;
      const hall = HS.find((h) => h.keepHall && h.state === 'whole'); let n1h = null, hs = null; if (hall) { const K = T.H.WAR.keeps.find((k) => k.site === hall.S); const g2 = T.H.ENT.find((e) => e.alive && e.faction === K.realm && e.role === 'guard'); if (g2) { n1h = T.F.fireLandsAt(hall.x, hall.y + 3, hall.z, 3, g2); hs = hall.state; } }
      const n2 = T.F.fireLandsAt(H.x, H.y + 3, H.z, 3, foe); const s2 = H.state;
      T.F.removeEnt(foe);
      return { n1, s1, n1h, hs, n2, s2, spared: T.D.stats().spared }; })()""")
    if r.get('none'): check(False, 'a town house'); return
    check(r['n1'] == 0 and r['s1'] == 'whole' and (r['n1h'] is None or r['n1h'] == 0), f"the garrison's own fire never sets its town or keep hall alight (spared {r['spared']})")
    check(r['n2'] >= 1 and r['s2'] != 'whole', f"an enemy's fire does ({r['s2']})")

async def animal_tests(page):
    r = await ev(page, 'animals: a clutch hatches', """(() => { T.dry(); const P = T.P(), A = T.A;
      let pen = T.penW != null ? A.penById(T.penW) : null;
      if (!pen) { const R = T.H.REALMS[0]; for (let a = 0; a < 6.28 && !pen; a += 0.4) for (let d = 60; d < 160 && !pen; d += 10) { const x = R.town.x + Math.cos(a) * d, z = R.town.z + Math.sin(a) * d; if (!A.penSiteOk(x, z, 0, 6, 4.5)) pen = A.penMake({ owner: 'player', x, z, yaw: 0, hw: 6, hd: 4.5, feed: 20, water: 20, name: 'Paddock H' }); } }
      T.pen = pen.id; pen.feed = 20; pen.water = 20;
      const mk = (sex) => { const rec = A.anRecord('hen', { owner: 'player', sex, cmd: 'pen', pen: pen.id }); rec.mood = 1; rec.hunger = 1; rec.thirst = 1; return A.anSpawn(rec, pen.x + (sex === 'm' ? 1 : -1), pen.z); };
      const cock = mk('m'), hen = mk('f'); T.hen = hen.id; T.cock = cock.id;
      T.stand(pen.x + 12, pen.z + 9, pen.x, pen.z);
      const n0 = A.A.list.filter((e) => e.alive && e.tame && e.tame.k === 'hen').length;
      // she pairs, and at term lays a clutch in the nest box
      hen.tame.breedAt = T.H.GAME.t + 9999; hen.tame.preg = { left: 0.1, sire: { aid: cock.tame.aid, name: cock.tame.name, gen: 0, tr: JSON.parse(JSON.stringify(cock.tame.tr)) } }; T.sim(1.5);
      const nests = T.D.DEPTH.nests.length, eggs = T.D.DEPTH.nests[0] ? T.D.DEPTH.nests[0].eggs : 0;
      const label = (() => { const N = T.D.DEPTH.nests[0]; T.H.teleport(N.x + 1, N.z); T.calm(); return T.label(); })();
      T.H.teleport(pen.x + 12, pen.z + 9);
      T.sim(160, 1);
      const chicks = A.A.list.filter((e) => e.alive && e.tame && e.tame.k === 'hen' && !A.anAdult(e.tame) && e.tame.ma && e.tame.ma.aid === hen.tame.aid);
      return { nests, eggs, label, after: T.D.DEPTH.nests.filter((N) => N.ma.aid === hen.tame.aid).length, chicks: chicks.length, gen: chicks[0] ? chicks[0].tame.gen : null, pa: chicks[0] && chicks[0].tame.pa ? chicks[0].tame.pa.name === cock.tame.name : false, n0 }; })()""")
    check(r['nests'] >= 1 and r['eggs'] >= 3, f"a hen paired with the cockerel lays a clutch of {r['eggs']} eggs in the nest")
    check(r['label'] and r['label'].startswith('Take the eggs from the nest'), f"the eggs can be taken: \"{r['label']}\"")
    check(r['after'] == 0 and r['chicks'] >= 3 and r['gen'] == 1 and r['pa'], f"left alone, they hatch into {r['chicks']} chicks with both parents' traits")
    r = await ev(page, 'animals: a fertile egg', """(() => { const A = T.A, hen = T.F.getEnt(T.hen), pen = A.penById(T.pen);
      const n0 = A.A.list.filter((e) => e.alive && e.tame && e.tame.k === 'hen').length;
      let L = null; for (let i = 0; i < 12 && !L; i++) { hen.tame.prod.egg = 0.999; hen.tame.mood = 1; T.H.simulate(1.5); L = T.H.LOOT.find((q) => q.item && q.item.goods === 'egg' && q.hatch); }
      const fertile = !!L; if (L) L.hatch.at = T.H.GAME.t + 2;
      T.sim(4, 1); const n1 = A.A.list.filter((e) => e.alive && e.tame && e.tame.k === 'hen').length;
      return { fertile, hatched: n1 - n0, gone: L ? !T.H.LOOT.includes(L) : null }; })()""")
    check(r['fertile'] and r['hatched'] >= 1 and r['gone'], 'with a cockerel in the flock an egg left lying hatches into a chick')
    r = await ev(page, 'animals: moult', """(() => { const A = T.A, hen = T.F.getEnt(T.hen); hen.tame.moult = 239; const f0 = T.lootNear('feather', hen.x, hen.z, 12); T.sim(12, 1); return { feathers: T.lootNear('feather', hen.x, hen.z, 14) - f0 }; })()""")
    check(r['feathers'] >= 1, f"hens in a paddock moult feathers to gather ({r['feathers']})")
    r = await ev(page, 'animals: a hound herds the sheep', """(() => { const A = T.A, P = T.P(), pen = A.penById(T.pen);
      const sheep = []; for (let i = 0; i < 3; i++) { const rec = A.anRecord('sheep', { owner: 'player', sex: i ? 'f' : 'm', cmd: 'stay', pen: pen.id }); const s = A.anSpawn(rec, pen.x + 22 + i * 2.5, pen.z + 18 - i * 3); s.tame.stay = { x: s.x, z: s.z }; sheep.push(s); }
      const hrec = A.anRecord('hound', { owner: 'player', sex: 'm', cmd: 'follow' }); const hound = A.anSpawn(hrec, P.x + 1, P.z + 1); T.hound = hound.id; T.sheep = sheep.map((s) => s.id);
      T.stand(pen.x + 16, pen.z + 14, pen.x + 22, pen.z + 18);
      const herdable = T.D.depthHerdable ? null : null;
      A.openAnimalCard(hound); const btns = [...document.querySelectorAll('#dlg-actions button')].map((b) => b.textContent); const btn = [...document.querySelectorAll('#dlg-actions button')].find((b) => b.textContent === 'Herd the sheep in'); if (btn) btn.click(); else T.D.depthHerdStart(hound);
      const t = T.until(() => sheep.every((s) => A.penHas(pen, s.x, s.z)), 120, 1);
      return { btns, t, inside: sheep.filter((s) => A.penHas(pen, s.x, s.z)).length, cmd: hound.tame.cmd, herded: T.D.stats().herded }; })()""")
    check('Herd the sheep in' in r['btns'], "a hound's card offers to herd the sheep in")
    check(r['inside'] == 3 and r['cmd'] != 'herd', f"the hound gets round them and drives all {r['inside']} into the paddock ({r['t']} s), then comes back to heel")
    r = await ev(page, 'animals: the trough', """(() => { const A = T.A, pen = A.penById(T.pen); T.F.goodsAdd('water', 3, true); const e0 = T.F.goodsCount('waterskin_empty'), w0 = pen.water;
      A.openPen(pen); const btn = [...document.querySelectorAll('#dlg-actions button')].find((b) => b.textContent === 'Fill the trough'); if (btn) btn.click(); T.F.closeDialog && T.F.closeDialog();
      return { skins: T.F.goodsCount('waterskin_empty') - e0, water: +(pen.water - w0).toFixed(1) }; })()""")
    check(r['skins'] >= 1 and r['water'] > 0, f"filling the trough from your waterskins gives the skins back empty (+{r['skins']})")

async def shots(page):
    await page.evaluate("__hm.fn.setQuality('medium'); __hm.setTod(0.42); T.dry(); 0")
    # a burning bush
    await page.evaluate("""(() => { const R = T.H.REALMS[0]; const b = T.D.plant('bush', { x: R.town.x + 100, z: R.town.z + 90 }); T.sb = b; b.char = 0; b.cut = false; b.fire = 0; T.H.teleport(b.x + 6, b.z + 2); T.calm(); T.D.dpIgnite(b, 1); T.sim(5, 0.25); return 0; })()""")
    await shot(page, 'depth_bush_burning', "(() => { const b = T.sb; T.cam(b.x + 3.2, b.y + 1.6, b.z + 2.2, b.x, b.y + 0.5, b.z); return 0; })()")
    # a felled apple tree beside its stump
    await page.evaluate("""(() => { const a = T.D.plant('apple', T.H.REALMS[0].town, 3); let p = null; for (const q of T.H.depth.DEPTH && __hm.depth.plant ? [__hm.depth.plant('apple', { x: T.H.REALMS[0].town.x + 90, z: T.H.REALMS[0].town.z + 40 })] : []) p = q; const t = p && !p.cut ? p : a; T.sa = t; if (!t.cut) { T.D.dpFell(t, 1, 0.3); T.sim(6, 0.1); } return 0; })()""")
    await shot(page, 'depth_apple_felled', "(() => { const a = T.sa, F = a.fall; const sx = a.x - F.uz * 6.5 - F.ux * 1.5, sz = a.z + F.ux * 6.5 - F.uz * 1.5; T.cam(sx, a.y + 2.6, sz, a.x + F.ux * 1.6, a.y + 0.5, a.z + F.uz * 1.6); return 0; })()")
    # a crafted masterwork in hand
    await page.evaluate("""(() => { const P = T.P(), prog = T.H.GAME.prog; prog.level = 50; T.S.SURV.skill.craft = 100; for (const [id, n] of [['dragon_scale', 10], ['grave_iron', 10], ['trophy', 6], ['herb_stone', 4]]) T.F.goodsAdd(id, n, true);
      const R = T.S.RECIPES.find((r) => r.id === (P.cls === 'warrior' ? 'mw_warrior' : P.cls === 'archer' ? 'mw_archer' : P.cls === 'mage' ? 'mw_mage' : 'mw_priest')); T.S.survCraftOnce(R, { station: { kind: R.st } });
      const it = T.H.INV.bag.find((q) => q.name === R.mw); if (it) T.F.equipItem(it); T.F.applyGear(); const town = T.H.REALMS[0].town; T.H.teleport(town.x + 40, town.z + 40); T.calm(); T.sim(0.5); return 0; })()""")
    await shot(page, 'depth_masterwork', "(() => { const P = T.P(); const f = P.yaw; T.cam(P.x + Math.sin(f) * 2.6 + Math.cos(f) * 0.6, P.y + 1.6, P.z + Math.cos(f) * 2.6 - Math.sin(f) * 0.6, P.x, P.y + 1.1, P.z); return 0; })()")
    # the cottage with hip roofs, leaded windows and the well
    await shot(page, 'depth_cottage', "(() => { const BU = T.B.BUILD, a = BU.pieces.find((pc) => pc.id === T.home) || BU.pieces[0]; if (!a) return 0; const c = Math.cos(a.fyaw), s = Math.sin(a.fyaw); const ox = a.fx + 3 * c, oz = a.fz - 3 * s; T.cam(ox + 9 * s + 6 * c, a.y + 4.2, oz + 9 * c - 6 * s, ox + 1.5 * s, a.y + 1.6, oz + 1.5 * c); return 0; })()")
    await shot(page, 'depth_window', "(() => { const BU = T.B.BUILD, w = BU.pieces.find((pc) => pc.t === 'window' && pc.st === 'built'); if (!w) return 0; const c = Math.cos(w.yaw), s = Math.sin(w.yaw); T.cam(w.x + s * 2.2 + c * 0.6, w.y + 1.6, w.z + c * 2.2 - s * 0.6, w.x, w.y + 1.4, w.z); return 0; })()")
    # hens with chicks
    await shot(page, 'depth_chicks', "(() => { const hen = T.F.getEnt(T.hen); if (!hen) return 0; const A = T.A; for (const e of A.A.list) if (e.alive && e.tame && e.tame.k === 'hen' && Math.hypot(e.x - hen.x, e.z - hen.z) < 8) { e.x = e.prevX = hen.x + (Math.random() - 0.5) * 2; e.z = e.prevZ = hen.z + (Math.random() - 0.5) * 2; } T.sim(0.5, 0.1); T.cam(hen.x + 2.2, hen.y + 1.1, hen.z + 1.6, hen.x, hen.y + 0.15, hen.z); return 0; })()")
    # a hen pecking, close
    await shot(page, 'depth_hen_peck', "(() => { const hen = T.F.getEnt(T.hen); if (!hen) return 0; T.F.setAct ? 0 : 0; hen.anim.act = 7; hen.anim.actT = 0.5; hen.anim.actDur = 4; hen.ai.until = T.H.GAME.t + 5; T.H.simulate(0.4); const f = hen.yaw; T.cam(hen.x + Math.cos(f) * 0.9 + Math.sin(f) * 0.4, hen.y + 0.45, hen.z - Math.sin(f) * 0.9 + Math.cos(f) * 0.4, hen.x, hen.y + 0.2, hen.z); return 0; })()")
    # a sheep lying down to rest, close
    await shot(page, 'depth_sheep_rest', "(() => { const s = T.F.getEnt(T.sheep[1]); if (!s) return 0; s.anim.act = 9; s.anim.actT = 3; s.anim.actDur = 20; s.ai.until = T.H.GAME.t + 20; s.ai.mode = 'rest'; T.H.simulate(0.5); const f = s.yaw; T.cam(s.x + Math.cos(f) * 2.0 + Math.sin(f) * 0.8, s.y + 1.0, s.z - Math.sin(f) * 2.0 + Math.cos(f) * 0.8, s.x, s.y + 0.35, s.z); return 0; })()")
    # a hound herding sheep
    await page.evaluate("""(() => { const A = T.A, pen = A.penById(T.pen), hound = T.F.getEnt(T.hound); const sh = T.sheep.map(T.F.getEnt).filter(Boolean); sh.forEach((s, i) => { A.anCommand(s, 'stay'); s.tame.stay = null; s.x = s.prevX = pen.x + 18 + i * 1.6; s.z = s.prevZ = pen.z + 14 - i; s.tame.stay = { x: s.x, z: s.z }; }); hound.x = hound.prevX = pen.x + 10; hound.z = hound.prevZ = pen.z + 8; T.D.depthHerdStart(hound); T.sim(4, 0.1); return 0; })()""")
    await shot(page, 'depth_herding', "(() => { const hound = T.F.getEnt(T.hound), pen = T.A.penById(T.pen); T.cam(hound.x + 7, hound.y + 5, hound.z + 9, (hound.x + pen.x) / 2, hound.y + 0.4, (hound.z + pen.z) / 2); return 0; })()")
    await page.evaluate("T.play(); 0")

async def main():
    async with async_playwright() as p:
        w, h = (960, 540) if SHOTS else (640, 360)
        print('booting', flush=True)
        b, page, logs = await setup(p, w=w, h=h)
        page.set_default_timeout(900000)
        await page.evaluate("() => {" + HELPERS + "; return 0; }")
        await ev(page, 'start', "(() => { __hm.start({ realm: 0, cls: 'warrior', level: 30 }); __hm.UI.modal = null; __hm.setTod(0.45); __hm.simulate(0.5); T.dry(); T.calm(); return { errors: __hm.errors.length }; })()")
        for name, fn in (('nature', nature_tests), ('birds', bird_tests), ('craft', craft_tests), ('build', build_tests), ('animals', animal_tests)):
            if not on(name) or SHOTSONLY: continue
            try: await fn(page)
            except Exception as ex: check(False, f'{name} raised {str(ex)[:300]}')
        if SHOTS:
            try:
                if SHOTSONLY:
                    for fn in (build_tests, animal_tests):
                        try: await fn(page)
                        except Exception as ex: print('setup', ex)
                await shots(page)
            except Exception as ex: check(False, f'shots raised {str(ex)[:300]}')
        r = await page.evaluate("({ errors: __hm.errors.slice(0, 5).map(String), n: __hm.errors.length })")
        check(r['n'] == 0 and not logs, f"no errors ({r['n']}: {r['errors']} {logs[:3]})")
        await b.close()
    print(f'\n{len(FAILS)} failed' if FAILS else '\nall passed', f'[{time.time() - T0:.0f}s]')
    sys.exit(1 if FAILS else 0)

asyncio.run(main())
