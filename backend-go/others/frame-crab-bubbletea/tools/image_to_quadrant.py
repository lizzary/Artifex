#!/usr/bin/env python3
"""Convert an image into ANSI true-color terminal pixel art for Bubble Tea.

The source image is reduced to a color-indexed logical pixel canvas and packed
into Unicode quadrant, half-block, three-quarter-block and full-block glyphs.

By default, every logical column is duplicated before 2x2 quadrant packing.
This compensates for the usual terminal cell aspect ratio: a terminal cell is
roughly twice as tall as it is wide.

For the Frame Crab mascot, the script can also redraw terminal-safe details
after silhouette extraction:

* two separate 2x2-logical-pixel black eyes;
* a lavender picture area inside the purple frame;
* a stepped purple mountain and a small purple square inside the picture.

Enclosed transparent holes are filled, so blank cells occur only outside the
sprite silhouette.

Dependency:
    python -m pip install Pillow

Example:
    python image_to_quadrant.py input.png \\
        --format go \\
        --package main \\
        --name FrameCrab \\
        --output frame_crab.go
"""

from __future__ import annotations

import argparse
import re
import sys
from collections import Counter, deque
from pathlib import Path
from typing import Iterable, Sequence

from PIL import Image

# Exact opaque palette requested for Frame Crab.
PALETTE: tuple[tuple[int, int, int], ...] = (
    (0x7C, 0x5C, 0xE0),  # 0: picture-frame purple
    (0xBD, 0xB2, 0xF2),  # 1: picture interior lavender
    (0xC7, 0x6F, 0x3E),  # 2: crab orange
    (0x18, 0x18, 0x1B),  # 3: eyes / facial details
)
TRANSPARENT = -1

FRAME_PURPLE = 0
PICTURE_LAVENDER = 1
CRAB_ORANGE = 2
DETAIL_BLACK = 3

# Bit order: TL=1, TR=2, BL=4, BR=8.
# Disconnected diagonal glyphs ▚ and ▞ are deliberately excluded.
MASK_TO_CHAR: dict[int, str] = {
    0x0: " ",
    0x1: "▘",
    0x2: "▝",
    0x3: "▀",
    0x4: "▖",
    0x5: "▌",
    0x7: "▛",
    0x8: "▗",
    0xA: "▐",
    0xB: "▜",
    0xC: "▄",
    0xD: "▙",
    0xE: "▟",
    0xF: "█",
}


def color_distance_sq(a: Sequence[int], b: Sequence[int]) -> int:
    return sum((int(x) - int(y)) ** 2 for x, y in zip(a[:3], b[:3]))


def nearest_palette_index(rgb: Sequence[int]) -> int:
    return min(
        range(len(PALETTE)),
        key=lambda i: color_distance_sq(rgb, PALETTE[i]),
    )


