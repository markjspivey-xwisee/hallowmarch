/* ================================================================== */
/* [look6] the world looked at again with version 17's additions       */
/* ================================================================== */
// (version 18) What version 17 added, looked at as a player meets it (tools/tests/look_views.js, the `look6` group;
// tools/tests/look6.py), and what was wrong put right at its cause. This module holds what is new code; small changes
// where a fault was carry [look6] marks in their own modules (10m_deep.js, 04g_castles.js, ...).
//  - The deep's floors: the joints between the great flags were filled with pale ash that caught every light, and in the
//    hot halls embers glowed in every joint at once: from a step back the floor read as a glowing web (a lava floor, or
//    crazy paving). The joints are recessed and dark now, ash lies in a few of them, and embers glow only in broken
//    stretches of some cracks (deepFloorMat, patched here).
//  - The deep's embers (the cracks in its walls, the rings between its pillars' drums, a slab's cracks) glowed as
//    unbroken bars of light, like lit tubes; they smoulder in broken stretches now, as embers in a crack do. The runes
//    (the throne's ring, the seal's) keep their whole glow (deepEmberMat, patched here: a crack is given a darker ember
//    than a rune's full colour, 10m_deep.js).
//  - The cistern's water: a body in it stirs it (rings spreading from each swimmer and wader, a wake behind one that
//    moves) and the torches shine in it (deepWaterMat, patched here; `look6Frame` gives it the bodies).
//  - A gallery slab cracking under you had its warning ring under it: the ground's marks (the danger rings, your
//    target's ring) are drawn by the floors' shaders, and the slabs are drawn by the building shader, which has none.
//    The slabs are drawn with `look6SlabMat` (the building shader with the ground's marks on what faces up), so the
//    ring of a cracking slab, of the lord's stamp and of his cleave shows on them as on the floor.
// Test hooks `__hm.look6`.
const LOOK6 = { patched: [], missed: [], ringN: 0, stats: { frames: 0 } };
function look6Patch(m, name, from, to) {
  if (!m || typeof m.fragmentShader !== 'string' || !m.fragmentShader.includes(from)) { LOOK6.missed.push(name); return false; }
  m.fragmentShader = m.fragmentShader.replace(from, to);
  m.needsUpdate = true;
  LOOK6.patched.push(name);
  return true;
}

/* ---- the deep's floor: dark recessed joints, a little ash, embers in broken stretches of some cracks ---- */
if (typeof deepFloorMat !== 'undefined') {
  look6Patch(deepFloorMat, 'floor:joints',
    'vec3 alb = mix(stone, ashc, max(joint * 0.8, ash * 0.5 * (1.0 - joint)));',
    `vec3 alb = mix(stone, ashc, ash * 0.5 * (1.0 - joint));
      // [look6] a joint is a dark crack between two flags (ash lies in a few of them, grey in the dark, not pale)
      float jAsh = smoothstep(0.58, 0.8, vnoise(vW.xz * 0.55 + id * 3.7));
      alb = mix(alb, mix(stone * 0.32, ashc * 0.55, jAsh), joint * 0.92);`);
  look6Patch(deepFloorMat, 'floor:shade', 'vec3 col = lightSurface(alb, n, mix(1.0, 0.55, joint));', 'vec3 col = lightSurface(alb, n, mix(1.0, 0.35, joint)); // [look6] the joints recessed');
  look6Patch(deepFloorMat, 'floor:embers',
    'float ember = hot * joint * smoothstep(0.45, 0.85, vnoise(vW.xz * 0.9 + vec2(uTime * 0.03, 0.0))) * (0.65 + 0.35 * sin(uTime * 1.7 + id * 20.0));',
    `// [look6] embers smoulder in broken stretches of a few cracks, not along every joint at once (a web of light)
      float eRun = smoothstep(0.6, 0.86, vnoise(vW.xz * 0.7 + vec2(uTime * 0.02, 0.0) + 3.3)) * smoothstep(0.42, 0.68, vnoise(vW.xz * 4.3 + id * 9.0));
      float ember = hot * joint * eRun * (0.6 + 0.4 * sin(uTime * 1.7 + id * 20.0)) * 2.2;`);
}

