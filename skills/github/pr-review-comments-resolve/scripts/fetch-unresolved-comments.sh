#!/usr/bin/env bash
# fetch-unresolved-comments.sh — PRのレビュー指摘のうち、Hide・解決済みでないものだけを抽出する。
#
# 抽出対象は2種類:
#   1. インラインコメント（reviewThreads配下。ファイル・行に紐づく）
#   2. レビューのサマリコメント（PullRequestReview.body。PR全体への総評欄）
#      行番号を確定できない指摘がこちらに書かれることがあるため、インラインだけでは取りこぼす。
#
# 入力: PR番号 または PR URL（位置引数、省略可）
#   - 数値（例: 123）: 現在のリポジトリの owner/repo と組み合わせる
#   - URL（例: https://github.com/OWNER/REPO/pull/123）: owner/repo/番号をURLから抽出する
#   - 省略時: 現在のブランチに紐づくPRを `gh pr view` で検出する
#
# 出力（stdout に整形済みJSON配列）:
#   [
#     { "type": "inline",  "id": "...", "databaseId": 123, "path": "...", "line": 10,
#       "author": "...", "authorType": "User", "url": "...", "body": "..." },
#     { "type": "summary", "id": "...", "databaseId": 456, "path": null, "line": null,
#       "author": "...", "authorType": "Bot", "url": "...", "state": "COMMENTED",
#       "submittedAt": "...", "body": "..." }
#   ]
#   authorType は "User"（人間）または "Bot"（GitHub App）。login だけでは
#   bot を見分けられない（例: github-actions[bot] の login は "github-actions"）ため付与する。
#   inline  : スレッドが isResolved == false かつコメントが isMinimized == false のもの
#   summary : review が isMinimized == false かつ body が空でないもの
#             （レビュー本文には isResolved に相当する状態がAPI上存在しないため、Hideのみで絞る）
# 出力（stderr）:
#   "対象 N 件（インライン X 件 / サマリ Y 件）" の1行サマリ
#
# 終了コード: 1 = usage/PR番号解決不能, 2 = gh api 呼び出し失敗
#
# 依存: gh（認証済み）, jq

set -euo pipefail

err() { printf '%s\n' "$*" >&2; }

if [ "$#" -gt 1 ]; then
  err "Usage: fetch-unresolved-comments.sh [<PR番号> | <PR URL>]"
  exit 1
fi

SPEC="${1:-}"

OWNER=""
REPO=""
NUMBER=""

# --- 引数からowner/repo/番号を解決する ---
if [ -z "$SPEC" ]; then
  # 省略時: 現在のブランチに紐づくPRを検出
  if ! NUMBER="$(gh pr view --json number --jq '.number' 2>/dev/null)" || [ -z "$NUMBER" ]; then
    err "現在のブランチに紐づくPRが見つからない。PR番号またはPR URLを指定すること。"
    exit 1
  fi
