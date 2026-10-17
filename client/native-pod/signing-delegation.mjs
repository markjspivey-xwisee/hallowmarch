/** Explicit native signing setup. Reads and private-key recovery must not call
 * this helper. A repair writes only the current principal's missing credential
 * through the advertised repair-only protocol; it never rewrites the registry. */
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value)
  && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const writeScopes = new Set(['ReadWrite', 'PublishOnly']);
const address = value => typeof value === 'string' && /^0x[0-9a-fA-F]{40}$/.test(value);
const absent = value => value === null || value === undefined;
const fail = code => { throw Object.assign(new Error('Native signing delegation could not be confirmed.'), { name: 'NativeSigningDelegationError', code }); };
function pod(value, secure = false) {
  let result; try { result = new URL(value); } catch { fail('native_signing_contract'); }
  if (!(secure ? result.protocol === 'https:' : ['https:', 'http:'].includes(result.protocol))
    || result.href !== value || result.username || result.password || result.search || result.hash
    || !/^\/[A-Za-z0-9_-]+\/$/.test(result.pathname)) fail('native_signing_contract');
  return result;
}

/** callTool is the caller's already authenticated native wrapper. ensure() is
 * an explicit setup action, not a generic transport hook. A dispatched repair
 * remains fenced for this helper's lifetime, including a lost acknowledgement.
 * Repair-only writes no registry authority. Credential issuance/readback and
 * concurrent owner registry updates remain separate operations. */
export function createNativeSigningDelegation({ ownerDid, podUrl, agentDid, callTool, now = Date.now } = {}) {
  const owner = typeof ownerDid === 'string' && /^did:web:([^:]+):users:([A-Za-z0-9_-]+)$/.exec(ownerDid);
  if (!owner || typeof agentDid !== 'string' || !/^did:web:[^\s<>"{}|^`\\]{1,1024}$/.test(agentDid)
    || typeof callTool !== 'function' || typeof now !== 'function') fail('native_signing_configuration');
  let canonicalPod, webId;
  try {
    canonicalPod = pod(podUrl, true);
    const identity = new URL('https://' + decodeURIComponent(owner[1]));
    if (identity.pathname !== '/' || identity.search || identity.hash || identity.username || identity.password
      || canonicalPod.pathname !== '/' + owner[2] + '/') fail('native_signing_configuration');
    webId = identity.origin + '/users/' + owner[2] + '/profile#me';
  } catch { fail('native_signing_configuration'); }
  const slug = owner[2];
  let flight = null, verified = false, repairAttempted = false;
  const status = () => ({ verified, repairAttempted, repairPending: repairAttempted && !verified, busy: !!flight });
  async function tool(name, args) {
    let result; try { result = await callTool(name, args); }
    catch (error) { fail(error?.code === 'needs_reauth' ? 'needs_reauth' : 'native_signing_unavailable'); }
    if (!plain(result) || result.error) fail('native_signing_contract');
    return result;
  }
  async function inspect() {
    const currentTime = now();
    if (!Number.isFinite(currentTime)) fail('native_signing_configuration');
    const actual = await tool('get_pod_status', {});
    let actualPod; try { actualPod = pod(actual.pod); } catch { fail('native_signing_identity_mismatch'); }
    if (actual.userId !== slug || actual.identity?.did !== ownerDid || actual.sessionAgent?.did !== agentDid
      || actualPod.pathname !== canonicalPod.pathname || actual.identity?.webId !== undefined && actual.identity.webId !== webId
      || actual.webId !== undefined && actual.webId !== webId) fail('native_signing_identity_mismatch');
    const registry = actual.delegationRegistry;
    if (!plain(registry) || registry.owner !== webId || registry.url !== actualPod.href + 'agents'
      || !Array.isArray(registry.rows) || registry.count !== registry.rows.length
      || actual.registry?.owner !== undefined && actual.registry.owner !== webId) fail('native_signing_delegation_required');
    const matches = registry.rows.filter(row => plain(row) && row.agentId === agentDid);
    const row = matches.length === 1 ? matches[0] : null;
    if (!row || row.revoked !== undefined && row.revoked !== false || !writeScopes.has(row.scope)
      || row.validFrom !== undefined && (typeof row.validFrom !== 'string' || !Number.isFinite(Date.parse(row.validFrom)) || Date.parse(row.validFrom) > currentTime)) fail('native_signing_delegation_required');
    const verdict = await tool('verify_agent', { agent_id: agentDid, pod_url: canonicalPod.href });
    const roots = new Set([canonicalPod.href, actualPod.href]);
    if (!roots.has(verdict.subjectPodUrl) || verdict.subject_pod_url !== verdict.subjectPodUrl
      || verdict.subject_pod_name !== slug || verdict.subject_pod_selected_by !== 'pod_url'
      || verdict.owner !== webId || verdict.agent !== agentDid || !plain(verdict.enforcement) || !plain(verdict.signing)) fail('native_signing_delegation_required');
    const enforcement = verdict.enforcement, signing = verdict.signing;
    if (enforcement.enforced !== true || enforcement.writeEligible !== true || enforcement.scope !== row.scope
      || signing.credentialAgentId !== agentDid || !address(signing.relayAnchor)) fail('native_signing_delegation_required');
    const chain = verdict.delegationChain;
    const ready = verdict.valid === true && verdict.verified === true && verdict.trustLevel === 'CryptographicallyVerified'
      && verdict.chainLength === 1 && plain(chain) && chain.anchored === true && chain.length === 1
      && chain.owner === webId && chain.agent === agentDid && chain.scope === row.scope && verdict.scope === row.scope
      && absent(verdict.reason) && enforcement.basis === 'signed-chain' && absent(enforcement.chainReason)
      && signing.canSignDelegatedRequests === true && address(signing.credentialAnchor)
      && signing.credentialAnchor.toLowerCase() === signing.relayAnchor.toLowerCase();
    const missingReasons = [...roots].map(root => 'No signed delegation credential found for ' + agentDid + ' on ' + root);
    const repairable = verdict.valid === false && verdict.verified === false && verdict.trustLevel === 'SelfAsserted'
      && verdict.chainLength === 0 && absent(chain) && missingReasons.includes(verdict.reason)
      && enforcement.basis === 'registry-only' && enforcement.chainReason === verdict.reason
      && signing.canSignDelegatedRequests === false && absent(signing.credentialAnchor);
    return { ready, repairable, capability: actual.capabilities?.register_agent_repair_only === true };
  }
  async function ensure() {
    verified = false;
    const before = await inspect();
    if (before.ready) { verified = true; return status(); }
    if (!before.repairable) fail('native_signing_delegation_required');
    if (repairAttempted) fail('native_signing_repair_pending');
    if (!before.capability) fail('native_signing_repair_unavailable');
    // Set before dispatch. A rejected promise is not evidence of no write.
    repairAttempted = true;
    try { await callTool('register_agent', { agent_id: agentDid, pod_name: slug, repair_only: true }); }
    catch { /* Only a fresh complete verdict can confirm a possibly committed repair. */ }
    const after = await inspect();
    if (!after.ready) fail('native_signing_repair_pending');
    verified = true; return status();
  }
  return Object.freeze({ status, ensure() {
    if (flight) return flight;
    const run = Promise.resolve().then(ensure).then(() => {
      if (flight === run) flight = null;
      return status();
    }, error => { if (flight === run) flight = null; throw error; });
    flight = run; return run;
  } });
}
