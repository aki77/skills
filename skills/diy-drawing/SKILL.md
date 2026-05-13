---
name: diy-drawing
description: Generate DIY furniture and woodworking drawings — cut lists, dimension drawings, assembly step diagrams, 3D preview, and bill of materials — from natural language requests. Use this skill whenever the user wants to design a shelf, rack, bookcase, desk, box, or any wooden DIY project, asks for a 木取り図 / カット図 / 寸法図 / 組み立て図 / 材料リスト, mentions SPF / 1×4 / 2×4 / 合板 / サブロク, or asks how to build something out of wood — even if they don't explicitly say "make a drawing". The skill uses a spec.json single-source-of-truth approach with deterministic Python renderers, avoiding the LLM coordinate-math pitfalls of direct SVG generation.
---

# DIY 図面スキル

自然言語による家具の説明から、DIY・木工の成果物一式（PDF 図面、CNC/レーザー用 DXF、GLB 3D プレビュー、PNG プレビュー、BOM CSV）を生成します。日本のホームセンター規格（SPF 実寸、サブロク合板、ノコ刃幅、ホームセンターカットサービス）に対応しています。

## 基本原則：spec.json をシングルソースオブトゥルースとして使用する

**Claude が座標を指定して SVG/PDF/DXF を直接描画してはいけない。** LLM の空間演算は工学図面には信頼できません。代わりに：

1. Claude がデザインをパラメトリックに記述した `spec.json` を生成・編集する
2. `scripts/validate_spec.py` で物理的な実現可能性を検証する
3. 決定論的な Python レンダラーが `spec.json` を消費してすべての出力形式を生成する

ユーザーが修正を要求したとき（「棚を1段増やして」）、`spec.json` の1フィールドを編集してレンダラーを再実行します。図面を手で再生成してはいけません。

## このスキルを使う場面

以下の場合にこのスキルを起動します：
- 家具の設計依頼（棚、ラック、本棚、デスク、箱など）
- 木取り図 / カット図 / 寸法図 / 組み立て図 / 部品図 / 材料リスト / BOM の要求
- SPF 材（1×4、2×4 等）、合板、サブロク、ホームセンターカットへの言及
- 木材で何かを作りたい、印刷可能な図面が欲しい
- 分解図や組み立て手順の要求

ユーザーがラフスケッチやコンセプト画像のみを求めている場合（建てられる図面ではなく）、このスキルは過剰です — 直接回答してください。

## ワークフロー

### ステップ 1：要求を理解する

ユーザーの要求を読みます。必須パラメータが不足している場合は、**最大3つ**の確認質問を一括で行います（推奨寸法、材料の選択、接合方法）。ユーザーが「それで進めて」と言えるよう適切なデフォルト値を提示します — 詳細を問い詰めないでください。

デフォルト前提（ユーザーが指定しない限りこれらを使用）：
- 材料: SPF 1×4 (実寸 19×89mm) for shelves, 合板 t=15mm for backing
- 棚の奥行き: SPF 1×4 幅そのまま 89mm（ユーザーが未指定の場合）
- 接合: 木ダボ φ8mm + 木工用ボンド + コーススレッド
- 仕上げ: オスモカラー or ワトコオイル
- カット: ホームセンターカット前提（kerf 3mm）

### ステップ 2：参照ファイルを読み込む

spec.json を生成する前に、以下の参照ファイルを読みます：
- `references/spec-schema.md` — JSON スキーマとフィールドの意味
- `references/lumber-constants.md` — SPF 実寸、合板サイズ、ノコ刃幅
- `references/quality-rules.md` — スパン限界、ダボのサイズ、木目方向

レンダリングの問題をデバッグするときのみ `references/rendering-stack.md` を読みます。

### ステップ 3：spec.json を生成する

以下のいずれかで：
- `assets/` 内のテンプレート（例：`spec-template-shelf.json`）から開始して修正する、または
- 新規デザインの場合は spec.json を手書きする

作業ディレクトリに `spec.json` として保存します。スペックは全体でミリメートルを使用します。すべてのパーツは `references/spec-schema.md` のパーツスキーマに従います。

