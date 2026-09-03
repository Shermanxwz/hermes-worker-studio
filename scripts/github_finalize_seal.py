#!/usr/bin/env python3
"""Finalize an exact-main Hermes Worker Studio seal on GitHub.

This command is intentionally read-only. A candidate is finalizable only when:
- the local real-target verdict says eligible=true for the exact candidate SHA;
- the repository canonical branch is ``main`` and still points at that SHA;
- the exact-main push CI run named ``CI`` from ``.github/workflows/ci.yml`` is green.

Development PRs are merged before real-target sealing while the repository is
still an ARCHIVE CANDIDATE. The seal workflow never merges code after evidence
capture, because doing so would create a different main commit than the one the
target and browsers actually tested.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any

SEAL_VERDICT_SCHEMA = "hermes-worker-studio.seal-verdict.v2"
CANONICAL_BRANCH = "main"
CI_WORKFLOW_PATH = ".github/workflows/ci.yml"


class FinalizeError(RuntimeError):
    pass


def _request(
    url: str,
    *,
    token: str,
    method: str = "GET",
    body: Any | None = None,
    expected: tuple[int, ...] = (200,),
) -> Any:
    data = None if body is None else json.dumps(body).encode("utf-8")
    headers = {
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "hermes-worker-studio-seal-finalizer/3.0",
    }
    if token:
        headers["Authorization"] = f"Bearer {token}"
    if body is not None:
        headers["Content-Type"] = "application/json"
    request = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            raw = response.read(4 * 1024 * 1024)
            payload = json.loads(raw.decode("utf-8")) if raw else {}
            status = int(response.status)
    except urllib.error.HTTPError as exc:
        raw = exc.read(2 * 1024 * 1024)
        try:
            payload = json.loads(raw.decode("utf-8")) if raw else {}
        except Exception:
            payload = {"raw": raw.decode("utf-8", "replace")}
        raise FinalizeError(f"{method} {url} failed with HTTP {exc.code}: {payload}") from exc
    except Exception as exc:
        raise FinalizeError(f"{method} {url} failed: {exc}") from exc
    if status not in expected:
        raise FinalizeError(f"{method} {url}: expected HTTP {expected}, got {status}: {payload}")
    return payload


def _load_verdict(path: Path, candidate: str) -> dict[str, Any]:
    try:
        verdict = json.loads(path.read_text(encoding="utf-8"))
    except Exception as exc:
        raise FinalizeError(f"cannot read seal verdict {path}: {exc}") from exc
    if not isinstance(verdict, dict):
        raise FinalizeError("seal verdict root must be an object")
    if verdict.get("schema") != SEAL_VERDICT_SCHEMA:
        raise FinalizeError(f"unexpected seal verdict schema: {verdict.get('schema')!r}")
    if verdict.get("eligible") is not True:
        raise FinalizeError("seal verdict is not eligible=true")
    if str(verdict.get("candidate_sha") or "") != candidate:
        raise FinalizeError("seal verdict candidate_sha does not match requested candidate")
    return verdict


def _api_base(repo: str) -> str:
    if repo.count("/") != 1 or any(not part for part in repo.split("/")):
        raise FinalizeError(f"repository must be owner/name, got {repo!r}")
    return f"https://api.github.com/repos/{repo}"


def _require_exact_main(repo: str, candidate: str, token: str) -> dict[str, Any]:
    repository = _request(_api_base(repo), token=token)
    if not isinstance(repository, dict):
        raise FinalizeError("GitHub repository response is not an object")
    default_branch = str(repository.get("default_branch") or "")
    if default_branch != CANONICAL_BRANCH:
        raise FinalizeError(
            f"repository default branch must remain {CANONICAL_BRANCH!r}, got {default_branch or '<missing>'!r}"
        )
    branch = _request(f"{_api_base(repo)}/branches/{urllib.parse.quote(CANONICAL_BRANCH, safe='')}", token=token)
    commit = branch.get("commit") if isinstance(branch, dict) and isinstance(branch.get("commit"), dict) else {}
    actual = str(commit.get("sha") or "")
    if actual != candidate:
        raise FinalizeError(
            f"canonical {CANONICAL_BRANCH} moved or was never the sealed candidate: expected {candidate}, found {actual or '<missing>'}"
        )
    return branch if isinstance(branch, dict) else {}


def _require_green_exact_main_ci(repo: str, candidate: str, token: str) -> dict[str, Any]:
    query = urllib.parse.urlencode(
        {"head_sha": candidate, "event": "push", "branch": CANONICAL_BRANCH, "per_page": "100"}
    )
    payload = _request(f"{_api_base(repo)}/actions/runs?{query}", token=token)
    rows = payload.get("workflow_runs") if isinstance(payload, dict) else None
    rows = rows if isinstance(rows, list) else []
    matches = [
        row for row in rows
        if isinstance(row, dict)
        and str(row.get("name") or "") == "CI"
        and str(row.get("path") or "") == CI_WORKFLOW_PATH
        and str(row.get("head_sha") or "") == candidate
        and str(row.get("head_branch") or "") == CANONICAL_BRANCH
        and str(row.get("event") or "") == "push"
    ]
    if not matches:
        raise FinalizeError(f"no exact-main push CI run found for {candidate}")
    latest = max(matches, key=lambda row: int(row.get("run_number") or 0))
    if str(latest.get("status") or "") != "completed" or str(latest.get("conclusion") or "") != "success":
        raise FinalizeError(
            "latest exact-main CI is not green: "
            f"status={latest.get('status')!r} conclusion={latest.get('conclusion')!r}"
        )
    return latest


def finalize(args: argparse.Namespace) -> dict[str, Any]:
    candidate = args.candidate.strip().lower()
    if len(candidate) != 40 or any(ch not in "0123456789abcdef" for ch in candidate):
        raise FinalizeError(f"candidate must be a full 40-character SHA, got {args.candidate!r}")
    token = args.token.strip()
    verdict = _load_verdict(args.evidence, candidate)
    branch = _require_exact_main(args.repo, candidate, token)
    ci = _require_green_exact_main_ci(args.repo, candidate, token)
    return {
        "schema": "hermes-worker-studio.github-finalization.v2",
        "candidate_sha": candidate,
        "repo": args.repo,
        "canonical_branch": CANONICAL_BRANCH,
        "canonical_branch_sha": ((branch.get("commit") or {}).get("sha") if isinstance(branch, dict) else None),
        "seal_eligible": True,
        "seal_schema": verdict.get("schema"),
        "ci_run_id": ci.get("id"),
        "ci_run_number": ci.get("run_number"),
        "finalized": True,
        "read_only": True,
    }


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Finalize a real-target seal for the exact current main commit")
    parser.add_argument("--repo", default=os.getenv("GITHUB_REPOSITORY", ""))
    parser.add_argument("--candidate", required=True)
    parser.add_argument("--evidence", type=Path, default=Path(".seal/SEALED.json"))
    parser.add_argument("--token", default=os.getenv("GITHUB_TOKEN", ""))
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(list(sys.argv[1:] if argv is None else argv))
    try:
        result = finalize(args)
    except FinalizeError as exc:
        print(f"SEAL GITHUB FINALIZE FAILED: {exc}", file=sys.stderr)
        return 1
    print(json.dumps(result, ensure_ascii=False, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
