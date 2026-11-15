import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { parse } from 'acorn';

function actual(file, names) {
  const source = readFileSync(new URL('../../' + file, import.meta.url), 'utf8');
  const ast = parse(source, { ecmaVersion: 'latest', sourceType: 'module' }).body;
  return names.map(name => { const node = ast.find(n => n.type === 'FunctionDeclaration' && n.id.name === name); assert.ok(node, name); return source.slice(node.start, node.end); }).join('\n');
}
const oldProfile = { on: 1, sharedScene: 2, realmManagement: 1, seasonField: 2, warbandOrders: 1, humanLive: 1, humanActivity: 1 };
const currentProfile = { ...oldProfile, sharedCombat: 1, actorDevelopment: 1 };
function server() {
  const c = vm.createContext({ Math, Number, Object, Array, Map, Set, JSON, Date, Buffer, packets: [], closes: [], updates: 0, admitted: 0, writes: 0 });
  vm.runInContext(`const STATS={msgs:0,bytesIn:0,badMsgs:0},CFG={maxMsg:65536,maxSave:1e6},WORLDS={},WORLD_STATE=null,nativePlayersRequired=true;
    const PLAYER_ACCOUNTS={humanPrincipalFor:()=>({id:'native-owner'})};
    const isHumanPlaying=c=>c.live===true;
    const HUMAN_PLAY={update(c){updates++;c.live=true;return true}};
    const realmManagementReloadRequired=()=>false;
    const send=(c,m)=>packets.push(m),accountsSave=()=>writes++,clearTimeout=()=>{};
    const onSlow=(c,d)=>{admitted++;c.slow=d};
    const room={name:'march',clients:new Map()};
    const owner={peer:'old',acct:{id:'owner'},room,since:1,winT:Date.now(),winN:0,pendingAccountSave:true,
      ws:{readyState:1,close(code,reason){closes.push({code,reason});this.readyState=3}}};
    room.clients.set(owner.peer,owner);
  ` + actual('server/server.js', ['roomNeedsWarbandOrders', 'roomHost', 'onMsg']), c);
  return { c, run: source => vm.runInContext(source, c), json: source => JSON.parse(vm.runInContext('JSON.stringify(' + source + ')', c)),
    profile(profile) { c.input = profile; vm.runInContext('onMsg(owner,JSON.stringify({t:"slow",d:input}))', c); } };
}

test('the current production profile advertises both combat and actor development contracts', () => {
  const c = vm.createContext({ Math, Number, Object, Array });
  vm.runInContext(`const GAME={player:null,prog:null},NET={since:1},NETWS={url:'wss://march'},NET_HUMAN_PLAY={activity:1};
    const netHumanLive=()=>true,netSharedWorldReady=()=>false;` + actual('src/14n_net.js', ['netSlowObj']), c);
  const profile = vm.runInContext('netSlowObj()', c);
  assert.equal(profile.sharedCombat, 1); assert.equal(profile.actorDevelopment, 1);
});

test('an old open client is refused before human admission, profile writes or world authority', () => {
  for (const profile of [oldProfile, { ...currentProfile, sharedCombat: 0 }, { ...currentProfile, actorDevelopment: 0 }]) {
    const f = server(); assert.equal(f.run('roomHost(room)'), null);
    f.profile(profile);
    assert.equal(f.run('updates'), 0); assert.equal(f.run('admitted'), 0); assert.equal(f.run('writes'), 0);
    assert.equal(f.json('packets[0]').t, 'reload-required'); assert.equal(f.json('closes[0]').code, 4006);
    f.c.profile = profile; f.run('owner.slow=profile;owner.live=true');
    assert.equal(f.run('roomHost(room)'), null, 'retaining an old presence cannot confer keeper authority');
  }
});

test('a current client passes actual admission and becomes eligible to keep the world', () => {
  const f = server(); f.profile(currentProfile);
  assert.equal(f.run('updates'), 1); assert.equal(f.run('admitted'), 1);
  assert.equal(f.run('closes.length'), 0); assert.equal(f.run('roomHost(room)===owner'), true);
});

test('the existing old-client reload handler preserves the private career and stops shared simulation', () => {
  const c = vm.createContext({ Math, Number, Object, Array, suspended: 0, resets: 0 });
  vm.runInContext(`const GAME={started:true,player:{name:'Career',level:17}},SAVE={pending:{xp:37}},NETWS={};
    const netStr=s=>String(s||''),netHumanSuspend=()=>suspended++,netSharedSceneReset=()=>resets++,uiLog=()=>{},uiToast=()=>{};
  ` + actual('src/14p_netws.js', ['netSceneReloadRequired']), c);
  vm.runInContext('netSceneReloadRequired("Reload Hallowmarch. Your saved character is preserved.")', c);
  assert.equal(vm.runInContext('NETWS.reload&&NETWS.worldReloadRequired', c), true);
  assert.equal(vm.runInContext('suspended', c), 1); assert.equal(vm.runInContext('resets', c), 1);
  assert.equal(vm.runInContext('GAME.player.level', c), 17); assert.equal(vm.runInContext('SAVE.pending.xp', c), 37);
});
