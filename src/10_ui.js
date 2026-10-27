/* ================================================================== */
/* UI: title, HUD, map, menus, feedback                                */
/* ================================================================== */
const $ = (id) => document.getElementById(id);
const UI = { modal: null, realm: 0, cls: 'warrior', frame: 0, npPool: [], flPool: [], floaters: [], mapImg: null, logOpen: true, errorT: 0 };
const REALM_BLURB = [
  'Stone keeps and slate roofs on rolling downs and wheat fields. Its knights guard the Grail.',
  'Green glens, standing stones and ringforts of mossy stone. Its people keep Lia Fáil, the stone that names kings.',
  'Pine forests and timber halls under cold northern skies. Its jarls guard Draupnir, the ring that multiplies.',
];

/* ------------------------------------------------------------------ */
/* title screen                                                        */
/* ------------------------------------------------------------------ */
function syncTitle() {
  $('realm-pick').querySelectorAll('.realm-card').forEach((b) => b.setAttribute('aria-checked', String(+b.dataset.realm === UI.realm)));
  $('class-pick').querySelectorAll('.class-card').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.cls === UI.cls)));
  $('realm-blurb').textContent = REALM_BLURB[UI.realm];
  $('class-blurb').textContent = CLASSES[UI.cls].blurb;
}
function bindTitle() {
  const rp = $('realm-pick'), cp = $('class-pick');
  rp.innerHTML = REALMS.map((R) => `<button class="realm-card" type="button" role="radio" data-realm="${R.id}" style="--rc:${R.color}" aria-checked="false"><span class="em">${emblemSvg(R.id, 30)}</span><b>${R.name}</b><small>${['Arthurian', 'Celtic', 'Norse'][R.id]}</small></button>`).join('');
  cp.innerHTML = Object.entries(CLASSES).map(([k, C]) => `<button class="class-card" type="button" role="radio" data-cls="${k}" aria-checked="false"><span class="row">${iconSvg(C.icon, 20)}<b>${C.name}</b></span><span class="role">${C.role}</span></button>`).join('');
  rp.addEventListener('click', (e) => { const b = e.target.closest('.realm-card'); if (!b) return; audioUnlock(); UI.realm = +b.dataset.realm; if (!UI.nameTouched) $('name-input').value = randomName(UI.realm); syncTitle(); sfx('click'); });
  cp.addEventListener('click', (e) => { const b = e.target.closest('.class-card'); if (!b) return; audioUnlock(); UI.cls = b.dataset.cls; syncTitle(); sfx('click'); });
  $('btn-dice').onclick = () => { $('name-input').value = randomName(UI.realm); UI.nameTouched = false; };
  $('name-input').addEventListener('input', () => { UI.nameTouched = true; });
  $('name-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('btn-begin').click(); });
  $('btn-begin').onclick = () => {
    if (GAME.started) return;
    if (UI.titleSave?.char) {
      audioUnlock();
      void nativePlayerBegin({ ...UI.titleSave.char, fresh: false });
      return;
    }
    const name = ($('name-input').value || '').trim().replace(/\s+/g, ' ').slice(0, 18) || randomName(UI.realm);
    audioUnlock();
    void nativePlayerBegin({ v: 1, name, realm: UI.realm, cls: UI.cls, level: 1, xp: 0, rp: 0, fresh: true });
  };
  $('btn-continue').onclick = () => {
    const s = UI.titleSave;
    if (GAME.started || !s || !s.char) return;
    audioUnlock();
    void nativePlayerBegin({ ...s.char, fresh: false });
  };
  UI.titleBound = true;
}
function setupTitle(save) {
  if (!UI.titleBound) bindTitle();
  UI.titleSave = save && save.char ? save : null;
  UI.nameTouched = false;
  $('character-create-fields').hidden = !!UI.titleSave;
  if (UI.titleSave) {
    const c = save.char;
    $('continue').hidden = false;
    $('continue-desc').textContent = `${c.name}, level ${c.level} ${CLASSES[c.cls].name} of ${REALMS[c.realm].name}. Realm rank ${realmRank(c.rp || 0)}.`;
    if ($('season-title')) $('season-title').textContent = seasonTitleText(save); // [loops] the season, and what happened while you were away (08n_season.js)
    UI.realm = c.realm; UI.cls = c.cls;
  } else $('continue').hidden = true;
  $('name-input').value = randomName(UI.realm);
  $('save-note').textContent = nativePlayerSaveMessage();
  nativePlayerRender();
  syncTitle();
  $('title').hidden = false;
}

/* ------------------------------------------------------------------ */
/* HUD construction                                                    */
/* ------------------------------------------------------------------ */
function bindHUD() {
  $('hotbar').addEventListener('click', (e) => { const b = e.target.closest('.slot'); if (!b) return; e.preventDefault(); if (b.dataset.potion) usePotion(); else playerUseSlot(+b.dataset.slot); });
  // Abilities and Jump act on pointer-down, including a second finger while
  // the movement stick remains held. Route Jump through its normal click path
  // so its swimming/boat action and keyboard activation remain the same.
  $('tpad').addEventListener('pointerdown', (e) => {
    const jump = e.target.closest('#t-jump');
    if (jump && !jump.disabled && !UI.modal) { e.preventDefault(); jump.click(); return; }
    const b = e.target.closest('.slot');
    if (b) { e.preventDefault(); if (b.dataset.potion) usePotion(); else playerUseSlot(+b.dataset.slot); }
  });
  // Capture above the pad's water-action listener: a pointer already activated
  // Jump/Dive on down, while detail-zero keyboard clicks still activate once.
  $('hud').addEventListener('click', (e) => {
    if (e.target.closest('#t-jump') && (e.detail > 0 || e.pointerType === 'touch' || e.pointerType === 'pen')) {
      e.preventDefault(); e.stopImmediatePropagation();
    }
  }, true);
  $('tpad').addEventListener('click', (e) => {
    const P = GAME.player;
    if (!P || UI.modal) return;
    const id = e.target.closest('button')?.id;
    if (id === 't-target') cycleTarget();
    if (id === 't-use') playerInteract();
    if (id === 't-jump' && P.onGround && P.alive && !isRooted(P)) { P.vy = P.mount ? 7.0 : 6.2; P.onGround = false; }
    if (id === 't-ride') toggleMount();
    if (id === 't-potion') usePotion();
    if (id === 't-kit') openKit('kit');
  });
  $('btn-map').onclick = () => toggleMap();
  $('btn-kit').onclick = () => toggleKit();
  $('btn-menu').onclick = () => openMenu('char');
  $('btn-log').onclick = () => toggleLog();
  $('prompt').onclick = () => playerInteract();
  UI.hudBound = true;
  mobileBind();
}
function buildHUD() {
  if (!UI.hudBound) bindHUD();
  buildHotbar();
  if (IS_TOUCH) document.body.classList.add('touch');
  $('log').innerHTML = '';
  $('hud').hidden = false;
  updateWarPanel();
}
// the ability bar, rebuilt on level-ups so ranks and new abilities show
function buildHotbar() {
  const P = GAME.player;
  if (!P) return;
  if (IS_TOUCH && CLS.hold) classHold(false);
  const abil = CLASSES[P.cls].abilities;
  const rank = abilityRank(P.level), rn = RANK_NUMERAL[rank];
  const slotHTML = (k, i, keyLabel) => {
    const A = ABILITIES[k];
    const known = A.level <= P.level, ranked = known && rank > 1;
    return `<button class="slot" type="button" data-slot="${i}" aria-label="${A.name}">${iconSvg(A.icon, 26)}<span class="key">${keyLabel}</span>${ranked ? `<span class="rk">${rn}</span>` : ''}<span class="cost">${A.cost}</span><span class="cd"></span><span class="cdt"></span><span class="lock"></span><span class="tip panel"><b>${A.name}${ranked ? ' ' + rn : ''}</b><em>${A.cast ? A.cast + ' s cast' : 'Instant'} · ${A.cost} power${A.cd ? ' · ' + A.cd + ' s cooldown' : ''}${typeof A.range === 'number' ? ' · ' + A.range + ' m' : ''}</em>${A.desc}${ranked ? `<br><em style="margin-top:4px">Rank ${rn}: ${Math.round((rankMult(P.level) - 1) * 100)}% stronger. The next rank comes at level ${Math.min(LEVEL_CAP, 20 + rank * 10)}.</em>` : `<br><em style="margin-top:4px">Learned at level ${A.level}</em>`}</span></button>`;
  };
  const potHTML = (key) => `<button class="slot potion" type="button" data-potion="1" aria-label="Drink a healing draught">${iconSvg('potion', 26)}<span class="key">${key}</span><span class="cnt"></span><span class="cd"></span><span class="cdt"></span><span class="tip panel"><b>Healing draught</b><em>Instant · ${POTION.cd} s cooldown</em>Restores 40% of your health. Merchants in the towns sell them.</span></button>`;
  $('hotbar').innerHTML = abil.map((k, i) => slotHTML(k, i, i + 1)).join('') + '<span class="sep"></span>' + potHTML('Q');
  $('tpad').innerHTML = abil.map((k, i) => slotHTML(k, i, '')).join('') + `<div class="wide"><button class="btn" type="button" id="t-target">Target</button><button class="btn" type="button" id="t-use">Use</button><button class="btn" type="button" id="t-jump" data-pointer-action>Jump</button><button class="btn" type="button" id="t-ride">Ride</button><button class="btn" type="button" id="t-potion">Potion</button><button class="btn" type="button" id="t-kit">Kit</button></div>`;
  UI.slots = [...document.querySelectorAll('#hotbar .slot:not(.potion)'), ...document.querySelectorAll('#tpad .slot:not(.potion)')];
  updatePotionSlot();
  giftHotbar(); // [gifts] the realm gift on key 9 and on the phone pad, the passive marks (06c_gifts.js)
  classHotbar(); // [classes] the class panel, and the technique and hold buttons on the phone pad (10d_classes_ui.js)
  mobileBuild();
}
function flashSlot(i) { for (const s of UI.slots || []) if (+s.dataset.slot === i) { s.classList.remove('flash'); void s.offsetWidth; s.classList.add('flash'); } }
function toggleLog() { const l = $('log'); if (IS_TOUCH) l.classList.toggle('show'); else l.classList.toggle('hidden'); }

/* ------------------------------------------------------------------ */
/* HUD updates                                                         */
/* ------------------------------------------------------------------ */
const setW = (el, f) => { const v = (clamp(isFiniteNum(f) ? f : 0, 0, 1) * 100).toFixed(1) + '%'; if (el._w !== v) { el.style.width = v; el._w = v; } };
const setT = (el, t) => { if (el._t !== t) { el.textContent = t; el._t = t; } };
const BUFF_ICON = { burn: ['flame', '#ff8a3a'], stun: ['burst', '#ffd36a'], snare: ['chain', '#7fb0ff'], root: ['chain', '#7fe0ff'], dr: ['tower', '#e8e0c8'], dmg: ['horn', '#ffb36a'], shield: ['ward', '#a8d0ff'], hot: ['leaf', '#9fe89c'], dot: ['candle', '#ff9a6a'], free: ['leap', '#c8f0c8'] };
function buffsHTML(e) {
  const seen = new Set();
  return e.buffs.filter((b) => b.until > GAME.t && !seen.has(b.kind) && seen.add(b.kind)).map((b) => { const [ic, c] = BUFF_ICON[b.kind] || ['circle', '#ccc']; return `<span class="buff" style="--bc:${c}" title="${b.kind}">${iconSvg(ic, 14)}</span>`; }).join('');
}
function unitSub(e, viewer) {
  if (e.siegeEngine) return 'Siege engine'; // [siege] (04h_siege.js)
  if (e.kind === 'door') return e.keepRef ? `Gate of ${e.keepRef.site.name}` : `Gate of ${e.templeRef.site.name}`;
  if (e.role === 'dungeonBoss') return 'Undead · lord of the barrow';
  if (e.role === 'mob') return `${e.mobType === 'wisp' ? 'Spirit' : e.kind === 'humanoid' ? (e.mobType === 'skeleton' || e.mobType === 'draugr' ? 'Undead' : 'Hostile') : 'Beast'}${e.l2risen ? ' · risen champion' /* [late2] 10l_late.js */ : e.elite ? ' · elite' : ''} · ${CON[conIndex(e.level, viewer.level)].name} to you`;
  if (e.faction <= 2) {
    const R = REALMS[e.faction];
    const role = { player: CLASSES[e.cls].name, remote: `${CLASSES[e.cls].name} · a player` /* [net] another page's player (14n_net.js) */, soldier: CLASSES[e.cls].name, guard: `${CLASSES[e.cls].name} of the garrison`, lord: 'Keep lord', guardian: 'Hallow warden', muster: 'Muster warden' }[e.role] || '';
    return `${R.name} · ${role}`;
  }
  return e.role === 'herald' ? 'Herald' : e.role === 'merchant' ? 'Merchant' : 'Villager';
}
function nameColor(e, P) {
  if (e.kind === 'door') return e.faction <= 2 ? REALMS[e.faction].light : '#ddd';
  if (e.faction === FACTION_NEUTRAL) return '#e9dfc9';
  if (e.faction === FACTION_MONSTER) return CON[conIndex(e.level, P.level)].col;
  if (e.faction === P.faction) return '#9fd8ff';
  return REALMS[e.faction].light;
}
function updateHUD(dt) {
  const P = GAME.player, prog = GAME.prog;
  UI.frame++;
  // player frame
  setT($('pf-name'), late4FrameName(P)); $('pf-name').classList.toggle('l4-long', LATE4.frameSmall); // [late2] with the name it wears (10l_late.js); [late4] on a phone a long one in a smaller letter, the deed whole and your own shortened if need be (10o_late4.js)
  setT($('pf-lv'), `Lv ${prog.level}`);
  setT($('pf-sub'), `${REALMS[P.faction].name} ${CLASSES[P.cls].name} · RR ${realmRank(prog.rp)} ${RANK_TITLES[realmRank(prog.rp) - 1]}`);
  setW($('pf-hp'), P.hp / P.maxHp); setW($('pf-hpl'), P.hp / P.maxHp);
  setT($('pf-hpt'), `${fmtInt(Math.max(0, P.hp))} / ${fmtInt(P.maxHp)}`);
  setW($('pf-pw'), P.power / P.maxPower); setT($('pf-pwt'), `${fmtInt(P.power)} / ${fmtInt(P.maxPower)}`);
  setW($('pf-en'), P.endurance / 100);
  const need = xpToNext(prog.level);
  const vb = prog.level >= LEVEL_CAP ? late2XpBar() : null; // [late2] past the cap, veterancy (10l_late.js)
  setW($('pf-xp'), vb ? vb[0] : prog.xp / need);
  setT($('pf-xpt'), vb ? vb[1] : `XP ${fmtInt(prog.xp)} / ${fmtInt(need)}`);
  setT($('pf-rpt'), `${fmtInt(prog.rp)} RP`);
  if (UI.frame % 6 === 0) { const h = buffsHTML(P); if ($('pf-buffs')._h !== h) { $('pf-buffs').innerHTML = h; $('pf-buffs')._h = h; } }
  // target frame
  const t = getEnt(P.target);
  const tf = $('tf');
  if (t) {
    tf.hidden = false;
    setT($('tf-name'), t.name);
    setT($('tf-lv'), t.kind === 'door' ? '' : `Lv ${t.level}`);
    $('tf-con').style.setProperty('--con', t.faction === FACTION_MONSTER ? CON[conIndex(t.level, P.level)].col : t.faction <= 2 ? REALMS[t.faction].color : '#ccc');
    setT($('tf-sub'), unitSub(t, P) + (t.alive ? '' : ' · dead'));
    const f = t.alive ? t.hp / t.maxHp : 0;
    setW($('tf-hp'), f); setW($('tf-hpl'), f);
    setT($('tf-hpt'), t.kind === 'door' ? `${Math.ceil(f * 100)}%` + (doorVulnerable(t) ? '' : ' · protected') : `${Math.ceil(f * 100)}%`);
    const cw = $('tf-castw');
    if (t.casting) { cw.classList.add('on'); setW($('tf-cast'), t.casting.t / t.casting.total); } else cw.classList.remove('on');
    if (UI.frame % 6 === 0) { const h = buffsHTML(t); if ($('tf-buffs')._h !== h) { $('tf-buffs').innerHTML = h; $('tf-buffs')._h = h; } }
  } else tf.hidden = true;
  // cast bar
  const cb = $('castbar');
  if (P.casting) { cb.classList.add('on'); const A = ABILITIES[P.casting.id]; setT($('cast-n'), A.name); setT($('cast-t'), Math.max(0, P.casting.total - P.casting.t).toFixed(1) + ' s'); setW($('cast-b'), P.casting.t / P.casting.total); }
  else if (SURV.job) { const J = survJobBar(); cb.classList.add('on'); setT($('cast-n'), J.label); setT($('cast-t'), J.count); setW($('cast-b'), J.count && SURV.job.n > 1 ? (SURV.job.i + J.frac) / SURV.job.n : J.frac); } // [survival] crafting, cooking, mining, picking (09s_survival.js)
  else if (farmCastBar()) { /* [farming] tilling, sowing, weeding, harvesting (08h_farming.js) */ }
  else if (NATURE.job) { const J = NATURE.job; cb.classList.add('on'); setT($('cast-n'), J.kind === 'chop' ? 'Chopping' : 'Splitting the log'); setT($('cast-t'), `${J.swings} / ${J.need}`); setW($('cast-b'), J.swings / J.need); } // nature (05h_nature.js): axe work
  else cb.classList.remove('on');
  // hotbar
  const abil = CLASSES[P.cls].abilities;
  for (const s of UI.slots) {
    const i = +s.dataset.slot, A = ABILITIES[abil[i]];
    const locked = A.level > prog.level;
    s.classList.toggle('locked', locked);
    const lk = s.querySelector('.lock'); setT(lk, locked ? `Lv ${A.level}` : '');
    const rem = Math.max((P.cds[A.id] || 0) - GAME.t, P.gcdUntil - GAME.t, 0);
    const total = rem > P.gcdUntil - GAME.t + 0.01 ? A.cd : 0.6;
    { const pv = rem > 0 ? (rem / Math.max(total, 0.01)).toFixed(3) : 0; if (s._p !== pv) { s.style.setProperty('--p', pv); s._p = pv; } } // [perf2] (each slot's style was set every frame, changed or not)
    setT(s.querySelector('.cdt'), rem > 1 ? Math.ceil(rem) : '');
    setT(s.querySelector('.cost'), A.id === 'renew' && resolveTarget(P, A, t) === P && renewRote(P) ? A.cost * RENEW_ROTE_K : A.cost); // [balance6] renewing yourself by rote costs more: the slot shows that price (07c_balance6.js)
    s.classList.toggle('nopower', !locked && P.power < A.cost);
    let outRange = false;
    if (!locked && !A.self && !A.friendly && t && t.alive && isEnemy(P, t)) outRange = dist(P.x, P.z, t.x, t.z) > abilityRange(P, A, t);
    s.classList.toggle('range', outRange);
  }
  // interaction prompt
  const it = currentInteraction();
  const pr = $('prompt');
  if (it && P.alive && !UI.modal) { pr.classList.add('on'); setT($('prompt-t'), it.label); } else pr.classList.remove('on');
  if (IS_TOUCH && $('t-use')) {
    const label = it && P.alive ? it.label : 'Use';
    setT($('t-use'), mobileInteractionLabel(label));
    $('t-use').classList.toggle('has-context', !!it && P.alive);
    $('t-use').setAttribute('aria-label', label);
    $('t-use').title = label;
  }
  // carrying
  const ca = $('carry');
  if (P.carrying != null) { const R = REALMS[P.carrying]; ca.classList.add('on'); ca.style.setProperty('--rcol', R.color); setT(ca, `Carrying ${R.hallow}. Bring it to your temple gate: the ${REALMS[P.faction].templeName}.`); }
  else ca.classList.remove('on');
  // bounty
  const bo = $('bounty'), b = prog.bounty;
  if (b) { bo.classList.add('on'); const h = `<b>Herald's bounty</b><span>${b.done ? 'Done: return to the herald' : b.risen ? `Bring down ${esc(b.name)}` /* [late2] a risen champion (10l_late.js) */ : `Slay ${pluralName(b.name)}`}</span><span class="num">${b.have} / ${b.need}</span>`; if (bo._h !== h) { bo.innerHTML = h; bo._h = h; } }
  else bo.classList.remove('on');
  updatePotionSlot();
  // error fade
  if (UI.errorT > 0) { UI.errorT -= dt; if (UI.errorT <= 0) $('error').classList.remove('on'); }
  if (UI.frame % 15 === 1) updateWarPanel();
  updateCampaignUI(dt); // [campaign] the victory screen and the live map (08g_campaign.js)
  if (UI.frame % 3 === 1) drawMinimap();
  updateNameplates();
  updateFloaters(dt);
  mobileHUD(dt);
}
function updateWarPanel() {
  const P = GAME.player;
  const rows = REALMS.map((R) => {
    const keeps = WAR.keeps.filter((K) => K.realm === R.id).length;
    const rel = WAR.relics.filter((x) => x.state === 'temple' && x.at === R.id).map((x) => `<i style="--rc:${REALMS[x.realm].color}" title="${REALMS[x.realm].hallow}"></i>`).join('');
    return `<div class="row ${R.id === P.faction ? 'me' : ''}" style="--rc:${R.color}"><span class="sw"></span><span>${R.name}</span><span class="k" title="Keeps held">${keeps} keeps</span><span class="rel">${rel}</span></div>`;
  }).join('');
  const html = rows + campaignHudHTML() /* [campaign] 08g_campaign.js */ + guideWarAimHTML() /* [guide2] your own aim, a tap from the Aims page (10f_guide2.js) */ + netSeasonHudHTML() /* [net] the season on the server (14q_netseason.js) */ + `<div class="tod"><span>${SEASON.name /* [farming] the season (08h_farming.js) */} · ${todPhaseName(tod.p)}${WEATHER.kind !== 'clear' ? ' · ' + WEATHER.label : ''}${wxForecastText() /* [weather2] what is coming, and from where (12c_weather2.js) */}</span><span class="todm">${tod.mode === 'cycle' ? 'Day cycle' : 'Fixed'}</span></div>`;
  const w = $('war');
  if (w._h !== html) { w.innerHTML = html; w._h = html; }
}

/* ------------------------------------------------------------------ */
/* map image (rendered once from the world data)                       */
/* ------------------------------------------------------------------ */
function buildMapImage() {
  const S = 512;
  const c = document.createElement('canvas');
  c.width = S; c.height = S;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(S, S);
  const rcols = REALMS.map((R) => hex3(R.color));
  for (let py = 0; py < S; py++) {
    for (let px = 0; px < S; px++) {
      const x = -HALF + (px + 0.5) * (WSIZE / S), z = -HALF + (py + 0.5) * (WSIZE / S);
      const h = heightAt(x, z);
      const hx = heightAt(x + 2, z) - heightAt(x - 2, z), hz = heightAt(x, z + 2) - heightAt(x, z - 2);
      const shade = clamp(0.78 + (-hx * 0.55 - hz * 0.55) * 0.12, 0.45, 1.2);
      const rw = realmWeightsAt(x, z);
      // [perf2] the same sums channel by channel (six arrays a pixel were made and thrown away: a phone spent seconds here)
      let c0 = 0.34, c1 = 0.42, c2 = 0.24;
      for (let k = 0; k < 3; k++) { const rc = rcols[k], w = rw[k]; c0 = c0 + (rc[0] - 0.35) * w * 0.18; c1 = c1 + (rc[1] - 0.35) * w * 0.18; c2 = c2 + (rc[2] - 0.35) * w * 0.18; }
      const rk = sampleGrid(W.rock, x, z), rd = sampleGrid(W.road, x, z), fl = sampleGrid(W.field, x, z);
      c0 = lerp(c0, 0.5, rk); c1 = lerp(c1, 0.48, rk); c2 = lerp(c2, 0.45, rk);
      if (h > 24) { const sk = clamp((h - 24) / 16, 0, 0.8); c0 = lerp(c0, 0.88, sk); c1 = lerp(c1, 0.88, sk); c2 = lerp(c2, 0.88, sk); }
      c0 = lerp(c0, 0.72, fl * 0.8); c1 = lerp(c1, 0.6, fl * 0.8); c2 = lerp(c2, 0.3, fl * 0.8);
      c0 = lerp(c0, 0.6, rd * 0.9); c1 = lerp(c1, 0.5, rd * 0.9); c2 = lerp(c2, 0.36, rd * 0.9);
      { const wa = waterAt(x, z); if (wa && wa.depth > 0.05) { if (wa.fx || wa.fz) { c0 = 0.16; c1 = 0.3; c2 = 0.38; } else { c0 = 0.12; c1 = 0.24; c2 = 0.32; } } } // [water] lakes, ponds and rivers
      const k = (py * S + px) * 4;
      img.data[k] = clamp(c0 * shade, 0, 1) * 255; img.data[k + 1] = clamp(c1 * shade, 0, 1) * 255; img.data[k + 2] = clamp(c2 * shade, 0, 1) * 255; img.data[k + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  ctx.fillStyle = 'rgba(16, 40, 20, 0.5)';
  for (const t of W.trees) { const px = (t.x + HALF) / 2, py = (t.z + HALF) / 2; ctx.fillRect(px - 0.8, py - 0.8, 1.6, 1.6); }
  UI.mapImg = c;
}
const w2m = (x, z, S) => [((x + HALF) / WSIZE) * S, ((z + HALF) / WSIZE) * S];
/* the barrow's own map: 4 px to the metre */
const DMAP_PX = 4;
function buildDungeonMap() {
  const GW = DUN.GW, GH = DUN.GH, k = DMAP_PX;
  const c = document.createElement('canvas');
  c.width = GW * k; c.height = GH * k;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#0b0c0e'; ctx.fillRect(0, 0, c.width, c.height);
  for (let j = 0; j < GH; j++) for (let i = 0; i < GW; i++) {
    const t = DUN.cell[j * GW + i];
    if (!t) continue;
    const f = DUN.fy[j * GW + i];
    const g = Math.round(clamp(118 + f * 6, 60, 140));
    ctx.fillStyle = t === 3 ? '#cfd9e2' : `rgb(${g + 14},${g + 6},${g - 8})`;
    ctx.fillRect(i * k, j * k, k, k);
  }
  // walls drawn as a darker rim
  ctx.fillStyle = 'rgba(30,26,22,0.95)';
  for (let j = 0; j < GH; j++) for (let i = 0; i < GW; i++) {
    if (DUN.cell[j * GW + i]) continue;
    let near = false;
    for (const [a, b] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const q = dunIdx(i + a, j + b); if (q >= 0 && DUN.cell[q]) near = true; }
    if (near) ctx.fillRect(i * k, j * k, k, k);
  }
  UI.dunImg = c;
}
const d2m = (x, z) => [(dunU(x) - DUN.u0) * DMAP_PX, (dunV(z) - DUN.v0) * DMAP_PX];
function drawSiteIcon(ctx, kind, x, y, s, col, alarm = false) {
  ctx.save();
  ctx.translate(x, y);
  ctx.lineWidth = Math.max(1, s * 0.14);
  ctx.strokeStyle = '#0c0d10';
  ctx.fillStyle = col;
  ctx.beginPath();
  if (kind === 'keep') { ctx.moveTo(-s, -s * 0.8); ctx.lineTo(s, -s * 0.8); ctx.lineTo(s, s * 0.2); ctx.quadraticCurveTo(s * 0.8, s, 0, s * 1.2); ctx.quadraticCurveTo(-s * 0.8, s, -s, s * 0.2); ctx.closePath(); }
  else if (kind === 'temple') { for (let i = 0; i < 6; i++) { const a = (i / 6) * TAU; ctx.lineTo(Math.cos(a) * s, Math.sin(a) * s); } ctx.closePath(); }
  else if (kind === 'muster') { ctx.moveTo(0, -s); ctx.lineTo(s, s * 0.8); ctx.lineTo(-s, s * 0.8); ctx.closePath(); }
  else { ctx.arc(0, 0, s * 0.8, 0, TAU); }
  ctx.fill(); ctx.stroke();
  if (alarm) { ctx.strokeStyle = `rgba(255,90,60,${0.5 + 0.5 * Math.sin(GAME.t * 6)})`; ctx.lineWidth = s * 0.3; ctx.beginPath(); ctx.arc(0, 0, s * 1.9, 0, TAU); ctx.stroke(); }
  ctx.restore();
}
function drawMinimap() {
  const cv = $('minimap'), P = GAME.player;
  if (!cv || !UI.mapImg) return;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  // [perf2] the minimap's size from a ResizeObserver: reading clientWidth here, after the frame's writes to the HUD,
  // made the browser lay the whole page out at once every third frame
  if (!UI.mmRO && typeof ResizeObserver === 'function') { UI.mmRO = new ResizeObserver(() => { UI.mmSize = cv.clientWidth; }); UI.mmRO.observe(cv); UI.mmSize = cv.clientWidth; }
  const size = (UI.mmRO ? UI.mmSize : cv.clientWidth) || 186;
  if (cv.width !== Math.round(size * dpr)) { cv.width = Math.round(size * dpr); cv.height = Math.round(size * dpr); }
  const ctx = cv.getContext('2d');
  const S = cv.width;
  const dun = INDOOR.on && UI.dunImg;
  const range = dun ? 34 : 130; // metres from centre to edge
  const k = S / (2 * range);
  ctx.fillStyle = '#0d0f12';
  ctx.fillRect(0, 0, S, S);
  ctx.imageSmoothingEnabled = !dun;
  if (dun) {
    const [px, py] = d2m(P.x, P.z);
    ctx.drawImage(UI.dunImg, px - range * DMAP_PX, py - range * DMAP_PX, 2 * range * DMAP_PX, 2 * range * DMAP_PX, 0, 0, S, S);
  } else {
    // world image: 0.5 px per metre
    const src = UI.mapImg, sScale = 512 / WSIZE;
    ctx.drawImage(src, (P.x - range + HALF) * sScale, (P.z - range + HALF) * sScale, 2 * range * sScale, 2 * range * sScale, 0, 0, S, S);
  }
  ctx.imageSmoothingEnabled = true;
  const toM = (x, z) => [(x - P.x) * k + S / 2, (z - P.z) * k + S / 2];
  if (dun) {
    for (const t of DUN.torches) { const [x, y] = toM(t.x, t.z); ctx.fillStyle = 'rgba(255,170,80,0.9)'; ctx.beginPath(); ctx.arc(x, y, 1.6 * dpr, 0, TAU); ctx.fill(); }
    for (const ch of DUN.chests) if (ch.ready && !ch.opened) { const [x, y] = toM(ch.x, ch.z); ctx.fillStyle = '#ffd36a'; ctx.fillRect(x - 3 * dpr, y - 2 * dpr, 6 * dpr, 4 * dpr); }
    { const e = DUN.spots.exit; const [x, y] = toM(e.x, e.z); ctx.strokeStyle = '#dfe9f2'; ctx.lineWidth = 1.5 * dpr; ctx.beginPath(); ctx.moveTo(x - 4 * dpr, y); ctx.lineTo(x + 4 * dpr, y); ctx.moveTo(x, y - 4 * dpr); ctx.lineTo(x - 4 * dpr, y); ctx.lineTo(x, y + 4 * dpr); ctx.stroke(); }
    for (const key in DUN.gates) { const g = DUN.gates[key]; if (g.open > 0.5) continue; const [x, y] = toM(g.coll.x, g.coll.z); ctx.fillStyle = '#c84a3a'; ctx.fillRect(x - 1.5 * dpr, y - g.coll.hz * k, 3 * dpr, g.coll.hz * 2 * k); }
  }
  if (!dun) for (const K of WAR.keeps) { const [x, y] = toM(K.site.x, K.site.z); drawSiteIcon(ctx, 'keep', x, y, 6 * dpr, REALMS[K.realm].color, GAME.t < K.underSiegeUntil); }
  if (!dun) {
    for (const T of WAR.temples) { const [x, y] = toM(T.site.x, T.site.z); drawSiteIcon(ctx, 'temple', x, y, 5.5 * dpr, REALMS[T.realm].color); }
    for (const R of REALMS) { let [x, y] = toM(R.musterSite.x, R.musterSite.z); drawSiteIcon(ctx, 'muster', x, y, 5 * dpr, REALMS[R.id].color); [x, y] = toM(R.town.x, R.town.z); drawSiteIcon(ctx, 'town', x, y, 5 * dpr, '#e9dfc9'); }
    { const [x, y] = toM(BARROW.x, BARROW.z); drawBarrowIcon(ctx, x, y, 5 * dpr); }
  }
  // the dragon, wherever it is in range
  const Dg = DRAGON.e;
  if (Dg && Dg.alive && !Dg.removed) {
    const [x, y] = toM(Dg.x, Dg.z);
    if (x > -6 && y > -6 && x < S + 6 && y < S + 6) {
      ctx.save(); ctx.translate(x, y); ctx.rotate(Dg.yaw * -1 + Math.PI);
      ctx.fillStyle = '#ff5a2a'; ctx.strokeStyle = '#2a0a04'; ctx.lineWidth = 1.2 * dpr;
      ctx.beginPath(); ctx.moveTo(0, -6 * dpr); ctx.lineTo(5 * dpr, 3 * dpr); ctx.lineTo(0, 1 * dpr); ctx.lineTo(-5 * dpr, 3 * dpr); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.restore();
    }
  }
  forNear(P.x, P.z, range * 1.42, (e) => {
    if (!e.alive || e === P || e.kind === 'door' || e.role === 'critter' || e.kind === 'dragon') return;
    const [x, y] = toM(e.x, e.z);
    if (x < -4 || y < -4 || x > S + 4 || y > S + 4) return;
    let col;
    if (e.faction === FACTION_MONSTER) col = CON[conIndex(e.level, P.level)].col;
    else if (e.faction === FACTION_NEUTRAL) col = '#e9dfc9';
    else col = e.faction === P.faction ? '#9fd8ff' : REALMS[e.faction].color;
    ctx.fillStyle = col;
    ctx.beginPath(); ctx.arc(x, y, (e.faction <= 2 && e.faction !== P.faction ? 2.4 : 1.8) * dpr, 0, TAU); ctx.fill();
  });
  for (const rel of WAR.relics) { const p = relicPosition(rel); const [x, y] = toM(p.x, p.z); ctx.fillStyle = '#ffe28a'; ctx.beginPath(); ctx.arc(x, y, 3.2 * dpr, 0, TAU); ctx.fill(); }
  drawTrackedMinimap(ctx, toM, S, dpr); // [balance] the archer's tracked quarry (07c_balance.js)
  if (!dun) drawFarmMap(ctx, toM, k); // [farming] your beds and the town strips (08i_farm_draw.js)
  if (!dun) drawCampaignMinimap(ctx, toM, S, dpr); // [campaign] warband routes and orders (08g_campaign.js)
  guideMinimap(ctx, toM, S, dpr); // [guide] where your path's next step is (10e_guide.js)
  netMinimap(ctx, toM, S, dpr); // [net] the others in the March (14o_netui.js)
  const t = getEnt(P.target);
  if (t) { const [x, y] = toM(t.x, t.z); ctx.strokeStyle = '#ffe28a'; ctx.lineWidth = 1.5 * dpr; ctx.beginPath(); ctx.arc(x, y, 5 * dpr, 0, TAU); ctx.stroke(); }
  // view cone and player arrow
  ctx.save();
  ctx.translate(S / 2, S / 2);
  ctx.fillStyle = 'rgba(255,255,255,0.08)';
  ctx.beginPath(); ctx.moveTo(0, 0);
  const cy = -CAM.yaw + Math.PI;
  ctx.arc(0, 0, S * 0.45, cy - Math.PI / 2 - 0.5, cy - Math.PI / 2 + 0.5); ctx.closePath(); ctx.fill();
  ctx.rotate(-P.yaw + Math.PI);
  ctx.fillStyle = '#fff'; ctx.strokeStyle = '#000'; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(0, -7 * dpr); ctx.lineTo(5 * dpr, 6 * dpr); ctx.lineTo(0, 3 * dpr); ctx.lineTo(-5 * dpr, 6 * dpr); ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.restore();
  // [perf2] the N drawn once and set in place (its fillText, the font found again each time, was the minimap's dearest call)
  const fontsIn = !document.fonts || document.fonts.status === 'loaded';
  if (!UI.mmN || UI.mmN.dpr !== dpr || (!UI.mmN.fontsIn && fontsIn)) { // (again once the web fonts are in)
    const c = document.createElement('canvas'), x = c.getContext('2d');
    c.width = Math.ceil(14 * dpr); c.height = Math.ceil(15 * dpr); c.dpr = dpr; c.fontsIn = fontsIn;
    x.fillStyle = 'rgba(239,230,211,0.8)'; x.font = `${10 * dpr}px Alegreya Sans, sans-serif`; x.fillText('N', 0, 11 * dpr);
    UI.mmN = c;
  }
  ctx.drawImage(UI.mmN, S / 2 - 3 * dpr, 0);
}
function drawBarrowIcon(ctx, x, y, s) {
  ctx.save(); ctx.translate(x, y);
  ctx.fillStyle = '#7fd6d0'; ctx.strokeStyle = '#0c0d10'; ctx.lineWidth = Math.max(1, s * 0.16);
  ctx.beginPath(); ctx.moveTo(-s * 1.2, s * 0.6); ctx.quadraticCurveTo(0, -s * 1.4, s * 1.2, s * 0.6); ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#0c0d10'; ctx.fillRect(-s * 0.22, -s * 0.05, s * 0.44, s * 0.65);
  ctx.restore();
}
function drawDungeonMapView(ctx, S, P) {
  ctx.fillStyle = '#0b0c0e'; ctx.fillRect(0, 0, S, S);
  const img = UI.dunImg, sc = S / img.width, oy = (S - img.height * sc) / 2;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(img, 0, oy, img.width * sc, img.height * sc);
  ctx.imageSmoothingEnabled = true;
  const m = (x, z) => { const [a, b] = d2m(x, z); return [a * sc, oy + b * sc]; };
  ctx.textAlign = 'center';
  const kpx = S / Math.max(1, $('mapcanvas').clientWidth || S);
  ctx.font = `${Math.max(S * 0.016, 10 * kpx)}px "Alegreya Sans", sans-serif`;
  const seen = new Set();
  for (const R of DUN_ROOMS) {
    if (seen.has(R.name) || R.id === 'sidepass' || R.id === 'c5' || R.id === 'gate' || R.id === 'vaultpass') continue;
    seen.add(R.name);
    const [x, y] = m(dunWX((R.u[0] + R.u[1]) / 2), dunWZ(R.v[1] + 3.5));
    ctx.fillStyle = 'rgba(0,0,0,0.7)'; ctx.fillText(R.name, x + 1, y + 1); ctx.fillStyle = '#e9dfc9'; ctx.fillText(R.name, x, y);
  }
  for (const ch of DUN.chests) if (ch.ready && !ch.opened) { const [x, y] = m(ch.x, ch.z); ctx.fillStyle = '#ffd36a'; ctx.fillRect(x - 4, y - 3, 8, 6); }
  const [px, py] = m(P.x, P.z);
  ctx.save(); ctx.translate(px, py); ctx.rotate(-P.yaw + Math.PI);
  ctx.fillStyle = '#fff'; ctx.strokeStyle = '#000'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(0, -S * 0.016); ctx.lineTo(S * 0.011, S * 0.013); ctx.lineTo(0, S * 0.006); ctx.lineTo(-S * 0.011, S * 0.013); ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.restore();
  const side = $('mapside');
  side.innerHTML = `<h3>The Hollow Barrow</h3><p>The old dead of the March sleep badly here. Their king sits his throne at the far end, behind the gate of the Well of Souls.</p>
    <ul><li><b>Way out</b><span>the stair by the mouth</span></li><li><b>The gate</b><span>${DUN.gates.well.open > 0.5 ? 'open' : 'shut: its warden holds the key'}</span></li><li><b>The Hollow King</b><span>${BARROW_STATE.kingDead ? 'fallen, for now' : 'waiting'}</span></li></ul>
    <button class="btn" type="button" id="btn-mapclose">Close map</button>`;
  $('btn-mapclose').onclick = () => toggleMap(false);
}
function drawWorldMap(canvasOnly = false) { // [campaign] canvasOnly: the live redraw leaves the side panel alone
  const cv = $('mapcanvas'), P = GAME.player;
  const ctx = cv.getContext('2d');
  const S = cv.width;
  if (INDOOR.on && UI.dunImg) { drawDungeonMapView(ctx, S, P); return; }
  ctx.drawImage(UI.mapImg, 0, 0, S, S);
  ctx.fillStyle = 'rgba(8,9,11,0.12)'; ctx.fillRect(0, 0, S, S);
  // roads already baked in; mark realm names
  ctx.textAlign = 'center';
  const kpx = S / Math.max(1, cv.clientWidth || S); // canvas pixels per screen pixel
  // [look4] every name is laid out before it is drawn, so none lies over another, a site's mark, the guide's gem or you
  // (look4MapLabels, 13w_look4.js): they were written each at its site, the realm's over its town's
  const fs = Math.max(S * 0.017, 10.5 * kpx), fsR = S * 0.04, fnt = `${fs}px "Alegreya Sans", sans-serif`, LB = [], MK = [];
  const label = (txt, x, y, col = '#efe6d3', r = 0, d = 0, pri = 3, spare = false) => LB.push({ t: txt, col, font: fnt, fs, pri, spare, at: look4SiteAt(x, y - d, r, d, fs) });
  for (const R of REALMS) LB.push({ t: R.name, col: R.light, shade: 'rgba(0,0,0,0.55)', big: true, font: `${fsR}px "IM Fell English SC", Georgia, serif`, fs: fsR, pri: 6, at: [440, 405, 470, 330, 290].map((a) => w2m(R.dx * a, R.dz * a, S)) });
  for (const K of WAR.keeps) { const [x, y] = w2m(K.site.x, K.site.z, S); drawSiteIcon(ctx, 'keep', x, y, S * 0.014, REALMS[K.realm].color, GAME.t < K.underSiegeUntil); MK.push([x, y, S * 0.016]); label(K.site.name, x, y + S * 0.034, '#efe6d3', S * 0.016, S * 0.034, 2); }
  for (const T of WAR.temples) { const [x, y] = w2m(T.site.x, T.site.z, S); drawSiteIcon(ctx, 'temple', x, y, S * 0.012, REALMS[T.realm].color); MK.push([x, y, S * 0.014]); label(T.site.name, x, y + S * 0.03, '#d9cfb8', S * 0.014, S * 0.03, 3); }
  for (const R of REALMS) { let [x, y] = w2m(R.musterSite.x, R.musterSite.z, S); drawSiteIcon(ctx, 'muster', x, y, S * 0.011, R.color); MK.push([x, y, S * 0.013]); label('Muster', x, y + S * 0.028, '#bdb39d', S * 0.013, S * 0.028, 5, true); [x, y] = w2m(R.town.x, R.town.z, S); drawSiteIcon(ctx, 'town', x, y, S * 0.012, '#e9dfc9'); MK.push([x, y, S * 0.014]); label(R.townName, x, y + S * 0.03, '#efe6d3', S * 0.014, S * 0.03, 1); }
  { const [x, y] = w2m(0, 0, S); ctx.fillStyle = '#e9dfc9'; ctx.beginPath(); ctx.arc(x, y, S * 0.006, 0, TAU); ctx.fill(); MK.push([x, y, S * 0.008]); LB.push({ t: 'The Lone Tree', col: '#efe6d3', font: fnt, fs, pri: 4, at: [[x, y - S * 0.014], [x, y + S * 0.008 + fs], [x + S * 0.012 + fs * 3.4, y + fs * 0.35]] }); }
  { const [x, y] = w2m(BARROW.x, BARROW.z, S); drawBarrowIcon(ctx, x, y, S * 0.011); MK.push([x, y, S * 0.013]); label('The Hollow Barrow', x, y + S * 0.03, '#a9e6e0', S * 0.013, S * 0.03, 3); }
  late2MapMarks(ctx, S, MK); // [late2] the risen camps past 40 (10l_late.js)
  look4MapLabels(ctx, S, LB, MK);
  ctx.font = fnt;
  for (const rel of WAR.relics) { const p = relicPosition(rel); const [x, y] = w2m(p.x, p.z, S); ctx.fillStyle = '#ffe28a'; ctx.strokeStyle = '#000'; ctx.beginPath(); ctx.arc(x, y, S * 0.008, 0, TAU); ctx.fill(); ctx.stroke(); }
  // allied warbands, and enemies close to anything of ours
  for (const wb of WAR.warbands) {
    const L = wbLeader(wb);
    if (!L) continue;
    const visible = wb.realm === P.faction || ENT.some((o) => o.alive && o.faction === P.faction && dist2(o.x, o.z, L.x, L.z) < 70 * 70);
    if (!visible) continue;
    const [x, y] = w2m(L.x, L.z, S);
    ctx.fillStyle = REALMS[wb.realm].color; ctx.strokeStyle = '#000'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(x, y, S * 0.0075, 0, TAU); ctx.fill(); ctx.stroke();
    if (wb.engaged) { ctx.strokeStyle = 'rgba(255,220,120,0.9)'; ctx.beginPath(); ctx.moveTo(x - 6, y - 6); ctx.lineTo(x + 6, y + 6); ctx.moveTo(x + 6, y - 6); ctx.lineTo(x - 6, y + 6); ctx.stroke(); }
  }
  drawFarmMap(ctx, (x, z) => w2m(x, z, S), S / WSIZE); // [farming] your beds and the town strips (08i_farm_draw.js)
  drawCampaignMap(ctx, S, P); // [campaign] routes, order badges and the claim (08g_campaign.js)
  const b = GAME.prog.bounty;
  if (b && !b.done) { const c = CAMPS[b.camp]; const [x, y] = w2m(c.x, c.z, S); ctx.strokeStyle = '#ffd36a'; ctx.lineWidth = 2.5; ctx.setLineDash([5, 4]); ctx.beginPath(); ctx.arc(x, y, S * 0.02, 0, TAU); ctx.stroke(); ctx.setLineDash([]); }
  guideMapMark(ctx, S); // [guide] your path's next step (10e_guide.js)
  netWorldMap(ctx, S); // [net] your party and the others (14o_netui.js)
  const [px, py] = w2m(P.x, P.z, S);
  ctx.save(); ctx.translate(px, py); ctx.rotate(-P.yaw + Math.PI);
  ctx.fillStyle = '#fff'; ctx.strokeStyle = '#000'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(0, -S * 0.016); ctx.lineTo(S * 0.011, S * 0.013); ctx.lineTo(0, S * 0.006); ctx.lineTo(-S * 0.011, S * 0.013); ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.restore();
  if (canvasOnly) return; // [campaign]
  // side panel
  const side = $('mapside');
  const keepRows = WAR.keeps.map((K) => `<li><b>${K.site.name}</b><span style="color:${REALMS[K.realm].color}">${REALMS[K.realm].name}${GAME.t < K.underSiegeUntil ? ' · under siege' : ''}</span></li>`).join('');
  const relicRows = WAR.relics.map((r) => {
    const where = r.state === 'temple' ? (r.at === r.realm ? 'safe at home' : `held by ${REALMS[r.at].name}`) : r.state === 'carried' ? `carried by ${REALMS[r.carrierRealm ?? 0].name}` : 'lying in the field';
    return `<li><b style="color:${REALMS[r.realm].light}">${REALMS[r.realm].hallowName}</b><span>${where}</span></li>`;
  }).join('');
  const news = WAR.news.slice(-6).reverse().map((n) => `<div>${esc(n.text)}</div>`).join('') || '<div>The frontier is quiet, for now.</div>';
  side.innerHTML = `${HALL.sit ? '' : `<h3>The Hallowmarch</h3>${farmMapSide()}`}<div id="cw-side-host"></div>
    <div class="legend"><span><i style="background:#ddd;clip-path:polygon(0 0,100% 0,100% 55%,50% 100%,0 55%)"></i>Keep (colour shows the holder)</span><span><i style="background:#ddd;clip-path:polygon(25% 0,75% 0,100% 50%,75% 100%,25% 100%,0 50%)"></i>Temple of a hallow</span><span><i style="background:#ddd;clip-path:polygon(50% 0,100% 100%,0 100%)"></i>Muster and portal</span><span><i style="background:#ffe28a;border-radius:50%"></i>A hallow</span></div>
    <ul>${keepRows}</ul><ul>${relicRows}</ul><div class="news">${news}</div>
    <button class="btn" type="button" id="btn-mapclose">${HALL.sit ? 'Leave throne' : 'Close map'}</button>`;
  cwRefreshSide(true); // [campaign] the campaign and the warbands (08g_campaign.js)
  $('btn-mapclose').onclick = () => toggleMap(false);
}
function bgClose(id, fn) {
  const ov = $(id);
  ov.addEventListener('pointerdown', (e) => { ov._bg = e.target === ov; });
  ov.addEventListener('click', (e) => { if (e.target === ov && ov._bg) fn(); ov._bg = false; });
}
function toggleMap(force) {
  if (typeof THRONE_RTS !== 'undefined' && THRONE_RTS.active && force !== false) closeThroneRTS(false);
  const ov = $('mapov');
  const open = force === undefined ? ov.hidden : force;
  if (!open && HALL.sit) hallLeave();
  ov.classList.toggle('throne-mode', !!HALL.sit);
  if (open && UI.modal && UI.modal !== 'map') return;
  ov.hidden = !open;
  UI.modal = open ? 'map' : null;
  if (open) drawWorldMap();
}
bgClose('mapov', () => toggleMap(false));

/* ------------------------------------------------------------------ */
/* nameplates & floating text                                          */
/* ------------------------------------------------------------------ */
function updateNameplates() {
  const P = GAME.player;
  const host = $('nameplates');
  const list = [];
  const camX = camera.position.x, camZ = camera.position.z;
  for (const e of ENT) {
    if (e === P || e.removed || e.role === 'critter' || e.flying) continue;
    if (e.kind === 'door') { if (!e.alive || e.hp >= e.maxHp * 0.999 && P.target !== e.id) continue; }
    else if (!e.alive && P.target !== e.id) continue;
    const d = dist(e.x, e.z, camX, camZ);
    if (IS_TOUCH && !mobileNameplateEligible(e, P)) continue;
    if (d > (P.target === e.id ? 70 : e.kind === 'dragon' ? 110 : e.l2risen ? 62 : 36)) continue; // [late4] a risen champion's name reads farther (10o_late4.js)
    if (e.tame && P.target !== e.id && (e.tame.owner !== 'player' || d > 16)) continue; // [animals] names over your own animals close by, not over every sheep (08h_animals.js)
    // under the barrow, names do not show through solid rock
    // [phones] and above ground, not through the walls of a house, a hall or a keep (npSeen, 10p_hud.js)
    if (P.target !== e.id && !npSeen(e, d)) continue;
    list.push([d, e]);
  }
  list.sort((a, b) => (b[1].id === P.target) - (a[1].id === P.target) || a[0] - b[0]); // [v13] the chosen one's name first: in a crowd it was cut with the farthest
  const max = IS_TOUCH ? (MOBILE_PREFS.names === 'all' ? 10 : 4) : 18;
  const mobileRects = [];
  let used = 0;
  for (const [d, e] of list) {
    if (used >= max) break;
    const h = e.kind === 'door' ? 6.2 : e.kind === 'dragon' ? 6.4 : (e.kind === 'humanoid' ? 2.05 + (e.mount ? 0.8 : 0) : e.kind === 'bear' ? 1.75 : e.kind === 'wisp' ? 0.7 : 1.2) * (e.scale || 1);
    const s = screenOf(e.x, e.y + h, e.z);
    if (!s || s.x < -50 || s.x > view.w + 50 || s.y < -20 || s.y > view.h + 20) continue;
    let el = UI.npPool[used];
    if (!el) { el = document.createElement('div'); el.className = 'np'; el.innerHTML = '<span class="n"></span><span class="hb"><i></i></span>'; host.appendChild(el); UI.npPool.push(el); el._n = el.firstChild; el._b = el.lastChild.firstChild; el._hb = el.lastChild; }
    el.style.display = '';
    el.style.transform = `translate(${s.x.toFixed(1)}px, ${s.y.toFixed(1)}px) translate(-50%, -100%)`;
    const txt = e.kind === 'door' ? e.name : `${e.name}`;
    if (el._txt !== txt) { el._n.textContent = txt; el._txt = txt; }
    el._eid = e.id; // (which body this name is over: two may share a name)
    el.style.setProperty('--nc', nameColor(e, P));
    if (el._l4 !== !!e.l2risen) { el._l4 = !!e.l2risen; el.classList.toggle('risen', el._l4); } // [late4] a risen champion's name in ember (page.html)
    campaignPlate(el, e); // [campaign] a band's order over its captain (08g_campaign.js)
    const sel = P.target === e.id;
    el.classList.toggle('sel', sel);
    const showBar = sel || (e.alive && e.hp < e.maxHp * 0.999) || (e.faction <= 2 && e.faction !== P.faction);
    el._hb.style.display = showBar ? '' : 'none';
    if (showBar) { el._b.style.width = (clamp(e.hp / e.maxHp, 0, 1) * 100).toFixed(1) + '%'; el.style.setProperty('--hc', e.faction === P.faction ? '#5fbf5f' : 'var(--hp)'); }
    el.style.opacity = clamp(1.4 - d / 40, 0.45, 1);
    if (IS_TOUCH) {
      // Measure once when this pooled plate's content changes. Selected targets
      // are sorted first; lower priority names are omitted when they collide.
      const measureKey = el.textContent + ':' + showBar + ':' + MOBILE_PREFS.text;
      if (el._mobileMeasure !== measureKey) {
        el._mobileMeasure = measureKey;
        const rect = el.getBoundingClientRect();
        el._mobileW = rect.width; el._mobileH = rect.height;
      }
      const r = { l: s.x - el._mobileW / 2, r: s.x + el._mobileW / 2, t: s.y - el._mobileH, b: s.y };
      if (!sel && (r.l < 8 || r.r > view.w - 8 || r.t < 8 || r.b > view.h - 8 ||
          mobileRects.some((a) => r.l < a.r + 6 && r.r > a.l - 6 && r.t < a.b + 4 && r.b > a.t - 4))) {
        el.style.display = 'none'; continue;
      }
      mobileRects.push(r);
    }
    used++;
  }
  for (let i = used; i < UI.npPool.length; i++) UI.npPool[i].style.display = 'none';
}
function uiFloatAt(x, y, z, text, cls = '') {
  const host = $('floaters');
  let el = UI.flPool.find((f) => !f._live);
  if (!el) { if (UI.flPool.length > 48) return; el = document.createElement('div'); host.appendChild(el); UI.flPool.push(el); }
  el._live = true;
  el.className = 'fl ' + cls;
  el.textContent = text;
  UI.floaters.push({ el, x: x + (Math.random() - 0.5) * 0.6, y, z: z + (Math.random() - 0.5) * 0.6, t: 0, vy: 1.6 });
}
function updateFloaters(dt) {
  for (let i = UI.floaters.length - 1; i >= 0; i--) {
    const f = UI.floaters[i];
    f.t += dt;
    f.y += f.vy * dt;
    f.vy *= 0.96;
    const s = screenOf(f.x, f.y, f.z);
    if (!s || f.t > 1.2) { f.el.style.opacity = 0; f.el._live = false; UI.floaters.splice(i, 1); continue; }
    f.el.style.transform = `translate(${s.x.toFixed(1)}px, ${s.y.toFixed(1)}px) translate(-50%, -50%) scale(${f.t < 0.12 ? 1 + (0.12 - f.t) * 4 : 1})`;
    f.el.style.opacity = clamp(1.4 - f.t * 1.2, 0, 1);
  }
}
function onDamageFeedback(src, dst, dmg, absorbed, opts) {
  const P = GAME.player;
  if (!P) return;
  const n = Math.round(dmg);
  // One actual hit, consumed by the synchronous death callback; never saved with the character.
  if (dst === P && Number.isFinite(dmg) && dmg > 0) UI.deathHit = { player: P, source: src, at: GAME.t, hp: P.hp, damage: dmg, kind: opts.elem || opts.kind, dot: !!opts.dot, crit: !!opts.crit };
  if (src === P && dst !== P) {
    uiFloatAt(dst.x, dst.y + (dst.kind === 'door' ? 4 : 2.1 * (dst.scale || 1)), dst.z, (opts.crit ? 'Crit ' : '') + (n > 0 ? n : 'Absorbed'), opts.crit ? 'crit' : '');
    if (!opts.dot) uiLog(`You hit ${dst.siegeEngine ? `the ${dst.name}` : dst.kind === 'door' ? 'the gate' : theName(dst)} for ${n} damage${opts.crit ? ' (critical)' : ''}.`, 'dmg'); // [siege] engines by name
  } else if (dst === P) {
    uiFloatAt(P.x, P.y + 2.0, P.z, n > 0 ? `-${n}` : 'Absorbed', 'hurt');
    if (!opts.dot) uiLog(`${src && src.name ? capFirst(theName(src)) : 'Something'} hits you for ${n} damage.`, 'hurt');
    flashScreen([0.55, 0.05, 0.03], Math.min(0.35, 0.08 + dmg / P.maxHp));
  }
}
// "the grey wolf", "The Hollow King", "Aldric": names read right in a sentence
function theName(e) {
  const n = e.name || '';
  if (/^the /i.test(n) || e.properName) return n;
  if (e.role === 'mob' || e.role === 'critter' || e.role === 'trap') return 'the ' + n;
  return n;
}
const capFirst = (s) => s.charAt(0).toUpperCase() + s.slice(1);
function onHealFeedback(src, dst, h, quiet) {
  const P = GAME.player;
  if (!P) return;
  if (dst === P || src === P) {
    uiFloatAt(dst.x, dst.y + 2.1, dst.z, `+${Math.round(h)}`, 'heal');
    if (!quiet) uiLog(src === P ? `You heal ${dst === P ? 'yourself' : dst.name} for ${Math.round(h)}.` : `${src.name} heals you for ${Math.round(h)}.`, 'heal');
  }
}

/* ------------------------------------------------------------------ */
/* messages                                                            */
/* ------------------------------------------------------------------ */
function uiLog(text, kind = 'sys', realm = null) {
  const log = $('log');
  if (!log) return;
  const d = document.createElement('div');
  d.className = kind;
  if (realm !== null && realm >= 0 && realm <= 2) d.style.setProperty('--rcol', REALMS[realm].light);
  d.textContent = text;
  log.appendChild(d);
  while (log.childNodes.length > 60) log.removeChild(log.firstChild);
}
function uiToast(text, kind = '') {
  const host = $('banners');
  const d = document.createElement('div');
  d.className = 'banner panel ' + (kind === 'level' ? 'level' : '');
  d.textContent = text;
  host.appendChild(d);
  try { HUDL.k = 0; } catch (e) { /* the HUD's layout pass is not up yet */ } // [guide] laid out this frame, never over a panel
  setTimeout(() => d.remove(), 6200);
  while (host.childNodes.length > 3) host.removeChild(host.firstChild);
}
function uiBanner(text, realm) {
  const host = $('banners');
  const d = document.createElement('div');
  d.className = 'banner panel';
  if (realm >= 0 && realm <= 2) d.style.setProperty('--rcol', REALMS[realm].color);
  d.textContent = text;
  host.appendChild(d);
  setTimeout(() => d.remove(), 6200);
  while (host.childNodes.length > 3) host.removeChild(host.firstChild);
}
function uiError(text) {
  const el = $('error');
  el.textContent = text;
  el.classList.add('on');
  UI.errorT = 1.6;
  sfx('error');
}
let zoneTimer = null;
function uiZone(z) {
  setT($('mmzone'), z.name);
  $('zt-name').textContent = z.name;
  $('zt-sub').textContent = z.dungeon ? 'The Hollow Barrow' : z.frontier ? (z.realm >= 0 ? `Frontier · ${REALMS[z.realm].name} march` : 'Frontier') : z.realm >= 0 ? REALMS[z.realm].name : '';
  const t = $('zonetoast');
  t.classList.add('on');
  clearTimeout(zoneTimer);
  zoneTimer = setTimeout(() => t.classList.remove('on'), 3200);
}
function flashScreen(rgb, a) {
  const f = composite.uniforms.uFlash.value;
  f.set(rgb[0], rgb[1], rgb[2], Math.max(f.w, a));
}
function showJoystick(x, y, dx, dy) {
  const j = $('joy');
  j.classList.add('on');
  j.style.left = x + 'px'; j.style.top = y + 'px';
  j.firstChild.style.transform = `translate(${dx}px, ${dy}px)`;
  $('joyhint').style.opacity = 0;
}
function hideJoystick() {
  $('joy').classList.remove('on');
  $('joyhint').style.opacity = '';
}

/* ------------------------------------------------------------------ */
/* menus                                                               */
/* ------------------------------------------------------------------ */
let menuReturnFocus = null;
function onEscape() {
  if (UI.modal === 'mobile') { mobileTray(false); return; }
  if (UI.modal === 'map') { toggleMap(false); return; }
  if (UI.modal === 'kit') { closeKit(); return; }
  if (UI.modal === 'dialog') { closeDialog(); return; }
  if (UI.modal === 'menu') { closeMenu(); return; }
  if (UI.modal === 'death') return;
  const P = GAME.player;
  if (P && P.casting) { P.casting = null; return; }
  if (P && P.target != null) { P.target = null; return; }
  openMenu('char');
}
function openMenu(tab = 'char') {
  if (UI.modal === 'net' && typeof netSheetToggle === 'function') netSheetToggle(false);
  if (UI.modal && UI.modal !== 'menu') return;
  const opening = UI.modal !== 'menu';
  if (opening) menuReturnFocus = document.activeElement;
  UI.modal = 'menu';
  $('menu').hidden = false;
  renderMenu(tab);
  if (opening) $('menu-tabs').querySelector('[aria-selected="true"]')?.focus({ preventScroll: true });
}
function openCompanion() {
  if (typeof netSheetToggle === 'function') netSheetToggle(false);
  openMenu('companion');
}
function openPlayerIdentity() {
  if (UI.modal === 'menu') closeMenu();
  if (typeof netUiOn === 'function') netUiOn();
  if (typeof netSheetToggle !== 'function') return;
  netSheetToggle(true);
  if ($('netsheet')?.hidden) return;
  const connect = $('netsheet-acct')?.querySelector('.native-player button');
  if (connect) { connect.scrollIntoView({ block: 'nearest' }); connect.focus({ preventScroll: true }); }
}
function closeMenu() {
  const wasOpen = !$('menu').hidden;
  $('menu').hidden = true; UI.modal = null; UI.confirmNew = false; $('btn-newchar').textContent = 'New character';
  if (!wasOpen) return;
  const available = el => el?.isConnected && !el.disabled && !el.closest('[hidden], [inert]') && el.getClientRects().length;
  const prior = menuReturnFocus; menuReturnFocus = null;
  const focus = available(prior) && prior !== document.body ? prior
    : [$('btn-menu'), $('mobile-menu-toggle')].find(available);
  focus?.focus({ preventScroll: true });
}
function renderMenu(tab) {
  UI.menuTab = tab;
  document.querySelectorAll('#menu-tabs button').forEach((b) => {
    const selected = b.dataset.tab === tab;
    b.setAttribute('aria-selected', String(selected)); b.tabIndex = selected ? 0 : -1;
    if (selected) $('menu-body').setAttribute('aria-labelledby', b.id);
  });
  const P = GAME.player, prog = GAME.prog;
  const body = $('menu-body');
  if (tab === 'companion') {
    body.innerHTML = '<div id="world-agent-mount"></div>';
    queueMicrotask(() => { if (UI.modal === 'menu' && UI.menuTab === 'companion' && typeof mainWorldAgentRender === 'function') mainWorldAgentRender(); });
  } else if (tab === 'progress') {
    body.innerHTML = '<div id="march-coach-mount"></div>';
    queueMicrotask(() => { if (UI.modal === 'menu' && UI.menuTab === 'progress' && typeof marchConsultingRender === 'function') marchConsultingRender(); });
  } else if (tab === 'char') {
    const rr = realmRank(prog.rp);
    const nextRR = REALM_RANKS[rr] ?? null;
    const mins = Math.floor(prog.played / 60);
    body.innerHTML = `<p>${esc(late2Named(P)) /* [late2] with the name it wears (10l_late.js) */}, ${CLASSES[P.cls].name} of ${REALMS[P.faction].name}. ${RANK_TITLES[rr - 1]}.</p>
      <div class="stats">
        <div class="stat"><small>Level</small><b>${prog.level}</b></div>
        <div class="stat"><small>Realm rank</small><b>${rr}</b></div>
        <div class="stat"><small>Realm points</small><b>${fmtInt(prog.rp)}</b></div>
        <div class="stat"><small>Creatures slain</small><b>${fmtInt(prog.kills)}</b></div>
        <div class="stat"><small>Foes slain</small><b>${fmtInt(prog.realmKills)}</b></div>
        <div class="stat"><small>Deaths</small><b>${fmtInt(prog.deaths)}</b></div>
        ${late2CharStats() /* [late2] names and veterancy (10l_late.js) */}
      </div>
      ${gsCharHTML() /* [gearstats] the stats in a fight and what they do (10g_gearstats.js) */}
      <p>${nextRR !== null ? `${fmtInt(nextRR - prog.rp)} realm points to rank ${rr + 1}.` : 'You hold the highest realm rank.'} Each rank adds 1.5% health and damage. Each foreign hallow your realm holds adds 10% damage for everyone in it.</p>
      <p>Played for ${mins} minute${mins === 1 ? '' : 's'}.</p>
      <div class="acts"><button type="button" class="btn" data-lore="sec:coach">Your progress &amp; coach</button><button type="button" class="btn" data-lore="sec:path">Your path &amp; next steps</button></div>`;
    gsCharWire(body); // [gearstats] the kit and the Gear page a tap away
  } else if (tab === 'settings') {
    const q = quality.level, m = tod.mode;
    body.innerHTML = `<div class="setrow"><span>Graphics</span><div class="seg" id="set-q">${['low', 'medium', 'high'].map((k) => `<button type="button" data-v="${k}" aria-checked="${q === k}">${QUALITY_PRESETS[k].label}</button>`).join('')}</div></div>
      <div class="setrow"><span>Time of day</span><div class="seg" id="set-t">${[['cycle', 'Cycle'], ['morning', 'Morning'], ['golden', 'Golden'], ['night', 'Night']].map(([k, l]) => `<button type="button" data-v="${k}" aria-checked="${m === k}">${l}</button>`).join('')}</div></div>
      <div class="setrow"><span>Weather</span><div class="seg" id="set-w">${[['auto', 'Changing'], ['clear', 'Always clear']].map(([k, l]) => `<button type="button" data-v="${k}" aria-checked="${WEATHER.mode === k}">${l}</button>`).join('')}</div></div>
      ${soundSettingsHTML() /* [audio2] Volume, Effects, Ambience (11c_sound.js) */}
      <div class="setrow"><span>Music</span><div class="seg" id="set-m">${MUSIC_LEVELS.map(([k, l]) => `<button type="button" data-v="${k}" aria-checked="${musicLevelKey() === k}">${l}</button>`).join('')}</div></div>
      ${captureSettingsHTML() /* [capture] the capture build (14_capture.js) */}
      <p>${IS_TOUCH ? 'Lower graphics settings help on older phones.' : 'If the frame rate drops, the game lowers its own detail first.'}</p>`;
    $('set-q').onclick = (e) => { const b = e.target.closest('button'); if (!b) return; setQuality(b.dataset.v); renderMenu('settings'); saveSoon(); };
    $('set-t').onclick = (e) => { const b = e.target.closest('button'); if (!b) return; setTimeMode(b.dataset.v); renderMenu('settings'); saveSoon(); };
    $('set-w').onclick = (e) => { const b = e.target.closest('button'); if (!b) return; setWeatherMode(b.dataset.v); renderMenu('settings'); saveSoon(); };
    captureSettingsWire(); // [capture] (14_capture.js)
    soundSettingsWire(); // [audio2] the Volume, Effects and Ambience rows (11c_sound.js)
    $('set-m').onclick = (e) => { const b = e.target.closest('button'); if (!b) return; const L = MUSIC_LEVELS.find((x) => x[0] === b.dataset.v); if (L) setMusicVolume(L[2]); renderMenu('settings'); saveSoon(); }; // [music] the score's volume (11b_music.js)
  } else if (tab === 'chronicle') {
    renderChronicle(body);
  } else {
    body.innerHTML = guideHelpHTML(); // [guide] the keys and every system's own lines, in the order a player meets them (10e_guide.js GUIDE_HELP)
  }
}
$('menu-tabs').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) renderMenu(b.dataset.tab); });
$('menu-tabs').addEventListener('keydown', (e) => {
  if (e.altKey || e.ctrlKey || e.metaKey || e.isComposing || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
  const tabs = [...$('menu-tabs').querySelectorAll('[role="tab"]')], index = tabs.indexOf(e.target.closest('[role="tab"]'));
  if (index < 0 || !tabs.length) return;
  const next = e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1
    : (index + (e.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
  e.preventDefault(); e.stopPropagation(); renderMenu(tabs[next].dataset.tab); tabs[next].focus({ preventScroll: true });
});
$('menu').addEventListener('keydown', (e) => {
  if (UI.modal !== 'menu' || e.key !== 'Tab') return;
  const focusable = [...$('menu').querySelectorAll('button, input, select, textarea, summary, a[href], [tabindex]')]
    .filter(el => !el.disabled && el.tabIndex >= 0 && !el.closest('[hidden], [inert]') && el.getClientRects().length);
  const first = focusable[0], last = focusable.at(-1);
  if (!first) return;
  if (!$('menu').contains(document.activeElement)) { e.preventDefault(); (e.shiftKey ? last : first).focus(); }
  else if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
});
$('btn-resume').onclick = () => closeMenu();
$('menu-close').onclick = () => closeMenu();
$('btn-newchar').onclick = () => {
  if (!UI.confirmNew) { UI.confirmNew = true; $('btn-newchar').textContent = 'Press again to start over'; return; }
  closeMenu();
  newCharacter();
};
bgClose('menu', () => closeMenu());

function uiDeathDamage(killer) {
  const hit = UI.deathHit, P = GAME.player;
  UI.deathHit = null;
  if (!hit || hit.player !== P || hit.source !== killer || hit.at !== GAME.t || !(hit.hp <= 0) || !(P.hp <= 0)) return '';
  const kind = { melee: 'melee', arrow: 'arrow', fire: 'fire', ember: 'fire', frost: 'frost', ice: 'frost', rime: 'frost', holy: 'holy', arcane: 'arcane', shock: 'lightning', spark: 'lightning', aoe: 'area', slam: 'impact', crush: 'crushing' }[hit.kind];
  return ` Final hit: ${Math.round(hit.damage)} ${typeof kind === 'string' ? kind + ' ' : ''}damage${hit.dot ? ' over time' : ''}${hit.crit ? ' (critical)' : ''}.`;
}
function uiDeath(by, killer = null) {
  // Players and chat can be open while the world continues. Their dynamically
  // appended overlays must not cover the recovery choice or retain its focus.
  if (typeof netSheetToggle === 'function') netSheetToggle(false);
  if (typeof netChatClose === 'function') netChatClose();
  UI.modal = 'death';
  $('death').hidden = false;
  $('death-by').textContent = `Slain by ${by}.` + uiDeathDamage(killer);
  const P = GAME.player;
  const inFrontier = Math.hypot(P.x, P.z) < R_RING;
  $('btn-release').textContent = inDungeon(P) ? 'Release to the barrow mouth' : buildBedSpot(inFrontier) ? 'Release to your bed' : `Release to ${inFrontier ? REALMS[P.faction].name + ' Muster' : REALMS[P.faction].townName}`; // [building]
  $('btn-release').focus({ preventScroll: true });
}
$('btn-release').onclick = () => { $('death').hidden = true; UI.modal = null; releasePlayer(); };

/* herald */
function openHerald() {
  const P = GAME.player, prog = GAME.prog, R = REALMS[P.faction];
  UI.modal = 'dialog';
  $('dialog').hidden = false;
  $('dlg-title').textContent = `${R.name} Herald`;
  const b = prog.bounty;
  const frontierTip = `The stones in the square lead to the frontier muster. Check your opponents' levels, travel with allies and retreat from a stronger force.`;
  let body = `<p>Well met, ${P.name}. ${frontierTip}</p>`;
  const acts = [];
  const l2b = b ? null : late2HeraldBounty(); // [late2] past 40, a risen champion's bounty (10l_late.js)
  if (b && b.done) {
    body += `<p>You have done what was asked. Take this for your trouble.</p>`;
    acts.push(['Claim reward', () => { addXP(b.reward); addRP(Math.round(b.reward * 0.1)); addGold(10 + prog.level * 5); uiLog(`The herald pays you ${10 + prog.level * 5} gold.`, 'loot'); activityRecord('bounty.claimed', b.type || 'bounty', 1, { success: true }); prog.bounty = null; sfx('fanfare'); closeDialog(); saveSoon(); }]);
  } else if (b) {
    const c = CAMPS[b.camp];
    body += b.risen ? `<p>Your bounty: bring down ${esc(b.name)} in the far borderlands, circled on your map.</p>` /* [late2] */ : `<p>Your bounty: slay ${b.need} ${pluralName(b.name)} near the marked place on your map. ${b.have} done so far.</p>`;
    acts.push(['Abandon bounty', () => { prog.bounty = null; closeDialog(); }]);
  } else if (l2b) { // [late2]
    body += l2b.text;
    acts.push(['Accept bounty', l2b.accept]);
  } else if (prog.level < LEVEL_CAP) {
    const nb = chooseBounty();
    body += `<p>The ${pluralName(nb.name)} are troubling travellers. Slay ${nb.need} of them and I will see you rewarded with ${fmtInt(nb.reward)} experience and ${10 + prog.level * 5} gold. Their haunt is marked on your map.</p>`;
    acts.push(['Accept bounty', () => { prog.bounty = nb; closeDialog(); uiToast(`Bounty accepted: slay ${nb.need} ${pluralName(nb.name)}`, 'quest'); saveSoon(); }]); // [guide] pluralName: wolves, not wolfs (10e_guide.js)
  }
  if (prog.level >= 14) body += campaignHeraldText(); // [campaign] campaigns and commanding (08g_campaign.js)
  body += late3HeraldText(); // [late3] the way beneath the Hollow King's hall (10m_deep.js)
  if (typeof wxHeraldText === 'function') body += wxHeraldText(); // [weather2] the sky over the March (12c_weather2.js)
  if (GAME.player) body += `<p>${esc(seasonWarText(GAME.player.faction))}</p>`; // [loops] the season: its clock, the standing, an offensive coming (08n_season.js)
  acts.push(['Farewell', closeDialog]);
  $('dlg-body').innerHTML = body;
  const box = $('dlg-actions');
  box.innerHTML = '';
  acts.forEach(([l, fn], i) => { const btn = document.createElement('button'); btn.type = 'button'; btn.className = 'btn' + (i === 0 && acts.length > 1 ? ' primary' : ''); btn.textContent = l; btn.onclick = fn; box.appendChild(btn); });
}
function closeDialog() { $('dialog').hidden = true; UI.modal = null; }
bgClose('dialog', () => closeDialog());

