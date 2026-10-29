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
                       'touch': args.touch, 'steps': [], 'requestsBlocked': [], 'pageErrors': [], 'fixtures': []}
        self.mob_fixture = None

    def save(self):
        (self.out / 'journey.json').write_text(json.dumps(self.report, indent=2), encoding='utf-8')

    async def record(self, label, shot=False):
        state = await self.page.evaluate(SNAPSHOT)
        state.update(label=label, elapsed=round(time.monotonic() - self.started, 3))
        self.report['steps'].append(state)
        self.save()
        require(not state['stopped'] and not state['errors'] and not self.report['pageErrors'], 'Game error at ' + label)
        require(not state['native'] and not state['host'], 'The fixture must remain local and independent of hosted identity')
        require(not self.report['requestsBlocked'], 'Unexpected external/service request at ' + label)
        if shot:
            await self.page.screenshot(path=str(self.out / (label + '.png')), timeout=10000)
        print(json.dumps({'step': label, 'elapsed': state['elapsed'], 'modal': state['modal']}), flush=True)
        return state

    async def wait(self, expression, timeout=20000, arg=None):
        await self.page.wait_for_function(expression, arg=arg, timeout=timeout, polling=100)

    async def action(self, selector, after=None):
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
        fixture = await self.page.evaluate("""()=>{
          const H=__hm,P=H.GAME.player,b=H.GAME.prog.bounty,c=H.CAMPS[b.camp];
          const e=[...c.members].map(H.fn.getEnt).find(e=>e?.alive&&!e.removed&&e.mobType===b.type&&e.level<=P.level+1);
          if(!e)throw Error('No actual suitable living bounty creature for the combat fixture');
          let point;
          for(const a of [0,.4,-.4,.8,-.8,1.2,-1.2]) {const yaw=H.CAM.yaw+a,x=P.x+Math.sin(yaw)*2,z=P.z+Math.cos(yaw)*2;
            const occupied=H.ENT.some(other=>other!==P&&other!==e&&other.alive&&!other.removed&&Math.hypot(other.x-x,other.z-z)<(other.radius||.5)+(e.radius||.5)+.35);
            if(!occupied&&H.fn.isWalkable(x,z)){point={x,z};break;}}
          if(!point)throw Error('No walkable nearby fixture position');
          const original={x:e.x,y:e.y,z:e.z,home:e.home?{...e.home}:null};
          e.x=e.prevX=point.x;e.z=e.prevZ=point.z;e.y=H.fn.heightAt(point.x,point.z);
          if(e.home)e.home={...e.home,x:point.x,z:point.z};
          return {id:e.id,name:e.name,level:e.level,hp:e.hp,maxHp:e.maxHp,original,arranged:{x:e.x,y:e.y,z:e.z,home:e.home?{...e.home}:null}};
        }""")
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

    async def play(self):
        await self.page.goto('http://journey.test/', wait_until='commit')
        await wait_title_settled(self.page, timeout=240000)
        await self.record('01-title', shot=True)
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
        await self.wait("()=>__hm.GAME.prog.lore.done.includes('herald')")
        accept = self.page.locator('#dlg-actions').get_by_role('button', name='Accept bounty', exact=True)
        require(await accept.count() == 1, 'The default fresh world has no suitable first bounty; inspect herald/objective evidence')
        if self.args.touch:
            await accept.tap()
        else:
            await accept.click()
        await self.wait("()=>__hm.UI.modal===null&&!!__hm.GAME.prog.bounty")
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
            require(await self.page.evaluate('p=>document.elementFromPoint(p.x,p.y)?.id===\'scene\'', point), 'A HUD element covers the creature input point')
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
        if self.args.touch:
            await self.action('#t-target')
        else:
            await self.page.keyboard.press('Escape')
        await self.wait('()=>__hm.GAME.player.target===null')
        await self.action('#mobile-inventory' if self.args.touch else '#btn-kit', "()=>__hm.UI.modal==='kit'")
        await self.panel('#kit')
        require(await self.page.locator('#kit-right').inner_text(), 'Inventory has no readable contents')
        await self.action('#kit-close', "()=>__hm.UI.modal===null")
        earned = await self.page.evaluate(EARNED)
        await self.open_menu()
        await self.action('#menu-tab-progress', "()=>__hm.UI.menuTab==='progress'")
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
        await self.page.reload(wait_until='commit')
        await wait_title_settled(self.page, timeout=240000)
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
        html = self.args.html.read_text(encoding='utf-8').replace(THREE_URL, '/qa/three.mjs')
        html = re.sub(r'<link[^>]+href="https://fonts\.[^>]+>', '', html)
        if self.args.expect_sha256:
            require(self.report['htmlSha256'] == self.args.expect_sha256, 'Frozen build hash differs from the expected candidate')
        browser = None
        self.report['outcome'] = 'FAIL'
        try:
            async with async_playwright() as p:
                browser = await p.chromium.launch(headless=True, chromium_sandbox=True, executable_path=self.args.executable)
                self.report['browserVersion'] = browser.version
                context = await browser.new_context(viewport={'width': self.args.width, 'height': self.args.height}, has_touch=self.args.touch,
                                                    is_mobile=self.args.touch, service_workers='block')
                self.page = await context.new_page()
                self.page.set_default_timeout(20000)
                self.page.on('pageerror', lambda error: self.report['pageErrors'].append(str(error)))
                await context.tracing.start(screenshots=True, snapshots=True, sources=True)

                async def route(request):
                    url = urlparse(request.request.url)
                    value = None
                    if url.netloc == 'journey.test' and request.request.method == 'GET':
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
                try:
                    await asyncio.wait_for(self.play(), timeout=self.args.timeout)
                    self.report['outcome'] = 'PASS'
                except Exception as error:
                    self.report['outcome'] = 'FAIL'
                    self.report['failure'] = str(error)
                    try: await self.page.screenshot(path=str(self.out / 'failure.png'), timeout=5000)
                    except Exception: pass
                finally:
                    await context.tracing.stop(path=str(self.out / 'trace.zip'))
                    await asyncio.wait_for(browser.close(), timeout=20)
                    self.report['browserClosed'] = True
        except Exception as error:
            self.report['failure'] = str(error)
        finally:
            if browser and not self.report['browserClosed']:
                try:
                    await asyncio.wait_for(browser.close(), timeout=20)
                    self.report['browserClosed'] = True
                except Exception as error:
                    self.report['cleanupError'] = str(error)
            self.report['elapsedSeconds'] = round(time.monotonic() - self.started, 3)
            self.save()
        print(json.dumps({'outcome': self.report.get('outcome', 'FAIL'), 'evidence': str(self.out), 'browserClosed': self.report['browserClosed']}), flush=True)
        return self.report.get('outcome') == 'PASS'


def arguments():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--html', type=pathlib.Path, required=True, help='Exact frozen built HTML to review')
    parser.add_argument('--expect-sha256', help='Refuse to run a different candidate')
    parser.add_argument('--out', type=pathlib.Path, default=ROOT.parent / 'first-session-qa')
    parser.add_argument('--executable', help='Optional browser executable; always launches headless with a fresh context')
    parser.add_argument('--touch', action='store_true', help='Use real touch input and the compact phone controls')
    parser.add_argument('--width', type=int)
    parser.add_argument('--height', type=int)
    parser.add_argument('--timeout', type=int, default=720, help='Whole-journey deadline in seconds; no automatic retry')
    args = parser.parse_args()
    args.width = args.width or (390 if args.touch else 1280)
    args.height = args.height or (780 if args.touch else 800)
    return args


if __name__ == '__main__':
    raise SystemExit(0 if asyncio.run(Journey(arguments()).run()) else 1)
