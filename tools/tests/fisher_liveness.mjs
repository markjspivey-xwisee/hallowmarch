// Deterministic NPC approach regressions using the actual house/fisher lifecycle
// and JS localPath implementation. A small flat-world collider fixture replaces
// rendering, combat and boat physics; this does not replace water2's full trip.
// Run: node --test tools/tests/fisher_liveness.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
const root = process.env.HM_FISHER_SOURCE_ROOT || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const town = fs.readFileSync(path.join(root, 'src/08f_townlife.js'), 'utf8');
const boats = fs.readFileSync(path.join(root, 'src/07e_boats.js'), 'utf8');
function part(source, from, to) { const start = source.indexOf(from), end = source.indexOf(to, start); assert(start >= 0 && end > start, 'Source fixture boundaries must exist'); return source.slice(start, end); }
const code = [
  part(town, 'function houseLife(e, dt) {', '// [v10] the way round'),
  part(town, 'const _lpC =', '// each house gets its people'),
  part(town, 'const lifeStep =', '// from anywhere in town'),
  part(town, 'function houseLeavePlan(e, H) {', 'function houseShutterPlan'),
  part(town, 'function lifeRun(e, dt) {', '// walking about the town'),
  part(boats, 'function fisherMorning()', '// 08f_townlife.js asks'),
  part(boats, 'function boatLife(e, dt) {', '/* ------------------------------------------------------------------ */\n/* a hull is solid'),
  'function lpSearch(...args) { return lpSearchJS(...args); }',
].join('\n');
function fixture({ blocked = false, wall = true } = {}) {
  const H = { state: 'intact', wins: [], inside: false, door: { in: { x: 0, z: 0 }, c: { x: 1, z: 0 }, out: { x: 1.5, z: 0 }, out2: { x: 2, z: 0 } } };
  const B = { st: 'moored', rider: null }, J = { realm: 0, cx: 8, cz: 0, land: { x: 8, z: 0 }, end: { x: 8, z: 0 }, fisher: null, boats: [B], steps: [{ x: 8, z: 0 }], berths: [{ x: 8, z: 0, yaw: 0 }] };
  const obstacle = { active: true, type: 'box', tag: 'stone', x: 4, z: 0, hx: 1, hz: 1.5, cos: 1, sin: 0 };
  const actor = { id: 228, role: 'villager', x: 0, z: 0, speed: 2, alive: true, fixedY: null, ai: { house: H } };
  const calls = { moved: 0, blocked: 0, boarded: 0, penetrated: 0 };
  const fakeMath = Object.create(Math); fakeMath.random = () => 0;
  const context = { Math: fakeMath, performance, console, GAME: { t: 100, player: null }, HOUSES: [H], BOATS: { built: true, jetties: [J] }, LAKES: [{ realm: 0, x: 8, z: 10, r: 4 }],
    tod: { p: 2.8 }, WEATHER: { storm: 0 }, _bW: {}, TAU: Math.PI * 2,
    CLS: { ice: [] }, SICE: { on: false }, DUN_X0: 10000, HALF: 200, HS: 1, HN: 401, W: { walk: new Uint8Array(401 * 401) },
    clamp: (value, min, max) => Math.max(min, Math.min(max, value)),
    dist2: (ax, az, bx, bz) => (ax - bx) ** 2 + (az - bz) ** 2, heightAt: () => 0, isWalkable: () => true, realmAt: () => 0,
    collidersNear: (x, z, radius, output) => { output.length = 0; if (wall) output.push(obstacle); },
    houseHas: house => house.inside, houseIntact: () => true, houseBurningNear: () => null, houseCrewCall: () => {}, houseWantsShut: () => false,
    farmLife: () => false, loopsLife: () => false, lifeWander: () => {}, lifeIdle: () => {}, turnToward: () => {}, splashAt: () => {}, setAct: () => {},
    jettyAt: (x, z) => Math.hypot(x - J.land.x, z - J.land.z) < 1,
    waterAt: () => ({ depth: 3, y: 0 }), floorAt: () => 0,
    boatBoard: (boat, e) => { calls.boarded++; boat.rider = e.id; e.boat = boat; }, boatPhys: () => null, boatPose: () => {}, boatSeat: () => {},
    moveToward: (e, tx, tz, dt, speed = 1, stop = .3) => {
      const dx = tx - e.x, dz = tz - e.z, d = Math.hypot(dx, dz); if (d <= stop) return true;
      if (blocked) { calls.blocked++; return false; }
      const n = Math.min(d - stop * .5, e.speed * speed * dt);
      let nx = e.x + dx / d * n, nz = e.z + dz / d * n;
      // Flat axis-aligned equivalent of the game's collision slide: a body
      // touching a corner can move along the wall, but never through it.
      if (wall && Math.abs(nx - obstacle.x) < obstacle.hx + .4 && Math.abs(nz - obstacle.z) < obstacle.hz + .4) {
        calls.blocked++;
        const px = obstacle.hx + .4 - Math.abs(nx - obstacle.x), pz = obstacle.hz + .4 - Math.abs(nz - obstacle.z);
        if (px < pz) nx = obstacle.x + Math.sign(nx - obstacle.x) * (obstacle.hx + .4);
        else nz = obstacle.z + Math.sign(nz - obstacle.z) * (obstacle.hz + .4);
      }
      if (wall && Math.abs(nx - obstacle.x) < obstacle.hx + .399 && Math.abs(nz - obstacle.z) < obstacle.hz + .399) calls.penetrated++;
      calls.moved++; e.x = nx; e.z = nz; return false;
    }, actor, J, B,
  };
  vm.createContext(context); vm.runInContext(code, context);
  const run = source => vm.runInContext(source, context);
  const step = (duration, dt = .1) => { for (let t = 0; t < duration; t += dt) { context.GAME.t += dt; run(`houseLife(actor,${dt})`); } };
  return { context, actor, H, J, B, calls, run, step };
}

