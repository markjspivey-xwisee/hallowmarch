"""Mobile HUD regression: real taps, safe areas, unobstructed play, and accessible full controls.

usage: python3 tools/tests/mobile_hud.py [baseline|kitonly] [noshots] [sizes=393x660,390x780,360x640,844x390]
Baseline records the old layout without applying the new compact-HUD requirements.
"""
import asyncio
import json
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
from hmlib import setup, OUT, human_play
from playwright.async_api import async_playwright

ARGS = sys.argv[1:]
OPT = dict(a.split('=', 1) for a in ARGS if '=' in a)
BASELINE = 'baseline' in ARGS
KIT_ONLY = 'kitonly' in ARGS
SHOTS = 'noshots' not in ARGS
SIZES = [tuple(map(int, s.split('x'))) for s in OPT.get('sizes', '393x660,390x780,360x640,844x390').split(',')]
CLASSES = OPT.get('classes', 'warrior,archer,mage,priest').split(',')
FAILS = []
RESULTS = []


def check(ok, message):
    print(('PASS ' if ok else 'FAIL ') + message, flush=True)
    if not ok:
        FAILS.append(message)


HELP = r"""
window.MH = {
  shown(el) {
    if (!el || el.hidden) return false;
    for (let p = el; p && p !== document.body; p = p.parentElement) {
      const s = getComputedStyle(p);
      if (p.hidden || s.display === 'none' || s.visibility === 'hidden' || +s.opacity < .05) return false;
    }
    const r = el.getBoundingClientRect();
    return r.width > 1 && r.height > 1;
  },
  lay() {
    const H = __hm;
    if (H.guide2) H.guide2.G2.tap.until = 0;
    H.hud.HUDL.k = 0; H.hud.HUDL.t = 0; H.hud.hudLayout(1);
    return 0;
  },
  async scene(cls, level) {
    const H = __hm;
    if (H.GAME.player) H.fn.removeEnt(H.GAME.player);
    await H.start({realm: 2, cls, level, name: 'Mobile Tester', rp: level > 1 ? 60000 : 0});
    H.UI.modal = null;
    const pro = document.getElementById('lore-pro'); if (pro) pro.hidden = true;
    H.LORE.state.noteUntil = performance.now() + 120000;
    if (H.LORE.state.queue) H.LORE.state.queue.length = 0;
    const P = H.GAME.player;
    for (const e of H.ENT) if (e !== P && e.alive && e.kind !== 'door' && H.fn.isEnemy(P,e) && Math.hypot(e.x-P.x,e.z-P.z)<80) {e.alive=false;e.removeAt=H.GAME.t;}
    P.hp=P.maxHp; P.buffs.length=0; P.casting=null; P.target=null; P.combatUntil=0;
    H.setTod(.3); H.CAM.mode='play'; H.CAM.pitch=.3; H.CAM.dist=H.CAM.targetDist=7;
    return 0;
  },
  measure() {
    this.lay();
    const selectors = ['#pf','#tf','#mmwrap','#topright > .iconbtns','#mobile-menu-toggle','#mobile-character','#war','#bounty','#lore-path','#cls','#petbar','#netparty','#buildbar','#farmcard','#breath','#prompt','#castbar','#banners > .banner','#zonetoast','#joyhint','#tpad button'];
    const boxes = [], elements = [], seen = new Set();
    for (const sel of selectors) for (const el of document.querySelectorAll(sel)) {
      if (!this.shown(el) || seen.has(el)) continue;
      if (sel === '#zonetoast' && !el.classList.contains('on')) continue;
      seen.add(el);
      const r = el.getBoundingClientRect();
      boxes.push({sel: el.id ? '#'+el.id : sel+(el.dataset.slot ? '[data-slot="'+el.dataset.slot+'"]' : ''), x:r.x,y:r.y,w:r.width,h:r.height});
      elements.push(el);
    }
    const probe=document.createElement('div'); probe.style.cssText='position:fixed;visibility:hidden;padding:var(--safe-t,0px) var(--safe-r,0px) var(--safe-b,0px) var(--safe-l,0px)';document.body.appendChild(probe);const ps=getComputedStyle(probe),v=s=>parseFloat(s)||0;const safe={t:v(ps.paddingTop),r:v(ps.paddingRight),b:v(ps.paddingBottom),l:v(ps.paddingLeft)};probe.remove();
    const graphics={ready:__hm.ready,gameReady:__hm.GAME.ready,lost:window.__hmStartup?.lost,restored:window.__hmStartup?.restored,stopped:window.__hmStartup?.stopped};
    const off = boxes.filter(r=>r.x<safe.l-1||r.y<safe.t-1||r.x+r.w>innerWidth-safe.r+1||r.y+r.h>innerHeight-safe.b+1);
    const overlaps=[];
    for(let i=0;i<boxes.length;i++)for(let j=i+1;j<boxes.length;j++){
      if(elements[i].contains(elements[j])||elements[j].contains(elements[i]))continue;
      const a=boxes[i],b=boxes[j],dx=Math.min(a.x+a.w,b.x+b.w)-Math.max(a.x,b.x),dy=Math.min(a.y+a.h,b.y+b.h)-Math.max(a.y,b.y);
      if(dx>3&&dy>3)overlaps.push({a:a.sel,b:b.sel,dx,dy});
    }
    // Union sampled at 2px rather than adding panel areas, so parent/child boxes are not counted twice.
    let occupied=0, centerHit=0, centerN=0;
    for(let y=1;y<innerHeight;y+=2) for(let x=1;x<innerWidth;x+=2) {
      const hit=boxes.some(r=>x>=r.x&&x<r.x+r.w&&y>=r.y&&y<r.y+r.h);
      if(hit)occupied++;
      if(x>=innerWidth*.2&&x<=innerWidth*.8&&y>=innerHeight*.28&&y<=innerHeight*.64){centerN++;if(hit)centerHit++;}
    }
    const controls=[];
    for(const el of document.querySelectorAll('#hud button,#hud [role="button"]')) {
      if(!this.shown(el)||el.closest('.tip')||getComputedStyle(el).pointerEvents==='none')continue;
      const r=el.getBoundingClientRect(),cx=r.x+r.width/2,cy=r.y+r.height/2;
      const hit=document.elementFromPoint(cx,cy);
      // Ignore controls clipped inside a scrollable sheet; each is checked after scrolling in the tap flows.
      if(cx<0||cy<0||cx>innerWidth||cy>innerHeight)continue;
      controls.push({id:el.id,label:el.getAttribute('aria-label')||el.textContent.trim().slice(0,30),w:r.width,h:r.height,top:!!hit&&(hit===el||el.contains(hit))});
    }
    return {w:innerWidth,h:innerHeight,graphics,safe,boxes,off,overlaps,controls,coverage:occupied/Math.ceil(innerWidth/2)/Math.ceil(innerHeight/2),centerClear:1-centerHit/centerN,slots:[...document.querySelectorAll('#tpad [data-slot]')].filter(e=>this.shown(e)).map(e=>({slot:+e.dataset.slot,locked:e.classList.contains('locked'),label:e.getAttribute('aria-label')})),primary:[...document.querySelectorAll('#tpad .mobile-main-action .mobile-label')].filter(e=>this.shown(e)).map(e=>e.textContent)};
  },
};
window.__mobileRafHold = true;
if (!window.__mobileRafWrapped) {
  window.__mobileRafWrapped = true;
  const raf=window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame=cb=>raf(t=>{if(window.__mobileRafHold)window.requestAnimationFrame(cb);else cb(t)});
}
0;
"""


