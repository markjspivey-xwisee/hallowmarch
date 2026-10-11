/* ================================================================== */
/* [guide] players know what to do (version 13)                        */
/* ================================================================== */
// What a player is told, when and where, with everything the game has become:
//  - where the next step of your path is: a gem on the minimap (an arrow on its rim when it lies farther off) and on
//    the map, and how far and which way in the path tracker (guideMark);
//  - a word at the moment each system first matters (field notes, once per character, added to FIELD_NOTES here and
//    watched by guideWatch, which 10c_lore.js's loreWatch calls); notes wait while you fight unless they are about the
//    fight (`fight: true`), wait for the first-steps note, and some only show where they mean something (`ok`);
//  - what to aim for after the early steps: the Chronicle's page of aims (chronGoals) and the tracker once the path is
//    walked (guideAim);
//  - the How to play screen, put together from every system's lines (guideHelpHTML, GUIDE_HELP);
//  - the Chronicle's pages on gear and on sieges (chronGear, chronSieges: CHRON_EXTRA.sieges takes more), the
//    loading screen's tips for every system.
// A new system adds its field notes with Object.assign(FIELD_NOTES, ...) and a watch in GUIDE_WATCH, its help lines
// to GUIDE_HELP, a Chronicle page with chronAdd(...) (10c_lore.js), and a line to LOADING_TIPS.

const GUIDE = { mark: null, markT: 0, wallSeen: false, made: [], scanT: 0, near: {}, stats: { notesHeld: 0, notesShown: 0 } };
const GUIDE_ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const GUIDE_TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
function guideNumber(n) { return n < 20 ? GUIDE_ONES[n] : n < 100 ? GUIDE_TENS[Math.floor(n / 10)] + (n % 10 ? '-' + GUIDE_ONES[n % 10] : '') : String(n); }

