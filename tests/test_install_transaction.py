from __future__ import annotations

import os
import pathlib
import stat
import subprocess
import tempfile
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
INSTALL = ROOT / "scripts" / "install.sh"


class InstallTransactionTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.base = pathlib.Path(self.tmp.name)
        self.home = self.base / "home"
        self.hermes_home = self.home / ".hermes"
        self.bin = self.base / "bin"
        self.bin.mkdir(parents=True)
        self.hermes = self.bin / "hermes"
        self.log = self.base / "hermes.log"
        self.state = self.base / "doctor-count"
        self._write_fake_hermes()

    def _write_fake_hermes(self, *, fail_doctor_call: int = 0, fail_enable: int = 0) -> None:
        self.state.write_text("0", encoding="utf-8")
        self.hermes.write_text(
            "#!/usr/bin/env bash\n"
            "set -euo pipefail\n"
            f"printf '%s\\n' \"$*\" >> {self.log!s}\n"
            "if [[ \"${1:-}\" == plugins && \"${2:-}\" == doctor ]]; then\n"
            f"  n=$(cat {self.state!s})\n"
            "  n=$((n+1))\n"
            f"  printf '%s' \"$n\" > {self.state!s}\n"
            f"  if [[ {fail_doctor_call} -gt 0 && \"$n\" -eq {fail_doctor_call} ]]; then exit 19; fi\n"
            "fi\n"
            "if [[ \"${1:-}\" == plugins && \"${2:-}\" == enable ]]; then\n"
            f"  if [[ {fail_enable} -ne 0 ]]; then exit {fail_enable}; fi\n"
            "fi\n"
            "exit 0\n",
            encoding="utf-8",
        )
        self.hermes.chmod(self.hermes.stat().st_mode | stat.S_IXUSR)

    def _run(self, *, check: bool = True) -> subprocess.CompletedProcess[str]:
        env = os.environ.copy()
        env.update(
            {
                "HOME": str(self.home),
                "HERMES_HOME": str(self.hermes_home),
                "PATH": str(self.bin) + os.pathsep + "/usr/bin:/bin",
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

    @property
    def dest(self) -> pathlib.Path:
        return self.hermes_home / "plugins" / "hermes-worker-studio"

    @property
    def theme(self) -> pathlib.Path:
        return self.hermes_home / "dashboard-themes" / "hermes-worker-studio.yaml"

    def _assert_no_transaction_leftovers(self) -> None:
        plugin_root = self.hermes_home / "plugins"
        leftovers = [
            path.name
            for path in plugin_root.iterdir()
            if path.name.startswith(".hermes-worker-studio.install.")
            or path.name.startswith(".hermes-worker-studio.backup.")
        ]
        self.assertEqual(leftovers, [])
        theme_leftovers = [
            path.name
            for path in (self.hermes_home / "dashboard-themes").iterdir()
            if path.name.startswith(".hermes-worker-studio.yaml.backup.")
        ]
        self.assertEqual(theme_leftovers, [])

    def test_final_doctor_failure_restores_previous_plugin_before_enable(self) -> None:
        self._run()
        marker = self.dest / "previous-install-marker"
        marker.write_text("preserve", encoding="utf-8")
        self.log.write_text("", encoding="utf-8")
        self._write_fake_hermes(fail_doctor_call=2)

        failed = self._run(check=False)

        self.assertEqual(failed.returncode, 19)
        self.assertEqual(marker.read_text(encoding="utf-8"), "preserve")
        self.assertIn("restoring previous Worker Studio state", failed.stderr)
        log = self.log.read_text(encoding="utf-8")
        self.assertEqual(log.count("plugins doctor"), 2)
        self.assertEqual(log.count("plugins enable hermes-worker-studio"), 0)
        self._assert_no_transaction_leftovers()

    def test_enable_failure_restores_previous_plugin_and_theme(self) -> None:
        self._run()
        marker = self.dest / "previous-install-marker"
        marker.write_text("preserve", encoding="utf-8")
        self.theme.write_text("previous-theme\n", encoding="utf-8")
        self.log.write_text("", encoding="utf-8")
        self._write_fake_hermes(fail_enable=23)

        failed = self._run(check=False)

        self.assertEqual(failed.returncode, 23)
        self.assertEqual(marker.read_text(encoding="utf-8"), "preserve")
        self.assertEqual(self.theme.read_text(encoding="utf-8"), "previous-theme\n")
        self.assertIn("restoring previous Worker Studio state", failed.stderr)
        self._assert_no_transaction_leftovers()


if __name__ == "__main__":
    unittest.main()
