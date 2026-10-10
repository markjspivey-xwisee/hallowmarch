/* ================================================================== */
/* the callings on screen: the class panel over the ability bar         */
/* (stance and momentum, the draw and the quiver, attunement and the    */
/* combo cue, devotion), the technique and hold buttons on the phone    */
/* pad, the keys (T technique, X hold, Y arrows), the Chronicle's page  */
/* on the callings and the help lines. Styles: page.html, "classes"   */
/* ================================================================== */
Object.assign(BUFF_ICON, {
  chill: ['snow', '#9cc8ff'], frozen: ['snow2', '#cfe6ff'], bleed: ['heart', '#e0524a'], sunder: ['shield', '#d9a066'], stagger: ['burst', '#f0d080'],
  blind: ['rain', '#d8dde4'], tracked: ['target', '#ff8a6a'], bless: ['sun', '#ffe08a'], eward: ['ward', '#c6b0ff'], hallowed: ['circle', '#ffe8a8'],
});
const CLS_UI = { key: '', cue: null, cueT: 0, el: null };
const ELEM_ICON = { fire: 'flame', frost: 'snow', storm: 'bolt' };
const ELEM_NAME = { fire: 'Fire', frost: 'Frost', storm: 'Storm' };

// a short-lived word over the class panel: a parry, a finisher ready, a combo, a change of stance
function classCue(kind) {
  const P = GAME.player;
  if (!P) return;
  const [k, arg] = kind.split(':');
  const text = {
    parry: 'Parried!', finisher: 'Finisher ready: press 1', stance: `${STANCES[csOf(P).stance].name} stance`,
    focus: `Focus: ${ELEM_NAME[csOf(P).focus]}`, hidden: 'Hidden', combo: { steam: 'Steam!', shatter: 'Shatter!', overload: 'Overload!', quench: 'Quenched' }[arg],
    attuned: `Attuned to ${(arg || '').toLowerCase()}`,
  }[k];
  if (!text) return;
  CLS_UI.cue = { text, k, t: GAME.t };
}

