import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import * as THREE from 'three';
import { parse } from 'acorn';
import { performance } from 'node:perf_hooks';

const root = new URL('../../', import.meta.url);
const read = file => readFileSync(new URL('src/' + file, root), 'utf8');
const reference = JSON.parse(readFileSync(new URL('fixtures/world-build-d722-reference.json', import.meta.url), 'utf8'));
const functions = (source, names = null) => parse(source, { ecmaVersion: 'latest', sourceType: 'module' }).body
  .filter(node => node.type === 'FunctionDeclaration' && (!names || names.includes(node.id.name)))
  .map(node => source.slice(node.start, node.end)).join('\n');
const declarations = (source, names) => parse(source, { ecmaVersion: 'latest', sourceType: 'module' }).body
  .filter(node => node.type === 'VariableDeclaration' && node.declarations.some(declaration => names.includes(declaration.id.name)))
  .map(node => source.slice(node.start, node.end)).join('\n');
const houses = read('04e_houses.js'), barrow = read('04d_barrow.js'), land = read('03c_land.js'), hall = read('04k_hall.js');
const script = [read('00_util.js'), read('01_world.js'), read('01b_water.js'),
  houses.slice(0, houses.indexOf('const HOUSE_VS =')), declarations(hall, ['HALL']), functions(hall),
  declarations(barrow, ['BARROW', 'BARROW_PW', 'DUN_X0']), 'SITES.push(BARROW);', functions(barrow, ['barrowMoundH', 'clearBarrowGround', 'applyBarrowMound']),
  declarations(land, ['MTN', 'MTN_D', 'mtnK']), functions(land), declarations(read('04_props.js'), ['TREE_KINDS']), declarations(read('05h_nature.js'), ['TREE_DIM']), read('03d_heights.js')].join('\n');

