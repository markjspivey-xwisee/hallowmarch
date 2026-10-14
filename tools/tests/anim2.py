"""[anim2] Bodies that never break (version 19): no leg left in the air, weapons held and used as weapons are,
Cinderwing's fall and every death.

The search (`war`, `duels`, `player`): every body drawn near the camera, every frame, read from what the shaders draw
(14a_anim2.js's probe: each foot's lowest sole point, each instance by its number): a foot well off the floor under it
(over what its swing reaches at its pace, and at least 20 cm) while the body stands or walks and is not in the air, or a
body standing still with both feet off the floor, is written down with what the body was doing, grouped by its kind and
action, and how long each body stayed so (episodes: the longest, how many lasted over 0.3 s and over 1 s). `war`: a
running war, the camera over its biggest fight, at FPS steps a second; `duels`: every pair of callings, skilled at 20 and
simple at 50, at 60 steps a second; `player`: the player's own doings by the keys, at 60 and at 20 frames a second
(stops at every point of the stride, turns on the spot, a jump and its landing, stunned in a run, mounting and
dismounting, kneeling); `ways`: the player up a tower's ladder by walking into it and down again, swimming out of a
lake onto its shore, into a boat at a jetty and out again, at 60 and 20 frames a second. Fails on any episode over 1 s,
and on the player's over 0.5 s.
`dead`: each calling of each realm and the camps' beasts struck down and lying: the lowest point of each over the floor
under it and its highest (nothing stands up off a body lying dead).
`dragon`: Cinderwing killed at its perch and lying: no vertex more than 15 cm under the ground, its neck, head and tail
down along the ground, its wings over it (not standing up like sails), its spade on its tail.
`weapons`: each calling of each realm (14a_anim2.js's a2GearMeasure, from what the shaders draw): the strike's blade in
the fist, at its fastest as the blow lands, its edge leading; the bow at full draw upright, its string's middle and the
arrow's nock at the drawing fingers, the arrow along the facing; the staff upright in a cast; the shield's face to the
foe in the guard.
`shots`: pictures at 960x540 (tools/out/anim2_*.png): Cinderwing dead from its side, from behind and from above, its
scales up close in daylight, people dead, the archer drawing, the guard, the mage casting, the strike.
usage: python3 tools/tests/anim2.py [only=war,duels,player,ways,dead,dragon,weapons,shots] [min=4] [q=low] [fps=30] [shots=dragon_dead_side,...]"""
import json, asyncio, sys, pathlib, time
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
from hmlib import setup, OUT
from playwright.async_api import async_playwright

ARGS = sys.argv[1:]
def arg(k, d):
    return next((a.split('=', 1)[1] for a in ARGS if a.startswith(k + '=')), d)
ONLY = arg('only', 'war,duels,player,ways,dead,dragon,weapons').split(',')
MIN = float(arg('min', '4'))
Q = arg('q', 'low')
FPS = int(arg('fps', '30'))
SHOTS = arg('shots', 'dragon_dead_side,dragon_dead_behind,dragon_dead_above,dragon_scales,dead_people,dead_close,strike_30,strike_45,strike_60,guard_front,draw_side,draw_front,cast_side,idle_side').split(',')
FAILS = []
T0 = time.time()

def check(cond, what):
    print(('  ok   ' if cond else '  FAIL ') + what, flush=True)
    if not cond: FAILS.append(what)

async def ev(page, js, label=None):
    r = await page.evaluate(js)
    if label: print(f'{label} [{time.time() - T0:.0f}s]', json.dumps(r)[:3000], flush=True)
    return r

