#!/usr/bin/env python3
"""
render_3d.py — Generate 3D preview using cabinet projection.

Algorithm:
  1. Cabinet projection: front face true-shape, depth axis at 30° with 0.5 scale.
     Floor line z=0 is horizontal — adjacent parts share the same floor.
  2. Backface culling: only render front (y_min), top (z_max), right (x_max) faces.
  3. FACE SPLITTING: each visible face is split at every other part's boundary
     that falls within its range. Without this, a large face's centroid is far
     from the actual joint area, breaking painter's-algorithm depth sort.
  4. Sort sub-faces by 3D centroid depth (-x + y - z) and draw far→near.

Why splitting: a shelf top spans y=0-400, but only its y=0-89 strip overlaps
with a front post. Without splitting, the shelf top's centroid at y=200 is
"farther" than the post's y=44.5, so the post draws on top of the shelf —
wrong. Splitting makes each strip's centroid represent its actual position.

Usage:
    python render_3d.py spec.json [--output-dir .]
"""
import json
import math
import sys
from pathlib import Path


def _expand_positions(part: dict) -> list[list[float]]:
    pos = part.get("position", [0, 0, 0])
    qty = part.get("quantity", 1)
    if pos and isinstance(pos[0], (list, tuple)):
        positions = list(pos)
        while len(positions) < qty:
            positions.append(positions[-1])
        return positions[:qty]
    return [list(pos)] * qty


def _configure_jp_font(matplotlib):
    from matplotlib import font_manager
    candidates = [
        "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
        "/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc",
        "/usr/share/fonts/opentype/ipafont-gothic/ipag.ttf",
    ]
    for p in candidates:
        if Path(p).exists():
            try:
                font_manager.fontManager.addfont(p)
                name = font_manager.FontProperties(fname=p).get_name()
                matplotlib.rcParams["font.family"] = name
                return name
            except Exception:
                continue
    return None


# Cabinet projection parameters
CABINET_ALPHA_DEG = 30
CABINET_SCALE = 0.5


def cabinet_project(p, alpha_deg=CABINET_ALPHA_DEG, scale=CABINET_SCALE):
    """3D (x,y,z) → 2D (sx, sy) via cabinet projection."""
    x, y, z = p
    a = math.radians(alpha_deg)
    return x + y * scale * math.cos(a), z + y * scale * math.sin(a)


def _expand_instances(spec):
    """Return [(part_dict, [x_min,y_min,z_min,x_max,y_max,z_max]), ...] for every instance."""
    out = []
    for part in spec.get("parts", []):
        w, d, h = part["dimensions"]
        for pos in _expand_positions(part):
            x, y, z = pos
            out.append((part, [x, y, z, x + w, y + d, z + h]))
    return out


def _split_points(my_box, all_boxes, axis):
    """Return sorted list of split points for `my_box` along `axis` (0=x,1=y,2=z).

    Includes my own min/max plus any other box's min/max that falls STRICTLY
    inside my range on this axis. Other boxes are only considered when they
    actually overlap my volume on the OTHER two axes (otherwise their split
    points are irrelevant — no projection conflict can arise).
    """
    lo, hi = my_box[axis], my_box[axis + 3]
    splits = {lo, hi}
    other_axes = [a for a in (0, 1, 2) if a != axis]

    for other in all_boxes:
        if other is my_box:
            continue
        # Does `other` overlap `my_box` on the other two axes?
        # We need projection overlap, so check if ranges overlap (with small tolerance).
        relevant = True
        for a in other_axes:
            if other[a + 3] <= my_box[a] or other[a] >= my_box[a + 3]:
                # Touching or fully separate on this axis — not a projection overlap source
                if other[a + 3] < my_box[a] - 0.01 or other[a] > my_box[a + 3] + 0.01:
                    relevant = False
                    break
        if not relevant:
            continue
        for v in (other[axis], other[axis + 3]):
            if lo < v < hi:
                splits.add(v)
    return sorted(splits)