export function fixture({ prior = false } = {}) {
  const errors = [], receipts = [], rng = [], hostState = { allowed: false, randomCalls: 0, seededCalls: 0, pulses: 0 };
  const scene = new THREE.Scene();
  const treeGeometry = () => { const geometry = new THREE.BufferGeometry(); for (const name of ['position','normal','aPart','aAO']) geometry.setAttribute(name, new THREE.BufferAttribute(new Float32Array(9), 3)); geometry.setIndex([0,1,2]); return geometry; };
  const context = { THREE, Batch: class {}, performance, Math: Object.assign(Object.create(Math), { random() { if (!hostState.allowed) throw Error('Unseeded randomness must not enter canonical world construction'); hostState.randomCalls++; return Math.random(); } }),
    window: {}, GAME: {t:0,built:false,ready:false,started:false}, hostState, BOATS:{jetties:[]}, CLS: {ice:[]}, SICE: {on:false}, scene, errors, receipts, rng, reportError: error => errors.push(String(error.stack || error)),
    treeMat: new THREE.ShaderMaterial(), rockMat: new THREE.ShaderMaterial(), treeGeometry,
    shareMat: () => new THREE.ShaderMaterial(),
    U: { uHeightTex: { value: null }, uWorldA: { value: null } }, treeChunks: [], terrainChunks: [], NEAR_TREES: { grid: new Map(), cell: 32 },
    FORAGE: { list: [], dirty: false }, FARM: { plots: [], herbs: [], drawDirty: false },
    buildCrags: () => receipts.push('buildCrags'), buildCoverMask: () => receipts.push('buildCoverMask'),
  };
  // Actual CPU world/water/house/collider/height functions run without a renderer.
  // Only unchanged mesh-base/material creation and final GPU-resource builders
  // are stand-ins; generated instance data and all collision records are real.
  const execute = new Function(...Object.keys(context), script + '\n' + (prior ? Object.values(reference.functions).join('\n') : '') + `
    const fixtureMulberry = mulberry;
    mulberry = seed => { const random=fixtureMulberry(seed), stream=rng.length; rng.push({seed,values:[]}); return () => {const value=random();rng[stream].values.push(value);return value;}; };
    buildCrags = () => receipts.push('buildCrags');
    buildCoverMask = () => receipts.push('buildCoverMask');
    return {W,REALMS,SITES,NAV,COLL,HOUSES,HALL,RIVERS,WATERGRID,MTN,HTS,
      buildWorld,buildWorldChunks,mtnHeights,mtnHeightsChunks,htsField,htsFieldChunks,htsApply,htsApplyChunks,
      htsErode,htsErodeChunks,htsReach,htsReachChunks,htsKeep,htsKeepChunks,htsHollows,htsHollowsChunks,
      hooks:htsHooks,
      unrelatedHostWork() {
        const count=rng.length, sizes=rng.map(stream=>stream.values.length);
        hostState.allowed=true;
        try { const random=mulberry(19);for(let i=0;i<24;i++){random();hostState.seededCalls++;Math.random();}GAME.t+=1000000;performance.now();hostState.pulses++; }
        finally { hostState.allowed=false;for(let i=0;i<count;i++)if(rng[i].values.length!==sizes[i])throw Error('Host work altered a canonical RNG closure');rng.splice(count); }
      },
      probeRawHeight(callback) { const original=rawHeight; rawHeight=(...args)=>{callback();return original(...args);};return()=>{rawHeight=original;}; },
      probeField(callback) {const original=htsParts;htsParts=(...args)=>{callback();return original(...args);};return()=>{htsParts=original;};},
    };
  `);
  const api = execute(...Object.values(context));
  return { context, api, errors, receipts, rng, hostState,
    snapshot() { return graph({ world:api.W, realms:api.REALMS, sites:api.SITES, nav:api.NAV, collision:api.COLL,
      houses:api.HOUSES, halls:api.HALL, rivers:api.RIVERS, water:api.WATERGRID, mountain:api.MTN, heights:api.HTS,
      treeMeshes:context.treeChunks, forage:context.FORAGE, farm:context.FARM, receipts, rng }); },
    addPlacedFixture() { for (const [index, tree] of api.W.trees.slice(0,4).entries()) { const point={x:tree.x+3,z:tree.z+3,y:api.W.H[Math.round((tree.z+3+512)/2)*513+Math.round((tree.x+3+512)/2)]};context.FORAGE.list.push({...point,rad:1.5});context.FARM.herbs.push({...point,id:index}); } },
  };
}

function graph(value, seen = new Map()) {
  if (value === null || typeof value !== 'object') return typeof value === 'function' ? value.toString() : value;
  if (seen.has(value)) return { reference: seen.get(value) };
  const id = seen.size; seen.set(value,id);
  if (ArrayBuffer.isView(value)) return { id, type: value.constructor.name, length: value.length,
    sha256: createHash('sha256').update(Buffer.from(value.buffer,value.byteOffset,value.byteLength)).digest('hex') };
  if (Object.prototype.toString.call(value) === '[object Map]') return {id,map:[...value].map(([key,item])=>[graph(key,seen),graph(item,seen)])};
  if (Object.prototype.toString.call(value) === '[object Set]') return {id,set:[...value].map(item=>graph(item,seen))};
  if (Array.isArray(value)) return {id,array:value.map(item=>graph(item,seen))};
  const out = { id };
  for (const key of Object.keys(value)) {
    if (['ms','T','TT'].includes(key)) continue; // wall-clock diagnostics are not canonical world state
    if ((value.isObject3D || value.isBufferGeometry || value.isMaterial || value.isBufferAttribute) && ['id','uuid','version'].includes(key)) continue;
    out[key] = graph(value[key],seen);
  }
  return out;
}

export function drainMeasured(iterator) {
  let state, maximum = 0, steps = 0, active = 0;
  do { const before = performance.now();state = iterator.next();const elapsed=performance.now()-before;maximum=Math.max(maximum,elapsed);active+=elapsed;steps++; } while(!state.done);
  return {value:state.value,steps,maxChunkMs:maximum,activeMs:active};
}
