#!/usr/bin/env python3
"""Run a Hallowmarch check and fail on both process errors and reported failures.

Some historical browser checks print failures but exit zero. This adapter retains
their actual output and makes those failures block CI; it never changes the game.
"""
import ast
import re
import subprocess
import sys

if len(sys.argv) < 2:
    sys.exit("usage: run_check.py COMMAND [ARG ...]")

cmd = sys.argv[1:]
failed = False
summary = False
p = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                     text=True, bufsize=1)
for line in p.stdout:
    print(line, end="", flush=True)
    s = line.strip()
    # water2 prefixes its diagnostic summary with elapsed time, e.g. errors [164s] [].
    s = re.sub(r"^(errors )\[\d+(?:\.\d+)?s\]\s*", r"\1", s)
    if re.match(r"^(FAIL(?:ED)?\b|STEP FAILED\b|\[pageerror\])", s):
        failed = True
    if re.search(r"\b[1-9]\d* (?:failed|failures)\b", s) or re.match(r"^view .* failed:", s):
        failed = True
    if re.search(r"\bbad=[1-9]\d*\b|\berrors=[1-9]\d*\b", s):
        failed = True
    for label in ("errors ", "bad programs ", "shader messages "):
        if s.startswith(label):
            try:
                value = ast.literal_eval(s[len(label):])
                if value:
                    failed = True
            except (ValueError, SyntaxError):
                # A malformed result is not evidence of a clean render.
                failed = True
    if s.startswith("t="):
        summary = True
code = p.wait()
if any(x.endswith("soak.py") for x in cmd) and not summary:
    print("FAIL: soak produced no simulation measurements", flush=True)
    failed = True
sys.exit(code if code else (1 if failed else 0))
