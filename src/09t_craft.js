/* ================================================================== */
/* crafting: workstations in the towns and keeps, mining the rocks,    */
/* and the crafting book that works on a desk and on a phone           */
/* ================================================================== */
// Each town has a craft yard round its plaza: a forge with an anvil and a quench trough, a workbench, a tanning rack,
// a loom, a bakehouse (oven, quern and brewing tub) and an alchemy table; each keep has a workbench and a forge in its
// courtyard. They are built in code with the building shader (rain, snow, shadows, firelight), stand on colliders that
// also keep grass out of them (the cover map), and the forge, the oven and the alchemist's brazier burn with real
// fires (cook at them, take a brand from them). Rocks give stone by hand, and flint and iron ore to a pick.
const CRAFT = { stations: [], rocks: new Map(), rockT: 0, ui: { st: null, ref: null, tab: 'here', sel: null }, hand: { on: false, keep: 0, look: null, bit: 0 } };
const STATION_DEF = {
  forge: { name: 'forge', verb: 'Work at the forge', hx: 1.55, hz: 1.05, build: stForge },
  workbench: { name: 'workbench', verb: 'Work at the workbench', hx: 1.2, hz: 0.6, build: stWorkbench },
  tanning: { name: 'tanning rack', verb: 'Work at the tanning rack', hx: 1.1, hz: 0.7, build: stTanning },
  loom: { name: 'loom', verb: 'Weave at the loom', hx: 1.0, hz: 0.65, build: stLoom },
  oven: { name: 'bakehouse', verb: 'Use the bakehouse', hx: 1.65, hz: 1.0, build: stOven },
  alchemy: { name: 'alchemy table', verb: 'Use the alchemy table', hx: 1.05, hz: 0.6, build: stAlchemy },
};