/* ---- the panel and the phone buttons, rebuilt with the hotbar ---- */
function classHotbar() {
  const P = GAME.player;
  if (!P || !P.cls) return;
  let el = $('cls');
  if (!el) { el = document.createElement('div'); el.id = 'cls'; el.className = 'panel'; el.addEventListener('click', classPanelClick); }
  // over the ability bar on a desktop; on a phone under the frames at the top left, clear of the pad and the stick
  if (IS_TOUCH) { if (el.parentNode !== $('hud')) $('hud').appendChild(el); }
  else if (el.parentNode !== $('bottom')) $('bottom').insertBefore(el, $('hotbar'));
  CLS_UI.key = '';
  CLS_UI.el = el;
  // the phone pad: the technique (T) and the held action (X)
  const tp = $('tpad');
  for (const b of tp.querySelectorAll('.cls-btn')) b.remove();
  const L = classLabels(P);
  tp.insertAdjacentHTML('afterbegin', `<button class="cls-btn tech" type="button" aria-label="${L.tech}">${iconSvg(L.techIcon, 24)}<span>${L.tech}</span></button><button class="cls-btn hold" type="button" aria-label="${L.hold}">${iconSvg(L.holdIcon, 24)}<span>${L.hold}</span></button>`);
  const tech = tp.querySelector('.cls-btn.tech'), hold = tp.querySelector('.cls-btn.hold');
  tech.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); classTechniqueUI(); });
  hold.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); try { hold.setPointerCapture(e.pointerId); } catch (err) { /* synthetic */ } classHold(true, 'touch'); hold.classList.add('on'); });
  const up = (e) => { e.preventDefault(); if (CLS.holdSrc === 'touch') classHold(false); hold.classList.remove('on'); };
  hold.addEventListener('pointerup', up); hold.addEventListener('pointercancel', up);
  UI.slots = (UI.slots || []).filter((s) => !s.classList.contains('cls-btn'));
}
function classLabels(P) {
  const cs = csOf(P);
  if (P.cls === 'warrior') return { tech: 'Stance', techIcon: STANCES[cs.stance].icon, hold: 'Block', holdIcon: 'shield' };
  if (P.cls === 'archer') return { tech: 'Snare', techIcon: 'snare', hold: 'Draw', holdIcon: 'bow' };
  if (P.cls === 'mage') return { tech: 'Focus', techIcon: ELEM_ICON[cs.focus], hold: 'Read', holdIcon: 'eye' };
  return { tech: 'Holy', techIcon: 'circle', hold: 'Pray', holdIcon: 'pray' };
}
function classTechniqueUI() {
  const P = GAME.player;
  if (!P || UI.modal) return;
  const r = classTechnique(P);
  const lock = CLASS_UNLOCK[P.cls];
  const msg = {
    locked: P.cls === 'warrior' ? `Stances come at level ${lock.stances}` : P.cls === 'archer' ? `Snares come at level ${lock.snare}` : P.cls === 'mage' ? `Your focus can turn at level ${lock.focus}` : `Holy ground comes at level ${lock.consecrate}`,
    devotion: 'Not enough devotion (35)', cooldown: 'Not ready yet', power: 'Not enough power', stunned: 'You are stunned', busy: 'You are already casting', carrying: 'Your hands are full with the hallow', level: 'Not yet learned',
  }[r];
  if (msg) uiError(msg);
  if (r === true) CLS_UI.key = ''; // the panel shows the new stance or focus
}
function classPanelClick(e) {
  const b = e.target.closest('[data-cls]');
  if (!b) return;
  e.preventDefault();
  const P = GAME.player;
  if (b.dataset.cls === 'quiver') cycleArrow(P);
  else if (b.dataset.cls === 'stance') { if (clsHas(P, 'stances')) setStance(P, +b.dataset.v); else classTechniqueUI(); }
  else if (b.dataset.cls === 'focus') { if (clsHas(P, 'focus') && (b.dataset.v !== 'storm' || clsHas(P, 'storm'))) setFocus(P, b.dataset.v); else classTechniqueUI(); }
  else if (b.dataset.cls === 'tech') classTechniqueUI();
  CLS_UI.key = '';
}
// the panel's markup, for the calling and what it has unlocked so far
function classPanelHTML(P) {
  const cs = csOf(P), kb = IS_TOUCH ? '' : (k) => `<kbd>${k}</kbd>`;
  const key = (k) => (kb ? kb(k) : '');
  if (P.cls === 'warrior') {
    const st = clsHas(P, 'stances') ? `<span class="cls-stances">${STANCES.map((S, i) => `<button type="button" data-cls="stance" data-v="${i}" class="${i === cs.stance ? 'on' : ''}" title="${S.name}: ${S.text}">${iconSvg(S.icon, 15)}</button>`).join('')}${key('T')}</span>` : '';
    const mom = clsHas(P, 'momentum') ? `<span class="cls-mom" title="Momentum: blows build it; at 3 or more, Slash becomes a finisher">${Array.from({ length: MOM_MAX }, (_, i) => `<i data-i="${i}"></i>`).join('')}</span>` : '';
    return `<div class="cls-row">${st}${mom}<span class="cls-guard" title="Hold X to raise your shield; raise it just as a blow comes to parry">${iconSvg('shield', 16)}${key('X')}</span></div>`;
  }
  if (P.cls === 'archer') {
    const q = clsHas(P, 'arrows') ? `<button type="button" class="cls-quiver" data-cls="quiver" title="Choose your arrows (Y)"><i class="sw"></i><span class="nm"></span><span class="ct"></span>${key('Y')}</button>` : '';
    const hide = clsHas(P, 'hide') ? `<span class="cls-hide" title="Hidden in long grass or among trees: your first shot from cover strikes harder">${iconSvg('eye', 16)}</span>` : '';
    const sn = clsHas(P, 'snare') ? `<span class="cls-snares" title="Snares laid (T)">${iconSvg('snare', 16)}<b></b>${key('T')}</span>` : '';
    return `<div class="cls-row"><span class="cls-draw" title="Hold X to draw; let go to loose"><i></i><em></em>${key('X')}</span>${q}${hide}${sn}</div>`;
  }
  if (P.cls === 'mage') {
    const list = clsHas(P, 'storm') ? ELEMENTS : ['fire', 'frost'];
    return `<div class="cls-row">${list.map((el) => `<button type="button" class="cls-el ${el}" data-cls="focus" data-v="${el}" title="${ELEM_NAME[el]}: attunement (casting it charges it and strengthens the next spells of it)">${iconSvg(ELEM_ICON[el], 15)}<i><b></b></i></button>`).join('')}${clsHas(P, 'focus') ? key('T') : ''}<span class="cls-oc" title="Overcast: power is spent and does not return for a moment">${iconSvg('heart', 15)}</span></div>`;
  }
  return `<div class="cls-row"><span class="cls-dev" title="Devotion: healing, prayer and holy acts build it"><i></i><em></em></span><span class="cls-sanc" title="Sanctified: near your temple or a hallow your realm holds">${iconSvg('sun', 16)}</span>${clsHas(P, 'consecrate') ? `<button type="button" class="cls-holy" data-cls="tech" title="Holy ground: 35 devotion (T)">${iconSvg('circle', 15)}${key('T')}</button>` : ''}<span class="cls-pray" title="Hold X to pray">${iconSvg('pray', 16)}${key('X')}</span></div>`;
}

