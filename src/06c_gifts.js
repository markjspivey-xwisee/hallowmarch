/* ================================================================== */
/* realm gifts: each realm grants its own people passive gifts as      */
/* their realm rank grows, and at realm rank 5 (or level 30) a realm   */
/* ultimate on a long cooldown, on key 9 and its own button.           */
/*   Logres  Steadfast Lines, Unbroken;    The Raised Standard          */
/*   Ériu    Wood-wise, Rain-blest;        The Grey Hunt                */
/*   Thule   Cold-blooded, Wound-fury;     The Iron Winter              */
/* Realm champions (keep lords, warband leaders) call the ultimate in   */
/* big fights too. Hooks: dealDamage, addBuff and effectiveSpeed ask    */
/* giftHarmMult / giftBuffAdjust / giftSpeedMult; simStep runs          */
/* updateGifts, tick runs drawGifts.                                    */
/* ================================================================== */
const GIFT_ULT_RR = 5, GIFT_ULT_LV = 30, GIFT_CD = 300;
const GIFT_DEF = [
  {
    passives: [
      { id: 'steadfast', rr: 2, name: 'Steadfast Lines', icon: 'shield', text: (k) => `With two or more of your realm within 9 m you take ${giftPct(0.08 * k)}% less harm, and ${giftPct(0.14 * k)}% less with four or more.` },
      { id: 'unbroken', rr: 4, name: 'Unbroken', icon: 'tower', text: (k) => `Blows that stun you wear off ${giftPct(Math.min(0.45, 0.3 * k))}% sooner.` },
    ],
    ult: { id: 'standard', name: 'The Raised Standard', dur: 20, r: 14, icon: '<path d="M6 22V2.5"/><path d="M3 4h12"/><path d="M7 4h7v11l-3.5-2.4L7 15z"/><circle cx="6" cy="2.2" r="0.9"/>',
      text: (k) => `Plant the great standard of Logres. For 20 s every ally within 14 m is freed from stuns and snares, deals ${giftPct(0.15 * k)}% more damage and is warded by a shield of ${giftPct(0.12 * k)}% of their health, renewed every 5 s.` },
  },
  {
    passives: [
      { id: 'woodwise', rr: 2, name: 'Wood-wise', icon: 'leaves', text: (k) => `Among trees you move ${giftPct(0.15 * k)}% faster.` },
      { id: 'rainblest', rr: 4, name: 'Rain-blest', icon: 'rain', text: (k) => `Under open sky in the rain you heal up to ${giftPct(0.012 * k, 1)}% of your health every 2 s.` },
    ],
    ult: { id: 'hunt', name: 'The Grey Hunt', dur: 16, n: 5, icon: '<path d="M2.5 14.5c3 .2 5.2-1.6 6.6-4.6l2.2 1.6h4.6l2.6-2.3 2.6 1.6-1.6 3-3.4.6-2.6 4"/><path d="M9.1 9.9 8 6.5M11.4 16.2 9.6 21M15.6 15.7l.8 5.3"/><path d="M19 8.8l1.3-2.6"/>',
      text: (k) => `Wind the horn of the Hollow Hills: five grey hounds of mist run with you for 16 s, hunt the foes nearest you, and each bite slows its quarry by 40%. Hounds bite ${giftPct(k - 1)}% harder at higher ranks.` },
  },
  {
    passives: [
      { id: 'coldblood', rr: 2, name: 'Cold-blooded', icon: 'snow2', text: (k) => `Frost harms you ${giftPct(Math.min(0.5, 0.25 * k))}% less, snares hold you ${giftPct(Math.min(0.5, 0.35 * k))}% less and roots wear off that much sooner.` },
      { id: 'woundfury', rr: 4, name: 'Wound-fury', icon: 'flame', text: (k) => `Below half health you strike ${giftPct(0.12 * k)}% harder, and ${giftPct(0.24 * k)}% harder below a quarter.` },
    ],
    ult: { id: 'winter', name: 'The Iron Winter', dur: 14, r: 15, icon: '<path d="M4 10.5a4.6 4.6 0 0 1 8.6-3 3.8 3.8 0 0 1 7.3 1.8 2.6 2.6 0 0 1-.6 5.2H5.3A3 3 0 0 1 4 10.5z"/><path d="M8 17l-1 3M12 17l-1 3M16 17l-1 3"/>',
      text: (k) => `Call down a winter storm 15 m across for 14 s, on your foe or where you stand. Foes inside take frost damage every second and are slowed by 45%; fire inside is smothered.` },
  },
];
const GIFT_IDS = GIFT_DEF.flatMap((d) => d.passives.map((p) => p.id));
const GIFT = {
  on: Object.fromEntries(GIFT_IDS.map((k) => [k, false])), // which of the player's passives are working right now (the HUD lights them)
  allies: 0, trees: 0, rainT: 0, scanT: 0, champT: 0, npcNext: [0, 0, 0],
  standards: [], storms: [], hounds: [], casts: 0, lastCast: null, built: false,
};
const giftPct = (v, d = 0) => (Math.round(v * 100 * 10 ** d) / 10 ** d).toString();

/* ---- who has what ---- */
const giftRR = () => realmRank(GAME.prog ? GAME.prog.rp : 0);
// potency of a gift: 5% more for every realm rank past the one that unlocks it (up to 40%)
const giftK = (unlock) => 1 + 0.05 * clamp(giftRR() - unlock, 0, 8);
function giftHas(e, id) {
  if (!e || e !== GAME.player || !GAME.prog) return 0;
  const D = GIFT_DEF[e.faction];
  const p = D && D.passives.find((q) => q.id === id);
  return p && giftRR() >= p.rr ? giftK(p.rr) : 0;
}
const giftUltUnlocked = (P) => !!P && !!GAME.prog && (giftRR() >= GIFT_ULT_RR || GAME.prog.level >= GIFT_ULT_LV);
// how strong an ultimate is: ability ranks, and for the player each realm rank past 5
const giftUltK = (e) => rankMult(e.level) + (e === GAME.player ? 0.04 * Math.max(0, giftRR() - GIFT_ULT_RR) : 0);

/* ------------------------------------------------------------------ */
/* passives: asked by dealDamage, addBuff and effectiveSpeed           */
/* ------------------------------------------------------------------ */
function giftHarmMult(src, dst, opts) {
  const P = GAME.player;
  if (!P || (dst !== P && src !== P)) return 1;
  let m = 1;
  if (dst === P) {
    const k = giftHas(P, 'steadfast');
    if (k && GIFT.allies >= 2) m *= 1 - (GIFT.allies >= 4 ? 0.14 : 0.08) * k;
    const c = giftHas(P, 'coldblood');
    if (c && opts && (opts.kind === 'frost' || opts.kind === 'ice')) m *= 1 - Math.min(0.5, 0.25 * c);
  }
  if (src === P && dst !== P) {
    const f = giftHas(P, 'woundfury');
    if (f && P.hp < P.maxHp * 0.5) m *= 1 + (P.hp < P.maxHp * 0.25 ? 0.24 : 0.12) * f;
  }
  return m;
}
const _gAdj = { value: 0, dur: 0 };
function giftBuffAdjust(e, kind, value, dur) {
  _gAdj.value = value; _gAdj.dur = dur;
  if (e === GAME.player && GAME.prog) {
    const u = kind === 'stun' && giftHas(e, 'unbroken');
    if (u) _gAdj.dur = dur * (1 - Math.min(0.45, 0.3 * u));
    const c = (kind === 'snare' || kind === 'root') && giftHas(e, 'coldblood');
    if (c) { if (kind === 'snare') _gAdj.value = value * (1 - Math.min(0.5, 0.35 * c)); else _gAdj.dur = dur * (1 - Math.min(0.5, 0.35 * c)); }
  }
  return _gAdj;
}
function giftSpeedMult(e) {
  if (e !== GAME.player || !GIFT.on.woodwise) return 1;
  return 1 + 0.15 * giftHas(e, 'woodwise');
}

