---
name: commit-push-pr
description: Commit, push, and create or update a PR
license: MIT
allowed-tools: Bash(git checkout -b:*), Bash(git add:*), Bash(git status:*), Bash(git branch:*), Bash(git config:*), Bash(git push:*), Bash(git commit:*), Bash(git log:*), Bash(git diff:*), Bash(gh pr create:*), Bash(gh pr list:*), Bash(gh pr edit:*), Bash(gh repo view:*), Skill(commit)
model: sonnet
---
## Context

- Current git status: !`git status`
- Current branch: !`git branch --show-current`
- PR base branch: !`b=$(git branch --show-current); gh=$(git config branch."$b".github-pr-base-branch 2>/dev/null); gh=${gh##*#}; vsc=$(git config branch."$b".vscode-merge-base 2>/dev/null); vsc=${vsc#origin/}; base=${gh:-$vsc}; [ -n "$base" ] && echo "$base" || (gh repo view --json defaultBranchRef --jq '.defaultBranchRef.name' 2>/dev/null || git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null | sed 's|refs/remotes/origin/||')`
- 既にコミット済みでこのPRに入るコミット集合 (base..HEAD): !`b=$(git branch --show-current); gh=$(git config branch."$b".github-pr-base-branch 2>/dev/null); gh=${gh##*#}; vsc=$(git config branch."$b".vscode-merge-base 2>/dev/null); vsc=${vsc#origin/}; base=${gh:-$vsc}; [ -z "$base" ] && base=$(gh repo view --json defaultBranchRef --jq '.defaultBranchRef.name' 2>/dev/null || git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null | sed 's|refs/remotes/origin/||'); (git log origin/"$base"..HEAD --oneline 2>/dev/null || git log "$base"..HEAD --oneline 2>/dev/null) | sed 's/^/  /'; echo "(↑これは起動時点のスナップショット。手順2で /commit が作る新規コミットはまだ含まれない)"`
- 既存PR (current branch): !`b=$(git branch --show-current); gh pr list --state open --head "$b" --json number,url,title,body --jq 'if length>0 then .[0] | "#\(.number) \(.url)\nTITLE: \(.title)\nBODY:\n\(.body)" else "(なし — 新規作成する)" end' 2>/dev/null || echo "(なし — 新規作成する)"`
- 既存PRの同一性チェック（先頭コミットがローカル履歴に存在するか）: !`b=$(git branch --show-current); n=$(gh pr list --state open --head "$b" --json number --jq '.[0].number' 2>/dev/null); if [ -z "$n" ]; then echo "(既存PRなし — チェック不要)"; else first=$(gh pr view "$n" --json commits --jq '.commits[0].oid' 2>/dev/null); if [ -z "$first" ]; then echo "(コミット情報取得失敗)"; elif git cat-file -e "$first" 2>/dev/null; then echo "OK: PR #$n の先頭コミット($first)はローカル履歴に存在する → 同一ブランチの続き"; else echo "警告: PR #$n の先頭コミット($first)がローカル履歴に存在しない → ブランチ名が同じだけの別件PRの可能性が高い。安易に上書き更新しない"; fi; fi`

## あなたのタスク

上記の変更内容に基づいて:

1. デフォルトブランチにいる場合は新しいブランチを作成する（ブランチ名は変更内容から直感的に付ける。例: `feat/add-login-page`、`fix/null-pointer-error`）
2. 未コミットの変更がある場合は、`/commit` スキル（Skill ツール）を呼び出してコミットを作成する。コミットメッセージの形式・粒度分割・body のルールは commit スキルに委ねる。未pushコミットのみで未コミット変更がない場合はこの手順をスキップする

   **重要:** `/commit` は「コミットだけ」を担当する独立したスキルなので、呼び出しが返ってきた時点では「コミット完了」という一区切りに見える。だがそれはこのタスク全体の**中間地点**に過ぎない。`/commit` から制御が戻ったら、ここで止まらず**必ず手順3（push）以降へ続ける**。コミットだけして完了レポートを出して終了するのは誤りで、これがこのスキルで最も起きやすい失敗。「コミットが終わった」は「タスクが終わった」ではない。
