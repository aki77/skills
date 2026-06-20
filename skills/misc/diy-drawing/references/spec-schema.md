# spec.json スキーマ

`spec.json` は DIY プロジェクトのシングルソースオブトゥルースです。すべてのレンダラーがこれを消費します。すべての寸法は**ミリメートル**単位です。

## トップレベル構造

```json
{
  "project": {
    "name": "3段ラック",
    "description": "リビング用のオープンラック",
    "designer": "user",
    "created": "2026-05-13",
    "unit": "mm"
  },
  "overall": {
    "width": 600,
    "depth": 250,
    "height": 900
  },
  "materials": [
    {
      "id": "SPF_1x4",
      "type": "lumber",
      "profile": "1x4",
      "actual": [19, 89],
      "stock_length": 1820,
      "price_per_stock": 398,
      "grain": "longitudinal"
    },
    {
      "id": "plywood_15",
      "type": "sheet",
      "thickness": 15,
      "stock_size": [910, 1820],
      "price_per_stock": 3280
    }
  ],
  "parts": [ ... ],
  "joinery": { ... },
  "finish": { ... },
  "assembly_steps": [ ... ]
}
```

## `parts` 配列

各パーツは以下のフィールドを持つ直方体です：

| フィールド | 型 | 必須 | 意味 |
|---|---|---|---|
| `id` | string | yes | 固有のパーツ識別子（例："side_L"） |
| `name` | string | yes | 人が読める名前（例："左側板"） |
| `material_id` | string | yes | `materials[].id` を参照 |
| `dimensions` | [w, d, h] | yes | 設置状態での幅 × 奥行き × 高さ（mm） |
| `position` | [x, y, z] または [[x,y,z],...] | yes | パーツの最小角の位置。単一の三つ組 = すべてのインスタンスが同じ位置。三つ組の配列 = インスタンスごとの位置（長さは quantity と一致する必要あり） |
| `quantity` | int | yes | 作る個数 |
| `grain_axis` | "x"\|"y"\|"z" | 木材に必須 | 木目が走る方向 |
| `notes` | string | no | 自由記述メモ（"木目を表に" など） |

例：
```json
{
  "id": "shelf_1",
  "name": "1段目棚板",
  "material_id": "SPF_1x4",
  "dimensions": [600, 250, 19],
  "position": [0, 0, 200],
  "quantity": 1,
  "grain_axis": "x"
}
```

インスタンスごとの位置を持つ例（異なる高さの棚板4枚）：
```json
{
  "id": "shelf",
  "name": "棚板",
  "material_id": "plywood_15",
  "dimensions": [900, 400, 15],
  "position": [[0, 0, 100], [0, 0, 550], [0, 0, 1000], [0, 0, 1450]],
  "quantity": 4,
  "grain_axis": "x"
}
```

**向きの規約（重要）：**
- `x` = 幅方向（正面から見て左右）
- `y` = 奥行き方向（前後、視点から遠ざかる方向が正）
- `z` = 高さ方向（上）
- 「棚板」600×250×19 は幅 600mm、奥行き 250mm、厚み 19mm（水平の板）
- 「側板」19×250×900 は厚み 19mm、奥行き 250mm、高さ 900mm（縦の板）

## `joinery` オブジェクト

```json
{
  "method": "dowel",
  "dowel": {
    "diameter": 8,
    "length": 30,
    "spacing": 80
  },
  "screws": {
    "type": "coarse_thread",
    "length": 45,
    "diameter": 3.8
  },
  "adhesive": "wood_glue"
}
```

有効な method：`dowel`、`screw`、`pocket_hole`、`mortise_tenon`、`dado`、`screw_and_glue`、`dowel_and_glue`。

## `finish` オブジェクト

```json
{
  "primary": "osmocolor_walnut",
  "coats": 2,
  "sanding": ["240", "400"]
}
```

## `assembly_steps` 配列

各ステップは組み立ての1段階を表します。組み立て図レンダラーが使用します。

```json
{
  "step": 1,
  "title": "側板を組む",
  "parts": ["side_L", "side_R", "top"],
  "action": "side板2枚を天板で繋いでコの字を作る",
  "tools": ["ドライバー", "クランプ"],
  "duration_min": 15
}
```

ステップは `parts[].id` の値を参照します。レンダラーはステップの順序を使ってプログレッシブな組み立て（分解 → 組み立て済み）を表示します。

## `material_prices.yaml`（任意、別ファイル）

`spec.json` と同じディレクトリに存在する場合、BOM レンダラーがコスト計算に使用します：

```yaml
SPF_1x4: 398        # 1820mm 1本あたり
SPF_2x4: 498
plywood_15: 3280    # 910×1820 1枚あたり
dowel_8mm: 5        # 1本あたり
screw_coarse_45: 8  # 1本あたり
```

## 最小限の有効な spec.json

```json
{
  "project": { "name": "テストスツール", "unit": "mm" },
  "overall": { "width": 300, "depth": 300, "height": 400 },
  "materials": [
    { "id": "SPF_1x4", "type": "lumber", "profile": "1x4",
      "actual": [19, 89], "stock_length": 1820 }
  ],
  "parts": [
    { "id": "top", "name": "天板", "material_id": "SPF_1x4",
      "dimensions": [300, 89, 19], "position": [0, 0, 381], "quantity": 4, "grain_axis": "x" },
    { "id": "leg", "name": "脚", "material_id": "SPF_1x4",
      "dimensions": [89, 89, 381], "position": [0, 0, 0], "quantity": 4, "grain_axis": "z" }
  ],
  "joinery": { "method": "screw_and_glue" }
}
```
