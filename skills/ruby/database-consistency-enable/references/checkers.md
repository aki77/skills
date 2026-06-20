# database_consistency リファレンス

[SKILL.md](../SKILL.md) のワークフローで参照する、gem 一般の運用知見をまとめる。
特定プロジェクトに依存しない内容のみを扱う。

## 目次

1. [公式ドキュメント](#公式ドキュメント)
2. [最重要: `All: enabled: false` は使わない](#最重要-all-enabled-false-は使わない)
3. [設定ファイルのひな型](#設定ファイルのひな型)
4. [有効化＝削除のルール](#有効化削除のルール)
5. [推奨有効化順（影響度の低い順）](#推奨有効化順影響度の低い順)
6. [個別無効化の構文](#個別無効化の構文)
7. [実行コマンド](#実行コマンド)

## 公式ドキュメント

- Wiki: <https://github.com/djezzzl/database_consistency/blob/master/docs/wiki/home.md>
- 各チェッカーが何を検知するかの逐条解説は上記 wiki を参照。このファイルでは段階導入の
  運用に必要な要点だけをまとめる。

## 最重要: `All: enabled: false` は使わない

直感的には「`DatabaseConsistencyCheckers.All.enabled: false` で全部 OFF にし、有効化したい
ものだけ `enabled: true` にする」と書きたくなるが、**この書き方は意図通り機能しない**。

gem の有効判定は `enabled?(model, field, checker)` の経路で、より深い（具体的な）設定を
優先するアルゴリズムで解決される。優先順位は高い順に:

1. フィールド上の特定チェッカー（例: `('User', 'email', 'NullConstraintChecker')`）
2. フィールドレベル（例: `('User', 'email')`）
3. モデルレベル（例: `('User')`）
4. グローバルのチェッカー別（例: `DatabaseConsistencyCheckers.NullConstraintChecker`）
5. グローバル全体（`DatabaseConsistencyCheckers.All.enabled`）

`All.enabled: false` だけに頼ると、設定に存在しないモデル/フィールドは最終的に
`All.enabled`(=false) に落ちて即 false 判定となり、結果として **個別に `enabled: true` を
書いたチェッカーまで黙殺され、出力ゼロ・常に exit 0** という「検知しているつもりで何も
検知していない」状態に陥りやすい。

→ そのため本運用では **`All` を使わず、有効化したくないチェッカーを1つずつ
`enabled: false` で明示列挙する**。有効化するときはその列挙から削除する（後述）。

## 設定ファイルのひな型

`.database_consistency.yml` が無い場合は、全チェッカーを個別に `enabled: false` で列挙した
状態から始める。下記をそのままひな型として使える（gem v3 系の全チェッカー）。

```yaml
DatabaseConsistencyCheckers:
  AssociationChecker:
    enabled: false
  CaseSensitiveUniqueValidationChecker:
    enabled: false
  ColumnPresenceChecker:
    enabled: false
  EnumTypeChecker:
    enabled: false
  EnumValueChecker:
    enabled: false
  ForeignKeyCascadeChecker:
    enabled: false
  ForeignKeyChecker:
    enabled: false
  ForeignKeyTypeChecker:
    enabled: false
  ImplicitOrderingChecker:
    enabled: false
  LengthConstraintChecker:
    enabled: false
  MissingAssociationClassChecker:
    enabled: false
  MissingDependentDestroyChecker:
    enabled: false
  MissingIndexChecker:
    enabled: false
  MissingIndexFindByChecker:
    enabled: false
  MissingUniqueIndexChecker:
    enabled: false
  NullConstraintChecker:
    enabled: false
  PrimaryKeyTypeChecker:
    enabled: false
  RedundantIndexChecker:
    enabled: false
  RedundantUniqueIndexChecker:
    enabled: false
  ThreeStateBooleanChecker:
    enabled: false
  UniqueIndexChecker:
    enabled: false
  ValidatorChecker:
    enabled: false
  ValidatorsFractionChecker:
    enabled: false
  ViewPrimaryKeyChecker:
    enabled: false
```

> NOTE: チェッカー名・総数は gem のバージョンで変わり得る。新規導入時は
> `bundle exec database_consistency -h` や公式 wiki で当該バージョンの一覧を確認する。

## 有効化＝削除のルール

チェッカーを有効化するときは、対象の `CheckerName:` ブロック（`enabled: false` を含む2行）を
**削除** する。`enabled: true` に書き換えるのではない。

- 削除されたチェッカーは設定に存在しなくなり、（`All` を使っていないので）gem のデフォルトで
  有効になる。
- 設定ファイルに **残っている列挙 = まだ着手していないチェッカー**。段階導入の進捗が
  ファイルそのものから読み取れる。

## 推奨有効化順（影響度の低い順）

下に行くほど対応に設計判断を要する。原則として上から順に有効化していく（ユーザー指定が
あればそれを優先）。各チェッカーの詳細は[公式 wiki](#公式ドキュメント) を参照。

### 第1群: 動作に影響なく、対応漏れが明白

修正がほぼ機械的で、アプリ挙動を変えずに対応できることが多い。導入の最初に向く。

- `RedundantIndexChecker` — 冗長な（より広い index の先頭プレフィックスと重複する）index
- `RedundantUniqueIndexChecker` — 冗長な unique index
- `MissingDependentDestroyChecker` — 親に `dependent:` 付き関連が欠けている
- `MissingIndexChecker` — 必要な index の欠落
- `MissingIndexFindByChecker` — `find_by` 対象カラムの index 欠落
- `MissingUniqueIndexChecker` — uniqueness バリデーションに対応する unique index 欠落

### 第2群: スキーマ整合性。修正は概ね機械的だが影響確認が要る

- `ColumnPresenceChecker` — presence バリデーションと NOT NULL 制約の不整合
- `NullConstraintChecker` — NULL 制約まわりの不整合
- `ForeignKeyChecker` — 外部キー制約の欠落
- `ForeignKeyTypeChecker` — 外部キーの型不一致
- `PrimaryKeyTypeChecker` — 主キーの型
- `MissingAssociationClassChecker` — 関連先クラスが見つからない
- `MissingTableChecker` — 参照テーブルが存在しない
- `ViewPrimaryKeyChecker` — view の主キー

### 第3群: バリデーション/挙動に踏み込む。対応に設計判断を要する

既存の仕様判断と衝突しやすく、個別無効化（理由コメント付き）が必要になる場面が増える。

- `LengthConstraintChecker` — length バリデーションとカラム長の不整合
- `UniqueIndexChecker` — unique index と uniqueness バリデーションの不整合
- `CaseSensitiveUniqueValidationChecker` — uniqueness の大文字小文字の扱い
- `EnumTypeChecker` — enum の型定義
- `EnumValueChecker` — enum 値の不整合
- `ForeignKeyCascadeChecker` — 外部キーの ON DELETE 指定
- `ThreeStateBooleanChecker` — nullable な boolean カラム
- `ImplicitOrderingChecker` — 暗黙の並び順
- `AssociationChecker` — 関連定義
- `ValidatorChecker` — バリデータと DB 制約の対応
- `ValidatorsFractionChecker` — バリデーション網羅率

## 個別無効化の構文

アプリ仕様上やむを得ない違反は、チェッカー全体ではなく **可能な限り狭い範囲**（特定モデルの
特定カラム）で無効化する。`DatabaseConsistencyCheckers:` の外に、モデル名をトップレベルキーと
して書く。より深い（具体的な）設定が優先される。

**特定カラム（推奨。最も狭い範囲）:**

```yaml
# 無効化の理由をここに書く（なぜこのチェックを当該カラムに適用しないのか）
User:
  phone:
    ColumnPresenceChecker:
      enabled: false
```

**特定モデル全体（カラムを問わず無効化したい場合のみ）:**

```yaml
# 無効化の理由をここに書く
User:
  NullConstraintChecker:
    enabled: false
```

- **理由コメントは必須。** 上の例では便宜上 `#` コメントで示したが、タグの付け方など
  具体的な記法はそのプロジェクトの規約に従う。
- 複合キーは `name+email` のようにキー名を連結して指定する。
- `*` のワイルドカード（例: `Admin*`）や YAML のアンカー/エイリアスも使える。詳細は
  公式 wiki の configuration ページを参照。
- 構文に迷ったら、当該バージョンの挙動を公式 wiki の configuration.md で最終確認すること。

## 違反対応の落とし穴

### NOT NULL な boolean 列に `presence: true` を付けない

`ColumnPresenceChecker` / `NullConstraintChecker` が boolean 列を指摘したとき、反射的に
`presence: true` を足してはいけない。`presence` は `false` を「空」とみなして弾くため、
`false` が正当な値である boolean 列では正しく動かない。

- DB default（例 `default: false`）があり NULL が構造的に入らない → 理由コメント付きで
  **個別無効化** する（presence も inclusion も不要）。
- 整合のためにバリデーションを置きたい → `validates :col, inclusion: { in: [true, false] }`
  を使う（`presence: true` ではなく）。

### `default: ""` の文字列にも `presence: true` を付けない

`ColumnPresenceChecker` が `default: ""`（空文字デフォルト）の NOT NULL 文字列を指摘した
場合も、`presence: true` を足してはいけない。空文字 `""` は presence では「空」と判定されて
弾かれるうえ、DB default により NULL が構造的に入ることもない（チェッカーの懸念が成立しない）。

- 典型例は Devise 管理の `email`（`default: ""`、presence は Devise の `validatable` に委ねる）。
- 対応は **理由コメント付きで個別無効化**。新たなバリデーションは置かない。

## 実行コマンド

```bash
bundle exec database_consistency
```

- DB スキーマを読むため **DB 接続が前提**（起動方法はプロジェクト依存）。
- 違反を検出すると **非ゼロ終了** する（CI ではこれで fail する）。違反なしなら exit 0。
- `bundle exec database_consistency -g` で既存の違反を一括無効化した todo ファイル
  （`.database_consistency.todo.yml`）を生成できるが、本運用は「1チェッカーずつ列挙から削除」
  方式で進めるため、通常 `-g` は使わない。
