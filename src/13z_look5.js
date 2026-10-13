/* ================================================================== */
/* [look5] the world looked at again (version 17)                      */
/* ================================================================== */
// What version 16 added, looked at as a player meets it (tools/tests/look_views.js, the `look5` group; look5.py), and
// what the looks before left: each fault put right at its cause. Small changes where a fault was carry [look5] marks in
// their own modules; what is new code is here.

// ---- camps: nobody set down inside what a camp stands round ----
// A camp's bodies were set down anywhere within its reach (spawnMob, 08_ai.js), its champion within 0.4 of it and most
// often near its middle, where its fire pit is (05d_fire.js buildFireProps: a collider of 0.9 m, a troll's 1.3): a body
// set down in a collider never steps out of it (stepTo resolves a move, not a stand), and a risen champion stood in the
// flames of its camp's fire. True when a body of radius r at (x, z) would stand in something solid (a fire pit, a tent,
// a log, a rack, a rock, a wall: not a tree or a bush, which a body stands beside)
function look5InColl(x, z, r) {
  const out = look5InColl.out || (look5InColl.out = []);
  collidersNear(x, z, r + 4, out);
  for (const c of out) {
    if (c.active === false || c.hollow || c.tag === 'tree' || c.tag === 'bush' || c.tag === 'plant' || c.vert) continue;
    if (c.type === 'circle') { if ((x - c.x) ** 2 + (z - c.z) ** 2 < (c.r + r) ** 2) return true; continue; }
    const dx = x - c.x, dz = z - c.z, lx = dx * c.cos - dz * c.sin, lz = dx * c.sin + dz * c.cos;
    if (Math.abs(lx) < c.hx + r && Math.abs(lz) < c.hz + r) return true;
  }
  return false;
}

// ---- wisps in their own colours ----
// Every wisp was drawn in one teal (13_main.js, two glows and a trail of fixed colours), whatever its look said: the late
// wisps' palettes (06_data.js MOB_LATE: a pale grave light, a storm wisp's blue, a ghost-fire's green, the wisp-mother's
// violet) and a risen champion's ember red (10l_late.js late2OnSpawn) were never seen. The core is the look's own
// colour, the halo a paler wash of it, the trail between (kept on the body: nothing is made a frame)
function look5WispCol(e) {
  const A = (e.look && e.look.colA) || null;
  if (e._l5wc && e._l5wc.src === A) return e._l5wc;
  const a = A || [0.55, 1.6, 1.35];
  const m = Math.max(a[0], a[1], a[2], 0.01);
  // the core at the strength the teal had (its brightest channel 1.6), the halo a pale wash (2.2 to 2.4 before)
  const k = 1.6 / m, c = [a[0] * k, a[1] * k, a[2] * k];
  const out = [c[0], c[1], c[2], 1.55 + 0.6 * c[0] / 1.6, 1.55 + 0.6 * c[1] / 1.6, 1.55 + 0.6 * c[2] / 1.6];
  out.tr = [c[0] * 0.92, c[1] * 0.92, c[2] * 0.92];
  out.src = A;
  e._l5wc = out;
  return out;
}

// ---- holy ground's light in the grass (02f_look5.js; the grass's shader, 03_terrain.js) ----
// the realm's light, as the disc's own (07b_classes.js consecrate)
const LOOK5_HALLOW_COL = { 0: [1.9, 1.6, 0.9], 1: [1.2, 1.9, 1.0], 2: [2.2, 1.3, 0.6] };
const LOOK5 = { hallowN: 0, masonLoad: [], stats: { upPlans: 0, climbed: 0, boardBlows: 0, masonsAgain: 0, masonsLoaded: 0 } };
function look5Frame(dt) {
  void dt;
  const G = typeof CLS !== 'undefined' && CLS.grounds ? CLS.grounds : null;
  let n = 0;
  if (G && G.length && !INDOOR.on) {
    const cx = camera.position.x, cz = camera.position.z, near = look5Frame.near || (look5Frame.near = []);
    near.length = 0;
    for (const g of G) if (GAME.t < g.until && dist2(g.x, g.z, cx, cz) < 95 * 95) near.push(g);
    if (near.length > 4) near.sort((a, b) => dist2(a.x, a.z, cx, cz) - dist2(b.x, b.z, cx, cz));
    for (const g of near) {
      if (n >= 4) break;
      const age = GAME.t - g.t0, dur = g.until - g.t0, k = sstep(0, 0.35, age) * (1 - sstep(dur - 0.8, dur, age));
      if (k <= 0.01) continue;
      const c = LOOK5_HALLOW_COL[g.realm] || LOOK5_HALLOW_COL[0];
      U.uHallow.value[n].set(g.x, g.z, g.r, k);
      U.uHallowC.value[n].set(c[0], c[1], c[2], 0);
      n++;
    }
  }
  U.uHallowN.value = n;
  LOOK5.hallowN = n;
}

