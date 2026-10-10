/* ================================================================== */
/* fire in your hand: a burning brand taken from any fire              */
/* ================================================================== */
// Anyone can carry fire. Take a brand from a hearth, a brazier, a campfire, a burning tree or anything else alight;
// held up in the left hand it lights the way, sets roofs, trees and long grass alight (E), and sets alight whoever
// its bearer strikes. It burns down in a few minutes, the rain puts it out in the open, and water puts it out at once.
// An archer drops it to draw the bow. The flames are particles at the brand's head, worked out from the same arm pose
// the body shader holds it in (humanVS: the torch bit raises the left arm), and it lights everything around it.
const BRAND = { life: 240, rainLife: 22, pose: { ua: -1.05, uaz: -0.1, fa: -0.78 }, near: 1.9 };

// where the head of the brand is in the bearer's own frame, from the arm angles the shader uses (05a_rig.js)
function brandHeadLocal(e) {
  const A = BRAND.pose;
  const rx = (a, v) => { const c = Math.cos(a), s = Math.sin(a); return [v[0], c * v[1] - s * v[2], s * v[1] + c * v[2]]; };
  const rz = (a, v) => { const c = Math.cos(a), s = Math.sin(a); return [c * v[0] - s * v[1], s * v[0] + c * v[1], v[2]]; };
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
  // the head in the bind pose: the haft rises from the fist tilted forward (the kit builds it so), 0.47 m out
  const t = 1.82, grip = SK.fist, head = [grip[0], grip[1] + 0.47 * Math.cos(t), grip[2] + 0.47 * Math.sin(t)];
  let p = add(SK.elbow, rx(A.fa, sub(head, SK.elbow)));
  p = add(SK.shoulder, rz(A.uaz, rx(A.ua, sub(p, SK.shoulder))));
  // the chest leans with speed (humanVS: chestX), and the hips sink a little when running
  const amt = e.anim ? e.anim.amt : 0, k = Math.min(amt, 1), run = clamp((amt - 1) * 2, 0, 1);
  p = add(SK.spine, rx(0.05 * k + 0.2 * run, sub(p, SK.spine)));
  p[1] -= 0.06 * run;
  return p;
}
function brandHeadWorld(e, out) {
  const p = brandHeadLocal(e), sc = e.scale || 1, c = Math.cos(e.yaw), s = Math.sin(e.yaw);
  const x = p[0] * sc, y = p[1] * sc, z = p[2] * sc;
  out.x = e.x + x * c + z * s; out.y = e.y + y; out.z = e.z - x * s + z * c;
  return out;
}
// any fire close enough to take a brand from: fires on the ground and in hearths, braziers, burning trees
function brandSourceNear(P) {
  let best = null, bd = BRAND.near;
  for (const f of FIRES) {
    if (f.ghost || f.until < GAME.t || Math.abs(f.y - P.y) > 2.2) continue;
    const d = dist(P.x, P.z, f.x, f.z) - 0.25 * f.size;
    if (d < bd) { bd = d; best = { x: f.x, y: f.y, z: f.z, what: f.indoor ? 'the hearth' : 'the fire', d }; }
  }
  if (typeof NATURE !== 'undefined' && NATURE.built) {
    natTreesNear(P.x, P.z, 3.2, (t, d) => {
      if (t.fire > 0.25 && d - 0.5 < bd) { bd = d - 0.5; best = { x: t.x, y: P.y + 1, z: t.z, what: `the burning ${t.kind}`, d: bd }; }
    });
  }
  return best;
}
function takeBrand(P, src) {
  P.brand = { until: GAME.t + BRAND.life, wet: 0, x: P.x, y: P.y + 1.4, z: P.z, emitAcc: 0 };
  setAct(P, 5, 0.55);
  sfx('ignite');
  uiLog(`You take a burning brand from ${src.what}. Press E by a roof, a tree or long grass to set it alight.`, 'sys');
}
function putOutBrand(P, why = null, steam = false) {
  if (!P || !P.brand) return;
  const B = P.brand;
  P.brand = null;
  if (steam) { for (let i = 0; i < 10; i++) fxAlpha.emit(B.x, B.y, B.z, (Math.random() - 0.5) * 0.6, 0.8 + Math.random() * 0.8, (Math.random() - 0.5) * 0.6, 1.1, 0.75, 0.75, 0.78, 0.18, -0.6, 0.6); sfx('hiss'); }
  else FX.burst(B.x, B.y, B.z, 6, [1.6, 0.6, 0.18], 1.2, 0.4, 0.06, 6);
  if (why) uiLog(why, 'sys');
}
// what the brand can set alight from where its bearer stands: a house, a tree, or the grass ahead
function brandTargetFrom(P) {
  const fx = Math.sin(P.yaw), fz = Math.cos(P.yaw), ax = P.x + fx * 0.9, az = P.z + fz * 0.9;
  for (const H of HOUSES) {
    if (H.state !== 'whole' || dist2(ax, az, H.x, H.z) > (H.foot + 2) ** 2) continue;
    const l = houseL(H, ax, az), pad = 0.8;
    const hit = H.round ? Math.hypot(l.x, l.z) < H.Rr + pad : Math.abs(l.x) < H.w / 2 + H.ohSide + pad && Math.abs(l.z) < H.d / 2 + H.ohGable + pad;
    if (hit) return { kind: 'house', H, x: ax, z: az, label: H.round ? 'Set the thatch alight' : 'Set the roof alight', d: 0.6 };
  }
  if (typeof NATURE !== 'undefined' && NATURE.built) {
    const t = nearestTree(P.x, P.z, 2.6, (o) => natStanding(o) && !o.fall && o.fire < 0.05 && o.char < 0.9);
    if (t) return { kind: 'tree', t, x: t.x, z: t.z, label: `Set the ${t.kind} alight`, d: dist(P.x, P.z, t.x, t.z) - TREE_DIM[t.kind].r * natS(t) };
    const g = sampleGrid(W.grass, ax, az) + sampleGrid(W.field, ax, az) * 0.6, nat = NAT.data, ni = (Math.floor(az + 512) * NAT.res + Math.floor(ax + 512)) * 4;
    const spent = ni >= 0 && ni < nat.length ? Math.max(nat[ni], nat[ni + 1], nat[ni + 2]) / 255 : 1;
    if (g > 0.35 && spent < 0.3 && heightAt(ax, az) > WATER_Y + 0.1) return { kind: 'grass', x: ax, z: az, label: 'Set the grass alight', d: 0.9 };
  }
  return null;
}
function brandLight(P, T) {
  if (!P.brand || !T) return;
  setAct(P, 5, 0.5);
  if (T.kind === 'house') {
    if (!igniteHouse(T.H, T.x, T.z)) { uiError('It will not catch'); return; }
  } else if (T.kind === 'tree') {
    if (natDry() < 0.2) { uiError('It is too wet to burn'); return; }
    if (!igniteTree(T.t, 0.85)) { uiError('It will not catch'); return; }
  } else if (T.kind === 'grass') {
    if (natDry() < 0.2) { uiError('It is too wet to burn'); return; }
    if (!igniteGrass(T.x, T.z, 0.9, 4, 1)) { uiError('It will not catch'); return; }
  }
  sfx('ignite');
  FX.burst(T.x, heightAt(T.x, T.z) + 0.6, T.z, 10, [2.2, 0.9, 0.25], 1.6, 0.5, 0.1, -1);
}
// the E key: take a brand, set something alight, or (with nothing in reach) put it out
function brandOffers(P, offer) {
  if (inDungeon(P) || P.carrying != null) return;
  if (!P.brand) {
    const S = brandSourceNear(P);
    if (S) offer(S.d, BRAND.near, `Take a brand from ${S.what}`, () => takeBrand(P, S), 0.02);
    return;
  }
  const T = brandTargetFrom(P);
  if (T) offer(Math.max(0.05, T.d), 3.0, T.label, () => brandLight(P, T), 0.2);
  else offer(1.5, 1.6, 'Put out the brand', () => putOutBrand(P, 'You grind out the brand.'), -0.3);
}
// a blow struck with a brand in hand can set the foe alight
function brandOnHit(src, dst, opts) {
  if (!src || !src.brand || !dst || dst === src || !dst.alive || dst.kind === 'door' || opts.kind !== 'melee' || opts.dot) return;
  if (Math.random() < 0.3) addBuff(dst, 'burn', Math.max(1, (src.maxHp || 100) * 0.006), 4, src);
}
// every simulation step: the brand burns down, the rain and water put it out, an archer drops it to shoot
function updateBrand(dt) {
  const P = GAME.player;
  if (!P || !P.brand) return;
  const B = P.brand;
  if (!P.alive) { putOutBrand(P); return; }
  if (P.cls === 'archer' && P.casting && ABILITIES[P.casting.id] && ABILITIES[P.casting.id].anim === 2) { putOutBrand(P, 'You drop the brand to draw your bow.'); return; }
  if (GAME.t > B.until) { putOutBrand(P, 'Your brand burns down to nothing.'); return; }
  // water: wading deep or swimming puts it out at once
  const bed = heightAt(P.x, P.z);
  if (bed < WATER_Y - 0.9 && P.y < WATER_Y + 0.4) { putOutBrand(P, 'The water puts out your brand.', true); return; }
  // rain in the open puts it out in a while; under a roof or a crown it keeps
  const rain = WEATHER.raining || 0;
  if (rain > 0.15 && skyOver(P) > 0.5) {
    B.wet += dt * rain;
    if (B.wet > BRAND.rainLife) { putOutBrand(P, 'The rain puts out your brand.', true); return; }
  } else B.wet = Math.max(0, B.wet - dt * 0.5);
  brandHeadWorld(P, B);
}
// every frame: the flame at its head, smaller as it burns down or gets wet
const _bh = { x: 0, y: 0, z: 0 };
function drawBrand(dt) {
  const P = GAME.player;
  if (!P || !P.brand || !P.alive) return;
  const B = P.brand;
  brandHeadWorld(P, _bh);
  B.x = _bh.x; B.y = _bh.y; B.z = _bh.z;
  const left = (B.until - GAME.t) / BRAND.life, k = clamp(left * 6, 0.35, 1) * (1 - 0.6 * clamp(B.wet / BRAND.rainLife, 0, 1));
  B.emitAcc += dt * 34 * k;
  while (B.emitAcc > 1) {
    B.emitAcc -= 1;
    const a = Math.random() * TAU, r = Math.random() * 0.045;
    fxAdd.emit(B.x + Math.cos(a) * r, B.y + 0.02, B.z + Math.sin(a) * r, (Math.random() - 0.5) * 0.25, 0.7 + Math.random() * 0.7, (Math.random() - 0.5) * 0.25, 0.28 + Math.random() * 0.18, 2.5, 1.0 + Math.random() * 0.4, 0.3, (0.08 + Math.random() * 0.06) * k, -1.6, 0.7);
  }
  if (Math.random() < 0.25 * k) fxAlpha.emit(B.x, B.y + 0.35, B.z, (Math.random() - 0.5) * 0.2, 0.7, (Math.random() - 0.5) * 0.2, 1.2, 0.16, 0.14, 0.13, -0.35, -0.12, 0.3);
  if (Math.random() < 0.05 * k) fxAdd.emit(B.x, B.y + 0.1, B.z, (Math.random() - 0.5) * 1.4, 1.2 + Math.random(), (Math.random() - 0.5) * 1.4, 0.9, 2.6, 1.2, 0.3, 0.035, 3, 0.4);
  glowPush(B.x, B.y + 0.06, B.z, 2.2 * k, 1.0 * k, 0.32 * k, 0.75);
}

