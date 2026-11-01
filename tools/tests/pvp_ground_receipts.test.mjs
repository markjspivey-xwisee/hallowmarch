import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { parse } from 'acorn';

function declarations(file, names) {
  const source = readFileSync(new URL('../../' + file, import.meta.url), 'utf8');
  const nodes = parse(source, { ecmaVersion: 'latest', sourceType: 'module' }).body;
  return [...new Set(names.map(name => {
    const node = nodes.find(n => n.type === 'FunctionDeclaration' && n.id.name === name
      || n.type === 'VariableDeclaration' && n.declarations.some(d => d.id.name === name));
    assert.ok(node, file + ': ' + name); return source.slice(node.start, node.end);
  }))].join('\n');
}
const actual = declarations('src/14n_net.js', ['netOutHit', 'netOutBuff', 'netHandle', 'netNum', 'netR2', 'NET_BUFFS'])
  + '\n' + declarations('src/14x_netentities.js', ['netEntityAreaAccept']);
function page(faction) {
  const c = vm.createContext({ Math, Number, Object, Array, String, events: [], hits: [], buffs: [], faction });
  vm.runInContext(`const GAME={t:100,started:true,player:{id:1,name:'Player',role:'player',faction,level:10,x:0,y:0,z:0,hp:100,maxHp:100,alive:true}};
    const NET={stats:{hitsOut:0,hitsIn:0,hitsRefused:0,hitsLanded:0,buffsOut:0,buffsIn:0}};
    const netOn=()=>true,netEvent=(kind,to,data)=>events.push({kind,to,data}),performance={now:()=>1000};
    const clamp=(x,a,b)=>Math.max(a,Math.min(b,x)),dist=(x,z,a,b)=>Math.hypot(x-a,z-b);
    const isEnemy=(a,b)=>a.faction!==b.faction,baseDmg=()=>10,ABILITIES={};
    const remote={id:2,role:'remote',netPeer:'b',faction:1-faction,level:10,x:0,y:0,z:0,alive:true,drBase:0,maxHp:100,anim:{flash:0}};
    const R={peer:'a',ghost:remote,hits:[]};
    const onImpact=()=>{};
    function dealDamage(src,dst,n,opts){hits.push({n,opts});dst.hp-=n;return n}
    function addBuff(dst,kind,value,dur,src,extra){buffs.push({kind,value,dur,src,extra})}
  ` + actual, c);
  return { c, run: source => vm.runInContext(source, c), json: source => JSON.parse(vm.runInContext('JSON.stringify(' + source + ')', c)),
    receive(event) { c.event = event; vm.runInContext('netHandle(R,event.kind,event.data)', c); } };
}
function outgoing(withArea = true) {
  const a = page(1);
  a.run(`const area={v:1,shape:'disc',x:0,z:0,r:6};
    netOutHit(GAME.player,remote,12,{kind:'aoe',${withArea ? 'area' : 'dot:true'}});
    netOutBuff(remote,'root',1,2,GAME.player.id,${withArea ? '{blizzard:true,area}' : 'null'});`);
  return a.json('events');
}

test('actual PvP send and receive retain instant ground damage and buff discs', () => {
  const events = outgoing();
  assert.deepEqual(events[0].data.area, { v: 1, shape: 'disc', x: 0, z: 0, r: 6 });
  assert.deepEqual(events[1].data[3], events[0].data.area);
  for (const outside of [false, true]) {
    const b = page(0); if (outside) b.run('GAME.player.x=10');
    for (const event of events) b.receive(event);
    assert.equal(b.run('GAME.player.hp'), outside ? 100 : 88);
    assert.equal(b.run('buffs.length'), outside ? 0 : 1);
    if (!outside) {
      assert.deepEqual(b.json('hits[0].opts.area'), events[0].data.area);
      assert.deepEqual(b.json('buffs[0].extra.area'), events[0].data.area);
    }
  }
});

test('malformed present PvP damage and crowd-control discs cannot become unmarked effects', () => {
  for (const area of [null, {}, { v: 1, shape: 'disc', x: 0, z: 0, r: -1 },
    { v: 1, shape: 'disc', x: 0, z: 0, r: 1000 }, { v: 1, shape: 'disc', x: null, z: 0, r: 6 }]) {
    const events = outgoing(); events[0].data.area = area; events[1].data[3] = area;
    const b = page(0); for (const event of events) b.receive(event);
    assert.equal(b.run('GAME.player.hp'), 100); assert.equal(b.run('buffs.length'), 0);
  }
});

test('legacy direct hits, accepted DOT and targeted crowd control retain their original behavior', () => {
  const events = outgoing(false);
  assert.equal(Object.hasOwn(events[0].data, 'area'), false); assert.equal(events[1].data.length, 3);
  const b = page(0); b.run('GAME.player.x=10');
  for (const event of events) b.receive(event);
  assert.equal(b.run('GAME.player.hp'), 88); assert.equal(b.run('buffs.length'), 1);
  b.receive({ kind: 'hit', data: { a: 7, k: 'melee', dt: 0 } });
  assert.equal(b.run('GAME.player.hp'), 81);
  b.run('GAME.player.x=40'); b.receive(events[0]);
  assert.equal(b.run('GAME.player.hp'), 69, 'accepted unmarked DOT retains the existing ranged reach');
});

test('the actual server fast-event relay preserves both area schemas and deduplicates event sequence', () => {
  const events = outgoing().map((e, i) => [i + 1, e.kind, 'b', e.data]);
  const c = vm.createContext({ Math, Number, Object, Array, Map, Set, Date, events, sends: [] });
  vm.runInContext(`const STATS={badMsgs:0,evDropped:0,relayed:0,hitsFar:0},CFG={interest:200,maxPace:30},SEASON={},KEEP_REGION=[];
    const room={clients:new Map(),diagnostic:true};
    const sender={peer:'a',room,realm:1,region:'valley',pos:null},recipient={peer:'b',room,realm:0,pos:{x:10,z:0}};
    room.clients.set('a',sender);room.clients.set('b',recipient);
    const isHumanPlaying=()=>true,regionOf=()=> 'valley',roomHost=()=>sender;
    const dist=(a,b)=>Math.hypot(a.x-b.x,a.z-b.z),send=(to,message)=>sends.push({to:to.peer,message});
  ` + declarations('server/server.js', ['evFor', 'onFast']), c);
  vm.runInContext('onFast(sender,{p:[0,0,0],ev:events});onFast(sender,{p:[0,0,0],ev:events})', c);
  const relayed = JSON.parse(vm.runInContext('JSON.stringify(sends)', c));
  assert.deepEqual(relayed[0].message.fast.ev, events);
  assert.deepEqual(relayed[1].message.fast.ev, []);
});
