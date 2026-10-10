/* ================================================================== */
/* [land] the mountains (1 of 2): the land map and the rock's look      */
/* shared by the terrain shader and the crags (03c_land.js)             */
/* ================================================================== */
// The land map, one texel per heightfield texel (2 m), baked once by mtnBakeMap (03c_land.js):
//   r how much a place is mountain (the ring round the frontier, the ridges between the realms, the map's outer wall),
//   g scree and boulder fans at the foot of the cliffs, b the gullies and chutes cut down the faces,
//   a heather on the gentler lower slopes.
U.uLandMap = { value: ZERO_TEX };
const GLSL_LAND = /* glsl */`
uniform sampler2D uLandMap;
vec4 landMapAt(vec2 xz){ return texture(uLandMap, ((xz + 512.0) * 0.5 + 0.5) / 513.0); }
// the mountain rock's own grey: as the terrain's rock has it, warm and cool across a range, a little paler up high
vec3 landRockTone(vec3 wp, vec3 tint){
  vec3 rc = vec3(0.47, 0.455, 0.425) * tint * vec3(1.02, 1.0, 0.97) * (0.86 + 0.24 * fbm3(wp.xz * 0.05 + wp.y * 0.03));
  rc *= mix(vec3(1.07, 1.0, 0.9), vec3(0.93, 0.98, 1.05), vnoise(wp.xz * 0.012 + 3.3));
  return rc * mix(0.94, 1.08, smoothstep(10.0, 46.0, wp.y));
}
// bedding planes, warped as the terrain's are (a band every 4.8 m), so the crags carry on the faces' strata
float landStrata(vec3 wp){
  float warp = vnoise(wp.xz * 0.045) * 9.0 + vnoise(wp.xz * 0.17 + 4.0) * 2.5;
  return 0.5 + 0.5 * sin((wp.y + warp) * 1.3);
}
// the faces broken into slabs and blocks that hold up at middle distance: a Voronoi on the face's own frame (along the
// contour, and up), cells about 8 m across and flatter than wide like bedding; each slab leans its own way (a tilt
// to add to the normal) and has its own tone, with a crack between slabs. Constant over a slab, so it never shimmers.
vec3 landFacets(vec3 wp, vec3 n, out float edge, out float tone){
  float steep = 1.0 - smoothstep(0.62, 0.95, n.y);
  vec2 ax = safeNormalize2(vec2(-n.z, n.x) + vec2(1e-4));
  vec2 q = vec2(dot(wp.xz, ax) * 0.1, wp.y * 0.21) + vec2(vnoise(wp.xz * 0.05) * 0.8, vnoise(wp.xz * 0.07 + 3.0) * 0.5);
  // where a slab would be only a few pixels on the screen (far off, or seen edge on) it fades to the smooth face
  float aa = 1.0 - smoothstep(0.06, 0.22, length(fwidth(q)));
  vec2 ip = floor(q), fp = fract(q);
  float d1 = 9.0, d2 = 9.0; vec2 id = vec2(0.0);
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    vec2 g = vec2(float(i), float(j));
    vec2 r = g + hash22(ip + g) * 0.85 - fp;
    float dd = dot(r, r);
    if (dd < d1) { d2 = d1; d1 = dd; id = ip + g; } else if (dd < d2) d2 = dd;
  }
  edge = (sqrt(d2) - sqrt(d1)) * 7.0 / (0.45 + 0.9 * vnoise(wp.xz * 0.31 + wp.y * 0.2)) / max(aa, 0.02); // metres to the crack, roughly; the cracks come and go
  vec2 h = hash22(id + 17.3) - 0.5;
  tone = mix(0.5, hash12(id + 5.1), aa);
  return (vec3(ax.x, 0.0, ax.y) * h.x * 0.75 + vec3(0.0, h.y * 0.6, 0.0)) * steep * aa;
}
// streaks where water runs down a face: dark stains, long and thin, across the face's own horizontal
float landStreaks(vec3 wp, vec3 n){
  vec2 ax = safeNormalize2(vec2(-n.z, n.x) + vec2(1e-4));
  float u = dot(wp.xz, ax);
  float s = vnoise(vec2(u * 0.55, wp.y * 0.035)) * 0.65 + vnoise(vec2(u * 1.7, wp.y * 0.09 + 3.0)) * 0.35;
  return smoothstep(0.58, 0.85, s);
}
// the high snow: Thule's peaks are white the year round, the southern ones only in winter. uSeasonC.z is how far the
// cold has brought the snow line down (-8 in high summer .. 10 in deep winter); thule is the realm's weight here.
float landSnowLine(vec3 wp, float thule, float nz){
  float line = mix(52.0, 27.0, thule) - uSeasonC.z * mix(1.5, 0.95, thule);
  return smoothstep(line, line + 7.0, wp.y + nz * 4.0);
}
// how much of that snow holds on a face this steep (n: the slab's normal, no fine relief): all of it on ledges and
// gentle ground, in drifts up steeper faces, none on the sheerest
float landSnowHold(vec3 n, vec3 wp){ return smoothstep(0.12 + 0.3 * vnoise(wp.xz * 0.08 + wp.y * 0.05), 0.62, n.y); }
`;
