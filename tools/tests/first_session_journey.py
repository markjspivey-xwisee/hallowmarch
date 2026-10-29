"""Bounded agent first-session QA on one frozen local build, entirely headless.

Entry, prologue, walking, herald, map, combat, inventory and menu edits use native
browser input. One existing bounty creature's position/home are arranged for a
short combat fixture, then restored; health, levels and earned progress are never
assigned. No account, hosted world, learning delivery, or foreground UI is used.
This is an agent journey, not an unassisted human playtest or a GPU benchmark.
"""
import argparse
import asyncio
import hashlib
import json
import pathlib
import re
import sys
import time
from urllib.parse import urlparse

ROOT = pathlib.Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'tools'))
from hmlib import wait_title_settled
from native_journey_browser import NativeJourneyBrowser
from playwright.async_api import async_playwright

THREE_URL = 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.min.js'

SNAPSHOT = """() => {
 const H=window.__hm,S=window.__hmStartup,P=H?.GAME.player,G=H?.GAME.prog;
 return {phase:S?.phase,stopped:!!S?.stopped,titleCompleted:S?.titleCompleted,titleSubmitted:S?.titleSubmitted,
   titleFence:!!S?.titleFinal?.fenceComplete,ready:!!H?.ready,started:!!H?.GAME.started,modal:H?.UI.modal,
   documentHidden:document.hidden,focused:document.hasFocus(),backend:H?.SAVE.backend,native:!!H?.SAVE.native,
   host:H?.net?.NETWS.host||'',player:P?{id:P.id,name:P.name,alive:P.alive,x:P.x,z:P.z,hp:P.hp,level:P.level}:null,
   progress:G?{level:G.level,xp:G.xp,rp:G.rp,kills:G.kills,deaths:G.deaths,bounty:G.bounty,lore:G.lore}:null,
   gold:H?.INV.gold,potions:H?.INV.potions,errors:H?.errors.slice(0,10)||[]};
}"""
EARNED = """() => {const H=__hm,G=H.GAME.prog;return {
 level:G.level,xp:G.xp,rp:G.rp,kills:G.kills,realmKills:G.realmKills,deaths:G.deaths,
 bounty:G.bounty?{type:G.bounty.type,camp:G.bounty.camp,have:G.bounty.have,need:G.bounty.need,done:!!G.bounty.done}:null,
 gold:H.INV.gold,potions:H.INV.potions,done:G.lore.done.slice(),
 bag:H.INV.bag.map(item=>item.id),eq:Object.fromEntries(Object.entries(H.INV.eq).filter(([,v])=>v).map(([k,v])=>[k,v.id]))};}"""

# A touch on the movement side starts the stick and never reaches pickAt.
# Keep this readonly predicate aligned with the actual-source CPU contract test.
CANVAS_POINT_RULE = """const canSelect=p=>!!p&&p.x>0&&p.x<innerWidth&&p.y>0&&p.y<innerHeight
  &&!(touch&&p.y>innerHeight*.35&&(H.mobile.prefs.hand==='left'?p.x>innerWidth*.58:p.x<innerWidth*.42))
  &&document.elementFromPoint(p.x,p.y)?.id==='scene';"""
