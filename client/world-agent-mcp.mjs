/** Stdio/tool protocol port over the reviewed world-agent client. No I/O occurs
 * on import; the trusted host supplies the native signing capability. */
import { createWorldAgentClient, WorldAgentClientError } from './world-agent-client.mjs';

const plain = v => v !== null && typeof v === 'object' && !Array.isArray(v)
  && [Object.prototype, null].includes(Object.getPrototypeOf(v));
const exact = (v, keys) => plain(v) && Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k));
const schema = properties => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
const noArgs = schema({});
const tools = [
  ['march_connect', 'Connect only to the separate companion selected in the host’s public connection file. Uses this agent host’s own native signing callback. Reconnect explicitly after uncertainty; do not replay an old move.', noArgs],
  ['march_observe', 'Read the granted companion’s current public pose and nearby hostiles. This is owner-page observation, not verified damage, learning or competency.', noArgs],
  ['march_move', 'Apply one bounded movement input to your granted companion. The owner game must be open, focused and unpaused. Acknowledgement means input applied, not a verified outcome.', schema({ dx: { type: 'number', minimum: -1, maximum: 1 }, dz: { type: 'number', minimum: -1, maximum: 1 }, durationMs: { type: 'integer', minimum: 50, maximum: 500 } })],
  ['march_attack', 'Apply one ordinary attack input against an actual current visible hostile target ID from march_observe. Never controls the human character.', schema({ targetId: { type: 'string', minLength: 1, maxLength: 128 } })],
  ['march_renew', 'Recheck the current owner grant and this agent’s native delegation. No input is automatically replayed when renewal fails.', noArgs],
  ['march_status', 'Show public local connection status without keys, credentials, native envelopes or private character data.', noArgs],
  ['march_disconnect', 'Close this host’s local companion connection and drop its ephemeral key reference. The owner separately pauses or revokes access in the game and pod.', noArgs],
].map(([name, description, inputSchema]) => Object.freeze({ name, description, inputSchema }));

export function validateWorldAgentConnection(value) {
  if (!plain(value) || !['origin', 'applicationId', 'agentDid', 'grantId', 'roomId', 'entityId'].every(k => Object.hasOwn(value, k))
    || Object.keys(value).some(k => !['origin', 'applicationId', 'agentDid', 'grantId', 'roomId', 'entityId', 'module'].includes(k))) throw Error('invalid_public_connection');
  let origin; try { origin = new URL(value.origin); } catch { throw Error('invalid_public_connection'); }
  if (origin.protocol !== 'https:' || origin.origin !== value.origin || origin.username || origin.password
    || !/^did:[a-z0-9]+:[^\s\u0000-\u001f\u007f]{1,500}$/.test(value.applicationId)
    || !/^did:[a-z0-9]+:[^\s\u0000-\u001f\u007f]{1,500}$/.test(value.agentDid)
    || !/^urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value.grantId)
    || typeof value.roomId !== 'string' || !value.roomId || Buffer.byteLength(value.roomId) > 128 || /[\u0000-\u001f\u007f]/.test(value.roomId)
    || typeof value.entityId !== 'string' || Buffer.byteLength(value.entityId) > 128
    || !/^.+:(?:companion:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|animal:[0-9]{1,9})$/.test(value.entityId)
    || /[\u0000-\u001f\u007f]/.test(value.entityId)
    || value.module !== undefined && value.module !== value.origin + '/world/agent-client.mjs') throw Error('invalid_public_connection');
  return Object.freeze(Object.fromEntries(['origin', 'applicationId', 'agentDid', 'grantId', 'roomId', 'entityId'].map(k => [k, value[k]])));
}

