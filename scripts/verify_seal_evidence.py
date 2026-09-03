#!/usr/bin/env python3
"""Validate all evidence planes required to seal Product 3.

A candidate is eligible only when target execution evidence, real-browser
evidence, and the exact pinned Hermes public-contract evidence all pass. The
third plane prevents a locally polished product from being called official-grade
while its required Dashboard SDK contract is still absent upstream.
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
LOCK = json.loads((ROOT / "tests" / "upstream-lock.json").read_text(encoding="utf-8"))


class SealEvidenceError(RuntimeError):
    pass


def _load(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except Exception as exc:
        raise SealEvidenceError(f"cannot read JSON evidence {path}: {exc}") from exc
    if not isinstance(value, dict):
        raise SealEvidenceError(f"evidence root must be an object: {path}")
    return value


def current_git_sha(root: Path) -> str:
    try:
        return subprocess.check_output(
            ["git", "-C", str(root), "rev-parse", "HEAD"],
            text=True,
            stderr=subprocess.STDOUT,
        ).strip()
    except subprocess.CalledProcessError as exc:
        raise SealEvidenceError(f"cannot resolve current git commit: {exc.output.strip()}") from exc


def _require(condition: Any, message: str, errors: list[str]) -> None:
    if not condition:
        errors.append(message)


def validate_upstream(upstream: dict[str, Any]) -> list[str]:
    errors: list[str] = []
    hermes_lock = LOCK.get("hermes") if isinstance(LOCK, dict) else {}
    contracts = upstream.get("contracts") if isinstance(upstream.get("contracts"), dict) else {}
    shell = contracts.get("dashboard_route_scoped_exclusive_shell") if isinstance(contracts.get("dashboard_route_scoped_exclusive_shell"), dict) else {}

    _require(upstream.get("schema") == "hermes-worker-studio.upstream-gate.v1", "upstream evidence schema mismatch", errors)
    _require(upstream.get("ok") is True, "pinned Hermes upstream contract gate is not green", errors)
    _require(upstream.get("repository") == hermes_lock.get("repository"), "upstream evidence repository does not match Hermes lock", errors)
    _require(upstream.get("commit") == hermes_lock.get("commit"), "upstream evidence commit does not match pinned Hermes revision", errors)
    _require(shell.get("verified") is True, "official route-scoped exclusive Dashboard shell contract is not verified", errors)
    return errors


def validate_target(target: dict[str, Any], candidate: str) -> list[str]:
    errors: list[str] = []
    checks = target.get("checks") if isinstance(target.get("checks"), dict) else {}
    integration = checks.get("integration") if isinstance(checks.get("integration"), dict) else {}
    hermes = integration.get("hermes") if isinstance(integration.get("hermes"), dict) else {}
    caps = checks.get("product_capabilities") if isinstance(checks.get("product_capabilities"), dict) else {}
    plan_caps = caps.get("official_plan") if isinstance(caps.get("official_plan"), dict) else {}
    crud = checks.get("session_crud") if isinstance(checks.get("session_crud"), dict) else {}
    real = checks.get("real_run") if isinstance(checks.get("real_run"), dict) else {}

    _require(target.get("schema") == "hermes-worker-studio.seal-evidence.v1", "target evidence schema mismatch", errors)
    _require(target.get("candidate_sha") == candidate, "target evidence candidate_sha does not match current candidate", errors)
    _require(target.get("ok") is True, "target acceptance did not finish ok", errors)
    health = checks.get("health") if isinstance(checks.get("health"), dict) else {}
    _require(health.get("ok") is True, "target health is not green", errors)
    _require(hermes.get("execution_plane") == "official_runs", "target probe/acceptance execution plane is not official_runs", errors)
    _require(hermes.get("worker_plane") == "PluginContext.subagent_lifecycle", "target Worker plane is not PluginContext.subagent_lifecycle", errors)
    _require(hermes.get("model_catalog") == "/api/model/options", "target model catalog is not Hermes-owned", errors)
    _require(caps.get("version") == 3, "target Product capability version is not 3", errors)
    _require(caps.get("execution") == "Hermes official /v1/runs", "target Product probe/acceptance execution rail is not Hermes /v1/runs", errors)
    _require(plan_caps.get("source") == "Hermes canonical todo", "target official plan is not Hermes canonical todo", errors)
    _require(crud.get("created") is True and crud.get("renamed") is True, "target session create/rename evidence missing", errors)
    _require(crud.get("archived") is True and crud.get("unarchived") is True, "target session archive round-trip evidence missing", errors)
    _require(crud.get("deleted") is True, "target session delete evidence missing", errors)

    _require(str(real.get("status") or "").lower() == "completed", "real Hermes Run did not complete", errors)
    _require(real.get("marker_verified") is True, "real Hermes Run marker was not verified", errors)
    revisions = real.get("canonical_revisions") if isinstance(real.get("canonical_revisions"), list) else []
    numeric_revisions = [x for x in revisions if isinstance(x, int) and not isinstance(x, bool)]
    _require(len(numeric_revisions) >= 3, "canonical todo has fewer than three persisted revisions", errors)
    _require(numeric_revisions == sorted(set(numeric_revisions)), "canonical todo revisions are not monotonic and unique", errors)
    _require(real.get("canonical_revision_count") == len(numeric_revisions), "canonical revision count is inconsistent", errors)
    _require(isinstance(real.get("final_todo_count"), int) and real.get("final_todo_count") >= 3, "final canonical todo has fewer than three steps", errors)
    statuses = real.get("final_statuses") if isinstance(real.get("final_statuses"), list) else []
    _require(len(statuses) >= 3 and all(status == "completed" for status in statuses), "final canonical todo is not fully completed", errors)
    projection = real.get("projection_events") if isinstance(real.get("projection_events"), list) else []
    _require(bool(projection), "Studio projection contains no todo event", errors)
    if projection:
        names = [str(row.get("event") or "") for row in projection if isinstance(row, dict)]
        _require(any("todo" in name.lower() for name in names), "Studio projection evidence is not a todo event", errors)

    return errors


def _test_statuses_by_project(value: Any, title: str) -> dict[str, set[str]]:
    """Collect Playwright JSON-reporter result statuses for one exact spec title."""
    found: dict[str, set[str]] = {}

    def visit(node: Any) -> None:
        if isinstance(node, dict):
            if str(node.get("title") or "") == title and isinstance(node.get("tests"), list):
                for test in node["tests"]:
                    if not isinstance(test, dict):
                        continue
                    project = str(test.get("projectName") or "").strip()
                    if not project:
                        continue
                    statuses = found.setdefault(project, set())
                    results = test.get("results") if isinstance(test.get("results"), list) else []
                    for result in results:
                        if isinstance(result, dict) and isinstance(result.get("status"), str):
                            statuses.add(result["status"])
            for child in node.values():
                visit(child)
        elif isinstance(node, list):
            for child in node:
                visit(child)

    visit(value)
    return found


def validate_ui(ui: dict[str, Any], candidate: str) -> list[str]:
    errors: list[str] = []
    _require(ui.get("candidate_sha") == candidate, "browser evidence candidate_sha does not match current candidate", errors)

    stats = ui.get("stats") if isinstance(ui.get("stats"), dict) else {}
    unexpected = stats.get("unexpected")
    expected = stats.get("expected")
    _require(unexpected == 0, f"Playwright has unexpected test results: {unexpected!r}", errors)
    # Product shell passes once in each of three viewport projects, and the
    # desktop native-return test is the fourth required pass. Mobile native
    # shell tests are intentionally skipped because that shell is upstream-owned.
    _require(isinstance(expected, int) and expected >= 4, f"Playwright expected-pass count is too small for the three-viewport seal: {expected!r}", errors)

    config = ui.get("config") if isinstance(ui.get("config"), dict) else {}
    projects = config.get("projects") if isinstance(config.get("projects"), list) else []
    project_names = {
        str(row.get("name") or row.get("id") or "")
        for row in projects
        if isinstance(row, dict)
    }
    required_projects = ("desktop-chromium", "mobile-chromium", "mobile-landscape-chromium")
    for required_project in required_projects:
        _require(required_project in project_names, f"{required_project} missing from browser evidence", errors)

    product_title = "Worker Studio product shell is usable at the real target"
    native_title = "native Hermes Dashboard keeps the Worker Studio return path"
    product_statuses = _test_statuses_by_project(ui, product_title)
    native_statuses = _test_statuses_by_project(ui, native_title)
    for required_project in required_projects:
        statuses = product_statuses.get(required_project, set())
        _require("passed" in statuses, f"{required_project} product-shell browser test did not pass: {sorted(statuses)}", errors)
    _require(
        "passed" in native_statuses.get("desktop-chromium", set()),
        f"desktop-chromium native-return browser test did not pass: {sorted(native_statuses.get('desktop-chromium', set()))}",
        errors,
    )

    _require("failed" not in _terminal_statuses(ui), "browser evidence contains a failed result", errors)
    _require("timedOut" not in _terminal_statuses(ui), "browser evidence contains a timed-out result", errors)
    _require("interrupted" not in _terminal_statuses(ui), "browser evidence contains an interrupted result", errors)

    return errors


def _terminal_statuses(value: Any) -> set[str]:
    statuses: set[str] = set()
    if isinstance(value, dict):
        status = value.get("status")
        if isinstance(status, str) and status in {"passed", "failed", "timedOut", "skipped", "interrupted"}:
            statuses.add(status)
        for child in value.values():
            statuses.update(_terminal_statuses(child))
    elif isinstance(value, list):
        for child in value:
            statuses.update(_terminal_statuses(child))
    return statuses


def validate(target: dict[str, Any], ui: dict[str, Any], upstream: dict[str, Any], candidate: str) -> dict[str, Any]:
    errors = [*validate_upstream(upstream), *validate_target(target, candidate), *validate_ui(ui, candidate)]
    return {
        "schema": "hermes-worker-studio.seal-verdict.v2",
        "candidate_sha": candidate,
        "eligible": not errors,
        "errors": errors,
        "upstream_commit": upstream.get("commit"),
        "target_started_at": target.get("started_at"),
        "target_finished_at": target.get("finished_at"),
        "ui_start_time": (ui.get("stats") or {}).get("startTime") if isinstance(ui.get("stats"), dict) else None,
    }


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Verify Hermes Worker Studio Product 3 seal evidence")
    parser.add_argument("--target", type=Path, default=Path(".seal/target.json"))
    parser.add_argument("--ui", type=Path, default=Path(".seal/ui-report.json"))
    parser.add_argument("--upstream", type=Path, default=Path(".seal/upstream.json"))
    parser.add_argument("--candidate", default="")
    parser.add_argument("--write", type=Path, default=Path(".seal/SEALED.json"))
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(list(sys.argv[1:] if argv is None else argv))
    try:
        candidate = args.candidate.strip() or current_git_sha(ROOT)
        target = _load(args.target)
        ui = _load(args.ui)
        upstream = _load(args.upstream)
        verdict = validate(target, ui, upstream, candidate)
    except SealEvidenceError as exc:
        print(f"SEAL EVIDENCE INVALID: {exc}", file=sys.stderr)
        return 1

    rendered = json.dumps(verdict, ensure_ascii=False, indent=2, sort_keys=True)
    print(rendered)
    args.write.parent.mkdir(parents=True, exist_ok=True)
    args.write.write_text(rendered + "\n", encoding="utf-8")
    if not verdict["eligible"]:
        print("SEAL EVIDENCE FAILED", file=sys.stderr)
        return 1
    print(f"SEAL EVIDENCE CLOSED: {candidate}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
