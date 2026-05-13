#!/usr/bin/env python3
"""
render_cutlist.py — Generate cut-layout diagram (木取り図) from spec.json.

Uses rectpack to optimally lay out parts on stock material.
Outputs SVG (visual) and DXF (for CNC/laser).

Usage:
    python render_cutlist.py spec.json [--output-dir .]
"""
import json
import sys
from pathlib import Path

import drawsvg as dw
from rectpack import newPacker, MaxRectsBssf
import ezdxf


KERF = 3  # mm, home center cut blade width
JP_FONT = "Noto Sans CJK JP, IPAGothic, Hiragino Sans, sans-serif"


def expand_parts(spec: dict) -> dict[str, list[dict]]:
    """Group parts by material, expanding quantity into individual instances."""
    materials = {m["id"]: m for m in spec.get("materials", [])}
    grouped: dict[str, list[dict]] = {}
    for p in spec.get("parts", []):
        mat = materials.get(p["material_id"])
        if not mat:
            continue
        for i in range(p["quantity"]):
            instance = {
                "id": f"{p['id']}_{i+1}" if p["quantity"] > 1 else p["id"],
                "name": p["name"],
                "dimensions": p["dimensions"],
                "material_id": p["material_id"],
                "grain_axis": p.get("grain_axis"),
            }
            grouped.setdefault(p["material_id"], []).append(instance)
    return grouped


def pack_lumber(parts: list[dict], stock_length: int, stock_width: int):
    """Pack 1D-ish lumber: each board is stock_length × stock_width, parts have max dim along length."""
    packer = newPacker(rotation=False, pack_algo=MaxRectsBssf)
    for p in parts:
        # For lumber, the "long" dimension goes along the stock
        sorted_dims = sorted(p["dimensions"], reverse=True)
        length = sorted_dims[0]
        # width perpendicular to length — for 1x4 etc this is the 89mm face
        width = sorted_dims[1] if sorted_dims[1] <= stock_width else stock_width
        # add kerf padding (only on cut sides — length direction)
        packer.add_rect(length + KERF, width, rid=p["id"])
    # add many bins; rectpack will use as needed
    for _ in range(20):
        packer.add_bin(stock_length, stock_width)
    packer.pack()
    return packer


def pack_sheet(parts: list[dict], sheet_w: int, sheet_h: int):
    """Pack 2D sheet material with rotation allowed."""
    packer = newPacker(rotation=True, pack_algo=MaxRectsBssf)
    for p in parts:
        dims = sorted(p["dimensions"], reverse=True)
        w = dims[0] + KERF
        h = dims[1] + KERF
        packer.add_rect(w, h, rid=p["id"])
    for _ in range(10):
        packer.add_bin(sheet_w, sheet_h)
    packer.pack()
    return packer


def render_svg(spec: dict, output_path: Path):
    """Render all cut layouts to a single SVG file (one row per material)."""
    materials = {m["id"]: m for m in spec.get("materials", [])}
    grouped = expand_parts(spec)

    scale = 0.15  # mm to display units (1mm = 0.15)
    margin = 30
    row_gap = 60

    # Pre-compute layouts and total size needed
    layouts = []
    for mat_id, parts in grouped.items():
        mat = materials[mat_id]
        if mat.get("type") == "lumber":
            sw = mat.get("stock_length", 1820)
            sh = mat.get("actual", [19, 89])[1]
            packer = pack_lumber(parts, sw, sh)
        elif mat.get("type") == "sheet":
            sw, sh = mat.get("stock_size", [910, 1820])
            packer = pack_sheet(parts, sw, sh)
        else:
            continue
        layouts.append((mat_id, mat, packer, sw, sh))

    if not layouts:
        d = dw.Drawing(400, 200, origin=(0, 0))
        d.append(dw.Text("カット対象の部材がありません", x=20, y=100, font_size=14))
        d.save_svg(str(output_path))
        return

    # Compute SVG canvas size
    canvas_w = max((sw * scale + margin * 2) for _, _, _, sw, _ in layouts)
    total_h = margin
    for mat_id, mat, packer, sw, sh in layouts:
        n_bins = len(packer)
        total_h += 30  # header
        total_h += n_bins * (sh * scale + 20) + row_gap

    d = dw.Drawing(canvas_w, total_h, origin=(0, 0))
    # background
    d.append(dw.Rectangle(0, 0, canvas_w, total_h, fill="white"))
    d.append(dw.Text(f"木取り図 — {spec.get('project', {}).get('name', '')}",
                     x=margin, y=margin - 10, font_size=18, font_weight="bold",
                     font_family=JP_FONT))

    y_cursor = margin + 10
    for mat_id, mat, packer, sw, sh in layouts:
        # material header
        prof = mat.get("profile", "") or f"t{mat.get('thickness', '?')}"
        d.append(dw.Text(f"{mat_id}  ({prof}, stock {sw}×{sh}mm) — {len(packer)}枚必要",
                         x=margin, y=y_cursor, font_size=13, font_weight="bold",
                         font_family=JP_FONT))
        y_cursor += 20

        for bin_idx, abin in enumerate(packer):
            bin_x = margin
            bin_y = y_cursor
            bin_w = sw * scale
            bin_h = sh * scale

            # draw stock outline
            d.append(dw.Rectangle(bin_x, bin_y, bin_w, bin_h,
                                  stroke="#888", stroke_width=1.5, fill="#fafafa"))
            d.append(dw.Text(f"#{bin_idx + 1}", x=bin_x - 25, y=bin_y + bin_h / 2 + 4,
                             font_size=10, fill="#666", font_family=JP_FONT))

            # draw each rect
            for rect in abin:
                rx = bin_x + rect.x * scale
                ry = bin_y + rect.y * scale
                rw = (rect.width - KERF) * scale  # subtract kerf padding for display
                rh = rect.height * scale
                d.append(dw.Rectangle(rx, ry, rw, rh,
                                      stroke="#222", stroke_width=1, fill="#c8e6c9", fill_opacity=0.6))
                # label
                label = str(rect.rid)
                # show dim
                dim_label = f"{int(rect.width - KERF)}×{int(rect.height)}"
                if rw > 40:
                    d.append(dw.Text(label, x=rx + 4, y=ry + 12, font_size=9, fill="#222",
                                     font_family=JP_FONT))
                    d.append(dw.Text(dim_label, x=rx + 4, y=ry + 22, font_size=8, fill="#555",
                                     font_family=JP_FONT))

            y_cursor += bin_h + 20

        y_cursor += row_gap - 20

    d.append(dw.Text(f"※ ノコ刃幅 {KERF}mm を考慮済み",
                     x=margin, y=total_h - 10, font_size=10, fill="#666",
                     font_family=JP_FONT))
    d.save_svg(str(output_path))


