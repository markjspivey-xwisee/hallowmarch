// A transient seat claim, scoped to the current admitted socket and authority.
const NET_THRONES = { authority: '', revision: -1, seq: 0, seats: [], pending: null };
function netThroneSend(op, id) {
  if (!netEntityLive() || !NET_THRONES.authority) return false;
  return netWsSend({ t: 'activity', kind: 'thrones', op, id, seq: ++NET_THRONES.seq,
    authority: NET_THRONES.authority, worldAdmission: netCurrentWorldAdmission() });
}
function netThroneClaim(H) {
  if (NET_THRONES.pending) return;
  if (typeof netSendFast === 'function') { NET.fastKey = ''; NET.fastAt = -Infinity; netSendFast(performance.now()); }
  if (!netThroneSend('claim', H.num)) { uiError('Connect to the shared March before taking the high seat.'); return; }
  NET_THRONES.pending = { H, seq: NET_THRONES.seq, at: performance.now() };
  uiToast('Requesting the high seat…');
}
function netThroneHeld(H) {
  return netEntityLive() && !!NET_THRONES.authority
    && NET_THRONES.seats.some(s => s.id === H.num && s.peer === NET.self);
}
function netThroneReset() {
  NET_THRONES.authority = ''; NET_THRONES.revision = -1;
  NET_THRONES.seats = []; NET_THRONES.pending = null;
  if (HALL.sit) hallLeave(false);
}
function netThroneMessage(m) {
  if (!m || m.t !== 'activity' || !['authority', 'thrones'].includes(m.kind)
    || !netSameWorldAdmission(netCurrentWorldAdmission(), m.worldAdmission)) return;
  if (m.kind === 'authority') {
    if (typeof m.authority !== 'string' || !m.authority || typeof m.peer !== 'string' || m.peer.length > 128) return;
    if (NET_THRONES.authority !== m.authority) {
      NET_THRONES.pending = null; NET_THRONES.revision = -1; NET_THRONES.seats = [];
      NET_THRONES.authority = m.authority;
    }
  } else if (m.authority !== NET_THRONES.authority) return;
  const data = m.kind === 'authority' ? m.thrones : m;
  if (!data || !Number.isSafeInteger(data.revision) || data.revision < NET_THRONES.revision
    || !Array.isArray(data.seats) || data.seats.length > 6
    || !data.seats.every(s => Number.isSafeInteger(s.id) && s.id >= 0 && s.id < 4096
      && typeof s.peer === 'string' && s.peer.length <= 128)) return;
  NET_THRONES.revision = data.revision; NET_THRONES.seats = data.seats;
  if (HALL.sit && !netThroneHeld(HALL.sit.H)) {
    hallLeave(false); uiToast('You have left the high seat.');
  }
  const p = NET_THRONES.pending;
  if (m.kind === 'authority' && !p && !HALL.sit) {
    const orphan = NET_THRONES.seats.find(s => s.peer === NET.self);
    if (orphan) netThroneSend('release', orphan.id);
  }
  if (p && m.request === p.seq && m.id === p.H.num) {
    NET_THRONES.pending = null;
    if (m.ok && netThroneHeld(p.H) && hallSeatAvailable(p.H)) hallSitConfirmed(p.H);
    else { netThroneSend('release', p.H.num); uiError(m.reason || 'The high seat is no longer available.'); }
  }
}
function netThroneUpdate() {
  const p = NET_THRONES.pending;
  if (p && (!hallSeatAvailable(p.H) || performance.now() - p.at > 8000)) {
    NET_THRONES.pending = null; netThroneSend('release', p.H.num);
    uiError('The high seat request ended. You can try again.');
  }
}
