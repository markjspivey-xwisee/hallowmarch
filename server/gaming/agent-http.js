import { createHash } from 'node:crypto';

/** HTTP affordances for agents that cannot hold the game's WebSocket. A human
 * must first issue a narrow capability in the game. No game-account bearer,
 * operator identity or unrestricted agent session is accepted by this route.
 */
export function gamingAgentAffordances(base = '') {
  return { '@context': { hydra: 'http://www.w3.org/ns/hydra/core#', iep: 'https://markjspivey-xwisee.github.io/interego/ns/iep#' },
    '@id': `${base}/gaming/agents`, '@type': 'hydra:ApiDocumentation', protocol: 'interego-gaming.v1',
    authority: 'server', tokenAcquisition: 'Human owner grants a companion capability in Shared expedition.',
    authentication: { scheme: 'Bearer', permissions: 'Exact room, body, actions, expiry and rate from the human grant.' },
    affordances: [
      { action: 'urn:interego:gaming:observe', target: `${base}/gaming/agent/observe`, method: 'POST',
        input: { roomId: 'march-proof', entityId: 'the-granted-body' }, returns: 'A redacted authoritative live snapshot with explicit liveSequence, durableSequence and persistence status.' },
      { action: 'urn:interego:gaming:command', target: `${base}/gaming/agent/command`, method: 'POST',
        input: { command: { commandId: 'unique-request-id', type: 'move|attack|claimLoot', roomId: 'march-proof', entityId: 'the-granted-body', x: 'number for move', z: 'number for move', targetId: 'enemy for attack or loot' } },
        returns: 'An authoritative command result or refusal. Movement and combat may return durable:false while a background checkpoint saves. claimLoot waits for durable confirmation. Retries reuse the exact commandId and body.' },
    ],
    persistence: { live: 'Immediate server authority', saved: 'durableSequence confirms the saved prefix',
      uncertainty: 'A durability_pending refusal can mean an action is applied but unconfirmed; observe before retrying.' },
    learning: { export: 'disabled without a separately verified subject identity and current session consent', competencyClaims: false },
  };
}

export function createAgentHttp({ gaming, now = Date.now, maxConcurrent = 16, maxBody = 8192, timeoutMs = 35000 } = {}) {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60000) throw new TypeError('Agent HTTP timeout must be 1..60000 milliseconds.');
  let active = 0; const rate = new Map();
  return function handle(req, res, pathname) {
    if (!['/gaming/agent/observe', '/gaming/agent/command'].includes(pathname)) return false;
    const reply = (status, body) => { if (res.writableEnded || res.destroyed) return; res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(body)); };
    if (req.method !== 'POST') { reply(405, { error: 'method_not_allowed' }); return true; }
    if (gaming.manifest().nativeAgentsRequired) { reply(403, { error: 'native_agent_proof_required', affordance: '/gaming/native-agents' }); return true; }
    if (!gaming.manifest().enabled) { reply(503, { error: 'native_service_unavailable' }); return true; }
    const header = req.headers.authorization;
    if (typeof header !== 'string' || !/^Bearer hmca_[A-Za-z0-9_-]{43}$/.test(header)) { reply(401, { error: 'companion_capability_required' }); return true; }
    const token = header.slice(7), hash = createHash('sha256').update(token).digest('hex'), at = now();
    for (const [key, window] of rate) if (at - window.at >= 1000) rate.delete(key);
    const window = rate.get(hash) || { at, n: 0 };
    if (rate.size >= 1024 && !rate.has(hash)) { reply(429, { error: 'busy' }); return true; }
    if (++window.n > 20 || active >= maxConcurrent) { reply(429, { error: 'rate_limited' }); return true; }
    rate.set(hash, window); active++;
    let bytes = 0, body = '', finished = false, handling = false, released = false;
    const release = () => { if (released) return; released = true; active--; };
    const done = () => {
      if (finished) return;
      finished = true; clearTimeout(timer);
      // Ending an HTTP response cannot cancel a command already queued at the
      // durable service. Its backend permit remains held until handle settles.
      if (!handling) release();
    };
    const timer = setTimeout(() => { reply(408, { error: 'request_timeout' }); done(); req.destroy(); }, timeoutMs);
    req.on('aborted', done); req.on('error', () => { reply(400, { error: 'request_failed' }); done(); });
    req.on('data', chunk => {
      if (finished) return;
      bytes += chunk.length;
      if (bytes > maxBody) { reply(413, { error: 'payload_too_large' }); done(); req.destroy(); return; }
      body += chunk.toString('utf8');
    });
    req.on('end', async () => {
      if (finished) return;
      try {
        let data; try { data = JSON.parse(body); } catch { reply(400, { error: 'invalid_json' }); return; }
        if (!data || typeof data !== 'object' || Array.isArray(data)) { reply(400, { error: 'invalid_request' }); return; }
        const op = pathname.endsWith('/observe') ? 'agent.observe' : 'agent.command';
        const c = { ws: { readyState: 1 }, gamingReply(message) {
          const code = message.ok ? 200 : ['unauthenticated', 'invalid_capability', 'invalid_token', 'unknown_grant', 'expired', 'revoked'].includes(message.error?.code) ? 403 : 409;
          reply(code, message);
        } };
        handling = true;
        await gaming.handle(c, { t: 'gaming', op, token, entityId: data.entityId,
          command: data.command, requestId: data.command?.commandId || 'observe' });
      } catch { reply(503, { error: 'game_service_unavailable' }); }
      finally { done(); release(); }
    });
    return true;
  };
}
