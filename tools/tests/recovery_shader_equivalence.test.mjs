import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import vm from 'node:vm';
import { parse } from 'acorn';

const root = new URL('../../', import.meta.url);
const source = name => readFileSync(new URL('src/' + name, root), 'utf8');

// Execute these small generated GLSL helpers with vector arithmetic on the CPU.
// This checks the actual emitted expressions, including unrolled motif steps;
// the hashes below were recorded from the released helpers before the rewrite.
function glslFunctions(glsl) {
  const js = glsl.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '')
    .replace(/\b(?:float|int|bool|vec[234])\s+(\w+)\s*\(([^)]*)\)/g, (_, name, args) =>
      'function ' + name + '(' + args.replace(/\b(?:float|int|bool|vec[234])\s+/g, '') + ')')
    .replace(/\b(?:float|int|bool|vec[234])\s+/g, 'let ');
  const emit = node => {
    if (!node) return '';
    switch (node.type) {
      case 'Program': return node.body.map(emit).join('\n');
      case 'FunctionDeclaration': return `function ${emit(node.id)}(${node.params.map(emit)})${emit(node.body)}`;
      case 'BlockStatement': return '{' + node.body.map(emit).join('\n') + '}';
      case 'Identifier': return node.name;
      case 'Literal': return JSON.stringify(node.value);
      case 'VariableDeclaration': return 'let ' + node.declarations.map(emit).join(',') + ';';
      case 'VariableDeclarator': return emit(node.id) + (node.init ? '=' + emit(node.init) : '');
      case 'ReturnStatement': return 'return ' + emit(node.argument) + ';';
      case 'ExpressionStatement': return emit(node.expression) + ';';
      case 'AssignmentExpression': return emit(node.left) + node.operator + emit(node.right);
      case 'BinaryExpression': return `$op(${JSON.stringify(node.operator)},${emit(node.left)},${emit(node.right)})`;
      case 'LogicalExpression': return '(' + emit(node.left) + node.operator + emit(node.right) + ')';
      case 'UnaryExpression': return node.operator === '-' ? `$op("-",0,${emit(node.argument)})` : node.operator + '(' + emit(node.argument) + ')';
      case 'UpdateExpression': return node.prefix ? node.operator + emit(node.argument) : emit(node.argument) + node.operator;
      case 'MemberExpression': return emit(node.object) + '.' + emit(node.property);
      case 'CallExpression': return emit(node.callee) + '(' + node.arguments.map(emit).join(',') + ')';
      case 'ConditionalExpression': return '(' + emit(node.test) + '?' + emit(node.consequent) + ':' + emit(node.alternate) + ')';
      case 'IfStatement': return 'if(' + emit(node.test) + ')' + emit(node.consequent) + (node.alternate ? 'else ' + emit(node.alternate) : '');
      case 'ForStatement': return 'for(' + emit(node.init) + emit(node.test) + ';' + emit(node.update) + ')' + emit(node.body);
      default: throw Error('Unsupported helper syntax: ' + node.type);
    }
  };
  const apply = (fn, a, b) => typeof a === 'object' || typeof b === 'object'
    ? Object.fromEntries(Object.keys(typeof a === 'object' ? a : b).map(k => [k, fn(typeof a === 'object' ? a[k] : a, typeof b === 'object' ? b[k] : b)])) : fn(a, b);
  const unary = fn => a => typeof a === 'object' ? Object.fromEntries(Object.entries(a).map(([k, v]) => [k, fn(v)])) : fn(a);
  const operators = { '+': (a, b) => a + b, '-': (a, b) => a - b, '*': (a, b) => a * b, '/': (a, b) => a / b,
    '<': (a, b) => a < b, '<=': (a, b) => a <= b, '>': (a, b) => a > b, '==': (a, b) => a === b };
  const vector = n => (...args) => Object.fromEntries('xyzw'.slice(0, n).split('').map((k, i) => [k, args.length === 1 ? args[0] : args[i]]));
  const ctx = { $op: (op, a, b) => apply(operators[op] || (() => { throw Error('Unsupported operator ' + op); }), a, b),
    min: (a, b) => apply(Math.min, a, b), max: (a, b) => apply(Math.max, a, b), abs: unary(Math.abs),
    length: p => Math.hypot(...Object.values(p)), vec2: vector(2), vec3: vector(3), float: x => x, int: Math.trunc,
    sin: Math.sin, cos: Math.cos, pow: Math.pow, atan: Math.atan2, floor: Math.floor, fract: x => x - Math.floor(x),
    step: (edge, x) => x < edge ? 0 : 1,
    clamp: (v, a, b) => Math.min(b, Math.max(a, v)), mix: (a, b, t) => a * (1 - t) + b * t,
    smoothstep(a, b, x) { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); },
    fwidth: () => 0.01 };
  vm.createContext(ctx);
  vm.runInContext(emit(parse(js, { ecmaVersion: 'latest' })), ctx);
  return ctx;
}

