#!/usr/bin/env bash
# fetch-source.sh — ソース指定を解決し、.claude/rules を含むローカルディレクトリを返す。
#
# 入力: source spec（位置引数）
#   - ローカルパス（既存ディレクトリ）
#   - git URL（https:// / git@ / .git で終わる）
#   - owner/repo[@ref]（GitHub ショートハンド）
#
# 出力（stdout に JSON 1行）:
#   { "rulesDir": "...", "repoRoot": "...", "orgRepoHint": ["owner","repo"], "tmpDir": "..."|null }
#
# 参照記法（@path）の解決のためリポジトリ全体を取得する（sparse-checkout はしない）。
# .claude/rules が無い場合は非ゼロ終了 + stderr にメッセージ。

set -euo pipefail

err() { printf '%s\n' "$*" >&2; }

if [ "$#" -lt 1 ]; then
  err "Usage: fetch-source.sh <local-path | git-url | owner/repo[@ref]>"
  exit 1
fi

SPEC="$1"

# JSON 文字列エスケープ（最小限: \ と " と改行）
json_str() {
  if [ "$1" = "null" ] && [ "${2:-}" = "raw" ]; then
    printf 'null'
    return
  fi
  local s="$1"
  s="${s//\\/\\\\}"
  s="${s//\"/\\\"}"
  printf '"%s"' "$s"
}

emit() {
  # $1 rulesDir, $2 org(あるいは空), $3 repo(あるいは空), $4 tmpDir(あるいは空), $5 repoRoot
  local rules="$1" org="$2" repo="$3" tmp="$4" root="$5"
  local hint
  if [ -n "$org" ] && [ -n "$repo" ]; then
    hint="[$(json_str "$org"),$(json_str "$repo")]"
  else
    hint="[]"
  fi
  local tmpjson
  if [ -n "$tmp" ]; then
    tmpjson="$(json_str "$tmp")"
  else
    tmpjson="null"
  fi
  printf '{"rulesDir":%s,"repoRoot":%s,"orgRepoHint":%s,"tmpDir":%s}\n' \
    "$(json_str "$rules")" "$(json_str "$root")" "$hint" "$tmpjson"
}

# git remote の URL から owner/repo を抽出（ヒント用）
extract_org_repo() {
  # 入力例:
  #   https://github.com/owner/repo.git
  #   git@github.com:owner/repo.git
  #   owner/repo@ref
  local u="$1"
  u="${u%.git}"
  u="${u%/}"
  # @ref を落とす（owner/repo@ref のショートハンド用。URL の git@ とは衝突しないよう末尾側のみ）
  case "$u" in
    *://*|git@*) : ;;             # フル URL はそのまま
    */*) u="${u%@*}" ;;           # ショートハンドは末尾 @ref を除去
  esac
  # host:owner/repo または host/owner/repo の末尾2要素を取る
  u="${u//://}"                   # git@host:owner/repo → git@host/owner/repo
  local repo owner
  repo="${u##*/}"
  local rest="${u%/*}"
  owner="${rest##*/}"
  printf '%s\t%s' "$owner" "$repo"
}

clone_full() {
  # $1 git URL, $2 ref(空可)
  # 参照先（@path）の解決のため .claude/rules だけでなくリポジトリ全体を取得する。
  # blob は --filter=blob:none で遅延取得、履歴は --depth 1 で省く。
  local url="$1" ref="$2"
  local tmp
  tmp="$(mktemp -d)"
  # 失敗時に掃除
  trap 'rm -rf "$tmp"' EXIT

  if ! git clone --depth 1 --filter=blob:none "$url" "$tmp" >/dev/null 2>&1; then
    err "Failed to clone: $url"
    rm -rf "$tmp"; trap - EXIT
    exit 2
  fi
  if [ -n "$ref" ]; then
    if ! git -C "$tmp" fetch --depth 1 origin "$ref" >/dev/null 2>&1 \
       || ! git -C "$tmp" checkout FETCH_HEAD >/dev/null 2>&1; then
      err "Failed to checkout ref: $ref"
      rm -rf "$tmp"; trap - EXIT
      exit 2
    fi
  fi

  local rules="$tmp/.claude/rules"
  if [ ! -d "$rules" ]; then
    err "Source has no .claude/rules: $url"
    rm -rf "$tmp"; trap - EXIT
    exit 3
  fi

  trap - EXIT  # 成功したので掃除はスキル側に委譲（tmpDir を返す）
  local oo
  oo="$(extract_org_repo "$url")"
  emit "$rules" "${oo%%$'\t'*}" "${oo##*$'\t'}" "$tmp" "$tmp"
}

# --- ソース種別の判定 ---
case "$SPEC" in
  https://*|http://*|git@*|ssh://*|file://*|*.git)
    clone_full "$SPEC" ""
    ;;
  *)
    # ローカルパス（既存ディレクトリ）か owner/repo[@ref] か
    # @ref を分離して候補パスを判定
    local_candidate="$SPEC"
    if [ -d "$local_candidate" ]; then
      # ローカルパス
      rules="$local_candidate/.claude/rules"
      if [ ! -d "$rules" ]; then
        err "Source has no .claude/rules: $local_candidate"
        exit 3
      fi
      rules="$(cd "$rules" && pwd)"
      # repoRoot は指定パスそのもの（= .claude/rules の親の親）
      repo_root="$(cd "$local_candidate" && pwd)"
      # ローカルの git remote からヒント抽出（あれば）
      org=""; repo=""
      if remote_url="$(git -C "$local_candidate" config --get remote.origin.url 2>/dev/null)"; then
        oo="$(extract_org_repo "$remote_url")"
        org="${oo%%$'\t'*}"; repo="${oo##*$'\t'}"
      fi
      emit "$rules" "$org" "$repo" "" "$repo_root"
    else
      # owner/repo[@ref] とみなす
      spec_noref="${SPEC%@*}"
      ref=""
      case "$SPEC" in
        *@*) ref="${SPEC##*@}" ;;
      esac
      case "$spec_noref" in
        */*)
          clone_full "https://github.com/${spec_noref}.git" "$ref"
          ;;
        *)
          err "Not a directory and not owner/repo: $SPEC"
          exit 1
          ;;
      esac
    fi
    ;;
esac
