"""CPU-only journey phase, trace-boundary and failure preservation checks."""
import argparse
import ast
import asyncio
import contextlib
import io
import json
import pathlib
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import first_session_journey as journey
from native_journey_browser import installed_driver, process_options


POINTER_PROGRAM = r"""
import assert from 'node:assert/strict';import vm from 'node:vm';import{readFileSync}from'node:fs';
const source=JSON.parse(readFileSync(0,'utf8')),listeners=new Map();let clock=100;
const rect={left:8,top:80,right:201,bottom:149,width:193,height:69};
const node=(id,r=rect)=>({id,tagName:id==='scene'?'CANVAS':'DIV',className:'fixture',textContent:id,
  hidden:false,getBoundingClientRect:()=>({...r}),hasPointerCapture:()=>true});
const canvas=node('scene',{left:0,top:0,right:390,bottom:780,width:390,height:780}),overlay=node('tf');
const player=Object.freeze({target:5,alive:true}),pointer=Object.freeze({x:195,y:156,sx:195,sy:156,moved:0,t:50,type:'touch'});
const input=Object.freeze({pointers:new Map([[1,pointer]]),joy:null});
const window={__hm:{GAME:{player,t:12},INPUT:input,UI:{modal:null},mobile:{prefs:{hand:'right'}}},
  addEventListener(type,fn,options){assert.equal(options.passive,true);const entries=listeners.get(type)||[];entries.push({fn,capture:!!options.capture});listeners.set(type,entries);},
  removeEventListener(type,fn,capture){listeners.set(type,(listeners.get(type)||[]).filter(value=>value.fn!==fn||value.capture!==capture));}};
const document={hidden:false,activeElement:canvas,hasFocus:()=>true,getElementById:()=>canvas,
  querySelectorAll:()=>[overlay],elementFromPoint:()=>canvas};
const context=vm.createContext({window,document,innerWidth:390,innerHeight:780,performance:{now:()=>++clock},
  getComputedStyle:()=>({display:'block',visibility:'visible',opacity:'1',pointerEvents:'auto'})});
const before=vm.runInContext('('+source.install+')',context)({x:195,y:156});
assert.equal(before.hit.id,'scene');assert.equal(before.overlays[0].rect.bottom,149);
const event={type:'pointerup',isTrusted:true,eventPhase:1,pointerId:1,pointerType:'touch',timeStamp:99.1,
  clientX:195,clientY:156,width:8,height:8,pressure:0,buttons:0,defaultPrevented:false,target:overlay,
  composedPath:()=>[overlay,document,window],preventDefault(){throw Error('read-only probe cancelled input');},
  stopPropagation(){throw Error('read-only probe changed propagation');}};
const dispatch=e=>{for(const row of listeners.get(e.type)||[])row.fn(e);};
dispatch(event);dispatch({...event,type:'pointercancel',isTrusted:false});
for(let i=0;i<100;i++)dispatch({...event,type:'pointermove'});
const receipt=vm.runInContext('('+source.stop+')',context)();
assert.equal(receipt.rows.length,32);assert(receipt.omitted>0);
assert.equal(receipt.rows[0].target.id,'tf');assert.equal(receipt.rows[0].state.hit.id,'scene');
assert.deepEqual(Array.from(receipt.rows[0].path,value=>typeof value==='string'?value:value.id),['tf','document','window']);
assert.equal(receipt.rows[0].isTrusted,true);assert.equal(receipt.rows[2].isTrusted,false);
assert.equal(receipt.rows[0].phase,'capture');assert.equal(receipt.rows[1].phase,'bubble');
assert.equal(receipt.rows[0].state.pointer.ageMs>=50,true);assert.equal(receipt.rows[0].state.pointer.moved,0);
assert.equal(receipt.after.target,5);assert.equal(player.target,5);assert.equal(window.__hm.GAME.t,12);
assert.equal(input.pointers.get(1),pointer);assert.equal(input.pointers.size,1);
assert.equal([...listeners.values()].flat().length,0);assert.equal(window.__journeyPointerReceipt,undefined);
console.log('bounded passive receipts preserve native flags, dispatch targets, input state, and cleanup');
"""


