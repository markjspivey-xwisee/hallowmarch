/* ================================================================== */
/* the campaign: readable orders, commands from the map, victory       */
/* ================================================================== */
// A war you can read, steer and win. Each realm commander picks objectives for reasons it states
// aloud, and spreads its warbands across its two fronts instead of piling them on one point; every
// order is announced, drawn on the maps and shown over the band's captain. From realm rank 3 or
// level 20 the player commands their realm's warbands from the world map. A realm wins the campaign
// by holding four of the six keeps, or both enemy hallows, long enough; after an hour the elders call
// it for the realm with the most renown. After a short peace the March resets and a new campaign
// begins. The shared files only call in:
//   08_ai.js   commanderThink -> planWar · wbSetOrder -> announceOrder · updateWarband -> rallyPoint
//              (rally orders) · retask skips the player's orders · updateWar -> updateCampaign
//   10_ui.js   updateWarPanel -> campaignHudHTML · drawWorldMap -> drawCampaignMap, campaignSideHTML
//              drawMinimap -> drawCampaignMinimap · updateNameplates -> campaignPlate
//              updateHUD -> updateCampaignUI · openHerald -> campaignHeraldText
//   10c_lore.js the Chronicle's war and orders sections
//   12_save.js buildSave -> campaignSaveData · applyWorldSave -> applyCampaignSave

