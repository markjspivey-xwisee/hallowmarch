/* ================================================================== */
/* wear: weather on the people in it, lightning on the tall things,    */
/* and gear that gets muddy, bloody and battered, washed and mended    */
/* ================================================================== */
// Every humanoid carries wet, snow, dirt, blood and batter (0..1); the player's dirt, blood and damage live on the
// equipped items instead (it.dur 0..100, it.dirt, it.blood), so they are saved with the kit. drawActors packs all of it
// into the iWear attribute through wearVisual(); the actor shader in 05a_rig.js draws it. Surfaces read uWet and
// uSnowCover (05e_weather.js) through the GLSL_WEATHER chunk in 02_render.js.
const DUR_MAX = 100;
const ARMOUR_SLOTS = ['head', 'chest', 'hands', 'legs', 'cloak'];
const WEAR = { strikeIn: 24, warnT: 0, wells: null, hooked: false, strikes: [], washMsgAt: -99, lastWarn: '' };
let WEAR_HUD = null; // the warning on the player frame (kept out of WEAR so __hm.dbg.WEAR stays plain data)
// the source named when the sky itself does the damage
const SKY_SRC = { id: -78, name: 'the lightning', faction: 4 /* FACTION_NEUTRAL, defined later in 07_entities.js */, role: 'trap', level: 20, buffs: [], alive: false, scale: 1, x: 0, z: 0, y: 0 };

/* ---- items: durability, dirt and blood ---- */
const itemDur = (it) => (it && Number.isFinite(it.dur) ? clamp(it.dur, 0, DUR_MAX) : DUR_MAX);
const itemBroken = (it) => !!it && it.slot !== 'junk' && itemDur(it) <= 0;
function repairCost(it) {
  if (!it || it.slot === 'junk' || !SLOT_DEF[it.slot]) return 0;
  const miss = DUR_MAX - itemDur(it);
  return miss < 0.5 ? 0 : Math.max(1, Math.round(itemValue(it) * 0.75 * (miss / DUR_MAX)));
}
function kitItems() { return SLOTS.map((s) => INV.eq[s]).filter(Boolean).concat(INV.bag.filter((it) => it.slot !== 'junk')); }
const repairAllCost = () => kitItems().reduce((a, it) => a + repairCost(it), 0);
function wearItem(it, amount) {
  if (!it || !(amount > 0)) return;
  const before = itemDur(it);
  if (before <= 0) return;
  it.dur = Math.round(Math.max(0, before - amount) * 100) / 100;
  if (it.dur <= 0) {
    uiLog(`Your ${it.name} breaks! It gives you nothing until a merchant mends it.`, 'warn');
    uiToast(`${it.name} is broken`, 'hint');
    sfx('crash');
    applyGear();
    saveSoon();
  } else if (before >= 25 && it.dur < 25) {
    uiLog(`Your ${it.name} is badly worn. A merchant in town can mend it.`, 'warn');
    saveSoon();
  }
}
function soilItem(it, key, amount) {
  if (!it || it.slot === 'junk') return;
  it[key] = clamp((it[key] || 0) + amount, 0, 1); // tiny steps add up; packItem rounds for the save
}
// how dirty the kit is overall (0 clean, 1 filthy)
function kitDirt() {
  let m = Math.max(GAME.player ? (GAME.player.dirt || 0) : 0, GAME.player ? (GAME.player.blood || 0) : 0);
  for (const s of SLOTS) { const it = INV.eq[s]; if (it) m = Math.max(m, it.dirt || 0, it.blood || 0); }
  return m;
}
// mud splashes up from the ground: boots and leggings first, the hem of a cloak, the skirts of a coat
function dirtyGear(k) {
  const P = GAME.player, eq = INV.eq;
  if (eq.legs) soilItem(eq.legs, 'dirt', k); else P.dirt = Math.min(1, (P.dirt || 0) + k);
  soilItem(eq.cloak, 'dirt', k * 0.7);
  soilItem(eq.chest, 'dirt', k * 0.35);
}
function repairItem(it) {
  const c = repairCost(it);
  if (c <= 0) return 0;
  if (INV.gold < c) { uiError('You cannot afford the repair'); return -1; }
  INV.gold -= c;
  const wasBroken = itemBroken(it);
  it.dur = DUR_MAX;
  if (wasBroken || SLOTS.some((s) => INV.eq[s] === it)) applyGear();
  return c;
}
function repairAll() {
  const total = repairAllCost();
  if (total <= 0) { uiError('Nothing needs mending'); return false; }
  if (INV.gold < total) { uiError('You cannot afford to mend everything'); return false; }
  for (const it of kitItems()) repairItem(it);
  sfx('grind'); sfx('coins');
  uiLog(`The merchant mends your gear for ${fmtInt(total)} gold.`, 'loot');
  saveSoon();
  return true;
}
function washGear(spot) {
  const P = GAME.player;
  if (!P) return;
  for (const it of kitItems()) { delete it.dirt; delete it.blood; }
  P.dirt = 0; P.blood = 0;
  P.wet = Math.max(P.wet || 0, 0.55);
  const x = spot ? spot.x : P.x, z = spot ? spot.z : P.z, y = spot ? spot.y + 0.9 : P.y + 0.4;
  for (let i = 0; i < 26; i++) fxAlpha.emit(x + (Math.random() - 0.5) * 0.8, y, z + (Math.random() - 0.5) * 0.8, (Math.random() - 0.5) * 1.6, 1.2 + Math.random() * 1.6, (Math.random() - 0.5) * 1.6, 0.6, 0.55, 0.66, 0.74, 0.06, 9, 0);
  sfx('drip');
  uiLog(spot ? `You wash the mud and blood from your gear at the ${spot.kind}.` : 'The water washes the mud and blood from your gear.', 'sys');
  if (UI.modal === 'kit') renderKit();
  saveSoon();
}
function wellSpots() {
  if (WEAR.wells) return WEAR.wells;
  WEAR.wells = [];
  for (const R of REALMS) for (const p of (R.town && R.town.props) || []) if (p.type === 'well' || p.type === 'trough') WEAR.wells.push({ x: p.x, z: p.z, y: heightAt(p.x, p.z), kind: p.type });
  return WEAR.wells;
}
// the interaction list (09_player.js): wash at a town well or trough while the kit is dirty
function wearOffers(P, offer) {
  if (inDungeon(P) || kitDirt() < 0.02) return;
  for (const w of wellSpots()) offer(dist(P.x, P.z, w.x, w.z), w.kind === 'well' ? 2.9 : 2.6, `Wash your gear in the ${w.kind}`, () => washGear(w));
}

