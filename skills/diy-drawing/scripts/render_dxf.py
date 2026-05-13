#!/usr/bin/env python3
"""
render_dxf.py — Generate dimensional part drawings as DXF.

For each unique part, draws front view with dimensions on DIM layer.
Different from render_cutlist.py which shows board-layout — this shows
each part separately with annotated dimensions.

Usage:
    python render_dxf.py spec.json [--output parts.dxf]
"""
import json
import sys
from pathlib import Path

import ezdxf


def render(spec: dict, output_path: Path):
    doc = ezdxf.new("R2010", setup=True)  # setup=True for default text/dim styles

    doc.layers.add("OUTLINE", color=7)   # black/white
    doc.layers.add("DIM", color=3)       # green
    doc.layers.add("TEXT", color=7)
    doc.layers.add("CENTER", color=4, linetype="DASHED")  # cyan dashed

    msp = doc.modelspace()
    parts = spec.get("parts", [])

    if not parts:
        return

    # Layout: arrange parts in a grid, with padding
    col_w = 400  # mm of model space per column
    row_h = 350
    cols = 3

    for idx, p in enumerate(parts):
        col = idx % cols
        row = idx // cols
        ox = col * col_w
        oy = -row * row_h  # negative Y goes down

        # Show the largest face (longest two dimensions)
        sorted_dims = sorted(enumerate(p["dimensions"]), key=lambda x: -x[1])
        long_idx, long_val = sorted_dims[0]
        med_idx, med_val = sorted_dims[1]
        thick_idx, thick_val = sorted_dims[2]

        # Scale to fit in cell
        max_face = max(long_val, med_val)
        scale = min(280 / max_face, 1.0)  # fit in 280mm display area
        w = long_val * scale
        h = med_val * scale

        # Center within cell
        x = ox + (col_w - w) / 2
        y = oy - 100 - h / 2

        # Draw outline
        msp.add_lwpolyline([(x, y), (x + w, y), (x + w, y + h), (x, y + h)],
                           close=True, dxfattribs={"layer": "OUTLINE"})

        # Title
        title = f"{p['id']}  ({p['name']})"
        msp.add_text(title, height=10,
                     dxfattribs={"layer": "TEXT", "insert": (ox + 10, oy - 30)})
        msp.add_text(f"材料: {p['material_id']}  数量: {p['quantity']}", height=7,
                     dxfattribs={"layer": "TEXT", "insert": (ox + 10, oy - 45)})
        msp.add_text(f"実寸: {long_val}×{med_val}×{thick_val} mm", height=7,
                     dxfattribs={"layer": "TEXT", "insert": (ox + 10, oy - 58)})
        if p.get("grain_axis"):
            axis_label = {"x": "長手方向", "y": "横方向", "z": "縦方向"}.get(p["grain_axis"], p["grain_axis"])
            msp.add_text(f"木目: {axis_label}", height=7,
                         dxfattribs={"layer": "TEXT", "insert": (ox + 10, oy - 71)})

        # Dimension lines — linear dimensions on bottom (long) and right (med)
        # Bottom dim
        try:
            dim_bottom = msp.add_linear_dim(
                base=(x + w / 2, y - 20),
                p1=(x, y),
                p2=(x + w, y),
                dxfattribs={"layer": "DIM"},
                text=f"{long_val}"
            )
            dim_bottom.render()
        except Exception:
            # fallback: just add text
            msp.add_text(f"← {long_val} →", height=6,
                         dxfattribs={"layer": "DIM", "insert": (x + w / 2 - 20, y - 15)})

        try:
            dim_right = msp.add_linear_dim(
                base=(x + w + 20, y + h / 2),
                p1=(x + w, y),
                p2=(x + w, y + h),
                angle=90,
                dxfattribs={"layer": "DIM"},
                text=f"{med_val}"
            )
            dim_right.render()
        except Exception:
            msp.add_text(f"{med_val}", height=6,
                         dxfattribs={"layer": "DIM", "insert": (x + w + 5, y + h / 2)})

    doc.saveas(str(output_path))


def main():
    if len(sys.argv) < 2:
        print("Usage: render_dxf.py <spec.json> [--output parts.dxf]", file=sys.stderr)
        sys.exit(1)
    spec_path = Path(sys.argv[1])
    output = Path("parts.dxf")
    if "--output" in sys.argv:
        idx = sys.argv.index("--output")
        output = Path(sys.argv[idx + 1])

    with open(spec_path, encoding="utf-8") as f:
        spec = json.load(f)

    render(spec, output)
    print(f"Part drawings written to {output}")


if __name__ == "__main__":
    main()
