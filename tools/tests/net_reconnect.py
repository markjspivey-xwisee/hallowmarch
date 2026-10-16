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

PROXY = r"""
import {pathToFileURL} from 'node:url';
import readline from 'node:readline';
import http from 'node:http';
import https from 'node:https';
const [modulePath,port,backend]=process.argv.slice(1);
const {default:WebSocket}=await import(pathToFileURL(modulePath).href);
const WebSocketServer=WebSocket.WebSocketServer||WebSocket.Server;
const stats={created:0,closed:0,live:0,maxLive:0,welcomes:0,forwarded:0,manifests:0};
const clients=new Set();
let allowed=false;
function emit(event,extra={}){process.stdout.write(JSON.stringify({event,...extra,stats:{...stats}})+'\n');}
function closePeer(socket,code=1000){
 if(!socket||socket.readyState>=WebSocket.CLOSING)return;
 // 1005/1006 are observations, never valid close frame codes.
 if(code===1005||code===1006||code===1015)socket.close();
 else socket.close(code,'proxy peer closed');
}
// The browser reads this origin's public participation policy before opening a
// socket. Forward the real backend response and CORS headers; only the WS
// welcome is intentionally withheld. An invented policy would hide app bugs.
const publicHttp=http.createServer((req,res)=>{
 if(req.method!=='GET'||req.url!=='/gaming/manifest'){res.writeHead(404);res.end();return;}
 const target=new URL(backend);target.protocol=target.protocol==='wss:'?'https:':'http:';
 target.pathname='/gaming/manifest';target.search='';target.hash='';
 const upstream=(target.protocol==='https:'?https:http).get(target,{headers:{Accept:'application/json'}},response=>{
  res.writeHead(response.statusCode,response.headers);response.pipe(res);
  response.on('end',()=>{stats.manifests++;emit('manifest',{status:response.statusCode});});
 });
 upstream.setTimeout(5000,()=>upstream.destroy());
 upstream.on('error',()=>{if(!res.headersSent)res.writeHead(502);res.end();});
});
const listener=new WebSocketServer({server:publicHttp});
publicHttp.listen(Number(port),'127.0.0.1');
listener.on('listening',()=>emit('ready'));
listener.on('error',()=>{emit('error',{why:'proxy listener failed'});process.exit(1);});
listener.on('connection',client=>{
 const entry={id:++stats.created,client,upstream:null,queue:[],closed:false,blocked:!allowed,hello:false};
 clients.add(entry);stats.live++;stats.maxLive=Math.max(stats.maxLive,stats.live);
 emit('connected',{id:entry.id,blocked:entry.blocked});
 // Match the backend's hello deadline, while intentionally withholding welcome.
 const helloTimer=setTimeout(()=>{
  if(!entry.hello&&!entry.closed)closePeer(client,1008);
 },10000);
 function upstream(){
  if(entry.upstream||entry.blocked||entry.closed)return;
  const peer=entry.upstream=new WebSocket(backend);
  peer.on('open',()=>{
   if(entry.closed){closePeer(peer);return;}
   for(const [data,binary] of entry.queue)peer.send(data,{binary});
   entry.queue.length=0;
  });
  peer.on('message',(data,binary)=>{
   if(entry.closed)return;
   try{if(JSON.parse(String(data)).t==='welcome'){stats.welcomes++;emit('welcome',{id:entry.id});}}catch{}
   if(client.readyState===WebSocket.OPEN)client.send(data,{binary});
  });
  peer.on('close',code=>{if(!entry.closed)closePeer(client,code);});
  peer.on('error',()=>{
   if(!entry.closed){emit('error',{why:'upstream socket failed',id:entry.id});closePeer(client,1011);}
  });
 }
 client.on('message',(data,binary)=>{
  let message=null;try{message=JSON.parse(String(data));}catch{}
  if(message&&message.t==='hello'){
   entry.hello=true;clearTimeout(helloTimer);emit('hello',{id:entry.id});
  }
  emit('client-message',{id:entry.id,t:message?.t||'',name:message?.t==='slow'?message.d?.n:null});
  if(entry.blocked)return;
  upstream();
  stats.forwarded++;
  if(entry.upstream.readyState===WebSocket.OPEN)entry.upstream.send(data,{binary});
  else entry.queue.push([data,binary]);
 });
 client.on('close',code=>{
  if(entry.closed)return;
  entry.closed=true;clearTimeout(helloTimer);clients.delete(entry);
  stats.closed++;stats.live--;emit('closed',{id:entry.id,code});
  closePeer(entry.upstream,code);
 });
 client.on('error',()=>{if(!entry.closed)emit('error',{why:'inbound socket failed',id:entry.id});});
});
readline.createInterface({input:process.stdin}).on('line',line=>{
 let command;try{command=JSON.parse(line);}catch{return;}
 if(command.cmd==='allow'){
  allowed=true;
  // Closed blocked sockets are retired physically before the app can retry.
  for(const entry of clients)if(entry.blocked)closePeer(entry.client,1013);
  emit('allowed');
 }
});
process.on('SIGTERM',()=>{
 for(const entry of clients){entry.client.terminate();entry.upstream?.terminate();}
 listener.close(()=>publicHttp.close(()=>process.exit(0)));
 setTimeout(()=>process.exit(0),1000).unref();
});
"""