/* ------------------------------------------------------------------ */
/* the realm ultimate                                                  */
/* ------------------------------------------------------------------ */
function giftUltReady(e) {
  if (e === GAME.player) return GAME.t >= (e.giftCdUntil || 0);
  return GAME.t >= (e.giftCdUntil || 0);
}
// the player presses 9 (or the gift button)
function useRealmGift() {
  const P = GAME.player;
  if (!P || !P.alive || !GAME.started) return 'dead';
  const msg = { locked: `Your realm's gift comes at realm rank ${GIFT_ULT_RR} or level ${GIFT_ULT_LV}`, cooldown: 'Your realm gift is not ready yet', below: 'The realm gift cannot be called beneath the earth', carrying: 'Your hands are full with the hallow', stunned: 'You are stunned', busy: 'You are already casting' };
  const r = !giftUltUnlocked(P) ? 'locked' : !giftUltReady(P) ? 'cooldown' : castGiftUlt(P);
  if (r !== true) { if (msg[r]) uiError(msg[r]); return r; }
  for (const s of document.querySelectorAll('.gslot')) { s.classList.remove('flash'); void s.offsetWidth; s.classList.add('flash'); }
  saveSoon();
  return true;
}
function castGiftUlt(e, at = null) {
  if (!e || !e.alive) return 'dead';
  if (inDungeon(e)) return 'below';
  if (e.carrying != null) return 'carrying';
  if (isStunned(e)) return 'stunned';
  if (e.casting) return 'busy';
  const D = GIFT_DEF[e.faction];
  if (!D) return 'dead';
  if (e.mount) dismount(e);
  const U0 = D.ult, k = giftUltK(e);
  e.giftCdUntil = GAME.t + (e === GAME.player ? GIFT_CD * late2GiftCdK() /* [late2] a Champion of the realm's (10l_late.js) */ : 360);
  GIFT.casts++;
  GIFT.lastCast = { id: U0.id, by: e.id, t: GAME.t, realm: e.faction };
  if (U0.id === 'standard') giftStandard(e, k);
  else if (U0.id === 'hunt') giftHunt(e, k);
  else giftWinter(e, k, at);
  if (e !== GAME.player) news(`${e.name} calls ${U0.name.replace(/^The /, 'the ')} for ${REALMS[e.faction].name}!`, e.faction, GAME.player && GAME.player.faction !== e.faction && dist2(e.x, e.z, GAME.player.x, GAME.player.z) < 80 * 80 ? 'alarm' : 'normal');
  else uiLog(`You call ${U0.name.replace(/^The /, 'the ')}.`, 'level');
  return true;
}

/* ---- sound: made here, from the shared synth voices ---- */
function giftSfx(kind, x, z) {
  if (!AUDIO.ctx || !AUDIO.on || AUDIO.ctx.state !== 'running') return;
  const v = clamp(1.2 - Math.hypot(x - camera.position.x, z - camera.position.z) / 90, 0, 1);
  if (v <= 0.02) return;
  const t = AUDIO.ctx.currentTime + 0.01;
  try {
    if (kind === 'plant') { tone('sine', 90, 40, t, 0.5, 0.4 * v); noiseBurst(t, 0.35, 0.25 * v, 'lowpass', 1200, 200, 0.8); }
    else if (kind === 'howl') { for (const [d, f0, f1, len] of [[0, 330, 560, 0.7], [0.65, 560, 400, 1.1], [0.35, 440, 690, 0.8], [1.05, 690, 470, 1.2]]) tone('sine', f0, f1, t + d, len, 0.05 * v, 0.15); }
    else if (kind === 'bite') { noiseBurst(t, 0.08, 0.12 * v, 'bandpass', 900, 500, 1.4); tone('square', 160, 90, t, 0.07, 0.04 * v); }
    else if (kind === 'gale') { noiseBurst(t, 2.6, 0.22 * v, 'bandpass', 500, 1400, 0.6, 0.6); noiseBurst(t + 0.4, 2.2, 0.12 * v, 'highpass', 3000, 5000, 0.7, 0.5); }
    else if (kind === 'crack') { noiseBurst(t, 0.18, 0.3 * v, 'highpass', 2200, 5200, 1.2); tone('triangle', 2200, 900, t, 0.12, 0.05 * v); }
  } catch (err) { /* sound is optional */ }
}

/* ---- Logres: the Raised Standard ---------------------------------- */
const GIFT_BANNER_VS = /* glsl */`
  ${GLSL_COMMON}
  uniform float uTime, uWind; uniform vec2 uWindDir;
  uniform float uUnfurl, uSeed, uTop;
  attribute float aPart; attribute vec2 aUv;
  varying vec3 vW; varying vec3 vN; varying vec2 vUv; varying float vPart; varying float vShade;
  void main(){
    vec3 p = position; vec3 n = normal; vShade = 1.0;
    if (aPart > 1.5) {
      // the cloth hangs from the crossbar: let down as it unfurls, then rippling with the wind
      float hang = aUv.y;
      p.y = uTop - (uTop - p.y) * max(uUnfurl, 0.02);
      float h = hang * max(uUnfurl, 0.02);
      float w = 0.3 + 0.55 * clamp(uWind, 0.0, 2.5);
      float ph = uTime * (1.7 + 0.5 * clamp(uWind, 0.0, 2.0)) + uSeed;
      float a1 = ph + h * 4.6 - aUv.x * 1.4, a2 = ph * 1.63 + h * 8.5 + aUv.x * 2.3;
      float dz = (sin(a1) * 0.2 + sin(a2) * 0.06) * h * w;
      // never into the pole behind it
      float nearPole = 1.0 - smoothstep(0.12, 0.42, abs(position.x));
      dz = mix(dz, max(dz, -0.05), nearPole);
      p.z += dz;
      p.x += sin(ph * 0.7 + h * 2.2) * 0.05 * h * w;
      float slope = (cos(a1) * 0.2 * 4.6 + cos(a2) * 0.06 * 8.5) * h * w;
      n = normalize(vec3(-(cos(a1) * 0.2 * -1.4 + cos(a2) * 0.06 * 2.3) * h * w, -slope, 1.0));
      vShade = 0.82 + 0.18 * sin(a1 + 1.2);
    }
    vec4 w4 = modelMatrix * vec4(p, 1.0);
    vW = w4.xyz; vN = normalize(mat3(modelMatrix) * n); vUv = aUv; vPart = aPart;
    gl_Position = projectionMatrix * viewMatrix * w4;
  }`;
