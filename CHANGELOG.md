# Changelog

## Unreleased — Product engineering closure

### Mixed New API protocol closure

- Closed the mixed OpenAI-compatible endpoint gap where one New API inventory can contain both Chat Completions and Responses-only models.
- Added first-use per-model protocol resolution: unresolved custom models run real Hermes Chat/Responses probes automatically, cache the verified result, and continue through the resulting official execution route without requiring a pre-click in Models.
- Kept routing fail-closed: model names such as `gpt-*` and pasted URL suffixes are never protocol evidence; both-success requires explicit choice and both-failed returns the real probe failures.
- Added first-use probe locking plus a short failed-probe cooldown so concurrent sends do not duplicate billable probes and repeated failures do not create a retry storm.
- Unified Product Chat, independent Worker, Verifier and native MOA around the same per-model execution route. Managed compatibility aliases are written only through Hermes `/api/config`, while the UI continues to show the source Provider/Model.
- Kept **官方探测** as a diagnostic/retry action rather than a prerequisite for normal use.

### No-feature product / engineering closure

- Added `product-closure.css` as the final Product 3 stylesheet layer for keyboard focus visibility, touch-only action discoverability, safe-area/dialog bounds, short mobile/landscape viewports and complete reduced-motion handling without changing the existing visual language.
- Closed existing-control accessibility semantics: live error alerts, Modal Escape/focus trap/focus return, menu/disclosure state, accessible names for composer/send/file/mobile/Full Access controls and active navigation state.
- Strengthened the atomic installer and tests so the exact installed file set includes the closure stylesheet and both deterministic release transforms.
- Added an explicit **Exact staged release artifact** CI gate that runs both installer transforms, then syntax-checks the final JavaScript and Python bridge and asserts the mixed-protocol/accessibility closure tokens.
- Strengthened the archive contract around sole-Hermes runtime ownership, bounded Worker convenience state, CSS layering, release-transform capabilities, candidate SHA stamping and second-runtime rejection.
- Expanded real-target browser coverage to desktop 1440×900, Pixel 7 portrait and compact 667×375 touch landscape. Every existing first-level page — Chat, Worker, Models, MOA, Full Access and History — is checked for horizontal overflow and product viewport bounds.
- Made Playwright TLS-error ignoring opt-in (`HWS_SEAL_IGNORE_HTTPS_ERRORS=1`) instead of a default weakening.
- Reconciled architecture, security, test, README, bilingual project introduction and seal documentation so current first-use protocol behavior and exact-current evidence semantics have one consistent source of truth.
- Reclassified the 2026-09-01 target capture explicitly as historical evidence; it can no longer be read as proof for a newer exact candidate.

## 3.0.0 — Product-grade Hermes shell

- Moved Worker Studio to the product home route while keeping the native Hermes `/sessions` Dashboard reachable from **高级**.
- Added official Dashboard return slots that show **← Worker Studio** on native Hermes pages; no Dashboard fork.
- Rebuilt the conversation surface around a ChatGPT-like information hierarchy with Hermes-native teal/cream styling.
- Added session search and complete official Session CRUD: rename, archive, unarchive, and delete.
- Removed the fixed `New conversation` title path; sessions are created lazily on first send with prompt-derived titles.
- Added auto-scroll/follow control, jump-to-bottom, autosizing composer, Enter/Shift+Enter behavior, drag/drop, file picker, and Ctrl/Cmd+V attachment UX.
- Added the Product 3 Runs probe/compat bridge that preserves structured Hermes `/v1/runs` input instead of flattening multimodal payloads to strings.
- Added dedicated projection of real Hermes `todo` lifecycle events into an expandable **官方计划** surface while keeping tools/approval/subagent events observable.
- Added full Custom Endpoint edit/test/save/activate/delete UX on Hermes official provider APIs and API-root normalization.
- Replaced ambiguous unattended controls with a single **完全访问** toggle backed by Hermes approvals/delegation config, read-back, real marker probe, and pre-enable config restore.
- Added mobile drawer navigation, `100dvh`/safe-area handling, responsive composer/chat/history/model surfaces, and touch-friendly controls.
- Added the Worker Studio project mark through Hermes official plugin static assets and a matching Hermes dashboard theme; no independent installed favicon is maintained.
- Extended CI/archive gates for Product 3 assets, structured Run input, session/model lifecycle closure, mobile CSS, and no-second-runtime guarantees.

## 2.0.0 — Hermes-native archive candidate

- Removed the independent Worker execution/control plane from the Studio runtime.
- Worker/Verifier delegation now uses Hermes public `PluginContext.subagent_lifecycle`.
- Added Hermes `pre_tool_call` enforcement for OFFICIAL/MAIN policy semantics.
- Standardized probe/CI execution on Hermes native `/v1/runs`; Product 3 later moved live chat to the official TUI Gateway WebSocket.
- Unified Main/Worker/Review model selection on Hermes `/api/model/options` and official Custom Endpoints.
- Reasoning UI is fail-closed to `Auto` unless upstream exposes explicit effort metadata.
- Promoted Unattended to first-level UX and added delegation auto-approval plus real Run marker verification.
- Consolidated sidebar/navigation, full-history pagination/search/archive and observable work timeline.
- Replaced archive gates, upstream lock and CI with Hermes-only contracts and Hermes-owned regression tests.

## 1.x

Legacy dual-runtime implementation is retained in Git history only.
