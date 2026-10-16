"""Built normal-game consulting UI regression with explicit native/Foxxi fixtures.
The test opens the actual title/prologue and captures actual simulation state.
Fixture modules record contract calls; no private record or live consent is made.
"""
import asyncio, json, os, pathlib, sys
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
import hm
from playwright.async_api import async_playwright

HOOK = r"""
window.__consultingFixture={
  reset(){
    marchConsultingClose();Object.assign(MARCH_CONSULTING,{busy:false,note:'',ownerKey:'',baseline:null});
    document.getElementById('march-consulting')?.remove();
    Object.assign(this,{calls:[],external:0,requests:0,pending:false,pendingKind:'',knownRefusal:'',delayConsent:false,delayPlan:false,
      consentGate:null,planGate:null,reorderReads:false,failDiscovery:false,journalCreations:0,history:{consents:[],observations:[],consultations:[],evaluations:[]}});
    NETWS.generation++;if(GAME.started)this.bind();
  },
  bind(){
    NETWS.state='on';NETWS.acct={id:'fixture-player'};NETWS.worldRoom='march';NETWS.generation ||=1;NETWS.token='fixture-app-token';
    SAVE.native=true;NATIVE_PLAYER.status={bound:true,verified:true,binding:{subjectDid:'did:example:self',podUrl:'https://pods.example/self/',authenticatedAgentDid:'did:example:delegate'}};
    nativePlayerRequest=async()=>structuredClone(NATIVE_PLAYER.status);
    nativePlayerModules=async()=>{NATIVE_PLAYER.cache={list:async()=>[{ownerDid:'did:example:self',podUrl:'https://pods.example/self/',expiresAt:Date.now()+3600000,relayUrl:'https://relay.example'}],
      get:async()=>({credential:{kind:'relay-oauth-bearer',accessToken:'FIXTURE-PRIVATE-NATIVE-TOKEN',expiresAt:Date.now()+3600000}})}};
    netWsSend=()=>true;NETUI.lines=[{who:'Private chat',text:'DO-NOT-EXPORT-CHAT',c:'#fff',ch:'r'}];GAME.player.privateInventory='DO-NOT-EXPORT-INVENTORY';
    netUiOn();netSheetToggle(true);marchConsultingRender();
  },
  releaseConsent(){this.consentGate?.();this.consentGate=null},releasePlan(){this.planGate?.();this.planGate=null},
  reopen(){marchConsultingClose();document.getElementById('march-consulting')?.remove();marchConsultingRender()},
  changeOwner(){NETWS.generation++;NATIVE_PLAYER.status.binding.subjectDid='did:example:next-owner';marchConsultingStep();return MARCH_CONSULTING.baseline===null},
  makeJournal({binding,sessionId}){
    const f=this,denied=new Set();f.journalCreations++;const scope=x=>JSON.stringify([x.purpose,x.recipient,x.taskId]);
    const fail=(code)=>{throw Object.assign(new Error(code),{code})};
    const grant=x=>({...x,ownerDid:binding.subjectDid,sessionId,expiresAt:new Date(Date.now()+900000).toISOString(),id:'consent-'+f.history.consents.length,revision:1});
    const auth=x=>{const c=f.history.consents.find(c=>scope(c)===scope(x));if(!c||c.revoked||denied.has(scope(x)))fail('consultation_consent_required');return structuredClone(c)};
    const write=(kind,item,collection)=>{f.calls.push(kind);f.history[collection].push(structuredClone(item));if(f.pendingKind===kind){f.pendingKind='';f.pending=true;fail('pod_pending')}return item};
    return {
      connect:async()=>{f.calls.push('connect-read')},read:async()=>{f.calls.push('history-read');const reorder=v=>Array.isArray(v)?v.map(reorder):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).reverse().map(([k,x])=>[k,reorder(x)])):v;return f.reorderReads?reorder(f.history):structuredClone(f.history)},
      status:()=>({podUrl:binding.podUrl,ownerDid:binding.subjectDid,keyPresent:true,pending:f.pending}),
      authorize:async x=>auth(x),assertAuthorized:async x=>auth(x),
      async grantConsent(x){f.calls.push('consent:'+x.purpose);if(x.accepted!==true)fail('consultation_consent_required');if(f.delayConsent&&x.purpose==='retain-observations')await new Promise(r=>{f.consentGate=r});
        f.history.consents=f.history.consents.filter(c=>scope(c)!==scope(x));f.history.consents.push(grant(x));denied.delete(scope(x));return {saved:true}},
      revokeConsent(x){denied.add(scope(x));f.calls.push('withdraw');const c=f.history.consents.find(c=>scope(c)===scope(x));if(c)c.revoked=true;return Promise.resolve({saved:true})},
      async appendObservation(x){if(f.knownRefusal==='observation'){f.knownRefusal='';fail('consultation_consent_required')}auth({purpose:'retain-observations',recipient:binding.podUrl,taskId:x.task.id});
        const observation={...structuredClone(x),ownerDid:binding.subjectDid,id:'obs-'+f.history.observations.length,at:new Date().toISOString()};write('observation',observation,'observations');return {saved:true,observation}},
      async appendConsultation(x){const consultation={...structuredClone(x),id:'plan-'+f.history.consultations.length,at:new Date().toISOString()};write('consultation',consultation,'consultations');return {saved:true,consultation}},
      async appendEvaluation(x){const evaluation={...structuredClone(x),id:'eval-'+f.history.evaluations.length};write('evaluation',evaluation,'evaluations');return {saved:true,evaluation}},
      retry:async()=>{f.calls.push('retry-exact');f.pending=false;return {saved:true}},close(){}
    }
  },
  makeConsultant({binding,journal,sessionId}){
    const f=this,prepared=new WeakSet(),recipient='https://foxxi.example/agent/plan';
    return {connect:async()=>{f.calls.push('discovery-read');if(f.failDiscovery)throw Object.assign(Error('fixture-discovery-refused'),{code:'consulting_unavailable'})},status:()=>({recipient}),
      preparePlan(input){const p={payload:{task:structuredClone(input.task),context:structuredClone(input.context),gapEvidence:input.gapEvidence||{},performer:{id:binding.subjectDid,kind:'human'}},
        taskId:input.task.id,recipient,descriptorUrl:'https://foxxi.example/plan/affordance',action:'urn:foxxi:plan'};prepared.add(p);return p},
      async requestPlan(p){if(!prepared.has(p))throw Error('unreviewed-fixture-request');f.requests++;f.lastPayload=structuredClone(p.payload);
        if(f.delayPlan)await new Promise(r=>{f.planGate=r});await journal.assertAuthorized({purpose:'request-consultation',recipient,taskId:p.taskId});f.external++;
        return {response:{classifiedBy:'did:example:delegate',diagnosis:{method:'gap-analysis',regimeSource:'performer-report'},
          plan:{summary:'Fixture service returned a reference before practice.',selected:[{type:'reference',rationale:'The player reported missing instructions.',reference:'https://game.test/gaming/resources/view?id=field-note:keep'}]}},
          service:{action:p.action,target:recipient},source:{descriptorUrl:p.descriptorUrl,action:p.action,target:recipient},observationLevel:'performer-reported-and-owner-browser',competencyClaims:[]}},close(){}
    }
  }
};__consultingFixture.reset();
"""