// with no foe and no house in view, a fire spell is aimed at the tree, or failing that the grass, that the player faces
function natureFireAim(P, id) {
  const A = ABILITIES[id];
  if (!A || !HOUSE_FIRE_SPELLS[id] || typeof NATURE === 'undefined' || !NATURE.built || inDungeon(P)) return null;
  const range = Math.min(A.range || 30, 30), yaw = CAM.yaw;
  let best = null, bs = Infinity;
  natTreesNear(P.x + Math.sin(yaw) * range * 0.5, P.z + Math.cos(yaw) * range * 0.5, range * 0.6, (t) => {
    if (!natStanding(t) || t.fall || t.fire > 0.05 || t.char > 0.9) return;
    const d = dist(P.x, P.z, t.x, t.z);
    if (d < 2 || d > range) return;
    const ang = Math.abs(angDiff(yaw, Math.atan2(t.x - P.x, t.z - P.z)));
    if (ang > 0.3) return;
    const s = ang * 12 + d * 0.04;
    if (s < bs) { bs = s; best = t; }
  });
  if (best) {
    const D = TREE_DIM[best.kind], s = natS(best);
    return { H: null, tree: best, x: best.x, y: best.y + Math.min(D.crownY * s, 4), z: best.z };
  }
  // the grass a few strides ahead, if there is grass there to burn
  for (const d of [9, 6, 13, 4]) {
    const x = P.x + Math.sin(yaw) * d, z = P.z + Math.cos(yaw) * d;
    if (sampleGrid(W.grass, x, z) + sampleGrid(W.field, x, z) * 0.6 > 0.35 && heightAt(x, z) > WATER_Y + 0.1 && !houseAt(x, z, 1)) return { H: null, grass: true, x, y: heightAt(x, z) + 0.3, z };
  }
  return null;
}
