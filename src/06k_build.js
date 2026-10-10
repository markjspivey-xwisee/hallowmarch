/* ================================================================== */
/* building: structures placed from goods, raised with a hammer, used, */
/* burnt, repaired and pulled down                                     */
/* ================================================================== */
// G opens the builder (or the hammer button): a bar of pieces, a ghost that follows the mouse (or stands ahead of you on
// a phone), R turns it, a click (or Place) sets it down. Pieces snap to a 3 m grid shared by everything already built
// nearby: foundations and floors fill cells, walls, doors, windows, fences and gates stand on cell edges, roofs rest on
// walls, stairs climb a cell, and the campfire, workbench, bed and chest stand anywhere on a floor or the ground. The
// goods are taken when a piece is set down; it then rises as you work it with a hammer (tool_hammer). Built pieces are
// real: walls and doors have colliders, floors, foundations and stairs are floors (floorAt), doors, gates and shutters
// swing, roofs keep the rain and snow off (houseRoofOver, the rain shader's roof list), everything gets wet and snowed
// on through the shared weather uniforms, wood burns (fire spells, the dragon, a brand: fireLandsAt), the fire spreads,
// burnt pieces fall to charred stubs, roofs without walls fall with them, and anything can be repaired or pulled down.
// Where: your own realm's lands (homeland or march), not in or by towns, keeps, temples, musters, camps or the Barrow,
// not on roads or water, not on slopes too steep. Saved with the world (save part 'build'); the bed with it.
// For other systems: buildPieces() lists built pieces; buildFenceLine(x0, z0, x1, z1, opts) puts up a fence (and gate)
// for pens (see the comment there); buildWorkbenchNear(x, z, r) finds a workbench; buildHasRoof(x, z) shelter.
const B_C = 3.0, B_WH = 2.8, B_REACH = 12, B_MAX = 220;
registerGood('nails', { name: 'Iron nails', kind: 'part', icon: 'hammer', value: 1, desc: 'For joining timber. A workbench makes ten from an iron bar.', plural: 'Iron nails', stack: 999 });
registerGood('glass', { name: 'Pane of glass', kind: 'part', icon: 'drop', value: 5, desc: 'Leaded glass for a window.', plural: 'Panes of glass' });

// the pieces: kind cell (fills a grid cell), edge (stands on a cell edge) or free (anywhere on a floor or the ground)
const BP = {
  found: { name: 'Foundation', kind: 'cell', cost: [['stone', 6], ['plank', 4]], time: 6, burn: 0, desc: 'A stone footing with a plank floor. Walls stand on its edges.' },
  wall: { name: 'Plank wall', kind: 'edge', cost: [['plank', 6], ['nails', 4]], time: 6, burn: 1, desc: 'A timber-framed wall of boards.' },
  door: { name: 'Doorway', kind: 'edge', cost: [['plank', 7], ['nails', 6], ['iron', 1]], time: 7, burn: 1, desc: 'A wall with a hinged door. R turns which way it opens.' },
  window: { name: 'Window', kind: 'edge', cost: [['plank', 6], ['nails', 4], ['glass', 1]], time: 7, burn: 1, desc: 'A wall with a glazed window and shutters.' },
  wallStone: { name: 'Stone wall', kind: 'edge', cost: [['stone', 10]], time: 9, burn: 0, desc: 'Drystone. It does not burn.' },
  roofThatch: { name: 'Thatch roof', kind: 'cell', cost: [['thatch', 8], ['plank', 3]], time: 7, burn: 2, roof: true, desc: 'A gable of thatch over one cell, resting on walls. Burns fast.' },
  roofShingle: { name: 'Shingle roof', kind: 'cell', cost: [['plank', 6], ['nails', 6]], time: 8, burn: 1, roof: true, desc: 'A gable of wooden shingles over one cell, resting on walls.' },
  floor: { name: 'Upper floor', kind: 'cell', cost: [['plank', 5], ['nails', 4]], time: 5, burn: 1, desc: 'Boards across the tops of walls: a loft or a second storey.' },
  stairs: { name: 'Stair', kind: 'cell', cost: [['plank', 6], ['nails', 4]], time: 6, burn: 1, desc: 'Climbs one storey across a cell.' },
  fence: { name: 'Fence', kind: 'edge', ground: true, cost: [['plank', 3]], time: 3, burn: 1, desc: 'Posts and rails along a cell edge.' },
  gate: { name: 'Gate', kind: 'edge', ground: true, cost: [['plank', 4], ['iron', 1]], time: 4, burn: 1, desc: 'A hinged gate in a fence line.' },
  campfire: { name: 'Campfire', kind: 'free', cost: [['stone', 4], ['plank', 2]], time: 3, burn: 0, r: 0.7, desc: 'A ring of stones to light a fire in. Warms and dries you.' },
  workbench: { name: 'Workbench', kind: 'free', cost: [['plank', 6], ['nails', 4], ['iron', 1]], time: 5, burn: 1, hx: 0.85, hz: 0.42, desc: 'Saw logs into planks, beat iron into nails.' },
  bed: { name: 'Bed', kind: 'free', cost: [['plank', 4], ['thatch', 2]], time: 4, burn: 1, hx: 0.52, hz: 1.02, desc: 'Sleep here and you wake here when you fall.' },
  chest: { name: 'Chest', kind: 'free', cost: [['plank', 4], ['iron', 1]], time: 3, burn: 1, hx: 0.45, hz: 0.28, desc: 'Keeps goods safe.' },
};
const BP_ORDER = ['found', 'wall', 'door', 'window', 'wallStone', 'roofThatch', 'roofShingle', 'floor', 'stairs', 'fence', 'gate', 'campfire', 'workbench', 'bed', 'chest', 'pull'];
const BUILD = { pieces: [], roofs: [], next: 1, mode: null, work: null, ghost: null, ghostKey: '', mx: -1, my: -1, mouseT: -99, bed: 0, roofsDirty: true, ui: null };
const buildPieces = () => BUILD.pieces.filter((pc) => pc.st === 'built');
const bpCost = (t) => BP[t] ? BP[t].cost : [];
const bpCostText = (cost) => cost.map(([id, n]) => `${n} ${goodName(id, n).toLowerCase()}`).join(', ');
const bHasHammer = () => goodsHave('tool_hammer');

/* ------------------------------------------------------------------ */
/* the material: the building shader, risen to a level while it is     */
/* built, charred and glowing as it burns, kept dry under a roof       */
/* ------------------------------------------------------------------ */
function bPatch(src, anchor, fn) {
  if (!src.includes(anchor)) throw new Error('build shader: the building shader no longer has "' + anchor + '"');
  return src.replace(anchor, fn(anchor));
}
const B_VS = bPatch(bPatch(buildingMat.vertexShader, 'attribute vec3 aCol;', (a) => 'uniform float uRise;\n    ' + a),
  'vec4 w = modelMatrix * vec4(position, 1.0);', () => 'vec3 bp = position; bp.y = min(bp.y, uRise); vec4 w = modelMatrix * vec4(bp, 1.0);');
const B_FS = (() => {
  let fs = buildingMat.fragmentShader;
  fs = bPatch(fs, 'uniform float uFlash, uWet, uSnowCover;', (a) => a + /* glsl */`
    uniform vec4 uPc;
    float pieceWetU(){ return uWet; }
    float pieceSnowU(){ return uSnowCover; }
    float pWet = 0.0, pSnow = 0.0;
    #define uWet pWet
    #define uSnowCover pSnow
  `);
  fs = bPatch(fs, 'void main(){', (a) => a + '\n      pWet = pieceWetU() * (1.0 - uPc.w); pSnow = pieceSnowU() * (1.0 - uPc.w);');
  fs = bPatch(fs, 'vec3 col = lightSurface(alb, n, vAO);', () => /* glsl */`
      // fire: soot creeps over the piece, charred wood crazes into cracks that glow while it burns
      float bNz = vnoise(vW.xz * 1.9 + vW.y * 2.3) * 0.6 + vnoise(vW.xz * 5.3 - vW.y * 4.1 + 7.0) * 0.4;
      float bCrack = smoothstep(0.86, 0.97, 1.0 - abs(vnoise(vW.xz * 5.0 + vW.y * 3.3) * 2.0 - 1.0));
      alb = mix(alb, vec3(0.05, 0.043, 0.037) * (0.75 + 0.5 * bNz), clamp(uPc.y * (0.55 + 0.7 * bNz), 0.0, 1.0));
      vec3 col = lightSurface(alb, n, vAO);
      col += vec3(2.6, 0.72, 0.15) * uPc.z * (bCrack * 1.3 + smoothstep(0.62, 0.84, bNz) * 0.4) * (0.7 + 0.3 * sin(uTime * 7.0 + vW.x * 3.0 + vW.z * 2.0));
  `);
  return fs;
})();
const B_MAT = mat({ vertexShader: B_VS, fragmentShader: B_FS, uniforms: { uFlash: buildingMat.uniforms.uFlash, uRise: { value: 99 }, uPc: { value: new THREE.Vector4() } } });
// the ghost: a see-through piece, green where it can go, red where it cannot
const B_GHOST = mat({
  transparent: true, depthWrite: false,
  uniforms: { uOk: { value: 1 } },
  vertexShader: /* glsl */`varying vec3 vN; varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; vN = mat3(modelMatrix) * normal; gl_Position = projectionMatrix * viewMatrix * w; }`,
  fragmentShader: /* glsl */`
    uniform float uOk, uTime;
    varying vec3 vN; varying vec3 vW;
    void main(){
      vec3 n = normalize(vN), V = normalize(cameraPosition - vW);
      float rim = pow(1.0 - abs(dot(n, V)), 2.0);
      float lines = smoothstep(0.92, 1.0, fract(vW.y * 2.5 - uTime * 0.6));
      vec3 c = mix(vec3(1.0, 0.25, 0.18), vec3(0.35, 1.0, 0.5), uOk);
      gl_FragColor = vec4(c * (0.55 + 0.9 * rim + 0.5 * lines), 0.26 + 0.4 * rim + 0.2 * lines);
    }`,
});

