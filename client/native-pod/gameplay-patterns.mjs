/** Bounded diagnostics for Hallowmarch's exact observed-gameplay Profiles.
 * This is not a general xAPI, JSON Schema or xAPI Profile validator. It supports
 * the rules/schema subset used by these snapshots and refuses other constructs.
 * Secondary motifs analyze identity-scoped relevant-event projections, not the
 * entire session stream. They establish temporal observations, never learning. */
export const GAMEPLAY_PATTERN_SCHEMA = 'hallowmarch.gameplay-pattern-analysis/v1';
export const GAMEPLAY_PATTERN_LIMITS = Object.freeze({ statements: 256, bytes: 512 * 1024 });
const BASE = 'https://march-production-f6d9.up.railway.app/gaming/activity-profile.jsonld';
const CONTEXT = 'urn:interego:gaming:activity:context', OBSERVATION = 'urn:interego:gaming:activity:observation';
const plain = value => value && typeof value === 'object' && !Array.isArray(value);
const canonical = value => Array.isArray(value) ? '[' + value.map(canonical).join(',') + ']'
  : plain(value) ? '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}' : JSON.stringify(value);
const same = (a, b) => canonical(a) === canonical(b);
const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);
const iso = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
const fail = message => { throw Object.assign(new TypeError(message), { code: 'unsupported_gameplay_profile' }); };
const motifs = [
  { id: 'ability-recovery', first: 'ability.refused', last: 'ability.executed', object: true },
  { id: 'craft-recovery', first: 'craft.refused', last: 'craft.completed', object: true },
  { id: 'bounty-reward', first: 'bounty.completed', last: 'bounty.claimed', object: true },
  { id: 'character-recovery', first: 'combat.died', last: 'character.respawned', character: true },
];

