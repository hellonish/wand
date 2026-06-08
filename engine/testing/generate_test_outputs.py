"""Generate JSON test outputs for manual verification of all engine modules.

.. deprecated:: 1.0
   This is a thin wrapper around `generate_review_outputs.py` and is kept for backwards compatibility.
"""

from pathlib import Path
from typing import Any, List, Optional

from engine.testing.generate_review_outputs import write_review_outputs

TEST_OUTPUT_DIR = Path(__file__).resolve().parents[1] / "test_outputs"


def write_test_outputs(
    output_dir: Path = TEST_OUTPUT_DIR,
    model: Optional[str] = None,
    llm: Any = None,
    features: Optional[List[str]] = None,
) -> List[Path]:
    """Generate JSON fixture outputs for manual verification."""

    return write_review_outputs(output_dir=output_dir, model=model, llm=llm, features=features)


if __name__ == "__main__":
    for written_path in write_test_outputs():
        print(written_path)
