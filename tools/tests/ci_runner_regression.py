"""CI diagnostics must reject real failures while accepting empty timed summaries."""
import pathlib
import subprocess
import sys
import unittest

RUNNER = pathlib.Path(__file__).resolve().parents[1] / "ci" / "run_check.py"

class DiagnosticExitTests(unittest.TestCase):
    def run_output(self, output, status=0):
        script = "import sys; print(" + repr(output) + "); sys.exit(" + str(status) + ")"
        return subprocess.run([sys.executable, str(RUNNER), sys.executable, "-c", script],
                              capture_output=True, text=True).returncode

    def test_empty_timed_errors(self):
        for output in ("errors []", "errors [164s] []", "errors [2.5s] []", "bad programs []", "shader messages []", "FAILS []"):
            with self.subTest(output=output):
                self.assertEqual(self.run_output(output), 0)

    def test_real_timed_error(self):
        self.assertEqual(self.run_output("errors [164s] ['bad shader']"), 1)

    def test_real_render_error(self):
        for output in ("errors ['bad']", "bad programs ['vertex shader']", "shader messages ['compile failed']"):
            with self.subTest(output=output):
                self.assertEqual(self.run_output(output), 1)

    def test_malformed_summary(self):
        self.assertEqual(self.run_output("errors [unknown] []"), 1)

    def test_printed_failures(self):
        for output in ("FAIL wrong owner", "STEP FAILED field", "[pageerror] boom", "3 failed", "t=600 bad=1"):
            with self.subTest(output=output):
                self.assertEqual(self.run_output(output), 1)

    def test_process_status(self):
        self.assertEqual(self.run_output("errors []", 7), 7)

if __name__ == "__main__":
    unittest.main()
