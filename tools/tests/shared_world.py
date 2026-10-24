"""Real two-browser shared-world regression; no synthetic scene frames are injected.

Run after npm ci --prefix tools, npm ci --prefix server and python build.py:
    python tools/tests/shared_world.py

Desktop and phone use independent browser contexts, characters and private saves.
The fixture drives the same boat, building, farming and combat entry points as UI.
Snapshots, ownership grants, commands and host handoffs travel over the real server.
"""
import asyncio
import json
import math
import os
import pathlib
import shutil
import subprocess
import tempfile
import time
import urllib.request

from playwright.async_api import async_playwright
import net as fixture

ROOT = pathlib.Path(__file__).resolve().parents[2]
OUT = fixture.OUT
REPORT = {"cases": [], "wire": {}, "errors": []}
WIRES = []


def require(ok, message, **detail):
    REPORT["cases"].append({"ok": bool(ok), "message": message, **detail})
    print(("ok   " if ok else "FAIL ") + message, flush=True)
    if not ok:
        raise AssertionError(message + (": " + json.dumps(detail) if detail else ""))


def http_json(origin, path):
    with urllib.request.urlopen(origin + path, timeout=5) as response:
        return json.loads(response.read())


async def pulse(pages, seconds=0.2):
    """Keep trusted foreground input live; simulation and wall time advance together."""
    count = max(1, math.ceil(seconds / 0.1))
    for _ in range(count):
        started = time.monotonic()
        for page in pages:
            if page.is_closed():
                continue
            await fixture.human_play(page)
            await page.evaluate("__hm.simulate(0.1); 0")
        await asyncio.sleep(max(0.01, 0.1 - (time.monotonic() - started)))


async def eventually(pages, check, seconds=30):
    until = time.monotonic() + seconds
    while time.monotonic() < until:
        result = await check()
        if result:
            return result
        await pulse(pages)
    return await check()


async def travel(pages, page, x, z):
    # The real server's movement check remains enabled. Fixture positioning moves
    # at <=30m/s, instead of injecting a forbidden instantaneous network jump.
    position = await page.evaluate("({x:NT.P.x,z:NT.P.z})")
    distance = math.hypot(x - position["x"], z - position["z"])
    steps = max(1, math.ceil(distance / 3))
    for i in range(1, steps + 1):
        u = i / steps
        await page.evaluate("([x,z]) => { __hm.teleport(x,z); NT.P.hp=NT.P.maxHp; }",
                            [position["x"] + (x-position["x"])*u,
                             position["z"] + (z-position["z"])*u])
        await pulse(pages, 0.1)
    await pulse(pages, 0.4)


async def boot(browser, origin, url, name, realm, cls, level, phone=False):
    context = await browser.new_context(viewport={"width": 430, "height": 932} if phone
                                        else {"width": 1100, "height": 720},
                                        has_touch=phone, is_mobile=phone, ignore_https_errors=True)
    def socket_open(socket):
        def frame(payload):
            if isinstance(payload, str):
                try:
                    body = json.loads(payload)
                    if body.get("t") == "activity":
                        WIRES.append({"bytes": len(payload.encode()), "kind": body.get("kind"),
                                      "op": body.get("op")})
                except (ValueError, TypeError):
                    pass
        socket.on("framesent", frame)
        socket.on("framereceived", frame)
    # Save/transport discovery can open its socket during boot, before boot()
    # returns the page, so attach through the context's page event first.
    context.on("page", lambda page: page.on("websocket", socket_open))
    page = await fixture.boot(context, {"room": "shared-world", "shard": "shared-world",
                              "user": name, "noRoom": True, "server": url}, name)
    await fixture.start(page, realm, cls, level, name)
    await page.evaluate("NT.P.maxHp=100000; NT.P.hp=100000; 0")
    page._context = context
    return page


async def readiness(pages):
    async def ready():
        values = []
        for page in pages:
            values.append(await page.evaluate("""(() => {
              const H=__hm;
              return !!(NT.st().state==='on' && NT.st().kind==='ws'
                && H.netboats?.NET_BOATS.authority && H.npcs?.state.authority
                && H.entities?.state().complete && H.worldparts?.NETPARTS.ready);
            })()"""))
        return all(values)
    require(await eventually(pages, ready, 45), "both independent characters receive shared-scene authority")
    peers = [await p.evaluate("NT.st().self") for p in pages]
    require(len(set(peers)) == len(pages), "phone and desktop have independent player identities", peers=peers)
    return peers


