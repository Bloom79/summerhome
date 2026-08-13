#!/usr/bin/env python3
"""Center the sun in a set of eclipse photos by cropping only (no resampling).

For every photo the sun is located as the bright region against the dark sky,
then a fixed-size window (the same for all frames, so the sun keeps the same
scale across the sequence) is cropped around its center. Pixels are never
resized or retouched; if the window falls partly outside a frame the missing
edge is filled with black, which matches the sky.

Usage:
    python3 scripts/center_eclipse.py PHOTO_DIR [options]

Options:
    -o, --out DIR     output directory (default: PHOTO_DIR/centered)
    --size N          crop window size in pixels (default: 3x the largest
                      sun diameter found across the set, rounded up)
    --margin F        when --size is not given, window = diameter * (1 + 2*F)
                      (default 1.0, i.e. one sun-diameter of sky on each side)
    --threshold F     brightness cutoff as a fraction of each frame's peak
                      brightness (default 0.4)
    --gif             also write an animated sequence.gif (800px wide)
    --strip           also write a strip.jpg contact sheet of all frames
    --cols N          columns in the contact sheet (default 5)

Examples:
    python3 scripts/center_eclipse.py ~/Pictures/eclipse
    python3 scripts/center_eclipse.py ~/Pictures/eclipse --gif --strip
"""

import argparse
import sys
from pathlib import Path

try:
    from PIL import Image
except ImportError:
    sys.exit("Pillow is required: pip3 install Pillow")

IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".tif", ".tiff", ".webp"}
EXIF_DATETIME_ORIGINAL = 36867


def _components(gray, cutoff):
    """8-connected bright blobs as (box, pixel_count, peak) tuples."""
    w, h = gray.size
    data = gray.load()
    bright = {(x, y) for y in range(h) for x in range(w)
              if data[x, y] >= cutoff}
    comps = []
    seen = set()
    for start in bright:
        if start in seen:
            continue
        seen.add(start)
        stack, comp = [start], []
        while stack:
            x, y = stack.pop()
            comp.append((x, y))
            for nx in (x - 1, x, x + 1):
                for ny in (y - 1, y, y + 1):
                    if (nx, ny) in bright and (nx, ny) not in seen:
                        seen.add((nx, ny))
                        stack.append((nx, ny))
        xs = [p[0] for p in comp]
        ys = [p[1] for p in comp]
        comps.append(((min(xs), min(ys), max(xs), max(ys)), len(comp),
                      max(data[p[0], p[1]] for p in comp)))
    return comps


def _dim(box):
    return max(box[2] - box[0], box[3] - box[1]) + 1


def _center(box):
    return ((box[0] + box[2]) / 2, (box[1] + box[3]) / 2)


