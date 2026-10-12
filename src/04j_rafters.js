/* ================================================================== */
/* [siege3] a holed roof's shadow and broken rafters; built doors'     */
/* arrows swing with them                                              */
/* ================================================================== */
// A hole a stone knocked in a house's roof (04j_batter.js: H.bat.hx, hz, hr) is cut in the shadow pass as in the colour
// pass (HOUSE_DEPTH_FS, the houses' depth material: buildHouses in 04e_houses.js), so the sun falls in through it onto
// the floor; and the roof's broken timbers lie across it: a rafter or two still spanning the hole, one snapped in the
// middle with both halves hanging in, their broken ends dark (houseRafterSync, a small mesh a holed house, built again
// when its hole grows). Arrows stuck in the leaf of a door or a gate the player built swing with it as it opens and
// shuts (buildDoorRec, asked by wallDoorRec in 04j_batter.js), as a house's and a tower's do.

const HOUSE_DEPTH_FS = /* glsl */`
  ${GLSL_COMMON}
  uniform vec4 uHA[${HOUSE_MAXH}]; uniform vec4 uHD[${HOUSE_MAXH}];
  uniform vec4 uHC[${HOUSE_MAXH}]; uniform vec4 uHY[${HOUSE_MAXH}]; // [look4]
  varying vec3 vW; varying vec2 vHP;
  ${LOOK4_STUB_GLSL}
  void main(){
    if (vHP.x > -0.5) {
      int hHi = int(vHP.x + 0.5), hKind = int(vHP.y + 0.5);
      // [look4] a house brought down by stones casts the shadow of its broken walls (the colour pass's own cut, 04d_look4.js)
      if ((hKind == 0 || hKind == 2) && uHD[hHi].w > 1.5 && uHA[hHi].y > 1.5) {
        vec2 d4 = vW.xz - uHC[hHi].xy, q4 = vec2(dot(d4, vec2(uHY[hHi].x, -uHY[hHi].y)), dot(d4, vec2(uHY[hHi].y, uHY[hHi].x)));
        if (vW.y - uHY[hHi].z > max(look4Stub(q4, uHY[hHi].w, float(hHi)), uHD[hHi].x)) discard;
      }
      // the hole in the roof lets the sun in (the colour pass's own cut, 04e_houses.js)
      if ((hKind == 1 || hKind == 7) && uHD[hHi].z > 0.01 && uHA[hHi].y < 1.5 && distance(vW.xz, uHD[hHi].xy) < uHD[hHi].z * (0.82 + 0.36 * vnoise(vW.xz * 3.1 + float(hHi) * 1.7))) discard;
    }
    gl_FragColor = vec4(1.0);
  }`;

