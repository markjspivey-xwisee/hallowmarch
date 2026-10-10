/* ================================================================== */
/* main: boot, game start, frame loop, quality, debug hooks            */
/* ================================================================== */
quality.auto = true;
GAME.ready = false;
renderer.info.autoReset = false;
const HM_ERRORS = [];
function reportError(err) {
  const msg = String(err && (err.stack || err.message) || err);
  if (HM_ERRORS.length < 20 && !HM_ERRORS.includes(msg)) { HM_ERRORS.push(msg); console.error(err); }
}
window.addEventListener('error', (e) => reportError(e.error || e.message));
window.addEventListener('unhandledrejection', (e) => reportError(e.reason));

/* ------------------------------------------------------------------ */
/* sizing and quality                                                  */
/* ------------------------------------------------------------------ */
function resize() {
  view.w = Math.max(1, window.innerWidth);
  view.h = Math.max(1, window.innerHeight);
  quality.dprActual = Math.max(0.5, Math.min(window.devicePixelRatio || 1, quality.dpr) * (quality.scale || 1));
  renderer.setPixelRatio(quality.dprActual);
  renderer.setSize(view.w, view.h, false);
  camera.aspect = view.w / view.h;
  camera.fov = view.w < view.h ? 70 : 55;
  camera.updateProjectionMatrix();
  makeTargets();
  setupShadows(quality.level);
  flowerMat.uniforms.uAlphaCut.value = quality.msaa > 0 ? 0.01 : 0.5;
  U.uFoliageCut.value = quality.msaa > 0 ? 0.01 : 0.5;
  const focal = (view.h * quality.dprActual) / (2 * Math.tan((camera.fov * DEG) / 2));
  for (const m of [fxAdd.mesh.material, fxAlpha.mesh.material, glowMesh.material, fireflyMat]) m.uniforms.uFocal.value = focal;
}
function setQuality(level, auto = false) {
  if (!QUALITY_PRESETS[level]) return;
  const rebuild = level !== quality.level;
  quality.level = level;
  Object.assign(quality, QUALITY_PRESETS[level]);
  quality.auto = auto;
  quality.scale = 1;
  if (rebuild && GAME.built) { buildGrass(); buildFlowers(); }
  if (GAME.built) { resize(); updateTreeVisibility(camera.position.x, camera.position.z); }
}
const TOD_TARGET = { morning: 0.3, golden: 1.0, night: 2.1 };
function setTimeMode(mode) {
  if (mode !== 'cycle' && !(mode in TOD_TARGET)) return;
  tod.mode = mode;
}
let resizeTimer = 0;
window.addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(() => GAME.built && resize(), 80); });

/* adaptive detail: step down when frames run long for a while */
const PERF = { acc: 0, n: 0, window: 0, grace: 6 };
function adaptQuality(dt) {
  if (!quality.auto || navigator.webdriver || document.hidden) return;
  PERF.grace -= dt;
  if (PERF.grace > 0) return;
  PERF.acc += dt; PERF.n++; PERF.window += dt;
  if (PERF.window < 4) return;
  const avg = PERF.acc / PERF.n;
  PERF.acc = 0; PERF.n = 0; PERF.window = 0;
  if (avg < 1 / 36) return;
  PERF.grace = 5;
  if (quality.level === 'high') { setQuality('medium', true); uiLog('Lowered graphics detail to keep things smooth.', 'sys'); }
  else if (quality.level === 'medium') { setQuality('low', true); uiLog('Lowered graphics detail to keep things smooth.', 'sys'); }
  else if ((quality.scale || 1) > 0.62) { quality.scale = Math.max(0.6, (quality.scale || 1) - 0.15); resize(); }
}