ARRANGE_QUARRY = """({touch})=>{
  const H=__hm,P=H.GAME.player,b=H.GAME.prog.bounty,c=H.CAMPS[b.camp];
  const e=[...c.members].map(H.fn.getEnt).find(e=>e?.alive&&!e.removed&&e.mobType===b.type&&e.level<=P.level+1);
  if(!e)throw Error('No actual suitable living bounty creature for the combat fixture');
""" + CANVAS_POINT_RULE + """
  const reach=P.meleeRange+e.radius*(e.scale||1)+.3;
  if(H.ABILITIES.slash?.range!=='melee'||!Number.isFinite(reach)||typeof H.look5?.look5InColl!=='function')
    throw Error('Actual Slash range and solid-placement query are required for the combat fixture');
  const search={reach,maximumDistance:Math.min(2.8,reach-.35),candidates:[]};
  let point,inputPoint;
  outer:for(const distance of [2,2.4,1.7,2.8,1.4])for(const a of [0,.4,-.4,.8,-.8,1.2,-1.2,1.6,-1.6,2,-2,2.4,-2.4,Math.PI]){
    const yaw=H.CAM.yaw+a,x=P.x+Math.sin(yaw)*distance,z=P.z+Math.cos(yaw)*distance;
    const row={angle:a,distance,x,z,reasons:[]};search.candidates.push(row);
    if(distance>search.maximumDistance){row.reasons.push('outside-safe-Slash-reach');continue;}
    if(H.ENT.some(other=>other!==P&&other!==e&&other.alive&&!other.removed&&Math.hypot(other.x-x,other.z-z)<(other.radius||.5)+(e.radius||.5)+.35))row.reasons.push('occupied');
    if(!H.fn.isWalkable(x,z))row.reasons.push('non-walkable');
    if(H.look5.look5InColl(x,z,e.radius*(e.scale||1)))row.reasons.push('solid');
    const y=H.fn.heightAt(x,z);row.y=y;
    if(!Number.isFinite(y)||Math.abs(y-P.y)>1.5)row.reasons.push('height');
    const screen=H.fn.screenOf(x,y+(e.kind==='humanoid'?1:.6)*(e.scale||1),z);row.screen=screen;
    if(!screen)row.reasons.push('not-projected');
    else if(!(screen.x>0&&screen.x<innerWidth&&screen.y>0&&screen.y<innerHeight))row.reasons.push('off-viewport');
    else{
      if(touch&&screen.y>innerHeight*.35&&(H.mobile.prefs.hand==='left'?screen.x>innerWidth*.58:screen.x<innerWidth*.42))row.reasons.push('movement-zone');
      const hit=document.elementFromPoint(screen.x,screen.y);if(hit?.id!=='scene')row.reasons.push('HUD:'+(hit?.id||hit?.tagName||'none'));
    }
    if(!row.reasons.length&&canSelect(screen)){row.accepted=true;point={x,y,z};inputPoint=screen;break outer;}
  }
  if(!point)return{available:false,search};
  const original={x:e.x,y:e.y,z:e.z,home:e.home?{...e.home}:null};
  e.x=e.prevX=point.x;e.z=e.prevZ=point.z;e.y=point.y;
  if(e.home)e.home={...e.home,x:point.x,z:point.z};
  return {available:true,id:e.id,name:e.name,level:e.level,hp:e.hp,maxHp:e.maxHp,original,inputPoint,search,arranged:{x:e.x,y:e.y,z:e.z,home:e.home?{...e.home}:null}};
}"""
SELECTABLE_CANVAS_POINT = """({point,touch})=>{const H=__hm;""" + CANVAS_POINT_RULE + """return canSelect(point);}"""
EMPTY_CANVAS_POINT = """({touch})=>{const H=__hm;""" + CANVAS_POINT_RULE + """
  // A geometric hit-test alone permits taps directly beside a growing target
  // panel. Keep a finger-sized margin from every rendered HUD panel/control.
  const clearance=touch?32:0;
  const hud=Array.from(document.querySelectorAll('#hud .panel,#hud button,#hud [role="button"],#hud input,#hud select,#hud summary,#hud a[href]'))
    .filter(node=>{const r=node.getBoundingClientRect(),s=getComputedStyle(node);return !node.hidden
      &&!node.closest('[hidden],[inert]')&&r.width>0&&r.height>0&&s.display!=='none'&&s.visibility!=='hidden'&&s.visibility!=='collapse';})
    .map(node=>node.getBoundingClientRect());
  const interior=p=>hud.every(r=>p.x<r.left-clearance||p.x>r.right+clearance||p.y<r.top-clearance||p.y>r.bottom+clearance);
  // Exclude every projected body in pickAt's envelope, even an occluded one.
  // This is conservative: no visibility guess can make an occupied point empty.
  const occupied=(sx,sy)=>H.ENT.some(e=>{
    if(e.removed||(e.role==='critter'&&!e.game)||e.flying||!e.alive)return false;
    const d3=Math.hypot(e.x-H.camera.position.x,e.z-H.camera.position.z);if(d3>90)return false;
    const h=e.kind==='door'?2.5:e.kind==='dragon'?3:(e.kind==='humanoid'?1+(e.mount ? .8 : 0):.6)*(e.scale||1);
    const s=H.fn.screenOf(e.x,e.y+h,e.z);if(!s)return false;
    const rad=Math.max(18,Math.min(e.kind==='dragon'?260:120,(e.kind==='door'?900:e.kind==='dragon'?1400:260)/Math.max(d3,1)))*(e.scale||1);
    return Math.hypot(s.x-sx,(s.y-sy)*.8)<rad;
  });
  for(const y of [.2,.28,.4,.55,.7,.82])for(const x of [.5,.58,.68,.8,.9,.42,.32,.2,.1]){
    const p={x:innerWidth*x,y:innerHeight*y};if(canSelect(p)&&interior(p)&&!occupied(p.x,p.y))return p;}
  return null;
}"""

