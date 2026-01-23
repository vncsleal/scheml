# Development Handbook

Note: Governance rules (roadmap, issues, PR requirements) are defined in CONTRIBUTING.md. This document focuses on local development and implementation details.

This document contains developer-facing instructions: getting started, local setup, tests, build, and development workflow.

## Getting Started

1. **Fork the repository** on GitHub
2. **Clone your fork** locally
3. **Install dependencies**: `pnpm install`
4. **Generate Prisma client**: `pnpm prisma generate`
5. **Run tests**: `pnpm test`
6. **Build**: `pnpm build`

## Development Workflow

### Running Tests

```bash
pnpm test                  # Run all tests
pnpm test:watch            # Watch mode
pnpm test:coverage         # With coverage report
```

### Code Quality

```bash
pnpm lint                 # Check linting
pnpm build                # TypeScript compilation
```

### Local Testing

```bash
# Test the package locally
pnpm pack                 # Creates tarball
cd ../test-project
npm install ../prisml/vncsleal-prisml-1.0.0.tgz
```

## Development Conventions

### Code Standards

1. **TypeScript**: All code must be strongly typed
2. **Tests**: Add tests for new features
3. **Documentation**: Update README/docs for user-facing changes
4. **Commits**: Use conventional commits format

### Pull Request Process (expanded)

1. **Create an issue first** (for non-trivial changes)
2. **Branch naming**: `feature/your-feature` or `fix/bug-name`
3. **Keep PRs focused**: One feature/fix per PR
4. **Write tests**: Ensure all tests pass
5. **Update docs**: If user-facing changes
6. **Describe changes**: Clear PR description with context

### Testing Requirements

All PRs must:
- Pass existing tests
- Add new tests for new functionality
- Maintain or improve code coverage
- Pass TypeScript compilation
- Pass linting (warnings are acceptable if justified)

### Platform Testing

If your change affects platform compatibility:
- Test on macOS, Ubuntu, and Windows (if possible)
- Document any platform-specific behavior
- Update `docs/PLATFORM_COMPATIBILITY.md`

## Project Structure

```
prisml/
├── src/
│   ├── core/          # Type definitions, model API
│   ├── engine/        # ONNX inference, feature processing
│   ├── extension/     # Prisma Client extension
│   ├── cli/           # CLI commands (train, inspect)
│   └── __tests__/     # Test suites
├── scripts/           # Training scripts (Python)
├── examples/          # Example projects
├── docs/              # Documentation
└── prisma/            # Prisma schema for testing
```

## Implementation Patterns (Non-Normative)

These are implementation patterns and conventions observed in the codebase. They are guidelines, not governance rules. They reflect current practice and may evolve over time.


### Adding a New Algorithm

1. Update `scripts/train.py` to support the algorithm
2. Add algorithm to `TrainingConfig` type in `src/core/types.ts`
3. Add tests in `src/__tests__/`
4. Document in README.md

### Adding a New Feature

1. Define the API in `src/core/types.ts`
2. Implement in relevant module (`engine/`, `extension/`, etc.)
3. Add comprehensive tests
4. Update examples if applicable
5. Document in README and API docs

### Fixing Bugs

1. Write a failing test that reproduces the bug
2. Fix the bug
3. Verify the test now passes
4. Check for similar issues elsewhere