class NativeProxy:
    def __init__(self, port, backend):
        self.port,self.backend=port,backend
        self.process=None
        self.reader=None
        self.ready,self.first_hello,self.first_closed,self.allowed=(asyncio.Event() for _ in range(4))
        self.stats={'created':0,'closed':0,'live':0,'maxLive':0,'welcomes':0,'forwarded':0}
        self.wire,self.errors=[],[]
        self.first_close_code=None

    async def start(self):
        self.process=await asyncio.create_subprocess_exec(
            'node','--input-type=module','-e',PROXY,
            str(ROOT/'server/node_modules/ws/index.js'),str(self.port),self.backend,
            stdin=asyncio.subprocess.PIPE,stdout=asyncio.subprocess.PIPE,stderr=asyncio.subprocess.STDOUT)
        self.reader=asyncio.create_task(self.read())
        await asyncio.wait_for(self.ready.wait(),10)
        return self

    async def read(self):
        async for raw in self.process.stdout:
            try:
                event=json.loads(raw)
            except (ValueError,TypeError):
                self.errors.append(raw.decode(errors='replace').strip())
                continue
            self.stats=event.get('stats',self.stats)
            kind=event.get('event')
            if kind=='ready': self.ready.set()
            elif kind=='hello' and event.get('id')==1: self.first_hello.set()
            elif kind=='closed' and event.get('id')==1:
                self.first_close_code=event.get('code')
                self.first_closed.set()
            elif kind=='allowed': self.allowed.set()
            elif kind=='client-message':
                self.wire.append({'id':event['id'],'t':event['t'],'name':event.get('name')})
            elif kind=='error': self.errors.append(event.get('why','proxy error'))

    async def allow(self):
        self.process.stdin.write(b'{"cmd":"allow"}\n')
        await self.process.stdin.drain()
        await asyncio.wait_for(self.allowed.wait(),10)

    async def close(self):
        if self.process and self.process.returncode is None:
            self.process.terminate()
            try: await asyncio.wait_for(self.process.wait(),5)
            except asyncio.TimeoutError:
                self.process.kill()
                await self.process.wait()
        if self.reader:
            await self.reader

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


