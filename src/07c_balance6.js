/* ================================================================== */
/* [balance6] the callings within the aim at every level, measured in  */
/*   arenas far apart (version 14)                                     */
/* ================================================================== */
const BAL6 = { stats: { firesBroken: 0 } };

/* ------------------------------------------------------------------ */
/* the measures: a firebreak round each arena                          */
/* ------------------------------------------------------------------ */
// tests (tools/tests/classes.py CB.breakFires, duels.py): grass burning farther than r from every arena's middle is put
// out each second. A grass fire lit by a fire arrow or a firebolt spread up to 37 m from where it was lit in still air
// and twice that downwind, into the next arena, where the skilled bots stepped out of it (688 steps in one run of mastery
// duels at 30) and the simple ones stood in it
function balBreakFires(centres, r = 34) {
  if (typeof NATURE === 'undefined' || !NATURE.fire || !NATURE.fire.size || !centres || !centres.length) return 0;
  let n = 0;
  const r2 = r * r;
  for (const [k, c] of NATURE.fire) {
    const x = c.i - 511.5, z = c.j - 511.5;
    let near = false;
    for (const s of centres) if ((s.x - x) * (s.x - x) + (s.z - z) * (s.z - z) < r2) { near = true; break; }
    if (near) continue;
    NAT.data[k * 4 + 2] = 0; natMark(c.i, c.j, c.i, c.j); NATURE.fire.delete(k); n++;
  }
  BAL6.stats.firesBroken += n;
  return n;
}

// tests (duels.py): one arena made whole as its duel ends, so the next duel there begins at once while the others fight
// on (a phase waited on its slowest duel, up to a minute, while most arenas stood empty): what its two fighters left
// (snares, runes, holy ground, steam, arrows and bolts in flight), and within r of its middle the ice, a blizzard, the
// craters and the burning grass
function balCleanArena(x, z, r, gone) {
  const t = GAME.t, r2 = r * r, near = (q) => q && (q.x - x) * (q.x - x) + (q.z - z) * (q.z - z) < r2;
  for (const L of [CLS.snares, CLS.runes, CLS.grounds, CLS.steam]) for (const q of L) if (gone.has(q.owner) || gone.has(q.src) || near(q)) q.until = Math.min(q.until, t - 1);
  for (const q of CLS.ice) if (q.until > t && near(q)) q.until = t - 1;
  for (let i = CLS.arrows.length - 1; i >= 0; i--) if (gone.has(CLS.arrows[i].src)) CLS.arrows.splice(i, 1);
  for (let i = PROJ.length - 1; i >= 0; i--) if (gone.has(PROJ[i].src)) PROJ.splice(i, 1);
  if (typeof SPELL !== 'undefined') for (const S of SPELL.emitters) if (near(S) || (S.src && gone.has(S.src.id))) S.until = Math.min(S.until, t - 0.01);
  let n = 0;
  if (typeof NATURE !== 'undefined' && NATURE.craters) {
    for (let q = NATURE.craters.length - 1; q >= 0; q--) {
      const K = NATURE.craters[q];
      const cx = (K.i0 + K.i1) / 2 - 511.5, cz = (K.j0 + K.j1) / 2 - 511.5;
      if ((cx - x) * (cx - x) + (cz - z) * (cz - z) > r2) continue;
      for (let j = K.j0; j <= K.j1; j++) for (let i = K.i0; i <= K.i1; i++) { const v = K.d[(j - K.j0) * K.w + (i - K.i0)]; if (v) W.H[j * HN + i] -= v * K.k; }
      natTerrainUpdate(K.i0, K.j0, K.i1, K.j1);
      NATURE.craters.splice(q, 1); n++;
    }
    if (NATURE.fire && NATURE.fire.size) for (const [k, c] of NATURE.fire) { const fx = c.i - 511.5, fz = c.j - 511.5; if ((fx - x) * (fx - x) + (fz - z) * (fz - z) < r2) { NAT.data[k * 4 + 2] = 0; natMark(c.i, c.j, c.i, c.j); NATURE.fire.delete(k); } }
  }
  return n;
}

setTimeout(() => {
  if (!window.__hm) return;
  window.__hm.bal6 = { BAL6, breakFires: balBreakFires, cleanArena: balCleanArena };
}, 0);
