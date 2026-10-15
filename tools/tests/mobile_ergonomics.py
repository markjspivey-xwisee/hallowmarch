"""Mobile game control ergonomics, real touch flows, and persistent accessibility options.

Run after build.py: python tools/tests/mobile_ergonomics.py [quick|flowsonly] [noshots] [classes=mage] [sizes=360x640]
Screenshots without a notch suffix use the actual zero-inset browser viewport.
The existing mobile_hud.py suite separately checks all callings, levels, and legacy flows.
"""
import asyncio
import json
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import mobile_hud as hud
from hmlib import setup, OUT
from playwright.async_api import async_playwright

ARGS = sys.argv[1:]
OPT = dict(a.split('=', 1) for a in ARGS if '=' in a)
QUICK = 'quick' in ARGS
SHOTS = 'noshots' not in ARGS
FAILS = []
RESULTS = []


def check(ok, message):
    print(('PASS ' if ok else 'FAIL ') + message, flush=True)
    if not ok:
        FAILS.append(message)


HELP = r"""
window.ME = {
  geometry() {
    const visible = e => MH.shown(e) && getComputedStyle(e).pointerEvents !== 'none';
    const controls = [...document.querySelectorAll('#hud button,#hud [role="button"]')]
      .filter(visible).filter(e=>!e.closest('.tip'));
    const rects=controls.map(e=>{
      const r=e.getBoundingClientRect(),h=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);
      const label=e.querySelector('.mobile-label') || e;
      const s=getComputedStyle(label);
      return {id:e.id||(e.dataset.slot!==undefined?'skill-'+e.dataset.slot:e.className),slot:e.dataset.slot!==undefined?+e.dataset.slot:null,x:r.x,y:r.y,w:r.width,h:r.height,
        hit:!!h&&(h===e||e.contains(h)),label:e.getAttribute('aria-label')||e.textContent.trim(),
        text:label.textContent.trim(),font:parseFloat(s.fontSize),
        fontFamily:s.fontFamily,lineHeight:s.lineHeight,clientW:label.clientWidth,clientH:label.clientHeight,
        scrollW:label.scrollWidth,scrollH:label.scrollHeight,
        clipped:label.scrollWidth>label.clientWidth+1||label.scrollHeight>label.clientHeight+1};
    });
    const gaps=[];
    for(let i=0;i<controls.length;i++)for(let j=i+1;j<controls.length;j++){
      if(controls[i].contains(controls[j])||controls[j].contains(controls[i]))continue;
      const a=rects[i],b=rects[j];
      const dx=Math.max(0,a.x-b.x-b.w,b.x-a.x-a.w),dy=Math.max(0,a.y-b.y-b.h,b.y-a.y-a.h);
      const gap=Math.hypot(dx,dy);
      if(gap<7.5)gaps.push({a:a.id,b:b.id,gap});
    }
    const primary=document.querySelector('#tpad .mobile-main-action [data-slot],#tpad [data-slot].mobile-main-action');
    const p=primary?.getBoundingClientRect();
    const secondary=[...document.querySelectorAll('#tpad .mobile-skills [data-slot]')].filter(visible);
    const utilities=[...document.querySelectorAll('#tpad .mobile-utility button')].filter(visible);
    // Project a standing body's head, torso and feet, including 0.35m on each
    // camera-facing side. A broad empty-screen percentage can hide body occlusion.
    const P=__hm.GAME.player,points=[],matrix=__hm.camera.matrixWorld.elements;
    if(P)for(const height of [2,1,.1])for(const side of [-1,0,1]){
      points.push(__hm.fn.screenOf(P.x+matrix[0]*.35*side,P.y+height+matrix[1]*.35*side,P.z+matrix[2]*.35*side));
    }
    const inView=points.length===9&&points.every(q=>q&&q.x>=0&&q.x<=innerWidth&&q.y>=0&&q.y<=innerHeight);
    let body=null,covered=[];
    if(inView){
      const xs=points.map(q=>q.x),ys=points.map(q=>q.y),x=Math.min(...xs)-2,y=Math.min(...ys)-2;
      body={x,y,w:Math.max(...xs)+2-x,h:Math.max(...ys)+2-y};
      covered=rects.filter((r,i)=>{
        if(!controls[i].closest('#tpad'))return false;
        const dx=Math.min(body.x+body.w,r.x+r.w)-Math.max(body.x,r.x);
        const dy=Math.min(body.y+body.h,r.y+r.h)-Math.max(body.y,r.y);
        return dx>.5&&dy>.5;
      });
    }
    return {controls:rects,gaps,avatar:{inView,body,points,covered},primary:p?{slot:+primary.dataset.slot,x:p.x,y:p.y,w:p.width,h:p.height,label:primary.getAttribute('aria-label')}:null,
      secondary:secondary.map(e=>+e.dataset.slot),utilities:utilities.map(e=>e.id),
      left:document.body.classList.contains('mobile-left-handed'),large:document.body.classList.contains('mobile-large-ui'),
      measure:MH.measure()};
  },
  prefs(prefs) {
    __hm.mobile.applyPrefs(prefs); __hm.mobile.state.t=0;
    MH.lay();return 0;
  }
};
0;
"""


