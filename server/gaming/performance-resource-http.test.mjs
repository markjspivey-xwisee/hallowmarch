import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { createPerformanceResourceHttp } from './performance-resource-http.js';

const resource = { id: 'field-note:keep', kind: 'job-aid', title: '<Keep & gate>', purpose: 'performance-support',
  audience: ['human', 'agent'], source: { path: 'src/10c_lore.js', digest: 'sha256:abc' }, revisionDigest: 'sha256:123',
  content: { mediaType: 'text/markdown', text: 'Break the gate. <script>unsafe()</script>' }, requiresContext: false, ui: { destination: 'Chronicle → Field notes' } };
const contextual = { ...resource, id: 'map:live', kind: 'reference', title: 'Your map', content: undefined, requiresContext: true, ui: { destination: 'Map' } };
const catalog = { schemaVersion: 1, resources: [resource, contextual], courses: [{ id: 'course:lore-prologue', title: 'Lore', publicationStatus: 'unpublished-outline' }] };
async function fixture(t, options = {}) {
  let handler;
  const server = http.createServer((req, res) => { if (!handler(req, res, new URL(req.url, 'http://x'))) { res.writeHead(404); res.end(); } });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const base = `http://127.0.0.1:${server.address().port}/gaming/resources`;
  handler = createPerformanceResourceHttp({ catalog, publicOrigin: new URL(base).origin, ...options });
  return { get: (path = '', init) => fetch(base + path, init), post: body => fetch(base + '/query', { method: 'POST', body: JSON.stringify(body) }) };
}

test('human and agent views resolve the same content and revision without recording learning', async t => {
  const { get, post } = await fixture(t);
  const index = await (await get()).json();
  assert.equal(index.resources.length, 2);
  assert.deepEqual(index.publication, { status: 'http-projection', signedPodDescriptor: false, foxxiCoursePublished: false });
  const selected = await (await post({ id: resource.id })).json();
  assert.equal(selected.revisionDigest, resource.revisionDigest);
  assert.equal(selected.content.text, resource.content.text);
  const human = await get(selected.humanReadUrl.replace('/gaming/resources', ''));
  const html = await human.text();
  assert.equal(human.status, 200);
  assert(html.includes('&lt;Keep &amp; gate&gt;'));
  assert(html.includes('&lt;script&gt;unsafe()&lt;/script&gt;'));
  assert(!html.includes('<script>'));
  assert(human.headers.get('content-security-policy').includes("default-src 'none'"));
  assert.deepEqual((await (await post({})).json()).resources, index.resources);
  const dynamic = await (await get('/item?id=map%3Alive')).json();
  assert.equal(dynamic.requiresContext, true); assert.equal(dynamic.content, undefined);
  assert((await (await get('/view?id=map%3Alive')).text()).includes('needs current game context'));
});

test('advertised read action links its actual schema and optional deployment owner', async t => {
  const { get, post } = await fixture(t, { ownership: () => ({ did: 'did:web:game.example', podUrl: 'https://pods.example/game/' }) });
  const doc = await (await get('/descriptor.ttl')).text();
  const target = doc.match(/hydra:target <([^>]+)>/)[1], expects = doc.match(/hydra:expects <([^>]+)>/)[1];
  assert.equal(new URL(target).pathname, '/gaming/resources/query');
  assert.equal(new URL(expects).pathname, '/gaming/resources/query.schema.json');
  assert.equal((await fetch(target, { method: 'POST', body: '{}' })).status, 200);
  assert.equal((await fetch(expects)).status, 200);
  assert(doc.includes('prov:wasAttributedTo <did:web:game.example>'));
  const schema = await (await get('/query.schema.json')).json();
  assert.equal(schema.additionalProperties, false); assert.equal(schema.properties.id.maxLength, 128);
  assert.equal((await post({})).status, 200);
  assert.equal((await get('/query')).status, 405);
  assert.equal((await get('', { method: 'POST' })).status, 405);
});

test('read endpoints reject malformed, oversized, unknown and mutation-shaped requests', async t => {
  const { get, post } = await fixture(t);
  assert.equal((await post({ id: 'unknown' })).status, 404);
  for (const body of [null, [], { id: '' }, { id: 3 }, { id: 'x'.repeat(129) }, { consent: true }, { id: resource.id, completed: true }]) assert.equal((await post(body)).status, 400);
  assert.equal((await get('/query', { method: 'POST', body: '{' })).status, 400);
  assert.equal((await get('/query', { method: 'POST', body: 'x'.repeat(1025) })).status, 413);
  assert.equal((await get('/view?id=unknown')).status, 404);
  assert.equal((await get('/item')).status, 400);
});

