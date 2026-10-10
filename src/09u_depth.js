/* ================================================================== */
/* depth: the version 8 systems taken further. Berry bushes and apple  */
/* trees burn, are cut down and felled; stumps are grubbed out; hens   */
/* give feathers and game birds can be shot; crafting reaches the      */
/* level cap with rare materials and masterworks; hip roofs, lean-tos, */
/* leaded glazing and wells; townsfolk use built doors; the garrison   */
/* spares its own roofs; laid eggs hatch; a hound herds sheep home.    */
/* ================================================================== */
// Shared-file hooks (all marked [depth]): 09s_survival.js buildForageMeshes (the forage shader patch) and drawForage
// (depthForageInst, depthForageExtra); 04e_houses.js fireLandsAt / fireConeAt (depthFireAt, depthFireCone, the
// caster's realm); 07_entities.js grantKillRewards (depthOnKill) and the fire spells' caster; 07b_classes.js arrows
// strike game birds and the casters of fire; 09_player.js currentInteraction (depthOffers); 09t_craft.js craftBlock /
// craftGear / the recipe card (depthCraftBlock, depthCraftGear, depthCraftLvl); 06b_items.js item levels to 50 for
// crafted gear, the masterwork mark kept; 08h_animals.js thinkAnimal (herding), openAnimalCard (the herd order),
// anBirth (a hen lays a clutch), anLay (fertile eggs), the trough gives the skins back; 13_main.js updateDepth,
// drawDepth, depthOnStart.
const DEPTH = {
  at: 0, slow: 0, job: null, grub: new Set(), pendGrub: null, pendForage: null, burn: [], birds: [], birdT: 0, nests: [], herd: null,
  doorT: 0, wellT: 0, moultT: 0, fx: null, ready: false,
  stats: { burnt: 0, cutBushes: 0, felledApples: 0, grubbed: 0, birdsShot: 0, feathers: 0, hatched: 0, herded: 0, npcDoors: 0, spared: 0, masterworks: 0 },
};
const DP_BURN = { bush: 1, apple: 1, nettle: 1, heal: 1, mana: 1, frost: 1, storm: 1 }; // mushrooms in their damp shade do not burn
const DP_REGROW = { bush: 480, apple: 900, nettle: 300, heal: 300, mana: 300, frost: 300, storm: 300 };
const DP_APPLE = { pivot: 0.42, len: 3.2, trunkR: 0.17 };
const dpAxe = () => goodsHave('tool_axe');
const dpPick = () => goodsHave('tool_pick');
const dpKnife = () => goodsHave('tool_knife');

/* ------------------------------------------------------------------ */
/* the forage shader: charred, cut to a stub or stump, felled          */
/* ------------------------------------------------------------------ */
// iSt per plant: x char (0..1), y the fall angle, z the way it falls (world yaw), w: 0 whole, 1 cut to a stub or a
// stump, 2 the fallen part of a felled apple tree; the fraction of w (x 0.45) is the fire burning in it now
function depthForageVS(src) {
  const need = ['attribute vec4 iPos;', 'float c = cos(iPos.w), s = sin(iPos.w);', 'vO = position;'];
  for (const a of need) if (!src.includes(a)) { reportError(new Error('[depth] forage shader anchor missing: ' + a)); return src; }
  return src
    .replace('attribute vec4 iPos;', 'attribute vec4 iSt; varying vec4 vSt; attribute vec4 iPos;')
    .replace('float c = cos(iPos.w), s = sin(iPos.w);', /* glsl */`
    // [depth] fire strips the leaves and fruit to bare charred twigs
    float dpChar = iSt.x, dpFlag = floor(iSt.w + 0.01);
    vec3 nrmD = normal;
    if (aPart > 0.5 && aPart < 2.5) p = mix(p, aAnc, smoothstep(0.3, 0.92, dpChar));
    if (aPart > 3.5 && aPart < 4.5) p = mix(p, aAnc, smoothstep(0.1, 0.5, dpChar));
    if (dpFlag > 0.5 && dpFlag < 1.5) {
      // cut down: an apple tree's stump, a bush's stubs of stem; everything above is gone
      if (kind > 7.5) { if (position.y > 0.55 || aPart > 0.5) p = vec3(0.0, ${DP_APPLE.pivot.toFixed(2)}, 0.0); else p.y = min(p.y, ${DP_APPLE.pivot.toFixed(2)}); }
      else if (kind < 0.5) { if (aPart > 0.5) p = vec3(0.0, 0.04, 0.0); else p = vec3(p.x * 0.7, min(p.y, 0.09 + 0.05 * fract(position.x * 37.0)), p.z * 0.7); }
      else p = vec3(p.x, min(p.y, 0.03), p.z);
    } else if (dpFlag > 1.5) {
      // the fallen part of an apple tree: everything above the cut turns about it toward the way it falls
      if (position.y < ${DP_APPLE.pivot.toFixed(2)}) p = vec3(0.0, ${DP_APPLE.pivot.toFixed(2)}, 0.0);
      float fa = iSt.z - iPos.w, th = iSt.y;
      vec3 d = vec3(sin(fa), 0.0, cos(fa)), k = vec3(d.z, 0.0, -d.x);
      vec3 q = p - vec3(0.0, ${DP_APPLE.pivot.toFixed(2)}, 0.0);
      q = q * cos(th) + cross(k, q) * sin(th) + k * dot(k, q) * (1.0 - cos(th));
      p = q + vec3(0.0, ${DP_APPLE.pivot.toFixed(2)}, 0.0);
      nrmD = nrmD * cos(th) + cross(k, nrmD) * sin(th) + k * dot(k, nrmD) * (1.0 - cos(th));
    }
    vSt = iSt;
    #define normal nrmD
    float c = cos(iPos.w), s = sin(iPos.w);`);
}
function depthForageFS(src) {
  const need = ['varying vec3 vW;', 'vec3 col = lightSurface(alb, n, ao);'];
  for (const a of need) if (!src.includes(a)) { reportError(new Error('[depth] forage shader anchor missing: ' + a)); return src; }
  return src
    .replace('varying vec3 vW;', 'varying vec4 vSt; varying vec3 vW;')
    .replace('vec3 col = lightSurface(alb, n, ao);', /* glsl */`
    // [depth] charred bark and twigs, embers in the cracks while it burns, fresh pale wood where it was cut
    float dpN = vnoise(vW.xz * 7.0 + vW.y * 5.0) * 0.6 + vnoise(vW.xz * 19.0 - vW.y * 13.0) * 0.4;
    float dpFire = fract(vSt.w) / 0.45;
    alb = mix(alb, vec3(0.045, 0.038, 0.032) * (0.7 + 0.6 * dpN), clamp(vSt.x * (0.75 + 0.5 * dpN), 0.0, 1.0));
    if (vSt.w > 0.5 && vSt.w < 1.5 && vPart < 0.5 && n.y > 0.7 && vSt.x < 0.5) alb = mix(alb, vec3(0.72, 0.6, 0.42) * (0.8 + 0.3 * vnoise(vW.xz * 40.0)), 0.85);
    emit += vec3(2.6, 0.78, 0.16) * dpFire * smoothstep(0.55, 0.85, dpN) * (0.65 + 0.35 * sin(uTime * 9.0 + vW.x * 4.0 + vW.y * 3.0));
    vec3 col = lightSurface(alb, n, ao);`);
}
// [depth] the extra attribute and room for the fallen half of every apple tree (called once, before the first fill)
function dpForageAttrs() {
  if (DEPTH.attrs) return;
  DEPTH.attrs = true;
  for (const key in FORAGE.meshes) {
    const M = FORAGE.meshes[key], g = M.mesh.geometry;
    if (key === 'apple') {
      M.cap *= 2;
      g.setAttribute('iPos', new THREE.InstancedBufferAttribute(new Float32Array(M.cap * 4), 4).setUsage(THREE.DynamicDrawUsage));
      g.setAttribute('iDat', new THREE.InstancedBufferAttribute(new Float32Array(M.cap * 4), 4).setUsage(THREE.DynamicDrawUsage));
    }
    g.setAttribute('iSt', new THREE.InstancedBufferAttribute(new Float32Array(M.cap * 4), 4).setUsage(THREE.DynamicDrawUsage));
  }
}
// one plant's state for the shader (drawForage, 09s_survival.js)
function depthForageInst(p, g, n) {
  if (!g.attributes.iSt) return;
  const flag = p.gone ? 1 : p.cut ? 1 : 0;
  g.attributes.iSt.array.set([p.char || 0, 0, 0, flag + clamp(p.fire || 0, 0, 1) * 0.45], n * 4);
  // a grubbed-out stump is gone; a plant growing back is smaller
  const sc = p.gone ? 0 : p.s * (p.grow ?? 1);
  g.attributes.iDat.array[n * 4] = sc;
  if (p.fall && !p.fall.done || p.fire > 0) FORAGE.dirty = true;
}
// the fallen part of every felled apple tree near the camera, after the plants themselves
function depthForageExtra(fill) {
  const M = FORAGE.meshes.apple;
  if (!M || !M.mesh.geometry.attributes.iSt) return;
  const g = M.mesh.geometry, camX = camera.position.x, camZ = camera.position.z;
  for (const p of FORAGE.list) {
    if (p.k !== 'apple' || !p.log || p.gone || INDOOR.on) continue;
    if (fill.apple >= M.cap || dist2(p.x, p.z, camX, camZ) > 160 * 160) continue;
    const n = fill.apple++, F = p.fall;
    g.attributes.iPos.array.set([p.x + F.ux * F.drop * 0.25, p.y - F.drop * 0.18, p.z + F.uz * F.drop * 0.25, p.yaw], n * 4);
    g.attributes.iDat.array.set([p.s, FORAGE_KINDS.apple.id, p.fallRipe || 0, p.seed], n * 4);
    g.attributes.iSt.array.set([p.char || 0, F.ang, F.yaw, 2 + clamp(p.fire || 0, 0, 1) * 0.45], n * 4);
  }
  g.attributes.iSt.needsUpdate = true;
  for (const k in FORAGE.meshes) if (FORAGE.meshes[k].mesh.geometry.attributes.iSt) FORAGE.meshes[k].mesh.geometry.attributes.iSt.needsUpdate = true;
}

/* ------------------------------------------------------------------ */
/* plants on fire                                                      */
/* ------------------------------------------------------------------ */
function dpIgnite(p, heat = 1) {
  if (!DP_BURN[p.k] || p.gone || p.fire > 0 || (p.char || 0) > 0.85 || heat < 0.2) return false;
  if (p.cut && p.k !== 'apple') return false; // a stub has nothing left to burn
  if (natDry() < 0.25) return false; // soaked through: it smokes and will not take
  if (p.k === 'apple' && p.cut && !p.log) return false;
  p.fire = 0.15; p.burnT = 0; p.nextSpread = 0.6;
  p.burnDur = p.k === 'apple' ? 24 + Math.random() * 12 : p.k === 'bush' ? 11 + Math.random() * 6 : 5 + Math.random() * 3;
  p.ripe = 0; p.at = GAME.t + 1e6; // the fruit is lost; the clock is set again when it has burnt out
  const big = p.k === 'apple', sz = big ? 1.05 * p.s : p.k === 'bush' ? 0.6 * p.s : 0.28;
  const fy = big ? (p.log ? 0.7 : 2.3 * p.s) : p.k === 'bush' ? 0.5 * p.s : 0.12;
  const fx = big && p.log ? p.x + p.fall.ux * 1.8 * p.s : p.x, fz = big && p.log ? p.z + p.fall.uz * 1.8 * p.s : p.z;
  const n0 = FIRES.length;
  addFire(fx, p.y + fy, fz, sz, false, GAME.t + p.burnDur + 6, sz > 0.4 ? { r: big ? 11 : 7, k: big ? 1.1 : 0.85 } : null);
  p.fobj = FIRES.length > n0 ? FIRES[FIRES.length - 1] : null;
  if (!DEPTH.burn.includes(p)) DEPTH.burn.push(p);
  FORAGE.dirty = true;
  DEPTH.stats.burnt++;
  natSfx('crackle', p.x, p.z);
  return true;
}
function dpBurnStep(dt) {
  const dry = natDry();
  for (let i = DEPTH.burn.length - 1; i >= 0; i--) {
    const p = DEPTH.burn[i];
    p.burnT += dt;
    const dying = p.burnT > p.burnDur || dry < 0.2;
    p.fire = dying ? Math.max(0, p.fire - dt * (dry < 0.2 ? 0.45 : 0.16)) : Math.min(1, p.fire + dt * 0.4 * (0.4 + dry));
    p.char = Math.min(1, (p.char || 0) + dt * p.fire / (p.k === 'apple' ? 15 : p.k === 'bush' ? 7 : 3));
    if (p.fobj) { p.fobj.size = (p.k === 'apple' ? 1.05 * p.s : p.k === 'bush' ? 0.6 * p.s : 0.28) * (0.35 + 0.65 * p.fire); if (p.fire < 0.08) p.fobj.until = GAME.t; }
    // the fire runs on: into the grass beneath, the bushes and trees about, a roof close by
    p.nextSpread -= dt;
    if (p.nextSpread <= 0 && p.fire > 0.3) {
      p.nextSpread = 1.1 + Math.random() * 0.8;
      const a = Math.random() * TAU, r = Math.random() * (p.k === 'apple' ? 2.2 : 1.0);
      igniteGrass(p.x + Math.sin(a) * r, p.z + Math.cos(a) * r, 0.9, 1, 0.75);
      for (const o of FORAGE.list) { if (o === p || Math.abs(o.x - p.x) > 5 || Math.abs(o.z - p.z) > 5) continue; if (dist2(o.x, o.z, p.x, p.z) < (p.k === 'apple' ? 4.5 : 3.2) ** 2 && Math.random() < 0.3 * p.fire * dry) dpIgnite(o, 0.8); }
      natTreesNear(p.x, p.z, p.k === 'apple' ? 4.5 : 2.6, (t) => { if (Math.random() < 0.08 * p.fire * dry) igniteTree(t, 0.7); });
      if (p.k === 'apple' && Math.random() < 0.08 * p.fire) { const H = houseAt(p.x, p.z, 2.5); if (H) igniteHouse(H, p.x, p.z); }
    }
    if (p.fire <= 0) {
      p.fire = 0;
      DEPTH.burn.splice(i, 1);
      if (p.fobj) { p.fobj.until = GAME.t; p.fobj = null; }
      // burnt out: it stands charred, then puts out new shoots
      p.regrowAt = GAME.t + (DP_REGROW[p.k] || 400) / (NATURE.speed || 1);
      p.at = p.regrowAt + FORAGE_KINDS[p.k].regrow * 0.5;
      FORAGE.dirty = true;
    }
  }
}
// once a second: the ground burning under a plant sets it alight; burnt and cut plants grow back
function dpForageSlow(dt) {
  if (!FORAGE.ready) return;
  const t = GAME.t;
  for (const p of FORAGE.list) {
    if (p.gone) continue;
    if (!(p.fire > 0) && DP_BURN[p.k] && (p.char || 0) < 0.85 && !(p.cut && p.k !== 'apple') && natGet(p.x, p.z, 2) > 0.2) dpIgnite(p, 0.9);
    if (p.regrowAt && t > p.regrowAt && !(p.fire > 0) && !p.log) {
      if (p.cut) { p.cut = false; p.grow = 0.18; p.char = 0; if (p.coll && p.k === 'apple') { p.coll.h = 3.5; p.coll.stump = false; } }
      else if ((p.char || 0) > 0) { p.char = Math.max(0, p.char - dt / 90); if (p.char > 0) continue; if (p.grow === undefined) p.grow = 0.6; }
      p.regrowAt = 0;
      FORAGE.dirty = true;
    }
    if (p.grow !== undefined && p.grow < 1 && !p.cut && !p.regrowAt) {
      p.grow = Math.min(1, p.grow + dt * (NATURE.speed || 1) / (p.k === 'apple' ? 600 : 240));
      if (p.coll) p.coll.active = p.grow > 0.45;
      if (p.grow >= 1) delete p.grow;
      FORAGE.dirty = true;
    }
  }
}