/* ------------------------------------------------------------------ */
/* the stations' models (local frame: +z is the front the worker uses) */
/* ------------------------------------------------------------------ */
function stTable(b, M, w, d, h, col, y0) {
  b.add(G.box, lm(M, 0, h - 0.05, 0, 0, w, 0.1, d), MAT.wood, col, y0, 1);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.add(G.box, lm(M, sx * (w / 2 - 0.1), (h - 0.1) / 2, sz * (d / 2 - 0.09), 0, 0.1, h - 0.1, 0.1), MAT.wood, darker(col, 0.8), y0, 1);
  for (const sz of [-1, 1]) b.add(G.box, lm(M, 0, 0.2, sz * (d / 2 - 0.09), 0, w - 0.25, 0.07, 0.06), MAT.wood, darker(col, 0.75), y0, 1);
}
function stWorkbench(b, M, st, y0) {
  const wood = [0.5, 0.36, 0.22];
  stTable(b, M, 2.2, 0.9, 0.88, wood, y0);
  // a log on the bench, a plank, a vice at the end, chisels and a mallet; a bow saw hung on the front
  beam(b, M, [-0.75, 1.0, -0.12], [0.2, 1.0, -0.16], 0.2, MAT.logH, [0.42, 0.3, 0.2]);
  b.add(G.box, lm(M, 0.55, 0.95, 0.1, 0.1, 0.9, 0.04, 0.24), MAT.wood, [0.62, 0.48, 0.32]);
  b.add(G.box, lm(M, 1.0, 1.02, 0.25, 0, 0.18, 0.18, 0.22), MAT.wood, darker(wood, 0.7));
  beam(b, M, [0.92, 1.08, 0.38], [1.08, 1.08, 0.38], 0.03, MAT.metal, [0.3, 0.3, 0.32]);
  b.add(G.box, lm(M, -0.2, 0.95, 0.3, 0.6, 0.22, 0.05, 0.05), MAT.metal, [0.35, 0.35, 0.37]);
  beam(b, M, [-0.35, 0.94, 0.28], [-0.05, 0.94, 0.33], 0.025, MAT.wood, [0.55, 0.42, 0.25]);
  b.add(G.box, lm(M, 0.35, 0.97, -0.3, 0.3, 0.14, 0.09, 0.09), MAT.wood, [0.38, 0.27, 0.17]);
  beam(b, M, [0.3, 0.97, -0.3], [0.62, 0.97, -0.12], 0.035, MAT.wood, [0.55, 0.42, 0.25]);
  // the saw: a frame with the blade along its foot
  beam(b, M, [-0.95, 0.42, 0.47], [-0.35, 0.42, 0.47], 0.03, MAT.metal, [0.62, 0.62, 0.64]);
  beam(b, M, [-0.95, 0.42, 0.47], [-0.95, 0.78, 0.47], 0.03, MAT.wood, [0.5, 0.38, 0.22]);
  beam(b, M, [-0.35, 0.42, 0.47], [-0.35, 0.78, 0.47], 0.03, MAT.wood, [0.5, 0.38, 0.22]);
  beam(b, M, [-0.95, 0.72, 0.47], [-0.35, 0.72, 0.47], 0.025, MAT.wood, [0.5, 0.38, 0.22]);
  // planks leaning on the back and shavings on the ground
  for (let k = 0; k < 3; k++) b.add(G.box, lm(M, -0.6 + k * 0.32, 0.6, -0.55, 0.05 * k, 0.22, 1.2, 0.035, -0.18), MAT.wood, [0.6 - k * 0.04, 0.46, 0.3], y0, 1.2);
  for (let k = 0; k < 6; k++) b.add(G.box, lm(M, -0.6 + k * 0.25, 0.01, 0.2 + (k % 3) * 0.12, k, 0.12, 0.012, 0.05), MAT.wood, [0.72, 0.58, 0.4]);
}
function stForge(b, M, st, y0, fires) {
  const stone = darker(st.stone, 0.85), dark = [0.12, 0.1, 0.09], iron = [0.16, 0.16, 0.17];
  // the hearth: a stone block with a sunken fire bed, a back wall and a hood and chimney over it
  b.add(G.box, lm(M, -0.55, 0.42, -0.05, 0, 1.4, 0.84, 1.0), MAT.stone, stone, y0, 1.2);
  b.add(G.cyl12, lm(M, -0.55, 0.845, -0.05, 0, 0.42, 0.04, 0.36), MAT.darkstone, dark);
  b.add(G.box, lm(M, -0.55, 1.45, -0.62, 0, 1.4, 2.1, 0.26), MAT.stone, stone, y0, 2.4);
  b.add(G.pyr, lm(M, -0.55, 1.9, -0.18, 0, 0.98, 0.75, 0.66), MAT.stone, darker(stone, 0.9));
  b.add(G.box, lm(M, -0.55, 2.95, -0.42, 0, 0.42, 1.6, 0.42), MAT.stone, darker(stone, 0.95), y0, 3.5);
  b.add(G.box, lm(M, -0.55, 3.78, -0.42, 0, 0.5, 0.08, 0.5), MAT.darkstone, darker(stone, 0.7));
  // bellows on a frame beside it
  b.add(G.box, lm(M, -1.42, 0.75, -0.1, 0, 0.42, 0.14, 0.7, 0.12), MAT.cloth, [0.32, 0.22, 0.14]);
  b.add(G.box, lm(M, -1.42, 0.65, -0.1, 0, 0.46, 0.04, 0.74), MAT.wood, [0.42, 0.3, 0.18]);
  beam(b, M, [-1.42, 0.65, 0.25], [-1.42, 0.7, 0.62], 0.05, MAT.wood, [0.42, 0.3, 0.18]);
  for (const sz of [-0.3, 0.2]) beam(b, M, [-1.42, 0, sz], [-1.42, 0.6, sz], 0.07, MAT.wood, [0.38, 0.27, 0.16], 0.07, y0);
  beam(b, M, [-1.2, 0.8, -0.1], [-0.95, 0.82, -0.1], 0.06, MAT.metal, iron);
  // the anvil on its stump
  b.add(G.cyl12, lm(M, 0.72, 0.27, 0.22, 0, 0.3, 0.54, 0.3), MAT.logH, [0.42, 0.3, 0.2], y0, 0.6);
  b.add(G.box, lm(M, 0.72, 0.6, 0.22, 0, 0.26, 0.13, 0.2), MAT.metal, iron);
  b.add(G.box, lm(M, 0.72, 0.72, 0.22, 0, 0.5, 0.12, 0.2), MAT.metal, darker(iron, 1.2));
  b.add(G.cone8, lm(M, 1.08, 0.72, 0.22, 0, 0.07, 0.24, 0.07, 0, -Math.PI / 2), MAT.metal, darker(iron, 1.2));
  b.add(G.box, lm(M, 0.5, 0.77, 0.22, 0, 0.06, 0.02, 0.06), MAT.metal, darker(iron, 0.8));
  // a hammer and tongs on the anvil, the quench trough with water in it, a rack of finished work
  beam(b, M, [0.62, 0.8, 0.35], [0.62, 0.8, 0.62], 0.03, MAT.wood, [0.5, 0.36, 0.2]);
  b.add(G.box, lm(M, 0.62, 0.81, 0.32, 0, 0.12, 0.05, 0.06), MAT.metal, iron);
  beam(b, M, [0.86, 0.8, 0.12], [1.25, 0.82, -0.2], 0.018, MAT.metal, iron);
  b.add(G.box, lm(M, 0.95, 0.2, -0.62, 0, 0.9, 0.4, 0.42), MAT.wood, [0.36, 0.26, 0.16], y0, 0.5);
  b.add(G.box, lm(M, 0.95, 0.38, -0.62, 0, 0.8, 0.02, 0.32), MAT.water, [0.2, 0.26, 0.28]);
  for (const sx of [1.25, 1.42]) beam(b, M, [sx, 0, -0.95], [sx, 1.3, -0.95], 0.06, MAT.wood, [0.4, 0.28, 0.17], 0.06, y0);
  beam(b, M, [1.2, 1.25, -0.95], [1.47, 1.25, -0.95], 0.05, MAT.wood, [0.4, 0.28, 0.17]);
  for (let k = 0; k < 3; k++) beam(b, M, [1.27 + k * 0.07, 1.2, -0.9], [1.27 + k * 0.07, 0.55 - k * 0.08, -0.88], 0.025, MAT.metal, [0.4, 0.4, 0.43]);
  fires.push({ lx: -0.55, ly: 0.9, lz: -0.05, size: 0.55, light: { r: 7.5, k: 1.1 }, station: 'forge' });
}
function stTanning(b, M, st, y0) {
  const wood = [0.4, 0.29, 0.18], hide = [0.58, 0.43, 0.3];
  // a frame of poles with a hide laced into it
  for (const sx of [-0.85, 0.85]) beam(b, M, [sx, 0, -0.2], [sx, 1.95, -0.25], 0.11, MAT.logH, wood, 0.11, y0);
  beam(b, M, [-1.0, 1.85, -0.25], [1.0, 1.85, -0.25], 0.09, MAT.logH, wood);
  beam(b, M, [-1.0, 0.35, -0.2], [1.0, 0.35, -0.2], 0.08, MAT.logH, wood);
  b.add(G.box, lm(M, 0, 1.1, -0.22, 0, 1.3, 1.25, 0.03, 0.02), MAT.cloth, hide);
  b.add(G.box, lm(M, 0, 1.1, -0.21, 0.5, 0.95, 0.95, 0.035, 0.02), MAT.cloth, darker(hide, 0.92));
  for (let k = 0; k < 5; k++) { const y = 0.55 + k * 0.28; beam(b, M, [-0.66, y, -0.22], [-0.85, y + 0.04, -0.21], 0.012, MAT.cloth, [0.75, 0.68, 0.52]); beam(b, M, [0.66, y, -0.22], [0.85, y + 0.04, -0.21], 0.012, MAT.cloth, [0.75, 0.68, 0.52]); }
  // the scraping beam with a hide over it, a soaking tub
  beam(b, M, [0.25, 0.0, 0.48], [0.9, 0.85, 0.2], 0.16, MAT.logH, darker(wood, 1.1), 0.16, y0);
  beam(b, M, [0.75, 0, 0.45], [0.75, 0.52, 0.33], 0.06, MAT.wood, wood, 0.06, y0);
  b.add(G.box, lm(M, 0.66, 0.66, 0.29, 0, 0.42, 0.04, 0.5, 0.95), MAT.cloth, [0.5, 0.38, 0.26]);
  b.add(G.cyl12, lm(M, -0.6, 0.28, 0.32, 0, 0.32, 0.56, 0.32), MAT.wood, [0.38, 0.27, 0.17], y0, 0.6);
  b.add(G.cyl12, lm(M, -0.6, 0.5, 0.32, 0, 0.28, 0.02, 0.28), MAT.water, [0.24, 0.2, 0.12]);
}
function stLoom(b, M, st, y0) {
  const wood = [0.46, 0.33, 0.2];
  // a warp-weighted loom leaning against its stand: the cloth woven at the top, the warp hanging to the weights
  for (const sx of [-0.85, 0.85]) beam(b, M, [sx, 0, 0.18], [sx, 2.05, -0.3], 0.1, MAT.wood, wood, 0.1, y0);
  beam(b, M, [-1.0, 1.98, -0.28], [1.0, 1.98, -0.28], 0.12, MAT.logH, darker(wood, 1.1));
  const cloth = st.roof ? [0.62, 0.3, 0.22] : [0.5, 0.3, 0.2];
  b.add(G.box, lm(M, 0, 1.6, -0.18, 0, 1.55, 0.7, 0.025, -0.23), MAT.cloth, cloth);
  b.add(G.box, lm(M, 0, 1.55, -0.165, 0, 1.55, 0.08, 0.026, -0.23), MAT.cloth, [0.85, 0.78, 0.55]);
  b.add(G.box, lm(M, 0, 1.75, -0.21, 0, 1.55, 0.06, 0.026, -0.23), MAT.cloth, [0.2, 0.3, 0.45]);
  b.add(G.box, lm(M, 0, 0.82, 0.0, 0, 1.5, 0.95, 0.008, -0.23), MAT.cloth, [0.82, 0.78, 0.68]);
  beam(b, M, [-0.9, 0.9, 0.03], [0.9, 0.9, 0.03], 0.05, MAT.wood, wood);
  for (let k = 0; k < 9; k++) b.add(G.cyl8, lm(M, -0.68 + k * 0.17, 0.28, 0.12, 0, 0.06, 0.05, 0.06, Math.PI / 2), MAT.stone, [0.5, 0.48, 0.44]);
  // a stool and a basket of wool
  b.add(G.cyl12, lm(M, 0.55, 0.42, 0.55, 0, 0.2, 0.06, 0.2), MAT.wood, wood);
  for (let k = 0; k < 3; k++) { const a = (k / 3) * TAU; beam(b, M, [0.55 + Math.sin(a) * 0.15, 0, 0.55 + Math.cos(a) * 0.15], [0.55 + Math.sin(a) * 0.08, 0.4, 0.55 + Math.cos(a) * 0.08], 0.04, MAT.wood, wood, 0.04, y0); }
  b.add(G.cyl12, lm(M, -0.6, 0.16, 0.48, 0, 0.24, 0.32, 0.24), MAT.thatch, [0.62, 0.5, 0.3], y0, 0.4);
  for (let k = 0; k < 4; k++) b.add(G.ico, lm(M, -0.62 + (k % 2) * 0.12 - 0.05, 0.36 + (k > 1 ? 0.06 : 0), 0.44 + (k % 3) * 0.06, k, 0.12, 0.09, 0.12), MAT.cloth, [0.9, 0.88, 0.82]);
}
function stOven(b, M, st, y0, fires) {
  const clay = [0.66, 0.46, 0.33], stone = darker(st.stone, 0.9);
  // a domed clay oven on a stone plinth, its mouth glowing, a stub of chimney
  b.add(G.box, lm(M, -0.6, 0.28, -0.1, 0, 1.6, 0.56, 1.5), MAT.stone, stone, y0, 0.8);
  b.add(G.ico, lm(M, -0.6, 0.56, -0.1, 0, 0.72, 0.68, 0.7), MAT.plaster, clay);
  b.add(G.box, lm(M, -0.6, 0.78, 0.55, 0, 0.42, 0.42, 0.12), MAT.plaster, darker(clay, 0.9));
  b.add(G.box, lm(M, -0.6, 0.74, 0.6, 0, 0.3, 0.28, 0.06), MAT.darkstone, [0.08, 0.06, 0.05]);
  b.add(G.cyl8, lm(M, -0.75, 1.32, -0.35, 0, 0.11, 0.42, 0.11), MAT.plaster, darker(clay, 0.85));
  // a peel leaning on it, a stack of split wood, a sack of flour
  beam(b, M, [-1.3, 0, 0.42], [-1.42, 1.4, 0.3], 0.035, MAT.wood, [0.55, 0.42, 0.25], 0.035, y0);
  b.add(G.box, lm(M, -1.43, 1.45, 0.29, 0, 0.24, 0.3, 0.02, -0.08), MAT.wood, [0.55, 0.42, 0.25]);
  for (let k = 0; k < 6; k++) beam(b, M, [-1.55 + (k % 3) * 0.16, 0.08 + Math.floor(k / 3) * 0.14, -0.45], [-1.55 + (k % 3) * 0.16, 0.08 + Math.floor(k / 3) * 0.14, 0.05], 0.13, MAT.logH, [0.44, 0.32, 0.2]);
  // the quern on its stand, and the brewing tub
  b.add(G.box, lm(M, 0.72, 0.25, 0.15, 0, 0.62, 0.5, 0.62), MAT.wood, [0.42, 0.3, 0.18], y0, 0.5);
  b.add(G.cyl16, lm(M, 0.72, 0.56, 0.15, 0, 0.27, 0.12, 0.27), MAT.stone, [0.6, 0.58, 0.54]);
  b.add(G.cyl16, lm(M, 0.72, 0.68, 0.15, 0, 0.26, 0.1, 0.26), MAT.stone, [0.66, 0.64, 0.6]);
  beam(b, M, [0.86, 0.72, 0.25], [0.86, 0.9, 0.25], 0.035, MAT.wood, [0.5, 0.36, 0.2]);
  b.add(G.ico, lm(M, 0.25, 0.25, 0.62, 0.3, 0.24, 0.3, 0.2), MAT.cloth, [0.84, 0.8, 0.68]);
  b.add(G.cyl12, lm(M, 1.18, 0.38, -0.5, 0, 0.38, 0.76, 0.38), MAT.wood, [0.42, 0.3, 0.18], y0, 0.8);
  for (const y of [0.15, 0.62]) b.add(G.cyl12, lm(M, 1.18, y, -0.5, 0, 0.395, 0.05, 0.395), MAT.metal, [0.22, 0.21, 0.2]);
  b.add(G.cyl12, lm(M, 1.18, 0.74, -0.5, 0, 0.34, 0.02, 0.34), MAT.water, [0.3, 0.2, 0.08]);
  fires.push({ lx: -0.6, ly: 0.6, lz: 0.66, size: 0.26, light: { r: 5, k: 0.9 }, station: 'oven' }); // in the mouth, where its flames show
}
function stAlchemy(b, M, st, y0, fires) {
  const wood = [0.3, 0.2, 0.13];
  stTable(b, M, 1.9, 0.85, 0.86, wood, y0);
  // flasks of coloured glass, a mortar and pestle, a book, a copper still over a little brazier
  const glass = [[0.3, 0.6, 0.42], [0.35, 0.45, 0.75], [0.7, 0.3, 0.25], [0.6, 0.55, 0.3]];
  [[-0.7, -0.2], [-0.5, -0.25], [-0.6, 0.05], [-0.25, -0.22]].forEach(([x, z], k) => {
    const h = 0.16 + (k % 2) * 0.08;
    b.add(G.ico, lm(M, x, 0.97, z, 0, 0.08, 0.08, 0.08), MAT.window, glass[k]);
    b.add(G.cyl8, lm(M, x, 0.97 + h / 2 + 0.04, z, 0, 0.025, h, 0.025), MAT.window, glass[k]);
  });
  b.add(G.cyl12, lm(M, 0.1, 0.96, 0.18, 0, 0.1, 0.12, 0.1), MAT.stone, [0.62, 0.6, 0.56]);
  beam(b, M, [0.1, 0.98, 0.18], [0.16, 1.18, 0.1], 0.03, MAT.stone, [0.66, 0.64, 0.6]);
  b.add(G.box, lm(M, -0.2, 0.93, 0.22, 0.3, 0.32, 0.05, 0.24), MAT.cloth, [0.42, 0.12, 0.1]);
  b.add(G.box, lm(M, -0.2, 0.96, 0.22, 0.3, 0.3, 0.012, 0.22), MAT.plaster, [0.88, 0.84, 0.72]);
  // the still: a bowl on three legs at the end of the table, the pot and its pipe
  for (let k = 0; k < 3; k++) { const a = (k / 3) * TAU; beam(b, M, [0.62 + Math.sin(a) * 0.14, 0.91, -0.1 + Math.cos(a) * 0.14], [0.62 + Math.sin(a) * 0.1, 1.08, -0.1 + Math.cos(a) * 0.1], 0.02, MAT.metal, [0.2, 0.2, 0.2]); }
  b.add(G.frustum16, lm(M, 0.62, 1.1, -0.1, 0, 0.13, 0.06, 0.13, Math.PI), MAT.metal, [0.2, 0.19, 0.18]);
  b.add(G.ico, lm(M, 0.62, 1.32, -0.1, 0, 0.13, 0.12, 0.13), MAT.metal, [0.72, 0.42, 0.25]);
  b.add(G.cone8, lm(M, 0.62, 1.5, -0.1, 0, 0.06, 0.14, 0.06), MAT.metal, [0.72, 0.42, 0.25]);
  beam(b, M, [0.62, 1.55, -0.1], [0.88, 1.2, 0.12], 0.02, MAT.metal, [0.72, 0.42, 0.25]);
  b.add(G.cyl8, lm(M, 0.88, 0.99, 0.15, 0, 0.05, 0.1, 0.05), MAT.window, [0.4, 0.62, 0.5]);
  // a frame of drying herbs behind the table
  for (const sx of [-0.9, 0.9]) beam(b, M, [sx, 0, -0.55], [sx, 1.85, -0.55], 0.05, MAT.wood, wood, 0.05, y0);
  beam(b, M, [-0.95, 1.8, -0.55], [0.95, 1.8, -0.55], 0.04, MAT.wood, wood);
  const herb = [[0.3, 0.42, 0.18], [0.45, 0.3, 0.42], [0.38, 0.45, 0.42], [0.55, 0.32, 0.12]];
  for (let k = 0; k < 7; k++) { const x = -0.75 + k * 0.25; beam(b, M, [x, 1.8, -0.55], [x, 1.62, -0.55], 0.008, MAT.cloth, [0.7, 0.62, 0.45]); b.add(G.cone8, lm(M, x, 1.48, -0.55, k, 0.07, 0.3, 0.07, Math.PI), MAT.thatch, herb[k % 4]); }
  fires.push({ lx: 0.62, ly: 1.08, lz: -0.1, size: 0.18, light: { r: 3.2, k: 0.6 }, station: 'alchemy' });
}

