#!/usr/bin/env bash
# fetch-unresolved-comments.sh — PRのレビューコメントのうち、Hide・解決済みでないものだけを抽出する。
#
# 入力: PR番号 または PR URL（位置引数、省略可）
#   - 数値（例: 123）: 現在のリポジトリの owner/repo と組み合わせる
#   - URL（例: https://github.com/OWNER/REPO/pull/123）: owner/repo/番号をURLから抽出する
#   - 省略時: 現在のブランチに紐づくPRを `gh pr view` で検出する
#
# 出力（stdout に整形済みJSON配列）:
#   [{ "id": "...", "databaseId": 123, "path": "...", "line": 10, "body": "..." }, ...]
#   対象は isResolved == false かつ isMinimized == false のスレッドのコメントのみ。
# 出力（stderr）:
#   "対象 N 件" の1行サマリ
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

# --- GraphQLでreviewThreadsをページングしながら取得する ---
QUERY='
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
              body
            }
          }
        }
      }
    }
  }
}'

ALL_THREADS='[]'
CURSOR=""
while :; do
  if [ -n "$CURSOR" ]; then
    PAGE="$(gh api graphql -f query="$QUERY" -F owner="$OWNER" -F name="$REPO" -F number="$NUMBER" -F cursor="$CURSOR")" || {
      err "gh api graphql の呼び出しに失敗した（owner=$OWNER repo=$REPO number=$NUMBER）"
      exit 2
    }
  else
    PAGE="$(gh api graphql -f query="$QUERY" -F owner="$OWNER" -F name="$REPO" -F number="$NUMBER")" || {
      err "gh api graphql の呼び出しに失敗した（owner=$OWNER repo=$REPO number=$NUMBER）"
      exit 2
    }
  fi

  THREADS="$(printf '%s' "$PAGE" | jq -c '.data.repository.pullRequest.reviewThreads.nodes')"
  ALL_THREADS="$(jq -c -n --argjson a "$ALL_THREADS" --argjson b "$THREADS" '$a + $b')"

  HAS_NEXT="$(printf '%s' "$PAGE" | jq -r '.data.repository.pullRequest.reviewThreads.pageInfo.hasNextPage')"
  if [ "$HAS_NEXT" != "true" ]; then
    break
  fi
  CURSOR="$(printf '%s' "$PAGE" | jq -r '.data.repository.pullRequest.reviewThreads.pageInfo.endCursor')"
done

# --- 未解決 & Hideされていないコメントだけを抽出して整形する ---
RESULT="$(printf '%s' "$ALL_THREADS" | jq -c '
  [.[] | select(.isResolved == false) | .comments.nodes[]
    | select(.isMinimized == false)
    | {id, databaseId, path, line, body}]
')"

COUNT="$(printf '%s' "$RESULT" | jq 'length')"
err "対象 ${COUNT} 件"

printf '%s' "$RESULT" | jq '.'
