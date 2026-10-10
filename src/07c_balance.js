/* ================================================================== */
/* [balance] the balance of the callings                               */
/*   Bots that play a calling, used to measure it (tools/tests/        */
/*   classes.py balance) and to send each calling against the Hollow    */
/*   King (barrow.py): the simple bot presses 1-8 in order and lets the */
/*   auto-attack run ("easy to play"); the skilled bot plays the calling */
/*   well ("hard to master"): the warrior parries on the glint, spends   */
/*   momentum on finishers and changes stance; the archer keeps range,   */
/*   kites, draws fully, snares and picks arrows; the mage plays combos, */
/*   minds attunement and power and blinks away from blades; the priest */
/*   heals, prays when safe, hallows the ground and smites. An NPC with */
/*   e.bot has the role 'bot' (no other think runs for it; updateNPCs   */
/*   still ticks its buffs, swings and power) and botStep plays it from */
/*   npcClassStep; the player with P.bot is played from updateClasses.  */
/* Crowd control on players and champions has diminishing returns:     */
/*   a stun (a freeze counts as one), a root or a snare within 15 s of  */
/*   the last of its kind lasts half, then a quarter, then the body is  */
/*   immune for 6 s (ccAdjust, asked by addBuff; shown on the class     */
/*   panel). A parry's stun goes through it for anyone.                 */
/* An allied priest near a fallen player offers to raise them: the     */
/*   death screen shows the offer beside the release (raiseOffer*).     */
/* ================================================================== */
const BAL = { offer: null, offerScan: 0, raised: 0, stats: { parryTry: 0, kites: 0, draws: 0, prayers: 0 } };

/* ------------------------------------------------------------------ */
/* diminishing returns on crowd control                                */
/* ------------------------------------------------------------------ */
const CC_CAT = { stun: 'stun', root: 'root', snare: 'snare' };
const CC_STEPS = [1, 0.5, 0.25];
const CC_WIN = 15, CC_IMMUNE = 6;
const CC_NAME = { stun: 'Stun', root: 'Root', snare: 'Slow' };
const _ccImmune = { kind: 'immune', value: 0, until: 0, src: null, tick: 0 };
// players, the bots that stand in for them, and champions (camp champions, keep lords, hallow and muster
// wardens, the leaders of warbands) learn to shake off control
function ccChampion(e) {
  if (!e || e.kind === 'door') return false;
  if (e === GAME.player || e.bot || e.elite || e.role === 'lord' || e.role === 'guardian' || e.role === 'muster') return true;
  if (e.role === 'soldier') for (const wb of WAR.warbands) if (wb.lid === e.id && wb.realm === e.faction) return true;
  return false;
}
function ccState(e, cat) {
  const D = e.ccdr || (e.ccdr = {});
  let s = D[cat];
  if (!s) s = D[cat] = { n: 0, until: -99, immune: -99 };
  const t = GAME.t;
  if (s.n > 0 && t > s.until && t > s.immune) { s.n = 0; }
  return s;
}
// the share of a control of this category that takes hold now (1, 0.5, 0.25, or 0 while immune), without counting it
function ccFactor(e, cat) {
  const s = ccState(e, cat);
  if (GAME.t < s.immune) return 0;
  return CC_STEPS[Math.min(s.n, CC_STEPS.length - 1)];
}
// a stun, root or snare on its way in: returns the duration it lasts (0: immune). A control refreshed by the same
// source while it still holds (a blizzard's ticks, a held snare) keeps its step and does not count again.
function ccAdjust(e, kind, dur, src, force) {
  const cat = CC_CAT[kind];
  if (!cat || !(dur > 0) || !e.alive) return dur;
  // an immunity (the third control's, or a priest's Divine Shield) holds for anyone
  if (e.ccdr && e.ccdr[cat] && GAME.t < e.ccdr[cat].immune) return 0;
  if (!force && !ccChampion(e)) return dur;
  const s = ccState(e, cat), t = GAME.t;
  if (t < s.immune) return 0;
  const cur = e.buffs.find((b) => b.kind === kind && b.src === src && b.until > t);
  if (cur && s.n > 0) return dur * CC_STEPS[Math.min(s.n - 1, CC_STEPS.length - 1)];
  if (s.n >= CC_STEPS.length) { s.immune = t + CC_IMMUNE; s.until = s.immune; s.n = 0; ccNews(e, cat, 0); return 0; }
  const k = CC_STEPS[s.n];
  s.n++;
  s.until = t + CC_WIN;
  if (k < 1) ccNews(e, cat, k);
  return dur * k;
}
function ccNews(e, cat, k) {
  if (e !== GAME.player && !(GAME.player && e.target === GAME.player.id && dist2(e.x, e.z, GAME.player.x, GAME.player.z) < 30 * 30)) return;
  if (k === 0) uiFloatAt(e.x, e.y + 2.3 * (e.scale || 1), e.z, `${CC_NAME[cat]} immune`, 'immune');
}
// the HUD's view of the player's own state: [{ cat, k, left, immune }]
function ccHudState(e) {
  const out = [];
  if (!e || !e.ccdr) return out;
  for (const cat of ['stun', 'root', 'snare']) {
    const s = e.ccdr[cat];
    if (!s) continue;
    if (GAME.t < s.immune) out.push({ cat, k: 0, left: s.immune - GAME.t, immune: true });
    else if (s.n > 0 && GAME.t < s.until) out.push({ cat, k: CC_STEPS[Math.min(s.n, CC_STEPS.length - 1)], left: s.until - GAME.t, immune: false });
  }
  return out;
}