/* ------------------------------------------------------------------ */
/* placing the stations                                                */
/* ------------------------------------------------------------------ */
const _stC = [];
// is the oriented box (x, z, hx, hz, yaw) clear: walkable, flat, off the road, no collider, house or floor in it?
function stationClear(x, z, hx, hz, yaw, pad = 0.55, roadMax = 0.5) {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  const y0 = heightAt(x, z);
  collidersNear(x, z, Math.hypot(hx, hz) + 4, _stC);
  for (let u = -1; u <= 1.001; u += 0.5) for (let v = -1; v <= 1.001; v += 0.5) {
    const lx = u * (hx + pad), lz = v * (hz + pad);
    const px = x + lx * c + lz * s, pz = z - lx * s + lz * c;
    if (!isWalkable(px, pz) || Math.abs(heightAt(px, pz) - y0) > 0.45 || sampleGrid(W.road, px, pz) > roadMax) return false;
    if (houseAt(px, pz, 0.6)) return false;
    for (const C of _stC) if (C.active && collCovers(C, px, pz, 0.15)) return false;
    const fl = FLOOR.grid.get(collKey(Math.floor(px / FLOOR.cell), Math.floor(pz / FLOOR.cell)));
    if (fl) for (const f of fl) if (floorTopOf(f, px, pz) !== null) return false;
  }
  return true;
}
function placeStation(kind, x, z, yaw, site, fireList) {
  const D = STATION_DEF[kind];
  const y = heightAt(x, z);
  const S = { kind, x, z, y, yaw, site, name: D.name };
  S.coll = addBox(x, z, D.hx, D.hz, yaw, 'prop', 2.2);
  // the worker stands in front
  S.fx = x + Math.sin(yaw) * (D.hz + 0.7); S.fz = z + Math.cos(yaw) * (D.hz + 0.7);
  CRAFT.stations.push(S);
  return S;
}
function buildStations() {
  const b = new Batch(), fires = [];
  BUILDING_DEPTH = BUILDING_DEPTH || depthFrom(buildingMat);
  const put = (kind, x, z, yaw, site, R) => {
    const S = placeStation(kind, x, z, yaw, site);
    const M = new THREE.Matrix4().compose(new THREE.Vector3(x, S.y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw, 0)), new THREE.Vector3(1, 1, 1));
    const fl = [];
    STATION_DEF[kind].build(b, M, STYLE[R.style], S.y, fl);
    for (const f of fl) { const p = worldOf(M, f.lx, f.ly, f.lz); fires.push({ ...f, x: p.x, y: p.y, z: p.z }); }
    return S;
  };
  for (const R of REALMS) {
    // the town's craft yard: round the plaza between the market and the houses, facing in, off the road
    const T = R.town;
    const order = ['forge', 'workbench', 'tanning', 'loom', 'oven', 'alchemy'];
    const done = new Set();
    // the townsfolk's ways: from each house door to the plaza, and the merchant's stall
    const ways = (T.houses || []).map((h) => { const d = (h.kind === 'hall' ? 6.5 : Math.max(h.w, h.d) * 0.62) + 0.8; return [{ x: h.x + Math.sin(h.yaw) * d, z: h.z + Math.cos(h.yaw) * d }, { x: T.x, z: T.z }]; });
    for (const q of T.props || []) if (q.type === 'stall' || q.type === 'well' || q.type === 'trough') ways.push([{ x: q.x, z: q.z }, { x: T.x, z: T.z }]);
    const onWay = (x, z, r) => ways.some(([A, B]) => segDist2(x, z, A.x, A.z, B.x, B.z) < r * r);
    for (const rr of [15, 17, 19.5, 13.5, 21]) for (let k = 0; k < 36 && done.size < order.length; k++) {
      const a = (k / 36) * TAU + 0.09;
      if (Math.abs(angDiff(a, 0)) < 0.5 || Math.abs(angDiff(a, Math.PI)) < 0.5) continue;
      const kind = order.find((o) => !done.has(o));
      const D = STATION_DEF[kind];
      const p = siteToWorld(T, Math.sin(a) * rr, Math.cos(a) * rr);
      const yaw = T.yaw + a + Math.PI;
      if (CRAFT.stations.some((S) => dist(S.x, S.z, p.x, p.z) < 4.6)) continue;
      if (onWay(p.x, p.z, Math.hypot(D.hx, D.hz) + 1.3)) continue;
      if (!stationClear(p.x, p.z, D.hx, D.hz, yaw)) continue;
      // room to stand at the front
      const fx = p.x + Math.sin(yaw) * (D.hz + 0.9), fz = p.z + Math.cos(yaw) * (D.hz + 0.9);
      if (!stationClear(fx, fz, 0.4, 0.4, yaw, 0.2)) continue;
      put(kind, p.x, p.z, yaw, T, R);
      done.add(kind);
    }
    // each keep: a workbench and a forge in the courtyard, clear of stairs, posts and the garrison's ways
    for (const K of R.keepSites) {
      const C = typeof castleOf === 'function' ? castleOf(K) : null;
      const routes = [];
      if (C) for (const pst of C.posts || []) { let prev = siteToWorld(K, 0, K.gateLocal.z - 2); for (const [lx, lz] of pst.route) { const q = siteToWorld(K, lx, lz); routes.push([prev, q]); prev = q; } }
      const gate = siteToWorld(K, 0, K.gateLocal.z), hall = siteToWorld(K, 0, -6);
      routes.push([gate, hall]);
      const nearRoute = (x, z, r) => routes.some(([A, B]) => segDist2(x, z, A.x, A.z, B.x, B.z) < r * r);
      const want = ['forge', 'workbench'];
      for (let lz = -2; lz <= 10 && want.length; lz += 1) for (let side = 0; side < 2 && want.length; side++) for (let lx = 6; lx <= 11 && want.length; lx += 1) {
        const x0 = side ? lx : -lx;
        const kind = want[0], D = STATION_DEF[kind];
        const p = siteToWorld(K, x0, lz);
        const yaw = K.yaw + Math.atan2(-x0, 2 - lz);
        if (CRAFT.stations.some((S) => dist(S.x, S.z, p.x, p.z) < 4.5)) continue;
        if (nearRoute(p.x, p.z, Math.hypot(D.hx, D.hz) + 1.6)) continue;
        if (!stationClear(p.x, p.z, D.hx, D.hz, yaw, 0.6, 1.1)) continue;
        put(kind, p.x, p.z, yaw, K, R);
        want.shift();
      }
    }
  }
  for (const f of fires) { addFire(f.x, f.y, f.z, f.size, false, Infinity, f.light); FIRES[FIRES.length - 1].station = STATION_DEF[f.station] ? STATION_DEF[f.station].name : f.station; }
  if (b.n) { const m = new THREE.Mesh(b.build(), buildingMat); m.renderOrder = 1; scene.add(m); shadowCaster(m, BUILDING_DEPTH); CRAFT.mesh = m; }
}
function stationNear(P, reach = 2.3) {
  let best = null, bd = Infinity;
  for (const S of CRAFT.stations) {
    const D = STATION_DEF[S.kind];
    // distance to the station's box, from where the player stands
    const dx = P.x - S.x, dz = P.z - S.z, c = Math.cos(S.yaw), s = Math.sin(S.yaw);
    const lx = dx * c - dz * s, lz = dx * s + dz * c;
    const d = Math.hypot(Math.max(0, Math.abs(lx) - D.hx), Math.max(0, Math.abs(lz) - D.hz));
    if (d < reach && d < bd && Math.abs(P.y - S.y) < 2) { bd = d; best = S; }
  }
  return best ? { S: best, d: bd } : null;
}

