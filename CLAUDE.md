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
---
```

## 注意事項

- `gh skill publish --dry-run` で警告を確認してからパブリッシュする
- `description` は1024文字以内に収める（超過すると警告が出る）
- `license` フィールドは必ず記載する
