"""The Barrow end to end: walk in, wake the Hollow King, raise the dead, reset, warden and gate, vents, crypt chest, climb out."""
import json, asyncio, sys
import sys, pathlib
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
from hmlib import setup, OUT
from playwright.async_api import async_playwright
async def frames(page, n=3):
    for _ in range(n): await page.evaluate("new Promise(r=>requestAnimationFrame(()=>r()))")
async def ev(page, js):
    r = await page.evaluate(js)
    print(json.dumps(r)[:1500])
    return r
async def main():
    async with async_playwright() as p:
        b, page, logs = await setup(p, w=900, h=500)
        await page.evaluate("__hm.start({realm:1, cls:'warrior', level:20})")
        # 1. walk into the passage
        await ev(page, """(() => { const H = __hm, P = H.GAME.player, F = H.fn;
          const S = H.DUN && H.dbg ? null : null;
          const B = H.BARROW; const c = Math.cos(B.yaw), s = Math.sin(B.yaw);
          // site-local (0, 3.6) -> world
          const lx = 0, lz = 3.6; const x = B.x + lx * c + lz * s, z = B.z - lx * s + lz * c;
          H.teleport(x, z); H.simulate(0.2);
          return { inside: H.INDOOR.on, travelling: H.UI.travelling, pos: [P.x, P.z], y: P.y }; })()""")
        await page.wait_for_timeout(900)
        await ev(page, "(() => { const H = __hm, P = H.GAME.player; return { indoor: H.INDOOR.on, pos: [P.x.toFixed(1), P.z.toFixed(1), P.y.toFixed(2)], zone: H.fn.zoneAt(P.x, P.z).name }; })()")
        # 2. the king sits; wake him and fight a little
        await ev(page, """(() => { const H = __hm, P = H.GAME.player, F = H.fn, D = H.DUN; const K = F.getEnt(H.BARROW_STATE.king);
          const a = F.dunPoint(186, 0); H.teleport(a.x, a.z); H.simulate(1.0);
          return { seat: !!K.seat, awake: K.ai.awake, stepOff: !!K.ai.stepOff, kpos: [K.x.toFixed(1), K.y.toFixed(2)], hp: Math.round(K.hp), maxHp: Math.round(K.maxHp), lvl: K.level }; })()""")
        await ev(page, """(() => { const H = __hm, F = H.fn; const K = F.getEnt(H.BARROW_STATE.king); H.simulate(1.5);
          return { awake: K.ai.awake, stepOff: !!K.ai.stepOff, seat: !!K.seat, kpos: [K.x.toFixed(1), K.z.toFixed(1), K.y.toFixed(2)], fixedY: K.fixedY, target: K.target }; })()""")
        # take damage down past 85% to raise the dead
        await ev(page, """(() => { const H = __hm, F = H.fn, P = H.GAME.player; const K = F.getEnt(H.BARROW_STATE.king);
          F.dealDamage(P, K, K.maxHp * 0.2, {}); H.simulate(0.4);
          const tombs = H.DUN.tombs.map(t => [t.target, t.open.toFixed(2)]);
          return { hp: (K.hp / K.maxHp).toFixed(2), adds: H.BARROW_STATE.adds.size, tombs }; })()""")
        await ev(page, """(() => { const H = __hm, F = H.fn; H.simulate(0.9);
          const adds = [...H.BARROW_STATE.adds].map(id => F.getEnt(id)).filter(Boolean).map(o => ({ y: o.y.toFixed(2), fy: o.fixedY, rise: !!o.rise, name: o.name }));
          return { adds, tombs: H.DUN.tombs.map(t => t.open.toFixed(2)) }; })()""")
        # screenshot: an add climbing out
        await ev(page, """(() => { const H = __hm, F = H.fn; const ids = [...H.BARROW_STATE.adds]; const o = F.getEnt(ids[0]); if (!o) return 'none';
          H.UI.modal = 'menu'; H.CAM.mode = 'fixed'; H.camera.position.set(o.x - 3.5, o.y + 2.6, o.z + (F.dunRoomAt(o.x, o.z) && o.z > 0 ? -4.5 : 4.5)); H.camera.lookAt(o.x, o.y + 1.0, o.z); return [o.x, o.z, o.y]; })()""")
        await frames(page, 4)
        await page.screenshot(path=OUT + 'dun_rise.png', timeout=300000)
        await ev(page, """(() => { const H = __hm, F = H.fn; H.UI.modal = null; H.CAM.mode = 'play'; H.simulate(1.2);
          const adds = [...H.BARROW_STATE.adds].map(id => F.getEnt(id)).filter(Boolean).map(o => ({ y: o.y.toFixed(2), fy: o.fixedY, rise: !!o.rise, walk: F.isWalkable(o.x, o.z) }));
          return { adds }; })()""")
        # 3. reset: player leaves the hall -> king resets onto the throne
        await ev(page, """(() => { const H = __hm, F = H.fn, P = H.GAME.player; const K = F.getEnt(H.BARROW_STATE.king);
          const a = F.dunPoint(120, 0); H.teleport(a.x, a.z); H.simulate(6);
          return { seat: !!K.seat, awake: K.ai.awake, hp: (K.hp / K.maxHp).toFixed(2), adds: H.BARROW_STATE.adds.size, tombs: H.DUN.tombs.map(t => t.target) }; })()""")
        # 4. the warden opens the gate
        await ev(page, """(() => { const H = __hm, F = H.fn, P = H.GAME.player; const W = F.getEnt(H.BARROW_STATE.warden);
          W.damagers = new Set([P.id]); F.killEnt(W, P); H.simulate(5);
          const g = H.DUN.gates.well; return { wardenDead: H.BARROW_STATE.wardenDead, open: g.open.toFixed(2), coll: g.coll.active, meshY: g.mesh.position.y.toFixed(2) }; })()""")
        # 5. vents burn
        await ev(page, """(() => { const H = __hm, F = H.fn, P = H.GAME.player; const v = H.DUN.vents[0]; H.teleport(v.x, v.z); const hp0 = P.hp; H.simulate(4.5);
          return { hp0: Math.round(hp0), hp: Math.round(P.hp), alive: P.alive }; })()""")
        # 6. crypt chest
        await ev(page, """(() => { const H = __hm, F = H.fn, P = H.GAME.player; P.hp = P.maxHp; const ch = H.DUN.chests.find(c => c.id === 'crypt');
          for (const e of H.ENT) if (e.alive && e.faction === H.FACTION_MONSTER && e.x > 1000 && Math.hypot(e.x - ch.x, e.z - ch.z) < 14) { e.damagers = new Set([P.id]); F.killEnt(e, P); }
          H.teleport(ch.x + 1.5, ch.z); H.simulate(0.5); const n0 = H.LOOT.length; F.playerInteract(); H.simulate(1.2);
          return { opened: ch.opened, loot: H.LOOT.length - n0, lid: ch.lid.toFixed(2) }; })()""")
        # 7. climb out by the stair
        await ev(page, """(() => { const H = __hm, F = H.fn, P = H.GAME.player; const a = F.dunPoint(-1.5, 0); H.teleport(a.x, a.z);
          const ys = []; for (let u = -1.5; u > -6.2; u -= 0.7) { const q = F.dunPoint(u, 0); ys.push(q.y.toFixed(2) + (F.isWalkable(q.x, q.z) ? '' : 'x')); }
          const q = F.dunPoint(-5.8, 0); H.teleport(q.x, q.z); H.simulate(0.2); return { ys, travelling: H.UI.travelling }; })()""")
        await page.wait_for_timeout(900)
        await ev(page, "(() => { const H = __hm, P = H.GAME.player; return { indoor: H.INDOOR.on, pos: [P.x.toFixed(1), P.z.toFixed(1)], zone: H.fn.zoneAt(P.x, P.z).name, errors: H.errors }; })()")
        print('logs', logs[:5])
        await b.close()
asyncio.run(main())
