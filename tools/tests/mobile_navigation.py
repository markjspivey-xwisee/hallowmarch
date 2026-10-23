"""Focused phone navigation regression: edge use, direct destinations, and modal input.

Run after build.py: python3 tools/tests/mobile_navigation.py [noshots]
One scene is reused while resizing between a short browser tab, a tall phone,
a small phone, and landscape. Every navigation action uses a real touch.
"""
import asyncio
import json
import pathlib
import sys
import time

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import mobile_hud as hud
from mobile_ergonomics import wait_for_viewport
from hmlib import OUT, setup, human_play
from playwright.async_api import async_playwright

SHOTS = 'noshots' not in sys.argv[1:]
NOTES_ONLY = 'only=notes' in sys.argv[1:]
SIZES = [(393, 668), (393, 852), (320, 568), (852, 393)]
FAILS = []
RESULTS = []
NAV = {
    'mobile-inventory': 'Inventory',
    'mobile-skills': 'Skills',
    'mobile-map': 'Map',
    'mobile-notes': 'Notes',
    'mobile-menu-toggle': 'Menu',
}


def check(ok, message):
    print(('PASS ' if ok else 'FAIL ') + message, flush=True)
    if not ok:
        FAILS.append(message)


HELP = r"""
window.MN = {
  input() {
    const H=__hm,P=H.GAME.player;
    return {keys:H.INPUT.keys.size,joy:!!H.INPUT.joy,look:!!H.INPUT.look,
      pointers:H.INPUT.pointers.size,hold:!!H.cls.CLS.hold,
      modal:H.UI.modal,x:P.x,z:P.z};
  },
  box(el) {
    if(!MH.shown(el))return null;
    const r=el.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2;
    const hit=document.elementFromPoint(x,y),label=el.querySelector('span:last-of-type')||el;
    return {x:r.x,y:r.y,w:r.width,h:r.height,cx:x,cy:y,
      hit:!!hit&&(hit===el||el.contains(hit)),text:el.textContent.trim(),
      clipped:label.scrollWidth>label.clientWidth+1||label.scrollHeight>label.clientHeight+1};
  },
  geometry() {
    MH.lay();
    const root=document.documentElement,probe=document.createElement('div');
    probe.style.cssText='position:fixed;visibility:hidden;padding:var(--safe-t,0px) var(--safe-r,0px) var(--safe-b,0px) var(--safe-l,0px)';
    document.body.appendChild(probe);
    const css=getComputedStyle(probe),n=k=>parseFloat(css[k])||0;
    const safe={t:n('paddingTop'),r:n('paddingRight'),b:n('paddingBottom'),l:n('paddingLeft')};
    probe.remove();
    const canvas=__hm.dbg.renderer.domElement.getBoundingClientRect();
    const nav=this.box(document.getElementById('mobile-nav'));
    const pf=this.box(document.getElementById('pf'));
    const buttons=[...document.querySelectorAll('#mobile-nav button')].map(e=>({id:e.id,...this.box(e)}));
    const actionRects=[...document.querySelectorAll('#tpad button')].filter(e=>MH.shown(e)).map(e=>this.box(e));
    return {w:innerWidth,h:innerHeight,vw:visualViewport.width,vh:visualViewport.height,safe,
      canvas:{x:canvas.x,y:canvas.y,w:canvas.width,h:canvas.height},nav,pf,buttons,actionRects,
      scrollX:Math.max(root.scrollWidth,document.body.scrollWidth)-innerWidth,
      scrollY:Math.max(root.scrollHeight,document.body.scrollHeight)-innerHeight,
      viewportMeta:document.querySelector('meta[name="viewport"]').content,
      immersive:!!document.fullscreenElement||matchMedia('(display-mode: standalone), (display-mode: fullscreen)').matches,
      uiViewport:parseFloat(getComputedStyle(root).getPropertyValue('--mobile-vh'))};
  }
};0;
"""