async def frame(page):
    # Scene setup alone must not authorize simulation; use a real operator input.
    await human_play(page)
    # The scene target and the camera both settle after a viewport/orientation change.
    for _ in range(2):
        await page.evaluate('__hm.frame(1/30); MH.lay(); 0')


async def tap(page, selector, *, closes=None):
    await page.evaluate('MH.lay(); 0')
    box = await page.evaluate(r"""(selector) => {
      const el=document.querySelector(selector); if(!MH.shown(el))return null;
      const r=el.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2,hit=document.elementFromPoint(x,y);
      const top=!!hit&&(hit===el||el.contains(hit)),watchClick=!el.closest('#hud');
      window.__mobileTapClickCleanup?.();
      window.__mobileTapClickReceipt={clicked:false,trusted:false};
      if(top&&watchClick){
        const receipt=window.__mobileTapClickReceipt;
        const clicked=event=>{
          if(event.target!==el&&!el.contains(event.target))return;
          receipt.clicked=true;receipt.trusted=event.isTrusted;
          document.removeEventListener('click',clicked,true);
        };
        document.addEventListener('click',clicked,true);
        window.__mobileTapClickCleanup=()=>document.removeEventListener('click',clicked,true);
      }
      return {x,y,w:r.width,h:r.height,top,watchClick};
    }""", selector)
    check(bool(box and box['top'] and box['w'] >= 43.5 and box['h'] >= 43.5), f'{selector}: visible 44px tap target {box}')
    if not box or not box['top']:
        return False
    try:
        await page.touchscreen.tap(box['x'], box['y'])
        # G2 tracks clicks only inside #hud. Dialog controls live outside it;
        # its already-false flag does not prove their delayed native click ran.
        if box['watchClick']:
            await page.wait_for_function('window.__mobileTapClickReceipt?.clicked', timeout=15000)
        await page.wait_for_function('!(window.__hm.guide2 && __hm.guide2.G2.tap.pending)', timeout=15000)
        if closes:
            await page.locator(closes).wait_for(state='hidden', timeout=15000)
    finally:
        await page.evaluate('window.__mobileTapClickCleanup?.();window.__mobileTapClickCleanup=null;0')
    return True


