# Changelog

## Unreleased — Mixed New API protocol closure

- Closed the mixed OpenAI-compatible endpoint gap where one New API inventory can contain both Chat Completions and Responses-only models.
- Added first-use per-model protocol resolution: unresolved custom models run real Hermes Chat/Responses probes automatically, cache the verified result, and continue through the resulting official execution route without requiring a pre-click in Models.
- Kept routing fail-closed: model names such as `gpt-*` are never treated as protocol evidence; if both transports work the operator must choose, and if neither works the Run fails with both real probe results.
- Added per-model first-use probe locking plus a short failed-probe cooldown so concurrent sends do not duplicate billable probes and repeated failures do not create a retry storm.
- Unified product Chat, independent Worker, Verifier, and native MOA around the same per-model execution route. Managed compatibility aliases are written only through Hermes `/api/config`, while the UI continues to show the original source Provider/Model.
- Kept **官方探测** as an explicit diagnostic/retry action rather than a prerequisite for normal use.
- Added an exact-count, fail-closed install-stage transform plus regression coverage for transformed Python/JavaScript syntax, Responses route selection, ambiguous-route blocking, and concurrent first-use probe de-duplication.

## 3.0.0 — Product-grade Hermes shell

- Moved Worker Studio to the product home route while keeping the native Hermes `/sessions` Dashboard reachable from **高级**.
- Added an official Dashboard `header-left` slot that shows **← Worker Studio** on native Hermes pages; no DOM patching or Dashboard fork.
- Rebuilt the conversation surface around a ChatGPT-like information hierarchy with Hermes-native teal/cream styling.
- Added session search and complete official Session CRUD: rename, archive, unarchive, and delete.
- Removed the fixed `New conversation` title path; sessions are created lazily on first send with collision-resistant prompt-derived titles.
- Added auto-scroll/follow control, jump-to-bottom, autosizing composer, Enter/Shift+Enter behavior, drag/drop, file picker, and Ctrl/Cmd+V image attachment UX.
- Added the v3 Runs bridge that preserves structured Hermes `/v1/runs` input instead of flattening multimodal payloads to strings.
- Added dedicated projection of real Hermes `todo` lifecycle events into an expandable **官方计划** surface while keeping tools/approval/subagent events observable.
- Added full Custom Endpoint edit/test/save/activate/delete UX on Hermes official provider APIs and user-friendly terminal-path Base URL normalization.
- Replaced ambiguous unattended controls with a single **完全访问** toggle backed by Hermes approvals/delegation config, read-back, real marker probe, and pre-enable config restore.
- Added mobile drawer navigation, `100dvh`/safe-area handling, responsive composer/chat/history/model surfaces, and touch-friendly controls.
- Added Hermes-inspired Worker Studio favicon/brand mark and a matching Hermes dashboard theme.
- Extended CI/archive gates for Product 3.0 assets, structured Run input, session/model lifecycle closure, mobile CSS, and no-second-runtime guarantees.

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
