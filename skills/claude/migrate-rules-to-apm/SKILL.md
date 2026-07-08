---
name: migrate-rules-to-apm
description: >-
  APM未管理の .claude/rules ルール（手動配置・レガシーな local/ サブディレクトリ配置）および
  ルートの CLAUDE.md を .apm/instructions/*.local.instructions.md に一括移行するスキル。@参照は
  展開して本文に取り込み、参照元ファイルは他からの参照がなければ削除する。手動実行専用（自動トリガーしない）。
license: MIT
disable-model-invocation: true
---

# migrate-rules-to-apm

APM（Agent Package Manager）導入前・移行途中のプロジェクトでは、プロジェクト固有のルールが
`.claude/rules/*.md`（手動配置）や `.claude/rules/local/*.md`（レガシーなサブディレクトリ配置）に
置かれたままになっていることがある。また、ルート直下の `CLAUDE.md` も APM 管理外の手動ファイルとして
残っていることが多い。

このスキルは、それらの**APM未管理ファイルを `.apm/instructions/*.local.instructions.md` に一括移行**する。
本文中に `@path/to/file.md` 形式の参照（インクルード）がある場合はその中身を展開して自己完結させ、
参照元ファイルは他から使われていなければ削除する。

## 実行手順

### 1. 前提確認と対象ファイルの洗い出し

```bash
ls .apm/instructions/ 2>/dev/null
ls apm.lock.yaml 2>/dev/null
```

いずれも存在しない場合は APM 未導入。`apm init` 相当のセットアップが必要になるため、続行してよいか
ユーザーに確認する。

存在する場合は、`.claude/rules` 配下を再帰的に列挙する（直下・サブディレクトリ問わず）：

```bash
find .claude/rules -type f -name "*.md"
```

`apm.lock.yaml` の `deployed_files` / `local_deployed_files` を確認し、**どちらのリストにも
含まれないファイルすべて**を移行候補とする。判定はリスト包含で行う（`== false` 判定ではない）。

```bash
grep -A 30 "deployed_files:" apm.lock.yaml
```

加えて、ルートの `CLAUDE.md` の存在を確認する。`apm.lock.yaml` の `deployed_files` /
`local_deployed_files` に載っていなければ、これも移行候補（→ `project.local.instructions.md`）として
列挙する。

```bash
test -f CLAUDE.md && echo "CLAUDE.md は移行候補"
```

### 2. 各対象ファイルの内容を確認し `@` 参照を解決する

各移行候補ファイルについて：

- frontmatter の `paths:`（YAMLリスト）があれば読む
- 本文中の `@path/to/file.md` 参照を検出する。`[@doc/agent/general.md](doc/agent/general.md)` の
  ような markdown リンク形式も対象に含める
- 参照先ファイルを読み、**本文に展開（インライン化）**して自己完結させる。参照先がさらに `@` 参照を
  含む場合は再帰的に展開する
- 参照先が既に存在しない場合は、元ファイルにすでに本文化された内容が入っているはずなのでそれを使う

Explore や Read で複数ファイルを並行して読み、展開結果を一つずつ確認してから次に進む。

### 3. `.apm/instructions/<name>.local.instructions.md` を新規作成する

frontmatter は `description` と `applyTo` の2フィールドのみ：

- `description`: 本文の最初の H1 見出しをそのまま使う
- `applyTo`: 元の `paths:` のリストをカンマ区切り文字列に変換する
  （`paths: ["a", "b"]` → `applyTo: "a,b"`）。frontmatter が無く全パス適用にしたい元ファイルや、
  `CLAUDE.md` のようにプロジェクト全体に効かせたいものは `applyTo` を**記述しない**
  （パス未指定＝全パス適用）

CLAUDE.md の移行先ファイル名は `project.local.instructions.md` とする（APM パッケージ由来の
`general.md` との名前衝突を避けつつ「プロジェクト固有の全体ルール」であることを示す）。`applyTo` は
付けず全パス適用にする。

本文は手順2で `@` 参照を展開済みの内容を移植する。見出し・文体は既存 `.apm/instructions/*.local.instructions.md`
の体裁に合わせる（参考: `app-views.local.instructions.md` 等の既存プロジェクト固有ルール）。

### 4. 元ファイルと参照元ファイルを削除する

- 移行元の `.claude/rules` 配下ファイル（直下・サブディレクトリ問わず）を `git rm` する
- `.claude/rules/local/` 等のサブディレクトリが空になったらディレクトリごと削除する
- CLAUDE.md を移行した場合は、CLAUDE.md 本体も `git rm` する（内容は project.local に移行済み）
- `@` 参照の展開に使った参照元ファイル（`doc/agent/xxx.md` 等）について、他から参照が残っていないか
  確認する：

```bash
grep -rn "doc/agent/<ファイル名>" --include="*.md" --include="*.rb" . 2>/dev/null | grep -v vendor
```

参照が残っていなければ削除する。CLAUDE.md 自体を削除すれば CLAUDE.md からの参照も消えるため、
他から使われていない参照先ファイルは連鎖的に削除できる。CLAUDE.md 以外から参照が残る場合は、
展開済みで参照は不要になっているはずなので、その参照行を解消する（ファイル自体を消すかどうかは
参照元ファイルの用途による）。

参照先が複数箇所から使われる共有ファイルであるなど、削除の判断に迷う場合は、削除せずユーザーに確認する。

### 5. `apm install` / `apm audit` で検証する

```bash
apm install
apm audit
```

`apm install` で `.claude/rules/<name>.local.md` が正しく生成されることを確認する。`apm audit` で
lockfile 上の問題（ハッシュ不整合等）がないことを確認する。

### 6. 確認なしで最後まで実行し、最後に要約報告する

判定から編集・削除・検証まで一気に行う。**ただし git commit はしない** — 変更後の状態はユーザーが
`git diff` で確認し、必要なら手動でコミットする。

最後に、以下を簡潔に報告する：

- 移行したファイル（`.apm/instructions/*.local.instructions.md` として新規作成したもの）
- 削除したファイル（移行元・参照元）
- 展開した `@` 参照の一覧

## 注意点

- APM パッケージ由来の `.claude/rules/*.md`（`apm.lock.yaml` の `deployed_files` に載っている、
  `.local` サフィックス無しのファイル）は**絶対に移行・削除しない**（次回 `apm install` で復元される、
  またはハッシュ不整合として検出される）
- なぜ `.local` サフィックスか: `.apm/instructions/` はサブディレクトリを認識せずフラット展開するため、
  ファイル名の `.local` で由来を区別する
- `@` 参照展開の判断に迷うケース（参照先が複数箇所から使われる共有ファイル等）は、削除せずユーザーに確認する