async def shot(page, name):
    if SHOTS:
        await page.screenshot(path=OUT + name + '.png', timeout=300000)


async def tap(page, selector, tag):
    # No scroll_into_view: the navigation bar, tabs, and close buttons must
    # already be on screen, including on the 320px and landscape viewports.
    box = await page.evaluate('s=>MN.box(document.querySelector(s))', selector)
    good = bool(box and box['hit'] and box['w'] >= 47.5 and box['h'] >= 47.5)
    check(good, f'{tag}: reachable 48px target {selector} ' + json.dumps(box))
    if not good:
        raise AssertionError(f'{tag}: cannot touch {selector}')
    await page.touchscreen.tap(box['cx'], box['cy'])
    await page.wait_for_function(
        '!(window.__hm.guide2 && __hm.guide2.G2.tap.pending)', timeout=15000)


async def geometry(page, tag):
    m = await page.evaluate('MN.geometry()')
    RESULTS.append({'tag': tag, **m})
    safe, nav, pf = m['safe'], m['nav'], m['pf']
    c = m['canvas']
    check(abs(c['x']) <= 1 and abs(c['y']) <= 1 and
          abs(c['w'] - m['vw']) <= 1 and abs(c['h'] - m['vh']) <= 1,
          tag + ': game canvas fills the visible browser viewport ' + json.dumps(c))
    check(m['scrollX'] <= 1 and m['scrollY'] <= 1,
          tag + ': page has no horizontal or vertical overflow')
    check(abs(m['uiViewport'] - m['vh']) <= 1,
          tag + ': HUD uses the current visual viewport height')
    check(not m['immersive'] and 'viewport-fit=auto' in m['viewportMeta'],
          tag + ': the actual browser tab uses viewport-fit=auto ' + m['viewportMeta'])
    check(bool(pf and safe['t'] - 1 <= pf['y'] <= safe['t'] + 16),
          tag + ': player HUD starts near the usable top edge ' + json.dumps(pf))
    landscape_nav = m['w'] > 600 and m['w'] > m['h'] and m['h'] <= 520
    edge_gap = nav['y'] - safe['t'] if landscape_nav and nav else (
        m['h'] - safe['b'] - nav['y'] - nav['h'] if nav else None)
    edge = 'top' if landscape_nav else 'bottom'
    check(edge_gap is not None and 0 <= edge_gap <= 16,
          tag + ': navigation uses the usable ' + edge + ' edge without extra padding ' + json.dumps(nav))
    buttons = m['buttons']
    check({b['id'] for b in buttons} == set(NAV),
          tag + ': Inventory, Skills, Map, Notes and Menu are present in permanent navigation')
    bad = [b for b in buttons if not b.get('hit') or b.get('w', 0) < 47.5 or
           b.get('h', 0) < 47.5 or b.get('clipped') or NAV.get(b['id'], '') not in b.get('text', '') or
           b['x'] < safe['l'] - 1 or b['x'] + b['w'] > m['w'] - safe['r'] + 1 or
           b['y'] < safe['t'] - 1 or b['y'] + b['h'] > m['h'] - safe['b'] + 1]
    check(not bad, tag + ': all five labelled destinations fit and accept a touch ' + json.dumps(bad))
    ordered = sorted(buttons, key=lambda b: b.get('x', 0))
    gaps = [b['x'] - a['x'] - a['w'] for a, b in zip(ordered, ordered[1:])]
    check(len(gaps) == 4 and min(gaps) >= 7.5,
          tag + ': destination buttons have at least 8px separation ' + json.dumps(gaps))
    collisions = [r for r in m['actionRects'] if nav and
                  min(r['x'] + r['w'], nav['x'] + nav['w']) > max(r['x'], nav['x']) + 1 and
                  min(r['y'] + r['h'], nav['y'] + nav['h']) > max(r['y'], nav['y']) + 1]
    check(not collisions, tag + ': combat controls leave permanent navigation clear ' + json.dumps(collisions))
    await shot(page, 'mobile_navigation_' + tag.replace(' ', '_'))


