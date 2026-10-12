/* ================================================================== */
/* saves: a private per-player document, or this browser as fallback   */
/* ================================================================== */
const SAVE = { ref: null, backend: 'local', lsKey: 'hallowmarch.save.v1', timer: 0, chain: Promise.resolve(), lastBody: '', lastCore: '', loaded: null, wiping: false };

const withTimeout = (p, ms) => Promise.race([p, new Promise((res) => setTimeout(() => res(null), ms))]);
async function initSaveBackend() {
  try {
    const C = window.claude;
    if (!C || typeof C.use !== 'function') return null;
    const [db, user] = await Promise.all([C.use('db'), C.use('user')]);
    if (!db || !user) return null;
    const uid = await user.id();
    if (!uid) return null;
    return db.doc('data/users/' + uid + '/save');
  } catch (e) { return null; }
}
function readLocal() {
  try { const s = localStorage.getItem(SAVE.lsKey); return s ? JSON.parse(s) : null; } catch (e) { return null; }
}
function validSave(s) {
  if (!s || typeof s !== 'object' || s.v !== 1) return null;
  const c = s.char;
  if (c && !(typeof c.name === 'string' && c.realm >= 0 && c.realm <= 2 && CLASSES[c.cls] && c.level >= 1 && c.level <= LEVEL_CAP)) s.char = null;
  if (s.world && s.world.land && (typeof s.world.land !== 'object' || s.world.land.v !== 1)) delete s.world.land; // [worldstate] a land record we cannot read is dropped
  if (s.char && s.char.gift && typeof s.char.gift !== 'object') delete s.char.gift; // [gifts]
  if (s.char && s.char.x && (typeof s.char.x !== 'object' || Array.isArray(s.char.x))) delete s.char.x; // save parts (06d_goods.js)
  if (s.world && s.world.x && (typeof s.world.x !== 'object' || Array.isArray(s.world.x))) delete s.world.x;
  return s;
}
async function loadSave() {
  const ref = await withTimeout(initSaveBackend(), 12000);
  let remote = null, remoteOk = false;
  if (ref) {
    try {
      const snap = await withTimeout(ref.get(), 12000);
      if (snap) { remoteOk = true; if (snap.exists) remote = JSON.parse(JSON.stringify(snap.data())); }
    } catch (e) { /* unreadable: keep this session's progress in the browser instead */ }
  }
  // only write to the account copy once it has been read, so an existing save is never overwritten blind
  SAVE.ref = remoteOk ? ref : null;
  SAVE.backend = remoteOk ? 'db' : 'local';
  const local = readLocal();
  const s = validSave(remote || local);
  SAVE.loaded = s;
  if (s) { SAVE.lastBody = JSON.stringify({ ...s, savedAt: 0 }); SAVE.lastCore = coreKey(s); }
  return s;
}

