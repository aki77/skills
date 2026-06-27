---
name: dependabot-triage
description: Dependabot のPR・設定を診断し、ノイズPRや不要な更新を抑える正しい対処を選ぶスキル。
license: MIT
disable-model-invocation: true
---

# Dependabot のPR・設定をトリアージする

Dependabot のノイズPR（繰り返し作られる・上げたくないメジャー・追従不要なコミット）は、**依存の種類によって正しい止め方が違う**。種類を取り違えると効かない設定を入れてしまう。このスキルは、PRや困りごとを見て種類を分類し、種類ごとの対処を選び、設定に反映するまでの判断フローを提供する。

このスキルは**診断して対処方針を提案するところまで**を担う。最終的にどの方針を採るか（特にPRをクローズするか、メジャーを固定するか等の運用判断）は人間に確認してから実装・検証・コミットへ進む。

## まず分類する

PRの差分（`gh pr diff <n>` や PR の `get_diff`）、あるいは困っている対象を見て、どの種類かを特定する。種類で対処が分かれるので、ここを誤らない。

| 種類 | 見分け方 | semverの`ignore`が効くか |
|---|---|---|
| **公開パッケージ（semver）** | rubygems/npm 等のレジストリ公開gem・パッケージ。バージョン番号が `X.Y.Z` で進む | ✅ 効く |
| **git参照の依存（ブランチ追従）** | マニフェストで VCS を直接参照（例: `github:`/`git:` 指定）かつ**ブランチ追従**。lock に `branch:` と `revision:`(コミットSHA) が出る | ❌ 効かない（後述） |
| **git参照の依存（タグ/バージョンpin）** | 同上だが**バージョン風タグ**に pin 済み（lock に `tag: vX.Y.Z`） | ✅ タグ判定が効く |
| **CI のアクション類**（GitHub Actions等） | ワークフローが参照するアクションのバージョン/SHA | ✅ 効く |

判別がつかないときは lock ファイルの該当エントリを見る。`branch:` 行があればブランチ追従、`tag:` 行があればタグpin、どちらも無く純粋なバージョン番号だけならレジストリ公開パッケージ。

## なぜ git参照のブランチ追従は `ignore` で止められないのか

Dependabot は VCS 直接参照の依存について、**ブランチ追従の場合はブランチHEADのコミットSHAを「最新版」とみなし、新コミットが入る度にPRを作る**。ここには semver（メジャー/マイナー/パッチ）の概念が存在しないため、`version-update:semver-major` などを使った `ignore` は**そもそもマッチしない**。

止めるには、依存側に semver の土俵を与える必要がある。**バージョン風タグに pin する**と、Dependabot はそのタグ群のうち最新を判定基準にし、「新しいタグが切られた時だけPR」に変わる。CI のアクションでハッシュpinした場合と同じ仕組み。

> この性質は推測で断定しない。挙動に確信が持てなければ、対象のパッケージマネージャ／Dependabot の最新ドキュメントを確認する（git参照依存の更新判定はエコシステムごとに差がある）。

## 種類ごとの対処

### 公開パッケージ（semver）— 上げたくない範囲を `ignore`

「メジャーは上げたくないが minor/patch は上げてよい」のような方針は、`dependabot.yml` の該当エコシステムに `ignore` を足す。

```yaml
ignore:
  - dependency-name: "<package-name>"
    update-types:
      - "version-update:semver-major"
```

- **なぜ上げたくないのか**を必ず確認・記録する。多いのは「実行環境やランタイムのメジャーに合わせて固定したい」ケース（例: 型定義パッケージをランタイム本体のメジャーに合わせる）。理由をコメントで残すと、後から見た人が誤って外さない。
- マニフェスト側のバージョン制約（`^` や `~>` 等）も、その範囲を超える更新を防いでいる。`ignore` と二重で効かせると堅い。

npm / bundler それぞれの**完全な `dependabot.yml` ブロック例**（`groups`＋`ignore`＋`cooldown` 込み）は [references/dependabot-yml-examples.md](references/dependabot-yml-examples.md) を参照。