async def more_tab(page, section):
    """Category changes use the same real, hit-tested taps as gameplay controls."""
    await tap(page, f'#mobile-tray-tabs [data-mobile-tab="{section}"]')
    state = await page.evaluate(r"""() => {
      const tray=document.getElementById('mobile-tray'),tabs=[...tray.querySelectorAll('[data-mobile-tab]')];
      return {visible:MH.shown(tray),section:tray.dataset.section,
        selected:tabs.filter(e=>e.getAttribute('aria-selected')==='true').map(e=>e.dataset.mobileTab),
        labelledBy:document.getElementById('mobile-tray-panel').getAttribute('aria-labelledby')};
    }""")
    check(state['visible'] and state['section']==section and state['selected']==[section]
          and state['labelledBy']=='mobile-tab-'+section,
          f'More category {section} remains open with one selected tab and its labelled panel {state}')


async def shot(page, name):
    if SHOTS:
        await page.screenshot(path=OUT + name + '.png', timeout=300000)


async def multitouch(page):
    """A real second finger holds Block while the first moves the floating stick."""
    cdp = await page.context.new_cdp_session(page)
    at = await page.evaluate(r"""(() => {
      const r=document.querySelector('#tpad .cls-btn.hold').getBoundingClientRect();
      return {hold:{x:r.x+r.width/2,y:r.y+r.height/2,id:2},move:{x:innerWidth*.15,y:innerHeight*.82,id:1}};
    })()""")
    move, hold = at['move'], at['hold']
    try:
        await cdp.send('Input.dispatchTouchEvent', {'type':'touchStart','touchPoints':[move]})
        moved={**move,'x':move['x']+25,'y':move['y']-25}
        await cdp.send('Input.dispatchTouchEvent', {'type':'touchMove','touchPoints':[moved]})
        await cdp.send('Input.dispatchTouchEvent', {'type':'touchStart','touchPoints':[moved,hold]})
        st=await page.evaluate('({joy:!!__hm.INPUT.joy,dx:__hm.INPUT.joy?.dx,block:__hm.cls.state().block,held:__hm.cls.CLS.hold})')
        check(st['joy'] and abs(st['dx']) > .1 and st['block'] and st['held'],f'move and Block work with two simultaneous fingers {st}')
    finally:
        await cdp.send('Input.dispatchTouchEvent', {'type':'touchEnd','touchPoints':[]})
        await cdp.detach()
    st=await page.evaluate('({joy:!!__hm.INPUT.joy,held:__hm.cls.CLS.hold,block:__hm.cls.state().block})')
    check(not st['joy'] and not st['held'] and not st['block'],f'releasing both fingers leaves no stuck movement or Block {st}')


