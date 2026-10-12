/* ================================================================== */
/* [siege3] everything of timber in a keep or a temple burns as built  */
/* ================================================================== */
// The burhs' wall walks are decks of boards on joists and posts (castleTimber, 04g_castles.js: C.decks), their gates are
// leaves of planks, and the timber temple's gate is planks too. All of them burn as the palisades do (04g_burn.js):
// a fire spell or a burning arrow landing on them, a brand held to them (E), the dragon's breath, a burning palisade or
// tower beside them, or a deck burning along to the next stretch, with the caster's side spared (the garrison's and its
// realm's own fire never lights its own walls; the player's always does). A deck is cut into cells of BZ_CELL m along
// its length, each with its own floor (floorAt): a burning cell has real flames on its boards and under them, chars
// (the castle shader: deckCut sets tChar/tGlow/tFresh, BLAZE_GLSL in CASTLE_CUT_GLSL), burns whoever stands on it, sheds
// embers into the court, spreads along the walk, to the palisade it runs beside and to the towers it meets, and after
// BZ_T.burn seconds burns through: its boards and joists are gone (cut in the shader), its floor stands down (whoever
// stood on it falls: the ladder fall's motion, harm by the height), a heap of charred boards lies below, and the walk
// has a gap no body walks across (castleFollow and castleWaypoint leave the routes over it). A gate burns, chars (the
// engines' charring shader on its leaves) and falls when its timbers give (its door entity dies as a broken gate's does:
// everyone may pass, and the war rebuilds it). Rain and snow damp them all; in peace a burnt-through deck is built back
// board by board (pale new timber) and a charred one replaced. The garrison fights fire (below): the keep's people see a
// fire on their walls, gate or towers and go to beat it out, leaving their watch, and the player beats flames out with
// Use beside them (body action 21). Saved with the world (save part world.x.blaze). The shared files only call in, each
// line marked [siege3]: 04g_castles.js (castleTimber's decks, the castle shader, castleFollow, castleWaypoint,
// updateCastles), 04e_houses.js (fireLandsAt, fireConeAt), 04l_towers.js (towerOffers), 08_ai.js (thinkPosted, the
// burnt gate's news), 05a_rig.js (action 21's pose).

const BLAZE = { list: [], gates: [], ready: false, gaps: 0, stats: { lit: 0, spread: 0, out: 0, through: 0, rebuilt: 0, spared: 0, harm: 0, fell: 0, gateLit: 0, gateDown: 0, gateOut: 0, beats: 0, beatOut: 0, crews: 0, gaveUp: 0, playerBeats: 0 }, dirty: new Set() };
const BZ_CELL = 1.6, DZ_MAX = 8, BZ_FLAMES = 2;
const BZ_T = { climb: 16, burn: 55, spread: 7, quiet: 20, rebuild: 110, ember: 100, harm: 0.035, fresh: 140, npcCatch: 0.35, reach: 4, gate: 60, gateNpc: 0.3, beat: 0.075, beatP: 0.22, crew: 2, crewMax: 4 };
const BZ_FALL_L = { hatch: null, T: null }; // the ladder fall's motion wants a ladder: none here (towerLadderStep only reads its hatch)
const BLAZE_GLSL = /* glsl */`
    // [siege3] a burh's wall walk burning (04g_blaze.js): S = the keep (x, z, cos, sin of its yaw), Y = (the walk's top,
    // world), zones of deck cells in the keep's frame: A = (x0, z0, x1, z1), B = (char, embers, fresh timber, cut: how
    // much of its length is burnt through, + 2 when the deck runs along z)
    uniform vec4 uDS; uniform vec4 uDY; uniform vec4 uDA[${DZ_MAX}]; uniform vec4 uDB[${DZ_MAX}];
    bool deckCut(vec3 p, float pmat){
      if (uDS.z == 0.0 && uDS.w == 0.0) return false;
      int pm = int(pmat + 0.5);
      if (uDY.y > 0.5) {
        // a timber hallow's ring of logs (Y.y = 1): zones A = (the sector's middle angle, its half-angle, inner and outer
        // radius); above the stumps (Y.z) a sector burnt through is gone, closing from its ends as it is built back
        if (pm != 5 && pm != 1 && pm != 13) return false;
        vec2 d = p.xz - uDS.xy, l = vec2(d.x * uDS.z - d.y * uDS.w, d.x * uDS.w + d.y * uDS.z);
        float r = length(l), ang = atan(l.x, l.y + 1e-4);
        bool cut = false;
        for (int i = 0; i < ${DZ_MAX}; i++) {
          vec4 A = uDA[i], B = uDB[i];
          if (A.y <= 0.0 || r < A.z - 0.4 || r > A.w + 0.4) continue;
          float da = abs(mod(ang - A.x + 3.14159265, 6.2831853) - 3.14159265) * r; // metres round the ring from the middle
          float hw = A.y * r, inside = 1.0 - smoothstep(hw - 0.2, hw + 0.8, da);
          if (inside <= 0.0) continue;
          tChar = max(tChar, B.x * inside * (0.72 + 0.28 * vnoise(p.xz * 2.3 + p.y * 1.7)));
          tGlow = max(tGlow, B.y * inside);
          tFresh = max(tFresh, B.z * inside);
          float rag = (vnoise(vec2(p.y * 1.3 + float(i) * 3.1, r * 2.0)) - 0.5) * 0.5;
          if (B.w > 0.001 && da < hw * B.w + rag && p.y > uDY.z + (vnoise(vec2(da * 4.0, 1.0)) - 0.5) * 0.35) cut = true;
        }
        return cut;
      }
      if (pm != 1 && pm != 13) return false; // the boards, joists (wood) and the posts (logs)
      float yT = uDY.x;
      if (p.y > yT + 0.25) return false;
      vec2 d = p.xz - uDS.xy, l = vec2(d.x * uDS.z - d.y * uDS.w, d.x * uDS.w + d.y * uDS.z);
      bool cut = false;
      for (int i = 0; i < ${DZ_MAX}; i++) {
        vec4 A = uDA[i], B = uDB[i];
        if (A.z <= A.x) continue;
        if (l.x < A.x - 0.7 || l.x > A.z + 0.7 || l.y < A.y - 0.7 || l.y > A.w + 0.7) continue;
        float inside = smoothstep(A.x - 0.7, A.x + 0.15, l.x) * (1.0 - smoothstep(A.z - 0.15, A.z + 0.7, l.x)) * smoothstep(A.y - 0.7, A.y + 0.15, l.y) * (1.0 - smoothstep(A.w - 0.15, A.w + 0.7, l.y));
        float up = smoothstep(yT - 3.2, yT - 0.6, p.y); // the char runs down the posts from the boards
        tChar = max(tChar, B.x * inside * up * (0.72 + 0.28 * vnoise(p.xz * 2.3 + p.y * 1.7)));
        tGlow = max(tGlow, B.y * inside * up);
        tFresh = max(tFresh, B.z * inside * smoothstep(yT - 0.75, yT - 0.55, p.y));
        float az = step(1.5, B.w), cw = B.w - 2.0 * az;
        if (cw > 0.001 && pm == 1 && p.y > yT - 0.5) {
          // burnt through: the boards and joists gone over the zone's length (ragged ends); built back, the gap closes
          // from its ends toward its middle
          float al = az > 0.5 ? l.y : l.x, a0 = az > 0.5 ? A.y : A.x, a1 = az > 0.5 ? A.w : A.z, ac = az > 0.5 ? l.x : l.y, c0 = az > 0.5 ? A.x : A.y, c1 = az > 0.5 ? A.z : A.w;
          float m = (a0 + a1) * 0.5, h = (a1 - a0) * 0.5 * cw;
          float rag = (vnoise(vec2(ac * 3.1 + float(i) * 2.3, p.y * 9.0)) - 0.5) * 0.36;
          if (abs(al - m) < h + rag && ac > c0 - 0.15 && ac < c1 + 0.15) cut = true;
        }
      }
      return cut;
    }
`;