async def double_tap(page):
    """Two genuine taps retain two activations while the fallback cancels zoom."""
    before = await page.evaluate(r"""()=>{
      const target=document.getElementById('t-target');
      const snapshot=()=>{
        const s=__hm.mobile.touchNoZoom;
        return s?{bound:s.bound,blocked:s.blocked,clicks:s.clicks,last:s.last,
          active:s.active?{id:s.active.id,at:s.active.at,x:s.active.x,y:s.active.y}:null}:null;
      };
      const audit={clicks:[],starts:[],ends:[]};
      const handler=e=>audit.clicks.push({trusted:e.isTrusted,pointerType:e.pointerType,stamp:e.timeStamp,handledAt:performance.now()});
      const start=e=>audit.starts.push({trusted:e.isTrusted,stamp:e.timeStamp,handledAt:performance.now(),state:snapshot()});
      const end=e=>audit.ends.push({trusted:e.isTrusted,stamp:e.timeStamp,handledAt:performance.now(),
        prevented:e.defaultPrevented,cancelable:e.cancelable,state:snapshot()});
      target.addEventListener('click',handler);
      window.addEventListener('touchstart',start,{passive:true});
      window.addEventListener('touchend',end,{passive:true});
      window.__mobileDoubleTapAudit={audit,handler,start,end,target};
      return {scale:visualViewport.scale,x:scrollX,y:scrollY,
        box:MN.box(target),meta:document.querySelector('meta[name="viewport"]').content,
        touch:{html:getComputedStyle(document.documentElement).touchAction,
          body:getComputedStyle(document.body).touchAction,
          navigation:getComputedStyle(document.getElementById('mobile-inventory')).touchAction,
          target:getComputedStyle(target).touchAction}};
    }""")
    touch = before['touch']
    check(touch['html'] == 'manipulation' and touch['body'] == 'manipulation' and
          touch['navigation'] == 'manipulation' and touch['target'] in ('none', 'manipulation'),
          'double-tap zoom is disabled on the page and touch controls ' + json.dumps(touch))
    check('maximum-scale' not in before['meta'].lower() and
          'user-scalable=no' not in before['meta'].lower().replace(' ', ''),
          'viewport metadata keeps pinch zoom available without a maximum-scale restriction')
    box = before['box']
    check(bool(box and box['hit']), 'Target is directly reachable for the real double tap')
    try:
        if not box or not box['hit']:
            raise AssertionError('cannot reach Target for double-tap regression')
        if not hasattr(page, '_mobile_navigation_cdp'):
            page._mobile_navigation_cdp = await page.context.new_cdp_session(page)
        cdp = page._mobile_navigation_cdp
        # Replay a genuine input gesture with 40ms taps and a 60ms gap. CDP's
        # physical input timestamps keep renderer/transport delays from turning
        # this rapid gesture into an unrelated pair of slow taps. The browser
        # still delivers trusted TouchEvents and its normal native click path.
        base = time.time()
        point = {'x': box['cx'], 'y': box['cy'], 'id': 1}
        for kind, offset in [('touchStart', 0), ('touchEnd', .04),
                             ('touchStart', .10), ('touchEnd', .14)]:
            await cdp.send('Input.dispatchTouchEvent', {
                'type': kind, 'touchPoints': [point] if kind == 'touchStart' else [],
                'timestamp': base + offset})
        await page.wait_for_timeout(350)  # allow the browser's tap/zoom recognizer to settle
        after = await page.evaluate(r"""()=>({scale:visualViewport.scale,x:scrollX,y:scrollY,
          clicks:window.__mobileDoubleTapAudit.audit.clicks,starts:window.__mobileDoubleTapAudit.audit.starts,
          ends:window.__mobileDoubleTapAudit.audit.ends,input:MN.input(),
          inventory:MN.box(document.getElementById('mobile-inventory'))})""")
        print('TOUCH TIMING ' + json.dumps({k: after[k] for k in ('starts', 'ends', 'clicks')}), flush=True)
        check(len(after['starts']) == 2 and len(after['ends']) == 2 and
              all(0 <= end['stamp'] - start['stamp'] <= 300
                  for start, end in zip(after['starts'], after['ends'])) and
              0 <= after['ends'][1]['stamp'] - after['ends'][0]['stamp'] <= 350,
              'trusted input timestamps describe two short taps inside the double-tap window')
        check(len(after['clicks']) == 2 and after['clicks'][0]['trusted'] and not after['clicks'][1]['trusted'],
              'two genuine taps produce one native and exactly one replacement Target activation ' + json.dumps(after['clicks']))
        check(len(after['ends']) == 2 and all(e['trusted'] for e in after['ends']) and
              not after['ends'][0]['prevented'] and after['ends'][1]['prevented'],
              'the fallback cancels only the second genuine tap default ' + json.dumps(after['ends']))
        check(abs(after['scale'] - before['scale']) < 1e-6 and
              after['x'] == before['x'] and after['y'] == before['y'],
              'a real double tap preserves viewport scale and page scroll ' +
              json.dumps({'before': {k: before[k] for k in ('scale', 'x', 'y')},
                          'after': {k: after[k] for k in ('scale', 'x', 'y')}}))
        check(not after['input']['modal'] and not after['input']['joy'] and
              not after['input']['look'] and bool(after['inventory'] and after['inventory']['hit']),
              'double tapping leaves gameplay input clear and navigation reachable')
    finally:
        await page.evaluate(r"""()=>{
          const a=window.__mobileDoubleTapAudit;
          if(a){a.target.removeEventListener('click',a.handler);window.removeEventListener('touchstart',a.start);window.removeEventListener('touchend',a.end);}
          delete window.__mobileDoubleTapAudit;
        }""")