async def drawer_swipe(page, tag):
    """The content panel must scroll with a finger, while the header and world stay still."""
    at=await page.evaluate(r"""(() => {
      const el=document.getElementById('mobile-tray-panel'),r=el.getBoundingClientRect();
      const head=document.querySelector('#mobile-tray .mobile-sheet-header').getBoundingClientRect();
      return {x:r.x+r.width/2,y:r.top+r.height*.82,end:r.top+r.height*.18,
        scroll:el.scrollTop,overflow:el.scrollHeight-el.clientHeight,headerTop:head.top};
    })()""")
    check(at['overflow']>20,tag+': Character content exceeds its scroll panel before the finger swipe '+json.dumps(at))
    cdp=await page.context.new_cdp_session(page)
    try:
        await cdp.send('Input.dispatchTouchEvent',{'type':'touchStart','touchPoints':[{'x':at['x'],'y':at['y'],'id':1}]})
        for i in range(1,7):
            y=at['y']+(at['end']-at['y'])*i/6
            await cdp.send('Input.dispatchTouchEvent',{'type':'touchMove','touchPoints':[{'x':at['x'],'y':y,'id':1}]})
            await page.wait_for_timeout(20)  # gesture cadence, not game simulation
        await page.wait_for_timeout(120)  # rest the finger before lifting, avoiding an uncontrolled fling
    finally:
        await cdp.send('Input.dispatchTouchEvent',{'type':'touchEnd','touchPoints':[]})
        await cdp.detach()
    await page.wait_for_timeout(100)
    st=await page.evaluate('({scroll:document.getElementById("mobile-tray-panel").scrollTop,headerTop:document.querySelector("#mobile-tray .mobile-sheet-header").getBoundingClientRect().top,joy:!!__hm.INPUT.joy,modal:__hm.UI.modal})')
    check(st['scroll']>at['scroll']+20 and abs(st['headerTop']-at['headerTop'])<1 and not st['joy'] and st['modal']=='mobile',tag+': a real finger swipe scrolls drawer content while keeping its header fixed and the character still '+json.dumps(st))


async def kit_geometry(page, tag):
    m=await page.evaluate(r"""(() => {
      const sheet=document.querySelector('#kit .sheet'),s=sheet.getBoundingClientRect(),close=document.getElementById('kit-close'),r=close.getBoundingClientRect();
      const root=getComputedStyle(document.documentElement),n=k=>parseFloat(root.getPropertyValue(k))||0;
      const safe={l:n('--safe-l'),r:n('--safe-r'),t:n('--safe-t'),b:n('--safe-b')};
      const bad=[...document.querySelectorAll('#kit .kithead,#kit .eqgrid,#kit .eqslot,#kit button')].filter(e=>MH.shown(e)).filter(e=>{const b=e.getBoundingClientRect();return b.left<s.left-1||b.right>s.right+1;}).map(e=>e.id||e.className);
      const small=[...document.querySelectorAll('#kit button')].filter(e=>MH.shown(e)).filter(e=>{const b=e.getBoundingClientRect();return b.width<43.5||b.height<43.5;}).map(e=>{const b=e.getBoundingClientRect();return{id:e.id,label:e.textContent.trim(),w:b.width,h:b.height};});
      const hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);
      return {overflow:sheet.scrollWidth-sheet.clientWidth,sheet:{left:s.left,right:s.right},close:{left:r.left,right:r.right,top:r.top,bottom:r.bottom,w:r.width,h:r.height},bad,small,safe,inside:s.left>=safe.l&&s.right<=innerWidth-safe.r&&r.left>=safe.l&&r.right<=innerWidth-safe.r&&r.top>=safe.t&&r.bottom<=innerHeight-safe.b,hit:!!hit&&(hit===close||close.contains(hit))};
    })()""")
    check(m['overflow']<=1 and not m['bad'] and not m['small'] and m['inside'] and m['hit'] and m['close']['w']>=44 and m['close']['h']>=44,tag+': Kit header, equipment and Close fit without horizontal clipping, with 44px controls '+json.dumps(m))
    await shot(page,'mobile_kit_'+tag)


