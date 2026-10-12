/* ================================================================== */
/* [look4] the world looked at again (version 15): shared pieces       */
/* ================================================================== */
// What version 14's look left and what version 14 added, looked at as a player meets them. This module holds what the
// shaders of other modules call (it loads before the houses, the castles and the engines that use it); the rest is in
// 04j_rubble.js (a house brought down by stones and its scaffold) and 13w_look4.js. Small changes where a fault was carry
// [look4] marks in their own modules.

// A house brought down by stones (04j_batter.js houseBreak) kept its walls whole to the eaves: a roofless shell, as a
// burnt house is. Masonry knocked down by stones lies in rubble with the walls broken off at a ragged line: here each wall
// stands to its own height in steps of LOOK4_SEG along it (a stub between knee and chest height, the corners standing a
// little higher), the house shader discarding what is above (houseFS, the shadow pass too: HOUSE_DEPTH_FS), the broken
// tops closed and the rubble heaped by 04j_rubble.js (houseRubbleGeo), the colliders and the shots' walls cut down with
// them. The same function in GLSL and in JS (look4StubAt), on whole numbers only, so both agree to the fragment.
//   q: the place in the house's own frame (x across, z along: houseL); dims: uHY.w (look4Dims: a box house's outer half
//   width and depth in cm, packed w * 4096 + d; a round house's outer radius in cm, negative); seed: the house's slot.
// Returns the height over the house's floor the wall stands to there (1e4 where it is not a wall: beyond the footprint).
const LOOK4_SEG = 0.5, LOOK4_MARGIN = 0.65;
const LOOK4_STUB_GLSL = /* glsl */`
  // (whole numbers: x - y * floor((x + 0.5) / y) never meets floor's edge, as mod's x * (1 / y) can)
  float look4Mod(float x, float y){ return x - y * floor((x + 0.5) / y); }
  float look4StubK(float i, float f, float s){ return look4Mod(i * 3.0 + f * 5.0 + s, 7.0) + look4Mod(i * i + f * 2.0, 5.0); }
  float look4Stub(vec2 q, float dims, float seed){
    float s = look4Mod(seed * 7.0, 11.0);
    if (dims < 0.0) {
      float R = -dims * 0.01;
      if (length(q) > R + ${LOOK4_MARGIN.toFixed(2)}) return 1e4;
      float u = (atan(q.x + 1e-6, q.y) + 3.14159265) * R;
      float i = floor(u / ${LOOK4_SEG.toFixed(2)});
      return 0.3 + 0.115 * look4StubK(i, 0.0, s);
    }
    float Wc = floor(dims / 4096.0), W2 = Wc * 0.01, D2 = (dims - Wc * 4096.0) * 0.01;
    float ex = abs(q.x) - W2, ez = abs(q.y) - D2;
    if (ex > ${LOOK4_MARGIN.toFixed(2)} || ez > ${LOOK4_MARGIN.toFixed(2)}) return 1e4;
    float f, u, len;
    if (ez > ex) { f = q.y > 0.0 ? 0.0 : 2.0; u = q.y > 0.0 ? q.x + W2 : W2 - q.x; len = 2.0 * W2; }
    else { f = q.x > 0.0 ? 1.0 : 3.0; u = q.x > 0.0 ? D2 - q.y : q.y + D2; len = 2.0 * D2; }
    float i = floor(clamp(u, 0.0, len - 0.001) / ${LOOK4_SEG.toFixed(2)}), last = floor((len - 0.001) / ${LOOK4_SEG.toFixed(2)});
    if (i < 0.5 || i > last - 0.5) return 1.2 + 0.05 * look4Mod(f * 3.0 + s, 5.0);
    return 0.3 + 0.115 * look4StubK(i, f, s);
  }
`;
// the same in JS: the house's walls' own numbers (a round house by its outer radius r, a box house by w, d)
const look4Dims = (H) => (H.round ? -Math.round(H.r * 100) : Math.round((H.w / 2) * 100) * 4096 + Math.round((H.d / 2) * 100));
const look4StubK = (i, f, s) => (((i * 3 + f * 5 + s) % 7) + 7) % 7 + ((((i * i + f * 2) % 5) + 5) % 5);
function look4StubAt(H, lx, lz) {
  const s = (H.slot * 7) % 11;
  if (H.round) {
    const R = Math.round(H.r * 100) * 0.01;
    if (Math.hypot(lx, lz) > R + LOOK4_MARGIN) return 1e4;
    const u = (Math.atan2(lx + 1e-6, lz) + Math.PI) * R, i = Math.floor(u / LOOK4_SEG);
    return 0.3 + 0.115 * look4StubK(i, 0, s);
  }
  const W2 = Math.round((H.w / 2) * 100) * 0.01, D2 = Math.round((H.d / 2) * 100) * 0.01;
  const ex = Math.abs(lx) - W2, ez = Math.abs(lz) - D2;
  if (ex > LOOK4_MARGIN || ez > LOOK4_MARGIN) return 1e4;
  let f, u, len;
  if (ez > ex) { f = lz > 0 ? 0 : 2; u = lz > 0 ? lx + W2 : W2 - lx; len = 2 * W2; }
  else { f = lx > 0 ? 1 : 3; u = lx > 0 ? D2 - lz : lz + D2; len = 2 * D2; }
  const i = Math.floor(clamp(u, 0, len - 0.001) / LOOK4_SEG), last = Math.floor((len - 0.001) / LOOK4_SEG);
  if (i < 0.5 || i > last - 0.5) return 1.2 + 0.05 * ((f * 3 + s) % 5);
  return 0.3 + 0.115 * look4StubK(i, f, s);
}
// a fallen house's walls: is it one, how high do they stand (the level the masons have built them back to), and the
// stub there with that level (houseBatterUniform gives the shader the level in uHD.x)
const look4Fell = (H) => !!(H && H.bat && H.bat.fell && (H.state === 'ruin' || H.state === 'scaffold'));
const look4Level = (H) => (H.rub ? H.rub.level : 0);
function look4WallTop(H, lx, lz) { return Math.max(look4StubAt(H, lx, lz), look4Level(H)); }