test('invalid identity metadata cannot inject RDF and duplicate resources fail', async t => {
  const { get } = await fixture(t, { ownership: () => ({ did: 'did:web:x> . <evil>', podUrl: 'https://example.org/' }) });
  assert.equal((await (await get()).json()).ownership, null);
  assert(!(await (await get('/descriptor.ttl')).text()).includes('<evil>'));
  assert.throws(() => createPerformanceResourceHttp({ catalog: { ...catalog, resources: [resource, resource] } }), /Unique resource/);
});

test('missing trusted origin does not advertise a relative target or trust the request host', async t => {
  const { get } = await fixture(t, { publicOrigin: undefined });
  assert.equal((await (await get()).json()).descriptorUrl, null);
  assert.equal((await get('/descriptor.ttl', { headers: { host: 'evil.example' } })).status, 503);
  assert.throws(() => createPerformanceResourceHttp({ catalog, publicOrigin: 'https://game.example/path' }), /trusted public origin/);
});

test('I2IDL-X annotates consulting resources while leaving game facts and unrelated references alone', async t => {
  const actualCatalog = JSON.parse(await readFile(new URL('./performance-resources.json', import.meta.url), 'utf8'));
  const alignment = JSON.parse(await readFile(new URL('./performance-consulting-alignment.json', import.meta.url), 'utf8'));
  const { get, post } = await fixture(t, { catalog: actualCatalog, alignment });
  const aid = await (await post({ id: 'field-note:keep' })).json();
  assert.equal(aid.performanceConsulting.scope, 'performance-consulting');
  assert.equal(aid.performanceConsulting.status, 'proposed-application-annotation');
  assert.equal(aid.performanceConsulting.annotations[0].relation, 'http://purl.org/dc/terms/subject');
  assert.equal(aid.performanceConsulting.source.publicationVersion, 'v0.0.90');
  for (const id of ['map:legend', 'lore:1']) assert.equal((await (await post({ id })).json()).performanceConsulting, undefined);
  const profile = await (await get('/alignment.json')).json();
  assert.equal(profile.evidencePolicy.gameLevelIsTransferableCompetency, false);
  assert.equal(profile.evidencePolicy.resourceReadEstablishesLearning, false);
  assert.match(profile.revisionDigest, /^sha256:[a-f0-9]{64}$/);
  const human = await (await get('', { headers: { accept: 'text/html' } })).text();
  assert(human.includes('<ol><li><a href="/gaming/resources/view?id=lore%3A1">'));
  assert(human.includes('lore%3A5'));
  const lore = await (await get('/view?id=lore%3A1')).text();
  assert(lore.includes('<strong>Logres</strong>'));
  assert(!lore.includes('sha256:'));
  const bridge = createPerformanceResourceHttp({ catalog: actualCatalog, alignment, publicOrigin: 'https://game.example',
    nativeScope: { graphIri: 'urn:graph:hallowmarch:performance-support', resourceNamespace: 'urn:hallowmarch:resource:' } });
  const native = bridge.nativeDescription();
  assert.equal(native.graphIri, 'urn:graph:hallowmarch:performance-support');
  assert.equal((native.graphContent.match(/a gaming:PerformanceSupportResource/g) || []).length, 101);
  assert(native.graphContent.includes('schema:text ' + JSON.stringify(actualCatalog.resources.find(r => r.id === 'field-note:keep').content.text)));
  const personalPage = native.graphContent.split('\n').find(line => line.startsWith('<urn:hallowmarch:resource:lore%3A5> a '));
  assert(personalPage.includes('gaming:requiresContext true'));
  assert(!personalPage.includes('schema:text'));
  assert(native.graphContent.includes('gaming:alignmentScope "performance-consulting"'));
  const composition = bridge.nativeComposition();
  assert.equal(composition.parts.length, 9);
  assert.equal((composition.root.graphContent.match(/dct:hasPart/g) || []).length, 9);
  assert.equal(composition.parts.reduce((n, part) => n + (part.graphContent.match(/a gaming:PerformanceSupportResource/g) || []).length, 0), 101);
  assert(composition.parts.every(part => (part.graphContent.match(/a gaming:PerformanceSupportResource/g) || []).length <= 12));
  assert(!composition.root.graphContent.includes('schema:text'));
});
