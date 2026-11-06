/* ================================================================== */
/* loot: drops on the ground, bags, equipping, merchants, potions       */
/* ================================================================== */
const INV = { bag: [], eq: {}, gold: 0, potions: 0, potionAt: -99, fullWarnAt: -99, goods: {} }; // goods: counts of materials, food, seeds (06d_goods.js)
const LOOT = []; // { item, x, z, y, vy, ground, t0, until, seed, landed }
const LOOT_MAX = 40;
const JUNK = {
  wolf: ['Wolf Pelt', 'Wolf Fang'], boar: ['Boar Tusk', 'Boar Hide'], bear: ['Bear Claw', 'Bear Pelt'],
  deer: ['Deer Hide'], stag: ['Antler', 'Stag Hide'], wisp: ['Wisp Ember'], skeleton: ['Grave Dust', 'Barrow Coin'],
  draugr: ['Rune-carved Bone', 'Tarnished Torc'], troll: ['Troll Tooth', 'Troll Hide'], dragon: ['Dragon Scale'],
};

function resetInventory(c) {
  INV.bag.length = 0;
  INV.eq = {};
  INV.goods = {};
  INV.gold = 0; INV.potions = 0; INV.potionAt = -99;
  if (!c) return;
  INV.gold = Math.max(0, Math.min(1e7, Math.round(+c.gold || 0)));
  INV.potions = clamp(Math.round(+c.potions || 0), 0, POTION.max);
  if (Array.isArray(c.bag)) for (const o of c.bag.slice(0, BAG_SIZE)) { const it = o && o.slot === 'junk' ? sanitizeJunk(o) : sanitizeItem(o); if (it) INV.bag.push(it); }
  if (c.eq && typeof c.eq === 'object') for (const s of SLOTS) { const it = sanitizeItem(c.eq[s]); if (it && it.slot === s) INV.eq[s] = it; }
}
function sanitizeJunk(o) {
  if (typeof o.name !== 'string') return null;
  return { id: typeof o.id === 'string' ? o.id.slice(0, 40) : `j${(ITEM_SEQ++).toString(36)}`, slot: 'junk', name: o.name.slice(0, 40), base: 'Trophy', q: 0, lvl: clamp(Math.round(+o.lvl || 1), 1, LEVEL_CAP + 10) /* [balance2] */, n: clamp(Math.round(+o.n || 1), 1, 20), st: {} };
}
function junkValue(it) { return Math.max(1, Math.round((1.5 + it.lvl * 0.9))); }
function sellValue(it) { return it.slot === 'junk' ? junkValue(it) * (it.n || 1) : itemValue(it); }
function makeJunk(kind, lvl) {
  const names = JUNK[kind];
  if (!names) return null;
  return { id: `j${Date.now().toString(36)}${(ITEM_SEQ++).toString(36)}`, slot: 'junk', name: pick(Math.random, names), base: 'Trophy', q: 0, lvl, n: 1, st: {} };
}

/* ---- the player's gear ---- */
function applyGear() {
  const P = GAME.player;
  if (!P || !P.baseLook) return;
  P.gear = gearTotals(INV.eq);
  P.look = gearLook(P.baseLook, INV.eq, P.cls);
  setupStats(P, true);
}
function bagAdd(it) {
  if (it.slot === 'junk') {
    const s = INV.bag.find((b) => b.slot === 'junk' && b.name === it.name && (b.n || 1) + (it.n || 1) <= 20);
    if (s) { s.n = (s.n || 1) + (it.n || 1); s.lvl = Math.max(s.lvl, it.lvl); return true; }
  }
  if (INV.bag.length >= BAG_SIZE) return false;
  INV.bag.push(it);
  return true;
}
function canEquip(it) {
  const P = GAME.player;
  if (!P || !it || it.slot === 'junk') return 'junk';
  if (it.cls && it.cls !== P.cls) return 'class';
  if (GAME.prog.level < itemReq(it)) return 'level';
  return null;
}
function equipItem(it) {
  const why = canEquip(it);
  if (why) {
    if (why === 'class') uiError(`Only a ${CLASSES[it.cls].name.toLowerCase()} can use that`);
    else if (why === 'level') uiError(`You need to be level ${itemReq(it)}`);
    return false;
  }
  const i = INV.bag.indexOf(it);
  if (i < 0) return false;
  const old = INV.eq[it.slot];
  INV.bag.splice(i, 1);
  if (old) INV.bag.splice(i, 0, old);
  INV.eq[it.slot] = it;
  applyGear();
  const P = GAME.player;
  sfx(it.slot === 'weapon' ? 'equipWeapon' : 'equip');
  if (it.q >= 3) FX.burst(P.x, P.y + 1.1, P.z, 18, QUALITY[it.q].rgb.map((v) => v * 1.6), 1.6, 0.6, 0.12, -0.5);
  saveSoon();
  return true;
}
function unequip(slot) {
  const it = INV.eq[slot];
  if (!it) return false;
  if (INV.bag.length >= BAG_SIZE) { uiError('Your bags are full'); return false; }
  delete INV.eq[slot];
  INV.bag.push(it);
  applyGear();
  sfx('equip');
  saveSoon();
  return true;
}
function addGold(n, x, y, z) {
  n = Math.round(n);
  if (n <= 0) return;
  INV.gold += n;
  if (x !== undefined) uiFloatAt(x, y, z, `+${n} gold`, 'gold');
  sfx('coins');
}