/* ------------------------------------------------------------------ */
/* cutting bushes, felling apple trees, splitting them, grubbing stumps */
/* ------------------------------------------------------------------ */
const dpStanding = (p) => !p.gone && !p.cut && !(p.fire > 0) && (p.char || 0) < 0.5 && (p.grow ?? 1) > 0.6;
function dpPlantNear(P, r, test) {
  let best = null, bd = r;
  for (const p of FORAGE.list) {
    if (Math.abs(p.x - P.x) > r + 3 || Math.abs(p.z - P.z) > r + 3) continue;
    const d = dist(P.x, P.z, p.x, p.z) - FORAGE_KINDS[p.k].r * p.s * (p.k === 'apple' ? 0.3 : 0.8);
    if (d < bd && Math.abs(P.y - p.y) < 2 && test(p)) { bd = d; best = p; }
  }
  return best ? { p: best, d: Math.max(0.05, bd) } : null;
}
// the nearest felled apple log to the player: distance to its trunk line
function dpLogNear(P, r) {
  let best = null, bd = r;
  for (const p of FORAGE.list) {
    if (p.k !== 'apple' || !p.log || !p.fall || !p.fall.done || Math.abs(p.x - P.x) > 8 || Math.abs(p.z - P.z) > 8) continue;
    const L = DP_APPLE.len * p.s, ox = P.x - p.x, oz = P.z - p.z, along = clamp(ox * p.fall.ux + oz * p.fall.uz, 0.4, L);
    const d = Math.hypot(ox - p.fall.ux * along, oz - p.fall.uz * along) - 0.3;
    if (d < bd) { bd = d; best = p; }
  }
  return best ? { p: best, d: Math.max(0.05, bd) } : null;
}
// a nature stump with nothing lying on it
function dpStumpNear(P, r) {
  let best = null, bd = r;
  for (const t of NATURE.felled) {
    if (t.log || !t.fall || !t.fall.done || t.grubbed || Math.abs(t.x - P.x) > r + 1 || Math.abs(t.z - P.z) > r + 1) continue;
    const d = dist(P.x, P.z, t.x, t.z) - TREE_DIM[t.kind].r * natS(t);
    if (d < bd) { bd = d; best = t; }
  }
  return best ? { t: best, d: Math.max(0.05, bd) } : null;
}
function depthOffers(P, offer) {
  if (!DEPTH.ready || !P || inDungeon(P) || P.mount || P.carrying != null) return;
  const J = DEPTH.job;
  // with a brand in hand: set a bush or an apple tree alight
  if (P.brand) {
    const b = dpPlantNear(P, 2.4, (p) => DP_BURN[p.k] && !p.gone && !(p.fire > 0) && (p.char || 0) < 0.6 && !(p.cut && !p.log));
    if (b && (b.p.k === 'bush' || b.p.k === 'apple')) offer(Math.min(b.d, 0.05), 2.6, `Set the ${FORAGE_KINDS[b.p.k].name} alight`, () => { if (dpIgnite(b.p, 1)) { setAct(P, 5, 0.6); uiLog(`The ${FORAGE_KINDS[b.p.k].name} catches.`, 'warn'); } else uiError('It is too wet to catch'); }, 0.3);
    return;
  }
  const blade = dpKnife() || dpAxe();
  const pb = dpPlantNear(P, 2.2, (p) => p.k === 'bush' && dpStanding(p));
  if (pb && blade && !(J && J.p === pb.p)) offer(pb.d + 0.4, 2.4, 'Cut down the berry bush', () => dpStartJob('cutbush', pb.p), -0.05);
  const pa = dpPlantNear(P, 3.0, (p) => p.k === 'apple' && dpStanding(p));
  if (pa && !(J && J.p === pa.p)) offer(pa.d + 0.3, 2.8, 'Chop down the apple tree', () => dpStartJob('chop', pa.p), -0.05);
  const lg = dpLogNear(P, 2.2);
  if (lg && !(J && J.p === lg.p)) offer(lg.d, 2.4, 'Cut the apple tree into firewood', () => dpStartJob('split', lg.p));
  // stumps: an axe or a pick grubs out the roots, and the ground is free to build on or till
  if (dpAxe() || dpPick()) {
    const st = dpStumpNear(P, 2.0);
    if (st && !(J && J.t === st.t)) offer(st.d, 2.2, `Grub out the ${st.t.kind} stump`, () => dpStartJob('grub', null, st.t), 0.05);
    const ps = dpPlantNear(P, 2.0, (p) => p.cut && !p.log && !p.gone && (p.k === 'apple' || p.k === 'bush'));
    if (ps && !(J && J.p === ps.p)) offer(ps.d, 2.2, ps.p.k === 'apple' ? 'Grub out the apple stump' : 'Dig out the bush\'s roots', () => dpStartJob('grub', ps.p), 0.05);
  }
  depthAnimalOffers(P, offer);
  depthWellOffers(P, offer);
}
function dpStartJob(kind, p, t = null) {
  const P = GAME.player;
  if (!P || !P.alive) return;
  if (P.mount) dismount(P);
  const tx = p ? p.x : t.x, tz = p ? p.z : t.z;
  let ax = tx, az = tz;
  if (kind === 'split') { const L = DP_APPLE.len * p.s, along = clamp((P.x - p.x) * p.fall.ux + (P.z - p.z) * p.fall.uz, 0.8, L); ax = p.x + p.fall.ux * along; az = p.z + p.fall.uz * along; }
  const yaw = Math.atan2(ax - P.x, az - P.z);
  const axe = dpAxe(), pick = dpPick();
  const need = kind === 'cutbush' ? (axe ? 2 : 3) : kind === 'chop' ? (axe ? 3 : 6) : kind === 'split' ? (axe ? 2 : 4) : (pick ? 3 : 4);
  DEPTH.job = { kind, p, t, px: P.x, pz: P.z, yaw, tt: 0, next: 0.15, hitAt: 0, swings: 0, need, ax, az };
  P.yaw = yaw; P.target = null;
  natureCut(ax, az, 1.6, 0.8, false);
  const what = kind === 'cutbush' ? 'Cutting the bush down' : kind === 'chop' ? 'Chopping the apple tree' : kind === 'split' ? 'Cutting the apple tree up' : 'Grubbing out the stump';
  uiToast(`${what}. Move to stop.`, 'hint');
}
function dpJobStep(dt) {
  const J = DEPTH.job;
  if (!J) return;
  const P = GAME.player, p = J.p;
  if (!P || !P.alive || P.casting || P.mount || P.motion || dist(P.x, P.z, J.px, J.pz) > 0.3) { DEPTH.job = null; if (P && P.alive) uiLog('You stop working.', 'sys'); return; }
  if (p && (p.gone || p.fire > 0 || (J.kind === 'chop' && p.cut) || (J.kind === 'split' && !p.log) || (J.kind === 'cutbush' && p.cut))) { DEPTH.job = null; return; }
  if (J.t && (J.t.grubbed || J.t.log)) { DEPTH.job = null; return; }
  J.tt += dt;
  P.yaw = J.yaw;
  const grub = J.kind === 'grub';
  if (J.tt >= J.next && !J.hitAt) { J.next = J.tt + (grub ? 1.15 : 0.95); setAct(P, grub && dpPick() ? 8 : J.kind === 'cutbush' && !dpAxe() ? 1 : 1, grub && dpPick() ? 0.9 : 0.62); J.hitAt = J.tt + (grub && dpPick() ? 0.55 : 0.3); sfx('swing'); }
  if (!J.hitAt || J.tt < J.hitAt) return;
  J.hitAt = 0; J.swings++;
  const ux = Math.sin(J.yaw), uz = Math.cos(J.yaw), gy = heightAt(J.ax, J.az);
  if (J.kind === 'cutbush') {
    for (let i = 0; i < 10; i++) fxAlpha.emit(p.x + (Math.random() - 0.5) * 0.7, p.y + 0.4 + Math.random() * 0.4, p.z + (Math.random() - 0.5) * 0.7, (Math.random() - 0.5) * 1.6, 0.6 + Math.random(), (Math.random() - 0.5) * 1.6, 1.0, 0.2, 0.3, 0.1, 0.05, 6, 0.6);
    natSfx('split', p.x, p.z);
    if (J.swings >= J.need) dpCutBush(p);
  } else if (J.kind === 'chop') {
    natChips(p.x - ux * 0.2 * p.s, p.y + 0.4, p.z - uz * 0.2 * p.s, -ux, -uz, 10);
    natSfx('chop', p.x, p.z);
    p.shakeT = GAME.t;
    if (Math.random() < 0.7) for (let i = 0; i < 5; i++) fxAlpha.emit(p.x + (Math.random() - 0.5) * 2, p.y + 2 + Math.random(), p.z + (Math.random() - 0.5) * 2, (Math.random() - 0.5) * 0.8, -0.4, (Math.random() - 0.5) * 0.8, 2.2, 0.22, 0.34, 0.1, 0.07, 0.6, 1.4);
    if (J.swings >= J.need) { dpFell(p, p.x - P.x, p.z - P.z); DEPTH.job = null; }
  } else if (J.kind === 'split') {
    natChips(J.ax, gy + 0.3, J.az, -ux, -uz, 9);
    natSfx('split', J.ax, J.az);
    if (J.swings >= J.need) dpSplitApple(p);
  } else {
    FX.dust(J.ax, gy + 0.1, J.az, 8, [0.36, 0.28, 0.2]);
    natSfx('chop', J.ax, J.az);
    if (J.swings >= J.need) { if (p) dpGrubPlant(p); else dpGrubTree(J.t); DEPTH.job = null; }
  }
}
function dpCutBush(p) {
  DEPTH.job = null;
  p.cut = true; p.ripe = 0;
  p.regrowAt = GAME.t + DP_REGROW.bush / (NATURE.speed || 1); p.at = p.regrowAt + FORAGE_KINDS.bush.regrow * 0.5;
  if (p.coll) p.coll.active = false;
  FORAGE.dirty = true;
  const got = [];
  const give = (id, n) => { const k = goodsAdd(id, n, true); if (k) got.push(`${k} ${goodName(id, k).toLowerCase()}`); };
  give('stick', 2); give('fibre', 1);
  if (got.length) uiLog(`You cut the bramble down to its roots: ${got.join(', ')}.`, 'loot');
  DEPTH.stats.cutBushes++;
  saveSoon();
}
// an apple tree comes down: away from the axe, into the clearest way
function dpFell(p, dx, dz) {
  const base = Math.atan2(dx, dz) + (Math.random() - 0.5) * 0.2, L = DP_APPLE.len * p.s;
  const clear = (a) => {
    const ux = Math.sin(a), uz = Math.cos(a);
    collidersNear(p.x + ux * L * 0.5, p.z + uz * L * 0.5, L * 0.5 + 3, _natC);
    for (const c of _natC) { if (!c.active || c === p.coll) continue; for (let s = 0.8; s < L; s += 0.6) if (collCovers(c, p.x + ux * s, p.z + uz * s, 0.35)) return false; }
    return !houseAt(p.x + ux * L * 0.7, p.z + uz * L * 0.7, 0.5);
  };
  let ang = base;
  for (const off of [0, 0.35, -0.35, 0.7, -0.7, 1.1, -1.1, 1.6, -1.6, 2.2, -2.2, Math.PI]) if (clear(base + off)) { ang = base + off; break; }
  const ux = Math.sin(ang), uz = Math.cos(ang), pivot = p.y + DP_APPLE.pivot * p.s;
  // where the crown first meets the ground
  let stop = 1.5;
  outer: for (let a = 0.3; a < 1.65; a += 0.02) {
    const sa = Math.sin(a), ca = Math.cos(a);
    for (let r = 0.6; r <= L; r += 0.4) {
      const clr = r < 1.5 * p.s ? 0.2 * p.s : 0.85 * p.s;
      if (pivot + r * ca - clr < heightAt(p.x + ux * r * sa, p.z + uz * r * sa)) { stop = a; break outer; }
    }
  }
  p.fall = { ang: 0.02, vel: 0.14, ux, uz, yaw: ang, stop, done: false, bounces: 0, drop: 0 };
  p.fallRipe = forageShown(p);
  p.cut = true; p.log = true; p.ripe = 0;
  p.at = GAME.t + 1e6;
  if (p.coll) { p.coll.h = 0.6; p.coll.stump = true; }
  FORAGE.dirty = true;
  natSfx('creak', p.x, p.z);
  uiLog('The apple tree comes down.', 'sys');
  DEPTH.stats.felledApples++;
}
function dpFallStep(dt) {
  for (const p of FORAGE.list) {
    const F = p.fall;
    if (!F || F.done && F.drop >= 1) continue;
    if (!F.done) {
      F.vel += (3 * 9.8 / (2 * DP_APPLE.len * p.s)) * Math.sin(F.ang) * dt - F.vel * 0.05 * dt;
      F.ang += F.vel * dt;
      if (F.ang >= F.stop) {
        F.ang = F.stop;
        if (F.bounces === 0) dpLand(p);
        F.bounces++;
        F.vel = -F.vel * (F.bounces === 1 ? 0.2 : 0.1);
        if (Math.abs(F.vel) < 0.08 || F.bounces > 3) { F.vel = 0; F.done = true; dpSettle(p); }
      }
    } else F.drop = Math.min(1, F.drop + dt * 2.5);
    FORAGE.dirty = true;
  }
}
function dpLand(p) {
  const F = p.fall, L = DP_APPLE.len * p.s;
  if (dist2(p.x, p.z, camera.position.x, camera.position.z) < 90 * 90) {
    for (let r = 1; r < L + 1; r += 0.8) { const x = p.x + F.ux * r, z = p.z + F.uz * r; FX.dust(x, heightAt(x, z), z, 3, [0.42, 0.37, 0.29]); }
    for (let i = 0; i < 26; i++) { const r = 1.5 + Math.random() * L, x = p.x + F.ux * r + (Math.random() - 0.5) * 2, z = p.z + F.uz * r + (Math.random() - 0.5) * 2; fxAlpha.emit(x, heightAt(x, z) + 0.8 + Math.random(), z, (Math.random() - 0.5) * 1.5, 0.4 + Math.random(), (Math.random() - 0.5) * 1.5, 2.0, 0.22, 0.34, 0.1, 0.07, 0.6, 1.4); }
  }
  natSfx('crash', p.x + F.ux * L * 0.6, p.z + F.uz * L * 0.6);
  // ripe apples shake loose and roll out over the grass
  if (p.fallRipe > 0.9) { const n = 2 + Math.floor(Math.random() * 3); for (let i = 0; i < n; i++) { const r = 1.8 + Math.random() * 1.6; dropGood('apple', 1, p.x + F.ux * r, p.z + F.uz * r); } p.fallRipe = 0; }
  for (let r = 0.5; r < L; r += 0.8) natureCut(p.x + F.ux * r, p.z + F.uz * r, 0.7, 0.7, false);
}
function dpSettle(p) {
  const F = p.fall, len = 1.6 * p.s * Math.sin(F.ang);
  const cx = p.x + F.ux * (len * 0.5 + 0.5), cz = p.z + F.uz * (len * 0.5 + 0.5);
  p.logColl = addBox(cx, cz, 0.22 * p.s, len * 0.5, Math.atan2(F.ux, F.uz), 'post', 0.5 * p.s);
  p.logColl.natLog = true;
  p.logRotAt = GAME.t + 1200 / (NATURE.speed || 1);
}
function dpSplitApple(p) {
  DEPTH.job = null;
  const F = p.fall, L = DP_APPLE.len * p.s;
  p.log = false;
  if (p.logColl) { p.logColl.active = false; p.logColl = null; }
  if (p.fire > 0 && p.fobj) p.fobj.until = GAME.t;
  const sp = natClearSpot(p.x + F.ux * Math.min(L * 0.5, 2.2), p.z + F.uz * Math.min(L * 0.5, 2.2), p.x, p.z, 0.7);
  natAddPile(sp.x, sp.z, Math.atan2(F.uz, -F.ux), 'oak');
  natSplitGoods({ kind: 'apple' });
  p.regrowAt = GAME.t + DP_REGROW.apple / (NATURE.speed || 1);
  p.at = p.regrowAt + FORAGE_KINDS.apple.regrow; // a young tree fruits once it has grown
  FORAGE.dirty = true;
  saveSoon();
}
// the ground where roots were grubbed out: thrown earth on the nature map, grown over in time
function dpDugEarth(x, z, r) {
  const i0 = natCell(x - r), i1 = natCell(x + r), j0 = natCell(z - r), j1 = natCell(z + r);
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
    if (i < 1 || j < 1 || i >= NAT.res - 1 || j >= NAT.res - 1) continue;
    const q = Math.hypot(i - 511.5 - x, j - 511.5 - z) / r;
    if (q < 1) { const o = natIdx(i, j) * 4; NAT.data[o + 3] = Math.max(NAT.data[o + 3], Math.round(230 * (1 - q * q))); NAT.data[o] = Math.max(NAT.data[o], 200); }
  }
  natTouchRect(i0, j0, i1, j1);
  natMark(i0, j0, i1, j1);
}
function dpGrubTree(t) {
  if (!t || t.grubbed) return;
  t.grubbed = true; t.felled = true; t.regrowAt = 0;
  const i = NATURE.felled.indexOf(t); if (i >= 0) NATURE.felled.splice(i, 1);
  const k = NATURE.dyn.indexOf(t); if (k >= 0) NATURE.dyn.splice(k, 1);
  if (t.coll) t.coll.active = false;
  natShowRegular(t, 0);
  DEPTH.grub.add(t.i);
  dpDugEarth(t.x, t.z, 1.3);
  const got = goodsAdd('firewood', 1, true) + goodsAdd('stick', 2, true);
  uiLog(`You grub out the ${t.kind} stump, roots and all${got ? ': firewood and sticks' : ''}. The ground is clear.`, 'loot');
  DEPTH.stats.grubbed++;
  saveSoon();
}
function dpGrubPlant(p) {
  p.gone = true; p.cut = true; p.regrowAt = 0; p.ripe = 0; p.at = GAME.t + 1e7; // never fruits again
  if (p.coll) p.coll.active = false;
  dpDugEarth(p.x, p.z, p.k === 'apple' ? 1.2 : 1.0);
  goodsAdd(p.k === 'apple' ? 'firewood' : 'stick', p.k === 'apple' ? 1 : 2, true);
  uiLog(p.k === 'apple' ? 'You grub out the apple stump. The ground is clear.' : 'You dig out the bramble\'s roots. Nothing will grow back here.', 'loot');
  FORAGE.dirty = true;
  DEPTH.stats.grubbed++;
  saveSoon();
}
// fire spells, brands and dragon's breath (fireLandsAt / fireConeAt in 04e_houses.js)
function depthFireAt(x, y, z, r = 1) {
  if (!FORAGE.ready || x > DUN_X0 - 50 || y - heightAt(x, z) > 4) return;
  for (const p of FORAGE.list) {
    if (Math.abs(p.x - x) > r + 3 || Math.abs(p.z - z) > r + 3 || !DP_BURN[p.k]) continue;
    const reach = r + FORAGE_KINDS[p.k].r * p.s + 0.4;
    if (dist2(p.x, p.z, x, z) < reach * reach && Math.random() < (r > 1.5 ? 0.85 : 0.55)) dpIgnite(p, r > 1.5 ? 1 : 0.8);
  }
}
function depthFireCone(x, z, dx, dz, range, half) {
  if (!FORAGE.ready) return;
  for (const p of FORAGE.list) {
    if (Math.abs(p.x - x) > range + 2 || Math.abs(p.z - z) > range + 2 || !DP_BURN[p.k]) continue;
    const ox = p.x - x, oz = p.z - z, d = Math.hypot(ox, oz);
    if (d > range || (d > 1.5 && (ox * dx + oz * dz) / d < Math.cos(half))) continue;
    if (Math.random() < 0.5) dpIgnite(p, 1);
  }
}

