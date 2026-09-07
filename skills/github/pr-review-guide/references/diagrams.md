# 図のブリーフ

このファイルは、レビューガイド HTML に載せる**図**の作り方を定義する。テンプレートに実際に存在するクラス・マーカーだけを使い、手書きインライン SVG で描く。

## このファイルの読み方 (重要)

**図が主役である。** この成果物の価値は図そのものであり、文章はその補足である。逆ではない。「文章を書いて、余裕があれば図を添える」のではなく、「図で変更の形を示して、図で言えないことだけを文章で補う」。

**crit の「図はデフォルトで空、本当に必要なときだけ」という方針を、ここに持ち込んではならない。** crit は差分自体を画面に描画するので、図は装飾にすぎない。このガイドは差分を一切描画しないので、**図が唯一の視覚情報**である。crit のガイダンスを見たことがあるモデルは図を省略する方向に倒れやすいので、明示的に否定しておく。

必須図は `fig-summary` / `fig-map` / `fig-path` の 3 枚。この 3 枚は常に必須である。

---

## mermaid は使えない

**mermaid 記法を書いてはならない。** 成果物は 1 ファイル完全自己完結の HTML であり、`<script src>` でライブラリを読み込めない。レンダラのない mermaid 記法は、ブラウザ上で素のテキスト (`graph LR` などの文字列) として表示されるだけである。

**mermaid.min.js (約 2.8MB) のインライン埋め込みも却下する。** 自己完結性は満たすが、出てくるのは汎用的な箱と矢印であり、「一目で変更をつかませる」という狙いから外れる。ファイルサイズの検証 (2,000,000 バイト未満) でも落ちる。

**使えるのは手書きのインライン SVG のみ。** モデルの反射は mermaid に手を伸ばすことなので、ここで断っておく。

---

## 運用ルール: 大きな図・少ない言葉

