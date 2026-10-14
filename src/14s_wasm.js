// [perf3] WebAssembly, measured (CLAUDE.md, Phones and performance, [perf3]): localPath's A* (08f_townlife.js) in a module
// of its own (tools/wasm/lp_astar.wat, embedded as base64 in 14s_wasm_bin.js: no network, compiled at the first search,
// nothing at the boot). `WASM.lp` on: the search runs there, step for step as lpSearchJS (the same way comes out: the
// heuristic is a table of Math.hypot the page fills, the costs kept as f32 as the JS keeps them); off, or anything amiss
// (no WebAssembly, a heap too small for a search), the JS. `tools/tests/wasm_lp.js` compares both on thousands of grids.
const WASM = {
  lp: true, // the switch (tests turn it off and on: a measure, both ways)
  mods: {}, failed: {},
  L: { N: 0, cap: 0, TW: 0, TH: 0, pB: 0, pGs: 0, pFrom: 0, pStamp: 0, pShut: 0, pHf: 0, pHk: 0, pHt: 0, gen: 0, u8: null, buf: null },
  stats: { lpWasm: 0, lpJs: 0, lpHeap: 0, compileMs: 0, grows: 0, tables: 0 },
};
function wasmModule(name) {
  if (WASM.mods[name] || WASM.failed[name]) return WASM.mods[name] || null;
  try {
    if (typeof WebAssembly !== 'object' || typeof WASM_BIN !== 'object' || !WASM_BIN[name]) throw new Error('none');
    const t = performance.now(), bin = atob(WASM_BIN[name]), u = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    // a module this small may be compiled on the main thread at once (Chrome allows up to 4 KB)
    WASM.mods[name] = new WebAssembly.Instance(new WebAssembly.Module(u), {}).exports;
    WASM.stats.compileMs += performance.now() - t;
  } catch (e) { WASM.failed[name] = String(e && e.message || e); }
  return WASM.mods[name] || null;
}
// the memory laid out for a grid of N cells W wide and H high (grown, never shrunk); the stamps begin again at 0
function wasmLpLayout(M, N, W, H) {
  const L = WASM.L, mem = M.mem;
  if (N <= L.N && W <= L.TW && H <= L.TH && L.buf === mem.buffer) return;
  const n = Math.max(N, L.N), cap = n * 4 + 1024, TW = Math.max(W, L.TW), TH = Math.max(H, L.TH);
  const al = (v) => (v + 7) & ~7;
  const pB = 0, pGs = al(pB + n), pFrom = pGs + n * 4, pStamp = pFrom + n * 4, pShut = pStamp + n * 4, pHf = al(pShut + n * 4), pHk = pHf + cap * 8, pHt = al(pHk + cap * 4), end = pHt + TW * TH * 8;
  const pages = Math.ceil(end / 65536) - mem.buffer.byteLength / 65536;
  if (pages > 0) { mem.grow(pages); WASM.stats.grows++; }
  const u8 = new Uint8Array(mem.buffer);
  u8.fill(0, pStamp, pShut + n * 4); // the stamps and the shut marks: no call's yet
  // the heuristic: Math.hypot of every |di|, |dj| (the JS's own numbers, so both searches order their heaps alike)
  const ht = new Float64Array(mem.buffer, pHt, TW * TH);
  for (let j = 0; j < TH; j++) for (let i = 0; i < TW; i++) ht[j * TW + i] = Math.hypot(i, j);
  Object.assign(L, { N: n, cap, TW, TH, pB, pGs, pFrom, pStamp, pShut, pHf, pHk, pHt, gen: 0, u8, buf: mem.buffer });
  WASM.stats.tables++;
}
// localPath's search: LP.blocked holds the grid; fills LP.fromV (the parents) and says whether g was reached
function lpSearch(W, Hh, N, s, g) {
  const M = WASM.lp && wasmModule('lp_astar');
  if (!M) { WASM.stats.lpJs++; return lpSearchJS(W, Hh, N, s, g); }
  wasmLpLayout(M, N, W, Hh);
  const L = WASM.L;
  L.u8.set(LP.blocked.subarray(0, N), L.pB);
  L.gen = (L.gen + 1) >>> 0;
  if (!L.gen) { L.u8.fill(0, L.pStamp, L.pShut + L.N * 4); L.gen = 1; }
  const r = M.search(W, Hh, s, g, L.gen | 0, L.pB, L.pGs, L.pFrom, L.pStamp, L.pShut, L.pHf, L.pHk, L.cap, L.pHt, L.TW);
  if (r === -2) { WASM.stats.lpHeap++; return lpSearchJS(W, Hh, N, s, g); }
  WASM.stats.lpWasm++;
  LP.fromV = new Int32Array(L.buf, L.pFrom, N);
  return r === 1;
}
