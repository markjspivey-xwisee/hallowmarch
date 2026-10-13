/* [capture] The capture build (after version 17).
   What a game's marketing calls a capture build: the game itself with a mode for filming trailers and taking stills.
   It opens from the menu's Settings (Capture mode), with ` (backquote) or F8 in a game, or with #capture on the page's
   address (the mode opens once a game is up). While it is on:
   - the HUD is hidden, and the player is out of every frame and no foe's mark (`e.capHide`, asked by drawActors and
     isEnemy) unless "Show yourself" is on;
   - the camera is free: it flies (W A S D, E or Space up, Q or C down, Shift faster, Alt slower, a drag to look, the
     wheel for its pace and Shift with the wheel for the lens), orbits a point (`orbit`), follows a body (`follow`), or
     plays a path of keyframes (`path`: K adds one, P plays them, Catmull-Rom through them at an even pace, eased at its
     ends); its moves are eased by the Smoothing setting;
   - the world's clock can be frozen or slowed (F, [ and ]: tick's dt is scaled, `captureDt`; the camera keeps its own
     clock, so a path plays on over a frozen world); the time of day, the weather, the season and the graphics are set
     from the panel;
   - shots (`CAP_SHOTS`) stage a scene of the March and play a camera move through it: the same shots tools/film.py
     films for the trailer, deterministically (`__hm.capture.step`);
   - a still is taken from the canvas (cropped to the bars when they are up), a clip recorded from it with the game's
     own sound (MediaRecorder): both are shown on the page to be saved (a sandboxed page cannot start a download);
   - nothing is saved (12_save.js asks `CAPTURE.on`): leaving keeps the world as it is, or puts it back as it was by
     loading the page again.
   Hooks (marked [capture]): tick's clock and camera (13_main.js), drawActors and isEnemy (`capHide`), saveNow, the
   Settings row (10_ui.js). Test hooks __hm.capture; tools/tests/capture.py, tools/film.py. */

const CAP_TOD = { dawn: 2.72, morning: 0.28, day: 0.42, after: 0.62, golden: 1.0, dusk: 1.6, night: 2.1 };
const CAP_SEASON = { spring: 0.125, summer: 0.375, autumn: 0.625, winter: 0.875 };
const CAP_RATES = [[0, 'Freeze'], [0.1, '1/10'], [0.25, '1/4'], [0.5, '1/2'], [1, '1×'], [2, '2×']];
const CAP_BARS = [[0, 'None'], [16 / 9, '16:9'], [2.39, '2.39:1'], [1, '1:1'], [9 / 16, '9:16']];
const CAPTURE = {
  on: false, want: /capture/i.test(location.hash + location.search), k: 1, rdt: 1 / 60, t: 0,
  mode: 'free', hideMe: true, bars: 0, grid: false, panel: true, ease: true,
  cam: { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, roll: 0, fov: 55 },
  aim: { yaw: 0, pitch: 0 }, vel: [0, 0, 0], speed: 8, smooth: 0.55,
  orbit: { x: 0, y: 0, z: 0, r: 20, h: 6, a: 0, w: 0.12 },
  follow: { id: null, ox: 5, oy: 1.8, oz: -5, ly: 1.2, lz: 0, k: 3, yaw: null, fixed: false },
  keys: [], play: false, loop: false, pt: 0, dur: 8,
  shot: null, act: null, made: [], held: new Set(), drag: null, pinch: null,
  rec: null, prev: null, el: null, out: null,
  stats: { opened: 0, shots: 0, keys: 0, stills: 0, clips: 0, plays: 0 },
};

/* ------------------------------------------------------------------ */
/* the clock and the camera (from tick, 13_main.js)                    */
/* ------------------------------------------------------------------ */
// tick's dt: unchanged while the mode is off; while it is on, scaled by the world's rate (a frozen world still draws:
// its clock moves a ten-thousandth of a second a frame, so nothing divides by nothing). The shot's own hook runs first
function captureDt(dt) {
  const C = CAPTURE;
  if (!C.on) {
    if (C.want && GAME.started && GAME.player && !UI.modal) { C.want = false; captureOpen(); }
    return dt;
  }
  C.rdt = dt;
  const w = C.k > 0 ? dt * C.k : 1e-4;
  if (C.act) { try { C.act(C.t, w); } catch (err) { reportError(err); C.act = null; } }
  C.t += w;
  if (GAME.player) capHidePlayer();
  return w;
}
// after updateCamera: the capture camera places itself (CAM.mode is 'fixed', so the play camera left it alone)
function captureCamera() {
  const C = CAPTURE;
  if (!C.on) return;
  const dt = Math.min(C.rdt, 0.1);
  if (C.play && C.keys.length >= 2) capPathStep(dt);
  else if (C.mode === 'orbit') capOrbitStep(dt);
  else if (C.mode === 'follow') capFollowStep(dt);
  else capFlyStep(dt);
  capApply();
}
const capLag = () => lerp(18, 1.4, CAPTURE.smooth);
const capHeld = (...ks) => ks.some((k) => CAPTURE.held.has(k));
function capFlyStep(dt) {
  const C = CAPTURE, c = C.cam;
  const f = (capHeld('KeyW', 'ArrowUp', 'pad-f') ? 1 : 0) - (capHeld('KeyS', 'ArrowDown', 'pad-b') ? 1 : 0);
  const s = (capHeld('KeyD', 'ArrowRight', 'pad-r') ? 1 : 0) - (capHeld('KeyA', 'ArrowLeft', 'pad-l') ? 1 : 0);
  const u = (capHeld('KeyE', 'Space', 'pad-u') ? 1 : 0) - (capHeld('KeyQ', 'KeyC', 'pad-d') ? 1 : 0);
  const sp = C.speed * (capHeld('ShiftLeft', 'ShiftRight') ? 4 : 1) * (capHeld('AltLeft', 'AltRight') ? 0.25 : 1);
  const cy = Math.cos(c.yaw), sy = Math.sin(c.yaw), cp = Math.cos(c.pitch), spt = Math.sin(c.pitch);
  // forward along the view, sideways on the level, up straight up
  const tx = (-sy * cp * f + cy * s) * sp, ty = (spt * f + u) * sp, tz = (-cy * cp * f - sy * s) * sp;
  const k = 1 - Math.exp(-dt * capLag()), v = C.vel;
  v[0] += (tx - v[0]) * k; v[1] += (ty - v[1]) * k; v[2] += (tz - v[2]) * k;
  c.x += v[0] * dt; c.y += v[1] * dt; c.z += v[2] * dt;
  capTurn(dt);
  capKeepAbove(c);
}
// the view turns toward where the mouse or the finger points it, eased
function capTurn(dt) {
  const C = CAPTURE, c = C.cam, k = 1 - Math.exp(-dt * capLag() * 1.5);
  c.yaw += (C.aim.yaw - c.yaw) * k;
  c.pitch += (C.aim.pitch - c.pitch) * k;
}
function capKeepAbove(c) {
  if (c.x > 1000) return; // (the Barrow's halls: its own floors, and roofs over them)
  const g = heightAt(c.x, c.z) + 0.25;
  if (c.y < g) c.y = g;
}
function capOrbitStep(dt) {
  const C = CAPTURE, O = C.orbit, c = C.cam;
  // W and S bring it in and out, E and Q up and down, A and D turn it faster one way or the other
  const f = (capHeld('KeyW', 'ArrowUp', 'pad-f') ? 1 : 0) - (capHeld('KeyS', 'ArrowDown', 'pad-b') ? 1 : 0);
  const u = (capHeld('KeyE', 'Space', 'pad-u') ? 1 : 0) - (capHeld('KeyQ', 'KeyC', 'pad-d') ? 1 : 0);
  const s = (capHeld('KeyD', 'ArrowRight', 'pad-r') ? 1 : 0) - (capHeld('KeyA', 'ArrowLeft', 'pad-l') ? 1 : 0);
  O.r = Math.max(1.5, O.r - f * C.speed * 0.6 * dt);
  O.h += u * C.speed * 0.4 * dt;
  O.a += (O.w + s * 0.5) * dt;
  const tx = O.x + Math.sin(O.a) * O.r, tz = O.z + Math.cos(O.a) * O.r, ty = O.y + O.h, k = 1 - Math.exp(-dt * capLag());
  c.x += (tx - c.x) * k; c.y += (ty - c.y) * k; c.z += (tz - c.z) * k;
  capKeepAbove(c);
  capAimAt(c, O.x, O.y, O.z);
  capTurn(dt);
}
function capFollowStep(dt) {
  const C = CAPTURE, F0 = C.follow, c = C.cam, e = F0.id != null ? getEnt(F0.id) : null;
  const tgt = e && !e.removed ? e : null;
  if (!tgt) { capFlyStep(dt); return; }
  // the body's heading, eased (a dragon's banking and a rider's turns would shake the shot)
  const want = tgt.yaw || 0;
  if (F0.yaw == null) F0.yaw = want;
  F0.yaw += angleDiff(want, F0.yaw) * (1 - Math.exp(-dt * 2.5));
  const yw = F0.fixed ? 0 : F0.yaw, fx = Math.sin(yw), fz = Math.cos(yw), rx = Math.cos(yw), rz = -Math.sin(yw);
  const ty0 = tgt.y + (tgt.scale || 1) * 0;
  const px = tgt.x + fx * F0.oz + rx * F0.ox, pz = tgt.z + fz * F0.oz + rz * F0.ox, py = ty0 + F0.oy;
  const k = 1 - Math.exp(-dt * F0.k);
  c.x += (px - c.x) * k; c.y += (py - c.y) * k; c.z += (pz - c.z) * k;
  capKeepAbove(c);
  capAimAt(c, tgt.x + fx * F0.lz, ty0 + F0.ly, tgt.z + fz * F0.lz);
  c.yaw = C.aim.yaw; c.pitch = C.aim.pitch;
}
const angleDiff = (a, b) => { let d = (a - b) % TAU; if (d > Math.PI) d -= TAU; if (d < -Math.PI) d += TAU; return d; };
// the yaw and pitch that look from c to a point (three's camera: yaw 0 looks along -z), the yaw kept near the last one
function capAimAt(c, x, y, z) {
  const dx = x - c.x, dy = y - c.y, dz = z - c.z;
  const yaw = Math.atan2(-dx, -dz), A = CAPTURE.aim;
  A.yaw = c.yaw + angleDiff(yaw, c.yaw);
  A.pitch = Math.atan2(dy, Math.hypot(dx, dz));
}
function capApply() {
  const c = CAPTURE.cam;
  camera.position.set(c.x, c.y, c.z);
  camera.rotation.set(c.pitch, c.yaw, c.roll);
  if (Math.abs(camera.fov - c.fov) > 1e-3) { camera.fov = c.fov; camera.updateProjectionMatrix(); capFocal(); }
}
// the particles' size follows the lens (resize() works it out for the play camera's)
function capFocal() {
  const focal = (view.h * quality.dprActual) / (2 * Math.tan((camera.fov * DEG) / 2));
  for (const m of [fxAdd.mesh.material, fxAlpha.mesh.material, glowMesh.material, fireflyMat]) m.uniforms.uFocal.value = focal;
}
// the player is kept out of the frame (and out of every foe's eye: isEnemy) unless the panel says to show it
function capHidePlayer() {
  const P = GAME.player;
  P.capHide = CAPTURE.hideMe;
  if (P.capHide) { P.target = null; if (P.hp < P.maxHp) P.hp = P.maxHp; }
}

