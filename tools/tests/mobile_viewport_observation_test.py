"""Actual QA-source tests only: no Playwright import, browser, WebGL or host site."""
import ast
import asyncio
import contextlib
from datetime import datetime, timezone
import hashlib
import io
import json
import pathlib
import subprocess
import time
import types
import unittest

SOURCE = pathlib.Path(__file__).with_name('mobile_ergonomics.py')
ASSIGNS = {'VIEWPORT_POLL_SNAPSHOT', 'VIEWPORT_WAITS', 'VIEWPORT_WAIT_SERIAL',
           'VIEWPORT_STATE', 'VIEWPORT_PREDICATE', 'VIEWPORT_POLL'}
FUNCS = {'viewport_state', 'merge_viewport_polls', 'finish_viewport_wait', 'wait_for_viewport', 'geometry'}


def load_actual():
    tree = ast.parse(SOURCE.read_text(encoding='utf-8'))
    nodes = [n for n in tree.body if isinstance(n, ast.Assign) and any(
        isinstance(t, ast.Name) and t.id in ASSIGNS for t in n.targets)
        or isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef)) and n.name in FUNCS]
    ns = {'asyncio': asyncio, 'json': json, 'time': time, 'datetime': datetime, 'timezone': timezone}
    exec(compile(ast.Module(body=nodes, type_ignores=[]), str(SOURCE), 'exec'), ns)
    return ns


class FakePage:
    viewport_size = {'width': 844, 'height': 390}

    def __init__(self, error=None, after=None, probe_error=None):
        self.error, self.after, self.probe_error = error, after or {}, probe_error
        self.waits, self.reads = [], []

    async def wait_for_function(self, source, **options):
        self.waits.append((source, options))
        if self.error:
            raise self.error

    async def evaluate(self, source):
        self.reads.append(source)
        if self.probe_error:
            raise self.probe_error
        return dict(self.after)