def _split_visible_faces(instances):
    """Generate (face_corners_3d, centroid_3d, kind, original_bbox) for every visible sub-face.

    kind: 0=front, 1=top, 2=right (used for color and tiebreak).
    original_bbox: the parent part's bbox (used later to determine which edges
                   are on the original face boundary vs internal splits).
    """
    boxes = [box for _, box in instances]

    for part, box in instances:
        x0, y0, z0, x1, y1, z1 = box

        xs = _split_points(box, boxes, 0)
        ys = _split_points(box, boxes, 1)
        zs = _split_points(box, boxes, 2)

        # Front face: y = y0, varies in x and z
        for i in range(len(xs) - 1):
            for k in range(len(zs) - 1):
                xa, xb = xs[i], xs[i + 1]
                za, zb = zs[k], zs[k + 1]
                corners = [(xa, y0, za), (xb, y0, za), (xb, y0, zb), (xa, y0, zb)]
                centroid = ((xa + xb) / 2, y0, (za + zb) / 2)
                yield corners, centroid, 0, tuple(box)  # front

        # Top face: z = z1, varies in x and y
        for i in range(len(xs) - 1):
            for j in range(len(ys) - 1):
                xa, xb = xs[i], xs[i + 1]
                ya, yb = ys[j], ys[j + 1]
                corners = [(xa, ya, z1), (xb, ya, z1), (xb, yb, z1), (xa, yb, z1)]
                centroid = ((xa + xb) / 2, (ya + yb) / 2, z1)
                yield corners, centroid, 1, tuple(box)  # top

        # Right face: x = x1, varies in y and z
        for j in range(len(ys) - 1):
            for k in range(len(zs) - 1):
                ya, yb = ys[j], ys[j + 1]
                za, zb = zs[k], zs[k + 1]
                corners = [(x1, ya, za), (x1, yb, za), (x1, yb, zb), (x1, ya, zb)]
                centroid = (x1, (ya + yb) / 2, (za + zb) / 2)
                yield corners, centroid, 2, tuple(box)  # right


def _boundary_edges(corners, original_bbox, kind):
    """Return list of 4 booleans: True = this edge is on the original face's outer boundary.

    Edges are between corners[i] and corners[(i+1) % 4]. An edge is on the
    original boundary iff BOTH its endpoints lie on the same boundary line
    of the original (unsplit) face. Internal split edges have at least one
    endpoint strictly inside the original face's range.
    """
    x_min, y_min, z_min, x_max, y_max, z_max = original_bbox

    if kind == 0:  # front face at y=y_min; varying axes x and z
        bdry = [(x_min, 0), (x_max, 0), (z_min, 2), (z_max, 2)]
    elif kind == 1:  # top face at z=z_max; varying axes x and y
        bdry = [(x_min, 0), (x_max, 0), (y_min, 1), (y_max, 1)]
    else:  # right face at x=x_max; varying axes y and z
        bdry = [(y_min, 1), (y_max, 1), (z_min, 2), (z_max, 2)]

    flags = []
    for i in range(4):
        a = corners[i]
        b = corners[(i + 1) % 4]
        on_bdry = False
        for val, axis in bdry:
            if a[axis] == val and b[axis] == val:
                on_bdry = True
                break
        flags.append(on_bdry)
    return flags


