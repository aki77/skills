---
name: optimize-actions-parallel
description: "GitHub Actions の steps 並列実行機能（parallel: / background: + wait: / cancel:）を使って、.github/workflows のワークフローを新規作成または最適化するスキル。直列ステップの待ち時間を重ねて短縮したいとき、別々の job に分かれたセットアップ（checkout/依存関係インストール）の重複を1つに畳んでコストを下げたいとき、CI/CDを速くしたいときに使う。ただし「なんでも並列化すればいい」わけではなく、CPU/メモリを食い合う重い処理は同一ランナーに詰めると逆に遅くなるため、steps並列とjob並列（needs/matrix）の使い分けも判断する。"
license: MIT
disable-model-invocation: true
argument-hint: "[workflowファイルパス] (省略時は新規作成、または .github/workflows 全体を対象)"
---

# GitHub Actions steps 並列化

2026-06-25 に GA した steps 単位の並列実行（`parallel:` / `background:` + `wait:` / `cancel:`）を使い、
`.github/workflows` を新規作成または最適化する。同じ job・同じランナー・同じファイルシステムの中で
独立ステップを並列化できる点が、これまでの job 並列（`needs` / `matrix`）と違う。

このスキルの核心は構文そのものより **判断**にある。「並列にできるから並列にする」は罠で、
重い処理を1ランナーに詰めると CPU を奪い合って逆に遅くなることがある。効くパターンと効かない
パターンを見分けてから手を動かす。

## 構文の3パターン

```yaml
# パターン1: parallel: ブロック（末尾で暗黙的に全員を wait する糖衣構文）
steps:
  - parallel:
      - name: Build frontend
        run: npm run build:frontend
      - name: Build backend
        run: npm run build:backend
  - name: Run tests after all builds complete
    run: npm test
```

```yaml
# パターン2: background: + wait: / wait-all:（任意の位置で待つ、細かい制御用）
steps:
  - name: Build frontend
    id: build-frontend
    run: npm run build:frontend
    background: true
  - name: Build backend
    id: build-backend
    run: npm run build:backend
    background: true
  - name: Run linter while builds run
    run: npm run lint
  - name: Wait for both builds to finish
    wait: [build-frontend, build-backend]
  - name: Run tests
    run: npm test
```

```yaml
# パターン3: cancel:（バックグラウンドで起動したサービスの後始末）
steps:
  - name: Start local server
    id: server
    run: npm run serve &
    background: true
  - name: Run e2e tests against it
    run: npm run test:e2e
  - name: Stop the server
    cancel: server
```

使い分け:
- **「A・B・Cをまとめて並列実行して、全部終わったら次へ」** という素直なパターンには `parallel:` を使う。読みやすく、書き換えも最小限で済む。
- **「非同期で起動しておいて、途中の任意の位置で待つ」** など細かい制御が要るときだけ `background:` + `wait:` / `wait-all:` を使う。
- **長時間動くサービス**（テスト用サーバーなど）を一時的に立てて、後で確実に止めたいときは `cancel:` を使う。

GA 間もない機能のため、`wait-all:` の詳細な挙動や matrix との組み合わせなど、上記の最小例で
判断がつかない仕様に当たったら、公式のワークフロー構文リファレンスで確認する:
https://docs.github.com/ja/actions/reference/workflows-and-actions/workflow-syntax

## いつ steps 並列にするか（判断の核）

job 並列（`needs` / `matrix`）と steps 並列（`parallel:`）は似て非なるもの。表で整理する。

| 観点 | job 並列（needs / matrix） | steps 並列（parallel:） |
|---|---|---|
| ランナー | 別ランナー | 同一ランナー |
| セットアップ（checkout/依存関係インストール） | 各 job で重複する | 1回で共有できる |
| ファイルシステム | 分離（成果物は artifact 経由） | 共有（そのまま参照できる） |
| 向いている処理 | CPU/メモリを食い合う重い処理、完全に独立した処理 | 軽い独立チェック、待ち時間の重ね合わせ |

steps 並列が効くのは大きく2パターン:

1. **直列だった待ち時間を重ねて短縮する** — デプロイの安定待ちなど、CPU をあまり使わず「待っている時間」が長い処理を並べると、律速するのは一番長い待ちだけになり、合計時間が縮む。
2. **別々の job/workflow に分かれていた軽い独立チェックを1つの job に統合する** — checkout やパッケージインストールなどのセットアップの重複を1回にまとめられる。ただし全体の完了時間はもともと別ランナーで並走していた分そこまで縮まらない。効果は「時間短縮」ではなく「ランナーの合計消費時間（コスト）の削減」に出る。

