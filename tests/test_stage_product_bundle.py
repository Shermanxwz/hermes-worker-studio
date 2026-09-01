from __future__ import annotations

import pathlib
import unittest

from scripts.stage_product_bundle import stage_bundle

ROOT = pathlib.Path(__file__).resolve().parents[1]
SOURCE = ROOT / "dashboard" / "dist" / "index-v3.js"


class ProductBundleStageTests(unittest.TestCase):
    def test_release_transform_produces_any_file_advanced_native_nav_and_no_wait_copy(self) -> None:
        staged = stage_bundle(SOURCE.read_text(encoding="utf-8"))

        self.assertIn("const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;", staged)
        self.assertIn("title: '添加文件'", staged)
        self.assertIn("Ctrl/Cmd+V 粘贴文件", staged)
        self.assertIn("type: 'file_url'", staged)
        self.assertIn("kind: item.kind || 'file'", staged)
        self.assertNotIn("accept: 'image/png,image/jpeg,image/webp,image/gif,image/bmp'", staged)

        self.assertIn("const HERMES_PRIMARY = [];", staged)
        self.assertIn("['/sessions', '会话 / Sessions']", staged)
        self.assertIn("['/cron', '自动化 / Cron']", staged)
        self.assertIn("['/skills', 'Skills']", staged)
        self.assertIn("['/plugins', 'Plugins']", staged)
        self.assertIn("['/mcp', 'MCP']", staged)
        self.assertIn("高级 · Hermes Dashboard", staged)
        self.assertNotIn("['/sessions', 'Hermes 会话', '☷']", staged)
        self.assertNotIn("['/cron', '自动化', '◷']", staged)

        self.assertIn("Clarify 等交互请求自动 Skip/Decline，不再等待人工", staged)
        self.assertIn("缺少密码、MFA 或外部授权时会自动失败/继续可行路径", staged)
        self.assertIn("Hermes Hardline Blocklist", staged)

    def test_release_transform_is_fail_closed_against_already_transformed_input(self) -> None:
        staged = stage_bundle(SOURCE.read_text(encoding="utf-8"))
        with self.assertRaises(RuntimeError):
            stage_bundle(staged)


if __name__ == "__main__":
    unittest.main()
