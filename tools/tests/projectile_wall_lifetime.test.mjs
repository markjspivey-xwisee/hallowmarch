import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { parse } from 'acorn';

const entities = readFileSync(new URL('../../src/07_entities.js', import.meta.url), 'utf8');
const walls = readFileSync(new URL('../../src/07g_walls.js', import.meta.url), 'utf8');
function declaration(source, name) {
  const node = parse(source, { ecmaVersion: 'latest', sourceType: 'module' }).body
    .find(n => n.type === 'FunctionDeclaration' && n.id.name === name);
  assert.ok(node, name); return source.slice(node.start, node.end);
}
function fixture(obstacle, age = 3.49) {
  const c = vm.createContext({ Math });
  vm.runInContext(`
    const GAME={t:10},WALLS={on:true,stats:{}},WALL_PROJ_SKIP={},rays=[],strikes=[];
    const target={id:2,x:100,y:0,z:0,alive:true,kind:'humanoid'},source={id:1,faction:0,ai:{}};
    const PROJ=[{kind:'fire',age:${age},life:3.5,speed:24,x:0,y:0,z:0,ox:0,oy:0,oz:0,tgt:2,src:1}];
    const getEnt=id=>id===2?target:source,wallsAimY=e=>e.y,dist2=(x,z,a,b)=>(x-a)**2+(z-b)**2;
    function shotHit(ax,ay,az,bx,by,bz){
      rays.push({from:ax,to:bx});const obstacle=${obstacle};
      return obstacle>ax&&obstacle<=bx?{what:'wall',t:(obstacle-ax)/(bx-ax),x:obstacle,y:0,z:0}:null;
    }
    function wallStrike(kind,hit){strikes.push({kind,x:hit.x})}
  ` + declaration(walls, 'wallsProj') + '\n' + declaration(entities, 'updateProjectiles'), c);
  return { run: s => vm.runInContext(s, c), json: s => JSON.parse(vm.runInContext(`JSON.stringify(${s})`, c)) };
}

test('the actual wall check cannot project an expiring fire projectile to a distant wall', () => {
  const f = fixture(50);
  f.run('updateProjectiles(.05)');
  assert.equal(f.run('PROJ.length'), 0);
  assert.deepEqual(f.json('strikes'), [], 'the distant wall cannot receive a fire strike after projectile expiry');
  assert.ok(f.run('rays.length>0'));
  assert.ok(f.run('rays.every(r=>r.to<.481)'), 'the clearance lookahead uses only two remaining-lifetime steps');
});

test('wall clearance may look ahead but cannot strike beyond the remaining live step', () => {
  const f = fixture(.3);
  f.run('updateProjectiles(.05)');
  assert.deepEqual(f.json('strikes'), []);
  assert.equal(f.run('PROJ.length'), 0);
});

test('a wall reached during the final live step still receives the actual impact', () => {
  const f = fixture(.2);
  f.run('updateProjectiles(.05)');
  assert.deepEqual(f.json('strikes'), [{ kind: 'fire', x: .2 }]);
  assert.equal(f.run('PROJ.length'), 0);
});

test('a projectile already at its lifetime cannot perform any wall query or impact', () => {
  const f = fixture(.1, 3.5);
  f.run('updateProjectiles(.05)');
  assert.equal(f.run('PROJ.length'), 0);
  assert.deepEqual(f.json('rays'), []);
  assert.deepEqual(f.json('strikes'), []);
});
