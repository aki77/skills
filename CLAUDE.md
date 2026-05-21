# skills

個人用のClaude Codeスキル集リポジトリ。

## ディレクトリ構造

```
skills/
  <skill-name>/
    SKILL.md          # スキル本体（必須）
    evals/
      evals.json      # 評価テストケース（任意）
      files/          # evalで参照するファイル（任意）
    references/       # スキルが参照する補助資料（任意）
```

## スキル管理コマンド

```bash
# publish前の検証（警告確認）
gh skill publish --dry-run

# パブリッシュ（全スキル）
gh skill publish
```

## SKILL.md フロントマター

```yaml
---
name: <skill-name>          # 必須
description: <説明>          # 必須（推奨: 1024文字以内）
license: MIT                 # 推奨
argument-hint: <ヒント>      # 任意
allowed-tools: <ツールリスト> # 任意
disable-model-invocation: true  # 任意（ツールのみ使用する場合）
context: fork               # 任意（フォークされたサブエージェントで実行）
agent: <エージェントタイプ>  # 任意（context: fork 時のエージェント指定）
---
```

## context: fork の適用基準

- **適用する**: 探索・分析系タスク（大量のdiff/ファイル読み込み）、会話履歴が不要な独立タスク
- **適用しない**: リファレンス/ガイドライン系スキル（タスクがない場合、サブエージェントが何もできない）
- `agent` 省略時は `general-purpose`。読み取り専用なら `Explore`、書き込みも使うなら指定不要

## 注意事項

- `gh skill publish --dry-run` で警告を確認してからパブリッシュする
- `description` は1024文字以内に収める（超過すると警告が出る）
- `license` フィールドは必ず記載する