3. ブランチをoriginにプッシュする
4. プルリクエストのタイトルと本文を用意し、上記 "既存PR" の有無に応じて新規作成または更新する。

   **既存PRの有無・同一性の判定は、Context の "既存PR" および "既存PRの同一性チェック" の値のみを正とする。** `gh pr view`（引数なし）や `gh pr list`（`--state open` を付けない形）などで既存PRを**独自に探し直してはいけない**。これらは close/merge 済みのPRまでカレントブランチから解決してしまい、ブランチ名を使い回したときに無関係な過去のPRを誤って掴む原因になる（実際にこの誤りでマージ済みPRのタイトル/本文を上書きする事故が起きた）。既存PRの番号・URL・現行タイトル/本文が必要な場合も、Context に出ている値をそのまま使う。

   まず、PRに含めるコミット集合と diff を**この時点で取得し直す**。`<base>` を Context の "PR base branch" の値として:
   - コミット集合: `git log origin/<base>..HEAD --oneline 2>/dev/null || git log <base>..HEAD --oneline`
   - diff: `git diff origin/<base>..HEAD 2>/dev/null || git diff <base>..HEAD`

   **なぜ取り直すのか:** Context の "コミット集合 (base..HEAD)" や `git status` は**スキル起動時点**のスナップショットに過ぎず、手順2で `/commit` が新しく作ったコミットはまだ含まれていない。PRのタイトル/本文は「このPRが base に対して加える変更の**全体**」を表すものなので、`/commit` 後の最新状態を反映した `base..HEAD` を必ずここで取り直す必要がある。

   **タイトル/本文の唯一の入力は、ここで取得した `base..HEAD` のコミット集合と diff である。** Context の `git status`（＝最後の未コミット変更だけ）や、既存PRの現行本文をタイトル/本文の入力にしてはいけない。これらは全体像の一部でしかなく、そこに引っ張られると先行コミットの内容が漏れる。

   **タイトル/本文の生成ルール（新規・更新で共通）:**
   - タイトル: 上記で取得したコミット集合の内容全体を要約したConventional Commits形式（`type: subject`）にする。
   - 本文: 上記で取得したコミット集合と diff を参照して、全コミットの変更内容を漏れなくまとめる（箇条書き1〜3行程度）。本文は**全体を再生成する**（既存本文へのマージはしない）。
   - 言語: PRタイトルおよび本文の言語は、PRに含まれるコミットメッセージの言語に揃える（未コミット変更があり `/commit` スキルを呼び出した場合は、そのスキルが生成したコミットメッセージの言語を参照する）。
   - セルフチェック: 提示・作成する前に、取得したコミット集合の**件数**を確認する。2件以上なら、タイトル/本文がその全件をカバーしているか（最後の1件だけの内容になっていないか）を必ず確かめる。カバーできていなければ書き直す。

   **既存PRがない場合（"既存PR" が「なし」）:** `gh pr create` で新規作成する。`--base` には上記 "PR base branch" の値を使う。これは記録済みの分岐元を尊重するため、デフォルトブランチとは限らない（stacked PR に対応するため）。

   **既存PRがある場合（"既存PR" に番号・URLが出ている）:** まず Context の「既存PRの同一性チェック」の結果を確認する。
   - **警告（既存PRの先頭コミットがローカル履歴に存在しない）が出ている場合:** そのPRはブランチ名が同じだけで、実際には無関係な別件PRである可能性が高い（例: 過去に使ったブランチ名を再利用し、リモートに残っていた別作業のPRを誤って掴んでいる）。この場合 `gh pr edit` によるタイトル/本文の上書きは**行わない**。手順3のpushはこの懸念と無関係なので通常通り進めてよい。push後、ユーザーに状況（PR番号・URL・現在のタイトル）を提示し、「push は完了しましたが、PR #<番号> は別件の可能性があるため更新していません。新規PRを作成しますか、それとも他の対応が必要ですか」と確認を取ってから次に進む（この提示は手順4完了前の確認であり、完了レポートではない）。
   - **OK（先頭コミットがローカル履歴に存在する＝同一ブランチの正当な続き）の場合:** 以下の通常フローに進む。

   再生成したタイトル/本文を、"既存PR" に出ている現在の TITLE/BODY と比較する。この「再生成」の入力も上記のとおり `base..HEAD` の全コミット集合であって、既存PRの現行本文ではない（既存本文にマージするのではなく、全コミットからゼロベースで作り直す）。
   - 両方とも実質的に同じなら更新せず、そのまま次へ進む（この場合は確認も不要）。
   - 差があるフィールドがある場合は、**`gh pr edit` を実行する前に、更新するタイトル/本文をユーザーに提示して承認を取る。** 承認を得てから、差があるフィールドのみ `gh pr edit --title <...>` / `--body <...>` で更新する（タイトルだけ違う場合は `--title` のみ、本文だけ違う場合は `--body` のみ）。承認されなければ更新しない。
   - base は既存PRのものを尊重し、ここでは変更しない。
   - **よくある誤り:** 先行コミットが既に push 済みで、今回は未コミット変更が1つだけ、という継続作業の状態でこのスキルを起動すると、Context の `git status` には最後の変更しか映らない。それに引っ張られて「最後のコミットだけ」のタイトル/本文を作ってしまうのが典型的な失敗（PRの先行コミット内容が本文から丸ごと消える）。再生成の入力は必ず `base..HEAD` の全コミット集合であって、Context の status でも既存PR本文でもない。
