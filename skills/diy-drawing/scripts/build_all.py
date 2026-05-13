#!/usr/bin/env python3
"""
build_all.py — Run all renderers in sequence to produce the complete deliverable set.

Usage:
    python build_all.py spec.json [--output-dir .]

Outputs:
    plan.pdf, preview.png, model.glb (if available), model.step (if available),
    cutlist.svg, cutlist.dxf, bom.csv, parts.dxf

Workflow:
    1. validate_spec.py (abort on errors)
    2. render_3d.py        -> preview.png + model.glb
    3. render_cutlist.py   -> cutlist.svg + cutlist.dxf
    4. render_bom.py       -> bom.csv
    5. render_dxf.py       -> parts.dxf
    6. render_pdf.py       -> plan.pdf (combines all above)
"""
import shutil
import subprocess
import sys
from pathlib import Path


SCRIPTS_DIR = Path(__file__).parent


def run(script_name: str, spec_path: Path, output_dir: Path, *extra_args):
    """Run one renderer script, raising on failure."""
    script = SCRIPTS_DIR / script_name
    cmd = [sys.executable, str(script), str(spec_path)]
    # Most scripts default to writing into the current working directory
    cmd.extend(extra_args)
    print(f"\n→ {script_name}")
    result = subprocess.run(cmd, cwd=output_dir, capture_output=True, text=True)
    if result.stdout:
        print(result.stdout, end="")
    if result.stderr:
        print(result.stderr, end="", file=sys.stderr)
    if result.returncode != 0:
        raise RuntimeError(f"{script_name} failed (exit {result.returncode})")


def main():
    if len(sys.argv) < 2:
        print("Usage: build_all.py <spec.json> [--output-dir .] [--skip-validate]", file=sys.stderr)
        sys.exit(1)

    spec_path = Path(sys.argv[1]).resolve()
    output_dir = Path(".").resolve()
    if "--output-dir" in sys.argv:
        idx = sys.argv.index("--output-dir")
        output_dir = Path(sys.argv[idx + 1]).resolve()
    output_dir.mkdir(parents=True, exist_ok=True)

    skip_validate = "--skip-validate" in sys.argv

    # Copy spec into output dir so the PDF renderer can find sibling assets
    spec_in_output = output_dir / "spec.json"
    if spec_path.resolve() != spec_in_output.resolve():
        shutil.copy2(spec_path, spec_in_output)

    if not skip_validate:
        validate = subprocess.run(
            [sys.executable, str(SCRIPTS_DIR / "validate_spec.py"), str(spec_in_output)],
            cwd=output_dir, capture_output=True, text=True)
        print(validate.stdout, end="")
        if validate.returncode != 0:
            print("\n❌ Validation failed. Fix spec.json and re-run, or use --skip-validate.",
                  file=sys.stderr)
            sys.exit(2)

    # Render in order. PDF must be last since it embeds outputs from the others.
    try:
        run("render_3d.py", spec_in_output, output_dir)
        run("render_cutlist.py", spec_in_output, output_dir)
        # Convert cutlist.svg → cutlist.png for PDF embedding
        try:
            from cairosvg import svg2png
            svg_path = output_dir / "cutlist.svg"
            png_path = output_dir / "cutlist.png"
            if svg_path.exists():
                with open(svg_path, "rb") as f:
                    svg2png(bytestring=f.read(), write_to=str(png_path), output_width=1400)
                print(f"  (svg→png: {png_path})")
        except ImportError:
            print("  (cairosvg not available; PDF will try svglib fallback)")
        run("render_bom.py", spec_in_output, output_dir)
        run("render_dxf.py", spec_in_output, output_dir)
        run("render_pdf.py", spec_in_output, output_dir)
    except RuntimeError as e:
        print(f"\n❌ Build failed: {e}", file=sys.stderr)
        sys.exit(3)

    print("\n✅ Build complete. Files in:", output_dir)
    for f in sorted(output_dir.iterdir()):
        if f.is_file():
            print(f"  {f.name}  ({f.stat().st_size:,} bytes)")


if __name__ == "__main__":
    main()
