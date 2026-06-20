---
name: commit-push-pr
description: Commit, push, and open a PR
license: MIT
allowed-tools: Bash(git checkout -b:*), Bash(git add:*), Bash(git status:*), Bash(git branch:*), Bash(git config:*), Bash(git push:*), Bash(git commit:*), Bash(gh pr create:*), Bash(gh repo view:*), Skill(commit)
---
## Context

- Current git status: !`git status`
- Current branch: !`git branch --show-current`
- PR base branch: !`b=$(git branch --show-current); gh=$(git config branch."$b".github-pr-base-branch 2>/dev/null); gh=${gh##*#}; vsc=$(git config branch."$b".vscode-merge-base 2>/dev/null); vsc=${vsc#origin/}; base=${gh:-$vsc}; [ -n "$base" ] && echo "$base" || (gh repo view --json defaultBranchRef --jq '.defaultBranchRef.name' 2>/dev/null || git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null | sed 's|refs/remotes/origin/||')`
- Commits to be included in this PR: !`b=$(git branch --show-current); gh=$(git config branch."$b".github-pr-base-branch 2>/dev/null); gh=${gh##*#}; vsc=$(git config branch."$b".vscode-merge-base 2>/dev/null); vsc=${vsc#origin/}; base=${gh:-$vsc}; [ -z "$base" ] && base=$(gh repo view --json defaultBranchRef --jq '.defaultBranchRef.name' 2>/dev/null || git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null | sed 's|refs/remotes/origin/||'); git log origin/${base}..HEAD --oneline 2>/dev/null || git log ${base}..HEAD --oneline`
- Full diff against base branch: !`b=$(git branch --show-current); gh=$(git config branch."$b".github-pr-base-branch 2>/dev/null); gh=${gh##*#}; vsc=$(git config branch."$b".vscode-merge-base 2>/dev/null); vsc=${vsc#origin/}; base=${gh:-$vsc}; [ -z "$base" ] && base=$(gh repo view --json defaultBranchRef --jq '.defaultBranchRef.name' 2>/dev/null || git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null | sed 's|refs/remotes/origin/||'); git diff origin/${base}..HEAD 2>/dev/null || git diff ${base}..HEAD`

## あなたのタスク

上記の変更内容に基づいて:

1. デフォルトブランチにいる場合は新しいブランチを作成する（ブランチ名は変更内容から直感的に付ける。例: `feat/add-login-page`、`fix/null-pointer-error`）
2. 未コミットの変更がある場合は、`/commit` スキル（Skill ツール）を呼び出してコミットを作成する。コミットメッセージの形式・粒度分割・body のルールは commit スキルに委ねる。未pushコミットのみで未コミット変更がない場合はこの手順をスキップする
3. ブランチをoriginにプッシュする
4. `gh pr create` を使用してプルリクエストを作成する。`--base` には上記 "PR base branch" の値を使う。これは記録済みの分岐元を尊重するため、デフォルトブランチとは限らない（stacked PR に対応するため）。PRタイトルは "Commits to be included in this PR" の内容全体を要約したConventional Commits形式（`type: subject`）にする。PR本文は "Commits to be included in this PR" と "Full diff against base branch" を参照して、全コミットの変更内容を漏れなくまとめる（箇条書き1〜3行程度）。PRタイトルおよび本文の言語は、PRに含まれるコミットメッセージの言語に揃える（未コミット変更があり `/commit` スキルを呼び出した場合は、そのスキルが生成したコミットメッセージの言語を参照する）
5. **各ステップを順番に実行してください。** 各ステップの要否を事前に判断した上で計画し、途中で確認を挟まずに進めます。未コミット変更がある場合は手順2で `/commit` スキルを呼び出し、その完了後に手順3以降（push・PR作成）を続けます。手順2を除く git/gh ツール呼び出しは可能な限りまとめて実行します。これらのツール呼び出し（`/commit` スキル呼び出しを含む）以外のテキストやメッセージを送信しないでください。