/* ---- combat wears gear down and spatters it ---- */
function bleedsOn(e) { return e.kind !== 'wisp' && e.kind !== 'door' && e.mobType !== 'skeleton' && e.mobType !== 'wisp' && !(e.look && e.look.flags & 1); }
function wearOnHit(src, dst, dmg, opts) {
  if (!dst || dst.kind === 'door' || !(dmg > 0) || opts.dot) return;
  const melee = opts.kind === 'melee';
  const bleeds = bleedsOn(dst);
  if (melee && bleeds && src && src.kind === 'humanoid') src.blood = Math.min(0.99, (src.blood || 0) + 0.1);
  if (melee && bleeds && dst.kind === 'humanoid') dst.blood = Math.min(0.99, (dst.blood || 0) + 0.05);
  const P = GAME.player;
  if (dst.kind === 'humanoid' && dst !== P) dst.batter = Math.min(0.7, (dst.batter || 0) + 0.012 + 0.1 * Math.min(1, dmg / Math.max(1, dst.maxHp)));
  if (!P) return;
  if (dst === P) {
    // a blow lands on one piece of armour
    const worn = ARMOUR_SLOTS.filter((s) => INV.eq[s] && itemDur(INV.eq[s]) > 0);
    if (worn.length) wearItem(INV.eq[worn[Math.floor(Math.random() * worn.length)]], 0.45 + 2.2 * Math.min(1, (dmg / Math.max(1, P.maxHp)) * 4));
    if (melee && src && bleedsOn(src)) soilItem(INV.eq.chest, 'blood', 0.03);
  }
  if (src === P && dst !== P) {
    const w = INV.eq.weapon;
    if (w) { wearItem(w, melee ? 0.32 : 0.12); if (melee && bleeds) soilItem(w, 'blood', 0.09); }
    if (melee && bleeds) { soilItem(INV.eq.hands, 'blood', 0.04); soilItem(INV.eq.chest, 'blood', 0.025); }
  }
}