/* ------------------------------------------------------------------ */
/* the camera path                                                     */
/* ------------------------------------------------------------------ */
// a key: where the camera is and how it looks
const capKeyOf = (c) => ({ x: c.x, y: c.y, z: c.z, yaw: c.yaw, pitch: c.pitch, roll: c.roll || 0, fov: c.fov || 55 });
// a key from a place and a point it looks at
function capKey(x, y, z, tx, ty, tz, fov = 50, roll = 0) {
  const c = { x, y, z, yaw: 0, pitch: 0 };
  const dx = tx - x, dy = ty - y, dz = tz - z;
  c.yaw = Math.atan2(-dx, -dz); c.pitch = Math.atan2(dy, Math.hypot(dx, dz));
  return { x, y, z, yaw: c.yaw, pitch: c.pitch, roll, fov };
}
// each key's yaw within half a turn of the one before (so the path turns the short way)
function capUnwrap(K) { for (let i = 1; i < K.length; i++) K[i].yaw = K[i - 1].yaw + angleDiff(K[i].yaw, K[i - 1].yaw); return K; }
function capAddKey() {
  const C = CAPTURE, k = capKeyOf(C.cam);
  if (C.keys.length) k.yaw = C.keys[C.keys.length - 1].yaw + angleDiff(k.yaw, C.keys[C.keys.length - 1].yaw);
  C.keys.push(k);
  C.stats.keys++;
  capToast(`Key ${C.keys.length} set`);
  capRender();
}
const capCR = (p0, p1, p2, p3, t) => {
  const t2 = t * t, t3 = t2 * t;
  return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
};
// where the path is at u (0..1): an even pace along it (by the chords between keys, a turn on the spot counted as
// metres), eased in and out at its ends
function capPathAt(u, out) {
  const K = CAPTURE.keys, n = K.length;
  if (n === 1) { Object.assign(out, K[0]); return out; }
  const e = CAPTURE.ease ? u * u * u * (u * (u * 6 - 15) + 10) : u;
  const L = [0];
  for (let i = 1; i < n; i++) {
    const a = K[i - 1], b = K[i];
    const d = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z) + 6 * (Math.abs(b.yaw - a.yaw) + Math.abs(b.pitch - a.pitch)) + 0.2 * Math.abs(b.fov - a.fov);
    L.push(L[i - 1] + Math.max(0.05, d));
  }
  const s = e * L[n - 1];
  let i = 0;
  while (i < n - 2 && L[i + 1] < s) i++;
  const t = clamp((s - L[i]) / (L[i + 1] - L[i]), 0, 1);
  const p0 = K[Math.max(0, i - 1)], p1 = K[i], p2 = K[i + 1], p3 = K[Math.min(n - 1, i + 2)];
  for (const f of ['x', 'y', 'z', 'yaw', 'pitch', 'roll', 'fov']) out[f] = capCR(p0[f], p1[f], p2[f], p3[f], t);
  return out;
}
function capPathStep(dt) {
  const C = CAPTURE;
  C.pt += dt;
  if (C.pt >= C.dur) {
    if (C.loop) C.pt %= C.dur;
    else { C.pt = C.dur; C.play = false; capRender(); }
  }
  capPathAt(C.pt / C.dur, C.cam);
  C.aim.yaw = C.cam.yaw; C.aim.pitch = C.cam.pitch; C.vel = [0, 0, 0];
}
function capPlay(on = !CAPTURE.play) {
  const C = CAPTURE;
  if (on && C.keys.length < 2) { capToast('Set two keys or more first (K)'); return; }
  C.play = on;
  if (on) { C.pt = 0; C.stats.plays++; }
  capRender();
}

/* ------------------------------------------------------------------ */
/* opening and leaving                                                 */
/* ------------------------------------------------------------------ */
function captureOpen() {
  const C = CAPTURE;
  if (C.on) return true;
  if (!GAME.started || !GAME.player) return false;
  if (UI.modal === 'menu') closeMenu();
  else if (UI.modal) return false;
  C.prev = { fov: camera.fov, tod: { mode: tod.mode, p: tod.p, fixedP: tod.fixedP }, wmode: WEATHER.mode, auto: quality.auto };
  C.on = true; C.stats.opened++;
  UI.modal = 'capture';
  CAM.mode = 'fixed';
  quality.auto = false;
  // the camera starts where the play camera was
  const c = C.cam, e = new THREE.Euler().setFromQuaternion(camera.quaternion, 'YXZ');
  c.x = camera.position.x; c.y = camera.position.y; c.z = camera.position.z;
  c.yaw = e.y; c.pitch = e.x; c.roll = 0; c.fov = camera.fov;
  C.aim.yaw = c.yaw; C.aim.pitch = c.pitch; C.vel = [0, 0, 0];
  $('hud').hidden = true;
  capBuild();
  capRender();
  capHidePlayer();
  capToast(IS_TOUCH ? 'Capture mode: drag to look, the pad to fly' : 'Capture mode: W A S D to fly, drag to look, H hides the panel');
  return true;
}
function captureClose(restore = false) {
  const C = CAPTURE;
  if (!C.on) return;
  if (C.rec) capRecStop();
  // put back as it was: the page loads again from the last save (nothing has been saved since capture opened, and the
  // mode stays on until then, so the page's own save as it goes does not write the staged world)
  if (restore) { location.reload(); return; }
  capClear();
  C.on = false; C.play = false; C.k = 1; C.held.clear();
  const P = GAME.player;
  if (P) P.capHide = false;
  if (C.el) C.el.hidden = true;
  if (C.bars0) C.bars0.hidden = true;
  UI.modal = null;
  CAM.mode = 'play';
  quality.auto = C.prev ? C.prev.auto : quality.auto;
  if (C.prev) { tod.mode = C.prev.tod.mode; tod.fixedP = C.prev.tod.fixedP; }
  resize(); // the play camera's lens and the particles' size
  $('hud').hidden = !GAME.started;
  HUDL.k = 0;
}

/* ------------------------------------------------------------------ */
/* the world: time, weather, season, rate                              */
/* ------------------------------------------------------------------ */
function capTod(p) {
  if (typeof p === 'string') p = CAP_TOD[p];
  if (!(p >= 0)) return;
  tod.p = p; tod.fixedP = p; tod.mode = 'fixed';
  applyTimeOfDay(p);
}
function capSeason(k) {
  if (typeof k === 'string') k = CAP_SEASON[k];
  if (!(k >= 0)) return;
  SEASON.t = clamp(k, 0, 0.9999) * SEASON.yearSec; seasonCalc(); SEASON.announced = SEASON.idx;
  seasonSettle();
}
// the weather held as it is set (WEATHER.mode 'fixed': no change comes)
function capWeather(kind) {
  const Wt = WEATHER;
  Wt.mode = 'fixed'; Wt.next = 1e9; Wt.storm = 0; Wt.mist = 0; Wt.raining = 0; Wt.snowing = 0;
  if (kind === 'clear' || kind === 'haze') {
    Wt.kind = 'clear'; Wt.wet = 0; Wt.snow = 0; Wt.overcast = 0; Wt.fog = kind === 'haze' ? 0.35 : 0; Wt.target = 0; Wt.w = 0;
    U.uWet.value = 0;
  } else if (kind === 'rain' || kind === 'storm') {
    Wt.kind = kind; Wt.raining = 1; Wt.wet = 1; Wt.overcast = 1; Wt.fog = kind === 'storm' ? 1 : 0.7; Wt.storm = kind === 'storm' ? 1 : 0;
  } else if (kind === 'snow') {
    // a winter's snow: lying, and falling where it is cold enough (else a grey sky)
    if (SEASON.t / SEASON.yearSec < 0.76) capSeason('winter');
    const c = CAPTURE.on ? CAPTURE.cam : camera.position, cold = farmTempAt(c.x, c.z) < 1.5;
    Wt.kind = cold ? 'rain' : 'cloudy'; Wt.raining = cold ? 1 : 0; Wt.snow = 1; Wt.wet = 0; Wt.overcast = 0.9; Wt.fog = cold ? 0.7 : 0.25;
  } else if (kind === 'mist') {
    Wt.kind = 'mist'; Wt.overcast = 0.45; Wt.fog = 1; Wt.mist = 1; Wt.wet = 0;
  } else if (kind === 'auto') {
    Wt.mode = 'auto'; Wt.next = 5;
  }
  CAPTURE.weather = kind;
}
// a bolt from the sky onto the tallest thing near a point (a tree or a roof takes fire from it), or at random round the view
function capLightning(x, z) {
  if (x == null) { const c = CAPTURE.cam, f = 60; x = c.x - Math.sin(c.yaw) * f; z = c.z - Math.cos(c.yaw) * f; }
  if (typeof strikeNear === 'function' && strikeNear(x, z, 0, 45)) return true;
  strikeLightning(x, z);
  return false;
}