/* ------------------------------------------------------------------ */
/* the garrison spares its own roofs                                   */
/* ------------------------------------------------------------------ */
// fire cast by someone other than the player, in their own realm's town or keep, sets nothing of theirs alight
function dpFireRealm(by) {
  const e = by && typeof by === 'object' ? by : by != null ? getEnt(by) : null;
  if (!e || e === GAME.player || e.role === 'player' || !(e.faction >= 0 && e.faction <= 2)) return -1;
  return e.faction;
}
function dpHouseRealm(H) {
  if (H.keepHall) { const K = WAR.keeps.find((k) => k.site === H.S); return K ? K.realm : H.realm; }
  return H.realm;
}
// is (x, z) on realm r's own ground: its town, or a keep it holds
function dpOwnGround(r, x, z) {
  if (r < 0) return false;
  const R = REALMS[r];
  if (R && R.town && dist2(x, z, R.town.x, R.town.z) < (R.town.r + 30) ** 2) return true;
  for (const K of WAR.keeps) if (K.realm === r && dist2(x, z, K.site.x, K.site.z) < (K.site.r + 18) ** 2) return true;
  return false;
}
function depthSparesHouse(H, by) {
  const r = dpFireRealm(by);
  if (r < 0 || dpHouseRealm(H) !== r) return false;
  DEPTH.stats.spared++;
  return true;
}
function depthSparesGround(x, z, by) {
  const r = dpFireRealm(by);
  return r >= 0 && dpOwnGround(r, x, z);
}
// built pieces are the player's: a fire from the player's own realm's soldiers leaves them be
function depthSparesBuilt(by) {
  const r = dpFireRealm(by), P = GAME.player;
  return r >= 0 && P && r === P.faction;
}