def render_cabinet(spec: dict, png_path: Path):
    import matplotlib
    matplotlib.use("Agg")
    _configure_jp_font(matplotlib)
    import matplotlib.pyplot as plt
    from matplotlib.patches import Polygon

    parts = spec.get("parts", [])
    if not parts:
        return

    instances = _expand_instances(spec)
    sub_faces = list(_split_visible_faces(instances))

    # Sort by depth (far → near). depth = -x + y - z; smaller depth = closer.
    def sort_key(item):
        corners, centroid, kind, _ = item
        cx, cy, cz = centroid
        depth = -cx + cy - cz
        return (-depth, [0, 2, 1].index(kind))

    sub_faces.sort(key=sort_key)

    fig, ax = plt.subplots(figsize=(9, 11))

    colors_by_kind = {
        0: "#e0b88a",  # front
        1: "#c89a6a",  # top
        2: "#a8804f",  # right
    }
    edge_color = "#3a2614"

    all_pts = []
    for idx, (corners_3d, centroid, kind, original_bbox) in enumerate(sub_faces):
        pts = [cabinet_project(c) for c in corners_3d]

        # Fill the sub-face WITHOUT edges. zorder = idx ensures painter's order:
        # sub-faces sorted far→near, so higher idx (nearer) draws on top.
        poly = Polygon(
            pts, closed=True,
            facecolor=colors_by_kind.get(kind, "#d4a574"),
            edgecolor="none",
            linewidth=0,
            zorder=idx * 2,
        )
        ax.add_patch(poly)

        # Draw only edges that lie on the ORIGINAL face's outer boundary.
        # zorder = idx*2 + 1 puts them just above THIS sub-face's fill, but
        # below the NEXT sub-face's fill (zorder=(idx+1)*2). That way a nearer
        # sub-face correctly covers a farther sub-face's boundary lines.
        boundary_flags = _boundary_edges(corners_3d, original_bbox, kind)
        for i in range(4):
            if boundary_flags[i]:
                p1 = pts[i]
                p2 = pts[(i + 1) % 4]
                ax.plot([p1[0], p2[0]], [p1[1], p2[1]],
                        color=edge_color, linewidth=0.6,
                        zorder=idx * 2 + 1,
                        solid_capstyle="round")

        all_pts.extend(pts)

    if all_pts:
        xs = [p[0] for p in all_pts]
        ys = [p[1] for p in all_pts]
        margin = 0.05 * max(max(xs) - min(xs), max(ys) - min(ys))
        ax.set_xlim(min(xs) - margin, max(xs) + margin)
        ax.set_ylim(min(ys) - margin, max(ys) + margin)
        ax.set_aspect("equal")

    ax.axis("off")
    ax.set_title(f"3Dプレビュー — {spec.get('project', {}).get('name', '')}",
                 fontsize=14, pad=10)
    plt.tight_layout()
    plt.savefig(png_path, dpi=150, bbox_inches="tight", facecolor="white")
    plt.close()


def render_build123d(spec: dict, output_dir: Path) -> bool:
    try:
        from build123d import BuildPart, Box, Location, Compound
    except Exception as e:
        print(f"build123d unavailable: {e}", file=sys.stderr)
        return False

    try:
        parts_3d = []
        for p in spec.get("parts", []):
            w, d, h = p["dimensions"]
            for pos in _expand_positions(p):
                with BuildPart() as bp:
                    Box(w, d, h)
                solid = bp.part
                solid.location = Location((pos[0] + w / 2, pos[1] + d / 2, pos[2] + h / 2))
                parts_3d.append(solid)

        if not parts_3d:
            return False

        assembly = Compound(label=spec.get("project", {}).get("name", "assembly"),
                            children=parts_3d)

        glb_path = output_dir / "model.glb"
        try:
            try:
                from build123d import export_gltf
                export_gltf(assembly, str(glb_path), binary=True)
            except ImportError:
                if hasattr(assembly, "export_gltf"):
                    assembly.export_gltf(str(glb_path), binary=True)
                else:
                    raise AttributeError("no GLB export available")
            print(f"GLB exported: {glb_path}")
        except Exception as e:
            print(f"GLB export skipped: {e}", file=sys.stderr)

        step_path = output_dir / "model.step"
        try:
            from build123d import export_step
            export_step(assembly, str(step_path))
        except Exception:
            pass

        return True
    except Exception as e:
        print(f"build123d rendering failed: {e}", file=sys.stderr)
        return False


def main():
    if len(sys.argv) < 2:
        print("Usage: render_3d.py <spec.json> [--output-dir .]", file=sys.stderr)
        sys.exit(1)
    spec_path = Path(sys.argv[1])
    output_dir = Path(".")
    if "--output-dir" in sys.argv:
        idx = sys.argv.index("--output-dir")
        output_dir = Path(sys.argv[idx + 1])
    output_dir.mkdir(parents=True, exist_ok=True)

    with open(spec_path, encoding="utf-8") as f:
        spec = json.load(f)

    png_path = output_dir / "preview.png"
    render_cabinet(spec, png_path)
    print(f"3D preview (cabinet projection, with face splitting): {png_path}")

    render_build123d(spec, output_dir)


if __name__ == "__main__":
    main()