function buildSave() {
  const P = GAME.player, prog = GAME.prog;
  const settings = { quality: quality.level, auto: quality.auto !== false, tod: tod.mode, sound: AUDIO.on, weather: WEATHER.mode };
  settings.music = MUSIC.vol; // [music] the score's volume, 0 to 1 (11b_music.js)
  const world = {
    keeps: WAR.keeps.map((K) => K.realm),
    relics: WAR.relics.map((r) => (r.state === 'temple' ? { at: r.at, slot: r.slot } : null)),
    campaign: campaignSaveData(), // [campaign] the campaign's number, clock and history (08g_campaign.js)
  };
  const land = landSave(); // [worldstate] felled trees, burnt ground, craters, burnt houses, breached walls (12b_worldstate.js)
  if (land) world.land = land;
  const wx = savePartsData('world'); // other systems' records of the world (06d_goods.js)
  if (wx) world.x = wx;
  if (!P || !prog) return { v: 1, char: null, settings, world };
  const b = prog.bounty;
  return {
    v: 1,
    char: {
      name: P.name, realm: P.faction, cls: P.cls, level: prog.level, xp: Math.round(prog.xp), rp: Math.round(prog.rp),
      kills: prog.kills, realmKills: prog.realmKills, deaths: prog.deaths, played: Math.round(prog.played),
      bounty: b ? { type: b.type, camp: b.camp, need: b.need, have: b.have, name: b.name, reward: b.reward, done: !!b.done, ...(b.risen ? { risen: 1 } : {}) /* [late2] a risen champion's bounty (10l_late.js) */ } : null,
      pos: P.alive ? (inDungeon(P) ? { x: Math.round(BARROW.out.x * 10) / 10, z: Math.round(BARROW.out.z * 10) / 10 } : { x: Math.round(P.x * 10) / 10, z: Math.round(P.z * 10) / 10 }) : null,
      gold: Math.round(INV.gold), potions: INV.potions,
      bag: INV.bag.map(packItem), eq: Object.fromEntries(SLOTS.filter((s) => INV.eq[s]).map((s) => [s, packItem(INV.eq[s])])),
      lore: loreSaveData(),
      gift: giftSaveData(), // [gifts] the realm ultimate's cooldown, when it is running (06c_gifts.js)
      x: savePartsData('char'), // goods and every other system's records for the character (06d_goods.js)
    },
    settings, world,
  };
}
function packItem(it) {
  const o = { id: it.id, slot: it.slot, name: it.name, base: it.base, q: it.q, lvl: it.lvl, st: it.st };
  if (it.vis) o.vis = it.vis;
  if (it.cls) o.cls = it.cls;
  if (it.tint) o.tint = it.tint.map((v) => Math.round(v * 1000) / 1000);
  if (it.glow) o.glow = it.glow;
  if (it.n > 1) o.n = it.n;
  if (it.mw) o.mw = 1; // [depth] a masterwork
  // feature/weather: wear travels with the item
  if (Number.isFinite(it.dur) && it.dur < 100) o.dur = Math.round(it.dur * 10) / 10;
  if (it.dirt > 0.005) o.dirt = Math.round(it.dirt * 1000) / 1000;
  if (it.blood > 0.005) o.blood = Math.round(it.blood * 1000) / 1000;
  return o;
}
// the parts that matter enough to justify a write on their own
function coreKey(s) {
  const c = s.char;
  // [worldstate] the land counts by what changed in it, not by its clocks ticking down; [gifts] the realm ultimate's cooldown is kept but is no reason to write
  let w = s.world && s.world.land ? { ...s.world, land: landKey(s.world.land) } : s.world;
  if (w && w.x) w = { ...w, x: savePartsKey(w.x, 'world') };
  return JSON.stringify([c && [c.name, c.realm, c.cls, c.level, c.xp, c.rp, c.kills, c.realmKills, c.deaths, c.bounty, c.gold, c.potions, (c.bag || []).map((i) => i.id + (i.n || '')), Object.values(c.eq || {}).map((i) => i.id + ':' + Math.ceil((i.dur ?? 100) / 10)), c.lore, savePartsKey(c.x, 'char')], s.settings, w]);
}
function saveSoon(delay = 2500) {
  if (SAVE.wiping) return;
  clearTimeout(SAVE.timer);
  SAVE.timer = setTimeout(() => saveNow(), delay);
}
function saveNow() {
  clearTimeout(SAVE.timer);
  // nothing to keep until a character is in the world (and never overwrite one from the title screen)
  if (SAVE.wiping || !GAME.ready || !GAME.player) return Promise.resolve();
  const s = buildSave();
  const body = JSON.stringify({ ...s, savedAt: 0 });
  if (body === SAVE.lastBody) return Promise.resolve();
  SAVE.lastBody = body;
  SAVE.lastCore = coreKey(s);
  s.savedAt = Date.now();
  // one write at a time: queue behind any write still in flight
  SAVE.chain = SAVE.chain.then(async () => {
    if (SAVE.ref) {
      try { await SAVE.ref.set(s); return; } catch (e) {
        if (e && (e.code === 'revoked' || e.code === 'not_granted' || e.code === 'invalid_argument' || e.code === 'capability_disabled')) { SAVE.ref = null; SAVE.backend = 'local'; }
        else { await new Promise((r) => setTimeout(r, 600 + Math.random() * 600)); try { await SAVE.ref.set(s); return; } catch (e2) { /* fall through */ } }
      }
    }
    try { localStorage.setItem(SAVE.lsKey, JSON.stringify(s)); } catch (e) { /* storage may be blocked */ }
  });
  return SAVE.chain;
}
// a slow heartbeat: writes only when something meaningful changed since the last write
setInterval(() => {
  if (!GAME.ready || !GAME.player || SAVE.wiping) return;
  const s = buildSave();
  if (coreKey(s) !== SAVE.lastCore) saveNow();
}, 40000);
window.addEventListener('pagehide', () => { if (GAME.player) saveNow(); });
document.addEventListener('visibilitychange', () => { if (document.hidden && GAME.player) saveNow(); });

