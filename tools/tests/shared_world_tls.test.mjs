import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { WebSocket, WebSocketServer } from 'ws';

const listen = server => new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
const ready = child => new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('TLS edge did not start')), 10000);
  child.once('error', error => { clearTimeout(timer); reject(error); });
  child.once('exit', code => { clearTimeout(timer); reject(new Error('TLS edge exited: ' + code)); });
  child.stdout.on('data', bytes => { if (bytes.toString().includes('ready')) { clearTimeout(timer); resolve(); } });
});
const get = url => new Promise((resolve, reject) => {
  https.get(url, { rejectUnauthorized: false }, response => {
    let body = ''; response.setEncoding('utf8'); response.on('data', text => body += text);
    response.once('end', () => resolve({ status: response.statusCode, body: JSON.parse(body) }));
  }).once('error', reject);
});

test('the browser fixture preserves HTTPS origin and upgrades real WSS to the local game', { timeout: 20000 }, async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-wss-test-'));
  const key = path.join(directory, 'key.pem'), certificate = path.join(directory, 'certificate.pem');
  const openssl = process.platform === 'win32' ? 'C:/Program Files/Git/usr/bin/openssl.exe' : 'openssl';
  const backend = http.createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ host: req.headers.host, proto: req.headers['x-forwarded-proto'], path: req.url }));
  });
  const wsServer = new WebSocketServer({ server: backend });
  wsServer.on('connection', socket => socket.on('message', body => socket.send('same-world:' + body)));
  let edge, socket;
  try {
    execFileSync(openssl, ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
      '-subj', '/CN=127.0.0.1', '-keyout', key, '-out', certificate], { stdio: 'ignore', windowsHide: true });
    const backendPort = await listen(backend), reserve = net.createServer(), edgePort = await listen(reserve);
    await new Promise(resolve => reserve.close(resolve));
    edge = spawn(process.execPath, [fileURLToPath(new URL('./shared_world_tls.mjs', import.meta.url)),
      String(edgePort), String(backendPort), key, certificate], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    await ready(edge);
    const response = await get(`https://127.0.0.1:${edgePort}/health`);
    assert.deepEqual(response, { status: 200, body: { host: `127.0.0.1:${edgePort}`, proto: 'https', path: '/health' } });
    socket = new WebSocket(`wss://127.0.0.1:${edgePort}/ws`, { rejectUnauthorized: false });
    const echoed = await new Promise((resolve, reject) => {
      socket.once('open', () => socket.send('boat=17,npc=farmer'));
      socket.once('message', bytes => resolve(bytes.toString())); socket.once('error', reject);
    });
    assert.equal(echoed, 'same-world:boat=17,npc=farmer');
  } finally {
    socket?.terminate();
    if (edge) { const exited = new Promise(resolve => edge.once('exit', resolve)); edge.kill(); await exited; }
    for (const client of wsServer.clients) client.terminate();
    await new Promise(resolve => wsServer.close(resolve));
    await new Promise(resolve => backend.close(resolve));
    const resolved = path.resolve(directory);
    if (resolved.startsWith(path.resolve(os.tmpdir()) + path.sep) && path.basename(resolved).startsWith('hm-wss-test-'))
      fs.rmSync(resolved, { recursive: true, force: true });
  }
});