/* ------------------------------------------------------------------ */
/* the decks: cells along each walk, each with its own floor           */
/* ------------------------------------------------------------------ */
function blazeInit() {
  if (BLAZE.ready || !CASTLES.length || !CASTLES.some((C) => C.cutU)) return;
  BLAZE.ready = true;
  for (const C of CASTLES) {
    // the gates of the burhs and of the timber temple: their leaves of planks burn
    if (C.gate && C.R.style === 'timber') blazeGateInit(C);
    if (C.ring && C.ring.length) { blazeRingInit(C); continue; }
    if (!C.decks || !C.decks.length || !C.cutU) continue;
    const S = C.S, B = { C, S, cells: [], wmat: null };
    C.decks.forEach((d, di) => {
      const alongX = d.hx >= d.hz, L = 2 * (alongX ? d.hx : d.hz), n = Math.max(1, Math.round(L / BZ_CELL)), w = L / n, a0 = (alongX ? d.cx - d.hx : d.cz - d.hz);
      if (d.f) d.f.active = false; // the deck's one floor gives way to its cells'
      for (let k = 0; k < n; k++) {
        const p0 = a0 + k * w - (k === 0 ? 0.06 : 0.03), p1 = a0 + (k + 1) * w + (k === n - 1 ? 0.06 : 0.03);
        const x0 = alongX ? p0 : d.cx - d.hx - 0.06, x1 = alongX ? p1 : d.cx + d.hx + 0.06, z0 = alongX ? d.cz - d.hz - 0.06 : p0, z1 = alongX ? d.cz + d.hz + 0.06 : p1;
        const lx = (x0 + x1) / 2, lz = (z0 + z1) / 2, wp = siteToWorld(S, lx, lz);
        const f = addFloorBox(wp.x, wp.z, (x1 - x0) / 2, (z1 - z0) / 2, S.yaw, S.y + d.y, S.y + d.y, S.y + (d.y0 ?? 0), d.th ?? 0.4, 'walk');
        f.deck = true;
        C.floors.push(f);
        B.cells.push({ B, di, k, alongX, lx, lz, x0, x1, z0, z1, x: wp.x, z: wp.z, y: S.y + d.y, f, st: 0, heat: 0, char: 0, t: 0, ember: 0, fresh: 0, rb: 0, fires: [], tick: 0, nb: [], pal: [], tw: null, gen: 0 });
      }
    });
    // neighbours along the walk and across its joints (the corner decks, the landings)
    for (const c of B.cells) for (const o of B.cells) if (o !== c && dist2(c.x, c.z, o.x, o.z) < (BZ_CELL * 1.4) ** 2) c.nb.push(o);
    C.blaze = B;
    BLAZE.list.push(B);
    blazeUpload(B);
  }
}
// a timber hallow: its log ring in segments that burn, its meshes on the castle shader to show it
const TEMPLE_MESH = new Map(), BZ_RING = { R0: 16, rIn: 15.25, rOut: 17.2, stump: 0.45, wt: 3.0 };
function blazeRingInit(C) {
  const S = C.S, tm = TEMPLE_MESH.get(S);
  if (!C.cutU) {
    C.cutU = castleCutUniforms();
    const m = shareMat(castleMat, { uFlash: buildingMat.uniforms.uFlash, ...C.cutU });
    C.mesh.material = m;
    if (tm) tm.material = m;
    const dm = depthFrom(m, CASTLE_DEPTH_FS);
    for (const q of SHADOW.proxies) if (q.userData.src === C.mesh || (tm && q.userData.src === tm)) q.material = dm;
  }
  const B = { C, S, cells: [], ring: true, wmat: null };
  for (const g of C.ring) {
    const lx = Math.sin(g.am) * BZ_RING.R0, lz = Math.cos(g.am) * BZ_RING.R0, wp = siteToWorld(S, lx, lz);
    // the ring's own collider for this stretch (buildTempleColliders, 01_world.js)
    let wall = null, bd = 4;
    for (const c of S.colliders) if (c.tag === 'wall' && c.type === 'box') { const d = dist2(c.x, c.z, wp.x, wp.z); if (d < bd) { bd = d; wall = c; } }
    B.cells.push({ B, ring: true, di: 0, k: g.i, seg: g, am: g.am, a0: g.a0, a1: g.a1, lx, lz, x: wp.x, z: wp.z, y: S.y + 1.5, f: g.f, colls: g.colls, wall, st: 0, heat: 0, char: 0, t: 0, ember: 0, fresh: 0, rb: 0, fires: [], tick: 0, nb: [], pal: [], tw: null, gen: 0 });
  }
  for (const c of B.cells) for (const o of B.cells) if (Math.abs(o.k - c.k) === 1) c.nb.push(o);
  C.blaze = B;
  BLAZE.list.push(B);
  blazeUpload(B);
}
// the ring's segment by (x, y, z), within reach r of its logs, or null
function ringCellAt(B, x, y, z, r) {
  const S = B.S;
  if (y < S.y - 0.5 || y > S.y + BZ_RING.wt + 1.6) return null;
  const l = siteLocal(S, x, z), rr = Math.hypot(l.x, l.z), ang = Math.atan2(l.x, l.z);
  if (rr < BZ_RING.rIn - r - 0.4 || rr > BZ_RING.rOut + r + 0.4) return null;
  let best = null, bd = Infinity;
  for (const c of B.cells) {
    const da = Math.abs(angDiff(ang, c.am)) * rr - ((c.a1 - c.a0) / 2) * rr, d = Math.max(0, da);
    if (d <= r + 0.3 && d < bd) { bd = d; best = c; }
  }
  return best;
}