5. **各ステップを順番に実行してください。** 各ステップの要否を事前に判断した上で計画し、途中で確認を挟まずに進めます。手順2を除く git/gh ツール呼び出しは可能な限りまとめて実行します。これらのツール呼び出し（`/commit` スキル呼び出しを含む）以外のテキストやメッセージを送信しないでください。**ただし例外として、既存PRを更新する場合（手順4の `gh pr edit`）は、実行前に更新内容を提示してユーザーの承認を取ってください。** push・新規PR作成（`gh pr create`）は従来通り無確認で進めます。

   **途中で勝手に止まらないこと。** このスキルの目的は push と PR まで完遂することにある。特に、手順2で `/commit` を呼び出した場合、その完了後に**必ず手順3（push）・手順4（PR）まで続ける**。`/commit` の戻りを終点と誤認してコミットだけで終了する（＝「コミット完了しました」とだけ返してターンを終える）のは、このスキルの最大の失敗モードであり、明確な誤り。完了レポートを出してよいのは push と PR まで終えた後だけ（手順4で既存PR更新の承認待ちに入る場合を除く）。

## 完了レポートのフォーマット

すべての git/gh 操作（push・PR作成/更新を含む）が完了したあと、最後に簡潔な完了レポートを1回だけ送ります。コミット直後の「コミット完了しました」的なメッセージは**完了レポートではありません**。完了レポートは push と PR まで終えて初めて出す唯一のメッセージです。コミットだけ済んだ段階でこのレポート（や類似の完了メッセージ）を送ってターンを終えてはいけません。

- **PR URL は単独で配置し、直後にテキスト（全角括弧・スペース区切りの注記など）を連結しないでください。** URL の直後に文字が続くと、ターミナルの Markdown レンダラーが `pull/790（base...` までを URL の一部として取り込み、リンクが壊れます。base ブランチなどの補足情報は URL とは別の箇条書き（別行）に分けます。
- URL は素の URL のまま記載します（自動リンク化させる）。Markdown リンク記法 `[text](url)` でラップする場合も、テキストと URL を正しく分離してください。
- その他の補足情報（自動クローズされる issue 番号など）はレポートに含めません。

フォーマット（最小限）。`base` 行はデフォルトブランチと異なる場合のみ出します。コミットが複数ある場合は箇条書きで列挙します。PR行は状態に応じて出し分けます（新規作成・既存更新・既存変更なし）:

```
完了しました。

- コミット:
  - <短縮SHA> <件名>
  - <短縮SHA> <件名>
- PR (新規): <PR URL>
- base: <base ブランチ>
```

PR行の出し分け:
- 新規作成: `- PR (新規): <PR URL>`
- 既存更新: `- PR (更新): <PR URL>`（必要なら更新箇所を1語添える: タイトル/本文/両方）
- 既存・変更なし: `- PR (変更なし): <PR URL>`

コミットが1件のみの場合は1行にまとめてよい（`- コミット: <短縮SHA> <件名>`）。
