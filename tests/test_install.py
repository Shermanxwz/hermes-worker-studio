from __future__ import annotations

import os
import pathlib
import shutil
import stat
import subprocess
import tempfile
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
INSTALL = ROOT / "scripts" / "install.sh"


class InstallScriptTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.base = pathlib.Path(self.tmp.name)
        self.home = self.base / "home"
        self.hermes_home = self.home / ".hermes"
        self.bin = self.base / "bin"
        self.bin.mkdir(parents=True)
        self.log = self.base / "hermes.log"
        self.hermes = self.bin / "hermes"
        self._write_fake_hermes(exit_doctor=0)

    def tearDown(self) -> None:
        self.tmp.cleanup()

    def _write_fake_hermes(self, exit_doctor: int) -> None:
        self.hermes.write_text(
            "#!/usr/bin/env bash\n"
            "set -euo pipefail\n"
            f"printf '%s\\n' \"$*\" >> {self.log!s}\n"
            "if [[ \"${1:-}\" == plugins && \"${2:-}\" == doctor ]]; then\n"
            f"  exit {exit_doctor}\n"
            "fi\n"
            "exit 0\n",
            encoding="utf-8",
        )
        self.hermes.chmod(self.hermes.stat().st_mode | stat.S_IXUSR)

    def _run(self, check: bool = True) -> subprocess.CompletedProcess[str]:
        env = os.environ.copy()
        env.update(
            {
                "HOME": str(self.home),
                "HERMES_HOME": str(self.hermes_home),
                "PATH": str(self.bin) + os.pathsep + env.get("PATH", ""),
            }
        )
        return subprocess.run(
            ["bash", str(INSTALL)],
            cwd=ROOT,
            env=env,
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            check=check,
        )

    def _dest(self) -> pathlib.Path:
        return self.hermes_home / "plugins" / "hermes-worker-studio"

    def test_install_copies_only_runtime_surface_and_calls_official_doctor(self) -> None:
        result = self._run()
        self.assertIn("Installed:", result.stdout)
        dest = self._dest()
        expected = {
            "plugin.yaml",
            "__init__.py",
            "schemas.py",
            "tools.py",
            "dashboard/manifest.json",
            "dashboard/plugin_api.py",
            "dashboard/dist/index.js",
            "dashboard/dist/style.css",
        }
        actual = {
            str(path.relative_to(dest))
            for path in dest.rglob("*")
            if path.is_file()
        }
        self.assertEqual(actual, expected)
        self.assertTrue((self.hermes_home / "dashboard-themes" / "hermes-worker-studio.yaml").is_file())
        log = self.log.read_text(encoding="utf-8")
        self.assertEqual(log.count("plugins doctor"), 2)
        self.assertEqual(log.count("plugins enable hermes-worker-studio"), 1)

    def test_reinstall_is_idempotent_and_leaves_no_staging_or_backup_tree(self) -> None:
        self._run()
        marker = self._dest() / "stale-marker"
        marker.write_text("old", encoding="utf-8")
        self._run()
        self.assertFalse(marker.exists())
        plugin_root = self.hermes_home / "plugins"
        leftovers = [p.name for p in plugin_root.iterdir() if p.name.startswith(".hermes-worker-studio.")]
        self.assertEqual(leftovers, [])
        log = self.log.read_text(encoding="utf-8")
        self.assertEqual(log.count("plugins enable hermes-worker-studio"), 2)
        self.assertEqual(log.count("plugins doctor"), 4)

    def test_staged_doctor_failure_does_not_replace_existing_install(self) -> None:
        self._run()
        dest = self._dest()
        marker = dest / "keep-me"
        marker.write_text("preserved", encoding="utf-8")
        self._write_fake_hermes(exit_doctor=17)
        failed = self._run(check=False)
        self.assertEqual(failed.returncode, 17)
        self.assertEqual(marker.read_text(encoding="utf-8"), "preserved")
        plugin_root = self.hermes_home / "plugins"
        leftovers = [p.name for p in plugin_root.iterdir() if p.name.startswith(".hermes-worker-studio.install.")]
        self.assertEqual(leftovers, [])

    def test_install_without_hermes_binary_still_installs_and_prints_manual_gate(self) -> None:
        self.hermes.unlink()
        result = self._run()
        self.assertTrue(self._dest().is_dir())
        self.assertIn("hermes command not found", result.stderr)
        self.assertIn("Enable manually", result.stdout)


if __name__ == "__main__":
    unittest.main()