### git参照の依存 — ブランチ追従なら**タグpinに変更**

ブランチ追従が原因のノイズPRは、`ignore` ではなくマニフェストの参照方法を変えて直す。

1. その依存が**バージョン風タグを運用しているか**を確認する（タグが無ければ pin できない → ブランチ追従のまま据え置くか、別途方針を相談）。
2. **現在 lock されている版に対応するタグ**へ pin する。原則として、いま lock 中の版を勝手に上げない（更新は別PRに分ける）。マニフェストの参照を `branch: '<branch>'`（または無指定）から `tag: '<vX.Y.Z>'` に書き換える。
3. lock を再生成して反映する（次節）。

これで以降は「新タグが切られた時だけ」更新PRが出るようになり、semver の `ignore` も効くようになる。`branch:` → `tag:` の Gemfile 記述例は [references/dependabot-yml-examples.md](references/dependabot-yml-examples.md) を参照。

### CI のアクション類 — 参照粒度で対処が変わる

対処は**ワークフローでの参照粒度**で決まる。

- **メジャータグ参照**（`uses: actions/checkout@v7` のような `@vN`）— `v7` タグは v7系の最新コミットを指すので、minor/patch 更新は**タグ参照側が自動で追従**する。Dependabot が出す minor/patch のPRは実質ノイズ（マージしても参照は `@v7` のまま）。意味があるのはメジャー更新（v7→v8）だけなので、`version-update:semver-minor` と `version-update:semver-patch` を `ignore` してメジャー更新PRだけ通す。
- **フルバージョン / SHA pin**（`@v7.1.2` や `@<sha>`）— その粒度の更新PRは意味がある（参照を書き換えないと上がらない）ので ignore しない。必要なら `groups` でまとめるだけにする。

加えて、アクションは数が多くPRが乱立しがちなので、`groups`（`patterns: ["*"]`）で1本のPRにまとめると効く。

## ノイズPRそのものを減らす設定

個別の `ignore`/pin と直交して、PR量・タイミングを整える設定がある。困りごとが「PRが多すぎる/早すぎる」なら、こちらを検討する。

- **`groups`** — minor/patch をエコシステム単位で1本のPRにまとめる。レビュー回数を大きく減らせる。
- **`cooldown`**（`default-days`）— リリース直後の不安定な版を避けるため、公開後N日経つまでPRを作らない。
- **`schedule.interval`** — `weekly` 等に落としてPR頻度を下げる。
- **CIの無駄打ちを止める / 権限不足で落ちる** — Dependabot PR で重いCIを回したくない、あるいはCIが `403` で失敗する場合は、ワークフロー側の対処になる。次の「Dependabot PR で CI が権限不足（403）で失敗する」を参照。

`groups`・`cooldown` を組み込んだ完全な設定例は [references/dependabot-yml-examples.md](references/dependabot-yml-examples.md) にある。

## 予定外の曜日/時刻にPRが来る

`schedule.day: monday`（や `time:`）を指定しているのに別の曜日にPRが来た、というケース。設定ミスを疑う前に、まず次の2点を押さえる。

- **`schedule` は best effort** — 指定はジョブを「だいたいその頃に開始する」程度で、厳密な曜日/時刻は保証されない。バックプレッシャー次第で前後する。
- **`dependabot.yml` を編集してpushすると即時再実行される（仕様）** — 設定変更はすぐ反映したいという想定で、Dependabot はスケジュールを待たずその場でジョブを走らせPRを作る。**現在スケジュール外で走る主因はこれ**（他はセキュリティアドバイザリ公開時・前回ジョブ失敗時の再実行）。

したがって「予定外の曜日にPRが来た」ら、まず **直前に `dependabot.yml` を編集・pushしていないか**（直近コミットに `dependabot.yml` の変更が無いか）を疑う。あれば設定どおりの正常動作であり、対処不要。`schedule` を触らずに次回を待てば通常はスケジュール付近に戻る。

