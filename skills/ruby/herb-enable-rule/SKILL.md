---
name: herb-enable-rule
description: "herb-lint (.herb.yml で enabled: false のルール) を1つ有効化する手順。「herb のルールを有効化して」「herb-lint の <ルール名> を on にして」などと言われたら必ず使う。herb-lint 以外の linter には使わない。"
license: MIT
---

# herb-lint ルールの有効化

## このスキルの目的と背景

herb-lint 導入時、既存ERBで違反が出たルールを `.herb.yml` で一旦すべて
`enabled: false` にし、**「違反を解消したルールから順次再有効化する」**方針を取っているプロジェクトを対象とする。
`.herb.yml` に `enabled: false` のルールが残っており、ERBビューの修正を進めながら1つずつ有効化していく構成であることが前提。

このスキルは、無効化中のルールを1つ選んで有効化する繰り返し作業を、毎回同じ品質で正確に行うためのもの。
肝は **「自動修正で素直に直せるものは直し、機械的共通化が可読性・意味を損なうものは無理に直さず exclude する」**
という振り分けの判断にある。ルールを有効化して違反を全部潰すのではなく、**そのルールの趣旨に照らして
正しい状態にする**のがゴール。

## 前提知識（herb-lint 固有の挙動。ここを外すと手戻りする）

- **対象は `.erb` のみ**。Haml は haml-lint、埋め込みRubyの品質は erb_lint が担当（`.herb.yml` 冒頭参照）。
- **重大度はルールと違反内容で変わる**。多くの構造系違反は `error` だが、「分岐の重複タグ」のように
  中身が違うケースは `hint` レベルになることがある。CI（herb_lint ワークフロー）は
  `pnpm exec herb-lint app/views --github --no-color` を `--fail-level` 指定なし（=`error`）で実行するため、
  **hint/warning は CI を素通りしてアノテーション表示されるだけ**。だがプロジェクト方針は
  「違反0で有効化」なので、検証は必ず `--fail-level hint` まで上げて0件を確認する。
- **glob のパス基準はリポジトリルートからの相対パス**。herb は対象ファイルを「`.herb.yml` のある
  ディレクトリ＝リポジトリルートからの相対パス」に正規化して照合する。よって exclude パターンは
  `app/views/...` 形式のリポジトリ相対で書く。**検証時に `-c` で外部ディレクトリの config を渡すと
  この基準がずれて exclude が効かない**ので、効き目の最終確認は必ずプロジェクトルートの実 `.herb.yml` で行う。
- **`--fix` は安全に直せるものだけ自動修正する**。分岐の外にタグを出せる単純なケースは直すが、
  分岐内に複数要素・追加要素があるケースは触らない（壊さないための保守的な挙動）。この性質が
  そのまま「自動修正で潰す／exclude する」の振り分け材料になる。
- ルール config に `exclude:` を書くと、そのルールが `enabled: true` のまま特定ファイルだけ無効化できる。
  `enabled: false` を消すだけで有効化され、ルールキー自体は exclude を持たせるため残す。

## 手順

### 1. 対象ルールを決め、現状の違反を抽出する

ユーザーがルール名を指定していなければ、`.herb.yml` の `enabled: false` 一覧から
**リスクの低いルールを優先して提案し**、ユーザーに確認する。

リスクの低いルールの判断基準（優先順）：

1. **構文・スタイル系** — コメント構文、セルフクロージング構文など。
   修正が自明で自動修正率が高く、ビューの意味・動作に影響しない。
   例: `erb-strict-locals-comment-syntax`、`html-no-self-closing`
2. **アクセシビリティ・属性系** — alt 属性、クラス名の補間など。
   機械的に修正できるが、画像の文脈によっては判断が必要なことがある。
   例: `html-img-require-alt`、`erb-no-interpolated-class-names`