// the class panel shows it: Stun ½ 12s, Root ¼ 4s, Slow immune 5s
const CC_ICON = { stun: 'burst', root: 'chain', snare: 'snow' };
function classDrHud(el, P) {
  let box = el.querySelector('.cls-dr');
  if (!box) { const row = el.querySelector('.cls-row'); if (!row) return; box = document.createElement('span'); box.className = 'cls-dr'; row.appendChild(box); box._k = ''; }
  const st = ccHudState(P);
  const key = st.map((q) => `${q.cat}${q.k}${Math.ceil(q.left)}`).join('|');
  if (box._k === key) return;
  box._k = key;
  box.innerHTML = st.map((q) => `<span class="${q.immune ? 'imm' : ''}" title="${CC_NAME[q.cat]}: ${q.immune ? 'immune' : `the next lasts ${q.k === 0.5 ? 'half' : 'a quarter'} as long`} (${Math.ceil(q.left)} s)">${iconSvg(CC_ICON[q.cat], 12)}${q.immune ? 'immune' : q.k === 0.5 ? '½' : '¼'} ${Math.ceil(q.left)}s</span>`).join('');
}

/* ------------------------------------------------------------------ */
/* the archer's tracked quarry on the minimap: a ring and cross-hairs  */
/* over each foe you have marked, or a chevron at the rim pointing the */
/* way to it when it is out of sight                                   */
/* ------------------------------------------------------------------ */
function trackedByPlayer() {
  const P = GAME.player, out = [];
  if (!P || P.cls !== 'archer') return out;
  for (const e of ENT) if (e.alive && !e.removed && e.buffs.length && e.buffs.some((b) => b.kind === 'tracked' && b.src === P.id && b.until > GAME.t) && dist2(e.x, e.z, P.x, P.z) < 500 * 500 && inDungeon(e) === inDungeon(P)) out.push(e);
  return out;
}
function drawTrackedMinimap(ctx, toM, S, dpr) {
  const list = trackedByPlayer();
  if (!list.length) return;
  const P = GAME.player, pulse = 0.75 + 0.25 * Math.sin(renderTime * 5);
  ctx.save();
  ctx.lineWidth = 1.6 * dpr;
  for (const e of list) {
    let [x, y] = toM(e.x, e.z);
    const m = 7 * dpr, inside = x > m && y > m && x < S - m && y < S - m;
    ctx.strokeStyle = `rgba(255, 138, 106, ${pulse})`;
    ctx.fillStyle = `rgba(255, 138, 106, ${pulse})`;
    if (inside) {
      const r = 5.5 * dpr;
      ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x - r - 3 * dpr, y); ctx.lineTo(x - r + 2 * dpr, y); ctx.moveTo(x + r - 2 * dpr, y); ctx.lineTo(x + r + 3 * dpr, y); ctx.moveTo(x, y - r - 3 * dpr); ctx.lineTo(x, y - r + 2 * dpr); ctx.moveTo(x, y + r - 2 * dpr); ctx.lineTo(x, y + r + 3 * dpr); ctx.stroke();
    } else {
      // out of sight: a chevron on the rim, pointing the way
      const a = Math.atan2(e.z - P.z, e.x - P.x), c = S / 2, R = S / 2 - m;
      const k = R / Math.max(Math.abs(Math.cos(a)), Math.abs(Math.sin(a)));
      x = c + Math.cos(a) * k; y = c + Math.sin(a) * k;
      ctx.translate(x, y); ctx.rotate(a);
      ctx.beginPath(); ctx.moveTo(5 * dpr, 0); ctx.lineTo(-3 * dpr, -4.5 * dpr); ctx.lineTo(-1 * dpr, 0); ctx.lineTo(-3 * dpr, 4.5 * dpr); ctx.closePath(); ctx.fill();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
    }
  }
  ctx.restore();
}

/* ------------------------------------------------------------------ */
/* fair gear for a level: a full set of the quality a soldier of that  */
/* level usually wears (fine below 20, rare to 40, epic above)          */
/* [balance2] at item level = the level, to 50, each piece with the    */
/*   stats its slot, grade and level give on average, so every calling */
/*   measured wears the same totals (no lucky rolls)                    */
/* ------------------------------------------------------------------ */
function fairGear(cls, lvl, q) {
  const r = mulberry(7919 + lvl * 31);
  const qq = q ?? fairGrade(lvl);
  const eq = {};
  for (const s of SLOTS) { eq[s] = makeItem({ slot: s, cls, q: qq, lvl, rnd: r, realm: 0 }); eq[s].st = gearSlotExpect(s, eq[s].lvl, qq); }
  return { eq, tot: gearTotals(eq) };
}

/* ------------------------------------------------------------------ */
/* the bots                                                            */
/* ------------------------------------------------------------------ */
// make e a bot of this kind ('simple' or 'skilled'); home: the arena it keeps to { x, z, r }
function botMake(e, kind, home) {
  e.bot = { kind, home: home || null, next: 0, slot: 0, blockUntil: 0, drawTo: 0, stanceAt: -9, kiteT: 0, focusAt: -9, lastPress: -9 };
  csOf(e);
  return e;
}
// press one ability, as a player would (a global cooldown after it)
function botUse(e, id, t) {
  const A = ABILITIES[id];
  if (!A || A.level > e.level) return false;
  if (canUse(e, id, t)) return false;
  const r = useAbility(e, id, t);
  if (r !== true) return false;
  e.bot.next = GAME.t + 0.6;
  e.bot.lastPress = GAME.t;
  if (BAL.log && BAL.log.length < 400) BAL.log.push(`${GAME.t.toFixed(1)} ${e.cls}${e.id} ${id}`);
  return true;
}
function botEnemy(e, o) { return o && o.alive && isEnemy(e, o) && isActor(o) && o.kind !== 'door'; }
function botInArena(e, o) { const H = e.bot.home; return !H || dist2(o.x, o.z, H.x, H.z) < (H.r + 14) * (H.r + 14); }
function botTarget(e) {
  let t = getEnt(e.target);
  if (!botEnemy(e, t) || !botInArena(e, t)) t = null;
  // a skilled player turns on whoever is hurting them most only when the current foe is far
  if (!t) {
    let best = null, bs = Infinity;
    forNear(e.x, e.z, 34, (o, d2) => {
      if (!botEnemy(e, o) || !botInArena(e, o) || (inDungeon(o) !== inDungeon(e))) return;
      let s = d2;
      if (e.threat && e.threat.has(o.id)) s -= 40;
      if (o.target === e.id) s *= 0.6;
      if (s < bs) { bs = s; best = o; }
    });
    t = best;
  }
  e.target = t ? t.id : null;
  return t;
}
function botFoes(e, r, pred) { let n = 0; forNear(e.x, e.z, r, (o) => { if (botEnemy(e, o) && (!pred || pred(o))) n++; }); return n; }
// the nearest blade coming for e
function botPresser(e, r) { return nearestWhere(e.x, e.z, r, (o) => botEnemy(e, o) && !o.rangedKind && o.target === e.id && !isRooted(o)); }