> 出典: dependabot-core [#3059](https://github.com/dependabot/dependabot-core/issues/3059)（メンテナ回答）。スケジュール挙動は推測で断定せず、挙動に確信が持てなければ一次情報を確認する。なお `cooldown` は「リリース直後の版を避ける猶予期間」であってスケジュールの曜日/時刻とは無関係。混同しない。

## Dependabot PR で CI が権限不足（403）で失敗する

依存更新そのものとは別軸の、Dependabot PR 特有のCI失敗。

**症状と原因** — Dependabot が作るPRでは `GITHUB_TOKEN` がデフォルト **read-only** になる。そのため PR への書き込み（PR更新・コメント・レビュー投稿・チェック作成）を行うステップが `403 Resource not accessible by integration` で落ちる。2021年10月以降、Dependabot PR でも**ジョブの `permissions:` キーは尊重される**ので、必要な権限を明示すれば直る。

**対処** — そのジョブを「動かしたいか / 回したくないか」で分ける。

- **動かしたい** — ジョブに `permissions:` を明示する（最小権限で）。書き込みの種別ごとに必要なスコープが違う：
  - PR更新・コメント・レビュー投稿 → `contents: read` + `pull-requests: write`
  - チェック実行（github-pr-check 等） → さらに `checks: write`
  - 他ワークフローの成果物参照（カバレッジ集計の Octocov 等） → `actions: read`
- **回したくない**（重いレビューBot等） — ジョブの `if:` に `github.actor != 'dependabot[bot]'` を足してスキップする。

**勘所** — ジョブに `permissions:` を1つでも書くと、明示しなかったスコープは絞られる（read 中心になる）。書き込みステップが複数種別あるなら、必要なスコープを取りこぼさず全部挙げる。それでいて付けすぎず最小権限に保つ。

ワークフロー側の設定例（`permissions:` 明示・`actor` スキップの `if:`）は [references/dependabot-yml-examples.md](references/dependabot-yml-examples.md) を参照。

## lock を再生成して反映する（git参照gemをpinした場合など）

マニフェストを書き換えたら lock を整合させる。bundler の例：

```bash
bundle install
git diff <lockfile>   # 差分を検証
```

検証の勘所：

- pin したエントリで、参照行が `branch: ...` → `tag: vX.Y.Z` に置き換わっている。
- **バージョン番号が変わっていない**（pin の目的は固定であって更新ではない）。
- `revision:`(コミットSHA) は変わることがある。annotated tag の場合、タグ一覧APIが返すSHAはタグオブジェクト自身のSHAで、タグが指すコミットSHAとは別物。lock 再生成後はコミットSHAに解決されるため、バージョン番号さえ同じなら正常。
- pin した依存のツールが従来どおり動くか軽く確認する（例: linterやコマンドのバージョン表示）。

### 環境固有の落とし穴

ローカルの git 設定 `safe.bareRepository=explicit` が有効だと、bundler が git参照gemの bare キャッシュを操作できず `bundle install` が "not yet checked out" / "cannot use bare repository" で落ちることがある。その場合だけ、コマンド実行時に一時的に上書きして回避する：

```bash
GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=safe.bareRepository GIT_CONFIG_VALUE_0=all bundle install
```

これはローカル環境固有の回避で、コミット内容にもCIにも影響しない。エラーが出ないなら付けない。

## 進め方の指針

1. **分類してから動く** — PRや困りごとがどの種類かを最初に確定する。誤分類すると効かない設定を入れることになる。
2. **方針は人間に確認** — メジャー固定・PRクローズ・タグpinといった運用判断は、理由と選択肢を提示して選んでもらう。勝手にPRをクローズしない。
3. **理由を残す** — `ignore` や pin にはなぜそうするかを設定ファイルのコメントに書く。後任が誤って外すのを防ぐ。
4. **設定変更後は検証** — YAML構文の確認、lock差分の検証、対象ツールの動作確認までやってからコミットへ。
5. **PRのクローズ自体は別** — 設定を入れても既存のPRは自動では閉じない。クローズするかは人間判断（Dependabotには `@dependabot close` 等のコメントコマンドもある）。