function devices() {
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext(source('04_l3device.js') + '\nthis.glsl=L3_DEVICE_GLSL;', ctx);
  return ctx.glsl;
}
function feet() {
  const text = source('05c_beasts.js'), start = text.indexOf('function beastBodyGLSL('), end = text.indexOf('\n}', start) + 2;
  const ctx = { BB_CLEAR: 0.15, BB_LIFT: 0.055 };
  vm.createContext(ctx);
  const body = vm.runInContext(text.slice(start, end) + '\nbeastBodyGLSL({})', ctx);
  const from = body.indexOf('vec3 bbFoot('), to = body.indexOf('\n  }', from) + 4;
  return body.slice(from, to);
}
function walls() {
  const text = source('04d_look4.js'), ctx = {};
  vm.createContext(ctx);
  vm.runInContext(text.slice(0, text.indexOf('// the same in JS:')) + '\nthis.glsl=LOOK4_STUB_GLSL;', ctx);
  return ctx.glsl;
}
function banners() {
  const text = source('04_props.js'), start = text.indexOf('float emblem('), end = text.indexOf('${L3_DEVICE_GLSL}', start);
  return 'float satan(float y, float x){ return (abs(x) + abs(y) < 1e-7) ? 0.0 : atan(y, x); }\n' +
    'float spow(float x, float y){ return pow(max(0.0, x), y); }\n' + text.slice(start, end);
}
function digest(values) { return createHash('sha256').update(values.map(x => Number(x).toFixed(8)).join(',')).digest('hex'); }
function motifHash(glsl) {
  const fn = glslFunctions(glsl).l3DeviceD, values = [];
  for (let k = 0; k < 10; k++) for (let y = -40; y <= 40; y++) for (let x = -40; x <= 40; x++) values.push(fn({ x: x / 40, y: y / 40 }, k));
  return digest(values);
}
function gaitHash(glsl) {
  const fn = glslFunctions(glsl).bbFoot, values = [];
  for (const duty of [0.08, 0.15, 0.3, 0.46, 0.64, 0.8]) for (const reach of [0, 0.1, 0.4, 0.9, 1.4]) {
    for (let i = -300; i <= 300; i++) {
      const foot = fn(i / 21, duty, reach);
      assert.ok(Object.values(foot).every(Number.isFinite));
      values.push(...Object.values(foot));
    }
  }
  return digest(values);
}
function wallHash(glsl) {
  const fn = glslFunctions(glsl).look4Stub, values = [];
  for (const dims of [-160, -300, 150 * 4096 + 250, 350 * 4096 + 200, 500 * 4096 + 460]) {
    for (const seed of [0, 1, 4, 10, 63]) for (let y = -44; y <= 44; y++) for (let x = -44; x <= 44; x++) {
      const h = fn({ x: x / 6, y: y / 6 }, dims, seed);
      assert.ok(Number.isFinite(h));values.push(h);
    }
  }
  return digest(values);
}
function bannerHash(glsl) {
  const fn = glslFunctions(glsl).emblem, values = [];
  for (let realm = 0; realm < 4; realm++) for (let y = -40; y <= 40; y++) for (let x = -40; x <= 40; x++) values.push(fn({ x: x / 40, y: y / 40 }, realm));
  return digest(values);
}

