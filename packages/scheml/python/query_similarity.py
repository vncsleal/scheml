#!/usr/bin/env python3
"""
ScheML Similarity Query Helper

Loads a FAISS similarity artifact written by train_similarity.py and executes
nearest-neighbour lookup for one query vector. This is used at runtime for
large-dataset similarity traits where the artifact format is `.faiss`.
"""

import argparse
import json
from pathlib import Path


def main() -> None:
    parser = argparse.ArgumentParser(description="ScheML similarity FAISS query helper")
    parser.add_argument("--metadata", required=True, help="Path to the similarity metadata JSON")
    parser.add_argument("--query", required=True, help="JSON array containing the normalized query vector")
    parser.add_argument("--k", required=True, type=int, help="Number of neighbors to return")
    args = parser.parse_args()

    try:
        import faiss
        import numpy as np
    except ImportError as exc:
        raise RuntimeError(
            "faiss-cpu and numpy are required for FAISS similarity inference"
        ) from exc

    metadata_path = Path(args.metadata)
    with open(metadata_path, "r") as handle:
      metadata = json.load(handle)

    index_path = metadata_path.parent / metadata["indexFile"]
    ids_path = metadata_path.parent / metadata["entityIdsFile"]

    with open(ids_path, "r") as handle:
        entity_ids = json.load(handle)

    query_vector = np.array(json.loads(args.query), dtype=np.float32).reshape(1, -1)
    index = faiss.read_index(str(index_path))
    scores, indices = index.search(query_vector, args.k)

    matches = []
    for rank, (score, idx) in enumerate(zip(scores[0], indices[0]), start=1):
        if idx < 0:
            continue
        matches.append(
            {
                "entityId": entity_ids[idx],
                "score": float(score),
                "rank": rank,
            }
        )

    print(json.dumps({"matches": matches}))


if __name__ == "__main__":
    main()