/* ------------------------------------------------------------------ */
/* the rules                                                           */
/* ------------------------------------------------------------------ */
const CW = {
  KEEPS: 4,           // keeps of the six that make a dominion
  KEEP_HOLD: 300,     // seconds a dominion must stand to win
  HALLOW_HOLD: 240,   // seconds both enemy hallows must stay in one temple to win
  DECAY: 1 / 12,      // a broken claim drains at a twelfth of the speed it grew, so repeated holds add up ([siege] tuning: was a sixth)
  PEACE: 90,          // seconds of peace before the March resets
  LONG: 900,          // from 15 minutes the long war thins the garrisons and slows the gates
  CALL: 3600,         // after an hour the elders call the war for the realm with the most renown
};
const CAMPAIGN = {
  n: 1, t0: 0, state: 'war', peaceUntil: 0, winner: -1, how: '',
  claims: [0, 1, 2].map(() => ({ k: 0, h: 0, kOn: false, hOn: false, warned: 0 })),
  renown: [0, 0, 0], story: null, history: [], longSaid: false, pendingVictory: null, truceUntil: 0,
  seen: { keeps: [], doors: new Map(), relics: [] },
};
const WB_ORD = ['First', 'Second', 'Third', 'Fourth', 'Fifth', 'Sixth', 'Seventh', 'Eighth'];
const ORDER_GLYPH = { attack: 'sword', defend: 'shield', raid: 'flame', carry: 'lcarry', retrieve: 'lretrieve', patrol: 'lpatrol', rally: 'horn' };
const ORDER_WORD = { attack: 'Attack', defend: 'Defend', raid: 'Raid', carry: 'Carry', retrieve: 'Retrieve', patrol: 'Patrol', rally: 'Rally' };
const ORDINAL_WORD = ['zeroth', 'first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth', 'eleventh', 'twelfth'];
const ordinalWord = (n) => ORDINAL_WORD[n] || `${n}th`;
const fmtClock = (s) => { s = Math.max(0, Math.ceil(s)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
const possessive = (name) => `${name}'s`;
const campaignElapsed = () => GAME.t - CAMPAIGN.t0;
// the long war: from 0 at 15 minutes to 1 at 40
const cwWeary = () => clamp((campaignElapsed() - CW.LONG) / 1500, 0, 1);
function newStory() {
  return { captures: [0, 0, 0], hallows: [0, 0, 0], gatesLost: [0, 0, 0], you: { cap: 0, hal: 0, gates: 0, orders: 0, rk0: null } };
}
CAMPAIGN.story = newStory();

/* ------------------------------------------------------------------ */
/* names and words                                                     */
/* ------------------------------------------------------------------ */
// a band keeps the lowest number free in its realm when it musters: the First, the Second...
function wbOrd(wb) {
  if (wb.ord) return wb.ord;
  const used = new Set(WAR.warbands.filter((w) => w !== wb && !w.dead && w.realm === wb.realm && w.ord).map((w) => w.ord));
  let n = 1;
  while (used.has(n)) n++;
  wb.ord = n;
  return n;
}
function wbName(wb, withRealm = true) {
  if (wb.w3col) return war3ColName(wb, withRealm); // [war3] a garrison's column (08k_war3.js)
  if (wb.season) return s2Name(wb, withRealm); // [season2] an army of the season (08o_season2.js)
  const o = WB_ORD[wbOrd(wb) - 1] || `${wbOrd(wb)}th`;
  return withRealm ? `${possessive(REALMS[wb.realm].name)} ${o} Warband` : `${o} Warband`;
}
function nodeSiteName(node) {
  const K = WAR.keeps.find((q) => q.nav.gate === node || q.nav.court === node);
  if (K) return K.site.name;
  const T = WAR.temples.find((q) => q.nav.tg === node || q.nav.tc === node);
  if (T) return `the ${T.site.name}`;
  const R = REALMS.find((q) => q.nav.muster === node);
  return R ? R.musterSite.name : 'the road';
}
// the whole order in plain words, as the herald would cry it
function orderPhrase(wb, O) {
  const R = REALMS[wb.realm];
  const you = O.byPlayer ? ' at your command' : '';
  const w3 = !O.byPlayer && war3OrderPhrase(wb, O); // [war3] a column, a keep braced or secured (08k_war3.js)
  if (w3) return w3;
  switch (O.type) {
    case 'attack': {
      const K = O.keep;
      if (O.byPlayer) return `marches on ${K.site.name}${you}`;
      const why = { breach: 'while its gate lies broken', wall: 'through the breach in its walls', retake: `to win it back for ${R.name}`, claim: 'to win the March', break: `to break ${possessive(REALMS[K.realm].name)} hold on the March`, pact: `in common cause against ${REALMS[K.realm].name}`, offensive: 'in its announced offensive', /* [loops] */ regain: K.orig === wb.realm ? `to win it back: ${R.name} is down to its last keep` : `to win a keep: ${R.name} has lost all but one` }[O.why] || 'to break its gate'; // [war3] pact, regain (08k_war3.js)
      return `marches on ${K.site.name} ${why}`;
    }
    case 'defend': return O.byPlayer ? `marches to hold ${O.keep.site.name}${you}` : O.why === 'engines' ? `marches to break the siege engines before ${O.keep.site.name}` : `marches to lift the siege of ${O.keep.site.name}`; // [siege]
    case 'raid': {
      const H = REALMS[O.relic.realm].hallow;
      return `marches on the ${O.temple.site.name} to seize ${H}${O.relic.realm === wb.realm ? ' and bring it home' : ''}${you}`;
    }
    case 'carry': return `carries ${REALMS[O.relic.realm].hallow} home to the ${R.templeName}`;
    case 'retrieve': return `rides after ${REALMS[O.relic.realm].hallow} to take it back`;
    case 'patrol':
      if (O.home) return 'turns for home: the campaign is over';
      if (O.why === 'temple') return `stands guard at the ${R.templeName} against raiders`;
      return `keeps watch at ${nodeSiteName(O.node)}`;
    case 'rally': return `rallies to ${GAME.player ? GAME.player.name : 'you'}`;
    default: return 'awaits orders';
  }
}
// the short form, for nameplates and lists: [glyph, "Attack", "Ráth Fiacla"]
function orderShort(wb) {
  const O = wb.order;
  if (!O) return ['lpatrol', 'Mustering', ''];
  let what = '';
  if (O.type === 'attack' || O.type === 'defend' || O.type === 'garrison') what = O.keep.site.name; // [war3] garrison
  else if (O.type === 'raid') what = O.temple.site.name;
  else if (O.type === 'carry') what = `${REALMS[O.relic.realm].hallowName} home`;
  else if (O.type === 'retrieve') what = REALMS[O.relic.realm].hallowName;
  else if (O.type === 'patrol') what = O.home ? 'home' : nodeSiteName(O.node).replace(/^the /, '');
  else if (O.type === 'rally') what = GAME.player ? GAME.player.name : '';
  return [ORDER_GLYPH[O.type] || 'lpatrol', O.home ? 'Withdraw' : ORDER_WORD[O.type] || O.type, what];
}
function phaseWord(wb) {
  const O = wb.order;
  if (!O) return 'at the muster';
  if (O.type === 'carry') return 'bearing it home';
  if (O.type === 'retrieve') return 'giving chase';
  if (O.type === 'rally') return 'at your side';
  if (O.type === 'patrol') return O.home ? 'marching home' : 'on watch';
  return { travel: 'on the march', siege: 'at the gate', assault: 'storming the court', hold: 'holding it', bombard: 'guarding its engine', breach: 'storming the breach', gap: 'going in by the gap' }[O.phase] || ''; // [war2] gap // [siege] bombard, breach
}
function announceOrder(wb, O) {
  if (!O || !GAME.t) return;
  const key = `${O.type}:${O.keep ? O.keep.id : O.temple ? 't' + O.temple.id : O.relic ? 'h' + O.relic.id : O.node ? 'n' + O.node.id : ''}:${O.why || ''}:${O.byPlayer ? 1 : 0}`;
  if (wb.cwKey === key) return;
  wb.cwKey = key;
  news(`${wbName(wb)} ${orderPhrase(wb, O)}.`, wb.realm, 'order');
}
// the commander's (or the player's) order, with the reason it was given
function cwSetOrder(wb, o, why, byPlayer = false) {
  o.why = why;
  if (byPlayer) o.byPlayer = true;
  wbSetOrder(wb, o);
}

/* ------------------------------------------------------------------ */
/* the commanders                                                      */
/* ------------------------------------------------------------------ */
// each band leans toward one of the realm's two fronts, so a realm's armies spread out by default
const cwFront = (wb) => (wb.realm + (wbOrd(wb) % 2 ? 1 : 2)) % 3;
// the strongest claim on the March held by a realm other than r: { realm, kind, frac }
function cwLeadingClaim(r) {
  let best = null;
  for (let q = 0; q < 3; q++) {
    if (q === r) continue;
    const c = CAMPAIGN.claims[q];
    for (const [kind, v, need, on] of [['keeps', c.k, CW.KEEP_HOLD, c.kOn], ['hallows', c.h, CW.HALLOW_HOLD, c.hOn]]) {
      const frac = v / need;
      if ((on || frac > 0.25) && (!best || frac > best.frac)) best = { realm: q, kind, frac };
    }
  }
  return best;
}
const liveGuards = (K) => [...K.guards].filter((id) => { const g = getEnt(id); return g && g.alive; }).length;
// every objective this band could take, scored, with its reason; the best is chosen
function cwChoose(wb, r) {
  const now = GAME.t, L = wbLeader(wb);
  if (!L) return null;
  const others = WAR.warbands.filter((w) => w !== wb && !w.dead && w.realm === r && w.order);
  const has = (f) => others.some((w) => f(w.order));
  const lead = cwLeadingClaim(r);
  const myKeeps = WAR.keeps.filter((K) => K.realm === r).length;
  const front = cwFront(wb);
  const C = [];
  const push = (s, o, why) => C.push({ s, o, why });
  // raiders at our own temple gate
  const T0 = WAR.temples[r];
  if (now < T0.underSiegeUntil && !has((O) => O.type === 'patrol' && O.node === T0.nav.tg)) push(100, { type: 'patrol', node: T0.nav.tg, until: now + 45 }, 'temple');
  // a keep of ours under siege, once its gate is in real danger (or it holds up our claim)
  for (const K of WAR.keeps) {
    if (K.realm !== r || now >= K.underSiegeUntil || has((O) => O.type === 'defend' && O.keep === K)) continue;
    const eng = siegeDanger(K); // [siege] engines before the walls, a breach in them (04h_siege.js)
    const danger = Math.max(!K.door.alive ? 1 : 1 - K.door.hp / K.door.maxHp, eng);
    if (danger < 0.3 && !CAMPAIGN.claims[r].kOn) continue;
    push(54 + danger * 14 - dist(L.x, L.z, K.site.x, K.site.z) / 12 + (CAMPAIGN.claims[r].kOn ? 12 : 0), { type: 'defend', keep: K, since: now }, eng >= danger && eng > 0.3 ? 'engines' : 'relieve');
  }
  // an enemy temple left open
  if (!has((O) => O.type === 'raid' || O.type === 'carry')) {
    const held = WAR.relics.filter((x) => x.state === 'temple' && x.at === r && x.realm !== r).length;
    for (const T of WAR.temples) {
      if (T.realm === r || !templeExposed(T)) continue;
      const rels = WAR.relics.filter((x) => x.state === 'temple' && x.at === T.realm);
      if (!rels.length) continue;
      const rel = rels.find((x) => x.realm === r) || rels[0];
      let s = 64 + (rel.realm === r ? 14 : 0) - dist(L.x, L.z, T.site.x, T.site.z) / 16;
      let why = rel.realm === r ? 'reclaim' : 'hallow';
      if (rel.realm !== r && held === 1) { s += 12; why = 'claim'; }
      if (lead && lead.realm === T.realm) { s += 14; if (why === 'hallow') why = 'break'; }
      // another realm is raiding it already: leave them to it rather than meet there three ways
      if (WAR.warbands.some((w) => !w.dead && w.realm !== r && w.order && w.order.type === 'raid' && w.order.temple === T)) s -= 30;
      push(s, { type: 'raid', temple: T, relic: rel }, why);
    }
  }
  // enemy keeps
  for (const K of WAR.keeps) {
    if (K.realm === r) continue;
    const ours = others.filter((w) => w.order.type === 'attack' && w.order.keep === K).length;
    if (ours >= 2) continue;
    let s = 50, why = 'gate';
    if (K.orig === r) { s += 20; why = 'retake'; }
    if (!K.door.alive) { s += 18; if (why === 'gate') why = 'breach'; }
    else s += (1 - K.door.hp / K.door.maxHp) * 10;
    if (K.door.alive && cwOpenBreach(K)) { s += 14; if (why === 'gate') why = 'wall'; } // [war2] a breach open in its walls: a second band to storm it with the first (08j_war2.js)
    s -= liveGuards(K) * 1.5;
    if (K.realm === front || K.orig === front) s += 6;
    s -= dist(L.x, L.z, K.site.x, K.site.z) / 14;
    if (myKeeps === CW.KEEPS - 1) { s += 12; why = 'claim'; }
    if (lead && lead.realm === K.realm) { s += 16; why = 'break'; }
    // two bands of ours on one keep only when it is decisive; otherwise spread out
    if (ours === 1) s += why === 'gate' ? -16 : why === 'breach' || why === 'wall' ? 10 : 6; // [war2] 'wall'
    // and keep out of a fight two other realms are already having
    s -= WAR.warbands.filter((w) => !w.dead && w.realm !== r && w.realm !== K.realm && w.order && w.order.keep === K).length * 22;
    push(s, { type: 'attack', keep: K }, why);
  }
  // nothing better: keep watch at our most battered keep
  const own = WAR.keeps.filter((K) => K.realm === r).sort((a, b) => a.door.hp / a.door.maxHp - b.door.hp / b.door.maxHp);
  if (own.length) push(4, { type: 'patrol', node: own[0].nav.gate, until: now + 30 }, 'watch');
  war3Choose(wb, r, C, L); // [war3] hold what was taken, press for the claim, the pact, win one back (08k_war3.js)
  war4Choose(r, C); // [war4] nothing against an ally while the pact holds (08l_war4.js)
  if (!C.length) return null;
  C.sort((a, b) => b.s - a.s);
  // a little chance decides between choices that score about the same
  return C.length > 1 && C[1].s > C[0].s - 3 && Math.random() < 0.35 ? C[1] : C[0];
}
function planWar(C) {
  const r = C.realm, now = GAME.t;
  const mine = WAR.warbands.filter((w) => w.realm === r && !w.dead);
  for (const wb of mine) wbOrd(wb);
  // in the peace every band marches home to its muster
  if (CAMPAIGN.state === 'peace') {
    for (const wb of mine) if ((!wb.order || !wb.order.home) && !(wb.w3col && wb.w3col.peace)) cwSetOrder(wb, { type: 'patrol', node: REALMS[r].nav.muster, until: CAMPAIGN.peaceUntil + 40, home: true }, 'home'); // [war4] (a column of the peace marches on to its keep: 08l_war4.js)
    return;
  }
  // urgent: a hallow lies in the field, or ours is being carried off
  const loose = looseRelicFor(r, mine);
  if (loose) { const p = relicPosition(loose); retask(mine, p.x, p.z, { type: 'retrieve', relic: loose, why: 'chase' }); }
  else if (Math.random() < 0.5 && !mine.some((w) => w.order && (w.order.type === 'raid' || w.order.type === 'carry'))) {
    // a chance: an enemy temple lies open; a band on the march turns to raid it
    for (const T of WAR.temples) {
      if (T.realm === r || !templeExposed(T) || war4Allied(r, T.realm)) continue; // [war4] not an ally's while the pact holds (08l_war4.js)
      if (WAR.warbands.some((w) => !w.dead && w.realm !== r && w.order && w.order.type === 'raid' && w.order.temple === T)) continue;
      const rel = WAR.relics.find((x) => x.state === 'temple' && x.at === T.realm && x.realm === r) || WAR.relics.find((x) => x.state === 'temple' && x.at === T.realm);
      if (rel && retask(mine, T.site.x, T.site.z, { type: 'raid', temple: T, relic: rel, why: rel.realm === r ? 'reclaim' : 'hallow' })) break;
    }
  }
  // a keep of ours in real danger: the nearest band on the march turns back to relieve it
  for (const K of WAR.keeps) {
    const eng = siegeDanger(K); // [siege] a breach, or engines at work, is danger too (04h_siege.js)
    if (K.realm !== r || now >= K.underSiegeUntil || (K.door.alive && eng < 0.65)) continue;
    if (mine.some((w) => w.order && w.order.type === 'defend' && w.order.keep === K)) continue;
    retask(mine, K.site.x, K.site.z, { type: 'defend', keep: K, since: now, why: K.door.alive ? 'engines' : 'relieve' });
    break;
  }
  // the muster: a realm down to its last keep musters bigger bands, faster; so does a long war
  const keepsOwned = WAR.keeps.filter((K) => K.realm === r).length;
  const underdog = keepsOwned <= 1 ? 1 : 0;
  if (cwBandsCounted(mine) < MAX_WARBANDS() + underdog + war3Levy(r) && now > C.nextSpawn) { // [war3] a realm with three keeps or more musters one band more (08k_war3.js) // [war2] a band's last two or three do not hold its place at the muster (08j_war2.js)
    const size = loopsMuster(r, 7 + Math.floor(Math.random() * 4) + underdog * 2 + Math.round(cwWeary() * 3)); // [loops] as many as the realm's stores feed and arm (08m_loops.js)
    const wb = spawnWarband(r, size);
    loopsMustered(wb); // [loops]
    wbOrd(wb);
    // the long war hardens the bands: late in a campaign they muster as veterans, up to four levels up
    const vet = Math.round(cwWeary() * 4);
    if (vet) for (const e of wbMembers(wb)) { e.wlOff = (e.wlOff || 0) + vet; e.level += vet; setupStats(e, true); }
    cwMergeRemnants(r, wb, mine); // [war2] the last of a broken band join the new one (08j_war2.js)
    mine.push(wb);
    C.nextSpawn = now + 26 + Math.random() * 18 - underdog * 8;
  }
  for (const wb of mine) {
    if (wb.order) continue;
    const best = cwChoose(wb, r);
    if (best) cwSetOrder(wb, best.o, best.why);
  }
}

/* ------------------------------------------------------------------ */
/* the player's commands                                               */
/* ------------------------------------------------------------------ */
function cwCanCommand() {
  const prog = GAME.prog;
  return !!prog && (realmRank(prog.rp) >= 3 || prog.level >= 20 || hallCommandGrant()); // [building] or at the war table of a keep your realm holds (04k_hall.js)
}
// what the player may order a band to do, as [cmd, target, label]
function cwChoices(wb) {
  const r = wb.realm, out = [];
  for (const K of WAR.keeps) if (K.realm !== r) out.push(['attack', K.id, `Attack ${K.site.name}`]);
  for (const K of WAR.keeps) if (K.realm === r) out.push(['defend', K.id, `Defend ${K.site.name}`]);
  for (const T of WAR.temples) if (T.realm !== r) out.push(['raid', T.id, `Raid the ${T.site.name}`, !templeExposed(T)]);
  out.push(['rally', -1, 'Rally to me']);
  return out;
}
// the player gives a band an order; returns a sentence saying what happened
function playerOrder(wbId, cmd, target) {
  const P = GAME.player;
  const wb = WAR.warbands.find((w) => w.id === wbId && !w.dead);
  if (!P || !wb || wb.realm !== P.faction) return 'That warband is gone.';
  if (!cwCanCommand()) return 'You may command warbands from realm rank 3 or level 20.';
  if (CAMPAIGN.state !== 'war') return 'The campaign is over: the armies are going home.';
  const now = GAME.t;
  let o = null;
  if (cmd === 'attack') { const K = WAR.keeps[target]; if (!K || K.realm === wb.realm) return 'That keep is already ours.'; o = { type: 'attack', keep: K }; }
  else if (cmd === 'defend') { const K = WAR.keeps[target]; if (!K || K.realm !== wb.realm) return 'Only a keep of ours can be defended.'; o = { type: 'defend', keep: K, since: now + 150 }; }
  else if (cmd === 'raid') {
    const T = WAR.temples[target];
    if (!T || T.realm === wb.realm) return 'Choose an enemy temple.';
    if (!templeExposed(T)) return `The gate of the ${T.site.name} cannot be broken while ${REALMS[T.realm].name} holds both its keeps. Take one of them first.`;
    const rel = WAR.relics.find((x) => x.state === 'temple' && x.at === T.realm && x.realm === wb.realm) || WAR.relics.find((x) => x.state === 'temple' && x.at === T.realm);
    if (!rel) return `No hallow rests in the ${T.site.name} now.`;
    o = { type: 'raid', temple: T, relic: rel };
  } else if (cmd === 'rally') {
    if (inDungeon(P) || Math.hypot(P.x, P.z) > R_RING + 40) return 'Warbands only march on the frontier. Go to the muster first.';
    o = { type: 'rally', until: now + 300 };
  } else if (cmd === 'release') {
    if (!wb.order || !wb.order.byPlayer) return `The ${wbName(wb, false)} already follows the commander.`;
    wb.order = null; wb.cwMine = null; wb.cwKey = '';
    news(`${wbName(wb)} returns to the commander's orders.`, wb.realm, 'order');
    return `The ${wbName(wb, false)} returns to the commander's orders.`;
  }
  if (!o) return '';
  cwSetOrder(wb, o, 'order', true);
  wb.cwMine = wb.order;
  CAMPAIGN.story.you.orders++;
  sfx('horn');
  return `The ${wbName(wb, false)} ${orderPhrase(wb, wb.order).replace(' at your command', '')}.`;
}
// a rally order: the band follows the player around the frontier (called from updateWarband)
function rallyPoint(wb, O, L) {
  const P = GAME.player;
  if (!P || !P.alive || P.faction !== wb.realm || GAME.t > O.until || inDungeon(P) || Math.hypot(P.x, P.z) > R_RING + 40) return false;
  const d = dist(L.x, L.z, P.x, P.z);
  // stand a few strides short of the player, on the side the band comes from
  O.point = d > 7 ? { x: P.x + ((L.x - P.x) * 5) / d, z: P.z + ((L.z - P.z) * 5) / d } : { x: L.x, z: L.z };
  if (GAME.t > (O.replanAt || 0)) {
    O.replanAt = GAME.t + 3;
    const n = nearestNavNode(P.x, P.z, null, true);
    if (n && wb.goal !== n.id) wbPlan(wb, n);
  }
  return true;
}

/* ------------------------------------------------------------------ */
/* claims, victory, the peace and the reset                            */
/* ------------------------------------------------------------------ */
function foreignHallows(r) { return WAR.relics.filter((x) => x.state === 'temple' && x.at === r && x.realm !== r).length; }
function cwTrack() {
  const S = CAMPAIGN.story, seen = CAMPAIGN.seen, P = GAME.player, war = CAMPAIGN.state === 'war';
  if (P && S.you.rk0 == null && GAME.prog) S.you.rk0 = GAME.prog.realmKills;
  // keeps that changed hands
  for (const K of WAR.keeps) {
    if (seen.keeps[K.id] === undefined) seen.keeps[K.id] = K.realm;
    if (seen.keeps[K.id] !== K.realm) {
      seen.keeps[K.id] = K.realm;
      if (war) { S.captures[K.realm]++; CAMPAIGN.renown[K.realm] += 5; if (P && P.faction === K.realm && dist(P.x, P.z, K.site.x, K.site.z) < 70) S.you.cap++; }
      // [siege] tuning: a realm that takes its third keep or more is pressing a claim: it marches a full garrison
      // in behind its banners at once, so a dominion can stand long enough to be won (04h_siege.js notes)
      if (war && !W3.on && WAR.keeps.filter((q) => q.realm === K.realm).length >= CW.KEEPS - 1) { fillGarrison(K, true); K.nextGuardAt = GAME.t + 14; } // [war3] (a column marches in now: 08k_war3.js)
    }
  }
  // gates broken
  for (const D of [...WAR.keeps.map((K) => K.door), ...WAR.temples.map((T) => T.door)]) {
    const was = seen.doors.get(D.id);
    if (was && !D.alive && war) { S.gatesLost[D.keepRef ? D.keepRef.realm : D.templeRef.realm]++; if (P && D.damagers && D.damagers.has(P.id)) S.you.gates++; }
    seen.doors.set(D.id, D.alive);
    // the long war: a broken gate waits longer to be rebuilt
    if (was && !D.alive) D.deadAt += 60 * cwWeary();
  }
  // hallows carried home
  for (const rel of WAR.relics) {
    const o = seen.relics[rel.id] || {};
    if (o.state === 'carried' && rel.state === 'temple' && rel.at !== rel.realm && war) { S.hallows[rel.at]++; CAMPAIGN.renown[rel.at] += 10; if (P && o.carrier === P.id) S.you.hal++; }
    seen.relics[rel.id] = { state: rel.state, carrier: rel.carrier };
  }
}
function updateCampaign(dt) {
  const now = GAME.t;
  cwTrack();
  // the long war: reinforcements come more slowly
  const w = cwWeary();
  if (w > 0) for (const K of WAR.keeps) if (K.nextGuardAt !== K.cwNG) { if (K.nextGuardAt > now) K.nextGuardAt += 14 * 2 * w; K.cwNG = K.nextGuardAt; }
  // the player's own orders: tell them when one is done
  const P = GAME.player;
  for (const wb of WAR.warbands) {
    if (!wb.cwMine) continue;
    if (wb.dead || wb.order !== wb.cwMine) {
      const name = wbName(wb, false);
      const txt = wb.dead ? `The ${name} has fallen.` : wb.order && wb.order.type === 'carry' ? `The ${name} has seized ${REALMS[wb.order.relic.realm].hallow} and carries it home.` : `The ${name} has done as you bade, and returns to the commander's orders.`;
      if (P && P.faction === wb.realm) { uiToast(txt); uiLog(txt, 'rp'); }
      wb.cwMine = null;
    }
  }
  // the truce: no keep changes hands while the armies go home, nor in the first half minute after the
  // reset, while bands still near a keep they were fighting for walk away to their new orders
  if (CAMPAIGN.state === 'peace' || now < CAMPAIGN.truceUntil) for (const K of WAR.keeps) { const Lr = getEnt(K.lord); if (Lr && Lr.alive) Lr.hp = Lr.maxHp; }
  if (CAMPAIGN.state === 'peace') { if (now > CAMPAIGN.peaceUntil) resetMarch(); return; }
  const el = campaignElapsed();
  if (!CAMPAIGN.longSaid && el > CW.LONG) {
    CAMPAIGN.longSaid = true;
    news('The war drags on. Garrisons thin, broken gates mend slowly, the musters send out bigger bands of veterans, and the elders grow impatient: a hold on the March counts for more the longer the war lasts.', -1, 'big'); // [war2] the claims' pace (08j_war2.js)
  }
  for (let r = 0; r < 3; r++) {
    const c = CAMPAIGN.claims[r], R = REALMS[r];
    const keeps = WAR.keeps.filter((K) => K.realm === r).length, hal = foreignHallows(r);
    CAMPAIGN.renown[r] += (dt / 60) * (keeps + 2 * hal);
    const kOn = keeps >= CW.KEEPS, hOn = hal >= 2;
    const rate = cwClaimRate(); // [war2] the long war: a hold counts for more (08j_war2.js)
    const k3 = kOn ? 0 : war3ClaimSlow(r, keeps); // [war3] three keeps, more than any other realm: the claim grows at W3.CLAIM3 of the pace; three: it does not fade (08k_war3.js)
    c.k = kOn ? c.k + dt * rate : k3 > 0 ? c.k + dt * rate * k3 : k3 < 0 ? c.k : Math.max(0, c.k - dt * CW.DECAY);
    c.h = hOn ? c.h + dt * rate : Math.max(0, c.h - dt * CW.DECAY);
    if (kOn && !c.kOn) news(`${R.name} holds ${keeps} of the six keeps! Hold them ${Math.max(1, Math.round((CW.KEEP_HOLD - c.k) / rate / 60))} more minutes and ${R.name} wins the March.`, r, 'big'); // [war2] / rate
    if (!kOn && c.kOn) news(`${possessive(R.name)} hold on the keeps is broken. Its claim fades slowly.`, r, 'normal');
    if (hOn && !c.hOn) news(`${R.name} holds both enemy hallows in the ${R.templeName}! Keep them there ${Math.max(1, Math.round((CW.HALLOW_HOLD - c.h) / rate / 60))} more minutes to win the March.`, r, 'big'); // [war2] / rate
    if (!hOn && c.hOn) news(`${R.name} no longer holds both hallows. Its claim fades slowly.`, r, 'normal');
    c.kOn = kOn; c.hOn = hOn;
    // warnings as the end nears
    const left = war4Left(Math.min(kOn ? (CW.KEEP_HOLD - c.k) / rate : k3 > 0 ? (CW.KEEP_HOLD - c.k) / rate / k3 : 1e9, hOn ? (CW.HALLOW_HOLD - c.h) / rate : 1e9)); // [war2] in seconds still to hold; [war3] at three keeps' pace too; [war4] never before the twentieth minute (08l_war4.js)
    if (left < 180 && c.warned < 1) { c.warned = 1; news(`Three minutes: ${R.name} is close to winning the March.`, r, 'big'); }
    if (left < 60 && c.warned < 2) { c.warned = 2; news(`One minute: ${R.name} will win the March unless its hold is broken!`, r, 'big'); }
    if (left > 240) c.warned = 0;
    if (c.k >= CW.KEEP_HOLD && war4MayWin(r, 'keeps')) { campaignVictory(r, 'keeps'); return; } // [war4] no claim won before the twentieth minute (08l_war4.js)
    if (c.h >= CW.HALLOW_HOLD && war4MayWin(r, 'hallows')) { campaignVictory(r, 'hallows'); return; }
  }
  if (el >= CW.CALL) {
    const order = [0, 1, 2].sort((a, b) => CAMPAIGN.renown[b] - CAMPAIGN.renown[a] || WAR.keeps.filter((K) => K.realm === b).length - WAR.keeps.filter((K) => K.realm === a).length);
    campaignVictory(order[0], 'renown');
  }
}
function campaignVictory(r, how) {
  const S = CAMPAIGN.story, P = GAME.player, R = REALMS[r], prog = GAME.prog;
  CAMPAIGN.state = 'peace';
  CAMPAIGN.peaceUntil = GAME.t + CW.PEACE;
  CAMPAIGN.winner = r;
  CAMPAIGN.how = how;
  const you = P && prog ? { r: P.faction, cap: S.you.cap, hal: S.you.hal, gates: S.you.gates, kills: Math.max(0, prog.realmKills - (S.you.rk0 ?? prog.realmKills)), orders: S.you.orders } : null;
  const rec = { n: CAMPAIGN.n, w: r, how, m: Math.max(1, Math.round(campaignElapsed() / 60)), cap: S.captures.slice(), hal: S.hallows.slice(), gates: S.gatesLost.slice(), ren: CAMPAIGN.renown.map((v) => Math.round(v)), you };
  // the realm's reward goes to its people
  if (P && prog && P.faction === r) {
    const L = prog.level;
    const gold = 60 + 6 * L, rp = 800 + 20 * L, xp = L < LEVEL_CAP ? Math.round(xpToNext(L) * 0.35) : 0;
    addGold(gold); addRP(rp); if (xp) addXP(xp);
    const it = makeItem({ cls: P.cls, realm: P.faction, lvl: L, q: 4, slot: pick(Math.random, ['weapon', 'chest', 'cloak', 'head']) });
    if (!bagAdd(it)) dropItem(it, P.x, P.z, P.y + 1.2);
    rec.reward = { gold, rp, xp, item: it.name, q: it.q };
    uiLog(`Victory! Your share of the spoils: ${fmtInt(rp)} realm points, ${fmtInt(gold)} gold${xp ? `, ${fmtInt(xp)} experience` : ''} and ${it.name}.`, 'rp');
  }
  CAMPAIGN.history.push(rec);
  seasonOnBattle(r); // [loops] a battle won counts for the season (08n_season.js)
  while (CAMPAIGN.history.length > 12) CAMPAIGN.history.shift();
  const howTxt = how === 'keeps' ? 'by its hold on the keeps' : how === 'hallows' ? 'holding both enemy hallows' : 'with the most renown when the elders called the war';
  news(`${R.name} has won the ${ordinalWord(rec.n)} campaign for the March, ${howTxt}! The armies go home.`, r, 'big');
  WAR.stats.campaigns = (WAR.stats.campaigns || 0) + 1;
  // every band turns for home at once, the player's orders with them
  for (const wb of WAR.warbands) wb.cwMine = null;
  for (const C of WAR.commanders) planWar(C);
  // banners of light over everything the victor holds
  const spots = [...WAR.keeps.filter((K) => K.realm === r).map((K) => K.site), R.templeSite];
  const col = R.rgb.map((v) => v * 2 + 0.5);
  for (let i = 0; i < 14; i++) later(i * 0.45, () => { const Sx = spots[i % spots.length]; FX.burst(Sx.x + (Math.random() - 0.5) * 18, Sx.y + 12 + Math.random() * 8, Sx.z + (Math.random() - 0.5) * 18, 40, i % 3 ? col : [2.4, 2.0, 1.1], 8, 1.3, 0.28, 2.5); });
  cwFanfare(P ? P.faction === r : true);
  musicStinger(P && P.faction !== r ? 'defeat' : 'victory'); // [music] the score answers the fanfare (11b_music.js)
  CAMPAIGN.pendingVictory = P ? rec : null; // shown once no window is open
  saveSoon(800);
}
function cwFanfare(win) {
  if (!AUDIO.ctx || !AUDIO.on || AUDIO.ctx.state !== 'running') return;
  const t = AUDIO.ctx.currentTime + 0.03;
  try {
    if (win) { brass(t, [196, 261.6, 329.6], 0.18, 0.55, 0.05); brass(t + 0.6, [261.6, 329.6, 392, 523.2], 0.0, 1.9, 0.045); brass(t + 1.1, [659.3], 0, 1.4, 0.03); }
    else { brass(t, [220, 196, 164.8], 0.32, 1.1, 0.045); brass(t + 1.0, [130.8, 196], 0, 1.8, 0.04); }
  } catch (e) { /* audio is optional */ }
}
// after the peace every keep and hallow goes home and a new campaign begins
function restoreKeep(K) {
  if (seasonKeepStays(K)) { fillGarrison(K, true); K.underSiegeUntil = -99; setDoorState(K.door, true, 1); return; } // [loops] in the season's war a keep taken stays its taker's (08n_season.js)
  if (K.realm !== K.orig) {
    for (const id of K.guards) { const g = getEnt(id); if (g) { FX.burst(g.x, g.y + 1.2, g.z, 14, [0.5, 1.1, 1.8], 2.5, 0.8, 0.16, 0.5); removeEnt(g); } }
    K.guards.clear();
    const Lr = getEnt(K.lord);
    if (Lr) { FX.burst(Lr.x, Lr.y + 1.2, Lr.z, 14, [0.5, 1.1, 1.8], 2.5, 0.8, 0.16, 0.5); removeEnt(Lr); }
    K.lord = null;
    K.realm = K.orig;
    setSiteBanners(K.site, K.orig);
    fillGarrison(K, true);
    const S = K.site, col = REALMS[K.orig].rgb.map((v) => v * 2 + 0.4);
    for (let i = 0; i < 4; i++) later(i * 0.3, () => FX.burst(S.x + (Math.random() - 0.5) * 16, S.y + 10 + Math.random() * 5, S.z + (Math.random() - 0.5) * 16, 24, col, 6, 1.0, 0.24, 3));
  } else fillGarrison(K, true); // [war2] a keep that stayed its own begins the new campaign with its garrison whole too (thinned by the last, two fell in its first three minutes: 08j_war2.js)
  K.underSiegeUntil = -99;
  K.lastOwnerChange = GAME.t;
  setDoorState(K.door, true, 1);
}
function resetMarch() {
  war3Reset(); // [war3] the engines gone, the walls whole (08k_war3.js)
  for (const K of WAR.keeps) restoreKeep(K);
  seasonAfterReset(); // [loops] the keeps as the season holds them (08n_season.js)
  for (const rel of WAR.relics) {
    const c = rel.carrier != null ? getEnt(rel.carrier) : null;
    if (c) c.carrying = null;
    rel.state = 'temple'; rel.at = rel.realm; rel.from = rel.realm; rel.slot = 'home'; rel.carrier = null;
  }
  for (const T of WAR.temples) { T.exposedUntil = -99; T.underSiegeUntil = -99; setDoorState(T.door, true, 1); }
  updateRelicBonuses();
  CAMPAIGN.n++;
  CAMPAIGN.t0 = GAME.t;
  CAMPAIGN.truceUntil = GAME.t + 30;
  CAMPAIGN.state = 'war';
  CAMPAIGN.winner = -1;
  CAMPAIGN.how = '';
  CAMPAIGN.claims.forEach((c) => Object.assign(c, { k: 0, h: 0, kOn: false, hOn: false, warned: 0 }));
  CAMPAIGN.renown = [0, 0, 0];
  CAMPAIGN.story = newStory();
  CAMPAIGN.longSaid = false;
  CAMPAIGN.seen = { keeps: [], doors: new Map(), relics: [] };
  for (const wb of WAR.warbands) if (wb.order && wb.order.home) wb.order = null;
  news(`Horns across the March: the ${ordinalWord(CAMPAIGN.n)} campaign begins. ${seasonKeepsHeld() ? 'The keeps and hallows stand as the season\'s war has left them.' : 'Every keep and hallow is back with its own realm.'}`, -1, 'big'); // [loops] in the season's war (08n_season.js)
  sfx('horn');
  saveSoon(800);
}

/* ------------------------------------------------------------------ */
/* saving                                                              */
/* ------------------------------------------------------------------ */
// coarse on purpose: the world save is written only when this changes, so it changes every few minutes
function campaignSaveData() {
  const q = (v, s) => Math.floor(v / s) * s;
  return {
    n: CAMPAIGN.n, el: q(campaignElapsed(), 300), p: CAMPAIGN.state === 'peace' ? 1 : 0,
    k: CAMPAIGN.claims.map((c) => q(c.k, 120)), h: CAMPAIGN.claims.map((c) => q(c.h, 120)), ren: CAMPAIGN.renown.map((v) => q(v, 10)),
    hist: CAMPAIGN.history.map((h) => ({ ...h })),
  };
}
function applyCampaignSave(c) {
  if (!c || typeof c !== 'object') return;
  const num = (v, lo, hi, d = 0) => (typeof v === 'number' && isFinite(v) ? clamp(v, lo, hi) : d);
  const arr3 = (a, hi) => [0, 1, 2].map((i) => num(Array.isArray(a) ? a[i] : 0, 0, hi));
  CAMPAIGN.n = Math.round(num(c.n, 1, 9999, 1));
  CAMPAIGN.t0 = GAME.t - num(c.el, 0, CW.CALL - 60);
  const k = arr3(c.k, CW.KEEP_HOLD - 60), h = arr3(c.h, CW.HALLOW_HOLD - 60);
  CAMPAIGN.claims.forEach((cl, i) => { cl.k = k[i]; cl.h = h[i]; });
  CAMPAIGN.renown = arr3(c.ren, 1e5);
  CAMPAIGN.history = (Array.isArray(c.hist) ? c.hist : []).filter((x) => x && typeof x === 'object' && x.w >= 0 && x.w <= 2).slice(-12).map((x) => ({
    n: Math.round(num(x.n, 1, 9999, 1)), w: x.w | 0, how: ['keeps', 'hallows', 'renown'].includes(x.how) ? x.how : 'renown', m: Math.round(num(x.m, 1, 999, 1)),
    cap: arr3(x.cap, 999), hal: arr3(x.hal, 999), gates: arr3(x.gates, 999), ren: arr3(x.ren, 1e5),
    you: x.you && typeof x.you === 'object' ? { r: num(x.you.r, 0, 2) | 0, cap: num(x.you.cap, 0, 999) | 0, hal: num(x.you.hal, 0, 999) | 0, gates: num(x.you.gates, 0, 999) | 0, kills: num(x.you.kills, 0, 1e5) | 0, orders: num(x.you.orders, 0, 1e4) | 0 } : null,
    reward: x.reward && typeof x.reward === 'object' ? { gold: num(x.reward.gold, 0, 1e6) | 0, rp: num(x.reward.rp, 0, 1e6) | 0, xp: num(x.reward.xp, 0, 1e8) | 0, item: typeof x.reward.item === 'string' ? x.reward.item.slice(0, 60) : '', q: num(x.reward.q, 0, 5) | 0 } : undefined,
  }));
  // saved in the peace: the reset comes as soon as the world is up
  if (c.p) { CAMPAIGN.state = 'peace'; CAMPAIGN.peaceUntil = GAME.t + 3; CAMPAIGN.winner = CAMPAIGN.history.length ? CAMPAIGN.history[CAMPAIGN.history.length - 1].w : 0; }
}

/* ------------------------------------------------------------------ */
/* the HUD panel, the herald                                           */
/* ------------------------------------------------------------------ */
// the claim nearest to winning, of any realm: { r, kind, left, frac, on }
function cwTopClaims() {
  const out = [];
  CAMPAIGN.claims.forEach((c, r) => {
    const k3 = c.kOn ? 0 : war3ClaimSlow(r, WAR.keeps.filter((K) => K.realm === r).length); // [war3] the slow claim of three keeps (08k_war3.js)
    if (c.k > 0) out.push({ r, kind: 'keeps', left: war4Left((CW.KEEP_HOLD - c.k) / cwClaimRate() / (k3 > 0 ? k3 : 1)), frac: c.k / CW.KEEP_HOLD, on: c.kOn, slow: k3 > 0, held: k3 < 0 }); // [war2] (the long war's pace); [war4] not before the twentieth minute
    if (c.h > 0) out.push({ r, kind: 'hallows', left: war4Left((CW.HALLOW_HOLD - c.h) / cwClaimRate()), frac: c.h / CW.HALLOW_HOLD, on: c.hOn });
  });
  return out.sort((a, b) => b.frac - a.frac);
}
function campaignHudHTML() {
  if (!WAR.keeps.length) return '';
  const el = campaignElapsed();
  let body;
  if (CAMPAIGN.state === 'peace') {
    const R = REALMS[CAMPAIGN.winner] || REALMS[0];
    const left = CAMPAIGN.peaceUntil - GAME.t;
    body = `<div class="cw-claim on" style="--rc:${R.color}"><span class="w"><b>${R.name}</b> won the March</span><span>New campaign in</span><span class="num">${fmtClock(left)}</span><i><b style="width:${(clamp(1 - left / CW.PEACE, 0, 1) * 100).toFixed(1)}%"></b></i></div>`;
  } else {
    const top = cwTopClaims().slice(0, 2);
    body = top.length ? top.map((c) => {
      const R = REALMS[c.r];
      return `<div class="cw-claim${c.on ? ' on' : ''}" style="--rc:${R.color}" title="${c.on ? 'Victory in' : c.slow ? 'Three keeps, more than any other realm: the claim grows at two fifths of the pace' : c.held ? 'Three keeps: the claim holds' : 'A fading claim'}"><span><b>${R.name}</b> ${c.kind === 'keeps' ? (c.on ? `holds ${WAR.keeps.filter((K) => K.realm === c.r).length} keeps` : c.slow || c.held ? 'holds 3 keeps' : 'claim on keeps') : (c.on ? 'holds both hallows' : 'claim on hallows')}</span><span class="num">${c.on || c.slow ? fmtClock(c.left) : c.held ? 'held' : 'fading'}</span><i><b style="width:${(c.frac * 100).toFixed(1)}%"></b></i></div>`; // [war3] slow, held
    }).join('') : `<div class="cw-rule">To win: ${CW.KEEPS} keeps for ${CW.KEEP_HOLD / 60} min, or both enemy hallows for ${CW.HALLOW_HOLD / 60} min</div>`;
  }
  return `<div class="cw-hud"><div class="cw-h" title="After an hour the elders call the war for the realm with the most renown"><span>Campaign ${CAMPAIGN.n}</span><span class="num">${CAMPAIGN.state === 'peace' ? 'peace' : fmtClock(el)}</span></div>${body}${war3HudLine()}${loopsHudLine() /* [loops] what each realm's stores lack (08m_loops.js) */}</div>`; // [war3] who presses for a claim, the pact, a keep of yours held (08k_war3.js)
}
function campaignHeraldText() {
  const P = GAME.player, R = REALMS[P.faction];
  const rule = `<p>The war is fought in campaigns. A realm that holds ${CW.KEEPS} of the six keeps for ${CW.KEEP_HOLD / 60} minutes (three, more than any other realm, build that claim at two fifths of the pace), or both enemy hallows in its temple for ${CW.HALLOW_HOLD / 60}, wins the March; after an hour the elders give it to the realm with the most renown. Then, after a short peace, every keep and hallow goes home and it all begins again.</p>`;
  const cmd = cwCanCommand()
    ? `<p>You have earned the right to command. Open the map, choose one of ${possessive(R.name)} warbands and tell it to attack a keep, defend one of ours, raid an open temple or rally to you. It holds your order until the deed is done, then the commander takes it back.</p>`
    : `<p>At realm rank 3 or level 20 you may command ${possessive(R.name)} warbands yourself, from the map.</p>`;
  return rule + war3HeraldText() + cmd; // [war3] the war as it stands (08k_war3.js)
}

// the Chronicle's war section: how a campaign is won, the standing and the record
function campaignChronHTML() {
  const claims = cwTopClaims();
  const rows = [0, 1, 2].map((r) => {
    const c = claims.find((q) => q.r === r);
    const claim = c ? (c.on ? `${c.kind === 'keeps' ? 'keeps' : 'hallows'}: wins in ${fmtClock(c.left)}` : 'a fading claim') : '·';
    return `<span class="r" style="--rc:${REALMS[r].color}"><i></i>${REALMS[r].name}</span><span class="c">${Math.round(CAMPAIGN.renown[r])}</span><span class="c">${CAMPAIGN.story.captures[r]}</span><span class="w">${claim}</span>`;
  }).join('');
  const hist = CAMPAIGN.history.slice().reverse().map((h) => `<li><b style="color:${REALMS[h.w].light}">The ${ordinalWord(h.n)} campaign</b>: ${REALMS[h.w].name}, ${h.how === 'keeps' ? `holding ${CW.KEEPS} keeps` : h.how === 'hallows' ? 'holding both enemy hallows' : 'by renown'}, after ${h.m} minutes. Keeps taken ${h.cap.join(' · ')}; hallows carried home ${h.hal.join(' · ')}.</li>`).join('');
  const now = CAMPAIGN.state === 'peace' ? `${REALMS[CAMPAIGN.winner].name} has won the ${ordinalWord(CAMPAIGN.n)} campaign; the March resets in ${fmtClock(CAMPAIGN.peaceUntil - GAME.t)}.` : `The ${ordinalWord(CAMPAIGN.n)} campaign has run for ${Math.floor(campaignElapsed() / 60)} minutes.`;
  return `<h3>How a campaign is won</h3>
    <p>The war is fought in campaigns. A realm wins the March when it holds <b>${CW.KEEPS} of the six keeps</b> for ${CW.KEEP_HOLD / 60} minutes, or keeps <b>both enemy hallows</b> in its temple for ${CW.HALLOW_HOLD / 60}. A broken hold does not start again from nothing: its count drains away at a twelfth of the speed it grew, so a realm that keeps winning the fourth keep back gets there in the end; and a realm that holds three keeps, more than any other realm, builds its claim at two fifths of the pace (with three it never fades). If no realm has won after an hour, the elders give the March to the realm with the most <b>renown</b>: a point a minute for each keep held and two for each enemy hallow, five for each keep taken and ten for each hallow brought home.</p>
    <p>The winners share the spoils. After a short peace every keep and hallow goes back to its own realm and the next campaign begins. The realm left with a single keep fights back hardest, because its commander musters bigger warbands, faster; and from a quarter of an hour on the long war thins the garrisons, slows the mending of broken gates and swells every muster with veterans, so no campaign stalls for ever.</p>
    <div class="tide" role="table" aria-label="The campaign now"><span class="h" role="columnheader">Realm</span><span class="h c" role="columnheader">Renown</span><span class="h c" role="columnheader">Taken</span><span class="h w" role="columnheader">Claim on the March</span>${rows}</div>
    ${war3ChronHTML()}
    <p class="now">${now}</p>
    ${hist ? `<h3>Past campaigns</h3><ul class="plain">${hist}</ul>` : ''}`; // [war3] holding what you take (08k_war3.js)
}

/* ------------------------------------------------------------------ */
/* the maps                                                            */
/* ------------------------------------------------------------------ */
const CW_GLYPHS = {};
function cwGlyph(name) {
  if (CW_GLYPHS[name]) return CW_GLYPHS[name];
  const src = ICONS[name] || ICONS.circle, p = new Path2D();
  for (const m of src.matchAll(/<path d="([^"]+)"/g)) p.addPath(new Path2D(m[1]));
  for (const m of src.matchAll(/<circle cx="([\d.]+)" cy="([\d.]+)" r="([\d.]+)"/g)) { const c = new Path2D(); c.arc(+m[1], +m[2], +m[3], 0, TAU); p.addPath(c); }
  CW_GLYPHS[name] = p;
  return p;
}
// a round badge with an order's glyph
function cwBadge(ctx, x, y, s, glyph, col) {
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = 'rgba(14, 15, 18, 0.9)'; ctx.strokeStyle = col; ctx.lineWidth = Math.max(1.2, s * 0.16);
  ctx.beginPath(); ctx.arc(0, 0, s, 0, TAU); ctx.fill(); ctx.stroke();
  const k = (s * 1.3) / 24;
  ctx.scale(k, k); ctx.translate(-12, -12);
  ctx.strokeStyle = '#f6ead0'; ctx.lineWidth = 2.1; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.stroke(cwGlyph(glyph));
  ctx.restore();
}
// where a band is going, in world space
function cwTarget(wb) {
  const O = wb.order;
  if (!O) return null;
  if (O.type === 'attack' || O.type === 'defend' || O.type === 'garrison') return { x: O.keep.site.x, z: O.keep.site.z }; // [war3] garrison
  if (O.type === 'raid') return { x: O.temple.site.x, z: O.temple.site.z };
  if (O.type === 'carry') { const S = REALMS[wb.realm].templeSite; return { x: S.x, z: S.z }; }
  if (O.type === 'retrieve') { const p = relicPosition(O.relic); return { x: p.x, z: p.z }; }
  if (O.type === 'rally') { const P = GAME.player; return P ? { x: P.x, z: P.z } : null; }
  if (O.type === 'patrol') return { x: O.node.x, z: O.node.z };
  return null;
}
function cwRoute(wb) {
  const L = wbLeader(wb), T = cwTarget(wb);
  if (!L || !T) return null;
  const pts = [{ x: L.x, z: L.z }];
  if (wb.path) for (let i = Math.max(0, wb.pathIdx); i < wb.path.length; i++) { const n = NAV.nodes[wb.path[i]]; if (n) pts.push({ x: n.x, z: n.z }); }
  pts.push(T);
  return pts;
}
// can the player's realm see this band? its own always; others when near something of ours
function cwSpotted(wb, P) {
  if (wb.realm === P.faction) return true;
  if (!(wb._spotT > GAME.t)) {
    const L = wbLeader(wb);
    wb._spotT = GAME.t + 1;
    wb._spot = !!L && ENT.some((o) => o.alive && o.faction === P.faction && isActor(o) && dist2(o.x, o.z, L.x, L.z) < 70 * 70);
  }
  return wb._spot;
}
function cwArrowHead(ctx, ax, ay, bx, by, s) {
  const a = Math.atan2(by - ay, bx - ax);
  ctx.beginPath();
  ctx.moveTo(bx, by);
  ctx.lineTo(bx - Math.cos(a - 0.5) * s, by - Math.sin(a - 0.5) * s);
  ctx.lineTo(bx - Math.cos(a + 0.5) * s, by - Math.sin(a + 0.5) * s);
  ctx.closePath();
  ctx.fill();
}
// one band's route: a dashed line in its realm's colour, an arrowhead at the objective, a ring on it.
// u is one screen pixel in canvas units, f the size of it all (the minimap draws smaller)
function cwDrawRoute(ctx, wb, toPx, u, f, alpha, sel) {
  const pts = cwRoute(wb);
  if (!pts || pts.length < 2) return;
  const R = REALMS[wb.realm];
  const px = pts.map((p) => toPx(p.x, p.z));
  // the last leg ends short of the objective's ring
  const [tx, ty] = px[px.length - 1], [qx, qy] = px[px.length - 2];
  const dl = Math.hypot(tx - qx, ty - qy), ring = u * f * 10;
  const end = dl > ring ? [tx - ((tx - qx) * ring) / dl, ty - ((ty - qy) * ring) / dl] : [qx, qy];
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  const line = () => { ctx.beginPath(); ctx.moveTo(px[0][0], px[0][1]); for (let i = 1; i < px.length - 1; i++) ctx.lineTo(px[i][0], px[i][1]); ctx.lineTo(end[0], end[1]); };
  const lw = u * f * (sel ? 3.4 : 2.4);
  ctx.setLineDash([]); ctx.strokeStyle = 'rgba(8, 9, 11, 0.8)'; ctx.lineWidth = lw + u * 2.4; line(); ctx.stroke();
  ctx.setLineDash([u * f * 8, u * f * 5]); ctx.lineDashOffset = -renderTime * u * f * 14;
  ctx.strokeStyle = sel ? '#ffe7a8' : R.light; ctx.lineWidth = lw; line(); ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = sel ? '#ffe7a8' : R.light; ctx.strokeStyle = 'rgba(8, 9, 11, 0.85)'; ctx.lineWidth = u * 1.4;
  const pv = px.length > 2 ? px[px.length - 2] : px[0];
  cwArrowHead(ctx, pv[0], pv[1], end[0], end[1], u * f * 11);
  ctx.stroke();
  // the objective
  ctx.strokeStyle = 'rgba(8, 9, 11, 0.8)'; ctx.lineWidth = u * f * 4.4;
  ctx.beginPath(); ctx.arc(tx, ty, ring, 0, TAU); ctx.stroke();
  ctx.strokeStyle = sel ? '#ffe7a8' : R.light; ctx.lineWidth = u * f * 2.2;
  ctx.beginPath(); ctx.arc(tx, ty, ring, 0, TAU); ctx.stroke();
  ctx.restore();
}
function drawCampaignMap(ctx, S, P) {
  cwBindMap();
  const u = S / Math.max(1, $('mapcanvas').clientWidth || S), sc = u * 2.2;
  const toPx = (x, z) => w2m(x, z, S);
  const sel = CWUI.sel;
  const bands = WAR.warbands.filter((wb) => !wb.dead && wbLeader(wb) && cwSpotted(wb, P));
  // enemies first and fainter, then ours, the chosen band last and brightest
  bands.sort((a, b) => (a.realm === P.faction) - (b.realm === P.faction) || (a.id === sel) - (b.id === sel));
  for (const wb of bands) cwDrawRoute(ctx, wb, toPx, u, 1, wb.realm === P.faction ? 0.95 : 0.6, wb.id === sel);
  war3MapMarks(ctx, toPx, u, sc); // [war3] a keep pressed for, ringed (08k_war3.js)
  season2MapMarks(ctx, toPx, u, sc); // [season2] the season's pennants (08o_season2.js)
  for (const wb of bands) {
    const L = wbLeader(wb), [x, y] = toPx(L.x, L.z), R = REALMS[wb.realm];
    if (wb.id === sel) { ctx.strokeStyle = `rgba(255, 231, 168, ${0.6 + 0.4 * Math.sin(renderTime * 5)})`; ctx.lineWidth = sc * 0.6; ctx.beginPath(); ctx.arc(x, y, sc * 5.2, 0, TAU); ctx.stroke(); }
    const [g] = orderShort(wb);
    cwBadge(ctx, x, y - sc * 5, sc * 4, g, wb.order && wb.order.byPlayer ? '#ffe7a8' : R.color);
    if (wb.realm === P.faction) {
      ctx.font = `700 ${11 * u}px "Alegreya Sans", sans-serif`; ctx.textAlign = 'center';
      const t = WB_ORD[wbOrd(wb) - 1] || '';
      const at = look5BandNames(ctx, S, P).get(wb) || [x, y + sc * 5.6]; // [look5] laid out clear of each other's (13z_look5.js): two bands at one place wrote their names over each other
      ctx.fillStyle = 'rgba(0,0,0,0.8)'; ctx.fillText(t, at[0] + 1, at[1] + 1); ctx.fillStyle = '#f3e6c4'; ctx.fillText(t, at[0], at[1]);
    }
  }
  // the claim, across the top of the map
  const top = cwTopClaims()[0];
  let msg = null, col = '#dfc188';
  if (CAMPAIGN.state === 'peace') { const R = REALMS[CAMPAIGN.winner] || REALMS[0]; msg = `${R.name} has won the March · peace for ${fmtClock(CAMPAIGN.peaceUntil - GAME.t)}`; col = R.light; }
  else if (top && (top.on || top.slow)) { const R = REALMS[top.r]; msg = `${R.name} ${top.kind === 'keeps' ? `holds ${WAR.keeps.filter((K) => K.realm === top.r).length} keeps` : 'holds both enemy hallows'} · victory in ${fmtClock(top.left)}${top.slow ? ' at this pace' : ''}`; col = R.light; } // [war3] a claim built slowly on three keeps (08k_war3.js)
  if (msg) {
    ctx.font = `600 ${Math.max(S * 0.024, 13 * u)}px "Alegreya Sans", sans-serif`; ctx.textAlign = 'center';
    const w = ctx.measureText(msg).width + S * 0.04, h = S * 0.044;
    ctx.fillStyle = 'rgba(12, 13, 16, 0.86)'; ctx.strokeStyle = col; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.rect(S / 2 - w / 2, S * 0.018, w, h); ctx.fill(); ctx.stroke();
    ctx.fillStyle = col; ctx.fillText(msg, S / 2, S * 0.018 + h * 0.7);
    // a crown over every keep of the claim
    if (CAMPAIGN.state === 'war' && top.kind === 'keeps') for (const K of WAR.keeps) if (K.realm === top.r) { const [x, y] = toPx(K.site.x, K.site.z); cwBadge(ctx, x + sc * 5, y - sc * 5, sc * 3.4, 'crown', col); }
  }
}
function drawCampaignMinimap(ctx, toM, S, dpr) {
  const P = GAME.player;
  for (const wb of WAR.warbands) {
    if (wb.dead || !wb.order || !cwSpotted(wb, P)) continue;
    cwDrawRoute(ctx, wb, toM, dpr, 0.62, wb.realm === P.faction ? 0.9 : 0.55, wb.id === CWUI.sel);
    const L = wbLeader(wb);
    if (!L) continue;
    const [x, y] = toM(L.x, L.z);
    if (x < -10 || y < -10 || x > S + 10 || y > S + 10) continue;
    cwBadge(ctx, x, y - 7 * dpr, 4.6 * dpr, orderShort(wb)[0], REALMS[wb.realm].color);
  }
}
// the order over a band's captain
function campaignPlate(el, e) {
  const wb = e.warband;
  let html = '';
  if (wb && !wb.dead && e.alive && wbLeader(wb) === e && e.faction <= 2) {
    const [g, word, what] = orderShort(wb);
    html = `${iconSvg(g, 12)}<span>${wbName(wb, false)} · ${word}${what ? ' ' + esc(what) : ''}</span>`;
  }
  if (!el._cw) { el._cw = document.createElement('span'); el._cw.className = 'cw-o'; el.insertBefore(el._cw, el.firstChild); }
  if (el._cwh !== html) { el._cw.innerHTML = html; el._cwh = html; el._cw.style.display = html ? '' : 'none'; }
}

/* ------------------------------------------------------------------ */
/* the map's side panel: the campaign and the warbands                 */
/* ------------------------------------------------------------------ */
const CWUI = { sel: null, msg: '', key: '', mapT: 0, bound: false, vicShown: false };
function cwBandsOf(r) { return WAR.warbands.filter((wb) => !wb.dead && wb.realm === r && wbLeader(wb)).sort((a, b) => wbOrd(a) - wbOrd(b)); }
function campaignSideHTML() {
  const P = GAME.player;
  if (!P || !WAR.keeps.length) return '';
  const R = REALMS[P.faction];
  const claims = cwTopClaims();
  const standing = [0, 1, 2].sort((a, b) => CAMPAIGN.renown[b] - CAMPAIGN.renown[a]).map((r) => {
    const c = claims.find((q) => q.r === r && (q.on || q.slow)); // [war3] a slow claim on three keeps too (08k_war3.js)
    const k = WAR.keeps.filter((K) => K.realm === r).length, h = foreignHallows(r);
    return `<li style="--rc:${REALMS[r].color}"><i></i><b>${REALMS[r].name}</b><span>${k} keep${k === 1 ? '' : 's'}${h ? ` · ${h} hallow${h === 1 ? '' : 's'}` : ''} · ${Math.round(CAMPAIGN.renown[r])} renown${c ? `<br><em>wins in ${fmtClock(c.left)}${c.slow ? ' at this pace' : ''}</em>` : ''}</span></li>`;
  }).join('');
  const head = CAMPAIGN.state === 'peace'
    ? `<p class="cw-now"><b style="color:${REALMS[CAMPAIGN.winner].light}">${REALMS[CAMPAIGN.winner].name}</b> has won the March. The armies go home; the March resets in ${fmtClock(CAMPAIGN.peaceUntil - GAME.t)}.</p>`
    : `<p class="cw-rules">Hold <b>${CW.KEEPS} of the 6 keeps</b> for ${CW.KEEP_HOLD / 60} minutes, or <b>both enemy hallows</b> for ${CW.HALLOW_HOLD / 60}, and your realm wins the March (three keeps, more than any other realm, build the claim at two fifths of the pace). At one hour the realm with the most renown wins.</p>`;
  let cmd = '';
  const bands = cwBandsOf(P.faction);
  const can = cwCanCommand();
  const rows = bands.map((wb) => {
    const [g, word, what] = orderShort(wb);
    const n = wbMembers(wb).length;
    return `<button type="button" class="cw-band${wb.id === CWUI.sel ? ' sel' : ''}${wb.order && wb.order.byPlayer ? ' mine' : ''}" data-wb="${wb.id}"${can ? '' : ' disabled'}>${iconSvg(g, 16)}<span><b>${wbName(wb, false)}</b> <small>${n} soldiers</small><br>${word}${what ? ' ' + esc(what) : ''} · ${phaseWord(wb)}${wb.order && wb.order.byPlayer ? ' · <em>your order</em>' : ''}</span></button>`;
  }).join('') || `<p>No warbands of ${R.name} are in the field. More gather at the muster.</p>`;
  const wb = bands.find((w) => w.id === CWUI.sel);
  if (wb && can) {
    const ch = cwChoices(wb);
    cmd = `<div class="cw-cmds"><p>Orders for the <b>${wbName(wb, false)}</b>: pick a keep or temple on the map, or</p><div class="cw-grid">${ch.map(([c, t, label, shut]) => `<button type="button" class="btn cw-cmd${c === 'rally' ? ' wide' : ''}" data-cmd="${c}" data-t="${t}"${shut ? ' aria-disabled="true" title="Its gate is sealed while its realm holds both its keeps"' : ''}>${iconSvg(ORDER_GLYPH[c], 14)}${label}</button>`).join('')}${wb.order && wb.order.byPlayer ? `<button type="button" class="btn cw-cmd wide" data-cmd="release" data-t="-1">${iconSvg('lpatrol', 14)}Back to the commander</button>` : ''}</div></div>`;
  }
  const note = can ? (CWUI.sel ? '' : '<p class="cw-tip">Choose a warband to command it.</p>') : '<p class="cw-tip">From realm rank 3 or level 20 you can command these warbands from the map.</p>';
  const hist = CAMPAIGN.history.slice(-3).reverse().map((h) => `<li style="--rc:${REALMS[h.w].color}"><i></i><b>${ordinalWord(h.n).replace(/^./, (c) => c.toUpperCase())}</b><span>${REALMS[h.w].name}, ${h.how === 'keeps' ? 'by keeps' : h.how === 'hallows' ? 'by hallows' : 'by renown'}, ${h.m} min</span></li>`).join('');
  return `<div class="cw-side"><h4>Campaign ${CAMPAIGN.n}<span class="num">${CAMPAIGN.state === 'peace' ? 'peace' : fmtClock(campaignElapsed())}</span></h4>${head}<ul class="cw-stand">${standing}</ul>
    <h4>Warbands of ${R.name}</h4>${note}<div class="cw-bands">${rows}</div>${cmd}${CWUI.msg ? `<p class="cw-msg">${CWUI.msg}</p>` : ''}
    ${hist ? `<h4>Past campaigns</h4><ul class="cw-stand">${hist}</ul>` : ''}</div>`;
}
function cwRefreshSide(force = false) {
  const host = $('cw-side-host');
  if (!host) return;
  const html = campaignSideHTML();
  if (force || html !== CWUI.key) { host.innerHTML = html; CWUI.key = html; }
}
function cwIssue(cmd, t) {
  const wb = WAR.warbands.find((w) => w.id === CWUI.sel);
  if (!wb) { CWUI.msg = 'Choose one of your warbands first.'; return; }
  CWUI.msg = playerOrder(wb.id, cmd, t);
  if (cmd === 'release' || (wb.order && wb.order.byPlayer)) CWUI.sel = null;
}
function cwBindMap() {
  if (CWUI.bound) return;
  CWUI.bound = true;
  const ov = $('mapov');
  ov.addEventListener('click', (ev) => {
    const b = ev.target.closest('.cw-band');
    if (b && !b.disabled) { const id = +b.dataset.wb; CWUI.sel = CWUI.sel === id ? null : id; CWUI.msg = ''; sfx('click'); cwRefreshSide(true); drawWorldMap(true); return; }
    const c = ev.target.closest('.cw-cmd');
    if (c) {
      if (c.getAttribute('aria-disabled') === 'true') { CWUI.msg = c.title || ''; sfx('error'); }
      else cwIssue(c.dataset.cmd, +c.dataset.t);
      cwRefreshSide(true); drawWorldMap(true);
    }
  });
  // on the map itself: pick a band of ours, then a keep or temple for it
  $('mapcanvas').addEventListener('click', (ev) => {
    const P = GAME.player;
    if (!P || INDOOR.on || UI.modal !== 'map') return;
    const cv = $('mapcanvas'), rect = cv.getBoundingClientRect(), S = cv.width, k = S / Math.max(1, rect.width);
    const mx = (ev.clientX - rect.left) * k, my = (ev.clientY - rect.top) * k;
    const tol = Math.max(S * 0.03, 22 * k);
    const hit = (x, z) => { const [a, b] = w2m(x, z, S); return Math.hypot(a - mx, b - my); };
    let best = null, bd = tol;
    if (cwCanCommand()) for (const wb of cwBandsOf(P.faction)) { const L = wbLeader(wb), d = hit(L.x, L.z) * 0.8; if (d < bd) { bd = d; best = ['band', wb]; } }
    if (CWUI.sel) {
      for (const K of WAR.keeps) { const d = hit(K.site.x, K.site.z); if (d < bd) { bd = d; best = ['keep', K]; } }
      for (const T of WAR.temples) { const d = hit(T.site.x, T.site.z); if (d < bd) { bd = d; best = ['temple', T]; } }
    }
    if (!best) {
      if (!cwCanCommand()) { CWUI.msg = 'From realm rank 3 or level 20 you can command your warbands from this map.'; cwRefreshSide(true); }
      return;
    }
    if (best[0] === 'band') { CWUI.sel = CWUI.sel === best[1].id ? null : best[1].id; CWUI.msg = ''; sfx('click'); }
    else if (best[0] === 'keep') cwIssue(best[1].realm === P.faction ? 'defend' : 'attack', best[1].id);
    else if (best[1].realm === P.faction) CWUI.msg = 'That is our own temple. Choose a keep or an enemy temple.';
    else cwIssue('raid', best[1].id);
    cwRefreshSide(true);
    drawWorldMap(true);
  });
}

/* ------------------------------------------------------------------ */
/* the victory screen                                                  */
/* ------------------------------------------------------------------ */
function cwCrest(r) {
  const R = REALMS[r], dk = laShade(R.color, 0.55), lt = laShade(R.color, 1.25);
  return `<svg viewBox="0 0 160 180" class="cw-crest" aria-hidden="true">
    <defs><linearGradient id="cw-cg${r}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${lt}"/><stop offset="0.55" stop-color="${R.color}"/><stop offset="1" stop-color="${dk}"/></linearGradient>
    <radialGradient id="cw-glow"><stop offset="0" stop-color="#ffe7a8" stop-opacity="0.45"/><stop offset="1" stop-color="#ffe7a8" stop-opacity="0"/></radialGradient></defs>
    <circle cx="80" cy="84" r="78" fill="url(#cw-glow)"/>
    <path d="M18 22h124" stroke="#c9a36a" stroke-width="5" stroke-linecap="round"/><circle cx="16" cy="22" r="5" fill="#e3c487"/><circle cx="144" cy="22" r="5" fill="#e3c487"/>
    <path d="M32 24h96v100l-48 30-48-30z" fill="url(#cw-cg${r})" stroke="#ead6a6" stroke-width="3" stroke-linejoin="round"/>
    <path d="M40 30h80v90l-40 25-40-25z" fill="none" stroke="#ead6a6" stroke-opacity="0.45" stroke-width="1.5"/>
    <g transform="translate(50 46) scale(2.5)" fill="none" stroke="#f6ead0" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">${REALM_EMBLEM[r]}</g>
    <path d="M44 122l36 22 36-22" fill="none" stroke="#ead6a6" stroke-opacity="0.5" stroke-width="1.5"/>
  </svg>`;
}
function showVictory(rec) {
  const P = GAME.player;
  if (!P) return;
  let ov = $('cw-victory');
  if (!ov) {
    ov = document.createElement('div');
    ov.id = 'cw-victory';
    ov.className = 'overlay';
    ov.hidden = true;
    document.body.appendChild(ov);
    ov.addEventListener('click', (e) => { if (e.target === ov || e.target.closest('[data-cw="ok"]')) closeVictory(); });
    window.addEventListener('keydown', (e) => { if (UI.modal === 'victory' && (e.code === 'Escape' || e.code === 'Enter')) { e.preventDefault(); closeVictory(); } }, true);
  }
  const R = REALMS[rec.w], won = P.faction === rec.w;
  const how = rec.how === 'keeps' ? `In ${rec.m} minutes of war ${R.name} took the keeps of the March and held them until its claim was made, and no one could break its hold.`
    : rec.how === 'hallows' ? `In ${rec.m} minutes of war ${R.name} set both enemy hallows in the ${R.templeName} and kept them there for ${CW.HALLOW_HOLD / 60} minutes.`
      : `After an hour of war the elders called it for ${R.name}, whose banners had flown longest over the March.`;
  const rows = [0, 1, 2].map((r) => `<span class="r" style="--rc:${REALMS[r].color}"><i></i>${REALMS[r].name}</span><span>${rec.cap[r]}</span><span>${rec.hal[r]}</span><span>${rec.gates[r]}</span><span>${rec.ren[r]}</span>`).join('');
  const y = rec.you;
  const n = (k, one, many) => `${k} ${k === 1 ? one : many}`;
  const deeds = y && y.r === P.faction ? [
    y.cap && `were there when ${n(y.cap, 'keep', 'keeps')} fell to ${REALMS[P.faction].name}`, y.gates && `broke ${n(y.gates, 'gate', 'gates')}`,
    y.hal && `carried ${n(y.hal, 'hallow', 'hallows')} home`, y.kills && `slew ${n(y.kills, 'foe', 'foes')}`, y.orders && `gave ${n(y.orders, 'order', 'orders')} to the warbands`,
  ].filter(Boolean) : [];
  const part = deeds.length ? `You ${deeds.length > 1 ? deeds.slice(0, -1).join(', ') + ' and ' + deeds[deeds.length - 1] : deeds[0]}.` : 'You watched this campaign from afar. Break gates, take keeps and command the warbands in the next, and your deeds will be told here.';
  const rw = rec.reward;
  const reward = won && rw ? `<div class="cw-reward"><b>Your share of the spoils</b><span>${fmtInt(rw.rp)} realm points · ${fmtInt(rw.gold)} gold${rw.xp ? ` · ${fmtInt(rw.xp)} experience` : ''}</span><span style="color:${QUALITY[rw.q].col}">${esc(rw.item)}</span></div>` : `<div class="cw-reward lost"><b>${REALMS[P.faction].name} did not win this time.</b><span>Win the next campaign for a share of the spoils.</span></div>`;
  ov.innerHTML = `<div class="sheet panel cw-vic" role="dialog" aria-labelledby="cw-vic-title" style="--rc:${R.color};--rl:${R.light}">
    ${cwCrest(rec.w)}
    <small class="caps">The ${ordinalWord(rec.n)} campaign for the March</small>
    <h2 id="cw-vic-title">${won ? 'Victory! ' : ''}${R.name} wins the March</h2>
    <p class="lead">${how}</p>
    <div class="cw-table" role="table" aria-label="The campaign by realm"><span class="h">Realm</span><span class="h">Keeps taken</span><span class="h">Hallows home</span><span class="h">Gates lost</span><span class="h">Renown</span>${rows}</div>
    <h3>Your part</h3><p>${part}</p>
    ${reward}
    <p class="cw-next">The armies go home. After a short peace every keep and hallow returns to its own realm, and a new campaign begins.</p>
    <div class="actions"><button class="btn primary" type="button" data-cw="ok">Onward</button></div>
  </div>`;
  ov.hidden = false;
  UI.modal = 'victory';
  CWUI.vicShown = true;
}
function closeVictory() {
  const ov = $('cw-victory');
  if (ov) ov.hidden = true;
  if (UI.modal === 'victory') UI.modal = null;
}

/* ------------------------------------------------------------------ */
/* per frame                                                           */
/* ------------------------------------------------------------------ */
function updateCampaignUI(dt) {
  // the victory screen waits for any open window to close
  if (CAMPAIGN.pendingVictory && !UI.modal && GAME.player && GAME.player.alive) { const rec = CAMPAIGN.pendingVictory; CAMPAIGN.pendingVictory = null; showVictory(rec); }
  if (UI.modal === 'map' && !INDOOR.on) {
    CWUI.mapT -= dt;
    if (CWUI.mapT <= 0) { CWUI.mapT = 0.5; drawWorldMap(true); cwRefreshSide(); }
  } else if (UI.modal !== 'map') { CWUI.msg = ''; }
}

/* ------------------------------------------------------------------ */
/* styles                                                              */
/* ------------------------------------------------------------------ */
(function campaignStyle() {
  const st = document.createElement('style');
  st.id = 'cw-css';
  st.textContent = `
#war .cw-hud { display: grid; gap: 4px; border-top: 1px solid var(--line); padding-top: 5px; margin-top: 1px; }
#war .cw-h { display: flex; justify-content: space-between; gap: 6px; white-space: nowrap; font: 500 11.5px var(--caps); letter-spacing: 0.06em; color: var(--bronze-hi); }
#war .cw-h .num { color: var(--ink-dim); font-family: var(--ui); letter-spacing: 0; }
#war .cw-claim { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 2px 6px; font-size: 12px; color: var(--ink-dim); line-height: 1.2; }
#war .cw-claim b { color: var(--ink); font-weight: 700; }
#war .cw-claim.on .num { color: #ffe7a8; font-weight: 700; }
#war .cw-claim i { grid-column: 1 / -1; height: 4px; border-radius: 2px; background: rgba(0, 0, 0, 0.5); overflow: hidden; }
#war .cw-claim i b { display: block; height: 100%; background: var(--rc); box-shadow: 0 0 6px var(--rc); }
#war .cw-claim .w { grid-column: 1 / -1; }
#war .cw-rule { font-size: 11.5px; color: var(--ink-faint); line-height: 1.25; }
.np .cw-o { display: inline-flex; align-items: center; gap: 4px; padding: 1px 6px 1px 4px; border-radius: 3px; background: rgba(10, 11, 14, 0.72); border: 1px solid rgba(223, 193, 136, 0.35); font: 600 10.5px/1.2 var(--ui); color: #f3e6c4; text-shadow: 0 1px 2px #000; }
.np .cw-o svg { flex: none; color: #ffe7a8; }
#mapside .cw-side { display: grid; gap: 8px; }
#mapside .cw-side h4 { margin: 2px 0 0; display: flex; justify-content: space-between; font: 500 12px var(--caps); letter-spacing: 0.1em; text-transform: uppercase; color: var(--bronze-hi); }
#mapside .cw-side h4 .num { color: var(--ink-dim); letter-spacing: 0; }
#mapside .cw-side p { margin: 0; font-size: 12.5px; color: var(--ink-dim); line-height: 1.35; }
#mapside .cw-side p b { color: var(--ink); }
#mapside .cw-stand { display: grid; gap: 3px; }
#mapside .cw-stand li { display: flex; gap: 6px; align-items: baseline; justify-content: flex-start; font-size: 12.5px; }
#mapside .cw-stand li i { width: 9px; height: 9px; border-radius: 2px; background: var(--rc); align-self: center; flex: none; }
#mapside .cw-stand li b { flex: none; }
#mapside .cw-stand li span { color: var(--ink-dim); text-align: right; margin-left: auto; min-width: 0; }
#mapside .cw-stand li em { color: #ffe7a8; font-style: normal; font-weight: 700; }
#mapside .cw-bands { display: grid; gap: 4px; }
#mapside .cw-band { display: grid; grid-template-columns: 18px 1fr; gap: 7px; align-items: start; text-align: left; padding: 6px 8px; border-radius: 5px; border: 1px solid var(--line); background: rgba(0, 0, 0, 0.25); color: var(--ink); cursor: pointer; font-size: 12px; line-height: 1.3; min-height: 40px; }
#mapside .cw-band svg { color: var(--bronze-hi); margin-top: 2px; }
#mapside .cw-band small { color: var(--ink-faint); }
#mapside .cw-band em { color: #ffe7a8; font-style: normal; }
#mapside .cw-band[disabled] { cursor: default; opacity: 0.85; }
#mapside .cw-band.sel { border-color: #ffe7a8; background: rgba(223, 193, 136, 0.16); box-shadow: inset 0 0 0 1px rgba(255, 231, 168, 0.4); }
#mapside .cw-band.mine svg { color: #ffe7a8; }
#mapside .cw-cmds { display: grid; gap: 6px; padding: 8px; border-radius: 6px; background: rgba(0, 0, 0, 0.3); border: 1px solid var(--line-strong); }
#mapside .cw-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 5px; }
#mapside .cw-cmd { padding: 6px 7px; font-size: 11.5px; justify-content: flex-start; gap: 5px; line-height: 1.15; text-align: left; min-height: 34px; }
#mapside .cw-cmd.wide { grid-column: 1 / -1; justify-content: center; }
#mapside .cw-cmd[aria-disabled="true"] { opacity: 0.5; }
#mapside .cw-msg { color: #ffe7a8; font-size: 12.5px; }
#mapside .cw-tip { font-style: italic; }
#cw-victory { z-index: 35; }
#cw-victory .cw-vic { width: min(600px, 100%); text-align: center; justify-items: center; gap: 8px; padding: 16px 22px; border-color: var(--rc); box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.6), 0 0 60px color-mix(in srgb, var(--rc) 40%, transparent), 0 20px 50px rgba(0, 0, 0, 0.6); animation: cw-in 0.6s ease; }
#cw-victory .cw-crest { width: 84px; height: 95px; margin: -4px 0 -6px; filter: drop-shadow(0 6px 12px rgba(0, 0, 0, 0.5)); animation: cw-sway 4s ease-in-out infinite alternate; transform-origin: 50% 10%; }
#cw-victory small { color: var(--ink-dim); font-size: 12px; letter-spacing: 0.12em; text-transform: uppercase; }
#cw-victory h2 { font-size: 32px; color: var(--rl); text-shadow: 0 2px 14px color-mix(in srgb, var(--rc) 55%, transparent); }
#cw-victory .lead { color: var(--ink); font-size: 15px; max-width: 46ch; }
#cw-victory .cw-table { display: grid; grid-template-columns: 1.3fr repeat(4, 1fr); gap: 4px 10px; width: 100%; font-size: 13.5px; font-variant-numeric: tabular-nums; padding: 8px 10px; border-radius: 6px; background: rgba(0, 0, 0, 0.3); border: 1px solid var(--line); }
#cw-victory .cw-table .h { font: 500 11px var(--caps); letter-spacing: 0.06em; color: var(--bronze-hi); text-transform: uppercase; }
#cw-victory .cw-table .r { display: flex; gap: 6px; align-items: center; text-align: left; font-weight: 700; }
#cw-victory .cw-table .r i { width: 10px; height: 10px; border-radius: 2px; background: var(--rc); }
#cw-victory .cw-reward { display: grid; gap: 3px; padding: 10px 14px; border-radius: 6px; background: linear-gradient(rgba(223, 193, 136, 0.16), rgba(223, 193, 136, 0.06)); border: 1px solid var(--line-strong); width: 100%; }
#cw-victory .cw-reward b { color: var(--bronze-hi); font: 500 13px var(--caps); letter-spacing: 0.08em; text-transform: uppercase; }
#cw-victory .cw-reward.lost { background: rgba(0, 0, 0, 0.25); }
#cw-victory .cw-next { font-size: 13px; }
#cw-victory .actions { justify-content: center; }
@keyframes cw-in { from { opacity: 0; transform: translateY(14px) scale(0.98); } }
@keyframes cw-sway { from { transform: rotate(-1.6deg); } to { transform: rotate(1.6deg); } }
@media (max-width: 760px), (pointer: coarse) {
  #war .cw-claim { font-size: 10.5px; }
  #war .cw-h { font-size: 10.5px; }
  #war .cw-rule { font-size: 10px; }
  #cw-victory .cw-vic { padding: 14px; gap: 8px; }
  #cw-victory .cw-crest { width: 70px; height: 79px; }
  #cw-victory h2 { font-size: 26px; }
  #cw-victory .lead { font-size: 13.5px; }
  #cw-victory .cw-table { font-size: 12px; gap: 3px 6px; grid-template-columns: 1.2fr repeat(4, 1fr); }
  #cw-victory .cw-table .h { font-size: 9.5px; letter-spacing: 0.02em; }
  .np .cw-o { font-size: 9.5px; }
}
/* short screens: a smaller crest so the whole story and its button fit */
@media (max-height: 640px) {
  #cw-victory .cw-vic { gap: 6px; padding: 12px 18px; }
  #cw-victory .cw-crest { width: 54px; height: 61px; }
  #cw-victory h2 { font-size: 26px; }
  #cw-victory .lead { font-size: 13.5px; }
  #cw-victory .cw-table { padding: 6px 10px; gap: 2px 10px; }
  #cw-victory .cw-next { display: none; }
}
/* a phone on its side: the map and its panel side by side, so the orders can be reached */
@media (orientation: landscape) and (max-height: 520px) {
  #mapov .mapbox { grid-template-columns: auto minmax(0, 1fr) !important; width: 100%; }
  #mapcanvas { width: min(86vh, 52vw) !important; height: min(86vh, 52vw) !important; }
  #mapside { max-height: 86vh !important; }
}
@media (prefers-reduced-motion: reduce) { #cw-victory .cw-crest, #cw-victory .cw-vic { animation: none !important; } }
`;
  (document.body || document.documentElement).appendChild(st);
})();
Object.assign(ICONS, {
  crown: '<path d="M3.5 18h17l1-10-5.2 4.2L12 5l-4.3 7.2L2.5 8z"/><path d="M4.5 21h15"/>',
});

/* ------------------------------------------------------------------ */
/* test hooks: window.__hm.CW                                          */
/* ------------------------------------------------------------------ */
queueMicrotask(() => {
  if (!window.__hm) return;
  window.__hm.CW = {
    hud() { updateWarPanel(); return document.querySelector('#war .cw-hud')?.textContent || ''; },
    CAMPAIGN, CW, CWUI, planWar, playerOrder, campaignVictory, resetMarch, cwCanCommand, wbName, orderShort, orderPhrase, campaignSaveData, applyCampaignSave, cwTopClaims, showVictory, closeVictory,
    bands(r) { return WAR.warbands.filter((w) => !w.dead && (r === undefined || w.realm === r)).map((w) => { const L = wbLeader(w); const [, word, what] = orderShort(w); return { id: w.id, realm: w.realm, name: wbName(w), n: wbMembers(w).length, order: word, what, why: w.order ? w.order.why || '' : '', phase: w.order ? w.order.phase || '' : '', mine: !!(w.order && w.order.byPlayer), x: L ? Math.round(L.x) : null, z: L ? Math.round(L.z) : null }; }); },
    state() { return { n: CAMPAIGN.n, state: CAMPAIGN.state, el: Math.round(campaignElapsed()), winner: CAMPAIGN.winner, how: CAMPAIGN.how, claims: CAMPAIGN.claims.map((c) => ({ k: Math.round(c.k), h: Math.round(c.h), kOn: c.kOn, hOn: c.hOn })), renown: CAMPAIGN.renown.map((v) => Math.round(v)), keeps: [0, 1, 2].map((r) => WAR.keeps.filter((K) => K.realm === r).length), hallows: [0, 1, 2].map(foreignHallows), story: JSON.parse(JSON.stringify(CAMPAIGN.story)), history: CAMPAIGN.history.length, peaceLeft: CAMPAIGN.state === 'peace' ? Math.round(CAMPAIGN.peaceUntil - GAME.t) : 0 }; },
  };
});
