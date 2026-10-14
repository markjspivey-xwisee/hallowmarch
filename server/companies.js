// [companies] Companies: persistent teams within a realm, kept by the March's own server (version 20; CLAUDE.md,
// Multiplayer, Companies). A player of a named account founds one (a name checked for length, letters, the March's own
// names and the realm's other companies; a device of the veteran's ten and two tinctures of its realm), invites others of
// its realm by their account's name (on now, or waiting for their next visit), and they join, leave or are removed; a
// captain, officers (who invite, set the notice, muster and pledge) and members, 30 at most. The company keeps its own
// chat (read on return), a notice the captain sets, its roster (who is on, what each brought today and this season, the
// keeps taken with them about) and its tally for the season: its members' deliveries and captures counted together, its
// season points, and a pledge for one of the realm's works (its members' goods go to that work first: into its own stock
// while it is at work, as votes for it while it is not). A company's members online may muster: they form one party.
// Kept here beside RS (not inside it: RS is the realms', the companies are the players'), in companies.json on the
// volume, written whole and renamed into place, read back and sanitised at the start.
const MAX_MEMBERS = 30, MAX_CHAT = 60, MAX_INVITES = 24, MAX_INV_ACCT = 6, MAX_COS = 600;
export const CO_DEVICES = 10; // the veteran's devices (src/04_l3device.js L3_DEVICE_NAMES)
export const CO_TINCTURES = 5; // a realm's colour, its light, its dark, gold, silver (14r_companies.js CO_TINCT)
const coDict = () => Object.create(null); // account and company keys must never resolve inherited properties
const GENERIC = ['hallowmarch', 'admin', 'moderator', 'official', 'server', 'herald', 'quartermaster', 'keeper', 'developer', 'anthropic', 'claude', 'system', 'cinderwing', 'hollowking', 'ashcrowned', 'vorlach', 'gamemaster', 'support'];
const norm = (s) => String(s || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
// what a player types, as text: no control, format or invisible characters, one space at a time
export const coText = (s, n) => (typeof s === 'string' ? s.replace(/[\u0000-\u001f\u007f-\u009f\u00ad\u061c\u115f\u1160\u17b4\u17b5\u180e\u200b-\u200f\u2028-\u202e\u2060-\u206f\u3164\ufe00-\ufe0f\ufeff\uffa0\ufff0-\ufffb]/g, '').replace(/\s+/g, ' ').trim().slice(0, n) : '');

// the March's own names a company may not take (or hide inside its own): the realms, their towns, keeps, temples,
// hallows and homelands, every site, the great foes, and the words of the March's own voice
export function reservedNames(world) {
  const out = new Set(GENERIC);
  for (const R of (world && world.REALMS) || []) {
    for (const n of [R.name, R.townName, R.templeName, R.hallowName, R.homeName, ...(R.keepNames || [])]) {
      const k = norm(String(n || '').replace(/^the\s+/i, ''));
      if (k.length >= 4) out.add(k);
    }
  }
  for (const S of (world && world.SITES) || []) { const k = norm(String(S.name || '').replace(/^the\s+/i, '')); if (k.length >= 5) out.add(k); }
  return [...out];
}
// a company's name checked: 3 to 24 characters of letters, digits, spaces, apostrophes and hyphens, three letters at
// least, none of the March's own names, and no other company of the realm by the same name (letters and digits alone)
export function coNameWhy(name, reserved) {
  const n = coText(name, 40);
  if (n.length < 3 || n.length > 24) return 'A name of 3 to 24 letters';
  if (!/^[\p{L}\p{N}][\p{L}\p{N} '\-]*$/u.test(n)) return "Letters, digits, spaces, ' and - only";
  if ((n.match(/\p{L}/gu) || []).length < 3) return 'Three letters at least';
  const k = norm(n);
  if (k.length < 3) return 'Three letters at least';
  if (k === 'march' || k === 'themarch' || reserved.some((r) => k.includes(r))) return "That name is the March's own";
  return '';
}

export function makeCompanies(cfg, store, stats, hooks) {
  // hooks: { acct(id), acctByName(name), seasonN(), season (the SEASON object), reserved: [...] }
  const D = sanitize(store.read('companies.json', null));
  const C = { D, dirty: false, stats: { founded: 0, joined: 0, left: 0, removed: 0, invites: 0, refused: 0, said: 0, pledged: 0, pledgeMoved: 0, pledgeVoted: 0, captures: 0, musters: 0 } };
  const byAcct = new Map(); // account id -> company id
  const clearInvites = (acct) => {
    // Keep both indexes in step when an invitee joins or founds any company.
    for (const co of Object.values(D.list)) delete co.inv[acct];
    delete D.inv[acct];
  };
  const reindex = () => { byAcct.clear(); for (const co of Object.values(D.list)) for (const id of Object.keys(co.mem)) byAcct.set(id, co.id); };
  reindex();
  let timer = null;
  C.save = (now) => { clearTimeout(timer); const w = () => { store.write('companies.json', D); C.dirty = false; stats.coSaves = (stats.coSaves || 0) + 1; }; if (now) w(); else timer = setTimeout(w, 1200); C.dirty = true; };
  const no = (why) => { C.stats.refused++; return { ok: false, why }; };
  C.of = (acct) => { const id = byAcct.get(acct); return id ? D.list[id] || null : null; };
  const roleOf = (co, acct) => (co && co.mem[acct] ? co.mem[acct].role : '');
  const canLead = (co, acct) => { const r = roleOf(co, acct); return r === 'cap' || r === 'off'; };
  const nameOf = (acct) => { const A = hooks.acct(acct); return A ? A.name : 'Someone'; };
  // the company's tally for this season (a new season begins it afresh)
  const tally = (co) => {
    const n = hooks.seasonN() || 1;
    if (!co.s || co.s.n !== n) co.s = { n, pts: 0, u: 0, caps: 0, by: coDict(), pl: coDict() };
    return co.s;
  };
  const day = () => Math.floor(Date.now() / 86400e3);
  const line = (co, name, text) => { co.chat.push([Date.now(), String(name).slice(0, 24), text]); if (co.chat.length > MAX_CHAT) co.chat.splice(0, co.chat.length - MAX_CHAT); };

  C.found = (A, realm, name, dev, col) => {
    if (!A || A.guest) return no('Name your account first (the Players sheet): a guest cannot found a company');
    if (!Number.isInteger(realm) || realm < 0 || realm > 2) return no('No realm yet');
    if (C.of(A.id)) return no('You are in a company already: leave it first');
    if (Object.keys(D.list).length >= MAX_COS) return no('The March holds no more companies');
    const now = Date.now();
    if (A.coFoundAt && now - A.coFoundAt < 60000) return no('One company a minute');
    const why = coNameWhy(name, hooks.reserved);
    if (why) return no(why);
    const n = coText(name, 24), key = norm(n);
    if (Object.values(D.list).some((co) => co.realm === realm && co.key === key)) return no('Your realm has a company by that name');
    dev = Number.isInteger(dev) && dev >= 0 && dev < CO_DEVICES ? dev : 0;
    const c0 = Array.isArray(col) && Number.isInteger(col[0]) && col[0] >= 0 && col[0] < CO_TINCTURES ? col[0] : 0;
    let c1 = Array.isArray(col) && Number.isInteger(col[1]) && col[1] >= 0 && col[1] < CO_TINCTURES ? col[1] : 3;
    if (c1 === c0) c1 = (c0 + 3) % CO_TINCTURES;
    const id = 'c' + (++D.seq).toString(36) + Math.random().toString(36).slice(2, 6);
    const co = { id, name: n, key, realm, dev, col: [c0, c1], cap: A.id, mem: Object.assign(coDict(), { [A.id]: { role: 'cap', j: now } }), notice: { x: '', by: '', at: 0 }, chat: [], pledge: '', inv: coDict(), created: now };
    D.list[id] = co; byAcct.set(A.id, id); A.coFoundAt = now;
    clearInvites(A.id);
    line(co, '', `${A.name} founds ${n}.`);
    C.stats.founded++; C.save();
    return { ok: true, id };
  };
  // an invitation by the account's name: waiting for its next visit if it is not on (one a company, six an account)
  C.invite = (A, who) => {
    const co = C.of(A.id);
    if (!co) return no('You are in no company');
    if (!canLead(co, A.id)) return no('Only the captain and the officers invite');
    const B = hooks.acctByName(coText(who, 20));
    if (!B) return no('No account by that name (a guest must name its account first)');
    if (B.id === A.id) return no('You are in it already');
    const r = hooks.realmOf(B.id);
    if (r >= 0 && r !== co.realm) return no(`${B.name} is of another realm`);
    if (C.of(B.id)) return no(`${B.name} is in a company already`);
    if (Object.keys(co.mem).length + Object.keys(co.inv).length >= MAX_MEMBERS + 6) return no('Your company is full');
    if (Object.keys(co.mem).length >= MAX_MEMBERS) return no(`A company holds ${MAX_MEMBERS} at most`);
    const L = (D.inv[B.id] = (D.inv[B.id] || []).filter((I) => D.list[I.co] && I.co !== co.id));
    if (L.length >= MAX_INV_ACCT) return no(`${B.name} has more invitations than they can answer`);
    if (Object.keys(co.inv).length >= MAX_INVITES) return no('Your company has asked enough for now: wait for answers');
    L.push({ co: co.id, by: A.name, at: Date.now() });
    co.inv[B.id] = Date.now();
    C.stats.invites++; C.save();
    return { ok: true, to: B.id, name: B.name };
  };
  C.answer = (A, coId, yes, realm) => {
    const L = D.inv[A.id] || [];
    const I = L.find((x) => x.co === coId), co = D.list[coId];
    D.inv[A.id] = L.filter((x) => x.co !== coId);
    if (!D.inv[A.id].length) delete D.inv[A.id];
    if (co) delete co.inv[A.id];
    C.save();
    if (!I || !co) return no('That invitation is no longer open');
    if (!yes) { line(co, '', `${A.name} declines the company's invitation.`); return { ok: true, co: co.id }; }
    if (A.guest) return no('Name your account first');
    if (C.of(A.id)) return no('You are in a company already');
    if (realm !== co.realm) return no(`${co.name} is of another realm`);
    if (Object.keys(co.mem).length >= MAX_MEMBERS) return no(`${co.name} is full`);
    co.mem[A.id] = { role: 'mem', j: Date.now() }; byAcct.set(A.id, co.id);
    clearInvites(A.id);
    line(co, '', `${A.name} joins the company.`);
    C.stats.joined++; C.save();
    return { ok: true, co: co.id };
  };
  const drop = (co, acct) => {
    delete co.mem[acct]; byAcct.delete(acct);
    if (co.cap === acct) {
      // the captaincy passes to the longest-serving officer, else the longest-serving member; none left, the company ends
      const left = Object.entries(co.mem).sort((a, b) => (a[1].role === 'off' ? 0 : 1) - (b[1].role === 'off' ? 0 : 1) || a[1].j - b[1].j);
      if (!left.length) { for (const id of Object.keys(co.inv)) if (D.inv[id]) D.inv[id] = D.inv[id].filter((I) => I.co !== co.id); delete D.list[co.id]; return null; }
      co.cap = left[0][0]; co.mem[co.cap].role = 'cap';
      line(co, '', `${nameOf(co.cap)} is the company's captain now.`);
    }
    return co;
  };
  C.leave = (A) => {
    const co = C.of(A.id);
    if (!co) return no('You are in no company');
    line(co, '', `${A.name} leaves the company.`);
    const still = drop(co, A.id);
    C.stats.left++; C.save();
    return { ok: true, co: co.id, gone: !still };
  };
  C.remove = (A, who) => {
    const co = C.of(A.id);
    if (!co || roleOf(co, A.id) !== 'cap') return no('Only the captain removes a member');
    if (typeof who !== 'string' || !co.mem[who] || who === A.id) return no('Not a member you can remove');
    line(co, '', `${A.name} removes ${nameOf(who)} from the company.`);
    drop(co, who);
    C.stats.removed++; C.save();
    return { ok: true, co: co.id, who };
  };
  // the captain makes an officer, a member again, or hands the captaincy on
  C.rank = (A, who, role) => {
    const co = C.of(A.id);
    if (!co || roleOf(co, A.id) !== 'cap') return no('Only the captain names officers');
    if (typeof who !== 'string' || !co.mem[who] || who === A.id) return no('Not a member');
    if (role === 'cap') { co.mem[A.id].role = 'off'; co.mem[who].role = 'cap'; co.cap = who; line(co, '', `${A.name} hands the captaincy to ${nameOf(who)}.`); }
    else if (role === 'off' || role === 'mem') { co.mem[who].role = role; line(co, '', role === 'off' ? `${nameOf(who)} is an officer of the company now.` : `${nameOf(who)} is a member of the company again.`); }
    else return no('No such rank');
    C.save();
    return { ok: true, co: co.id };
  };
  C.notice = (A, text) => {
    const co = C.of(A.id);
    if (!co || !canLead(co, A.id)) return no('Only the captain and the officers set the notice');
    co.notice = { x: coText(text, 120), by: A.name, at: Date.now() };
    C.save();
    return { ok: true, co: co.id };
  };
  C.say = (A, text) => {
    const co = C.of(A.id);
    if (!co) return no('You are in no company');
    const t = coText(text, 140);
    if (!t) return no('Nothing to say');
    line(co, A.name, t);
    C.stats.said++; C.save();
    return { ok: true, co: co.id, line: co.chat[co.chat.length - 1] };
  };
  C.pledge = (A, proj) => {
    const co = C.of(A.id);
    if (!co || !canLead(co, A.id)) return no('Only the captain and the officers pledge the company');
    const ids = hooks.projects();
    if (proj && !ids.includes(proj)) return no('No such work');
    co.pledge = proj || '';
    line(co, '', proj ? `${A.name} pledges the company's goods to ${hooks.projectName(proj)}.` : `${A.name} takes back the company's pledge.`);
    C.stats.pledged++; C.save();
    return { ok: true, co: co.id };
  };
  // a member's delivery taken by the season: counted for the company; under a pledge the goods go to that work first
  C.delivered = (acct, realm, kind, units) => {
    const co = C.of(acct);
    if (!co || co.realm !== realm || !(units > 0)) return null;
    const T = tally(co), worth = units * (kind === 'iron' ? 4 : kind === 'horses' ? 40 : kind === 'gold' ? 0.25 : 1);
    T.u += units; T.pts += worth / (hooks.unitsPerPoint() || 40);
    const b = (T.by[acct] = T.by[acct] || { u: 0, c: 0, d: day(), du: 0 });
    if (b.d !== day()) { b.d = day(); b.du = 0; }
    b.u += units; b.du += units;
    let res = null;
    if (co.pledge) {
      res = hooks.pledgeApply(realm, co.pledge, kind, units) || { moved: 0, voted: 0 };
      T.pl[co.pledge] = (T.pl[co.pledge] || 0) + units;
      if (res.moved) C.stats.pledgeMoved += res.moved;
      if (res.voted) C.stats.pledgeVoted += res.voted;
    }
    C.save();
    return { co: co.id, pledge: co.pledge, ...(res || {}) };
  };
  // a keep taken in the live war: each company with members about it counts it once, each member once
  C.captured = (accts, realm) => {
    const seen = new Set();
    for (const acct of accts) {
      const co = C.of(acct);
      if (!co || co.realm !== realm) continue;
      const T = tally(co), b = (T.by[acct] = T.by[acct] || { u: 0, c: 0, d: day(), du: 0 });
      b.c++;
      if (!seen.has(co.id)) { seen.add(co.id); T.caps++; T.pts += 2.5; line(co, '', 'The company takes a keep.'); }
    }
    if (seen.size) { C.stats.captures++; C.save(); }
    return [...seen];
  };
  // a member's company on its frame and nameplate (stamped by the server: a page cannot claim one)
  C.tag = (acct, realm) => { const co = C.of(acct); return co && co.realm === realm ? [co.name, co.dev, co.col[0], co.col[1]] : null; };
  C.standing = (realm) => Object.values(D.list).filter((co) => co.realm === realm).map((co) => { const T = tally(co); return { n: co.name, dev: co.dev, col: co.col, m: Object.keys(co.mem).length, pts: Math.round(T.pts * 10) / 10, u: Math.round(T.u), caps: T.caps, id: co.id }; }).sort((a, b) => b.pts - a.pts || b.m - a.m).slice(0, 12);
  C.membersOf = (coId) => (D.list[coId] ? Object.keys(D.list[coId].mem) : []);
  C.invitesOf = (acct) => (D.inv[acct] || []).filter((I) => D.list[I.co]).map((I) => { const co = D.list[I.co]; return { id: co.id, n: co.name, dev: co.dev, col: co.col, by: I.by, m: Object.keys(co.mem).length, at: I.at }; });
  // what a player is told: its company (roster with who is on, what each did today and this season), its chat, its
  // notice, its pledge, its tally; else its invitations; and the realm's companies' standing
  C.stateFor = (A, realm, online) => {
    const co = C.of(A.id), o = { guest: !!A.guest, standing: realm >= 0 ? C.standing(realm) : [], max: MAX_MEMBERS };
    if (!co) { o.invites = C.invitesOf(A.id); return o; }
    const T = tally(co), now = Date.now(), dd = day();
    o.co = {
      id: co.id, n: co.name, realm: co.realm, dev: co.dev, col: co.col, role: roleOf(co, A.id), pledge: co.pledge, notice: co.notice,
      pts: Math.round(T.pts * 10) / 10, u: Math.round(T.u), caps: T.caps, pl: T.pl,
      chat: co.chat.slice(-30),
      inv: Object.keys(co.inv).map((id) => nameOf(id)).slice(0, MAX_INVITES),
      mem: Object.entries(co.mem).map(([id, M]) => { const A2 = hooks.acct(id), b = T.by[id] || { u: 0, c: 0, d: dd, du: 0 }; return { id, n: A2 ? A2.name : '?', role: M.role, on: online.has(id) ? 1 : 0, ago: A2 ? Math.round((now - (A2.last || 0)) / 60000) : 0, du: b.d === dd ? Math.round(b.du) : 0, u: Math.round(b.u), c: b.c, r: hooks.realmOf(id) }; })
        .sort((a, b) => b.on - a.on || ({ cap: 0, off: 1, mem: 2 }[a.role] - { cap: 0, off: 1, mem: 2 }[b.role]) || b.u - a.u),
    };
    return o;
  };
  return C;
}

// read back as untrusted: everything checked, bounded, every string cleaned
function sanitize(o) {
  const D = { v: 1, seq: 0, list: coDict(), inv: coDict() };
  if (!o || typeof o !== 'object') return D;
  D.seq = Number.isFinite(o.seq) ? Math.max(0, Math.min(1e9, o.seq | 0)) : 0;
  const ok = (id) => typeof id === 'string' && /^[A-Za-z0-9_-]{2,40}$/.test(id) && !['__proto__', 'constructor', 'prototype'].includes(id);
  const keys = new Set();
  for (const [id, c] of Object.entries(o.list && typeof o.list === 'object' ? o.list : {}).slice(0, MAX_COS)) {
    if (!ok(id) || !c || typeof c !== 'object') continue;
    const name = coText(c.name, 24), realm = c.realm === 0 || c.realm === 1 || c.realm === 2 ? c.realm : -1;
    if (name.length < 3 || realm < 0) continue;
    const key = norm(name);
    if (keys.has(realm + ':' + key)) continue;
    const mem = coDict();
    for (const [a, M] of Object.entries(c.mem && typeof c.mem === 'object' ? c.mem : {}).slice(0, MAX_MEMBERS)) if (ok(a) && M && typeof M === 'object') mem[a] = { role: M.role === 'cap' || M.role === 'off' ? M.role : 'mem', j: Number.isFinite(M.j) ? M.j : 0 };
    if (!Object.keys(mem).length) continue;
    let cap = ok(c.cap) && mem[c.cap] ? c.cap : Object.keys(mem)[0];
    for (const a of Object.keys(mem)) if (mem[a].role === 'cap' && a !== cap) mem[a].role = 'off';
    mem[cap].role = 'cap';
    const col = Array.isArray(c.col) ? c.col.slice(0, 2).map((v) => (Number.isInteger(v) && v >= 0 && v < CO_TINCTURES ? v : 0)) : [0, 3];
    if (col.length < 2) col.push(3);
    const s = c.s && typeof c.s === 'object' && Number.isFinite(c.s.n) ? { n: c.s.n | 0, pts: num(c.s.pts, 1e9), u: num(c.s.u, 1e12), caps: num(c.s.caps, 1e6) | 0, by: coDict(), pl: coDict() } : null;
    if (s) {
      for (const [a, b] of Object.entries(c.s.by && typeof c.s.by === 'object' ? c.s.by : {}).slice(0, 200)) if (ok(a) && b && typeof b === 'object') s.by[a] = { u: num(b.u, 1e12), c: num(b.c, 1e6) | 0, d: num(b.d, 1e7) | 0, du: num(b.du, 1e12) };
      for (const [p, u] of Object.entries(c.s.pl && typeof c.s.pl === 'object' ? c.s.pl : {}).slice(0, 12)) if (/^[a-z]{2,16}$/.test(p)) s.pl[p] = num(u, 1e12);
    }
    const inv = coDict();
    for (const [a, t] of Object.entries(c.inv && typeof c.inv === 'object' ? c.inv : {}).slice(0, MAX_INVITES)) if (ok(a) && !mem[a]) inv[a] = num(t, 1e15);
    D.list[id] = {
      id, name, key, realm, dev: Number.isInteger(c.dev) && c.dev >= 0 && c.dev < CO_DEVICES ? c.dev : 0, col, cap, mem, inv,
      notice: c.notice && typeof c.notice === 'object' ? { x: coText(c.notice.x, 120), by: coText(c.notice.by, 24), at: num(c.notice.at, 1e15) } : { x: '', by: '', at: 0 },
      chat: Array.isArray(c.chat) ? c.chat.slice(-MAX_CHAT).filter((L) => Array.isArray(L) && L.length === 3).map((L) => [num(L[0], 1e15), coText(L[1], 24), coText(L[2], 140)]).filter((L) => L[2]) : [],
      pledge: typeof c.pledge === 'string' && /^[a-z]{2,16}$/.test(c.pledge) ? c.pledge : '',
      s, created: num(c.created, 1e15),
    };
    keys.add(realm + ':' + key);
  }
  // an account in two companies keeps the first
  const seen = new Set();
  for (const co of Object.values(D.list)) for (const a of Object.keys(co.mem)) { if (seen.has(a)) { delete co.mem[a]; if (co.cap === a) { const k = Object.keys(co.mem)[0]; if (k) { co.cap = k; co.mem[k].role = 'cap'; } } } seen.add(a); }
  for (const [id, co] of Object.entries(D.list)) if (!Object.keys(co.mem).length) delete D.list[id];
  // The account-side invitations are the source of truth. Rebuild the company
  // index so stale entries cannot fill a company's invite limit after a restart.
  for (const co of Object.values(D.list)) co.inv = coDict();
  for (const [a, L] of Object.entries(o.inv && typeof o.inv === 'object' ? o.inv : {}).slice(0, 20000)) {
    if (!ok(a) || !Array.isArray(L) || seen.has(a)) continue;
    const l = [], used = new Set();
    for (const I of L.slice(0, MAX_INV_ACCT)) {
      if (!I || typeof I !== 'object' || !ok(I.co) || used.has(I.co)) continue;
      const co = D.list[I.co];
      if (!co || Object.keys(co.inv).length >= MAX_INVITES) continue;
      const at = num(I.at, 1e15);
      l.push({ co: I.co, by: coText(I.by, 24), at });
      co.inv[a] = at; used.add(I.co);
    }
    if (l.length) D.inv[a] = l;
  }
  return D;
}
const num = (v, hi) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(hi, v)) : 0);
export { sanitize as coSanitize, norm as coNorm };

// a pledge taken into the season (loops's RS: src/08m_realm.js): while the pledged work is the realm's work at hand, the
// goods it uses go from the stores into its own stock (R.bank, which it draws first and which quickens it); while it is
// not, every 100 units are a vote for it (the realm's next work is its most-voted). The stand-in's RS takes no pledge.
export function coPledgeApply(S, realm, proj, good, units) {
  const M = S && S.M, RS = S && S.RS;
  if (!M || !RS || !M.RSM || !M.RSM_GOODS || !RS.realms || !RS.realms[realm]) return { moved: 0, voted: 0 };
  const R = RS.realms[realm], P = Object.hasOwn(M.RSM.projects, proj) ? M.RSM.projects[proj] : null, g = M.RSM_GOODS.indexOf(good);
  if (!P || !Array.isArray(R.s) || !Array.isArray(R.bank) || !R.proj) return { moved: 0, voted: 0 };
  if (proj !== 'walls' && R.proj[proj] >= P.max) return { moved: 0, voted: 0, built: 1 };
  if (R.act === proj) {
    if (!(g >= 0 && P.cost[g] > 0)) return { moved: 0, voted: 0 };
    const cap = Math.max(2 * P.cost[g], M.RSM.target[g]);
    const moved = Math.max(0, Math.min(units, R.s[g], cap - R.bank[g]));
    R.s[g] -= moved; R.bank[g] += moved; S.dirty = true;
    return { moved: Math.round(moved), voted: 0 };
  }
  const v = units / 100;
  R.votes = R.votes || {};
  R.votes[proj] = Math.min(1e4, (R.votes[proj] || 0) + v); S.dirty = true;
  return { moved: 0, voted: Math.round(v * 100) / 100 };
}