async def tap(page, selector, tag=''):
    await page.locator(selector).first.scroll_into_view_if_needed()
    r = await page.locator(selector).first.evaluate(r"""e=>{
      const r=e.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2,h=document.elementFromPoint(x,y);
      return {x,y,w:r.width,h:r.height,hit:!!h&&(h===e||e.contains(h)),shown:MH.shown(e)};
    }""")
    check(r['shown'] and r['hit'] and r['w'] >= 47.5 and r['h'] >= 47.5,
          tag + f' real 48px touch target {selector} ' + json.dumps(r))
    if not r['shown'] or not r['hit']:
        return False
    await page.touchscreen.tap(r['x'], r['y'])
    await page.wait_for_function('!(window.__hm.guide2 && __hm.guide2.G2.tap.pending)', timeout=15000)
    return True


async def shot(page, name):
    if SHOTS:
        await page.screenshot(path=OUT + name + '.png', timeout=300000)


async def touch_cdp(page):
    # Retain one input session until browser close. Detaching an emulation session
    # can clear Chromium's touch capability override before a navigation.
    if not hasattr(page,'_mobile_ergonomics_cdp'):
        page._mobile_ergonomics_cdp=await page.context.new_cdp_session(page)
    return page._mobile_ergonomics_cdp


async def touch_move_and_hold(page, left):
    """Dispatches two genuine touch points in the selected movement/action hands."""
    at = await page.evaluate(r"""left=>{
      const e=document.querySelector('#tpad .cls-btn.hold'),r=e.getBoundingClientRect();
      return {hold:{x:r.x+r.width/2,y:r.y+r.height/2,id:2},
        move:{x:innerWidth*(left?.85:.15),y:innerHeight*.78,id:1}};
    }""", left)
    cdp = await touch_cdp(page)
    move, hold = at['move'], at['hold']
    try:
        await cdp.send('Input.dispatchTouchEvent', {'type':'touchStart','touchPoints':[move]})
        moved = {**move, 'x':move['x']+(-24 if left else 24), 'y':move['y']-24}
        await cdp.send('Input.dispatchTouchEvent', {'type':'touchMove','touchPoints':[moved]})
        await cdp.send('Input.dispatchTouchEvent', {'type':'touchStart','touchPoints':[moved,hold]})
        st = await page.evaluate('({joy:!!__hm.INPUT.joy,dx:__hm.INPUT.joy?.dx,block:__hm.cls.state().block,held:__hm.cls.CLS.hold})')
        check(st['joy'] and abs(st['dx']) > .1 and st['block'] and st['held'],
              f'{"left" if left else "right"} action hand: movement and Block work with two fingers {st}')
    finally:
        await cdp.send('Input.dispatchTouchEvent', {'type':'touchEnd','touchPoints':[]})
    st = await page.evaluate('({joy:!!__hm.INPUT.joy,held:__hm.cls.CLS.hold,block:__hm.cls.state().block})')
    check(not st['joy'] and not st['held'] and not st['block'],f'both fingers release without stuck input {st}')