class HostContract(unittest.IsolatedAsyncioTestCase):
    async def test_success_retains_one_wait_and_no_added_page_read(self):
        ns, page = load_actual(), FakePage()
        await ns['wait_for_viewport'](page)
        self.assertEqual(len(page.waits), 1)
        self.assertEqual(page.reads, [])
        self.assertEqual(page.waits[0][1], {'arg': {'id': 1}, 'polling': 20, 'timeout': 15000})
        receipt = ns['VIEWPORT_WAITS'][0]
        self.assertEqual(receipt['outcome'], 'matched')
        self.assertFalse(receipt['pagePollsCaptured'])
        self.assertGreaterEqual(receipt['hostElapsedMs'], 0)
        self.assertTrue(receipt['hostStartedUTC'].endswith('+00:00'))
        self.assertTrue(receipt['hostFinishedUTC'].endswith('+00:00'))

    async def test_late_match_or_matching_after_state_never_waives_original_timeout(self):
        ns, error = load_actual(), TimeoutError('original15s deadline')
        polls = {'id': 1, 'firstPollAt': 0, 'lastPollAt': 15001, 'firstMatchAt': 15001,
                 'polls': 2, 'samples': [], 'maxGapMs': 15001}
        page = FakePage(error, {'viewportWaitPolls': [polls], 'renderer': {'w': 844, 'h': 390}})
        with contextlib.redirect_stdout(io.StringIO()):
            with self.assertRaises(TimeoutError) as caught:
                await ns['wait_for_viewport'](page)
        self.assertIs(caught.exception, error)
        receipt = ns['VIEWPORT_WAITS'][0]
        self.assertEqual(receipt['outcome'], 'failed')
        self.assertEqual(receipt['polls']['firstMatchAt'], 15001)
        self.assertEqual(receipt['after']['renderer'], {'w': 844, 'h': 390})
        self.assertEqual(len(page.reads), 1, 'only the existing failure-only witness')

    async def test_failed_state_probe_preserves_identical_primary_exception(self):
        ns, error = load_actual(), RuntimeError('owned predicate error')
        page = FakePage(error, probe_error=ValueError('probe unavailable'))
        with contextlib.redirect_stdout(io.StringIO()):
            with self.assertRaises(RuntimeError) as caught:
                await ns['wait_for_viewport'](page)
        self.assertIs(caught.exception, error)
        self.assertEqual(ns['VIEWPORT_WAITS'][0]['after'], {'unavailable': 'ValueError'})

    async def test_unexpected_witness_helper_failure_cannot_mask_primary_or_expand_error(self):
        ns, error = load_actual(), TimeoutError('x' * 10000)
        async def broken(_):
            raise ValueError('secondary helper failed')
        ns['viewport_state'] = broken
        with contextlib.redirect_stdout(io.StringIO()):
            with self.assertRaises(TimeoutError) as caught:
                await ns['wait_for_viewport'](FakePage(error))
        self.assertIs(caught.exception, error)
        receipt = ns['VIEWPORT_WAITS'][0]
        self.assertLessEqual(len(receipt['error']), 2000)
        self.assertEqual(receipt['after'], {'unavailable': 'ValueError'})

    async def test_primary_clock_stops_before_failure_witness(self):
        ns, error = load_actual(), TimeoutError('original')
        values = iter([1, 16])
        ns['time'] = types.SimpleNamespace(monotonic=lambda: next(values))
        async def probe(_):
            self.assertEqual(ns['VIEWPORT_WAITS'][0]['hostElapsedMs'], 15000)
            return {}
        ns['viewport_state'] = probe
        with contextlib.redirect_stdout(io.StringIO()):
            with self.assertRaises(TimeoutError):
                await ns['wait_for_viewport'](FakePage(error))
        self.assertEqual(ns['VIEWPORT_WAITS'][0]['hostElapsedMs'], 15000)

    async def test_16_wait_cap_monotonic_ids_and_existing_geometry_harvest(self):
        ns, page = load_actual(), FakePage()
        for _ in range(20):
            await ns['wait_for_viewport'](page)
        self.assertEqual([r['id'] for r in ns['VIEWPORT_WAITS']], list(range(5, 21)))
        page.after = {'viewportWaitPolls': [{'id': 20, 'firstMatchAt': 14999, 'samples': []}], 'controls': ['unchanged']}
        result = await ns['geometry'](page)
        self.assertEqual(result, {'controls': ['unchanged']})
        self.assertEqual(page.reads, ['ME.geometry()'])
        self.assertEqual(ns['VIEWPORT_WAITS'][-1]['polls']['firstMatchAt'], 14999)
        ns['merge_viewport_polls']([{'id': 1, 'firstMatchAt': 0}])
        self.assertEqual(len(ns['VIEWPORT_WAITS']), 16)


