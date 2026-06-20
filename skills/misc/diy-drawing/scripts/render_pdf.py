#!/usr/bin/env python3
"""
render_pdf.py — Generate the master A4 PDF plan combining all outputs.

Page 1: Title + project overview
Page 2: 3D preview + dimensions
Page 3: BOM table
Page 4: Cut layout (木取り図)
Page 5+: Individual part dimension drawings
Final page(s): Assembly steps

Prerequisites: run render_3d.py, render_cutlist.py, render_bom.py first
(or run as part of the orchestrator). This script reads preview.png,
cutlist.svg, bom.csv if they exist.

Usage:
    python render_pdf.py spec.json [--output plan.pdf]
"""
import csv
import json
import sys
from pathlib import Path
from datetime import datetime

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Image, Table, TableStyle, PageBreak,
)


def register_japanese_font():
    """Register a Japanese-capable font. Falls back gracefully if not available."""
    candidates = [
        "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
        "/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc",
        "/usr/share/fonts/truetype/fonts-japanese-gothic.ttf",
        "/usr/share/fonts/opentype/ipafont-gothic/ipag.ttf",
        "/System/Library/Fonts/Hiragino Sans GB.ttc",
    ]
    for path in candidates:
        if Path(path).exists():
            try:
                pdfmetrics.registerFont(TTFont("Japanese", path))
                return "Japanese"
            except Exception:
                continue
    # Fallback to reportlab's CID font (works without external file)
    try:
        from reportlab.pdfbase.cidfonts import UnicodeCIDFont
        pdfmetrics.registerFont(UnicodeCIDFont("HeiseiKakuGo-W5"))
        return "HeiseiKakuGo-W5"
    except Exception:
        return "Helvetica"


