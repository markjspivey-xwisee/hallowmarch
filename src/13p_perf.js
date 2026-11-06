/* ================================================================== */
/* [phones] performance: measuring (window.__hm.perf) and boot timing  */
/* ================================================================== */
// Under a test driver every mesh remembers the function that added it to the scene (read once from the stack),
// so a frame's draw calls and triangles can be told by system. Players never pay for this.
const PERFX = { tag: !!(typeof navigator !== 'undefined' && navigator.webdriver), boot: [], times: {}, timed: false, t0: performance.now() };
if (PERFX.tag) {
  const add0 = THREE.Object3D.prototype.add;
  THREE.Object3D.prototype.add = function perfAdd(...objs) {
    for (const o of objs) if (o && o.isObject3D && !o.userData.perfFrom) o.userData.perfFrom = perfCaller();
    return add0.apply(this, objs);
  };
}
function perfCaller() {
  const lim = Error.stackTraceLimit;
  Error.stackTraceLimit = 16;
  const st = String(new Error().stack || '').split('\n');
  Error.stackTraceLimit = lim;
  for (let i = 1; i < st.length; i++) {
    const m = /at (?:new )?([\w$.]+)(?: \[as \w+\])? \(/.exec(st[i]);
    if (!m) continue;
    const n = m[1];
    // skip this wrapper, built-ins and three.js's own (minified) frames
    if (/perfAdd|perfCaller|^(Array|Object|Map|Set|Promise|Function)\./.test(n) || /\.(add|attach)$/.test(n) || /^[A-Za-z_$]{1,3}\.[\w$]+$/.test(n)) continue;
    return n.replace(/^Object\./, '');
  }
  return '?';
}
// the boot's steps: how long each took (loadStep is wrapped after the first one has started)
{
  const ls0 = loadStep;
  loadStep = async (frac, msg, fn) => {
    const index = BOOT_STEPS.length;
    const result = await ls0(frac, msg, fn);
    // The actual step consumes resumable work. Wrapping fn in an async function
    // would await the iterator object itself and silently skip its contents.
    if (fn && BOOT_STEPS[index]) PERFX.boot.push(BOOT_STEPS[index].slice(0, 2));
    return result;
  };
}
// a readable name for a drawn object
function perfLabel(o) {
  if (!o) return '?';
  if (o.userData && o.userData.src) o = o.userData.src; // a shadow proxy stands for its source
  const gi = grassMeshes.indexOf(o);
  if (gi >= 0) return 'grass layer ' + gi;
  if (flowerMeshes.includes(o)) return 'flowers';
  if (o === crowdHuman.mesh) return 'people (near crowd)';
  if (o === crowdHumanLo.mesh) return 'people (far crowd)';
  if (crowdHumanFar && o === crowdHumanFar.mesh) return 'people (farthest crowd)';
  for (const k in crowdBeast) { const c = crowdBeast[k]; for (let j = 0; j < c.length; j++) if (c[j].mesh === o) return 'beasts ' + k + (j ? ' (far)' : ''); }
  if (treeChunks.includes(o)) return 'trees (far chunks)';
  for (let q = o; q; q = q.parent) if (q.userData && q.userData.perfFrom) return q.userData.perfFrom + (o.name ? ':' + o.name : '');
  return o.type + (o.name ? ':' + o.name : '');
}
// one frame with every draw counted by what drew it and in which pass
function perfFrame(dt = 1 / 60) {
  const R = renderer, info = R.info.render, rows = new Map();
  const orig = R.renderBufferDirect;
  R.renderBufferDirect = function (cam, scn, geo, mtl, obj, grp) {
    const c0 = info.calls, t0 = info.triangles;
    orig.call(this, cam, scn, geo, mtl, obj, grp);
    const rt = R.getRenderTarget();
    const pass = rt && SHADOW.rt && rt === SHADOW.rt ? 'shadow' : rt === sceneRT ? 'main' : 'post';
    const key = pass + '|' + perfLabel(obj);
    let r = rows.get(key);
    if (!r) rows.set(key, (r = { pass, label: perfLabel(obj), calls: 0, tris: 0, inst: 0, each: 0 }));
    r.calls += info.calls - c0; r.tris += info.triangles - t0;
    const inst = geo.isInstancedBufferGeometry ? geo.instanceCount : obj.isInstancedMesh ? obj.count : 1;
    r.inst += inst;
    r.each = Math.max(r.each, Math.round((geo.index ? geo.index.count : geo.attributes.position ? geo.attributes.position.count : 0) / 3));
  };
  // what refreshes on its own clock is brought up to the camera first, so views compare fairly
  treeTick = 0;
  if (typeof FORAGE !== 'undefined') FORAGE.dirty = true;
  if (typeof FARM !== 'undefined') FARM.drawDirty = true;
  const t = performance.now();
  try { tick(dt); } finally { R.renderBufferDirect = orig; }
  const ms = performance.now() - t;
  const list = [...rows.values()].sort((a, b) => b.tris - a.tris);
  const sum = (p) => list.filter((r) => !p || r.pass === p).reduce((a, r) => ({ calls: a.calls + r.calls, tris: a.tris + r.tris }), { calls: 0, tris: 0 });
  return { ms: +ms.toFixed(1), calls: info.calls, tris: info.triangles, programs: R.info.programs.length, main: sum('main'), shadow: sum('shadow'), post: sum('post'), rows: list, lod: typeof LOD !== 'undefined' ? JSON.parse(JSON.stringify(LOD.stats)) : null };
}
// JS time by system: every update and draw function of the step and the frame is wrapped once, on demand
function perfTimers() {
  if (PERFX.timed) return;
  PERFX.timed = true;
  const T = PERFX.times;
  const w = (name, f) => function (...a) { const t = performance.now(); try { return f.apply(this, a); } finally { const r = T[name] || (T[name] = { ms: 0, n: 0 }); r.ms += performance.now() - t; r.n++; } };
  rebuildGrid = w('rebuildGrid', rebuildGrid); runLater = w('runLater', runLater); updatePlayer = w('updatePlayer', updatePlayer);
  updateNPCs = w('updateNPCs', updateNPCs); updateWar = w('updateWar', updateWar); updateProjectiles = w('updateProjectiles', updateProjectiles);
  updateDragonWorld = w('updateDragonWorld', updateDragonWorld); updateLoot = w('updateLoot', updateLoot); updateGates = w('updateGates', updateGates);
  updateCastles = w('updateCastles', updateCastles); updateBarrow = w('updateBarrow', updateBarrow); updateHouses = w('updateHouses', updateHouses);
  updateWear = w('updateWear', updateWear); updateNature = w('updateNature', updateNature); updateBrand = w('updateBrand', updateBrand);
  updateLand = w('updateLand', updateLand); updateGifts = w('updateGifts', updateGifts); updateWater = w('updateWater', updateWater);
  updateHall = w('updateHall', updateHall); updateBuild = w('updateBuild', updateBuild); updateClasses = w('updateClasses', updateClasses);
  updateSurvival = w('updateSurvival', updateSurvival); updateFarming = w('updateFarming', updateFarming); updateAnimals = w('updateAnimals', updateAnimals);
  thinkVillager = w('thinkVillager (townsfolk)', thinkVillager); thinkAnimal = w('thinkAnimal', thinkAnimal); thinkSoldier = w('thinkSoldier', thinkSoldier);
  thinkMob = w('thinkMob', thinkMob); thinkPosted = w('thinkPosted', thinkPosted);
  drawActors = w('drawActors', drawActors); drawTownLife = w('drawTownLife', drawTownLife); drawHouses = w('drawHouses', drawHouses);
  drawFires = w('drawFires', drawFires); drawNature = w('drawNature', drawNature); drawWater = w('drawWater', drawWater); drawBuild = w('drawBuild', drawBuild);
  drawClasses = w('drawClasses', drawClasses); drawFarming = w('drawFarming', drawFarming); drawAnimals = w('drawAnimals', drawAnimals);
  drawSurvival = w('drawSurvival', drawSurvival); updateAmbientLife = w('updateAmbientLife', updateAmbientLife); updateSpellFX = w('updateSpellFX', updateSpellFX);
  updateNearTrees = w('updateNearTrees', updateNearTrees); updateTreeVisibility = w('updateTreeVisibility', updateTreeVisibility); gatherLights = w('gatherLights', gatherLights);
  renderShadowPass = w('renderShadowPass', renderShadowPass); renderPost = w('renderPost', renderPost); updateHUD = w('updateHUD', updateHUD);
  updateLore = w('updateLore', updateLore); classHUD = w('classHUD', classHUD); updateAudio = w('updateAudio', updateAudio);
  updateGrassCenters = w('updateGrassCenters', updateGrassCenters); drawGifts = w('drawGifts', drawGifts); drawHall = w('drawHall', drawHall);
  // [perf3] the systems of versions 13 to 19 (none of them was timed: perf2.py's step and frame tops left them out)
  updateWeather2 = w('updateWeather2', updateWeather2); wxCloudsFrame = w('wxCloudsFrame', wxCloudsFrame); wxCloudsScreen = w('wxCloudsScreen', wxCloudsScreen);
  updateLoops = w('updateLoops', updateLoops); updateSeason = w('updateSeason', updateSeason); netPump = w('netPump', netPump); netUiFrame = w('netUiFrame', netUiFrame);
  footLockStep = w('footLockStep', footLockStep); updateWar3 = w('updateWar3', updateWar3); updateWar4 = w('updateWar4', updateWar4);
  updateLate2 = w('updateLate2', updateLate2); updateLate4 = w('updateLate4', updateLate4); drawLate4 = w('drawLate4', drawLate4); updateSeasons = w('updateSeasons', updateSeasons);
  updateBlaze = w('updateBlaze', updateBlaze); updatePalisades = w('updatePalisades', updatePalisades); updateMountains = w('updateMountains', updateMountains);
  updateLod = w('updateLod', updateLod); hudLayout = w('hudLayout', hudLayout); updateTowers = w('updateTowers', updateTowers); updateSiege = w('updateSiege', updateSiege);
  localPath = w('localPath', localPath); a2DragonSolve = w('a2DragonSolve', a2DragonSolve); updateNightSky = w('updateNightSky', updateNightSky);
  tracksUpdate = w('tracksUpdate', tracksUpdate); drawWalls = w('drawWalls', drawWalls); updateWarPanel = w('updateWarPanel', updateWarPanel); look5Frame = w('look5Frame', look5Frame); look6Frame = w('look6Frame', look6Frame);
}
function perfTimes(reset = false) {
  const out = Object.entries(PERFX.times).map(([k, r]) => ({ k, ms: +r.ms.toFixed(2), n: r.n, each: +(r.ms / Math.max(1, r.n)).toFixed(3) })).sort((a, b) => b.ms - a.ms);
  if (reset) for (const k in PERFX.times) delete PERFX.times[k];
  return out;
}
window.__hm.perf = {
  PERFX, frame: perfFrame, timers: perfTimers, times: perfTimes, label: perfLabel,
  boot() { return { steps: PERFX.boot.slice(), readyAt: PERFX.readyAt || null, heap: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null }; },
  // the fixed views of tools/tests/perf.py: where to stand and where to look
  rp: (realm, along, lat) => rp(REALMS[realm], along, lat), SITES, RIVERS, LAKES,
};
{
  const markReady = () => { if (GRAPHICS_CONTEXT_LOST) return; if (GAME.ready) PERFX.readyAt = +performance.now().toFixed(0); else setTimeout(markReady, 50); };
  markReady();
}