async def touch_fallback_exclusions(page):
    """Actual drag, multiple fingers, long press, cancel and forms stay native."""
    at = await page.evaluate(r"""()=>{
      const probe=document.createElement('div');probe.id='mobile-doubletap-probe';
      probe.style.cssText='position:fixed;left:12px;top:160px;z-index:100000;background:#15191f;padding:8px';
      probe.innerHTML='<button id="mobile-doubletap-button" type="button" style="width:164px;height:48px">Gesture test</button><form><button id="mobile-doubletap-native" type="button" style="width:164px;height:48px">Native form</button></form>';
      document.body.appendChild(probe);
      const audit={ends:[],clicks:[]};
      const end=e=>{if(probe.contains(e.target))audit.ends.push({id:e.target.id,prevented:e.defaultPrevented,trusted:e.isTrusted});};
      const click=e=>audit.clicks.push({id:e.target.id,trusted:e.isTrusted});
      window.addEventListener('touchend',end,{passive:true});probe.addEventListener('click',click);
      window.__mobileGestureAudit={probe,audit,end,click};
      const b=MN.box(document.getElementById('mobile-doubletap-button')),f=MN.box(document.getElementById('mobile-doubletap-native'));
      return {button:{x:b.cx,y:b.cy,id:1},form:{x:f.cx,y:f.cy,id:1}};
    }""")
    if not hasattr(page, '_mobile_navigation_cdp'):
        page._mobile_navigation_cdp = await page.context.new_cdp_session(page)
    cdp = page._mobile_navigation_cdp
    point = at['button']

    async def audit_case(name):
        result = await page.evaluate('window.__mobileGestureAudit.audit')
        check(bool(result['ends']) and all(e['trusted'] and not e['prevented'] for e in result['ends']) and
              all(e['trusted'] for e in result['clicks']),
              name + ': touch defaults remain native and no replacement click leaks ' + json.dumps(result))
        await page.evaluate('window.__mobileGestureAudit.audit.ends.length=0;window.__mobileGestureAudit.audit.clicks.length=0;0')

    try:
        await page.touchscreen.tap(point['x'], point['y'])
        await cdp.send('Input.dispatchTouchEvent', {'type': 'touchStart', 'touchPoints': [point]})
        moved = {**point, 'x': point['x'] + 22}
        await cdp.send('Input.dispatchTouchEvent', {'type': 'touchMove', 'touchPoints': [moved]})
        await cdp.send('Input.dispatchTouchEvent', {'type': 'touchEnd', 'touchPoints': []})
        await page.touchscreen.tap(point['x'], point['y'])
        await audit_case('A drag exceeding 10px resets the double-tap pair')

        await cdp.send('Input.dispatchTouchEvent', {'type': 'touchStart',
                       'touchPoints': [point, {**point, 'x': point['x'] + 20, 'id': 2}]})
        await cdp.send('Input.dispatchTouchEvent', {'type': 'touchEnd', 'touchPoints': []})
        await page.touchscreen.tap(point['x'], point['y'])
        await audit_case('A two-finger gesture resets the double-tap pair')

        await cdp.send('Input.dispatchTouchEvent', {'type': 'touchStart', 'touchPoints': [point]})
        await page.wait_for_timeout(325)  # exceeds the fallback's short-tap duration
        await cdp.send('Input.dispatchTouchEvent', {'type': 'touchEnd', 'touchPoints': []})
        await page.touchscreen.tap(point['x'], point['y'])
        await audit_case('A long press resets the double-tap pair')

        await cdp.send('Input.dispatchTouchEvent', {'type': 'touchStart', 'touchPoints': [point]})
        await cdp.send('Input.dispatchTouchEvent', {'type': 'touchCancel', 'touchPoints': []})
        await page.touchscreen.tap(point['x'], point['y'])
        await audit_case('A canceled touch resets the double-tap pair')

        native = at['form']
        await page.touchscreen.tap(native['x'], native['y'])
        await page.wait_for_timeout(60)
        await page.touchscreen.tap(native['x'], native['y'])
        await audit_case('Two quick taps inside a native form are excluded')
    finally:
        await page.evaluate(r"""()=>{
          const a=window.__mobileGestureAudit;
          if(a){window.removeEventListener('touchend',a.end);a.probe.removeEventListener('click',a.click);a.probe.remove();}
          delete window.__mobileGestureAudit;
        }""")


