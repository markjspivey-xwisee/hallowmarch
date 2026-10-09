/* ================================================================== */
/* horses: summoned with a whistle, ridden at speed, lost when struck     */
/* ================================================================== */
const HORSE_COATS = [[0.4, 0.22, 0.12], [0.55, 0.3, 0.15], [0.66, 0.64, 0.6], [0.14, 0.12, 0.11], [0.62, 0.5, 0.33], [0.34, 0.19, 0.11], [0.5, 0.42, 0.36]];
ABILITIES.summon = { id: 'summon', name: 'Summon horse', icon: 'leap', level: 1, cost: 0, cd: 0, cast: 1.6, self: true, hidden: true, desc: '' };
const MOUNT_SPEED = 1.85;

function horseLook(e) {
  // the same rider always gets the same horse
  let h = 7;
  for (const ch of String(e.name || 'rider')) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const coat = HORSE_COATS[h % HORSE_COATS.length];
  const base = e.faction <= 2 ? REALMS[e.faction].rgb : [0.42, 0.36, 0.3];
  return { coat, cloth: base.map((v) => v * 0.82) };
}
function mountUp(e, quiet = false) {
  if (!e || !e.alive || e.mount) return;
  e.mount = horseLook(e);
  e.mountAnim = { phase: 0, amt: e.anim.amt || 0, q: 0 };
  if (!quiet || dist2(e.x, e.z, camera.position.x, camera.position.z) < 60 * 60) FX.dust(e.x, e.y, e.z, 12, [0.45, 0.4, 0.32]);
  if (e === GAME.player) { sfx('whinny'); uiLog('You swing up into the saddle.', 'sys'); }
}
function dismount(e, why = null) {
  if (!e || !e.mount) return;
  e.mount = null;
  if (dist2(e.x, e.z, camera.position.x, camera.position.z) < 60 * 60) FX.dust(e.x, e.y, e.z, 12, [0.45, 0.4, 0.32]);
  if (e === GAME.player) { if (why) uiLog(why, 'warn'); sfx('thud'); }
}
function toggleMount() {
  const P = GAME.player;
  if (!P || !P.alive || UI.modal) return;
  if (P.mount) { dismount(P); return; }
  if (P.casting) { if (P.casting.id !== 'summon') uiError('You are already casting'); return; }
  if (P.carrying != null) { uiError('A hallow-bearer cannot ride'); return; }
  if (inDungeon(P)) { uiError('There is no room for a horse down here'); return; }
  if (GAME.t < P.combatUntil) { uiError('You cannot call your horse in the heat of battle'); return; }
  if (isRooted(P)) { uiError('You cannot move'); return; }
  P.casting = { id: 'summon', t: 0, total: ABILITIES.summon.cast, targetId: null, gx: P.x, gz: P.z };
  sfx('whistle');
}
// the horse's own gait: its stride is longer than a walker's
function updateMountAnim(e, dt, sp) {
  const A = e.mountAnim;
  if (!A) return;
  const want = clamp(sp / 4.3, 0, 1.5);
  A.amt = lerp(A.amt, want, 1 - Math.exp(-dt * 6));
  A.phase = (A.phase + dt * sp * (TAU / 2) / beastStride('horse', A.amt)) % (TAU * 64);
  if (e === GAME.player && A.amt > 0.08) {
    const q = Math.floor(A.phase / (Math.PI / 2));
    if (q !== A.q) { A.q = q; sfx(A.amt > 1.05 ? 'hoofFast' : 'hoof'); }
  }
}