/* ------------------------------------------------------------------ */
/* rocks: stone by hand, flint and iron ore with a pick                */
/* ------------------------------------------------------------------ */
function rockNear(P) {
  let best = null, bd = Infinity;
  for (let i = 0; i < W.rocks.length; i++) {
    const r = W.rocks[i];
    if (r.s < 0.55) continue;
    const d = dist(P.x, P.z, r.x, r.z) - r.s * 0.8;
    if (d < 1.4 && d < bd) { const R = CRAFT.rocks.get(i); if (R && R.n <= 0) continue; bd = d; best = i; }
  }
  return best === null ? null : { i: best, d: Math.max(0.05, bd) };
}
function mineStart(i) {
  const P = GAME.player, r = W.rocks[i];
  if (!P || !r) return;
  if (P.mount) dismount(P);
  const pick = goodsHave('tool_pick');
  const yaw = Math.atan2(r.x - P.x, r.z - P.z);
  const need = pick ? 3 : 5;
  let swings = 0;
  setAct(P, 1, 0.62);
  survStartJob({ kind: 'mine', label: pick ? 'Mining' : 'Breaking stone', dur: 0.95 / skillWorkRate('mining'), n: need, i: 0, yaw, rock: i, tool: WB.axe, done: (J) => {
    swings++;
    J.i = swings;
    const ux = Math.sin(yaw), uz = Math.cos(yaw);
    const hx = r.x - ux * r.s * 0.7, hz = r.z - uz * r.s * 0.7, hy = Math.max(heightAt(hx, hz) + 0.4, r.y + r.s * 0.35);
    for (let k = 0; k < 12; k++) { const g = 0.45 + Math.random() * 0.2; fxAlpha.emit(hx, hy, hz, -ux * (1 + Math.random() * 2.5) + (Math.random() - 0.5) * 2, 1.2 + Math.random() * 2.2, -uz * (1 + Math.random() * 2.5) + (Math.random() - 0.5) * 2, 0.7 + Math.random() * 0.4, g, g * 0.97, g * 0.92, 0.04 + Math.random() * 0.04, 9, 0.6); }
    FX.dust(hx, hy - 0.3, hz, 3, [0.55, 0.53, 0.5]);
    if (pick) FX.burst(hx, hy, hz, 6, [2.4, 1.7, 0.8], 3, 0.25, 0.05, 9);
    survSfx(pick ? 'clink' : 'mine', r.x, r.z);
    if (swings < need) { setAct(P, 1, 0.62); return true; }
    mineYield(i, pick);
    return false;
  } });
}
function mineYield(i, pick) {
  const r = Number.isInteger(i) && W.rocks[i];
  if (!r || r.s < 0.55) return false;
  if (typeof netWorldPartsRequest === 'function' && netWorldPartsRequest('resource.mine', { i, pick: !!pick })) return false;
  if (pick && !goodsHave('tool_pick')) return false;
  const previous = CRAFT.rocks.get(i);
  if (previous && previous.n <= 0) {
    if (GAME.t < previous.until) return false;
    CRAFT.rocks.delete(i);
  }
  const rocky = sampleGrid(W.rock, r.x, r.z) > 0.25 || r.y > 12;
  const got = [];
  const give = (id, n) => { const k = goodsAdd(id, n, true); if (k) { got.push(`${k} ${goodName(id, k).toLowerCase()}`); activityRecord('resource.gathered', id, k, { success: true }); } };
  give('stone', pick ? 2 + (Math.random() < 0.5 ? 1 : 0) : 1 + (Math.random() < 0.4 ? 1 : 0));
  if (Math.random() < (pick ? 0.38 : 0.1)) give('flint', 1);
  if (pick && Math.random() < (rocky ? 0.5 : 0.28)) give('iron_ore', 1 + (rocky && Math.random() < 0.3 ? 1 : 0));
  uiLog(got.length ? `You break off ${got.join(', ')}.` : 'Nothing worth keeping comes away.', 'loot');
  if (!pick && Math.random() < 0.6) uiLog('A pick would break out flint and iron ore as well.', 'sys');
  const R = CRAFT.rocks.get(i) || { n: 3, until: 0 };
  R.n--;
  if (R.n <= 0) { R.until = GAME.t + 900; uiLog('This rock is worked out for now.', 'sys'); }
  CRAFT.rocks.set(i, R);
  if (got.length) skillGain('mining', 0.3);
  sfx('loot');
  saveSoon();
  return true;
}
// Sparse shared depletion; remaining cooldowns survive a keeper with a different clock.
const CRAFT_SHARED_ROCK_CAP = 900;
function craftRocksSharedSave() {
  if (CRAFT.rocks.size > CRAFT_SHARED_ROCK_CAP) throw Error('Shared mineral capacity exceeded');
  const rocks = [];
  for (const [i, r] of CRAFT.rocks) {
    if (!Number.isInteger(i) || i < 0 || i >= CRAFT_SHARED_ROCK_CAP || !r
      || !Number.isInteger(r.n) || r.n < 0 || r.n > 2 || !Number.isFinite(r.until))
      throw Error('Invalid shared mineral state');
    const left = r.n === 0 ? Math.ceil(Math.max(0, Math.min(900, r.until - GAME.t))) : 0;
    if (r.n === 0 && left === 0) continue;
    rocks.push([i, r.n, left]);
  }
  rocks.sort((a, b) => a[0] - b[0]);
  return { v: 1, rocks };
}
function craftRocksSharedApply(value) {
  const next = new Map();
  if (value != null) {
    if (!value || value.v !== 1 || !Array.isArray(value.rocks) || value.rocks.length > CRAFT_SHARED_ROCK_CAP)
      throw Error('Invalid shared mineral state');
    for (const row of value.rocks) {
      if (!Array.isArray(row) || row.length !== 3) throw Error('Invalid shared mineral state');
      const [i, n, left] = row;
      if (!Number.isInteger(i) || i < 0 || i >= CRAFT_SHARED_ROCK_CAP || next.has(i)
        || !Number.isInteger(n) || n < 0 || n > 2 || !Number.isInteger(left) || left < 0 || left > 900
        || n > 0 && left !== 0) throw Error('Invalid shared mineral state');
      next.set(i, { n, until: n === 0 ? GAME.t + left : 0 });
    }
  }
  CRAFT.rocks.clear();
  for (const [i, row] of next) CRAFT.rocks.set(i, row);
  CRAFT.rockT = 0;
}
function stepRocks(dt) {
  CRAFT.rockT -= dt;
  if (CRAFT.rockT > 0) return;
  CRAFT.rockT = 5;
  for (const [i, R] of CRAFT.rocks) if (R.n <= 0 && GAME.t >= R.until) CRAFT.rocks.delete(i);
  craftHand();
}