async def npc_rows(page):
    return await page.evaluate("""__hm.npcs.snapshot().map(r=>({id:r.id,n:r.n,role:r.role,
      r:r.r,p:r.p,lk:r.lk,fm:r.fm,d:r.d,g:r.g})).sort((a,b)=>a.id.localeCompare(b.id))""")


async def town_case(pages):
    async def same_roster():
        a, b = await asyncio.gather(*(npc_rows(p) for p in pages))
        if len(a) < 21 or len(a) != len(b):
            return False
        return all(x["id"] == y["id"] and x["n"] == y["n"] and x["lk"] == y["lk"]
                   and x["fm"] == y["fm"] and math.dist(x["p"], y["p"]) < 2.5
                   for x, y in zip(a, b))
    require(await eventually(pages, same_roster),
            "phone and desktop draw the same complete townspeople and farmer identities")
    rows = await npc_rows(pages[0])
    farmers = [r for r in rows if r["fm"] and r["fm"][1]]
    require(bool(farmers), "the shared roster includes active field workers", farmers=len(farmers))
    worker = farmers[0]
    for page in pages:
        await travel(pages, page, worker["p"][0] + 2, worker["p"][2] + 2)
    await pulse(pages, 1)
    views = []
    for page in pages:
        views.append(await page.evaluate("""id=>{ const H=__hm, E=H.npcs.state.entities.get(id);
          H.frame(1/30); return E && {visible:H.npcs.visible(E),x:E.x,z:E.z,
            farmer:!!E.ai?.fieldHand, alive:E.alive}; }""", worker["id"]))
    require(all(v and v["visible"] and v["farmer"] and v["alive"] for v in views),
            "both devices at the same field render the same working villager", views=views)


async def boat_case(pages):
    desktop, phone = pages
    candidates = await phone.evaluate("__hm.water.boats.list().filter(b=>b.realm===0 && b.st!=='burnt' && b.st!=='burning')")
    require(bool(candidates), "a real realm boat is available")
    candidate = candidates[0]
    index = candidate["i"]
    for page in pages:
        await travel(pages, page, candidate["x"], candidate["z"])
    # Race the two genuine board requests before giving either browser its grant.
    await asyncio.gather(*(p.evaluate("i=>__hm.water.boats.board(i)", index) for p in pages))
    async def one_rider():
        occupied = [await p.evaluate("!!NT.P.boat") for p in pages]
        return occupied if sum(occupied) == 1 else False
    occupied = await eventually(pages, one_rider)
    require(bool(occupied), "two simultaneous board attempts grant exactly one seat")
    rider = pages[occupied.index(True)]
    observer = pages[occupied.index(False)]
    before = await rider.evaluate("i=>__hm.water.boats.state(i)", index)
    await rider.evaluate("__hm.INPUT.keys.add('KeyW'); 0")
    try:
        await pulse(pages, 5)
    finally:
        await rider.evaluate("__hm.INPUT.keys.delete('KeyW'); 0")
    await pulse(pages, 0.8)
    a, b = await asyncio.gather(*(p.evaluate("i=>__hm.water.boats.state(i)", index) for p in pages))
    moved = math.hypot(a["x"]-before["x"], a["z"]-before["z"])
    require(moved > 0.75, "a boarded boat really rows away from its berth", distance=moved)
    require(math.hypot(a["x"]-b["x"], a["z"]-b["z"]) < 1.25,
            "both devices show the moved boat at the same position", desktop=a, phone=b)
    rider_peer = await rider.evaluate("NT.st().self")
    seat = await observer.evaluate("""peer=>{const H=__hm,g=H.net.ghost(peer);
      return g && {boat:g.boat?.id,seat:!!g.seat,delta:g.boat?Math.hypot(g.x-g.boat.x,g.z-g.boat.z):999};}""", rider_peer)
    require(seat and seat["boat"] == a["id"] and seat["seat"] and seat["delta"] < 3,
            "the remote character sits in the canonical boat rather than floating in water", seat=seat)
    await rider.evaluate("__hm.water.boats.leave(); 0")
    async def released():
        states = [await p.evaluate("i=>__hm.water.boats.state(i)", index) for p in pages]
        return all(s and s["rider"] is None for s in states)
    require(await eventually(pages, released), "leaving the boat releases its seat on both devices")
    return index


def piece_signature_js():
    return "__hm.build.BUILD.pieces.map(p=>[p.id,p.t,Math.round(p.x*10),Math.round(p.z*10),p.st]).sort((a,b)=>a[0]-b[0])"