/* ---- the deep's embers: a crack smoulders in broken stretches, a rune keeps its whole glow ---- */
if (typeof deepEmberMat !== 'undefined') {
  look6Patch(deepEmberMat, 'embers:broken',
    'gl_FragColor = vec4(safeColor(applyFog(vC * 1.7 * fl, vW)), 1.0);',
    `// [look6] a crack (its ember darker than a rune's full colour) glows in broken stretches along it and smoulders
      // dull between them; a rune keeps its whole glow. (A noise of (x + y, z + y) is the same all along a diagonal:
      // the crack's own length is y for one up a wall, x and z round a pillar's ring.)
      float crk = step(vC.r, 0.96);
      float seg = vnoise(vec2(vW.y * 2.3 + vW.x * 0.37, (vW.x - vW.z) * 1.7 + vW.z * 0.21));
      seg = smoothstep(0.34, 0.62, seg) * (0.75 + 0.25 * vnoise(vec2(vW.y * 9.0, (vW.x + vW.z) * 7.0)));
      gl_FragColor = vec4(safeColor(applyFog(vC * 1.7 * fl * mix(1.0, 0.14 + 1.05 * seg, crk), vW)), 1.0);`);
}

/* ---- the burning pitch: tongues of flame along the channel, not a bar of yellow light ---- */
// (the channels were never drawn before version 18: their strips faced down and were culled, 10m_deep.js deepChannels)
if (typeof deepChannelMat !== 'undefined') {
  look6Patch(deepChannelMat, 'pitch:flames', 'col += vec3(2.6, 1.0, 0.24) * heat * (0.45 + 0.65 * fl + 0.35 * f2) * (1.0 - lip * 0.7);',
    'col += vec3(2.3, 0.78, 0.17) * heat * (0.22 + 1.0 * fl * fl + 0.5 * f2 * f2) * (1.0 - lip * 0.7); // [look6] tongues of flame running along it (it saturated to a bar of yellow)');
}

/* ---- the cistern's water: stirred by those in it, the torches in it ---- */
const LOOK6_RINGS = 6;
if (typeof deepWaterMat !== 'undefined') {
  deepWaterMat.uniforms.uL6Ring = { value: Array.from({ length: LOOK6_RINGS }, () => new THREE.Vector4(0, 0, 0, 0)) };
  deepWaterMat.uniforms.uL6Dir = { value: Array.from({ length: LOOK6_RINGS }, () => new THREE.Vector4(0, 0, 0, 0)) };
  deepWaterMat.uniforms.uL6N = { value: 0 };
  if (look6Patch(deepWaterMat, 'water:decl', 'varying vec3 vW;\n    void main(){', `varying vec3 vW;
    uniform vec4 uL6Ring[${LOOK6_RINGS}]; uniform vec4 uL6Dir[${LOOK6_RINGS}]; uniform int uL6N; // [look6] the bodies in the water: x, z, how stirred, size; their way and speed
    void main(){`) && look6Patch(deepWaterMat, 'water:rings', 'vec3 n = safeNormalize(vec3(g.x * 0.22, 1.0, g.y * 0.22));', `// [look6] rings spread from each body in the water, a wake trails one that moves, a ruffle hugs it
      float stir = 0.0;
      for (int i = 0; i < ${LOOK6_RINGS}; i++) {
        if (i >= uL6N) break;
        vec4 R = uL6Ring[i], Dw = uL6Dir[i];
        vec2 d = p - R.xy; float r = length(d) + 1e-4;
        vec2 u = d / r;
        float rr = max(r - R.w * 0.45, 0.0);
        float env = exp(-rr * 0.55) * R.z;
        float ph = rr * 7.5 - t * 4.2 + R.w;
        g += u * cos(ph) * env * 0.55;
        stir += (1.0 - smoothstep(0.0, 0.5, rr)) * R.z * (0.6 + 0.4 * sin(t * 9.0 + r * 13.0));
        // the wake: two arms opening behind a body that swims or wades on
        float sp = Dw.z;
        if (sp > 0.05) {
          float along = dot(d, Dw.xy), across = dot(d, vec2(-Dw.y, Dw.x));
          float behind = smoothstep(0.0, -0.6, along) * exp(along * 0.35);
          float arm = abs(abs(across) - (-along) * 0.34);
          float w = (1.0 - smoothstep(0.0, 0.35 + (-along) * 0.05, arm)) * behind * min(sp, 1.6) * 0.6;
          g += vec2(-Dw.y, Dw.x) * sign(across) * sin(-along * 9.0 + t * 6.0) * w * 0.5;
          stir += w * 0.35;
        }
      }
      vec3 n = safeNormalize(vec3(g.x * 0.22, 1.0, g.y * 0.22));`)) look6Patch(deepWaterMat, 'water:light', 'vec3 col = base * (0.4 + uAmbient * 2.0) + gPL * (0.05 + 0.45 * fres) + vec3(0.02, 0.05, 0.055) * fres;',
    `vec3 col = base * (0.4 + uAmbient * 2.0) + gPL * (0.06 + 0.75 * fres) + vec3(0.02, 0.05, 0.055) * fres;
      col += (gPL * 0.35 + uAmbient * 0.6 + vec3(0.03, 0.06, 0.065)) * min(stir, 1.2); // [look6] stirred water catches the light
      // [look6] the torches' glints in the still water: each light's mirror image, drawn out and broken by the ripples
      vec3 Rv = reflect(-V, n);
      for (int i = 0; i < ${PL_MAX}; i++) {
        if (i >= uPLN) break;
        vec3 Ld = uPLPos[i].xyz - vW; float dl = length(Ld); Ld /= max(dl, 1e-3);
        col += uPLCol[i].rgb * spow(max(dot(Rv, Ld), 0.0), 70.0) * 1.4 / (1.0 + dl * 0.07);
      }`);
}

