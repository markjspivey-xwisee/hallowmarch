// [perf3] The weather shared (rung 1 and 2 of Multiplayer): weather2's systems (12c_weather2.js) were each page's own.
// Now the shard's host (the page longest in the room or the shard: netHostElect) tells its systems with its profile
// (`wx`: the wind, the air carried and every cell with its id, place, line, size, age and life: about 1 KB, refreshed
// every 6 s or when a system is born or gone or the wind turns), and every other page follows it: it makes no weather of
// its own (no spawn, no seed, no turn of the wind), takes the host's systems by id (a new one fading in over 12 s, one the
// host has not fading out over 15 s, the rest eased to the host's place, age and line over a few seconds, so nothing
// jumps) and steps them on between words as the host does (the same wind, so they keep together). A page that hears no
// word for 20 s (the host gone, or holding its weather: Always clear) makes its own again; the next host goes on from the
// sky it has. The server (server/server.js) keeps the host's last word with the shard's war, so the first host of a later
// session takes the sky up where it was (if it is under 20 minutes old). Lightning is each page's own (under the same
// storms), and so is the ground's wetness (from the same rain).
// The server does not step the systems itself: weather2's step reads realmAt, the season's odds, the hour and the shaders'
// uniforms (U), which live in the page; the host's page is the weather's keeper, as it is the war's.
const NWX = {
  snap: null, snapAt: 0, snapKey: '', seq: 0, // the host's word, cached
  last: '', lastAt: 0, // the word last taken (a follower)
  dFrom: 0, dS: 0, dOx: 0, dOz: 0,
  stats: { sent: 0, taken: 0, made: 0, eased: 0, gone: 0, follows: 0, unfollows: 0, resumed: 0 },
  EVERY: 6000, LOST: 20000, FIN: 12, FOUT: 15, EASE: 2.5,
};
const nwxR = (v, k) => Math.round(v * k) / k;
// the host's word (null while its weather is held: Always clear, a test's fixed weather)
function netWxObj() {
  if (wxHeld()) return null;
  if (WX.follow) netWxUnfollow(); // this page keeps the sky now
  const now = performance.now(), W = WX.wind;
  const key = WX.cells.map((c) => c.id).join(',') + '|' + nwxR(W.toFrom, 100) + '|' + nwxR(W.toS, 10);
  if (NWX.snap && key === NWX.snapKey && now - NWX.snapAt < NWX.EVERY) return NWX.snap;
  NWX.snapKey = key; NWX.snapAt = now;
  NWX.snap = {
    v: 1, k: ++NWX.seq,
    w: [nwxR(W.from, 1000), nwxR(W.s, 10), nwxR(W.toFrom, 1000), nwxR(W.toS, 10)], o: [Math.round(WX.off.x), Math.round(WX.off.z)],
    c: WX.cells.slice(0, 28).map((c) => [c.id, c.kind, Math.round(c.x), Math.round(c.z), nwxR(c.ang, 1000), Math.round(c.a), Math.round(c.b), Math.round(c.age), Math.round(c.life), nwxR(c.sp, 100), nwxR(c.precip, 100), c.realm]),
  };
  NWX.stats.sent++;
  return NWX.snap;
}
// a follower takes the host's word (resume: the first host of a session taking the kept sky: placed at once, its own)
function netWxTake(d, resume = false) {
  const now = performance.now();
  if (!d || typeof d !== 'object' || d.v !== 1 || !Array.isArray(d.c) || !GAME.started) {
    if (WX.follow && now - NWX.lastAt > NWX.LOST) netWxUnfollow();
    return;
  }
  const word = (d.k | 0) + ':' + d.c.length + ':' + (d.c[0] ? d.c[0][2] : '');
  if (!resume && word === NWX.last) { if (WX.follow && now - NWX.lastAt > NWX.LOST) netWxUnfollow(); return; }
  NWX.last = word; NWX.lastAt = now; NWX.stats.taken++;
  const num = (v, a, b, def) => (typeof v === 'number' && isFinite(v) ? clamp(v, a, b) : def);
  if (!resume && !WX.follow) NWX.stats.follows++;
  if (!resume) WX.follow = now;
  const W = WX.wind;
  if (Array.isArray(d.w)) {
    const from = num(d.w[0], -10, 10, W.from), s = num(d.w[1], 0, 30, W.s);
    W.toFrom = num(d.w[2], -10, 10, W.toFrom); W.toS = num(d.w[3], 0, 30, W.toS);
    if (resume) { W.from = from; W.s = s; } else { W.next = 1e9; NWX.dFrom = angDiff(W.from, from); NWX.dS = s - W.s; }
  }
  if (Array.isArray(d.o)) { const ox = num(d.o[0], -1e7, 1e7, WX.off.x), oz = num(d.o[1], -1e7, 1e7, WX.off.z); if (resume || Math.hypot(ox - WX.off.x, oz - WX.off.z) > 400) { WX.off.x = ox; WX.off.z = oz; NWX.dOx = NWX.dOz = 0; } else { NWX.dOx = ox - WX.off.x; NWX.dOz = oz - WX.off.z; } }
  const seen = new Set();
  let maxId = 0;
  for (const r of d.c.slice(0, 40)) {
    if (!Array.isArray(r) || !WX_KINDS[r[1]]) continue;
    const id = num(r[0], 1, 1e9, 0) | 0, x = num(r[2], -4000, 4000, NaN), z = num(r[3], -4000, 4000, NaN);
    if (!id || !isFinite(x) || !isFinite(z) || seen.has(id)) continue;
    seen.add(id); maxId = Math.max(maxId, id);
    const ang = num(r[4], -10, 10, 0), life = num(r[8], 30, 2000, 600), age = num(r[7], 0, life, 0);
    let c = WX.cells.find((q) => q.id === id && q.net);
    // a cell of this page's own with the host's id is given another (the ids are the host's from here on)
    const clash = !c && WX.cells.find((q) => q.id === id);
    if (clash) clash.id = 1e9 + WX.cells.indexOf(clash);
    if (c && c.kind === r[1]) {
      if (resume) { c.x = x; c.z = z; c.age = age; c.ang = ang; c.dx = c.dz = c.dAge = c.dAng = 0; }
      else { c.dx = x - c.x; c.dz = z - c.z; c.dAge = age - c.age; c.dAng = angDiff(c.ang, ang); }
      NWX.stats.eased++;
    } else {
      c = wxMake(r[1], x, z, { ang, realm: num(r[11], 0, 2, 0) | 0 });
      WX.stats.made--; WX.stats.kinds[r[1]]--;
      c.id = id; c.age = age; c.net = 1; c.dx = c.dz = c.dAge = c.dAng = 0; c.fin = resume ? 1 : 0;
      NWX.stats.made++;
    }
    c.a = num(r[5], 50, 2000, c.a); c.b = num(r[6], 50, 2000, c.b); c.life = Math.max(life, c.age + 1); c.sp = num(r[9], 0, 3, c.sp); c.precip = num(r[10], 0, 1.5, c.precip);
    c.gone = 0; c.fade = WX_KINDS[c.kind].fade;
    c.ca = Math.cos(c.ang); c.sa = Math.sin(c.ang); c.s = wxCellS(c);
  }
  WX.id = Math.max(WX.id, maxId + 1);
  // what the host has not: fades out (no cloud vanishes at once)
  for (const c of WX.cells) if (!seen.has(c.id) && !c.gone) { c.gone = 1; c.life = Math.min(c.life, c.age + NWX.FOUT); c.fade = Math.min(c.fade, NWX.FOUT); NWX.stats.gone++; }
  WX.seeded = true;
  if (resume) NWX.stats.resumed++;
}
// each step while following (from updateWeather2): the host's places eased in, the new systems faded in
function netWxStep(dt) {
  const k = 1 - Math.exp(-dt / NWX.EASE), W = WX.wind;
  if (performance.now() - WX.follow > NWX.LOST + 5000) { netWxUnfollow(); return; } // no word (the room gone quiet)
  W.next = 1e9;
  if (NWX.dFrom) { const s = NWX.dFrom * k; W.from += s; NWX.dFrom -= s; if (Math.abs(NWX.dFrom) < 1e-4) NWX.dFrom = 0; }
  if (NWX.dS) { const s = NWX.dS * k; W.s += s; NWX.dS -= s; if (Math.abs(NWX.dS) < 1e-3) NWX.dS = 0; }
  if (NWX.dOx || NWX.dOz) { const sx = NWX.dOx * k, sz = NWX.dOz * k; WX.off.x += sx; WX.off.z += sz; NWX.dOx -= sx; NWX.dOz -= sz; }
  for (const c of WX.cells) {
    if (c.fin !== undefined && c.fin < 1) c.fin = Math.min(1, c.fin + dt / NWX.FIN);
    if (c.dx || c.dz) { const sx = c.dx * k, sz = c.dz * k; c.x += sx; c.z += sz; c.dx -= sx; c.dz -= sz; }
    if (c.dAge) { const s = c.dAge * k; c.age = Math.max(0, c.age + s); c.dAge -= s; }
    if (c.dAng) { const s = c.dAng * k; c.ang += s; c.dAng -= s; c.ca = Math.cos(c.ang); c.sa = Math.sin(c.ang); }
  }
}
function netWxUnfollow() {
  WX.follow = 0; WX.wind.next = Math.min(WX.wind.next, 120); NWX.last = '';
  for (const c of WX.cells) if (c.fin !== undefined && c.fin < 1) c.fin = 1;
  NWX.stats.unfollows++;
}
// the first host of a session: the sky the server kept with the shard's war, if it is fresh
function netWxResume(w) {
  if (!w || !w.wx || WX.follow) return;
  if (Date.now() - netNum(w.wx.at || w.at, 0, 1e15) > 20 * 60e3) return;
  netWxTake(w.wx, true);
}
setTimeout(() => { if (window.__hm) window.__hm.netwx = { NWX, netWxObj, netWxTake, netWxStep, netWxUnfollow, netWxResume }; }, 0); // test hooks
