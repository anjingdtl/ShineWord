"""Generate the legacy launcher bitmaps for the Shine-TRPG brand mark.

Android 8+ (API 26+) uses the adaptive icon in `mipmap-anydpi-v26`, but minSdk
is 24, so API 24/25 launchers still need a real bitmap. Both variants are drawn
from the same frozen geometry as `mobile/src/ui/brand/BrandMark.tsx` (a 48-unit
box holding the D20 hexagon, the inner face triangle and the "S" story path)
on the brand-dark tile, with the accent path in 泥金.

Deliberately dependency-free (Python stdlib only) and reproducible:

    python3 scripts/gen-brand-icons.py

Writes `ic_launcher.png` (rounded tile) and `ic_launcher_round.png` (circular)
into `mobile/android/app/src/main/res/mipmap-<density>/`.
"""
import math
import os
import struct
import zlib

BG = (0x0B, 0x0D, 0x12)
INK = (0xF4, 0xEF, 0xE5)
ACCENT = (0xD9, 0xA4, 0x41)

MARK_BOX = 48.0
MARK_COVERAGE = 0.72
TILE_RADIUS_RATIO = 0.22
SAMPLES = 3

DENSITIES = {
    'mdpi': 48,
    'hdpi': 72,
    'xhdpi': 96,
    'xxhdpi': 144,
    'xxxhdpi': 192,
}


def arc_points(cx, cy, r, start_deg, end_deg, steps):
    """Arc sampled top-down in SVG's y-down space (0° = 3 o'clock)."""
    points = []
    for index in range(steps + 1):
        angle = math.radians(start_deg + (end_deg - start_deg) * index / steps)
        points.append((cx + r * math.cos(angle), cy - r * math.sin(angle)))
    return points


def hexagon():
    return [(24.0, 3.4), (42.6, 14.0), (42.6, 34.0), (24.0, 44.6), (5.4, 34.0), (5.4, 14.0)]


def triangle():
    return [(24.0, 3.4), (42.6, 34.0), (5.4, 34.0)]


def story_path():
    points = arc_points(24.0, 19.4, 4.6, 0.0, 180.0, 24)      # upper bowl over the top
    points.append((28.6, 28.6))                               # diagonal into the lower bowl
    points += arc_points(24.0, 28.6, 4.6, 0.0, -180.0, 24)    # lower bowl under the bottom
    return points


def closed(points):
    return points + [points[0]]


# Paint order mirrors the SVG component: outline, face triangle, accent path.
SHAPES = [
    (closed(hexagon()), INK, 2.6, 1.0),
    (closed(triangle()), INK, 1.4, 0.55),
    (story_path(), ACCENT, 2.6, 1.0),
]


def bounds(points, pad):
    xs = [p[0] for p in points]
    ys = [p[1] for p in points]
    return (min(xs) - pad, min(ys) - pad, max(xs) + pad, max(ys) + pad)


SHAPE_BOUNDS = [bounds(points, width / 2.0) for points, _, width, _ in SHAPES]


def segment_distance(px, py, ax, ay, bx, by):
    dx, dy = bx - ax, by - ay
    length_sq = dx * dx + dy * dy
    if length_sq == 0.0:
        return math.hypot(px - ax, py - ay)
    t = ((px - ax) * dx + (py - ay) * dy) / length_sq
    t = max(0.0, min(1.0, t))
    return math.hypot(px - (ax + t * dx), py - (ay + t * dy))


def near_polyline(px, py, points, half_width):
    for index in range(len(points) - 1):
        ax, ay = points[index]
        bx, by = points[index + 1]
        if segment_distance(px, py, ax, ay, bx, by) <= half_width:
            return True
    return False


def inside_tile(px, py, size, radius, round_icon):
    if round_icon:
        half = size / 2.0
        return math.hypot(px - half, py - half) <= half
    nx = min(max(px, radius), size - radius)
    ny = min(max(py, radius), size - radius)
    return math.hypot(px - nx, py - ny) <= radius


def blend(base, color, alpha):
    return tuple(base[i] + (color[i] - base[i]) * alpha for i in range(3))


def render(size, round_icon):
    scale = size * MARK_COVERAGE / MARK_BOX
    offset = (size - MARK_BOX * scale) / 2.0
    radius = size * TILE_RADIUS_RATIO
    samples = SAMPLES * SAMPLES
    out = bytearray(size * size * 4)

    for y in range(size):
        for x in range(size):
            r_acc = g_acc = b_acc = 0.0
            covered = 0
            for sy in range(SAMPLES):
                for sx in range(SAMPLES):
                    px = x + (sx + 0.5) / SAMPLES
                    py = y + (sy + 0.5) / SAMPLES
                    if not inside_tile(px, py, size, radius, round_icon):
                        continue
                    covered += 1
                    mx = (px - offset) / scale
                    my = (py - offset) / scale
                    color = BG
                    for index, (points, shape_color, width, alpha) in enumerate(SHAPES):
                        bx0, by0, bx1, by1 = SHAPE_BOUNDS[index]
                        if not (bx0 <= mx <= bx1 and by0 <= my <= by1):
                            continue
                        if near_polyline(mx, my, points, width / 2.0):
                            color = blend(color, shape_color, alpha)
                    r_acc += color[0]
                    g_acc += color[1]
                    b_acc += color[2]
            offset_px = (y * size + x) * 4
            if covered == 0:
                continue
            out[offset_px] = int(r_acc / covered + 0.5)
            out[offset_px + 1] = int(g_acc / covered + 0.5)
            out[offset_px + 2] = int(b_acc / covered + 0.5)
            out[offset_px + 3] = int(255 * covered / samples + 0.5)
    return out


def write_png(path, size, pixels):
    stride = size * 4
    raw = bytearray()
    for y in range(size):
        raw.append(0)
        raw += pixels[y * stride:(y + 1) * stride]

    def chunk(tag, data):
        return (
            struct.pack('>I', len(data))
            + tag
            + data
            + struct.pack('>I', zlib.crc32(tag + data) & 0xFFFFFFFF)
        )

    header = struct.pack('>IIBBBBB', size, size, 8, 6, 0, 0, 0)
    payload = (
        b'\x89PNG\r\n\x1a\n'
        + chunk(b'IHDR', header)
        + chunk(b'IDAT', zlib.compress(bytes(raw), 9))
        + chunk(b'IEND', b'')
    )
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'wb') as handle:
        handle.write(payload)


def main():
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    res = os.path.join(root, 'mobile', 'android', 'app', 'src', 'main', 'res')
    for density, size in DENSITIES.items():
        for name, round_icon in (('ic_launcher', False), ('ic_launcher_round', True)):
            path = os.path.join(res, 'mipmap-%s' % density, '%s.png' % name)
            write_png(path, size, render(size, round_icon))
            print('wrote %s (%dpx)' % (path, size))


if __name__ == '__main__':
    main()