# Diagnostic around one native blank-canvas tap. Observe both sides of the game
# handlers without changing them, renewing play, or creating any synthetic input.
INSTALL_POINTER_RECEIPTS = """point=>{
  if(window.__journeyPointerReceipt)throw Error('Pointer receipt already active');
  const types=['pointerdown','pointermove','pointerup','pointercancel','gotpointercapture','lostpointercapture'];
  const describe=node=>node===window?'window':node===document?'document':{
    tag:String(node?.tagName||''),id:String(node?.id||''),className:typeof node?.className==='string'?node.className.slice(0,120):''};
  const stateAt=(x,y,pointerId)=>{
    const H=window.__hm,I=H?.INPUT,p=I?.pointers?.get(pointerId),canvas=document.getElementById('scene');
    const overlays=Array.from(document.querySelectorAll('#pf,#tf,#lore-path,#banners > *')).slice(0,12).map(node=>{
      const r=node.getBoundingClientRect(),s=getComputedStyle(node);return{element:describe(node),
        text:(node.textContent||'').trim().slice(0,100),hidden:!!node.hidden,display:s.display,visibility:s.visibility,
        opacity:s.opacity,pointerEvents:s.pointerEvents,rect:{left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:r.width,height:r.height}};});
    return{at:performance.now(),target:H?.GAME.player?.target??null,modal:H?.UI.modal??null,
      playerAlive:H?.GAME.player?.alive,hand:H?.mobile?.prefs?.hand,viewport:[innerWidth,innerHeight],
      focused:document.hasFocus(),hidden:document.hidden,active:describe(document.activeElement),
      hit:describe(document.elementFromPoint(x,y)),hasCapture:pointerId==null?null:!!canvas?.hasPointerCapture?.(pointerId),
      pointer:p?{x:p.x,y:p.y,sx:p.sx,sy:p.sy,moved:p.moved,t:p.t,type:p.type,ageMs:performance.now()-p.t}:null,
      pointerCount:I?.pointers?.size??0,joy:I?.joy?{...I.joy}:null,overlays};
  };
  const state={planned:{x:point.x,y:point.y},startedAt:performance.now(),stoppedAt:null,rows:[],omitted:0,
    kind:'native event/DOM/input-state receipts; passive and read-only; no action retry'};
  state.before=stateAt(point.x,point.y,null);
  const receive=phase=>event=>{
    if(state.rows.length>=32){state.omitted++;return;}
    const x=event.clientX,y=event.clientY;
    state.rows.push({phase,type:event.type,isTrusted:event.isTrusted,eventPhase:event.eventPhase,
      pointerId:event.pointerId,pointerType:event.pointerType,timeStamp:event.timeStamp,x,y,
      width:event.width,height:event.height,pressure:event.pressure,buttons:event.buttons,
      defaultPrevented:event.defaultPrevented,target:describe(event.target),
      path:event.composedPath().slice(0,10).map(describe),state:stateAt(x,y,event.pointerId)});
  };
  const capture=receive('capture'),bubble=receive('bubble');
  for(const type of types){window.addEventListener(type,capture,{capture:true,passive:true});window.addEventListener(type,bubble,{passive:true});}
  window.__journeyPointerReceipt={stop(){
    for(const type of types){window.removeEventListener(type,capture,true);window.removeEventListener(type,bubble,false);}
    state.stoppedAt=performance.now();state.after=stateAt(point.x,point.y,null);
    delete window.__journeyPointerReceipt;
    return JSON.parse(JSON.stringify(state));
  }};
  return JSON.parse(JSON.stringify(state.before));
}"""
STOP_POINTER_RECEIPTS = "() => window.__journeyPointerReceipt?.stop() ?? null"


def browser_local_extension_resource(method, resource):
    try:
        url = urlparse(resource)
    except ValueError:
        return False
    return bool(method == 'GET' and url.scheme == 'chrome-extension'
                and re.fullmatch(r'[a-p]{32}', url.netloc) and url.path.startswith('/')
                and re.fullmatch(r'\S+', resource))


def extension_import_resource(message):
    match = re.fullmatch(r'(?:TypeError: )?Failed to fetch dynamically imported module: (chrome-extension://\S+)', message)
    resource = match.group(1) if match else None
    return resource if resource and browser_local_extension_resource('GET', resource) else None


def require(condition, message):
    if not condition:
        raise AssertionError(message)


