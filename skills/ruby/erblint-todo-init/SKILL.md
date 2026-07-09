---
name: erblint-todo-init
license: MIT
disable-model-invocation: true
description: >-
  `bundle exec erblint app` の既存違反をファイル単位で無効化する todo ファイル群
  （`.erb_lint_todo.yml` / `.erb-lint-rubocop-todo.yml`）を生成・初期化する手順。手動起動専用
  （`/erblint-todo-init`）。todo を作り直したいときなど、一回性のセットアップ作業でのみ使う。
  rubocop 単体・haml-lint・herb-lint の運用には使わない。
---

# erblint todo 初期生成

## このスキルの目的と背景

erb_lint を新規導入した、またはリセットして作り直したいプロジェクトでは、既存ビューの違反が
数百件単位で一括検出される。全部を一度に直すのは非現実的なため、**違反をファイル単位で todo に
退避し、借金リストとして段階的に返済する**方針を取る。

このスキルは [[herb-enable-rule]] と対をなす「初期セットアップ」側。herb-enable-rule が
「todo から1ルールずつ有効化していく」のに対し、こちらは**まだ todo が存在しない、または
作り直したい状態から todo 一式を生成する**ところが担当範囲。**既存 todo からファイルを1件潰す
（ビュー修正のついでに該当行を消す）作業はこのスキルの対象外** — それは通常のビュー修正の一部。

## 前提知識（erb_lint 0.9.0 固有の挙動。ここを外すと壊れる）

- 各リンターは自身の config に `exclude:` を持てる。`File.fnmatch?` でリポジトリルートからの
  相対パス（`app/views/...`）と照合する（`linter_config.rb`）。
- erb_lint の設定ファイルは `inherit_from:` に対応しており、`inherit_gem:` と併用できる
  （`.erb_lint.yml` は既に `erblint-agent` gem を `inherit_gem` している）。
- **継承のマージは deep_merge で、Hash は再帰マージ・配列は置換。しかも `base(todo 側).deep_merge(本体側)`
  で本体側が勝つ**（`runner_config_resolver.rb` の `v.deep_merge(hash[k])`、`v` が todo 側の値）。
  つまり**同じリンターの `exclude` を本体と todo の両方に書くと、本体の配列が todo の配列を
  丸ごと上書きして消す**。よって「本体側には exclude を残さず todo に集約する」のが必須の設計。
  既存の `.erb_lint.yml` で特定リンター（独自リンター等）の exclude が本体になく todo 側のみに
  あるのはこのため。
- **`Rubocop` リンターは違反ファイルごとに tempfile を作って rubocop を起動する。tempfile の
  生成先はプロジェクトルート（`Dir.pwd`）**（`linters/rubocop.rb` の
  `Tempfile.create(File.basename(filename), Dir.pwd)`）。したがって
  `rubocop_config.inherit_from` に書く rubocop todo への相対パスは、実行ディレクトリに関わらず
  プロジェクトルート基準で解決され、正しく効く。
- **`--auto-gen-config` 相当の機能は erb_lint に無い**。rubocop と違い todo は自動生成されないので、
  違反一覧から手動（スクリプト）で組み立てる。本スキルは同梱スクリプト `generate_erblint_todo.rb`
  でこれを自動化する。
- rubocop 由来 todo（`.erb-lint-rubocop-todo.yml`）は `.rubocop.yml` からは参照しない。
  erblint 専用の Exclude であり、通常の `bin/rubocop` 実行には一切影響させない。

## 手順

### 1. 違反を JSON で抽出する

```bash
bundle exec erblint app --format json > <scratchpad>/erblint.json
```

構造は `files[].path` と `files[].offenses[]`（各 offense に `linter` / `message` / `location`）。

### 2. リンター種別で分類し件数を把握する

`linter == "Rubocop"` が rubocop 由来の違反、それ以外（`StrictLocals` や `inherit_gem` した
独自リンター gem 提供のリンター等）が erb_lint 独自リンターの違反。リンターごとの件数・
対象ファイル数を集計して全体像をつかむ。

### 3. 同梱スクリプトで todo 2 ファイルを生成する

手順1の JSON を同梱スクリプト `scripts/generate_erblint_todo.rb` に渡すと、rubocop 由来の offense
から `.erb-lint-rubocop-todo.yml`（cop×ファイル単位の Exclude）、erb_lint 独自リンターの offense
から `.erb_lint_todo.yml`（`linters.<Name>.exclude`）を、プロジェクトルートに生成する。
手順1と統合し、`--format json` の出力を直接パイプしてよい（中間ファイル不要。デバッグ時は
`<scratchpad>/erblint.json` に一度落として引数で渡してもよい）：

```bash
bundle exec erblint app --format json \
  | ruby .claude/skills/erblint-todo-init/scripts/generate_erblint_todo.rb
```