/* ------------------------------------------------------------------ */
/* where the next step is                                              */
/* ------------------------------------------------------------------ */
const guideOnFrontier = (P) => Math.hypot(P.x, P.z) < R_RING;
function guideNearest(list, P, f = (o) => o) {
  let best = null, bd = Infinity;
  for (const o of list) { const p = f(o); if (!p) continue; const d = dist2(P.x, P.z, p.x, p.z); if (d < bd) { bd = d; best = o; } }
  return best;
}
// a place in town while you are on the frontier: the way there is the portal stones at the muster
function guideTown(P, R, x, z, what) {
  if (guideOnFrontier(P)) return { x: R.musterSite.x, z: R.musterSite.z, what: `the portal stones home` };
  return { x, z, what };
}
function guideFront(P, R, x, z, what) {
  if (!guideOnFrontier(P) && dist2(P.x, P.z, R.town.x, R.town.z) < 420 * 420) return { x: R.town.x, z: R.town.z, what: `the portal stones to ${R.name} Muster` };
  return { x, z, what };
}
const GUIDE_BEASTS = new Set(['wolf', 'boar', 'bear']);
function guideCampFor(P, prog, beasts = false) {
  const R = REALMS[P.faction];
  const ok = CAMPS.filter((c) => c.realm === R.id && !c.elite && c.lmin <= prog.level + 1 && c.lmax >= prog.level - 3 && (!beasts || GUIDE_BEASTS.has(c.type)));
  const c = guideNearest(ok, P);
  return c ? { x: c.x, z: c.z, what: `the ${(MOB_PLURAL[c.type] || c.type).toLowerCase()} of your level` } : null;
}
function guideEnemyKeep(P) {
  const foes = WAR.keeps.filter((K) => K.realm !== P.faction);
  const besieged = foes.filter((K) => GAME.t < K.underSiegeUntil);
  const K = guideNearest(besieged.length ? besieged : foes, P, (q) => q.site);
  return K ? { x: K.site.x, z: K.site.z, what: K.site.name } : null;
}
function guideMarkOf(S) {
  const P = GAME.player, prog = GAME.prog, R = REALMS[P.faction];
  if (!S || inDungeon(P)) return null;
  const b = prog.bounty;
  switch (S.id) {
    case 'herald': return R.herald ? guideTown(P, R, R.herald.x, R.herald.z, `the ${R.name} Herald`) : null;
    case 'bounty':
      if (b && !b.done && CAMPS[b.camp]) return { x: CAMPS[b.camp].x, z: CAMPS[b.camp].z, what: `the ${pluralName(b.name)}` };
      return R.herald ? guideTown(P, R, R.herald.x, R.herald.z, `the ${R.name} Herald`) : null;
    case 'lv5': case 'lv20':
      if (b && !b.done && CAMPS[b.camp]) return { x: CAMPS[b.camp].x, z: CAMPS[b.camp].z, what: `the ${pluralName(b.name)}` };
      return guideOnFrontier(P) ? null : guideCampFor(P, prog);
    case 'draught': return R.merchant ? guideTown(P, R, R.merchant.x, R.merchant.z, R.merchant.name) : null;
    case 'cook': {
      if (goodsHave('meat_raw') || goodsHave('fish_raw')) {
        const f = guideNearest(FIRES.filter((q) => !q.ghost && !q.wall && (q.indoor || q.station || q.size >= 0.5)), P);
        return f ? { x: f.x, z: f.z, what: f.indoor ? 'a hearth' : f.station ? `the ${f.station}` : 'a fire' } : null;
      }
      return guideOnFrontier(P) ? null : guideCampFor(P, prog, true);
    }
    case 'craft': {
      const kind = goodsCount('herb_heal') >= 2 && goodsHave('water') ? 'alchemy' : 'tanning';
      const S2 = guideNearest(CRAFT.stations.filter((q) => q.kind === kind), P);
      return S2 ? guideTown(P, R, S2.x, S2.z, `the ${STATION_DEF[kind].name}`) : null;
    }
    case 'muster':
      if (prog.level < 14) return null;
      return guideOnFrontier(P) ? { x: R.musterSite.x, z: R.musterSite.z, what: `${R.name} Muster` } : { x: R.town.x, z: R.town.z, what: 'the portal stones' };
    case 'climb': {
      const K = guideNearest(WAR.keeps.filter((q) => q.realm === P.faction), P, (q) => q.site);
      return K ? guideFront(P, R, K.site.x, K.site.z, K.site.name) : null;
    }
    case 'warband': {
      const wb = guideNearest(WAR.warbands.filter((w) => w.realm === P.faction && !w.dead && wbLeader(w)), P, wbLeader);
      const L = wb && wbLeader(wb);
      return L ? guideFront(P, R, L.x, L.z, `a warband of ${R.name}`) : null;
    }
    case 'gate': case 'keep': { const k = guideEnemyKeep(P); return k ? guideFront(P, R, k.x, k.z, k.what) : null; }
    case 'hallow': {
      const loose = WAR.relics.find((x) => x.state === 'field' && x.realm !== P.faction);
      if (loose) { const p = relicPosition(loose); return guideFront(P, R, p.x, p.z, REALMS[loose.realm].hallowName); }
      const T = guideNearest(WAR.temples.filter((q) => q.realm !== P.faction && q.door && q.door.alive !== undefined && doorVulnerable(q.door)), P, (q) => q.site);
      if (T) return guideFront(P, R, T.site.x, T.site.z, T.site.name);
      const k = guideEnemyKeep(P);
      return k ? guideFront(P, R, k.x, k.z, k.what) : null;
    }
    case 'barrow': case 'king': return BARROW.door ? guideFront(P, R, BARROW.door.x, BARROW.door.z, 'the Hollow Barrow') : null;
    case 'champion': {
      const list = CAMPS.filter((c) => c.elite && c.lmin <= prog.level + 2).map((c) => getEnt(c.eliteId)).filter((e) => e && e.alive);
      const e = guideNearest(list, P);
      return e ? { x: e.x, z: e.z, what: capFirst(e.name) } : null;
    }
    case 'dragon': { const D = DRAGON.e; return D && D.alive && !D.removed ? { x: D.x, z: D.z, what: 'Cinderwing' } : null; }
    default: return null;
  }
}
// a creature's name for many of them: wolves, not wolfs; draugr and barrow bones as they are
function pluralName(n) {
  n = String(n || '');
  if (/(bones|draugr)$/.test(n)) return n;
  if (/wolf$/.test(n)) return n.replace(/wolf$/, 'wolves');
  return /(s|x|ch|sh)$/.test(n) ? n + 'es' : n + 's';
}
const GUIDE_DIRS = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];
// how far and which way, in words: "40 m to the north-east" (north is up on the map: -z)
function guideWhere(m) {
  const P = GAME.player;
  if (!m || !P) return '';
  const dx = m.x - P.x, dz = m.z - P.z, d = Math.hypot(dx, dz);
  if (d < 12) return 'here';
  const a = Math.atan2(dx, -dz), i = ((Math.round(a / (Math.PI / 4)) % 8) + 8) % 8;
  const dd = d < 1000 ? `${Math.round(d / (d < 100 ? 5 : 10)) * (d < 100 ? 5 : 10)} m` : `${(d / 1000).toFixed(1)} km`;
  return `${dd} ${GUIDE_DIRS[i]}`;
}
function guideUpdateMark(dt) {
  GUIDE.markT -= dt;
  if (GUIDE.markT > 0) return;
  GUIDE.markT = 0.5;
  const P = GAME.player;
  GUIDE.mark = P && P.alive && GAME.prog && GAME.prog.lore ? guideMarkOf(pathNext()) : null;
}
// the gem on the minimap, or an arrow on its rim pointing the way (10_ui.js drawMinimap calls this)
function guideMinimap(ctx, toM, S, dpr) {
  const m = GUIDE.mark;
  if (!m || INDOOR.on) return;
  let [x, y] = toM(m.x, m.z);
  const c = S / 2, pulse = 0.75 + 0.25 * Math.sin(renderTime * 4);
  const pad = 9 * dpr, inside = x > pad && y > pad && x < S - pad && y < S - pad;
  ctx.save();
  if (inside) {
    ctx.translate(x, y);
    ctx.fillStyle = `rgba(255, 216, 120, ${0.22 * pulse})`; ctx.beginPath(); ctx.arc(0, 0, 9 * dpr, 0, TAU); ctx.fill();
    ctx.rotate(Math.PI / 4);
    ctx.fillStyle = '#ffd36a'; ctx.strokeStyle = '#1a1206'; ctx.lineWidth = 1.5 * dpr;
    ctx.fillRect(-3.6 * dpr, -3.6 * dpr, 7.2 * dpr, 7.2 * dpr); ctx.strokeRect(-3.6 * dpr, -3.6 * dpr, 7.2 * dpr, 7.2 * dpr);
  } else {
    // on the rim, pointing out toward it
    const a = Math.atan2(y - c, x - c), r = c - 7 * dpr;
    const k = Math.min(Math.abs(r / Math.cos(a)), Math.abs(r / Math.sin(a)));
    x = c + Math.cos(a) * k; y = c + Math.sin(a) * k;
    ctx.translate(x, y); ctx.rotate(a);
    ctx.globalAlpha = 0.65 + 0.35 * pulse;
    ctx.fillStyle = '#ffd36a'; ctx.strokeStyle = '#1a1206'; ctx.lineWidth = 1.4 * dpr;
    ctx.beginPath(); ctx.moveTo(6 * dpr, 0); ctx.lineTo(-4 * dpr, -5 * dpr); ctx.lineTo(-1.5 * dpr, 0); ctx.lineTo(-4 * dpr, 5 * dpr); ctx.closePath(); ctx.fill(); ctx.stroke();
  }
  ctx.restore();
}
// and on the map, with its name (10_ui.js drawWorldMap calls this)
function guideMapMark(ctx, S) {
  const m = GUIDE.mark;
  if (!m || INDOOR.on) return;
  const [x, y] = w2m(m.x, m.z, S);
  const s = S * 0.011;
  ctx.save();
  ctx.translate(x, y);
  ctx.strokeStyle = 'rgba(255, 211, 106, 0.7)'; ctx.lineWidth = S * 0.0035; ctx.beginPath(); ctx.arc(0, 0, s * 2.2, 0, TAU); ctx.stroke();
  ctx.rotate(Math.PI / 4);
  ctx.fillStyle = '#ffd36a'; ctx.strokeStyle = '#1a1206'; ctx.lineWidth = S * 0.003;
  ctx.fillRect(-s, -s, s * 2, s * 2); ctx.strokeRect(-s, -s, s * 2, s * 2);
  ctx.restore();
  const S0 = pathNext();
  if (S0) {
    ctx.textAlign = 'center';
    const kpx = S / Math.max(1, ($('mapcanvas') && $('mapcanvas').clientWidth) || S);
    ctx.font = `600 ${Math.max(S * 0.017, 11 * kpx)}px "Alegreya Sans", sans-serif`;
    const t = `Your path: ${S0.short}`;
    ctx.fillStyle = 'rgba(0,0,0,0.8)'; ctx.fillText(t, x + 1, y - S * 0.03 + 1); ctx.fillStyle = '#ffd36a'; ctx.fillText(t, x, y - S * 0.03);
  }
}
// the line under the step in the path tracker: how far, which way, and that it is marked
function guideWhereLine() {
  const m = GUIDE.mark;
  if (!m) return '';
  const w = guideWhere(m);
  return `<span class="gd-where">${iconSvg('lpath', 13)}${w === 'here' ? `Here: ${esc(m.what)}` : `${esc(capFirst(m.what))}, ${w}`}</span>`;
}
const guideShortWhere = () => { const m = GUIDE.mark; if (!m) return ''; const w = guideWhere(m); return w === 'here' ? '' : w.split(' ')[0] + ' ' + w.split(' ')[1]; };