/* ------------------------------------------------------------------ */
/* making things                                                       */
/* ------------------------------------------------------------------ */
// why a recipe cannot be made here and now (null if it can)
function craftBlock(rec, ctx = {}) {
  const P = GAME.player;
  if (!P || !P.alive) return 'You cannot do that now';
  if (!recipeFor(rec, P)) return `Only ${rec.cls.map((c) => CLASSES[c].name.toLowerCase() + 's').join(' and ')} make that`;
  if ((rec.min || 0) > (SURV.skill.craft || 0)) return `Needs crafting skill ${rec.min}`;
  const dw = depthCraftBlock(rec); if (dw) return dw; // [depth] the late recipes want a seasoned hand (09u_depth.js)
  if (rec.st === 'fire' && !ctx.fire) return 'Cook this at a fire';
  if (rec.st !== 'fire' && rec.st !== 'hand' && !(ctx.station && ctx.station.kind === rec.st)) return `Make this at a ${STATION_DEF[rec.st].name}`;
  if (rec.pot && !goodsHave('tool_pot') && !fireHasPot(ctx.fire)) return 'You need a cooking pot, or a hearth with one';
  if (rec.act === 'draught' && INV.potions >= POTION.max) return `You can carry ${POTION.max} draughts`;
  if (rec.act === 'campfire' && (!NATURE.built || inDungeon(P) || INDOOR.on || P.mount)) return 'Lay a campfire out in the open';
  if (rec.act === 'mend' && !kitItems().some((it) => itemDur(it) < DUR_MAX)) return 'Nothing needs mending';
  if (rec.gear && INV.bag.length >= BAG_SIZE) return 'Your bags are full';
  if (rec.make && goodsCount(rec.make[0]) >= (GOODS[rec.make[0]] ? GOODS[rec.make[0]].stack : 999)) return 'You cannot carry more of that';
  if (!recipeHas(rec)) return 'You are missing some of what it needs';
  return null;
}
function craftGear(rec) {
  const P = GAME.player, sk = SURV.skill.craft || 0;
  const q = rollQuality(craftOdds(sk));
  const it = makeItem({ cls: P.cls, realm: P.faction, lvl: depthCraftLvl(rec), lvlCap: 50, q, slot: rec.gear.slot }); // [depth] item level by the recipe's tier, to 50
  const base = typeof rec.gear.base === 'string' ? rec.gear.base : rec.gear.base && rec.gear.base[P.cls];
  if (base && base !== it.base) { if (it.name.includes(it.base)) it.name = it.name.split(it.base).join(base); it.base = base; }
  if (rec.gear.vis) it.vis = rec.gear.vis;
  depthCraftGear(rec, it, sk); // [depth] masterworks and the master's bonus stat (09u_depth.js)
  if (!bagAdd(it)) dropItem(it, P.x, P.z, P.y + 1);
  if (q >= 3) { sfx('lootRare'); FX.burst(P.x, P.y + 1.2, P.z, 16, QUALITY[q].rgb.map((v) => v * 1.6), 1.4, 0.6, 0.1, -0.5); }
  return it;
}
function survCraftOnce(rec, ctx = {}) {
  const why = craftBlock(rec, ctx);
  if (why) { activityRecord('craft.refused', rec.id || 'recipe', null, { success: false, reason: 'requirements' }); if (!ctx.silent) uiError(why); return false; }
  const P = GAME.player;
  if (!goodsTakeAll(rec.need)) return false;
  const skins = rec.need.reduce((n, q) => n + (q[0] === 'water' ? q[1] : 0), 0);
  if (skins) goodsAdd('waterskin_empty', skins, true); // [water] the water is used, the skins come back empty
  const key = recipeSkill(rec), sk = SURV.skill[key] || 0;
  // a skilled hand wastes less
  if (rec.waste && Math.random() < sk / 250) { goodsAdd(rec.waste, 1, true); uiLog(`Your skill saves you ${/^[aeiou]/i.test(goodName(rec.waste)) ? 'an' : 'a'} ${goodName(rec.waste).toLowerCase()}.`, 'sys'); }
  let msg = '';
  if (rec.make) {
    let n = rec.make[1];
    if (key === 'cook' && Math.random() < sk / 220) n++;
    const got = goodsAdd(rec.make[0], n, true);
    msg = `You make ${got} ${goodName(rec.make[0], got).toLowerCase()}.`;
  } else if (rec.gear) {
    const it = craftGear(rec);
    msg = `You make ${it.name}: ${QUALITY[it.q].name.toLowerCase()}, item level ${it.lvl}.`;
    if (UI.modal === 'kit') renderKit();
  } else if (rec.act === 'campfire') {
    const fx = P.x + Math.sin(P.yaw) * 1.5, fz = P.z + Math.cos(P.yaw) * 1.5;
    const sp = natClearSpot(fx, fz, P.x, P.z, 0.7);
    natAddPile(sp.x, sp.z, P.yaw, 'oak');
    msg = 'You stack the firewood. Press E by it to light it.';
  } else if (rec.act === 'mend') {
    const k = goodsHave('tool_hammer') ? DUR_MAX : DUR_MAX * 0.5;
    for (const it of kitItems()) if (itemDur(it) < DUR_MAX) it.dur = Math.min(DUR_MAX, itemDur(it) + k);
    applyGear();
    msg = goodsHave('tool_hammer') ? 'You mend everything good as new.' : 'You mend the worst of the wear. Your own hammer would do it all.';
  } else if (rec.act === 'draught') {
    INV.potions = Math.min(POTION.max, INV.potions + 1);
    msg = `You bottle a healing draught (${INV.potions} / ${POTION.max}).`;
  }
  skillGain(key, rec.diff || 1);
  activityRecord('craft.completed', rec.id || rec.act || 'recipe', 1, { success: true });
  guideMade(rec); // [guide] a meal cooked or a thing made takes its step on your path (10e_guide.js)
  if (msg && !ctx.quiet) uiLog(msg, 'loot');
  GOODS_UI.dirty = true;
  saveSoon();
  return true;
}
// the work at each station: the right motion, the right tool in hand, sparks, shavings, steam and sound
const CRAFT_MOTION = { forge: [1, 'clink', 0.95], workbench: [1, 'saw', 1.0], tanning: [5, 'scrape', 1.1], loom: [5, 'loom', 1.1], oven: [5, null, 1.2], alchemy: [3, 'bubble', 1.6], fire: [5, 'sizzle', 1.4], hand: [5, null, 1.2] };
function craftStart(rec, n, ctx) {
  const P = GAME.player;
  const why = craftBlock(rec, ctx);
  if (why) { activityRecord('craft.refused', rec.id || 'recipe', null, { success: false, reason: 'requirements' }); uiError(why); return false; }
  if (P.mount) dismount(P);
  const st = rec.st, at = ctx.station || ctx.fire;
  const yaw = at ? Math.atan2(at.x - P.x, at.z - P.z) : P.yaw;
  const sk = SURV.skill[recipeSkill(rec)] || 0;
  const [act, snd, every] = CRAFT_MOTION[st] || CRAFT_MOTION.hand;
  survStartJob({ kind: 'craft', label: rec.name, dur: rec.time * (1 - 0.3 * sk / 100), n, i: 0, yaw, rec, station: ctx.station || null, fire: ctx.fire || null,
    tool: st === 'forge' ? WB.mace : -1, next: 0, // a hammer at the anvil; hands free for the rest
    tick: (J) => {
      if (J.t < J.next) return;
      J.next = J.t + every;
      setAct(P, act, every * 0.85);
      const S = J.station, f = J.fire;
      if (snd) survSfx(snd, P.x, P.z);
      if (S && S.kind === 'forge') later(0.3, () => { const ax = S.x + Math.cos(S.yaw) * 0.72 + Math.sin(S.yaw) * 0.22, az = S.z - Math.sin(S.yaw) * 0.72 + Math.cos(S.yaw) * 0.22; FX.burst(ax, S.y + 0.85, az, 10, [2.6, 1.6, 0.6], 3.2, 0.3, 0.05, 9); lightFlash(ax, S.y + 1, az, 3, [2.4, 1.4, 0.5], 0.15); });
      else if (S && S.kind === 'workbench') natChips(P.x + Math.sin(J.yaw) * 0.8, P.y + 0.95, P.z + Math.cos(J.yaw) * 0.8, Math.sin(J.yaw), Math.cos(J.yaw), 5);
      else if (S && S.kind === 'alchemy') for (let k = 0; k < 4; k++) fxAlpha.emit(S.x + (Math.random() - 0.5) * 0.2, S.y + 1.6, S.z + (Math.random() - 0.5) * 0.2, 0, 0.5 + Math.random() * 0.3, 0, 1.6, 0.7, 0.8, 0.75, -0.18, -0.05, 0.1);
      else if (f) for (let k = 0; k < 3; k++) fxAlpha.emit(f.x + (Math.random() - 0.5) * 0.3, f.y + 0.6, f.z + (Math.random() - 0.5) * 0.3, 0, 0.7, 0, 2, 0.55, 0.52, 0.5, -0.22, -0.05, 0.1);
    },
    done: (J) => {
      const ok = survCraftOnce(rec, { station: J.station, fire: J.fire, silent: J.i > 0 });
      if (!ok) return false;
      J.i++;
      if (UI.modal === 'craft') renderCraft();
      return J.i < J.n && !craftBlock(rec, { station: J.station, fire: J.fire });
    } });
  return true;
}
// the tool in hand while working: the woodsman's axe at the rock and the bench, a hammer (the mace) at the anvil
function craftHand() {
  const P = GAME.player, H = CRAFT.hand;
  if (!P || !P.look) { H.on = false; return; }
  const Lk = P.look, J = SURV.job, want = J && P.alive && J.tool ? J.tool : 0;
  if (want) {
    const bit = want > 0 ? want : 0; // -1: both hands free, the weapon put away
    if (!H.on || H.look !== Lk || (Lk.mask & WEAPON_BITS) !== bit) {
      if (!H.on || H.look !== Lk) H.keep = Lk.mask & WEAPON_BITS;
      Lk.mask = (Lk.mask & ~WEAPON_BITS) | bit;
      H.on = true; H.look = Lk; H.bit = bit;
    }
  } else if (H.on) {
    if (H.look === Lk && (Lk.mask & WEAPON_BITS) === H.bit) Lk.mask = (Lk.mask & ~WEAPON_BITS) | H.keep;
    H.on = false; H.look = null;
  }
}