class ActualJavaScript(unittest.TestCase):
    def test_pinned_original_predicate_and_fake_scheduler_observation(self):
        ns = load_actual()
        self.assertEqual(hashlib.sha256(ns['VIEWPORT_PREDICATE'].encode()).hexdigest(),
                         '47818bf9dc7cf8bed2c0268365529f9214325053358fb0e1a451cca907f8f46f')
        script = r"""
const vm=require('node:vm'),assert=require('node:assert/strict'),fs=require('node:fs');
const cfg=JSON.parse(fs.readFileSync(0,'utf8'));
function fixture(){let at=0,reads=0;const values={w:700,h:390,aspect:700/390,error:null};
 const ctx=vm.createContext({window:{},innerWidth:844,innerHeight:390,performance:{now:()=>at,timeOrigin:100000},Date:{now:()=>100000+at},
  __hm:{dbg:{renderer:{getSize(out){reads++;if(values.error)throw values.error;return out.set(values.w,values.h);}}},camera:{get aspect(){return values.aspect;}}}});
 return{ctx,values,poll:vm.runInContext(cfg.poll,ctx),original:vm.runInContext(cfg.original,ctx),
  snapshot:vm.runInContext(cfg.snapshot,ctx),at:n=>{at=n;},reads:()=>reads};}
// Exact original false dimensions and stale aspect remain false; only exact match succeeds.
const a=fixture();assert.equal(a.poll({id:1}),false);assert.equal(a.reads(),1);
a.values.w=844;a.at(20);assert.equal(a.poll({id:1}),false);
a.values.aspect=844/390;a.at(40);assert.equal(a.poll({id:1}),true);
assert.equal(a.reads(),3);assert.equal(a.snapshot()[0].firstMatchAt,40);
// First-match data survives the eight initial-sample cap and a large genuine poll gap.
const b=fixture();for(let i=0;i<8;i++){b.at(i*20);assert.equal(b.poll({id:2}),false);}
b.at(10000);assert.equal(b.poll({id:2}),false);b.values.w=844;b.values.aspect=844/390;b.at(14999);assert.equal(b.poll({id:2}),true);
const record=b.snapshot()[0];assert.equal(record.firstPollAt,0);assert.equal(record.lastPollAt,14999);assert.equal(record.firstMatchAt,14999);
assert.equal(record.firstPollUTCms,100000);assert.equal(record.lastPollUTCms,114999);assert.equal(record.firstMatchUTCms,114999);
assert.equal(record.pageTimeOrigin,100000);assert.equal(record.firstMatchUTCms,record.pageTimeOrigin+record.firstMatchAt);
assert.equal(record.lastPollUTCms,record.pageTimeOrigin+record.lastPollAt);assert.equal(record.polls,10);assert.equal(record.maxGapMs,9860);assert.equal(record.samples.length,8);assert.equal(record.droppedSamples,2);
assert(record.samples.every(s=>s.outcome==='pending'));assert.equal(record.lastOutcome,'matched');
// The fake original15s scheduler rejects late dispatch for both unwrapped and observed predicates.
function scheduled(observed,schedule){const f=fixture();for(const [time,matching]of schedule){if(time>=15000)return 'timeout';f.at(time);
 if(matching){f.values.w=844;f.values.aspect=844/390;}if(observed?f.poll({id:3}):f.original())return 'matched';}return 'timeout';}
for(const schedule of [[[0,false],[15001,true]],[[0,false],[14999,true]],[[15000,true]],[[0,false],[14000,false]]])
 assert.equal(scheduled(true,schedule),scheduled(false,schedule));
// Original predicate exception identity is preserved, including diagnostic getter failures.
const c=fixture(),primary={marker:'actual renderer failure'};c.values.error=primary;
assert.throws(()=>c.poll({id:4}),error=>error===primary);assert.equal(c.snapshot()[0].predicateErrors,1);
const d=fixture();Object.defineProperty(d.ctx.window,'__mobileViewportWaits',{get(){throw Error('observer unavailable');}});
d.values.w=844;d.values.aspect=844/390;assert.equal(d.poll({id:5}),true);d.values.error=primary;assert.throws(()=>d.poll({id:5}),error=>error===primary);
// Clock-observer failures also preserve the original Boolean and exception identity.
const clock=fixture();clock.ctx.Date.now=()=>{throw Error('clock unavailable');};assert.equal(clock.poll({id:6}),false);
clock.values.w=844;clock.values.aspect=844/390;assert.equal(clock.poll({id:6}),true);clock.values.error=primary;assert.throws(()=>clock.poll({id:6}),error=>error===primary);
// Missing/non-numeric timeOrigin stays a bounded null diagnostic value.
const origin=fixture();origin.ctx.performance.timeOrigin='unavailable';origin.poll({id:7});assert.equal(origin.snapshot()[0].pageTimeOrigin,null);
// Page storage is bounded independently of host receipts; no discarded record can replace a new wait.
const e=fixture();for(let i=1;i<=20;i++){e.at(i);e.poll({id:i});}const all=e.snapshot();assert.equal(all.length,16);
assert.deepEqual(Array.from(all,r=>r.id),Array.from({length:16},(_,i)=>i+5));
console.log(JSON.stringify({actualPredicate:true,fakeSchedulerOnly:true,firstMatchIndependent:true,exceptionsIdentical:true,boundedRecords:true,browserLaunched:false}));
"""
        run = subprocess.run(['node', '-e', script], input=json.dumps({'poll': ns['VIEWPORT_POLL'],
                             'original': ns['VIEWPORT_PREDICATE'], 'snapshot': ns['VIEWPORT_POLL_SNAPSHOT']}),
                             text=True, capture_output=True, timeout=10, check=False)
        self.assertEqual(run.returncode, 0, run.stderr)
        self.assertTrue(json.loads(run.stdout)['browserLaunched'] is False)


if __name__ == '__main__':
    unittest.main()
