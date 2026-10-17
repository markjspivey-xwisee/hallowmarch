"""Actual built 3D game/controller regression. Native account and transport are
explicit local fixtures; cryptographic/native authority is tested separately.
No integration encounter is entered and no native/production write is made.
"""
import asyncio, json, os, pathlib, sys
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
import hm
from playwright.async_api import async_playwright

HOOK = r"""
window.__mainAgentFixture = {
  renderParty(){UI.frame=0;netUiOn();netUiFrame();return document.querySelector('#netparty')?.textContent||'';},
  bind(){
    NETWS.state='on'; NETWS.acct={id:'fixture-owner'}; NETWS.worldRoom='march'; NETWS.generation=1;
    NATIVE_PLAYER.status={verified:true,binding:{subjectDid:'did:example:fixture-owner'}};
    MAIN_WORLD_AGENTS.lastGeneration=1;
    netWsSend=value=>{window.__fixturePackets.push(structuredClone(value));return true};
    const companion=partyCompanionCreate('Test teammate'); const body=partyCompanionBodies()[0];
    window.__fixtureCompanion=companion;window.__fixtureBodyId=body.id;
    MAIN_WORLD_AGENTS.paused=false;MAIN_WORLD_AGENTS.companionPaused=false; MAIN_WORLD_AGENTS.allowed.add(body.id);
    MAIN_WORLD_AGENTS.records.set('fixture-grant',{reference:{grantId:'fixture-grant'},registered:true,grant:{roomId:'march',entityId:body.id,
      actor:'did:web:identity.example:agents:test-companion',role:'teammate',actions:['observe','move','attack'],expiresAt:new Date(Date.now()+600000).toISOString(),revoked:false}});
  }
}; window.__fixturePackets=[];
window.__mainAgentFixture.focusCheck=()=>{
  window.__HM_GAMING={mainWorldAgents:{enabled:true,affordances:'https://game.test/world/native-agents'}};
  netUiOn();netSheetToggle(true);mainWorldAgentRender();const button=document.querySelector('#world-agent-records button');
  if(!button)return {same:false,focused:false,started:GAME.started,count:MAIN_WORLD_AGENTS.records.size,sheet:!!document.querySelector('#netsheet .sheet'),enabled:window.__HM_GAMING?.mainWorldAgents?.enabled};
  button.focus();
  mainWorldAgentRender();mainWorldAgentRender();
  return {same:button===document.querySelector('#world-agent-records button'),focused:document.activeElement===button};
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
            await page.route('https://game.test/**',lambda route:route.fulfill(content_type='text/html',body=html))
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
            result=await page.evaluate(r"""() => {
              const H=__hm,P=H.GAME.player; window.__holdFrame=true; H.UI.modal=null;
              for(const id of ['prologue','menu','dialog']){const e=document.getElementById(id);if(e)e.hidden=true}
              __mainAgentFixture.bind();
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
            focus=await page.evaluate('__mainAgentFixture.focusCheck()')
            assert focus['same'] and focus['focused'],focus
            print('PASS access polling preserves the current revoke button and keyboard focus',flush=True)
            await page.screenshot(path=str(hm.OUT/'main-world-agents.png'),timeout=300000)
            print(json.dumps(result),flush=True)
        finally:await browser.close()
if __name__=='__main__':asyncio.run(main())