async def map_double_tap(page):
    """Rapid map taps retain both coordinate-bearing canvas click events."""
    await tap(page, '#mobile-map', 'Map rapid taps')
    before = await page.evaluate(r"""()=>{
      const target=document.getElementById('mapcanvas'),r=target.getBoundingClientRect();
      const x=r.left+r.width*.43,y=r.top+r.height*.47;
      const audit={clicks:[],ends:[]};
      const click=e=>audit.clicks.push({trusted:e.isTrusted,x:e.clientX,y:e.clientY,
        modal:__hm.UI.modal});
      const end=e=>{if(e.target===target)audit.ends.push({trusted:e.isTrusted,
        prevented:e.defaultPrevented});};
      target.addEventListener('click',click);
      window.addEventListener('touchend',end,{passive:true});
      window.__mobileMapTapAudit={target,audit,click,end};
      return {x,y,hit:document.elementFromPoint(x,y)===target,
        scale:visualViewport.scale,scrollX,scrollY};
    }""")
    check(before['hit'], 'Map canvas is directly reachable for rapid touch input')
    try:
        if not before['hit']:
            raise AssertionError('cannot reach map canvas for rapid-tap regression')
        if not hasattr(page, '_mobile_navigation_cdp'):
            page._mobile_navigation_cdp = await page.context.new_cdp_session(page)
        cdp = page._mobile_navigation_cdp
        base = time.time()
        point = {'x': before['x'], 'y': before['y'], 'id': 1}
        for kind, offset in [('touchStart', 0), ('touchEnd', .04),
                             ('touchStart', .10), ('touchEnd', .14)]:
            await cdp.send('Input.dispatchTouchEvent', {
                'type': kind, 'touchPoints': [point] if kind == 'touchStart' else [],
                'timestamp': base + offset})
        await page.wait_for_timeout(350)
        after = await page.evaluate(r"""()=>({
          ...window.__mobileMapTapAudit.audit,scale:visualViewport.scale,
          scrollX,scrollY,input:MN.input()})""")
        clicks = after['clicks']
        check(len(clicks) == 2 and clicks[0]['trusted'] and not clicks[1]['trusted'],
              'two rapid map taps deliver one native and one replacement canvas click ' + json.dumps(clicks))
        check(len(clicks) == 2 and all(abs(e['x'] - before['x']) <= 1.5 and
              abs(e['y'] - before['y']) <= 1.5 and e['modal'] == 'map' for e in clicks),
              'both map clicks preserve the tapped coordinates for campaign orders ' + json.dumps(clicks))
        check(len(after['ends']) == 2 and all(e['trusted'] for e in after['ends']) and
              not after['ends'][0]['prevented'] and after['ends'][1]['prevented'],
              'map rapid taps cancel only the second native default ' + json.dumps(after['ends']))
        check(abs(after['scale'] - before['scale']) < 1e-6 and
              after['scrollX'] == before['scrollX'] and after['scrollY'] == before['scrollY'] and
              after['input']['modal'] == 'map' and not after['input']['keys'] and
              not after['input']['joy'] and not after['input']['look'],
              'map rapid taps preserve viewport scale and keep gameplay input clear')
    finally:
        await page.evaluate(r"""()=>{
          const a=window.__mobileMapTapAudit;
          if(a){a.target.removeEventListener('click',a.click);window.removeEventListener('touchend',a.end);}
          delete window.__mobileMapTapAudit;
        }""")
        await tap(page, '#btn-mapclose', 'Map rapid taps')
        await hud.frame(page)


