/** Exercises the external live-play harness against the real HTTP/WebSocket
 * runtime and an explicitly delayed DISK TEST FIXTURE. These timings establish
 * protocol separation from a slow store; they are not Interego measurements.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createGamingRuntime } from '../../server/gaming/runtime.js';
import { createAgentHttp } from '../../server/gaming/agent-http.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(path.join(ROOT, 'server/package.json'));
const { WebSocketServer } = require('ws');
const exec = promisify(execFile);
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

for (const mode of ['strict', 'realtime']) {
  test(`live harness preserves ${mode} acknowledgement semantics over real sockets`, { timeout: 45000 }, async () => {
    const directory = await fs.mkdtemp(path.join(tmpdir(), 'hm-live-protocol-fixture-'));
    const file = path.join(directory, 'checkpoint.json');
    const commits = [];
    const store = {
      async load() {
        try { return JSON.parse(await fs.readFile(file, 'utf8')); }
        catch (error) { if (error.code === 'ENOENT') return { version: 0, state: null }; throw error; }
      },
      async commit(id, request) {
        await delay(500);
        const previous = await this.load();
        assert.equal(previous.version, request.expectedVersion, 'Fixture checkpoint version');
        const saved = { version: previous.version + 1, state: request.state };
        await fs.writeFile(file + '.next', JSON.stringify(saved)); await fs.rename(file + '.next', file);
        commits.push({ version: saved.version, sequence: request.state.authoritySequence });
        return this.load();
      },
    };
    const runtime = createGamingRuntime({ store, persistenceMode: mode, checkpointIntervalMs: 1000,
      send(client, message) { if (client.gamingReply) client.gamingReply(message); else if (client.ws.readyState === 1) client.ws.send(JSON.stringify(message)); } });
    await runtime.ready;
    const agentHttp = createAgentHttp({ gaming: runtime });
    const server = http.createServer((req, res) => {
      const pathname = new URL(req.url, 'http://fixture').pathname;
      if (agentHttp(req, res, pathname)) return;
      const body = pathname === '/health' ? { ok: true } : pathname === '/gaming/manifest' ? runtime.manifest()
        : pathname === '/gaming/status' ? { manifest: runtime.manifest(), metrics: runtime.metrics(), monitoring: { enabled: false, testFixture: true } } : null;
      res.writeHead(body ? 200 : 404, { 'content-type': 'application/json' }); res.end(JSON.stringify(body));
    });
    const wss = new WebSocketServer({ server }); let counter = 0;
    wss.on('connection', socket => {
      const client = { ws: socket, acct: { id: `fixture-player-${++counter}`, name: 'Software verification' }, realm: 0 };
      socket.on('message', async bytes => {
        const message = JSON.parse(String(bytes));
        if (message.t === 'hello') socket.send(JSON.stringify({ t: 'welcome', acct: client.acct }));
        else if (message.t === 'slow') client.slow = message.d;
        else if (message.t === 'gaming') await runtime.handle(client, message);
      });
      socket.on('close', () => runtime.close(client));
    });
    try {
      await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
      const env = { ...process.env }; delete env.HM_WS_PROXY;
      const args = [path.join(ROOT, 'tools/tests/gaming_live.mjs'), '--authorize-live-play', `http://127.0.0.1:${server.address().port}`];
      if (mode === 'realtime') args.push('--require-realtime', '--max-action-rtt-ms=250');
      const { stdout } = await exec(process.execPath, args, { env, timeout: 40000 });
      const report = JSON.parse(stdout.slice(stdout.indexOf('{\n  "runId"')));
      assert.equal(report.persistenceMode, mode); assert.equal(report.humanLearningExported, false);
      assert.equal(report.actionPerformance.moves, 6); assert.equal(report.actionPerformance.attacks, 1);
      assert.equal(report.actionCheckpoint.targetSequence <= report.actionCheckpoint.durableSequence, true);
      const saved = await store.load();
      if (mode === 'realtime') {
        assert.equal(report.actionPerformance.progressiveLagObserved, true);
        assert(report.actionPerformance.maxMs < 250, 'Live acceptance must proceed during the fixture\'s 500 ms checkpoint');
        assert(commits.length < runtime.room.stats.commands + 1, 'Progressive mode must batch commands instead of persisting every movement');
        assert(saved.state.authoritySequence >= report.finalCheckpoint.targetSequence, 'A fresh disk read must contain the final checkpoint');
      } else assert(report.actionPerformance.medianMs >= 500, 'Strict acknowledgement must wait for the delayed disk fixture');
      const cold = createGamingRuntime({ store, persistenceMode: mode, send() { throw new Error('A cold runtime has no subscribed clients.'); } });
      await cold.ready;
      try {
        assert.equal(cold.manifest().enabled, true);
        assert(cold.room.version >= report.finalCheckpoint.targetSequence, 'A fresh authority must recover the final checkpoint sequence');
        assert.equal(cold.room.current.entities['march-guardian'].hp, 90, 'The checkpoint must retain the shared attack');
      } finally { await cold.shutdown(); await cold.room?.close?.(); }
      console.log(`FIXTURE ${mode}: ${JSON.stringify(report.actionPerformance)}; ${commits.length} checkpoint writes`);
    } finally {
      for (const socket of wss.clients) socket.terminate();
      await runtime.shutdown(); await runtime.room?.close?.();
      await new Promise(resolve => wss.close(resolve)); await new Promise(resolve => server.close(resolve));
      await fs.rm(directory, { recursive: true, force: true });
    }
  });
}
