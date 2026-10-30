"""Fictional offline world: real RTS input, canonical construction and walkable access.

The socket boundary is an in-memory canonical-state fixture. Client command,
quote, nonce response, parser and selection handlers remain real. This is not a
production account, native storage or server-authentication test.
"""
import asyncio
import hashlib
import json
import os
from pathlib import Path
from types import SimpleNamespace

ROOT = Path(__file__).resolve().parents[2]
OUT = Path(os.environ.get("HM_RTS_FLOW_OUT", str(ROOT / "tools/out/rts-construction")))
OUT.mkdir(parents=True, exist_ok=True)
os.environ["HM_REALM_SITE_OUT"] = str(OUT)
from realm_sites_terrain import audit_browser  # same CI renderer and cleanup as terrain QA
import hm
from hmlib import human_play, wait_title_settled
from playwright.async_api import async_playwright

HOOK = r"""
window.__rtsConstructionQA = (() => {
  let state, realm = 0;
  const sent = [], answers = [], nonces = new Map(), input = [], poses = {slow:0,fast:0};
  for (const type of ['pointerup','keydown','change']) window.addEventListener(type, e => {
    if (input.length < 200) input.push({type,trusted:e.isTrusted,name:e.target?.name || '',pointer:e.pointerType || ''});
  }, true);
  function sync() {
    const management = netRealmManagementRead(realmManageView(state,realm));
    if (!management) throw Error('Real bounded management decoder refused the fixture');
    NETS.s = {...(NETS.s || {}), n:state.n, t:state.t, management};
  }
  function install() {
    state = realmSimInit(314159); realmManageInit(state);
    for (const R of state.realms) {
      R.s = R.s.map(() => 5000);
      for (const k of Object.keys(R.management.stock)) R.management.stock[k] = 100;
    }
    NETWS.url = ''; NETWS.state = 'on'; NET.self = 'offline-rts-construction-qa';
    netWsSend = message => {
      if (message.t === 'slow' || message.t === 'fast') {
        poses[message.t]=Math.min(1000,poses[message.t]+1);
        return true;
      }
      if (message.t !== 'order' || message.o?.kind !== 'manage') return false;
      const request = JSON.parse(JSON.stringify(message.o));
      sent.push(request);
      // netsAsk registers its waiter after netWsSend returns.
      queueMicrotask(() => {
        const signature = JSON.stringify(request.args);
        let result = nonces.get(request.nonce);
        if (result && result.signature !== signature) throw Error('Nonce payload changed');
        if (!result) {
          const valid = request.season === state.n && request.hall === HALL.sit?.H.num && !!hallThroneGrant();
          const value = valid ? realmManageAction(state,realm,{...request.args,expectedRevision:request.revision})
            : {ok:false,why:'Fixture authority or season changed',revision:state.management.revision};
          result = {signature,value}; nonces.set(request.nonce,result);
        }
        const reply = {t:'order',kind:'manage',q:message.q,nonce:request.nonce,...result.value,
          confirmed:true,pending:false,management:realmManageView(state,realm)};
        answers.push(JSON.parse(JSON.stringify(reply)));
        netSeasonMsg(reply);
      });
      return true;
    };
    // Match the real WS adapter's lower ports. Keep netSendSlow/netSendFast,
    // their serializers and the actual management command untouched.
    const link = {
      kind:'ws',setSlow:o=>netWsSend({t:'slow',d:o}),setFast:o=>netWsSend({t:'fast',d:o}),
      connected:()=>NETWS.link===link && NETWS.state==='on',
      close:()=>{if(NETWS.link===link){NETWS.link=null;NETWS.state='off';NET.link=null;NET.state='alone';}}
    };
    NETWS.link=NET.link=link;NET.state='on';NET.linkedAt=performance.now();
    window.requestAnimationFrame = () => 0; // explicit normal frame hooks below
    if (!LOD.built) lodBuild();
    sync();
    return {seed:314159,terrain:LOD.built};
  }
  function enter(r) {
    if (THRONE_RTS.active) closeThroneRTS(false);
    HALL.sit = null; realm = r;
    const P = GAME.player;
    P.faction=r; P.hp=P.maxHp; P.alive=true; P.casting=null; UI.modal=null;
    sync();
    const H = HOUSES.find(h => h.hallSpots?.seat && hallHolder(h)===r && houseIntact(h) && h.state!=='burning');
    if (!H) throw Error('No real intact high seat');
    THRONE_RTS_UI.tab='build'; THRONE_RTS_UI.form={}; THRONE_RTS_UI.selectedPlot=''; THRONE_RTS_UI.key='';
    P.x=H.hallSpots.seat.x; P.z=H.hallSpots.seat.z; P.y=H.y;
    hallSitConfirmed(H);
    if (!THRONE_RTS.active || !hallThroneGrant()) throw Error('Actual seat grant did not open RTS');
    const plot = NETS.s.management.plots.find(p=>p.site.startsWith('keep:') && !p.buildingId && realmRtsSiteStatus(p).eligible);
    if (!plot) throw Error('No clear held keep plot');
    throneRtsFocus(plot.x,plot.z); THRONE_RTS.distance=THRONE_RTS.targetDistance=45;
    // The click must land on the frame a player can actually see, not only a
    // projected hit target over an old non-RTS canvas.
    draw('low',false,plot.id);
    const rect=$('rts-stage').getBoundingClientRect(),yaw=realmRtsModelYaw(plot),c=Math.cos(yaw),s=Math.sin(yaw);
    const points=[];
    for (const u of [-4.5,4.5]) for (const v of [-4.5,4.5]) {
      const x=plot.x+u*c+v*s,z=plot.z-u*s+v*c,p=screenOf(x,heightAt(x,z)+.06,z);
      if (p && p.x>rect.left+20 && p.x<rect.right-20 && p.y>rect.top+20 && p.y<rect.bottom-20
        && THRONE_RTS_UI.markers.filter(m=>m.screen).every(m=>Math.hypot(m.screen.x-p.x,m.screen.y-p.y)>31))
        points.push({x:p.x,y:p.y,u,v});
    }
    if (!points.length) throw Error('No visible non-centre footprint point outside the old 30px picker');
    return {realm:r,plotId:plot.id,site:plot.site,point:points[0],initial:THRONE_RTS_UI.selectedPlot};
  }
  function snapshot(plotId) {
    const v=netRealmManagementView(),b=v?.buildings.find(b=>b.plotId===plotId);
    const keep=Number(plotId.split(':')[1]);
    const select=document.querySelector('[name=buildKind]');
    const marker=document.querySelector('[data-marker="plot"][data-id="'+plotId+'"]');
    return {selected:THRONE_RTS_UI.selectedPlot,plot:THRONE_RTS_UI.form.plotId,
      kind:select?.value,focusName:document.activeElement?.name || '',
      quote:{...THRONE_RTS_UI.quoteForm},detail:document.querySelector('[data-rts-construction-detail]')?.textContent || '',
      markerPressed:marker?.getAttribute('aria-pressed'),preview:!!document.querySelector('.rts-plot-preview'),
      previewLabel:document.querySelector('#rts-routes text')?.textContent || '',status:$('rts-status')?.textContent || '',
      stock:Object.fromEntries((v?.stocks || []).map(s=>[s.id,s.n])),building:b || null,
      support:realmManageDefenseSupport(state,keep),sent:sent.length,answers:answers.length,
      result:NETR_MANAGE.result,pending:!!NETR_MANAGE.pending,input:input.slice(),poses:{...poses}};
  }
  function diagnostic() {
    return {active:THRONE_RTS.active,modal:UI.modal,focused:document.hasFocus(),hidden:document.hidden,
      live:netHumanLive(),grant:!!hallThroneGrant(),hasLink:!!NET.link,linkState:NET.state,websocketState:NETWS.state,
      status:$('rts-status')?.textContent || '',pending:NETR_MANAGE.pending?.request || null,
      sent:sent.slice(-3),answers:answers.slice(-3),poses:{...poses},input:input.slice(-30),errors:HM_ERRORS.slice()};
  }
  function advance(seconds) {
    state.t+=seconds; realmManageStep(state,seconds); sync();
    throneRtsRenderPanel(true); realmRtsModelsFrame(.3);
  }
  function refresh() {
    realmRtsModelsFrame(.3); throneRtsDrawMarkers();
  }
  function draw(q,night,plotId) {
    const b=NETS.s.management.buildings.find(b=>b.plotId===plotId) || NETS.s.management.plots.find(p=>p.id===plotId);
    if(!b)throw Error('No real plot or building to draw');
    setQuality(q); tod.p=tod.fixedP=night?2.1:.25; tod.mode='fixed'; applyTimeOfDay(tod.p);
    applyWeather(); applyIndoor(); resize();
    throneRtsFocus(b.x,b.z); throneRtsUpdateCamera(0); updateLod(); drawHouses(0);
    realmRtsModelsFrame(.3); updateThroneRTS(0); camera.updateMatrixWorld();
    renderer.setRenderTarget(null); renderer.info.reset(); renderer.render(scene,camera); gl.finish();
    const programs=renderer.info.programs.map(p=>{
      const source=gl.getShaderSource(p.vertexShader)||'';
      return source.includes('vGroundMark')?{instanced:source.includes('#define USE_INSTANCING'),linked:gl.getProgramParameter(p.program,gl.LINK_STATUS)}:null;
    }).filter(Boolean);
    const rect=node=>{const r=node?.getBoundingClientRect();return r?{left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:r.width,height:r.height}:null;};
    const label=document.querySelector('#rts-routes .rts-preview-label'),status=$('rts-status');
    return {q,night,programs,errors:HM_ERRORS.slice(),glError:gl.getError(),status:status?.textContent || '',
      body:REALM_RTS_MODELS.pools.get('watchpost')?.count || 0,
      preview:label?.textContent || '',layout:label?{stage:rect($('rts-stage')),label:rect(label),
        marker:rect(document.querySelector('.rts-marker.plot.selected')),status:rect(status),content:rect($('rts-content')),
        statusClientHeight:status.clientHeight,statusScrollHeight:status.scrollHeight}:null};
  }
  function walk(plotId) {
    closeThroneRTS(true); UI.modal=null;
    if(HALL.sit || GAME.player.seat)throw Error('Actual Leave throne did not release the seated player');
    realmRtsModelsFrame(.3);
    const b=NETS.s.management.buildings.find(b=>b.plotId===plotId),P=GAME.player;
    const owned=REALM_RTS_MODELS.solids.get(b.id);
    if (!owned) throw Error('Built watchpost has no actual registered solids');
    const ownedColliders=[...owned.colliders],ownedFloors=[...owned.floors];
    const ground=realmRtsSiteGround(b),yaw=realmRtsModelYaw(b),c=Math.cos(yaw),s=Math.sin(yaw);
    const world=z=>({x:b.x+z*s,z:b.z+z*c});
    const start=world(6.35);
    P.x=P.prevX=start.x;P.z=P.prevZ=start.z;P.y=heightAt(P.x,P.z);
    P.fixedY=null;P.hover=0;P.swim=false;P.motion=null;
    const path=[],steps=80;
    for (const [from,to] of [[6.35,-1.5],[-1.5,6.35]]) for(let i=1;i<=steps;i++) {
      const local=from+(to-from)*i/steps,point=world(local),before=P.y;
      const ok=stepTo(P,point.x,point.z);P.y=floorAt(P.x,P.z,P.y);
      const error=Math.hypot(P.x-point.x,P.z-point.z);
      if (!ok || error>.025 || Math.abs(P.y-before)>.63) throw Error('Actual step motor blocked at '+local+': '+JSON.stringify({ok,error,before,after:P.y}));
      path.push({local,y:P.y});
    }
    const top=Math.max(...path.map(p=>p.y)),result={yaw,ground:ground.top,top,rise:top-ground.top,
      steps:path.length,endError:Math.hypot(P.x-start.x,P.z-start.z),outlines:!!REALM_RTS_MODELS.plots};
    const R=state.realms[realm];
    R.management.buildings=R.management.buildings.filter(row=>row.id!==b.id);
    sync();realmRtsModelsFrame(.3);
    result.remainingColliders=ownedColliders.filter(row=>COLL.boxes.includes(row)).length;
    result.remainingFloors=ownedFloors.filter(row=>FLOOR.list.includes(row)).length;
    result.retainedFloorGridEntries=[...FLOOR.grid.values()].filter(rows=>rows.some(row=>ownedFloors.includes(row))).length;
    result.solidRetained=REALM_RTS_MODELS.solids.has(b.id);
    return result;
  }
  return {install,enter,snapshot,diagnostic,advance,refresh,draw,walk};
})();
"""