### ステップ 4：バリデーション

レンダリング前に必ずバリデーションを実行します：

```bash
python3 /path/to/skill/scripts/validate_spec.py spec.json
```

これにより以下を確認します：
- すべてのパーツが市販の材木長（1820mm / 2440mm）に収まる
- 棚のスパンが安全限界を超えない（SPF ≤ 750mm 無支持）
- ダボ穴が材料の厚みを超えない
- 全体寸法が内部的に整合している（パーツの合計 == 宣言された全体寸法）

spec.json のエラーを修正してから続行します。バリデーションエラーは通常スクリプトのバグではなく spec の間違いを示しています。

### ステップ 5：すべての出力をレンダリングする

レンダラーを順番に実行します：

```bash
python3 /path/to/skill/scripts/render_3d.py spec.json     # → preview.png, model.glb
python3 /path/to/skill/scripts/render_cutlist.py spec.json # → cutlist.svg, cutlist.dxf
python3 /path/to/skill/scripts/render_bom.py spec.json    # → bom.csv
python3 /path/to/skill/scripts/render_dxf.py spec.json    # → parts.dxf
python3 /path/to/skill/scripts/render_pdf.py spec.json    # → plan.pdf (全てをまとめる)
```

3D レンダリングが失敗した場合（build123d/OCP の問題は一般的）、`render_3d.py` の 2D アクソノメトリックにフォールバックします — スクリプトはこれをすでに処理しています。

### ステップ 6：結果を提示する

`present_files` を使用してすべての成果物をユーザーに表示します。`plan.pdf`（最も有用な単一成果物）を先頭に、次に BOM、そしてパワーユーザー向けに DXF と GLB を提示します。

簡単にまとめます：パーツの総数、推定総コスト（`material_prices.yaml` が提供された場合）、バリデーションで出た警告のうち許容したもの。

### ステップ 7：反復する

ユーザーが変更を要求した場合、レンダリング済みファイルではなく `spec.json` を修正し、バリデーションとレンダラーを再実行して再提示します。反復回数を追跡します — 3回目の反復時点で、ベーステンプレートが適切だったか見直すことを提案します。

## 避けるべきアンチパターン

- **Claude の出力に生座標の SVG を生成しない。** 常に `spec.json` + スクリプトを経由する。
- **公称寸法と実寸を混在させない。** SPF 1×4 は実寸 19×89mm であり、25×100 ではありません。`references/lumber-constants.md` の定数を使用する。
- **「シンプルな」要求でもバリデーションをスキップしない。** 750mm スパンルールは、ユーザーが実際に作る前にたわむ棚を検出します。
- **何かを見せる前にユーザーに3問以上質問しない。** デフォルト値で生成してドラフトを見せ、その後反復する。
- **プロジェクトごとにレンダラーを再発明しない。** これらは決定論的です — 再利用してください。

## 同梱リソース

- `references/spec-schema.md` — spec.json の構造とフィールドの意味（最初に読む）
- `references/lumber-constants.md` — 材料定数（spec 生成前に読む）
- `references/quality-rules.md` — 物理・工学ルール（バリデーション前に読む）
- `references/rendering-stack.md` — ライブラリ注記（デバッグ時のみ読む）
- `scripts/validate_spec.py` — 物理的実現可能性チェッカー
- `scripts/render_pdf.py` — A4 マルチページ PDF 図面（目次、BOM、カット図、組み立て）
- `scripts/render_dxf.py` — CNC/レーザー用 DXF（CUT/DIM レイヤー付き）
- `scripts/render_3d.py` — 3D プレビュー PNG + GLB（2D フォールバック付き）
- `scripts/render_cutlist.py` — 板材レイアウトカット図（rectpack）
- `scripts/render_bom.py` — 材料 CSV
- `assets/spec-template-shelf.json` — 3段棚スターター
- `assets/spec-template-rack.json` — オープンラックスターター
- `assets/spec-template-bookcase.json` — 本棚スターター