async def approach_herald(page, tag):
    """Arrange clear approach ground, preserving every nearby actor and real interaction priority."""
    scene = await page.evaluate(r"""() => {
      const H=__hm,P=H.GAME.player,R=H.REALMS[P.faction],herald=R.herald;
      const actors=H.ENT.filter(e=>e!==P&&e!==herald&&e.alive&&!e.removed&&e.kind!=='door'&&Math.abs(e.y-herald.y)<1.5);
      const candidates=[];
      for(const radius of [1.25,1.65,2.1])for(let i=0;i<16;i++){
        const angle=i*Math.PI/8,x=herald.x+Math.cos(angle)*radius,z=herald.z+Math.sin(angle)*radius;
        if(!H.fn.isWalkable(x,z)||Math.abs(H.fn.heightAt(x,z)-herald.y)>1.2)continue;
        const gap=Math.min(10,...actors.map(e=>Math.hypot(e.x-x,e.z-z)-((e.radius||.45)*(e.scale||1)+P.radius*(P.scale||1))));
        if(gap<.3||radius<(herald.radius*(herald.scale||1)+P.radius*(P.scale||1))+.2)continue;
        candidates.push({x,z,score:Math.min(gap,3)-radius/4});
      }
      candidates.sort((a,b)=>b.score-a.score);
      return {expected:`Speak with the ${R.name} Herald`,candidates:candidates.slice(0,12)};
    }""")
    state = None
    for at in scene['candidates']:
        await page.evaluate(r"""({x,z})=>{
          const H=__hm,P=H.GAME.player,R=H.REALMS[P.faction];
          H.teleport(x,z);P.yaw=H.CAM.yaw=Math.atan2(R.herald.x-P.x,R.herald.z-P.z);
          H.simulate(.05);return 0;
        }""", at)
        await frame(page)
        state = await page.evaluate(r"""()=>{
          const H=__hm,P=H.GAME.player,R=H.REALMS[P.faction];
          return {prompt:document.getElementById('prompt-t').textContent,use:document.getElementById('t-use').getAttribute('aria-label'),
            distance:Math.hypot(P.x-R.herald.x,P.z-R.herald.z),
            actors:H.ENT.filter(e=>e!==P&&e.alive&&!e.removed&&Math.hypot(e.x-P.x,e.z-P.z)<5).map(e=>({name:e.name,role:e.role,x:e.x,z:e.z}))};
        }""")
        if state['prompt'] == scene['expected'] and state['use'] == scene['expected']:
            check(True,tag+': clear herald approach exposes the exact herald prompt before Use '+json.dumps(state))
            return
    raise AssertionError(tag+': no clear herald approach exposed the expected interaction '+json.dumps(state))


