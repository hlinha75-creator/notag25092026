"""OCR and inventory numbered Albion season screenshots.

The script keeps raw OCR tokens in a temporary cache so later extraction and
manual review can be repeated without running the OCR model again.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

from rapidocr_onnxruntime import RapidOCR


CACHE_ROOT = Path.home() / "AppData" / "Local" / "Temp" / "codex-notag-season33-final-ocr"


def screenshot_number(path: Path) -> int:
    match = re.search(r"(\d+)$", path.stem)
    return int(match.group(1)) if match else 10**9


def box_center(box):
    return (
        sum(point[0] for point in box) / len(box),
        sum(point[1] for point in box) / len(box),
    )


def load_or_run_ocr(engine: RapidOCR, image_path: Path) -> list[dict]:
    CACHE_ROOT.mkdir(parents=True, exist_ok=True)
    cached_path = CACHE_ROOT / f"{image_path.stem}.json"
    if cached_path.exists():
        return json.loads(cached_path.read_text(encoding="utf-8"))

    result, _ = engine(str(image_path))
    tokens = []
    for box, text, score in result or []:
        x, y = box_center(box)
        tokens.append(
            {
                "x": round(x, 2),
                "y": round(y, 2),
                "text": text.strip(),
                "score": round(float(score), 6),
            }
        )
    cached_path.write_text(
        json.dumps(tokens, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    return tokens


def summarize(tokens: list[dict]) -> str:
    visible = [token["text"] for token in tokens if token["text"]]
    header = visible[:18]
    return " | ".join(header)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("folder", type=Path)
    args = parser.parse_args()

    images = sorted(args.folder.glob("Screenshot_*.png"), key=screenshot_number)
    if not images:
        raise SystemExit(f"No numbered screenshots found in {args.folder}")

    engine = RapidOCR()
    inventory = []
    for index, image_path in enumerate(images, start=1):
        print(f"[{index}/{len(images)}] {image_path.name}", file=sys.stderr, flush=True)
        tokens = load_or_run_ocr(engine, image_path)
        inventory.append(
            {
                "file": image_path.name,
                "tokenCount": len(tokens),
                "summary": summarize(tokens),
            }
        )

    output_path = CACHE_ROOT / "inventory.json"
    output_path.write_text(
        json.dumps(inventory, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(json.dumps({"images": len(images), "inventory": str(output_path)}, ensure_ascii=False))


if __name__ == "__main__":
    main()