/* ------------------------------------------------------------------ */
/* what to aim for once the path is walked                             */
/* ------------------------------------------------------------------ */
function guideAims() {
  const P = GAME.player, prog = GAME.prog;
  if (!P || !prog) return [];
  const rr = realmRank(prog.rp), next = REALM_RANKS[rr] ?? null, prev = REALM_RANKS[rr - 1] ?? 0;
  const out = [];
  if (prog.level < LEVEL_CAP) out.push({ t: `Reach level ${prog.level + 1}`, m: [prog.xp / xpToNext(prog.level), `${fmtInt(prog.xp)} / ${fmtInt(xpToNext(prog.level))} XP`] });
  if (next !== null) out.push({ t: `Realm rank ${rr + 1}: ${RANK_TITLES[rr]}`, m: [clamp((prog.rp - prev) / Math.max(1, next - prev), 0, 1), `${fmtInt(prog.rp)} / ${fmtInt(next)} RP`], x: 'Realm points come from enemy soldiers, keeps, gates and hallows.' });
  const won = CAMPAIGN.history.filter((h) => h.w === P.faction && h.you).length;
  out.push({ t: CAMPAIGN.state === 'war' ? `Win campaign ${CAMPAIGN.n} for ${REALMS[P.faction].name}` : 'Peace: the next campaign begins soon', x: `Hold four of the six keeps for five minutes, or both enemy hallows for four. Campaigns won with you there: ${won}.` });
  return out;
}

