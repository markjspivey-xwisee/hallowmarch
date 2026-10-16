/** Build the reviewed native SDK for local/CI proof tests. No live native I/O. */
import { readFile, mkdir, lstat, realpath, symlink } from 'node:fs/promises';
import { isAbsolute, resolve, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pin = JSON.parse(await readFile(join(repositoryRoot, 'server/gaming/interego-sdk.json'), 'utf8'));
const sdkRoot = process.env.INTEREGO_SDK_TEST_ROOT;
if (!sdkRoot || !isAbsolute(sdkRoot)) throw new Error('Set INTEREGO_SDK_TEST_ROOT to an absolute dedicated SDK checkout path.');
const root = resolve(sdkRoot);
if (root === repositoryRoot || root === '/') throw new Error('Use a dedicated SDK checkout directory.');
function command(name, args, { capture = false } = {}) {
  const result = spawnSync(name, args, { cwd: root, stdio: capture ? ['ignore', 'pipe', 'inherit'] : 'inherit', encoding: 'utf8' });
  if (result.error || result.status !== 0) throw new Error('Pinned native SDK setup command failed: ' + name);
  return capture ? result.stdout.trim() : undefined;
}
async function exists(path) { try { await lstat(path); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; } }
await mkdir(root, { recursive: true });
if (!await exists(join(root, '.git'))) {
  command('git', ['init', '.']);
  command('git', ['remote', 'add', 'origin', pin.repository + '.git']);
  command('git', ['fetch', '--depth', '1', 'origin', pin.revision]);
  command('git', ['checkout', '--detach', 'FETCH_HEAD']);
}
if (command('git', ['rev-parse', 'HEAD'], { capture: true }) !== pin.revision
  || command('git', ['hash-object', 'package-lock.json'], { capture: true }) !== pin.packageLockGitBlob) {
  throw new Error('The SDK checkout or dependency lock differs from the reviewed native pin.');
}
command('git', ['diff', '--quiet', 'HEAD', '--', 'packages/core', 'packages/solid', 'packages/pgsl', 'package.json', 'package-lock.json']);
const workspaces = ['@interego/core', '@interego/solid', '@interego/pgsl'];
// Match server/Dockerfile. Development dependencies provide the pinned tsc;
// source and all transitive versions come from the reviewed SDK lockfile.
command('npm', ['ci', ...workspaces.flatMap(name => ['--workspace', name]),
  '--include-workspace-root=false', '--ignore-scripts', '--no-audit', '--no-fund']);
for (const name of workspaces) command('npm', ['run', 'build', '--workspace', name]);
const packageLinks = join(repositoryRoot, 'server/node_modules/@interego');
await mkdir(packageLinks, { recursive: true });
for (const name of ['core', 'solid', 'pgsl']) {
  const source = join(root, 'packages', name), destination = join(packageLinks, name);
  if (await exists(destination)) {
    if (await realpath(destination) !== await realpath(source)) throw new Error('A different native SDK package is already installed: ' + name);
  } else await symlink(source, destination, 'dir');
}
const [core, solid, pgsl] = await Promise.all(['core', 'solid', 'pgsl'].map(name => import(
  pathToFileURL(join(root, 'packages', name, 'dist/index.js')).href)));
if (typeof core.createSignedDelegationCredential !== 'function' || typeof core.verifySignedAuthorship !== 'function'
  || typeof solid.digestedGraphRegion !== 'function' || typeof solid.parseAuthorshipProofFromDescriptorTurtle !== 'function'
  || typeof solid.wrapAsTriG !== 'function' || typeof pgsl.NativeCommitStore !== 'function') {
  throw new Error('Pinned native proof dependencies do not expose the required contracts.');
}
console.log('Pinned Interego core/solid/pgsl proof dependencies built and linked: ' + pin.revision);
