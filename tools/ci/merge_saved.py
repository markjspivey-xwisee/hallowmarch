#!/usr/bin/env python3
"""Resolve only reviewed additive conflicts in the pinned version-20 branches.

Unknown conflicts abort, retaining git's conflict evidence for review.
"""
import pathlib
import re
import subprocess
import sys

ALLOWED = {
    "server/server.js": {
        (
            "import { makeCompanies, reservedNames, coPledgeApply, coText } from './companies.js'; // [companies]",
            "import { makeField } from './fieldarmies.js'; // [season2] the season's armies on the pages' fields",
        ),
        (
            "  else if (m.t === 'co') onCo(c, m); // [companies]",
            "  else if (m.t === 'sarmyrep') FIELD.report(c, m); // [season2]",
        ),
    },
    "src/14p_netws.js": {
        (
            "      else if (m.t === 'company' || m.t === 'co') coMsg(m); // [companies] the companies (14r_companies.js)",
            "      else if (m.t === 'sarmy' || m.t === 'sarmyfold') season2ServerMsg(m); // [season2] a season's army handed to this page, or taken back (08o_season2.js)",
        ),
    },
}

paths = subprocess.check_output(
    ["git", "diff", "--name-only", "--diff-filter=U"], text=True).splitlines()
prepared = {}
pattern = re.compile(r"^<<<<<<< [^\n]*\n(.*?)^=======\n(.*?)^>>>>>>> [^\n]*\n", re.M | re.S)
for name in paths:
    src = pathlib.Path(name).read_text()
    pairs = ALLOWED.get(name, set())
    def resolve(match):
        a, b = match.group(1).rstrip("\n"), match.group(2).rstrip("\n")
        if (a, b) not in pairs:
            raise ValueError("unreviewed conflict in " + name)
        return a + "\n" + b + "\n"
    try:
        out, n = pattern.subn(resolve, src)
        if not n or re.search(r"^(<<<<<<<|=======|>>>>>>>)", out, re.M):
            raise ValueError("unresolved conflict in " + name)
        prepared[name] = out
    except ValueError as exc:
        sys.exit(str(exc))
for name, out in prepared.items():
    pathlib.Path(name).write_text(out)
subprocess.run(["git", "add", "--", *paths], check=True)
subprocess.run(["git", "commit", "--no-edit"], check=True)
