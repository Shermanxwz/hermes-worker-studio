from __future__ import annotations

import pathlib
import shutil
import subprocess
import tempfile
import unittest

from scripts.stage_product_bundle import stage_bundle

ROOT = pathlib.Path(__file__).resolve().parents[1]
SOURCE = ROOT / "dashboard" / "dist" / "index-v3.js"


class ProductBundleStageTests(unittest.TestCase):
    def test_release_transform_produces_final_attachment_and_interaction_contract(self) -> None:
        staged = stage_bundle(SOURCE.read_text(encoding="utf-8"))

        for token in (
            "const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;",
            "title: '添加文件'",
            "'aria-label': '添加文件'",
            "Ctrl/Cmd+V 粘贴文件",
            "type: 'file_url'",
            "kind: item.kind || 'file'",
            "role: 'alert'",
            "'aria-live': 'assertive'",
            "'aria-modal': 'true'",
            "'aria-labelledby': 'hws3-modal-title'",
            "event.key === 'Escape'",
            "previousFocusRef.current?.focus?.()",
            "'aria-haspopup': 'menu'",
            "role: 'menu'",
            "role: 'menuitem'",
            "'aria-expanded': expanded",
            "'aria-label': '给 Hermes 发送消息'",
            "'aria-label': '发送消息'",
            "'aria-label': '打开菜单'",
            "'aria-label': ready ? '关闭完全访问' : '开启完全访问'",
            "'aria-current': view === id ? 'page' : undefined",
            "粘贴 /responses 会规范化到 API Root",
        ):
            self.assertIn(token, staged)

        self.assertNotIn("accept: 'image/png,image/jpeg,image/webp,image/gif,image/bmp'", staged)
        self.assertIn("hws3-native-dashboard-link", staged)
        self.assertIn("href: baseHref('/sessions')", staged)
        self.assertIn("高级 · Hermes Dashboard", staged)
        self.assertIn("Clarify 等交互请求自动 Skip/Decline，不再等待人工", staged)
        self.assertIn("Hermes Hardline Blocklist", staged)

    def test_release_transform_is_javascript_syntax_valid(self) -> None:
        node = shutil.which("node")
        if not node:
            self.skipTest("node is unavailable")
        staged = stage_bundle(SOURCE.read_text(encoding="utf-8"))
        with tempfile.TemporaryDirectory() as directory:
            path = pathlib.Path(directory) / "index-v3.js"
            path.write_text(staged, encoding="utf-8")
            completed = subprocess.run(
                [node, "--check", str(path)],
                check=False,
                capture_output=True,
                text=True,
            )
        self.assertEqual(completed.returncode, 0, completed.stderr)

    def test_release_transform_is_fail_closed_against_already_transformed_input(self) -> None:
        staged = stage_bundle(SOURCE.read_text(encoding="utf-8"))
        with self.assertRaises(RuntimeError):
            stage_bundle(staged)


if __name__ == "__main__":
    unittest.main()