/* ------------------------------------------------------------------ */
/* feathers and game birds                                             */
/* ------------------------------------------------------------------ */
const DP_BIRD = {
  pheasant: { name: 'pheasant', henName: 'hen pheasant', colA: [0.62, 0.28, 0.09], colB: [0.05, 0.19, 0.12], hen: { colA: [0.52, 0.4, 0.25], colB: [0.38, 0.29, 0.18] }, scale: 1.18, hp: 26, flushR: 9, meat: [1, 1], feathers: [3, 5] },
  duck: { name: 'mallard', henName: 'mallard duck', colA: [0.52, 0.5, 0.46], colB: [0.03, 0.22, 0.09], hen: { colA: [0.5, 0.38, 0.25], colB: [0.4, 0.3, 0.19] }, scale: 1.0, hp: 22, flushR: 11, meat: [1, 1], feathers: [2, 4] },
};
function dpBirdHome(kind, R, rnd) {
  for (let tries = 0; tries < 400; tries++) {
    if (kind === 'duck') {
      const L = LAKES[Math.floor(rnd() * LAKES.length)];
      if (!L || L.x > DUN_X0 - 60) continue;
      if (realmAt(L.x, L.z) !== R.id && rnd() < 0.7) continue;
      const a = rnd() * TAU, d = L.r * (0.25 + rnd() * 0.45), x = L.x + Math.sin(a) * d, z = L.z + Math.cos(a) * d;
      const w = waterAt(x, z);
      if (w && w.depth > 0.6) return { x, z, r: Math.min(14, L.r * 0.4), water: true };
    } else {
      const a = R.bearing + (rnd() - 0.5) * 1.6, d = R_RING + 60 + rnd() * 170, x = Math.sin(a) * d, z = -Math.cos(a) * d;
      if (Math.hypot(x, z) > 450 || !isWalkable(x, z) || waterAt(x, z) || sampleGrid(W.grass, x, z) < 0.55 || sampleGrid(W.road, x, z) > 0.05) continue;
      if (SITES.some((S) => dist2(S.x, S.z, x, z) < (S.r + 30) ** 2) || CAMPS.some((c) => dist2(c.x, c.z, x, z) < 45 * 45)) continue;
      return { x, z, r: 9, water: false };
    }
  }
  return null;
}
function dpSpawnBird(kind, home) {
  const D = DP_BIRD[kind], a = Math.random() * TAU, d = Math.random() * home.r * 0.7;
  let x = home.x + Math.sin(a) * d, z = home.z + Math.cos(a) * d;
  if (home.water ? !waterAt(x, z) : !isWalkable(x, z)) { x = home.x; z = home.z; }
  const w = home.water ? waterAt(x, z) : null, y = w ? w.y - 0.13 : heightAt(x, z);
  const e = makeEnt({ kind, faction: FACTION_NEUTRAL, role: 'bird', name: D.name, level: 1, x, z, y, yaw: Math.random() * TAU, radius: 0.28, speed: 3.4, scale: D.scale });
  e.game = true; e.crowd = crowdBeast[kind] ? kind : 'hen'; e.scale = D.scale; e.visCode = 16 * Math.random();
  // cocks and drakes in their colours, hens in mottled browns
  const hen = Math.random() < 0.35, L = hen ? D.hen : D;
  e.look = { colA: L.colA.map((v) => v * (0.9 + Math.random() * 0.2)), colB: L.colB.slice() };
  if (hen) e.name = D.henName;
  e.maxHp = e.hp = D.hp;
  e.fixedY = y;
  e.bird = { home, mode: 'idle', until: GAME.t + Math.random() * 4, fly: null, vy: 0, water: !!home.water };
  DEPTH.birds.push(e);
  return e;
}
function dpSpawnBirds() {
  const rnd = mulberry(5150);
  DEPTH.flocks = [];
  for (const R of REALMS) {
    for (let k = 0; k < 3; k++) { const h = dpBirdHome('pheasant', R, rnd); if (h) DEPTH.flocks.push({ kind: 'pheasant', home: h, n: 2 + (k % 2), next: 0 }); }
    for (let k = 0; k < 2; k++) { const h = dpBirdHome('duck', R, rnd); if (h) DEPTH.flocks.push({ kind: 'duck', home: h, n: 3, next: 0 }); }
  }
  for (const F of DEPTH.flocks) for (let i = 0; i < F.n; i++) { const e = dpSpawnBird(F.kind, F.home); e.flock = F; }
}
// the birds' own step: they peck and paddle about, flush when someone comes close, fly off and come down again
function dpBirdStep(dt) {
  const P = GAME.player;
  for (let i = DEPTH.birds.length - 1; i >= 0; i--) {
    const e = DEPTH.birds[i], B = e.bird;
    if (e.removed) { DEPTH.birds.splice(i, 1); continue; }
    if (!e.alive) {
      // shot down: it falls where it was hit and lies there (or floats)
      if (B.fly || e.fixedY !== null) {
        const w = waterAt(e.x, e.z), g = w ? w.y - 0.1 : heightAt(e.x, e.z);
        B.vy = (B.vy || 0) - 9.8 * dt;
        e.fixedY = Math.max(g, (e.fixedY ?? e.y) + B.vy * dt);
        e.y = e.fixedY;
        if (e.fixedY <= g + 0.001) { B.fly = null; e.fixedY = null; e.y = g; if (w) splashAt(e.x, e.z, 0.3); else FX.dust(e.x, g, e.z, 4); }
      }
      continue;
    }
    if (P && dist2(e.x, e.z, P.x, P.z) > 200 * 200 && !B.fly) { e.prevX = e.x; e.prevZ = e.z; continue; }
    const D = DP_BIRD[e.kind];
    // flushed: by anyone close on foot (a hidden archer creeps nearer), by an arrow, a blow or a hound
    if (!B.fly) {
      let scare = null;
      const near = (o) => o.alive && o !== e && isActor(o) && o.role !== 'bird' && o.kind !== 'hen' && !(o.tame && o.tame.k !== 'hound');
      forNear(e.x, e.z, D.flushR, (o) => { if (!scare && near(o)) { const r = o === P && P.cs && P.cs.hidden ? D.flushR * 0.45 : o === P && !P.mount && (P._spd || 0) < 2.5 ? D.flushR * 0.7 : D.flushR; if (dist2(o.x, o.z, e.x, e.z) < r * r) scare = o; } });
      if (e.lastHitAt && GAME.t - e.lastHitAt < 1) scare = scare || getEnt(e.lastHitBy) || e;
      if (scare) dpFlush(e, scare.x, scare.z);
    }
    if (B.fly) { dpBirdFly(e, B, dt); continue; }
    // on the water or in the grass
    const w = B.water ? waterAt(e.x, e.z) : null;
    if (GAME.t > B.until) {
      const r = Math.random();
      if (r < 0.45) { B.mode = 'peck'; B.until = GAME.t + 2 + Math.random() * 3; setAct(e, 7, B.until - GAME.t); if (B.water && Math.random() < 0.5) rippleDrop(e.x, e.z, 0.25, 0.2); }
      else { const a = Math.random() * TAU, d = 1.5 + Math.random() * 4; B.goal = { x: e.x + Math.sin(a) * d, z: e.z + Math.cos(a) * d }; if (dist(B.goal.x, B.goal.z, B.home.x, B.home.z) > B.home.r) B.goal = { x: B.home.x + (Math.random() - 0.5) * 4, z: B.home.z + (Math.random() - 0.5) * 4 }; B.mode = 'walk'; B.until = GAME.t + 3 + Math.random() * 3; }
    }
    if (B.mode === 'walk' && B.goal) {
      const dx = B.goal.x - e.x, dz = B.goal.z - e.z, d = Math.hypot(dx, dz);
      const ok = (x, z) => (B.water ? !!waterAt(x, z) && waterAt(x, z).depth > 0.35 : isWalkable(x, z) && !waterAt(x, z));
      if (d > 0.3) { const sp = (B.water ? 0.7 : 0.9) * dt, nx = e.x + dx / d * sp, nz = e.z + dz / d * sp; if (ok(nx, nz)) { e.x = nx; e.z = nz; } else B.goal = null; e.yaw = Math.atan2(dx, dz); }
      else B.mode = 'idle';
    }
    const w2 = B.water ? waterAt(e.x, e.z) : null;
    e.fixedY = w2 ? w2.y - 0.13 + 0.015 * Math.sin(GAME.t * 2.1 + e.id) : heightAt(e.x, e.z);
    if (w2 && B.mode === 'walk' && Math.random() < dt * 1.5) rippleDrop(e.x - Math.sin(e.yaw) * 0.25, e.z - Math.cos(e.yaw) * 0.25, 0.2, 0.15);
    void w;
  }
  // flocks come back to their haunts in a while
  DEPTH.birdT -= dt;
  if (DEPTH.birdT <= 0 && DEPTH.flocks) {
    DEPTH.birdT = 15;
    for (const F of DEPTH.flocks) {
      const n = DEPTH.birds.filter((e) => e.flock === F && e.alive && !e.removed).length;
      if (n >= F.n) { F.next = 0; continue; }
      if (!F.next) { F.next = GAME.t + 200 + Math.random() * 120; continue; }
      if (GAME.t < F.next || (P && dist(P.x, P.z, F.home.x, F.home.z) < 40)) continue;
      F.next = 0;
      const e = dpSpawnBird(F.kind, F.home); e.flock = F;
    }
  }
}
function dpFlush(e, fx, fz) {
  const B = e.bird;
  let a = Math.atan2(e.x - fx, e.z - fz) + (Math.random() - 0.5) * 0.8;
  if (!isFiniteNum(a)) a = Math.random() * TAU;
  B.fly = { t: 0, ux: Math.sin(a), uz: Math.cos(a), sp: 7.5 + Math.random() * 2.5, top: 6 + Math.random() * 5, far: 55 + Math.random() * 45, gone: 0, y0: e.y };
  setAct(e, 5, 1.2);
  if (B.water) splashAt(e.x, e.z, 0.5, { up: 1.5 });
  for (let i = 0; i < 4; i++) fxAlpha.emit(e.x, e.y + 0.4, e.z, (Math.random() - 0.5) * 1.4, 0.5 + Math.random(), (Math.random() - 0.5) * 1.4, 1.6, e.look.colA[0], e.look.colA[1], e.look.colA[2], 0.04, 0.5, 1.2);
  sfx('swing');
}
function dpBirdFly(e, B, dt) {
  const F = B.fly;
  F.t += dt;
  // up steeply at first, a long flight out, then a glide down to a new spot near home
  const g0 = heightAt(e.x, e.z), climb = Math.min(1, F.t / 1.6);
  F.gone += F.sp * dt;
  const nx = e.x + F.ux * F.sp * dt, nz = e.z + F.uz * F.sp * dt;
  e.yaw = Math.atan2(F.ux, F.uz);
  e.x = nx; e.z = nz;
  const land = F.gone > F.far;
  const want = land ? g0 : Math.max(g0, F.y0) + F.top * (0.35 + 0.65 * climb);
  e.fixedY = lerp(e.fixedY ?? e.y, want, 1 - Math.exp(-dt * (land ? 1.6 : 2.6)));
  e.y = e.fixedY;
  e.anim.amt = land ? 1.25 : 1.6;
  e.anim.phase = 1.885; // in the air the legs stop walking: one hangs, one is drawn up
  if (land) {
    // over water a duck comes down on it; a pheasant only on dry walkable ground
    const w = waterAt(e.x, e.z);
    const ok = B.water ? w && w.depth > 0.5 : isWalkable(e.x, e.z) && !w;
    if (!ok && F.gone > F.far + 160) { const h = B.home; F.ux = h.x - e.x; F.uz = h.z - e.z; const d = Math.hypot(F.ux, F.uz) || 1; F.ux /= d; F.uz /= d; F.far = F.gone + d; }
    if (ok && e.fixedY - (w ? w.y : g0) < 0.25) {
      B.fly = null; B.mode = 'idle'; B.until = GAME.t + 2;
      e.fixedY = w ? w.y - 0.13 : g0;
      if (w) splashAt(e.x, e.z, 0.4);
      if (dist(e.x, e.z, B.home.x, B.home.z) > 60) B.home = { ...B.home, x: e.x, z: e.z };
    } else if (!ok && F.gone > F.far + 20) F.far = F.gone + 15;
  }
  // past the edge of the world: turn home
  if (Math.abs(e.x) > HALF - 30 || Math.abs(e.z) > HALF - 30) { F.ux = -F.ux; F.uz = -F.uz; }
}
// called when something the player hurt dies (grantKillRewards, 07_entities.js)
function depthOnKill(e) {
  if (!e || inDungeon(e) && e.role !== 'mob' && e.role !== 'dungeonBoss') return;
  const knife = dpKnife();
  if (DP_BIRD[e.kind]) {
    const D = DP_BIRD[e.kind];
    const nf = D.feathers[0] + Math.floor(Math.random() * (D.feathers[1] - D.feathers[0] + 1)) + (knife ? 1 : 0);
    dropGood('feather', nf, e.x, e.z, (e.fixedY ?? e.y) + 0.3);
    dropGood('meat_raw', D.meat[0] + (knife && Math.random() < 0.5 ? 1 : 0), e.x, e.z, (e.fixedY ?? e.y) + 0.3);
    for (let i = 0; i < 10; i++) fxAlpha.emit(e.x, (e.fixedY ?? e.y) + 0.3, e.z, (Math.random() - 0.5) * 1.6, 0.3 + Math.random(), (Math.random() - 0.5) * 1.6, 2.4, e.look.colA[0], e.look.colA[1], e.look.colA[2], 0.05, 0.4, 1.4);
    DEPTH.stats.birdsShot++;
    return;
  }
  // (a hen killed is plucked by the animals' own carcass drops: anCarcass, 08h_animals.js)
  // the rare materials of the late game
  if (e.role === 'dungeonBoss') { dropGood('grave_iron', 4 + Math.floor(Math.random() * 3), e.x, e.z, e.y + 1); return; }
  if (e.kind === 'dragon') { dropGood('dragon_scale', 4 + Math.floor(Math.random() * 3), e.x, e.z, e.y + 1.5); return; }
  if (inDungeon(e) && e.faction === FACTION_MONSTER && (e.mobType === 'skeleton' || e.mobType === 'draugr')) { if (Math.random() < (e.elite ? 0.8 : 0.2)) dropGood('grave_iron', e.elite ? 2 : 1, e.x, e.z, e.y + 0.8); return; }
  if (e.elite && e.faction === FACTION_MONSTER && !inDungeon(e)) { dropGood('trophy', 1, e.x, e.z, e.y + 0.8); uiLog(`You take a trophy from ${e.name}.`, 'loot'); }
}
// hens in a paddock moult: feathers lie about to be gathered (walk over them)
function dpMoult(dt) {
  DEPTH.moultT -= dt;
  if (DEPTH.moultT > 0) return;
  DEPTH.moultT = 5;
  for (const e of ANIMALS.list) {
    const r = e.tame;
    if (!e.alive || !r || r.k !== 'hen' || r.owner !== 'player' || r.cmd !== 'pen' || !anAdult(r)) continue;
    r.moult = (r.moult || 0) + 5 * (0.5 + r.mood);
    if (r.moult < 240) continue;
    r.moult = 0;
    const near = LOOT.filter((L) => L.item && L.item.goods === 'feather' && dist2(L.x, L.z, e.x, e.z) < 12 * 12).length;
    if (near >= 6) continue;
    dropGood('feather', 1 + (Math.random() < 0.4 ? 1 : 0), e.x + (Math.random() - 0.5) * 0.4, e.z + (Math.random() - 0.5) * 0.4, e.y + 0.3);
    DEPTH.stats.feathers++;
  }
}

/* ------------------------------------------------------------------ */
/* eggs that hatch: a clutch in the nest, and fertile eggs in the pen  */
/* ------------------------------------------------------------------ */
const DP_HATCH = 150;
const dpCockNear = (e) => ANIMALS.list.find((o) => o !== e && o.alive && !o.removed && o.tame && o.tame.k === 'hen' && o.tame.sex === 'm' && anAdult(o.tame) && o.tame.owner === e.tame.owner && dist2(o.x, o.z, e.x, e.z) < 14 * 14);
// a hen that has paired lays her clutch in the nest box in the shed (anBirth, 08h_animals.js)
function depthClutch(e, sire) {
  const rec = e.tame, pen = penById(rec.pen);
  let x = e.x, z = e.z;
  if (pen && pen.shedL) { const k = DEPTH.nests.filter((N) => N.pen === pen.id).length, s = penWorld(pen, pen.shedL.x + ((k % 3) - 1) * 0.7, pen.shedL.z + (Math.floor(k / 3) % 2 - 0.5) * 0.6); x = s.x; z = s.z; }
  const n = 3 + Math.floor(Math.random() * 3);
  DEPTH.nests.push({ x, z, y: floorAt(x, z, heightAt(x, z) + 0.5), eggs: n, at: GAME.t + DP_HATCH, ma: { aid: rec.aid, name: rec.name, gen: rec.gen, tr: JSON.parse(JSON.stringify(rec.tr)) }, pa: sire ? { aid: sire.aid, name: sire.name, gen: sire.gen || 0, tr: JSON.parse(JSON.stringify(sire.tr)) } : null, pen: rec.pen, owner: rec.owner, seed: Math.random() });
  if (rec.owner === 'player') uiLog(`${rec.name} has laid a clutch of ${n} eggs in the nest. Leave them and they hatch in a few minutes; take them and they are breakfast.`, 'sys');
  saveSoon();
}
// a laid egg is fertile when a cockerel runs with the flock (anLay, 08h_animals.js)
function depthLaid(e, L) {
  if (!L || !e.tame) return;
  const cock = dpCockNear(e);
  if (!cock || Math.random() > 0.5) return;
  L.hatch = { at: GAME.t + DP_HATCH * 1.3, ma: { aid: e.tame.aid, name: e.tame.name, gen: e.tame.gen, tr: JSON.parse(JSON.stringify(e.tame.tr)) }, pa: { aid: cock.tame.aid, name: cock.tame.name, gen: cock.tame.gen, tr: JSON.parse(JSON.stringify(cock.tame.tr)) }, pen: e.tame.pen, owner: e.tame.owner };
  L.until = Math.max(L.until, L.hatch.at + 60);
}
function dpHatchOne(N, x, z) {
  if (N.owner === 'town' && ANIMALS.list.filter((o) => o.tame && o.tame.pen === N.pen && o.alive).length > 22) return null;
  const tr = N.pa ? anInherit(N.ma.tr, N.pa.tr) : anWildTraits('hen');
  const young = anRecord('hen', { owner: N.owner, age: 0, tr, gen: Math.max(N.ma.gen || 0, N.pa ? N.pa.gen || 0 : 0) + 1, ma: { aid: N.ma.aid, name: N.ma.name }, pa: N.pa ? { aid: N.pa.aid, name: N.pa.name } : null, cmd: N.pen != null ? 'pen' : 'follow', pen: N.pen, hunger: 0.9 });
  young.breedAt = GAME.t + AKIND.hen.grow * 1.2;
  const c = anSpawn(young, x, z);
  anHearts(c, 2);
  for (let i = 0; i < 5; i++) fxAlpha.emit(x, heightAt(x, z) + 0.06, z, (Math.random() - 0.5) * 0.5, 0.5 + Math.random() * 0.4, (Math.random() - 0.5) * 0.5, 1.0, 0.92, 0.88, 0.76, 0.03, 4, 0.5);
  DEPTH.stats.hatched++;
  return young;
}
function dpHatchStep() {
  for (let i = DEPTH.nests.length - 1; i >= 0; i--) {
    const N = DEPTH.nests[i];
    if (GAME.t < N.at) continue;
    DEPTH.nests.splice(i, 1);
    const names = [];
    for (let k = 0; k < N.eggs; k++) { const y = dpHatchOne(N, N.x + (Math.random() - 0.5) * 0.5, N.z + (Math.random() - 0.5) * 0.5); if (y) names.push(y.name); }
    if (N.owner === 'player' && names.length) { uiToast(`The eggs in ${N.ma.name}'s nest have hatched: ${names.length} chick${names.length > 1 ? 's' : ''} (${names.join(', ')}).`, 'quest'); sfx('heal'); saveSoon(); }
  }
  for (let i = LOOT.length - 1; i >= 0; i--) {
    const L = LOOT[i];
    if (!L.hatch || !L.item || L.item.goods !== 'egg' || GAME.t < L.hatch.at) continue;
    LOOT.splice(i, 1);
    const y = dpHatchOne(L.hatch, L.x, L.z);
    if (y && L.hatch.owner === 'player') uiLog(`An egg left lying in the paddock hatches: a chick, ${y.name}.`, 'sys');
  }
}
function depthAnimalOffers(P, offer) {
  for (const N of DEPTH.nests) {
    if (N.owner !== 'player') continue;
    const d = dist(P.x, P.z, N.x, N.z);
    if (d < 2.2) offer(d, 2.2, `Take the eggs from the nest (${N.eggs})`, () => { const k = goodsAdd('egg', N.eggs, true); if (k) { DEPTH.nests.splice(DEPTH.nests.indexOf(N), 1); uiLog(`You take ${k} eggs from the nest.`, 'loot'); saveSoon(); } }, 0.05);
  }
}

