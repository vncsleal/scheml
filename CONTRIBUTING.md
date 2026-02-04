# PrisML Contributing Guide

## Development Setup

```bash
# Clone and install
git clone https://github.com/prisml/prisml
cd prisml
npm install

# Build all packages
npm run build

# Run tests
npm run test

# Watch mode
npm run dev
```

## Project Structure

```
packages/
  core/      # Type system, errors, defineModel
  cli/       # prisml train command
  runtime/   # ONNX inference engine
  python/    # Python training backend
examples/
  basic/     # Working example
docs/
  ARCHITECTURE.md
  API.md
  GUIDE.md
  GETTING_STARTED.md
  FEATURES.md
  ROADMAP.md
```

## Coding Standards

### TypeScript

- Strict mode enabled
- Full type annotations (no `any`)
- JSDoc for public APIs
- Clear error messages

### Errors

- Use typed PrisMLError subclasses
- Include structured context
- Never silently fail

### Features

- Conservative by default
- Explicit over implicit
- Fail fast with clear errors
- Document tradeoffs

### Testing

- Unit tests in `*.test.ts`
- Integration tests in `integration/`
- All public APIs covered
- 80%+ coverage target

## Adding Features

### Process

1. **Discuss** — Open RFC issue describing feature
2. **Design** — Comment on issue with approach
3. **Implement** — Create branch and PR
4. **Test** — Add unit + integration tests
5. **Document** — Update relevant docs
6. **Merge** — Squash commit to main

### Checklist

- [ ] Feature described in FEATURES.md or ROADMAP.md
- [ ] Types updated
- [ ] Error cases handled with PrisMLError
- [ ] Unit tests pass
- [ ] Integration tests pass
- [ ] Documentation updated (API.md, GUIDE.md, etc.)
- [ ] Examples work
- [ ] No breaking changes (unless major version)

## Code Review

Reviewers look for:
- Correctness (no silent failures)
- Type safety (strict TypeScript)
- Error handling (clear PrisMLErrors)
- Testing coverage (edge cases)
- Documentation clarity
- Performance impact
- Security implications

## Reporting Issues

### Bug

```markdown
## Description
[What happened]

## Reproduction
[Steps to reproduce]

## Expected
[What should happen]

## Actual
[What does happen]

## Environment
- Node: [version]
- TypeScript: [version]
- PrisML: [version]
```

### Feature Request

```markdown
## Problem
[What problem does this solve]

## Proposed Solution
[How should this work]

## Tradeoffs
[What are we giving up]

## Alternatives
[Other approaches]
```

## Commits

Use clear, descriptive commit messages:

```
feat: add batch inference support

- Implement InferenceSession.inferBatch()
- Add atomic validation
- Update error handling

Fixes #123
```

## Pull Requests

```markdown
## Description
[What does this change]

## Type
- [ ] Bug fix
- [ ] Feature
- [ ] Documentation
- [ ] Refactor

## Testing
- [ ] Unit tests added
- [ ] Integration tests added
- [ ] Manual testing done

## Breaking Changes?
- [ ] No
- [ ] Yes: [description]

## Documentation
- [ ] API.md updated
- [ ] GUIDE.md updated
- [ ] Examples updated
- [ ] JSDoc updated
```

## Releases

### Version Bumping

- Major (1.0.0) — breaking API changes
- Minor (0.1.0) — new features, backward compatible
- Patch (0.0.1) — bug fixes

### Publishing

```bash
# Bump version
npm version minor

# Build
npm run build

# Test
npm run test

# Publish
npm publish

# Tag release
git push origin v0.1.0
```

## Questions?

- Open GitHub Discussions
- Email team
- Check docs