/* ------------------------------------------------------------------ */
/* field notes for everything that came after the first ones           */
/* ------------------------------------------------------------------ */
// `fight`: may show in a fight (it is about the fight); `ok`: shows only while it still means something here
Object.assign(FIELD_NOTES, {
  needs: { t: 'Food and water', x: () => `The two bars under your health are food and water. ${IS_TOUCH ? 'Tap them' : 'Press V or click them'} to eat or drink the best thing in your packs. Drink at any well, trough, lake or river (${IS_TOUCH ? 'Use' : 'E'}), and cook meat at any fire. You never starve, but hungry or thirsty you heal slowly.` },
  stones: { t: 'The portal stones', x: () => `The ring of stones in the square carries you to your realm's muster on the frontier, and back. Below level 14 the frontier will kill you quickly: grow strong at home first.`, ok: () => GAME.prog.level < 14 },
  station: { t: 'A workstation', x: () => `${IS_TOUCH ? 'Use' : 'E'} opens its recipes. Each town has a forge, a workbench, a tanning rack, a loom, a bakehouse and an alchemy table: tan a hide into leather, or steep woundwort into a healing draught. ${IS_TOUCH ? 'Crafting in your Kit' : 'C'} shows what you can make by hand.` },
  ladder: { t: 'Ladders and hatches', x: () => `Walk into a ladder's foot to climb, or ${IS_TOUCH ? 'tap Use' : 'press E'}. A shut hatch is pushed open as you come up to it; ${IS_TOUCH ? 'Use' : 'E'} by a hatch opens or shuts it. On the rungs you fight one-handed: no shield, bow or long spell, and a heavy blow knocks you off.`, fight: true },
  tower: { t: 'Inside a tower', x: () => 'Store room, rooms above and a fighting top: ladders join them through hatches, and doors at the walls\' height open onto the walks. Shoot out through the slits; stand on a shut hatch and a foe below must heave at it.' },
  breach: { t: 'A breach', x: () => 'Siege stones have brought a wall or a tower down. The rubble is a way in for the attackers, and the garrison fights to hold it. In peace the keep rebuilds it behind scaffolding.' },
  engine: { t: 'Siege engines', x: () => `Rams batter gates; mangonels and trebuchets throw stones that crack walls and towers. ${IS_TOUCH ? 'Use' : 'E'} beside one of your realm's to join its crew; strike an enemy's to hack it apart, or set it alight.` },
  walls: { t: 'Walls stop what flies', x: () => 'Arrows stick in timber and thatch and glance off stone; spells burst on the wall they meet. Shoot through a crenel, a slit, an open door or window, or find a clear line.', fight: true },
  gear: { t: 'Your gear lives', x: () => `Fights wear it down and spatter it; mud, rain and rivers soak and dirty it. Wash it at a well, trough or any water (${IS_TOUCH ? 'Use' : 'E'}), mend it at a merchant, a keep hall's armourer or a forge, and dry off by a fire. Broken gear gives you nothing until it is mended.` },
  brand: { t: 'A burning brand', x: () => `It lights the way. ${IS_TOUCH ? 'Use' : 'E'} sets thatch, timber, trees and long grass alight; struck foes catch fire. Deep water and rain put it out.` },
  burning: { t: 'You are on fire', x: () => 'Get into water, or out of the flames and let it burn out. Frost puts fire out too.', fight: true },
  storm: { t: 'Thunderstorms', x: () => 'Lightning strikes the tallest thing near it: trees, towers, a rider on a hilltop. It sets roofs and trees alight. Get under a roof, or keep off the high ground.' },
  bands: { t: 'Warbands', x: (R) => `The banner over each captain of ${R.name} shows the band's order, and the map draws its route. Follow a band and fight beside it. From level 20 or realm rank 3 you can give it orders yourself.` },
  champion: { t: 'A borderland champion', x: () => 'Named, tough and with friends around it. A champion drops two pieces of good gear and a trophy for the crafters, and comes back five to seven minutes after it falls.' },
  gift: { t: 'Your realm\'s gift', x: () => `${IS_TOUCH ? 'The round gift button over your abilities' : 'Key 9'} calls your realm's great gift: it turns a big fight, then waits a long while. Your realm's two quiet gifts come with realm rank.` },
  ranks: { t: 'Ranks', x: () => 'Every ten levels past 20 all your abilities grow a rank stronger: II at 30, III at 40, IV at 50. Realm rank grows with realm points and adds health and damage.' },
  fish: { t: 'Fishing', x: () => `Cast, then wait while the float bobs. When it goes right under, ${IS_TOUCH ? 'tap Use' : 'press E'} at once to strike. Perch and roach bite by day, trout at dawn and dusk, eels at night.` },
  crops: { t: 'Your crops', x: () => 'Frost bites a crop below the cold it can stand, and a hard frost kills it; a dry spell wilts it. Snow lying on a bed keeps the frost off. Keep the seed of the plants that come through: their strain grows hardier.' },
  dark: { t: 'Night', x: () => 'Night falls over the March. Torches and hearths light the towns and keeps; carry a burning brand from any fire to light your way.', ok: () => !inDungeon(GAME.player) },
});
// the seasons' notes only where they mean something: lake ice when you are where the lakes freeze
if (FIELD_NOTES.lakeice) FIELD_NOTES.lakeice.ok = () => { const P = GAME.player, z = zoneAt(P.x, P.z); return z.realm === 2 || (SICE.on && guideIceNear(P)); };
function guideIceNear(P) {
  for (let i = 0; i < 12; i++) { const a = i * TAU / 12; for (const r of [20, 60, 110]) if (seasonIceY(P.x + Math.cos(a) * r, P.z + Math.sin(a) * r) != null) return true; }
  return false;
}