const RAFTERS = { list: new Map(), stats: { built: 0, removed: 0 }, t: 0 };
// the broken timbers across a house's hole, in the house's own frame
function houseRafterGeo(H) {
  const b = new Batch(), bt = H.bat, l0 = houseL(H, bt.hx, bt.hz), r = mulberry(Math.round(Math.abs(bt.hx * 17 + bt.hz * 29)) + 7);
  const M = new THREE.Matrix4().compose(new THREE.Vector3(H.x, H.y, H.z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, H.yaw, 0)), new THREE.Vector3(1, 1, 1));
  const wood = [0.28, 0.2, 0.13], burnt = [0.07, 0.055, 0.045], hr = bt.hr;
  if (H.round) {
    // rafters run from the eaves up to the point: the two or three passing through the hole
    const rad0 = Math.hypot(l0.x, l0.z), a0 = Math.atan2(l0.x, l0.z), step = 0.55 / Math.max(rad0, 0.6);
    let k = 0;
    for (let a = a0 - hr / Math.max(rad0, 0.6); a <= a0 + hr / Math.max(rad0, 0.6) + 1e-6; a += step, k++) {
      const ra = Math.max(0.15, rad0 - hr * 1.15), rb = Math.min(H.Rr - 0.1, rad0 + hr * 1.15), snap = k === 1;
      const seg = (r0, r1, droop, col) => {
        const ya = H.roofAt(r0) - 0.3, yb = H.roofAt(r1) - 0.3 - droop, xm = Math.sin(a) * (r0 + r1) / 2, zm = Math.cos(a) * (r0 + r1) / 2;
        const L = Math.hypot(r1 - r0, yb - ya), pitch = Math.atan2(ya - yb, r1 - r0);
        b.add(G.box, lm(M, xm, (ya + yb) / 2, zm, a, 0.09, 0.11, L, -pitch), MAT.wood, col);
      };
      if (snap) { const rm = rad0 + (r() - 0.5) * hr * 0.3; seg(ra, rm - 0.05, 0.55, burnt); seg(rm + 0.05, rb, -0.0, burnt); }
      else seg(ra, rb, 0, k % 2 ? burnt : wood);
    }
    return b.build();
  }
  // a pitched roof: the rafters run down from the ridge (along the house) to the eaves, 0.55 m apart
  const side = l0.x >= 0 ? 1 : -1, x0 = Math.max(0, Math.abs(l0.x) - hr * 1.2), x1 = Math.min(H.w / 2 + H.ohSide - 0.05, Math.abs(l0.x) + hr * 1.2);
  const roofY = (ax) => H.wallH + H.rh - ax * H.tn - H.roofTh / H.cs - 0.06; // just under the covering
  const zs = [];
  for (let z = Math.ceil((l0.z - hr) / 0.55) * 0.55; z <= l0.z + hr + 1e-6; z += 0.55) zs.push(z);
  zs.forEach((z, k) => {
    const snap = zs.length > 1 && k === Math.floor(zs.length / 2);
    const seg = (a, c, droop, col) => {
      const ya = roofY(a), yc = roofY(c) - droop, xm = side * (a + c) / 2, L = Math.hypot(c - a, ya - yc), pitch = Math.atan2(ya - yc, c - a);
      // the rafter's length along the house's x, sloping down toward the eaves on its side
      b.add(G.box, lm(M, xm, (ya + yc) / 2, z, Math.PI / 2 * side, 0.09, 0.12, L, -pitch), MAT.wood, col);
    };
    if (snap) { const m = (x0 + x1) / 2 + (r() - 0.5) * hr * 0.4; seg(x0, m - 0.04, -0.0, burnt); seg(m + 0.04, x1, 0.0, burnt); b.add(G.box, lm(M, side * (m + 0.25), roofY(m) - 0.45, z, Math.PI / 2 * side, 0.09, 0.12, 0.7, 1.0), MAT.wood, burnt); }
    else seg(x0, x1, 0, k % 2 ? burnt : wood);
  });
  // a purlin running along the house under the rafters, snapped where the stone came through
  const px = Math.min(x1, Math.max(x0, Math.abs(l0.x))), py = roofY(px) - 0.12;
  for (const sd of [-1, 1]) b.add(G.box, lm(M, side * px, py - 0.12, l0.z + sd * hr * 0.55, 0, 0.11, 0.12, hr * 0.9, sd * 0.35), MAT.wood, burnt);
  return b.build();
}
// once a second: a mesh of broken timbers for each holed house still standing (and none for the others)
function houseRafterSync(dt) {
  RAFTERS.t -= dt;
  if (RAFTERS.t > 0) return;
  RAFTERS.t = 1;
  for (const H of HOUSES) {
    const bt = H.bat, want = !!(bt && bt.hr > 0.01 && houseIntact(H));
    let R = RAFTERS.list.get(H);
    const key = want ? `${bt.hx.toFixed(2)},${bt.hz.toFixed(2)},${bt.hr.toFixed(2)}` : '';
    if (R && R.key === key) continue;
    if (R) { R.mesh.removeFromParent(); if (R.proxy) { SHADOW.scene.remove(R.proxy); const k = SHADOW.proxies.indexOf(R.proxy); if (k >= 0) SHADOW.proxies.splice(k, 1); } R.mesh.geometry.dispose(); RAFTERS.list.delete(H); RAFTERS.stats.removed++; R = null; }
    if (!want) continue;
    const mesh = new THREE.Mesh(houseRafterGeo(H), buildingMat);
    mesh.renderOrder = 1;
    scene.add(mesh);
    RAFTERS.list.set(H, { key, mesh, proxy: shadowCaster(mesh, BUILDING_DEPTH) });
    RAFTERS.stats.built++;
  }
}

// an arrow stuck in a built door's or gate's leaf: kept in the leaf's frame (its pivot), drawn where the leaf now is
const _bdM = new THREE.Matrix4(), _bdV = new THREE.Vector3();
function buildDoorRec(pc, x, y, z, dx, dy, dz) {
  if (!pc.leaves || !pc.leaves.length) return null;
  let L = pc.leaves[0];
  if (pc.leaves.length > 1) {
    let bd = Infinity;
    for (const q of pc.leaves) { q.pivot.updateWorldMatrix(true, false); const e = q.pivot.matrixWorld.elements, d = dist2(x, z, e[12], e[14]); if (d < bd) { bd = d; L = q; } }
  }
  const frame = () => { L.pivot.updateWorldMatrix(true, false); return L.pivot.matrixWorld; };
  _bdM.copy(frame()).invert();
  const p = _bdV.set(x, y, z).applyMatrix4(_bdM), lp = [p.x, p.y, p.z];
  const q = _bdV.set(dx, dy, dz).transformDirection(_bdM), ld = [q.x, q.y, q.z];
  return { D: { part: { frame } }, lp, ld, pc, gone: () => !pc.mesh || (pc.st !== 'built' && pc.st !== 'burning') };
}
queueMicrotask(() => { if (window.__hm) window.__hm.rafters = { RAFTERS, houseRafterSync, houseRafterGeo, buildDoorRec }; });