/* ------------------------------------------------------------------ */
/* the models, in each piece's own frame: y = 0 is its base (a floor's */
/* top, a wall's foot), x along an edge piece, z across it ("outside" */
/* is +z), a cell piece centred on its cell                            */
/* ------------------------------------------------------------------ */
const B_COL = { wood: [0.52, 0.38, 0.24], dark: [0.34, 0.24, 0.15], fresh: [0.64, 0.5, 0.33], stone: [0.58, 0.56, 0.52], thatch: [0.7, 0.58, 0.34], shingle: [0.38, 0.28, 0.2], iron: [0.2, 0.2, 0.22] };
const B_ID = new THREE.Matrix4();
function bBox(b, x, y, z, sx, sy, sz, m, col, yaw = 0, pitch = 0, roll = 0) { b.add(G.box, lm(B_ID, x, y, z, yaw, sx, sy, sz, pitch, roll), m, col, 0, 3); }
function bFooting(b, foot, len, th) {
  // a drystone footing from the base down into the ground (foot is below 0 when the ground falls away)
  if (foot < -0.02) bBox(b, 0, foot / 2 - 0.05, 0, len, -foot + 0.1, th, MAT.drystone, B_COL.stone);
}
function bTimberWall(b, pc, holes) {
  // posts at the ends, a sill and a plate, boards between, a brace outside; holes: [[u0, u1, y0, y1]] left open
  const L = B_C, H = B_WH, foot = pc.foot - pc.y;
  bFooting(b, Math.min(foot, -0.05), L, 0.3);
  for (const s of [-1, 1]) bBox(b, s * (L / 2 - 0.09), H / 2, 0, 0.18, H, 0.2, MAT.wood, B_COL.dark);
  bBox(b, 0, 0.07, 0, L, 0.14, 0.2, MAT.wood, B_COL.dark);
  bBox(b, 0, H - 0.08, 0, L, 0.16, 0.22, MAT.wood, B_COL.dark);
  // the boards: cut round the holes in vertical strips
  const u0 = -L / 2 + 0.18, u1 = L / 2 - 0.18, y0 = 0.14, y1 = H - 0.16;
  const xs = [u0, u1, ...holes.flatMap((h) => [h[0], h[1]])].sort((a, c) => a - c);
  for (let k = 0; k + 1 < xs.length; k++) {
    const a = xs[k], c = xs[k + 1];
    if (c - a < 0.02) continue;
    const mid = (a + c) / 2, hole = holes.find((h) => mid > h[0] && mid < h[1]);
    const spans = hole ? [[y0, hole[2]], [hole[3], y1]] : [[y0, y1]];
    for (const [ya, yb] of spans) if (yb - ya > 0.02) bBox(b, mid, (ya + yb) / 2, 0, c - a, yb - ya, 0.1, MAT.wood, B_COL.wood);
  }
  for (const h of holes) {
    // jambs and a lintel round each opening
    for (const u of [h[0], h[1]]) bBox(b, u, (h[2] + h[3]) / 2, 0, 0.1, h[3] - h[2], 0.2, MAT.wood, B_COL.dark);
    bBox(b, (h[0] + h[1]) / 2, h[3] + 0.06, 0, h[1] - h[0] + 0.2, 0.12, 0.22, MAT.wood, B_COL.dark);
    if (h[2] > 0.2) bBox(b, (h[0] + h[1]) / 2, h[2] - 0.04, 0.03, h[1] - h[0] + 0.16, 0.08, 0.28, MAT.wood, B_COL.dark);
  }
  // a brace on the outside where there is room for it
  if (!holes.length) for (const s of [-1, 1]) beam(b, B_ID, [s * 1.38, 0.2, 0.08], [s * 0.15, H - 0.25, 0.08], 0.05, MAT.wood, B_COL.dark);
}
const B_MODEL = {
  found(b, pc) {
    const foot = pc.foot - pc.y;
    bBox(b, 0, (foot - 0.12) / 2, 0, B_C, -foot - 0.12 + 0.02, B_C, MAT.drystone, B_COL.stone);
    bBox(b, 0, -0.06, 0, B_C - 0.02, 0.12, B_C - 0.02, MAT.wood, B_COL.fresh);
    for (const s of [-1, 1]) { bBox(b, 0, -0.1, s * (B_C / 2 - 0.08), B_C, 0.16, 0.16, MAT.wood, B_COL.dark); bBox(b, s * (B_C / 2 - 0.08), -0.1, 0, 0.16, 0.16, B_C - 0.3, MAT.wood, B_COL.dark); }
  },
  floor(b) {
    bBox(b, 0, -0.05, 0, B_C, 0.1, B_C, MAT.wood, B_COL.fresh);
    for (const z of [-1, 0, 1]) bBox(b, 0, -0.2, z * 1.2, B_C, 0.2, 0.14, MAT.wood, B_COL.dark);
  },
  wall(b, pc) { bTimberWall(b, pc, []); },
  door(b, pc) { bTimberWall(b, pc, [[-0.56, 0.56, 0, 2.12]]); },
  window(b, pc) {
    bTimberWall(b, pc, [[-0.46, 0.46, 0.95, 1.85]]);
    bBox(b, 0, 1.4, 0, 0.9, 0.9, 0.02, MAT.water, [0.1, 0.14, 0.16]);
    bBox(b, 0, 1.4, 0, 0.9, 0.03, 0.04, MAT.metal, B_COL.iron);
    bBox(b, 0, 1.4, 0, 0.03, 0.9, 0.04, MAT.metal, B_COL.iron);
  },
  wallStone(b, pc) {
    const foot = pc.foot - pc.y;
    bBox(b, 0, (B_WH + foot) / 2, 0, B_C + 0.05, B_WH - foot, 0.42, MAT.drystone, B_COL.stone);
    bBox(b, 0, B_WH + 0.06, 0, B_C + 0.1, 0.12, 0.48, MAT.stone, darker(B_COL.stone, 0.9));
  },
  roof(b, pc, thatch) {
    // a gable over the cell, ridge along x, its feet on the wall plates; boards and a tie beam inside
    const rise = 1.55, run = B_C / 2 + 0.32, pitch = Math.atan2(rise, B_C / 2), th = thatch ? 0.32 : 0.14;
    const m = thatch ? MAT.thatch : MAT.shingle, col = thatch ? B_COL.thatch : B_COL.shingle;
    const slope = run / Math.cos(pitch);
    for (const s of [-1, 1]) {
      const cz = s * (run / 2), cy = rise - (run / 2) * Math.tan(pitch) + th * 0.3;
      bBox(b, 0, cy, cz, B_C + (thatch ? 0.5 : 0.36), th, slope, m, col, 0, s * pitch);
      bBox(b, 0, cy - th * 0.6, cz * 0.98, B_C, 0.04, slope - 0.3, MAT.wood, B_COL.fresh, 0, s * pitch);
    }
    if (thatch) b.add(G.cyl8, lm(B_ID, 0, rise + 0.16, 0, 0, 0.2, B_C + 0.5, 0.17, 0, Math.PI / 2), m, darker(col, 0.82), 0, 3);
    else bBox(b, 0, rise + 0.08, 0, B_C + 0.36, 0.12, 0.22, MAT.wood, B_COL.dark);
    // the gable ends, closed with boards, and a tie beam across
    for (const s of [-1, 1]) b.add(G.prism, lm(B_ID, s * (B_C / 2 - 0.05), 0, 0, 0, 0.08, rise, B_C - 0.1), MAT.wood, B_COL.wood, 0, 3);
    bBox(b, 0, 0.06, 0, 0.16, 0.14, B_C, MAT.wood, B_COL.dark);
  },
  roofThatch(b, pc) { B_MODEL.roof(b, pc, true); },
  roofShingle(b, pc) { B_MODEL.roof(b, pc, false); },
  stairs(b) {
    // two strings and treads from the foot (-z) up to the landing (+z), one storey
    const n = 11, rise = B_WH / n, run = (B_C - 0.2) / n;
    for (const s of [-1, 1]) beam(b, B_ID, [s * 0.62, -0.05, -B_C / 2 + 0.05], [s * 0.62, B_WH - 0.1, B_C / 2 - 0.05], 0.07, MAT.wood, B_COL.dark, 0.14);
    for (let k = 0; k < n; k++) bBox(b, 0, (k + 1) * rise - 0.03, -B_C / 2 + 0.1 + (k + 0.5) * run, 1.3, 0.06, run + 0.04, MAT.wood, B_COL.fresh);
    for (const s of [-1, 1]) bBox(b, s * 0.62, 0.5, -B_C / 2 + 0.1, 0.1, 1.0, 0.1, MAT.wood, B_COL.dark);
  },
  fence(b, pc) {
    const foot = Math.min(-0.3, pc.foot - pc.y - 0.2);
    for (const x of [-1.45, 0, 1.45]) bBox(b, x, (1.1 + foot) / 2, 0, 0.11, 1.1 - foot, 0.11, MAT.wood, B_COL.dark);
    for (const y of [0.45, 0.88]) bBox(b, 0, y, 0.07, B_C, 0.09, 0.05, MAT.wood, B_COL.wood);
  },
  gate(b, pc) {
    const foot = Math.min(-0.4, pc.foot - pc.y - 0.2);
    for (const s of [-1, 1]) { bBox(b, s * 1.45, (1.35 + foot) / 2, 0, 0.16, 1.35 - foot, 0.16, MAT.wood, B_COL.dark); b.add(G.pyr, lm(B_ID, s * 1.45, 1.42, 0, 0, 0.13, 0.14, 0.13), MAT.wood, B_COL.dark, 0, 3); }
  },
  campfire(b) {
    for (let k = 0; k < 11; k++) { const a = (k / 11) * TAU; b.add(G.ico, lm(B_ID, Math.sin(a) * 0.55, 0.07, Math.cos(a) * 0.55, a * 3, 0.13 + 0.03 * Math.sin(k * 5), 0.1, 0.15), MAT.stone, darker(B_COL.stone, 0.85 + 0.2 * fhash(k)), 0, 1); }
    b.add(G.cyl16, lm(B_ID, 0, 0.02, 0, 0, 0.45, 0.03, 0.45), MAT.darkstone, [0.12, 0.1, 0.09], 0, 1);
    for (let k = 0; k < 4; k++) { const a = (k / 4) * TAU + 0.4; beam(b, B_ID, [Math.sin(a) * 0.4, 0.05, Math.cos(a) * 0.4], [Math.sin(a) * 0.05, 0.36, Math.cos(a) * 0.05], 0.05, MAT.logH, [0.3, 0.21, 0.13]); }
  },
  workbench(b) {
    bBox(b, 0, 0.84, 0, 1.7, 0.1, 0.8, MAT.wood, B_COL.fresh);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) bBox(b, sx * 0.75, 0.4, sz * 0.32, 0.12, 0.8, 0.12, MAT.wood, B_COL.dark);
    bBox(b, 0, 0.22, 0, 1.5, 0.05, 0.66, MAT.wood, B_COL.wood);
    for (let k = 0; k < 3; k++) bBox(b, -0.2 + k * 0.04, 0.28 + k * 0.05, 0, 1.2, 0.05, 0.22, MAT.wood, darker(B_COL.fresh, 0.95 + 0.05 * k));
    bBox(b, 0.7, 0.98, 0.3, 0.16, 0.18, 0.14, MAT.metal, B_COL.iron); // the vice
    bBox(b, -0.35, 0.9, 0.1, 0.62, 0.012, 0.14, MAT.metal, [0.6, 0.6, 0.62], 0.2); // a saw
    bBox(b, -0.62, 0.9, 0.25, 0.08, 0.03, 0.4, MAT.wood, B_COL.dark, 0.2);
    bBox(b, 0.25, 0.92, -0.15, 0.1, 0.06, 0.32, MAT.wood, B_COL.dark, -0.5); // a hammer
    bBox(b, 0.3, 0.94, -0.28, 0.18, 0.07, 0.07, MAT.metal, B_COL.iron, -0.5);
  },
  bed(b) { bRoomItem(b, 'bed'); },
  chest(b) { bRoomItem(b, 'chest'); },
};
// the furniture of the houses, drawn into a builder's batch
function bRoomItem(b, type) {
  const ctx = { f: b, b, st: STYLE.timber, wool: ROOM.wool[1], rnd: mulberry(7), R: REALMS[0], H: { y: 0 } };
  ROOM_ITEMS[type](ctx, { type, x: 0, z: 0, yaw: 0 }, B_ID);
}
// the moving parts: [hinge x, hinge z, swing (radians when fully open), builder(b) in the hinge's frame]
const B_LEAVES = {
  door: () => [[-0.55, 0, 1.65, (b) => {
    bBox(b, 0.545, 1.04, 0, 1.08, 2.06, 0.07, MAT.wood, B_COL.wood);
    for (const y of [0.35, 1.7]) bBox(b, 0.5, y, 0.045, 0.9, 0.07, 0.02, MAT.metal, B_COL.iron);
    beam(b, B_ID, [0.15, 0.4, 0.045], [0.95, 1.65, 0.045], 0.03, MAT.wood, B_COL.dark);
    b.add(G.ico, lm(B_ID, 0.95, 1.05, 0.06, 0, 0.035, 0.035, 0.035), MAT.metal, B_COL.iron, 0, 3);
  }]],
  window: () => [-1, 1].map((s) => [s * 0.47, 0.12, s * 2.9, (b) => {
    bBox(b, -s * 0.23, 1.4, 0.02, 0.44, 0.9, 0.05, MAT.wood, darker(B_COL.wood, 0.85));
    for (const y of [1.08, 1.72]) bBox(b, -s * 0.23, y, 0.05, 0.4, 0.06, 0.02, MAT.wood, B_COL.dark);
  }]),
  gate: () => [[-1.36, 0, 1.6, (b) => {
    for (const y of [0.25, 0.68, 1.1]) bBox(b, 1.36, y, 0, 2.62, 0.1, 0.06, MAT.wood, B_COL.wood);
    for (const x of [0.12, 1.36, 2.6]) bBox(b, x, 0.68, 0, 0.09, 1.0, 0.07, MAT.wood, B_COL.dark);
    beam(b, B_ID, [0.15, 0.28, 0.04], [2.55, 1.06, 0.04], 0.035, MAT.wood, B_COL.dark);
  }]],
};
function bGeometry(pc) {
  const b = new Batch();
  B_MODEL[pc.t](b, pc);
  const leaves = (B_LEAVES[pc.t] ? B_LEAVES[pc.t]() : []).map(([hx, hz, swing, fn]) => { const lb = new Batch(); fn(lb); return { hx, hz, swing, geo: lb.build() }; });
  return { geo: b.build(), leaves };
}