const giftBannerMat = mat({
  side: THREE.DoubleSide,
  uniforms: { uUnfurl: { value: 1 }, uSeed: { value: 0 }, uTop: { value: 7 }, uField: { value: new THREE.Vector3(0.55, 0.1, 0.08) }, uGold: { value: new THREE.Vector3(0.95, 0.72, 0.32) }, uGlow: { value: 0 } },
  vertexShader: GIFT_BANNER_VS,
  fragmentShader: /* glsl */`
    ${GLSL_COMMON}
    ${GLSL_ATMOS}
    ${GLSL_SHADOW}
    ${GLSL_PLIGHT}
    uniform vec3 uField, uGold; uniform float uGlow, uWet;
    varying vec3 vW; varying vec3 vN; varying vec2 vUv; varying float vPart; varying float vShade;
    // the crown of Logres (its own emblem), as a polygon in a 24 box with y down
    float crown(vec2 q){
      vec2 P[7] = vec2[7](vec2(5.0, 17.0), vec2(19.0, 17.0), vec2(20.0, 8.0), vec2(16.0, 12.0), vec2(12.0, 6.0), vec2(8.0, 12.0), vec2(4.0, 8.0));
      bool inside = false;
      for (int i = 0, j = 6; i < 7; j = i++) {
        if (((P[i].y > q.y) != (P[j].y > q.y)) && (q.x < (P[j].x - P[i].x) * (q.y - P[i].y) / (P[j].y - P[i].y) + P[i].x)) inside = !inside;
      }
      return inside ? 1.0 : 0.0;
    }
    void main(){
      vec3 n = safeNormalize(vN);
      vec3 V = safeNormalize(cameraPosition - vW);
      if (!gl_FrontFacing) n = -n;
      float sh = shadowAt(vW, n);
      vec3 alb; float spec = 0.0, rough = 0.0;
      if (vPart < 0.5) {
        // the staff: dark ash with a grain
        float g = vnoise(vec2(vUv.x * 9.0, vUv.y * 90.0));
        alb = vec3(0.24, 0.16, 0.1) * (0.75 + 0.4 * g);
      } else if (vPart < 1.5) {
        // gilt fittings: crossbar caps, the finial and the bands
        alb = uGold * 0.8; spec = 1.0;
      } else {
        // the cloth: the deep red field, a gold border and fringe, the crown in the middle; a swallowtail below
        vec2 uv = vUv;
        float tail = 0.86 + 0.12 * abs(uv.x * 2.0 - 1.0);
        if (uv.y > tail) discard;
        float border = step(uv.x, 0.07) + step(0.93, uv.x) + step(uv.y, 0.06) + step(tail - 0.05, uv.y);
        float weave = 0.9 + 0.1 * sin(uv.x * 420.0) * sin(uv.y * 600.0);
        alb = uField * weave;
        vec2 q = vec2((uv.x - 0.5) / 0.62 * 12.0 + 12.0, (uv.y - 0.38) / 0.36 * 12.0 + 12.0);
        float c = crown(q);
        alb = mix(alb, uGold * 0.85, clamp(border, 0.0, 1.0));
        alb = mix(alb, uGold * 0.95, c);
        alb *= vShade;
        rough = 1.0; spec = c * 0.4 + clamp(border, 0.0, 1.0) * 0.4;
        alb *= 1.0 - 0.3 * uWet;
      }
      float ndl = max(dot(n, uLightDir), 0.0);
      float wrap = vPart > 1.5 ? 0.35 : 0.0; // light through the cloth
      vec3 col = alb * (uAmbient * 0.9 + uLightColor * (ndl * sh + wrap * max(dot(-n, uLightDir), 0.0) * sh * 0.6));
      vec3 H = safeNormalize(uLightDir + V);
      col += uLightColor * spow(max(dot(n, H), 0.0), vPart > 1.5 ? 18.0 : 48.0) * spec * sh * 0.6;
      col += alb * pointLights(vW, n) * 0.6;
      col += uGold * uGlow * (vPart > 0.5 && vPart < 1.5 ? 0.9 : 0.12);
      gl_FragColor = vec4(safeColor(applyFog(col, vW)), 1.0);
    }`,
});
function giftBannerGeometry() {
  const parts = [];
  const add = (g, part, m) => { g = g.index ? g.toNonIndexed() : g; if (m) g.applyMatrix4(m); const n = g.attributes.position.count; g.setAttribute('aPart', new THREE.Float32BufferAttribute(new Float32Array(n).fill(part), 1)); if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(n * 2), 2)); parts.push(g); };
  const T = (x, y, z, rx = 0, ry = 0, rz = 0) => new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(1, 1, 1));
  const top = 7.0;
  // the staff, with gilt bands, a spike foot and a finial
  const staff = new THREE.CylinderGeometry(0.06, 0.075, top + 0.5, 10, 1); add(staff, 0, T(0, (top + 0.5) / 2 - 0.5, 0));
  for (const y of [1.2, top - 0.35]) add(new THREE.CylinderGeometry(0.085, 0.085, 0.12, 10, 1), 1, T(0, y, 0));
  add(new THREE.SphereGeometry(0.14, 12, 8), 1, T(0, top + 0.12, 0));
  add(new THREE.ConeGeometry(0.09, 0.42, 10), 1, T(0, top + 0.45, 0));
  // the crossbar the cloth hangs from, with knobbed ends
  add(new THREE.CylinderGeometry(0.035, 0.035, 2.0, 8, 1), 0, T(0, top - 0.25, 0.14, 0, 0, Math.PI / 2));
  for (const x of [-1.02, 1.02]) add(new THREE.SphereGeometry(0.07, 10, 6), 1, T(x, top - 0.25, 0.14));
  // the cloth: 1.8 m by 3.4 m, finely divided so it can ripple
  const cloth = new THREE.PlaneGeometry(1.8, 3.4, 10, 22);
  cloth.translate(0, top - 0.3 - 1.7, 0.16);
  {
    const p = cloth.attributes.position, uv = cloth.attributes.uv;
    for (let i = 0; i < p.count; i++) uv.setXY(i, (p.getX(i) + 0.9) / 1.8, (top - 0.3 - p.getY(i)) / 3.4);
  }
  add(cloth, 2, null);
  // merge
  let n = 0;
  for (const g of parts) n += g.attributes.position.count;
  const P = new Float32Array(n * 3), N = new Float32Array(n * 3), UV = new Float32Array(n * 2), A = new Float32Array(n);
  let o = 0;
  for (const g of parts) {
    P.set(g.attributes.position.array, o * 3); N.set(g.attributes.normal.array, o * 3); UV.set(g.attributes.uv.array, o * 2); A.set(g.attributes.aPart.array, o);
    o += g.attributes.position.count;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(P, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(N, 3));
  g.setAttribute('aUv', new THREE.BufferAttribute(UV, 2));
  g.setAttribute('aPart', new THREE.BufferAttribute(A, 1));
  g.computeBoundingSphere();
  return g;
}
let GIFT_BANNER_GEO = null;
// a clear spot for the standard near (x, z): nothing built within reach of the cloth, on walkable ground
function giftPlantSpot(x, z) {
  const tmp = [];
  const clear = (px, pz) => {
    if (!isWalkable(px, pz)) return false;
    collidersNear(px, pz, 3, tmp);
    for (const c of tmp) {
      if (!c.active) continue;
      const d = c.type === 'circle' ? Math.hypot(px - c.x, pz - c.z) - c.r : (() => { const dx = px - c.x, dz = pz - c.z; const lx = dx * c.cos - dz * c.sin, lz = dx * c.sin + dz * c.cos; return Math.hypot(Math.max(0, Math.abs(lx) - c.hx), Math.max(0, Math.abs(lz) - c.hz)); })();
      if (d < 1.4) return false;
    }
    return !houseAt(px, pz, 1.6);
  };
  if (clear(x, z)) return { x, z };
  for (let r = 1.2; r <= 6; r += 1.2) for (let a = 0; a < TAU; a += TAU / 10) { const px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r; if (clear(px, pz)) return { x: px, z: pz }; }
  return { x, z };
}
function giftStandard(e, k) {
  if (!GIFT_BANNER_GEO) GIFT_BANNER_GEO = giftBannerGeometry();
  const D = GIFT_DEF[0].ult, R = REALMS[e.faction];
  let at, y;
  if (e.y > heightAt(e.x, e.z) + 1.2) {
    // up on a wall walk or a tower top: on the same floor, a step to one side
    at = { x: e.x, z: e.z };
    for (const a of [Math.PI / 2, -Math.PI / 2, 0, Math.PI]) {
      const px = e.x + Math.sin(e.yaw + a) * 0.9, pz = e.z + Math.cos(e.yaw + a) * 0.9;
      if (Math.abs(floorAt(px, pz, e.y) - e.y) < 0.3) { at = { x: px, z: pz }; break; }
    }
    y = floorAt(at.x, at.z, e.y);
  } else {
    at = giftPlantSpot(e.x + Math.sin(e.yaw) * 1.2, e.z + Math.cos(e.yaw) * 1.2);
    y = heightAt(at.x, at.z);
  }
  if (GIFT.standards.length >= 4) giftStandardEnd(GIFT.standards[0], true);
  const m = new THREE.Mesh(GIFT_BANNER_GEO, shareMat(giftBannerMat, { uUnfurl: { value: 0 }, uSeed: { value: Math.random() * 30 }, uTop: { value: 7 }, uField: { value: new THREE.Vector3(...hex3(R.dark).map((v, i) => v * 0.6 + hex3(R.color)[i] * 0.55)) }, uGold: { value: new THREE.Vector3(...hex3(R.light)) }, uGlow: { value: 0 } }));
  m.position.set(at.x, y + 7, at.z);
  m.rotation.y = e.yaw + Math.PI; // the cloth's face toward the one who planted it
  m.frustumCulled = false;
  scene.add(m);
  m.updateMatrixWorld();
  const shadow = shadowCaster(m, depthFrom(m.material));
  const S = { x: at.x, z: at.z, y, t0: GAME.t, until: GAME.t + D.dur, r: D.r, src: e.id, realm: e.faction, k, mesh: m, shadow, tick: 0, shieldAt: 0, end: 0, landed: false };
  GIFT.standards.push(S);
  setAct(e, 1, 0.7);
  faceToward(e, at.x, at.z);
  spellPillar(at.x, y, at.z, 1.6, 26, 1.4, [2.2, 1.7, 0.7]);
  sfxAtE('fanfare', e, null, 2); // [audio2] placed: a champion's call is heard where it is called (11c_sound.js)
  return S;
}
function giftStandardEnd(S, now = false) {
  if (S.end && !now) return;
  S.end = GAME.t;
  if (now) { S.mesh.removeFromParent(); if (S.shadow) { SHADOW.scene.remove(S.shadow); const i = SHADOW.proxies.indexOf(S.shadow); if (i >= 0) SHADOW.proxies.splice(i, 1); } S.dead = true; GIFT.standards.splice(GIFT.standards.indexOf(S), 1); }
}
function stepStandard(S, dt) {
  const age = GAME.t - S.t0;
  // the staff comes down and bites into the ground
  if (!S.landed && age >= 0.35) {
    S.landed = true;
    FX.dust(S.x, S.y, S.z, 22, [0.45, 0.4, 0.32]);
    FX.ring(S.x, S.y + 0.2, S.z, 2.5, [2.3, 1.7, 0.6], 40, 7);
    spellDisc(S.x, S.z, S.r, DISC_KIND.holy, S.until - GAME.t + 0.5, [1.6, 1.15, 0.45]);
    lightFlash(S.x, S.y + 4, S.z, 22, [3.0, 2.3, 1.0], 1.0);
    giftSfx('plant', S.x, S.z);
    if (dist2(S.x, S.z, camera.position.x, camera.position.z) < 40 * 40) cameraShake(0.25, S.x, S.z);
    natureCut(S.x, S.z, 1.2, 0.9, true); // the grass is trodden round its foot
    // the rally: stuns, snares and roots fall away from everyone of the realm close by
    forNear(S.x, S.z, S.r, (o) => {
      if (!o.alive || o.faction !== S.realm || !isActor(o)) return;
      for (let i = o.buffs.length - 1; i >= 0; i--) if (o.buffs[i].kind === 'stun' || o.buffs[i].kind === 'snare' || o.buffs[i].kind === 'root') o.buffs.splice(i, 1);
    });
  }
  if (S.end) { if (GAME.t - S.end > 2.2) giftStandardEnd(S, true); return; }
  if (!S.landed) return;
  if (GAME.t >= S.until) { giftStandardEnd(S); return; }
  // every second: the rally and the ward
  S.tick -= dt;
  if (S.tick <= 0) {
    S.tick = 1;
    const ward = GAME.t >= S.shieldAt;
    if (ward) S.shieldAt = GAME.t + 5;
    forNear(S.x, S.z, S.r, (o) => {
      if (!o.alive || o.faction !== S.realm || !isActor(o) || o.kind === 'wolf') return;
      addBuff(o, 'dmg', 0.15 * S.k, 1.6, 'standard');
      if (ward) { addBuff(o, 'shield', o.maxHp * 0.12 * S.k, 5.5, 'standard'); if (dist2(o.x, o.z, camera.position.x, camera.position.z) < 50 * 50) FX.ring(o.x, o.y + 0.3, o.z, 0.9, [1.9, 1.5, 0.6], 14, 2); }
    });
  }
}
function drawStandard(S, dt) {
  const m = S.mesh, u = m.material.uniforms, age = GAME.t - S.t0;
  let y = S.y, unfurl = 0, glow = 0;
  if (!S.landed) { const f = clamp(age / 0.35, 0, 1); y = S.y + 6 * (1 - f * f); }
  else if (!S.end) { unfurl = smooth(clamp((age - 0.35) / 1.1, 0, 1)); glow = 0.35 * Math.max(0, 1 - (age - 0.35) / 1.5) + 0.06; }
  else {
    // furled, then drawn up out of the ground and gone in a shimmer
    const e = GAME.t - S.end;
    unfurl = 1 - smooth(clamp(e / 1.0, 0, 1));
    const lift = smooth(clamp((e - 1.0) / 1.2, 0, 1));
    y = S.y + lift * 0.8;
    glow = lift * 1.2;
    if (e > 1.0 && Math.random() < dt * 40) FX.trail(S.x + (Math.random() - 0.5) * 0.4, S.y + Math.random() * 7, S.z + (Math.random() - 0.5) * 0.4, [2.2, 1.7, 0.7], 0.14, 0.8);
    m.visible = lift < 0.98;
  }
  m.position.y = y;
  m.updateMatrixWorld();
  u.uUnfurl.value = unfurl; u.uGlow.value = glow;
  // motes of gold rise round the staff while it stands
  if (S.landed && !S.end && dist2(S.x, S.z, camera.position.x, camera.position.z) < 90 * 90) {
    if (Math.random() < dt * 14) { const a = Math.random() * TAU, r = Math.random() * S.r; FX.trail(S.x + Math.cos(a) * r, S.y + 0.2 + Math.random() * 0.6, S.z + Math.sin(a) * r, [1.8, 1.35, 0.5], 0.1, 1.2); }
    glowPush(S.x, S.y + 7.2, S.z, 1.6, 1.25, 0.5, 0.9);
  }
}