async def touch_camera(page, left):
    at=await page.evaluate(r"""left=>{
      for(const fy of [.4,.5,.3])for(const fx of (left?[.15,.25,.35]:[.85,.75,.65])){
        const x=innerWidth*fx,y=innerHeight*fy;
        if(document.elementFromPoint(x,y)?.tagName==='CANVAS')return {x,y,id:1};
      }
      return null;
    }""",left)
    check(bool(at),f'{"left" if left else "right"} action hand has an unobstructed camera touch area')
    if not at:
        return
    before=await page.evaluate('({yaw:__hm.CAM.yaw,pitch:__hm.CAM.pitch})')
    cdp=await touch_cdp(page)
    try:
        await cdp.send('Input.dispatchTouchEvent',{'type':'touchStart','touchPoints':[at]})
        await cdp.send('Input.dispatchTouchEvent',{'type':'touchMove','touchPoints':[{**at,'x':at['x']+18,'y':at['y']+12}]})
        await hud.frame(page)
        after=await page.evaluate('({yaw:__hm.CAM.yaw,pitch:__hm.CAM.pitch,joy:!!__hm.INPUT.joy})')
        check(not after['joy'] and (abs(after['yaw']-before['yaw'])>.005 or abs(after['pitch']-before['pitch'])>.005),
              f'{"left" if left else "right"} action hand camera gesture rotates view without starting movement {after}')
    finally:
        await cdp.send('Input.dispatchTouchEvent',{'type':'touchEnd','touchPoints':[]})


async def menu_flows(page):
    before = await page.evaluate('ME.geometry()')
    await page.keyboard.down('w')
    try:
        check(await page.evaluate('__hm.INPUT.keys.size>0'),
              'keyboard movement starts before a modal transition')
        await tap(page,'#mobile-menu-toggle','Rapid modal open')
        await tap(page,'#mobile-tray-close','Rapid modal close')
        stopped=await page.evaluate('({keys:__hm.INPUT.keys.size>0,joy:!!__hm.INPUT.joy,look:!!__hm.INPUT.look,hold:!!__hm.cls.CLS.hold,modal:__hm.UI.modal})')
        check(not stopped['keys'] and not stopped['joy'] and not stopped['look'] and not stopped['hold'] and not stopped['modal'],
              'opening and immediately closing More releases previously held movement '+json.dumps(stopped))
    finally:
        await page.keyboard.up('w')
    await tap(page, '#mobile-menu-toggle', 'More')
    tab_y = None
    for section in ('world','character','social','options'):
        await tap(page, f'[data-mobile-tab="{section}"]', section)
        state = await page.evaluate(r"""section=>{
          const tabs=[...document.querySelectorAll('[data-mobile-tab]')];
          const selected=tabs.filter(e=>e.getAttribute('aria-selected')==='true');
          const wrong=[...document.querySelectorAll('#mobile-tray [data-mobile-section]')]
            .filter(e=>MH.shown(e)&&!e.dataset.mobileSection.split(/\s+/).includes(section)).map(e=>e.id||e.dataset.mobileSection);
          return {section:document.getElementById('mobile-tray').dataset.section,
            selected:selected.map(e=>e.dataset.mobileTab),roles:tabs.every(e=>e.getAttribute('role')==='tab'),wrong,
            tabY:tabs[0].getBoundingClientRect().y+tabs[0].getBoundingClientRect().height/2,
            modal:__hm.UI.modal,joy:!!__hm.INPUT.joy};
        }""", section)
        check(state['section']==section and state['selected']==[section] and state['roles'] and not state['wrong'],
              f'{section} tab exposes its own organized section and accessible selection {state}')
        check(state['modal']=='mobile' and not state['joy'],f'{section} tab keeps gameplay input suspended')
        if tab_y is None:
            tab_y = state['tabY']
        check(abs(state['tabY']-tab_y)<=1,f'{section} tab navigation stays in the same screen position {state["tabY"]}')
        if section=='options':
            await shot(page,'mobile_ergonomics_menu_options_393x660')
    # Native select controls use Playwright's standard selection action; no game/debug setter is used.
    preferences={'mobile-pref-hand':'left','mobile-pref-size':'large','mobile-pref-text':'large','mobile-pref-names':'relevant'}
    option_geometry=await page.evaluate(r"""()=>[...document.querySelectorAll('#mobile-tray select')].filter(e=>MH.shown(e)).map(e=>{
      const r=e.getBoundingClientRect(),s=getComputedStyle(e);
      return {id:e.id,w:r.width,h:r.height,font:parseFloat(s.fontSize)};
    })""")
    check(len(option_geometry)==4 and all(e['w']>=48 and e['h']>=48 and e['font']>=16 for e in option_geometry),
          'preference controls have 48px touch targets and 16px text that avoids iOS focus zoom '+json.dumps(option_geometry))
    for control, value in preferences.items():
        await page.locator('#'+control).select_option(value)
    await hud.frame(page)
    state = await page.evaluate(r"""()=>({
      stored:JSON.parse(localStorage.getItem('hm_mobile_controls_v1')),
      left:document.body.classList.contains('mobile-left-handed'),
      large:document.body.classList.contains('mobile-large-ui'),
      text:document.body.classList.contains('mobile-large-text')})""")
    check(state['stored']=={'hand':'left','size':'large','text':'large','names':'relevant'}
          and state['left'] and state['large'] and state['text'],
          'real preference controls update appearance and persist all four choices '+json.dumps(state))
    await tap(page, '#mobile-tray-close', 'Options')
    await hud.frame(page)
    after = await page.evaluate('ME.geometry()')
    check(after['primary']['w'] > before['primary']['w'] and after['primary']['h'] > before['primary']['h'],
          'Large controls visibly enlarge the main action')
    check(min(c['font'] for c in after['controls'] if c['text']) >= min(c['font'] for c in before['controls'] if c['text']),
          'Large text does not reduce any core action label')
    await touch_move_and_hold(page, True)
    await touch_camera(page,True)
    await shot(page,'mobile_ergonomics_left_large_393x660')
    # A real reload proves initialization restores the saved controls, not just an in-memory object.
    await page.reload(wait_until='commit')
    await page.wait_for_function('window.__hm && __hm.ready', timeout=180000, polling=500)
    # Mobile controls initialize when a character enters the world, after the title screen.
    await page.evaluate(hud.HELP)
    await page.evaluate("MH.scene('warrior',1);0")
    await hud.frame(page)
    restored = await page.evaluate(r"""()=>({
      hand:document.body.classList.contains('mobile-left-handed'),
      size:document.body.classList.contains('mobile-large-ui'),
      text:document.body.classList.contains('mobile-large-text'),
      body:document.body.className,prefs:__hm.mobile.prefs,bound:__hm.mobile.state.bound,
      hud:__hm.UI.hudBound,player:!!__hm.GAME.player,control:document.getElementById('mobile-pref-hand')?.value,
      coarse:matchMedia('(pointer: coarse)').matches,maxTouchPoints:navigator.maxTouchPoints,ontouchstart:'ontouchstart' in window,
      stored:JSON.parse(localStorage.getItem('hm_mobile_controls_v1'))})""")
    check(restored['hand'] and restored['size'] and restored['text'] and restored['stored']==state['stored'],
          'handedness, control size, text size and name settings survive a real reload '+json.dumps(restored))