/* ---- shelter, heat and sun ---- */
function underCrown(x, z) {
  const G = NEAR_TREES.grid;
  if (!G) return false;
  const c = NEAR_TREES.cell, ci = Math.floor(x / c), cj = Math.floor(z / c);
  for (let j = cj - 1; j <= cj + 1; j++) for (let i = ci - 1; i <= ci + 1; i++) {
    const l = G.get(i + ',' + j);
    if (!l) continue;
    for (const ti of l) { const t = W.trees[ti]; if (t.gone || t.fallen) continue; const r = 2.0 * t.s + 0.6; if (dist2(x, z, t.x, t.z) < r * r) return true; }
  }
  return false;
}
// 1 under open sky, 0 under a roof or underground, a little in between under a tree's crown
function skyOver(e) {
  if (inDungeon(e) || (e === GAME.player && INDOOR.on)) return 0;
  if (houseRoofOver(e.x, e.z)) return 0;
  return underCrown(e.x, e.z) ? 0.3 : 1;
}
function heatAt(x, y, z) {
  let h = 0;
  for (const f of FIRES) {
    if (f.until < GAME.t || f.ghost) continue;
    const r = 3 + 2.6 * f.size, d2 = (f.x - x) ** 2 + (f.z - z) ** 2;
    if (d2 < r * r && Math.abs(f.y - y) < 5) h = Math.max(h, 1 - Math.sqrt(d2) / r);
  }
  return h;
}
function sunStrength() {
  return clamp(1 - WEATHER.overcast, 0, 1) * clamp(1 - U.uNight.value * 1.3, 0, 1) * clamp(U.uLightDir.value.y * 2.2, 0, 1);
}
// how fast wet surfaces dry and snow melts out of the rain (used by updateWeather for the world's surfaces)
function weatherDryRate() { return 1 + 2.6 * sunStrength() + 0.8 * clamp((U.uWind.value - 1) / 1.5, 0, 1); }
function weatherMeltRate(cold) { return (0.35 + 2.8 * sunStrength()) * (1 - 0.75 * cold) + 2.5 * Math.max(0, WEATHER.raining - WEATHER.snowing); }

