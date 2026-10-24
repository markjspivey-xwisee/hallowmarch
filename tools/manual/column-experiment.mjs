import { pathToFileURL } from 'node:url';
import { brotliCompressSync, constants } from 'node:zlib';
import assert from 'node:assert/strict';
const { realisticRollingWindow } = await import(pathToFileURL(process.cwd() + '/server/gaming/rolling-history-scale-fixture.mjs').href);
const plain = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const canonical = x => x === null || typeof x !== 'object' ? JSON.stringify(x) : Array.isArray(x) ? '[' + x.map(canonical).join(',') + ']' : '{' + Object.keys(x).sort().map(k => JSON.stringify(k) + ':' + canonical(x[k])).join(',') + '}';
const powers = new Map([[0, 1n]]);
const power = n => { if (!powers.has(n)) powers.set(n, 10n ** BigInt(n)); return powers.get(n); };
function decimal(v) {
  const [c, e = '0'] = JSON.stringify(v).toLowerCase().split('e'), point = c.indexOf('.');
  return { n: BigInt(c.replace('.', '')), e: Number(e) - (point < 0 ? 0 : c.length - point - 1) };
}
const compact = n => n <= BigInt(Number.MAX_SAFE_INTEGER) && n >= BigInt(Number.MIN_SAFE_INTEGER) ? Number(n) : n.toString();
function numeric(values) {
  const nums = values.map(decimal), e = Math.min(...nums.map(v => v.e));
  const ints = nums.map(v => v.n * power(v.e - e));
  const out = ['n', e, compact(ints[0]), ints.slice(1).map((n, i) => compact(n - ints[i]))];
  let n = BigInt(out[2]); const restored = [Number(n.toString() + 'e' + e)];
  for (const d of out[3]) { n += BigInt(d); restored.push(Number(n.toString() + 'e' + e)); }
  assert.equal(canonical(restored), canonical(values));
  return JSON.stringify(out).length < JSON.stringify(['v', values]).length * 4 ? out : ['v', values];
}
function columns(values, numbers) {
  const first = values[0];
  if (values.every(v => v === first)) return ['s', first];
  if (numbers && values.every(v => typeof v === 'number' && Number.isFinite(v))) return numeric(values);
  if (values.every(Array.isArray)) {
    const lengths = values.map(v => v.length), width = Math.max(...lengths);
    const children = Array.from({ length: width }, (_, i) => columns(values.filter(v => v.length > i).map(v => v[i]), numbers));
    return lengths.every(v => v === lengths[0]) && children.every(v => v[0] === 's') ? ['s', first] : ['a', lengths, children];
  }
  if (values.every(plain)) {
    const keys = [...new Set(values.flatMap(v => Object.keys(v)))].sort(), members = [], children = [];
    for (const key of keys) {
      const present = values.flatMap((v, i) => Object.hasOwn(v, key) ? [i] : []);
      members.push(present.length === values.length ? null : present);
      children.push(columns(present.map(i => values[i][key]), numbers));
    }
    return members.every(v => v === null) && children.every(v => v[0] === 's') ? ['s', first] : ['o', keys, members, children];
  }
  return ['v', values];
}
function expand(node, count) {
  if (node[0] === 's') return Array.from({ length: count }, () => structuredClone(node[1]));
  if (node[0] === 'v') return node[1];
  if (node[0] === 'n') {
    let n = BigInt(node[2]); const values = [Number(n.toString() + 'e' + node[1])];
    for (const d of node[3]) { n += BigInt(d); values.push(Number(n.toString() + 'e' + node[1])); }
    return values;
  }
  if (node[0] === 'a') {
    const rows = Array.from({ length: count }, () => []);
    for (let i = 0; i < node[2].length; i++) {
      const present = node[1].flatMap((length, row) => length > i ? [row] : []), values = expand(node[2][i], present.length);
      for (let j = 0; j < present.length; j++) rows[present[j]].push(values[j]);
    }
    return rows;
  }
  const rows = Array.from({ length: count }, () => ({}));
  for (let i = 0; i < node[1].length; i++) {
    const present = node[2][i] ?? Array.from({ length: count }, (_, j) => j), values = expand(node[3][i], present.length);
    for (let j = 0; j < present.length; j++) Object.defineProperty(rows[present[j]], node[1][i], { value: values[j], enumerable: true, writable: true, configurable: true });
  }
  return rows;
}
const doc = realisticRollingWindow();
const sdkRoot = process.env.INTEREGO_SDK_TEST_ROOT;
const [native, core] = await Promise.all(['pgsl', 'core'].map(name => import(pathToFileURL(sdkRoot + '/packages/' + name + '/dist/index.js').href)));
const owner = doc.owner, senderKeyPair = core.deriveEncryptionKeyPair('a'.repeat(64), owner);
const scope = { owner, pod: 'https://pod.example/game/', headUrl: 'https://pod.example/game/gaming/head', artifactContainer: 'https://pod.example/game/gaming/artifacts/' };
const client = new native.NativeCommitStore({ scope, senderKeyPair, ownerPublicKey: senderKeyPair.publicKey,
  recipientPublicKeys: [senderKeyPair.publicKey], atomicCheckpoint: true, fetch: async () => { throw Error('sizing_must_not_perform_io'); } });
for (const numbers of [false, true]) {
  const began = performance.now(), col = columns(doc.checkpoints, numbers);
  const encoded = { schema: 'experimental-columns-v1', document: { ...doc, checkpoints: [] }, count: doc.checkpoints.length, columns: col };
  const bytes = Buffer.from(canonical(encoded)), encodeMs = Math.round(performance.now() - began);
  const decodeBegan = performance.now();
  const restored = { ...encoded.document, checkpoints: expand(col, encoded.count) };
  assert.equal(canonical(restored), canonical(doc));
  const decodeMs = Math.round(performance.now() - decodeBegan);
  console.log(JSON.stringify({ typedColumns: true, numericSeries: numbers, snapshots: doc.checkpoints.length, bindings: 500, wireBytes: bytes.length, encodeMs, decodeMs, exact: true }));
  for (const quality of [4, 6, 9, 10]) {
    const began = performance.now(), compressed = brotliCompressSync(bytes, { params: { [constants.BROTLI_PARAM_QUALITY]: quality, [constants.BROTLI_PARAM_LGWIN]: 22 } });
    const compressionMs = Math.round(performance.now() - began);
    const artifact = native.createNativeByteArtifact({ owner, contentType: 'application/vnd.interego.rolling-checkpoint-delta-v1+br', bytes: compressed });
    const encryptedBytes = client.atomicCheckpointSize(artifact), reservedBytes = Math.ceil((encryptedBytes + 4096) / 4096) * 4096;
    const steadyHourlyBytes = reservedBytes * 122, budgetBytes = 64 * 1024 * 1024;
    console.log(JSON.stringify({ numericSeries: numbers, quality, compressedBytes: compressed.length, compressionMs,
      actualSdkEncryptedBytes: encryptedBytes, reservedBytes, steadyHourlyBytes, budgetBytes }));
    if (numbers && quality === 6) assert(steadyHourlyBytes < budgetBytes * 0.75, 'regular writes leave admission headroom under the existing budget');
  }
}