/* ------------------------------------------------------------------ */
/* staging: the world runs on without being drawn, bodies placed       */
/* ------------------------------------------------------------------ */
// the world runs on `sec` seconds without being drawn, its clocks kept together (the particles' clock is the frames':
// what is emitted while it runs is born when it happens, not in the frames' future)
function capRun(sec, step = 0.05) {
  const n = Math.max(1, Math.round(sec / step));
  for (let i = 0; i < n; i++) {
    if (CAPTURE.act) { try { CAPTURE.act(CAPTURE.t, step); } catch (err) { reportError(err); CAPTURE.act = null; } }
    CAPTURE.t += step;
    try { simStep(step); } catch (err) { reportError(err); }
    renderTime += step; U.uTime.value = renderTime;
    for (let j = AOE_MARKS.length - 1; j >= 0; j--) if (AOE_MARKS[j].until < GAME.t) AOE_MARKS.splice(j, 1);
  }
  try { updateWeather(step); } catch (err) { /* the weather's look eases in at the next frame */ }
}
// everything the last shot made goes; the Barrow is left
function capClear() {
  const C = CAPTURE;
  for (const e of C.made) if (e && !e.removed) removeEnt(e);
  C.made = []; C.act = null; C.t = 0; C.shot = null;
  if (C.indoor) { setIndoor(false); C.indoor = false; }
  if (C.player) { const P = GAME.player, q = C.player; P.x = P.prevX = q.x; P.z = P.prevZ = q.z; P.y = q.y; P.motion = null; C.player = null; }
}
// bodies that stand where a shot wants a clear frame go (not doors, engines or the player)
function capHush(x, z, r = 40) {
  for (const e of ENT.slice()) if (e.alive && e.kind !== 'door' && e.role !== 'player' && !e.siegeEngine && e.kind !== 'dragon' && dist(e.x, e.z, x, z) < r) removeEnt(e);
}
// the hidden player waits near what is filmed (the grass's trail, the bodies' shade and the things that think only near
// the player follow it); where it stood is put back when the shot is cleared
function capPlayerTo(x, z, y) {
  const C = CAPTURE, P = GAME.player;
  if (!C.player) C.player = { x: P.x, y: P.y, z: P.z };
  if (P.mount) { try { dismount(P); } catch (err) { /* not mounted */ } }
  P.x = P.prevX = x; P.z = P.prevZ = z; P.y = y ?? heightAt(x, z); P.motion = null; P.vy = 0; P.casting = null; P.target = null;
}
// open, level, walkable ground near (cx, cz), clear of trees, colliders and water by `clear` m
function capOpen(cx, cz, clear = 4, maxR = 80, flat = 0.8) {
  for (let k = 0; k < 3000; k++) {
    const a = k * 2.39996, r = Math.sqrt(k) * 1.5, x = cx + Math.sin(a) * r, z = cz + Math.cos(a) * r;
    if (r > maxR) break;
    if (!isWalkable(x, z) || waterAt(x, z)) continue;
    if (Math.abs(heightAt(x + 3, z) - heightAt(x - 3, z)) + Math.abs(heightAt(x, z + 3) - heightAt(x, z - 3)) > flat) continue;
    if (W.trees.some((t) => !t.gone && !t.felled && Math.abs(t.x - x) < clear && Math.abs(t.z - z) < clear)) continue;
    if (COLL.boxes.some((c) => c.active !== false && Math.abs(c.x - x) < clear + (c.hx || 1) + 1 && Math.abs(c.z - z) < clear + (c.hz || 1) + 1)) continue;
    if (COLL.circles.some((c) => c.active !== false && Math.hypot(c.x - x, c.z - z) < clear + c.r)) continue;
    return { x, z };
  }
  return null;
}
// a soldier of a realm standing (or walking to) where it is put, made for the shot
function capUnit(realm, cls, x, z, yaw, post) {
  const e = spawnRealmUnit(realm, cls, warLevel(), 'guard', x, z, { yaw });
  e.ai.post = post || { x, z, leash: 1 };
  e.yaw = yaw;
  CAPTURE.made.push(e);
  return e;
}
// nothing solid, no tree and no water within `clear` m of (x, z), on walkable ground
const _capNear = [];
function capClearAt(x, z, clear = 3) {
  if (!isWalkable(x, z) || waterAt(x, z)) return false;
  collidersNear(x, z, clear + 3, _capNear);
  for (const c of _capNear) {
    if (c.active === false || c.hollow) continue;
    if (c.type === 'circle' ? dist(c.x, c.z, x, z) < c.r + clear : Math.abs(c.x - x) < (c.hx || 1) + clear && Math.abs(c.z - z) < (c.hz || 1) + clear) return false;
  }
  return true;
}
// a straight lane of open, nearly level ground `len` m long near (cx, cz), with a strip `side` m to its left clear too
// (where a camera running beside it goes): its middle and its heading
function capLane(cx, cz, len, side = 0, clear = 2.5) {
  const trees = W.trees.filter((t) => !t.gone && !t.felled && Math.abs(t.x - cx) < 260 && Math.abs(t.z - cz) < 260);
  const treeFree = (x, z) => !trees.some((t) => Math.abs(t.x - x) < clear + 1 && Math.abs(t.z - z) < clear + 1);
  for (let k = 0; k < 500; k++) {
    const a = k * 2.39996, r = Math.sqrt(k) * 4, x = cx + Math.sin(a) * r, z = cz + Math.cos(a) * r;
    if (!capClearAt(x, z, clear)) continue;
    for (let d = 0; d < 8; d++) {
      const yaw = (d * TAU) / 8, ux = Math.sin(yaw), uz = Math.cos(yaw), lx = Math.cos(yaw), lz = -Math.sin(yaw);
      let ok = true, h0 = null;
      for (let t = -len / 2; t <= len / 2 && ok; t += 2) {
        for (const o of side ? [0, side * 0.5, side] : [0]) {
          const px = x + ux * t + lx * o, pz = z + uz * t + lz * o;
          if (!capClearAt(px, pz, clear) || !treeFree(px, pz)) { ok = false; break; }
          const h = heightAt(px, pz);
          if (o === 0) { if (h0 !== null && Math.abs(h - h0) > 0.45) { ok = false; break; } h0 = h; }
        }
      }
      if (ok) return { x, z, yaw };
    }
  }
  return null;
}
const capSw = (S, lx, lz) => siteToWorld(S, lx, lz);
const capAhead = (x, z, yaw, d) => ({ x: x + Math.sin(yaw) * d, z: z + Math.cos(yaw) * d });
const capYawTo = (x, z, tx, tz) => Math.atan2(tx - x, tz - z);
const capGround = (x, z) => (typeof floorAt === 'function' ? floorAt(x, z, heightAt(x, z) + 30) : heightAt(x, z));
const capTownHouses = (r) => HOUSES.filter((h) => h.realm === r && !h.keepHall && h.state === 'whole').sort((a, b) => dist(a.x, a.z, REALMS[r].town.x, REALMS[r].town.z) - dist(b.x, b.z, REALMS[r].town.x, REALMS[r].town.z));

