/* ================================================================== */
/* the callings: what each class does beyond its eight abilities       */
/*   Warrior  stances (guarded, balanced, fury), momentum and          */
/*            finishers, the raised shield and the timed parry,        */
/*            weapon styles (the sword bleeds, the axe sunders, the    */
/*            mace staggers)                                           */
/*   Archer   the draw (hold to draw, release to loose: power, a true  */
/*            arc under gravity and a little wind), arrows kept as     */
/*            goods, hiding in long grass and woods, snares, tracking  */
/*   Mage     fire, frost and storm: attunement, focus, the combos     */
/*            (shatter, steam, overload, quench, conduct), ice on      */
/*            water, steam, runes, overcasting                         */
/*   Priest   devotion (healing, prayer, holy acts), holy ground,      */
/*            blessings, smite against the dead, raising the fallen,   */
/*            the strength of temples and hallows                      */
/* Every realm gives each calling its own flavour (CLASS_REALM), and    */
/* the depth unlocks with level (CLASS_UNLOCK). The NPCs of every       */
/* calling use all of it (classNpc, updateClasses).                     */
/* Hooks: dealDamage asks classHarm and tells classOnHit; executeAbility*/
/* asks classAbility for this cast's view of an ability; effectiveSpeed */
/* asks classSpeedMult; animActValue asks classActValue; autoAttack     */
/* asks classNoAuto and classAutoKind; healEnt tells classOnHeal;       */
/* npcAbilities asks classNpc; simStep runs updateClasses, tick runs    */
/* drawClasses (05j_classfx.js) and the HUD (10d_classes_ui.js).        */
/* ================================================================== */
const CLASS_UNLOCK = {
  warrior: { block: 1, momentum: 3, stances: 5, realm: 10 },
  archer: { draw: 1, arrows: 4, hide: 6, snare: 8, realm: 10, track: 12 },
  mage: { attune: 1, focus: 4, storm: 6, overcast: 8, realm: 10 },
  priest: { devotion: 1, pray: 1, consecrate: 5, bless: 8, realm: 10, raise: 16 },
};
const clsHas = (e, key) => !!e && !!e.cls && CLASS_UNLOCK[e.cls] && CLASS_UNLOCK[e.cls][key] !== undefined && e.level >= CLASS_UNLOCK[e.cls][key];
const STANCES = [
  { id: 'guarded', name: 'Guarded', out: 0.9, taken: 0.75, icon: 'shield', text: 'Take 25% less harm and deal 10% less. Your shield covers a wider arc, a raised guard costs no endurance, Shield Bash stuns half a second longer and Bulwark lasts three more.' },
  { id: 'balanced', name: 'Balanced', out: 1, taken: 1, icon: 'sword', text: 'No gain and no cost. Momentum fades more slowly and Rallying Cry heals 35%.' },
  { id: 'fury', name: 'Fury', out: 1.15, taken: 1.12, icon: 'flame', text: 'Deal 15% more harm and take 12% more. You swing faster, shrug off much of any slow, Cleave and Whirlwind cut deeper and Rallying Cry adds 25% damage.' },
];
const MOM_MAX = 5, FIN_MIN = 3, PARRY_WIN = 0.3, PARRY_REARM = 0.5;
const ELEMENTS = ['fire', 'frost', 'storm'];
const ELEM_COL = { fire: [2.4, 1.0, 0.3], frost: [0.6, 1.25, 2.4], storm: [1.1, 1.45, 2.8] };
const ELEM_OF = { firebolt: 'fire', meteor: 'fire', frost: 'frost', blizzard: 'frost', chain: 'storm' };
const ARROW_TYPES = ['plain', 'broadhead', 'bodkin', 'fire', 'blunt'];
const ARROW_DEF = {
  plain: { name: 'Plain arrows', short: 'Plain', good: null, col: '#d8cdb4', text: 'Ordinary shafts. You never run out.' },
  broadhead: { name: 'Broadhead arrows', short: 'Broadhead', good: 'arrows_broadhead', col: '#e07a5a', text: 'Wide hunting heads: a fifth more harm to beasts and the unarmoured, and they open a bleeding wound that mends slowly: healing on it takes 40% less for 6 s.' }, // [balance2]
  bodkin: { name: 'Bodkin arrows', short: 'Bodkin', good: 'arrows_bodkin', col: '#b9c4d6', text: 'Needle points that go through mail: armour does not stop them, and they strike warriors harder.' },
  fire: { name: 'Fire arrows', short: 'Fire', good: 'arrows_fire', col: '#ff9a3a', text: 'Pitch-soaked heads, lit as they are loosed: the foe burns and dry grass catches. Rain and wet foes damp them.' },
  blunt: { name: 'Blunt arrows', short: 'Blunt', good: 'arrows_blunt', col: '#c8b48a', text: 'Heavy blunt heads: less harm, but they knock a foe back, break its spell and shatter bone and ice.' },
};
// how each realm's people practise each calling
const CLASS_REALM = {
  warrior: [
    { name: 'Knightly discipline', text: 'Your parry window is 40% wider, and in the guarded stance your shield covers you from every side and you take 30% less harm.' },
    { name: "Champion's feats", text: 'A finisher at full momentum becomes a feat: a whirling cut at every foe around you. Charge and Leap Strike build two momentum.' },
    { name: 'Berserk', text: 'In fury you strike up to 18% harder as your wounds deepen, your momentum never fades, and every finisher heals you 3% for each point spent.' },
  ],
  archer: [
    { name: 'Longbow drill', text: 'You reach full draw a quarter sooner, and drawn shots from a wall or a tower strike 20% harder.' },
    { name: 'Woodcraft', text: 'You hide in half the time and stay hidden while you walk; a shot from hiding strikes 80% harder instead of 50%.' },
    { name: 'Snow-hunting', text: 'The wind does not move your arrows, your snares freeze what they catch, and you strike chilled and frozen foes 15% harder.' },
  ],
  mage: [
    { name: 'Court wardcraft', text: 'Your wards are a quarter stronger and also shield every ally within 8 m for half as much.' },
    { name: 'Weather-calling', text: 'In rain or storm your storm spells strike 25% harder and Chain Lightning calls a real bolt down on its first foe. Frost chills wet foes twice over, and brambles break through your frost nova to hold foes a second longer.' },
    { name: 'Rune magic', text: 'Every Blink lays a rune of your focus where you stood, and Blizzard leaves a frost rune behind: runes burst when a foe steps on them.' },
  ],
  priest: [
    { name: 'The Shield of Logres', text: 'Your blessing makes allies take 12% less harm, and allies on your holy ground take 10% less.' },
    { name: 'The Well of Ériu', text: 'Your blessing heals 1.5% a second and frees allies from snares and roots; your holy ground heals half again as much.' },
    { name: 'The Hearth of Thule', text: 'Your blessing makes allies strike 12% harder, and your holy ground burns every foe on it, not only the dead.' },
  ],
};
const UNDEAD = new Set(['skeleton', 'draugr']);
const isUndead = (e) => !!e && (UNDEAD.has(e.mobType) || e.role === 'dungeonBoss' || e.dunPack != null || e.mobType === 'wisp');
const CLS = { arrows: [], stuck: [], snares: [], grounds: [], runes: [], ice: [], steam: [], frozen: new Set(), hold: false, holdSrc: null, lastPara: 0, stats: { parries: 0, blocks: 0, finishers: 0, combos: {}, ambush: 0, snared: 0, raised: 0, consecrated: 0, ice: 0, steam: 0, runes: 0, drawn: 0 } };

/* ------------------------------------------------------------------ */
/* the state a body carries for its calling                            */
/* ------------------------------------------------------------------ */
function csOf(e) {
  if (e.cs) return e.cs;
  e.cs = {
    stance: 1, stanceAt: -9, mom: 0, momAt: -99, fin: null,
    blockOn: false, blockAt: -9, blockDown: -9, guard: 100, npcBlockUntil: 0,
    att: { fire: 0, frost: 0, storm: 0 }, attAt: { fire: -99, frost: -99, storm: -99 }, focus: 'fire', last: null, spentUntil: 0,
    dev: 0, devAt: -99, prayT: 0, praying: false,
    drawFrom: -1, drawK: 0, arrow: 'plain', cover: 0, hideT: 0, hidden: false, hideBreak: 0, npcDraw: null,
    lastLevel: e.level,
  };
  // NPCs come to the field with a few habits of their own
  if (e.role !== 'player') {
    if (e.cls === 'mage') e.cs.focus = pick(Math.random, ['fire', 'frost', e.level >= 6 ? 'storm' : 'fire']);
    if (e.cls === 'priest') { e.cs.dev = e.role === 'bot' && B9T.botNoDevotion ? 0 : 20 + Math.random() * 30; if (B7T.npcDevotion && e.role !== 'bot') e.cs.devAt = GAME.t; } // [balance9] a bot comes with none at any hour (its 20 to 50 faded at its first look by 0.8 a second of the run's clock: a priest bot made in a page's first minute kept most of it, 07c_balance9.js) // [balance8] the war's priests, not the bots that measure the callings (07c_balance8.js) // [balance7] its devotion from the moment it comes (devAt -99: the first look faded it all away) (07c_balance7.js)
  }
  return e.cs;
}
const nowT = () => GAME.t;
function weaponStyle(e) {
  if (e === GAME.player && INV.eq && INV.eq.weapon && ['sword', 'axe', 'mace'].includes(INV.eq.weapon.vis)) return INV.eq.weapon.vis;
  const m = e.look ? e.look.mask : 0;
  return m & WB.axe ? 'axe' : m & WB.mace ? 'mace' : 'sword';
}
const hasShield = (e) => !!e.look && !!(e.look.mask & (WB.shield | WB.shieldRound));
const realmFlavour = (e) => clsHas(e, 'realm') && e.faction <= 2 && !e.plainCalling; // [balance4] tests measure a realm's way against the plain calling (duels.py kind=flavour)
// lakes, ponds and rivers: the water module (01b_water.js)
const waterFn = () => waterAt;
// the height of the water's surface at (x, z), or the lakes' level where there is none
function waterTopAt(x, z) { const q = waterAt(x, z); return q ? q.y : WATER_Y; }
function wetOf(e) {
  if (!e) return 0;
  let w = e.wet || 0;
  if (!inDungeon(e) && heightAt(e.x, e.z) < WATER_Y - 0.2 && e.y < WATER_Y + 0.3) w = 1;
  const wf = waterFn();
  if (wf && !inDungeon(e)) { try { const q = wf(e.x, e.z); if (q && (q === true || q.depth > 0.2 || q.deep)) w = 1; } catch (err) { /* the water module answers in its own way */ } }
  return w;
}
const rainHere = (e) => (inDungeon(e) || INDOOR.on && e === GAME.player ? 0 : clamp(WEATHER.raining - WEATHER.snowing, 0, 1) * (e._sky === undefined ? 1 : e._sky));
const stormNow = () => clamp(WEATHER.storm || 0, 0, 1);
function chillOf(e) { let v = 0; for (const b of e.buffs) if (b.kind === 'chill' && b.until > GAME.t) v = Math.max(v, b.value); return v; }
const frozenOf = (e) => hasBuff(e, 'frozen');
const burningOf = (e) => e.buffs.some((b) => b.kind === 'burn' && b.until > GAME.t);
function dropBuffs(e, kinds) { e.buffs = e.buffs.filter((b) => !kinds.includes(b.kind)); }

/* ---- momentum (warriors), devotion (priests), attunement (mages): values that fade when unused ---- */
function momOf(e) {
  const cs = csOf(e), t = nowT();
  const hold = cs.stance === 1 ? 9 : 6;
  if (cs.mom > 0 && t - cs.momAt > hold && !(realmFlavour(e) && e.faction === 2 && cs.stance === 2)) {
    cs.mom = Math.max(0, cs.mom - (t - Math.max(cs.momAt + hold, cs.momTick || 0)) * 0.6);
    cs.momTick = t;
  }
  return cs.mom;
}
function addMom(e, n) {
  if (!clsHas(e, 'momentum')) return;
  const cs = csOf(e);
  momOf(e);
  const before = Math.floor(cs.mom);
  cs.mom = Math.min(MOM_MAX, cs.mom + n);
  cs.momAt = nowT(); cs.momTick = cs.momAt;
  if (e === GAME.player && before < FIN_MIN && cs.mom >= FIN_MIN) classCue('finisher');
}
function devOf(e) {
  const cs = csOf(e), t = nowT();
  if (cs.dev > 0 && t - cs.devAt > 18 && !cs.praying) { cs.dev = Math.max(0, cs.dev - (t - Math.max(cs.devAt + 18, cs.devTick || 0)) * 0.8); cs.devTick = t; }
  return cs.dev;
}
function addDev(e, n) {
  if (e.cls !== 'priest' || !(n > 0)) return;
  const cs = csOf(e);
  devOf(e);
  cs.dev = Math.min(100, cs.dev + n * (sanctified(e) ? 2 : 1));
  cs.devAt = nowT(); cs.devTick = cs.devAt;
}
function attOf(e, el) {
  const cs = csOf(e), t = nowT();
  const a = cs.att[el];
  if (a > 0 && t - cs.attAt[el] > 5) { cs.att[el] = Math.max(0, a - (t - Math.max(cs.attAt[el] + 5, cs.attTick && cs.attTick[el] || 0)) * 6); (cs.attTick || (cs.attTick = {}))[el] = t; }
  return cs.att[el];
}
function attune(e, el, gain) {
  const cs = csOf(e);
  for (const k of ELEMENTS) attOf(e, k);
  cs.att[el] = Math.min(100, cs.att[el] + gain);
  cs.attAt[el] = nowT(); (cs.attTick || (cs.attTick = {}))[el] = cs.attAt[el];
  if (cs.last && cs.last !== el) { cs.prev = cs.last; cs.prevAtt = cs.att[cs.last]; cs.switchAt = nowT(); }
  for (const k of ELEMENTS) if (k !== el) cs.att[k] = Math.max(0, cs.att[k] - gain * 0.45);
  cs.last = el;
}
// a mage's own bolt charges its element a little and switches nothing
function attuneQuiet(e, el, gain) { const cs = csOf(e); attOf(e, el); cs.att[el] = Math.min(100, cs.att[el] + gain); cs.attAt[el] = nowT(); (cs.attTick || (cs.attTick = {}))[el] = cs.attAt[el]; }
// a priest at their realm's temple, or near a hallow their realm holds, is sanctified
function sanctified(e) {
  if (!e || e.faction > 2 || inDungeon(e)) return false;
  const cs = csOf(e);
  if (cs.sancT !== undefined && GAME.t < cs.sancT) return cs.sanc;
  cs.sancT = GAME.t + 1;
  const R = REALMS[e.faction];
  let s = !!R.templeSite && dist2(e.x, e.z, R.templeSite.x, R.templeSite.z) < 42 * 42;
  if (!s && WAR.relics) for (const rel of WAR.relics) { if ((rel.state === 'temple' && rel.at === e.faction) || rel.realm === e.faction && rel.state !== 'carried') { const p = relicPosition(rel); if (p && dist2(e.x, e.z, p.x, p.z) < 30 * 30) { s = true; break; } } }
  cs.sanc = s;
  return s;
}

