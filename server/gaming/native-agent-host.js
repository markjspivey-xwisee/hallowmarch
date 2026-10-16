/** Deployment composition. Public peer reads do not use the game's cg2 bearer:
 * the actual relay MCP transport accepts relay OAuth credentials only. */
import { createNativeAgentProofReaders } from './native-agent-readers.js';
import { createNativeAgentAuthority } from './native-agent-authority.js';
import { createNativeAgentHttp } from './native-agent-http.js';
import { createMainWorldAgents, WORLD_AGENT_PATHS, mainWorldAgentAffordances } from './main-world-agents.js';

export async function configuredNativeAgentHost({ gaming, accounts, environment = process.env, modules = {}, worldControl = null } = {}) {
  const publicOrigin = environment.HM_PUBLIC_ORIGIN || (environment.RAILWAY_PUBLIC_DOMAIN
    ? 'https://' + environment.RAILWAY_PUBLIC_DOMAIN : 'https://march-production-f6d9.up.railway.app');
  const applicationId = environment.HM_GAMING_NATIVE_OWNER;
  let authority = null, readers = null, state = 'unconfigured';
  // Pinning is deliberate configuration, never trust-on-first-use from an
  // actor-controlled DID document or a copied credential label.
  if (gaming?.manifest().enabled && environment.HM_NATIVE_AGENT_ENABLED === '1'
    && applicationId && environment.HM_NATIVE_AGENT_RELAY_SIGNER_DID) {
    try {
      const nativeCore = modules.core || await import('@interego/core'), nativeSolid = modules.solid || await import('@interego/solid');
      readers = createNativeAgentProofReaders({ nativeCore, nativeSolid,
        operationsUrl: environment.HM_NATIVE_AGENT_OPERATIONS_URL || 'https://relay.interego.xwisee.com/.well-known/operations',
        identityOrigin: environment.HM_GAMING_SERVICE_IDENTITY_ORIGIN || 'https://identity.interego.xwisee.com',
        storeBases: [environment.HM_GAMING_PUBLIC_GATE_ORIGIN || 'https://gate.interego.xwisee.com/',
          ...(environment.HM_NATIVE_AGENT_STORE_ALIASES ? JSON.parse(environment.HM_NATIVE_AGENT_STORE_ALIASES) : ['http://css.railway.internal:3456/'])].map(value => value.endsWith('/') ? value : value + '/'),
        relaySigningDid: environment.HM_NATIVE_AGENT_RELAY_SIGNER_DID,
        lookupOwnerGrant: query => { if (!authority) throw new Error('Native authority unavailable'); return authority.lookupOwnerGrant(query); },
        ...(modules.fetch ? { fetch: modules.fetch } : {}) });
      const options = { gaming, accounts, applicationId, audience: publicOrigin,
        nativeCore, readOwnerGrantHead: readers.readOwnerGrantHead, resolveAgentProof: readers.resolveAgentProof,
        // Pilot bound remains 10s until the deployment has measured native
        // source freshness and explicitly advertised a different bound.
        leaseMs: 10000, requestTimeoutMs: 10000 };
      authority = worldControl ? await createMainWorldAgents({ ...options, ...worldControl }) : createNativeAgentAuthority(options);
      state = 'discovering';
      void readers.ready.then(() => { state = 'ready'; }, () => { state = 'native-read-unavailable'; });
    } catch { readers?.close(); authority?.close(); authority = null; readers = null; state = 'configuration-unavailable'; }
  }
  const http = createNativeAgentHttp({ authority, accounts, publicOrigin, applicationId,
    ...(worldControl ? { paths: WORLD_AGENT_PATHS, metadataPath: '/world/native-agents', describe: mainWorldAgentAffordances } : {}) });
  return Object.freeze({ ...http,
    status() { return { enabled: !!authority, state, ...(authority ? authority.status() : {}), publicReads: 'bounded-rest-pilot', perCommandNativeReads: 0 }; },
    close() { readers?.close(); return authority?.close(); },
  });
}