/* ---- every frame ---- */
function classHUD(dt) {
  const P = GAME.player, el = CLS_UI.el || $('cls');
  if (!P || !P.cls || !el) return;
  const cs = csOf(P);
  // rebuild when the calling's unlocks, stance or focus change
  const k = `${P.cls}|${P.level}|${cs.stance}|${cs.focus}|${IS_TOUCH}`;
  if (k !== CLS_UI.key) {
    CLS_UI.key = k;
    el.innerHTML = classPanelHTML(P) + '<div class="cls-cue"></div>';
    const L = classLabels(P), tb = document.querySelector('#tpad .cls-btn.tech');
    if (tb) tb.innerHTML = `${iconSvg(L.techIcon, 24)}<span>${L.tech}</span>`;
  }
  const t = getEnt(P.target);
  const foe = t && t.alive && isEnemy(P, t) ? t : null;
  if (P.cls !== 'archer' && document.body.classList.contains('cls-hidden')) document.body.classList.remove('cls-hidden');
  if (P.cls === 'warrior') {
    const m = momOf(P);
    el.querySelectorAll('.cls-mom i').forEach((i, n) => { i.classList.toggle('on', m >= n + 1); i.classList.toggle('part', m > n && m < n + 1); });
    const g = el.querySelector('.cls-guard');
    if (g) { g.classList.toggle('on', cs.blockOn); g.classList.toggle('parry', cs.blockOn && GAME.t - cs.blockAt <= parryWindow(P)); g.classList.toggle('low', P.endurance < 25); }
    const fin = clsHas(P, 'momentum') && m >= FIN_MIN;
    for (const s of UI.slots || []) if (+s.dataset.slot === 0) s.classList.toggle('fin', fin);
  } else if (P.cls === 'archer') {
    const d = el.querySelector('.cls-draw');
    if (d) { const kk = drawK(P); setW(d.querySelector('i'), kk); d.classList.toggle('on', cs.drawFrom >= 0); d.classList.toggle('full', kk >= 0.98); setT(d.querySelector('em'), cs.drawFrom >= 0 ? (kk >= 0.98 ? 'Full draw' : `${Math.round(kk * 100)}%`) : 'Draw'); }
    const q = el.querySelector('.cls-quiver');
    if (q) { const D = ARROW_DEF[cs.arrow]; q.style.setProperty('--ac', D.col); setT(q.querySelector('.nm'), D.short); setT(q.querySelector('.ct'), D.good ? String(goodsCount(D.good)) : '∞'); }
    const h = el.querySelector('.cls-hide');
    if (h) { h.classList.toggle('on', cs.hidden); h.classList.toggle('near', !cs.hidden && cs.cover >= 0.55); }
    const sn = el.querySelector('.cls-snares b');
    if (sn) setT(sn, String(CLS.snares.filter((s) => s.owner === P.id && !s.sprung).length));
    document.body.classList.toggle('cls-hidden', cs.hidden);
  } else if (P.cls === 'mage') {
    for (const e2 of ELEMENTS) {
      const b = el.querySelector(`.cls-el.${e2}`);
      if (!b) continue;
      const a = attOf(P, e2);
      setW(b.querySelector('b'), a / 100);
      b.classList.toggle('focus', clsHas(P, 'focus') ? cs.focus === e2 : e2 === 'fire');
      b.classList.toggle('hot', a >= 60);
    }
    const oc = el.querySelector('.cls-oc');
    if (oc) oc.classList.toggle('on', cs.spentUntil > GAME.t);
    // the combo cue: which of your spells the target's state answers to
    const react = foe ? (frozenOf(foe) ? ['storm', 'fire'] : burningOf(foe) ? ['storm', 'frost'] : chillOf(foe) > 0 ? ['fire', 'frost'] : wetOf(foe) > 0.3 ? ['storm'] : []) : [];
    const focus = clsHas(P, 'focus') ? cs.focus : 'fire';
    const abil = CLASSES.mage.abilities;
    for (const s of UI.slots || []) {
      const id = abil[+s.dataset.slot], e3 = id === 'nova' || id === 'ward' || id === 'blink' ? focus : ELEM_OF[id];
      s.classList.toggle('combo', !!e3 && react.includes(e3) && ABILITIES[id].level <= P.level && id !== 'ward');
    }
  } else {
    const d = el.querySelector('.cls-dev');
    const dv = devOf(P);
    if (d) { setW(d.querySelector('i'), dv / 100); setT(d.querySelector('em'), `Devotion ${Math.floor(dv)}`); d.classList.toggle('full', dv >= 70 && clsHas(P, 'raise')); }
    const s = el.querySelector('.cls-sanc'); if (s) s.classList.toggle('on', sanctified(P));
    const h = el.querySelector('.cls-holy'); if (h) h.classList.toggle('ready', dv >= 35);
    const pr = el.querySelector('.cls-pray'); if (pr) pr.classList.toggle('on', !!cs.praying);
  }
  classDrHud(el, P); // [balance] how much a stun, a root or a slow still takes hold of you (07c_balance.js)
  // the cue line: a passing word, or what the target's state means
  const cue = el.querySelector('.cls-cue');
  if (cue) {
    let text = '', cls = '';
    if (CLS_UI.cue && GAME.t - CLS_UI.cue.t < 1.6) { text = CLS_UI.cue.text; cls = 'flash ' + CLS_UI.cue.k; }
    else if (P.cls === 'mage' && foe) { text = comboHint(P, foe); cls = 'hint'; }
    else if (P.cls === 'warrior' && foe && frozenOf(foe)) { text = 'Frozen: a heavy blow shatters it'; cls = 'hint'; }
    if (cue._t !== text) { cue.textContent = text; cue._t = text; }
    if (cue._c !== cls) { cue.className = 'cls-cue ' + cls; cue._c = cls; }
  }
  const tb = document.querySelector('#tpad .cls-btn.hold');
  if (tb) tb.classList.toggle('on', CLS.hold);
}

