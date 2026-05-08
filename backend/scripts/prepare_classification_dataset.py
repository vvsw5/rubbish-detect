from __future__ import annotations

import random
import shutil
from pathlib import Path


BASE_DIR = Path(__file__).resolve().parents[1]
SOURCE_DIR = BASE_DIR / "data"
OUTPUT_DIR = BASE_DIR / "dataset_classify"
IMAGE_SUFFIXES = {".jpg", ".jpeg", ".png", ".webp"}
TRAIN_RATIO = 0.8
SEED = 2026

CLASS_NAME_MAP = {
    "battery": "battery",
    "can": "can",
    "carton": "carton",
    "cigarette butt": "cigarette_butt",
    "expired medicine": "expired_medicine",
    "glass bottle": "glass_bottle",
    "plastic": "plastic",
    "plastic bottle": "plastic_bottle",
    "shoes": "shoes",
    "vegetable leaf": "vegetable_leaf",
}


def collect_images(class_dir: Path) -> list[Path]:
    return sorted(
        path for path in class_dir.iterdir() if path.is_file() and path.suffix.lower() in IMAGE_SUFFIXES
    )


def reset_output_dir(output_dir: Path) -> None:
    if output_dir.exists():
        shutil.rmtree(output_dir)
    (output_dir / "train").mkdir(parents=True, exist_ok=True)
    (output_dir / "val").mkdir(parents=True, exist_ok=True)


def split_images(images: list[Path]) -> tuple[list[Path], list[Path]]:
    shuffled = images[:]
    random.Random(SEED).shuffle(shuffled)
    train_count = max(1, int(len(shuffled) * TRAIN_RATIO))
    if train_count >= len(shuffled):
        train_count = max(1, len(shuffled) - 1)
    return shuffled[:train_count], shuffled[train_count:]


def copy_split(images: list[Path], target_dir: Path) -> None:
    target_dir.mkdir(parents=True, exist_ok=True)
    for image_path in images:
        shutil.copy2(image_path, target_dir / image_path.name)


def main() -> None:
    if not SOURCE_DIR.exists():
        raise SystemExit(f"源数据目录不存在: {SOURCE_DIR}")

    reset_output_dir(OUTPUT_DIR)
    summary_lines: list[str] = []

    for source_name, target_name in CLASS_NAME_MAP.items():
        class_dir = SOURCE_DIR / source_name
        if not class_dir.exists():
            summary_lines.append(f"[skip] {source_name} -> 未找到目录")
            continue

        images = collect_images(class_dir)
        if len(images) < 2:
            summary_lines.append(f"[skip] {source_name} -> 图片数量不足 2 张")
            continue

        train_images, val_images = split_images(images)
        copy_split(train_images, OUTPUT_DIR / "train" / target_name)
        copy_split(val_images, OUTPUT_DIR / "val" / target_name)
        summary_lines.append(
            f"[ok] {source_name} -> {target_name} | train={len(train_images)} val={len(val_images)}"
        )

    summary_path = OUTPUT_DIR / "split_summary.txt"
    summary_path.write_text("\n".join(summary_lines), encoding="utf-8")
    print(f"dataset prepared at: {OUTPUT_DIR}")
    print(summary_path.read_text(encoding='utf-8'))


if __name__ == "__main__":
    main()