/* ---- the simulation step: soak, settle, dry, melt, wash, mud and dust, and lightning near the player ---- */
function updateWear(dt) {
  hookWear();
  const W2 = WEATHER, P = GAME.player;
  const rain = Math.max(0, W2.raining - W2.snowing), snowing = W2.snowing;
  const sun = sunStrength(), wind = clamp((U.uWind.value - 1) / 1.5, 0, 1);
  const camX = camera.position.x, camZ = camera.position.z;
  const A = U.uAmbient.value, Lc = U.uLightColor.value;
  for (const e of ENT) {
    if ((e.kind !== 'humanoid' && !crowdBeast[e.kind]) || e.removed) continue; // visual pass: beasts soak and dry too
    if (e !== P && dist2(e.x, e.z, camX, camZ) > 150 * 150) continue;
    // shelter and the warmth of fires are looked up about once a second for each body
    if (e._wxT === undefined || GAME.t >= e._wxT) { e._wxT = GAME.t + 0.8 + Math.random() * 0.4; e._sky = skyOver(e); e._heat = heatAt(e.x, e.y, e.z); }
    // [water] in any water (07b_swim.js): the gear soaks up to the waterline (e.wl); swimming or chest-deep soaks it all
    const wdep = inDungeon(e) ? 0 : Math.max(0, (e.wsurf ?? -1e3) - e.y) * ((e.wd || 0) > 0 ? 1 : 0) / (e.scale || 1);
    const water = wdep > 0.3;
    const sky = e._sky || 0, heat = e._heat || 0;
    let wet = e.wet || 0, snow = e.snow || 0;
    if (e.swim || wdep > 1.0) { wet = 1; snow = 0; }
    else {
      if (rain > 0.05 && sky > 0) wet = Math.min(1, wet + (dt * rain * sky) / 22);
      else wet = Math.max(0, wet - (dt * (1 + 3 * sun + 1.2 * wind + 7 * heat + (sky === 0 ? 0.6 : 0))) / 170);
      if (snowing > 0.05 && sky > 0) snow = Math.min(1, snow + (dt * snowing * sky * (e.anim && e.anim.amt > 0.3 ? 0.5 : 1)) / 40);
      else snow = Math.max(0, snow - (dt * (0.25 + 2.5 * sun + 12 * heat + (sky === 0 ? 2.5 : 0) + 4 * rain)) / 90);
      if (heat > 0.05 && snow > 0) snow = Math.max(0, snow - dt * heat * 0.15);
    }
    e.wet = wet; e.snow = snow;
    // wading washes the mud and blood away; rain rinses the blood off and the mud only slowly (feet still splash it
    // up from a wet road); blood left alone dries and flakes off slowly
    const wash = water ? 0.35 : rain * sky * 0.003;
    if (wash > 0) { if (e.dirt) e.dirt = Math.max(0, e.dirt - dt * wash); if (e.blood) e.blood = Math.max(0, e.blood - dt * wash * (water ? 1.6 : 4)); }
    else if (e.blood && e !== P) e.blood = Math.max(0, e.blood - dt * 0.002);
    // the ground: mud when it is wet, dust when it is dry
    const sp = e._wx === undefined ? 0 : Math.hypot(e.x - e._wx, e.z - e._wz) / Math.max(dt, 1e-3);
    e._wx = e.x; e._wz = e.z;
    if (sp > 0.6 && sp < 30 && !water && !inDungeon(e) && (e.onGround !== false || e.mount)) {
      const road = sampleGrid(W.road, e.x, e.z), grass = sampleGrid(W.grass, e.x, e.z);
      const bare = clamp(road * 0.9 + (1 - grass) * 0.45, 0, 1);
      const mud = W2.wet;
      const k = (sp * bare * (0.25 + 1.6 * mud)) / 1400 * (e.mount ? 0.35 : 1);
      if (e === P) dirtyGear(k * dt); else e.dirt = Math.min(1, (e.dirt || 0) + k * dt);
      if (mud < 0.12 && W2.snow < 0.2 && road > 0.3 && sky > 0 && dist2(e.x, e.z, camX, camZ) < 50 * 50) {
        e._dust = (e._dust || 0) + dt * sp * road * (e.mount ? 1.1 : 0.42) * (1 - mud * 8);
        if (e._dust > 1) {
          e._dust -= 1;
          const g = 0.5 + Math.random() * 0.1;
          FX.dust(e.x, e.y, e.z, e.mount ? 3 : 1, [(A.x * 0.7 + Lc.x * 0.45) * g * 1.05, (A.y * 0.7 + Lc.y * 0.45) * g * 0.95, (A.z * 0.7 + Lc.z * 0.45) * g * 0.78]);
        }
      }
    }
    // a soaked body drips for a while after it comes in out of the rain
    if (wet > 0.35 && rain < 0.05 && dist2(e.x, e.z, camX, camZ) < 30 * 30 && Math.random() < dt * wet * 3) {
      const a = Math.random() * TAU, r = 0.18 + Math.random() * 0.15, sc = e.scale || 1;
      fxAlpha.emit(e.x + Math.cos(a) * r, e.y + (0.4 + Math.random() * 0.9) * sc, e.z + Math.sin(a) * r, 0, -0.5, 0, 0.5, A.x * 0.8 + 0.18, A.y * 0.8 + 0.2, A.z * 0.8 + 0.24, 0.035, 9, 0);
    }
  }
  if (!P) return;
  // the player's kit: rain slowly rinses it, wading through a lake or a pond washes it clean
  const pWater = !inDungeon(P) && (P.wd || 0) > 0.3; // [water] wading in any water (07b_swim.js)
  const wash = pWater ? 0.4 : rain * (P._sky || 0) * 0.0025, bloodK = pWater ? 1.5 : 5;
  if (wash > 0) {
    const before = kitDirt();
    for (const s of SLOTS) {
      const it = INV.eq[s];
      if (!it) continue;
      if (it.dirt) it.dirt = Math.max(0, it.dirt - dt * wash);
      if (it.blood) it.blood = Math.max(0, it.blood - dt * wash * bloodK);
    }
    if (P.dirt) P.dirt = Math.max(0, P.dirt - dt * wash);
    if (P.blood) P.blood = Math.max(0, P.blood - dt * wash * bloodK);
    if (pWater && before > 0.08 && kitDirt() <= 0.02 && GAME.t - WEAR.washMsgAt > 30) { WEAR.washMsgAt = GAME.t; uiLog('The water washes the mud and blood from your gear.', 'sys'); saveSoon(); }
  }
  // storms: now and then the lightning comes down near you, on whatever stands tallest
  if (W2.storm > 0.5 && !INDOOR.on && !inDungeon(P) && W2.mode !== 'clear') {
    WEAR.strikeIn -= dt;
    if (WEAR.strikeIn <= 0) { WEAR.strikeIn = 16 + Math.random() * 30; strikeNear(P.x, P.z); }
  }
  WEAR.warnT -= dt;
  if (WEAR.warnT <= 0) { WEAR.warnT = 0.5; updateGearWarn(); }
}
// a beast's hit flash (0..1) with its own wet and snow in whole sixteenths above it (visual pass; 05c_beasts.js unpacks)
function beastWx(e, flash) {
  return Math.min(Math.max(flash || 0, 0), 0.99) + Math.round(clamp(e.wet || 0, 0, 1) * 15) + 16 * Math.round(clamp(e.snow || 0, 0, 1) * 15);
}
// what the actor shader gets for a body: wet, snow, dirt, blood + whole steps of damage (0..15)
function wearVisual(e, out) {
  let dirt = e.dirt || 0, blood = e.blood || 0, dmg = e.batter || 0;
  if (e === GAME.player) {
    const eq = INV.eq;
    const v = (it, k) => (it && it[k]) || 0;
    dirt = Math.max(dirt, v(eq.legs, 'dirt'), v(eq.cloak, 'dirt') * 0.8, v(eq.chest, 'dirt') * 0.7);
    blood = Math.max(blood, v(eq.weapon, 'blood') * 0.9, v(eq.chest, 'blood'), v(eq.hands, 'blood'));
    let sum = 0, n = 0, broken = false;
    for (const s of ['weapon', ...ARMOUR_SLOTS]) { const it = eq[s]; if (!it) continue; const d = itemDur(it); sum += d; n++; if (d <= 0) broken = true; }
    dmg = n ? Math.max(1 - sum / n / DUR_MAX, broken ? 0.8 : 0) : 0;
  }
  out[0] = waterlinePack(e); out[1] = clamp(e.snow || 0, 0, 1); out[2] = clamp(dirt, 0, 1); // [water] wetness + the soaked waterline (07b_swim.js)
  out[3] = Math.floor(clamp(dmg, 0, 1) * 15) + clamp(blood, 0, 0.99);
  return out;
}

