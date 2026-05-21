---
name: pr-tidy-classifier
description: GitHub PR を Tidy First? の T1〜T15 / NG1〜NG7 パターンに照らして分類し、人間レビューが不要な「構造的なリファクタリング」かどうかを判定するスキル。/pr-tidy-classify コマンドで起動する。
disable-model-invocation: true
allowed-tools: Bash(gh pr diff:*), Bash(gh pr view:*), Bash(gh pr review:*), Bash(gh pr comment:*), Bash(git diff:*), Bash(git log:*), Bash(git rev-parse:*), Bash(git remote:*), Read
license: MIT
context: fork
---

# PR Tidy Classifier

このスキルは、GitHub PR (またはローカルブランチの差分) を読み、Kent Beck の `Tidy First?` で言うところの **「整頓 (Tidy)」** にあたる構造的リファクタリングか、それとも **振る舞いを変える変更 (NG)** かを分類する。

目的は、PRレビューのうち「**レビューする価値がないことを確認するためだけの儀式**」を肩代わりすることにある。整頓と判定したPRは、人間が個別にdiffを目で追わなくても安全にApproveできる、というスタンス。

参考: [AIによるプルリクエスト分類器 (Findy Tech Blog, 2026)](https://tech.findy.co.jp/entry/2026/05/08/100000)

---

## 起動と入力

`/pr-tidy-classify` コマンド経由で呼ばれる。引数のパターンは以下の3通り:

- `/pr-tidy-classify <PR番号>` — 指定PRを分類して**会話に報告するのみ** (GitHubに何も投稿しない、デフォルト動作)
- `/pr-tidy-classify` (引数なし) — 現在のローカルブランチ vs base ブランチの差分を分類
- `/pr-tidy-classify <PR番号> --comment` — 分類した上で、結果をGitHubに投稿する (Approve可ならApprove、それ以外はコメントのみ)

`--comment` フラグが**ない**限り、`gh pr review` や `gh pr comment` は絶対に呼ばないこと。誤って勝手にApproveすると整頓判定の信頼性そのものが崩れる。

## 判定ワークフロー

判定は次の手順で進める。`references/patterns.md` と `references/large-pr-sampling.md` を必ず先に読み込んでから本作業に入ること。

### 1. diff の取得

PR番号が指定されている場合:

```bash
gh pr view <PR番号> --json title,body,files,baseRefName,headRefName,changedFiles
gh pr diff <PR番号>
```

引数なし (ローカルブランチ) の場合、base を自動判定する:

```bash
# AI: base ブランチは main → master → release-candidate の優先順で存在するものを使う
git remote show origin | grep 'HEAD branch'   # 推奨: HEAD branch を見る
git diff <base>...HEAD --stat                 # 変更ファイル数の把握
git diff <base>...HEAD                        # 実際のdiff
```

### 2. 変更ファイル数で経路を分岐

- **30ファイル以下**: `references/patterns.md` を参照しながら、全diffを精査する
- **31ファイル以上**: `references/large-pr-sampling.md` のサンプリング手順に従う (波及先を**セット**で見る、を厳守)

### 3. パターンマッチング

diff の各ハンクを、`references/patterns.md` の T1〜T15 / NG1〜NG7 のどれに該当するか分類する。

判定の原則:

- **NGがひとつでもあれば `NeedsReview`** — 整頓と本質的変更が混在するPRは、人間レビューに回す (記事の主旨「TidyとNGが共存するPRは粒度を分けるべき」を尊重)
- **すべてが Tidy パターンに収まれば `Approve可`**
- **判断に迷うdiffがある場合は `判定不能`** — 誤って `Approve可` に倒すと信頼を損なうので、安全側 (人間レビュー) に倒すのが原則

「振る舞いが変わらないか」をdiffから読み取れない場合 (テストカバレッジが薄い領域でのリファクタリングを含む) も、`判定不能` に倒してよい。

### 4. 報告フォーマット

会話への出力は次のテンプレートを厳守する。読み手はPR作者・レビュワー双方を想定しており、根拠が見えることが重要。

```markdown
## PR分類結果: <Approve可 | NeedsReview | 判定不能>

- **PR**: #<番号> 「<タイトル>」 (引数なし時は `<base>...HEAD` のように記載)
- **変更ファイル数**: <N>
- **サンプリング**: <不要 | 実施 (確認したファイル: ...)>

### 該当パターン

- **T5 (リネーム)**: `app/foo.rb`, `spec/foo_spec.rb` ほか N ファイル
- **T1 (ファイル移動)**: `lib/old/path.rb` → `lib/new/path.rb`
- ...

### 根拠

- <なぜこの判定になったかの説明。NGがあった場合はどのファイルのどの変更がNGに該当するか具体的に書く>
- <サンプリング実施時は、波及元と波及先の対応をどう確認したかも書く>

### 注意事項 (任意)

- <テストカバレッジが薄い等、Approve可でも人間が念のため見たほうがよい点>
```

### 5. `--comment` 指定時の GitHub 投稿

`--comment` フラグが指定されているときのみ、判定結果に応じて以下のどちらかを実行する:

- `Approve可` の場合:
  ```bash
  gh pr review <PR番号> --approve --body "<上記の報告フォーマットそのまま>"
  ```

- `NeedsReview` または `判定不能` の場合:
  ```bash
  gh pr comment <PR番号> --body "<報告フォーマット + 「人間によるレビューを推奨します」の一文>"
  ```
  Approveしないコメント投稿のみ。`gh pr review --request-changes` は使わない (整頓判定の対象外であって、品質に問題があると断定しているわけではないため)。

投稿bodyには分類根拠 (該当パターン、対象ファイル、サンプリング有無) を必ず含める。将来「この自動Approveは妥当だったか」を振り返るためのログとして残すのが目的。

投稿bodyには余計なフッター (参考URLやボット署名など) を追加しないこと。報告フォーマットのみを投稿する。

## このスキルが扱わないこと

- **コード品質レビュー**: バグや設計の良し悪しは判定しない。あくまで「整頓か否か」だけを見る。バグ検出が必要なら別スキル (例: `code-review`) を使う
- **CI失敗の判定**: テストやCIが通っているかは見ない。前提として CI green を期待する
- **大規模なロジック変更の妥当性**: NG判定したPRに対して「直してください」とは言わない。人間レビューに委ねるだけ

## 判定の限界

- diff だけからは「振る舞いが変わらないか」を完全には保証できない。Tidy First? の T パターンに見えても、たとえばリネーム対象がリフレクションで参照されているケースなどは検知できない
- テストが薄い領域でのリファクタリングは、機械的に T パターンに分類できても「セーフティネットがない整頓」になる。`判定不能` か、`Approve可` にしつつ注意事項に明記するか、状況に応じて判断する
- 誤判定リスクが疑われる材料 (普段見ないファイル種、独自フレームワーク、生成物っぽいが生成元が不明等) があれば、`判定不能` に倒して人間に判断を委ねる