elif [[ "$SPEC" =~ ^https?://github\.com/([^/]+)/([^/]+)/pull/([0-9]+) ]]; then
  OWNER="${BASH_REMATCH[1]}"
  REPO="${BASH_REMATCH[2]}"
  NUMBER="${BASH_REMATCH[3]}"
elif [[ "$SPEC" =~ ^[0-9]+$ ]]; then
  NUMBER="$SPEC"
else
  err "PR番号またはPR URLの形式ではない: $SPEC"
  exit 1
fi

# owner/repo が未確定なら現在のリポジトリから補完する
if [ -z "$OWNER" ] || [ -z "$REPO" ]; then
  if ! OWNER_REPO="$(gh repo view --json owner,name --jq '.owner.login + "\t" + .name' 2>/dev/null)"; then
    err "現在のリポジトリのowner/repoを検出できない。PR URLの形式で指定すること。"
    exit 1
  fi
  OWNER="${OWNER_REPO%%$'\t'*}"
  REPO="${OWNER_REPO##*$'\t'}"
fi

# --- GraphQLを1ページ取得する（$1: query, $2: cursor（空文字なら先頭ページ）） ---
fetch_page() {
  local query="$1" cursor="$2" page
  if [ -n "$cursor" ]; then
    page="$(gh api graphql -f query="$query" -F owner="$OWNER" -F name="$REPO" -F number="$NUMBER" -F cursor="$cursor")" || return 1
  else
    page="$(gh api graphql -f query="$query" -F owner="$OWNER" -F name="$REPO" -F number="$NUMBER")" || return 1
  fi
  printf '%s' "$page"
}

# --- ページングしながら全ノードを集める（$1: query, $2: .data配下のコネクションへのjqパス） ---
collect_nodes() {
  local query="$1" conn="$2"
  local all='[]' cursor="" page nodes has_next
  while :; do
    page="$(fetch_page "$query" "$cursor")" || {
      err "gh api graphql の呼び出しに失敗した（owner=${OWNER} repo=${REPO} number=${NUMBER}）"
      exit 2
    }
    nodes="$(printf '%s' "$page" | jq -c "${conn}.nodes")"
    all="$(jq -c -n --argjson a "$all" --argjson b "$nodes" '$a + $b')"

    has_next="$(printf '%s' "$page" | jq -r "${conn}.pageInfo.hasNextPage")"
    [ "$has_next" = "true" ] || break
    cursor="$(printf '%s' "$page" | jq -r "${conn}.pageInfo.endCursor")"
  done
  printf '%s' "$all"
}

THREADS_QUERY='
query($owner: String!, $name: String!, $number: Int!, $cursor: String) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      reviewThreads(first: 100, after: $cursor) {
        pageInfo { hasNextPage endCursor }
        nodes {
          isResolved
          comments(first: 100) {
            nodes {
              id
              databaseId
              isMinimized
              path
              line
              url
              author { login __typename }
              body
            }
          }
        }
      }
    }
  }
}'

REVIEWS_QUERY='
query($owner: String!, $name: String!, $number: Int!, $cursor: String) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      reviews(first: 100, after: $cursor) {
        pageInfo { hasNextPage endCursor }
        nodes {
          id
          databaseId
          isMinimized
          state
          submittedAt
          url
          author { login __typename }
          body
        }
      }
    }
  }
}'

ALL_THREADS="$(collect_nodes "$THREADS_QUERY" '.data.repository.pullRequest.reviewThreads')"
ALL_REVIEWS="$(collect_nodes "$REVIEWS_QUERY" '.data.repository.pullRequest.reviews')"

# --- 未解決 & Hideされていない指摘だけを抽出して整形する ---
# インラインコメント: スレッドが未解決 かつ コメントがHideされていない
INLINE="$(printf '%s' "$ALL_THREADS" | jq -c '
  [.[] | select(.isResolved == false) | .comments.nodes[]
    | select(.isMinimized == false)
    | {type: "inline", id, databaseId, path, line,
       author: .author.login, authorType: .author.__typename, url, body}]
')"

# サマリコメント: Hideされておらず、本文が空でないレビュー
# （インラインコメントのみのレビューは body が "" になるので除外される）
SUMMARY="$(printf '%s' "$ALL_REVIEWS" | jq -c '
  [.[] | select(.isMinimized == false)
    | select((.body // "") | gsub("\\s"; "") != "")
    | {type: "summary", id, databaseId, path: null, line: null,
       author: .author.login, authorType: .author.__typename, url, state, submittedAt, body}]
')"

RESULT="$(jq -c -n --argjson a "$INLINE" --argjson b "$SUMMARY" '$a + $b')"

INLINE_COUNT="$(printf '%s' "$INLINE" | jq 'length')"
SUMMARY_COUNT="$(printf '%s' "$SUMMARY" | jq 'length')"
COUNT="$(printf '%s' "$RESULT" | jq 'length')"
err "対象 ${COUNT} 件（インライン ${INLINE_COUNT} 件 / サマリ ${SUMMARY_COUNT} 件）"

printf '%s' "$RESULT" | jq '.'