3. **構造・意味系** — 未使用式、属性位置の出力、strict locals など。
   ファイルごとに修正戦略が変わり、exclude の判断が複雑になりやすい。
   例: `erb-no-unused-expressions`、`erb-no-output-in-attribute-position`、
       `actionview-strict-locals-partial-only`

そのルールだけを有効化した検証用 config をスクラッチパッドに作る。実 `.herb.yml` をコピーし、
**対象ルールの `enabled: false` 行を削除**（＝有効化）した版を用意するのが手軽で安全。
これで違反を一覧する：

```bash
# 検証用 config（対象ルールだけ有効）で違反を抽出。--simple が読みやすい
pnpm exec herb-lint app/views -c <scratchpad>/.herb.test.yml --no-color --no-timing --simple 2>&1 \
  | grep '<rule-name>'
```

違反がどのファイル・何件かを把握する。ファイルごとの件数は次で出せる：

```bash
pnpm exec herb-lint app/views -c <scratchpad>/.herb.test.yml --no-color --no-timing --simple 2>&1 \
  | awk '/^app\/views/{f=$0} /<rule-name>/{print f}' | sort | uniq -c
```

> 注意: ディレクトリ走査時と単一ファイル指定時で件数表示が変わることがある。件数の絶対値より
> 「どのファイルにどんな違反があるか」を正として進める。

### 2. `--fix` の挙動でファイルを振り分ける

実ファイルを汚さずに自動修正の結果を確認するため、**対象ファイルをスクラッチパッドにコピーしてから
`--fix` を試す**：

```bash
mkdir -p <scratchpad>/fixtest && cp <違反ファイル群> <scratchpad>/fixtest/
cp <scratchpad>/.herb.test.yml <scratchpad>/fixtest/.herb.yml
pnpm exec herb-lint "<scratchpad>/fixtest/**/*.erb" -c <scratchpad>/fixtest/.herb.yml --fix --no-color --no-timing
# 元ファイルと diff して、何がどう直ったかを見る
diff <元ファイル> <scratchpad>/fixtest/<同名>
```

結果を読んで各ファイルを次の3つに振り分ける：

- **自動修正で素直に直る** → `--fix` の結果がそのまま意図通り（例: 共通タグが分岐外に出て中身だけ分岐に残る）。
  これは実ファイルに `--fix` を適用して潰す。
- **`--fix` が触らない / 中途半端に残る** → 分岐ごとに要素数・追加要素・出力先が違うなど、
  機械的共通化が**意味的に壊す or 可読性を下げる**ケース。これは exclude 候補。
- **判断に迷う** → 共通化後のコードを実際に書いてみて、元より読みやすいか自問する。
  リンク先パスや出力内容といった「意味のある分岐」を三項演算子等で内側に押し込む形になるなら、
  たいてい exclude の方が良い。迷ったらユーザーに振り分け方針を確認する。

判断基準は「機械的共通化がそのビューの可読性・意味を損なうか」。損なうなら exclude が正しい。

### 3. 実ファイルを修正する

自動修正で潰すファイルに `--fix` を適用し、lint-staged と同じ整形を続けて当てる
（コミットフックでの再整形による差分を防ぐ）。

まず lint-staged の設定（`package.json` の `"lint-staged"` キー、または `.lintstagedrc` 等）を確認し、
ERB ファイルに対して実行されるツールを把握する。一般的には以下のようなコマンドが含まれる：

```bash
pnpm exec herb-lint <該当ファイル> --fix
# lint-staged に含まれる場合のみ実行する（プロジェクトによって異なる）：
bundle exec erb_lint -a <該当ファイル>
bundle exec htmlbeautifier --keep-blank-lines 1 <該当ファイル>
```

修正後は必ず差分を目視し、意味（翻訳キーの出し分け・条件分岐など）が壊れていないか確認する。

### 4. `.herb.yml` を編集してルールを有効化する

対象ルールの `enabled: false` を削除する。exclude 対象がある場合はルールキーを残して `exclude:` を持たせ、
**各除外パスの行末に理由を一言**書く（理由をパスと同じ行に置くと情報が一箇所に集約され、別ブロックでの
ファイル名重複も避けられる）。

