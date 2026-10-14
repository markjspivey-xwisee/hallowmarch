// [perf3] assembles tools/wasm/*.wat with wabt (npm: wabt) and writes src/14s_wasm_bin.js (the modules as base64): run it
// after changing a .wat, then `python3 build.py`. usage: node tools/wasm/build.js [path to a node_modules holding wabt]
const fs = require('fs'), path = require('path');
const nm = process.argv[2] || path.join(__dirname, 'node_modules');
const wabt = require(path.join(nm, 'wabt'));
(async () => {
  const W = await wabt();
  const out = [];
  for (const f of fs.readdirSync(__dirname).filter((f) => f.endsWith('.wat')).sort()) {
    const mod = W.parseWat(f, fs.readFileSync(path.join(__dirname, f), 'utf8'));
    mod.validate();
    const { buffer } = mod.toBinary({});
    out.push(`  ${f.replace(/\.wat$/, '')}: '${Buffer.from(buffer).toString('base64')}', // ${buffer.length} bytes`);
    console.log(f, buffer.length, 'bytes');
  }
  fs.writeFileSync(path.join(__dirname, '../../src/14s_wasm_bin.js'), `// [perf3] WebAssembly modules (tools/wasm/*.wat, assembled by tools/wasm/build.js): base64, no network\nconst WASM_BIN = {\n${out.join('\n')}\n};\n`);
})();