// what each note waits for (called four times a second by loreWatch, with its `want`)
const GUIDE_WATCH = {
  needs: () => SURV.built && (SURV.hunger < 0.42 || SURV.thirst < 0.42),
  stones: (P, ctx) => /^Step through the stones to .* Muster/.test(ctx.prompt),
  station: (P, ctx) => /^(Work at the|Weave at the|Use the bakehouse|Use the alchemy)/.test(ctx.prompt),
  ladder: (P, ctx) => onLadder(P) || /ladder|hatch/i.test(ctx.prompt),
  tower: (P) => !!towerRoomOf(P),
  breach: (P) => CASTLES.some((C) => C.sections && C.sections.some((W) => W.state === 'breach') && dist2(P.x, P.z, C.S.x, C.S.z) < 80 * 80),
  engine: (P) => GUIDE.near.engine,
  walls: () => GUIDE.wallSeen,
  gear: () => SLOTS.some((s) => { const it = INV.eq[s]; return it && itemDur(it) < 40; }) || kitDirt() > 0.45,
  brand: (P) => !!P.brand,
  burning: (P) => P.buffs.some((b) => b.kind === 'burn' && b.until > GAME.t),
  storm: () => (WEATHER.storm || 0) > 0.5 && WEATHER.bolts && WEATHER.bolts.length > 0,
  bands: (P) => GUIDE.near.band,
  champion: (P) => GUIDE.near.champion,
  gift: () => giftUltUnlocked(GAME.player),
  ranks: () => GAME.prog.level >= 30,
  dark: () => U.uNight.value > 0.6 && GAME.prog.level <= 12,
  fish: (P, ctx) => /^Fish here/.test(ctx.prompt),
  crops: () => FARM.plots.some((Q) => Q.own === 'p' && Q.plants.some((pl) => pl && !pl.dead && ((pl.bite || 0) > 0.5 || (pl.wilt || 0) > 0.4))),
};
// slower looks (once a second): what is near
function guideScan(P) {
  const R = REALMS[P.faction], N = GUIDE.near;
  N.engine = false; N.band = false; N.champion = false;
  if (!inDungeon(P)) {
    for (const e of ENT) if (e.siegeEngine && e.alive && dist2(e.x, e.z, P.x, P.z) < 45 * 45) { N.engine = true; break; }
    if (guideOnFrontier(P)) for (const wb of WAR.warbands) {
      if (wb.realm !== P.faction || wb.dead || !wb.order) continue;
      const L = wbLeader(wb);
      if (L && dist2(L.x, L.z, P.x, P.z) < 30 * 30 && dist2(P.x, P.z, R.musterSite.x, R.musterSite.z) > 40 * 40) { N.band = true; break; }
    }
    for (const c of CAMPS) if (c.elite) { const e = getEnt(c.eliteId); if (e && e.alive && dist2(e.x, e.z, P.x, P.z) < 55 * 55) { N.champion = true; break; } }
  }
  // the player's own shot stuck in a wall or glanced off one
  if (!GUIDE.wallSeen) GUIDE.wallSeen = WALLS.stuck.some((s) => s.src === P.id && (s.c || s.H || s.pc || s.f)) || WALLS.fall.some((f) => f.src === P.id);
}
function guideWatch(want) {
  const P = GAME.player;
  GUIDE.scanT -= 0.25;
  if (GUIDE.scanT <= 0) { GUIDE.scanT = 1; guideScan(P); }
  const pr = $('prompt'), ctx = { prompt: pr && pr.classList.contains('on') ? ($('prompt-t')._t || '') : '' };
  for (const id in GUIDE_WATCH) want(id, () => GUIDE_WATCH[id](P, ctx));
}
// something was made at a fire, a station or by hand (09t_craft.js survCraftOnce)
function guideMade(rec) {
  if (!rec) return;
  GUIDE.made.push(rec.skill === 'cook' ? 'cook' : 'craft');
}
// a new character's first moments belong to the first-steps note: other hints wait for it (08h_farming.js asks)
function guideQuiet() {
  const L = GAME.prog && GAME.prog.lore;
  return !!(L && LORE.fresh && (!L.seen.includes('start') || performance.now() < LORE.noteUntil));
}
// which queued note may show now: the first steps first; in a fight only a note about the fight; a note that means
// nothing here waits
function guideNoteIndex() {
  const P = GAME.player, prog = GAME.prog, Q = LORE.queue;
  if (Q.includes('start')) return Q.indexOf('start');
  if (LORE.fresh && !prog.lore.seen.includes('start')) return -1;
  const fight = GAME.t < P.combatUntil;
  for (let i = 0; i < Q.length; i++) {
    const N = FIELD_NOTES[Q[i]];
    if (!N) return i;
    if (fight && !N.fight) continue;
    if (N.ok && !N.ok()) continue;
    return i;
  }
  if (Q.length) GUIDE.stats.notesHeld++;
  return -1;
}

