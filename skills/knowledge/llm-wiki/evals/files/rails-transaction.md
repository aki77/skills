---
title: Railsでのトランザクション処理
source_url: https://example.com/rails-transaction
clipped: 2024-01-15
---

# Railsでのトランザクション処理

ActiveRecordのトランザクションは `ActiveRecord::Base.transaction` ブロックを使う。ブロック内で例外が発生すると自動的にロールバックされる。

## 基本的な使い方

```ruby
ActiveRecord::Base.transaction do
  user.update!(balance: user.balance - amount)
  merchant.update!(balance: merchant.balance + amount)
end
```

Modelクラスから直接呼ぶことも可能：

```ruby
User.transaction do
  # ...
end
```

## ロールバックの条件

`ActiveRecord::Rollback` または任意の例外を raise するとロールバックされる。ただし `update` など bang なしのメソッドは false を返すだけで例外を raise しないため、ロールバックされない。

```ruby
# これはロールバックされない
ActiveRecord::Base.transaction do
  user.update(balance: -100)  # false を返しても続行される
end

# これはロールバックされる
ActiveRecord::Base.transaction do
  user.update!(balance: -100)  # 失敗すると例外 → ロールバック
end
```

## ネストされたトランザクション

ActiveRecordのデフォルトではネストしたトランザクションは外側のトランザクションに統合される。独立したトランザクションが必要な場合は `requires_new: true` を使う。

```ruby
User.transaction do
  user.save!
  User.transaction(requires_new: true) do
    # セーブポイントを使った独立したトランザクション
    account.save!
  end
end
```

## 外部サービスとの連携

外部APIへのリクエスト（メール送信、決済APIなど）はトランザクション内に含めてはいけない。DBのロールバックに関わらず外部サービスの操作は取り消せないため。

```ruby
# 悪い例
User.transaction do
  user.save!
  PaymentGateway.charge(user)  # ロールバック時に取り消せない
end

# 良い例
User.transaction do
  user.save!
end
PaymentGateway.charge(user)  # トランザクション外で実行
```

## after_commit コールバック

トランザクションが確定した後に処理を実行したい場合は `after_commit` を使う。

```ruby
class User < ApplicationRecord
  after_commit :send_welcome_email, on: :create

  private

  def send_welcome_email
    UserMailer.welcome(self).deliver_later
  end
end
```