/* ------------------------------------------------------------------ */
/* the shots: a scene of the March staged, and a camera move through it */
/* ------------------------------------------------------------------ */
// Each shot: its name and line (the panel and the trailer use them), its time of day, season and weather, how long its
// camera move takes, `need` (why it cannot be staged in this world now, or nothing) and `set` (stages the scene and
// returns the camera: { keys } a path, { follow } a body, { orbit } a point; `act(t, dt)` runs each step of the world).
// A shot changes the world it is staged in (a house set alight burns as any other; a band sent against a keep fights on)
const CAP_SHOTS = [
  {
    id: 'lonetree', name: 'The Lone Tree', line: 'The hill at the heart of the March, where the three realms meet', tod: 'golden', season: 'summer', weather: 'clear', dur: 5,
    set() {
      const T = W.heroTree, gy = heightAt(T.x, T.z);
      capPlayerTo(T.x + 3, T.z + 3);
      capHush(T.x, T.z, 30);
      return { keys: [capKey(T.x + 17, gy + 0.9, T.z + 9, T.x, gy + 5.2, T.z, 44), capKey(T.x + 11, gy + 3.2, T.z + 14, T.x, gy + 6.2, T.z, 46), capKey(T.x + 4, gy + 8.5, T.z + 15, T.x - 14, gy + 5, T.z - 40, 50)] };
    },
  },
  {
    id: 'logres', name: 'Brackenford', line: 'Logres: stone keeps and timbered towns under slate', tod: 'golden', season: 'summer', weather: 'clear', dur: 5,
    set() {
      const R = REALMS[0], S = R.town, gy = heightAt(S.x, S.z);
      const p = (d, l, h) => ({ x: S.x - R.dx * d + R.px * l, z: S.z - R.dz * d + R.pz * l, y: gy + h });
      const a = p(84, 34, 24), b = p(52, 16, 13);
      capPlayerTo(S.x, S.z);
      return { keys: [capKey(a.x, a.y, a.z, S.x, gy + 1, S.z, 44), capKey(b.x, b.y, b.z, S.x + R.px * 4, gy + 2, S.z + R.pz * 4, 46)] };
    },
  },
  {
    id: 'eriu', name: 'Glenrua', line: 'Ériu: roundhouses, raths and the green glens', tod: 'after', season: 'summer', weather: 'haze', dur: 5,
    set() {
      const R = REALMS[1], S = R.town, hs = capTownHouses(1), h = hs[3] || hs[0];
      const out = capYawTo(S.x, S.z, h.x, h.z), a = capAhead(h.x, h.z, out + Math.PI + 0.35, 26), b = capAhead(h.x, h.z, out + Math.PI + 0.15, 19);
      capPlayerTo(a.x, a.z);
      return { keys: [capKey(a.x, capGround(a.x, a.z) + 1.8, a.z, h.x, h.y + 2.4, h.z, 48), capKey(b.x, capGround(b.x, b.z) + 2.8, b.z, h.x, h.y + 3.2, h.z, 50)] };
    },
  },
  {
    id: 'thule', name: 'Skarvik', line: 'Thule: log burhs and longhouses in the northern snow', tod: 'day', season: 'winter', weather: 'clear', dur: 5,
    set() {
      const R = REALMS[2], S = R.town, gy = heightAt(S.x, S.z);
      const p = (d, l, h) => ({ x: S.x - R.dx * d + R.px * l, z: S.z - R.dz * d + R.pz * l, y: gy + h });
      const a = p(70, -30, 18), b = p(44, -14, 8);
      capPlayerTo(S.x, S.z);
      return { keys: [capKey(a.x, a.y, a.z, S.x, gy + 2, S.z, 46), capKey(b.x, b.y, b.z, S.x - R.px * 4, gy + 3, S.z - R.pz * 4, 48)] };
    },
  },
  {
    id: 'callings', name: 'Four callings', line: 'Warrior, archer, mage and priest, in each realm\'s own way', tod: 'after', season: 'summer', weather: 'clear', dur: 5,
    set() {
      const m = REALMS[0].musterSite, sp = capOpen(m.x + 30, m.z, 8, 90);
      if (!sp) return null;
      capHush(sp.x, sp.z, 26);
      const face = 0.3, lx = Math.cos(face), lz = -Math.sin(face), cls = ['warrior', 'archer', 'mage', 'priest'];
      for (let r = 0; r < 3; r++) cls.forEach((c, i) => {
        const off = (r - 1) * 5.6 + (i - 1.5) * 1.3, x = sp.x + lx * off, z = sp.z + lz * off;
        const e = capUnit(r, c, x, z, face);
        e.faction = FACTION_NEUTRAL; // (for the shot: three realms side by side, at peace)
      });
      capPlayerTo(sp.x - Math.sin(face) * 6, sp.z - Math.cos(face) * 6);
      capRun(0.8);
      for (const e of CAPTURE.made) e.yaw = face;
      const at = (off, d, h) => ({ x: sp.x + lx * off + Math.sin(face) * d, z: sp.z + lz * off + Math.cos(face) * d, y: heightAt(sp.x, sp.z) + h });
      const a = at(-9, 4.4, 1.62), b = at(9, 4.4, 1.62), ta = at(-6, 0, 1.3), tb = at(6, 0, 1.3);
      return { keys: [capKey(a.x, a.y, a.z, ta.x, ta.y, ta.z, 42), capKey(b.x, b.y, b.z, tb.x, tb.y, tb.z, 42)] };
    },
  },
  {
    id: 'clash', name: 'Lines meet', line: 'Logres and Thule close on the frontier', tod: 'after', season: 'summer', weather: 'clear', dur: 4.5, pre: 1.6,
    set() {
      const m = REALMS[1].musterSite, sp = capOpen(m.x + 34, m.z - 20, 14, 140, 1.4);
      if (!sp) return null;
      capHush(sp.x, sp.z, 60);
      const dir = 0.6, ux = Math.sin(dir), uz = Math.cos(dir), lx = Math.cos(dir), lz = -Math.sin(dir);
      const line = (realm, side) => {
        const kinds = ['warrior', 'warrior', 'warrior', 'archer', 'archer', 'mage'];
        kinds.forEach((c, i) => {
          const back = c === 'warrior' ? 0 : 4.5, lat = c === 'warrior' ? (i - 1) * 2.2 : (i - 4) * 2.6;
          const x = sp.x - ux * side * (13 + back) + lx * lat, z = sp.z - uz * side * (13 + back) + lz * lat;
          const tx = sp.x + ux * side * 6 + lx * lat, tz = sp.z + uz * side * 6 + lz * lat;
          const e = capUnit(realm, c, x, z, capYawTo(x, z, tx, tz), { x: tx, z: tz, leash: 30 });
          e.hp = e.maxHp = e.maxHp * 4;
        });
      };
      line(0, 1); line(2, -1);
      capPlayerTo(sp.x - lx * 30, sp.z - lz * 30);
      const at = (u, l, h) => ({ x: sp.x + ux * u + lx * l, z: sp.z + uz * u + lz * l, y: heightAt(sp.x, sp.z) + h });
      const a = at(-11, 8.5, 1.5), b = at(-5, 9, 2.2), t1 = at(-3, 0, 1.2), t2 = at(1, 0, 1.0);
      return { keys: [capKey(a.x, a.y, a.z, t1.x, t1.y, t1.z, 48), capKey(b.x, b.y, b.z, t2.x, t2.y, t2.z, 48)] };
    },
  },
  {
    id: 'siege', name: 'The trebuchet', line: 'A Thule band\'s trebuchet throws at a Logres keep', tod: 'golden', season: 'summer', weather: 'clear', dur: 5,
    need() { return WAR.keeps.some((K) => K.realm === 0) ? '' : 'Logres holds no keep for Thule to besiege'; },
    set() {
      const K = WAR.keeps.find((q) => q.realm === 0 && q.site === REALMS[0].keepSites[0]) || WAR.keeps.find((q) => q.realm === 0);
      const S = K.site, gy = heightAt(S.x, S.z);
      SIEGE.force = 'trebuchet';
      const g = siegeGatePoint(S), wb = spawnWarband(2, 10), x0 = g.x + g.nx * 95, z0 = g.z + g.nz * 95;
      wbMembers(wb).forEach((e, i) => { e.x = e.prevX = x0 + (i % 4) * 1.6 - 2.4; e.z = e.prevZ = z0 + Math.floor(i / 4) * 1.6; e.y = heightAt(e.x, e.z); });
      wbSetOrder(wb, { type: 'attack', keep: K, why: 'claim' });
      capPlayerTo(x0 + g.nz * 30, z0 - g.nx * 30);
      // the band plans its engine; it is set up at its place at once (as siege.py's pictures do), its crew at the windlass
      // and the rest of the band behind it; then it is held until a stone is about to fly
      let E = null;
      for (let s = 0; s < 40 && !E; s++) { capRun(0.5); E = wb.order && wb.order.siegeE != null ? siegeById(wb.order.siegeE) : null; }
      SIEGE.force = null;
      if (!E || E.kind !== 'trebuchet') {
        const Cs = castleOf(S), Wc = Cs && Cs.sections.find((q) => q.kind !== 'tower' && q.state === 'whole');
        if (!Wc) return null;
        const f = siegeFace(Wc);
        E = siegeCreate('trebuchet', 2, f.x + f.nx * 62, f.z + f.nz * 62, Math.atan2(-f.nx, -f.nz), { C: Cs, W: Wc });
        wbMembers(wb).slice(0, 4).forEach((m, i) => siegeAddCrew(E, m, i));
        E.wb = wb;
      }
      E.build = 1; E.x = E.work.x; E.z = E.work.z; E.state = 'work'; E.ph = 'wind'; E.arm = Math.PI / 2;
      siegeSettle(E);
      for (const m of wbMembers(wb)) if (!m.siegeCrew) { m.x = m.prevX = E.x + (Math.random() - 0.5) * 8 - Math.sin(E.yaw) * 7; m.z = m.prevZ = E.z + (Math.random() - 0.5) * 8 - Math.cos(E.yaw) * 7; }
      for (const id of E.crew) { const c = getEnt(id), q = c && siegeSlot(E, c.siegeSlot); if (q) { c.x = c.prevX = q.x; c.z = c.prevZ = q.z; } }
      for (let s = 0; s < 600 && !(E.ph === 'load' && E.pt > 1.3); s++) capRun(0.05);
      capPlayerTo(E.x, E.z);
      GAME.player.capHide = true;
      const L = (lx, ly, lz) => siegeLocal(E, lx, ly, lz);
      const a = L(-15, 2.4, -6), b = L(-19, 5.5, -15), ta = L(0, 5.5, 2), tb = { x: S.x, y: gy + 6, z: S.z };
      return { keys: [capKey(a.x, a.y, a.z, ta.x, ta.y, ta.z, 50), capKey(b.x, b.y, b.z, tb.x, tb.y, tb.z, 46)] };
    },
  },
  {
    id: 'storm', name: 'Storm over the keep', line: 'Thunder on the March: lightning strikes what stands tallest', tod: 'after', season: 'autumn', weather: 'storm', dur: 5,
    set() {
      const S = REALMS[0].keepSites[0], gy = heightAt(S.x, S.z), a = capSw(S, 30, 66), b = capSw(S, 22, 52);
      capPlayerTo(S.x + 6, S.z + 6);
      let n = 0;
      return {
        keys: [capKey(a.x, heightAt(a.x, a.z) + 9, a.z, S.x, gy + 6, S.z, 50), capKey(b.x, heightAt(b.x, b.z) + 7, b.z, S.x, gy + 7, S.z, 50)],
        act(t) { if ((n === 0 && t > 1.1) || (n === 1 && t > 3.2)) { n++; capLightning(S.x, S.z); } },
      };
    },
  },
  {
    id: 'housefire', name: 'Fire in the night', line: 'A house burns: its people run to beat the flames out', tod: 'night', season: 'summer', weather: 'clear', dur: 5, pre: 4,
    set() {
      const hs = capTownHouses(0), h = hs.find((q) => !q.big && q.door) || hs[0];
      if (!h) return null;
      const o = h.door.out2 || h.door.out, n = Math.atan2(o.x - h.x, o.z - h.z);
      const a = capAhead(o.x, o.z, n + 0.4, 12), b = capAhead(o.x, o.z, n + 0.25, 8.5);
      capPlayerTo(a.x, a.z);
      igniteHouse(h);
      HCREW.off = true; capRun(11); HCREW.off = false;
      return { keys: [capKey(a.x, capGround(a.x, a.z) + 1.7, a.z, h.x, h.y + 2.6, h.z, 50), capKey(b.x, capGround(b.x, b.z) + 1.5, b.z, h.x, h.y + 3.0, h.z, 52)] };
    },
  },
  {
    id: 'palisade', name: 'The burh burns', line: 'A Thule palisade alight at night, its garrison at the flames', tod: 'night', season: 'summer', weather: 'clear', dur: 5, pre: 4,
    set() {
      palisadeInit();
      const S = REALMS[2].keepSites[0], C = castleOf(S);
      if (!C || !C.pal) return null;
      const cells = C.pal.cells.filter((c) => c.side === 3 && c.st === 0 && c.a < 0).sort((p, q) => p.a - q.a);
      const c0 = cells[Math.floor(cells.length * 0.55)];
      if (!c0) return null;
      const i0 = cells.indexOf(c0);
      for (let i = Math.max(0, i0 - 2); i <= Math.min(cells.length - 1, i0 + 2); i++) palisadeIgnite(cells[i], 0.95);
      const L = (along, out, y) => { const l = palisadeLocal(3, along, out), p = siteToWorld(S, l.x, l.z); return { x: p.x, y: S.y + y, z: p.z }; };
      const a = L(c0.a + 9, 21, 4.2), b = L(c0.a + 5, 15, 3.4), t = L(c0.a, 0, 3.2);
      capPlayerTo(a.x, a.z);
      return { keys: [capKey(a.x, a.y, a.z, t.x, t.y, t.z, 50), capKey(b.x, b.y, b.z, t.x, t.y + 0.4, t.z, 52)] };
    },
  },
  {
    id: 'cinderwing', name: 'Cinderwing', line: 'The dragon of the March on the wing', tod: 'golden', season: 'summer', weather: 'clear', dur: 5,
    need() { const D = DRAGON; return D.e && D.e.alive && !D.e.removed ? '' : 'Cinderwing is not in the sky now'; },
    set() {
      const D = DRAGON, e = D.e;
      if (D.state !== 'fly') setDragonState('fly');
      D.stateT = 0; D.flyFor = 1e4;
      capPlayerTo(e.x, e.z);
      return { follow: { id: e.id, ox: -22, oy: -3, oz: 14, ly: 1.5, lz: 0, k: 4 } };
    },
  },
  {
    id: 'gallop', name: 'At the gallop', line: 'Horses gathered into their stride over the meadow', tod: 'golden', season: 'summer', weather: 'clear', dur: 4,
    set() {
      const m = REALMS[2].musterSite, ln = capLane(m.x + 40, m.z + 10, 76, -9);
      if (!ln) return null;
      const sp = ln, ux = Math.sin(ln.yaw), uz = Math.cos(ln.yaw), lx = Math.cos(ln.yaw), lz = -Math.sin(ln.yaw);
      capHush(sp.x, sp.z, 50);
      const mk = (x, z, cols) => {
        const e = makeEnt({ kind: 'horse', faction: FACTION_NEUTRAL, role: 'test', name: 'horse', level: 5, x, z, y: heightAt(x, z), radius: 0.4, look: { colA: cols[0], colB: cols[1] }, scale: 1 });
        e.yaw = Math.PI / 2; e.prevX = e.x; e.prevZ = e.z;
        CAPTURE.made.push(e);
        return e;
      };
      const a = mk(sp.x - ux * 34 + lx * 1.4, sp.z - uz * 34 + lz * 1.4, [[0.36, 0.22, 0.12], [0.1, 0.08, 0.06]]), b = mk(sp.x - ux * 33 - lx * 1.8, sp.z - uz * 33 - lz * 1.8, [[0.66, 0.6, 0.52], [0.2, 0.17, 0.14]]);
      a.yaw = b.yaw = ln.yaw;
      for (let j = -40; j <= 40; j += 1.5) natureCut(sp.x + ux * j, sp.z + uz * j, 3.5, 1, false);
      capPlayerTo(sp.x, sp.z + 12);
      return {
        follow: { id: a.id, ox: -8.5, oy: 0.9, oz: 0.5, ly: 1.0, lz: 1.5, k: 6 },
        act(t, dt) { const k = Math.min(1, t / 0.6); a.x += ux * 11 * k * dt; a.z += uz * 11 * k * dt; b.x += ux * 11.6 * k * dt; b.z += uz * 11.6 * k * dt; a.yaw = b.yaw = ln.yaw; },
      };
    },
  },
  {
    id: 'pyres', name: 'The Hall of Pyres', line: 'Beneath the Barrow: pitch that catches and runs with fire', tod: 'golden', season: 'summer', weather: 'clear', dur: 5, pre: 4.5,
    need() { return DEEP.built && DEEP.opened ? '' : 'Break the seal beneath the Hollow King\'s hall first'; },
    set() {
      const p = dunPoint(140, 39);
      capPlayerTo(p.x, p.z, p.y);
      if (!INDOOR.on) { setIndoor(true); CAPTURE.indoor = true; }
      for (const c of DEEP.cells) if (c.hall === 'pyres') c.ch = 0;
      const lit = DEEP.cells.filter((c) => c.hall === 'pyres' && c.st === 0 && Math.abs(dunU(c.x) - 123) < 4 && Math.abs(dunV(c.z) - 49) < 4);
      for (const c of lit.slice(0, 6)) deepIgnite(c, null);
      const a = dunPoint(141, 38.2), b = dunPoint(133, 41.5);
      return { keys: [capKey(a.x, -12.4, a.z, dunWX(121), -18.2, dunWZ(52), 54), capKey(b.x, -14.6, b.z, dunWX(119), -18.0, dunWZ(51), 54)] };
    },
  },
  {
    id: 'throne', name: 'The Ash Throne', line: 'Vorlach the Ash-Crowned, asleep on the throne of the first kings', tod: 'golden', season: 'summer', weather: 'clear', dur: 5, pre: 2,
    need() { return DEEP.built && DEEP.opened ? (getEnt(DEEP.lord) ? '' : 'The Ash-Crowned is not on his throne now') : 'Break the seal beneath the Hollow King\'s hall first'; },
    set() {
      const p = dunPoint(70, 48.5);
      capPlayerTo(p.x, p.z, p.y);
      if (!INDOOR.on) { setIndoor(true); CAPTURE.indoor = true; }
      const lit = DEEP.cells.filter((c) => c.hall === 'ashhall' && c.st === 0);
      for (let i = 0; i < lit.length; i += 5) deepIgnite(lit[i], null);
      const K = getEnt(DEEP.lord), ky = K ? K.y : p.y;
      const a = dunPoint(47, 46.5), b = dunPoint(36, 47.8);
      return { keys: [capKey(a.x, ky + 2.4, a.z, dunWX(23), ky + 3.4, dunWZ(48.5), 50), capKey(b.x, ky + 1.6, b.z, dunWX(23), ky + 3.6, dunWZ(48.5), 46)] };
    },
  },
  {
    id: 'risen', name: 'The risen', line: 'Past level 40 a risen champion breaks the ground under its foe', tod: 'golden', season: 'summer', weather: 'clear', dur: 4.5,
    need() { return CAMPS.some((c) => late2Risen(c)) ? '' : 'The risen come for a character of level 40 and more'; },
    set() {
      const camp = CAMPS.find((c) => late2Risen(c) && c.type === 'bandit') || CAMPS.find((c) => late2Risen(c));
      let C = getEnt(camp.eliteId);
      if (!C || !C.alive) { spawnMob(camp, true); C = getEnt(camp.eliteId); }
      if (!C) return null;
      for (const id of [...camp.members]) { const m = getEnt(id); if (m && m !== C) { m.damagers = null; killEnt(m, null); removeEnt(m); } }
      for (const o of ENT.slice()) if (o.alive && o !== C && o.kind !== 'door' && o.role !== 'player' && !o.siegeEngine && dist(o.x, o.z, C.x, C.z) < 30) removeEnt(o);
      const a = Math.atan2(camp.x - C.x, camp.z - C.z) + Math.PI, fx = C.x + Math.sin(a) * 2.2, fz = C.z + Math.cos(a) * 2.2;
      const foe = capUnit(0, 'warrior', fx, fz, Math.atan2(C.x - fx, C.z - fz), { x: fx, z: fz, leash: 0.3 });
      foe.hp = foe.maxHp = 1e9;
      C.hp = C.maxHp; C.buffs.length = 0; C.target = foe.id; C.threat = new Map([[foe.id, 99]]);
      C.ai.l2 = { next: GAME.t + 0.9, next2: 1e9, rally: true, enr: false, w: null, last: GAME.t };
      capPlayerTo(C.x + 22, C.z - 22);
      const m = { x: (C.x + fx) / 2, z: (C.z + fz) / 2 }, gy = heightAt(m.x, m.z);
      const c1 = capAhead(m.x, m.z, a + 1.1, 10), c2 = capAhead(m.x, m.z, a + 0.7, 8);
      return { keys: [capKey(c1.x, gy + 3.4, c1.z, m.x, gy + 0.8, m.z, 50), capKey(c2.x, gy + 2.6, c2.z, m.x, gy + 0.9, m.z, 50)] };
    },
  },
  {
    id: 'standard', name: 'Your standard', line: 'A veteran planted the standard of its name, in the mantle of its deeds', tod: 'golden', season: 'summer', weather: 'clear', dur: 6,
    need() { return LATE2.std && LATE2.std.made ? '' : 'Make the standard of your name first (from level 40, on the Deeds page)'; },
    set() {
      const T = W.heroTree, sp = capOpen(T.x + 16, T.z - 12, 6, 60) || { x: T.x + 16, z: T.z - 12 };
      capHush(sp.x, sp.z, 20);
      const P = GAME.player;
      capPlayerTo(sp.x, sp.z);
      P.yaw = 0.7;
      late2StdPlant();
      capRun(1.0);
      P.yaw = 0.7 + 2.4;
      CAPTURE.showMe = true;
      const gy = heightAt(sp.x, sp.z);
      return { orbit: { x: sp.x, y: gy + 1.4, z: sp.z, r: 6.5, h: 0.6, a: 0.7 + 2.0, w: 0.16 } };
    },
  },
  {
    id: 'orchard', name: 'The year turns', line: 'The Logres orchard and the mountains through the seasons', tod: 'day', season: 'autumn', weather: 'clear', dur: 5,
    set() {
      // look5's orchard view: from among the apple trees toward the mountains over the town (09s_survival.js FORAGE.orchard)
      const o = FORAGE.orchard, R = REALMS[0], yaw = R.bearing - 0.55, c = capAhead(o.x, o.z, yaw, -6), gy = heightAt(c.x, c.z);
      const t = capAhead(o.x, o.z, yaw, 140), a = capAhead(c.x, c.z, yaw + Math.PI / 2, -2.5), b = capAhead(c.x, c.z, yaw + Math.PI / 2, 2.5);
      capPlayerTo(c.x, c.z);
      return { keys: [capKey(a.x, gy + 1.8, a.z, t.x, gy + 14, t.z, 52), capKey(b.x, gy + 2.2, b.z, t.x, gy + 15, t.z, 52)] };
    },
  },
];
const capShotOf = (id) => CAP_SHOTS.find((s) => s.id === id) || null;
// stage a shot: the last one cleared, its time, season and weather, its scene; then its camera move from the start
function captureShot(id, o = {}) {
  const C = CAPTURE, s = capShotOf(id);
  if (!s) return { error: 'no such shot' };
  if (!C.on && !captureOpen()) return { error: 'no game' };
  const why = s.need ? s.need() : '';
  if (why) { capToast(why); return { error: why }; }
  capClear();
  C.play = false; C.mode = 'free'; C.k = o.k ?? 1; C.showMe = false;
  if (o.season || s.season) capSeason(o.season || s.season);
  capTod(o.tod || s.tod);
  capWeather(o.weather || s.weather);
  if (s.fog != null && !o.weather) WEATHER.fog = s.fog;
  C.shot = s.id;
  let r = null;
  try { r = s.set(o); } catch (err) { reportError(err); r = null; }
  if (!r) { capToast(`${s.name} cannot be staged here now`); C.shot = null; return { error: 'not staged' }; }
  C.act = r.act || null;
  if (s.pre) capRun(s.pre);
  // a winter shot's snow: the weather's own check of the cold reads where the camera will be
  if ((o.weather || s.weather) === 'snow' && r.keys) { C.cam.x = r.keys[0].x; C.cam.z = r.keys[0].z; capWeather('snow'); if (s.fog != null && !o.weather) WEATHER.fog = s.fog; }
  C.hideMe = !C.showMe;
  C.dur = o.dur || s.dur || 5;
  if (r.keys) { C.keys = capUnwrap(r.keys); C.mode = 'path'; C.pt = 0; C.play = o.hold ? false : true; capPathAt(0, C.cam); C.aim.yaw = C.cam.yaw; C.aim.pitch = C.cam.pitch; }
  else if (r.follow) {
    Object.assign(C.follow, { ox: 5, oy: 1.8, oz: -5, ly: 1.2, lz: 0, k: 3, fixed: false }, r.follow, { yaw: null });
    C.mode = 'follow';
    const e = getEnt(C.follow.id);
    if (r.follow.side && e) { C.follow.ox = r.follow.side * 1; C.follow.oz = 0; C.follow.lz = 1.5; }
    if (e) { const yw = e.yaw || 0; C.cam.x = e.x + Math.sin(yw) * C.follow.oz + Math.cos(yw) * C.follow.ox; C.cam.y = e.y + C.follow.oy; C.cam.z = e.z + Math.cos(yw) * C.follow.oz - Math.sin(yw) * C.follow.ox; }
  } else if (r.orbit) {
    Object.assign(C.orbit, r.orbit);
    C.mode = 'orbit';
    const O = C.orbit;
    C.cam.x = O.x + Math.sin(O.a) * O.r; C.cam.y = O.y + O.h; C.cam.z = O.z + Math.cos(O.a) * O.r;
    capAimAt(C.cam, O.x, O.y, O.z); C.cam.yaw = C.aim.yaw; C.cam.pitch = C.aim.pitch;
  }
  C.cam.fov = r.keys ? C.cam.fov : (r.fov || 50);
  C.stats.shots++;
  capApply();
  capRender();
  return { shot: s.id, name: s.name, mode: C.mode, dur: C.dur, keys: C.keys.length };
}

