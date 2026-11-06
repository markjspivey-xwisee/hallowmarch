// Opt-in diagnostic only. Install with page.addInitScript before navigation;
// keep clean native timing controls separate. This never creates/queries GL.
export function installReadinessResponsivenessProbe() {
  if (window.__readinessResponsive) throw Error('Responsiveness probe already installed.');
  const state = { version: 1, startedAt: performance.now(), stoppedAt: null,
    kind: 'callback/input/frame-opportunity evidence; not INP or presentation proof',
    firstRafDelayMs: null, frames: { visible: 0, background: 0, maxCallbackGapMs: 0, maxTimestampGapMs: 0, maxCallbackLagMs: 0,
      // Histogram contains visible callback intervals only, in the listed bins.
      binsMs: [20, 50, 100, 250, 1000, null], histogram: [0, 0, 0, 0, 0, 0], worst: [] },
    observations: [], inputs: [], syntheticInputsIgnored: 0, excessInputs: 0,
    longTasks: { supported: false, count: 0, totalMs: 0, maxMs: 0, worst: [] },
    longAnimationFrames: { supported: false, unavailableReason: null, count: 0, maxMs: 0, worst: [] },
    eventTiming: { supported: false, count: 0, worst: [] } };
  const pendingFrames = new Set(), observers = [];
  let stopped = false, previous = null, lastObservation = '', activeInput = null, acknowledgment = null, hiddenSinceFrame = !!document.hidden;
  const observe = () => ({ phase: window.__hmStartup?.titlePreparing ? 'program preparation'
    : window.__hmStartup?.titleStage || window.__hmStartup?.phase || 'module',
  hidden: !!document.hidden, focused: typeof document.hasFocus === 'function' && document.hasFocus() });
  const rememberObservation = (at, observation) => {
    const key = JSON.stringify(observation);
    if (key !== lastObservation && state.observations.length < 256) {
      state.observations.push({ observedAt: at, ...observation }); lastObservation = key;
    }
  };
  const worst = (rows, row, field, limit = 32) => { rows.push(row); rows.sort((a, b) => b[field] - a[field]); if (rows.length > limit) rows.length = limit; };
  const frame = callback => {
    const id = requestAnimationFrame(timestamp => { pendingFrames.delete(id); if (!stopped) callback(timestamp); });
    pendingFrames.add(id); return id;
  };
  const cadence = timestamp => {
    const at = performance.now(), observation = observe(); rememberObservation(at, observation);
    if (!previous) state.firstRafDelayMs = at - state.startedAt;
    else {
      const gap = Math.max(0, at - previous.at), timestampGap = Math.max(0, timestamp - previous.timestamp);
      const visible = !previous.observation.hidden && !observation.hidden && !hiddenSinceFrame;
      if (visible) {
        state.frames.visible++;
        state.frames.maxCallbackGapMs = Math.max(state.frames.maxCallbackGapMs, gap);
        state.frames.maxTimestampGapMs = Math.max(state.frames.maxTimestampGapMs, timestampGap);
        state.frames.maxCallbackLagMs = Math.max(state.frames.maxCallbackLagMs, Math.max(0, at - timestamp));
        const bin = state.frames.binsMs.findIndex(bound => bound === null || gap <= bound); state.frames.histogram[bin]++;
      } else state.frames.background++;
      if (gap > 50) worst(state.frames.worst, { start: previous.at, end: at, ms: gap, timestampGapMs: timestampGap,
        visible, phaseFrom: previous.observation.phase, phaseTo: observation.phase,
        focusedFrom: previous.observation.focused, focusedTo: observation.focused }, 'ms');
    }
    previous = { at, timestamp, observation }; hiddenSinceFrame = observation.hidden; frame(cadence);
  };
  const ensureAcknowledgment = () => {
    if (acknowledgment || !document.documentElement || stopped) return;
    acknowledgment = document.createElement('output'); acknowledgment.setAttribute('aria-hidden', 'true');
    acknowledgment.style.cssText = 'position:fixed;right:8px;bottom:8px;z-index:2147483647;pointer-events:none;background:#111;color:#fff;padding:4px;font:12px sans-serif';
    acknowledgment.textContent = 'Startup input check'; document.documentElement.appendChild(acknowledgment);
  };
  const onKey = event => {
    if (event.code !== 'F8') return;
    // Consume only this diagnostic's unbound key, before game/audio/human-play
    // listeners. Native event delivery remains real; no game activity is forged.
    event.preventDefault(); event.stopImmediatePropagation();
    if (event.isTrusted !== true) { state.syntheticInputsIgnored++; return; }
    const at = performance.now(), observation = observe(); rememberObservation(at, observation);
    if (event.type === 'keyup') { if (activeInput) activeInput.keyupAt = at; activeInput = null; return; }
    if (event.repeat || state.inputs.length >= 12) { state.excessInputs++; return; }
    const raw = event.timeStamp, epochRelative = raw - performance.timeOrigin;
    const eventAt = Number.isFinite(raw) && raw > 0 && raw <= at ? raw
      : Number.isFinite(epochRelative) && epochRelative > 0 && epochRelative <= at ? epochRelative : null;
    const input = { ordinal: state.inputs.length + 1, trusted: true, handlerAt: at, eventAt,
      inputDelayMs: eventAt === null ? null : at - eventAt, ...observation,
      nextFrameOpportunityMs: null, secondFrameOpportunityMs: null, keyupAt: null };
    state.inputs.push(input); activeInput = input; ensureAcknowledgment();
    if (acknowledgment) acknowledgment.textContent = 'Startup input check ' + input.ordinal;
    frame(() => { input.nextFrameOpportunityMs = performance.now() - at;
      frame(() => { input.secondFrameOpportunityMs = performance.now() - at; }); });
  };
  const visibility = () => { if (document.hidden) hiddenSinceFrame = true; rememberObservation(performance.now(), observe()); };
  window.addEventListener('keydown', onKey, true); window.addEventListener('keyup', onKey, true);
  document.addEventListener('visibilitychange', visibility);
  document.addEventListener('DOMContentLoaded', ensureAcknowledgment, { once: true });
  const observer = (type, receive, options) => {
    try {
      if (Array.isArray(PerformanceObserver.supportedEntryTypes) && !PerformanceObserver.supportedEntryTypes.includes(type)) return false;
      const value = new PerformanceObserver(list => { if (!stopped) for (const entry of list.getEntries()) receive(entry); });
      value.observe({ type, buffered: true, ...options }); observers.push(value); return true;
    } catch { return false; }
  };
  state.longTasks.supported = observer('longtask', entry => {
    state.longTasks.count++; state.longTasks.totalMs += entry.duration; state.longTasks.maxMs = Math.max(state.longTasks.maxMs, entry.duration);
    worst(state.longTasks.worst, { start: entry.startTime, ms: entry.duration, deliveryAt: performance.now(),
      deliveryPhase: observe().phase, name: entry.name }, 'ms');
  });
  state.longAnimationFrames.supported = observer('long-animation-frame', entry => {
    state.longAnimationFrames.count++; state.longAnimationFrames.maxMs = Math.max(state.longAnimationFrames.maxMs, entry.duration);
    const scripts = entry.scripts || [], number = value => Number.isFinite(value) ? value : null;
    const selected = Array.prototype.slice.call(scripts, 0, 32).sort((a, b) => b.duration - a.duration).slice(0, 8);
    worst(state.longAnimationFrames.worst, { start: entry.startTime, ms: entry.duration,
      blockingMs: number(entry.blockingDuration), renderStart: number(entry.renderStart), styleAndLayoutStart: number(entry.styleAndLayoutStart),
      styleMs: number(entry.styleDuration), layoutMs: number(entry.layoutDuration), firstUIEventAt: number(entry.firstUIEventTimestamp),
      deliveryAt: performance.now(), deliveryPhase: observe().phase, scriptCount: scripts.length, scriptsTruncated: scripts.length > selected.length,
      scripts: selected.map(script => ({ start: number(script.startTime), ms: number(script.duration), executionStart: number(script.executionStart),
        forcedStyleAndLayoutMs: number(script.forcedStyleAndLayoutDuration), pauseMs: number(script.pauseDuration),
        invoker: String(script.invoker || '').slice(0, 150), invokerType: String(script.invokerType || '').slice(0, 80),
        sourceURL: String(script.sourceURL || '').slice(0, 500), sourceFunctionName: String(script.sourceFunctionName || '').slice(0, 100),
        sourceCharPosition: number(script.sourceCharPosition) })) }, 'ms', 16);
  });
  if (!state.longAnimationFrames.supported) state.longAnimationFrames.unavailableReason = 'unsupported-or-observer-registration-failed';
  state.eventTiming.supported = observer('event', entry => {
    state.eventTiming.count++;
    worst(state.eventTiming.worst, { name: entry.name, start: entry.startTime, durationMs: entry.duration,
      inputDelayMs: Math.max(0, entry.processingStart - entry.startTime), handlerMs: Math.max(0, entry.processingEnd - entry.processingStart),
      interactionId: entry.interactionId || 0 }, 'durationMs');
  }, { durationThreshold: 16 });
  const snapshot = () => JSON.parse(JSON.stringify(state));
  window.__readinessResponsive = { snapshot, stop() {
    if (!stopped) {
      stopped = true; state.stoppedAt = performance.now();
      for (const id of pendingFrames) cancelAnimationFrame(id); pendingFrames.clear();
      for (const value of observers) value.disconnect();
      window.removeEventListener('keydown', onKey, true); window.removeEventListener('keyup', onKey, true);
      document.removeEventListener('visibilitychange', visibility); document.removeEventListener('DOMContentLoaded', ensureAcknowledgment);
      acknowledgment?.remove(); acknowledgment = null;
    }
    return snapshot();
  } };
  rememberObservation(performance.now(), observe()); frame(cadence);
}