/* ---- what falls when something dies ---- */
function rollLoot(e, personalGold = true) {
  const P = GAME.player, prog = GAME.prog;
  if (!P || !prog || e.kind === 'door') return;
  const ci = conIndex(e.level, prog.level);
  const grey = ci === 0;
  const items = [];
  const gearFor = (weights, lvl = e.level) => makeItem({ cls: P.cls, realm: P.faction, lvl: dropIlvl(lvl), q: grey ? Math.min(1, rollQuality(weights)) : rollQuality(weights) }); // [balance2] item levels follow the foe to 50 (06e_gearcurve.js)
  let gold = 0;
  if (e.kind === 'dragon') {
    for (let i = 0; i < 3; i++) items.push(gearFor(DROP_WEIGHTS.dragon, Math.max(e.level - 2, prog.level)));
    items.push(makeJunk('dragon', e.level));
    gold = 450 + Math.random() * 250;
  } else if (e.role === 'dungeonBoss') {
    // the Barrow's master pays out in its own chest
    gold = 0;
  } else if (e.faction === FACTION_MONSTER) {
    const M = MOBS[e.mobType] || {};
    const beast = M.kind && M.kind !== 'humanoid' && M.kind !== 'wisp';
    const elite = e.role === 'elite' || !!e.elite;
    if (elite) for (let i = 0; i < 2; i++) items.push(gearFor(DROP_WEIGHTS.elite, e.level + 1)); // [balance2] a champion's spoils a level above it
    else if (Math.random() < (grey ? 0.03 : beast ? 0.11 : 0.21)) items.push(gearFor(DROP_WEIGHTS.mob));
    const junkKind = e.mobType === 'skeleton' || e.mobType === 'draugr' || e.mobType === 'troll' || e.mobType === 'wisp' || beast ? (e.mobType || e.kind) : null;
    if (junkKind && Math.random() < (beast ? 0.55 : 0.35)) { const j = makeJunk(junkKind, e.level); if (j) items.push(j); }
    if (!beast) gold = e.level * (0.7 + Math.random() * 0.9) * (elite ? 4 : 1) * (grey ? 0.3 : 1);
  } else if (e.faction <= 2) {
    if (e.role === 'lord') items.push(gearFor(DROP_WEIGHTS.elite));
    else if (Math.random() < 0.05) items.push(gearFor(DROP_WEIGHTS.soldier));
    gold = e.level * (0.5 + Math.random() * 0.7) * (e.role === 'lord' ? 6 : 1);
  }
  if (personalGold && gold > 0) addGold(gold, e.x, e.y + 2.3 * (e.scale || 1), e.z);
  for (const it of items) dropItem(it, e.x, e.z, e.y + 1.0 * (e.scale || 1));
}
function dropItem(it, x, z, y) {
  // A kill result awards this character's own gold and progress. Its physical
  // spoils were already rolled by the scene keeper and arrive through LOOT.
  if (typeof NET_ENTITIES !== 'undefined' && NET_ENTITIES.rewarding) return null;
  if (LOOT.length >= LOOT_MAX) LOOT.shift();
  const a = Math.random() * TAU, r = 0.5 + Math.random() * 0.9;
  const lx = x + Math.cos(a) * r, lz = z + Math.sin(a) * r;
  const L = { item: it, x: lx, z: lz, y: y ?? heightAt(lx, lz) + 1, vy: 3.2 + Math.random(), vx: Math.cos(a) * r * 1.6, vz: Math.sin(a) * r * 1.6, t0: GAME.t, until: GAME.t + 240, seed: Math.random() * 10, landed: false, bounce: 0 };
  LOOT.push(L);
  if (it.q >= 4) {
    later(0.35, () => { sfx(it.q >= 5 ? 'lootLegend' : 'lootEpic'); if (it.q >= 5) flashScreen([1.0, 0.7, 0.3], 0.25); });
    lightFlash(lx, L.y, lz, 8, QUALITY[it.q].rgb.map((v) => v * 2.5), 0.9);
  }
  return L;
}
function updateLoot(dt) {
  const P = GAME.player;
  for (let i = LOOT.length - 1; i >= 0; i--) {
    const L = LOOT[i];
    if (GAME.t > L.until) { LOOT.splice(i, 1); continue; }
    if (!L.landed) {
      L.vy -= 14 * dt;
      const nx = L.x + L.vx * dt, nz = L.z + L.vz * dt;
      if (isWalkable(nx, nz)) { L.x = nx; L.z = nz; }
      L.y += L.vy * dt;
      const g = heightAt(L.x, L.z);
      if (L.y <= g) {
        L.y = g;
        if (L.bounce++ < 1 && L.vy < -2) { L.vy = -L.vy * 0.32; L.vx *= 0.4; L.vz *= 0.4; FX.dust(L.x, g, L.z, 2); }
        else { L.landed = true; L.vx = L.vz = 0; }
      }
    }
    if (!P || !P.alive || GAME.t - L.t0 < 0.45) continue;
    if (typeof netWorldPartsActive === 'function' && netWorldPartsActive()) continue;
    const d2 = dist2(P.x, P.z, L.x, L.z);
    if (d2 < 1.7 * 1.7 && Math.abs(P.y - L.y) < 2.5) {
      if (L.item.goods) {
        // goods (06d_goods.js) go into the packs by count
        const took = goodsAdd(L.item.goods, L.item.n || 1, true);
        if (took) { L.item.n = (L.item.n || 1) - took; if (L.item.n <= 0) LOOT.splice(i, 1); uiLog(`You pick up ${took} ${goodName(L.item.goods, took).toLowerCase()}.`, 'sys'); sfx('loot'); }
        else if (GAME.t - INV.fullWarnAt > 4) { INV.fullWarnAt = GAME.t; uiError('You cannot carry any more of that'); }
      } else if (bagAdd(L.item)) {
        LOOT.splice(i, 1);
        onPickup(L.item, L);
      } else if (GAME.t - INV.fullWarnAt > 4) { INV.fullWarnAt = GAME.t; uiError('Your bags are full'); }
    }
  }
}
function onPickup(it, L) {
  const Q = QUALITY[it.q];
  const label = it.slot === 'junk' ? it.name : it.name;
  uiLog(`You pick up ${label}.`, it.q >= 2 ? 'loot' : 'sys');
  if (it.q >= 2 && it.slot !== 'junk') uiLootToast(it);
  sfx(it.q >= 3 ? 'lootRare' : 'loot');
  if (it.q >= 2) FX.burst(L.x, L.y + 0.4, L.z, 12, Q.rgb.map((v) => v * 1.6), 1.4, 0.5, 0.1, -0.5);
  // a clear upgrade goes straight on if the slot is empty
  if (it.slot !== 'junk' && !INV.eq[it.slot] && !canEquip(it)) { equipItem(it); uiLog(`You equip ${it.name}.`, 'loot'); }
  if (UI.modal === 'kit') renderKit();
  saveSoon();
}

