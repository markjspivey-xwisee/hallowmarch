/** Read-only projections of authored performance support and course outlines.
 * These links describe content. They never enroll a learner, record a visit as
 * learning, export personal game state, or assert a pod publication/signature.
 */
import { createHash } from 'node:crypto';
const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const markdown = text => String(text).split(/\n\n+/).map(block => {
  const inline = value => escape(value).replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  return block.split('\n').every(line => line.startsWith('- ')) ? '<ul>' + block.split('\n').map(line => `<li>${inline(line.slice(2))}</li>`).join('') + '</ul>' : `<p>${inline(block).replace(/\n/g, '<br>')}</p>`;
}).join('');
const term = 'urn:interego:gaming:';
const I2IDL_SOURCE = Object.freeze({
  scheme: 'https://id.i2idl.org/scheme', release: 'v0.0.93',
  commit: 'b75261de5ad7851c1f61607091cc00e486bbbb5f',
  snapshot: 'https://github.com/blakeplock/i2idl-linked-data/blob/b75261de5ad7851c1f61607091cc00e486bbbb5f/public/glossary.jsonld',
  vocabulary: 'https://relay.interego.xwisee.com/ns/u-pk-33d42e6b33dc/i2idlx', semanticVersion: '0.5.0'
});
const iri = value => typeof value === 'string' && /^(https:\/\/|did:)/.test(value) && !/[\s<>"{}|^`\\]/.test(value);

export function createPerformanceResourceHttp({ catalog, alignment = null, activityProfile = null, activityProfileVersions = [], committedActivityProfile = null, ownership = () => null, publication = () => null, publicOrigin,
  title = 'Performance resources', nativeScope = null, basePath = '/gaming/resources', maxBody = 1024 } = {}) {
  if (catalog?.schemaVersion !== 1 || !Array.isArray(catalog.resources) || !Array.isArray(catalog.courses)) throw new TypeError('A versioned authored resource catalog is required.');
  if (!/^\/[a-z0-9/-]+$/.test(basePath) || basePath.endsWith('/')) throw new TypeError('A fixed local resource path is required.');
  if (!Number.isSafeInteger(maxBody) || maxBody < 1 || maxBody > 8192) throw new TypeError('A bounded resource query size is required.');
  let origin = null;
  if (publicOrigin) {
    const parsed = new URL(publicOrigin);
    if ((parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname))) || parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash) throw new TypeError('A trusted public origin is required.');
    origin = parsed.origin;
  }
  const absolute = path => origin + path;
  const resources = new Map();
  for (const resource of catalog.resources) {
    if (!resource || typeof resource.id !== 'string' || resources.has(resource.id)) throw new TypeError('Unique resource identities are required.');
    resources.set(resource.id, resource);
  }
  if (alignment && (alignment.scope !== 'performance-consulting' || Object.keys(alignment.resourceAnnotations || {}).some(id => !resources.has(id)))) throw new TypeError('Performance consulting annotations must reference actual resources.');
  const alignmentRevision = alignment ? 'sha256:' + createHash('sha256').update(JSON.stringify(alignment)).digest('hex') : null;
  const profilePath = '/gaming/activity-profile.jsonld', committedProfilePath = '/gaming/committed-activity-profile.jsonld';
  const profileDocuments = [], profileRoutes = new Map();
  const prepareProfile = (document, path, source, emitter) => {
    const safeProfileIri = value => typeof value === 'string' && /^https:\/\//.test(value) && !/[\s<>"{}|^`\\]/.test(value);
    if (document.type !== 'Profile' || !safeProfileIri(document.id)
      || document.conformsTo !== 'https://w3id.org/xapi/profiles#1.0'
      || !Array.isArray(document.versions) || document.versions.length < 1 || document.versions.length > 16
      || document.versions.some(v => !safeProfileIri(v.id) || !v.id.startsWith(document.id + '/versions/') || !/^\d+\.\d+\.\d+$/.test(v.id.slice(document.id.length + 10)))
      || new Set(document.versions.map(v => v.id)).size !== document.versions.length
      || ['templates', 'patterns'].some(key => !Array.isArray(document[key]) || document[key].length > 512
        || document[key].some(item => !safeProfileIri(item.id) || item.type !== (key === 'templates' ? 'StatementTemplate' : 'Pattern')))) throw new TypeError('A fixed observed activity Profile with safe version, template and pattern identifiers is required.');
    // HTTP and native publication must retain the same immutable configuration.
    document = JSON.parse(JSON.stringify(document));
    const version = document.versions[0].id, versionPath = path + '/versions/' + version.slice(document.id.length + 10);
    if (profileRoutes.has(versionPath)) throw new TypeError('Each immutable activity Profile version must be configured exactly once.');
    const row = { document, body: JSON.stringify(document), versionPath, source, emitter };
    profileDocuments.push(row); profileRoutes.set(versionPath, row);
    return row;
  };
  if (!Array.isArray(activityProfileVersions) || activityProfileVersions.length > 15 || (!activityProfile && activityProfileVersions.length)) throw new TypeError('Historical activity Profiles require the current Profile.');
  if (activityProfile) {
    const current = prepareProfile(activityProfile, profilePath, 'owner-browser-observation', 'active-owner-browser');
    activityProfile = current.document; profileRoutes.set(profilePath, current);
    for (const document of activityProfileVersions) {
      if (!document || document.id !== activityProfile.id || !activityProfile.versions.some(v => v.id === document.versions?.[0]?.id)) throw new TypeError('A historical activity Profile must be an identified version of the current Profile.');
      prepareProfile(document, profilePath, 'owner-browser-observation', 'retained-historical-profile');
    }
  }
  if (committedActivityProfile) {
    const committed = prepareProfile(committedActivityProfile, committedProfilePath, 'authoritative-committed-game-log', 'explicit-projection-api');
    committedActivityProfile = committed.document; profileRoutes.set(committedProfilePath, committed);
  }
  const link = id => `${basePath}/view?id=${encodeURIComponent(id)}`;
  const project = resource => ({ ...resource, humanReadUrl: link(resource.id),
    ...(alignment?.resourceAnnotations?.[resource.id] ? { performanceConsulting: { scope: alignment.scope, status: alignment.mappingStatus,
      source: alignment.canonicalSource, alignmentRevisionDigest: alignmentRevision, annotations: alignment.resourceAnnotations[resource.id] } } : {}) });
  const identity = () => {
    const owner = ownership();
    return owner && iri(owner.did) && iri(owner.podUrl) ? { did: owner.did, podUrl: owner.podUrl, verification: 'deployment-configured' } : null;
  };
  const index = () => ({ ...catalog, resources: catalog.resources.map(project), ownership: identity(),
    ...(activityProfile ? { activity: { profile: origin ? absolute(profilePath) : null, version: activityProfile.versions[0].id,
      storage: 'encrypted-observing-owner-pod', source: 'owner-browser-observation', actor: 'authenticated-observing-owner',
      controllerIdentity: 'context-only', competencyStatus: 'not-assessed', lrsConformanceClaim: false } } : {}),
    ...(committedActivityProfile ? { committedActivity: { profile: origin ? absolute(committedProfilePath) : null, version: committedActivityProfile.versions[0].id,
      source: 'authoritative-committed-game-log', emitter: 'explicit-projection-api', activeOwnerBrowserProfile: false } } : {}),
    nativePublication: publication(),
    ...(alignment ? { performanceConsulting: { scope: alignment.scope, profile: `${basePath}/alignment.json`, canonicalSource: alignment.canonicalSource, revisionDigest: alignmentRevision } } : {}),
    descriptorUrl: origin ? absolute(`${basePath}/descriptor.ttl`) : null, evidencePolicy: 'Consultation is resource use, not proof of learning or mastery.',
    publication: { status: 'http-projection', signedPodDescriptor: false, foxxiCoursePublished: false } });
  const html = resource => {
    const content = resource ? `<h1>${escape(resource.title)}</h1><p>${escape(resource.kind)} · ${escape(resource.purpose)}</p>` +
      (resource.content ? markdown(resource.content.text) : '<p>This resource needs current game context. Open it in the game to see the version for your situation.</p>') +
      `<p>In game: ${escape(resource.ui?.destination || 'Chronicle')}</p><a href="${basePath}">All resources</a>` :
      `<h1>${escape(title)}</h1><p>Job aids and references support performance. Authored content can be composed into instruction. Using a resource does not establish mastery.</p><ul>` +
      catalog.resources.map(r => `<li><a href="${escape(link(r.id))}">${escape(r.title)}</a> — ${escape(r.kind)}${r.requiresContext ? ' · contextual' : ''}</li>`).join('') +
      '</ul><h2>Course outlines</h2>' + catalog.courses.map(course => `<p>${escape(course.title)} — ${escape(course.publicationStatus)}; no enrollment or completion is recorded.</p><ol>${(course.resources || []).map(id => resources.get(id)).filter(Boolean).map(r => `<li><a href="${escape(link(r.id))}">${escape(r.title)}</a></li>`).join('')}</ol>`).join('');
    return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(resource?.title || title)}</title><style>body{margin:0 auto;padding:24px;max-width:760px;background:#14191c;color:#eee7d9;font:18px/1.6 system-ui}a{color:#e7ca89;display:inline-block;min-height:44px}li{padding:4px 0}h1{line-height:1.2}</style><main>${content}</main></html>`;
  };
  const descriptor = (subject = '<>') => {
    const owner = identity();
    return `@prefix iep: <https://markjspivey-xwisee.github.io/interego/ns/iep#> .
@prefix hydra: <http://www.w3.org/ns/hydra/core#> .
@prefix dcat: <http://www.w3.org/ns/dcat#> .
@prefix dct: <http://purl.org/dc/terms/> .
@prefix prov: <http://www.w3.org/ns/prov#> .
@prefix gaming: <${term}> .
@prefix i2x: <${I2IDL_SOURCE.vocabulary}#> .
@prefix i2idl: <https://id.i2idl.org/concepts/> .
${subject} a dcat:DataService ; dct:title ${JSON.stringify(title)} ;
  dct:identifier ${JSON.stringify(catalog.revisionDigest || '')} ;
  dct:description "Authored performance resource bridge. Native publication is verified through its separate receipt; resource use does not establish achievement." ;
  dcat:endpointURL <${absolute(basePath)}> ;
  ${alignment ? `dct:relation <${absolute(`${basePath}/alignment.json`)}> ;` : ''}
  ${activityProfile ? `dct:relation <${absolute(profilePath)}> ; gaming:activityProfile <${activityProfile.id}> ; gaming:activityProfileVersion <${activityProfile.versions[0].id}> ;` : ''}
  ${owner ? `prov:wasAttributedTo <${owner.did}> ; gaming:ownerPod <${owner.podUrl}> ;` : ''}
  iep:affordance [ a iep:Affordance, hydra:Operation ;
    iep:action <${term}resources:query> ; hydra:method "POST" ;
    hydra:target <${absolute(`${basePath}/query`)}> ; hydra:expects <${absolute(`${basePath}/query.schema.json`)}> ;
    dct:conformsTo <${absolute(`${basePath}/shapes.ttl#ResourceQuery`)}> ;
    hydra:returns <${term}PerformanceResourceQueryResult> ;
    hydra:title "Read authored resources or one resource by id" ] .