async def flows(page, tag):
    """Only scene setup uses the debug API; every user action below is an actual touch."""
    await page.evaluate('__hm.surv.SURV.hunger=.25; __hm.surv.SURV.thirst=.25; __hm.mobile.state.t=0; 0')
    await frame(page)
    check(await page.locator('#mobile-needs-alert').is_visible(),tag+': low needs remain visible in the compact player frame')
    check(await tap(page,'#mobile-menu-toggle'),tag+': controls drawer opens by touch')
    check(await page.locator('#mobile-tray').is_visible(),tag+': controls drawer visible')
    check(await page.locator('#mobile-tray').get_attribute('data-section')=='world',tag+': More opens on Explore with supplies immediately available')
    check(await page.locator('#needs').is_visible(),tag+': live needs control remains available in the drawer')
    needs=await page.evaluate(r"""(() => {
      const e=document.getElementById('needs'),r=e.getBoundingClientRect(),head=document.querySelector('.mobile-sheet-header').getBoundingClientRect();
      const hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);
      return {w:r.width,h:r.height,top:r.top,bottom:r.bottom,header:head.bottom,inView:r.top>=head.bottom&&r.bottom<=innerHeight-20,hit:!!hit&&(e===hit||e.contains(hit))};
    })()""")
    check(needs['inView'] and needs['hit'] and needs['w']>=44 and needs['h']>=44,tag+': food and water are immediately reachable on opening More '+json.dumps(needs))
    await shot(page,'mobile_controls_'+tag.replace(' ','_'))
    await more_tab(page,'character')
    check(not await page.locator('#needs').is_visible(),tag+': needs stay in Explore rather than crowding Character')
    await drawer_swipe(page,tag)
    # Every skill has a readable details item, including future unlocks.
    catalog=await page.evaluate(r"""(() => {
      const nodes=[...document.querySelectorAll('#mobile-tray-abilities [data-mobile-ability]')];
      return {n:nodes.length,slots:nodes.map(e=>+e.dataset.mobileAbility),locked:nodes.filter(e=>e.dataset.locked==='true').length,text:document.querySelector('#mobile-tray-abilities').textContent};
    })()""")
    check(catalog['n']==8 and len(set(catalog['slots']))==8 and catalog['locked']==7,tag+': all eight skill descriptions, including seven future unlocks, remain reachable')
    detail=page.locator('#mobile-tray-abilities [data-locked="true"] summary').first
    if await detail.count():
        await detail.scroll_into_view_if_needed()
        selector='#mobile-tray-abilities [data-locked="true"] summary'
        before=await page.evaluate('({power:__hm.GAME.player.power,casting:!!__hm.GAME.player.casting})')
        await tap(page,selector)
        opened=await detail.evaluate('(el)=>el.parentElement.open')
        after=await page.evaluate('({power:__hm.GAME.player.power,casting:!!__hm.GAME.player.casting})')
        check(opened and before==after,tag+': reading a future skill expands its description without casting')
    await page.locator('#mobile-tray-close').scroll_into_view_if_needed()
    await tap(page,'#mobile-tray-close',closes='#mobile-tray')
    check(not await page.locator('#mobile-tray').is_visible(),tag+': drawer closes by touch')
    await page.evaluate('__hm.surv.SURV.hunger=1; __hm.surv.SURV.thirst=1; __hm.mobile.state.t=0; 0')
    await frame(page)
    check(not await page.locator('#mobile-needs-alert').is_visible(),tag+': needs warning clears when fed and hydrated')
    await tap(page,'#mobile-character')
    check(await page.locator('#menu').is_visible(),tag+': compact character frame opens the full character sheet')
    await tap(page,'#menu-close',closes='#menu')
    for section,control,panel,close in [('world','#btn-map','#mapov','#btn-mapclose'),('character','#btn-kit','#kit','#kit-close'),('character','#btn-menu','#menu','#menu-close')]:
        await tap(page,'#mobile-menu-toggle')
        await more_tab(page,section)
        await page.locator(control).scroll_into_view_if_needed()
        await tap(page,control)
        check(await page.locator(panel).is_visible() and not await page.locator('#mobile-tray').is_visible(),tag+': '+control+' opens its real screen and closes the drawer')
        if panel=='#kit':
            await kit_geometry(page,tag)
        await page.locator(close).scroll_into_view_if_needed()
        await tap(page,close,closes=panel)
        check(not await page.locator(panel).is_visible(),tag+': '+panel+' closes back to play')
    await page.evaluate('__hm.GAME.player.onGround=true; __hm.GAME.player.vy=0; 0')
    await tap(page,'#t-jump')
    check(await page.evaluate('__hm.GAME.player.vy>0 && !__hm.GAME.player.onGround'),tag+': Jump tap actually jumps')
    await page.evaluate('__hm.GAME.player.onGround=true; __hm.GAME.player.vy=0; __hm.INV.potions=3; __hm.INV.potionAt=-1e6; __hm.GAME.player.hp=__hm.GAME.player.maxHp*.5; 0')
    await tap(page,'#t-potion')
    check(await page.evaluate('__hm.INV.potions===2 && __hm.GAME.player.hp>__hm.GAME.player.maxHp*.5'),tag+': Potion tap consumes one draught and heals')
    await page.evaluate(r"""(() => {
      const H=__hm,P=H.GAME.player;
      const e=H.fn.spawnRealmUnit(0,'warrior',1,'guard',P.x,P.z+1.6,{});
      e.hp=e.maxHp=100000; e.testDummy=true; e.ai.post={x:e.x,z:e.z,leash:0}; e.ai.nextAbility=1e12; e.swingAt=1e12; window.__mobileFoe=e;
      P.target=null; P.yaw=H.CAM.yaw=0; P.power=P.maxPower; P.cds.slash=0; P.gcdUntil=0; P.swingAt=1e12;
      H.simulate(.05); return 0;
    })()""")
    await tap(page,'#t-target')
    check(await page.evaluate('__hm.GAME.player.target===window.__mobileFoe.id'),tag+': Target tap selects a real nearby enemy')
    hp=await page.evaluate('window.__mobileFoe.hp')
    await tap(page,'#tpad [data-slot="0"]')
    # Slash lands after its real 0.22s wind-up. Automatic swings are held above so they cannot mask a broken tap.
    await page.evaluate('__hm.simulate(.3); 0')
    strike=await page.evaluate('(hp)=>({damage:hp-window.__mobileFoe.hp,cooldown:__hm.GAME.player.cds.slash>__hm.GAME.t})',hp)
    check(strike['damage']>0 and strike['cooldown'],tag+': learned ability tap damages the selected enemy '+json.dumps(strike))
    await page.evaluate(r"""(() => {
      const H=__hm,P=H.GAME.player;
      H.fn.removeEnt(window.__mobileFoe); P.target=null; P.combatUntil=0;
      return 0;
    })()""")
    # The former +.2m placement overlapped the herald's body. Separation and
    # wandering seed sellers could legitimately change which interaction won.
    await approach_herald(page,tag)
    await tap(page,'#t-use')
    title=await page.locator('#dlg-title').inner_text()
    check(await page.locator('#dialog').is_visible() and 'Herald' in title,tag+': Use tap speaks with the nearby herald '+json.dumps({'title':title}))
    await page.locator('#dlg-actions button:last-child').scroll_into_view_if_needed()
    await tap(page,'#dlg-actions button:last-child',closes='#dialog')
    await multitouch(page)
    check(await page.evaluate('scrollX===0 && scrollY===0'),tag+': touch controls do not scroll the page')


