import { NATIVE_AGENT_PATHS } from './native-agent-authority.js';
import { NATIVE_OWNER_AGENT_GRANT_SCHEMA } from './native-agent-proof.js';

const descriptions = {
  register: 'Retain only the native grant UUID and graph IRI under the verified owner account. This does not admit an agent.',
  challenge: 'Read the current public owner grant and bind a one-use challenge to its digest, audience and ephemeral Ed25519 public key.',
  complete: 'Verify the actual native signed request and Ed25519 possession, then persist the game-owned admission receipt before returning a session.',
  renew: 'Re-read native grant and delegation with an Ed25519 sequence proof. Failure closes the lease. This is control-plane freshness, not game ping.',
  command: 'Verify local Ed25519 proof and exact sequence, transport, derived action, room and body. The game independently checks current body ownership and domain rules.',
  observe: 'Verify local Ed25519 proof and return only the granted public room view. No private character, chat or inventory is returned.',
  revoke: 'Immediately stop local proof leases and confirm game-owned durable UUID revocation. The owner separately publishes revoked:true in their pod.',
};

export function nativeAgentAffordances({ publicOrigin, applicationId, enabled = false, leaseMs = 10000 } = {}) {
  const origin = new URL(publicOrigin);
  if (origin.protocol !== 'https:' || origin.pathname !== '/' || origin.search || origin.hash || origin.username || origin.password) throw new TypeError('Native agent HTTPS origin required');
  return { '@context': { hydra: 'http://www.w3.org/ns/hydra/core#', iep: 'https://markjspivey-xwisee.github.io/interego/ns/iep#',
      operations: { '@id': 'hydra:supportedOperation', '@container': '@set' } },
    '@id': origin.origin + '/gaming/native-agents', '@type': 'hydra:ApiDocumentation', enabled, applicationId, audience: origin.origin,
    authority: 'game-owned-room', ownerGrant: { primary: 'owner-selected-public-pod-record', schema: NATIVE_OWNER_AGENT_GRANT_SCHEMA,
      registration: { grantId: 'native UUID from owner payload', graphIri: 'stable urn:graph: reference' }, personalData: 'sealed separately in the owner pod' },
    proof: { nativeModes: ['relay-mediated', 'independent-key'], productionReaderModes: ['relay-mediated'], sessionKey: 'Ed25519',
      perCommandNativeReads: 0, nativeReadScope: 'owner-grant-and-agent-proof-control-plane',
      gamePersistence: 'Game-owned strict commits or progressive checkpoints remain independent of native identity proof reads.',
      localBearerIsNativeProof: false, signatureSigners: 'Current native delegation with independently pinned relay anchor; did:web is not an independently held agent key.',
      commandSigning: 'agentCommandMessage(sessionId,{sequence,at,method:"POST",path,action,roomId,entityId,body}) from the reusable proof module. body is {command} for command and {roomId,entityId} for observe. action is derived from command.type.',
      renewalSigning: 'agentRenewalMessage(sessionId,{sequence,at}); command and renewal share one strictly increasing sequence starting at 1.',
      sequenceConsumption: 'Valid proof consumes its sequence even if domain authority later refuses the action.',
      revocation: { model: 'bounded-native-lease', maxPropagationMs: leaseMs, expiryAnchor: 'original native observation before I/O; no authority extension from cache',
        local: 'Immediate local stop; durable game receipt blocks re-admission of the UUID across restarts. Re-grants require a new UUID.' } },
    schemas: { RegisterRequest: { $id: origin.origin + '/gaming/native-agents#RegisterRequest', type: 'object', required: ['grantId', 'graphIri'], additionalProperties: false,
      properties: { grantId: { type: 'string', format: 'uri' }, graphIri: { type: 'string', pattern: '^urn:graph:' } } },
      RevokeRequest: { $id: origin.origin + '/gaming/native-agents#RevokeRequest', type: 'object', required: ['grantId'], additionalProperties: false, properties: { grantId: { type: 'string', format: 'uri' } } } },
    operations: Object.entries(NATIVE_AGENT_PATHS).map(([name, path]) => ({ '@id': origin.origin + '/gaming/native-agents#' + name,
      '@type': 'hydra:Operation', 'iep:action': { '@id': 'urn:interego:gaming:native-agent:' + name },
      'hydra:method': 'POST', 'hydra:target': origin.origin + path, description: descriptions[name],
      ...(['register', 'revoke'].includes(name) ? { 'hydra:expects': { '@id': origin.origin + '/gaming/native-agents#' + (name === 'register' ? 'RegisterRequest' : 'RevokeRequest') } } : {}),
      authentication: ['register', 'revoke'].includes(name) ? 'Fresh host-signed native owner app session and exact same Origin' :
        ['challenge', 'complete'].includes(name) ? 'Native signed challenge plus ephemeral Ed25519 possession; no human bearer' : 'Session ID plus per-request Ed25519 signature; no bearer fallback' })),
    migrationBoundaries: { mainWorldServerAuthority: false, teamPodMigration: false, independentDidWebAgentKeys: false,
      publicRestScale: 'Bounded pilot: relay public REST is limited to 60 requests/minute/IP. cg2 is not accepted as relay MCP OAuth. Native reads are not game RTT.',
      learning: 'A public gameplay relationship does not authorize personal learning export.' } };
}