// the palisade cells and towers each deck cell meets (once the palisades are set out)
function blazeLinks(B) {
  if (B.linked) return;
  palisadeInit();
  B.linked = true;
  const C = B.C;
  for (const c of B.cells) {
    if (C.pal) for (const q of C.pal.cells) if (dist2(c.x, c.z, q.x, q.z) < 2.1 * 2.1) c.pal.push(q);
    for (const T of TOWER.list) {
      if (T.C !== C || T.look !== 'timber') continue;
      const l = twLocal(T, c.x, c.z);
      if (Math.max(Math.abs(l.x), Math.abs(l.z)) < T.HO + BZ_CELL * 0.8) { c.tw = T; break; }
    }
  }
}
// the deck cell under or beside (x, y, z), within reach r of its boards, or null
function deckCellAt(x, y, z, r) {
  blazeInit();
  let best = null, bd = Infinity;
  for (const B of BLAZE.list) {
    if (dist2(x, z, B.S.x, B.S.z) > (KEEP_HS + 4 + r) ** 2) continue;
    if (B.ring) { const c = ringCellAt(B, x, y, z, r); if (c) return c; continue; }
    if (y < B.S.y + 2.5 || y > B.S.y + BURH_WALK + 2.2) continue;
    const l = siteLocal(B.S, x, z);
    for (const c of B.cells) {
      const ex = Math.max(0, c.x0 - l.x, l.x - c.x1), ez = Math.max(0, c.z0 - l.z, l.z - c.z1), dy = Math.max(0, Math.abs(y - c.y) - 0.6), d = Math.hypot(ex, ez, dy);
      if (d <= r + 0.2 && d < bd) { bd = d; best = c; }
    }
  }
  return best;
}
// may the fire of `by` light this keep's timber? (the garrison's and its realm's own fire never does; the player's always)
function blazeSpared(S, by) {
  if (!by || by === GAME.player || by.role === 'player') return false;
  const K = S.keepRef || S.templeRef;
  return !!(K && by.faction === K.realm);
}
// fire lands at (x, y, z) with reach r, cast by `by` (fireLandsAt)
function deckFireAt(x, y, z, r, by) {
  if (!BLAZE.ready) blazeInit();
  let n = gateFireAt(x, y, z, r, by);
  const c = deckCellAt(x, y, z, Math.max(0.5, r * 0.6));
  if (!c) return n;
  if (blazeSpared(c.B.S, by)) { BLAZE.stats.spared++; return n; }
  if (!by && (c.st === 2 || BLAZE.sparking || PAL.sparking)) return n; // a spark does not take again in boards already burnt and put out, nor the walls' own embers in them (their fire goes from stretch to stretch)
  if (by && by.faction !== undefined && by !== GAME.player && by.role !== 'player' && Math.random() > BZ_T.npcCatch) return n; // boards take a soldier's fire only now and then
  return n + (deckIgnite(c) ? 1 : 0);
}
// the dragon's breath along (dx, dz) from (x, z)
function deckFireCone(x, z, dx, dz, range, half) {
  if (!BLAZE.ready) blazeInit();
  let n = 0;
  for (const B of BLAZE.list) {
    if (dist2(x, z, B.S.x, B.S.z) > (range + KEEP_HS + 4) ** 2) continue;
    for (const c of B.cells) {
      const ox = c.x - x, oz = c.z - z, d = Math.hypot(ox, oz);
      if (d > range || (d > 1.5 && (ox * dx + oz * dz) / d < Math.cos(half + 0.1))) continue;
      if (deckIgnite(c)) { n++; if (n >= 2) return n; }
    }
  }
  for (const G0 of BLAZE.gates) {
    const D = G0.door || blazeGateDoor(G0);
    if (!D) continue;
    const ox = D.x - x, oz = D.z - z, d = Math.hypot(ox, oz);
    if (d > range + 2 || (d > 1.5 && (ox * dx + oz * dz) / d < Math.cos(half + 0.15))) continue;
    if (gateIgnite(G0)) n++;
  }
  return n;
}
function deckIgnite(c, heat = 0.12, gen = 0) {
  if (c.st === 1 || c.st === 3) return false;
  if (c.st !== 2) c.t = 0; // (boards burnt once and put out burn through the sooner)
  c.st = 1; c.heat = Math.max(c.heat, heat); c.tick = 0; c.gen = gen; c.rb = 0;
  BLAZE.stats.lit++;
  BLAZE.dirty.add(c.B);
  const P = GAME.player, B = c.B;
  if (P && dist2(P.x, P.z, c.x, c.z) < 70 * 70 && GAME.t > (B.told || 0)) { B.told = GAME.t + 20; sfx('ignite'); uiLog(B.ring ? `The log wall of ${B.S.name} has caught fire!` : `The wall walk of ${B.S.name} has caught fire!`, 'warn'); }
  return true;
}
// where flames show on a burning cell: on its boards and under them
function deckSpots(c) {
  if (c.spots) return c.spots;
  const S = c.B.S, out = [], ax = c.alongX;
  if (c.ring) { // against the ring's outer face low, its inner face and along the breastwork on its top
    for (const [rr, y, s, da] of [[BZ_RING.R0 + 0.8, 0.9, 0.8, -0.2], [BZ_RING.R0 - 0.8, 1.8, 0.75, 0.25], [BZ_RING.R0 + 0.45, BZ_RING.wt + 0.7, 0.75, 0]]) {
      const a = c.am + da * (c.a1 - c.a0), p = siteToWorld(S, Math.sin(a) * rr, Math.cos(a) * rr);
      out.push({ x: p.x, z: p.z, y: S.y + y, s });
    }
    return (c.spots = out);
  }
  for (const [u, y, s] of [[-0.35, 0.18, 0.7], [0.0, -0.55, 0.65], [0.4, 0.2, 0.6]]) {
    const lx = ax ? c.lx + u * (c.x1 - c.x0) * 0.5 : c.lx + (Math.random() - 0.5) * 0.4, lz = ax ? c.lz + (Math.random() - 0.5) * 0.4 : c.lz + u * (c.z1 - c.z0) * 0.5, p = siteToWorld(S, lx, lz);
    out.push({ x: p.x, z: p.z, y: c.y + y, s });
  }
  return (c.spots = out);
}
// is a body standing on this cell's boards?
function deckOn(c, o, pad = 0.15) {
  const l = siteLocal(c.B.S, o.x, o.z);
  if (c.ring) { const rr = Math.hypot(l.x, l.z), da = Math.abs(angDiff(Math.atan2(l.x, l.z), c.am)) * rr; return da < (c.a1 - c.a0) / 2 * rr + pad && rr > BZ_RING.R0 - 1.1 - pad && rr < BZ_RING.R0 + 1.1 + pad && Math.abs(o.y - (c.B.S.y + BZ_RING.wt)) < 0.65; }
  return l.x > c.x0 - pad && l.x < c.x1 + pad && l.z > c.z0 - pad && l.z < c.z1 + pad && Math.abs(o.y - c.y) < 0.65;
}
function deckBurnStep(c, dt, wet) {
  c.t += dt;
  c.heat = clamp(c.heat + dt * (1 / BZ_T.climb) * (1 - 1.5 * wet), 0, 1);
  c.char = Math.max(c.char, clamp(c.t / BZ_T.burn, 0, 1) * 0.9 + c.heat * 0.1);
  const B = c.B, S = B.S;
  if (c.heat <= 0) { deckOut(c); return; }
  if (GAME.t > c.tick) {
    c.tick = GAME.t + 1.0;
    c.fires = c.fires.filter((f) => f.until > GAME.t);
    const spots = deckSpots(c), want = Math.round(1 + c.heat * (BZ_FLAMES - 1));
    let lit = c.fires.length;
    fireLetGo(); // (04g_burn.js) room for its flames
    for (const s of spots) {
      if (lit >= want) break;
      if (s.lit > GAME.t) continue;
      s.lit = GAME.t + 4;
      const n0 = FIRES.length;
      addFire(s.x, s.y, s.z, s.s * (0.7 + 0.5 * c.heat), false, GAME.t + 4.2, c.fires.length ? null : { r: 8, k: 1.2 });
      if (FIRES.length > n0) c.fires.push(FIRES[FIRES.length - 1]);
      lit++;
    }
    // along the walk to the boards either side (a few stretches from where it took hold)
    if (c.heat > 0.45 && c.gen < BZ_T.reach) for (const o of c.nb) if (o.st === 0 && Math.random() < (1 / BZ_T.spread) * c.heat * (1 - wet)) { deckIgnite(o, 0.1, c.gen + 1); BLAZE.stats.spread++; }
    // to the palisade it runs beside, and the tower it meets
    // (only near where the fire took hold, and the stretch it lights goes no further: a fire crossing between the walk
    // and the palisade back and forth would never stop)
    if (c.heat > 0.55 && c.gen <= 1) {
      for (const q of c.pal) if (q.st === 0 && Math.random() < 0.06 * c.heat * (1 - wet)) palisadeIgnite(q, 0.1, PAL_T.reach);
      if (c.tw && !c.tw.burn && !c.tw.fallen && Math.random() < 0.05 * c.heat * (1 - wet)) towerIgnite(c.tw, BURH_WALK + 0.5);
    }
    // whoever stands on it is burnt (and, less, whoever is under it)
    forNear(c.x, c.z, c.ring ? 4.2 : 2.4, (o) => {
      if (!o.alive || o.kind === 'door' || o.flying) return;
      const on = deckOn(c, o), under = !on && (c.ring ? o.y < B.S.y + 2 && deckOn(c, { x: o.x, z: o.z, y: B.S.y + BZ_RING.wt }, 0.9) : o.y < c.y - 0.6 && o.y > c.y - 4 && deckOn(c, { x: o.x, z: o.z, y: c.y }, 0.1));
      if (!on && !under) return;
      addBuff(o, 'burn', o.maxHp * BZ_T.harm * c.heat * (on ? 1 : 0.35), 2, null);
      BLAZE.stats.harm++;
      if (o === GAME.player && on && !c.told) { c.told = true; uiLog('The boards are burning under your feet!', 'hurt'); }
    });
    // embers fall into the court and set what lies there alight
    if (Math.random() < 0.25 * c.heat) { BLAZE.sparking = true; fireLandsAt(c.x + (Math.random() - 0.5) * 3, heightAt(c.x, c.z) + 0.3, c.z + (Math.random() - 0.5) * 3, 1.0, null); BLAZE.sparking = false; }
    BLAZE.dirty.add(B);
  }
  if (c.t >= BZ_T.burn) deckThrough(c);
}
function deckOut(c) {
  for (const f of c.fires) f.until = GAME.t;
  c.fires = []; c.heat = 0; c.st = c.char > 0.15 ? 2 : 0;
  BLAZE.stats.out++;
  BLAZE.dirty.add(c.B);
}
// burnt through: the boards fall in, the floor stands down, whoever stood there falls
function deckThrough(c, quiet = false) {
  for (const f of c.fires) f.until = GAME.t;
  c.fires = []; c.st = 3; c.ember = quiet ? 0 : 1; c.char = 1; c.heat = 0; c.rb = 0;
  c.f.active = false;
  if (c.ring) { if (c.wall) c.wall.active = false; for (const q of c.colls) q.active = false; } // a gap in the hallow's ring
  BLAZE.gaps++;
  BLAZE.stats.through++;
  const B = c.B, S = B.S;
  if (!c.wreck) {
    if (!B.wmat) B.wmat = shareMat(siegeMat, { uFlash: buildingMat.uniforms.uFlash, uChar: { value: 1 }, uEmber: { value: 1 } });
    c.wreck = new THREE.Mesh(c.ring ? ringWreckGeo(c) : deckWreckGeo(c), B.wmat); c.wreck.renderOrder = 1; scene.add(c.wreck); shadowCaster(c.wreck, BUILDING_DEPTH);
  }
  c.wreck.visible = true;
  BLAZE.dirty.add(B);
  if (quiet) return;
  forNear(c.x, c.z, 2.6, (o) => {
    if (!o.alive || o.kind === 'door' || o.flying || !deckOn(c, o, 0.25)) return;
    if (o.motion && o.motion.kind === 'ladder') { ladderKnockOff(o, null); return; }
    o.fixedY = null;
    o.motion = { kind: 'ladder', L: BZ_FALL_L, st: 3, t: 0, vy: 0.2, y0: o.y, by: null, dx: 0, dz: 0, dir: 1 };
    setAct(o, 6, 1.5);
    BLAZE.stats.fell++;
    if (o === GAME.player) uiLog('The burning walk gives way under you!', 'hurt');
  });
  for (let i = 0; i < 4; i++) later(i * 0.1, () => FX.dust(c.x + (Math.random() - 0.5) * 1.4, c.y - Math.random() * 3, c.z + (Math.random() - 0.5) * 1.4, 12, wallLit([0.2, 0.18, 0.16])));
  const P = GAME.player;
  if (P && dist2(P.x, P.z, c.x, c.z) < 80 * 80) { sfx('crash'); cameraShake(0.15, c.x, c.z); }
  const K = S.keepRef;
  const K2 = K || S.templeRef;
  if (K2 && GAME.t > (B.newsAt || -1e9)) { B.newsAt = GAME.t + 45; news(B.ring ? `The log wall of ${S.name} has burnt through!` : `The wall walk of ${S.name} has burnt through!`, K2.realm, K2.realm === (P && P.faction) ? 'alarm' : 'normal'); }
}
// built back: the floor carries again
function deckMended(c) {
  c.st = 0; c.char = 0; c.heat = 0; c.fresh = 1; c.rb = 0; c.ember = 0;
  if (!c.f.active) { c.f.active = true; BLAZE.gaps = Math.max(0, BLAZE.gaps - 1); }
  if (c.ring) { if (c.wall) c.wall.active = true; for (const q of c.colls) q.active = true; }
  if (c.wreck) c.wreck.visible = false;
  BLAZE.stats.rebuilt++;
  BLAZE.dirty.add(c.B);
}
// the charred boards and a snapped joist lying in the court under a burnt-through cell, ash round them
function deckWreckGeo(c) {
  const S = c.B.S, b = new Batch(), M = siteMatrix(S), r = mulberry(Math.round(Math.abs(c.x * 31 + c.z * 17)) + 3);
  const coal = () => [0.05 + r() * 0.04, 0.045 + r() * 0.03, 0.04 + r() * 0.025];
  const L = c.alongX ? c.x1 - c.x0 : c.z1 - c.z0, yaw0 = c.alongX ? Math.PI / 2 : 0;
  for (let i = 0; i < 9; i++) {
    const lx = c.lx + (r() - 0.5) * (c.alongX ? L : 1.6) * 1.2, lz = c.lz + (r() - 0.5) * (c.alongX ? 1.6 : L) * 1.2, wq = siteToWorld(S, lx, lz), gy = heightAt(wq.x, wq.z) - S.y;
    b.add(G.box, lm(M, lx, gy + 0.05 + r() * 0.08, lz, yaw0 + (r() - 0.5) * 0.9, 0.22, 0.05, 0.6 + r() * 0.9, (r() - 0.5) * 0.12, (r() - 0.5) * 0.12), MAT.wood, coal());
  }
  { // a joist snapped, one end on the ground, the other still up at a post
    const lx = c.lx + (c.alongX ? (r() - 0.5) * L * 0.5 : 0), lz = c.lz + (c.alongX ? 0 : (r() - 0.5) * L * 0.5), wp = siteToWorld(S, lx, lz), gy = heightAt(wp.x, wp.z) - S.y, H = c.y - S.y - 0.6 - gy;
    b.add(G.box, lm(M, lx, gy + H * 0.45, lz, yaw0 + 0.3, 0.16, 0.18, Math.hypot(H, 1.4), 0.9), MAT.wood, coal());
  }
  for (let i = 0; i < 6; i++) { const lx = c.lx + (r() - 0.5) * 2.2, lz = c.lz + (r() - 0.5) * 2.2, wp = siteToWorld(S, lx, lz); b.add(G.ico, lm(M, lx, heightAt(wp.x, wp.z) - S.y + 0.02, lz, r() * 3, 0.45 + r() * 0.5, 0.04 + r() * 0.05, 0.4 + r() * 0.4), MAT.darkstone, [0.2 + r() * 0.06, 0.19 + r() * 0.05, 0.18 + r() * 0.05]); }
  return b.build();
}

