---
name: commit
description: Create a git commit
license: MIT
allowed-tools: Bash(git add:*), Bash(git status:*), Bash(git commit:*)
---

## コンテキスト

- 現在のgitステータス: !`git status`
- 現在のgit差分（ステージ済みおよび未ステージの変更）: !`git diff --cached; git diff`
- 現在のブランチ: !`git branch --show-current`
- 最近のコミット: !`git log --oneline -10 2>/dev/null || echo "（コミット履歴なし）"`

## タスク

上記の変更に基づいて、単一のgitコミットを作成してください。

1回のレスポンスで複数のツールを呼び出すことができます。ステージングとコミットを単一のメッセージで行ってください。他のツールの使用や追加の操作は行わないでください。ツール呼び出し以外のテキストやメッセージは送信しないでください。