// Run independently of page.evaluate polling. A pending key command is bounded
// by Node's clock; on timeout stop submitting rather than retry/overlap inputs.
export async function sampleTrustedReadinessInputs(page, { maxSamples = 12, intervalMs = 4000, timeoutMs = 2000, signal } = {}) {
  if (!Number.isInteger(maxSamples) || maxSamples < 1 || maxSamples > 12
    || !Number.isFinite(intervalMs) || intervalMs < 1 || intervalMs > 60000
    || !Number.isFinite(timeoutMs) || timeoutMs < 1 || timeoutMs > 10000) throw Error('Invalid bounded input sampling options.');
  const result = { key: 'F8', clock: 'Node elapsed time; compare browser event timestamps separately', samples: [], aborted: false, timedOut: false };
  for (let ordinal = 1; ordinal <= maxSamples; ordinal++) {
    if (signal?.aborted) { result.aborted = true; break; }
    const sentAt = performance.now(); let timer;
    try {
      await Promise.race([page.keyboard.press('F8'), new Promise((_, reject) => { timer = setTimeout(() => reject(Error('Trusted input command timed out.')), timeoutMs); })]);
      result.samples.push({ ordinal, sentAt, commandMs: performance.now() - sentAt, deliveredCommand: true });
    } catch (error) {
      result.timedOut = String(error.message).includes('timed out');
      result.samples.push({ ordinal, sentAt, commandMs: performance.now() - sentAt, deliveredCommand: false, error: String(error.message) }); break;
    } finally { clearTimeout(timer); }
    if (ordinal === maxSamples) break;
    const continued = await new Promise(resolve => {
      let wait;
      const done = value => { clearTimeout(wait); signal?.removeEventListener('abort', abort); resolve(value); };
      const abort = () => done(false);
      if (signal?.aborted) { resolve(false); return; }
      signal?.addEventListener('abort', abort, { once: true }); wait = setTimeout(() => done(true), intervalMs);
    });
    if (!continued) { result.aborted = true; break; }
  }
  return result;
}
