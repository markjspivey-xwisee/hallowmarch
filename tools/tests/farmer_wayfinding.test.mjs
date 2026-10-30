import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {parse} from 'acorn';

const files = Object.fromEntries(['08h_farming.js', '08i_farm_draw.js', '10_ui.js', '10e_guide.js']
  .map(file => [file, readFileSync(new URL('../../src/' + file, import.meta.url), 'utf8')]));
const trees = Object.fromEntries(Object.entries(files).map(([file, source]) => [file, parse(source, {ecmaVersion: 'latest'})]));
function actual(file, names) {
  return names.map(name => {
    const node = trees[file].body.find(n => n.type === 'FunctionDeclaration' && n.id.name === name
      || n.type === 'VariableDeclaration' && n.declarations.some(d => d.id.name === name));
    assert(node, `Actual declaration ${name}`); return files[file].slice(node.start, node.end);
  }).join('\n');
}
const source = [actual('08h_farming.js', ['farmSeedSeller', 'farmServiceName', 'farmOffers']),
  actual('08i_farm_draw.js', ['drawFarmSellerIcon', 'drawFarmMap', 'farmMapSide']),
  actual('10_ui.js', ['unitSub', 'minimapObserveSize', 'drawMinimap']), actual('10e_guide.js', ['GUIDE_DIRS'])].join('\n');

function canvas() {
  const commands = [], stack = [], ctx = {commands, fillStyle: '#original', strokeStyle: '#stroke', globalAlpha: .4, lineWidth: 7, lineJoin: 'bevel'};
  const state = () => Object.fromEntries(['fillStyle', 'strokeStyle', 'globalAlpha', 'lineWidth', 'lineJoin'].map(key => [key, ctx[key]]));
  ctx.state = state; ctx.save = () => {stack.push(state()); commands.push(['save']);};
  ctx.restore = () => {assert(stack.length); Object.assign(ctx, stack.pop()); commands.push(['restore']);};
  for (const method of ['translate', 'scale', 'rotate', 'beginPath', 'moveTo', 'lineTo', 'closePath', 'fill', 'stroke',
    'bezierCurveTo', 'fillRect', 'arc', 'drawImage', 'fillText']) ctx[method] = (...args) => commands.push([method, ...args]);
  return ctx;
}
function fixture() {
  const seller = {id: 2, name: 'Ailith', role: 'villager', faction: 3, alive: true, x: 100, z: -40, farmTown: 0,
    ai: {seedSeller: true, farmer: true, fieldHand: true}};
  const foreign = {...seller, id: 3, name: 'Soren', farmTown: 1, x: -80, ai: {...seller.ai}};
  const player = {id: 1, faction: 0, x: 0, z: 0, level: 1, yaw: 0, target: null};
  const entities = new Map([[seller.id, seller], [foreign.id, foreign]]), ctx = canvas();
  const cv = {width: 186, height: 186, clientWidth: 186, getContext: () => ctx};
  let nearPasses = 0, opened = null;
  const quietMath = Object.create(Math); quietMath.random = () => {throw Error('Display must not consume RNG');};
  const c = vm.createContext({Math: quietMath, Number, FARM: {farmers: [2, 3], plots: [], built: true, job: true},
    GAME: {player, t: 0}, SEASON: {temp: 12}, farmTempAt: () => 12, seasonLabel: () => 'Spring',
    getEnt: id => entities.get(id) || null, dist: (x, z, a, b) => Math.hypot(a - x, b - z),
    esc: value => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'),
    openFarmer: e => {opened = e;}, TAU: Math.PI * 2, FACTION_NEUTRAL: 3, FACTION_MONSTER: 4,
    UI: {mapImg: {}, mmN: {dpr: 1, fontsIn: true}}, INDOOR: {on: false}, WAR: {keeps: [], temples: [], relics: []},
    REALMS: [], DRAGON: {}, BARROW: {x: 0, z: 0}, CAM: {yaw: 0}, WSIZE: 2048, HALF: 1024,
    $: id => id === 'minimap' ? cv : null, window: {devicePixelRatio: 1}, document: {fonts: {status: 'loaded'}},
    forNear: (x, z, range, fn) => {nearPasses++; for (const e of entities.values()) fn(e);},
    drawSiteIcon() {}, drawBarrowIcon() {}, drawTrackedMinimap() {}, drawCampaignMinimap() {}, guideMinimap() {}, netMinimap() {},
    conIndex: () => 0, CON: [{name: 'even', col: '#fff'}]});
  vm.runInContext(source, c);
  return {c, seller, foreign, player, entities, ctx, get nearPasses() {return nearPasses;}, get opened() {return opened;}};
}

test('only a current live assigned seed seller receives the service role, including a foreign neutral seller', () => {
  const f = fixture(); assert.equal(f.c.farmSeedSeller(f.seller), true); assert.equal(f.c.farmSeedSeller(f.foreign), true);
  for (const change of [{alive: false}, {removed: true}, {netNpcMissing: true}, {role: 'merchant'}, {x: NaN}, {z: Infinity}, {ai: {fieldHand: true}}]) {
    const changed = {...f.seller, ...change}; f.entities.set(2, changed);
    assert.equal(f.c.farmSeedSeller(changed), false); f.entities.set(2, f.seller);
  }
  f.c.FARM.farmers = [3]; assert.equal(f.c.farmSeedSeller(f.seller), false);
  f.c.FARM.built = false; assert.equal(f.c.farmSeedSeller(f.foreign), false); f.c.FARM.built = true;
  f.c.FARM.farmers = [2, 3]; f.entities.set(2, {...f.seller}); assert.equal(f.c.farmSeedSeller(f.seller), false, 'Stale object must not inherit a replacement actor role');
});