/* ---- the slabs: the building shader with the ground's marks on what faces up ---- */
const look6SlabMat = (() => {
  const m = shareMat(buildingMat);
  const ok = m.fragmentShader.includes('vec3 col = lightSurface(alb, n, vAO);') && m.fragmentShader.includes('varying vec3 vW;');
  if (!ok) { LOOK6.missed.push('slab'); return buildingMat; }
  m.fragmentShader = m.fragmentShader.replace('varying vec3 vW;', `${GLSL_DECAL}\n    varying vec3 vW;`)
    .replace('vec3 col = lightSurface(alb, n, vAO);', 'vec3 col = lightSurface(alb, n, vAO);\n      col = mix(col, applyDecal(col, sampleDecal(vW.xz)), smoothstep(0.6, 0.85, n.y)); // [look6] the ground\'s marks on a slab (a cracking slab\'s ring)');
  LOOK6.patched.push('slab');
  return m;
})();

/* ---- each frame: the bodies in the cistern's water ---- */
function look6Frame(dt) {
  void dt;
  LOOK6.stats.frames++;
  let n = 0;
  if (typeof DEEP !== 'undefined' && DEEP.built && DEEP.root && DEEP.root.visible && INDOOR.on && typeof deepWaterMat !== 'undefined' && deepWaterMat.uniforms.uL6Ring) {
    const R = deepWaterMat.uniforms.uL6Ring.value, Dw = deepWaterMat.uniforms.uL6Dir.value, cx = camera.position.x, cz = camera.position.z, wy = DEEP.wy;
    for (const e of ENT) {
      if (n >= LOOK6_RINGS) break;
      if (!e.alive || e.removed || e.kind === 'door' || e.x < 1000 || dist2(e.x, e.z, cx, cz) > 45 * 45) continue;
      const w = late3WaterAt(e.x, e.z);
      if (!w || w.depth < 0.12 || e.y > wy + 0.1 || e.y + 2.2 * (e.scale || 1) < wy) continue;
      const vx = (e.x - (e._l6x ?? e.x)) / Math.max(dt, 1e-3), vz = (e.z - (e._l6z ?? e.z)) / Math.max(dt, 1e-3);
      e._l6x = e.x; e._l6z = e.z;
      const sp = Math.min(3, Math.hypot(vx, vz)), k = (e.swim ? 0.9 : 0.55) * (0.45 + 0.55 * Math.min(1, sp / 1.5));
      R[n].set(e.x, e.z, k, 0.4 + 0.4 * (e.scale || 1));
      if (sp > 0.05) Dw[n].set(vx / sp, vz / sp, sp, 0); else Dw[n].set(0, 0, 0, 0);
      n++;
    }
  }
  if (typeof deepWaterMat !== 'undefined' && deepWaterMat.uniforms.uL6N) deepWaterMat.uniforms.uL6N.value = n;
  LOOK6.ringN = n;
}

queueMicrotask(() => { if (window.__hm) window.__hm.look6 = { LOOK6, look6Frame, look6SlabMat, look6Patch }; });
