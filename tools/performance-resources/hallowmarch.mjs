/** Read checked-in content structurally. Never execute game JavaScript or invent runtime values. */
import { parse } from 'acorn';
import { createHash } from 'node:crypto';
import { createPerformanceResource, createPerformanceCatalog } from '../../server/gaming/performance-resource-model.js';

const fileDigest = text => 'sha256:' + createHash('sha256').update(text).digest('hex');
const keyOf = node => node?.type === 'Identifier' ? node.name : node?.type === 'Literal' ? String(node.value) : null;
const property = (node, key) => node?.type === 'ObjectExpression' ? node.properties.find(p => !p.computed && keyOf(p.key) === key)?.value : undefined;
function walk(node, visit, ancestors = []) {
  if (!node || typeof node !== 'object' || !node.type) return;
  visit(node, ancestors);
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) for (const child of value) walk(child, visit, [...ancestors, node]);
    else if (value && typeof value === 'object' && value.type) walk(value, visit, [...ancestors, node]);
  }
}
function staticText(node) {
  if (node?.type === 'Literal' && typeof node.value === 'string') return node.value;
  if (node?.type === 'TemplateLiteral' && !node.expressions.length) return node.quasis[0].value.cooked;
  if (node?.type === 'BinaryExpression' && node.operator === '+') {
    const a = staticText(node.left), b = staticText(node.right);
    if (a !== undefined && b !== undefined) return a + b;
  }
  if (node?.type === 'ArrowFunctionExpression' || node?.type === 'FunctionExpression') {
    if (node.body.type !== 'BlockStatement') return staticText(node.body);
    if (node.body.body.length === 1 && node.body.body[0].type === 'ReturnStatement') return staticText(node.body.body[0].argument);
  }
  return undefined;
}
/** A deliberately small authored-HTML projection. No interpolation or executable markup survives. */
export function markdownOf(html) {
  return html.replace(/<br\s*\/?\s*>/gi, '\n').replace(/<\/(?:p|div|li|h[1-6])>/gi, '\n\n')
    .replace(/<b>([\s\S]*?)<\/b>/gi, '**$1**').replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ').replace(/\n\s*\n\s*\n/g, '\n\n').trim();
}
function contextRequirements(node) {
  const found = new Set();
  walk(node, n => {
    if (n.type === 'Identifier' && ['IS_TOUCH', 'LK', 'g2Use'].includes(n.name)) found.add('input-device');
    if (n.type === 'Identifier' && ['R', 'REALMS', 'homeIn'].includes(n.name)) found.add('realm');
    if (n.type === 'Identifier' && ['P', 'GAME', 'prog'].includes(n.name)) found.add('player-state');
  });
  return found.size ? [...found] : ['runtime-game-context'];
}
const member = (n, object, name) => n?.type === 'MemberExpression' && n.object.type === 'Identifier' && n.object.name === object && keyOf(n.property) === name;
const mentionsNotes = node => { let yes = false; walk(node, n => { if (n.type === 'Identifier' && n.name === 'FIELD_NOTES') yes = true; }); return yes; };