/* ------------------------------------------------------------------ */
/* the grid: every piece of a building shares its first piece's frame */
/* ------------------------------------------------------------------ */
const bW = (f, u, v) => ({ x: f.fx + u * Math.cos(f.fyaw) + v * Math.sin(f.fyaw), z: f.fz - u * Math.sin(f.fyaw) + v * Math.cos(f.fyaw) });
const bL = (f, x, z) => { const dx = x - f.fx, dz = z - f.fz, c = Math.cos(f.fyaw), s = Math.sin(f.fyaw); return { u: dx * c - dz * s, v: dx * s + dz * c }; };
// ground heights under a footprint (a local box of half sizes hx, hz at yaw), sampled on a coarse grid
function bGround(x, z, hx, hz, yaw) {
  let lo = Infinity, hi = -Infinity;
  const c = Math.cos(yaw), s = Math.sin(yaw);
  for (const a of [-1, -0.5, 0, 0.5, 1]) for (const d of [-1, 0, 1]) {
    const lx = a * hx, lz = d * hz, y = heightAt(x + lx * c + lz * s, z - lx * s + lz * c);
    lo = Math.min(lo, y); hi = Math.max(hi, y);
  }
  return { lo, hi };
}
const bSlot = (pc) => `${pc.frame}|${pc.e}|${pc.i}|${pc.j}|${Math.round(pc.y * 2)}`;
// the footprint of a piece in its own frame (half sizes) for colliders, the cover map and overlap tests
function bFoot(t) {
  const D = BP[t];
  if (t === 'found' || t === 'floor' || D.roof) return [B_C / 2, B_C / 2];
  if (t === 'stairs') return [0.7, B_C / 2];
  if (D.kind === 'edge') return [B_C / 2, t === 'wallStone' ? 0.22 : 0.12];
  if (t === 'campfire') return [0.7, 0.7];
  return [D.hx, D.hz];
}
// where a piece of type t would go for a cursor at (x, z): its frame, grid place, height, yaw, and why not
function bSnap(t, x, z, rot, P) {
  const D = BP[t], out = { t, ok: true, why: '' };
  // the frame of the nearest building (its first piece's grid), or a new one here, turned by R
  let near = null, nd = 7 * 7;
  for (const pc of BUILD.pieces) { if (BP[pc.t].kind === 'free' || pc.st === 'gone') continue; const d = dist2(x, z, pc.x, pc.z); if (d < nd) { nd = d; near = pc; } }
  if (D.kind === 'free') {
    out.frame = 0; out.fx = x; out.fz = z; out.fyaw = 0; out.i = 0; out.j = 0; out.e = 'f';
    out.x = x; out.z = z; out.yaw = (P ? P.yaw + Math.PI : 0) + rot * (Math.PI / 8);
    // on the floor at the level the builder stands on (a foundation, an upper floor, or the ground)
    out.y = floorAt(x, z, (P ? Math.max(P.y, heightAt(x, z)) : heightAt(x, z)) + 0.6); out.foot = out.y;
    if (out.y <= heightAt(x, z) + 0.01) { const g = bGround(x, z, 0.6, 0.6, out.yaw); if (g.hi - g.lo > 0.6) { out.ok = false; out.why = 'The ground is too steep here'; } }
    return out;
  }
  const f = near ? { frame: near.frame, fx: near.fx, fz: near.fz, fyaw: near.fyaw } : { frame: BUILD.next, fx: x, fz: z, fyaw: Math.round(((P ? CAM.yaw : 0) + rot * Math.PI / 12) / (Math.PI / 12)) * (Math.PI / 12) };
  Object.assign(out, f);
  const l = bL(f, x, z);
  if (D.kind === 'cell') {
    out.i = Math.round(l.u / B_C); out.j = Math.round(l.v / B_C); out.e = 'c';
    const w = bW(f, out.i * B_C, out.j * B_C);
    out.x = w.x; out.z = w.z; out.yaw = f.fyaw + (near ? rot : 0) * (Math.PI / 2);
  } else {
    const ix = Math.round(l.u / B_C), jx = Math.round((l.v - B_C / 2) / B_C), dX = Math.hypot(l.u - ix * B_C, l.v - (jx * B_C + B_C / 2));
    const iz = Math.round((l.u - B_C / 2) / B_C), jz = Math.round(l.v / B_C), dZ = Math.hypot(l.u - (iz * B_C + B_C / 2), l.v - jz * B_C);
    const flip = (rot % 2 + 2) % 2 === 1 ? Math.PI : 0;
    if (dX <= dZ) { out.e = 'x'; out.i = ix; out.j = jx; const w = bW(f, ix * B_C, jx * B_C + B_C / 2); out.x = w.x; out.z = w.z; out.yaw = f.fyaw; }
    else { out.e = 'z'; out.i = iz; out.j = jz; const w = bW(f, iz * B_C + B_C / 2, jz * B_C); out.x = w.x; out.z = w.z; out.yaw = f.fyaw + Math.PI / 2; }
    // which side is outside (+z): the side with no floor, if only one side has one; else, for a door or a gate, the
    // builder's side, so it opens away from them. R turns it about.
    const plus = out.e === 'x' ? [out.i, out.j + 1] : [out.i + 1, out.j], minus = [out.i, out.j];
    const floored = ([i, j]) => BUILD.pieces.some((pc) => pc.frame === f.frame && pc.e === 'c' && pc.i === i && pc.j === j && (pc.t === 'found' || pc.t === 'floor') && pc.st !== 'gone');
    const fp = floored(plus), fm = floored(minus);
    if (fp !== fm) { if (fp) out.yaw += Math.PI; }
    else if (P && (t === 'door' || t === 'gate' || t === 'window')) {
      const side = (P.x - out.x) * Math.sin(out.yaw) + (P.z - out.z) * Math.cos(out.yaw);
      if (side < 0) out.yaw += Math.PI;
    }
    out.yaw += flip;
  }
  // heights
  const [hx, hz] = bFoot(t), g = bGround(out.x, out.z, hx, hz, out.yaw);
  const same = (pc) => pc.frame === out.frame && pc.st !== 'gone';
  const cellPieceAt = (i, j, types) => BUILD.pieces.filter((pc) => same(pc) && pc.e === 'c' && pc.i === i && pc.j === j && types.includes(pc.t) && pc.st !== 'ruin');
  // the cells on either side of an edge
  const sides = out.e === 'x' ? [[out.i, out.j], [out.i, out.j + 1]] : out.e === 'z' ? [[out.i, out.j], [out.i + 1, out.j]] : [];
  const wallsOf = (i, j) => BUILD.pieces.filter((pc) => same(pc) && pc.st === 'built' && ['wall', 'door', 'window', 'wallStone'].includes(pc.t) &&
    ((pc.e === 'x' && pc.i === i && (pc.j === j || pc.j === j - 1)) || (pc.e === 'z' && pc.j === j && (pc.i === i || pc.i === i - 1))));
  if (t === 'found') {
    const nb = BUILD.pieces.find((pc) => same(pc) && pc.t === 'found' && Math.abs(pc.i - out.i) + Math.abs(pc.j - out.j) === 1);
    out.y = nb ? nb.y : g.hi + 0.3;
    if (nb && g.hi > out.y - 0.08) out.y = g.hi + 0.3;
    out.foot = g.lo - 0.25;
    if (g.hi - g.lo > 2.2) { out.ok = false; out.why = 'The ground is too steep here'; }
  } else if (t === 'floor') {
    const ws = wallsOf(out.i, out.j);
    if (!ws.length) { out.ok = false; out.why = 'A floor rests on walls'; out.y = g.hi + B_WH; }
    else out.y = Math.max(...ws.map((w) => w.y + B_WH));
    out.foot = out.y;
  } else if (D.roof) {
    const ws = wallsOf(out.i, out.j);
    const nr = BUILD.pieces.find((pc) => same(pc) && BP[pc.t].roof && pc.st === 'built' && Math.abs(pc.i - out.i) + Math.abs(pc.j - out.j) === 1);
    if (ws.length) out.y = Math.max(...ws.map((w) => w.y + B_WH));
    else if (nr) out.y = nr.y;
    else { out.ok = false; out.why = 'A roof rests on walls'; out.y = g.hi + B_WH; }
    out.foot = out.y;
  } else if (t === 'stairs') {
    const under = cellPieceAt(out.i, out.j, ['found', 'floor'])[0];
    out.y = under ? under.y : g.hi + 0.02; out.foot = under ? under.y : g.lo - 0.1;
    if (!under && g.hi - g.lo > 0.8) { out.ok = false; out.why = 'The ground is too steep for a stair'; }
  } else {
    // an edge: on the floor of a cell beside it (the lowest level still free), else on the ground
    const levels = [...new Set(sides.flatMap(([i, j]) => cellPieceAt(i, j, D.ground ? [] : ['found', 'floor']).map((pc) => +pc.y.toFixed(2))))].sort((a, c) => a - c);
    let y = null;
    for (const lv of levels) if (!BUILD.pieces.some((pc) => same(pc) && pc.e === out.e && pc.i === out.i && pc.j === out.j && Math.abs(pc.y - lv) < 0.3 && pc.st !== 'gone')) { y = lv; break; }
    if (y === null) {
      y = D.ground ? heightAt(out.x, out.z) : g.hi;
      if (!D.ground && levels.length) { out.ok = false; out.why = 'There is a wall here already'; }
      if (g.hi - g.lo > (D.ground ? 1.2 : 0.9)) { out.ok = false; out.why = 'The ground is too steep here'; }
      out.foot = Math.min(y, g.lo - 0.15);
    } else out.foot = y; // on a floor: no footing of its own
    out.y = y;
  }
  return out;
}
// is (x, z) on a cell piece's floor (grown by m)
function bInside(pc, x, z, m = 0) {
  const [hx, hz] = bFoot(pc.t), dx = x - pc.x, dz = z - pc.z, c = Math.cos(pc.yaw), s = Math.sin(pc.yaw);
  return Math.abs(dx * c - dz * s) <= hx + m && Math.abs(dx * s + dz * c) <= hz + m;
}
// may it go here: the land, what is already there, the goods and the hammer
function bLandWhy(x, z, P) {
  if (x > DUN_X0 - 60) return 'You cannot build here';
  const zn = zoneAt(x, z);
  if (zn.kind !== 'home' && zn.kind !== 'frontier') return `You cannot build in ${zn.name}`;
  if (zn.realm !== P.faction) return zn.realm >= 0 && zn.realm <= 2 ? `These are ${REALMS[zn.realm].name}'s lands` : 'You may build only on your own realm\'s lands';
  for (const S of SITES) if (dist2(x, z, S.x, S.z) < (S.r + 10) ** 2) return `Too near ${S.name}`;
  if (dist2(x, z, BARROW.x, BARROW.z) < (BARROW.r + 14) ** 2) return 'Too near the Barrow';
  for (const c of CAMPS) if (dist2(x, z, c.x, c.z) < 24 * 24) return 'Too near a camp of wild things';
  if (heightAt(x, z) < WATER_Y + 0.35 || (typeof waterAt === 'function' && waterAt(x, z))) return 'Not in the water'; // eslint-disable-line no-undef -- waterAt comes with feature/water
  if (sampleGrid(W.road, x, z) > 0.18) return 'Not on the road';
  return null;
}
const _bn = [];
function bValidate(sn, P) {
  const t = sn.t, D = BP[t];
  if (!sn.ok) return sn;
  const fail = (why) => { sn.ok = false; sn.why = why; return sn; };
  if (P && dist(P.x, P.z, sn.x, sn.z) > B_REACH + 2) return fail('Too far away');
  const [hx, hz] = bFoot(t), c = Math.cos(sn.yaw), s = Math.sin(sn.yaw);
  for (const [a, d] of [[0, 0], [1, 1], [-1, 1], [1, -1], [-1, -1]]) { const w = bLandWhy(sn.x + a * hx * c + d * hz * s, sn.z - a * hx * s + d * hz * c, P); if (w) return fail(w); }
  // nothing of the world in the way (walls, houses, trees, rocks, props); its own building is checked by its grid
  collidersNear(sn.x, sn.z, Math.hypot(hx, hz) + 4, _bn);
  const ix = Math.max(1, Math.ceil(hx / 0.75)), iz = Math.max(1, Math.ceil(hz / 0.75));
  for (const cl of _bn) {
    if (!cl.active || (cl.build && (cl.build.frame === sn.frame && D.kind !== 'free')) || cl.tag === 'build-floor') continue;
    if (cl.build && D.kind === 'free' && !['wall', 'door', 'window', 'wallStone', 'fence', 'gate', 'workbench', 'bed', 'chest', 'campfire'].includes(cl.build.t)) continue;
    if (D.roof || t === 'floor') { if (!cl.build) { const top = (cl.y0 != null ? cl.y0 : cl.baseY) + cl.h; if (top < sn.y + 0.1) continue; } else continue; }
    for (let a = -ix; a <= ix; a++) for (let d = -iz; d <= iz; d++) {
      const lx = (a / ix) * (hx - 0.12), lz = (d / iz) * (hz - 0.08);
      if (collCovers(cl, sn.x + lx * c + lz * s, sn.z - lx * s + lz * c, cl.tag === 'tree' ? 0.25 : 0.06)) return fail(cl.tag === 'tree' ? (cl.stump ? 'A stump is in the way' : 'A tree is in the way: fell it first') : cl.build ? 'Something you built is in the way' : 'Something is in the way');
    }
  }
  if (houseAt(sn.x, sn.z, 1)) return fail('A house is in the way');
  // the same place in the same building is taken
  if (D.kind !== 'free') {
    const key = bSlot(sn);
    if (BUILD.pieces.some((pc) => pc.st !== 'gone' && bSlot(pc) === key && (BP[pc.t].kind === D.kind) && (D.roof === BP[pc.t].roof))) return fail('There is something here already');
    if (D.kind === 'cell' && !D.roof && BUILD.pieces.some((pc) => pc.st !== 'gone' && pc.frame === sn.frame && pc.e === 'c' && pc.i === sn.i && pc.j === sn.j && !BP[pc.t].roof && Math.abs(pc.y - sn.y) < 1.0 && pc.t !== t && !(t === 'stairs' && pc.t === 'found'))) return fail('There is something here already');
  }
  if (BUILD.pieces.length >= B_MAX) return fail('You have built as much as the land will bear here');
  return sn;
}

