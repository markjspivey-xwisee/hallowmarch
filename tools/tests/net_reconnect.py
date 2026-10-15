#!/usr/bin/env python3
"""Real Chromium + real room server: a cold failed handshake must not strand a local saved game."""
import asyncio, json, os, pathlib, socket, subprocess, sys, tempfile, traceback
from urllib.parse import urlencode
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
import hm
from playwright.async_api import async_playwright, expect
from startup_graphics import ARGS, ORIGIN, direct_page

ROOT = pathlib.Path(__file__).resolve().parents[2]
TOKEN_KEY = 'hallowmarch.token.'

def check(ok, label):
    if not ok:
        raise AssertionError(label)
    print('check', label, 'PASS', flush=True)

def free_port():
    with socket.socket() as s:
        s.bind(('127.0.0.1', 0))
        return s.getsockname()[1]

# This fixture speaks the production protocol to the actual temporary server. It never prints credentials.
FIXTURE = r"""
import {pathToFileURL} from 'node:url';
const [modulePath,url,mode,token,json] = process.argv.slice(1);
const {default:WebSocket}=await import(pathToFileURL(modulePath).href);
const ws=new WebSocket(url);
const timeout=setTimeout(()=>{console.error('fixture protocol timed out');process.exit(1);},15000);
let accountToken='',accountId='',done=false;
ws.on('open',()=>ws.send(JSON.stringify({t:'hello',v:1,token:token||undefined,room:'late-reconnect'})));
ws.on('message',data=>{
 const m=JSON.parse(String(data));
 if(m.t==='denied')throw Error('fixture hello denied');
 if(m.t==='welcome'){
  accountToken=m.token;accountId=m.acct.id;
  ws.send(JSON.stringify(mode==='seed'?{t:'save',d:JSON.parse(json)}:{t:'load'}));
 }else if(m.t==='saved'&&mode==='seed'){
  if(!m.ok)throw Error('fixture save refused');
  ws.send(JSON.stringify({t:'load'}));
 }else if(m.t==='save'&&!done){
  done=true;clearTimeout(timeout);
  console.log(JSON.stringify({token:accountToken,id:accountId,save:m.d}));
  ws.close();
 }
});
ws.on('error',()=>{console.error('fixture socket failed');process.exit(1);});
"""

async def fixture(url, mode, token='', save=None):
    process = await asyncio.create_subprocess_exec(
        'node', '--input-type=module', '-e', FIXTURE,
        str(ROOT / 'server/node_modules/ws/index.js'), url, mode, token,
        json.dumps(save) if save is not None else '',
        stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE)
    out, err = await asyncio.wait_for(process.communicate(), 25)
    if process.returncode:
        raise RuntimeError('server fixture failed: ' + err.decode(errors='replace')[-800:])
    return json.loads(out)

OBSERVE = r"""(() => {
 window.__hmNetTest = {stalls:0,stallScheduled:false};
 window.__hmNetTest.stall = () => {
  const end=performance.now()+1500;
  while(performance.now()<end) {}
  window.__hmNetTest.stalls++;
 };
})();"""

SNAPSHOT = r"""() => ({
 ready:__hm.ready,started:__hm.GAME.started,name:__hm.GAME.player?.name,
 xp:__hm.GAME.prog?.xp,backend:__hm.SAVE.backend,ref:!!__hm.SAVE.ref,
 loaded:__hm.SAVE.loaded?.char?.name,network:__hm.net.state(),
 socket:{
  state:__hm.net.NETWS.state,account:__hm.net.NETWS.acct?.id,
  readyState:__hm.net.NETWS.ws?.readyState,lastFailure:__hm.net.NETWS.lastFailure,
  lastClose:__hm.net.NETWS.lastClose,generation:__hm.net.NETWS.generation,
  opening:!!__hm.net.NETWS.openP,linking:!!__hm.net.NETWS.linkP,
  connecting:!!__hm.net.NET.connectP
 },
 stalls:window.__hmNetTest.stalls,
 errors:[...__hm.errors],stored:localStorage.getItem('hallowmarch.save.v1')
})"""