async def peer_traffic(page, backend):
    """A real second peer exchanges slow and fast state through the backend."""
    process=await asyncio.create_subprocess_exec(
        'node',str(ROOT/'tools/tests/net_client.mjs'),backend,
        stdin=asyncio.subprocess.PIPE,stdout=asyncio.subprocess.PIPE,stderr=asyncio.subprocess.STDOUT)
    async def send(command):
        process.stdin.write((json.dumps(command)+'\n').encode())
        await process.stdin.drain()
    async def receive(field):
        deadline=asyncio.get_running_loop().time()+15
        while True:
            remaining=deadline-asyncio.get_running_loop().time()
            if remaining<=0: raise TimeoutError('temporary peer did not provide '+field)
            line=await asyncio.wait_for(process.stdout.readline(),remaining)
            if not line: raise RuntimeError('temporary peer exited before '+field)
            try: event=json.loads(line)
            except ValueError: continue
            if field in event: return event[field]
    try:
        await send({'cmd':'raw','m':{'t':'hello','v':1,'room':'late-reconnect'}})
        welcome=await receive('welcome')
        peer_id=welcome['peer']
        position=await page.evaluate('()=>{const p=__hm.GAME.player;return [p.x+4,p.y,p.z]}')
        await send({'cmd':'raw','m':{'t':'slow','d':{
            'v':1,'on':1,'since':0,'n':'Peer Nodric','dn':'Peer Nodric',
            'r':0,'c':'warrior','l':3,'rr':1}}})
        await send({'cmd':'raw','m':{'t':'fast','d':{
            's':1,'t':1,'p':position,'y':0,'v':[0,0],'a':0,'h':1,'m':200,
            'd':0,'mo':0,'ph':0,'sw':0,'st':0,'cs':0,'fl':0,'tg':'','ev':[]}}})
        await page.wait_for_function("""({peer,x,z})=>{
          const r=__hm.net.NET.peers.get(peer);
          return r?.slow?.n==='Peer Nodric' && r.fast && r.fast.s===1 &&
                 Math.abs(r.fast.x-x)<.1 && Math.abs(r.fast.z-z)<.1;
        }""",arg={'peer':peer_id,'x':position[0],'z':position[2]},timeout=15000)
        check(True,'the recovered browser receives another real peer profile and fast position')
        # A small player turn makes the normal pump publish a fresh fast state.
        await page.evaluate('__hm.GAME.player.yaw+=.1')
        browser_peer=await page.evaluate('__hm.net.state().self')
        state=None
        for _ in range(60):
            await send({'cmd':'state'})
            state=await receive('state')
            other=state.get('peers',{}).get(browser_peer,{})
            if other.get('name')=='Local Aldwin' and other.get('n',0)>0: break
            await asyncio.sleep(.25)
        other=(state or {}).get('peers',{}).get(browser_peer,{})
        check(other.get('name')=='Local Aldwin' and other.get('n',0)>0,
              'the second real peer receives the resumed browser profile and fast state')
        (hm.OUT/'net-cold-reconnect-traffic.json').write_text(
            json.dumps({'browserPeer':browser_peer,'otherPeer':peer_id,'other':other},indent=2),encoding='utf-8')
    finally:
        if process.returncode is None:
            try:
                await send({'cmd':'quit'})
                await asyncio.wait_for(process.wait(),5)
            except (BrokenPipeError,ConnectionResetError,asyncio.TimeoutError):
                if process.returncode is None:
                    process.kill()
                    await process.wait()

