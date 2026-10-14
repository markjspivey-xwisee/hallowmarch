#!/bin/bash
# Build the page, pull out its module script and lint it with eslint 8.
# usage: tools/lint.sh [lines-of-output]   (needs `npm install` in tools/ once)
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
root="$(dirname "$here")"
python3 "$root/build.py"
mkdir -p "$here/out"
python3 - "$root/hallowmarch.html" "$here/out/check.mjs" <<'PY'
import re, sys, pathlib
html = pathlib.Path(sys.argv[1]).read_text()
m = re.search(r'<script type="module">\n(.*)</script>', html, re.S)
pathlib.Path(sys.argv[2]).write_text(m.group(1))
PY
cd "$here"
npx eslint --no-eslintrc --env browser,es2022 --parser-options=ecmaVersion:2022,sourceType:module \
  --rule '{"no-undef":"error","no-unused-vars":["warn",{"args":"none"}],"no-redeclare":"error","no-dupe-keys":"error","no-unreachable":"warn","no-const-assign":"error","no-dupe-else-if":"error","no-self-assign":"warn","no-use-before-define":"off"}' \
  out/check.mjs | tail -"${1:-40}"