async def main():
    html=hm.HTML.read_text();pos=html.rfind('</script>');assert pos>0;html=html[:pos]+HOOK+html[pos:]
    async with async_playwright() as p:
        browser=await p.chromium.launch(executable_path=os.environ.get('HM_CHROMIUM_EXECUTABLE') or None,
            args=['--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist'])
        try:
            page=await browser.new_page(viewport={'width':960,'height':720});errors=[]
            page.on('pageerror',lambda e:errors.append(str(e)))
            await page.add_init_script("window.__holdFrame=false;const raf=window.requestAnimationFrame.bind(window);window.requestAnimationFrame=cb=>cb.name==='frame'?raf(function draw(t){if(window.__holdFrame||window.__hm?.ready)raf(draw);else cb(t)}):raf(cb);")
            await page.route(hm.THREE_URL,lambda route:route.fulfill(content_type='application/javascript',body=hm.THREE_LOCAL.read_text(),headers={'Access-Control-Allow-Origin':'*'}))
            await page.route('https://fonts.googleapis.com/**',lambda route:route.fulfill(content_type='text/css',body=''))
            await page.route('https://fonts.gstatic.com/**',lambda route:route.fulfill(body=''))
            async def route_game(route):
                path=route.request.url.split('?',1)[0]
                if path.endswith('/performance-consultation.mjs'):
                    return await route.fulfill(content_type='application/javascript',body='export const createOwnerPerformanceConsultation=x=>window.__consultingFixture.makeJournal(x);')
                if path.endswith('/foxxi-consulting.mjs'):
                    return await route.fulfill(content_type='application/javascript',body='export const createFoxxiConsultant=x=>window.__consultingFixture.makeConsultant(x);')
                await route.fulfill(content_type='text/html',body=html)
            await page.route('https://game.test/**',route_game)
            await page.goto('https://game.test/?safe=1',wait_until='commit')
            await page.wait_for_function('window.__hm?.ready',timeout=300000,polling=500)
            print('Actual built game ready',flush=True)
            await page.locator('#name-input').fill('Consulting regression');await page.locator('#btn-begin').click()
            await page.wait_for_function('window.__hm.GAME.started',timeout=30000)
            await page.get_by_role('button',name='Skip the prologue',exact=True).click(timeout=30000)
            await page.evaluate('window.__holdFrame=true;__consultingFixture.bind()')
            await page.locator('#march-consulting-connect').click()
            await page.wait_for_function('__hm.consulting.status.connected')
            assert await page.evaluate('__consultingFixture.external')==0
            assert not await page.evaluate('__consultingFixture.calls.some(x=>x.startsWith("consent:")||x==="observation")')
            print('PASS actual normal game opens own private coaching read-only; no automatic consent, record or Foxxi request',flush=True)

            async def fill_review():
                await page.locator('#march-consulting-goal').fill('Survive a frost wolf fight')
                await page.locator('#march-consulting-current').fill('I lose health before I can get away.')
                await page.locator('#march-consulting-desired').fill('Leave the fight alive with half my health.')
                await page.locator('#march-consulting-review').click()
                await page.wait_for_function('__hm.consulting.status.reviewed&&!__hm.consulting.status.busy')
            async def consent_request():
                await page.locator('#march-consulting-retain').check();await page.locator('#march-consulting-share').check()
                await page.locator('#march-consulting-request').click()
            async def reset():
                await page.evaluate('__consultingFixture.reset()');await page.locator('#march-consulting-connect').click()
                await page.wait_for_function('__hm.consulting.status.connected&&!__hm.consulting.status.busy')
            await fill_review();await page.locator('#march-consulting-request').click()
            await page.wait_for_function('!__hm.consulting.status.busy')
            assert await page.evaluate('__consultingFixture.external')==0
            await page.locator('#march-consulting-current').fill('A revised report')
            assert not await page.locator('#march-consulting-preview').is_visible()
            await fill_review();frozen=await page.locator('#march-consulting-preview pre').text_content()
            assert 'DO-NOT-EXPORT' not in frozen and 'FIXTURE-PRIVATE-NATIVE-TOKEN' not in frozen and 'fixture-app-token' not in frozen
            await page.evaluate('__hm.GAME.prog.kills+=1')
            await consent_request();await page.wait_for_function('__hm.consulting.status.hasPrivatePlan&&!__hm.consulting.status.busy')
            sent=await page.evaluate('__consultingFixture.lastPayload')
            assert sent==json.loads(frozen)
            assert await page.evaluate('__consultingFixture.external')==1
            assert await page.locator('#march-consulting-result').get_by_text('The player reported missing instructions.',exact=True).is_visible()
            assert await page.locator('#march-consulting-result a').count()>=2
            print('PASS exact reviewed request, own-page metrics only, fresh explicit consent, actual returned plan/rationale/references and private record',flush=True)

            await page.locator('#march-consulting-tried').fill('Used the reference, then moved away before attacking.')
            await page.locator('#march-consulting-after').fill('I left alive.')
            await page.evaluate('__hm.GAME.prog.played+=30')
            await page.locator('#march-consulting-review-evaluation').click();await page.wait_for_function('!__hm.consulting.status.busy')
            assert await page.evaluate('__consultingFixture.history.evaluations.length')==0
            await page.locator('#march-consulting-save-evaluation').click();await page.wait_for_function('__hm.consulting.status.hasEvaluation&&!__hm.consulting.status.busy')
            assert await page.evaluate('__consultingFixture.external')==1
            assert await page.evaluate('__consultingFixture.history.evaluations.length')==1
            print('PASS before/after comparison uses actual local observations plus player report, saves only after explicit choice and makes no second service call',flush=True)
            await page.evaluate('__consultingFixture.reopen()');await page.locator('#march-consulting-connect').click()
            await page.wait_for_function('__hm.consulting.status.connected&&__hm.consulting.status.hasPrivatePlan&&!__hm.consulting.status.busy')
            assert await page.evaluate('__consultingFixture.external')==1
            assert await page.evaluate('__consultingFixture.history.consultations.length')==1
            print('PASS reconnect restores the actual private plan and baseline read-only',flush=True)

            await page.evaluate('__consultingFixture.reopen();Object.assign(__consultingFixture,{failDiscovery:true,external:0,requests:0,calls:[],journalCreations:0})')
            await page.locator('#march-consulting-connect').click()
            await page.wait_for_function('__hm.consulting.status.privateHistoryOpen&&!__hm.consulting.status.busy')
            assert await page.evaluate('__hm.consulting.status.hasPrivatePlan&&!__hm.consulting.status.connected')
            assert await page.locator('#march-consulting-result').get_by_text('The player reported missing instructions.',exact=True).is_visible()
            assert await page.locator('#march-consulting-request').is_disabled()
            assert not await page.locator('#march-consulting-form').is_visible()
            await page.locator('#march-consulting-connect').click();await page.wait_for_function('!__hm.consulting.status.busy')
            assert await page.evaluate('__consultingFixture.external===0&&__consultingFixture.requests===0&&__consultingFixture.journalCreations===1')
            assert not await page.evaluate('__consultingFixture.calls.some(x=>x.startsWith("consent:")||["observation","consultation","evaluation"].includes(x))')
            await page.evaluate('__consultingFixture.failDiscovery=false;__consultingFixture.pending=true')
            await page.locator('#march-consulting-connect').click();await page.wait_for_function('__hm.consulting.status.connected&&!__hm.consulting.status.busy')
            assert await page.evaluate('__consultingFixture.journalCreations===1&&__consultingFixture.pending')
            await page.locator('#march-consulting-retry').click();await page.wait_for_function('!__hm.consulting.status.busy&&!__consultingFixture.pending')
            await fill_review();await consent_request();await page.wait_for_function('__hm.consulting.status.hasPrivatePlan&&!__hm.consulting.status.busy')
            assert await page.evaluate('__consultingFixture.external===1&&__consultingFixture.journalCreations===1')
            print('PASS Foxxi discovery outage leaves saved private plan readable without sharing or writes; explicit retry reuses the journal and preserves pending I/O before recovering requests',flush=True)

            for pending_kind in ['observation','consultation']:
                await reset();await fill_review();await page.evaluate('(kind)=>{__consultingFixture.pendingKind=kind;__consultingFixture.reorderReads=true}',pending_kind)
                await consent_request();await page.wait_for_function('!__hm.consulting.status.busy&&__consultingFixture.pending')
                before=await page.evaluate('__consultingFixture.external')
                await page.locator('#march-consulting-retry').click();await page.wait_for_function('!__hm.consulting.status.busy&&!__consultingFixture.pending')
                await page.locator('#march-consulting-request').click();await page.wait_for_function('__hm.consulting.status.hasPrivatePlan&&!__hm.consulting.status.busy')
                assert await page.evaluate('__consultingFixture.external')==1
                assert await page.evaluate('__consultingFixture.history.observations.length')==1
                assert await page.evaluate('__consultingFixture.history.consultations.length')==1
                if pending_kind=='consultation':assert before==1
            print('PASS unknown private observation/plan ACK resumes the exact retained write and does not duplicate Foxxi delivery or history',flush=True)

            await reset();await fill_review();await page.evaluate('__consultingFixture.knownRefusal="observation"')
            await consent_request();await page.wait_for_function('!__hm.consulting.status.busy')
            await page.locator('#march-consulting-request').click();await page.wait_for_function('__hm.consulting.status.hasPrivatePlan&&!__hm.consulting.status.busy')
            assert await page.evaluate('__consultingFixture.history.observations.length')==1
            print('PASS known pre-write refusal leaves the private observation retryable',flush=True)

            for stage in ['Consent','Plan']:
                await reset();await fill_review();await page.evaluate('(stage)=>{__consultingFixture["delay"+stage]=true}',stage)
                await consent_request();await page.wait_for_function('(stage)=>!!__consultingFixture[stage.toLowerCase()+"Gate"]',arg=stage)
                assert await page.locator('#march-consulting-current').is_disabled()
                assert await page.locator('#march-consulting-withdraw').is_enabled()
                await page.locator('#march-consulting-withdraw').click()
                await page.evaluate('(stage)=>__consultingFixture["release"+stage]()',stage)
                await page.wait_for_function('!__hm.consulting.status.busy')
                assert await page.evaluate('__consultingFixture.external')==0
            print('PASS withdrawal remains usable during consent/signing I/O and stops subsequent delivery; form editing cannot bypass the reviewed request',flush=True)
            assert await page.evaluate('__consultingFixture.changeOwner()')
            assert not await page.locator('#march-consulting-preview').is_visible()
            assert await page.locator('#march-consulting-goal').input_value()==''
            assert not await page.evaluate('__hm.consulting.status.hasPlan')
            print('PASS changed owner connection clears the old goal, baseline, plan and preview',flush=True)
            assert not errors,errors
            await page.set_viewport_size({'width':390,'height':844})
            await page.screenshot(path=str(hm.OUT/'main-world-consulting-phone.png'),timeout=300000)
            print(json.dumps({'pageErrors':errors,'externalCalls':await page.evaluate('__consultingFixture.external')}),flush=True)
        finally:await browser.close()
if __name__=='__main__':asyncio.run(main())