def border_background_colors(
    image: Image.Image,
    max_colors: int = 6,
) -> list[tuple[int, int, int]]:
    """Infer flat/checkerboard background colors from the outer border."""
    rgb = image.convert("RGB")
    w, h = rgb.size
    band = max(1, min(w, h) // 64)
    samples: list[tuple[int, int, int]] = []

    px = rgb.load()
    for y in range(band):
        for x in range(w):
            samples.append(px[x, y])
            samples.append(px[x, h - 1 - y])
    for x in range(band):
        for y in range(h):
            samples.append(px[x, y])
            samples.append(px[w - 1 - x, y])

    # Small quantization merges minor compression/noise variations.
    def bucket(c: tuple[int, int, int]) -> tuple[int, int, int]:
        return tuple(min(255, ((v + 2) // 4) * 4) for v in c)  # type: ignore[return-value]

    counts = Counter(bucket(c) for c in samples)
    return [c for c, _ in counts.most_common(max_colors)]


def extract_foreground(
    image: Image.Image,
    alpha_threshold: int,
    bg_tolerance: int,
) -> Image.Image:
    """Return RGBA with inferred checkerboard/flat background transparent."""
    rgba = image.convert("RGBA")
    w, h = rgba.size
    alpha = rgba.getchannel("A")
    alpha_min, _ = alpha.getextrema()
    has_real_alpha = alpha_min < 250

    if has_real_alpha:
        out = Image.new("RGBA", rgba.size, (0, 0, 0, 0))
        src = rgba.load()
        dst = out.load()
        for y in range(h):
            for x in range(w):
                r, g, b, a = src[x, y]
                if a >= alpha_threshold:
                    dst[x, y] = (
                        *PALETTE[nearest_palette_index((r, g, b))],
                        255,
                    )
        return out

    bg_colors = border_background_colors(rgba)
    tolerance_sq = bg_tolerance * bg_tolerance
    src = rgba.load()
    out = Image.new("RGBA", rgba.size, (0, 0, 0, 0))
    dst = out.load()

    for y in range(h):
        for x in range(w):
            r, g, b, _ = src[x, y]
            rgb = (r, g, b)
            d_bg = min(color_distance_sq(rgb, bg) for bg in bg_colors)
            palette_idx = nearest_palette_index(rgb)
            d_fg = color_distance_sq(rgb, PALETTE[palette_idx])

            # A pixel belongs to the sprite when it is clearly closer to the
            # requested palette than to the inferred border background.
            is_bg = d_bg <= tolerance_sq or d_bg <= d_fg
            if not is_bg:
                dst[x, y] = (*PALETTE[palette_idx], 255)

    return out


def even_fit(
    src_w: int,
    src_h: int,
    max_w: int,
    max_h: int,
) -> tuple[int, int]:
    scale = min(max_w / src_w, max_h / src_h)
    w = max(2, int(round(src_w * scale)))
    h = max(2, int(round(src_h * scale)))
    w = min(max_w, w)
    h = min(max_h, h)

    # Even dimensions keep major boundaries aligned to terminal 2x2 cells.
    if w % 2:
        w = w - 1 if w == max_w else w + 1
    if h % 2:
        h = h - 1 if h == max_h else h + 1
    return max(2, w), max(2, h)


def image_to_matrix(
    image: Image.Image,
    canvas_w: int,
    canvas_h: int,
    sprite_max_w: int,
    sprite_max_h: int,
) -> list[list[int]]:
    alpha = image.getchannel("A")
    bbox = alpha.getbbox()
    if bbox is None:
        raise ValueError(
            "No foreground pixels found. "
            "Adjust --bg-tolerance or --alpha-threshold."
        )

    crop = image.crop(bbox)
    target_w, target_h = even_fit(
        crop.width,
        crop.height,
        sprite_max_w,
        sprite_max_h,
    )
    crop = crop.resize((target_w, target_h), Image.Resampling.NEAREST)

    matrix = [
        [TRANSPARENT for _ in range(canvas_w)]
        for _ in range(canvas_h)
    ]

    # Use even offsets so 2x2 packing aligns with major color boundaries.
    x0 = (canvas_w - target_w) // 2
    y0 = (canvas_h - target_h) // 2
    x0 -= x0 % 2
    y0 -= y0 % 2

    px = crop.load()
    for y in range(target_h):
        for x in range(target_w):
            r, g, b, a = px[x, y]
            if a >= 128:
                matrix[y0 + y][x0 + x] = nearest_palette_index((r, g, b))
    return matrix


def outside_transparency(matrix: list[list[int]]) -> list[list[bool]]:
    """Mark transparent pixels connected to the canvas border."""
    h, w = len(matrix), len(matrix[0])
    outside = [[False] * w for _ in range(h)]
    q: deque[tuple[int, int]] = deque()

    for x in range(w):
        for y in (0, h - 1):
            if matrix[y][x] == TRANSPARENT and not outside[y][x]:
                outside[y][x] = True
                q.append((x, y))
    for y in range(h):
        for x in (0, w - 1):
            if matrix[y][x] == TRANSPARENT and not outside[y][x]:
                outside[y][x] = True
                q.append((x, y))

    while q:
        x, y = q.popleft()
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            nx, ny = x + dx, y + dy
            if 0 <= nx < w and 0 <= ny < h:
                if matrix[ny][nx] == TRANSPARENT and not outside[ny][nx]:
                    outside[ny][nx] = True
                    q.append((nx, ny))
    return outside


def nearest_opaque_color(matrix: list[list[int]], x: int, y: int) -> int:
    h, w = len(matrix), len(matrix[0])
    for radius in range(1, max(w, h) + 1):
        candidates: list[int] = []
        x1, x2 = max(0, x - radius), min(w - 1, x + radius)
        y1, y2 = max(0, y - radius), min(h - 1, y + radius)

        for xx in range(x1, x2 + 1):
            for yy in (y1, y2):
                if matrix[yy][xx] != TRANSPARENT:
                    candidates.append(matrix[yy][xx])
        for yy in range(y1 + 1, y2):
            for xx in (x1, x2):
                if matrix[yy][xx] != TRANSPARENT:
                    candidates.append(matrix[yy][xx])

        if candidates:
            return Counter(candidates).most_common(1)[0][0]
    return CRAB_ORANGE


def fill_enclosed_pixel_holes(matrix: list[list[int]]) -> None:
    """Fill transparent pixels that are not connected to the canvas edge."""
    outside = outside_transparency(matrix)
    holes: list[tuple[int, int]] = []

    for y, row in enumerate(matrix):
        for x, value in enumerate(row):
            if value == TRANSPARENT and not outside[y][x]:
                holes.append((x, y))

    for x, y in holes:
        matrix[y][x] = nearest_opaque_color(matrix, x, y)


def dominant_color(values: Iterable[int]) -> int:
    counts = Counter(v for v in values if v != TRANSPARENT)
    if not counts:
        return TRANSPARENT

    # Prefer dark details in exact ties, then orange, purple, lavender.
    tie_priority = {
        DETAIL_BLACK: 4,
        CRAB_ORANGE: 3,
        FRAME_PURPLE: 2,
        PICTURE_LAVENDER: 1,
    }
    return max(
        counts,
        key=lambda c: (counts[c], tie_priority.get(c, 0)),
    )


def cell_mask(matrix: list[list[int]], x: int, y: int) -> int:
    return (
        (1 if matrix[y][x] != TRANSPARENT else 0)
        | (2 if matrix[y][x + 1] != TRANSPARENT else 0)
        | (4 if matrix[y + 1][x] != TRANSPARENT else 0)
        | (8 if matrix[y + 1][x + 1] != TRANSPARENT else 0)
    )


def cell_color(matrix: list[list[int]], x: int, y: int) -> int:
    return dominant_color(
        (
            matrix[y][x],
            matrix[y][x + 1],
            matrix[y + 1][x],
            matrix[y + 1][x + 1],
        )
    )


def enforce_one_color_per_cell(matrix: list[list[int]]) -> None:
    """Keep transparency masks but collapse each 2x2 cell to one color."""
    h, w = len(matrix), len(matrix[0])
    for y in range(0, h, 2):
        for x in range(0, w, 2):
            coords = (
                (x, y),
                (x + 1, y),
                (x, y + 1),
                (x + 1, y + 1),
            )
            color = dominant_color(matrix[yy][xx] for xx, yy in coords)
            if color == TRANSPARENT:
                continue

            for xx, yy in coords:
                if matrix[yy][xx] != TRANSPARENT:
                    matrix[yy][xx] = color

            mask = cell_mask(matrix, x, y)
            # Diagonal-only pairs require ▚/▞. Fill them instead of producing
            # a disconnected shape or an enclosed character-level gap.
            if mask in (0x6, 0x9):
                for xx, yy in coords:
                    matrix[yy][xx] = color


def color_bbox(
    matrix: list[list[int]],
    color: int,
) -> tuple[int, int, int, int] | None:
    """Return inclusive bounding box for a palette index."""
    xs: list[int] = []
    ys: list[int] = []

    for y, row in enumerate(matrix):
        for x, value in enumerate(row):
            if value == color:
                xs.append(x)
                ys.append(y)

    if not xs:
        return None
    return min(xs), min(ys), max(xs), max(ys)


def align_down_even(value: int) -> int:
    return value - (value % 2)


def align_up_even(value: int) -> int:
    return value if value % 2 == 0 else value + 1


def fill_rect(
    matrix: list[list[int]],
    x1: int,
    y1: int,
    x2: int,
    y2: int,
    color: int,
    overwrite: set[int] | None = None,
) -> None:
    """Fill an inclusive rectangle, optionally restricting old colors."""
    h, w = len(matrix), len(matrix[0])
    x1 = max(0, x1)
    y1 = max(0, y1)
    x2 = min(w - 1, x2)
    y2 = min(h - 1, y2)

    if x2 < x1 or y2 < y1:
        return

    for y in range(y1, y2 + 1):
        for x in range(x1, x2 + 1):
            if overwrite is None or matrix[y][x] in overwrite:
                matrix[y][x] = color


def overlay_frame_crab_details(matrix: list[list[int]]) -> None:
    """Redraw terminal-safe eyes and picture-frame artwork.

    All important details are aligned to even logical coordinates and drawn in
    2x2 logical-pixel units. This prevents the later quadrant packing step from
    merging colors or turning the two eyes into one long black bar.
    """
    shell = color_bbox(matrix, FRAME_PURPLE)
    body = color_bbox(matrix, CRAB_ORANGE)

    # ------------------------------------------------------------------
    # Picture inside the square shell.
    # ------------------------------------------------------------------
    if shell is not None:
        sx1, sy1, sx2, sy2 = shell

        # Estimate an inset picture rectangle and align it to 2x2 cells.
        ix1 = align_up_even(sx1 + 2)
        iy1 = align_up_even(sy1 + 2)
        ix2 = align_down_even(sx2 - 2) + 1
        iy2 = align_down_even(sy2 - 4) + 1

        if ix2 - ix1 + 1 >= 8 and iy2 - iy1 + 1 >= 8:
            editable_shell_colors = {
                FRAME_PURPLE,
                PICTURE_LAVENDER,
                TRANSPARENT,
            }

            # Clean, solid lavender picture area. Orange pixels from the crab
            # are deliberately protected where the body overlaps the shell.
            fill_rect(
                matrix,
                ix1,
                iy1,
                ix2,
                iy2,
                PICTURE_LAVENDER,
                overwrite=editable_shell_colors,
            )

            # Stepped purple mountain in the lower-left. Each tuple is
            # (horizontal 2-pixel block offset, height in 2-pixel blocks).
            # The shape has a clear peak and descends to the right, matching
            # the reference picture more closely.
            mountain_columns = (
                (0, 2),
                (1, 3),
                (2, 2),
                (3, 1),
                (4, 1),
            )
            for block_x, height_blocks in mountain_columns:
                px1 = ix1 + block_x * 2
                if px1 > ix2:
                    break
                py1 = max(iy1, iy2 - height_blocks * 2 + 1)
                fill_rect(
                    matrix,
                    px1,
                    py1,
                    min(px1 + 1, ix2),
                    iy2,
                    FRAME_PURPLE,
                    overwrite=editable_shell_colors,
                )

            # Solid two-pixel base prevents holes between the stepped columns.
            fill_rect(
                matrix,
                ix1,
                max(iy1, iy2 - 1),
                min(ix1 + 9, ix2),
                iy2,
                FRAME_PURPLE,
                overwrite=editable_shell_colors,
            )

            # Small 2x2 purple square near the upper-right of the picture.
            dot_x = align_down_even(ix2 - 3)
            dot_y = align_up_even(iy1 + 2)
            fill_rect(
                matrix,
                dot_x,
                dot_y,
                dot_x + 1,
                dot_y + 1,
                FRAME_PURPLE,
                overwrite=editable_shell_colors,
            )

    # ------------------------------------------------------------------
    # Two separate square eyes.
    # ------------------------------------------------------------------
    if body is not None:
        ox1, oy1, ox2, oy2 = body
        body_w = ox2 - ox1 + 1
        body_h = oy2 - oy1 + 1

        # Remove black pixels inherited from the source before redrawing the
        # eyes. Without this cleanup, the source eyes can survive as one bar.
        eye_band_bottom = min(oy2, oy1 + max(5, body_h // 2))
        fill_rect(
            matrix,
            ox1,
            oy1,
            ox2,
            eye_band_bottom,
            CRAB_ORANGE,
            overwrite={DETAIL_BLACK},
        )

        eye_y = align_up_even(oy1 + max(2, body_h // 6))

        # Place the eye pair in the upper-right half of the body. Coordinates
        # are aligned so each eye occupies exactly one 2x2 logical cell.
        left_eye_x = align_down_even(ox1 + max(8, body_w // 2))
        right_eye_x = left_eye_x + 4

        # Keep the eye pair inside the orange body bbox.
        if right_eye_x + 1 > ox2:
            right_eye_x = align_down_even(ox2 - 1)
            left_eye_x = right_eye_x - 4

        if eye_y + 1 > oy2:
            eye_y = align_down_even(oy2 - 1)

        # Ensure the 2-pixel gap between eyes is orange.
        fill_rect(
            matrix,
            left_eye_x + 2,
            eye_y,
            right_eye_x - 1,
            eye_y + 1,
            CRAB_ORANGE,
            overwrite={CRAB_ORANGE, DETAIL_BLACK},
        )

        fill_rect(
            matrix,
            left_eye_x,
            eye_y,
            left_eye_x + 1,
            eye_y + 1,
            DETAIL_BLACK,
            overwrite={CRAB_ORANGE, DETAIL_BLACK},
        )
        fill_rect(
            matrix,
            right_eye_x,
            eye_y,
            right_eye_x + 1,
            eye_y + 1,
            DETAIL_BLACK,
            overwrite={CRAB_ORANGE, DETAIL_BLACK},
        )


def fill_enclosed_terminal_cells(matrix: list[list[int]]) -> None:
    """Ensure no blank terminal cells are enclosed by the sprite."""
    h, w = len(matrix), len(matrix[0])
    cw, ch = w // 2, h // 2
    occupied = [
        [cell_mask(matrix, cx * 2, cy * 2) != 0 for cx in range(cw)]
        for cy in range(ch)
    ]
    outside = [[False] * cw for _ in range(ch)]
    q: deque[tuple[int, int]] = deque()

    for cx in range(cw):
        for cy in (0, ch - 1):
            if not occupied[cy][cx] and not outside[cy][cx]:
                outside[cy][cx] = True
                q.append((cx, cy))
    for cy in range(ch):
        for cx in (0, cw - 1):
            if not occupied[cy][cx] and not outside[cy][cx]:
                outside[cy][cx] = True
                q.append((cx, cy))

    while q:
        cx, cy = q.popleft()
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            nx, ny = cx + dx, cy + dy
            if 0 <= nx < cw and 0 <= ny < ch:
                if not occupied[ny][nx] and not outside[ny][nx]:
                    outside[ny][nx] = True
                    q.append((nx, ny))

    for cy in range(ch):
        for cx in range(cw):
            if not occupied[cy][cx] and not outside[cy][cx]:
                px, py = cx * 2, cy * 2
                color = nearest_opaque_color(matrix, px, py)
                matrix[py][px] = color
                matrix[py][px + 1] = color
                matrix[py + 1][px] = color
                matrix[py + 1][px + 1] = color


def expand_horizontal(
    matrix: list[list[int]],
    scale: int,
) -> list[list[int]]:
    """Duplicate logical columns before quadrant packing.

    A normal terminal cell is approximately 1 unit wide and 2 units high. A
    quadrant therefore has a physical size of about 0.5 x 1 units, which makes
    an uncorrected sprite look half as wide as intended. Duplicating each
    logical column twice makes one source pixel occupy roughly 1 x 1 physical
    units.

    Expansion happens before glyph selection. Repeating the final Unicode
    glyph would repeat its internal quadrant pattern and distort edge masks.
    """
    if scale < 1:
        raise ValueError("horizontal scale must be at least 1")
    if scale == 1:
        return [row[:] for row in matrix]
    return [
        [value for value in row for _ in range(scale)]
        for row in matrix
    ]


def render_ansi(
    matrix: list[list[int]],
    trim: bool = True,
    horizontal_scale: int = 2,
) -> str:
    # Work on a copy so rendering does not mutate the caller's matrix.
    matrix = expand_horizontal(matrix, horizontal_scale)

    # Character-level hole detection runs on the aspect-corrected matrix,
    # because these 2x2 groups are the actual terminal cells being drawn.
    fill_enclosed_terminal_cells(matrix)
    enforce_one_color_per_cell(matrix)

    h, w = len(matrix), len(matrix[0])
    rows: list[str] = []

    for y in range(0, h, 2):
        cells: list[tuple[str, int]] = []
        for x in range(0, w, 2):
            mask = cell_mask(matrix, x, y)
            if mask in (0x6, 0x9):
                mask = 0xF
            char = MASK_TO_CHAR[mask]
            color = cell_color(matrix, x, y)
            cells.append((char, color))

        if trim:
            while cells and cells[-1][0] == " ":
                cells.pop()

        out: list[str] = []
        active_color = TRANSPARENT
        for char, color in cells:
            if char == " ":
                if active_color != TRANSPARENT:
                    out.append("\x1b[0m")
                    active_color = TRANSPARENT
                out.append(" ")
                continue

            if color != active_color:
                r, g, b = PALETTE[color]
                out.append(f"\x1b[38;2;{r};{g};{b}m")
                active_color = color
            out.append(char)

        if active_color != TRANSPARENT:
            out.append("\x1b[0m")
        rows.append("".join(out))

    if trim:
        while rows and strip_ansi(rows[-1]).strip() == "":
            rows.pop()
        while rows and strip_ansi(rows[0]).strip() == "":
            rows.pop(0)

    return "\n".join(rows)


def strip_ansi(text: str) -> str:
    return re.sub(r"\x1b\[[0-9;]*m", "", text)


def go_string_literal(value: str) -> str:
    escaped: list[str] = ['"']
    for ch in value:
        code = ord(ch)
        if ch == "\\":
            escaped.append("\\\\")
        elif ch == '"':
            escaped.append('\\"')
        elif ch == "\n":
            escaped.append("\\n")
        elif ch == "\r":
            escaped.append("\\r")
        elif ch == "\t":
            escaped.append("\\t")
        elif code == 0x1B:
            escaped.append("\\x1b")
        elif code < 0x20:
            escaped.append(f"\\x{code:02x}")
        else:
            escaped.append(ch)
    escaped.append('"')
    return "".join(escaped)


def render_go(ansi: str, package: str, name: str) -> str:
    return (
        "// Code generated by image_to_quadrant.py; DO NOT EDIT.\n"
        f"package {package}\n\n"
        f"const {name} = {go_string_literal(ansi)}\n"
    )


def valid_go_identifier(value: str) -> str:
    if not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", value):
        raise argparse.ArgumentTypeError(
            f"invalid Go identifier: {value!r}"
        )
    return value


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description=(
            "Convert an image to quadrant/half/full-block ANSI art "
            "for Bubble Tea."
        )
    )
    parser.add_argument("input", type=Path, help="input PNG/WebP/JPEG")
    parser.add_argument(
        "-o",
        "--output",
        type=Path,
        help="output file; stdout when omitted",
    )
    parser.add_argument("--format", choices=("ansi", "go"), default="go")
    parser.add_argument("--canvas-width", type=int, default=32)
    parser.add_argument("--canvas-height", type=int, default=32)
    parser.add_argument("--sprite-width", type=int, default=26)
    parser.add_argument("--sprite-height", type=int, default=20)
    parser.add_argument("--alpha-threshold", type=int, default=128)
    parser.add_argument(
        "--bg-tolerance",
        type=int,
        default=28,
        help="checkerboard/flat-background removal tolerance",
    )
    parser.add_argument(
        "--package",
        type=valid_go_identifier,
        default="main",
    )
    parser.add_argument(
        "--name",
        type=valid_go_identifier,
        default="FrameCrab",
    )
    parser.add_argument(
        "--horizontal-scale",
        type=int,
        choices=(1, 2),
        default=2,
        help=(
            "duplicate logical pixels horizontally before packing; "
            "2 corrects the usual 1:2 terminal cell aspect ratio"
        ),
    )
    parser.add_argument(
        "--no-frame-crab-details",
        action="store_true",
        help=(
            "do not redraw the two eyes and the picture inside the shell"
        ),
    )
    parser.add_argument(
        "--keep-padding",
        action="store_true",
        help=(
            "preserve the full logical canvas instead of trimming "
            "empty rows and the right side"
        ),
    )
    return parser


def main() -> int:
    args = build_parser().parse_args()

    if args.canvas_width % 2 or args.canvas_height % 2:
        raise SystemExit("canvas width and height must be even")
    if (
        args.sprite_width > args.canvas_width - 4
        or args.sprite_height > args.canvas_height - 4
    ):
        raise SystemExit(
            "sprite dimensions must leave at least 2 logical pixels "
            "on every side"
        )
    if args.sprite_width % 2 or args.sprite_height % 2:
        raise SystemExit(
            "sprite width and height must be even for clean 2x2 packing"
        )

    try:
        source = Image.open(args.input)
    except (FileNotFoundError, OSError) as exc:
        raise SystemExit(f"cannot open input image: {exc}") from exc

    foreground = extract_foreground(
        source,
        args.alpha_threshold,
        args.bg_tolerance,
    )
    matrix = image_to_matrix(
        foreground,
        args.canvas_width,
        args.canvas_height,
        args.sprite_width,
        args.sprite_height,
    )

    # Establish a stable, filled silhouette first.
    fill_enclosed_pixel_holes(matrix)
    enforce_one_color_per_cell(matrix)

    # Then redraw small semantic details that would otherwise disappear during
    # resizing, quantization and hole filling.
    if not args.no_frame_crab_details:
        overlay_frame_crab_details(matrix)
        enforce_one_color_per_cell(matrix)

    ansi = render_ansi(
        matrix,
        trim=not args.keep_padding,
        horizontal_scale=args.horizontal_scale,
    )
    result = (
        ansi
        if args.format == "ansi"
        else render_go(ansi, args.package, args.name)
    )

    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(result, encoding="utf-8")
    else:
        sys.stdout.write(result)
        if result and not result.endswith("\n"):
            sys.stdout.write("\n")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