/* ---- keys: T the technique, X held for the shield, the draw or prayer, Y the arrows ---- */
window.addEventListener('keydown', (e) => {
  if (!GAME.started || UI.modal) return;
  const a = document.activeElement;
  if (a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA')) return;
  if (e.code === 'KeyX' && !e.repeat) classHold(true, 'key');
  else if (e.code === 'KeyT' && !e.repeat) classTechniqueUI();
  else if (e.code === 'KeyY' && !e.repeat) cycleArrow(GAME.player);
});
window.addEventListener('keyup', (e) => { if (e.code === 'KeyX' && CLS.holdSrc === 'key') classHold(false); });
window.addEventListener('blur', () => { if (CLS.hold) classHold(false); });

/* ---- the help screen's lines for the callings ---- */
function classHelpKeys() {
  return IS_TOUCH
    ? `<kbd>Stance · Snare · Focus · Holy</kbd><span>Your calling's technique, on the round button over your abilities: a warrior's stance, an archer's snare, a mage's focus, a priest's holy ground (or raising the fallen).</span>
      <kbd>Block · Draw · Pray</kbd><span>Hold the second round button: raise your shield (just as a blow comes, to parry), draw your bow (let go to loose), or kneel to pray. A mage holds it to read the target.</span>`
    : `<kbd>T</kbd><span>Your calling's technique: change stance (warrior), lay a snare (archer), turn your focus (mage), hallow the ground or raise the fallen (priest).</span>
      <kbd>X (hold)</kbd><span>Raise your shield, and parry if you raise it just as a blow comes (warrior); draw your bow and let go to loose (archer); kneel and pray (priest).</span>
      <kbd>Y</kbd><span>Choose your arrows: plain, broadhead, bodkin, fire or blunt (archer).</span>`;
}

/* ---- the Chronicle's page on the callings (10c_lore.js lists it) ---- */
function chronClasses() {
  const P = GAME.player, mine = P ? P.cls : null, lv = GAME.prog ? GAME.prog.level : 1, realm = P ? P.faction : 0;
  const R = REALMS[realm];
  const at = (cls, k) => { const L = CLASS_UNLOCK[cls][k]; return mine === cls ? (lv >= L ? '<span class="now">yours</span>' : `<span class="now">at level ${L}</span>`) : `<span class="now">level ${L}</span>`; };
  const card = (cls, title, intro, rows) => `<div class="card${mine === cls ? ' mine' : ''}"><div class="rhead"><span class="em">${iconSvg(CLASSES[cls].icon, 24)}</span><b>${title}</b>${mine === cls ? '<small>Your calling</small>' : ''}</div><p>${intro}</p><dl class="facts">${rows.map(([dt, k, dd]) => `<dt>${dt}</dt><dd>${dd} ${k ? at(cls, k) : ''}</dd>`).join('')}</dl><p class="now"><b>${R.name}:</b> ${CLASS_REALM[cls][realm].name}. ${CLASS_REALM[cls][realm].text} ${at(cls, 'realm')}</p></div>`;
  return `<p class="lead">Every soldier of the March fights with eight abilities on keys 1 to 8, and every calling has a craft beneath them. A recruit can win a fight with the abilities alone; a veteran wins it with the craft. It opens up level by level, and each realm teaches it in its own way.</p>
    <p>Two keys serve every calling: <b>T</b>, the calling's technique, and <b>X</b>, held, the calling's held action. On a phone they are the two round buttons over your abilities. What they do, and what you are building, shows in the panel over your ability bar.</p>
    <p>Power: past level 20 yours grows with what you wear (the power on your gear), not with your level, and every ability costs the same at every level, so a long fight drains it at 50 as it does at 20. Spend it where it counts. A blow that lands while you cast sets the spell back a moment (twice at most), so a caster pressed by blades or beasts casts slower.</p><!-- [balance2] -->
    <p>Stuns (a freeze is one), roots and slows wear off on the seasoned: a second of the same kind within 15 s lasts half as long, a third a quarter, and then you shake it off entirely for 6 s. The panel over your ability bar shows how much the next one would take. Champions learn the same, and a foe stunned by your parries cannot be held stunned for ever.</p>
    ${card('warrior', 'The warrior', 'A warrior builds <b>momentum</b> with every blow that lands and spends it in a <b>finisher</b>. The shield takes what the blade cannot: raised, it turns most of a blow from the front; raised at the very moment a blow arrives, it <b>parries</b>, and the attacker reels.', [
      ['Shield', 'block', 'Hold X to raise it: 70% less harm from the front, 40% less from spells (not from holy light), at a cost in endurance. A broken guard staggers you. Even lowered, a shield on the arm turns about one blow in eight. Raised as an arrow or a bolt comes at you, it takes most of that too.'], // [balance] [balance2]
      ['Parry', 'block', 'Raise the shield just as a blow lands (a foe\'s weapon glints as its blow comes): no harm, the attacker is stunned and takes 20% more harm for 3 s, and you gain 2 momentum.'],
      ['Momentum', 'momentum', 'Each blow that lands builds it, up to 5. At 3 or more, Slash becomes a finisher: 160% and 50% more for each point.'],
      ['Weapon', '', 'The sword opens bleeding wounds, the axe breaks armour (each blow makes the foe take 6% more harm, up to three times), the mace breaks spells and staggers. A finisher drives the weapon\'s bite home.'],
      ['Stances', 'stances', 'T changes stance. Guarded: 25% less harm taken, 10% less dealt, a wider shield. Balanced: steady. Fury: 20% more harm dealt, 15% more taken, faster blows. Each changes what Bash, Bulwark, Cleave, Whirlwind and Rallying Cry do.'],
    ])}
    ${card('archer', 'The archer', 'An archer\'s strength is the <b>draw</b>. A snap shot is quick and wild; a full draw flies true and hard, and every arrow loosed from the string falls in a real arc and drifts on the wind.', [
      ['The draw', 'draw', 'Hold X to draw, let go to loose. Full draw takes 1.2 s: 160% harm and a better chance to strike deep. Hold too long and your arms tire. With no foe targeted you shoot where you look.'],
      ['Arrows', 'arrows', 'Plain arrows never run out. Broadhead, bodkin, fire and blunt arrows are kept in your packs (Y to choose); a broadhead\'s wound bleeds and mends slowly, the answer to a healer. Your abilities and drawn shots use the chosen kind. Arrows that miss can be picked up again.'],
      ['Hiding', 'hide', 'Keep still in long grass or among trees, out of the fight for three seconds, and you are hidden: foes see you only close by, and your first shot strikes 50% harder.'],
      ['Light feet', '', 'An archer moves a little quicker than anyone in armour and slips one blade in seven. Crippling Arrow, Volley (it pins what it falls on), snares and Tumble keep a pack at bow\'s length.'], // [balance]
      ['Snares', 'snare', 'T lays a snare at your feet: the first foe to step on it is held fast for 3.5 s, and the cord whips the legs of any foe beside it. Two at a time.'],
      ['Tracking', 'track', 'Crippling Arrow and full-draw hits mark the quarry for 30 s: you strike it 10% harder.'],
    ])}
    ${card('mage', 'The mage', 'A mage works with <b>fire</b>, <b>frost</b> and <b>storm</b>, and with what each does to the world and to the others. Frost chills and then freezes; fire burns; storm leaps from body to body. The art is in the order.', [
      ['Attunement', 'attune', 'Each spell charges its element (the three gauges) and strengthens the next spells of it by up to 18%; the others fade.'], // [balance2] the text said 30%, the spells gave 22%
      ['Combos', '', 'Storm <b>shatters</b> a frozen foe (a heavy blow of any kind does too). Fire bursts the chilled and frozen into <b>steam</b> that blinds and soaks. Storm <b>overloads</b> the burning in an explosion. Frost <b>quenches</b> fire. Turning from a well-charged element makes the combo stronger.'],
      ['The world', '', 'Frost freezes water into ice you can walk on, and puts out fires. Fire is damped by rain and wet foes. Storm arcs further and harder through the wet, and a thunderstorm feeds it.'],
      ['Focus', 'focus', 'T turns your focus. Your own bolt, Nova, Ward and Blink take its element: a frost nova roots and freezes, a storm nova throws foes back, a ward bites back, a blink leaves fire, frost or lightning behind.'],
      ['Overcasting', 'overcast', 'Out of power, you can still cast: the spell takes its due in health, and no power returns for a moment.'],
      ['Ward', '', 'While your Arcane Ward holds, a stun that strikes you breaks on it instead, and the ward loses half its strength: raise it before a warrior leaps in. A freeze still holds.'], // [balance2]
    ])}
    ${card('priest', 'The priest', 'A priest gathers <b>devotion</b> by healing, by prayer and by holy acts, and spends it on greater works. Devotion also strengthens every heal.', [
      ['Devotion', 'devotion', 'Healing others, smiting the dead and praying build it; it fades when you rest on it. Every point makes your healing stronger, up to 25%.'],
      ['Prayer', 'pray', 'Hold X to kneel and pray: devotion and power return.'],
      ['Holy ground', 'consecrate', 'T hallows the ground at your feet for 12 s (35 devotion): allies on it are healed every second, and the dead are burned and slowed.'],
      ['Smite', '', 'Holy light falls hardest on the dead of the Barrow: twice the harm, and devotion for every blow. It falls from above: a raised shield does not turn it.'], // [balance2]
      ['Steadfast', '', 'Renewal on yourself loosens roots, and for 4 s nothing but a stun breaks your spells: no blunt arrow, storm, mace or thunderclap. Renew before a long cast when a foe keeps cutting you off. Your own wounds mend at three quarters of what others get, and do not mend faster as your ranks grow.'], // [balance2]
      ['Blessings', 'bless', 'With 20 devotion, Renewal also blesses its target in the way of your realm.'],
      ['Raising', 'raise', 'Near a friend who fell a moment ago, T raises them (70 devotion). When you fall, a priest of your realm close by may offer to raise you: accept the prayer on the death screen.'], // [balance]
      ['Temples', '', 'At your realm\'s temple, or near a hallow your realm holds, you are sanctified: devotion comes twice as fast and you heal 15% more.'],
    ])}`;
}

/* ---- what the loading screen remembers of the callings ---- */
LOADING_TIPS.push(
  'A warrior who raises the shield just as a blow arrives parries it: the attacker reels, and momentum builds.',
  'Three chills freeze a foe solid. Storm, or any heavy blow, shatters the ice; fire bursts it into blinding steam.',
  'Lightning leaps further and harder through anyone wet: in the rain, in a river, or soaked in steam.',
  'An archer who keeps still in long grass or among trees is hidden, and the first shot from cover strikes hardest.',
  'Hold your draw to full and the arrow flies true and hard; a snap shot is quick but wild, and the wind carries it.',
  'Frost freezes lakes and ponds into ice you can cross, for a while. Fire melts it fast.',
  'A priest builds devotion by healing and prayer, and spends it to hallow the ground or raise the fallen.',
  'Priests pray best at their own temple, or near a hallow their realm holds.',
  'Stuns, roots and slows taken again and again last less and less, then not at all for a few seconds: your class panel shows how much the next would hold you.', // [balance]
  'Fall near a priest of your realm and they may offer to raise you: accept the prayer on the death screen instead of walking back.',
);
