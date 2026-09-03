# Product Engineering Closure

This document records the no-feature closure pass for Hermes Worker Studio 3.0.

The pass is deliberately constrained: no new product surface, model client, execution runtime, navigation item or capability is introduced. Existing behavior is hardened so the same product is dependable and reviewable across source, build, install, desktop, mobile and real-target seal evidence.

## Closure dimensions

- **Runtime ownership:** Hermes remains the sole execution/model/context/policy upstream.
- **Build parity:** CI reproduces and syntax-checks the same deterministic staged JS/Python that the installer ships.
- **Install parity:** installer tests assert the exact installed file set, candidate SHA stamping and both release transforms.
- **Desktop/mobile UI:** every existing first-level Studio page is part of the real-target viewport/overflow matrix.
- **Interaction semantics:** focus visibility, dialog Escape/focus lifecycle, disclosure/menu state, accessible names and touch-only discoverability are explicit contracts.
- **Responsive bounds:** phone portrait and compact landscape must remain inside the actual dynamic viewport and safe areas.
- **Motion:** reduced-motion preference applies to all Studio-owned transitions/animations.
- **Protocol integrity:** mixed Chat/Responses routing remains real-probe based, cached, concurrency-deduplicated and fail-closed without name/URL guessing.
- **Target evidence:** evidence v2 requires exact installed-candidate read-back and the actual final execution route for the real acceptance Run.
- **Browser identity:** desktop, portrait mobile and landscape mobile each read the running candidate SHA and each must produce a real passed product-shell result.
- **Release identity:** development PRs merge first; only exact current `main` with green push CI can become the final seal candidate.
- **Target authority:** the manual self-hosted seal workflow is GitHub read-only and cannot merge a PR or rewrite repository state after evidence capture.
- **Evidence hygiene:** historical target captures are explicitly historical; target evidence v2 + seal verdict v2 + exact-main verification are required for `SEALED`.

## Non-goals

This closure does not:

- add a new feature or page;
- add a new provider protocol;
- change Hermes policy semantics;
- replace Hermes native delegation/MOA/session/config behavior;
- redesign the existing teal/cream visual language;
- bypass the pinned upstream exclusive-shell gate.

`ARCHITECTURE.md`, `AUTOMATED_TEST_MATRIX.md`, `SECURITY.md`, `SEAL_CHECKLIST.md` and `SEAL_STATUS.md` remain the detailed contracts.
