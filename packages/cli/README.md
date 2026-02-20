# @vncsleal/prisml-cli

CLI commands for PrisML - compiler-first machine learning for TypeScript + Prisma.

## Features

- `prisml train` - Compile models to ONNX artifacts
- `prisml check` - Validate schema contracts without training

## Installation

```bash
npm install @vncsleal/prisml-cli
```

## Usage

### Train Models

```bash
prisml train --config ./prisml.config.ts --schema ./prisma/schema.prisma
```

Compiles model definitions to immutable ONNX artifacts:
- `model.onnx` - Executable prediction function
- `model.metadata.json` - Schema contract and feature encoding

### Validate Contracts

```bash
prisml check --schema ./prisma/schema.prisma --output ./.prisml
```

Validates feature dependencies against Prisma schema:
- Detects type mismatches
- Detects nullability violations
- Warns on dynamic feature paths
- Fast CI-friendly validation (no training required)

## Python Backend

The CLI includes a Python training backend. Install dependencies:

```bash
cd node_modules/@vncsleal/prisml-cli
pip install -r python/requirements.txt
```

Required packages:
- scikit-learn
- onnxmltools
- skl2onnx

## Documentation

See [main documentation](../../README.md) and [user guide](../../docs/GUIDE.md).

## License

MIT © [Vinicius Leal](https://github.com/vncsleal)
