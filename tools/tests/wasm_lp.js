// [perf3] localPath's A* in WebAssembly against the JS, in Node: the same parents and the same answer on every grid, then
// both timed. usage: node tools/tests/wasm_lp.js [n=4000] [seed=1] [time]
const fs = require('fs'), path = require('path'), vm = require('vm');
const OPT = Object.fromEntries(process.argv.slice(2).filter((a) => a.includes('=')).map((a) => a.split('=')));
const SRC = path.join(__dirname, '../../src');
const tl = fs.readFileSync(path.join(SRC, '08f_townlife.js'), 'utf8');
const cut = (s, from, to) => { const a = s.indexOf(from), b = s.indexOf(to, a); if (a < 0 || b < 0) throw new Error('not found: ' + from); return s.slice(a, b); };
const code = [
  cut(tl, 'const LP = {', '\nconst lpWalkArr'),
  cut(tl, 'function lpGrow(', '\nfunction localPath('),
  fs.readFileSync(path.join(SRC, '14s_wasm.js'), 'utf8'),
  fs.readFileSync(path.join(SRC, '14s_wasm_bin.js'), 'utf8'),
  'globalThis.T = { LP, lpGrow, lpSearch, lpSearchJS, WASM };',
].join('\n');
const ctx = vm.createContext({ Math, performance, WebAssembly, atob, Uint8Array, Int32Array, Uint32Array, Float32Array, Float64Array, Object, Error, String, console, globalThis: {} });
ctx.globalThis = ctx;
vm.runInContext(code, ctx);
const { LP, lpGrow, lpSearch, WASM } = ctx.T;
let seed = +(OPT.seed || 1);
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
// a grid like localPath's: open ground with walls, posts and boxes
function grid(W, H) {
  const N = W * H; lpGrow(N); const b = LP.blocked; b.fill(0, 0, N);
  const dens = rnd() * 0.35;
  for (let i = 0; i < N; i++) if (rnd() < dens * 0.3) b[i] = 1;
  const walls = Math.floor(rnd() * 8);
  for (let w = 0; w < walls; w++) {
    const horiz = rnd() < 0.5, at = Math.floor(rnd() * (horiz ? H : W)), from = Math.floor(rnd() * (horiz ? W : H)), len = Math.floor(rnd() * (horiz ? W : H)), gap = Math.floor(rnd() * len);
    for (let t = 0; t < len; t++) { if (t === gap || t === gap + 1) continue; const i = horiz ? from + t : at, j = horiz ? at : from + t; if (i < W && j < H) b[j * W + i] = 1; }
  }
  return N;
}
const n = +(OPT.n || 4000);
let same = 0, diff = 0, foundN = 0, cells = 0;
const cases = [];
for (let c = 0; c < n; c++) {
  const big = rnd() < 0.15;
  const W = 2 + Math.floor(rnd() * (big ? 300 : 80)), H = 2 + Math.floor(rnd() * (big ? 300 : 80));
  const N = grid(W, H), s = Math.floor(rnd() * N), g = Math.floor(rnd() * N);
  LP.blocked[s] = 0; LP.blocked[g] = 0;
  const bl = LP.blocked.slice(0, N);
  cases.push({ W, H, N, s, g, bl });
  WASM.lp = false; const fj = lpSearch(W, H, N, s, g); const pj = []; for (let k = g; k !== -1 && pj.length <= N; k = k === s ? -1 : LP.fromV[k]) pj.push(k);
  WASM.lp = true; const fw = lpSearch(W, H, N, s, g); const pw = []; for (let k = g; k !== -1 && pw.length <= N; k = k === s ? -1 : LP.fromV[k]) pw.push(k);
  const ok = fj === fw && (!fj || (pj.length === pw.length && pj.every((v, i) => v === pw[i])));
  if (ok) same++; else { diff++; if (diff < 5) console.log('DIFF', { W, H, s, g, fj, fw, lj: pj.length, lw: pw.length }); }
  if (fj) foundN++;
  cells += N;
}
console.log(`compared ${n} grids (${(cells / 1e6).toFixed(1)} M cells, ${foundN} with a way): ${same} the same, ${diff} different; wasm ${WASM.stats.lpWasm}, js ${WASM.stats.lpJs}, heap too small ${WASM.stats.lpHeap}; compiled in ${WASM.stats.compileMs.toFixed(2)} ms`);
if ('time' in OPT || process.argv.includes('time')) {
  const timeIt = (on) => { WASM.lp = on; const t = performance.now(); for (const k of cases) { LP.blocked.set(k.bl); lpSearch(k.W, k.H, k.N, k.s, k.g); } return performance.now() - t; };
  for (let r = 0; r < 3; r++) console.log(`round ${r + 1}: js ${timeIt(false).toFixed(0)} ms, wasm ${timeIt(true).toFixed(0)} ms (the same ${n} searches)`);
}
process.exit(diff ? 1 : 0);