/* ---- Ériu: the Grey Hunt ------------------------------------------ */
function giftHunt(e, k) {
  const D = GIFT_DEF[1].ult;
  setAct(e, 3, 0.9);
  giftSfx('howl', e.x, e.z);
  sfxAtE('horn', e, null, 2); // [audio2] placed (11c_sound.js)
  for (let i = 0; i < D.n; i++) {
    const a = e.yaw + Math.PI + (i - (D.n - 1) / 2) * 0.55, r = 2.2 + (i % 2) * 0.8;
    let x = e.x + Math.sin(a) * r, z = e.z + Math.cos(a) * r;
    if (!isWalkable(x, z)) { x = e.x; z = e.z; }
    const h = makeEnt({
      kind: 'wolf', mobType: 'wolf', role: 'hound', faction: e.faction, level: e.level, name: 'Hound of the Grey Hunt',
      x, z, y: heightAt(x, z), yaw: e.yaw, radius: 0.5, scale: 1.12,
      look: { colA: [0.58, 0.74, 0.72], colB: [0.3, 0.42, 0.44] },
      tweak: { hp: 0.7, dmg: 0.6 * k, speed: 10.5, swing: 1.4 },
    });
    setupStats(h);
    // spirits are owed no bounty: whoever lays one low gains nothing
    h.damagers = { add() {}, has() { return false; } };
    h.hunt = { owner: e.id, until: GAME.t + D.dur + i * 0.15, swing: 0, born: GAME.t };
    GIFT.hounds.push(h);
    // each one comes out of a swirl of grey mist
    for (let q = 0; q < 16; q++) { const b = Math.random() * TAU; fxAlpha.emit(x + Math.cos(b) * 0.6, h.y + 0.2 + Math.random() * 0.8, z + Math.sin(b) * 0.6, Math.cos(b) * 1.4, 0.4 + Math.random() * 0.6, Math.sin(b) * 1.4, 1.2 + Math.random() * 0.6, 0.62, 0.7, 0.68, 0.45, -0.1, 1.2); }
  }
  spellDisc(e.x, e.z, 4.5, DISC_KIND.renew, 1.6, [0.6, 1.6, 1.15]);
  lightFlash(e.x, e.y + 1.5, e.z, 14, [0.8, 1.8, 1.3], 0.9);
}
function stepHound(h, dt) {
  const H = h.hunt, owner = getEnt(H.owner);
  if (!h.alive || h.removed) return false;
  if (GAME.t > H.until || !owner || !owner.alive || inDungeon(h)) { giftHoundFade(h); return false; }
  // the quarry, looked at again every second: foes near the owner, the owner's own foe first, and the pack
  // spreads itself over them rather than all on one
  let t = getEnt(h.target);
  if (!t || !t.alive || !isEnemy(h, t) || dist2(t.x, t.z, owner.x, owner.z) > 34 * 34 || GAME.t >= (H.pickAt || 0)) {
    H.pickAt = GAME.t + 0.8 + Math.random() * 0.4;
    const on = new Map();
    for (const o of GIFT.hounds) if (o !== h && !o.removed && o.target != null) on.set(o.target, (on.get(o.target) || 0) + 1);
    const ot = owner.target;
    let best = null, bs = Infinity;
    forNear(owner.x, owner.z, 26, (o) => {
      if (!o.alive || !isEnemy(h, o) || !isActor(o) || o.flying || o.kind === 'dragon' || o.kind === 'door') return;
      const n = on.get(o.id) || 0;
      const sc = dist2(o.x, o.z, h.x, h.z) + 160 * n * n - (o.id === ot ? 220 : 0) - (o.id === h.target ? 60 : 0);
      if (sc < bs) { bs = sc; best = o; }
    });
    t = best;
    h.target = t ? t.id : null;
  }
  if (t) {
    const reach = h.meleeRange * (h.scale || 1) + t.radius * (t.scale || 1);
    moveToward(h, t.x, t.z, dt, 1, reach * 0.8);
    h.combatUntil = GAME.t + 2;
  } else {
    // at heel: lope beside the owner
    const side = (h.id % 2 ? 1 : -1) * (1.6 + (h.id % 3) * 0.7);
    const fx = owner.x + Math.sin(owner.yaw) * 1.5 + Math.cos(owner.yaw) * side, fz = owner.z + Math.cos(owner.yaw) * 1.5 - Math.sin(owner.yaw) * side;
    moveToward(h, fx, fz, dt, dist(h.x, h.z, fx, fz) > 6 ? 1 : 0.7, 0.8);
  }
  // a bite (the swing itself is the ordinary auto-attack): the quarry is slowed and the hound's breath shows
  if (h.swingAt !== H.swing) {
    H.swing = h.swingAt;
    const q = getEnt(h.target);
    if (q) later(0.26, () => { if (h.alive && q.alive && dist(h.x, h.z, q.x, q.z) < 4) { addBuff(q, 'snare', 0.4, 2, h.id); giftSfx('bite', q.x, q.z); for (let n = 0; n < 6; n++) fxAlpha.emit(q.x, q.y + 0.8, q.z, (Math.random() - 0.5) * 2, Math.random() * 1.5, (Math.random() - 0.5) * 2, 0.7, 0.65, 0.78, 0.75, 0.22, -0.2, 1.5); } });
  }
  return true;
}
function giftHoundFade(h) {
  if (h.fading) return;
  h.fading = true;
  for (let q = 0; q < 22; q++) { const b = Math.random() * TAU; fxAlpha.emit(h.x + Math.cos(b) * 0.5, h.y + 0.3 + Math.random() * 0.8, h.z + Math.sin(b) * 0.5, Math.cos(b) * 0.8, 0.8 + Math.random(), Math.sin(b) * 0.8, 1.6 + Math.random() * 0.8, 0.62, 0.72, 0.7, 0.5, -0.25, 0.8); }
  glowPush(h.x, h.y + 0.6, h.z, 0.6, 1.4, 1.1, 2.2);
  h.alive = false; h.hp = 0; h.target = null; h.buffs.length = 0;
  h.anim.death = 1; h.removeAt = GAME.t; // gone into the mist at once
  removeEnt(h);
}
function drawHounds(dt) {
  for (const h of GIFT.hounds) {
    if (h.removed) continue;
    if (dist2(h.x, h.z, camera.position.x, camera.position.z) > 110 * 110) continue;
    const fade = clamp((h.hunt.until - GAME.t) / 1.5, 0, 1) * clamp((GAME.t - h.hunt.born) / 0.4, 0, 1);
    // pale and lit from within; wisps stream off the coat as it runs
    h.anim.flash = Math.max(h.anim.flash, 0.22 + 0.12 * Math.sin(renderTime * 7 + h.id));
    glowPush(h.x, h.y + 0.75, h.z, 0.35 * fade, 0.95 * fade, 0.75 * fade, 1.5);
    const run = Math.min(1, h.anim.amt || 0);
    if (Math.random() < dt * (10 + 30 * run)) {
      const back = -0.5 - Math.random() * 0.5;
      fxAlpha.emit(h.x + Math.sin(h.yaw) * back + (Math.random() - 0.5) * 0.3, h.y + 0.55 + Math.random() * 0.5, h.z + Math.cos(h.yaw) * back + (Math.random() - 0.5) * 0.3,
        -Math.sin(h.yaw) * 0.8, 0.35, -Math.cos(h.yaw) * 0.8, 0.9 + Math.random() * 0.5, 0.66, 0.76, 0.74, 0.32 + Math.random() * 0.2, -0.15, 1.4);
    }
    if (Math.random() < dt * 8) FX.trail(h.x + (Math.random() - 0.5) * 0.6, h.y + 0.7 + Math.random() * 0.4, h.z + (Math.random() - 0.5) * 0.6, [0.45, 1.3, 1.0], 0.1, 0.7);
  }
}