/* ------------------------------------------------------------------ */
/* a hound herds the sheep home                                        */
/* ------------------------------------------------------------------ */
function dpStraySheep(pen) {
  return ANIMALS.list.filter((o) => o.alive && !o.removed && o.tame && o.tame.k === 'sheep' && o.tame.owner === 'player' && !(o.tame.cmd === 'pen' && penHas(pen, o.x, o.z, 0.3)) && dist2(o.x, o.z, pen.x, pen.z) < 90 * 90);
}
function dpHerdPen(e) {
  const mine = ANIMALS.pens.filter((p) => p.owner === 'player');
  if (!mine.length) return null;
  const sheepPen = ANIMALS.list.find((o) => o.alive && o.tame && o.tame.k === 'sheep' && o.tame.owner === 'player' && penById(o.tame.pen));
  if (sheepPen) return penById(sheepPen.tame.pen);
  return mine.reduce((a, p) => (dist2(p.x, p.z, e.x, e.z) < dist2(a.x, a.z, e.x, e.z) ? p : a), mine[0]);
}
function depthHerdable(e) { const pen = dpHerdPen(e); return !!pen && dpStraySheep(pen).length > 0; }
function depthHerdStart(e) {
  const pen = dpHerdPen(e);
  if (!pen) { uiError('You have no paddock to bring them to'); return; }
  const rec = e.tame;
  rec.prevCmd = rec.cmd === 'herd' ? rec.prevCmd : rec.cmd;
  rec.cmd = 'herd';
  DEPTH.herd = { hound: e.id, pen: pen.id, until: GAME.t + 240, cur: null, n: 0 };
  uiLog(`${rec.name} runs out wide round the sheep.`, 'sys');
  anVoice('hound', e);
}
function dpHerdEnd(e, msg) {
  const rec = e.tame;
  rec.cmd = rec.prevCmd && rec.prevCmd !== 'herd' ? rec.prevCmd : 'follow';
  if (msg && rec.owner === 'player') uiLog(msg, 'sys');
  DEPTH.herd = null;
}
// the hound's think while herding (thinkAnimal, 08h_animals.js): out wide behind a stray, then in, pressing it on
// toward the gate; the sheep runs from it and the flock goes home
function depthHerdThink(e, dt) {
  const H = DEPTH.herd;
  if (!H || H.hound !== e.id) { dpHerdEnd(e); return false; }
  const pen = penById(H.pen);
  if (!pen || GAME.t > H.until) { dpHerdEnd(e, `${e.tame.name} gives up and comes back to you.`); return false; }
  const strays = dpStraySheep(pen);
  if (!strays.length) { dpHerdEnd(e, `${e.tame.name} has the sheep in the paddock${H.n ? ` (${H.n} brought in)` : ''}.`); return false; }
  // the one it is working: the stray farthest from the gate, kept until it is through
  let S = strays.find((o) => o.id === H.cur);
  if (!S || GAME.t > (H.curUntil || 0)) {
    S = strays.filter((o) => o.id !== H.cur || strays.length === 1).reduce((a, o) => (dist2(o.x, o.z, pen.gateOut.x, pen.gateOut.z) > dist2(a.x, a.z, pen.gateOut.x, pen.gateOut.z) ? o : a), strays[0]);
    H.cur = S.id; H.curUntil = GAME.t + 25; H.sent = false;
  }
  const gx = pen.gateOut.x, gz = pen.gateOut.z, dx = S.x - gx, dz = S.z - gz, d = Math.hypot(dx, dz) || 1;
  // out wide and round behind it, on the far side from the gate, then in close behind, pressing it on
  const back = H.sent ? 2.8 : 4.2;
  const bx = S.x + (dx / d) * back, bz = S.z + (dz / d) * back;
  const db = dist(e.x, e.z, bx, bz);
  if (!H.sent) {
    if (db > 1.6) { anGoTo(e, bx, bz, dt, db > 8 ? 1.5 : 1.0, 0.8, false); return true; }
    // in behind it: the sheep breaks for home
    anCommand(S, 'pen', pen);
    S.ai.flee = null;
    H.sent = true; H.n++;
    DEPTH.stats.herded++;
    anVoice('hound', e);
    setAct(e, 5, 0.5);
    return true;
  }
  // pressing: keep behind it, low and steady, until it is through the gate
  if (db > 0.8) anGoTo(e, bx, bz, dt, db > 5 ? 1.2 : 0.62, 0.5, false);
  else { faceToward(e, S.x, S.z); if (GAME.t > (e.ai.until || 0)) { setAct(e, 9, 0.8); e.ai.until = GAME.t + 1.2; } }
  if (Math.random() < dt * 0.25) anVoice('hound', e);
  return true;
}

/* ------------------------------------------------------------------ */
/* built doors: the townsfolk and the garrison open them and pass      */
/* ------------------------------------------------------------------ */
function dpDoorsStep(dt) {
  DEPTH.doorT -= dt;
  if (DEPTH.doorT > 0) return;
  DEPTH.doorT = 0.25;
  const P = GAME.player;
  for (const pc of BUILD.pieces) {
    if (pc.st !== 'built' || (pc.t !== 'door' && pc.t !== 'gate')) continue;
    if (P && dist2(P.x, P.z, pc.x, pc.z) > 140 * 140) continue;
    const c = Math.cos(pc.yaw), s = Math.sin(pc.yaw), hw = pc.t === 'gate' ? 1.4 : 0.6;
    let coming = false;
    forNear(pc.x, pc.z, 3.2, (o) => {
      if (!o.alive || o === P || o.kind === 'door' || !isActor(o) || o.flying) return;
      if (P && o.faction <= 2 && o.faction !== P.faction) return; // the enemy finds it shut
      const dx = o.x - pc.x, dz = o.z - pc.z, lx = dx * c - dz * s, lz = dx * s + dz * c;
      if (Math.abs(lx) > hw + 0.9) return;
      // its way across the doorway since the last look (a quarter of a second ago), toward the wall
      const vx = o.x - (o._dpPX ?? o.x), vz = o.z - (o._dpPZ ?? o.z), vl = vx * s + vz * c;
      o._dpPX = o.x; o._dpPZ = o.z;
      if (Math.abs(lz) < 2.6 && (vl * lz < -0.004 || Math.abs(lz) < 0.9)) coming = true;
      // nobody idles in a doorway: a body standing in it steps out to the side it came from
      if (Math.abs(lz) < 0.55 + o.radius && Math.abs(lx) < hw && Math.hypot(vx, vz) < 0.02) {
        o._dpDoorT = (o._dpDoorT || 0) + 0.25;
        if (o._dpDoorT > 1.5) { const sd = lz >= 0 ? 1 : -1; stepTo(o, o.x + s * sd * 1.1, o.z + c * sd * 1.1); o._dpDoorT = 0; }
      } else o._dpDoorT = 0;
    });
    if (coming) {
      if (!pc.open) { if (buildSetOpen(pc, true)) { pc.npcOpen = true; DEPTH.stats.npcDoors++; } }
      if (pc.npcOpen) pc.npcUntil = GAME.t + 2.2;
    } else if (pc.npcOpen && GAME.t > (pc.npcUntil || 0) && !(P && dist2(P.x, P.z, pc.x, pc.z) < 2.4 * 2.4)) {
      if (buildSetOpen(pc, false)) pc.npcOpen = false;
    }
  }
}

/* ------------------------------------------------------------------ */
/* hip roofs, lean-tos, leaded glazing and wells                       */
/* ------------------------------------------------------------------ */
BP.roofHip = { name: 'Hip roof', kind: 'cell', cost: [['thatch', 9], ['plank', 4]], time: 8, burn: 2, roof: true, desc: 'A thatched roof sloping down on all four sides to the walls, with no gable ends.' };
BP.roofLean = { name: 'Lean-to roof', kind: 'cell', cost: [['plank', 5], ['nails', 5]], time: 6, burn: 1, roof: true, desc: 'A single slope of shingles, high on one wall and low on the other (R turns it). Good against a wall.' };
BP.well = { name: 'Well', kind: 'free', cost: [['stone', 12], ['plank', 3], ['iron', 1]], time: 9, burn: 0, hx: 0.95, hz: 0.95, desc: 'Water for you, your beds and your animals\' troughs nearby.' };
B_MODEL.roofHip = (b, pc) => {
  // four slopes up to a short ridge; thick thatch with a rolled ridge and a boarded soffit under the eaves
  const rise = 1.55, ov = 0.42, W2 = B_C / 2 + ov, th = 0.3;
  // (the pyramid is centred on its height: its foot sits a little below the wall plate, the eaves past the walls)
  const H1 = rise + 0.2, H2 = rise + 0.2 - th * 0.6;
  b.add(G.pyr, lm(B_ID, 0, -0.06 + H1 / 2, 0, 0, W2 * Math.SQRT2, H1, W2 * Math.SQRT2), MAT.thatch, B_COL.thatch, 0, 3);
  b.add(G.pyr, lm(B_ID, 0, -0.06 - th * 0.4 + H2 / 2, 0, 0, (W2 - 0.12) * Math.SQRT2, H2, (W2 - 0.12) * Math.SQRT2), MAT.wood, B_COL.fresh, 0, 3);
  b.add(G.ico, lm(B_ID, 0, rise + 0.1, 0, 0, 0.22, 0.16, 0.22), MAT.thatch, darker(B_COL.thatch, 0.78), 0, 3);
  // the hip rafters show at the corners under the eaves
  for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) beam(b, B_ID, [sx * (B_C / 2 + 0.25), -0.1, sz * (B_C / 2 + 0.25)], [sx * 0.3, rise - 0.5, sz * 0.3], 0.06, MAT.wood, B_COL.dark);
  bBox(b, 0, 0.06, 0, 0.16, 0.14, B_C, MAT.wood, B_COL.dark);
};
B_MODEL.roofLean = (b, pc) => {
  // one plane of shingles from the high wall plate (-z) down past the low one (+z), on rafters, with closed sides
  const hi = 1.1, run = B_C + 0.5, pitch = Math.atan2(hi, B_C), slope = run / Math.cos(pitch), th = 0.14;
  bBox(b, 0, hi / 2 + 0.06, -0.08, B_C + 0.36, th, slope, MAT.shingle, B_COL.shingle, 0, pitch);
  for (const x of [-1.3, -0.45, 0.45, 1.3]) bBox(b, x, hi / 2 - 0.08, -0.08, 0.09, 0.12, slope, MAT.wood, B_COL.dark, 0, pitch);
  // the high wall plate carried up on posts, the sides boarded in as triangles
  bBox(b, 0, hi - 0.05, -B_C / 2, B_C, 0.14, 0.18, MAT.wood, B_COL.dark);
  for (const sx of [-1, 1]) {
    bBox(b, sx * (B_C / 2 - 0.08), hi / 2, -B_C / 2, 0.16, hi, 0.16, MAT.wood, B_COL.dark);
    for (let k = 0; k < 5; k++) { const z0 = -B_C / 2 + (k + 0.5) * (B_C / 5), h = hi * (1 - (k + 0.5) / 5); bBox(b, sx * (B_C / 2 - 0.04), h / 2, z0, 0.06, h, B_C / 5, MAT.wood, B_COL.wood); }
  }
};
B_MODEL.window = (b, pc) => {
  // [depth] leaded glazing: diamond panes in lead cames, a stone-coloured sill, the shutters on their hinges
  bTimberWall(b, pc, [[-0.46, 0.46, 0.95, 1.85]]);
  bBox(b, 0, 1.4, 0, 0.9, 0.9, 0.02, MAT.window, [0.55, 0.6, 0.58]);
  // diagonal cames in both directions, each cut to the frame so none sticks out past it: diamond quarrels
  for (const c of [-0.6, -0.3, 0, 0.3, 0.6]) {
    const L = (0.9 - Math.abs(c)) * Math.SQRT2 * 0.98;
    bBox(b, c / 2, 1.4 - c / 2, 0.012, 0.014, L, 0.012, MAT.metal, [0.16, 0.16, 0.17], 0, 0, -Math.PI / 4);
    bBox(b, c / 2, 1.4 + c / 2, 0.012, 0.014, L, 0.012, MAT.metal, [0.16, 0.16, 0.17], 0, 0, Math.PI / 4);
    bBox(b, c / 2, 1.4 - c / 2, -0.012, 0.014, L, 0.012, MAT.metal, [0.16, 0.16, 0.17], 0, 0, -Math.PI / 4);
    bBox(b, c / 2, 1.4 + c / 2, -0.012, 0.014, L, 0.012, MAT.metal, [0.16, 0.16, 0.17], 0, 0, Math.PI / 4);
  }
  bBox(b, 0, 1.4, 0, 0.9, 0.03, 0.04, MAT.metal, B_COL.iron);
  bBox(b, 0, 1.4, 0, 0.03, 0.9, 0.04, MAT.metal, B_COL.iron);
};
B_MODEL.well = (b) => {
  // a drystone ring with a coped lip, two posts carrying a small shingled roof and a windlass with its rope and bucket
  b.add(G.cyl16, lm(B_ID, 0, 0.42, 0, 0, 0.82, 0.95, 0.82), MAT.drystone, B_COL.stone, 0, 1);
  b.add(G.cyl16, lm(B_ID, 0, 0.92, 0, 0, 0.88, 0.1, 0.88), MAT.stone, darker(B_COL.stone, 0.92), 0, 1);
  b.add(G.cyl16, lm(B_ID, 0, 0.86, 0, 0, 0.62, 0.04, 0.62), MAT.water, [0.05, 0.07, 0.08], 0, 1);
  for (const sx of [-1, 1]) bBox(b, sx * 0.8, 1.35, 0, 0.14, 1.9, 0.14, MAT.wood, B_COL.dark);
  b.add(G.prism, lm(B_ID, 0, 2.28, 0, 0, 2.0, 0.62, 1.5), MAT.shingle, B_COL.shingle, 0, 3);
  b.add(G.cyl8, lm(B_ID, 0, 1.55, 0, 0, 0.09, 1.5, 0.09, 0, Math.PI / 2), MAT.logH, [0.36, 0.26, 0.17], 0, 3);
  bBox(b, 0.86, 1.4, 0.18, 0.05, 0.36, 0.05, MAT.wood, B_COL.dark);
  bBox(b, 0.86, 1.24, 0.3, 0.05, 0.05, 0.24, MAT.wood, B_COL.dark);
  bBox(b, 0.15, 1.2, 0, 0.015, 0.68, 0.015, MAT.cloth, [0.55, 0.48, 0.34]);
  b.add(G.frustum16, lm(B_ID, 0.15, 0.95, 0, 0, 0.13, 0.2, 0.13), MAT.wood, B_COL.wood, 0, 3);
};
B_ICON.roofHip = '<path d="M2 15l6-7h8l6 7 M5 15v4 M19 15v4 M8 8l-1.5 7 M16 8l1.5 7"/>';
B_ICON.roofLean = '<path d="M3 8l18 6 M5 8.7V19 M19 13.4V19 M8 10.3l-1 2 M12 11.7l-1 2 M16 13l-1 2"/>';
B_ICON.well = '<path d="M5 13h14v7H5z M7 13V8 M17 13V8 M4 8l8-4 8 4 M12 8v3 M10.5 11h3v2h-3z"/>';
{
  const at = BP_ORDER.indexOf('floor');
  BP_ORDER.splice(at < 0 ? BP_ORDER.length - 1 : at, 0, 'roofHip', 'roofLean');
  const pl = BP_ORDER.indexOf('pull');
  BP_ORDER.splice(pl < 0 ? BP_ORDER.length : pl, 0, 'well');
}
const dpWells = () => BUILD.pieces.filter((pc) => pc.t === 'well' && pc.st === 'built');
function depthWellOffers(P, offer) {
  for (const pc of dpWells()) {
    const d = dist(P.x, P.z, pc.x, pc.z) - 0.9;
    if (d < 1.8) offer(Math.max(0.05, d), 1.9, 'Draw water from your well', () => { setAct(P, 5, 1.0); drinkAt({ x: pc.x, z: pc.z }, 'well'); }, 0.1);
  }
}
// a well keeps the troughs of paddocks near it full and the beds near it from drying out
function dpWellStep(dt) {
  DEPTH.wellT -= dt;
  if (DEPTH.wellT > 0) return;
  DEPTH.wellT = 2;
  const wells = dpWells();
  if (!wells.length) return;
  for (const pen of ANIMALS.pens) {
    if (pen.owner !== 'player') continue;
    if (wells.some((w) => dist2(w.x, w.z, pen.x, pen.z) < 32 * 32)) { pen.water = Math.min(12, pen.water + 2 * 0.08); pen._wNear = true; }
  }
  if (typeof FARM !== 'undefined' && FARM.plots) for (const pl of FARM.plots) {
    if (pl.own && pl.own !== 'p') continue;
    if (wells.some((w) => dist2(w.x, w.z, pl.x, pl.z) < 24 * 24) && pl.moist !== undefined && pl.moist < 0.6) pl.moist = Math.min(0.6, pl.moist + 2 * 0.004);
  }
}