HELP = r"""
window.A2T = {
  H: __hm, F: __hm.fn, A: __hm.anim2,
  calm() { const P = this.H.GAME.player; P.hp = P.maxHp = 1e7; P.buffs.length = 0; P.casting = null; P.target = null; P.testImmortal = true; },
  // the camera over a place, looking down at it from d m off (everything within ~40 m of it in view)
  over(x, z, d = 30, h = 22) { const H = this.H; H.UI.modal = 'menu'; H.CAM.mode = 'fixed'; const y = this.F.heightAt(x, z); H.camera.position.set(x - d * 0.6, y + h, z - d * 0.8); H.camera.lookAt(x, y, z); H.camera.updateMatrixWorld(); },
  // the biggest fight of the war: the body with the most others fighting about it
  fight() {
    const H = this.H; let best = null, bn = -1;
    for (const e of H.ENT) {
      if (!e.alive || e.kind !== 'humanoid' || !(e.combatUntil > H.GAME.t) || e.role === 'player') continue;
      let n = 0; for (const o of H.ENT) if (o.alive && o.kind !== 'door' && Math.abs(o.x - e.x) < 25 && Math.abs(o.z - e.z) < 25) n++;
      if (n > bn) { bn = n; best = e; }
    }
    return best ? { x: best.x, z: best.z, n: bn } : null;
  },
  // an open stretch near (cx, cz): motion.py's lane (no prop on the bodies' lines)
  lane(cx, cz, L, n) {
    const F = this.F, CV = this.H.dbg.COVER, clear = (x, z) => { const i = Math.floor(x + 512), j = Math.floor(z + 512); return !CV || i < 0 || j < 0 || i >= 1024 || j >= 1024 || CV.data[j * 1024 + i] === 0; };
    for (let r = 0; r < 160; r += 6) for (let k = 0; k < 16; k++) {
      const a = k / 16 * Math.PI * 2, x0 = cx + Math.sin(a) * r, z0 = cz + Math.cos(a) * r;
      for (const yaw of [0, 0.8, 1.6, 2.4]) {
        const ux = Math.sin(yaw), uz = Math.cos(yaw), sx = uz, sz = -ux;
        let ok = true, hmin = 1e9, hmax = -1e9;
        for (let i = 0; i < n && ok; i++) for (let j = -2; j <= L + 2 && ok; j += 0.75) for (const o of [-1, 0, 1]) { const x = x0 + ux * (j - L / 2) + sx * ((i - (n - 1) / 2) * 3 + o), z = z0 + uz * (j - L / 2) + sz * ((i - (n - 1) / 2) * 3 + o); if (!clear(x, z) || !F.isWalkable(x, z) || __hm.water.waterAt(x, z)) ok = false; else { const h = F.heightAt(x, z); hmin = Math.min(hmin, h); hmax = Math.max(hmax, h); } }
        if (ok && hmax - hmin < 0.6) return { x: x0, z: z0, ux, uz, sx, sz, L };
      }
    }
    return null;
  },
  made: [],
  clear() { for (const e of this.made) { if (e.mount) e.mount = null; this.F.removeEnt(e); } this.made = []; },
  person(x, z, yaw, cls = 'warrior', realm = 0) { const e = this.F.spawnRealmUnit(realm, cls, 20, 'test', x, z); e.yaw = yaw; e.prevX = e.x; e.prevZ = e.z; e.testMo = true; this.made.push(e); return e; },
  // people walking or running side by side, each stopping dead at its own point of the stride, then standing: the search
  // looks at them every frame (a raised foot should come down as the gait settles)
  stops(v, n, dt, tag) {
    const P = this.H.GAME.player, Ln = this.lane(P.x + 40, P.z + 40, v * 3 + 6, n);
    if (!Ln) return { err: 'no lane' };
    const es = [];
    for (let i = 0; i < n; i++) { const off = (i - (n - 1) / 2) * 3; es.push(this.person(Ln.x + Ln.sx * off - Ln.ux * v * 1.5, Ln.z + Ln.sz * off - Ln.uz * v * 1.5, Math.atan2(Ln.ux, Ln.uz))); }
    this.over(Ln.x, Ln.z, 10, 10);
    const T = Math.round(3.4 / dt);
    for (let s = 0; s < T; s++) {
      const t = s * dt;
      es.forEach((e, i) => { const tStop = 1.2 + i * (0.6 / n); const k = t < tStop ? Math.min(1, t / 0.35) : 0; e.x += Ln.ux * v * k * dt; e.z += Ln.uz * v * k * dt; e.yaw = Math.atan2(Ln.ux, Ln.uz); });
      this.A.a2Step(dt, { tag });
    }
    this.clear();
    return 0;
  },
  // duels of every pair of callings, skilled or simple, side by side (6 m apart within a ring), the search looking at
  // them every frame; each pair made again as it ends
  duels(lvl, kind, sec, dt, tag) {
    const H = this.H, F = this.F, B = H.bal, P = H.GAME.player, CL = ['warrior', 'archer', 'mage', 'priest'], pairs = [];
    for (let i = 0; i < 4; i++) for (let j = i + 1; j < 4; j++) pairs.push([CL[i], CL[j]]);
    const Ln = this.lane(P.x + 60, P.z + 60, 30, 3);
    if (!Ln) return { err: 'no lane' };
    const unit = (realm, cls, x, z) => { const e = F.spawnRealmUnit(realm, cls, lvl, 'bot', x, z); e.tweak = { hp: 1.1, dmg: 1.25 }; e.gear = B.fairGear(cls, lvl).tot; B.botMake(e, kind, { x, z, r: 9 }); F.setupStats(e); e.hp = e.maxHp; e.power = e.maxPower; e.a2duel = true; this.made.push(e); return e; };
    const spots = pairs.map((pr, i) => ({ x: Ln.x + Ln.sx * ((i % 3) - 1) * 11 + Ln.ux * (Math.floor(i / 3) - 0.5) * 14, z: Ln.z + Ln.sz * ((i % 3) - 1) * 11 + Ln.uz * (Math.floor(i / 3) - 0.5) * 14 }));
    const A = pairs.map(() => null);
    const make = (i) => { const s = spots[i], [a, b] = pairs[i]; const ua = unit(0, a, s.x - 4, s.z), ub = unit(1, b, s.x + 4, s.z); ua.bot.home = ub.bot.home = { x: s.x, z: s.z, r: 9 }; ua.target = ub.id; ub.target = ua.id; A[i] = { ua, ub, t0: H.GAME.t }; };
    pairs.forEach((_, i) => make(i));
    this.over(Ln.x, Ln.z, 22, 18);
    let duels = pairs.length;
    for (let s = 0; s < Math.round(sec / dt); s++) {
      this.A.a2Step(dt, { tag, r: 70 });
      if (s % 30 === 0) A.forEach((D, i) => { if (!D.ua.alive || !D.ub.alive || H.GAME.t - D.t0 > 40) { for (const e of [D.ua, D.ub]) { if (e.alive) F.killEnt(e, null); } if (H.GAME.t - Math.max(D.ua.deadAt || 0, D.ub.deadAt || 0) > 2.5 || H.GAME.t - D.t0 > 42) { for (const e of [D.ua, D.ub]) { F.removeEnt(e); } make(i); duels++; } } });
    }
    this.clear();
    return duels;
  },
  // the player's own doings by the keys, at dt a frame: walk, sprint and stop dead, turn on the spot, jump and land, stunned
  // in a run, mount and dismount, kneel, struck down and released; the search looks at the player every frame
  player(dt, tag) {
    const H = this.H, F = this.F, P = H.GAME.player, K = H.INPUT.keys, self = this;
    const Ln = this.lane(P.x + 30, P.z + 30, 40, 1);
    if (!Ln) return { err: 'no lane' };
    const yaw0 = Math.atan2(Ln.ux, Ln.uz);
    P.x = P.prevX = Ln.x - Ln.ux * 18; P.z = P.prevZ = Ln.z - Ln.uz * 18; P.y = F.heightAt(P.x, P.z); P.yaw = yaw0; P.onGround = true; P.vy = 0; P.endurance = 100;
    const chase = () => { H.UI.modal = null; H.CAM.mode = 'fixed'; H.camera.position.set(P.x - Math.sin(P.yaw) * 7, P.y + 4, P.z - Math.cos(P.yaw) * 7); H.camera.lookAt(P.x, P.y + 1, P.z); H.camera.updateMatrixWorld(); };
    const run = (sec, f) => { const n = Math.round(sec / dt); for (let i = 0; i < n; i++) { if (f) f(i * dt); H.CAM.yaw = H.CAM.yaw ?? yaw0; this.calm(); chase(); this.A.a2Step(dt, { tag }); } };
    const back = () => { P.x = P.prevX = Ln.x - Ln.ux * 18; P.z = P.prevZ = Ln.z - Ln.uz * 18; P.y = F.heightAt(P.x, P.z); P.yaw = yaw0; H.CAM.yaw = yaw0; };
    K.clear(); H.CAM.yaw = yaw0;
    const keys = (...ks) => { K.clear(); for (const k of ks) K.add(k); };
    // walk, stop; run, stop; sprint, stop (each a few times, at different points of the stride)
    for (const [ks, t] of [[['KeyW'], 1.3], [['KeyW'], 1.55], [['KeyW', 'ShiftLeft'], 1.2], [['KeyW', 'ShiftLeft'], 1.37], [['KeyW', 'ShiftLeft'], 1.5]]) { back(); keys(...ks); run(t); keys(); run(1.2); }
    // turning on the spot, both ways
    back(); keys(); run(1.5, (t) => { H.CAM.yaw = yaw0 + 2.5 * Math.sin(t * 2); P.yaw = H.CAM.yaw; });
    // a jump from a run and its landing, and one standing
    back(); keys('KeyW'); run(0.8); K.add('Space'); run(0.1); K.delete('Space'); run(1.2); keys(); run(0.8);
    keys('Space'); run(0.1); keys(); run(1.4);
    // stunned in a run
    back(); keys('KeyW', 'ShiftLeft'); run(0.9); F.addBuff(P, 'stun', 1, 1.2, 'test'); run(1.6); keys(); run(0.6);
    // mount, ride, stop, dismount (a horse called)
    back(); keys(); try { F.mountUp && F.mountUp(P); } catch (err) {} run(0.6); keys('KeyW'); run(1.4); keys(); run(0.8); try { F.dismount && F.dismount(P); } catch (err) {} run(1.2);
    // kneel (a priest's prayer: action 12), then up and away
    back(); keys(); P.anim.act = 12; P.anim.actT = 0; P.anim.actDur = 1.6; run(1.8); keys('KeyW'); run(0.8); keys(); run(0.8);
    K.clear();
    return 0;
  },
  // the player's ways on and off, by the keys, at dt a frame: into a Logres corner tower, up its ladder by walking into it
  // and off at its top, down again and off at its foot; swimming out of a lake onto its shore; into a boat at a jetty and
  // out onto the jetty. Each ends with the player standing (the search looks at it every frame)
  ways(dt, tag) {
    const H = this.H, F = this.F, P = H.GAME.player, K = H.INPUT.keys, out = {};
    const chase = () => { H.UI.modal = null; H.CAM.mode = 'fixed'; H.camera.position.set(P.x - Math.sin(P.yaw) * 6, P.y + 3.5, P.z - Math.cos(P.yaw) * 6); H.camera.lookAt(P.x, P.y + 1, P.z); H.camera.updateMatrixWorld(); };
    const step = (sec, f) => { const n = Math.round(sec / dt); let i = 0; for (; i < n; i++) { if (f && f(i * dt)) break; this.calm(); chase(); this.A.a2Step(dt, { tag }); } return +(i * dt).toFixed(2); };
    const toward = (x, z) => { H.CAM.yaw = Math.atan2(x - P.x, z - P.z); };
    K.clear();
    // the ladder: in at the store room's door, up to the guard room, down again, out into the court
    const K0 = H.WAR.keeps.find((q) => q.orig === 0 && q.site === H.REALMS[0].keepSites[0]), S = K0.site;
    const T = H.towers.TOWER.list.find((q) => q.S === S && q.sx === 1 && q.sz === 1), L = T.ladders[0];
    const w0 = F.siteToWorld(S, T.cx + Math.sin(T.aIn) * 0.9, T.cz + Math.cos(T.aIn) * 0.9), foot = F.siteToWorld(S, L.foot.x, L.foot.z), lad = { x: L.lx, z: L.lz }; // (the ladder's own place is in the world's frame)
    P.mount = null; P.motion = null; P.x = P.prevX = w0.x; P.z = P.prevZ = w0.z; P.y = S.y + T.yG; P.onGround = true; P.vy = 0;
    step(0.5);
    K.add('KeyW');
    out.walk = step(6, () => { toward(foot.x, foot.z); return Math.hypot(foot.x - P.x, foot.z - P.z) < 0.3; });
    out.into = step(2, () => { toward(lad.x, lad.z); return !!P.motion; });
    K.delete('KeyW'); out.climbing = P.motion ? P.motion.kind : null;
    out.up = step(15, () => !P.motion); out.yUp = +(P.y - S.y).toFixed(2);
    step(1.5);
    try { H.towers.towerLadderStart(P, L, -1); } catch (err) {}
    out.downing = P.motion ? P.motion.kind : null;
    out.down = step(15, () => !P.motion); out.yDown = +(P.y - S.y).toFixed(2);
    step(1.2);
    P.motion = null;
    // swimming out: from deep water beside Brackenford's jetty to its shore
    const Bt = H.water.boats, J = Bt.jetties().find((j) => j.realm === 0) || Bt.jetties()[0];
    if (J) {
      const ax = J.end.x - J.x0, az = J.end.z - J.z0, al = Math.hypot(ax, az) || 1, sx = -az / al * 5, sz = ax / al * 5;
      let sw = null; for (const s of [1, -1]) { const x = J.end.x + ax / al * 6 + sx * s, z = J.end.z + az / al * 6 + sz * s, w = H.water.waterAt(x, z); if (w && w.depth > 1.9) { sw = { x, z, s }; break; } }
      if (sw) {
        P.x = P.prevX = sw.x; P.z = P.prevZ = sw.z; const w = H.water.waterAt(sw.x, sw.z); P.y = w.y - 1.3; P.vy = 0;
        step(0.8); out.swam = !!P.swim; out.from = +Math.hypot(sw.x - J.x0, sw.z - J.z0).toFixed(1);
        const lx = J.x0 + sx * sw.s - ax / al * 6, lz = J.z0 + sz * sw.s - az / al * 6;
        K.add('KeyW'); out.swimOut = step(30, () => { toward(lx, lz); return !P.swim && !(P.swimK > 0.05) && !H.water.waterAt(P.x, P.z); }); K.delete('KeyW');
        out.ashore = !P.swim; step(1.5);
      }
      // a boat: into one moored at the jetty, a moment at the thwart, out onto the jetty
      let i = Bt.list().findIndex((q) => q.realm === J.realm && q.home && q.st === 'moored');
      if (i < 0) { i = Bt.list().findIndex((q) => q.realm === J.realm && q.home); if (i >= 0) try { Bt.restore(i); } catch (err) {} } // (the last run left it out on the water)
      if (i >= 0) {
        const b = Bt.state(i); P.x = P.prevX = J.end.x * 0.5 + J.x0 * 0.5; P.z = P.prevZ = J.end.z * 0.5 + J.z0 * 0.5; P.y = F.floorAt(P.x, P.z, P.y + 3); step(0.5);
        try { Bt.board(i); } catch (err) {} out.boarded = !!P.boat; step(1.5);
        try { Bt.leave(); } catch (err) {} out.left = !P.boat; out.yLeft = +P.y.toFixed(2); step(1.5);
        out.boatAt = [+b.x.toFixed(1), +b.z.toFixed(1)];
      }
    }
    K.clear();
    return out;
  },
  // an open stretch with no tree within r m of it or of a camera 7 m off it (for pictures and the gear)
  open(r = 12) {
    const H = this.H, P = H.GAME.player, T = H.seasons.treesNear;
    for (let d = 0; d < 420; d += 25) for (let k = 0; k < 12; k++) {
      const a = k / 12 * 6.283, L = this.lane(P.x + 40 + Math.sin(a) * d, P.z - 40 + Math.cos(a) * d, 6, 4);
      // (an orchard's apple trees are forage plants, not the world's trees: one stood in the bodies' row in a picture)
      const apple = (x, z, rr) => ((H.surv && H.surv.FORAGE && H.surv.FORAGE.list) || []).some((p) => p.k === 'apple' && !p.gone && Math.hypot(p.x - x, p.z - z) < rr);
      if (L && T(L.x, L.z, r).length === 0 && T(L.x + L.ux * 7, L.z + L.uz * 7, 9).length === 0 && !apple(L.x, L.z, r) && Math.hypot(L.x - 0.6, L.z + 0.4) > r + 14 /* (the Lone Tree's, W.heroTree: no tree of W.trees) */ && !apple(L.x + L.ux * 7, L.z + L.uz * 7, 9) && !H.water.waterAt(L.x + L.ux * 7, L.z + L.uz * 7)) return L;
    }
    return null;
  },
  // each calling of each realm, and the camps' beasts, struck down where they stand: after 2.5 s lying, each one's
  // lowest point over the floor under it, its highest, and its feet's highest
  dead(keep) {
    const H = this.H, F = this.F, A = this.A; this.calm(); this.clear();
    const Ln = this.open(14); if (!Ln) return { err: 'no open ground' };
    for (let i = -8; i <= 8; i += 1.5) for (let j = -8; j <= 8; j += 1.5) H.nature.natureCut(Ln.x + i, Ln.z + j, 1.2, 1, false);
    const es = [], cls = ['warrior', 'archer', 'mage', 'priest'];
    for (let r = 0; r < 3; r++) cls.forEach((c, i) => es.push(this.person(Ln.x + Ln.sx * (i * 2.6 - 3.9) + Ln.ux * (r * 2.6 - 2.6), Ln.z + Ln.sz * (i * 2.6 - 3.9) + Ln.uz * (r * 2.6 - 2.6), Math.atan2(Ln.ux, Ln.uz), c, r)));
    for (const type of ['wolf', 'boar', 'bear', 'skeleton', 'troll']) {
      const camp = H.CAMPS.find((c) => c.type === type); if (!camp) continue;
      const b = F.spawnMob(camp), k = es.length - 12;
      b.x = b.prevX = Ln.x + Ln.sx * (k * 3.2 - 6.4) + Ln.ux * 6.5; b.z = b.prevZ = Ln.z + Ln.sz * (k * 3.2 - 6.4) + Ln.uz * 6.5; b.y = F.heightAt(b.x, b.z); b.home = { x: b.x, z: b.z, r: 1 }; this.made.push(b); es.push(b);
    }
    // (and the deer, a horse and the farm beasts, made as motion.py makes them: a row beyond the people, from the camera)
    ['deer', 'horse', 'sheep', 'cattle', 'pig', 'hound'].forEach((kind, k) => {
      const x = Ln.x + Ln.sx * (k * 3.2 - 8) - Ln.ux * 6.5, z = Ln.z + Ln.sz * (k * 3.2 - 8) - Ln.uz * 6.5;
      const b = F.makeEnt({ kind, faction: 4, role: 'test', name: 'anim2 ' + kind, level: 5, x, z, y: F.heightAt(x, z), radius: 0.4, look: { colA: [0.45, 0.43, 0.4], colB: [0.3, 0.28, 0.26] }, scale: 1 });
      b.yaw = Math.atan2(Ln.sx, Ln.sz); b.prevX = b.x; b.prevZ = b.z; b.testMo = true; this.made.push(b); es.push(b);
    });
    this.over(Ln.x, Ln.z, 12, 9);
    for (let k = 0; k < 10; k++) A.a2Step(1 / 30, {});
    for (const e of es) { F.killEnt(e, null); e.removeAt = Infinity; }
    for (let k = 0; k < 75; k++) A.a2Step(1 / 30, {});
    const res = A.a2Step(1 / 30, {}), out = [];
    for (const R of res) if (R.deadLo !== undefined && es.includes(R.e)) out.push({ who: R.e.cls ? R.e.cls + ' ' + R.e.faction : (R.e.mobType || R.e.kind), kind: R.kind, lo: +R.deadLo.toFixed(3), top: +R.deadTop.toFixed(3), feet: +(R.deadHi ?? 0).toFixed(3) });
    window.__a2dead = { Ln, es };
    if (!keep) this.clear();
    return out;
  },
  // Cinderwing killed at a perch and lying (the pose it eases into, skinned here): how much of it is under the ground,
  // how high its neck and head, its tail's end and its wings stand, and whether every vertex out past its tail's end
  // (the spade) hangs on the tail's last bone
  dragon(perch = 0, yaw = 0.7) {
    const H = this.H, F = H.fn, D = H.dbg.DRAGON, AD = H.anim2.dragon, B = AD.DBI; this.calm();
    const P0 = D.perches[perch], e = D.e; if (!e || !P0) return { err: 'no dragon' };
    // (the perch's ground whole: the war's and the duels' craters before it left one under a perch, where it lay across the
    // bowl on its rims, its back 3.65 m over the bowl's floor: what this measures, its height over the ground under each part,
    // means nothing there)
    try { H.bal5.flattenCraters(); } catch (err) {}
    e.alive = true; e.hp = e.maxHp; e.x = P0.x; e.z = P0.z; e.y = F.heightAt(e.x, e.z); e.yaw = yaw; e.fixedY = null; H.dbg.setDragonState('perch'); D.act = null;
    const P = H.GAME.player; P.x = P.prevX = P0.x + 30; P.z = P.prevZ = P0.z + 30; P.y = F.heightAt(P.x, P.z);
    for (let i = 0; i < 30; i++) F.dragonAnimate(1 / 30);
    e.removeAt = Infinity; F.killEnt(e, P); e.removeAt = Infinity; e.fixedY = null; e.y = F.heightAt(e.x, e.z);
    for (let i = 0; i < 150; i++) F.dragonAnimate(1 / 30);
    AD.a2DragonPoseAt(D.pose, e);
    const G = AD.a2DragonGroups(), top = (ns) => +Math.max(...ns.flatMap((n) => (G[B[n]] || []).map((v) => AD.a2DragonH(v)))).toFixed(2);
    let under = 0, low = 1e9, spadeOff = 0;
    for (let v = 0; v < D.kit.n; v++) {
      const h = AD.a2DragonH(v); if (h < low) low = h; if (h < -0.15) under++;
      if (D.bindP[v * 3 + 2] < -9.2) { let b = -1, w = 0; for (let k = 0; k < 4; k++) if (D.bw[v * 4 + k] > w) { w = D.bw[v * 4 + k]; b = D.bi[v * 4 + k]; } if (b !== B.tail4) spadeOff++; }
    }
    // (version 18's dead pose, for the record: rolled 72 degrees onto its side, its neck and tail bent in its own frame)
    const was = { bodyPitch: 0, bodyRoll: 1.25, bodyY: -1.15, chest: 0, neck: [0.25, 0.3, 0.2], neckYaw: [0.3, 0.3, 0.2], head: 0.3, headYaw: 0, jaw: 0.35, tail: [-0.05, -0.05, -0.05, -0.05], tailYaw: [0.2, 0.25, 0.3, 0.3], fl: [0.4, 0.6, 0.3], fr: [-0.3, 0.8, 0.2], bl: [0.5, 0.4, 0.2], br: [-0.2, 0.5, 0.2], spread: 0, wl: [0.35, 0.5, 0.3, -0.1, 0.7, 0.3], wr: [-0.6, 0.9, 0.2, -0.3, 1.2, 0.6] };
    const now = { under, low: +low.toFixed(3), head: top(['neck3', 'head', 'jaw']), back: top(['hips', 'chest']), tail: top(['tail3', 'tail4']), wings: top(['wlF1', 'wlF2', 'wlF3', 'wlF4', 'wrF1', 'wrF2', 'wrF3', 'wrF4']) };
    AD.a2DragonPoseAt(was, e);
    let u0 = 0, l0 = 1e9; for (let v = 0; v < D.kit.n; v++) { const h = AD.a2DragonH(v); if (h < l0) l0 = h; if (h < -0.15) u0++; }
    const before = { under: u0, low: +l0.toFixed(3), head: top(['neck3', 'head', 'jaw']), back: top(['hips', 'chest']), tail: top(['tail3', 'tail4']), wings: top(['wlF1', 'wlF2', 'wlF3', 'wlF4', 'wrF1', 'wrF2', 'wrF3', 'wrF4']) };
    AD.a2DragonPoseAt(D.pose, e);
    return { st: D.state, ...now, spadeOff, before, solve: AD.A2D.stats, x: e.x, z: e.z, y: e.y, yaw: e.yaw };
  },
  // each calling of each realm in the open, their gear measured through the strike, the draw, a cast and the guard
  gear() {
    const H = this.H, A = this.A; this.calm(); this.clear();
    const Ln = this.open(12); if (!Ln) return { err: 'no open ground' };
    const es = [], cls = ['warrior', 'archer', 'mage', 'priest'];
    for (let r = 0; r < 3; r++) cls.forEach((c, i) => es.push(this.person(Ln.x + Ln.sx * (i * 2.5 - 3.75) + Ln.ux * (r * 2.5 - 2.5), Ln.z + Ln.sz * (i * 2.5 - 3.75) + Ln.uz * (r * 2.5 - 2.5), Math.atan2(Ln.ux, Ln.uz), c, r)));
    this.over(Ln.x, Ln.z, 8, 6);
    for (let k = 0; k < 10; k++) A.a2Step(1 / 30, {});
    const out = A.gear.a2GearMeasure(es, { n: 40 });
    this.clear();
    return out;
  },
  // pictures: the camera at a place, looking at a point (the HUD hidden)
  cam(px, py, pz, lx, ly, lz, fov = 40) { const H = this.H; H.UI.modal = 'menu'; H.CAM.mode = 'fixed'; const hud = document.getElementById('hud'); if (hud) hud.style.visibility = 'hidden'; H.camera.fov = fov; H.camera.updateProjectionMatrix(); H.camera.position.set(px, py, pz); H.camera.lookAt(lx, ly, lz); H.camera.updateMatrixWorld(); return 0; },
  // the callings side by side in the open, held at a point of an action (the clock stopped), facing along the row (side)
  // or toward the camera (front); the camera d m off
  pose(cls, act, at, view = 'side', d = 6.5, realm = 0) {
    const H = this.H, F = this.F, A = this.A;
    if (!this._pose || this._pose.key !== cls.join() + realm) {
      this.clear(); const Ln = this.open(16);
      for (let i = -5; i <= 5; i += 1.5) for (let j = -8; j <= 8; j += 1.5) H.nature.natureCut(Ln.x + i, Ln.z + j, 1.2, 1, false);
      const es = cls.map((c, i) => this.person(Ln.x + Ln.sx * (i - (cls.length - 1) / 2) * 1.9, Ln.z + Ln.sz * (i - (cls.length - 1) / 2) * 1.9, 0, c, realm));
      this._pose = { key: cls.join() + realm, Ln, es };
      for (let k = 0; k < 10; k++) A.a2Step(1 / 30, {});
    }
    const { Ln, es } = this._pose, yaw = view === 'front' ? Math.atan2(Ln.ux, Ln.uz) : Math.atan2(Ln.sx, Ln.sz);
    for (const e of es) { e.yaw = e.prevYaw = yaw; e.anim.act = act; e.anim.actDur = 1000; e.anim.actT = at * 1000; }
    for (let k = 0; k < 2; k++) A.a2Step(1 / 60, {});
    for (const e of es) e.anim.actT = at * 1000;
    const gy = F.heightAt(Ln.x, Ln.z);
    return this.cam(Ln.x + Ln.ux * d, gy + 1.3, Ln.z + Ln.uz * d, Ln.x, gy + 1.1, Ln.z);
  },
  // n frames of the search at dt, the camera following a place (a function giving x, z)
  run(n, dt, follow, tag) {
    for (let i = 0; i < n; i++) { if (follow && i % 15 === 0) { const f = follow(); if (f) this.over(f.x, f.z); } this.A.a2Step(dt, { tag }); }
    return this.A.A2.stats.frames;
  },
};
0;
"""

