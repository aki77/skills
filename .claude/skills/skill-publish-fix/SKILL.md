---
name: skill-publish-fix
description: `gh skill publish --dry-run` を実行してスキルのフロントマター警告を自動修正するスキル。このプロジェクト（aki77/skills）専用。次の場合に必ず使用すること：(1)「publish 警告を修正して」「dry-run の警告を直して」「スキルをパブリッシュする前に確認・修正して」と言われた時、(2) `gh skill publish --dry-run` を実行して警告が出た時、(3)「license が抜けている」「description が長すぎる」などフロントマターの警告に言及した時。スキルの追加・更新後に忘れずに実行することを促す場面でも使うこと。
context: fork
disable-model-invocation: true
allowed-tools: Bash(gh skill publish --dry-run:*), Bash(python3:*), Read, Edit, Skill
---

# Skill Publish Fix

`gh skill publish --dry-run` の出力を解析し、スキルごとの警告を自動修正する。

## 手順

### 1. dry-run を実行して警告を取得

```bash
gh skill publish --dry-run 2>&1
```

出力例：
```
warning  diy-drawing    recommended field missing: license
warning  icon-generator recommended field missing: license
warning  japan-finance-expert  description is 1098 chars (recommended max: 1024)
warning  japan-finance-expert  recommended field missing: license
warning               no active tag protection rulesets found. ...
```

### 2. スキルごとの警告を整理

- スキル名のない警告（リポジトリ設定系）は**スキップ**する
- スキル名つき警告のみを修正対象とする

### 3. 各警告を修正する

#### `recommended field missing: license`

対象スキルの `skills/<name>/SKILL.md` のフロントマターに `license: MIT` を追加する。
追加位置は `description:` フィールドの直後が慣例。

```yaml
---
name: example
description: ...
license: MIT
---
```

#### `description is N chars (recommended max: 1024)`

`gh skill publish --dry-run` は **UTF-8 バイト数**でカウントする（文字数ではない）。
日本語1文字 = 3バイトなので、日本語 description は思ったより多くカウントされる。

修正方針：
1. 現在の description の意味・トリガー条件を損なわないように短縮する
2. キーワードリストが長い場合は代表的なものだけ残し「など」でまとめる
3. 同義表現や冗長な言い回しを削除する
4. 短縮後に `python3 -c "print(len('...'.encode('utf-8')))"` でバイト数を確認する

短縮後は **1024バイト以下**になっていることを確認すること。

### 4. 再確認

修正後に再度 `gh skill publish --dry-run 2>&1` を実行し、スキル固有の警告がすべて消えたことを確認する。