/* ------------------------------------------------------------------ */
/* harm: what the callings do to a blow on its way in                  */
/* ------------------------------------------------------------------ */
function classHarm(src, dst, amount, opts) {
  if (!dst || dst.kind === 'door') return amount * (src && src.cls === 'warrior' && src.cs ? STANCES[src.cs.stance].out : 1);
  let m = 1;
  const t = nowT();
  // a steam-blinded attacker swings at shadows
  if (src && !opts.dot && hasBuff(src, 'blind') && Math.random() < 0.3) { if (src === GAME.player || dst === GAME.player) uiFloatAt(dst.x, dst.y + 2.2 * (dst.scale || 1), dst.z, 'Miss', 'miss'); return 0; }
  if (dazzleMiss(src, dst, opts)) return 0; // [balance3] a foe dazzled by holy light misses one weapon blow in four (07c_balance3.js)
  // the attacker's calling
  if (src && src !== dst && src.cs) {
    const cs = src.cs;
    if (src.cls === 'warrior') {
      m *= STANCES[cs.stance].out;
      if (cs.stance === 2 && realmFlavour(src) && src.faction === 2) m *= 1 + Math.min(0.18, 0.02 * Math.floor((1 - src.hp / src.maxHp) * 10));
    }
    if (src.cls === 'archer') {
      if (cs.hidden && !opts.dot) {
        m *= archerAmbushK(src); // [balance5] 1.8 (07c_balance5.js) [balance7] Eriu's among trees (07c_balance7.js)
        opts.crit = true;
        breakHiding(src, 4);
        CLS.stats.ambush++;
        if (src === GAME.player) uiFloatAt(dst.x, dst.y + 2.5 * (dst.scale || 1), dst.z, 'Ambush!', 'crit');
      }
      if (realmFlavour(src) && src.faction === 2 && (chillOf(dst) > 0 || frozenOf(dst))) m *= ARCHER_REALM.thuleChill; // [balance5] 1.15
      if (dst.buffs.some((b) => b.kind === 'tracked' && b.src === src.id && b.until > t)) m *= 1.1;
    }
    if (src.cls === 'priest' && isUndead(dst) && (opts.kind === 'holy' || opts.holy)) m *= lordHolyK(dst); // [balance9] 1.6, but not on the deep's lord: his ash crown turns it (07c_balance9.js)
    // blessings
    for (const b of src.buffs) if (b.kind === 'bless' && b.until > t && b.value === 2) { m *= PRIEST_REALM.thuleBless; break; } // [balance4] 1.12 (07c_balance4.js)
  }
  // the target's state: sundered armour, a stagger
  const sun = buffMax(dst, 'sunder');
  if (sun) m *= 1 + 0.05 * sun;
  if (hasBuff(dst, 'stagger')) m *= 1.2;
  if (opts.arrow && src) m *= arrowHarm(src, dst, opts);
  else if (src && src.cls === 'archer' && opts.kind === 'arrow') m *= plainArrowK(src); // [balance7] a seasoned archer's own shafts (07c_balance7.js)
  // the elements meet the world and each other
  const el = opts.elem || (opts.kind === 'fire' || opts.kind === 'ember' ? 'fire' : opts.kind === 'frost' || opts.kind === 'ice' || opts.kind === 'rime' ? 'frost' : opts.kind === 'shock' || opts.kind === 'spark' ? 'storm' : null);
  if (el && src && !opts.noReact) m *= elementReact(src, dst, el, opts);
  else if (src && !opts.dot && !opts.auto && frozenOf(dst) && (opts.kind === 'melee' || opts.kind === 'arrow')) m *= shatter(src, dst, 1.6, opts);
  // the defender's calling: an archer's light feet, a warrior's stance and shield, wards
  if (dst.cls === 'archer' && opts.kind === 'melee' && !opts.dot && src && src !== dst && !isStunned(dst) && Math.random() < B7T.lightFeet) { // [balance7] 0.15 (07c_balance7.js)
    if (dst === GAME.player || src === GAME.player) uiFloatAt(dst.x, dst.y + 2.2 * (dst.scale || 1), dst.z, 'Dodged', 'miss');
    return 0;
  }
  if (dst.cs && dst.cls === 'warrior') {
    const cs = dst.cs;
    m *= STANCES[cs.stance].taken * (cs.stance === 0 && realmFlavour(dst) && dst.faction === 0 ? 0.93 : 1);
    if (cs.blockOn && !opts.dot && opts.kind !== 'holy' /* [balance2] holy light falls from above: a shield does not turn it */ && !(opts.kind === 'aoe' && src && src.cls === 'archer') /* [balance4] nor does a volley */ && src && src !== dst && blockFaces(dst, src)) {
      const melee = opts.kind === 'melee';
      if (melee && t - cs.blockAt <= parryWindow(dst) && !dazzled(dst)) { parry(dst, src); return 0; } // [balance3] not while dazzled by holy light
      const k = melee || opts.kind === 'arrow' ? (cs.stance === 0 ? 0.2 : 0.3) : 0.6;
      m *= k;
      blockHit(dst, src, amount * m);
    } else if (!cs.blockOn && !opts.dot && src && src !== dst && (opts.kind === 'melee' || opts.kind === 'arrow') && clsHas(dst, 'block') && hasShield(dst) && !isStunned(dst) && blockFaces(dst, src) && Math.random() < 0.12) {
      // [balance] a shield on the arm turns a blow now and then, raised or not
      m *= 0.45;
      CLS.stats.blocks++;
      if (dst === GAME.player || src === GAME.player) uiFloatAt(dst.x, dst.y + 2.2 * (dst.scale || 1), dst.z, 'Blocked', 'miss');
    }
  }
  for (const b of dst.buffs) {
    if (b.until <= t) continue;
    if (b.kind === 'bless' && b.value === 0) m *= PRIEST_REALM.logresBless; // [balance4] 0.88 (07c_balance4.js)
    if (b.kind === 'hallowed') m *= PRIEST_REALM.logresGround; // [balance4] 0.9
    if (b.kind === 'eward' && src && src !== dst && opts.kind === 'melee' && !opts.dot && !opts.reflect) wardBite(dst, src, b);
  }
  return amount * m;
}
// the elements: fire, frost and storm against wet, chilled, frozen and burning bodies
function elementReact(src, dst, el, opts) {
  let m = 1;
  const wet = wetOf(dst), auto = !!opts.auto, mage = src.cls === 'mage';
  // a well-timed switch rings louder: the charge of the element the mage turned from feeds the combo
  const scs = mage ? csOf(src) : null;
  const res = mage && scs.prev && scs.prev !== el && nowT() - (scs.switchAt || -9) < 4 ? 1 + 0.5 * (scs.prevAtt || 0) / 100 : 1;
  if (el === 'fire') {
    if (frozenOf(dst) || chillOf(dst) > 0) {
      if (!auto) { m *= (frozenOf(dst) ? 1.7 : 1.35) * res; /* [balance2] 1.8 and 1.45 */ combo(src, dst, 'steam'); dropBuffs(dst, ['chill', 'frozen']); unfreeze(dst); steamAt(dst.x, dst.z, 4, src); dst.wet = Math.max(dst.wet || 0, 0.7); return m; }
    }
    if (wet > 0.3) { m *= 0.75; dst.wet = Math.max(0, (dst.wet || 0) - 0.3); if (Math.random() < 0.5) steamPuff(dst.x, dst.y + 1.2 * (dst.scale || 1), dst.z, 4); }
    m *= 1 - 0.3 * rainHere(dst);
    if (mage && !auto && !opts.dot && opts.kind === 'fire' && dst.alive && wet < 0.6) {
      const r = computeDamage(src, dst, 0.25 * (attOf(src, 'fire') >= 60 ? 1.25 : 1)); // [balance] 0.32 [balance2] attuned 1.25 (1.5)
      addBuff(dst, 'burn', r.d / 4, 4, src.id);
    }
  } else if (el === 'frost') {
    if (burningOf(dst)) { if (!auto) { m *= 1.4; combo(src, dst, 'quench'); } dropBuffs(dst, ['burn']); steamPuff(dst.x, dst.y + 1.2 * (dst.scale || 1), dst.z, 8); }
    if (WEATHER.snowing > 0.3 && !inDungeon(dst)) m *= 1.12;
    let n = auto ? 0.34 : 1;
    if (mage && attOf(src, 'frost') >= 60 && !auto) n += 1;
    if (wet > 0.3 && realmFlavour(src) && src.faction === 1 && mage) n *= 2;
    if (opts.chill) n += opts.chill;
    if (!opts.dot) addChill(dst, n, src);
    if (dst.wet !== undefined && wet > 0.3) dst.snow = Math.min(1, (dst.snow || 0) + 0.15);
  } else if (el === 'storm') {
    if (frozenOf(dst) && !auto) m *= shatter(src, dst, 2.0 * res, opts);
    else if (burningOf(dst) && !auto && mage) { m *= 1.3 * res; overload(src, dst); }
    if (wet > 0.3) { m *= 1.35; if (!auto) CLS.stats.combos.conduct = (CLS.stats.combos.conduct || 0) + 1; }
    if (stormNow() > 0.5 && !inDungeon(dst)) m *= 1.25;
    else if (realmFlavour(src) && src.faction === 1 && rainHere(src) > 0.2) m *= 1.25;
    if (dst.casting && Math.random() < 0.6 && dst.role !== 'boss') breakCast(dst); // [balance2] a steadfast priest's spell holds (07c_balance.js)
  }
  return m;
}
function addChill(e, n, src) {
  if (!e.alive || e.kind === 'door' || e.flying) return;
  const cur = chillOf(e) + n;
  // a body just thawed cannot be frozen again at once
  // [balance] players and champions: a freeze is a stun under the diminishing returns (07c_balance.js); others thaw
  // with five seconds before ice can take them again
  const champ = ccChampion(e);
  const boss = e.role === 'boss' || e.role === 'dungeonBoss' || (!champ && GAME.t < (e._thawUntil || 0)) || ccFactor(e, 'stun') === 0;
  if (cur >= 3 && !boss && !frozenOf(e)) {
    dropBuffs(e, ['chill']);
    let dur = e.role === 'player' ? 1.5 : e.elite ? 1.2 : 1.4;
    if (champ) { dur = ccAdjust(e, 'stun', dur, 'frozen', true); if (!(dur > 0)) { addBuff(e, 'chill', 2, 6, 'chill'); return; } }
    e._thawUntil = GAME.t + dur + 5;
    addBuff(e, 'frozen', 1, dur, 'frozen');
    addBuff(e, 'stun', 1, dur, 'frozen');
    e.casting = null;
    e.snow = Math.max(e.snow || 0, 0.85);
    CLS.frozen.add(e.id);
    iceBurst(e.x, e.y + 1 * (e.scale || 1), e.z, 1.0);
    if (src === GAME.player || e === GAME.player) uiFloatAt(e.x, e.y + 2.4 * (e.scale || 1), e.z, 'Frozen', 'crit');
    classSfx('freeze', e.x, e.z);
    return;
  }
  addBuff(e, 'chill', Math.min(boss ? 2 : 2.99, cur), 6, 'chill');
  if (e.buffs) { const b = e.buffs.find((q) => q.kind === 'chill' && q.src === 'chill'); if (b) b.value = Math.min(boss ? 2 : 2.99, cur); }
}
function unfreeze(e) { dropBuffs(e, ['frozen']); e.buffs = e.buffs.filter((b) => !(b.kind === 'stun' && b.src === 'frozen')); CLS.frozen.delete(e.id); }
function shatter(src, dst, mult, opts) {
  unfreeze(dst);
  combo(src, dst, 'shatter');
  iceBurst(dst.x, dst.y + 1 * (dst.scale || 1), dst.z, 1.6);
  // splinters fly into whoever stands close
  later(0.05, () => forNear(dst.x, dst.z, 3.2, (o) => {
    if (o === dst || !o.alive || !isEnemy(src, o) || !isActor(o)) return;
    const r = computeDamage(src, o, 0.35);
    dealDamage(src, o, r.d, { kind: 'ice', reflect: true, dot: false, noReact: true });
  }));
  classSfx('shatter', dst.x, dst.z);
  return mult;
}
function overload(src, dst) {
  dropBuffs(dst, ['burn']);
  combo(src, dst, 'overload');
  const x = dst.x, z = dst.z, y = dst.y + 1.1 * (dst.scale || 1);
  FX.burst(x, y, z, 40, [2.4, 1.6, 1.4], 7, 0.5, 0.2, 2);
  FX.ring(x, y - 0.8, z, 4, [1.6, 1.4, 2.6], 40, 7);
  spellDisc(x, z, 4.5, DISC_KIND.shock, 0.6, [1.8, 1.5, 2.6]);
  lightFlash(x, y, z, 14, [2.6, 2.2, 3.4], 0.4);
  fireLandsAt(x, y, z, 2, src); // [depth] the caster
  later(0.05, () => forNear(x, z, 4.5, (o) => {
    if (o === dst || !o.alive || !isEnemy(src, o) || !isActor(o)) return;
    const r = computeDamage(src, o, 0.8 * rankMult(src.level));
    dealDamage(src, o, r.d, { crit: r.crit, kind: 'aoe', noReact: true });
  }));
  classSfx('overload', x, z);
}
function combo(src, dst, kind) {
  CLS.stats.combos[kind] = (CLS.stats.combos[kind] || 0) + 1;
  if (src === GAME.player || dst === GAME.player) {
    const label = { steam: 'Steam!', shatter: 'Shatter!', overload: 'Overload!', quench: 'Quenched' }[kind];
    uiFloatAt(dst.x, dst.y + 2.7 * (dst.scale || 1), dst.z, label, 'crit');
    if (src === GAME.player) { classCue('combo:' + kind); GAME.hitStop = Math.max(GAME.hitStop || 0, 0.06); }
  }
}
// a frozen body is a block of ice that shatters, a hot one throws up steam
function iceBurst(x, y, z, k) {
  if (dist2(x, z, camera.position.x, camera.position.z) > 70 * 70) return;
  FX.burst(x, y, z, Math.round(26 * k), [0.8, 1.3, 2.2], 4.5 * k, 0.6, 0.12, 9);
  for (let i = 0; i < 14 * k; i++) { const a = Math.random() * TAU; fxAlpha.emit(x, y, z, Math.cos(a) * 2.5 * k, 1 + Math.random() * 3, Math.sin(a) * 2.5 * k, 0.9, 0.75, 0.85, 0.95, 0.08, 9, 0.4); }
}
function steamPuff(x, y, z, n = 6) {
  if (dist2(x, z, camera.position.x, camera.position.z) > 70 * 70) return;
  const A = U.uAmbient.value, L = U.uLightColor.value;
  for (let i = 0; i < n; i++) fxAlpha.emit(x + (Math.random() - 0.5) * 0.6, y + Math.random() * 0.4, z + (Math.random() - 0.5) * 0.6, (Math.random() - 0.5) * 0.6, 1.2 + Math.random(), (Math.random() - 0.5) * 0.6, 1.6 + Math.random(), A.x * 0.6 + L.x * 0.45 + 0.25, A.y * 0.6 + L.y * 0.45 + 0.27, A.z * 0.6 + L.z * 0.45 + 0.3, -0.7, -0.15, 0.5);
}
// a cloud of steam: blinds the foes in it, soaks everyone, scalds a little
function steamAt(x, z, r, src, dur = 5) {
  if (CLS.steam.length >= 8) CLS.steam.shift();
  CLS.steam.push({ x, z, r, until: GAME.t + dur, t0: GAME.t, src: src ? src.id : null, faction: src ? src.faction : 4, tick: 0 });
  CLS.stats.steam++;
  // the burst itself: a white bloom of steam rolling up and out
  steamPuff(x, heightAt(x, z) + 0.6, z, 26);
  if (dist2(x, z, camera.position.x, camera.position.z) < 80 * 80) {
    const A = U.uAmbient.value, L = U.uLightColor.value, y = heightAt(x, z);
    const wr = A.x * 0.5 + L.x * 0.55 + 0.42, wg = A.y * 0.5 + L.y * 0.55 + 0.44, wb = A.z * 0.5 + L.z * 0.55 + 0.48;
    for (let i = 0; i < 34; i++) { const a = Math.random() * TAU, sp = 1.5 + Math.random() * 2.5; fxAlpha.emit(x + Math.cos(a) * 0.5, y + 0.4 + Math.random() * 1.4, z + Math.sin(a) * 0.5, Math.cos(a) * sp, 0.8 + Math.random() * 1.6, Math.sin(a) * sp, 2.4 + Math.random() * 1.2, wr - 0.07, wg - 0.07, wb - 0.08, -(1.6 + Math.random() * 0.8), -0.1, 0.9); }
    // [balance] so it reads: a hissing white ring racing out along the ground, a column of steam shooting up
    // through the middle, scalding droplets falling back, and a pale flash
    for (let i = 0; i < 28; i++) { const a = i / 28 * TAU + Math.random() * 0.1, sp = 5.5 + Math.random() * 1.5; fxAlpha.emit(x + Math.cos(a) * 0.6, y + 0.25, z + Math.sin(a) * 0.6, Math.cos(a) * sp, 0.25 + Math.random() * 0.3, Math.sin(a) * sp, 0.9 + Math.random() * 0.4, wr, wg, wb, -(0.9 + Math.random() * 0.5), 0, 2.6); }
    for (let i = 0; i < 16; i++) fxAlpha.emit(x + (Math.random() - 0.5) * 0.7, y + 0.6 + i * 0.22, z + (Math.random() - 0.5) * 0.7, (Math.random() - 0.5) * 0.5, 4.5 + Math.random() * 2.5, (Math.random() - 0.5) * 0.5, 1.6 + Math.random() * 0.8, wr, wg, wb, -(1.1 + Math.random() * 0.7), -0.6, 1.1);
    FX.burst(x, y + 1.4, z, 22, [1.5, 1.7, 1.9], 4.5, 0.7, 0.07, 9);
    spellDisc(x, z, Math.max(3, r) * 1.15, DISC_KIND.shock, 0.7, [1.3, 1.45, 1.6]);
    lightFlash(x, y + 1.2, z, 9, [2.0, 2.1, 2.3], 0.32);
  }
  classSfx('steam', x, z);
}