/* ------------------------------------------------------------------ */
/* the How to play screen, from every system's own lines               */
/* ------------------------------------------------------------------ */
function guideKeysHTML() {
  if (IS_TOUCH) return `<div class="keys">
    <kbd>Left thumb</kbd><span>Drag anywhere on the left to walk; push to the edge to run.</span>
    <kbd>Right thumb</kbd><span>Drag to turn the camera. Tap a creature, soldier or gate to target it.</span>
    <kbd>Ability buttons</kbd><span>Your calling's eight abilities. Locked ones open as you level; past 20 they grow a rank every ten levels.</span>
    <kbd>Use</kbd><span>Whatever the prompt over the buttons says: the herald, a door, a ladder or hatch, a workstation, a boat, water, a crew, a hallow. You can tap the prompt itself too.</span>
    <kbd>Target · Jump · Ride</kbd><span>Cycle the foes in front of you · jump (Dive and Up in deep water) · whistle for your horse or step down.</span>
    <kbd>Potion · Kit</kbd><span>Drink a healing draught · your gear, bags, crafting by hand and goods.</span>
    <kbd>Food and water bars</kbd><span>Under your health: tap to eat or drink the best thing you carry.</span>
    <kbd>Your path</kbd><span>Under your frame: the next step, how far and which way (the gold gem on the minimap). Tap it to unfold it, and its title for the whole path.</span>
    <kbd>Buttons under the minimap</kbd><span>The map (and orders for your warbands), your kit and bags, the log, building (the hammer), and the menu with the Chronicle and this page.</span>${classHelpKeys() /* [classes] 10d_classes_ui.js */}
    <kbd>Gift</kbd><span>The round gift button calls your realm's great gift, from realm rank 5 or level 30.</span></div>`;
  return `<div class="keys">
    <kbd>W A S D</kbd><span>Move, relative to the camera. Shift to run, Space to jump.</span>
    <kbd>Mouse drag</kbd><span>Turn the camera. Right-drag also turns you. Scroll to zoom.</span>
    <kbd>Click</kbd><span>Target a creature, soldier, gate or friend.</span>
    <kbd>1 – 8</kbd><span>Use your abilities. Casting stops if you move. Past level 20 they grow a rank stronger every ten levels.</span>
    <kbd>9</kbd><span>Your realm's great gift, from realm rank 5 or level 30.</span>
    <kbd>Tab · F</kbd><span>Cycle enemies in front of you · target yourself.</span>
    <kbd>E</kbd><span>Whatever the prompt says: portal stones, the herald, doors, ladders and hatches, workstations, fires, boats, water, plants, a crew, a hallow.</span>
    <kbd>R · Q</kbd><span>Whistle for your horse or step down (a blow throws you off) · drink a healing draught.</span>
    <kbd>V · C</kbd><span>Eat or drink the best thing you carry · crafting by hand.</span>
    <kbd>G · K · U</kbd><span>Build · your animals · dive while swimming (Space rises).</span>
    <kbd>I · M · L</kbd><span>Your gear and bags · the map (and orders for your warbands) · the log.</span>
    <kbd>J · H · Esc</kbd><span>The Chronicle · this page · the menu.</span>${classHelpKeys() /* [classes] 10d_classes_ui.js */}</div>`;
}
// the systems' own blocks, in the order a player meets them; a new system adds its function here
const GUIDE_HELP = [
  () => `<h3>What to do</h3><p>Your path, at the ${IS_TOUCH ? 'top left' : 'left'} of the screen, always shows your next step, how far and which way; the gold gem on the minimap marks the place. Every step pays a reward. The Chronicle (${IS_TOUCH ? 'in the menu, or tap your path' : 'J'}) tells the story, how every part of the March works, and what to aim for at 20, 30, 40 and 50.</p>`,
  () => `<h3>How the war works</h3><p>Level up against creatures in your home realm. The portal stones in your town carry you to the frontier muster. Break a keep's gate, slay its lord and the keep is yours. When a realm loses one of its keeps, its temple gate can be broken and its hallow carried off. Bring a hallow to your own temple gate to keep it, and every soldier of your realm hits harder. A realm that holds four of the six keeps for five minutes, or both enemy hallows for four, wins the campaign; from realm rank 3 or level 20 you can command your realm's warbands from the map.</p>`,
  () => `<h3>Keeps, towers and sieges</h3><p>Gates open for their own side and shut against enemies. Every tower can be entered and climbed: walk into a ladder, and push a hatch open as you come up to it. Walls stop what flies: shoot through crenels, slits and open doors. Siege engines crack walls and towers into breaches; ${IS_TOUCH ? 'Use' : 'E'} beside one of your realm's to join its crew.</p>`,
  () => `<h3>Loot and gear</h3><p>Fallen foes drop gear in six grades, from worn grey to legendary orange, of about their own level, to 50. Walk over it to pick it up. Gear wears, soaks and dirties: wash it at any water, mend it at a merchant, an armourer or a forge. Sell what you do not need to the merchant in your town.</p>`,
  () => `<h3>The Hollow Barrow and Cinderwing</h3><p>East of the Lone Tree lies a grassy mound with a ring of standing stones before it: the Hollow Barrow, for strong characters around level 18 and up. The gate of the Well of Souls opens only when its warden falls; the Hollow King's hoard is the best loot in the land. Cinderwing, a great red dragon, comes down to rest on high ground: keep out of its fire and away from its tail.</p>`,
  () => waterHelp(), // [water] 07b_swim.js
  () => survivalHelpHTML(), // [survival] 09s_survival.js
  () => farmHelpHTML(), // [farming] 08h_farming.js
  () => animalsHelpHTML(), // [animals] 08h_animals.js
  () => buildHelpHTML(), // [building] 06k_build.js
];
// each block folds under its first heading (a phone reads one at a time; What to do starts open)
function guideFold(html, open) {
  const m = /<h3>([^<]*)<\/h3>/.exec(html);
  if (!m) return html;
  return `<details class="gd-help"${open ? ' open' : ''}><summary>${m[1]}</summary><div>${html.slice(0, m.index)}${html.slice(m.index + m[0].length)}</div></details>`;
}
function guideHelpHTML() {
  let s = guideKeysHTML();
  GUIDE_HELP.forEach((f, i) => { try { s += guideFold(f(), i === 0); } catch (e) { reportError(e); } });
  return s;
}