/* ------------------------------------------------------------------ */
/* making, showing and unmaking pieces                                 */
/* ------------------------------------------------------------------ */
function bMakePiece(o) {
  const pc = {
    id: o.id || BUILD.next++, t: o.t, x: o.x, z: o.z, y: o.y, foot: o.foot ?? o.y, yaw: o.yaw, frame: o.frame || 0, fx: o.fx ?? o.x, fz: o.fz ?? o.z, fyaw: o.fyaw ?? 0,
    i: o.i | 0, j: o.j | 0, e: o.e || 'f', st: o.st || 'build', p: o.p ?? 0, char: o.char || 0, open: o.open ?? (o.t === 'window' ? 1 : 0), lit: !!o.lit, store: o.store || null,
    coll: [], floors: [], leaves: [], fire: null, burnT: 0, shelter: 0,
  };
  if (pc.frame === 0 && BP[pc.t].kind !== 'free') pc.frame = pc.id;
  BUILD.next = Math.max(BUILD.next, pc.id + 1);
  bShow(pc);
  BUILD.pieces.push(pc);
  bApplyState(pc);
  return pc;
}
function bShow(pc) {
  const { geo, leaves } = bGeometry(pc);
  const m = shareMat(B_MAT, { uRise: { value: 99 }, uPc: { value: new THREE.Vector4() } });
  const mesh = new THREE.Mesh(geo, m);
  mesh.position.set(pc.x, pc.y, pc.z);
  mesh.rotation.y = pc.yaw;
  mesh.renderOrder = 1;
  geo.computeBoundingBox();
  pc.minY = geo.boundingBox.min.y; pc.maxY = Math.max(geo.boundingBox.max.y, ...leaves.map((L) => { L.geo.computeBoundingBox(); return L.geo.boundingBox.max.y; }));
  const dm = depthFrom(m);
  pc.mesh = mesh; pc.mat = m; pc.proxies = [shadowCaster(mesh, dm)];
  for (const L of leaves) {
    const pivot = new THREE.Object3D();
    pivot.position.set(L.hx, 0, L.hz);
    const lm2 = new THREE.Mesh(L.geo, m);
    lm2.renderOrder = 1;
    pivot.add(lm2);
    mesh.add(pivot);
    pc.leaves.push({ pivot, swing: L.swing, open: pc.open });
    pc.proxies.push(shadowCaster(lm2, dm));
  }
  scene.add(mesh);
}
function bHide(pc) {
  if (!pc.mesh) return;
  scene.remove(pc.mesh);
  for (const px of pc.proxies || []) { if (!px) continue; SHADOW.scene.remove(px); const k = SHADOW.proxies.indexOf(px); if (k >= 0) SHADOW.proxies.splice(k, 1); }
  pc.mesh.geometry.dispose();
  for (const L of pc.leaves) L.pivot.children[0].geometry.dispose();
  pc.mat.dispose();
  pc.mesh = null; pc.leaves = []; pc.proxies = [];
}
// colliders and floors come and go with a piece's state
function bCollRemove(c) {
  const arr = c.type === 'box' ? COLL.boxes : COLL.circles, k = arr.indexOf(c);
  if (k >= 0) arr.splice(k, 1);
  const r = c.type === 'box' ? Math.hypot(c.hx, c.hz) : c.r, s = COLL.cell;
  for (let cx = Math.floor((c.x - r) / s); cx <= Math.floor((c.x + r) / s); cx++) for (let cz = Math.floor((c.z - r) / s); cz <= Math.floor((c.z + r) / s); cz++) {
    const l = COLL.grid.get(collKey(cx, cz));
    if (l) { const q = l.indexOf(c); if (q >= 0) l.splice(q, 1); }
  }
}
function bFloorRemove(f) {
  const k = FLOOR.list.indexOf(f);
  if (k >= 0) FLOOR.list.splice(k, 1);
  const rr = f.type === 'disc' ? f.r : Math.hypot(f.hx, f.hz), s = FLOOR.cell;
  for (let cx = Math.floor((f.x - rr) / s); cx <= Math.floor((f.x + rr) / s); cx++) for (let cz = Math.floor((f.z - rr) / s); cz <= Math.floor((f.z + rr) / s); cz++) {
    const l = FLOOR.grid.get(collKey(cx, cz));
    if (l) { const q = l.indexOf(f); if (q >= 0) l.splice(q, 1); }
  }
}
// a point in a piece's frame -> world
function bPW(pc, lx, lz) { const c = Math.cos(pc.yaw), s = Math.sin(pc.yaw); return { x: pc.x + lx * c + lz * s, z: pc.z - lx * s + lz * c }; }
function bAddColl(pc, lx, lz, hx, hz, h, tag = 'build', y0 = null) {
  const p = bPW(pc, lx, lz), c = addBox(p.x, p.z, hx, hz, pc.yaw, tag, h);
  c.build = pc;
  if (y0 !== null) { c.vert = true; c.y0 = y0; }
  pc.coll.push(c);
  return c;
}
function bMakeSolid(pc) {
  bDropSolid(pc);
  const t = pc.t, y = pc.y, raised = y > heightAt(pc.x, pc.z) + 0.4;
  if (t === 'found') pc.floors.push(addFloorBox(pc.x, pc.z, B_C / 2, B_C / 2, pc.yaw, y, y, pc.foot, 0, 'build'));
  else if (t === 'floor') pc.floors.push(addFloorBox(pc.x, pc.z, B_C / 2, B_C / 2, pc.yaw, y, y, y - 0.3, 0.3, 'build'));
  else if (t === 'stairs') pc.floors.push(addFloorBox(pc.x, pc.z, 0.68, B_C / 2, pc.yaw, y + 0.1, y + B_WH, y, 0.35, 'build'));
  else if (t === 'wall' || t === 'window') bAddColl(pc, 0, 0, B_C / 2, 0.12, B_WH, 'build', y);
  else if (t === 'wallStone') bAddColl(pc, 0, 0, B_C / 2 + 0.02, 0.22, B_WH + 0.1, 'build', y);
  else if (t === 'door') {
    for (const s of [-1, 1]) bAddColl(pc, s * 1.03, 0, 0.47, 0.12, B_WH, 'build', y);
    bAddColl(pc, 0, 0, 0.58, 0.12, 0.72, 'build', y + 2.12); // the lintel and wall above the doorway
    pc.leafColl = bAddColl(pc, 0, 0, 0.56, 0.1, 2.15, 'build', y);
  } else if (t === 'fence') bAddColl(pc, 0, 0, B_C / 2, 0.08, 1.1, 'build', raised ? y : null);
  else if (t === 'gate') {
    for (const s of [-1, 1]) bAddColl(pc, s * 1.45, 0, 0.1, 0.1, 1.35, 'build');
    pc.leafColl = bAddColl(pc, 0, 0, 1.35, 0.07, 1.25, 'build');
  } else if (BP[t].kind === 'free') {
    const [hx, hz] = bFoot(t);
    bAddColl(pc, 0, 0, hx, hz, t === 'campfire' ? 0.5 : 1.0, 'build', y > heightAt(pc.x, pc.z) + 0.2 ? y : null);
  }
  if (pc.leafColl) pc.leafColl.active = pc.open < 0.3;
  // nothing grows up through what is built: the 1 m cover map under its footprint, sent again this frame
  if (!BP[t].roof && t !== 'floor' && pc.foot < heightAt(pc.x, pc.z) + 1.2) {
    const [hx, hz] = bFoot(t);
    coverMarkBox(pc.x, pc.z, hx, hz, pc.yaw, 0.3);
  }
  BUILD.roofsDirty = true;
}
function bDropSolid(pc) {
  for (const c of pc.coll) bCollRemove(c);
  for (const f of pc.floors) bFloorRemove(f);
  pc.coll = []; pc.floors = []; pc.leafColl = null;
}
// what each state looks like and what it does
function bApplyState(pc) {
  if (pc.st === 'built' || pc.st === 'burning') { if (!pc.coll.length && !pc.floors.length) bMakeSolid(pc); }
  else if (pc.st === 'ruin' && pc.t === 'found') { if (!pc.floors.length) bMakeSolid(pc); }
  else bDropSolid(pc);
  if (pc.t === 'campfire') bCampfire(pc, pc.st === 'built' && pc.lit);
  else if (pc.st !== 'burning' && pc.fire) { houseFireOut(pc.fire); pc.fire = null; }
  // a fallen roof or floor lies in a charred heap on the floor below
  if (pc.mesh) pc.mesh.position.y = pc.st === 'ruin' && (BP[pc.t].roof || pc.t === 'floor') ? floorAt(pc.x, pc.z, pc.y - B_WH + 0.4) + 0.04 : pc.y;
  bUniforms(pc);
  BUILD.roofsDirty = true;
}
function bUniforms(pc) {
  if (!pc.mat) return;
  const span = pc.maxY - pc.minY;
  let rise = 99;
  if (pc.st === 'build') rise = pc.minY + span * (0.04 + 0.96 * pc.p);
  else if (pc.st === 'ruin') rise = pc.t === 'found' ? -0.02 : pc.minY + Math.max(0.3, span * 0.22);
  pc.mat.uniforms.uRise.value = rise;
  pc.mat.uniforms.uPc.value.set(0, pc.st === 'ruin' ? (BP[pc.t].burn ? 1 : 0.6) : pc.char, pc.st === 'burning' ? 0.4 + pc.char : pc.st === 'ruin' ? Math.max(0, 0.6 - (pc.cool || 0) / 40) : 0, pc.shelter);
}
function bCampfire(pc, on) {
  if (on && !pc.fire) pc.fire = houseFireAdd(pc.x, pc.y + 0.22, pc.z, 0.55, { r: 7, k: 1 });
  else if (!on && pc.fire) { houseFireOut(pc.fire); pc.fire = null; }
}