// a hallow's ring burnt through: charred stumps standing in the gap, logs fallen across it and out on both sides, ash
function ringWreckGeo(c) {
  const S = c.B.S, b = new Batch(), M = siteMatrix(S), r = mulberry(Math.round(Math.abs(c.x * 23 + c.z * 41)) + 9);
  const coal = () => [0.05 + r() * 0.04, 0.045 + r() * 0.03, 0.04 + r() * 0.025];
  const at = (a, rr) => ({ x: Math.sin(a) * rr, z: Math.cos(a) * rr });
  const n = Math.max(4, Math.round(c.seg.len / 0.55));
  for (let i = 0; i < n; i++) {
    const a = lerp(c.a0, c.a1, (i + 0.5) / n), p = at(a, BZ_RING.R0 + (r() - 0.5) * 0.9), h = BZ_RING.stump * (0.6 + 0.9 * r());
    b.add(G.cyl8, lm(M, p.x, h / 2 - 0.1, p.z, r() * TAU, 0.26, h + 0.2, 0.26, (r() - 0.5) * 0.2, (r() - 0.5) * 0.2), MAT.logH, coal(), S.y, 1.2);
  }
  for (let i = 0; i < Math.round(n * 0.9); i++) {
    const a = lerp(c.a0, c.a1, r()), p = at(a, BZ_RING.R0 + (r() < 0.5 ? -1 : 1) * (0.9 + r() * 2.2)), L = 1.4 + r() * 2.4;
    b.add(G.cyl8, lm(M, p.x, 0.18 + r() * 0.2, p.z, a + Math.PI / 2 + (r() - 0.5) * 0.8, 0.22, L, 0.22, Math.PI / 2 + (r() - 0.5) * 0.3), MAT.logH, coal(), S.y, 1.2);
  }
  for (let i = 0; i < 10; i++) { const p = at(lerp(c.a0, c.a1, r()), BZ_RING.R0 + (r() - 0.5) * 3); b.add(G.ico, lm(M, p.x, 0.02, p.z, r() * 3, 0.5 + r() * 0.6, 0.05 + r() * 0.06, 0.4 + r() * 0.5), MAT.darkstone, [0.2 + r() * 0.06, 0.19 + r() * 0.05, 0.18 + r() * 0.05]); }
  return b.build();
}