/* ---- potions ---- */
function usePotion() {
  const P = GAME.player;
  if (!P || !P.alive) return;
  if (INV.potions <= 0) { uiError('You have no healing draughts'); return; }
  const rem = INV.potionAt + POTION.cd - GAME.t;
  if (rem > 0) { uiError('You cannot drink another yet'); return; }
  INV.potions--;
  INV.potionAt = GAME.t;
  healEnt(P, P, P.maxHp * POTION.heal);
  FX.heal(P.x, P.y, P.z);
  FX.burst(P.x, P.y + 1.2, P.z, 14, [2.2, 0.5, 0.4], 1.2, 0.5, 0.1, -0.6);
  sfx('potion');
  saveSoon();
}
const potionPrice = () => Math.round(6 + 2.6 * (GAME.prog ? GAME.prog.level : 1));

/* ---- merchants: one at a stall in each town ---- */
function initMerchants() {
  for (const R of REALMS) {
    const S = R.town, lx = -11, lz = 8.5;
    const c = siteToWorld(S, lx, lz), yaw = S.yaw + Math.atan2(-lx, -lz);
    const x = c.x - Math.sin(yaw) * 1.05, z = c.z - Math.cos(yaw) * 1.05;
    const fem = Math.random() < 0.5;
    const look = villagerLook(R.id);
    look.fem = fem ? 1 : 0;
    look.bulk = 0.3;
    look.mask = (look.mask & ~WB.robe) | WB.belt | WB.skirt;
    const nm = pick(Math.random, NAMES[R.id].filter((n) => FEMALE.has(n) === fem));
    const m = makeEnt({ kind: 'humanoid', faction: FACTION_NEUTRAL, role: 'merchant', level: 1, name: nm, x, z, y: heightAt(x, z), yaw, look, radius: 0.45 });
    if (typeof worldActorDevelop === 'function') worldActorDevelop(m);
    m.fixedY = heightAt(x, z);
    m.maxHp = m.hp = 500;
    m.ai.post = { x, z, yaw };
    R.merchant = m;
    if (typeof netNpcRegister === 'function') netNpcRegister(m, `town:${R.id}:merchant:0`);
    R.stock = null;
  }
}
function merchantStock(R) {
  const prog = GAME.prog, P = GAME.player;
  if (!R.stock || R.stock.lvl !== prog.level || GAME.t > R.stock.until || R.stock.items.length === 0) {
    const items = [];
    const slots = shuffle(Math.random, ['weapon', 'head', 'chest', 'hands', 'legs', 'cloak', 'ring', 'charm']).slice(0, 4);
    for (const s of slots) items.push(makeItem({ cls: P.cls, realm: P.faction, lvl: prog.level, q: rollQuality(DROP_WEIGHTS.shop), slot: s }));
    R.stock = { lvl: prog.level, until: GAME.t + 900, items };
  }
  return R.stock;
}
const buyPrice = (it) => itemValue(it) * 3;
function buyItem(R, it) {
  const price = buyPrice(it);
  if (INV.gold < price) { uiError('You cannot afford that'); return false; }
  if (INV.bag.length >= BAG_SIZE) { uiError('Your bags are full'); return false; }
  INV.gold -= price;
  R.stock.items.splice(R.stock.items.indexOf(it), 1);
  bagAdd(it);
  sfx('coins');
  uiLog(`You buy ${it.name} for ${fmtInt(price)} gold.`, 'loot');
  saveSoon();
  return true;
}
function buyPotions(n, event) {
  const price = potionPrice();
  const can = Math.min(n, POTION.max - INV.potions, Math.floor(INV.gold / price));
  if (INV.potions >= POTION.max) { uiError(`You can carry ${POTION.max} draughts`); return; }
  if (can <= 0) { uiError('You cannot afford that'); return; }
  const observation = loreObservationScope(event, 'draught');
  INV.gold -= can * price;
  INV.potions += can;
  loreObserve(observation);
  sfx('coins');
  saveSoon();
}
function sellItem(it) {
  const i = INV.bag.indexOf(it);
  if (i < 0) return false;
  INV.bag.splice(i, 1);
  const v = sellValue(it);
  INV.gold += v;
  sfx('coins');
  uiLog(`You sell ${it.slot === 'junk' && it.n > 1 ? it.n + ' × ' : ''}${it.name} for ${fmtInt(v)} gold.`, 'sys');
  saveSoon();
  return true;
}
function sellJunk() {
  let total = 0, n = 0;
  for (let i = INV.bag.length - 1; i >= 0; i--) {
    const it = INV.bag[i];
    if (it.slot === 'junk' || it.q === 0) { total += sellValue(it); n++; INV.bag.splice(i, 1); }
  }
  if (!n) { uiError('Nothing to sell'); return; }
  INV.gold += total;
  sfx('coins');
  uiLog(`You sell ${n} item${n === 1 ? '' : 's'} for ${fmtInt(total)} gold.`, 'sys');
  saveSoon();
}
function nearMerchant() {
  const P = GAME.player;
  if (!P) return null;
  for (const R of REALMS) if (R.merchant && dist(P.x, P.z, R.merchant.x, R.merchant.z) < 5.5) return R;
  return null;
}