// ---- a house's scaffold rising with the work, and a builder up on its boards ----
// A house built back behind its scaffold (04j_rubble.js) had its lift of boards up from the first stone, and its people
// hammered at one spot each at the foot of one wall (08f_townlife.js houseWorkPlan): the boards above went unused. Now
// the standards stand from the start and each lift goes up once the walls have risen to within a little of it (for a
// house that burnt, whose walls stood, at once: look5HouseLifts, asked by houseScafSync); each stint at the foot is at
// the next place along its own side of the house (houseScafWorkSpot's k), and once the walls stand high enough for a
// mallet swung from the boards to meet them, one of its people at a time climbs the ladder, walks along the boards to a
// place at the wall, hammers there a while and climbs down again, the next stint the other's (look5ScafUpPlan, the step
// 'scaf': look5ScafStep).
const LOOK5_LIFT_AHEAD = 0.45, LOOK5_UP_AT = 1.1; // a lift goes up with the walls this far under it; a builder goes up once they stand this far over it
function look5HouseLifts(H, Q) {
  const L = (Q && Q.lifts) || houseScafLifts(H);
  if (!look4Fell(H)) return L.length; // (the walls stood through the fire: the lifts at once, for the roof)
  const lv = houseRubbleLevel(H);
  if (lv > 1e3) return L.length;
  let n = 0;
  for (const y of L) if (lv >= y - LOOK5_LIFT_AHEAD) n++;
  return n;
}
function look5ScafUpPlan(e, H) {
  const Q = HSCAF.list.get(H);
  if (!Q || !Q.l3 || !Q.l3.on || !(Q.l4n >= 1) || H.state !== 'scaffold') return null;
  if (look4Fell(H)) { const lv = houseRubbleLevel(H); if (lv < Q.lifts[0] + LOOK5_UP_AT) return null; } // (nothing to strike from up there yet)
  const L = Q.l3.ladders.find((q) => q.k === 0 && !q.gone);
  if (!L) return null;
  const up = H._l5up;
  if (up && GAME.t < up.until && up.id !== e.id) return null; // one at a time
  if ((!up || GAME.t >= up.until) && H._l5last === e.id && GAME.t < (H._l5lastT || 0) + 40) return null; // the next stint up is another's (or this one's again after a while, alone)
  H._l5up = { id: e.id, until: GAME.t + 75 };
  LOOK5.stats.upPlans++;
  return [houseGo(L.fx, L.fz, { T: 24 }), lifeStep('scaf', { H, L, dur: 16 + Math.random() * 10 })];
}
// a place on the boards of the lift at the wall (the boards' middle line: a mallet's reach from the wall), a few bays
// along from the ladder, and the way to the wall from there
function look5BoardSpot(H, Q, L) {
  const fl = Q.l3.floors.filter((f) => f.active && (f.k ?? 0) === (L.k ?? 0));
  if (!fl.length) return null;
  fl.sort((a, b) => dist2(a.x, a.z, L.ox, L.oz) - dist2(b.x, b.z, L.ox, L.oz));
  const f = fl[Math.min(fl.length - 1, 1 + Math.floor(Math.random() * Math.min(3, fl.length - 1)))];
  const at = (lx, lz) => ({ x: f.x + lx * f.cos + lz * f.sin, z: f.z - lx * f.sin + lz * f.cos });
  const lx = (Math.random() - 0.5) * Math.max(0, 2 * f.hx - 0.7), a = at(lx, f.hz), b = at(lx, -f.hz), p = at(lx, 0);
  const inA = dist2(a.x, a.z, H.x, H.z) < dist2(b.x, b.z, H.x, H.z), w = inA ? a : b, o = inA ? b : a; // (the edge nearer the house's middle is the wall's)
  const fx = w.x - o.x, fz = w.z - o.z, l = Math.hypot(fx, fz) || 1;
  return { x: p.x, z: p.z, y: f.ya, fx: fx / l, fz: fz / l };
}
function look5ScafStep(e, st, plan, dt, next) {
  const H = st.H, Q = HSCAF.list.get(H), L = st.L;
  const end = () => { if (H._l5up && H._l5up.id === e.id) { H._l5up = null; H._l5last = e.id; H._l5lastT = GAME.t; } next(); };
  if (e.motion) return true; // on the rungs (updateMotion carries it)
  const quit = H.state !== 'scaffold' || !Q || !Q.l3 || !Q.l3.on || L.gone, onBoards = e.y > L.wyb + 1;
  if (H._l5up && H._l5up.id === e.id) H._l5up.until = GAME.t + 30;
  if (!st.ph) st.ph = 'foot';
  if (st.ph === 'foot') {
    if (quit || onBoards) { end(); return true; }
    if (moveToward(e, L.fx, L.fz, dt, 0.8, 0.15)) { if (towerClimb(e, L, 1)) { st.ph = 'up'; LOOK5.stats.climbed++; sfxAtE('creak', e, null, 0.3); } else end(); }
    else if (plan.t > 14) end();
    return true;
  }
  if (!onBoards) { end(); return true; } // (down again, or never up)
  if (st.ph === 'up') {
    st.spot = st.spot || look5BoardSpot(H, Q, L);
    if (!st.spot || quit) { st.ph = 'back'; return true; }
    st.walkT = (st.walkT || 0) + dt;
    if (moveToward(e, st.spot.x, st.spot.z, dt, 0.7, 0.12) || st.walkT > 9) { st.ph = 'work'; st.t0 = plan.t; st.next = plan.t + 0.4; }
    return true;
  }
  if (st.ph === 'work') {
    if (quit || plan.t - st.t0 > st.dur) { st.ph = 'back'; return true; }
    turnToward(e, e.x + st.spot.fx, e.z + st.spot.fz, dt * 4);
    e._hamUntil = GAME.t + 0.4; // a mallet in the hand (13_main.js), the blow a hammer's onto the wall (action 23)
    if (plan.t >= st.next) {
      st.next = plan.t + 1.05 + Math.random() * 0.4;
      setAct(e, 23, 1.05); LOOK5.stats.boardBlows++;
      st.n = (st.n || 0) + 1;
      later(0.68, () => { if (e.alive) { sfxAtE('mallet', e, null, 1.3); if (st.n % 2 === 0) sfxAtE('creak', e, { at: 0.3 }, 0.05); } }); // [audio2] as the mallet meets the wall, on creaking boards
    }
    return true;
  }
  if (st.ph === 'back') {
    st.backT = (st.backT || 0) + dt;
    if (moveToward(e, L.ox, L.oz, dt, 0.7, 0.12) || st.backT > 10) { towerClimb(e, L, -1); st.ph = 'down'; }
    return true;
  }
  return true;
}