/* ---- the shield: a raised guard and the parry ---- */
function parryWindow(e) { return PARRY_WIN * (realmFlavour(e) && e.faction === 0 ? 1.4 : 1); }
function blockFaces(e, src) {
  const cs = e.cs;
  if (cs.stance === 0 && realmFlavour(e) && e.faction === 0) return true;
  const arc = cs.stance === 0 ? 1.95 : 1.3;
  return Math.abs(angDiff(e.yaw, Math.atan2(src.x - e.x, src.z - e.z))) < arc;
}
function canBlock(e) { return e.cls === 'warrior' && clsHas(e, 'block') && e.alive && hasShield(e) && !e.mount && e.carrying == null && !isStunned(e) && !(e.motion && (e.motion.kind === 'leap' || e.motion.kind === 'ladder')); } // [keeps] not on a ladder
function setBlock(e, on) {
  const cs = csOf(e), t = nowT();
  if (on && !canBlock(e)) on = false;
  if (on === cs.blockOn) return;
  cs.blockOn = on;
  if (on) {
    cs.raisedAt = t;
    // the parry window opens only when the shield comes up fresh, not when it is held or flicked
    cs.blockAt = t - cs.blockDown >= PARRY_REARM ? t : -9;
    e.casting = null;
    sfxAtE('swing', e); // [audio2] placed (11c_sound.js)
  } else cs.blockDown = t;
}
function parry(dst, src) {
  const cs = dst.cs;
  cs.blockAt = -9; // one parry per raise
  CLS.stats.parries++;
  if (BAL.tap) BAL.tap(src, dst, 0, 0, { parry: true }); // [balance3] tests count parries (07c_balance.js)
  const boss = src.role === 'boss' || src.role === 'dungeonBoss' || src.kind === 'door';
  if (!boss) { addBuff(src, 'stun', 1, src.role === 'player' || src.bot ? 0.7 : 0.9, dst.id, { ccAll: true }); src.casting = null; addBuff(src, 'stagger', 1, 3, dst.id); } // [balance] ccAll: parries cannot stun-lock
  addMom(dst, 2);
  setAct(dst, 11, 0.42);
  const x = (dst.x + src.x) / 2, z = (dst.z + src.z) / 2, y = dst.y + 1.25 * (dst.scale || 1);
  FX.burst(x, y, z, 26, [2.6, 2.1, 1.2], 6, 0.35, 0.09, 9);
  lightFlash(x, y, z, 7, [2.6, 2.2, 1.4], 0.18);
  spawnSlash(dst, false, 0.2, 1.2);
  classSfx('parry', x, z);
  if (dst === GAME.player || src === GAME.player) {
    uiFloatAt(dst.x, dst.y + 2.4 * (dst.scale || 1), dst.z, 'Parried', 'crit');
    GAME.hitStop = Math.max(GAME.hitStop || 0, 0.11);
    cameraShake(0.12, dst.x, dst.z);
    if (dst === GAME.player) classCue('parry');
  }
}
function blockHit(e, src, dmg) {
  const cs = e.cs;
  CLS.stats.blocks++;
  if (cs.stance === 0) addMom(e, 0.5);
  const cost = cs.stance === 0 ? 0 : 5 + 60 * dmg / Math.max(1, e.maxHp);
  if (e === GAME.player) e.endurance = Math.max(0, (e.endurance ?? 100) - cost);
  else cs.guard = Math.max(0, cs.guard - cost);
  const y = e.y + 1.2 * (e.scale || 1);
  if (dist2(e.x, e.z, camera.position.x, camera.position.z) < 50 * 50) FX.burst(e.x + Math.sin(e.yaw) * 0.5, y, e.z + Math.cos(e.yaw) * 0.5, 8, [1.8, 1.5, 1.0], 3, 0.25, 0.07, 9);
  classSfx('block', e.x, e.z);
  if ((e === GAME.player ? e.endurance : cs.guard) <= 0 && cost > 0) {
    setBlock(e, false);
    addBuff(e, 'stun', 1, 0.8, src.id);
    if (e === GAME.player) uiError('Your guard is broken!');
  }
}
function wardBite(dst, src, b) {
  const el = b.elem;
  if (el === 'fire') { const r = computeDamage(dst, src, 0.25); addBuff(src, 'burn', r.d / 3, 3, dst.id); }
  else if (el === 'frost') addChill(src, 1, dst);
  else { const r = computeDamage(dst, src, 0.3); dealDamage(dst, src, r.d, { kind: 'shock', reflect: true, noReact: true }); spellRibbon([dst.x, dst.y + 1.2, dst.z], [src.x, src.y + 1.2 * (src.scale || 1), src.z], 'bolt', ELEM_COL.storm, 0.25, 0.25); }
}

/* ------------------------------------------------------------------ */
/* a blow that landed                                                  */
/* ------------------------------------------------------------------ */
function classOnHit(src, dst, dmg, opts) {
  if (!src || src === dst || !(dmg > 0) || dst.kind === 'door') {
    if (src && src.cls === 'warrior' && dst && dst.kind === 'door' && opts.kind === 'melee' && !opts.dot) addMom(src, 0.5);
    return;
  }
  const t = nowT();
  if (dst.cs && dst.cs.hidden && !opts.dot) breakHiding(dst, 3);
  if (dst.cs && dst.cs.praying && !opts.dot) stopPrayer(dst);
  if (dst.casting && opts.kind === 'melee' && !opts.dot) castPushback(dst); // [balance2] a blow in the middle of a spell sets it back (07c_balance.js)
  pursuitOnHit(src, dst, dmg, opts); // [balance3] an arrow on a warrior brings Charge sooner (07c_balance3.js)
  if (!src.cls) return;
  dazzleOnHit(src, dst, dmg, opts); // [balance3] holy light dazzles
  const cs = csOf(src);
  // an archer finds arrows worth keeping on the fallen
  if (src === GAME.player && src.cls === 'archer' && dst.hp <= 0 && (dst.cls === 'archer' || dst.mobType === 'bandit') && clsHas(src, 'arrows') && Math.random() < 0.4) {
    const k = pick(Math.random, ['broadhead', 'bodkin', 'fire', 'blunt']);
    later(0.3, () => dropGood(ARROW_DEF[k].good, 2 + Math.floor(Math.random() * 4), dst.x, dst.z, dst.y));
  }
  if (src.cls === 'warrior' && opts.kind === 'melee' && !opts.dot && !opts.reflect) {
    const fin = cs.fin && t < cs.fin.until ? cs.fin : null;
    if (fin) { cs.fin = null; finisherLands(src, dst, fin, dmg); }
    else {
      addMom(src, (opts.auto ? 0.8 : 0.5) + (opts.crit ? 0.5 : 0));
      if (cs.stance === 2 && opts.auto) src.swingAt -= src.swing * 0.1;
      styleProc(src, dst, dmg, opts, false);
    }
  }
  if (src.cls === 'priest') {
    if (opts.kind === 'holy' && isUndead(dst)) addDev(src, 5);
    else if (opts.holy && isUndead(dst)) addDev(src, 1);
    else if (opts.kind === 'holy') addDev(src, 1.5);
  }
  if (src.cls === 'archer' && opts.arrow && opts.arrow !== 'plain') arrowEffect(src, dst, dmg, opts.arrow, opts);
  if (src.cls === 'archer' && opts.kind === 'aoe' && !opts.dot && dst.alive) addBuff(dst, 'snare', 0.5, 4, src.id); // [balance] a volley pins what it falls on [balance2] 40% for 3 s
}
// the weapon's own bite: the sword opens wounds, the axe breaks armour, the mace staggers
function styleProc(src, dst, dmg, opts, strong) {
  const st = weaponStyle(src);
  // (a bleed's value is its harm each second: a finisher's wound bleeds 30% of the blow over 6 s, a cut 12% over 4 s)
  if (st === 'sword') { if (strong || Math.random() < 0.15) addBuff(dst, 'bleed', dmg * (strong ? 0.3 / 6 : 0.12 / 4), strong ? 6 : 4, src.id); }
  else if (st === 'axe') { const b = dst.buffs.find((q) => q.kind === 'sunder' && q.until > GAME.t); const n = Math.min(3, (b ? b.value : 0) + (strong ? 3 : 1)); addBuff(dst, 'sunder', n, 10, 'sunder'); const bb = dst.buffs.find((q) => q.kind === 'sunder'); if (bb) bb.value = n; if (strong) for (const q of dst.buffs) if (q.kind === 'shield') q.value = 0; }
  else if (st === 'mace') { if (dst.casting && (strong || Math.random() < 0.5) && breakCast(dst)) { if (dst === GAME.player) uiLog('The blow breaks your spell.', 'warn'); } if (!strong && Math.random() < 0.12) addBuff(dst, 'snare', 0.3, 2, src.id); } // [balance2] breakCast
}
function finisherLands(src, dst, fin, dmg) {
  CLS.stats.finishers++;
  styleProc(src, dst, dmg, {}, true);
  if (fin.style === 'mace' && dst.role !== 'boss' && dst.role !== 'dungeonBoss') { addBuff(dst, 'stun', 1, 1 + 0.25 * fin.pips, src.id); dst.casting = null; }
  if (realmFlavour(src) && src.faction === 2 && csOf(src).stance === 2) healEnt(src, src, src.maxHp * 0.03 * fin.pips); // [balance2] in fury only, as the Chronicle says (a Thule warrior in a guarded stance outlasted every pack)
  const y = dst.y + 1.2 * (dst.scale || 1);
  FX.burst(dst.x, y, dst.z, 30, fin.style === 'sword' ? [2.2, 0.5, 0.35] : fin.style === 'axe' ? [2.0, 1.6, 1.1] : [2.4, 2.0, 1.2], 6, 0.45, 0.13, 7);
  cameraShake(0.22, dst.x, dst.z);
  if (src === GAME.player) { GAME.hitStop = Math.max(GAME.hitStop || 0, 0.09); uiFloatAt(dst.x, dst.y + 2.6 * (dst.scale || 1), dst.z, { sword: 'Rend', axe: 'Sunder', mace: 'Stagger' }[fin.style], 'crit'); }
  classSfx('finisher', dst.x, dst.z);
}
function classOnHeal(src, dst, h) {
  if (!src || src.cls !== 'priest' || !(h > 0)) return;
  addDev(src, (h / Math.max(1, dst.maxHp)) * (dst === src ? 14 : 30));
}

/* ------------------------------------------------------------------ */
/* this cast's view of an ability                                      */
/* ------------------------------------------------------------------ */
// executeAbility asks before it spends power: the stance, the momentum, the focus, the attunement and the devotion
// all shape the cast. Returns the ability itself or a copy with this cast's numbers (and maybe a custom action).
function classAbility(e, A, t, cast) {
  if (!e.cls || e.testDummy) return A;
  if (BAL.tap) e._ab = A.id; // [balance3] tests put the harm that follows down to this ability (tools/tests/duels.py)
  const cs = csOf(e);
  if (e.cls === 'warrior') return warriorView(e, cs, A, t);
  if (e.cls === 'archer') return archerView(e, cs, A, t);
  if (e.cls === 'mage') return mageView(e, cs, A, t, cast);
  if (e.cls === 'priest') return priestView(e, cs, A, t);
  return A;
}
function warriorView(e, cs, A, t) {
  const st = cs.stance;
  let V = null;
  const view = () => V || (V = { ...A });
  if (A.id === 'slash' && clsHas(e, 'momentum') && momOf(e) >= FIN_MIN) {
    const pips = Math.floor(cs.mom), style = weaponStyle(e);
    V = view();
    V.dmg = 1.25 + 0.35 * pips; V.anim = 8; V.name = 'Finisher';
    cs.mom = 0; cs.momAt = nowT();
    cs.fin = { pips, style, until: nowT() + 0.8 };
    if (pips >= 5 && realmFlavour(e) && e.faction === 1) { V.self = true; V.spin = 4.2; V.dmg = (1.25 + 0.35 * pips) * 0.75; cs.fin.until = nowT() + 1.2; } // a champion's feat: the whirling cut
    if (e === GAME.player) uiLog(`Finisher: ${pips} momentum spent.`, 'level');
  }
  if (A.id === 'bash' && st === 0) { view().stun = A.stun + 0.5; /* [balance] +1 */ if (t) { if (!t.threat) t.threat = new Map(); t.threat.set(e.id, (t.threat.get(e.id) || 0) + e.maxHp); } }
  if (A.id === 'bulwark') view().buff = { ...A.buff, dur: A.buff.dur + (st === 0 ? 3 : 0) + 1.5 * (abilityRank(e.level) - 1) }; // [balance2] longer with rank
  if ((A.id === 'cleave' || A.id === 'whirl') && st === 2) view().dmg = A.dmg * 1.25;
  if (A.id === 'rally') { if (st === 2) view().buff = { ...A.buff, value: 0.25 }; view().healPct = (st === 1 ? 0.35 : A.healPct) / rankMult(e.level); } // [balance4] a warrior's own heal does not grow with rank (a priest's own healing does not either): at 50 it healed 48%
  if ((A.id === 'charge' || A.id === 'leap') && realmFlavour(e) && e.faction === 1) later(0.5, () => addMom(e, 2));
  else if (A.id === 'charge' || A.id === 'leap') later(0.5, () => addMom(e, 1));
  if (A.id === 'charge') { e.buffs = e.buffs.filter((b) => b.kind !== 'snare' && !(b.kind === 'root' && !b.deep)); if (CHARGE_FREE > 0) { addBuff(e, 'free', 1, CHARGE_FREE, 'charge'); chargeFree(e, CHARGE_FREE); } } // [balance] a charge breaks free of slows and snares [balance2] and none takes hold for 2 s (07c_balance.js) [balance3] but a seasoned mage's frost holds
  rushShare(e, A); // [balance3] Charge and Leap Strike are one rush (07c_balance3.js)
  if (cs.blockOn) setBlock(e, false);
  return V || A;
}
function archerView(e, cs, A, t) {
  if (A.id === 'tumble') tumbleSlow(e); // [balance2] the foes you leap from are slowed (07c_balance.js)
  if (!A.proj) return A;
  let V = A;
  const type = takeArrow(e, 1);
  if (type !== 'plain' || A.id === 'cripple' && clsHas(e, 'track')) V = { ...A, arrow: type };
  if (A.id === 'cripple' && clsHas(e, 'track') && t) addBuff(t, 'tracked', 1, 30, e.id);
  if (type === 'fire' && A.proj === 'arrow') V.proj = 'firearrow';
  cs.drawFrom = -1;
  return V;
}
// which special arrow a shot uses: the chosen kind while there are any (NPCs carry their own)
function takeArrow(e, n = 1) {
  const cs = csOf(e);
  const type = cs.arrow || 'plain';
  if (type === 'plain' || !clsHas(e, 'arrows')) return 'plain';
  if (e !== GAME.player) return type;
  const D = ARROW_DEF[type];
  if (!D.good || !goodsHave(D.good, 1)) { cs.arrow = 'plain'; uiLog(`You are out of ${D.name.toLowerCase()}.`, 'warn'); return 'plain'; }
  goodsTake(D.good, Math.min(n, goodsCount(D.good)));
  return type;
}
function mageView(e, cs, A, t, cast) {
  let V = null;
  const view = () => V || (V = { ...A });
  // overcasting: power you do not have is paid for in blood
  if (e.power < A.cost && A.cost > 0) {
    const deficit = A.cost - e.power;
    view().overcast = deficit;
    e.hp = Math.max(1, e.hp - (deficit / Math.max(1, e.maxPower)) * e.maxHp * 0.7);
    e.power = A.cost;
    cs.spentUntil = nowT() + 4;
    if (e === GAME.player) { uiLog('You overcast: the spell takes its due in blood.', 'warn'); flashScreen([0.5, 0.1, 0.25], 0.25); }
    FX.burst(e.x, e.y + 1.4, e.z, 14, [1.6, 0.3, 0.6], 2, 0.5, 0.1, -1);
  }
  const focus = clsHas(e, 'focus') ? cs.focus : 'fire';
  let el = ELEM_OF[A.id];
  if (A.id === 'nova' || A.id === 'ward' || A.id === 'blink') el = focus;
  if (!el) return V || A;
  const att = clsHas(e, 'attune') ? attOf(e, el) : 0;
  const emp = (1 + 0.18 * att / 100) * mageRankK(e); // [balance2] 0.22 [balance4] and more for a seasoned mage (07c_balance4.js)
  if (A.dmg) view().dmg = A.dmg * emp;
  if (A.id === 'nova' && el !== 'fire') view().custom = el === 'frost' ? frostNova : thunderclap;
  if (A.id === 'ward') { view().custom = elementWard; V.elem = el; }
  if (A.id === 'blink') { view().custom = elementBlink; V.elem = el; }
  if (A.id === 'chain') { view().custom = stormChain; V.extra = att >= 60 ? 1 : 0; }
  if (A.id === 'frost' || A.id === 'blizzard') { const gx = t ? t.x : cast ? cast.gx : e.x, gz = t ? t.z : cast ? cast.gz : e.z; later(A.id === 'frost' ? 0.6 : 0.5, () => frostLands(gx, gz, A.id === 'frost' ? 3.5 : A.radius + 1, e)); }
  if (A.id === 'blizzard' && realmFlavour(e) && e.faction === 2) { const gx = t ? t.x : cast ? cast.gx : e.x, gz = t ? t.z : cast ? cast.gz : e.z; later(A.ticks + 0.6, () => layRune(e, gx, gz, 'frost')); }
  if (A.id === 'meteor' || A.id === 'firebolt') { const gx = t ? t.x : cast ? cast.gx : e.x, gz = t ? t.z : cast ? cast.gz : e.z; later(A.id === 'meteor' ? 1.0 : 0.6, () => fireMeetsIce(gx, gz, A.id === 'meteor' ? A.radius : 1.5, e)); }
  attune(e, el, 22);
  if (e === GAME.player && att < 60 && cs.att[el] >= 60) classCue('attuned:' + el);
  return V || A;
}
function priestView(e, cs, A, t) {
  let V = null;
  const view = () => V || (V = { ...A });
  const dv = devOf(e);
  const hm = (1 + 0.25 * dv / 100) * (sanctified(e) ? 1.15 : 1);
  if (dv > 0 && (A.heal || A.hot) && e.role !== 'player' && e.role !== 'bot') { BAL8.stats.npcDevHeals++; BAL8.stats.npcDevSum += dv; } // [balance8] the war's priests' heals strengthened by devotion (07c_balance8.js)
  if (A.heal) view().heal = A.heal * hm * (t === e || !t ? priestSelf(e) : 1) * mendWound(t || e); // a priest's own wounds mend more slowly than another's ([balance] 0.85) [balance2] and not faster with rank [balance4] the deeper the wound, the more Mend mends (07c_balance4.js)
  if (A.hot) view().hot = [A.hot[0] * hm * (t === e || !t ? priestSelf(e) : 1), A.hot[1]]; // [balance] and their own renewal
  if (A.id === 'renew' && (t === e || !t)) { const c = renewRoteCost(e, A); if (c !== A.cost) view().cost = c; priestSteadfast(e); renewMark(e); } // [balance6] renewing by rote costs power (07c_balance6.js) // [balance2] Renewal on yourself loosens roots and slows and steadies your spells (07c_balance.js) [balance5] a fresh one (07c_balance5.js)
  if (A.groupHeal) view().groupHeal = A.groupHeal * hm;
  if (A.groupHot) view().groupHot = [A.groupHot[0] * hm, A.groupHot[1]];
  if (A.healPct && A.id === 'pillar') view().healPct = A.healPct * hm;
  if (A.id === 'smite' && t && isUndead(t)) view().dmg = A.dmg * 1.25;
  if (A.id === 'holyfire' && t) holyFlare(e, t); // [balance5] Holy Fire flares in a caster's face: its spell is lost (07c_balance5.js)
  if (A.id === 'sanctuary') view().custom = priestGroupHeal; // [balance] the priest's own share mends more slowly (07c_balance.js)
  if (A.id === 'massrenew') view().custom = priestGroupHot;
  if (A.id === 'divine') view().custom = divineShield; // [balance] it also lifts and wards off stuns, roots and slows (07c_balance.js)
  if (A.id === 'renew' && clsHas(e, 'bless') && dv >= 20 && t) {
    if (e.role !== 'player' && e.role !== 'bot') BAL8.stats.npcBless++; // [balance8] the war's priests' blessings (07c_balance8.js)
    cs.dev -= 12;
    const f = t && !isEnemy(e, t) ? t : e;
    blessing(e, f);
  }
  if (cs.praying) stopPrayer(e);
  return V || A;
}
function blessing(e, f) {
  const realm = realmFlavour(e) ? e.faction : e.plainCalling ? -1 : 0; // [balance4] a plain priest measured in tests blesses with no realm's way
  addBuff(f, 'bless', realm, 15, 'bless');
  const b = f.buffs.find((q) => q.kind === 'bless' && q.src === 'bless'); if (b) b.value = realm;
  if (realm === 1) { dropBuffs(f, ['snare', 'root']); addBuff(f, 'hot', f.maxHp * PRIEST_REALM.eriuHot, 15, WELL_SRC); } // [balance4] 0.015 (07c_balance4.js) [balance6] its own heal: with the priest's own src it merged into the Renewal it came with (07c_balance6.js)
  const c = realm === 0 ? [1.8, 1.6, 1.0] : realm === 1 ? [0.9, 1.9, 1.2] : [2.3, 1.3, 0.6];
  FX.ring(f.x, f.y + 0.2, f.z, 1.4, c, 26, 1.6);
  for (let i = 0; i < 16; i++) { const a = Math.random() * TAU; fxAdd.emit(f.x + Math.cos(a) * 0.5, f.y + 0.3 + Math.random() * 1.6, f.z + Math.sin(a) * 0.5, 0, 0.8, 0, 1.2, c[0], c[1], c[2], 0.12, -0.3, 0.4); }
}