test('a fisher follows the real localPath around a wall and reaches its boat', () => {
  const F = fixture(); F.run('boatLife(actor,0.1)');
  assert.equal(F.actor.ai.fisher.st, 'walk');
  const approach = F.actor.ai.plan.steps.at(-1);
  assert(approach.path?.some(p => Math.abs(p.z) > 1.5), 'The wall requires a real detour, not a straight walk');
  assert(approach.T > 16 + 8 / 1.2, 'Travel budget includes the route distance');
  for (let i = 0; i < 500 && F.actor.ai.fisher?.st === 'walk'; i++) F.step(.1);
  assert.equal(F.actor.ai.fisher.st, 'out', JSON.stringify({position:[F.actor.x,F.actor.z],plan:F.actor.ai.plan && {i:F.actor.ai.plan.i,t:F.actor.ai.plan.t,step:F.actor.ai.plan.steps[F.actor.ai.plan.i]},fisher:{t:F.actor.ai.fisher.t,tries:F.actor.ai.fisher.tries},calls:F.calls}, (k,v) => ['fisher','room'].includes(k) ? undefined : v)); assert.equal(F.B.rider, F.actor.id); assert.equal(F.calls.boarded, 1);
  assert.equal(F.calls.penetrated, 0, 'The fisher cannot pass through the wall');
});

test('an obstructed approach releases its reservation by the absolute deadline while its life plan is running', () => {
  const F = fixture({ blocked: true, wall: false }); F.actor.x = 100; F.J.land.x = 0;
  F.run('boatLife(actor,0.1)'); const fisherman = F.actor.ai.fisher;
  assert(fisherman && F.actor.ai.plan); const deadline = fisherman.until;
  F.step(deadline - F.context.GAME.t + .5, .5);
  assert(F.calls.blocked > 0); assert.equal(F.actor.ai.fisher, null); assert.equal(F.J.fisher, null);
  assert.equal(F.actor.ai.plan, null); assert.equal(F.B.rider, null); assert(F.actor.ai.fishWait > F.context.GAME.t);
});

test('expiring a fishing approach preserves an unrelated safety plan and another current reservation', () => {
  const F = fixture({ blocked: true, wall: false }); F.run('boatLife(actor,0.1)');
  const safetyPlan = { flee: F.H, steps: [{ k: 'wait', dur: 500, fx: 0, fz: 0 }], i: 0, t: 0 };
  F.actor.ai.plan = safetyPlan; F.J.fisher = 999; F.B.rider = 999;
  F.context.GAME.t = F.actor.ai.fisher.until; F.run('houseLife(actor,0.1)');
  assert.equal(F.actor.ai.fisher, null); assert.equal(F.actor.ai.plan, safetyPlan);
  assert.equal(F.J.fisher, 999); assert.equal(F.B.rider, 999);
});

test('the approach deadline does not cancel a fisher already fishing', () => {
  const F = fixture({ wall: false }); F.run('boatLife(actor,0.1)'); const fisherman = F.actor.ai.fisher;
  F.actor.ai.plan = null; fisherman.st = 'fish'; fisherman.t = 0; fisherman.dur = 1000;
  F.B.rider = F.actor.id; F.actor.boat = F.B; F.context.GAME.t = fisherman.until + 1;
  F.run('houseLife(actor,0.1)'); assert.equal(F.actor.ai.fisher, fisherman); assert.equal(F.B.rider, F.actor.id);
});

test('a fisher already at the jetty handles an empty localPath and boards', () => {
  const F = fixture({ wall: false }); F.actor.x = F.J.land.x;
  F.run('boatLife(actor,0.1)'); for (let i = 0; i < 5 && F.actor.ai.fisher?.st === 'walk'; i++) F.step(.1);
  assert.equal(F.actor.ai.fisher.st, 'out'); assert.equal(F.B.rider, F.actor.id);
});

test('a fisher inside its house plans the outdoor route from the door exit', () => {
  const F = fixture(); F.H.inside = true;
  const steps = F.run('boatWalkPlan(actor,J)');
  assert.equal(steps[0].room, F.H); assert.equal(steps.at(-2).x, F.H.door.out2.x);
  assert(steps.at(-1).path?.length > 1); assert(steps.at(-1).path.some(p => Math.abs(p.z) > 1.5));
});
