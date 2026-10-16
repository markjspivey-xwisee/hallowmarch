#!/usr/bin/env node
/** npm --prefix tools run resources [-- --check]. Regenerate only when authored content changes. */
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { projectHallowmarchResources } from './performance-resources/hallowmarch.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const names = (await readdir(resolve(root, 'src'))).filter(name => /^\d\d[a-z]?_.*\.js$/.test(name)).sort();
const files = await Promise.all(names.map(async name => ({ path: 'src/' + name, text: await readFile(resolve(root, 'src', name), 'utf8') })));
const output = resolve(root, 'server/gaming/performance-resources.json');
const generated = JSON.stringify(projectHallowmarchResources(files), null, 2) + '\n';
if (process.argv.includes('--check')) {
  let actual;
  try { actual = await readFile(output, 'utf8'); } catch { actual = ''; }
  if (actual !== generated) { console.error('Performance resources are stale. Run npm --prefix tools run resources and review the generated content.'); process.exitCode = 1; }
  else console.log('Performance resources match their authored source hashes.');
} else {
  await writeFile(output, generated);
  const data = JSON.parse(generated);
  console.log(`Generated ${data.resources.length} resources and ${data.courses.length} course outline from checked-in content.`);
}