/* ------------------------------------------------------------------ */
/* placing                                                             */
/* ------------------------------------------------------------------ */
function buildPlace(t, x, z, rot = 0, opts = {}) {
  const P = GAME.player;
  if (!P || !BP[t]) return { ok: false, why: 'Nothing to build' };
  const sn = bValidate(bSnap(t, x, z, rot, P), P);
  if (!sn.ok) return sn;
  if (!opts.free) {
    if (!bHasHammer()) return { ok: false, why: 'You need a hammer to build (the stores of your keeps sell them)' };
    if (!goodsTakeAll(bpCost(t))) return { ok: false, why: `You need ${bpCostText(bpCost(t))}` };
  }
  const pc = bMakePiece({ ...sn, st: opts.built ? 'built' : 'build', p: opts.built ? 1 : 0 });
  if (pc.st === 'built') bApplyState(pc);
  if (!opts.quiet) { houseSfx('hammer', pc.x, pc.y + 1, pc.z); FX.burst(pc.x, pc.y + 0.3, pc.z, 14, [0.6, 0.5, 0.36], 2, 0.6, 0.15, 1); }
  if (!opts.built) BUILD.work = { pc, x: P.x, z: P.z, t: 0, auto: true };
  saveSoon();
  return { ok: true, pc };
}
// raise a piece: work with the hammer (dt seconds); returns true when it stands finished
function bWork(pc, dt) {
  const P = GAME.player;
  const time = BP[pc.t].time * (pc.repair ? 0.6 : 1);
  const was = pc.p;
  pc.p = Math.min(1, pc.p + dt / time);
  if (pc.repair) pc.char = pc.repair.char * (1 - pc.p);
  if (Math.floor(was * time / 0.5) !== Math.floor(pc.p * time / 0.5)) {
    houseSfx('hammer', pc.x, pc.y + 1, pc.z);
    if (P) { setAct(P, 1, 0.42); faceToward(P, pc.x, pc.z); }
    FX.burst(pc.x + (Math.random() - 0.5) * 1.5, pc.y + (pc.maxY - pc.minY) * pc.p * 0.8, pc.z + (Math.random() - 0.5) * 1.5, 6, [0.66, 0.54, 0.38], 1.6, 0.5, 0.12, 1);
  }
  if (pc.p >= 1) {
    pc.st = 'built'; pc.p = 1; pc.char = 0; pc.repair = null;
    bApplyState(pc);
    bShelterAll();
    uiLog(`${BP[pc.t].name} built.`, 'loot');
    saveSoon();
    return true;
  }
  bUniforms(pc);
  return false;
}
function bNearestUnfinished(x, z, r) {
  let best = null, bd = r * r;
  for (const pc of BUILD.pieces) if (pc.st === 'build') { const d = dist2(x, z, pc.x, pc.z); if (d < bd) { bd = d; best = pc; } }
  return best;
}
// pull a piece down: half its goods come back (all of them if it was never finished)
function buildDemolish(pc, refund = true) {
  if (!pc || pc.st === 'gone') return false;
  if (refund) {
    const k = pc.st === 'build' && pc.p < 0.05 ? 1 : pc.st === 'ruin' ? 0.25 : 0.5;
    for (const [id, n] of bpCost(pc.t)) { const m = Math.floor(n * k); if (m > 0) goodsAdd(id, m, true); }
    if (pc.store) for (const id in pc.store) goodsAdd(id, pc.store[id], true);
    uiLog(`You pull down the ${BP[pc.t].name.toLowerCase()} and keep what can be saved.`, 'sys');
  }
  pc.st = 'gone';
  bDropSolid(pc);
  if (pc.fire) { houseFireOut(pc.fire); pc.fire = null; }
  bHide(pc);
  BUILD.pieces.splice(BUILD.pieces.indexOf(pc), 1);
  if (BUILD.work && BUILD.work.pc === pc) BUILD.work = null;
  if (BUILD.bed === pc.id) BUILD.bed = 0;
  FX.burst(pc.x, pc.y + 0.8, pc.z, 22, [0.5, 0.45, 0.38], 3, 0.8, 0.3, 1);
  houseSfx('collapse', pc.x, pc.y + 1, pc.z);
  bSupport();
  buildCoverMask(); // the ground under it can grow again
  saveSoon();
  return true;
}
// nothing floats: a roof or floor with no standing wall under it falls; what stood on a fallen floor drops
function bSupport() {
  let changed = true, guard = 0;
  while (changed && guard++ < 8) {
    changed = false;
    for (const pc of BUILD.pieces) {
      if (pc.st === 'ruin' || pc.st === 'gone') continue;
      const D = BP[pc.t];
      if (D.roof || pc.t === 'floor') {
        const walls = BUILD.pieces.some((w) => w.frame === pc.frame && (w.st === 'built' || w.st === 'burning') && ['wall', 'door', 'window', 'wallStone'].includes(w.t) && Math.abs(w.y + B_WH - pc.y) < 0.3 &&
          ((w.e === 'x' && w.i === pc.i && (w.j === pc.j || w.j === pc.j - 1)) || (w.e === 'z' && w.j === pc.j && (w.i === pc.i || w.i === pc.i - 1))));
        const nb = D.roof && BUILD.pieces.some((r) => r !== pc && r.frame === pc.frame && BP[r.t].roof && (r.st === 'built' || r.st === 'burning') && r.restsOnWall && Math.abs(r.i - pc.i) + Math.abs(r.j - pc.j) === 1);
        pc.restsOnWall = walls;
        if (!walls && !nb && pc.st !== 'build') { bFall(pc); changed = true; }
      } else if (D.kind === 'free' && pc.y > heightAt(pc.x, pc.z) + 0.2) {
        const under = BUILD.pieces.some((f) => (f.t === 'found' || f.t === 'floor') && f.st !== 'gone' && (f.st !== 'ruin' || f.t === 'found') && Math.abs(f.y - pc.y) < 0.2 && bInside(f, pc.x, pc.z, 0.05));
        if (!under) { pc.y = floorAt(pc.x, pc.z, pc.y); if (pc.mesh) pc.mesh.position.y = pc.y; bMakeSolid(pc); changed = true; }
      }
    }
  }
}
function bFall(pc) {
  pc.st = 'ruin'; pc.cool = 0;
  if (pc.fire) { houseFireOut(pc.fire); pc.fire = null; }
  bApplyState(pc);
  houseSfx('collapse', pc.x, pc.y + 1, pc.z);
  FX.burst(pc.x, pc.y + 1, pc.z, 30, [0.3, 0.26, 0.22], 3.5, 0.9, 0.35, 1);
}

/* ------------------------------------------------------------------ */
/* fire                                                                */
/* ------------------------------------------------------------------ */
function buildIgnite(pc) {
  if (!pc || pc.st !== 'built' || !BP[pc.t].burn) return false;
  pc.st = 'burning'; pc.burnT = 0;
  pc.burnDur = (BP[pc.t].burn === 2 ? 15 : 26) * (0.85 + Math.random() * 0.3);
  const top = pc.y + (pc.maxY - pc.minY) * 0.55;
  pc.fire = houseFireAdd(pc.x, top, pc.z, BP[pc.t].roof ? 1.1 : 0.8, { r: 7, k: 0.8 });
  houseSfx('ignite', pc.x, top, pc.z);
  const P = GAME.player;
  if (P && dist2(P.x, P.z, pc.x, pc.z) < 90 * 90) uiLog(`Your ${BP[pc.t].name.toLowerCase()} has caught fire!`, 'warn');
  bApplyState(pc);
  return true;
}
function buildFireAt(x, y, z, r = 1) {
  let n = 0;
  for (const pc of BUILD.pieces) {
    if (pc.st !== 'built' || !BP[pc.t].burn) continue;
    const [hx, hz] = bFoot(pc.t);
    if (dist2(x, z, pc.x, pc.z) > (Math.hypot(hx, hz) + r + 0.8) ** 2) continue;
    if (y > pc.y + pc.maxY + 1.5 || y < pc.y + pc.minY - 2) continue;
    if (buildIgnite(pc)) n++;
  }
  return n;
}
function buildFireCone(x, z, dx, dz, range, half) {
  let n = 0;
  for (const pc of BUILD.pieces) {
    if (pc.st !== 'built' || !BP[pc.t].burn) continue;
    const ox = pc.x - x, oz = pc.z - z, d = Math.hypot(ox, oz);
    if (d > range + 1 || (d > 1.2 && (ox * dx + oz * dz) / d < Math.cos(half))) continue;
    if (buildIgnite(pc)) n++;
  }
  return n;
}
// a burning brand held up to wood the player built (09d_brand.js asks)
function buildBrandTarget(P, ax, az) {
  let best = null, bd = 2.2;
  for (const pc of BUILD.pieces) {
    if (pc.st !== 'built' || !BP[pc.t].burn || Math.abs(P.y - pc.y) > 3.2) continue;
    const [hx, hz] = bFoot(pc.t), dx = ax - pc.x, dz = az - pc.z, c = Math.cos(pc.yaw), s = Math.sin(pc.yaw);
    const lx = Math.abs(dx * c - dz * s) - hx, lz = Math.abs(dx * s + dz * c) - hz, d = Math.hypot(Math.max(0, lx), Math.max(0, lz));
    if (d < bd) { bd = d; best = pc; }
  }
  return best ? { kind: 'build', pc: best, x: best.x, z: best.z, label: `Set the ${BP[best.t].name.toLowerCase()} alight`, d: bd } : null;
}
function bBurnStep(pc, dt) {
  const rain = Math.max(0, WEATHER.raining - WEATHER.snowing);
  pc.burnT += dt * (1 - 0.45 * rain * (1 - pc.shelter));
  pc.char = Math.min(1, pc.burnT / pc.burnDur);
  if (pc.fire) { pc.fire.size = (BP[pc.t].roof ? 1.1 : 0.8) * (0.6 + 0.8 * Math.sin(Math.PI * Math.min(1, pc.char * 1.1))); }
  // the fire spreads to what touches it
  pc.spreadT = (pc.spreadT || 0) + dt;
  if (pc.spreadT > 1.5) {
    pc.spreadT = 0;
    for (const o of BUILD.pieces) {
      if (o === pc || o.st !== 'built' || !BP[o.t].burn) continue;
      if (dist2(o.x, o.z, pc.x, pc.z) > 3.5 * 3.5 || Math.abs(o.y - pc.y) > B_WH + 0.5) continue;
      if (Math.random() < 0.2 * (BP[o.t].burn === 2 ? 2 : 1) * (1 - 0.6 * rain * (1 - o.shelter)) * (pc.char > 0.25 ? 1 : 0.3)) buildIgnite(o);
    }
  }
  if (pc.char >= 1) bFall(pc);
  else bUniforms(pc);
}