/* ------------------------------------------------------------------ */
/* the gates of planks                                                 */
/* ------------------------------------------------------------------ */
function blazeGateDoor(G0) { return (G0.door = G0.door || (G0.S.keepRef ? G0.S.keepRef.door : G0.S.templeRef ? G0.S.templeRef.door : null)); }
function blazeGateInit(C) {
  const G0 = C.gate;
  if (G0.bz) return;
  G0.bz = { burn: null, char: 0, fresh: 0, down: false, leafMats: G0.leaves.map((m) => m.material), wreckMat: G0.wreck.material, mat: null, wmat: null };
  BLAZE.gates.push(G0);
}
// does fire landing at (x, y, z) with reach r touch a gate's leaves?
function gateFireAt(x, y, z, r, by) {
  let n = 0;
  for (const G0 of BLAZE.gates) {
    const S = G0.S;
    if (dist2(x, z, S.x, S.z) > 40 * 40 || y < S.y - 0.5 || y > S.y + G0.h + 1.2) continue;
    const l = siteLocal(S, x, z), pad = Math.max(0.6, r * 0.6);
    if (Math.abs(l.x) > G0.hw + pad || Math.abs(l.z - G0.gz) > pad + 0.4) continue;
    if (blazeSpared(S, by)) { BLAZE.stats.spared++; continue; }
    if (!by && (BLAZE.sparking || PAL.sparking || Math.random() > 0.25)) continue; // embers (a burning gate tower's) take only now and then, the walls' own never
    if (by && by.faction !== undefined && by !== GAME.player && by.role !== 'player' && Math.random() > BZ_T.gateNpc) continue;
    if (gateIgnite(G0)) n++;
  }
  return n;
}
function gateIgnite(G0, heat = 0.12) {
  const D = blazeGateDoor(G0), Z = G0.bz;
  if (!D || !D.alive || !Z || Z.burn) return false;
  if (D.templeRef && !doorVulnerable(D)) return false; // a hallow's gate holds until its realm has lost a keep (as against blows)
  Z.burn = { t: 0, heat, fires: [], tick: 0 };
  if (!Z.mat) Z.mat = shareMat(siegeMat, { uFlash: G0.leaves[0].material.uniforms.uFlash, uChar: { value: 0 }, uEmber: { value: 0 } });
  for (const m of G0.leaves) m.material = Z.mat;
  BLAZE.stats.gateLit++;
  const P = GAME.player;
  if (P && dist2(P.x, P.z, D.x, D.z) < 70 * 70) { sfx('ignite'); uiLog(`The gate of ${G0.S.name} has caught fire!`, 'warn'); }
  return true;
}
function gateSpots(G0) {
  if (G0.bzSpots) return G0.bzSpots;
  const S = G0.S, out = [];
  for (const [u, y, o] of [[-0.5, 1.0, 0.35], [0.45, 1.6, -0.35], [0.0, 0.62, 0.35], [-0.2, 0.55, -0.35]]) { const p = siteToWorld(S, u * G0.hw, G0.gz + o); out.push({ x: p.x, z: p.z, y: S.y + y * G0.h * 0.6, s: 0.85 }); }
  return (G0.bzSpots = out);
}
function gateBurnStep(G0, dt, wet) {
  const Z = G0.bz, B = Z.burn, D = blazeGateDoor(G0), S = G0.S;
  if (!D || !D.alive) { if (B) { for (const f of B.fires) f.until = GAME.t; Z.burn = null; } return; }
  B.t += dt;
  B.heat = clamp(B.heat + dt * (1 / BZ_T.climb) * (1 - 1.4 * wet), 0, 1);
  Z.char = Math.max(Z.char, clamp(B.t / BZ_T.gate, 0, 1) * 0.85 + B.heat * 0.15);
  Z.mat.uniforms.uChar.value = Z.char; Z.mat.uniforms.uEmber.value = B.heat * 0.9;
  if (B.heat <= 0) { for (const f of B.fires) f.until = GAME.t; Z.burn = null; Z.mat.uniforms.uEmber.value = 0; BLAZE.stats.gateOut++; return; }
  // the timbers give as they burn: the gate's strength goes with them, and it falls when they are spent
  D.hp -= D.maxHp * dt * (0.4 + 0.6 * B.heat) / BZ_T.gate; D.lastHitAt = GAME.t;
  if (GAME.t > B.tick) {
    B.tick = GAME.t + 1.0;
    B.fires = B.fires.filter((f) => f.until > GAME.t);
    let lit = B.fires.length;
    const want = Math.round(1 + B.heat * 2);
    fireLetGo();
    for (const s of gateSpots(G0)) {
      if (lit >= want) break;
      if (s.lit > GAME.t) continue;
      s.lit = GAME.t + 4;
      const n0 = FIRES.length;
      addFire(s.x, s.y, s.z, s.s * (0.7 + 0.5 * B.heat), false, GAME.t + 4.2, B.fires.length ? null : { r: 9, k: 1.3 });
      if (FIRES.length > n0) B.fires.push(FIRES[FIRES.length - 1]);
      lit++;
    }
    // whoever stands in the gateway is burnt
    forNear(D.x, D.z, G0.hw + 2.5, (o) => {
      if (!o.alive || o.kind === 'door' || o.flying || o.y > S.y + G0.h) return;
      const l = siteLocal(S, o.x, o.z);
      if (Math.abs(l.x) > G0.hw + 0.4 || Math.abs(l.z - G0.gz) > 1.3) return;
      addBuff(o, 'burn', o.maxHp * BZ_T.harm * B.heat, 2, null);
    });
    if (Math.random() < 0.2 * B.heat) { BLAZE.sparking = true; fireLandsAt(D.x + (Math.random() - 0.5) * 4, S.y + 0.3, D.z + (Math.random() - 0.5) * 4, 1.0, null); BLAZE.sparking = false; }
  }
  if (D.hp <= 0) gateFalls(G0, D);
}
// the burnt gate falls in: the door is broken as by a ram (everyone may pass), its wreck lies charred
function gateFalls(G0, D) {
  const Z = G0.bz, B = Z.burn;
  if (B) for (const f of B.fires) f.until = GAME.t;
  Z.burn = null; Z.down = true; Z.char = 1;
  if (!Z.wmat) Z.wmat = shareMat(siegeMat, { uFlash: buildingMat.uniforms.uFlash, uChar: { value: 1 }, uEmber: { value: 1 } });
  Z.wmat.uniforms.uEmber.value = 1;
  G0.wreck.material = Z.wmat;
  BLAZE.stats.gateDown++;
  D.burntDown = true; // (onEntityKilled tells it as burnt, not broken: 08_ai.js)
  D.hp = 1;
  killEnt(D, Z.by ? getEnt(Z.by) : null);
  D.burntDown = false;
  for (let i = 0; i < 5; i++) later(i * 0.12, () => FX.dust(D.x + (Math.random() - 0.5) * 3, D.y + Math.random() * 3, D.z + (Math.random() - 0.5) * 3, 14, wallLit([0.2, 0.18, 0.16])));
}