// ---- the masons in a war, and saved with the world ----
// The masons (13v_look3.js) came out of the hall once for each scaffold: gone home from a foe near the keep (or a blow),
// they never came again while it stood, so in a running war, where a foe comes by every few minutes, a breach was built
// back by nobody after the first alarm; and nothing of them was saved (after a load they walked out from the hall
// again). Now once all of a scaffold's masons are home it may call them out again (look3Masons' own rule: the keep
// quiet 25 s, the work not near its end), and the masons at work are saved (save part world.x.masons: the castle, the
// section or the gap, whether one was up on the boards) and come back at their work after a load, as soon as its
// scaffold stands (laid out when first seen: look3Scaffolds).
function look5MasonsAgain(C, W) {
  const P = LOOK5.masonLoad;
  if (P && P.length) {
    for (let i = P.length - 1; i >= 0; i--) {
      const q = P[i];
      if (GAME.t > q.until) { P.splice(i, 1); continue; }
      if (CASTLES[q.ci] !== C) continue;
      const Wq = q.si >= 0 ? C.sections && C.sections[q.si] : C.pal && C.pal.gaps[q.gi];
      if (Wq !== W) continue;
      P.splice(i, 1);
      if (look5MasonsInPlace(C, W, q.up)) return true;
    }
  }
  if (W.masonsFor && W.masonsFor.length && W.masonsFor.every((id) => { const e = getEnt(id); return !e || !e.alive || e.removed; })) { W.masonsFor = null; LOOK5.stats.masonsAgain++; }
  return false;
}
// a save's masons at their work: the one at the scaffold's foot, the other up on the first lift's boards by its ladder
// (or at its foot, about to climb, if it had not)
function look5MasonsInPlace(C, W, up) {
  const S = C.S, H = HALL.list.find((q) => q.S === S), L = W.l3 && W.l3.ladders.filter((q) => q.k === 0).sort((a, b) => dist2(b.fx, b.fz, S.x, S.z) - dist2(a.fx, a.fz, S.x, S.z))[0];
  if (!H || !L || !houseIntact(H) || !W.l3.on) return false;
  const ms = [0, 1].map((i) => look3MasonSpawn(C, W, H, L, i)).filter(Boolean);
  for (const e of ms) {
    const m = e.ai.mason;
    if (!m.up) { e.x = e.prevX = m.foot.x; e.z = e.prevZ = m.foot.z; e.y = floorAt(e.x, e.z, heightAt(e.x, e.z) + 0.3); m.st = 'work'; }
    else if (up && !L.gone) { e.x = e.prevX = L.ox; e.z = e.prevZ = L.oz; e.y = L.wyt; m.st = 'up'; MASON.stats.climbed++; }
    else { e.x = e.prevX = L.fx; e.z = e.prevZ = L.fz; e.y = floorAt(e.x, e.z, heightAt(e.x, e.z) + 0.3); m.path = []; }
    e.prevY = e.y;
  }
  W.masonsFor = ms.map((e) => e.id);
  LOOK5.stats.masonsLoaded += ms.length;
  return true;
}
registerSavePart('world', 'masons', {
  save() {
    const out = [];
    CASTLES.forEach((C, ci) => {
      const one = (W, si, gi) => {
        const ms = (W.masonsFor || []).map(getEnt).filter((e) => e && e.alive && !e.removed && e.ai.mason && e.ai.mason.st !== 'home');
        if (ms.length) out.push([ci, si, gi, ms.some((e) => e.ai.mason.up && e.y > e.ai.mason.L.wyb + 1) ? 1 : 0]);
      };
      (C.sections || []).forEach((W, si) => one(W, si, -1));
      if (C.pal) C.pal.gaps.forEach((W, gi) => one(W, -1, gi));
    });
    return out.length ? out : undefined;
  },
  load(d) {
    LOOK5.masonLoad = [];
    if (!Array.isArray(d)) return;
    for (const q of d.slice(0, 24)) {
      if (!Array.isArray(q) || q.length < 4) continue;
      const ci = q[0] | 0, si = q[1] | 0, gi = q[2] | 0;
      if (ci < 0 || ci >= CASTLES.length || (si < 0 && gi < 0)) continue;
      LOOK5.masonLoad.push({ ci, si, gi, up: !!q[3], until: GAME.t + 90 });
    }
  },
  key(d) { return d ? d.map((q) => q.join(':')).join(',') : ''; },
});