// every step: reflexes, movement, and (at a player's pace) the next press
function botStep(e, dt) {
  const B = e.bot;
  if (!B || !e.alive) return;
  // [balance2] a cast broken before its end (a blunt arrow, a storm, a mace, a stun): a skilled hand remembers it
  if (B.cast && !e.casting) { if (GAME.t < B.cast.end - 0.08) B.cutAt = GAME.t; B.cast = null; }
  if (e.casting && !B.cast) B.cast = { end: GAME.t + Math.max(0, e.casting.total - e.casting.t) };
  const t = botTarget(e);
  const skilled = B.kind === 'skilled';
  if (e.cs) {
    if (skilled) botReflex(e, t, dt);
    else botLetGo(e);
  }
  if (!isStunned(e) && !(e.motion && e.motion.kind)) botMove(e, t, dt);
  // a player in trouble drinks a healing draught
  if (e === GAME.player && e.hp < e.maxHp * (skilled ? 0.38 : 0.25) && INV.potions > 0 && GAME.t >= (INV.potionAt || -99) + POTION.cd) usePotion();
  if (GAME.t >= B.next && !e.casting && !isStunned(e) && !(e.motion && e.motion.kind === 'leap') && e.carrying == null) {
    let acted = false;
    try { acted = skilled ? botSkilled(e, t) : botSimple(e, t); } catch (err) { reportError(err); }
    if (!acted) B.next = GAME.t + 0.15;
  }
}
// the simple bot holds nothing: no shield, no draw, no prayer
function botLetGo(e) {
  const cs = e.cs;
  if (e === GAME.player) { if (CLS.hold) classHold(false); return; }
  if (cs.blockOn) setBlock(e, false);
  if (cs.drawFrom >= 0 && !cs.npcDraw) cs.drawFrom = -1;
  if (cs.praying) stopPrayer(e);
}
// presses 1-8 in turn: whichever of the slots is ready comes next
function botSimple(e, t) {
  const list = CLASSES[e.cls].abilities;
  const B = e.bot;
  for (let i = 0; i < list.length; i++) {
    const k = (B.slot + i) % list.length, id = list[k], A = ABILITIES[id];
    if (A.level > e.level) continue;
    if (!A.self && !A.friendly && !(t && t.alive)) continue;
    if (botUse(e, id, A.self || A.friendly ? (A.friendly ? e : null) : t)) { B.slot = (k + 1) % list.length; return true; }
  }
  return false;
}

/* ---- moving: into reach, kiting, back to the arena ---- */
function botMove(e, t, dt) {
  const B = e.bot, H = B.home;
  if (e.casting) return;
  const go = (x, z, k = 1, stop = 0.3) => moveToward(e, x, z, dt, k, stop);
  if (!t) { if (H && dist(e.x, e.z, H.x, H.z) > 2) go(H.x, H.z, 0.8, 1.5); return; }
  const d = dist(e.x, e.z, t.x, t.z), tr = t.radius * (t.scale || 1);
  const skilled = B.kind === 'skilled';
  const ranged = e.cls === 'archer' || e.cls === 'mage';
  // kiting: the archer and the mage step away from a blade that is free to follow
  if (skilled && ranged) {
    const p = botPresser(e, e.cls === 'archer' ? 9 : 7.5);
    if (p && (e.cs && e.cs.drawFrom < 0 || dist(e.x, e.z, p.x, p.z) < 3.2)) {
      let ax = e.x - p.x, az = e.z - p.z;
      const L = Math.hypot(ax, az) || 1; ax /= L; az /= L;
      // keep to the arena: bend the way out along its rim
      if (H) {
        const hx = H.x - e.x, hz = H.z - e.z, hd = Math.hypot(hx, hz);
        if (hd > H.r * 0.6) { const w = clamp((hd - H.r * 0.6) / (H.r * 0.5), 0, 1); ax = ax * (1 - w) + (hx / (hd || 1)) * w + az * w * 0.8; az = az * (1 - w) + (hz / (hd || 1)) * w - ax * w * 0.8; }
      }
      BAL.stats.kites++;
      go(e.x + ax * 4, e.z + az * 4, 1, 0);
      return;
    }
  }
  if (H && dist(t.x, t.z, H.x, H.z) > H.r + 6 && dist(e.x, e.z, H.x, H.z) > H.r) { go(H.x, H.z, 1, 1); return; }
  let want;
  if (e.cls === 'archer') want = skilled ? Math.min(26, e.rangedRange - 3) : e.rangedRange - 2;
  else if (e.cls === 'mage') want = skilled ? 24 : e.rangedRange - 2;
  // a skilled priest does not swing a mace into a raised shield: holy light from a few strides off
  else if (e.cls === 'priest' && skilled && t.cls === 'warrior' && hasShield(t) && clsHas(t, 'block')) want = 12;
  // [balance2] but a bow or a staff is closed on: a pressed archer cannot draw, a pressed mage casts into a mace,
  // and holy light is cast on the way in (botPriest)
  else want = e.meleeRange * (e.scale || 1) + tr - 0.4;
  if (d > want) go(t.x, t.z, 1, Math.max(0.3, want * 0.9));
  else turnToward(e, t.x, t.z, dt * 10);
}