export function nativeAgentMetadataGraph(document) {
  const literal = value => JSON.stringify(value), subject = document['@id'];
  return '@prefix hydra: <http://www.w3.org/ns/hydra/core#> .\n@prefix schema: <https://schema.org/> .\n'
    + '@prefix iep: <https://markjspivey-xwisee.github.io/interego/ns/iep#> .\n@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .\n'
    + `<${subject}> a hydra:ApiDocumentation ; rdf:value ${literal(JSON.stringify(document))}^^rdf:JSON .\n`
    + Object.values(document.schemas).map(shape => `<${shape.$id}> a schema:CreativeWork ; schema:encodingFormat "application/schema+json" ; schema:text ${literal(JSON.stringify(shape))} .\n`).join('')
    + document.operations.map(op => `<${subject}> hydra:supportedOperation <${op['@id']}> .\n<${op['@id']}> a hydra:Operation ; iep:action <${op['iep:action']['@id']}> ; hydra:method "POST" ; hydra:target <${op['hydra:target']}> ; ${op['hydra:expects'] ? `hydra:expects <${op['hydra:expects']['@id']}> ; ` : ''}schema:description ${literal(op.description)} .\n`).join('');
}

/** Async HTTP handler. A timeout never releases the backend concurrency permit
 * while a non-cancellable native read/commit is still in flight. */