/* ------------------------------------------------------------------ */
/* stills and clips                                                    */
/* ------------------------------------------------------------------ */
// the frame in the bars (or the whole canvas): x, y, w, h in the canvas's pixels
function capFrameRect() {
  const W0 = canvas.width, H0 = canvas.height, r = CAPTURE.bars;
  if (!r) return { x: 0, y: 0, w: W0, h: H0 };
  if (W0 / H0 > r) { const w = Math.round(H0 * r); return { x: Math.round((W0 - w) / 2), y: 0, w, h: H0 }; }
  const h = Math.round(W0 / r);
  return { x: 0, y: Math.round((H0 - h) / 2), w: W0, h };
}
// a still: a frame drawn now (the canvas's own buffer is cleared once it is shown) and taken in the same task
function captureStill(type = 'image/png') {
  try { tick(1e-4); } catch (err) { reportError(err); }
  const R = capFrameRect();
  let url;
  if (R.w === canvas.width && R.h === canvas.height) url = canvas.toDataURL(type, 0.95);
  else {
    const c2 = document.createElement('canvas'); c2.width = R.w; c2.height = R.h;
    c2.getContext('2d').drawImage(canvas, R.x, R.y, R.w, R.h, 0, 0, R.w, R.h);
    url = c2.toDataURL(type, 0.95);
  }
  CAPTURE.stats.stills++;
  return url;
}
function capShowStill() {
  const url = captureStill();
  capOut(`<img src="${url}" alt="A still from the March">`, url, `hallowmarch-${CAPTURE.shot || 'still'}-${Date.now() % 1e6}.png`);
}
// a clip: the canvas as a stream (and the game's own sound, from after its limiter) recorded until Stop
function capRecStart() {
  const C = CAPTURE;
  if (C.rec || typeof MediaRecorder === 'undefined' || !canvas.captureStream) { if (!C.rec) capToast('This browser cannot record the canvas'); return; }
  const stream = canvas.captureStream(30);
  let dest = null;
  try { if (AUDIO.ctx && AUDIO.lim) { dest = AUDIO.ctx.createMediaStreamDestination(); AUDIO.lim.connect(dest); for (const t of dest.stream.getAudioTracks()) stream.addTrack(t); } } catch (err) { dest = null; }
  const mime = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4'].find((m) => MediaRecorder.isTypeSupported(m)) || '';
  let r;
  try { r = new MediaRecorder(stream, mime ? { mimeType: mime, videoBitsPerSecond: 12e6 } : undefined); } catch (err) { capToast('This browser cannot record the canvas'); return; }
  const chunks = [];
  r.ondataavailable = (ev) => { if (ev.data && ev.data.size) chunks.push(ev.data); };
  r.onstop = () => {
    if (dest) { try { AUDIO.lim.disconnect(dest); } catch (err) { /* already gone */ } }
    const blob = new Blob(chunks, { type: r.mimeType || 'video/webm' }), url = URL.createObjectURL(blob);
    C.stats.clips++;
    capOut(`<video src="${url}" controls autoplay loop playsinline></video>`, url, `hallowmarch-${C.shot || 'clip'}-${Date.now() % 1e6}.${/mp4/.test(blob.type) ? 'mp4' : 'webm'}`);
    C.rec = null;
    capRender();
  };
  r.start(500);
  C.rec = { r, t0: performance.now() };
  // a shot's camera move from its start, recorded whole
  if (C.keys.length >= 2 && C.mode === 'path') { C.pt = 0; C.play = true; }
  capRender();
}
function capRecStop() { const C = CAPTURE; if (C.rec && C.rec.r.state !== 'inactive') C.rec.r.stop(); }
// what was taken, on the page: a sandboxed page cannot start a download, so the image or the clip is shown to be saved
// from the browser's own menu (and the link works where the page runs on its own)
function capOut(html, url, name) {
  const O = CAPTURE.out;
  if (!O) return;
  O.innerHTML = `<div class="cap-o-in">${html}<p>${IS_TOUCH ? 'Press and hold it to save it.' : 'Right-click it to save it.'} <a href="${url}" download="${esc(name)}">Save</a></p><button type="button" class="cap-b" data-c="outclose">Close</button></div>`;
  O.hidden = false;
}

