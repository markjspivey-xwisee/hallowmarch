import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import * as THREE from 'three';
import { parse } from 'acorn';
import { performance } from 'node:perf_hooks';

const root = new URL('../../', import.meta.url);
const read = name => readFileSync(new URL('src/' + name, root), 'utf8');
export const structureReference = JSON.parse(readFileSync(new URL('fixtures/structure-build-c6ce-reference.json', import.meta.url), 'utf8'));
const declarations = source => parse(source, { ecmaVersion: 'latest' }).body
  .filter(node => ['VariableDeclaration', 'FunctionDeclaration', 'ClassDeclaration'].includes(node.type))
  .map(node => source.slice(node.start, node.end)).join('\n');
const modules = ['04_props.js', '04b_town.js', '04d_barrow.js', '04d_look3.js', '04d_look4.js',
  '04e_houses.js', '04f_rooms.js', '04g_blaze.js', '04g_breach.js', '04g_burn.js', '04g_castles.js',
  '04j_batter.js', '04j_rafters.js', '04j_rubble.js', '04k_hall.js', '04l_towers.js', '04m_ladders.js', '04n_towerfire.js', '05d_fire.js'];
const land = read('03c_land.js'), landNodes = parse(land, { ecmaVersion: 'latest' }).body;
const landCPU = landNodes.filter(node => node.type === 'FunctionDeclaration' || node.type === 'VariableDeclaration'
  && node.declarations.some(d => ['MTN', 'MTN_D', 'mtnK'].includes(d.id.name))).map(node => land.slice(node.start, node.end)).join('\n');
const renderer = read('02_render.js'), rendererNodes = parse(renderer, { ecmaVersion: 'latest' }).body;
const renderCPU = rendererNodes.filter(node => node.type === 'FunctionDeclaration'
  && ['mat', 'shareMat', 'shadowCaster', 'depthFrom'].includes(node.id.name)).map(node => renderer.slice(node.start, node.end)).join('\n');
const perf = read('13x_perf2.js'), perfNodes = parse(perf, { ecmaVersion: 'latest' }).body;
const perfCPU = perfNodes.filter(node => node.type === 'FunctionDeclaration' && ['perf2LazyMesh', 'perf2Make', 'perf2Empty', 'perf2Bytes'].includes(node.id.name)
  || node.type === 'VariableDeclaration' && node.declarations.some(d => ['PERF2', 'PERF2_LAZY_MESH'].includes(d.id.name))).map(node => perf.slice(node.start, node.end)).join('\n');
const script = [read('00_util.js'), read('01_world.js'), read('01b_water.js'), landCPU, renderCPU,
  ...modules.map(name => declarations(read(name))), perfCPU,
  parse(read('05c_beasts.js'), { ecmaVersion: 'latest' }).body.filter(node => node.type === 'VariableDeclaration'
    && node.declarations.some(d => d.id.name === 'fhash')).map(node => read('05c_beasts.js').slice(node.start, node.end)).join('\n'),
  'SITES.push(BARROW);'].join('\n');

