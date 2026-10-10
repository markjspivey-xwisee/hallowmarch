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
// A coordinate along the face (across the fall line) that never swings with the normal: world x or z, whichever runs
// more nearly along the contour, switched on a ragged line where the face looks along a diagonal (a fault). (The
// position projected on the contour's own direction turned with every bend of a face and striped it with moire.)
float landAlong(vec3 wp, vec3 n){ return abs(n.x) - abs(n.z) + (vnoise(wp.xz * 0.08) - 0.5) * 0.3 > 0.0 ? wp.z : wp.x; }
// the faces broken into blocks that hold up at middle distance, as rock breaks: warped beds about 3.4 m thick (the
// bedding planes run on round the mountain), each bed split by joints at its own spacing, staggered from the beds
// above and below, not every joint open. Each block leans its own way (a tilt to add to the normal) and has its own
// tone; edge is the distance in metres to the nearest open crack. Constant over a block, so it never shimmers; where
// a block would be only a few pixels on the screen (far off, or seen edge on) it fades to the smooth face.
vec3 landFacets(vec3 wp, vec3 n, out float edge, out float tone){
  float steep = 1.0 - smoothstep(0.62, 0.95, n.y);
  vec2 ax = safeNormalize2(vec2(-n.z, n.x) + vec2(1e-4));
  float u = landAlong(wp, n) + vnoise(wp.xz * 0.05) * 7.0;
  float yb = wp.y + vnoise(wp.xz * 0.045) * 5.0 + vnoise(wp.xz * 0.19 + 4.0) * 0.9;
  yb += 1.1 * sin(yb * 0.37); // beds thick and thin (a remap that only ever rises with the height)
  const float BH = 3.4;
  float row = floor(yb / BH), fy = fract(yb / BH);
  float bw = 4.0 + 8.0 * hash12(vec2(row, 7.7));
  // the joints lean, each bed's its own way, so the face never reads as coursed masonry
  float uu = (u + hash12(vec2(row, 3.1)) * 13.0 + (fy - 0.5) * BH * (hash12(vec2(row, 9.4)) - 0.5) * 1.4) / bw, col = floor(uu), fx = fract(uu);
  float aa = 1.0 - smoothstep(0.06, 0.22, max(fwidth(yb) / BH, fwidth(uu)));
  vec2 id = vec2(col, row);
  float dBed = min(fy, 1.0 - fy) * BH * (0.7 + 0.6 * vnoise(vec2(u * 0.4, row)));
  float open = step(0.3, hash12(id + 2.2)), dJoint = mix(9.0, min(fx, 1.0 - fx) * bw, open);
  edge = min(dBed, dJoint) / max(aa, 0.02);
  vec2 h = hash22(id + 17.3) - 0.5;
  tone = mix(0.5, hash12(id + 5.1), aa);
  return (vec3(ax.x, 0.0, ax.y) * h.x * 0.7 + vec3(0.0, h.y * 0.5 + 0.06, 0.0)) * steep * aa;
}
// streaks where water runs down a face: dark stains, long and thin, across the face's own horizontal
float landStreak1(float u, float y){ return vnoise(vec2(u * 0.55, y * 0.035)) * 0.65 + vnoise(vec2(u * 1.7, y * 0.09 + 3.0)) * 0.35; }
float landStreaks(vec3 wp, vec3 n){
  float s = mix(landStreak1(wp.x, wp.y), landStreak1(wp.z, wp.y), smoothstep(-0.25, 0.25, abs(n.x) - abs(n.z)));
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