/* ------------------------------------------------------------------ */
/* each step                                                           */
/* ------------------------------------------------------------------ */
function updateBlaze(dt) {
  if (!BLAZE.ready) { blazeInit(); if (!BLAZE.ready) return; }
  const wet = clamp(U.uWet.value, 0, 1) * (0.4 + 0.6 * clamp(WEATHER.raining || 0, 0, 1)) + clamp(U.uSnowCover.value, 0, 1) * 0.3;
  for (const B of BLAZE.list) {
    if (!B.linked && !B.ring) blazeLinks(B);
    let busy = false;
    for (const c of B.cells) {
      if (c.fresh > 0) { const was = c.fresh; c.fresh = Math.max(0, c.fresh - dt / BZ_T.fresh); if (Math.floor(was * 30) !== Math.floor(c.fresh * 30)) BLAZE.dirty.add(B); }
      if (c.st === 1) { busy = true; deckBurnStep(c, dt, wet); }
      else if (c.st === 3 && c.ember > 0) { const was = c.ember; c.ember = Math.max(0, c.ember - dt / BZ_T.ember * (1 + 2 * clamp(WEATHER.raining || 0, 0, 1))); if (Math.floor(was * 30) !== Math.floor(c.ember * 30)) BLAZE.dirty.add(B); }
    }
    // a burning palisade or tower beside the walk sets its boards alight
    if (!B.ring && GAME.t > (B.linkT || 0)) {
      B.linkT = GAME.t + 1;
      for (const c of B.cells) {
        if (c.st !== 0 && c.st !== 2) continue;
        for (const q of c.pal) if (q.st === 1 && q.heat > 0.55 && (q.gen || 0) <= 1 && Math.random() < 0.05 * q.heat * (1 - wet)) { deckIgnite(c, 0.1, BZ_T.reach); break; }
        if (c.st === 0 && c.tw && c.tw.burn && c.tw.burn.heat > 0.5 && Math.random() < 0.04 * c.tw.burn.heat * (1 - wet)) deckIgnite(c, 0.1, BZ_T.reach - 1);
      }
    }
    if (B.wmat) { let em = 0; for (const c of B.cells) if (c.st === 3) em = Math.max(em, c.ember); B.wmat.uniforms.uEmber.value = em * 0.8; }
    // in peace the walk is built back: a burnt-through cell board by board, a charred one replaced
    const K = B.S.keepRef || B.S.templeRef, calm = !!K && GAME.t - K.lastEnemyNear > BZ_T.quiet;
    if (calm && !busy) for (const c of B.cells) {
      if (c.st === 3) {
        const was = c.rb;
        c.quiet = (c.quiet || 0) + dt;
        if (c.quiet < 2) continue;
        c.rb = Math.min(1, c.rb + dt / BZ_T.rebuild);
        c.fresh = Math.min(1, c.rb * 3);
        if (c.rb > 0.15 && c.wreck) c.wreck.visible = false;
        if (Math.floor(was * 40) !== Math.floor(c.rb * 40)) BLAZE.dirty.add(B);
        if (c.rb >= 1) deckMended(c);
      } else if (c.st === 2) { c.mend = (c.mend || 0) + dt; if (c.mend > 8) { c.st = 0; c.char = 0; c.fresh = 1; c.mend = 0; BLAZE.dirty.add(B); } }
    } else for (const c of B.cells) c.quiet = 0;
  }
  // the gates
  for (const G0 of BLAZE.gates) {
    const Z = G0.bz, D = blazeGateDoor(G0);
    if (!D) continue;
    if (Z.burn) gateBurnStep(G0, dt, wet);
    if (Z.down) {
      if (Z.wmat) Z.wmat.uniforms.uEmber.value = Math.max(0, Z.wmat.uniforms.uEmber.value - dt / 90);
      if (D.alive) { // rebuilt by its owners (the war's own rule for a broken gate): new leaves, pale
        Z.down = false; Z.char = 0; Z.fresh = 1;
        G0.leaves.forEach((m, i) => { m.material = Z.leafMats[i]; });
        G0.wreck.material = Z.wreckMat;
      }
    } else if (!Z.burn && Z.char > 0 && D.alive) {
      // a gate that burnt and stood: once its realm is at peace and it is whole again, its charred leaves are replaced
      const K = D.keepRef || D.templeRef;
      if (K && GAME.t - K.lastEnemyNear > BZ_T.quiet && D.hp >= D.maxHp * 0.98) { Z.mend = (Z.mend || 0) + dt; if (Z.mend > 8) { Z.char = 0; Z.mend = 0; G0.leaves.forEach((m, i) => { m.material = Z.leafMats[i]; }); G0.flashT = 1.6; } }
    }
  }
  blazeCrews(dt);
  houseRafterSync(dt); // the broken timbers across the holes stones knocked in roofs (04j_rafters.js)
  if (BLAZE.dirty.size) { for (const B of BLAZE.dirty) blazeUpload(B); BLAZE.dirty.clear(); }
}

// the castle shader's view of a burh's walk: zones of burning, charred, burnt-through, rebuilding and fresh cells
function blazeUpload(B) {
  const U3 = B.C.cutU;
  if (!U3 || !U3.uDA) return;
  const S = B.S;
  U3.uDS.value.set(S.x, S.z, Math.cos(S.yaw), Math.sin(S.yaw));
  U3.uDY.value.set(S.y + BURH_WALK, B.ring ? 1 : 0, S.y + BZ_RING.stump, 0);
  if (B.ring) { blazeRingUpload(B, U3); return; }
  const zones = [];
  let cur = null;
  const cls = (c) => (c.st === 3 ? (c.rb > 0 ? 'r' : 'g') : c.st === 1 || c.st === 2 || c.char > 0.02 ? 'b' : c.fresh > 0.02 ? 'f' : null);
  for (const c of B.cells) {
    const k = cls(c);
    if (!k) { cur = null; continue; }
    if (cur && cur.k === k && cur.di === c.di && cur.last.k + 1 === c.k && (k !== 'r' || Math.abs(cur.last.rb - c.rb) < 0.05)) { cur.cells.push(c); cur.last = c; continue; }
    cur = { k, di: c.di, cells: [c], last: c };
    zones.push(cur);
  }
  const pri = { g: 0, r: 0, b: 1, f: 2 };
  zones.sort((a, b) => pri[a.k] - pri[b.k]);
  for (let i = 0; i < DZ_MAX; i++) {
    const z = zones[i];
    if (!z) { U3.uDA.value[i].set(0, 0, 0, 0); U3.uDB.value[i].set(0, 0, 0, 0); continue; }
    const cs = z.cells, x0 = Math.min(...cs.map((c) => c.x0)), x1 = Math.max(...cs.map((c) => c.x1)), z0 = Math.min(...cs.map((c) => c.z0)), z1 = Math.max(...cs.map((c) => c.z1));
    const ch = Math.max(...cs.map((c) => c.char)), gl = Math.max(...cs.map((c) => (c.st === 1 ? c.heat : c.ember * 0.85))), fr = Math.max(...cs.map((c) => c.fresh));
    const cut = z.k === 'g' ? 1 : z.k === 'r' ? clamp(1 - smooth(cs[0].rb), 0, 1) : 0;
    U3.uDA.value[i].set(x0, z0, x1, z1);
    U3.uDB.value[i].set(clamp(ch, 0, 1), clamp(gl, 0, 1), clamp(fr, 0, 1), cut > 0 ? cut + (cs[0].alongX ? 0 : 2) : 0);
  }
}

// a hallow's ring: each segment that is not whole is a zone of its own (the burnt-through and rebuilding first)
function blazeRingUpload(B, U3) {
  const zs = B.cells.filter((c) => c.st !== 0 || c.char > 0.02 || c.fresh > 0.02).sort((a, b) => (b.st === 3) - (a.st === 3) || b.char - a.char);
  for (let i = 0; i < DZ_MAX; i++) {
    const c = zs[i];
    if (!c) { U3.uDA.value[i].set(0, 0, 0, 0); U3.uDB.value[i].set(0, 0, 0, 0); continue; }
    U3.uDA.value[i].set(c.am, (c.a1 - c.a0) / 2 + 0.004, BZ_RING.rIn, BZ_RING.rOut);
    U3.uDB.value[i].set(clamp(c.char, 0, 1), clamp(c.st === 1 ? c.heat : c.ember * 0.85, 0, 1), clamp(c.fresh, 0, 1), c.st === 3 ? clamp(1 - smooth(c.rb), 0.001, 1) : 0);
  }
}

/* ------------------------------------------------------------------ */
/* routes over a burnt-through walk                                    */
/* ------------------------------------------------------------------ */
// does the way from (ax, az) to (bx, bz) at height y cross a gap burnt in a walk? (cheap when no walk has one)
function blazeGapOn(ax, az, bx, bz, y) {
  if (!BLAZE.gaps) return false;
  for (const B of BLAZE.list) {
    if (Math.abs(y - (B.S.y + BURH_WALK)) > 1.0 || dist2(ax, az, B.S.x, B.S.z) > (KEEP_HS + 6) ** 2) continue;
    const n = Math.max(1, Math.ceil(dist(ax, az, bx, bz) / 0.5));
    for (const c of B.cells) {
      if (c.st !== 3 || c.f.active) continue;
      for (let k = 0; k <= n; k++) {
        const x = lerp(ax, bx, k / n), z = lerp(az, bz, k / n), l = siteLocal(B.S, x, z);
        if (l.x > c.x0 + 0.1 && l.x < c.x1 - 0.1 && l.z > c.z0 + 0.1 && l.z < c.z1 - 0.1) return true;
      }
    }
  }
  return false;
}
// a route (castleRouteWorld) any of whose legs on a walk crosses a gap
function blazeRouteCut(Rt) {
  if (!BLAZE.gaps || !Rt) return false;
  for (let i = 1; i < Rt.length; i++) if (Math.abs(Rt[i].y - Rt[i - 1].y) < 0.5 && blazeGapOn(Rt[i - 1].x, Rt[i - 1].z, Rt[i].x, Rt[i].z, Rt[i].y)) return true;
  return false;
}