/* ------------------------------------------------------------------ */
/* input                                                               */
/* ------------------------------------------------------------------ */
// keys while the mode is on are the capture camera's (the game's own keys are held off: capture phase, stopped)
window.addEventListener('keydown', (e) => {
  const C = CAPTURE, k = e.code;
  const t = document.activeElement;
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
  if (!C.on) {
    if ((k === 'Backquote' || k === 'F8') && GAME.started && GAME.player && (!UI.modal || UI.modal === 'menu')) { e.preventDefault(); e.stopImmediatePropagation(); captureOpen(); }
    return;
  }
  e.stopImmediatePropagation();
  if (['Space', 'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'F8', 'Backquote'].includes(k)) e.preventDefault();
  C.held.add(k);
  if (e.repeat) return;
  if (k === 'Escape' || k === 'Backquote' || k === 'F8') { if (C.out && !C.out.hidden) C.out.hidden = true; else if (!C.panel) capPanel(true); else captureClose(); return; }
  if (k === 'KeyH') capPanel(!C.panel);
  else if (k === 'KeyK') capAddKey();
  else if (k === 'KeyP') capPlay();
  else if (k === 'KeyF') capRate(C.k > 0 ? 0 : 1);
  else if (k === 'BracketLeft') capRate(capStepRate(-1));
  else if (k === 'BracketRight') capRate(capStepRate(1));
  else if (k === 'KeyO') capMode('orbit');
  else if (k === 'KeyG') { C.grid = !C.grid; capRender(); }
  else if (k === 'KeyB') { const i = CAP_BARS.findIndex((b) => b[0] === C.bars); C.bars = CAP_BARS[(i + 1) % CAP_BARS.length][0]; capRender(); }
  else if (k === 'KeyX') capShowStill();
  else if (k === 'KeyR' && !e.ctrlKey && !e.metaKey) { if (C.rec) capRecStop(); else capRecStart(); }
  else if (k === 'KeyZ') { C.cam.roll = 0; capRender(); }
}, true);
window.addEventListener('keyup', (e) => { if (CAPTURE.on) { CAPTURE.held.delete(e.code); e.stopImmediatePropagation(); } }, true);
window.addEventListener('blur', () => CAPTURE.held.clear());
const capStepRate = (d) => { const i = CAP_RATES.findIndex((r) => r[0] === CAPTURE.k); return CAP_RATES[clamp((i < 0 ? 4 : i) + d, 0, CAP_RATES.length - 1)][0]; };
function capRate(k) { CAPTURE.k = k; capRender(); }
function capMode(m) {
  const C = CAPTURE, c = C.cam;
  C.play = false;
  if (m === 'orbit') {
    // round the point the view meets the ground (within 200 m), else 25 m ahead
    const fx = -Math.sin(c.yaw) * Math.cos(c.pitch), fy = Math.sin(c.pitch), fz = -Math.cos(c.yaw) * Math.cos(c.pitch);
    let d = 25;
    for (let s = 2; s < 200; s += 1.5) { const x = c.x + fx * s, y = c.y + fy * s, z = c.z + fz * s; if (y < heightAt(x, z)) { d = s; break; } }
    const O = C.orbit; O.x = c.x + fx * d; O.y = c.y + fy * d; O.z = c.z + fz * d;
    O.r = Math.max(2, Math.hypot(c.x - O.x, c.z - O.z)); O.h = c.y - O.y; O.a = Math.atan2(c.x - O.x, c.z - O.z);
  } else if (m === 'follow') {
    // the body nearest the middle of the view within 80 m (yourself if you are shown)
    let best = null, bs = 1e9;
    const fx = -Math.sin(c.yaw), fz = -Math.cos(c.yaw);
    for (const e of ENT) {
      if (!e.alive || e.removed || e.kind === 'door' || (e.role === 'player' && C.hideMe)) continue;
      const dx = e.x - c.x, dz = e.z - c.z, d = Math.hypot(dx, dz);
      if (d > 80 || d < 1) continue;
      const along = (dx * fx + dz * fz) / d;
      if (along < 0.8) continue;
      const s = (1 - along) * 60 + d * 0.05;
      if (s < bs) { bs = s; best = e; }
    }
    if (!best) { capToast('Nothing to follow in the middle of the view'); return; }
    const yw = best.yaw || 0, dx = c.x - best.x, dz = c.z - best.z;
    Object.assign(C.follow, { id: best.id, ox: dx * Math.cos(yw) - dz * Math.sin(yw), oz: dx * Math.sin(yw) + dz * Math.cos(yw), oy: c.y - best.y, ly: 1.2 * (best.scale || 1), lz: 0, k: 3, fixed: false, yaw: null });
    capToast(`Following ${best.name || best.kind}`);
  } else if (m === 'path' && C.keys.length >= 2) { capPlay(true); return; }
  C.mode = m === 'path' ? 'free' : m;
  C.aim.yaw = c.yaw; C.aim.pitch = c.pitch;
  capRender();
}
// mouse and finger on the scene: a drag looks (the game's own handlers are held off while the mode is on)
function capPointer(e) {
  const C = CAPTURE;
  if (!C.on) return;
  e.stopImmediatePropagation();
  if (e.type === 'pointerdown') {
    canvas.setPointerCapture && canvas.setPointerCapture(e.pointerId);
    C.ptrs = C.ptrs || new Map();
    C.ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (C.ptrs.size === 2) { const [p, q] = [...C.ptrs.values()]; C.pinch = { d: Math.hypot(p.x - q.x, p.y - q.y), fov: C.cam.fov }; }
    C.drag = { x: e.clientX, y: e.clientY };
  } else if (e.type === 'pointermove') {
    if (!C.ptrs || !C.ptrs.has(e.pointerId)) return;
    C.ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (C.ptrs.size === 2 && C.pinch) {
      const [p, q] = [...C.ptrs.values()], d = Math.hypot(p.x - q.x, p.y - q.y);
      C.cam.fov = clamp(C.pinch.fov * C.pinch.d / Math.max(20, d), 12, 100);
      return;
    }
    if (!C.drag || C.mode === 'follow' || (C.play && C.mode === 'path')) return;
    const k = (C.cam.fov / 55) * 0.0042;
    C.aim.yaw -= (e.clientX - C.drag.x) * k;
    C.aim.pitch = clamp(C.aim.pitch - (e.clientY - C.drag.y) * k, -1.5, 1.5);
    C.drag = { x: e.clientX, y: e.clientY };
    if (C.mode === 'orbit') { C.orbit.a -= (e.clientX - C.drag.x) * 0.004; }
  } else {
    if (C.ptrs) C.ptrs.delete(e.pointerId);
    if (!C.ptrs || C.ptrs.size < 2) C.pinch = null;
    if (!C.ptrs || !C.ptrs.size) C.drag = null;
  }
}
for (const ty of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel']) canvas.addEventListener(ty, capPointer, true);
canvas.addEventListener('wheel', (e) => {
  const C = CAPTURE;
  if (!C.on) return;
  e.preventDefault(); e.stopImmediatePropagation();
  const s = Math.sign(e.deltaY);
  if (e.shiftKey) C.cam.fov = clamp(C.cam.fov * (1 + s * 0.06), 12, 100);
  else if (C.mode === 'orbit') C.orbit.r = Math.max(1.5, C.orbit.r * (1 + s * 0.08));
  else C.speed = clamp(C.speed * (1 - s * 0.15), 0.5, 120);
  capRender();
}, { capture: true, passive: false });

/* ------------------------------------------------------------------ */
/* the panel                                                           */
/* ------------------------------------------------------------------ */
function capToast(text) { if (typeof uiToast === 'function') uiToast(text, 'hint'); const T = CAPTURE.tip; if (T) { T.textContent = text; T.classList.add('on'); clearTimeout(CAPTURE.tipT); CAPTURE.tipT = setTimeout(() => T.classList.remove('on'), 2600); } }
const CAP_CSS = `
#cap { position: fixed; z-index: 40; left: calc(10px + var(--safe-l, 0px)); top: calc(10px + var(--safe-t, 0px)); width: 300px; max-height: calc(100% - 20px - var(--safe-t, 0px) - var(--safe-b, 0px)); overflow: auto; background: var(--slate-2); border: 1px solid var(--line); border-radius: 8px; color: var(--ink); font: 13.5px/1.35 var(--ui); padding: 10px 12px 12px; box-shadow: 0 10px 30px rgba(0,0,0,0.45); }
#cap h2 { font: 19px/1.1 var(--display); margin: 0; letter-spacing: 0.02em; color: var(--bronze-hi); }
#cap .cap-hd { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 6px; }
#cap h3 { font: 12px var(--caps); letter-spacing: 0.08em; color: var(--ink-dim); margin: 10px 0 5px; text-transform: none; }
#cap .cap-row { display: flex; flex-wrap: wrap; gap: 5px; align-items: center; }
#cap .cap-b { border: 1px solid var(--line); background: rgba(255,255,255,0.05); color: var(--ink); border-radius: 5px; padding: 5px 9px; cursor: pointer; font: inherit; min-height: 30px; }
#cap .cap-b:hover { background: rgba(223,193,136,0.12); }
#cap .cap-b[aria-pressed="true"] { background: var(--bronze-hi); color: #1b140b; border-color: var(--bronze-hi); }
#cap .cap-b.rec[aria-pressed="true"] { background: #c8463d; color: #fff; border-color: #ff8a7a; }
#cap .cap-b[disabled] { opacity: 0.4; cursor: default; }
#cap .cap-shots { display: grid; grid-template-columns: 1fr 1fr; gap: 5px; }
#cap .cap-shots .cap-b { text-align: left; padding: 6px 8px; line-height: 1.2; }
#cap .cap-shots .cap-b small { display: block; color: var(--ink-faint); font-size: 11px; }
#cap .cap-shots .cap-b[aria-pressed="true"] small { color: rgba(27,20,11,0.7); }
#cap label { display: grid; grid-template-columns: 74px 1fr 40px; align-items: center; gap: 6px; font-size: 12.5px; color: var(--ink-dim); margin: 3px 0; }
#cap label output { text-align: right; font-variant-numeric: tabular-nums; color: var(--ink); }
#cap input[type=range] { width: 100%; accent-color: #dfc188; }
#cap .cap-note { color: var(--ink-faint); font-size: 12px; margin: 6px 0 0; }
#cap kbd { font: 11px var(--ui); border: 1px solid var(--line); border-radius: 3px; padding: 0 4px; color: var(--ink-dim); }
#cap-bars { position: fixed; inset: 0; z-index: 30; pointer-events: none; }
#cap-bars i { position: absolute; background: #000; }
#cap-bars .grid { position: absolute; border: 1px solid rgba(255,255,255,0.0); background-image: linear-gradient(rgba(255,255,255,0.28), rgba(255,255,255,0.28)), linear-gradient(rgba(255,255,255,0.28), rgba(255,255,255,0.28)), linear-gradient(90deg, rgba(255,255,255,0.28), rgba(255,255,255,0.28)), linear-gradient(90deg, rgba(255,255,255,0.28), rgba(255,255,255,0.28)); background-size: 100% 1px, 100% 1px, 1px 100%, 1px 100%; background-position: 0 33.333%, 0 66.666%, 33.333% 0, 66.666% 0; background-repeat: no-repeat; }
#cap-tip { position: fixed; z-index: 41; left: 50%; bottom: calc(18px + var(--safe-b, 0px)); transform: translateX(-50%); background: var(--slate-2); border: 1px solid var(--line); border-radius: 6px; padding: 6px 12px; color: var(--ink); font: 13px var(--ui); opacity: 0; transition: opacity 0.25s; pointer-events: none; }
#cap-tip.on { opacity: 1; }
#cap-rec { position: fixed; z-index: 41; right: calc(14px + var(--safe-r, 0px)); top: calc(12px + var(--safe-t, 0px)); color: #ff8a7a; font: 13px var(--caps); letter-spacing: 0.08em; }
#cap-pad { position: fixed; z-index: 41; right: calc(12px + var(--safe-r, 0px)); bottom: calc(12px + var(--safe-b, 0px)); display: grid; grid-template-columns: repeat(3, 46px); gap: 6px; }
#cap-pad button { width: 46px; height: 46px; border-radius: 50%; border: 1px solid var(--line-strong); background: var(--slate); color: var(--ink); font: 15px var(--ui); touch-action: none; }
#cap-pad button:active { background: rgba(223,193,136,0.3); }
#cap-out { position: fixed; z-index: 45; inset: 0; background: rgba(5,6,8,0.78); display: grid; place-items: center; padding: 20px; }
#cap-out .cap-o-in { max-width: min(960px, 100%); display: grid; gap: 10px; justify-items: center; color: var(--ink); font: 14px var(--ui); }
#cap-out img, #cap-out video { max-width: 100%; max-height: 70vh; border: 1px solid var(--line); border-radius: 4px; }
#cap-out a { color: var(--bronze-hi); }
#cap-out .cap-b { border: 1px solid var(--line-strong); background: var(--slate-2); color: var(--ink); border-radius: 5px; padding: 8px 16px; cursor: pointer; font: inherit; }
@media (pointer: coarse) { #cap .cap-b { min-height: 40px; } #cap input[type=range] { height: 28px; } }
@media (max-width: 640px) { #cap { left: 8px; right: 8px; width: auto; top: auto; bottom: calc(8px + var(--safe-b, 0px)); max-height: 46%; } #cap-pad { bottom: calc(46% + 18px); } }
`;
function capBuild() {
  const C = CAPTURE;
  if (C.el) { C.el.hidden = !C.panel; C.bars0.hidden = false; if (C.pad) C.pad.hidden = !IS_TOUCH; return; }
  const st = document.createElement('style'); st.textContent = CAP_CSS; document.head.appendChild(st);
  const el = document.createElement('div'); el.id = 'cap'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-label', 'Capture mode');
  document.body.appendChild(el);
  const bars = document.createElement('div'); bars.id = 'cap-bars'; bars.innerHTML = '<i class="b0"></i><i class="b1"></i><div class="grid" hidden></div>'; document.body.appendChild(bars);
  const tip = document.createElement('div'); tip.id = 'cap-tip'; document.body.appendChild(tip);
  const rec = document.createElement('div'); rec.id = 'cap-rec'; rec.hidden = true; document.body.appendChild(rec);
  const out = document.createElement('div'); out.id = 'cap-out'; out.hidden = true; document.body.appendChild(out);
  out.addEventListener('click', (e) => { const b = e.target.closest('[data-c="outclose"]'); if (b || e.target === out) out.hidden = true; });
  // the pad on a touch screen: held, it flies the camera
  const pad = document.createElement('div'); pad.id = 'cap-pad'; pad.hidden = !IS_TOUCH;
  pad.innerHTML = [['pad-u', '⤒'], ['pad-f', '▲'], ['pad-d', '⤓'], ['pad-l', '◀'], ['pad-b', '▼'], ['pad-r', '▶']].map(([k, l]) => `<button type="button" data-k="${k}" aria-label="${{ 'pad-u': 'Up', 'pad-f': 'Forward', 'pad-d': 'Down', 'pad-l': 'Left', 'pad-b': 'Back', 'pad-r': 'Right' }[k]}">${l}</button>`).join('');
  for (const ty of ['pointerdown', 'pointerup', 'pointercancel', 'pointerleave']) pad.addEventListener(ty, (e) => { const b = e.target.closest('button'); if (!b) return; e.preventDefault(); if (ty === 'pointerdown') C.held.add(b.dataset.k); else C.held.delete(b.dataset.k); });
  document.body.appendChild(pad);
  Object.assign(C, { el, bars0: bars, tip, recEl: rec, out, pad });
  el.addEventListener('click', capClick);
  el.addEventListener('input', capInput);
  for (const ty of ['pointerdown', 'wheel', 'keydown']) el.addEventListener(ty, (e) => { if (ty !== 'keydown') e.stopPropagation(); });
}
function capPanel(on) { CAPTURE.panel = on; if (CAPTURE.el) CAPTURE.el.hidden = !on; }
const capSeg = (act, opts, cur) => `<div class="cap-row">${opts.map(([v, l]) => `<button type="button" class="cap-b" data-c="${act}" data-v="${v}" aria-pressed="${String(v) === String(cur)}">${l}</button>`).join('')}</div>`;
const capSlider = (id, label, min, max, step, v, fmt) => `<label>${label}<input type="range" id="${id}" min="${min}" max="${max}" step="${step}" value="${v}"><output>${fmt(v)}</output></label>`;
function capRender() {
  const C = CAPTURE;
  if (!C.el) return;
  capBarsDraw();
  if (C.recEl) { C.recEl.hidden = !C.rec; C.recEl.textContent = '● Recording'; }
  if (C.pad) C.pad.hidden = !IS_TOUCH || !C.on;
  const c = C.cam, todNow = Object.entries(CAP_TOD).find(([, p]) => Math.abs(p - tod.p) < 0.02), seasonK = SEASON.t / SEASON.yearSec;
  const seasonNow = Object.entries(CAP_SEASON).find(([, k]) => Math.abs(k - seasonK) < 0.06);
  C.el.innerHTML = `<div class="cap-hd"><h2>Capture</h2><div class="cap-row"><button type="button" class="cap-b" data-c="hide" title="Hide the panel (H)">Hide</button><button type="button" class="cap-b" data-c="leave">Leave</button></div></div>
    <h3>Shots</h3><div class="cap-shots">${CAP_SHOTS.map((s) => { const why = s.need ? s.need() : ''; return `<button type="button" class="cap-b" data-c="shot" data-v="${s.id}" aria-pressed="${C.shot === s.id}" ${why ? `disabled title="${esc(why)}"` : `title="${esc(s.line)}"`}>${esc(s.name)}<small>${esc(why ? 'Not now' : s.line.split(':')[0].slice(0, 34))}</small></button>`; }).join('')}</div>
    <h3>Camera</h3>${capSeg('mode', [['free', 'Free'], ['orbit', 'Orbit'], ['follow', 'Follow'], ['path', 'Path']], C.play ? 'path' : C.mode)}
    ${capSlider('cap-fov', 'Lens', 12, 100, 1, Math.round(c.fov), (v) => `${Math.round(v)}°`)}
    ${capSlider('cap-roll', 'Roll', -30, 30, 1, Math.round(c.roll / DEG), (v) => `${Math.round(v)}°`)}
    ${capSlider('cap-speed', 'Pace', 0.5, 60, 0.5, C.speed, (v) => `${(+v).toFixed(1)}`)}
    ${capSlider('cap-smooth', 'Smoothing', 0, 1, 0.05, C.smooth, (v) => `${Math.round(v * 100)}%`)}
    ${C.mode === 'orbit' ? capSlider('cap-orbit', 'Orbit turn', -0.6, 0.6, 0.02, C.orbit.w, (v) => (+v).toFixed(2)) : ''}
    <h3>Path · ${C.keys.length} key${C.keys.length === 1 ? '' : 's'}</h3>
    <div class="cap-row"><button type="button" class="cap-b" data-c="key">Add key <kbd>K</kbd></button><button type="button" class="cap-b" data-c="play" aria-pressed="${C.play}" ${C.keys.length < 2 ? 'disabled' : ''}>${C.play ? 'Stop' : 'Play'} <kbd>P</kbd></button><button type="button" class="cap-b" data-c="loop" aria-pressed="${C.loop}">Loop</button><button type="button" class="cap-b" data-c="clearkeys" ${C.keys.length ? '' : 'disabled'}>Clear</button></div>
    ${capSlider('cap-dur', 'Length', 2, 40, 0.5, C.dur, (v) => `${(+v).toFixed(1)}s`)}
    <div class="cap-row"><button type="button" class="cap-b" data-c="copypath" ${C.keys.length ? '' : 'disabled'}>Copy path</button><button type="button" class="cap-b" data-c="pastepath">Paste path</button></div>
    <h3>Time of day</h3>${capSeg('tod', [['dawn', 'Dawn'], ['day', 'Day'], ['golden', 'Golden'], ['dusk', 'Dusk'], ['night', 'Night']], todNow ? todNow[0] : '')}
    ${capSlider('cap-tod', 'Hour', 0, 2.99, 0.01, tod.p.toFixed(2), (v) => (+v).toFixed(2))}
    <h3>Weather</h3>${capSeg('weather', [['clear', 'Clear'], ['haze', 'Haze'], ['rain', 'Rain'], ['storm', 'Storm'], ['snow', 'Snow'], ['mist', 'Mist']], C.weather || '')}
    <div class="cap-row" style="margin-top:5px"><button type="button" class="cap-b" data-c="bolt">Lightning</button><button type="button" class="cap-b" data-c="weather" data-v="auto" aria-pressed="${WEATHER.mode === 'auto'}">Let it change</button></div>
    <h3>Season</h3>${capSeg('season', [['spring', 'Spring'], ['summer', 'Summer'], ['autumn', 'Autumn'], ['winter', 'Winter']], seasonNow ? seasonNow[0] : '')}
    <h3>The world's clock</h3>${capSeg('rate', CAP_RATES, C.k)}
    <h3>Frame</h3>${capSeg('bars', CAP_BARS, C.bars)}
    <div class="cap-row" style="margin-top:5px"><button type="button" class="cap-b" data-c="grid" aria-pressed="${C.grid}">Thirds</button><button type="button" class="cap-b" data-c="me" aria-pressed="${!C.hideMe}">Show yourself</button></div>
    <h3>Graphics</h3>${capSeg('quality', [['low', 'Low'], ['medium', 'Medium'], ['high', 'High']], quality.level)}
    <h3>Take</h3><div class="cap-row"><button type="button" class="cap-b" data-c="still">Still <kbd>X</kbd></button><button type="button" class="cap-b rec" data-c="rec" aria-pressed="${!!C.rec}">${C.rec ? 'Stop recording' : 'Record clip'} <kbd>R</kbd></button></div>
    <p class="cap-note">${IS_TOUCH ? 'Drag to look, pinch for the lens, the pad to fly.' : '<kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> fly, <kbd>E</kbd>/<kbd>Q</kbd> up and down, drag to look, wheel for pace, Shift+wheel for the lens. <kbd>F</kbd> freezes the world, <kbd>[</kbd> <kbd>]</kbd> its pace. <kbd>B</kbd> bars, <kbd>G</kbd> thirds, <kbd>H</kbd> hides this.'} Nothing is saved while capture is on.</p>
    <div class="cap-row" style="margin-top:6px"><button type="button" class="cap-b" data-c="leave">Leave and keep this world</button><button type="button" class="cap-b" data-c="restore" title="The page loads again from your last save">Leave and put it back</button></div>`;
}
function capBarsDraw() {
  const C = CAPTURE, B = C.bars0;
  if (!B) return;
  B.hidden = !C.on;
  const [b0, b1] = B.querySelectorAll('i'), g = B.querySelector('.grid'), Wv = window.innerWidth, Hv = window.innerHeight, r = C.bars;
  let x = 0, y = 0, w = Wv, h = Hv;
  if (r) { if (Wv / Hv > r) { w = Hv * r; x = (Wv - w) / 2; } else { h = Wv / r; y = (Hv - h) / 2; } }
  const horiz = r && Wv / Hv > r;
  Object.assign(b0.style, horiz ? { left: '0', top: '0', width: `${x}px`, height: '100%' } : { left: '0', top: '0', width: '100%', height: `${y}px` });
  Object.assign(b1.style, horiz ? { left: `${x + w}px`, top: '0', width: `${x}px`, height: '100%' } : { left: '0', top: `${y + h}px`, width: '100%', height: `${y}px` });
  g.hidden = !C.grid;
  Object.assign(g.style, { left: `${x}px`, top: `${y}px`, width: `${w}px`, height: `${h}px` });
}
window.addEventListener('resize', () => { if (CAPTURE.on) capBarsDraw(); });
function capClick(e) {
  const b = e.target.closest('[data-c]');
  if (!b || b.disabled) return;
  const C = CAPTURE, v = b.dataset.v;
  switch (b.dataset.c) {
    case 'hide': capPanel(false); capToast(IS_TOUCH ? 'Tap the scene with two fingers to bring the panel back' : 'H brings the panel back'); return;
    case 'leave': captureClose(false); return;
    case 'restore': captureClose(true); return;
    case 'shot': captureShot(v); return;
    case 'mode': capMode(v); return;
    case 'key': capAddKey(); return;
    case 'play': capPlay(); return;
    case 'loop': C.loop = !C.loop; break;
    case 'clearkeys': C.keys = []; C.play = false; break;
    case 'copypath': { const s = JSON.stringify({ dur: C.dur, keys: C.keys.map((k) => Object.fromEntries(Object.entries(k).map(([a, x]) => [a, +x.toFixed(3)]))) }); try { navigator.clipboard.writeText(s).then(() => capToast('Path copied'), () => capPathBox(s)); } catch (err) { capPathBox(s); } return; }
    case 'pastepath': capPathBox(''); return;
    case 'tod': capTod(v); break;
    case 'weather': capWeather(v); break;
    case 'bolt': capLightning(); return;
    case 'season': capSeason(v); break;
    case 'rate': capRate(+v); return;
    case 'bars': C.bars = +v; break;
    case 'grid': C.grid = !C.grid; break;
    case 'me': C.hideMe = !C.hideMe; capHidePlayer(); break;
    case 'quality': setQuality(v); capFocal(); break;
    case 'still': capShowStill(); return;
    case 'rec': if (C.rec) capRecStop(); else capRecStart(); return;
  }
  capRender();
}
function capInput(e) {
  const C = CAPTURE, t = e.target, v = +t.value, out = t.parentElement && t.parentElement.querySelector('output');
  if (t.id === 'cap-fov') { C.cam.fov = v; if (out) out.textContent = `${Math.round(v)}°`; }
  else if (t.id === 'cap-roll') { C.cam.roll = v * DEG; if (out) out.textContent = `${Math.round(v)}°`; }
  else if (t.id === 'cap-speed') { C.speed = v; if (out) out.textContent = v.toFixed(1); }
  else if (t.id === 'cap-smooth') { C.smooth = v; if (out) out.textContent = `${Math.round(v * 100)}%`; }
  else if (t.id === 'cap-orbit') { C.orbit.w = v; if (out) out.textContent = v.toFixed(2); }
  else if (t.id === 'cap-dur') { C.dur = v; if (out) out.textContent = `${v.toFixed(1)}s`; }
  else if (t.id === 'cap-tod') { capTod(v); if (out) out.textContent = v.toFixed(2); }
}
// a box to paste a path into (or to copy one from, where the clipboard is refused)
function capPathBox(text) {
  const O = CAPTURE.out;
  O.innerHTML = `<div class="cap-o-in" style="width:min(560px,100%)"><p>${text ? 'Copy this path:' : 'Paste a path copied from capture mode:'}</p><textarea id="cap-pathtext" rows="8" style="width:100%;font:12px ui-monospace,monospace;background:#0b0d10;color:#efe6d3;border:1px solid rgba(223,193,136,0.4);border-radius:4px;padding:8px">${esc(text)}</textarea><div class="cap-row" style="display:flex;gap:8px">${text ? '' : '<button type="button" class="cap-b" data-c="pathok">Use this path</button>'}<button type="button" class="cap-b" data-c="outclose">Close</button></div></div>`;
  O.hidden = false;
  const ta = O.querySelector('textarea');
  if (text) ta.select();
  const ok = O.querySelector('[data-c="pathok"]');
  if (ok) ok.onclick = () => {
    try {
      const d = JSON.parse(ta.value), K = (d.keys || []).filter((k) => [k.x, k.y, k.z, k.yaw, k.pitch].every((n) => Number.isFinite(n))).map((k) => ({ x: k.x, y: k.y, z: k.z, yaw: k.yaw, pitch: k.pitch, roll: Number.isFinite(k.roll) ? k.roll : 0, fov: clamp(Number.isFinite(k.fov) ? k.fov : 55, 12, 100) }));
      if (K.length < 2) throw new Error('fewer than two keys');
      CAPTURE.keys = capUnwrap(K); CAPTURE.dur = clamp(+d.dur || 8, 2, 40); O.hidden = true; capToast(`Path of ${K.length} keys`); capRender();
    } catch (err) { capToast('That is not a path from capture mode'); }
  };
}
// two fingers tapping the scene bring the panel back on a touch screen
canvas.addEventListener('pointerup', () => { const C = CAPTURE; if (C.on && !C.panel && C.ptrs && C.ptrs.size === 1 && C.pinch == null && C.twoTap) capPanel(true); }, true);

/* ------------------------------------------------------------------ */
/* the Settings row (10_ui.js)                                          */
/* ------------------------------------------------------------------ */
const captureSettingsHTML = () => `<div class="setrow"><span>Capture mode</span><button type="button" class="btn" id="set-capture">Open capture mode</button></div>
  <p class="cap-set-note" style="margin:-4px 0 4px;color:var(--ink-faint);font-size:13px">For trailers and stills: a free camera, camera paths, staged shots, the time of day, the weather and the season. ${IS_TOUCH ? '' : 'Also ` or F8. '}Nothing is saved while it is on.</p>`;
function captureSettingsWire() { const b = $('set-capture'); if (b) b.onclick = () => captureOpen(); }

/* ------------------------------------------------------------------ */
/* test and film hooks                                                 */
/* ------------------------------------------------------------------ */
if (window.__hm) {
  window.__hm.capture = {
    CAPTURE, CAP_SHOTS, CAP_TOD, CAP_SEASON,
    open: captureOpen, close: captureClose, shot: captureShot, still: captureStill, run: capRun, key: capAddKey, keyOf: capKey, pathAt: capPathAt,
    tod: capTod, weather: capWeather, season: capSeason, bolt: capLightning, mode: capMode, rate: capRate, render: capRender, frameRect: capFrameRect,
    // one frame of a film: the world's step and the camera's move of 1/fps, then drawn
    step(dt = 1 / 24) { try { tick(dt); } catch (err) { reportError(err); } return 0; },
    shots() { return CAP_SHOTS.map((s) => ({ id: s.id, name: s.name, line: s.line, dur: s.dur, need: s.need ? s.need() : '' })); },
    state() { const C = CAPTURE, c = C.cam; return { on: C.on, mode: C.mode, play: C.play, pt: +C.pt.toFixed(3), dur: C.dur, k: C.k, shot: C.shot, keys: C.keys.length, hide: C.hideMe, cam: [c.x, c.y, c.z, c.yaw, c.pitch, c.roll, c.fov].map((v) => +v.toFixed(3)), modal: UI.modal, hud: !$('hud').hidden, made: C.made.filter((e) => !e.removed).length, stats: { ...C.stats } }; },
  };
}
