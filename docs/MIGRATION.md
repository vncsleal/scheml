# Migration Guide to PrisML v1.1.0

PrisML v1.1.0 introduces a strict separation between Runtime and Compiler to improve performance, security, and build stability.

## 🚨 Breaking Changes

### 1. Root Export is Runtime-Only
The package root `@vncsleal/prisml` now **only exports the Runtime API**. 
You can no longer import CLI or Compiler tools from the main package.

**❌ Invalid:**
```typescript
import { PrisMLModel } from 'prisml'; // OK
import { trainCommand } from 'prisml/cli/commands/train'; // ERROR: Not exported
import { PrismaDataExtractor } from 'prisml/cli/extractor'; // ERROR: Not exported
```

**✅ Valid:**
```typescript
import { PrisMLModel, defineModel, prisml } from '@vncsleal/prisml';
// CLI usage is done exclusively via the 'npx prisml' binary or dist/cli.js
```

### 2. Assets Moved
Python assets have been moved from `scripts/` to `assets/python/trainer.py`. Relying on internal paths is discouraged; please use the CLI which handles this automatically.

## Upgrade Steps

1.  **Update Imports:** Scan your codebase for any imports from `prisml/...`. Change them to named imports from `@vncsleal/prisml`.
2.  **Check CLI Usage:** Ensure you are using `npx prisml` or the `bin` entry point, rather than trying to invoke CLI functions programmatically.
3.  **Clean Install:** We recommend deleting `node_modules` and `package-lock.json` before reinstalling to ensure the new exports map is respected.
