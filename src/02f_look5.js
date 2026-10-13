/* ================================================================== */
/* [look5] (version 17) what the grass's shader calls, loaded before it */
/* ================================================================== */
// Holy ground's light in the blades. A priest's holy ground (07b_classes.js consecrate) is a disc of light laid on the
// ground (05g_spells.js, kind 7), and in a meadow the grass stands over it: from a player's eye only its ring of motes
// (look4) showed where it lay. Now the blades in it catch its light: the grass's vertex shader (03_terrain.js) reads up
// to four holy grounds near the camera (uHallow: x, z, radius, strength; uHallowC: the realm's colour and a phase) and
// gives each blade the disc's own pattern at its root (the soft fill, the two rings, the turning sun-marks and the waves
// of light rising outward, turning with the disc's own clock), which the fragment shader lays over the blade, brightest
// at its tip. Filled once a frame from CLS.grounds (look5Frame, 13z_look5.js); nothing is read while none stands.
U.uHallow = { value: [new THREE.Vector4(), new THREE.Vector4(), new THREE.Vector4(), new THREE.Vector4()] };
U.uHallowC = { value: [new THREE.Vector4(), new THREE.Vector4(), new THREE.Vector4(), new THREE.Vector4()] };
U.uHallowN = { value: 0 };
const LOOK5_HALLOW_GLSL = /* glsl */`
  uniform vec4 uHallow[4]; uniform vec4 uHallowC[4]; uniform float uHallowN;
  float l5Band(float x, float c, float w){ return 1.0 - smoothstep(0.0, w, abs(x - c)); }
  // the holy ground's light at p: rgb its colour, a its strength (0 outside every ground)
  vec4 look5Hallow(vec2 p){
    vec4 o = vec4(0.0);
    for (int i = 0; i < 4; i++) {
      if (float(i) >= uHallowN) break;
      vec4 h = uHallow[i];
      vec2 d = p - h.xy;
      float r = length(d) / max(h.z, 0.1);
      if (r > 1.02) continue;
      float ang = satan(d.y, d.x);
      float fill = (1.0 - smoothstep(0.1, 1.0, r)) * 0.3;
      float ring = l5Band(r, 0.95, 0.035) + l5Band(r, 0.83, 0.02) * 0.8;
      float ticks = step(0.6, fract((ang / 6.2832) * 24.0 + uTime * 0.18)) * l5Band(r, 0.89, 0.045);
      float wf = fract(uTime * 0.35 + uHallowC[i].w), wave = l5Band(r, wf, 0.06) * (1.0 - wf) * 0.7;
      float v = (fill + ring + ticks * 0.75 + wave) * h.w * (1.0 - smoothstep(0.97, 1.02, r));
      if (v > o.a) o = vec4(uHallowC[i].rgb, v);
    }
    return o;
  }`;
