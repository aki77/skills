---
name: dedupe-apm-local-rules
description: >-
  APM パッケージ由来ルール（.claude/rules/*.md）と重複するプロジェクト固有ローカルルール
  （.apm/instructions/*.local.instructions.md）を検出し、ローカル側を削除・縮小する。未管理ルールの
  新規移行は行わない（それは migrate-rules-to-apm の役割）。手動実行専用（自動トリガーしない）。
license: MIT
disable-model-invocation: true
---

# dedupe-apm-local-rules

プロジェクト固有のルールは `.apm/instructions/*.local.instructions.md` が正のソースであり、
`apm install` を実行すると `.claude/rules/` 直下にフラット配置でデプロイされる。`.claude/rules/` 直下に
プロジェクト固有ルールと外部APMパッケージ由来のルールが混在するのは、`.apm/instructions/` がサブディレクトリを
認識せずフラット展開するためで、ファイル名では区別できない。**必ず `apm.lock.yaml` を見て判定する**：
トップレベルの `local_deployed_files` に列挙されたファイルがプロジェクト固有ルール（正ソースは
`.apm/instructions/*.local.instructions.md`）、各依存パッケージエントリ配下の `deployed_files` に
列挙されたファイルが外部APMパッケージ由来のルールである。外部パッケージ由来のファイルは
**直接編集してはいけない**（次回 `apm install`/更新で上書きされる、またはハッシュ不整合として検出される）。

このスキルは、プロジェクト固有ルール（`local_deployed_files` およびその正ソースである
`*.local.instructions.md`）の内容が外部パッケージ由来のファイルと重複していないか、あるいは外部側が
バージョンアップしてプロジェクト固有側の記述が不要になっていないかを確認し、**プロジェクト固有側だけを
編集して**重複を除去する。
まだAPM管理下に取り込まれていない未管理ルールの新規移行は本スキルの対象外。

## 実行手順

### 1. 対象ファイルを洗い出す

```bash
ls .apm/instructions/*.local.instructions.md   # プロジェクト固有ルールの正ソース
cat apm.lock.yaml   # local_deployed_files（プロジェクト固有）と各依存の deployed_files（外部由来）を確認
```

`apm.lock.yaml` の `local_deployed_files` に列挙されたファイルがプロジェクト固有ルールのデプロイ実体、
各依存パッケージエントリの `deployed_files` に列挙されたファイルが外部APMパッケージ由来のルールである。
どちらのリストにも載っていない `.claude/rules/*.md` があれば、それはAPM未管理の手動配置ファイル
（本スキルの対象外、[migrate-rules-to-apm](../migrate-rules-to-apm/SKILL.md) の対象）。

`.apm/instructions/*.local.instructions.md` の frontmatter (`applyTo`) を見て、どの `app/**`, `spec/**`
等のパスに対するルールかを把握する。多くのファイルは `app-controllers.local.instructions.md` →
`app/controllers/**/*.rb` のように、`local_deployed_files` 中の同名・同テーマファイル（`app-controllers.local.md`）
と1対1で対応しており、さらにそれが外部パッケージ側の同テーマファイル（`controllers.md`）と対応している。
本スキルは `.local.instructions.md` が展開済み・自己完結していることを前提とする
（`@` 参照の展開は [migrate-rules-to-apm](../migrate-rules-to-apm/SKILL.md) の役割）。

### 2. 対応するペアを見つけて内容を比較する

プロジェクト固有側の各ファイルについて、`applyTo`（≒デプロイ後の `paths:`）が重なる、外部パッケージ由来の
（`apm.lock.yaml` の依存エントリ配下 `deployed_files` に列挙された）`.claude/rules/*.md` を探す
（無ければ「対応ファイルなし」として対象外）。両者を並べて読み、次の観点で仕分けする：

- **完全重複**（プロジェクト固有側に独自内容が無い）→ 削除してよい候補
- **一部重複**（プロジェクト固有側に、外部パッケージ側には無い独自ルールが混ざっている）→ 重複部分を削り独自部分だけ残す
- **重複なし**（プロジェクト固有のテーマ）→ 変更不要
- **外部パッケージ側の方が古い/プロジェクト固有側が古い**の判定に注意する。文言が違っても趣旨が同じなら重複とみなし、
  より新しく詳細な方を正とする。どちらが新しいか判断がつかない場合はユーザーに確認してよい

Explore や Read で複数ファイルを並行して読み、重複判定を一つずつ言語化してから次に進む。ここを雑にやると
必要なルールを消してしまう事故につながるため、判定の根拠（重複している具体的な見出し・箇条書き）を
明確にすること。

### 3. プロジェクト固有側（.apm/instructions/*.local.instructions.md）を書き換える

- 完全重複ファイルは削除する（`git rm .apm/instructions/<name>.local.instructions.md`）。あわせて
  `apm install` を実行し、対応する `.claude/rules/<name>.local.md` を消す
- 一部重複ファイルは、重複する見出し・箇条書きを削除し、独自内容だけを残した本文に書き換える。
  frontmatter（`applyTo`）は変更しない
- **`.claude/rules/*.local.md`（デプロイ後の実体）は直接編集しない**。ソースである
  `.apm/instructions/*.local.instructions.md` を編集してから `apm install` を実行し、反映する
- 見出しや文体は、外部パッケージ由来の既存ファイルの体裁（である調、コード例のコメントスタイル）に合わせる

### 4. 確認なしで最後まで実行する

このスキルは差分レポートを出して承認を待つのではなく、判定から編集・削除まで一気に行う。
**ただし git commit は行わない** — 変更後の状態はユーザーが `git diff` で確認し、必要なら手動で
コミットする。作業の最後に、変更したファイルと削除したファイルの一覧、および判定の要約（何が重複と
判断されどう処理したか）を簡潔に報告する。

### 5. 参照漏れの確認

削除・縮小したファイルを他のどこかが参照していないか、念のため確認する：

```bash
grep -rn "<削除したファイル名>" --include="*.md" --include="*.rb" . 2>/dev/null | grep -v vendor
```

`.specs/*.md` のような過去の実装記録ドキュメントからの参照は、リンク切れになっても実害が小さいため
更新不要（過去の記録として残す）。CLAUDE.md や現行の rules/skills からの参照は必ず解消すること。

未管理ルール（`.apm/instructions/` にまだ取り込まれていない `.claude/rules/*.md` 等）を見つけた場合、
その新規移行は [migrate-rules-to-apm](../migrate-rules-to-apm/SKILL.md) の役割であり、本スキルでは扱わない。

## 注意点

- `apm.lock.yaml` の依存エントリ配下 `deployed_files` に列挙されたファイルは外部APMパッケージ由来であり、
  **絶対に直接編集・削除しない**
- `local_deployed_files` に列挙されたファイルもデプロイ後の生成物であり、直接編集しても次回
  `apm install` で上書きされる。**必ず `.apm/instructions/*.local.instructions.md` 側を編集する**
- プロジェクト固有側で「独自内容」と判断する基準は、外部パッケージ側に存在しない具体的なルール・コード例・
  数値基準（閾値、禁止パターン、プロジェクト固有の用語）があるかどうか。単なる言い回しの違いは重複とみなす
- 判定に迷うペア（例: 意図的な方針転換に見える差分）があれば、削除せずユーザーに確認してから進める
