/* ================================================================== */
/* [look2] the world looked at again (version 13)                      */
/* ================================================================== */
// What version 12's look left, each fixed at its cause; this module holds what is new code rather than a small change
// where the fault was (those carry [look2] marks in their own modules).
//
// The towns' footpaths, from afar. Version 12 drew them into the road channel of the world texture, 2 m texels: a path
// 1.5 m wide was one texel, a soft smear that read only faintly from a rise, and its halo of dirt was three or four
// metres wide. They are drawn now at 1 m into the second channel of the ground's contact-shade map (uGroundAO.g, which
// the terrain already reads), with a ragged edge in the shader (groundPath, 02_render.js; 03_terrain.js reads it as
// road), and the road channel keeps only a trodden verge round them (13t_look.js).
function look2PathMap(rg, R) {
  if (typeof lookTownPlan !== 'function' || !HOUSES.length) return; // (the plan is kept once made: never before the houses)
  for (const T of lookTownPlan()) for (const P of T.paths) {
    const hw = P.w / 2, pad = hw + 1.2;
    const x0 = Math.min(P.ax, P.bx) - pad, x1 = Math.max(P.ax, P.bx) + pad, z0 = Math.min(P.az, P.bz) - pad, z1 = Math.max(P.az, P.bz) + pad;
    for (let j = Math.max(0, Math.floor(z0 + 512)); j <= Math.min(R - 1, Math.ceil(z1 + 512)); j++) {
      for (let i = Math.max(0, Math.floor(x0 + 512)); i <= Math.min(R - 1, Math.ceil(x1 + 512)); i++) {
        const x = i - 512 + 0.5, z = j - 512 + 0.5, pd = lookSegD(x, z, P);
        // full across the path, falling off over a metre beyond its edge (the shader sharpens it again)
        const v = Math.round(255 * sstep(hw + 0.9, hw - 0.35, pd));
        const q = (j * R + i) * 2 + 1;
        if (v > rg[q]) rg[q] = v;
      }
    }
  }
}
// The apple trees' shade in winter. Their crowns are drawn bare once the leaves have fallen (09s_survival.js discards
// the leaves for twigs), but the shadow pass drew the whole crown: a full shadow under a bare tree. The depth pass now
// drops the same leaves (the same test as the colour pass)
const LOOK2_FORAGE_DEPTH_FS = /* glsl */`
  ${GLSL_COMMON}
  ${GLSL_SEASON}
  varying vec3 vO; varying float vPart; varying vec4 vDat;
  void main(){
    if (vPart > 0.5 && vPart < 1.5 && vDat.y > 7.5) {
      float seed = vDat.w, tint = fract(seed * 3.7);
      if (seasonFallen(hash12(floor(vO.xz * 7.0 + vO.y * 5.0) + seed * 3.0), tint) > 0.5 && 1.0 - abs(vnoise(vO.xz * 9.0 + vO.y * 6.0) * 2.0 - 1.0) < 0.82) discard;
    }
    gl_FragColor = vec4(1.0);
  }`;
// test hooks (tools/tests/look.py)
queueMicrotask(() => {
  if (!window.__hm) return;
  window.__hm.look2 = {
    // the 1 m path map's value at a point (0..1)
    path: (x, z) => { const T = U.uGroundAO.value; const d = T && T.image && T.image.data; if (!d || d.length < 1024 * 1024 * 2) return 0; const i = clamp(Math.floor(x + 512), 0, 1023), j = clamp(Math.floor(z + 512), 0, 1023); return d[(j * 1024 + i) * 2 + 1] / 255; },
  };
});
