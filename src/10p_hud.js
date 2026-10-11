/* ================================================================== */
/* [phones] the HUD on every screen                                    */
/* ================================================================== */
// A layout pass (a few times a second, and only when something changed) keeps the panels apart on every screen: the
// frames, the minimap and its buttons, the phone pad with the calling's round buttons, the stick, the hotbar and the
// log stay where they are; the panels that come and go (the target frame, the war panel, the bounty, the path tracker,
// the class panel, the companion bar, the plant card, the toasts) keep their own place when it is free and otherwise
// take the first free place in the column their screen prefers, scanning down from the top.
const HUDL = { on: true, t: 0, k: 0, key: '', moved: new Set(), placed: [], n: 0, ms: 0 };
addEventListener('resize', () => { HUDL.k = 0; });
const HUD_PREF = {
  tall: { '#breath': ['C', 'CB', 'L', 'R2'], '#buildbar': ['CB', 'C'], '#tf': ['L', 'L2'], '#cls': ['L', 'L2', 'R2'], '#petbar': ['L', 'R', 'CB'], '#war': ['R', 'R2'], '#farmcard': ['L', 'R2', 'CB', 'R'], '#lore-path': ['L', 'L2'], '#bounty': ['R', 'R2', 'L'], '#banners': ['C', 'CB', 'L'], '#zonetoast': ['C', 'CB'] }, // [guide] a note shrunk to its title fits under the frames on a small phone
  wide: { '#breath': ['C', 'L2', 'CB', 'R2'], '#buildbar': ['L2', 'C', 'CB'], '#tf': ['L2', 'L'], '#cls': ['L', 'L2', 'C'], '#petbar': ['L2', 'C', 'R2', 'CB'], '#war': ['R2', 'R', 'L2'], '#farmcard': ['L2', 'C', 'R2', 'CB', 'L'], '#lore-path': ['L', 'L2'], '#bounty': ['R2', 'C', 'L2'], '#banners': ['C', 'CB', 'L2'], '#zonetoast': ['C', 'L2', 'CB'] },
  desk: { '#breath': ['C', 'CB'], '#tf': ['L2', 'L'], '#petbar': ['C', 'L2'], '#war': ['R', 'R2'], '#farmcard': ['R', 'R2', 'CB', 'L2'], '#lore-path': ['L', 'L2'], '#bounty': ['R', 'R2'], '#banners': ['C', 'CB', 'L2'] },
};
// in order of need: the first placed get the best places (the builder's bar and the plant card are what you are
// using while they are open)
const HUD_ORDER = ['#buildbar', '#farmcard', '#breath', '#tf', '#cls', '#petbar', '#war', '#lore-path', '#bounty', '#banners', '#zonetoast']; // [water2] the breath bar (07d_dive.js) next after what is in your hands: under the water nothing else is
// [guide] while a field note shows, it comes before the panels that stay, which make room for it a few seconds: after them
// there was never room on a phone and every note waited out of sight (placed after the class panel and the companion bar,
// most notes shrank to their titles on an upright phone); a toast keeps its place after them, so the panels you reach for
// do not jump at every toast
const HUD_ORDER_NOTE = ['#buildbar', '#farmcard', '#breath', '#tf', '#cls', '#banners', '#petbar', '#war', '#lore-path', '#bounty', '#zonetoast']; // an upright phone: the class panel stays
const HUD_ORDER_NOTE_WIDE = ['#buildbar', '#farmcard', '#breath', '#tf', '#banners', '#cls', '#petbar', '#war', '#lore-path', '#bounty', '#zonetoast']; // on its side: the whole note beside the frames
// [v9] on a desk the path tracker (what to do next) comes before the companion bar: a small window keeps it in view
const HUD_ORDER_DESK = ['#buildbar', '#farmcard', '#breath', '#tf', '#cls', '#lore-path', '#petbar', '#war', '#bounty', '#banners', '#zonetoast']; // [water2]
// what may shrink to its essentials when there is no room, and (on a touch screen) what waits out of sight until there
// is: the companion bar's commands, the target and the calling's marks come back as soon as the screen has room
const HUD_COMPACT = new Set(['#war', '#petbar', '#farmcard', '#lore-path', '#banners']); // [guide] a field note shrinks to its title (tap to read it in the Chronicle)
const HUD_HIDE = new Set(['#tf', '#cls', '#petbar', '#war', '#lore-path', '#bounty', '#banners', '#zonetoast', '#breath']); // the plant card is what you are using: it never waits; [water2] the breath bar waits only out of the water (under it nothing comes before it)
function hudShown(el) {
  if (!el || el.hidden || !el.isConnected) return false;
  if (el.offsetParent === null && getComputedStyle(el).position !== 'fixed') return false;
  const cs = getComputedStyle(el);
  return cs.display !== 'none' && cs.visibility !== 'hidden' && el.offsetWidth > 2 && el.offsetHeight > 2;
}
const hudRect = (el) => { const r = el.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; };
const hudHit = (a, b, m = 4) => a.x < b.x + b.w + m && b.x < a.x + a.w + m && a.y < b.y + b.h + m && b.y < a.y + a.h + m;
function hudUnion(rs) {
  if (!rs.length) return null;
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  for (const r of rs) { x0 = Math.min(x0, r.x); y0 = Math.min(y0, r.y); x1 = Math.max(x1, r.x + r.w); y1 = Math.max(y1, r.y + r.h); }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}
// the screen's safe box (the notch, the home bar): read once a pass from a probe
function hudSafe() {
  let p = HUDL.probe;
  if (!p) {
    p = HUDL.probe = document.createElement('div');
    p.style.cssText = 'position:fixed;left:0;top:0;width:0;height:0;visibility:hidden;pointer-events:none;padding:var(--safe-t,0px) var(--safe-r,0px) var(--safe-b,0px) var(--safe-l,0px)';
    document.body.appendChild(p);
  }
  const cs = getComputedStyle(p), f = (v) => parseFloat(v) || 0;
  return { t: f(cs.paddingTop), r: f(cs.paddingRight), b: f(cs.paddingBottom), l: f(cs.paddingLeft) };
}
function hudMove(el, x, y, w = 0) {
  if (el.id === 'war' && getComputedStyle(el).position !== 'absolute') el.style.position = 'absolute';
  if (w) el.style.width = Math.round(w) + 'px'; // a bar sized by its left and right edges keeps its width
  const par = el.offsetParent || $('hud');
  const pr = par.getBoundingClientRect();
  el.style.left = Math.round(x - pr.left) + 'px'; el.style.top = Math.round(y - pr.top) + 'px';
  el.style.right = 'auto'; el.style.bottom = 'auto'; el.style.transform = 'none';
  HUDL.moved.add(el);
}
function hudReset() {
  for (const el of HUDL.moved) { el.style.left = el.style.top = el.style.right = el.style.bottom = el.style.transform = ''; if (el.id === 'war') el.style.position = ''; if (el.id === 'buildbar') el.style.width = ''; }
  HUDL.moved.clear();
  for (const sel of HUD_ORDER) { const el = document.querySelector(sel); if (el) el.classList.remove('hl-compact', 'hl-off'); }
  { const bn = $('banners'); if (bn) for (const k of bn.children) k.classList.remove('hl-old'); } // [guide]
  const zt = $('zonetoast'); if (zt && !HUDL.moved.has(zt)) zt.style.left = zt.style.top = zt.style.transform = '';
  const bt = $('bottom'), lg = $('log');
  if (bt) bt.style.bottom = '';
  for (const id of ['prompt', 'castbar']) { const el = $(id); if (el) { el.classList.remove('hl-off'); el.style.transform = ''; } }
  if (lg) { lg.style.width = ''; lg.style.bottom = ''; lg.style.height = ''; lg.classList.remove('hl-off'); }
}
function hudKey(W, H, touch) {
  const ids = HUD_ORDER.map((s) => { const el = document.querySelector(s); return el && hudShown(el) ? el.offsetWidth + 'x' + el.offsetHeight + (s === '#banners' ? '/' + el.childElementCount : '') : el && el.classList.contains('hl-off') ? 'off' : '-'; }).join();
  const pad = $('tpad'), pf = $('pf'), on = (id) => ($(id) && hudShown($(id)) ? $(id).offsetWidth : 0);
  return `${W}x${H}:${touch}:${ids}:${$('zonetoast') && $('zonetoast').classList.contains('on') ? 'z' : ''}:${pf ? pf.offsetHeight : 0}:${pad ? pad.offsetHeight + '/' + pad.childElementCount : 0}:${on('prompt')}:${on('castbar')}:${on('log')}:${on('hotbar')}`;
}
function hudLayout(dt) {
  if (!HUDL.on || !GAME.started || !GAME.player) return;
  HUDL.t -= dt;
  // a look four times a second (reading the panels' sizes makes the browser lay the page out)
  HUDL.k -= dt;
  if (HUDL.k > 0) return;
  HUDL.k = 0.25;
  const W = innerWidth, H = innerHeight, touch = document.body.classList.contains('touch');
  const key = hudKey(W, H, touch);
  if (key === HUDL.key && HUDL.t > 0) return;
  HUDL.t = 1;
  const t0 = performance.now();
  hudReset();
  const S = hudSafe(), top = (W <= 760 || touch ? 12 : 16) + S.t;
  const tall = (touch || W <= 760) && H >= W, mode = !(touch || W <= 760) ? 'desk' : tall ? 'tall' : 'wide';
  const pref = HUD_PREF[mode];
  // what stays put
  const placed = [];
  const fixed = (sel) => { const el = document.querySelector(sel); if (el && hudShown(el)) placed.push({ ...hudRect(el), sel }); };
  ['#pf', '#mmwrap', '#topright > .iconbtns', '#hotbar'].forEach(fixed);
  const lg = $('log'), hb = $('hotbar'), bb = $('buildbar'), cl = $('cls');
  if (!touch) {
    // [v9] on a desk the class panel sits over the hotbar, the builder's bar over both, and the prompt and the cast bar
    // (which sit over the class panel) rise over the builder's bar while it is open
    fixed('#cls');
    const base = hudUnion([hb, cl].filter((e) => e && hudShown(e)).map(hudRect));
    if (bb && hudShown(bb) && base && mode === 'desk') { bb.style.bottom = Math.round(H - base.y + 8) + 'px'; HUDL.moved.add(bb); } // (a narrow window keeps it at the top)
    fixed('#buildbar');
    const kids = ['prompt', 'castbar'].map((id) => $(id)).filter((e) => e && hudShown(e));
    const u = hudUnion(kids.map(hudRect));
    if (u && bb && hudShown(bb)) { const br = hudRect(bb); if (hudHit(u, br, 2)) { const dy = Math.round(u.y + u.h - br.y + 8); for (const k of kids) k.style.transform = `translateY(${-dy}px)`; } }
    for (const k of kids) placed.push({ ...hudRect(k), sel: '#' + k.id });
  }
  if (touch) {
    // the pad, its round buttons, and the stick's corner
    const tp = $('tpad');
    if (tp && hudShown(tp)) { const rs = [hudRect(tp)]; for (const c of tp.children) if (hudShown(c)) rs.push(hudRect(c)); placed.push({ ...hudUnion(rs), sel: '#tpad' }); }
    const jh = $('joyhint');
    if (jh && hudShown(jh)) { const r = hudRect(jh); placed.push({ x: S.l, y: r.y - 8, w: r.x + r.w + 10 - S.l, h: H - (r.y - 8), sel: '#joyhint' }); }
  }
  const pfR = $('pf') && hudShown($('pf')) ? hudRect($('pf')) : { x: S.l + 12, y: top, w: 0, h: 0 };
  const rightCol = hudUnion(['#mmwrap', '#topright > .iconbtns'].map((s) => document.querySelector(s)).filter((e) => e && hudShown(e)).map(hudRect)) || { x: W - S.r - 12, y: top, w: 0, h: 0 };
  const inside = (r) => r.x >= S.l + 2 && r.y >= S.t + 2 && r.x + r.w <= W - S.r - 2 && r.y + r.h <= H - S.b - 2;
  const free = (r) => inside(r) && !placed.some((p) => hudHit(p, r));
  // the log on a desk keeps its corner, else stops short of what it would cover (the hotbar, the class panel, the
  // builder's bar), else rises over them (shorter: there is less room up there); with no room at all it waits
  // [v9] the class panel and the builder's bar are in the way too
  if (!touch && lg && hudShown(lg)) {
    const avoid = placed.filter((p) => p.sel !== '#log');
    const at = (bottom, w, h) => { lg.style.bottom = bottom == null ? '' : Math.round(bottom) + 'px'; lg.style.width = w ? Math.floor(w) + 'px' : ''; lg.style.height = h ? h + 'px' : ''; return hudRect(lg); };
    const okR = (r) => inside(r) && !avoid.some((q) => hudHit(r, q, 2));
    const lifts = [null, ...[...new Set([hb, cl, bb].filter((e) => e && hudShown(e)).map((e) => Math.round(hudRect(e).y)))].sort((a, b) => b - a).map((y) => H - y + 8)];
    let got = null;
    for (const minW of [230, 170]) {
      for (const lift of lifts) {
        const h = lift == null ? 0 : 112;
        let r = at(lift, 0, h);
        if (okR(r)) { got = r; break; }
        const hits = avoid.filter((q) => hudHit(r, q, 2));
        if (!hits.length || hits.some((q) => q.x <= r.x + 8)) continue;
        const w = Math.min(...hits.map((q) => q.x)) - 12 - r.x;
        if (w < minW) continue;
        r = at(lift, w, h);
        if (okR(r)) { got = r; break; }
      }
      if (got) break;
    }
    if (got) placed.push({ ...got, sel: '#log' });
    else { at(null, 0, 0); lg.classList.add('hl-off'); }
  }
  const xs = { L: () => S.l + 12, L2: () => pfR.x + pfR.w + 8, R: (w) => W - S.r - 12 - w, R2: (w) => rightCol.x - 8 - w, C: (w) => (W - w) / 2 };
  const seek = (sel, r) => {
    for (const a of pref[sel] || ['L']) {
      const up = a.length > 1 && a.endsWith('B'), x = xs[up ? a.slice(0, -1) : a](r.w);
      if (!(x >= S.l)) continue;
      const y0 = top, y1 = H - S.b - 2 - r.h;
      for (let i = 0; ; i++) {
        const y = up ? y1 - i * 6 : y0 + i * 6;
        if (y < y0 || y > y1) break;
        const c = { x, y, w: r.w, h: r.h };
        if (free(c)) return c;
      }
    }
    return null;
  };
  const measure = (sel, el) => (sel === '#banners' ? hudUnion([...el.children].filter(hudShown).map(hudRect)) || hudRect(el) : hudRect(el));
  const put = (sel, el, r, c) => {
    if (sel === '#banners') { const br = hudRect(el); hudMove(el, c.x + (br.x - r.x), c.y + (br.y - r.y)); }
    else hudMove(el, c.x, c.y, sel === '#buildbar' ? r.w : 0);
    placed.push({ ...c, sel });
  };
  const noteUp = mode !== 'desk' && !!document.querySelector('#banners > .lore-note:not(.hl-old)'); // [guide]
  for (const sel of mode === 'desk' ? HUD_ORDER_DESK : noteUp ? (mode === 'wide' ? HUD_ORDER_NOTE_WIDE : HUD_ORDER_NOTE) : HUD_ORDER) {
    const el = document.querySelector(sel);
    if (!el || !hudShown(el)) continue;
    if (sel === '#cls' && !touch) continue; // over the hotbar on a desk, in the bottom's own flow (placed above)
    if (sel === '#buildbar' && !touch) continue;
    if (sel === '#banners' && !el.children.length) continue;
    // the zone's name, only while it shows ([v9] and while it fades: it keeps the place it had)
    if (sel === '#zonetoast' && !el.classList.contains('on') && +getComputedStyle(el).opacity < 0.05) continue;
    let r = measure(sel, el);
    if (free(r)) { placed.push({ ...r, sel }); continue; }
    let c = seek(sel, r);
    if (!c && sel === '#banners' && el.children.length > 1) { // [guide] a toast and a note together do not fit an upright phone: the newest shows, the older wait
      for (const k of [...el.children].slice(0, -1)) k.classList.add('hl-old');
      r = measure(sel, el);
      if (free(r)) { placed.push({ ...r, sel }); continue; }
      c = seek(sel, r);
    }
    if (!c && HUD_COMPACT.has(sel)) {
      el.classList.add('hl-compact');
      r = measure(sel, el);
      if (free(r)) { placed.push({ ...r, sel }); continue; }
      c = seek(sel, r);
    }
    if (c) { put(sel, el, r, c); continue; }
    // it waits until there is room (the plant card only while the builder's bar is open: E places pieces then)
    // [v9] on a desk too: a small window with every panel up has no room for all of them
    if (HUD_HIDE.has(sel) || (sel === '#farmcard' && BUILD.mode)) { el.classList.add('hl-off'); continue; }
    placed.push({ ...r, sel }); // nowhere free: it keeps its own place
  }
  // the prompt and the cast bar rise above whatever they would cover (the pad, the builder's bar)
  const bt = $('bottom');
  if (bt && touch) { // on a desk the prompt and the cast bar keep their place over the hotbar
    const kids = [...bt.children].filter((c) => hudShown(c) && c.id !== 'hotbar' && c.id !== 'cls');
    let u = hudUnion(kids.map(hudRect));
    for (let k = 0; u && k < 4; k++) {
      const hit = placed.filter((p) => p.sel !== '#hotbar' && p.sel !== '#log' && hudHit(p, u, 2));
      if (!hit.length) break;
      // rise above what is under it, unless that only lands it on something else: then on a touch screen it waits
      // (the pad's Use does what the prompt says)
      const lift = Math.min(...hit.map((p) => p.y)), nu = { ...u, y: lift - 8 - u.h };
      if (touch && (nu.y < top || placed.some((p) => p.sel !== '#hotbar' && p.sel !== '#log' && hudHit(p, nu, 2)))) { for (const c of kids) c.classList.add('hl-off'); break; }
      bt.style.bottom = Math.round(H - lift + 8) + 'px';
      u = hudUnion(kids.map(hudRect));
    }
  }
  HUDL.placed = placed;
  HUDL.key = hudKey(W, H, touch);
  HUDL.n++; HUDL.ms = performance.now() - t0;
}
// [phones] a name shows only where its body could be seen: not through the walls of a house, a hall or a keep
const _npCn = [];
function npSeen(e, d) {
  if (e._losT > renderTime) return e._los;
  e._losT = renderTime + 0.25 + Math.random() * 0.1;
  const cx = camera.position.x, cy = camera.position.y, cz = camera.position.z;
  if (INDOOR.on) return (e._los = d < 30 && segmentClear(GAME.player.x, GAME.player.z, e.x, e.z, 0.1)); // under the barrow: solid rock
  const hy = e.y + 1.6 * (e.scale || 1);
  const len = Math.hypot(e.x - cx, e.z - cz), steps = Math.max(1, Math.ceil(len / 0.9));
  for (let s = 1; s < steps; s++) {
    const t = s / steps, x = cx + (e.x - cx) * t, z = cz + (e.z - cz) * t, y = cy + (hy - cy) * t;
    collidersNear(x, z, 3, _npCn);
    for (const c of _npCn) {
      if (!c.active || c.type !== 'box' || (c.tag !== 'wall' && c.tag !== 'hdoor' && c.tag !== 'stone' && c.tag !== 'house')) continue; // [v9] a house's or hall's own walls too
      const dx = x - c.x, dz = z - c.z, lx = dx * c.cos - dz * c.sin, lz = dx * c.sin + dz * c.cos;
      const bot = c.y0 ?? c.baseY ?? heightAt(c.x, c.z); // [keeps] a raised wall piece (a tower's, over a doorway) only at its own height
      if (Math.abs(lx) < c.hx && Math.abs(lz) < c.hz && bot + (c.h || 8) > y + 0.15 && (c.y0 == null || bot < y + 0.15)) return (e._los = false);
    }
  }
  return (e._los = true);
}