// ---- the phone's long pages ----
// How to play (the menu's tab: guideHelpHTML, 10e_guide.js) was about two screens on an upright phone: every control of
// the pad open, then a heading for each of the March's systems. On a phone now: the four controls a new player needs
// first (the stick, the look, the abilities, Use) and What to do, open; every other control under one heading, and the
// March's systems under another (each still folded under its own heading inside it). A desk keeps the page as it was.
const look5PhoneHelp = () => IS_TOUCH || innerWidth <= 760;
function look5HelpHTML() {
  const rows = guideKeysHTML().match(/<kbd>[\s\S]*?<\/kbd><span>[\s\S]*?<\/span>/g) || [];
  const first = rows.slice(0, 4).join(''), rest = rows.slice(4).join('');
  let sys = '';
  GUIDE_HELP.slice(1).forEach((f) => { try { sys += guideFold(f(), false); } catch (e) { reportError(e); } });
  let what = '';
  try { what = GUIDE_HELP[0] ? guideFold(GUIDE_HELP[0](), true) : ''; } catch (e) { reportError(e); }
  return `<div class="keys">${first}</div>${what}
    <details class="gd-help l5-group"><summary>All the controls</summary><div><div class="keys">${rest}</div></div></details>
    <details class="gd-help l5-group"><summary>Every part of the March</summary><div class="l5-sys">${sys}</div></details>`;
}
// the page as a desk shows it (and a phone did): every control, then each system under its own heading (the tests)
function look5DeskHelpHTML() { let s = guideKeysHTML(); GUIDE_HELP.forEach((f, i) => { try { s += guideFold(f(), i === 0); } catch (e) { reportError(e); } }); return s; }
// a drawing folded on a phone (10f_guide2.js chronFold): its title
const LOOK5_FIG = { war: 'How a hallow changes hands, drawn' };
const look5FigTitle = (sec) => LOOK5_FIG[sec] || 'The drawing';
// a returning character told of the folding and of the notes' own page (version 15 gave them; a character made before
// was told nothing: How to play's first block says it to whoever opens it): once, to any character that has been given
// a few field notes
Object.assign(FIELD_NOTES, {
  l5fold: { t: 'The Chronicle folds', x: () => `On a small screen a long page of the Chronicle folds to its headings: ${IS_TOUCH ? 'tap' : 'click'} one to open it, or Open all. Every field note you have been given is kept on its own page, Field notes, the newest first.` },
});
GUIDE_WATCH.l5fold = () => { const p = GAME.prog; return !!(p && p.lore && p.lore.seen.filter((id) => FIELD_NOTES[id]).length >= 4); };

