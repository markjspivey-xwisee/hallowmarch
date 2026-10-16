import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createPerformanceResource, createPerformanceCatalog } from '../../server/gaming/performance-resource-model.js';
import { projectHallowmarchResources, markdownOf } from './hallowmarch.mjs';

const root = new URL('../../', import.meta.url);
const names = (await readdir(new URL('src/', root))).filter(name => /^\d\d[a-z]?_.*\.js$/.test(name)).sort();
const files = await Promise.all(names.map(async name => ({ path: 'src/' + name, text: await readFile(new URL('src/' + name, root), 'utf8') })));
const catalog = projectHallowmarchResources(files);
const byId = id => catalog.resources.find(r => r.id === id);

test('the generated catalog is an exact reproducible projection of checked-in sources', async () => {
  const actual = JSON.parse(await readFile(new URL('server/gaming/performance-resources.json', root), 'utf8'));
  assert.deepEqual(actual, catalog);
  const sourceFiles = new Map(files.map(f => [f.path, f.text]));
  for (const resource of catalog.resources) {
    assert.equal(resource.source.digest, 'sha256:' + createHash('sha256').update(sourceFiles.get(resource.source.path)).digest('hex'));
    assert.deepEqual(resource.audience, ['human', 'agent']);
    assert.match(resource.revisionDigest, /^sha256:[a-f0-9]{64}$/);
  }
});

test('static field notes stay complete and device/player-dependent ones remain contextual', () => {
  assert.equal(byId('field-note:keep').kind, 'job-aid');
  assert.equal(byId('field-note:keep').purpose, 'performance-support');
  assert.equal(byId('field-note:keep').content.text, "Its gates shut against you. Break the gate (or storm a breach), then slay the lord inside and the keep is your realm's. Archers on the walls and towers shoot at anyone close, so come with a warband.");
  for (const id of ['field-note:start', 'field-note:frontier', 'field-note:renew', 'lore:5']) {
    const resource = byId(id);
    assert.equal(resource.requiresContext, true, id);
    assert.equal(resource.content, undefined, id);
    assert.ok(resource.contextRequirements.length, id);
  }
  assert.ok(byId('field-note:start').contextRequirements.includes('input-device'));
  assert.ok(byId('field-note:frontier').contextRequirements.includes('realm'));
});

test('the map is a reference without current realm ownership, hidden positions or fabricated state', () => {
  const map = byId('map:legend');
  assert.equal(map.kind, 'reference');
  assert.equal(map.content.text, '- Keep (colour shows the holder)\n- Temple of a hallow\n- Muster and portal\n- A hallow');
  assert.doesNotMatch(JSON.stringify(map), /WAR\.|entities|carrierRealm|underSiegeUntil/);
  assert.equal(map.ui.destination, 'Map');
});

test('lore is an ordered outline of actual prologue pages, without enrollment, grades or publication claims', () => {
  const outline = catalog.courses[0];
  assert.deepEqual(outline.resources, ['lore:1', 'lore:2', 'lore:3', 'lore:4', 'lore:5']);
  assert.equal(outline.publicationStatus, 'unpublished-outline');
  assert.equal(outline.assessment, null);
  assert.equal(byId('lore:1').purpose, 'instruction');
  assert.match(byId('lore:2').content.text, /\*\*the Grail\*\*/);
  assert.equal(byId('lore:5').content, undefined);
  assert.ok(catalog.resources.every(r => r.competency === undefined && r.achievement === undefined && r.enrollment === undefined));
});

test('all extension mechanisms contribute real notes and source provenance', () => {
  for (const id of ['current', 'l3pitch', 'l2risen', 'housefire', 'hall', 'w2coming', 'netcompany', 'l5fold']) {
    const resource = byId('field-note:' + id);
    assert.ok(resource, id);
    assert.ok(resource.source.lines.start > 0, id);
    assert.ok(resource.source.lines.end >= resource.source.lines.start, id);
  }
});

test('source revision invalidates the digest and execution is never used to obtain a body', () => {
  const changed = files.map(f => f.path === 'src/10c_lore.js' ? { ...f, text: f.text.replace('Its gates shut against you.', 'Its gates are closed against you.') } : f);
  const revised = projectHallowmarchResources(changed);
  assert.notEqual(revised.revisionDigest, catalog.revisionDigest);
  assert.notEqual(revised.resources.find(r => r.id === 'field-note:keep').revisionDigest, byId('field-note:keep').revisionDigest);
  const withExecutableNote = files.map(f => f.path === 'src/10c_lore.js' ? { ...f, text: f.text.replace("x: () => 'Its gates shut against you.", "x: () => { throw new Error('must never execute'); return 'Its gates shut against you.").replace("so come with a warband.' },", "so come with a warband.'; } },") } : f);
  const projected = projectHallowmarchResources(withExecutableNote).resources.find(r => r.id === 'field-note:keep');
  assert.equal(projected.requiresContext, true);
  assert.equal(projected.content, undefined);
});

test('the generic model refuses partial contextual content, duplicate identities and invented course members', () => {
  const source = { path: 'src/10c_lore.js', digest: 'sha256:' + 'a'.repeat(64), selector: 'FIELD_NOTES.keep' };
  assert.throws(() => createPerformanceResource({ id: 'field-note:keep', kind: 'job-aid', title: 'Keep', source, requiresContext: true, text: 'A partial body' }), /Contextual/);
  assert.throws(() => createPerformanceCatalog({ resources: [byId('map:legend'), byId('map:legend')], sources: [] }), /Duplicate/);
  assert.throws(() => createPerformanceCatalog({ resources: [], sources: [], courses: [{ kind: 'course-outline', publicationStatus: 'unpublished-outline', assessment: null, resources: ['invented'] }] }), /must exist/);
  assert.equal(markdownOf('<p>One <b>source</b>.</p><p>Two readers.</p>'), 'One **source**.\n\nTwo readers.');
});