**罠**: 同一ランナーは CPU・メモリも共有する。1〜2 CPU の小さいランナーに、CPU を食う重い処理（テスト実行やビルドなど）を複数まとめて `parallel:` に入れると、互いに CPU を奪い合ってどれも単独実行より遅くなり、トータルの完了時間がかえって伸びることがある。特に一番重い処理につられて全体が膨らむ。重い処理は無理に混ぜず、job のまま独立させておく判断も必要。

迷ったら「この処理は CPU/メモリを大きく使うか」「主に待ち時間か」で仕分ける。待ち中心の処理・軽い独立チェックは steps 並列、重い処理は job のまま、が基本線。具体的な before/after 例は [references/patterns.md](references/patterns.md) を参照。

## 1. 対象ワークフローを読む・要件を掴む

- **既存ワークフローの最適化**: 指定された、または `.github/workflows/*.yml` を読み、次を探す。
  - 直列に並んでいるが実際は独立しているステップ（一方の出力を他方が使っていない）
  - 複数の job/workflow が同じセットアップ（checkout・言語のセットアップ・依存関係インストール）を重複して行っている
- **新規作成**: ユーザーの要件から、互いに独立して実行できるチェック/デプロイ群を洗い出す。

依存関係の有無は `${{ steps.<id>.outputs.* }}` の参照や、同じファイル・リソースへの書き込みが競合しないかで判断する。判断がつかない場合はステップの中身をユーザーに確認する。

## 2. 並列化パターンを選ぶ

「いつ steps 並列にするか」の判断表に照らして、狙いを (A) 直列を並列にして完了時間を縮める、(B) 別 job/workflow の統合でセットアップ重複・コストを削減する、のどちらにするか決める。

- 重い処理（テストスイート全体、メモリを大量に使うビルドなど）は無理に同じ `parallel:` ブロックに混ぜない。軽い独立チェック同士だけをまとめ、重い処理は別 job のまま残す、あるいは重い処理単独で `parallel:` にする（他と混ぜない）のどちらかにする。
- job 統合を伴う変更（別ワークフローを1つに畳む等）は既存の CI 挙動を変える破壊的変更になりうる。安全に元に戻せるか、他のワークフローから参照されていないかを確認してから進める。

## 3. 書き換える・新規作成する

- 基本は `parallel:` を使う。任意の位置で待つ・キャンセルするなど細かい制御が必要な場合のみ `background:` + `wait:` / `cancel:` を使う。
- `checkout` や依存関係インストールなどの共通セットアップは、`parallel:` ブロックの**前**に1回だけ置く。各並列ステップの中で重複させない。
- `background: true` を付けたステップは `id` を持たせておく（`wait:` で名指しするため）。
- 既存ステップの `name` / `uses` / `with` / `env` はそのまま活かし、`parallel:` / `background:` の追加だけで済むようにする。ロジックまで変える必要はない。

## 4. 検証する

- `actionlint` が使える環境なら実行し、YAML の構文エラーやアクションの入力ミスがないか確認する。
- 並列化したステップ同士が本当に独立しているか（出力の参照・共有ファイルへの書き込み競合がないか）をもう一度読み返す。
- 実際の効果（完了時間・ランナー消費時間）は push して Actions の実行結果を見るまで確定しない。ここでは待たず、変更内容と期待される効果をユーザーに伝える。
- job を統合する・ワークフローファイルを削除するなど破壊的な変更は、適用前にユーザーに確認する。

## このスキルが扱わないこと

- job 並列（`needs` / `matrix`）そのものの設計 — 元々 job で分けるべきかどうかの判断はこのスキルの表を参考にするが、matrix 構成の設計自体は対象外。
- CI が失敗した原因の調査・修正 — `diagnose-ci-failure` スキルを使う。
- Actions のセキュリティ・権限（`permissions:` や OIDC など）の設計。

## 進め方の指針

1. **並列にすれば速いとは限らない** — 待ち時間中心の処理には効くが、CPU を食う重い処理を詰めると逆に遅くなる。処理の性質を見てから判断する。
2. **セットアップは1回に集約する** — `parallel:` ブロックの前に共通セットアップを置き、各ステップで重複させない。
3. **重い処理は混ぜない** — 同一ランナーは CPU・メモリを共有する。重い処理同士、または重い処理と軽い処理を同じ `parallel:` ブロックに詰め込まない。
4. **効果は完了時間とコストで別々に見る** — 直列→並列は完了時間短縮、別 job 統合はランナー消費時間（コスト）削減に効くことが多い。どちらを狙っているか意識する。
5. **job 統合など破壊的な変更は確認を取る** — 既存の CI 挙動を変えるため、独断で適用しない。
