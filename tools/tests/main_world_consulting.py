"""Actual built Progress/Coach UI with explicit native/Foxxi fixtures.

The game activity module, character save queue, Coach state machine and DOM are
real source. Private pod and planner ports are fixtures; this is not live proof.
Only the fixture clock advances for automatic-scheduling tests. No live identity,
private record, consent, service call or gameplay improvement is claimed.
"""
import asyncio, json, os, pathlib, sys
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
import hm
from hmlib import human_play
from playwright.async_api import async_playwright

QA_OUT=pathlib.Path(os.environ.get('HM_COACH_QA_OUT',str(hm.OUT)))
QA_OUT.mkdir(parents=True,exist_ok=True)

HOOK = r"""
window.__consultingFixture={
  realDate:Date,
  realNow:Date.now.bind(Date),
  reset({restore=false}={}){
    marchConsultingClose();Object.assign(MARCH_CONSULTING,{busy:false,note:'',ownerKey:'',snoozeUntil:0,lastTip:''});
    document.getElementById('march-consulting')?.remove();
    Object.assign(this,{clock:Math.max(this.clock||0,this.realNow()),calls:[],external:0,requests:0,pending:false,pendingKind:'',knownRefusal:'',
      delayConsent:false,delaySign:false,delayAfterSend:false,consentGate:null,signGate:null,afterSendGate:null,
      failDiscovery:false,failReply:false,characterUnconfirmed:false,characterWrites:[],journalCreations:0,
      history:{consents:[],observations:[],consultations:[],evaluations:[]}});
    MARCH_COACH_DELIVERY.pending=null;MARCH_COACH_DELIVERY.receipts=[];
    if(!restore){this.character=null;this.companion=null;partyCompanionLoad(null);Object.assign(GAME_ACTIVITY,{profile:null,stored:undefined,scope:null,blocked:false,queue:[],preloadDropped:0,code:null});}
    NETWS.generation++;
  },
  async bind({restore=false}={}){
    // The normal title above created a local character. Bind its explicit test
    // native profile before observing it; a live helper never resets this state.
    if(!restore)Object.assign(GAME_ACTIVITY,{profile:null,stored:undefined,scope:null,blocked:false,queue:[],preloadDropped:0,code:null});
    // Both capture-time observations (new Date()) and age/expiry checks
    // (Date.now()) must share this explicit fixture clock. Preserve normal
    // parsing, explicit constructor arguments, prototypes and Date() calls.
    const f=this,NativeDate=this.realDate;
    function FixtureDate(...args){
      if(!new.target)return new NativeDate(f.clock).toString();
      return Reflect.construct(NativeDate,args.length?args:[f.clock],new.target);
    }
    Object.setPrototypeOf(FixtureDate,NativeDate);FixtureDate.prototype=NativeDate.prototype;
    FixtureDate.now=()=>f.clock;window.Date=FixtureDate;
    NETWS.state='on';NETWS.acct={id:'fixture-player'};NETWS.worldRoom='march';NETWS.generation ||=1;NETWS.token='fixture-app-token';
    Object.assign(SAVE,{native:true,readConfirmed:true,nativeFlight:null,nativePaused:false,pending:null,chain:Promise.resolve(),lastBody:'',lastCore:''});
    NATIVE_PLAYER.status={bound:true,verified:true,account:{id:'fixture-player'},binding:{subjectDid:'did:example:self',podUrl:'https://pods.example/self/',authenticatedAgentDid:'did:example:delegate'}};
    nativePlayerRequest=async()=>structuredClone(NATIVE_PLAYER.status);
    nativePlayerModules=async()=>{NATIVE_PLAYER.cache={list:async()=>[{ownerDid:'did:example:self',podUrl:'https://pods.example/self/',expiresAt:Date.now()+3600000,relayUrl:'https://relay.example'}],
      get:async()=>({credential:{kind:'relay-oauth-bearer',accessToken:'FIXTURE-PRIVATE-NATIVE-TOKEN',expiresAt:Date.now()+3600000}})}};
    SAVE.ref={native:true,async get(){return{exists:!!f.character,data:()=>structuredClone(f.character)}},async set(value){
      f.calls.push('character-save');f.characterWrites.push(structuredClone(value));f.character=structuredClone(value);
      if(f.characterUnconfirmed)throw Object.assign(Error('fixture unknown character ACK'),{code:'pod_pending'});
    }};
    if(restore&&this.character){SAVE_PARTS.char.coachDelivery.load(this.character.char.x.coachDelivery);SAVE_PARTS.char.activity.load(this.character.char.x.activity);SAVE.loaded=structuredClone(this.character);SAVE.lastBody=JSON.stringify({...this.character,savedAt:0});}
    // A configured server exposes Players even while this fixture has no peers.
    // Start its real UI lifecycle: the held game frame cannot do it for us.
    window.__HM_GAMING={...window.__HM_GAMING,mainWorldAgents:{enabled:true,applicationId:'did:example:hallowmarch-fixture',audience:location.origin,affordances:location.origin+'/world/native-agents'}};
    netWsSend=()=>true;NETUI.lines=[{who:'Private chat',text:'DO-NOT-EXPORT-CHAT',c:'#fff',ch:'r'}];GAME.player.privateInventory='DO-NOT-EXPORT-INVENTORY';
    netUiOn();UI.frame=0;netUiFrame();
    await activityModules();activityEnsure();
  },
  open(){openChronicle('coach');marchConsultingRender()},
  setupReady(value){NATIVE_PLAYER.status.verified=value;marchConsultingRender()},
  leave(){closeMenu();if(NETUI.open)netSheetToggle(false)},
  advance(ms){this.clock+=ms},step(){marchConsultingStep()},
  record(type='resource.gathered',object='fixture-ore'){return activityRecord(type,object,1,{actor:{kind:'human-input'},success:!type.endsWith('.refused'),...(type.endsWith('.refused')?{reason:'range'}:{})})},
  unit(){this.companion ||= partyCompanionCreate('Fixture learner');return this.companion},
  recordUnit(type,object='fixture-ability'){return activityRecord(type,object,1,{entity:this.unit(),actor:{kind:'companion-autonomy'},success:!type.endsWith('.refused'),...(type.endsWith('.refused')?{reason:'range'}:{})})},
  archiveOnly(){const profile=GAME_ACTIVITY.profile,page=profile.nextArchivePage();if(!page)throw Error('no fixture archive page');return profile.archiveConfirmed(page,{graphIri:'urn:graph:fixture:activity',cid:'bafy-fixture-page',descriptorUrl:'https://pods.example/self/fixture-page.ttl'});},
  releaseConsent(){this.consentGate?.();this.consentGate=null},releaseSign(){this.signGate?.();this.signGate=null},releaseAfterSend(){this.afterSendGate?.();this.afterSendGate=null},
  reopen(){marchConsultingClose();document.getElementById('march-consulting')?.remove();this.open()},
  changeOwner(){NETWS.generation++;NATIVE_PLAYER.status.binding.subjectDid='did:example:next-owner';marchConsultingStep();return MARCH_CONSULTING.baseline===null},
  planState(){return {plan:MARCH_CONSULTING.consultationId,focus:structuredClone(MARCH_CONSULTING.baselineFocus)}},
  criterionCurrent(){return window.__hm.activity.observeCriterion(MARCH_CONSULTING.tried.focus.criterion).current},
  info(){return {calls:[...this.calls],external:this.external,requests:this.requests,pending:this.pending,characterPending:!!SAVE.pending,
    privateIntent:structuredClone(MARCH_COACH_DELIVERY.pending),reviewed:!!MARCH_CONSULTING.reviewed,
    history:structuredClone(this.history),character:structuredClone(this.character),characterWrites:structuredClone(this.characterWrites),lastPayload:structuredClone(this.lastPayload||null),
    lastInput:structuredClone(this.lastInput||null),snapshot:activitySnapshot(),status:window.__hm.consulting.status}},
  makeJournal({binding,sessionId}){
    const f=this,denied=new Set(),scope=x=>JSON.stringify([x.purpose,x.recipient,x.taskId]);f.journalCreations++;
    const fail=code=>{throw Object.assign(new Error(code),{code})};
    const grant=x=>({...x,ownerDid:binding.subjectDid,sessionId,expiresAt:new Date(Date.now()+900000).toISOString(),id:'consent-'+f.history.consents.length,revision:1});
    const auth=x=>{const c=f.history.consents.find(c=>scope(c)===scope(x)&&c.sessionId===sessionId);if(!c||c.revoked||denied.has(scope(x)))fail('consultation_consent_required');return structuredClone(c)};
    const write=(kind,item,collection)=>{f.calls.push(kind);f.history[collection].push(structuredClone(item));if(f.pendingKind===kind){f.pendingKind='';f.pending=true;fail('pod_pending')}return item};
    return {
      connect:async()=>{f.calls.push('connect-read')},read:async()=>{f.calls.push('history-read');return structuredClone(f.history)},
      status:()=>({podUrl:binding.podUrl,ownerDid:binding.subjectDid,keyPresent:true,pending:f.pending}),authorize:async x=>auth(x),assertAuthorized:async x=>auth(x),
      async grantConsent(x){f.calls.push('consent:'+x.purpose);if(x.accepted!==true)fail('consultation_consent_required');
        if(f.delayConsent&&x.purpose==='retain-observations')await new Promise(r=>{f.consentGate=r});
        f.history.consents=f.history.consents.filter(c=>scope(c)!==scope(x));f.history.consents.push(grant(x));denied.delete(scope(x));return{saved:true}},
      revokeConsent(x){denied.add(scope(x));f.calls.push('withdraw:'+x.purpose);const c=f.history.consents.find(c=>scope(c)===scope(x));if(c)c.revoked=true;return Promise.resolve({saved:true})},
      async appendObservation(x){if(f.knownRefusal==='observation'){f.knownRefusal='';fail('consultation_consent_required')}
        auth({purpose:'retain-observations',recipient:binding.podUrl,taskId:x.task.id});
        const previous=f.history.observations.find(item=>item.task.id===x.task.id);
        if(previous&&JSON.stringify({...previous.task,observedResult:''})!==JSON.stringify({...x.task,observedResult:''}))fail('task_scope_changed');
        const observation={...structuredClone(x),ownerDid:binding.subjectDid,id:'obs-'+f.history.observations.length,at:new Date().toISOString()};
        write('observation',observation,'observations');return{saved:true,observation}},
      async appendConsultation(x){const consultation={...structuredClone(x),id:'plan-'+f.history.consultations.length,at:new Date().toISOString()};
        write('consultation',consultation,'consultations');return{saved:true,consultation}},
      async appendEvaluation(x){const evaluation={...structuredClone(x),id:'eval-'+f.history.evaluations.length};write('evaluation',evaluation,'evaluations');return{saved:true,evaluation}},
      retry:async()=>{f.calls.push('retry-exact');f.pending=false;return{saved:true}},close(){}
    }
  },
  makeConsultant({binding,journal}){
    const f=this,prepared=new WeakSet(),recipient='https://foxxi.example/agent/plan';
    return {connect:async()=>{f.calls.push('discovery-read');if(f.failDiscovery)throw Object.assign(Error('fixture discovery refused'),{code:'consulting_unavailable'})},status:()=>({recipient}),
      preparePlan(input){f.lastInput=structuredClone(input);const p={payload:{situation:{id:'urn:hallowmarch:consultation:'+input.observationId,
        competency:input.focus?.desiredResult||input.task.workContext,workContext:(input.focus?input.focus.workContext+'\nMilestone: '+input.focus.id+' ('+input.focus.title+')':input.task.workContext)+'\nOwner-browser observations, not server-verified outcomes: '+JSON.stringify(input.context),
        observed:input.task.observedResult,performer:{id:binding.subjectDid,kind:'human'},modalStatus:'Hypothetical',provenance:'owner-browser-observed-gameplay'},
        ...(input.trajectories?{trajectories:structuredClone(input.trajectories)}:{})},taskId:input.task.id,recipient,descriptorUrl:'https://foxxi.example/plan/affordance',action:'urn:foxxi:plan'};prepared.add(p);return p},
      async requestPlan(p){if(!prepared.has(p))throw Error('unprepared fixture request');f.requests++;f.calls.push('native-sign-start');f.lastPayload=structuredClone(p.payload);
        if(f.delaySign)await new Promise(r=>{f.signGate=r});await journal.assertAuthorized({purpose:'request-consultation',recipient,taskId:p.taskId});
        f.calls.push('foxxi-delivery');f.external++;
        if(f.delayAfterSend)await new Promise(r=>{f.afterSendGate=r});
        if(f.failReply){f.failReply=false;throw Object.assign(Error('fixture unknown Foxxi reply'),{code:'consulting_unconfirmed'})}
        return{response:{classifiedBy:'did:example:delegate',diagnosis:{situationId:p.payload.situation.id,method:'fixture-method',regimeSource:'observed-gameplay',reasoning:['Fixture guidance uses the observed milestone.']},
          plan:{situationId:p.payload.situation.id,summary:'Fixture coach: use the current field guide, then try one legal task.',selected:[{type:'job-aid',rationale:'Use the relevant guide before the next attempt.'}]}},
          service:{action:p.action,target:recipient},source:{descriptorUrl:p.descriptorUrl,action:p.action,target:recipient},observationLevel:'owner-browser-observed-gameplay',competencyClaims:[]}},close(){}
    }
  }
};__consultingFixture.reset();
"""

