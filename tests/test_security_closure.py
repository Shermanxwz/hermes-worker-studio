from __future__ import annotations

import pathlib
import py_compile
import subprocess
import sys
import tempfile
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
MIXED = ROOT / "scripts" / "stage_mixed_protocol.py"
SECURITY = ROOT / "scripts" / "stage_security_closure.py"
FRONTEND = ROOT / "dashboard" / "dist" / "index-v3.js"
BACKEND = ROOT / "dashboard" / "plugin_api_v3.py"


class SecurityClosureTests(unittest.TestCase):
    def _stage(self) -> tuple[pathlib.Path, pathlib.Path, tempfile.TemporaryDirectory[str]]:
        tmp = tempfile.TemporaryDirectory()
        root = pathlib.Path(tmp.name)
        frontend = root / "index-v3.js"
        backend = root / "plugin_api_v3.py"
        frontend.write_bytes(FRONTEND.read_bytes())
        backend.write_bytes(BACKEND.read_bytes())
        subprocess.run(
            [sys.executable, str(MIXED), str(frontend), str(backend)],
            cwd=ROOT,
            check=True,
            text=True,
            capture_output=True,
        )
        subprocess.run(
            [sys.executable, str(SECURITY), str(backend)],
            cwd=ROOT,
            check=True,
            text=True,
            capture_output=True,
        )
        return frontend, backend, tmp

    def test_security_closure_hardens_private_writes_and_json_decode(self) -> None:
        _frontend, backend, tmp = self._stage()
        self.addCleanup(tmp.cleanup)
        source = backend.read_text(encoding="utf-8")
        for token in (
            "def _write_private_json",
            "os.O_EXCL",
            "os.O_NOFOLLOW",
            "os.open(temporary, flags, 0o600)",
            "os.fsync(handle.fileno())",
            "def _read_request_json",
            'HTTPException(400, "request body must contain valid JSON")',
        ):
            self.assertIn(token, source)
        self.assertEqual(source.count("await _read_request_json(request)"), 7)
        self.assertNotIn("await request.json()", source)
        self.assertNotIn('temporary = path.with_name(f".{path.name}.{os.getpid()}.tmp")', source)
        self.assertNotIn('temporary = _PROTOCOL_FILE.with_name(f".{_PROTOCOL_FILE.name}.{os.getpid()}.tmp")', source)
        py_compile.compile(str(backend), doraise=True)

    def test_security_closure_is_fail_closed_when_reapplied(self) -> None:
        _frontend, backend, tmp = self._stage()
        self.addCleanup(tmp.cleanup)
        second = subprocess.run(
            [sys.executable, str(SECURITY), str(backend)],
            cwd=ROOT,
            check=False,
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
        self.assertNotEqual(second.returncode, 0)
        self.assertIn("expected exactly one source match", second.stderr)


if __name__ == "__main__":
    unittest.main()