async def main():
    async with async_playwright() as p:
        b, page, logs = await setup(p,touch=True,w=SIZES[0][0],h=SIZES[0][1])
        page.set_default_timeout(120000)
        await page.emulate_media(reduced_motion='reduce')
        await page.evaluate(HELP)
        await page.evaluate("__hm.quality.scale=.5; dispatchEvent(new Event('resize')); 0")
        try:
            for w,h in SIZES:
                await page.set_viewport_size({'width':w,'height':h})
                await page.evaluate("([w,h])=>{const s=document.documentElement.style;s.setProperty('--safe-t','24px');s.setProperty('--safe-b','20px');s.setProperty('--safe-l',w>h?'44px':'0px');s.setProperty('--safe-r',w>h?'44px':'0px');dispatchEvent(new Event('resize'));return 0}",[w,h])
                levels = (1,) if BASELINE or KIT_ONLY else (1,50)
                for level in levels:
                    for cls in (('warrior',) if BASELINE or KIT_ONLY else CLASSES):
                        await page.evaluate('([cls,level])=>MH.scene(cls,level)',[cls,level])
                        await frame(page)
                        # The spawn-zone label is transient, and is not part of the steady-state control budget.
                        await page.evaluate("document.getElementById('zonetoast').classList.remove('on'); 0")
                        m=await page.evaluate('MH.measure()')
                        tag=f'{w}x{h} {cls} level{level}'
                        m.update({'tag':tag,'level':level,'cls':cls})
                        RESULTS.append(m)
                        print(tag+': '+json.dumps({k:m[k] for k in ('coverage','centerClear','off','slots')}),flush=True)
                        if not BASELINE:
                            check(not m['graphics']['lost'] and not m['graphics']['stopped'],tag+': layout test keeps graphics running '+json.dumps(m['graphics']))
                            check(not m['off'],tag+': all visible HUD inside safe viewport')
                            check(not m['overlaps'],tag+': no unrelated HUD controls or panels overlap '+json.dumps(m['overlaps']))
                            check(m['coverage'] <= .38,tag+': HUD covers at most 38% of reduced browser viewport')
                            check(m['centerClear'] >= .85,tag+': at least 85% of central play area clear')
                            check(not any(s['locked'] for s in m['slots']),tag+': locked abilities stay out of combat dock')
                            # Priests begin with both Mend and Smite; the other callings begin with one skill.
                            expected=8 if level==50 else (2 if cls=='priest' else 1)
                            check(len(m['slots'])==expected,tag+': all learned abilities available directly in combat')
                            primary_label={'warrior':'Slash','archer':'Quick Shot','mage':'Firebolt','priest':'Smite'}[cls]
                            check(m['primary']==[primary_label],tag+': the primary action displays its full ability name '+json.dumps(m['primary']))
                            main=m['controls']
                            check(all(c['w']>=43.5 and c['h']>=43.5 and c['top'] for c in main),tag+': primary controls have unobscured 44px tap targets '+json.dumps([c for c in main if c['w']<43.5 or c['h']<43.5 or not c['top']]))
                        if cls=='warrior':
                            await shot(page,f'mobile_{"baseline" if BASELINE else "hud"}_{w}x{h}_lv{level}')
                            if KIT_ONLY:
                                await tap(page,'#mobile-menu-toggle')
                                await more_tab(page,'character')
                                await page.locator('#btn-kit').scroll_into_view_if_needed()
                                await tap(page,'#btn-kit')
                                await kit_geometry(page,f'{w}x{h}')
                                await tap(page,'#kit-close',closes='#kit')
                            elif not BASELINE and level==1:
                                await flows(page,f'{w}x{h}')
            errors=await page.evaluate('__hm.errors')
            check(not errors and not logs,f'no game/browser errors {errors[:2]} {logs[:2]}')
        except Exception as exc:
            FAILS.append(f'{type(exc).__name__}: {exc}')
            await shot(page, 'mobile_hud_failure')
            raise
        finally:
            await b.close()
            pathlib.Path(OUT,f'mobile_{"baseline" if BASELINE else "hud"}.json').write_text(json.dumps({'results':RESULTS,'failures':FAILS},indent=2))
    print(f'{len(FAILS)} failures',flush=True)
    if FAILS:sys.exit(1)

if __name__=='__main__':
    asyncio.run(main())
