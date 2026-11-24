# story.json の書き方

`prep` が作った `prep.txt` を読み、`story.json` を Write するときの形式と規則。`validate` が機械的に確認するのは形式と hunk の参照だけで、文章の質は確認しない。規則は自分で守る。

## 書き方の規則

- **解説者でありレビュアーではない。** 評価、指摘、修正提案は書かない。`risks` は「注意して見る観点」であり、合否の判定ではない。
- **章はテーマ単位。** 並び順が読む順になる（データの流れや依存の順）。
- **通常 2〜6 章、上限 8。** 1 テーマの PR なら 1 章でよい。
- **hunk は `(file_path, old_start)` だけで参照する。** 値は `prep.txt` の hunk 見出し（`--- (<file_path>, <old_start>) [status]` の形）にあるものを使う。全 hunk を章か `support` に**ちょうど 1 回**入れる。
- **「なぜ」は PR 本文、コミット本文、リンクされた issue を根拠にする。** どこにも書かれていなければ捏造せず「記載なし」と書く。
- **「影響範囲」は周辺コードを Grep で調べて書く。** 確認できた範囲だけを書き、読めなかった範囲は推測で埋めない（書かない）。
- **前回の story（`previous-story.json`）があれば章構成を保つ。** 章の `id` と `title` を維持し、新規・変更の hunk だけを配置し直す。消えた hunk の参照は取り除く。
- **`diagram` は mermaid。** 構造の理解に役立つ場合だけ書く。要らなければ空文字にする。flowchart / graph ではノードのラベルを `A["..."]`、エッジラベルを `-->|"..."|` のように**必ず引用符で囲む**（`/` `:` `(` `=` などを含むラベルは mermaid の字句エラーになる）。`[/` `[\` `[(` などの形状記号は使わない。ラベル内の `"` は使わず言い換える。
- **出力言語は日本語。**
- **`@name` や `<!--` を散文に書く必要がなければ避ける。** `@` は無害化され、`<!--` と `-->` はエスケープされるので、書いても壊れはしないが読みにくくなる。

## story.json の形式

```json
{
  "prologue": {
    "title": "48文字以内",
    "overview": "1〜3文",
    "key_changes": ["主な変更点"],
    "risks": ["注意して見る点"],
    "diagram": "",
    "motivation": {"problem": "課題", "approach": "手段", "rationale": "なぜその手段か"},
    "impact": ["波及する呼び出し元、画面、データ"],
    "glossary": [{"term": "用語", "description": "説明"}]
  },
  "chapters": [
    {"id": "ch1", "title": "48文字以内", "summary": "この章で何が変わったか",
     "hunk_refs": [{"file_path": "app/models/user.rb", "old_start": 42}], "diagram": ""}
  ],
  "support": [
    {"hunk_refs": [{"file_path": "Gemfile.lock", "old_start": 120}], "reason": "理由"}
  ]
}
```

`diff` 本文、リンク、行番号は書かない。`file_path` と `old_start` の組だけで hunk を指す。

### validate の規則

| 対象 | 規則 |
|---|---|
| `title`、`overview`、`key_changes`、`risks` | 必須。`key_changes` と `risks` は空でない文字列を 1 つ以上含む配列。`title` は 48 文字を超えると切り詰められる |
| `motivation` | 必須。`problem`、`approach`、`rationale` の 3 つとも空でない文字列。根拠がなければ「記載なし」 |
| `impact` | 任意。文字列の配列 |
| `glossary` | 任意。`{term, description}` の配列。6 件以上は先頭 5 件に切り詰めて警告 |
| `diagram` | 任意。文字列。flowchart / graph は引用符なしのラベルに文字・数字・空白・`_ . , -` 以外が入っていると失敗（`unsafe_diagram`） |
| chapter `id` | `[A-Za-z0-9_-]+` で一意。`overview` と `support` は予約語で使えない |
| chapter `title` | 必須。48 文字を超えると切り詰められる |
| chapter `summary` | 任意だが、何が変わったかを書く |
| `hunk_refs` | `{file_path: 文字列, old_start: 0 以上の整数}` の配列 |
| 重複配置、索引にない参照 | 失敗。該当する参照を列挙する |
| 未配置の hunk | `support` に自動補填（理由は「未分類」）。配置率 50% 未満は失敗 |
| 空の章 | 警告（失敗ではない） |

## prologue の拡張フィールド

`motivation`、`impact`、`glossary` は、他の PR 解説（初見の読み手向けの図解）にある「なぜ」「影響範囲」「用語集」を 1 コメントで読めるようにするための拡張である。

### motivation（必須）

**課題 → 手段 → なぜその手段か**の 3 項目で書く。

- 根拠は PR 本文、コミット本文、リンクされた issue に限る。
- どこにも書かれていない項目は、推測で埋めず「記載なし」と書く。誤った前提でレビュアーが判断するのは、背景がないことより有害である。
- diff の中のコメントや文書に理由が書かれている場合は根拠にしてよい。そのときは「diff 内の記述によると」のように出どころを添える。
- PR 本文やタイトルが diff と食い違う場合は diff を正として書き、食い違いは事実として `risks` に 1 項目入れる。
- 手段の妥当性は評価しない。`rationale` は PR が述べている理由を写すだけで、良し悪しを判断しない。

### impact（任意）

波及する呼び出し元、画面、データを 1 項目ずつ書く。

- 変更ファイルの周辺コードを Grep / Read で調べ、**確認できた範囲だけ**を書く。
- 調べきれなかった範囲について「影響なし」と断定しない。書かないか、「未確認」と明記する。
- ファイルに触れるときは**リポジトリルートからの相対パス**（`app/models/user.rb` のように `/` を含み、末尾が拡張子付きのファイル名である形。バッククォートで囲んでもよい）で書く。`bin/setup` や `docker/Dockerfile` のような拡張子のないパスは検出されず、リンクにも `unlinked_paths` にもならない。実在するファイルなら render が自動でリンクにする（PR 内のファイルは差分へ、PR 外は head 時点のファイルへ）。散文全般（タイトル・章タイトル・用語・図を除く）で同じ。日本語などの非 ASCII 文字を含むパスはバッククォートで囲む（囲まないと検出されない）。Markdown リンクは自分で書かない。

### glossary（任意、最大 5 件）

プロジェクト固有の用語で、初見の読み手が story を読むのに必要なものだけを選ぶ。1 項目に用語と 1 行の説明。6 件以上書くと先頭 5 件に切り詰められる。

## prep.txt の節構成

| 節 | 内容 | story.json での扱い |
|---|---|---|
| `=== PR ===` | URL、タイトル、base と head、hunk 数（うち配置済み） | 参照のみ |
| `=== BODY ===` | PR 本文 | 「なぜ」の根拠 |
| `=== COMMITS ===` | コミットの先頭 7 桁、見出し、本文（字下げ） | 「なぜ」の根拠 |
| `=== FILES WITHOUT HUNKS ===` | 純リネーム、バイナリ、モード変更のみなど、hunk のないファイル | **書かない。** 補助的な変更欄にファイル単位のリンクで自動的に載る |
| `=== PREPLACED ===` | ロックファイルの hunk（ID のみで本文は省略） | **書かない。** `support` に配置済み。書いた場合は参照が取り除かれて警告になる |
| `=== HUNKS ===` | 配置する対象の hunk。見出し、`@@` ヘッダー、本文 | 全部を章か `support` に 1 回ずつ入れる |

`=== PREPLACED ===` と `=== FILES WITHOUT HUNKS ===` の hunk・ファイルは story.json に書かない。`=== HUNKS ===` にはこれらを除いた hunk だけが載っている。

hunk 見出しの `[status]` は変更の種別（修正、新規、削除など）で、参照には使わない。参照に使うのは見出しの `file_path` と `old_start` だけである。

`support` に自分で入れるのは、機械的な変更（自動生成物、一括リネーム、フォーマットだけの変更など）である。ロックファイルは最初から配置済みなので、それ以外で判断する。理由（`reason`）は 1 行で書く。

## validate のエラーコードごとの直し方

`errors` の各要素は `{code, message, ...}`。`refs` や `path` があれば、直す場所がそこに書かれている。

| code | 意味 | 直し方 |
|---|---|---|
| `missing_story` | `story.json` がない | `prep` が返した `story_json` のパスへ Write する |
| `invalid_json` | JSON として読めない | 構文（カンマ、引用符、括弧）を直す |
| `invalid_story` | トップレベルがオブジェクトでない | `{prologue, chapters, support}` の形にする |
| `invalid_prologue` | `prologue` がない、または `title`、`overview`、`key_changes`、`risks` が空・型違い | `path` の項目を、空でない文字列（配列は 1 件以上）にする |
| `invalid_motivation` | `motivation` の 3 項目のいずれかが空 | `path` の項目を埋める。根拠がなければ「記載なし」 |
| `invalid_impact` | `impact` が配列でない | 文字列の配列にする |
| `invalid_glossary` | `glossary` が配列でない、または要素が `{term, description}` でない | 形を直す。不要なら `glossary` ごと削る |
| `invalid_chapter` | `chapters` が配列でない、章がオブジェクトでない、`title` が空 | `path` の箇所を直す |
| `invalid_chapter_id` | `id` が `[A-Za-z0-9_-]+` でない、または `overview` / `support` | `ch1` のような ID にする |
| `duplicate_chapter_id` | 章の `id` が重複 | 一意な ID に変える |
| `invalid_ref` | `hunk_refs` の要素が `{file_path, old_start}` でない、`hunk_refs` が配列でない | `old_start` は 0 以上の整数にする |
| `invalid_support` | `support` が配列でない、または要素がオブジェクトでない | 形を直す |
| `unsafe_diagram` | 図（`prologue.diagram` または章の `diagram`）の引用符なしラベルに、mermaid の記号（`/` `:` `(` `=` や `[/` などの形状記号）が入っている | `path` の図の、`labels` に列挙されたラベルを `A["..."]`、`-->|"..."|` のように引用符で囲む。形状記号は使わない |
| `unknown_refs` | `prep.txt` にない `(file_path, old_start)` を参照している | `refs` に列挙された参照を、`prep.txt` の hunk 見出しの値に合わせる。パスの打ち間違いと、`old_start` に新側の行番号を書いていないかを確認する |
| `duplicate_refs` | 同じ hunk を複数の箇所に配置している | `refs` の各 `locations` のうち 1 か所だけに残す |
| `below_floor` | 配置した hunk が半分に満たない | `refs` に列挙された未配置の hunk を章か `support` に入れる。大半が漏れているので、`prep.txt` を最後まで読めているかも確認する |

`warnings` は失敗ではないが、次の意味を持つ。

| code | 意味 | 対応 |
|---|---|---|
| `auto_filled` | 未配置の hunk を `support`（理由「未分類」）に補填した | 章に入れるべき hunk がないか確認し、あれば直して再実行する |
| `preplaced_ref_removed` | ロックファイルの hunk を参照していたので取り除いた | 対応不要 |
| `glossary_truncated` | `glossary` を先頭 5 件に切り詰めた | 対応不要。重要な用語が落ちていれば入れ替える |
| `empty_chapter` | 章に hunk がない | 不要な章なら削る |
| `old_start_coerced` | `old_start` が文字列だったので数値として扱った | 数値で書く |
| `unlinked_paths` | 散文に書いたパスが PR の差分にも head のファイル一覧にもなく、リンクにならなかった。`paths` に場所を列挙する | 打ち間違いなら直して再実行する。意図的（存在しないパスに触れている）なら対応不要。`tree_truncated: true` が付いていればファイル一覧を取得できていないので、実在するパスも含まれうる |
