# Seal Status

Status: **ARCHIVE CANDIDATE**

Target: Hermes Worker Studio 2.0 — Hermes-native single-runtime archive baseline.

## Repository acceptance

- Pinned Hermes snapshot: `9eb832aad74547aaa0c4e6b4c1fab11f7d6a4bea` (`0.20.6`).
- PR: `#3` — `feat: seal Hermes-native Worker Studio 2.0`.
- Accepted PR head: `e943bd64285621858fc3cf14a661201ecf635662`.
- Final PR CI: Actions run `33406016546` — all four archive jobs passed.
- Merge commit: `48030e09bb45d8180780897bcc8c07fda2555a23`.
- Post-merge `main` CI: Actions run `33406204161` — all four archive jobs passed.
- Pinned Hermes regression seam: **179 passed** across public subagent lifecycle, Runs and approval suites.
- Hermes Plugin Doctor: runtime discovery/import/registration passed; **3 tools + 1 hook** registered.
- Production security gate: Bandit, secret rejection and second-runtime residue rejection passed.
- Studio gate: Python/JS/Shell syntax, archive contract, unit/HTTP/installer tests, jsdom product flow, manifest and high-severity npm audit passed.

Repository-level engineering acceptance is therefore complete and this revision family qualifies as an **ARCHIVE CANDIDATE**.

## Target-machine seal

Status: **NOT YET SEALED**.

`SEALED` additionally requires the authenticated host evidence in `SEAL_CHECKLIST.md`: real target-machine installation/Plugin Doctor, live Hermes API readiness, real New API credentials/model probes, four-mode live child behavior, unattended config read-back + marker Run, restart/failure injection and security sweep.

The repository must never label itself `SEALED` solely because GitHub CI is green.