class TraceFixture:
    def __init__(self):
        self.calls = []

    async def start(self, **kwargs):
        self.calls.append(('start', kwargs))

    async def stop(self, **kwargs):
        self.calls.append(('stop', kwargs))


class FirstSessionObservability(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        out = pathlib.Path(self.temporary.name)
        html = out / 'fixture.html'
        html.write_text('<html></html>', encoding='utf-8')
        self.fixture = journey.Journey(argparse.Namespace(out=out, html=html, touch=False, edge_native=True))
        self.trace = TraceFixture()
        self.fixture.context = argparse.Namespace(tracing=self.trace)
        self.output = contextlib.redirect_stdout(io.StringIO())
        self.output.__enter__()
        self.addCleanup(self.output.__exit__, None, None, None)

    def test_launcher_and_wait_phase_persist_before_the_first_player_record(self):
        self.fixture.phase('browser-launch')
        self.fixture.phase('title-wait', entry='fresh', timeoutSeconds=240)
        saved = json.loads((self.fixture.out / 'journey.json').read_text())
        self.assertEqual(saved['steps'], [])
        self.assertEqual(saved['phase']['name'], 'title-wait')
        self.assertEqual(saved['phases'][0]['name'], 'browser-launch')

    def test_trace_cleanup_preserves_primary_failure_and_has_an_explicit_timeout(self):
        async def timeout(awaitable, timeout):
            self.assertEqual(timeout, 20)
            awaitable.close()
            raise asyncio.TimeoutError()
        self.fixture.phase('wait', condition='first actual control')
        self.fixture.fail(AssertionError('primary player failure'))
        self.fixture.trace_state = 'recording'
        self.fixture.trace_label = 'entry'
        with patch.object(journey.asyncio, 'wait_for', side_effect=timeout):
            with self.assertRaises(asyncio.TimeoutError):
                asyncio.run(self.fixture.stop_ui_trace())
        self.assertEqual(self.fixture.report['failure'], 'primary player failure')
        self.assertEqual(self.fixture.report['failurePhase']['condition'], 'first actual control')
        error = self.fixture.report['cleanupErrors'][0]
        self.assertEqual(error['operation'], 'trace.stop')
        self.assertEqual(error['type'], 'TimeoutError')
        self.assertTrue(error['error'])
        self.assertEqual(self.fixture.trace_state, 'uncertain')
        asyncio.run(self.fixture.stop_ui_trace())
        self.assertEqual(len(self.fixture.report['cleanupErrors']), 1, 'an uncertain stop is not automatically retried')

    def test_successful_trace_segments_have_distinct_evidence_paths(self):
        for label in ['entry', 'return']:
            asyncio.run(self.fixture.start_ui_trace(label))
            asyncio.run(self.fixture.stop_ui_trace())
        self.assertEqual(self.fixture.report['traceArtifacts'], ['trace-entry.zip', 'trace-return.zip'])
        self.assertEqual(self.fixture.trace_state, 'off')
        self.assertEqual(len(self.trace.calls), 4)

    def test_title_timeout_retains_a_bounded_readonly_receipt(self):
        async def title(*args, **kwargs):
            raise TimeoutError('title fence did not settle')
        async def evaluate(expression):
            self.assertEqual(expression, journey.SNAPSHOT)
            return {'phase': 'Drawing first view', 'stopped': False}
        self.fixture.page = argparse.Namespace(evaluate=evaluate)
        with patch.object(journey, 'wait_title_settled', side_effect=title):
            with self.assertRaises(TimeoutError):
                asyncio.run(self.fixture.settle_title('fresh'))
        self.assertEqual(self.fixture.report['failurePhase']['name'], 'title-wait')
        self.assertEqual(self.fixture.report['titleReceipts']['fresh']['phase'], 'Drawing first view')

    def test_cold_and_reload_title_boundaries_precede_ui_trace_start(self):
        tree = ast.parse(pathlib.Path(journey.__file__).read_text(encoding='utf-8'))
        play = next(node for node in ast.walk(tree) if isinstance(node, ast.AsyncFunctionDef) and node.name == 'play')
        calls = sorted((node.lineno, node.func.attr, node.args[0].value if node.args and isinstance(node.args[0], ast.Constant) else None)
                       for node in ast.walk(play) if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute)
                       and node.func.attr in ['settle_title', 'start_ui_trace', 'stop_ui_trace', 'reload'])
        self.assertEqual([(name, value) for _, name, value in calls], [
            ('settle_title', 'fresh'), ('start_ui_trace', 'entry'), ('stop_ui_trace', None),
            ('reload', None), ('settle_title', 'reload'), ('start_ui_trace', 'return')])

    def test_title_screenshots_wait_for_the_real_loading_veil_to_be_hidden(self):
        calls = []
        async def evaluate(expression):
            calls.append('snapshot')
            return {'stopped': False, 'errors': [], 'native': False, 'host': '', 'modal': None}
        async def wait_for(**kwargs):
            self.assertEqual(kwargs, {'state': 'hidden', 'timeout': 5000})
            calls.append('loading-hidden')
        def locator(selector):
            self.assertEqual(selector, '#loading')
            return argparse.Namespace(wait_for=wait_for)
        async def screenshot(**kwargs):
            calls.append('screenshot')
        self.fixture.page = argparse.Namespace(evaluate=evaluate, locator=locator, screenshot=screenshot)
        for label in ['01-title', '08-returning-title']:
            calls.clear()
            asyncio.run(self.fixture.record(label, shot=True))
            self.assertEqual(calls, ['snapshot', 'loading-hidden', 'screenshot'])
            self.assertGreaterEqual(self.fixture.report['steps'][-1]['screenshotElapsed'], self.fixture.report['steps'][-1]['elapsed'])
        calls.clear()
        asyncio.run(self.fixture.record('02-prologue', shot=True))
        self.assertEqual(calls, ['snapshot', 'screenshot'])

    def test_pointer_receipt_is_readonly_bounded_and_cleans_up_all_listeners(self):
        node, _ = installed_driver()
        result = subprocess.run([str(node), '--input-type=module', '-e', POINTER_PROGRAM],
            input=json.dumps({'install': journey.INSTALL_POINTER_RECEIPTS, 'stop': journey.STOP_POINTER_RECEIPTS}),
            capture_output=True, text=True, encoding='utf-8', timeout=10, **process_options())
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn('bounded passive receipts', result.stdout)

    def test_touch_target_clear_keeps_one_native_tap_and_the_original_assertion(self):
        calls = []
        self.fixture.args.touch = True
        self.fixture.args.pointer_receipts = True
        async def evaluate(expression, arg=None):
            calls.append(expression)
            if expression == journey.EMPTY_CANVAS_POINT:
                return {'x': 195, 'y': 156}
            if expression == journey.INSTALL_POINTER_RECEIPTS:
                self.assertEqual(arg, {'x': 195, 'y': 156})
                return {'hit': {'id': 'scene'}}
            self.assertEqual(expression, journey.STOP_POINTER_RECEIPTS)
            return {'rows': [
                {'phase': 'capture', 'type': 'pointerdown', 'pointerType': 'touch', 'isTrusted': True, 'target': {'id': 'scene'}, 'pointerId': 1, 'x': 195, 'y': 156},
                {'phase': 'bubble', 'type': 'pointerup', 'pointerType': 'touch', 'isTrusted': True, 'target': {'id': 'scene'}, 'pointerId': 1, 'x': 195, 'y': 156, 'state': {'target': None}}]}
        async def tap(x, y):
            calls.append(('native-tap', x, y))
        async def wait(expression):
            self.assertEqual(expression, '()=>__hm.GAME.player.target===null')
            calls.append('target-null-assertion')
        self.fixture.page = argparse.Namespace(evaluate=evaluate, touchscreen=argparse.Namespace(tap=tap))
        self.fixture.wait = wait
        asyncio.run(self.fixture.clear_target())
        self.assertEqual(calls, [journey.EMPTY_CANVAS_POINT, journey.INSTALL_POINTER_RECEIPTS,
            ('native-tap', 195, 156), 'target-null-assertion', journey.STOP_POINTER_RECEIPTS])
        self.assertEqual(self.fixture.report['targetClearReceipt']['rows'][0]['isTrusted'], True)

    def test_pointer_receipt_cleanup_failure_cannot_replace_the_target_clear_failure(self):
        self.fixture.args.touch = True
        self.fixture.args.pointer_receipts = True
        taps = []
        async def evaluate(expression, arg=None):
            if expression == journey.EMPTY_CANVAS_POINT:
                return {'x': 195, 'y': 156}
            if expression == journey.INSTALL_POINTER_RECEIPTS:
                return {'hit': {'id': 'scene'}}
            raise RuntimeError('receipt cleanup failed')
        async def tap(x, y):
            taps.append((x, y))
        async def wait(expression):
            raise TimeoutError('actual target was not cleared')
        self.fixture.page = argparse.Namespace(evaluate=evaluate, touchscreen=argparse.Namespace(tap=tap))
        self.fixture.wait = wait
        with self.assertRaisesRegex(TimeoutError, 'actual target was not cleared'):
            asyncio.run(self.fixture.clear_target())
        self.assertEqual(taps, [(195, 156)])
        self.assertEqual(self.fixture.report['diagnosticErrors'][0]['operation'], 'pointer-receipt.stop')

    def test_clean_touch_clear_has_no_pointer_observer_or_retry(self):
        self.fixture.args.touch = True
        calls = []
        async def evaluate(expression, arg=None):
            self.assertEqual(expression, journey.EMPTY_CANVAS_POINT)
            calls.append('empty-point')
            return {'x': 265.2, 'y': 156}
        async def tap(x, y):
            calls.append(('native-tap', x, y))
        async def wait(expression):
            self.assertEqual(expression, '()=>__hm.GAME.player.target===null')
            calls.append('target-null-assertion')
        self.fixture.page = argparse.Namespace(evaluate=evaluate, touchscreen=argparse.Namespace(tap=tap))
        self.fixture.wait = wait
        asyncio.run(self.fixture.clear_target())
        self.assertEqual(calls, ['empty-point', ('native-tap', 265.2, 156), 'target-null-assertion'])
        self.assertNotIn('targetClearReceipt', self.fixture.report)
        self.assertEqual(self.fixture.report['targetClearPolicy'], {'minimumHudClearancePx': 32, 'pointerReceipts': False})

    def test_diagnostic_mode_rejects_non_canvas_untrusted_or_mismatched_native_receipts(self):
        self.fixture.args.touch = True
        self.fixture.args.pointer_receipts = True
        async def tap(x, y):
            pass
        async def wait(expression):
            self.assertEqual(expression, '()=>__hm.GAME.player.target===null')
        for invalid in ['intercepted', 'untrusted', 'mismatched', 'wrong-pointer-type', 'not-cleared']:
            rows = [
                {'phase': 'capture', 'type': 'pointerdown', 'pointerType': 'touch', 'isTrusted': True, 'target': {'id': 'scene'}, 'pointerId': 1, 'x': 195, 'y': 156},
                {'phase': 'bubble', 'type': 'pointerup', 'pointerType': 'touch', 'isTrusted': True, 'target': {'id': 'scene'}, 'pointerId': 1, 'x': 195, 'y': 156, 'state': {'target': None}}]
            if invalid == 'intercepted':
                rows[0]['target']['id'] = rows[1]['target']['id'] = 'tf'
            if invalid == 'untrusted':
                rows[0]['isTrusted'] = rows[1]['isTrusted'] = False
            if invalid == 'mismatched':
                rows[1]['pointerId'] = 2
            if invalid == 'wrong-pointer-type':
                rows[0]['pointerType'] = rows[1]['pointerType'] = 'mouse'
            if invalid == 'not-cleared':
                rows[1]['state']['target'] = 5
            async def evaluate(expression, arg=None):
                if expression == journey.EMPTY_CANVAS_POINT:
                    return {'x': 195, 'y': 156}
                if expression == journey.INSTALL_POINTER_RECEIPTS:
                    return {'hit': {'id': 'scene'}}
                return {'rows': rows}
            self.fixture.page = argparse.Namespace(evaluate=evaluate, touchscreen=argparse.Namespace(tap=tap))
            self.fixture.wait = wait
            with self.subTest(invalid=invalid), self.assertRaisesRegex(AssertionError, 'matching trusted canvas'):
                asyncio.run(self.fixture.clear_target())


if __name__ == '__main__':
    unittest.main()
