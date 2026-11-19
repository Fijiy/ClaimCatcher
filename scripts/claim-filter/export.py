"""Exports the claim filter (sachaljawad/claimbuster-detector, DistilBERT) to
ONNX and quantizes it to 8 bits (per channel), in the layout Transformers.js loads:

    <out>/config.json, tokenizer.json, tokenizer_config.json, special_tokens_map.json
    <out>/onnx/model_quantized.onnx

Run by scripts/models.ts inside its pinned venv:
    python export.py <out-dir> <hf-revision>
"""

import shutil
import sys
import tempfile
from pathlib import Path

from onnxruntime.quantization import QuantType, quantize_dynamic
from optimum.exporters.onnx import main_export

MODEL_ID = "sachaljawad/claimbuster-detector"
JSON_FILES = ["config.json", "tokenizer.json", "tokenizer_config.json", "special_tokens_map.json"]


def main(out_dir: str, revision: str) -> None:
    out = Path(out_dir)
    with tempfile.TemporaryDirectory() as tmp:
        main_export(MODEL_ID, output=tmp, task="text-classification", revision=revision)
        (out / "onnx").mkdir(parents=True, exist_ok=True)
        # Int8 weights (there is no Conv), dynamic uint8 activations, as in
        # Transformers.js's own q8 quantization, except that each weight
        # matrix gets a scale per output channel instead of one for the
        # whole matrix. With one scale, ORT-web's WASM runtime scored rated
        # claims lower than the full-precision model and no threshold met
        # the quality gate's bar (#41); per channel it does, at the same size.
        quantize_dynamic(
            str(Path(tmp) / "model.onnx"),
            str(out / "onnx" / "model_quantized.onnx"),
            weight_type=QuantType.QInt8,
            per_channel=True,
            reduce_range=False,
            extra_options={"EnableSubgraph": True, "MatMulConstBOnly": True},
        )
        for name in JSON_FILES:
            shutil.copyfile(Path(tmp) / name, out / name)


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