function located(statement, path) {
  const tokens = [...path.matchAll(/\.([A-Za-z][A-Za-z0-9_]*)|\['([^']+)'\]|\[(\*)\]/g)];
  if ('$' + tokens.map(token => token[0]).join('') !== path) fail('Unsupported gameplay rule path.');
  let values = [statement];
  for (const match of tokens) {
    const token = match[1] || match[2] || match[3];
    values = values.flatMap(value => token === '*' ? Array.isArray(value) ? value : []
      : plain(value) && Object.hasOwn(value, token) ? [value[token]] : []);
  }
  return values;
}
function ruleMatches(statement, rule) {
  if (Object.keys(rule).some(key => !['location', 'presence', 'all', 'any', 'none'].includes(key))) fail('Unsupported gameplay template rule.');
  if (rule.presence && !['included', 'excluded', 'recommended'].includes(rule.presence)) fail('Unsupported gameplay rule presence.');
  const values = located(statement, rule.location);
  if (rule.presence === 'included' && !values.length || rule.presence === 'excluded' && values.length) return false;
  if (rule.presence === 'recommended' && !values.length) return true;
  if (rule.any && !values.some(value => rule.any.some(expected => same(value, expected)))) return false;
  if (rule.all && !values.every(value => rule.all.some(expected => same(value, expected)))) return false;
  if (rule.none && values.some(value => rule.none.some(expected => same(value, expected)))) return false;
  return true;
}
function schemaMatches(value, schema) {
  const allowed = ['$schema', 'type', 'additionalProperties', 'required', 'properties', 'const', 'enum', 'minLength', 'maxLength', 'pattern', 'minimum', 'maximum', 'allOf', 'if', 'then'];
  if (!plain(schema) || Object.keys(schema).some(key => !allowed.includes(key))) fail('Unsupported gameplay extension schema.');
  if (schema.type) {
    if (!['object', 'string', 'number', 'integer', 'boolean'].includes(schema.type)) fail('Unsupported gameplay schema type.');
    if (schema.type === 'object' ? !plain(value) : schema.type === 'integer' ? !Number.isSafeInteger(value)
      : schema.type === 'number' ? typeof value !== 'number' || !Number.isFinite(value) : typeof value !== schema.type) return false;
  }
  if (Object.hasOwn(schema, 'const') && !same(value, schema.const) || schema.enum && !schema.enum.some(expected => same(value, expected))) return false;
  if (schema.minLength !== undefined && value.length < schema.minLength || schema.maxLength !== undefined && value.length > schema.maxLength
    || schema.pattern && !new RegExp(schema.pattern).test(value) || schema.minimum !== undefined && value < schema.minimum
    || schema.maximum !== undefined && value > schema.maximum) return false;
  if (schema.required && (!plain(value) || schema.required.some(key => !Object.hasOwn(value, key)))) return false;
  if (plain(value)) {
    if (schema.additionalProperties === false && Object.keys(value).some(key => !Object.hasOwn(schema.properties || {}, key))) return false;
    for (const [key, child] of Object.entries(schema.properties || {})) if (Object.hasOwn(value, key) && !schemaMatches(value[key], child)) return false;
  }
  if (schema.allOf && !schema.allOf.every(child => schemaMatches(value, child))) return false;
  if (schema.if && schemaMatches(value, schema.if) && schema.then && !schemaMatches(value, schema.then)) return false;
  return true;
}
function prepare(profile) {
  const version = profile?.versions?.[0]?.id;
  if (profile?.id !== BASE || profile.type !== 'Profile' || ![BASE + '/versions/1.0.0', BASE + '/versions/1.1.0'].includes(version)
    || !Array.isArray(profile.templates) || !Array.isArray(profile.patterns) || !Array.isArray(profile.concepts)) fail('An exact supported Hallowmarch observed Profile snapshot is required.');
  const schemas = profile.concepts.filter(concept => ['ContextExtension', 'ResultExtension'].includes(concept.type)).map(concept => {
    if (![CONTEXT, OBSERVATION].includes(concept.id) || typeof concept.inlineSchema !== 'string') fail('Unsupported gameplay extension.');
    return { id: concept.id, kind: concept.type, schema: JSON.parse(concept.inlineSchema) };
  });
  if (schemas.length !== 2) fail('Both observed gameplay extensions are required.');
  const primary = profile.patterns.filter(pattern => pattern.primary);
  const eventPattern = profile.patterns.find(pattern => pattern.id === primary[0]?.oneOrMore);
  if (primary.length !== 1 || !Array.isArray(eventPattern?.alternates)
    || eventPattern.alternates.length !== profile.templates.length || profile.templates.some(template => !eventPattern.alternates.includes(template.id))) fail('Unsupported gameplay primary pattern.');
  const supportedTemplates = ['id', 'type', 'inScheme', 'prefLabel', 'definition', 'deprecated', 'verb', 'objectActivityType', 'rules'];
  for (const template of profile.templates) {
    if (template.type !== 'StatementTemplate' || template.inScheme !== version || Object.keys(template).some(key => !supportedTemplates.includes(key))) fail('Unsupported gameplay template.');
  }
  const secondary = motifs.flatMap(motif => {
    const pattern = profile.patterns.find(item => item.id.endsWith('/' + motif.id)); if (!pattern) return [];
    const first = profile.templates.find(item => item.verb.endsWith(':' + motif.first)), last = profile.templates.find(item => item.verb.endsWith(':' + motif.last));
    if (pattern.primary || !same(pattern.sequence, [first?.id, last?.id])) fail('Unsupported gameplay secondary pattern.');
    return [{ ...motif, id: pattern.id, firstTemplate: first.id, lastTemplate: last.id }];
  });
  if (profile.patterns.length !== secondary.length + 2) fail('Unsupported additional gameplay patterns.');
  return { version, templates: profile.templates, schemas, primary: primary[0].id, secondary };
}
function validate(statement, contract) {
  const candidates = contract.templates.filter(template => statement.verb?.id === template.verb && statement.object?.definition?.type === template.objectActivityType);
  if (!candidates.length) return { status: 'unmatched', reason: 'no-matching-template' };
  if (!uuid(statement.id) || !iso(statement.timestamp) || !uuid(statement.context?.registration)
    || typeof statement.actor?.account?.name !== 'string' || !statement.actor.account.name.startsWith('did:')
    || typeof statement.object?.id !== 'string' || !statement.object.id.startsWith('urn:interego:gaming:activity:object:')) return { status: 'invalid', reason: 'invalid-emitter-envelope' };
  for (const template of candidates) if (!(template.rules || []).every(rule => ruleMatches(statement, rule))) return { status: 'invalid', reason: 'template-rule-failed' };
  for (const extension of contract.schemas) {
    const value = (extension.kind === 'ContextExtension' ? statement.context : statement.result)?.extensions?.[extension.id];
    if (!schemaMatches(value, extension.schema)) return { status: 'invalid', reason: 'extension-schema-failed' };
  }
  return { status: 'matched', templateIds: candidates.map(template => template.id) };
}
function identity(statement, motif) {
  const context = statement.context.extensions[CONTEXT];
  return JSON.stringify([statement.actor.account.homePage, statement.actor.account.name, context.bodyKind, context.bodyId,
    context.controllerKind, context.controllerId || null, context.grantId || null, ...(motif.object ? [statement.object.id] : [])]);
}
function analyzeMotif(rows, motif) {
  const pending = new Map(), matches = [];
  for (const row of rows) {
    const statement = row.statement, context = statement.context.extensions[CONTEXT];
    if (motif.character && context.bodyKind !== 'character') continue;
    const key = identity(statement, motif);
    if (row.templateIds.includes(motif.firstTemplate)) pending.set(key, statement);
    else if (row.templateIds.includes(motif.lastTemplate) && pending.has(key)) {
      matches.push({ statementIds: [pending.get(key).id, statement.id] }); pending.delete(key);
    }
  }
  const incomplete = [...pending.values()].map(statement => ({ statementIds: [statement.id] }));
  return { id: motif.id, status: matches.length ? 'matched' : incomplete.length ? 'incomplete' : 'unmatched', matches, incomplete };
}

export function analyzeGameplayPatterns(statements, profiles) {
  if (!Array.isArray(statements) || statements.length > GAMEPLAY_PATTERN_LIMITS.statements
    || new TextEncoder().encode(JSON.stringify(statements)).length > GAMEPLAY_PATTERN_LIMITS.bytes) throw Object.assign(new RangeError('A bounded observed gameplay statement window is required.'), { code: 'gameplay_pattern_capacity' });
  const snapshots = (Array.isArray(profiles) ? profiles : [profiles]).map(prepare);
  if (new Set(snapshots.map(snapshot => snapshot.version)).size !== snapshots.length) fail('Duplicate gameplay Profile snapshot versions.');
  const contracts = new Map(snapshots.map(snapshot => [snapshot.version, snapshot])), partitions = new Map(), unmatched = [], invalid = [], ids = new Map(), conflictingIds = new Set();
  let duplicatesIgnored = 0;
  for (let index = 0; index < statements.length; index++) {
    const statement = statements[index], statementId = statement?.id || null;
    if (!plain(statement)) { invalid.push({ statementId, index, reason: 'invalid-statement' }); continue; }
    if (ids.has(statementId)) {
      if (same(ids.get(statementId), statement)) { duplicatesIgnored++; continue; }
      conflictingIds.add(statementId); invalid.push({ statementId, index, reason: 'conflicting-statement-id' }); continue;
    }
    ids.set(statementId, statement);
    const versions = statement.context?.contextActivities?.category?.map?.(activity => activity.id)?.filter(version => version?.startsWith?.(BASE + '/versions/')) || [];
    if (versions.length !== 1 || !contracts.has(versions[0])) { unmatched.push({ statementId, index, reason: 'unknown-profile-version' }); continue; }
    const contract = contracts.get(versions[0]), checked = validate(statement, contract), registration = statement.context?.registration || null;
    const key = JSON.stringify([contract.version, registration]);
    if (!partitions.has(key)) partitions.set(key, { contract, registration, rows: [], invalid: [], unmatched: [] });
    const partition = partitions.get(key);
    if (checked.status !== 'matched') {
      const issue = { statementId, index, reason: checked.reason }; partition[checked.status].push(issue);
      (checked.status === 'invalid' ? invalid : unmatched).push(issue); continue;
    }
    partition.rows.push({ statement, templateIds: checked.templateIds, index });
  }
  const results = [...partitions.values()].map(partition => {
    for (const row of partition.rows) if (conflictingIds.has(row.statement.id)) partition.invalid.push({ statementId: row.statement.id, index: row.index, reason: 'conflicting-statement-id' });
    partition.rows.sort((a, b) => Date.parse(a.statement.timestamp) - Date.parse(b.statement.timestamp)
      || a.statement.result.extensions[OBSERVATION].historyOrdinal - b.statement.result.extensions[OBSERVATION].historyOrdinal || a.index - b.index);
    const status = partition.invalid.length ? 'invalid' : partition.unmatched.length || !partition.rows.length ? 'unmatched' : 'matched';
    return { profileVersion: partition.contract.version, registration: partition.registration, status,
      statementIds: partition.rows.map(row => row.statement.id), primary: { id: partition.contract.primary, status },
      motifs: status === 'matched' ? partition.contract.secondary.map(motif => analyzeMotif(partition.rows, motif)) : [],
      invalid: partition.invalid, unmatched: partition.unmatched };
  });
  return { schema: GAMEPLAY_PATTERN_SCHEMA, scope: 'bounded-hallowmarch-observation-profile-diagnostics',
    status: invalid.length ? 'invalid' : unmatched.length || !results.length ? 'unmatched' : 'matched',
    statementCount: statements.length - duplicatesIgnored, duplicatesIgnored, partitions: results, unmatched, invalid };
}
