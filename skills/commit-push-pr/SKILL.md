---
name: commit-push-pr
description: Commit, push, and open a PR
license: MIT
allowed-tools: Bash(git checkout -b:*), Bash(git add:*), Bash(git status:*), Bash(git branch:*), Bash(git config:*), Bash(git push:*), Bash(git commit:*), Bash(gh pr create:*), Bash(gh repo view:*)
context: fork
---
## Context

- Current git status: !`git status`
- Current git diff (staged and unstaged changes): !`git diff HEAD`
- Current branch: !`git branch --show-current`
- PR base branch: !`b=$(git branch --show-current); gh=$(git config branch."$b".github-pr-base-branch 2>/dev/null); gh=${gh##*#}; vsc=$(git config branch."$b".vscode-merge-base 2>/dev/null); vsc=${vsc#origin/}; base=${gh:-$vsc}; [ -n "$base" ] && echo "$base" || (gh repo view --json defaultBranchRef --jq '.defaultBranchRef.name' 2>/dev/null || git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null | sed 's|refs/remotes/origin/||')`
- Commits to be included in this PR: !`b=$(git branch --show-current); gh=$(git config branch."$b".github-pr-base-branch 2>/dev/null); gh=${gh##*#}; vsc=$(git config branch."$b".vscode-merge-base 2>/dev/null); vsc=${vsc#origin/}; base=${gh:-$vsc}; [ -z "$base" ] && base=$(gh repo view --json defaultBranchRef --jq '.defaultBranchRef.name' 2>/dev/null || git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null | sed 's|refs/remotes/origin/||'); git log origin/${base}..HEAD --oneline 2>/dev/null || git log ${base}..HEAD --oneline`
- Full diff against base branch: !`b=$(git branch --show-current); gh=$(git config branch."$b".github-pr-base-branch 2>/dev/null); gh=${gh##*#}; vsc=$(git config branch."$b".vscode-merge-base 2>/dev/null); vsc=${vsc#origin/}; base=${gh:-$vsc}; [ -z "$base" ] && base=$(gh repo view --json defaultBranchRef --jq '.defaultBranchRef.name' 2>/dev/null || git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null | sed 's|refs/remotes/origin/||'); git diff origin/${base}..HEAD 2>/dev/null || git diff ${base}..HEAD`

## あなたのタスク

上記の変更内容に基づいて:

1. デフォルトブランチにいる場合は新しいブランチを作成する（ブランチ名は変更内容から直感的に付ける。例: `feat/add-login-page`、`fix/null-pointer-error`）
2. 変更内容を要約したConventional Commits形式（`type: subject`）で1つのコミットを作成する
3. ブランチをoriginにプッシュする
4. `gh pr create` を使用してプルリクエストを作成する。`--base` には上記 "PR base branch" の値を使う。これは記録済みの分岐元を尊重するため、デフォルトブランチとは限らない（stacked PR に対応するため）。PRタイトル・本文は "Commits to be included in this PR" と "Full diff against base branch" を参照して、全コミットの変更内容を漏れなくまとめる（箇条書き1〜3行程度）
5. 複数のツールを1つのレスポンスで呼び出すことができます。上記すべてを1つのメッセージで実行してください。他のツールを使用したり、他のことをしたりしないでください。これらのツール呼び出し以外のテキストやメッセージを送信しないでください。
