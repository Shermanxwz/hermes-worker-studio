#!/usr/bin/env python3
"""Finalize a sealed Hermes Worker Studio pull request on GitHub.

This command is intentionally strict. It only transitions/merges a PR when:
- the local seal verdict says eligible=true for the exact candidate SHA;
- the open PR head still equals that candidate SHA;
- an exact-head pull_request CI run named ``CI`` completed successfully.

It never generates seal evidence and cannot substitute for the real-target
``scripts/seal_close.py`` gate.
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
    if verdict.get("schema") != "hermes-worker-studio.seal-verdict.v1":
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


def _get_pr(repo: str, pr_number: int, token: str) -> dict[str, Any]:
    payload = _request(f"{_api_base(repo)}/pulls/{pr_number}", token=token)
    if not isinstance(payload, dict):
        raise FinalizeError("GitHub PR response is not an object")
    return payload


def _require_exact_open_pr(pr: dict[str, Any], candidate: str) -> None:
    if str(pr.get("state") or "") != "open":
        raise FinalizeError(f"PR is not open: state={pr.get('state')!r}")
    head = pr.get("head") if isinstance(pr.get("head"), dict) else {}
    if str(head.get("sha") or "") != candidate:
        raise FinalizeError(
            "PR head moved after sealing: "
            f"expected {candidate}, found {head.get('sha') or '<missing>'}"
        )


def _require_green_exact_head_ci(repo: str, candidate: str, token: str) -> dict[str, Any]:
    query = urllib.parse.urlencode(
        {"head_sha": candidate, "event": "pull_request", "per_page": "100"}
    )
    payload = _request(f"{_api_base(repo)}/actions/runs?{query}", token=token)
    rows = payload.get("workflow_runs") if isinstance(payload, dict) else None
    rows = rows if isinstance(rows, list) else []
    matches = [
        row for row in rows
        if isinstance(row, dict)
        and str(row.get("name") or "") == "CI"
        and str(row.get("head_sha") or "") == candidate
    ]
    if not matches:
        raise FinalizeError(f"no exact-head pull_request CI run found for {candidate}")
    latest = max(matches, key=lambda row: int(row.get("run_number") or 0))
    if str(latest.get("status") or "") != "completed" or str(latest.get("conclusion") or "") != "success":
        raise FinalizeError(
            "latest exact-head CI is not green: "
            f"status={latest.get('status')!r} conclusion={latest.get('conclusion')!r}"
        )
    return latest


def _mark_ready(pr: dict[str, Any], token: str) -> None:
    if pr.get("draft") is not True:
        return
    node_id = str(pr.get("node_id") or "")
    if not node_id:
        raise FinalizeError("draft PR is missing node_id required for mark-ready mutation")
    query = """
mutation MarkReady($id: ID!) {
  markPullRequestReadyForReview(input: {pullRequestId: $id}) {
    pullRequest { isDraft }
  }
}
""".strip()
    payload = _request(
        "https://api.github.com/graphql",
        token=token,
        method="POST",
        body={"query": query, "variables": {"id": node_id}},
    )
    if not isinstance(payload, dict):
        raise FinalizeError("GitHub GraphQL response is not an object")
    if payload.get("errors"):
        raise FinalizeError(f"GitHub mark-ready mutation failed: {payload['errors']}")
    data = payload.get("data") if isinstance(payload.get("data"), dict) else {}
    ready = data.get("markPullRequestReadyForReview")
    ready = ready if isinstance(ready, dict) else {}
    ready_pr = ready.get("pullRequest") if isinstance(ready.get("pullRequest"), dict) else {}
    if ready_pr.get("isDraft") is not False:
        raise FinalizeError(f"GitHub did not transition PR to ready: {payload}")


def _merge(repo: str, pr_number: int, candidate: str, token: str, merge_method: str) -> dict[str, Any]:
    payload = _request(
        f"{_api_base(repo)}/pulls/{pr_number}/merge",
        token=token,
        method="PUT",
        body={
            "sha": candidate,
            "merge_method": merge_method,
            "commit_title": "Product 3.0: Hermes-native sealed release",
            "commit_message": (
                f"SEALED candidate {candidate}. "
                "Merged only after exact-head CI and real-target cross-evidence verification."
            ),
        },
        expected=(200,),
    )
    if not isinstance(payload, dict) or payload.get("merged") is not True:
        raise FinalizeError(f"GitHub merge did not complete: {payload}")
    return payload


def finalize(args: argparse.Namespace) -> dict[str, Any]:
    candidate = args.candidate.strip().lower()
    if len(candidate) != 40 or any(ch not in "0123456789abcdef" for ch in candidate):
        raise FinalizeError(f"candidate must be a full 40-character SHA, got {args.candidate!r}")
    token = args.token.strip()
    if not token and not args.dry_run:
        raise FinalizeError("GITHUB_TOKEN is required unless --dry-run is used")

    verdict = _load_verdict(args.evidence, candidate)
    pr = _get_pr(args.repo, args.pr, token)
    _require_exact_open_pr(pr, candidate)
    ci = _require_green_exact_head_ci(args.repo, candidate, token)

    result: dict[str, Any] = {
        "candidate_sha": candidate,
        "pr": args.pr,
        "repo": args.repo,
        "seal_eligible": True,
        "ci_run_id": ci.get("id"),
        "ci_run_number": ci.get("run_number"),
        "dry_run": bool(args.dry_run),
        "ready_transitioned": False,
        "merged": False,
    }
    if args.dry_run:
        return result

    if pr.get("draft") is True:
        _mark_ready(pr, token)
        result["ready_transitioned"] = True

    pr = _get_pr(args.repo, args.pr, token)
    _require_exact_open_pr(pr, candidate)
    if pr.get("draft") is True:
        raise FinalizeError("PR is still draft immediately before merge")

    merged = _merge(args.repo, args.pr, candidate, token, args.merge_method)
    result["merged"] = True
    result["merge_sha"] = merged.get("sha")
    result["message"] = merged.get("message")
    result["seal_schema"] = verdict.get("schema")
    return result


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Finalize a real-target-sealed Hermes Worker Studio pull request")
    parser.add_argument("--repo", default=os.getenv("GITHUB_REPOSITORY", ""))
    parser.add_argument("--pr", type=int, required=True)
    parser.add_argument("--candidate", required=True)
    parser.add_argument("--evidence", type=Path, default=Path(".seal/SEALED.json"))
    parser.add_argument("--merge-method", choices=("merge", "squash", "rebase"), default="merge")
    parser.add_argument("--token", default=os.getenv("GITHUB_TOKEN", ""))
    parser.add_argument("--dry-run", action="store_true")
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
