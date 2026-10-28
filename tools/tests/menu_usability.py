"""Task-based agent menu QA on a frozen, offline Hallowmarch build.

Synthetic identity states never open an account or read/write a private record.
All assets are local and every unsupported request is refused. --serve exposes a
small explicit scenario picker for a visible browser walkthrough. This is agent
usability QA, not a human playtest or a certification.
"""
import argparse, asyncio, hashlib, json, os, pathlib, re, sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse

ROOT=pathlib.Path(__file__).resolve().parents[2]
OUT=pathlib.Path(os.environ.get('HM_MENU_QA_OUT',str(ROOT.parent/'menu-audit-qa')))
OUT.mkdir(parents=True,exist_ok=True)
os.environ['HM_OUT']=str(OUT)
sys.path.insert(0,str(ROOT/'tools'))
import hm
from hmlib import wait_title_settled, human_play
from playwright.async_api import async_playwright

HOOK=r"""
window.__menuQA=(()=>{
  const fixtureSave={v:1,char:{v:1,name:'Rowan',realm:0,cls:'warrior',level:12,xp:0,rp:150,fresh:false}};
  const resetNative=()=>{
    Object.assign(NATIVE_PLAYER,{status:null,profile:null,state:'idle',message:'',busy:false,busyMessage:'',switching:false,
      provisional:null,promoted:false,recoveryOpen:false,conflict:null,claimConfirmationPending:false,expiredAdventure:false,authRefusal:null});
    Object.assign(SAVE,{native:false,readConfirmed:true,loaded:null,pending:null,loading:null});
    NETWS.acct=null;NETWS.token=null;
    for(const box of document.querySelectorAll('.native-player'))box.remove();
  };
  function title(kind){
    GAME.started=false;UI.modal=null;$('hud').hidden=true;resetNative();
    const bound=!['new','expired'].includes(kind),locked=kind==='locked',pending=kind==='pending';
    const pstate={hasRecord:bound,keyPresent:!locked,pending:false};
    NATIVE_PLAYER.profile=bound?{status:()=>pstate}:null;
    NATIVE_PLAYER.status={enabled:true,bound,verified:bound&&!locked,provisional:kind==='expired',
      provisionalPlay:{enabled:kind==='new'},binding:bound?{subjectDid:'did:example:menu-qa',podUrl:'https://pod.invalid/menu-qa/'}:null};
    NATIVE_PLAYER.state=kind==='expired'?'guest_expired':locked?'key_required':pending?'pod_pending':bound?'saved':'idle';
    if(kind==='expired')NATIVE_PLAYER.expiredAdventure=true;
    SAVE.native=true;SAVE.readConfirmed=bound&&!locked&&!pending;SAVE.loaded=SAVE.readConfirmed?structuredClone(fixtureSave):null;
    SAVE.loading={settled:true};NETWS.acct=bound?{id:'menu-qa-player'}:null;
    setupTitle(bound&&!locked&&!pending?structuredClone(fixtureSave):null);
    return kind;
  }
  async function play(){
    resetNative();setupTitle(null);await __hm.start({realm:0,cls:'warrior',level:12,name:'Offline menu QA'});
    if(UI.modal==='prologue')closePrologue();UI.modal=null;
    await activityModules();activityEnsure();
    return {started:GAME.started,privateSave:SAVE.native};
  }
  function close(){
    if(UI.modal==='menu')closeMenu();else if(UI.modal==='kit')closeKit();else if(UI.modal==='map')toggleMap(false);
    else if(UI.modal==='mobile')mobileTray(false);else if(UI.modal==='net')netSheetToggle(false);else if(UI.modal==='dialog')closeDialog();
  }
  function open(destination){
    close();
    if(destination==='inventory')openKit('kit');else if(destination==='map')toggleMap(true);
    else if(destination==='skills')mobileTray(true,true,'character');else if(destination==='herald')openHerald();else openMenu(destination);
  }
  function progress(kind='empty'){
    open('progress');
    Object.assign(MARCH_CONSULTING,{busy:kind==='busy',enabled:false,note:kind==='busy'?'Offline fixture: a guidance request is busy.':''});
    MARCH_COACH_DELIVERY.pending=kind==='pending'?{id:'urn:hallowmarch:consultation:00000000-0000-4000-8000-000000000000',at:new Date().toISOString(),stage:'intent'}:null;
    marchConsultingRender();
    return kind;
  }
  function active(){const e=document.activeElement;return e?{id:e.id,tag:e.tagName,label:e.getAttribute('aria-label')||e.textContent.trim().slice(0,90),visible:!!e.getClientRects().length}:null;}
  function rendered(e){
    if(!e||e.closest('[hidden],[inert]')||!e.getClientRects().length)return false;
    const r=e.getBoundingClientRect(),s=getComputedStyle(e);
    if(s.visibility==='hidden'||s.display==='none'||s.opacity==='0'||r.width<=0||r.height<=0)return false;
    for(let p=e.parentElement;p;p=p.parentElement)if(p.matches('details:not([open])')&&!p.querySelector(':scope > summary')?.contains(e))return false;
    return true;
  }
  function visible(e){
    if(!rendered(e))return false;const r=e.getBoundingClientRect();
    let l=Math.max(0,r.left),t=Math.max(0,r.top),right=Math.min(innerWidth,r.right),bottom=Math.min(innerHeight,r.bottom);
    for(let p=e.parentElement;p;p=p.parentElement){const st=getComputedStyle(p);if(/hidden|auto|scroll|clip/.test(st.overflowX+' '+st.overflowY)){
      const b=p.getBoundingClientRect();l=Math.max(l,b.left);right=Math.min(right,b.right);t=Math.max(t,b.top);bottom=Math.min(bottom,b.bottom);}}
    return right>l+1&&bottom>t+1;
  }
  function inspect(){
    const modal=UI.modal,root=modal==='menu'?$('menu'):modal==='kit'?$('kit'):modal==='map'?$('mapov'):modal==='mobile'?$('mobile-tray'):modal==='net'?$('netsheet'):modal==='dialog'?$('dialog'):modal==='death'?$('death'):!GAME.started?$('title'):$('hud');
    const elements=[...(root?.querySelectorAll('button,input,select,summary,a[href]')||[])];
    const buttons=elements.filter(visible).map(e=>{const r=e.getBoundingClientRect();return{id:e.id,tag:e.tagName,role:e.getAttribute('role'),label:e.getAttribute('aria-label')||e.textContent.trim().replace(/\s+/g,' ').slice(0,110),
      primary:e.classList.contains('primary'),disabled:e.disabled||false,x:r.x,y:r.y,w:r.width,h:r.height,checked:e.getAttribute('aria-checked'),pressed:e.getAttribute('aria-pressed')};});
    const overflows=[...(root?.querySelectorAll('*')||[])].filter(e=>e.namespaceURI==='http://www.w3.org/1999/xhtml'&&visible(e)&&e.scrollWidth>e.clientWidth+3&&getComputedStyle(e).overflowX==='visible')
      .map(e=>({id:e.id,tag:e.tagName,cls:e.className,text:e.textContent.trim().replace(/\s+/g,' ').slice(0,80),width:e.clientWidth,scroll:e.scrollWidth})).slice(0,25);
    const rect=root?.getBoundingClientRect();
    return {modal,tab:UI.menuTab,started:GAME.started,viewport:{w:innerWidth,h:innerHeight},focus:active(),focusInside:!!root?.contains(document.activeElement),
      creatorVisible:!$('character-create-fields').hidden&&!!$('character-create-fields').getClientRects().length,
      chronicle:{section:LORE.chronSec,selected:document.querySelector('.chron-secs [aria-current="true"]')?.dataset.sec||null},
      buttons,primary:buttons.filter(b=>b.primary&&!b.disabled).map(b=>b.label),tinyTargets:buttons.filter(b=>b.w<40||b.h<40),overflows,
      headings:[...(root?.querySelectorAll('h1,h2,h3,h4')||[])].filter(visible).map(e=>e.textContent.trim()),
      roots:[...document.querySelectorAll('.overlay')].filter(e=>!e.hidden&&e.getClientRects().length).map(e=>e.id),
      bounds:rect?{x:rect.x,y:rect.y,w:rect.width,h:rect.height}:null,
      text:root?.innerText.replace(/\n{3,}/g,'\n\n').slice(0,7000),confirmNew:!!UI.confirmNew,player:GAME.player?.name||null,playerId:GAME.player?.id||null,
      activityRecording:window.__hm.activityDashboard?.status||null,errors:HM_ERRORS.slice()};
  }
  function focusEdge(which){
    const root=UI.modal==='menu'?$('menu'):UI.modal==='kit'?$('kit'):UI.modal==='map'?$('mapov'):UI.modal==='mobile'?$('mobile-tray'):UI.modal==='dialog'?$('dialog'):null;
    const targets=[...(root?.querySelectorAll('button,input,select,textarea,summary,a[href],[tabindex]')||[])]
      .filter(e=>!e.disabled&&e.tabIndex>=0&&!e.closest('[hidden],[inert]')&&e.getClientRects().length);
    (which==='last'?targets.at(-1):targets[0])?.focus();return targets.length;
  }
  function replacementTransitions(){
    const held={pending:SAVE.pending,loading:SAVE.loading,ref:SAVE.ref,player:GAME.player,newCharacter},button=$('menu-new-confirm'),focus=document.activeElement;
    let replacements=0;const states=[];newCharacter=()=>{replacements++;};
    const sample=name=>states.push({name,disabled:button.disabled,focusStable:document.activeElement===focus,status:$('menu-new-status')?.textContent||''});
    try{
      SAVE.pending={offlineFixture:true};updateHUD(0);sample('pending');
      SAVE.pending=null;SAVE.loading={settled:true};updateHUD(0);sample('settled');
      SAVE.loading={settled:false};updateHUD(0);sample('loading');
      SAVE.loading={settled:true};updateHUD(0);sample('settled-again');
      button.focus();SAVE.pending={offlineFixture:true};updateHUD(0);
      const disabledFocusReturned=button.disabled&&document.activeElement===$('menu-new-cancel');
      SAVE.pending=null;updateHUD(0);
      GAME.player={...held.player};button.click();
      const refusedPlayer=replacements===0&&UI.modal==='menu'&&button.disabled;
      GAME.player=held.player;updateHUD(0);
      SAVE.ref={offlineFixture:true};button.click();
      const refusedRef=replacements===0&&GAME.player===held.player&&UI.modal==='menu'&&button.disabled&&!!UI.confirmNew;
      const refusalKeepsSafeFocus=document.activeElement===$('menu-new-cancel');
      return {states,replacements,refusedPlayer,refusedRef,disabledFocusReturned,refusalKeepsSafeFocus};
    }finally{SAVE.pending=held.pending;SAVE.loading=held.loading;SAVE.ref=held.ref;GAME.player=held.player;newCharacter=held.newCharacter;}
  }
  function scrollState(){
    const body=$('menu-body'),leaves=[...body.querySelectorAll('p,li,summary,button,h2,h3')].filter(rendered),last=leaves.at(-1);
    return {top:body.scrollTop,height:body.clientHeight,total:body.scrollHeight,focus:active(),
      endLabel:last?.textContent.trim().slice(0,100)||'',endVisible:visible(last)};
  }
  function picker(){
    const controls=document.createElement('details');controls.id='offline-menu-qa';
    controls.style.cssText='position:fixed;right:4px;top:4px;z-index:999999;background:#111;color:white;padding:8px;border:1px solid #aaa;max-width:230px;font:13px system-ui';
    controls.innerHTML='<summary>Offline QA scenarios</summary><p>Synthetic states. External services and writes are blocked.</p>';
    for(const [name,run]of [['New player',()=>title('new')],['Returning character',()=>title('returning')],['Recovery required',()=>title('locked')],['Save pending',()=>title('pending')],['Expired temporary session',()=>title('expired')],['Play local character',play],['Progress: empty',()=>progress('empty')],['Progress: busy',()=>progress('busy')],['Progress: pending',()=>progress('pending')]]){
      const b=document.createElement('button');b.textContent=name;b.type='button';b.style.cssText='display:block;margin:5px 0;min-height:36px;width:100%';
      b.onclick=async()=>{try{await run();controls.open=false;}catch(error){alert(error.message);}};controls.append(b);
    }
    document.body.append(controls);return true;
  }
  function effectsProbe(){
    const P=GAME.player, before={level:P.level,xp:GAME.prog.xp};
    CAM.shake=1;cameraShake(1,P.x,P.z);
    composite.uniforms.uFlash.value.w=1;flashScreen([1,1,1],1);
    return {reduced:REDUCE_MOTION,mode:MOTION_MODE,shake:CAM.shake,flash:composite.uniforms.uFlash.value.w,
      stored:localStorage.getItem(MOTION_PREF_KEY),unchanged:P.level===before.level&&GAME.prog.xp===before.xp};
  }
  return {title,play,open,close,progress,inspect,picker,active,focusEdge,replacementTransitions,scrollState,effectsProbe,
    chronicleKeys:()=>CHRON_SECTIONS.map(([key])=>key).filter(key=>key!=='coach')};
})();
"""

