---
name: commit
description: Create a git commit
license: MIT
allowed-tools: Bash(git add:*), Bash(git status:*), Bash(git commit:*)
model: sonnet
---

## コンテキスト

- 現在のgitステータス: !`git status`
- 現在のgit差分（ステージ済みおよび未ステージの変更）: !`git diff --cached; git diff`
- 現在のブランチ: !`git branch --show-current`
- 最近のコミット: !`git log --oneline -10 2>/dev/null || echo "（コミット履歴なし）"`

## タスク

上記の変更に基づいて、適切な粒度でgitコミットを作成してください。

### メッセージ形式（Conventional Commits）

- `type: subject` 形式で記述する。`type` は変更内容に応じて `feat` / `fix` / `docs` / `refactor` / `test` / `chore` などから選ぶ
- subject は変更を簡潔に要約する。言語・scope の有無（例: `feat(pr-summary): ...`）は「最近のコミット」のスタイルに倣う

### コミット粒度

- 変更が複数の独立した論理単位（個別に revert できる単位）に分かれる場合は、コミットを分割する
- 機能追加とは無関係なフォーマット修正・typo 修正などが混在する場合は、別コミットに分ける
- 過剰な分割は避ける。1つの論理単位は1コミットにまとめる
- 分割する場合は `git add <path>` や `git add -p` で必要な変更だけをステージしてからコミットする

### 本文（body）

- 自明な変更は subject のみでよい
- 自明でない変更（設計判断・トレードオフ・非自明な理由を含む変更）では、本文に「なぜ」「何を」「どう判断したか」を記述する
- subject と body は空行で区切る

### 進め方

- 粒度を分割する場合は、各コミットの分割理由を一言添えてよい。ただし冗長な前置きは避け、ステージングとコミットのツール実行を中心に進める
- コミット以外の操作（push、PR 作成など）は行わない
