import json
import sys
import tempfile
from pathlib import Path


PYTHON_DIR = Path(__file__).resolve().parents[2] / "python"
if str(PYTHON_DIR) not in sys.path:
    sys.path.insert(0, str(PYTHON_DIR))


from dataset_contract import load_dataset, validate_dataset


def _write_dataset(payload):
    tmp = tempfile.NamedTemporaryFile("w", suffix=".json", delete=False)
    json.dump(payload, tmp)
    tmp.close()
    return Path(tmp.name)


def test_validate_dataset_rejects_mismatched_feature_width():
    path = _write_dataset(
        {
            "X_train": [[1.0, 2.0], [3.0]],
            "y_train": [0, 1],
            "X_test": [[4.0, 5.0]],
            "y_test": [1],
            "taskType": "binary_classification",
        }
    )
    try:
        dataset = load_dataset(str(path))
        validate_dataset(dataset)
        raise AssertionError("validate_dataset() should have raised")
    except ValueError as exc:
        assert "X_train rows must all have the same feature width" in str(exc)
    finally:
        path.unlink(missing_ok=True)


def test_validate_dataset_rejects_non_list_rows():
    path = _write_dataset(
        {
            "X_train": [1.0, 2.0],
            "y_train": [0, 1],
            "X_test": [[4.0, 5.0]],
            "y_test": [1],
            "taskType": "binary_classification",
        }
    )

    try:
        dataset = load_dataset(str(path))
        validate_dataset(dataset)
        raise AssertionError("validate_dataset() should have raised")
    except ValueError as exc:
        assert "X_train must be a list of lists" in str(exc)
    finally:
        path.unlink(missing_ok=True)


if __name__ == "__main__":
    test_validate_dataset_rejects_mismatched_feature_width()
    test_validate_dataset_rejects_non_list_rows()