async def modal_gesture(page, selector, tag):
    # Swiping a panel title must never send movement/camera input to the world.
    at = await page.locator(selector).evaluate(r"""e=>{
      const r=e.getBoundingClientRect();return {x:r.x+Math.min(r.width*.2,45),y:r.y+r.height/2,id:1};
    }""")
    before = await page.evaluate('MN.input()')
    if not hasattr(page, '_mobile_navigation_cdp'):
        page._mobile_navigation_cdp = await page.context.new_cdp_session(page)
    cdp = page._mobile_navigation_cdp
    try:
        await cdp.send('Input.dispatchTouchEvent', {'type': 'touchStart', 'touchPoints': [at]})
        await cdp.send('Input.dispatchTouchEvent', {
            'type': 'touchMove', 'touchPoints': [{**at, 'x': at['x'] + 18, 'y': at['y'] + 12}]})
        during = await page.evaluate('MN.input()')
        check(not during['keys'] and not during['joy'] and not during['look'] and
              not during['pointers'] and not during['hold'] and during['modal'] == before['modal'],
              tag + ': touching the open panel cannot activate world input ' + json.dumps(during))
    finally:
        await cdp.send('Input.dispatchTouchEvent', {'type': 'touchEnd', 'touchPoints': []})
        # Keep the CDP session attached: detaching can clear touch emulation.
    await hud.frame(page)
    after = await page.evaluate('MN.input()')
    check(abs(after['x'] - before['x']) < 1e-6 and abs(after['z'] - before['z']) < 1e-6,
          tag + ': the character stays still behind the panel')


