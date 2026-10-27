/* Accepted shared-season treaties. Manual diplomacy never writes the automatic W3 pact. */
const REALM_DIPLOMACY_HARMFUL = new Set(['stun', 'snare', 'root', 'dot', 'burn', 'bleed', 'wound', 'dazzle', 'tracked']);
const REALM_DIPLOMACY = { snapshot: null, rows: null, time: -1, mask: 0 };
function realmManualTreatyMask() {
  // The accepted season clock pauses with the world. Camera/UI time must never
  // expire a treaty or invent a diplomatic decision while disconnected.
  let snapshot;
  try { snapshot = typeof NETS !== 'undefined' ? NETS.s : null; } catch (err) { snapshot = null; }
  const rows = snapshot?.management?.allRelations, time = snapshot?.management?.time;
  if (!Array.isArray(rows) || rows.length > 3 || !Number.isFinite(time) || time < 0) {
    REALM_DIPLOMACY.snapshot = null; REALM_DIPLOMACY.rows = null; REALM_DIPLOMACY.time = -1; REALM_DIPLOMACY.mask = 0;
    return 0;
  }
  if (REALM_DIPLOMACY.snapshot === snapshot && REALM_DIPLOMACY.rows === rows && REALM_DIPLOMACY.time === time) return REALM_DIPLOMACY.mask;
  let mask = 0;
  for (const treaty of rows) {
    const a = treaty?.a, b = treaty?.b;
    if (!Number.isInteger(a) || !Number.isInteger(b) || a < 0 || a > 2 || b < 0 || b > 2 || a === b
      || !['truce', 'trade'].includes(treaty.treaty) || !Number.isFinite(treaty.expires) || treaty.expires <= time) continue;
    mask |= (1 << (a * 3 + b)) | (1 << (b * 3 + a));
  }
  REALM_DIPLOMACY.snapshot = snapshot; REALM_DIPLOMACY.rows = rows; REALM_DIPLOMACY.time = time; REALM_DIPLOMACY.mask = mask;
  return mask;
}
function realmManualTreatiesActive() { return realmManualTreatyMask() !== 0; }
function realmManualAllied(a, b) {
  return Number.isInteger(a) && Number.isInteger(b) && a >= 0 && a <= 2 && b >= 0 && b <= 2 && a !== b
    && !!(realmManualTreatyMask() & (1 << (a * 3 + b)));
}
function realmManualCeasefire(a, b) {
  // Measure bots duel beside the March; their fixtures never become realm diplomacy.
  return !!a && !!b && a.role !== 'bot' && b.role !== 'bot' && realmManualAllied(a.faction, b.faction);
}
function realmDiplomacyCanSimulateWorld() {
  return (typeof netEntityCanSimulateWorld !== 'function' || netEntityCanSimulateWorld())
    && (typeof netWorldPartsCanSimulate !== 'function' || netWorldPartsCanSimulate());
}
function realmManualHostileBuff(kind) { return REALM_DIPLOMACY_HARMFUL.has(kind); }
function realmManualLegacyDotBlocked(victim) {
  if (!victim || victim.role === 'bot' || !Number.isInteger(victim.faction) || victim.faction < 0 || victim.faction > 2) return false;
  const shift = victim.faction * 3;
  return !!(realmManualTreatyMask() & (7 << shift));
}
