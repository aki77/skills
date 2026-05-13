#!/usr/bin/env python3
"""
render_bom.py — Generate Bill of Materials CSV from spec.json.

Aggregates parts by material, computes total board-feet / sheet equivalents,
optionally calculates cost if material_prices.yaml is provided.

Usage:
    python render_bom.py spec.json [--output bom.csv]
"""
import csv
import json
import math
import sys
from pathlib import Path


def load_prices(spec_dir: Path) -> dict:
    """Try to load material_prices.yaml from spec directory. Falls back to defaults."""
    prices_file = spec_dir / "material_prices.yaml"
    if not prices_file.exists():
        return {}
    try:
        import yaml
        with open(prices_file, encoding="utf-8") as f:
            return yaml.safe_load(f) or {}
    except ImportError:
        # parse minimal YAML manually if PyYAML not installed
        prices = {}
        with open(prices_file, encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#"):
                    continue
                if ":" in line:
                    k, v = line.split(":", 1)
                    try:
                        prices[k.strip()] = float(v.strip().split("#")[0])
                    except ValueError:
                        pass
        return prices


def compute_bom(spec: dict, prices: dict) -> list[dict]:
    """Return list of BOM rows."""
    parts = spec.get("parts", [])
    materials = {m["id"]: m for m in spec.get("materials", [])}

    # group parts by material_id
    by_mat: dict[str, list[dict]] = {}
    for p in parts:
        by_mat.setdefault(p["material_id"], []).append(p)

    rows = []
    for mat_id, mat_parts in by_mat.items():
        mat = materials.get(mat_id, {})
        if mat.get("type") == "lumber":
            stock_len = mat.get("stock_length", 1820)
            # sum total length needed (longest dim of each part × qty)
            total_length = sum(max(p["dimensions"]) * p["quantity"] for p in mat_parts)
            # add 5% kerf waste
            total_with_waste = total_length * 1.05
            stocks_needed = math.ceil(total_with_waste / stock_len)
            unit_price = mat.get("price_per_stock", prices.get(mat_id, 0))
            subtotal = stocks_needed * unit_price
            rows.append({
                "material_id": mat_id,
                "type": "lumber",
                "profile": mat.get("profile", ""),
                "actual_mm": "×".join(str(x) for x in mat.get("actual", [])),
                "stock_length_mm": stock_len,
                "total_length_mm": total_length,
                "stocks_needed": stocks_needed,
                "unit_price_jpy": unit_price,
                "subtotal_jpy": subtotal,
                "parts": ", ".join(f"{p['name']}×{p['quantity']}" for p in mat_parts),
            })
        elif mat.get("type") == "sheet":
            sheet_w, sheet_h = mat.get("stock_size", [910, 1820])
            # sum surface area needed (face area of each part)
            total_area = 0
            for p in mat_parts:
                dims = sorted(p["dimensions"], reverse=True)
                total_area += dims[0] * dims[1] * p["quantity"]
            sheet_area = sheet_w * sheet_h
            sheets_needed = math.ceil(total_area * 1.15 / sheet_area)  # 15% waste for sheets
            unit_price = mat.get("price_per_stock", prices.get(mat_id, 0))
            subtotal = sheets_needed * unit_price
            rows.append({
                "material_id": mat_id,
                "type": "sheet",
                "profile": f"t={mat.get('thickness', '?')}",
                "actual_mm": f"{sheet_w}×{sheet_h}",
                "stock_length_mm": "",
                "total_length_mm": "",
                "stocks_needed": sheets_needed,
                "unit_price_jpy": unit_price,
                "subtotal_jpy": subtotal,
                "parts": ", ".join(f"{p['name']}×{p['quantity']}" for p in mat_parts),
            })

    # add fasteners
    joinery = spec.get("joinery", {})
    if joinery.get("method", "").startswith("dowel") or "dowel" in joinery.get("method", ""):
        dowel_count = len(parts) * 4  # rough estimate
        unit_price = prices.get(f"dowel_{joinery.get('dowel', {}).get('diameter', 8)}mm", 5)
        rows.append({
            "material_id": "dowel",
            "type": "fastener",
            "profile": f"φ{joinery.get('dowel', {}).get('diameter', 8)}×{joinery.get('dowel', {}).get('length', 30)}",
            "actual_mm": "",
            "stock_length_mm": "",
            "total_length_mm": "",
            "stocks_needed": dowel_count,
            "unit_price_jpy": unit_price,
            "subtotal_jpy": dowel_count * unit_price,
            "parts": "joinery",
        })
    if "screw" in joinery.get("method", ""):
        screw_count = len(parts) * 6
        unit_price = prices.get("screw_coarse_45", 8)
        rows.append({
            "material_id": "screw",
            "type": "fastener",
            "profile": f"コーススレッド {joinery.get('screws', {}).get('length', 45)}mm",
            "actual_mm": "",
            "stock_length_mm": "",
            "total_length_mm": "",
            "stocks_needed": screw_count,
            "unit_price_jpy": unit_price,
            "subtotal_jpy": screw_count * unit_price,
            "parts": "joinery",
        })

    return rows


def write_csv(rows: list[dict], output_path: Path):
    if not rows:
        return
    fieldnames = ["material_id", "type", "profile", "actual_mm", "stock_length_mm",
                  "total_length_mm", "stocks_needed", "unit_price_jpy", "subtotal_jpy", "parts"]
    with open(output_path, "w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        for row in rows:
            writer.writerow(row)
        # totals row
        total = sum(r["subtotal_jpy"] for r in rows)
        writer.writerow({"material_id": "TOTAL", "subtotal_jpy": total})


def main():
    if len(sys.argv) < 2:
        print("Usage: render_bom.py <spec.json> [--output bom.csv]", file=sys.stderr)
        sys.exit(1)

    spec_path = Path(sys.argv[1])
    output_path = Path("bom.csv")
    if "--output" in sys.argv:
        idx = sys.argv.index("--output")
        output_path = Path(sys.argv[idx + 1])

    with open(spec_path, encoding="utf-8") as f:
        spec = json.load(f)
    prices = load_prices(spec_path.parent)

    rows = compute_bom(spec, prices)
    write_csv(rows, output_path)

    total = sum(r["subtotal_jpy"] for r in rows)
    print(f"BOM written to {output_path}")
    print(f"Total items: {len(rows)}")
    print(f"Estimated cost: ¥{total:,.0f}")


if __name__ == "__main__":
    main()