/* ---- on the ground: a tied sack and, for good things, a beam of light ---- */
const LOOT_DRAW = 48;
let lootSackMesh = null, lootBeamMesh = null;
function buildLootMeshes() {
  const prof = [[0, 0], [0.1, 0.004], [0.16, 0.04], [0.19, 0.11], [0.185, 0.17], [0.15, 0.23], [0.09, 0.27], [0.055, 0.29], [0.06, 0.31], [0.09, 0.335], [0.1, 0.36], [0.06, 0.375], [0, 0.38]];
  const lathe = new THREE.LatheGeometry(prof.map(([r, y]) => new THREE.Vector2(r, y)), 12);
  lathe.computeVertexNormals();
  const g = new THREE.InstancedBufferGeometry();
  g.index = lathe.index;
  g.setAttribute('position', lathe.attributes.position);
  g.setAttribute('normal', lathe.attributes.normal);
  g.setAttribute('iPos', new THREE.InstancedBufferAttribute(new Float32Array(LOOT_DRAW * 4), 4).setUsage(THREE.DynamicDrawUsage));
  g.setAttribute('iCol', new THREE.InstancedBufferAttribute(new Float32Array(LOOT_DRAW * 4), 4).setUsage(THREE.DynamicDrawUsage));
  g.instanceCount = 0;
  lootSackMesh = new THREE.Mesh(g, mat({
    vertexShader: /* glsl */`
      attribute vec4 iPos; attribute vec4 iCol;
      varying vec3 vW; varying vec3 vN; varying vec3 vO; varying vec4 vC;
      void main(){
        vO = position; vC = iCol;
        float c = cos(iPos.w), s = sin(iPos.w);
        vec3 p = position;
        // squash the sack so it slumps on the ground
        p.xz *= 1.0 + 0.18 * (1.0 - smoothstep(0.0, 0.2, p.y));
        vec3 w = iPos.xyz + vec3(p.x * c + p.z * s, p.y, -p.x * s + p.z * c);
        vW = w; vN = vec3(normal.x * c + normal.z * s, normal.y, -normal.x * s + normal.z * c);
        gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
      }`,
    fragmentShader: /* glsl */`
      ${GLSL_COMMON}
      ${GLSL_ATMOS}
      ${GLSL_SHADOW}
      ${GLSL_PLIGHT}
      ${GLSL_LIGHT}
      varying vec3 vW; varying vec3 vN; varying vec3 vO; varying vec4 vC;
      void main(){
        vec3 n = safeNormalize(vN);
        gSh = shadowAt(vW, n);
        gPL = pointLights(vW, n);
        float a = atan(vO.x, vO.z);
        float weave = 0.86 + 0.14 * sin(a * 60.0) * sin(vO.y * 260.0);
        vec3 alb = vec3(0.46, 0.36, 0.22) * weave * (0.85 + 0.25 * vnoise(vO.xz * 30.0 + vO.y * 20.0));
        alb *= 0.8 + 0.2 * smoothstep(0.0, 0.08, vO.y);
        float tie = smoothstep(0.268, 0.275, vO.y) * (1.0 - smoothstep(0.305, 0.312, vO.y));
        vec3 col = lightSurface(mix(alb, vC.rgb * 0.8, tie), n, 0.9);
        col += vC.rgb * tie * (0.25 + 0.5 * vC.w);
        gl_FragColor = vec4(safeColor(applyFog(col, vW)), 1.0);
      }`,
  }));
  lootSackMesh.frustumCulled = false;
  lootSackMesh.renderOrder = 2;
  lootSackMesh.userData.keep = true;
  scene.add(lootSackMesh);
  // beams: a quad that turns about its vertical axis to face the camera
  const bq = new THREE.InstancedBufferGeometry();
  bq.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0], 3));
  bq.setIndex([0, 1, 2, 0, 2, 3]);
  bq.setAttribute('iPos', new THREE.InstancedBufferAttribute(new Float32Array(LOOT_DRAW * 4), 4).setUsage(THREE.DynamicDrawUsage));
  bq.setAttribute('iCol', new THREE.InstancedBufferAttribute(new Float32Array(LOOT_DRAW * 4), 4).setUsage(THREE.DynamicDrawUsage));
  bq.instanceCount = 0;
  lootBeamMesh = new THREE.Mesh(bq, new THREE.ShaderMaterial({
    uniforms: { uTime: U.uTime, uFogDensity: U.uFogDensity },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    vertexShader: /* glsl */`
      uniform float uTime, uFogDensity;
      attribute vec4 iPos; attribute vec4 iCol;
      varying vec2 vUv; varying vec4 vC; varying float vFog;
      void main(){
        vUv = position.xy; vC = iCol;
        vec3 toCam = cameraPosition - iPos.xyz;
        vec3 right = normalize(vec3(-toCam.z, 0.0, toCam.x) + vec3(1e-5, 0.0, 0.0));
        float w = 0.32 + 0.12 * iCol.w;
        vec3 p = iPos.xyz + right * (position.x - 0.5) * w + vec3(0.0, position.y * iPos.w, 0.0);
        vec4 mv = viewMatrix * vec4(p, 1.0);
        vFog = exp(-max(-mv.z, 0.0) * uFogDensity * 0.6);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */`
      uniform float uTime;
      varying vec2 vUv; varying vec4 vC; varying float vFog;
      void main(){
        float x = abs(vUv.x - 0.5) * 2.0;
        float core = exp(-x * x * 9.0) + 0.35 * exp(-x * x * 2.0);
        float up = pow(1.0 - vUv.y, 1.6) * smoothstep(0.0, 0.04, vUv.y);
        float shimmer = 0.75 + 0.25 * sin(vUv.y * 22.0 - uTime * 3.0 + vC.w * 3.0);
        gl_FragColor = vec4(clamp(vC.rgb * core * up * shimmer * vFog, 0.0, 6.0), 1.0);
      }`,
  }));
  lootBeamMesh.frustumCulled = false;
  lootBeamMesh.renderOrder = 9;
  lootBeamMesh.userData.keep = true;
  scene.add(lootBeamMesh);
}
function drawLoot() {
  if (!lootSackMesh) return;
  const sg = lootSackMesh.geometry, bg = lootBeamMesh.geometry;
  const sp = sg.attributes.iPos.array, sc = sg.attributes.iCol.array, bp = bg.attributes.iPos.array, bc = bg.attributes.iCol.array;
  let ns = 0, nb = 0;
  const camX = camera.position.x, camZ = camera.position.z;
  for (const L of LOOT) {
    if (ns >= LOOT_DRAW || dist2(L.x, L.z, camX, camZ) > 120 * 120) continue;
    const Q = QUALITY[L.item.q];
    const life = GAME.t - L.t0;
    const yaw = L.seed + (L.landed ? 0 : life * 9);
    sp.set([L.x, L.y, L.z, yaw], ns * 4);
    sc.set([Q.rgb[0], Q.rgb[1], Q.rgb[2], L.item.q / 5], ns * 4);
    ns++;
    const fade = clamp((L.until - GAME.t) / 6, 0, 1) * clamp(life * 2, 0, 1);
    const pulse = 0.8 + 0.2 * Math.sin(renderTime * 3 + L.seed);
    if (Q.beam > 0 && nb < LOOT_DRAW) {
      const k = Q.beam * fade;
      bp.set([L.x, L.y + 0.05, L.z, 1.6 + 1.3 * Q.beam], nb * 4);
      bc.set([Q.rgb[0] * k * 0.55, Q.rgb[1] * k * 0.55, Q.rgb[2] * k * 0.55, L.item.q], nb * 4);
      nb++;
      glowPush(L.x, L.y + 0.32, L.z, Q.rgb[0] * k * pulse, Q.rgb[1] * k * pulse, Q.rgb[2] * k * pulse, 0.55 + 0.15 * Q.beam);
    } else glowPush(L.x, L.y + 0.32, L.z, 0.5 * fade * pulse, 0.42 * fade * pulse, 0.3 * fade * pulse, 0.35);
    if (L.item.q >= 4 && Math.random() < 0.3) FX.trail(L.x + (Math.random() - 0.5) * 0.3, L.y + 0.3 + Math.random() * 1.5, L.z + (Math.random() - 0.5) * 0.3, Q.rgb.map((v) => v * 1.5), 0.08, 0.9);
  }
  sg.instanceCount = ns; bg.instanceCount = nb;
  for (const a of [sg.attributes.iPos, sg.attributes.iCol, bg.attributes.iPos, bg.attributes.iCol]) a.needsUpdate = true;
}