async def main():
    async with async_playwright() as p:
        b,page,logs = await setup(p,touch=True,w=393,h=660)
        page.set_default_timeout(120000)
        await page.emulate_media(reduced_motion='reduce')
        await page.evaluate(hud.HELP)
        await page.evaluate(HELP)
        await page.evaluate("__hm.quality.scale=.5; dispatchEvent(new Event('resize')); 0")
        try:
            sizes=[(360,640),(393,660),(390,780),(844,390)]
            scenes=[('warrior',1),('warrior',50),('archer',50),('mage',50),('priest',50)]
            modes=[(hand,size,text) for hand in ('right','left') for size in ('standard','large') for text in ('standard','large')]
            if QUICK:
                sizes=[(360,640),(844,390)]
                scenes=[('mage',50),('priest',50)]
                modes=[('right','standard','standard'),('left','large','standard'),('right','standard','large'),('left','large','large')]
            if 'sizes' in OPT:
                sizes=[tuple(map(int,s.split('x'))) for s in OPT['sizes'].split(',')]
            if 'classes' in OPT:
                scenes=[s for s in scenes if s[0] in OPT['classes'].split(',')]
            if 'flowsonly' in ARGS:
                sizes=[]
                await page.evaluate("MH.scene('warrior',50);ME.prefs({hand:'right',size:'standard',text:'standard',names:'relevant'});0")
                await hud.frame(page)
            for w,h in sizes:
                await page.set_viewport_size({'width':w,'height':h})
                # No invented notch padding in the actual-viewport proof screenshots.
                await page.evaluate("const s=document.documentElement.style; for(const k of ['t','b','l','r'])s.setProperty('--safe-'+k,'0px'); dispatchEvent(new Event('resize'));0")
                for cls,level in scenes:
                    await page.evaluate('([c,l])=>MH.scene(c,l)',[cls,level])
                    for hand,size,text in modes:
                        await page.evaluate('p=>ME.prefs(p)',{'hand':hand,'size':size,'text':text,'names':'relevant'})
                        await hud.frame(page)
                        await page.evaluate("document.getElementById('zonetoast').classList.remove('on');0")
                        m=await page.evaluate('ME.geometry()')
                        tag=f'{w}x{h} {cls} lv{level} {hand} {size} text-{text}'
                        RESULTS.append({'tag':tag,**m})
                        check(not m['measure']['off'],tag+': safe viewport bounds '+json.dumps(m['measure']['off']))
                        check(not m['measure']['overlaps'],tag+': no unrelated HUD collisions '+json.dumps(m['measure']['overlaps']))
                        check(m['avatar']['inView'],tag+': projected avatar head, torso and feet remain visible')
                        check(m['avatar']['inView'] and not m['avatar']['covered'],tag+': combat controls leave the avatar body and feet clear '+json.dumps({'body':m['avatar']['body'],'covered':m['avatar']['covered']}))
                        bad=[r for r in m['controls'] if r['w']<47.5 or r['h']<47.5 or not r['hit']]
                        check(not bad,tag+': visible controls are 48px and hit-testable '+json.dumps(bad))
                        check(not m['gaps'],tag+': controls have at least 8px separation '+json.dumps(m['gaps']))
                        primary=m['primary']
                        check(bool(primary and primary['w']>=63.5 and primary['h']>=63.5),tag+': dominant primary action is at least 64px '+json.dumps(primary))
                        if primary:
                            check(primary['slot']==0,tag+': primary action maps to the calling attack')
                            check((primary['x']+primary['w']/2< w/2)==(hand=='left'),tag+': action dock respects selected hand')
                        learned=8 if level==50 else 1
                        check(len(m['secondary'])==learned-1,tag+': every learned secondary ability remains directly available')
                        labels=[r for r in m['controls'] if r['slot'] is not None]
                        bad_labels=[r for r in labels if r['font']<12 or not r['text'] or r['clipped']]
                        check(not bad_labels,tag+': learned ability labels are readable and complete '+json.dumps(bad_labels))
                        check(m['measure']['centerClear']>=.85,tag+': at least 85% of central play area stays clear')
                        if (QUICK and h>w and cls=='priest') or (cls=='warrior' and (level==1 or size=='large' and hand=='left')):
                            suffix='_textlarge' if text=='large' else ''
                            await shot(page,f'mobile_ergonomics_{w}x{h}_{cls}_lv{level}_{hand}_{size}'+suffix)
            # Notch/inset simulation is explicit and separate from proof of the real browser viewport.
            await page.set_viewport_size({'width':844,'height':390})
            await page.evaluate("const s=document.documentElement.style;s.setProperty('--safe-l','44px');s.setProperty('--safe-r','44px');s.setProperty('--safe-t','0px');s.setProperty('--safe-b','20px');dispatchEvent(new Event('resize'));0")
            await hud.frame(page)
            notch=await page.evaluate('ME.geometry()')
            check(not notch['measure']['off'],'landscape notch simulation keeps controls within 44px side and 20px bottom insets '+json.dumps(notch['measure']['off']))
            await shot(page,'mobile_ergonomics_844x390_notch_simulation')
            await page.set_viewport_size({'width':393,'height':660})
            await page.evaluate("const s=document.documentElement.style;for(const k of ['t','b','l','r'])s.setProperty('--safe-'+k,'0px');dispatchEvent(new Event('resize'));0")
            await page.evaluate("MH.scene('warrior',1);ME.prefs({hand:'right',size:'standard',text:'standard',names:'relevant'});0")
            await hud.frame(page)
            await touch_move_and_hold(page,False)
            await touch_camera(page,False)
            await menu_flows(page)
            errors=await page.evaluate('__hm.errors')
            check(not errors and not logs,f'no browser/game errors {errors[:2]} {logs[:2]}')
        except Exception as exc:
            FAILS.append(f'{type(exc).__name__}: {exc}')
            await shot(page,'mobile_ergonomics_failure')
            raise
        finally:
            await b.close()
            pathlib.Path(OUT,'mobile_ergonomics.json').write_text(json.dumps({'results':RESULTS,'failures':FAILS},indent=2))
    print(f'{len(FAILS)} failures',flush=True)
    if FAILS:
        sys.exit(1)


if __name__=='__main__':
    asyncio.run(main())
