/* Compact touch HUD: the combat dock stays in the world; details live in one sheet. */
const MOBILE_UI = { bound: false, t: 0, skillKey: '', focus: null, section: 'world' };
const MOBILE_PREFS = { hand: 'right', size: 'standard', text: 'standard', names: 'relevant' };
const MOBILE_PREF_CHOICES = { hand: ['right', 'left'], size: ['standard', 'large'], text: ['standard', 'large'], names: ['relevant', 'all'] };

function mobileMovementZone(x, y) {
  return y > view.h * 0.35 && (MOBILE_PREFS.hand === 'left' ? x > view.w * 0.58 : x < view.w * 0.42);
}
function mobileApplyPrefs(patch = {}, persist = true) {
  if (!IS_TOUCH) return;
  mobileStopInput();
  for (const k of Object.keys(MOBILE_PREF_CHOICES)) {
    if (MOBILE_PREF_CHOICES[k].includes(patch[k])) MOBILE_PREFS[k] = patch[k];
    const control = $('mobile-pref-' + k);
    if (control) control.value = MOBILE_PREFS[k];
  }
  document.body.classList.toggle('mobile-left-handed', MOBILE_PREFS.hand === 'left');
  document.body.classList.toggle('mobile-large-ui', MOBILE_PREFS.size === 'large');
  document.body.classList.toggle('mobile-large-text', MOBILE_PREFS.text === 'large');
  const hint = $('joyhint');
  if (hint) hint.textContent = 'Drag to walk';
  HUDL.k = 0;
  if (persist) {
    try { localStorage.setItem('hm_mobile_controls_v1', JSON.stringify(MOBILE_PREFS)); }
    catch (e) { uiError('Your browser could not save these controls. They apply until you reload.'); }
  }
}
function mobilePreferences() {
  const host = $('mobile-tray-preferences');
  if (!host) return;
  host.innerHTML = '<h3>Touch controls</h3><p>Choose the side for your action buttons. Drag on the opposite side to walk.</p>' +
    '<label for="mobile-pref-hand">Action buttons<select id="mobile-pref-hand"><option value="right">Right hand</option><option value="left">Left hand</option></select></label>' +
    '<label for="mobile-pref-size">Control size<select id="mobile-pref-size"><option value="standard">Standard</option><option value="large">Large</option></select></label>' +
    '<label for="mobile-pref-text">Text size<select id="mobile-pref-text"><option value="standard">Standard</option><option value="large">Large</option></select></label>' +
    '<label for="mobile-pref-names">World names<select id="mobile-pref-names"><option value="relevant">Nearby and selected</option><option value="all">All visible</option></select></label>';
  for (const k of Object.keys(MOBILE_PREF_CHOICES)) $('mobile-pref-' + k).onchange = (e) => mobileApplyPrefs({ [k]: e.target.value });
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem('hm_mobile_controls_v1') || '{}') || {}; } catch (e) { /* use defaults for old or unavailable storage */ }
  mobileApplyPrefs(saved, false);
}
function mobileSection(section = 'world', focus = false) {
  const tabs = [...document.querySelectorAll('[data-mobile-tab]')];
  if (!tabs.some((tab) => tab.dataset.mobileTab === section)) return;
  MOBILE_UI.section = section;
  $('mobile-tray-title').textContent = { world: 'Game menu', character: 'Skills & character', social: 'Players & realm', options: 'Options' }[section];
  $('mobile-tray').dataset.section = section;
  const sheet = $('mobile-tray').querySelector('.mobile-sheet');
  if (sheet) sheet.scrollTop = 0;
  $('mobile-tray-panel').scrollTop = 0;
  for (const tab of tabs) {
    const selected = tab.dataset.mobileTab === section;
    tab.setAttribute('aria-selected', String(selected)); tab.tabIndex = selected ? 0 : -1;
    if (selected) {
      $('mobile-tray-panel').setAttribute('aria-labelledby', tab.id);
      if (focus) tab.focus();
    }
  }
}
function mobileModalChanged(value) {
  if (value) {
    if ($('hud').contains(document.activeElement)) MOBILE_UI.focus = document.activeElement;
    mobileStopInput();
  }
  document.body.classList.toggle('mobile-modal-open', !!value);
  $('hud').inert = !!value;
  // All sheets share UI.modal. Close a superseded More sheet in the same event,
  // before focus is handed to the new sheet or returned to a world control.
  if (value !== 'mobile' && !$('mobile-tray').hidden) {
    $('mobile-tray').hidden = true;
    document.body.classList.remove('mobile-tray-open');
    $('mobile-menu-toggle').setAttribute('aria-expanded', 'false');
  }
  queueMicrotask(() => {
    if (UI.modal !== value) return;
    // A sheet can hand off to chat in the same click. Keep the new text field's
    // focus instead of returning it to the control that opened the old sheet.
    if (!value && typing() && document.activeElement.getClientRects().length) return;
    const focus = value === 'kit' ? $('kit-close') : value === 'map' ? $('btn-mapclose') : !value ? MOBILE_UI.focus : null;
    if (focus && focus.isConnected && !focus.closest('[hidden]')) focus.focus({ preventScroll: true });
  });
}
function mobileInteractionLabel(label) {
  if (/^(speak|talk)\b/i.test(label)) return 'Talk';
  if (/^step through\b/i.test(label)) return 'Travel';
  if (/^trade\b/i.test(label)) return 'Trade';
  if (/^(pick up|take)\b/i.test(label)) return 'Take';
  return label.trim().split(/\s+/)[0].replace(/[^a-z]/gi, '') || 'Use';
}
function mobileAbilityLabel(name) {
  const short = { 'Bulwark': 'Bul\u200bwark', 'Deadeye': 'Dead\u200beye', 'Meteor': 'Me\u200bteor',
    'Cleave': 'Wide cut', 'Charge': 'Rush', 'Tumble': 'Roll', 'Renewal': 'Re\u200bnew',
    'Rallying Cry': 'Rally', 'Whirlwind': 'Whirl', 'Crippling Arrow': 'Slow arrow', 'Piercing Shot': 'Pierce',
    'Frost Lance': 'Ice lance', 'Flame Nova': 'Nova', 'Divine Shield': 'Shield',
    'Arcane Ward': 'Ward', 'Chain Lightning': 'Bolt', 'Blizzard': 'Ice', 'Sanctuary': 'Haven',
    'Mass Renewal': 'Heal all', 'Pillar of Dawn': 'Dawn pillar' };
  return short[name] || name;
}
function mobileNameplateEligible(e, P) {
  if (P.target === e.id || MOBILE_PREFS.names === 'all') return true;
  const d = Math.hypot(e.x - P.x, e.z - P.z);
  return d <= (isEnemy(P, e) ? 14 : e.tame ? 8 : 7);
}

