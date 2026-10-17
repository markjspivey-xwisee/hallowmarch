#!/usr/bin/env node
/** Reviewed local-process entry point. Model arguments never select modules,
 * credentials, URLs, grants or a human character. Stdout is MCP JSON-RPC only. */
import { readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createWorldAgentMcpHost } from '../../client/world-agent-mcp.mjs';

const args = process.argv.slice(2);
if (args.length !== 4 || args[0] !== '--connection' || args[2] !== '--signer-module') {
  process.stderr.write('Usage: node tools/agents/world-agent-mcp.mjs --connection /absolute/public-connection.json --signer-module /absolute/reviewed-native-signer.mjs\n');
  process.exitCode = 1;
} else {
  let host;
  try {
    if (Number(process.versions.node.split('.')[0]) < 22) throw Error('Node 22 or newer required');
    const file = resolve(args[1]);
    if ((await stat(file)).size > 4096) throw Error('public connection too large');
    const connection = JSON.parse(await readFile(file, 'utf8'));
    // Validate before loading any signer code, and import only the operator's
    // explicit local module. The public connection's module URL is never run.
    const { validateWorldAgentConnection } = await import('../../client/world-agent-mcp.mjs');
    validateWorldAgentConnection(connection);
    const signer = await import(pathToFileURL(resolve(args[3])).href);
    host = createWorldAgentMcpHost({ connection, sign_request: signer.sign_request, performance: signer.performance });
  } catch {
    process.stderr.write('Hallowmarch tool host could not load its public connection and reviewed native signing callback. No agent admission was attempted.\n');
    process.exitCode = 1;
  }
  if (host) {
    let buffer = '', stopped = false;
    const send = response => { if (!stopped && response !== null) process.stdout.write(JSON.stringify(response) + '\n'); };
    const close = () => { if (stopped) return; stopped = true; host.close(); process.stdin.pause(); };
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', chunk => {
      if (stopped) return;
      buffer += chunk;
      while (buffer.includes('\n')) {
        const end = buffer.indexOf('\n'), line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
        if (Buffer.byteLength(line) > 65536) { close(); process.exitCode = 1; return; }
        let message;
        try { message = JSON.parse(line); }
        catch { send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }); continue; }
        host.handle(message).then(send, () => send({ jsonrpc: '2.0', id: message.id ?? null, error: { code: -32603, message: 'Internal error' } }));
      }
      if (Buffer.byteLength(buffer) > 65536) { close(); process.exitCode = 1; }
    });
    process.stdin.on('end', close);
    // A host-supplied native connector may keep its own sockets open. Explicit
    // process termination still drops the ephemeral session immediately.
    process.on('SIGINT', () => { close(); process.exit(0); });
    process.on('SIGTERM', () => { close(); process.exit(0); });
  }
}
