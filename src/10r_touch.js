/* A narrow fallback for touch browsers that still zoom after manipulation taps.
 * WebKit's older-iOS compatibility issue: https://bugs.webkit.org/show_bug.cgi?id=319664
 * Keep pinch, scrolling, native forms and links under browser control. */
const MOBILE_TOUCH_NO_ZOOM = { bound: false, active: null, last: null, blocked: 0, clicks: 0 };

function mobileBindNoZoom() {
  const S = MOBILE_TOUCH_NO_ZOOM;
  if (!IS_TOUCH || S.bound) return;
  S.bound = true;
  const reset = () => { S.active = null; S.last = null; };
  const element = (target) => target instanceof Element ? target : target && target.parentElement;
  const native = (target) => {
    const el = element(target);
    return !el || el.isContentEditable || !!el.closest('input, select, textarea, option, label, form, a[href], [contenteditable]:not([contenteditable="false"])');
  };
  const point = (list, id) => Array.from(list).find((p) => p.identifier === id);
  const moved = (p, tap) => Math.hypot(p.clientX - tap.x, p.clientY - tap.y) > 10;
  // Event time measures the gesture itself, even when rendering delays delivery.
  const stamp = (e) => Number.isFinite(e.timeStamp) ? e.timeStamp : performance.now();

  document.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 1 || native(e.target)) { reset(); return; }
    const p = e.touches[0];
    S.active = { id: p.identifier, x: p.clientX, y: p.clientY, at: stamp(e), target: element(e.target) };
  }, { passive: true });
  document.addEventListener('touchmove', (e) => {
    const tap = S.active;
    if (!tap || e.touches.length !== 1) { reset(); return; }
    const p = point(e.touches, tap.id);
    if (!p || moved(p, tap)) reset();
  }, { passive: true });
  document.addEventListener('touchcancel', reset, { passive: true });
  document.addEventListener('touchend', (e) => {
    const tap = S.active, now = stamp(e);
    S.active = null;
    const p = tap && point(e.changedTouches, tap.id);
    const duration = tap ? now - tap.at : -1;
    if (!tap || !p || e.touches.length || native(e.target) || duration < 0 || duration > 300 || moved(p, tap)) {
      S.last = null; return;
    }
    const last = S.last;
    S.last = { x: p.clientX, y: p.clientY, at: now };
    const interval = last ? now - last.at : -1;
    if (!last || interval < 0 || interval > 350 || Math.hypot(p.clientX - last.x, p.clientY - last.y) > 28 || !e.cancelable || e.defaultPrevented) return;
    // Cancel only the second tap's native click/zoom default, then replace that
    // click once. Ability buttons already act on pointerdown; clicking them
    // adds no extra cast. World targeting already happened on pointerup.
    e.preventDefault();
    if (!e.defaultPrevented) return;
    S.blocked++;
    S.last = null;
    const control = tap.target && tap.target.closest('button, summary, [role="button"]');
    if (control) {
      if (control.isConnected && !control.matches(':disabled, [aria-disabled="true"]') && !control.closest('[inert]')) {
        control.click(); S.clicks++;
      }
    } else if (tap.target && tap.target !== canvas && tap.target.isConnected && !tap.target.closest('[inert]')) {
      // Map selections and other delegated UI clicks need the finger's actual
      // coordinates. The world canvas has already handled its pointerup.
      tap.target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, composed: true,
        view: window, clientX: p.clientX, clientY: p.clientY, screenX: p.screenX, screenY: p.screenY,
        button: 0, buttons: 0, detail: 1 }));
      S.clicks++;
    }
  }, { passive: false });
}