function mobileStopInput() {
  cancelPlayerInput();
}
function mobileViewport() {
  if (!IS_TOUCH) return;
  // A normal browser tab already supplies a safe viewport. Reserve notch/home
  // insets only when the page actually extends behind them in immersive mode.
  const immersive = !!document.fullscreenElement || matchMedia('(display-mode: standalone), (display-mode: fullscreen)').matches;
  const viewport = document.querySelector('meta[name="viewport"]');
  const content = 'width=device-width, initial-scale=1, viewport-fit=' + (immersive ? 'cover' : 'auto');
  if (viewport && viewport.content !== content) viewport.content = content;
  // World, projection and HUD share the layout viewport. The keyboard can make
  // the visual viewport smaller; only open sheets follow that smaller rectangle.
  const root = document.documentElement.style, vv = window.visualViewport;
  root.setProperty('--mobile-vh', innerHeight + 'px');
  root.setProperty('--mobile-sheet-vh', Math.round(vv ? vv.height : innerHeight) + 'px');
  root.setProperty('--mobile-sheet-top', Math.round(vv ? vv.offsetTop : 0) + 'px');
  HUDL.k = 0;
}
function mobileTray(open = UI.modal !== 'mobile', focus = true, section = 'world') {
  if (!IS_TOUCH || !$('mobile-tray')) return;
  if (open && UI.modal && UI.modal !== 'mobile') return;
  if (open) {
    mobileSync();
    MOBILE_UI.focus = document.activeElement;
    mobileStopInput();
    UI.modal = 'mobile';
  } else if (UI.modal === 'mobile') UI.modal = null;
  $('mobile-tray').hidden = !open;
  // Reset after the sheet is visible: hidden scrollers can retain their old
  // offset when switching from a long Skills page to the shorter Explore page.
  if (open) mobileSection(section);
  document.body.classList.toggle('mobile-tray-open', open);
  $('mobile-menu-toggle').setAttribute('aria-expanded', String(open));
  HUDL.k = 0;
  if (focus) {
    const el = open ? $('mobile-tray-close') : MOBILE_UI.focus;
    if (el && el.isConnected && typeof el.focus === 'function') el.focus({ preventScroll: true });
  }
}
function mobileBind() {
  if (MOBILE_UI.bound) return;
  MOBILE_UI.bound = true;
  // Modal input cancellation applies to desktop too: a drawn bow must never
  // fire through a map or menu, even if the sheet opens/closes between frames.
  let modal = UI.modal;
  Object.defineProperty(UI, 'modal', { configurable: true, enumerable: true,
    get() { return modal; }, set(value) {
      if (modal === value) return;
      if (value === 'dialog' && typeof dialogFocusStart === 'function') dialogFocusStart();
      modal = value;
      if (IS_TOUCH && $('mobile-tray')) mobileModalChanged(value);
      else if (value) cancelPlayerInput();
    } });
  // These are modal game screens on keyboard desktops as well as phones.
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Tab' || !['kit', 'map', 'dialog', 'death', 'net'].includes(UI.modal)) return;
    const panel = $(UI.modal === 'map' ? 'mapov' : UI.modal === 'net' ? 'netsheet' : UI.modal);
    const fs = [...panel.querySelectorAll('button, input, select, textarea, summary, a[href], [tabindex]')]
      .filter((el) => !el.disabled && el.tabIndex >= 0 && !el.closest('[hidden], [inert]') && el.getClientRects().length);
    if (!fs.length) return;
    const first = fs[0], last = fs[fs.length - 1];
    if (!fs.includes(document.activeElement)) { e.preventDefault(); (e.shiftKey ? last : first).focus(); }
    else if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });
  if (!IS_TOUCH || !$('mobile-tray')) { if (modal) cancelPlayerInput(); return; }
  mobileModalChanged(modal);
  mobilePreferences();
  mobileBindNoZoom();
  mobileSection('world');
  $('mobile-nav').addEventListener('click', (e) => {
    const button = e.target.closest('button');
    // iOS does not always focus a tapped button; keep the return destination
    // explicit before the modal makes its invoker inert.
    if (button) button.focus({ preventScroll: true });
  }, true);
  $('mobile-menu-toggle').onclick = () => mobileTray();
  $('mobile-inventory').onclick = () => { if (!UI.modal) openKit('kit'); };
  $('mobile-skills').onclick = () => mobileTray(true, true, 'character');
  $('mobile-notes').onclick = () => { if (!UI.modal) openChronicle('notes'); };
  $('mobile-map').onclick = () => { if (!UI.modal) toggleMap(); };
  $('mobile-tray-close').onclick = () => mobileTray(false);
  $('mobile-character').onclick = () => { mobileTray(false, false); openMenu('char'); };
  const map = $('mmwrap');
  map.tabIndex = 0; map.setAttribute('role', 'button'); map.setAttribute('aria-label', 'Open the map');
  map.onclick = () => { if (!UI.modal) toggleMap(); };
  map.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); map.click(); } });
  const tray = $('mobile-tray');
  // Existing buttons retain their listeners and IDs. Remove the sheet's modal guard before those listeners run.
  tray.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (e.target.closest('[data-mobile-tab], #mobile-tray-preferences')) return;
    if (b && b.id !== 'mobile-tray-close') mobileTray(false, false);
    else if (e.target.closest('#war, .net-pm')) mobileTray(false, false);
  }, true);
  tray.addEventListener('click', (e) => {
    if (e.target === tray) { mobileTray(false); return; }
    const tab = e.target.closest('[data-mobile-tab]');
    if (tab) { mobileSection(tab.dataset.mobileTab); return; }
    const b = e.target.closest('[data-mobile-action]');
    if (!b) return;
    if (b.dataset.mobileAction === 'settings') openMenu('settings');
    else if (b.dataset.mobileAction === 'help') openMenu('help');
    else if (b.dataset.mobileAction === 'chronicle') openChronicle();
  });
  tray.addEventListener('keydown', (e) => {
    const tab = e.target.closest('[data-mobile-tab]');
    if (tab && ['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) {
      const tabs = [...tray.querySelectorAll('[data-mobile-tab]')], i = tabs.indexOf(tab);
      const next = e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1 : (i + (e.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
      e.preventDefault(); e.stopPropagation(); mobileSection(tabs[next].dataset.mobileTab, true); return;
    }
    if (e.key !== 'Tab' || UI.modal !== 'mobile') return;
    const fs = [...tray.querySelectorAll('button, summary, select, input, a[href], [tabindex="0"]')].filter((el) => !el.disabled && el.tabIndex >= 0 && el.getClientRects().length);
    if (!fs.length) return;
    const first = fs[0], last = fs[fs.length - 1];
    if (!tray.contains(document.activeElement)) { e.preventDefault(); (e.shiftKey ? last : first).focus(); }
    else if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });
  const extra = document.createElement('div');
  extra.id = 'mobile-extra-actions'; extra.className = 'mobile-extra-actions';
  extra.innerHTML = '<button type="button" class="btn" data-mobile-action="chronicle" data-mobile-section="world">Chronicle</button>' +
    '<button type="button" class="btn" data-mobile-action="settings" data-mobile-section="options">Graphics &amp; sound</button>' +
    '<button type="button" class="btn" data-mobile-action="help" data-mobile-section="options">How to play</button>';
  $('mobile-tray-utilities').appendChild(extra);
  const pad = $('tpad');
  pad.addEventListener('pointerdown', (e) => {
    const button = e.target.closest('button');
    if (button && !button.disabled && !UI.modal) button.classList.add('is-pressed');
  }, true);
  const release = () => { for (const b of pad.querySelectorAll('.is-pressed')) b.classList.remove('is-pressed'); };
  addEventListener('pointerup', release, true); addEventListener('pointercancel', release, true);
  pad.addEventListener('lostpointercapture', release, true);
  addEventListener('resize', mobileViewport);
  document.addEventListener('fullscreenchange', mobileViewport);
  matchMedia('(display-mode: standalone), (display-mode: fullscreen)').addEventListener('change', mobileViewport);
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', mobileViewport);
    window.visualViewport.addEventListener('scroll', mobileViewport);
  }
  addEventListener('blur', () => { if (UI.modal === 'mobile') mobileStopInput(); });
  mobileViewport();
}
function mobileBuild() {
  if (!IS_TOUCH) return;
  mobileBind();
  const pad = $('tpad'), P = GAME.player;
  if (!P) return;
  const primary = document.createElement('div'); primary.className = 'mobile-primary';
  primary.setAttribute('role', 'group'); primary.setAttribute('aria-label', 'Your learned abilities');
  const main = document.createElement('div'); main.className = 'mobile-main-action';
  const skills = document.createElement('div'); skills.className = 'mobile-skills';
  const cls = document.createElement('div'); cls.className = 'mobile-class';
  cls.setAttribute('role', 'group'); cls.setAttribute('aria-label', 'Class actions and realm gift');
  for (const s of [...pad.querySelectorAll('.slot[data-slot]')]) {
    const A = ABILITIES[CLASSES[P.cls].abilities[+s.dataset.slot]];
    s.classList.toggle('locked', A.level > P.level);
    const label = document.createElement('span'); label.className = 'mobile-label';
    label.textContent = mobileAbilityLabel(A.name); s.appendChild(label);
    (+s.dataset.slot === 0 ? main : skills).appendChild(s);
  }
  primary.append(main, skills);
  for (const b of [...pad.querySelectorAll('.cls-btn, .gslot')]) {
    if (b.classList.contains('gslot')) {
      b.classList.toggle('locked', !giftUltUnlocked(P));
      const label = document.createElement('span'); label.className = 'mobile-label'; label.textContent = 'Gift'; b.appendChild(label);
    }
    if (b.classList.contains('tech')) {
      const feature = { warrior: 'stances', archer: 'snare', mage: 'focus', priest: 'consecrate' }[P.cls];
      b.hidden = !clsHas(P, feature);
    }
    cls.appendChild(b);
  }
  const utility = pad.querySelector('.wide');
  utility.classList.add('mobile-utility');
  const extra = $('mobile-extra-actions');
  for (const id of ['t-ride', 't-kit']) {
    // A level-up rebuilds the dock, so retire the previous relocated controls first.
    for (const old of [...document.querySelectorAll('#mobile-tray #' + id)]) old.remove();
    const b = pad.querySelector('#' + id);
    if (!b) continue;
    if (id === 't-kit') { b.remove(); continue; } // the real Kit button is in the sheet's navigation
    b.onclick = () => toggleMount(); b.dataset.mobileSection = 'world'; extra.prepend(b);
  }
  const potion = pad.querySelector('#t-potion');
  if (potion) potion.setAttribute('aria-label', 'Drink a healing draught');
  pad.prepend(primary); pad.prepend(cls);
  MOBILE_UI.skillKey = '';
  mobileSync();
  HUDL.k = 0;
}
function mobileSync() {
  if (!IS_TOUCH || !$('mobile-tray-nav') || !MOBILE_UI.bound) return;
  const nav = $('mobile-tray-nav'), util = $('mobile-tray-utilities');
  const host = $('btn-map') && $('btn-map').parentElement;
  if (host && host.parentElement !== nav) nav.appendChild(host);
  const labels = { 'btn-map': 'Map', 'btn-kit': 'Inventory', 'btn-menu': 'Character', 'btn-log': 'Event log',
    'btn-build': 'Build', 'btn-animals': 'Animals', 'btn-net': 'Players & chat' };
  if (host) for (const b of host.querySelectorAll('button')) {
    b.dataset.mobileSection = ['btn-kit', 'btn-menu'].includes(b.id) ? 'character' : b.id === 'btn-net' ? 'social' : 'world';
    if (b.querySelector('.mobile-nav-label')) continue;
    const label = document.createElement('span'); label.className = 'mobile-nav-label';
    label.textContent = labels[b.id] || (b.getAttribute('aria-label') || b.title || 'Open').replace(/\s*\([^)]*\)/g, '');
    b.appendChild(label);
  }
  for (const id of ['needs', 'cls', 'petbar', 'netparty', 'war', 'bounty']) {
    const el = $(id);
    if (el) el.dataset.mobileSection = id === 'cls' ? 'character' : ['netparty', 'war', 'bounty'].includes(id) ? 'social' : 'world';
    if (el && el.parentElement !== util) {
      el.classList.remove('hl-off', 'hl-compact');
      util.appendChild(el);
    }
  }
  const keep = $('btn-keep-character');
  if (keep && keep.parentElement !== util) {
    keep.dataset.mobileSection = 'world character social options';
    util.prepend(keep);
  }
  const needs = $('needs'), extra = $('mobile-extra-actions');
  if (needs && extra && needs.nextElementSibling !== extra) util.insertBefore(needs, extra);
  const P = GAME.player;
  if (!P) return;
  const key = P.cls + ':' + P.level + ':' + P.faction + ':' + giftRR();
  if (key !== MOBILE_UI.skillKey) {
    MOBILE_UI.skillKey = key;
    const D = GIFT_DEF[P.faction].ult;
    $('mobile-tray-abilities').innerHTML = CLASSES[P.cls].abilities.map((id, i) => {
      const A = ABILITIES[id], locked = A.level > P.level;
      const label = mobileAbilityLabel(A.name).replace(/\u200b/g, '');
      return '<details data-mobile-ability="' + i + '" data-locked="' + locked + '"><summary>' +
        '<span>' + esc(A.name) + (label !== A.name ? ' (' + esc(label) + ')' : '') + '</span><small>' + (locked ? 'Level ' + A.level : 'Learned') +
        '</small></summary><p>' + esc(A.desc) + '</p><p>' + A.cost + ' power · ' +
        (A.cast ? A.cast + ' s cast' : 'Instant') + (A.cd ? ' · ' + A.cd + ' s cooldown' : '') + '</p></details>';
    }).join('') + '<details class="mobile-gift-info"><summary><span>' + esc(D.name) +
      '</span><small>Realm gift</small></summary><p>' + esc(D.text(giftUltK(P))) +
      '</p><p>Available at realm rank ' + GIFT_ULT_RR + ' or level ' + GIFT_ULT_LV + '.</p></details>';
  }
}
function mobileHUD(dt) {
  if (!IS_TOUCH || !GAME.player) return;
  if (UI.modal !== 'mobile' && !$('mobile-tray').hidden) mobileTray(false, false);
  MOBILE_UI.t -= dt;
  if (MOBILE_UI.t > 0) return;
  MOBILE_UI.t = 0.25;
  mobileSync(); // picks up asynchronous Players, companion and survival controls
  const P = GAME.player, cs = csOf(P), hold = document.querySelector('#tpad .cls-btn.hold span');
  if (hold) {
    const label = P.cls === 'archer' && cs.drawFrom >= 0 ? Math.round(drawK(P) * 100) + '%' :
      P.cls === 'priest' ? 'Pray ' + Math.round(devOf(P)) : classLabels(P).hold;
    setT(hold, label);
  }
  const alert = $('mobile-needs-alert');
  if (alert) {
    const text = SURV.thirst < 0.4 ? 'Thirsty · Menu → Explore' : SURV.hunger < 0.4 ? 'Hungry · Menu → Explore' : '';
    alert.hidden = !text; setT(alert, text);
  }
  const notice = $('mobile-notice'), net = $('btn-net');
  if (notice) {
    const count = net && net.querySelector('.net-n');
    const invite = !!net && !net.hidden && net.classList.contains('net-glow');
    const text = !net || net.hidden ? '' : invite ? '!' : count ? count.textContent : '';
    notice.hidden = !text; setT(notice, text);
    $('mobile-menu-toggle').classList.toggle('mobile-notice', !!text);
  }
  const character = $('mobile-character');
  if (character) character.setAttribute('aria-label', 'Character: ' + P.name + ', level ' + P.level +
    '. Health ' + Math.ceil(P.hp) + ' of ' + Math.ceil(P.maxHp) + '. Open character details');
}
queueMicrotask(() => {
  if (window.__hm) window.__hm.mobile = { show: mobileTray, sync: mobileSync, build: mobileBuild, state: MOBILE_UI,
    prefs: MOBILE_PREFS, applyPrefs: mobileApplyPrefs, section: mobileSection, touchNoZoom: MOBILE_TOUCH_NO_ZOOM };
});
