#!/usr/bin/env python3
"""
ScheML Similarity Training Backend

Builds a similarity index over entity embeddings using one of two strategies:
  - cosine_matrix: exact cosine similarity; used when entity count < 50_000
  - faiss_ivf:     approximate nearest-neighbour via FAISS; used for ≥ 50_000 rows

The artifact is NOT an ONNX model. It is:
  <traitName>.embeddings.npy   (cosine_matrix strategy) — float32 embedding matrix
  <traitName>.faiss            (faiss_ivf strategy) — FAISS index file
  <traitName>.ids.json         entity → index-position mapping (faiss_ivf only)

Metadata is printed as JSON to stdout for train.ts to capture.
"""

import argparse
import json
import os
import sys
from pathlib import Path

import numpy as np

FAISS_THRESHOLD = 50_000  # rows above which FAISS is used


def load_dataset(dataset_path: str) -> dict:
    with open(dataset_path, "r") as f:
        return json.load(f)


def validate_dataset(dataset: dict) -> None:
    required = {"X_train", "feature_names", "entity_ids"}
    missing = required - set(dataset.keys())
    if missing:
        raise ValueError(f"Dataset missing required keys: {missing}")


def compute_normalization(X: np.ndarray) -> tuple:
    means = np.mean(X, axis=0).tolist()
    stds  = np.std(X,  axis=0).tolist()
    stds  = [s if s > 0 else 1.0 for s in stds]
    return means, stds


def normalize(X: np.ndarray, means: list, stds: list) -> np.ndarray:
    m = np.array(means, dtype=np.float32)
    s = np.array(stds,  dtype=np.float32)
    return ((X - m) / s).astype(np.float32)


def l2_normalize(X: np.ndarray) -> np.ndarray:
    """Unit-normalise rows so that dot-product == cosine similarity."""
    norms = np.linalg.norm(X, axis=1, keepdims=True)
    norms = np.where(norms == 0, 1.0, norms)
    return (X / norms).astype(np.float32)


def build_cosine_matrix(X_normalised: np.ndarray, output_dir: Path, model_name: str) -> str:
    """Save the embedding matrix as .npy. Returns relative file name."""
    embeddings = l2_normalize(X_normalised)
    npy_file = output_dir / f"{model_name}.embeddings.npy"
    np.save(str(npy_file), embeddings)
    return npy_file.name


def build_faiss_index(
    X_normalised: np.ndarray,
    entity_ids: list,
    output_dir: Path,
    model_name: str,
) -> tuple:
    """Build a FAISS IVF index. Returns (faiss_file_name, ids_file_name)."""
    try:
        import faiss
    except ImportError:
        raise RuntimeError(
            "faiss-cpu is required for large similarity datasets. "
            "Install it with: pip install faiss-cpu==1.8.0"
        )

    embeddings = l2_normalize(X_normalised)
    dim = embeddings.shape[1]
    n = embeddings.shape[0]

    # Rule-of-thumb: sqrt(n) centroids, minimum 1, maximum 4096
    n_centroids = max(1, min(4096, int(n ** 0.5)))

    quantiser = faiss.IndexFlatIP(dim)  # inner-product after L2-normalise == cosine
    index = faiss.IndexIVFFlat(quantiser, dim, n_centroids, faiss.METRIC_INNER_PRODUCT)
    index.train(embeddings)
    index.add(embeddings)
    index.nprobe = max(1, n_centroids // 8)  # search 12.5% of centroids by default

    faiss_file = output_dir / f"{model_name}.faiss"
    faiss.write_index(index, str(faiss_file))

    ids_file = output_dir / f"{model_name}.ids.json"
    with open(ids_file, "w") as f:
        json.dump(entity_ids, f)

    return faiss_file.name, ids_file.name


def main() -> None:
    parser = argparse.ArgumentParser(description="ScheML similarity training backend")
    parser.add_argument("--dataset",    required=True,  help="Path to the .dataset.json file")
    parser.add_argument("--output",     required=True,  help="Output directory for artifacts")
    parser.add_argument("--model-name", required=True,  dest="model_name", help="Trait name")
    parser.add_argument("--strategy",   default="auto",
                        choices=["auto", "cosine_matrix", "faiss_ivf"],
                        help="Index strategy. 'auto' selects based on entity count.")
    args = parser.parse_args()

    dataset = load_dataset(args.dataset)
    validate_dataset(dataset)

    X_train     = np.array(dataset["X_train"], dtype=np.float32)
    feature_names: list = dataset["feature_names"]
    entity_ids: list    = dataset["entity_ids"]

    n_entities = X_train.shape[0]
    means, stds = compute_normalization(X_train)
    X_normalised = normalize(X_train, means, stds)

    output_dir = Path(args.output)
    output_dir.mkdir(parents=True, exist_ok=True)

    strategy = args.strategy
    if strategy == "auto":
        strategy = "faiss_ivf" if n_entities >= FAISS_THRESHOLD else "cosine_matrix"

    if strategy == "cosine_matrix":
        index_file = build_cosine_matrix(X_normalised, output_dir, args.model_name)
        ids_file   = None
    else:
        index_file, ids_file = build_faiss_index(
            X_normalised, entity_ids, output_dir, args.model_name
        )

    # Clean up temp dataset file
    try:
        os.remove(args.dataset)
    except OSError:
        pass

    result = {
        "strategy": strategy,
        "entityCount": n_entities,
        "embeddingDim": X_normalised.shape[1],
        "featureNames": feature_names,
        "indexFile": index_file,
        "idsFile": ids_file,
        "normalization": {"means": means, "stds": stds},
    }
    if strategy == "cosine_matrix":
        # For small datasets, embed the entity IDs directly in metadata
        result["entityIds"] = entity_ids

    print(json.dumps(result))


if __name__ == "__main__":
    main()