def summary(r, label, maxEp=1.0):
    st = r['stats']
    print("hist", json.dumps(dict(sorted(r.get("hist", {}).items()))), flush=True)
    print(f"{label}: frames {st['frames']}, bodies on their feet looked at {st['bodies']} (all looked at {st['looked']})", flush=True)
    for s in r['sigs'][:20]:
        print(f"  {s['n']:6d}  {s['sig']}", flush=True)
        for ex in s['ex'][:2]:
            print('          ', json.dumps(ex)[:500], flush=True)
    worst = 0
    for k, E in sorted(r.get('ep', {}).items(), key=lambda kv: -kv[1]['max']):
        print(f"  episodes {k}: {E['n']}, longest {E['max']} s (body {E['id']} at {E['at']} s), over 0.3 s {E['over03']}, over 1 s {E['over1']}, highest {E['hi']} m", flush=True)
        if E.get('ex') and E['max'] > 0.6: print('           a second in:', json.dumps(E['ex'])[:700], flush=True)
        worst = max(worst, E['max'])
    check(worst <= maxEp, f"{label}: no foot left in the air longer than {maxEp} s (longest {worst} s)")

async def main():
    res = {}
    async with async_playwright() as p:
        b, page, logs = await setup(p, w=640, h=360)
        page.on('console', lambda m: logs.append(f'[{m.type}] {m.text[:300]}') if m.type == 'error' else None)
        await ev(page, f"__hm.fn.setQuality('{Q}'); 0")
        await ev(page, HELP)
        if 'war' in ONLY:
            await ev(page, "__hm.start({ realm: 0, cls: 'warrior', level: 20 }); A2T.calm(); __hm.setTod(0.45); __hm.simulate(150); 0")
            print(f'war booted [{time.time() - T0:.0f}s]', flush=True)
            await ev(page, "__hm.anim2.a2Reset(); 0")
            rounds = max(1, int(MIN * 60 / 20))
            for k in range(rounds):
                f = await ev(page, f"(() => {{ A2T.calm(); __hm.simulate(10); const f = A2T.fight(); if (!f) return null; A2T.over(f.x, f.z); A2T.run({10 * FPS}, {1 / FPS}, () => A2T.fight(), 'war'); return f; }})()")
                if k % 3 == 0: print(f'  round {k + 1}/{rounds}: fight {f} [{time.time() - T0:.0f}s]', flush=True)
            r = await ev(page, "__hm.anim2.a2Report()")
            summary(r, 'war'); res['war'] = r
            check(r['stats']['bodies'] > 1000, f"the war's bodies looked at ({r['stats']['bodies']})")
        need = any(k in ONLY for k in ('duels', 'player', 'ways', 'dead', 'dragon', 'weapons', 'shots'))
        if need and 'war' not in ONLY:
            await ev(page, "__hm.start({ realm: 0, cls: 'warrior', level: 20 }); A2T.calm(); __hm.setTod(0.45); __hm.simulate(20); 0")
        if 'duels' in ONLY:
            for lvl, kind in ((20, 'skilled'), (50, 'simple')):
                await ev(page, "__hm.anim2.a2Reset(); 0")
                n = await ev(page, f"A2T.duels({lvl}, '{kind}', {MIN * 15}, 1 / 60, 'duel{lvl}')")
                r = await ev(page, "__hm.anim2.a2Report()")
                print(f'duels at {lvl}, {kind}: {n} duels [{time.time() - T0:.0f}s]', flush=True)
                summary(r, f'duels {lvl} {kind}'); res[f'duels{lvl}'] = r
        if 'player' in ONLY:
            for fps in (60, 20):
                await ev(page, "__hm.anim2.a2Reset(); 0")
                await ev(page, f"A2T.player({1 / fps}, 'p{fps}')")
                r = await ev(page, "__hm.anim2.a2Report()")
                print(f'player at {fps} frames a second [{time.time() - T0:.0f}s]', flush=True)
                summary(r, f'player {fps}', 0.5); res[f'player{fps}'] = r
            await ev(page, "(() => { const K = __hm.INPUT.keys; K.clear(); return 0; })()")
        if 'ways' in ONLY:
            for fps in (60, 20):
                await ev(page, "__hm.anim2.a2Reset(); 0")
                w = await ev(page, f"A2T.ways({1 / fps}, 'w{fps}')", f'ways at {fps} frames a second')
                r = await ev(page, "__hm.anim2.a2Report()")
                check(w.get('climbing') == 'ladder' and abs(w.get('yUp', 0) - 7) < 0.1 and w.get('downing') == 'ladder' and abs(w.get('yDown', 9)) < 0.3, f'the player up a tower ladder by walking into it and down again ({fps} frames a second)')
                check(w.get('swam') and w.get('ashore'), f'the player swims out of the lake onto its shore ({fps})')
                check(w.get('boarded') and w.get('left'), f'the player steps into a boat at the jetty and out again ({fps})')
                summary(r, f'ways {fps}', 0.5); res[f'ways{fps}'] = r
            await ev(page, "(() => { const K = __hm.INPUT.keys; K.clear(); return 0; })()")
        if 'dead' in ONLY:
            r = await ev(page, "A2T.dead()", 'dead')
            res['dead'] = r
            if isinstance(r, list):
                for d in r: print('  ', json.dumps(d), flush=True)
                hum = [d for d in r if d['kind'] == 'human' and d['who'][-1].isdigit()]; oth = [d for d in r if d['kind'] == 'human' and not d['who'][-1].isdigit()]; bst = [d for d in r if d['kind'] != 'human']
                check(len(hum) == 12, f'twelve people lying dead measured ({len(hum)})')
                check(all(-0.08 <= d['lo'] <= 0.1 for d in hum), 'each person lies on the floor (its lowest point within -8 and 10 cm of it): ' + ', '.join(f"{d['who']} {d['lo']}" for d in hum))
                check(all(d['top'] < 0.5 for d in hum), 'nothing stands up off a person lying dead (its highest point under 0.5 m): ' + ', '.join(f"{d['who']} {d['top']}" for d in hum))
                check(len(bst) >= 9 and all(-0.12 <= d['lo'] <= 0.12 for d in bst + oth), 'each beast (the camps\', the deer, a horse, the farm beasts), the dead and a troll lie on the floor: ' + ', '.join(f"{d['who']} {d['lo']}" for d in bst + oth))
        if 'dragon' in ONLY:
            r = await ev(page, "A2T.dragon()", 'dragon')
            res['dragon'] = r
            check(r.get('st') == 'dead', 'Cinderwing dead')
            check(r.get('under', 1) == 0 and r.get('low', -1) > -0.15, f"none of it more than 15 cm under the ground (lowest {r.get('low')} m, {r.get('under')} vertices)")
            check(r.get('head', 9) < 1.6, f"its neck and head down along the ground (their highest {r.get('head')} m)")
            check(r.get('tail', 9) < 1.4, f"its tail down along the ground (its end's highest {r.get('tail')} m)")
            check(r.get('wings', 9) < 2.4, f"its wings over the ground, not standing up (their fingers' highest {r.get('wings')} m)")
            check(r.get('spadeOff', 1) == 0, f"the spade hangs on the tail's end ({r.get('spadeOff')} of its vertices on another bone)")
            r2 = await ev(page, "A2T.dragon(1, 2.6)", 'dragon, a second perch')
            check(r2.get('under', 1) == 0 and r2.get('head', 9) < 1.6 and r2.get('tail', 9) < 1.4 and r2.get('wings', 9) < 2.4, 'and at a second perch, turned another way')
        if 'weapons' in ONLY:
            r = await ev(page, "A2T.gear()")
            res['weapons'] = r
            for g in r: print('  ', json.dumps(g), flush=True)
            st = [g for g in r if g.get('strike')]
            check(len(st) >= 6 and all(abs(g['strike']['peakAt'] - g['strike']['landsAt']) < 0.06 for g in st), 'each blow at its fastest as it lands: ' + ', '.join(f"{g['cls']}{g['realm']} {g['strike']['peakAt']}" for g in st))
            check(all(g['strike']['gripDrift'] < 0.005 for g in st), 'each weapon stays in its fist through the swing')
            ed = [g for g in st if g['strike']['edgeLead'] is not None]
            check(len(ed) >= 3 and all(g['strike']['edgeLead'] > 0.75 for g in ed), 'a blade or an axe cuts edge first: ' + ', '.join(f"{g['cls']}{g['realm']} {g['strike']['edgeLead']}" for g in ed))
            dr = [g for g in r if g.get('draw')]
            check(len(dr) == 3 and all(g['draw']['staveUp'] > 0.9 for g in dr), 'a drawn bow stands upright: ' + ', '.join(str(g['draw']['staveUp']) for g in dr))
            check(all((g['draw']['stringToFist'] or 9) < 0.09 and (g['draw']['nockToFist'] or 9) < 0.07 for g in dr), 'the string and the arrow at the drawing fingers: ' + ', '.join(f"{g['draw']['stringToFist']}/{g['draw']['nockToFist']}" for g in dr))
            check(all((g['draw']['arrowFwd'] or 0) > 0.75 for g in dr), 'the arrow along the facing: ' + ', '.join(str(g['draw']['arrowFwd']) for g in dr))
            cs = [g for g in r if g.get('cast')]
            check(len(cs) == 3 and all(g['cast']['staffUp'] > 0.85 for g in cs), 'a staff upright as it is cast: ' + ', '.join(str(g['cast']['staffUp']) for g in cs))
            hm = [g for g in r if g.get('hem')]
            check(len(hm) >= 3 and all(g['hem']['reach'] < 0.75 for g in hm), "a robe's hem carried no farther than 0.75 m from the body in any action: " + ', '.join(f"{g['cls']}{g['realm']} {g['hem']['reach']} (act {g['hem']['act']})" for g in hm))
            gd = [g for g in r if g.get('guard')]
            check(len(gd) >= 3 and all(g['guard']['shieldFaces'] > 0.5 for g in gd), 'a shield in the guard faces the foe: ' + ', '.join(f"{g['cls']}{g['realm']} {g['guard']['shieldFaces']}" for g in gd))
        if 'shots' in ONLY:
            await page.set_viewport_size({'width': 960, 'height': 540})
            async def shot(name, js):
                if name not in SHOTS: return
                await ev(page, js)
                await ev(page, "__hm.frame(); 0")
                await page.screenshot(path=str(pathlib.Path(OUT) / f'anim2_{name}.png'), timeout=300000)
                print(f'  shot anim2_{name}.png [{time.time() - T0:.0f}s]', flush=True)
            await ev(page, "__hm.setTod(0.42); 0")
            d = await ev(page, "A2T.dragon()")
            if d.get('st') == 'dead':
                x, z, y, yw = d['x'], d['z'], d['y'], d['yaw']
                import math
                def around(a, dist, h, ly=1.0): return f"A2T.cam({x + math.sin(yw + a) * dist}, {y + h}, {z + math.cos(yw + a) * dist}, {x}, {y + ly}, {z})"
                await shot('dragon_dead_side', around(1.25, 17, 5))
                await shot('dragon_dead_behind', around(3.6, 13, 3.5, 0.6))
                await shot('dragon_dead_above', around(0.9, 15, 13))
                await shot('dragon_scales', around(1.6, 5.5, 1.8, 1.2))
            await ev(page, "A2T.dead(true); 0")
            await shot('dead_people', "(() => { const { Ln } = window.__a2dead, gy = __hm.fn.heightAt(Ln.x, Ln.z); return A2T.cam(Ln.x + Ln.ux * 7 + Ln.sx * 5, gy + 2.6, Ln.z + Ln.uz * 7 + Ln.sz * 5, Ln.x, gy + 0.2, Ln.z); })()")
            await shot('dead_close', "(() => { const e = window.__a2dead.es[3], fx = Math.sin(e.yaw), fz = Math.cos(e.yaw); return A2T.cam(e.x - fx * 0.9 + fz * 2.6, e.y + 1.0, e.z - fz * 0.9 - fx * 2.6, e.x - fx * 0.9, e.y + 0.1, e.z - fz * 0.9); })()")
            await ev(page, "A2T.clear(); A2T._pose = null; 0")
            for at in (0.3, 0.45, 0.6):
                await shot(f'strike_{int(at * 100)}', f"A2T.pose(['warrior', 'priest'], 1, {at}, 'side', 4)")
            await shot('guard_front', "A2T.pose(['warrior', 'priest'], 10, 0.6, 'front', 3.6)")
            await ev(page, "A2T.clear(); A2T._pose = null; 0")
            await shot('draw_side', "A2T.pose(['archer', 'mage'], 2, 0.75, 'side', 3.4)")
            await shot('draw_front', "A2T.pose(['archer', 'mage'], 2, 0.75, 'front', 3.4)")
            await shot('cast_side', "(() => { A2T._pose.es[1].anim.act = 3; return A2T.pose(['archer', 'mage'], 3, 0.6, 'side', 3.4); })()")
            # (each calling standing and as it walks, side on: what the hands carry when nothing is being done with it)
            await ev(page, "A2T.clear(); A2T._pose = null; 0")
            await shot('idle_side', "A2T.pose(['warrior', 'archer', 'mage', 'priest'], 0, 0, 'side', 5.5)")
            await page.set_viewport_size({'width': 640, 'height': 360})
        errs = await ev(page, "__hm.errors.slice(0, 5)")
        check(not errs, f'no runtime errors ({errs})')
        await b.close()
    (pathlib.Path(OUT) / 'anim2_search.json').write_text(json.dumps(res, indent=1))
    print(f'done [{time.time() - T0:.0f}s]', 'FAILS: ' + '; '.join(FAILS) if FAILS else '', flush=True)

asyncio.run(main())