生成されるファイルの先頭コメントの生成日はスクリプト実行時の日付が自動で入る。

**その種別の違反がゼロなら、対応する todo は生成されない**（空の todo は inherit_from で読ませても
何も除外しない無意味なファイルになるため）。加えて、再生成時に既存の同名 todo が残っていて今回
違反ゼロなら、その古い todo はスクリプトが削除する。スクリプトは各ファイルについて `Wrote` /
`Removed` / `Skipped` のいずれかを stderr に出すので、**どちらが生成されたか（＝手順5で
inherit_from に足すべきファイルはどれか）を必ずこの出力で確認する**。両種別ともゼロなら
そもそも todo 運用は不要で、以降の手順もスキップしてよい。

### 4. 本体 `.erb_lint.yml` の既存 exclude を todo へ移設する

`.erb_lint_todo.yml` が**生成された場合のみ**この手順を行う（独自リンターの違反がゼロで生成
されなかったなら移設先がないのでスキップ）。**本体 `.erb_lint.yml` に同名リンターの既存
`exclude` があれば、そのエントリを todo 側（`.erb_lint_todo.yml` の該当リンターの `exclude`）に
移設して統合する**（前提知識の deep_merge 上書き対策。本体には残さない）。この判断はスクリプトでは
自動化しない — 既存 exclude の有無・移設可否そのものが人間/エージェントの判断を要するため、手順3の
スクリプト生成後に手動で行う。

なお、トップレベルの `exclude:`（`EnableDefaultLinters` に対するグローバル除外。kaminari テーマ等）は
個別リンターの `exclude` ではないため deep_merge 上書きの対象外で、移設不要。本体に残してよい。

### 5. `.erb_lint.yml` 本体を編集する

**手順3で実際に生成された todo だけを inherit_from に足す**（生成されなかった空 todo を参照させると、
存在しないファイルを inherit する、または無意味な参照が残る）。

- `.erb_lint_todo.yml` が生成された場合のみ、トップレベル（`inherit_gem` の直後）に
  `inherit_from: [.erb_lint_todo.yml]` を追加する。
- 手順4で todo に移設した exclude は本体側から削除し、削除した理由を一言コメントで残す
  （例: `# NOTE: exclude は .erb_lint_todo.yml に集約する（本体に残すと inherit_from の
  deep_merge で todo 側の配列を上書きしてしまうため）`）。
- `.erb-lint-rubocop-todo.yml` が生成された場合のみ、`linters.Rubocop.rubocop_config.inherit_from`
  に `.erb-lint-rubocop-todo.yml` を追記する（既存の `.rubocop.yml` と並べる）。

## 検証

1. `bundle exec erblint app` が **No errors were found**（exit 0）になることを確認する。
2. 回帰チェックを、**生成された todo それぞれ**で1回ずつ行う: todo から1行だけ一時的に削除
   → 該当違反が復活することを確認 → 元に戻す。deep_merge 集約（`.erb_lint_todo.yml`）と
   tempfile 経由の inherit_from 解決（`.erb-lint-rubocop-todo.yml`）が正しく機能していることの
   実証になる。生成されなかった種別は対象がないのでスキップ。
3. `.rubocop.yml` が `.erb-lint-rubocop-todo.yml` を参照していないことを `grep` で確認する
   （通常の `bin/rubocop` に非干渉であることの担保。rubocop todo が生成された場合のみ）。

## やってはいけないこと

- 本体 `.erb_lint.yml` に exclude を残したまま同じリンターの exclude を todo にも書く
  （deep_merge で本体が勝ち、todo 側が丸ごと消える）。
- rubocop todo（`.erb-lint-rubocop-todo.yml`）を `.rubocop.yml` から inherit させる
  （通常の rubocop 実行にまで Exclude が波及してしまう）。
- todo を手書きで積み増す。必ず `--format json` の出力から機械生成し、件数を突き合わせて検証する。
- 違反ゼロの種別に対して空の todo（`linters:` だけ、cop エントリなし）を生成して inherit_from に
  足す。何も除外しない無意味な参照が残り、運用上のノイズになる。生成有無はスクリプトの stderr
  （`Wrote` / `Skipped` / `Removed`）で判断する。
- 対象を広げた glob（`**/`）で無効化する。同名ファイルへの誤爆を避けるため、必ずファイル単位の
  一意な相対パスで書く。

## 運用の引き継ぎ

生成後は、対象リンターの todo エントリをプロジェクトのビュー運用ルールに組み込む
（例: 「ビュー修正のついでに該当エントリを削除して違反を解消する」運用）。ルールの置き場所・
書式はプロジェクトごとに異なるため、既存のルールファイル群を確認して倣うこと。
