---
name: pr-review-comments-resolve
description: GitHub PRのレビューコメントのうち、Hide・解決済みでないものだけを抽出して対応する。
argument-hint: '<PR番号 または PR URL>'
disable-model-invocation: true
license: MIT
---

# PRレビューコメント対応

引数としてPR番号またはPR URLを受け取る。省略された場合は、現在のブランチに紐づくPRをユーザーに確認する。

GitHub PRのレビューコメントに対応する。ここでいう「対応」は、コメントを読んで終わりではなく、
実際にコードを直し、コミットし、PRに反映するところまでを指す。

## なぜHide/解決状態で絞り込むのか

PRには「もう見なくていい」コメントが溜まっていることが多い：
- スパムや誤検知としてMinimize（Hide）されたコメント
- 既に対応済みでresolveされたスレッド

これらは通常のREST API (`gh api repos/.../pulls/{number}/comments`) のレスポンスだけでは区別できない。
`isMinimized` と `isResolved` はどちらもGraphQLの `reviewThreads` からしか取れないため、
**REST APIの一覧だけを見て全件に対応しようとしない**こと。見なくていいコメントまで拾うと、
本人が意図的にHideしたものを蒸し返したり、無関係な修正が紛れ込んだりする。

## 手順

### 1. 未対応コメントを抽出する

GraphQLで `isMinimized` と `isResolved` を一度に取得し、両方とも `false` のスレッドだけを対象にする。

```bash
gh api graphql -f query='
query {
  repository(owner: "OWNER", name: "REPO") {
    pullRequest(number: PR_NUMBER) {
      reviewThreads(first: 50) {
        nodes {
          isResolved
          isCollapsed
          comments(first: 10) {
            nodes {
              id
              databaseId
              isMinimized
              minimizedReason
              path
              line
              body
            }
          }
        }
      }
    }
  }
}'
```

`reviewThreads` が50件を超える場合は `pageInfo`/`after` でページングする。

抽出できたら、対象件数と各コメントの要旨（ファイル・指摘内容）を短く報告してから着手する。
0件だった場合はそこで完了を伝えて終わる（無理に何かを直そうとしない）。

### 2. 各指摘を実際に調査してから直す

レビューコメント、特にbotによる自動レビューは、提案（`suggestion`ブロックなど）をそのまま鵜呑みにできるとは限らない。
指摘が指しているファイル・シンボルが**現在のコードにまだその形で存在するか**、提案されている修正先が
**実際に正しい移行先か**を、そのつど調べる。具体的には：

- 指摘が「参照切れ」「移行漏れ」を主張しているなら、`grep`/`git log`で参照元と移行先の実体を確認する
- 指摘が特定の関数・設定・ファイルを名指ししているなら、それが現在も同じ名前・同じ場所にあるか確認する
- コメントに `suggestion` ブロックが付いている場合も、周辺の実装や命名規則と整合するか一度目で確認してから採用する（コピペで即採用しない）

調査の結果、指摘が的外れ・スコープ外（例: 過去の設計判断の記録であって実害のあるリンク切れではない）と判断した場合は、
その理由を添えて対応をスキップしてよい。全部を無理やり直す必要はない。

### 3. 修正・コミット・push

- 複数ファイルにまたがる直し方が同じ論理単位（例:「廃止されたパスへの参照をすべて新パスに直す」）なら1コミットにまとめる
- コミットメッセージは `commit` スキルの規約（Conventional Commits、日本語body可）に従う
- 修正・コミット・pushはここまで自動で進めてよい。ユーザーに都度確認を挟む必要はない

### 4. PR本文の更新は確認を取る

追加コミットによってPRの変更内容が増えた場合、既存のPR本文に反映漏れが出ることがある。
`commit-push-pr` スキルの手順に従い、base branchとの `git diff`/`git log` からPR全体の変更点を洗い出し、
本文に追記すべき内容があれば**更新前にユーザーに提示して承認を取る**。
タイトルは全体を的確に要約できていれば変更不要のことが多い。

## 対応が終わったら

- どのコメントに対応し、どれをスキップしたか（理由付きで）を簡潔にまとめる
- commitのSHA・件名、PRのURLを報告する（`commit-push-pr`スキルの完了レポート形式に準じる）