async def run():
    built = hm.HTML.read_bytes()
    source = built.decode("utf-8")
    cut = source.rfind("</script>")
    assert cut >= 0
    source = source[:cut] + "\n" + HOOK + "\n" + source[cut:]
    report = {"kind": "fictional-transport-real-game-rts-construction",
              "htmlSha256": hashlib.sha256(built).hexdigest(), "realms": [], "completed": False,
              "limits": ["Socket boundary uses actual canonical functions on fictional state.",
                         "No production account, native persistence or server-authentication proof.",
                         "Phone kind selection is automated select_option; footprint and commission use trusted touch.",
                         "Access checks use the real step motor and floor/collision world, with a fictional start position."]}
    async with async_playwright() as p, audit_browser(p, SimpleNamespace(native_edge=False)) as browser:
        for touch, realms in [(False, [0]), (True, [1, 2])]:
            context = await browser.new_context(viewport={"width": 390, "height": 780} if touch else {"width": 1100, "height": 760}, has_touch=touch)
            page = await context.new_page()
            errors = []
            page.on("pageerror", lambda e: errors.append(str(e)))

            async def route_local(route):
                url = route.request.url
                if url == hm.THREE_URL:
                    await route.fulfill(status=200, content_type="application/javascript",
                                        body=hm.THREE_LOCAL.read_text(), headers={"Access-Control-Allow-Origin": "*"})
                elif url == "https://hm.test/":
                    await route.fulfill(status=200, content_type="text/html", body=hm.SKELETON.replace("%s", source))
                elif url.startswith(("https://fonts.googleapis.com/", "https://fonts.gstatic.com/")):
                    await route.fulfill(status=200, content_type="text/css", body="")
                else:
                    await route.abort()

            await page.route("**/*", route_local)
            try:
                await page.goto("https://hm.test/", wait_until="commit")
                await page.wait_for_function("window.__hm?.ready && window.__rtsConstructionQA", timeout=180000, polling=500)
                secure = await page.evaluate("({secure:isSecureContext,nonce:typeof crypto.randomUUID})")
                assert secure == {"secure": True, "nonce": "function"}, secure
                await wait_title_settled(page)
                await page.evaluate("__hm.fn.setQuality('low')")
                await page.evaluate("(async()=>{await __hm.start({realm:0,cls:'warrior',level:1,name:'Offline construction QA'});__hm.UI.modal=null;return true})()")
                await human_play(page)
                await page.evaluate("__rtsConstructionQA.install()")
                for ordinal, realm in enumerate(realms):
                    phone = touch
                    await page.set_viewport_size({"width": 390, "height": 780} if phone else {"width": 1100, "height": 760})
                    await human_play(page)
                    target = await page.evaluate("r=>__rtsConstructionQA.enter(r)", realm)
                    point, plot = target["point"], target["plotId"]
                    assert target["initial"] != plot
                    if phone:
                        await page.touchscreen.tap(point["x"], point["y"])
                    else:
                        await page.mouse.click(point["x"], point["y"])
                    await page.wait_for_function("id=>__rtsConstructionQA.snapshot(id).selected===id", arg=plot, timeout=3000, polling=100)
                    await page.evaluate("__rtsConstructionQA.refresh()")
                    selected = await page.evaluate("id=>__rtsConstructionQA.snapshot(id)", plot)
                    assert selected["plot"] == plot and selected["markerPressed"] == "true" and selected["preview"], selected
                    selector = page.locator('[name="buildKind"]')
                    if phone:
                        await selector.select_option("watchpost")
                    else:
                        options = await selector.locator("option").evaluate_all("nodes=>nodes.map(n=>n.value)")
                        await selector.focus()
                        await selector.press("Home")
                        for _ in range(options.index("watchpost")):
                            await selector.press("ArrowDown")
                        await selector.press("Enter")
                    quote = await page.evaluate("id=>__rtsConstructionQA.snapshot(id)", plot)
                    assert quote["kind"] == "watchpost" and quote["quote"]["buildKind"] == "watchpost", quote
                    assert "Watchpost" in quote["detail"] and "90" in quote["detail"] and "10%" in quote["detail"], quote
                    if realm == 0:
                        assert "Watchpost" in quote["status"], quote
                    if not phone:
                        assert quote["focusName"] == "buildKind", quote
                        # Leave the native selector through ordinary keyboard
                        # navigation only after proving its focus survived.
                        await selector.press("Tab")
                    # The immediate quote above is observed before any frame or
                    # panel refresh. Render only afterwards to inspect the
                    # player's actual selected footprint and its current label.
                    preview = await page.evaluate("a=>__rtsConstructionQA.draw(...a)", ["low", False, plot])
                    assert "Watchpost" in preview["preview"] and not preview["errors"] and preview["glError"] == 0, preview
                    layout = preview["layout"]
                    assert layout and all(layout[k] for k in ["stage", "label", "marker", "status", "content"]), preview
                    assert all(layout[k]["width"] > 0 and layout[k]["height"] > 0
                               for k in ["stage", "label", "marker", "status", "content"]), layout
                    a, b, stage = layout["label"], layout["marker"], layout["stage"]
                    assert (a["right"] + 2 <= b["left"] - 3 or a["left"] - 2 >= b["right"] + 3 or
                            a["bottom"] + 2 <= b["top"] - 3 or a["top"] - 2 >= b["bottom"] + 3), layout
                    assert (a["left"] >= stage["left"] + 2 and a["right"] <= stage["right"] - 2 and
                            a["top"] >= stage["top"] + 2 and a["bottom"] <= stage["bottom"] - 2), layout
                    assert layout["statusScrollHeight"] <= layout["statusClientHeight"] + 1, layout
                    assert layout["status"]["bottom"] <= layout["content"]["top"] + 1, layout
                    await page.screenshot(path=str(OUT / ("realm-" + str(realm) + "-selection.png")), timeout=300000)
                    button = page.locator('[data-action="build"]')
                    if phone:
                        await button.tap()
                    else:
                        await button.click()
                    await page.wait_for_function("id=>{const s=__rtsConstructionQA.snapshot(id);return !s.pending&&s.building?.kind==='watchpost'}", arg=plot, timeout=3000, polling=100)
                    commissioned = await page.evaluate("id=>__rtsConstructionQA.snapshot(id)", plot)
                    assert commissioned["sent"] == ordinal + 1 and commissioned["answers"] == ordinal + 1
                    assert commissioned["result"]["ok"] and commissioned["support"] == 0, commissioned
                    assert commissioned["poses"]["slow"] > 0 and commissioned["poses"]["fast"] > 0, commissioned
                    for good, amount in {"timber": 60, "stone": 40, "iron": 8, "tools": 2}.items():
                        assert abs(quote["stock"][good] - commissioned["stock"][good] - amount) < .001
                    await page.evaluate("__rtsConstructionQA.advance(89)")
                    partial = await page.evaluate("id=>__rtsConstructionQA.snapshot(id)", plot)
                    assert partial["building"]["status"] == "building" and partial["support"] == 0, partial
                    await page.evaluate("__rtsConstructionQA.advance(1)")
                    await page.evaluate("__rtsConstructionQA.advance(1)")
                    finished = await page.evaluate("id=>__rtsConstructionQA.snapshot(id)", plot)
                    assert finished["building"]["status"] == "built" and finished["building"]["assigned"] == 2 and finished["support"] == .1, finished
                    draws = []
                    for quality in ["high", "medium", "low"]:
                        for night in [False, True]:
                            await human_play(page)
                            draw = await page.evaluate("a=>__rtsConstructionQA.draw(...a)", [quality, night, plot])
                            assert draw["body"] > 0 and not draw["errors"] and draw["glError"] == 0, draw
                            assert draw["status"] == "Watchpost construction commissioned.", draw
                            assert {v["instanced"] for v in draw["programs"]} == {False, True} and all(v["linked"] for v in draw["programs"]), draw
                            draws.append(draw)
                            if quality == "low" and not night:
                                await page.screenshot(path=str(OUT / ("realm-" + str(realm) + "-watchpost.png")), timeout=300000)
                    walk = await page.evaluate("id=>__rtsConstructionQA.walk(id)", plot)
                    assert abs(walk["rise"] - 2) < .03 and walk["endError"] < .025 and walk["steps"] == 160, walk
                    assert not walk["outlines"] and not walk["solidRetained"] and walk["remainingColliders"] == walk["remainingFloors"] == walk["retainedFloorGridEntries"] == 0, walk
                    assert any(e["type"] == "pointerup" and e["trusted"] for e in commissioned["input"])
                    report["realms"].append({"target": target, "selected": selected, "quote": quote, "commissioned": commissioned,
                                             "previewDraw": preview, "partial": partial, "finished": finished, "draws": draws, "walk": walk})
                    (OUT / "flow.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
                    print(json.dumps({"realm": realm, "commissioned": True, "support": finished["support"], "draws": len(draws), "walk": walk}), flush=True)
                assert not errors, errors
                report["pageErrors"] = errors
                (OUT / "flow.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
                await context.close()
            except Exception as error:
                failure = {"accepted": False, "exception": str(error), "htmlSha256": report["htmlSha256"], "completedRealms": len(report["realms"]), "pageErrors": errors}
                (OUT / "failure.json").write_text(json.dumps(failure, indent=2), encoding="utf-8")
                try:
                    failure["afterFailureDiagnostic"] = await asyncio.wait_for(page.evaluate("window.__rtsConstructionQA?.diagnostic() || null"), timeout=10)
                except Exception as diagnostic_error:
                    failure["diagnosticError"] = str(diagnostic_error)
                (OUT / "failure.json").write_text(json.dumps(failure, indent=2), encoding="utf-8")
                try:
                    await page.screenshot(path=str(OUT / "failure.png"), timeout=10000)
                except Exception as screenshot_error:
                    failure["screenshotError"] = str(screenshot_error)
                try:
                    await asyncio.wait_for(context.close(), timeout=10)
                except Exception as close_error:
                    failure["cleanupError"] = str(close_error)
                (OUT / "failure.json").write_text(json.dumps(failure, indent=2), encoding="utf-8")
                raise
    report["completed"] = True
    (OUT / "flow.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    print("PASS: desktop/phone footprint selection, immediate quotes, real canonical commission, staffing, rendering and watchpost access", flush=True)


if __name__ == "__main__":
    asyncio.run(run())
