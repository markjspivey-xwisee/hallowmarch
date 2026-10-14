/* ================================================================== */
/* seasons (1 of 2): the year on every surface. Shared uniforms and    */
/* the GLSL every shader can call; 05k_seasons.js sets the uniforms    */
/* each frame from SEASON (08h_farming.js) and keeps the season map    */
/* (lying snow, each place's own warmth, lake ice) up to date.         */
/* ================================================================== */
// uSeasonA: how much of each season it is now (spring, summer, autumn, winter; they sum to 1 and ease across the turns)
// uSeasonB: x the broadleaves' leaves turned (0 green .. 1 full autumn colour), y their leaves fallen (0 .. 1 bare),
//           z blossom on the fruit trees, w the fresh pale green of spring
// uSeasonC: x flowers in the meadows (0 .. 1), y the summer's gold on dry turf, z how far the high snow line has come
//           down (m), w the air's temperature now (°C) before each place's own warmth (the season map's g adds it)
// uSeasonD: x apples on the fruit trees (0 .. 1), y leaves drifting down, z fireflies, w -
U.uSeasonA = { value: new THREE.Vector4(1, 0, 0, 0) };
U.uSeasonB = { value: new THREE.Vector4(0, 0, 0, 0) };
U.uSeasonC = { value: new THREE.Vector4(1, 0, 0, 10) };
U.uSeasonD = { value: new THREE.Vector4(0, 0, 0, 0) };
// the season map, 8 m texels over the land: r lying snow (0..1), g the place's own warmth (°C = g * 40 - 30), b lake ice
const SEASON_TEX0 = new THREE.DataTexture(new Uint8Array([0, 191, 0, 255]), 1, 1, THREE.RGBAFormat);
SEASON_TEX0.needsUpdate = true;
U.uSeasonMap = { value: SEASON_TEX0 };
// uSnowCover (05e_weather.js) is the most snow lying anywhere in view; uSnowK.x is the weather's own snow round the
// camera and uSnowK.y = 1 / uSnowCover, so uSnowCover * snowHere(p) is the snow that lies at p (sheltered surfaces
// pass a smaller uSnowCover, as before)
U.uSnowK = { value: new THREE.Vector2(0, 100) };
// [weather2] the shelter map (12c_weather2.js): 1 m texels over the land, the height of the highest roof or floor over each
// (world y; far below where the sky is open). Below it no snow lies or falls and no rain falls: houses and halls, tower
// rooms, built roofs, tents, the walks and galleries over the ground. Off the map to the east lies the Barrow: all under ground
const SHELTER_TEX0 = new THREE.DataTexture(new Float32Array([-1e4]), 1, 1, THREE.RedFormat, THREE.FloatType);
SHELTER_TEX0.needsUpdate = true;
U.uShelter = { value: SHELTER_TEX0 };
U.uShelterOn = { value: 0 };
// [weather2] the ground's wetness at each place (12c_weather2.js's 32 x 32 grid: it soaks where it rains and dries in the
// sun), so the wet film lies under the rain and not beyond its edge; uWxWetOn 0 while the weather is held (uWet everywhere)
const WXWET_TEX0 = new THREE.DataTexture(new Uint8Array([0]), 1, 1, THREE.RedFormat, THREE.UnsignedByteType);
WXWET_TEX0.needsUpdate = true;
U.uWxWet = { value: WXWET_TEX0 };
U.uWxWetOn = { value: 0 };
const GLSL_SHELTER = /* glsl */`
uniform highp sampler2D uShelter;
uniform float uShelterOn;
float shelterY(vec2 xz){
  if (uShelterOn < 0.5) return -1e4;
  if (xz.x > 600.0) return 1e5;
  if (abs(xz.x) > 511.5 || abs(xz.y) > 511.5) return -1e4;
  return texelFetch(uShelter, ivec2(floor(xz + 512.0)), 0).r;
}
// 1 under a roof (no snow lies, no rain falls), 0 under the open sky
float shelteredK(vec3 wp){ return wp.y < shelterY(wp.xz) ? 1.0 : 0.0; }
// [weather2] how wet the surfaces at wp are: the camera's own uWet while the weather is held, else the ground's wetness there
uniform sampler2D uWxWet;
uniform float uWxWetOn;
float wetHere(vec3 wp, float w){ return uWxWetOn < 0.5 ? w : texture(uWxWet, clamp((wp.xz + 512.0) / 1024.0, vec2(0.0), vec2(1.0))).r; }
`;

