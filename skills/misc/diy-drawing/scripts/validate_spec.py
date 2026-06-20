#!/usr/bin/env python3
"""
validate_spec.py — Physical feasibility checker for spec.json.

Catches common design errors before rendering:
- Parts longer than market lumber stock
- Shelf spans exceeding safe limits
- Dowel holes deeper than material thickness
- Tipping risk (tall narrow furniture)
- Internal dimension inconsistencies

Usage:
    python validate_spec.py spec.json [--strict]
"""
import json
import sys
from pathlib import Path

# Span limits in mm — see references/quality-rules.md
SPAN_LIMITS = {
    "SPF_1x4": 600, "SPF_1x6": 700, "SPF_1x8": 750, "SPF_1x10": 850, "SPF_1x12": 950,
    "SPF_2x4": 1200, "SPF_2x6": 1400, "SPF_2x8": 1600,
    "plywood_12": 500, "plywood_15": 600, "plywood_18": 700, "plywood_24": 900,
    "MDF_15": 500, "MDF_18": 600,
    "shuseizai_18": 700, "shuseizai_25": 900,
}

# Maximum stock lengths commonly available
MAX_STOCK_LENGTHS = [910, 1820, 2440, 3650]


def _expand_positions(part: dict) -> list[list[float]]:
    """Return a list of positions for this part, one per instance."""
    pos = part.get("position", [0, 0, 0])
    qty = part.get("quantity", 1)
    if pos and isinstance(pos[0], (list, tuple)):
        positions = list(pos)
        while len(positions) < qty:
            positions.append(positions[-1])
        return positions[:qty]
    return [list(pos)] * qty


class Issue:
    def __init__(self, level: str, msg: str, part_id: str = None):
        self.level = level  # "error" | "warning" | "info"
        self.msg = msg
        self.part_id = part_id

    def __str__(self):
        prefix = {"error": "❌ ERROR", "warning": "⚠️  WARN", "info": "ℹ️  INFO"}[self.level]
        loc = f" [{self.part_id}]" if self.part_id else ""
        return f"{prefix}{loc}: {self.msg}"