export function createWorldAgentMcpHost({ connection, sign_request, createClient = createWorldAgentClient } = {}) {
  const config = validateWorldAgentConnection(connection);
  if (typeof sign_request !== 'function' || typeof createClient !== 'function') throw TypeError('native_signing_callback_required');
  let client = null, closed = false, initialized = false, negotiated = false;
  const status = () => client?.status() || { connected: false, closed, applicationId: config.applicationId, audience: config.origin, agentDid: config.agentDid };
  const result = value => ({ content: [{ type: 'text', text: JSON.stringify(value) }], structuredContent: { result: value } });
  const toolFailure = error => ({ isError: true, content: [{ type: 'text', text: JSON.stringify({
    error: error instanceof WorldAgentClientError ? error.code : 'agent_tool_failed',
    uncertain: error?.uncertain === true,
    ...(error?.uncertain === true ? { nextStep: 'Observe current state after explicit reconnection. Do not automatically resend the prior input.' } : {}),
  }) }] });
  const rpcError = (id, code, message) => ({ jsonrpc: '2.0', id, error: { code, message } });
  async function call(name, args) {
    const descriptor = tools.find(tool => tool.name === name);
    if (!descriptor) return { isError: true, content: [{ type: 'text', text: '{"error":"unknown_agent_tool"}' }] };
    const fields = Object.keys(descriptor.inputSchema.properties);
    if (!exact(args, fields)) return { isError: true, content: [{ type: 'text', text: '{"error":"invalid_agent_arguments"}' }] };
    try {
      if (name === 'march_status') return result(status());
      if (name === 'march_disconnect') { client?.close(); client = null; return result(status()); }
      if (name === 'march_connect') {
        client?.close(); const held = createClient({ origin: config.origin, applicationId: config.applicationId, agentDid: config.agentDid, sign_request });
        client = held;
        return result(await held.connect({ grantId: config.grantId, roomId: config.roomId, entityId: config.entityId }));
      }
      if (!client) throw new WorldAgentClientError('agent_connection_required');
      const method = { march_observe: 'observe', march_move: 'move', march_attack: 'attack', march_renew: 'renew' }[name];
      return result(await client[method](...(fields.length ? [args] : [])));
    } catch (error) { return toolFailure(error); }
  }
  return Object.freeze({
    async handle(message) {
      const id = plain(message) && (typeof message.id === 'string' || Number.isSafeInteger(message.id)) ? message.id : null;
      if (closed || !plain(message) || message.jsonrpc !== '2.0' || typeof message.method !== 'string'
        || Object.keys(message).some(k => !['jsonrpc', 'id', 'method', 'params'].includes(k))) return rpcError(id, -32600, 'Invalid request');
      if (!Object.hasOwn(message, 'id')) {
        // MCP notifications never cause admission, gameplay, or native signing.
        if (message.method === 'notifications/initialized' && negotiated) initialized = true;
        return null;
      }
      if (id === null) return rpcError(null, -32600, 'Invalid request');
      if (message.method === 'initialize') {
        const version = message.params?.protocolVersion;
        if (typeof version !== 'string' || version.length > 32 || /[\u0000-\u001f\u007f]/.test(version)) return rpcError(id, -32602, 'Invalid protocol version');
        negotiated = true;
        return { jsonrpc: '2.0', id, result: { protocolVersion: ['2024-11-05', '2025-03-26', '2025-06-18'].includes(version) ? version : '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'hallowmarch-companion', version: '1.0.0' },
          instructions: 'Only the host-pinned separate companion is available. Native signing stays in your trusted host. Use fresh observations; never automatically replay uncertain inputs. Gameplay access is separate from personal performance consultation consent.' } };
      }
      if (message.method === 'ping') return { jsonrpc: '2.0', id, result: {} };
      if (!initialized) return rpcError(id, -32000, 'Initialize the MCP session first');
      if (message.method === 'tools/list') return { jsonrpc: '2.0', id, result: { tools } };
      if (message.method !== 'tools/call') return rpcError(id, -32601, 'Method not found');
      if (!plain(message.params) || typeof message.params.name !== 'string'
        || Object.keys(message.params).some(k => !['name', 'arguments', '_meta'].includes(k))) return rpcError(id, -32602, 'Invalid tool call');
      return { jsonrpc: '2.0', id, result: await call(message.params.name, message.params.arguments ?? {}) };
    },
    close() { if (closed) return; closed = true; client?.close(); client = null; },
  });
}