def document(html_path,picker=False):
    source=pathlib.Path(html_path).read_text(encoding='utf-8')
    cut=source.rfind('</script>')
    if cut<0:raise RuntimeError('No module script boundary')
    source=source[:cut]+'\n'+HOOK+'\n'+source[cut:]
    source=source.replace(hm.THREE_URL,'/qa/three.mjs')
    source=re.sub(r'<link[^>]+href="https://fonts\.[^>]+>','',source)
    if picker:
        source+='''<script>const qaTimer=setInterval(()=>{if(window.__hm?.ready&&window.__menuQA){clearInterval(qaTimer);__menuQA.picker();}},100);</script>'''
    return hm.SKELETON.replace('%s',source)


def asset(path,html):
    if path=='/':return 'text/html',html.encode()
    if path=='/qa/three.mjs':return 'application/javascript',hm.THREE_LOCAL.read_bytes()
    prefix='/gaming/identity/assets/'
    if path.startswith(prefix):
        name=path[len(prefix):]
        if '/' not in name and re.fullmatch(r'[A-Za-z0-9_.-]+\.mjs',name):
            target=ROOT/'client'/'native-pod'/name
            if target.is_file():return 'application/javascript',target.read_bytes()
    return None


def serve(args):
    html=document(args.html,True)
    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            value=asset(urlparse(self.path).path,html)
            if not value:self.send_error(404,'Offline fixture: unsupported request');return
            mime,body=value;self.send_response(200);self.send_header('Content-Type',mime)
            self.send_header('Cache-Control','no-store')
            self.send_header('Content-Security-Policy',"default-src 'self' data: blob:; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; connect-src 'self'; font-src 'self' data:; img-src 'self' data: blob:")
            self.end_headers();self.wfile.write(body)
        def do_POST(self):self.send_error(405,'Offline fixture: all writes blocked')
        def log_message(self,*unused):pass
    server=ThreadingHTTPServer(('127.0.0.1',args.port),Handler)
    print(f'Offline menu QA: http://127.0.0.1:{args.port}/',flush=True)
    server.serve_forever()


