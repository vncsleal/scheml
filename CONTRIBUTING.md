If you are fixing a bug, implementing a feature, or making a non-trivial change, start by finding or creating a roadmap-backed Issue.

## Governance & Workflow (short)

This section defines governance rules only. For local setup, testing, and implementation details, see `docs/DEVELOPMENT.md`.

This project uses a roadmap-driven workflow. Keep the following rules in mind — this file is the contract describing how work is governed.

1) Canonical spec
- `prisml-internal/ALL_FIXES_AND_ROADMAP.md` is the authoritative spec. It contains acceptance criteria and high-level invariants.

2) Issues
- Create one Issue per roadmap item (maintainers may mirror the roadmap). Issues are the execution units and may be assigned and discussed.
- Issue body should include a link to the corresponding `ALL_FIXES_AND_ROADMAP.md` section.

3) PR requirements (enforced)
 - Every PR must reference one primary roadmap ID and one Issue (default). Use the PR template to ensure this. Example lines in the PR body:

  Roadmap: P05a
  Issue: #42

- Default rule: one PR → one roadmap ID. If your work legitimately touches multiple roadmap items, use the Composite exception (see PR template) and provide a brief justification. Maintainers must approve such exceptions.

4) Roadmap edits
- Edits to `ALL_FIXES_AND_ROADMAP.md` must be done via PR. A roadmap-edit PR must:
  - explain motivation
  - reference the Issue(s) that triggered the change
  - update or add a `Last-Updated: YYYY-MM-DD` header near the affected entry

5) Onboarding and exceptions
- If your PR is rejected for missing Roadmap/Issue references, the reviewer should guide the contributor to amend the PR rather than close immediately.

6) Tooling
- A lightweight GitHub Action validates PR bodies for `Roadmap:` and `Issue:` lines. Exceptions are allowed when the PR template `Composite` checkbox is checked.

These rules are intentionally short: governance only. For development setup and mechanics, see `docs/DEVELOPMENT.md`.

## What We're Looking For

**High Priority:**
- Bug fixes (especially platform-specific issues)
- Documentation improvements
- Real-world examples
- Performance optimizations
- Test coverage improvements

**Medium Priority:**
- New algorithm support
- Developer experience enhancements
- Platform compatibility (Windows, Alpine, serverless)

**Not Accepting (Yet):**
- Deep learning models (V2.0+)
- Breaking API changes (wait for V2.0)
- Cloud integrations (planned for V3.0)

## Community

- **Discussions**: Ask questions, share ideas
- **Issues**: Bug reports, feature requests
- **Discord**: Coming soon (if community grows)

## Recognition

Contributors will be:
- Listed in CHANGELOG.md
- Credited in release notes
- Added to README contributors section (if significant contribution)

## Questions?

- Open a [GitHub Discussion](https://github.com/vncsleal/prisml/discussions)
- Create a [Question issue](https://github.com/vncsleal/prisml/issues/new/choose)
- Tag maintainers in your PR for review

## Code of Conduct

Be respectful, constructive, and professional. We're all here to build something useful.