/* ------------------------------------------------------------------ */
/* offers: stations and rocks (from survivalOffers)                    */
/* ------------------------------------------------------------------ */
function craftOffers(P, offer) {
  const s = stationNear(P);
  if (s) offer(Math.max(0.05, s.d), 2.3, STATION_DEF[s.S.kind].verb, () => openCraft(s.S.kind, s.S), 0.1);
  if (!SURV.job) {
    const r = rockNear(P);
    if (r) offer(r.d, 1.4, goodsHave('tool_pick') ? 'Mine the rock' : 'Break stone from the rock', () => mineStart(r.i), -0.02);
  }
}

/* ------------------------------------------------------------------ */
/* the crafting book                                                   */
/* ------------------------------------------------------------------ */
function bindCraftUI() {
  if ($('craft')) return;
  const ov = document.createElement('div');
  ov.className = 'overlay';
  ov.id = 'craft';
  ov.hidden = true;
  ov.innerHTML = `<div class="sheet panel craftsheet" role="dialog" aria-labelledby="craft-title">
    <div class="kithead"><h2 id="craft-title">Crafting</h2><span class="skilltag" id="craft-skill"></span><button class="btn" id="craft-close" type="button">Close</button></div>
    <div class="seg" id="craft-tabs" role="tablist"></div>
    <p class="craftblurb" id="craft-blurb"></p>
    <div class="craftbody"><div class="craftlist" id="craft-list"></div><div class="craftcard" id="craft-card"></div></div>
  </div>`;
  document.body.appendChild(ov);
  ov.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.id === 'craft-close') { closeCraft(); return; }
    if (b.dataset.tab) { CRAFT.ui.tab = b.dataset.tab; CRAFT.ui.sel = null; renderCraft(); sfx('click'); return; }
    if (b.dataset.rec) { CRAFT.ui.sel = b.dataset.rec; renderCraft(); sfx('click'); return; }
    if (b.dataset.make) {
      const rec = RECIPE_BY_ID[b.dataset.make];
      if (rec) { craftStart(rec, Math.max(1, +b.dataset.n || 1), craftCtx(rec)); renderCraft(); }
      return;
    }
    if (b.dataset.stop) { survStopJob('You stop working.'); return; }
  });
  bgClose('craft', () => closeCraft());
}
// where the player can make a recipe right now
function craftCtx(rec) {
  const P = GAME.player;
  const ctx = {};
  if (rec.st === 'fire') ctx.fire = CRAFT.ui.ref && CRAFT.ui.st === 'fire' && FIRES.includes(CRAFT.ui.ref) ? CRAFT.ui.ref : fireNear(P, 3);
  else if (rec.st !== 'hand') { const s = CRAFT.ui.ref && CRAFT.ui.ref.kind === rec.st && dist(P.x, P.z, CRAFT.ui.ref.x, CRAFT.ui.ref.z) < 4 ? { S: CRAFT.ui.ref } : stationNear(P, 3); if (s && s.S.kind === rec.st) ctx.station = s.S; }
  return ctx;
}
function openCraft(st, ref = null) {
  const P = GAME.player;
  if (!P || (UI.modal && UI.modal !== 'craft')) return;
  if (!$('craft')) bindCraftUI();
  if (!st) {
    const s = stationNear(P, 2.6), f = fireNear(P, 2.7);
    if (s) { st = s.S.kind; ref = s.S; } else if (f) { st = 'fire'; ref = f; }
  }
  if (st === 'fire' && !ref) ref = fireNear(P, 3);
  CRAFT.ui.st = st; CRAFT.ui.ref = ref; CRAFT.ui.tab = st ? 'here' : 'hand'; CRAFT.ui.sel = null;
  UI.modal = 'craft';
  $('craft').hidden = false;
  renderCraft();
  sfx('bagOpen');
}
function closeCraft() { const el = $('craft'); if (el) el.hidden = true; if (UI.modal === 'craft') UI.modal = null; }
function recipesFor(tab) {
  const P = GAME.player, st = CRAFT.ui.st;
  const mine = RECIPES.filter((r) => recipeFor(r, P));
  if (tab === 'here') return mine.filter((r) => r.st === st);
  if (tab === 'hand') return mine.filter((r) => r.st === 'hand');
  if (tab === 'fire') return mine.filter((r) => r.st === 'fire');
  return mine;
}
const needLine = (rec, k = 1) => rec.need.map(([id, n]) => { const have = goodsCount(id); return `<span class="${have >= n * k ? 'ok' : 'short'}">${n * k} ${esc(goodName(id, n * k).toLowerCase())} <i>${have}</i></span>`; }).join('');
function renderCraft() {
  const el = $('craft');
  if (!el || el.hidden) return;
  const P = GAME.player, U2 = CRAFT.ui, st = U2.st;
  $('craft-title').textContent = st ? (st === 'fire' ? `Cooking at ${fireName(U2.ref || {})}` : `The ${STATION_DEF[st].name}`) : 'Crafting';
  const key = st === 'fire' || st === 'oven' ? 'cook' : 'craft';
  const sv = SURV.skill[key] || 0;
  $('craft-skill').innerHTML = `${SKILL_NAMES[key]} <b>${Math.floor(sv)}</b> · ${skillRank(sv)}`;
  const tabs = [];
  if (st) tabs.push(['here', STATIONS[st].short]);
  if (st && st !== 'fire' && fireNear(P, 3.2)) tabs.push(['fire', 'Cooking']); // the forge, the oven and the still have fires
  tabs.push(['hand', 'By hand'], ['all', 'All recipes']);
  $('craft-tabs').innerHTML = tabs.map(([k, l]) => `<button type="button" data-tab="${k}" aria-checked="${U2.tab === k}">${l}</button>`).join('');
  $('craft-blurb').textContent = U2.tab === 'here' && st ? STATIONS[st].blurb : U2.tab === 'fire' ? STATIONS.fire.blurb : U2.tab === 'hand' ? STATIONS.hand.blurb : 'Every recipe for your calling, and where it is made. Workstations stand in every town; keeps have a forge and a workbench.';
  const list = recipesFor(U2.tab);
  if (!U2.sel || !list.some((r) => r.id === U2.sel)) { const can = list.find((r) => !craftBlock(r, craftCtx(r))); U2.sel = (can || list[0] || {}).id || null; }
  let html = '';
  let lastSt = null;
  for (const r of list) {
    if (U2.tab === 'all' && r.st !== lastSt) { lastSt = r.st; html += `<h4>${STATIONS[r.st].name}</h4>`; }
    const why = craftBlock(r, craftCtx(r));
    const can = recipeCanMake(r) ? Math.max(0, Math.min(...r.need.map(([id, n]) => Math.floor(goodsCount(id) / n)))) : 0;
    const icon = r.gear ? itemIcon({ slot: r.gear.slot, vis: r.gear.vis || '' }, r.gear.slot) : r.make ? (GOODS[r.make[0]] || {}).icon || 'bag' : r.icon || (r.act === 'draught' ? 'potion' : r.act === 'mend' ? 'hammer' : 'bag');
    html += `<button type="button" class="crow${U2.sel === r.id ? ' sel' : ''}${why ? '' : ' can'}" data-rec="${r.id}"><span class="ic">${iconSvg(icon, 20)}</span><span class="nm">${esc(r.name)}<small>${r.need.map(([id, n]) => `${n} ${esc(goodName(id, n).toLowerCase())}`).join(' · ')}</small></span>${can ? `<span class="ct">${can}</span>` : ''}</button>`;
  }
  $('craft-list').innerHTML = html || '<p class="fineprint">Nothing to make here.</p>';
  // the card for the chosen recipe
  const rec = RECIPE_BY_ID[U2.sel];
  let card = '';
  if (rec) {
    const ctx = craftCtx(rec), why = craftBlock(rec, ctx);
    const out = rec.make ? `${rec.make[1]} ${esc(goodName(rec.make[0], rec.make[1]).toLowerCase())}` : rec.gear ? `a piece of ${SLOT_NAME[rec.gear.slot].toLowerCase()} gear for a ${CLASSES[P.cls].name.toLowerCase()}, item level ${depthCraftLvl(rec)}` : rec.act === 'draught' ? 'a healing draught' : '';
    card += `<b class="cn">${esc(rec.name)}</b><span class="sub">${esc(STATIONS[rec.st].name)}${rec.min ? ` · needs crafting ${rec.min}` : ''}${rec.pot ? ' · needs a pot or a hearth' : ''}</span><p>${esc(rec.desc || '')}</p>`;
    card += `<div class="needs-list">${needLine(rec)}</div>`;
    if (out) card += `<span class="out">Makes ${out}</span>`;
    if (rec.gear) {
      const od = craftOdds(SURV.skill.craft || 0), tot = od.reduce((a, b) => a + b, 0);
      card += `<div class="odds" aria-label="Chances of each grade">${od.map((w, q) => (w > 0.2 ? `<i style="--w:${(w / tot * 100).toFixed(1)}%;--qc:${QUALITY[q].col}" title="${QUALITY[q].name} ${Math.round(w / tot * 100)}%"></i>` : '')).join('')}</div><span class="sub">${od.map((w, q) => (w / tot >= 0.01 ? `<span style="color:${QUALITY[q].col}">${QUALITY[q].name} ${Math.round(w / tot * 100)}%</span>` : '')).filter(Boolean).join(' · ')}. Better skill, better odds.</span>`;
    }
    const J = SURV.job;
    if (J && J.kind === 'craft' && J.rec === rec) card += `<div class="cprog"><div class="bar thin" style="--c:#e8c46a"><i style="width:${(clamp(J.t / J.dur, 0, 1) * 100).toFixed(1)}%"></i></div><span>${J.i + 1} / ${J.n}</span><button class="btn" type="button" data-stop="1">Stop</button></div>`;
    const can = !why ? Math.min(10, Math.max(1, Math.min(...rec.need.map(([id, n]) => Math.floor(goodsCount(id) / n))))) : 0;
    card += `<div class="acts"><button class="btn primary" type="button" data-make="${rec.id}" data-n="1" ${why ? 'disabled' : ''}>Make</button>${can > 1 ? `<button class="btn" type="button" data-make="${rec.id}" data-n="${can}">Make ${can}</button>` : ''}</div>`;
    if (why) card += `<span class="why">${esc(why)}.</span>`;
  }
  $('craft-card').innerHTML = card || `<p class="fineprint">Choose something to make.</p>`;
}
// the progress bar in the open book follows the work
function drawCraftUI() {
  if (UI.modal !== 'craft') return;
  const J = SURV.job;
  const bar = document.querySelector('#craft-card .cprog .bar i');
  if (bar && J) bar.style.width = (clamp(J.t / J.dur, 0, 1) * 100).toFixed(1) + '%';
}


// Job animation stays with its player; depletion and yields belong to the world.
queueMicrotask(() => {
  if (typeof netWorldPartsRegister === 'function')
    netWorldPartsRegister('resources', { save: craftRocksSharedSave, apply: craftRocksSharedApply });
  if (typeof netWorldPartsRegisterCommand !== 'function') return;
  netWorldPartsRegisterCommand('resource.mine', {
    tools: ['tool_pick'], range: 5,
    point: a => Number.isInteger(a?.i) && W.rocks[a.i] || { x: Infinity, z: Infinity },
    run: a => mineYield(a.i, a.pick === true),
  });
});