/* ---- custom casts: the frost nova, the thunderclap, element wards and blinks, the storm chain ---- */
function frostNova(e, A, t, cast, rk) {
  const R = A.pbaoe, eriuGrowth = realmFlavour(e) && e.faction === 1;
  FX.ring(e.x, e.y + 0.4, e.z, R, [0.9, 1.4, 2.4], 64, R * 1.3);
  iceBurst(e.x, e.y + 0.6, e.z, 1.4);
  spellDisc(e.x, e.z, R, DISC_KIND.frost, 4, [0.55, 0.8, 1.2]);
  spellDisc(e.x, e.z, R * 1.1, DISC_KIND.shock, 0.5, [0.8, 1.3, 2.4]);
  forNear(e.x, e.z, R, (o) => {
    if (!o.alive || !isEnemy(e, o) || !isActor(o)) return;
    const r = computeDamage(e, o, A.dmg * rk * 0.7);
    dealDamage(e, o, r.d, { crit: r.crit, kind: 'frost', chill: 1 });
    if (o.alive) addBuff(o, 'root', 1, A.root + (eriuGrowth ? 1 : 0), e.id, frostRootExtra(e)); // [balance] as long as the fire nova's [balance3] frost holds: no Leap out of it (nor a Charge, from rank II)
    // Eriu: brambles break through the frost and hold the foe a moment longer
    if (eriuGrowth && o.alive && dist2(o.x, o.z, camera.position.x, camera.position.z) < 60 * 60) for (let q = 0; q < 10; q++) { const a = Math.random() * TAU; fxAlpha.emit(o.x + Math.cos(a) * 0.4, o.y + 0.05, o.z + Math.sin(a) * 0.4, Math.cos(a) * 0.3, 1.2 + Math.random(), Math.sin(a) * 0.3, 0.8, 0.16, 0.3, 0.1, 0.07, 3, 1); }
  });
  frostLands(e.x, e.z, R, e);
  sfxAtE('frost', e); classSfx('freeze', e.x, e.z); // [audio2] placed (11c_sound.js)
}
function thunderclap(e, A, t, cast, rk) {
  const R = A.pbaoe;
  spellDisc(e.x, e.z, R * 1.15, DISC_KIND.shock, 0.6, [1.2, 1.5, 2.8]);
  FX.burst(e.x, e.y + 1, e.z, 50, [1.2, 1.5, 2.8], 7, 0.4, 0.12, 2);
  lightFlash(e.x, e.y + 2, e.z, 16, [1.8, 2.2, 3.6], 0.35);
  cameraShake(0.25, e.x, e.z);
  forNear(e.x, e.z, R, (o) => {
    if (!o.alive || !isEnemy(e, o) || !isActor(o)) return;
    const r = computeDamage(e, o, A.dmg * rk * 0.85);
    spellRibbon([e.x, e.y + 1.4, e.z], [o.x, o.y + 1.1 * (o.scale || 1), o.z], 'bolt', ELEM_COL.storm, 0.3, 0.3);
    dealDamage(e, o, r.d, { crit: r.crit, kind: 'shock' });
    if (o.alive && o.role !== 'boss' && o.role !== 'dungeonBoss' && o.fixedY === null) {
      const d = Math.max(0.5, dist(e.x, e.z, o.x, o.z)), push = 4 * (1 - d / (R + 1));
      for (let s = push; s > 0.2; s -= 0.5) if (stepTo(o, o.x + (o.x - e.x) / d * s, o.z + (o.z - e.z) / d * s)) break;
      breakCast(o); // [balance2]
      addBuff(o, 'snare', 0.4, 2, e.id);
    }
  });
  sfxAtE('shock', e); sfxAtE('boom', e, { vol: 0.8 }); // [audio2] placed (11c_sound.js)
}
function elementWard(e, A, t, cast, rk) {
  const logres = realmFlavour(e) && e.faction === 0;
  const amt = e.maxHp * A.shieldPct * rk * (logres ? 1.25 : 1);
  addBuff(e, 'shield', amt, A.dur, e.id);
  addBuff(e, 'eward', 1, A.dur, 'eward', { elem: A.elem });
  const c = ELEM_COL[A.elem];
  FX.ring(e.x, e.y + 1, e.z, 1.2, c, 30, 1.6);
  if (logres) forNear(e.x, e.z, 8, (o) => { if (o !== e && o.alive && o.faction === e.faction && isActor(o) && o.kind === 'humanoid') { addBuff(o, 'shield', amt * 0.5 * (o.maxHp / e.maxHp), A.dur, e.id); FX.ring(o.x, o.y + 1, o.z, 1.0, c, 18, 1.2); } });
  sfxAtE('blink', e); // [audio2] placed (11c_sound.js)
}
function elementBlink(e, A, t, cast, rk) {
  const ox = e.x, oz = e.z, el = A.elem;
  const dx = Math.sin(e.yaw), dz = Math.cos(e.yaw);
  // frost freezes the water ahead first, so a mage of frost can blink out onto a lake
  if (el === 'frost') for (let s = A.blink; s > 2; s -= 3) { const x = ox + dx * s, z = oz + dz * s; if (isWaterAt(x, z)) { freezeWater(x, z, 4.5, e); break; } }
  FX.burst(e.x, e.y + 1, e.z, 20, ELEM_COL[el], 2, 0.5, 0.2, 0);
  { const R = dashReach(e, ox, oz, dx, dz, A.blink); if (R.d > 0.3) { e.x = e.prevX = R.x; e.z = e.prevZ = R.z; e.y = R.y; } } // [v12] along the floor it stands on, never over a wall or off a walk (07_entities.js)
  e.buffs = e.buffs.filter((b) => b.kind !== 'snare' && b.kind !== 'root' && b.kind !== 'chill');
  FX.burst(e.x, e.y + 1, e.z, 20, ELEM_COL[el], 2, 0.5, 0.2, 0);
  // what the mage leaves behind where they stood
  const hit = (mult, opts) => forNear(ox, oz, 3.5, (o) => { if (!o.alive || !isEnemy(e, o) || !isActor(o)) return; const r = computeDamage(e, o, mult * rk); dealDamage(e, o, r.d, opts); });
  if (el === 'fire') { fireLandsAt(ox, heightAt(ox, oz), oz, 2.2, e); /* [depth] the caster */ FX.burst(ox, heightAt(ox, oz) + 0.5, oz, 30, ELEM_COL.fire, 3, 0.7, 0.2, -1); hit(0.5, { kind: 'fire' }); }
  else if (el === 'frost') { spellDisc(ox, oz, 3.5, DISC_KIND.frost, 3, [0.55, 0.8, 1.2]); hit(0.35, { kind: 'frost' }); frostLands(ox, oz, 3.5, e); }
  else { spellDisc(ox, oz, 3.8, DISC_KIND.shock, 0.5, [1.2, 1.5, 2.8]); hit(0.45, { kind: 'shock' }); lightFlash(ox, heightAt(ox, oz) + 1.5, oz, 10, [1.6, 2.0, 3.4], 0.25); }
  if (realmFlavour(e) && e.faction === 2) layRune(e, ox, oz, el);
  sfxAtE('blink', e); // [audio2] placed (11c_sound.js)
}
function stormChain(e, A, t, cast, rk) {
  if (!t) return;
  const hits = [t];
  let cur = t;
  const jumps = A.chain + (A.extra || 0) + (wetOf(t) > 0.3 ? 2 : 0);
  for (let j = 0; j < jumps; j++) {
    // the arc leaps further to and from anyone wet
    const reach = 11 + (wetOf(cur) > 0.3 ? 5 : 0);
    const n = nearestWhere(cur.x, cur.z, reach + 5, (o) => o.alive && isEnemy(e, o) && isActor(o) && !hits.includes(o) && dist(cur.x, cur.z, o.x, o.z) <= reach + (wetOf(o) > 0.3 ? 5 : 0));
    if (!n) break;
    hits.push(n); cur = n;
  }
  const chest = (u) => u.y + 1.2 * (u.scale || 1);
  // weather-calling: in the rain the sky answers
  if (realmFlavour(e) && e.faction === 1 && (rainHere(e) > 0.2 || stormNow() > 0.5) && !inDungeon(t)) {
    strikeAt({ x: t.x, y: chest(t) + 0.6, z: t.z, gy: t.y });
    later(0.08, () => { if (t.alive) { const r = computeDamage(e, t, A.dmg * rk * 0.6); dealDamage(e, t, r.d, { crit: r.crit, kind: 'shock' }); } });
  }
  hits.forEach((o, j) => {
    later(j * 0.11, () => {
      if (!o.alive) return;
      const p = j === 0 ? null : hits[j - 1];
      const from = p ? [p.x, chest(p), p.z] : [e.x + Math.sin(e.yaw) * 0.5, e.y + 1.45 * (e.scale || 1), e.z + Math.cos(e.yaw) * 0.5];
      const to = [o.x, chest(o), o.z];
      spellRibbon(from, to, 'bolt', wetOf(o) > 0.3 ? [1.4, 1.8, 3.2] : [1.0, 1.35, 2.6], 0.5, 0.34);
      const r = computeDamage(e, o, A.dmg * rk * Math.pow(0.8, j));
      dealDamage(e, o, r.d, { crit: r.crit, kind: 'shock' });
      FX.burst(to[0], to[1], to[2], 16, [1.2, 1.5, 2.8], 4.5, 0.32, 0.1, 7);
      lightFlash(to[0], to[1], to[2], 9, [1.5, 1.9, 3.4], 0.28);
      sfxAt('shock', to[0], to[1], to[2]); // [audio2] placed (11c_sound.js)
    });
  });
}