/* ------------------------------------------------------------------ */
/* boot                                                                */
/* ------------------------------------------------------------------ */
const nextPaint = () => new Promise((r) => { let done = false; const go = () => { if (!done) { done = true; r(); } }; requestAnimationFrame(() => setTimeout(go, 0)); setTimeout(go, 60); });
async function loadStep(frac, msg, fn) {
  $('loadbar').style.width = Math.round(frac * 100) + '%';
  if (msg) $('loadmsg').textContent = msg;
  await nextPaint();
  if (fn) fn();
}
async function boot() {
  const savePromise = loadSave().catch(() => null);
  await loadStep(0.03, 'Raising the hills', () => buildWorld(7));
  await loadStep(0.2, 'Shaping the land', () => { uploadWorldTextures(); buildTerrain(); buildWater(); });
  await loadStep(0.34, 'Planting the forests', () => { buildTrees(); buildNearTrees(); buildRocks(); buildHeroTree(); });
  await loadStep(0.48, 'Raising the keeps', () => { buildStructures(); buildBarrowSurface(); buildSurvival(); }); // [survival] plants, workstations (before the grass reads the cover map)
  await loadStep(0.54, 'Digging the barrow', () => buildDungeon());
  await loadStep(0.58, 'Sowing the meadows', () => { buildGrass(); buildFlowers(); buildNature(); buildFarming(); }); // [farming] beds, town strips, wild herbs (08h_farming.js)
  await loadStep(0.68, 'Mustering the realms', () => { buildCrowds(); buildParticles(); buildSpellFX(); buildFireflies(); buildWeather(); buildAmbientLife(); buildDragon(); buildLootMeshes(); initCamps(); initTowns(); initMerchants(); initWar(); initWildlife(); initAnimals(); spawnDragon(); initBarrow(); });
  GAME.built = true;
  groupOutdoors();
  await loadStep(0.78, 'Drawing the map', () => { buildMapImage(); buildDungeonMap(); });
  await loadStep(0.84, 'Reading the chronicle');
  const save = await savePromise;
  if (save) { applySettings(save.settings); applyWorldSave(save.world); }
  resize();
  applyTimeOfDay(tod.p);
  await loadStep(0.9, 'Lighting the sky', () => {
    updateCamera(0.016);
    camera.updateMatrixWorld();
    try { DUN.root.visible = true; spellCompileVisible(true); renderer.compile(scene, camera); } catch (e) { reportError(e); }
    DUN.root.visible = INDOOR.on;
    spellCompileVisible(false);
  });
  await loadStep(0.97, 'Lighting the sky', () => tick(0.016));
  GAME.ready = true;
  window.__hm.ready = true;
  setupTitle(save);
  const L = $('loading');
  L.style.opacity = 0;
  setTimeout(() => { L.hidden = true; }, 850);
  lastNow = performance.now();
  requestAnimationFrame(frame);
}

/* ------------------------------------------------------------------ */
/* starting, leaving                                                   */
/* ------------------------------------------------------------------ */
function startGame(save) {
  $('title').hidden = true;
  const P = createPlayer(save);
  savePartsLoad('char', save.x); // goods and every other system's records for the character (06d_goods.js)
  rescaleWar();
  buildHUD();
  GAME.started = true;
  lastZone = '';
  INPUT.keys.clear();
  uiLog(`Welcome to ${zoneAt(P.x, P.z).name}, ${P.name}.`, 'sys');
  if (save.fresh) {
    // a pack for the road: draughts for a recruit, a veteran's kit for a veteran
    INV.potions = P.level >= 10 ? 5 : 3;
    INV.gold = P.level >= 10 ? 120 : 10;
    if (P.level >= 10) {
      for (const [slot, q] of [['weapon', 2], ['chest', 2], ['head', 1], ['legs', 1]]) {
        const it = makeItem({ cls: P.cls, realm: P.faction, lvl: P.level - 1, q, slot });
        INV.eq[slot] = it;
      }
      applyGear();
      P.hp = P.maxHp;
    }
    // first steps: the prologue and the path (10c_lore.js) take it from here
    SAVE.chain.then(() => saveNow());
  } else {
    uiLog(`Level ${GAME.prog.level} ${CLASSES[P.cls].name}, realm rank ${realmRank(GAME.prog.rp)}.`, 'sys');
    // characters from before gear existed get a quartermaster's kit
    if (save.gold === undefined) {
      INV.potions = 5; INV.gold = 60 + P.level * 5;
      for (const [slot, q] of [['weapon', 2], ['chest', 2], ['head', 1]]) INV.eq[slot] = makeItem({ cls: P.cls, realm: P.faction, lvl: Math.max(1, P.level - 1), q, slot });
      applyGear();
      P.hp = P.maxHp;
      setTimeout(() => uiToast('The quartermaster has issued you a kit and some coin. Press I to see your gear.', 'hint'), 2500);
      saveSoon();
    }
  }
  sfx('portal');
  loreOnStart(save);
  giftsOnStart(save); // [gifts] the realm ultimate's cooldown carries over (06c_gifts.js)
  buildOnStart(save); // [building] the build button and the bed (06k_build.js)
  survivalOnStart(save); // [survival] the needs on the HUD, food in the bags, deer as game (09s_survival.js)
}
function newCharacter() {
  wipeSave();
  const P = GAME.player;
  if (P) { if (P.carrying != null) dropRelic(P); removeEnt(P); }
  GAME.player = null; GAME.prog = null; GAME.started = false;
  CAM.mode = 'title';
  INPUT.keys.clear(); INPUT.joy = null;
  for (const id of ['menu', 'death', 'dialog', 'mapov', 'kit']) $(id).hidden = true;
  LOOT.length = 0;
  resetInventory(null);
  UI.modal = null;
  $('hud').hidden = true;
  setupTitle(null);
}