async def direct_destination(page, button, panel, modal, close, tag, gesture=None):
    await page.keyboard.down('w')
    try:
        check(await page.evaluate('__hm.INPUT.keys.has("KeyW")'),
              tag + ': held movement is active before opening the panel')
        await tap(page, button, tag)
        check(await page.locator(panel).is_visible(), tag + ': one tap opens the destination')
        if modal in ('kit', 'map'):
            active = await page.evaluate('document.activeElement.id')
            check(active == close.removeprefix('#'),
                  tag + ': focus enters the panel on its Close control ' + active)
        state = await page.evaluate('MN.input()')
        check(state['modal'] == modal and not state['keys'] and not state['joy'] and
              not state['look'] and not state['pointers'] and not state['hold'],
              tag + ': opening the panel immediately clears held world input ' + json.dumps(state))
    finally:
        await page.keyboard.up('w')
    # Fresh movement keys also belong to the modal, rather than the character.
    await page.keyboard.down('w')
    check(not await page.evaluate('__hm.INPUT.keys.size'),
          tag + ': movement pressed while the panel is open is ignored')
    await page.keyboard.up('w')
    if gesture:
        await modal_gesture(page, gesture, tag)
    if modal == 'mobile':
        state = await page.evaluate(r"""()=>({
          section:document.getElementById('mobile-tray').dataset.section,
          selected:[...document.querySelectorAll('[data-mobile-tab][aria-selected="true"]')].map(e=>e.dataset.mobileTab),
          skills:[...document.querySelectorAll('#mobile-tray-abilities [data-mobile-ability]')].length,
          title:document.getElementById('mobile-tray-title').textContent})""")
        check(state['section'] == 'character' and state['selected'] == ['character'] and
              state['skills'] == 8 and 'Skills' in state['title'],
              tag + ': direct Skills opens the complete class catalogue ' + json.dumps(state))
    await tap(page, close, tag)
    await hud.frame(page)
    state = await page.evaluate('MN.input()')
    check(not await page.locator(panel).is_visible() and not state['modal'] and
          not state['keys'] and not state['joy'] and not state['hold'],
          tag + ': close returns to play without stuck movement')
    if modal in ('kit', 'map'):
        active = await page.evaluate('document.activeElement.id')
        check(active == button.removeprefix('#'),
              tag + ': close restores focus to its navigation button ' + active)


async def menu_tabs(page, tag):
    await tap(page, '#mobile-menu-toggle', tag)
    check(await page.locator('#mobile-tray').get_attribute('data-section') == 'world',
          tag + ': Menu opens Explore')
    tab_y = None
    for section in ('world', 'character', 'social', 'options'):
        await tap(page, f'#mobile-tray-tabs [data-mobile-tab="{section}"]', tag)
        state = await page.evaluate(r"""()=>{
          const tray=document.getElementById('mobile-tray'),tabs=[...tray.querySelectorAll('[data-mobile-tab]')];
          return {section:tray.dataset.section,selected:tabs.filter(e=>e.getAttribute('aria-selected')==='true').map(e=>e.dataset.mobileTab),
            y:tabs[0].getBoundingClientRect().y,labelledBy:document.getElementById('mobile-tray-panel').getAttribute('aria-labelledby'),
            modal:__hm.UI.modal,joy:!!__hm.INPUT.joy};
        }""")
        check(state['section'] == section and state['selected'] == [section] and
              state['labelledBy'] == 'mobile-tab-' + section and state['modal'] == 'mobile' and not state['joy'],
              tag + ': touch selects the ' + section + ' section without closing Menu')
        if tab_y is None:
            tab_y = state['y']
        check(abs(state['y'] - tab_y) <= 1, tag + ': section navigation remains in a fixed reachable position')
    await shot(page, 'mobile_navigation_menu_' + tag)
    await tap(page, '#mobile-tray-close', tag)
    await hud.frame(page)


async def resize(page, w, h):
    await page.set_viewport_size({'width': w, 'height': h})
    await wait_for_viewport(page)
    await hud.frame(page)
    await page.evaluate("document.getElementById('zonetoast').classList.remove('on');0")