// ---- the map's warband names laid out ----
// Each of your bands' names was written under its mark (drawCampaignMap, 08g_campaign.js): two bands at one place (a
// muster, a keep's gate, a band following another) wrote their names over each other. Laid out once a map's drawing,
// for both its readers (the site names keep clear of them, 13w_look4.js; the campaign's map draws them there): each at
// the first of its places (under its mark, a line lower, to its right, to its left, over its badge, lower again) clear
// of every band's mark and badge and of the names placed before it; with none clear, under its mark as before
function look5BandNames(ctx, S, P) {
  const C = look5BandNames.c || (look5BandNames.c = { key: '', m: new Map() });
  const key = S + ':' + renderTime + ':' + WAR.warbands.length;
  if (C.key === key) return C.m;
  C.key = key; C.m.clear();
  if (typeof WB_ORD === 'undefined' || !P) return C.m;
  const cw = ($('mapcanvas') && $('mapcanvas').clientWidth) || S, u = S / Math.max(1, cw), sc = u * 2.2, fs = 11 * u;
  const over = (a, b) => a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1];
  const boxes = [], mine = [];
  for (const wb of WAR.warbands) {
    const L = !wb.dead && wbLeader(wb);
    if (!L || !cwSpotted(wb, P)) continue;
    const [x, y] = w2m(L.x, L.z, S);
    const mb = [x - sc * 4.2, y - sc * 9.2, x + sc * 4.2, y + sc * 1.2]; // (its badge over it and the leader's place: the line under it is a name's)
    boxes.push(mb);
    if (wb.realm === P.faction) mine.push({ wb, x, y, mb });
  }
  if (!mine.length) return C.m;
  const f0 = ctx.font;
  ctx.font = `700 ${fs}px "Alegreya Sans", sans-serif`;
  mine.sort((a, b) => a.wb.id - b.wb.id); // (the same order every draw: the names do not swap places)
  for (const q of mine) {
    const w = ctx.measureText(WB_ORD[wbOrd(q.wb) - 1] || '').width, { x, y } = q;
    const cands = [[x, y + sc * 5.6], [x, y + sc * 5.6 + fs * 1.15], [x + sc * 4.6 + w / 2 + 2, y - sc * 1.2], [x - sc * 4.6 - w / 2 - 2, y - sc * 1.2],
      [x, y - sc * 9.6 - fs * 0.15], [x, y + sc * 5.6 + fs * 2.3], [x + sc * 4.6 + w / 2 + 2, y - sc * 1.2 + fs * 1.15], [x - sc * 4.6 - w / 2 - 2, y - sc * 1.2 + fs * 1.15]];
    let pick = null;
    for (const [cx, cy] of cands) {
      const b = [cx - w / 2 - 2, cy - fs * 0.85, cx + w / 2 + 2, cy + fs * 0.25];
      if (b[0] < 2 || b[2] > S - 2 || b[1] < 2 || b[3] > S - 2) continue;
      if (!boxes.some((o) => o !== q.mb && over(o, b))) { pick = [cx, cy, b]; break; } // (its own mark: the name has always stood just under it)
    }
    if (!pick) pick = [x, y + sc * 5.6, [x - w / 2 - 2, y + sc * 5.6 - fs * 0.85, x + w / 2 + 2, y + sc * 5.6 + fs * 0.25]];
    boxes.push(pick[2]);
    C.m.set(q.wb, [pick[0], pick[1]]);
  }
  ctx.font = f0;
  return C.m;
}

queueMicrotask(() => { if (window.__hm && window.__hm.hud) Object.assign(window.__hm.hud, { HUDL5, hudHeld, hudWatch, HUD_HOLD }); });
queueMicrotask(() => { if (window.__hm) window.__hm.look5 = { LOOK5, look5InColl, look5WispCol, look5Frame, look5BandNames, look5HouseLifts, look5ScafUpPlan, look5BoardSpot, look5MasonsAgain, look5MasonsInPlace, look5HelpHTML, look5DeskHelpHTML, look5PhoneHelp }; });
