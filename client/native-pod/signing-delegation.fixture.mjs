/** Explicit native-signing protocol fixture; no real credentials or I/O. */
export function signingDelegationFixture({ ownerDid, agentDid, podUrl, statusPod = podUrl, scope = 'ReadWrite' }) {
  const slug = new URL(podUrl).pathname.slice(1, -1);
  const webId = 'https://' + ownerDid.slice(8).split(':').map(decodeURIComponent).join('/') + '/profile#me';
  const anchor = '0x' + '1'.repeat(40);
  const result = {
    status: { pod: statusPod, userId: slug, identity: { did: ownerDid, webId }, sessionAgent: { did: agentDid },
      capabilities: { register_agent_repair_only: true },
      delegationRegistry: { owner: webId, url: statusPod + 'agents', count: 1, rows: [{ agentId: agentDid, scope }] } },
    verified: { subjectPodUrl: podUrl, subject_pod_url: podUrl, subject_pod_name: slug, subject_pod_selected_by: 'pod_url',
      valid: true, verified: true, trustLevel: 'CryptographicallyVerified', chainLength: 1,
      delegationChain: { anchored: true, length: 1, owner: webId, agent: agentDid, scope }, owner: webId, agent: agentDid, scope, reason: null,
      enforcement: { enforced: true, writeEligible: true, scope, basis: 'signed-chain', chainReason: null },
      signing: { credentialAgentId: agentDid, relayAnchor: anchor, credentialAnchor: anchor, canSignDelegatedRequests: true } },
  };
  result.missing = structuredClone(result.verified);
  result.missing.valid = result.missing.verified = false;
  result.missing.trustLevel = 'SelfAsserted'; result.missing.chainLength = 0;
  delete result.missing.delegationChain;
  result.missing.reason = 'No signed delegation credential found for ' + agentDid + ' on ' + podUrl;
  result.missing.enforcement.basis = 'registry-only'; result.missing.enforcement.chainReason = result.missing.reason;
  result.missing.signing.canSignDelegatedRequests = false; delete result.missing.signing.credentialAnchor;
  return result;
}