/* ---- lightning on the ground ---- */
function treeHeight(t) { return (t.kind === 'pine' ? 10.5 : t.kind === 'birch' ? 8.5 : 8) * t.s; }
// the ring starts close enough that sheltering under a tall tree in a storm is a real risk
function strikeNear(x, z, rMin = 6, rMax = 55) {
  // tall things draw the bolt: trees, the towers under their banners, the ridges of roofs; open ground if nothing stands near
  const cands = [];
  const inRing = (tx, tz) => { const d2 = dist2(tx, tz, x, z); return d2 < rMax * rMax && d2 > rMin * rMin; };
  const G = NEAR_TREES.grid;
  if (G) {
    const c = NEAR_TREES.cell, ci = Math.floor(x / c), cj = Math.floor(z / c), rr = Math.ceil(rMax / c);
    for (let j = cj - rr; j <= cj + rr; j++) for (let i = ci - rr; i <= ci + rr; i++) {
      const l = G.get(i + ',' + j);
      if (!l) continue;
      for (const ti of l) { const t = W.trees[ti]; if (t.gone || t.fallen || !inRing(t.x, t.z)) continue; const h = treeHeight(t); cands.push({ kind: 'tree', i: ti, x: t.x, z: t.z, y: t.y + h, gy: t.y, w: h * h }); }
    }
  }
  for (const H of HOUSES) if (H.state === 'whole' && inRing(H.x, H.z)) cands.push({ kind: 'house', H, x: H.x, z: H.z, y: H.y + H.top, gy: H.y, w: H.top * H.top * 1.3 });
  const BA = bannerGeo.attributes.aB0.array;
  for (const B of BANNERS) {
    const bx = BA[B.k * 4], by = BA[B.k * 4 + 1], bz = BA[B.k * 4 + 2];
    if (!inRing(bx, bz)) continue;
    const gy = heightAt(bx, bz);
    if (by - gy > 3) cands.push({ kind: 'tower', x: bx, z: bz, y: by + 0.5, gy, w: (by - gy) ** 2 });
  }
  for (let i = 0; i < 5; i++) {
    const a = Math.random() * TAU, r = rMin + Math.random() * (rMax - rMin);
    const gx = x + Math.cos(a) * r, gz = z + Math.sin(a) * r;
    if (!isWalkable(gx, gz)) continue;
    const gy = heightAt(gx, gz);
    cands.push({ kind: 'ground', x: gx, z: gz, y: gy, gy, w: 10 });
  }
  if (!cands.length) return null;
  let s = 0;
  for (const c of cands) s += c.w;
  let r = Math.random() * s;
  for (const c of cands) { r -= c.w; if (r <= 0) return strikeAt(c); }
  return strikeAt(cands[cands.length - 1]);
}
function strikeAt(c) {
  const top = [c.x, c.y, c.z];
  const sky = [c.x + (Math.random() - 0.5) * 34, c.y + 120, c.z + (Math.random() - 0.5) * 34];
  // the bolt: a jagged channel from the cloud, flickering on and off, and a white-hot core along it
  const path = [];
  let px = sky[0], py = sky[1], pz = sky[2];
  while (py > c.y + 0.01) {
    const ny = Math.max(c.y, py - 3 - Math.random() * 5);
    const k = (py - ny) / Math.max(py - c.y, 1e-3);
    const nx = ny <= c.y ? c.x : px + (Math.random() - 0.5) * 5 + (c.x - px) * k;
    const nz = ny <= c.y ? c.z : pz + (Math.random() - 0.5) * 5 + (c.z - pz) * k;
    for (let i = 1; i <= 3; i++) path.push([lerp(px, nx, i / 3), lerp(py, ny, i / 3), lerp(pz, nz, i / 3), 2.0 + Math.random() * 1.0]);
    px = nx; py = ny; pz = nz;
  }
  // down the trunk or the wall into the ground
  if (c.y - c.gy > 1) for (let i = 1; i <= 6; i++) path.push([c.x + (Math.random() - 0.5) * 0.3, lerp(c.y, c.gy, i / 6), c.z + (Math.random() - 0.5) * 0.3, 1.1]);
  WEATHER.bolts.push({ path, t: 0 });
  spellRibbon(sky, top, 'bolt', [2.5, 2.8, 3.6], 0.9, 0.42);
  WEATHER.flash = 1;
  lightFlash(c.x, c.y + 3, c.z, 70, [3.2, 3.4, 4.3], 0.6);
  lightFlash(c.x, c.gy + 1.2, c.z, 16, [3.4, 3.4, 4.0], 0.45);
  sfx('thunderNear');
  const P = GAME.player;
  if (P && dist2(P.x, P.z, c.x, c.z) < 40 * 40) cameraShake(0.32, c.x, c.z);
  // where it went into the earth: a burnt star of grass, sparks and smoke
  if (c.kind !== 'house') {
    spellDisc(c.x, c.z, c.kind === 'ground' ? 2.6 : 1.9, DISC_KIND.scorch, 45);
    FX.burst(c.x, c.gy + 0.3, c.z, 30, [2.6, 2.4, 3.2], 5, 0.5, 0.12, 6);
    FX.dust(c.x, c.gy, c.z, 12, [0.2, 0.18, 0.16]);
  }
  // anyone close is thrown down: burnt and stunned (a plain pass over everyone: strikes are rare, and the spatial
  // grid may not hold someone who arrived this step)
  for (const e of ENT.slice()) {
    const d2 = dist2(e.x, e.z, c.x, c.z);
    if (d2 > 6.5 * 6.5 || !e.alive || e.kind === 'door' || e.flying || inDungeon(e)) continue;
    if (Math.min(Math.abs(e.y - c.gy), Math.abs(e.y + 1 - c.y)) > 4) continue; // on the ground below it, or up on the tower it hit
    if (c.kind === 'house' && houseInside(e.x, e.z)) continue;
    const k = 1 - Math.sqrt(d2) / 6.5;
    dealDamage(SKY_SRC, e, e.maxHp * (0.08 + 0.3 * k), { kind: 'shock', pierce: true });
    if (e.alive && e.role !== 'boss' && e.role !== 'dungeonBoss') { addBuff(e, 'stun', 1, 0.8 + 1.6 * k, null); e.casting = null; }
    e.wet = 0; e.snow = 0;
  }
  // and what it struck catches fire
  let lit = false;
  if (c.kind === 'house') lit = igniteHouse(c.H, c.x, c.z);
  else if (c.kind === 'tree') {
    // igniteTree comes with the nature work (falling and burning trees); until it lands, a fire burns in the crown
    // eslint-disable-next-line no-undef
    if (typeof igniteTree === 'function') lit = igniteTree(c.i) !== false;
    else { addFire(c.x, c.y - 1.8, c.z, 1.5, false, GAME.t + 50, { r: 10, k: 1.3 }); lit = true; }
  }
  const rec = { kind: c.kind, x: Math.round(c.x * 10) / 10, z: Math.round(c.z * 10) / 10, y: Math.round(c.y * 10) / 10, t: GAME.t, lit };
  WEAR.strikes.push(rec);
  if (WEAR.strikes.length > 12) WEAR.strikes.shift();
  if (P && dist2(P.x, P.z, c.x, c.z) < 60 * 60) uiLog(c.kind === 'tree' ? 'Lightning splits a tree nearby!' : c.kind === 'house' ? 'Lightning strikes a roof nearby!' : c.kind === 'tower' ? 'Lightning strikes the tower!' : 'Lightning strikes the ground nearby!', 'warn');
  return rec;
}

