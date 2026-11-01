import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { mkdtemp, mkdir, writeFile, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { setTimeout as wait } from 'node:timers/promises';

const require = createRequire(new URL('../package.json', import.meta.url));
const WebSocket = require('ws');

test('real empty server performs no tick, outbound request or save across old timer boundaries and idle shutdown',
  { timeout: 20000 }, async t => {
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const scratch = await mkdtemp(path.join(tmpdir(), 'hallowmarch-human-idle-'));
  const data = path.join(scratch, 'data'), log = path.join(scratch, 'unexpected-fetch.log'), shim = path.join(scratch, 'deny-fetch.mjs');
  await mkdir(data);
  await writeFile(shim, `import fs from 'node:fs'; globalThis.fetch = async (...args) => {
    fs.appendFileSync(${JSON.stringify(log)}, String(args[0])+'\\n'); throw new Error('Idle outbound request');
  };`);
  const listener = createServer(); await new Promise(resolve => listener.listen(0, '127.0.0.1', resolve));
  const port = listener.address().port; await new Promise(resolve => listener.close(resolve));
  let output = '', exited = false; const sockets = [];
  const child = spawn(process.execPath, ['--import', pathToFileURL(shim).href, path.join(root, 'server/server.js')], {
    cwd: root, env: { ...process.env, NODE_ENV: 'test', PORT: String(port), HM_DATA: data,
      HM_SRC: path.join(root, 'src'), HM_SECRET: 'idle-integration-test-only',
      HM_GAMING_ENABLED: '0', HM_GAMING_BOOTSTRAP: '0', HM_GAMING_MONITOR_ENABLED: '0',
      HM_NATIVE_AGENT_ENABLED: '0', HM_WORLD_PERSISTENCE_MODE: 'legacy' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  child.stdout.on('data', value => { output += value; }); child.stderr.on('data', value => { output += value; });
  const exit = new Promise(resolve => child.once('exit', (code, signal) => { exited = true; resolve({code,signal}); }));
  const request = async pathname => {
    const response = await fetch('http://127.0.0.1:' + port + pathname);
    assert.equal(response.status, 200, output); return response.json();
  };
  try {
    let health;
    for (let tries=0; tries<60; tries++) {
      if (exited) assert.fail('Server exited before listening: '+output);
      try { health = await request('/health'); break; } catch { await wait(50); }
    }
    assert.ok(health, output); assert.equal(health.players, 0);
    // Actual title and diagnostic transports must not seed accounts or wake work.
    for (const room of ['march', 'native-qa-idle-regression']) {
      const socket = new WebSocket('ws://127.0.0.1:' + port + '/ws'); sockets.push(socket);
      await new Promise((resolve, reject) => {
        socket.once('error', reject);
        socket.once('open', () => socket.send(JSON.stringify({t:'hello',v:1,room})));
        socket.on('message', data => {
          const message=JSON.parse(String(data));
          if (message.t === 'welcome') socket.send(JSON.stringify({t:'save',d:{idle:true}}));
          if (message.t !== 'saved') return;
          try { assert.equal(message.ok,false); assert.equal(message.error,'human_play_required'); }
          catch(error) { reject(error); return; }
          socket.send(JSON.stringify({t:'slow',d:{on:room==='march'?0:1,realmManagement:1,seasonField:2, sharedCombat: 1, actorDevelopment: 1,sharedScene:2,humanLive:1,humanActivity:1}}));
          resolve();
        });
      });
    }
    assert.equal((await request('/health')).players,0);
    const before = await request('/stats');
    await wait(6200);
    const after = await request('/stats');
    assert.equal(after.seasonSteps, before.seasonSteps, 'five-second season tick must stop');
    assert.equal(after.season?.t, before.season?.t, 'empty world must remain frozen');
    assert.equal(after.seasonSaves, before.seasonSaves);
    assert.deepEqual(await readdir(data), ['saves'], 'no periodic persistence while empty');
    assert.equal(await readFile(log, 'utf8').catch(error => error.code === 'ENOENT' ? '' : Promise.reject(error)), '',
      'empty server must not poll or publish external services');
    for (const socket of sockets) if (socket.readyState < 2) socket.terminate();
    child.kill('SIGTERM');
    const stopped = await Promise.race([exit, wait(5000).then(() => { throw new Error('Idle shutdown did not finish: '+output); })]);
    // Windows TerminateProcess does not deliver the POSIX shutdown handler.
    // Linux CI enforces graceful idle exit; both platforms verify zero writes.
    if (process.platform === 'win32') t.diagnostic('Cold standby checked on Windows; graceful SIGTERM is checked in Linux CI.');
    else assert.equal(stopped.code, 0, output);
    assert.deepEqual(await readdir(data), ['saves'], 'idle restart must not create a final save');
  } finally {
    for (const socket of sockets) if (socket.readyState < 2) socket.terminate();
    if (!exited) { child.kill('SIGKILL'); await exit; }
    await rm(scratch, {recursive:true,force:true});
  }
});
