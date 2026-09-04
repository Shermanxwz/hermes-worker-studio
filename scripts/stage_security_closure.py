#!/usr/bin/env python3
"""Seal-grade staged hardening for the Product 3 backend bridge.

This release transform intentionally operates only on the staged install tree.
It closes two local engineering boundaries without creating a second runtime:

* private Studio projection/protocol state is written through an O_EXCL/O_NOFOLLOW
  mode-0600 temporary file, fsync'd, then atomically renamed;
* malformed JSON bodies are normalized to HTTP 400 instead of depending on host
  exception handling.

Every source anchor and occurrence count is fail-closed. Source drift therefore
blocks installation/CI instead of silently shipping a partially hardened bridge.
"""
from __future__ import annotations

import sys
from pathlib import Path


def _replace_once(source: str, old: str, new: str, label: str) -> str:
    count = source.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected exactly one source match, found {count}")
    return source.replace(old, new, 1)


def patch_backend(source: str) -> str:
    helper_anchor = "_PROJECTION_LOCK = threading.RLock()\n"
    helper = r'''


def _write_private_json(path: pathlib.Path, payload: Any) -> None:
    """Durably replace one private JSON state file without a permissive window."""
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(
        f".{path.name}.{os.getpid()}.{threading.get_ident()}.{time.time_ns()}.tmp"
    )
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL
    if hasattr(os, "O_NOFOLLOW"):
        flags |= os.O_NOFOLLOW
    fd = os.open(temporary, flags, 0o600)
    fd_owned = True
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            fd_owned = False
            json.dump(payload, handle, ensure_ascii=False, separators=(",", ":"))
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
        try:
            directory_fd = os.open(path.parent, os.O_RDONLY)
            try:
                os.fsync(directory_fd)
            finally:
                os.close(directory_fd)
        except OSError:
            # Some filesystems do not support fsync on directories. The file
            # itself is already durable and mode 0600 before the rename.
            pass
    except Exception:
        if fd_owned:
            os.close(fd)
        try:
            temporary.unlink()
        except FileNotFoundError:
            pass
        raise


async def _read_request_json(request: Request) -> Any:
    """Return decoded JSON, mapping malformed bodies to an explicit HTTP 400."""
    try:
        return await request.json()
    except (json.JSONDecodeError, UnicodeDecodeError, ValueError) as exc:
        raise HTTPException(400, "request body must contain valid JSON") from exc
'''
    source = _replace_once(
        source,
        helper_anchor,
        helper_anchor + helper,
        "private-state/json helper insertion",
    )

    projection_old = '''def _write_projection(session_id: str, payload: dict[str, Any]) -> None:
    _PROJECTION_ROOT.mkdir(parents=True, exist_ok=True)
    path = _projection_file(session_id)
    temporary = path.with_name(f".{path.name}.{os.getpid()}.tmp")
    temporary.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    os.replace(temporary, path)
    try:
        os.chmod(path, 0o600)
    except OSError:
        pass
'''
    projection_new = '''def _write_projection(session_id: str, payload: dict[str, Any]) -> None:
    _write_private_json(_projection_file(session_id), payload)
'''
    source = _replace_once(
        source,
        projection_old,
        projection_new,
        "projection private write",
    )

    protocol_old = '''def _write_protocol_state(payload: dict[str, Any]) -> None:
    _PROTOCOL_FILE.parent.mkdir(parents=True, exist_ok=True)
    temporary = _PROTOCOL_FILE.with_name(f".{_PROTOCOL_FILE.name}.{os.getpid()}.tmp")
    temporary.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    os.replace(temporary, _PROTOCOL_FILE)
    try:
        os.chmod(_PROTOCOL_FILE, 0o600)
    except OSError:
        pass
'''
    protocol_new = '''def _write_protocol_state(payload: dict[str, Any]) -> None:
    _write_private_json(_PROTOCOL_FILE, payload)
'''
    source = _replace_once(
        source,
        protocol_old,
        protocol_new,
        "protocol private write",
    )

    raw_json_count = source.count("await request.json()")
    # Six Product 3 endpoints exist in source and stage_mixed_protocol inserts
    # the lazy /hermes/protocols/resolve endpoint before this transform runs.
    if raw_json_count != 7:
        raise SystemExit(
            f"request JSON hardening: expected exactly seven staged request.json calls, found {raw_json_count}"
        )
    source = source.replace("await request.json()", "await _read_request_json(request)")
    return source


def main(argv: list[str]) -> int:
    if len(argv) != 2:
        print(f"usage: {argv[0]} PATH_TO_STAGED_PLUGIN_API_V3.py", file=sys.stderr)
        return 2
    path = Path(argv[1])
    source = path.read_text(encoding="utf-8")
    updated = patch_backend(source)
    if updated == source:
        raise SystemExit("security closure produced no changes")
    path.write_text(updated, encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