/* ------------------------------------------------------------------ */
/* crafting to the level cap: rare materials, tiers and masterworks    */
/* ------------------------------------------------------------------ */
registerGood('grave_iron', { name: 'Grave-iron', plural: 'Grave-iron', kind: 'material', icon: 'anvil', value: 40, desc: 'Black iron from the barrow\'s dead and the Hollow King\'s hoard. Cold to the touch; it takes an edge forge-iron never will.' });
registerGood('dragon_scale', { name: 'Dragon scale', plural: 'Dragon scales', kind: 'material', icon: 'hide', value: 120, desc: 'A scale of Cinderwing\'s hide, still warm. Nothing burns through it.' });
registerGood('trophy', { name: 'Champion\'s trophy', plural: 'Champions\' trophies', kind: 'material', icon: 'bag', value: 60, desc: 'A fang, a tusk or a torn token from a champion of the borderland camps. Masterworks are bound with them.' });
registerGood('potion_cure', { name: 'Marshgold cure', plural: 'Marshgold cures', kind: 'drink', icon: 'potion', value: 22, desc: 'Draws out burns, bleeding and poison, and heals a third of your health over twelve seconds.' });
registerGood('potion_moon', { name: 'Moonfern draught', plural: 'Moonfern draughts', kind: 'drink', icon: 'potion', value: 24, desc: 'Steadies the nerves: shakes off stuns, snares, roots and chill, and restores all your power.' });
registerGood('potion_stone', { name: 'Stonebloom draught', plural: 'Stonebloom draughts', kind: 'drink', icon: 'potion', value: 24, desc: 'Toughens the skin: a ward that soaks up a quarter of your health in blows for two minutes.' });
registerGood('eggs_fried', { name: 'Fried eggs', plural: 'Fried eggs', kind: 'food', icon: 'seed', value: 5, desc: 'Two eggs fried on a hot stone.', food: { hunger: 0.22 } });
GOODS.potion_cure.use = (P, id) => { if (!goodsTake(id, 1)) return; dropBuffs(P, ['burn', 'bleed', 'dot', 'poison']); addBuff(P, 'hot', P.maxHp * 0.33 / 12, 12, null); FX.burst(P.x, P.y + 1.2, P.z, 14, [1.8, 1.5, 0.3], 1.2, 0.5, 0.1, -0.6); sfx('potion'); uiLog('The marshgold draws out what ails you.', 'heal'); };
GOODS.potion_moon.use = (P, id) => { if (!goodsTake(id, 1)) return; dropBuffs(P, ['stun', 'snare', 'root', 'chill', 'fear']); P.power = P.maxPower; FX.burst(P.x, P.y + 1.2, P.z, 14, [0.8, 1.2, 2.2], 1.2, 0.5, 0.1, -0.6); sfx('potion'); uiLog('Your head clears and your limbs are your own again.', 'heal'); };
GOODS.potion_stone.use = (P, id) => { if (!goodsTake(id, 1)) return; addBuff(P, 'shield', P.maxHp * 0.25, 120, null); FX.burst(P.x, P.y + 1.2, P.z, 14, [1.6, 1.4, 1.3], 1.2, 0.5, 0.1, -0.6); sfx('potion'); uiLog('Your skin tightens like bark.', 'heal'); };
// ilvl: the highest item level the recipe reaches (24 for everything before); lvl: the level you must be
const DP_RECIPES = [
  // farm produce at the fire and the bakehouse
  { id: 'eggs_fried', st: 'fire', name: 'Fry eggs', make: ['eggs_fried', 1], need: [['egg', 2]], time: 2, diff: 0.5, skill: 'cook', desc: 'On a hot stone by the fire.' },
  { id: 'stew_bean', st: 'fire', pot: true, name: 'Bean and bacon stew', make: ['stew', 3], need: [['beans', 3], ['meat_raw', 1], ['water', 1]], time: 5, diff: 1.3, skill: 'cook', desc: 'Beans from the garden, a little meat, slow in the pot. Three bowls.' },
  { id: 'cheese', st: 'oven', name: 'Make cheese', make: ['cheese', 1], need: [['milk', 3]], time: 4, diff: 1, skill: 'cook', desc: 'Curdle, press and salt three jugs of milk into a round of cheese that keeps.' },
  // the new herbs at the alchemy table
  { id: 'cure', st: 'alchemy', name: 'Marshgold cure', make: ['potion_cure', 1], need: [['herb_marsh', 2], ['water', 1]], time: 4.5, diff: 1.6, min: 15, desc: 'Marshgold steeped and strained: draws out burns, bleeding and poison, and heals.' },
  { id: 'moonfern', st: 'alchemy', name: 'Moonfern draught', make: ['potion_moon', 1], need: [['herb_moon', 2], ['milk', 1]], time: 4.5, diff: 1.7, min: 20, desc: 'Moonfern in warm milk: shakes off stuns and snares, and restores your power.' },
  { id: 'stonebloom', st: 'alchemy', name: 'Stonebloom draught', make: ['potion_stone', 1], need: [['herb_stone', 2], ['water', 1], ['egg', 1]], time: 4.5, diff: 1.7, min: 20, desc: 'Stonebloom beaten into an egg: a ward against blows for two minutes.' },
  // grave-iron: the second tier, to item level 36
  { id: 'gi_blade', st: 'forge', name: 'Grave-iron blade', gear: { slot: 'weapon', base: { warrior: 'Grave-iron Sword' }, vis: 'sword' }, need: [['grave_iron', 3], ['iron', 2], ['leather', 1]], time: 8, diff: 4.5, cls: ['warrior'], min: 40, lvl: 25, ilvl: 36, desc: 'Black barrow-iron folded into forge-iron. Item level up to 36.' },
  { id: 'gi_hauberk', st: 'forge', name: 'Grave-iron hauberk', gear: { slot: 'chest', base: { warrior: 'Grave-iron Hauberk' } }, need: [['grave_iron', 4], ['iron', 3], ['leather', 2]], time: 9, diff: 4.5, cls: ['warrior'], min: 40, lvl: 25, ilvl: 36, desc: 'Rings of grave-iron riveted shut. Item level up to 36.' },
  { id: 'gi_mace', st: 'forge', name: 'Grave-iron mace', gear: { slot: 'weapon', base: { priest: 'Grave-iron Mace', warrior: 'Grave-iron Mace' }, vis: 'mace' }, need: [['grave_iron', 3], ['plank', 1], ['herb_marsh', 2]], time: 8, diff: 4.5, cls: ['priest', 'warrior'], min: 40, lvl: 25, ilvl: 36, desc: 'Flanges of grave-iron, quenched in marshgold. Item level up to 36.' },
  { id: 'gi_bow', st: 'workbench', name: 'Barrow-horn bow', gear: { slot: 'weapon', base: 'Barrow-horn Bow', vis: 'bow' }, need: [['plank', 2], ['grave_iron', 2], ['linen', 2], ['bone', 2]], time: 8, diff: 4.5, cls: ['archer'], min: 40, lvl: 25, ilvl: 36, desc: 'Yew backed with horn, grave-iron fittings and a linen string. Item level up to 36.' },
  { id: 'gi_coat', st: 'tanning', name: 'Stonebloom-tanned coat', gear: { slot: 'chest', base: { archer: 'Stonebloom Coat' } }, need: [['leather', 4], ['herb_stone', 3], ['grave_iron', 2]], time: 8, diff: 4.5, cls: ['archer'], min: 40, lvl: 25, ilvl: 36, desc: 'Leather tanned in stonebloom until it turns a blade, studded with grave-iron. Item level up to 36.' },
  { id: 'gi_staff', st: 'workbench', name: 'Moonfern staff', gear: { slot: 'weapon', base: { mage: 'Moonfern Staff', priest: 'Moonfern Staff' }, vis: 'staff' }, need: [['log', 1], ['herb_moon', 3], ['grave_iron', 2]], time: 8, diff: 4.5, cls: ['mage', 'priest'], min: 40, lvl: 25, ilvl: 36, desc: 'Ash shod with grave-iron, moonfern bound into the runes. Item level up to 36.' },
  { id: 'gi_robe', st: 'loom', name: 'Marshgold vestments', gear: { slot: 'chest', base: { mage: 'Marshgold Robe', priest: 'Marshgold Vestments' } }, need: [['linen', 4], ['woollen', 2], ['herb_marsh', 3]], time: 8, diff: 4.5, cls: ['mage', 'priest'], min: 40, lvl: 25, ilvl: 36, desc: 'Linen dyed gold with marshgold, lined with wool. Item level up to 36.' },
  { id: 'gi_cloak', st: 'loom', name: 'Feathered cloak', gear: { slot: 'cloak', base: 'Feathered Cloak', vis: 'cape' }, need: [['woollen', 3], ['feather', 12], ['grave_iron', 1]], time: 8, diff: 4, min: 35, lvl: 25, ilvl: 36, desc: 'Wool sewn over with pheasant and duck feathers, a grave-iron clasp. Item level up to 36.' },
  // dragon scale and champions' trophies: the third tier, to item level 50
  { id: 'ds_blade', st: 'forge', name: 'Dragonscale blade', gear: { slot: 'weapon', base: { warrior: 'Scale-forged Sword' }, vis: 'sword' }, need: [['dragon_scale', 2], ['grave_iron', 3], ['trophy', 1]], time: 10, diff: 6, cls: ['warrior'], min: 65, lvl: 35, ilvl: 50, desc: 'Grave-iron folded over a dragon scale. Item level up to 50.' },
  { id: 'ds_armour', st: 'forge', name: 'Dragonscale armour', gear: { slot: 'chest', base: { warrior: 'Dragonscale Coat', archer: 'Dragonscale Jerkin' } }, need: [['dragon_scale', 3], ['leather', 3], ['trophy', 1]], time: 10, diff: 6, cls: ['warrior', 'archer'], min: 65, lvl: 35, ilvl: 50, desc: 'Scales of Cinderwing laced over leather. Item level up to 50.' },
  { id: 'ds_bow', st: 'workbench', name: 'Dragonbone bow', gear: { slot: 'weapon', base: 'Dragonbone Bow', vis: 'bow' }, need: [['dragon_scale', 2], ['plank', 2], ['trophy', 1], ['linen', 2]], time: 10, diff: 6, cls: ['archer'], min: 65, lvl: 35, ilvl: 50, desc: 'Horn and scale laminated over yew. Item level up to 50.' },
  { id: 'ds_staff', st: 'workbench', name: 'Emberheart staff', gear: { slot: 'weapon', base: { mage: 'Emberheart Staff', priest: 'Dawnwood Staff' }, vis: 'staff' }, need: [['dragon_scale', 2], ['log', 1], ['trophy', 1], ['herb_moon', 2]], time: 10, diff: 6, cls: ['mage', 'priest'], min: 65, lvl: 35, ilvl: 50, desc: 'A dragon scale set in its head, still warm. Item level up to 50.' },
  { id: 'ds_robe', st: 'loom', name: 'Scale-sewn robe', gear: { slot: 'chest', base: { mage: 'Scale-sewn Robe', priest: 'Scale-sewn Vestments' } }, need: [['dragon_scale', 2], ['linen', 4], ['trophy', 1]], time: 10, diff: 6, cls: ['mage', 'priest'], min: 65, lvl: 35, ilvl: 50, desc: 'Linen with scales sewn in rows across the breast. Item level up to 50.' },
  // masterworks: one named piece per calling and one cloak for any; they are always at least fine, and with a
  // master's hand (skill 90 and up) may come out legendary
  { id: 'mw_warrior', st: 'forge', name: 'Masterwork: Wyrmbiter', mw: 'Wyrmbiter', gear: { slot: 'weapon', base: { warrior: 'Greatsword' }, vis: 'sword' }, need: [['dragon_scale', 4], ['grave_iron', 5], ['trophy', 3], ['herb_stone', 2]], time: 14, diff: 8, cls: ['warrior'], min: 85, lvl: 40, ilvl: 50, desc: 'A greatsword with a dragon\'s scale in its fuller, quenched in stonebloom. A named masterwork, item level 50.' },
  { id: 'mw_archer', st: 'workbench', name: 'Masterwork: Moonstring', mw: 'Moonstring', gear: { slot: 'weapon', base: 'Longbow', vis: 'bow' }, need: [['dragon_scale', 3], ['plank', 3], ['trophy', 3], ['herb_moon', 3], ['feather', 10]], time: 14, diff: 8, cls: ['archer'], min: 85, lvl: 40, ilvl: 50, desc: 'A longbow strung with moonfern-soaked linen; its arrows fly true by night. A named masterwork, item level 50.' },
  { id: 'mw_mage', st: 'workbench', name: 'Masterwork: Stormwrack', mw: 'Stormwrack', gear: { slot: 'weapon', base: { mage: 'Staff' }, vis: 'staff' }, need: [['dragon_scale', 4], ['log', 2], ['trophy', 3], ['herb_storm', 3]], time: 14, diff: 8, cls: ['mage'], min: 85, lvl: 40, ilvl: 50, desc: 'A staff of lightning-struck ash crowned with a dragon\'s scale. A named masterwork, item level 50.' },
  { id: 'mw_priest', st: 'forge', name: 'Masterwork: Dawnward', mw: 'Dawnward', gear: { slot: 'weapon', base: { priest: 'Mace' }, vis: 'mace' }, need: [['dragon_scale', 3], ['grave_iron', 4], ['trophy', 3], ['herb_marsh', 3]], time: 14, diff: 8, cls: ['priest'], min: 85, lvl: 40, ilvl: 50, desc: 'A mace of grave-iron washed in marshgold until it shines like morning. A named masterwork, item level 50.' },
  { id: 'mw_warrior2', st: 'forge', name: 'Masterwork: the Unbowed', mw: 'The Unbowed', gear: { slot: 'chest', base: { warrior: 'Hauberk' } }, need: [['dragon_scale', 4], ['grave_iron', 6], ['trophy', 2], ['leather', 3]], time: 14, diff: 8, cls: ['warrior'], min: 90, lvl: 42, ilvl: 50, desc: 'Grave-iron rings with dragon scales riveted over the heart. A named masterwork, item level 50.' },
  { id: 'mw_archer2', st: 'tanning', name: 'Masterwork: Wyrmhide Jerkin', mw: 'Wyrmhide Jerkin', gear: { slot: 'chest', base: { archer: 'Leather Coat' } }, need: [['dragon_scale', 3], ['leather', 5], ['trophy', 2], ['herb_stone', 3]], time: 14, diff: 8, cls: ['archer'], min: 90, lvl: 42, ilvl: 50, desc: 'Leather tanned in stonebloom and faced with dragon scale. A named masterwork, item level 50.' },
  { id: 'mw_mage2', st: 'loom', name: 'Masterwork: Robe of the Long Night', mw: 'Robe of the Long Night', gear: { slot: 'chest', base: { mage: 'Long Robe' } }, need: [['dragon_scale', 2], ['linen', 5], ['trophy', 2], ['herb_moon', 4]], time: 14, diff: 8, cls: ['mage'], min: 90, lvl: 42, ilvl: 50, desc: 'Linen dyed with moonfern until it holds the night sky. A named masterwork, item level 50.' },
  { id: 'mw_priest2', st: 'loom', name: 'Masterwork: Dawnmantle', mw: 'Dawnmantle', gear: { slot: 'chest', base: { priest: 'Vestments' } }, need: [['dragon_scale', 2], ['linen', 4], ['woollen', 2], ['trophy', 2], ['herb_marsh', 4]], time: 14, diff: 8, cls: ['priest'], min: 90, lvl: 42, ilvl: 50, desc: 'Vestments of marshgold-dyed linen, worked with scale. A named masterwork, item level 50.' },
  { id: 'mw_cloak', st: 'loom', name: 'Masterwork: Mantle of the March', mw: 'Mantle of the March', gear: { slot: 'cloak', base: 'Mantle', vis: 'cape' }, need: [['dragon_scale', 2], ['woollen', 4], ['trophy', 2], ['feather', 16]], time: 14, diff: 8, min: 85, lvl: 40, ilvl: 50, desc: 'Wool, feathers and dragon scale in your realm\'s colours. A named masterwork for any calling, item level 50.' },
];
for (const r of DP_RECIPES) { if (!RECIPE_BY_ID[r.id]) { RECIPES.push(r); RECIPE_BY_ID[r.id] = r; } }
// the item level a recipe makes for you now
function depthCraftLvl(rec) { return Math.max(1, Math.min(GAME.prog ? GAME.prog.level : 1, rec.ilvl || 24)); }
function depthCraftBlock(rec) {
  if (rec.lvl && GAME.prog && GAME.prog.level < rec.lvl) return `You must be level ${rec.lvl} to make that`;
  return null;
}
// a crafted piece: masterworks are at least fine and take their name; a skilled hand adds a rare bonus stat
function depthCraftGear(rec, it, sk) {
  const P = GAME.player;
  if (rec.mw) {
    if (it.q < 3) { const again = makeItem({ cls: P.cls, realm: P.faction, lvl: depthCraftLvl(rec), lvlCap: 50, q: sk >= 95 && Math.random() < 0.3 ? 5 : sk >= 90 && Math.random() < 0.5 ? 4 : 3, slot: rec.gear.slot }); Object.assign(it, again); }
    it.name = rec.mw;
    DEPTH.stats.masterworks++;
  }
  // the master's touch: past skill 50, a chance of an extra stat the grade would not give
  const chance = rec.mw ? 0.5 + sk / 200 : Math.max(0, (sk - 50) / 100) * (rec.ilvl > 24 ? 1 : 0.6);
  if (Math.random() < chance) {
    const D = SLOT_DEF[it.slot], have = Object.keys(it.st);
    const pool = D.sec.filter((k) => !have.includes(k));
    const k = pool.length ? pick(Math.random, pool) : pick(Math.random, D.sec);
    const v = itemScale(it.lvl) * QUALITY[it.q].mult * 0.22 * STAT_SCALE[k];
    it.st[k] = (it.st[k] || 0) + (k === 'crit' ? Math.max(0.5, Math.round(v * 2) / 2) : Math.max(1, Math.round(v)));
    it.mw = 1;
    if (!rec.mw && !/masterwork/i.test(it.name)) it.name = `${it.name} (masterwork)`;
  }
  return it;
}

