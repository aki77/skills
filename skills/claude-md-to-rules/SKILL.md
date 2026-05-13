---
name: claude-md-to-rules
description: |
  サブディレクトリに置かれた CLAUDE.md ファイルを `.claude/rules/` 配下のパス固有ルールファイルへ変換するスキル。
  「CLAUDE.md を rules に変換して」「サブディレクトリの CLAUDE.md を移行したい」「.claude/rules/ に変換して」「CLAUDE.md を rules 形式にして」などのフレーズで呼び出す。
  ルートの CLAUDE.md はそのまま残し、サブディレクトリ（spec/, config/, app/ など）の CLAUDE.md のみを対象とする。
---

# claude-md-to-rules

サブディレクトリの `CLAUDE.md` を `.claude/rules/` 配下のパス固有ルールファイルへ変換する。

## なぜ変換するか

Claude Code の公式推奨方法は `.claude/rules/` を使うことで、次のメリットがある：

- **`paths:` frontmatter** でルールを特定ファイルパスにスコープできる（そのファイルを触るときだけ読み込まれる）
- ルートの CLAUDE.md がコンテキストウィンドウを圧迫しない
- ルールがモジュール化されて保守しやすくなる
- サブディレクトリの CLAUDE.md はオンデマンドロードで見逃されることがあるが、`.claude/rules/` は確実に適用される

## 手順

### 1. 変換対象を特定する

```bash
find . -mindepth 2 -name "CLAUDE.md" -not -path "./.claude/*" -type f
```

ルートの `./CLAUDE.md`（depth 1）と `./.claude/CLAUDE.md` は除外する。`-mindepth 2` でルート直下を除外する。

### 2. 各 CLAUDE.md に対して rules ファイルを作成する

`.claude/rules/` ディレクトリがなければ作成する：

```bash
mkdir -p .claude/rules
```

元のファイルがどのディレクトリにあるかに応じて `paths:` を設定する。

**ルールファイル名**: 元の CLAUDE.md が存在していたディレクトリパスを `-` で繋げたものを使う。
- `spec/CLAUDE.md` → `.claude/rules/spec.md`
- `app/models/CLAUDE.md` → `.claude/rules/app-models.md`
- `app/controllers/CLAUDE.md` → `.claude/rules/app-controllers.md`

（直近ディレクトリ名だけでは `app/models/` と `lib/models/` が衝突するため、フルパスを `-` 区切りにする）

**frontmatter の `paths:` パターン**:

| 元の CLAUDE.md の場所 | 推奨 paths パターン |
|---|---|
| `spec/CLAUDE.md` | `spec/**/*` |
| `config/CLAUDE.md` | `config/routes.rb`, `config/routes/**/*.rb`（内容に応じて限定）|
| `app/CLAUDE.md` | `app/**/*` |
| `app/models/CLAUDE.md` | `app/models/**/*.rb` |

**内容の扱い**:
- CLAUDE.md の本文をそのままコピーする
- `@import` 構文（`@path/to/file.md`）がある場合、パスをプロジェクトルートからの相対パスに書き直す
  - Claude Code は `.claude/rules/` 内の `@import` をプロジェクトルート相対で解決する
  - 例: `../../doc/agent/spec.md` → `doc/agent/spec.md`（`../../` は不要）

**テンプレート**:

```markdown
---
paths:
  - "spec/**/*"
---

（元の CLAUDE.md の内容をここに貼る）
```

### 3. 元の CLAUDE.md を削除する

```bash
git rm spec/CLAUDE.md config/CLAUDE.md  # 変換した分を削除
```

`git rm` を使うことで削除をステージングに含める。git 管理外なら `rm` でよい。

### 4. 動作確認

```bash
ls .claude/rules/
```

Claude Code セッション内で `/memory` を実行すると読み込まれているルールファイルを確認できる。

## 注意事項

- **ルートの CLAUDE.md はそのまま**：`./CLAUDE.md` や `./.claude/CLAUDE.md` は変換対象外
- **`@import` 先のファイルは変更しない**：`doc/agent/` など実体ファイルは移動不要
- **`paths:` なしも可能**：すべてのファイルに無条件適用したいルールは frontmatter を省略してよい
- **`@import` パスの修正**：元の CLAUDE.md から `.claude/rules/` に場所が変わるため、相対パスを更新する

## 例

`spec/CLAUDE.md`（元）:
```markdown
- [@doc/agent/spec.md](../../doc/agent/spec.md)
```

`.claude/rules/spec.md`（変換後）:
```markdown
---
paths:
  - "spec/**/*"
---

@doc/agent/spec.md
```

パスが `../../doc/agent/spec.md` から `doc/agent/spec.md`（プロジェクトルートからの相対）に変わる点に注意。