def build_pdf(spec: dict, output_path: Path, assets_dir: Path):
    font_name = register_japanese_font()

    styles = getSampleStyleSheet()
    title_style = ParagraphStyle("Title", parent=styles["Title"],
                                  fontName=font_name, fontSize=22, leading=28, alignment=1)
    h1_style = ParagraphStyle("H1", parent=styles["Heading1"],
                              fontName=font_name, fontSize=16, leading=20, spaceAfter=8)
    body_style = ParagraphStyle("Body", parent=styles["BodyText"],
                                fontName=font_name, fontSize=10, leading=14)
    small_style = ParagraphStyle("Small", parent=styles["BodyText"],
                                  fontName=font_name, fontSize=8, leading=11, textColor=colors.grey)

    doc = SimpleDocTemplate(str(output_path), pagesize=A4,
                            leftMargin=15*mm, rightMargin=15*mm,
                            topMargin=15*mm, bottomMargin=15*mm)

    story = []

    # === Page 1: Title ===
    project = spec.get("project", {})
    overall = spec.get("overall", {})

    story.append(Spacer(1, 30*mm))
    story.append(Paragraph(project.get("name", "DIYプロジェクト"), title_style))
    story.append(Spacer(1, 8*mm))
    if project.get("description"):
        story.append(Paragraph(project["description"], body_style))
    story.append(Spacer(1, 15*mm))

    overview_data = [
        ["項目", "内容"],
        ["プロジェクト名", project.get("name", "")],
        ["全体寸法 (W×D×H)", f"{overall.get('width', '?')} × {overall.get('depth', '?')} × {overall.get('height', '?')} mm"],
        ["主材料", ", ".join(m["id"] for m in spec.get("materials", []))],
        ["接合方法", spec.get("joinery", {}).get("method", "未指定")],
        ["仕上げ", spec.get("finish", {}).get("primary", "未指定")],
        ["作成日", project.get("created", datetime.now().strftime("%Y-%m-%d"))],
    ]
    t = Table(overview_data, colWidths=[60*mm, 100*mm])
    t.setStyle(TableStyle([
        ("FONTNAME", (0, 0), (-1, -1), font_name),
        ("FONTSIZE", (0, 0), (-1, -1), 10),
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#2c3e50")),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("GRID", (0, 0), (-1, -1), 0.5, colors.grey),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("PADDING", (0, 0), (-1, -1), 6),
    ]))
    story.append(t)
    story.append(Spacer(1, 20*mm))

    # 3D preview if available
    preview_png = assets_dir / "preview.png"
    if preview_png.exists():
        story.append(Paragraph("完成イメージ", h1_style))
        try:
            img = Image(str(preview_png), width=160*mm, height=110*mm, kind="proportional")
            story.append(img)
        except Exception:
            pass

    story.append(PageBreak())

    # === Page 2: BOM ===
    story.append(Paragraph("材料リスト (BOM)", h1_style))

    bom_csv = assets_dir / "bom.csv"
    if bom_csv.exists():
        with open(bom_csv, encoding="utf-8") as f:
            reader = csv.reader(f)
            bom_data = list(reader)
        if bom_data:
            # Trim columns for fit
            display_cols = ["material_id", "profile", "stocks_needed", "unit_price_jpy", "subtotal_jpy", "parts"]
            header_map = {h: i for i, h in enumerate(bom_data[0])}
            indices = [header_map.get(c) for c in display_cols if c in header_map]
            display_data = [[r[i] if i is not None and i < len(r) else "" for i in indices] for r in bom_data]
            # Pretty header
            display_data[0] = ["材料ID", "規格", "必要数", "単価¥", "小計¥", "部品"]
            t = Table(display_data, colWidths=[28*mm, 28*mm, 18*mm, 18*mm, 22*mm, 66*mm])
            t.setStyle(TableStyle([
                ("FONTNAME", (0, 0), (-1, -1), font_name),
                ("FONTSIZE", (0, 0), (-1, -1), 8),
                ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#34495e")),
                ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                ("BACKGROUND", (0, -1), (-1, -1), colors.HexColor("#ecf0f1")),
                ("FONTNAME", (0, -1), (-1, -1), font_name),
                ("GRID", (0, 0), (-1, -1), 0.5, colors.grey),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("ALIGN", (2, 1), (4, -1), "RIGHT"),
                ("PADDING", (0, 0), (-1, -1), 4),
            ]))
            story.append(t)

    story.append(PageBreak())

    # === Page 3: Parts list with dimensions ===
    story.append(Paragraph("部品一覧 (寸法)", h1_style))

    parts = spec.get("parts", [])
    if parts:
        parts_data = [["ID", "名称", "材料", "幅×奥×厚 (mm)", "数量", "備考"]]
        for p in parts:
            dims = p["dimensions"]
            parts_data.append([
                p["id"],
                p["name"],
                p["material_id"],
                f"{dims[0]}×{dims[1]}×{dims[2]}",
                str(p["quantity"]),
                p.get("notes", ""),
            ])
        t = Table(parts_data, colWidths=[22*mm, 35*mm, 25*mm, 35*mm, 15*mm, 48*mm])
        t.setStyle(TableStyle([
            ("FONTNAME", (0, 0), (-1, -1), font_name),
            ("FONTSIZE", (0, 0), (-1, -1), 9),
            ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#34495e")),
            ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
            ("GRID", (0, 0), (-1, -1), 0.5, colors.grey),
            ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
            ("ALIGN", (4, 1), (4, -1), "CENTER"),
            ("PADDING", (0, 0), (-1, -1), 4),
        ]))
        story.append(t)

    story.append(PageBreak())

    # === Page 4: Cut layout ===
    story.append(Paragraph("木取り図", h1_style))
    story.append(Paragraph("以下のレイアウトでホームセンターカットを依頼してください。ノコ刃幅3mmを考慮済みです。",
                          body_style))
    story.append(Spacer(1, 5*mm))

    cutlist_png = assets_dir / "cutlist.png"
    cutlist_svg = assets_dir / "cutlist.svg"
    # Try PNG (from converted SVG) first, fallback to embedding SVG
    if cutlist_png.exists():
        try:
            img = Image(str(cutlist_png), width=180*mm, height=200*mm, kind="proportional")
            story.append(img)
        except Exception:
            pass
    elif cutlist_svg.exists():
        # Convert SVG to PDF inline via svglib if available
        try:
            from svglib.svglib import svg2rlg
            from reportlab.graphics import renderPDF
            drawing = svg2rlg(str(cutlist_svg))
            # scale to fit page
            scale = min(180*mm / drawing.width, 200*mm / drawing.height)
            drawing.width *= scale
            drawing.height *= scale
            drawing.scale(scale, scale)
            story.append(drawing)
        except Exception as e:
            story.append(Paragraph(f"（cutlist.svg を参照してください — {e}）", small_style))

    story.append(PageBreak())

    # === Page 5+: Assembly steps ===
    steps = spec.get("assembly_steps", [])
    if steps:
        story.append(Paragraph("組み立て手順", h1_style))
        for step in steps:
            story.append(Paragraph(
                f"<b>ステップ {step.get('step', '?')}: {step.get('title', '')}</b>",
                ParagraphStyle("StepTitle", parent=body_style, fontSize=12, leading=16,
                               spaceBefore=6, spaceAfter=4)))
            if step.get("action"):
                story.append(Paragraph(step["action"], body_style))
            if step.get("parts"):
                story.append(Paragraph(f"使用部品: {', '.join(step['parts'])}", small_style))
            if step.get("tools"):
                story.append(Paragraph(f"工具: {', '.join(step['tools'])}", small_style))
            if step.get("duration_min"):
                story.append(Paragraph(f"目安時間: {step['duration_min']}分", small_style))
            story.append(Spacer(1, 6*mm))

    # Footer note
    story.append(Spacer(1, 10*mm))
    story.append(Paragraph(
        f"<i>生成日: {datetime.now().strftime('%Y-%m-%d %H:%M')} / 印刷時は「実寸大」または「100%」設定で印刷してください。</i>",
        small_style))

    doc.build(story)


def main():
    if len(sys.argv) < 2:
        print("Usage: render_pdf.py <spec.json> [--output plan.pdf]", file=sys.stderr)
        sys.exit(1)
    spec_path = Path(sys.argv[1])
    output = Path("plan.pdf")
    if "--output" in sys.argv:
        idx = sys.argv.index("--output")
        output = Path(sys.argv[idx + 1])

    with open(spec_path, encoding="utf-8") as f:
        spec = json.load(f)

    # Look for pre-rendered assets in same directory as spec
    assets_dir = spec_path.parent

    build_pdf(spec, output, assets_dir)
    print(f"PDF plan written to {output}")


if __name__ == "__main__":
    main()
