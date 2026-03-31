# ScheML 0.3.2 Release Tracker

## Goal

Ship `0.3.2` as a trust-and-contract hardening release focused on:

`DB schema interface -> compiled contract/types -> ML train inputs/outputs`

## Base Commit

- `main` @ `f03721a`

## Worktrees And Branches

- Canonical repo: `/Users/vncsleal/Downloads/projects/scheml`
- Lane A worktree: `/Users/vncsleal/Downloads/projects/scheml-wt-contract`
  - Branch: `codex/0.3.2-contract-fit-after-split`
- Lane B worktree: `/Users/vncsleal/Downloads/projects/scheml-wt-integration`
  - Branch: `codex/0.3.2-integration-backend-validation`
- Lane C worktree: `/Users/vncsleal/Downloads/projects/scheml-wt-release`
  - Branch: `codex/0.3.2-release-docs`

## Lane Ownership

### Lane A: Contract Refactor

Owns:

- `packages/scheml/src/commands/train.ts`
- `packages/scheml/src/encoding.ts`
- any new internal helper extracted for fitting/splitting flow
- core unit tests for the new contract behavior

Scope:

- split raw rows before preprocessing fit
- keep TypeScript as owner of feature semantics
- preserve Python vector payload
- make the compiled feature contract train-derived

### Lane B: Integration / Backend Validation

Owns:

- `packages/scheml/python/train.py`
- integration tests
- TS/Python boundary tests
- backend assertions if needed

Scope:

- verify backend compatibility with Lane A
- add integration coverage
- avoid architecture changes to the contract ownership model

### Lane C: Docs / Release Framing

Owns:

- `README.md`
- `docs/GUIDE.md`
- `CHANGELOG.md`

Scope:

- align examples with AutoML default
- document train-derived preprocessing contract
- frame `0.3.2` as a contract hardening release

## Merge Order

1. PR 1: `codex/0.3.2-contract-fit-after-split`
2. PR 2: `codex/0.3.2-integration-backend-validation`
3. PR 3: `codex/0.3.2-release-docs`

## Conflict Rules

- Only Lane A performs structural changes to `train.ts`.
- Lane B may only stack temporarily on Lane A for validation.
- Lane C should stay off implementation files unless the change is trivial and already settled.
- No unrelated cleanup in any lane.

## Acceptance Criteria

- preprocessing leakage is fixed
- TypeScript remains the semantic owner of the feature contract
- Python remains trainer/exporter only
- metadata remains the semantic contract for runtime normalization
- no public API break is introduced
- docs reflect the shipped behavior

## Tracking Checklist

- [x] Lane A branch checked out and implementation started
- [x] Lane B branch checked out and integration scaffolding started
- [x] Lane C branch checked out and docs audit started
- [ ] Draft PR 1 opened
- [ ] PR 1 merged
- [ ] PR 2 rebased/finalized and merged
- [ ] PR 3 finalized and merged
- [ ] `0.3.2` changelog finalized