/* ---- the world: water freezes, ice melts, fires go out, runes wait ---- */
function isWaterAt(x, z) {
  if (x > DUN_X0 - 50) return false;
  const wf = waterFn();
  if (wf) { try { const q = wf(x, z); if (q && (q === true || q.depth > 0.1 || q.deep)) return true; } catch (err) { /* fall back to the lakes */ } }
  return heightAt(x, z) < WATER_Y - 0.08;
}
function frostLands(x, z, r, src) {
  // frost puts out the fires it falls on
  if (typeof NATURE !== 'undefined' && NATURE.fire && NATURE.fire.size) {
    let n = 0;
    for (const [key, c] of NATURE.fire) if (dist2(c.i - 511.5, c.j - 511.5, x, z) < r * r) { NAT.data[key * 4 + 2] = 0; NAT.data[key * 4 + 1] = Math.max(NAT.data[key * 4 + 1], 200); NATURE.fire.delete(key); natMark(c.i, c.j, c.i, c.j); n++; }
    if (n) steamPuff(x, heightAt(x, z) + 0.3, z, Math.min(30, 6 + n));
  }
  if (typeof natTreesNear === 'function') natTreesNear(x, z, r, (tr) => { if (tr.fire > 0) { tr.fire = Math.max(0, tr.fire - 0.6); steamPuff(tr.x, tr.y + 3, tr.z, 6); } });
  for (const H of (typeof HOUSES !== 'undefined' ? HOUSES : [])) if (H.burn && H.state === 'burning' && dist2(H.x, H.z, x, z) < (r + H.foot) ** 2) { H.burn.speed *= 0.5; steamPuff(H.x, H.y + 3, H.z, 12); }
  // and water turns to ice
  let wx = 0, wz = 0, n = 0;
  for (let k = 0; k < 13; k++) { const a = k / 12 * TAU, rr = k === 12 ? 0 : r * 0.8; const px = x + Math.cos(a) * rr, pz = z + Math.sin(a) * rr; if (isWaterAt(px, pz)) { wx += px; wz += pz; n++; } }
  if (n >= 2) freezeWater(wx / n * 0.5 + x * 0.5, wz / n * 0.5 + z * 0.5, Math.max(3.5, r * (0.6 + 0.4 * n / 13)), src);
}
const ICE_LIFE = 26;
function freezeWater(x, z, r, src) {
  // one sheet grows into the next rather than stacking
  for (const s of CLS.ice) if (dist(s.x, s.z, x, z) < s.r * 0.6 && s.until - GAME.t > 4) { s.until = Math.max(s.until, GAME.t + ICE_LIFE); s.r = Math.min(14, Math.max(s.r, r)); iceSheetRefresh(s); return s; }
  if (CLS.ice.length >= 7) iceSheetEnd(CLS.ice[0]);
  const wy = waterTopAt(x, z); // [water] ponds and rivers lie at their own heights
  const s = { x, z, wy, r: Math.min(14, r), t0: GAME.t, until: GAME.t + ICE_LIFE + (src && src.cls === 'mage' ? attOf(src, 'frost') * 0.1 : 0), floor: null, mesh: null };
  s.floor = addFloorDisc(x, z, s.r, wy + 0.07, wy - 4, 'ice');
  CLS.ice.push(s);
  CLS.stats.ice++;
  iceSheetMesh(s);
  iceBurst(x, wy + 0.3, z, 0.8);
  // whoever is swimming where the water freezes is caught and lifted onto the ice
  forNear(x, z, s.r, (o) => { if (o.swim && o.alive && o.fixedY === null && dist2(o.x, o.z, x, z) < s.r * s.r * 0.8) { o.y = wy + 0.07; o.swim = false; o.vy = 0; } });
  classSfx('freeze', x, z);
  return s;
}
function iceSheetEnd(s) {
  if (s.dead) return;
  s.dead = true;
  if (s.floor) s.floor.active = false;
  if (s.mesh) { s.mesh.removeFromParent(); s.mesh = null; }
  CLS.ice.splice(CLS.ice.indexOf(s), 1);
}
// walkable ice: the floor carries a body, isWalkable lets it on (01_world.js asks iceAt)
function iceAt(x, z) {
  for (const s of CLS.ice) if (!s.dead && GAME.t < s.until - 0.6 && dist2(x, z, s.x, s.z) < (s.r * iceRadiusK(s)) ** 2) return s;
  return null;
}
const iceRadiusK = (s) => clamp((s.until - GAME.t) / 6, 0.35, 1);
function fireMeetsIce(x, z, r, src) {
  for (const s of CLS.ice) if (!s.dead && dist(s.x, s.z, x, z) < s.r + r) { s.until = Math.min(s.until, GAME.t + 2.5); steamAt(x, z, Math.max(3, r), src, 4); }
  if (isWaterAt(x, z)) steamPuff(x, waterTopAt(x, z) + 0.2, z, 16);
}
// a rune laid on the ground: it waits for a foe to step on it
function layRune(e, x, z, el) {
  if (e.removed) return null; // [balance6] a caster gone from the world lays no rune (a Thule blizzard's rune, laid 6.6 s after it, burst under the next duel's fighters)
  const mine = CLS.runes.filter((q) => q.src === e.id);
  if (mine.length >= 3) runeEnd(mine[0]);
  const R = { x, z, el, src: e.id, faction: e.faction, level: e.level, t0: GAME.t, armAt: GAME.t + 0.8, until: GAME.t + 30, disc: null };
  R.cut = spellDisc(x, z, 2.2, DISC_KIND.runecut, 30, [1, 1, 1], 0.04); // [balance] the dark cut of the strokes, under the glow
  R.disc = spellDisc(x, z, 2.2, DISC_KIND.rune, 30, ELEM_COL[el]);
  if (R.cut) R.cut.owner = R; if (R.disc) R.disc.owner = R; // [balance] (05j_classfx.js lays them again if they go)
  CLS.runes.push(R);
  CLS.stats.runes++;
  classSfx('rune', x, z);
  return R;
}
function runeEnd(R) { R.dead = true; for (const d of [R.disc, R.cut]) if (d && d.on && d.owner === R) d.age = Math.max(d.age, d.dur - 0.4); CLS.runes.splice(CLS.runes.indexOf(R), 1); }
function runeBurst(R) {
  const src = getEnt(R.src) || { id: R.src, level: R.level, dmgMult: 1, faction: R.faction, buffs: [], role: 'none', scale: 1, alive: false, cls: 'mage', x: R.x, z: R.z, y: heightAt(R.x, R.z) };
  const y = heightAt(R.x, R.z);
  spellDisc(R.x, R.z, 5, DISC_KIND.shock, 0.6, ELEM_COL[R.el]);
  FX.burst(R.x, y + 0.5, R.z, 50, ELEM_COL[R.el], 6, 0.6, 0.18, R.el === 'fire' ? -1 : 4);
  lightFlash(R.x, y + 1.5, R.z, 14, ELEM_COL[R.el], 0.4);
  forNear(R.x, R.z, 5, (o) => {
    if (!o.alive || !isActor(o) || !(o.faction !== R.faction && o.faction !== FACTION_NEUTRAL) || o.flying) return;
    const r = computeDamage(src, o, 1.3 * rankMult(R.level));
    dealDamage(src, o, r.d, { crit: r.crit, kind: R.el === 'fire' ? 'fire' : R.el === 'frost' ? 'frost' : 'shock', chill: R.el === 'frost' ? 1 : 0 });
    if (o.alive && R.el === 'frost') addBuff(o, 'root', 1, 2, R.src, frostRootExtra(src)); // [balance3] frost holds
  });
  if (R.el === 'fire') fireLandsAt(R.x, y, R.z, 2.5, src); // [depth] the caster
  if (R.el === 'frost') frostLands(R.x, R.z, 5, src);
  classSfx('runeburst', R.x, R.z);
  runeEnd(R);
}

/* ------------------------------------------------------------------ */
/* the archer's draw, arrows in flight, hiding, snares                 */
/* ------------------------------------------------------------------ */
const DRAW_FULL = 1.2;
const drawFull = (e) => DRAW_FULL * archerDrawK(e); // [balance5] 0.75 (07c_balance5.js) [balance7] Logres from a wall or a tower only (07c_balance7.js)
function drawK(e) {
  const cs = csOf(e);
  if (cs.drawFrom < 0) return 0;
  const t = nowT() - cs.drawFrom, full = drawFull(e);
  return clamp(t / full, 0, 1);
}
function startDraw(e) {
  const cs = csOf(e);
  if (e.cls !== 'archer' || !e.alive || e.casting || e.mount || e.carrying != null || isStunned(e) || cs.drawFrom >= 0) return false;
  cs.drawFrom = nowT();
  sfxAtE('swing', e, { vol: 0.6 }); // [audio2] placed (11c_sound.js)
  return true;
}
function releaseDraw(e, target) {
  const cs = csOf(e);
  if (cs.drawFrom < 0) return false;
  const held = nowT() - cs.drawFrom, k = drawK(e);
  cs.drawFrom = -1;
  if (!e.alive || held < 0.12) return false;
  if (e.power < 3) { if (e === GAME.player) uiError('Not enough power'); return false; }
  e.power -= 3;
  // held too long the arms tire: the shot weakens and wanders
  const tired = clamp((held - drawFull(e) - 2.2) / 2, 0, 1);
  looseArrow(e, k * (1 - 0.4 * tired), target, tired);
  e.swingAt = Math.max(e.swingAt, nowT() + e.swing * 0.75);
  return true;
}
function looseArrow(e, k, target, wobble = 0) {
  const type = takeArrow(e, 1);
  const sc = e.scale || 1;
  const sx = e.x + Math.sin(e.yaw) * 0.45, sz = e.z + Math.cos(e.yaw) * 0.45, sy = e.y + 1.5 * sc;
  const speed = 30 + 32 * k, g = 9.8;
  // where to: the target (led by its pace), or straight down the line of sight
  let tx, ty, tz;
  if (target && target.alive) {
    const tsc = target.scale || 1;
    const d0 = dist(sx, sz, target.x, target.z), tof = d0 / (speed * 0.95);
    const pace = target.anim ? target.anim.amt * 4.3 : 0, vx = Math.sin(target.yaw) * pace, vz = Math.cos(target.yaw) * pace;
    const lead = (0.5 + 0.5 * k) * tof;
    tx = target.x + clamp(vx, -12, 12) * lead; tz = target.z + clamp(vz, -12, 12) * lead; ty = target.y + 1.15 * tsc;
  } else {
    const yaw = e === GAME.player ? CAM.yaw : e.yaw, pitch = e === GAME.player ? clamp(0.3 - CAM.pitch, -0.6, 0.5) : 0;
    const R = 30 + 25 * k;
    tx = sx + Math.sin(yaw) * R * Math.cos(pitch); tz = sz + Math.cos(yaw) * R * Math.cos(pitch); ty = sy + Math.sin(pitch) * R;
  }
  const dx = tx - sx, dz = tz - sz, dh = Math.hypot(dx, dz) || 1, dy = ty - sy;
  // the low arc that reaches the aim point at this speed
  const v2 = speed * speed, disc = v2 * v2 - g * (g * dh * dh + 2 * dy * v2);
  let th = disc >= 0 ? Math.atan((v2 - Math.sqrt(disc)) / (g * dh)) : Math.PI / 4;
  // a snap shot wanders; a full draw flies true
  const spread = (1 - k) * 0.03 + wobble * 0.05 + (e === GAME.player ? 0 : 0.008);
  const yawJ = (Math.random() - 0.5) * 2 * spread, thJ = (Math.random() - 0.5) * 2 * spread;
  th += thJ;
  const hx = dx / dh, hz = dz / dh, c = Math.cos(yawJ), s = Math.sin(yawJ);
  const ux = hx * c - hz * s, uz = hx * s + hz * c;
  const A = { ox: sx, oy: sy, oz: sz, x: sx, y: sy, z: sz, px: sx, py: sy, pz: sz, vx: ux * Math.cos(th) * speed, vy: Math.sin(th) * speed, vz: uz * Math.cos(th) * speed, src: e.id, faction: e.faction, k, type, age: 0, tgt: target ? target.id : null, // [walls] ox, oy, oz: where it was loosed (07g_walls.js)
    mult: (0.55 + 1.05 * Math.pow(k, 1.2)) * archerHighK(e), crit: k >= 0.98 ? 0.2 : 0, wind: archerWindK(e) }; // [balance5] noWind: the wind moved a Thule arrow not at all [balance7] the realm's ways on their own ground (07c_balance7.js)
  CLS.arrows.push(A);
  CLS.stats.drawn++;
  setAct(e, 2, 0.55, 0.8);
  faceToward(e, tx, tz);
  sfxAtE('bow', e); // [audio2] placed (11c_sound.js)
  if (type === 'fire') sfxAtE('ignite', e);
  if (k >= 0.98 && e === GAME.player) FX.burst(sx, sy, sz, 8, [2.0, 1.8, 1.2], 2, 0.25, 0.06, 0);
  return A;
}
function stepArrows(dt) {
  const wx = U.uWindDir.value.x * U.uWind.value * 0.9, wz = U.uWindDir.value.y * U.uWind.value * 0.9;
  for (let i = CLS.arrows.length - 1; i >= 0; i--) {
    const A = CLS.arrows[i];
    A.age += dt;
    A.px = A.x; A.py = A.y; A.pz = A.z;
    A.vy -= 9.8 * dt;
    { const wk = A.wind ?? 1; A.vx += wx * dt * wk; A.vz += wz * dt * wk; } // [balance5] a Thule arrow half as much (07c_balance5.js)
    A.x += A.vx * dt; A.y += A.vy * dt; A.z += A.vz * dt;
    if (A.type === 'fire' && Math.random() < 0.6) FX.trail(A.x, A.y, A.z, [2.4, 1.05, 0.3], 0.18, 0.28);
    // what it strikes on the way: a body, a wall, the ground
    const src = getEnt(A.src);
    // [walls] the first wall, roof, floor or rock in this step's flight (07g_walls.js): a body beyond it is not struck
    const WH = shotHit(A.px, A.py, A.pz, A.x, A.y, A.z, { ox: A.ox, oy: A.oy, oz: A.oz, ground: false });
    let hit = null, best = WH ? WH.t : 9;
    const mx = (A.x + A.px) / 2, mz = (A.z + A.pz) / 2, seg = Math.hypot(A.x - A.px, A.z - A.pz);
    forNear(mx, mz, seg / 2 + 2.5, (o) => {
      if (!o.alive || o.kind === 'door' || o.flying || o.faction === A.faction || (o.faction === FACTION_NEUTRAL && !(o.game && GAME.player && A.src === GAME.player.id)) || o.id === A.src) return; // [depth] the player's arrows strike game: deer and birds
      const r = o.radius * (o.scale || 1) + 0.22, top = o.y + 1.9 * (o.scale || 1);
      // closest approach of this step's segment to the body's upright axis
      const sx = A.x - A.px, sz = A.z - A.pz, L2 = sx * sx + sz * sz || 1e-6;
      const u = clamp(((o.x - A.px) * sx + (o.z - A.pz) * sz) / L2, 0, 1);
      const cx = A.px + sx * u, cz = A.pz + sz * u, cy = A.py + (A.y - A.py) * u;
      const d = Math.hypot(cx - o.x, cz - o.z);
      if (d < r && cy > o.y - 0.1 && cy < top && u < best) { best = u; hit = o; }
    });
    if (hit) {
      CLS.arrows.splice(i, 1);
      arrowHits(A, hit, src);
      continue;
    }
    if (WH) { CLS.arrows.splice(i, 1); const sp = Math.hypot(A.vx, A.vy, A.vz) || 1; wallStrike('arrow', WH, A.vx / sp, A.vy / sp, A.vz / sp, src || { id: A.src, faction: A.faction }, sp, A.type); continue; } // [walls] it sticks or glances
    const gy = heightAt(A.x, A.z);
    const wq = inDungeon(A) ? null : waterAt(A.x, A.z), surf = wq ? wq.y : -Infinity; // [water] an arrow stops at the water's surface
    const blocked = false; // [walls] walls are met above (shotHit)
    // [v9] (the Barrow's floors lie far below the lakes: an arrow there is not under water)
    if (A.y <= gy || A.y <= surf || blocked || A.age > 4 || (!inDungeon(A) && A.y < WATER_Y - 2)) {
      CLS.arrows.splice(i, 1);
      const x = blocked ? A.px : A.x, z = blocked ? A.pz : A.z, y = blocked ? A.py : gy;
      const inWater = !blocked && (A.y <= surf || isWaterAt(x, z)), wy = surf > -Infinity ? surf : WATER_Y;
      if (A.type === 'fire') { if (!inWater) fireLandsAt(x, y, z, 1, A.src); else steamPuff(x, wy + 0.1, z, 3); } // [depth] the archer
      if (inWater) { splashAt(x, z, 0.3, { up: 1.2 }); continue; }
      FX.dust(x, y, z, 2);
      // it stays where it fell, and a special arrow can be picked up again
      const sp = Math.hypot(A.vx, A.vy, A.vz) || 1;
      if (CLS.stuck.length > 60) CLS.stuck.shift();
      CLS.stuck.push({ x, y: y + (blocked ? 0 : 0.25), z, dx: A.vx / sp, dy: A.vy / sp, dz: A.vz / sp, type: A.type, until: GAME.t + 60, src: A.src, wall: blocked });
    }
  }
  // arrows lying about: the player walks over the special ones and takes them back
  const P = GAME.player;
  for (let i = CLS.stuck.length - 1; i >= 0; i--) {
    const S = CLS.stuck[i];
    if (GAME.t > S.until) { CLS.stuck.splice(i, 1); continue; }
    if (P && P.alive && S.src === P.id && S.type !== 'plain' && !S.wall && dist2(P.x, P.z, S.x, S.z) < 1.4 * 1.4) {
      CLS.stuck.splice(i, 1);
      if (Math.random() < 0.6) goodsAdd(ARROW_DEF[S.type].good, 1, true), uiLog(`You pull a ${ARROW_DEF[S.type].short.toLowerCase()} arrow out of the ground.`, 'loot');
      else uiLog('The arrow snapped when it fell.', 'sys');
    }
  }
}
function arrowHits(A, o, src0) {
  const src = src0 || { id: A.src, level: GAME.prog ? GAME.prog.level : 20, dmgMult: 1, faction: A.faction, buffs: [], role: 'none', scale: 1, alive: false };
  const r = computeDamage(src, o, A.mult);
  let d = r.d, crit = r.crit;
  if (!crit && Math.random() < A.crit) { d *= 1.5; crit = true; }
  const opts = { crit, kind: 'arrow', arrow: A.type, pierce: A.type === 'bodkin' ? BODKIN_PIERCE : false, drawn: A.k }; // [balance3] bodkins pierce half the armour
  if (A.type === 'fire') opts.elem = 'fire';
  dealDamage(src, o, d, opts);
  if (A.k >= 0.98 && src0 && clsHas(src0, 'track')) addBuff(o, 'tracked', 1, 30, A.src);
  if (A.k >= 0.98 && src0 === GAME.player) uiFloatAt(o.x, o.y + 2.5 * (o.scale || 1), o.z, 'Full draw', 'crit');
  FX.sparks(A.x, A.y, A.z);
  if (A.type === 'fire') fireLandsAt(A.x, A.y, A.z, 0.8, src); // [depth] the archer
  sfxAt('hit', A.x, A.y, A.z); // [audio2] placed (11c_sound.js)
}
// the special heads do their own work once an arrow (drawn or from an ability) strikes
function arrowEffect(src, dst, dmg, type, opts) {
  if (type === 'broadhead') { addBuff(dst, 'bleed', dmg * 0.25 / 6, 6, src.id); addBuff(dst, 'wound', woundOf(src), 6, 'wound'); } // [balance2] and the wound mends slowly (healWound) [balance3] deeper from rank II
  else if (type === 'fire') { if (wetOf(dst) < 0.5 && !(rainHere(dst) > 0.3 && Math.random() < 0.3)) { const r = computeDamage(src, dst, 0.4); addBuff(dst, 'burn', r.d / 6, 6, src.id); } else steamPuff(dst.x, dst.y + 1.2, dst.z, 3); }
  else if (type === 'blunt') {
    bluntBreak(src, dst, opts); // [balance2] not a steadfast priest's [balance9] and only from a full draw, an Aimed Shot or Deadeye: a quick one sets the spell back (07c_balance9.js)
    addBuff(dst, 'snare', 0.35, 2, src.id);
    if (dst.fixedY === null && dst.role !== 'boss' && dst.role !== 'dungeonBoss') { const d = Math.max(0.3, dist(src.x, src.z, dst.x, dst.z)); stepTo(dst, dst.x + (dst.x - src.x) / d * 1.5, dst.z + (dst.z - src.z) / d * 1.5); }
  }
}
// the arrow kinds modify the harm before it lands (asked from classHarm through opts.arrow)
function arrowHarm(src, dst, opts) {
  const type = opts.arrow;
  if (type === 'broadhead' && (dst.kind !== 'humanoid' || dst.drBase < 0.1)) return 1.2;
  if (type === 'bodkin' && (dst.cls === 'warrior' || dst.drBase >= 0.1)) return 1.15;
  if (type === 'blunt') return UNDEAD.has(dst.mobType) ? 0.9 : 0.7;
  return 1;
}