/* ---- Thule: the Iron Winter --------------------------------------- */
const giftCloudMat = mat({
  transparent: true, depthWrite: false, side: THREE.DoubleSide,
  uniforms: { uAge: { value: 0 }, uLife: { value: 1 }, uSeed: { value: 0 }, uBolt: { value: 0 } },
  vertexShader: /* glsl */`
    varying vec3 vW; varying vec2 vL;
    void main(){ vL = position.xy; vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
  fragmentShader: /* glsl */`
    ${GLSL_COMMON}
    ${GLSL_ATMOS}
    uniform float uAge, uLife, uSeed, uBolt;
    varying vec3 vW; varying vec2 vL;
    void main(){
      float r = length(vL);
      if (r > 1.0) discard;
      // a slow wheel of cloud, turning faster near its heart
      float ang = atan(vL.y, vL.x + 1e-5) + uTime * (0.25 + 0.5 * (1.0 - r)) + uSeed;
      vec2 q = vec2(cos(ang), sin(ang)) * r;
      float d = fbm(q * 3.2 + vec2(uSeed, uTime * 0.08)) * 0.75 + fbm(q * 7.0 - uTime * 0.12) * 0.35;
      float edge = 1.0 - smoothstep(0.55, 1.0, r + (d - 0.5) * 0.35);
      float env = smoothstep(0.0, 1.2, uAge) * (1.0 - smoothstep(uLife - 2.0, uLife, uAge));
      float a = clamp(edge * (0.5 + 0.7 * d), 0.0, 1.0) * 0.92 * env;
      if (a < 0.01) discard;
      vec3 c = mix(vec3(0.16, 0.19, 0.24), vec3(0.42, 0.47, 0.55), smoothstep(0.35, 0.95, d));
      c *= uAmbient * 1.3 + uLightColor * 0.25;
      c += vec3(0.55, 0.75, 1.1) * uBolt * (0.6 + 0.6 * d);
      gl_FragColor = vec4(safeColor(applyFog(c, vW)), a);
    }`,
});
let GIFT_CLOUD_GEO = null;
function giftWinter(e, k, at = null) {
  const D = GIFT_DEF[2].ult;
  let x = e.x, z = e.z;
  const t = at || getEnt(e.target);
  if (t && (at || (t.alive && isEnemy(e, t) && dist2(t.x, t.z, e.x, e.z) < 32 * 32))) { x = t.x; z = t.z; }
  else if (!at) {
    // no foe in hand: over the thick of the foes near, or where the caster stands
    let sx = 0, sz = 0, n = 0;
    forNear(e.x, e.z, 22, (o) => { if (o.alive && isEnemy(e, o) && isActor(o)) { sx += o.x; sz += o.z; n++; } });
    if (n) { x = sx / n; z = sz / n; }
  }
  if (GIFT.storms.length >= 3) giftWinterEnd(GIFT.storms[0]);
  if (!GIFT_CLOUD_GEO) GIFT_CLOUD_GEO = new THREE.CircleGeometry(1, 64);
  const y = heightAt(x, z);
  const cloud = new THREE.Mesh(GIFT_CLOUD_GEO, shareMat(giftCloudMat, { uAge: { value: 0 }, uLife: { value: D.dur + 2 }, uSeed: { value: Math.random() * 40 }, uBolt: { value: 0 } }));
  cloud.rotation.x = -Math.PI / 2;
  cloud.scale.setScalar(D.r * 1.35);
  cloud.position.set(x, y + 17, z);
  cloud.renderOrder = 7; cloud.frustumCulled = false;
  scene.add(cloud);
  const S = { x, z, y, r: D.r, t0: GAME.t, until: GAME.t + D.dur, src: e.id, realm: e.faction, k, cloud, tick: 0.6, snowAcc: 0, shardAcc: 0, boltT: 1.5, bolt: 0 };
  GIFT.storms.push(S);
  setAct(e, 3, 0.9);
  spellDisc(x, z, D.r, DISC_KIND.frost, D.dur + 1.5, [0.55, 0.8, 1.2]);
  aoeMarker(x, z, D.r, D.dur);
  giftSfx('gale', x, z);
  sfxAtE('frost', e, { max: 200, ref: 12 }, 2); // [audio2] placed (11c_sound.js)
  return S;
}
function giftWinterEnd(S) {
  if (S.dead) return;
  S.dead = true;
  S.cloud.removeFromParent();
  GIFT.storms.splice(GIFT.storms.indexOf(S), 1);
}
function stepWinter(S, dt) {
  if (GAME.t >= S.until + 2) { giftWinterEnd(S); return; }
  if (GAME.t >= S.until) return;
  S.tick -= dt;
  if (S.tick > 0) return;
  S.tick = 1;
  const src = getEnt(S.src) || { level: warLevel(), dmgMult: 1, faction: S.realm, buffs: [], role: 'none', scale: 1, alive: false, id: S.src };
  forNear(S.x, S.z, S.r, (o) => {
    if (!o.alive || !isEnemy(src, o) || !isActor(o) || o.flying || dist(o.x, o.z, S.x, S.z) > S.r) return;
    const r = computeDamage(src, o, 0.5 * S.k);
    dealDamage(src, o, r.d, { crit: r.crit, kind: 'frost' });
    addBuff(o, 'snare', 0.45, 1.6, S.src);
    if (o.wet !== undefined) o.snow = Math.min(1, (o.snow || 0) + 0.12); // the storm leaves its snow on those it catches (05h_wear.js)
  });
  // the storm smothers fire: grass, crowns and logs under it stop burning
  if (NATURE.fire.size) for (const [key, c] of NATURE.fire) { if (dist2(c.i - 511.5, c.j - 511.5, S.x, S.z) < S.r * S.r) { NAT.data[key * 4 + 2] = 0; NAT.data[key * 4 + 1] = Math.max(NAT.data[key * 4 + 1], 200); NATURE.fire.delete(key); natMark(c.i, c.j, c.i, c.j); } }
  natTreesNear(S.x, S.z, S.r, (t) => { if (t.fire > 0) t.fire = Math.max(0, t.fire - 0.35); });
}
function drawWinter(S, dt) {
  const u = S.cloud.material.uniforms, age = GAME.t - S.t0;
  u.uAge.value = age;
  S.bolt = Math.max(0, S.bolt - dt * 3);
  u.uBolt.value = S.bolt;
  const live = GAME.t < S.until;
  if (!live || dist2(S.x, S.z, camera.position.x, camera.position.z) > 120 * 120) return;
  const budget = quality.level === 'high' ? 1 : quality.level === 'medium' ? 0.6 : 0.35;
  const ramp = clamp(age / 1.2, 0, 1);
  // snow wheels round the heart of the storm and drives down
  S.snowAcc += dt * 260 * budget * ramp;
  while (S.snowAcc >= 1) {
    S.snowAcc -= 1;
    const a = Math.random() * TAU, r = Math.sqrt(Math.random()) * S.r * 1.05, h = Math.random() * 14;
    const px = S.x + Math.cos(a) * r, pz = S.z + Math.sin(a) * r, gy = heightAt(px, pz);
    const sp = 4 + 7 * (1 - r / S.r);
    const g = 0.85 + Math.random() * 0.15;
    fxAlpha.emit(px, gy + 0.4 + h, pz, -Math.sin(a) * sp - Math.cos(a) * 1.2, -2.2 - Math.random() * 2.5, Math.cos(a) * sp - Math.sin(a) * 1.2, 1.4 + Math.random() * 1.2, 0.9 * g, 0.94 * g, 1.0 * g, 0.07 + Math.random() * 0.06, 0, 0.1);
  }
  // spindrift along the ground
  if (Math.random() < dt * 30 * budget) {
    const a = Math.random() * TAU, r = (0.3 + Math.random() * 0.7) * S.r, px = S.x + Math.cos(a) * r, pz = S.z + Math.sin(a) * r;
    fxAlpha.emit(px, heightAt(px, pz) + 0.3, pz, -Math.sin(a) * 6, 0.3, Math.cos(a) * 6, 1.6, 0.85, 0.88, 0.95, 0.9 + Math.random() * 0.6, -0.05, 0.6);
  }
  // ice drives down out of the cloud
  S.shardAcc += dt * 9 * budget * ramp;
  while (S.shardAcc >= 1) {
    S.shardAcc -= 1;
    const a = Math.random() * TAU, rr = Math.sqrt(Math.random()) * S.r * 0.9;
    const tx = S.x + Math.cos(a) * rr, tz = S.z + Math.sin(a) * rr, ty = heightAt(tx, tz);
    spawnProjectile(getEnt(S.src) || { id: S.src, faction: S.realm }, null, 'ice', null, { x: tx, y: ty + 0.1, z: tz }, true, { x: tx - 4, y: S.y + 15, z: tz - 2 });
  }
  // cold lightning inside the cloud now and then
  S.boltT -= dt;
  if (S.boltT <= 0) {
    S.boltT = 1.2 + Math.random() * 2.2;
    S.bolt = 1;
    const a = Math.random() * TAU, rr = Math.random() * S.r * 0.6;
    lightFlash(S.x + Math.cos(a) * rr, S.y + 15, S.z + Math.sin(a) * rr, 40, [1.0, 1.5, 2.6], 0.5);
    giftSfx('crack', S.x, S.z);
  }
  glowPush(S.x, S.y + 2, S.z, 0.25, 0.4, 0.7, S.r * 0.9);
}

/* ------------------------------------------------------------------ */
/* every step                                                          */
/* ------------------------------------------------------------------ */
function updateGifts(dt) {
  const P = GAME.player;
  // the passives' view of the world, twice a second
  GIFT.scanT -= dt;
  if (GIFT.scanT <= 0 && P && GAME.prog) {
    GIFT.scanT = 0.5;
    let allies = 0;
    if (giftHas(P, 'steadfast')) forNear(P.x, P.z, 9, (o) => { if (o !== P && o.alive && o.faction === P.faction && isActor(o) && o.kind === 'humanoid' && dist2(o.x, o.z, P.x, P.z) < 81) allies++; });
    GIFT.allies = allies;
    let trees = 0;
    if (giftHas(P, 'woodwise') && !inDungeon(P)) natTreesNear(P.x, P.z, 8, (t) => { if (!t.felled && t.grow > 0.5) trees++; });
    GIFT.trees = trees;
    const O = GIFT.on;
    O.steadfast = !!giftHas(P, 'steadfast') && allies >= 2;
    O.unbroken = !!giftHas(P, 'unbroken');
    O.woodwise = !!giftHas(P, 'woodwise') && trees >= 3;
    O.rainblest = !!giftHas(P, 'rainblest') && !inDungeon(P) && wxPrecipAt(P.x, P.z) > 0.2 && wxSnowingAt(P.x, P.z) < 0.5 && skyOver(P) > 0.5; // [weather2] the rain where you stand
    O.coldblood = !!giftHas(P, 'coldblood');
    O.woundfury = !!giftHas(P, 'woundfury') && P.alive && P.hp < P.maxHp * 0.5;
  }
  // rain-blest: the rain mends
  if (P && P.alive && GIFT.on.rainblest) {
    GIFT.rainT -= dt;
    if (GIFT.rainT <= 0) {
      GIFT.rainT = 2;
      const k = giftHas(P, 'rainblest');
      if (P.hp < P.maxHp) { healEnt(P, P, P.maxHp * 0.012 * k * (0.5 + 0.5 * clamp(wxPrecipAt(P.x, P.z), 0, 1)), true); if (dist2(P.x, P.z, camera.position.x, camera.position.z) < 40 * 40) for (let n = 0; n < 6; n++) fxAdd.emit(P.x + (Math.random() - 0.5) * 0.8, P.y + 0.2 + Math.random() * 1.6, P.z + (Math.random() - 0.5) * 0.8, 0, 0.6, 0, 0.9, 0.5, 1.4, 1.0, 0.1, -0.3, 0.5); }
    }
  } else GIFT.rainT = Math.min(GIFT.rainT, 0.5);
  for (let i = GIFT.standards.length - 1; i >= 0; i--) stepStandard(GIFT.standards[i], dt);
  for (let i = GIFT.storms.length - 1; i >= 0; i--) stepWinter(GIFT.storms[i], dt);
  for (let i = GIFT.hounds.length - 1; i >= 0; i--) {
    const h = GIFT.hounds[i];
    if (h.removed || !stepHound(h, dt)) {
      // struck down: it comes apart into the mist it was made of
      if (!h.alive && !h.removed && !h.fading) { h.fading = true; h.removeAt = Math.min(h.removeAt, GAME.t + 0.7); for (let q = 0; q < 18; q++) { const b = Math.random() * TAU; fxAlpha.emit(h.x + Math.cos(b) * 0.5, h.y + 0.3 + Math.random() * 0.7, h.z + Math.sin(b) * 0.5, Math.cos(b) * 0.9, 0.7 + Math.random(), Math.sin(b) * 0.9, 1.5 + Math.random() * 0.7, 0.62, 0.72, 0.7, 0.45, -0.25, 0.8); } }
      GIFT.hounds.splice(i, 1);
    }
  }
  giftChampions(dt);
}
// realm champions call their realm's gift when a big fight goes against them
function giftChampions(dt) {
  GIFT.champT -= dt;
  if (GIFT.champT > 0) return;
  GIFT.champT = 1.5;
  const now = GAME.t;
  for (let r = 0; r < 3; r++) {
    if (now < GIFT.npcNext[r]) continue;
    const cands = [];
    for (const K of WAR.keeps) if (K.realm === r) { const L = getEnt(K.lord); if (L) cands.push(L); }
    for (const wb of WAR.warbands) if (wb.realm === r) { const L = typeof wbLeader === 'function' ? wbLeader(wb) : null; if (L) cands.push(L); }
    for (const e of cands) {
      if (!e.alive || e.removed || e.role === 'player' || now < (e.giftCdUntil || 0) || now > e.combatUntil || inDungeon(e) || e.level < 20) continue;
      let foes = 0, friends = 0;
      forNear(e.x, e.z, 20, (o) => { if (!o.alive || !isActor(o) || o.kind === 'wolf' && o.role === 'hound') return; if (isEnemy(e, o)) foes++; else if (o.faction === e.faction) friends++; });
      if (foes >= 6 && (friends >= 3 || e.hp < e.maxHp * 0.6)) {
        if (castGiftUlt(e) === true) { GIFT.npcNext[r] = now + 90; break; }
      }
    }
  }
}

/* ------------------------------------------------------------------ */
/* every frame: the visuals and the HUD                                */
/* ------------------------------------------------------------------ */
function drawGifts(dt) {
  for (let i = GIFT.standards.length - 1; i >= 0; i--) drawStandard(GIFT.standards[i], dt);
  for (let i = GIFT.storms.length - 1; i >= 0; i--) drawWinter(GIFT.storms[i], dt);
  drawHounds(dt);
  if (GAME.started && GAME.player) giftHUD();
}

/* ---- HUD: the gift button (key 9, and on the phone pad) and the passive marks ---- */
function giftStyles() {
  if ($('gift-css')) return;
  const st = document.createElement('style');
  st.id = 'gift-css';
  st.textContent = `
  .gslot { position: relative; width: 54px; height: 54px; border-radius: 50%; border: 1px solid var(--line-strong); background: radial-gradient(circle at 50% 38%, color-mix(in srgb, var(--rc) 40%, transparent), rgba(0, 0, 0, 0.62) 72%); display: grid; place-items: center; cursor: pointer; color: var(--rl); padding: 0; box-shadow: inset 0 0 0 2px color-mix(in srgb, var(--rc) 70%, transparent), 0 0 10px color-mix(in srgb, var(--rc) 35%, transparent); }
  .gslot svg { width: 28px; height: 28px; filter: drop-shadow(0 0 3px color-mix(in srgb, var(--rc) 80%, transparent)); }
  .gslot .key { position: absolute; top: 1px; left: 50%; transform: translateX(-50%); font: 700 11px var(--ui); color: var(--ink-dim); }
  .gslot .cd { position: absolute; inset: 0; border-radius: 50%; background: conic-gradient(rgba(0, 0, 0, 0.74) calc(var(--p, 0) * 1turn), transparent 0); pointer-events: none; }
  .gslot .cdt { position: absolute; inset: 0; display: grid; place-items: center; font: 700 14px var(--ui); color: #fff; text-shadow: 0 1px 3px #000; pointer-events: none; }
  .gslot.ready { animation: giftready 2.4s ease-in-out infinite; }
  .gslot.locked { color: var(--ink-faint); box-shadow: inset 0 0 0 1px var(--line); background: rgba(0, 0, 0, 0.55); }
  .gslot.locked svg { filter: none; opacity: 0.55; }
  .gslot .lock { position: absolute; bottom: 3px; left: 0; right: 0; text-align: center; font: 500 9.5px var(--ui); color: var(--ink-faint); }
  .gslot .tip { display: none; position: absolute; bottom: calc(100% + 10px); left: 50%; transform: translateX(-50%); width: 250px; padding: 9px 11px; font: 400 12.5px/1.4 var(--ui); color: var(--ink); text-align: left; z-index: 5; pointer-events: none; }
  .gslot .tip b { display: block; font: 600 13px var(--caps); color: var(--rl); margin-bottom: 2px; }
  .gslot .tip em { display: block; font-style: normal; color: var(--ink-dim); font-size: 11.5px; margin-bottom: 4px; }
  .gslot:hover .tip { display: block; }
  .gslot.flash { animation: slotflash 0.3s ease; }
  @keyframes giftready { 0%, 100% { box-shadow: inset 0 0 0 2px color-mix(in srgb, var(--rc) 70%, transparent), 0 0 8px color-mix(in srgb, var(--rc) 30%, transparent); } 50% { box-shadow: inset 0 0 0 2px var(--rl), 0 0 16px color-mix(in srgb, var(--rc) 70%, transparent); } }
  #hotbar .gslot { margin: 0 2px; }
  #tpad .gslot { position: absolute; right: 0; top: -66px; width: 56px; height: 56px; }
  #pf-gifts { display: flex; gap: 4px; margin-top: 5px; }
  #pf-gifts:empty { display: none; }
  #pf-gifts .gift { display: grid; place-items: center; width: 20px; height: 20px; border-radius: 50%; border: 1px solid color-mix(in srgb, var(--rc) 55%, transparent); color: var(--ink-faint); background: rgba(0, 0, 0, 0.45); opacity: 0.6; transition: opacity 0.3s, color 0.3s, box-shadow 0.3s; }
  #pf-gifts .gift svg { width: 12px; height: 12px; }
  #pf-gifts .gift.on { opacity: 1; color: var(--rl); box-shadow: 0 0 6px color-mix(in srgb, var(--rc) 75%, transparent); }
  @media (prefers-reduced-motion: reduce) { .gslot.ready { animation: none; } }
  `;
  document.head.appendChild(st);
}
// called at the end of buildHotbar (10_ui.js): the gift button after the eight abilities, and on the phone pad
function giftHotbar() {
  const P = GAME.player;
  if (!P) return;
  giftStyles();
  const D = GIFT_DEF[P.faction], R = REALMS[P.faction], U0 = D.ult;
  const tip = `<span class="tip panel"><b>${U0.name}</b><em>Realm gift · instant · ${Math.round(GIFT_CD / 60)} min cooldown · key 9</em>${U0.text(giftUltK(P))}<br><em style="margin-top:4px">${giftUltUnlocked(P) ? `Stronger with each realm rank past ${GIFT_ULT_RR}.` : `Granted at realm rank ${GIFT_ULT_RR} or level ${GIFT_ULT_LV}.`}</em></span>`;
  const html = (key) => `<button class="gslot" type="button" data-gift="1" aria-label="${U0.name} (realm gift)" style="--rc:${R.color};--rl:${R.light}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${U0.icon}</svg>${key ? `<span class="key">${key}</span>` : ''}<span class="cd"></span><span class="cdt"></span><span class="lock"></span>${key ? tip : ''}</button>`;
  const hb = $('hotbar'), sep = hb.querySelector('.sep');
  if (sep) sep.insertAdjacentHTML('beforebegin', html('9')); else hb.insertAdjacentHTML('beforeend', html('9'));
  $('tpad').insertAdjacentHTML('afterbegin', html(''));
  for (const b of document.querySelectorAll('.gslot')) {
    const go = (e) => { e.preventDefault(); e.stopPropagation(); useRealmGift(); };
    if (b.closest('#tpad')) b.addEventListener('pointerdown', go); else b.addEventListener('click', go);
  }
  // the ability bar's own bookkeeping counts only the eight abilities
  UI.slots = (UI.slots || []).filter((s) => !s.classList.contains('gslot'));
  // the passive marks under the player frame
  let row = $('pf-gifts');
  if (!row) { row = document.createElement('div'); row.id = 'pf-gifts'; $('pf-buffs').insertAdjacentElement('afterend', row); }
  row.style.setProperty('--rc', R.color); row.style.setProperty('--rl', R.light);
  row._h = '';
  GIFT.hudKey = '';
}
function giftHUD() {
  const P = GAME.player, rr = giftRR();
  const unlocked = giftUltUnlocked(P);
  const rem = Math.max(0, (P.giftCdUntil || 0) - GAME.t);
  for (const s of document.querySelectorAll('.gslot')) {
    s.classList.toggle('locked', !unlocked);
    s.classList.toggle('ready', unlocked && rem <= 0);
    s.style.setProperty('--p', unlocked && rem > 0 ? (rem / GIFT_CD).toFixed(3) : 0);
    setT(s.querySelector('.cdt'), unlocked && rem > 0 ? (rem >= 60 ? Math.ceil(rem / 60) + 'm' : Math.ceil(rem)) : '');
    setT(s.querySelector('.lock'), unlocked ? '' : `RR ${GIFT_ULT_RR}`);
  }
  if (UI.frame % 10 !== 0) return;
  const D = GIFT_DEF[P.faction];
  const row = $('pf-gifts');
  if (!row) return;
  const h = D.passives.filter((p) => rr >= p.rr).map((p) => `<span class="gift${GIFT.on[p.id] ? ' on' : ''}" title="${p.name}: ${p.text(giftK(p.rr))}">${iconSvg(p.icon, 12)}</span>`).join('');
  if (row._h !== h) { row.innerHTML = h; row._h = h; }
  // a new ultimate or a new passive since the bar was built: say so once
  const key = D.passives.filter((p) => rr >= p.rr).map((p) => p.id).join(',') + (unlocked ? '+ult' : '');
  if (GIFT.hudKey && key !== GIFT.hudKey) {
    const got = D.passives.find((p) => rr >= p.rr && !GIFT.hudKey.includes(p.id));
    if (got) uiToast(`Realm gift: ${got.name}. ${got.text(giftK(got.rr))}`, 'rank');
    else if (unlocked && !GIFT.hudKey.includes('+ult')) { uiToast(`Realm gift: ${D.ult.name}. ${IS_TOUCH ? 'Tap the gift button over your abilities' : 'Press 9'} to call it.`, 'rank'); buildHotbar(); } // [guide] a phone has no 9
  }
  GIFT.hudKey = key;
}
// key 9 calls the realm gift (the 1-8 keys are the abilities, in 09_player.js)
window.addEventListener('keydown', (e) => {
  if (e.code !== 'Digit9' || e.repeat || !GAME.started || UI.modal || typing() || gameplayKeyIgnored(e)) return;
  useRealmGift();
});

/* ---- saves: the ultimate's cooldown goes with the character ---- */
function giftSaveData() {
  const P = GAME.player;
  const cd = P ? Math.max(0, Math.round((P.giftCdUntil || 0) - GAME.t)) : 0;
  return cd > 0 ? { cd } : undefined;
}
function giftsOnStart(save) {
  const P = GAME.player;
  if (!P) return;
  const g = save && save.gift;
  P.giftCdUntil = GAME.t + (g && Number.isFinite(+g.cd) ? clamp(+g.cd, 0, GIFT_CD) : 0);
  GIFT.hudKey = '';
}

/* ---- the Chronicle's page on the gifts (10c_lore.js lists it) ---- */
function chronGifts() {
  const P = GAME.player, rr = giftRR(), lv = GAME.prog ? GAME.prog.level : 1;
  const realm = (D, i) => {
    const R = REALMS[i], mine = P && P.faction === i;
    const pas = D.passives.map((p) => {
      const have = mine && rr >= p.rr;
      return `<li><b>${p.name}</b> <span class="now">${mine ? (have ? 'yours' : `at realm rank ${p.rr}`) : `realm rank ${p.rr}`}</span><br>${p.text(have ? giftK(p.rr) : 1)}</li>`;
    }).join('');
    const ult = `<li><b>${D.ult.name}</b> <span class="now">${mine ? (giftUltUnlocked(P) ? 'yours: key 9' : `at realm rank ${GIFT_ULT_RR} or level ${GIFT_ULT_LV}`) : `realm rank ${GIFT_ULT_RR} or level ${GIFT_ULT_LV}`}</span><br>${D.ult.text(mine && giftUltUnlocked(P) ? giftUltK(P) : 1)} Once every ${Math.round(GIFT_CD / 60)} minutes.</li>`;
    return `<h3 style="color:${R.light}">${R.name}</h3><ul class="gifts">${pas}${ult}</ul>`;
  };
  return `<p class="lead">When the three captains carried the hallows out of the barrow, each hallow left something of itself in the people who kept it. The heralds call these the realm gifts. They wake in a soldier as their realm rank grows, and the oldest of them, the realm's own great gift, answers only to a proven champion.</p>
    <p>A gift works by itself: you do not have to call on it. Your passive gifts show as small marks under your name, lit while they are at work. The great gift sits beside your abilities on key <b>9</b> (on a phone, the round button above your abilities). The lords of the keeps and the leaders of the warbands carry the great gift too, and call it when a fight turns against them.</p>
    ${GIFT_DEF.map(realm).join('')}
    <p class="now">You: realm rank <b>${rr}</b>, level <b>${lv}</b>. Every realm rank past the one that grants a gift makes it 5% stronger, up to 40%.</p>`;
}

/* ---- debug and test hooks ---- */
setTimeout(() => {
  if (!window.__hm) return;
  window.__hm.gifts = { GIFT, GIFT_DEF, giftHas, giftK, giftHarmMult, giftBuffAdjust, giftSpeedMult, giftUltUnlocked, useRealmGift, castGiftUlt, giftRR, chronGifts,
    state: () => ({ on: { ...GIFT.on }, allies: GIFT.allies, trees: GIFT.trees, standards: GIFT.standards.length, storms: GIFT.storms.length, hounds: GIFT.hounds.filter((h) => !h.removed).length, casts: GIFT.casts, last: GIFT.lastCast, cd: GAME.player ? Math.max(0, (GAME.player.giftCdUntil || 0) - GAME.t) : null }) };
  window.__hm.land = { LAND, landSave, landApply, landKey };
}, 0);