/* ------------------------------------------------------------------ */
/* the garrison fights fire                                            */
/* ------------------------------------------------------------------ */
// what burns at a keep or a temple now: palisade stretches, wall walk boards, its gate, its towers. Each fire is where
// it burns, where a body stands to beat it (on its own floor), and how to beat it down
function blazeFiresOf(C) {
  const out = [];
  const S = C.S;
  if (C.pal) for (const c of C.pal.cells) if (c.st === 1) {
    const l = palisadeLocal(c.side, c.a, -1.35), p = siteToWorld(S, l.x, l.z);
    out.push({ key: c, kind: 'pal', x: c.x, y: S.y + 2, z: c.z, sx: p.x, sy: S.y, sz: p.z, heat: c.heat, beat: (k) => { c.heat = Math.max(0, c.heat - k); } });
  }
  if (C.blaze && C.blaze.ring) for (const c of C.blaze.cells) if (c.st === 1) {
    // a hallow's log wall: beaten from the ground inside it
    const p = siteToWorld(S, Math.sin(c.am) * (BZ_RING.R0 - 1.6), Math.cos(c.am) * (BZ_RING.R0 - 1.6));
    out.push({ key: c, kind: 'ring', x: c.x, y: S.y + 1.5, z: c.z, sx: p.x, sy: S.y, sz: p.z, heat: c.heat, beat: (k) => { c.heat = Math.max(0, c.heat - k); } });
  }
  if (C.blaze && !C.blaze.ring) for (const c of C.blaze.cells) if (c.st === 1) {
    // beaten from the boards beside it (the nearest neighbour that still carries a body), else from below
    let st = null, bd = Infinity;
    for (const o of c.nb) if (o.f.active && o.st !== 1) { const d = dist2(o.x, o.z, c.x, c.z); if (d < bd) { bd = d; st = o; } }
    out.push({ key: c, kind: 'deck', cell: st || c, x: c.x, y: c.y, z: c.z, sx: st ? st.x : c.x, sy: st ? st.y : c.y, sz: st ? st.z : c.z, heat: c.heat, beat: (k) => { c.heat = Math.max(0, c.heat - k); } });
  }
  const G0 = C.gate;
  if (G0 && G0.bz && G0.bz.burn && blazeGateDoor(G0)) {
    const Z = G0.bz, p = siteToWorld(S, 0.6, G0.gz - 1.5), D = blazeGateDoor(G0);
    out.push({ key: G0, kind: 'gate', x: D.x, y: S.y + 1.5, z: D.z, sx: p.x, sy: S.y, sz: p.z, heat: Z.burn.heat, beat: (k) => { Z.burn.heat = Math.max(0, Z.burn.heat - k); } });
  }
  for (const T of TOWER.list) {
    if (T.C !== C || !T.burn) continue;
    // a burning tower is fought from its foot inside the court (buckets thrown up, wet hides on poles): at half the pace
    const dx = S.x - T.wx, dz = S.z - T.wz, d = Math.hypot(dx, dz) || 1, r = (T.HO || T.RO) + 1.0;
    out.push({ key: T, kind: 'tower', x: T.wx, y: S.y + 3, z: T.wz, sx: T.wx + dx / d * r, sy: S.y, sz: T.wz + dz / d * r, heat: T.burn.heat, half: true, beat: (k) => { T.burn.heat = Math.max(0, T.burn.heat - k * 0.5); } });
  }
  return out;
}
// once a second a keep's people see what burns on their walls and send the nearest who are free to it (two a fire,
// four at most): they leave their posts and their watch for it, unless a foe is on them
function blazeCrews(dt) {
  if (GAME.t < (BLAZE.crewT || 0)) return;
  BLAZE.crewT = GAME.t + 1;
  for (const K of [...WAR.keeps, ...WAR.temples]) {
    const C = castleOf(K.site);
    if (!C) continue;
    const fires = blazeFiresOf(C);
    if (!fires.length) continue;
    const gs = [...(K.guards || K.guardians)].map(getEnt).filter((g) => g && g.alive);
    const busy = gs.filter((g) => g.ai.fire && fires.some((f) => f.key === g.ai.fire.key));
    for (const g of gs) if (g.ai.fire && !fires.some((f) => f.key === g.ai.fire.key)) g.ai.fire = null; // out
    let n = busy.length;
    for (const f of fires.sort((a, b) => b.heat - a.heat)) {
      if (n >= BZ_T.crewMax) break;
      let have = busy.filter((g) => g.ai.fire.key === f.key).length;
      while (have < BZ_T.crew && n < BZ_T.crewMax) {
        let best = null, bd = Infinity;
        for (const g of gs) {
          if (g.ai.fire || g.ai.plug || g.ai.sally || g.ai.route || onLadder(g) || g.motion || g.fixedY !== null) continue;
          if (g.ai.fireBan && g.ai.fireBan.get(f.key) > GAME.t) continue;
          const t = getEnt(g.target);
          if (t && t.alive && dist2(t.x, t.z, g.x, g.z) < 10 * 10) continue; // in a fight
          // the wall archers come only to a fire on their own floor close by (they keep their watch otherwise)
          if (g.ai.wall && (Math.abs(g.y - f.sy) > 1.5 || dist2(g.x, g.z, f.sx, f.sz) > 16 * 16)) continue;
          const d = dist(g.x, g.z, f.sx, f.sz) + 3 * Math.abs(g.y - f.sy);
          if (d < bd) { bd = d; best = g; }
        }
        if (!best) break;
        best.ai.fire = { key: f.key, kind: f.kind, best: Infinity, bestT: GAME.t, since: GAME.t };
        busy.push(best); have++; n++;
        BLAZE.stats.crews++;
      }
    }
  }
}
// a firefighter's step (thinkPosted): true while the fire has the body
function blazeFightStep(e, dt) {
  const J = e.ai.fire, K = e.keep || e.temple, C = K && castleOf(K.site);
  if (!C) { e.ai.fire = null; return false; }
  const f = blazeFiresOf(C).find((q) => q.key === J.key);
  if (!f) { e.ai.fire = null; if (e.anim.act === 21) e.anim.actT = e.anim.actDur; return false; }
  // a foe on it comes first
  if (GAME.t > (J.scan || 0)) {
    J.scan = GAME.t + 0.5;
    const t = topThreat(e);
    if (t && dist2(t.x, t.z, e.x, e.z) < 7 * 7 && Math.abs(t.y - e.y) < 2.5) { e.ai.fire = null; return false; }
  }
  e.target = null;
  const d = dist(e.x, e.z, f.sx, f.sz), dy = Math.abs(e.y - f.sy);
  if ((d < 1.4 || (f.kind === 'deck' && dist(e.x, e.z, f.x, f.z) < 2.3)) && dy < 1.2) {
    // at the flames: beat them with a wet hide, again and again (body action 21)
    turnToward(e, f.x, f.z, dt * 8);
    if (e.anim.act !== 21 || e.anim.actT >= e.anim.actDur * 0.95) setAct(e, 21, 1.1);
    if (f.kind !== 'pal') f.beat(BZ_T.beat * dt); // (a palisade's own step counts the keep's people beside it: PAL_T.douse)
    BLAZE.stats.beats += dt;
    J.bestT = GAME.t;
    return true;
  }
  if (d + dy < J.best - 0.3) { J.best = d + dy; J.bestT = GAME.t; }
  if (GAME.t - J.bestT > 12 || GAME.t - J.since > 90) {
    // no nearer (a gap in the walk, a locked way up): it gives this fire up and goes back to its post
    (e.ai.fireBan || (e.ai.fireBan = new Map())).set(J.key, GAME.t + 30);
    e.ai.fire = null; BLAZE.stats.gaveUp++;
    return false;
  }
  // up or down to the fire's floor by the castle's ways, then to it
  if (dy > 1.1) {
    const wp = castleWaypoint(e, { x: f.sx, y: f.sy, z: f.sz });
    if (wp) {
      if (wp.ladder && wp.ladder.gone) { J.bestT -= dt * 3; return true; }
      if (wp.ladder && towerLadderStart(e, wp.ladder, wp.y > e.y + 1 ? 1 : wp.y < e.y - 1 ? -1 : 0)) return true;
      if (wp.ladder && Math.abs(wp.y - e.y) > 1) { const L = wp.ladder, up = wp.y > e.y; moveToward(e, up ? L.fx : L.ox, up ? L.fz : L.oz, dt, 1.1, 0.05); return true; }
      moveToward(e, wp.x, wp.z, dt, 1.15, 0.05);
      return true;
    }
  }
  // up on the walk: along its boards from cell to cell (straight across, the way may run down a stair)
  if (f.kind === 'deck' && C.blaze) {
    const here = deckCellUnder(C.blaze, e);
    if (here && here !== f.cell) { const nx = deckNextToward(here, f.cell); if (nx) { moveToward(e, nx.x, nx.z, dt, 1.1, 0.2); return true; } }
  }
  moveToward(e, f.sx, f.sz, dt, 1.15, 0.6);
  return true;
}
// the walk's cell a body stands on, and the next cell on the way along the walk to another (through cells that carry)
function deckCellUnder(B, e) { for (const c of B.cells) if (c.f.active && deckOn(c, e, 0.1)) return c; return null; }
function deckNextToward(a, b) {
  if (a === b) return b;
  const prev = new Map([[a, null]]), q = [a];
  for (let i = 0; i < q.length; i++) {
    const c = q[i];
    if (c === b) break;
    for (const o of c.nb) if (!prev.has(o) && o.f.active && (o.st !== 1 || o === b)) { prev.set(o, c); q.push(o); }
  }
  if (!prev.has(b)) return null;
  let c = b;
  while (prev.get(c) && prev.get(c) !== a) c = prev.get(c);
  return c;
}

