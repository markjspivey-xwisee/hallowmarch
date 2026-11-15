"""Launch metadata and bounded cleanup for one owned headless Edge BrowserServer."""
import asyncio
import importlib.metadata
import json
import os
import pathlib
import signal
import subprocess

import playwright


def installed_driver():
    driver = pathlib.Path(playwright.__file__).resolve().parent / 'driver'
    package = driver / 'package'
    # A Python wheel may bundle a newer JS patch (e.g.1.56.0/1.56.1).
    # Both the Python connector and this host use this exact bundled package.
    if not (package / 'index.mjs').is_file():
        raise RuntimeError('The installed Python Playwright driver package is unavailable')
    return driver / ('node.exe' if os.name == 'nt' else 'node'), package


def process_options():
    return {'creationflags': subprocess.CREATE_NO_WINDOW} if os.name == 'nt' else {'start_new_session': True}


def describe_native_launch():
    node, package = installed_driver()
    helper = pathlib.Path(__file__).with_suffix('.mjs')
    result = subprocess.run([str(node), str(helper), '--describe', str(package)], capture_output=True,
                            text=True, encoding='utf-8', check=True, timeout=15, **process_options())
    return json.loads(result.stdout)


class NativeJourneyBrowser:
    def __init__(self, out, lifetime, edge=True, executable=None):
        self.out = pathlib.Path(out)
        self.lifetime = lifetime
        self.edge = edge
        self.executable = executable
        self.process = None
        self.stderr = None
        self.receipt = {}
        self.receipt['pythonPlaywrightVersion'] = importlib.metadata.version('playwright')
        self.cleanup_result = None

    async def start(self):
        node, package = installed_driver()
        helper = pathlib.Path(__file__).with_suffix('.mjs')
        self.stderr = (self.out / 'native-browser-stderr.log').open('w', encoding='utf-8')
        self.process = subprocess.Popen([str(node), str(helper), '--serve', str(package), str(self.lifetime),
                                         'msedge' if self.edge else 'chromium', self.executable or ''],
                                        stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=self.stderr,
                                        text=True, encoding='utf-8', **process_options())
        self.receipt['ownedHelperPid'] = self.process.pid
        line = await asyncio.wait_for(asyncio.to_thread(self.process.stdout.readline), timeout=55)
        message = json.loads(line)
        if message.get('type') != 'ready':
            raise RuntimeError(message.get('message', 'Owned Edge helper failed before readiness'))
        self.receipt.update({key: value for key, value in message.items() if key not in ['type', 'endpoint']})
        return message['endpoint']

    async def stop(self):
        if self.cleanup_result is not None:
            return self.cleanup_result
        proc = self.process
        if not proc:
            return False
        try:
            if proc.poll() is None:
                try:
                    if not proc.stdin.closed:
                        proc.stdin.write('{"op":"close"}\n')
                        proc.stdin.flush()
                except (BrokenPipeError, OSError):
                    pass
            try:
                await asyncio.wait_for(asyncio.to_thread(proc.wait), timeout=25)
            except asyncio.TimeoutError:
                # poll() checks this exact Popen process handle. Only its fresh
                # helper tree can be terminated; user Edge processes are never enumerated.
                if proc.poll() is None:
                    self.receipt['ownHelperTreeKillUsed'] = True
                    if os.name == 'nt':
                        await asyncio.wait_for(asyncio.to_thread(subprocess.run,
                            ['taskkill.exe', '/PID', str(proc.pid), '/T', '/F'], capture_output=True,
                            check=True, timeout=10, **process_options()), timeout=12)
                    else:
                        os.killpg(proc.pid, signal.SIGKILL)
                await asyncio.wait_for(asyncio.to_thread(proc.wait), timeout=5)
            remaining = proc.stdout.read() if not proc.stdout.closed else ''
            for line in remaining.splitlines():
                message = json.loads(line)
                if message.get('type') == 'closed':
                    self.receipt['browserServerCleanup'] = message
            self.receipt['helperExitCode'] = proc.returncode
            self.cleanup_result = bool(self.receipt.get('browserServerCleanup') or self.receipt.get('ownHelperTreeKillUsed'))
            return self.cleanup_result
        finally:
            for stream in [proc.stdin, proc.stdout, self.stderr]:
                if stream:
                    stream.close()


if __name__ == '__main__':
    print(json.dumps(describe_native_launch(), indent=2))
