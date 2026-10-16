/** Content owned by a game, usable by humans and agents without starting a learning attempt.
 * This is a resource catalog, not a Foxxi publication or a learner record. */
import { createHash } from 'node:crypto';

export const PERFORMANCE_RESOURCE_KINDS = Object.freeze(['job-aid', 'reference', 'concept']);
const digest = value => 'sha256:' + createHash('sha256').update(JSON.stringify(value)).digest('hex');

/** The content kinds match Foxxi's fragment forms; no competency or achievement is inferred. */
export function createPerformanceResource({ id, kind, title, source, text, requiresContext = false, contextRequirements = [], ui }) {
  if (typeof id !== 'string' || !/^[a-z][a-z0-9-]*:[a-z0-9-]+$/i.test(id)) throw new TypeError('A stable resource id is required.');
  if (!PERFORMANCE_RESOURCE_KINDS.includes(kind)) throw new TypeError('Unknown performance resource kind.');
  if (typeof title !== 'string' || !title.trim()) throw new TypeError('A resource title is required.');
  if (!source || typeof source.path !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(source.digest) || typeof source.selector !== 'string') throw new TypeError('A source path, digest and selector are required.');
  if (requiresContext && text !== undefined) throw new TypeError('Contextual content must not be published as a complete static body.');
  if (!requiresContext && (typeof text !== 'string' || !text.trim())) throw new TypeError('A complete static body is required.');
  const resource = {
    id, kind, title: title.trim(), purpose: kind === 'concept' ? 'instruction' : 'performance-support',
    audience: ['human', 'agent'], source,
    ...(requiresContext ? { requiresContext: true, contextRequirements: [...new Set(contextRequirements)].sort() }
      : { requiresContext: false, content: { mediaType: 'text/markdown', text: text.trim() } }),
    ...(ui ? { ui } : {}),
  };
  return { ...resource, revisionDigest: digest(resource) };
}

export function createPerformanceCatalog({ resources, courses = [], sources }) {
  const sorted = [...resources].sort((a, b) => a.id.localeCompare(b.id));
  const ids = new Set();
  for (const resource of sorted) {
    if (ids.has(resource.id)) throw new TypeError('Duplicate resource id: ' + resource.id);
    ids.add(resource.id);
  }
  for (const course of courses) {
    if (course.kind !== 'course-outline' || course.publicationStatus !== 'unpublished-outline' || course.assessment !== null) throw new TypeError('A catalog outline cannot claim publication or assessment.');
    if (!course.resources.length || course.resources.some(id => !ids.has(id))) throw new TypeError('Course resources must exist in this catalog.');
  }
  const catalog = {
    schemaVersion: 1,
    description: 'Game-authored performance support and instructional content. Reading a resource does not enroll a learner or establish achievement.',
    sources: [...sources].sort((a, b) => a.path.localeCompare(b.path)),
    resources: sorted, courses,
  };
  return { ...catalog, revisionDigest: digest(catalog) };
}