/** files is [{path,text}], in the same sorted module order as build.py. */
export function projectHallowmarchResources(files) {
  const resources = new Map(), sources = [];
  const add = (path, text, node, values) => {
    const source = { path, digest: fileDigest(text), selector: values.selector,
      lines: { start: node.loc.start.line, end: node.loc.end.line } };
    const { selector, ...rest } = values;
    const result = createPerformanceResource({ ...rest, source });
    // Source modules explicitly guard extensions from replacing earlier note ids.
    if (resources.has(result.id)) throw new Error('Duplicate authored resource: ' + result.id);
    resources.set(result.id, result);
  };
  for (const { path, text } of files) {
    const ast = parse(text, { ecmaVersion: 'latest', sourceType: 'module', locations: true });
    const previousCount = resources.size;
    const noteObjects = new Map();
    walk(ast, (node, ancestors) => {
      if (node.type === 'ObjectExpression') {
        const parent = ancestors.at(-1);
        let isRegistry = parent?.type === 'VariableDeclarator' && ['FIELD_NOTES', 'G2_NOTES'].includes(parent.id.name);
        if (parent?.type === 'CallExpression' && member(parent.callee, 'Object', 'assign') && parent.arguments[0]?.name === 'FIELD_NOTES') isRegistry = true;
        if (parent?.type === 'CallExpression' && member(parent.callee, 'Object', 'entries') && ancestors.some(a => a.type === 'ForOfStatement' && mentionsNotes(a.body))) isRegistry = true;
        if (isRegistry) for (const p of node.properties) {
          if (p.type === 'Property' && !p.computed && property(p.value, 't') && property(p.value, 'x')) noteObjects.set(keyOf(p.key), p.value);
        }
      }
      if (node.type === 'AssignmentExpression' && node.left.type === 'MemberExpression' && node.left.object.name === 'FIELD_NOTES' && !node.left.computed && property(node.right, 't') && property(node.right, 'x')) noteObjects.set(keyOf(node.left.property), node.right);
      if (node.type === 'FunctionDeclaration' && node.id.name === 'prologuePages') {
        const returned = node.body.body.find(s => s.type === 'ReturnStatement')?.argument;
        if (returned?.type !== 'ArrayExpression') throw new Error('Prologue pages are no longer an authored array.');
        returned.elements.forEach((page, index) => {
          const title = staticText(property(page, 't')), paragraphs = property(page, 'p');
          if (!title || paragraphs?.type !== 'ArrayExpression') throw new Error('Prologue shape changed.');
          const parts = paragraphs.elements.map(staticText), complete = parts.every(p => p !== undefined);
          add(path, text, page, { id: 'lore:' + (index + 1), kind: 'concept', title,
            selector: 'prologuePages()[' + index + ']', requiresContext: !complete,
            ...(complete ? { text: parts.map(markdownOf).join('\n\n') } : { contextRequirements: contextRequirements(page) }),
            ui: { destination: 'Chronicle → The March → Replay the prologue', page: index + 1 } });
        });
      }
      if (node.type === 'TemplateLiteral' && path === 'src/10_ui.js' && ancestors.some(a => a.type === 'FunctionDeclaration' && a.id.name === 'drawWorldMap')) {
        for (const quasi of node.quasis) {
          const legend = quasi.value.cooked?.match(/<div class="legend">([\s\S]*?)<\/div>/);
          if (!legend || !legend[1].includes('Temple of a hallow')) continue;
          // This bounded literal contains only the shared legend, never dynamic WAR or player state.
          const entries = [...legend[1].matchAll(/<span>([\s\S]*?)<\/span>/g)].map(m => markdownOf(m[1]));
          if (!entries.length) throw new Error('Map legend has no authored entries.');
          add(path, text, quasi, { id: 'map:legend', kind: 'reference', title: 'Map legend',
            selector: 'drawWorldMap(): .legend', text: entries.map(t => '- ' + t).join('\n'),
            ui: { destination: 'Map' } });
        }
      }
    });
    for (const [id, node] of noteObjects) {
      const title = staticText(property(node, 't')), body = property(node, 'x'), complete = staticText(body);
      if (!title) throw new Error('Field note title needs runtime context: ' + id);
      add(path, text, node, { id: 'field-note:' + id, kind: 'job-aid', title,
        selector: 'FIELD_NOTES.' + id, requiresContext: complete === undefined,
        ...(complete === undefined ? { contextRequirements: contextRequirements(body) } : { text: markdownOf(complete) }),
        ui: { destination: 'Chronicle → Your path → Field notes', note: id, availability: 'Collected in the game when relevant' } });
    }
    if (resources.size !== previousCount) sources.push({ path, digest: fileDigest(text) });
  }
  const courseResources = [...resources.keys()].filter(id => id.startsWith('lore:'));
  if (!resources.has('map:legend') || !courseResources.length || ![...resources.keys()].some(id => id.startsWith('field-note:'))) throw new Error('Expected authored map, lore and field-note resources.');
  return createPerformanceCatalog({ resources: [...resources.values()], sources,
    courses: [{ id: 'course:lore-prologue', kind: 'course-outline', title: 'The Hallowmarch', audience: ['human', 'agent'],
      resources: courseResources, publicationStatus: 'unpublished-outline', assessment: null }] });
}