/* ---- hiding: long grass and the woods hide an archer who keeps still or walks softly ---- */
function coverAt(e) {
  if (inDungeon(e) || e.y > heightAt(e.x, e.z) + 1.2) return 0;
  let g = clamp(sampleGrid(W.grass, e.x, e.z) + 0.6 * sampleGrid(W.field, e.x, e.z), 0, 1);
  if (typeof natGet === 'function' && NATURE.built) g *= (1 - natGet(e.x, e.z, 0)) * (1 - natGet(e.x, e.z, 1));
  g = clamp((g - 0.35) / 0.5, 0, 1);
  let trees = 0;
  if (typeof natTreesNear === 'function' && NATURE.built) natTreesNear(e.x, e.z, 7, (t) => { if (!t.felled && t.grow > 0.5) trees++; });
  return Math.max(g * 0.95, clamp(trees / 3, 0, 1));
}
function breakHiding(e, sec) {
  const cs = csOf(e);
  if (cs.hidden && e === GAME.player) uiLog('You are seen.', 'sys');
  cs.hidden = false; cs.hideT = 0; cs.hideBreak = nowT() + sec;
}
function updateHiding(e, dt) {
  const cs = csOf(e);
  if (!clsHas(e, 'hide') || !e.alive || e.mount) { cs.hidden = false; cs.hideT = 0; return; }
  cs.coverT = (cs.coverT || 0) - dt;
  if (cs.coverT <= 0) { cs.coverT = 0.25; cs.cover = coverAt(e); }
  const sp = e.anim ? e.anim.amt * 4.3 : 0;
  const still = sp < archerHideWalk(e); // [balance7] Eriu's walk hidden among trees (07c_balance7.js)
  // no hiding in the thick of a fight: three quiet seconds first
  const ok = cs.cover >= 0.55 && still && nowT() > cs.hideBreak && !e.casting && nowT() > e.combatUntil - 3;
  if (ok) {
    cs.hideT += dt;
    if (!cs.hidden && cs.hideT >= archerHideT(e)) { // [balance7]
      cs.hidden = true;
      if (e === GAME.player) { uiLog('You are hidden. Your first shot from cover strikes harder.', 'sys'); classCue('hidden'); }
      // foes at a distance lose sight of you
      forNear(e.x, e.z, 45, (o) => { if (o.alive && o.target === e.id && isEnemy(o, e) && dist2(o.x, o.z, e.x, e.z) > 9 * 9 && o.role !== 'boss') { o.target = null; if (o.threat) o.threat.delete(e.id); } });
    }
  } else { if (cs.hidden && (cs.cover < 0.4 || !still)) { cs.hidden = false; if (e === GAME.player) uiLog('You leave cover.', 'sys'); } if (!still || cs.cover < 0.55) cs.hideT = 0; }
}
// can o (an NPC) see e? A hidden archer is seen only close by (08_ai.js asks in pickTarget and the creatures' aggro)
function classSeen(o, e, d2) { return !(e.cs && e.cs.hidden) || d2 < 7 * 7; }

/* ---- snares ---- */
function laySnare(e) {
  const mine = CLS.snares.filter((s) => s.owner === e.id && !s.sprung);
  if (mine.length >= 2) snareEnd(mine[0]);
  const x = e.x + Math.sin(e.yaw) * 1.2, z = e.z + Math.cos(e.yaw) * 1.2;
  const S = { x: isWalkable(x, z) ? x : e.x, z: isWalkable(x, z) ? z : e.z, owner: e.id, faction: e.faction, level: e.level, yaw: Math.random() * TAU, armAt: GAME.t + 1.0, until: GAME.t + 90, sprung: false, close: 0, caught: null, thule: realmFlavour(e) && e.faction === 2 };
  S.y = floorAt(S.x, S.z, e.y + 0.3);
  CLS.snares.push(S);
  snareMesh(S);
  setAct(e, 12, 0.7);
  classSfx('snareset', S.x, S.z);
  return S;
}
function snareEnd(S) { S.dead = true; if (S.mesh) { S.mesh.removeFromParent(); S.mesh = null; } const i = CLS.snares.indexOf(S); if (i >= 0) CLS.snares.splice(i, 1); }
function stepSnares(dt) {
  for (let i = CLS.snares.length - 1; i >= 0; i--) {
    const S = CLS.snares[i];
    if (GAME.t > S.until) { snareEnd(S); continue; }
    if (S.sprung) { S.close = Math.min(1, S.close + dt * 14); if (GAME.t > S.sprung + 4) snareEnd(S); continue; }
    if (GAME.t < S.armAt) continue;
    let prey = null;
    forNear(S.x, S.z, 1.6, (o) => { if (!prey && o.alive && isActor(o) && !o.flying && o.faction !== S.faction && o.faction !== FACTION_NEUTRAL && o.role !== 'boss' && o.role !== 'critter' && dist2(o.x, o.z, S.x, S.z) < (0.55 + o.radius * (o.scale || 1)) ** 2 && Math.abs(o.y - S.y) < 1) prey = o; });
    if (!prey) continue;
    S.sprung = GAME.t; S.caught = prey.id;
    CLS.stats.snared++;
    const src = getEnt(S.owner) || { id: S.owner, level: S.level, dmgMult: 1, faction: S.faction, buffs: [], role: 'none', scale: 1, alive: false };
    const r = computeDamage(src, prey, 0.7);
    dealDamage(src, prey, r.d, { kind: 'melee', snare: true });
    addBuff(prey, 'root', 1, snareHold(S), S.owner); // [balance] 4 and 3 [balance5] Thule 4.5 (07c_balance5.js) [balance7] Thule's in the cold (07c_balance7.js)
    // [balance] the cord whips about: whoever runs beside the prey is slowed
    forNear(S.x, S.z, 5, (o) => { if (o !== prey && o.alive && isActor(o) && !o.flying && o.faction !== S.faction && o.faction !== FACTION_NEUTRAL && o.role !== 'critter') addBuff(o, 'snare', 0.5, 3.5, S.owner); }); // [balance2] 4 m, 40% for 2.5 s: a snare buys time against a pack
    if (snareCold(S)) addChill(prey, 3, src); // [balance7] in the cold
    FX.sparks(S.x, S.y + 0.2, S.z);
    classSfx('snare', S.x, S.z);
    if (prey === GAME.player) uiError('You are caught in a snare!');
    else if (S.owner === (GAME.player && GAME.player.id)) uiLog(`Your snare catches ${theName(prey)}.`, 'level');
  }
}

/* ------------------------------------------------------------------ */
/* the priest: prayer, holy ground, raising the fallen                 */
/* ------------------------------------------------------------------ */
function startPrayer(e) {
  const cs = csOf(e);
  if (e.cls !== 'priest' || !e.alive || e.casting || e.mount || isStunned(e) || e.carrying != null) return false;
  cs.praying = true; cs.prayT = 0;
  return true;
}
function stopPrayer(e) { const cs = csOf(e); if (!cs.praying) return; cs.praying = false; if (e === GAME.player && cs.prayT > 0.4) uiLog('Your prayer ends.', 'sys'); }
function consecrate(e, A, t, cast, rk) {
  const cs = csOf(e);
  cs.dev = Math.max(0, devOf(e) - 35);
  const x = e.x, z = e.z, r = 6.5;
  if (CLS.grounds.length >= 6) CLS.grounds.shift();
  const G = { x, z, r, src: e.id, faction: e.faction, realm: realmFlavour(e) ? e.faction : -1, level: e.level, t0: GAME.t, until: GAME.t + 12, tick: 0.3, rk, sanct: sanctified(e) };
  CLS.grounds.push(G);
  CLS.stats.consecrated++;
  G.disc = spellDisc(x, z, r, DISC_KIND.consecrate, 12.3, G.realm === 2 ? [2.2, 1.3, 0.6] : G.realm === 1 ? [1.2, 1.9, 1.0] : [1.9, 1.6, 0.9]);
  spellPillar(x, heightAt(x, z), z, 1.4, 16, 1.0, [1.9, 1.6, 0.9]);
  lightFlash(x, heightAt(x, z) + 2, z, 14, [2.6, 2.2, 1.3], 0.7);
  setAct(e, 12, 0.9);
  sfxAtE('pillar', e); // [audio2] placed (11c_sound.js)
}
function raiseFallen(e, A, t, cast, rk) {
  const cs = csOf(e);
  const f = fallenNear(e, 10);
  if (!f) { if (e === GAME.player) uiError('There is no one to raise'); return; }
  cs.dev = Math.max(0, devOf(e) - 70);
  f.alive = true; f.hp = f.maxHp * 0.4; f.deadAt = 0; f.removeAt = 0; f.buffs.length = 0; f.casting = null; f.threat = null; f.damagers = null;
  f.anim.death = 0;
  if (f.role === 'guard' && f.keep) f.keep.guards.add(f.id);
  if (f.role === 'guardian' && f.temple) f.temple.guardians.add(f.id);
  addBuff(f, 'shield', f.maxHp * 0.2, 6, e.id);
  CLS.stats.raised++;
  spellPillar(f.x, f.y, f.z, 1.1, 18, 1.4, [2.2, 1.9, 1.1]);
  FX.levelUp(f.x, f.y, f.z);
  lightFlash(f.x, f.y + 2, f.z, 12, [2.6, 2.2, 1.3], 0.8);
  sfxAtE('raise', e); // [audio2] placed (11c_sound.js)
  if (e === GAME.player) uiLog(`You raise ${theName(f)} from the field.`, 'level');
  else if (GAME.player && dist2(e.x, e.z, GAME.player.x, GAME.player.z) < 60 * 60) uiLog(`${e.name} raises ${f.name} from the field.`, 'realm', e.faction);
}
// a friend of e's realm who fell here a moment ago (and can still be raised)
function fallenNear(e, r) {
  let best = null, bd = r * r;
  for (const o of ENT) {
    if (o.alive || o.removed || o.kind !== 'humanoid' || o.faction !== e.faction || o.role === 'player' || o.role === 'lord' || o.role === 'muster' || o.role === 'villager' || o.role === 'herald' || o.role === 'merchant') continue;
    if (GAME.t - o.deadAt > 9 || o.removeAt - GAME.t < 0.5) continue;
    const d2 = dist2(o.x, o.z, e.x, e.z);
    if (d2 < bd) { bd = d2; best = o; }
  }
  return best;
}
function stepGrounds(dt) {
  for (let i = CLS.grounds.length - 1; i >= 0; i--) {
    const G = CLS.grounds[i];
    if (GAME.t > G.until) { CLS.grounds.splice(i, 1); continue; }
    G.tick -= dt;
    if (G.tick > 0) continue;
    G.tick = 1;
    const src = getEnt(G.src) || { id: G.src, level: G.level, dmgMult: 0.85, faction: G.faction, buffs: [], role: 'none', scale: 1, alive: false, cls: 'priest' };
    forNear(G.x, G.z, G.r, (o) => {
      if (!o.alive || !isActor(o) || dist2(o.x, o.z, G.x, G.z) > G.r * G.r || o.flying) return;
      if (o.faction === G.faction) {
        healEnt(src, o, o.maxHp * 0.03 * (G.realm === 1 ? 1.5 : 1) * (G.sanct ? 1.15 : 1), true);
        if (G.realm === 0) addBuff(o, 'hallowed', 1, 1.2, 'hallowed');
      } else if (o.faction !== FACTION_NEUTRAL) {
        hallowDazzle(G, o); // [balance5] holy ground dazzles the foes on it (07c_balance5.js)
        if (isUndead(o) || G.realm === 2) {
          const r = computeDamage(src, o, (isUndead(o) ? 0.55 : 0.3) * G.rk);
          dealDamage(src, o, r.d, { crit: r.crit, kind: 'holy', holy: true });
          if (isUndead(o) && o.alive) addBuff(o, 'snare', 0.3, 1.2, G.src);
        }
      }
    });
    if (dist2(G.x, G.z, camera.position.x, camera.position.z) < 80 * 80) for (let k = 0; k < 12; k++) { const a = Math.random() * TAU, rr = Math.sqrt(Math.random()) * G.r, x = G.x + Math.cos(a) * rr, z = G.z + Math.sin(a) * rr; fxAdd.emit(x, heightAt(x, z) + 0.1, z, 0, 0.7 + Math.random() * 0.8, 0, 1.4 + Math.random(), 1.9, 1.6, 0.8, 0.1, -0.25, 0.3); }
  }
}