async def construction_case(pages):
    host = pages[0]
    follower = pages[1]
    if not await host.evaluate("NT.st().isHost"):
        host, follower = follower, host
    await follower.evaluate("""['tool_hammer','tool_hoe'].forEach(id=>__hm.fn.goodsAdd(id,1));
      for(const id of ['plank','stone','nails','iron']) __hm.fn.goodsAdd(id,100); 0""")
    # Search permitted ground with the real building validator. Free placement,
    # direct BUILD mutations and synthetic snapshots are intentionally not used.
    spot = await follower.evaluate("""(() => {
      const H=__hm,P=H.GAME.player,T=H.REALMS[P.faction].town;
      for(let r=35;r<=150;r+=5) for(let a=0;a<Math.PI*2;a+=Math.PI/20) {
        const x=T.x+Math.sin(a)*r,z=T.z+Math.cos(a)*r;
        const actor={x,z,y:H.fn.heightAt(x,z),yaw:0,faction:P.faction};
        const sn=H.build.bSnap('found',x+2,z,0,actor);
        if(H.fn.isWalkable(x,z) && H.build.bValidate(sn,actor).ok
          && [-2,0,2].every(dx=>[8,10,12].every(dz=>!H.farm.tillWhy(x-5+dx,z+dz)))) return {x,z};
      }
      return null;
    })()""")
    require(spot is not None, "a permitted construction and farming site exists")
    await travel(pages, follower, spot["x"], spot["z"])
    before = await host.evaluate("__hm.build.BUILD.pieces.length")
    result = await follower.evaluate("""([x,z])=>{const P=NT.P;P.yaw=0;
      const r=__hm.build.buildPlace('found',x+2,z,0);return {ok:r.ok,pending:r.pending,why:r.why};}""",
                                     [spot["x"], spot["z"]])
    require(result.get("ok") or result.get("pending"), "a follower's normal construction action is accepted", result=result)
    async def built_both():
        a, b = await asyncio.gather(*(p.evaluate(piece_signature_js()) for p in pages))
        return len(a) > before and a == b
    require(await eventually(pages, built_both, 45), "follower construction appears identically in the authoritative and other scene")
    async def finished_both():
        a, b = await asyncio.gather(*(p.evaluate(piece_signature_js()) for p in pages))
        return len(a) > before and a == b and a[-1][-1] == 'built'
    require(await eventually(pages, finished_both, 45),
            "the follower's hammer work completes the same structure without duplicate pieces")
    # Move clear of the foundation and complete the real hoe job.
    await travel(pages, follower, spot["x"]-5, spot["z"]+6)
    await follower.evaluate("NT.P.yaw=0; 0")
    till = await follower.evaluate("__hm.farm.tillSpot()")
    require(not till.get("why"), "the real farming tool finds tillable ground", spot=till)
    farm_before = await host.evaluate("__hm.farm.FARM.plots.filter(p=>p.own==='p').length")
    started = await follower.evaluate("__hm.farm.act('till')")
    require(started, "a follower starts a real tilling job")
    async def tilled_both():
        counts = [await p.evaluate("__hm.farm.FARM.plots.filter(p=>p.own==='p').length") for p in pages]
        return counts[0] > farm_before and counts[0] == counts[1]
    require(await eventually(pages, tilled_both, 45), "a follower's completed farm bed exists on both devices")
    return await host.evaluate(piece_signature_js())


