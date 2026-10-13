/* ================================================================== */
/* [look4] the world looked at again (version 15): the map's names     */
/* ================================================================== */
// The world map (drawWorldMap, 10_ui.js) wrote each name where its site is: the realm's name over its town's (the realm's
// name stood at 400 m along its axis, the town at 378), the town's under the guide's gem and its "Your path" pill
// (guideMapMark, 10e_guide.js), the muster's and the temple's names into each other at a small map. Now every name is laid
// out before it is drawn: in order of importance, each at the first of its places (under its mark, over it, to its right,
// to its left; a realm's name at the first of a few places along its axis) where it lies over no name already placed, no
// site's mark, the gem and its pill, a warband's mark, badge and name, or you; one that fits nowhere is drawn on a dark pill of its own (a name the map can
// spare, the muster's, is left out instead). Test hook __hm.look4.mapLabels.
const MAPL = { last: null };
function look4MapLabels(ctx, S, labels, marks) {
  const boxes = [], placed = [], cw = ($('mapcanvas') && $('mapcanvas').clientWidth) || S;
  const over = (a, b) => a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1];
  for (const [x, y, r] of marks) boxes.push([x - r, y - r, x + r, y + r]);
  // the guide's gem and the pill over it, which the guide draws after (10e_guide.js guideMapMark)
  if (GUIDE && GUIDE.mark && !INDOOR.on) {
    const [gx, gy] = w2m(GUIDE.mark.x, GUIDE.mark.z, S), s = S * 0.011 * 2.4;
    boxes.push([gx - s, gy - s, gx + s, gy + s]);
    const S0 = typeof pathNext === 'function' ? pathNext() : null;
    if (S0) {
      const kpx = S / Math.max(1, ($('mapcanvas') && $('mapcanvas').clientWidth) || S), fs = Math.max(S * 0.017, 11 * kpx);
      ctx.font = `600 ${fs}px "Alegreya Sans", sans-serif`;
      const tw = ctx.measureText(`Your path: ${S0.short}`).width, py = gy - S * 0.03 - fs * 0.98;
      boxes.push([gx - tw / 2 - fs * 0.45, py, gx + tw / 2 + fs * 0.45, py + fs * 1.36]);
    }
  }
  // you
  { const P = GAME.player; if (P) { const [px, py] = w2m(P.x, P.z, S); boxes.push([px - S * 0.017, py - S * 0.017, px + S * 0.017, py + S * 0.017]); } }
  // the warbands the map shows, drawn after the names (drawCampaignMap, 08g_campaign.js): each band's mark, its order's
  // badge over it and, for your own, its name under it (a band at a keep's gate wrote its name over the keep's)
  const bandBoxes = [];
  if (typeof cwSpotted === 'function' && GAME.player) {
    const P = GAME.player, u = S / Math.max(1, cw), sc = u * 2.2;
    const names = look5BandNames(ctx, S, P); // [look5] each of your bands' names where the campaign's map draws it (13z_look5.js)
    ctx.font = `700 ${11 * u}px "Alegreya Sans", sans-serif`;
    for (const wb of WAR.warbands) {
      const L = !wb.dead && wbLeader(wb);
      if (!L || !cwSpotted(wb, P)) continue;
      const [x, y] = w2m(L.x, L.z, S);
      bandBoxes.push([x - sc * 4.2, y - sc * 9.2, x + sc * 4.2, y + S * 0.008]);
      if (wb.realm === P.faction && typeof WB_ORD !== 'undefined') {
        const w = ctx.measureText(WB_ORD[wbOrd(wb) - 1] || '').width, at = names.get(wb) || [x, y + sc * 5.6];
        bandBoxes.push([at[0] - w / 2 - 2, at[1] - 11 * u * 0.85, at[0] + w / 2 + 2, at[1] + 11 * u * 0.25]);
      }
    }
    boxes.push(...bandBoxes);
  }
  const order = labels.map((l, i) => ({ ...l, i })).sort((a, b) => a.pri - b.pri || a.i - b.i);
  for (const l of order) {
    ctx.font = l.font;
    const w = ctx.measureText(l.t).width, h = l.fs, pad = h * 0.12;
    let pick = null, first = null;
    for (const [cx, cy] of (typeof l.at === 'function' ? l.at(w) : l.at)) {
      // the text's box (centred at cx, its baseline at cy), kept on the map
      const bx = [cx - w / 2 - pad, cy - h * 0.8 - pad, cx + w / 2 + pad, cy + h * 0.22 + pad];
      if (bx[0] < 2 || bx[2] > S - 2 || bx[1] < 2 || bx[3] > S - 2) continue;
      if (!first) first = [cx, cy, bx];
      if (!boxes.some((b) => over(b, bx))) { pick = [cx, cy, bx, false]; break; }
    }
    if (!pick) {
      if (l.spare || !first || (l.pri >= 3 && cw < 560)) continue; // (a small map leaves out a lesser name that fits nowhere)
      pick = [first[0], first[1], first[2], true];
    }
    boxes.push(pick[2]);
    placed.push({ t: l.t, box: pick[2].map((v) => Math.round(v)), pill: pick[3] });
    const [cx, cy, bx, pill] = pick;
    if (pill) { ctx.fillStyle = 'rgba(12, 10, 8, 0.72)'; ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(bx[0], bx[1], bx[2] - bx[0], bx[3] - bx[1], h * 0.35); else ctx.rect(bx[0], bx[1], bx[2] - bx[0], bx[3] - bx[1]); ctx.fill(); }
    ctx.fillStyle = l.shade || 'rgba(0,0,0,0.75)'; ctx.fillText(l.t, cx + (l.big ? 2 : 1), cy + (l.big ? 2 : 1));
    ctx.fillStyle = l.col; ctx.fillText(l.t, cx, cy);
  }
  MAPL.last = { placed, n: labels.length, marks: marks.length, S, bands: bandBoxes.map((q) => q.map((v) => Math.round(v))) };
  return placed;
}
// the places a site's name may go: under its mark (d below), over it, to its right, to its left
function look4SiteAt(x, y, r, d, fs) {
  return (w) => [[x, y + d], [x, y - r - fs * 0.3], [x + r + 4 + w / 2, y + fs * 0.35], [x - r - 4 - w / 2, y + fs * 0.35],
    [x + r * 0.7 + w / 2, y + d], [x - r * 0.7 - w / 2, y + d], [x + r * 0.7 + w / 2, y - r - fs * 0.3], [x - r * 0.7 - w / 2, y - r - fs * 0.3],
    [x, y + d + fs * 1.15], [x, y - r - fs * 1.45], [x + r + 8 + w / 2, y + d + fs * 1.1], [x - r - 8 - w / 2, y + d + fs * 1.1]];
}
queueMicrotask(() => { if (window.__hm) window.__hm.look4 = { MAPL, mapLabels: look4MapLabels, look4SiteAt }; });
