/** Browser-only transport from a reviewed native SDK commit. No credentials. */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const revision = 'dd258b5f01ed66d1ef566855802aa6b0f485ed30';
const esbuildVersion = '0.28.0';
const source = 'packages/pgsl/src/browser-native-resource.ts';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sdk = process.env.HM_INTEREGO_SDK_ROOT;
if (!sdk) throw new Error('Set HM_INTEREGO_SDK_ROOT to the reviewed Interego checkout.');
if (!/^[a-f0-9]{40}$/.test(revision)
  || execFileSync('git', ['rev-parse', 'HEAD'], { cwd: sdk, encoding: 'utf8' }).trim() !== revision) {
  throw new Error('The SDK revision differs from the reviewed pin.');
}
const sha = value => createHash('sha256').update(value).digest('hex');
const { build, version } = await import(pathToFileURL(process.env.HM_ESBUILD_MODULE
  || path.join(sdk, 'node_modules/esbuild/lib/main.js')));
if (version !== esbuildVersion) throw new Error('The browser builder differs from its reviewed version.');
const output = await build({ stdin: {
  contents: 'export { createNativeResourceClient, NativeResourceError } from "@interego/pgsl/browser-native-resource";',
  sourcefile: 'native-resource-browser-entry.mjs', resolveDir: sdk, loader: 'js',
}, alias: { '@interego/pgsl/browser-native-resource': path.join(sdk, source) },
bundle: true, platform: 'browser', format: 'esm', target: ['es2022'], minify: true,
write: false, metafile: true, legalComments: 'eof', charset: 'utf8', treeShaking: true });
const inputs = [];
for (const input of Object.keys(output.metafile.inputs).sort()) {
  if (path.basename(input) === 'native-resource-browser-entry.mjs') continue;
  const absolute = path.resolve(sdk, input), relative = path.relative(sdk, absolute).replaceAll(path.sep, '/');
  if (relative.startsWith('../') || relative.startsWith('node_modules/') || input.startsWith('(disabled):')) {
    throw new Error('The opaque native transport must have no external runtime dependencies.');
  }
  const bytes = await readFile(absolute);
  const committed = execFileSync('git', ['show', revision + ':' + relative], { cwd: sdk });
  if (sha(bytes) !== sha(committed)) throw new Error('A native transport source differs from the reviewed pin.');
  inputs.push({ source: relative, sha256: sha(bytes) });
}
if (!inputs.some(input => input.source === source)) throw new Error('Native transport source was not bundled.');
const target = path.join(root, 'client/native-pod/vendor');
await mkdir(target, { recursive: true });
const bundle = output.outputFiles[0].contents;
const filename = 'interego-native-resource-browser.mjs';
await writeFile(path.join(target, filename), bundle);
await writeFile(path.join(target, 'INTEREGO-NATIVE-RESOURCE-LICENSE.txt'), await readFile(path.join(sdk, 'LICENSE')));
await writeFile(path.join(target, 'interego-native-resource-browser.manifest.json'), JSON.stringify({
  source: 'https://github.com/markjspivey-xwisee/interego', revision, esbuild: version,
  target: 'browser-es2022-esm', bundle: filename, bytes: bundle.length, sha256: sha(bundle),
  entrypoint: source, inputs,
}, null, 2) + '\n');
process.stdout.write('Built reviewed native resource transport: ' + bundle.length + ' bytes; sha256 ' + sha(bundle) + '\n');
