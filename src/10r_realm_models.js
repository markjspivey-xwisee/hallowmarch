/* Canonical realm works in the 3D world. Local presentation and collision never
 * change the realm ledger, saved coordinates, terrain or persistent nature. */
const REALM_RTS_MODEL_LIMIT = 72;
const REALM_RTS_MODEL_HEIGHT = {
  farm: 4.2, mill: 7.4, bakery: 5.8, woodcutter: 4.1, sawmill: 5.5, sheepfold: 3.8,
  weaver: 5.5, mine: 4.5, toolmaker: 6.2, quarry: 5.4, hunter: 4.2, stables: 5.1, house: 5.7, market: 3.7,
};
const REALM_RTS_MODELS = {
  group: null, material: null, pools: new Map(), signature: '', view: null, check: 0,
  rotors: [], rows: 0, buildings: 0, construction: 0, scratch: null,
  plots: null, plotKey: '', solids: new Map(), bodyBounds: new Map(), ground: -1, world: null,
};
function realmRtsModelsView() {
  // Frame hooks can run during boot before later network bindings are initialized.
  try {
    if (!GAME.started || !NETS.s?.management) return null;
    const data = NETS.s.management;
    return Array.isArray(data.publicBuildings) && Array.isArray(data.publicPlots) ? data : null;
  } catch (err) { return null; }
}
function realmRtsModelRows(data, ownKey, publicKey, buildings) {
  const rows = new Map(), bound = typeof HALF === 'number' ? HALF + 2 : 514;
  for (const list of [data[publicKey], data[ownKey]]) {
    if (!Array.isArray(list)) continue;
    for (const row of list.slice(0, REALM_RTS_MODEL_LIMIT)) {
      if (!row || typeof row.id !== 'string' || !row.id || row.id.length > 80
        || !Number.isInteger(row.owner) || row.owner < 0 || row.owner > 2
        || !Number.isFinite(row.x) || !Number.isFinite(row.z) || Math.abs(row.x) > bound || Math.abs(row.z) > bound
        || buildings && !Object.hasOwn(REALM_RTS_MODEL_HEIGHT, row.kind)) continue;
      rows.set(row.id, row);
    }
  }
  return [...rows.values()].sort((a, b) => a.id.localeCompare(b.id)).slice(0, REALM_RTS_MODEL_LIMIT);
}
function realmRtsModelSignature(plots, buildings) {
  return JSON.stringify([plots.map(p => [p.id, p.x, p.z, p.owner, p.home, p.yaw, p.layoutVersion, p.placementVersion, p.buildingId || '']),
    buildings.map(b => [b.id, b.plotId, b.kind, b.x, b.z, b.owner, b.home, b.yaw, b.placementVersion, b.level, b.status, !!b.adopted,
      Math.round(Math.max(0, Math.min(1, Number(b.progress) || 0)) * 100), !!b.paused, !!b.working, b.blocked || '', b.assigned || 0])]);
}
function realmRtsModelRoofGeometry() {
  const a = [-0.5, -0.5, 0.5], b = [0.5, -0.5, 0.5], c = [0, 0.5, 0.5];
  const d = [-0.5, -0.5, -0.5], e = [0.5, -0.5, -0.5], f = [0, 0.5, -0.5];
  const positions = [...a, ...b, ...c, ...e, ...d, ...f, ...d, ...a, ...c, ...d, ...c, ...f,
    ...b, ...e, ...f, ...b, ...f, ...c, ...d, ...e, ...b, ...d, ...b, ...a];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.computeVertexNormals();
  return g;
}
function realmRtsModelParts(kind) {
  const parts = [], wood = '#73503b', dark = '#3b302c', plaster = '#d6c49f', stone = '#899194';
  const add = (shape, x, y, z, sx, sy, sz, color, rx = 0, ry = 0, rz = 0) =>
    parts.push({ shape, x, y, z, sx, sy, sz, color, rx, ry, rz });
  const box = (x, y, z, sx, sy, sz, color, rz = 0) => add('box', x, y, z, sx, sy, sz, color, 0, 0, rz);
  const roof = (x, y, z, w, h, d, color) => add('roof', x, y, z, w, h, d, color);
  const hut = (w = 4, h = 2.7, d = 4.3, color = plaster, top = '#9a5140') => {
    box(0, h / 2 + 0.3, 0, w, h, d, color);
    roof(0, h + 1.05, 0, w + 0.65, 1.6, d + 0.7, top);
    for (const x of [-w / 2, w / 2]) for (const z of [-d / 2, d / 2]) box(x, h / 2 + 0.3, z, 0.16, h + 0.1, 0.16, wood);
    box(0, 1.15, d / 2 + 0.04, 0.95, 1.7, 0.1, dark);
    for (const x of [-w * 0.3, w * 0.3]) box(x, 2, d / 2 + 0.06, 0.6, 0.65, 0.12, '#d7a85c');
  };
  const logs = (x, z, n = 3) => {
    for (let i = 0; i < n; i++) add('cyl', x, 0.55 + Math.floor(i / 2) * 0.52, z + (i % 2) * 0.62, 0.3, 3, 0.3, wood, 0, 0, Math.PI / 2);
  };
  const fence = () => {
    for (const x of [-3.2, 3.2]) for (const z of [-3.2, 0, 3.2]) box(x, 0.95, z, 0.17, 1.5, 0.17, wood);
    for (const z of [-3.2, 3.2]) { box(0, 0.85, z, 6.5, 0.15, 0.15, wood); box(0, 1.35, z, 6.5, 0.15, 0.15, wood); }
    for (const x of [-3.2, 3.2]) { box(x, 0.85, 0, 0.15, 0.15, 6.5, wood); box(x, 1.35, 0, 0.15, 0.15, 6.5, wood); }
  };
  if (kind === 'mill') {
    add('taper', 0, 2.95, 0, 1.7, 5.3, 1.7, plaster);
    add('cone', 0, 6.25, 0, 1.85, 1.8, 1.85, '#526271');
    box(0, 1.2, 1.65, 0.85, 1.8, 0.12, dark);
    box(0, 4.2, 1.32, 0.6, 0.8, 0.12, '#d7a85c');
    add('cyl', 0, 4.5, 0, 1.7, 0.2, 1.7, wood);
  } else if (kind === 'farm') {
    box(0, 0.25, 0, 7.5, 0.18, 7.5, '#67533b');
    for (let x = -2.8; x < 3; x += 0.8) box(x, 0.57, -0.5, 0.25, 0.5, 5.8, '#bdad54');
    box(2.2, 1.35, 2.1, 2.4, 2.2, 2.6, '#a47449');
    roof(2.2, 2.95, 2.1, 2.9, 1.1, 3.1, '#715448');
  } else if (kind === 'woodcutter') {
    hut(2.9, 2.2, 3, '#9d8060', '#617157'); logs(0, 2.2, 5);
    add('cyl', -2.8, 0.75, -1.8, 0.75, 0.9, 0.75, '#a48153');
  } else if (kind === 'sawmill') {
    hut(4.6, 2.6, 4.5, '#a98b64', '#586976'); logs(0, 3.05, 5);
    add('cyl', 2.5, 1.55, 1.5, 0.9, 0.15, 0.9, '#a5b1b7', Math.PI / 2);
  } else if (kind === 'sheepfold') {
    fence(); roof(-1.8, 2.6, -1.8, 2.5, 1, 2.5, '#837560');
    for (const [x, z] of [[-1.6, 1.1], [0.7, -0.2], [1.5, 1.9]]) {
      add('sphere', x, 0.95, z, 0.75, 0.52, 0.45, '#e4dfc8');
      add('sphere', x + 0.6, 1.05, z, 0.3, 0.32, 0.26, dark);
      for (const dx of [-0.4, 0.4]) box(x + dx, 0.45, z, 0.14, 0.65, 0.2, dark);
    }
  } else if (kind === 'quarry') {
    box(0, 0.28, 0, 7, 0.25, 6.5, '#7d807a');
    for (let i = 0; i < 5; i++) add('sphere', -2.3 + i * 1.05, 0.8 + (i % 2) * 0.35, -1.5 + (i % 2), 0.85, 0.7, 1, stone);
    box(2.4, 2.55, 0, 0.35, 4.8, 0.35, wood); box(0.9, 4.85, 0, 3.5, 0.3, 0.35, wood);
    box(-0.5, 3.6, 0, 0.06, 2.4, 0.06, dark); box(-0.5, 2.35, 0, 0.85, 0.8, 0.85, stone);
  } else if (kind === 'mine') {
    for (const [x, z, sc] of [[-2, -0.7, 2], [1.7, -1, 2.1], [0, -2, 2.5]]) add('sphere', x, 1, z, sc, 1.8, sc, '#626b70');
    box(0, 1.5, 1.2, 2.7, 2.5, 0.3, '#252a2e');
    for (const x of [-1.55, 1.55]) box(x, 1.7, 1.45, 0.4, 3, 0.4, wood);
    box(0, 3.1, 1.45, 3.6, 0.4, 0.4, wood);
    for (const x of [-0.8, 0.8]) box(x, 0.37, 2.5, 0.12, 0.12, 3, '#b0b2ae');
  } else if (kind === 'market') {
    for (const [x, color] of [[-2.4, '#a25145'], [0, '#bcaa65'], [2.4, '#567d83']]) {
      box(x, 1, 0, 2.1, 1.4, 2.6, wood); roof(x, 2.8, 0, 2.3, 0.8, 3, color);
      for (const z of [-1.2, 1.2]) box(x + 0.9, 1.8, z, 0.12, 2.8, 0.12, wood);
      add('cyl', x, 1.95, 0.4, 0.35, 0.45, 0.35, '#cbaa6c');
    }
  } else if (kind === 'hunter') {
    hut(3, 2.3, 3.3, '#9c8467', '#66795b');
    box(2.5, 1.35, 0, 0.2, 2.2, 0.2, wood); box(1.7, 2.4, 0, 1.8, 0.15, 0.15, wood);
    add('cyl', 2.3, 1.55, 0, 0.5, 0.12, 0.5, '#c9b48b', Math.PI / 2);
  } else if (kind === 'stables') {
    hut(5.6, 2.6, 4.2, '#ad8f68', '#8e5345');
    for (const x of [-1.8, 0, 1.8]) box(x, 1.15, 2.18, 1.25, 1.7, 0.12, dark);
    box(0, 0.55, 3.05, 5.8, 0.9, 0.2, wood);
  } else {
    const roofColor = kind === 'weaver' ? '#68728f' : kind === 'toolmaker' ? '#66717a' : kind === 'bakery' ? '#a45c44' : '#8c6451';
    hut(kind === 'house' ? 3.7 : 4.3, 2.8, 4.3, kind === 'toolmaker' ? '#8a8980' : plaster, roofColor);
    if (kind === 'bakery' || kind === 'toolmaker' || kind === 'house') {
      box(-1.2, 4.25, -0.9, 0.7, kind === 'toolmaker' ? 3.4 : 2.7, 0.75, stone);
      box(-1.2, kind === 'toolmaker' ? 5.98 : 5.65, -0.9, 0.9, 0.25, 0.95, dark);
    }
    if (kind === 'bakery') { add('sphere', 2.7, 0.95, 1, 1.1, 0.9, 1.2, '#a58d72'); box(2.7, 0.8, 2.12, 0.6, 0.55, 0.12, '#dd9549'); }
    if (kind === 'toolmaker') { box(2.8, 0.9, 1.2, 1.2, 0.35, 0.55, '#69747a'); box(2.8, 0.6, 1.2, 0.45, 0.7, 0.45, dark); }
    if (kind === 'weaver') for (let i = 0; i < 3; i++) box(-1.3 + i * 1.1, 0.7, 2.65, 0.8, 0.9, 0.65, ['#b16f6b', '#c7b56d', '#738eaa'][i]);
  }
  return parts;
}
function realmRtsModelGeometry(parts, bases) {
  const positions = [], colors = [], normals = [], v = new THREE.Vector3(), n = new THREE.Vector3();
  const matrix = new THREE.Matrix4(), normal = new THREE.Matrix3(), q = new THREE.Quaternion(), e = new THREE.Euler();
  const at = new THREE.Vector3(), scale = new THREE.Vector3(), color = new THREE.Color();
  for (const p of parts) {
    const base = bases[p.shape], pos = base.getAttribute('position'), ns = base.getAttribute('normal');
    matrix.compose(at.set(p.x, p.y, p.z), q.setFromEuler(e.set(p.rx || 0, p.ry || 0, p.rz || 0)), scale.set(p.sx, p.sy, p.sz));
    normal.getNormalMatrix(matrix); color.set(p.color);
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(matrix); n.fromBufferAttribute(ns, i).applyMatrix3(normal).normalize();
      positions.push(v.x, v.y, v.z); normals.push(n.x, n.y, n.z);
      colors.push(color.r, color.g, color.b);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  g.computeBoundingSphere();
  return g;
}
function realmRtsModelPartBounds(parts, bases, kind) {
  return parts.filter(p => !(kind === 'farm' && p.shape === 'box' && p.sx < .3 && p.sy < .6)).slice(0,64).map(p => {
    const positions = bases[p.shape].getAttribute('position'), bounds = new THREE.Box3(), point = new THREE.Vector3();
    const matrix = new THREE.Matrix4().compose(new THREE.Vector3(p.x,p.y,p.z),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(p.rx||0,p.ry||0,p.rz||0)),new THREE.Vector3(p.sx,p.sy,p.sz));
    for (let i=0;i<positions.count;i++) bounds.expandByPoint(point.fromBufferAttribute(positions,i).applyMatrix4(matrix));
    return { min:bounds.min.clone(), max:bounds.max.clone() };
  });
}
function realmRtsModelsInit() {
  const state = REALM_RTS_MODELS;
  if (state.group) return;
  state.group = new THREE.Group(); state.group.name = 'canonical-realm-works';
  state.material = mat({ vertexColors: true, vertexShader: /* glsl */`
    varying vec3 vW; varying vec3 vN; varying vec3 vCol; varying float vGroundMark;
    void main(){
      mat4 transform = modelMatrix; vec3 nn = normal; vGroundMark = 1.0;
      #ifdef USE_INSTANCING
      vGroundMark = 0.0;
      mat3 im = mat3(instanceMatrix);
      nn /= max(vec3(dot(im[0],im[0]),dot(im[1],im[1]),dot(im[2],im[2])),vec3(0.00001));
      transform = modelMatrix * instanceMatrix;
      #endif
      vec4 w = transform * vec4(position,1.0); vW = w.xyz; vN = mat3(transform) * nn;
      vCol = color;
      #ifdef USE_INSTANCING_COLOR
      vCol *= instanceColor;
      #endif
      gl_Position = projectionMatrix * viewMatrix * w;
    }`, fragmentShader: /* glsl */`
    ${GLSL_COMMON}
    ${GLSL_ATMOS}
    ${GLSL_SHADOW}
    ${GLSL_PLIGHT}
    ${GLSL_LIGHT}
    ${GLSL_WEATHER}
    ${GLSL_SEASON}
    uniform float uWet, uSnowCover;
    varying vec3 vW; varying vec3 vN; varying vec3 vCol; varying float vGroundMark;
    void main(){
      vec3 n = safeNormalize(vN); gSh = shadowAt(vW,n); gPL = pointLights(vW,n);
      vec3 alb = vCol * (1.0 - 0.18 * wetHere(vW,uWet));
      float snow = snowAmount(vW,n,uSnowCover * snowHere(vW),gPL) * (1.0-vGroundMark);
      alb = mix(alb,vec3(0.87,0.91,0.96),clamp(snow,0.0,1.0));
      gl_FragColor = vec4(safeColor(applyFog(lightSurface(alb,n,0.9),vW)),1.0);
    }` });
  state.scratch = { object: new THREE.Object3D(), color: new THREE.Color(), rotation: new THREE.Quaternion(),
    spin: new THREE.Quaternion(), axis: new THREE.Vector3(0, 0, 1), euler: new THREE.Euler() };
  const indexed = {
    box: new THREE.BoxGeometry(1, 1, 1), cyl: new THREE.CylinderGeometry(1, 1, 1, 8),
    taper: new THREE.CylinderGeometry(0.7, 1, 1, 8), cone: new THREE.ConeGeometry(1, 1, 8),
    sphere: new THREE.SphereGeometry(1, 8, 5), roof: realmRtsModelRoofGeometry(),
  };
  const bases = {};
  for (const [id, geometry] of Object.entries(indexed)) {
    bases[id] = geometry.index ? geometry.toNonIndexed() : geometry;
    if (bases[id] !== geometry) geometry.dispose();
  }
  const addPool = (id, parts) => {
    const geometry = realmRtsModelGeometry(parts, bases), mesh = new THREE.InstancedMesh(geometry, state.material, REALM_RTS_MODEL_LIMIT);
    mesh.name = 'realm-work-' + id; mesh.count = 0; mesh.visible = false; mesh.frustumCulled = false;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.setColorAt(0, new THREE.Color(1, 1, 1)); mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    state.group.add(mesh); state.pools.set(id, mesh);
  };
  const part = (shape, x, y, z, sx, sy, sz, color) => ({ shape, x, y, z, sx, sy, sz, color });
  try {
    for (const kind of Object.keys(REALM_RTS_MODEL_HEIGHT)) {
      const parts = realmRtsModelParts(kind); addPool(kind,parts); state.bodyBounds.set(kind,realmRtsModelPartBounds(parts,bases,kind));
    }
    addPool('foundation', [part('box', 0, 0.18, 0, 7.6, 0.36, 7.6, '#aea28b')]);
    const frame = [];
    for (const x of [-3.5, 3.5]) for (const z of [-3.5, 3.5]) frame.push(part('box', x, 0.5, z, 0.16, 1, 0.16, '#c1a475'));
    for (const y of [0.25, 0.65, 1]) for (const side of [-1, 1]) frame.push(
      part('box', side * 3.5, y, 0, 0.13, 0.09, 7.1, '#b2966c'), part('box', 0, y, side * 3.5, 7.1, 0.09, 0.13, '#b2966c'));
    addPool('scaffold', frame);
    state.bodyBounds.set('scaffold',realmRtsModelPartBounds(frame,bases,'scaffold'));
    const rotor = [];
    for (let i = 0; i < 4; i++) {
      const angle = i * Math.PI / 2;
      rotor.push({ ...part('box', Math.cos(angle) * 1.4, Math.sin(angle) * 1.4, 0, 3, 0.14, 0.13, '#73503b'), rz: angle });
      rotor.push({ ...part('box', Math.cos(angle) * 2, Math.sin(angle) * 2, 0.03, 1.2, 0.7, 0.1, '#ddd0aa'), rz: angle });
    }
    addPool('rotor', rotor);
    addPool('status', [part('box', 0, -0.35, 0, 0.1, 0.65, 0.1, '#a0a0a0'), part('cone', 0, 0, 0, 0.4, 0.65, 0.4, '#ffffff')]);
  } finally {
    for (const geometry of Object.values(bases)) geometry.dispose();
  }
  scene.add(state.group);
  state.world = W.H;
}
function realmRtsModelInstance(pool, x, y, z, yaw, sx, sy, sz, color) {
  const state = REALM_RTS_MODELS, mesh = state.pools.get(pool);
  if (!mesh || mesh.count >= REALM_RTS_MODEL_LIMIT) return -1;
  const object = state.scratch.object, index = mesh.count++;
  object.position.set(x, y, z); object.rotation.set(0, yaw, 0); object.scale.set(sx, sy, sz); object.updateMatrix();
  mesh.setMatrixAt(index, object.matrix); mesh.setColorAt(index, state.scratch.color.set(color)); mesh.visible = true;
  return index;
}
function realmRtsModelYaw(row) {
  return realmRtsSiteFrame(row).yaw;
}
function realmRtsGroundRevision() {
  const ground = typeof A2FL !== 'undefined' && Number.isFinite(A2FL.ground) ? A2FL.ground : 0;
  // The title can enter play before updateLod builds the actual terrain meshes.
  // Replace the initial height-map fit once their exact surface is available.
  return ground * 2 + (typeof LOD !== 'undefined' && LOD.built ? 1 : 0);
}
function realmRtsConstructionOverlay() {
  try { return THRONE_RTS.active && UI.modal === 'rts' && THRONE_RTS_UI.tab === 'build' && !!hallThroneGrant()
    && Number.isInteger(GAME.player?.faction); } catch (err) { return false; }
}
function realmRtsModelsPlots(plots, buildings, force = false) {
  const state = REALM_RTS_MODELS, occupied = new Set(buildings.map(b => b.plotId));
  const rows = realmRtsConstructionOverlay() ? plots.filter(p => p.owner === GAME.player.faction && !p.buildingId
    && !occupied.has(p.id) && realmRtsSiteStatus(p).eligible) : [];
  const selected = rows.find(p => p.id === (THRONE_RTS_UI.form.plotId || THRONE_RTS_UI.selectedPlot))?.id || '';
  const key = JSON.stringify([rows.map(p => [p.id,p.x,p.z,realmRtsModelYaw(p)]),selected,realmRtsGroundRevision()]);
  if (!force && key === state.plotKey) return;
  state.plotKey = key;
  if (state.plots) { state.group.remove(state.plots); state.plots.geometry.dispose(); state.plots = null; }
  if (!rows.length) return;
  const positions = [], colors = [], half = 6, segments = 12;
  for (const row of rows) {
    const yaw = realmRtsModelYaw(row), c = Math.cos(yaw), s = Math.sin(yaw), width = row.id === selected ? 0.18 : 0.1;
    const color = new THREE.Color(row.id === selected ? '#ddc080' : '#9da280');
    const world = (x,z) => { const wx = row.x + x*c + z*s, wz = row.z - x*s + z*c; return [wx,heightAt(wx,wz)+0.06,wz]; };
    for (let side = 0; side < 4; side++) for (let part = 0; part < segments; part++) {
      const a = -half + 2*half*part/segments, b = -half + 2*half*(part+1)/segments;
      const points = side === 0 ? [[a,-half],[b,-half],[b,-half+width],[a,-half+width]]
        : side === 1 ? [[half,a],[half,b],[half-width,b],[half-width,a]]
          : side === 2 ? [[b,half],[a,half],[a,half-width],[b,half-width]]
            : [[-half,b],[-half,a],[-half+width,a],[-half+width,b]];
      for (const index of [0,2,1,0,3,2]) { positions.push(...world(...points[index])); colors.push(color.r,color.g,color.b); }
    }
  }
  const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
  geometry.setAttribute('color',new THREE.Float32BufferAttribute(colors,3)); geometry.computeVertexNormals(); geometry.computeBoundingSphere();
  state.plots = new THREE.Mesh(geometry,state.material); state.plots.name = 'realm-construction-plots';
  // The shader projects this world-space mesh through the current camera every
  // frame. Panning and zooming need no geometry rebuild or player-distance gate.
  state.group.add(state.plots);
}
function realmRtsModelsDropSolid(item) {
  // Parts are registered in the fixed 12m site envelope once, so their visual
  // growth can update bounds without changing grid membership each percent.
  // Restore those registration bounds when removing them from the grids.
  for (const collider of item.colliders) { collider.active=false; Object.assign(collider,{x:item.x,z:item.z,hx:6,hz:6}); bCollRemove(collider); }
  for (const floor of item.floors) { floor.active=false; Object.assign(floor,{x:item.x,z:item.z,hx:6,hz:6}); bFloorRemove(floor); }
}
function realmRtsModelsSolids(buildings) {
  const state = REALM_RTS_MODELS, live = new Set(); let removed = false;
  for (const b of buildings) {
    if (b.adopted) continue;
    live.add(b.id);
    const yaw = realmRtsModelYaw(b), ground = realmRtsSiteGround(b), level = Math.max(1,Math.min(4,Number(b.level)||1));
    const progress = Math.max(0,Math.min(1,Number(b.progress)||0)), constructing=b.status==='building', upgrading=b.status==='upgrading';
    const scale = 1+.08*(Math.min(4,level+(upgrading?progress:0))-1), height=REALM_RTS_MODEL_HEIGHT[b.kind]*scale;
    const key = JSON.stringify([b.x,b.z,yaw,ground.bottom,ground.top,b.kind,level,constructing||upgrading]), old = state.solids.get(b.id);
    let item = old;
    if (old?.key !== key || !COLL.boxes.includes(old.colliders[0]) || !FLOOR.list.includes(old.floors[0])) {
      if (old) { realmRtsModelsDropSolid(old); state.solids.delete(b.id); removed=true; }
      const collider = addBox(b.x,b.z,6,6,yaw,'realm-work',ground.top-ground.bottom);
      Object.assign(collider,{baseY:ground.bottom,vert:true,y0:ground.bottom,realmRtsBuildingId:b.id});
      const floor=addFloorBox(b.x,b.z,6,6,yaw,ground.top,ground.top,ground.bottom,0,'realm-work');
      item={key,x:b.x,z:b.z,colliders:[collider],floors:[floor],parts:[]};
      const parts=[...(state.bodyBounds.get(b.kind)||[]).map(bounds=>({bounds,scaffold:false})),
        ...(constructing||upgrading?(state.bodyBounds.get('scaffold')||[]).map(bounds=>({bounds,scaffold:true})):[])].slice(0,64);
      for(const part of parts) {
        const body=addBox(b.x,b.z,6,6,yaw,'realm-work',1);
        Object.assign(body,{vert:true,realmRtsBuildingId:b.id}); item.colliders.push(body);
        const bounds=part.bounds, low=!part.scaffold && bounds.max.y<=.62 && (bounds.max.x-bounds.min.x)*(bounds.max.z-bounds.min.z)>=1;
        const step=low?addFloorBox(b.x,b.z,6,6,yaw,ground.top,ground.top,ground.bottom,0,'realm-work'):null;
        if(step)item.floors.push(step); item.parts.push({...part,collider:body,floor:step});
      }
      state.solids.set(b.id,item); if(COVER.built)coverMarkBox(b.x,b.z,6,6,yaw,.3);
    }
    const c=Math.cos(yaw),s=Math.sin(yaw);
    for(const part of item.parts) {
      const bounds=part.bounds, sy=part.scaffold?height*(constructing?Math.max(.3,progress):1):scale*(constructing?Math.max(.18,progress):1);
      const base=ground.top+(part.scaffold ? .2 : 0), cx=(bounds.min.x+bounds.max.x)*.5*scale, cz=(bounds.min.z+bounds.max.z)*.5*scale;
      const x=b.x+cx*c+cz*s,z=b.z-cx*s+cz*c, bottom=base+bounds.min.y*sy,top=base+bounds.max.y*sy;
      Object.assign(part.collider,{x,z,hx:Math.max(.01,(bounds.max.x-bounds.min.x)*.5*scale),hz:Math.max(.01,(bounds.max.z-bounds.min.z)*.5*scale),
        baseY:bottom,y0:bottom,h:Math.max(.01,top-bottom),active:part.scaffold||!constructing||progress>=.15});
      if(part.floor)Object.assign(part.floor,{x,z,hx:part.collider.hx,hz:part.collider.hz,ya:top,yb:top,y0:bottom,active:part.collider.active});
    }
  }
  for (const [id,item] of state.solids) if (!live.has(id)) { realmRtsModelsDropSolid(item); state.solids.delete(id); removed = true; }
  if (removed && COVER.built) buildCoverMask();
}
function realmRtsModelsRebuild(plots, buildings) {
  const state = REALM_RTS_MODELS, oldAngles = new Map(state.rotors.map(r => [r.id, r.angle]));
  for (const mesh of state.pools.values()) { mesh.count = 0; mesh.visible = false; }
  state.rotors = []; state.rows = buildings.length; state.buildings = 0; state.construction = 0;
  for (const b of buildings) {
    if (b.adopted) continue;
    const yaw = realmRtsModelYaw(b), ground = realmRtsSiteGround(b), y = ground.top;
    const progress = Math.max(0, Math.min(1, Number(b.progress) || 0)), constructing = b.status === 'building', upgrading = b.status === 'upgrading';
    const level = Math.max(1, Math.min(4, Number(b.level) || 1)), scale = 1 + 0.08 * (Math.min(4,level + (upgrading ? progress : 0)) - 1);
    const height = REALM_RTS_MODEL_HEIGHT[b.kind] * scale;
    const depth = Math.max(0.18,ground.top-ground.bottom);
    realmRtsModelInstance('foundation', b.x, ground.bottom, b.z, yaw, 12/7.6, depth/0.36, 12/7.6, '#ffffff');
    if (!constructing || progress >= 0.15) {
      realmRtsModelInstance(b.kind, b.x, y, b.z, yaw, scale, scale * (constructing ? Math.max(0.18, progress) : 1), scale,
        constructing || upgrading ? '#c6bba7' : '#ffffff');
      state.buildings++;
    }
    if (constructing || upgrading) {
      realmRtsModelInstance('scaffold', b.x, y + 0.2, b.z, yaw, scale, height * (constructing ? Math.max(0.3, progress) : 1), scale, '#ffffff');
      state.construction++;
    }
    const status = constructing || upgrading ? '#e5ba5d' : b.paused ? '#d19359' : b.working ? '#76b783' : b.blocked ? '#b49b75' : '#8b9ba5';
    realmRtsModelInstance('status', b.x, y + height + 0.75, b.z, yaw, scale, scale, scale, status);
    if (b.kind === 'mill' && !constructing && !upgrading) {
      const index = realmRtsModelInstance('rotor', b.x + Math.sin(yaw) * 1.8 * scale, y + 5.1 * scale,
        b.z + Math.cos(yaw) * 1.8 * scale, yaw, scale, scale, scale, '#ffffff');
      state.rotors.push({ id: b.id, index, x: b.x + Math.sin(yaw) * 1.8 * scale, y: y + 5.1 * scale,
        z: b.z + Math.cos(yaw) * 1.8 * scale, yaw, scale, angle: oldAngles.get(b.id) || 0, working: b.working === true && !b.paused });
    }
  }
  for (const mesh of state.pools.values()) {
    mesh.instanceMatrix.needsUpdate = true; mesh.instanceColor.needsUpdate = true;
  }
  realmRtsModelsAnimate(0, true);
}
function realmRtsModelsAnimate(dt, force = false) {
  const state = REALM_RTS_MODELS, mesh = state.pools.get('rotor');
  if (!mesh) return;
  let changed = false;
  for (const rotor of state.rotors) {
    if (!force && !rotor.working) continue;
    if (rotor.working) rotor.angle = (rotor.angle + dt * 1.35) % (Math.PI * 2);
    const scratch = state.scratch, object = scratch.object;
    scratch.rotation.setFromEuler(scratch.euler.set(0, rotor.yaw, 0));
    scratch.spin.setFromAxisAngle(scratch.axis, rotor.angle);
    object.position.set(rotor.x, rotor.y, rotor.z); object.quaternion.copy(scratch.rotation).multiply(scratch.spin);
    object.scale.set(rotor.scale, rotor.scale, rotor.scale); object.updateMatrix();
    mesh.setMatrixAt(rotor.index, object.matrix); changed = true;
  }
  if (changed) mesh.instanceMatrix.needsUpdate = true;
}
function realmRtsModelsFrame(dt) {
  const state = REALM_RTS_MODELS, data = realmRtsModelsView();
  if (!data) { if (state.group) realmRtsModelsClear(); return; }
  // updateLod runs after this hook. Wait for its actual terrain surface on cold
  // entry, then create models on the next frame without a temporary floating fit.
  if (typeof LOD !== 'undefined' && !LOD.built) { if (state.group) realmRtsModelsClear(); return; }
  if (state.group && state.world !== W.H) realmRtsModelsClear();
  const step = Number.isFinite(dt) ? Math.max(0, Math.min(0.1, dt)) : 0;
  state.check += step;
  if (!state.group || state.view !== data || state.check >= 0.25) {
    const plots = realmRtsModelRows(data, 'ownplots', 'publicPlots', false);
    const buildings = realmRtsModelRows(data, 'ownbuildings', 'publicBuildings', true);
    const ground = realmRtsGroundRevision(), signature = realmRtsModelSignature(plots, buildings) + ':' + ground;
    if (!state.group) realmRtsModelsInit();
    if (state.signature !== signature) { realmRtsModelsRebuild(plots, buildings); state.signature = signature; }
    realmRtsModelsSolids(buildings);
    realmRtsModelsPlots(plots,buildings);
    state.ground = ground;
    state.view = data; state.check = 0;
  }
  // Tab, selection and camera changes are independent of realm ledger revisions.
  if (!realmRtsConstructionOverlay() && state.plots) { state.group.remove(state.plots); state.plots.geometry.dispose(); state.plots = null; state.plotKey = ''; }
  realmRtsModelsAnimate(step);
}
function realmRtsModelsClear() {
  const state = REALM_RTS_MODELS;
  let removed = false;
  for (const item of state.solids.values()) { realmRtsModelsDropSolid(item); removed = true; }
  state.solids.clear(); if (removed && COVER.built) buildCoverMask();
  if (state.plots) { state.plots.geometry.dispose(); state.plots = null; }
  if (state.group?.parent) state.group.parent.remove(state.group);
  for (const mesh of state.pools.values()) { mesh.geometry.dispose(); if (typeof mesh.dispose === 'function') mesh.dispose(); }
  if (state.material) state.material.dispose();
  if (state.group) state.group.clear();
  state.group = null; state.material = null; state.scratch = null; state.pools.clear();
  state.signature = ''; state.view = null; state.check = 0; state.rotors = [];
  state.rows = 0; state.buildings = 0; state.construction = 0;
  state.plotKey = ''; state.ground = -1; state.world = null;
  state.bodyBounds.clear(); realmRtsSitesClear();
}