`;
  };
  const shape = `@prefix sh: <http://www.w3.org/ns/shacl#> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
@prefix gaming: <${term}> .
<#ResourceQuery> a sh:NodeShape ; sh:closed true ;
  sh:property [ sh:path gaming:resourceId ; sh:name "id" ; sh:datatype xsd:string ; sh:minLength 1 ; sh:maxLength 128 ; sh:maxCount 1 ] .
# JSON request: {} lists resources; {"id":"field-note:keep"} selects one.
# The JSON id field represents gaming:resourceId. This action is read-only.
`;
  const handle = function handle(req, res, url) {
    const path = url.pathname;
    const profileRoute = profileRoutes.get(path), knownUnconfiguredProfile = [profilePath, profilePath + '/versions/1.0.0', profilePath + '/versions/1.1.0', committedProfilePath, committedProfilePath + '/versions/1.0.0'].includes(path);
    if (path !== basePath && !profileRoute && !knownUnconfiguredProfile && ![`${basePath}/query`, `${basePath}/item`, `${basePath}/view`, `${basePath}/descriptor.ttl`, `${basePath}/shapes.ttl`, `${basePath}/query.schema.json`, `${basePath}/alignment.json`].includes(path)) return false;
    const reply = (status, body, mediaType = 'application/json') => {
      if (res.writableEnded || res.destroyed) return;
      res.writeHead(status, { 'content-type': `${mediaType}; charset=utf-8`, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff',
        ...(mediaType === 'text/html' ? { 'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'" } : {}) });
      res.end(mediaType === 'application/json' ? JSON.stringify(body) : body);
    };
    const read = id => {
      if (id === undefined) { reply(200, index()); return; }
      if (typeof id !== 'string' || !id || id.length > 128) { reply(400, { error: 'invalid_resource_id' }); return; }
      const resource = resources.get(id);
      if (!resource) { reply(404, { error: 'resource_not_found' }); return; }
      reply(200, project(resource));
    };
    if (profileRoute || knownUnconfiguredProfile) {
      if (!['GET', 'HEAD'].includes(req.method)) { res.setHeader('Allow', 'GET, HEAD'); reply(405, { error: 'method_not_allowed' }); }
      else if (!profileRoute) reply(404, { error: 'activity_profile_unconfigured' });
      else { res.writeHead(200, { 'content-type': 'application/ld+json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer' }); res.end(req.method === 'HEAD' ? undefined : profileRoute.body); }
      return true;
    }
    if (path === `${basePath}/query`) {
      if (req.method !== 'POST') { reply(405, { error: 'method_not_allowed' }); return true; }
      let size = 0, body = '', done = false;
      const timer = setTimeout(() => { done = true; reply(408, { error: 'request_timeout' }); req.destroy(); }, 5000); timer.unref?.();
      const stop = () => { done = true; clearTimeout(timer); };
      req.once('aborted', stop); req.once('error', stop);
      req.on('data', chunk => {
        if (done) return;
        size += chunk.length;
        if (size > maxBody) { stop(); reply(413, { error: 'payload_too_large' }); return; }
        body += chunk.toString('utf8');
      });
      req.once('end', () => {
        if (done) return;
        stop();
        let data; try { data = JSON.parse(body); } catch { reply(400, { error: 'invalid_json' }); return; }
        if (!data || typeof data !== 'object' || Array.isArray(data) || Object.keys(data).some(key => key !== 'id')) { reply(400, { error: 'invalid_query' }); return; }
        read(data.id);
      });
      return true;
    }
    if (req.method !== 'GET') { reply(405, { error: 'method_not_allowed' }); return true; }
    if (path.endsWith('/descriptor.ttl')) {
      if (!origin) reply(503, { error: 'public_origin_unconfigured' });
      else reply(200, descriptor(), 'text/turtle');
    }
    else if (path.endsWith('/shapes.ttl')) reply(200, shape, 'text/turtle');
    else if (path.endsWith('/alignment.json')) reply(alignment ? 200 : 404, alignment ? { ...alignment, revisionDigest: alignmentRevision } : { error: 'alignment_unconfigured' });
    else if (path.endsWith('/query.schema.json')) reply(200, { $schema: 'https://json-schema.org/draft/2020-12/schema', type: 'object', additionalProperties: false,
      properties: { id: { type: 'string', minLength: 1, maxLength: 128, 'x-rdf-predicate': `${term}resourceId` } }, description: 'Omit id to list resources. Supply an exact resource id to read it. Read-only; no activity is recorded.' });
    else if (path.endsWith('/item')) read(url.searchParams.get('id'));
    else if (path.endsWith('/view')) {
      const resource = resources.get(url.searchParams.get('id'));
      if (resource) reply(200, html(resource), 'text/html'); else reply(404, { error: 'resource_not_found' });
    } else if (String(req.headers.accept || '').includes('text/html')) reply(200, html(null), 'text/html');
    else reply(200, index());
    return true;
  };
  // One bridge description is served over HTTP and composed into the owner's
  // native capability graph. Authored bodies, not private player context, persist
  // with that graph so the bridge is a transport rather than the only copy.
  const nativeDocument = () => {
    if (!origin) throw new Error('Public origin is not configured.');
    const { graphIri, resourceNamespace } = nativeScope || {};
    if (![graphIri, resourceNamespace].every(value => typeof value === 'string' && /^(urn:|https:\/\/)/.test(value) && !/[\s<>"{}|^`\\]/.test(value))) throw new Error('Explicit native graph and resource namespaces are required.');
    const resourceIri = id => resourceNamespace + encodeURIComponent(id);
    const lines = [descriptor(`<${graphIri}>`), '@prefix schema: <https://schema.org/> .'];
    const resourceRows = [];
    for (const r of catalog.resources) {
      const first = lines.length;
      lines.push(`<${graphIri}> dcat:servesDataset <${resourceIri(r.id)}> .`);
      lines.push(`<${resourceIri(r.id)}> a gaming:PerformanceSupportResource ; dct:title ${JSON.stringify(r.title)} ; gaming:resourceKind ${JSON.stringify(r.kind)} ; gaming:requiresContext ${r.requiresContext === true} ; dct:identifier ${JSON.stringify(r.revisionDigest)} ; schema:url <${absolute(link(r.id))}>` +
        (r.content ? ` ; schema:text ${JSON.stringify(r.content.text)}` : '') + ' .');
      lines.push(`<${resourceIri(r.id)}> gaming:sourcePath ${JSON.stringify(r.source.path)} ; gaming:sourceDigest ${JSON.stringify(r.source.digest)} ; gaming:sourceSelector ${JSON.stringify(r.source.selector)} .`);
      if (alignment?.resourceAnnotations?.[r.id]) for (const a of alignment.resourceAnnotations[r.id]) lines.push(`<${resourceIri(r.id)}> <${a.relation}> <${a.concept}> .`);
      resourceRows.push(lines.splice(first));
    }
    for (const c of catalog.courses) {
      const course = resourceIri(c.id);
      lines.push(`<${course}> a gaming:CourseOutline ; dct:title ${JSON.stringify(c.title)} ; gaming:publicationStatus "unpublished-outline" .`);
      c.resources.forEach((id, index) => lines.push(`<${course}> gaming:position <${course}:position:${index + 1}> . <${course}:position:${index + 1}> gaming:ordinal ${index + 1} ; gaming:resource <${resourceIri(id)}> .`));
    }
    if (alignment) lines.push(`<${graphIri}> gaming:alignmentScope "performance-consulting" ; gaming:alignmentStatus ${JSON.stringify(alignment.mappingStatus)} ; gaming:alignmentRevision ${JSON.stringify(alignmentRevision)} ; gaming:canonicalGlossary <${alignment.canonicalSource.iri}> ; gaming:glossaryPublicationVersion ${JSON.stringify(alignment.canonicalSource.publicationVersion)} .`);
    return { graphIri, rootLines: lines, resourceRows };
  };
  handle.nativeDescription = () => {
    const { graphIri, rootLines, resourceRows } = nativeDocument();
    return { graphIri, graphContent: [...rootLines, ...resourceRows.flat(), ...profileDocuments.map(row => profileTriples(graphIri, row))].join('\n') };
  };
  const profileTriples = (graphIri, row) => {
    const { document, body, versionPath, source, emitter } = row;
    const version = document.versions[0].id, distribution = absolute(versionPath) + '#distribution';
    const classifications = [[document.id, 'xapi-profile'], [version, 'profile-version'],
      ...document.templates.map(item => [item.id, 'statement-template']), ...document.patterns.map(item => [item.id, 'xapi-pattern'])];
    return `<${graphIri}> dcat:servesDataset <${document.id}> .\n`
      + `<${document.id}> a dcat:Dataset ; dct:hasVersion <${version}> .\n`
      + `<${version}> a dcat:Dataset ; dct:isVersionOf <${document.id}> ; dct:conformsTo <${document.conformsTo}> ; dcat:distribution <${distribution}> ; schema:text ${JSON.stringify(body)} ; gaming:observationSource ${JSON.stringify(source)} ; gaming:emitter ${JSON.stringify(emitter)} .\n`
      + `<${distribution}> a dcat:Distribution ; dcat:accessURL <${absolute(versionPath)}> ; dcat:mediaType "application/ld+json" .\n`
      + `<${version}> gaming:semanticMappingStatus "Hypothetical" ; gaming:canonicalGlossary <${I2IDL_SOURCE.scheme}> ; gaming:glossaryPublicationVersion ${JSON.stringify(I2IDL_SOURCE.release)} ; gaming:glossarySourceCommit ${JSON.stringify(I2IDL_SOURCE.commit)} ; gaming:semanticProfileVersion ${JSON.stringify(I2IDL_SOURCE.semanticVersion)} ; prov:wasDerivedFrom <${I2IDL_SOURCE.snapshot}>, <${I2IDL_SOURCE.vocabulary}>, <${I2IDL_SOURCE.vocabulary}-referents>, <${I2IDL_SOURCE.vocabulary}-alignments> .\n`
      + classifications.map(([subject, concept]) => `<${subject}> i2x:isClassifiedBy i2idl:${concept} ; gaming:semanticMappingStatus "Hypothetical" .`).join('\n');
  };
  handle.nativeComposition = ({ resourcesPerPart = 12 } = {}) => {
    if (!Number.isSafeInteger(resourcesPerPart) || resourcesPerPart < 1 || resourcesPerPart > 16) throw new TypeError('A bounded resource composition is required.');
    const { graphIri, rootLines, resourceRows } = nativeDocument(), parts = [];
    const prefixes = rootLines.join('\n').split('\n').filter(line => line.startsWith('@prefix '));
    for (let i = 0; i < resourceRows.length; i += resourcesPerPart) {
      const content = resourceRows.slice(i, i + resourcesPerPart).flat().join('\n');
      const partIri = graphIri + ':resources:' + createHash('sha256').update(content).digest('hex');
      parts.push({ graphIri: partIri, graphContent: [...prefixes, `<${partIri}> a gaming:ResourceCollection ; dct:isPartOf <${graphIri}> .`, content].join('\n') });
      rootLines.push(`<${graphIri}> dct:hasPart <${partIri}> .`);
    }
    for (const row of profileDocuments) {
      const content = profileTriples(graphIri, row), partIri = graphIri + ':activity-profile:' + createHash('sha256').update(content).digest('hex');
      parts.push({ graphIri: partIri, graphContent: [...prefixes,
        `<${partIri}> a gaming:ActivityProfilePublication ; dct:isPartOf <${graphIri}> ; dct:subject <${row.document.versions[0].id}> .`, content].join('\n') });
      rootLines.push(`<${graphIri}> dct:hasPart <${partIri}> .`);
    }
    return { root: { graphIri, graphContent: rootLines.join('\n') }, parts };
  };
  return handle;
}