const GLSL_SEASON = /* glsl */`
uniform vec4 uSeasonA, uSeasonB, uSeasonC, uSeasonD;
uniform sampler2D uSeasonMap;
uniform vec2 uSnowK;
${GLSL_SHELTER}
vec4 seasonMapAt(vec2 xz){ return texture(uSeasonMap, clamp((xz + 512.0) / 1024.0, vec2(0.0005), vec2(0.9995))); }
// the air's temperature here now (°C), as farmTempAt reckons it
float seasonTemp(vec2 xz){ return uSeasonC.w + seasonMapAt(xz).g * 40.0 - 30.0; }
// multiply uSnowCover by this: the falling snow round the camera, or the winter's snow lying here
float snowHere(vec3 wp){ return clamp(max(uSnowK.x, seasonMapAt(wp.xz).r) * uSnowK.y, 0.0, 100.0) * (1.0 - shelteredK(wp)); } // [weather2] none under a roof
// hoar frost on the turf on cold nights and mornings
float frostAt(vec2 xz){ return clamp((0.5 - seasonTemp(xz)) / 4.0, 0.0, 1.0); }
// the meadow through the year: lush in spring, gold on the dry turf in high summer, tawny and brown in autumn,
// dormant straw in winter. dry and lush: the meadow's patches; t: up the blade (0.5 for the turf seen from afar)
vec3 seasonGrass(vec3 alb, float dry, float lush, float t, vec2 xz){
  vec4 S = uSeasonA;
  float L = dot(alb, vec3(0.3, 0.55, 0.15));
  float n = vnoise(xz * 0.23 + 3.7);
  vec3 spring = alb * mix(vec3(1.0, 1.1, 0.82), vec3(0.96, 1.16, 0.74), lush);
  vec3 gold = vec3(1.62, 1.22, 0.42) * L;
  vec3 summer = mix(alb, gold, clamp(uSeasonC.y * (0.32 + 0.68 * dry) * (0.5 + 0.5 * t) * (1.0 - 0.5 * lush), 0.0, 0.95));
  vec3 tawny = mix(vec3(1.62, 1.0, 0.42), vec3(1.25, 0.8, 0.44), n) * L;
  vec3 autumn = mix(alb * vec3(1.04, 0.94, 0.8), tawny, clamp((0.62 + 0.3 * t) * (1.0 - 0.3 * lush) + 0.15 * dry, 0.0, 0.92));
  vec3 straw = mix(vec3(1.22, 1.02, 0.74), vec3(1.0, 0.88, 0.72), n) * L * 0.95;
  vec3 winter = mix(alb * vec3(0.86, 0.84, 0.8), straw, clamp(0.68 + 0.28 * t - 0.25 * lush, 0.0, 0.93));
  return spring * S.x + summer * S.y + autumn * S.z + winter * S.w;
}
// how far this tree is through the turning of its leaves: each tree at its own pace (tint: the tree's own 0..1)
float seasonTurnK(float tint){ return clamp(uSeasonB.x * 1.4 - fract(tint * 13.7) * 0.4, 0.0, 1.0); }
// a broadleaf's leaves through the year: fresh pale green, deep summer green, then gold, rust, red or brown by tree
vec3 seasonLeaf(vec3 alb, float tint, float birch){
  float L = dot(alb, vec3(0.3, 0.55, 0.15));
  float h = fract(tint * 5.31);
  vec3 gold = vec3(1.0, 0.7, 0.16), rust = vec3(0.86, 0.33, 0.09), brown = vec3(0.6, 0.38, 0.17), red = vec3(0.8, 0.17, 0.09);
  vec3 au = birch > 0.5 ? mix(gold, vec3(1.0, 0.84, 0.3), h)
    : h < 0.3 ? mix(gold, vec3(0.95, 0.55, 0.12), h / 0.3) : h < 0.6 ? mix(rust, red, (h - 0.3) / 0.3) : mix(brown, rust, (h - 0.6) / 0.4 * 0.5);
  au *= L * 2.6;
  vec3 c = mix(alb, au, seasonTurnK(tint));
  c = mix(c, alb * vec3(1.12, 1.2, 0.66), uSeasonB.w);
  return c * mix(vec3(1.0), vec3(0.9, 0.96, 0.88), uSeasonA.y);
}
// has this leaf (or card, or clump) fallen yet? seed: its own 0..1
float seasonFallen(float seed, float tint){ return step(seed * 0.9 + 0.05 + fract(tint * 7.9) * 0.08, uSeasonB.y); }
// a bare twig network on a leaf card in winter (uv on the card, seed the card's own)
float twigCard(vec2 uv, float seed){
  vec2 c = uv * 2.0 - 1.0;
  float a = 0.0;
  for (int k = 0; k < 4; k++) {
    float an = seed * 37.0 + float(k) * 1.7 + hash12(vec2(seed * 91.0, float(k))) * 0.9;
    vec2 d = vec2(cos(an), sin(an));
    float along = dot(c, d), across = abs(dot(c, vec2(-d.y, d.x)) + sin(along * 7.0 + seed * 20.0) * 0.05);
    float w = mix(0.07, 0.015, clamp(along, 0.0, 1.0));
    a = max(a, (1.0 - smoothstep(w * 0.6, w, across)) * step(-0.05, along) * (1.0 - smoothstep(0.75, 0.95, along)));
    // a side shoot
    vec2 o = d * 0.45, d2 = vec2(cos(an + 0.7), sin(an + 0.7));
    float al2 = dot(c - o, d2), ac2 = abs(dot(c - o, vec2(-d2.y, d2.x)));
    a = max(a, (1.0 - smoothstep(0.012, 0.03, ac2)) * step(0.0, al2) * (1.0 - smoothstep(0.25, 0.4, al2)));
  }
  return a;
}
`;