/* ---- reflexes: the shield on the glint, the draw, prayer, hiding ---- */
function botReflex(e, t, dt) {
  const cs = e.cs, B = e.bot, P = e === GAME.player, now = GAME.t;
  if (e.cls === 'warrior') {
    const hold = (on) => { if (P) { if (CLS.hold !== on) classHold(on); } else setBlock(e, on); };
    if (cs.blockOn && now > B.blockUntil) hold(false);
    if (!cs.blockOn && canBlock(e) && now - cs.blockDown >= PARRY_REARM && !e.casting) {
      // the glint: a foe's blow starting at us
      let swing = null;
      forNear(e.x, e.z, 5.5, (o) => {
        if (swing || !o.alive || o.target !== e.id || !isEnemy(o, e) || o.rangedKind) return;
        const a = o.anim.act;
        if ((a === 1 || a === 8) && o.anim.actT < 0.08 && o.anim.actDur > 0) swing = o;
      });
      if (swing && B.glint !== swing.id + ':' + Math.round(swing.swingAt * 10)) {
        B.glint = swing.id + ':' + Math.round(swing.swingAt * 10);
        BAL.stats.parryTry++;
        // a skilled hand catches most of them; a few come up a moment too soon and only block
        if (Math.random() < 0.75) { hold(true); if (!P) faceToward(e, swing.x, swing.z); B.blockUntil = now + 0.34; }
      }
      // [balance2] an arrow or a bolt about to strike: the shield up to take it (a third of an arrow's harm gets
      // through, three fifths of a spell's), and down again as soon as it has landed
      if (!swing && !cs.blockOn) {
        const shot = botIncoming(e, 0.42);
        if (shot && shot.src && botFoes(e, 3.2) === 0) { hold(true); if (!P) faceToward(e, shot.src.x, shot.src.z); B.blockUntil = now + shot.eta + 0.12; BAL.stats.shieldShots = (BAL.stats.shieldShots || 0) + 1; }
      }
    }
    return;
  }
  if (e.cls === 'archer') {
    if (!P) updateHiding(e, dt);
    if (cs.drawFrom >= 0) {
      const p = botPresser(e, 3.6);
      if (drawK(e) >= 0.99 || p || !t || now > B.drawTo) {
        if (P) classHold(false);
        else { if (t) faceToward(e, t.x, t.z); releaseDraw(e, t); }
        B.next = Math.max(B.next, now + 0.25);
      }
    }
    return;
  }
  if (e.cls === 'priest') {
    if (cs.praying) {
      const threat = botFoes(e, 16) > 0 || e.hp < e.maxHp * 0.5;
      if (threat || devOf(e) >= 95) { if (P) classHold(false); else stopPrayer(e); }
      else if (!P) prayStep(e, dt);
    }
  }
}