def validate(spec: dict, strict: bool = False) -> list[Issue]:
    issues = []
    parts = spec.get("parts", [])
    materials = {m["id"]: m for m in spec.get("materials", [])}
    overall = spec.get("overall", {})

    # 1. Every part references a valid material
    for p in parts:
        if p["material_id"] not in materials:
            issues.append(Issue("error", f"unknown material_id '{p['material_id']}'", p["id"]))

    # 2. Parts fit in stock
    for p in parts:
        mat = materials.get(p["material_id"])
        if not mat:
            continue
        max_dim = max(p["dimensions"])
        if mat.get("type") == "lumber":
            stock = mat.get("stock_length", 1820)
            if max_dim > stock:
                viable = [L for L in MAX_STOCK_LENGTHS if L >= max_dim]
                if viable:
                    issues.append(Issue("warning",
                        f"part length {max_dim}mm exceeds default stock {stock}mm — use {viable[0]}mm stock",
                        p["id"]))
                else:
                    issues.append(Issue("error",
                        f"part length {max_dim}mm exceeds all common stock — must join boards",
                        p["id"]))
        elif mat.get("type") == "sheet":
            sw, sh = mat.get("stock_size", [910, 1820])
            w, d, h = p["dimensions"]
            # ignore thickness — find the two largest dims and check against sheet
            sorted_dims = sorted([w, d, h], reverse=True)
            big1, big2 = sorted_dims[0], sorted_dims[1]
            if big1 > max(sw, sh) or big2 > min(sw, sh):
                issues.append(Issue("warning",
                    f"part {big1}×{big2}mm may not fit on {sw}×{sh}mm sheet",
                    p["id"]))

    # 3. Shelf span check — find HORIZONTAL thin parts only (skip vertical posts/sides)
    for p in parts:
        mat = materials.get(p["material_id"])
        if not mat:
            continue
        w, d, h = p["dimensions"]
        thickness = min(w, d, h)
        if thickness > 30:
            continue  # not a thin shelf
        # Identify orientation: if the longest dimension is z (vertical), it's a post/side panel —
        # the span doesn't apply (load goes vertically through, no bending).
        long_axis = ["x", "y", "z"][[w, d, h].index(max(w, d, h))]
        if long_axis == "z":
            continue  # vertical part, no horizontal span to worry about
        length = max(w, d, h)

        # Determine material profile key for SPAN_LIMITS
        if mat.get("type") == "lumber":
            profile = mat.get("profile", "")
            key = f"SPF_{profile}" if profile else None
        elif mat.get("type") == "sheet":
            t = mat.get("thickness", thickness)
            key = f"plywood_{int(t)}"
        else:
            key = None

        limit = SPAN_LIMITS.get(key)
        if limit and length > limit:
            issues.append(Issue("warning",
                f"unsupported span {length}mm exceeds safe limit {limit}mm for {key} — may sag under load",
                p["id"]))

    # 4. Tipping risk
    if overall:
        h = overall.get("height", 0)
        d = overall.get("depth", 0)
        if h > 1500 and h / max(d, 1) > 2.5:
            issues.append(Issue("warning",
                f"tall narrow furniture (H={h}, D={d}) — recommend wall anchor"))

    # 5. Internal consistency — declared overall vs sum of parts (bounding box check)
    if overall and parts:
        # Collect all instance positions
        all_corners = []
        for p in parts:
            for pos in _expand_positions(p):
                w, d, h = p["dimensions"]
                all_corners.append((pos[0], pos[1], pos[2]))
                all_corners.append((pos[0] + w, pos[1] + d, pos[2] + h))
        min_x = min(c[0] for c in all_corners)
        min_y = min(c[1] for c in all_corners)
        min_z = min(c[2] for c in all_corners)
        max_x = max(c[0] for c in all_corners)
        max_y = max(c[1] for c in all_corners)
        max_z = max(c[2] for c in all_corners)
        calc_w = max_x - min_x
        calc_d = max_y - min_y
        calc_h = max_z - min_z
        tol = 2  # mm tolerance
        for axis, calc, declared in [("width", calc_w, overall.get("width")),
                                      ("depth", calc_d, overall.get("depth")),
                                      ("height", calc_h, overall.get("height"))]:
            if declared is not None and abs(calc - declared) > tol:
                issues.append(Issue("warning",
                    f"overall.{axis} declared {declared}mm but parts span {calc}mm"))

    # 6. Joinery sanity — dowel hole depth vs material
    joinery = spec.get("joinery", {})
    if joinery.get("method", "").startswith("dowel"):
        dowel = joinery.get("dowel", {})
        d_diam = dowel.get("diameter", 8)
        d_len = dowel.get("length", 30)
        # find thinnest material
        min_thick = float("inf")
        for p in parts:
            min_thick = min(min_thick, min(p["dimensions"]))
        half_dowel = d_len / 2
        if half_dowel > min_thick - 3:
            issues.append(Issue("error",
                f"dowel half-length {half_dowel}mm too deep for thinnest material {min_thick}mm — use shorter dowel"))
        if d_diam > min_thick / 2.0:
            issues.append(Issue("warning",
                f"dowel φ{d_diam}mm may be too large for {min_thick}mm material — rule of thumb is diameter ≤ thickness/2"))

    # 7. 3D collision detection — flag parts that occupy overlapping volumes.
    # Two boxes truly overlap only when they share VOLUME (not just a face).
    # We use a 0.5mm tolerance so adjacent parts that touch face-to-face aren't flagged.
    TOL = 0.5  # mm
    instances = []  # list of (part_id, instance_idx, [x_min, y_min, z_min, x_max, y_max, z_max])
    for p in parts:
        positions = _expand_positions(p)
        w, d, h = p["dimensions"]
        for i, pos in enumerate(positions):
            x, y, z = pos
            instances.append((p["id"], i, [x, y, z, x + w, y + d, z + h]))

    def boxes_overlap_volumetrically(a, b, tol):
        # Returns True only when overlap exists in ALL THREE axes by more than tol.
        # (Touching face-to-face gives overlap of 0 in one axis → not flagged.)
        ax0, ay0, az0, ax1, ay1, az1 = a
        bx0, by0, bz0, bx1, by1, bz1 = b
        dx = min(ax1, bx1) - max(ax0, bx0)
        dy = min(ay1, by1) - max(ay0, by0)
        dz = min(az1, bz1) - max(az0, bz0)
        return dx > tol and dy > tol and dz > tol

    seen_pairs = set()
    for i, (id_a, idx_a, box_a) in enumerate(instances):
        for j, (id_b, idx_b, box_b) in enumerate(instances):
            if i >= j:
                continue
            # Skip checking instances of the same part against each other —
            # they're allowed to be at different positions but assume the
            # spec author intends them not to overlap.
            if boxes_overlap_volumetrically(box_a, box_b, TOL):
                key = tuple(sorted([id_a, id_b]))
                if key in seen_pairs:
                    continue
                seen_pairs.add(key)
                ax0, ay0, az0, ax1, ay1, az1 = box_a
                bx0, by0, bz0, bx1, by1, bz1 = box_b
                ox = (min(ax1, bx1) - max(ax0, bx0))
                oy = (min(ay1, by1) - max(ay0, by0))
                oz = (min(az1, bz1) - max(az0, bz0))
                issues.append(Issue(
                    "error",
                    f"3D collision: '{id_a}' and '{id_b}' overlap by "
                    f"{ox:.0f}×{oy:.0f}×{oz:.0f}mm — parts share physical volume, "
                    f"adjust dimensions or position"))

    # 8. Information — totals
    if parts:
        total_parts = sum(p["quantity"] for p in parts)
        issues.append(Issue("info", f"total parts to cut: {total_parts} ({len(parts)} unique)"))

    return issues


def main():
    if len(sys.argv) < 2:
        print("Usage: validate_spec.py <spec.json> [--strict]", file=sys.stderr)
        sys.exit(1)
    spec_path = Path(sys.argv[1])
    strict = "--strict" in sys.argv

    with open(spec_path, encoding="utf-8") as f:
        spec = json.load(f)

    issues = validate(spec, strict)
    errors = [i for i in issues if i.level == "error"]
    warnings = [i for i in issues if i.level == "warning"]

    for issue in issues:
        print(issue)

    print()
    print(f"Summary: {len(errors)} errors, {len(warnings)} warnings")
    if errors:
        sys.exit(1)
    if strict and warnings:
        sys.exit(2)
    sys.exit(0)


if __name__ == "__main__":
    main()