class Journey:
    def __init__(self, args):
        self.args = args
        self.out = args.out.resolve()
        self.out.mkdir(parents=True, exist_ok=True)
        self.started = time.monotonic()
        self.report = {'kind': 'local-agent-first-session', 'headless': True, 'foregroundControls': False,
                       'hostedIdentityOrWorld': False, 'automaticRetries': 0, 'browserClosed': False,
                       'html': str(args.html.resolve()), 'htmlSha256': hashlib.sha256(args.html.read_bytes()).hexdigest(),
                       'touch': args.touch, 'edgeNative': args.edge_native, 'steps': [], 'phases': [], 'requestsBlocked': [],
                       'pageErrors': [], 'rawPageErrors': [], 'extensionPageErrors': [], 'browserLocalRequests': [], 'fixtures': [],
                       'tracePolicy': {'coldStartup': False, 'reloadWarmup': False, 'uiOnly': True,
                                       'timingLimit': 'UI screenshot tracing is an active screencast; this journey does not attribute startup timing to tracing.'}}
        self.mob_fixture = None
        self.trace_state = 'off'
        self.trace_label = None

    def save(self):
        (self.out / 'journey.json').write_text(json.dumps(self.report, indent=2), encoding='utf-8')

    def record_page_error(self, error):
        raw = {'message': str(error), 'name': getattr(error, 'name', type(error).__name__),
               'stack': getattr(error, 'stack', None)}
        self.report['rawPageErrors'].append(raw)
        resource = extension_import_resource(raw['message'])
        if resource:
            self.report['extensionPageErrors'].append({**raw, 'resource': resource})
        else:
            self.report['pageErrors'].append(raw['message'])
        self.save()

    def phase(self, name, **detail):
        value = {'name': name, 'elapsed': round(time.monotonic() - self.started, 3), **detail}
        self.report['phase'] = value
        self.report['phases'].append(value)
        self.save()
        print(json.dumps({'phase': value}), flush=True)

    def fail(self, error):
        self.report['outcome'] = 'FAIL'
        if 'failure' not in self.report:
            self.report.update(failure=str(error) or repr(error), failureType=type(error).__name__,
                               failurePhase=self.report.get('phase'))
        self.save()

    async def start_ui_trace(self, label):
        require(self.trace_state == 'off', 'A prior UI trace has not stopped')
        self.trace_label = label
        self.trace_state = 'starting'
        self.phase('ui-trace-start', segment=label)
        try:
            await asyncio.wait_for(self.context.tracing.start(screenshots=True, snapshots=True, sources=True), timeout=20)
        except Exception as error:
            self.fail(error)
            raise
        self.trace_state = 'recording'
        self.phase('ui-trace-recording', segment=label)

    async def stop_ui_trace(self):
        if self.trace_state not in ['starting', 'recording']:
            return
        self.trace_state = 'stopping'
        name = 'trace-' + self.trace_label + '.zip'
        self.phase('ui-trace-stop', segment=self.trace_label, artifact=name)
        try:
            await asyncio.wait_for(self.context.tracing.stop(path=str(self.out / name)), timeout=20)
        except Exception as error:
            self.trace_state = 'uncertain'
            self.report.setdefault('cleanupErrors', []).append({'operation': 'trace.stop', 'segment': self.trace_label,
                'type': type(error).__name__, 'error': str(error) or repr(error)})
            self.fail(error)
            raise
        self.trace_state = 'off'
        self.report.setdefault('traceArtifacts', []).append(name)
        self.phase('ui-trace-stopped', segment=self.trace_label, artifact=name)

    async def settle_title(self, entry):
        self.phase('title-wait', entry=entry, timeoutSeconds=240)
        try:
            await asyncio.wait_for(wait_title_settled(self.page, timeout=240000), timeout=245)
        except Exception as error:
            self.fail(error)
            try:
                self.report.setdefault('titleReceipts', {})[entry] = await asyncio.wait_for(self.page.evaluate(SNAPSHOT), timeout=2)
            except Exception as receipt_error:
                self.report['titleReceiptError'] = {'type': type(receipt_error).__name__, 'error': str(receipt_error) or repr(receipt_error)}
            self.save()
            raise
        self.phase('title-settled', entry=entry)

    async def record(self, label, shot=False):
        state = await self.page.evaluate(SNAPSHOT)
        state.update(label=label, elapsed=round(time.monotonic() - self.started, 3))
        self.report['steps'].append(state)
        self.save()
        require(not state['stopped'] and not state['errors'] and not self.report['pageErrors'], 'Game error at ' + label)
        require(not state['native'] and not state['host'], 'The fixture must remain local and independent of hosted identity')
        require(not self.report['requestsBlocked'], 'Unexpected external/service request at ' + label)
        if shot:
            if label in ['01-title', '08-returning-title']:
                self.phase('title-screenshot-wait', label=label, condition='loading veil hidden', timeoutMs=5000)
                await self.page.locator('#loading').wait_for(state='hidden', timeout=5000)
            await self.page.screenshot(path=str(self.out / (label + '.png')), timeout=10000)
            state['screenshotElapsed'] = round(time.monotonic() - self.started, 3)
            self.save()
        print(json.dumps({'step': label, 'elapsed': state['elapsed'], 'modal': state['modal']}), flush=True)
        return state

    async def wait(self, expression, timeout=20000, arg=None, label=None):
        self.phase('wait', condition=label or expression[:200], timeoutMs=timeout)
        await self.page.wait_for_function(expression, arg=arg, timeout=timeout, polling=100)

    async def action(self, selector, after=None):
        self.phase('action', selector=selector)
        control = self.page.locator(selector).first
        await control.wait_for(state='visible')
        await control.scroll_into_view_if_needed()
        if self.args.touch:
            await control.tap()
        else:
            await control.click()
        if after:
            await self.wait(after)

    async def panel(self, selector):
        info = await self.page.locator(selector).evaluate("""node=>{
          const content=node.querySelector('.sheet,.mapbox,.book')||node;
          return {visible:!node.hidden&&!!node.getClientRects().length,overflow:content.scrollWidth-content.clientWidth,
            focusInside:node.contains(document.activeElement)};}""")
        require(info['visible'] and info['overflow'] <= 2, 'Panel does not fit: ' + selector + ' ' + str(info))
        if not self.args.touch:
            require(info['focusInside'], 'Keyboard focus left the active panel: ' + selector)

    async def move(self, direction, distance=0.6):
        origin = await self.page.evaluate('({x:__hm.GAME.player.x,z:__hm.GAME.player.z})')
        if self.args.touch:
            point = await self.page.evaluate("""()=>{
              const right=__hm.mobile.prefs.hand==='left';
              for(const y of [.65,.75,.5])for(const x of right?[.85,.75]:[.15,.25]) {
                const px=innerWidth*x,py=innerHeight*y;
                if(document.elementFromPoint(px,py)?.id==='scene')return {x:px,y:py};
              } return null;}""")
            require(point, 'No unobstructed touch movement area')
            dx, dy = {'w': (0, -50), 's': (0, 50), 'a': (-50, 0), 'd': (50, 0)}[direction]
            cdp = await self.page.context.new_cdp_session(self.page)
            try:
                await cdp.send('Input.dispatchTouchEvent', {'type': 'touchStart', 'touchPoints': [{**point, 'id': 1}]})
                await cdp.send('Input.dispatchTouchEvent', {'type': 'touchMove', 'touchPoints': [{'x': point['x'] + dx, 'y': point['y'] + dy, 'id': 1}]})
                await self.wait('([p,d])=>Math.hypot(__hm.GAME.player.x-p.x,__hm.GAME.player.z-p.z)>=d', timeout=8000, arg=[origin, distance])
            finally:
                await cdp.send('Input.dispatchTouchEvent', {'type': 'touchEnd', 'touchPoints': []})
                await cdp.detach()
        else:
            await self.page.keyboard.down(direction)
            try:
                await self.wait('([p,d])=>Math.hypot(__hm.GAME.player.x-p.x,__hm.GAME.player.z-p.z)>=d', timeout=8000, arg=[origin, distance])
            finally:
                await self.page.keyboard.up(direction)

    async def reach_herald(self):
        for _ in range(8):
            state = await self.page.evaluate("""()=>{const H=__hm,P=H.GAME.player,T=H.REALMS[P.faction].herald;
              const dx=T.x-P.x,dz=T.z-P.z,yaw=H.CAM.yaw;return {distance:Math.hypot(dx,dz),
                forward:dx*Math.sin(yaw)+dz*Math.cos(yaw),side:-dx*Math.cos(yaw)+dz*Math.sin(yaw)};}""")
            if state['distance'] <= 1.8:
                return
            key = ('w' if state['forward'] > 0 else 's') if abs(state['forward']) >= abs(state['side']) else ('d' if state['side'] > 0 else 'a')
            await self.move(key, min(1.2, max(0.3, state['distance'] - 1.5)))
        raise AssertionError('The bounded real-input walk did not reach the herald')

    async def arrange_quarry(self):
        fixture = await self.page.evaluate(ARRANGE_QUARRY, {'touch': self.args.touch})
        self.report['quarrySearch'] = fixture.pop('search')
        self.save()
        require(fixture['available'], 'No walkable nearby fixture position with an unobstructed selectable canvas point; inspect quarrySearch rejection receipts')
        self.mob_fixture = fixture
        self.report['fixtures'].append(fixture)
        self.save()
        return fixture

    async def restore_quarry(self):
        if self.mob_fixture:
            await self.page.evaluate("""fixture=>{const e=__hm.fn.getEnt(fixture.id);if(e){
              e.x=e.prevX=fixture.original.x;e.y=fixture.original.y;e.z=e.prevZ=fixture.original.z;
              if(fixture.original.home)e.home={...fixture.original.home};}return 0;}""", self.mob_fixture)
            self.mob_fixture = None

    async def open_menu(self):
        await self.action('#mobile-character' if self.args.touch else '#btn-menu', "()=>__hm.UI.modal==='menu'")

    async def clear_target(self):
        if not self.args.touch:
            await self.page.keyboard.press('Escape')
            await self.wait('()=>__hm.GAME.player.target===null')
            return
        empty = await self.page.evaluate(EMPTY_CANVAS_POINT, {'touch': True})
        require(empty, 'No verified empty canvas point outside the touch movement area')
        self.report['targetClearPoint'] = empty
        observe = bool(getattr(self.args, 'pointer_receipts', False))
        self.report['targetClearPolicy'] = {'minimumHudClearancePx': 32, 'pointerReceipts': observe}
        self.save()
        if not observe:
            await self.page.touchscreen.tap(empty['x'], empty['y'])
            await self.wait('()=>__hm.GAME.player.target===null')
            return
        self.report['targetClearBeforeTap'] = await self.page.evaluate(INSTALL_POINTER_RECEIPTS, empty)
        self.save()
        try:
            await self.page.touchscreen.tap(empty['x'], empty['y'])
            await self.wait('()=>__hm.GAME.player.target===null')
        finally:
            try:
                self.report['targetClearReceipt'] = await self.page.evaluate(STOP_POINTER_RECEIPTS)
            except Exception as error:
                self.report.setdefault('diagnosticErrors', []).append({'operation': 'pointer-receipt.stop',
                    'type': type(error).__name__, 'error': str(error) or repr(error)})
            self.save()
        rows = (self.report.get('targetClearReceipt') or {}).get('rows', [])
        down = next((row for row in rows if row['phase'] == 'capture' and row['type'] == 'pointerdown'
                     and row['isTrusted'] is True and row['pointerType'] == 'touch' and row['target'].get('id') == 'scene'), None)
        up = next((row for row in rows if row['phase'] == 'bubble' and row['type'] == 'pointerup'
                   and row['isTrusted'] is True and row['pointerType'] == 'touch' and row['target'].get('id') == 'scene'
                   and down and row['pointerId'] == down['pointerId']), None)
        require(down and up and all(abs(row[axis] - empty[axis]) < 1 for row in [down, up] for axis in ['x', 'y'])
                and up['state']['target'] is None, 'The native clear tap did not produce matching trusted canvas down/up and a cleared target')

    async def play(self):
        self.phase('navigation-start', entry='fresh')
        await self.page.goto('http://journey.test/', wait_until='commit')
        self.phase('navigation-committed', entry='fresh')
        await self.settle_title('fresh')
        if self.args.edge_native:
            renderer = await self.page.evaluate("""()=>{const gl=__hm.dbg.renderer.getContext(),ext=gl.getExtension('WEBGL_debug_renderer_info');return ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER);}""")
            self.report['rendererIdentity'] = renderer
            require(not re.search(r'SwiftShader|llvmpipe|software|basic render|\bWARP\b', renderer, re.I)
                    and re.search(r'NVIDIA|AMD|Radeon|Intel|Apple|Adreno|Mali', renderer, re.I), 'Native Edge did not provide verifiable hardware graphics: ' + renderer)
            self.report['nativeHardwareVerified'] = True
        await self.record('01-title', shot=True)
        await self.start_ui_trace('entry')
        require(await self.page.locator('#btn-begin').is_enabled(), 'Fresh entry is disabled')
        require(await self.page.locator('#btn-continue').is_hidden(), 'Competing entry actions on the fresh title')
        await self.page.locator('#name-input').fill('Reviewer fixture')
        await self.action('#realm-pick [data-realm="0"]')
        await self.action('#class-pick [data-cls="warrior"]')
        await self.action('#btn-begin', "()=>__hm.GAME.started&&__hm.UI.modal==='prologue'")
        require(await self.page.evaluate('__hm.GAME.prog.level') == 1, 'A fresh character must start at level1')
        await self.panel('#lore-pro')
        await self.record('02-prologue', shot=True)
        for index in range(1, 5):
            await self.action('#lore-pro [data-pro="next"]')
            await self.wait('i=>__hm.LORE.state.pro?.i===i', arg=index)
        await self.action('#lore-pro [data-pro="next"]', "()=>__hm.UI.modal===null&&__hm.LORE.progress().pro===1")
        await self.wait("()=>__hm.LORE.pathNext()?.id==='herald'&&document.getElementById('hud').getClientRects().length")
        await self.reach_herald()
        await self.wait("()=>document.getElementById('prompt').classList.contains('on')&&document.getElementById('prompt-t').textContent.includes('Herald')")
        await self.record('03-first-objective', shot=True)
        if self.args.touch:
            await self.action('#t-use')
        else:
            await self.page.keyboard.press('e')
        await self.wait("()=>__hm.UI.modal==='dialog'&&document.getElementById('dlg-title').textContent.includes('Herald')")
        await self.panel('#dialog')
        await self.record('04-herald', shot=True)
        await self.wait("()=>__hm.LORE.state.ev.herald===true", label='normal lore watcher observed the open Herald dialog')
        before_accept = await self.page.evaluate(EARNED)
        require('herald' not in before_accept['done'], 'The Herald deed must wait until its dialog closes')
        self.report['heraldBoundary'] = {'dialogObserved': True, 'beforeAccept': before_accept}
        self.save()
        accept = self.page.locator('#dlg-actions').get_by_role('button', name='Accept bounty', exact=True)
        require(await accept.count() == 1, 'The default fresh world has no suitable first bounty; inspect herald/objective evidence')
        if self.args.touch:
            await accept.tap()
        else:
            await accept.click()
        await self.wait("()=>__hm.UI.modal===null&&!!__hm.GAME.prog.bounty")
        await self.wait("()=>__hm.GAME.prog.lore.done.includes('herald')", label='Herald deed completed after accepting and closing the dialog')
        self.report['heraldBoundary']['afterClose'] = await self.page.evaluate(EARNED)
        await self.record('04b-herald-complete')
        mark = await self.page.evaluate("""()=>{const H=__hm,b=H.GAME.prog.bounty,c=H.CAMPS[b.camp],m=H.guide.mark();
          return {m,c:{x:Math.round(c.x),z:Math.round(c.z)},have:b.have};}""")
        require(mark['m'] and mark['m']['x'] == mark['c']['x'] and mark['m']['z'] == mark['c']['z'], 'Accepted bounty has the wrong navigation marker')
        map_button = '#mobile-map' if self.args.touch else '#btn-map'
        await self.action(map_button, "()=>__hm.UI.modal==='map'")
        await self.panel('#mapov')
        await self.record('05-map', shot=True)
        await self.action('#btn-mapclose', "()=>__hm.UI.modal===null")
        await self.wait('id=>document.activeElement?.id===id', arg=map_button[1:])
        fixture = await self.arrange_quarry()
        try:
            await self.wait("id=>{const H=__hm,e=H.fn.getEnt(id);if(!e?.alive)throw Error('Combat fixture died before input');return !!H.fn.screenOf(e.x,e.y+1,e.z);}", arg=fixture['id'])
            await self.wait("id=>{const H=__hm,e=H.fn.getEnt(id);return H.UI.npPool.some(node=>node._txt===e?.name&&node.style.display!=='none'&&node.getClientRects().length);}", arg=fixture['id'])
            point = await self.page.evaluate("""id=>{const H=__hm,e=H.fn.getEnt(id),h=(e.kind==='humanoid'?1:.6)*(e.scale||1);return H.fn.screenOf(e.x,e.y+h,e.z);}""", fixture['id'])
            require(point and 0 < point['x'] < self.args.width and 0 < point['y'] < self.args.height, 'The arranged creature is not visible on screen')
            require(await self.page.evaluate(SELECTABLE_CANVAS_POINT, {'point': point, 'touch': self.args.touch}), 'The creature input point is covered or belongs to the movement stick')
            if self.args.touch:
                await self.page.touchscreen.tap(point['x'], point['y'])
            else:
                await self.page.mouse.click(point['x'], point['y'])
            await self.wait("id=>{const H=__hm,e=H.fn.getEnt(id),tf=document.getElementById('tf');return H.GAME.player.target===id&&tf.getClientRects().length&&document.getElementById('tf-name').textContent===e.name;}", arg=fixture['id'])
            require(await self.page.locator('#tf-name').inner_text() == fixture['name'], 'Visible target frame does not match the selected creature')
            await self.action('#tpad [data-slot="0"]' if self.args.touch else '#hotbar [data-slot="0"]')
            await self.wait('id=>{const H=__hm,e=H.fn.getEnt(id);if(!H.GAME.player.alive)throw Error("Player died before a verified hit");return e?.lastHitBy===H.GAME.player.id&&e.hp<e.maxHp;}', timeout=30000, arg=fixture['id'])
            await self.wait("()=>document.getElementById('tf').getClientRects().length&&parseFloat(document.getElementById('tf-hp').style.width)<100")
            require('You hit' in await self.page.locator('#log').inner_text(), 'The actual player hit has no readable combat feedback')
            await self.record('06-combat-feedback', shot=True)
        finally:
            await self.restore_quarry()
        await self.clear_target()
        await self.action('#mobile-inventory' if self.args.touch else '#btn-kit', "()=>__hm.UI.modal==='kit'")
        await self.panel('#kit')
        require(await self.page.locator('#kit-right').inner_text(), 'Inventory has no readable contents')
        await self.action('#kit-close', "()=>__hm.UI.modal===null")
        earned = await self.page.evaluate(EARNED)
        await self.open_menu()
        await self.action('#menu-tab-progress', "()=>__hm.UI.menuTab==='progress'")
        require(await self.page.locator('#march-progress-path').inner_text() == 'View objectives', 'Progress does not clearly name its objective-list destination')
        await self.action('#march-progress-path', "()=>__hm.UI.menuTab==='chronicle'&&__hm.LORE.state.chronSec==='path'")
        objective = self.page.locator('[data-lore="track:cook"]')
        require(await objective.count() == 1, 'A first-session player cannot choose the next cooking objective')
        if not await objective.is_visible():
            await objective.locator('xpath=ancestor::details[1]/summary').click()
        await self.action('[data-lore="track:cook"]', "()=>__hm.GAME.prog.lore.track==='cook'")
        await self.record('07-selected-objective', shot=True)
        await self.action('#menu-tab-settings', "()=>__hm.UI.menuTab==='settings'")
        await self.action('#set-m [data-v="off"]')
        await self.wait("()=>{const s=JSON.parse(localStorage.getItem('hallowmarch.save.v1')||'null');return s?.char?.lore?.track==='cook'&&s?.settings?.music===0;}")
        require(await self.page.evaluate('__hm.UI.modal') == 'menu', 'The save check must keep the edited menu open')
        require(await self.page.evaluate(EARNED) == earned, 'Menu navigation or tracking awarded or changed earned progress')
        saved = await self.page.evaluate("JSON.parse(localStorage.getItem('hallowmarch.save.v1'))")
        self.report['savedCheckpoint'] = {'name': saved['char']['name'], 'level': saved['char']['level'], 'xp': saved['char']['xp'], 'track': saved['char']['lore']['track'], 'music': saved['settings']['music']}
        self.save()
        await self.stop_ui_trace()
        self.phase('navigation-start', entry='reload')
        await self.page.reload(wait_until='commit')
        self.phase('navigation-committed', entry='reload')
        await self.settle_title('reload')
        await self.start_ui_trace('return')
        await self.record('08-returning-title', shot=True)
        require(await self.page.locator('#btn-begin').inner_text() == 'Continue as Reviewer fixture', 'Returning character does not have one clear Continue action')
        require(await self.page.locator('#character-create-fields').is_hidden() and await self.page.locator('#btn-continue').is_hidden(), 'The returning title exposes competing character entry actions')
        await self.action('#btn-begin', '()=>__hm.GAME.started&&!!__hm.GAME.player')
        require(await self.page.evaluate('__hm.UI.modal') is None, 'Returning character unexpectedly reopens onboarding')
        require(await self.page.evaluate('__hm.GAME.prog.lore.track') == 'cook', 'The tracked objective was lost across real reload/Continue')
        require(await self.page.evaluate(EARNED) == earned, 'Normal reload/Continue did not preserve earned progress')
        await self.move('w', 0.4)
        await self.record('09-continued-world', shot=True)
        await self.open_menu()
        await self.action('#menu-tab-settings')
        require(await self.page.locator('#set-m [data-v="off"]').get_attribute('aria-checked') == 'true', 'The persisted music preference did not apply after Continue')

    async def run(self):
        self.phase('preflight')
        html = self.args.html.read_text(encoding='utf-8').replace(THREE_URL, '/qa/three.mjs')
        html = re.sub(r'<link[^>]+href="https://fonts\.[^>]+>', '', html)
        if self.args.expect_sha256:
            require(self.report['htmlSha256'] == self.args.expect_sha256, 'Frozen build hash differs from the expected candidate')
        browser = None
        owned = NativeJourneyBrowser(self.out, self.args.timeout + 120, edge=self.args.edge_native, executable=self.args.executable)
        self.report['outcome'] = 'FAIL'
        try:
            self.phase('playwright-driver-start')
            async with async_playwright() as p:
                self.phase('browser-launch')
                endpoint = await owned.start()
                self.report['ownedBrowser'] = owned.receipt
                self.phase('browser-owned', browserPid=owned.receipt.get('ownedBrowserPid'))
                self.phase('browser-connect')
                browser = await p.chromium.connect(endpoint, timeout=45000)
                self.report['browserVersion'] = browser.version
                self.phase('browser-connected', version=browser.version)
                self.phase('context-create')
                context = await browser.new_context(viewport={'width': self.args.width, 'height': self.args.height}, has_touch=self.args.touch,
                                                    is_mobile=self.args.touch, service_workers='block')
                self.context = context
                self.phase('page-create')
                self.page = await context.new_page()
                self.page.set_default_timeout(20000)
                self.page.on('pageerror', self.record_page_error)
                self.phase('context-created')

                async def route(request):
                    url = urlparse(request.request.url)
                    if browser_local_extension_resource(request.request.method, request.request.url):
                        self.report['browserLocalRequests'].append({'method': request.request.method, 'url': request.request.url})
                        await request.continue_()
                        return
                    value = None
                    if url.scheme == 'http' and url.netloc == 'journey.test' and request.request.method == 'GET':
                        if url.path == '/': value = ('text/html', html.encode())
                        elif url.path == '/qa/three.mjs': value = ('application/javascript', (ROOT / 'tools/node_modules/three/build/three.module.min.js').read_bytes())
                        elif url.path == '/favicon.ico': value = ('image/x-icon', b'')
                        elif url.path.startswith('/gaming/identity/assets/'):
                            name = url.path.rsplit('/', 1)[-1]
                            path = ROOT / 'client/native-pod' / name
                            if re.fullmatch(r'[A-Za-z0-9_.-]+\.mjs', name) and path.is_file(): value = ('application/javascript', path.read_bytes())
                    if value:
                        await request.fulfill(content_type=value[0], body=value[1])
                    else:
                        self.report['requestsBlocked'].append({'method': request.request.method, 'url': request.request.url})
                        await request.abort()

                async def block_socket(socket):
                    self.report['requestsBlocked'].append({'method': 'WebSocket', 'url': socket.url})
                    await socket.close(code=1008, reason='Local journey fixture')

                await context.route('**/*', route)
                await context.route_web_socket('**/*', block_socket)
                self.phase('local-routes-ready')
                try:
                    await asyncio.wait_for(self.play(), timeout=self.args.timeout)
                    self.report['outcome'] = 'PASS'
                except Exception as error:
                    self.fail(error)
                    try: await self.page.screenshot(path=str(self.out / 'failure.png'), timeout=5000)
                    except Exception: pass
                finally:
                    try:
                        await self.stop_ui_trace()
                    except Exception:
                        pass  # The explicit trace error is retained; browser ownership cleanup still runs.
                    self.phase('browser-close')
                    try:
                        await asyncio.wait_for(browser.close(), timeout=15)
                    except Exception as error:
                        self.report['browserCloseFailure'] = {'type': type(error).__name__, 'error': str(error) or repr(error)}
                    self.phase('owned-browser-cleanup')
                    self.report['browserClosed'] = await owned.stop()
        except Exception as error:
            self.fail(error)
        finally:
            if owned.process and not self.report['browserClosed']:
                try:
                    self.report['browserClosed'] = await owned.stop()
                except Exception as error:
                    self.report['cleanupError'] = {'type': type(error).__name__, 'error': str(error) or repr(error)}
            self.report['ownedBrowser'] = owned.receipt
            if not self.report['browserClosed']:
                self.report['outcome'] = 'FAIL'
            self.report['elapsedSeconds'] = round(time.monotonic() - self.started, 3)
            self.phase('complete', outcome=self.report['outcome'], browserClosed=self.report['browserClosed'])
        print(json.dumps({'outcome': self.report.get('outcome', 'FAIL'), 'evidence': str(self.out), 'browserClosed': self.report['browserClosed']}), flush=True)
        return self.report.get('outcome') == 'PASS'


