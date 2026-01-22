# PrisML Platform Compatibility Matrix

**Last Updated:** January 16, 2026  
**Status:** v1.0.0-alpha

This document details tested and known configurations for PrisML across different platforms, runtimes, and deployment targets.

---

## Runtime Compatibility

### Node.js Versions

| Version | Status | Notes |
|---------|--------|-------|
| **18.x** | TESTED | Recommended for production. ONNX native addon builds reliably. |
| **20.x** | TESTED | Current LTS. Fully supported with all features. |
| **22.x** | PARTIAL | Works but native addon (onnxruntime-node) may require rebuild on first install. |
| **16.x** | UNSUPPORTED | Deprecated. ONNX Runtime dropped support; use Node 18+. |
| **<16.x** | UNSUPPORTED | Too old. No testing or support. |

**Recommendation:** Use **Node 20 LTS** for production; Node 18 as minimum.

---

## Operating System Support

### Desktop / Development

| OS | Architecture | Status | Notes |
|----|--------------|--------|-------|
| **macOS** | Intel (x86_64) | TESTED | Works perfectly. Recommended for development. |
| **macOS** | ARM64 (M1/M2/M3) | TESTED | Full support. All features work. |
| **Ubuntu** | x86_64 (22.04, 24.04) | TESTED | Recommended for Linux development. Install `build-essential`. |
| **Debian** | x86_64 | WORKS | Similar to Ubuntu; may need `apt install build-essential python3-dev`. |
| **Windows** | x86_64 | PARTIAL | See [Windows Known Issues](#windows-known-issues). |
| **Alpine Linux** | x86_64 | NOT SUPPORTED | ONNX Runtime lacks musl libc binaries. Use WebAssembly fallback. |

### Production / Cloud Platforms

| Platform | Status | Notes |
|----------|--------|-------|
| **Vercel (Serverless)** | PARTIAL | Cold start adds 3-5s due to ONNX runtime init. Works for inference. See [Serverless Considerations](#serverless-considerations). |
| **AWS Lambda** | PARTIAL | Requires custom runtime layer or Node 20 runtime. ONNX init lag expected. |
| **Cloudflare Workers** | NOT SUPPORTED | Native addons not supported in edge runtime. Use WebAssembly fallback. |
| **Docker (Linux)** | TESTED | x86_64 images build and run reliably. ARM64 support depends on builder. |
| **Railway** | WORKS | Standard Node deployment. No special config needed. |
| **Render** | WORKS | Standard Node deployment. No special config needed. |

---

## Database Support

| Database | Status | Notes |
|----------|--------|-------|
| **PostgreSQL** | TESTED | Primary target. All features work. |
| **Neon** | TESTED | Serverless Postgres. PrisML works in Node functions (not edge). |
| **Supabase** | TESTED | Built on Postgres. Fully supported. |
| **PlanetScale** | WORKS | MySQL-based. Works with Prisma but fewer query patterns supported. |
| **SQLite** | WORKS | For development/testing only. Not recommended for production training data. |
| **CockroachDB** | PARTIAL | Postgres-compatible. Training may be slower due to distributed nature. |

---

## ONNX Runtime Details

### Native (Recommended)

```bash
npm install onnxruntime-node
```

**Supported Platforms:**
- macOS (Intel & ARM64)
- Linux x86_64 (Ubuntu, Debian)
- Windows x86_64
- Node 22+ (may require rebuild)

**Performance:** <10ms inference latency

**Known Issues:**
- Windows: Requires Visual C++ Build Tools
- Alpine: No prebuilt binaries
- Older Node versions: Native addon rebuild may fail

### WebAssembly Fallback

```bash
npm install onnxruntime-web
```

**Use When:**
- Native addon fails on your platform
- Deploying to Alpine / edge runtime
- Development convenience (no C++ toolchain needed)

**Trade-offs:**
- Latency: 50-200ms per inference (2-10x slower)
- Bundle size: ~15MB (vs 5MB native)
- Memory: Higher overhead
- Compatibility: Runs everywhere Node.js runs

**Installation:**
```bash
npm uninstall onnxruntime-node
npm install onnxruntime-web
# Then use PrisML normally—it auto-detects
```

---

## Known Issues & Workarounds

### Windows Known Issues

**Issue 1: Native Addon Build Failure**
```
error: 'ONNX Runtime' is missing
```

**Cause:** Windows needs Visual C++ Build Tools to compile native addons.

**Fix:**
1. Install [Visual Studio Build Tools](https://visualstudio.microsoft.com/downloads/) with C++ workload
2. Or: `npm install --build-from-source`
3. Or: Use WebAssembly fallback (`npm install onnxruntime-web`)

**Issue 2: DLL Not Found (`onnxruntime.dll`)**
```
error: The specified module could not be found
```

**Cause:** System PATH missing ONNX Runtime DLL directory.

**Fix:**
1. Reinstall: `npm uninstall && npm cache clean && npm install`
2. Check Node modules for `onnxruntime-node/build/Release/onnxruntime.dll`
3. Use WebAssembly fallback if native persistent fails

---

### Serverless / Cold Start Issues

**Symptom:** First prediction takes 3-5 seconds; subsequent <50ms.

**Cause:** ONNX Runtime initialization (loading binary, JIT compilation).

**Mitigations:**
1. **Warm-up function:** Call `.withML()` on app startup
2. **Provisioned concurrency:** Keep container warm (costs extra)
3. **Multiple invocations:** Users tolerate cold start on first action
4. **CloudFlare/Edge:** Use WebAssembly fallback for <1s startup

**Expected on:**
- Vercel (after 10m inactivity)
- AWS Lambda (after 15m)
- Render (after 30m)

**Not an issue on:**
- Always-on servers (Railway, traditional VPS)
- Containers with reserved concurrency

---

### Alpine Linux

**Symptom:**
```
node: /usr/local/lib/node_modules/.../onnxruntime_binding.node: 
cannot open shared object file: No such file or directory
```

**Cause:** Alpine uses musl libc; ONNX Runtime prebuilt binaries are glibc.

**Solutions:**

**Option A: Use WebAssembly**
```bash
npm install onnxruntime-web
```
Works in Alpine but slower (50-200ms latency).

**Option B: Use glibc base image**
```dockerfile
# Instead of: FROM node:20-alpine
FROM node:20-slim  # Debian-based, includes glibc
```
Larger image (~300MB vs 100MB) but native ONNX works.

**Option C: Build from source in container**
```dockerfile
FROM node:20-alpine
RUN apk add --no-cache python3 g++ make
RUN npm install --build-from-source
```
Slow (10+ min build) but works.

**Recommendation:** Use `node:20-slim` base image.

---

### Node 22 Issues

**Symptom:**
```
npm ERR! gyp ERR! stack Error: Cannot find module 'node-gyp'
```

**Cause:** Native addon rebuild required for new Node ABI.

**Fix:**
```bash
npm install --build-from-source
# or
npm cache clean --force && npm install
```

**Status:** Usually resolves within weeks of Node release as ONNX Runtime updates.

---

### Large Models (>50MB)

**Symptom:** Memory spike or slow loading on first prediction.

**Cause:** ONNX Runtime loads entire model into memory + JIT compilation.

**Mitigations:**
1. **Keep models <20MB:** Average scikit-learn models are 1-5MB
2. **Feature engineering:** Reduce features → smaller model
3. **Pruning:** Remove unnecessary tree nodes (advanced)
4. **Lazy loading:** Load model on-demand, not at app startup

**Example (lazy load):**
```typescript
let modelInstance: PrisMLModel | null = null;

export async function predictWithLazyLoad(input) {
  if (!modelInstance) {
    modelInstance = await loadModel('path/to/model.onnx');
  }
  return modelInstance.predict(input);
}
```

---

## Deployment Recommendations

### Best Case (Recommended)

```
OS: Ubuntu 24.04 LTS
Node: 20.x LTS
Database: PostgreSQL 15+
Platform: Railway, Render, or VPS
Runtime: Native ONNX
Expected Latency: <10ms inference
Cold Start: <500ms (always warm)
```

### Good Case (Works Well)

```
OS: macOS or Ubuntu
Node: 18.x or 20.x
Database: Any Postgres-compatible
Platform: Vercel, AWS Lambda
Runtime: Native ONNX
Expected Latency: <50ms (after cold start)
Cold Start: 3-5s (tolerable for async jobs)
```

### Fallback Case (Still Works)

```
OS: Windows or Alpine
Node: 20.x (required)
Database: Any
Platform: Any
Runtime: WebAssembly fallback
Expected Latency: 50-200ms inference
Cold Start: <2s (WebAssembly optimized)
```

### Not Recommended

```
Edge runtime (Cloudflare Workers, Vercel Edge)
Node <18.x
Alpine base without WebAssembly
Models >100MB (memory issues)
```

---

## Testing Your Setup

### Quick Validation Script

```typescript
// test-platform.ts
import { ONNXInferenceEngine } from '@vncsleal/prisml';

async function testSetup() {
  console.log(`Node: ${process.version}`);
  console.log(`Platform: ${process.platform}`);
  console.log(`Arch: ${process.arch}`);
  
  try {
    // Test ONNX Runtime availability
    const start = performance.now();
    const engine = await inferenceEngine.init();
    const duration = performance.now() - start;
    
    console.log(`✅ ONNX Runtime loaded in ${duration.toFixed(0)}ms`);
    console.log(`✅ Backend: ${engine.backend}`); // 'native' or 'wasm'
  } catch (err) {
    console.error(`❌ ONNX Runtime failed:`, err.message);
    console.log(`💡 Fallback to WebAssembly: npm install onnxruntime-web`);
  }
}

testSetup();
```

**Run:**
```bash
npx ts-node test-platform.ts
```

---

## Support Matrix Summary

| Tier | Support | Guidance |
|------|---------|----------|
| **Tier 1 (Recommended)** | Full | Ubuntu 24.04 + Node 20 + Railway/traditional VPS |
| **Tier 2 (Good)** | Full | macOS + Vercel/Lambda (accept cold start) |
| **Tier 3 (Fallback)** | Limited | Windows/Alpine + WebAssembly (slower) |
| **Tier 4 (Not Supported)** | None | Edge runtime, Node <18, >100MB models |

---

## Reporting Issues

If you encounter platform-specific issues:

1. **Run the validation script** (see above) to identify the problem
2. **Try WebAssembly fallback** to isolate ONNX Runtime issues
3. **Check [TROUBLESHOOTING.md](./TROUBLESHOOTING.md)** for common solutions
4. **Open a GitHub issue** with:
   - `node -v` output
   - `npm list onnxruntime-node onnxruntime-web` output
   - Full error message (run with `DEBUG=*`)
   - Minimal reproduction case

---

## Future Support

- **ARM32 (Raspberry Pi):** Not yet; blocker is ONNX Runtime ARM32 support
- **WebGPU:** Planned for V2.0 (GPU acceleration on desktop)
- **Worker threads:** Planned for V1.1 (multi-model inference)
- **WASM SIMD:** Planned (faster WebAssembly fallback)

---

**Questions?** Check [TROUBLESHOOTING.md](./TROUBLESHOOTING.md) or open an issue on GitHub.