async def recover_local_game(browser, url, host, seeded):
    local = {
        'v':1,
        'char':{'name':'Local Aldwin','realm':0,'cls':'warrior','level':3,'xp':29,'rp':0,
                'kills':0,'realmKills':0,'deaths':0,'played':31,'gold':42,'potions':3,'bag':[],'eq':{}},
        'settings':{'quality':'high','auto':True},'world':None,
    }
    local_text = json.dumps(local, separators=(',', ':'))
    init = OBSERVE + '\n' + (
        'localStorage.setItem("hallowmarch.save.v1", ' + json.dumps(local_text) + ');'
        'localStorage.setItem(' + json.dumps(TOKEN_KEY + host) + ', ' + json.dumps(seeded['token']) + ');'
        'localStorage.setItem("hallowmarch.token.other.test", "unrelated-host-token");'
    )
    ctx,page,errors,console_errors,navigations = await direct_page(browser,640,360,init=init)
    gate = {'allow':False}
    blocked, wire = [], []
    routes = {'created':0,'closed':0,'live':0,'maxLive':0,'welcomes':0}
    first_closed = asyncio.Event()
    route_tasks,route_task_errors=set(),[]
    def schedule(coroutine):
        task=asyncio.create_task(coroutine)
        route_tasks.add(task)
        def done(completed):
            route_tasks.discard(completed)
            if not completed.cancelled():
                error=completed.exception()
                if error: route_task_errors.append(str(error))
        task.add_done_callback(done)
    def route_socket(ws):
        entry = {'closed':False,'first':routes['created']==0}
        routes['created']+=1
        routes['live']+=1
        routes['maxLive']=max(routes['maxLive'],routes['live'])
        server = ws.connect_to_server() if gate['allow'] else None
        def mark_closed():
            if not entry['closed']:
                entry['closed']=True
                routes['closed']+=1
                routes['live']-=1
                if entry['first']: first_closed.set()
        def client_closed(code, reason):
            mark_closed()
            if server:
                server.close(code=code,reason=reason)
        ws.on_close(client_closed)
        def client_message(message):
            try:
                m=json.loads(message)
                wire.append({'t':m.get('t'),'name':m.get('d',{}).get('n') if m.get('t')=='slow' else None})
                if entry['first'] and m.get('t')=='hello':
                    schedule(page.evaluate("""() => {
                      if(!window.__hmNetTest.stallScheduled) {
                        window.__hmNetTest.stallScheduled=true;
                        setTimeout(window.__hmNetTest.stall,6500);
                      }
                    }"""))
            except (ValueError,TypeError,AttributeError):
                pass
            if server: server.send(message)
        ws.on_message(client_message)
        if server:
            def server_message(message):
                try:
                    if json.loads(message).get('t')=='welcome': routes['welcomes']+=1
                except (ValueError,TypeError,AttributeError):
                    pass
                ws.send(message)
            def server_closed(code, reason):
                mark_closed()
                schedule(ws.close(code=code,reason=reason))
            server.on_message(server_message)
            server.on_close(server_closed)
        else:
            blocked.append((ws,entry,mark_closed))
    await page.route_web_socket(url, route_socket)
    try:
        target = ORIGIN + '/?' + urlencode({'safe':'1','server':url,'shard':'late-reconnect'})
        await page.goto(target,wait_until='commit',timeout=120000)
        await page.wait_for_function('window.__hm && window.__hm.ready',timeout=180000,polling=500)
        # Observe the application's failed attempt and the routed close itself.
        # Playwright installs its own WebSocket constructor, so no constructor wrapper is used.
        await page.wait_for_function('__hm.net.NETWS.lastFailure === "welcome timeout"',timeout=45000,polling=250)
        await asyncio.wait_for(first_closed.wait(),5)
        before = await page.evaluate(SNAPSHOT)
        check(before['socket']['lastFailure']=='welcome timeout' and routes['closed']>=1,
              'the real initial handshake deadline fails and retires its transport')
        check(before['backend']=='local' and not before['ref'] and before['loaded']=='Local Aldwin',
              'failed initial handshake loads the existing local character')
        check(routes['welcomes']==0 and before['socket']['state']!='on',
              'opening a transport without server welcome never claims authentication')
        check(before['stored']==local_text,'cold connection failure preserves the existing local save')
        check(before['stalls']==1,'real browser handshake deadline survives a CPU startup stall')
        check(not route_task_errors,'socket route helper operations complete without errors')
        await expect(page.locator('#btn-continue')).to_be_visible()
        await page.locator('#btn-continue').evaluate('button=>button.click()')
        await page.wait_for_function('__hm.GAME.started && __hm.GAME.player?.name === "Local Aldwin"',timeout=30000)
        started = await page.evaluate(SNAPSHOT)
        check(started['name']=='Local Aldwin' and started['xp']>=29,
              'Continue starts the selected local character before multiplayer recovers')
        gate['allow']=True
        # Release an outstanding retry, if boot completed while its welcome was still pending.
        for ws,entry,mark_closed in blocked:
            if not entry['closed']:
                await ws.close(code=1013,reason='initial connection unavailable')
                mark_closed()  # a route-initiated close need not call its client on_close observer
        await page.wait_for_function('__hm.net.state().state === "on" && __hm.net.state().kind === "ws"',timeout=60000,polling=250)
        for _ in range(60):
            if any(m['t']=='slow' and m['name']=='Local Aldwin' for m in wire): break
            await asyncio.sleep(.25)
        recovered = await page.evaluate(SNAPSHOT)
        check(recovered['socket']['account']==seeded['id'],
              'late reconnect authenticates the original host-specific account')
        check(recovered['network']['state']=='on' and routes['welcomes']==1,
              'the real server welcome attaches the resumed game exactly once')
        check(recovered['name']=='Local Aldwin' and recovered['loaded']=='Local Aldwin' and
              recovered['backend']=='local' and not recovered['ref'],
              'late presence reconnect leaves the running character and save backend local')
        check(routes['live']==1 and routes['maxLive']==1,
              'cold failures and recovery keep one live socket')
        check(any(m['t']=='slow' and m['name']=='Local Aldwin' for m in wire),
              'the resumed local character publishes its profile to the actual server')
        check(not any(m['t'] in ('load','save','wipe') for m in wire),
              'presence recovery performs no account save read, upload or wipe')
        await page.evaluate('async()=>{__hm.GAME.prog.xp+=17;await __hm.fn.saveNow();await __hm.SAVE.chain;}')
        saved = await page.evaluate(SNAPSHOT)
        local_saved = json.loads(saved['stored'])
        check(local_saved['char']['name']=='Local Aldwin' and local_saved['char']['xp']>=46 and
              saved['backend']=='local' and not saved['ref'],
              'progress after reconnect continues saving only to the local character')
        check(await page.evaluate('localStorage.getItem("hallowmarch.token.other.test")')=='unrelated-host-token',
              'reconnect preserves credentials belonging to another server')
        remote = await fixture(url,'load',seeded['token'])
        check(remote['id']==seeded['id'] and remote['save']==seeded['save'],
              'the preexisting server character remains structurally unchanged')
        created_after_recovery=routes['created']
        await page.wait_for_timeout(2000)
        final = await page.evaluate(SNAPSHOT)
        check(routes['created']==created_after_recovery and routes['live']==1,
              'a recovered connection does not keep retrying in the background')
        check(not final['errors'] and not errors and not route_task_errors,
              'cold timeout and successful late reconnect produce no runtime errors')
        check(len(navigations)==1,'multiplayer recovery requires no reload or navigation')
        await page.screenshot(path=str(hm.OUT/'net-cold-reconnect.png'),timeout=120000)
    except Exception:
        evidence={'routes':dict(routes),'wire':list(wire),'pageErrors':list(errors),'consoleErrors':list(console_errors),
                  'navigations':list(navigations),'routeTaskErrors':list(route_task_errors)}
        try: evidence['state']=await page.evaluate(SNAPSHOT)
        except Exception as diagnostic_error: evidence['diagnosticError']=str(diagnostic_error)
        (hm.OUT/'net-cold-reconnect-failure.json').write_text(json.dumps(evidence,indent=2),encoding='utf-8')
        print('network failure diagnostics',json.dumps(evidence),flush=True)
        try: await page.screenshot(path=str(hm.OUT/'net-cold-reconnect-failure.png'),timeout=30000)
        except Exception: pass
        raise
    finally:
        await ctx.close()
        if route_tasks:
            await asyncio.wait_for(asyncio.gather(*list(route_tasks),return_exceptions=True),5)