/* ------------------------------------------------------------------ */
/* the class technique (T) and the held action (X)                     */
/* ------------------------------------------------------------------ */
// T: the warrior changes stance, the archer lays a snare, the mage turns their focus, the priest consecrates or raises
function classTechnique(e = GAME.player) {
  if (!e || !e.alive || !e.cls) return 'dead';
  const cs = csOf(e);
  if (e.cls === 'warrior') {
    if (!clsHas(e, 'stances')) return 'locked';
    if (nowT() - cs.stanceAt < 0.8) return 'cooldown';
    return setStance(e, (cs.stance + 1) % 3);
  }
  if (e.cls === 'archer') {
    if (!clsHas(e, 'snare')) return 'locked';
    const r = useAbility(e, 'snare', null);
    return r;
  }
  if (e.cls === 'mage') {
    if (!clsHas(e, 'focus')) return 'locked';
    const list = clsHas(e, 'storm') ? ELEMENTS : ['fire', 'frost'];
    return setFocus(e, list[(list.indexOf(cs.focus) + 1) % list.length]);
  }
  if (e.cls === 'priest') {
    if (clsHas(e, 'raise') && fallenNear(e, 10) && devOf(e) >= 70) return useAbility(e, 'raise', null);
    if (!clsHas(e, 'consecrate')) return 'locked';
    if (devOf(e) < 35) return 'devotion';
    return useAbility(e, 'consecrate', null);
  }
  return 'none';
}
function setStance(e, s) {
  const cs = csOf(e);
  if (cs.stance === s) return true;
  cs.stance = s; cs.stanceAt = nowT();
  setAct(e, 5, 0.4);
  const c = s === 0 ? [1.5, 1.5, 1.7] : s === 1 ? [1.8, 1.6, 1.0] : [2.4, 0.8, 0.3];
  FX.ring(e.x, e.y + 0.2, e.z, 1.0, c, 20, 1.6);
  if (e === GAME.player) { uiLog(`${STANCES[s].name} stance.`, 'sys'); sfx(s === 2 ? 'whirl' : 'equip'); classCue('stance'); }
  return true;
}
function setFocus(e, el) {
  const cs = csOf(e);
  if (cs.focus === el) return true;
  cs.focus = el;
  setAct(e, 3, 0.35, 0.6);
  FX.burst(e.x + Math.sin(e.yaw) * 0.4, e.y + 1.5, e.z + Math.cos(e.yaw) * 0.4, 14, ELEM_COL[el], 1.5, 0.4, 0.12, 0);
  if (e === GAME.player) { uiLog(`Your focus turns to ${el}.`, 'sys'); sfx(el === 'fire' ? 'ignite' : el === 'frost' ? 'frost' : 'zap'); classCue('focus'); }
  return true;
}
// X held: the warrior raises the shield, the archer draws, the priest kneels to pray
function classHold(on, src = 'key') {
  const P = GAME.player;
  if (!P || !GAME.started) return;
  if (on && (UI.modal || !P.alive)) return;
  CLS.hold = on; CLS.holdSrc = on ? src : null;
  if (P.cls === 'warrior') setBlock(P, on);
  else if (P.cls === 'archer') { if (on) startDraw(P); else { const t = getEnt(P.target); releaseDraw(P, t && t.alive && isEnemy(P, t) ? t : null); } }
  else if (P.cls === 'priest') { if (on) startPrayer(P); else stopPrayer(P); }
  else if (P.cls === 'mage' && on) { const t = getEnt(P.target); if (t && t.alive && isEnemy(P, t)) uiFloatAt(P.x, P.y + 2.4, P.z, comboHint(P, t) || 'No reaction', 'xp'); }
}
// the arrow chosen for the next shots (Y): only kinds the archer carries
function cycleArrow(e = GAME.player) {
  if (!e || e.cls !== 'archer') return;
  if (!clsHas(e, 'arrows')) { uiError(`Special arrows come at level ${CLASS_UNLOCK.archer.arrows}`); return; }
  const cs = csOf(e);
  const have = ARROW_TYPES.filter((k) => k === 'plain' || goodsHave(ARROW_DEF[k].good, 1));
  const i = have.indexOf(cs.arrow);
  cs.arrow = have[(i + 1) % have.length];
  uiLog(`${ARROW_DEF[cs.arrow].name}${cs.arrow === 'plain' ? '' : ` (${goodsCount(ARROW_DEF[cs.arrow].good)})`}.`, 'sys');
  sfx('click');
}
// the combo cue: what the target's state means for the mage's next spell
function comboHint(e, t) {
  if (!t || !t.alive) return '';
  if (frozenOf(t)) return 'Frozen: storm shatters it, fire bursts it into steam';
  if (burningOf(t)) return 'Burning: storm overloads it, frost quenches it';
  if (chillOf(t) > 0) return `Chilled ${Math.floor(chillOf(t))}/3: more frost freezes, fire makes steam`;
  if (wetOf(t) > 0.3) return 'Wet: storm arcs further and harder, fire is damped';
  return '';
}

/* ------------------------------------------------------------------ */
/* NPCs: every calling uses its craft                                  */
/* ------------------------------------------------------------------ */
// called from npcAbilities (08_ai.js) at its own pace; returns true when it acted
function classNpc(e, t) {
  if (!e.cls || e.testDummy || e.role === 'player') return false;
  const cs = csOf(e);
  const near = (r, pred) => { let n = 0; forNear(e.x, e.z, r, (o) => { if (o.alive && isActor(o) && pred(o)) n++; }); return n; };
  if (e.cls === 'warrior') {
    if (clsHas(e, 'stances') && nowT() - cs.stanceAt > 6) {
      const foes = near(6, (o) => isEnemy(e, o));
      // [balance3] guarded against a bow out of reach: the shield wall (npcClassStep raises it)
      const want = e.hp < e.maxHp * 0.35 || foes >= 3 || npcWallWanted(e, t) ? 0 : t && t.alive && (t.hp < t.maxHp * 0.4 || e.hp > e.maxHp * 0.7) ? 2 : 1;
      if (want !== cs.stance) setStance(e, want);
    }
    if (t && t.alive && clsHas(e, 'momentum') && momOf(e) >= FIN_MIN + (Math.random() < 0.5 ? 1 : 0) && !canUse(e, 'slash', t)) { useAbility(e, 'slash', t); return true; }
    // a foe holding off at range: close the gap
    if (t && t.alive && e.fixedY === null && (!e.ai.post || e.ai.post.leash > 6)) {
      const d = dist(e.x, e.z, t.x, t.z);
      if (d > 7 && d < 24 && ABILITIES.leap.level <= e.level && !canUse(e, 'leap', t)) { useAbility(e, 'leap', t); return true; }
      if (d > 6 && d < 28 && ABILITIES.charge.level <= e.level && !canUse(e, 'charge', t)) { useAbility(e, 'charge', t); return true; }
    }
    return false;
  }
  if (e.cls === 'archer') {
    if (t && t.alive) {
      if (clsHas(e, 'arrows')) cs.arrow = t.cls === 'warrior' || t.drBase >= 0.1 ? 'bodkin' : t.kind !== 'humanoid' ? 'broadhead' : t.casting || UNDEAD.has(t.mobType) ? 'blunt' : wetOf(t) < 0.3 && rainHere(e) < 0.2 ? 'fire' : 'broadhead';
      const d = dist(e.x, e.z, t.x, t.z);
      if (clsHas(e, 'snare') && d < 11 && !t.rangedKind && t.target === e.id && !canUse(e, 'snare', null) && !CLS.snares.some((s) => s.owner === e.id && !s.sprung && dist2(s.x, s.z, e.x, e.z) < 25)) { e.yaw = Math.atan2(t.x - e.x, t.z - e.z); useAbility(e, 'snare', null); return true; }
      // a blade at the throat: no long draws or slow shots, but a leap back, a snare or a quick shot
      const pressed = nearestWhere(e.x, e.z, 4.5, (o) => o.alive && isEnemy(e, o) && isActor(o) && !o.rangedKind && o.target === e.id && Math.abs(o.y - e.y) < 2.2); // [v12] at about its height: a foe on the ladder below a tower's top presses nobody
      if (pressed) {
        if (e.level >= ABILITIES.tumble.level && !canUse(e, 'tumble', null) && e.fixedY === null) { e.yaw = Math.atan2(pressed.x - e.x, pressed.z - e.z); useAbility(e, 'tumble', null); return true; }
        for (const id of ['cripple', 'quickshot']) if (ABILITIES[id].level <= e.level && !canUse(e, id, t)) { useAbility(e, id, t); return true; }
        return true;
      }
      if (!cs.npcDraw && d > 8 && d < e.rangedRange + 6 && Math.random() < 0.55 && e.power > 20) { cs.npcDraw = { until: nowT() + 0.6 + Math.random() * 0.8 }; startDraw(e); return true; }
    }
    return false;
  }
  if (e.cls === 'mage') {
    if (!t || !t.alive) return false;
    const d = dist(e.x, e.z, t.x, t.z);
    const go = (id, focus) => { if (ABILITIES[id].level > e.level) return false; if (focus && clsHas(e, 'focus')) cs.focus = focus; if (!canUse(e, id, t)) { useAbility(e, id, t); return true; } return false; };
    // a blade at the throat: no long casts, but a nova, a blink away or an instant lance
    const pressed = nearestWhere(e.x, e.z, 4.5, (o) => o.alive && isEnemy(e, o) && isActor(o) && !o.rangedKind && o.target === e.id && Math.abs(o.y - e.y) < 2.2); // [v12] at about its height: a foe on the ladder below a tower's top presses nobody
    if (pressed) {
      if (go('nova', frozenOf(pressed) ? 'storm' : 'frost')) return true;
      if (e.level >= ABILITIES.blink.level && e.fixedY === null && !canUse(e, 'blink', null)) { e.yaw = Math.atan2(e.x - pressed.x, e.z - pressed.z); if (clsHas(e, 'focus')) cs.focus = 'frost'; useAbility(e, 'blink', null); return true; }
      if (e.level >= ABILITIES.ward.level && e.hp < e.maxHp * 0.8 && go('ward', 'frost')) return true;
      if (go('frost', null)) return true;
      return true;
    }
    // close foes: a nova of the right element
    if (d < 6 && clsHas(e, 'focus') && (near(6, (o) => isEnemy(e, o)) >= 2 || e.hp < e.maxHp * 0.5)) { if (go('nova', frozenOf(t) ? 'storm' : chillOf(t) > 0 || burningOf(t) ? 'frost' : clsHas(e, 'storm') && wetOf(t) > 0.3 ? 'storm' : 'frost')) return true; }
    // the combos: storm on the frozen, the burning and the wet; fire on the chilled; frost on the burning
    if ((frozenOf(t) || burningOf(t) || wetOf(t) > 0.3) && go('chain', 'storm')) return true;
    if ((chillOf(t) > 0 || frozenOf(t)) && go('firebolt', 'fire')) return true;
    if (burningOf(t) && go('frost', 'frost')) return true;
    if (clsHas(e, 'focus') && Math.random() < 0.3) cs.focus = pick(Math.random, clsHas(e, 'storm') ? ELEMENTS : ['fire', 'frost']);
    return false;
  }
  if (e.cls === 'priest') {
    if (clsHas(e, 'raise') && devOf(e) >= 70) { const f = fallenNear(e, 12); if (f && !canUse(e, 'raise', null)) { useAbility(e, 'raise', null); return true; } }
    if (clsHas(e, 'consecrate') && devOf(e) >= 35 && !canUse(e, 'consecrate', null) && !CLS.grounds.some((G) => G.faction === e.faction && dist2(G.x, G.z, e.x, e.z) < 36)) {
      const hurt = near(7, (o) => o.faction === e.faction && o.hp < o.maxHp * 0.8);
      const dead = near(8, (o) => isEnemy(e, o) && isUndead(o));
      if (hurt >= 2 || dead >= 2 || (t && t.alive && hurt >= 1 && dist(e.x, e.z, t.x, t.z) < 6)) { useAbility(e, 'consecrate', null); return true; }
    }
    // with no one to mend, a priest smites; the dead are smitten even then, unless a friend is near death
    let need = 1;
    forNear(e.x, e.z, 28, (o) => { if (o.alive && o.faction === e.faction && isActor(o)) need = Math.min(need, o.hp / o.maxHp); });
    if (t && t.alive && ((isUndead(t) && need > 0.4) || (need > 0.62 && Math.random() < (dist(e.x, e.z, t.x, t.z) > 6 ? 0.85 : 0.5))) && !canUse(e, 'smite', t)) { useAbility(e, 'smite', t); return true; }
    return false;
  }
  return false;
}
// the NPC side of the held actions: shields come up against a swing, bows are drawn and loosed, priests pray
function npcClassStep(e, dt) {
  const cs = e.cs;
  if (!cs || !e.alive || e.testDummy) return;
  if (e.bot) { botStep(e, dt); return; } // [balance] a bot plays its calling (07c_balance.js)
  const t = nowT();
  if (e.cls === 'warrior') {
    // [balance3] a shield wall against a bow: guarded, the shield stays up on the way in and comes down in reach
    if (cs.stance === 0 && canBlock(e) && !e.casting && npcWallWanted(e, getEnt(e.target))) { if (!cs.blockOn) { setBlock(e, true); cs.blockAt = -9; } cs.npcBlockUntil = t + 0.3; }
    if (cs.blockOn && t > cs.npcBlockUntil) setBlock(e, false);
    if (!cs.blockOn) cs.guard = Math.min(100, cs.guard + dt * 12);
    if (!cs.blockOn && canBlock(e) && clsHas(e, 'block') && e.target != null && t > (cs.npcReact || 0)) {
      // a swing coming at them: read it and raise the shield in time (the better the soldier, the more often)
      forNear(e.x, e.z, 4.5, (o) => {
        if (cs.blockOn || !o.alive || o.target !== e.id || !isEnemy(o, e) || o.rangedKind) return;
        const a = o.anim.act;
        if ((a === 1 || a === 8) && o.anim.actT < 0.1 && cs.guard > 20) {
          cs.npcReact = t + 0.45;
          // a seasoned soldier reads the swing and parries it; a greener one gets the shield up in time to take it
          const parryP = clamp(0.1 + 0.004 * e.level + (realmFlavour(e) && e.faction === 0 ? 0.06 : 0), 0, 0.35);
          const blockP = 0.25 + (cs.stance === 0 ? 0.3 : 0);
          const r = Math.random();
          if (r < parryP + blockP) {
            setBlock(e, true);
            if (r >= parryP) cs.blockAt = -9;
            cs.npcBlockUntil = t + 0.45 + (cs.stance === 0 ? 0.6 : 0);
            faceToward(e, o.x, o.z);
          }
        }
      });
    }
  } else if (e.cls === 'archer') {
    if (cs.npcDraw && (t > cs.npcDraw.until || !e.alive)) {
      const tg = getEnt(e.target);
      cs.npcDraw = null;
      if (tg && tg.alive && isEnemy(e, tg)) { faceToward(e, tg.x, tg.z); releaseDraw(e, tg); } else cs.drawFrom = -1;
    }
    if (cs.drawFrom >= 0 && !cs.npcDraw) cs.drawFrom = -1;
    updateHiding(e, dt);
  } else if (e.cls === 'priest') {
    // idle priests kneel and pray
    const idle = e.target == null && t > e.combatUntil + 4 && (!e.ai || !e.ai.order);
    if (idle && !cs.praying && devOf(e) < 70 && e.role !== 'soldier' && Math.random() < dt * 0.05) startPrayer(e);
    if (cs.praying && (!idle || cs.dev >= 100)) stopPrayer(e);
  }
  if (cs.praying) prayStep(e, dt);
}
function prayStep(e, dt) {
  const cs = e.cs;
  const moving = e.anim && e.anim.amt > 0.15;
  if (moving || isStunned(e) || e.casting) { stopPrayer(e); return; }
  cs.prayT += dt;
  addDev(e, dt * (cs.prayT > 0.8 ? 12 : 0));
  e.power = Math.min(e.maxPower, e.power + e.maxPower * dt * 0.04);
  if (cs.prayT > 0.8 && dist2(e.x, e.z, camera.position.x, camera.position.z) < 40 * 40 && Math.random() < dt * 6) fxAdd.emit(e.x + (Math.random() - 0.5) * 0.6, e.y + 0.2, e.z + (Math.random() - 0.5) * 0.6, 0, 0.9, 0, 1.6, 1.8, 1.5, 0.7, 0.09, -0.2, 0.3);
}