async def main():
    async with async_playwright() as p:
        browser, page, logs = await setup(p, touch=True, w=SIZES[0][0], h=SIZES[0][1])
        page.set_default_timeout(15000)
        await page.emulate_media(reduced_motion='reduce')
        try:
            await page.evaluate(hud.HELP)
            await page.evaluate(HELP)
            await page.evaluate("(async () => { await MH.scene('warrior',1);__hm.quality.scale=.5;dispatchEvent(new Event('resize')); return 0; })()")
            await human_play(page)
            await wait_for_viewport(page)
            quiet = await page.evaluate("""(() => { const H=__hm,L=H.LORE; H.GAME.prog.lore.seen=Object.keys(L.notes).filter(id=>id!=='keep'); L.state.queue.length=0; L.state.noteUntil=0; document.querySelectorAll('#banners .lore-note').forEach(e=>e.remove()); H.GAME.player.combatUntil=0; L.loreNote('keep'); for(let i=0;i<4;i++) H.frame(1/30); return {saved:L.progress().seen.includes('keep'),popups:document.querySelectorAll('#banners .lore-note').length}; })()""")
            check(quiet['saved'] and quiet['popups']==0, 'mobile field notes are collected without automatic popups')
            for w, h in SIZES:
                await resize(page, w, h)
                tag = f'{w}x{h}'
                await geometry(page, tag)
                await tap(page, '#mobile-notes', tag)
                reader = await page.evaluate("""(() => { const p=document.querySelector('.chron-body [data-note=keep] p'),r=p?.getBoundingClientRect(),s=p&&getComputedStyle(p); return {text:p?.textContent,full:!!p&&p.scrollHeight<=p.clientHeight+1&&s.whiteSpace!=='nowrap',overflow:document.documentElement.scrollWidth>innerWidth,sec:__hm.LORE.state.chronSec}; })()""")
                check(reader['sec']=='notes' and reader['full'] and not reader['overflow'] and reader['text'], tag + ' Notes opens the full wrapping saved text')
                await tap(page, '#menu-close', tag)
                check(await page.evaluate('__hm.UI.modal === null'), tag + ' visible Close returns to play')
                if NOTES_ONLY:
                    continue
                if (w, h) == SIZES[0]:
                    await double_tap(page)
                    await touch_fallback_exclusions(page)
                    await map_double_tap(page)
                await direct_destination(page, '#mobile-inventory', '#kit', 'kit', '#kit-close',
                                         tag + ' Inventory', '#kit .kithead')
                await direct_destination(page, '#mobile-skills', '#mobile-tray', 'mobile', '#mobile-tray-close',
                                         tag + ' Skills', '#mobile-tray .mobile-sheet-head')
                await direct_destination(page, '#mobile-map', '#mapov', 'map', '#btn-mapclose', tag + ' Map')
                await menu_tabs(page, tag)
            # Returning from landscape and the browser chrome consuming/releasing
            # vertical space must not preserve an obsolete tall-phone offset.
            for h in (852, 668, 852):
                await resize(page, 393, h)
                await geometry(page, f'393x{h}_resize')
            errors = await page.evaluate('__hm.errors')
            check(not errors and not logs, 'no browser/game errors ' + json.dumps({'game': errors[:2], 'browser': logs[:2]}))
        except Exception as exc:
            FAILS.append(f'{type(exc).__name__}: {exc}')
            await shot(page, 'mobile_navigation_failure')
            raise
        finally:
            await browser.close()
            pathlib.Path(OUT, 'mobile_navigation.json').write_text(
                json.dumps({'results': RESULTS, 'failures': FAILS}, indent=2))
    print(f'{len(FAILS)} failures', flush=True)
    if FAILS:
        sys.exit(1)


if __name__ == '__main__':
    asyncio.run(main())