/* ------------------------------------------------------------------ */
/* the nests drawn: straw rings with eggs in them                      */
/* ------------------------------------------------------------------ */
const DP_EGG_FS = /* glsl */`
  ${GLSL_COMMON}
  ${GLSL_ATMOS}
  ${GLSL_SHADOW}
  ${GLSL_PLIGHT}
  ${GLSL_LIGHT}
  varying vec3 vW; varying vec3 vN; varying vec3 vC; varying vec3 vO;
  void main(){
    vec3 n = safeNormalize(vN);
    gSh = shadowAt(vW, n);
    gPL = pointLights(vW, n);
    vec3 alb = vC;
    if (vC.r > 0.6) alb *= 0.92 + 0.12 * vnoise(vO.xy * 60.0) - 0.25 * step(0.86, vnoise(vO.xz * 90.0 + 3.0)); // speckled shells
    else alb *= 0.7 + 0.5 * vnoise(vec2(atan(vO.x, vO.z) * 8.0, vO.y * 40.0)); // straw
    vec3 col = lightSurface(alb, n, 1.0);
    gl_FragColor = vec4(safeColor(applyFog(col, vW)), 1.0);
  }`;
function dpBuildNestFX() {
  const VS = /* glsl */`
    attribute vec3 instanceColor;
    varying vec3 vW; varying vec3 vN; varying vec3 vC; varying vec3 vO;
    void main(){ vec4 w = modelMatrix * instanceMatrix * vec4(position, 1.0); vW = w.xyz; vN = mat3(modelMatrix * instanceMatrix) * normal; vC = instanceColor; vO = position; gl_Position = projectionMatrix * viewMatrix * w; }`;
  const m = mat({ vertexShader: VS, fragmentShader: DP_EGG_FS });
  const egg = new THREE.SphereGeometry(1, 10, 7); egg.scale(0.022, 0.03, 0.022);
  const ring = new THREE.TorusGeometry(0.16, 0.055, 5, 12); ring.rotateX(Math.PI / 2);
  const mk = (g, n) => { const M = new THREE.InstancedMesh(g, m, n); M.instanceMatrix.setUsage(THREE.DynamicDrawUsage); M.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3); M.frustumCulled = false; M.count = 0; scene.add(M); return M; };
  DEPTH.fx = { eggs: mk(egg, 60), rings: mk(ring, 12), m4: new THREE.Matrix4(), q: new THREE.Quaternion(), v: new THREE.Vector3(), s: new THREE.Vector3() };
}
function drawDepth(dt) {
  if (!DEPTH.ready) return;
  if (!DEPTH.fx) dpBuildNestFX();
  const F = DEPTH.fx, cx = camera.position.x, cz = camera.position.z;
  let ne = 0, nr = 0;
  if (!INDOOR.on) for (const N of DEPTH.nests) {
    if (dist2(N.x, N.z, cx, cz) > 60 * 60 || nr >= 12) continue;
    F.m4.compose(F.v.set(N.x, N.y + 0.03, N.z), F.q.set(0, 0, 0, 1), F.s.set(1, 1, 1));
    F.rings.setMatrixAt(nr, F.m4); F.rings.instanceColor.setXYZ(nr, 0.62, 0.52, 0.3); nr++;
    for (let k = 0; k < N.eggs && ne < 60; k++) {
      const a = k * 2.3 + N.seed * 6, r = k ? 0.05 + 0.02 * (k % 2) : 0;
      F.m4.compose(F.v.set(N.x + Math.sin(a) * r, N.y + 0.06, N.z + Math.cos(a) * r), F.q.setFromAxisAngle(F.v.set(Math.cos(a), 0, -Math.sin(a)).normalize(), 1.2), F.s.set(1, 1, 1));
      F.eggs.setMatrixAt(ne, F.m4); F.eggs.instanceColor.setXYZ(ne, 0.86 + 0.06 * fhash(k + N.seed * 10), 0.76, 0.6); ne++;
    }
  }
  F.eggs.count = ne; F.rings.count = nr;
  F.eggs.instanceMatrix.needsUpdate = true; F.rings.instanceMatrix.needsUpdate = true;
  F.eggs.instanceColor.needsUpdate = true; F.rings.instanceColor.needsUpdate = true;
}

/* ------------------------------------------------------------------ */
/* the Chronicle: what the new things are and how to use them          */
/* ------------------------------------------------------------------ */
function depthChronLiving() {
  return `<h3>Woodcraft</h3>
    <p><b>Berry bushes</b> and <b>apple trees</b> burn like the grass around them: a grass fire, a fire spell or a burning brand (E beside one) sets them alight, and they stand charred and bare until they put out new shoots. With a <b>knife</b> or an <b>axe</b> you can cut a bush down to its roots for sticks and fibre; it grows back. An apple tree is chopped down like any other tree (an axe takes fewer blows) and falls about its stump; cut it up for firewood and a log.</p>
    <p>A <b>stump</b> is in the way of a foundation or a garden bed. Grub it out, roots and all, with an <b>axe</b> or a <b>pick</b> (E beside it): the ground is clear for good.</p>
    <h3>Game birds and feathers</h3>
    <p><b>Pheasants</b> feed in the long meadows and <b>ducks</b> paddle on the lakes. They sit tight until you come close (closer if you creep, or hide as an archer), then burst up and fly off a long way before they come down. Shot down they give meat and <b>feathers</b> for arrows and cloaks. Hens give feathers too: plucked, or moulted about the paddock for you to gather.</p>
    <h3>The late game's materials</h3>
    <p>Gear you make yourself goes past item level 24, but only with what the hardest fights give: <b>grave-iron</b> from the Barrow's dead and the Hollow King's hoard (to item level 36), <b>dragon scales</b> from Cinderwing and <b>champions' trophies</b> from the leaders of the borderland camps (to item level 50), with the new herbs of the gardens, <b>Marshgold</b>, <b>Moonfern</b> and <b>Stonebloom</b>, and farm wool, linen, milk and feathers. Each calling has two named <b>masterworks</b>, a weapon and a coat (crafting skill 85 and 90, level 40 and 42), and any calling can weave the Mantle of the March: always at least fine, and a master's hand can make them legendary. Past skill 50 your work sometimes carries a bonus stat the grade alone would not give: a <i>masterwork</i>.</p>
    <p>At the alchemy table the new herbs make a <b>Marshgold cure</b> (draws out burns and bleeding and heals), a <b>Moonfern draught</b> (shakes off stuns and snares and restores your power) and a <b>Stonebloom draught</b> (a ward against blows). Milk makes cheese at the bakehouse; eggs fry at any fire; beans go into a stew.</p>`;
}
function depthChronBuilding() {
  return `<h3>More to build</h3><ul>
    <li>A <b>hip roof</b> slopes down on all four sides, with no gable ends; a <b>lean-to</b> is a single slope of shingles, high on one wall and low on the other (R turns it), good against a wall.</li>
    <li><b>Windows</b> are glazed with leaded diamond panes (a pane of glass each), with shutters that open and close.</li>
    <li>A <b>well</b> gives you water to drink and fill your skins (E), keeps the troughs of your paddocks near it full and the garden beds near it from drying out.</li>
    <li>Townsfolk and your realm's soldiers open the doors and gates you built when their way passes through, and shut them behind them; nobody idles in a doorway. Your realm's own soldiers never set fire to what you built, nor to their own town and keeps: only you, or the enemy, can do that.</li></ul>`;
}
function depthChronAnimals() {
  return `<h3>Chicks, feathers and herding</h3>
    <p>Keep a <b>cockerel</b> with your hens and the eggs they lay are fertile: leave one lying in the paddock and it hatches into a chick in a few minutes. A hen that pairs lays a whole clutch in the nest box in the shed: take the eggs (E) for the pot, or leave them and they hatch. Hens moult: gather the feathers they leave about the paddock.</p>
    <p>A <b>hound</b> can herd: open its card and choose <i>Herd the sheep in</i>, and it runs out wide round any of your sheep that are out of their paddock and drives them home through the gate, then comes back to you.</p>`;
}

