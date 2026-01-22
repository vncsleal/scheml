#!/usr/bin/env python3
"""
PrisML Python Training Script

This script receives feature data from the TypeScript CLI and trains
scikit-learn or XGBoost models, exporting them to ONNX format.

Input: JSON file with extracted features and labels
Output: ONNX model file for Node.js inference

Usage:
    python scripts/train.py --input data.json --output model.onnx --algorithm RandomForest
"""

import argparse
import json
import sys
from pathlib import Path
from typing import Dict, List, Tuple

import numpy as np
from sklearn.ensemble import RandomForestClassifier, RandomForestRegressor
from sklearn.linear_model import LogisticRegression
from sklearn.tree import DecisionTreeClassifier
from sklearn.model_selection import train_test_split
from sklearn.metrics import accuracy_score, mean_squared_error, r2_score
from skl2onnx import convert_sklearn
from skl2onnx.common.data_types import FloatTensorType


def load_training_data(input_path: str) -> Tuple[np.ndarray, np.ndarray, Dict]:
    """
    Load feature matrix and labels from JSON file.
    
    Expected format:
    {
        "features": [[1.0, 2.0, 3.0], ...],  # Feature matrix
        "labels": [0, 1, 0, ...],             # Target values
        "metadata": {
            "model_name": "churnPredictor",
            "feature_names": ["age", "totalSpent", "isActive"],
            "task_type": "classification"     # or "regression"
        }
    }
    """
    with open(input_path, 'r') as f:
        data = json.load(f)
    
    X = np.array(data['features'], dtype=np.float32)
    y = np.array(data['labels'])
    metadata = data.get('metadata', {})
    
    print(f"✓ Loaded {X.shape[0]} samples with {X.shape[1]} features")
    print(f"  Task: {metadata.get('task_type', 'classification')}")
    
    return X, y, metadata


def create_model(algorithm: str, task_type: str):
    """
    Create scikit-learn model based on algorithm and task type.
    """
    if task_type == 'regression':
        models = {
            'RandomForest': RandomForestRegressor(n_estimators=100, random_state=42, max_depth=10),
            'DecisionTree': DecisionTreeClassifier(random_state=42, max_depth=10),
        }
    else:  # classification
        models = {
            'RandomForest': RandomForestClassifier(n_estimators=100, random_state=42, max_depth=10),
            'LogisticRegression': LogisticRegression(random_state=42, max_iter=1000),
            'DecisionTree': DecisionTreeClassifier(random_state=42, max_depth=10),
        }
    
    if algorithm not in models:
        raise ValueError(f"Unsupported algorithm: {algorithm}. Choose from {list(models.keys())}")
    
    return models[algorithm]


def train_and_evaluate(
    X: np.ndarray,
    y: np.ndarray,
    algorithm: str,
    task_type: str,
    test_split: float = 0.2,
    min_accuracy: float = 0.7
) -> Tuple[object, Dict]:
    """
    Train model and evaluate performance.
    """
    # Split data
    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=test_split, random_state=42
    )
    
    print(f"  Train: {len(X_train)} samples | Test: {len(X_test)} samples")
    
    # Create and train model
    model = create_model(algorithm, task_type)
    print(f"  Training {algorithm} ({task_type})...")
    
    model.fit(X_train, y_train)
    
    # Evaluate
    y_pred = model.predict(X_test)
    
    metrics = {}
    if task_type == 'regression':
        mse = mean_squared_error(y_test, y_pred)
        r2 = r2_score(y_test, y_pred)
        metrics = {'mse': float(mse), 'r2': float(r2)}
        print(f"  ✓ MSE: {mse:.4f} | R²: {r2:.4f}")
        
        # For regression, treat R² as "accuracy"
        if r2 < min_accuracy:
            raise ValueError(f"Training failed: R² {r2:.4f} < threshold {min_accuracy}")
    else:
        accuracy = accuracy_score(y_test, y_pred)
        metrics = {'accuracy': float(accuracy)}
        print(f"  ✓ Accuracy: {accuracy * 100:.2f}%")
        
        if accuracy < min_accuracy:
            raise ValueError(f"Training failed: Accuracy {accuracy:.4f} < threshold {min_accuracy}")
    
    return model, metrics


def export_to_onnx(
    model,
    output_path: str,
    feature_names: List[str],
    metadata: Dict,
    task_type: str = 'classification'
):
    """
    Convert scikit-learn model to ONNX format.
    """
    num_features = len(feature_names)
    
    # Define input type for ONNX
    initial_type = [('input', FloatTensorType([None, num_features]))]
    
    # Determine ONNX conversion options based on task type
    onnx_options = None
    if task_type == 'classification':
        # For classifiers, disable zipmap for cleaner output
        onnx_options = {id(model): {'zipmap': False}}
    
    # Convert to ONNX
    onnx_model = convert_sklearn(
        model,
        initial_types=initial_type,
        target_opset=12,
        options=onnx_options
    )
    
    # Save ONNX model
    with open(output_path, 'wb') as f:
        f.write(onnx_model.SerializeToString())
    
    print(f"✓ ONNX model exported to: {output_path}")
    
    # Save metadata alongside
    metadata_path = output_path.replace('.onnx', '.metadata.json')
    with open(metadata_path, 'w') as f:
        json.dump(metadata, f, indent=2)
    
    print(f"  Metadata saved to: {metadata_path}")


def main():
    parser = argparse.ArgumentParser(description='Train ML model and export to ONNX')
    parser.add_argument('--input', required=True, help='Input JSON file with features and labels')
    parser.add_argument('--output', required=True, help='Output ONNX file path')
    parser.add_argument('--algorithm', default='RandomForest', 
                        help='Algorithm: RandomForest, LogisticRegression, DecisionTree')
    parser.add_argument('--test-split', type=float, default=0.2,
                        help='Test split ratio (default: 0.2)')
    parser.add_argument('--min-accuracy', type=float, default=0.7,
                        help='Minimum required accuracy (default: 0.7)')
    
    args = parser.parse_args()
    
    print(f"🤖 PrisML Training Pipeline")
    print(f"   Input: {args.input}")
    print(f"   Algorithm: {args.algorithm}")
    print(f"   Min Accuracy: {args.min_accuracy}")
    print()
    
    try:
        # 1. Load data
        X, y, metadata = load_training_data(args.input)
        task_type = metadata.get('task_type', 'classification')
        feature_names = metadata.get('feature_names', [f'f{i}' for i in range(X.shape[1])])
        
        # 2. Train and evaluate
        model, metrics = train_and_evaluate(
            X, y,
            algorithm=args.algorithm,
            task_type=task_type,
            test_split=args.test_split,
            min_accuracy=args.min_accuracy
        )
        
        # 3. Export to ONNX
        export_metadata = {
            **metadata,
            'algorithm': args.algorithm,
            'metrics': metrics,
            'trained_at': None  # Will be set by TypeScript
        }
        
        export_to_onnx(model, args.output, feature_names, export_metadata, task_type)
        
        print()
        print(" Training complete!")
        
        # Return success with metrics
        sys.exit(0)
        
    except Exception as e:
        print(f"\n Training failed: {str(e)}", file=sys.stderr)
        sys.exit(1)


if __name__ == '__main__':
    main()