/* ---- the warning on the player's frame when gear is breaking ---- */
function updateGearWarn() {
  if (!WEAR_HUD) {
    const pf = document.getElementById('pf');
    if (!pf) return;
    const st = document.createElement('style');
    st.textContent = `#pf-gear{display:flex;align-items:center;gap:6px;font-size:12px;line-height:1.2;color:#ffb48a;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      #pf-gear[hidden]{display:none}#pf-gear.broken{color:#ff7a6a}#pf-gear svg{flex:none}
      .eqslot .dur{position:absolute;left:8px;right:8px;bottom:3px;height:3px;border-radius:2px;background:rgba(0,0,0,.45);overflow:hidden}
      .eqslot .dur i{display:block;height:100%;background:var(--dc,#9be29a)}.eqslot{position:relative}
      .eqslot.broken .nm small{color:#ff8a7a}.kitrep{display:flex;align-items:center;gap:8px;margin:0 0 8px}
      .kitrep .nm{flex:1;min-width:0}.kitrep small{display:block;color:var(--ink-dim);font-size:12px}
      .wearline{display:block;font-size:12.5px;color:var(--ink-dim);margin-top:3px}.wearline .down{color:#ff8a7a}`;
    document.head.appendChild(st);
    const d = document.createElement('div');
    d.id = 'pf-gear'; d.hidden = true;
    pf.appendChild(d);
    WEAR_HUD = d;
  }
  let worst = null;
  for (const s of SLOTS) { const it = INV.eq[s]; if (it && (!worst || itemDur(it) < itemDur(worst))) worst = it; }
  const d = WEAR_HUD, low = worst && itemDur(worst) < 25;
  const text = !low ? '' : itemDur(worst) <= 0 ? `${worst.name} is broken: mend it at a merchant` : `${worst.name} is breaking (${Math.ceil(itemDur(worst))}%)`;
  if (text !== WEAR.lastWarn) {
    WEAR.lastWarn = text;
    d.hidden = !low;
    d.classList.toggle('broken', !!low && itemDur(worst) <= 0);
    d.innerHTML = low ? `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M12 3l10 18H2z"/><path d="M12 10v5M12 18v.5"/></svg><span>${esc(text)}</span>` : '';
  }
}
// durability and grime on an item card (10b_kit.js)
function wearCardLines(it) {
  if (!it || it.slot === 'junk' || !SLOT_DEF[it.slot]) return '';
  const d = itemDur(it), parts = [`Durability ${Math.ceil(d)} / ${DUR_MAX}`];
  if (d <= 0) parts[0] = '<span class="down">Broken: it gives nothing until it is mended</span>';
  if ((it.blood || 0) > 0.05) parts.push('bloodied');
  if ((it.dirt || 0) > 0.05) parts.push(it.dirt > 0.5 ? 'caked in mud' : 'muddy');
  return `<span class="wearline">${parts.join(' · ')}</span>`;
}
function wearSlotBar(it) {
  if (!it) return '';
  const d = itemDur(it) / DUR_MAX;
  return `<span class="dur" style="--dc:${d < 0.25 ? '#ff7a6a' : d < 0.5 ? '#e8c46a' : '#9be29a'}"><i style="width:${Math.round(d * 100)}%"></i></span>`;
}
// the repair row at the top of a merchant's stall
function wearShopRow() {
  // a smith's hammer for the row (ICONS lives in 10_ui.js, so it is added on first use)
  if (!ICONS.mend) ICONS.mend = '<path d="M13.2 3.6l7.2 7.2-2.6 2.6-7.2-7.2z"/><path d="M12 8.6L3.9 16.7a1.9 1.9 0 0 0 2.7 2.7l8.1-8.1"/>';
  const c = repairAllCost();
  const items = kitItems(), worn = items.filter((it) => itemDur(it) < DUR_MAX);
  const avg = items.length ? Math.round(items.reduce((a, it) => a + itemDur(it), 0) / items.length) : 100;
  return `<div class="shoprow kitrep"><span class="ic" style="--qc:#c9b48a">${iconSvg('mend', 22)}</span><span class="nm">Mend your gear<small>${worn.length ? `${worn.length} piece${worn.length === 1 ? '' : 's'} worn · ${avg}% on average` : 'Everything is in good repair.'}</small></span><span class="pr">${c ? fmtInt(c) : ''}</span><span class="bb"><button class="btn" type="button" id="kit-repair" ${c && INV.gold >= c ? '' : 'disabled'}>Repair all</button></span></div>`;
}

/* ---- test hooks ---- */
function weatherAdvance(sec, dt = 0.1) { for (let t = 0; t < sec; t += dt) updateWeather(dt); return { wet: WEATHER.wet, snow: WEATHER.snow, kind: WEATHER.kind, raining: WEATHER.raining, snowing: WEATHER.snowing }; }
function hookWear() {
  if (WEAR.hooked || !window.__hm || !window.__hm.fn) return;
  WEAR.hooked = true;
  Object.assign(window.__hm.fn, { wearOnHit, wearItem, wearVisual, repairAll, repairItem, repairCost, repairAllCost, washGear, wellSpots, strikeNear, strikeAt, skyOver, underCrown, weatherAdvance, itemDur, kitDirt, updateWear });
  window.__hm.dbg.WEAR = WEAR;
}
setTimeout(hookWear, 0); // window.__hm is made at the end of the script