/* ------------------------------------------------------------------ */
/* the game birds' own bodies, on the hen's rig and shader             */
/* ------------------------------------------------------------------ */
// bones as the hen's (05j_farmbeasts.js henVS): 0 body, 2 neck and head, 15 tail, 3 and 6 wings, 9 and 12 legs.
// Body feathers take the first coat (iColA), the head and neck the second (iColB, the dark-fur material), the
// pheasant's long tail the barred horn material (buff with dark bars, darker to the tip), bill and legs the beak's
function dpBuildBird(kind, lod) {
  const K = new SkinKit(), hi = lod === 0, mat = AM, RS = hi ? 12 : 7;
  const duck = kind === 'duck';
  // the body: the pheasant long and slim, carried level; the duck broad and boat-shaped, low in the water
  const body = duck
    ? [[-0.2, 0.25, 0.02, 0.02], [-0.16, 0.24, 0.07, 0.055], [-0.08, 0.22, 0.11, 0.075], [0.02, 0.215, 0.118, 0.08], [0.1, 0.225, 0.1, 0.075], [0.15, 0.24, 0.065, 0.06], [0.18, 0.26, 0.03, 0.035]]
    : [[-0.2, 0.33, 0.025, 0.025], [-0.15, 0.315, 0.07, 0.07], [-0.07, 0.29, 0.095, 0.098], [0.02, 0.28, 0.1, 0.104], [0.09, 0.29, 0.085, 0.09], [0.14, 0.31, 0.055, 0.062], [0.17, 0.335, 0.03, 0.035]];
  kitTube(K, crResample(body, hi ? 12 : 6).map(([z, y, rx, ry]) => ({ c: [0, y, z], rx, rz: ry })), RS, {
    front: [0, 1, 0], side: [1, 0, 0], cap0: 'dome', cap1: 'dome',
    attr: (i, th, p) => ({ bone: 0, w: 1, mat: mat.fur, ao: 0.6 + 0.4 * sstepJ(-0.9, 0.3, Math.cos(th)), u: th / TAU, v: p[2] * 3 }),
  });
  // neck and head in the second coat (a mallard's green head, a cock pheasant's dark green neck)
  const neck = duck ? [{ c: [0, 0.25, 0.13], rx: 0.045, rz: 0.05 }, { c: [0, 0.31, 0.15], rx: 0.033, rz: 0.035 }, { c: [0, 0.35, 0.16], rx: 0.03, rz: 0.032 }]
    : [{ c: [0, 0.32, 0.12], rx: 0.045, rz: 0.05 }, { c: [0, 0.39, 0.145], rx: 0.032, rz: 0.034 }, { c: [0, 0.45, 0.16], rx: 0.028, rz: 0.03 }];
  kitTube(K, neck, RS, { front: [0, 0, 1], attr: (i) => ({ bone: 2, w: 0.3 + 0.35 * i, mat: mat.furDark, ao: 0.85 }) });
  const hy = duck ? 0.37 : 0.47, hz = duck ? 0.17 : 0.165;
  kitBlob(K, [0, hy, hz], hi ? 12 : 7, hi ? 8 : 5, { r: duck ? [0.033, 0.034, 0.046] : [0.028, 0.03, 0.038], attr: () => ({ bone: 2, w: 1, mat: mat.furDark, ao: 0.95 }) });
  if (duck) {
    // the broad flat bill, and a pale ring at the foot of the neck
    kitBlob(K, [0, hy - 0.012, hz + 0.058], 8, 4, { r: [0.019, 0.008, 0.03], attr: () => ({ bone: 2, w: 1, mat: FMAT.beak, ao: 1 }) });
    kitTube(K, [{ c: [0, 0.272, 0.138], rx: 0.044, rz: 0.047 }, { c: [0, 0.282, 0.142], rx: 0.042, rz: 0.045 }], RS, { front: [0, 0, 1], attr: () => ({ bone: 2, w: 0.35, mat: mat.ivory, ao: 1 }) });
  } else {
    // a short pale bill, the red wattle round the eye and the small ear tufts
    kitGeo(K, new THREE.ConeGeometry(0.011, 0.034, hi ? 7 : 5), M4([0, hy - 0.005, hz + 0.044], [Math.PI / 2 + 0.2, 0, 0], [1, 1, 0.75]), { bone: 2, mat: FMAT.beak });
    for (const s of [1, -1]) kitBlob(K, [s * 0.021, hy + 0.003, hz + 0.008], 6, 4, { r: [0.009, 0.016, 0.019], attr: () => ({ bone: 2, w: 1, mat: mat.mouth, ao: 1 }) });
    if (hi) for (const s of [1, -1]) kitBlob(K, [s * 0.012, hy + 0.03, hz - 0.012], 4, 3, { r: [0.006, 0.012, 0.006], attr: () => ({ bone: 2, w: 1, mat: mat.furDark, ao: 0.9 }) });
  }
  if (hi) for (const s of [1, -1]) kitBlob(K, [s * (duck ? 0.03 : 0.026), hy + 0.008, hz + 0.014], 6, 4, { r: [0.0055, 0.006, 0.006], attr: () => ({ bone: 2, w: 1, mat: mat.eye, ao: 1 }) });
  // the tail: a pheasant's long barred feathers swept back; a duck's short upturned point
  if (duck) {
    kitGeo(K, new THREE.SphereGeometry(1, hi ? 8 : 5, hi ? 5 : 3), M4([0, 0.27, -0.2], [-0.5, 0, 0], [0.03, 0.025, 0.05]), { bone: 15, w: 1, mat: mat.furDark, ao: 0.8 });
  } else {
    for (const [a, L, up] of [[0, 0.46, 0.18], [0.1, 0.36, 0.14], [-0.1, 0.36, 0.14], [0.2, 0.25, 0.1], [-0.2, 0.25, 0.1]]) {
      const pts = [];
      for (let k = 0; k <= 4; k++) { const t = k / 4; pts.push({ c: [Math.sin(a) * L * t, 0.33 + up * t - 0.05 * t * t, -0.16 - Math.cos(a) * L * t], rx: 0.016 * (1 - 0.7 * t) + 0.002, rz: 0.004 }); }
      kitTube(K, pts, hi ? 5 : 3, { front: [0, 1, 0], cap1: 'dome', attr: (i) => ({ bone: 15, w: 1, mat: FMAT.horn, ao: 0.85, u: 0, v: i / 4 }) });
    }
  }
  // folded wings along the sides
  for (const s of [1, -1]) kitBlob(K, [s * (duck ? 0.1 : 0.088), duck ? 0.245 : 0.31, -0.03], hi ? 10 : 6, hi ? 6 : 4, { shape: (d) => [d[0] * 0.02, d[1] * (duck ? 0.045 : 0.055) - 0.01 * d[2], d[2] * (duck ? 0.13 : 0.12)], attr: (d) => ({ bone: s > 0 ? 3 : 6, w: 1, mat: mat.fur, ao: 0.7 + 0.3 * Math.max(0, d[1]) }) });
  // legs: the pheasant's grey shanks; the duck's short orange legs and webbed feet
  for (const s of [1, -1]) {
    const b = s > 0 ? 9 : 12, x = s * (duck ? 0.05 : 0.04);
    const top = duck ? 0.15 : 0.2;
    kitTube(K, [{ c: [x, top, 0.0], rx: 0.009, rz: 0.009 }, { c: [x, top * 0.5, 0.008], rx: 0.007, rz: 0.007 }, { c: [x, 0.015, 0.01], rx: 0.006, rz: 0.006 }], hi ? 6 : 4, { front: [0, 0, 1], attr: () => ({ bone: b, w: 1, mat: FMAT.beak, ao: 0.8 }) });
    if (duck) kitBlob(K, [x, 0.008, 0.04], 6, 3, { r: [0.03, 0.005, 0.034], attr: () => ({ bone: b, w: 1, mat: FMAT.beak, ao: 0.75 }) });
    else for (const [ta, tl] of [[-0.4, 0.045], [0, 0.05], [0.4, 0.045], [Math.PI, 0.025]]) kitTube(K, [{ c: [x, 0.01, 0.01], rx: 0.0045, rz: 0.0045 }, { c: [x + Math.sin(ta) * tl, 0.004, 0.01 + Math.cos(ta) * tl], rx: 0.0028, rz: 0.0028 }], 4, { cap1: 'dome', front: [0, 1, 0], attr: () => ({ bone: b, w: 1, mat: FMAT.beak, ao: 0.75 }) });
  }
  return K.build();
}
function dpBirdCrowds() {
  if (crowdBeast.pheasant || !crowdBeast.hen) return;
  const hm = crowdBeast.hen[0].mesh.material;
  const hd = depthFrom(hm, DEPTH_FS, henVS(true));
  for (const k of ['pheasant', 'duck']) {
    crowdBeast[k] = [new Crowd(dpBuildBird(k, 0), hm, 24, BEAST_ATTRS), new Crowd(dpBuildBird(k, 1), hm, 40, BEAST_ATTRS)];
    for (const c of crowdBeast[k]) shadowCaster(c.mesh, hd);
  }
}

/* ------------------------------------------------------------------ */
/* the step, the start, the save                                       */
/* ------------------------------------------------------------------ */
function depthOnStart() {
  if (!DEPTH.ready) {
    if (typeof SHADOW_R !== 'undefined') { SHADOW_R.pheasant = 0.32; SHADOW_R.duck = 0.3; if (!SHADOW_R.hen) SHADOW_R.hen = 0.26; }
    if (typeof STAMP_R !== 'undefined') { STAMP_R.pheasant = 0.22; STAMP_R.duck = 0.22; if (!STAMP_R.hen) STAMP_R.hen = 0.18; }
    if (!BEASTS.pheasant) BEASTS.pheasant = { stride: [0.085, 0.2] };
    if (!BEASTS.duck) BEASTS.duck = { stride: [0.07, 0.15] };
    try { dpBirdCrowds(); } catch (e) { reportError(e); }
  }
  DEPTH.ready = true;
  if (!DEPTH.birds.some((e) => !e.removed)) dpSpawnBirds();
}
function updateDepth(dt) {
  if (!DEPTH.ready || !GAME.started) return;
  if (DEPTH.pendGrub && NATURE.built) { for (const i of DEPTH.pendGrub) { const t = W.trees[i]; if (t) dpGrubTree(t); } DEPTH.pendGrub = null; }
  dpJobStep(dt);
  dpFallStep(dt);
  dpBurnStep(dt);
  dpBirdStep(dt);
  dpDoorsStep(dt);
  dpWellStep(dt);
  dpMoult(dt);
  for (const p of FORAGE.list) if (p.logRotAt && p.log && GAME.t > p.logRotAt && p.fall && p.fall.done) { p.log = false; if (p.logColl) { p.logColl.active = false; p.logColl = null; } p.regrowAt = GAME.t + DP_REGROW.apple / (NATURE.speed || 1); p.at = p.regrowAt + FORAGE_KINDS.apple.regrow; FORAGE.dirty = true; }
  DEPTH.slow -= dt;
  if (DEPTH.slow <= 0) { DEPTH.slow = 1; dpForageSlow(1); dpHatchStep(); }
}
registerSavePart('world', 'depth', {
  save() {
    const left = (t) => Math.max(0, Math.round(t - GAME.t));
    const f = [];
    for (const p of FORAGE.list) {
      if (!(p.gone || p.cut || p.char > 0 || p.grow !== undefined || p.log)) continue;
      f.push([p.i, p.gone ? 2 : p.cut ? 1 : 0, Math.round((p.char || 0) * 100), Math.round((p.grow ?? 1) * 100), p.regrowAt ? left(p.regrowAt) : 0, p.log && p.fall ? Math.round(p.fall.yaw * 100) / 100 : null, p.log && p.fall ? Math.round(p.fall.stop * 100) / 100 : null]);
      if (f.length >= 500) break;
    }
    const nests = DEPTH.nests.filter((N) => N.owner === 'player').slice(0, 20).map((N) => ({ x: Math.round(N.x * 10) / 10, z: Math.round(N.z * 10) / 10, e: N.eggs, l: left(N.at), ma: N.ma, pa: N.pa, pen: N.pen }));
    return { g: [...DEPTH.grub].slice(0, 600), f, n: nests };
  },
  load(d) {
    const o = d && typeof d === 'object' ? d : {};
    DEPTH.pendGrub = Array.isArray(o.g) ? o.g.filter((i) => Number.isInteger(i) && i >= 0 && i < W.trees.length).slice(0, 600) : null;
    for (const p of DEPTH.burn) { if (p.fobj) p.fobj.until = GAME.t; p.fobj = null; }
    DEPTH.burn.length = 0; DEPTH.job = null;
    for (const p of FORAGE.list) { p.gone = false; p.cut = false; p.char = 0; delete p.grow; p.regrowAt = 0; p.log = false; p.fall = null; p.fire = 0; if (p.coll) { p.coll.active = true; if (p.k === 'apple') { p.coll.h = 3.5; p.coll.stump = false; } } }
    if (Array.isArray(o.f)) for (const a of o.f.slice(0, 500)) {
      if (!Array.isArray(a)) continue;
      const p = FORAGE.list[a[0]];
      if (!p || !Number.isInteger(a[0])) continue;
      const st = clamp(+a[1] || 0, 0, 2);
      p.gone = st === 2; p.cut = st >= 1;
      p.char = clamp((+a[2] || 0) / 100, 0, 1);
      const gr = clamp((+a[3] || 100) / 100, 0.1, 1); if (gr < 1) p.grow = gr;
      p.regrowAt = +a[4] > 0 ? GAME.t + Math.min(+a[4], 3600) : 0;
      if (p.k === 'apple' && Number.isFinite(+a[5]) && a[5] !== null && p.cut && !p.gone) {
        const yaw = +a[5], stop = clamp(+a[6] || 1.4, 0.2, 1.7);
        p.fall = { ang: stop, vel: 0, ux: Math.sin(yaw), uz: Math.cos(yaw), yaw, stop, done: true, bounces: 4, drop: 1 };
        p.log = true; dpSettle(p);
      }
      if (p.coll) { if (p.gone || p.cut && p.k === 'bush') p.coll.active = false; else if (p.cut && p.k === 'apple') { p.coll.h = 0.6; p.coll.stump = true; } }
      if (p.cut || p.gone || p.char > 0) { p.ripe = 0; p.at = (p.regrowAt || GAME.t) + FORAGE_KINDS[p.k].regrow * 0.5; }
    }
    DEPTH.nests = [];
    if (Array.isArray(o.n)) for (const N of o.n.slice(0, 20)) {
      if (!N || !Number.isFinite(+N.x) || !Number.isFinite(+N.z) || !N.ma || !N.ma.tr) continue;
      DEPTH.nests.push({ x: +N.x, z: +N.z, y: floorAt(+N.x, +N.z, heightAt(+N.x, +N.z) + 0.5), eggs: clamp(Math.round(+N.e || 1), 1, 8), at: GAME.t + clamp(+N.l || 0, 0, 3600), ma: N.ma, pa: N.pa && N.pa.tr ? N.pa : null, pen: N.pen ?? null, owner: 'player', seed: Math.random() });
    }
    FORAGE.dirty = true;
  },
  key(d) { return d ? JSON.stringify([d.g.length, d.f.map((a) => a[0] * 10 + a[1]), d.n.length]) : ''; },
});

/* ------------------------------------------------------------------ */
/* test hooks: window.__hm.depth                                       */
/* ------------------------------------------------------------------ */
queueMicrotask(() => {
  if (!window.__hm) return;
  window.__hm.depth = {
    DEPTH, DP_BIRD, DP_RECIPES, dpIgnite, dpFell, dpCutBush, dpSplitApple, dpGrubTree, dpGrubPlant, dpStartJob, dpFlush, dpSpawnBird, depthClutch, depthHerdStart, depthCraftGear, depthCraftLvl,
    depthFireAt, depthOffers, dpStumpNear, dpPlantNear, depthSparesHouse, depthSparesGround, dpHouseRealm,
    depthOnKill, packItem, sanitizeItem, rollQuality, craftOdds, dpForageSlow,
    part: () => SAVE_PARTS.world.depth,
    plant(k, near) { let best = null, bd = Infinity; for (const p of FORAGE.list) { if (p.k !== k) continue; const d = near ? dist2(p.x, p.z, near.x, near.z) : p.i; if (d < bd) { bd = d; best = p; } } return best; },
    pstate(p) { return p ? { i: p.i, k: p.k, x: +p.x.toFixed(1), z: +p.z.toFixed(1), fire: +(p.fire || 0).toFixed(2), char: +(p.char || 0).toFixed(2), cut: !!p.cut, gone: !!p.gone, log: !!p.log, grow: p.grow ?? 1, ripe: +p.ripe.toFixed(2), fall: p.fall ? { ang: +p.fall.ang.toFixed(2), stop: +p.fall.stop.toFixed(2), done: p.fall.done } : null, coll: p.coll ? { active: p.coll.active, h: p.coll.h } : null, regrowAt: p.regrowAt || 0 } : null; },
    birds() { return DEPTH.birds.filter((e) => !e.removed).map((e) => ({ id: e.id, kind: e.kind, alive: e.alive, x: +e.x.toFixed(1), y: +e.y.toFixed(2), z: +e.z.toFixed(1), fly: !!e.bird.fly, water: e.bird.water })); },
    stats() { return { ...DEPTH.stats, burning: DEPTH.burn.length, nests: DEPTH.nests.length, birds: DEPTH.birds.filter((e) => e.alive && !e.removed).length, herd: DEPTH.herd ? DEPTH.herd.n : null }; },
  };
});