def find_sun(im, threshold_frac):
    """Return (cx, cy, diameter) of the sun, or None if not found.

    Works on a box-averaged downscale (kills sensor/JPEG noise). At each
    brightness cutoff, sun-sized blobs seed a candidate; nearby fragments
    are merged into it, because a deeply-eclipsed ring low on the horizon
    breaks into separate arcs. Small clipped highlights (boat lights,
    glitter on water) can never seed a candidate, and the merge radius
    keeps them out of clusters unless they sit right next to the sun.

    Among candidates, ones that reach the frame's peak brightness win at
    the tightest cutoff that produced them: the true sun is clipped bright
    in most exposures, while glow, twilight sky and sunset clouds are not.
    With no clipped candidate (e.g. a dim ring behind haze), the largest
    compact cluster — the fullest reconstruction of the ring — wins.
    """
    factor = max(1, min(im.width, im.height) // 320)
    gray = im.convert("L").reduce(factor)
    peak = gray.getextrema()[1]
    if peak < 40:  # frame is essentially black
        return None
    max_extent = 0.4 * min(gray.width, gray.height)
    min_dim = max(32, min(im.width, im.height) * 0.02) / factor
    candidates = []  # (cutoff_frac, cluster_dim, seed_peak, cx, cy)
    for frac in (0.92, 0.85, 0.75, 0.65, 0.55, threshold_frac):
        cutoff = max(20, int(peak * frac))
        comps = _components(gray, cutoff)
        boxes = set()
        for box, npx, comp_peak in comps:
            if not min_dim <= _dim(box) <= max_extent:
                continue
            # Merge radius scales with the seed: ring arcs sit within a
            # couple of seed-widths of each other, while glow patches and
            # other scene lights are farther out.
            radius = min(2.5 * _dim(box), max_extent / 2)
            sx, sy = _center(box)
            cluster = [b for b, _, _ in comps
                       if abs(_center(b)[0] - sx) <= radius
                       and abs(_center(b)[1] - sy) <= radius]
            union = (min(b[0] for b in cluster), min(b[1] for b in cluster),
                     max(b[2] for b in cluster), max(b[3] for b in cluster))
            if _dim(union) > max_extent or union in boxes:
                continue
            boxes.add(union)
            cx, cy = _center(union)
            candidates.append((frac, _dim(union), comp_peak, cx, cy))
    if not candidates:
        return None
    # A genuinely clipped sun seeds a candidate at high cutoffs already; a
    # blob that is only sun-sized once the cutoff drops far is a small
    # highlight bloomed by the low threshold, so it doesn't count as sun.
    clipped = [c for c in candidates if c[2] >= 0.97 * peak and c[0] >= 0.55]
    # tightest cutoff = the sun without its glow
    frac, dim, _, cx, cy = max(clipped or candidates)
    return ((cx + 0.5) * factor, (cy + 0.5) * factor, dim * factor)


def capture_time(im, path):
    try:
        exif = im.getexif()
        dt = exif.get(EXIF_DATETIME_ORIGINAL) or exif.get(306)
        if dt:
            return str(dt)
    except Exception:
        pass
    return path.name


def crop_centered(im, cx, cy, size):
    """Crop a size x size window centered on (cx, cy).

    If the window runs past the frame, dark-sky shots get black padding
    (indistinguishable from the sky), while daylight/sunset shots have the
    window shifted back inside the frame instead — a black bar against a
    bright sky would be worse than a slightly off-center sun.
    """
    left = int(round(cx - size / 2))
    top = int(round(cy - size / 2))
    hist = im.convert("L").reduce(8).histogram()
    pixels = sum(hist)
    darker_half = 0
    for level, count in enumerate(hist):
        darker_half += count
        if darker_half >= pixels / 2:
            break
    if level >= 20:  # bright scene: clamp the window inside the frame
        left = max(0, min(left, im.width - size))
        top = max(0, min(top, im.height - size))
    canvas = Image.new(im.mode, (size, size), 0)
    src = im.crop((max(0, left), max(0, top),
                   min(im.width, left + size), min(im.height, top + size)))
    canvas.paste(src, (max(0, -left), max(0, -top)))
    return canvas


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("photo_dir", type=Path)
    ap.add_argument("-o", "--out", type=Path)
    ap.add_argument("--size", type=int)
    ap.add_argument("--margin", type=float, default=1.0)
    ap.add_argument("--threshold", type=float, default=0.4)
    ap.add_argument("--gif", action="store_true")
    ap.add_argument("--strip", action="store_true")
    ap.add_argument("--cols", type=int, default=5)
    args = ap.parse_args()

    if not args.photo_dir.is_dir():
        sys.exit(f"Not a directory: {args.photo_dir}")
    out_dir = args.out or args.photo_dir / "centered"
    out_dir.mkdir(parents=True, exist_ok=True)

    files = sorted(p for p in args.photo_dir.iterdir()
                   if p.suffix.lower() in IMAGE_EXTS)
    if not files:
        sys.exit(f"No images found in {args.photo_dir}")

    # Pass 1: locate the sun in every frame and note capture order.
    frames = []
    for path in files:
        with Image.open(path) as im:
            im.load()
            found = find_sun(im, args.threshold)
            if not found:
                print(f"  skip {path.name}: no sun detected")
                continue
            cx, cy, diameter = found
            frames.append({"path": path, "cx": cx, "cy": cy,
                           "diameter": diameter, "time": capture_time(im, path)})
    if not frames:
        sys.exit("The sun was not detected in any image.")

    frames.sort(key=lambda f: f["time"])
    max_d = max(f["diameter"] for f in frames)
    size = args.size or int(max_d * (1 + 2 * args.margin) + 0.5)
    size += size % 2
    print(f"{len(frames)} frames, sun diameter up to {max_d:.0f}px, "
          f"crop window {size}x{size}px")

    # Pass 2: crop and save.
    centered = []
    for i, f in enumerate(frames, 1):
        with Image.open(f["path"]) as im:
            im.load()
            out = crop_centered(im, f["cx"], f["cy"], size)
            name = f"{i:02d}_{f['path'].stem}.jpg"
            save_kw = {}
            if "exif" in im.info:
                save_kw["exif"] = im.info["exif"]
            out.convert("RGB").save(out_dir / name, quality=95, **save_kw)
            centered.append(out.convert("RGB"))
            print(f"  {name}  (sun at {f['cx']:.0f},{f['cy']:.0f} "
                  f"d={f['diameter']:.0f}px)")

    if args.gif:
        gif_w = min(800, size)
        small = [im.resize((gif_w, gif_w)) for im in centered]
        small[0].save(out_dir / "sequence.gif", save_all=True,
                      append_images=small[1:], duration=400, loop=0)
        print(f"  sequence.gif ({len(small)} frames)")

    if args.strip:
        cols = max(1, args.cols)
        rows = (len(centered) + cols - 1) // cols
        thumb = min(400, size)
        sheet = Image.new("RGB", (cols * thumb, rows * thumb), 0)
        for i, im in enumerate(centered):
            sheet.paste(im.resize((thumb, thumb)),
                        ((i % cols) * thumb, (i // cols) * thumb))
        sheet.save(out_dir / "strip.jpg", quality=92)
        print(f"  strip.jpg ({cols}x{rows})")

    print(f"Done -> {out_dir}")


if __name__ == "__main__":
    main()