async def audit(args):
    html=document(args.html)
    report={'kind':'agent-usability-qa','htmlSha256':hashlib.sha256(pathlib.Path(args.html).read_bytes()).hexdigest(),
      'states':[],'checks':[],'requests':[],'errors':[]}
    def save():(OUT/'menu-audit.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
    async with async_playwright() as p:
        browser=await p.chromium.launch(args=['--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist'])
        for touch in [False,True]:
            context=await browser.new_context(viewport={'width':390 if touch else 1280,'height':780 if touch else 800},has_touch=touch,is_mobile=touch)
            page=await context.new_page();page.on('pageerror',lambda e:report['errors'].append(str(e)))
            async def route(request):
                url=urlparse(request.request.url)
                value=asset(url.path,html) if url.netloc=='menu.test' and request.request.method=='GET' else None
                if value:
                    mime,body=value;await request.fulfill(content_type=mime,body=body)
                elif url.netloc in ['fonts.googleapis.com','fonts.gstatic.com']:await request.fulfill(content_type='text/css',body='')
                else:
                    report['requests'].append({'method':request.request.method,'url':request.request.url});await request.abort()
            await page.route('**/*',route)
            await page.goto('https://menu.test/',wait_until='commit')
            await page.wait_for_function('window.__hm?.ready&&window.__menuQA',timeout=240000,polling=500)
            await page.evaluate("__hm.fn.setQuality('low')")
            await wait_title_settled(page)
            label='phone' if touch else 'desktop'
            async def capture(name):
                state=await page.evaluate('__menuQA.inspect()');state['scenario']=label+'-'+name
                report['checks'].append({'task':state['scenario']+'-no-horizontal-content-overflow','passed':not state['overflows'],'overflows':state['overflows']})
                report['states'].append(state);save();print(json.dumps({'scenario':state['scenario'],'primary':state['primary'],'focusInside':state['focusInside'],'overflow':len(state['overflows'])}),flush=True)
                if args.screenshots:await page.screenshot(path=str(OUT/(state['scenario']+'.png')),timeout=300000)
                return state
            for kind in ['new','returning','locked','pending','expired']:
                await page.evaluate('(kind)=>__menuQA.title(kind)',kind)
                state=await capture('title-'+kind)
                report['checks'].append({'task':label+'-title-'+kind+'-single-primary','passed':len(state['primary'])==1,'primary':state['primary']})
                report['checks'].append({'task':label+'-title-'+kind+'-creator-context','passed':state['creatorVisible']==(kind=='new'),'creatorVisible':state['creatorVisible']})
            await page.evaluate("__menuQA.title('new')")
            for group,key in [('#realm-pick','data-realm'),('#class-pick','data-cls')]:
                values=await page.locator(group+' [role=radio]').evaluate_all('(els)=>els.map(e=>({value:e.getAttribute("'+key+'"),checked:e.getAttribute("aria-checked")==="true"}))')
                current=next((i for i,v in enumerate(values) if v['checked']),0)
                await page.locator(group+' [aria-checked=true]').focus();await page.keyboard.press('ArrowRight')
                selected=await page.locator(group+' [aria-checked=true]').get_attribute(key)
                report['checks'].append({'task':label+'-'+group[1:]+'-arrow-selection','passed':selected==values[(current+1)%len(values)]['value'],'selected':selected})
                await page.keyboard.press('End')
                selected=await page.locator(group+' [aria-checked=true]').get_attribute(key)
                report['checks'].append({'task':label+'-'+group[1:]+'-end-selection','passed':selected==values[-1]['value'],'selected':selected})
            await page.evaluate('__menuQA.play()');await human_play(page)
            # Keep the browser's real paint scheduling. The game menu pauses
            # play itself; native scrolling must not inherit a fixture RAF.
            async def settle_panel_scroll():
                # A native Home animation can reach zero before its browser
                # transaction has finished. Observe a settled position before
                # sending the next independent key, rather than retrying it.
                await page.evaluate("document.getElementById('menu-body').__qaScroll={top:null,at:performance.now()}")
                await page.wait_for_function("""()=>{
                  const e=document.getElementById('menu-body'),s=e.__qaScroll,now=performance.now();
                  if(s.top!==e.scrollTop){s.top=e.scrollTop;s.at=now;return false;}
                  return now-s.at>=200;
                }""",timeout=5000,polling=50)
            async def panel_fixture_top():
                # The fixture's instant scroll also emits scrollend. Consume
                # that event before observing the subsequent native key.
                await page.evaluate("""()=>{
                  const e=document.getElementById('menu-body'),moves=e.scrollTop>2;
                  if(e.__qaScrollEndListener)e.removeEventListener('scrollend',e.__qaScrollEndListener);
                  if(e.__qaFixtureEndListener)e.removeEventListener('scrollend',e.__qaFixtureEndListener);
                  e.__qaFixtureEnded=!moves;
                  e.__qaFixtureEndListener=()=>{e.__qaFixtureEnded=true;};
                  if(moves)e.addEventListener('scrollend',e.__qaFixtureEndListener,{once:true});
                  e.scrollTop=0;
                }""")
                await page.wait_for_function("(()=>{const e=document.getElementById('menu-body');return e.__qaFixtureEnded&&e.scrollTop<=2})()",timeout=5000,polling=50)
                await page.evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
                await settle_panel_scroll()
            async def panel_key(key,condition,moves):
                await page.evaluate("""()=>{
                  const e=document.getElementById('menu-body');
                  if(e.__qaScrollEndListener)e.removeEventListener('scrollend',e.__qaScrollEndListener);
                  e.__qaKeyScroll={ended:false,keys:[]};
                  e.__qaScrollEndListener=()=>{e.__qaKeyScroll.ended=true;};
                  e.addEventListener('scrollend',e.__qaScrollEndListener,{once:true});
                  if(!window.__qaKeyListener){window.__qaKeyListener=true;document.addEventListener('keydown',event=>queueMicrotask(()=>{
                    const body=document.getElementById('menu-body');
                    if(body?.__qaKeyScroll)body.__qaKeyScroll.keys.push({key:event.key,target:event.target.id,
                      active:document.activeElement.id,prevented:event.defaultPrevented,top:body.scrollTop});
                  }));}
                }""")
                await page.keyboard.press(key)
                try:
                    await page.wait_for_function(condition,timeout=5000,polling=50)
                    if moves:
                        await page.wait_for_function("document.getElementById('menu-body').__qaKeyScroll.ended",timeout=5000,polling=50)
                except Exception:
                    report['checks'].append({'task':label+'-native-'+key+'-scroll-completed','passed':False,
                      'scroll':await page.evaluate('__menuQA.scrollState()'),
                      'events':await page.evaluate("document.getElementById('menu-body').__qaKeyScroll")})
                    save();raise
            for viewport in ([{'width':390,'height':780},{'width':320,'height':740},{'width':844,'height':390}] if touch else [{'width':1280,'height':800}]):
                await page.set_viewport_size(viewport);label=('phone-'+str(viewport['width'])) if touch else 'desktop'
                for tab in ['char','companion','progress','chronicle','settings','help']:
                    await page.evaluate('(tab)=>__menuQA.open(tab)',tab)
                    await page.evaluate('Promise.resolve()')
                    state=await capture('menu-'+tab)
                    report['checks'].append({'task':label+'-'+tab+'-one-quiet-return','passed':len([b for b in state['buttons'] if b['id']=='menu-close' and not b['primary']])==1 and not any(b['id']=='btn-resume' for b in state['buttons'])})
                await page.evaluate("__menuQA.open('char')")
                await page.keyboard.press('End')
                tab_focus=await page.evaluate("()=>({inside:document.querySelector('#menu-tabs').contains(document.activeElement),selected:document.activeElement.getAttribute('aria-selected')==='true'})")
                report['checks'].append({'task':label+'-menu-tab-end-focus','passed':tab_focus['inside'] and tab_focus['selected']})
                await page.evaluate("__menuQA.open('char')")
                progress_link=page.locator('#menu-body [data-lore="sec:coach"]')
                if await progress_link.count():
                    await progress_link.click();await page.evaluate('Promise.resolve()');state=await capture('character-to-progress')
                    report['checks'].append({'task':label+'-character-primary-route-focus','passed':state['tab']=='progress' and state['focusInside'] and state['focus']['id']!='menu-close','focus':state['focus']})
                path_link=page.get_by_role('button',name='Continue your path',exact=True)
                if await path_link.count():
                    await path_link.click();state=await capture('progress-to-path')
                    report['checks'].append({'task':label+'-progress-primary-route-focus','passed':state['tab']=='chronicle' and state['focusInside'] and state['focus']['id']!='menu-close','focus':state['focus']})
                await page.evaluate("__menuQA.open('settings')")
                weather=page.locator('#set-w button').last
                if await weather.count():
                    await weather.click();state=await capture('setting-changed')
                    report['checks'].append({'task':label+'-setting-retains-focus','passed':bool(state['focusInside'] and state['focus']['tag']=='BUTTON'),'focus':state['focus']})
                reduced=page.get_by_role('radio',name='Reduce effects',exact=True)
                await reduced.click();state=await capture('reduced-effects')
                effects=await page.evaluate('__menuQA.effectsProbe()')
                report['checks'].append({'task':label+'-reduced-effects-applies-and-retains-focus','passed':effects['reduced'] and effects['mode']=='reduced' and effects['stored']=='reduced' and effects['shake']==0 and effects['flash']==0 and effects['unchanged'] and state['focusInside'] and state['focus']['tag']=='BUTTON','effects':effects})
                await page.keyboard.press('ArrowLeft')
                checked=await page.get_by_role('radio',name='Use device setting',exact=True).get_attribute('aria-checked')
                report['checks'].append({'task':label+'-effects-keyboard-restores-device-setting','passed':checked=='true'})
                await page.keyboard.press('Escape');await capture('menu-escaped')
                for destination in ['inventory','map','herald']:
                    trigger=page.locator(('#mobile-inventory' if touch else '#btn-kit') if destination=='inventory' else ('#mobile-map' if touch else '#btn-map'))
                    invoker=None
                    if destination!='herald' and await trigger.count() and await trigger.is_visible():
                        invoker=await trigger.get_attribute('id');await trigger.click()
                    else:await page.evaluate('(name)=>__menuQA.open(name)',destination)
                    state=await capture(destination)
                    report['checks'].append({'task':label+'-'+destination+'-focus-entry','passed':state['focusInside'],'focus':state['focus']})
                    await page.evaluate("__menuQA.focusEdge('last')")
                    await page.keyboard.press('Tab');wrapped=await capture(destination+'-tab')
                    report['checks'].append({'task':label+'-'+destination+'-focus-wrap','passed':wrapped['focusInside'],'focus':wrapped['focus']})
                    await page.keyboard.press('Escape');closed=await capture(destination+'-escaped')
                    if invoker:report['checks'].append({'task':label+'-'+destination+'-focus-return','passed':closed['focus']['id']==invoker,'focus':closed['focus']})
                for kind in ['empty','busy','pending']:
                    await page.evaluate('(kind)=>__menuQA.progress(kind)',kind)
                    await page.evaluate('Promise.resolve()');state=await capture('progress-'+kind)
                    path=[b for b in state['buttons'] if b['label']=='Continue your path']
                    report['checks'].append({'task':label+'-progress-'+kind+'-local-path-available','passed':bool(path and not path[0]['disabled'] and path[0]['primary']),'path':path})
                await page.evaluate("__menuQA.progress('empty')")
                history=page.locator('#march-activity-open')
                if await history.count():
                    await history.click();await page.wait_for_function("document.querySelector('#march-activity-dashboard')?.textContent?.length>50",timeout=30000,polling=100)
                    await capture('activity-history')
                    back=page.get_by_role('button',name=re.compile(r'^(Back|Return) to Progress$')).first
                    if await back.count():
                        await back.click();state=await capture('activity-history-back')
                        report['checks'].append({'task':label+'-history-back-focus','passed':state['focus']['id']=='march-activity-open','focus':state['focus']})
                await page.evaluate("__menuQA.open('char')")
                options=page.locator('.menu-options > summary')
                if await options.count():await options.click()
                new=page.locator('#btn-newchar')
                if await new.count() and await new.is_visible():
                    prior=await page.evaluate('__menuQA.inspect()')
                    await new.click();state=await capture('new-character-first-step')
                    cancel=page.locator('#menu-new-cancel')
                    report['checks'].append({'task':label+'-replacement-default-is-keep','passed':state['primary']==['Keep current character'] and state['focus']['id']=='menu-new-cancel' and state['playerId']==prior['playerId']})
                    replace=[b for b in state['buttons'] if b['label']=='Replace character']
                    report['checks'].append({'task':label+'-settled-character-can-open-replacement','passed':bool(replace and not replace[0]['disabled'])})
                    if await cancel.count():
                        await cancel.click();state=await capture('new-character-cancelled')
                        report['checks'].append({'task':label+'-replacement-cancel-preserves-character','passed':not state['confirmNew'] and state['playerId']==prior['playerId'] and state['focus']['id']=='btn-newchar'})
                        await new.click()
                        guard=await page.evaluate('__menuQA.replacementTransitions()')
                        report['checks'].append({'task':label+'-replacement-pending-transitions','passed':[s['disabled'] for s in guard['states']]==[True,False,True,False] and all(s['focusStable'] for s in guard['states']),'states':guard['states']})
                        report['checks'].append({'task':label+'-replacement-player-and-ref-guards','passed':guard['refusedPlayer'] and guard['refusedRef'] and guard['replacements']==0 and guard['refusalKeepsSafeFocus'],'guard':guard})
                        report['checks'].append({'task':label+'-replacement-disabled-control-focus','passed':guard['disabledFocusReturned']})
                    await page.keyboard.press('Escape')
                if not touch or viewport['width']==320:
                    await page.evaluate("__menuQA.open('chronicle')")
                    report['checks'].append({'task':label+'-progress-has-one-menu-destination','passed':await page.locator('#menu-tab-progress').is_visible() and await page.locator('.chron-nav [data-sec="coach"]').count()==0})
                    groups=await page.locator('.chron-grps [data-grp]').evaluate_all('(els)=>els.map(e=>e.dataset.grp)')
                    expected=set(await page.evaluate('__menuQA.chronicleKeys()'));seen=set()
                    for group in groups:
                        await page.evaluate("__menuQA.open('chronicle')")
                        await page.locator('.chron-grps [data-grp="'+group+'"]').click()
                        sections=await page.locator('.chron-secs [data-sec]:not([hidden])').evaluate_all('(els)=>els.map(e=>e.dataset.sec)')
                        for section in sections:
                            await page.evaluate("__menuQA.open('chronicle')")
                            await page.locator('.chron-grps [data-grp="'+group+'"]').click()
                            await page.locator('.chron-secs [data-sec="'+section+'"]').click()
                            await page.evaluate('Promise.resolve()');state=await capture('chronicle-'+section)
                            correct=state['tab']=='progress' if section=='coach' else state['tab']=='chronicle' and state['chronicle']['selected']==section
                            report['checks'].append({'task':label+'-chronicle-'+section+'-route-and-focus','passed':correct and state['focusInside'] and state['focus']['id']!='menu-close','focus':state['focus']})
                            seen.add(section)
                    report['checks'].append({'task':label+'-every-chronicle-subsection-reachable','passed':seen==expected,'missing':sorted(expected-seen)})
                for long_page in ['help','char']:
                    # Navigate as a player does. Closing/reopening the same
                    # scroll node through the synthetic API after native Home
                    # can retain Chromium's previous keyboard scroll target.
                    if (await page.evaluate('__menuQA.inspect()'))['modal']!='menu':
                        await page.keyboard.press('Escape')
                    await page.locator('#menu-tab-'+long_page).click()
                    await page.keyboard.press('Tab')
                    entered=await page.evaluate('__menuQA.active()')
                    report['checks'].append({'task':label+'-'+long_page+'-tab-enters-reading-panel','passed':entered['id']=='menu-body','focus':entered})
                    if long_page=='help':
                        for _ in range(60):
                            closed=page.locator('#menu-body details:not([open]) > summary')
                            target=None
                            for index in range(await closed.count()):
                                if await closed.nth(index).is_visible():target=closed.nth(index);break
                            if target is None:break
                            await target.click()
                    await page.locator('#menu-body').focus()
                    initial=await page.evaluate('__menuQA.scrollState()')
                    # Establish the fixture start separately. Home is tested
                    # below after End, so neither key starts during another
                    # native keyboard scrolling transaction.
                    await panel_fixture_top()
                    scrollable=initial['total']>initial['height']+5
                    await panel_key('PageDown',"document.getElementById('menu-body').scrollTop>0" if scrollable else 'true',scrollable)
                    paged=await page.evaluate('__menuQA.scrollState()')
                    report['checks'].append({'task':label+'-'+long_page+'-keyboard-page-scroll','passed':initial['total']<=initial['height']+5 or paged['top']>0,'scroll':paged})
                    # End has its own established top-of-panel fixture so it
                    # remains observable even if PageDown reached the bottom.
                    await panel_fixture_top()
                    await panel_key('End',"(()=>{const e=document.getElementById('menu-body');return e.scrollTop+e.clientHeight>=e.scrollHeight-2})()",scrollable)
                    end=await page.evaluate('__menuQA.scrollState()');await capture(long_page+'-end-reachable')
                    report['checks'].append({'task':label+'-'+long_page+'-end-reachable','passed':end['endVisible'] and end['top']+end['height']>=end['total']-2,'scroll':end})
                    await panel_key('Home',"document.getElementById('menu-body').scrollTop<=2",scrollable)
                    home=await page.evaluate('__menuQA.scrollState()')
                    report['checks'].append({'task':label+'-'+long_page+'-keyboard-home','passed':home['top']<=2 and home['focus']['id']=='menu-body','scroll':home})
                    if touch and viewport['width']==320 and long_page=='help':
                        rect=await page.locator('#menu-body').bounding_box();x=rect['x']+rect['width']-20;y=rect['y']+rect['height']*.8
                        cdp=await page.context.new_cdp_session(page)
                        await cdp.send('Input.dispatchTouchEvent',{'type':'touchStart','touchPoints':[{'x':x,'y':y,'id':1}]})
                        for step in range(1,7):await cdp.send('Input.dispatchTouchEvent',{'type':'touchMove','touchPoints':[{'x':x,'y':y-20*step,'id':1}]})
                        await cdp.send('Input.dispatchTouchEvent',{'type':'touchEnd','touchPoints':[]})
                        await page.evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
                        await page.wait_for_function("document.getElementById('menu-body').scrollTop>0",timeout=5000,polling=50)
                        touch_state=await page.evaluate('__menuQA.scrollState()')
                        report['checks'].append({'task':label+'-help-touch-scroll','passed':touch_state['top']>0,'scroll':touch_state})
                    if long_page=='char':await page.keyboard.press('Escape')
                if touch:
                    await page.evaluate("__menuQA.open('skills')");await capture('skills')
                    detail=page.locator('#mobile-tray-abilities summary').first
                    if await detail.count():await detail.click();await capture('skill-description')
                    await page.keyboard.press('Escape')
            await context.close()
        await browser.close()
    save()
    print(json.dumps({'report':str(OUT/'menu-audit.json'),'states':len(report['states']),'checks':len(report['checks']),
      'failed':[check for check in report['checks'] if not check['passed']],'errors':report['errors']}),flush=True)
    assert not report['errors'],report['errors']
    if args.strict:assert all(check['passed'] for check in report['checks']),report['checks']


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--html',default=str(hm.HTML))
    parser.add_argument('--screenshots',action='store_true')
    parser.add_argument('--strict',action='store_true')
    parser.add_argument('--serve',action='store_true')
    parser.add_argument('--port',type=int,default=8766)
    options=parser.parse_args()
    if options.serve:serve(options)
    else:asyncio.run(audit(options))
