import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { brotliDecompressSync, gunzipSync } from 'node:zlib';
import { createGamePageDelivery } from './game-page.js';

test('public page compression preserves exact content, negotiation and fresh manifest bytes', async t => {
  let html = '<!doctype html><script>window.__HM_GAMING={version:1}</script>' + 'Hallowmarch '.repeat(100000);
  const send = createGamePageDelivery();
  const server = http.createServer((req,res) => void send(req,res,html));
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const request = (headers={},method='GET') => new Promise((resolve,reject) => {
    const req = http.request({host:'127.0.0.1',port:server.address().port,headers,method},res => {
      const chunks=[];res.on('data',b=>chunks.push(b));res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,body:Buffer.concat(chunks)}));
    });req.on('error',reject);req.end();
  });
  const br=await request({'accept-encoding':'gzip, br'});
  assert.equal(br.headers['content-encoding'],'br');
  assert.equal(brotliDecompressSync(br.body).toString(),html);
  assert(br.body.length < Buffer.byteLength(html)/5);
  const gzip=await request({'accept-encoding':'br;q=0, gzip;q=0.8'});
  assert.equal(gzip.headers['content-encoding'],'gzip');assert.equal(gunzipSync(gzip.body).toString(),html);
  const plain=await request({'accept-encoding':'br;q=0, gzip;q=0'});
  assert.equal(plain.headers['content-encoding'],undefined);assert.equal(plain.body.toString(),html);
  assert.equal(br.headers.vary,'Accept-Encoding');
  const cached=await request({'accept-encoding':'br','if-none-match':br.headers.etag});
  assert.equal(cached.status,304);assert.equal(cached.body.length,0);
  html=html.replace('version:1','version:2');
  const fresh=await request({'accept-encoding':'br','if-none-match':br.headers.etag});
  assert.equal(fresh.status,200);assert.notEqual(fresh.headers.etag,br.headers.etag);
  assert.equal(brotliDecompressSync(fresh.body).toString(),html);
  const head=await request({'accept-encoding':'br'},'HEAD');
  assert.equal(head.body.length,0);assert.equal(head.headers['content-length'],String(fresh.body.length));
});
