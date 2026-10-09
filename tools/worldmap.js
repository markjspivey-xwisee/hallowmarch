// Node harness: run world generation and dump a top-down map as PPM + stats JSON
const fs = require('fs');
const src = ['00_util.js', '01_world.js'].map((f) => fs.readFileSync(__dirname + '/../src/' + f, 'utf8')).join('\n');
const out = process.argv[2] || '/tmp/worldmap';
const code = src + `
const t0 = Date.now();
buildWorld(7);
const t1 = Date.now();
const S = 1026; // 2 px per texel
const img = Buffer.alloc(S * S * 3);
for (let py = 0; py < S; py++) for (let px = 0; px < S; px++) {
  const x = -HALF + px * (WSIZE / S), z = -HALF + py * (WSIZE / S);
  const h = heightAt(x, z);
  const n = normalAt(x, z);
  const shade = 0.55 + 0.45 * Math.max(0, n.x * -0.5 + n.y * 0.7 + n.z * -0.5);
  const rw = realmWeightsAt(x, z);
  let c = [0.38 * rw[0] + 0.3 * rw[1] + 0.32 * rw[2], 0.55 * rw[0] + 0.62 * rw[1] + 0.52 * rw[2], 0.22 * rw[0] + 0.3 * rw[1] + 0.42 * rw[2]];
  const rk = sampleGrid(W.rock, x, z), rd = sampleGrid(W.road, x, z), fl = sampleGrid(W.field, x, z);
  c = c.map((v, i) => v * (1 - rk) + [0.5, 0.48, 0.45][i] * rk);
  if (h > 26) c = c.map((v) => v * 0.6 + 0.4);
  c = c.map((v, i) => v * (1 - fl) + [0.8, 0.68, 0.3][i] * fl);
  c = c.map((v, i) => v * (1 - rd) + [0.62, 0.5, 0.36][i] * rd);
  if (h < WATER_Y) c = [0.15, 0.3, 0.45];
  if (!isWalkable(x, z) && h >= WATER_Y) c = c.map((v) => v * 0.7);
  const k = (py * S + px) * 3;
  img[k] = Math.min(255, c[0] * shade * 255); img[k + 1] = Math.min(255, c[1] * shade * 255); img[k + 2] = Math.min(255, c[2] * shade * 255);
}
const dot = (x, z, col, r = 2) => { const cx = Math.round((x + HALF) * S / WSIZE), cz = Math.round((z + HALF) * S / WSIZE);
  for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) { const px = cx + dx, py = cz + dy; if (px < 0 || py < 0 || px >= S || py >= S) continue; const k = (py * S + px) * 3; img[k] = col[0]; img[k + 1] = col[1]; img[k + 2] = col[2]; } };
for (const t of W.trees) dot(t.x, t.z, t.kind === 'pine' ? [20, 60, 40] : t.kind === 'birch' ? [150, 170, 110] : [40, 80, 20], 1);
for (const r of W.rocks) dot(r.x, r.z, [120, 120, 120], 1);
for (const c of COLL.boxes) dot(c.x, c.z, c.tag === 'door' ? [255, 0, 255] : [230, 230, 230], 1);
for (const c of COLL.circles) if (c.tag !== 'tree' && c.tag !== 'rock') dot(c.x, c.z, [250, 250, 200], 1);
for (const n of NAV.nodes) dot(n.x, n.z, n.tag === 'ring' ? [255, 255, 0] : [255, 140, 0], 2);
for (const c of W.camps) dot(c.x, c.z, [255, 40, 40], 3);
fs.writeFileSync('${out}.ppm', Buffer.concat([Buffer.from('P6\\n' + S + ' ' + S + '\\n255\\n'), img]));
const stats = { genMs: t1 - t0, trees: W.trees.length, rocks: W.rocks.length, camps: W.camps.length, boxes: COLL.boxes.length, circles: COLL.circles.length, navNodes: NAV.nodes.length,
  sites: SITES.map(s => s.kind + ':' + s.name + '@' + s.x.toFixed(0) + ',' + s.z.toFixed(0) + ' y=' + s.y.toFixed(1)),
  hRange: [W.H.reduce((a,b)=>Math.min(a,b),1e9), W.H.reduce((a,b)=>Math.max(a,b),-1e9)].map(v => v.toFixed(1)),
  campsPerRealm: [0,1,2].map(r => W.camps.filter(c => c.realm === r).length) };
// path sanity: every muster to every enemy keep gate and temple gate
const fails = [];
for (const A of REALMS) for (const B of REALMS) { if (A === B) continue;
  for (const K of B.nav.k) { const p = navPath(A.nav.muster.id, K.gate.id); if (!p) fails.push(A.name + '->' + B.name + ' keep'); }
  const p2 = navPath(A.nav.muster.id, B.nav.tg.id); if (!p2) fails.push(A.name + '->' + B.name + ' temple');
}
// every nav edge clear of walls?
const blockedEdges = [];
for (const n of NAV.nodes) for (const e of n.adj) { if (e.kind === 'door' || e.to < n.id) continue; const m = NAV.nodes[e.to];
  if (!segmentClear(n.x, n.z, m.x, m.z, 0.6, false)) blockedEdges.push(n.tag + n.id + '-' + m.tag + m.id);
  // also walkable terrain along the edge
  const L = dist(n.x, n.z, m.x, m.z); for (let s = 0; s <= L; s += 2) { const t = s / L; if (!isWalkable(n.x + (m.x - n.x) * t, n.z + (m.z - n.z) * t)) { blockedEdges.push('terrain:' + n.tag + n.id + '-' + m.tag + m.id); break; } }
}
stats.pathFails = fails; stats.blockedEdges = blockedEdges;
console.log(JSON.stringify(stats, null, 1));
`;
new Function('require', 'fs', code)(require, fs);
