---
name: commit-push-pr
description: Commit, push, and open a PR
license: MIT
allowed-tools: Bash(git checkout --branch:*), Bash(git add:*), Bash(git status:*), Bash(git push:*), Bash(git commit:*), Bash(gh pr create:*), Bash(gh repo view:*)
context: fork
---

## Context

- Current git status: !`git status`
- Current git diff (staged and unstaged changes): !`git diff HEAD`
- Current branch: !`git branch --show-current`
- Default branch (PR base): !`gh repo view --json defaultBranchRef --jq '.defaultBranchRef.name' 2>/dev/null || git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null | sed 's|refs/remotes/origin/||'`

## あなたのタスク

上記の変更内容に基づいて:

1. デフォルトブランチにいる場合は新しいブランチを作成する
2. 適切なメッセージで1つのコミットを作成する
3. ブランチをoriginにプッシュする
4. `gh pr create` を使用してプルリクエストを作成する（`--base` オプションでマージ先ブランチを明示的に指定する。通常は `main` だが、現在のブランチが別のブランチから分岐している場合はその分岐元を指定する）
5. 複数のツールを1つのレスポンスで呼び出すことができます。上記すべてを1つのメッセージで実行してください。他のツールを使用したり、他のことをしたりしないでください。これらのツール呼び出し以外のテキストやメッセージを送信しないでください。