// [balance2] the nearest blow in flight at e that lands within `within` seconds: { src, eta }
function botIncoming(e, within) {
  let best = null;
  for (const p of PROJ) {
    if (p.visualOnly || p.tgt !== e.id || p.srcFaction === e.faction) continue;
    const d = Math.hypot(e.x - p.x, e.y + 1.1 - p.y, e.z - p.z), eta = d / (p.speed || 24);
    if (eta < within && (!best || eta < best.eta)) best = { src: getEnt(p.src), eta };
  }
  for (const A of CLS.arrows) {
    if (A.dead || A.tgt !== e.id || A.faction === e.faction) continue;
    const d = Math.hypot(e.x - A.x, e.z - A.z), v = Math.hypot(A.vx || 0, A.vz || 0) || 40, eta = d / v;
    if (eta < within && (!best || eta < best.eta)) best = { src: getEnt(A.src), eta };
  }
  return best;
}
/* ---- the skilled bot's choices, calling by calling ---- */
function botSkilled(e, t) {
  if (e.cls === 'warrior') return botWarrior(e, t);
  if (e.cls === 'archer') return botArcher(e, t);
  if (e.cls === 'mage') return botMage(e, t);
  if (e.cls === 'priest') return botPriest(e, t);
  return botSimple(e, t);
}
function botWarrior(e, t) {
  const cs = csOf(e), B = e.bot, hpF = e.hp / e.maxHp;
  const foes = botFoes(e, 6);
  // the stance: guarded when hard pressed, fury to finish or while whole, balanced between
  if (clsHas(e, 'stances') && GAME.t - B.stanceAt > 3) {
    const want = hpF < 0.35 || foes >= 3 && hpF < 0.7 ? 0 : (t && t.hp < t.maxHp * 0.45) || hpF > 0.6 ? 2 : 1;
    if (want !== cs.stance && GAME.t - cs.stanceAt > 0.8) { setStance(e, want); B.stanceAt = GAME.t; B.next = GAME.t + 0.3; return true; }
  }
  if (hpF < 0.4 && botUse(e, 'bulwark', e)) return true;
  if (hpF < 0.55 && botUse(e, 'rally', e)) return true;
  if (!t) return false;
  const d = dist(e.x, e.z, t.x, t.z);
  if (d > 6.5 && (botUse(e, 'leap', t) || botUse(e, 'charge', t))) return true;
  // momentum: spend it on a finisher
  if (clsHas(e, 'momentum') && momOf(e) >= FIN_MIN && botUse(e, 'slash', t)) return true;
  // a spell coming: the shield in the face
  if (t.casting && botUse(e, 'bash', t)) return true;
  if (foes >= 2 && (botUse(e, 'whirl', e) || botUse(e, 'cleave', t))) return true;
  if (botUse(e, 'bash', t)) return true;
  if (foes >= 1 && botUse(e, 'whirl', e)) return true;
  if (botUse(e, 'cleave', t)) return true;
  // a plain slash only when no finisher is near
  if ((!clsHas(e, 'momentum') || momOf(e) < 1.6) && botUse(e, 'slash', t)) return true;
  if (hpF < 0.75 && botUse(e, 'rally', e)) return true;
  return false;
}
function botArcherArrow(e, t) {
  if (!clsHas(e, 'arrows') || !t) return 'plain';
  if (t.casting) return 'blunt';
  if (t.cls === 'warrior' || t.drBase >= 0.1) return 'bodkin';
  if (wetOf(t) < 0.3 && rainHere(e) < 0.2 && !burningOf(t)) return 'fire';
  return 'broadhead';
}
function botArcher(e, t) {
  const cs = csOf(e), B = e.bot, P = e === GAME.player;
  if (!t) return false;
  const want = botArcherArrow(e, t);
  if (want !== cs.arrow) { if (P) { if (want === 'plain' || goodsHave(ARROW_DEF[want].good, 1)) cs.arrow = want; } else cs.arrow = want; }
  if (cs.drawFrom >= 0) return false; // the reflex looses it
  const d = dist(e.x, e.z, t.x, t.z);
  const p = botPresser(e, 9);
  if (p) {
    const dp = dist(e.x, e.z, p.x, p.z);
    // a blade at arm's length: leap back (facing it, so the tumble carries you away)
    if (dp < 3.4 && ABILITIES.tumble.level <= e.level && !canUse(e, 'tumble', null)) { faceToward(e, p.x, p.z); if (botUse(e, 'tumble', e)) return true; }
    // a snare between you and it
    if (dp < 6 && clsHas(e, 'snare') && !CLS.snares.some((s) => s.owner === e.id && !s.sprung && dist2(s.x, s.z, e.x, e.z) < 16) && !canUse(e, 'snare', null)) { faceToward(e, p.x, p.z); if (botUse(e, 'snare', null)) return true; }
    if (!hasBuff(p, 'snare') && botUse(e, 'cripple', p)) return true;
    // a pack at your heels: pin them all
    if (botFoes(e, 9) >= 2 && botUse(e, 'volley', p)) return true;
    if (botUse(e, 'quickshot', p)) return true;
    if (botUse(e, 'firearrow', p)) return true;
    return false;
  }
  if (botFoes(e, 40, (o) => dist(o.x, o.z, t.x, t.z) < 5) >= 2 && botUse(e, 'volley', t)) return true;
  if (botUse(e, 'firearrow', t)) return true;
  // a foe coming in: slow it first
  if (!t.rangedKind && t.target === e.id && d < 18 && !hasBuff(t, 'snare') && !isRooted(t) && botUse(e, 'cripple', t)) return true;
  const safe = !nearestWhere(e.x, e.z, 13, (o) => botEnemy(e, o) && !o.rangedKind && o.target === e.id && !isRooted(o));
  if (safe && d > 10 && botUse(e, 'deadeye', t)) return true;
  if (safe && botUse(e, 'pierce', t)) return true;
  if (safe && botUse(e, 'aimed', t)) return true;
  // a quick shot between draws costs a draw nothing
  if (botUse(e, 'quickshot', t)) return true;
  // the drawn bow: hold to full and loose
  if (clsHas(e, 'draw') && d < e.rangedRange + 4 && e.power > 6) {
    if (P) classHold(true); else startDraw(e);
    if (cs.drawFrom >= 0) { B.drawTo = GAME.t + drawFull(e) + 0.6; BAL.stats.draws++; B.next = GAME.t + 0.2; return true; }
  }
  return botUse(e, 'quickshot', t);
}
// [v9] the way out from a blade, kept inside the arena: a skilled player knows where the walls are and that a lord
// who loses his quarry out of his hall goes back to his seat whole (the Hollow King)
function botAwayYaw(e, p, reach) {
  const H = e.bot && e.bot.home;
  let ax = e.x - p.x, az = e.z - p.z;
  const L = Math.hypot(ax, az) || 1; ax /= L; az /= L;
  if (H) {
    let best = null, bs = -Infinity;
    for (const da of [0, 0.6, -0.6, 1.2, -1.2, 1.8, -1.8, 2.4, -2.4]) {
      const c = Math.cos(da), s = Math.sin(da), dx = ax * c - az * s, dz = ax * s + az * c;
      const lx = e.x + dx * reach, lz = e.z + dz * reach;
      const sc = (dist(lx, lz, H.x, H.z) < H.r ? 100 : 0) + dist(lx, lz, p.x, p.z) - Math.abs(da) * 2;
      if (sc > bs) { bs = sc; best = [dx, dz]; }
    }
    ax = best[0]; az = best[1];
  }
  return Math.atan2(ax, az);
}
function botMage(e, t) {
  const cs = csOf(e), hpF = e.hp / e.maxHp;
  const focus = (el) => { if (clsHas(e, 'focus') && cs.focus !== el && (el !== 'storm' || clsHas(e, 'storm'))) setFocus(e, el); };
  // [balance2] a chill about to become a freeze: a blink sheds it (sideways, staying in the fight)
  if (t && chillOf(e) >= 2 && !frozenOf(e) && e.level >= ABILITIES.blink.level && !canUse(e, 'blink', null) && !botPresser(e, 5)) {
    const a = Math.atan2(t.x - e.x, t.z - e.z) + (Math.random() < 0.5 ? 1.2 : -1.2), H = e.bot.home;
    e.yaw = H && dist(e.x + Math.sin(a) * 12, e.z + Math.cos(a) * 12, H.x, H.z) > H.r ? a + Math.PI * 0.8 : a;
    if (botUse(e, 'blink', e)) return true;
  }
  if (hpF < 0.7 && botUse(e, 'ward', e)) return true;
  if (!t) return false;
  // [balance2] a foe's spell or drawn bow: one more frost freezes it (and breaks it)
  const att = clsHas(e, 'attune') && attOf(e, 'frost') >= 60 ? 1 : 0;
  if ((t.casting || (t.cs && t.cs.drawFrom >= 0)) && !frozenOf(t) && chillOf(t) + 1 + att >= 3 && (ccChampion(t) ? ccFactor(t, 'stun') > 0 : GAME.t >= (t._thawUntil || 0)) && botUse(e, 'frost', t)) return true;
  // a ward up before the blades arrive
  if (t.target === e.id && !hasBuff(e, 'shield') && botUse(e, 'ward', e)) return true;
  // a blade at the throat: a frost nova to hold it, then away; Blink when the nova is spent
  const p = botPresser(e, 5);
  if (p) {
    focus(frozenOf(p) ? 'storm' : 'frost');
    if (botUse(e, 'nova', e)) return true;
    if (e.level >= ABILITIES.blink.level && !canUse(e, 'blink', null)) { focus('frost'); e.yaw = botAwayYaw(e, p, ABILITIES.blink.blink || 12); if (botUse(e, 'blink', e)) return true; }
    if (frozenOf(p) && botUse(e, 'chain', p)) return true;
    if (botUse(e, 'frost', p)) return true;
  }
  const foes = botFoes(e, 40, (o) => dist(o.x, o.z, t.x, t.z) < 6);
  // the combos: storm shatters the frozen and overloads the burning, fire bursts the chilled into steam,
  // frost quenches the burning; storm runs through the wet
  if (frozenOf(t)) { focus('storm'); if (botUse(e, 'chain', t)) return true; focus('fire'); if (botUse(e, 'firebolt', t)) return true; }
  if (burningOf(t)) { if (botUse(e, 'chain', t)) return true; if (botUse(e, 'frost', t)) return true; }
  if (wetOf(t) > 0.3 && botUse(e, 'chain', t)) return true;
  const ch = chillOf(t);
  if (foes >= 2 && botUse(e, 'meteor', t)) return true;
  if (foes >= 2 && botUse(e, 'blizzard', t)) return true;
  // chill to freeze: the lance (and a frost focus for the bolt between)
  if (!frozenOf(t) && (ccChampion(t) ? ccFactor(t, 'stun') > 0 : GAME.t >= (t._thawUntil || 0))) {
    focus('frost');
    if (botUse(e, 'frost', t)) return true;
    if (ch >= 2 && botUse(e, 'blizzard', t)) return true;
  }
  if (botUse(e, 'meteor', t)) return true;
  if (ch > 0 && botUse(e, 'firebolt', t)) return true;
  if (botUse(e, 'chain', t)) return true;
  if (botUse(e, 'blizzard', t)) return true;
  // [balance2] fire into a wet foe is damped: a frost focus chills it with every bolt, and the next firebolt makes steam
  const wet = wetOf(t) > 0.3;
  focus(ch > 0 || wet ? 'frost' : 'fire');
  if (wet && ch <= 0) return botUse(e, 'frost', t) || (e.swingAt - GAME.t > 1.2 && botUse(e, 'firebolt', t));
  return botUse(e, 'firebolt', t) || botUse(e, 'frost', t);
}
function botPriest(e, t) {
  const cs = csOf(e), P = e === GAME.player, hpF = e.hp / e.maxHp, B = e.bot;
  const foesNear = botFoes(e, 6), fight = !!t || botFoes(e, 16) > 0;
  const hot = e.buffs.some((b) => b.kind === 'hot' && b.until > GAME.t + 1);
  // [balance2] a priest who knows the work keeps a reserve of power for mending, and does not stand casting into a
  // foe who has just broken a spell (blunt arrows, a storm, a mace): instants then, and long casts only when the foe
  // is busy or held, or the need is dire
  const pw = e.power / Math.max(1, e.maxPower);
  const broke = GAME.t - (B.cutAt || -99) < 5;
  const busy = !!t && (isStunned(t) || (!!t.casting && t.casting.total - t.casting.t > 0.5) || dist(e.x, e.z, t.x, t.z) > 34);
  const steady = hasBuff(e, 'steadfast');
  const castOk = !broke || busy || steady;
  // shields and instants first
  if (hpF < 0.6 && !hasBuff(e, 'shield') && botUse(e, 'divine', e)) return true;
  if (hpF < 0.7 && botUse(e, 'sanctuary', e)) return true;
  if (fight && hpF < 0.97 && !hot && (botUse(e, 'massrenew', e) || botUse(e, 'renew', e))) return true;
  // [balance2] cut off or held: a Renewal on yourself loosens the bonds and steadies the next spell
  if (fight && (broke || isRooted(e) || hasBuff(e, 'snare')) && !steady && hpF < 0.97 && botUse(e, 'renew', e)) return true;
  if (hpF < (castOk ? 0.72 : 0.35) && botUse(e, 'mend', e)) return true;
  // holy ground where the fight is
  if (clsHas(e, 'consecrate') && devOf(e) >= 35 && foesNear >= 1 && hpF < 0.95 && !CLS.grounds.some((G) => G.src === e.id && dist2(G.x, G.z, e.x, e.z) < 25)) { if (botUse(e, 'consecrate', null)) return true; }
  if (!t) {
    // nothing to fight: kneel and pray
    if (!cs.praying && devOf(e) < 70 && botFoes(e, 16) === 0) { if (P) classHold(true); else startPrayer(e); BAL.stats.prayers++; return true; }
    return false;
  }
  // holy fire is instant and cheap for what it does: keep it burning
  if (!t.buffs.some((b) => b.kind === 'dot' && b.src === e.id && b.until > GAME.t + 1) && botUse(e, 'holyfire', t)) return true;
  if (castOk && (pw > 0.3 || hpF > 0.9) && botUse(e, 'pillar', t)) return true;
  if (castOk && hpF < 0.82 && botUse(e, 'mend', e)) return true;
  // smite with power to spare, or to finish; in reach the mace does the rest for nothing
  const reach = dist(e.x, e.z, t.x, t.z) < e.meleeRange + t.radius * (t.scale || 1) + 0.6;
  // a reserve for mending only in a long fight (more than one foe on you); one foe is a race
  const pressed = (hpF < 0.9 || GAME.t - (e.lastHitAt || -99) < 6) && botFoes(e, 20) >= 2;
  if (castOk && (!pressed || pw > (reach ? 0.6 : 0.4) || t.hp < t.maxHp * 0.2) && botUse(e, 'smite', t)) return true;
  return false;
}

