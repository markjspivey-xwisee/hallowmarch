// A connected socket, agent, or repeated frame is not proof of live human play.
export function createHumanPlayGate({ clock = Date.now, leaseMs = 90000, onChange = () => {},
  onSessionEnd = () => {}, setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  if (typeof clock !== 'function' || !Number.isSafeInteger(leaseMs) || leaseMs < 1000 || leaseMs > 90000)
    throw new TypeError('A bounded human activity lease is required.');
  const leases = new Map(), counters = new WeakMap();
  let timer = null, active = false, closed = false;
  const eligible = c => !!(c?.acct && c.room && !c.room.diagnostic && !c.acct.diagnostic
    && !c.gamingAgent && !c.humanAgentMode && !c.agent && !c.bot && !c.diagnostic);
  const isPlaying = c => eligible(c) && (leases.get(c)?.until ?? 0) > clock();
  const count = () => [...leases.keys()].filter(isPlaying).length;
  function end(c) {
    if (!leases.has(c)) return;
    onSessionEnd(c);
    leases.delete(c);
  }
  function sync() {
    if (timer !== null) clearTimer(timer);
    timer = null;
    const now = clock();
    for (const [c, lease] of leases) if (lease.until <= now || !eligible(c)) end(c);
    const next = !closed && leases.size > 0;
    if (next !== active) { active = next; onChange(next); }
    if (!closed && leases.size) {
      const delay = Math.max(1, Math.min(...[...leases.values()].map(v => v.until)) - clock());
      timer = setTimer(() => { timer = null; sync(); }, delay);
      timer?.unref?.();
    }
  }
  function update(c, profile) {
    if (closed) return false;
    if (!eligible(c) || !profile || profile.on !== 1 || profile.humanLive !== 1
      || !Number.isSafeInteger(profile.humanActivity) || profile.humanActivity < 1) {
      end(c); sync(); return false;
    }
    const previous = counters.get(c) ?? 0;
    if (profile.humanActivity > previous) {
      counters.set(c, profile.humanActivity);
      leases.set(c, { until: clock() + leaseMs });
    }
    sync();
    return isPlaying(c);
  }
  function forget(c) { end(c); sync(); }
  function close() {
    closed = true;
    for (const c of [...leases.keys()]) end(c);
    sync();
  }
  return { update, forget, close, isPlaying, count, status: () => ({
    active: count() > 0, players: count(), leaseMs, mode: count() ? 'live' : 'standby',
  }) };
}