def render_dxf(spec: dict, output_path: Path):
    """Render cut layouts as DXF with CUT layer for CNC/laser."""
    materials = {m["id"]: m for m in spec.get("materials", [])}
    grouped = expand_parts(spec)

    doc = ezdxf.new("R2010")
    doc.layers.add("CUT", color=1)     # red
    doc.layers.add("STOCK", color=8)   # gray
    doc.layers.add("TEXT", color=7)    # white/black
    msp = doc.modelspace()

    y_offset = 0
    margin = 50

    for mat_id, parts in grouped.items():
        mat = materials.get(mat_id)
        if not mat:
            continue
        if mat.get("type") == "lumber":
            sw = mat.get("stock_length", 1820)
            sh = mat.get("actual", [19, 89])[1]
            packer = pack_lumber(parts, sw, sh)
        elif mat.get("type") == "sheet":
            sw, sh = mat.get("stock_size", [910, 1820])
            packer = pack_sheet(parts, sw, sh)
        else:
            continue

        for bin_idx, abin in enumerate(packer):
            # stock outline
            msp.add_lwpolyline(
                [(0, y_offset), (sw, y_offset), (sw, y_offset + sh), (0, y_offset + sh)],
                close=True, dxfattribs={"layer": "STOCK"})
            msp.add_text(f"{mat_id} #{bin_idx + 1}", height=15,
                         dxfattribs={"layer": "TEXT", "insert": (0, y_offset - 25)})

            # parts
            for rect in abin:
                x0 = rect.x
                y0 = y_offset + rect.y
                w = rect.width - KERF
                h = rect.height
                msp.add_lwpolyline(
                    [(x0, y0), (x0 + w, y0), (x0 + w, y0 + h), (x0, y0 + h)],
                    close=True, dxfattribs={"layer": "CUT"})
                msp.add_text(str(rect.rid), height=8,
                             dxfattribs={"layer": "TEXT", "insert": (x0 + 5, y0 + h - 12)})

            y_offset += sh + margin

        y_offset += margin

    doc.saveas(str(output_path))


def main():
    if len(sys.argv) < 2:
        print("Usage: render_cutlist.py <spec.json> [--output-dir .]", file=sys.stderr)
        sys.exit(1)

    spec_path = Path(sys.argv[1])
    output_dir = Path(".")
    if "--output-dir" in sys.argv:
        idx = sys.argv.index("--output-dir")
        output_dir = Path(sys.argv[idx + 1])
    output_dir.mkdir(parents=True, exist_ok=True)

    with open(spec_path, encoding="utf-8") as f:
        spec = json.load(f)

    svg_path = output_dir / "cutlist.svg"
    dxf_path = output_dir / "cutlist.dxf"

    render_svg(spec, svg_path)
    render_dxf(spec, dxf_path)
    print(f"Cut layout written to:\n  {svg_path}\n  {dxf_path}")


if __name__ == "__main__":
    main()