/* ---- a priest's Sanctuary and Mass Renewal: everyone close by is healed in full, the priest's own wounds
   mend more slowly (PRIEST_SELF), as with Mend and Renewal ---- */
const PRIEST_SELF = 0.75;
// [balance2] and they do not mend faster as the priest's ranks grow (others' do): a healer past 30 could otherwise
// outlast any foe alone
const priestSelf = (e) => PRIEST_SELF / rankMult(e.level);
// [balance2] Renewal on yourself: roots and slows loosen, and for 4 s nothing but a stun breaks your spells (not a
// blunt arrow, a storm, a mace or a thunderclap): the priest's answer to being kited and cut off
function priestSteadfast(e) {
  e.buffs = e.buffs.filter((b) => !((b.kind === 'snare' || b.kind === 'root') && b.src !== 'frozen'));
  addBuff(e, 'steadfast', 1, 4, 'steadfast');
  if (dist2(e.x, e.z, camera.position.x, camera.position.z) < 60 * 60) FX.ring(e.x, e.y + 0.15, e.z, 0.9, [1.9, 1.7, 1.0], 18, 1.4);
}
// a spell broken by a blow or an arrow, unless the caster stands steadfast; true when it broke
function breakCast(e) {
  if (!e || !e.casting || hasBuff(e, 'steadfast')) return false;
  e.casting = null;
  return true;
}
function priestGroupHeal(e, A, t, cast, rk) {
  forNear(e.x, e.z, A.radius, (o) => { if (o.alive && o.faction === e.faction && isActor(o)) { healEnt(e, o, o.maxHp * A.groupHeal * rk * (o === e ? priestSelf(e) : 1)); FX.heal(o.x, o.y, o.z); } });
  FX.ring(e.x, e.y + 0.3, e.z, A.radius * 0.3, [1.0, 1.6, 0.7], 50, A.radius);
  sfx('heal');
}
function priestGroupHot(e, A, t, cast, rk) {
  forNear(e.x, e.z, A.radius, (o) => {
    if (!o.alive || o.faction !== e.faction || !isActor(o)) return;
    addBuff(o, 'hot', (o.maxHp * A.groupHot[0] * rk * (o === e ? priestSelf(e) : 1)) / A.groupHot[1], A.groupHot[1], e.id);
    FX.heal(o.x, o.y, o.z);
  });
  spellDisc(e.x, e.z, A.radius, DISC_KIND.renew, 1.8, [0.8, 1.55, 0.55]);
  for (let i = 0; i < 46; i++) {
    const a = Math.random() * TAU, r = Math.sqrt(Math.random()) * A.radius;
    const x = e.x + Math.cos(a) * r, z = e.z + Math.sin(a) * r;
    fxAdd.emit(x, heightAt(x, z) + 0.1, z, (Math.random() - 0.5) * 0.3, 0.7 + Math.random() * 1.2, (Math.random() - 0.5) * 0.3, 1.4 + Math.random(), 0.9, 1.6, 0.55, 0.14, -0.2, 0.4);
  }
  sfx('renew');
}

