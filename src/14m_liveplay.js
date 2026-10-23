/* A live human session is an input lease, never a socket or animation heartbeat.
 * This is an idle-work signal; server identity and agent admission stay separate.
 */
// The server keeps a 90-second lease; leave two seconds for publication latency.
const NET_HUMAN_PLAY_MS = 88000;
const NET_HUMAN_START_MS = 5000;
const NET_HUMAN_PLAY = { activity: 0, pendingAt: null, acceptedAt: null, player: null,
  focused: typeof document.hasFocus === 'function' && document.hasFocus(), timer: null,
  reportedLive: false, reportedActivity: 0, renewedAt: -Infinity };

function netHumanEligible() {
  return !!(GAME.started && GAME.player && !(typeof NETWS !== 'undefined' && NETWS.worldReloadRequired) && !document.hidden && NET_HUMAN_PLAY.focused
    && typeof document.hasFocus === 'function' && document.hasFocus()
    && UI.modal !== 'menu' && UI.modal !== 'prologue'
    && !(UI.modal === 'net' && UI.identitySettings));
}
function netHumanLive() {
  const h = NET_HUMAN_PLAY, now = performance.now();
  return netHumanEligible() && h.player === GAME.player && h.acceptedAt !== null
    && now >= h.acceptedAt && now - h.acceptedAt < NET_HUMAN_PLAY_MS;
}
function netHumanPublish() {
  const h = NET_HUMAN_PLAY, live = netHumanLive(), wasLive = h.reportedLive;
  if (live === wasLive) {
    // Trusted input renews at most once a second, even if rendering is stalled.
    // The client expires before the server, leaving a publication margin.
    if (!live || h.activity === h.reportedActivity || performance.now() - h.renewedAt < 1000) return;
  }
  h.reportedLive = live; h.reportedActivity = h.activity; h.renewedAt = performance.now();
  if (live && !wasLive) {
    // The server drops our last pose in standby. Republish it once on resume,
    // even when the human is still standing in exactly the same place.
    NET.fastKey = ''; NET.fastAt = -Infinity;
  }
  // One final save belongs to the departing live session. Never retry it from
  // an idle heartbeat; unsaved native progress keeps its existing pending record.
  if (wasLive && !live && GAME.player && typeof saveNow === 'function') {
    void Promise.resolve(saveNow({ final: true })).catch(() => {});
  }
  // Withdraw before suspending the transport, including when rendering stops.
  if (typeof netOn === 'function' && netOn()) {
    NET.slowKey = ''; NET.slowAt = -Infinity;
    if (typeof netSendSlow === 'function') netSendSlow(performance.now(), true);
  }
  if (wasLive && !live && typeof netWsSuspendHuman === 'function') netWsSuspendHuman();
  else if (live && typeof netWsStartHumanPing === 'function') netWsStartHumanPing();
}
function netHumanSync() {
  const h = NET_HUMAN_PLAY, now = performance.now(), eligible = netHumanEligible();
  if (h.player !== GAME.player) { h.player = GAME.player; h.acceptedAt = null; }
  if (eligible && h.pendingAt !== null && now >= h.pendingAt && now - h.pendingAt <= NET_HUMAN_START_MS) {
    h.acceptedAt = h.pendingAt; h.pendingAt = null;
  } else if (!eligible) {
    h.acceptedAt = null;
    if (UI.modal === 'net' && UI.identitySettings) h.pendingAt = null;
  }
  if (h.pendingAt !== null && now - h.pendingAt > NET_HUMAN_START_MS) h.pendingAt = null;
  if (h.timer !== null) clearTimeout(h.timer);
  h.timer = null;
  if (netHumanLive()) h.timer = setTimeout(() => { h.timer = null; netHumanSync(); },
    Math.max(1, NET_HUMAN_PLAY_MS - (now - h.acceptedAt)));
  netHumanPublish();
}
function netHumanSuspend() {
  const h = NET_HUMAN_PLAY;
  h.pendingAt = null; h.acceptedAt = null;
  if (h.timer !== null) clearTimeout(h.timer);
  h.timer = null; netHumanPublish();
}
function netHumanInput(event) {
  if (event.isTrusted !== true || document.hidden
    || typeof document.hasFocus !== 'function' || !document.hasFocus()) return;
  // Startup/activation can change document focus without a window focus event.
  // Only current, trusted input may repair this cached flag; focus alone cannot wake play.
  NET_HUMAN_PLAY.focused = true;
  if (event.type === 'pointermove' && !event.buttons && !event.movementX && !event.movementY) return;
  const h = NET_HUMAN_PLAY;
  if (h.activity >= Number.MAX_SAFE_INTEGER) { netHumanSuspend(); return; }
  h.activity++; h.pendingAt = performance.now();
  // Begin/close-menu handlers may change game state later in the same event.
  queueMicrotask(netHumanSync);
}
for (const type of ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart', 'touchmove', 'click']) {
  document.addEventListener(type, netHumanInput, { capture: true, passive: true });
}
document.addEventListener('visibilitychange', () => {
  if (document.hidden) netHumanSuspend(); else netHumanSync();
});
window.addEventListener('blur', () => { NET_HUMAN_PLAY.focused = false; netHumanSuspend(); });
window.addEventListener('focus', () => { NET_HUMAN_PLAY.focused = true; netHumanSync(); });
window.addEventListener('pagehide', netHumanSuspend);
