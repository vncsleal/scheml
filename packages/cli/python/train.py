#!/usr/bin/env python3
"""
PrisML Python Training Backend
Real MVP implementation using scikit-learn + skl2onnx
"""

import argparse
import json
import sys
from pathlib import Path
from typing import Any, Dict, List, Tuple

import numpy as np
from sklearn.metrics import mean_squared_error, mean_absolute_error, r2_score
from sklearn.metrics import accuracy_score, precision_score, recall_score, f1_score
from sklearn.linear_model import LinearRegression, LogisticRegression
from sklearn.tree import DecisionTreeRegressor, DecisionTreeClassifier
from sklearn.ensemble import RandomForestRegressor, RandomForestClassifier
from sklearn.ensemble import GradientBoostingRegressor, GradientBoostingClassifier
from skl2onnx import convert_sklearn
from skl2onnx.common.data_types import FloatTensorType


def camel_to_snake(name: str) -> str:
    """Convert camelCase to snake_case"""
    import re
    name = re.sub('(.)([A-Z][a-z]+)', r'\1_\2', name)
    return re.sub('([a-z0-9])([A-Z])', r'\1_\2', name).lower()


def load_dataset(path: str) -> Dict[str, Any]:
    with open(path, "r", encoding="utf-8") as handle:
        return json.load(handle)


def build_model(task_type: str, algorithm: str, hyperparameters: Dict[str, Any]):
    # Convert camelCase keys to snake_case for sklearn
    sklearn_params = {camel_to_snake(k): v for k, v in hyperparameters.items()}
    
    algorithm = algorithm.lower()
    if task_type == "regression":
        if algorithm == "linear":
            return LinearRegression(**sklearn_params)
        if algorithm == "tree":
            return DecisionTreeRegressor(**sklearn_params)
        if algorithm == "forest":
            return RandomForestRegressor(**sklearn_params)
        if algorithm == "gbm":
            return GradientBoostingRegressor(**sklearn_params)
    else:
        if algorithm == "linear":
            return LogisticRegression(max_iter=1000, **sklearn_params)
        if algorithm == "tree":
            return DecisionTreeClassifier(**sklearn_params)
        if algorithm == "forest":
            return RandomForestClassifier(**sklearn_params)
        if algorithm == "gbm":
            return GradientBoostingClassifier(**sklearn_params)

    raise ValueError(f"Unsupported algorithm '{algorithm}' for task '{task_type}'")


def compute_metrics(task_type: str, y_true: List[Any], y_pred: List[Any]) -> List[Dict[str, Any]]:
    if task_type == "regression":
        mse = mean_squared_error(y_true, y_pred)
        rmse = np.sqrt(mse)
        mae = mean_absolute_error(y_true, y_pred)
        r2 = r2_score(y_true, y_pred)
        return [
            {"metric": "rmse", "value": float(rmse), "split": "test"},
            {"metric": "mae", "value": float(mae), "split": "test"},
            {"metric": "r2", "value": float(r2), "split": "test"},
        ]

    average = "binary" if len(set(y_true)) <= 2 else "weighted"
    accuracy = accuracy_score(y_true, y_pred)
    precision = precision_score(y_true, y_pred, average=average, zero_division=0)
    recall = recall_score(y_true, y_pred, average=average, zero_division=0)
    f1 = f1_score(y_true, y_pred, average=average, zero_division=0)

    return [
        {"metric": "accuracy", "value": float(accuracy), "split": "test"},
        {"metric": "precision", "value": float(precision), "split": "test"},
        {"metric": "recall", "value": float(recall), "split": "test"},
        {"metric": "f1", "value": float(f1), "split": "test"},
    ]


def export_onnx(model, num_features: int, output_path: Path) -> str:
    initial_type = [("input", FloatTensorType([None, num_features]))]
    onnx_model = convert_sklearn(model, initial_types=initial_type)
    output_path.write_bytes(onnx_model.SerializeToString())
    return str(output_path)


def main() -> None:
    parser = argparse.ArgumentParser(description="PrisML training backend")
    parser.add_argument("--dataset", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--model-name", required=True)
    args = parser.parse_args()

    dataset = load_dataset(args.dataset)

    X_train = np.array(dataset["X_train"], dtype=np.float32)
    y_train = np.array(dataset["y_train"])
    X_test = np.array(dataset["X_test"], dtype=np.float32)
    y_test = np.array(dataset["y_test"])
    task_type = dataset["taskType"]
    algorithm = dataset["algorithm"]
    hyperparameters = dataset.get("hyperparameters") or {}

    model = build_model(task_type, algorithm, hyperparameters)
    model.fit(X_train, y_train)

    y_pred = model.predict(X_test)

    metrics = compute_metrics(task_type, y_test.tolist(), y_pred.tolist())

    output_dir = Path(args.output)
    output_dir.mkdir(parents=True, exist_ok=True)
    onnx_path = output_dir / f"{args.model_name}.onnx"
    export_onnx(model, X_train.shape[1], onnx_path)

    response = {
        "metrics": metrics,
        "onnxPath": str(onnx_path),
    }

    print(json.dumps(response))


if __name__ == "__main__":
    main()
