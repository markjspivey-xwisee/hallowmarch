"""CPU-only launch-option and owned-cleanup checks. No browser or real kill is launched."""
import asyncio
import io
import json
import os
import pathlib
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
import native_journey_browser as host


class FakeProcess:
    pid = 424242

    def __init__(self, timeout=False, exit_at_timeout=False):
        self.returncode = None
        self.timeout = timeout
        self.exit_at_timeout = exit_at_timeout
        self.waits = 0
        self.stdin = io.StringIO()
        self.stdout = io.StringIO('' if timeout else json.dumps({'type': 'closed', 'killUsed': False, 'ownedBrowserPid': 434343}) + '\n')

    def poll(self):
        return self.returncode

    def wait(self):
        self.waits += 1
        if self.timeout and self.waits == 1:
            if self.exit_at_timeout:
                self.returncode = 0
            raise asyncio.TimeoutError()
        self.returncode = 0
        return self.returncode


class NativeJourneyOptions(unittest.TestCase):
    def test_installed_python_driver_options_retain_native_gpu_and_security_defaults(self):
        info = host.describe_native_launch()
        self.assertEqual(info['channel'], 'msedge')
        self.assertTrue(info['headless'] and info['chromiumSandbox'] and info['freshEphemeralProfile'])
        self.assertEqual(info['gpuOverrideFlags'], [])
        for switch in ['--disable-client-side-phishing-detection', '--disable-hang-monitor',
                       '--disable-ipc-flooding-protection', '--unsafely-disable-devtools-self-xss-warnings',
                       '--hide-scrollbars', '--mute-audio']:
            self.assertIn(switch, info['ignoredDefaultArgs'])
        self.assertTrue(any(flag.startswith('--disable-features=') for flag in info['ignoredDefaultArgs']))
        self.assertTrue(any(flag.startswith('--blink-settings=') for flag in info['ignoredDefaultArgs']))

    def test_closed_server_never_uses_a_process_tree_kill_and_cleanup_is_idempotent(self):
        manager = host.NativeJourneyBrowser('.', 60)
        manager.process = FakeProcess()
        with patch.object(host.subprocess, 'run') as run, patch.object(host.os, 'killpg', create=True) as kill:
            self.assertTrue(asyncio.run(manager.stop()))
            self.assertTrue(asyncio.run(manager.stop()))
            run.assert_not_called()
            kill.assert_not_called()

    def test_hung_helper_kills_only_its_still_live_owned_tree(self):
        manager = host.NativeJourneyBrowser('.', 60)
        manager.process = FakeProcess(timeout=True)
        calls = []
        def terminate(*args, **kwargs):
            calls.append(args)
            manager.process.returncode = 1
        with patch.object(host.subprocess, 'run', side_effect=terminate), patch.object(host.os, 'killpg', side_effect=terminate, create=True):
            self.assertTrue(asyncio.run(manager.stop()))
        if os.name == 'nt':
            self.assertEqual(calls, [(['taskkill.exe', '/PID', str(FakeProcess.pid), '/T', '/F'],)])
        else:
            self.assertEqual(calls[0][0], FakeProcess.pid)
        self.assertTrue(manager.receipt['ownHelperTreeKillUsed'])

    def test_an_exited_helper_pid_is_never_killed_after_the_timeout_race(self):
        manager = host.NativeJourneyBrowser('.', 60)
        manager.process = FakeProcess(timeout=True, exit_at_timeout=True)
        with patch.object(host.subprocess, 'run') as run, patch.object(host.os, 'killpg', create=True) as kill:
            self.assertFalse(asyncio.run(manager.stop()))
            run.assert_not_called()
            kill.assert_not_called()


if __name__ == '__main__':
    unittest.main()
