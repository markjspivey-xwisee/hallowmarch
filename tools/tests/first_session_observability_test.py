"""CPU-only journey phase, trace-boundary and failure preservation checks."""
import argparse
import ast
import asyncio
import contextlib
import io
import json
import pathlib
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import first_session_journey as journey


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


if __name__ == '__main__':
    unittest.main()