/* ------------------------------------------------------------------ */
/* speed, animation, auto-attack                                       */
/* ------------------------------------------------------------------ */
function classSpeedMult(e) {
  let s = 1;
  const ch = e.buffs.length ? chillOf(e) : 0;
  if (ch) s *= 1 - 0.13 * Math.floor(ch + 1e-6);
  const cs = e.cs;
  if (cs) {
    // in fury a warrior shrugs off much of a slow
    if (cs.stance === 2 && e.cls === 'warrior') { const sn = buffMax(e, 'snare'); if (sn > 0 && !hasBuff(e, 'free')) s *= (1 - 0.6 * sn) / (1 - sn); }
    if (cs.blockOn) s *= cs.stance === 0 && e.cls === 'warrior' ? SHIELD_WALL_PACE : 0.55; // [balance3] guarded, a warrior walks on behind the raised shield (07c_balance3.js)
    if (cs.drawFrom >= 0) s *= 0.55;
    if (cs.praying) s *= 0.2;
  }
  if (e.cls === 'archer' && !(cs && cs.drawFrom >= 0)) s *= 1.05; // [balance] light leathers: archers are a little quicker on their feet
  return s;
}
function classActValue(e) {
  const cs = e.cs;
  if (!cs || !e.alive) return 0;
  if (e.anim.act >= 7 && e.anim.actDur > 0) return 0; // whirlwinds, leaps and parries own the body
  if (cs.blockOn) return 10 + clamp((nowT() - (cs.raisedAt || 0)) / 0.15, 0.02, 1) * 0.5;
  if (cs.drawFrom >= 0) return 2 + clamp(0.2 + 0.55 * drawK(e), 0, 0.78);
  if (cs.praying) return 12 + 0.5;
  return 0;
}
function classNoAuto(e) { const cs = e.cs; return !!cs && (cs.blockOn || cs.drawFrom >= 0 || cs.praying || priestMaceHold(e)); } // [balance4] a skilled priest bot holds its mace from a warrior's guard (07c_balance.js) [balance9] asked at each swing (07c_balance9.js)
// a mage's own bolt takes the colour of the focus
function classAutoKind(e) {
  if (e.cls !== 'mage' || !e.cs || !clsHas(e, 'focus')) return e.rangedKind;
  const f = e.cs.focus;
  attuneQuiet(e, f, 6);
  return f === 'fire' ? 'ember' : f === 'frost' ? 'rime' : 'spark';
}
// the bolts themselves: an ember, a shard of rime, a spark (their light and pace; 07_entities.js flies them)
Object.assign(PROJ_COL, { ember: [2.4, 1.1, 0.35], rime: [0.75, 1.3, 2.4], spark: [1.3, 1.6, 2.9] });
Object.assign(PROJ_SPEED, { ember: 26, rime: 26, spark: 34 });
function classOvercast(e, A) { return e.cls === 'mage' && clsHas(e, 'overcast') && A.cost > 0 && e.hp > e.maxHp * (e.role === 'player' ? 0.25 : 0.7); }

/* ------------------------------------------------------------------ */
/* every step                                                          */
/* ------------------------------------------------------------------ */
function updateClasses(dt) {
  const P = GAME.player;
  if (P && P.cls) {
    const cs = csOf(P);
    // the player's held action follows the key or the button
    if (P.cls === 'warrior') {
      if (cs.blockOn && (!CLS.hold || !canBlock(P) || P.casting)) setBlock(P, false);
      else if (!cs.blockOn && CLS.hold && canBlock(P) && !P.casting) setBlock(P, true);
    }
    if (P.cls === 'archer') { if (cs.drawFrom >= 0 && (!P.alive || P.mount || isStunned(P) || P.casting)) cs.drawFrom = -1; updateHiding(P, dt); }
    if (P.cls === 'priest' && cs.praying) prayStep(P, dt);
    // overcast: no power comes back for a while
    if (cs.spentUntil > nowT()) { if (cs.spentPower === undefined) cs.spentPower = P.power; P.power = Math.min(P.power, cs.spentPower); } else cs.spentPower = undefined;
    // new depth unlocked with a level: say so once
    if (cs.lastLevel !== P.level) { classLevelNews(P, cs.lastLevel, P.level); cs.lastLevel = P.level; }
    if (P.bot && P.alive) botStep(P, dt); // [balance] the player played by a bot (tests: barrow.py)
  }
  raiseOfferStep(dt); // [balance] an allied priest offers to raise the fallen player (07c_balance.js)
  // NPCs and their held actions; frozen bodies thaw; the dead may yet be raised
  for (const e of ENT) {
    if (e.role === 'player' || !e.cs || e.removed) continue;
    if (e.alive) npcClassStep(e, dt);
  }
  for (const id of CLS.frozen) { const e = getEnt(id); if (!e || !e.alive || !frozenOf(e)) { CLS.frozen.delete(id); if (e && e.alive) iceBurst(e.x, e.y + 1, e.z, 0.5); } }
  stepDazzle(); // [balance3] the dazzled who are no longer (07c_balance3.js)
  stepArrows(dt);
  stepSnares(dt);
  stepGrounds(dt);
  // runes wait for a foe
  for (let i = CLS.runes.length - 1; i >= 0; i--) {
    const R = CLS.runes[i];
    if (GAME.t > R.until) { runeEnd(R); continue; }
    if (GAME.t < R.armAt) continue;
    const foe = nearestWhere(R.x, R.z, 2.2, (o) => o.alive && isActor(o) && !o.flying && o.faction !== R.faction && o.faction !== FACTION_NEUTRAL && o.role !== 'critter');
    if (foe) runeBurst(R);
  }
  // steam: blinds and soaks and scalds
  for (let i = CLS.steam.length - 1; i >= 0; i--) {
    const S = CLS.steam[i];
    if (GAME.t > S.until) { CLS.steam.splice(i, 1); continue; }
    S.tick -= dt;
    if (S.tick > 0) continue;
    S.tick = 0.5;
    const src = getEnt(S.src);
    forNear(S.x, S.z, S.r, (o) => {
      if (!o.alive || !isActor(o)) return;
      o.wet = Math.max(o.wet || 0, 0.65);
      if (o.faction !== S.faction && o.faction !== FACTION_NEUTRAL) { addBuff(o, 'blind', 1, 1.2, 'steam'); if (src) { const r = computeDamage(src, o, 0.08); dealDamage(src, o, r.d, { kind: 'aoe', dot: true }); } }
    });
  }
  // ice sheets melt (faster in the sun and near fire), and whoever stands on one at the end drops into the water
  for (let i = CLS.ice.length - 1; i >= 0; i--) {
    const s = CLS.ice[i];
    if (WEATHER.snowing < 0.3) s.until -= dt * 0.6 * sunStrength();
    if (GAME.t > s.until) iceSheetEnd(s);
  }
  // the dead near a priest of their realm are not carried off at once
  if (CLS.raiseScanT === undefined || GAME.t > CLS.raiseScanT) {
    CLS.raiseScanT = GAME.t + 1;
    for (const e of ENT) if (!e.alive && !e.removed && e.kind === 'humanoid' && e.faction <= 2 && e.role !== 'player' && GAME.t - e.deadAt < 9 && e.removeAt - GAME.t < 2) {
      if (nearestWhere(e.x, e.z, 14, (o) => o.alive && o.cls === 'priest' && o.faction === e.faction && clsHas(o, 'raise'))) e.removeAt = GAME.t + 2;
    }
  }
}
function classLevelNews(P, from, to) {
  const U0 = CLASS_UNLOCK[P.cls];
  const say = {
    block: 'Hold X (or the shield button) to raise your shield. Raise it just as a blow comes to parry it.',
    momentum: 'Momentum: your blows build it. At three or more, Slash becomes a finisher that spends it all.',
    stances: 'Stances: press T (or the stance button) to change between guarded, balanced and fury.',
    draw: 'Hold X (or the draw button) to draw your bow; let go to loose. The longer the draw, the harder and truer the shot.',
    arrows: 'Special arrows: press Y (or tap the quiver) to choose broadhead, bodkin, fire or blunt arrows.',
    hide: 'Hiding: keep still in long grass or among trees and you are hidden. Your first shot from cover strikes harder.',
    snare: 'Snares: press T (or the snare button) to lay a snare at your feet.',
    track: 'Tracking: Crippling Arrow and full-draw hits mark your quarry. You strike marked foes 10% harder.',
    attune: 'Attunement: every spell charges its element and strengthens the next spells of it.',
    focus: 'Focus: press T (or the focus button) to turn between fire and frost. Your bolt, Nova, Ward and Blink take its element.',
    storm: 'Storm: your focus can now turn to storm.',
    overcast: 'Overcasting: you can cast without enough power, paying for it in health.',
    devotion: 'Devotion: healing, prayer and holy acts build it. It strengthens your healing.',
    pray: 'Hold X to kneel and pray: devotion and power return.',
    consecrate: 'Holy ground: press T (or the consecrate button) to hallow the ground at your feet for 35 devotion.',
    bless: 'Blessings: Renewal also blesses its target when you have 20 devotion.',
    raise: 'Raising the fallen: near a friend who fell a moment ago, press T with 70 devotion to raise them.',
    realm: `Your realm's way: ${CLASS_REALM[P.cls][P.faction].name}. ${CLASS_REALM[P.cls][P.faction].text}`,
  };
  for (const k in U0) if (U0[k] > from && U0[k] <= to && say[k]) { uiToast(`New: ${say[k]}`, 'hint'); uiLog(say[k], 'level'); }
}

/* ------------------------------------------------------------------ */
/* the hidden techniques (useAbility runs them, like any ability)      */
/* ------------------------------------------------------------------ */
Object.assign(ABILITIES, {
  snare: { id: 'snare', name: 'Snare', icon: 'snare', level: CLASS_UNLOCK.archer.snare, cost: 6, cd: 9, /* [balance] 12 */ self: true, hidden: true, custom: (e) => laySnare(e), desc: 'Lay a snare at your feet. The first foe to step on it is held for 3.5 s.' },
  consecrate: { id: 'consecrate', name: 'Holy Ground', icon: 'circle', level: CLASS_UNLOCK.priest.consecrate, cost: 0, cd: 8, self: true, hidden: true, custom: consecrate, desc: 'Hallow the ground at your feet for 12 s (35 devotion): it heals your allies and burns the dead.' },
  raise: { id: 'raise', name: 'Raise the Fallen', icon: 'sun', level: CLASS_UNLOCK.priest.raise, cost: 0, cd: 20, cast: 2.0, self: true, hidden: true, anim: 3, custom: raiseFallen, desc: 'Raise a friend who fell a moment ago (70 devotion).' },
});
Object.assign(ICONS, {
  snare: '<path d="M4 15h16"/><path d="M6 15c0-5 3-8 6-8s6 3 6 8"/><path d="M8 15l1-3M11 15l1-4M14 15l1-3M17 15l.5-2"/><path d="M12 15v5"/>',
  quiver: '<path d="M8 4l8 16M10.5 3.5l8 16"/><path d="M6 6l3-2.2M8.5 5.5l3-2.2"/><rect x="11" y="11" width="6" height="9" rx="1.5" transform="rotate(-25 14 15.5)"/>',
  stance: '<path d="M12 3l7 3v5c0 5-3.5 8-7 10-3.5-2-7-5-7-10V6z"/><path d="M12 7v10M8 11h8"/>',
  pray: '<path d="M12 3v4M9 10c0-2 1.3-3 3-3s3 1 3 3l-1 6h-4z"/><path d="M7 21c1-3 3-5 5-5s4 2 5 5"/>',
  eyeoff: '<path d="M3 12s3.5-6 9-6c2 0 3.7.8 5 1.8M21 12s-3.5 6-9 6c-2 0-3.7-.8-5-1.8"/><path d="M4 20L20 4"/>',
});
// abilities whose work has grown say so in their tooltips
ABILITIES.slash.desc += ' With 3 or more momentum it becomes a finisher: 160% and 50% more for each point, and your weapon\'s own bite (sword: a deep wound; axe: armour broken; mace: a stun).';
ABILITIES.bash.desc += ' Guarded: a second longer, and the foe turns on you.';
ABILITIES.rally.desc += ' Balanced: heals 35%. Fury: 25% more damage.';
ABILITIES.bulwark.desc += ' Guarded: lasts 9 seconds.';
ABILITIES.cleave.desc += ' Fury: 25% more.';
ABILITIES.nova.desc = 'Your focus bursts out to 7 m. Fire: burns and roots. Frost: chills, roots and freezes water. Storm: a thunderclap that throws foes back.';
ABILITIES.ward.desc = 'Absorbs damage equal to 30% of your health, and bites back at anyone who strikes you in your focus: burning, chilling or shocking them.';
ABILITIES.blink.desc = 'Teleport 12 m the way you face, leaving your focus behind: flames, frost (which freezes water ahead) or a shock.';
ABILITIES.chain.desc += ' It leaps further and two more times through wet foes, overloads the burning and shatters the frozen.';
ABILITIES.frost.desc += ' Chills: three chills freeze. Freezes water it falls on.';
ABILITIES.firebolt.desc += ' Sets the foe burning; bursts chilled or frozen foes into steam.';
ABILITIES.renew.desc += ' With 20 devotion it also blesses the target.';
ABILITIES.smite.desc += ' Strongest against the dead of the Barrow, and it builds devotion.';
ABILITIES.cripple.desc += ' From level 12 it marks the foe: you strike it 10% harder for 30 s.';
for (const id of ['snare', 'consecrate', 'raise']) ABILITIES[id].id = id;

/* ------------------------------------------------------------------ */
/* arrows as goods                                                     */
/* ------------------------------------------------------------------ */
GOOD_KINDS.ammo = 'Arrows';
for (const k of ARROW_TYPES) {
  const D = ARROW_DEF[k];
  if (!D.good) continue;
  registerGood(D.good, { ...(GOODS[D.good] || {}), name: D.name.replace(/s$/, ''), plural: D.name, kind: 'ammo', icon: 'arrow', value: k === 'fire' ? 2 : 1, stack: 99, desc: D.text });
}

/* ------------------------------------------------------------------ */
/* saves: the stance, the focus, the arrow, devotion and attunement    */
/* ------------------------------------------------------------------ */
registerSavePart('char', 'cls', {
  save() {
    const P = GAME.player;
    if (!P || !P.cs) return null;
    const cs = P.cs;
    return { st: cs.stance, fo: cs.focus, ar: cs.arrow, dv: Math.round(devOf(P)), mo: Math.round(momOf(P) * 10) / 10 };
  },
  load(d) {
    const P = GAME.player;
    if (!P) return;
    P.cs = null;
    const cs = csOf(P);
    CLS.hold = false;
    for (const s of CLS.snares.slice()) snareEnd(s);
    if (!d || typeof d !== 'object') {
      // a recruit's quiver (and archers from before arrows were kept get one too)
      if (P.cls === 'archer' && !goodsCount('arrows_broadhead')) INV.goods.arrows_broadhead = 12;
      return;
    }
    if (Number.isInteger(d.st) && d.st >= 0 && d.st <= 2) cs.stance = d.st;
    if (ELEMENTS.includes(d.fo)) cs.focus = d.fo;
    if (ARROW_TYPES.includes(d.ar)) cs.arrow = d.ar;
    if (Number.isFinite(+d.dv)) cs.dev = clamp(+d.dv, 0, 100);
    cs.devAt = GAME.t; cs.devTick = GAME.t;
  },
  key(d) { return d ? { st: d.st, fo: d.fo, ar: d.ar } : null; },
});

/* ---- debug and test hooks ---- */
setTimeout(() => {
  if (!window.__hm) return;
  window.__hm.cls = {
    CLS, STANCES, CLASS_UNLOCK, CLASS_REALM, ARROW_DEF, csOf, clsHas, momOf, addMom, devOf, addDev, attOf, attune, setStance, setFocus, setBlock, parryWindow,
    startDraw, releaseDraw, looseArrow, drawK, laySnare, consecrate: (e) => useAbility(e, 'consecrate', null), raiseFallen, fallenNear, startPrayer, stopPrayer,
    classTechnique, classHold, cycleArrow, chillOf, frozenOf, burningOf, wetOf, addChill, freezeWater, iceAt, isWaterAt, steamAt, layRune, coverAt, updateHiding,
    sanctified, isUndead, weaponStyle, comboHint, classNpc, classHarm,
    treesNear: (x, z, r) => { let n = 0; if (typeof natTreesNear === 'function' && NATURE.built) natTreesNear(x, z, r, (t) => { if (!t.felled) n++; }); return n; },
    state: (e = GAME.player) => { if (!e) return null; const cs = csOf(e); return { stance: STANCES[cs.stance].id, mom: +momOf(e).toFixed(2), block: cs.blockOn, focus: cs.focus, att: { fire: Math.round(attOf(e, 'fire')), frost: Math.round(attOf(e, 'frost')), storm: Math.round(attOf(e, 'storm')) }, dev: Math.round(devOf(e)), praying: cs.praying, draw: +drawK(e).toFixed(2), arrow: cs.arrow, hidden: cs.hidden, cover: +cs.cover.toFixed(2) }; },
  };
}, 0);