async def main():
    import urllib.request
    hm.OUT.mkdir(parents=True,exist_ok=True)
    port = free_port()
    with tempfile.TemporaryDirectory(prefix='net_reconnect_',dir=str(hm.OUT)) as data:
        server = subprocess.Popen(['node',str(ROOT/'server/server.js')],
                                  env={**os.environ,'PORT':str(port),'HM_DATA':data},
                                  stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True)
        try:
            for _ in range(80):
                try:
                    with urllib.request.urlopen(f'http://127.0.0.1:{port}/health',timeout=1) as response:
                        if response.status==200: break
                except Exception:
                    await asyncio.sleep(.25)
            else:
                raise RuntimeError('temporary room server did not become healthy')
            url=f'ws://127.0.0.1:{port}/ws'
            remote_save={'v':1,'char':{'name':'Server Sentinel','realm':1,'cls':'priest','level':7,
                         'xp':900,'rp':120,'kills':0,'realmKills':0,'deaths':0,'played':123,
                         'gold':81,'potions':5,'bag':[],'eq':{}},
                         'settings':{'quality':'medium','auto':False},'world':None}
            seeded=await fixture(url,'seed',save=remote_save)
            check(seeded.get('save',{}).get('char',{}).get('name')=='Server Sentinel',
                  'real server fixture holds a distinct existing character')
            async with async_playwright() as p:
                browser=await p.chromium.launch(args=ARGS)
                try:
                    await recover_local_game(browser,url,f'127.0.0.1:{port}',seeded)
                finally:
                    await browser.close()
        finally:
            server.terminate()
            try: server.communicate(timeout=5)
            except subprocess.TimeoutExpired:
                server.kill()
                server.communicate(timeout=5)
    print('check multiplayer cold reconnect regression PASS',flush=True)

if __name__=='__main__':
    try:
        asyncio.run(main())
    except Exception:
        print('FAIL multiplayer cold reconnect regression',flush=True)
        traceback.print_exc()
        sys.exit(1)