async def combat_case(pages):
    host = pages[0] if await pages[0].evaluate("__hm.entities.canSimulate()") else pages[1]
    follower = pages[1] if host is pages[0] else pages[0]
    rows = await host.evaluate("__hm.entities.rows()")
    # Adapter exposes actual entities as find(id); use an ordinary hostile mob.
    follower_position = await follower.evaluate("({x:NT.P.x,z:NT.P.z})")
    candidate = await host.evaluate("""at=>{const H=__hm,out=[];for(const r of H.entities.rows()) {
      const e=H.entities.find(r.id);if(e&&e.alive&&e.role==='mob'
        &&H.fn.isEnemy(H.GAME.player,e)&&e.hp>40&&e.hp<20000)
        out.push({id:r.id,x:e.x,z:e.z,hp:e.hp,d:Math.hypot(e.x-at.x,e.z-at.z)});}
      out.sort((a,b)=>a.d-b.d);return out[0]||null;}""", follower_position)
    require(candidate is not None, "the authoritative world exposes an ordinary hostile creature", rows=len(rows))
    await travel(pages, follower, candidate["x"]+1, candidate["z"]+1)
    async def exists():
        return await follower.evaluate("id=>!!__hm.entities.find(id)", candidate["id"])
    require(await eventually(pages, exists), "the same hostile creature is materialized for the follower")
    hp_before = await host.evaluate("id=>__hm.entities.find(id)?.hp", candidate["id"])
    await follower.evaluate("id=>__hm.entities.attack(id,20)", candidate["id"])
    async def damaged():
        values = [await p.evaluate("id=>__hm.entities.find(id)?.hp", candidate["id"]) for p in pages]
        return all(v is not None and v < hp_before for v in values) and abs(values[0]-values[1]) < 0.01
    require(await eventually(pages, damaged), "a follower's actual attack changes the same creature's health on both devices")
    await follower.evaluate("id=>__hm.entities.attack(id,9999)", candidate["id"])
    async def died():
        return all([await p.evaluate("id=>{const e=__hm.entities.find(id);return !e || !e.alive;}", candidate["id"])
                    for p in pages])
    require(await eventually(pages, died), "the same creature's death is visible on both devices")


async def terrain_case(pages):
    host = pages[0] if await pages[0].evaluate("__hm.entities.canSimulate()") else pages[1]
    follower = pages[1] if host is pages[0] else pages[0]
    point = await host.evaluate("""(() => {
      const H=__hm,P=H.GAME.player,B=H.build.BUILD.pieces.at(-1);
      for(let r=12;r<=40;r+=4) for(let a=0;a<Math.PI*2;a+=Math.PI/8) {
        const x=B.x+Math.sin(a)*r,z=B.z+Math.cos(a)*r;
        if(!H.build.bLandWhy(x,z,P)) return {x,z,before:H.fn.heightAt(x,z)};
      }
      return null;
    })()""")
    require(point is not None, "a permitted unprotected terrain fixture exists")
    created = await host.evaluate("""p=>!!__hm.nature.natureCrater(p.x,p.z,3,0.6)""", point)
    require(created, "the authoritative simulation creates a real terrain crater")
    async def same_ground():
        heights = [await p.evaluate("p=>__hm.fn.heightAt(p.x,p.z)", point) for p in pages]
        return max(heights)-min(heights) < 0.04 and heights[0] < point["before"]-0.15
    require(await eventually(pages, same_ground, 45), "both devices use the same deformed terrain height")
    # Ages change the serialized land record, so subsequent frames must reconcile
    # terrain, rather than adding the same crater's displacement repeatedly.
    await pulse(pages, 6)
    require(await eventually(pages, same_ground), "repeated changed land snapshots do not deepen the crater again")