/* ------------------------------------------------------------------ */
/* per-frame rendering preparation                                     */
/* ------------------------------------------------------------------ */
const frustum = new THREE.Frustum();
const projView = new THREE.Matrix4();
const _sph = new THREE.Sphere();
const _fwd = new THREE.Vector3();
const _p4 = [0, 0, 0, 0], _a4 = [0, 0, 0, 0], _ca = [0, 0, 0, 0], _cb = [0, 0, 0, 0], _mi = [0, 0, 0, 0], _st = [0, 0, 0, 0];
const _ma = [0, 0, 0, 0], _hc = [0, 0, 0, 0], _hb = [0, 0, 0, 0], _we = [0, 0, 0, 0];
const HUMAN_LOD = { high: 30, medium: 22, low: 15 };
const TRAIL_CAND = [];
const SHADOW_R = { humanoid: 0.62, wolf: 0.75, boar: 0.72, bear: 1.15, wisp: 0.45, deer: 0.7, stag: 0.74, horse: 1.0 };
const STAMP_R = { humanoid: 0.55, wolf: 0.6, boar: 0.6, bear: 0.95, deer: 0.6, stag: 0.6, horse: 0.8 };

function drawActors(fx, fz) {
  crowdHuman.begin(); crowdHumanLo.begin();
  for (const k in crowdBeast) { crowdBeast[k][0].begin(); crowdBeast[k][1].begin(); }
  const lodD2 = (HUMAN_LOD[quality.level] || 22) ** 2;
  TRAIL_CAND.length = 0;
  const camX = camera.position.x, camZ = camera.position.z;
  const maxD2 = 175 * 175;
  for (const e of ENT) {
    if (e.removed || e.kind === 'door' || e.kind === 'dragon') continue;
    const dx = e.x - camX, dz = e.z - camZ;
    if (dx * dx + dz * dz > maxD2) continue;
    const sc = e.scale || 1;
    let y = e.y;
    if (!e.alive && e.removeAt < Infinity) y -= Math.max(0, GAME.t - (e.removeAt - 2.5)) * 0.7; // sink before vanishing
    _sph.center.set(e.x, y + 1.0 * sc, e.z); _sph.radius = 2.4 * sc;
    const visible = frustum.intersectsSphere(_sph);
    // ground shadows (the decal window is 96 m around the player)
    if (Math.abs(e.x - fx) < 46 && Math.abs(e.z - fz) < 46 && (e.alive || e.anim.death < 1)) decalAdd(e.x, e.z, (e.mount ? SHADOW_R.horse : SHADOW_R[e.kind]) * sc * (e.kind === 'wisp' ? 1.2 : SHADOW.rt ? 0.72 : 1), 0);
    // grass parting
    if (e.kind !== 'wisp' && e.alive && Math.abs(e.x - fx) < 30 && Math.abs(e.z - fz) < 30) {
      if (e._tx === undefined) { e._tx = e.x; e._tz = e.z; }
      const m = Math.abs(e.x - e._tx) + Math.abs(e.z - e._tz);
      if (m > 0.04 || e === GAME.player) TRAIL_CAND.push(e);
    } else { e._tx = e.x; e._tz = e.z; }
    if (!visible) continue;
    if (e.kind === 'wisp') {
      const k = e.alive ? 1 : 1 - e.anim.death;
      if (k <= 0.01) continue;
      const pulse = 0.85 + 0.15 * Math.sin(renderTime * 5 + e.id);
      glowPush(e.x, y, e.z, 0.55 * k, 1.6 * k, 1.35 * k, 1.5 * pulse);
      glowPush(e.x, y, e.z, 2.2 * k, 2.4 * k, 2.2 * k, 0.32);
      if (e.alive && Math.random() < 0.35) FX.trail(e.x + (Math.random() - 0.5) * 0.4, y + (Math.random() - 0.5) * 0.4, e.z + (Math.random() - 0.5) * 0.4, [0.5, 1.5, 1.2], 0.14, 0.7);
      continue;
    }
    _p4[0] = e.x; _p4[1] = y; _p4[2] = e.z; _p4[3] = e.yaw;
    _a4[0] = e.anim.phase; _a4[1] = e.anim.amt; _a4[2] = animActValue(e); _a4[3] = e.anim.death;
    waterAnimPack(e, _a4); // [water] strokes, paddling and treading water (07b_swim.js)
    const L = e.look;
    if (e.kind === 'humanoid') {
      _ca[0] = L.tabard[0]; _ca[1] = L.tabard[1]; _ca[2] = L.tabard[2]; _ca[3] = sc;
      _cb[0] = L.armor[0]; _cb[1] = L.armor[1]; _cb[2] = L.armor[2]; _cb[3] = L.flags || 0;
      _mi[0] = L.skin; _mi[1] = (e.brand || e.fishing) && e.alive ? (L.mask | WB.torch) & ~WB.bow : L.mask; _mi[2] = e.anim.flash; _mi[3] = L.hair; // [survival] a rod is held like a brand
      _st[0] = L.outfit ?? 0; _st[1] = L.emblem ?? 3; _st[2] = L.fem ?? 0; _st[3] = L.bulk ?? 0;
      if (e.mount && e.alive) {
        // the horse under the rider, then the rider on the saddle
        const MA = e.mountAnim, H = crowdBeast[e.mount.crowd] || crowdBeast.horse; // [animals] your own horse in its own coat
        _ma[0] = MA.phase; _ma[1] = MA.amt; _ma[2] = e.onGround === false ? 6.5 : 0; _ma[3] = 0;
        _hc[0] = e.mount.coat[0]; _hc[1] = e.mount.coat[1]; _hc[2] = e.mount.coat[2]; _hc[3] = 1 + (e.mount.crowd ? e.mount.visCode || 0 : 0);
        _hb[0] = e.mount.cloth[0]; _hb[1] = e.mount.cloth[1]; _hb[2] = e.mount.cloth[2]; _hb[3] = beastWx(e, e.anim.flash); // the horse is as wet as its rider
        (dx * dx + dz * dz < lodD2 && H[0].n < H[0].max ? H[0] : H[1]).push(_p4, _ma, _hc, _hb);
        _p4[1] = y + HORSE_SEAT - 0.86 * sc;
        _a4[0] = MA.phase; _a4[1] = MA.amt;
        _cb[3] = (L.flags || 0) | 8;
      }
      // seated: on a throne the body takes the rider's pose, hips on the seat
      if (e.seat && e.alive) { _p4[1] = e.seat.y - 0.86 * sc; _a4[0] = 0; _a4[1] = 0; _cb[3] = (L.flags || 0) | 8; }
      wearVisual(e, _we); // feature/weather: wet, snow, dirt, blood and damage for the actor shader (05h_wear.js)
      (dx * dx + dz * dz < lodD2 && crowdHuman.n < crowdHuman.max ? crowdHuman : crowdHumanLo).push(_p4, _a4, _ca, _cb, _mi, _st, _we);
      // a gem of light on casters' hands while a spell builds
      if (e.casting && e.alive && e.casting.id !== 'summon') {
        const A = ABILITIES[e.casting.id];
        const c = e.cls === 'mage' ? [2.4, 1.1, 0.4] : e.cls === 'priest' ? [2.2, 2.0, 1.1] : [1.2, 1.4, 2.0];
        const k = 0.4 + 0.6 * clamp(e.casting.t / e.casting.total, 0, 1);
        glowPush(e.x + Math.sin(e.yaw) * 0.42, y + 1.55 * sc, e.z + Math.cos(e.yaw) * 0.42, c[0], c[1], c[2], (A && A.ground ? 0.9 : 0.6) * k);
      }
    } else {
      _ca[0] = L.colA[0]; _ca[1] = L.colA[1]; _ca[2] = L.colA[2]; _ca[3] = sc + (e.visCode || 0); // [animals] pattern and seed above the scale
      _cb[0] = L.colB[0]; _cb[1] = L.colB[1]; _cb[2] = L.colB[2]; _cb[3] = beastWx(e, e.anim.flash); // visual pass: its own wet and snow
      const C = crowdBeast[e.crowd || e.kind]; // [animals] shorn sheep, bulls, tacked horses
      if (C) (dx * dx + dz * dz < lodD2 && C[0].n < C[0].max ? C[0] : C[1]).push(_p4, _a4, _ca, _cb);
    }
  }
  crowdHuman.end(); crowdHumanLo.end();
  for (const k in crowdBeast) { crowdBeast[k][0].end(); crowdBeast[k][1].end(); }
  // the nearest movers press the grass (the player first)
  const P = GAME.player;
  TRAIL_CAND.sort((a, b) => (a === P ? -1 : b === P ? 1 : dist2(a.x, a.z, fx, fz) - dist2(b.x, b.z, fx, fz)));
  for (const e of TRAIL_CAND) {
    if (trailSegs.length >= TRAIL.maxSegs) { e._tx = e.x; e._tz = e.z; continue; }
    const r = STAMP_R[e.kind] * (e.scale || 1);
    trailStamp(e._tx, e._tz, e.x, e.z, e.onGround === false && e.y > heightAt(e.x, e.z) + 0.6 ? 0.01 : r);
    e._tx = e.x; e._tz = e.z;
  }
}
function drawTargetAndMarks() {
  const P = GAME.player;
  const t = P ? getEnt(P.target) : null;
  if (t && (t.alive || t.kind === 'door') && t !== P) {
    const hostile = isEnemy(P, t);
    const c = t.faction === FACTION_MONSTER ? hex3(CON[conIndex(t.level, P.level)].col) : t.faction <= 2 ? REALMS[t.faction].rgb : [1, 0.9, 0.6];
    U.uTargetColor.value.set(c[0], c[1], c[2]);
    const r = t.kind === 'door' ? 4.4 : (t.radius * 1.9 + 0.35) * (t.scale || 1);
    decalAdd(t.x, t.z, r, hostile ? 1 : 3);
  }
  for (let i = AOE_MARKS.length - 1; i >= 0; i--) {
    const m = AOE_MARKS[i];
    if (m.until < GAME.t) { AOE_MARKS.splice(i, 1); continue; }
    decalAdd(m.x, m.z, m.r, 2);
  }
}
// chimney smoke and lantern light in the towns
function drawTownLife(dt) {
  const camX = camera.position.x, camZ = camera.position.z;
  const wx = U.uWindDir.value.x * U.uWind.value, wz = U.uWindDir.value.y * U.uWind.value;
  const A = U.uAmbient.value, Lc = U.uLightColor.value;
  const night = U.uNight.value;
  for (const c of CHIMNEYS) {
    if (dist2(c.x, c.z, camX, camZ) > 110 * 110) continue;
    c.t = (c.t || Math.random()) - dt;
    if (c.t > 0) continue;
    c.t = 0.28 + Math.random() * 0.25;
    const g = 0.55 + Math.random() * 0.12;
    fxAlpha.emit(c.x + (Math.random() - 0.5) * 0.2, c.y, c.z + (Math.random() - 0.5) * 0.2,
      wx * 0.35 + (Math.random() - 0.5) * 0.12, 0.55 + Math.random() * 0.3, wz * 0.35 + (Math.random() - 0.5) * 0.12,
      6 + Math.random() * 3, (A.x * 0.8 + Lc.x * 0.3) * g, (A.y * 0.8 + Lc.y * 0.3) * g, (A.z * 0.8 + Lc.z * 0.3) * g, -(0.9 + Math.random() * 0.5), -0.03, 0.12);
  }
  if (night > 0.04) {
    for (const l of LANTERNS) {
      if (dist2(l.x, l.z, camX, camZ) > 140 * 140) continue;
      const f = night * (0.9 + 0.1 * Math.sin(renderTime * 7.3 + l.x * 3.1) * Math.sin(renderTime * 4.1 + l.z));
      glowPush(l.x, l.y, l.z, 2.4 * f, 1.55 * f, 0.6 * f, 0.55);
      glowPush(l.x, l.y, l.z, 0.75 * f, 0.45 * f, 0.16 * f, 3.2);
    }
  }
}
function drawRelicsAndPortals() {
  for (const rel of WAR.relics) {
    const p = rel.mesh.position, R = REALMS[rel.realm];
    glowPush(p.x, p.y, p.z, R.rgb[0] * 1.6 + 0.6, R.rgb[1] * 1.6 + 0.6, R.rgb[2] * 1.6 + 0.6, 1.8);
    if (Math.random() < 0.12) FX.trail(p.x + (Math.random() - 0.5) * 0.6, p.y + (Math.random() - 0.5) * 0.6, p.z + (Math.random() - 0.5) * 0.6, [1.6, 1.3, 0.6], 0.12, 1.0);
  }
  const camX = camera.position.x, camZ = camera.position.z;
  for (const R of REALMS) {
    for (const S of [R.town, R.musterSite]) {
      if (dist2(S.x, S.z, camX, camZ) > 160 * 160) continue;
      const pulse = 0.8 + 0.2 * Math.sin(renderTime * 1.7 + S.x);
      glowPush(S.x, S.y + 1.3, S.z, 0.35 * pulse, 0.85 * pulse, 1.4 * pulse, 3.2);
      if (Math.random() < 0.25) { const a = Math.random() * TAU, r = Math.random() * 2.2; FX.trail(S.x + Math.cos(a) * r, S.y + 0.3 + Math.random() * 0.5, S.z + Math.sin(a) * r, [0.4, 1.0, 1.6], 0.16, 1.4); }
    }
  }
}

