/* Throne command camera. Navigation is local; army orders keep their shared authority path. */
const THRONE_RTS = {
  active: false, x: 0, z: 0, yaw: 0, distance: 90, targetDistance: 90,
  keys: new Set(), pointers: new Map(), saved: null, stage: null, binding: null, multi: false, projectionKey: '',
};
const THRONE_RTS_PITCH = 62 * Math.PI / 180;
const THRONE_RTS_MIN_DISTANCE = 45, THRONE_RTS_MAX_DISTANCE = 180;
const THRONE_RTS_PAN_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);
const _throneRtsLook = new THREE.Vector3();
const throneRtsClamp = (value, lo, hi) => Math.max(lo, Math.min(hi, value));

function throneRtsCaptureKey(e) {
  // Window capture precedes the document's lease listener: forward this real event once.
  if (typeof netHumanInput === 'function') netHumanInput(e);
  e.preventDefault(); e.stopImmediatePropagation();
}
function throneRtsWorldBound() {
  const half = typeof HALF === 'number' && Number.isFinite(HALF) ? HALF
    : typeof WSIZE === 'number' && Number.isFinite(WSIZE) ? WSIZE / 2
      : typeof R_RING === 'number' && Number.isFinite(R_RING) ? R_RING + 120 : 512;
  return Math.max(30, half - 16);
}
function throneRtsAllowed() {
  return THRONE_RTS.active && CAM.mode === 'rts' && UI.modal === 'rts'
    && typeof hallThroneGrant === 'function' && hallThroneGrant()
    && (typeof netHumanLive !== 'function' || netHumanLive());
}
function throneRtsRequireGrant() {
  if (throneRtsAllowed()) return true;
  if (THRONE_RTS.active) {
    if (typeof closeThroneRTS === 'function') closeThroneRTS(false);
    else throneRtsStopCamera();
  }
  return false;
}
function throneRtsCancelInput() {
  const ids = [...THRONE_RTS.pointers.keys()], stage = THRONE_RTS.stage;
  THRONE_RTS.keys.clear(); THRONE_RTS.pointers.clear(); THRONE_RTS.multi = false;
  for (const id of ids) {
    try { if (stage?.hasPointerCapture(id)) stage.releasePointerCapture(id); } catch (err) { /* already released */ }
  }
  if (typeof cancelPlayerInput === 'function') cancelPlayerInput();
}
function throneRtsStartCamera(x, z) {
  if (UI.modal !== 'rts' || typeof hallThroneGrant !== 'function' || !hallThroneGrant()
    || typeof netHumanLive === 'function' && !netHumanLive()) return false;
  if (THRONE_RTS.active) return throneRtsFocus(x, z);
  THRONE_RTS.saved = {
    mode: CAM.mode, pos: CAM.pos.clone(), focus: CAM.focus.clone(),
    cameraPosition: camera.position.clone(), cameraQuaternion: camera.quaternion.clone(), cameraUp: camera.up.clone(),
    cameraView: camera.view ? { ...camera.view } : null,
  };
  throneRtsCancelInput();
  const bound = throneRtsWorldBound();
  THRONE_RTS.x = throneRtsClamp(Number.isFinite(x) ? x : 0, -bound, bound);
  THRONE_RTS.z = throneRtsClamp(Number.isFinite(z) ? z : 0, -bound, bound);
  THRONE_RTS.yaw = 0;
  THRONE_RTS.distance = THRONE_RTS.targetDistance = 90;
  THRONE_RTS.active = true; THRONE_RTS.projectionKey = ''; CAM.mode = 'rts';
  throneRtsUpdateCamera(0);
  return true;
}
function throneRtsStopCamera() {
  const saved = THRONE_RTS.saved, restore = CAM.mode === 'rts';
  THRONE_RTS.active = false; THRONE_RTS.saved = null; THRONE_RTS.projectionKey = '';
  throneRtsCancelInput();
  if (!saved || !restore) return;
  CAM.mode = saved.mode; CAM.pos.copy(saved.pos); CAM.focus.copy(saved.focus);
  camera.position.copy(saved.cameraPosition); camera.quaternion.copy(saved.cameraQuaternion); camera.up.copy(saved.cameraUp);
  if (saved.cameraView) {
    camera.view = { ...saved.cameraView };
    if (typeof camera.updateProjectionMatrix === 'function') camera.updateProjectionMatrix();
  } else {
    const clear = typeof camera.clearViewOffset === 'function';
    if (clear) camera.clearViewOffset();
    camera.view = null;
    if (!clear && typeof camera.updateProjectionMatrix === 'function') camera.updateProjectionMatrix();
  }
  camera.updateMatrixWorld();
}
function throneRtsFocus(x, z) {
  if (!throneRtsRequireGrant() || !Number.isFinite(x) || !Number.isFinite(z)) return false;
  const bound = throneRtsWorldBound();
  THRONE_RTS.x = throneRtsClamp(x, -bound, bound);
  THRONE_RTS.z = throneRtsClamp(z, -bound, bound);
  return true;
}
function throneRtsZoom(factor) {
  if (!throneRtsRequireGrant() || !Number.isFinite(factor) || factor <= 0) return false;
  THRONE_RTS.targetDistance = throneRtsClamp(THRONE_RTS.targetDistance * factor, THRONE_RTS_MIN_DISTANCE, THRONE_RTS_MAX_DISTANCE);
  return true;
}
function throneRtsPan(dxPixels, dyPixels) {
  if (!throneRtsRequireGrant() || !Number.isFinite(dxPixels) || !Number.isFinite(dyPixels)) return false;
  const scale = 2 * THRONE_RTS.distance * Math.tan(camera.fov * Math.PI / 360) / Math.max(1, view.h);
  const vertical = dyPixels / Math.sin(THRONE_RTS_PITCH);
  const sy = Math.sin(THRONE_RTS.yaw), cy = Math.cos(THRONE_RTS.yaw);
  return throneRtsFocus(THRONE_RTS.x + (-cy * dxPixels - sy * vertical) * scale,
    THRONE_RTS.z + (sy * dxPixels - cy * vertical) * scale);
}
function throneRtsUpdateProjection() {
  const stage = THRONE_RTS.stage;
  if (!stage || typeof stage.getBoundingClientRect !== 'function' || typeof camera.setViewOffset !== 'function') return;
  const rect = stage.getBoundingClientRect(), width = Math.max(1, view.w), height = Math.max(1, view.h);
  if (![rect.left, rect.top, rect.width, rect.height, width, height].every(Number.isFinite) || rect.width <= 0 || rect.height <= 0) return;
  const offsetX = width / 2 - (rect.left + rect.width / 2), offsetY = height / 2 - (rect.top + rect.height / 2);
  const key = [width, height, offsetX, offsetY].join(':');
  if (key === THRONE_RTS.projectionKey) return;
  camera.setViewOffset(width, height, offsetX, offsetY, width, height);
  THRONE_RTS.projectionKey = key;
}
function throneRtsUpdateCamera(dt) {
  if (!THRONE_RTS.active || !throneRtsRequireGrant()) return false;
  throneRtsUpdateProjection();
  const step = Number.isFinite(dt) ? throneRtsClamp(dt, 0, 0.1) : 0;
  const keys = THRONE_RTS.keys;
  let forward = (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0) - (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0);
  let side = (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0) - (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0);
  const magnitude = Math.hypot(forward, side);
  if (magnitude > 1) { forward /= magnitude; side /= magnitude; }
  if (magnitude) throneRtsPan(-side * 350 * step, forward * 350 * step);
  THRONE_RTS.distance += (THRONE_RTS.targetDistance - THRONE_RTS.distance) * (1 - Math.exp(-step * 10));
  const distance = THRONE_RTS.distance, yaw = THRONE_RTS.yaw;
  const ground = heightAt(THRONE_RTS.x, THRONE_RTS.z);
  const focusY = ground + 1.5, reach = Math.cos(THRONE_RTS_PITCH) * distance;
  const cx = THRONE_RTS.x + Math.sin(yaw) * reach, cz = THRONE_RTS.z + Math.cos(yaw) * reach;
  const cy = Math.max(focusY + Math.sin(THRONE_RTS_PITCH) * distance, heightAt(cx, cz) + 12);
  _throneRtsLook.set(THRONE_RTS.x, focusY, THRONE_RTS.z);
  CAM.pos.set(cx, cy, cz); CAM.focus.copy(_throneRtsLook);
  camera.up.set(0, 1, 0); camera.position.copy(CAM.pos); camera.lookAt(_throneRtsLook); camera.updateMatrixWorld();
  return true;
}
function throneRtsGesture() {
  const points = [...THRONE_RTS.pointers.values()].slice(0, 2);
  if (points.length < 2) return null;
  return { x: (points[0].x + points[1].x) / 2, y: (points[0].y + points[1].y) / 2,
    span: Math.hypot(points[1].x - points[0].x, points[1].y - points[0].y) };
}
function throneRtsBindStage(element) {
  if (THRONE_RTS.stage === element && THRONE_RTS.binding) return;
  throneRtsCancelInput();
  const old = THRONE_RTS.binding;
  if (old) {
    for (const [type, handler] of Object.entries(old.handlers)) old.element.removeEventListener(type, handler);
    old.element.style.touchAction = old.touchAction;
  }
  THRONE_RTS.stage = element || null; THRONE_RTS.binding = null;
  if (!element) return;
  const consume = e => { e.preventDefault(); e.stopPropagation(); };
  const handlers = {
    pointerdown(e) {
      if (!throneRtsRequireGrant()) return;
      consume(e);
      const now = performance.now();
      THRONE_RTS.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY,
        moved: 0, button: e.button, type: e.pointerType, at: now, eventAt: pointerEventTimestamp(e, now) });
      if (THRONE_RTS.pointers.size > 1) THRONE_RTS.multi = true;
      try { element.setPointerCapture(e.pointerId); } catch (err) { /* synthetic or already released */ }
    },
    pointermove(e) {
      const p = THRONE_RTS.pointers.get(e.pointerId);
      if (!p || !throneRtsRequireGrant()) return;
      consume(e);
      const before = throneRtsGesture(), dx = e.clientX - p.x, dy = e.clientY - p.y;
      p.x = e.clientX; p.y = e.clientY; p.moved += Math.abs(dx) + Math.abs(dy);
      const after = throneRtsGesture();
      if (before && after) {
        THRONE_RTS.multi = true;
        throneRtsPan(after.x - before.x, after.y - before.y);
        if (before.span > 4 && after.span > 4) throneRtsZoom(before.span / after.span);
      } else if (p.moved >= 8 || THRONE_RTS.multi) throneRtsPan(dx, dy);
    },
    pointerup(e) {
      const p = THRONE_RTS.pointers.get(e.pointerId);
      if (!p) return;
      consume(e);
      const elapsed = pointerGestureDuration(e, p.eventAt, p.at);
      const tap = !THRONE_RTS.multi && THRONE_RTS.pointers.size === 1 && p.moved < 8
        && Math.hypot(e.clientX - p.sx, e.clientY - p.sy) < 8 && elapsed < 450
        && (p.type === 'touch' || p.button === 0);
      THRONE_RTS.pointers.delete(e.pointerId);
      if (!THRONE_RTS.pointers.size) THRONE_RTS.multi = false;
      try { if (element.hasPointerCapture(e.pointerId)) element.releasePointerCapture(e.pointerId); } catch (err) { /* already released */ }
      if (tap && throneRtsRequireGrant() && typeof throneRtsPick === 'function') throneRtsPick(e.clientX, e.clientY);
    },
    pointercancel(e) {
      if (!THRONE_RTS.pointers.has(e.pointerId)) return;
      THRONE_RTS.pointers.delete(e.pointerId);
      THRONE_RTS.multi = THRONE_RTS.pointers.size > 0;
    },
    lostpointercapture(e) {
      if (!THRONE_RTS.pointers.has(e.pointerId)) return;
      THRONE_RTS.pointers.delete(e.pointerId);
      THRONE_RTS.multi = THRONE_RTS.pointers.size > 0;
    },
    wheel(e) {
      if (e.ctrlKey || e.metaKey || e.altKey || !throneRtsRequireGrant()) return;
      consume(e);
      const units = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? Math.max(1, view.h) : 1;
      throneRtsZoom(Math.exp(throneRtsClamp(e.deltaY * units, -240, 240) * 0.0018));
    },
    contextmenu(e) { if (throneRtsAllowed()) consume(e); },
  };
  THRONE_RTS.binding = { element, handlers, touchAction: element.style.touchAction };
  element.style.touchAction = 'none';
  for (const [type, handler] of Object.entries(handlers)) element.addEventListener(type, handler, { passive: false });
}
window.addEventListener('keydown', e => {
  if (!THRONE_RTS.active) return;
  if ((typeof gameplayKeyIgnored === 'function' ? gameplayKeyIgnored(e) : e.ctrlKey || e.metaKey || e.altKey || e.isComposing)) return;
  if (typeof typing === 'function' && typing() && e.code !== 'Escape') return;
  if (!throneRtsRequireGrant()) return;
  if (e.code === 'Escape' || e.code === 'KeyM') {
    throneRtsCaptureKey(e);
    if (!e.repeat && typeof closeThroneRTS === 'function') closeThroneRTS(true);
    return;
  }
  if (!THRONE_RTS_PAN_KEYS.has(e.code)) return;
  throneRtsCaptureKey(e); THRONE_RTS.keys.add(e.code);
}, true);
window.addEventListener('keyup', e => {
  if (!THRONE_RTS.keys.delete(e.code)) return;
  e.preventDefault(); e.stopImmediatePropagation();
}, true);
window.addEventListener('blur', () => {
  if (!THRONE_RTS.active) return;
  throneRtsCancelInput();
  if (typeof closeThroneRTS === 'function') closeThroneRTS(false);
  else throneRtsStopCamera();
});
document.addEventListener('visibilitychange', () => {
  if (!document.hidden || !THRONE_RTS.active) return;
  throneRtsCancelInput();
  if (typeof closeThroneRTS === 'function') closeThroneRTS(false);
  else throneRtsStopCamera();
});
document.addEventListener('focusin', () => {
  if (THRONE_RTS.active && typeof typing === 'function' && typing()) throneRtsCancelInput();
});
window.addEventListener('pagehide', () => {
  if (!THRONE_RTS.active) return;
  if (typeof closeThroneRTS === 'function') closeThroneRTS(false);
  else throneRtsStopCamera();
});