```yaml
    # 機械的共通化が不適切なビューのみ除外（各行に理由を記載）
    <rule-name>:
      exclude:
        - 'app/views/path/to/foo.html.erb' # 除外理由を一言
        - 'app/views/path/to/bar.html.erb' # 除外理由を一言
```

exclude が不要（全違反を修正で潰せた）なら、`enabled: false` を消すだけ。既存の違反0ルールに倣い、
ルールキーごと削除してもよい。

### 5. 検証する

プロジェクトルートの実 `.herb.yml`（編集後）で、CI と同条件＋hint まで含めた厳しめ判定の両方を通す：

```bash
# CI と同条件（fail-level=error）。exit 0 を確認
pnpm exec herb-lint app/views

# hint/warning も拾う厳しめ判定。ここで 0 offenses を確認するのが本番
pnpm exec herb-lint app/views --fail-level hint
```

確認ポイント：

- `--fail-level hint` で **0 offenses / all files clean / exit 0**。
- サマリ末尾の `Rules: N enabled | M not enabled | ...` で **not enabled が1減っている**
  （対象ルールが有効側に移った証拠）。
- exclude が効いていることの対照確認（任意）: exclude の1行を一時コメントアウトして
  `--fail-level hint` を回すと当該ファイルの違反が再出現する → 戻す。
- `git diff .herb.yml <修正したビュー>` で意図した変更のみであることを確認。

### 6. ユーザーにコミットを委ねる

変更内容をユーザーに報告し、コミットはユーザー自身が行う。自動でコミットしない。

履歴のスタイルに倣ったコミットメッセージ例を提示するにとどめる：

```
fix: <何をどう修正したか> し herb-lint <rule-name> を有効化
```

自動修正と exclude の設計判断が混じる場合は、本文に「なぜ exclude したか／何を共通化したか」を書く。
例: `fix: 分岐の重複タグを共通化し herb-lint erb-no-duplicate-branch-elements を有効化`

## やってはいけないこと

- **exclude を `**/` の広いグロブでまとめない**。同名ファイルへ誤って効いたり、意図しないファイルまで
  ルールから外れる。対象を一意に絞れるリポジトリ相対の完全パスで書く。
- **CI が error しか見ないからと hint を放置しない**。プロジェクト方針はアノテーション0。
  `--fail-level hint` で0を確認するまで完了としない。
- **無理に共通化して可読性を犠牲にしない**。ルールを黙らせること自体が目的ではない。意味的に分けるべき
  分岐を1つのタグに押し込むくらいなら exclude する。
- **行単位の `<%# herb:disable %>` を第一選択にしない**。ネストしたタグ（tr>th>td 等）では各行に必要で
  ビューが汚れる。ファイル単位で外したいなら `.herb.yml` の rule 単位 exclude の方がクリーンで、
  除外理由も一箇所に集約できる。
  - **例外: herb のパーサ誤検知には行単位 disable が正解**。コード上は正しいのに lint が誤判定する
    ケース（例: `<%= tag.name %>` を HTML タグ `<name>` と誤認識）で、誤検知が1行に閉じていて
    他に違反のないファイルなら、ファイル全体を exclude するより行単位 disable の方が影響範囲が狭い。
    inline disable は[公式仕様](https://herb-tools.dev/projects/linter#disabling-a-single-rule)どおり
    **対象行の末尾**に `<%= ... %><%# herb:disable <rule-name> %>` で置く（前行に置くと効かず
    `herb-disable-comment-unnecessary` 違反になる）。
- **disable コメントの効果確認は必ず `.herb.yml` でルールを有効化した後に行う**。有効化前に検証すると、
  対象ルールが無効なので「違反が無いのに disable がある」と判定され `herb-disable-comment-unnecessary`
  が逆に発火し、検証が破綻する。手順4（`.herb.yml` 編集）を済ませてから手順5の検証に進むこと。