export function structureFixture({ prior = false } = {}) {
  const scene = new THREE.Scene(), shadowScene = new THREE.Scene(), uniforms = {}, errors = [], refreshes = [], rng = [], unseeded = [];
  const math = Object.assign(Object.create(Math), { random: (() => { let n = 171; return () => { const value=(n = Math.imul(n, 1664525) + 1013904223 >>> 0) / 4294967296;unseeded.push(value);return value; }; })() });
  const context = { THREE, scene, SHADOW: { scene: shadowScene, proxies: [] }, U: uniforms, Math: math,
    performance, console, window: {}, renderTime: 0, GAME: { built: false, ready: false, started: false, t: 0 }, rng,
    BOATS: { jetties: [] }, CLS: { ice: [] }, SICE: { on: false }, PL_MAX: 12,
    DEPTH_FS: 'void main(){gl_FragColor=vec4(1.0);}', queueMicrotask() {},
    reportError: error => errors.push(String(error.stack || error)),
    refreshGroundCover: () => refreshes.push('ground-cover'),
  };
  const declared = new Set(parse(script, { ecmaVersion: 'latest' }).body.flatMap(node => node.type === 'VariableDeclaration'
    ? node.declarations.map(d => d.id.name) : node.id ? [node.id.name] : []));
  for (const name of new Set(script.match(/\b(?:GLSL_\w+|\w+_GLSL)\b/g))) if (!declared.has(name)) context[name] = '';
  const profiled = ['keepStone', 'keepRound', 'keepTimber', 'templeModel', 'musterModel', 'townModel', 'buildHouses', 'buildCastles',
    'castleStone', 'castleRound', 'castleTimber', 'castleTemple', 'castleSections', 'buildCastleGate', 'buildTowers', 'towerParts', 'buildFireProps'];
  const instrument = profiled.map(name => `{const original=${name};${name}=function(...args){const before=performance.now();try{return original(...args);}finally{structureTimings.push({name:'${name}',ms:performance.now()-before,site:args.find(arg=>arg&&Number.isFinite(arg.x)&&Number.isFinite(arg.z))?.name||null});}};}`).join('\n');
  // Materials, geometry and shadow proxies use real Three CPU constructors.
  // External GLSL prefixes are uncompiled placeholders; their source is unchanged.
  // GPU ground-cover upload is recorded instead of creating a renderer/GL context.
  const api = new Function(...Object.keys(context), script + '\n' + (prior ? Object.values(structureReference.functions).join('\n') : '') + `
    const fixtureMulberry=mulberry;
    mulberry=seed=>{const random=fixtureMulberry(seed),stream={seed,values:[]};rng.push(stream);return()=>{const value=random();stream.values.push(value);return value;};};
    const structureTimings=[];
    return { W, REALMS, COLL, HOUSES, CASTLES, FLOOR, TOWER, SITE_MESHES, FIRES, LANTERNS, CHIMNEYS,
      buildWorld, buildStructures, buildStructuresChunks, buildCastles, buildCastlesChunks, timings:structureTimings, profile(){${instrument}},
      hooks: { keepStone, keepRound, keepTimber, templeModel, musterModel, townModel, buildHouses, buildTowers, buildFireProps } };
  `)(...Object.values(context));
  return { api, context, errors, refreshes, scene, shadowScene, rng, unseeded,
    snapshot() { const { W,REALMS,COLL,HOUSES,CASTLES,FLOOR,TOWER,SITE_MESHES,FIRES,LANTERNS,CHIMNEYS }=api;
      return graph({W,REALMS,COLL,HOUSES,CASTLES,FLOOR,TOWER,SITE_MESHES,FIRES,LANTERNS,CHIMNEYS,scene,shadows:context.SHADOW,refreshes,rng,unseeded}); } };
}

function graph(value, seen = new Map()) {
  if (value === null || typeof value !== 'object') return typeof value === 'function' ? value.toString() : value;
  if (seen.has(value)) return { reference: seen.get(value) };
  const id=seen.size;seen.set(value,id);
  if (ArrayBuffer.isView(value)) return { id, type:value.constructor.name, length:value.length,
    sha256:createHash('sha256').update(Buffer.from(value.buffer,value.byteOffset,value.byteLength)).digest('hex') };
  if (value instanceof Map) return {id,map:[...value].map(([key,item])=>[graph(key,seen),graph(item,seen)])};
  if (value instanceof Set) return {id,set:[...value].map(item=>graph(item,seen))};
  if (Array.isArray(value)) return {id,array:value.map(item=>graph(item,seen))};
  const result={id};
  for(const key of Object.keys(value)) {
    if((value.isObject3D||value.isBufferGeometry||value.isMaterial||value.isBufferAttribute)&&['id','uuid'].includes(key))continue;
    result[key]=graph(value[key],seen);
  }
  return result;
}
