---
name: commit-push-pr
description: Commit, push, and open a PR
license: MIT
allowed-tools: Bash(git checkout -b:*), Bash(git add:*), Bash(git status:*), Bash(git push:*), Bash(git commit:*), Bash(gh pr create:*), Bash(gh repo view:*)
context: fork
---
## Context

- Current git status: !`git status`
- Current git diff (staged and unstaged changes): !`git diff HEAD`
- Current branch: !`git branch --show-current`
- Default branch (PR base): !`gh repo view --json defaultBranchRef --jq '.defaultBranchRef.name' 2>/dev/null || git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null | sed 's|refs/remotes/origin/||'`
- Likely PR base (closest ancestor branch): !`current=$(git branch --show-current); git for-each-ref --format='%(refname:short)' refs/heads | grep -vx "$current" | while read b; do mb=$(git merge-base "$b" HEAD 2>/dev/null) || continue; ahead=$(git rev-list --count "$mb..HEAD"); [ "$ahead" -gt 0 ] && echo "$ahead $b"; done | sort -n | head -1 | awk '{print $2}'`

## あなたのタスク

上記の変更内容に基づいて:

1. デフォルトブランチにいる場合は新しいブランチを作成する（ブランチ名は変更内容から直感的に付ける。例: `feat/add-login-page`、`fix/null-pointer-error`）
2. 変更内容を要約したConventional Commits形式（`type: subject`）で1つのコミットを作成する
3. ブランチをoriginにプッシュする
4. `gh pr create` を使用してプルリクエストを作成する。`--base` には上記 "Likely PR base (closest ancestor branch)" の値を使う。これは現在のブランチの実際の分岐元であり、デフォルトブランチとは限らない（stacked PR に対応するため）。"Likely PR base" が空の場合のみ "Default branch" にフォールバックする。PR本文は変更内容を簡潔にまとめる（箇条書き1〜3行程度）
5. 複数のツールを1つのレスポンスで呼び出すことができます。上記すべてを1つのメッセージで実行してください。他のツールを使用したり、他のことをしたりしないでください。これらのツール呼び出し以外のテキストやメッセージを送信しないでください。