OBSERVE = r"""(() => {
 window.__hmNetTest = {stalls:0};
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

async def recover_local_game(browser, backend, seeded):
    local={
        'v':1,
        'char':{'name':'Local Aldwin','realm':0,'cls':'warrior','level':3,'xp':29,'rp':0,
                'kills':0,'realmKills':0,'deaths':0,'played':31,'gold':42,'potions':3,'bag':[],'eq':{}},
        'settings':{'quality':'high','auto':True},'world':None,
    }
    local_text=json.dumps(local,separators=(',',':'))
    proxy=NativeProxy(free_port(),backend)
    host=f'127.0.0.1:{proxy.port}'
    url=f'ws://{host}/ws'
    init=OBSERVE+'\n'+(
        'localStorage.setItem("hallowmarch.save.v1", '+json.dumps(local_text)+');'
        'localStorage.setItem('+json.dumps(TOKEN_KEY+host)+', '+json.dumps(seeded['token'])+');'
        'localStorage.setItem("hallowmarch.token.other.test", "unrelated-host-token");'
    )
    ctx,page,errors,console_errors,navigations=await direct_page(browser,640,360,init=init)
    try:
        await proxy.start()
        target=ORIGIN+'/?'+urlencode({'safe':'1','server':url,'shard':'late-reconnect'})
        await page.goto(target,wait_until='commit',timeout=120000)
        await asyncio.wait_for(proxy.first_hello.wait(),10)
        check(proxy.stats.get('manifests',0)>0,'proxy forwards the actual public policy before withholding welcome')
        # Delay the actual browser event loop during its real welcome wait.
        await page.evaluate('setTimeout(window.__hmNetTest.stall,6500)')
        await page.wait_for_function('window.__hm && window.__hm.ready',timeout=180000,polling=500)
        await page.wait_for_function('__hm.net.NETWS.lastFailure === "welcome timeout"',timeout=45000,polling=250)
        await asyncio.wait_for(proxy.first_closed.wait(),5)
        before=await page.evaluate(SNAPSHOT)
        check(before['socket']['lastFailure']=='welcome timeout' and proxy.first_closed.is_set(),
              'the real initial handshake deadline fails and physically closes its transport')
        check(before['backend']=='local' and not before['ref'] and before['loaded']=='Local Aldwin',
              'failed initial handshake loads the existing local character')
        check(proxy.stats['welcomes']==0 and before['socket']['state']!='on' and proxy.stats['forwarded']==0,
              'the proxy withholds initial welcome and opening alone never claims authentication')
        check(before['stored']==local_text,'cold connection failure preserves the existing local save')
        check(before['stalls']==1,'real browser handshake deadline survives a CPU startup stall')
        await expect(page.locator('#btn-continue')).to_be_visible()
        await page.locator('#btn-continue').evaluate('button=>button.click()')
        await page.wait_for_function('__hm.GAME.started && __hm.GAME.player?.name === "Local Aldwin"',timeout=30000)
        started=await page.evaluate(SNAPSHOT)
        check(started['name']=='Local Aldwin' and started['xp']>=29,
              'Continue starts the selected local character before multiplayer recovers')
        await proxy.allow()
        await page.wait_for_function('__hm.net.state().state === "on" && __hm.net.state().kind === "ws"',timeout=60000,polling=250)
        for _ in range(60):
            if any(m['t']=='slow' and m['name']=='Local Aldwin' for m in proxy.wire): break
            await asyncio.sleep(.25)
        recovered=await page.evaluate(SNAPSHOT)
        check(recovered['socket']['account']==seeded['id'],
              'late reconnect authenticates the original host-specific account')
        check(recovered['network']['state']=='on' and proxy.stats['welcomes']==1,
              'the real server welcome attaches the resumed game exactly once')
        check(recovered['name']=='Local Aldwin' and recovered['loaded']=='Local Aldwin' and
              recovered['backend']=='local' and not recovered['ref'],
              'late presence reconnect leaves the running character and save backend local')
        check(proxy.stats['live']==1 and proxy.stats['maxLive']==1,
              'cold failures and recovery keep one physical inbound socket')
        check(any(m['t']=='slow' and m['name']=='Local Aldwin' for m in proxy.wire),
              'the resumed local character publishes its profile to the actual server')
        check(not any(m['t'] in ('load','save','wipe') for m in proxy.wire),
              'presence recovery performs no account save read, upload or wipe')
        await peer_traffic(page,backend)
        await page.evaluate('async()=>{__hm.GAME.prog.xp+=17;await __hm.fn.saveNow();await __hm.SAVE.chain;}')
        saved=await page.evaluate(SNAPSHOT)
        local_saved=json.loads(saved['stored'])
        check(local_saved['char']['name']=='Local Aldwin' and local_saved['char']['xp']>=46 and
              saved['backend']=='local' and not saved['ref'],
              'progress after reconnect continues saving only to the local character')
        check(await page.evaluate('localStorage.getItem("hallowmarch.token.other.test")')=='unrelated-host-token',
              'reconnect preserves credentials belonging to another server')
        remote=await fixture(backend,'load',seeded['token'])
        check(remote['id']==seeded['id'] and remote['save']==seeded['save'],
              'the preexisting server character remains structurally unchanged')
        created_after_recovery=proxy.stats['created']
        await page.wait_for_timeout(2000)
        final=await page.evaluate(SNAPSHOT)
        check(proxy.stats['created']==created_after_recovery and proxy.stats['live']==1,
              'a recovered connection does not keep retrying in the background')
        check(not final['errors'] and not errors and not proxy.errors,
              'cold timeout and successful late reconnect produce no runtime or proxy errors')
        check(len(navigations)==1,'multiplayer recovery requires no reload or navigation')
        await page.screenshot(path=str(hm.OUT/'net-cold-reconnect.png'),timeout=120000)
    except Exception:
        evidence={'proxy':dict(proxy.stats),'firstCloseCode':proxy.first_close_code,'proxyErrors':list(proxy.errors),
                  'wire':list(proxy.wire),'pageErrors':list(errors),'consoleErrors':list(console_errors),
                  'navigations':list(navigations)}
        try: evidence['state']=await page.evaluate(SNAPSHOT)
        except Exception as diagnostic_error: evidence['diagnosticError']=str(diagnostic_error)
        (hm.OUT/'net-cold-reconnect-failure.json').write_text(json.dumps(evidence,indent=2),encoding='utf-8')
        print('network failure diagnostics',json.dumps(evidence),flush=True)
        try: await page.screenshot(path=str(hm.OUT/'net-cold-reconnect-failure.png'),timeout=30000)
        except Exception: pass
        raise
    finally:
        try: await ctx.close()
        finally: await proxy.close()

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
                    await recover_local_game(browser,url,seeded)
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
