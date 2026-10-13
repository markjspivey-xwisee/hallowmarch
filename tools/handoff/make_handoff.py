"""Build the Interego handoff record (Turtle) for the graph urn:graph:project:hallowmarch from CLAUDE.md plus the
status header in tools/handoff/status.md. Publish the output with Interego's publish_context (graph_iri
urn:graph:project:hallowmarch, visibility shared, modal status Asserted, sign_authorship true, if_match set to the
current head from get_current_head).
usage: python3 tools/handoff/make_handoff.py OUT.ttl [VERSION] [STATUS_LINE] [summary]
summary: (version 15) the record holds the status, the owner's standing requirements, how to build (and how sessions work alongside each other), the roadmap's
latest rows and Next, and the history, with the commit whose CLAUDE.md holds the rest (the whole notes passed 500 KB,
too much to send through a tool call at each milestone)."""
import pathlib, sys, datetime
HERE = pathlib.Path(__file__).resolve().parent
doc = (HERE.parents[1] / 'CLAUDE.md').read_text()
body = doc.split('\n', 1)[1].lstrip()
head = (HERE / 'status.md').read_text().strip() + '\n\n---\n\n'
if 'summary' in sys.argv[4:]:
    import re, subprocess
    def section(title):
        i = doc.index('\n## ' + title); j = doc.find('\n## ', i + 4)
        return doc[i + 1:j if j > 0 else len(doc)].rstrip() + '\n'
    pre = doc[doc.index('- **Owner:**'):doc.index('\n## ')].rstrip() + '\n'
    road = section('Roadmap').split('\n')
    rows = [l for l in road if re.match(r'\| \d+ \|', l)]
    keep = road[:road.index(rows[0])] + rows[-8:]
    commit = subprocess.run(['git', '-C', str(HERE.parents[1]), 'rev-parse', '--short', 'HEAD'], capture_output=True, text=True).stdout.strip()
    md = (head + '# The Hallowmarch: working notes, in summary\n\n' + pre + '\n'
          + f'The whole working notes (the architecture, every module, the conventions, the tests and every measure) are the repository\'s `CLAUDE.md` (commit {commit} on `main`); this record holds the parts a newcomer needs first.\n\n'
          + section("The owner's standing requirements") + '\n' + section('Build and run') + '\n'
          + (section('Working alongside other sessions') + '\n' if '\n## Working alongside other sessions' in doc else '')
          + '\n'.join(keep) + '\n\n' + section('History'))
else:
    md = head + body
assert '"""' not in md and not md.rstrip().endswith('"')
esc = md.replace('\\', '\\\\')
version = sys.argv[2] if len(sys.argv) > 2 else '9'
status = sys.argv[3] if len(sys.argv) > 3 else f'Version {version} merged and published'
today = datetime.date.today().isoformat()
ttl = f'''@prefix schema: <https://schema.org/> .
@prefix dct: <http://purl.org/dc/terms/> .
@prefix hmd: <https://relay.interego.xwisee.com/ns/maintainer/hmd#> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .

<urn:project:hallowmarch>
  a schema:SoftwareSourceCode, schema:VideoGame, schema:Note, hmd:Document ;
  dct:title "The Hallowmarch: project handoff" ;
  schema:name "The Hallowmarch" ;
  schema:description "An original three-realm war game for the browser, built entirely in code with three.js and published as one HTML file." ;
  schema:url <https://claude.ai/artifact/QgnzHjUXkBKjCtHwb6H62T> ;
  schema:codeRepository <https://github.com/markjspivey-xwisee/hallowmarch> ;
  schema:programmingLanguage "JavaScript", "GLSL", "Python" ;
  schema:runtimePlatform "Web browser with WebGL 2; three.js 0.160.0" ;
  schema:version "{version}" ;
  schema:creativeWorkStatus "{status}" ;
  schema:dateModified "{today}"^^xsd:date ;
  schema:encodingFormat "text/markdown; charset=UTF-8; variant=CommonMark" ;
  dct:conformsTo <https://relay.interego.xwisee.com/ns/maintainer/hmd> ;
  schema:text """{esc}""" .
'''
pathlib.Path(sys.argv[1]).write_text(ttl)
try:
    import rdflib
    g = rdflib.Graph(); g.parse(data=ttl, format='turtle')
    print('triples', len(g), 'chars', len(ttl))
except ImportError:
    print('chars', len(ttl), '(rdflib not installed: Turtle not checked)')
