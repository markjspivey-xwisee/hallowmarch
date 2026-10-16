/** Rebuild only from the reviewed SDK revision; no private registry or runtime credentials. */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
const revision = '87ee71626c015af3c1e7b9dac5579eff6899e8c1';
const esbuildVersion = '0.28.0';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sdk = process.env.HM_INTEREGO_SDK_ROOT;
if (!sdk) throw new Error('Set HM_INTEREGO_SDK_ROOT to the reviewed Interego checkout.');
if (execFileSync('git', ['rev-parse', 'HEAD'], { cwd: sdk, encoding: 'utf8' }).trim() !== revision) throw new Error('The SDK revision differs from the reviewed pin.');
const entries = {
  '@interego/core/crypto/client-vault': 'packages/core/src/crypto/client-vault.ts',
  '@interego/core/rdf/graph-digest': 'packages/core/src/rdf/graph-digest.ts',
  '@interego/core/relay': 'packages/core/src/relay/index.ts',
  '@interego/core/rdf': 'packages/core/src/rdf/index.ts',
};
const entry = [
  'export { ClientKeyVault, validEncryptionPublicKey } from "@interego/core/crypto/client-vault";',
  'export { canonicalGraphDigest } from "@interego/core/rdf/graph-digest";',
  'export { RelayMcpTransport, RelayClient } from "@interego/core/relay";',
  'export { parseTrig, turtleIriRef, escapeTurtleLiteral } from "@interego/core/rdf";',
].join('\n');
const esbuildPath = process.env.HM_ESBUILD_MODULE || path.join(sdk, 'node_modules/esbuild/lib/main.js');
const { build, version } = await import(pathToFileURL(esbuildPath));
if (version !== esbuildVersion) throw new Error('The browser bundle builder differs from its pinned version.');
const reviewedLockBytes = execFileSync('git', ['show', revision + ':package-lock.json'], { cwd: sdk });
const reviewedLock = JSON.parse(reviewedLockBytes);
const output = await build({ stdin: { contents: entry, resolveDir: sdk, sourcefile: 'interego-browser-entry.mjs', loader: 'js' },
  alias: Object.fromEntries(Object.entries(entries).map(([name, source]) => [name, path.join(sdk, source)])),
  bundle: true, platform: 'browser', format: 'esm', target: ['es2022'], minify: true,
  write: false, metafile: true, legalComments: 'eof', charset: 'utf8', treeShaking: true });
const sha = data => createHash('sha256').update(data).digest('hex');
const inputs = [];
const dependencies = new Map();
for (const relative of Object.keys(output.metafile.inputs).sort()) {
  if (path.basename(relative) === 'interego-browser-entry.mjs') continue;
  // tweetnacl's optional Node PRNG import is disabled by its own browser map;
  // browser entropy comes from crypto.getRandomValues. No shim is supplied.
  if (relative.startsWith('(disabled):')) { inputs.push({ source: relative, disabledByBrowserMap: true }); continue; }
  const absolute = path.resolve(sdk, relative);
  const name = path.relative(sdk, absolute).replaceAll(path.sep, '/');
  if (name.startsWith('../')) throw new Error('SDK bundle input escaped the pinned checkout.');
  const bytes = await readFile(absolute);
  if (name.startsWith('node_modules/')) {
    const segments = name.split('/');
    const dependency = segments[1].startsWith('@') ? segments.slice(0, 3).join('/') : segments.slice(0, 2).join('/');
    if (!dependencies.has(dependency)) {
      const metadata = JSON.parse(await readFile(path.join(sdk, dependency, 'package.json')));
      if (metadata.version !== reviewedLock.packages[dependency]?.version) throw new Error('A browser dependency differs from the reviewed lock: ' + dependency);
      dependencies.set(dependency, { name: metadata.name, version: metadata.version, license: metadata.license,
        integrity: reviewedLock.packages[dependency].integrity });
    }
  }
  if (!name.startsWith('node_modules/')) {
    const committed = execFileSync('git', ['show', revision + ':' + name], { cwd: sdk });
    if (sha(committed) !== sha(bytes)) throw new Error('An SDK source differs from the reviewed pin: ' + name);
  }
  inputs.push({ source: name, sha256: sha(bytes) });
}
const target = path.join(root, 'client/native-pod/vendor');
await mkdir(target, { recursive: true });
const bundle = output.outputFiles[0].contents;
await writeFile(path.join(target, 'interego-browser.mjs'), bundle);
await writeFile(path.join(target, 'INTEREGO-LICENSE.txt'), await readFile(path.join(sdk, 'LICENSE')));
const licenseTexts = [];
for (const [directory, metadata] of [...dependencies].sort()) {
  let found = false;
  for (const candidate of ['LICENSE', 'LICENSE.md', 'LICENSE.txt', 'COPYING']) {
    try { licenseTexts.push(metadata.name + '@' + metadata.version + '\n\n' + await readFile(path.join(sdk, directory, candidate), 'utf8')); found = true; break; }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  if (!found) throw new Error('A dependency license was not found: ' + directory);
}
await writeFile(path.join(target, 'DEPENDENCY-LICENSES.txt'), licenseTexts.join('\n\n' + '='.repeat(60) + '\n\n'));
await writeFile(path.join(target, 'interego-browser.manifest.json'), JSON.stringify({
  source: 'https://github.com/markjspivey-xwisee/interego', revision, esbuild: version,
  target: 'browser-es2022-esm', bundle: 'interego-browser.mjs', bytes: bundle.length, sha256: sha(bundle),
  entrypoints: entries, dependencyLockSha256: sha(reviewedLockBytes), dependencies: [...dependencies.values()], inputs,
}, null, 2) + '\n');
console.log('Built reviewed Interego browser primitives:', bundle.length, 'bytes; sha256', sha(bundle));