def arguments():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--html', type=pathlib.Path, required=True, help='Exact frozen built HTML to review')
    parser.add_argument('--expect-sha256', help='Refuse to run a different candidate')
    parser.add_argument('--out', type=pathlib.Path, default=ROOT.parent / 'first-session-qa')
    parser.add_argument('--executable', help='Optional browser executable; always launches headless with a fresh context')
    parser.add_argument('--edge-native', action='store_true', help='Installed headless Edge with native GPU/security defaults and hardware identity verification')
    parser.add_argument('--touch', action='store_true', help='Use real touch input and the compact phone controls')
    parser.add_argument('--pointer-receipts', action='store_true', help='Opt-in passive dispatch/HUD diagnostics around the single touch target-clear action')
    parser.add_argument('--width', type=int)
    parser.add_argument('--height', type=int)
    parser.add_argument('--timeout', type=int, default=720, help='Whole-journey deadline in seconds; no automatic retry')
    args = parser.parse_args()
    if args.edge_native and args.executable:
        parser.error('--edge-native uses the installed Edge channel; do not combine it with --executable')
    args.width = args.width or (390 if args.touch else 1280)
    args.height = args.height or (780 if args.touch else 800)
    return args


if __name__ == '__main__':
    raise SystemExit(0 if asyncio.run(Journey(arguments()).run()) else 1)
