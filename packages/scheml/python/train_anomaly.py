#!/usr/bin/env python3
"""
ScheML Anomaly Training Backend
Isolation Forest (scikit-learn) for dataset-level anomaly scoring.

Input:  JSON dataset written by train.ts, same structure as train.py datasets
Output: JSON response with the artifact metadata path

The trained model is serialised with joblib and embedded as base64 in the
metadata JSON so the artifact is self-contained (no separate binary file).
"""

import argparse
import base64
import io
import json
import os
import sys
from pathlib import Path

import joblib
import numpy as np
from sklearn.ensemble import IsolationForest


def load_dataset(dataset_path: str) -> dict:
    with open(dataset_path, "r") as f:
        return json.load(f)


def validate_dataset(dataset: dict) -> None:
    required = {"X_train", "feature_names"}
    missing = required - set(dataset.keys())
    if missing:
        raise ValueError(f"Dataset missing required keys: {missing}")


def compute_normalization(X: np.ndarray) -> tuple:
    """Compute per-feature mean and std for inference-time normalisation."""
    means = np.mean(X, axis=0).tolist()
    stds  = np.std(X,  axis=0).tolist()
    # Replace zero stds with 1 to avoid division by zero
    stds = [s if s > 0 else 1.0 for s in stds]
    return means, stds


def normalize(X: np.ndarray, means: list, stds: list) -> np.ndarray:
    means_arr = np.array(means, dtype=np.float32)
    stds_arr  = np.array(stds,  dtype=np.float32)
    return (X - means_arr) / stds_arr


def train_isolation_forest(
    X_train: np.ndarray,
    contamination: float,
    n_estimators: int,
    random_state: int,
) -> IsolationForest:
    model = IsolationForest(
        n_estimators=n_estimators,
        contamination=contamination,
        random_state=random_state,
        bootstrap=False,
        n_jobs=-1,
    )
    model.fit(X_train)
    return model


def compute_threshold(model: IsolationForest, X_train: np.ndarray) -> float:
    """
    Convert sklearn's raw decision_function scores into a [0,1] anomaly score
    and return the threshold at the `contamination` percentile.

    decision_function returns negative values for anomalies and values near 0
    for inliers. We flip the sign and min-max normalise to [0, 1].
    """
    raw_scores = model.decision_function(X_train)
    # Flip: higher → more anomalous
    scores = -raw_scores
    min_s, max_s = scores.min(), scores.max()
    if max_s > min_s:
        scores_normalised = (scores - min_s) / (max_s - min_s)
    else:
        scores_normalised = np.zeros_like(scores)

    # threshold at the (1 - contamination) percentile of normalised scores
    threshold = float(np.percentile(scores_normalised, (1.0 - model.contamination) * 100))
    return max(0.0, min(1.0, threshold))


def serialize_model(model: IsolationForest) -> str:
    """Serialise the fitted model to a base64-encoded joblib string."""
    buf = io.BytesIO()
    joblib.dump(model, buf, compress=3)
    return base64.b64encode(buf.getvalue()).decode("ascii")


def main() -> None:
    parser = argparse.ArgumentParser(description="ScheML anomaly training backend")
    parser.add_argument("--dataset",     required=True,  help="Path to the .dataset.json file")
    parser.add_argument("--output",      required=True,  help="Output directory for artifacts")
    parser.add_argument("--model-name",  required=True,  dest="model_name", help="Trait name")
    parser.add_argument("--contamination", type=float, default=0.1,
                        help="Expected fraction of anomalies (0 < contamination < 0.5)")
    parser.add_argument("--n-estimators", type=int, default=100, dest="n_estimators")
    parser.add_argument("--random-state", type=int, default=42, dest="random_state")
    args = parser.parse_args()

    dataset = load_dataset(args.dataset)
    validate_dataset(dataset)

    X_train = np.array(dataset["X_train"], dtype=np.float32)
    feature_names: list = dataset["feature_names"]

    if X_train.ndim != 2 or X_train.shape[1] != len(feature_names):
        raise ValueError(
            f"Feature count mismatch: X_train has {X_train.shape[1]} columns "
            f"but feature_names has {len(feature_names)} entries."
        )

    # Normalise before fitting so that the Isolation Forest operates on
    # unit-variance features, which improves score calibration.
    means, stds = compute_normalization(X_train)
    X_normalised = normalize(X_train, means, stds)

    model = train_isolation_forest(
        X_normalised,
        contamination=args.contamination,
        n_estimators=args.n_estimators,
        random_state=args.random_state,
    )

    threshold = compute_threshold(model, X_normalised)
    model_base64 = serialize_model(model)

    # Write the .dataset.json cleanup (it was a temp file)
    output_dir = Path(args.output)
    output_dir.mkdir(parents=True, exist_ok=True)

    # Clean up dataset temp file
    try:
        os.remove(args.dataset)
    except OSError:
        pass

    result = {
        "modelBase64": model_base64,
        "featureCount": len(feature_names),
        "featureNames": feature_names,
        "contamination": args.contamination,
        "threshold": threshold,
        "normalization": {"means": means, "stds": stds},
    }

    # Write to stdout for train.ts to parse
    print(json.dumps(result))


if __name__ == "__main__":
    main()