test('all ten heraldic devices preserve their released signed-distance fields', () => {
  assert.equal(motifHash(devices()), '866d7a9c44beafdb25c8cf8c313d2aca979260ee250d2e4ee1892fec77be8ddf');
});
test('stance, swing and clearance preserve the released gait across speeds and phases', () => {
  assert.equal(gaitHash(feet()), '49c7c392d225d3ecfe73ed5042e496f10fcaeeb8f56adf090b2271a6f5f9956f');
});
test('ragged round and box walls preserve released footprint, porch and corner heights', () => {
  assert.equal(wallHash(walls()), 'f98cd3b935aa0b010f5d1fb214ec5b544682bb20461db638daf51572b6da464a');
});
test('realm banners preserve all released glyphs and the neutral fallback', () => {
  assert.equal(bannerHash(banners()), '85180a740272a78f45b029678ee82ff70de33832ff5e5c6d51b2a0a37519d20d');
});
test('beast leg decoding preserves every bone and rounding boundary without signed division', () => {
  const text = source('05c_beasts.js'), start = text.indexOf('if (b >= 3 && b <= 14) {');
  assert.ok(start > 0);
  const end = text.indexOf('bool fr =', start), code = text.slice(start + 'if (b >= 3 && b <= 14) {'.length, end);
  const fn = glslFunctions('vec2 decode(int b){' + code + 'return vec2(float(leg), float(rel));}').decode;
  for (let encoded = 2560; encoded < 14848; encoded++) {
    const bone = Math.trunc(encoded / 1024 + 0.5), leg = Math.trunc((bone - 3) / 3), rel = bone - 3 - leg * 3;
    const result = fn(bone);
    assert.equal(result.x, leg);assert.equal(result.y, rel);
  }
});
test('FXC-safe spine sign preserves the original angle bits and every sampled leg rotation', () => {
  const text = source('05c_beasts.js'), match = text.match(/tg = bbRot\(tg, uSpine\.zy, ([^;]+)\);/);
  assert.ok(match);
  const expression = match[1], rotation = text.match(/vec2 bbRot\([^\n]+/)[0];
  const helpers = glslFunctions(rotation + '\nfloat angle(float spine,bool fr){return ' + expression + ';}\n' +
    'vec2 twist(vec2 p,vec2 c,float spine,bool fr){return bbRot(p,c,' + expression + ');}\n' +
    'vec2 released(vec2 p,vec2 c,float spine,bool fr){return bbRot(p,c,fr ? -spine : spine);}') ;
  const buffer = new ArrayBuffer(4), words = new Uint32Array(buffer), floats = new Float32Array(buffer);
  const bitPatterns = [0, 0x80000000, 1, 0x80000001, 0x7f7fffff, 0xff7fffff];
  for (let i = 0; i < 10000; i++) bitPatterns.push(Math.imul(i, 2654435761) >>> 0);
  for (const bits of bitPatterns) {
    words[0] = bits;const spine = floats[0];if (!Number.isFinite(spine)) continue;
    for (const fr of [false, true]) assert.ok(Object.is(helpers.angle(spine, fr), fr ? -spine : spine));
  }
  for (let i = -200; i <= 200; i++) for (const fr of [false, true]) {
    const p = {x: i / 31,y: i / 47},c = {x: i / 97,y: i / 113},spine = Math.fround(i / 2000);
    const actual = helpers.twist(p,c,spine,fr),released = helpers.released(p,c,spine,fr);
    assert.ok(Object.is(actual.x,released.x));assert.ok(Object.is(actual.y,released.y));
  }
});
test('generated heavy helpers have initialized results, a single return and no signed motif loops', () => {
  const device = devices().split('float l3DeviceD(')[1].split('float l3DeviceMask(')[0].replace(/\/\/[^\n]*/g, '');
  assert.equal((device.match(/\breturn\b/g) || []).length, 1);
  assert.doesNotMatch(device, /for\s*\(/);
  assert.match(device, /float d = 1.0/);
  assert.equal((feet().replace(/\/\/[^\n]*/g, '').match(/\breturn\b/g) || []).length, 1);
  const wall = walls().split('float look4Stub(')[1].replace(/\/\/[^\n]*/g, '');
  const banner = banners().split('float emblem(')[1];
  assert.equal((wall.match(/\breturn\b/g) || []).length, 1);
  assert.equal((banner.match(/\breturn\b/g) || []).length, 1);
});
