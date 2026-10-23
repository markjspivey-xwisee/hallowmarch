"""Actual built 3D game/controller regression. Native account and transport are
explicit local fixtures; cryptographic/native authority is tested separately.
No integration encounter is entered and no native/production write is made.
"""
import asyncio, json, os, pathlib, sys
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
import hm
from hmlib import human_play
from playwright.async_api import async_playwright

HOOK = r"""
window.__mainAgentFixture = {
  humanPlaying(){return netHumanLive()},
  renderParty(){UI.frame=0;netUiOn();netUiFrame();return document.querySelector('#netparty')?.textContent||'';},
  openPlayers(){netUiOn();netSheetToggle(true)},
  staleCoachAlias(){LORE.chronSec='coach';openChronicle('coach')},
  navigationState(){return {agentRuns:window.__fixtureAgentRuns,nativeConnections:window.__fixtureNativeConnections,client:!!MAIN_WORLD_AGENTS.client,
    paused:MAIN_WORLD_AGENTS.paused,records:[...MAIN_WORLD_AGENTS.records.keys()],
    coachingEnabled:!!MARCH_CONSULTING.enabled,coachingConnected:!!MARCH_CONSULTING.journal||!!MARCH_CONSULTING.consultant}},
  owner(){
    NETWS.state='on'; NETWS.acct={id:'fixture-owner',name:'Fixture owner',guest:false}; NETWS.worldRoom='march'; NETWS.generation=1;
    NETWS.host='game.test';NETWS.token='fixture-app-token';
    NATIVE_PLAYER.status={enabled:true,bound:true,verified:true,binding:{subjectDid:'did:example:fixture-owner',podUrl:'https://pods.example/fixture-owner/'}};
  },
  initialIdentity(){
    const initial={initialized:NETUI.on,sheets:document.querySelectorAll('#netsheet').length};
    this.owner();this.priorNetLink=NET.link;this.priorWsLink=NETWS.link;
    NET.link=null;NETWS.link={kind:'ws'};openMenu('progress');return initial;
  },
  finishInitialIdentity(){netSheetToggle(false);NET.link=this.priorNetLink;NETWS.link=this.priorWsLink},
  bind(){
    this.owner();NET.link={kind:'ws'};
    window.__HM_GAMING={mainWorldAgents:{enabled:true,applicationId:'did:example:hallowmarch-fixture',audience:location.origin,affordances:location.origin+'/world/native-agents'}};
    MAIN_WORLD_AGENTS.lastGeneration=1;
    netWsSend=value=>{window.__fixturePackets.push(structuredClone(value));return true};
    const companion=partyCompanionCreate('Test teammate'); const body=partyCompanionBodies()[0];
    window.__fixtureCompanion=companion;window.__fixtureBodyId=body.id;
    MAIN_WORLD_AGENTS.paused=false;MAIN_WORLD_AGENTS.companionPaused=false; MAIN_WORLD_AGENTS.allowed.add(body.id);
    MAIN_WORLD_AGENTS.records.set('fixture-grant',{reference:{grantId:'fixture-grant'},registered:true,grant:{roomId:'march',entityId:body.id,
      applicationId:window.__HM_GAMING.mainWorldAgents.applicationId,audience:location.origin,
      actor:'did:web:identity.example:agents:test-companion',role:'teammate',actions:['observe','move','attack'],expiresAt:new Date(Date.now()+600000).toISOString(),revoked:false}});
  }
}; window.__fixturePackets=[];window.__fixtureAgentRuns=0;window.__fixtureNativeConnections=0;
const fixtureActualAgentRun=mainWorldAgentRun;
mainWorldAgentRun=run=>{window.__fixtureAgentRuns++;return fixtureActualAgentRun(run)};
const fixtureActualNativeConnect=nativePlayerConnect;
nativePlayerConnect=(...args)=>{window.__fixtureNativeConnections++;return fixtureActualNativeConnect(...args)};
window.__mainAgentFixture.focusCheck=()=>{
  const revokeButton=()=>[...document.querySelectorAll('#world-agent-records button')].find(b=>b.textContent.trim()==='Revoke access');
  openCompanion();mainWorldAgentRender();const button=revokeButton();
  if(!button)return {same:false,focused:false,started:GAME.started,count:MAIN_WORLD_AGENTS.records.size,mount:!!document.querySelector('#world-agent-mount'),enabled:window.__HM_GAMING?.mainWorldAgents?.enabled};
  button.focus();
  mainWorldAgentRender();mainWorldAgentRender();
  return {same:button===revokeButton(),focused:document.activeElement===button};
};
"""
async def main():
    html = hm.HTML.read_text()
    pos = html.rfind('</script>')
    assert pos > 0
    html = html[:pos] + HOOK + html[pos:]
    async with async_playwright() as p:
        browser = await p.chromium.launch(executable_path=os.environ.get('HM_CHROMIUM_EXECUTABLE') or None,
            args=['--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist'])
        try:
            page = await browser.new_page(viewport={'width':960,'height':640})
            errors=[]
            page.on('pageerror',lambda e:errors.append(str(e)))
            await page.add_init_script("""window.__holdFrame=false;const raf=window.requestAnimationFrame.bind(window);window.requestAnimationFrame=cb=>raf(function draw(t){if(window.__holdFrame)raf(draw);else cb(t)});""")
            await page.route(hm.THREE_URL, lambda route: route.fulfill(content_type='application/javascript',body=hm.THREE_LOCAL.read_text(),headers={'Access-Control-Allow-Origin':'*'}))
            await page.route('https://fonts.googleapis.com/**', lambda route:route.fulfill(content_type='text/css',body=''))
            await page.route('https://fonts.gstatic.com/**', lambda route:route.fulfill(body=''))
            port_requests=[]
            async def route_game(route):
                path=route.request.url.split('?',1)[0]
                if route.request.method not in ('GET','HEAD','OPTIONS'):
                    port_requests.append({'method':route.request.method,'url':path})
                    return await route.fulfill(status=503,content_type='application/json',body='{"error":"unconfigured-fixture-write"}')
                if '/gaming/identity/assets/' in path and route.request.method=='GET':
                    relative=path.split('/gaming/identity/assets/',1)[1]
                    asset=(hm.HERE.parent/'client/native-pod'/relative).resolve()
                    if asset.is_relative_to((hm.HERE.parent/'client/native-pod').resolve()) and asset.is_file():
                        return await route.fulfill(content_type='application/javascript',body=asset.read_text())
                if route.request.resource_type!='document':
                    port_requests.append({'method':route.request.method,'url':path})
                    return await route.fulfill(status=503,content_type='application/json',body='{"error":"unconfigured-fixture-port"}')
                await route.fulfill(content_type='text/html',body=html)
            await page.route('https://game.test/**',route_game)
            await page.goto('https://game.test/?safe=1&expedition=1',wait_until='commit')
            await page.wait_for_function('window.__hm?.ready',timeout=300000,polling=500)
            # Exercise the actual normal title button, not the encounter API.
            await page.locator('#name-input').fill('Main game regression')
            await page.locator('#btn-begin').click()
            await page.wait_for_function('window.__hm.GAME.started && window.__hm.GAME.player',timeout=30000)
            # Freeze rendered frames for this controller regression; subsequent movement
            # uses the real simulation step with its ordinary collision/combat code.
            await page.evaluate('window.__holdFrame=true')
            await page.get_by_role('button',name='Skip the prologue',exact=True).click(timeout=60000)
            await page.wait_for_function("window.__hm.UI.modal !== 'prologue'",timeout=10000)
            assert await page.locator('#gaming-menu-open').count()==0
            assert await page.locator('#gaming-mobile-open').count()==0
            assert not await page.locator('#gaming-sheet').is_visible()
            print('PASS normal title enters actual 3D game; old expedition URL does not open an encounter',flush=True)

            async def only_panel(panel,tab=None):
                state=await page.evaluate(r"""() => ({modal:__hm.UI.modal,
                  overlays:[...document.querySelectorAll('.overlay')].filter(e=>!e.hidden&&e.getClientRects().length).map(e=>e.id),
                  selected:[...document.querySelectorAll('#menu-tabs [aria-checked="true"]')].map(e=>e.dataset.tab)})""")
                assert state['overlays']==[panel] and state['modal']==('net' if panel=='netsheet' else 'menu'),state
                if tab:assert state['selected']==[tab],state

            # First entry has a confirmed WebSocket account but has not adopted
            # NET.link or initialized Players. Use the real Progress CTA without
            # constructing/replacing its widget or invoking identity sign-in.
            initial=await page.evaluate('__mainAgentFixture.initialIdentity()')
            assert initial=={'initialized':False,'sheets':0},initial
            await only_panel('menu','progress')
            await page.get_by_role('button',name='Open identity settings',exact=True).click()
            await only_panel('netsheet')
            first_connect=page.locator('#netsheet-acct .native-player button').first
            assert await first_connect.is_visible()
            assert await first_connect.evaluate('(e)=>e===document.activeElement')
            await human_play(page)
            assert not await page.evaluate('__mainAgentFixture.humanPlaying()'), 'identity settings cannot renew live world activity'
            assert await page.evaluate('!!__hm&&document.querySelectorAll("#netsheet").length===1&&__fixtureAgentRuns===0&&__fixtureNativeConnections===0')
            assert len(page.context.pages)==1
            assert not port_requests,port_requests
            await page.evaluate('__mainAgentFixture.finishInitialIdentity()')
            print('PASS first Progress identity CTA initializes Players from the WebSocket account, focuses its existing identity button and performs no sign-in or service call',flush=True)

            # A programmatic menu close does not renew the human input lease.
            # Resume through a real trusted key before testing delegated motion.
            await page.evaluate(r"""() => {
              __hm.UI.modal=null;
              for(const id of ['prologue','menu','dialog']){const e=document.getElementById(id);if(e)e.hidden=true}
              __mainAgentFixture.bind();
            }""")
            await human_play(page)
            result=await page.evaluate(r"""() => {
              const H=__hm,P=H.GAME.player; window.__holdFrame=true;
              const C=window.__fixtureCompanion,body=window.__fixtureBodyId;
              const before={x:C.x,y:C.y,z:C.z},humanBefore={x:P.x,z:P.z};
              H.worldAgents.message({op:'command',requestId:'fixture-input',grantId:'fixture-grant',expiresAt:Date.now()+1500,
                command:{type:'move',entityId:body,roomId:'march',dx:1,dz:0,durationMs:500}});
              H.INPUT.keys.add('KeyW');H.simulate(.05);H.INPUT.keys.clear();
              const distance=Math.hypot(C.x-before.x,C.z-before.z);
              const humanDistance=Math.hypot(P.x-humanBefore.x,P.z-humanBefore.z);
              const input=window.__fixturePackets.find(p=>p.requestId==='fixture-input');
              const simultaneous=H.worldAgents.state.intent?.entity===C;
              H.worldAgents.message({op:'command',requestId:'fixture-possession',grantId:'fixture-grant',expiresAt:Date.now()+1500,
                command:{type:'move',entityId:'fixture-owner',roomId:'march',dx:1,dz:0,durationMs:500}});
              const possessionRefused=window.__fixturePackets.find(p=>p.requestId==='fixture-possession')?.ok===false;
              H.worldAgents.pause(); const paused=H.worldAgents.state.intent===null;
              const roster=__mainAgentFixture.renderParty();
              const save=H.fn.buildSave(); const savedId=save.char.x.partyCompanion.id;
              return {distance,humanDistance,y:C.y,inputApplied:input?.ok===true,simultaneous,possessionRefused,paused,
                separate:C!==P&&C.role==='companion',stableBody:body.endsWith(savedId),roster,errors:H.errors.slice()};
            }""")
            assert result['inputApplied'],result
            assert 0 < result['distance'] < 2,result
            assert result['humanDistance'] > 0 and result['simultaneous'] and result['paused'],result
            assert result['separate'] and result['possessionRefused'] and result['stableBody'],result
            assert 'Test teammate' in result['roster'],result
            assert not result['errors'] and not errors,{'engine':result['errors'],'browser':errors}
            print('PASS separate companion uses real movement beside human; possession refused and pause stops companion',flush=True)

            before=await page.evaluate('__mainAgentFixture.navigationState()')
            await page.evaluate('__mainAgentFixture.openPlayers()')
            await only_panel('netsheet')
            assert await page.locator('#netsheet #world-agent-controls,#netsheet #march-consulting').count()==0
            assert await page.locator('#netsheet').get_by_role('heading',name='Your companion',exact=True).count()==0
            await page.locator('#netsheet [data-act="companion"]').click()
            await only_panel('menu','companion')
            await page.wait_for_selector('#world-agent-mount #world-agent-controls')
            assert await page.locator('#world-agent-mount,#world-agent-controls').count()==2
            assert await page.locator('#menu-body .chron-nav').count()==0
            assert await page.locator('#menu').get_by_role('heading',name='Your companion',exact=True).count()==1
            focus=await page.evaluate('__mainAgentFixture.focusCheck()')
            assert focus['same'] and focus['focused'],focus
            print('PASS Companion tab owns one setup panel; access polling preserves the revoke button and keyboard focus',flush=True)
            await page.locator('#menu .sheet').evaluate('(e)=>e.scrollTop=0')
            await page.screenshot(path=str(hm.OUT/'main-world-agents.png'),timeout=300000)

            async def mobile_geometry():
                geometry=await page.evaluate(r"""() => {
                  const sheet=document.querySelector('#menu .sheet');
                  const controls=[...document.querySelectorAll('#world-agent-controls button,#world-agent-controls input,#world-agent-controls select,#world-agent-controls summary,#menu-tabs button')]
                    .filter(e=>e.getClientRects().length&&getComputedStyle(e).visibility!=='hidden')
                    .map(e=>{const target=e.matches('input[type="checkbox"]')?e.closest('label'):e,r=target.getBoundingClientRect();
                      return{id:e.id||e.textContent.trim().slice(0,80),w:r.width,h:r.height}});
                  return {width:innerWidth,height:innerHeight,
                    overflow:document.documentElement.scrollWidth>innerWidth+1||sheet.scrollWidth>sheet.clientWidth+1,
                    targets:controls,badTargets:controls.filter(e=>e.w<43.5||e.h<43.5)};
                }""")
                assert geometry['width']==393 and geometry['height']==852,geometry
                assert not geometry['overflow'] and not geometry['badTargets'],geometry

            await page.set_viewport_size({'width':393,'height':852})
            await page.wait_for_function('innerWidth===393&&innerHeight===852',polling=50)
            await page.locator('#menu .sheet').evaluate('(e)=>e.scrollTop=0')
            await page.screenshot(path=str(hm.OUT/'main-world-agents-mobile-top.png'),timeout=300000)
            await mobile_geometry()
            await page.locator('#world-agent-advanced > summary').click()
            assert await page.locator('#world-agent-advanced').evaluate('(e)=>e.open')
            await page.locator('#world-agent-advanced').evaluate(r"""(e)=>{
              const sheet=e.closest('.sheet'),heading=sheet.querySelector('.menu-heading');
              sheet.scrollTop+=e.getBoundingClientRect().top-heading.getBoundingClientRect().bottom-12;
            }""")
            await page.screenshot(path=str(hm.OUT/'main-world-agents-mobile-setup.png'),timeout=300000)
            await mobile_geometry()
            await page.set_viewport_size({'width':960,'height':640})
            await page.wait_for_function('innerWidth===960&&innerHeight===640',polling=50)
            print('PASS Companion at 393px has no horizontal overflow and all rendered controls, including nested summaries, have 44px targets',flush=True)

            # Exercise the primary copy control with a deterministic browser
            # refusal. Its fallback must be exposed, focused and fully selected.
            await page.evaluate(r"""() => {
              window.__fixtureClipboardDescriptor=Object.getOwnPropertyDescriptor(navigator,'clipboard');
              window.__fixtureClipboardDenials=0;
              Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async()=>{
                window.__fixtureClipboardDenials++;throw new DOMException('Fixture clipboard denial','NotAllowedError');
              }}});
            }""")
            try:
                await page.get_by_role('button',name='Copy setup instructions for my agent',exact=True).click()
                fallback=page.get_by_role('textbox',name='Public agent connection details',exact=True)
                await page.wait_for_function(r"""() => {
                  const field=document.querySelector('#world-agent-records textarea');
                  return field&&field.closest('details').open&&document.activeElement===field&&field.value.length>0
                    &&field.selectionStart===0&&field.selectionEnd===field.value.length;
                }""",polling=50)
                assert await fallback.is_visible()
                assert await page.evaluate('__fixtureClipboardDenials')==1
                assert (await fallback.input_value()).startswith('Connect to my Hallowmarch companion using these public connection details.')
            finally:
                await page.evaluate(r"""() => {
                  if(window.__fixtureClipboardDescriptor)Object.defineProperty(navigator,'clipboard',window.__fixtureClipboardDescriptor);
                  else delete navigator.clipboard;
                  delete window.__fixtureClipboardDescriptor;
                }""")
            print('PASS denied clipboard access exposes and selects the exact primary setup instructions without granting access',flush=True)

            # Switching to Players from an open menu must close that menu. Its
            # Progress action returns to one dedicated page, with sharing off.
            await page.evaluate('__mainAgentFixture.openPlayers()')
            await only_panel('netsheet')
            await page.locator('#netsheet [data-act="progress"]').click()
            await only_panel('menu','progress')
            await page.wait_for_selector('#march-coach-mount #march-consulting')
            assert await page.locator('#menu-body .chron-nav,#world-agent-controls').count()==0
            await page.evaluate('__mainAgentFixture.staleCoachAlias()')
            await only_panel('menu','progress')
            assert await page.evaluate('__hm.LORE.state.chronSec')=='path'
            await page.locator('#menu-tabs [data-tab="chronicle"]').click()
            await only_panel('menu','chronicle')
            assert await page.locator('.chron-nav [data-sec="path"][aria-current="true"]').is_visible()

            # Identity setup is a handoff to the existing owner controls. Focus
            # the real button, but never activate a sign-in or recovery action.
            await page.locator('#menu-tabs [data-tab="progress"]').click()
            await page.get_by_role('button',name='Open identity settings',exact=True).click()
            await only_panel('netsheet')
            connect=page.locator('#netsheet-acct .native-player button').first
            assert await connect.is_visible()
            assert await connect.evaluate('(e)=>e===document.activeElement')
            assert await page.locator('#netsheet-acct .native-player').count()==1
            await page.locator('#netsheet [data-act="companion"]').click()
            await only_panel('menu','companion')
            await page.wait_for_selector('#world-agent-mount #world-agent-controls')
            assert await page.locator('#world-agent-controls').count()==1
            assert await page.evaluate('__mainAgentFixture.navigationState()')==before
            assert not port_requests,port_requests
            assert not errors,errors
            print('PASS Players↔Companion/Progress and identity handoff keep one panel, preserve grants, and never enable coaching or invoke an owner service',flush=True)
            print(json.dumps(result),flush=True)
        finally:await browser.close()
if __name__=='__main__':asyncio.run(main())
