// Test-only TLS edge: exercise the same HTTPS/WSS origin contract as production.
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';

const [listen, backend, keyFile, certificateFile] = process.argv.slice(2);
const sockets = new Set();
const edge = https.createServer({ key: fs.readFileSync(keyFile), cert: fs.readFileSync(certificateFile) }, (req, res) => {
  const upstream = http.request({ hostname: '127.0.0.1', port: Number(backend), path: req.url,
    method: req.method, headers: { ...req.headers, 'x-forwarded-proto': 'https' } }, reply => {
    res.writeHead(reply.statusCode, reply.headers); reply.pipe(res);
  });
  upstream.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end(); });
  req.on('aborted', () => upstream.destroy()); req.pipe(upstream);
});
edge.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
edge.on('upgrade', (req, socket, head) => {
  socket.pause();
  const upstream = net.connect(Number(backend), '127.0.0.1');
  sockets.add(upstream); upstream.on('close', () => sockets.delete(upstream));
  const stop = () => { upstream.destroy(); socket.destroy(); };
  socket.on('error', stop); upstream.on('error', stop);
  socket.on('close', () => upstream.destroy()); upstream.on('close', () => socket.destroy());
  upstream.on('connect', () => {
    let headers = `${req.method} ${req.url} HTTP/${req.httpVersion}\r\n`;
    for (let i = 0; i < req.rawHeaders.length; i += 2) headers += `${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}\r\n`;
    headers += 'X-Forwarded-Proto: https\r\n\r\n';
    upstream.write(headers);
    if (head.length) upstream.write(head);
    socket.pipe(upstream); upstream.pipe(socket); socket.resume();
  });
});
edge.listen(Number(listen), '127.0.0.1', () => process.stdout.write('ready\n'));
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => {
  for (const socket of sockets) socket.destroy(); edge.close(() => process.exit(0));
});