async def run():
    OUT.mkdir(parents=True, exist_ok=True)
    port = fixture.free_port()
    origin = f"http://127.0.0.1:{port}"
    tls_port = fixture.free_port()
    public_origin = f"https://127.0.0.1:{tls_port}"
    url = f"wss://127.0.0.1:{tls_port}/ws"
    tls_dir = pathlib.Path(tempfile.mkdtemp(prefix="shared_world_tls_", dir=OUT))
    openssl = shutil.which("openssl")
    if not openssl:
        git_openssl = pathlib.Path("C:/Program Files/Git/usr/bin/openssl.exe")
        openssl = str(git_openssl) if git_openssl.exists() else None
    if not openssl:
        raise RuntimeError("OpenSSL is required for the test-only HTTPS/WSS origin fixture")
    key_file, certificate_file = tls_dir/"key.pem", tls_dir/"certificate.pem"
    subprocess.run([openssl, "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1",
                    "-subj", "/CN=127.0.0.1", "-keyout", str(key_file), "-out", str(certificate_file)],
                   check=True, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
    env = {**os.environ, "PORT": str(port), "HM_DATA": tempfile.mkdtemp(prefix="shared_world_", dir=OUT),
           "HM_WORLD_PERSISTENCE_MODE": "legacy", "HM_PUBLIC_ORIGIN": public_origin,
           "HM_GAMING_ENABLED": "0", "HM_GAMING_BOOTSTRAP": "0", "HM_NATIVE_PLAYER_REQUIRED": "0"}
    server = subprocess.Popen(["node", str(ROOT/"server/server.js")], env=env,
                              stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    edge = subprocess.Popen(["node", str(ROOT/"tools/tests/shared_world_tls.mjs"), str(tls_port),
                             str(port), str(key_file), str(certificate_file)],
                            stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    browser = None
    pages = []
    try:
        for _ in range(120):
            try:
                if http_json(origin, "/health").get("ok"):
                    break
            except Exception:
                await asyncio.sleep(0.25)
        else:
            raise RuntimeError("shared-world test server did not become healthy")
        async with async_playwright() as playwright:
            browser = await playwright.chromium.launch(args=["--use-angle=swiftshader",
                       "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--ignore-certificate-errors"])
            desktop = await boot(browser, origin, url, "DesktopKeeper", 0, "warrior", 30)
            phone = await boot(browser, origin, url, "PhoneFarmer", 0, "mage", 27, phone=True)
            pages = [desktop, phone]
            await readiness(pages)
            private_before = [await p.evaluate("({name:NT.P.name,level:__hm.GAME.prog.level})") for p in pages]
            await town_case(pages)
            boat_index = await boat_case(pages)
            pieces = await construction_case(pages)
            await terrain_case(pages)
            await combat_case(pages)
            private_after = [await p.evaluate("({name:NT.P.name,level:__hm.GAME.prog.level})") for p in pages]
            require(private_before == private_after, "shared scene updates preserve each character's own identity and level")
            old = await phone.evaluate("__hm.netboats.NET_BOATS.authority")
            boat_before = await phone.evaluate("i=>__hm.water.boats.state(i)", boat_index)
            await desktop.close()
            pages = [phone]
            async def took_over():
                return await phone.evaluate("old=>__hm.netboats.NET_BOATS.host===NT.st().self && __hm.netboats.NET_BOATS.authority!==old", old)
            require(await eventually(pages, took_over), "the surviving phone takes authority after the desktop leaves")
            require(await phone.evaluate(piece_signature_js()) == pieces,
                    "host handoff preserves constructed structures")
            late = await boot(browser, origin, url, "LateDesktop", 0, "priest", 17)
            pages = [phone, late]
            await readiness(pages)
            await town_case(pages)
            async def late_world():
                return await late.evaluate(piece_signature_js()) == pieces
            require(await eventually(pages, late_world), "a fresh independent character joins the existing built world")
            a, b = await asyncio.gather(*(p.evaluate("i=>__hm.water.boats.state(i)", boat_index) for p in pages))
            require(math.hypot(a["x"]-b["x"], a["z"]-b["z"]) < 1.25,
                    "late join preserves the shared boat position after host handoff")
            for i, page in enumerate(pages):
                REPORT["errors"].extend(page._logs)
                await page.evaluate("__hm.frame(1/30); 0")
                await page.screenshot(path=str(OUT/f"shared_world_{i}.png"), timeout=60000)
            require(not REPORT["errors"], "both browsers completed the shared-world scenarios without page errors",
                    errors=REPORT["errors"][:8])
            await browser.close()
            browser = None
        for _ in range(40):
            if http_json(origin, "/health").get("players") == 0:
                break
            await asyncio.sleep(0.1)
        await asyncio.sleep(1.8)
        idle_before = http_json(origin, "/stats")
        await asyncio.sleep(2)
        idle_after = http_json(origin, "/stats")
        require(idle_after.get("seasonSteps") == idle_before.get("seasonSteps")
                and idle_after.get("worldWrites") == idle_before.get("worldWrites"),
                "closing every player suspends world simulation and background writes")
        REPORT["wire"] = {"activityFrames": len(WIRES), "bytes": sum(f["bytes"] for f in WIRES),
                          "maxFrame": max((f["bytes"] for f in WIRES), default=0)}
        require(bool(WIRES), "the regression used the real shared activity transport", **REPORT["wire"])
    finally:
        if browser:
            await browser.close()
        edge.terminate()
        try:
            edge_stdout = edge.communicate(timeout=5)[0]
        except subprocess.TimeoutExpired:
            edge.kill()
            edge_stdout = edge.communicate()[0]
        server.terminate()
        try:
            stdout = server.communicate(timeout=5)[0]
        except subprocess.TimeoutExpired:
            server.kill()
            stdout = server.communicate()[0]
        (OUT/"shared_world_server.log").write_text(stdout, encoding="utf-8")
        (OUT/"shared_world_tls.log").write_text(edge_stdout, encoding="utf-8")
        (OUT/"shared_world.json").write_text(json.dumps(REPORT, indent=2), encoding="utf-8")


if __name__ == "__main__":
    asyncio.run(run())