/* ------------------------------------------------------------------ */
/* the Chronicle's pages on aims, gear and sieges                      */
/* ------------------------------------------------------------------ */
const CHRON_EXTRA = { sieges: [], gear: [], goals: [] }; // other modules push functions returning HTML
const chronExtra = (k) => CHRON_EXTRA[k].map((f) => { try { return f(); } catch (e) { reportError(e); return ''; } }).join('');
function chronGoals() {
  const P = GAME.player, prog = GAME.prog, L = prog.level, R = REALMS[P.faction];
  const rr = realmRank(prog.rp), gift = typeof GIFT_DEF !== 'undefined' && GIFT_DEF[P.faction];
  const champs = CAMPS.filter((c) => c.elite);
  const lvlOk = (n) => (L >= n ? '<span class="gd-ok">now</span>' : `<span class="gd-at">level ${n}</span>`);
  const mw = RECIPES.filter((r) => r.mw && (!r.cls || r.cls.includes(P.cls))).length;
  const goods = (id) => (GOODS[id] ? goodsCount(id) : 0);
  const aims = guideAims().map((a) => `<li><b>${a.t}</b>${a.m ? `<span class="meter"><i><b style="width:${(clamp(a.m[0], 0, 1) * 100).toFixed(1)}%"></b></i>${a.m[1]}</span>` : ''}${a.x ? `<small>${a.x}</small>` : ''}</li>`).join('');
  return `<p class="lead">The path takes a recruit to the frontier and through the first deeds of the war. Past level 20 the March rises to meet you: the frontier's soldiers, the Barrow, Cinderwing and the champions all keep pace with your level, and new things open every ten levels.</p>
    <h3>Now</h3><ul class="gd-aims">${aims}</ul>
    <div class="gd-tier"><h4>Level 20 ${lvlOk(20)}</h4><ul class="plain">
      <li><b>Your seventh ability</b>, and the frontier's soldiers, the Barrow and Cinderwing now rise with you.</li>
      <li><b>Command the warbands</b> of ${R.name} from the map (also from realm rank 3, or at the war table of a keep your realm holds).</li>
      <li><b>Borderland champions</b>: ${champs.length} named camps on the wild edges of the homelands, for levels 20 to 40. Each drops two pieces of good gear and a trophy.</li>
      <li><b>The Hollow King</b> rises with you: his hoard is two levels above yours, the best gear in the land.</li></ul></div>
    <div class="gd-tier"><h4>Level 30 ${lvlOk(30)}</h4><ul class="plain">
      <li><b>Your eighth ability</b>, and every ability reaches rank II.</li>
      <li><b>Your realm's great gift</b>${gift ? `, ${esc(gift.ult.name)},` : ''} on ${IS_TOUCH ? 'the gift button' : 'key 9'} (or at realm rank 5): it turns a big fight. You are realm rank ${rr} now.</li>
      <li><b>Cinderwing</b> is a fight for a seasoned band: three pieces of rare gear or better and a dragon scale.</li></ul></div>
    <div class="gd-tier"><h4>Level 40 ${lvlOk(40)}</h4><ul class="plain">
      <li><b>Rank III.</b> The fiercest champions hold the camps for levels 35 to 40.</li>
      <li><b>Named masterworks</b> (${mw} for your calling): item level 50, made at the forge, the workbench, the tanning rack or the loom by a master's hand (crafting 85 and up) from dragon scales, grave-iron from the Barrow's dead and champions' trophies. You carry ${goods('dragon_scale')} scale${goods('dragon_scale') === 1 ? '' : 's'}, ${goods('grave_iron')} grave-iron and ${goods('trophy')} troph${goods('trophy') === 1 ? 'y' : 'ies'}.</li></ul></div>
    <div class="gd-tier"><h4>Level 50 ${lvlOk(50)}</h4><ul class="plain">
      <li><b>Rank IV</b>, the height of your powers. Gear drops and is made to item level 50; the whole war rises to meet you.</li>
      <li><b>Win campaigns</b> for ${R.name}: lead its warbands, take keeps, carry hallows home. Each victory pays you a share of the spoils (gold, realm points and an epic piece), and the Chronicle keeps the record.</li></ul></div>
    ${chronExtra('goals')}`;
}
function chronGear() {
  const worn = kitItems().filter((it) => itemDur(it) < 40).length, cost = repairAllCost(), dirt = kitDirt();
  return `<p class="lead">What you wear makes you. Gear comes in six grades and in item levels to 50, and it lives as you do: it wears, it soaks, it gets muddy and bloody, and it can be cleaned and mended.</p>
    <h3>Grades and levels</h3>
    <div class="cons">${QUALITY.map((Q) => `<span style="--c:${Q.col}"><i></i>${Q.name}</span>`).join('')}</div>
    <p>Foes drop gear of about their own level, all the way to 50: a champion's spoils a little above it, a keep lord's more, and the Hollow King's and Cinderwing's hoards two above yours. The brighter the beam over a find, the better it is. Merchants and your path pay gear at your level. ${IS_TOUCH ? 'Kit' : 'I'} shows what you wear and carry; compare a piece before you put it on, and sell what you do not need.</p>
    <h3>Wear and weather</h3>
    <ul class="plain">
      <li><b>Wear.</b> Every blow you take or give wears your gear a little. Badly worn gear gives less, and broken gear nothing at all, until it is mended: by a merchant in town, at a keep hall's armourer's bench, or at a forge with iron (with your own hammer, good as new).</li>
      <li><b>Mud and blood.</b> Muddy ground, rain and fighting spatter it. Wash at a well, a trough, a hall's basin or the edge of any water; an armourer cleans it for nothing.</li>
      <li><b>Wet and snow.</b> Rain, rivers and snow soak you and your gear to the waterline. A fire, a hearth or the sun dries you; snow melts by a fire.</li>
      <li><b>Masterworks.</b> A skilled crafter's gear may come with a master's touch, an extra quality the grade would not give; a named masterwork is about a sixth better than a drop of its grade and level.</li></ul>
    ${chronExtra('gear')}
    <p class="now">Now: ${worn ? `<b>${worn}</b> piece${worn === 1 ? '' : 's'} badly worn` : 'your gear is sound'}${cost ? `, ${fmtInt(cost)} gold to mend everything` : ''}${dirt > 0.1 ? ', and it wants a wash' : ''}.</p>`;
}
function chronSieges() {
  return `<p class="lead">Keeps are taken by gate or by breach. A warband with an engine works at the walls until they fall, then storms the gap; one without batters the gate. Defenders sally out against the engines and plug the breaches.</p>
    <h3>Gates</h3><p>A gate opens for its own side and shuts against enemies. Strike it like any foe; it takes many blows, and the archers on the walls shoot back. A gate left alone starts to mend, and a broken one is rebuilt once the keep has been quiet a while.</p>
    <h3>Engines</h3><ul class="plain"><li><b>Rams</b> are pushed up to a gate and batter it. <b>Mangonels</b> and <b>trebuchets</b> throw stones in long arcs that crack wall sections and towers, and a cracked one falls into a breach.</li>
      <li>${IS_TOUCH ? 'Use' : 'E'} beside one of your realm's engines to join its crew (walk away to leave it); an abandoned engine of yours can be taken over. Strike an enemy's engine to hack it apart, or set it alight: wood burns.</li></ul>
    <h3>Breaches</h3><p>A fallen wall or tower leaves a slope of rubble into the keep. Attackers storm it; the garrison holds it and sallies out of its gate at the engines. In peace the keep rebuilds the breach behind scaffolding.</p>
    ${towersChronHTML() /* [keeps] towers, ladders, hatches, walls and breaches (04m_ladders.js) */}
    ${chronExtra('sieges')}`;
}
chronAdd('goals', 'Aims', 'you', chronGoals, 'path');
chronAdd('gear', 'Gear', 'you', chronGear, 'callings');
chronAdd('sieges', 'Sieges', 'war', chronSieges, 'orders');

