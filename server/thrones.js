// Live occupancy only: never saved, replayed from world history, or driven by a timer.
export function createThrones({ now, live, sameAdmission }) {
  const seats = new Map(), sequences = new Map();
  let revision = 0;
  const validHall = h => h && Number.isSafeInteger(h.id) && h.id >= 0 && h.id < 4096
    && [0, 1, 2].includes(h.realm) && [h.x, h.y, h.z].every(Number.isFinite) && h.ready === true;
  function eligible(c, h, admission) {
    const f = c?.fast;
    return !!(c && live(c) && sameAdmission(c.worldAdmission, admission) && validHall(h)
      && c.slow?.r === h.realm && c.pos && now() - c.posT <= 5000 && now() >= c.posT
      && f?.d === 0 && !f.cs && Array.isArray(f.p) && Math.abs(f.p[1] - h.y) < 3
      && Math.hypot(c.pos.x - h.x, c.pos.z - h.z) <= 2);
  }
  function prune(room, halls, admission) {
    let changed = false;
    for (const [id, seat] of seats) {
      const c = room.clients.get(seat.peer), h = halls?.find(h => h.id === id);
      if (!eligible(c, h, admission) || now() - seat.at > 3000 && !c.fast.st) {
        seats.delete(id); changed = true;
      }
    }
    for (const peer of sequences.keys()) if (!room.clients.has(peer)) sequences.delete(peer);
    if (changed) revision++;
    return changed;
  }
  function handle(c, m, halls, admission) {
    const prior = sequences.get(c.peer);
    if (!Number.isSafeInteger(m.seq) || m.seq < 1 || m.seq <= (prior?.seq || 0)
      || !Number.isSafeInteger(m.id) || m.id < 0 || m.id >= 4096 || !['claim', 'release'].includes(m.op)) return null;
    const stamp = prior && now() - prior.at < 1000 ? prior : { seq: 0, at: now(), count: 0 };
    if (++stamp.count > 8) return null;
    stamp.seq = m.seq; sequences.set(c.peer, stamp);
    const current = seats.get(m.id);
    if (m.op === 'release') {
      if (current?.peer === c.peer) { seats.delete(m.id); revision++; }
      return { ok: true };
    }
    if (!eligible(c, halls?.find(h => h.id === m.id), admission)) return { ok: false, reason: 'The high seat is unavailable. Stand near an intact hall held by your realm.' };
    if (current && current.peer !== c.peer) return { ok: false, reason: 'Another commander occupies this high seat.' };
    if ([...seats.values()].some(s => s.peer === c.peer)) return { ok: false, reason: 'Leave your current high seat first.' };
    seats.set(m.id, { peer: c.peer, at: now() }); revision++;
    return { ok: true };
  }
  return { prune, handle, held: (peer, id) => seats.get(id)?.peer === peer,
    snapshot: () => ({ revision, seats: [...seats].map(([id, s]) => ({ id, peer: s.peer })) }) };
}