test('display names and target subtitles expose the service without changing actor facts or original offer text/action', () => {
  const f = fixture(), before = JSON.stringify([...f.entities.values()]), offers = [];
  assert.equal(f.c.farmServiceName(f.seller), 'Ailith · Seeds & tools');
  assert.equal(f.c.unitSub(f.foreign, f.player), 'Farmer · Seeds & tools');
  f.c.farmOffers(f.player, (...args) => offers.push(args));
  assert.equal(offers[0][2], 'Buy seed and tools from Ailith the farmer');
  assert.equal(offers[0][1], 3.2); offers[0][3](); assert.equal(f.opened, f.seller);
  assert.equal(JSON.stringify([...f.entities.values()]), before);
  f.c.FARM.farmers = []; assert.equal(f.c.farmServiceName(f.seller), 'Ailith'); assert.equal(f.c.unitSub(f.seller, f.player), 'Villager');
  const plate = trees['10_ui.js'].body.find(n => n.type === 'FunctionDeclaration' && n.id.name === 'updateNameplates');
  assert.match(files['10_ui.js'].slice(plate.start, plate.end), /const txt = farmServiceName\(e\)/, 'Actual pooled nameplate consumes the display-only label');
});

test('full-map symbols follow moving assigned actors and disappear when unavailable, without a world scan', () => {
  const f = fixture(), projected = [];
  f.c.drawFarmMap(f.ctx, (x, z) => {projected.push([x, z]); return [x + 10, z + 20];}, 1);
  assert.deepEqual(projected, [[100, -40], [-80, -40]]);
  f.seller.x = 160; f.seller.z = 42; f.foreign.alive = false; projected.length = 0;
  f.c.drawFarmMap(f.ctx, (x, z) => {projected.push([x, z]); return [x, z];}, 1);
  assert.deepEqual(projected, [[160, 42]]);
  f.seller.netNpcMissing = true; projected.length = 0;
  f.c.drawFarmMap(f.ctx, (x, z) => {projected.push([x, z]); return [x, z];}, 1); assert.deepEqual(projected, []);
});

test('the vector service glyph restores caller canvas state and contains no font/text dependency', () => {
  const f = fixture(), before = f.ctx.state(); f.c.drawFarmSellerIcon(f.ctx, 12, 19, 5);
  assert.deepEqual(f.ctx.state(), before); assert.deepEqual(f.ctx.commands[1], ['translate', 12, 19]);
  assert(f.ctx.commands.some(row => row[0] === 'bezierCurveTo')); assert(!f.ctx.commands.some(row => row[0] === 'fillText'));
  assert.equal(f.ctx.commands.filter(row => row[0] === 'save').length, f.ctx.commands.filter(row => row[0] === 'restore').length);
});

test('the actual minimap uses its single existing nearby pass, clips sellers and avoids duplicate full-map markers', () => {
  const f = fixture(); f.seller.x = 20; f.seller.z = 0; f.foreign.x = 900;
  f.c.drawMinimap(); assert.equal(f.nearPasses, 1);
  assert.equal(f.ctx.commands.filter(row => row[0] === 'scale' && row[1] === 5).length, 1, 'Only the in-range seller gets one service glyph');
  assert.equal(f.ctx.commands.filter(row => row[0] === 'scale' && row[1] === 6).length, 0, 'The plot hook must not duplicate seller glyphs');
});

test('a seller working in the center of a crop plot remains above the plot paint on the actual minimap', () => {
  const f = fixture(); f.seller.x = 20; f.seller.z = 0; f.foreign.x = 900;
  f.c.FARM.plots = [{x: 20, z: 0, ang: 0, hw: 5, hd: 6, plants: []}];
  f.c.drawMinimap(); const commands = f.ctx.commands;
  const plot = commands.findIndex(row => row[0] === 'fillRect' && row[1] < 0 && row[2] < 0);
  const glyph = commands.findIndex(row => row[0] === 'scale' && row[1] === 5);
  assert(plot >= 0 && glyph > plot, 'Service glyph must be drawn after the overlapping plot, not tinted underneath it');
  assert.equal(f.nearPasses, 1);
});

test('map sidebar identifies only the current realm seller, escapes names and uses live distance/direction', () => {
  const f = fixture(); f.seller.name = 'Ailith <Rowan>'; f.seller.x = 160; f.seller.z = 0;
  let html = f.c.farmMapSide(); assert.match(html, /Seeds &amp; tools/); assert.match(html, /Ailith &lt;Rowan&gt;/);
  assert.match(html, /160 m east/); assert(!html.includes('Soren')); assert.match(html, /<svg[^>]+aria-hidden="true"/);
  f.seller.x = 0; f.seller.z = 40; assert.match(f.c.farmMapSide(), /40 m south/);
  f.seller.removed = true; html = f.c.farmMapSide(); assert(!html.includes('Ailith')); assert(!html.includes('current location'));
  f.player.faction = 1; assert.match(f.c.farmMapSide(), /Soren/); f.entities.delete(3); assert(!f.c.farmMapSide().includes('Soren'));
});