async def main():
    base=hm.HTML.read_text();position=base.rfind('</script>');assert position>0
    persisted=None;port_writes=[]
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
                if route.request.method not in ('GET','HEAD','OPTIONS'):
                    port_writes.append({'method':route.request.method,'url':path})
                    return await route.fulfill(status=503,content_type='application/json',body='{"error":"unconfigured-fixture-write"}')
                if path.endswith('/performance-consultation.mjs'):
                    return await route.fulfill(content_type='application/javascript',body='export const createOwnerPerformanceConsultation=x=>window.__consultingFixture.makeJournal(x);')
                if path.endswith('/foxxi-consulting.mjs'):
                    return await route.fulfill(content_type='application/javascript',body='export const createFoxxiConsultant=x=>window.__consultingFixture.makeConsultant(x);')
                if path.endswith('/gameplay-activity.mjs'):
                    return await route.fulfill(content_type='application/javascript',body=(hm.HERE.parent/'client/native-pod/gameplay-activity.mjs').read_text())
                if path.endswith('/gameplay-activity-archive.mjs'):
                    return await route.fulfill(content_type='application/javascript',body='export const createOwnerGameplayActivityArchive=()=>({connect:async()=>{},status:()=>({code:null}),appendPage:async()=>({saved:false}),close(){}});')
                restore='' if persisted is None else '\nwindow.__coachFixtureRestore='+json.dumps(persisted)+';\n'
                html=base[:position]+HOOK+restore+base[position:]
                await route.fulfill(content_type='text/html',body=html)
            await page.route('https://game.test/**',route_game)
            await page.goto('https://game.test/?safe=1',wait_until='commit')
            await page.wait_for_function('window.__hm?.ready',timeout=300000,polling=500)
            print('Actual built game ready; all native/planner services below are fixtures',flush=True)
            await page.locator('#name-input').fill('Coach regression');await page.locator('#btn-begin').click()
            await page.wait_for_function('window.__hm.GAME.started',timeout=30000)
            await page.evaluate('window.__holdFrame=true')
            await page.get_by_role('button',name='Skip the prologue',exact=True).click(timeout=60000)
            await page.evaluate('__consultingFixture.bind()')

            async def destination(tab):
                state=await page.evaluate(r"""() => ({tab:__hm.UI.menuTab,modal:__hm.UI.modal,
                  overlays:[...document.querySelectorAll('.overlay')].filter(e=>!e.hidden&&e.getClientRects().length).map(e=>e.id),
                  selected:[...document.querySelectorAll('#menu-tabs [role="tab"][aria-selected="true"]')].map(e=>e.dataset.tab)})""")
                assert state=={'tab':tab,'modal':'menu','overlays':['menu'],'selected':[tab]},state

            async def navigation_only():
                state=await page.evaluate(r"""() => ({external:__consultingFixture.external,requests:__consultingFixture.requests,
                  journalCreations:__consultingFixture.journalCreations,enabled:__hm.consulting.status.enabled,
                  writes:__consultingFixture.calls.filter(x=>x.startsWith('consent:')||x==='foxxi-delivery'||x==='observation'||x==='consultation')})""")
                assert state=={'external':0,'requests':0,'journalCreations':0,'enabled':False,'writes':[]},state
                assert not port_writes,port_writes

            # These Character links live outside .chron. Exercise their real
            # click handlers so an inert shortcut cannot pass via a direct API.
            await page.locator('#btn-menu').click()
            await page.locator('#menu-body [data-lore="sec:coach"]').click()
            await destination('progress')
            await page.wait_for_selector('#march-coach-mount #march-consulting')
            assert await page.locator('#menu-body .chron-nav').count()==0
            assert await page.locator('#march-coach-mount').count()==1
            await navigation_only()
            await page.locator('#menu-tabs [data-tab="char"]').click()
            await page.locator('#menu-body [data-lore="sec:path"]').click()
            await destination('chronicle')
            assert await page.evaluate('__hm.LORE.state.chronSec')=='path'
            assert await page.locator('.chron-nav [data-sec="path"][aria-current="true"]').is_visible()
            await navigation_only()
            # Existing callers keep their public route, but it must select the
            # dedicated Progress tab rather than a nested Chronicle section.
            await page.evaluate('__hm.LORE.openChronicle("coach")')
            await destination('progress')
            assert await page.locator('#menu-body .chron-nav').count()==0
            await page.wait_for_selector('#march-coach-mount #march-consulting')
            await navigation_only()
            await page.locator('#menu-close').click()
            await page.locator('#btn-net').click()
            assert await page.locator('#netsheet').is_visible()
            assert not await page.locator('#menu').is_visible()
            await page.locator('#netsheet [data-act="progress"]').click()
            await destination('progress')
            assert not await page.locator('#netsheet').is_visible()
            await navigation_only()
            print('PASS Character progress/path links and Players→Progress use real routes without stacked panels, automatic Enable, consent or delivery',flush=True)
            await page.wait_for_function('__hm.activity.snapshot().current',timeout=30000)
            assert await page.locator('#march-consulting input,#march-consulting textarea,#march-consulting form').count()==0
            assert await page.locator('#march-coach-interventions button').count()>=2
            assert 'No LLM setup or API key is needed.' in await page.locator('#march-consulting').inner_text()
            assert await page.get_by_role('heading',name='Foxxi guidance',exact=True).is_visible()
            assert await page.get_by_role('heading',name='Private learning record',exact=True).is_visible()
            assert await page.evaluate('document.getElementById("march-learning-record").parentElement===document.getElementById("march-coach-guidance").parentElement&&!document.getElementById("march-coach-options").contains(document.getElementById("march-learning-record"))')
            assert await page.locator('#march-learning-enable').is_visible()
            assert not await page.locator('#march-consulting-request').is_visible()
            assert not await page.locator('#march-consulting-withdraw').is_visible()
            assert not await page.locator('#march-coach-recovery').is_visible()
            assert not await page.locator('#march-learning-recovery').is_visible()
            await page.evaluate('__consultingFixture.setupReady(false)')
            assert await page.locator('#march-progress-prerequisite').is_visible()
            assert await page.locator('#march-consulting-connect').is_disabled()
            assert await page.locator('#march-learning-enable').is_disabled()
            await page.evaluate('__consultingFixture.setupReady(true)')
            assert not await page.locator('#march-progress-prerequisite').is_visible()
            assert await page.locator('#march-learning-enable').is_enabled()
            await navigation_only()
            await page.screenshot(path=str(QA_OUT/'coach-desktop.png'),timeout=300000)
            await page.set_viewport_size({'width':390,'height':844})
            layout=await page.locator('#march-consulting').evaluate('(e)=>({width:e.getBoundingClientRect().width,overflow:document.documentElement.scrollWidth>innerWidth,taps:[...e.querySelectorAll("button,summary")].filter(b=>!b.hidden&&b.getClientRects().length).map(b=>b.getBoundingClientRect().height)})')
            assert not layout['overflow'] and layout['width']<=390 and all(h>=43 for h in layout['taps']),layout
            await page.screenshot(path=str(QA_OUT/'coach-mobile.png'),timeout=300000)
            await page.set_viewport_size({'width':960,'height':720})
            assert not await page.locator('#march-coach-options').evaluate('(e)=>e.open')
            assert not await page.locator('#march-coach-preview').is_visible()
            discover=page.locator('#march-coach-options > summary')
            assert await discover.inner_text()=='Start a 15-minute guidance session'
            await discover.click()
            assert await page.locator('#march-coach-options').evaluate('(e)=>e.open')
            assert await page.get_by_role('button',name='Start Foxxi guidance for 15 minutes',exact=True).is_visible()
            assert not await page.locator('#march-coach-preview').is_visible()
            assert await page.locator('#march-learning-enable').is_visible()
            assert await page.evaluate("__consultingFixture.external===0&&__consultingFixture.requests===0&&__consultingFixture.journalCreations===0&&!__consultingFixture.calls.some(x=>x.startsWith('consent:')||x==='foxxi-delivery')")
            await page.locator('#march-coach-options').evaluate('(e)=>e.open=false')
            await page.get_by_role('button',name='Find materials nearby',exact=True).click()
            assert await page.evaluate('__hm.activity.snapshot().summary.counters["intervention.started"]')==1
            assert await page.evaluate('__consultingFixture.external===0&&__consultingFixture.requests===0')
            await page.locator('#menu-tabs [data-tab="progress"]').click()
            await destination('progress')
            print('PASS actual Progress tab shows observed milestones and a working local action card without forms, consent or planner I/O',flush=True)

            async def options():
                await page.locator('#march-coach-options').evaluate('(e)=>e.open=true')
            async def enable():
                await options();await page.locator('#march-consulting-connect').click()
            async def settled():
                await page.wait_for_function('!__hm.consulting.status.busy')
            async def reset():
                await page.evaluate('__consultingFixture.reset();__consultingFixture.bind().then(()=>__consultingFixture.open())')
                await page.wait_for_function('__hm.activity.snapshot().current&&!__hm.consulting.status.busy')
            await enable();await page.wait_for_function('__hm.consulting.status.hasPrivatePlan&&!__hm.consulting.status.busy')
            await page.locator('#march-coach-options').evaluate('(e)=>e.open=false')
            assert await page.locator('#march-consulting-withdraw').is_visible()
            assert await page.get_by_role('button',name='Stop Foxxi sharing',exact=True).is_enabled()
            assert await page.locator('#march-consulting-request').is_visible()
            assert await page.locator('#march-learning-enable').is_visible()
            assert not await page.locator('#march-coach-recovery').is_visible()
            evidence=await page.evaluate('__consultingFixture.info()')
            assert evidence['external']==1 and evidence['requests']==1
            assert len(evidence['history']['observations'])==1 and len(evidence['history']['consultations'])==1
            assert evidence['lastPayload']['situation']['performer']=={'id':'did:example:self','kind':'human'}
            assert evidence['lastPayload']['situation']['provenance']=='owner-browser-observed-gameplay'
            assert evidence['lastInput']['focus']['title']=='Collect a resource'
            assert evidence['calls'].index('character-save')<evidence['calls'].index('foxxi-delivery')
            assert not evidence['privateIntent']
            assert any(body['char']['x']['coachDelivery']['pending'] and body['char']['x']['coachDelivery']['pending']['id']==evidence['lastPayload']['situation']['id'] for body in evidence['characterWrites'])
            encoded=json.dumps(evidence['lastPayload'])
            assert all(secret not in encoded for secret in ['DO-NOT-EXPORT','FIXTURE-PRIVATE-NATIVE-TOKEN','fixture-app-token'])
            assert await page.get_by_text('Fixture coach: use the current field guide, then try one legal task.',exact=True).is_visible()
            print('PASS one explicit Enable persists exact private delivery intent before one fixture Foxxi plan and exact private history',flush=True)

            # Closing a fixture menu does not count as human activity. Use a
            # trusted browser gesture before each automatic scheduling scenario.
            async def resume_play():
                await page.evaluate('__consultingFixture.leave()')
                await human_play(page)
            await resume_play()
            await page.evaluate('__consultingFixture.record();__consultingFixture.advance(120001);__consultingFixture.step()')
            await page.wait_for_function('__consultingFixture.external===2&&!__hm.consulting.status.busy')
            assert await page.evaluate('__consultingFixture.lastInput.focus.title')=='Complete a recipe'
            assert await page.evaluate('__consultingFixture.history.observations.length')==2
            assert await page.evaluate('__consultingFixture.history.observations[0].task.id===__consultingFixture.history.observations[1].task.id')
            await page.evaluate('__consultingFixture.archiveOnly();__consultingFixture.advance(120001);__consultingFixture.step()')
            await page.wait_for_timeout(50);assert await page.evaluate('__consultingFixture.external')==2
            await page.evaluate('__consultingFixture.record("ability.executed","fixture-ability");__consultingFixture.advance(120001);__hm.GAME.player.combatUntil=__hm.GAME.t+10;__consultingFixture.step()')
            await page.wait_for_timeout(50);assert await page.evaluate('__consultingFixture.external')==2
            await page.evaluate('__hm.GAME.player.combatUntil=-1;__consultingFixture.open()')
            await page.get_by_role('button',name='Quiet for 10 minutes',exact=True).click()
            await resume_play()
            await page.evaluate('__consultingFixture.advance(120001);__consultingFixture.step()')
            await page.wait_for_timeout(50);assert await page.evaluate('__consultingFixture.external')==2
            print('PASS later observed milestone schedules a new bounded plan; archive-only revisions, combat and snooze suppress automatic requests (fixture clock only)',flush=True)

            await reset();await page.evaluate('__consultingFixture.recordUnit("ability.refused")');await enable()
            await page.wait_for_function('__hm.consulting.status.hasPrivatePlan&&!__hm.consulting.status.busy')
            before=await page.evaluate('__consultingFixture.planState()')
            assert before['focus']['bodyKind']=='owned-unit' and before['focus']['criterion']['eventType']=='ability.executed'
            await page.get_by_role('button',name='Review your calling',exact=True).click()
            await page.evaluate('__consultingFixture.record("ability.executed","human-only-ability")')
            assert await page.evaluate('__consultingFixture.criterionCurrent()')==0
            await resume_play()
            await page.evaluate('__consultingFixture.recordUnit("ability.executed");__consultingFixture.record("resource.gathered","fixture-ore");__consultingFixture.advance(120001);__consultingFixture.step()')
            await page.wait_for_function('__consultingFixture.history.evaluations.length===1&&!__hm.consulting.status.busy')
            comparison=await page.evaluate('__consultingFixture.history.evaluations[0]')
            assert comparison['consultationId']==before['plan']
            comparison_observation=await page.evaluate('(id)=>__consultingFixture.history.observations.find(x=>x.id===id)',comparison['observationId'])
            assert '1 / 1 subsequent observed completions for this body' in comparison_observation['task']['observedResult']
            assert await page.evaluate('__hm.activity.snapshot().current.id')=='craft-one'
            assert await page.evaluate('__consultingFixture.history.evaluations.length')==1
            print('PASS failure→intervention→later success compares the original owned body criterion even after focus changes; human success cannot substitute',flush=True)

            for kind in ['observation','consultation']:
                await reset();await page.evaluate('(kind)=>__consultingFixture.pendingKind=kind',kind);await enable()
                await page.wait_for_function('__consultingFixture.pending&&!__hm.consulting.status.busy')
                assert await page.locator('#march-coach-recovery').is_visible()
                before=await page.evaluate('__consultingFixture.external')
                await page.locator('#march-consulting-retry').click();await settled()
                await page.locator('#march-coach-continue').click()
                await page.wait_for_function('__hm.consulting.status.hasPrivatePlan&&!__hm.consulting.status.busy')
                info=await page.evaluate('__consultingFixture.info()')
                assert info['external']==1 and info['requests']==1
                assert len(info['history']['observations'])==len(info['history']['consultations'])==1
                assert info['calls'].count('retry-exact')==1
                if kind=='consultation':assert before==1
            print('PASS unknown private observation/plan ACK confirms and continues the same writes without duplicate history or planner delivery',flush=True)

            await reset();await page.evaluate('__consultingFixture.characterUnconfirmed=true');await enable();await settled()
            assert await page.evaluate('__consultingFixture.external===0&&__consultingFixture.info().characterPending&&!!__consultingFixture.info().privateIntent')
            await page.evaluate('__consultingFixture.characterUnconfirmed=false')
            await page.locator('#march-coach-continue').click()
            await page.wait_for_function('__hm.consulting.status.hasPrivatePlan&&!__hm.consulting.status.busy')
            assert await page.evaluate('__consultingFixture.external===1&&__consultingFixture.history.observations.length===1')
            print('PASS an unconfirmed native character intent blocks delivery until its exact save is confirmed',flush=True)

            for stage in ['Consent','Sign']:
                await reset();await page.evaluate('(stage)=>__consultingFixture["delay"+stage]=true',stage);await enable()
                await page.wait_for_function('(stage)=>!!__consultingFixture[stage.toLowerCase()+"Gate"]',arg=stage)
                assert await page.locator('#march-consulting-withdraw').is_enabled()
                await page.locator('#march-consulting-withdraw').click()
                await page.evaluate('(stage)=>__consultingFixture["release"+stage]()',stage);await settled()
                assert await page.evaluate('__consultingFixture.external===0&&!__hm.consulting.status.enabled')
                if stage=='Consent':
                    await page.evaluate('__consultingFixture.delayConsent=false')
                    await enable();await page.wait_for_function('__hm.consulting.status.hasPrivatePlan&&!__hm.consulting.status.busy')
                    assert await page.evaluate('__consultingFixture.external')==1
            print('PASS Stop remains usable during consent and native signing; pre-delivery cancellation permits a fresh explicit session',flush=True)

            await reset();await page.evaluate('__consultingFixture.delayAfterSend=true');await enable()
            await page.wait_for_function('__consultingFixture.afterSendGate&&__consultingFixture.external===1')
            await page.locator('#march-consulting-withdraw').click();await page.evaluate('__consultingFixture.releaseAfterSend()');await settled()
            assert await page.evaluate('__consultingFixture.external===1&&!__hm.consulting.status.enabled&&!__hm.consulting.status.hasPrivatePlan')
            print('PASS Stop during in-flight delivery sends no second request and does not falsely save the late reply as confirmed',flush=True)

            await reset();await page.evaluate('__consultingFixture.failReply=true');await enable();await settled()
            assert await page.evaluate('__consultingFixture.external===1&&!!__consultingFixture.info().privateIntent')
            await page.locator('#march-coach-continue').click();await settled()
            assert await page.evaluate('__consultingFixture.external===1&&__consultingFixture.requests===1')
            persisted=await page.evaluate('({character:__consultingFixture.character,history:__consultingFixture.history,external:__consultingFixture.external,requests:__consultingFixture.requests})')
            # Only synthetic fixture data is used as the reload backing. The native
            # save queue above still confirmed the exact actual character body.
            await page.add_init_script('localStorage.setItem("hallowmarch.save.v1",'+json.dumps(json.dumps(persisted['character']))+');')
            await page.reload(wait_until='commit');await page.wait_for_function('window.__hm?.ready',timeout=300000,polling=500)
            await page.locator('#btn-continue').click();await page.wait_for_function('__hm.GAME.started',timeout=30000)
            await page.evaluate('window.__holdFrame=true;Object.assign(__consultingFixture,__coachFixtureRestore);__consultingFixture.bind({restore:true}).then(()=>__consultingFixture.open())')
            await page.wait_for_selector('#march-consulting');assert await page.evaluate('!!__consultingFixture.info().privateIntent&&!__hm.consulting.status.enabled')
            assert await page.evaluate('__consultingFixture.external')==1
            await enable();await settled();assert await page.evaluate('__consultingFixture.external===1&&__consultingFixture.requests===1')
            await page.locator('#march-coach-close-pending').click();await settled()
            assert await page.evaluate('!__consultingFixture.info().privateIntent&&!__hm.consulting.status.enabled')
            print('PASS actual page reload retains unknown delivery intent, never resends it automatically, and explicit close retires it without replay',flush=True)

            await resume_play()
            assert await page.evaluate('__consultingFixture.changeOwner()')
            assert await page.evaluate('!__hm.consulting.status.hasPlan&&!__hm.consulting.status.enabled&&!__hm.consulting.status.reviewed')
            assert not errors,errors
            await page.set_viewport_size({'width':390,'height':844});await page.evaluate('__consultingFixture.open()')
            await page.screenshot(path=str(hm.OUT/'main-world-consulting-phone.png'),timeout=300000)
            print('PASS owner change clears prior coach state; no browser errors',flush=True)
            print(json.dumps({'pageErrors':errors,'plannerCalls':'fixture only','unknownDeliveryReplayed':False}),flush=True)
        finally:await browser.close()
if __name__=='__main__':asyncio.run(main())