/* ------------------------------------------------------------------ */
/* the frame                                                           */
/* ------------------------------------------------------------------ */
let lastNow = 0, renderTime = 0, treeTick = 0;
function simStep(dt) {
  GAME.t += dt;
  GAME.dt = dt;
  rebuildGrid();
  runLater();
  if (GAME.player) updatePlayer(dt);
  updateNPCs(dt);
  updateWar(dt);
  updateProjectiles(dt);
  updateDragonWorld(dt);
  updateLoot(dt);
  updateGates(dt);
  updateCastles(dt); // castles: gates swing for their own side, walls are repaired (04g_castles.js)
  updateBarrow(dt);
  updateHouses(dt);
  updateWear(dt); // feature/weather: soaking, snow, mud, blood and lightning on the ground (05h_wear.js)
  updateNature(dt); // nature (05h_nature.js): falling and burning trees, grass fire, regrowth, craters
  updateBrand(dt); // a burning brand in hand (09d_brand.js)
  updateLand(dt); // [worldstate] loot settles into craters, the woodcutter's axe in hand (12b_worldstate.js)
  updateGifts(dt); // [gifts] realm gifts: passives, the realm ultimate, champions (06c_gifts.js)
  updateWater(dt); // [water] wading, swimming, the current, fire out, splashes (07b_swim.js)
  updateHall(dt); // [building] the war table's grant, resting by a hall's hearth (04k_hall.js)
  updateBuild(dt); // [building] building work, fire and repair of placed structures (06k_build.js)
  updateClasses(dt); // [classes] the callings: blocks and parries, the draw and arrows in flight, snares, runes, steam, ice, holy ground (07b_classes.js)
  updateSurvival(dt); // [survival] hunger and thirst, work, fishing, regrowth (09s_survival.js)
  updateFarming(dt); // [farming] the season, beds and crops, the town fields, herbs (08h_farming.js)
  updateAnimals(dt); // [animals] taming, companions, pens, breeding (08h_animals.js)
}
function tick(dt) {
  renderer.info.reset();
  renderTime += dt;
  U.uTime.value = renderTime;
  // time of day
  if (tod.mode === 'cycle') tod.p = (tod.p + (dt * 3) / tod.cycleSec) % 3;
  else {
    const target = tod.mode === 'fixed' ? tod.fixedP : TOD_TARGET[tod.mode];
    const fwd = (((target - tod.p) % 3) + 3) % 3;
    if (fwd > 2.6) tod.p = (((tod.p - Math.min(3 - fwd, dt * 0.55)) % 3) + 3) % 3;
    else if (fwd > 0.002) tod.p = (tod.p + Math.min(fwd, dt * 0.55)) % 3;
  }
  applyTimeOfDay(tod.p);
  updateWeather(dt);
  applyWeather();
  applyIndoor();
  updateNightSky(dt); // [aurora] the northern lights and shooting stars (05i_aurora.js)
  // simulation (the menu and the prologue pause the world)
  if (UI.modal !== 'menu' && UI.modal !== 'prologue') {
    // up to two steps so a slow frame rate does not slow the world down
    let rest = Math.min(dt, 0.1);
    if (GAME.hitStop > 0) { GAME.hitStop -= dt; rest *= 0.06; }
    while (rest > 1e-4) { const s = Math.min(rest, 0.05); simStep(s); rest -= s; }
  }
  // camera
  updateCamera(dt);
  camera.updateMatrixWorld();
  if (GAME.player && CAM.mode === 'play') U.uCamFocus.value.set(GAME.player.x, GAME.player.y + 1.3, GAME.player.z);
  else U.uCamFocus.value.set(0, -1000, 0);
  projView.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
  frustum.setFromProjectionMatrix(projView);
  skyU.uInvVP.value.copy(projView).invert();
  const P = GAME.player;
  const fx = P ? P.x : W.heroTree.x, fz = P ? P.z : W.heroTree.z;
  // world-space helpers
  drawActors(fx, fz);
  drawDragon(dt);
  drawBrand(dt);
  drawTargetAndMarks();
  drawRelicsAndPortals();
  drawTownLife(dt);
  drawHouses(dt);
  drawFires(dt);
  drawNature(dt); // nature (05h_nature.js): tree and wood instances, flames, the nature map upload
  drawGifts(dt); // [gifts] the standard, the hunt, the winter storm and the gift button (06c_gifts.js)
  drawWater(dt); // [water] the ripple simulation, rain and spells on the water, the sound of rivers (07b_swim.js)
  drawHall(dt); // [building] the torches of the keeps' halls (04k_hall.js)
  drawBuild(dt); // [building] the placement ghost, flames and states of placed structures (06k_build.js)
  drawClasses(dt); // [classes] arrows in flight, ice sheets, snares, frozen bodies, steam and the parry cue (05j_classfx.js)
  drawFarming(dt); // [farming] crops, weeds and herbs near the camera, the beds' soil, the plant card (08i_farm_draw.js)
  drawAnimals(dt); // [animals] pen gates, the paddock marker, the companion bar (08h_animals.js)
  updateAmbientLife(dt);
  drawSurvival(dt); // [survival] plants, the rod and line, the spit, the needs on the HUD (after the fish: 09s_survival.js)
  drawProjectiles();
  updateSpellFX(dt);
  drawLoot();
  renderDecals(fx, fz);
  stepTrail(dt, fx, fz);
  camera.getWorldDirection(_fwd);
  updateGrassCenters(camera.position.x, camera.position.z, _fwd.x, _fwd.z);
  if (--treeTick <= 0) { treeTick = 15; updateTreeVisibility(camera.position.x, camera.position.z); }
  updateNearTrees(dt, camera.position.x, camera.position.z);
  updateFireflies(camera.position.x, camera.position.z);
  gatherLights(camera.position.x, camera.position.y, camera.position.z);
  fxAdd.flush(); fxAlpha.flush();
  arrowFlush(); glowFlush();
  // the sun's shadow map, centred a little ahead of the view
  if (SHADOW.rt && !INDOOR.on) {
    const ax = camera.position.x + _fwd.x * SHADOW.half * 0.45, az = camera.position.z + _fwd.z * SHADOW.half * 0.45;
    U.uShadowOn.value = 1 - 0.75 * WEATHER.overcast;
    renderShadowPass(ax, heightAt(ax, az), az);
  }
  // draw (meshes rebuilt since boot, like grass after a quality change, belong to the world above)
  regroupOutdoors();
  renderer.setRenderTarget(sceneRT);
  renderer.setClearColor(0x000000, 1);
  renderer.clear(true, true, false);
  renderer.render(scene, camera);
  composite.uniforms.uTime.value = renderTime;
  const fl = composite.uniforms.uFlash.value;
  fl.w = Math.max(0, fl.w - dt * 1.3);
  renderPost();
  // interface
  if (GAME.started && GAME.player) updateHUD(dt);
  if (GAME.started && GAME.player) updateLore(dt);
  if (GAME.started && GAME.player) classHUD(dt); // [classes] momentum, stance, the draw, attunement, devotion and the combo cue (10d_classes_ui.js)
  updateAudio(dt);
  adaptQuality(dt);
}
function frame(now) {
  requestAnimationFrame(frame);
  let dt = (now - lastNow) / 1000;
  lastNow = now;
  if (!(dt > 0)) dt = 1 / 60;
  dt = Math.min(dt, 0.1);
  try { tick(dt); } catch (err) { reportError(err); }
}