/* ---- a priest's Divine Shield: the shield and the ward, and no stun, root or slow holds while it lasts ---- */
function divineShield(e, A, t, cast, rk) {
  const f = t || e;
  addBuff(f, 'shield', f.maxHp * A.shieldPct * rk, A.dur, e.id);
  addBuff(f, 'dr', 0.3, A.dur, e.id);
  f.buffs = f.buffs.filter((b) => b.kind !== 'stun' && b.kind !== 'root' && b.kind !== 'snare' || b.src === 'frozen');
  if (frozenOf(f)) unfreeze(f);
  for (const cat of ['stun', 'root', 'snare']) { const s = ccState(f, cat); s.immune = Math.max(s.immune, GAME.t + A.dur); s.until = Math.max(s.until, s.immune); }
  FX.ring(f.x, f.y + 1, f.z, 1.1, [1.6, 1.5, 0.8], 24, 1.2);
  spellPillar(f.x, f.y, f.z, 0.8, 1.2, 0.8, [1.9, 1.7, 1.0]);
  sfx('heal');
}

/* ------------------------------------------------------------------ */
/* an allied priest offers to raise the fallen player                  */
/* ------------------------------------------------------------------ */
// while the player lies dead, look for a priest of their realm close by who can raise the fallen
function raiseOfferStep(dt) {
  const P = GAME.player;
  if (!P || !GAME.started) return;
  if (P.alive) { if (BAL.offer) raiseOfferEnd(); return; }
  const O = BAL.offer;
  if (O && O.accepted) { raiseOfferWalk(O, dt); return; }
  BAL.offerScan -= dt;
  if (BAL.offerScan > 0) return;
  BAL.offerScan = 1;
  const pr = O ? getEnt(O.id) : null;
  if (pr && pr.alive && dist2(pr.x, pr.z, P.x, P.z) < 34 * 34) return;
  const cand = inDungeon(P) ? null : nearestWhere(P.x, P.z, 30, (o) => o.alive && o.cls === 'priest' && o.faction === P.faction && o.role !== 'player' && o.kind === 'humanoid' && clsHas(o, 'raise') && !o.bot && GAME.t > o.combatUntil - 4 && !o.carrying);
  BAL.offer = cand ? { id: cand.id, name: cand.name, t: GAME.t, accepted: false } : null;
  raiseOfferShow();
}
function raiseOfferShow() {
  const el = $('death-raise');
  if (!el) return;
  const O = BAL.offer;
  el.hidden = !O;
  if (!O) return;
  $('death-raise-who').textContent = O.accepted ? `${O.name} is coming to raise you.` : `${O.name}, a priest of your realm, can raise you here.`;
  $('btn-raise').hidden = !!O.accepted;
}
function raiseOfferAccept() {
  const O = BAL.offer, P = GAME.player;
  if (!O || !P || P.alive) return;
  O.accepted = true; O.at = GAME.t;
  const pr = getEnt(O.id);
  if (pr && pr.ai) {
    pr.ai.raiseP = true;
    // a garrison priest's post moves to the fallen for a while, so their own round does not pull them back
    if (pr.ai.post) { O.post = { ...pr.ai.post }; pr.ai.post = { ...pr.ai.post, x: P.x, z: P.z, leash: Math.max(pr.ai.post.leash || 0, 6) }; }
  }
  raiseOfferShow();
}
// the priest walks over, prays if devotion is short, and raises the player
function raiseOfferWalk(O, dt) {
  const P = GAME.player, pr = getEnt(O.id);
  if (!pr || !pr.alive || GAME.t - O.at > 40) { raiseOfferEnd(); return; }
  const d = dist(pr.x, pr.z, P.x, P.z);
  if (d > 3) { moveToward(pr, P.x, P.z, dt, 1, 2.6); pr.target = null; return; }
  faceToward(pr, P.x, P.z);
  const cs = csOf(pr);
  if (pr.casting) return;
  // short of devotion: a moment's prayer over the fallen (a priest answering a call prays hard)
  if (devOf(pr) < 70) { if (!cs.praying) startPrayer(pr); if (cs.praying) prayStep(pr, dt); addDev(pr, dt * 30); return; }
  if (cs.praying) stopPrayer(pr);
  if (!O.cast) { O.cast = GAME.t; setAct(pr, 3, 2.0); spellPillar(P.x, P.y, P.z, 1.0, 2.4, 0.9, [2.0, 1.7, 1.0]); sfx('cast'); return; }
  if (GAME.t - O.cast < 2) return;
  cs.dev = Math.max(0, devOf(pr) - 70);
  raisePlayer(pr);
}
function raisePlayer(by) {
  const P = GAME.player;
  P.alive = true; P.hp = P.maxHp * 0.4; P.power = P.maxPower * 0.4; P.endurance = 60;
  P.buffs.length = 0; P.casting = null; P.threat = null; P.damagers = null; P.removeAt = 0; P.deadAt = 0;
  P.anim.death = 0;
  addBuff(P, 'shield', P.maxHp * 0.2, 6, by ? by.id : null);
  spellPillar(P.x, P.y, P.z, 1.1, 18, 1.4, [2.2, 1.9, 1.1]);
  FX.levelUp(P.x, P.y, P.z);
  lightFlash(P.x, P.y + 2, P.z, 12, [2.6, 2.2, 1.3], 0.8);
  sfx('raise');
  CLS.stats.raised++;
  BAL.raised++;
  if (by && by.ai) { by.ai.raiseP = false; const O = BAL.offer; if (O && O.post && O.id === by.id) by.ai.post = O.post; }
  $('death').hidden = true;
  if (UI.modal === 'death') UI.modal = null;
  uiLog(by ? `${by.name} raises you from the field.` : 'You rise from the field.', 'level');
  BAL.offer = null;
  raiseOfferShow();
}
function raiseOfferEnd() { const O = BAL.offer; if (O) { const pr = getEnt(O.id); if (pr && pr.ai) { pr.ai.raiseP = false; if (O.post) pr.ai.post = O.post; } } BAL.offer = null; raiseOfferShow(); }
setTimeout(() => {
  const b = $('btn-raise');
  if (b) b.onclick = () => raiseOfferAccept();
}, 0);

/* ---- debug and test hooks ---- */
setTimeout(() => {
  if (!window.__hm) return;
  window.__hm.bal = {
    // the Hollow King back on his throne, whole, for a fresh fight (tests)
    kingFresh() { for (const id of BARROW_STATE.adds) { const o = getEnt(id); if (o) removeEnt(o); } BARROW_STATE.adds.clear(); if (BARROW_STATE.kingDead || !getEnt(BARROW_STATE.king)) spawnKing(); else resetKing(getEnt(BARROW_STATE.king)); return BARROW_STATE.king; },
    canUse, segmentClear, PROJ, // [v9] for the king probes
    BAL, CC_STEPS, CC_WIN, CC_IMMUNE, priestSelf, priestSteadfast, breakCast, botIncoming, ccAdjust, ccFactor, ccState, ccChampion, ccHudState, fairGear, botMake, botStep, botTarget, raiseOfferStep, raiseOfferAccept, raisePlayer, applyFairGear: (P, lvl, q) => { const g = fairGear(P.cls, lvl, q); INV.eq = g.eq; applyGear(); return g.tot; } };
}, 0);
