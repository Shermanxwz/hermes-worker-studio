# Changelog

## 2.0.0 — Hermes-native archive candidate

- Removed the independent Worker execution/control plane from the Studio runtime.
- Worker/Verifier delegation now uses Hermes public `PluginContext.subagent_lifecycle`.
- Added Hermes `pre_tool_call` enforcement for OFFICIAL/MAIN policy semantics.
- Standardized conversation execution on Hermes native `/v1/runs` with status/events/stop/approval/steer.
- Unified Main/Worker/Review model selection on Hermes `/api/model/options` and official Custom Endpoints.
- Reasoning UI is fail-closed to `Auto` unless upstream exposes explicit effort metadata.
- Promoted Unattended to first-level UX and added delegation auto-approval plus real Run marker verification.
- Consolidated sidebar/navigation, full-history pagination/search/archive and observable work timeline.
- Replaced archive gates, upstream lock and CI with Hermes-only contracts and Hermes-owned regression tests.

## 1.x

Legacy dual-runtime implementation is retained in Git history only.
