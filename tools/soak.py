"""Long war simulation: python3 tools/soak.py [minutes] [chunk-seconds]. Prints keeps, relics, warbands and news per chunk."""
import json, subprocess, sys, pathlib
HM = str(pathlib.Path(__file__).resolve().with_name('hm.py'))
mins = int(sys.argv[1]) if len(sys.argv) > 1 else 30
chunk = int(sys.argv[2]) if len(sys.argv) > 2 else 300
script = [["eval","__hm.fn.setQuality('low')"],["eval","__hm.start({realm:0, cls:'warrior', level:15})"]]
for i in range(mins * 60 // chunk):
    script.append(["eval", f"(()=>{{const t0=performance.now(); const s=__hm.simulate({chunk}); const all=__hm.WAR.news.map(n=>Math.round(n.t)+' '+n.text); s.news=all.slice(-14); s.ms=Math.round(performance.now()-t0); delete s.roles; return s}})()"])
r = subprocess.run(['python3', HM,json.dumps({"w":320,"h":180,"script":script})],capture_output=True,text=True,timeout=3000)
for line in r.stdout.splitlines():
    if line.startswith('eval -> {'):
        d = json.loads(line[8:])
        print(f"t={d['t']} ents={d['ents']} bad={d['nonFinite']} ms={d['ms']} stats={d['stats']} errors={len(d['errors'])}")
        print('  keeps:', ', '.join(d['keeps']))
        print('  relics:', ', '.join(d['relics']))
        print('  bands:', ', '.join(d['warbands']))
        for n in d['news']: print('   ', n)
        for e in d['errors'][:3]: print('  ERR', e[:400])
    elif not line.startswith('eval -> '):
        print(line)