/* ------------------------------------------------------------------ */
/* the player: Use by the flames, and a brand to the timber            */
/* ------------------------------------------------------------------ */
function blazeOffers(P, offer) {
  if (!BLAZE.ready || P.motion || inDungeon(P)) return;
  const C = castleAt(P.x, P.z) || CASTLES.find((q) => q.kind === 'temple' && dist2(P.x, P.z, q.S.x, q.S.z) < 26 * 26);
  if (!C) return;
  // beat out the flames on a wall, a walk, a gate or a tower (anyone's: a fire is a fire)
  let best = null, bd = Infinity;
  for (const f of blazeFiresOf(C)) {
    const dy = Math.abs(P.y + 1 - f.y), d = f.kind === 'tower' ? dist(P.x, P.z, f.sx, f.sz) : dist(P.x, P.z, f.x, f.z) - (f.kind === 'deck' ? 0.9 : f.kind === 'gate' ? 1.6 : 0.8);
    if (dy > 2.4 || d > 2.2) continue;
    if (d < bd) { bd = d; best = f; }
  }
  if (best) { const f = best; offer(Math.max(0.05, bd), 2.4, 'Beat out the flames', () => blazePlayerBeat(P, f), 0.2); }
  if (!P.brand) return;
  const c = deckCellAt(P.x, P.y + 1.2, P.z, 1.0);
  if (c && (c.st === 0 || c.st === 2)) offer(0.3, 1.8, c.ring ? 'Set the log wall alight' : 'Set the wall walk alight', () => { deckIgnite(c); }, 0.12);
  const G0 = C.gate;
  if (G0 && G0.bz && !G0.bz.burn && blazeGateDoor(G0) && G0.door.alive) {
    const l = siteLocal(C.S, P.x, P.z);
    if (Math.abs(l.x) < G0.hw + 0.6 && Math.abs(l.z - G0.gz) < 2.0) offer(Math.abs(l.z - G0.gz), 2.2, 'Set the gate alight', () => { if (!gateIgnite(G0)) uiError('The gate will not take'); else G0.bz.by = P.id; }, 0.12);
  }
}
function blazePlayerBeat(P, f) {
  setAct(P, 21, 1.1);
  faceToward(P, f.x, f.z);
  f.beat(BZ_T.beatP * (f.half ? 2 : 1)); // (a tower's beat halves it again)
  BLAZE.stats.playerBeats++;
  if (fxAlpha) for (let i = 0; i < 4; i++) fxAlpha.emit(f.x + (Math.random() - 0.5), f.y + Math.random(), f.z + (Math.random() - 0.5), (Math.random() - 0.5) * 0.6, 1 + Math.random(), (Math.random() - 0.5) * 0.6, 3.5, 0.3, 0.29, 0.28, -0.6, -0.2, 0.4);
  sfx('hiss');
}

/* ------------------------------------------------------------------ */
/* what a player is told                                               */
/* ------------------------------------------------------------------ */
queueMicrotask(() => {
  if (typeof FIELD_NOTES !== 'undefined' && typeof GUIDE_WATCH !== 'undefined') {
    Object.assign(FIELD_NOTES, { firewall: { t: 'Fire on the walls', x: () => `Timber walls, wall walks and gates burn. ${IS_TOUCH ? 'Tap Use' : 'Press E'} beside the flames to beat them out; the garrison runs to a fire and leaves its watch while it fights it. A walk that burns through drops whoever stands on it.`, fight: true } });
    GUIDE_WATCH.firewall = (P, ctx) => /^Beat out the flames/.test(ctx.prompt);
  }
  if (typeof CHRON_EXTRA !== 'undefined') CHRON_EXTRA.sieges.push(() => `<h3>Fire on the walls</h3><p>Everything of timber in a keep burns as it is built: a burh's palisade, the boards of its wall walks, its gate of planks and its towers of logs, and the gate of the timber hallow. A fire spell, a burning arrow, a brand held to the timber or the dragon's breath sets it alight (never the fire of the keep's own realm), and a fire spreads along the wall and the walk. A walk that burns through drops whoever stands on it and leaves a gap no one crosses; a gate that burns through falls, and everyone may pass. Rain damps a fire and puts out a young one.</p><p>The keep's people see a fire on their walls and run to beat it out, two to a fire, leaving their posts and their watch: a fire set by a band draws the garrison away from the gate. ${IS_TOUCH ? 'Tap Use' : 'Press E'} beside the flames to beat them out yourself. In peace the keep builds back what burnt.</p>`);
  if (typeof LOADING_TIPS !== 'undefined') LOADING_TIPS.push('A burh\'s wall walks and gates are timber: set them alight and the garrison leaves its posts to fight the fire.', 'Beat out flames on a wall or a gate with Use beside them.');
});

// save part world.x.blaze: the walks' cells that burn, stand charred, lie burnt through or are being built back, and
// the gates that burn
queueMicrotask(() => registerSavePart('world', 'blaze', {
  save() {
    if (!BLAZE.ready) return undefined;
    const out = [];
    BLAZE.list.forEach((B, bi) => B.cells.forEach((c, ci) => {
      if (c.st === 0 && c.fresh <= 0.02) return;
      out.push([bi, ci, c.st, Math.round(c.char * 100), Math.round((c.st === 1 ? c.t : c.st === 3 ? c.rb : c.fresh) * 100)]);
    }));
    BLAZE.gates.forEach((G0, gi) => { if (G0.bz.burn) out.push([-1, gi, 1, Math.round(G0.bz.char * 100), Math.round(G0.bz.burn.t * 100)]); });
    return out.length ? out : undefined;
  },
  load(d) {
    if (!Array.isArray(d)) return;
    blazeInit();
    for (const q of d.slice(0, 300)) {
      if (!Array.isArray(q)) continue;
      const st = q[2] | 0, v = +q[4] / 100, ch = clamp(+q[3] / 100 || 0, 0, 1);
      if (!isFinite(v)) continue;
      if (q[0] === -1) { const G0 = BLAZE.gates[q[1] | 0]; if (G0 && gateIgnite(G0, 0.3)) { G0.bz.burn.t = clamp(v, 0, BZ_T.gate - 1); G0.bz.char = ch; } continue; }
      const B = BLAZE.list[q[0] | 0], c = B && B.cells[q[1] | 0];
      if (!c || st < 0 || st > 3) continue;
      c.char = ch;
      if (st === 0) c.fresh = clamp(v, 0, 1);
      else if (st === 1) { deckIgnite(c, 0.3); c.t = clamp(v, 0, BZ_T.burn - 1); c.heat = clamp(c.t / BZ_T.climb, 0.15, 1); }
      else if (st === 2) c.st = 2;
      else { deckThrough(c, true); c.rb = clamp(v, 0, 0.99); c.ember = 0; if (c.rb > 0.15 && c.wreck) c.wreck.visible = false; }
      BLAZE.dirty.add(B);
    }
    for (const B of BLAZE.list) blazeUpload(B);
  },
  key(d) { return d ? d.map((q) => q[0] * 1000 + q[1] * 10 + q[2]).join(',') : ''; },
}));
queueMicrotask(() => { if (window.__hm) window.__hm.blaze = { BLAZE, BZ_T, blazeInit, deckCellAt, deckFireAt, deckFireCone, deckIgnite, deckThrough, deckMended, gateFireAt, gateIgnite, gateFalls, updateBlaze, blazeUpload, blazeFiresOf, blazeCrews, blazeFightStep, blazeOffers, blazeGapOn, blazeRouteCut, blazePlayerBeat }; });
