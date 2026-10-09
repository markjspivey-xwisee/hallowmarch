#!/usr/bin/env python3
"""Concatenate the page shell and the JS modules into one self-contained HTML file."""
import pathlib, re, sys

root = pathlib.Path(__file__).parent
src = root / 'src'
mods = sorted(p for p in src.glob('*.js') if re.match(r'^\d\d[a-z]?_', p.name))
shell = (src / 'page.html').read_text()
js = '\n'.join(f'/* ---- {p.name} ---- */\n' + p.read_text() for p in mods)
if '</script' in js:
    sys.exit('a module contains a closing script tag')
out = (
    shell.rstrip() + '\n'
    + '<script type="module">\n'
    + "import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.min.js';\n"
    + 'THREE.ColorManagement.enabled = false;\n'
    + js
    + '\n</script>\n'
)
dest = root / 'hallowmarch.html'
dest.write_text(out)
print(f'{dest} {len(out) / 1024:.0f} KB from {len(mods)} modules')
