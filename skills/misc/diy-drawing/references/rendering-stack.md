# レンダリングスタック メモ

レンダラーが失敗した場合や修正が必要な場合のみ読んでください。

## ライブラリの役割

| ライブラリ | 用途 | 備考 |
|---|---|---|
| **reportlab** | 正確な mm 寸法の A4 PDF 生成 | `reportlab.lib.units` の `mm` ユニット定数を使用 |
| **drawsvg** | SVG カット図、寸法図 | 活発にメンテナンス中。PNG/MP4 エクスポートに対応 |
| **ezdxf** | CNC/レーザー/CAD 交換用 DXF | 最大互換性のため AutoCAD 2010 形式を使用 |
| **build123d** | 3D BREP モデリング | CadQuery より新しく、よりクリーンな API |
| **rectpack** | カットレイアウト用 2D ビンパッキング | アルゴリズム：MaxRects（最良）、Skyline、Guillotine |
| **PIL/Pillow** | 画像合成（注釈、ラベル付け） | 3D レンダーとテキストの組み合わせに使用 |

## svgwrite を使わない理由

`svgwrite` はメンテナンスされていません（最終リリース 2021年）。代わりに `drawsvg` を使用してください — 概念的には同じ API で、活発に開発されています。

## LLM による直接 SVG 生成をしない理由

LLM の座標演算は信頼できません：テキストのオーバーフロー、プリミティブの重なり、寸法線のカウントミスが典型的な失敗です。常にパラメトリックな記述から `drawsvg.Drawing(...).save_svg()` を経由してください。

## PDF の詳細

ReportLab の `canvas` API はポイントベース（1pt = 0.353mm）です。`mm` ユニットを使用してください：

```python
from reportlab.lib.units import mm
c.rect(10*mm, 10*mm, 100*mm, 50*mm)
```

A4 に実寸で印刷するには、1:1 で描画してプリンターの「実際のサイズ」設定（「ページに合わせる」ではない）に頼ります。ユーザーが確認できるよう印刷スケール指標（例：50mm の基準線）を追加してください。

## DXF の詳細

以下のレイヤー名を使用してください（業界慣習）：
- `CUT`（色：赤、ACI 1）— 切断線
- `ENGRAVE`（色：青、ACI 5）— 彫刻 / スコアライン
- `DIM`（色：緑、ACI 3）— 寸法線
- `TEXT`（色：白/黒、ACI 7）— ラベル
- `OUTLINE`（色：シアン、ACI 4）— 参照アウトライン（切断しない）

```python
import ezdxf
doc = ezdxf.new('R2010')  # AutoCAD 2010、幅広い互換性
msp = doc.modelspace()
doc.layers.add('CUT', color=1)
msp.add_lwpolyline([(0,0), (100,0), (100,50), (0,50)], close=True, dxfattribs={'layer': 'CUT'})
doc.saveas('out.dxf')
```

## build123d 3D レンダリング

build123d は OCP/VTK の依存関係が不足しているシステムでインポート時に失敗することがあります。`render_3d.py` スクリプトはこれを捕捉して 2D アクソノメトリック（matplotlib）にフォールバックします。

基本的な build123d の使い方：
```python
from build123d import *

with BuildPart() as part:
    Box(100, 50, 19)
# part.part が結果のソリッド
```

アセンブリ：
```python
from build123d import Compound
assembly = Compound(label="shelf", children=[part1, part2, ...])
assembly.export_step("model.step")
assembly.export_gltf("model.glb")  # ウェブプレビュー用
```

GLB エクスポートが失敗した場合は 2D フォールバックを使用してください。GLB には `gltflib` パッケージが必要ですが、インストールされていない場合があります。

## rectpack の使い方

```python
from rectpack import newPacker
packer = newPacker(rotation=True)
for part in parts_from_same_material:
    packer.add_rect(part.length, part.width, rid=part.id)
packer.add_bin(stock_length, stock_width)
packer.pack()
for rect in packer[0]:
    # rect.x, rect.y, rect.width, rect.height, rect.rid
```

パッキング時は、ノコ刃のスペースを確保するため各辺に `kerf/2` だけパーツ寸法を膨らませてください。

## よくあるレンダリング失敗

1. **寸法図でテキストが重なる**：A4 のマージンを広げるか、複数ページに分割する
2. **DXF が LightBurn で開かない**：R2010 形式であることを確認する（より新しい形式は不可）
3. **model-viewer で GLB が表示されない**：軸の向きを確認 — model-viewer は Y-up を使用する
4. **PDF が実寸で印刷されない**：ユーザーの印刷ダイアログで「ページに合わせる」が有効になっている
5. **build123d の ImportError**：VTK 依存関係が不足 — 2D にフォールバックする