/* ------------------------------------------------------------------ */
/* test and debug hooks                                                */
/* ------------------------------------------------------------------ */
function warSummary() {
  const roles = {};
  let bad = 0;
  for (const e of ENT) {
    roles[e.role] = (roles[e.role] || 0) + 1;
    if (!isFiniteNum(e.x) || !isFiniteNum(e.z) || !isFiniteNum(e.y) || !isFiniteNum(e.hp)) bad++;
  }
  return {
    t: Math.round(GAME.t), ents: ENT.length, roles, nonFinite: bad,
    keeps: WAR.keeps.map((K) => `${K.site.name}:${REALMS[K.realm].name}${K.door.alive ? '' : ' (gate down)'}`),
    relics: WAR.relics.map((r) => `${REALMS[r.realm].hallow}:${r.state}${r.state === 'temple' ? '@' + REALMS[r.at].name : ''}`),
    warbands: WAR.warbands.map((w) => `${REALMS[w.realm].name}:${w.order ? w.order.type : 'idle'}:${wbMembers(w).length}`),
    stats: { ...WAR.stats }, news: WAR.news.slice(-8).map((n) => n.text), errors: HM_ERRORS.slice(),
    later: LATER.length, proj: PROJ.length,
  };
}
window.__hm = {
  ready: false, GAME, WAR, ENT, CAMPS, REALMS, CAM, INPUT, UI, tod, quality, SAVE, errors: HM_ERRORS, camera, MOBS, FACTION_MONSTER, FACTION_NEUTRAL,
  DUN, INDOOR, BARROW, BARROW_STATE,
  dbg: { grassMeshes, scene, SHADOW, U, renderer, DBG, LAKES, skyU, FIRES, CAMPS, WEATHER, strikeLightning, spawnSlash, slashGeo, slashMesh, DRAGON, setDragonState, COVER, addFire, BRAND },
  start(o = {}) {
    const realm = o.realm ?? 0, cls = o.cls ?? 'warrior';
    startGame({ v: 1, name: o.name || randomName(realm), realm, cls, level: o.level || 1, xp: 0, rp: o.rp || 0, fresh: true });
    return GAME.player.id;
  },
  simulate(sec, dt = 0.05) {
    const n = Math.round(sec / dt);
    for (let i = 0; i < n; i++) {
      try { simStep(dt); } catch (err) { reportError(err); }
      U.uTime.value += dt;
      for (let j = AOE_MARKS.length - 1; j >= 0; j--) if (AOE_MARKS[j].until < GAME.t) AOE_MARKS.splice(j, 1);
    }
    return warSummary();
  },
  summary: warSummary,
  renderInfo() {
    const r = renderer.info.render;
    const crowds = { human: crowdHuman.n, humanLo: crowdHumanLo.n };
    for (const k in crowdBeast) crowds[k] = [crowdBeast[k][0].n, crowdBeast[k][1].n];
    const vis = { trees: treeChunks.filter((m) => m.visible).reduce((a, m) => a + m.geometry.instanceCount, 0) };
    const geo = (g) => (g.index ? g.index.count / 3 : g.attributes.position.count / 3);
    const per = { human: geo(crowdHuman.geo), humanLo: geo(crowdHumanLo.geo), beasts: Object.fromEntries(Object.keys(crowdBeast).map((k) => [k, crowdBeast[k].map((c) => geo(c.geo))])), tree: treeChunks.length ? geo(treeChunks[0].geometry) : 0, grass: grassMeshes.map((m) => [m.geometry.instanceCount, geo(m.geometry)]) };
    return { calls: r.calls, triangles: r.triangles, programs: renderer.info.programs.length, textures: renderer.info.memory.textures, geometries: renderer.info.memory.geometries, crowds, vis, per, rt: [sceneRT.width, sceneRT.height, quality.msaa] };
  },
  teleport(x, z) { const P = GAME.player; if (!P) return; P.x = P.prevX = x; P.z = P.prevZ = z; P.y = heightAt(x, z); },
  setTod(p, mode = 'fixed') { tod.p = p; tod.fixedP = p; tod.mode = mode === 'cycle' ? 'cycle' : 'fixed'; },
  look(yaw, pitch, dist) { if (yaw !== undefined) CAM.yaw = yaw; if (pitch !== undefined) CAM.pitch = pitch; if (dist !== undefined) CAM.dist = CAM.targetDist = dist; },
  frame(dt = 1 / 60) { tick(dt); },
  INV, LOOT, QUALITY, ABILITIES, CLASSES, SPELL,
  nature: NATURE_DEBUG, // nature (05h_nature.js)
  fn: { warLevel, abilityRank, rankMult, rescaleWar, buildHotbar, updateMotion, spellDisc, spellRibbon, spellPillar, spawnProjectile, addBuff, hasBuff, enterBarrow, leaveBarrow, setIndoor, setGate, dunPoint, dunFloorAt, dunRoomAt, makeItem, dropItem, equipItem, unequip, rollLoot, openKit, closeKit, renderKit, usePotion, applyGear, merchantStock, sellJunk, gearTotals, spawnRealmUnit, spawnMob, makeEnt, setupStats, classLook, villagerLook, removeEnt, OUTFIT, WB, W, sampleGrid, realmWeightsAt, sfx, audioUnlock, updateAudio, AUDIO, screenOf, setQuality, setTimeMode, playerUseSlot, setPlayerTarget, cycleTarget, playerInteract, getEnt, zoneAt, heightAt, isWalkable, useAbility, teleportPlayer, toggleMount, mountUp, dismount, humanStep, beastStride, dragonAnimate, GOODS, goodsAdd, goodsTake, goodsTakeAll, goodsHave, goodsCount, dropGood, registerGood, registerSavePart, savePartsLoad, savePartsData, openMenu, toggleMap, newCharacter, saveNow, buildSave, applyTimeOfDay, nearestWhere, isEnemy, addXP, addRP, killEnt, dealDamage, captureKeep, pickUpRelic, relicPosition, wbMembers, wbLeader },
};

window.__hm.water = WATER_DEBUG; // [water] test hooks (07b_swim.js)

boot().catch((err) => {
  reportError(err);
  $('loadmsg').textContent = 'Something went wrong while building the world. Reloading may help.';
});