// Charred timber (the engines' material siegeMat on a burning gate's leaves and the wrecks, the castle shader's burnt
// towers, palisades and walks). Version 14 cracked the char with contour lines of a noise of (x + y, z + y): constant
// along a line, so on an upright face they ran in long diagonal streaks (the engines'), and from above a roof's checks
// were the iso-lines of a smooth noise, a net of winding veins glowing like lava (the castle shader's). Burnt timber
// checks into blocks across and along its grain (alligatoring): blocks of uneven shape and size, longer along the grain,
// the fissures between them deep; the embers glow in the fissures (a first try in rows of short blocks read as a brick
// wall with glowing mortar). uv: the face's coordinates in
// metres (planarUV), the grain along x. Returns x the fissure (0..1, 1 in it), y the block's own value (0..1), z how much of
// the pattern is left after its fade by the pixel's size (1 near, 0 where a block would be under about four pixels).
const LOOK4_CHAR_GLSL = /* glsl */`
  vec3 look4Char(vec2 uv){
    vec2 px2 = fwidth(uv);
    float px = max(max(px2.x, px2.y), 1e-5);
    // cells of a jittered grid stretched along the grain (about 16 cm along, 7.5 across), each a block of char; the
    // fissure is the edge between the two nearest cells, measured in metres
    vec2 sc = vec2(1.0 / 0.19, 1.0 / 0.065), q = uv * sc, ip = floor(q), fq = fract(q);
    float d1 = 9.0, d2 = 9.0; vec2 c1 = ip, c2 = ip;
    for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
      vec2 o = vec2(float(x), float(y)), h = hash22(ip + o);
      vec2 pm = (o + 0.12 + 0.76 * h - fq) / sc;
      float d = dot(pm, pm);
      if (d < d1) { d2 = d1; c2 = c1; d1 = d; c1 = ip + o; } else if (d < d2) { d2 = d; c2 = ip + o; }
    }
    float e = (sqrt(d2) - sqrt(d1)) * 0.5, id = hash12(c1 + 7.3);
    // each fissure (the edge between two blocks) its own depth: some open wide, some hairlines, a few closed, so the
    // checks read as a broken net, not a honeycomb
    float ed = hash12(c1 + c2 + abs(c1 - c2) * 3.1 + 11.1), w = mix(0.0008, 0.0075, ed * ed) * step(0.12, ed); // (the same seen from either block)
    float crack = (1.0 - smoothstep(w, w + px, e)) * (0.45 + 0.55 * ed);
    float keep = 1.0 - smoothstep(0.016, 0.03, px);
    return vec3(crack * keep, id, keep);
  }
`;

// A scaffold rises with the work (version 14's showed whole from the first stone): its standards stand from the start,
// its lifts (ledgers, putlogs, boards, rails, braces and the ladder up to each) go up one by one as the masonry comes up
// to them: the first at once, the last by three quarters of the work (W.t). The mesh is made again when a lift goes up
// (LOOK4.lifts: how many look3Scaffold draws; the floors and ladders are laid out once, LOOK4.geoOnly, and only those of
// the lifts that are up are on: look3ScafSync).
const LOOK4 = { lifts: Infinity, geoOnly: false, stats: { liftsUp: 0 } };
const LOOK4_NOB = { add() {} };
function look4LiftsWanted(W) {
  // (a tower's scaffold goes up once its rubble is cleared, at 12% of the work: 04g_breach.js)
  const R = W.l3, n = R && R.ladders.length ? Math.max(...R.ladders.map((L) => (L.k ?? 0) + 1)) : 1, t0 = W.kind === 'tower' ? 0.12 : 0;
  return clamp(1 + Math.floor((Math.max(0, clamp(W.t || 0, 0, 1) - t0) * n) / (0.75 - t0) + 1e-6), 1, n);
}
function look4LiftStep(C) {
  const each = (W, geo) => {
    if (!W.l3 || !W.scaffold || W.state !== 'repair') return;
    const want = look4LiftsWanted(W);
    if (W.l4n === want) return;
    W.l4n = want;
    const info = W.scafInfo;
    LOOK4.lifts = want; LOOK4.geoOnly = true;
    let g = null;
    try { g = geo(); } finally { LOOK4.lifts = Infinity; LOOK4.geoOnly = false; W.scafInfo = info; }
    W.scaffold.geometry.dispose(); W.scaffold.geometry = g;
    for (const q of SHADOW.proxies) if (q.userData.src === W.scaffold) q.geometry = g;
    LOOK4.stats.liftsUp++;
    look3ScafSync(W, !!(W.scaffold && (W.scaffold.visible !== false)));
  };
  for (const W of C.sections || []) if (W.l3again || W.kind === 'tower') each(W, () => (W.kind === 'tower' ? towerScaffoldGeo(W) : scaffoldGeo(C, W)));
  if (C.pal) for (const W of C.pal.gaps) each(W, () => palisadeScaffoldGeo(W));
}