export function createNativeAgentHttp({ authority, accounts, publicOrigin, applicationId, now = Date.now,
  maxConcurrent = 16, maxBody = 16384, timeoutMs = 35000, paths = NATIVE_AGENT_PATHS,
  metadataPath = '/gaming/native-agents', describe = nativeAgentAffordances } = {}) {
  const origin = new URL(publicOrigin).origin;
  nativeAgentAffordances({ publicOrigin, applicationId });
  if (typeof accounts?.ownerForRequest !== 'function' || !Number.isInteger(maxConcurrent) || maxConcurrent < 1 || maxConcurrent > 64
    || !Number.isInteger(maxBody) || maxBody < 1024 || maxBody > 65536 || !Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 60000) throw new TypeError('Bounded native agent HTTP and owner account ports required');
  let active = 0; const rates = new Map();
  const document = () => describe({ publicOrigin, applicationId, enabled: !!authority?.status().enabled,
    leaseMs: authority?.status().leaseMs ?? 10000 });
  return Object.freeze({ metadataGraph() { return nativeAgentMetadataGraph(document()); },
    manifest() { return { enabled: !!authority?.status().enabled, applicationId, audience: origin, affordances: origin + metadataPath,
      authentication: 'native-owner-grant-and-agent-signature', perCommandNativeReads: 0,
      nativeReadScope: 'owner-grant-and-agent-proof-control-plane', leaseMs: authority?.status().leaseMs ?? 10000 }; },
    async handle(req, res, pathname) {
      const operation = Object.entries(paths).find(([, path]) => path === pathname)?.[0];
      const ownerList = pathname === metadataPath + '/owner' && typeof authority?.references === 'function';
      if (!operation && pathname !== metadataPath && !ownerList) return false;
      const reply = (status, body) => { if (res.writableEnded || res.destroyed) return; res.writeHead(status,
        { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' }); res.end(JSON.stringify(body)); };
      if (req.headers.host !== new URL(publicOrigin).host || (req.headers.origin && req.headers.origin !== origin)) { reply(403, { error: 'invalid_native_agent_origin' }); return true; }
      if (ownerList) {
        if (req.method !== 'GET') { reply(405, { error: 'method_not_allowed' }); return true; }
        try { reply(200, { ok: true, result: { references: authority.references(await accounts.ownerForRequest(req)) } }); }
        catch { reply(403, { error: 'native_owner_required' }); }
        return true;
      }
      if (!operation) { if (req.method !== 'GET') reply(405, { error: 'method_not_allowed' }); else reply(200, document()); return true; }
      if (req.method !== 'POST') { reply(405, { error: 'method_not_allowed' }); return true; }
      if (!authority?.status().enabled) { reply(503, { error: 'native_agent_unavailable' }); return true; }
      if (['register', 'revoke'].includes(operation) && req.headers.origin !== origin) { reply(403, { error: 'native_owner_origin_required' }); return true; }
      if (!(req.headers['content-type'] ?? '').toLowerCase().startsWith('application/json')) { reply(415, { error: 'json_body_required' }); return true; }
      const at = now(), key = req.socket?.remoteAddress || 'unknown';
      for (const [id, window] of rates) if (at - window.at >= 1000) rates.delete(id);
      const window = rates.get(key) || { at, count: 0 };
      if (active >= maxConcurrent || (rates.size >= 1024 && !rates.has(key)) || ++window.count > 40) { reply(429, { error: 'native_agent_busy' }); return true; }
      rates.set(key, window); active++; let timer;
      const task = (async () => {
        let size = 0; const chunks = [];
        for await (const chunk of req) { size += chunk.length; if (size > maxBody) throw Object.assign(new Error(), { code: 'native_request_too_large', httpStatus: 413 }); chunks.push(chunk); }
        let body; try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw Object.assign(new Error(), { code: 'invalid_native_json', httpStatus: 400 }); }
        const owner = ['register', 'revoke'].includes(operation) ? await accounts.ownerForRequest(req) : null;
        return owner ? authority[operation](owner, body) : authority[operation](body);
      })();
      task.then(() => { active--; }, () => { active--; });
      try {
        const result = await Promise.race([task, new Promise((_, reject) => { timer = setTimeout(() => {
          reject(Object.assign(new Error(), { code: 'native_request_timeout', httpStatus: 504 }));
          if (!req.complete) req.destroy();
        }, timeoutMs); })]);
        reply(200, { ok: true, result });
      } catch (error) {
        if (error.name === 'HostError' && ['game_account_required', 'native_signin_required', 'native_identity_unavailable'].includes(error.code)) {
          reply([401, 403, 503].includes(error.status) ? error.status : 403, { error: error.code }); return true;
        }
        const known = ['NativeAgentProofError', 'NativeAgentReaderError', 'NativeAgentAuthorityError', 'GameCommandError', 'CompanionError'].includes(error.name);
        const code = known || error.httpStatus ? error.code : 'native_agent_unavailable';
        reply(error.httpStatus || (known ? 403 : 503), { error: code });
      } finally { clearTimeout(timer); }
      return true;
    },
  });
}