/* ------------------------------------------------------------------ */
/* the loading screen, for every system                                */
/* ------------------------------------------------------------------ */
LOADING_TIPS.push(
  'The gold gem on your minimap marks where your path\'s next step is. An arrow on its rim points the way when it lies farther off.',
  'The two bars under your health are food and water: tap them, or press V, to eat or drink.',
  'Cooked food fills you four times as well as raw. Any fire cooks: a hearth, a brazier, a campfire, the forge.',
  'Tan a hide at the tanning rack, or steep two woundwort with water into a healing draught at the alchemy table.',
  'Gear wears, soaks and gets muddy. Wash it at any water, mend it at a merchant, a keep hall\'s armourer or a forge.',
  'Every tower of every keep can be climbed: walk into a ladder, and a shut hatch above is pushed open as you come to it.',
  'Stand on a shut hatch and a foe below cannot simply push it open. Drop the lid on one coming up through an open hatch.',
  'On a ladder you fight one-handed: no shield, no bow, no long spell. A heavy blow knocks a climber off.',
  'Arrows stick in timber and glance off stone. Shoot through a crenel, a slit or an open door.',
  'Join the crew of your realm\'s siege engine: Use beside it. Walk away to leave it.',
  'Stones from mangonels and trebuchets crack walls and towers into breaches; in peace the keep rebuilds them.',
  'The great hall of every keep has a war table: anyone of the realm holding the keep can command its warbands there.',
  'Take a burning brand from any fire: it lights the way and sets thatch, timber, trees and grass alight.',
  'Lightning strikes the tallest thing near it. In a thunderstorm, keep off the hilltops.',
  'Tame a wild horse, a wolf or a boar by offering the food it likes, calmly, again and again.',
  'Breed your best animals: the young take after both parents, a little better or worse in each trait.',
  'Till a bed of meadow with a hoe, sow it, and keep the seed of your best plant: your strain grows better each year.',
  'Frost kills tender crops. Sow hardier strains, or wait for spring.',
  'In deep water, dive (U or Dive) and look along the bed: lost arrows, old blades, purses and now and then a sunken chest.',
  'Every town keeps rowing boats at a jetty on its lake. Step in and row; the river carries you downstream.',
  'Past level 20 the frontier, the Barrow, Cinderwing and the champions all rise with you. The Chronicle\'s Aims page says what opens at 30, 40 and 50.',
  'Named masterworks of item level 50 need a master crafter, dragon scales, grave-iron from the Barrow and champions\' trophies.',
  'Your realm\'s great gift opens at realm rank 5 or level 30: it turns a big fight, then waits a long while.',
  'A bed you build is where you wake when you fall at home.',
);

/* ------------------------------------------------------------------ */
/* the frame                                                           */
/* ------------------------------------------------------------------ */
function updateGuide(dt) {
  if (!GAME.started || !GAME.player || !GAME.prog) return;
  guideUpdateMark(dt);
}

/* ------------------------------------------------------------------ */
/* test hooks: window.__hm.guide                                       */
/* ------------------------------------------------------------------ */
queueMicrotask(() => {
  if (!window.__hm) return;
  window.__hm.guide = {
    GUIDE, GUIDE_WATCH, GUIDE_HELP, CHRON_EXTRA, guideMarkOf, guideWhere, guideAims, guideHelpHTML, guideNoteIndex, guideScan, guideMade,
    chronGoals, chronGear, chronSieges, dragon: () => DRAGON.e, makeItem, bagAdd, CAMPAIGN, TOWER, drawMinimap, guideQuiet, pluralName,
    mark() { guideUpdateMark(1); const m = GUIDE.mark; return m ? { x: Math.round(m.x), z: Math.round(m.z), what: m.what, where: guideWhere(m) } : null; },
  };
});
