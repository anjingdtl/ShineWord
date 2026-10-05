#!/usr/bin/env python3
"""Split the four avatar sprite sheets into 40 WebP presets (plan §3.1).

One-off developer-machine tool — the app build never depends on it. Input is
four 1983x793 sheets (5 columns x 2 rows: top row male, bottom row female,
column = job slot 1..5) under --src; output is
mobile/src/assets/avatars/{theme}_{gender}_{slot}.webp at 320x320.

Usage:
    python tools/avatars/split_avatar_sheets.py [--src DIR] [--out DIR] [--png]

The uniform grid plus an 8px inset per side clears the measured separator
bands (x ~395-401 / 791-797 / 1187-1193 / 1583-1589, y ~391-400, i.e. within
+/-4px of the ideal cell boundaries).
"""
from __future__ import annotations

import argparse
from pathlib import Path

from PIL import Image

# Sheet filename -> theme id (plan §2 mapping table).
SHEETS = {
    "东方武侠.png": "ink",
    "欧洲风格.png": "fantasy",
    "日系二次元.png": "manga",
    "赛博科幻.png": "scifi",
}

COLS, ROWS = 5, 2
INSET_PX = 8
OUT_SIZE = 320
WEBP_QUALITY = 88


def split_sheet(path: Path, theme: str, out_dir: Path, fmt: str) -> list[Path]:
    sheet = Image.open(path).convert("RGB")
    width, height = sheet.size
    cell_w, cell_h = width / COLS, height / ROWS
    written: list[Path] = []
    for row in range(ROWS):  # 0 = top = male (m), 1 = bottom = female (f)
        gender = "m" if row == 0 else "f"
        for col in range(COLS):  # 0-based column -> job slot 1..5
            slot = col + 1
            box = (
                round(col * cell_w + INSET_PX),
                round(row * cell_h + INSET_PX),
                round((col + 1) * cell_w - INSET_PX),
                round((row + 1) * cell_h - INSET_PX),
            )
            tile = sheet.crop(box).resize((OUT_SIZE, OUT_SIZE), Image.LANCZOS)
            name = f"{theme}_{gender}_{slot}.{fmt}"
            target = out_dir / name
            if fmt == "png":
                tile.save(target, format="PNG", optimize=True)
            else:
                tile.save(target, format="WEBP", quality=WEBP_QUALITY, method=6)
            written.append(target)
    return written


def main() -> int:
    repo_root = Path(__file__).resolve().parents[2]
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--src", type=Path, default=Path(r"C:\Users\Administrator\Pictures\png"),
                        help="directory holding the four sprite sheets")
    parser.add_argument("--out", type=Path, default=repo_root / "mobile" / "src" / "assets" / "avatars",
                        help="output directory for the 40 tiles")
    parser.add_argument("--png", action="store_true",
                        help="emit PNG instead of WebP (fallback only: ~8 MB total)")
    args = parser.parse_args()

    fmt = "png" if args.png else "webp"
    args.out.mkdir(parents=True, exist_ok=True)

    total = 0
    for filename, theme in SHEETS.items():
        source = args.src / filename
        if not source.is_file():
            raise SystemExit(f"missing sheet: {source}")
        written = split_sheet(source, theme, args.out, fmt)
        size = sum(w.stat().st_size for w in written)
        total += size
        print(f"{filename} -> {theme}: {len(written)} tiles, {size / 1024:.0f} KB")
    print(f"total: {len(SHEETS) * COLS * ROWS} tiles, {total / 1024:.0f} KB")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