/* ------------------------------------------------------------------ */
/* shelter: which pieces stand under a roof (no rain, no snow on them) */
/* ------------------------------------------------------------------ */
function buildRoofOver(x, z) {
  // asked for every splash of rain: only the standing roofs are looked at (kept in BUILD.roofs)
  for (const pc of BUILD.roofs) if (dist2(x, z, pc.x, pc.z) < 9 && bInside(pc, x, z, 0.3)) return true;
  return false;
}
const buildHasRoof = buildRoofOver;
function bShelterAll() {
  BUILD.roofs = BUILD.pieces.filter((pc) => BP[pc.t].roof && (pc.st === 'built' || pc.st === 'burning'));
  for (const pc of BUILD.pieces) {
    const s = !BP[pc.t].roof && buildRoofOver(pc.x, pc.z) && !(BP[pc.t].kind === 'edge') ? 1 : 0;
    if (s !== pc.shelter) { pc.shelter = s; bUniforms(pc); }
  }
}
// the rain shader skips drops under the nearest roofs (houseRoofsForRain): ours join that list
function buildRoofsForRain(list, cx, cz) {
  for (const pc of BUILD.pieces) {
    if (!BP[pc.t].roof || (pc.st !== 'built' && pc.st !== 'burning')) continue;
    const d = dist2(cx, cz, pc.x, pc.z);
    if (d > 60 * 60) continue;
    if (!pc.rainH) {
      // the ridge runs along the piece's x: the houses' roofs run theirs along z, so the frame turns a quarter
      const yaw = pc.yaw + Math.PI / 2, rise = 1.55;
      pc.rainH = { round: false, x: pc.x, z: pc.z, c: Math.cos(yaw), s: Math.sin(yaw), w: B_C, d: B_C, ohSide: 0.3, ohGable: 0.2, y: pc.y - B_WH, wallH: B_WH, rh: rise, tn: rise / (B_C / 2 + 0.3) };
    }
    list.push([d, pc.rainH]);
  }
}