function wipeSave() {
  SAVE.wiping = true;
  clearTimeout(SAVE.timer);
  SAVE.lastBody = ''; SAVE.lastCore = '';
  try { localStorage.removeItem(SAVE.lsKey); } catch (e) { /* ignore */ }
  SAVE.chain = SAVE.chain.then(async () => { if (SAVE.ref) { try { await SAVE.ref.delete(); } catch (e) { /* ignore */ } } }).finally(() => { SAVE.wiping = false; });
  return SAVE.chain;
}

/* restores the state of the war from a save (keep owners, hallows at rest) */
function applyWorldSave(w) {
  if (!w || !Array.isArray(w.keeps)) return;
  WAR.keeps.forEach((K, i) => {
    const r = w.keeps[i];
    if (!(r >= 0 && r <= 2) || r === K.realm) return;
    for (const id of K.guards) { const g = getEnt(id); if (g) removeEnt(g); }
    K.guards.clear();
    const L = getEnt(K.lord);
    if (L) removeEnt(L);
    K.lord = null;
    K.realm = r;
    setDoorState(K.door, true, 1);
    setSiteBanners(K.site, r);
    fillGarrison(K, true);
  });
  if (Array.isArray(w.relics)) {
    const used = new Set();
    WAR.relics.forEach((rel, i) => {
      const s = w.relics[i];
      if (!s || !(s.at >= 0 && s.at <= 2)) return;
      const slot = s.at === rel.realm ? 'home' : (s.slot === 't0' || s.slot === 't1' ? s.slot : 't0');
      const key = s.at + ':' + slot;
      if (used.has(key)) return;
      used.add(key);
      rel.state = 'temple'; rel.at = s.at; rel.from = s.at; rel.slot = slot; rel.carrier = null;
    });
  }
  updateRelicBonuses();
  applyCampaignSave(w.campaign); // [campaign] older saves have none: the first campaign starts fresh
  landApply(w.land); // [worldstate] older saves have none: the land starts untouched (12b_worldstate.js)
  savePartsLoad('world', w.x); // other systems' records of the world (06d_goods.js)
}
function applySettings(st) {
  if (!st) return;
  if (QUALITY_PRESETS[st.quality] && st.quality !== quality.level && !(IS_TOUCH && st.auto !== false)) setQuality(st.quality, st.auto !== false); // [phones] a phone left on auto keeps the phone's own pick (13q_lod.js)
  else quality.auto = st.auto !== false;
  if (['cycle', 'morning', 'golden', 'night'].includes(st.tod)) setTimeMode(st.tod);
  if (typeof st.sound === 'boolean') AUDIO.on = st.sound;
  if (Number.isFinite(st.music)) setMusicVolume(st.music); // [music] older saves have none: the default stays
  if (st.weather === 'clear' || st.weather === 'auto') setWeatherMode(st.weather);
}