| ルール | 値 | 理由 |
|---|---|---|
| `viewBox` | **必須** | CSS が `figure svg { width:100%; height:auto }` で全幅にする。`viewBox` がないと図が潰れる。**検証スクリプトのハード検証項目**であり、欠けると実行が失敗する |
| `width` / `height` 属性 | **付けない** | 上記 CSS のスケーリングを壊す |
| `viewBox` の幅 | **1000 固定** | 幅を固定すると、文字サイズと線幅の見え方が毎回同じになる |
| `viewBox` の高さ | 内容に応じて **300〜700** | 横長すぎ・縦長すぎを避ける |
| 文字サイズ | viewBox 単位で **15〜20**。`.lbl` (17) と `.lbl--sm` (15) のみ使う | 15 未満は全幅表示でも読めない。`font-size` を独自に上書きしない |
| 1 図のメッセージ | **1 つ** | 2 つ言いたいなら図を 2 枚に分ける |
| 1 図の要素数 | **12 個まで** (箱と矢印の合計。band と band 見出しラベルは数えない) | 超えるなら抽象度を上げる。個々のファイルではなくレイヤーを描く |
| 1 ラベルの文字数 | **20 文字まで** | 説明は figcaption と本文に書く |
| 矢印の端点 | 接続先の**箱の辺の上**で必ず計算し直す | 例の `d="M ..."` を写すと矢印が何も指さない図になる。→ [座標は流用できない](#座標は流用できない-最頻出の事故) |

### セクションごとの文章量 (上限。目標ではない)

上限に届かなくてよい。図で言えたことを文章で繰り返さない。

| セクション | 上限 |
|---|---|
| 30秒でつかむ | 約 150 文字 |
| 何を解決する PR か | 約 300 文字 |
| 全体地図 | 約 300 文字 (用語集を含む) |
| 影響が出る範囲 | 約 250 文字 |
| レビューの経路 | 1 ステップあたり約 80 文字 |

---

## 共有スタイル: 再発明しない

テンプレートの CSS が描画プリミティブを定義済みである。**下の表にあるものだけを組み合わせて描く。**

| やりたいこと | 書く markup |
|---|---|
| 変更のない箱 | `<rect class="node" .../>` |
| このPRで変更された箱 | `<rect class="node node--chg" .../>` |
| このPRで新規の箱 | `<rect class="node node--new" .../>` |
| 変更のない矢印・線 | `<path class="edge" .../>` または `<line class="edge" .../>` |
| このPRで変わった矢印・線 | `<path class="edge edge--chg" .../>` |
| 箱の中のラベル | `<text class="lbl" ...>ラベル</text>` |
| 補助的な小さいラベル | `<text class="lbl lbl--sm" ...>補足</text>` |
| レイヤー・領域の背景帯 | `<rect class="band" .../>` |
| 矢印の先端 | **書かない**。CSS が自動で付ける (`.edge` → `url(#arrow)`、`.edge--chg` → `url(#arrow-chg)`) |

### 修飾クラスは必ず基底クラスと併記する

`node--chg` / `node--new` / `edge--chg` / `lbl--sm` は**差分だけを定義した修飾クラス**である。単独で使うと壊れる。

- `class="node--chg"` 単独 → `stroke-width` が付かず線が細い
- `class="edge--chg"` 単独 → `fill:none` が付かず、`<path>` の内側が黒く塗り潰される
- `class="lbl--sm"` 単独 → `text-anchor` / `dominant-baseline` が付かず文字位置がずれる

必ず `class="node node--chg"` / `class="edge edge--chg"` / `class="lbl lbl--sm"` と書く。

### 色は 3 つの意味しか持たない

**変更なし / このPRで変更 / このPRで新規** の 3 つだけ。凡例はヘッダーに既にあるので、**図の中に凡例を描かない** (要素数を食うだけ)。

**独自の色を持ち込んではならない。** `fill="#..."` / `stroke="..."` / `style="fill:..."` は書かない。図ごとに色の意味が変わると、読み手は図を見るたびに凡例を推測し直すことになる。3 色に統一されているからこそ「黄色い箱を追えばこの PR が触った場所が分かる」という読み方が成立する。

**矢印に「新規」の色はない。** テンプレートに `edge--new` は存在しない。新しく増えた矢印・遷移も `class="edge edge--chg"` で描く。3 色は箱にだけ適用される区別である。

**図の `<svg>` の中に `<defs>` や `<style>` を書かない。** 矢印マーカーと CSS クラスはテンプレート側に定義済みである。図の中で重複して定義すると `id` が衝突し、マーカーの描画が壊れる。

### `style` 属性で書いてよいのは 3 つだけ

クラスの CSS はプレゼンテーション属性 (`text-anchor="start"` など) に勝つため、次の 3 つだけ `style` で上書きする。

- `style="text-anchor:start"` / `style="text-anchor:end"` — ラベルを左寄せ・右寄せする (band の見出しなど)
- `style="marker-end:none"` — 矢印の先端を消す (シーケンス図のライフライン、区切り線など)
- `style="stroke-dasharray:6 5"` — 破線にする (非同期・任意の関係など)

**`fill:` と `stroke:` を `style` に書いてはならない。**

### ラベルの座標計算

`.lbl` は `text-anchor: middle` かつ `dominant-baseline: middle` なので、**箱の中心座標**を指定する。

```
<rect class="node" x="X" y="Y" width="W" height="H" rx="8"/>
<text class="lbl" x="X + W/2" y="Y + H/2">ラベル</text>
```

箱の幅の目安は **17 × 文字数 + 40**。10 文字なら 210、20 文字なら 380。これを守らないと文字が箱からはみ出す。

### SVG 内の文字の注意

- `&rarr;` `&larr;` などの HTML 実体参照は **SVG (XML) では未定義エンティティ**になり、図が表示されない。矢印文字は `→` `←` を直書きする。
- `&` は `&amp;`、`<` は `&lt;` と書く。
- 各図の `<svg>` に `role="img"` と `aria-label="<図の要約>"` を付ける。

---

## 図の種類と使い分け

| PR の性質 | 使う図 |
|---|---|
| どの PR でも (必須 3 枚) | **A** 対比図 → `fig-summary` / **B** 地図 → `fig-map` / **E** 順路 → `fig-path` |
| 非同期処理・複数の登場人物・順序が意味を持つロジック | **C** シーケンス図 |
| ステータス・権限・ライフサイクルの変更 | **D** 状態遷移図 |
| 共有コード・スキーマ・公開 API など遠くまで波及する変更 | **F** 影響範囲図 → `fig-impact` |
| 課題が文章で十分伝わる | `fig-why` は `<figure>` ごと削除 |

以下、種類ごとに SVG 例を 1 つずつ載せる。題材は汎用的な通知・購読・注文処理である。**写して使うのは構造・クラスの使い方・要素数の感覚だけであり、座標は写さない** (理由は次節)。

---

### 座標は流用できない (最頻出の事故)

**例の座標は説明のためのものであって、再利用できる部品ではない。** 箱と矢印は 1 つの座標系を共有している。箱の位置・大きさを変えれば — ラベルの文字数を変えただけでも、必要な箱の幅 (17 × 文字数 + 40) が変わるので — **その箱に触るすべての矢印の端点を計算し直さなければならない**。例の箱だけを自分の題材に差し替えて `d="M ..."` を写したままにすると、矢印は何も指していない空白を指す。

**これは「少しずれている」では済まない。** そういう図は検証スクリプトを通過する (`viewBox` はあり、`<svg>` は 1 個なので構造の検証は無傷で通る) うえで、レビュアーには**存在しない関係が見えている**。間違った図は、図が無い状態より悪い。

#### 端点の計算手順

箱が `x,y,w,h` のとき、辺の中点は次のとおり。

| 辺 | 座標 |
|---|---|
| 右辺 | `(x + w, y + h/2)` |
| 左辺 | `(x, y + h/2)` |
| 上辺 | `(x + w/2, y)` |
| 下辺 | `(x + w/2, y + h)` |

A → B の矢印は、**A の向かい合う辺から出て、B の向かい合う辺で終わる**。終点は 4〜6 単位手前で止めると、矢印の先端が枠線にちょうど触る。

例: A が `x=50 y=70 w=180 h=60`、B が `x=260 y=70 w=180 h=60` で横に並んでいるとき。

- A の右辺中点 = `(50+180, 70+60/2)` = `(230, 100)`
- B の左辺中点 = `(260, 70+60/2)` = `(260, 100)` → 4 手前で止めて `(256, 100)`
- よって `<path class="edge" d="M 230 100 L 256 100"/>`

B のラベルを長くして `w` を 180 → 260 に広げたなら、B の左辺 `x` は動いていないのでこの矢印は無事だが、**B の右辺から出る矢印は `x+w` が変わるので全部書き直し**になる。

#### 仕上げ前の自己点検

書いた SVG を読み返して、次を確認する。

- **`<path class="edge*">` の端点はすべて、どれかの箱の辺の上にあるか。** 箱の `x/y/width/height` と端点の数値を実際に突き合わせる。`band` は箱ではないので接続先にならない (図全体を覆っているため、band の上にあることは何の保証にもならない)。検証スクリプトも同じ検査を機械的に行う。
- **関係のない箱を貫通している矢印はないか。** 貫通するなら経路を折る (`L` を足す) か、箱の配置を変える。
- **要素数は 12 個以内か。** 数える。下書きしているうちに超えやすい。
- **その矢印が表す関係は、本当にコードに存在するか。** 確認していない依存・呼び出しを線でつないではならない。図の中の線は「そう書いてある」という主張である。

---

### A. 課題 → 解決後 の対比図 → `fig-summary` (必須)

**これは単なる Before/After の構造の並置ではない。** 左には**何が問題だったか・何が欠けていたか**を描き、右には**それがどう解決されるか**を描く。構造だけを並べた対比図では、なぜその変更が必要だったのかが伝わらず、冒頭の必須図が役割を果たさない。

左側の箱は原則 `.node` のみ (まだ何も変わっていない状態) で、**欠落や不整合そのもの**を要素として描く。右側でそれが `.node--new` / `.node--chg` で埋まる、という形にする。

```svg
<svg viewBox="0 0 1000 380" role="img" aria-label="課題: 通知が重複して届く。解決後: 送信履歴を照会して重複を止める">
  <!-- 左: 課題 -->
  <rect class="band" x="10" y="10" width="470" height="360" rx="10"/>
  <text class="lbl lbl--sm" x="30" y="36" style="text-anchor:start">これまで (課題)</text>

  <rect class="node" x="50" y="70" width="180" height="60" rx="8"/>
  <text class="lbl" x="140" y="100">購読の更新</text>

  <rect class="node" x="260" y="70" width="180" height="60" rx="8"/>
  <text class="lbl" x="350" y="100">通知の送信</text>
  <path class="edge" d="M 230 100 L 256 100"/>

  <rect class="node" x="50" y="190" width="180" height="60" rx="8"/>
  <text class="lbl" x="140" y="220">一括取り込み</text>
  <path class="edge" d="M 230 220 L 340 220 L 340 134"/>

  <text class="lbl" x="245" y="300">同じ通知が 2 通届く</text>
  <text class="lbl lbl--sm" x="245" y="332">送信済みかを誰も見ていない</text>

  <!-- 右: 解決後 -->
  <rect class="band" x="520" y="10" width="470" height="360" rx="10"/>
  <text class="lbl lbl--sm" x="540" y="36" style="text-anchor:start">この PR の後</text>

  <rect class="node" x="560" y="70" width="180" height="60" rx="8"/>
  <text class="lbl" x="650" y="100">購読の更新</text>

  <rect class="node" x="560" y="190" width="180" height="60" rx="8"/>
  <text class="lbl" x="650" y="220">一括取り込み</text>

  <rect class="node node--new" x="560" y="290" width="380" height="60" rx="8"/>
  <text class="lbl" x="750" y="320">送信履歴の照会</text>

  <rect class="node node--chg" x="770" y="130" width="170" height="60" rx="8"/>
  <text class="lbl" x="855" y="160">通知の送信</text>

  <path class="edge" d="M 740 100 L 855 100 L 855 126"/>
  <path class="edge" d="M 740 220 L 810 220 L 810 194"/>
  <path class="edge edge--chg" d="M 900 286 L 900 194"/>
</svg>
```

figcaption には「左の何が問題で、右の何がそれを解いたか」を 1 文で書く。

---

### B. アーキテクチャ地図 → `fig-map` (必須)

**最も重要な 1 枚。** このコードベースを初めて見る人は、ここでプロジェクトの形をつかむ。

- レイヤー・領域を `.band` で描き、その中に主要な構成要素を置く。
- **この PR が触っていない部分も描く。** 触った部分だけを描くと「全体」がなくなり、差分の位置を示せない。
- 触った箱にだけ `node--chg` / `node--new` を付ける。これで**地図と変更位置の図を 1 枚が兼ねる**。
- 個々のファイル名を並べない。ファイルが増えたら抽象度を上げてレイヤーで描く。

```svg
<svg viewBox="0 0 1000 520" role="img" aria-label="全体地図: 入口・業務ロジック・永続化の3層。通知の送信と送信履歴テーブルが変更点">
  <rect class="band" x="10" y="10" width="980" height="140" rx="10"/>
  <text class="lbl lbl--sm" x="30" y="36" style="text-anchor:start">入口 (HTTP・定期実行)</text>
  <rect class="node" x="50" y="60" width="260" height="70" rx="8"/>
  <text class="lbl" x="180" y="95">購読の API</text>
  <rect class="node" x="370" y="60" width="260" height="70" rx="8"/>
  <text class="lbl" x="500" y="95">日次バッチ</text>
  <rect class="node" x="690" y="60" width="260" height="70" rx="8"/>
  <text class="lbl" x="820" y="95">管理画面</text>

  <rect class="band" x="10" y="190" width="980" height="140" rx="10"/>
  <text class="lbl lbl--sm" x="30" y="216" style="text-anchor:start">業務ロジック</text>
  <rect class="node" x="50" y="240" width="260" height="70" rx="8"/>
  <text class="lbl" x="180" y="275">購読の管理</text>
  <rect class="node node--chg" x="370" y="240" width="260" height="70" rx="8"/>
  <text class="lbl" x="500" y="275">通知の送信</text>
  <rect class="node" x="690" y="240" width="260" height="70" rx="8"/>
  <text class="lbl" x="820" y="275">集計レポート</text>

  <rect class="band" x="10" y="370" width="980" height="140" rx="10"/>
  <text class="lbl lbl--sm" x="30" y="396" style="text-anchor:start">永続化</text>
  <rect class="node" x="50" y="420" width="260" height="70" rx="8"/>
  <text class="lbl" x="180" y="455">購読テーブル</text>
  <rect class="node node--new" x="370" y="420" width="260" height="70" rx="8"/>
  <text class="lbl" x="500" y="455">送信履歴テーブル</text>

  <path class="edge" d="M 180 134 L 180 236"/>
  <path class="edge" d="M 500 134 L 500 236"/>
  <path class="edge edge--chg" d="M 500 314 L 500 416"/>
</svg>
```

用語の説明は figcaption ではなく `{{FILL:GLOSSARY}}` に **最大 5 件**書く。図の中に説明文を詰め込まない。

---

### C. シーケンス図 → `fig-summary` / `fig-impact` / `fig-path` で使える

登場人物を縦のライフラインにし、時間は上から下へ流す。**非同期処理・複数の登場人物・順序が意味を持つロジック**に向く。単純な関数の書き換えには向かない (登場人物が 1 人なら図にならない)。

ライフラインは `style="marker-end:none"` で矢印を消す。メッセージの矢印は左右方向に引き、ラベルを矢印の上に `.lbl--sm` で置く。

```svg
<svg viewBox="0 0 1000 420" role="img" aria-label="シーケンス: 注文受付が在庫確保を待たず、確保結果を非同期で受け取るようになる">
  <rect class="node" x="60" y="20" width="200" height="56" rx="8"/>
  <text class="lbl" x="160" y="48">注文受付</text>
  <rect class="node node--chg" x="400" y="20" width="200" height="56" rx="8"/>
  <text class="lbl" x="500" y="48">在庫サービス</text>
  <rect class="node node--new" x="740" y="20" width="200" height="56" rx="8"/>
  <text class="lbl" x="840" y="48">確保待ちキュー</text>

  <path class="edge" d="M 160 76 L 160 400" style="marker-end:none; stroke-dasharray:6 5"/>
  <path class="edge" d="M 500 76 L 500 400" style="marker-end:none; stroke-dasharray:6 5"/>
  <path class="edge" d="M 840 76 L 840 400" style="marker-end:none; stroke-dasharray:6 5"/>

  <path class="edge" d="M 160 130 L 494 130"/>
  <text class="lbl lbl--sm" x="330" y="112">1. 在庫の確保を依頼</text>

  <path class="edge edge--chg" d="M 500 200 L 834 200"/>
  <text class="lbl lbl--sm" x="670" y="182">2. 確保要求を積む</text>

  <path class="edge edge--chg" d="M 500 270 L 166 270"/>
  <text class="lbl lbl--sm" x="330" y="252">3. 受付完了をすぐ返す</text>

  <path class="edge edge--chg" d="M 840 350 L 166 350"/>
  <text class="lbl lbl--sm" x="500" y="332">4. 確保結果を後から通知</text>
</svg>
```

---

### D. 状態遷移図 → `fig-summary` / `fig-impact` / `fig-why` で使える

**ステータス・権限・ライフサイクルの変更**に向く。新しく増えた状態には `node node--new` を付ける。**新しく増えた遷移も、条件が変わった遷移も `edge edge--chg`** で描く (矢印に「新規」の色はない)。状態という概念がない PR には使わない (無理に描くと捏造になる)。

```svg
<svg viewBox="0 0 1000 340" role="img" aria-label="状態遷移: 受付済と確定の間に在庫確保中の状態が追加される">
  <rect class="node" x="30" y="140" width="180" height="70" rx="35"/>
  <text class="lbl" x="120" y="175">受付済</text>

  <rect class="node node--new" x="290" y="140" width="220" height="70" rx="35"/>
  <text class="lbl" x="400" y="175">在庫確保中</text>

  <rect class="node" x="590" y="140" width="180" height="70" rx="35"/>
  <text class="lbl" x="680" y="175">確定</text>

  <rect class="node" x="590" y="20" width="180" height="70" rx="35"/>
  <text class="lbl" x="680" y="55">取消</text>

  <path class="edge edge--chg" d="M 214 175 L 284 175"/>
  <text class="lbl lbl--sm" x="249" y="145">確保開始</text>

  <path class="edge edge--chg" d="M 514 175 L 584 175"/>
  <text class="lbl lbl--sm" x="549" y="145">確保成功</text>

  <path class="edge edge--chg" d="M 400 214 L 400 290 L 860 290 L 860 55 L 774 55"/>
  <text class="lbl lbl--sm" x="600" y="315">確保失敗</text>

  <path class="edge" d="M 120 140 L 120 55 L 584 55"/>
  <text class="lbl lbl--sm" x="350" y="30" style="text-anchor:start">利用者による取消</text>
</svg>
```

---

### E. 読む順路の図 → `fig-path` (必須)

番号付きの箱を読む順に並べる。

- **箱は「関心事」であり、ファイルではない。** 1 ファイル 1 箱にしない。マイグレーション + モデル + テストにまたがる 1 つの関心事は**まとめて 1 箱**である。
- **2〜6 ステップが標準、8 が上限。**
- 番号は `① 入口の変更` のようにラベルの先頭に入れる。番号バッジに色を使わない (色は 3 つの意味に予約されている)。
- 配置: **4 箱以下は 1 行、5〜8 箱は 2 行**。1000 幅に 8 箱を 1 行では入らない。
- 外側から内側へ (入口 → 業務ロジック → 永続化 → テスト) は**有用な既定であって規則ではない**。その PR の筋が通る順を選ぶ。

```svg
<svg viewBox="0 0 1000 300" role="img" aria-label="読む順路: 送信履歴の器、重複判定、送信処理、テストの4ステップ">
  <rect class="node node--new" x="30" y="60" width="200" height="90" rx="8"/>
  <text class="lbl" x="130" y="95">① 送信履歴の器</text>
  <text class="lbl lbl--sm" x="130" y="122">テーブルとモデル</text>

  <rect class="node node--new" x="290" y="60" width="200" height="90" rx="8"/>
  <text class="lbl" x="390" y="95">② 重複の判定</text>
  <text class="lbl lbl--sm" x="390" y="122">照会のロジック</text>

  <rect class="node node--chg" x="550" y="60" width="200" height="90" rx="8"/>
  <text class="lbl" x="650" y="95">③ 送信処理</text>
  <text class="lbl lbl--sm" x="650" y="122">判定の差し込み</text>

  <rect class="node node--new" x="810" y="60" width="160" height="90" rx="8"/>
  <text class="lbl" x="890" y="95">④ テスト</text>
  <text class="lbl lbl--sm" x="890" y="122">重複時の期待</text>

  <path class="edge" d="M 234 105 L 284 105"/>
  <path class="edge" d="M 494 105 L 544 105"/>
  <path class="edge" d="M 754 105 L 804 105"/>

  <text class="lbl lbl--sm" x="500" y="220">器 → 判定 → 差し込み → 検証</text>
  <text class="lbl lbl--sm" x="500" y="250">先に器を見ないと判定のコードが読めない</text>
</svg>
```

本文 (`{{FILL:TEXT_PATH}}`) では、各ステップを **1 ステップ約 80 文字まで**で説明する。

---

### F. 影響範囲図 → `fig-impact` (任意)

変更を中心に置き、影響が及ぶ先を放射状に配置する。**共有コード・スキーマ・公開 API のように、変更したファイルから遠い場所まで波及する変更**に向く。

**影響が変更したファイルの中に収まっているなら、`fig-impact` を `<figure>` ごと削除し、本文で「内部的な変更に留まる」と書く。** 画面や API を捏造してはならない。

```svg
<svg viewBox="0 0 1000 440" role="img" aria-label="影響範囲: 送信履歴の追加が管理画面・集計レポート・外部連携に波及する">
  <rect class="node node--chg" x="360" y="180" width="280" height="80" rx="8"/>
  <text class="lbl" x="500" y="210">通知の送信</text>
  <text class="lbl lbl--sm" x="500" y="238">この PR の変更点</text>

  <rect class="node" x="40" y="40" width="240" height="70" rx="8"/>
  <text class="lbl" x="160" y="75">管理画面の一覧</text>

  <rect class="node" x="720" y="40" width="240" height="70" rx="8"/>
  <text class="lbl" x="840" y="75">集計レポート</text>

  <rect class="node" x="40" y="330" width="240" height="70" rx="8"/>
  <text class="lbl" x="160" y="365">外部連携の通知</text>

  <rect class="node" x="720" y="330" width="240" height="70" rx="8"/>
  <text class="lbl" x="840" y="365">日次バッチ</text>

  <path class="edge edge--chg" d="M 380 186 L 286 110"/>
  <path class="edge edge--chg" d="M 620 186 L 714 110"/>
  <path class="edge edge--chg" d="M 380 254 L 286 330"/>
  <path class="edge" d="M 620 254 L 714 330"/>
</svg>
```

---

### `fig-why` (任意)

課題の構造を示すのに **C (シーケンス) や D (状態遷移)** が使える。ただし `fig-summary` が既に「課題 → 解決後」を示しているので、**文章で足りるなら `<figure>` ごと削除する**。ここに図を強制すると、PR 本文にない背景を捏造する方向に働く。

---

## 図を書き終えたら

1. **必須 3 枚があるか。** `fig-summary` / `fig-map` / `fig-path` は**常に必須**である。図を描かない判断は存在しない。機械的な PR (依存バージョン更新など) はこのスキルの対象外であり、呼び出し側で除外される。
2. **任意の図を使わない場合は `<figure>` 要素ごと丸ごと削除する。** 空の `<figure>` を残してはならない。検証スクリプトが失敗し、ブラウザには枠線だけの空白の箱が表示される。figcaption と差し込みスロットも `<figure>` の中にあるので一緒に消える。
3. **セクション本体 (`<section>`) は残す。** 任意の図を落としたセクションも、`{{FILL:TEXT_*}}` は `<figure>` の外にあるので**埋める必要がある**。
4. **すべての図の `<svg>` に `viewBox` があり、`width` / `height` 属性がないか。** 検証スクリプトのハード検証項目。
5. **修飾クラスが基底クラスと併記されているか。** `node--chg` / `edge--chg` / `lbl--sm` の単独使用がないか。
6. **すべての矢印の端点が、接続先の箱の辺の上にあるか。** [座標は流用できない](#座標は流用できない-最頻出の事故) の自己点検を行う。例の `d=` を写したまま箱を動かした図は、検証を通過したうえでレビュアーに嘘を伝える。
7. **独自の色を持ち込んでいないか。** `fill=` / `stroke=` / `style="fill:..."` / `style="stroke:..."` がないか。
8. **mermaid 記法や `<script>` が混入していないか。**