/* ------------------------------------------------------------------ */
/* the E key near what you built                                       */
/* ------------------------------------------------------------------ */
function buildOffers(P, offer) {
  if (!BUILD.pieces.length || BUILD.mode) return;
  for (const pc of BUILD.pieces) {
    const d = dist(P.x, P.z, pc.x, pc.z);
    if (d > 4.5 || Math.abs(P.y - pc.y) > 3.2) continue;
    const D = BP[pc.t], name = D.name.toLowerCase();
    if (pc.st === 'build') { offer(d, 3.6, `${pc.repair ? 'Repair' : 'Raise'} the ${name} with your hammer (${Math.round(pc.p * 100)}%)`, () => buildStartWork(pc), 0.05); continue; }
    if (pc.st === 'ruin' || (pc.st === 'built' && pc.char > 0.05)) {
      const cost = bpCost(pc.t).map(([id, n]) => [id, Math.ceil(n / 2)]);
      offer(d, 3.4, `Repair the ${pc.st === 'ruin' ? 'burnt ' : 'charred '}${name} (${bpCostText(cost)})`, () => buildRepair(pc), 0.02);
      continue;
    }
    if (pc.st !== 'built') continue;
    if (pc.t === 'door' || pc.t === 'gate') {
      offer(d, 2.2, pc.open > 0.5 ? `Close the ${pc.t}` : `Open the ${pc.t}`, () => { if (!buildSetOpen(pc, pc.open < 0.5)) uiError('Someone is in the way'); else setAct(P, 5, 0.55); }, 0.05);
    } else if (pc.t === 'window') offer(d, 2.2, pc.open > 0.5 ? 'Close the shutters' : 'Open the shutters', () => { buildSetOpen(pc, pc.open < 0.5); setAct(P, 5, 0.55); });
    else if (pc.t === 'campfire') offer(d, 2.4, pc.lit ? 'Put out the campfire' : 'Light the campfire', () => { pc.lit = !pc.lit; bApplyState(pc); setAct(P, 5, 0.55); saveSoon(); });
    else if (pc.t === 'bed') offer(d, 2.0, BUILD.bed === pc.id ? 'Rest in your bed' : 'Sleep in the bed (you will wake here when you fall)', () => buildSleep(pc));
    else if (pc.t === 'chest') offer(d, 2.0, 'Open the chest', () => buildChest(pc));
    else if (pc.t === 'workbench') offer(d, 2.2, 'Work at the bench', () => buildBench(pc));
  }
}
function buildStartWork(pc) {
  const P = GAME.player;
  if (!bHasHammer()) { uiError('You need a hammer'); return; }
  BUILD.work = { pc, x: P.x, z: P.z, t: 0 };
}
function buildRepair(pc) {
  const P = GAME.player;
  if (!bHasHammer()) { uiError('You need a hammer'); return; }
  const cost = bpCost(pc.t).map(([id, n]) => [id, Math.ceil(n / 2)]);
  if (!goodsTakeAll(cost)) { uiError(`You need ${bpCostText(cost)}`); return; }
  const ruin = pc.st === 'ruin';
  pc.repair = { char: ruin ? 1 : pc.char };
  pc.st = 'build'; pc.p = ruin ? 0 : 0.5;
  bApplyState(pc);
  BUILD.work = { pc, x: P.x, z: P.z, t: 0 };
  saveSoon();
}
// doors, gates and shutters: a door will not shut on someone standing in it
function buildSetOpen(pc, open) {
  if (!open && pc.t !== 'window') {
    let hit = null;
    forNear(pc.x, pc.z, 3, (e) => { if (!hit && e.alive && e.kind !== 'door' && !e.flying) { const dx = e.x - pc.x, dz = e.z - pc.z, c = Math.cos(pc.yaw), s = Math.sin(pc.yaw), lx = dx * c - dz * s, lz = dx * s + dz * c; if (Math.abs(lx) < (pc.t === 'gate' ? 1.5 : 0.6) && Math.abs(lz) < 0.5 + e.radius) hit = e; } });
    if (hit) return false;
  }
  pc.open = open ? 1 : 0;
  houseSfx(pc.t === 'window' ? (open ? 'shutterOpen' : 'shutterClose') : open ? 'doorOpen' : 'doorClose', pc.x, pc.y + 1.2, pc.z);
  saveSoon();
  return true;
}
function buildSleep(pc) {
  const P = GAME.player;
  let foe = null;
  forNear(P.x, P.z, 20, (e) => { if (!foe && e.alive && e.kind !== 'door' && isEnemy(P, e)) foe = e; });
  if (foe) { uiError('You cannot rest with enemies near'); return; }
  BUILD.bed = pc.id;
  P.hp = P.maxHp; P.power = P.maxPower; P.endurance = 100;
  P.wet = Math.max(0, (P.wet || 0) - 0.5); P.snow = 0;
  setAct(P, 5, 0.55);
  uiLog('You rest in your bed. When you fall, you will wake here.', 'sys');
  uiToast('Your bed is your return point now.', 'hint');
  saveSoon();
}
function buildBedSpot() {
  const pc = BUILD.bed && BUILD.pieces.find((q) => q.id === BUILD.bed && q.t === 'bed' && q.st === 'built');
  if (!pc) return null;
  const p = bPW(pc, 0.9, 0);
  return { x: p.x, z: p.z, y: floorAt(p.x, p.z, pc.y + 0.3) };
}
// a chest keeps goods: put in or take out, by kind
function buildChest(pc) {
  pc.store = pc.store || {};
  UI.modal = 'dialog';
  $('dialog').hidden = false;
  $('dlg-title').textContent = 'Your chest';
  const inside = Object.keys(pc.store).filter((id) => GOODS[id] && pc.store[id] > 0);
  const carried = Object.keys(INV.goods || {}).filter((id) => GOODS[id] && INV.goods[id] > 0 && GOODS[id].kind !== 'tool');
  $('dlg-body').innerHTML = `<p>${inside.length ? 'In the chest: ' + inside.map((id) => `${pc.store[id]} ${esc(goodName(id, pc.store[id]).toLowerCase())}`).join(', ') + '.' : 'The chest is empty.'}</p><p class="fineprint">Tap a good to move all of it.</p>`;
  const box = $('dlg-actions');
  box.innerHTML = '';
  const btn = (label, fn, primary) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'btn' + (primary ? ' primary' : ''); b.textContent = label; b.onclick = fn; box.appendChild(b); };
  for (const id of inside) btn(`Take ${goodName(id, 2).toLowerCase()}`, () => { const n = goodsAdd(id, pc.store[id], true); pc.store[id] -= n; if (pc.store[id] <= 0) delete pc.store[id]; sfx('loot'); saveSoon(); buildChest(pc); });
  for (const id of carried) btn(`Store ${goodName(id, 2).toLowerCase()}`, () => { const n = goodsCount(id); if (goodsTake(id, n)) { pc.store[id] = (pc.store[id] || 0) + n; sfx('click'); saveSoon(); buildChest(pc); } });
  btn('Close', closeDialog, true);
}
// the workbench: saw logs into planks, beat an iron bar into nails
const B_BENCH = [['log', 1, 'plank', 3, 'Saw a log into planks'], ['iron', 1, 'nails', 10, 'Make nails from an iron bar'], ['plank', 1, 'stick', 4, 'Split a plank into sticks']];
function buildBench(pc) {
  UI.modal = 'dialog';
  $('dialog').hidden = false;
  $('dlg-title').textContent = 'The workbench';
  $('dlg-body').innerHTML = '<p>A good bench, a saw and a vice. ' + B_BENCH.map(([a, n, b2, m, l]) => `${l}: ${n} ${esc(goodName(a, n).toLowerCase())} makes ${m} ${esc(goodName(b2, m).toLowerCase())} (you have ${goodsCount(a)}).`).join(' ') + '</p>';
  const box = $('dlg-actions');
  box.innerHTML = '';
  for (const [a, n, b2, m, l] of B_BENCH) {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'btn'; b.textContent = l; b.disabled = !goodsHave(a, n);
    b.onclick = () => { if (goodsTake(a, n)) { goodsAdd(b2, m); houseSfx('hammer', pc.x, pc.y + 1, pc.z); buildBench(pc); } };
    box.appendChild(b);
  }
  const c = document.createElement('button');
  c.type = 'button'; c.className = 'btn primary'; c.textContent = 'Close'; c.onclick = closeDialog;
  box.appendChild(c);
}
const buildWorkbenchNear = (x, z, r = 3) => BUILD.pieces.find((pc) => pc.t === 'workbench' && pc.st === 'built' && dist2(x, z, pc.x, pc.z) < r * r) || null;
// for pens and yards (other systems): a fence along a line, with a gate at gateAt (0..1 along it) if asked;
// opts: { gateAt, owner (a realm, default the player's), free (no goods) }. Returns the pieces made.
function buildFenceLine(x0, z0, x1, z1, opts = {}) {
  const out = [], len = Math.hypot(x1 - x0, z1 - z0), n = Math.max(1, Math.round(len / B_C)), yaw = Math.atan2(x1 - x0, z1 - z0) - Math.PI / 2;
  const gk = opts.gateAt == null ? -1 : Math.min(n - 1, Math.floor(opts.gateAt * n));
  for (let k = 0; k < n; k++) {
    const t = k === gk ? 'gate' : 'fence', f = (k + 0.5) / n, x = lerp(x0, x1, f), z = lerp(z0, z1, f), y = heightAt(x, z);
    out.push(bMakePiece({ t, x, z, y, foot: y, yaw, frame: 0, e: 'f', st: 'built', p: 1 }));
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* the builder: the bar, the ghost, keys and taps                      */
/* ------------------------------------------------------------------ */
function buildToggle(on = !BUILD.mode) {
  const P = GAME.player;
  if (on) {
    if (!P || !P.alive || UI.modal) return;
    if (inDungeon(P)) { uiError('You cannot build under the ground'); return; }
    BUILD.mode = { t: BUILD.lastT || 'found', rot: 0, sn: null };
    if (!bHasHammer()) uiToast('You need a hammer and building goods: the stores in your realm\'s keeps sell them. Look around: the ghost shows where a piece would go.', 'hint');
    else uiToast('Building: pick a piece, R turns it, click or Place to set it down, G or Done to stop.', 'hint');
  } else {
    BUILD.mode = null;
    if (BUILD.ghost) BUILD.ghost.visible = false;
  }
  bRenderBar();
}
function buildPick(t) { if (!BUILD.mode) return; BUILD.mode.t = t; BUILD.lastT = t; BUILD.mode.rot = 0; bRenderBar(); }
function buildRotate() { if (BUILD.mode) BUILD.mode.rot = (BUILD.mode.rot + 1) % 24; }
function buildCursor() {
  const P = GAME.player;
  if (!P) return null;
  const mouse = BUILD.mx >= 0 && performance.now() - BUILD.mouseT < 6000 && !document.body.classList.contains('touch');
  if (mouse) {
    const v = new THREE.Vector3((BUILD.mx / view.w) * 2 - 1, -(BUILD.my / view.h) * 2 + 1, 0.5).unproject(camera).sub(camera.position).normalize();
    const o = camera.position;
    for (let t = 0.5; t < 45; t += 0.25) {
      const x = o.x + v.x * t, y = o.y + v.y * t, z = o.z + v.z * t;
      if (y <= floorAt(x, z, y + 0.3) + 0.02) {
        const d = dist(P.x, P.z, x, z);
        if (d > B_REACH) { const k = B_REACH / d; return { x: P.x + (x - P.x) * k, z: P.z + (z - P.z) * k }; }
        return { x, z };
      }
    }
  }
  const a = P.yaw;
  return { x: P.x + Math.sin(a) * 3.6, z: P.z + Math.cos(a) * 3.6 };
}
// a tap or a click while building: set the piece down (or pull one down)
function buildTap(sx, sy, type) {
  if (!BUILD.mode) return false;
  if (type === 'mouse') { BUILD.mx = sx; BUILD.my = sy; BUILD.mouseT = performance.now(); }
  if (type === 'touch') return true; // on a phone the Place button sets it down; a tap only looks about
  buildConfirm();
  return true;
}
function buildConfirm() {
  const M = BUILD.mode, P = GAME.player;
  if (!M || !P) return;
  if (M.t === 'pull') {
    const pc = bPullTarget();
    if (pc) buildDemolish(pc); else uiError('Point at something you built');
    return;
  }
  const c = buildCursor();
  const r = buildPlace(M.t, c.x, c.z, M.rot);
  if (!r.ok) uiError(r.why);
  bRenderBar();
}
function bPullTarget() {
  const c = buildCursor();
  if (!c) return null;
  let best = null, bd = 2.2 * 2.2;
  for (const pc of BUILD.pieces) { const d = dist2(c.x, c.z, pc.x, pc.z); if (d < bd) { bd = d; best = pc; } }
  return best;
}
// the ghost follows the cursor every frame and turns red where the piece cannot go
function bGhost() {
  const M = BUILD.mode, P = GAME.player;
  if (!M || !P || !P.alive || UI.modal) { if (BUILD.ghost) BUILD.ghost.visible = false; return; }
  const c = buildCursor();
  if (!c) return;
  let sn, geoKey;
  if (M.t === 'pull') {
    const pc = bPullTarget();
    if (!pc) { if (BUILD.ghost) BUILD.ghost.visible = false; M.sn = null; bInfo(); return; }
    sn = { ...pc, ok: false, why: `Pull down the ${BP[pc.t].name.toLowerCase()} (half its goods come back)` };
    geoKey = 'pull' + pc.id;
  } else {
    sn = bValidate(bSnap(M.t, c.x, c.z, M.rot, P), P);
    if (sn.ok && !bHasHammer()) { sn.ok = false; sn.why = 'You need a hammer'; }
    else if (sn.ok && !bpCost(M.t).every(([id, n]) => goodsHave(id, n))) { sn.ok = false; sn.why = `You need ${bpCostText(bpCost(M.t))}`; }
    geoKey = M.t + '|' + (sn.foot - sn.y).toFixed(1);
  }
  M.sn = sn;
  if (BUILD.ghostKey !== geoKey) {
    if (BUILD.ghost) { scene.remove(BUILD.ghost); BUILD.ghost.geometry.dispose(); }
    const pc = { t: M.t === 'pull' ? sn.t : M.t, y: sn.y, foot: sn.foot };
    const { geo, leaves } = bGeometry(pc);
    const g = new THREE.Mesh(geo, B_GHOST);
    for (const L of leaves) { const lm2 = new THREE.Mesh(L.geo, B_GHOST); lm2.position.set(L.hx, 0, L.hz); g.add(lm2); }
    g.renderOrder = 7;
    g.userData.keep = true;
    scene.add(g);
    BUILD.ghost = g; BUILD.ghostKey = geoKey;
  }
  const g = BUILD.ghost;
  g.visible = true;
  g.position.set(sn.x, sn.y + (M.t === 'pull' ? 0.02 : 0), sn.z);
  g.rotation.y = sn.yaw;
  if (M.t === 'pull') g.scale.set(1.03, 1.03, 1.03); else g.scale.set(1, 1, 1);
  B_GHOST.uniforms.uOk.value = sn.ok ? 1 : 0;
  bInfo();
}
function bInfo() {
  const el = BUILD.ui && BUILD.ui.info;
  if (!el) return;
  const M = BUILD.mode, sn = M && M.sn;
  const D = M && BP[M.t];
  let html = '';
  if (M && M.t === 'pull') html = sn ? `<b>Pull down</b> ${esc(sn.why)}` : '<b>Pull down</b> Point at something you built';
  else if (D) html = `<b>${esc(D.name)}</b> ${esc(bpCostText(D.cost))}${sn && !sn.ok ? ` <span class="bwhy">${esc(sn.why)}</span>` : ''}`;
  if (el._h !== html) { el.innerHTML = html; el._h = html; }
}
const B_ICON = {
  found: '<path d="M3 15h18v4H3z M5 15l2-3h10l2 3"/>', wall: '<path d="M5 4h14v16H5z M9 4v16 M14 4v16"/>', door: '<path d="M5 4h14v16H5z M9.5 20V9h5v11"/>', window: '<path d="M5 4h14v16H5z M9 8h6v6H9z M12 8v6 M9 11h6"/>',
  wallStone: '<path d="M4 5h16v14H4z M4 10h16 M4 14.5h16 M9 5v5 M15 10v4.5 M10 14.5V19"/>', roofThatch: '<path d="M2 15l10-8 10 8 M5 15v4 M19 15v4 M7 12l-2 3 M17 12l2 3"/>', roofShingle: '<path d="M2 15l10-8 10 8 M5 15v4 M19 15v4 M8 11.5h8 M6 13.5h12"/>',
  floor: '<path d="M3 10h18v3H3z M5 13v7 M19 13v7 M9 10v3 M15 10v3"/>', stairs: '<path d="M4 20h4v-4h4v-4h4V8h4V4"/>', fence: '<path d="M5 6v14 M12 6v14 M19 6v14 M3 10h18 M3 15h18"/>', gate: '<path d="M4 5v15 M20 5v15 M6 8h12v10H6z M6 18l12-10"/>',
  campfire: '<path d="M12 4c2 3 4 5 4 8a4 4 0 0 1-8 0c0-2 1-3 2-4 0 2 1 3 2 3 0-3-1-5 0-7z M5 20l14-3 M5 17l14 3"/>', workbench: '<path d="M3 10h18v2H3z M5 12v8 M19 12v8 M7 16h10"/>', bed: '<path d="M3 18V8 M3 14h18v4 M3 12h6v2 M9 12h12v2"/>', chest: '<path d="M4 9h16v10H4z M4 9l2-4h12l2 4 M11 12h2v2h-2z"/>',
  pull: '<path d="M5 19L19 5 M14 5h5v5 M4 12l3-3 3 3-3 3z"/>', rot: '<path d="M19 12a7 7 0 1 1-2-5 M19 4v4h-4"/>', ok: '<path d="M5 12l5 5 9-10"/>', x: '<path d="M6 6l12 12 M18 6L6 18"/>',
};
const bIco = (k) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${B_ICON[k] || ''}</svg>`;
function bRenderBar() {
  let bar = $('buildbar');
  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'buildbar'; bar.className = 'panel';
    bar.innerHTML = '<div class="bpieces" role="toolbar" aria-label="Pieces to build"></div><div class="brow"><div class="binfo" aria-live="polite"></div><div class="bacts"><button type="button" class="btn" data-b="rot" aria-label="Turn the piece (R)">' + bIco('rot') + '<span>Turn</span></button><button type="button" class="btn primary" data-b="place" aria-label="Set the piece down (click)">' + bIco('ok') + '<span>Place</span></button><button type="button" class="btn" data-b="done" aria-label="Stop building (G)">' + bIco('x') + '<span>Done</span></button></div></div>';
    $('hud').appendChild(bar);
    bar.addEventListener('click', (e) => {
      const p = e.target.closest('[data-piece]');
      if (p) { buildPick(p.dataset.piece); sfx('click'); return; }
      const b = e.target.closest('[data-b]');
      if (!b) return;
      if (b.dataset.b === 'rot') buildRotate();
      else if (b.dataset.b === 'place') buildConfirm();
      else if (b.dataset.b === 'done') buildToggle(false);
      sfx('click');
    });
    BUILD.ui = { bar, list: bar.querySelector('.bpieces'), info: bar.querySelector('.binfo') };
  }
  bar.hidden = !BUILD.mode;
  const btn = $('btn-build');
  if (btn) btn.setAttribute('aria-pressed', BUILD.mode ? 'true' : 'false');
  if (!BUILD.mode) return;
  BUILD.ui.list.innerHTML = BP_ORDER.map((t) => {
    const D = BP[t], can = t === 'pull' || bpCost(t).every(([id, n]) => goodsHave(id, n));
    const title = t === 'pull' ? 'Pull down something you built: half its goods come back' : `${D.name}: ${bpCostText(D.cost)}. ${D.desc}`;
    return `<button type="button" class="bpiece${can ? '' : ' short'}" data-piece="${t}" aria-pressed="${BUILD.mode.t === t}" title="${esc(title)}">${bIco(t)}<span>${t === 'pull' ? 'Pull down' : esc(D.name)}</span></button>`;
  }).join('');
  BUILD.ui.info._h = '';
  bInfo();
}
// keys while building: R turns, Z/X pick the piece before or after, Enter sets it down, G or Escape stops
window.addEventListener('keydown', (e) => {
  if (typing() || !GAME.started || e.repeat) return;
  if (e.code === 'KeyG' && (!UI.modal || BUILD.mode)) { e.preventDefault(); e.stopImmediatePropagation(); buildToggle(); return; }
  if (!BUILD.mode || UI.modal) return;
  const k = e.code, i = BP_ORDER.indexOf(BUILD.mode.t);
  let used = true;
  if (k === 'KeyR') buildRotate();
  else if (k === 'KeyZ') buildPick(BP_ORDER[(i + BP_ORDER.length - 1) % BP_ORDER.length]);
  else if (k === 'KeyX') buildPick(BP_ORDER[(i + 1) % BP_ORDER.length]);
  else if (k === 'Enter') buildConfirm();
  else if (k === 'Escape') buildToggle(false);
  else used = false;
  if (used) { e.preventDefault(); e.stopImmediatePropagation(); }
}, true);
canvas.addEventListener('pointermove', (e) => { if (e.pointerType === 'mouse') { BUILD.mx = e.clientX; BUILD.my = e.clientY; BUILD.mouseT = performance.now(); } });

/* ------------------------------------------------------------------ */
/* every step and every frame                                          */
/* ------------------------------------------------------------------ */
function updateBuild(dt) {
  const P = GAME.player;
  // work: stand by an unfinished piece with a hammer and it rises; move away and the work waits
  const W2 = BUILD.work;
  if (W2 && P) {
    const pc = W2.pc;
    const near = pc.st === 'build' && dist2(P.x, P.z, pc.x, pc.z) < 4.2 * 4.2 && Math.abs(P.y - pc.y) < 3.5;
    const still = dist2(P.x, P.z, W2.x, W2.z) < (W2.auto ? 4 : 0.8) ** 2;
    if (!P.alive || !near || !still || !bHasHammer() || P.casting) {
      if (pc.st === 'build' && P.alive && !W2.auto) uiLog('You put down your hammer.', 'sys');
      BUILD.work = null;
    } else if (bWork(pc, dt)) {
      const nx = bNearestUnfinished(P.x, P.z, 4.2);
      BUILD.work = nx ? { pc: nx, x: P.x, z: P.z, t: 0, auto: W2.auto } : null;
    }
  }
  // stand still by an unfinished piece with a hammer in your pack and you take up the work
  if (P && P.alive && !BUILD.work) {
    const moved = BUILD.lastP ? dist2(P.x, P.z, BUILD.lastP.x, BUILD.lastP.z) : 1;
    BUILD.idleT = moved < 0.0025 ? (BUILD.idleT || 0) + dt : 0;
    if (BUILD.idleT > 0.7 && bHasHammer() && !P.casting) { const pc = bNearestUnfinished(P.x, P.z, 3.6); if (pc && Math.abs(P.y - pc.y) < 3) BUILD.work = { pc, x: P.x, z: P.z, t: 0 }; }
  }
  if (P) BUILD.lastP = { x: P.x, z: P.z };
  // fire, ruins cooling, leaves swinging
  for (const pc of BUILD.pieces) {
    if (pc.st === 'burning') bBurnStep(pc, dt);
    else if (pc.st === 'ruin' && (pc.cool || 0) < 40) { pc.cool = (pc.cool || 0) + dt; bUniforms(pc); }
    if (pc.leaves.length) {
      for (const L of pc.leaves) {
        if (L.open !== pc.open) {
          L.open = pc.open > L.open ? Math.min(pc.open, L.open + dt * 2) : Math.max(pc.open, L.open - dt * 2);
          L.pivot.rotation.y = smooth(L.open) * L.swing;
        }
      }
      if (pc.leafColl) pc.leafColl.active = pc.leaves[0].open < 0.3 && (pc.st === 'built' || pc.st === 'burning');
    }
  }
  if (BUILD.roofsDirty) { BUILD.roofsDirty = false; bShelterAll(); for (const pc of BUILD.pieces) pc.rainH = null; }
}
function drawBuild(dt) {
  void dt;
  bGhost();
}
function buildOnStart(save) {
  void save;
  if (window.__hm) window.__hm.build = { BUILD, BP, buildPlace, buildDemolish, buildIgnite, buildRepair, buildSetOpen, buildToggle, buildPick, buildRotate, buildConfirm, buildCursor, bSnap, bValidate, buildRoofOver, buildFenceLine, buildBedSpot, buildSleep, buildSaveData, buildLoadData, buildStartWork, bLandWhy, buildPieces, buildFireAt, bSupport, buildHasRoof, buildWorkbenchNear };
  if (window.__hm) Object.assign(window.__hm.fn, { releasePlayer, collidersNear });
  if (window.__hm) window.__hm.build.COLL = COLL;
  // the hammer button among the round buttons at the top right
  if (!$('btn-build')) {
    const b = document.createElement('button');
    b.id = 'btn-build'; b.type = 'button'; b.className = 'iconbtn panel';
    b.setAttribute('aria-label', 'Build (G)'); b.setAttribute('aria-pressed', 'false');
    b.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"><path d="M13 10.5l-8 8.5 1.6 1.6 8.5-8"/><path d="M11 6.5l4-3 6 6-3 4z"/></svg>';
    b.onclick = () => { buildToggle(); sfx('click'); };
    const host = document.querySelector('#topright .iconbtns');
    if (host) host.insertBefore(b, $('btn-menu'));
  }
  if (BUILD.mode) buildToggle(false);
}

/* ------------------------------------------------------------------ */
/* the world remembers what was built                                  */
/* ------------------------------------------------------------------ */
const B_ST = ['build', 'built', 'ruin'];
function buildSaveData() {
  if (!BUILD.pieces.length) return null;
  const r2 = (v) => Math.round(v * 100) / 100;
  return {
    v: 1, bed: BUILD.bed || 0,
    p: BUILD.pieces.map((pc) => [pc.id, pc.t, r2(pc.x), r2(pc.z), r2(pc.y), r2(pc.foot), r2(pc.yaw), pc.frame, r2(pc.fx), r2(pc.fz), r2(pc.fyaw), pc.i, pc.j, pc.e,
      Math.max(0, B_ST.indexOf(pc.st === 'burning' ? 'built' : pc.st)), Math.round(pc.p * 100), Math.round(pc.char * 100), pc.open ? 1 : 0, pc.lit ? 1 : 0, pc.store && Object.keys(pc.store).length ? pc.store : 0]),
  };
}
function buildLoadData(d) {
  for (const pc of BUILD.pieces.slice()) buildDemolish(pc, false);
  BUILD.bed = 0;
  if (!d || typeof d !== 'object' || d.v !== 1 || !Array.isArray(d.p)) return;
  const num = (v, lo, hi, def) => (Number.isFinite(+v) ? clamp(+v, lo, hi) : def);
  const within = (v, lo, hi) => (Number.isFinite(+v) && +v >= lo && +v <= hi ? +v : null);
  for (const a of d.p.slice(0, B_MAX)) {
    if (!Array.isArray(a) || !BP[a[1]]) continue;
    const x = within(a[2], -HALF, HALF), z = within(a[3], -HALF, HALF), y = within(a[4], -50, 200);
    if (x === null || z === null || y === null) continue;
    const store = {};
    if (a[19] && typeof a[19] === 'object') for (const id in a[19]) { const n = Math.round(+a[19][id]); if (GOODS[id] && n > 0) store[id] = Math.min(9999, n); }
    bMakePiece({
      id: Math.max(1, Math.round(num(a[0], 1, 1e7, BUILD.next))), t: a[1], x, z, y, foot: num(a[5], -60, 200, y), yaw: num(a[6], -20, 20, 0), frame: Math.round(num(a[7], 0, 1e7, 0)),
      fx: num(a[8], -HALF, HALF, x), fz: num(a[9], -HALF, HALF, z), fyaw: num(a[10], -20, 20, 0), i: Math.round(num(a[11], -999, 999, 0)), j: Math.round(num(a[12], -999, 999, 0)),
      e: ['c', 'x', 'z', 'f'].includes(a[13]) ? a[13] : 'f', st: B_ST[Math.round(num(a[14], 0, 2, 1))], p: num(a[15], 0, 100, 100) / 100, char: num(a[16], 0, 100, 0) / 100,
      open: a[17] ? 1 : 0, lit: !!a[18], store,
    });
  }
  for (const pc of BUILD.pieces) for (const L of pc.leaves) { L.open = pc.open; L.pivot.rotation.y = smooth(L.open) * L.swing; }
  const bed = Math.round(num(d.bed, 0, 1e7, 0));
  BUILD.bed = BUILD.pieces.some((pc) => pc.id === bed && pc.t === 'bed') ? bed : 0;
  bSupport();
  BUILD.roofsDirty = true;
}
// what counts as a change worth writing: the pieces and their states, not the fire's clock
function buildSaveKey(d) { return d && d.p ? d.p.map((a) => a.slice(0, 2).concat(a.slice(14, 15), a.slice(17, 20))).concat([d.bed]) : null; }
registerSavePart('world', 'build', { save: buildSaveData, load: buildLoadData, key: buildSaveKey });

/* ------------------------------------------------------------------ */
/* the Chronicle and the help                                          */
/* ------------------------------------------------------------------ */
function chronHalls() {
  const P = GAME.player;
  const rows = WAR.keeps.map((K) => `<li><b>${esc(K.site.name)}</b>: ${esc(REALMS[K.realm].name)} holds it${K.realm === P.faction ? ', so its war table answers to you' : ''}.</li>`).join('');
  return `<p class="lead">Every keep has its great hall at the back of the courtyard, behind the lord who holds it. Logres builds a tall hall of stone under slate, Ériu a great roundhouse under thatch, Thule a longhall of logs under shingles with a long hearth down the middle.</p>
    <h3>What is inside</h3>
    <ul class="plain"><li><b>The war table.</b> A map of the March on a hide, with the keeps and the warbands marked. Anyone of the realm that holds the keep can command its warbands from here, whatever their rank: choose a band on the map, then a keep to attack or defend, a temple to raid, or call it to rally to you.</li>
    <li><b>The armourer's bench.</b> Mends worn and broken gear for gold, and cleans off mud and blood and beats out the dents for nothing.</li>
    <li><b>The basin.</b> Wash yourself and your gear. You come away damp.</li>
    <li><b>The hearth.</b> Sit by it to dry off, thaw out and get your strength back, when no enemy is near.</li>
    <li><b>The stores.</b> The steward sells planks, stone, thatch, nails, glass, iron and hammers to the realm's builders.</li></ul>
    <p>The hall's door opens with E like any door. A hall can burn like any house: its roof falls in, and the realm rebuilds it in a few minutes.</p>
    <h3>Who holds the halls</h3><ul class="plain">${rows}</ul>`;
}
function chronBuilding() {
  const n = BUILD.pieces.filter((pc) => pc.st === 'built').length;
  const key = IS_TOUCH ? 'the hammer button' : 'G (or the hammer button)';
  return `<p class="lead">You may build on your own realm's lands, at home or in your realm's march: not in or beside towns, keeps, temples, musters, camps or the Barrow, not on roads or in water, and not on slopes too steep to stand a wall on.</p>
    <h3>How to build</h3>
    <p>Open the builder with ${key}. Pick a piece from the bar; a ghost of it follows ${IS_TOUCH ? 'the spot ahead of you' : 'your mouse'}, green where it can go and red where it cannot, with the reason. ${IS_TOUCH ? 'Turn it with Turn and set it down with Place.' : 'R turns it, Z and X pick the piece before or after, a click or Enter sets it down.'} Pieces snap to a three-pace grid shared by everything already built nearby, so walls meet and roofs line up.</p>
    <p>Setting a piece down takes its goods; then it rises as you work it with your <b>hammer</b>. Stand by it and keep still. You can set down several and they go up one after another. Buy goods and a hammer from the stores in your keeps' great halls; a workbench you build saws logs into planks and beats iron into nails.</p>
    <h3>The pieces</h3>
    <ul class="plain">${BP_ORDER.filter((t) => BP[t]).map((t) => `<li><b>${esc(BP[t].name)}</b> (${esc(bpCostText(BP[t].cost))}): ${esc(BP[t].desc)}</li>`).join('')}</ul>
    <h3>Living with it</h3>
    <ul class="plain"><li>Foundations, floors and stairs are floors you walk on; walls, doors and fences stop you; doors, gates and shutters open with E.</li>
    <li>A roof keeps the rain and snow off you and what is under it. Roofs and floors rest on walls: take the walls away and they fall.</li>
    <li>Wood and thatch burn: a fire spell, the dragon or a burning brand sets them alight, the fire spreads from piece to piece, and what burns through falls in a charred heap. Stone does not burn.</li>
    <li>Repair what is burnt or charred for half its goods, with your hammer. Pull down what you no longer want from the builder (Pull down): half its goods come back.</li>
    <li>Sleep in a bed you built and you wake there when you fall. A chest keeps goods. A campfire warms and dries you.</li></ul>
    <p class="now">You have built <b>${n}</b> piece${n === 1 ? '' : 's'}.</p>`;
}
function buildHelpHTML() {
  return IS_TOUCH
    ? `<div class="keys"><kbd>Hammer button</kbd><span>Build: pick a piece, Turn, Place, Done. Work an unfinished piece by standing by it with a hammer.</span></div>
      <h3>Keep halls and building</h3><p>Every keep has a great hall: its war table lets anyone of the realm holding the keep command the warbands, the armourer mends and cleans gear, the hearth dries you, and the stores sell building goods. With a hammer and goods you can build on your own realm's lands: foundations, walls, doors, windows, roofs, stairs, fences, a bed that becomes your return point, chests and campfires. See the Chronicle.</p>`
    : `<div class="keys"><kbd>G</kbd><span>Build: a ghost follows the mouse. R turns it, Z · X change piece, click or Enter sets it down, Esc or G stops.</span></div>
      <h3>Keep halls and building</h3><p>Every keep has a great hall: its war table lets anyone of the realm holding the keep command the warbands, the armourer mends and cleans gear, the hearth dries you, and the stores sell building goods. With a hammer and goods you can build on your own realm's lands: foundations, walls, doors, windows, roofs, stairs, fences, a bed that becomes your return point, chests and campfires. See the Chronicle.</p>`;
}
